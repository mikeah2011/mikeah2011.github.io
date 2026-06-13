---
title: AI Agent 速率限制与配额治理实战：Token Bucket + 滑动窗口 + 租户级 Quota——多租户 SaaS 的 LLM 调用管控
date: 2026-06-07 10:00:00
tags: [ai-agent, rate-limiting, token-bucket, redis, laravel, saas]
categories:
  - php
cover: /images/covers/ai-agent-rate-limiting-cover.jpg
description: "深入解析多租户 SaaS 场景下的 AI Agent Rate Limiting 实战方案，涵盖 Token Bucket、滑动窗口、多级 Quota 配额治理与 Redis 高性能实现，助你掌控 LLM 调用成本。"
---

## 引言：当 LLM 成本成为 SaaS 的核心命题

随着大语言模型（LLM）在企业级 SaaS 产品中的深度集成，一个全新的运维挑战浮出水面——**LLM 调用成本失控**。不同于传统的 REST API 限流场景，LLM 调用的成本结构有着根本性的差异。一次 GPT-4o 的请求可能消耗数千个 Token，产生数美元的费用；而一个恶意用户在短时间内发起大量复杂查询，就可能让平台的月度账单飙升数倍甚至数十倍。

在多租户 SaaS 架构下，这个问题更加棘手。你不仅需要防止某个租户滥用资源，还需要为不同套餐等级的租户提供差异化的服务质量保障。免费用户每天只能调用一万 Token，企业级用户则可以享受更高的配额和优先队列。这些需求叠加在一起，构成了一个多层次、多维度的限流与配额治理体系。

本文将从实战角度出发，以 Laravel + Redis 技术栈为基础，系统讲解如何构建一套完整的 AI Agent 调用管控方案。我们将深入探讨 Token Bucket 令牌桶算法的原理与实现、滑动窗口计数器的精确控制、多租户 Quota 管理的数据模型设计，以及优雅降级策略和成本监控告警体系。所有代码均可直接用于生产环境。

<!-- more -->

---

## 一、为什么 LLM 限流不同于传统 API 限流

### 1.1 成本结构的根本差异

传统 API 调用的边际成本接近于零。一次数据库查询、一次缓存读取，其额外消耗的计算资源可以忽略不计。因此传统限流的核心目标是**保护系统稳定性**——防止过多请求压垮服务器。

然而 LLM 调用完全不同。每一次请求都需要消耗 GPU 计算资源，成本按 Token 数量精确计费。以 OpenAI 的定价为例，GPT-4o 的输入价格为每百万 Token 2.5 美元，输出价格为每百万 Token 10 美元。一次包含长上下文的对话请求，输入加输出可能轻松超过 5000 个 Token，单次调用成本就在几美分到几美元之间。

这意味着**请求次数（QPS）并不直接等于成本消耗**。十次短文本查询的总成本可能远低于一次长文档总结。因此，LLM 限流需要同时考虑请求频率和 Token 消耗两个维度。

### 1.2 延迟容忍度的差异

传统 API 的响应时间通常在毫秒级别，用户对延迟极为敏感。如果限流导致请求排队，哪怕多等两百毫秒，用户体验都会明显下降。但 LLM 调用的固有延迟就在数秒到数十秒之间，用户已经习惯了等待。因此在 LLM 场景中，**适度排队是完全可以接受的**，甚至可以说是一种更优的用户体验——与其直接拒绝，不如让用户等几秒钟后拿到结果。

### 1.3 多模型、多维度的限流需求

在实际的多租户 SaaS 平台中，限流至少需要覆盖以下维度：

| 限流维度 | 控制粒度 | 核心目标 | 典型阈值示例 |
|----------|---------|----------|-------------|
| 租户级 RPM | 每分钟请求数 | 防止单租户霸占系统资源 | 免费版 10 RPM，专业版 60 RPM |
| 租户级 TPM | 每分钟 Token 数 | 控制成本预算 | 免费版 10K TPM，企业版 500K TPM |
| 用户级 RPM | 每分钟请求数 | 防止单用户滥用 | 每用户 20 RPM |
| 模型级并发 | 同时进行的请求数 | 遵守供应商 API 限制 | GPT-4o 全局 50 并发 |
| 月度/日度配额 | 累积 Token 总量 | 长期成本管控 | 每月 200 万 Token |

这些维度需要**组合生效**，任何一个维度超限都应触发限流机制。

### 1.4 模型间成本差异巨大

不同 LLM 模型之间的价格差距可达数十倍。GPT-4o 的成本大约是 GPT-4o-mini 的 15-20 倍，Claude 3.5 Sonnet 和 Claude 3 Haiku 之间也有类似的价格鸿沟。因此限流策略必须支持**按模型分别设定配额**，并能够在配额耗尽时自动降级到更便宜的模型。

---

## 二、Token Bucket 算法深度解析与 Redis 实现

### 2.1 算法原理详解

Token Bucket（令牌桶）是业界最经典的限流算法之一，被广泛应用于网络流量整形、API 网关限流等场景。其核心机制可以形象地描述为：

想象一个水桶，桶口有一个水龙头以固定速率 `r` 往桶里滴水（填充令牌），桶的最大容量为 `c`。每次有请求到来时，需要从桶中取走一定数量的令牌。如果桶中有足够的令牌，请求被允许通过；否则请求被拒绝或排队等待。

这个算法有两个关键参数：

- **桶容量 `c`**：决定了系统能承受的最大突发流量。桶越大，允许的突发请求越多
- **填充速率 `r`**：决定了长期的平均速率。令牌每秒填充 `r` 个

相较于固定窗口计数器，Token Bucket 的核心优势在于**天然支持突发流量**。当系统处于低负载状态时，令牌会持续积累（最多到桶容量上限）；当突发请求到来时，可以一次性消耗掉积累的令牌。这与真实的用户行为模式高度吻合——用户不会以完全均匀的速率发送请求，而是会有一段时间的密集操作和一段时间的空闲。

### 2.2 为什么使用惰性填充策略

在实现 Token Bucket 时，有两种常见的填充方式：

**定时器填充**：启动一个后台任务，每隔固定时间（比如每秒）向桶中添加令牌。这种方式直观，但需要维护额外的定时任务，且在分布式环境下多个实例可能同时操作同一个桶，导致重复填充。

**惰性填充**：不维护定时任务，而是在每次请求到达时，根据当前时间与上次填充时间的差值，计算应该填充多少令牌。这种方式只需要一个 Redis Hash 存储「当前令牌数」和「上次填充时间」两个字段，天然避免了分布式环境下的重复填充问题。

我们采用惰性填充策略。

### 2.3 基于 Redis Lua 脚本的原子实现

Token Bucket 的操作涉及「读取当前状态 → 计算新状态 → 写回状态」三个步骤，这三步必须是原子的。如果使用普通的 Redis 命令分步执行，在并发场景下可能出现竞态条件。Redis 的 Lua 脚本在服务端单线程执行，天然保证了原子性。

