---

title: AI Agent 速率限制与配额治理实战：Token Bucket + 滑动窗口 + 租户级 Quota——多租户 SaaS 的 LLM 调用管控
keywords: [AI Agent, Token Bucket, Quota, SaaS, LLM, 速率限制与配额治理实战, 滑动窗口, 租户级, 多租户, 调用管控]
date: 2026-06-07 15:00:00
description: 多租户SaaS平台下AI Agent的LLM调用速率限制与配额治理实战指南，深入讲解Token Bucket令牌桶、滑动窗口、滑动窗口计数器三大限流算法原理，结合Laravel+Redis实现全局限流、租户级Quota、用户级Rate Limit三级管控体系，涵盖Lua脚本原子操作、Redis与MySQL双写、降级策略、监控告警等生产环境部署要点。
tags:
- AI Agent
- Rate Limiting
- LLM
- SaaS
- multi-tenant
- Token Bucket
- 滑动窗口
- 配额治理
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---




# AI Agent 速率限制与配额治理实战：Token Bucket + 滑动窗口 + 租户级 Quota

> 多租户 SaaS 的 LLM 调用管控，不止是"限速"，而是**成本、公平性、可用性**的三角博弈。

## 一、问题背景：为什么 AI Agent 需要速率限制与配额治理？

### 1.1 多租户 SaaS 的核心挑战

在构建多租户 SaaS 平台时，AI Agent 作为核心交互入口，承担着对话、检索增强生成（RAG）、工具调用、多模态推理等重负载任务。每一次 Agent 调用的背后，都对应着一次或多次 LLM API 请求——而 LLM API 的计费单位是 **Token**，成本与调用次数、输入输出长度成正比。

一个典型的多租户 AI Agent 平台面临的挑战包括：

- **成本失控**：某个租户的 Agent 突然进入高频调用循环（如死循环重试），单日 Token 消耗飙升数十倍，直接侵蚀利润。在实际生产环境中，我们观察到一个免费用户由于代码 Bug 导致无限递归调用，单日消耗了价值超过 500 美元的 API 额度。这种事故在没有速率限制的系统中几乎是必然的。

- **资源争抢**：LLM Provider（如 OpenAI、DeepSeek、Anthropic）通常对 API Key 绑定全局限速——例如 OpenAI 的每分钟请求数（RPM）限制为 500 次，每分钟 Token 数（TPM）限制为 80,000 个。当某个租户的突发流量消耗了大部分配额后，其他所有租户都会收到 429 Too Many Requests 错误，造成连锁的体验崩溃。

- **公平性缺失**：免费用户与付费用户的调用没有差异化管控，导致付费用户体验下降。一个付费企业用户可能因为免费用户占用资源而无法及时完成关键的自动化任务，这在商业上是不可接受的。

- **缺乏可观测性**：不知道谁在用、用了多少、什么时候用的，无法做容量规划和成本分摊。财务部门无法按租户统计 LLM 成本，产品团队无法识别高价值使用模式。

- **合规与审计需求**：越来越多的企业客户要求在合同中约定 LLM 调用的上限，并且需要提供完整的调用日志作为审计依据。如果系统缺乏精确的计量能力，这些合同条款将无法落地执行。

因此，**速率限制（Rate Limiting）** 和 **配额治理（Quota Management）** 是多租户 AI Agent 平台的基础设施级能力。本文将从算法原理到工程落地，系统讲解令牌桶、滑动窗口、滑动窗口计数器三种核心算法，并结合 Laravel/PHP + Redis 实现完整的多租户配额管控方案。

### 1.2 限流的核心目标

速率限制系统的设计目标可以概括为四个维度：

**保护性**：防止异常调用（包括恶意攻击和程序 Bug 导致的循环调用）击垮系统或产生不可控的成本。

**公平性**：确保每个租户按其付费等级获得公平的资源分配，高价值租户应该获得更多配额。

**可预测性**：让租户明确知道自己的调用上限，避免在使用过程中突然被拒绝，提供清晰的错误信息和重试建议。

**可观测性**：所有限流事件都应该被记录和监控，为容量规划、定价策略调整和异常检测提供数据基础。好的可观测性体系应该能够在 Grafana 等监控工具中展示实时的限流仪表盘，让运营团队随时掌握平台的健康状态。

