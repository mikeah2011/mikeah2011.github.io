---

title: API Security 深度实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——多层防御的工程化方案
keywords: [API Security, JWT, IP, 深度实战, 黑名单, 请求签名, 白名单, 防重放攻击, 多层防御的工程化方案]
date: 2026-06-06 10:00:00
tags:
- API安全
- JWT
- Laravel
- 请求签名
- 重放攻击
- Redis
description: API 安全深度实战指南，基于 Laravel/PHP 技术栈系统讲解多层防御体系。涵盖 JWT 黑名单机制实现 Token 主动吊销、HMAC-SHA256 请求签名防篡改、Redis 滑动窗口速率限制、Nonce+Timestamp 防重放攻击、IP 白名单与 CIDR 匹配等核心方案。包含完整可运行代码、中间件执行顺序设计、性能影响评估（P99 额外延迟 5-10ms）及十大生产环境踩坑经验，适用于微服务架构和前后端分离场景的 API 安全工程化落地。
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



## 前言

在当今微服务架构和前后端分离的大背景下，API 已经成为系统间通信的命脉。然而，很多团队对 API 安全的认知还停留在「加个 HTTPS 就够了」的阶段。现实情况是：HTTPS 只解决了传输层加密，对于应用层的 Token 劫持、请求伪造、重放攻击、越权访问等威胁完全无能为力。

本文将从实战角度出发，基于 Laravel/PHP 技术栈，系统性地讲解如何构建一套**多层防御体系**——JWT 黑名单机制、请求签名、IP 白名单、防重放攻击——每一层都有完整的代码实现和踩坑经验。这不是一篇概念科普文，而是可以直接落地到生产环境的工程化方案。

---

## 一、API 安全威胁全景：OWASP API Security Top 10 速览

在讨论具体方案之前，我们需要先了解敌人是谁。OWASP（开放式 Web 应用安全项目）在 2023 年发布了 API Security Top 10，以下是其中最值得关注的威胁：

| 排名 | 威胁 | 说明 | 本文对应防御层 |
|------|------|------|----------------|
| API1 | Broken Object Level Authorization | 对象级权限校验缺失 | 请求签名 + Token 校验 |
| API2 | Broken Authentication | 认证机制薄弱 | JWT 黑名单 |
| API3 | Broken Object Property Level Authorization | 属性级越权 | 请求签名校验 |
| API4 | Unrestricted Resource Consumption | 无限制的资源消耗 | 速率限制 |
| API5 | Broken Function Level Authorization | 功能级越权 | IP 白名单 + 签名 |
| API6 | Unrestricted Access to Sensitive Business Flows | 敏感业务流无限制访问 | 防重放 + 签名 |
| API7 | Server Side Request Forgery (SSRF) | 服务端请求伪造 | IP 白名单 |
| API8 | Security Misconfiguration | 安全配置错误 | 全方位覆盖 |
| API9 | Improper Inventory Management | API 资产管理不当 | 日志审计 |
| API10 | Unsafe Consumption of APIs | 不安全的第三方 API 调用 | 请求签名 |

可以看到，**单点防御根本不够**。一个完善的 API 安全方案，必须是多层叠加的纵深防御。

---

## 二、JWT 黑名单机制：让 Token 吊销不再是难题

### 2.1 JWT 的天然缺陷

JWT（JSON Web Token）最大的优点是无状态——服务端不需要存储 Session，验证签名即可。但这也带来了最大的缺陷：**一旦签发，无法主动吊销**。

想象以下场景：
- 用户修改密码后，旧 Token 应当立即失效
- 用户登出后，Token 不应继续可用
- 管理员强制下线某用户
- 检测到 Token 被盗用，需要紧急吊销

在这些场景下，如果你只做了 JWT 签名验证，那么在 Token 过期之前，它一直有效。这是一个严重的安全隐患。

### 2.2 Redis 黑名单实现

解决方案是引入一个**黑名单（Blacklist）机制**。核心思路：将需要吊销的 Token JTI（JWT ID）写入 Redis，每次验证 Token 时先检查是否在黑名单中。

```php
<?php

namespace App\Services\Auth;

use Illuminate\Support\Facades\Redis;
use PHPOpenSourceSaver\JWTAuth\Facades\JWTAuth;
use PHPOpenSourceSaver\JWTAuth\Exceptions\JWTException;

class JwtBlacklistService
{
    /**
     * Redis key 前缀
     */
    protected string $prefix = 'jwt_blacklist:';

    /**
     * 默认过期时间（秒）——等于 JWT 的最大有效期
     */
    protected int $defaultTtl;

    public function __construct()
    {
        // 与 config/jwt.php 中的 ttl 保持一致
        $this->defaultTtl = config('jwt.ttl', 60);
    }

    /**
     * 将 Token 加入黑名单
     */
    public function blacklist(string $token): bool
    {
        try {
            $payload = JWTAuth::setToken($token)->getPayload();
            $jti = $payload->get('jti');    // JWT ID，唯一标识
            $exp = $payload->get('exp');    // 过期时间戳
            $iat = $payload->get('iat');    // 签发时间戳

            $ttl = max($exp - time(), 1);   // 剩余有效时间
            if ($ttl <= 0) {
                return true; // 已过期，无需加入黑名单
            }

            $key = $this->prefix . $jti;

            // 写入 Redis，值为 Token 的签发时间，TTL 为剩余有效期
            // 这样 Redis 会自动清理过期的黑名单记录，不会无限膨胀
            Redis::setex($key, $ttl, $iat);

            return true;
        } catch (JWTException $e) {
            report($e);
            return false;
        }
    }

    /**
     * 检查 Token 是否在黑名单中
     */
    public function isBlacklisted(string $token): bool
    {
        try {
            $payload = JWTAuth::setToken($token)->getPayload();
            $jti = $payload->get('jti');

            return Redis::exists($this->prefix . $jti);
        } catch (JWTException $e) {
            return false;
        }
    }

    /**
     * 吊销指定用户的所有 Token（全量下线）
     * 
     * 原理：维护一个用户级别的「吊销时间戳」，
     * 凡是 iat 早于该时间戳的 Token 都视为无效。
     */
    public function revokeAllForUser(int $userId, ?int $gracePeriod = null): bool
    {
        $revokeKey = "jwt_user_revoked:{$userId}";
        $revokeAt = $gracePeriod ? time() - $gracePeriod : time();

        // 设置用户级吊销时间戳，TTL 设为最长 Token 有效期
        Redis::setex($revokeKey, config('jwt.refresh_ttl', 20160) * 60, $revokeAt);

        return true;
    }

    /**
     * 检查用户是否被全量吊销
     */
    public function isUserRevoked(int $userId, int $tokenIat): bool
    {
        $revokeKey = "jwt_user_revoked:{$userId}";
        $revokeAt = Redis::get($revokeKey);

        if (!$revokeAt) {
            return false;
        }

        // Token 签发时间早于吊销时间，视为无效
        return $tokenIat < (int) $revokeAt;
    }
}
```