```php
<?php

namespace App\Services\RateLimiting;

use Illuminate\Support\Facades\Redis;

/**
 * Token Bucket 令牌桶限流器
 *
 * 基于 Redis Lua 脚本实现，保证原子性操作。
 * 采用惰性填充策略，每次请求时根据时间差计算应填充的令牌数。
 *
 * 适用场景：控制 LLM Token 消耗速率，与实际成本直接挂钩
 */
class TokenBucketLimiter
{
    private string $key;
    private int $capacity;
    private float $refillRate;   // 每秒填充的令牌数
    private int $refillInterval; // 填充间隔（秒），用于精度控制

    public function __construct(
        string $key,
        int $capacity,
        float $refillRate,
        int $refillInterval = 1
    ) {
        $this->key = $key;
        $this->capacity = $capacity;
        $this->refillRate = $refillRate;
        $this->refillInterval = $refillInterval;
    }

    /**
     * 尝试消耗指定数量的令牌
     *
     * @param  int  $tokens  请求消耗的令牌数（LLM 场景中通常等于预估的 Token 数）
     * @return array{allowed: bool, remaining: int, retry_after: float}
     */
    public function consume(int $tokens = 1): array
    {
        // Lua 脚本：在 Redis 服务端原子执行
        // 参数说明：
        //   KEYS[1]   = 限流器的 Redis Key
        //   ARGV[1]   = 桶容量
        //   ARGV[2]   = 每秒填充速率
        //   ARGV[3]   = 当前时间戳（微秒）
        //   ARGV[4]   = 本次请求消耗的令牌数
        $luaScript = <<<'LUA'
            local key = KEYS[1]
            local capacity = tonumber(ARGV[1])
            local refill_rate = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])
            local requested = tonumber(ARGV[4])

            -- 读取桶的当前状态
            local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
            local current_tokens = tonumber(bucket[1]) or capacity
            local last_refill = tonumber(bucket[2]) or now

            -- 计算自上次填充以来应该新增的令牌数
            local elapsed = math.max(0, now - last_refill)
            local new_tokens = elapsed * refill_rate
            current_tokens = math.min(capacity, current_tokens + new_tokens)

            -- 判断是否允许本次消耗
            local allowed = 0
            local remaining = current_tokens
            local retry_after = 0

            if current_tokens >= requested then
                -- 令牌充足：扣减令牌，允许请求
                current_tokens = current_tokens - requested
                allowed = 1
                remaining = current_tokens
            else
                -- 令牌不足：计算需要等待多久才能积累足够的令牌
                retry_after = (requested - current_tokens) / refill_rate
            end

            -- 更新桶状态（无论是否允许都更新时间戳，避免时间回退问题）
            redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', now)
            -- 设置 Key 过期时间，避免内存泄漏
            redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) * 2)

            return {allowed, remaining, retry_after}
        LUA;

        $now = microtime(true);

        $result = Redis::eval(
            $luaScript,
            1,  // KEYS 数组的元素数量
            $this->key,
            $this->capacity,
            $this->refillRate,
            $now,
            $tokens
        );

        return [
            'allowed'     => (bool) $result[0],
            'remaining'   => (int) $result[1],
            'retry_after' => (float) $result[2],
        ];
    }

    /**
     * 查看当前桶状态（不消耗令牌，用于监控展示）
     */
    public function peek(): array
    {
        $data = Redis::hmget($this->key, ['tokens', 'last_refill']);
        $currentTokens = (float) ($data[0] ?? $this->capacity);
        $lastRefill = (float) ($data[1] ?? microtime(true));

        $elapsed = microtime(true) - $lastRefill;
        $tokens = min($this->capacity, $currentTokens + $elapsed * $this->refillRate);

        return [
            'tokens'      => (int) $tokens,
            'capacity'    => $this->capacity,
            'refill_rate' => $this->refillRate,
            'utilization' => round((1 - $tokens / $this->capacity) * 100, 2),
        ];
    }
}
```

### 2.4 Lua 脚本关键设计解析

这段 Lua 脚本中有几个值得注意的设计决策：

**微秒级时间戳**：使用 `microtime(true)` 而非 `time()`，因为填充速率可能很高（比如每秒 1000 个令牌），秒级精度会导致令牌填充出现阶梯状的不均匀现象。

**过期时间计算**：`math.ceil(capacity / refill_rate) * 2` 表示桶从空到满需要的时间的两倍。如果在此期间没有任何请求，说明这个限流器已经不再使用，可以安全回收内存。

**时间戳始终更新**：即使令牌不足导致请求被拒绝，我们仍然更新 `last_refill` 时间戳。这样可以避免因时间回退（比如不同服务器时钟不同步）导致的令牌重复计算问题。

---

## 三、滑动窗口计数器：精确的请求频率控制

### 3.1 为什么 Token Bucket 不够

Token Bucket 擅长控制长期的平均速率，但在某些场景下我们需要更精确的窗口限制。比如，你希望限制「任意连续 60 秒内最多 30 次请求」，而不是「平均下来每秒 0.5 次」。固定窗口计数器虽然简单，但在窗口边界会出现「两倍突发」的问题——用户在第一个窗口末尾和第二个窗口开头各发送 30 次请求，在任何连续 60 秒内实际发送了 60 次，远超限制。

滑动窗口计数器通过记录每个请求的精确时间戳，维护一个动态移动的时间窗口，可以完美解决边界问题。

### 3.2 基于 Redis 有序集合的实现

Redis 的有序集合（Sorted Set）天然适合实现滑动窗口。我们将每个请求的时间戳作为分数（score），请求的唯一标识作为成员（member）。每次请求到来时，先移除窗口外的旧记录，再统计窗口内的请求数。

```php
<?php

namespace App\Services\RateLimiting;

use Illuminate\Support\Facades\Redis;

/**
 * 滑动窗口计数器
 *
 * 基于 Redis Sorted Set 实现精确的滑动窗口限流。
 * 适用场景：控制请求频率（RPM），消除固定窗口的边界效应
 */
class SlidingWindowLimiter
{
    private string $key;
    private int $maxRequests;
    private int $windowSeconds;

    public function __construct(string $key, int $maxRequests, int $windowSeconds)
    {
        $this->key = $key;
        $this->maxRequests = $maxRequests;
        $this->windowSeconds = $windowSeconds;
    }

    /**
     * 检查并记录一次请求
     *
     * @return array{allowed: bool, remaining: int, retry_after: float}
     */
    public function attempt(): array
    {
        $luaScript = <<<'LUA'
            local key = KEYS[1]
            local window = tonumber(ARGV[1])
            local max_requests = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])
            local unique_id = ARGV[4]

            -- 第一步：移除时间窗口之前的旧记录
            local window_start = now - window
            redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

            -- 第二步：统计当前窗口内的请求数量
            local count = redis.call('ZCARD', key)

            if count < max_requests then
                -- 未达到上限：添加当前请求记录
                redis.call('ZADD', key, now, unique_id)
                redis.call('EXPIRE', key, window)
                return {1, max_requests - count - 1, 0}
            else
                -- 已达到上限：计算需要等待多久
                -- 获取最早的那个请求的时间戳，等它滑出窗口即可
                local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
                local retry_after = 0
                if #oldest >= 2 then
                    retry_after = tonumber(oldest[2]) + window - now
                end
                return {0, 0, retry_after}
            end
        LUA;

        $now = microtime(true);
        $uniqueId = uniqid('', true);  // 保证每个请求在集合中的唯一性

        $result = Redis::eval(
            $luaScript,
            1,
            $this->key,
            $this->windowSeconds,
            $this->maxRequests,
            $now,
            $uniqueId
        );

        return [
            'allowed'     => (bool) $result[0],
            'remaining'   => (int) $result[1],
            'retry_after' => max(0, (float) $result[2]),
        ];
    }
}
```

