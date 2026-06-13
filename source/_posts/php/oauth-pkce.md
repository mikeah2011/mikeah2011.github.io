---

title: OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南——PKCE 强制、隐式流废弃与安全加固
keywords: [OAuth, PKCE, 的迁移指南, 强制, 隐式流废弃与安全加固]
date: 2026-06-02 12:00:00
tags:
- OAuth
- PKCE
- 安全
- Laravel
- api认证
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 本文深度解析OAuth 2.1核心变化，包括PKCE强制化、隐式流废弃、Refresh Token Rotation和重定向URI精确匹配四大安全增强。提供Laravel Passport从2.0到2.1的完整迁移路径，涵盖代码实现、中间件配置、前后端集成和Pest测试用例。同时对比Sanctum与Passport的适用场景，给出Token有效期策略、Scope最小权限设计和异常检测的最佳实践，帮助开发者构建符合最新安全标准的认证系统。
---





# OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南——PKCE 强制、隐式流废弃与安全加固

## 前言

OAuth 2.0 自 2012 年发布以来，已经成为互联网身份认证和授权的事实标准。然而，十多年的实践也暴露了原始规范中的诸多安全漏洞：隐式流（Implicit Grant）的 Token 泄露、授权码拦截攻击、重定向 URI 配置不当导致的开放重定向漏洞……这些安全问题催生了大量的 BCP（Best Current Practice）文档和补充规范。

OAuth 2.1 正是将这些安全最佳实践整合为一个统一规范的努力。它不是一次革命性的重写，而是一次务实的"安全加固"——将过去十年中被证明有效的安全措施提升为强制要求。

本文将深入解析 OAuth 2.1 的核心变化，提供从 OAuth 2.0 到 2.1 的完整迁移路径，并展示在 Laravel 项目中如何实现这些安全增强。

---

## 一、OAuth 2.0 vs 2.1：到底变了什么？

### 1.1 变化总览

| 变化项 | OAuth 2.0 | OAuth 2.1 |
|--------|-----------|-----------|
| 授权码流 PKCE | 可选（仅公开客户端推荐） | **强制所有客户端** |
| 隐式流（Implicit Grant） | 支持 | **完全移除** |
| 资源所有者密码模式 | 支持 | **完全移除** |
| Refresh Token | 无特殊要求 | **必须一次性使用（Rotation）** |
| 重定向 URI | 精确匹配推荐 | **精确匹配强制** |
| Bearer Token in URI | 允许 | **禁止** |
| 客户端认证 | 可选 | **机密客户端强制** |

### 1.2 为什么做这些改变？

**隐式流的移除**：
隐式流最初设计用于纯前端 SPA 应用（无法安全存储客户端密钥）。但实践证明，Token 通过 URL Fragment 传递的方式存在严重的安全风险：
- Token 会出现在浏览器历史记录中
- Token 会通过 Referer 头泄露给第三方
- Token 可能被恶意 JavaScript 截获

现代替代方案是 **授权码 + PKCE**，它既安全又适用于所有客户端类型。

**Resource Owner Password Credentials 的移除**：
这个模式要求用户直接向客户端提供密码，从根本上违背了 OAuth 的设计哲学（用户不应将密码交给第三方应用）。现代替代方案是 **授权码流 + 系统浏览器**。

**PKCE 强制化**：
PKCE（Proof Key for Code Exchange，发音"pixy"）最初为移动应用设计，用于防止授权码拦截攻击。研究证明，即使是机密客户端（有客户端密钥的后端应用），PKCE 也能提供额外的安全层。

---

## 二、PKCE 深度解析

### 2.1 PKCE 工作原理

PKCE 的核心思想是：客户端在发起授权请求时生成一个随机的 `code_verifier`，并将其 SHA-256 哈希值 `code_challenge` 随请求发送。在用授权码换取 Token 时，客户端必须提供原始的 `code_verifier`，服务端验证其哈希值是否匹配。

```
客户端                              授权服务器
  |                                    |
  |-- 1. 生成 code_verifier           |
  |   计算 code_challenge              |
  |   = SHA256(code_verifier)          |
  |                                    |
  |-- 2. 授权请求 + code_challenge -->|
  |                                    |
  |<-- 3. 授权码 ---------------------|
  |                                    |
  |-- 4. Token 请求                   |
  |   + code + code_verifier -------->|
  |                                    |
  |   验证 SHA256(code_verifier)       |
  |   == code_challenge ?              |
  |                                    |
  |<-- 5. Access Token ---------------|
```

