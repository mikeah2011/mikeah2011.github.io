---
title: Laravel + gRPC 微服务通信实战：Proto 定义、Deadline 透传与连接复用踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 08:40:00
categories:
  - php
tags: [BFF, Laravel, 微服务, gRPC, Proto, 性能优化]
keywords: [Laravel, gRPC, Proto, Deadline, 微服务通信实战, 定义, 透传与连接复用踩坑记录, PHP]
description: 结合 Laravel BFF 调用 Go 评价服务的真实改造经验，深入记录 gRPC 在 Proto 契约设计、Deadline 透传、连接复用与 Keepalive、错误码映射、指数退避重试、灰度兼容与生产排障上的完整实践指南，附 gRPC vs REST vs GraphQL 对比表、Interceptor 实现与可落地代码示例。



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

## 二、Proto 不要只图"能生成代码"

我们一开始吃过的亏，是把前端展示字段直接写进 proto，结果字段一改就要全链路发版。后来改成"面向服务边界"的定义。下面是我们在生产中使用的完整 `.proto` 文件，包含枚举、嵌套消息、分页和批量接口：

```proto
syntax = "proto3";

package review.v1;
option go_package = "review/api/v1;reviewv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/wrappers.proto";

// ============================================================
// 枚举：评价星级与排序方式
// ============================================================

enum RatingFilter {
  RATING_FILTER_UNSPECIFIED = 0;
  RATING_FILTER_FIVE_STAR   = 5;
  RATING_FILTER_FOUR_STAR   = 4;
  RATING_FILTER_THREE_STAR  = 3;
  RATING_FILTER_TWO_STAR    = 2;
  RATING_FILTER_ONE_STAR    = 1;
}

enum SortOrder {
  SORT_ORDER_UNSPECIFIED = 0;
  SORT_ORDER_NEWEST      = 1; // 按创建时间倒序
  SORT_ORDER_HIGHEST     = 2; // 按评分倒序
  SORT_ORDER_MOST_LIKED  = 3; // 按点赞数倒序
}

// ============================================================
// 核心消息
// ============================================================

message ScoreItem {
  uint64 product_id   = 1;
  double avg_score    = 2;
  uint32 review_count = 3;
  // proto3 中 float/double 默认值为 0，无法区分"没返回"和"返回 0"
  // 因此对可空语义使用包装类型
  google.protobuf.DoubleValue weighted_score = 4;
}

message Review {
  uint64   id          = 1;
  uint64   product_id  = 2;
  uint64   user_id     = 3;
  string   content     = 4;
  uint32   rating      = 5;  // 1-5
  google.protobuf.Timestamp created_at = 6;
  uint32   like_count  = 7;
  // reserved 8;  — 已下线的 image_urls 字段，编号不再复用
  reserved 8;
}

message Pagination {
  uint32 page      = 1;
  uint32 page_size = 2;
  uint32 total     = 3;
}

// ============================================================
// 请求 / 响应
// ============================================================

message BatchGetScoreRequest {
  repeated uint64 product_ids = 1;
  string locale               = 2;
}

message BatchGetScoreReply {
  repeated ScoreItem items    = 1;
}

message ListReviewsRequest {
  uint64     product_id  = 1;
  SortOrder  sort        = 2;
  RatingFilter rating_filter = 3;
  Pagination pagination  = 4;
}

message ListReviewsReply {
  repeated Review reviews  = 1;
  Pagination pagination    = 2;
}

message SubmitReviewRequest {
  uint64 product_id = 1;
  uint64 user_id    = 2;
  string content    = 3;
  uint32 rating     = 4;
}

message SubmitReviewReply {
  uint64 review_id = 1;
}

// ============================================================
// 服务定义：注意一个服务只管一个领域
// ============================================================

service ReviewService {
  // 批量获取商品评分 — BFF 聚合场景高频调用
  rpc BatchGetScore(BatchGetScoreRequest) returns (BatchGetScoreReply);

  // 分页查询评价列表
  rpc ListReviews(ListReviewsRequest) returns (ListReviewsReply);

  // 提交评价 — 写操作
  rpc SubmitReview(SubmitReviewRequest) returns (SubmitReviewReply);
}
```

### Proto 演进的三条铁律

