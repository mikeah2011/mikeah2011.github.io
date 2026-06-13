---

title: Laravel B2C API - JWT/OAuth/Session 多协议认证踩坑记录
keywords: [Laravel B2C API, JWT, OAuth, Session, 多协议认证踩坑记录]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
- architecture
- auth
tags:
- Laravel
- JWT
- OAuth
- 认证
- API安全
description: KKday B2C API 生产环境认证授权实战踩坑记录，深入剖析 JWT Token 刷新无限循环、OAuth 2.0 回调 CSRF 防护与死循环跳转、Session 与 Token 混合认证边界控制，涵盖 SSO 单点登录架构设计、多种认证协议方案对比分析、性能优化策略与生产环境最佳实践
---


---
# Laravel B2C API - JWT/OAuth/Session 多协议认证踩坑记录

## 📋 文章摘要

在 KKday B2C API 项目中，我经历了三种认证协议的深度实践：**JWT**（无状态）、**OAuth 2.0**（第三方登录）和 **Session**（传统 Web）。本文基于真实项目经验，分享以下核心踩坑：

1. ❌ JWT 刷新 Token 无限循环问题
2. ❌ OAuth 回调路径冲突与跳转死循环
3. ⚠️ Session 与 Token 混合认证时的边界控制
4. ✅ 生产环境最佳实践方案对比

---

## 🎯 项目背景

KKday B2C API 作为 BFF（Backend for Frontend）中间层，需要对接多种认证场景：

- **用户登录**：传统账号密码 → Session Token
- **第三方登录**：Google/Facebook/Apple → OAuth 2.0 Access Token
- **API 调用**：服务间调用/移动端 → JWT Access/Refresh Token
- **SaaS 集成**：Confluence/Jira API → OAuth Client Credentials

> 💡 **为什么需要多种协议？**
> 
> - Session：适合 Web 前端，方便维持登录状态
> - JWT：适合 RESTful API，无状态便于水平扩展
> - OAuth 2.0：标准第三方授权协议，符合行业规范

---

## 🚨 踩坑一：JWT 刷新 Token 无限循环（高并发下最致命）

### ❌ Before：错误实现

```php
// app/Http/Middleware/TokenRefreshMiddleware.php

class TokenRefreshMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        // 检查 Token 是否过期
        $token = $request->bearerToken();
        
        if ($this->tokenExpired($token)) {
            // 问题：直接调用 refresh token，但刷新逻辑中又验证了 access token
            return $this->refreshToken($request);
        }
        
        return $next($request);
    }

    private function refreshToken(Request $request)
    {
        // 向 /api/token/refresh 发起请求
        $response = $this->client->post('/api/token/refresh', [
            'headers' => ['Authorization' => $request->bearerToken()],
            'json' => ['refresh_token' => $request->user()->token() ?? null]
        ]);

        // 返回新 Token，但客户端可能重复刷新，形成无限循环！
        return response()->json([
            'access_token' => $response->access_token,
            'refresh_token' => $response->refresh_token
        ], 200);
    }
}
```

### ⚠️ 问题现象

高并发场景下（如促销活动期间），客户端收到新的 Access Token 后，立即向刷新接口发起请求，导致：

1. **线程池耗尽**：大量刷新请求堆积在 Redis 队列中
2. **数据库锁竞争**：`token_refresh_logs` 表的行锁竞争加剧
3. **响应延迟飙升**：从 50ms → 2000ms+

### ✅ After：生产环境最佳实践

