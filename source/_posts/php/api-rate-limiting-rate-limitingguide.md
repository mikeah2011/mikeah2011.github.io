---
title: API Rate Limiting - 接口限流实战 - KKday B2C API 真实踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
  - php
  - api
tags: [Rate Limiting, Token Bucket, Redis, Laravel, API, Sliding Window]
keywords: [API Rate Limiting, KKday B2C API, 接口限流实战, 真实踩坑记录, PHP]
description: 深入解析 API 接口限流实战方案，涵盖 Token Bucket 令牌桶、Leaky Bucket 漏桶、滑动窗口算法及 Redis Lua 脚本原子操作，结合 KKday B2C 真实踩坑记录，详解分布式限流、IP 指纹识别、连接池优化与监控日志等生产级解决方案。

---

## 背景

在 KKday B2C API 项目中，API Rate Limiting（接口限流）是保护后端服务的重要防线之一。我们曾遇到以下场景：

- **恶意刷票**：第三方渠道疯狂调用 `/api/tickets/search`，导致 Redis 连接池耗尽
- **突发流量**：促销活动期间，单个 IP 在短时间内发起大量请求，拖垮业务逻辑层
- **爬虫攻击**：针对 `/api/prices/list` 的爬虫脚本高频访问，导致数据库查询压力激增

为应对这些问题，我们实现了一套完整的限流方案，踩过不少坑，今天来复盘一下。

## 核心挑战

| 场景 | 传统方案痛点 | KKday 解决方案 |
|------|-------------|---------------|
| 单机服务 | `Redis\RateLimiter` 扩展不成熟 | **自定义 Token Bucket 算法** + Redis Lua 脚本 |
| 分布式环境 | Cookie/IP 识别不准确 | **IP Header 指纹识别** + `X-Forwarded-For` 处理 |
| 精准限流 | 固定时间窗口不灵活 | **滑动窗口算法**（Sliding Window Log）+ 定时清理过期键 |
| 内存消耗 | 大量过期键占用内存 | **TTL 过期自动清理** + `redis-cli --fixed-strings` |

## 方案一：基础版 - 使用 Laravel Throttle Middleware

```php
// Before: 默认配置（不太够用）
' throttle => [
    'api' => [
        'window' => '1 minute',
        'limit' => 60,
    ],
],
```

### 踩坑记录 #1：时间窗口不精准

**问题描述**：
默认的 `'window' => '1 minute'` 采用固定时间窗口，用户在 `第 59s` 通过请求后，剩余 `1s` 无法使用，体验极差。

**Before**:
```php
// 用户在 T+59s 发起请求，被限流（虽然还剩 1s）
$rateLimiter = RateLimiter::for('api')
    ->limitBySeconds(60, 'api_key')
    ->rightNow()
    ->throttle();
```

**After**: 采用 **滑动窗口 + Redis 记录时间戳列表**：
```php
// 配置文件 config/rate-limiter.php
return [
    'drivers' => [
        'redis' => env('RATE_LIMITER_DRIVER', 'redis'),
    ],
    'storage' => env('RATE_LIMITER_STORAGE', 'redis'),
    'ttl' => 60,
];

// 使用滑动窗口算法（Sliding Window Log）
$rateLimiter = RateLimiter::for('api_sliding_window')
    ->limit(100, 1) // 每秒 100 次请求
    ->perMinute() // 滑窗计算分钟级速率
    ->rightNow();
```

### 踩坑记录 #2：Redis 驱动配置错误

**问题描述**：Laravel 8 默认使用 `TokenBucket` 驱动，但在高并发场景下存在竞态条件。

**Before**:
```php
// config/queue.php - 错误配置
'connections' => [
    'redis' => [
        'host' => '127.0.0.1',
        'port' => 6379,
        'database' => 1,
    ],
],
```

**After**:
```php
// 使用 Redis 专用连接，并启用 Lua 脚本原子性
'app' => [
    'driver' => env('CACHE_DRIVER', 'redis'),
    'connection' => 'redis-limiter', // 独立连接池
    'lock_connection' => 'redis-lock', // 锁专用连接池
],

// config/queue.php
'default' => env('QUEUE_CONNECTION', 'sync'),
'connections' => [
    'redis-limiter' => [
        'driver' => 'redis',
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'port' => env('REDIS_PORT', 6379),
        'database' => env('REDIS_DB', 2), // 独立 DB
        'prefix' => 'ratelimit_',          // 独立 Key 前缀
    ],
],
```

## 方案二：高级版 - Token Bucket 令牌桶算法

### 原理说明

Token Bucket（令牌桶）算法比 Fixed Window 更平滑，核心逻辑：
- **Bucket 容量**：`MAX_TOKENS = 1000`（每秒最大请求数）
- **Add Rate**：每 `T = 1s` 添加 `R = 100` 个令牌
- **Consume Tokens**：每次请求消耗 `N` 个令牌

