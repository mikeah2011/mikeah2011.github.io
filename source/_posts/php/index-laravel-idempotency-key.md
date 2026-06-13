---

title: 订单提交防重不是加唯一索引：Laravel 用 Idempotency-Key 做创建接口结果回放的实战记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:46:04
updated: 2026-05-03 09:48:49
categories:
  - php
keywords: [Laravel, Idempotency, Key, 订单提交防重不是加唯一索引, 做创建接口结果回放的实战记录]
tags:
- Laravel
- MySQL
- 幂等
- API
- Idempotency
- 分布式
- 重试机制
description: 结合 Laravel 订单创建接口的真实经验，深入记录一套用 Idempotency-Key、请求指纹、结果回放与状态机保护实现 API 幂等性的落地方案。覆盖唯一索引、Redis 分布式锁与 Idempotency-Key 三种防重方案的优劣对比，附带完整 Migration、中间件、Service 层代码示例与线上踩坑记录，适合面临重复提交、重试风暴等分布式一致难题的后端工程师参考。
---


移动端弱网下，`POST /api/orders` 最容易出事：用户点一次“提交订单”，客户端因为超时自动重试一次，网关也可能补发一次，最后数据库里落了两张单。很多团队第一反应是“加唯一索引”，但我在线上踩过几次坑后发现，**唯一索引只能防止部分重复写，解决不了客户端到底该拿到哪一次响应**。

我们最后在 Laravel 里落地的是一套四段式方案：**Idempotency-Key 标识一次业务意图，请求指纹校验参数一致性，数据库记录回放响应，订单状态机兜底防误更新。** 这样客户端即使重试三次，也只会创建一张订单，而且拿到的是第一次成功写入后的同一份响应。

## 一、最终落地架构

```text
Client/App
   |
   | POST /api/orders + Idempotency-Key
   v
Nginx / Gateway
   |
   v
Laravel Middleware -----------------------------+
   |                                            |
   | 1. 按 user_id + key 查 api_idempotency_records |
   | 2. 比对 request_hash                        |
   | 3. 命中已完成记录则直接回放响应              |
   v                                            |
OrderService (DB Transaction)                   |
   |                                            |
   | create orders / order_items                |
   | update idempotency record = done           |
   v                                            |
MySQL <-----------------------------------------+
```

这里最关键的是：**幂等记录表不是日志表，而是 API 协议的一部分。** 它必须能表达 `processing / done / failed` 三种状态，否则你根本没法区分“正在处理中的重试”和“已经成功的重试”。

## 二、三种防重方案怎么选？一张表说清楚

很多团队遇到防重需求时，会在「唯一索引」「Redis 分布式锁」「Idempotency-Key」三种方案之间摇摆。下面这张表把核心差异列清楚，帮你快速决策：

| 维度 | 唯一索引 | Redis 分布式锁 | Idempotency-Key + 结果回放 |
|------|---------|---------------|--------------------------|
| **实现成本** | 低，一个 `UNIQUE` 约束 | 中，需要 Redis + Lua 脚本 | 中高，中间件 + 状态表 + 响应持久化 |
| **防重粒度** | 字段级（如 `client_order_no`） | 请求级（key → 单实例锁定） | 业务意图级（同一 key 无论谁调都回放同一结果） |
| **返回已成功响应** | ❌ 只能拒绝，无法回放 | ❌ 拒绝后客户端需自行处理 | ✅ 命中 `done` 状态直接回放第一次的响应体 |
| **参数校验** | ❌ 无法检测 payload 是否一致 | ❌ 无法检测 payload 是否一致 | ✅ `request_hash` 对比，不一致返回 409 |
| **并发安全** | 依赖数据库行锁 | 依赖 Redis SET NX 原子性 | 依赖数据库唯一约束 + 事务 `firstOrCreate` |
| **跨服务适用** | ✅ 只要连同一个数据库 | ⚠️ 需要共享 Redis 实例 | ✅ 数据库即可，天然跨服务 |
| **推荐场景** | 最后兜底防线 | 短时互斥（秒杀/定时任务防重） | 支付、订单等需要「结果回放」的写接口 |

> **结论：** 三者不是互斥关系，而是纵深防护。生产环境建议三层都用——Redis 锁做入口拦截、Idempotency-Key 做结果回放、唯一索引做最后兜底。下文聚焦 Idempotency-Key 这一层的完整落地。