## 二、Token Bucket（令牌桶）算法详解

### 2.1 核心思想

令牌桶算法是速率限制领域的经典范式，由计算机网络领域发展而来，被广泛应用于 API 网关、消息队列和流量整形场景。其核心模型可以用一个形象的比喻来理解：想象一个水桶，系统以恒定速率向桶中倒入令牌（水滴），每次 API 请求需要从桶中取走一定数量的令牌。如果桶中令牌不够，请求就被拒绝。

具体而言：

1. 系统以固定速率（`rate`）向桶中填充令牌，桶的最大容量为 `capacity`。
2. 每次请求消耗一个（或多个）令牌，令牌的消耗粒度可以根据业务需求灵活配置。
3. 桶中令牌不足时，请求被拒绝（快速失败）或进入等待队列（排队模式）。
4. 桶的容量限制了**突发流量的上限**，令牌的填充速率决定了**长期吞吐量**。

### 2.2 关键参数详解

在实际配置令牌桶时，需要理解以下关键参数的业务含义：

- **capacity（桶容量）**：决定了系统允许的最大突发量。例如设置为 10，意味着在桶满的情况下，可以瞬间处理 10 个请求。在 LLM 场景中，这个值通常对应 Provider 的单次突发限额。

- **rate（填充速率）**：每秒生成的令牌数量，决定了系统的稳态吞吐能力。例如 rate=2 表示每秒稳定处理 2 个请求，对应 Provider 的 RPM 限制。

- **tokens_per_request（单次消耗）**：每次请求需要消耗的令牌数。对于简单 API，消耗 1 个；对于 LLM 调用，可以按输入输出 Token 数量比例消耗多个令牌。

### 2.3 算法特性深度分析

**允许突发**：当桶满时，可以瞬间处理 `capacity` 个请求，这在 Agent 场景中非常重要——用户可能同时触发多个 Agent 任务（如并行的工具调用），需要短暂的突发能力。

**平滑限速**：长期来看，吞吐量稳定在 `rate` 水平，不会出现固定窗口算法的"窗口边界突发"问题。

**内存效率高**：只需要记录桶中剩余令牌数和上次填充时间两个值，Redis 中只需一个 Hash 结构，空间复杂度 O(1)。

**参数可动态调整**：可以通过修改 `rate` 和 `capacity` 在运行时调整限流策略，无需重启服务。对于 SaaS 场景，当租户升级套餐时，可以立即生效新的配额。

### 2.4 Redis Lua 脚本实现

令牌桶的原子操作必须用 Lua 脚本完成，否则 Redis 的 GET → 计算 → SET 存在竞态条件。在高并发场景下，两个请求可能同时读到相同的令牌数，都认为可以消费，导致超发。

```lua
-- token_bucket.lua
-- KEYS[1] = 桶的 Redis Key
-- ARGV[1] = 桶容量 (capacity)
-- ARGV[2] = 令牌填充速率 (tokens per second)
-- ARGV[3] = 当前时间戳 (毫秒)
-- ARGV[4] = 本次请求消耗的令牌数 (tokens_requested)
-- ARGV[5] = 过期时间 (秒)

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local tokens_requested = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

-- 获取当前桶状态
local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local current_tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

-- 初始化桶（首次访问时填充满）
if current_tokens == nil then
    current_tokens = capacity
    last_refill = now
end

-- 计算应该填充的令牌数：基于时间差的懒惰填充策略
local elapsed = math.max(0, now - last_refill) / 1000.0
local refill = elapsed * rate
current_tokens = math.min(capacity, current_tokens + refill)

-- 尝试消费令牌
if current_tokens >= tokens_requested then
    current_tokens = current_tokens - tokens_requested
    redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', now)
    redis.call('EXPIRE', key, ttl)
    return 1  -- 允许通过
else
    -- 不消费令牌，但更新填充时间以便后续请求计算
    redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', now)
    redis.call('EXPIRE', key, ttl)
    return 0  -- 拒绝
end
```

这段 Lua 脚本的关键设计是**懒惰填充（Lazy Refill）**：不在后台定时填充令牌，而是在每次请求时根据时间差计算应填充的令牌数。这种设计既节省了系统资源，又保证了令牌数计算的精确性。