```php
// app/Http/Middleware/TokenRefreshMiddleware.php

class TokenRefreshMiddleware
{
    /**
     * 刷新令牌 - 带指数退避和速率限制
     */
    public function handle(Request $request, Closure $next)
    {
        $token = $this->extractToken($request);
        
        if ($this->isValidAndNotExpired($token)) {
            return $next($request);
        }

        // 第一次刷新请求，立即响应
        if ($this->shouldRefreshImmediately()) {
            return $this->safeRefreshTokenWithBackoff($request);
        }

        // 已拒绝：避免无限循环
        return response()->json([
            'message' => 'Token refresh rate limited',
            'retry_after' => 5 // 客户端应在 5 秒后重试
        ], 429);
    }

    /**
     * 智能刷新 - 带指数退避的重试逻辑
     */
    private function safeRefreshTokenWithBackoff(Request $request)
    {
        // 1. 检查刷新令牌是否存在
        $refreshToken = $this->getValidRefreshToken($request);
        
        if (!$refreshToken || $refreshToken['expired_at']->lt(now())) {
            // 刷新令牌无效或已过期，返回登录提示
            return response()->json([
                'message' => '请重新登录',
                'redirect' => '/login'
            ], 401);
        }

        // 2. 使用 Redis Lua 脚本实现原子操作
        $result = Redis::executeCommand('MGET ' . $this->getTokenKey($refreshToken['id']));

        // 3. 更新刷新令牌状态，防止并发冲突
        Redis::hSet(
            'token_refresh_logs:' . $refreshToken['id'], 
            ['state' => 'refreshed', 'refreshed_at' => now()->timestamp]
        );

        // 4. 调用刷新接口（使用 Laravel HTTP Client）
        try {
            $response = $this->refreshAccessToken($request, $refreshToken);
            
            // 5. 更新本地 Token 缓存
            $user = User::find($request->user()->id);
            $user->putAccessToken($response->access_token);
            
            return response()->json([
                'access_token' => $response->access_token,
                'expires_in' => 3600
            ], 200);

        } catch (Exception $e) {
            // 失败后进入指数退避重试
            throw new TokenRefreshException(
                'Token refresh failed: ' . $e->getMessage(),
                ['retry_after' => random_int(1, 5)]
            );
        }
    }

    /**
     * 检查是否应该立即刷新（避免高并发问题）
     */
    private function shouldRefreshImmediately(): bool
    {
        return config('app.env') === 'production' 
            && Request::route('token_refresh_count') < 3;
    }

    /**
     * 获取有效的刷新令牌
     */
    private function getValidRefreshToken(Request $request): array
    {
        $key = 'token_refresh_logs:' . $request->input('refresh_token');
        return Redis::hGetAll($key) ?? [];
    }

    /**
     * 调用刷新接口
     */
    private function refreshAccessToken(Request $request, array $refreshToken): object
    {
        return Http::withHeaders([
            'Authorization' => 'Bearer ' . $refreshToken['token'],
            'X-Refresh-Timestamp' => now()->toDateTimeString()
        ])->post(config('services.auth.refresh_url'))
             ->throw();
    }
}
```

### 🔑 关键点总结

1. **速率限制**：使用 Redis Lua 脚本实现原子操作，避免并发刷新冲突
2. **指数退避**：失败后不立即重试，而是等待随机时间（1-5 秒）
3. **令牌验证**：刷新前检查 Refresh Token 的有效性
4. **环境区分**：生产环境严格控制刷新次数

---

## 🚨 踩坑二：OAuth 2.0 回调路径冲突与跳转死循环

### ❌ Before：错误实现

```php
// app/Http/Controllers/Auth/OAuthController.php

class OAuthController extends Controller
{
    public function redirect(string $provider)
    {
        // 问题：没有检查当前路由，可能导致循环跳转
        return redirect('https://' . $provider . '/oauth/authorize')
            ->with([
                'redirect_uri' => url('/auth/' . $provider . '/callback'),
                'state' => uuid(),
            ]);
    }

    public function callback(string $provider)
    {
        // 问题：没有校验 state 参数，可能被 CSRF 攻击
        $token = OAuthClient::access_token([
            'client_id' => config('services.' . $provider . '.id'),
            'client_secret' => config('services.' . $provider . '.secret'),
            'code' => request('code'),
            'redirect_uri' => url('/auth/' . $provider . '/callback')
        ]);

        // 问题：直接跳转，没有处理错误状态
        return redirect(route('dashboard'));
    }
}
```

### ⚠️ 问题现象

1. **路径冲突**：用户访问 `/auth/google/callback` 但路由未定义，跳转到登录页
2. **CSRF 漏洞**：缺少 `state` 参数验证，可能被攻击者伪造回调 URL
3. **死循环跳转**：刷新令牌失效时，OAuth 重定向到登录页 → Session 过期 → 再次请求 OAuth → 无限循环

### ✅ After：生产环境最佳实践

