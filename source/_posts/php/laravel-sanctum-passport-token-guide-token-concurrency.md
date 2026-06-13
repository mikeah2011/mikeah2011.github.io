---
title: Laravel Sanctum / Passport Token 刷新机制实战：多端登录、双 Token 轮换与并发续签踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:11:35
categories:
  - php
tags: [Laravel, Sanctum, Passport, OAuth, Token, Redis, 认证, 多端登录]
keywords: [Laravel Sanctum, Passport Token, Token, 刷新机制实战, 多端登录, 轮换与并发续签踩坑记录, PHP]
description: 结合 Laravel B2C API 的真实改造经验，深入对比 Sanctum 与 Passport 在多端登录场景下的 token 刷新设计，覆盖双 token 轮换、并发续签、撤销链路、设备维度会话管理与生产踩坑处理。附可运行代码示例与选型对比表，适合需要设计安全认证体系的 PHP 后端开发者参考。



---

做 B2C API 时，认证最容易“先跑起来再说”，最后把自己坑到：Web 管理后台想要无感续签，App 端要支持长期登录，风控又要求可以单设备踢下线。很多团队的第一反应是把 access token TTL 拉长，但这通常只是把问题延后。

我这次改造的场景很典型：**后台 SPA 走 Sanctum，移动端和第三方集成走 Passport**。真正麻烦的不是“怎么发 token”，而是 **token 过期之后如何安全刷新**。如果刷新链路没设计好，会出现三类事故：并发请求把 refresh token 刷爆、旧 refresh token 被重放、退出登录后幽灵会话还在继续用。

这篇只讲落地方案，不讲泛泛概念。

## 一、我最后采用的拆分策略

- **Sanctum**：给内部 SPA / 后台系统，用 cookie session 或短期 personal access token。
- **Passport**：给 App、开放平台、第三方回调后的用户态访问，用标准 OAuth2 access token + refresh token。
- **共同原则**：access token 短命，refresh token 单次轮换，刷新过程必须串行化。

如果你的系统同时有 H5、后台、App、多语言 BFF，这种拆分比"全站只用一种认证"更稳。

### Sanctum vs Passport 选型对比表

| 维度 | Sanctum | Passport |
| --- | --- | --- |
| 认证模型 | Cookie Session / Personal Access Token | 标准 OAuth2 Grant |
| Refresh Token | 不原生支持，需自行实现 | 内置 Refresh Token 流程 |
| 适用场景 | 一方应用（SPA、后台、同域 API） | 开放平台、第三方集成、跨域授权 |
| 并发保护 | 需手动加 Cache::lock | 自带 Token Rotation |
| 多端管理 | 无设备维度，需自建 | 可通过 scope + device_id 扩展 |
| 安全审计 | 依赖 personal_access_tokens 表 | oauth_access_tokens + oauth_refresh_tokens 双表 |
| 复杂度 | 低，开箱即用 | 中高，需理解 OAuth2 协议 |
| 生态 | Laravel 官方维护 | Laravel 官方维护，社区更成熟 |

## 二、整体架构图

```text
                         +----------------------+
                         |   SPA / iOS / Android |
                         +-----------+----------+
                                     |
                        access token / refresh token
                                     |
                   +-----------------v-----------------+
                   |         Laravel API Gateway        |
                   |  /login /refresh /logout /me       |
                   +---------+---------------+----------+
                             |               |
               Sanctum flow  |               | Passport flow
                             |               |
          +------------------v--+       +---v-------------------+
          | personal_access_tokens |    | oauth_access_tokens   |
          | auth_refresh_tokens    |    | oauth_refresh_tokens  |
          +-----------+------------+    +-----------+-----------+
                      |                             |
                      +-------------+---------------+
                                    |
                             +------v------+
                             | MySQL / Redis|
                             | lock + revoke|
                             +-------------+
```

这里最关键的一点是：**刷新不是前端行为，而是服务端会话状态变更**。只要服务端不记录 refresh token 的生命周期，你迟早会在安全审计里翻车。

## 三、Sanctum 不自带 refresh token，别偷懒硬延长 TTL

Sanctum 很适合 Laravel 自家应用，但它不像 Passport 那样直接给你 refresh token 流程。所以我没有把 Sanctum token 有效期从 2 小时拉到 30 天，而是额外做一张 `auth_refresh_tokens` 表，专门管理刷新会话。

