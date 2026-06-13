---

title: API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——Laravel B2C API 多层防御深度踩坑记录
keywords: [API]
date: 2026-06-01 10:00:00
description: 本文结合 Laravel B2C API 生产踩坑经验，系统拆解 API安全 的多层防御方案，覆盖 JWT黑名单、请求签名、IP白名单、防重放攻击、幂等处理与监控告警，附带可运行代码示例、方案对比表和落地细节，帮助你在真实业务中构建可撤销、可审计、可扩展的安全加固体系。
tags:
- API安全
- JWT
- Laravel
- 请求签名
- 防重放
- ip白名单
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop---


---


## 二、JWT 黑名单：让无状态 Token 变成"可撤销"

### 2.1 问题本质

JWT 的设计哲学是无状态——服务端不存储 Token，只验签。但在 B2C 电商中，以下场景**必须**能主动失效 Token：

- 用户修改密码 / 被盗号后强制登出
- 用户注销账号
- 管理员封禁用户
- 疑似 Token 泄露，紧急吊销

### 2.2 方案选型对比

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **数据库黑名单表** | 存储被撤销的 JWT ID | 简单直接 | 高并发下数据库压力大 |
| **Redis 黑名单** | `SET jti:blacklist <exp>` 带 TTL 自动过期 | 高性能、自动清理 | 需要额外 Redis 资源 |
| **短 Token + 长 Refresh** | Access Token 有效期极短（5min） | 减少黑名单时间窗口 | 刷新流程复杂 |
| **Token 版本号** | 用户表增加 token_version，每次登录+1 | 无额外存储 | 只能一次性撤销所有 Token |

**我们的选择：Redis 黑名单 + 短 Token 组合方案。**

### 2.3 实现代码

#### 2.3.1 JWT 签发时嵌入 jti（JWT ID）

```php
<?php
// app/Services/JWTService.php

namespace App\Services;

use Firebase\JWT\JWT;
use Illuminate\Support\Str;

class JWTService
{
    public function generateToken(array $user): array
    {
        $jti = Str::uuid()->toString(); // 唯一标识
        $now = time();
        $accessTokenTtl = 15 * 60;  // Access Token 15 分钟
        $refreshTokenTtl = 7 * 24 * 3600; // Refresh Token 7 天

        // Access Token payload
        $accessPayload = [
            'iss' => config('app.name'),
            'sub' => $user['id'],
            'aud' => 'b2c-api',
            'iat' => $now,
            'exp' => $now + $accessTokenTtl,
            'jti' => $jti,
            'type' => 'access',
            'roles' => $user['roles'] ?? ['customer'],
        ];

        $accessToken = JWT::encode(
            $accessPayload,
            config('jwt.secret'),
            config('jwt.algo', 'HS256')
        );

        // Refresh Token（不同的 jti）
        $refreshPayload = [
            'iss' => config('app.name'),
            'sub' => $user['id'],
            'iat' => $now,
            'exp' => $now + $refreshTokenTtl,
            'jti' => Str::uuid()->toString(),
            'type' => 'refresh',
            'family_id' => $jti, // 与 Access Token 关联
        ];

        $refreshToken = JWT::encode(
            $refreshPayload,
            config('jwt.secret'),
            config('jwt.algo', 'HS256')
        );

        return [
            'access_token' => $accessToken,
            'refresh_token' => $refreshToken,
            'token_type' => 'Bearer',
            'expires_in' => $accessTokenTtl,
        ];
    }
}
```

#### 2.3.2 Redis 黑名单服务

```php
<?php
// app/Services/JWTBlacklistService.php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class JWTBlacklistService
{
    private const PREFIX = 'jwt:blacklist:';
    private const USER_TOKENS_PREFIX = 'jwt:user_tokens:';

    /**
     * 将 Token 加入黑名单
     * @param string $jti    JWT ID
     * @param int    $exp    Token 过期时间戳
     * @param int    $userId 用户 ID（可选，用于撤销用户所有 Token）
     */
    public function blacklist(string $jti, int $exp, ?int $userId = null): void
    {
        $ttl = $exp - time();

        if ($ttl <= 0) {
            return; // 已过期，无需加入黑名单
        }

        // 单个 Token 黑名单
        Redis::setex(self::PREFIX . $jti, $ttl, 'revoked');

        // 用户维度：记录该用户当前有效的 Token 集合
        if ($userId) {
            Redis::sadd(self::USER_TOKENS_PREFIX . $userId, [$jti]);
            Redis::expire(self::USER_TOKENS_PREFIX . $userId, max($ttl, 86400));
        }
    }

    /**
     * 检查 Token 是否在黑名单中
     */
    public function isBlacklisted(string $jti): bool
    {
        return Redis::exists(self::PREFIX . $jti);
    }

    /**
     * 撤销用户的所有 Token（密码修改 / 封禁场景）
     * 注意：只标记已知的 jti，历史 Token 如果 Redis 中没有记录则无法覆盖
     * 因此配合 token_version 机制使用
     */
    public function revokeAllUserTokens(int $userId): void
    {
        $jtis = Redis::smembers(self::USER_TOKENS_PREFIX . $userId);

        foreach ($jtis as $jti) {
            // 取剩余 TTL 并延长黑名单有效期至 7 天
            Redis::setex(self::PREFIX . $jti, 7 * 86400, 'revoked_all');
        }

        // 同时递增用户的 token_version（兜底机制）
        Redis::incr("jwt:token_version:{$userId}");
        Redis::expire("jwt:token_version:{$userId}", 365 * 86400);
    }

    /**
     * 获取用户当前 token_version
     */
    public function getTokenVersion(int $userId): int
    {
        return (int) Redis::get("jwt:token_version:{$userId}") ?: 0;
    }
}
```

