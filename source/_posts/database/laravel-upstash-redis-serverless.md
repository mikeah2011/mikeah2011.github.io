---
title: Laravel + Upstash Redis 实战：Serverless Redis 替代方案——无连接池、按请求计费与边缘部署
keywords: [Laravel, Upstash Redis, Serverless Redis, 替代方案, 无连接池, 按请求计费与边缘部署, 数据库]
date: 2026-06-09 09:52:00
categories:
  - database
tags:
  - Laravel
  - Redis
  - Upstash
  - Serverless
  - 边缘计算
description: 深入实战 Upstash Redis 在 Laravel 项目中的应用，涵盖无连接池架构、按请求计费模型、边缘部署策略，以及与传统 Redis 方案的完整对比。
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
---


## 概述

传统 Redis 部署需要维护连接池、管理服务器实例、预估容量。对于 Serverless 架构（AWS Lambda、Vercel Functions、Cloudflare Workers）来说，连接池本身就是个悖论——你没有持久进程来维护连接。

Upstash Redis 提供了一种完全不同的思路：**HTTP-based Redis**。每次操作都是独立的 HTTP 请求，没有连接池概念，按请求次数计费，天然适配 Serverless 和边缘计算场景。

本文用 Laravel 项目做实战，从接入、配置、性能优化到踩坑记录，完整走一遍。

### 为什么选 Upstash？

| 维度 | 传统 Redis | Upstash Redis |
|------|-----------|---------------|
| 连接模型 | TCP 长连接 + 连接池 | HTTP 请求/响应 |
| 计费方式 | 按实例规格（固定成本） | 按请求数量（按需付费） |
| Serverless 兼容 | 需要代理（如 Supabase Pooler） | 原生支持 |
| 边缘部署 | 需要跨区域复制 | 内置全球复制 |
| 运维成本 | 高（主从、哨兵、持久化） | 零（托管服务） |
| 延迟 | <1ms（本地） | 5-50ms（取决于区域） |

**适用场景**：Serverless 函数、边缘计算、小型项目快速启动、开发/测试环境、低流量但需要 Redis 特性的应用。

**不适用**：高吞吐量场景（>100K QPS）、毫秒级延迟要求、大量 Lua 脚本执行。

## 核心概念

### Upstash 的架构设计

Upstash 不是「Redis over HTTP 的简单包装」，它做了几个关键设计决策：

**1. REST API 而非 RESP 协议**

传统 Redis 用 RESP（REdis Serialization Protocol），基于 TCP 流。Upstash 用 RESTful HTTP，每个命令是一个独立请求：

```
POST https://your-instance.upstash.io/set/mykey
Authorization: Bearer <token>
Body: "myvalue"
```

好处是无需管理连接状态，坏处是每个请求都有 HTTP 开销（约 2-5ms）。

**2. 按请求计费模型**

Upstash 的定价很直观：
- 每天前 10,000 请求免费
- 超出部分按 $0.2/100K 请求计费
- 存储按 $0.25/GB/月

对于一个日活 1000 的小型应用，每天约 50K-100K 请求，月成本大约 $3-5。

**3. 区域部署与全球复制**

Upstash 在 AWS、GCP 多区域部署，支持 Global Database 模式——写入一个区域，自动复制到其他区域。边缘函数读取最近的副本，延迟可控。

### Laravel 中的 Redis 抽象层

Laravel 的 Redis 层基于 `predis/predis` 或 `phpredis` 扩展，底层走 TCP。要接入 Upstash，有两条路：

- **方案 A**：用 Upstash 提供的 Redis REST SDK（不走 Laravel Redis 层）
- **方案 B**：用 Upstash 的 Redis-compatible TCP endpoint（兼容 `predis`）

推荐方案 B，因为可以直接复用 Laravel 的 `Redis` Facade 和 Cache/Session 驱动。

## 实战代码

### 1. 创建 Upstash 实例