### 2.3 滑动过期 vs 固定过期

这是 JWT 设计中一个经典的权衡：

**固定过期（Absolute Expiration）**：
- Token 一旦签发，无论用户是否活跃，到期即失效
- 安全性高，但用户体验差（用户正在操作突然需要重新登录）

**滑动过期（Sliding Expiration）**：
- 用户每次请求时，如果 Token 即将过期，自动续期
- 用户体验好，但有被长期盗用的风险

**生产环境推荐方案：双 Token 机制**

```
┌─────────────────────────────────────────────────┐
│                  双 Token 架构                    │
├─────────────────────────────────────────────────┤
│                                                  │
│  Access Token (短期)    Refresh Token (长期)      │
│  ├─ 有效期: 15-60 分钟    ├─ 有效期: 7-30 天       │
│  ├─ 存储: 内存/Header      ├─ 存储: HttpOnly Cookie │
│  ├─ 用途: API 请求认证     ├─ 用途: 刷新 Access Token │
│  └─ 可被吊销              └─ 可被吊销              │
│                                                  │
│  请求流程:                                        │
│  Client ──[Access Token]──> API                  │
│    │  (过期 401)                                   │
│    └──[Refresh Token]──> Auth Server             │
│         └──[New Access Token]──> Client           │
└─────────────────────────────────────────────────┘
```

在 Laravel 中实现 Refresh Token 的刷新逻辑：

```php
<?php

namespace App\Http\Controllers\Api;

use App\Services\Auth\JwtBlacklistService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cookie;

class AuthController extends Controller
{
    public function refresh(JwtBlacklistService $blacklist): JsonResponse
    {
        $refreshToken = request()->cookie('refresh_token');

        if (!$refreshToken) {
            return response()->json(['message' => 'Refresh token not found'], 401);
        }

        // 先吊销旧的 Refresh Token（防止重放）
        $blacklist->blacklist($refreshToken);

        // 生成新的双 Token 对
        $user = auth()->user();
        $newAccessToken = auth()->claims([
            'type' => 'access',
        ])->tokenById($user->id);

        $newRefreshToken = auth()->claims([
            'type' => 'refresh',
        ])->setTTL(config('jwt.refresh_ttl', 20160))->tokenById($user->id);

        return response()->json([
            'access_token' => $newAccessToken,
            'token_type' => 'bearer',
        ])->cookie(
            'refresh_token',
            $newRefreshToken,
            config('jwt.refresh_ttl', 20160),
            '/', null, true, true  // HttpOnly + Secure
        );
    }
}
```

### 2.4 踩坑经验

**坑1：Redis 内存膨胀**
刚开始我们把黑名单 key 的 TTL 设成了 7 天（与 refresh_ttl 一致），但实际上 access_token 只有 60 分钟有效期。这导致黑名单中大量 key 已经无意义却仍占内存。解决：黑名单 TTL 精确匹配 Token 剩余有效期，而非统一设为最大值。

**坑2：并发刷新导致 Token 冲突**
用户快速连续点击刷新，可能导致旧 Refresh Token 被吊销但新 Token 还没返回给客户端。解决：引入一个短暂的 grace period（宽限期），允许旧 Refresh Token 在吊销后的 30 秒内仍可用：

```php
public function revokeAllForUser(int $userId): bool
{
    // 30 秒宽限期，避免并发刷新时的竞态条件
    return parent::revokeAllForUser($userId, 30);
}
```

---

## 三、请求签名：HMAC-SHA256 签名算法与 Laravel 实现

### 3.1 为什么需要请求签名

JWT 解决的是「你是谁」的问题，但它无法解决：
- 请求在传输过程中被篡改（即使 HTTPS 也有中间人攻击的可能）
- 第三方恶意构造请求
- 请求参数被偷偷修改

请求签名的目的：**确保请求的完整性和真实性**。

### 3.2 签名算法设计

我们采用 HMAC-SHA256 签名算法，签名内容包括：

```
签名字符串 = HTTP_METHOD + "\n"
           + REQUEST_URI + "\n"
           + SORTED_QUERY_STRING + "\n"
           + TIMESTAMP + "\n"
           + NONCE + "\n"
           + SHA256(REQUEST_BODY)

签名 = HMAC-SHA256(签名字符串, SECRET_KEY)
```