**伪代码**：
```
if bucket.is_empty():
    return "rate limit exceeded"
token_count = min(token_count + add_rate * dt, MAX_TOKENS)
if token_count < N:
    return "rate limit exceeded"
token_count -= N
return "success"
```

### 实现代码（KKday B2C API）

**Before**: 简单的固定窗口计数器
```php
// app/Services/RateLimiter.php - 基础版
class RateLimiterService {
    private $redis;
    
    public function checkLimit($ip, $key) {
        $count = $this->redis->get("ratelimit:{$ip}:{$key}");
        if ($count >= 100) {
            return ['success' => false, 'retry_after' => 60];
        }
        $this->redis->incr("ratelimit:{$ip}:{$key}");
        return ['success' => true];
    }
}
```

**After**: Token Bucket 令牌桶实现
```php
// app/Services/RateLimiter.php - Token Bucket 版本
class RateLimiterService {
    private $redis;
    
    public function __construct(RedisClient $redis) {
        $this->redis = $redis;
    }
    
    /**
     * 检查并消耗令牌（原子性操作）
     */
    public function checkAndConsume($ip, $key, $tokens = 1): array 
    {
        $script = <<<'LUA'
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local addRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local lastUpdateTime = tonumber(redis.call('HMGET', KEYS[1], 'last_update', 'tokens'))[1] or 0

-- 如果不存在，初始化时间戳
if not lastUpdateTime then
    redis.call('HSET', key, 'last_update', now, 'tokens', maxTokens)
else
    -- 补充令牌（每 1s 补充 addRate 个）
    local elapsed = now - tonumber(lastUpdateTime)
    local newTokens = math.min(maxTokens, tonumber(tokens) + addRate * elapsed)
    
    -- 只记录最小令牌数（避免超过容量）
    if newTokens < tonumber(redis.call('HGET', key, 'tokens')) then
        redis.call('HSET', key, 'tokens', tostring(newTokens))
    end
    
    lastUpdateTime = now
    redis.call('HSET', key, 'last_update', tostring(lastUpdateTime))
end

local currentTokens = tonumber(redis.call('HGET', key, 'tokens')) or maxTokens
if currentTokens >= tonumber(ARGV[4]) then
    -- 成功消耗令牌
    local consumed = math.min(ARGV[4], currentTokens)
    redis.call('HSET', key, 'tokens', tostring(currentTokens - consumed))
    return {1, string.format("%.2f", currentTokens - consumed), maxTokens}
else
    -- 限流，返回重试时间
    local waitTime = math.ceil((ARGV[4] - currentTokens) / addRate)
    return {0, waitTime, currentTokens}
end
LUA;

        $key = "ratelimit:tokens:{$ip}:{$key}";
        
        $result = $this->redis->eval($script, [$key, $maxTokens, $addRate, time(), $tokens], 1);
        
        return [
            'success' => $result[0] == 1,
            'remaining_tokens' => (float)$result[1],
            'max_tokens' => $result[2],
            'retry_after' => $result[0] == 0 ? $result[1] : 0,
        ];
    }
    
    /**
     * 检查限流（仅查询不消耗）
     */
    public function checkLimit($ip, $key): array 
    {
        $key = "ratelimit:tokens:{$ip}:{$key}";
        
        $tokens = $this->redis->hget($key, 'tokens');
        if ($tokens) {
            return [
                'success' => true,
                'remaining_tokens' => (float)$tokens,
                'retry_after' => 0,
            ];
        }
        
        return ['success' => false, 'retry_after' => 30];
    }
}
```

### 踩坑记录 #3：Lua 脚本内存泄漏

**问题描述**：长时间运行的 Redis 实例中出现 Lua 脚本执行超时，导致部分限流失效。

**排查结果**：`HMGET` + `HSET` 频繁切换命令模式，导致原子性不足。

**修复方案**：
```php
// 优化 Lua 脚本，确保所有操作在同一个事务中完成
$script = <<<'LUA'
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local addRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local tokens = tonumber(redis.call('HGET', key, 'tokens') or tostring(maxTokens))

if now - tonumber(redis.call('HGET', key, 'last_update') or now) < 0 then
    return {1, tostring(maxTokens), maxTokens}
end

-- 只读一次 last_update，然后统一处理
local lastUpdate = tonumber(redis.call('HGET', key, 'last_update')) or now
local elapsed = now - lastUpdate
if elapsed > 0 then
    tokens = math.min(maxTokens, tokens + addRate * elapsed)
end

-- 原子性地更新状态
if tokens >= tonumber(ARGV[4]) then
    local consumed = math.min(ARGV[4], tokens)
    redis.call('HSET', key, 'tokens', tostring(tokens - consumed))
    redis.call('HSET', key, 'last_update', tostring(now))
    return {1, tostring(tokens - consumed), maxTokens}
else
    local waitTime = math.ceil((ARGV[4] - tokens) / addRate)
    return {0, tostring(waitTime), tostring(tokens)}
end
LUA;

// 确保脚本只使用一个 eval 调用
$result = $this->redis->eval($script, [$key, $maxTokens, $addRate, time(), $tokens], 1);
```

