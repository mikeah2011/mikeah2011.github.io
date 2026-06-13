---

title: FusionAuth 实战：开源身份认证平台——对比 Auth0/WorkOS 的自托管 SSO/MFA/社交登录完整方案与 Laravel Passport
keywords: [FusionAuth, Auth0, WorkOS, SSO, MFA, Laravel Passport, 开源身份认证平台, 的自托管, 社交登录完整方案与]
date: 2026-06-07 10:00:00
description: FusionAuth 开源身份认证平台实战指南：自托管部署 SSO 单点登录、MFA 多因素认证、社交登录（Google/GitHub/微信），完整 Laravel Passport 集成教程，对比 Auth0/WorkOS 定价与功能，附 Docker Compose、OAuth2 流程、JWT 中间件、用户迁移生产级代码示例。
tags:
- fusionauth
- Laravel
- SSO
- MFA
- OAuth
- auth0
- 认证
- 身份认证
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---





在现代 Web 应用开发中，身份认证（Authentication）与授权（Authorization）是每个开发者都无法回避的核心问题。当我们选择 Laravel 生态时，Laravel Passport 提供了优秀的 OAuth2 服务器能力；但当我们需要 SSO 单点登录、MFA 多因素认证、社交登录集成等企业级功能时，一个专用的身份认证平台就变得不可或缺。本文将深入介绍 FusionAuth——一款开源的自托管身份认证平台，并对比 Auth0 和 WorkOS，展示如何将其与 Laravel Passport 互补，构建完整的认证体系。

<!-- more -->

## 一、FusionAuth 是什么？

### 1.1 项目概述

FusionAuth 是一款功能完备的身份认证与用户管理平台，最初于 2018 年开源，由 FusionAuth 公司维护。它提供了企业级的认证功能，同时保持了自托管部署的灵活性。FusionAuth 采用 Java 编写，使用 PostgreSQL 或 MySQL 作为数据存储，通过 REST API 和 OIDC/OAuth2 协议与应用集成。

核心特性包括：
- **完整的 OAuth2/OIDC 服务器**：支持 Authorization Code、Client Credentials、Device Code 等全部 grant type
- **SSO 单点登录**：基于 SAML 2.0 和 OIDC 协议的企业级 SSO
- **MFA 多因素认证**：支持 TOTP、WebAuthn（Passkeys）、SMS、Email 等多种方式
- **社交登录**：内置 Google、GitHub、Apple、Facebook 等数十种社交登录连接器
- **用户管理控制台**：直观的 Web 界面用于用户管理、审计日志查看
- **Webhook 与事件系统**：支持用户注册、登录、密码重置等事件的实时通知
- **多租户架构**：原生支持多租户，适合 SaaS 场景

### 1.2 架构概览

FusionAuth 的架构设计简洁而强大：