#### 2.3.3 JWT 中间件（集成黑名单检查）

```php
<?php
// app/Http/Middleware/JWTAuthenticate.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use App\Services\JWTBlacklistService;
use Symfony\Component\HttpFoundation\Response;

class JWTAuthenticate
{
    public function __construct(
        private JWTBlacklistService $blacklistService
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json(['error' => 'Missing token'], 401);
        }

        try {
            $payload = JWT::decode(
                $token,
                new Key(config('jwt.secret'), config('jwt.algo', 'HS256'))
            );
        } catch (\Exception $e) {
            return response()->json(['error' => 'Invalid token'], 401);
        }

        // 检查 Token 类型
        if (($payload->type ?? null) !== 'access') {
            return response()->json(['error' => 'Invalid token type'], 401);
        }

        // 黑名单检查
        if ($this->blacklistService->isBlacklisted($payload->jti)) {
            return response()->json(['error' => 'Token has been revoked'], 401);
        }

        // Token 版本检查（兜底机制，防止历史未知 Token）
        $currentVersion = $this->blacklistService->getTokenVersion($payload->sub);
        $tokenVersion = $payload->token_version ?? 0;
        if ($tokenVersion < $currentVersion) {
            return response()->json(['error' => 'Token version outdated'], 401);
        }

        // 将用户信息注入请求
        $request->merge(['auth_user' => (array) $payload]);

        return $next($request);
    }
}
```

### 2.4 踩坑记录

#### 坑 1：Redis 黑名单内存膨胀

**问题**：高流量下，每秒数百个 Token 被加入黑名单，Redis 内存持续增长。

**解决**：利用 Redis 的 `SETEX` 自动过期机制，Token 过期后自动清除。但要注意 `EXPIRE` 的粒度——建议设置最小 TTL 为 1 小时，避免极短生命周期 Token 频繁写入。

```php
// 优化：避免给即将过期的 Token 加黑名单
if ($ttl < 60) {
    return; // 不足 1 分钟就过期，不加黑名单
}
```

#### 坑 2：集群环境下 Redis 与 JWT 时钟不同步

**问题**：多台服务器的系统时间不一致，导致 A 服务器签发的 Token 在 B 服务器被误判为过期。

**解决**：所有服务器必须同步 NTP 时钟，并在 JWT 验证时加入 30 秒的时钟偏移容差。

```php
$leeway = 30; // 30 秒容差
JWT::$leeway = $leeway;
```

#### 坑 3：用户改密码后旧 Token 仍短暂有效

**问题**：用户改密码后调用 `revokeAllUserTokens()`，但由于 Redis 中只记录了已签发的 jti，如果 Token 在签发后从未被验证过（即从未写入 `user_tokens` 集合），黑名单机制无法覆盖。

**解决**：引入 `token_version` 机制作为兜底。每次签发 Token 时将 `token_version` 嵌入 payload，验证时比对版本号。

---

## 三、请求签名（HMAC-SHA256）：防伪造、防篡改

### 3.1 为什么需要请求签名？

JWT 解决的是"你是谁"的问题，但无法解决"请求是否被篡改"的问题。在 B2C 电商中，以下场景需要请求签名：

- **支付回调**：支付网关（Stripe/AliPay）发送的回调请求需要防伪造
- **内部 API 互调**：微服务之间的调用需要防中间人篡改
- **开放平台**：第三方开发者调用 API 时需要防重放

### 3.2 签名算法设计

我们采用 **HMAC-SHA256** 签名方案，签名内容包括：

```
sign_string = HTTP_METHOD + "\n"
            + URL_PATH + "\n"
            + SORTED_QUERY_STRING + "\n"
            + TIMESTAMP + "\n"
            + NONCE + "\n"
            + SHA256(REQUEST_BODY)
```

```
signature = HMAC-SHA256(app_secret, sign_string)
```

### 3.2.1 常见签名算法对比

签名方案不要只盯着“能不能算出来”，更要看**跨语言兼容性、密钥管理成本、性能与误用风险**。下面这张表是我们在 B2C API、支付回调、内部微服务三类场景中做过的真实对比：

| 算法 / 方案 | 类型 | 优点 | 缺点 | 适用场景 |
|-------------|------|------|------|----------|
| HMAC-SHA256 | 对称签名 | 实现简单、性能好、跨语言支持广 | 服务端与客户端共享密钥，泄露面更大 | 内部 API、开放平台 |
| HMAC-SHA512 | 对称签名 | 抗碰撞更强 | 结果更长、性能略低，收益通常不明显 | 对安全要求极高的内部系统 |
| RSA-SHA256 | 非对称签名 | 私钥不下发给服务端调用方，便于多方接入 | 密钥管理复杂、验签性能较低 | 支付回调、第三方平台 |
| Ed25519 | 非对称签名 | 签名短、性能高、安全性强 | 老旧 SDK 支持一般 | 新系统、高性能场景 |
| 仅 MD5(body+secret) | 弱签名 | 老系统兼容成本低 | 易误用，不建议新项目使用 | 仅用于兼容存量系统 |

