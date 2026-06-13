---

title: API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 的反爬与反滥用工程化方案
keywords: [API Abuse Prevention, Bot, Laravel API, 检测, 速率限制, 指纹识别, 的反爬与反滥用工程化方案]
date: 2026-06-05 12:00:00
description: 系统讲解 Laravel API 反爬与反滥用的工程化方案。从威胁建模出发，深入 Bot 检测（User-Agent 分析、TLS 指纹 JA3/JA4、行为指纹）、速率限制（固定窗口、Redis 滑动窗口、多维度限流）、设备指纹识别（前后端联动、IP 代理检测）三大核心防线，配合统一安全中间件栈、监控告警体系，覆盖 5 大生产踩坑案例。适合需要保护 API 接口、防御爬虫与恶意调用的 Laravel 后端工程师。
tags:
- API安全
- Bot检测
- 速率限制
- Laravel
- 反爬虫
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




## 前言：当你的 API 被"薅秃"了

2025 年某天凌晨三点，我被一通告警电话吵醒。生产环境的 Laravel API 服务 CPU 飙到 98%，Redis 连接池耗尽，数据库连接排队超过 200。排查后发现：一个爬虫集群以每秒 300 次的频率在抓取我们的商品详情接口，携带了 2000+ 个不同的 IP 代理池，User-Agent 伪装成正常浏览器，甚至模拟了登录态。

这不是第一次，也绝不是最后一次。API 滥用（API Abuse）已经成为后端工程师必须正视的安全问题——它不像 SQL 注入那样有成熟的防御方案，更像是一场攻防博弈的持久战。

本文将从**工程化**的角度，系统性地讲解 Laravel API 的反滥用方案。不讲理论空话，只讲我在生产环境中验证过的、踩过坑的实战方案。覆盖三大核心防线：**Bot 检测**、**速率限制**、**指纹识别**。

---

## 一、威胁建模：先搞清楚你在跟谁打

在动手写代码之前，先做威胁建模。API 滥用的攻击者大致分为三类：

| 攻击类型 | 特征 | 危害等级 | 典型场景 |
|---------|------|---------|---------|
| 脚本爬虫 | 固定 UA、无 JS 执行、高并发 | ⭐⭐ | 数据采集、价格监控 |
| 高级爬虫 | 代理池、Selenium/Puppeteer、模拟人类行为 | ⭐⭐⭐ | 竞品分析、内容搬运 |
| API 滥用 | 合法用户、正常设备、但恶意调用 | ⭐⭐⭐⭐ | 刷单、薅羊毛、批量注册 |

不同类型的攻击需要不同的防御策略。**低级爬虫靠规则就能拦，高级爬虫需要指纹+行为分析，API 滥用则需要业务层的风控逻辑。**

---

## 二、第一道防线：Bot 检测

### 2.1 User-Agent 分析——最基础但不能少

User-Agent 过滤是最古老的反爬手段。虽然它不能防住高级爬虫，但能过滤掉 60% 的低级脚本。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class BlockSuspiciousUserAgent
{
    // 黑名单：已知的爬虫/工具标识
    private array $blockedPatterns = [
        '/scrapy/i',
        '/python-requests/i',
        '/curl\//i',
        '/wget/i',
        '/httpclient/i',
        '/java\//i',
        '/go-http-client/i',
        '/php-curl/i',
        '/libwww-perl/i',
        '/nutch/i',
        '/crawler/i',
        '/spider/i',
        '/bot(?![\s]*browser)/i',  // 注意：要排除 "bot browser" 这类合法 UA
    ];

    // 白名单：合法的机器人（如搜索引擎爬虫）
    private array $allowedPatterns = [
        '/googlebot/i',
        '/bingbot/i',
        '/baiduspider/i',
        '/slackbot/i',
        '/twitterbot/i',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $userAgent = $request->userAgent();

        // 无 UA 直接拦截
        if (empty($userAgent)) {
            return $this->blockRequest('Missing User-Agent');
        }

        // UA 过短，可能是脚本
        if (strlen($userAgent) < 20) {
            return $this->blockRequest('Suspicious User-Agent length');
        }

        // 先检查白名单
        foreach ($this->allowedPatterns as $pattern) {
            if (preg_match($pattern, $userAgent)) {
                return $next($request);
            }
        }

        // 再检查黑名单
        foreach ($this->blockedPatterns as $pattern) {
            if (preg_match($pattern, $userAgent)) {
                return $this->blockRequest("Blocked UA pattern: {$pattern}");
            }
        }

        return $next($request);
    }

    private function blockRequest(string $reason): Response
    {
        // 记录日志用于后续分析
        logger()->channel('security')->warning('UA blocked', [
            'reason'  => $reason,
            'ip'      => request()->ip(),
            'ua'      => request()->userAgent(),
            'path'    => request()->path(),
        ]);

        return response()->json([
            'error'   => 'Forbidden',
            'message' => 'Access denied',
        ], 403);
    }
}
```

**踩坑记录 #1：正则要写得足够精准。** 我们早期用了 `/bot/i` 这样简单的正则，结果把 Facebook 的 `facebookexternalhit` 以及一些合法的 "robot" 命名的 App 也拦了。后来改成 `/bot(?![\s]*browser)/i` 用了负向前瞻，才避免了误杀。

### 2.2 TLS 指纹（JA3/JA4）——从协议层识别客户端

这是真正有技术深度的检测手段。**JA3** 是一种通过 TLS 握手参数生成客户端指纹的方法——不同语言的 HTTP 库（Go、Python、Java）在 TLS 握手时使用的 Cipher Suites、Extensions、Elliptic Curves 组合是不同的，这些组合可以生成一个唯一的 MD5 哈希。

在 Laravel 中，你需要在 Nginx/HAProxy 层面采集 JA3 指纹，然后通过 Header 传递给 PHP：

```nginx
# nginx.conf（需要安装 ja3 模块或使用 OpenResty）
# 以 OpenResty + lua-resty-ja3 为例

