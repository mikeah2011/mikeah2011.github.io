---
title: API 网关安全实战：请求签名验证、重放攻击防护、IP 信誉库——Laravel 微服务的网关层安全治理
keywords: [API, IP, Laravel, 网关安全实战, 请求签名验证, 重放攻击防护, 信誉库, 微服务的网关层安全治理, 架构]
date: 2026-06-09 22:40:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - API安全
  - 网关
  - Laravel
  - 微服务
  - HMAC
  - 重放攻击
description: 从请求签名验证、重放攻击防护、IP 信誉库三个维度，深入讲解 Laravel 微服务架构中 API 网关层的安全治理方案，附完整可运行代码和踩坑记录。
---


# API 网关安全实战：请求签名验证、重放攻击防护、IP 信誉库

## 概述

微服务架构下，API 网关是所有外部请求的唯一入口。攻击者只需要打穿网关，就能直达所有后端服务。传统的「认证 + 授权」已经不够用了——请求在传输过程中被篡改、被重放、来自恶意 IP，这些都是网关层必须拦截的问题。

本文从三个核心维度展开：

1. **请求签名验证**：确保请求在传输过程中没有被篡改
2. **重放攻击防护**：防止攻击者截获合法请求并重复发送
3. **IP 信誉库**：基于 IP 行为数据自动拦截恶意来源

所有代码基于 Laravel 8，可以直接集成到你的网关服务中。

---

## 一、请求签名验证

### 为什么需要签名？

HTTP 请求本质上是明文传输。即使上了 HTTPS，如果攻击者拿到了合法的 API Key，就可以伪造任意请求。请求签名的核心思路是：**客户端用密钥对请求内容生成签名，服务端用同样的算法验证签名**。这样即使请求被截获，攻击者也无法伪造签名（因为没有密钥）。

### 签名算法设计

业界主流的签名算法有 HMAC-SHA256 和 RSA-SHA256。对于内部微服务间通信，HMAC 足够且性能更好；对外暴露的 API 可以考虑 RSA 以实现非对称签名。

我们的方案基于 HMAC-SHA256，签名字符串的构造规则：

```
StringToSign = HTTP_METHOD + "\n"
             + REQUEST_URI + "\n"
             + SORTED_QUERY_STRING + "\n"
             + TIMESTAMP + "\n"
             + NONCE + "\n"
             + SHA256(REQUEST_BODY)
```

### Laravel Middleware 实现