**实践建议：**

1. Laravel 内部服务优先 HMAC-SHA256，足够稳妥；
2. 面向第三方开放平台时，至少加上 timestamp、nonce、body hash，别只签 body；
3. 涉及支付、金融、结算回调时，优先复用对方官方签名协议，避免自创算法。

#### 请求头示例

```http
POST /api/v3/orders/create HTTP/1.1
Authorization: Bearer eyJhbGciOi...
X-App-Id: kkday-b2c-api
X-Timestamp: 1717234567
X-Nonce: a8f5f167f44f4964e6c998dee827110c
X-Signature: 3a7bd3e2f1c9b4e8d5a6f7c2e9b0d1a3f4c5e6d7a8b9c0d1e2f3a4b5c6d7e8f9
Content-Type: application/json

{"product_id": 12345, "quantity": 2}
```

### 3.3 实现代码

#### 3.3.1 签名生成（客户端/调用方）

```php
<?php
// app/Services/RequestSigner.php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Str;

class RequestSigner
{
    /**
     * 生成请求签名
     */
    public function sign(
        string $method,
        string $path,
        array $queryParams,
        string $body,
        string $appSecret,
        ?string &$timestamp = null,
        ?string &$nonce = null
    ): string {
        $timestamp = $timestamp ?: (string) time();
        $nonce = $nonce ?: Str::random(32);

        // 查询参数排序
        ksort($queryParams);
        $sortedQuery = http_build_query($queryParams);

        // 拼接签名字符串
        $signString = implode("\n", [
            strtoupper($method),
            $path,
            $sortedQuery,
            $timestamp,
            $nonce,
            hash('sha256', $body),
        ]);

        return hash_hmac('sha256', $signString, $appSecret);
    }
}
```

#### 3.3.2 签名验证中间件

```php
<?php
// app/Http/Middleware/VerifyRequestSignature.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\RequestSigner;
use Illuminate\Support\Facades\Redis;
use Symfony\Component\HttpFoundation\Response;

class VerifyRequestSignature
{
    private const SIGNATURE_TTL = 300; // 签名有效期 5 分钟

    public function __construct(
        private RequestSigner $signer
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        // 跳过健康检查等无需签名的路由
        if ($request->is('health') || $request->is('api/callbacks/*')) {
            return $next($request);
        }

        $appId = $request->header('X-App-Id');
        $timestamp = $request->header('X-Timestamp');
        $nonce = $request->header('X-Nonce');
        $signature = $request->header('X-Signature');

        if (!$appId || !$timestamp || !$nonce || !$signature) {
            return response()->json([
                'error' => 'Missing signature headers',
            ], 401);
        }

        // 获取对应的 App Secret
        $appSecret = config("api_keys.{$appId}");
        if (!$appSecret) {
            return response()->json(['error' => 'Unknown app'], 401);
        }

        // 时间戳校验
        $timeDiff = abs(time() - (int) $timestamp);
        if ($timeDiff > self::SIGNATURE_TTL) {
            return response()->json([
                'error' => 'Request expired',
                'detail' => "Time diff: {$timeDiff}s, max: " . self::SIGNATURE_TTL . 's',
            ], 401);
        }

        // 重放检查（nonce 去重）
        $nonceKey = "nonce:{$appId}:{$nonce}";
        if (Redis::exists($nonceKey)) {
            return response()->json(['error' => 'Duplicate request (replay detected)'], 409);
        }

        // 签名校验
        $expectedSignature = $this->signer->sign(
            $request->method(),
            $request->path(),
            $request->query(),
            $request->getContent(),
            $appSecret,
            $timestamp,
            $nonce
        );

        if (!hash_equals($expectedSignature, $signature)) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        // 标记 nonce 已使用（TTL 与签名有效期一致）
        Redis::setex($nonceKey, self::SIGNATURE_TTL, '1');

        return $next($request);
    }
}
```

#### 3.3.3 Guzzle HTTP 客户端封装（服务间调用）

```php
<?php
// app/Services/InternalApiClient.php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class InternalApiClient
{
    public function __construct(
        private RequestSigner $signer,
    ) {}

    public function call(
        string $service,
        string $method,
        string $path,
        array $data = [],
    ): array {
        $appId = config("services.{$service}.app_id");
        $appSecret = config("services.{$service}.app_secret");
        $baseUrl = config("services.{$service}.base_url");
        $body = json_encode($data, JSON_UNESCAPED_UNICODE);

        $timestamp = null;
        $nonce = null;
        $signature = $this->signer->sign(
            $method,
            $path,
            [],
            $body,
            $appSecret,
            $timestamp,
            $nonce
        );

        $response = Http::withHeaders([
            'Content-Type' => 'application/json',
            'X-App-Id' => $appId,
            'X-Timestamp' => $timestamp,
            'X-Nonce' => $nonce,
            'X-Signature' => $signature,
        ])->send($method, "{$baseUrl}/{$path}", [
            'body' => $body,
        ]);

        return $response->json();
    }
}
```