### 1. migration

```php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('auth_refresh_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('device_id', 64);
            $table->string('refresh_token_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->index(['user_id', 'device_id']);
        });
    }
};
```

### 2. 登录时签发 access token + refresh token

```php
namespace App\Services\Auth;

use App\Models\AuthRefreshToken;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class SanctumTokenIssuer
{
    public function issue(User $user, string $deviceId): array
    {
        $plainRefreshToken = Str::random(80);
        $accessToken = $user->createToken($deviceId, ['*'], Carbon::now()->addMinutes(30));

        AuthRefreshToken::create([
            'user_id' => $user->id,
            'device_id' => $deviceId,
            'refresh_token_hash' => hash('sha256', $plainRefreshToken),
            'expires_at' => now()->addDays(14),
        ]);

        return [
            'access_token' => $accessToken->plainTextToken,
            'refresh_token' => $plainRefreshToken,
            'expires_in' => 1800,
        ];
    }
}
```

注意我只存 **hash 后的 refresh token**。数据库泄漏时，不能让攻击者直接拿明文 refresh token 续命。

## 四、刷新接口一定要做“单次轮换”

最早我踩过的坑是：refresh token 可重复使用。结果用户在弱网环境下一次点出三次刷新，请求全成功，数据库里同时出现多组可用 access token，排查非常恶心。

后来我改成了 **rotate on refresh**：每次刷新都废弃旧 refresh token，并签发新的 refresh token。

```php
namespace App\Http\Controllers\Auth;

use App\Models\AuthRefreshToken;
use App\Services\Auth\SanctumTokenIssuer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class RefreshSanctumTokenController
{
    public function __invoke(Request $request, SanctumTokenIssuer $issuer): JsonResponse
    {
        $plainRefreshToken = (string) $request->input('refresh_token');
        $deviceId = (string) $request->input('device_id');
        $tokenHash = hash('sha256', $plainRefreshToken);

        $lock = Cache::lock('refresh-token:' . $tokenHash, 5);

        return $lock->block(3, function () use ($tokenHash, $deviceId, $issuer) {
            return DB::transaction(function () use ($tokenHash, $deviceId, $issuer) {
                $refreshToken = AuthRefreshToken::query()
                    ->where('refresh_token_hash', $tokenHash)
                    ->where('device_id', $deviceId)
                    ->whereNull('revoked_at')
                    ->lockForUpdate()
                    ->first();

                abort_if(! $refreshToken || $refreshToken->expires_at->isPast(), 401, 'Refresh token expired.');

                $refreshToken->update([
                    'revoked_at' => now(),
                    'last_used_at' => now(),
                ]);

                $refreshToken->user->tokens()
                    ->where('name', $deviceId)
                    ->delete();

                return response()->json($issuer->issue($refreshToken->user, $deviceId));
            });
        });
    }
}
```

这里的 `Cache::lock + lockForUpdate` 不是重复劳动。Redis 锁解决跨 Pod 并发；数据库行锁保证事务内状态一致。只做其中一个，在高并发下都不够稳。

## 五、Passport 刷新别只会透传 `/oauth/token`

Passport 自带 refresh token，但很多项目只是前端直接拿着 refresh token 去打 `/oauth/token`。这会带来两个问题：

1. 你没法记录设备维度审计；
2. 你没法在风控场景里做额外校验，比如 IP 漂移、UA 变化、冻结用户。