### 3.3 内存优化考虑

在高并发场景下，每个请求都会在 Sorted Set 中添加一条记录。如果某个租户每分钟有 60 次请求、窗口大小为 60 秒，那么每个 Key 中最多有 60 条记录。这个数量级对 Redis 来说完全可以承受。但如果窗口较大（比如 1 小时）且请求频率很高，就需要考虑内存占用问题。此时可以改用「滑动窗口日志采样」或「固定窗口 + 加权近似」的方式来降低精度换取更少的内存消耗。

---

## 四、多租户 Quota 管理体系设计

### 4.1 三级配额架构

在多租户 SaaS 中，我们至少需要三个层级的配额管理，它们各自承担不同的职责：

**平台全局层**：整个平台级别的 LLM API 预算上限和供应商并发约束。比如平台与 OpenAI 签订的合约中约定每分钟最多 1000 次请求、每天最多消耗 100 美元，这些是全局性的硬限制。

**组织/租户层**：根据不同的付费套餐，每个租户拥有不同的配额。免费用户可能每天只有一万 Token 的额度，专业版用户有二十万 Token，企业版用户则可以达到五百万 Token。此外，不同套餐可以使用的模型也不同——免费版只能使用 GPT-4o-mini，企业版可以使用所有模型。

**用户层**：在同一组织内，不同用户的使用量也应该有所控制，防止单个用户耗尽整个组织的配额。典型的限制包括每分钟请求数、并发会话数等。

### 4.2 数据库表结构设计

```php
<?php
// database/migrations/2026_06_07_create_quota_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 租户配额配置表
        Schema::create('tenant_quotas', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')
                  ->constrained()
                  ->cascadeOnDelete();
            $table->string('plan', 50)->index();           // 套餐标识：free / pro / enterprise
            $table->unsignedBigInteger('monthly_token_limit');   // 月度 Token 上限
            $table->unsignedBigInteger('daily_token_limit');     // 日度 Token 上限
            $table->unsignedInteger('rpm_limit')->default(60);   // 每分钟请求上限
            $table->unsignedInteger('concurrent_limit')->default(5); // 并发会话上限
            $table->json('allowed_models')->nullable();          // 允许使用的模型白名单
            $table->boolean('priority_queue')->default(false);   // 是否启用优先队列
            $table->timestamps();
        });

        // 租户用量记录表（按天聚合）
        Schema::create('tenant_quota_usage', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')
                  ->constrained()
                  ->cascadeOnDelete();
            $table->date('usage_date');
            $table->unsignedBigInteger('tokens_used')->default(0);
            $table->unsignedBigInteger('requests_made')->default(0);
            $table->unsignedBigInteger('input_tokens')->default(0);
            $table->unsignedBigInteger('output_tokens')->default(0);
            $table->decimal('estimated_cost', 10, 6)->default(0);  // 预估成本（美元）
            $table->json('model_breakdown')->nullable();  // 各模型的消耗明细
            $table->timestamps();

            $table->unique(['organization_id', 'usage_date']);
            $table->index(['usage_date', 'tokens_used']);
        });

        // 用户级配额表
        Schema::create('user_rate_limits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')
                  ->constrained()
                  ->cascadeOnDelete();
            $table->unsignedInteger('rpm_override')->nullable();   // 覆盖组织默认的 RPM 限制
            $table->unsignedInteger('daily_token_override')->nullable();
            $table->boolean('is_unlimited')->default(false);       // 管理员特权：不限流
            $table->timestamps();
        });
    }
};
```

### 4.3 核心配额管理服务

配额管理服务是整个限流体系的核心，它需要编排多个检查步骤，并返回统一的结果：