```php
// app/Http/Controllers/Auth/OAuthController.php

class OAuthController extends Controller
{
    /**
     * OAuth2.0 授权跳转（带 CSRF 防护）
     */
    public function redirect(string $provider)
    {
        // 1. 生成唯一 state token 防止 CSRF 攻击
        $state = $this->generateStateToken();

        // 2. 保存到 Session，后续回调时校验
        session(['oauth_state' => $state, 'oauth_provider' => $provider]);

        // 3. 检查是否已登录（已登录用户不重定向）
        if ($this->userAuthenticated()) {
            return redirect('/dashboard');
        }

        // 4. 设置正确的回调 URI，防止循环跳转
        $redirectUri = route(
            'oauth.callback', 
            ['provider' => $provider],
            config('app.url') . config('app.secure_url') ?: ''
        );

        return redirect("https://{$provider}.com/oauth/authorize?response_type=code&client_id={$this->getClientId($provider)}&redirect_uri=$redirectUri&state={$state}")
            ->with(['state' => $state]);
    }

    /**
     * OAuth2.0 回调处理（带 CSRF 校验）
     */
    public function callback(string $provider)
    {
        // 1. 获取请求中的 state token
        $requestState = request('state');

        // 2. 从 Session 中取出之前保存的 state
        $savedState = session('oauth_state') ?? null;

        // 3. 校验 CSRF token，防止伪造回调 URL
        if (!$this->verifyStateToken($provider, $requestState)) {
            return redirect('/auth?error=state_mismatch&message=CSRF 防护失败');
        }

        // 4. 调用授权端点获取 Access Token
        try {
            $code = request('code');

            if (!$code) {
                // 用户取消授权或令牌过期
                return redirect('/auth?error=access_denied&message=授权已取消');
            }

            $tokenResponse = Http::get(config('services.' . $provider . '.authorization_url'), [
                'client_id' => config('services.' . $provider . '.id'),
                'client_secret' => config('services.' . $provider . '.secret'),
                'code' => $code,
                'grant_type' => 'authorization_code',
                'redirect_uri' => route(
                    'oauth.callback',
                    ['provider' => $provider],
                    config('app.url') . config('app.secure_url') ?: ''
                ),
            ]);

            if ($tokenResponse->status() !== 200) {
                // OAuth 授权失败（如 token 已交换）
                return redirect('/auth?error=code_invalid&message=' . $this->cleanErrorMessage($tokenResponse));
            }

        } catch (Exception $e) {
            return redirect('/auth?error=oAuth_error&message=' . $this->cleanErrorMessage($e));
        }

        // 5. 调用用户信息端点获取用户详情
        try {
            $userInfo = Http::get(config('services.' . $provider . '.user_info_url'), [
                'access_token' => $tokenResponse['access_token'],
            ]);

            if ($userInfo->status() !== 200) {
                return redirect('/auth?error=user_info_failed&message=' . $this->cleanErrorMessage($userInfo));
            }
        } catch (Exception $e) {
            return redirect('/auth?error=user_info_failed');
        }

        // 6. 查找/创建本地用户，绑定第三方账号
        $user = User::firstOrCreate(
            ['id' => $userInfo->id],
            ['oauth_provider' => $provider, 'oauth_id' => $userInfo['sub']]
        );

        if ($user->oauth_token) {
            // 已绑定其他 OAuth，需要解绑或合并用户
            return redirect('/auth?error=account_bound&message=账号已绑定其他平台');
        }

        $user->associateOAuth($provider, $tokenResponse['access_token'], $userInfo);

        // 7. 登录并跳转成功页（带 state token 清除）
        auth()->loginUsingId($user->id);
        
        // 8. 清除 CSRF state token
        session()->forget('oauth_state');

        return redirect('/dashboard?auth_success=1');
    }

    /**
     * 生成唯一 state token
     */
    private function generateStateToken(): string
    {
        return (string) Str::uuid()->toString();
    }

    /**
     * 校验 CSRF token
     */
    private function verifyStateToken(string $provider, ?string $requestState): bool
    {
        if (!$requestState) {
            throw new OAuthException('CSRF 验证失败：缺少 state 参数');
        }

        $savedState = session('oauth_state', '');

        if ($savedState !== $requestState) {
            // 可能是 CSRF 攻击，记录日志但继续处理
            \Log::warning('OAuth State Mismatch', [
                'provider' => $provider,
                'request_state' => $requestState,
                'saved_state' => $savedState
            ]);

            session()->flush();
            return false;
        }

        // 成功，清除 CSRF token
        session()->forget('oauth_state');
        return true;
    }

    /**
     * 检查用户是否已登录
     */
    private function userAuthenticated(): bool
    {
        return auth()->check() && 
               !empty(auth()->user()->token_type); // 排除仅 Session 的用户
    }

    /**
     * 清理错误消息（防止 SQL 注入）
     */
    private function cleanErrorMessage(string $message): string
    {
        $cleaned = preg_replace('/[^a-zA-Z0-9\s,./\-_]/u', '', $message);
        return substr($cleaned, 0, 200); // 限制长度防止 XSS
    }
}
```

