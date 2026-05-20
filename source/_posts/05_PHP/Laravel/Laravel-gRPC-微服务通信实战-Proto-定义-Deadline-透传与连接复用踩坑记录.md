---
title: Laravel + gRPC 微服务通信实战：Proto 定义、Deadline 透传与连接复用踩坑记录
date: 2026-05-03 08:40:00
categories:
  - 05_PHP
  - Laravel
tags: [BFF, Laravel, 微服务]description: 结合 Laravel BFF 调用 Go 评价服务的真实改造经验，记录 gRPC 在 Proto 契约、超时控制、连接复用、灰度兼容与排障上的一套生产可用实践。
---

在 BFF 场景里，最耗时的通常不是 Laravel 自己，而是它后面串起来的 3~5 个下游服务。我们把一个商品详情接口从 REST 改成 gRPC，不是为了“追新”，而是因为原本 JSON over HTTP 在高峰期很容易被序列化、连接建立和 Nginx 超时拖慢。改造后，同样一条评价聚合链路，P95 从 **230ms** 降到 **68ms**，但过程中真正难的不是生成代码，而是**契约演进、deadline 透传、连接复用和错误码治理**。

## 一、落地后的调用结构

```text
App / Web
   │
   ▼
Laravel BFF Controller
   │  request-id / auth / deadline
   ▼
GrpcReviewClient
   │
   ├── ProductService (REST)
   └── ReviewService (gRPC)
           │
           ▼
      Go Review Server
           │
           └── MySQL + Redis
```

这套结构里，BFF 不直接散落调用 stub，而是统一走一个 `GrpcReviewClient`，这样日志、超时、metadata、异常映射都能收口。

## 二、Proto 不要只图“能生成代码”

我们一开始吃过的亏，是把前端展示字段直接写进 proto，结果字段一改就要全链路发版。后来改成“面向服务边界”的定义：

```proto
syntax = "proto3";

package review.v1;
option go_package = "review/api/v1;reviewv1";

service ReviewService {
  rpc BatchGetScore(BatchGetScoreRequest) returns (BatchGetScoreReply);
}

message BatchGetScoreRequest {
  repeated uint64 product_ids = 1;
  string locale = 2;
}

message ScoreItem {
  uint64 product_id = 1;
  double avg_score = 2;
  uint32 review_count = 3;
}

message BatchGetScoreReply {
  repeated ScoreItem items = 1;
}
```

这里有两个原则：

1. 字段编号一旦上线就不要重排。
2. 删除字段时不要复用旧编号，直接 `reserved 4;`。

本地开发时我会把 proto 生成命令也固定进 Makefile，而不是让每个人手动敲：

```makefile
PROTO_DIR=./proto
PHP_OUT=./app/Grpc
GO_OUT=./review-service/api

proto:
	protoc -I=$(PROTO_DIR) \
	  --php_out=$(PHP_OUT) \
	  --grpc_out=$(PHP_OUT) \
	  --plugin=protoc-gen-grpc=/opt/homebrew/bin/grpc_php_plugin \
	  $(PROTO_DIR)/review/v1/review.proto

	protoc -I=$(PROTO_DIR) \
	  --go_out=$(GO_OUT) \
	  --go-grpc_out=$(GO_OUT) \
	  $(PROTO_DIR)/review/v1/review.proto
```

这样做的价值不是偷懒，而是**生成路径、插件版本、目录结构可重复**。不然最容易出现的情况就是：PHP 同学生成一套 namespace，Go 同学生成另一套 package，最后 CI 才炸。

## 三、Go 服务端实现要先把超时和状态码定好

```go
func (s *ReviewServiceServer) BatchGetScore(
    ctx context.Context,
    req *reviewv1.BatchGetScoreRequest,
) (*reviewv1.BatchGetScoreReply, error) {
    if len(req.ProductIds) == 0 {
        return nil, status.Error(codes.InvalidArgument, "product_ids is required")
    }

    scores, err := s.repo.BatchQueryScore(ctx, req.ProductIds, req.Locale)
    if err != nil {
        return nil, status.Error(codes.Internal, err.Error())
    }

    items := make([]*reviewv1.ScoreItem, 0, len(scores))
    for _, score := range scores {
        items = append(items, &reviewv1.ScoreItem{
            ProductId:   score.ProductID,
            AvgScore:    score.AvgScore,
            ReviewCount: uint32(score.ReviewCount),
        })
    }

    return &reviewv1.BatchGetScoreReply{Items: items}, nil
}
```