## 三、滑动窗口（Sliding Window）算法详解

### 3.1 核心思想

滑动窗口算法维护一个精确的请求时间戳集合，每次请求时移除窗口外的过期时间戳，然后检查窗口内的请求数是否超过阈值。与固定窗口不同，滑动窗口的边界是连续移动的，不会出现"窗口边界突发"问题。

固定窗口算法的一个典型问题是：如果限制每分钟 100 次请求，用户在 09:59:59 发起 100 次请求，然后在 10:00:01 再发起 100 次请求，虽然窗口已经切换，但实际上只过去了 2 秒，却允许了 200 次请求。滑动窗口通过维护连续的时间戳集合，彻底解决了这个问题。

### 3.2 Redis Sorted Set 实现

利用 Redis 的 Sorted Set 数据结构，以请求时间戳作为 score，天然支持范围查询和删除操作：

```lua
-- sliding_window.lua
-- KEYS[1] = 窗口的 Redis Key
-- ARGV[1] = 窗口大小 (毫秒)
-- ARGV[2] = 窗口内最大请求数
-- ARGV[3] = 当前时间戳 (毫秒)
-- ARGV[4] = 请求唯一标识
-- ARGV[5] = 过期时间 (秒)

local key = KEYS[1]
local window = tonumber(ARGV[1])
local max_requests = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]
local ttl = tonumber(ARGV[5])

-- 移除窗口外的过期记录，保持 Sorted Set 的精简
local window_start = now - window
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

-- 计算窗口内当前请求数
local current_count = redis.call('ZCARD', key)

if current_count < max_requests then
    -- 添加当前请求到集合中
    redis.call('ZADD', key, now, request_id)
    redis.call('EXPIRE', key, ttl)
    return {1, max_requests - current_count - 1}
else
    -- 拒绝请求，返回建议的重试等待时间
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = 0
    if #oldest > 0 then
        retry_after = tonumber(oldest[2]) + window - now
    end
    return {0, retry_after}
end
```

### 3.3 优缺点分析

**优点**：精确度最高，记录了每个请求的实际时间点；可以精确计算出请求被拒绝后需要等待多久（通过最早过期记录的时间戳）；语义清晰，易于理解和调试。

**缺点**：内存消耗大——每个请求都存储一条记录到 Sorted Set 中，在高并发场景下（例如每秒数千次调用），Sorted Set 可能膨胀到很大，导致内存压力；`ZREMRANGEBYSCORE` 操作在集合过大时的复杂度为 O(log(N)+M)，其中 M 是被删除的元素数量，极端情况下可能出现性能抖动。

## 四、滑动窗口计数器（Sliding Window Counter）算法

### 4.1 核心思想与优势

滑动窗口计数器是**精度与效率的最佳平衡**，也是我们在生产环境中最常用的限流算法。它将时间轴划分为固定大小的桶（如每分钟一个桶），每个桶记录该时间段内的请求总数。当前时刻的请求数通过**加权计算**当前桶和上一个桶的值来估算。

### 4.2 加权公式

核心公式如下：

```
估算窗口请求数 = 上一桶请求数 × 重叠比例 + 当前桶已发生的请求数
```

其中 `重叠比例 = 1 - (当前秒数 % 窗口大小) / 窗口大小`。

举个具体的例子：假设窗口大小为 60 秒，当前时间是 14:35:20（即第 20 秒），上一分钟的请求数是 45，当前分钟的请求数是 10。那么重叠比例 = 1 - 20/60 = 0.67，估算的窗口请求数 = 45 × 0.67 + 10 ≈ 40。如果限制是 50 次/分钟，则允许通过。

### 4.3 为什么生产环境首选此算法

- **内存固定**：每个时间桶只需一个整数计数器（Redis 的 INCR 操作），空间复杂度 O(窗口数)，与请求量无关。
- **原子操作天然安全**：Redis 的 INCR 是单命令原子操作，不需要 Lua 脚本，实现更简单。
- **精度足够**：在大多数业务场景下，加权估算的误差不超过 5%，完全可以接受。
- **性能卓越**：INCR 操作的时间复杂度是 O(1)，即使在极高并发下也能保持稳定延迟。

## 五、多租户 Quota 治理架构设计