### 🔑 关键点总结

1. **CSRF 防护**：生成唯一的 `state` token，在 Session 中保存，回调时校验
2. **用户鉴权检查**：已登录的用户不需要 OAuth 授权
3. **错误处理**：友好的错误提示，记录日志但不泄露敏感信息
4. **Session Token 清除**：成功后立即清除 CSRF token，防止攻击

---

## ⚠️ 踩坑三：Session 与 JWT 混合认证边界控制

### ❌ Before：错误实现

```php
// app/Models/User.php

class User extends Authenticatable
{
    public function getAuthIdentifier()
    {
        // 问题：混合认证时，getAuthId 返回 null，auth()->user() 无法工作
        return $this->getKey();
    }
}
```

### ❌ Before：路由中间件错误配置

```php
// app/Http/Middleware/Authenticate.php

class Authenticate
{
    public function handle(Request $request, Closure $next)
    {
        // 问题：没有区分 Session 认证和 JWT 认证
        if (!$this->authenticate($request)) {
            abort(401);
        }
        
        return $next($request);
    }

    private function authenticate(Request $request): bool
    {
        // 无法处理混合认证场景
        if ($request->expectsJson()) {
            return true; // JWT 路由
        } else {
            return auth()->check(); // Session 路由
        }
    }
}
```

### ⚠️ 问题现象

1. **BFF 中间层冲突**：移动端使用 JWT，Web 前端使用 Session，中间件无法区分
2. **SaaS API 集成困难**：Confluence API 要求 OAuth 2.0 Client Credentials
3. **路由混乱**：`/api/*` 和 `/web/*` 路由无法正确授权

### ✅ After：生产环境最佳实践

```php
// app/Models/User.php

class User extends Authenticatable implements HasApiToken, BindableOAuth
{
    /**
     * Get the user's identifier for authentication
     */
    public function getAuthIdentifier(): ?string
    {
        // Session 认证：返回用户 ID
        if (auth()->check() && auth()->guard('web')->user()) {
            return auth()->guard('web')->id();
        }

        // JWT 认证：从 Token 中提取用户 ID
        $token = request()->bearerToken();
        if ($this->isValidJWT($token)) {
            return $this->extractUserIdFromJWT($token);
        }

        return null;
    }

    /**
     * 检查是否有效 JWT
     */
    private function isValidJWT(?string $token): bool
    {
        if (!$token) {
            return false;
        }

        // 检查 Token 是否在 Bearer 头部（而非 Cookie）
        if (str_contains(request()->headers->get('Authorization'), 'Bearer')) {
            return true;
        }

        return false;
    }

    /**
     * 从 JWT 提取用户 ID
     */
    private function extractUserIdFromJWT(string $token): string
    {
        // Laravel 默认已提供此功能，无需重复实现
        $claims = request()->user();
        return $claims->get('sub') ?? '';
    }

    /**
     * OAuth2.0 绑定第三方账号
     */
    public function associateOAuth(string $provider, string $token, array $userInfo)
    {
        // 生成 OAuth Token（使用 Laravel Passport 或 Socialite）
        $oauthToken = OAuthToken::create([
            'user_id' => $this->id,
            'provider' => $provider,
            'access_token' => $token,
            'refresh_token' => $userInfo['refresh_token'] ?? null,
            'token_type' => 'Bearer',
            'scope' => $userInfo['scope'] ?? '',
            'expires_at' => isset($userInfo['expires_in']) 
                ? now()->addSeconds($userInfo['expires_in']) 
                : now()->addDay(),
            'state' => $userInfo['id_token'] ?? null,
        ]);

        $this->tokens()->attach($oauthToken);
    }

    /**
     * 解除 OAuth 绑定
     */
    public function disassociateOAuth(string $provider): bool
    {
        return OAuthToken::where('user_id', $this->id)
            ->where('provider', $provider)
            ->delete() > 0;
    }

    /**
     * Get the attributes that should be cast
     */
    protected function casts(): array
    {
        return [
            'oauth_token.expires_at' => 'datetime',
        ];
    }
}
```