新建 `app/Http/Middleware/VerifyRequestSignature.php`：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class VerifyRequestSignature
{
    // 签名过期时间（秒）
    const EXPIRY = 300;

    // nonce 缓存时间（秒）
    const NONCE_TTL = 600;

    public function handle(Request $request, Closure $next)
    {
        // 1. 检查必填头
        $appId     = $request->header('X-App-Id');
        $timestamp = $request->header('X-Timestamp');
        $nonce     = $request->header('X-Nonce');
        $signature = $request->header('X-Signature');

        if (!$appId || !$timestamp || !$nonce || !$signature) {
            return response()->json([
                'error' => 'missing_required_headers',
                'message' => 'X-App-Id, X-Timestamp, X-Nonce, X-Signature are required',
            ], 401);
        }

        // 2. 时间戳校验（防止过期请求）
        $now = time();
        if (abs($now - (int)$timestamp) > self::EXPIRY) {
            return response()->json([
                'error' => 'request_expired',
                'message' => 'Request timestamp is expired',
            ], 401);
        }

        // 3. Nonce 防重放检查
        $nonceKey = "api_nonce:{$appId}:{$nonce}";
        if (Cache::has($nonceKey)) {
            return response()->json([
                'error' => 'nonce_reused',
                'message' => 'Nonce has already been used',
            ], 401);
        }
        Cache::put($nonceKey, true, self::NONCE_TTL);

        // 4. 获取 App 密钥
        $secret = $this->getAppSecret($appId);
        if (!$secret) {
            return response()->json([
                'error' => 'invalid_app',
                'message' => 'App not found or disabled',
            ], 401);
        }

        // 5. 构造签名字符串
        $bodyHash = hash('sha256', $request->getContent() ?: '');
        $queryString = $this->getSortedQueryString($request);

        $stringToSign = strtoupper($request->method()) . "\n"
            . $request->path() . "\n"
            . $queryString . "\n"
            . $timestamp . "\n"
            . $nonce . "\n"
            . $bodyHash;

        // 6. 计算预期签名
        $expectedSignature = hash_hmac('sha256', $stringToSign, $secret);

        // 7. 恒定时间比较，防止时序攻击
        if (!hash_equals($expectedSignature, $signature)) {
            return response()->json([
                'error' => 'signature_mismatch',
                'message' => 'Request signature is invalid',
            ], 401);
        }

        // 8. 通过，注入 app 信息供后续使用
        $request->merge(['_app_id' => $appId]);

        return $next($request);
    }

    /**
     * 获取 App 密钥（实际应从数据库或配置中心读取）
     */
    private function getAppSecret(string $appId): ?string
    {
        // 生产环境建议从 Redis 缓存或数据库读取
        $apps = [
            'app-order-service' => 'sk_order_abc123def456',
            'app-user-service'  => 'sk_user_xyz789ghi012',
            'app-gateway-admin' => 'sk_admin_mno345pqr678',
        ];

        return $apps[$appId] ?? null;
    }

    /**
     * 获取排序后的查询字符串
     */
    private function getSortedQueryString(Request $request): string
    {
        $params = $request->query();
        ksort($params);

        $pairs = [];
        foreach ($params as $key => $value) {
            $pairs[] = $key . '=' . $value;
        }

        return implode('&', $pairs);
    }
}
```

注册到 `app/Http/Kernel.php`：

```php
protected $middlewareGroups = [
    'api' => [
        \App\Http\Middleware\VerifyRequestSignature::class,
        // ... 其他中间件
    ],
];
```

### 客户端签名 SDK

提供一个 PHP 客户端，供内部服务调用时生成签名：

```php
<?php

namespace App\Support;

class ApiSigner
{
    private string $appId;
    private string $secret;

    public function __construct(string $appId, string $secret)
    {
        $this->appId  = $appId;
        $this->secret = $secret;
    }

    /**
     * 为请求附加签名头
     */
    public function signRequest(string $method, string $url, array $body = []): array
    {
        $timestamp = (string) time();
        $nonce     = Str::random(32);

        $bodyContent = $body ? json_encode($body, JSON_UNESCAPED_SLASHES) : '';
        $bodyHash    = hash('sha256', $bodyContent);

        $parsedUrl = parse_url($url);
        $path      = $parsedUrl['path'] ?? '/';
        $queryString = $this->sortQueryString($parsedUrl['query'] ?? '');

        $stringToSign = strtoupper($method) . "\n"
            . $path . "\n"
            . $queryString . "\n"
            . $timestamp . "\n"
            . $nonce . "\n"
            . $bodyHash;

        $signature = hash_hmac('sha256', $stringToSign, $this->secret);

        return [
            'X-App-Id'     => $this->appId,
            'X-Timestamp'  => $timestamp,
            'X-Nonce'      => $nonce,
            'X-Signature'  => $signature,
        ];
    }

    private function sortQueryString(string $query): string
    {
        if (empty($query)) return '';

        parse_str($query, $params);
        ksort($params);

        $pairs = [];
        foreach ($params as $k => $v) {
            $pairs[] = $k . '=' . $v;
        }

        return implode('&', $pairs);
    }
}
```

使用示例：

```php
$signer = new ApiSigner('app-order-service', 'sk_order_abc123def456');
$headers = $signer->signRequest('POST', '/api/v1/orders', ['product_id' => 42, 'qty' => 1]);

$response = Http::withHeaders($headers)
    ->withBody(json_encode(['product_id' => 42, 'qty' => 1]), 'application/json')
    ->post('https://api.internal.example.com/api/v1/orders');