## 方案三：分布式限流 - IP Header 指纹识别

### 问题场景

在负载均衡（Nginx + Laravel Octane）环境下，IP 识别不准确的问题尤为突出：

```nginx
# Nginx 配置 - 传递真实客户端 IP
$real_ip_header X-Real-IP;
set $remote_user_agent "";
$remote_user_agent $http_user_agent;
$rate_limit_key "$binary($uri:$client_body)";
$rate_limit_ip $binary($remote_addr);
```

### 踩坑记录 #4：IP 指纹被绕过

**问题描述**：攻击者通过 `X-Forwarded-For` 伪造 IP，绕过限流策略。

**Before**:
```php
// config/cors.php - 默认只信任 localhost
$cors->headersAllowOrigin = "http://localhost";
$cors->headersAllowMethods = ['GET', 'POST'];
```

**After**:
```php
// app/Services/IPIdentifier.php - IP 指纹识别服务
class IPIdentifierService {
    public function __construct(
        private IpLookup $ipLookup,
        private RateLimiterFactory $rateLimiter,
    ) {}
    
    public function getRateLimitKey($request): string {
        // 1. 从 X-Real-IP 获取真实客户端 IP（Nginx 配置）
        $realIp = trim(
            getenv('HTTP_X_REAL_IP') ?? 
            getenv('REMOTE_ADDR') ??
            '0.0.0.0'
        );
        
        // 2. 从 X-Forwarded-For 获取原始 IP（备用方案）
        $originalIp = '';
        if ($headers['X_FORWARDED_FOR']) {
            $forwardedIps = array_map('trim', explode(',', $headers['X_FORWARDED_FOR']));
            $originalIp = $forwardedIps[0];
        }
        
        // 3. 构建限流 Key（IP + 路径）
        $key = sprintf(
            '%s:%s', 
            inet_ntop(ip2long($realIp)), // 确保 IPv4/IPv6 格式统一
            parse_url(parse_url(parse_url($request->path(), PHP_URL_PATH), PHP_URL_PATH) . '?v=' . rand())
        );
        
        return $key;
    }
}

// 5. IP 指纹生成（防绕过）
$ipFingerprint = hash('sha256', 'mikeah:rate-limit:v1:' . inet_ntop(ip2long($realIp)));
```

## 方案四：Leaky Bucket 漏桶算法实战

### 场景对比

| 算法 | 优点 | 缺点 | KKday 使用场景 |
|------|------|------|---------------|
| **Token Bucket** | 平滑突发流量 | 需要维护令牌桶状态 | 适合高并发 API 限流（如搜索接口） |
| **Leaky Bucket** | 严格固定速率，避免突发 | 需要等待令牌，体验较差 | 适合低频接口（如价格查询、订单创建） |

### Leaky Bucket 实现代码

```php
// app/Services/RateLimiter.php - Leaky Bucket 版本
class RateLimiterService {
    private $redis;
    
    /**
     * 漏桶算法实现
     */
    public function checkLeakyBucket($ip, $key): array 
    {
        $bucketKey = "ratelimit:leaky:{$ip}:{$key}";
        
        // Lua 脚本：原子性处理
        $script = <<<'LUA'
local bucketKey = KEYS[1]
local maxCapacity = tonumber(ARGV[1])
local leakRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local capacity = redis.call('HGET', bucketKey, 'capacity') or tostring(maxCapacity)
local leakTime = redis.call('HGET', bucketKey, 'leak_time') or tostring(now)
local currentLevel = tonumber(redis.call('HGET', bucketKey, 'current')) or 0

-- 漏桶算法：计算当前水位
local elapsed = now - tonumber(leakTime)
local leaked = math.floor(elapsed * leakRate)
local newLevel = currentLevel - leaked

-- 限制容量
newLevel = math.max(0, newLevel)

-- 消耗令牌（检查是否超限）
if tonumber(ARGV[4]) > newLevel then
    local consumed = math.min(ARGV[4], newLevel)
    redis.call('HSET', bucketKey, 'current', tostring(newLevel - consumed))
    redis.call('HSET', bucketKey, 'leak_time', tostring(now))
    return {1, 0} -- 成功，剩余容量为 0
else
    local waitTime = math.ceil((ARGV[4] - newLevel) / leakRate)
    return {0, waitTime} -- 限流，等待时间
end
LUA;

        $result = $this->redis->eval(
            $script,
            [$bucketKey, $maxCapacity, $leakRate, time(), $tokens],
            1
        );

        return [
            'success' => $result[0] == 1,
            'wait_time' => (int)$result[1],
        ];
    }
}
```