```
┌─────────────────────────────────────────────────────────┐
│                    客户端应用层                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Laravel   │  │  React   │  │  移动端   │              │
│  │  App      │  │  SPA     │  │  App     │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
└───────┼──────────────┼──────────────┼────────────────────┘
        │              │              │
        ▼              ▼              ▼
┌─────────────────────────────────────────────────────────┐
│               FusionAuth Server                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │           REST API / OIDC / SAML 2.0             │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 认证引擎  │  │ 用户管理  │  │ 连接器   │              │
│  │          │  │          │  │(社交/AD) │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ MFA 模块  │  │ Webhook  │  │ 主题引擎  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              数据存储层                                   │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │  PostgreSQL   │    │ Elasticsearch│  (可选，用于搜索)  │
│  │  / MySQL      │    │              │                   │
│  └──────────────┘    └──────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

FusionAuth 采用微内核设计理念，核心认证逻辑与各种连接器（Connector）和插件解耦，便于扩展和维护。

### 1.3 为什么自托管很重要？

在云服务盛行的今天，选择自托管身份认证平台有其深远意义：

1. **数据主权**：用户数据完全存储在自己的基础设施上，满足 GDPR、等保等合规要求
2. **成本可控**：不受 MAU（月活跃用户）计费模式限制，用户增长不会导致认证成本飙升
3. **定制灵活**：可以深度定制登录界面、认证流程、Webhook 逻辑
4. **网络隔离**：在内网环境中部署，避免认证请求经过第三方服务器
5. **无供应商锁定**：使用标准协议（OIDC/SAML），随时可以迁移

## 二、FusionAuth vs Auth0 vs WorkOS：深度对比

### 2.1 综合对比表

| 特性 | FusionAuth | Auth0 | WorkOS | Laravel Passport |
|------|-----------|-------|--------|-----------------|
| **开源协议** | Apache 2.0 (社区版) | 闭源 SaaS | 闭源 SaaS | MIT |
| **自托管** | ✅ 完全支持 | ❌ 仅云服务 | ❌ 仅云服务 | ✅ (Laravel 内) |
| **定价模式** | 免费社区版 / 企业版 | MAU 计费 | 按功能计费 | 完全免费 |
| **SSO (SAML)** | ✅ 内置 | ✅ 付费功能 | ✅ 核心功能 | ❌ 需自行实现 |
| **MFA** | ✅ 全面支持 | ✅ 全面支持 | ✅ 支持 | ❌ 需自行实现 |
| **社交登录** | ✅ 30+ 提供商 | ✅ 丰富 | ✅ 支持 | ❌ 需 Socialite |
| **用户管理 UI** | ✅ 内置控制台 | ✅ Dashboard | ✅ Dashboard | ❌ 需自行开发 |
| **Webhook** | ✅ 原生支持 | ✅ 支持 | ✅ 支持 | ❌ 需自行实现 |
| **多租户** | ✅ 原生支持 | ✅ 支持 | ✅ 支持 | ❌ 需自行实现 |
| **Passkeys** | ✅ WebAuthn | ✅ 支持 | ✅ 支持 | ❌ 需第三方库 |
| **用户迁移** | ✅ Bulk Import API | ✅ 支持 | ✅ 支持 | ❌ 手动迁移 |
| **LDAP/AD** | ✅ 连接器 | ✅ 企业版 | ✅ 支持 | ❌ |
| **审计日志** | ✅ 内置 | ✅ 付费 | ✅ 支持 | ❌ 需自建 |
| **学习曲线** | 中等 | 低 | 低 | 中等 |

### 2.2 定价分析

**Auth0** 的定价以 MAU 为基础，免费版限 7,500 MAU，Professional 版 $23/月/1000 MAU 起。当应用用户规模达到 10 万以上时，年费用可能高达数万美元。对于快速增长的应用，Auth0 的成本会成为显著负担。

**WorkOS** 采用按功能计费模式，SSO 每个连接 $99/月，Directory Sync $99/月。对于需要接入多个企业客户 SSO 的场景，成本同样不低。

**FusionAuth** 社区版完全免费，无 MAU 限制。企业版（包含高级支持和部分企业功能）采用固定订阅模式。对于大多数项目，社区版已足够满足需求。

**Laravel Passport** 作为 Laravel 生态内的 OAuth2 服务器完全免费，但功能局限于 OAuth2/OIDC 基础能力，缺乏 SSO、MFA、用户管理 UI 等企业级功能。

### 2.3 何时选择哪个？

- **选择 FusionAuth**：需要自托管、数据主权要求高、用户规模大、需要完整认证功能
- **选择 Auth0**：快速原型、团队小不想运维、预算充足、偏好 SaaS
- **选择 WorkOS**：主要面向企业客户 SSO 集成、B2B 场景为主
- **选择 Laravel Passport**：仅需 OAuth2 API 认证、不需 SSO/MFA、项目规模较小

## 三、FusionAuth 与 Laravel Passport 的互补策略

### 3.1 互补架构设计

Laravel Passport 是一个优秀的 OAuth2 授权服务器，但在企业级认证场景中存在明显短板。将 FusionAuth 与 Laravel Passport 结合使用，可以取长补短：

```
┌──────────────────────────────────────────────────────┐
│                    客户端应用                          │
│  浏览器 / SPA / 移动端 / 第三方应用                    │
└──────────────────────┬───────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
           ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│   FusionAuth     │    │  Laravel App     │