```

---

## 二、重放攻击防护

### 什么是重放攻击？

重放攻击（Replay Attack）是指攻击者截获一个合法的请求，然后原封不动地再次发送。即使有签名验证，如果签名本身没有时效性约束，同一个签名可以被无限次使用。

上面的签名方案已经包含了 **时间戳校验** 和 **Nonce 去重**，但这两个机制各有局限：

- 时间戳校验只防住了超过窗口期的请求
- Nonce 去重依赖 Redis，高并发下可能有性能问题

我们需要更完善的方案。

### 多层防重放策略

#### 策略一：Nonce + Redis（已实现）

上面的签名中间件已经包含了 Nonce 检查。简单回顾：

```php
// Nonce 存入 Redis，设置 TTL 为签名窗口的 2 倍
$nonceKey = "api_nonce:{$appId}:{$nonce}";
if (Cache::has($nonceKey)) {
    // 重放！拒绝
    return response()->json(['error' => 'nonce_reused'], 401);
}
Cache::put($nonceKey, true, self::NONCE_TTL);
```

**问题**：Redis 在高并发下是非原子操作。两个相同 Nonce 的请求可能同时通过 `has` 检查。

#### 策略二：Redis SET NX 原子操作

改用 `SET NX` 确保原子性：

```php
$nonceKey = "api_nonce:{$appId}:{$nonce}";

// SET NX + TTL，原子操作
$acquired = Cache::add($nonceKey, 1, self::NONCE_TTL);

if (!$acquired) {
    return response()->json([
        'error' => 'nonce_reused',
        'message' => 'Duplicate request detected',
    ], 401);
}
```

`Cache::add()` 在 Redis 层面等价于 `SET key value NX EX ttl`，是原子操作。

#### 策略三：滑动窗口计数器

对于已知的恶意来源，即使每次用不同 Nonce，我们也可以用滑动窗口限制请求频率：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class RateLimiter
{
    /**
     * 滑动窗口限流：N 秒内最多 M 次请求
     */
    public function handle(Request $request, Closure $next, string $limit = '60,100')
    {
        [$windowSeconds, $maxRequests] = explode(',', $limit);

        $appId = $request->header('X-App-Id') ?? $request->ip();
        $key   = "rate_limit:{$appId}";

        // 用 Redis ZSET 实现滑动窗口
        $now       = microtime(true) * 1000;
        $windowMs  = (int) $windowSeconds * 1000;
        $windowStart = $now - $windowMs;

        $redis = Cache::store()->getStore();

        // 原子操作：移除过期记录 + 添加当前请求 + 统计数量
        $pipe = $redis->multi();
        $pipe->zremrangebyscore($key, 0, $windowStart);
        $pipe->zadd($key, [$now => $now]);
        $pipe->zcard($key);
        $pipe->expire($key, (int) $windowSeconds + 1);
        $results = $pipe->exec();

        $requestCount = $results[2] ?? 0;

        if ($requestCount > $maxRequests) {
            return response()->json([
                'error'   => 'rate_limit_exceeded',
                'message' => "Rate limit: {$maxRequests} requests per {$windowSeconds}s",
                'retry_after' => (int) $windowSeconds,
            ], 429);
        }

        // 附加限流信息到响应头
        $response = $next($request);
        $response->header('X-RateLimit-Limit', $maxRequests);
        $response->header('X-RateLimit-Remaining', max(0, $maxRequests - $requestCount));
        $response->header('X-RateLimit-Reset', ceil(($now + $windowMs) / 1000));

        return $response;
    }
}
```

#### 策略四：请求指纹（高级）

对于需要更强防重放的场景（如支付接口），可以给请求生成指纹：

```php
/**
 * 生成请求指纹，用于防重放
 * 结合了 AppId + 方法 + 路径 + 参数哈希 + 时间窗口
 */
private function generateFingerprint(Request $request): string
{
    $window = floor(time() / 300) * 300; // 5 分钟时间窗口
    $payload = implode(':', [
        $request->header('X-App-Id'),
        $request->method(),
        $request->path(),
        $request->getContent(),
        $window,
    ]);

    return hash('sha256', $payload);
}
```

### 防重放策略对比

