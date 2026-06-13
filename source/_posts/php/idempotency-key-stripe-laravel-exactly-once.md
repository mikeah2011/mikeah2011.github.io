---

title: 幂等键 (Idempotency Key) 设计模式实战：Stripe 风格的请求去重——Laravel 中间件实现与分布式缓存的 Exactly-Once
keywords: [Idempotency Key, Stripe, Laravel, Exactly, Once, 幂等键, 设计模式实战, 风格的请求去重, 中间件实现与分布式缓存的]
date: 2026-06-05 09:00:00
tags:
- Idempotency
- Laravel
- 分布式
- API设计
- Redis
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 深入解析 Idempotency Key 设计模式，从 Stripe API 的请求去重机制出发，完整实现 Laravel 幂等键中间件、Redis/MySQL 存储后端、队列集成与测试策略，附生产级代码。
---



## 一、引言：为什么我们需要幂等键

在分布式系统中，网络是不可靠的。客户端发送一个请求后，可能面临以下三种情形：请求成功到达服务端并返回结果；请求根本没到达服务端；请求到达了服务端、服务端也处理了，但响应在网络传输中丢失。第三种情形最为棘手——客户端不知道服务端是否已经处理了自己的请求。

对于读操作（GET 请求），这通常不是问题，重复读取不会产生副作用。但对于写操作——创建订单、发起扣款、转账、发送通知——每一次重复执行都可能造成灾难性的后果。用户在支付页面点击"确认支付"后，如果页面长时间无响应，本能反应是再次点击。移动端 APP 在弱网环境下，SDK 的自动重试机制会在后台默默发出多个相同的请求。负载均衡器的健康检查失败后将流量切换到新节点，而旧节点其实已经成功处理了请求。

这些场景的共同特征是：**同一个业务意图被服务端执行了多次**。我们需要一种机制，能够识别"这是同一个意图的重复表达"，并且在首次执行后将后续相同意图的请求短路返回。

这就是 **Idempotency Key（幂等键）** 设计模式要解决的核心问题。它不是唯一的幂等解决方案（数据库唯一约束、乐观锁等也是常用手段），但它是目前业界最成熟、最通用的客户端-服务端协作方案，尤其适用于面向第三方开发者开放的 API 场景。

幂等键的核心思想可以用一句话概括：**客户端为每次业务意图生成一个唯一标识，服务端通过这个标识判断请求是否已经处理过**。如果处理过，直接返回之前缓存的结果；如果没有处理过，正常执行业务逻辑并缓存结果。整个过程对于客户端来说是透明的——重试请求和首次请求的响应完全一致，客户端无需做任何特殊处理。

这种模式之所以被广泛采用，是因为它完美地平衡了三个设计目标：**安全性**（防止重复执行造成数据不一致）、**简单性**（客户端只需要在请求头中添加一个字段）、**通用性**（适用于任何需要防重的写操作，不依赖于特定的业务逻辑）。接下来，我们将深入剖析 Stripe 的实现细节，然后在 Laravel 中完整复现这一模式。

## 二、Stripe 如何设计 Idempotency-Key

### 2.1 协议约定

Stripe 是 Idempotency Key 模式最早推广并最佳实践的公司。作为全球最大的在线支付基础设施提供商，Stripe 每天处理数以亿计的 API 请求，其中大量请求涉及资金操作。在这样的规模下，即使是极低概率的重复请求也会造成巨大的资金风险。因此，Stripe 在其 API 设计之初就将幂等性作为核心设计原则之一。

在其支付 API 中，所有创建类（POST）请求都支持通过 HTTP Header 传递幂等键：

```http
POST /v1/charges HTTP/1.1
Authorization: Bearer sk_test_xxx
Content-Type: application/x-www-form-urlencoded
Idempotency-Key: dGVzdF9rZXlfMTIz

amount=2000&currency=usd&source=tok_visa
```

这个 `Idempotency-Key` 是一个由客户端生成的唯一字符串，通常使用 UUID v4。Stripe 对键的格式要求非常宽松——只要是一个不超过 255 字符的字符串即可，但强烈建议使用 UUID 以保证唯一性。

### 2.2 服务端处理流程

当 Stripe 服务端收到带有 `Idempotency-Key` 的请求时，会执行如下逻辑：

**第一步：查询键是否存在。** 以幂等键为查询条件，在存储层（Stripe 内部使用的是一个定制的分布式存储系统）查找是否已经有对应的处理记录。