1. **字段编号一旦上线就不要重排。** protobuf 的二进制格式依赖编号而非字段名，重编号等于格式变更。
2. **删除字段时不要复用旧编号，直接 `reserved N;`。** 灰度阶段新老服务并存，复用编号会导致老客户端把新字段按旧含义解析。
3. **可空语义用 `google.protobuf.XxxValue` 包装类型。** proto3 中 `int32 score = 1` 默认值就是 0，无法和"没返回"区分。评分接口里 `review_count=0` 是合法值，用包装类型才能在 PHP 端收到 `null`。

### 完整的 Makefile 生成命令

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

## 二之一、gRPC vs REST vs GraphQL：微服务通信方案对比

在决定用 gRPC 之前，我们认真对比了三种主流方案。以下是基于我们实际 BFF 场景的对比：

| 维度 | gRPC | REST (JSON over HTTP) | GraphQL |
|------|------|----------------------|---------|
| **序列化格式** | Protobuf（二进制，体积小 3-5 倍） | JSON（文本，人类可读） | JSON（文本） |
| **传输协议** | HTTP/2（多路复用、头部压缩） | HTTP/1.1 或 HTTP/2 | HTTP/1.1 或 HTTP/2 |
| **契约强度** | 强（.proto 文件，编译期检查） | 弱（OpenAPI 可选，运行时才报错） | 中（Schema 定义，运行时校验） |
| **代码生成** | 官方支持多语言（PHP/Go/Java/Python） | 需第三方（swagger-codegen 等） | 需第三方（graphql-codegen 等） |
| **流式传输** | 原生支持 Server/Client/Bidirectional Streaming | 需 SSE 或 WebSocket | Subscription（基于 WebSocket） |
| **浏览器直连** | 需 gRPC-Web 或 Envoy 代理 | 原生支持 | 原生支持 |
| **学习曲线** | 中高（需要理解 proto、stub、channel 概念） | 低 | 中（Resolver、N+1 问题） |
| **典型延迟** | P95 通常比 REST 低 30-60% | 基线 | 取决于 Resolver 实现和查询深度 |
| **适用场景** | 内部服务间同步调用、强契约、低延迟 | 公开 API、简单 CRUD、快速迭代 | 前端灵活查询、多数据源聚合 |

**我们的选择逻辑：** BFF 到后端微服务是内部调用、需要强契约和低延迟，gRPC 是最佳选择；BFF 到前端仍然用 REST，因为浏览器和 CDN 生态成熟。不选 GraphQL 的原因是我们的后端服务是 Go 写的，GraphQL resolver 在 Go 生态不如 gRPC 成熟，而且 BFF 层已经承担了聚合职责，GraphQL 的核心价值（客户端按需查询）在 BFF 架构下收益不大。

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

## 四、Laravel 端关键不是"调通"，而是别每次请求都新建连接

### 4.1 基础客户端封装

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

### 4.2 连接复用：容器单例 + Channel 参数调优

我们最早把 client 写在方法内部，每次调用都 `new ReviewServiceClient(...)`，压测时连接数暴涨，延迟抖得很明显。收敛到容器单例后，链路稳定很多。

**关键配置 — Channel 参数：**

```php
// AppServiceProvider.php
use Grpc\ChannelCredentials;

$this->app->singleton(ReviewServiceClient::class, function () {
    return new ReviewServiceClient(config('grpc.review.host'), [
        'credentials' => ChannelCredentials::createInsecure(),
        // 连接池大小：同一 Channel 内的 HTTP/2 连接数
        'grpc.max_pings_without_data'           => 0,
        // Keepalive：每 10 秒发送一次 ping，防止中间设备断开空闲连接
        'grpc.keepalive_time_ms'                => 10000,
        // Keepalive 超时：ping 发出后 5 秒内无响应则关闭连接
        'grpc.keepalive_timeout_ms'             => 5000,
        // 允许在没有活跃 RPC 时也发送 keepalive ping
        'grpc.keepalive_permit_without_calls'   => 1,
        // 启用 HTTP/2 后台流
        'grpc.enable_retries'                   => 0, // 重试由应用层控制
        // 最大接收消息大小（默认 4MB，按需调整）
        'grpc.max_receive_message_length'       => 4 * 1024 * 1024,
    ]);
});
```

**为什么 keepalive 如此重要？** 云环境中，LB（如 AWS NLB、阿里云 SLB）默认空闲超时是 60-350 秒。如果 gRPC 连接长时间没有数据传输，中间设备会静默断开连接，而客户端不会立刻感知，导致下一次请求偶发 `UNAVAILABLE`。keepalive 机制通过定期发送 HTTP/2 PING 帧来保活连接。

