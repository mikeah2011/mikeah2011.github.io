---
title: API Security 深度实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——多层防御的工程化方案
date: 2026-06-06 10:00:00
tags:
- API安全
- JWT
- 请求签名
- IP 白名单
- 防重放
- Laravel
categories:
- php
cover: /images/covers/api-security-multi-layer-cover.jpg
description: 本文系统性地构建 API Security 多层防御体系，涵盖 JWT 黑名单与白名单机制、Access Token + Refresh
  Token 双 Token 策略、HMAC-SHA256 请求签名、IP 白名单动态规则引擎、Nonce + Timestamp 防重放攻击等核心安全技术。所有方案均基于
  Laravel 框架提供生产级代码实现，适合需要加固 API 接口安全性的 PHP 开发者参考。
---


# API Security 深度实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——多层防御的工程化方案

> 单一的安全措施无法抵御真实的攻击向量。本文从工程化视角出发，系统性地构建一个 **多层防御体系**：从 JWT 黑名单/白名单机制、Access Token + Refresh Token 双 Token 策略、HMAC-SHA256 请求签名、IP 白名单动态规则引擎、Nonce + Timestamp 防重放，到多层限流、请求体完整性校验、安全审计日志——每一层都附带 Laravel 生产级代码实现与部署 Checklist。

<!-- more -->

---

## 一、API 安全威胁全景：OWASP API Top 10 简述

在动手写代码之前，我们必须先理解敌人。OWASP（Open Worldwide Application Security Project）在 2023 年发布了 API Security Top 10，以下是核心威胁概览：

| 排名 | 威胁 | 核心描述 | 典型场景 |
|------|------|---------|---------|
| API1 | Broken Object Level Authorization | 对象级授权缺失 | 通过篡改 URL 中的 ID 访问他人数据 |
| API2 | Broken Authentication | 认证机制薄弱 | JWT 密钥泄露、Token 无法撤销 |
| API3 | Broken Object Property Level Authorization | 属性级授权缺失 | 批量赋值导致越权修改 |
| API4 | Unrestricted Resource Consumption | 资源消耗无限制 | 无速率限制导致 DDoS |
| API5 | Broken Function Level Authorization | 功能级授权缺失 | 普通用户调用管理员接口 |
| API6 | Unrestricted Access to Sensitive Business Flows | 敏感业务流无保护 | 自动化脚本抢购、刷单 |
| API7 | Server Side Request Forgery | SSRF | 通过 URL 参数让服务端发起内网请求 |
| API8 | Security Misconfiguration | 安全配置错误 | 调试模式开启、CORS 过于宽松 |
| API9 | Improper Inventory Management | API 资产管理不善 | 旧版本 API 未下线 |
| API10 | Unsafe Consumption of APIs | 不安全的第三方 API 调用 | 信任未经验证的第三方响应 |

本文聚焦的 **JWT 黑名单、请求签名、IP 白名单、防重放攻击** 主要覆盖 **API2（认证）** 和 **API4（资源消耗）** 两大威胁面，同时对 API1（授权）和 API8（配置）形成补充防御。

---

## 二、JWT 安全：Token 黑名单/白名单机制

### 2.1 JWT 的先天缺陷

JWT（JSON Web Token）是无状态 Token 的典型代表。它的优势是服务端无需存储会话状态，但这也带来了核心问题：**一旦签发，无法主动撤销**。

常见需要撤销 Token 的场景：

- 用户修改密码后，旧 Token 应立即失效
- 用户在公共设备上登出
- 检测到异常登录行为，需要强制下线
- 管理员封禁用户账户

### 2.2 黑名单机制（Redis 实现）

黑名单是最常用的 Token 撤销方案：将已签发但需要废弃的 Token 加入黑名单，每次验证时先检查黑名单。

```php
<?php

namespace App\Services\Auth;

use Illuminate\Support\Facades\Redis;
use PHPOpenSourceSaver\JWTAuth\Facades\JWTAuth;

class JwtBlacklistService
{
    /**
     * 黑名单 Key 前缀
     */
    protected string $prefix = 'jwt_blacklist:';

    /**
     * 将 Token 加入黑名单
     */
    public function blacklist(string $token): void
    {
        $payload = JWTAuth::setToken($token)->getPayload();
        $jti = $payload->get('jti');         // JWT ID
        $exp = $payload->get('exp');         // 过期时间戳
        $ttl = max($exp - now()->timestamp, 1);

        // 以 JTI 为 Key，TTL 设为 Token 剩余有效期
        Redis::setex($this->prefix . $jti, $ttl, json_encode([
            'blacklisted_at' => now()->toIso8601String(),
            'reason' => 'user_logout',
            'ip' => request()->ip(),
        ]));
    }

    /**
     * 检查 Token 是否在黑名单中
     */
    public function isBlacklisted(string $token): bool
    {
        $payload = JWTAuth::setToken($token)->getPayload();
        $jti = $payload->get('jti');

        return Redis::exists($this->prefix . $jti);
    }

    /**
     * 撤销用户的所有 Token（全局登出 / 封号）
     * 通过记录 user_id 的"全局失效时间"实现
     */
    public function revokeAllForUser(int $userId, string $reason = 'admin_revoke'): void
    {
        $key = "jwt_user_revoked:{$userId}";
        Redis::setex($key, 86400 * 7, json_encode([
            'revoked_at' => now()->toIso8601String(),
            'reason' => $reason,
        ]));
    }

    /**
     * 检查用户是否被全局撤销
     */
    public function isUserRevoked(int $userId): bool
    {
        return Redis::exists("jwt_user_revoked:{$userId}");
    }
}
```