│   (认证中心)      │    │  (资源服务器)     │
│                  │    │                  │
│ • SSO/SAML       │    │ • API 业务逻辑   │
│ • MFA            │    │ • Token 验证     │
│ • 社交登录       │    │ • 用户数据管理    │
│ • 用户管理       │    │ • 权限控制        │
│ • Webhook        │    │ • Passport 令牌  │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         │    Token Exchange     │
         │◄─────────────────────►│
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│  PostgreSQL      │    │  MySQL/PG        │
│  (FusionAuth DB) │    │  (App DB)        │
└──────────────────┘    └──────────────────┘
```

**核心思路**：FusionAuth 作为统一的认证中心（Identity Provider），负责所有认证相关的逻辑；Laravel 应用作为资源服务器（Resource Server），通过验证 FusionAuth 签发的 JWT Token 来确认用户身份。同时保留 Laravel Passport 用于内部 API 的 OAuth2 认证。

### 3.2 具体分工

| 职责 | 由谁负责 | 说明 |
|------|---------|------|
| 用户登录/注册 | FusionAuth | 统一登录入口 |
| SSO 单点登录 | FusionAuth | SAML/OIDC |
| MFA 多因素认证 | FusionAuth | TOTP/WebAuthn/SMS |
| 社交登录 | FusionAuth | Google/GitHub/WeChat |
| 企业客户接入 | FusionAuth | SAML SSO |
| 内部 API 认证 | Laravel Passport | 微服务间调用 |
| Token 验证 | Laravel | JWT 验证中间件 |
| 业务数据管理 | Laravel | 用户资料扩展 |
| 权限/角色控制 | Laravel (Spatie) | 业务权限逻辑 |

## 四、Docker 部署 FusionAuth

### 4.1 基础 Docker Compose 配置

创建 `docker-compose.yml`：

```yaml
version: "3.8"

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: fusionauth
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-fusionauth_secure_password}
      POSTGRES_DB: fusionauth
    volumes:
      - fusionauth_db_data:/var/lib/postgresql/data
    networks:
      - fusionauth
    restart: unless-stopped

  fusionauth:
    image: fusionauth/fusionauth-app:latest
    depends_on:
      - db
    environment:
      DATABASE_URL: jdbc:postgresql://db:5432/fusionauth
      DATABASE_ROOT_USERNAME: fusionauth
      DATABASE_ROOT_PASSWORD: ${POSTGRES_PASSWORD:-fusionauth_secure_password}
      DATABASE_USERNAME: fusionauth
      DATABASE_PASSWORD: ${POSTGRES_PASSWORD:-fusionauth_secure_password}
      FUSIONAUTH_APP_MEMORY: 512M
      FUSIONAUTH_APP_RUNTIME_MODE: production
      FUSIONAUTH_APP_URL: https://auth.example.com
      SEARCH_TYPE: database
    volumes:
      - fusionauth_config:/usr/local/fusionauth/config
    networks:
      - fusionauth
    ports:
      - "9011:9011"
    restart: unless-stopped

  # 可选：Elasticsearch（用于大量用户的搜索优化）
  # search:
  #   image: docker.elastic.co/elasticsearch/elasticsearch:8.10.0
  #   environment:
  #     discovery.type: single-node
  #     xpack.security.enabled: false
  #   volumes:
  #     - fusionauth_search_data:/usr/share/elasticsearch/data
  #   networks:
  #     - fusionauth

volumes:
  fusionauth_db_data:
  fusionauth_config:
  # fusionauth_search_data:

networks:
  fusionauth:
    driver: bridge
```

### 4.2 初始配置与启动

```bash
# 创建环境变量文件
cat > .env << 'EOF'
POSTGRES_PASSWORD=your_strong_password_here
FUSIONAUTH_APP_API_KEY=your_api_key_here
EOF

# 启动服务
docker compose up -d

# 检查服务状态
docker compose ps

# 访问 FusionAuth 控制台
# http://localhost:9011
# 首次访问会进入设置向导
```

首次访问 FusionAuth 控制台后，需要完成以下设置：
1. 创建管理员账号
2. 生成 API Key（用于程序化管理）
3. 配置邮件服务器（可选，用于 MFA 和通知）

### 4.3 使用 Kickstart 自动化配置

FusionAuth 提供 Kickstart 功能，可在首次启动时自动完成初始配置：

```yaml
# 在 docker-compose.yml 的 fusionauth 服务中添加：
    volumes:
      - ./kickstart.json:/usr/local/fusionauth/kickstart/kickstart.json
    environment:
      FUSIONAUTH_APP_KICKSTART_FILE: /usr/local/fusionauth/kickstart/kickstart.json
```

```json
// kickstart.json
{
  "apiKeys": [
    {
      "key": "your_api_key_here",
      "meta": {
        "data": {
          "comment": "Laravel App API Key"
        }
      }
    }
  ],
  "applications": [
    {
      "name": "Laravel App",
      "roles": [
        { "name": "admin", "isDefault": false },
        { "name": "user", "isDefault": true }
      ],
      "oauthConfiguration": {
        "authorizedRedirectURLs": [
          "https://your-app.example.com/auth/callback"
        ],
        "clientSecret": "your_client_secret",
        "enabledGrants": ["authorization_code", "refresh_token"],
        "requireRegistration": true,
        "logoutURL": "https://your-app.example.com/logout"
      },
      "jwtConfiguration": {
        "enabled": true,
        "timeToLiveInSeconds": 3600
      }
    }
  ],
  "users": [
    {
      "email": "admin@example.com",
      "password": "change_me_now",
      "firstName": "Admin",
      "lastName": "User"
    }
  ]
}
```

## 五、Laravel 集成实战

### 5.1 安装依赖

```bash
# 创建 Laravel 项目（如已有项目跳过此步）
composer create-project laravel/laravel fusionauth-demo

# 安装 Socialite（用于 OAuth2 社交登录）
composer require laravel/socialite

# 安装 HTTP 客户端增强（调用 FusionAuth API）
composer require guzzlehttp/guzzle

# 安装 JWT 验证库
composer require firebase/php-jwt

# 可选：保留 Passport 用于内部 API
composer require laravel/passport
php artisan passport:install
```

### 5.2 配置环境变量

在 `.env` 文件中添加 FusionAuth 相关配置：

```env
# FusionAuth 配置
FUSIONAUTH_BASE_URL=https://auth.example.com
FUSIONAUTH_CLIENT_ID=your-application-client-id
FUSIONAUTH_CLIENT_SECRET=your-application-client-secret
FUSIONAUTH_API_KEY=your-api-key
FUSIONAUTH_TENANT_ID=your-tenant-id