### 4.3 使用 Spiral RoadRunner 作为 gRPC Worker

如果 Laravel 运行在 [RoadRunner](https://roadrunner.dev/) 上，可以用 `spiral/roadrunner-grpc` 实现常驻进程模式的 gRPC 客户端/服务端，避免 PHP-FPM 的进程模型带来的连接管理问题：

```bash
composer require spiral/roadrunner-grpc
```

```php
<?php
// 使用 RoadRunner 的 gRPC 客户端（无需每次 new channel）
use Spiral\Grpc\Channel;
use Review\V1\ReviewServiceClient;

// 在 Laravel Service Provider 中注册
$this->app->singleton(ReviewServiceClient::class, function () {
    // RoadRunner 会复用底层连接，无需手动管理
    $channel = new Channel(
        config('grpc.review.host'),
        ChannelCredentials::createInsecure()
    );
    return new ReviewServiceClient(config('grpc.review.host'), [
        'credentials' => ChannelCredentials::createInsecure(),
    ]);
});
```

RoadRunner 的优势是 PHP 进程常驻内存，gRPC channel 生命周期和进程绑定，天然避免了 FPM 下每次请求都要重新建立连接的问题。但要注意，常驻进程模式下内存泄漏会更明显，需要配合监控 worker 的内存和连接数。

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

### 5.1 用 Interceptor 实现自动 Deadline 透传

手动在每个调用点计算 deadline 容易遗漏。我们用 gRPC 的 **Client Interceptor** 机制，在通道层自动注入 deadline 和 metadata，业务代码完全不需要感知：

```php
<?php

namespace App\Services\Grpc\Interceptors;

use Grpc\ClientInterceptor;
use Grpc\Internal\UnaryClientCall;
use Grpc\Internal\BidiStreamingCall;
use Grpc\Internal\ClientStreamingCall;
use Grpc\Internal\ServerStreamingCall;

/**
 * 自动注入 deadline 和公共 metadata 的客户端拦截器
 *
 * 用法：创建 channel 时传入
 *   $channel = new \Grpc\Channel('review-service:9501', [
 *       'interceptors' => [new DeadlinePropagationInterceptor()],
 *   ]);
 */
final class DeadlinePropagationInterceptor extends ClientInterceptor
{
    private string $requestId;
    private int    $startTimestamp; // 微秒

    public function __construct()
    {
        $this->requestId = request()->header('x-request-id', uniqid('req-'));
        // LARAVEL_START 是 Laravel 框架定义的请求起始时间（秒.微秒）
        $this->startTimestamp = defined('LARAVEL_START')
            ? (int) (LARAVEL_START * 1_000_000)
            : (int) (microtime(true) * 1_000_000);
    }

    public function interceptUnaryUnary(
        UnaryClientCall $call,
        $deserialize
    ) {
        [$request, $metadata, $options] = $call->getRequest();

        // 计算剩余预算（默认总预算 120ms）
        $totalBudgetMs = config('grpc.deadline.total_budget_ms', 120);
        $elapsedUs = (int) (microtime(true) * 1_000_000) - $this->startTimestamp;
        $remainingMs = max(20, $totalBudgetMs - (int) ($elapsedUs / 1000));

        // 注入公共 metadata
        $metadata = array_merge($metadata, [
            'x-request-id'  => [$this->requestId],
            'x-deadline-ms' => [(string) $remainingMs],
            'x-user-id'     => [(string) (auth()->id() ?? 0)],
        ]);

        // 设置 gRPC 超时（微秒）
        $options['timeout'] = $remainingMs * 1000;

        $call->updateRequest([$request, $metadata, $options]);

        return parent::interceptUnaryUnary($call, $deserialize);
    }
}
```

**注册方式：**

```php
// config/grpc.php
return [
    'review' => [
        'host' => env('GRPC_REVIEW_HOST', 'review-service:9501'),
        'deadline' => [
            'total_budget_ms' => 120,
        ],
    ],
];

// AppServiceProvider.php
use App\Services\Grpc\Interceptors\DeadlinePropagationInterceptor;

$this->app->singleton(ReviewServiceClient::class, function () {
    $channel = new \Grpc\Channel(config('grpc.review.host'), [
        'credentials' => ChannelCredentials::createInsecure(),
        'interceptors' => [new DeadlinePropagationInterceptor()],
        'grpc.keepalive_time_ms'      => 10000,
        'grpc.keepalive_timeout_ms'   => 5000,
        'grpc.keepalive_permit_without_calls' => 1,
    ]);

    return new ReviewServiceClient(config('grpc.review.host'), [
        'credentials' => ChannelCredentials::createInsecure(),
    ]);
});
```

这样做的好处是：**新增 gRPC 调用时不需要手动计算 deadline，interceptor 会自动处理。** 如果某个调用需要自定义超时，可以在 metadata 中显式传 `timeout` 覆盖默认值。

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

## 六之一、错误重试策略与指数退避

gRPC 调用不可能 100% 成功。网络抖动、服务重启、负载均衡切换都可能导致偶发失败。但盲目重试会把下游打挂，因此需要**指数退避 + 抖动 + 幂等保证**：

```php
<?php

namespace App\Services\Grpc;

use RuntimeException;

final class GrpcRetryPolicy
{
    /**
     * @param callable $rpcCall       gRPC 调用闭包
     * @param int      $maxRetries    最大重试次数（不含首次调用）
     * @param int      $baseDelayMs   基础延迟（毫秒）
     * @param float    $multiplier   退避倍数
     */
    public static function execute(
        callable $rpcCall,
        int $maxRetries = 3,
        int $baseDelayMs = 50,
        float $multiplier = 2.0,
    ): mixed {
        $lastException = null;

        for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
            try {
                return $rpcCall();
            } catch (\RuntimeException $e) {
                $lastException = $e;

                // 只对可重试的错误码进行重试
                if (!self::isRetryable($e)) {
                    throw $e;
                }

                // 如果已经用完重试次数，抛出
                if ($attempt === $maxRetries) {
                    break;
                }

                // 指数退避 + 随机抖动
                $delayMs = (int) ($baseDelayMs * pow($multiplier, $attempt));
                $jitterMs = (int) (random_int(0, $delayMs * 0.3));
                usleep(($delayMs + $jitterMs) * 1000);
            }
        }

        throw $lastException;
    }

    private static function isRetryable(RuntimeException $e): bool
    {
        // 从异常消息中提取 gRPC 状态码（简化示例）
        // 实际项目中建议自定义异常类携带 status code
        $message = $e->getMessage();

        return str_contains($message, 'UNAVAILABLE')
            || str_contains($message, 'DEADLINE_EXCEEDED')
            || str_contains($message, 'RESOURCE_EXHAUSTED')
            || str_contains($message, 'Aborted');
    }
}
```

**调用方式：**

```php
// 应用服务中使用
$scores = GrpcRetryPolicy::execute(
    fn () => $this->grpcReviewClient->batchGetScore($productIds, $locale, $requestId),
    maxRetries: 3,
    baseDelayMs: 50,
);

// Controller 中
$product = GrpcRetryPolicy::execute(
    fn () => $this->productDetailQueryService->handle($productId, $locale, $requestId),
    maxRetries: 2,
);
```

### 重试的三条铁律

1. **只重试幂等操作。** `GetScore` 是只读操作可以重试，`SubmitReview` 写操作如果没有幂等键（如 `idempotency_key`）就不能重试。
2. **只重试暂时性错误。** `UNAVAILABLE`（服务暂时不可用）、`DEADLINE_EXCEEDED`（超时）、`RESOURCE_EXHAUSTED`（限流）可以重试；`INVALID_ARGUMENT`、`NOT_FOUND`、`PERMISSION_DENIED` 不要重试。
3. **退避时间必须加抖动。** 不加抖动的指数退避会导致"惊群效应"——所有客户端在同一时刻重试，把下游再次打挂。随机抖动让重试分散开。

### 重试与 Deadline 的配合

重试会消耗额外时间，必须和 deadline 配合使用。如果请求总预算 120ms，首次调用用了 50ms 超时失败，那重试的 timeout 应该是剩余预算而不是原始 timeout：

```php
// 在 DeadlinePropagationInterceptor 中配合重试
$remainingAfterFirstAttempt = max(20, $totalBudgetMs - $elapsedMs);
$singleTimeout = (int) ($remainingAfterFirstAttempt / ($maxRetries + 1));
```

这样确保所有重试（包括首次）加起来不会超过总预算。

## 七、几个真实踩坑

### 1. proto3 默认值把"没返回"和"返回 0"混在一起
评分接口里 `review_count=0` 是合法值，但字段缺失时 PHP 端同样会读到 0。后来我们对"可空语义"改用包装类型，避免前端把"暂无评价"和"评价数为 0"混掉。

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
我们曾经给 `ScoreItem` 新增了 `rating_text` 字段，同时老版本 BFF 还在按旧字段逻辑渲染。虽然 proto 本身向后兼容，但业务语义不兼容：新服务返回了"无评价"文案，老前端又额外拼了一次，页面出现重复文案。后来我们把规则定死：**proto 兼容只解决反序列化，不解决业务兼容**，灰度时仍然要按版本开关控制。

### 6. Protobuf 版本不匹配：protoc 编译器 vs PHP 运行时库

这是最隐蔽的"环境相关 bug"。现象是：**本地开发正常，CI 全绿，部署到线上偶发 `Invalid argument` 或 `Error parsing response`。**

原因是 `protoc` 编译器版本和 PHP 的 `grpc/grpc` 扩展版本不一致。比如用 `protoc v25.0` 生成的 PHP 代码，跑在 `grpc/grpc v1.54` 上，某些新引入的 wire format（如 `google.protobuf.Timestamp` 的内部编码变化）会导致反序列化失败。

**排查方法：**

```bash
# 检查 protoc 版本
protoc --version
# 输出: libprotoc 25.0

# 检查 PHP grpc 扩展版本
php -r "echo phpversion('grpc');"
# 输出: 1.57.0

# 检查 php protobuf 版本
composer show google/protobuf | grep version
# 输出: v3.25.3
```

**修复策略：**
1. 在 Makefile 中固定 `protoc` 版本（用 Docker 或 `grpc.tools` 包）：
   ```makefile
   # 使用 gRPC 工具链的 Docker 镜像，确保编译环境一致
   PROTOC_IMG=namely/protoc-all:1.51_2

   proto-docker:
   \tdocker run --rm -v $(CURDIR):/workspace $(PROTOC_IMG) \
   \t  --proto_path=/workspace/proto \
   \t  --php_out=/workspace/app/Grpc \
   \t  --grpc_out=/workspace/app/Grpc \
   \t  /workspace/proto/review/v1/review.proto
   ```
2. CI 中验证版本一致性，不匹配则直接报错。
3. 团队约定最小支持的 `protoc` 版本，定期和 PHP 库版本同步升级。

### 7. gRPC 错误码映射不完整，导致监控告警失真

我们最初的 `GrpcStatusMapper` 只映射了 `DEADLINE_EXCEEDED`、`NOT_FOUND`、`UNAVAILABLE` 三个码，其余一律抛 `RuntimeException`（变成 HTTP 500）。结果线上出了两个大问题：

**问题一：`RESOURCE_EXHAUSTED`（限流）没有单独映射。** 下游服务触发了限流，返回 `RESOURCE_EXHAUSTED`，但 BFF 全部转成了 500。告警系统认为是系统错误疯狂报警，而实际上应该返回 `429 Too Many Requests`，并附带 `Retry-After` 头。

**问题二：`INTERNAL` 错误没有区分"内部异常"和"上游 bug"。** 下游开发者把一个参数校验错误写成了 `status.Error(codes.Internal, "xxx")`，BFF 把它当成系统内部错误，返回 500，监控团队花了两天才定位到是参数校验问题。

**最终的完整映射表：**

```php
<?php

final class GrpcStatusMapper
{
    /**
     * gRPC status code → HTTP status code 映射
     */
    private const STATUS_MAP = [
        \Grpc\STATUS_OK                 => 200,
        \Grpc\STATUS_CANCELLED          => 499,
        \Grpc\STATUS_UNKNOWN            => 500,
        \Grpc\STATUS_INVALID_ARGUMENT   => 400,
        \Grpc\STATUS_DEADLINE_EXCEEDED  => 504,
        \Grpc\STATUS_NOT_FOUND          => 404,
        \Grpc\STATUS_ALREADY_EXISTS     => 409,
        \Grpc\STATUS_PERMISSION_DENIED  => 403,
        \Grpc\STATUS_UNAUTHENTICATED    => 401,
        \Grpc\STATUS_RESOURCE_EXHAUSTED => 429,
        \Grpc\STATUS_UNIMPLEMENTED      => 501,
        \Grpc\STATUS_INTERNAL           => 500,
        \Grpc\STATUS_UNAVAILABLE        => 503,
        \Grpc\STATUS_DATA_LOSS          => 500,
    ];

    public static function throwIfNotOk(object $status): void
    {
        if ($status->code === \Grpc\STATUS_OK) {
            return;
        }

        $httpCode = self::STATUS_MAP[$status->code] ?? 500;

        match ($httpCode) {
            429 => throw new RateLimitedException($status->details, $status->code),
            504 => throw new DownstreamTimeoutException($status->details, $status->code),
            404 => throw new ResourceNotFoundException($status->details, $status->code),
            503 => throw new ServiceUnavailableException($status->details, $status->code),
            400 => throw new ValidationException($status->details, $status->code),
            default => throw new GrpcException($status->details, $status->code),
        };
    }

    public static function getHttpCode(int $grpcCode): int
    {
        return self::STATUS_MAP[$grpcCode] ?? 500;
    }
}
```

这样 API 层可以很稳定地输出 HTTP 语义：

- `DeadlineExceeded` -> `504 Gateway Timeout`
- `Unavailable` -> `503 Service Unavailable`
- `NotFound` -> `404`
- `ResourceExhausted` -> `429 Too Many Requests`
- `InvalidArgument` -> `400 Bad Request`
- `Unauthenticated` -> `401 Unauthorized`

如果这一层不做，线上最常见的结果就是所有 gRPC 异常都包装成 500，监控上根本分不清是超时、服务挂了，还是调用参数错了。

### 8. 连接泄漏排查：从现象到根因

连接泄漏在高并发下表现为偶发的 `UNAVAILABLE: TCP connection reset`，低并发下完全正常。**排查步骤：**

```bash
# 1. 查看当前连接数
netstat -an | grep :9501 | wc -l
# 或者用 ss
ss -tn state established | grep :9501 | wc -l

# 2. 监控 worker 进程的文件描述符数
lsof -p $(pgrep -f "php-fpm: pool www") | wc -l

# 3. 在应用中增加连接数 metrics
# app/Http/Middleware/GrpcConnectionMonitor.php
```

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;

class GrpcConnectionMonitor
{
    public function handle($request, Closure $next)
    {
        $response = $next($request);

        // 每 100 个请求打一次连接数指标
        if (random_int(1, 100) === 1) {
            $connections = \count_chars(
                `netstat -an | grep ':9501' | grep ESTABLISHED | wc -l`
            );
            Log::channel('metrics')->info('grpc.connections', [
                'target' => 'review-service:9501',
                'count'  => (int) trim($connections),
            ]);
        }

        return $response;
    }
}
```

## 八、上线前我会检查的清单

- [ ] proto 字段编号未重排，删除字段已 `reserved`
- [ ] protoc 版本与 PHP grpc 扩展版本一致
- [ ] Laravel 端 client 由容器单例管理
- [ ] Channel 参数已配置 keepalive（`grpc.keepalive_time_ms`）
- [ ] 所有 gRPC 调用都带 request-id 与 timeout
- [ ] Deadline 通过 interceptor 自动透传到下游
- [ ] Ingress / Nginx 超时大于应用 deadline
- [ ] 关键状态码已映射成 HTTP 语义（含 `RESOURCE_EXHAUSTED` → 429）
- [ ] 重试策略仅覆盖幂等操作和暂时性错误码
- [ ] access log 能查到 method、code、cost、request-id
- [ ] 灰度阶段新字段受 feature flag 控制
- [ ] 连接数已纳入监控，观察 worker 生命周期内是否持续上涨

## 九、我现在的实践结论

gRPC 不是"性能魔法"，但很适合**内部同步调用、强契约、低延迟链路**。如果 Laravel 团队要接入它，重点别放在生成 stub，而要放在四件事：**proto 演进规范、连接复用、deadline 透传、错误码治理**。这四个问题处理好了，gRPC 才会真正比 REST 更稳，而不只是 benchmark 更好看。

## 相关阅读

- [Domain Events 解耦实战：用事件驱动替代 Service Layer 直接调用](/categories/Architecture-DDD/domain-events-guide-service-layer/)
- [Laravel + gRPC 微服务通信实战](/categories/PHP-Laravel/laravel-grpc-microservicesguide-proto-deadline/)
- [SSE 实战：Server-Sent-Events 在 Laravel 中的应用](/categories/PHP-Laravel/sse-guide-server-sent-events-laravel/)