### 2.3 JWT 验证中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\Auth\JwtBlacklistService;
use PHPOpenSourceSaver\JWTAuth\Facades\JWTAuth;
use Symfony\Component\HttpFoundation\Response;

class JwtSecurityCheck
{
    public function __construct(
        protected JwtBlacklistService $blacklist
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        try {
            $token = JWTAuth::parseToken();
            $payload = $token->getPayload();
            $userId = $payload->get('sub');

            // 1. 检查用户级全局撤销
            if ($this->blacklist->isUserRevoked($userId)) {
                return response()->json([
                    'error' => 'TOKEN_REVOKED',
                    'message' => '该账户已被强制下线',
                ], 401);
            }

            // 2. 检查 Token 级黑名单
            if ($this->blacklist->isBlacklisted($token->getToken())) {
                return response()->json([
                    'error' => 'TOKEN_BLACKLISTED',
                    'message' => '该 Token 已失效，请重新登录',
                ], 401);
            }

            // 3. 验证 Token 有效性
            $token->authenticate();

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'TOKEN_INVALID',
                'message' => '认证失败：' . $e->getMessage(),
            ], 401);
        }

        return $next($request);
    }
}
```

### 2.4 白名单机制（对比方案）

与黑名单相反，白名单只允许"明确放行"的 Token 生效。每个 Token 在签发时写入 Redis，只有存在于白名单中的 Token 才被接受。白名单安全性更高，但需要为每个活跃 Token 存储状态，**内存开销较大**，适合高安全场景（如金融系统）。

```php
// 白名单签发
public function issueWithWhitelist(int $userId): array
{
    $token = JWTAuth::claims([
        'jti' => $jti = Str::uuid()->toString(),
    ])->fromUser(User::find($userId));

    $ttl = config('jwt.ttl') * 60;
    Redis::setex("jwt_whitelist:{$jti}", $ttl, $userId);

    return ['access_token' => $token, 'token_type' => 'bearer'];
}

// 白名单校验
public function isWhitelisted(string $jti): bool
{
    return Redis::exists("jwt_whitelist:{$jti}");
}
```

**黑白名单选型建议**：绝大多数业务场景使用 **黑名单** 即可（仅存储需要撤销的 Token）；白名单适合 Token 池很小、撤销频率极高的场景。

---

## 三、JWT 刷新策略：Access Token + Refresh Token 双 Token 方案

### 3.1 为什么需要双 Token？

单 Token 方案的矛盾在于：**Token 有效期短了用户体验差（频繁登录），长了安全性低（泄露窗口大）**。

双 Token 方案巧妙地解决了这个问题：

- **Access Token**：有效期短（15~30 分钟），用于 API 认证
- **Refresh Token**：有效期长（7~30 天），仅用于换取新的 Access Token

### 3.2 Laravel 实现

```php
<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class TokenPairService
{
    /**
     * 签发 Token 对
     */
    public function issueTokenPair(User $user): array
    {
        // Access Token：15 分钟有效
        $accessToken = auth()->claims([
            'type' => 'access',
            'jti' => $accessJti = Str::uuid()->toString(),
        ])->setTTL(15)->tokenById($user->id);

        // Refresh Token：7 天有效，存入 Redis 以便撤销
        $refreshToken = Str::random(128);
        $refreshJti = Str::uuid()->toString();

        Redis::setex("refresh_token:{$refreshJti}", 86400 * 7, json_encode([
            'user_id' => $user->id,
            'access_jti' => $accessJti,
            'created_at' => now()->toIso8601String(),
            'ip' => request()->ip(),
            'user_agent' => request()->userAgent(),
        ]));

        return [
            'access_token' => $accessToken,
            'refresh_token' => $refreshJti . ':' . $refreshToken,
            'token_type' => 'bearer',
            'expires_in' => 900, // 15 minutes
        ];
    }

    /**
     * 使用 Refresh Token 换取新的 Token 对
     */
    public function refresh(string $refreshToken): array
    {
        $parts = explode(':', $refreshToken, 2);
        if (count($parts) !== 2) {
            throw new \InvalidArgumentException('Refresh Token 格式错误');
        }

        [$jti, $secret] = $parts;
        $data = Redis::get("refresh_token:{$jti}");

        if (!$data) {
            throw new \InvalidArgumentException('Refresh Token 已失效或已使用');
        }

        $data = json_decode($data, true);

        // 验证 secret（防止 JTI 泄露后被滥用）
        // 生产环境中应存储 secret 的哈希值
        if (!hash_equals($data['secret_hash'] ?? '', hash('sha256', $secret))) {
            // 检测到 Refresh Token 被盗用，撤销该用户所有 Token
            Redis::del("refresh_token:{$jti}");
            app(JwtBlacklistService::class)->revokeAllForUser(
                $data['user_id'], 
                'refresh_token_compromised'
            );
            throw new \SecurityException('Refresh Token 异常，已强制下线所有设备');
        }

        // 刷新：删除旧 Refresh Token，签发新 Token 对
        Redis::del("refresh_token:{$jti}");

        $user = User::find($data['user_id']);
        return $this->issueTokenPair($user);
    }

    /**
     * 登出：撤销当前 Token 对
     */
    public function revoke(string $accessToken, string $refreshToken): void
    {
        // 撤销 Access Token
        app(JwtBlacklistService::class)->blacklist($accessToken);

        // 撤销 Refresh Token
        $jti = explode(':', $refreshToken)[0] ?? '';
        Redis::del("refresh_token:{$jti}");
    }
}
```

### 3.3 Refresh Token 安全要点

1. **Refresh Token Rotation**：每次使用 Refresh Token 后立即废弃旧的、签发新的，防止重放
2. **检测盗用**：如果一个已被使用的 Refresh Token 再次被提交，说明被盗，应撤销该用户所有 Token
3. **存储安全**：Refresh Token 的 secret 应存储哈希值而非明文
4. **设备绑定**：记录 IP 和 User-Agent，异常设备发起刷新时要求二次验证

---

## 四、请求签名（HMAC-SHA256）：防伪造与防篡改

### 4.1 请求签名的原理

JWT 解决了"你是谁"，但无法完全保证"请求内容未被篡改"。请求签名通过 HMAC-SHA256 对请求的关键要素（Method、Path、Timestamp、Nonce、Body）进行签名，确保：

- 请求内容在传输过程中未被篡改
- 请求来自持有正确密钥的合法客户端
- 配合 Timestamp 和 Nonce 可防止重放

### 4.2 签名算法设计

```
待签名字符串 = HTTP_METHOD\n
               REQUEST_PATH\n
               QUERY_STRING(sorted)\n
               TIMESTAMP\n
               NONCE\n
               SHA256(REQUEST_BODY)