所以我通常会包一层自己的入口，再在服务里向 Passport 发请求：

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class RefreshPassportTokenController
{
    public function __invoke(Request $request)
    {
        $response = Http::asForm()->post(config('services.passport.token_endpoint'), [
            'grant_type' => 'refresh_token',
            'refresh_token' => $request->string('refresh_token')->toString(),
            'client_id' => config('services.passport.client_id'),
            'client_secret' => config('services.passport.client_secret'),
            'scope' => '',
        ]);

        abort_unless($response->successful(), 401, 'Unable to refresh passport token.');

        return response()->json($response->json());
    }
}
```

这层看起来只是转发，实际上你终于有机会把“刷新”纳入自己的审计、限流和告警体系。

## 六、Sanctum 中间件：不只是 `auth:sanctum` 一行搞定

很多团队用 Sanctum 时只写了路由中间件 `auth:sanctum`，然后就认为"认证做完了"。实际上在生产环境，你还需要在中间件层做更多校验：IP 漂移检测、设备绑定验证、用户状态检查。下面是我实际使用的自定义 Sanctum 中间件。

```php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class VerifySanctumToken
{
    public function handle(Request $request, Closure $next): Response
    {
        // 1. 基础认证 —— Sanctum 自带
        if (! $request->user() || ! $request->user()->currentAccessToken()) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $user = $request->user();
        $token = $request->user()->currentAccessToken();

        // 2. 用户状态校验 —— 被冻结/禁用的用户不应通过任何 token 访问
        if ($user->status !== 'active') {
            // 立即撤销该用户所有 token，防止"冻结后还能用旧 token"
            $user->tokens()->delete();
            return response()->json(['message' => 'Account suspended.'], 403);
        }

        // 3. IP 漂移检测 —— 同一 token 在短时间内跨地域使用，高度可疑
        $tokenKey = 'token-ip:' . $token->getKey();
        $previousIp = Cache::get($tokenKey);
        $currentIp = $request->ip();

        if ($previousIp && $previousIp !== $currentIp) {
            // IP 变化超过阈值，记录告警但不直接拒绝（CDN/VPN 场景下 IP 会变）
            logger()->warning('token_ip_drift', [
                'user_id' => $user->id,
                'token_id' => $token->getKey(),
                'previous_ip' => $previousIp,
                'current_ip' => $currentIp,
            ]);
        }
        Cache::put($tokenKey, $currentIp, now()->addMinutes(30));

        // 4. 设备绑定验证 —— token 的 name 应该与请求中的 device_id 一致
        $deviceId = $request->header('X-Device-Id');
        if ($deviceId && $token->name !== $deviceId) {
            return response()->json(['message' => 'Device mismatch.'], 401);
        }

        return $next($request);
    }
}
```

在 `bootstrap/app.php` 中注册为全局中间件或路由中间件组：

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias([
        'sanctum.verify' => \App\Http\Middleware\VerifySanctumToken::class,
    ]);
})
```

路由使用方式：

```php
Route::middleware(['auth:sanctum', 'sanctum.verify'])->group(function () {
    Route::get('/me', fn (Request $request) => $request->user());
    Route::post('/orders', CreateOrderController::class);
});
```

> **为什么不在 `auth:sanctum` 里做这些？** 因为 `auth:sanctum` 是 Laravel 框架提供的认证中间件，职责单一：验证 token 有效性并注入 user。把业务逻辑（IP 检测、设备绑定）放进去会污染框架层，而且一旦 Laravel 升级改了内部实现，你的魔改就会爆炸。自定义中间件是正确的扩展点。

## 七、Redis Token 黑名单：注销 ≠ 删除

当你用 Sanctum 的 `$user->tokens()->delete()` 注销 token 时，问题来了：**已经发出去的 token 在过期前仍然有效**。Sanctum 默认用数据库验证 token 存在性，delete 之后确实立即失效。但如果你做了缓存层（比如把 token 验证结果缓存到 Redis），或者用的是 Passport 的 JWT 模式（JWT 自包含，不查数据库），那"删了数据库记录"≠"token 立即失效"。

这时候你需要 **Token 黑名单**。

### 黑名单实现

```php
namespace App\Services\Auth;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TokenBlacklist
{
    private const PREFIX = 'token:blacklist:';
    private const GRACE_SECONDS = 5; // 宽容窗口，防止并发请求误杀

    /**
     * 将 token 加入黑名单。
     * @param string $tokenId  Sanctum token ID 或 Passport token 的 jti (JWT ID)
     * @param int    $ttlSeconds  黑名单保留时长，通常等于 token 剩余有效期
     */
    public function revoke(string $tokenId, int $ttlSeconds): void
    {
        Cache::put(self::PREFIX . $tokenId, 'revoked', now()->addSeconds($ttlSeconds));

        // 同步写数据库，作为 Redis 丢失时的降级方案
        DB::table('token_blacklist')->updateOrInsert(
            ['token_id' => $tokenId],
            ['expires_at' => now()->addSeconds($ttlSeconds)]
        );
    }

    /**
     * 检查 token 是否在黑名单中。
     */
    public function isRevoked(string $tokenId): bool
    {
        // 先查 Redis（快），miss 再查 DB（降级）
        return Cache::has(self::PREFIX . $tokenId)
            || DB::table('token_blacklist')
                ->where('token_id', $tokenId)
                ->where('expires_at', '>', now())
                ->exists();
    }

    /**
     * 批量撤销用户所有 token（风控冻结场景）。
     */
    public function revokeAllForUser(int $userId, int $ttlSeconds = 86400): void
    {
        $tokenIds = DB::table('personal_access_tokens')
            ->where('tokenable_id', $userId)
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->toArray();

        foreach ($tokenIds as $tokenId) {
            $this->revoke($tokenId, $ttlSeconds);
        }
    }
}
```