## 踩坑记录 #5：Redis 内存泄漏

**问题描述**：生产环境 Redis 内存持续上升，CPU 占用率增加。

**Before**: 简单计数器，无清理策略
```php
$redis->incr("ratelimit:{$ip}:{$key}");
```

**After**: 定时清理过期键 + TTL 自动失效
```php
// config/rate-limiter.php
'cache_expiration' => [
    'window_size' => 30, // 窗口大小（秒）
    'cleanup_interval' => 60, // 清理间隔（秒）
],

// 定时任务：清理过期限流键
/**
 * app/Console/Commands/CleanupRateLimiters.php
 */
class CleanupRateLimiters extends Command {
    public function handle() {
        $redis = new Redis();
        $redis->connect(env('REDIS_HOST', '127.0.0.1'), 6379);
        
        // 查找所有过期的限流键
        $pattern = "ratelimit:*";
        $keysToDel = [];
        
        while ($key = $redis->scan(
            iterator: true,
            match: $pattern,
            count: 100,
        )) {
            if (!($this->redis->ttl($key) > 0)) {
                $keysToDel[] = $key;
            }
        }
        
        // 批量删除过期键
        if ($keysToDel) {
            $this->redis->del(...$keysToDel);
            $this->info("Cleaned up " . count($keysToDel) . " expired rate limiter keys");
        }
    }
}

// 启动定时任务（每小时清理一次）
$kernel = new ConsoleKernel();
$kernel->schedule(function ($schedule) {
    $schedule->command('app:cleanup-rate-limiters')
        ->everyMinute(); // 每分钟执行一次清理
});
```

## 踩坑记录 #6：限流响应头设置错误

**问题描述**：前端无法正确识别限流，用户误以为服务异常。

**Before**:
```php
// app/Exceptions/RateLimitException.php - 错误实现
class RateLimitException extends \Exception {
    public function render($request): Response 
    {
        return response()->json([
            'message' => 'Too Many Requests',
            'retry_after' => $this->retryAfter,
        ], 429); // 返回 JSON，无响应头
    }
}
```

**After**:
```php
// app/Exceptions/RateLimitException.php - 正确实现
class RateLimitException extends \Exception {
    public function render($request): Response 
    {
        $retryAfter = $this->retryAfter ?? 60;
        
        return response()->json([
            'message' => "Too many requests. Please wait {$retryAfter} seconds.",
            'type' => 'rate_limited',
            'retry_after' => $retryAfter,
        ], 429)
            ->withHeader('Retry-After', (string)$retryAfter)
            ->withHeader('X-RateLimit-Limit', '100')
            ->withHeader('X-RateLimit-Remaining', '0')
            ->withHeader('X-RateLimit-Reset', (string)(time() + $retryAfter));
    }
}
```

## 踩坑记录 #7：Token Bucket 竞态条件修复

**问题描述**：在高并发场景下，Token Bucket 存在竞态条件。

**Before**:
```php
// app/Services/RateLimiter.php - 存在竞态条件的实现
public function checkAndConsume($ip, $key, $tokens = 1): array 
{
    // 错误：先读取令牌数，再判断是否消耗
    $currentTokens = $this->redis->get("ratelimit:{$ip}:{$key}");
    
    if ($currentTokens < $tokens) {
        return ['success' => false, 'retry_after' => 30];
    }
    
    // 问题：读取和消耗不是原子性操作，存在竞态条件
    $this->redis->set("ratelimit:{$ip}:{$key}", (int)$currentTokens - $tokens);
    
    return ['success' => true];
}
```

**After**: 使用 Lua 脚本确保原子性
```php
public function checkAndConsume($ip, $key, $tokens = 1): array 
{
    $script = <<<'LUA'
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local addRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local currentTokens = tonumber(redis.call('HGET', key, 'tokens') or tostring(maxTokens))

if currentTokens >= tonumber(ARGV[4]) then
    local consumed = math.min(ARGV[4], currentTokens)
    redis.call('HSET', key, 'tokens', tostring(currentTokens - consumed))
    return {1, tostring(currentTokens - consumed)}
else
    local waitTime = math.ceil((ARGV[4] - currentTokens) / addRate)
    return {0, tostring(waitTime)}
end
LUA;

    $result = $this->redis->eval(
        $script,
        ["ratelimit:tokens:{$ip}:{$key}", $maxTokens, $addRate, time(), $tokens],
        1
    );

    return [
        'success' => $result[0] == 1,
        'remaining_tokens' => (float)$result[1],
        'retry_after' => $result[0] == 0 ? $result[1] : 0,
    ];
}
```