# FusionAuth JWT 公钥（从 FusionAuth 控制台获取）
FUSIONAUTH_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBI...AQAB\n-----END PUBLIC KEY-----"
```

### 5.3 创建 FusionAuth Service

```php
<?php
// app/Services/FusionAuthService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

class FusionAuthService
{
    protected string $baseUrl;
    protected string $clientId;
    protected string $clientSecret;
    protected string $apiKey;
    protected string $jwtPublicKey;

    public function __construct()
    {
        $this->baseUrl = rtrim(config('services.fusionauth.base_url'), '/');
        $this->clientId = config('services.fusionauth.client_id');
        $this->clientSecret = config('services.fusionauth.client_secret');
        $this->apiKey = config('services.fusionauth.api_key');
        $this->jwtPublicKey = config('services.fusionauth.jwt_public_key');
    }

    /**
     * 获取 OAuth2 授权 URL
     */
    public function getAuthorizationUrl(string $redirectUri, string $state = ''): string
    {
        $params = http_build_query([
            'client_id' => $this->clientId,
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => 'openid offline_access',
            'state' => $state ?: bin2hex(random_bytes(16)),
        ]);

        return "{$this->baseUrl}/oauth2/authorize?{$params}";
    }

    /**
     * 用授权码交换 Token
     */
    public function exchangeCodeForToken(string $code, string $redirectUri): ?array
    {
        $response = Http::asForm()->post("{$this->baseUrl}/oauth2/token", [
            'grant_type' => 'authorization_code',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'code' => $code,
            'redirect_uri' => $redirectUri,
        ]);

        return $response->successful() ? $response->json() : null;
    }

    /**
     * 验证并解析 JWT Token
     */
    public function verifyJwt(string $token): ?object
    {
        try {
            return JWT::decode($token, new Key($this->jwtPublicKey, 'RS256'));
        } catch (\Exception $e) {
            report($e);
            return null;
        }
    }

    /**
     * 获取用户信息
     */
    public function getUserInfo(string $accessToken): ?array
    {
        $response = Http::withToken($accessToken)
            ->get("{$this->baseUrl}/oauth2/userinfo");

        return $response->successful() ? $response->json() : null;
    }

    /**
     * 刷新 Token
     */
    public function refreshToken(string $refreshToken): ?array
    {
        $response = Http::asForm()->post("{$this->baseUrl}/oauth2/token", [
            'grant_type' => 'refresh_token',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'refresh_token' => $refreshToken,
        ]);

        return $response->successful() ? $response->json() : null;
    }

    /**
     * 调用 FusionAuth Admin API
     */
    protected function adminApi(string $method, string $endpoint, array $data = []): ?array
    {
        $url = "{$this->baseUrl}/api{$endpoint}";

        $response = Http::withHeaders([
            'Authorization' => $this->apiKey,
            'Content-Type' => 'application/json',
        ])->{$method}($url, $data);

        return $response->successful() ? $response->json() : null;
    }

    /**
     * 通过 FusionAuth API 创建用户
     */
    public function createUser(array $userData): ?array
    {
        return $this->adminApi('post', '/user', $userData);
    }

    /**
     * 通过 FusionAuth API 搜索用户
     */
    public function searchUsers(string $query): ?array
    {
        return $this->adminApi('get', '/user/search?queryString=' . urlencode($query));
    }

    /**
     * 启用用户的 MFA
     */
    public function enableMfa(string $userId, string $method = 'authenticator'): ?array
    {
        return $this->adminApi('put', "/user/{$userId}", [
            'twoFactor' => [
                'methods' => [
                    ['method' => $method],
                ],
                'preferred' => $method,
            ],
        ]);
    }
}
```

### 5.4 注册服务提供者

```php
<?php
// config/services.php 中添加 fusionauth 配置

'fusionauth' => [
    'base_url' => env('FUSIONAUTH_BASE_URL', 'https://auth.example.com'),
    'client_id' => env('FUSIONAUTH_CLIENT_ID'),
    'client_secret' => env('FUSIONAUTH_CLIENT_SECRET'),
    'api_key' => env('FUSIONAUTH_API_KEY'),
    'jwt_public_key' => env('FUSIONAUTH_JWT_PUBLIC_KEY'),
    'redirect' => '/auth/callback',
],
```

在 `AppServiceProvider` 中注册：

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use App\Services\FusionAuthService;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(FusionAuthService::class, function ($app) {
            return new FusionAuthService();
        });
    }
}
```

### 5.5 认证控制器