```php
<?php

namespace App\Services\RateLimiting;

use App\Models\Organization;
use Illuminate\Support\Facades\Redis;

/**
 * 多租户配额管理器
 *
 * 负责检查和管理三级配额（平台全局、组织、用户），
 * 整合 Token Bucket 和滑动窗口两种限流算法。
 */
class QuotaManager
{
    /**
     * 各套餐的默认配额配置
     * 可通过 tenant_quotas 表为特定组织覆盖
     */
    private const PLAN_DEFAULTS = [
        'free' => [
            'monthly_token_limit' => 100_000,
            'daily_token_limit'   => 10_000,
            'rpm_limit'           => 10,
            'concurrent_limit'    => 1,
            'allowed_models'      => ['gpt-4o-mini'],
            'priority_queue'      => false,
        ],
        'pro' => [
            'monthly_token_limit' => 2_000_000,
            'daily_token_limit'   => 200_000,
            'rpm_limit'           => 60,
            'concurrent_limit'    => 10,
            'allowed_models'      => ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet'],
            'priority_queue'      => true,
        ],
        'enterprise' => [
            'monthly_token_limit' => 50_000_000,
            'daily_token_limit'   => 5_000_000,
            'rpm_limit'           => 300,
            'concurrent_limit'    => 50,
            'allowed_models'      => ['*'],  // 星号表示允许所有模型
            'priority_queue'      => true,
        ],
    ];

    public function __construct(
        private TokenBucketLimiter $tokenBucket,
        private SlidingWindowLimiter $slidingWindow,
    ) {}

    /**
     * 检查组织是否有权限发起 LLM 请求
     *
     * 执行顺序（短路求值，任一环节不通过即返回）：
     *   1. 模型白名单检查
     *   2. 月度/日度累积配额检查
     *   3. 滑动窗口 RPM 检查
     *   4. Token Bucket TPM 检查
     *
     * @param  Organization  $org              所属组织
     * @param  string        $model            请求的 LLM 模型名称
     * @param  int           $estimatedTokens  预估消耗的 Token 数
     * @return array{allowed: bool, reason: string, retry_after: float, quota_info: array}
     */
    public function checkQuota(Organization $org, string $model, int $estimatedTokens): array
    {
        $quota = $this->getEffectiveQuota($org);

        // === 第一步：模型权限检查 ===
        if (!$this->isModelAllowed($model, $quota['allowed_models'])) {
            return [
                'allowed'     => false,
                'reason'      => "当前套餐不支持使用 {$model} 模型，请升级套餐或切换到可用模型",
                'retry_after' => 0,
                'quota_info'  => $quota,
            ];
        }

        // === 第二步：月度/日度累积配额检查 ===
        $usageCheck = $this->checkUsageLimits($org, $quota);
        if (!$usageCheck['allowed']) {
            return [
                'allowed'     => false,
                'reason'      => $usageCheck['reason'],
                'retry_after' => $usageCheck['retry_after'],
                'quota_info'  => $quota,
            ];
        }

        // === 第三步：滑动窗口 RPM（每分钟请求数）检查 ===
        $rpmKey = "rate:rpm:org:{$org->id}";
        $rpmLimiter = new SlidingWindowLimiter($rpmKey, $quota['rpm_limit'], 60);
        $rpmResult = $rpmLimiter->attempt();
        if (!$rpmResult['allowed']) {
            return [
                'allowed'     => false,
                'reason'      => '请求频率超限，请稍后重试',
                'retry_after' => $rpmResult['retry_after'],
                'quota_info'  => $quota,
            ];
        }

        // === 第四步：Token Bucket TPM（每分钟 Token 数）检查 ===
        $tpmKey = "rate:tpm:org:{$org->id}";
        $tpmLimiter = new TokenBucketLimiter(
            key: $tpmKey,
            // 桶容量设为 5 分钟的额度，允许短时突发
            capacity: (int) ($quota['daily_token_limit'] / 60 * 5),
            // 每秒填充速率：日度上限 ÷ 一天的秒数
            refillRate: $quota['daily_token_limit'] / 86400,
        );
        $tpmResult = $tpmLimiter->consume($estimatedTokens);
        if (!$tpmResult['allowed']) {
            return [
                'allowed'     => false,
                'reason'      => 'Token 消耗速率超限，请等待配额恢复',
                'retry_after' => $tpmResult['retry_after'],
                'quota_info'  => $quota,
            ];
        }

        // 全部检查通过
        return [
            'allowed'     => true,
            'reason'      => 'ok',
            'retry_after' => 0,
            'quota_info'  => $quota,
        ];
    }

    /**
     * 记录实际消耗的 Token 数量
     *
     * 在 LLM API 响应返回后调用，更新 Redis 实时计数器
     * 并通过队列异步持久化到 MySQL
     */
    public function recordUsage(Organization $org, string $model, int $tokensUsed, array $usageDetail = []): void
    {
        $today = now()->toDateString();
        $monthKey = now()->format('Y-m');

        // Redis 实时计数器（用于快速查询当前用量）
        $pipe = Redis::pipeline(function ($redis) use ($org, $today, $monthKey, $tokensUsed, $model) {
            // 日度总计
            $redis->incrBy("usage:daily:org:{$org->id}:{$today}", $tokensUsed);
            $redis->expire("usage:daily:org:{$org->id}:{$today}", 86400 * 2);

            // 月度总计
            $redis->incrBy("usage:monthly:org:{$org->id}:{$monthKey}", $tokensUsed);
            $redis->expire("usage:monthly:org:{$org->id}:{$monthKey}", 86400 * 35);

            // 按模型分维度统计
            $redis->hIncrBy("usage:models:org:{$org->id}:{$today}", $model, $tokensUsed);
        });

        // 异步持久化到 MySQL（通过队列，避免阻塞主请求）
        RecordUsageJob::dispatch(
            orgId: $org->id,
            model: $model,
            tokensUsed: $tokensUsed,
            inputTokens: $usageDetail['prompt_tokens'] ?? 0,
            outputTokens: $usageDetail['completion_tokens'] ?? 0,
            usageDate: $today,
        );
    }

    /**
     * 获取组织的有效配额（优先使用自定义配置，否则使用套餐默认值）
     */
    private function getEffectiveQuota(Organization $org): array
    {
        $customQuota = $org->tenantQuota;
        $planDefaults = self::PLAN_DEFAULTS[$org->plan] ?? self::PLAN_DEFAULTS['free'];

        if (!$customQuota) {
            return $planDefaults;
        }

        // 自定义配额覆盖默认值
        return array_merge($planDefaults, [
            'monthly_token_limit' => $customQuota->monthly_token_limit,
            'daily_token_limit'   => $customQuota->daily_token_limit,
            'rpm_limit'           => $customQuota->rpm_limit,
            'concurrent_limit'    => $customQuota->concurrent_limit,
            'allowed_models'      => json_decode($customQuota->allowed_models, true)
                                     ?? $planDefaults['allowed_models'],
            'priority_queue'      => $customQuota->priority_queue,
        ]);
    }

    private function isModelAllowed(string $model, array $allowedModels): bool
    {
        if (in_array('*', $allowedModels)) {
            return true;
        }
        return in_array($model, $allowedModels);
    }

    private function checkUsageLimits(Organization $org, array $quota): array
    {
        $today = now()->toDateString();
        $monthKey = now()->format('Y-m');

        // 从 Redis 读取实时用量
        $dailyUsed = (int) Redis::get("usage:daily:org:{$org->id}:{$today}");
        $monthlyUsed = (int) Redis::get("usage:monthly:org:{$org->id}:{$monthKey}");

        if ($dailyUsed >= $quota['daily_token_limit']) {
            $resetTime = now()->endOfDay()->diffInSeconds(now());
            return [
                'allowed'     => false,
                'reason'      => "今日 Token 配额已耗尽（已用 {$dailyUsed}），将于明日零点重置",
                'retry_after' => $resetTime,
            ];
        }

        if ($monthlyUsed >= $quota['monthly_token_limit']) {
            $resetTime = now()->endOfMonth()->diffInSeconds(now());
            return [
                'allowed'     => false,
                'reason'      => "本月 Token 配额已耗尽（已用 {$monthlyUsed}），将于下月重置",
                'retry_after' => $resetTime,
            ];
        }

        return ['allowed' => true, 'reason' => 'ok', 'retry_after' => 0];
    }
}
```

---

## 五、Laravel 中间件集成实战

### 5.1 统一限流中间件

将限流逻辑封装为 Laravel 中间件，统一拦截所有 AI 相关的 API 请求。中间件的设计遵循「单一职责」原则：只负责限流判断和用量记录，业务逻辑交给控制器处理。

```php
<?php

namespace App\Http\Middleware;

use App\Services\RateLimiting\QuotaManager;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * AI Agent 速率限制中间件
 *
 * 拦截所有 LLM 相关请求，执行多维限流检查，
 * 并在请求完成后记录实际 Token 消耗。
 */
class AiAgentRateLimit
{
    public function __construct(
        private QuotaManager $quotaManager
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $org = $user->organization;

        // 管理员特权：检查是否配置了不限流
        if ($user->rateLimitConfig?->is_unlimited ?? false) {
            return $next($request);
        }

        $model = $request->input('model', 'gpt-4o-mini');
        $estimatedTokens = $this->estimateTokens($request);

        // 执行多维限流检查
        $result = $this->quotaManager->checkQuota($org, $model, $estimatedTokens);

        if (!$result['allowed']) {
            return $this->buildRateLimitResponse($result);
        }

        // 将配额信息注入请求上下文，后续控制器可读取
        $request->attributes->set('quota_info', $result['quota_info']);

        $response = $next($request);

        // 请求完成后，从 LLM 响应中提取实际消耗并记录
        $this->recordActualUsage($org, $model, $response);

        return $response;
    }

    /**
     * 根据请求消息内容估算 Token 消耗量
     *
     * 粗略估算策略：
     *   - 中文：每个字符约 2 个 Token
     *   - 英文：每 4 个字符约 1 个 Token
     *   - 输出预估：输入量的 50%
     */
    private function estimateTokens(Request $request): int
    {
        $messages = $request->input('messages', []);
        $totalChars = 0;

        foreach ($messages as $message) {
            $content = $message['content'] ?? '';
            // 区分中文和英文字符
            $chineseChars = mb_strlen(preg_replace('/[^\x{4e00}-\x{9fff}]/u', '', $content));
            $otherChars = mb_strlen($content) - $chineseChars;

            $totalChars += $chineseChars * 2 + (int) ($otherChars * 0.75);
        }

        // 预估输出 Token（一般为输入的 30%-100%，取中间值 50%）
        $estimatedOutput = (int) ($totalChars * 0.5);

        return $totalChars + $estimatedOutput;
    }

    /**
     * 从 LLM API 响应中提取实际用量并记录
     */
    private function recordActualUsage($org, string $model, Response $response): void
    {
        if ($response->getStatusCode() !== 200) {
            return;
        }

        try {
            $body = json_decode($response->getContent(), true);
            $usage = $body['usage'] ?? null;

            if ($usage) {
                $totalTokens = ($usage['prompt_tokens'] ?? 0)
                             + ($usage['completion_tokens'] ?? 0);

                app(QuotaManager::class)->recordUsage($org, $model, $totalTokens, $usage);
            }
        } catch (\Exception $e) {
            // 用量记录失败不应影响正常响应
            report($e);
        }
    }

    /**
     * 构建 429 限流响应
     */
    private function buildRateLimitResponse(array $result): Response
    {
        return response()->json([
            'error' => [
                'code'    => 'RATE_LIMITED',
                'message' => $result['reason'],
                'details' => [
                    'retry_after' => ceil($result['retry_after']),
                    'plan'        => $result['quota_info']['plan'] ?? 'unknown',
                ],
            ],
        ], 429)->withHeaders([
            'Retry-After'           => ceil($result['retry_after']),
            'X-RateLimit-Limit'     => $result['quota_info']['rpm_limit'] ?? 0,
            'X-RateLimit-Remaining' => 0,
            'X-RateLimit-Reset'     => now()->addSeconds($result['retry_after'])->timestamp,
        ]);
    }
}
```