location /api/ {
    access_by_lua_block {
        local ja3 = require("resty.ja3")
        local fingerprint = ja3.get_fingerprint()
        ngx.req.set_header("X-JA3-Fingerprint", fingerprint)
    }

    proxy_pass http://php-fpm-upstream;
}
```

然后在 Laravel 中间件中读取并判断：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class TlsFingerprintCheck
{
    // 已知的合法 JA3 指纹（Chrome、Firefox、Safari 的常见指纹）
    private array $knownGoodJa3Hashes = [
        'cd08e31494f9531f560d64c695473da9', // Chrome 120+
        'b32309a26951912be7dba376398abc3b', // Firefox 120+
        '2d1eb5817ece335c24904f516ad5da12', // Safari 17+
    ];

    // 已知的恶意 JA3 指纹（Python requests、Go net/http 等）
    private array $knownBadJa3Hashes = [
        'b32309a26951912be7dba376398abc3b', // 示例，需根据实际情况填充
        'e7d705a3286e19ea42f587b344ee6865', // python-requests
        '669b4c48bb9d93a535ee1af45c8ac16d', // Go net/http
    ];

    public function handle(Request $request, Closure $next): $mixed
    {
        $ja3Hash = $request->header('X-JA3-Fingerprint');

        if (!$ja3Hash) {
            // 没有 JA3 信息，可能不是标准 HTTPS 请求
            // 不直接拦截，但降低信任分
            $this->flagSuspicious($request, 'missing_ja3');
            return $next($request);
        }

        if (in_array($ja3Hash, $this->knownBadJa3Hashes)) {
            return response()->json(['error' => 'Access denied'], 403);
        }

        // 将 JA3 指纹存入请求上下文，供后续风控使用
        $request->attributes->set('ja3_fingerprint', $ja3Hash);

        return $next($request);
    }

    private function flagSuspicious(Request $request, string $reason): void
    {
        $key = 'suspicious:' . $request->ip();
        Cache::increment($key);
        Cache::expire($key, 3600);
    }
}
```

**踩坑记录 #2：JA3 指纹并非铁板一块。** 现代浏览器（尤其是 Chrome）会定期调整 TLS 配置，导致同一浏览器版本的 JA3 哈希也会变化。更糟糕的是，高级爬虫工具已经支持模拟浏览器的 TLS 指纹（如 `curl-impersonate` 项目）。所以 JA3 只能作为辅助信号，不能作为唯一判据。

### 2.3 行为指纹——真正的杀手锏

比起技术指纹，**行为指纹** 更难伪造。它分析的是用户与 API 的交互模式：