为什么这么设计：
- **HTTP_METHOD + URI**：防止将签名用于不同的接口
- **排序后的 Query String**：防止参数顺序变化导致签名不一致
- **Timestamp + Nonce**：防重放（后面详细讲）
- **Body Hash**：确保请求体不被篡改

### 3.3 Laravel Middleware 实现

```php
<?php

namespace App\Http\Middleware\Api;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Symfony\Component\HttpFoundation\Response;

class RequestSignatureVerification
{
    /**
     * 签名有效窗口（秒）——超过此时间的请求视为过期
     */
    protected int $timestampWindow = 300; // 5 分钟

    /**
     * 各客户端的 Secret Key 映射
     * 生产环境建议从数据库或配置中心读取
     */
    protected function getClientSecret(string $appKey): ?string
    {
        // 实际项目中，app_key -> secret 的映射通常存在数据库
        $clients = config('api.clients', []);
        return $clients[$appKey] ?? null;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $appKey = $request->header('X-App-Key');
        $signature = $request->header('X-Signature');
        $timestamp = $request->header('X-Timestamp');
        $nonce = $request->header('X-Nonce');

        // 1. 检查必要头部是否存在
        if (!$appKey || !$signature || !$timestamp || !$nonce) {
            return response()->json([
                'message' => 'Missing required signature headers',
                'error_code' => 'MISSING_HEADERS',
            ], 401);
        }

        // 2. 校验 Timestamp 是否在有效窗口内
        $timeDiff = abs(time() - (int) $timestamp);
        if ($timeDiff > $this->timestampWindow) {
            return response()->json([
                'message' => 'Request expired',
                'error_code' => 'TIMESTAMP_EXPIRED',
            ], 401);
        }

        // 3. 校验 Nonce 是否已使用过（防重放）
        $nonceKey = "api_nonce:{$nonce}";
        $nonceExists = Redis::setnx($nonceKey, 1);
        if (!$nonceExists) {
            return response()->json([
                'message' => 'Duplicate request detected',
                'error_code' => 'NONCE_REUSED',
            ], 401);
        }
        // Nonce 缓存时间 = timestamp 窗口的 2 倍，确保覆盖
        Redis::expire($nonceKey, $this->timestampWindow * 2);

        // 4. 获取客户端 Secret
        $secret = $this->getClientSecret($appKey);
        if (!$secret) {
            return response()->json([
                'message' => 'Invalid app key',
                'error_code' => 'INVALID_APP_KEY',
            ], 401);
        }

        // 5. 构造签名字符串
        $signString = $this->buildSignString($request, $timestamp, $nonce);

        // 6. 计算期望的签名
        $expectedSignature = hash_hmac('sha256', $signString, $secret);

        // 7. 时间安全的比较（防止时序攻击）
        if (!hash_equals($expectedSignature, $signature)) {
            // 记录签名失败日志，便于排查
            logger()->warning('API Signature mismatch', [
                'app_key' => $appKey,
                'path' => $request->path(),
                'expected' => $expectedSignature,
                'actual' => $signature,
                'sign_string' => $signString,
            ]);

            return response()->json([
                'message' => 'Invalid signature',
                'error_code' => 'SIGNATURE_MISMATCH',
            ], 401);
        }

        return $next($request);
    }

    /**
     * 构造待签名字符串
     */
    protected function buildSignString(Request $request, string $timestamp, string $nonce): string
    {
        $method = strtoupper($request->method());
        $uri = $request->getRequestUri();

        // Query 参数排序
        $queryParams = $request->query();
        ksort($queryParams);
        $sortedQuery = http_build_query($queryParams);

        // 请求体 Hash
        $bodyContent = $request->getContent() ?: '';
        $bodyHash = hash('sha256', $bodyContent);

        return implode("\n", [
            $method,
            $uri,
            $sortedQuery,
            $timestamp,
            $nonce,
            $bodyHash,
        ]);
    }
}
```

### 3.4 客户端签名示例（PHP/JavaScript）

给调用方提供一个清晰的签名工具类：

```php
<?php

namespace App\Support\Api;

class ApiSignature
{
    public static function generate(
        string $appKey,
        string $secret,
        string $method,
        string $uri,
        array $queryParams = [],
        string $body = ''
    ): array {
        $timestamp = (string) time();
        $nonce = bin2hex(random_bytes(16)); // 32 位随机字符串

        ksort($queryParams);
        $sortedQuery = http_build_query($queryParams);
        $bodyHash = hash('sha256', $body);

        $signString = implode("\n", [
            strtoupper($method),
            $uri,
            $sortedQuery,
            $timestamp,
            $nonce,
            $bodyHash,
        ]);

        $signature = hash_hmac('sha256', $signString, $secret);

        return [
            'X-App-Key'   => $appKey,
            'X-Signature' => $signature,
            'X-Timestamp' => $timestamp,
            'X-Nonce'     => $nonce,
        ];
    }
}
```

### 3.5 踩坑经验

**坑1：忘记对 Query 参数排序**
我们的一个第三方对接方在拼接签名字符串时，没有对 Query 参数排序。当请求携带 `?name=foo&age=20` 时，服务端排序后是 `age=20&name=foo`，而客户端保持原顺序，导致签名永远不匹配。**教训：文档中必须明确写清排序规则，并附上示例。**

**坑2：hash_equals 的重要性**
早期版本中我们用 `===` 比较签名字符串，这存在时序攻击风险——攻击者可以通过响应时间差异逐字节猜出正确签名。`hash_equals` 会进行恒定时间比较，消除这种侧信道。

**坑3：GET 请求的 Body 问题**
部分 HTTP 客户端在发送 GET 请求时也会携带 Body，而服务端通常不读取 GET 的 Body。这会导致两端计算的 BodyHash 不一致。解决方案：GET 请求统一传空字符串。