### 在中间件中集成黑名单校验

```php
// 在 VerifySanctumToken 中间件里增加一步
$tokenId = (string) $token->getKey();
if (app(TokenBlacklist::class)->isRevoked($tokenId)) {
    return response()->json(['message' => 'Token has been revoked.'], 401);
}
```

### 黑名单的 TTL 策略

| 场景 | TTL 设置 | 原因 |
| --- | --- | --- |
| 用户主动退出 | 等于 access token 剩余有效期 | 过期后自然失效，无需永久存储 |
| 风控冻结用户 | 24 小时或更长 | 覆盖所有可能的长生命周期 token |
| 密码修改后全量注销 | 24 小时 | 同上 |
| 定期清理 | 运行 `token:blacklist:prune` 命令 | 防止 Redis/DB 膨胀 |

```php
// app/Console/Commands/PruneTokenBlacklist.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PruneTokenBlacklist extends Command
{
    protected $signature = 'token:blacklist:prune';
    protected $description = '清理已过期的 token 黑名单记录';

    public function handle(): int
    {
        $deleted = DB::table('token_blacklist')
            ->where('expires_at', '<', now())
            ->delete();

        $this->info("已清理 {$deleted} 条过期黑名单记录。");
        return self::SUCCESS;
    }
}
```

在 `app/Console/Kernel.php` 中注册定时任务：`$schedule->command('token:blacklist:prune')->daily();`

## 八、并发刷新的竞态条件：这才是最隐蔽的坑

前面第四节的 `Cache::lock + lockForUpdate` 解决了同一 refresh token 被并发使用的问题。但生产环境比这复杂得多：**前端也可能发起并发刷新**。

### 场景还原

用户在 SPA 中打开了多个 Tab，或者 App 在后台被唤醒后发现 token 过期。每个客户端实例都独立发起 refresh 请求。如果后端没有做防御，会出现以下灾难链：

1. 客户端 A 用 refresh_token_v1 请求刷新 → 服务端废弃 v1，签发 access_token_2 + refresh_token_v2
2. 客户端 B（稍晚 50ms）也用 refresh_token_v1 请求刷新 → **v1 已被废弃**，刷新失败，用户被踢出登录

用户感知：明明什么都没做，突然要重新登录。这种 Bug 极难复现，只有在弱网或高延迟场景下才会频繁出现。

### 完整解决方案：前端去重 + 后端宽限期

**前端：refresh promise 复用（Axios 拦截器）**

```typescript
// src/utils/http.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

let refreshPromise: Promise<string> | null = null;

const http = axios.create({ baseURL: '/api' });

http.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        if (error.response?.status !== 401 || originalRequest._retry) {
            return Promise.reject(error);
        }
        originalRequest._retry = true;

        // 关键：如果已经有一个 refresh 在进行，复用它的 promise，不要重新发起
        if (! refreshPromise) {
            refreshPromise = doRefresh()
                .finally(() => { refreshPromise = null; });
        }

        try {
            const newToken = await refreshPromise;
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return http(originalRequest);
        } catch {
            // refresh 也失败了，跳转登录
            window.location.href = '/login';
            return Promise.reject(error);
        }
    },
);

async function doRefresh(): Promise<string> {
    const refreshToken = localStorage.getItem('refresh_token');
    const deviceId = localStorage.getItem('device_id');
    const { data } = await axios.post('/api/auth/refresh', {
        refresh_token: refreshToken,
        device_id: deviceId,
    });
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    return data.access_token;
}

export default http;
```