## 三、表结构先定好，不然后面全是补丁

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('api_idempotency_records', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('idempotency_key', 64);
            $table->string('request_hash', 64);
            $table->string('state', 16)->default('processing');
            $table->unsignedSmallInteger('status_code')->nullable();
            $table->json('response_body')->nullable();
            $table->string('resource_type', 32)->nullable();
            $table->unsignedBigInteger('resource_id')->nullable();
            $table->timestamp('expired_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'idempotency_key'], 'uniq_user_key');
            $table->index(['user_id', 'created_at']);
        });
    }
};
```

我一开始只存 `key` 和 `response_body`，很快就翻车：同一个 key 被客户端错误复用到不同 payload，系统却把旧结果直接回给新请求。后来补上 `request_hash` 后，才能对外明确返回 `409 Conflict`，告诉调用方“这个 key 已经绑定过另一份请求”。

## 四、中间件做“拦截 + 回放”，业务层只管创建订单

```php
<?php

namespace App\Http\Middleware;

use App\Models\ApiIdempotencyRecord;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

class EnsureIdempotentRequest
{
    public function handle(Request $request, Closure $next): mixed
    {
        $key = (string) $request->header('Idempotency-Key');
        abort_if($key === '', 400, 'Missing Idempotency-Key');

        $userId = (int) $request->user()->id;
        $payload = Arr::sortRecursive($request->except(['timestamp', 'trace_id']));
        $hash = hash('sha256', $request->method().'|'.$request->path().'|'.json_encode($payload));

        $record = DB::transaction(function () use ($userId, $key, $hash) {
            return ApiIdempotencyRecord::query()->firstOrCreate(
                ['user_id' => $userId, 'idempotency_key' => $key],
                ['request_hash' => $hash, 'state' => 'processing', 'expired_at' => now()->addHours(24)]
            );
        });

        if ($record->request_hash !== $hash) {
            return response()->json(['message' => 'Idempotency-Key payload mismatch'], 409);
        }

        if ($record->state === 'done') {
            return new JsonResponse(
                json_decode($record->response_body, true),
                $record->status_code
            );
        }

        $request->attributes->set('idempotency_record_id', $record->id);

        return $next($request);
    }
}
```

这段代码故意不在中间件里创建订单，只负责三件事：抢占 key、校验 hash、命中时回放响应。**幂等控制要靠近入口，订单创建仍然放在 Service 里跑事务**，职责才不会乱。

## 五、成功响应要持久化，否则“防重”只做了一半

```php
<?php

namespace App\Services;

use App\Models\ApiIdempotencyRecord;
use App\Models\Order;
use Illuminate\Support\Facades\DB;

class CreateOrderService
{
    public function handle(array $data, int $userId, int $recordId): array
    {
        return DB::transaction(function () use ($data, $userId, $recordId) {
            $order = Order::query()->create([
                'user_id' => $userId,
                'status' => 'pending',
                'total_amount' => $data['total_amount'],
                'client_order_no' => $data['client_order_no'],
            ]);

            foreach ($data['items'] as $item) {
                $order->items()->create([
                    'sku_id' => $item['sku_id'],
                    'qty' => $item['qty'],
                    'price' => $item['price'],
                ]);
            }

            $response = [
                'order_id' => $order->id,
                'status' => $order->status,
                'total_amount' => $order->total_amount,
            ];

            ApiIdempotencyRecord::query()
                ->whereKey($recordId)
                ->update([
                    'state' => 'done',
                    'status_code' => 201,
                    'resource_type' => 'order',
                    'resource_id' => $order->id,
                    'response_body' => json_encode($response, JSON_UNESCAPED_UNICODE),
                ]);

            return $response;
        });
    }
}
```

为什么我现在坚持“把响应体存下来”？因为以前只存 `resource_id`，重试时再查订单重新拼响应。后来订单上挂了优惠、汇率、活动标签，第二次查询拿到的是新计算结果，客户端以为两次请求返回不一致，又继续重试，事故就滚大了。**幂等回放要回放第一次成功时的结果，而不是当前最新状态。**

## 六、控制器只透传上下文，不在这里写防重逻辑

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\CreateOrderRequest;
use App\Services\CreateOrderService;
use Illuminate\Http\JsonResponse;

class OrderController extends Controller
{
    public function store(CreateOrderRequest $request, CreateOrderService $service): JsonResponse
    {
        $result = $service->handle(
            data: $request->validated(),
            userId: (int) $request->user()->id,
            recordId: (int) $request->attributes->get('idempotency_record_id')
        );

        return response()->json($result, 201);
    }
}
```

这个分层很重要。我见过不少项目把“查 key、落表、回放响应、创建订单”全塞进 Controller，最后每个创建型接口都复制一遍。后来只要接入退款申请、地址簿创建、优惠券领取，重复代码就失控。**中间件负责协议层，Service 负责业务层，Controller 只负责组装输入输出**，后续扩展才轻松。