```php
<?php
// app/Http/Controllers/Auth/FusionAuthController.php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\FusionAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class FusionAuthController extends Controller
{
    public function __construct(
        protected FusionAuthService $fusionAuth
    ) {}

    /**
     * 重定向到 FusionAuth 登录页面
     */
    public function redirectToLogin(Request $request)
    {
        $state = bin2hex(random_bytes(16));
        $request->session()->put('oauth_state', $state);

        $redirectUri = route('auth.callback');
        $url = $this->fusionAuth->getAuthorizationUrl($redirectUri, $state);

        return redirect()->away($url);
    }

    /**
     * 处理 FusionAuth 回调
     */
    public function handleCallback(Request $request)
    {
        // 验证 state 参数防止 CSRF
        if ($request->input('state') !== $request->session()->get('oauth_state')) {
            return redirect()->route('login')
                ->withErrors(['oauth' => '状态验证失败，请重试']);
        }

        $code = $request->input('code');
        if (!$code) {
            return redirect()->route('login')
                ->withErrors(['oauth' => '未收到授权码']);
        }

        // 交换 Token
        $tokenData = $this->fusionAuth->exchangeCodeForToken(
            $code,
            route('auth.callback')
        );

        if (!$tokenData) {
            return redirect()->route('login')
                ->withErrors(['oauth' => 'Token 交换失败']);
        }

        // 解析 JWT 获取用户信息
        $jwtPayload = $this->fusionAuth->verifyJwt($tokenData['access_token']);
        if (!$jwtPayload) {
            return redirect()->route('login')
                ->withErrors(['oauth' => 'Token 验证失败']);
        }

        // 获取详细的用户信息
        $userInfo = $this->fusionAuth->getUserInfo($tokenData['access_token']);
        if (!$userInfo) {
            return redirect()->route('login')
                ->withErrors(['oauth' => '获取用户信息失败']);
        }

        // 本地用户同步
        $user = $this->syncLocalUser($userInfo, $tokenData);

        // 登录用户
        Auth::login($user, remember: true);
        $request->session()->regenerate();

        // 存储 Refresh Token
        if (isset($tokenData['refresh_token'])) {
            $request->session()->put('fusionauth_refresh_token', $tokenData['refresh_token']);
        }

        return redirect()->intended('/dashboard');
    }

    /**
     * 同步 FusionAuth 用户到本地数据库
     */
    protected function syncLocalUser(array $userInfo, array $tokenData): User
    {
        $user = User::where('fusionauth_id', $userInfo['sub'])->first();

        if (!$user) {
            // 检查是否已存在相同邮箱的用户
            $user = User::where('email', $userInfo['email'])->first();

            if ($user) {
                // 关联已有账号
                $user->update([
                    'fusionauth_id' => $userInfo['sub'],
                ]);
            } else {
                // 创建新用户
                $user = User::create([
                    'name' => $userInfo['preferred_username']
                        ?? $userInfo['name']
                        ?? $userInfo['email'],
                    'email' => $userInfo['email'],
                    'fusionauth_id' => $userInfo['sub'],
                    'email_verified_at' => isset($userInfo['email_verified'])
                        && $userInfo['email_verified']
                        ? now() : null,
                    'password' => bcrypt(Str::random(32)), // 不使用密码登录
                    'avatar' => $userInfo['picture'] ?? null,
                ]);
            }
        } else {
            // 更新已有用户信息
            $user->update([
                'name' => $userInfo['name'] ?? $user->name,
                'avatar' => $userInfo['picture'] ?? $user->avatar,
            ]);
        }

        return $user;
    }

    /**
     * 登出
     */
    public function logout(Request $request)
    {
        $request->session()->forget(['fusionauth_refresh_token']);
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        // 重定向到 FusionAuth 登出
        $logoutUrl = config('services.fusionauth.base_url')
            . '/oauth2/logout?client_id='
            . config('services.fusionauth.client_id')
            . '&post_logout_redirect_uri='
            . urlencode(route('login'));

        return redirect()->away($logoutUrl);
    }
}
```

### 5.6 路由定义

```php
<?php
// routes/web.php

use App\Http\Controllers\Auth\FusionAuthController;

Route::middleware('guest')->group(function () {
    Route::get('/auth/login', [FusionAuthController::class, 'redirectToLogin'])
        ->name('auth.login');
    Route::get('/auth/callback', [FusionAuthController::class, 'handleCallback'])
        ->name('auth.callback');
});

Route::middleware('auth')->group(function () {
    Route::post('/auth/logout', [FusionAuthController::class, 'logout'])
        ->name('auth.logout');
});
```

### 5.7 JWT 中间件（保护 API）

```php
<?php
// app/Http/Middleware/VerifyFusionAuthJwt.php

namespace App\Http\Middleware;

use App\Services\FusionAuthService;
use Closure;
use Illuminate\Http\Request;

class VerifyFusionAuthJwt
{
    public function __construct(
        protected FusionAuthService $fusionAuth
    ) {}

    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json(['error' => '未提供认证令牌'], 401);
        }

        $payload = $this->fusionAuth->verifyJwt($token);

        if (!$payload) {
            return response()->json(['error' => '令牌无效或已过期'], 401);
        }

        // 将用户信息注入请求
        $request->merge(['fusionauth_user' => (array) $payload]);

        return $next($request);
    }
}
```