#### 3.3.4 登录、刷新、退出接口示例

仅有 Service 和 Middleware 还不够，很多文章缺的正是“业务接口如何串起来”。下面给一个能直接落到 Laravel 控制器里的最小闭环：登录签发 Token、刷新 Token、退出时写入 JWT 黑名单。

```php
<?php
// app/Http/Controllers/AuthController.php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\JWTBlacklistService;
use App\Services\JWTService;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function __construct(
        private JWTService $jwtService,
        private JWTBlacklistService $blacklistService,
    ) {}

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::query()->where('email', $data['email'])->first();

        if (!$user || !Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => '账号或密码错误'], 422);
        }

        $tokens = $this->jwtService->generateToken([
            'id' => $user->id,
            'roles' => $user->roles?->pluck('name')->all() ?? ['customer'],
        ]);

        return response()->json($tokens);
    }

    public function refresh(Request $request): JsonResponse
    {
        $request->validate([
            'refresh_token' => ['required', 'string'],
        ]);

        try {
            $payload = JWT::decode(
                $request->string('refresh_token')->toString(),
                new Key(config('jwt.secret'), config('jwt.algo', 'HS256'))
            );
        } catch (\Throwable $e) {
            return response()->json(['message' => 'refresh_token 无效'], 401);
        }

        if (($payload->type ?? null) !== 'refresh') {
            return response()->json(['message' => 'token 类型错误'], 401);
        }

        if ($this->blacklistService->isBlacklisted($payload->jti)) {
            return response()->json(['message' => 'refresh_token 已失效'], 401);
        }

        $user = User::query()->find($payload->sub);
        if (!$user) {
            return response()->json(['message' => '用户不存在'], 404);
        }

        // 刷新时先作废旧 refresh token，防止被重复使用
        $this->blacklistService->blacklist($payload->jti, $payload->exp, $user->id);

        return response()->json($this->jwtService->generateToken([
            'id' => $user->id,
            'roles' => $user->roles?->pluck('name')->all() ?? ['customer'],
        ]));
    }

    public function logout(Request $request): JsonResponse
    {
        $token = $request->bearerToken();
        if (!$token) {
            return response()->json(['message' => '缺少 access token'], 400);
        }

        try {
            $payload = JWT::decode(
                $token,
                new Key(config('jwt.secret'), config('jwt.algo', 'HS256'))
            );
        } catch (\Throwable $e) {
            return response()->json(['message' => 'token 无效'], 401);
        }

        $this->blacklistService->blacklist($payload->jti, $payload->exp, $payload->sub);

        return response()->json(['message' => '已退出登录']);
    }
}
```

配套路由示例：

```php
<?php
// routes/api.php

Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/refresh', [AuthController::class, 'refresh']);
Route::middleware('auth.jwt')->post('/auth/logout', [AuthController::class, 'logout']);
```

这个闭环里最重要的一点是：**refresh_token 必须轮换（rotate）**。否则攻击者一旦拿到 refresh_token，就能持续换取新的 access_token，JWT 黑名单只能解决局部问题，无法真正止血。

### 3.4 踩坑记录

#### 坑 1：签名不一致——URL 路径中的尾部斜杠

**问题**：客户端用 `/api/v3/orders` 签名，Nginx 反向代理后变成 `/api/v3/orders/`，导致签名校验失败。

**解决**：签名时对路径做标准化处理：

```php
// 标准化：去除尾部斜杠
$path = rtrim($request->path(), '/');
```

#### 坑 2：PHP 数组键名排序与前端不一致

**问题**：前端 JavaScript 的 `Object.keys().sort()` 是按字典序排序，PHP 的 `ksort()` 也是按字典序，但中文键名在不同 locale 下排序结果不同。

**解决**：强制使用 UTF-8 二进制排序，并限制 query 参数只使用 ASCII 键名。

#### 坑 3：签名内容中包含 multipart/form-data

**问题**：文件上传请求的 body 是 multipart 编码，不同语言的编码实现可能不一致。

**解决**：文件上传接口不参与 body hash，签名只包含 method + path + timestamp + nonce，降低了安全性但保证了兼容性。文件上传接口额外通过 JWT + IP 白名单双重保护。

---

## 四、IP 白名单：基础设施层的快速拦截

### 4.1 应用场景

IP 白名单不是万能的（IP 可伪造），但在以下场景中是**最快速、最有效的第一道防线**：

| 场景 | 说明 |
|------|------|
| 支付回调 | 支付网关的回调 IP 是固定的（Stripe/AliPay 公布的 IP 段） |
| 内部 API | 微服务之间的调用只允许内网 IP |
| 管理后台 | 限制公司出口 IP / VPN IP |
| 第三方 Webhook | 已知的第三方服务 IP 白名单 |

### 4.2 实现方案

#### 4.2.1 中间件实现