| 策略 | 适用场景 | Redis 依赖 | 原子性 | 性能 |
|------|---------|-----------|--------|------|
| Nonce + Cache::add | 通用 API | 是 | 原子 | 高 |
| 滑动窗口 ZSET | 限流场景 | 是 | 原子 | 中 |
| 时间戳校验 | 基础防护 | 否 | N/A | 极高 |
| 请求指纹 | 支付等高安全场景 | 是 | 原子 | 中 |

---

## 三、IP 信誉库

### 为什么需要 IP 信誉库？

签名验证解决了「请求是否被篡改」的问题，但无法识别「请求来源是否可信」。一个持有合法密钥的被黑客户端，或者一个来自已知恶意 IP 段的请求，签名验证是拦不住的。

IP 信誉库的核心思路：**基于 IP 的历史行为数据，给每个 IP 打分，低于阈值的自动拦截**。

### 信誉评分体系

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class IpReputationService
{
    /**
     * IP 信誉评分维度及权重
     */
    const DIMENSIONS = [
        'abuse_score'    => 0.35,  // AbuseIPDB 等外部数据源
        'fail_rate'      => 0.25,  // 本地认证失败率
        'request_pattern'=> 0.20,  // 请求模式异常度
        'geo_risk'       => 0.10,  // 地理位置风险
        'blocklist_hit'  => 0.10,  // 黑名单命中
    ];

    // 信誉阈值：低于此值拒绝请求
    const REJECTION_THRESHOLD = 30;

    // 警告阈值：低于此值增加验证步骤
    const WARNING_THRESHOLD = 60;

    /**
     * 获取 IP 综合信誉评分（0-100，越高越安全）
     */
    public function getScore(string $ip): array
    {
        $scores = [];

        // 1. 外部 Abuse 数据
        $scores['abuse_score'] = $this->getAbuseScore($ip);

        // 2. 本地失败率
        $scores['fail_rate'] = $this->getFailureRateScore($ip);

        // 3. 请求模式分析
        $scores['request_pattern'] = $this->getRequestPatternScore($ip);

        // 4. 地理风险
        $scores['geo_risk'] = $this->getGeoRiskScore($ip);

        // 5. 黑名单
        $scores['blocklist_hit'] = $this->getBlocklistScore($ip);

        // 加权总分
        $totalScore = 0;
        foreach (self::DIMENSIONS as $dimension => $weight) {
            $totalScore += ($scores[$dimension] ?? 50) * $weight;
        }

        return [
            'ip'          => $ip,
            'total_score' => round($totalScore, 2),
            'dimensions'  => $scores,
            'action'      => $this->decideAction($totalScore),
        ];
    }

    /**
     * 记录请求失败（用于计算失败率）
     */
    public function recordFailure(string $ip, string $reason): void
    {
        $key = "ip_failures:{$ip}";
        $failures = Cache::get($key, []);
        $failures[] = [
            'time'   => now()->timestamp,
            'reason' => $reason,
        ];

        // 只保留最近 1 小时的记录
        $oneHourAgo = now()->subHour()->timestamp;
        $failures = array_filter($failures, fn($f) => $f['time'] > $oneHourAgo);

        Cache::put($key, array_values($failures), 7200);
    }

    /**
     * 查询 AbuseIPDB（需 API Key）
     */
    private function getAbuseScore(string $ip): float
    {
        $cacheKey = "abuse_score:{$ip}";
        $cached = Cache::get($cacheKey);
        if ($cached !== null) return $cached;

        $apiKey = config('services.abuseipdb.key');
        if (!$apiKey) return 50; // 无 API Key 时返回中性分

        try {
            $response = Http::withHeaders([
                'Key'    => $apiKey,
                'Accept' => 'application/json',
            ])->get('https://api.abuseipdb.com/api/v2/check', [
                'ipAddress'  => $ip,
                'maxAgeInDays' => 90,
            ]);

            if ($response->successful()) {
                $abuseConfidence = $response->json('data.abuseConfidenceScore', 0);
                // AbuseIPDB 分数越高越危险，我们要反转
                $score = 100 - $abuseConfidence;
                Cache::put($cacheKey, $score, 86400);
                return $score;
            }
        } catch (\Exception $e) {
            // 查询失败，返回中性分
        }

        return 50;
    }

    /**
     * 本地认证失败率评分
     * 失败率越高，分数越低
     */
    private function getFailureRateScore(string $ip): float
    {
        $failures = Cache::get("ip_failures:{$ip}", []);
        $count = count($failures);

        // 1 小时内 0 次失败 → 100 分
        // 1 小时内 5+ 次失败 → 0 分
        if ($count === 0) return 100;
        if ($count >= 5) return 0;

        return 100 - ($count * 20);
    }

    /**
     * 请求模式异常度
     * 检测：突发高频请求、非常规时间访问、异常 User-Agent
     */
    private function getRequestPatternScore(string $ip): float
    {
        $key = "ip_patterns:{$ip}";
        $patterns = Cache::get($key, [
            'request_count_1m' => 0,
            'request_count_5m' => 0,
            'unique_paths_5m'  => 0,
            'avg_interval_ms'  => 0,
        ]);

        $score = 100;

        // 1 分钟内请求超过 50 次 → 扣分
        if ($patterns['request_count_1m'] > 50) {
            $score -= min(40, ($patterns['request_count_1m'] - 50) * 2);
        }

        // 5 分钟内请求过于均匀（机器人特征）→ 扣分
        if ($patterns['avg_interval_ms'] > 0 && $patterns['avg_interval_ms'] < 100) {
            $score -= 30; // 间隔 < 100ms 大概率是脚本
        }

        // 5 分钟内访问路径过少（扫描器特征）→ 扣分
        if ($patterns['request_count_5m'] > 20 && $patterns['unique_paths_5m'] < 3) {
            $score -= 25;
        }

        return max(0, $score);
    }

    /**
     * 地理位置风险评分
     * 高风险国家/地区扣分
     */
    private function getGeoRiskScore(string $ip): float
    {
        // 简化实现：使用 IP 地理位置服务
        // 生产环境建议用 MaxMind GeoIP2
        $geoKey = "ip_geo:{$ip}";
        $geo = Cache::get($geoKey);

        if (!$geo) {
            try {
                $response = Http::get("http://ip-api.com/json/{$ip}?fields=countryCode,hosting");
                if ($response->successful()) {
                    $geo = $response->json();
                    Cache::put($geoKey, $geo, 86400);
                }
            } catch (\Exception $e) {
                return 50;
            }
        }

        if (!$geo) return 50;

        // 已知高风险来源（示例）
        $highRiskCountries = ['XX', 'YY']; // 替换为实际列表
        $score = 100;

        if (in_array($geo['countryCode'] ?? '', $highRiskCountries)) {
            $score -= 30;
        }

        // 云服务器/数据中心 IP 扣分（扫描器常驻地）
        if (($geo['hosting'] ?? false) === true) {
            $score -= 15;
        }

        return max(0, $score);
    }

    /**
     * 黑名单命中评分
     */
    private function getBlocklistScore(string $ip): float
    {
        // 检查 Redis 黑名单
        if (Cache::has("ip_blocklist:{$ip}")) {
            return 0;
        }

        // 检查 CIDR 黑名单（如 TOR 出口节点、已知代理）
        $blacklistRanges = Cache::get('ip_blacklist_ranges', []);
        foreach ($blacklistRanges as $range) {
            if ($this->ipInCidr($ip, $range)) {
                return 20;
            }
        }

        return 100;
    }

    /**
     * 根据分数决定处理动作
     */
    private function decideAction(float $score): string
    {
        if ($score < self::REJECTION_THRESHOLD) return 'block';
        if ($score < self::WARNING_THRESHOLD) return 'challenge';
        return 'allow';
    }

    /**
     * CIDR 匹配（简化版）
     */
    private function ipInCidr(string $ip, string $cidr): bool
    {
        [$subnet, $mask] = explode('/', $cidr);
        $ipLong   = ip2long($ip);
        $subnetLong = ip2long($subnet);
        $maskLong   = -1 << (32 - (int) $mask);

        return ($ipLong & $maskLong) === ($subnetLong & $maskLong);
    }
}
```

### IP 信誉中间件

```php
<?php