## 七、并发压测下真正要验证什么

很多人以为“本地点两次没重复”就算完成了，但线上最可怕的是并发同 key 命中。我们当时用 Pest 做了一个最小回归，至少保证两个并发请求不会生成两张订单。

```php
<?php

it('replays same response for duplicated idempotent requests', function () {
    $user = User::factory()->create();
    $payload = [
        'client_order_no' => 'APP-20260503-9001',
        'total_amount' => 1200,
        'items' => [
            ['sku_id' => 101, 'qty' => 1, 'price' => 1200],
        ],
    ];

    $headers = ['Idempotency-Key' => 'idem-order-9001'];

    $first = $this->actingAs($user)->postJson('/api/orders', $payload, $headers);
    $second = $this->actingAs($user)->postJson('/api/orders', $payload, $headers);

    $first->assertCreated();
    $second->assertCreated();
    expect($second->json('order_id'))->toBe($first->json('order_id'));
    $this->assertDatabaseCount('orders', 1);
});
```

当然，这个测试只是回归，不是真正的高并发压测。生产上我还会额外观察两类指标：

1. `api_idempotency_records.state=processing` 的滞留数量。
2. 相同 `idempotency_key` 的 409 冲突比例。

前者高，说明事务或下游依赖有卡顿；后者突然高，通常是客户端错误复用了 key。

## 八、三个最容易忽略的坑

### 1）不要把随机字段算进指纹
移动端每次都带 `timestamp`、`nonce`，如果直接 hash 整个 body，所有重试都会被判成新请求。我现在会先剔除这些传输噪音字段，再做稳定排序。

### 2）`processing` 不能无限挂着
线上最常见的脏数据不是 `done`，而是业务抛异常后遗留的 `processing`。我的处理方式是：事务异常时把记录改成 `failed`，定时任务清理 24 小时前的旧 key；如果同 key 命中 `failed`，允许客户端换新 key 重试，不要强卡死。

### 3）唯一索引仍然要有，但它只是最后防线
`Idempotency-Key` 解决的是协议层重复提交，业务层仍然建议给 `client_order_no` 或外部请求号加唯一约束。前者防“同一次请求重放”，后者防“调用方根本没按协议来”。两层都要有，别二选一。

## 九、一次线上故障后的补丁记录

我们真的出过一次事故：APP 侧把 `Idempotency-Key` 生成为“当前秒级时间戳 + user_id”，结果同一个用户在 1 秒内连续提交两个不同商品，第二单被错误回放成第一单结果。那次之后我改了三件事：

- Key 必须由客户端按“业务动作唯一值”生成，不能只靠时间戳。
- 服务端强制校验 `request_hash`，不一致直接 409。
- 后台加检索页，能按 `idempotency_key`、`resource_id`、`user_id` 反查整条链路。

这类问题最坑的地方在于：数据库里看起来“没有重复数据”，但业务上已经把错误结果返回给用户了。所以我现在判断幂等是否做好，不只看有没有重复订单，还要看**重复请求是否拿到一致且正确的响应**。

## 十、我对 API 幂等性的落地结论

如果接口会被客户端自动重试、网关补发，或者用户真的会连点提交，那幂等性就不该只靠“代码里 if 一下”。更稳的做法是：**入口拦截、事务落库、结果回放、状态兜底**。这套方案在 Laravel 里并不复杂，难的是一开始就把 `request_hash`、`processing` 状态和响应持久化这些细节想清楚。真正上线后，你会发现它省下的不是一两条重复数据，而是一整套支付、库存、通知链路的连锁事故。

---

## 相关阅读

- [Idempotency Key 深度实战：API 幂等性的三层防护——请求去重、结果缓存与分布式锁的工程化方案](/2026/06/06/Idempotency-Key-深度实战-API幂等性的三层防护/) — 同一主题的进阶篇，横向对比 Stripe 与支付宝幂等策略，覆盖 Redis Lua 原子锁与并发竞态处理。
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd——PHP 开发者的分布式互斥选型](/2026/06/05/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/) — 如果你的防重需求偏向「短时互斥」而非「结果回放」，这篇文章对比了三大分布式锁方案的性能与一致性。
- [订单状态机实战：用 Laravel + XState 实现复杂订单流转——可视化状态图与事件驱动](/2026/06/02/订单状态机实战-用Laravel-XState实现复杂订单流转-可视化状态图与事件驱动/) — 本文提到用状态机兜底防误更新，这篇文章深入讲解 Laravel 订单状态机的完整实现与并发控制。