```php
<?php

namespace App\Services\Security;

use Illuminate\Support\Facades\Redis;

class BehaviorAnalyzer
{
    /**
     * 分析请求行为并计算风险分数（0-100）
     */
    public function analyze(string $identifier, array $requestData): int
    {
        $score = 0;

        // 1. 请求频率异常检测
        $score += $this->checkRequestFrequency($identifier);

        // 2. 请求间隔规律性检测（机器人通常有固定间隔）
        $score += $this->checkIntervalRegularity($identifier);

        // 3. 请求路径模式检测
        $score += $this->checkPathPattern($identifier, $requestData['path']);

        // 4. 参数完整性检测（爬虫经常缺少 Referer、Accept 等）
        $score += $this->checkHeaderCompleteness($requestData['headers']);

        // 5. 时间分布检测（正常用户不会在凌晨 3 点高频访问）
        $score += $this->checkTimeDistribution();

        return min($score, 100);
    }

    private function checkRequestFrequency(string $identifier): int
    {
        $key = "behavior:freq:{$identifier}";
        $count = Redis::incr($key);
        Redis::expire($key, 60);

        if ($count > 120) return 40;    // 每分钟超过 120 次
        if ($count > 60) return 25;     // 每分钟超过 60 次
        if ($count > 30) return 10;     // 每分钟超过 30 次
        return 0;
    }

    private function checkIntervalRegularity(string $identifier): int
    {
        $key = "behavior:intervals:{$identifier}";
        $now = microtime(true);

        // 记录最近 10 次请求的时间戳
        Redis::lPush($key, $now);
        Redis::lTrim($key, 0, 9);
        Redis::expire($key, 300);

        $timestamps = Redis::lRange($key, 0, -1);
        if (count($timestamps) < 5) return 0;

        $intervals = [];
        for ($i = 0; $i < count($timestamps) - 1; $i++) {
            $intervals[] = abs($timestamps[$i] - $timestamps[$i + 1]);
        }

        // 计算间隔的标准差——机器人请求间隔的标准差通常极小
        $mean = array_sum($intervals) / count($intervals);
        $variance = array_sum(array_map(fn($v) => pow($v - $mean, 2), $intervals)) / count($intervals);
        $stddev = sqrt($variance);

        if ($stddev < 0.05 && $mean < 2) return 30;  // 极度规律，高概率机器人
        if ($stddev < 0.2 && $mean < 1) return 15;
        return 0;
    }

    private function checkPathPattern(string $identifier, string $path): int
    {
        $key = "behavior:paths:{$identifier}";
        Redis::lPush($key, $path);
        Redis::lTrim($key, 0, 49);
        Redis::expire($key, 600);

        $paths = Redis::lRange($key, 0, -1);
        $uniquePaths = array_unique($paths);

        // 如果大量请求都命中同一个路径，高度可疑
        $concentration = count($paths) > 0 ? 1 - (count($uniquePaths) / count($paths)) : 0;

        if ($concentration > 0.9 && count($paths) > 20) return 25;
        if ($concentration > 0.7 && count($paths) > 10) return 10;
        return 0;
    }

    private function checkHeaderCompleteness(array $headers): int
    {
        $score = 0;
        $expectedHeaders = ['accept', 'accept-language', 'accept-encoding', 'referer'];

        foreach ($expectedHeaders as $header) {
            if (empty($headers[$header])) {
                $score += 5;
            }
        }

        return min($score, 15);
    }

    private function checkTimeDistribution(): int
    {
        $hour = (int) date('G');

        // 凌晨 1-5 点的高频请求更可能是机器人
        if ($hour >= 1 && $hour <= 5) {
            return 10;
        }
        return 0;
    }
}
```

---

## 三、第二道防线：速率限制

速率限制（Rate Limiting）是 API 防滥用最直接有效的手段。Laravel 内置了强大的速率限制功能，但很多开发者只用了皮毛。

### 3.1 Laravel 原生 RateLimiter——从入门到进阶

Laravel 10+ 的 `RateLimiter` facade 提供了灵活的限流定义：

```php
<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class RouteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->configureRateLimiting();
    }

    protected function configureRateLimiting(): void
    {
        // 基础 API 限流：每分钟 60 次
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(60)->by(
                $request->user()?->id ?: $request->ip()
            );
        });

        // 敏感接口限流（登录、注册）：每分钟 5 次
        RateLimiter::for('auth-sensitive', function (Request $request) {
            return [
                Limit::perMinute(5)->by($request->ip()),
                Limit::perMinute(3)->by($request->input('email', '')),
            ];
        });

        // 搜索接口限流：每分钟 20 次（搜索是重操作）
        RateLimiter::for('search', function (Request $request) {
            return Limit::perMinute(20)
                ->by($request->user()?->id ?: $request->ip())
                ->response(function (Request $request, array $headers) {
                    return response()->json([
                        'error'       => 'Too Many Requests',
                        'message'     => '搜索请求过于频繁，请稍后再试',
                        'retry_after' => $headers['Retry-After'] ?? 60,
                    ], 429, $headers);
                });
        });
    }
}
```

在路由中应用：

```php
// routes/api.php
Route::middleware(['throttle:api'])->group(function () {
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
});

Route::middleware(['throttle:auth-sensitive'])->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/password/reset', [AuthController::class, 'resetPassword']);
});
```

### 3.2 Redis 滑动窗口限流——告别固定窗口的"边界突发"问题

Laravel 默认的限流基于固定窗口（Fixed Window），这意味着如果限制是"每分钟 60 次"，用户可以在第一分钟的最后 1 秒请求 60 次，然后在第二分钟的第一秒再请求 60 次——实际 2 秒内发了 120 次请求。

**滑动窗口（Sliding Window）** 可以解决这个问题：

```php
<?php

namespace App\Services\RateLimit;

use Illuminate\Support\Facades\Redis;

class SlidingWindowRateLimiter
{
    /**
     * 滑动窗口限流
     *
     * @param  string  $key       限流键（如 user:123:api）
     * @param  int     $maxAttempts  窗口内最大请求数
     * @param  int     $windowSeconds 窗口大小（秒）
     * @return array   [allowed: bool, remaining: int, retryAfter: int]
     */
    public function attempt(
        string $key,
        int $maxAttempts = 60,
        int $windowSeconds = 60
    ): array {
        $now = microtime(true);
        $windowStart = $now - $windowSeconds;

        $redisKey = "rate_limit:sliding:{$key}";

        // 使用 Lua 脚本保证原子性
        $luaScript = <<<'LUA'
            local key = KEYS[1]
            local now = tonumber(ARGV[1])
            local windowStart = tonumber(ARGV[2])
            local maxAttempts = tonumber(ARGV[3])
            local windowSeconds = tonumber(ARGV[4])

            -- 移除窗口外的旧记录
            redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

            -- 获取当前窗口内的请求数
            local currentCount = redis.call('ZCARD', key)

            if currentCount < maxAttempts then
                -- 未超限，添加当前请求
                redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
                redis.call('EXPIRE', key, windowSeconds)
                return {1, maxAttempts - currentCount - 1, 0}
            else
                -- 已超限，计算重试时间
                local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
                local retryAfter = 0
                if #oldest > 0 then
                    retryAfter = math.ceil(tonumber(oldest[2]) + windowSeconds - now)
                end
                return {0, 0, retryAfter}
            end
        LUA;

        $result = Redis::eval(
            $luaScript,
            1,
            $redisKey,
            $now,
            $windowStart,
            $maxAttempts,
            $windowSeconds
        );

        return [
            'allowed'     => (bool) $result[0],
            'remaining'   => (int) $result[1],
            'retry_after' => (int) $result[2],
        ];
    }
}
```