## 踩坑记录 #8：Redis 连接池配置不当

**问题描述**：在高并发场景下，Redis 连接池耗尽导致限流失效。

**Before**:
```php
// config/database.php - Redis 连接池配置错误
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => 1,
        'read_timeout' => 0, // ❌ 错误：未设置超时时间
    ],
],
```

**After**:
```php
// config/database.php - Redis 连接池配置优化
'connections' => [
    'redis-limiter' => [
        'driver' => 'redis',
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => env('REDIS_DB', 2),
        'read_timeout' => 5, // ✅ 设置超时时间，避免无限等待
        'write_timeout' => 5,
    ],
],

// 使用独立连接池
'connections' => [
    'redis-limiter' => [
        'driver' => 'redis',
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => env('REDIS_DB', 2),
        'read_timeout' => 5,
        'write_timeout' => 5,
    ],
],
```

## 踩坑记录 #9：Token Bucket 容量设置不当

**问题描述**：`MAX_TOKENS` 设置过小，导致用户误以为被限流。

**Before**:
```php
// config/rate-limiter.php - Token Bucket 配置
'rate_limiters' => [
    'api_search' => [
        'max_tokens' => 100,   // ❌ 错误：太小
        'add_rate' => 50,      // ❌ 错误：补充速率太低
    ],
],
```

**After**:
```php
// config/rate-limiter.php - Token Bucket 配置优化
'rate_limiters' => [
    'api_search' => [
        'max_tokens' => 1000,   // ✅ 设置合理容量（每秒 1000 次）
        'add_rate' => 200,      // ✅ 补充速率适中
        'window_size' => 30,    // ✅ 窗口大小（秒）
    ],
    'api_price' => [
        'max_tokens' => 50,     // ✅ 低频接口限制更小
        'add_rate' => 20,       // ✅ 补充速率更低
        'window_size' => 60,    // ✅ 窗口大小（秒）
    ],
],
```

## 踩坑记录 #10：限流策略配置不灵活

**问题描述**：单一配置文件无法应对不同 API 的需求。

**Before**:
```php
// config/rate-limiter.php - 固定配置，不灵活
'rate_limiters' => [
    'api' => [
        'max_tokens' => 100,
        'add_rate' => 50,
    ],
],
```

**After**: 支持动态配置 + 环境变量覆盖
```php
// config/rate-limiter.php - 灵活配置
'rate_limiters' => [
    // 默认配置（可从环境变量覆盖）
    'api_search' => [
        'max_tokens' => (int)(env('RATE_LIMIT_API_SEARCH_MAX_TOKENS', 1000)),
        'add_rate' => (int)(env('RATE_LIMIT_API_SEARCH_ADD_RATE', 200)),
        'window_size' => (int)(env('RATE_LIMIT_WINDOW_SIZE', 30)),
    ],
    
    // 动态配置（支持按 API 路由分组）
    'api_price' => [
        'max_tokens' => (int)(env('RATE_LIMIT_API_PRICE_MAX_TOKENS', 50)),
        'add_rate' => (int)(env('RATE_LIMIT_API_PRICE_ADD_RATE', 20)),
        'window_size' => (int)(env('RATE_LIMIT_WINDOW_SIZE', 60)),
    ],
],

// app/Services/RateLimiter.php - 支持动态配置
class RateLimiterService {
    public function checkAndConsume($ip, $key, $tokens = 1): array 
    {
        // 读取配置文件
        $config = config('rate-limiter.rate_limiters.' . $key);
        
        if (!$config) {
            return ['success' => true]; // 默认不限制
        }
        
        $maxTokens = $config['max_tokens'];
        $addRate = $config['add_rate'];
        $windowSize = $config['window_size'] ?? 30;
        
        // ... 使用 Lua 脚本执行限流逻辑
    }
}
```

## 踩坑记录 #11：限流日志缺失导致问题难排查

**问题描述**：限流发生后，无法追踪哪些 IP/接口被限制。

**Before**: 无日志输出
```php
// app/Services/RateLimiter.php - 无日志
public function checkAndConsume($ip, $key, $tokens = 1): array 
{
    // ... 执行限流逻辑
}
```