namespace App\Http\Middleware;

use App\Services\IpReputationService;
use Closure;
use Illuminate\Http\Request;

class IpReputationCheck
{
    private IpReputationService $reputationService;

    public function __construct(IpReputationService $reputationService)
    {
        $this->reputationService = $reputationService;
    }

    public function handle(Request $request, Closure $next)
    {
        $ip = $request->ip();
        $result = $this->reputationService->getScore($ip);

        // 记录信誉日志（用于审计）
        logger('ip_reputation', [
            'ip'     => $ip,
            'score'  => $result['total_score'],
            'action' => $result['action'],
        ]);

        switch ($result['action']) {
            case 'block':
                return response()->json([
                    'error'   => 'ip_blocked',
                    'message' => 'Request denied due to IP reputation',
                ], 403);

            case 'challenge':
                // 增加额外验证（如要求更复杂的签名、CAPTCHA 等）
                $request->merge(['_reputation_challenge' => true]);
                break;

            case 'allow':
                break;
        }

        $response = $next($request);

        // 附加信誉信息到响应头（调试用，生产环境可关闭）
        $response->header('X-IP-Reputation', $result['total_score']);

        return $response;
    }
}
```

### 信誉数据维护脚本

定期更新 IP 信誉数据，避免过期数据影响判断：

```php
<?php