**第二步：如果键存在且已完成，直接返回缓存的响应。** 包括相同的 HTTP 状态码、响应头和响应体。客户端无法分辨这是"重新执行后的新结果"还是"首次执行的缓存结果"——这正是幂等性的精髓。

**第三步：如果键存在但正在处理中（请求仍在 In-Flight），返回 `409 Conflict`。** 这防止了同一时间并发发送相同幂等键的多个请求同时执行业务逻辑。

**第四步：如果键不存在，将键注册为 In-Flight 状态，然后执行业务逻辑。** 业务逻辑执行完毕后，将响应体和状态码一起存储到该键的记录中，并将状态标记为 Completed。

**第五步：设置过期时间。** Stripe 默认保留幂等键记录 24 小时，过期后自动清理。这意味着同一个幂等键在 24 小时内可以安全重试，超过 24 小时后使用同一个键则视为新的请求。

### 2.3 关键设计决策

Stripe 的设计中有几个值得学习的要点：

**只对非幂等方法生效。** GET、HEAD 等天然幂等的 HTTP 方法忽略 `Idempotency-Key`。只有 POST 这类非幂等方法才会触发幂等键的检查逻辑。

**基于请求体的校验。** 如果同一个幂等键被用于不同请求体的请求，Stripe 会返回 `400 Bad Request`，错误信息为"Keys for idempotent requests can only be used with the same parameters they were first used with."这避免了一个键被滥用为"万能通行证"。

**缓存响应的保真度。** 返回的缓存响应完全忠于原始响应，包括 `Request-Id` 头和所有业务字段。这意味着客户端的重试逻辑不需要任何特殊处理。

## 三、幂等键的完整生命周期

理解幂等键的生命周期是实现这一模式的关键。让我们用一个时间线来描述：

```
客户端                    存储层（Redis/MySQL）              服务端业务逻辑
  │                              │                              │
  │── 1. 生成 Key (UUID v4) ──>  │                              │
  │                              │                              │
  │── 2. 发送请求 ──────────────>│                              │
  │    (Header: Idempotency-Key) │── 3. 查询 Key ──────────────>│
  │                              │                              │
  │                              │<── 4. Key 不存在 ────────────│
  │                              │                              │
  │                              │── 5. 写入 Key (状态: LOCKED) │
  │                              │                              │
  │                              │──────── 6. 执行业务逻辑 ────>│
  │                              │                              │
  │                              │<── 7. 业务完成，返回结果 ────│
  │                              │                              │
  │                              │── 8. 更新 Key                │
  │                              │   (状态: COMPLETED,          │
  │                              │    缓存响应体和状态码)        │
  │                              │                              │
  │<── 9. 返回业务响应 ──────────│                              │
  │                              │                              │
  │                              │                              │
  │── 10. 客户端重试（相同Key）──>│                              │
  │                              │── 11. 查询 Key ─────────────>│
  │                              │                              │
  │                              │<── 12. Key 已存在且COMPLETED  │
  │                              │                              │
  │<── 13. 返回缓存的响应 ──────│                              │
```

这个生命周期揭示了三个关键的状态转换：

- **不存在 → LOCKED（锁定）**：首次请求到达时，键被创建并锁定，防止并发重复执行。
- **LOCKED → COMPLETED（完成）**：业务逻辑成功执行后，响应被缓存，键进入终态。
- **COMPLETED → 过期删除**：TTL 到期后，键被自动清理，允许同一键在未来被重新使用（但在实际场景中，客户端通常会生成新键）。

## 四、存储后端选型：Redis vs MySQL

### 4.1 Redis 方案

Redis 是实现幂等键存储的首选后端，原因如下：

**原子性操作。** Redis 的 `SET key value NX EX ttl` 命令可以在一条原子操作中完成"不存在则设置并设置过期时间"的语义，天然适合幂等键的注册流程。

**自动过期。** Redis 的 TTL 机制可以在键到期后自动删除，无需额外的定时清理任务。

**高性能。** 读写延迟在亚毫秒级别，对 API 响应时间的额外开销几乎可以忽略。

**局限性。** Redis 默认使用内存存储，如果数据量极大且需要长期保留幂等键记录，成本会比较高。不过幂等键通常只保留 24 小时，数据量可控。此外，如果 Redis 配置了持久化（RDB/AOF），在故障恢复时可能存在极少量数据丢失的风险。在 Redis 集群模式下，还需要考虑跨节点的数据一致性问题。不过对于幂等键这种短生命周期的数据，主从异步复制的延迟通常在毫秒级别，可以接受。