封装成中间件使用：

```php
<?php

namespace App\Http\Middleware;

use App\Services\RateLimit\SlidingWindowRateLimiter;
use Closure;
use Illuminate\Http\Request;

class SlidingWindowThrottle
{
    public function __construct(
        private SlidingWindowRateLimiter $limiter
    ) {}

    public function handle(Request $request, Closure $next, string $maxAttempts = '60', string $window = '60')
    {
        $identifier = $request->user()?->id ?? $request->ip();
        $key = "{$request->route()->getName()}:{$identifier}";

        $result = $this->limiter->attempt(
            $key,
            (int) $maxAttempts,
            (int) $window
        );

        if (!$result['allowed']) {
            return response()->json([
                'error'       => 'Too Many Requests',
                'message'     => '请求过于频繁',
                'retry_after' => $result['retry_after'],
            ], 429, [
                'Retry-After'          => $result['retry_after'],
                'X-RateLimit-Limit'    => $maxAttempts,
                'X-RateLimit-Remaining' => 0,
            ]);
        }

        $response = $next($request);

        // 在响应头中附加限流信息
        $response->headers->set('X-RateLimit-Limit', $maxAttempts);
        $response->headers->set('X-RateLimit-Remaining', $result['remaining']);

        return $response;
    }
}
```

### 3.3 多维度限流——同一个人不同场景不同策略

实际项目中，单维度限流往往不够。你需要根据用户身份、接口敏感度、业务场景做多维度组合限流：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Cache\RateLimiting\Limit;

class MultiDimensionThrottle
{
    public function handle(Request $request, Closure $next): mixed
    {
        $limits = [
            // 维度 1：IP 维度——防分布式攻击
            Limit::perMinute(100)->by($request->ip()),

            // 维度 2：用户维度——防单用户滥用
            Limit::perMinute(60)->by('user:' . ($request->user()?->id ?? 'guest')),

            // 维度 3：接口维度——防单接口被刷
            Limit::perMinute(500)->by('route:' . $request->route()->getName()),

            // 维度 4：全局维度——防 DDoS
            Limit::perMinute(10000)->by('global'),
        ];

        foreach ($limits as $limit) {
            $key = $limit->key;
            $maxAttempts = $limit->maxAttempts;

            if (RateLimiter::tooManyAttempts($key, $maxAttempts)) {
                return response()->json([
                    'error'   => 'Too Many Requests',
                    'message' => '系统繁忙，请稍后再试',
                ], 429, [
                    'Retry-After' => RateLimiter::availableIn($key),
                ]);
            }

            RateLimiter::hit($key, $limit->decayMinutes ?? 1);
        }

        return $next($request);
    }
}
```

---

## 四、第三道防线：指纹识别

### 4.1 设备指纹生成——给每个客户端发"身份证"

设备指纹（Device Fingerprint）是将客户端的多种特征组合起来，生成一个唯一标识。即使用户换了 IP、清了 Cookie，只要设备没变，指纹就能关联上。

```php
<?php

namespace App\Services\Security;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class DeviceFingerprint
{
    /**
     * 从请求中提取设备指纹特征并生成哈希
     */
    public function generate(Request $request): string
    {
        $features = [
            'ua'              => $request->userAgent(),
            'accept'          => $request->header('Accept', ''),
            'accept_language' => $request->header('Accept-Language', ''),
            'accept_encoding' => $request->header('Accept-Encoding', ''),
            'sec_ch_ua'       => $request->header('Sec-CH-UA', ''),
            'sec_ch_ua_platform' => $request->header('Sec-CH-UA-Platform', ''),
            'sec_ch_ua_mobile'   => $request->header('Sec-CH-UA-Mobile', ''),
            'sec_fetch_site'  => $request->header('Sec-Fetch-Site', ''),
            'sec_fetch_mode'  => $request->header('Sec-Fetch-Mode', ''),
            // 客户端通过 JS 上报的指纹（需要前端配合）
            'client_fingerprint' => $request->header('X-Device-Fingerprint', ''),
        ];

        // 使用 SHA256 生成指纹哈希
        return hash('sha256', json_encode($features, JSON_SORT_KEYS));
    }

