---
title: JWT Token 安全深度实战：算法混淆攻击、密钥轮换、Token 指纹绑定——Laravel Passport/Sanctum 的安全加固指南
keywords: [JWT Token, Token, Laravel Passport, Sanctum, 安全深度实战, 算法混淆攻击, 密钥轮换, 指纹绑定, 的安全加固指南, PHP]
date: 2026-06-09 22:30:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - JWT
  - Security
  - Passport
  - Sanctum
  - PHP
description: 深入剖析 JWT 安全风险与实战加固方案，涵盖算法混淆攻击防御、密钥轮换策略、Token 指纹绑定，以及 Laravel Passport/Sanctum 的生产级安全配置。
---


## 概述

JWT（JSON Web Token）是现代 Web 应用中最常见的身份认证方案。Laravel 生态提供了 Passport（OAuth2 服务器）和 Sanctum（轻量级 SPA/移动认证）两套成熟的 JWT 实现。但"用对了"和"用安全了"之间，隔着一道深渊。

本文从真实攻击场景出发，覆盖三大核心安全问题：

1. **算法混淆攻击（Algorithm Confusion）**：攻击者篡改 JWT 头部的 `alg` 字段，绕过签名验证
2. **密钥轮换（Key Rotation）**：在不停服的前提下平滑迁移签名密钥
3. **Token 指纹绑定（Token Binding）**：将 Token 与客户端特征绑定，防止 Token 窃取后滥用

所有代码基于 Laravel 11 + PHP 8.2，可直接在生产环境参考使用。

---

## 核心概念

### JWT 结构回顾

```
eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vZXhhbXBsZS5jb20iLCJzdWIiOiIxIiwiaWF0IjoxNjg2NDI1MjAwLCJleHAiOjE2ODY0Mjg4MDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

三部分：Header（算法声明）+ Payload（载荷）+ Signature（签名）。

### Laravel 认证架构

| 组件 | 适用场景 | Token 类型 |
|------|---------|-----------|
| Sanctum | SPA / 移动端 / 简单 API | Personal Access Token / Cookie |
| Passport | OAuth2 服务器 / 第三方授权 | Access Token + Refresh Token |

两者都依赖底层 JWT 库，但 Sanctum 在 API 模式下默认使用 `laravel/sanctum` 的简单 Token（数据库存储），而 Passport 强制使用完整 JWT。

---

## 攻击一：算法混淆（Algorithm Confusion）

### 攻击原理

JWT 头部的 `alg` 字段由客户端可控。攻击者可以：

```
// 正常请求
Header: {"alg": "RS256", "typ": "JWT"}

// 攻击：篡改为 HMAC
Header: {"alg": "HS256", "typ": "JWT"}
```

当服务端使用 RSA 公钥作为 HMAC 密钥验签时，攻击者可以用公钥本身伪造合法签名——因为公钥是公开的。

### 攻击复现

```php
<?php

// 模拟攻击过程
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

// 攻击者获取到服务端的 RSA 公钥（通常在 .well-known/jwks.json 公开）
$publicKey = file_get_contents('/path/to/public.pem');

// 构造恶意 JWT：alg 改为 HS256，用公钥签名
$payload = [
    'iss' => 'https://your-app.com',
    'sub' => '1',  // 目标用户 ID
    'iat' => now()->timestamp,
    'exp' => now()->addHours(2)->timestamp,
];

$maliciousJwt = JWT::encode($payload, $publicKey, 'HS256');

// 如果服务端未校验 alg，这个 Token 会被接受
// 因为服务端用同一个公钥做 HMAC 验签
```

### 防御方案

#### 方案一：白名单校验 alg

在 Laravel 中，自定义 JWT 解码逻辑，强制校验算法：

```php
<?php

namespace App\Services;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use InvalidArgumentException;
use RuntimeException;

class JwtSecurityService
{
    // 允许的算法白名单
    private const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512'];

    // HMAC 算法黑名单——绝不允许出现在 RSA 场景
    private const FORBIDDEN_ALGORITHMS = ['HS256', 'HS384', 'HS512'];