### 4.2 MySQL 方案

MySQL 作为幂等键存储后端适用于以下场景：需要持久化记录用于审计和对账；已有成熟的 MySQL 基础设施而不想引入额外的 Redis 依赖；需要对幂等键记录做复杂查询（例如统计某段时间内的去重请求数量）。

**劣势。** 相比 Redis，MySQL 的读写延迟高出一到两个数量级。需要额外的定时任务清理过期记录。并发场景下需要依赖数据库行锁或唯一索引来保证原子性。

### 4.3 推荐方案

在实际项目中，**推荐 Redis 作为主存储，MySQL 作为审计日志**。Redis 承担在线的高速查询和锁机制，MySQL 异步记录每次幂等键的使用情况，用于事后对账和问题排查。两者配合使用可以兼顾性能和可靠性。

## 五、Laravel 中间件完整实现

下面我们实现一套生产级的 Idempotency Key 中间件，包含数据库迁移、中间件类和服务提供者注册。

### 5.1 数据库迁移

首先创建幂等键记录表，用于审计日志和 Redis 不可用时的降级查询：

```php
<?php
// database/migrations/2026_06_05_000001_create_idempotency_keys_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->string('key', 255)->unique()->comment('幂等键值');
            $table->string('fingerprint', 64)->comment('请求指纹 (method + uri + body hash)');
            $table->enum('status', ['locked', 'completed', 'failed'])->default('locked');
            $table->smallInteger('status_code')->nullable()->comment('HTTP 响应状态码');
            $table->json('response_body')->nullable()->comment('缓存的响应体');
            $table->json('response_headers')->nullable()->comment('缓存的响应头');
            $table->string('request_fingerprint', 64)->nullable()->comment('请求体 SHA256 指纹');
            $table->timestamp('locked_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('expires_at')->comment('过期时间');
            $table->timestamps();

            $table->index('fingerprint');
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
```

### 5.2 核心中间件