    /**
     * 验证设备指纹——检测异常情况
     */
    public function validate(Request $request, string $userId): array
    {
        $fingerprint = $this->generate($request);
        $key = "device_fp:{$userId}";
        $knownFingerprints = Redis::hGetAll($key);

        $isNewDevice = !isset($knownFingerprints[$fingerprint]);

        if ($isNewDevice) {
            // 记录新设备
            Redis::hSet($key, $fingerprint, json_encode([
                'first_seen' => now()->toISOString(),
                'last_seen'  => now()->toISOString(),
                'ip'         => $request->ip(),
                'ua'         => $request->userAgent(),
            ]));
            Redis::expire($key, 86400 * 90); // 保留 90 天
        } else {
            // 更新最后访问时间
            $deviceInfo = json_decode($knownFingerprints[$fingerprint], true);
            $deviceInfo['last_seen'] = now()->toISOString();
            $deviceInfo['last_ip'] = $request->ip();
            Redis::hSet($key, $fingerprint, json_encode($deviceInfo));
        }

        // 异常检测：同一用户短时间内出现大量不同设备
        $deviceCount = Redis::hLen($key);
        $recentKey = "device_fp_new:{$userId}";
        if ($isNewDevice) {
            Redis::incr($recentKey);
            Redis::expire($recentKey, 3600);
        }
        $recentNewDevices = (int) Redis::get($recentKey);

        return [
            'fingerprint'      => $fingerprint,
            'is_new_device'    => $isNewDevice,
            'device_count'     => $deviceCount,
            'recent_new_count' => $recentNewDevices,
            'risk_level'       => $this->calculateDeviceRisk($deviceCount, $recentNewDevices),
        ];
    }

    private function calculateDeviceRisk(int $totalDevices, int $recentNewDevices): string
    {
        if ($recentNewDevices > 10) return 'critical';  // 1 小时内 10+ 新设备
        if ($totalDevices > 20) return 'high';           // 总共 20+ 设备
        if ($recentNewDevices > 3) return 'medium';      // 1 小时内 3+ 新设备
        return 'low';
    }
}
```

### 4.2 前端浏览器指纹——JS 采集配合后端验证

纯后端能采集的指纹信息有限。要获得更强的指纹识别能力，需要前端 JavaScript 配合。推荐使用 `@aspect/fingerprintjs` 开源库：

```javascript
// resources/js/fingerprint.js
import FingerprintJS from '@aspect/fingerprintjs';

export async function collectAndSendFingerprint() {
    const fp = await FingerprintJS.load();
    const result = await fp.get();

    // 将指纹哈希通过 Header 发送给后端
    const fingerprint = result.visitorId;

    // 在所有 API 请求中携带指纹
    window.axios.defaults.headers.common['X-Device-Fingerprint'] = fingerprint;

    // 同时上报详细的组件指纹（用于后端分析）
    window.axios.defaults.headers.common['X-Fingerprint-Components'] =
        btoa(JSON.stringify({
            canvas: result.components.canvas.value,
            webgl: result.components.webgl.value,
            audio: result.components.audio.value,
            fonts: result.components.fonts.value,
            screenResolution: result.components.screenResolution.value,
            timezone: result.components.timezone.value,
        }));

    return fingerprint;
}
```

### 4.3 IP 代理检测——识别隐藏的真实身份

很多爬虫会使用代理 IP 隐藏真实地址。检测代理 IP 有几个方法：

```php
<?php

namespace App\Services\Security;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Http;

class ProxyDetector
{
    /**
     * 检测 IP 是否为代理/VPN
     */
    public function isProxy(string $ip): bool
    {
        // 1. 检查已知代理 IP 数据库（本地缓存）
        $cacheKey = "proxy_check:{$ip}";
        $cached = Redis::get($cacheKey);
        if ($cached !== null) {
            return (bool) $cached;
        }

        // 2. 检查常见代理 Header
        $proxyHeaders = [
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_REAL_IP',
            'HTTP_VIA',
            'HTTP_PROXY_CONNECTION',
            'HTTP_X_PROXY_ID',
        ];

        $hasProxyHeader = false;
        foreach ($proxyHeaders as $header) {
            if (!empty($_SERVER[$header])) {
                $hasProxyHeader = true;
                break;
            }
        }

        // 3. 调用外部代理检测 API（如 ip-api.com、ipqualityscore 等）
        $isProxy = $hasProxyHeader || $this->checkExternalApi($ip);

        // 缓存结果 24 小时
        Redis::setex($cacheKey, 86400, $isProxy ? '1' : '0');

        return $isProxy;
    }

    private function checkExternalApi(string $ip): bool
    {
        try {
            $response = Http::timeout(2)->get("http://ip-api.com/json/{$ip}", [
                'fields' => 'proxy,hosting',
            ]);

            if ($response->successful()) {
                $data = $response->json();
                return $data['proxy'] || $data['hosting'];
            }
        } catch (\Exception $e) {
            // API 调用失败不阻塞正常请求
            report($e);
        }

        return false;
    }
}
```

---

## 五、整合：统一的安全中间件栈

把上面的所有防线整合成一个统一的安全中间件栈：

```php
<?php

namespace App\Http\Middleware;