---

## 四、IP 白名单与速率限制

### 4.1 IP 白名单：第一道防线

IP 白名单是最简单但也最有效的防御手段之一，特别适用于：
- 内部 API（只允许内网或特定服务器调用）
- 管理后台 API
- Webhook 回调接口

```php
<?php

namespace App\Http\Middleware\Api;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Symfony\Component\HttpFoundation\Response;

class IpWhitelist
{
    /**
     * 从配置获取白名单 IP
     * 支持 CIDR 格式：192.168.1.0/24
     */
    protected array $whitelist = [];

    public function __construct()
    {
        $this->whitelist = config('api.ip_whitelist', []);
    }

    public function handle(Request $request, Closure $next): Response
    {
        $clientIp = $this->getRealIp($request);

        if (!$this->isAllowed($clientIp)) {
            logger()->warning('IP not in whitelist', [
                'ip' => $clientIp,
                'path' => $request->path(),
                'user_agent' => $request->userAgent(),
            ]);

            return response()->json([
                'message' => 'Forbidden',
                'error_code' => 'IP_NOT_ALLOWED',
            ], 403);
        }

        return $next($request);
    }

    /**
     * 获取真实 IP（考虑反向代理）
     */
    protected function getRealIp(Request $request): string
    {
        // 仅在信任的代理后面才读取 X-Forwarded-For
        if ($request->isFromTrustedProxy()) {
            return $request->ip();
        }

        return $request->ip();
    }

    /**
     * 检查 IP 是否在白名单中（支持 CIDR）
     */
    protected function isAllowed(string $ip): bool
    {
        // 优先检查 Redis 中的动态白名单
        if (Redis::sismember('api_ip_whitelist', $ip)) {
            return true;
        }

        foreach ($this->whitelist as $allowed) {
            if (str_contains($allowed, '/')) {
                if ($this->ipInCidr($ip, $allowed)) {
                    return true;
                }
            } else {
                if ($ip === $allowed) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * CIDR 匹配
     */
    protected function ipInCidr(string $ip, string $cidr): bool
    {
        [$subnet, $mask] = explode('/', $cidr);
        $subnetLong = ip2long($subnet);
        $ipLong = ip2long($ip);
        $netmask = -1 << (32 - (int) $mask);
        $subnetLong &= $netmask;

        return ($ipLong & $netmask) === $subnetLong;
    }
}
```

### 4.2 动态白名单

静态配置的白名单在需要临时授权新 IP 时很不方便。我们通过 Redis SET 实现了一个**动态白名单**，支持运行时添加/移除：

```php
<?php

namespace App\Services\Api;

use Illuminate\Support\Facades\Redis;

class DynamicIpWhitelist
{
    protected string $key = 'api_ip_whitelist';
    protected int $defaultTtl = 86400; // 默认 24 小时

    /**
     * 添加 IP 到白名单（可设置过期时间）
     */
    public function add(string $ip, ?string $reason = null, ?int $ttl = null): bool
    {
        Redis::sadd($this->key, $ip);

        // 记录审计日志
        Redis::hset("api_ip_whitelist_meta", $ip, json_encode([
            'added_at' => now()->toIso8601String(),
            'reason' => $reason,
            'expires_at' => $ttl ? now()->addSeconds($ttl)->toIso8601String() : null,
        ]));

        if ($ttl) {
            // 注意：Redis SET 本身不支持元素级 TTL
            // 实际方案：用 Sorted Set，score 为过期时间戳，定期清理
            Redis::zadd($this->key . ':ttl', time() + $ttl, $ip);
        }

        return true;
    }

    public function remove(string $ip): bool
    {
        Redis::srem($this->key, $ip);
        Redis::hdel("api_ip_whitelist_meta", $ip);
        Redis::zrem($this->key . ':ttl', $ip);
        return true;
    }

    /**
     * 清理过期的白名单 IP（由定时任务调用）
     */
    public function cleanup(): int
    {
        $expired = Redis::zrangebyscore($this->key . ':ttl', '-inf', time());
        $count = 0;

        foreach ($expired as $ip) {
            $this->remove($ip);
            $count++;
        }

        return $count;
    }
}
```

### 4.3 速率限制：Redis 滑动窗口

Laravel 自带的 `RateLimiter` 基于固定窗口，在窗口边界存在「突刺」问题。例如限制每分钟 100 次，在第 59 秒发送 100 次，第 61 秒再发 100 次——两秒内发了 200 次，突破了限制。

**滑动窗口算法**可以完美解决这个问题：