```php
<?php
// app/Http/Middleware/IdempotencyKey.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class IdempotencyKey
{
    /**
     * 幂等键在 Redis 中的前缀
     */
    protected string $redisPrefix = 'idempotency:';

    /**
     * 幂等键默认过期时间（秒），24 小时
     */
    protected int $ttl = 86400;

    /**
     * 需要启用幂等键检查的 HTTP 方法
     */
    protected array $allowedMethods = ['POST', 'PUT', 'PATCH'];

    public function handle(Request $request, Closure $next): Response
    {
        // 仅对指定 HTTP 方法生效
        if (!in_array($request->method(), $this->allowedMethods)) {
            return $next($request);
        }

        $idempotencyKey = $request->header('Idempotency-Key');

        // 如果未提供幂等键，放行请求（不强制要求）
        if (empty($idempotencyKey)) {
            return $next($request);
        }

        // 校验键格式
        if (!$this->validateKey($idempotencyKey)) {
            return response()->json([
                'error' => [
                    'type'    => 'invalid_request_error',
                    'message' => 'Idempotency-Key must be a non-empty string (max 255 chars), preferably UUID.',
                    'param'   => 'Idempotency-Key',
                ],
            ], 400);
        }

        // 计算请求指纹（method + uri + 请求体 hash）
        $fingerprint = $this->computeFingerprint($request);

        // 尝试从 Redis 获取已缓存的结果
        $cached = $this->getCachedResponse($idempotencyKey);

        if ($cached !== null) {
            return $this->handleCachedResponse($cached, $fingerprint, $request);
        }

        // 尝试获取锁（原子操作：SET NX）
        $lockAcquired = $this->acquireLock($idempotencyKey, $fingerprint);

        if (!$lockAcquired) {
            // 锁已被占用：可能是并发请求或正在处理中
            // 等待一小段时间后再次检查
            $cached = $this->waitForCompletion($idempotencyKey, maxWaitMs: 5000);

            if ($cached !== null) {
                return $this->reconstructResponse($cached);
            }

            // 仍然没有结果，说明另一个请求仍在处理中
            return response()->json([
                'error' => [
                    'type'    => 'idempotency_key_in_use',
                    'message' => 'A request with this Idempotency-Key is currently being processed. Please retry after a short delay.',
                ],
            ], 409);
        }

        // 锁获取成功，执行业务逻辑
        try {
            $response = $next($request);

            // 缓存成功响应
            if ($response->isSuccessful()) {
                $this->storeResponse($idempotencyKey, $fingerprint, $response);
            } else {
                // 业务失败不缓存，释放锁以允许重试
                $this->releaseLock($idempotencyKey);
            }

            // 异步写入 MySQL 审计日志
            $this->auditLog($idempotencyKey, $fingerprint, $response);

            return $response;
        } catch (\Throwable $e) {
            // 异常时释放锁，允许重试
            $this->releaseLock($idempotencyKey);
            throw $e;
        }
    }

    /**
     * 校验幂等键格式
     */
    protected function validateKey(string $key): bool
    {
        return strlen($key) > 0 && strlen($key) <= 255;
    }

    /**
     * 计算请求指纹：确保相同幂等键不能用于不同的请求参数
     */
    protected function computeFingerprint(Request $request): string
    {
        $payload = $request->method() . '|' . $request->getRequestUri() . '|'
            . $request->getContent();

        return hash('sha256', $payload);
    }

    /**
     * 从 Redis 获取缓存的响应
     */
    protected function getCachedResponse(string $key): ?array
    {
        try {
            $data = Redis::get($this->redisPrefix . $key);

            return $data ? json_decode($data, true) : null;
        } catch (\Throwable $e) {
            // Redis 不可用时降级到 MySQL
            return $this->getCachedResponseFromDb($key);
        }
    }

    /**
     * 从 MySQL 降级获取缓存响应
     */
    protected function getCachedResponseFromDb(string $key): ?array
    {
        $record = DB::table('idempotency_keys')
            ->where('key', $key)
            ->where('status', 'completed')
            ->where('expires_at', '>', now())
            ->first();

        if (!$record) {
            return null;
        }

        return [
            'status_code'      => $record->status_code,
            'response_body'    => json_decode($record->response_body, true),
            'response_headers' => json_decode($record->response_headers, true),
            'fingerprint'      => $record->fingerprint,
        ];
    }

    /**
     * 处理已缓存的响应：校验请求指纹一致性
     */
    protected function handleCachedResponse(
        array $cached,
        string $currentFingerprint,
        Request $request
    ): Response {
        // 校验：相同幂等键必须对应相同的请求参数
        if ($cached['fingerprint'] !== $currentFingerprint) {
            return response()->json([
                'error' => [
                    'type'    => 'idempotency_key_mismatch',
                    'message' => 'This Idempotency-Key was previously used with different request parameters.',
                    'param'   => 'Idempotency-Key',
                ],
            ], 422);
        }

        // 添加标识头，让客户端知道这是幂等重放
        $response = $this->reconstructResponse($cached);
        $response->headers->set('Idempotent-Replayed', 'true');

        return $response;
    }

    /**
     * 重建响应对象
     */
    protected function reconstructResponse(array $cached): Response
    {
        $response = response()->json(
            $cached['response_body'],
            $cached['status_code']
        );

        if (!empty($cached['response_headers'])) {
            foreach ($cached['response_headers'] as $name => $value) {
                $response->headers->set($name, $value);
            }
        }

        return $response;
    }

    /**
     * 原子获取锁：利用 Redis SET NX
     */
    protected function acquireLock(string $key, string $fingerprint): bool
    {
        try {
            $lockKey = $this->redisPrefix . $key;
            $lockValue = json_encode([
                'fingerprint' => $fingerprint,
                'locked_at'   => now()->toIso8601String(),
            ]);

            // SET key value NX EX ttl —— 原子性的"不存在则设置"
            $result = Redis::set($lockKey, $lockValue, 'EX', $this->ttl, 'NX');

            return $result === true || $result === 'OK';
        } catch (\Throwable $e) {
            // Redis 不可用时降级到 MySQL 行锁
            return $this->acquireLockInDb($key, $fingerprint);
        }
    }

    /**
     * MySQL 降级获取锁（利用唯一索引）
     */
    protected function acquireLockInDb(string $key, string $fingerprint): bool
    {
        try {
            DB::table('idempotency_keys')->insert([
                'key'         => $key,
                'fingerprint' => $fingerprint,
                'status'      => 'locked',
                'locked_at'   => now(),
                'expires_at'  => now()->addSeconds($this->ttl),
                'created_at'  => now(),
                'updated_at'  => now(),
            ]);

            return true;
        } catch (\Illuminate\Database\QueryException $e) {
            // 唯一索引冲突，说明键已存在
            return false;
        }
    }

    /**
     * 将成功响应写入 Redis 缓存
     */
    protected function storeResponse(
        string $key,
        string $fingerprint,
        Response $response
    ): void {
        $cacheData = [
            'status_code'      => $response->getStatusCode(),
            'response_body'    => json_decode($response->getContent(), true),
            'response_headers' => $this->extractCacheableHeaders($response),
            'fingerprint'      => $fingerprint,
        ];

        try {
            Redis::set(
                $this->redisPrefix . $key,
                json_encode($cacheData),
                'EX',
                $this->ttl
            );
        } catch (\Throwable $e) {
            // Redis 写入失败不影响主流程
            logger()->warning('Idempotency key Redis store failed', [
                'key'   => $key,
                'error' => $e->getMessage(),
            ]);
        }

        // 同步更新 MySQL 记录
        DB::table('idempotency_keys')
            ->where('key', $key)
            ->update([
                'status'         => 'completed',
                'status_code'    => $response->getStatusCode(),
                'response_body'  => $response->getContent(),
                'response_headers' => json_encode(
                    $this->extractCacheableHeaders($response)
                ),
                'completed_at' => now(),
                'updated_at'   => now(),
            ]);
    }

    /**
     * 释放锁（业务失败或异常时）
     */
    protected function releaseLock(string $key): void
    {
        try {
            Redis::del($this->redisPrefix . $key);
        } catch (\Throwable $e) {
            logger()->warning('Idempotency key lock release failed', [
                'key' => $key,
            ]);
        }

        DB::table('idempotency_keys')
            ->where('key', $key)
            ->where('status', 'locked')
            ->update([
                'status'     => 'failed',
                'updated_at' => now(),
            ]);
    }

    /**
     * 轮询等待另一个并发请求完成
     */
    protected function waitForCompletion(string $key, int $maxWaitMs = 5000): ?array
    {
        $interval = 100; // 每 100ms 轮询一次
        $elapsed  = 0;

        while ($elapsed < $maxWaitMs) {
            usleep($interval * 1000);
            $elapsed += $interval;

            $cached = $this->getCachedResponse($key);
            if ($cached !== null) {
                return $cached;
            }
        }

        return null;
    }

    /**
     * 提取可缓存的响应头
     */
    protected function extractCacheableHeaders(Response $response): array
    {
        $cacheable = ['Content-Type', 'X-Request-Id'];
        $headers   = [];

        foreach ($cacheable as $name) {
            if ($response->headers->has($name)) {
                $headers[$name] = $response->headers->get($name);
            }
        }

        return $headers;
    }

    /**
     * 异步写入审计日志
     */
    protected function auditLog(
        string $key,
        string $fingerprint,
        Response $response
    ): void {
        dispatch(function () use ($key, $fingerprint, $response) {
            DB::table('idempotency_keys')->updateOr(
                ['key' => $key],
                [
                    'key'              => $key,
                    'fingerprint'      => $fingerprint,
                    'status'           => $response->isSuccessful() ? 'completed' : 'failed',
                    'status_code'      => $response->getStatusCode(),
                    'response_body'    => $response->getContent(),
                    'response_headers' => json_encode(
                        $this->extractCacheableHeaders($response)
                    ),
                    'expires_at'  => now()->addSeconds($this->ttl),
                    'created_at'  => now(),
                    'updated_at'  => now(),
                ]
            );
        })->afterCommit();
    }
}
```