## 六、MFA 多因素认证配置

### 6.1 通过 FusionAuth 控制台启用 MFA

在 FusionAuth 控制台中，导航到 **Settings → Multi Factor**，可以全局配置 MFA 策略：

- **启用 TOTP**：支持 Google Authenticator、Authy 等 TOTP 应用
- **启用 WebAuthn**：支持 FIDO2 安全密钥和 Passkeys
- **启用 SMS**：需要配置 SMS 提供商（Twilio 等）
- **启用 Email**：通过邮件发送一次性验证码

### 6.2 在应用中要求 MFA

FusionAuth 支持在应用级别或全局级别要求 MFA：

```json
// 通过 FusionAuth API 设置应用的 MFA 策略
{
  "application": {
    "multiFactorConfiguration": {
      "loginPolicy": "Required",
      "authenticator": {
        "enabled": true
      },
      "email": {
        "enabled": true
      }
    }
  }
}
```

当用户登录时，如果启用了 MFA，FusionAuth 会返回 `twoFactorId` 而不是标准的 Token，应用需要引导用户完成二次验证：

```php
// 处理 MFA 挑战
public function handleMfaChallenge(Request $request)
{
    $twoFactorId = $request->input('twoFactorId');
    $code = $request->input('code');

    $response = Http::asForm()->post(config('services.fusionauth.base_url') . '/api/two-factor/login', [
        'code' => $code,
        'twoFactorId' => $twoFactorId,
    ]);

    if ($response->successful()) {
        $tokenData = $response->json();
        // 正常处理 Token...
    }
}
```

### 6.3 WebAuthn / Passkeys 集成

FusionAuth 原生支持 WebAuthn，用户可以注册生物识别认证或安全密钥。在 FusionAuth 控制台启用后，登录界面会自动显示 Passkey 选项。对于自定义登录界面，需要通过 FusionAuth 的 WebAuthn API 完成注册和认证流程。

## 七、社交登录集成

### 7.1 Google 登录配置