```php
<?php

namespace App\Http\Middleware\Api;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Symfony\Component\HttpFoundation\Response;

class SlidingWindowRateLimiter
{
    protected int $maxRequests = 100;
    protected int $windowSeconds = 60;

    public function handle(Request $request, Closure $next): Response
    {
        $key = $this->resolveKey($request);

        if (!$this->isAllowed($key)) {
            $retryAfter = $this->getRetryAfter($key);

            return response()->json([
                'message' => 'Too many requests',
                'error_code' => 'RATE_LIMIT_EXCEEDED',
                'retry_after' => $retryAfter,
            ], 429)->header('Retry-After', $retryAfter);
        }

        $response = $next($request);

        // 在响应头中附加速率限制信息
        $remaining = $this->getRemaining($key);
        return $response->withHeaders([
            'X-RateLimit-Limit' => $this->maxRequests,
            'X-RateLimit-Remaining' => max(0, $remaining),
        ]);
    }

    /**
     * 滑动窗口算法核心
     */
    protected function isAllowed(string $key): bool
    {
        $now = microtime(true);
        $windowStart = $now - $this->windowSeconds;

        $redisKey = "rate_limit:{$key}";

        // 使用 Redis Pipeline 减少 RTT
        $pipe = Redis::pipeline(function ($pipe) use ($redisKey, $now, $windowStart) {
            // 移除窗口外的旧记录
            $pipe->zremrangebyscore($redisKey, '-inf', $windowStart);
            // 统计当前窗口内的请求数
            $pipe->zcard($redisKey);
            // 添加当前请求
            $pipe->zadd($redisKey, $now, uniqid('', true));
            // 设置 key 过期（兜底清理）
            $pipe->expire($redisKey, $this->windowSeconds + 1);
        });

        // $pipe[1] 是 zcard 的结果
        $currentCount = $pipe[1];

        return $currentCount < $this->maxRequests;
    }

    protected function resolveKey(Request $request): string
    {
        $userId = auth()->id();
        if ($userId) {
            return "user:{$userId}";
        }
        return "ip:" . $request->ip();
    }

    protected function getRemaining(string $key): int
    {
        $redisKey = "rate_limit:{$key}";
        $count = Redis::zcard($redisKey);
        return $this->maxRequests - $count;
    }

    protected function getRetryAfter(string $key): int
    {
        $redisKey = "rate_limit:{$key}";
        $oldest = Redis::zrange($redisKey, 0, 0, true);
        if (empty($oldest)) {
            return 1;
        }
        $retryAfter = ceil(current($oldest) + $this->windowSeconds - microtime(true));
        return max(1, (int) $retryAfter);
    }
}
```

### 4.4 Laravel 原生 RateLimiter 的使用

对于简单场景，Laravel 的 `RateLimiter` 也很好用：

```php
// routes/api.php 或 AppServiceProvider
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;

// 定义限流规则
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(120)->by(
        $request->user()?->id ?: $request->ip()
    );
});

// 对敏感接口加强限制
RateLimiter::for('auth', function (Request $request) {
    return [
        Limit::perMinute(5)->by($request->ip()),
        Limit::perMinute(3)->by($request->input('email')),
    ];
});
```

---

## 五、防重放攻击：让每个请求独一无二

### 5.1 什么是重放攻击

重放攻击（Replay Attack）是指攻击者截获一个合法请求后，原封不动地再次发送。即使请求被 HTTPS 加密，攻击者仍然可以在客户端侧（如浏览器开发者工具、抓包代理）截获请求后重放。

场景举例：
- 截获「转账 100 元」的请求，重放 100 次
- 截获「修改密码」的请求，用于后续攻击
- 截获登录请求，获取新的 Token

### 5.2 防御三要素

防重放的核心是确保每个请求的**唯一性**和**时效性**。三个要素缺一不可：

```
┌──────────────────────────────────────────────────────┐
│                防重放攻击三要素                         │
├──────────────────────────────────────────────────────┤
│                                                       │
│  1. Timestamp（时间戳）                                │
│     └─ 确保请求在有效窗口内（如 ±5 分钟）               │
│                                                       │
│  2. Nonce（一次性随机数）                               │
│     └─ 确保同一请求不会被重复执行                       │
│                                                       │
│  3. Request Body Hash（请求体哈希）                     │
│     └─ 确保请求内容未被篡改                            │
│                                                       │
│  三者结合：                                            │
│  ┌─────────────┐    ┌──────────────┐                 │
│  │ Timestamp    │───>│  是否过期？   │ ── 否 ──┐       │
│  └─────────────┘    └──────────────┘         │       │
│  ┌─────────────┐    ┌──────────────┐         ▼       │
│  │ Nonce       │───>│  是否重复？   │ ── 否 ──┐       │
│  └─────────────┘    └──────────────┘         │       │
│  ┌─────────────┐    ┌──────────────┐         ▼       │
│  │ Body Hash   │───>│  是否匹配？   │ ── 是 ──> 放行  │
│  └─────────────┘    └──────────────┘                 │
└──────────────────────────────────────────────────────┘
```

### 5.3 Nonce 去重的 Redis SETNX 实现

前面在请求签名的 Middleware 中已经包含了 Nonce 校验的核心代码，这里补充一些细节和边界情况处理：

```php
<?php

namespace App\Services\Api;

use Illuminate\Support\Facades\Redis;

class NonceGuard
{
    /**
     * 校验并消费 Nonce
     *
     * 使用 Redis SETNX 实现原子性去重：
     * - SETNX 返回 1：key 不存在，设置成功 → 首次使用，放行
     * - SETNX 返回 0：key 已存在 → 重复请求，拒绝
     *
     * @return bool true 表示 Nonce 有效（首次使用），false 表示重复
     */
    public function verify(string $nonce, int $ttl = 600): bool
    {
        $key = "api_nonce:{$nonce}";

        // SETNX + EXPIRE 的原子操作（Redis 2.6.12+）
        $result = Redis::set($key, time(), 'NX', 'EX', $ttl);

        return $result === true || $result === 'OK';
    }

    /**
     * 批量校验（用于事务性 API）
     */
    public function verifyMultiple(array $nonces, int $ttl = 600): array
    {
        $results = [];

        $pipe = Redis::pipeline(function ($pipe) use ($nonces, $ttl, &$results) {
            foreach ($nonces as $nonce) {
                $key = "api_nonce:{$nonce}";
                $pipe->set($key, time(), 'NX', 'EX', $ttl);
            }
        });

        foreach ($nonces as $index => $nonce) {
            $results[$nonce] = $pipe[$index] === true || $pipe[$index] === 'OK';
        }

        return $results;
    }

    /**
     * 统计指定时间窗口内的 Nonce 数量
     * 用于监控异常请求量
     */
    public function countRecentNonces(string $prefix = 'api_nonce:', int $window = 60): int
    {
        // 这里使用 SCAN 避免阻塞 Redis
        $count = 0;
        $cursor = null;

        do {
            [$cursor, $keys] = Redis::scan($cursor ?? 0, [
                'match' => $prefix . '*',
                'count' => 100,
            ]);
            $count += count($keys);
        } while ($cursor);

        return $count;
    }
}
```