    /**
     * 安全解码 JWT，防止算法混淆
     */
    public function safeDecode(string $token, string $publicKeyPem): array
    {
        // 第一步：手动解析 header，检查 alg
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidArgumentException('Invalid JWT format');
        }

        $header = json_decode(base64_decode(strtr($parts[0], '-_', '+/')), true);
        if (!$header || !isset($header['alg'])) {
            throw new InvalidArgumentException('Invalid JWT header');
        }

        $algorithm = $header['alg'];

        // 第二步：检查算法是否在白名单
        if (!in_array($algorithm, self::ALLOWED_ALGORITHMS, true)) {
            throw new RuntimeException(
                "Rejected JWT with algorithm: {$algorithm}. " .
                "Only RS256/RS384/RS512 are allowed."
            );
        }

        // 第三步：检查是否使用了对称算法（防御混淆攻击）
        if (in_array($algorithm, self::FORBIDDEN_ALGORITHMS, true)) {
            // 记录安全事件
            \Log::warning('JWT algorithm confusion attempt detected', [
                'algorithm' => $algorithm,
                'ip' => request()->ip(),
                'user_agent' => request()->userAgent(),
            ]);

            throw new RuntimeException('Symmetric algorithms are not permitted');
        }

        // 第四步：使用指定算法解码
        $decoded = JWT::decode($token, new Key($publicKeyPem, $algorithm));

        return (array) $decoded;
    }
}
```

#### 方案二：Passport 配置加固

```php
<?php
// config/auth.php

'guards' => [
    'api' => [
        'driver' => 'passport',
        'provider' => 'users',
    ],
],

// config/passport.php（Laravel Passport 12+）
'jwt' => [
    // 强制使用 RSA 算法
    'algorithm' => 'RS256',

    // 禁止 HMAC 回退
    'allowed_algorithms' => ['RS256'],
],
```

#### 方案三：中间件层统一拦截

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnforceJwtAlgorithm
{
    public function handle(Request $request, Closure $next): Response
    {
        $authHeader = $request->header('Authorization', '');

        if (str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
            $parts = explode('.', $token);

            if (count($parts) === 3) {
                $header = json_decode(
                    base64_decode(strtr($parts[0], '-_', '+/')),
                    true
                );

                $alg = $header['alg'] ?? 'UNKNOWN';

                // 记录所有请求的算法（审计用）
                \Log::info('JWT auth attempt', [
                    'algorithm' => $alg,
                    'path' => $request->path(),
                    'ip' => $request->ip(),
                ]);

                if (!in_array($alg, ['RS256', 'RS384', 'RS512'], true)) {
                    return response()->json([
                        'error' => 'invalid_token',
                        'message' => 'Token algorithm not allowed',
                    ], 401);
                }
            }
        }

        return $next($request);
    }
}
```

注册中间件：

```php
// bootstrap/app.php 或 Kernel
$middleware->alias([
    'jwt.enforce' => \App\Http\Middleware\EnforceJwtAlgorithm::class,
]);

$middleware->api([
    'jwt.enforce',
]);
```

---

## 攻击二：密钥泄露与轮换

### 问题场景

在生产环境中，签名密钥可能因以下原因泄露：

- 开发者将私钥提交到 Git 仓库
- 服务器被入侵，`.env` 文件泄露
- 第三方服务被攻破，共享密钥暴露

泄露后，攻击者可以伪造任意用户的 Token。

### 密钥轮换策略

核心思路：**双密钥并行期**——新密钥签发 + 旧密钥验签，过渡期结束后废弃旧密钥。