**步骤 1**：在 [Google Cloud Console](https://console.cloud.google.com/) 创建 OAuth2 凭据，获取 Client ID 和 Client Secret。

**步骤 2**：在 FusionAuth 控制台配置 Google 连接器：
- 导航到 **Settings → Identity Providers**
- 添加 Google 提供商
- 填入 Client ID 和 Client Secret
- 配置回调 URL：`https://auth.example.com/oauth2/callback`

**步骤 3**：在应用中添加 Google 登录入口：

```php
// 在登录页面添加社交登录按钮
<a href="{{ route('auth.social', ['provider' => 'google']) }}"
   class="btn btn-google">
   使用 Google 账号登录
</a>
```

```php
// 路由到 FusionAuth 的社交登录
Route::get('/auth/social/{provider}', function (string $provider) {
    $url = config('services.fusionauth.base_url')
        . "/oauth2/authorize?"
        . http_build_query([
            'client_id' => config('services.fusionauth.client_id'),
            'redirect_uri' => route('auth.callback'),
            'response_type' => 'code',
            'scope' => 'openid',
            'idp_hint' => $provider, // 关键：指定社交登录提供商
        ]);

    return redirect()->away($url);
})->name('auth.social');
```

### 7.2 GitHub 登录配置

类似于 Google，在 GitHub Developer Settings 创建 OAuth App，然后在 FusionAuth 中添加 GitHub Identity Provider。注意需要映射 GitHub 的用户名和邮箱字段。

### 7.3 微信登录集成

微信登录是中国开发者常见的需求。FusionAuth 社区版本身不内置微信连接器，但可以通过以下方式实现：

**方案 1：自定义 OpenID Connect 连接器**

如果微信侧已有中间服务将微信 OAuth2 转换为标准 OIDC，可以在 FusionAuth 中使用通用 OIDC 连接器对接。

**方案 2：Webhook + API 方案**

在 Laravel 中先完成微信登录流程，获取微信用户信息后通过 FusionAuth API 创建或查找用户：

```php
// app/Http/Controllers/Auth/WeChatAuthController.php

class WeChatAuthController extends Controller
{
    public function handleWeChatCallback(Request $request, FusionAuthService $fusionAuth)
    {
        // 1. 用 code 换取微信 access_token
        $wechatToken = $this->getWeChatToken($request->input('code'));
        $wechatUser = $this->getWeChatUserInfo($wechatToken);

        // 2. 在 FusionAuth 中搜索或创建用户
        $existingUser = $fusionAuth->searchUsers($wechatUser['unionid']);

        if ($existingUser['total'] > 0) {
            $fusionAuthUserId = $existingUser['users'][0]['id'];
        } else {
            $result = $fusionAuth->createUser([
                'user' => [
                    'email' => $wechatUser['openid'] . '@wechat.local',
                    'username' => $wechatUser['nickname'],
                    'fullName' => $wechatUser['nickname'],
                    'imageUrl' => $wechatUser['headimgurl'],
                    'data' => [
                        'wechat_unionid' => $wechatUser['unionid'],
                        'wechat_openid' => $wechatUser['openid'],
                    ],
                ],
            ]);
            $fusionAuthUserId = $result['user']['id'];
        }

        // 3. 使用 FusionAuth 登录 API 获取 JWT
        $loginResult = $this->fusionAuthLogin($fusionAuthUserId);
        // 4. 处理登录状态...
    }
}
```

## 八、SAML SSO 集成

### 8.1 FusionAuth 作为 SAML IdP

企业客户通常需要通过 SAML 2.0 协议接入 SSO。FusionAuth 可以同时充当 SAML IdP（Identity Provider）和 SP（Service Provider）。

在 FusionAuth 控制台配置 SAML：
- 导航到 **Applications → Your App → SAML**
- 配置 Entity ID、ACS URL、Certificate 等参数
- 启用 SAML 响应签名

### 8.2 Laravel 作为 SAML SP

如果需要让 Laravel 应用作为 SAML SP 接入企业客户的 IdP，可以使用 `aacotroneo/laravel-saml2` 包：

```bash
composer require aacotroneo/laravel-saml2
php artisan vendor:publish --provider="Aacotroneo\Saml2\Saml2ServiceProvider"
```

```php
// config/saml2_settings.php
'routesPrefix' => '/saml',
'idp' => [
    'FusionAuth' => [
        'entityId' => 'https://auth.example.com/saml2/metadata/app-id',
        'singleSignOnService' => 'https://auth.example.com/saml2/login/app-id',
        'singleLogoutService' => 'https://auth.example.com/saml2/logout/app-id',
        'x509cert' => 'MIIDqTCCApGgAwIBAgIB...IdP证书内容...',
    ],
],
```

## 九、用户迁移策略

### 9.1 Bulk Import API

当从现有系统迁移到 FusionAuth 时，可以使用 Bulk Import API 批量导入用户：

```php
// 迁移脚本：app/Console/Commands/MigrateUsersToFusionAuth.php

class MigrateUsersToFusionAuth extends Command
{
    protected $signature = 'fusionauth:migrate-users';
    protected $description = '批量迁移用户到 FusionAuth';

    public function handle(FusionAuthService $fusionAuth)
    {
        $users = User::whereNull('fusionauth_id')->chunk(100, function ($users) use ($fusionAuth) {
            $importData = $users->map(fn ($user) => [
                'email' => $user->email,
                'username' => $user->name,
                'password' => [
                    'type' => 'bcrypt',
                    'password' => $user->password, // 保持现有 bcrypt 密码
                ],
                'data' => [
                    'migrated_from' => 'legacy_system',
                    'legacy_id' => $user->id,
                ],
                'active' => $user->isActive() ?? true,
            ])->toArray();

            $response = Http::withHeaders([
                'Authorization' => config('services.fusionauth.api_key'),
            ])->post(config('services.fusionauth.base_url') . '/api/user/import', [
                'users' => $importData,
                'validateDbConstraints' => false,
            ]);

            if ($response->successful()) {
                $this->info("迁移了 {$users->count()} 个用户");
            } else {
                $this->error("迁移失败: " . $response->body());
            }
        });
    }
}
```

### 9.2 密码透明迁移

FusionAuth 支持透明密码迁移：先让用户通过旧密码登录，然后在后台将密码哈希迁移为 FusionAuth 格式。这需要配置 Connector 来回源验证旧系统的密码。

## 十、生产环境部署与运维

### 10.1 反向代理配置（Nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name auth.example.com;

    ssl_certificate /etc/letsencrypt/live/auth.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9011;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port 443;
    }
}
```

### 10.2 性能优化建议

1. **数据库优化**：为 PostgreSQL 配置适当的 `shared_buffers`（建议总内存的 25%）、`work_mem` 和 `effective_cache_size`
2. **内存配置**：生产环境建议 FusionAuth 分配至少 2GB JVM 内存（`FUSIONAUTH_APP_MEMORY=2048M`）
3. **连接池**：使用 PgBouncer 管理 PostgreSQL 连接
4. **搜索优化**：用户量超过 10 万时，启用 Elasticsearch 提升搜索性能
5. **缓存**：在 FusionAuth 前部署 Redis 缓存热点 Token 验证

### 10.3 监控配置

FusionAuth 提供了 Prometheus 兼容的监控端点：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'fusionauth'
    metrics_path: '/api/status'
    static_configs:
      - targets: ['fusionauth:9011']
```

关键监控指标：
- `/api/status`：服务健康状态
- 登录成功率和失败原因分布
- Token 签发延迟
- API 响应时间
- 数据库连接池使用率

### 10.4 高可用部署

生产环境建议的高可用架构：