### 2.2 为什么 PKCE 能防止授权码拦截？

假设攻击者拦截了步骤 3 中的授权码：
- 攻击者有授权码，但没有 `code_verifier`
- 攻击者无法计算出原始的 `code_verifier`（SHA-256 不可逆）
- 因此攻击者无法在步骤 4 中通过验证

即使授权码通过不安全的通道（如 HTTP 重定向）泄露，PKCE 也能保证安全。

### 2.3 code_verifier 生成规范

根据 RFC 7636，`code_verifier` 必须满足：
- 最小长度：43 个字符
- 最大长度：128 个字符
- 字符集：[A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"

```php
// PHP 生成 code_verifier
$codeVerifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');

// 计算 code_challenge (S256)
$codeChallenge = rtrim(strtr(base64_encode(hash('sha256', $codeVerifier, true)), '+/', '-_'), '=');
```

---

## 三、Laravel Passport 迁移到 OAuth 2.1

### 3.1 现状分析

Laravel Passport 默认支持：
- ✅ 授权码流（Authorization Code Grant）
- ✅ 客户端凭证流（Client Credentials Grant）
- ⚠️ 隐式流（需要禁用）
- ⚠️ 密码模式（需要禁用）
- ⚠️ PKCE（需要启用）

### 3.2 禁用不安全的 Grant 类型

```php
// app/Providers/AuthServiceProvider.php
use Laravel\Passport\Passport;

public function boot()
{
    // 禁用隐式流
    Passport::disableImplicitGrant();
    
    // 注意：Passport 默认不启用密码模式
    // 如果之前启用了，需要移除
    
    // 启用 PKCE
    Passport::enableCodeGrantType();
}
```

### 3.3 配置 PKCE 支持

Laravel Passport 从 v10 开始原生支持 PKCE。在 `config/passport.php` 中：

```php
// config/passport.php
return [
    // 启用 PKCE
    'enable_pkce' => true,
    
    // 强制 PKCE（OAuth 2.1 要求）
    'force_pkce' => true,
    
    // Access Token 有效期
    'access_token_expires_in' => DateInterval::createFromDateString('1 hour'),
    
    // Refresh Token 有效期
    'refresh_token_expires_in' => DateInterval::createFromDateString('7 days'),
];
```

### 3.4 创建支持 PKCE 的客户端

```bash
# 创建 PKCE 客户端（无需客户端密钥）
php artisan passport:client --public --name="Mobile App" --redirect_uri="com.myapp://callback"

# 创建机密客户端（同时支持 PKCE）
php artisan passport:client --name="Web App" --redirect_uri="https://myapp.com/callback"
```

### 3.5 授权码 + PKCE 流程实现

**第一步：生成授权请求**

```php
// app/Http/Controllers/Auth/OAuthController.php
namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class OAuthController extends Controller
{
    public function authorize(Request $request)
    {
        // 生成 code_verifier
        $codeVerifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        
        // 计算 code_challenge
        $codeChallenge = rtrim(strtr(base64_encode(
            hash('sha256', $codeVerifier, true)
        ), '+/', '-_'), '=');
        
        // 存储到 session
        session(['oauth_code_verifier' => $codeVerifier]);
        
        // 构建授权 URL
        $params = http_build_query([
            'response_type' => 'code',
            'client_id' => config('services.oauth.client_id'),
            'redirect_uri' => config('services.oauth.redirect_uri'),
            'scope' => 'profile email',
            'state' => $state = Str::random(40),
            'code_challenge' => $codeChallenge,
            'code_challenge_method' => 'S256',
        ]);
        
        session(['oauth_state' => $state]);
        
        return redirect(config('services.oauth.authorize_url') . '?' . $params);
    }
}
```

**第二步：处理回调并交换 Token**

```php
public function callback(Request $request)
{
    // 验证 state
    if ($request->input('state') !== session('oauth_state')) {
        abort(403, 'Invalid state parameter');
    }
    
    // 获取 code_verifier
    $codeVerifier = session('oauth_code_verifier');
    
    // 用授权码 + code_verifier 换取 Token
    $response = Http::post(config('services.oauth.token_url'), [
        'grant_type' => 'authorization_code',
        'client_id' => config('services.oauth.client_id'),
        'client_secret' => config('services.oauth.client_secret'), // 机密客户端需要
        'code' => $request->input('code'),
        'redirect_uri' => config('services.oauth.redirect_uri'),
        'code_verifier' => $codeVerifier,
    ]);
    
    $tokenData = $response->json();
    
    // 存储 Token
    session([
        'access_token' => $tokenData['access_token'],
        'refresh_token' => $tokenData['refresh_token'],
        'token_expires_at' => now()->addSeconds($tokenData['expires_in']),
    ]);
    
    // 清理临时数据
    session()->forget(['oauth_code_verifier', 'oauth_state']);
    
    return redirect('/dashboard');
}
```

---

## 四、Refresh Token Rotation

### 4.1 为什么需要 Rotation？

OAuth 2.1 要求 Refresh Token 必须一次性使用（Rotation）。这意味着每次用 Refresh Token 获取新的 Access Token 时，旧的 Refresh Token 会立即失效，并返回一个新的 Refresh Token。

这可以防止 Refresh Token 泄露后的长期滥用：
- 攻击者获取了 Refresh Token
- 攻击者尝试使用它
- 合法用户也在使用它
- 服务端检测到同一个 Refresh Token 被使用了两次
- 服务端撤销该用户的所有 Token

### 4.2 Laravel Passport 中的实现

```php
// config/passport.php
return [
    // 启用 Refresh Token Rotation
    'refresh_token_expires_in' => DateInterval::createFromDateString('7 days'),
];
```

Passport 默认支持 Refresh Token Rotation。每次刷新时：

```php
public function refreshToken(Request $request)
{
    $response = Http::post(config('app.url') . '/oauth/token', [
        'grant_type' => 'refresh_token',
        'refresh_token' => session('refresh_token'),
        'client_id' => config('services.oauth.client_id'),
        'client_secret' => config('services.oauth.client_secret'),
        'scope' => '',
    ]);
    
    $tokenData = $response->json();
    
    // 更新 Token（旧的 Refresh Token 已经失效）
    session([
        'access_token' => $tokenData['access_token'],
        'refresh_token' => $tokenData['refresh_token'], // 新的 Refresh Token
        'token_expires_at' => now()->addSeconds($tokenData['expires_in']),
    ]);
    
    return response()->json(['status' => 'refreshed']);
}
```

### 4.3 Refresh Token Reuse Detection

当检测到 Refresh Token 被重复使用时，应该撤销该用户的所有 Token：

```php
// app/Providers/AuthServiceProvider.php
use Laravel\Passport\TokenRepository;
use Laravel\Passport\RefreshTokenRepository;

public function boot()
{
    // 监听 Refresh Token 重复使用事件
    // Passport 内置了这个机制
}
```

在 Passport 中，当检测到 Refresh Token 重用时，会自动撤销相关的 Token 系列。但你也可以自定义这个行为：

```php
// app/Http/Middleware/DetectRefreshTokenReuse.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Laravel\Passport\RefreshTokenRepository;

class DetectRefreshTokenReuse
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);
        
        // 如果 Token 刷新失败且原因是 refresh_token 已使用
        if ($response->status() === 401 && 
            str_contains($response->getContent(), 'refresh_token')) {
            
            // 撤销该用户的所有 Token
            // 这是一个安全措施，防止泄露的 Refresh Token 被滥用
            
            \Log::security('Refresh token reuse detected', [
                'user_id' => auth()->id(),
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);
        }
        
        return $response;
    }
}
```

---

## 五、重定向 URI 精确匹配

### 5.1 OAuth 2.0 的问题

OAuth 2.0 允许重定向 URI 的部分匹配（如允许子路径），这可能导致开放重定向攻击：

```
注册的重定向 URI: https://myapp.com/callback
攻击者构造: https://myapp.com/callback/../evil.com
```

### 5.2 OAuth 2.1 的要求

OAuth 2.1 强制要求 **精确字符串匹配**：
- 不允许通配符
- 不允许子路径匹配
- 不允许端口变化
- 查询参数可以不同（但路径必须完全匹配）

### 5.3 Laravel 中的实现

```php
// app/Models/Client.php (Passport Client)
// 在创建客户端时，精确指定允许的重定向 URI

// 不允许的写法（通配符）
// redirect_uri: https://myapp.com/*

// 正确的写法（精确匹配）
// redirect_uri: https://myapp.com/auth/callback
```

在验证重定向 URI 时：

```php
// app/Http/Controllers/Auth/OAuthController.php
public function authorize(Request $request)
{
    $redirectUri = $request->input('redirect_uri');
    $client = $this->getClient($request->input('client_id'));
    
    // 精确匹配验证
    if (!in_array($redirectUri, $client->redirect_uris, true)) {
        abort(400, 'Invalid redirect_uri');
    }
    
    // 继续授权流程...
}
```

### 5.4 多环境重定向 URI 管理

```php
// config/services.php
return [
    'oauth' => [
        'redirect_uris' => [
            'production' => 'https://myapp.com/auth/callback',
            'staging' => 'https://staging.myapp.com/auth/callback',
            'local' => 'http://localhost:8000/auth/callback',
        ],
        'redirect_uri' => env('OAUTH_REDIRECT_URI', 
            'https://myapp.com/auth/callback'
        ),
    ],
];
```

---

## 六、Bearer Token 安全使用

### 6.1 禁止在 URI 中传递 Token

OAuth 2.1 明确禁止在 URI 查询参数中传递 Bearer Token：

```
# 不允许
GET /api/user?access_token=YOUR_TOKEN

# 正确方式
GET /api/user
Authorization: Bearer xxx
```

**原因**：URI 会出现在服务器日志、浏览器历史记录、Referer 头中，导致 Token 泄露。

### 6.2 Laravel 中的实现

Laravel Passport 默认通过 Authorization Header 接收 Token，但需要确保没有其他途径泄露 Token：

```php
// app/Http/Middleware/RejectTokenInUri.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class RejectTokenInUri
{
    public function handle(Request $request, Closure $next)
    {
        // 拒绝 URI 中的 Token
        if ($request->query('access_token') || 
            $request->query('token')) {
            
            \Log::security('Token detected in URI', [
                'url' => $request->url(),
                'ip' => $request->ip(),
            ]);
            
            return response()->json([
                'error' => 'invalid_request',
                'error_description' => 'Access token must not be passed in URI query parameters per OAuth 2.1',
            ], 400);
        }
        
        return $next($request);
    }
}
```

注册中间件：

```php
// bootstrap/app.php (Laravel 11+)
->withMiddleware(function (Middleware $middleware) {
    $middleware->api(append: [
        \App\Http\Middleware\RejectTokenInUri::class,
    ]);
})
```

---

## 七、Sanctum 迁移到 OAuth 2.1

### 7.1 Sanctum vs Passport

| 特性 | Sanctum | Passport |
|------|---------|----------|
| 认证方式 | API Token / SPA Cookie | OAuth 2.0/2.1 |
| Token 存储 | 数据库 | 数据库 |
| PKCE 支持 | ✅ (SPA) | ✅ (完整) |
| 第三方应用 | ❌ | ✅ |
| Scope 支持 | 有限 | 完整 |
| 复杂度 | 低 | 高 |

### 7.2 Sanctum SPA 认证的 OAuth 2.1 兼容

Sanctum 的 SPA 认证模式天然支持 PKCE（通过 Cookie + CSRF），但如果你使用 API Token 模式，需要注意：

```php
// config/sanctum.php
return [
    // Token 有效期
    'expiration' => 60, // 分钟
    
    // 启用 Token 轮换（类似 Refresh Token Rotation）
    // 需要自定义实现
];
```

### 7.3 从 Sanctum Token 迁移到 OAuth 2.1

如果你的 API 目前使用 Sanctum Token 认证，可以逐步迁移到 OAuth 2.1：

```php
// 支持两种认证方式的中间件
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class FlexibleAuth
{
    public function handle(Request $request, Closure $next)
    {
        // 尝试 Sanctum Token
        if ($request->bearerToken()) {
            $user = auth('sanctum')->user();
            if ($user) {
                auth()->setUser($user);
                return $next($request);
            }
        }
        
        // 尝试 OAuth Token
        if ($request->bearerToken()) {
            $user = auth('passport')->user();
            if ($user) {
                auth()->setUser($user);
                return $next($request);
            }
        }
        
        return response()->json(['error' => 'Unauthenticated'], 401);
    }
}
```

---

## 八、安全加固最佳实践

### 8.1 Token 有效期策略

```php
// config/passport.php
return [
    // 短期 Access Token（OAuth 2.1 推荐）
    'access_token_expires_in' => DateInterval::createFromDateString('15 minutes'),
    
    // 中期 Refresh Token
    'refresh_token_expires_in' => DateInterval::createFromDateString('7 days'),
    
    // 长期 Auth Code（必须短）
    'authorization_code_expires_in' => DateInterval::createFromDateString('10 minutes'),
];
```

### 8.2 Scope 最小权限原则

```php
// 定义精细的 Scope
Passport::tokensCan([
    'read:profile' => 'Read user profile',
    'write:profile' => 'Update user profile',
    'read:orders' => 'Read order history',
    'write:orders' => 'Create orders',
    'admin' => 'Full administrative access',
]);

// 在授权请求中只请求需要的 Scope
$scope = 'read:profile read:orders'; // 不要请求 'admin'
```

### 8.3 Token 撤销机制

```php
// app/Http/Controllers/Auth/TokenController.php

// 撤销单个 Token
public function revoke(Request $request)
{
    $token = $request->user()->token();
    $token->revoke();
    
    return response()->json(['message' => 'Token revoked']);
}

// 撤销所有 Token（密码修改后）
public function revokeAll(Request $request)
{
    $request->user()->tokens()->each(function ($token) {
        $token->revoke();
    });
    
    return response()->json(['message' => 'All tokens revoked']);
}
```

### 8.4 异常检测

```php
// app/Http/Middleware/OAuthSecurityMonitor.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class OAuthSecurityMonitor
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);
        
        // 监控异常行为
        if ($response->status() === 401) {
            \Log::warning('OAuth authentication failure', [
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'path' => $request->path(),
                'token_present' => $request->bearerToken() !== null,
            ]);
        }
        
        // 监控异常的 Token 使用模式
        if ($request->bearerToken()) {
            $token = $request->user()?->currentAccessToken();
            if ($token) {
                $usageCount = cache()->increment(
                    'token_usage:' . $token->id . ':' . now()->format('YmdH')
                );
                
                // 单小时使用超过 1000 次，可能是异常
                if ($usageCount > 1000) {
                    \Log::security('Unusual token usage pattern', [
                        'token_id' => $token->id,
                        'usage_count' => $usageCount,
                        'ip' => $request->ip(),
                    ]);
                }
            }
        }
        
        return $response;
    }
}
```

---

## 九、前端集成

### 9.1 Vue/React SPA + PKCE

```javascript
// src/auth/oauth.js

// 生成 code_verifier
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

// 计算 code_challenge
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// 发起授权请求
export async function login() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomState();
  
  // 存储到 sessionStorage
  sessionStorage.setItem('code_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', state);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
    redirect_uri: import.meta.env.VITE_OAUTH_REDIRECT_URI,
    scope: 'profile email',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  window.location.href = `${import.meta.env.VITE_OAUTH_AUTH_URL}?${params}`;
}

// 处理回调
export async function handleCallback(code, state) {
  // 验证 state
  if (state !== sessionStorage.getItem('oauth_state')) {
    throw new Error('Invalid state parameter');
  }
  
  const codeVerifier = sessionStorage.getItem('code_verifier');
  
  const response = await fetch(import.meta.env.VITE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
      code: code,
      redirect_uri: import.meta.env.VITE_OAUTH_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  
  const data = await response.json();
  
  // 清理临时数据
  sessionStorage.removeItem('code_verifier');
  sessionStorage.removeItem('oauth_state');
  
  // 存储 Token（建议使用 httpOnly Cookie，这里用 localStorage 仅为演示）
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  
  return data;
}
```

### 9.2 自动刷新 Token

```javascript
// src/auth/tokenManager.js

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

export async function fetchWithAuth(url, options = {}) {
  let accessToken = localStorage.getItem('access_token');
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  // Token 过期，尝试刷新
  if (response.status === 401) {
    if (isRefreshing) {
      // 等待刷新完成
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then(token => {
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
          },
        });
      });
    }
    
    isRefreshing = true;
    
    try {
      const newToken = await refreshAccessToken();
      processQueue(null, newToken);
      
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${newToken}`,
        },
      });
    } catch (error) {
      processQueue(error, null);
      throw error;
    } finally {
      isRefreshing = false;
    }
  }
  
  return response;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refresh_token');
  
  const response = await fetch(import.meta.env.VITE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
    }),
  });
  
  if (!response.ok) {
    // Refresh Token 也失效了，需要重新登录
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
    throw new Error('Refresh token expired');
  }
  
  const data = await response.json();
  
  // 更新 Token（新的 Refresh Token，旧的已失效）
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  
  return data.access_token;
}
```

---

## 十、测试 OAuth 2.1 流程

### 10.1 Pest 测试

```php
// tests/Feature/OAuth/PKCE授权码流测试.php
use Illuminate\Support\Str;