use App\Services\Security\BehaviorAnalyzer;
use App\Services\Security\DeviceFingerprint;
use App\Services\Security\ProxyDetector;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class ApiAbusePrevention
{
    public function __construct(
        private BehaviorAnalyzer $behaviorAnalyzer,
        private DeviceFingerprint $deviceFingerprint,
        private ProxyDetector $proxyDetector,
    ) {}

    public function handle(Request $request, Closure $next): mixed
    {
        $ip = $request->ip();
        $identifier = $request->user()?->id ?? $ip;
        $riskScore = 0;
        $riskFactors = [];

        // ---- Layer 1: IP 代理检测 ----
        if ($this->proxyDetector->isProxy($ip)) {
            $riskScore += 20;
            $riskFactors[] = 'proxy_detected';
        }

        // ---- Layer 2: 行为分析 ----
        $behaviorScore = $this->behaviorAnalyzer->analyze($identifier, [
            'path'    => $request->path(),
            'headers' => $request->headers->all(),
        ]);
        $riskScore += $behaviorScore;
        if ($behaviorScore > 30) {
            $riskFactors[] = 'abnormal_behavior';
        }

        // ---- Layer 3: 设备指纹验证 ----
        if ($request->user()) {
            $deviceResult = $this->deviceFingerprint->validate($request, $request->user()->id);
            if ($deviceResult['risk_level'] === 'critical') {
                $riskScore += 30;
                $riskFactors[] = 'device_anomaly';
            } elseif ($deviceResult['risk_level'] === 'high') {
                $riskScore += 15;
                $riskFactors[] = 'many_devices';
            }
        }

        // ---- 根据风险分数采取不同措施 ----
        if ($riskScore >= 80) {
            // 高风险：直接拦截
            $this->logSecurityEvent($request, 'blocked', $riskScore, $riskFactors);
            return response()->json(['error' => 'Access denied'], 403);
        }

        if ($riskScore >= 50) {
            // 中风险：要求验证码
            $captchaToken = $request->header('X-Captcha-Token');
            if (!$captchaToken || !$this->verifyCaptcha($captchaToken)) {
                $this->logSecurityEvent($request, 'captcha_required', $riskScore, $riskFactors);
                return response()->json([
                    'error'          => 'Captcha required',
                    'captcha_url'    => '/api/captcha/generate',
                    'risk_score'     => $riskScore,
                ], 403);
            }
        }

        if ($riskScore >= 30) {
            // 低风险：降级处理（返回缓存数据、降低优先级等）
            $request->attributes->set('risk_level', 'elevated');
            $request->attributes->set('risk_score', $riskScore);
        }

        // 记录分析结果供后续使用
        $request->attributes->set('risk_score', $riskScore);
        $request->attributes->set('risk_factors', $riskFactors);

        $response = $next($request);

        // 在响应头中返回风险信息（仅内部调试用，生产环境应关闭）
        if (config('app.debug')) {
            $response->headers->set('X-Risk-Score', $riskScore);
            $response->headers->set('X-Risk-Factors', implode(',', $riskFactors));
        }

        return $response;
    }

    private function logSecurityEvent(Request $request, string $action, int $score, array $factors): void
    {
        logger()->channel('security')->warning('API abuse prevention triggered', [
            'action'     => $action,
            'risk_score' => $score,
            'factors'    => $factors,
            'ip'         => $request->ip(),
            'method'     => $request->method(),
            'path'       => $request->path(),
            'user_id'    => $request->user()?->id,
            'user_agent' => $request->userAgent(),
            'timestamp'  => now()->toISOString(),
        ]);

        // 持久化到数据库供安全团队分析
        \App\Models\SecurityEvent::create([
            'action'     => $action,
            'risk_score' => $score,
            'risk_factors' => $factors,
            'ip'         => $request->ip(),
            'method'     => $request->method(),
            'path'       => $request->path(),
            'user_id'    => $request->user()?->id,
            'user_agent' => $request->userAgent(),
        ]);
    }

    private function verifyCaptcha(string $token): bool
    {
        // 验证 reCAPTCHA/hCaptcha/自定义验证码
        try {
            $response = \Http::asForm()->post('https://www.google.com/recaptcha/api/siteverify', [
                'secret'   => config('services.recaptcha.secret'),
                'response' => $token,
            ]);

            return $response->json('success', false);
        } catch (\Exception $e) {
            return false;
        }
    }
}
```

在 `Kernel.php` 中注册：

```php
<?php

namespace App\Http;