```php
<?php

namespace App\Services;

use Carbon\Carbon;

class KeyRotationService
{
    private const KEY_STORE_PATH = '/secure/storage/jwt-keys/';

    /**
     * 获取当前签名密钥（用于签发新 Token）
     */
    public function getSigningKey(): array
    {
        $keys = $this->loadAllKeys();
        $activeKeys = array_filter($keys, fn($key) => $key['status'] === 'active');

        if (empty($activeKeys)) {
            throw new \RuntimeException('No active signing key found');
        }

        // 取最新的 active 密钥
        $latest = collect($activeKeys)->sortByDesc('created_at')->first();

        return $latest;
    }

    /**
     * 获取所有验签密钥（用于验证 Token）
     * 在轮换期间，新旧密钥都可以验签
     */
    public function getVerificationKeys(): array
    {
        $keys = $this->loadAllKeys();

        return array_filter($keys, function ($key) {
            return in_array($key['status'], ['active', 'rotating']);
        });
    }

    /**
     * 执行密钥轮换
     */
    public function rotate(): array
    {
        $keys = $this->loadAllKeys();

        // 1. 将当前 active 密钥标记为 rotating（仍可验签，不可签发）
        foreach ($keys as &$key) {
            if ($key['status'] === 'active') {
                $key['status'] = 'rotating';
                $key['rotated_at'] = now()->toIso8601String();
            }
        }
        unset($key);

        // 2. 生成新密钥对
        $newKeyPair = $this->generateKeyPair();
        $keys[] = [
            'id' => $newKeyPair['id'],
            'public_key' => $newKeyPair['public_key'],
            'status' => 'active',
            'created_at' => now()->toIso8601String(),
            'rotated_at' => null,
            'expired_at' => null,
        ];

        // 3. 检查是否有超过 grace period 的旧密钥，标记为 expired
        $gracePeriod = now()->subDays(7); // 7 天过渡期
        foreach ($keys as &$key) {
            if ($key['status'] === 'rotating' && isset($key['rotated_at'])) {
                $rotatedAt = Carbon::parse($key['rotated_at']);
                if ($rotatedAt->lessThan($gracePeriod)) {
                    $key['status'] = 'expired';
                    $key['expired_at'] = now()->toIso8601String();
                }
            }
        }
        unset($key);

        $this->saveKeys($keys);

        // 4. 清除 Passport 缓存
        if (class_exists(\Laravel\Passport\Passport::class)) {
            \Laravel\Passport\Passport::pruneRevokedTokens();
        }

        \Log::info('JWT key rotation completed', [
            'total_keys' => count($keys),
            'new_key_id' => $newKeyPair['id'],
        ]);

        return $newKeyPair;
    }

    /**
     * 生成 RSA 密钥对
     */
    private function generateKeyPair(): array
    {
        $config = [
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];

        $res = openssl_pkey_new($config);
        if ($res === false) {
            throw new \RuntimeException('Failed to generate key pair');
        }

        openssl_pkey_export($res, $privateKey);
        $details = openssl_pkey_get_details($res);
        $publicKey = $details['key'];

        $keyId = bin2hex(random_bytes(16));

        // 安全存储私钥
        $privatePath = self::KEY_STORE_PATH . $keyId . '.pem';
        file_put_contents($privatePath, $privateKey);
        chmod($privatePath, 0600);

        return [
            'id' => $keyId,
            'public_key' => $publicKey,
            'private_key_path' => $privatePath,
        ];
    }

    private function loadAllKeys(): array
    {
        $indexPath = self::KEY_STORE_PATH . 'keys.json';
        if (!file_exists($indexPath)) {
            return [];
        }

        return json_decode(file_get_contents($indexPath), true) ?? [];
    }

    private function saveKeys(array $keys): void
    {
        $indexPath = self::KEY_STORE_PATH . 'keys.json';
        file_put_contents($indexPath, json_encode($keys, JSON_PRETTY_PRINT));
    }
}
```

### 自动轮换 Cron

```php
<?php

namespace App\Console\Commands;

use App\Services\KeyRotationService;
use Illuminate\Console\Command;

class RotateJwtKeys extends Command
{
    protected $signature = 'jwt:rotate-keys';
    protected $description = 'Rotate JWT signing keys';

    public function handle(KeyRotationService $service): int
    {
        try {
            $newKey = $service->rotate();
            $this->info("Key rotation completed. New key ID: {$newKey['id']}");
            return Command::SUCCESS;
        } catch (\Throwable $e) {
            $this->error("Key rotation failed: {$e->getMessage()}");
            return Command::FAILURE;
        }
    }
}
```

```cron
# 每周日凌晨 3 点自动轮换
0 3 * * 0 cd /path/to/project && php artisan jwt:rotate-keys
```

### Sanctum 特殊处理