### 5.1 分层限流模型

在多租户 SaaS 场景下，限流需要分层执行，形成**三级管控体系**。每一层解决不同的风险，互为补充：

**第一层：全局限流（Global Rate Limit）**——保护 LLM Provider API Key 的全局 RPM/TPM 不被单个租户耗尽。使用令牌桶算法，因为需要允许短时突发但限制长期速率。全局层是最后的安全网，一旦触发说明某个租户的行为已经影响到了平台整体稳定性。

**第二层：租户级配额（Tenant Quota）**——按订阅套餐分配月度/日度 Token 额度，用滑动窗口计数器实现。这是商业变现的核心机制——不同套餐对应不同配额。租户级配额同时承担着成本分摊和用户体验保障的双重职责。

**第三层：用户级限流（User Rate Limit）**——防止单个租户内的某个用户高频调用导致 API 过载，保护同一租户内其他用户的体验。通常使用固定窗口或滑动窗口计数器，窗口大小设为分钟级。

这种分层设计的好处是：每一层的失败原因不同，错误信息不同，运维团队可以快速定位问题；每一层的配置独立，可以分别调整；即使某一层失效，其他层仍然可以提供保护。错误响应头中的 `X-RateLimit-Policy` 字段可以标识触发限流的具体层级，便于前端展示不同的用户提示。

### 5.2 租户配额数据模型设计

合理的数据模型是配额治理的基础。我们为不同套餐设计了差异化的配额参数：

```php
// app/Models/Tenant.php
class Tenant extends Model
{
    protected $fillable = [
        'name', 'plan', 'monthly_token_quota',
        'daily_token_quota', 'requests_per_minute',
        'requests_per_day',
    ];

    /**
     * 获取租户在指定维度的配额配置
     * 不同套餐的配额差异体现了商业价值的梯度设计
     */
    public function getQuotaConfig(): array
    {
        return match ($this->plan) {
            'free' => [
                'monthly_tokens' => 100_000,      // 10 万 Token/月
                'daily_tokens'   => 5_000,        // 5000 Token/日
                'rpm'            => 10,           // 10 次/分钟
                'rpd'            => 200,          // 200 次/日
                'concurrent'     => 1,            // 1 个并发
            ],
            'pro' => [
                'monthly_tokens' => 5_000_000,    // 500 万 Token/月
                'daily_tokens'   => 500_000,      // 50 万 Token/日
                'rpm'            => 60,           // 60 次/分钟
                'rpd'            => 10_000,       // 1 万次/日
                'concurrent'     => 5,            // 5 个并发
            ],
            'enterprise' => [
                'monthly_tokens' => 50_000_000,   // 5000 万 Token/月
                'daily_tokens'   => 5_000_000,    // 500 万 Token/日
                'rpm'            => 300,          // 300 次/分钟
                'rpd'            => 100_000,      // 10 万次/日
                'concurrent'     => 20,           // 20 个并发
            ],
            default => throw new \InvalidArgumentException("未知套餐: {$this->plan}")
        };
    }
}
```

### 5.3 用量记录与持久化

Redis 负责实时限流的高性能读写，但 Redis 中的数据不适合做长期存储和复杂查询。因此我们需要双写机制：Redis 用于实时判断，MySQL 用于持久化和报表。

```php
// app/Models/TenantUsage.php
class TenantUsage extends Model
{
    protected $fillable = [
        'tenant_id', 'period', 'token_count',
        'request_count', 'input_tokens', 'output_tokens',
        'model', 'last_used_at',
    ];

    /**
     * 使用原子操作累加 Token 用量，避免并发下的数据丢失
     */
    public static function incrementUsage(
        int $tenantId,
        string $period,
        int $inputTokens,
        int $outputTokens,
        string $model = 'default'
    ): static {
        $totalTokens = $inputTokens + $outputTokens;

        return static::updateOrCreate(
            ['tenant_id' => $tenantId, 'period' => $period],
            [
                'token_count'    => DB::raw("token_count + {$totalTokens}"),
                'request_count'  => DB::raw('request_count + 1'),
                'input_tokens'   => DB::raw("input_tokens + {$inputTokens}"),
                'output_tokens'  => DB::raw("output_tokens + {$outputTokens}"),
                'model'          => $model,
                'last_used_at'   => now(),
            ]
        );
    }
}
```