it('支持 PKCE 授权码流', function () {
    // 1. 创建客户端
    $client = \Laravel\Passport\Client::create([
        'name' => 'Test PKCE Client',
        'redirect' => 'https://example.com/callback',
        'personal_access_client' => false,
        'password_client' => false,
        'revoked' => false,
    ]);
    
    // 2. 生成 code_verifier 和 code_challenge
    $codeVerifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $codeChallenge = rtrim(strtr(base64_encode(
        hash('sha256', $codeVerifier, true)
    ), '+/', '-_'), '=');
    
    // 3. 发起授权请求
    $state = Str::random(40);
    $response = $this->get('/oauth/authorize?' . http_build_query([
        'response_type' => 'code',
        'client_id' => $client->id,
        'redirect_uri' => $client->redirect,
        'scope' => '',
        'state' => $state,
        'code_challenge' => $codeChallenge,
        'code_challenge_method' => 'S256',
    ]));
    
    // 4. 确认授权
    $response = $this->actingAs($this->user)->post('/oauth/authorize', [
        'state' => $state,
    ]);
    
    // 5. 获取授权码
    $redirectUrl = $response->headers->get('Location');
    $params = [];
    parse_str(parse_url($redirectUrl, PHP_URL_QUERY), $params);
    $code = $params['code'];
    
    // 6. 用授权码 + code_verifier 换取 Token
    $response = $this->post('/oauth/token', [
        'grant_type' => 'authorization_code',
        'client_id' => $client->id,
        'client_secret' => $client->secret,
        'code' => $code,
        'redirect_uri' => $client->redirect,
        'code_verifier' => $codeVerifier,
    ]);
    
    $response->assertOk();
    $response->assertJsonStructure([
        'token_type',
        'expires_in',
        'access_token',
        'refresh_token',
    ]);
});