签名 = HMAC-SHA256(待签名字符串, CLIENT_SECRET)
```

### 4.3 Laravel 客户端签名工具

```php
<?php

namespace App\Services\Crypto;

class RequestSigner
{
    /**
     * 生成请求签名
     */
    public static function sign(
        string $method,
        string $path,
        string $queryString,
        string $timestamp,
        string $nonce,
        string $body,
        string $secret
    ): string {
        $bodyHash = hash('sha256', $body);

        $payload = implode("\n", [
            strtoupper($method),
            $path,
            self::sortQueryString($queryString),
            $timestamp,
            $nonce,
            $bodyHash,
        ]);

        return hash_hmac('sha256', $payload, $secret);
    }

    /**
     * 对 Query String 参数按 Key 排序
     */
    protected static function sortQueryString(string $queryString): string
    {
        if (empty($queryString)) {
            return '';
        }

        parse_str($queryString, $params);
        ksort($params);
        return http_build_query($params);
    }
}
```

### 4.4 签名验证中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\Crypto\RequestSigner;
use App\Models\ApiClient;
use Symfony\Component\HttpFoundation\Response;

class VerifyRequestSignature
{
    /**
     * 允许的时钟偏差（秒）
     */
    protected int $clockSkew = 300; // 5 分钟

    public function handle(Request $request, Closure $next): Response
    {
        $timestamp = $request->header('X-Timestamp');
        $nonce = $request->header('X-Nonce');
        $signature = $request->header('X-Signature');
        $clientId = $request->header('X-Client-Id');

        // 1. 检查必需的签名头
        if (!$timestamp || !$nonce || !$signature || !$clientId) {
            return response()->json([
                'error' => 'MISSING_SIGNATURE_HEADERS',
                'message' => '缺少签名相关请求头',
            ], 401);
        }

        // 2. 检查时间戳有效性（防重放的第一道防线）
        $now = now()->timestamp;
        if (abs($now - (int)$timestamp) > $this->clockSkew) {
            return response()->json([
                'error' => 'TIMESTAMP_EXPIRED',
                'message' => '请求时间戳超出允许范围',
            ], 401);
        }

        // 3. 查找客户端密钥
        $client = ApiClient::where('client_id', $clientId)
            ->where('is_active', true)
            ->first();

        if (!$client) {
            return response()->json([
                'error' => 'INVALID_CLIENT',
                'message' => '无效的客户端',
            ], 401);
        }

        // 4. 计算期望签名
        $expected = RequestSigner::sign(
            $request->method(),
            $request->path(),
            $request->getQueryString() ?? '',
            $timestamp,
            $nonce,
            $request->getContent(),
            $client->client_secret
        );

        // 5. 使用 hash_equals 防止时序攻击
        if (!hash_equals($expected, $signature)) {
            return response()->json([
                'error' => 'INVALID_SIGNATURE',
                'message' => '签名校验失败',
            ], 401);
        }

        // 6. 将 client 信息注入 Request
        $request->attributes->set('api_client', $client);

        return $next($request);
    }
}
```

---

## 五、IP 白名单与动态规则引擎