### 5.4 完整的防重放 Middleware

```php
<?php

namespace App\Http\Middleware\Api;

use App\Services\Api\NonceGuard;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ReplayProtection
{
    protected int $timestampWindow = 300; // 5 分钟
    protected int $nonceTtl = 600;        // 10 分钟（是 timestamp 窗口的 2 倍）

    public function __construct(protected NonceGuard $nonceGuard) {}

    public function handle(Request $request, Closure $next): Response
    {
        $timestamp = (int) $request->header('X-Timestamp', 0);
        $nonce = $request->header('X-Nonce', '');

        // 1. Timestamp 校验
        if (!$this->validateTimestamp($timestamp)) {
            return $this->reject('REQUEST_EXPIRED', 'Request timestamp is outside the allowed window');
        }

        // 2. Nonce 校验
        if (!$this->nonceGuard->verify($nonce, $this->nonceTtl)) {
            return $this->reject('NONCE_REUSED', 'Duplicate request detected');
        }

        // 3. 可选：请求体 Hash 校验（如果签名 Middleware 已做，这里可以跳过）
        $bodyHash = $request->header('X-Body-Hash');
        if ($bodyHash) {
            $actualHash = hash('sha256', $request->getContent() ?: '');
            if (!hash_equals($bodyHash, $actualHash)) {
                return $this->reject('BODY_MISMATCH', 'Request body has been tampered');
            }
        }

        return $next($request);
    }

    protected function validateTimestamp(int $timestamp): bool
    {
        if ($timestamp <= 0) {
            return false;
        }

        $diff = abs(time() - $timestamp);
        return $diff <= $this->timestampWindow;
    }

    protected function reject(string $code, string $message): Response
    {
        return response()->json([
            'message' => $message,
            'error_code' => $code,
        ], 401);
    }
}
```

### 5.5 踩坑经验

**坑1：服务器时钟不同步**
我们在对接一个第三方支付回调时，对方的服务器时间比我们快了 8 分钟，导致所有回调都被我们的时间窗口拒绝。**教训：时间窗口不能太小，生产环境建议 3-10 分钟；同时确保所有服务器都同步了 NTP。**

**坑2：高并发下 SETNX 的 Redis 性能**
在大促期间，API 的 QPS 突然飙到 5000+，Nonce 校验的 Redis 操作成为瓶颈。优化方案：
1. 使用 Redis Pipeline 批量操作
2. 使用 Redis Cluster 分散压力
3. 对于可幂等的接口（如查询），可以不做 Nonce 校验

**坑3：客户端 Nonce 生成不规范**
有些对接方用 `md5(时间戳)` 作为 Nonce，这在高并发下可能碰撞。**文档必须明确：Nonce 必须是密码学安全的随机数（至少 16 字节），推荐 `random_bytes(16)` 或 `uuid4`。**

---

## 六、多层防御组合：架构图与中间件执行顺序

### 6.1 架构总览

```
                        ┌──────────────────────────┐
                        │        客户端              │
                        │  ┌──────────────────────┐ │
                        │  │ 1. 生成 Timestamp    │ │
                        │  │ 2. 生成 Nonce        │ │
                        │  │ 3. 计算签名           │ │
                        │  │ 4. 携带 JWT Token    │ │
                        │  └──────────────────────┘ │
                        └───────────┬──────────────┘
                                    │ HTTPS
                                    ▼
┌───────────────────────────────────────────────────────────┐
│                      Nginx / Load Balancer                │
│                   (SSL 终端、基础 IP 过滤)                  │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   Laravel Middleware 栈                    │
│                                                           │
│  ┌─ Layer 1: IP 白名单 ─────────────────────────────────┐ │
│  │  · 检查来源 IP 是否在白名单中                          │ │
│  │  · 不在白名单 → 403 Forbidden                        │ │
│  └───────────────────────────┬──────────────────────────┘ │
│                              │                            │
│  ┌─ Layer 2: 速率限制 ─────────────────────────────────┐ │
│  │  · 滑动窗口算法，每用户/IP 限制 QPS                   │ │
│  │  · 超限 → 429 Too Many Requests                     │ │
│  └───────────────────────────┬──────────────────────────┘ │
│                              │                            │
│  ┌─ Layer 3: 请求签名验证 ────────────────────────────┐ │
│  │  · 校验 Timestamp 在有效窗口内                       │ │
│  │  · 校验 Nonce 未使用过                               │ │
│  │  · 校验 HMAC-SHA256 签名                             │ │
│  │  · 签名无效 → 401 Unauthorized                      │ │
│  └───────────────────────────┬──────────────────────────┘ │
│                              │                            │
│  ┌─ Layer 4: JWT 认证 + 黑名单检查 ──────────────────┐  │
│  │  · 验证 JWT 签名和有效期                             │  │
│  │  · 检查 JTI 是否在黑名单中                           │  │
│  │  · 检查用户级吊销时间戳                              │  │
│  │  · 认证失败 → 401 Unauthorized                     │  │
│  └───────────────────────────┬──────────────────────────┘ │
│                              │                            │
│  ┌─ Layer 5: 业务逻辑 ────────────────────────────────┐  │
│  │  · Controller 处理业务                               │  │
│  │  · 权限校验（Policy/Gate）                           │  │
│  │  · 参数验证（FormRequest）                           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                      日志审计系统                           │
│  · 所有请求的签名信息、IP、User-Agent                       │
│  · 被拦截的请求（含拦截原因）                               │
│  · 异常行为检测（同一 IP 短时间内大量失败）                  │
│  · 告警通知（钉钉/Slack/邮件）                              │
└───────────────────────────────────────────────────────────┘
```