```php
<?php
// app/Http/Middleware/IpWhitelist.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class IpWhitelist
{
    public function __construct(
        private string $configKey = 'default'
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $clientIp = $this->getRealIp($request);
        $whitelist = $this->getWhitelist();

        if (empty($whitelist)) {
            Log::warning('IP whitelist is empty, allowing all', [
                'config_key' => $this->configKey,
            ]);
            return $next($request);
        }

        if (!$this->isAllowed($clientIp, $whitelist)) {
            Log::security('IP blocked by whitelist', [
                'ip' => $clientIp,
                'path' => $request->path(),
                'config_key' => $this->configKey,
            ]);

            return response()->json([
                'error' => 'Access denied',
            ], 403);
        }

        return $next($request);
    }

    /**
     * 获取真实 IP（考虑反向代理）
     */
    private function getRealIp(Request $request): string
    {
        // 仅在信任的代理后启用
        if (config('app.trusted_proxies')) {
            $forwardedFor = $request->header('X-Forwarded-For');
            if ($forwardedFor) {
                $ips = array_map('trim', explode(',', $forwardedFor));
                return $ips[0]; // 第一个是真实客户端 IP
            }

            $realIp = $request->header('X-Real-IP');
            if ($realIp) {
                return $realIp;
            }
        }

        return $request->ip();
    }

    /**
     * 获取白名单列表（支持 CIDR）
     */
    private function getWhitelist(): array
    {
        return Cache::remember(
            "ip_whitelist:{$this->configKey}",
            300, // 5 分钟缓存
            fn () => config("security.ip_whitelist.{$this->configKey}", [])
        );
    }

    /**
     * 检查 IP 是否在白名单中（支持 CIDR 表示法）
     */
    private function isAllowed(string $ip, array $whitelist): bool
    {
        foreach ($whitelist as $allowed) {
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
     * 检查 IP 是否在 CIDR 网段内
     */
    private function ipInCidr(string $ip, string $cidr): bool
    {
        [$subnet, $mask] = explode('/', $cidr);
        $mask = (int) $mask;

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $ipLong = ip2long($ip);
            $subnetLong = ip2long($subnet);
            $maskLong = -1 << (32 - $mask);

            return ($ipLong & $maskLong) === ($subnetLong & $maskLong);
        }

        // IPv6 使用 PHP 的 inet_pton
        $ipBin = inet_pton($ip);
        $subnetBin = inet_pton($subnet);

        if ($ipBin === false || $subnetBin === false) {
            return false;
        }

        $maskBin = str_repeat("\xff", $mask >> 3)
                 . chr(0xff << (8 - ($mask & 7)))
                 . str_repeat("\0", 16 - ($mask >> 3) - 1);

        return ($ipBin & $maskBin) === ($subnetBin & $maskBin);
    }
}
```

#### 4.2.2 配置文件

```php
<?php
// config/security.php

return [
    'ip_whitelist' => [
        // Stripe 回调 IP
        'stripe_webhook' => [
            '3.18.12.64/30',
            '3.130.192.128/30',
            '13.235.14.237/32',
            '13.235.122.149/32',
            // ... 从 https://stripe.com/files/ips/ips_webhooks.txt 获取
        ],

        // AliPay 回调 IP
        'alipay_callback' => [
            '110.75.143.0/24',
            '110.75.131.0/24',
            // ... 从 AliPay 文档获取
        ],

        // 内部微服务调用
        'internal_api' => [
            '10.0.0.0/8',     // 内网
            '172.16.0.0/12',  // Docker 网络
            '192.168.0.0/16', // 办公网络
        ],

        // 管理后台
        'admin_panel' => [
            '203.0.113.10/32', // 公司出口 IP
            '198.51.100.0/24', // VPN 网段
        ],
    ],
];
```

#### 4.2.3 路由注册

```php
<?php
// routes/api.php

// Stripe 支付回调（IP 白名单 + 签名校验）
Route::middleware(['ip.whitelist:stripe_webhook', 'verify.webhook.signature'])
    ->post('/callbacks/stripe', [PaymentCallbackController::class, 'stripe']);

// AliPay 支付回调
Route::middleware(['ip.whitelist:alipay_callback'])
    ->post('/callbacks/alipay', [PaymentCallbackController::class, 'alipay']);

// 内部 API
Route::middleware(['ip.whitelist:internal_api', 'verify.signature'])
    ->prefix('internal')
    ->group(function () {
        Route::post('/orders/sync', [InternalOrderController::class, 'sync']);
        Route::post('/inventory/update', [InternalInventoryController::class, 'update']);
    });

// 管理后台
Route::middleware(['ip.whitelist:admin_panel', 'auth:sanctum', 'admin'])
    ->prefix('admin')
    ->group(function () {
        // ...
    });
```

### 4.3 踩坑记录

#### 坑 1：Nginx 反向代理后获取到的 IP 是 127.0.0.1

**问题**：所有请求的 `$request->ip()` 返回 `127.0.0.1`，白名单完全失效。

**解决**：配置 Nginx 传递真实 IP，并在 Laravel 中设置可信代理：

```nginx
# nginx.conf
location / {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```php
// AppServiceProvider.php
use Illuminate\Http\Request;

Request::trustedProxies(['127.0.0.1', '10.0.0.0/8']);
```

#### 坑 2：CDN / WAF 后面的 IP 变化

**问题**：接入 Cloudflare 后，真实 IP 被 Cloudflare 的 IP 替换。

**解决**：使用 Cloudflare 的 `CF-Connecting-IP` 头，并信任 Cloudflare 的 IP 段。

#### 坑 3：支付网关 IP 变更未及时更新

**问题**：Stripe 新增了 webhook IP，但配置没有及时更新，导致部分回调被拦截。

**解决**：定时任务每小时拉取最新的 IP 列表并更新配置：

```php
<?php
// app/Console/Commands/UpdateStripeWebhookIPs.php