### 5.1 静态 IP 白名单

最基础的 IP 访问控制，适用于服务端到服务端的内部 API：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class IpWhitelist
{
    /**
     * 配置的白名单 IP/CIDR
     */
    protected array $allowedNetworks = [
        '10.0.0.0/8',      // 内网
        '172.16.0.0/12',   // Docker 网络
        '203.0.113.0/24',  // 办公网络
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $clientIp = $request->ip();

        // 检查是否在白名单中
        foreach ($this->allowedNetworks as $network) {
            if ($this->ipInCidr($clientIp, $network)) {
                return $next($request);
            }
        }

        // 记录非法访问尝试
        \Log::warning('IP whitelist blocked request', [
            'ip' => $clientIp,
            'path' => $request->path(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json([
            'error' => 'IP_NOT_ALLOWED',
            'message' => '当前 IP 不在允许访问的范围内',
        ], 403);
    }

    /**
     * 判断 IP 是否在 CIDR 网段内
     */
    protected function ipInCidr(string $ip, string $cidr): bool
    {
        if (!str_contains($cidr, '/')) {
            return $ip === $cidr;
        }

        [$subnet, $mask] = explode('/', $cidr);
        return (ip2long($ip) & ~((1 << (32 - (int)$mask)) - 1)) === ip2long($subnet);
    }
}
```

### 5.2 动态规则引擎

生产环境中，IP 白名单不应硬编码，而应通过数据库或配置中心动态管理：

```php
<?php

namespace App\Services\Security;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class DynamicIpRuleEngine
{
    /**
     * 从数据库加载规则并评估
     */
    public function evaluate(string $ip, string $endpoint): array
    {
        $rules = $this->loadRules($endpoint);

        foreach ($rules as $rule) {
            if ($this->matchesRule($ip, $rule)) {
                return [
                    'action' => $rule['action'], // allow | deny | challenge
                    'rule_id' => $rule['id'],
                    'reason' => $rule['name'],
                ];
            }
        }

        // 默认策略
        return ['action' => 'allow', 'rule_id' => null, 'reason' => 'default'];
    }

    protected function loadRules(string $endpoint): array
    {
        return Cache::remember("ip_rules:{$endpoint}", 300, function () use ($endpoint) {
            return DB::table('security_rules')
                ->where('type', 'ip')
                ->where('is_active', true)
                ->where(function ($q) use ($endpoint) {
                    $q->where('endpoint_pattern', '*')
                      ->orWhere('endpoint_pattern', 'like', $endpoint);
                })
                ->orderBy('priority', 'desc')
                ->get()
                ->toArray();
        });
    }

    protected function matchesRule(string $ip, object $rule): bool
    {
        return match ($rule->match_type) {
            'exact' => $ip === $rule->ip_pattern,
            'cidr' => $this->ipInCidr($ip, $rule->ip_pattern),
            'regex' => (bool) preg_match($rule->ip_pattern, $ip),
            'country' => $this->getIpCountry($ip) === $rule->ip_pattern,
            default => false,
        };
    }

    protected function getIpCountry(string $ip): string
    {
        // 集成 GeoIP 库（如 GeoLite2）
        try {
            $reader = new \GeoIp2\Database\Reader(storage_path('app/GeoLite2-Country.mmdb'));
            return $reader->country($ip)->country->isoCode;
        } catch (\Exception $e) {
            return 'UNKNOWN';
        }
    }
}
```

---

## 六、防重放攻击：Nonce + Timestamp 方案

### 6.1 重放攻击原理

攻击者截获一个合法的请求（含签名、Token 等全部信息），原封不动地再次发送。由于所有字段都是合法的，服务端会认为这是一个正常请求。典型的危害场景包括：重复扣款、重复下单、重复提交表单。

### 6.2 Nonce + Timestamp 防御机制

核心思路：每个请求携带一个**唯一的随机数（Nonce）**和**时间戳（Timestamp）**，服务端：

1. 检查 Timestamp 是否在允许的时间窗口内（如 ±5 分钟）
2. 检查 Nonce 在该时间窗口内是否已被使用过

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Symfony\Component\HttpFoundation\Response;

class AntiReplay
{
    /**
     * Nonce 有效期（秒），应略大于签名中间件的 clockSkew
     */
    protected int $nonceTtl = 600; // 10 分钟

    /**
     * 时间窗口（秒）
     */
    protected int $timeWindow = 300; // 5 分钟

    public function handle(Request $request, Closure $next): Response
    {
        $timestamp = (int) $request->header('X-Timestamp', 0);
        $nonce = $request->header('X-Nonce', '');

        if (!$timestamp || !$nonce) {
            return response()->json([
                'error' => 'MISSING_ANTI_REPLAY_HEADERS',
                'message' => '缺少 X-Timestamp 或 X-Nonce 请求头',
            ], 400);
        }

        // 1. 时间戳窗口检查
        $now = now()->timestamp;
        if (abs($now - $timestamp) > $this->timeWindow) {
            return response()->json([
                'error' => 'REQUEST_EXPIRED',
                'message' => '请求已过期，请重新发起',
            ], 401);
        }

        // 2. Nonce 唯一性检查（使用 Redis SET NX 实现原子操作）
        $nonceKey = "nonce:{$nonce}";

        $isNewNonce = Redis::set($nonceKey, json_encode([
            'timestamp' => $timestamp,
            'ip' => $request->ip(),
            'path' => $request->path(),
            'consumed_at' => $now,
        ]), 'EX', $this->nonceTtl, 'NX');

        if (!$isNewNonce) {
            // Nonce 已存在，这是一次重放攻击
            \Log::warning('Replay attack detected', [
                'nonce' => $nonce,
                'ip' => $request->ip(),
                'path' => $request->path(),
                'original_timestamp' => $timestamp,
            ]);

            return response()->json([
                'error' => 'REPLAY_DETECTED',
                'message' => '检测到重放请求',
            ], 409);
        }

        return $next($request);
    }
}
```

### 6.3 Nonce 设计要点

1. **长度足够**：至少 32 字节的随机字符串（UUID v4 或 `random_bytes(32)` 的 hex 编码）
2. **TTL 设置**：Nonce 的 Redis TTL 应略大于 Timestamp 窗口，避免极端情况下误判
3. **幂等替代**：对于写操作，可以结合业务幂等 Key（如订单号）替代通用 Nonce
4. **性能考虑**：Redis SET NX 是 O(1) 操作，对性能影响极小

---

## 七、Rate Limiting 多层限流

### 7.1 限流的必要性

即使有了签名和防重放，攻击者仍可能通过大量合法请求耗尽服务器资源。多层限流可以在不同维度遏制滥用行为。

### 7.2 Laravel 多层限流实现

```php
<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class RateLimitServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 层级 1：IP 维度限流
        RateLimiter::for('api-ip', function (Request $request) {
            return [
                // 每分钟 60 次请求
                Limit::perMinute(60)->by('ip:' . $request->ip()),
                // 每秒 10 次突发请求
                Limit::perSecond(10)->by('ip_burst:' . $request->ip()),
            ];
        });

        // 层级 2：用户维度限流
        RateLimiter::for('api-user', function (Request $request) {
            $userId = $request->user()?->id ?? $request->ip();
            return [
                Limit::perMinute(120)->by('user:' . $userId),
                Limit::perHour(1000)->by('user_hourly:' . $userId),
            ];
        });

        // 层级 3：API Key 维度限流（开放平台场景）
        RateLimiter::for('api-key', function (Request $request) {
            $clientId = $request->header('X-Client-Id', 'anonymous');
            $tier = $this->getClientTier($clientId);

            return match ($tier) {
                'premium' => [
                    Limit::perMinute(300)->by("key:{$clientId}"),
                    Limit::perDay(100000)->by("key_daily:{$clientId}"),
                ],
                'standard' => [
                    Limit::perMinute(60)->by("key:{$clientId}"),
                    Limit::perDay(10000)->by("key_daily:{$clientId}"),
                ],
                default => [
                    Limit::perMinute(20)->by("key:{$clientId}"),
                    Limit::perDay(1000)->by("key_daily:{$clientId}"),
                ],
            };
        });

        // 层级 4：敏感接口限流（登录/注册/支付）
        RateLimiter::for('sensitive', function (Request $request) {
            return [
                Limit::perMinute(5)->by('sensitive:' . $request->ip()),
                Limit::perHour(20)->by('sensitive_hourly:' . $request->ip()),
            ];
        });
    }

    protected function getClientTier(string $clientId): string
    {
        return cache()->remember("client_tier:{$clientId}", 3600, function () use ($clientId) {
            return \App\Models\ApiClient::where('client_id', $clientId)
                ->value('tier') ?? 'free';
        });
    }
}
```

### 7.3 在路由中应用限流

```php
// routes/api.php

// 基础 API 限流（IP + 用户双层）
Route::middleware(['throttle:api-ip', 'throttle:api-user'])->group(function () {
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
});

// 敏感接口加强限流
Route::middleware(['throttle:sensitive'])->group(function () {
    Route::post('/auth/login', [AuthController::class, 'login']);
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/payments', [PaymentController::class, 'create']);
});

// 开放平台 API Key 限流
Route::middleware(['throttle:api-key'])->group(function () {
    Route::apiResource('/v2/products', V2ProductController::class);
});
```

---

## 八、请求体完整性校验与防篡改

### 8.1 Content-MD5 校验

在请求头中携带请求体的 MD5 哈希值，服务端验证后对比，确保请求体在传输过程中未被篡改：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyContentIntegrity
{
    public function handle(Request $request, Closure $next): Response
    {
        // 仅对有请求体的方法进行校验
        if (!in_array($request->method(), ['POST', 'PUT', 'PATCH'])) {
            return $next($request);
        }

        $contentMd5 = $request->header('Content-MD5');

        if ($contentMd5) {
            $body = $request->getContent();
            $calculated = base64_encode(md5($body, true));

            if (!hash_equals($calculated, $contentMd5)) {
                \Log::warning('Content integrity check failed', [
                    'expected' => $contentMd5,
                    'calculated' => $calculated,
                    'path' => $request->path(),
                ]);

                return response()->json([
                    'error' => 'CONTENT_INTEGRITY_FAILED',
                    'message' => '请求体完整性校验失败',
                ], 400);
            }
        }

        return $next($request);
    }
}
```

### 8.2 请求体哈希参与签名

更安全的做法是将请求体的 SHA256 哈希直接纳入签名计算（我们在第四节的签名算法中已经这样做了）。这样任何对请求体的篡改都会导致签名验证失败，实现双重保护。

---

## 九、Laravel 中的多层安全中间件栈

### 9.1 中间件执行顺序

安全中间件的执行顺序至关重要，原则是**越快拒绝越好**，减少无效请求的资源消耗：

```
请求进入
    │
    ▼
① IpWhitelist          ← IP 层，最快拦截，无 Redis 开销
    │
    ▼
② RateLimiter          ← 限流层，Redis 原子计数器
    │
    ▼
③ VerifyRequestSignature ← 签名校验，防伪造
    │
    ▼
④ AntiReplay           ← 防重放，Redis SET NX
    │
    ▼
⑤ VerifyContentIntegrity ← 请求体完整性
    │
    ▼
⑥ JwtSecurityCheck     ← JWT 认证 + 黑名单
    │
    ▼
⑦ 业务逻辑
```

### 9.2 Kernel 配置

```php
<?php

namespace App\Http;

use Illuminate\Foundation\Http\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    /**
     * 全局中间件
     */
    protected $middleware = [
        \App\Http\Middleware\TrustProxies::class,
        \App\Http\Middleware\HandleCors::class,
        \App\Http\Middleware\PreventRequestsDuringMaintenance::class,
        \Illuminate\Http\Middleware\ValidatePostSize::class,
        \Illuminate\Foundation\Http\Middleware\TrimStrings::class,
    ];

    /**
     * API 中间件组
     */
    protected $middlewareGroups = [
        'api' => [
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
            \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api',
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
        ],

        // 安全强化 API 中间件组
        'api-secure' => [
            \App\Http\Middleware\IpWhitelist::class,
            \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api-ip',
            \App\Http\Middleware\VerifyRequestSignature::class,
            \App\Http\Middleware\AntiReplay::class,
            \App\Http\Middleware\VerifyContentIntegrity::class,
            \App\Http\Middleware\JwtSecurityCheck::class,
            \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api-user',
        ],

        // 开放平台 API 中间件组
        'api-open' => [
            \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api-key',
            \App\Http\Middleware\VerifyRequestSignature::class,
            \App\Http\Middleware\AntiReplay::class,
            \App\Http\Middleware\VerifyContentIntegrity::class,
        ],
    ];

    /**
     * 路由中间件别名
     */
    protected $middlewareAliases = [
        'auth' => \App\Http\Middleware\Authenticate::class,
        'ip.whitelist' => \App\Http\Middleware\IpWhitelist::class,
        'signature' => \App\Http\Middleware\VerifyRequestSignature::class,
        'anti.replay' => \App\Http\Middleware\AntiReplay::class,
        'content.verify' => \App\Http\Middleware\VerifyContentIntegrity::class,
        'jwt.security' => \App\Http\Middleware\JwtSecurityCheck::class,
        'throttle.ip' => \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api-ip',
        'throttle.user' => \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api-user',
        'throttle.key' => \Illuminate\Routing\Middleware\ThrottleRequests::class . ':api-key',
        'throttle.sensitive' => \Illuminate\Routing\Middleware\ThrottleRequests::class . ':sensitive',
        'audit' => \App\Http\Middleware\SecurityAudit::class,
    ];
}
```

### 9.3 路由示例

```php
// routes/api.php

// 高安全等级接口（支付、转账）
Route::middleware(['api-secure', 'audit'])->prefix('v1/finance')->group(function () {
    Route::post('/transfer', [FinanceController::class, 'transfer']);
    Route::post('/withdraw', [FinanceController::class, 'withdraw']);
});

// 普通业务接口
Route::middleware(['api-secure'])->prefix('v1')->group(function () {
    Route::apiResource('/orders', OrderController::class);
    Route::apiResource('/users', UserController::class);
});

// 开放平台接口
Route::middleware(['api-open'])->prefix('v2/open')->group(function () {
    Route::get('/products', [OpenProductController::class, 'index']);
    Route::post('/orders', [OpenOrderController::class, 'store']);
});
```

---

## 十、安全审计日志与异常检测

### 10.1 审计日志中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class SecurityAudit
{
    /**
     * 需要审计的敏感操作
     */
    protected array $sensitiveActions = [
        'POST:/api/v1/auth/login',
        'POST:/api/v1/auth/logout',
        'POST:/api/v1/finance/transfer',
        'PUT:/api/v1/users/*/password',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $startTime = microtime(true);
        $response = $next($request);
        $duration = (microtime(true) - $startTime) * 1000;

        $this->logRequest($request, $response, $duration);

        return $response;
    }

    protected function logRequest(Request $request, Response $response, float $duration): void
    {
        $log = [
            'timestamp' => now()->toIso8601String(),
            'method' => $request->method(),
            'path' => $request->path(),
            'status_code' => $response->getStatusCode(),
            'ip' => $request->ip(),
            'user_id' => auth()->id(),
            'client_id' => $request->header('X-Client-Id'),
            'user_agent' => $request->userAgent(),
            'duration_ms' => round($duration, 2),
            'request_id' => $request->header('X-Request-Id', uniqid()),
        ];

        // 检测异常模式
        $anomalies = $this->detectAnomalies($request, $response);

        if (!empty($anomalies)) {
            $log['anomalies'] = $anomalies;
            $log['risk_level'] = $this->calculateRiskLevel($anomalies);

            // 高风险事件立即告警
            if ($log['risk_level'] === 'high') {
                $this->alertSecurity($log);
            }
        }

        // 异步写入日志（避免阻塞请求）
        dispatch(fn() => DB::table('security_audit_logs')->insert([
            'payload' => json_encode($log),
            'ip' => $log['ip'],
            'user_id' => $log['user_id'],
            'risk_level' => $log['risk_level'] ?? 'low',
            'created_at' => now(),
        ]));
    }

    protected function detectAnomalies(Request $request, Response $response): array
    {
        $anomalies = [];

        // 1. 认证失败频率异常
        if ($response->getStatusCode() === 401) {
            $failCount = cache()->increment(
                'auth_fail:' . $request->ip() . ':' . floor(now()->timestamp / 60)
            );
            cache()->expire('auth_fail:' . $request->ip() . ':' . floor(now()->timestamp / 60), 120);

            if ($failCount > 10) {
                $anomalies[] = 'HIGH_AUTH_FAILURE_RATE';
            }
        }

        // 2. 非工作时间的敏感操作
        $hour = now()->hour;
        if ($hour >= 1 && $hour <= 5 && str_contains($request->path(), 'finance')) {
            $anomalies[] = 'OFF_HOURS_SENSITIVE_OPERATION';
        }

        // 3. 请求频率异常
        $requestKey = 'req_rate:' . $request->ip();
        $rate = cache()->increment($requestKey);
        cache()->expire($requestKey, 60);
        if ($rate > 100) {
            $anomalies[] = 'ABNORMAL_REQUEST_RATE';
        }

        // 4. 异常 User-Agent
        $ua = $request->userAgent() ?? '';
        if (empty($ua) || preg_match('/(curl|wget|python|bot|spider)/i', $ua)) {
            $anomalies[] = 'SUSPICIOUS_USER_AGENT';
        }

        return $anomalies;
    }

    protected function calculateRiskLevel(array $anomalies): string
    {
        $highRisk = ['HIGH_AUTH_FAILURE_RATE', 'ABNORMAL_REQUEST_RATE'];
        $mediumRisk = ['OFF_HOURS_SENSITIVE_OPERATION', 'SUSPICIOUS_USER_AGENT'];

        foreach ($anomalies as $anomaly) {
            if (in_array($anomaly, $highRisk)) return 'high';
        }
        foreach ($anomalies as $anomaly) {
            if (in_array($anomaly, $mediumRisk)) return 'medium';
        }
        return 'low';
    }

    protected function alertSecurity(array $log): void
    {
        // 发送到告警通道（Slack / 钉钉 / PagerDuty）
        \Notification::route('slack', config('services.slack.security_webhook'))
            ->notify(new \App\Notifications\SecurityAlert($log));
    }
}
```

### 10.2 审计日志数据表迁移

```php
Schema::create('security_audit_logs', function (Blueprint $table) {
    $table->id();
    $table->json('payload');
    $table->string('ip', 45)->index();
    $table->unsignedBigInteger('user_id')->nullable()->index();
    $table->enum('risk_level', ['low', 'medium', 'high'])->default('low')->index();
    $table->timestamp('created_at')->useCurrent()->index();

    // 按时间分区（MySQL 8.0+）
    // 生产环境中建议按月分区，配合 pt-archiver 定期归档
});
```

---

## 十一、生产环境部署建议与 Checklist

### 11.1 HTTPS 强制

所有 API 请求必须通过 HTTPS 传输。中间人可以在 HTTP 下轻易获取 JWT、签名密钥等敏感信息。

```php
// AppServiceProvider.php
public function boot(): void
{
    if ($this->app->environment('production')) {
        \URL::forceScheme('https');
        \Illuminate\Support\Facades\URL::forceRootUrl(config('app.url'));
    }
}
```

### 11.2 请求头安全加固

```php
// 中间件：添加安全响应头
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('X-XSS-Protection', '1; mode=block');
        $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        $response->headers->set('Cache-Control', 'no-store, no-cache, must-revalidate');
        $response->headers->set('Pragma', 'no-cache');

        // API 响应不暴露服务器信息
        $response->headers->remove('X-Powered-By');
        $response->headers->remove('Server');

        return $response;
    }
}
```

### 11.3 密钥管理

- JWT 密钥和 HMAC 签名密钥使用环境变量存储，**绝不能硬编码或提交到代码仓库**
- 使用 Laravel 的 `env()` 或 `.env` 文件配合 Secrets Manager（如 AWS Secrets Manager、HashiCorp Vault）
- 定期轮换签名密钥：设置 Key Rotation 策略，新旧密钥并行期设为 Token 最大有效期

### 11.4 生产环境 Checklist

在 API 上线前，请逐项检查以下内容：

**认证与授权**

- [ ] JWT 密钥长度 ≥ 256 bit，使用 RS256 或 ES256 非对称算法（推荐）
- [ ] Access Token 有效期 ≤ 30 分钟
- [ ] Refresh Token 已实现 Rotation（每次使用后失效旧的）
- [ ] JWT 黑名单已部署 Redis，TTL 自动过期
- [ ] 敏感接口已启用二次验证（MFA / 短信验证码）

**请求签名**

- [ ] 所有外部 API 请求已启用 HMAC-SHA256 签名
- [ ] 签名包含了 Method + Path + Timestamp + Nonce + Body
- [ ] 使用 `hash_equals()` 进行签名比较（防止时序攻击）
- [ ] 时钟偏差容忍窗口 ≤ 5 分钟

**防重放**

- [ ] Nonce 存储使用 Redis SET NX（原子操作）
- [ ] Nonce TTL 大于时间窗口
- [ ] 检测到重放请求时记录告警日志

**限流**

- [ ] IP 维度限流已配置
- [ ] 用户维度限流已配置
- [ ] 敏感接口（登录/支付）有独立限流规则
- [ ] 限流响应包含 `Retry-After` 头

**IP 白名单**

- [ ] 内部 API 已启用 IP 白名单
- [ ] 白名单支持 CIDR 格式
- [ ] 规则可通过管理后台动态修改，无需重启

**日志与监控**

- [ ] 安全审计日志已记录所有认证事件
- [ ] 异常检测已覆盖高频失败登录、异常 UA、非工作时间操作
- [ ] 高风险事件已对接告警通道（Slack / 钉钉 / PagerDuty）
- [ ] 日志存储 ≥ 90 天（满足合规要求）

**基础设施**

- [ ] 全站 HTTPS 强制开启
- [ ] 安全响应头已配置（HSTS / CSP / X-Frame-Options）
- [ ] API 错误信息不泄露内部实现细节（不暴露堆栈、SQL、文件路径）
- [ ] CORS 策略限制为允许的域名，不使用 `*`
- [ ] 数据库连接、Redis 连接使用 TLS 加密

### 11.5 性能优化建议

1. **中间件顺序**：把最快拒绝的中间件放在最前面（IP 白名单 > 限流 > 签名 > JWT）
2. **Redis Pipeline**：JWT 黑名单和 Nonce 检查可以合并为一次 Redis Pipeline 调用
3. **缓存热点数据**：IP 白名单规则、API Client 密钥等使用本地缓存（`Cache::remember`）减少 Redis 查询
4. **异步日志**：审计日志通过 Laravel Queue 异步写入，不阻塞请求响应
5. **Redis Cluster**：生产环境建议使用 Redis Cluster 或 Redis Sentinel，确保 Nonce 和黑名单的高可用

---

## 总结

API 安全不是一个单点问题，而是一个**纵深防御的系统工程**。本文从工程化角度构建了一个完整的多层安全体系：

| 层级 | 机制 | 防御目标 | 性能开销 |
|------|------|---------|---------|
| L1 | IP 白名单 | 非授权网络访问 | 极低（内存匹配） |
| L2 | 速率限制 | DDoS / 暴力破解 | 低（Redis INCR） |
| L3 | 请求签名 | 请求伪造 / 篡改 | 低（CPU HMAC） |
| L4 | 防重放 | 重放攻击 | 低（Redis SET NX） |
| L5 | 内容完整性 | 请求体篡改 | 低（CPU MD5） |
| L6 | JWT 认证 + 黑名单 | 身份冒用 / Token 泄露 | 中（Redis 查询） |
| L7 | 审计日志 | 事后追溯 / 异常检测 | 低（异步队列） |

每一层都是独立的防线，任何一层被突破，其他层仍然能够提供保护。在实际项目中，请根据业务的安全等级和性能要求，**渐进式地引入这些机制**——不必一步到位，但要确保核心接口（认证、支付、数据修改）至少覆盖 L3~L6 的防护。

安全是一个持续演进的过程。定期进行渗透测试、关注 OWASP API Security 最新动态、保持依赖库更新，才能让你的 API 安全体系始终走在攻击者前面。

---

## 相关阅读

- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——Laravel B2C API 多层防御深度踩坑记录](/architecture/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录) —— 同主题的早期实践版本，侧重 B2C 场景踩坑与方案演进
- [API Gateway 插件开发实战：Kong/APISIX 自定义 Lua/Go 插件——认证、限流、日志的网关层下沉](/ops/API-Gateway-插件开发实战-Kong-APISIX自定义Lua-Go插件-认证限流日志网关层下沉) —— 将 JWT 校验、限流、签名验证等安全逻辑下沉到网关层的实现方案
- [OIDC (OpenID Connect) 深度实战：从 OAuth 2.0 到 OIDC 的身份层——Laravel Socialite + 自建 OIDC Provider 的完整流程](/php/oidc-openid-connect-laravel-deep-dive) —— 认证体系的另一维度：OAuth 2.0 + OIDC 协议标准与 Laravel 实现