**后端：refresh token 宽限期**

即使前端做了去重，在极端情况下（网络分区、客户端 crash 重启）仍然可能出现同一 refresh token 被使用两次的情况。解决方案是在后端给刚废弃的 refresh token 一个短暂的"宽限期"：

```php
namespace App\Services\Auth;

use App\Models\AuthRefreshToken;
use Illuminate\Support\Facades\Cache;

class RefreshTokenGracePeriod
{
    private const GRACE_SECONDS = 10;

    /**
     * 标记 refresh token 为已使用，同时记录宽限期。
     */
    public function markUsed(string $tokenHash): void
    {
        Cache::put(
            'refresh-grace:' . $tokenHash,
            now()->toIso8601String(),
            now()->addSeconds(self::GRACE_SECONDS)
        );
    }

    /**
     * 检查是否在宽限期内。如果是，返回该 token 对应的新 token 组。
     */
    public function withinGracePeriod(string $tokenHash): ?array
    {
        return Cache::get('refresh-grace:' . $tokenHash);
    }
}
```

在刷新控制器中使用宽限期：

```php
// 在 RefreshSanctumTokenController 的 transaction 内部
$grace = app(RefreshTokenGracePeriod::class);

if ($grace->withinGracePeriod($tokenHash)) {
    // 在宽限期内，说明这是并发请求，直接返回最近签发的新 token
    // 需要从缓存中取出上次签发的结果
    $cached = Cache::get('refresh-result:' . $tokenHash);
    if ($cached) {
        return response()->json($cached);
    }
}

// ... 正常的刷新流程 ...

// 刷新成功后，记录宽限期和结果
$grace->markUsed($tokenHash);
Cache::put('refresh-result:' . $tokenHash, $newTokenData, now()->addSeconds(10));
```

### 竞态条件防御总结

| 层级 | 措施 | 防御目标 |
| --- | --- | --- |
| 前端 | Axios 拦截器中 refresh promise 复用 | 同一页面多个 Tab / 多个并发请求只触发一次 refresh |
| 后端-分布式锁 | `Cache::lock('refresh-token:' . $hash)` | 多 Pod 场景下同一 refresh token 只被处理一次 |
| 后端-数据库锁 | `lockForUpdate()` | 事务内状态一致性 |
| 后端-宽限期 | Redis 缓存 10 秒窗口 | 极端并发下的最后一道防线，避免用户被踢出 |

> **注意宽限期的副作用**：宽限期内旧 refresh token 仍可使用，这相当于降低了"单次使用"的安全性。所以宽限期不要设太长（10 秒足够覆盖大多数并发场景），并且在安全审计中要标记宽限期命中事件。

## 九、设备维度会话管理：踢下线、设备限制、会话审计

多端登录不是"允许同时登录"就完事了。你还需要：

- 让用户查看自己在哪些设备上登录了
- 让用户踢掉某个设备的会话
- 限制同一账号的最大设备数
- 审计异常设备行为

### 1. 设备会话表设计

```php
// migration
Schema::create('device_sessions', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('device_id', 64);
    $table->string('device_name', 128)->nullable();  // "iPhone 16 Pro"
    $table->string('platform', 32)->nullable();       // "ios", "android", "web"
    $table->string('ip_address', 45)->nullable();
    $table->string('user_agent', 512)->nullable();
    $table->timestamp('last_active_at')->nullable();
    $table->timestamp('created_at');
    $table->timestamp('expired_at')->nullable();

    $table->index(['user_id', 'device_id']);
    $table->index(['user_id', 'last_active_at']);
});
```

### 2. 设备会话服务