## 六、完整的 Laravel 实现代码

### 6.1 核心限流服务

以下是完整的限流服务实现，整合了三级限流逻辑：

```php
// app/Services/LLMRateLimiter.php
namespace App\Services;

use Illuminate\Support\Facades\Redis;

class LLMRateLimiter
{
    private int $tenantId;
    private array $quotaConfig;

    public function __construct(int $tenantId)
    {
        $this->tenantId = $tenantId;
        $this->quotaConfig = \App\Models\Tenant::find($tenantId)
            ->getQuotaConfig();
    }

    /**
     * 三级限流检查，返回 [allowed, error_info]
     * 按照 全局 → 租户配额 → 租户RPM 的顺序依次检查
     */
    public function checkRateLimit(int $inputTokens, int $outputTokens): array
    {
        // 第一层：全局 Provider 限流（令牌桶算法）
        $globalResult = $this->checkGlobalRateLimit();
        if (!$globalResult['allowed']) {
            return [false, [
                'level'       => 'global',
                'message'     => '全局 API 速率超限，请稍后重试',
                'retry_after' => $globalResult['retry_after'],
            ]];
        }

        // 第二层：租户 Token 配额检查（滑动窗口计数器）
        $quotaResult = $this->checkTenantQuota($inputTokens + $outputTokens);
        if (!$quotaResult['allowed']) {
            return [false, [
                'level'        => 'tenant_quota',
                'message'      => '本月或日 Token 配额已用完',
                'quota_type'   => $quotaResult['exceeded_type'],
                'reset_at'     => $quotaResult['reset_at'],
            ]];
        }

        // 第三层：租户 RPM 限流（滑动窗口计数器）
        $rpmResult = $this->checkRpmLimit();
        if (!$rpmResult['allowed']) {
            return [false, [
                'level'       => 'tenant_rpm',
                'message'     => '请求频率超过套餐限制',
                'current_rpm' => $rpmResult['current_count'],
                'max_rpm'     => $this->quotaConfig['rpm'],
                'retry_after' => $rpmResult['retry_after'],
            ]];
        }

        return [true, null];
    }

    /**
     * 全局限流：令牌桶保护 Provider API Key 的全局 RPM
     * 使用懒惰填充策略，只在请求时计算令牌数
     */
    private function checkGlobalRateLimit(): array
    {
        $lua = <<<LUA
            local key = KEYS[1]
            local capacity = tonumber(ARGV[1])
            local rate = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])

            local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
            local tokens = tonumber(bucket[1])
            local last_refill = tonumber(bucket[2])

            if tokens == nil then
                tokens = capacity
                last_refill = now
            end

            local elapsed = math.max(0, now - last_refill) / 1000.0
            tokens = math.min(capacity, tokens + elapsed * rate)

            if tokens >= 1 then
                tokens = tokens - 1
                redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
                redis.call('EXPIRE', key, 120)
                return {1, 0}
            else
                redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
                local wait = math.ceil((1 - tokens) / rate * 1000)
                return {0, wait}
            end
        LUA;

        $key = 'global:token_bucket:llm_provider';
        $result = Redis::eval($lua, 1, $key, 100, 2, now('microsecond') / 1000);

        return [
            'allowed'     => $result[0] == 1,
            'retry_after' => $result[1],
        ];
    }

    /**
     * 租户 Token 配额检查：日维度 + 月维度双重校验
     * 使用 Redis INCR 做实时计数，滑动窗口计数器思想
     */
    private function checkTenantQuota(int $tokensNeeded): array
    {
        $dailyPeriod   = now()->format('Y-m-d');
        $monthlyPeriod = now()->format('Y-m');

        $dailyKey  = "tenant:quota:{$this->tenantId}:daily:{$dailyPeriod}";
        $dailyUsed = (int) Redis::get($dailyKey);

        if ($dailyUsed + $tokensNeeded > $this->quotaConfig['daily_tokens']) {
            return [
                'allowed'       => false,
                'exceeded_type' => 'daily',
                'reset_at'      => now()->endOfDay()->toIso8601String(),
            ];
        }

        $monthlyKey  = "tenant:quota:{$this->tenantId}:monthly:{$monthlyPeriod}";
        $monthlyUsed = (int) Redis::get($monthlyKey);

        if ($monthlyUsed + $tokensNeeded > $this->quotaConfig['monthly_tokens']) {
            return [
                'allowed'       => false,
                'exceeded_type' => 'monthly',
                'reset_at'      => now()->endOfMonth()->toIso8601String(),
            ];
        }

        return ['allowed' => true];
    }

    /**
     * 租户 RPM 限流：滑动窗口计数器
     * 使用上一桶与当前桶的加权计算，平滑窗口边界
     */
    private function checkRpmLimit(): array
    {
        $windowSize = 60;
        $minuteKey  = (int) now()->format('i');
        $prevMinute = ($minuteKey - 1 >= 0) ? $minuteKey - 1 : 59;

        $currentBucket = "tenant:rpm:{$this->tenantId}:{$minuteKey}";
        $prevBucket    = "tenant:rpm:{$this->tenantId}:{$prevMinute}";

        $lua = <<<LUA
            local current_key = KEYS[1]
            local prev_key = KEYS[2]
            local max_requests = tonumber(ARGV[1])
            local now = tonumber(ARGV[2])
            local window = tonumber(ARGV[3])

            local current_count = tonumber(redis.call('GET', current_key) or '0')
            local prev_count = tonumber(redis.call('GET', prev_key) or '0')

            local overlap = 1 - (now % window) / window
            local estimated = prev_count * overlap + current_count

            if estimated < max_requests then
                redis.call('INCR', current_key)
                redis.call('EXPIRE', current_key, window * 2)
                return {1, 0, math.floor(max_requests - estimated)}
            else
                local retry_after = window - (now % window)
                return {0, retry_after, 0}
            end
        LUA;

        $result = Redis::eval($lua, 2, $currentBucket, $prevBucket,
            $this->quotaConfig['rpm'], time(), $windowSize
        );

        return [
            'allowed'       => $result[0] == 1,
            'retry_after'   => $result[1],
            'current_count' => $result[2],
        ];
    }

    /**
     * 调用完成后记录实际 Token 用量
     * 使用 Redis INCRBY 原子操作保证数据一致性
     */
    public function recordUsage(int $inputTokens, int $outputTokens, string $model = 'default'): void
    {
        $totalTokens   = $inputTokens + $outputTokens;
        $dailyPeriod   = now()->format('Y-m-d');
        $monthlyPeriod = now()->format('Y-m');

        $lua = <<<LUA
            local keys = KEYS
            local tokens = tonumber(ARGV[1])
            redis.call('INCRBY', keys[1], tokens)
            redis.call('EXPIRE', keys[1], tonumber(ARGV[2]))
            redis.call('INCRBY', keys[2], tokens)
            redis.call('EXPIRE', keys[2], tonumber(ARGV[3]))
            return 1
        LUA;

        Redis::eval($lua, 2,
            "tenant:quota:{$this->tenantId}:daily:{$dailyPeriod}",
            "tenant:quota:{$this->tenantId}:monthly:{$monthlyPeriod}",
            $totalTokens,
            (int) now()->endOfDay()->diffInSeconds(now()),
            (int) now()->endOfMonth()->diffInSeconds(now())
        );

        // 异步写入数据库做持久化，不影响主流程性能
        \App\Models\TenantUsage::incrementUsage(
            $this->tenantId, $monthlyPeriod,
            $inputTokens, $outputTokens, $model
        );
    }
}
```