### 5.3 服务提供者注册

```php
<?php
// app/Providers/IdempotencyServiceProvider.php

namespace App\Providers;

use App\Http\Middleware\IdempotencyKey;
use Illuminate\Support\ServiceProvider;

class IdempotencyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(IdempotencyKey::class, function ($app) {
            return new IdempotencyKey();
        });
    }

    public function boot(): void
    {
        // 将中间件注册到 HTTP Kernel
        $kernel = $this->app->make(\Illuminate\Contracts\Http\Kernel::class);

        $kernel->pushMiddlewareToGroup('api', IdempotencyKey::class);
    }
}
```

### 5.4 路由配置

在 `routes/api.php` 中使用中间件：

```php
<?php
// routes/api.php

use App\Http\Controllers\OrderController;
use App\Http\Controllers\PaymentController;
use Illuminate\Support\Facades\Route;

// 支付创建——必须有幂等键保护
Route::post('/payments', [PaymentController::class, 'store'])
    ->middleware('idempotency');

// 订单创建——必须有幂等键保护
Route::post('/orders', [OrderController::class, 'store'])
    ->middleware('idempotency');
```

在 `app/Http/Kernel.php` 中注册中间件别名：

```php
// app/Http/Kernel.php

protected $middlewareAliases = [
    // ... 其他中间件
    'idempotency' => \App\Http\Middleware\IdempotencyKey::class,
];
```