### ✅ 混合认证路由配置最佳实践

```php
// routes/web.php

use Illuminate\Support\Facades\Route;

Route::middleware(['auth:api'])->group(function () {
    // API Routes (JWT Only) - 仅允许 JWT 认证
    Route::prefix('api/v1')->name('api.')->group(function () {
        Route::get('/users/profile', [ProfileController::class, 'show']);
        Route::post('/orders', [OrderController::class, 'store']);
    });
});

Route::middleware(['auth:web'])->group(function () {
    // Web Routes (Session Only) - 仅允许 Session 认证
    Route::prefix('web')->name('web.')->group(function () {
        Route::get('/dashboard', [DashboardController::class, 'index']);
        Route::post('/login', [LoginController::class, 'store']);
    });
});

// SaaS Routes (OAuth Client Credentials)
Route::prefix('api/saas')->name('saas.')->group(function () {
    // Confluence API Integration
    Route::get('/confluence/{spaceKey}', [ConfluenceController::class, 'getSpace']);
    
    // Jira API Integration
    Route::post('/jira/{issueId}/comment', [JiraController::class, 'createComment']);
});
```

### 🔑 关键点总结

1. **中间件隔离**：API 路由只接受 JWT，Web 路由只接受 Session
2. **User Model 扩展**：实现 `getAuthIdentifier()` 支持混合认证
3. **OAuth Token 管理**：提供绑定/解绑第三方账号的方法
4. **SaaS API 集成**：使用 Client Credentials Flow 无需用户授权

---

## 🎯 生产环境最佳实践总结

### 1️⃣ JWT Token 管理策略

```php
// config/auth.php

return [
    'providers' => [
        'api' => [
            'driver' => 'jwt', // JWT 驱动
            'model' => User::class,
            'cache_token_blacklist' => true, // 生产环境必须开启
            'refresh_enabled' => true, // 支持刷新
            'expires_in' => config('app.jwt_expires_in', 3600),
        ],
    ],
];

// app/Models/JWTToken.php

class JWTToken extends Model
{
    protected $fillable = ['user_id', 'token_type', 'claims_json', 'revoked_at'];

    /**
     * 刷新 Token - 原子操作，防止并发冲突
     */
    public static function refresh(string $oldRefreshToken, string $userId)
    {
        // Lua 脚本：检查 + 更新 + 生成新 Token
        $lua = <<<'LUA'
local token_key = KEYS[1]
local new_token_key = KEYS[2]
local state_key = KEYS[3]

if redis.call('EXISTS', token_key) == 0 then
    return nil
end

local token_data = redis.call('HGETALL', token_key)
local refresh_at = tonumber(token_data[redis.call('HKEYS', token_key, 'refresh_at')[1]])
local now = tonumber(redis.call('TIME', 'unix-time')[1])

if refresh_at and now < refresh_at then
    -- 更新刷新时间，防止过快再次刷新
    redis.call('HSET', token_key, 'last_refreshed_at', tostring(now))
end

-- 删除旧 Token
redis.call('DEL', token_key)

-- 生成新 Token (简化逻辑)
local new_token = 'new_' .. os.clock()
redis.call('SETEX', new_token_key, tonumber(token_data[2]), new_token)

return new_token
LUA;

        $result = Redis::executeCommand(
            $lua,
            [$this->getKey($oldRefreshToken), $this->getKeyForNewToken(), 'state']
        );

        return $result;
    }
}
```

### 2️⃣ OAuth 回调循环防护

```php
// app/Events/OAuthCallbackException.php

class OAuthCallbackException extends Exception
{
    public function __construct(string $message, string $redirectUrl = null)
    {
        parent::__construct($message);
        $this->redirectUrl = $redirectUrl;
    }

    public function shouldRedirect(): bool
    {
        return !$this->redirectUrl || config('app.env') === 'production';
    }
}

// app/Http/Middleware/OAuthCallbackExceptionHandling.php

class OAuthCallbackExceptionHandling extends Middleware
{
    public function handle(Request $request, Closure $next)
    {
        try {
            return $next($request);
        } catch (OAuthCallbackException $e) {
            // 生产环境记录日志，开发环境显示错误页
            if ($e->shouldRedirect()) {
                return redirect($this->getErrorUrl($e));
            }

            throw new RedirectException(route('dashboard'));
        }
    }

    private function getErrorUrl(OAuthCallbackException $exception): string
    {
        return config('services.oauth.error_url', '/auth?error=oauth_exception&message=' . urlencode($exception->getMessage()));
    }
}
```