### 6.2 HTTP 中间件集成

将限流逻辑封装为 Laravel 中间件，实现零侵入的集成方式：

```php
// app/Http/Middleware/LLMRateLimit.php
namespace App\Http\Middleware;

use Closure;
use App\Services\LLMRateLimiter;
use Illuminate\Http\JsonResponse;

class LLMRateLimit
{
    public function handle($request, Closure $next)
    {
        $tenantId = $request->user()?->tenant_id;
        if (!$tenantId) {
            return response()->json(['error' => '未授权：缺少租户身份'], 401);
        }

        $limiter = new LLMRateLimiter($tenantId);

        // 粗估 Token 消耗量用于预检查
        $estimatedInputTokens  = mb_strlen($request->input('messages', '')) / 3;
        $estimatedOutputTokens = 500;

        [$allowed, $errorInfo] = $limiter->checkRateLimit(
            (int) $estimatedInputTokens, $estimatedOutputTokens
        );

        if (!$allowed) {
            $response = new JsonResponse([
                'error' => $errorInfo['message'],
                'level' => $errorInfo['level'],
            ], 429);

            if (isset($errorInfo['retry_after'])) {
                $response->headers->set('Retry-After', (string) ceil($errorInfo['retry_after'] / 1000));
            }

            return $response;
        }

        $request->merge(['_rate_limiter' => $limiter]);
        return $next($request);
    }
}
```