### 5.2 中间件注册与路由配置

在 Laravel 11+ 中注册中间件并配置路由保护：

```php
<?php
// bootstrap/app.php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'ai.rate.limit' => \App\Http\Middleware\AiAgentRateLimit::class,
        ]);
    })
    ->create();
```

```php
<?php
// routes/api.php

use App\Http\Controllers\AiChatController;
use App\Http\Controllers\AgentController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'ai.rate.limit'])->group(function () {
    // AI 对话接口
    Route::post('/ai/chat', [AiChatController::class, 'chat']);
    Route::post('/ai/completions', [AiChatController::class, 'completions']);

    // Agent 执行接口
    Route::post('/ai/agents/{agent}/run', [AgentController::class, 'run']);

    // 批量处理接口（可能消耗大量 Token，需要更严格的限流）
    Route::post('/ai/batch', [AiChatController::class, 'batch']);
});
```

---

## 六、优雅降级策略

### 6.1 分级降级的设计理念

限流不应该是简单的「允许/拒绝」二元判断。一个好的限流系统应该像一个智能调度器，根据当前负载情况和租户等级，动态选择最优的处理策略。我们将降级分为三个层次：

**第一层：模型降级**。当请求的高端模型配额耗尽时，自动降级到功能相近但更便宜的模型。用户拿到的结果质量略有下降，但核心功能不受影响。

**第二层：排队等待**。对于拥有优先队列权限的付费用户，将超限请求放入队列延迟执行，而不是直接拒绝。用户会感受到更长的等待时间，但最终能得到服务。

**第三层：礼貌拒绝**。当以上两种策略都无法满足时，返回结构化的 429 错误响应，其中包含友好的错误信息和明确的重试时间建议。

### 6.2 模型降级链实现

```php
<?php

namespace App\Services\RateLimiting;

/**
 * 模型降级链
 *
 * 维护模型之间的降级关系。当请求的模型配额不足时，
 * 按照预设的降级链依次尝试替代模型，直到找到可用的。
 */
class ModelFallbackChain
{
    /**
     * 降级关系表：key 是原始请求的模型，value 是候选降级模型列表
     * 列表按优先级排序，越靠前越优先尝试
     */
    private const FALLBACK_CHAIN = [
        'gpt-4o'              => ['claude-3-5-sonnet', 'gpt-4o-mini', 'claude-3-haiku'],
        'claude-3-5-sonnet'   => ['gpt-4o', 'gpt-4o-mini', 'claude-3-haiku'],
        'gpt-4o-mini'         => ['claude-3-haiku'],
        'claude-3-haiku'      => [],  // 最低级别，无降级选项
    ];

    /**
     * 在降级链中寻找第一个可用的替代模型
     *
     * @param  string   $requestedModel   用户请求的原始模型
     * @param  array    $allowedModels    租户套餐允许的模型列表
     * @param  callable $checkAvailability 检查某个模型是否有可用配额的回调
     * @return string|null  可用的替代模型，无可用模型则返回 null
     */
    public function findFallback(
        string $requestedModel,
        array $allowedModels,
        callable $checkAvailability
    ): ?string {
        $candidates = self::FALLBACK_CHAIN[$requestedModel] ?? [];

        foreach ($candidates as $candidate) {
            // 检查该模型是否在租户的白名单中
            if (!in_array('*', $allowedModels) && !in_array($candidate, $allowedModels)) {
                continue;
            }

            // 检查该模型是否有可用配额
            if ($checkAvailability($candidate)) {
                return $candidate;
            }
        }

        return null;  // 所有候选模型都不可用
    }
}
```

### 6.3 请求排队机制

对于付费用户，当触发限流且无法通过模型降级解决时，将请求放入优先队列：

```php
<?php

namespace App\Services\RateLimiting;

use App\Jobs\ProcessQueuedLlmRequest;
use Illuminate\Support\Facades\Redis;

/**
 * 请求排队器
 *
 * 当限流触发时，将请求延迟入队而非直接拒绝。
 * 优先级基于租户套餐等级：enterprise > pro > free。
 */
class QueuedRateLimiter
{
    /**
     * 最大可接受的等待时间（秒）
     * 超过此时间直接拒绝，避免用户等待过久
     */
    private const MAX_ACCEPTABLE_WAIT = 30;

    /**
     * 将超限请求放入队列
     */
    public function handleWithQueue(
        array $requestData,
        array $quotaInfo,
        float $retryAfter
    ): array {
        // 等待时间超过阈值，直接拒绝
        if ($retryAfter > self::MAX_ACCEPTABLE_WAIT) {
            return [
                'status'  => 'rejected',
                'message' => '当前系统繁忙，请稍后再试',
                'retry_after' => (int) $retryAfter,
            ];
        }

        // 根据套餐确定队列优先级（数值越小优先级越高）
        $priority = match ($requestData['org_plan'] ?? 'free') {
            'enterprise' => 0,   // 企业版最高优先级
            'pro'        => 5,   // 专业版中等优先级
            default      => 10,  // 免费版最低优先级
        };

        // 计算延迟入队时间
        $delay = now()->addSeconds(min($retryAfter, 10));

        ProcessQueuedLlmRequest::dispatch($requestData)
            ->delay($delay)
            ->onQueue('ai-requests')
            ->onConnection('redis');

        return [
            'status'      => 'queued',
            'message'     => '请求已排队，将在配额恢复后自动处理',
            'estimated_wait' => (int) $retryAfter,
            'queue_position' => $this->estimateQueuePosition($requestData['org_id']),
        ];
    }

    /**
     * 估算当前组织在队列中的位置
     */
    private function estimateQueuePosition(int $orgId): int
    {
        return (int) Redis::llen("queue:ai-requests:org:{$orgId}");
    }
}
```