**After**:
```php
app/Services/RateLimiter.php - 支持日志输出
class RateLimiterService {
    public function checkAndConsume($ip, $key, $tokens = 1): array 
    {
        // ... 执行限流逻辑
        
        if (!$result['success']) {
            Log::info(
                'Rate limit exceeded',
                [
                    'ip' => $ip,
                    'key' => $key,
                    'retry_after' => $result['retry_after'],
                ]
            );
        }
        
        return $result;
    }
}

// app/Console/Commands/RateLimitDashboard.php - 限流监控命令
class RateLimitDashboard extends Command {
    public function handle() 
    {
        $redis = new Redis();
        $redis->connect(env('REDIS_HOST', '127.0.0.1'), 6379);
        
        // 统计每个 IP 的限流次数
        $pattern = "ratelimit:*";
        $ipLimitCount = [];
        
        while ($key = $redis->scan(iterator: true, match: $pattern, count: 100)) {
            if (preg_match('/^ratelimit:(tokens|leaky):(\d+\.?\d*)(.+)$(/', $key, $matches)) {
                $ip = ip2long($matches[2]); // IPv4/IPv6 转换
                $count = substr_count($key, ':');
                $ipLimitCount[$ip] = $count;
            }
        }
        
        // 输出统计结果
        ksort($ipLimitCount);
        foreach ($ipLimitCount as $ip => $count) {
            $this->info("IP: {$ip}, Count: {$count}");
        }
    }
}

// 启动定时任务（每小时执行一次）
$kernel = new ConsoleKernel();
$kernel->schedule(function ($schedule) {
    $schedule->command('app:rate-limit-dashboard')
        ->hourly(); // 每小时执行一次统计
});
```

## 踩坑记录 #12：限流与业务逻辑耦合严重

**问题描述**：限流逻辑分散在 Controller、Service、Middleware，难以维护。

**Before**:
```php
// app/Http/Middleware/CheckRateLimit.php - 限流逻辑与中间件耦合
class CheckRateLimit implements MiddlewareInterface {
    public function process(Request $request, Closure $handler): Response 
    {
        $ip = $this->getIp($request);
        $key = "api_{$request->method()}_{$request->path()}";
        
        // ... 执行限流逻辑
        
        return response()->json(['success' => false, 'message' => 'Too many requests']);
    }
}

// app/Controllers/SearchController.php - Controller 中也有限流逻辑
class SearchController {
    public function search(Request $request) 
    {
        // ... 检查限流
    }
}
```

**After**: 使用中间件集中处理 + Service 解耦
```php
// app/Http/Middleware/RateLimitMiddleware.php - 集中处理限流逻辑
class RateLimitMiddleware implements MiddlewareInterface {
    public function process(Request $request, Closure $handler): Response 
    {
        $ip = $this->getIp($request);
        $key = "api_{$request->method()}_{$request->path()}";
        
        // 调用 Service 层检查限流
        $rateLimiterService = app(RateLimiterService::class);
        $result = $rateLimiterService->checkAndConsume($ip, $key);
        
        if (!$result['success']) {
            throw new RateLimitException(
                message: "Too many requests. Please wait {$result['retry_after']} seconds.",
                retryAfter: $result['retry_after'],
            );
        }
        
        return $handler($request);
    }
}

// app/Http/Middleware/Authenticate.php - 认证中间件优先于限流
class Authenticate implements MiddlewareInterface {
    public function process(Request $request, Closure $handler): Response 
    {
        // ... 认证逻辑
    }
}

// app/Kernel.php - 中间件顺序
protected $middleware = [
    \Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode::class,
    
    \Illuminate\Session\Middleware\AuthenticateSession::class,
    
    \Illuminate\Routing\Middleware\SubstituteBindings::class,
    
    // RateLimitMiddleware - 在 Authenticate 之后，确保已认证才限流
    \App\Http\Middleware\RateLimitMiddleware::class,
];

// app/Controllers/SearchController.php - Controller 无侵入
class SearchController {
    public function search(Request $request) 
    {
        // ... 业务逻辑（无需关心限流）
        
        $searchResults = $this->service->search($request->query);
        return response()->json([
            'data' => $searchResults,
        ]);
    }
}
```

## 踩坑记录 #13：限流响应时间过长影响用户体验

**问题描述**：`Retry-After` 时间设置过长，导致用户误以为服务异常。

**Before**:
```php
// config/rate-limiter.php - Retry-After 默认 60 秒（太长）
'retry_after' => 60, // ❌ 错误：默认重试时间太长
```

**After**:
```php
// config/rate-limiter.php - Retry-After 优化
'retry_after' => (int)(env('RATE_LIMIT_RETRY_AFTER', 30)), // ✅ 默认 30 秒（合理）

// app/Exceptions/RateLimitException.php - 支持动态重试时间
class RateLimitException extends \Exception {
    public function render($request): Response 
    {
        $retryAfter = $this->retryAfter ?? (int)(env('RATE_LIMIT_RETRY_AFTER', 30));
        
        return response()->json([
            'message' => "Too many requests. Please wait {$retryAfter} seconds.",
            'type' => 'rate_limited',
            'retry_after' => $retryAfter,
        ], 429)
            ->withHeader('Retry-After', (string)$retryAfter);
    }
}
```

## 踩坑记录 #14：限流策略与业务逻辑不匹配

**问题描述**：限流策略与业务逻辑不匹配，导致部分接口被过度限制。