## 六、边界情况与陷阱

### 6.1 键过期后的重复风险

幂等键有 TTL 限制（Stripe 默认 24 小时）。如果客户端在键过期后使用同一个键重试，会被当作全新请求处理。在支付场景中，这意味着可能产生重复扣款。解决方案是：客户端每次发起独立请求时都应生成新的幂等键，幂等键仅用于单次请求的自动重试，而非跨会话的去重。

### 6.2 部分失败与一致性

当业务逻辑执行到一半失败时（例如：扣款成功但库存扣减失败），需要特别注意幂等键的状态处理。**不应该缓存失败的响应**，因为同一请求重试可能成功（例如库存已经补充）。中间件中对非成功响应释放锁的设计正是为了处理这种情况。

但这也引入了一个微妙的问题：如果客户端重试时，服务端重新执行了业务逻辑，但这次的执行路径和第一次部分执行后的系统状态已经不同了。因此，**业务逻辑本身也需要具备幂等性**（例如使用数据库唯一约束防止重复扣款），幂等键和业务层幂等应该是互补关系，而非替代关系。

### 6.3 并发请求的竞争条件

当两个携带相同幂等键的请求几乎同时到达时，需要依赖 Redis 的 `SET NX` 原子操作或 MySQL 的唯一索引来保证只有一个请求能获取锁。另一个请求会收到 `409 Conflict` 响应或等待第一个请求完成后获取缓存结果。

在 Redis 方案中，`SET key value NX EX ttl` 命令在 Redis 内部是单线程串行执行的，天然保证了原子性。在 MySQL 方案中，唯一索引的插入冲突机制保证了相同键不会被写入两次。两种方案都能有效防止并发重复执行。

### 6.4 请求体过大的存储问题

当缓存响应体较大时（例如返回了包含大量数据的 JSON），需要考虑存储成本。可以在存储前对响应体进行 gzip 压缩，或者只缓存关键字段而非完整响应体。在 Redis 方案中，大 value 会占用更多内存并增加网络传输延迟。

### 6.5 跨服务的幂等键传播

在微服务架构中，如果服务 A 接收请求后需要调用服务 B，幂等键需要从 A 传播到 B。推荐的做法是将原始的 `Idempotency-Key` 作为参数传递给下游服务，由每个服务独立维护自己的幂等状态。也可以建立一个中心化的幂等键服务，但会引入额外的网络调用和单点风险。

## 七、与 Laravel Queue 集成

在异步场景中，幂等键的作用延伸到了队列消息的处理。当一个 API 请求触发了队列任务时，幂等键可以作为任务的唯一标识，防止任务被重复派发。

```php
<?php
// app/Jobs/ProcessPayment.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class ProcessPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 60;

    public function __construct(
        public readonly string $orderId,
        public readonly string $idempotencyKey,
        public readonly int $amount,
    ) {}

    public function handle(): void
    {
        $lockKey = "payment_job:{$this->idempotencyKey}";

        // 利用 Redis SET NX 保证同一幂等键的任务只执行一次
        $acquired = Redis::set($lockKey, '1', 'EX', 3600, 'NX');

        if (!$acquired) {
            // 任务已执行或正在执行，跳过
            logger()->info('Payment job already processed', [
                'idempotency_key' => $this->idempotencyKey,
                'order_id'        => $this->orderId,
            ]);
            return;
        }

        try {
            // 执行支付逻辑
            DB::transaction(function () {
                // ... 实际的支付处理逻辑
            });
        } catch (\Throwable $e) {
            // 失败时释放锁，允许重试
            Redis::del($lockKey);
            throw $e;
        }
    }
}
```

在控制器中，将幂等键传递给队列任务：

```php
<?php
// app/Http/Controllers/PaymentController.php

namespace App\Http\Controllers;

use App\Jobs\ProcessPayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'order_id' => 'required|string',
            'amount'   => 'required|integer|min:1',
        ]);

        $idempotencyKey = $request->header('Idempotency-Key');

        // 派发异步任务，携带幂等键
        ProcessPayment::dispatch(
            orderId: $validated['order_id'],
            idempotencyKey: $idempotencyKey,
            amount: $validated['amount'],
        );

        return response()->json([
            'status'  => 'processing',
            'message' => 'Payment is being processed.',
            'order_id' => $validated['order_id'],
        ], 202);
    }
}
```