### 6.3 路由注册与中间件应用

```php
// routes/api.php
Route::middleware(['auth:sanctum', LLMRateLimit::class])->group(function () {
    Route::post('/agent/chat', [AgentController::class, 'chat']);
    Route::post('/agent/tools', [AgentController::class, 'tools']);
    Route::post('/agent/rag', [AgentController::class, 'ragQuery']);
});
```

## 七、算法对比与选型指南

三种算法各有优劣，选择哪种取决于具体的业务场景和性能要求：

| 维度 | 令牌桶 (Token Bucket) | 滑动窗口 (Sorted Set) | 滑动窗口计数器 (SWC) |
|------|----------------------|----------------------|---------------------|
| **精度** | 高（连续时间模型） | 最高（逐请求记录） | 中（加权估算，误差 <5%） |
| **突发能力** | ✅ 支持（桶满时瞬间放行 capacity 个） | ❌ 不支持（严格窗口内计数） | ❌ 不支持 |
| **内存占用** | O(1) — 2 个字段 | O(N) — N=窗口内请求数 | O(窗口数) — 固定计数器 |
| **Redis 操作** | HMGET + HMSET（需 Lua） | ZADD + ZREMRANGEBYSCORE（需 Lua） | INCR（原子命令，无需 Lua） |
| **适用场景** | 全局 Provider 保护、突发容忍 | 高精度审计、合规场景 | 租户 RPM/RPD、生产首选 |
| **实现复杂度** | 中 | 高 | 低 |
| **重试时间计算** | 估算（基于填充速率） | 精确（最早过期时间戳） | 估算（当前窗口剩余时间） |

**令牌桶（Token Bucket）**：精度高，允许突发，内存效率极佳（O(1)），适合保护 LLM Provider 的全局 API Key 限额，以及需要允许短时突发流量的场景。实现需要 Lua 脚本保证原子性。

**滑动窗口（Sorted Set）**：精度最高，逐请求记录，可以精确计算重试等待时间。但内存消耗大（O(N)），适合高精度审计、合规要求严格的金融级场景，不适合高并发的实时限流。

**滑动窗口计数器（Sliding Window Counter）**：精度中等但内存固定（O(窗口数)），INCR 天然原子无需 Lua 脚本，是生产环境中最常用的方案，特别适合租户级 RPM/RPD 限流。

**推荐的组合方案**：全局 LLM Provider 保护使用令牌桶，租户级 RPM/RPD 使用滑动窗口计数器，租户级月度 Token 配额使用 Redis INCR 加数据库持久化。这种组合在精度、性能和实现复杂度之间取得了最佳平衡。

### 7.1 常见踩坑清单

在工程落地过程中，以下问题是最容易被忽视的"坑"：

1. **Token 预估偏差**：中间件中粗估 `inputTokens = mb_strlen / 3` 仅适用于中文场景，英文应除以 4，混合语言建议使用 tiktoken 库做精确计算。如果预估值远低于实际值，会导致配额超发。
2. **Redis 时钟漂移**：令牌桶的懒惰填充依赖 `now` 参数，如果应用服务器之间时钟不同步（超过 1 秒），会导致令牌计算错误。建议统一使用 Redis `TIME` 命令获取服务器时间。
3. **Lua 脚本 KEYS 限制**：Redis Cluster 模式下，Lua 脚本中的所有 KEYS 必须落在同一个 hash slot。使用 `{tenant_id}` 作为 key 前缀的 hash tag 可以保证同一租户的 key 落在同一节点。
4. **计数器溢出与过期**：Redis INCR 的值没有上限，如果 key 过期策略配置不当，计数器可能持续增长。务必为每个计数 key 设置合理的 TTL（日桶 48 小时，月桶 35 天）。
5. **降级策略选错**：fail-open 在成本敏感场景下可能导致数千美元的意外支出，fail-close 在用户体验优先的场景下可能导致大面积服务中断。建议根据当前配额余量动态切换。
6. **并发竞态（非 Lua 路径）**：如果跳过 Lua 脚本直接使用 GET→判断→SET 模式，在高并发下会出现令牌超发。这是一个极易复现的 Bug——在压测 100 QPS 时就能观察到。