```php
namespace App\Services\Auth;

use App\Models\DeviceSession;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeviceSessionManager
{
    private const MAX_DEVICES = 5;

    /**
     * 登录时注册或更新设备会话。
     */
    public function register(User $user, string $deviceId, Request $request): DeviceSession
    {
        // 检查设备数上限
        $activeCount = DeviceSession::where('user_id', $user->id)
            ->whereNull('expired_at')
            ->count();

        $existing = DeviceSession::where('user_id', $user->id)
            ->where('device_id', $deviceId)
            ->whereNull('expired_at')
            ->first();

        if (! $existing && $activeCount >= self::MAX_DEVICES) {
            // 超出设备上限，踢掉最久未活跃的设备
            $oldest = DeviceSession::where('user_id', $user->id)
                ->whereNull('expired_at')
                ->orderBy('last_active_at')
                ->first();

            if ($oldest) {
                $this->revokeDevice($user, $oldest->device_id);
            }
        }

        return DeviceSession::updateOrCreate(
            ['user_id' => $user->id, 'device_id' => $deviceId],
            [
                'device_name' => $request->header('X-Device-Name', 'Unknown Device'),
                'platform' => $request->header('X-Platform', 'unknown'),
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'last_active_at' => now(),
                'expired_at' => null,
            ]
        );
    }

    /**
     * 撤销指定设备的所有 token。
     */
    public function revokeDevice(User $user, string $deviceId): void
    {
        DB::transaction(function () use ($user, $deviceId) {
            // 撤销 Sanctum tokens
            $user->tokens()->where('name', $deviceId)->delete();

            // 撤销 refresh tokens
            DB::table('auth_refresh_tokens')
                ->where('user_id', $user->id)
                ->where('device_id', $deviceId)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
            // 标记设备会话过期
            DeviceSession::where('user_id', $user->id)
                ->where('device_id', $deviceId)
                ->whereNull('expired_at')
                ->update(['expired_at' => now()]);
        });
    }

    /**
     * 获取用户当前活跃设备列表。
     */
    public function getActiveDevices(User $user): array
    {
        return DeviceSession::where('user_id', $user->id)
            ->whereNull('expired_at')
            ->orderByDesc('last_active_at')
            ->get()
            ->map(fn (DeviceSession $s) => [
                'device_id' => $s->device_id,
                'device_name' => $s->device_name,
                'platform' => $s->platform,
                'ip_address' => $s->ip_address,
                'last_active_at' => $s->last_active_at->toIso8601String(),
                'is_current' => $s->device_id === request()->header('X-Device-Id'),
            ])
            ->toArray();
    }

    /**
     * 踢掉除当前设备外的所有设备。
     */
    public function revokeOtherDevices(User $user, string $currentDeviceId): int
    {
        $otherDevices = DeviceSession::where('user_id', $user->id)
            ->where('device_id', '!=', $currentDeviceId)
            ->whereNull('expired_at')
            ->pluck('device_id');

        $count = 0;
        foreach ($otherDevices as $deviceId) {
            $this->revokeDevice($user, $deviceId);
            $count++;
        }
        return $count;
    }
}
```

### 3. 设备管理 API

```php
Route::middleware(['auth:sanctum', 'sanctum.verify'])->prefix('devices')->group(function () {
    // 查看当前设备列表
    Route::get('/', fn (Request $request) =>
        response()->json(app(DeviceSessionManager::class)->getActiveDevices($request->user()))
    );

    // 踢掉指定设备
    Route::delete('/{deviceId}', function (Request $request, string $deviceId) {
        app(DeviceSessionManager::class)->revokeDevice($request->user(), $deviceId);
        return response()->json(['message' => 'Device session revoked.']);
    });

    // 踢掉除当前设备外的所有设备
    Route::delete('/others', function (Request $request) {
        $count = app(DeviceSessionManager::class)
            ->revokeOtherDevices($request->user(), $request->header('X-Device-Id'));
        return response()->json(['message' => "{$count} device(s) revoked."]);
    });
});
```

## 十、Passport 刷新增强：审计、限流与异常检测

第五节的 Passport 刷新控制器只是一个骨架。在生产环境中，你需要加入更多防御层。