这种设计确保了：即使客户端重试请求，幂等键中间件会返回缓存的 `202 Accepted` 响应而不会重复派发任务；即使队列消息被重复投递，任务内部的 Redis 锁会防止重复执行。

## 八、测试策略

幂等性行为必须有充分的测试覆盖，因为它的正确性直接关系到资金安全。一个幂等逻辑的缺陷可能在开发阶段和测试环境中完全不被发现——因为它只在"网络超时后客户端重试"这种特定时序下才会触发。到了生产环境，当并发量上来之后，这个缺陷就会暴露出来，造成真正的资金损失。因此，幂等相关的测试用例应该是回归测试套件中的核心部分，每次代码变更都必须通过。

以下是推荐的测试用例，覆盖了幂等键生命周期中的所有关键路径：

```php
<?php
// tests/Feature/IdempotencyKeyTest.php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class IdempotencyKeyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Redis::flushdb();
    }

    /** @test */
    public function it_returns_cached_response_for_duplicate_idempotency_key(): void
    {
        $key = 'test-key-' . uniqid();
        $payload = ['amount' => 1000, 'currency' => 'CNY'];

        // 第一次请求
        $response1 = $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/payments', $payload);

        $response1->assertStatus(201);
        $body1 = $response1->json();

        // 第二次请求（相同幂等键和相同参数）
        $response2 = $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/payments', $payload);

        $response2->assertStatus(201);
        $response2->assertHeader('Idempotent-Replayed', 'true');

        // 响应体应完全一致
        $this->assertEquals($body1, $response2->json());
    }

    /** @test */
    public function it_rejects_same_key_with_different_parameters(): void
    {
        $key = 'test-key-' . uniqid();

        $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/payments', ['amount' => 1000, 'currency' => 'CNY'])
            ->assertStatus(201);

        // 相同键但不同参数
        $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/payments', ['amount' => 2000, 'currency' => 'USD'])
            ->assertStatus(422)
            ->assertJsonPath('error.type', 'idempotency_key_mismatch');
    }

    /** @test */
    public function it_handles_concurrent_requests_with_same_key(): void
    {
        $key = 'test-key-' . uniqid();
        $payload = ['amount' => 1000, 'currency' => 'CNY'];

        // 模拟并发请求
        $responses = [];
        for ($i = 0; $i < 5; $i++) {
            $responses[] = $this->withHeader('Idempotency-Key', $key)
                ->postJson('/api/payments', $payload);
        }

        // 只有一个请求应该返回 201，其余应该返回 201（缓存）或 409
        $statusCodes = array_map(
            fn($r) => $r->getStatusCode(),
            $responses
        );

        $successCount = count(array_filter($statusCodes, fn($s) => $s === 201));
        $conflictCount = count(array_filter($statusCodes, fn($s) => $s === 409));

        // 至少有一个成功，总数应等于请求数
        $this->assertGreaterThanOrEqual(1, $successCount);
        $this->assertEquals(5, $successCount + $conflictCount);
    }

    /** @test */
    public function it_allows_request_without_idempotency_key(): void
    {
        $this->postJson('/api/payments', [
            'amount'   => 1000,
            'currency' => 'CNY',
        ])->assertStatus(201);
    }

    /** @test */
    public function it_returns_400_for_invalid_key_format(): void
    {
        // 空字符串
        $this->withHeader('Idempotency-Key', '')
            ->postJson('/api/payments', ['amount' => 1000])
            ->assertStatus(400);

        // 超长字符串
        $this->withHeader('Idempotency-Key', str_repeat('a', 256))
            ->postJson('/api/payments', ['amount' => 1000])
            ->assertStatus(400);
    }

    /** @test */
    public function it_does_not_cache_failed_responses(): void
    {
        $key = 'test-key-' . uniqid();

        // 第一次请求：业务失败（例如金额为负数）
        $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/payments', ['amount' => -100])
            ->assertStatus(422);

        // 第二次请求：相同键但参数合法，应正常处理而非返回缓存的失败
        $this->withHeader('Idempotency-Key', $key)
            ->postJson('/api/payments', ['amount' => 1000])
            ->assertStatus(201);
    }
}
```