### 6.2 中间件执行顺序

在 Laravel 中，中间件的执行顺序至关重要。在 `app/Http/Kernel.php` 中的配置：

```php
<?php

// app/Http/Kernel.php

protected $middlewareGroups = [
    'api' => [
        // 第 1 层：IP 白名单（最先执行，最快拒绝）
        \App\Http\Middleware\Api\IpWhitelist::class,

        // 第 2 层：速率限制
        \App\Http\Middleware\Api\SlidingWindowRateLimiter::class,

        // 第 3 层：防重放（Timestamp + Nonce 校验）
        \App\Http\Middleware\Api\ReplayProtection::class,

        // 第 4 层：请求签名验证
        \App\Http\Middleware\Api\RequestSignatureVerification::class,

        // Laravel 内置中间件
        \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api',
        \Illuminate\Routing\Middleware\SubstituteBindings::class,

        // 第 5 层：JWT 认证（放在路由级别，非全局）
    ],
];
```

**为什么这个顺序？**

- **IP 白名单最前面**：这是成本最低的校验（纯内存操作），不符合条件的请求应该在最早阶段被拒绝，避免浪费后续的 Redis 查询和加密计算。
- **速率限制第二**：防止恶意 IP 通过大量伪造请求消耗系统资源。
- **防重放第三**：Timestamp + Nonce 校验需要访问 Redis，但计算量远小于签名验证。
- **签名验证第四**：需要 HMAC 计算，CPU 开销相对较大。
- **JWT 认证最后**：通常放在路由级别，只对需要认证的接口生效。

### 6.3 日志审计

安全防御的最后一步也是最容易被忽视的一步：**日志审计**。没有日志，你永远不知道自己被攻击了多少次。

```php
<?php

namespace App\Listeners\Api;

use Illuminate\Support\Facades\Redis;

class ApiSecurityAuditLogger
{
    /**
     * 记录所有安全相关事件
     */
    public function logSecurityEvent(string $eventType, array $context): void
    {
        $logEntry = [
            'event' => $eventType,
            'timestamp' => now()->toIso8601String(),
            'ip' => $context['ip'] ?? request()->ip(),
            'path' => $context['path'] ?? request()->path(),
            'method' => request()->method(),
            'user_agent' => request()->userAgent(),
            'user_id' => auth()->id(),
            'app_key' => request()->header('X-App-Key'),
            'details' => $context['details'] ?? [],
        ];

        // 写入日志文件
        logger()->channel('security')->warning($eventType, $logEntry);

        // 写入 Redis（用于实时监控和告警）
        $this->trackForAlerting($eventType, $logEntry);
    }

    /**
     * 实时告警检测
     */
    protected function trackForAlerting(string $eventType, array $logEntry): void
    {
        $ip = $logEntry['ip'];
        $minuteKey = "security_events:{$ip}:" . date('YmdHi');

        // 统计该 IP 在当前分钟的失败次数
        $count = Redis::incr($minuteKey);
        Redis::expire($minuteKey, 120);

        // 同一 IP 1 分钟内超过 10 次安全事件 → 触发告警
        if ($count > 10) {
            $this->sendAlert($ip, $eventType, $count);
        }
    }

    protected function sendAlert(string $ip, string $eventType, int $count): void
    {
        // 避免重复告警（5 分钟内同一 IP 只告警一次）
        $alertKey = "security_alert_sent:{$ip}";
        if (Redis::set($alertKey, 1, 'NX', 'EX', 300) === false) {
            return;
        }

        // 发送钉钉/Slack 通知
        logger()->critical("🚨 Security Alert", [
            'ip' => $ip,
            'event_type' => $eventType,
            'count_per_minute' => $count,
        ]);

        // 可选：自动将该 IP 加入临时黑名单
        Redis::sadd('api_ip_blacklist_temp', $ip);
        Redis::expire('api_ip_blacklist_temp', 3600); // 封禁 1 小时
    }
}
```

---

## 七、踩坑与经验总结

### 7.1 十大实战教训

经过在生产环境中的长期运行，我们总结了以下十条经验：

**1. 不要过度依赖单一防御层**
我们曾认为有了 JWT 认证就够了，结果攻击者通过 XSS 窃取了用户 Token 后直接调用 API。多层防御是必须的。

**2. 签名 Secret 的管理至关重要**
Secret 泄露 = 安全体系崩溃。我们通过以下措施保护 Secret：
- 使用 Laravel 的加密环境变量
- 定期轮换 Secret（每 90 天）
- 使用 HSM（硬件安全模块）存储最敏感的密钥
- 不同环境（dev/staging/prod）使用不同的 Secret

**3. Nginx 层也要做基础防护**
Laravel 中间件的执行需要 PHP 运行时，在 QPS 很高的情况下，仅靠 Laravel 的中间件不够。Nginx 层可以做：
```nginx
# Nginx 基础防护配置
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;

    # 拒绝明显不合法的请求
    if ($request_method !~ ^(GET|POST|PUT|DELETE|PATCH)$) {
        return 405;
    }

    # 限制请求体大小
    client_max_body_size 1m;
}
```