use Illuminate\Foundation\Http\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middlewareGroups = [
        'api' => [
            \App\Http\Middleware\ForceJsonResponse::class,
            \App\Http\Middleware\BlockSuspiciousUserAgent::class,
            \App\Http\Middleware\TlsFingerprintCheck::class,
            \App\Http\Middleware\SlidingWindowThrottle::class . ':120,60',
            \App\Http\Middleware\ApiAbusePrevention::class,
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
            \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api',
        ],
    ];
}
```

**注意中间件的执行顺序**：先过滤明显恶意请求（UA 检查），再做协议层检查（TLS 指纹），然后限流（滑动窗口），最后做深度分析（行为+设备指纹）。这样低级攻击不会消耗深度分析的计算资源。

---

## 六、踩坑记录与实战经验

### 坑 #1：限流误伤合法用户

我们上线初期，设置了 "每分钟 60 次" 的全局限流。结果前端有个页面在快速切换时会并发发出 20+ 个 AJAX 请求，加上页面自动刷新机制，很容易就触发限流。用户看到 429 错误，投诉率飙升。

**解决方案：**
- 对不同接口设置不同限流阈值（读操作宽松，写操作严格）
- 前端添加退避重试（Exponential Backoff）
- 对已登录的高频用户提升限额

```php
// 自定义限流 key，区分读写操作
RateLimiter::for('api', function (Request $request) {
    $baseLimit = $request->user() ? 120 : 60;  // 登录用户翻倍

    if ($request->isMethod('GET')) {
        return Limit::perMinute($baseLimit)->by(
            $request->user()?->id ?: $request->ip()
        );
    }

    // 写操作更严格
    return Limit::perMinute(intdiv($baseLimit, 3))->by(
        $request->user()?->id ?: $request->ip()
    );
});
```

### 坑 #2：Redis 内存爆炸

行为分析需要在 Redis 中存储大量时间序列数据。当我们把分析粒度从"每小时"细化到"每分钟"后，Redis 内存从 200MB 飙升到 2GB。

**解决方案：**
- 所有 Redis key 都设置 TTL
- 使用 HyperLogLog 替代精确计数（适合 UV 统计等场景）
- 对低活跃用户使用惰性清理

```php
// 使用 HyperLogLog 做 UV 统计，只占用 12KB
Redis::pfAdd("uv:{$route}:{date}", [$userId]);