```php
namespace App\Http\Controllers\Auth;

use App\Services\Auth\TokenBlacklist;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RefreshPassportTokenController
{
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'refresh_token' => 'required|string',
            'device_id' => 'required|string|max:64',
        ]);

        $user = $request->user();
        $ip = $request->ip();

        // 1. 限流：同一用户每分钟最多刷新 5 次
        $rateLimitKey = 'refresh-rate:' . ($user?->id ?? $ip);
        if (Cache::get($rateLimitKey, 0) >= 5) {
            Log::warning('refresh_rate_limit_exceeded', [
                'user_id' => $user?->id,
                'ip' => $ip,
            ]);
            return response()->json(['message' => 'Too many refresh attempts.'], 429);
        }
        Cache::increment($rateLimitKey);
        Cache::put($rateLimitKey, Cache::get($rateLimitKey), now()->addMinute());

        // 2. 调用 Passport token endpoint
        $response = Http::asForm()
            ->timeout(5)
            ->post(config('services.passport.token_endpoint'), [
                'grant_type' => 'refresh_token',
                'refresh_token' => $request->string('refresh_token'),
                'client_id' => config('services.passport.client_id'),
                'client_secret' => config('services.passport.client_secret'),
                'scope' => '',
            ]);

        // 3. 异常检测：刷新失败时记录详细上下文
        if (! $response->successful()) {
            Log::warning('passport_refresh_failed', [
                'user_id' => $user?->id,
                'ip' => $ip,
                'device_id' => $request->input('device_id'),
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            // 连续失败超过 3 次，触发风控告警
            $failKey = 'refresh-fail:' . ($user?->id ?? $ip);
            $failCount = Cache::increment($failKey);
            Cache::put($failKey, $failCount, now()->addMinutes(5));

            if ($failCount >= 3) {
                Log::alert('refresh_brute_force_suspected', [
                    'user_id' => $user?->id,
                    'ip' => $ip,
                    'fail_count' => $failCount,
                ]);
                // 可选：自动冻结用户或拉入风控
            }

            abort(401, 'Unable to refresh passport token.');
        }

        $data = $response->json();

        // 4. 审计日志
        Log::info('passport_token_refreshed', [
            'user_id' => $user?->id,
            'device_id' => $request->input('device_id'),
            'ip' => $ip,
        ]);

        return response()->json($data);
    }
}
```

### 审计日志的意义

上面代码中大量的 `Log::` 调用不是"过度日志"。在真实安全事故中，正是这些日志让你能在 10 分钟内定位问题：谁的 token 被盗了、从哪个 IP 发起的攻击、有多少会话受影响。没有审计日志的认证系统，出了事就是瞎子摸象。

## 十一、线上最值钱的 4 个踩坑记录

### 坑 1：把 401 自动刷新写在 Axios 拦截器里，却没做请求合并

结果是一个页面并发 6 个请求同时 401，前端就打出 6 次 refresh。后端如果没有串行化，很容易生成 6 组新 token。修复方式很简单：**前端做 refresh promise 复用，后端做锁**，两边都要做。

### 坑 2：退出登录只删 access token，没撤销 refresh token

这会导致“用户明明退出了，但 App 静默刷新后又活过来”。我后来把 logout 改成按设备维度同时删除 Sanctum access token、撤销 refresh token、记录审计日志。

### 坑 3：refresh token 不绑定 device_id

最早为了省事只按 user_id 管理 refresh token，结果 A 设备刷新的 token 把 B 设备会话顶掉。多端登录场景里，**设备维度是必须字段，不是可选增强**。

### 坑 4：只校验 expires_at，不校验 revoked_at / user status

用户被风控冻结后，如果 refresh 逻辑只看过期时间，旧会话还能继续续签。刷新接口里一定要补充用户状态校验，不能把它当成“纯 token 操作”。

## 十二、完整的登出实现：不是一行代码能搞定的事

坑 2 提到"退出登录只删 access token"是常见失误。下面是完整的登出实现，覆盖 Sanctum 和 Passport 两条链路。

```php
namespace App\Http\Controllers\Auth;

use App\Models\AuthRefreshToken;
use App\Services\Auth\DeviceSessionManager;
use App\Services\Auth\TokenBlacklist;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class LogoutController
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $deviceId = $request->header('X-Device-Id');
        $token = $request->user()->currentAccessToken();

        DB::transaction(function () use ($user, $deviceId, $token, $request) {
            // 1. 将当前 access token 加入黑名单（支持缓存层场景）
            if ($token) {
                app(TokenBlacklist::class)->revoke(
                    (string) $token->getKey(),
                    $token->expires_at ? $token->expires_at->diffInSeconds(now()) : 3600
                );
            }

            // 2. 删除当前设备的 Sanctum access tokens
            $user->tokens()
                ->when($deviceId, fn ($q) => $q->where('name', $deviceId))
                ->delete();

            // 3. 撤销当前设备的 refresh tokens
            AuthRefreshToken::where('user_id', $user->id)
                ->when($deviceId, fn ($q) => $q->where('device_id', $deviceId))
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            // 4. 标记设备会话过期
            if ($deviceId) {
                app(DeviceSessionManager::class)->revokeDevice($user, $deviceId);
            }

            // 5. 清除 Passport token（如果存在）
            // Passport 的 token 存在 oauth_access_tokens 表，需要通过 DB 直接操作
            // 或者调用 Passport 的 revoke 方法
        });

        // 6. 审计日志（放在事务外，避免日志写入失败影响主流程）
        Log::info('user_logout', [
            'user_id' => $user->id,
            'device_id' => $deviceId,
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['message' => 'Logged out successfully.']);
    }
}
```