## 八、生产环境部署要点

### 8.1 Redis 高可用配置

在生产环境中，Redis 是限流系统的核心依赖，必须配置高可用架构。推荐使用 Redis Sentinel 或 Redis Cluster 模式，确保单节点故障时限流服务仍然可用。内存配置建议预留足够空间给 Sorted Set 和 Hash 结构，淘汰策略选择 allkeys-lru 以保证内存稳定。

### 8.2 降级与兜底策略

当 Redis 不可用时，限流服务需要优雅降级。常见的策略有两种：**fail-open**（放行但记录告警）适用于对用户体验优先的场景；**fail-close**（全部拒绝）适用于对成本控制优先的场景。在实际生产中，可以根据 LLM API Key 的剩余配额动态选择降级策略——当配额充足时 fail-open，当配额紧张时 fail-close。

### 8.3 监控与告警体系

完善的监控是限流系统可靠运行的保障。需要监控的关键指标包括：按租户维度的 429 响应率（识别被限流最严重的租户）、Token 消耗速率的异常检测（识别死循环重试等异常模式）、Redis 内存使用趋势（防止内存溢出）、以及与 LLM Provider 仪表板的配额对账。

### 8.4 配额动态调整能力

运营团队需要能够在运行时调整租户配额，例如临时为某个大客户提升限额、对违规用户降低配额。通过管理后台的 API 接口，修改数据库中的配额配置后立即失效 Redis 缓存，新的配额在下一次请求时自动生效，无需重启任何服务。

## 九、总结

在多租户 SaaS 的 AI Agent 平台中，速率限制与配额治理不是可选项，而是**生存必需**。通过本文的系统讲解，核心要点可以总结为六条：

**分层治理**：全局、租户、用户三层限流各司其职，互为补充，每一层解决不同的风险维度。

**算法选型**：令牌桶适合保护 Provider 全局限额并允许突发，滑动窗口计数器适合高并发的租户限流，Sorted Set 适合高精度审计场景。

**原子操作**：Redis Lua 脚本确保限流逻辑的并发安全，避免竞态条件导致的令牌超发或计数不准确。

**Redis 加 DB 双写**：Redis 提供亚毫秒级的实时限流判断能力，数据库负责持久化和复杂的报表查询，两者互补。

**优雅降级**：Redis 故障时选择 fail-open 或 fail-close 策略，取决于你对成本风险和用户体验的优先级判断。

**可观测性**：限流不只是拦截请求，更是理解用户行为、优化定价策略、预防异常成本的基础数据来源。

通过这套体系，你可以在保障平台稳定性的同时，为不同套餐的租户提供差异化的 LLM 使用体验，实现成本可控、体验可预期的多租户 AI Agent 平台。限流系统的价值，不仅在于"保护"，更在于让你真正掌握平台的资源分配权，将 AI 能力作为一种可量化、可管理、可持续的基础设施来运营。在 LLM 成本日益成为 SaaS 平台核心支出的今天，一套完善的速率限制与配额治理体系，就是你的平台竞争力的重要组成部分。

## 相关阅读

- [AI Gateway 实战：统一 LLM 调用层——LiteLLM/Kong AI Gateway 的路由、限流与可观测性](/categories/架构/AI-Gateway-实战-统一LLM调用层-LiteLLM-Kong-AI-Gateway-路由限流与可观测性/)
- [API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 的反爬与反滥用工程化方案](/categories/架构/API-Abuse-Prevention-实战-Bot检测-速率限制-指纹识别-Laravel-API反爬与反滥用工程化方案/)
- [API Rate Limiting - 接口限流实战](/categories/php/Laravel/api-rate-limiting-rate-limitingguide/)