namespace App\Console\Commands;

use App\Services\IpReputationService;
use Illuminate\Console\Command;

class UpdateIpReputation extends Command
{
    protected $signature = 'ip:refresh-reputation
                            {--ip= : Specific IP to refresh}
                            {--clear-cache : Clear all reputation cache}';

    protected $description = 'Refresh IP reputation scores from external sources';

    public function handle(IpReputationService $reputationService): int
    {
        if ($this->option('clear-cache')) {
            // 清除所有信誉缓存
            $keys = cache()->getStore()->keys('abuse_score:*');
            foreach ($keys as $key) {
                cache()->forget($key);
            }
            $this->info('Cleared all reputation cache');
            return 0;
        }

        $ip = $this->option('ip');
        if ($ip) {
            $result = $reputationService->getScore($ip);
            $this->table(
                ['Dimension', 'Score'],
                array_merge(
                    [['Total', $result['total_score']]],
                    collect($result['dimensions'])->map(fn($v, $k) => [$k, $v])->values()->all()
                )
            );
            return 0;
        }

        // 批量刷新最近活跃 IP
        $recentIps = $this->getRecentlyActiveIps();
        $bar = $this->output->createProgressBar(count($recentIps));

        foreach ($recentIps as $ip) {
            $reputationService->getScore($ip);
            $bar->advance();
        }

        $bar->finish();
        $this->info("\nRefreshed " . count($recentIps) . " IP reputation scores");

        return 0;
    }

    private function getRecentlyActiveIps(): array
    {
        // 从请求日志中获取最近 24 小时活跃的 IP
        $logs = cache()->getStore()->keys('rate_limit:*');
        return array_map(fn($k) => str_replace('rate_limit:', '', $k), $logs);
    }
}
```

### 注册中间件

在 `app/Http/Kernel.php` 中注册：

```php
protected $middlewareGroups = [
    'api' => [
        \App\Http\Middleware\IpReputationCheck::class,  // 先查信誉
        \App\Http\Middleware\VerifyRequestSignature::class,  // 再验签名
        \App\Http\Middleware\RateLimiter::class,  // 最后限流
    ],
];
```

中间件顺序很重要：**信誉检查 → 签名验证 → 限流**。恶意 IP 在第一层就被拦住，避免浪费签名验证的计算资源。

---

## 四、整合方案

### 完整请求处理流程

```
客户端请求
    │
    ▼
┌─────────────────────┐
│  IP 信誉检查         │ ← 第一层：拦掉已知恶意 IP
│  (IpReputationCheck)│
└─────────┬───────────┘
          │ block → 403
          │ challenge → 附加验证
          │ allow ↓
┌─────────────────────┐
│  签名验证            │ ← 第二层：防篡改 + 防重放
│  (VerifySignature)  │
└─────────┬───────────┘
          │ 401 ↓