### 6.4 综合降级策略编排器

将模型降级、排队和拒绝三种策略组合为一个完整的降级编排器：

```php
<?php

namespace App\Services\RateLimiting;

use App\Models\Organization;

/**
 * 优雅降级策略编排器
 *
 * 按优先级依次尝试：直接通过 → 模型降级 → 排队等待 → 礼貌拒绝
 */
class GracefulDegradation
{
    public function __construct(
        private QuotaManager $quotaManager,
        private ModelFallbackChain $fallbackChain,
        private QueuedRateLimiter $queuedLimiter,
    ) {}

    /**
     * 编排完整的降级流程
     *
     * @param  string $orgId  组织 ID
     * @param  string $model  请求的模型
     * @param  int    $tokens 预估 Token 数
     * @return array  包含 action 和相关信息的数组
     */
    public function handle(string $orgId, string $model, int $tokens): array
    {
        $org = Organization::findOrFail($orgId);

        // 尝试使用原始模型
        $result = $this->quotaManager->checkQuota($org, $model, $tokens);

        if ($result['allowed']) {
            return ['action' => 'proceed', 'model' => $model, 'notice' => null];
        }

        // 尝试降级模型
        $fallbackModel = $this->fallbackChain->findFallback(
            $model,
            $result['quota_info']['allowed_models'],
            fn($candidate) => $this->quotaManager
                ->checkQuota($org, $candidate, $tokens)['allowed']
        );

        if ($fallbackModel) {
            return [
                'action' => 'proceed_with_fallback',
                'model'  => $fallbackModel,
                'notice' => "已从 {$model} 自动降级到 {$fallbackModel}，结果质量可能略有差异",
            ];
        }

        // 尝试排队（仅付费用户）
        if ($result['quota_info']['priority_queue'] ?? false) {
            return $this->queuedLimiter->handleWithQueue(
                [
                    'org_id'    => $orgId,
                    'org_plan'  => $org->plan,
                    'model'     => $model,
                    'tokens'    => $tokens,
                ],
                $result['quota_info'],
                $result['retry_after']
            );
        }

        // 最终拒绝
        return [
            'action'      => 'rejected',
            'reason'      => $result['reason'],
            'retry_after' => $result['retry_after'],
        ];
    }
}
```

---

## 七、监控、告警与成本追踪

### 7.1 实时指标采集

限流系统的价值不仅在于「限」，更在于「看」。你需要清楚地知道每个租户消耗了多少 Token、花了多少钱、什么时候是使用高峰期。基于 Redis 的实时指标采集可以让你在毫秒级别获取这些数据：

```php
<?php

namespace App\Services\Monitoring;

use Illuminate\Support\Facades\Redis;

/**
 * LLM 调用指标采集器
 *
 * 记录每次 LLM 调用的关键指标到 Redis，
 * 用于实时监控面板展示和告警判断。
 */
class LlmMetricsCollector
{
    /**
     * 记录单次 LLM 调用的完整指标
     */
    public function record(array $metrics): void
    {
        $orgId = $metrics['org_id'];
        $model = $metrics['model'];
        $today = now()->toDateString();
        $hour = now()->format('H');

        Redis::pipeline(function ($redis) use ($metrics, $orgId, $model, $today, $hour) {
            // === 请求计数 ===
            $redis->incr("metrics:requests:org:{$orgId}:{$today}");
            $redis->incr("metrics:requests:global:{$today}");

            // === Token 消耗总量 ===
            $redis->incrBy("metrics:tokens:org:{$orgId}:{$today}", $metrics['total_tokens']);

            // === 延迟分布（分桶统计，用于发现性能瓶颈）===
            $latencyBucket = $this->getLatencyBucket($metrics['latency_ms']);
            $redis->hIncrBy("metrics:latency:org:{$orgId}:{$today}", $latencyBucket, 1);

            // === 按模型维度统计 ===
            $redis->hIncrBy(
                "metrics:model_usage:org:{$orgId}:{$today}",
                $model,
                $metrics['total_tokens']
            );

            // === 按小时维度统计（用于发现使用模式和异常）===
            $redis->hIncrBy("metrics:hourly:org:{$orgId}:{$today}", $hour, $metrics['total_tokens']);

            // === 错误计数 ===
            if ($metrics['is_error'] ?? false) {
                $redis->incr("metrics:errors:org:{$orgId}:{$today}");
            }

            // === 限流触发计数 ===
            if ($metrics['was_rate_limited'] ?? false) {
                $redis->incr("metrics:rate_limited:org:{$orgId}:{$today}");
            }

            // === 成本估算（美元）===
            $cost = $this->estimateCost($model, $metrics['total_tokens']);
            $redis->incrByFloat("metrics:cost:org:{$orgId}:{$today}", $cost);
            $redis->incrByFloat("metrics:cost:global:{$today}", $cost);
        });
    }

    /**
     * 延迟分桶：将连续的延迟值映射到离散的区间
     */
    private function getLatencyBucket(int $latencyMs): string
    {
        return match (true) {
            $latencyMs < 500    => '0-500ms',
            $latencyMs < 1000   => '500ms-1s',
            $latencyMs < 3000   => '1s-3s',
            $latencyMs < 5000   => '3s-5s',
            $latencyMs < 10000  => '5s-10s',
            $latencyMs < 30000  => '10s-30s',
            default             => '30s+',
        };
    }

    /**
     * 基于模型单价估算调用成本
     */
    private function estimateCost(string $model, int $tokens): float
    {
        // 每 1000 Token 的美元成本（2026 年参考价格）
        $pricePer1k = match ($model) {
            'gpt-4o'             => 0.005,
            'gpt-4o-mini'        => 0.00015,
            'claude-3-5-sonnet'  => 0.003,
            'claude-3-haiku'     => 0.00025,
            default              => 0.001,
        };

        return ($tokens / 1000) * $pricePer1k;
    }
}
```

### 7.2 告警规则引擎

当某个租户的用量接近配额上限，或者某个模型的错误率异常升高时，系统需要及时通知运维人员：