服务端别把所有异常都吞成 `Internal`。参数错误、资源不存在、限流、超时要对应 `InvalidArgument`、`NotFound`、`ResourceExhausted`、`DeadlineExceeded`，不然 Laravel 端只能一律当 500 处理。

另外我们还会在服务端统一打 access log，把 request-id 和 deadline 一起记下来，排障时非常好用：

```go
func UnaryLogInterceptor(logger *zap.Logger) grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        start := time.Now()
        resp, err := handler(ctx, req)

        st, _ := status.FromError(err)
        deadline, hasDeadline := ctx.Deadline()

        logger.Info("grpc access",
            zap.String("method", info.FullMethod),
            zap.String("code", st.Code().String()),
            zap.Duration("cost", time.Since(start)),
            zap.Bool("has_deadline", hasDeadline),
            zap.Time("deadline", deadline),
        )

        return resp, err
    }
}
```

## 四、Laravel 端关键不是“调通”，而是别每次请求都新建连接

```php
<?php

namespace App\Services\Grpc;

use Grpc\ChannelCredentials;
use Review\V1\BatchGetScoreRequest;
use Review\V1\ReviewServiceClient;

final class GrpcReviewClient
{
    public function __construct(private readonly ReviewServiceClient $client) {}

    public function batchGetScore(array $productIds, string $locale, string $requestId): array
    {
        $request = new BatchGetScoreRequest([
            'product_ids' => $productIds,
            'locale' => $locale,
        ]);

        [$reply, $status] = $this->client->BatchGetScore(
            $request,
            ['x-request-id' => [$requestId]],
            ['timeout' => 80 * 1000]
        )->wait();

        if ($status->code !== \Grpc\STATUS_OK) {
            throw new \RuntimeException("grpc failed: {$status->code} {$status->details}");
        }

        return collect($reply->getItems())
            ->mapWithKeys(fn ($item) => [
                $item->getProductId() => [
                    'avg_score' => $item->getAvgScore(),
                    'review_count' => $item->getReviewCount(),
                ],
            ])->all();
    }
}
```

```php
// AppServiceProvider.php
$this->app->singleton(ReviewServiceClient::class, function () {
    return new ReviewServiceClient(config('grpc.review.host'), [
        'credentials' => ChannelCredentials::createInsecure(),
    ]);
});
```

我们最早把 client 写在方法内部，每次调用都 `new ReviewServiceClient(...)`，压测时连接数暴涨，延迟抖得很明显。收敛到容器单例后，链路稳定很多。

实际业务代码里，Controller 不应该直接拼 gRPC 细节，而是交给应用服务做聚合：

```php
<?php

final class ProductDetailQueryService
{
    public function __construct(
        private readonly ProductApiClient $productApiClient,
        private readonly GrpcReviewClient $grpcReviewClient,
    ) {}

    public function handle(int $productId, string $locale, string $requestId): array
    {
        $product = $this->productApiClient->getDetail($productId, $locale);
        $scores = $this->grpcReviewClient->batchGetScore([$productId], $locale, $requestId);

        return [
            'id' => $product['id'],
            'name' => $product['name'],
            'price' => $product['price'],
            'review' => $scores[$productId] ?? [
                'avg_score' => null,
                'review_count' => 0,
            ],
        ];
    }
}
```

好处是协议切换不会扩散到控制器层。以后哪怕从 gRPC 改成 HTTP/2 JSON，影响面也只在基础设施层。

## 五、deadline 要从入口一路传下去

真实线上最常见的问题不是报错，而是**上游已经超时返回，下游还在继续查库**。我们的做法是入口先算剩余预算，再传给 gRPC：

```php
$budgetMs = max(20, 120 - (int) ((microtime(true) - LARAVEL_START) * 1000));
$grpcTimeout = $budgetMs * 1000;
```

这样商品详情页总预算 120ms，BFF 自己用掉 40ms 后，gRPC 最多再跑 80ms，不会把超时层层放大。

除了 timeout，我还会把 metadata 固定透传三类信息：

1. `x-request-id`：串联日志。
2. `x-user-id`：做审计或灰度。
3. `x-deadline-ms`：让下游服务知道剩余预算。