it('拒绝无效的 code_verifier', function () {
    // 类似上面的流程，但使用错误的 code_verifier
    $response = $this->post('/oauth/token', [
        'grant_type' => 'authorization_code',
        'client_id' => $client->id,
        'client_secret' => $client->secret,
        'code' => $code,
        'redirect_uri' => $client->redirect,
        'code_verifier' => 'wrong_verifier',
    ]);
    
    $response->assertStatus(400);
    $response->assertJson([
        'error' => 'invalid_grant',
    ]);
});
```

---

## 总结

OAuth 2.1 不是一场革命，而是一次必要的安全进化。它将过去十年中被证明有效的安全实践提升为强制要求，消除了 OAuth 2.0 中的诸多安全隐患。

对于 Laravel 开发者来说，迁移到 OAuth 2.1 的关键步骤：

1. **禁用隐式流和密码模式**：Passport 中一行代码搞定
2. **强制 PKCE**：所有授权码流都使用 PKCE
3. **实现 Refresh Token Rotation**：Passport 默认支持
4. **精确匹配重定向 URI**：避免开放重定向漏洞
5. **禁止 URI 中传递 Token**：通过中间件强制执行
6. **缩短 Token 有效期**：Access Token 15 分钟，Refresh Token 7 天
7. **实现异常检测**：监控 Token 使用模式

安全不是一个终点，而是一个持续的过程。OAuth 2.1 为我们提供了一个更安全的起点，但真正的安全来自于对规范的深入理解和正确实施。

## 相关阅读

- [Laravel Passport OAuth2 自定义 Grant Type 与第三方登录实战](/categories/05_PHP/Laravel/Laravel-Passport-OAuth2-自定义-Grant-Type-与第三方登录实战/)
- [Laravel Sanctum 实战：SPA、API 令牌认证与移动端适配](/categories/05_PHP/Laravel/Laravel-Sanctum-实战-SPA-API-令牌认证与移动端适配/)
- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/categories/00_架构/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