```php
<?php

namespace App\Services\Monitoring;

use App\Models\Organization;
use App\Notifications\QuotaWarningNotification;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Redis;

/**
 * 配额告警管理器
 *
 * 定期检查各租户的用量状况，当接近配额上限或出现异常时触发告警。
 */
class QuotaAlertManager
{
    /**
     * 告警阈值配置
     */
    private const ALERT_THRESHOLDS = [
        'quota_warning'  => 0.80,   // 使用量达 80% 时发出预警
        'quota_critical' => 0.95,   // 使用量达 95% 时发出严重告警
        'error_rate'     => 0.05,   // 错误率超过 5% 时告警
    ];

    /**
     * 检查单个组织的告警状态
     */
    public function checkAndAlert(Organization $org): void
    {
        $quota = $org->tenantQuota;
        if (!$quota) {
            return;  // 没有配额配置的组织跳过
        }

        $today = now()->toDateString();

        // 检查日度配额使用率
        $dailyUsed = (int) Redis::get("usage:daily:org:{$org->id}:{$today}");
        $dailyLimit = $quota->daily_token_limit;
        $dailyRatio = $dailyLimit > 0 ? $dailyUsed / $dailyLimit : 0;

        if ($dailyRatio >= self::ALERT_THRESHOLDS['quota_critical']) {
            $this->sendAlert($org, 'critical', "日度配额使用率已达 " . round($dailyRatio * 100) . "%", $dailyUsed, $dailyLimit);
        } elseif ($dailyRatio >= self::ALERT_THRESHOLDS['quota_warning']) {
            $this->sendAlert($org, 'warning', "日度配额使用率已达 " . round($dailyRatio * 100) . "%，请注意控制用量", $dailyUsed, $dailyLimit);
        }

        // 检查错误率
        $totalRequests = (int) Redis::get("metrics:requests:org:{$org->id}:{$today}");
        $errorRequests = (int) Redis::get("metrics:errors:org:{$org->id}:{$today}");
        if ($totalRequests > 0) {
            $errorRate = $errorRequests / $totalRequests;
            if ($errorRate >= self::ALERT_THRESHOLDS['error_rate']) {
                $this->sendAlert($org, 'warning', "LLM 调用错误率已达 " . round($errorRate * 100, 1) . "%，可能存在 API 服务异常", $errorRequests, $totalRequests);
            }
        }
    }

    private function sendAlert(Organization $org, string $level, string $message, int $current, int $limit): void
    {
        Notification::route('slack', config('services.slack.webhook'))
            ->notify(new QuotaWarningNotification(
                org: $org,
                level: $level,
                message: $message,
                currentUsage: $current,
                limit: $limit,
            ));
    }
}
```

### 7.3 定时巡检命令

将告警检查封装为 Artisan 命令，通过 Laravel Scheduler 定期执行：

```php
<?php

namespace App\Console\Commands;

use App\Models\Organization;
use App\Services\Monitoring\QuotaAlertManager;
use Illuminate\Console\Command;

/**
 * 定时巡检 LLM 用量，触发告警通知
 *
 * 建议每 15 分钟执行一次：
 *   php artisan llm:check-alerts
 */
class CheckLlmQuotaAlerts extends Command
{
    protected $signature = 'llm:check-alerts
                            {--org= : 可选，仅检查指定组织 ID}';

    protected $description = '检查各租户 LLM 用量并发送告警通知';

    public function handle(QuotaAlertManager $alertManager): int
    {
        $this->info('开始 LLM 用量巡检...');

        $query = Organization::whereNotNull('plan')
                             ->whereHas('tenantQuota');

        if ($orgId = $this->option('org')) {
            $query->where('id', $orgId);
        }

        $organizations = $query->get();
        $alertCount = 0;

        foreach ($organizations as $org) {
            try {
                $alertManager->checkAndAlert($org);
            } catch (\Exception $e) {
                $this->error("组织 {$org->id} ({$org->name}) 巡检失败: {$e->getMessage()}");
                report($e);
            }
        }

        $this->info("巡检完成，共检查 {$organizations->count()} 个组织。");
        return Command::SUCCESS;
    }
}
```

在 Laravel 11+ 的 `routes/console.php` 中注册定时任务：

```php
<?php
// routes/console.php
use Illuminate\Support\Facades\Schedule;

Schedule::command('llm:check-alerts')->everyFifteenMinutes();
```

---

## 八、生产环境实战经验与踩坑总结

### 8.1 Redis Key 命名规范

在多租户场景下，Redis Key 的命名必须遵循清晰的层级规范，便于运维排查和内存分析：

```
# 限流器 Key
rate:rpm:org:{org_id}                     # 租户级 RPM 滑动窗口
rate:tpm:org:{org_id}                     # 租户级 TPM Token Bucket
rate:rpm:user:{user_id}                   # 用户级 RPM 滑动窗口

# 用量计数 Key
usage:daily:org:{org_id}:{date}           # 日度 Token 累积消耗
usage:monthly:org:{org_id}:{month}        # 月度 Token 累积消耗
usage:models:org:{org_id}:{date}          # 按模型的消耗明细 (Hash)

# 监控指标 Key
metrics:requests:org:{org_id}:{date}      # 请求数
metrics:tokens:org:{org_id}:{date}        # Token 消耗
metrics:cost:org:{org_id}:{date}          # 成本统计
metrics:errors:org:{org_id}:{date}        # 错误数
metrics:hourly:org:{org_id}:{date}        # 按小时分布 (Hash)
metrics:latency:org:{org_id}:{date}       # 延迟分布 (Hash)
```

**关键原则**：所有限流和用量相关的 Key 都必须设置合理的 TTL（过期时间）。一般规则是 TTL 为窗口大小的 2 倍。比如日度 Key 设置 2 天过期，月度 Key 设置 35 天过期。这样可以避免因应用代码缺陷或租户注销导致的 Redis 内存泄漏。

### 8.2 分布式部署注意事项

当你的 Laravel 应用运行在多台服务器上时，有几个关键点需要特别注意：

**Redis 连接配置**。在高并发场景下，每个 PHP-FPM Worker 都会持有 Redis 连接。建议配置连接池大小和超时参数，避免连接数耗尽。同时在 Redis Key 前缀中加入服务标识，防止不同环境的 Key 冲突。

**时钟同步**。滑动窗口和 Token Bucket 都依赖时间戳来计算窗口范围和填充间隔。如果多台服务器的系统时钟不同步，会导致限流计算不准确——时钟较快的服务器会过度限流，时钟较慢的服务器会放过多请求。务必使用 NTP（网络时间协议）保持所有服务器的时钟同步，误差控制在 100 毫秒以内。

**Lua 脚本的版本管理**。Redis 中的 Lua 脚本是通过 `EVAL` 命令直接传递的，没有版本管理机制。如果你需要更新 Lua 脚本的逻辑，在新旧代码并存的滚动部署期间，新旧版本的脚本可能会操作同一个 Key，导致短暂的不一致。建议使用 `EVALSHA`（基于脚本的 SHA1 哈希）代替 `EVAL`，并配合 Redis 的 `SCRIPT LOAD` 命令预先加载脚本。

### 8.3 测试策略

限流逻辑的可靠性至关重要——如果限流器误判，轻则影响用户体验，重则导致成本失控。因此需要完整的测试覆盖：