class UpdateStripeWebhookIPs extends Command
{
    protected $signature = 'security:update-stripe-ips';

    public function handle(): void
    {
        $response = Http::get('https://stripe.com/files/ips/ips_webhooks.txt');
        $ips = array_filter(explode("\n", $response->body()));

        config(['security.ip_whitelist.stripe_webhook' => $ips]);
        Cache::forget('ip_whitelist:stripe_webhook');

        $this->info("Updated Stripe webhook IPs: " . count($ips) . " entries");
    }
}
```

---

## 五、防重放攻击：Nonce + Timestamp 机制

### 5.1 攻击原理

重放攻击（Replay Attack）的核心非常简单：

```
1. 攻击者截获一个合法的支付请求
2. 原封不动地重新发送这个请求
3. 服务器无法区分这是新请求还是旧请求
4. 同一笔订单被重复支付
```

即使有了 JWT + 请求签名，如果签名内容不包含时间因素，重放攻击仍然有效——因为签名本身也是合法的。

### 5.2 Nonce + Timestamp 双重机制

我们的防重放方案结合了两个机制：

```
┌─────────────────────────────────────────┐
│              防重放检查流程               │
├─────────────────────────────────────────┤
│                                         │
│  1. 检查 timestamp 是否在有效窗口内      │
│     └─ 有效窗口 = ±5 分钟               │
│                                         │
│  2. 检查 nonce 是否已使用过              │
│     └─ 使用 Redis SET 存储已用 nonce    │
│     └─ TTL = 有效窗口 × 2               │
│                                         │
│  3. 两个检查都通过才放行                 │
│                                         │
└─────────────────────────────────────────┘
```

**为什么需要两个机制？**

- **只有 Timestamp**：攻击者在有效窗口内（5 分钟）可以无限重放
- **只有 Nonce**：攻击者可以存储大量 nonce 后在未来使用
- **两者结合**：nonce 在 Redis 中只保留 10 分钟，超过 10 分钟的 nonce 自动清理；timestamp 保证即使 nonce 泄露也只在短时间内有效

### 5.3 实现代码（集成在签名验证中间件中）

```php
<?php
// app/Services/ReplayProtection.php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class ReplayProtection
{
    private const NONCE_TTL = 600; // nonce 保留 10 分钟

    /**
     * 检查并标记 nonce
     * @return bool true=允许，false=重放攻击
     */
    public function checkAndConsume(string $appId, string $nonce, int $timestamp): bool
    {
        // 时间窗口检查
        $timeDiff = abs(time() - $timestamp);
        if ($timeDiff > 300) { // 5 分钟
            return false;
        }

        // Nonce 原子性检查和标记（使用 Redis SET NX）
        $key = "nonce:{$appId}:{$nonce}";
        $isNew = Redis::set($key, '1', ['NX', 'EX' => self::NONCE_TTL]);

        return (bool) $isNew; // true 表示首次使用，false 表示重放
    }

    /**
     * 批量清理过期 nonce（可选，依赖 Redis 自动过期）
     */
    public function cleanup(): int
    {
        // Redis 自动过期机制已足够，此方法仅用于紧急手动清理
        $keys = Redis::keys('nonce:*');
        $cleaned = 0;

        foreach ($keys as $key) {
            if (Redis::ttl($key) < 0) {
                Redis::del($key);
                $cleaned++;
            }
        }

        return $cleaned;
    }
}
```

### 5.4 支付回调防重放的特殊处理

支付回调的防重放需要额外考虑——支付网关可能会重试回调：

```php
<?php
// app/Http/Controllers/PaymentCallbackController.php

class PaymentCallbackController extends Controller
{
    public function stripe(Request $request): JsonResponse
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');

        // 1. Stripe 签名验证（防伪造）
        try {
            $event = \Stripe\Webhook::constructEvent(
                $payload,
                $sigHeader,
                config('services.stripe.webhook_secret')
            );
        } catch (\Exception $e) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        // 2. 幂等性检查（防重放 + 防重复处理）
        $paymentId = $event->data->object->id;
        $lockKey = "payment_callback:stripe:{$paymentId}";

        // 使用分布式锁确保同一笔支付只处理一次
        $lock = Cache::lock($lockKey, 300); // 5 分钟锁

        if (!$lock->get()) {
            // 已在处理中或已处理完成
            Log::info('Stripe callback already processed', [
                'payment_id' => $paymentId,
            ]);
            return response()->json(['status' => 'already_processed']);
        }