以上测试覆盖了六个关键场景：正常重放、参数不一致拒绝、并发竞争、无键放行、无效键格式、失败不缓存。建议将这些测试纳入 CI 流水线的核心检查集，确保幂等逻辑在每次代码变更后都不会退化。

## 九、超越支付：幂等键的更多应用场景

### 9.1 Webhook 投递

当你向第三方服务发送 Webhook 通知时，网络超时可能导致你不确定对方是否收到。此时你面临两难选择：不重试则通知可能丢失，重试则可能导致接收方重复处理。通过在 Webhook 请求中附带幂等键（通常使用事件 ID），接收方可以安全地重试处理而不会产生副作用。Stripe 自己的 Webhook 通知就采用了这种机制——每个事件都有唯一的 `Event ID`，接收端应以此为幂等键去重。在实际开发中，我们经常看到开发者忽略这一点，简单地用数据库查询来判断"是否已处理"，但在高并发场景下，两个相同的 Webhook 可能同时通过查询检查。正确做法是使用数据库的唯一约束或分布式锁来实现原子性的"查询加写入"操作。

### 9.2 消息通知发送

短信、邮件、推送通知是典型的"发出去就收不回来"的操作。用户在注册流程中点击"发送验证码"按钮时，弱网环境下可能触发多次请求。用幂等键绑定用户手机号和验证码类型，可以确保短时间内只发送一条短信。

### 9.3 库存操作

在电商场景中，"扣减库存"和"释放库存"操作都需要幂等保护。如果扣库存的请求被重试，可能导致库存被多扣。通过幂等键（通常使用订单号加操作类型）来标识每次库存变动，可以安全地处理重试。

### 9.4 事件溯源（Event Sourcing）

在事件溯源架构中，每个事件都应有全局唯一的事件 ID。当事件被重复投递时，消费端通过事件 ID 去重，确保每个事件只被处理一次。这本质上就是幂等键模式在事件驱动架构中的应用。

### 9.5 分布式事务中的补偿操作

在微服务架构中，跨服务的分布式事务通常采用 Saga 模式来实现最终一致性。Saga 中的每个步骤都可能失败，失败后需要执行补偿操作来回滚已完成的步骤。这些补偿操作本身也需要幂等保护——如果补偿请求因为网络问题被重试，不应该导致补偿逻辑被重复执行。使用幂等键标识每个 Saga 实例的操作和补偿，可以确保整个分布式事务的正确性。

## 十、总结与最佳实践

幂等键是一种简单但强大的设计模式，它将"请求意图的唯一标识"从隐含在业务数据中提升为一等公民，使得客户端和服务端能够在不可靠的网络环境中就"这是同一个请求"达成共识。与数据库唯一约束、乐观锁等底层机制不同，幂等键是一种应用层的协作协议，它不要求客户端了解服务端的数据模型，只需要遵循一个简单的"传递唯一标识"的约定即可。

在实际落地时，请牢记以下最佳实践：

**客户端侧：** 使用 UUID v4 生成幂等键；每次独立的业务操作都使用新的幂等键；幂等键仅用于单次请求的自动重试，不用于跨会话去重。

**服务端侧：** 使用 `SET NX EX` 原子操作注册键，避免竞争条件；只缓存成功的响应，失败响应允许重试；校验相同键对应的请求参数一致性；设置合理的 TTL（推荐 24 小时）；添加 `Idempotent-Replayed` 响应头，让客户端知道这是缓存结果。

**架构层面：** Redis 作为主存储，MySQL 作为审计日志；幂等键和业务层幂等应互补使用；在微服务间传播幂等键；队列任务也需要携带幂等键做消费端去重。

最终，幂等键解决的核心问题是"在不可靠的网络上可靠地表达业务意图"。它不是一个银弹，但当你正确实现它时，它能让你的系统在面对网络故障、超时重试和用户误操作时保持数据一致性，这在支付、订单、库存等关键业务中是不可妥协的基本要求。

## 相关阅读

- [订单提交防重不是加唯一索引：Laravel 用 Idempotency-Key 做创建接口结果回放的实战记录](/php/Laravel/index-laravel-idempotency-key/)
- [Laravel + Stripe + AliPay 双通道支付实现：回调处理、幂等性、重试机制](/php/Laravel/laravel-stripe-alipay-guide/)
- [Laravel 幂等性设计模式实战：请求去重、支付回调防重复、队列消息 Exactly-Once](/05_PHP/Laravel/Laravel-幂等性设计模式实战-请求去重-支付回调防重复-Exactly-Once/)