**4. 时钟同步是基础设施问题**
防重放依赖时间戳校验，而时间戳依赖服务器时钟同步。我们吃过一次亏：Kubernetes 节点的 NTP 服务出了问题，时钟偏移了 4 分钟，导致大量合法请求被拒绝。现在我们用 Prometheus 监控所有节点的时钟偏移。

**5. Redis 高可用不能忽视**
安全层大量依赖 Redis，如果 Redis 挂了：
- JWT 黑名单无法检查 → 安全降级，但不能完全拒绝请求
- Nonce 无法校验 → 可能被重放攻击
- 速率限制失效 → 可能被 DDoS

我们的策略：Redis Sentinel 做高可用，Redis 挂了时临时放行并记录告警日志。

**6. 日志的性能影响**
安全层的大量日志写入会影响 API 性能。我们把安全日志写入单独的 Redis List，然后由后台消费者异步写入 Elasticsearch。

**7. 测试时的安全降级策略**
在测试环境中，为了方便调试，我们通过环境变量控制各层安全策略的开关：
```php
// config/api.php
return [
    'security' => [
        'ip_whitelist_enabled' => env('API_IP_WHITELIST_ENABLED', true),
        'signature_enabled' => env('API_SIGNATURE_ENABLED', true),
        'replay_protection_enabled' => env('API_REPLAY_PROTECTION_ENABLED', true),
        'rate_limit_enabled' => env('API_RATE_LIMIT_ENABLED', true),
    ],
];
```

**8. 错误信息不要泄露太多细节**
签名验证失败时，返回的错误信息不要包含「期望的签名是什么」「签名字符串是什么」等敏感信息。只返回通用的错误码即可。

**9. API 版本兼容性**
当我们引入签名机制时，已有的客户端无法立刻升级。我们的做法是：v1 API 无签名要求，v2 API 强制签名，给客户端 3 个月的迁移期。

**10. 监控大盘必不可少**
我们在 Grafana 上建了安全监控大盘，实时展示：
- 各层拦截的请求数
- Top 10 被拦截 IP
- Nonce 重复率趋势
- 签名失败率趋势
- 速率限制触发频率

### 7.2 性能影响评估

多层安全防护不可避免地会增加 API 延迟。我们做了基准测试：

| 防御层 | 额外延迟（P99） | 备注 |
|--------|-----------------|------|
| IP 白名单 | < 0.1ms | 纯内存/CPU 操作 |
| 速率限制（滑动窗口）| 1-2ms | Redis ZRANGEBYSCORE |
| 防重放（Nonce 校验）| 1-2ms | Redis SETNX |
| 请求签名验证 | 2-3ms | HMAC-SHA256 计算 + Redis 查询 |
| JWT 黑名单检查 | 1-2ms | Redis GET |
| **总计** | **5-10ms** | **对大多数 API 可接受** |

对于 P99 要求 < 20ms 的 API，这 5-10ms 的额外开销是值得的。如果你的 API 对延迟极度敏感（如高频交易），可以考虑以下优化：
- 将安全校验放在 API Gateway（如 Kong、Envoy）层面
- 使用 Redis Pipeline 减少网络往返
- 对查询类请求放宽限制

---

## 八、总结

API 安全不是一蹴而就的事情，而是一个持续演进的过程。本文介绍的多层防御方案可以总结为：

```
┌─────────────────────────────────────────────┐
│           API 安全多层防御金字塔              │
│                                              │
│                    ▲                         │
│                   ╱ ╲                        │
│                  ╱   ╲                       │
│                 ╱ 业务 ╲                     │
│                ╱ 权限校验 ╲                   │
│               ╱─────────────╲               │
│              ╱  JWT 认证+黑名单 ╲             │
│             ╱─────────────────────╲          │
│            ╱   请求签名(HMAC-SHA256) ╲        │
│           ╱─────────────────────────────╲    │
│          ╱    防重放(Timestamp+Nonce)     ╲   │
│         ╱─────────────────────────────────╲  │
│        ╱      速率限制(滑动窗口)            ╲ │
│       ╱─────────────────────────────────────╲│
│      ╱        IP 白名单                      ╲│
│     ╱─────────────────────────────────────────│
│                                              │
│    越底层越基础，越顶层越核心                  │
└─────────────────────────────────────────────┘
```

每一层都有其不可替代的价值：
- **IP 白名单**：快速过滤非法来源
- **速率限制**：防止资源滥用
- **防重放**：确保请求的唯一性和时效性
- **请求签名**：确保请求的完整性和真实性
- **JWT + 黑名单**：确保用户身份的合法性和可控性

记住：**安全防御的目标不是让攻击者完全不可能成功，而是让攻击的成本远大于收益。** 多层防御正是实现这个目标的最有效手段。

---

*本文代码基于 Laravel 10.x + PHP 8.2 编写，完整项目源码将在后续文章中分享。如有疑问或建议，欢迎在评论区讨论。*

---

## 相关阅读

- [Laravel Sanctum 实战：SPA/API 令牌认证与移动端适配](/categories/Laravel-PHP/Laravel-Sanctum-实战-SPA-API-令牌认证与移动端适配/)
- [OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南——PKCE 强制、隐式流废弃与安全加固](/categories/PHP-Laravel/OAuth-2.1-实战-从OAuth2.0到2.1的迁移指南-PKCE强制隐式流废弃与安全加固/)
- [API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 的反爬与反滥用工程化方案](/categories/Laravel/API-Abuse-Prevention-Bot检测速率限制指纹识别-Laravel反爬与反滥用工程化方案/)
- [Laravel 幂等性设计模式实战：请求去重、支付回调防重复、队列消息 Exactly-Once](/categories/Laravel-PHP/Laravel-幂等性设计模式实战-请求去重-支付回调防重复-Exactly-Once/)