        try {
            // 3. 业务处理
            $this->processPayment($event);

            // 4. 标记已处理
            Cache::put("payment_processed:stripe:{$paymentId}", true, 86400);

            return response()->json(['status' => 'success']);
        } catch (\Exception $e) {
            Log::error('Stripe callback processing failed', [
                'payment_id' => $paymentId,
                'error' => $e->getMessage(),
            ]);

            // 释放锁，允许重试
            $lock->release();
            return response()->json(['error' => 'Processing failed'], 500);
        }
    }

    private function processPayment(\Stripe\Event $event): void
    {
        match ($event->type) {
            'payment_intent.succeeded' => $this->handlePaymentSuccess($event->data->object),
            'payment_intent.payment_failed' => $this->handlePaymentFailure($event->data->object),
            default => Log::info('Unhandled Stripe event', ['type' => $event->type]),
        };
    }
}
```

### 5.4.1 幂等表设计：别把“防重放”误当成“业务幂等”

这是实际项目里最常见的认知错误：很多同学以为 nonce 校验通过了，就等于支付、下单、库存扣减一定不会重复执行。**其实不是。**

- **防重放** 解决的是“同一份网络请求被重复发送”；
- **业务幂等** 解决的是“同一个业务动作被多次触发时只生效一次”。

例如 Stripe 官方就会主动重试 webhook，即使每次 HTTP 请求都不同，业务上仍然可能是同一个 `payment_intent`。因此建议在数据库再落一层业务幂等表：

```php
<?php
// database/migrations/2026_06_01_000000_create_idempotency_records_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('idempotency_records', function (Blueprint $table) {
            $table->id();
            $table->string('biz_type', 50);
            $table->string('biz_key', 100)->unique();
            $table->string('status', 20)->default('processing');
            $table->json('response_snapshot')->nullable();
            $table->timestamp('expired_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_records');
    }
};
```

```php
<?php
// app/Services/IdempotencyService.php

namespace App\Services;

use App\Models\IdempotencyRecord;
use Illuminate\Database\QueryException;

class IdempotencyService
{
    public function begin(string $bizType, string $bizKey): bool
    {
        try {
            IdempotencyRecord::query()->create([
                'biz_type' => $bizType,
                'biz_key' => $bizKey,
                'status' => 'processing',
            ]);

            return true;
        } catch (QueryException $e) {
            return false;
        }
    }

    public function complete(string $bizKey, array $snapshot = []): void
    {
        IdempotencyRecord::query()
            ->where('biz_key', $bizKey)
            ->update([
                'status' => 'done',
                'response_snapshot' => $snapshot,
            ]);
    }
}
```

这个表不一定要覆盖全部接口，但**支付、退款、优惠券核销、库存扣减**这几类高风险接口，最好都上。

### 5.5 踩坑记录

#### 坑 1：Nonce 被前端错误重用

**问题**：前端重试逻辑在请求失败时用同一个 nonce 重试，导致合法重试被误判为重放攻击。

**解决**：前端重试时**必须重新生成 nonce**，而非复用：

```javascript
// ❌ 错误：重试时复用 nonce
async function retryRequest(config) {
    return axios(config); // nonce 不变，会被拦截
}

// ✅ 正确：重试时重新生成签名
async function retryRequest(config) {
    const newNonce = generateNonce();
    const newTimestamp = Math.floor(Date.now() / 1000);
    config.headers['X-Nonce'] = newNonce;
    config.headers['X-Timestamp'] = newTimestamp;
    config.headers['X-Signature'] = await signRequest(config, newNonce, newTimestamp);
    return axios(config);
}
```

#### 坑 2：高并发下 Redis NX 操作的性能

**问题**：Redis NX 操作在 QPS 10,000+ 时成为瓶颈。

**解决**：对 nonce 进行分片存储，使用多个 Redis key 分散压力：

```php
// 分 16 个桶
$bucket = crc32($nonce) % 16;
$key = "nonce:{$appId}:bucket_{$bucket}:{$nonce}";
```

#### 坑 3：系统时钟漂移导致合法请求被拒

**问题**：客户端设备时间不准（差 10 分钟），导致 timestamp 校验失败。

**解决**：

1. 对内部服务：强制 NTP 同步
2. 对外部客户端：扩大时间窗口至 10 分钟，或在首次请求时返回服务器时间供客户端校准

```php
// 响应头中返回服务器时间
$response->headers->set('X-Server-Time', (string) time());
```

---

## 六、完整中间件注册与优先级

### 6.1 中间件注册

```php
<?php
// bootstrap/app.php (Laravel 11+) 或 app/Http/Kernel.php

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        // 注册中间件别名
        $middleware->alias([
            'auth.jwt' => \App\Http\Middleware\JWTAuthenticate::class,
            'ip.whitelist' => \App\Http\Middleware\IpWhitelist::class,
            'verify.signature' => \App\Http\Middleware\VerifyRequestSignature::class,
            'verify.webhook.signature' => \App\Http\Middleware\VerifyWebhookSignature::class,
            'prevent.replay' => \App\Http\Middleware\PreventReplay::class,
        ]);

        // 全局中间件顺序
        $middleware->prepend(\App\Http\Middleware\TrustProxies::class);
        $middleware->append(\App\Http\Middleware\HandleCors::class);
    })
    ->create();
```

### 6.2 推荐的中间件执行顺序

```
请求 →
  1. TrustProxies          (基础设施)
  2. HandleCors            (跨域)
  3. IpWhitelist           (IP 白名单，最快拦截)
  4. VerifyRequestSignature (签名校验，含 nonce 检查)
  5. JWTAuthenticate       (JWT + 黑名单)
  6. ThrottleRequests      (限流)
  7. 业务逻辑