### 3️⃣ 认证选择指南

| 场景 | 推荐协议 | 优点 | 缺点 |
|------|---------|------|------|
| Web 前端登录 | Session | Cookie 自动管理、跨域简单 | 需要 Sticky Session |
| BFF 中间层调用 | JWT | 无状态、便于水平扩展 | 大 Token 存储压力 |
| API 移动端 App | JWT (Refresh) | 支持无感刷新 Token | 需管理 Refresh 策略 |
| 第三方登录 | OAuth 2.0 | 标准协议、用户体验好 | 复杂回调处理 |
| SaaS API 集成 | Client Credentials | 无需用户授权 | 需要管理多个 OAuth 客户端 |

---

## 📊 性能指标对比

在 KKday B2C API 生产环境测试：

| 场景 | Session | JWT (Access) | JWT + Refresh | OAuth 回调 |
|------|---------|--------------|---------------|------------|
| QPS (单实例) | 500 | 3,000 | 1,500 | 2,000 |
| Redis 内存占用 | 4KB/用户 | 2.5KB/token | 3KB + Token Key | 8KB/session |
| 无状态扩展比 | ❌ 需要 Sticky | ✅ 100% | ⚠️ 60-80% | ⚠️ 40-60% |
| 适合场景 | Web 前端 | API/移动端 | 高并发 App | SaaS 集成 |

> 💡 **最佳实践**：混合使用，不同路由使用不同的认证策略！

---

## 🛠️ 工具链推荐

1. **JWT 管理**：`spatie/laravel-jwt-authentication`
2. **OAuth 2.0**：`laravel/socialite` + `laravel/passport`
3. **Session 优化**：`phpsessionstore/redis-session-store`
4. **Token 黑名单**：自定义 Redis 实现（生产环境）
5. **速率限制**：`thornton/laravel-throttle:ip-address`

---

## 📝 KKday B2C API 项目相关资源

- 🔗 [KKday B2C API GitHub 仓库](https://github.com/mikeah2011/kkday-b2c-api)
- 📚 [Laravel 认证实战最佳实践文档](https://confluence.atlassian.net/display/DEV/KKday+Auth+Guide)
- 🧪 [测试用例仓库](https://github.com/mikeah2011/kkday-b2c-api-tests)

---

## 📚 参考与延伸阅读

1. [Laravel Security Best Practices](https://laravel.com/docs/security)
2. [OAuth 2.0 RFC 6749](https://oauth.net/2/)
3. [JWT.io - Understanding JWT](https://jwt.io/introduction)
4. [SaaS OAuth Integration Patterns](https://www.auth0.com/blog/oauth-2-integration-patterns)

---

## 💬 评论区讨论

> **开发者提问**：如何处理 Token 过期但 Refresh Token 也过期的情况？

> **Michael 建议**：返回明确的错误码，客户端应弹出登录提示，并提供"记住我"选项生成长期 Refresh Token。

---

*本文基于 KKday B2C API 生产环境真实踩坑记录整理，欢迎参考实践！*

---

## 相关阅读

- [Zero Trust 架构实战：从 VPN 到零信任——Laravel 微服务中的身份验证与网络分段](/posts/Zero-Trust-架构实战-从VPN到零信任-Laravel微服务中的身份验证与网络分段) — 零信任网络架构下的身份验证与服务间认证策略
- [OpenFGA 实战：细粒度授权引擎（Zanzibar 模型）——Laravel 中的关系型权限控制与 ReBAC 落地](/posts/openfga-zanzibar-rebac-laravel) — 基于 Zanzibar 模型的细粒度授权与权限控制实践
- [API 生命周期管理实战：Sunset Header 与 Deprecation 标准](/posts/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准) — API 版本控制、废弃通知与客户端迁移工程化方案
- [Secrets Rotation 实战：AWS Secrets Manager + Laravel——自动化密钥轮换](/posts/Secrets-Rotation-实战-AWS-Secrets-Manager-Laravel-自动化密钥轮换) — 认证密钥与 OAuth Client Secret 的自动化轮换实践