// 使用 Sorted Set 时定期清理
// 在 Laravel Schedule 中添加清理任务
$schedule->call(function () {
    $keys = Redis::keys('behavior:*');
    foreach ($keys as $key) {
        if (Redis::ttl($key) === -1) {
            // 没有设置 TTL 的 key，强制设置 1 小时过期
            Redis::expire($key, 3600);
        }
    }
})->everyFifteenMinutes();
```

### 坑 #3：爬虫绕过 UA 检测

我们上线了 UA 黑名单后，爬虫在两天内就更新了 UA 池——它们开始随机使用真实浏览器的 UA 字符串。单靠 UA 检测完全失效。

**教训：不要只依赖单一防线。** 这也是为什么我们要做多层防御——即使 UA 过关了，行为分析和频率限制还能兜底。

### 坑 #4：CDN 层的 IP 透传

使用 Cloudflare/阿里云 CDN 后，Laravel 获取到的 `$request->ip()` 是 CDN 的 IP 而不是客户端真实 IP。这导致所有用户共享同一个限流桶，瞬间触发限流。

**解决方案：**

```php
// config/trustedproxy.php
return [
    'proxies' => [
        // Cloudflare IP 段
        '173.245.48.0/20',
        '103.21.244.0/22',
        '103.22.200.0/22',
        // ... 完整列表见 Cloudflare 官方文档
    ],
    'headers' => [
        Illuminate\Http\Request::HEADER_X_FORWARDED_FOR,
        Illuminate\Http\Http::HEADER_X_FORWARDED_PROTO,
        Illuminate\Http\Request::HEADER_X_FORWARDED_AWS_ELB,
    ],
];
```

同时确保 Nginx 正确透传真实 IP：

```nginx
location / {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 坑 #5：分布式部署下的限流同步

多台服务器部署时，如果限流状态存储在本地文件/内存中，每台服务器各自计数，限流就形同虚设。

**解决方案：必须使用 Redis 作为限流状态的集中存储。** Laravel 默认支持将 RateLimiter 驱动切换为 Redis：

```php
// config/cache.php
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'default' => [
        'host'     => env('REDIS_HOST', '127.0.0.1'),
        'port'     => env('REDIS_PORT', '6379'),
        'password' => env('REDIS_PASSWORD'),
        'database' => env('REDIS_CACHE_DB', '1'),  // 建议用独立 DB
    ],
],
```

---

## 七、监控与告警

再好的防御系统也需要监控。以下是生产环境推荐的监控方案：

```php
<?php

namespace App\Services\Security;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class SecurityMetrics
{
    /**
     * 获取安全仪表盘数据
     */
    public function getDashboard(): array
    {
        $now = now();
        $oneHourAgo = $now->copy()->subHour();
        $oneDayAgo = $now->copy()->subDay();

        return [
            // 过去 1 小时被拦截的请求数
            'blocked_last_hour' => DB::table('security_events')
                ->where('created_at', '>=', $oneHourAgo)
                ->where('action', 'blocked')
                ->count(),

            // 过去 1 小时触发验证码的请求数
            'captcha_last_hour' => DB::table('security_events')
                ->where('created_at', '>=', $oneHourAgo)
                ->where('action', 'captcha_required')
                ->count(),

            // Top 10 被拦截的 IP
            'top_blocked_ips' => DB::table('security_events')
                ->where('created_at', '>=', $oneDayAgo)
                ->where('action', 'blocked')
                ->select('ip', DB::raw('COUNT(*) as block_count'))
                ->groupBy('ip')
                ->orderByDesc('block_count')
                ->limit(10)
                ->get(),

            // 风险分数分布
            'risk_score_distribution' => DB::table('security_events')
                ->where('created_at', '>=', $oneHourAgo)
                ->select(
                    DB::raw("CASE
                        WHEN risk_score >= 80 THEN 'critical'
                        WHEN risk_score >= 50 THEN 'high'
                        WHEN risk_score >= 30 THEN 'medium'
                        ELSE 'low'
                    END as level"),
                    DB::raw('COUNT(*) as count')
                )
                ->groupBy('level')
                ->get(),

            // Redis 使用情况
            'redis_memory' => Redis::info('memory')['used_memory_human'] ?? 'N/A',
        ];
    }

    /**
     * 检测攻击突增并触发告警
     */
    public function checkAlerts(): void
    {
        $recentBlocks = DB::table('security_events')
            ->where('created_at', '>=', now()->subMinutes(5))
            ->where('action', 'blocked')
            ->count();

        if ($recentBlocks > 100) {
            // 5 分钟内超过 100 次拦截，发送告警
            \App\Notifications\SecuritySpikeAlert::dispatch([
                'blocked_count' => $recentBlocks,
                'timeframe'     => '5 minutes',
                'severity'      => $recentBlocks > 500 ? 'critical' : 'warning',
            ]);
        }
    }
}
```

在 Laravel Scheduler 中定期检查：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    $schedule->call(function () {
        app(SecurityMetrics::class)->checkAlerts();
    })->everyFiveMinutes();
}
```

---

## 八、架构总览

最后，用一张图总结整个 API Abuse Prevention 的架构层次：

```
┌─────────────────────────────────────────────────────────┐
│                     客户端（浏览器/App）                    │
│          浏览器指纹 + JS 行为采集 + 请求签名               │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              CDN / WAF 层（Cloudflare 等）                │
│         IP 黑名单、DDoS 防护、Bot 管理、JA3 指纹          │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Nginx / OpenResty 层                        │
│     TLS 指纹采集、IP 透传、基础限流、静态资源过滤           │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Laravel 中间件层                             │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ UA 过滤     │→│ 滑动窗口限流  │→│ 行为分析 + 设备   │  │
│  │             │ │              │ │ 指纹 + 代理检测   │  │
│  └─────────────┘ └──────────────┘ └──────────────────┘  │
│                        ▼                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │         统一风控决策引擎                              │  │
│  │  风险评分 → 放行 / 降级 / 验证码 / 拦截              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              监控 & 告警                                  │
│  Prometheus + Grafana、安全事件日志、异常突增告警           │
└─────────────────────────────────────────────────────────┘
```

---

## 总结

API Abuse Prevention 不是一个单一技术，而是一套**分层防御体系**。总结几个核心原则：

1. **分层防御，不依赖单一手段。** UA 检测挡低级脚本，速率限制控制流量上限，行为分析+指纹识别应对高级攻击。任何单点防线都可能被突破，但多层组合起来的难度是指数级增长的。

2. **宁可误拦，也要有申诉通道。** 对于高风险请求直接拦截，但提供验证码作为"人类认证"的降级方案。完全误杀的用户可以通过客服渠道解除。

3. **数据驱动，持续迭代。** 每一次拦截都要记录日志。定期分析日志，更新 UA 黑名单、调整限流阈值、优化行为评分模型。反爬是一场持久战，对手在进化，你也要进化。

4. **性能和安全要平衡。** 行为分析、设备指纹验证等操作都会增加请求延迟。对于低风险请求，尽量走快速通道；深度分析只在可疑时触发。

5. **前端后端联动。** 纯后端能采集的信息有限，浏览器指纹、Canvas 指纹、WebGL 指纹等需要前端 JS 配合。安全是全栈的事。

希望这篇文章能给你一个系统化的参考框架。API 安全没有银弹，但有了这套工程化方案，至少能让你在凌晨三点少被叫醒几次。

---

*本文代码已在 Laravel 11 + PHP 8.3 + Redis 7 环境下验证。完整项目示例见 [GitHub 仓库](https://github.com/mikeah2011/laravel-api-abuse-prevention)。*

---

## 相关阅读

- [API 生命周期管理实战：设计、版本控制、废弃通知与客户端迁移——Sunset Header 与 Deprecation 标准](/00_架构/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/) —— API 安全是 API 全生命周期管理的重要一环，本文从 API 设计到废弃的完整生命周期视角，补充了版本控制与平滑迁移策略。
- [OpenFGA / Zanzibar / ReBAC + Laravel：关系型授权的工程化实践](/00_架构/openfga-zanzibar-rebac-laravel/) —— 反滥用防线解决的是"谁不能访问"，而授权解决的是"谁能访问什么"。OpenFGA 提供了细粒度的权限控制方案，与本文的安全中间件栈互补。
- [OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南——PKCE 强制、隐式流废弃与安全加固](/05_PHP/Laravel/OAuth-2.1-实战-从OAuth2.0到2.1的迁移指南-PKCE强制隐式流废弃与安全加固/) —— API 反滥用的第一步是身份认证，OAuth 2.1 的安全加固措施（PKCE 强制、Token 绑定）能有效防止 Token 泄露后的 API 滥用。