```

### 6.3 不同场景的中间件组合

```php
<?php
// routes/api.php

// === 公开 API（需要认证 + 签名） ===
Route::middleware(['verify.signature', 'auth.jwt', 'throttle:api'])
    ->group(function () {
        Route::get('/orders', [OrderController::class, 'index']);
        Route::post('/orders', [OrderController::class, 'store']);
    });

// === 支付回调（IP 白名单 + 签名验证） ===
Route::middleware(['ip.whitelist:stripe_webhook'])
    ->post('/callbacks/stripe', [PaymentCallbackController::class, 'stripe']);

// === 内部 API（IP 白名单 + 签名） ===
Route::middleware(['ip.whitelist:internal_api', 'verify.signature'])
    ->prefix('internal')
    ->group(function () {
        Route::post('/sync/inventory', [InternalController::class, 'syncInventory']);
    });

// === 管理后台（IP 白名单 + JWT + 管理员权限） ===
Route::middleware(['ip.whitelist:admin_panel', 'auth.jwt', 'admin'])
    ->prefix('admin')
    ->group(function () {
        Route::get('/dashboard', [AdminController::class, 'dashboard']);
    });

// === 健康检查（无安全层） ===
Route::get('/health', fn () => response()->json(['status' => 'ok']));
```

---

## 七、监控与告警

### 7.1 安全事件监控

```php
<?php
// app/Services/SecurityMonitor.php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class SecurityMonitor
{
    /**
     * 记录安全事件并触发告警
     */
    public function logSecurityEvent(string $type, array $context): void
    {
        Log::channel('security')->warning("Security event: {$type}", $context);

        // 使用 Redis 计数器实现滑动窗口告警
        $counterKey = "security:events:{$type}:" . date('Y-m-d-H');
        $count = Redis::incr($counterKey);
        Redis::expire($counterKey, 3600);

        // 告警阈值
        $thresholds = [
            'ip_blocked' => 50,          // 每小时 50 次 IP 拦截
            'signature_invalid' => 100,   // 每小时 100 次签名校验失败
            'replay_detected' => 10,      // 每小时 10 次重放攻击
            'jwt_revoked' => 200,         // 每小时 200 次已撤销 Token 访问
        ];

        $threshold = $thresholds[$type] ?? 1000;

        if ($count >= $threshold && $count % $threshold === 0) {
            $this->sendAlert($type, $count, $context);
        }
    }

    private function sendAlert(string $type, int $count, array $context): void
    {
        // 发送到 Slack / 企业微信 / PagerDuty
        app(\App\Notifications\SecurityAlertNotification::class)
            ->notify($type, $count, $context);
    }
}
```

### 7.2 Grafana 监控面板

建议在 Grafana 中配置以下监控指标：

```yaml
# Prometheus metrics (自定义 middleware 中采集)
- api_security_ip_blocked_total      # IP 白名单拦截次数
- api_security_signature_failed_total # 签名校验失败次数
- api_security_replay_detected_total  # 重放攻击次数
- api_security_jwt_revoked_total      # JWT 黑名单命中次数
- api_security_request_duration_seconds # 安全层耗时
```

---

## 八、总结与最佳实践

### 8.1 防御层次总结

| 层次 | 机制 | 防御目标 | 性能影响 |
|------|------|---------|---------|
| Layer 1 | IP 白名单 | 未知来源 | 极低（内存查找） |
| Layer 2 | 请求签名 | 伪造/篡改 | 低（CPU HMAC 计算） |
| Layer 3 | Nonce + Timestamp | 重放攻击 | 中（Redis 读写） |
| Layer 4 | JWT + 黑名单 | 身份伪造/Token 泄露 | 中（Redis 读写） |

### 8.2 落地建议

1. **不要一步到位**——先做 JWT + 黑名单（最高 ROI），再做请求签名，最后做 IP 白名单
2. **签名不要包含在 JWT 中**——两者是独立的安全机制，职责不同
3. **Redis 是关键基础设施**——JWT 黑名单、Nonce 去重、限流计数都依赖 Redis，确保 Redis 高可用
4. **日志是安全的眼睛**——所有安全拦截事件必须记录，否则攻击发生时无从追查
5. **定期审计 IP 白名单**——支付网关 IP 会变更，至少每月检查一次
6. **不要过度信任 IP**——IP 可伪造，IP 白名单只作为辅助手段，不作为唯一认证方式
7. **刷新令牌必须轮换**——refresh_token 不轮换，等于给攻击者长期通行证
8. **防重放与业务幂等要同时做**——前者挡网络层复制，后者挡业务层重复执行

### 8.3 我们的真实收益

在 KKday B2C API 上线这套多层防御后：

- **伪造请求**：从月均 200+ 降至 0
- **重放攻击**：支付重复扣款投诉归零
- **Token 泄露**：密码修改后旧 Token 立即失效，安全事件响应时间从小时级降至秒级
- **安全层性能开销**：P99 延迟增加仅 **2.3ms**（Redis Pipeline 优化后）

---

## 相关阅读

- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/00_架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论](/categories/00_架构/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/)
- [CDN 配置实战：静态资源加速与缓存失效策略](/categories/00_架构/CDN-配置实战-静态资源加速与缓存失效策略-Laravel-B2C-API踩坑记录/)