┌─────────────────────┐
│  滑动窗口限流        │ ← 第三层：防 DDoS
│  (RateLimiter)      │
└─────────┬───────────┘
          │ 429 ↓
┌─────────────────────┐
│  业务逻辑            │
└─────────────────────┘
```

### 安全响应头

在中间件中添加统一的安全响应头：

```php
// 在 Middleware 中追加
$response->header('X-Content-Type-Options', 'nosniff');
$response->header('X-Frame-Options', 'DENY');
$response->header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
$response->header('X-Request-Id', $request->header('X-Request-Id', Str::uuid()));
```

---

## 五、踩坑记录

### 坑 1：签名字符串的 Body Hash 问题

**现象**：客户端签名通过，但服务端验证失败。

**原因**：`$request->getContent()` 在中间件中获取的内容可能与客户端签名时的内容不同。Laravel 的中间件链中，某些中间件会消费请求体（如 `FormRequest`），导致后续中间件拿到的是空内容。

**解决**：在中间件链的最前面注册签名验证中间件，或者使用 `$request->getRealBody()` 配合 `php://input`：

```php
// 在 middleware 最前面注册，确保 body 未被消费
$requestBody = file_get_contents('php://input');
```

### 坑 2：Redis Nonce 并发竞态

**现象**：高并发下，相同的 Nonce 请求偶尔能通过。

**原因**：早期使用了 `Cache::has()` + `Cache::put()` 两步操作，非原子。

**解决**：改为 `Cache::add()`（底层 Redis `SET NX`），一次操作完成检查+写入。

### 坑 3：时区导致的时间戳计算偏差

**现象**：部分请求在时间戳校验时被误判为过期。

**原因**：`time()` 返回 UTC 时间戳，但 `strtotime()` 在某些环境下使用本地时区解析。

**解决**：全程使用 Unix 时间戳，不要依赖 `strtotime()` 或日期字符串解析。

### 坑 4：IP 信誉误杀合法流量

**现象**：使用云函数（AWS Lambda、阿里云 FC）的合法客户端被误杀。

**原因**：云函数的出口 IP 是共享的，可能被标记为高风险。

**解决**：
1. 信誉评分为多维度加权，单一维度异常不会直接判死
2. 添加白名单机制：对已知的合法云服务 IP 段设置信用加分
3. 对信誉「挑战」而非直接拒绝，增加二次验证

### 坑 5：HMAC 密钥管理

**现象**：密钥硬编码在代码中，泄露后无法快速轮换。

**解决**：
1. 密钥存储在环境变量或配置中心（如 Consul、Vault）
2. 支持密钥版本号，在签名头中传递 `X-Key-Version`
3. 实现密钥轮换窗口期：新旧密钥同时有效 24 小时

```php
private function getAppSecret(string $appId, string $keyVersion = null): ?string
{
    $secrets = config("apps.{$appId}.secrets", []);

    // 按版本号获取密钥
    if ($keyVersion && isset($secrets[$keyVersion])) {
        return $secrets[$keyVersion];
    }

    // 使用当前版本
    return $secrets['current'] ?? null;
}
```

---

## 六、总结

API 网关安全不是单一技术能解决的问题，而是多层防御的叠加：

| 防御层 | 技术手段 | 防护目标 |
|--------|---------|---------|
| 第一层 | IP 信誉库 | 拦截已知恶意来源 |
| 第二层 | 请求签名（HMAC-SHA256） | 防篡改、防伪造 |
| 第三层 | Nonce + 时间戳 | 防重放攻击 |
| 第四层 | 滑动窗口限流 | 防 DDoS / 暴力破解 |

关键原则：

1. **纵深防御**：不要依赖单一安全机制，多层叠加
2. **原子操作**：安全检查中的关键步骤必须是原子的（Redis SET NX）
3. **恒定时间比较**：签名验证使用 `hash_equals()`，防止时序攻击
4. **最小暴露**：错误信息不要泄露内部实现细节
5. **持续更新**：IP 信誉数据需要定期刷新，密钥需要定期轮换

这套方案在生产环境中经过验证，能够有效应对常见的 API 攻击手段。根据你的实际业务需求，可以灵活调整各层的严格程度和参数配置。