```php
$metadata = [
    'x-request-id' => [$requestId],
    'x-user-id' => [(string) auth()->id()],
    'x-deadline-ms' => [(string) $budgetMs],
];

[$reply, $status] = $this->client->BatchGetScore(
    $request,
    $metadata,
    ['timeout' => $grpcTimeout]
)->wait();
```

很多团队只传 request-id，不传剩余预算，最后会出现一个现象：服务 A 觉得自己只跑了 90ms 不算慢，但它根本不知道调用它的人只剩 30ms 可用。

## 六、错误码映射不要留在控制器里临时判断

我最终会在基础设施层把 gRPC 状态码先转换成领域内可理解的异常：

```php
<?php

final class GrpcStatusMapper
{
    public static function throwIfNotOk(object $status): void
    {
        if ($status->code === \Grpc\STATUS_OK) {
            return;
        }

        match ($status->code) {
            \Grpc\STATUS_DEADLINE_EXCEEDED => throw new DownstreamTimeoutException($status->details),
            \Grpc\STATUS_NOT_FOUND => throw new ResourceNotFoundException($status->details),
            \Grpc\STATUS_UNAVAILABLE => throw new ServiceUnavailableException($status->details),
            default => throw new \RuntimeException("grpc failed: {$status->code} {$status->details}"),
        };
    }
}
```

这样 API 层可以很稳定地输出 HTTP 语义：

- `DeadlineExceeded` -> `504 Gateway Timeout`
- `Unavailable` -> `503 Service Unavailable`
- `NotFound` -> `404`

如果这一层不做，线上最常见的结果就是所有 gRPC 异常都包装成 500，监控上根本分不清是超时、服务挂了，还是调用参数错了。

## 七、几个真实踩坑

### 1. proto3 默认值把“没返回”和“返回 0”混在一起
评分接口里 `review_count=0` 是合法值，但字段缺失时 PHP 端同样会读到 0。后来我们对“可空语义”改用包装类型，避免前端把“暂无评价”和“评价数为 0”混掉。

### 2. Ingress 超时比 gRPC deadline 还短
应用里配了 150ms deadline，但 Ingress `proxy-read-timeout` 只有 60ms，结果日志里全是 499/504，看起来像服务端慢，实际上是网关先断了。最后统一把**网关超时 > BFF 总预算 > 单个 gRPC deadline**。

### 3. 字段下线时复用了编号
这类错误最隐蔽，本地没问题，灰度时老客户端会把新字段按旧含义解析。之后我们在 code review 里强制检查：删除字段必须 `reserved`，禁止复用。

### 4. PHP-FPM 下偶发连接泄漏，重载后才恢复
这个问题一度很难追。现象是发布后一切正常，过几个小时开始偶发 `UNAVAILABLE: recvmsg:Connection reset by peer`。后来排查发现不是 gRPC 本身不稳，而是我们在异常分支里创建了额外 client，却没被容器托管。压测时看不出来，线上长时间运行才暴露。

最后的修复动作有三个：

1. 所有 stub 统一交给容器单例管理。
2. 禁止在 job / listener 里直接 `new ReviewServiceClient`。
3. 发布后把连接数纳入监控，观察 worker 生命周期内是否持续上涨。

### 5. 灰度发布时新老 proto 不兼容
我们曾经给 `ScoreItem` 新增了 `rating_text` 字段，同时老版本 BFF 还在按旧字段逻辑渲染。虽然 proto 本身向后兼容，但业务语义不兼容：新服务返回了“无评价”文案，老前端又额外拼了一次，页面出现重复文案。后来我们把规则定死：**proto 兼容只解决反序列化，不解决业务兼容**，灰度时仍然要按版本开关控制。

## 八、上线前我会检查的清单

- [ ] proto 字段编号未重排，删除字段已 `reserved`
- [ ] Laravel 端 client 由容器单例管理
- [ ] 所有 gRPC 调用都带 request-id 与 timeout
- [ ] Ingress / Nginx 超时大于应用 deadline
- [ ] 关键状态码已映射成 HTTP 语义
- [ ] access log 能查到 method、code、cost、request-id
- [ ] 灰度阶段新字段受 feature flag 控制

## 九、我现在的实践结论

gRPC 不是“性能魔法”，但很适合**内部同步调用、强契约、低延迟链路**。如果 Laravel 团队要接入它，重点别放在生成 stub，而要放在四件事：**proto 演进规范、连接复用、deadline 透传、错误码治理**。这四个问题处理好了，gRPC 才会真正比 REST 更稳，而不只是 benchmark 更好看。