```
                    ┌──────────┐
                    │   CDN    │
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │   Nginx  │
                    │  (LB)    │
                    └────┬─────┘
                         │
           ┌─────────────┼─────────────┐
           │             │             │
     ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
     │FusionAuth │ │FusionAuth │ │FusionAuth │
     │  Node 1   │ │  Node 2   │ │  Node 3   │
     └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
           │             │             │
           └──────┬──────┴──────┬──────┘
                  │             │
            ┌─────▼─────┐ ┌─────▼─────┐
            │ PgBouncer │ │  Redis    │
            └─────┬─────┘ │ (缓存)    │
                  │       └───────────┘
            ┌─────▼─────┐
            │PostgreSQL │
            │ (主从)    │
            └───────────┘
```

## 十一、常见问题排查

### 11.1 Token 验证失败

**症状**：JWT 验证返回 `Signature verification failed`

**排查步骤**：
1. 确认 `FUSIONAUTH_JWT_PUBLIC_KEY` 与 FusionAuth 应用配置中的密钥一致
2. 检查密钥格式是否正确（包含 `-----BEGIN PUBLIC KEY-----` 头尾）
3. 确认 Key ID 匹配——FusionAuth 可能有多个签名密钥

```bash
# 从 FusionAuth 获取当前密钥
curl -H "Authorization: $API_KEY" \
  https://auth.example.com/api/key | jq '.keys[] | select(.algorithm=="RS256")'
```

### 11.2 CORS 问题

**症状**：SPA 应用调用 FusionAuth API 时遇到 CORS 错误

**解决方案**：在 FusionAuth 的 Application 配置中添加 CORS 来源：

```json
{
  "application": {
    "lambdaConfiguration": {
      "populateJWT": "your-lambda-id"
    },
    "corsConfiguration": {
      "enabled": true,
      "allowedOrigins": ["https://your-app.example.com"],
      "allowedMethods": ["GET", "POST"],
      "allowCredentials": true
    }
  }
}
```

### 11.3 社交登录回调失败

**症状**：社交登录后重定向失败

**排查步骤**：
1. 确认 FusionAuth 的回调 URL 已在社交提供商处正确配置
2. 检查 FusionAuth 的 Application 配置中 `authorizedRedirectURLs` 是否包含你的回调地址
3. 查看 FusionAuth 日志：`docker compose logs -f fusionauth`

### 11.4 MFA 设置问题

**症状**：TOTP 应用扫描二维码后验证码不正确

**排查步骤**：
1. 确认服务器时间和 TOTP 设备时间同步（NTP 配置）
2. FusionAuth 的 TOTP 允许一定的时钟偏移，默认 1 个时间窗口

### 11.5 性能问题

**症状**：用户量大时登录响应变慢

**解决方案**：
1. 启用 Elasticsearch 分离搜索负载
2. 增加 FusionAuth 实例数做水平扩展
3. 调优 PostgreSQL 连接池和查询计划
4. 启用 Redis 缓存频繁访问的用户数据

## 十二、总结

FusionAuth 作为一款开源的自托管身份认证平台，为企业级应用提供了完整的认证解决方案。与 Auth0 和 WorkOS 相比，FusionAuth 在成本控制和数据主权方面具有明显优势，特别适合对数据安全和合规有严格要求的项目。

将 FusionAuth 与 Laravel Passport 结合使用，可以实现最优的认证架构：
- **FusionAuth** 负责面向终端用户的认证（登录、注册、SSO、MFA、社交登录）
- **Laravel Passport** 负责内部 API 的 OAuth2 认证（微服务间调用、第三方 API 接入）
- **Laravel 应用** 负责业务逻辑和权限控制

这种互补架构既保证了认证功能的完整性，又保持了应用架构的灵活性。无论是初创项目还是企业级系统，FusionAuth + Laravel 的组合都值得认真考虑。

---

## 相关阅读

- [Supabase 实战：开源 Firebase 替代——实时数据库、Auth 与 Laravel 集成](/00_架构/2026-06-03-Supabase-实战-开源Firebase替代-实时数据库Auth与Laravel集成.md) — 同样围绕 Auth + Laravel，Supabase 侧重 BaaS 场景下的轻量认证方案
- [API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 反爬与反滥用工程化方案](/00_架构/API-Abuse-Prevention-实战-Bot检测-速率限制-指纹识别-Laravel-API反爬与反滥用工程化方案.md) — 认证之后的安全层：Laravel 项目中的 API 防滥用策略
- [OpenHuman 安全模型深度剖析：OS Keychain 密钥管理、OAuth Token 代理、Workspace 沙箱](/00_架构/OpenHuman-安全模型深度剖析-OS-keychain-密钥管理-OAuth-token代理-workspace沙箱.md) — OAuth Token 在桌面端的安全管理与隔离实践

---

**参考资源**：
- [FusionAuth 官方文档](https://fusionauth.io/docs/)
- [FusionAuth GitHub](https://github.com/FusionAuth/fusionauth-containers)
- [Laravel Socialite 文档](https://laravel.com/docs/socialite)
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