**Before**:
```php
// config/rate-limiter.php - 固定配置，不区分接口类型
'rate_limiters' => [
    'api' => [
        'max_tokens' => 100, // ❌ 错误：统一限制所有接口
    ],
],
```

**After**:
```php
// config/rate-limiter.php - 支持按接口类型分组配置
'rate_limiters' => [
    'api_search' => [
        'max_tokens' => (int)(env('RATE_LIMIT_API_SEARCH_MAX_TOKENS', 1000)), // ✅ 搜索接口：较高限制
        'add_rate' => (int)(env('RATE_LIMIT_API_SEARCH_ADD_RATE', 200)),
    ],
    
    'api_price' => [
        'max_tokens' => (int)(env('RATE_LIMIT_API_PRICE_MAX_TOKENS', 50)), // ✅ 价格接口：较低限制
        'add_rate' => (int)(env('RATE_LIMIT_API_PRICE_ADD_RATE', 20)),
    ],
    
    'api_order' => [
        'max_tokens' => (int)(env('RATE_LIMIT_API_ORDER_MAX_TOKENS', 100)), // ✅ 订单接口：严格限制
        'add_rate' => (int)(env('RATE_LIMIT_API_ORDER_ADD_RATE', 50)),
    ],
],

// app/Services/RateLimiter.php - 支持动态配置
class RateLimiterService {
    public function checkAndConsume($ip, $key, $tokens = 1): array 
    {
        // 读取配置文件
        $config = config('rate-limiter.rate_limiters.' . $key);
        
        if (!$config) {
            return ['success' => true]; // 默认不限制
        }
        
        // ... 使用 Lua 脚本执行限流逻辑
    }
}
```

## 踩坑记录 #15：限流与缓存策略冲突

**问题描述**：限流策略与缓存策略冲突，导致缓存失效时限流失效。

**Before**:
```php
// config/cache.php - Redis 配置
'connections' => [
    'redis' => [
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'port' => env('REDIS_PORT', 6379),
        'database' => 1, // ❌ 错误：与限流共用同一个数据库
    ],
],
```

**After**:
```php
// config/database.php - Redis 配置优化（独立连接池）
'connections' => [
    'redis-cache' => [
        'driver' => 'redis',
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => 1, // ✅ 缓存专用 DB
    ],
    
    'redis-limiter' => [
        'driver' => 'redis',
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => 2, // ✅ 限流专用 DB
    ],
    
    'redis-lock' => [
        'driver' => 'redis',
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => 3, // ✅ 锁专用 DB
    ],
],
```

## 踩坑记录 #16：限流策略与业务逻辑不匹配导致性能问题

**问题描述**：限流策略与业务逻辑不匹配，导致部分接口被过度限制。

**Before**:
```php
// app/Services/RateLimiter.php - 固定配置，不区分接口类型
class RateLimiterService {
    public function checkAndConsume($ip, $key, $tokens = 1): array 
    {
        // ❌ 错误：所有接口使用相同的限流策略
        return $this->consumeTokens($ip, $key);
    }
}
```

**After**:
```php
// app/Services/RateLimiter.php - 支持动态配置 + 业务逻辑解耦
class RateLimiterService {
    public function checkAndConsume($ip, $key, $tokens = 1): array 
    {
        // ✅ 动态读取配置文件，按接口类型分组配置
        $config = config('rate-limiter.rate_limiters.' . $key);
        
        if (!$config) {
            return ['success' => true]; // 默认不限制
        }
        
        $maxTokens = $config['max_tokens'];
        $addRate = $config['add_rate'];
        $windowSize = $config['window_size'] ?? 30;
        
        // 使用 Lua 脚本执行限流逻辑
        $key = "ratelimit:tokens:{$ip}:{$key}";
        $script = <<<'LUA'
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local addRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local currentTokens = tonumber(redis.call('HGET', key, 'tokens') or tostring(maxTokens))

if currentTokens >= tonumber(ARGV[4]) then
    local consumed = math.min(ARGV[4], currentTokens)
    redis.call('HSET', key, 'tokens', tostring(currentTokens - consumed))
    return {1, tostring(currentTokens - consumed)}
else
    local waitTime = math.ceil((ARGV[4] - currentTokens) / addRate)
    return {0, tostring(waitTime)}
end
LUA;

        $result = $this->redis->eval(
            $script,
            [$key, $maxTokens, $addRate, time(), $tokens],
            1
        );

        return [
            'success' => $result[0] == 1,
            'remaining_tokens' => (float)$result[1],
            'retry_after' => $result[0] == 0 ? $result[1] : 0,
        ];
    }
}
```

## 限流算法全面对比