Sanctum 的 Token 存储在数据库中，密钥轮换更简单——直接让新 Token 使用新密钥，旧 Token 在数据库中标记为 revoked：

```php
<?php

// Sanctum 密钥轮换：批量撤销旧 Token
use Laravel\Sanctum\PersonalAccessToken;

$oldTokens = PersonalAccessToken::where('created_at', '<', now()->subDays(7))
    ->where('revoked', false)
    ->get();

foreach ($oldTokens as $token) {
    $token->update(['revoked' => true]);
}

\Log::info('Sanctum old tokens revoked', ['count' => $oldTokens->count()]);
```

---

## 攻击三：Token 窃取与指纹绑定

### 问题场景

Token 被窃取的途径：

- XSS 攻击窃取 `localStorage` 中的 Token
- 中间人攻击（HTTPS 降级）
- 日志泄露（Token 被记录到 access.log）
- 社会工程学（钓鱼）

一旦 Token 被窃取，攻击者可以在任何设备上使用它，直到过期。

### Token 指纹绑定原理

将 Token 与客户端的硬件/网络特征绑定：

```
签名内容 = JWT Payload + 指纹哈希
指纹 = SHA256(User-Agent + IP段 + Accept-Language + Accept-Encoding)
```

验证时重新计算指纹，不匹配则拒绝。

### 实现方案

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;

class TokenFingerprintService
{
    /**
     * 生成客户端指纹
     */
    public function generateFingerprint($request): string
    {
        $components = [
            // User-Agent（截取关键部分，避免浏览器小版本更新导致失效）
            $this->normalizeUserAgent($request->userAgent()),

            // IP 段（/24 子网，允许同一局域网内切换）
            $this->getIpSegment($request->ip()),

            // Accept-Language 首选语言
            $this->extractPrimaryLanguage($request->header('Accept-Language', '')),

            // Accept-Encoding
            $request->header('Accept-Encoding', ''),
        ];

        return Hash::make(implode('|', $components));
    }

    /**
     * 验证指纹匹配
     */
    public function verifyFingerprint($request, string $storedFingerprint): bool
    {
        $current = $this->generateFingerprint($request);

        // 允许一定时间内的指纹变化（网络环境切换）
        // 使用 timing-safe 比较防止时序攻击
        return hash_equals($storedFingerprint, $current);
    }

    /**
     * 绑定指纹到 Token
     */
    public function bindToToken(string $token, string $fingerprint): string
    {
        // 将指纹存储在缓存中，与 Token 关联
        $tokenHash = hash('sha256', $token);
        Cache::put(
            "jwt_fp:{$tokenHash}",
            $fingerprint,
            now()->addHours(2) // 与 Token 过期时间一致
        );

        return $tokenHash;
    }

    /**
     * 检查指纹是否匹配
     */
    public function checkBound(string $token, $request): bool
    {
        $tokenHash = hash('sha256', $token);
        $storedFingerprint = Cache::get("jwt_fp:{$tokenHash}");

        if (!$storedFingerprint) {
            // 首次使用，绑定指纹
            $this->bindToToken($token, $this->generateFingerprint($request));
            return true;
        }

        return $this->verifyFingerprint($request, $storedFingerprint);
    }

    private function normalizeUserAgent(string $ua): string
    {
        // 提取浏览器和操作系统，忽略小版本号
        if (preg_match('/(Chrome|Firefox|Safari|Edge)\/(\d+)/i', $ua, $browser)) {
            return "{$browser[1]}/{$browser[2]}";
        }
        return substr($ua, 0, 50);
    }

    private function getIpSegment(string $ip): string
    {
        $parts = explode('.', $ip);
        if (count($parts) === 4) {
            return "{$parts[0]}.{$parts[1]}.{$parts[2]}.0/24";
        }
        return $ip;
    }

    private function extractPrimaryLanguage(string $acceptLanguage): string
    {
        $parts = explode(',', $acceptLanguage);
        if (!empty($parts[0])) {
            $lang = explode(';', trim($parts[0]))[0];
            return trim($lang);
        }
        return 'unknown';
    }
}
```

### 中间件集成

```php
<?php