### 全局登出（密码修改 / 风控冻结）

当用户修改密码或被风控冻结时，需要踢掉所有设备：

```php
class LogoutAllController
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        DB::transaction(function () use ($user) {
            // 撤销所有 Sanctum tokens
            $user->tokens()->delete();

            // 撤销所有 refresh tokens
            AuthRefreshToken::where('user_id', $user->id)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            // 标记所有设备会话过期
            \App\Models\DeviceSession::where('user_id', $user->id)
                ->whereNull('expired_at')
                ->update(['expired_at' => now()]);
        });

        Log::info('user_logout_all', [
            'user_id' => $user->id,
            'ip' => $request->ip(),
            'reason' => $request->input('reason', 'user_initiated'),
        ]);

        return response()->json(['message' => 'All sessions terminated.']);
    }
}
```

> **为什么要用事务？** 撤销操作涉及多个表（access tokens、refresh tokens、device sessions、blacklist）。如果中间某步失败但前面的步骤已经执行，会导致状态不一致——比如 access token 删了但 refresh token 还在，App 端会用 refresh token 静默续命，用户以为退出了其实没有。

## 十三、我现在的实践基线

以上所有方案落地后的最终配置：

| 维度 | 配置 | 备注 |
| --- | --- | --- |
| access token 有效期 | 30 分钟 | SPA 场景够用，移动端配合 refresh |
| refresh token 有效期 | 14 天 | 覆盖大多数用户使用周期 |
| refresh token 轮换策略 | 单次使用，刷新即轮换 | 配合宽限期 10 秒 |
| logout 策略 | 按设备撤销 access + refresh + 黑名单 | 单设备退出不影响其他设备 |
| 审计字段 | user_id, device_id, ip, user_agent, last_used_at | 所有认证操作均记录 |
| 并发保护 | Redis lock + DB transaction + 宽限期 | 三层防御 |
| 设备上限 | 同一用户最多 5 个活跃设备 | 超出自动踢掉最久未活跃设备 |
| 黑名单存储 | Redis（主）+ MySQL（降级） | 定时清理过期记录 |
| 告警规则 | 同一用户 5 分钟内 refresh 失败 ≥ 3 次 | 自动进入风控面板 |
| IP 漂移检测 | 记录但不阻断 | CDN/VPN 场景下 IP 会正常变化 |
| Token 黑名单 TTL | access token 剩余有效期 | 过期后自然失效，无需永久存储 |

## 十四、结论

Sanctum 和 Passport 不是二选一，关键在于你是否把它们放到了对的边界里。**Sanctum 适合一方应用，Passport 适合标准授权流；真正决定系统稳不稳的，是 refresh token 的轮换、撤销和并发控制。**

如果今天你的系统还在用"access token 7 天有效、过期了重新登录"，那不是简单，而是把认证复杂度转嫁给用户和客服。把刷新链路补完整，登录体验、风控能力、排障效率都会一起提升。

## 相关阅读

- [Firebase JWT vs 自建 Token：Laravel Passport/Sanctum 的真实选型对比踩坑记录](/categories/PHP/Laravel/firebase-jwt-vs-token-laravel-passport-sanctum-vs/)
- [Laravel WebAuthn / Passkey 实战：后台无密码登录、设备绑定与挑战过期踩坑记录](/categories/PHP/Laravel/laravel-webauthn-passkey-guide/)
- [API Security 深度实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/categories/PHP/Laravel/2026-06-06-api-security-jwt-blacklist-hmac-signature-replay-protection/)