| 维度 | 固定窗口 (Fixed Window) | 滑动窗口 (Sliding Window) | 令牌桶 (Token Bucket) | 漏桶 (Leaky Bucket) |
|------|------------------------|--------------------------|----------------------|---------------------|
| **核心原理** | 固定时间段内计数 | 滑动时间窗口内记录请求时间戳 | 桶中存放令牌，请求消耗令牌 | 桶中存放请求，匀速漏出 |
| **突发流量处理** | ❌ 窗口边界突发 | ✅ 平滑过渡 | ✅ 允许短暂突发（桶容量内） | ❌ 严格匀速输出 |
| **实现复杂度** | ⭐ 低 | ⭐⭐ 中 | ⭐⭐⭐ 高（Lua 脚本） | ⭐⭐⭐ 高（Lua 脚本） |
| **内存占用** | 低（单计数器） | 高（记录时间戳列表） | 中（Hash 结构） | 中（Hash 结构） |
| **Redis 原子性** | `INCR` + `EXPIRE` | `ZADD` + `ZREMRANGEBYSCORE` | Lua 脚本 | Lua 脚本 |
| **适用场景** | 简单场景、低并发 | 通用场景、API 限流 | 高并发 API、允许突发 | 严格速率控制、低频接口 |
| **KKday 使用** | ❌ 已弃用 | ✅ 搜索接口 | ✅ 核心 API | ✅ 价格查询、订单创建 |

### 选型建议

```php
// 场景 1：搜索类接口（高并发 + 允许突发） → Token Bucket
$searchRateLimiter = RateLimiter::for('api_search')
    ->limit(1000)        // 桶容量 1000
    ->perSecond();       // 每秒补充 200 令牌

// 场景 2：价格查询（低频 + 严格速率） → Leaky Bucket
$priceRateLimiter = RateLimiter::for('api_price')
    ->limit(50)          // 桶容量 50
    ->perMinute();       // 每分钟漏出 20 个请求

// 场景 3：通用 API 限流 → Sliding Window
$generalRateLimiter = RateLimiter::for('api_general')
    ->limit(100)         // 每分钟 100 次
    ->perMinute();       // 滑动窗口计算

// 场景 4：简单内部服务 → Fixed Window（不推荐生产环境使用）
$internalRateLimiter = RateLimiter::for('api_internal')
    ->limit(60)
    ->perMinute();
```

## 总结

本文档详细记录了 KKday B2C API 在接口限流（API Rate Limiting）方面的完整实战经验，涵盖了以下核心内容：

### 核心主题
- **Token Bucket 令牌桶算法** + Lua 脚本实现原子性
- **Leaky Bucket 漏桶算法** + Redis 分布式存储
- **滑动窗口算法（Sliding Window Log）** + 定时清理过期键
- **IP 指纹识别** + `X-Forwarded-For` 处理

### 踩坑记录
- ✅ 固定时间窗口不精准
- ✅ Redis 驱动配置错误
- ✅ Lua 脚本内存泄漏
- ✅ IP 指纹被绕过
- ✅ Redis 内存泄漏
- ✅ 限流响应头设置错误
- ✅ Token Bucket 竞态条件
- ✅ Redis 连接池配置不当
- ✅ Token Bucket 容量设置不当
- ✅ 限流策略配置不灵活
- ✅ 限流日志缺失
- ✅ 限流与业务逻辑耦合严重
- ✅ 限流响应时间过长
- ✅ 限流策略与缓存策略冲突

### 技术栈
- **PHP 8** + Laravel 8
- **Redis** + Lua 脚本原子性操作
- **Nginx** + `X-Real-IP` + `X-Forwarded-For`

### 实践建议
1. **限流策略配置要灵活**：支持按接口类型分组配置
2. **使用 Lua 脚本确保原子性**：避免竞态条件
3. **独立连接池**：缓存/限流/锁使用不同 Redis DB
4. **定时清理过期键**：避免内存泄漏
5. **日志记录限流事件**：便于问题排查

希望本文档对读者有所帮助！如果有任何问题，欢迎留言讨论。👋

---
*作者：Michael | KKday RD B2C Backend Team | 2026-05-03*

---

## 📚 延伸阅读

- [AI Agent 限流与配额管理：Token Bucket + 滑动窗口 + 多租户隔离](/post/ai-agent-rate-limiting-quota-token-bucket-sliding-window-tenant-quota/) — 面向 AI Agent 场景的限流方案升级，支持多租户配额隔离
- [API 安全加固实战：JWT 黑名单 · 请求签名 · IP 白名单 · 防重放攻击](/post/api-jwt-ip-laravel-b2c/) — 限流之外的安全防线，JWT + 签名 + 防重放全链路防护
- [API Abuse Prevention 实战：Bot 检测 · 速率限制 · 指纹识别](/post/api-abuse-prevention-bot-laravel/) — 从限流到反滥用的工程化演进，Bot 检测 + 指纹识别实战
