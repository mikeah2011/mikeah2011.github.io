---
title: Laravel Sanctum / Passport Token 刷新机制实战：多端登录、双 Token 轮换与并发续签踩坑记录
date: 2026-05-03 09:11:35
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, Redis]description: 结合 Laravel B2C API 的真实改造经验，记录 Sanctum 与 Passport 在多端登录场景下的 token 刷新设计，覆盖双 token 轮换、并发续签、撤销链路、设备维度会话管理与生产踩坑处理。
---

做 B2C API 时，认证最容易“先跑起来再说”，最后把自己坑到：Web 管理后台想要无感续签，App 端要支持长期登录，风控又要求可以单设备踢下线。很多团队的第一反应是把 access token TTL 拉长，但这通常只是把问题延后。

我这次改造的场景很典型：**后台 SPA 走 Sanctum，移动端和第三方集成走 Passport**。真正麻烦的不是“怎么发 token”，而是 **token 过期之后如何安全刷新**。如果刷新链路没设计好，会出现三类事故：并发请求把 refresh token 刷爆、旧 refresh token 被重放、退出登录后幽灵会话还在继续用。

这篇只讲落地方案，不讲泛泛概念。

## 一、我最后采用的拆分策略

- **Sanctum**：给内部 SPA / 后台系统，用 cookie session 或短期 personal access token。
- **Passport**：给 App、开放平台、第三方回调后的用户态访问，用标准 OAuth2 access token + refresh token。
- **共同原则**：access token 短命，refresh token 单次轮换，刷新过程必须串行化。

如果你的系统同时有 H5、后台、App、多语言 BFF，这种拆分比“全站只用一种认证”更稳。

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

## 六、线上最值钱的 4 个踩坑记录

### 坑 1：把 401 自动刷新写在 Axios 拦截器里，却没做请求合并

结果是一个页面并发 6 个请求同时 401，前端就打出 6 次 refresh。后端如果没有串行化，很容易生成 6 组新 token。修复方式很简单：**前端做 refresh promise 复用，后端做锁**，两边都要做。

### 坑 2：退出登录只删 access token，没撤销 refresh token

这会导致“用户明明退出了，但 App 静默刷新后又活过来”。我后来把 logout 改成按设备维度同时删除 Sanctum access token、撤销 refresh token、记录审计日志。

### 坑 3：refresh token 不绑定 device_id

最早为了省事只按 user_id 管理 refresh token，结果 A 设备刷新的 token 把 B 设备会话顶掉。多端登录场景里，**设备维度是必须字段，不是可选增强**。

### 坑 4：只校验 expires_at，不校验 revoked_at / user status

用户被风控冻结后，如果 refresh 逻辑只看过期时间，旧会话还能继续续签。刷新接口里一定要补充用户状态校验，不能把它当成“纯 token 操作”。

## 七、我现在的实践基线

- access token：30 分钟
- refresh token：14 天
- refresh token：**单次使用，刷新即轮换**
- logout：按设备撤销 access + refresh
- 审计字段：user_id、device_id、ip、user_agent、last_used_at
- 并发保护：Redis lock + DB transaction
- 告警：同一用户 5 分钟内 refresh 失败次数过高直接进风控面板

## 八、结论

Sanctum 和 Passport 不是二选一，关键在于你是否把它们放到了对的边界里。**Sanctum 适合一方应用，Passport 适合标准授权流；真正决定系统稳不稳的，是 refresh token 的轮换、撤销和并发控制。**

如果今天你的系统还在用“access token 7 天有效、过期了重新登录”，那不是简单，而是把认证复杂度转嫁给用户和客服。把刷新链路补完整，登录体验、风控能力、排障效率都会一起提升。