namespace App\Http\Middleware;

use App\Services\TokenFingerprintService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class JwtFingerprintGuard
{
    public function __construct(
        private TokenFingerprintService $fingerprintService
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $this->extractToken($request);

        if ($token) {
            if (!$this->fingerprintService->checkBound($token, $request)) {
                \Log::warning('JWT fingerprint mismatch', [
                    'ip' => $request->ip(),
                    'user_agent' => $request->userAgent(),
                    'path' => $request->path(),
                ]);

                return response()->json([
                    'error' => 'token_bound_to_different_device',
                    'message' => 'This token is bound to a different client',
                ], 401);
            }
        }

        return $next($request);
    }

    private function extractToken(Request $request): ?string
    {
        $bearer = $request->header('Authorization', '');
        if (str_starts_with($bearer, 'Bearer ')) {
            return substr($bearer, 7);
        }
        return $request->cookie('token');
    }
}
```

---

## 踩坑记录

### 踩坑 1：Passport 自定义密钥路径

Passport 默认在 `storage/oauth-private.key` 存储密钥。如果自定义路径，必须同时更新 `config/passport.php` 和确保目录权限：

```php
// 错误做法：直接复制密钥文件
// cp new-key.pem storage/oauth-private.key

// 正确做法：通过 Passport 命令生成
php artisan passport:keys --force
php artisan passport:client --personal --name="Mobile App"
```

### 踩坑 2：Sanctum 的 Token 过期时间

Sanctum 默认不过期（`never_expire = true`）。生产环境必须设置过期：

```php
// config/sanctum.php
'expiration' => 120, // 120 分钟
```

### 踩坑 3：指纹绑定在负载均衡下的陷阱

多台服务器间必须共享指纹缓存。使用 Redis：

```php
// config/cache.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'prefix' => env('CACHE_PREFIX', 'laravel'),
],
```

### 踩坑 4：JWT Payload 中不要放敏感信息

JWT Payload 是 Base64 编码，不是加密。任何人都可以解码：

```php
// ❌ 错误：在 Payload 中放密码哈希
$payload = [
    'sub' => 1,
    'password_hash' => $hashedPassword,
];

// ✅ 正确：只放必要信息
$payload = [
    'sub' => 1,
    'iat' => now()->timestamp,
    'exp' => now()->addHours(2)->timestamp,
    'jti' => Str::uuid(),
];
```

### 踩坑 5：Token 撤销的 N+1 问题

批量撤销 Token 时，不要逐条执行：

```php
// ❌ 错误：N+1 查询
foreach ($user->tokens as $token) {
    $token->revoke();
}

// ✅ 正确：批量操作
$user->tokens()->update(['revoked' => true]);
// 或
Passport::token()->where('user_id', $userId)->update(['revoked' => true]);
```

---

## 安全检查清单

- [ ] JWT `alg` 字段白名单校验（禁止对称算法出现在 RSA 场景）
- [ ] 签名密钥存储在安全位置（非 Git 仓库、非 `.env` 明文）
- [ ] 密钥轮换策略已配置（双密钥并行 + 过渡期）
- [ ] Token 指纹绑定已启用（防止 Token 窃取后滥用）
- [ ] Token 过期时间已设置（Passport/Sanctum 均需配置）
- [ ] 日志中不记录 Token 明文
- [ ] HTTPS 强制启用（HSTS）
- [ ] CORS 配置限制为可信域名
- [ ] 定期审计 JWT 相关安全事件日志

---

## 总结

JWT 安全不是"用对了库就行"。从算法混淆到密钥泄露，从 Token 窃取到指纹绑定，每一步都需要主动防御。

核心原则：

1. **永远不信任客户端输入的 `alg`**——白名单是底线
2. **密钥轮换是刚需，不是可选**——出事再换就晚了
3. **指纹绑定防的是 Token 泄露后的横向移动**——纵深防御
4. **最小信息原则**——Payload 只放必要的

Laravel Passport 和 Sanctum 给了我们好的基础，但安全加固需要开发者自己补上最后一公里。希望本文的实战方案能帮你在生产环境中构建更健壮的 JWT 安全体系。