去 [Upstash Console](https://console.upstash.com/) 创建 Redis 数据库：

1. 选择区域（建议 `ap-southeast-1` 新加坡，离中国大陆较近）
2. 选择 `Pay as You Go` 计费模式
3. 创建完成后拿到连接信息：
   - `UPSTASH_REDIS_REST_URL`（REST API 端点）
   - `UPSTASH_REDIS_REST_TOKEN`（REST Token）
   - `UPSTASH_REDIS_TCP_HOST` + `UPSTASH_REDIS_TCP_PORT` + `UPSTASH_REDIS_TCP_PASSWORD`（TCP 兼容端点）

### 2. Laravel 配置

```bash
# 安装 predis（Upstash TCP 端点兼容 RESP 协议）
composer require predis/predis
```

`.env` 配置：

```env
REDIS_CLIENT=predis

# Upstash TCP 端点
REDIS_HOST=tcp://your-redis-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-upstash-password
REDIS_SCHEME=tls

# 或使用完整 DSN
REDIS_URL=tls://default:your-password@your-redis-host.upstash.io:6379
```

`config/database.php` 中 Redis 配置：

```php
'redis' => [

    'client' => env('REDIS_CLIENT', 'predis'),

    'options' => [
        'parameters' => [
            'scheme'   => 'tls',
            'ssl'      => ['verify_peer' => false],
        ],
        // Upstash 需要这个——禁用连接持久化
        'persistent' => 0,
    ],

    'default' => [
        'url'      => env('REDIS_URL'),
        'host'     => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port'     => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
        'scheme'   => env('REDIS_SCHEME', 'tls'),
    ],

    'cache' => [
        'url'      => env('REDIS_URL'),
        'host'     => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port'     => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_CACHE_DB', '1'),
        'scheme'   => env('REDIS_SCHEME', 'tls'),
    ],

],
```

### 3. 封装 Upstash REST SDK（可选，边缘场景）

如果跑在 Cloudflare Workers 或 Vercel Edge Functions 上，TCP 不可用，需要走 REST API：

```bash
composer require upstash/redis-php
```

创建 Service Provider：

```php
<?php
// app/Providers/UpstashRedisServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Upstash\Redis\Redis as UpstashRedis;

class UpstashRedisServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(UpstashRedis::class, function () {
            return new UpstashRedis(
                url:   env('UPSTASH_REDIS_REST_URL'),
                token: env('UPSTASH_REDIS_REST_TOKEN'),
            );
        });

        // 别名方便注入
        $this->app->alias(UpstashRedis::class, 'upstash-redis');
    }
}
```

使用示例：

```php
<?php

use Upstash\Redis\Redis as UpstashRedis;

class CacheService
{
    public function __construct(
        private readonly UpstashRedis $redis
    ) {}

    public function remember(string $key, int $ttl, callable $callback): mixed
    {
        $cached = $this->redis->get($key);

        if ($cached !== null) {
            return json_decode($cached, true);
        }

        $value = $callback();
        $this->redis->setex($key, $ttl, json_encode($value));

        return $value;
    }
}
```

### 4. 完整的限流器实现

用 Upstash 做 API 限流，展示 Lua 脚本替代方案（Upstash 支持有限的 Lua，推荐用 Pipeline 批量命令）：

```php
<?php
// app/Services/RateLimiter.php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class RateLimiter
{
    /**
     * 滑动窗口限流
     *
     * @param  string  $key      限流键（如 "rate:api:user:123"）
     * @param  int     $maxRequests  窗口内最大请求数
     * @param  int     $windowSeconds 窗口大小（秒）
     * @return array{allowed: bool, remaining: int, retry_after: int}
     */
    public function slidingWindow(
        string $key,
        int $maxRequests,
        int $windowSeconds
    ): array {
        $now = microtime(true);
        $windowStart = $now - $windowSeconds;

        // 使用 Redis 事务保证原子性
        $result = Redis::transaction(function ($tx) use ($key, $windowStart, $now, $maxRequests) {
            // 清除窗口外的旧记录
            $tx->zremrangebyscore($key, '-inf', $windowStart);

            // 统计窗口内的请求数
            $tx->zcard($key);

            // 添加当前请求
            $tx->zadd($key, $now, uniqid('', true));

            // 设置键过期（自动清理）
            $tx->expire($key, $windowSeconds + 1);
        });

        $currentCount = $result[1]; // zcard 的结果

        $allowed = $currentCount < $maxRequests;
        $remaining = max(0, $maxRequests - $currentCount - 1);
        $retryAfter = $allowed ? 0 : $windowSeconds;

        return [
            'allowed'     => $allowed,
            'remaining'   => $remaining,
            'retry_after' => $retryAfter,
        ];
    }

    /**
     * 令牌桶限流（更平滑的限流策略）
     */
    public function tokenBucket(
        string $key,
        int $capacity,
        int $refillRate,
        int $refillInterval = 1
    ): array {
        $now = time();
        $bucketKey = "bucket:{$key}";

        $bucket = Redis::hgetall($bucketKey);
        $tokens = (int) ($bucket['tokens'] ?? $capacity);
        $lastRefill = (int) ($bucket['last_refill'] ?? $now);

        // 计算补充的令牌数
        $elapsed = $now - $lastRefill;
        $refillAmount = intdiv($elapsed, $refillInterval) * $refillRate;
        $tokens = min($capacity, $tokens + $refillAmount);

        $allowed = $tokens > 0;

        if ($allowed) {
            $tokens--;
        }

        // 更新桶状态
        Redis::hmset($bucketKey, [
            'tokens'      => $tokens,
            'last_refill' => $now,
        ]);
        Redis::expire($bucketKey, $capacity * $refillInterval + 60);

        return [
            'allowed'   => $allowed,
            'remaining' => $tokens,
        ];
    }
}
```

### 5. Laravel Cache 和 Session 使用 Upstash

直接复用 Laravel 配置即可：

```php
<?php

// Cache —— 走 config/database.php 中的 'cache' 连接
use Illuminate\Support\Facades\Cache;

Cache::store('redis')->put('user:123:profile', $userData, 3600);
$profile = Cache::store('redis')->get('user:123:profile');

// Session —— 配置 .env
// SESSION_DRIVER=redis
// SESSION_CONNECTION=default
```

`.env` 中设置：

```env
CACHE_STORE=redis
SESSION_DRIVER=redis
```

### 6. 性能优化：Pipeline 批量操作

HTTP 请求的开销在于每个命令一次 RTT。批量操作用 Pipeline 合并：

```php
<?php

use Illuminate\Support\Facades\Redis;

// ❌ 慢：100 次 HTTP 请求
for ($i = 0; $i < 100; $i++) {
    Redis::hset("user:{$i}", 'name', "User {$i}");
}

// ✅ 快：1 次 Pipeline 请求
Redis::pipeline(function ($pipe) {
    for ($i = 0; $i < 100; $i++) {
        $pipe->hset("user:{$i}", 'name', "User {$i}");
    }
});
```

Pipeline 将多个命令打包成一个 HTTP 请求发送，对于 Upstash 的 HTTP 模型来说，性能提升显著。

### 7. 监控与告警

```php
<?php
// app/Console/Commands/UpstashHealthCheck.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class UpstashHealthCheck extends Command
{
    protected $signature = 'upstash:health';
    protected $description = '检查 Upstash Redis 连接状态和延迟';

    public function handle(): int
    {
        $start = microtime(true);

        try {
            $pong = Redis::ping();
            $latency = round((microtime(true) - $start) * 1000, 2);

            $info = Redis::info('memory');
            $usedMemory = $info['used_memory_human'] ?? 'N/A';
            $hitRate = $this->calculateHitRate();

            $this->table(
                ['指标', '值'],
                [
                    ['连接状态', $pong === '+PONG' ? '✅ 正常' : '❌ 异常'],
                    ['延迟', "{$latency}ms"],
                    ['内存使用', $usedMemory],
                    ['缓存命中率', "{$hitRate}%"],
                ]
            );

            return Command::SUCCESS;
        } catch (\Exception $e) {
            $this->error("连接失败: {$e->getMessage()}");
            return Command::FAILURE;
        }
    }

    private function calculateHitRate(): string
    {
        $info = Redis::info('stats');
        $hits = (int) ($info['keyspace_hits'] ?? 0);
        $misses = (int) ($info['keyspace_misses'] ?? 0);
        $total = $hits + $misses;

        return $total > 0 ? round(($hits / $total) * 100, 1) : '0';
    }
}
```

## 踩坑记录

### 坑 1：连接超时

**现象**：在 Laravel Queue Worker 中偶尔出现 `Connection timed out` 错误。

**原因**：Upstash 的 TCP 端点有空闲连接超时（约 300 秒），而 Laravel 的连接池可能复用了已断开的连接。

**解决**：在 `config/database.php` 中添加重连逻辑：

```php
'options' => [
    'parameters' => [
        'scheme' => 'tls',
    ],
    'persistent' => 0,  // 禁用持久连接，每次新建
    'read_write_timeout' => 10,
],
```

### 坑 2：Lua 脚本限制

**现象**：使用 `Redis::eval()` 执行 Lua 脚本时返回错误。

**原因**：Upstash 对 Lua 脚本有限制——不支持 `redis.call()` 调用特定命令，且脚本执行时间有上限。

**解决**：用 Pipeline + 事务替代 Lua 脚本：

```php
// ❌ 不支持的 Lua 脚本
$result = Redis::eval("
    local val = redis.call('get', KEYS[1])
    if val then
        redis.call('incr', KEYS[1])
    end
    return val
", 1);

// ✅ 替代方案：用 WATCH + MULTI 事务
$result = Redis::watch('mykey');
$value = Redis::get('mykey');
if ($value !== null) {
    Redis::multi();
    Redis::incr('mykey');
    Redis::exec();
}
```

### 坑 3：内存限制

**现象**：Upstash 免费套餐只有 256MB 内存，数据量大时写入失败。

**原因**：Upstash 的免费层内存限制严格。

**解决**：
1. 所有 key 必须设置 TTL
2. 使用 `UNLINK`（异步删除）替代 `DEL`
3. 定期清理过期数据

```php
// 设置 TTL 的封装
function cacheWithTtl(string $key, mixed $value, int $ttl): void
{
    Redis::setex($key, $ttl, is_string($value) ? $value : json_encode($value));
}
```

### 坑 4：区域选择影响延迟

**现象**：部署在 `us-east-1` 的 Lambda 连接 `eu-west-1` 的 Upstash，延迟高达 80ms。

**原因**：跨大西洋的网络延迟。

**解决**：
1. Upstash 实例区域选在 Lambda 所在区域
2. 开启 Global Database，让边缘函数读取最近的副本
3. 对延迟敏感的场景，用本地 Redis 做一级缓存，Upstash 做二级

## 与传统 Redis 方案的成本对比

以一个日请求量 50 万的小型 API 服务为例：

| 方案 | 月成本 | 运维成本 |
|------|--------|---------|
| AWS ElastiCache t3.micro | $12/月 | 中（需要维护实例） |
| Redis Cloud 30MB 免费 | $0 | 低 |
| Upstash Pay-as-you-go | $3/月 | 无 |
| 自建 Redis on EC2 | $8/月 | 高（备份、监控、升级） |

Upstash 在低流量场景下成本优势明显，但超过 500 万请求/月后，固定实例方案更划算。

## 总结

Upstash Redis 不是要替代所有 Redis 部署，而是在特定场景下提供了一个更优雅的选择：

**适合用 Upstash 的场景**：
- Serverless 架构（Lambda、Cloudflare Workers）
- 边缘计算（Vercel Edge、Cloudflare Pages）
- 开发/测试环境（零运维、免费额度够用）
- 小型项目快速启动

**不适合的场景**：
- 高吞吐量（>100K QPS）
- 严格延迟要求（<2ms）
- 大量 Lua 脚本依赖
- 已有成熟的 Redis 集群运维体系

对于 Laravel 项目来说，Upstash 的接入成本极低——只需要改 `.env` 配置，代码层面几乎零改动。如果你的项目正在走向 Serverless，或者想在边缘节点上跑 Redis，Upstash 值得一试。