```php
<?php

namespace Tests\Unit\Services\RateLimiting;

use App\Services\RateLimiting\TokenBucketLimiter;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class TokenBucketLimiterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Redis::flushdb();
    }

    /** @test */
    public function 桶内令牌充足时允许请求(): void
    {
        $limiter = new TokenBucketLimiter('test:bucket', capacity: 100, refillRate: 10);

        $result = $limiter->consume(50);

        $this->assertTrue($result['allowed']);
        $this->assertGreaterThanOrEqual(49, $result['remaining']);
        $this->assertEquals(0, $result['retry_after']);
    }

    /** @test */
    public function 桶内令牌不足时拒绝请求(): void
    {
        $limiter = new TokenBucketLimiter('test:bucket', capacity: 100, refillRate: 10);

        $result = $limiter->consume(150);

        $this->assertFalse($result['allowed']);
        $this->assertGreaterThan(0, $result['retry_after']);
    }

    /** @test */
    public function 令牌随时间推移自动填充(): void
    {
        $limiter = new TokenBucketLimiter('test:bucket', capacity: 100, refillRate: 100);

        // 先消耗所有令牌
        $result1 = $limiter->consume(100);
        $this->assertTrue($result1['allowed']);

        // 立即再请求应该被拒绝
        $result2 = $limiter->consume(10);
        $this->assertFalse($result2['allowed']);

        // 等待 1 秒后（应填充 100 个令牌），应该可以通过
        usleep(1_100_000);

        $result3 = $limiter->consume(50);
        $this->assertTrue($result3['allowed']);
    }

    /** @test */
    public function 桶内令牌不会超过容量上限(): void
    {
        $limiter = new TokenBucketLimiter('test:bucket', capacity: 100, refillRate: 1000);

        // 等待 5 秒（按速率应该填充 5000 个令牌，但容量上限为 100）
        sleep(5);

        $result = $limiter->consume(101);
        $this->assertFalse($result['allowed']);
    }
}
```

### 8.4 常见生产问题及应对方案

**问题一：Redis 宕机导致限流失效**。如果 Redis 不可用，所有限流逻辑都会抛出异常。可以在中间件中捕获 Redis 异常，降级为「允许请求通过但标记降级状态」，同时记录告警日志。这样至少不会因为限流组件故障而导致所有请求被拒绝。

**问题二：Lua 脚本执行阻塞 Redis**。Redis 是单线程的，Lua 脚本执行期间会阻塞其他所有命令。如果脚本中有复杂的循环操作，可能导致整个 Redis 实例响应变慢。确保 Lua 脚本尽量简短，避免在脚本中遍历大型集合。

**问题三：配额记录与实际消耗不一致**。由于 LLM API 调用是异步的（特别是流式响应），「检查配额」和「记录消耗」之间存在时间差。如果在记录消耗之前应用崩溃，会导致配额已扣除但没有实际消耗，或者配额未记录但实际已消耗。解决方案是将检查和记录分开：检查时使用保守的预估值，记录时使用精确的实际值，并通过定时任务校准差异。

---

## 九、完整请求流程全景图

将所有组件串联起来，一个完整的 LLM 请求生命周期如下：

```
用户发起 AI Chat 请求（POST /api/ai/chat）
            │
            ▼
    ┌─ AiAgentRateLimit 中间件 ──────────────────────────┐
    │                                                     │
    │  1. 解析请求：org_id, model, messages               │
    │  2. 估算 Token 数（中英文分别计算）                  │
    │  3. 执行 QuotaManager.checkQuota()                  │
    │     ├─ 模型白名单检查（allowed_models）             │
    │     ├─ 日度/月度累积配额检查（Redis 计数器）        │
    │     ├─ 滑动窗口 RPM 检查（Sorted Set）              │
    │     └─ Token Bucket TPM 检查（Lua 脚本）            │
    │                                                     │
    │  4. 全部通过 → 放行请求                             │
    │     任一失败 → 进入 GracefulDegradation 降级链       │
    │       ├─ 尝试模型降级（ModelFallbackChain）         │
    │       ├─ 付费用户排队等待（QueuedRateLimiter）      │
    │       └─ 返回 429 + Retry-After 头                  │
    │                                                     │
    └─────────────────────────────────────────────────────┘
            │ （放行）
            ▼
    ┌─ AiChatController ────────────────────────────────┐
    │  调用 LLM API（GPT-4o / Claude / 其他）           │
    │  处理流式或非流式响应                               │
    └─────────────────────────────────────────────────────┘
            │
            ▼
    ┌─ 响应后处理 ──────────────────────────────────────┐
    │  1. 从 LLM 响应中提取 usage（prompt_tokens, etc）  │
    │  2. QuotaManager.recordUsage() 更新 Redis 计数器   │
    │  3. RecordUsageJob 异步持久化到 MySQL              │
    │  4. LlmMetricsCollector 记录监控指标               │
    │  5. 返回响应给前端                                  │
    └─────────────────────────────────────────────────────┘
```

---

## 总结

在多租户 SaaS 的 AI Agent 平台中，LLM 调用的速率限制与配额治理不是可选功能，而是保障平台可持续运营的核心基础设施。通过本文的系统讲解，我们可以总结出以下六个关键设计原则：

**第一，Token Bucket 与滑动窗口组合使用**。Token Bucket 擅长控制长期的 Token 消耗速率，与实际成本直接挂钩；滑动窗口擅长精确控制请求频率，消除固定窗口的边界效应。两者配合使用，一个管「量」，一个管「频」，互相补充。

**第二，惰性填充优于定时器**。Token Bucket 采用惰性填充策略，每次请求时根据时间差计算应填充的令牌数。这样既避免了后台定时任务的运维开销，又天然解决了分布式环境下多实例重复填充的问题。

**第三，Lua 脚本保证原子性**。限流器的「读取-计算-写入」操作必须是原子的。Redis 的 Lua 脚本在服务端单线程执行，是实现原子操作的最简洁方案。

**第四，三级配额体系分级管控**。全局层控制平台预算，组织层实现差异化服务，用户层防止个体滥用。每一级独立计算、独立生效，构成完整的防护网络。

**第五，优雅降级优于简单拒绝**。模型降级、排队等待、礼貌拒绝，逐级递进的降级策略可以在保障平台安全的前提下，最大化用户体验和资源利用率。

**第六，Redis 实时计数加 MySQL 持久化**。Redis 提供毫秒级的实时查询能力，MySQL 提供持久化的数据分析基础。两者配合，兼顾性能和可靠性。

在 LLM 调用成本日益成为 SaaS 平台核心支出的今天，一套完善的速率限制与配额治理体系不仅是技术保障，更是商业模式可持续运营的基石。希望本文的代码实现和设计思路能够帮助你构建一个生产级的 AI Agent 调用管控系统，让你的平台在享受 AI 能力红利的同时，牢牢掌控成本与质量的平衡。

---

## 延伸阅读

- [API 限流完全指南：从算法到生产实践](/post/api-rate-limiting-rate-limitingguide.html) — 深入理解各类限流算法的原理与适用场景
- [Claude Agent SDK 与 Laravel 集成实战](/post/claude-agent-sdk-laravel.html) — 构建基于 Claude 的智能 Agent 应用
- [AI Agent 客服系统实战：多轮对话、知识库检索与工单流转](/post/AI-Agent-客服系统实战-多轮对话-知识库检索-工单流转.html) — 从零搭建企业级 AI 客服平台

## 相关阅读

- [API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 反爬与反滥用工程化方案](/post/API-Abuse-Prevention-实战-Bot检测-速率限制-指纹识别-Laravel-API反爬与反滥用工程化方案.html) — 从 Bot 检测到 Redis 滑动窗口的多维度 API 限流方案，与本文的 Token Bucket 形成互补
- [OpenClaw 模型策略实战：多模型路由与成本优化](/post/OpenClaw-模型策略实战-多模型路由与成本优化.html) — 多模型路由与 Token 预算控制，与本文的多模型配额管理一脉相承
- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/post/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录.html) — Laravel API 多层安全防御体系，可与速率限制叠加构建纵深防护
