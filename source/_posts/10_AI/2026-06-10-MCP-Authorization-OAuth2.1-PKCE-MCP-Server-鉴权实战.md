---
title: MCP Authorization 规范实战：OAuth 2.1 + PKCE 的 MCP Server 鉴权——企业级工具访问控制的工程化方案
date: 2026-06-10 01:55:00
categories:
  - AI
tags:
  - MCP
  - OAuth
  - PKCE
  - 安全
  - Agent
description: 深入解析 MCP Authorization 规范，基于 OAuth 2.1 + PKCE 实现企业级 MCP Server 鉴权，涵盖授权流程、动态客户端注册、Laravel 实战与生产部署要点。
---

# MCP Authorization 规范实战：OAuth 2.1 + PKCE 的 MCP Server 鉴权

## 概述

当 AI Agent 通过 MCP（Model Context Protocol）调用企业内部工具时，**鉴权**是绕不开的第一道关。MCP 规范定义了基于 HTTP 传输层的授权机制，核心思路是：MCP Server 同时作为 OAuth 2.1 的 Authorization Server，通过标准的 OAuth 流程对 Client 进行身份验证和权限控制。

与传统 OAuth 场景不同，MCP 的鉴权有三个特殊点：

1. **Client 类型不固定**：可能是 Claude Desktop 这样的公共客户端，也可能是企业内部的机密客户端
2. **Discovery 机制**：Client 需要先发现 Server 的认证端点，再发起授权
3. **动态客户端注册**：支持 RFC 7591 的动态注册，降低接入门槛

本文基于 MCP Authorization 规范（2025-03-26 版本），给出一套完整的 Laravel 实现方案。

## 核心概念

### OAuth 2.1 + PKCE 流程

MCP 规范要求实现 OAuth 2.1，核心变化是**强制要求公共客户端使用 PKCE**（Proof Key for Code Exchange）。流程如下：

```
Client → Server: MCP Request
Server → Client: 401 Unauthorized
Client: 生成 code_verifier + code_challenge
Client → User-Agent: 打开浏览器，带上 code_challenge
User-Agent → Server: GET /authorize（用户登录授权）
Server → User-Agent: 重定向到 callback，带上 auth code
User-Agent → Client: 回调，带上 auth code
Client → Server: Token Request，带上 code + code_verifier
Server → Client: Access Token + Refresh Token
Client → Server: MCP Request + Access Token
```

关键安全点：

- `code_verifier` 是 43-128 字符的随机字符串
- `code_challenge` = BASE64URL(SHA256(code_verifier))
- Token 端点验证时用 SHA256(code_verifier) 与 code_challenge 比对

### Server Metadata Discovery

Client 连接 MCP Server 时，第一步是发现认证端点：

```
GET /.well-known/oauth-authorization-server
```

返回的 Metadata Document 包含：

```json
{
  "issuer": "https://api.example.com",
  "authorization_endpoint": "https://api.example.com/authorize",
  "token_endpoint": "https://api.example.com/token",
  "registration_endpoint": "https://api.example.com/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials"],
  "code_challenge_methods_supported": ["S256"]
}
```

如果 Discovery 失败（404），Client 应 fallback 到默认路径：

| 端点 | 默认路径 |
|------|---------|
| Authorization | `/authorize` |
| Token | `/token` |
| Registration | `/register` |

注意：**Authorization Base URL** 从 MCP Server URL 推导，丢弃 path 部分。例如 `https://api.example.com/v1/mcp` → Base URL 是 `https://api.example.com`。

### 动态客户端注册（RFC 7591）

MCP 规范推荐支持动态客户端注册，让 Client 在首次连接时自动注册：

```
POST /register
Content-Type: application/json

{
  "client_name": "claude-desktop",
  "redirect_uris": ["http://localhost:3000/callback"],
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Server 返回 `client_id`，Client 后续用这个 ID 进行 OAuth 流程。

## Laravel 实现

### 数据库设计

```php
// database/migrations/xxx_create_mcp_oauth_tables.php

Schema::create('oauth_clients', function (Blueprint $table) {
    $table->id();
    $table->string('client_id', 80)->unique();
    $table->string('client_secret', 255)->nullable();
    $table->string('client_name');
    $table->json('redirect_uris');
    $table->json('grant_types')->default('["authorization_code"]');
    $table->json('response_types')->default('["code"]');
    $table->string('token_endpoint_auth_method')->default('none');
    $table->boolean('is_confidential')->default(false);
    $table->timestamps();
});

Schema::create('oauth_authorization_codes', function (Blueprint $table) {
    $table->id();
    $table->string('code', 128)->unique();
    $table->foreignId('client_id')->constrained('oauth_clients');
    $table->foreignId('user_id')->constrained();
    $table->string('redirect_uri');
    $table->string('code_challenge', 128);
    $table->string('code_challenge_method')->default('S256');
    $table->json('scopes')->default('[]');
    $table->timestamp('expires_at');
    $table->timestamps();
});

Schema::create('oauth_tokens', function (Blueprint $table) {
    $table->id();
    $table->string('access_token', 255)->unique();
    $table->string('refresh_token', 255)->nullable()->unique();
    $table->foreignId('client_id')->constrained('oauth_clients');
    $table->foreignId('user_id')->nullable()->constrained();
    $table->json('scopes')->default('[]');
    $table->timestamp('access_token_expires_at');
    $table->timestamp('refresh_token_expires_at')->nullable();
    $table->timestamps();
});
```

### Metadata Discovery 端点

```php
// app/Http/Controllers/Mcp/MetadataController.php

namespace App\Http\Controllers\Mcp;

use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;

class MetadataController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $baseUrl = config('app.url');

        return response()->json([
            'issuer' => $baseUrl,
            'authorization_endpoint' => "{$baseUrl}/mcp/authorize",
            'token_endpoint' => "{$baseUrl}/mcp/token",
            'registration_endpoint' => "{$baseUrl}/mcp/register",
            'response_types_supported' => ['code'],
            'grant_types_supported' => [
                'authorization_code',
                'client_credentials',
            ],
            'code_challenge_methods_supported' => ['S256'],
            'token_endpoint_auth_method_supported' => [
                'none',
                'client_secret_basic',
            ],
        ], 200, [
            'MCP-Protocol-Version' => '2025-03-26',
        ]);
    }
}
```

### 动态客户端注册

```php
// app/Http/Controllers/Mcp/RegistrationController.php

namespace App\Http\Controllers\Mcp;

use App\Models\OAuthClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class RegistrationController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'client_name' => 'required|string|max:255',
            'redirect_uris' => 'required|array|min:1',
            'redirect_uris.*' => 'url',
            'grant_types' => 'sometimes|array',
            'grant_types.*' => 'in:authorization_code,client_credentials',
            'response_types' => 'sometimes|array',
            'response_types.*' => 'in:code',
            'token_endpoint_auth_method' => 'sometimes|in:none,client_secret_basic',
        ]);

        $clientId = Str::random(48);
        $isConfidential = ($validated['token_endpoint_auth_method'] ?? 'none') !== 'none';
        $clientSecret = $isConfidential ? Str::random(64) : null;

        $client = OAuthClient::create([
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'client_name' => $validated['client_name'],
            'redirect_uris' => $validated['redirect_uris'],
            'grant_types' => $validated['grant_types'] ?? ['authorization_code'],
            'response_types' => $validated['response_types'] ?? ['code'],
            'token_endpoint_auth_method' => $validated['token_endpoint_auth_method'] ?? 'none',
            'is_confidential' => $isConfidential,
        ]);

        $response = [
            'client_id' => $clientId,
            'client_name' => $client->client_name,
            'redirect_uris' => $client->redirect_uris,
            'grant_types' => $client->grant_types,
            'response_types' => $client->response_types,
            'token_endpoint_auth_method' => $client->token_endpoint_auth_method,
        ];

        if ($isConfidential) {
            $response['client_secret'] = $clientSecret;
        }

        return response()->json($response, 201);
    }
}
```

### Authorization Code + PKCE 端点

```php
// app/Http/Controllers/Mcp/AuthorizationController.php

namespace App\Http\Controllers\Mcp;

use App\Models\OAuthAuthorizationCode;
use App\Models\OAuthClient;
use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Str;

class AuthorizationController extends Controller
{
    public function authorize(Request $request): RedirectResponse
    {
        $request->validate([
            'client_id' => 'required|string',
            'redirect_uri' => 'required|url',
            'code_challenge' => 'required|string|min:43|max:128',
            'code_challenge_method' => 'required|in:S256',
            'response_type' => 'required|in:code',
            'state' => 'required|string',
            'scope' => 'sometimes|string',
        ]);

        $client = OAuthClient::where('client_id', $request->client_id)->firstOrFail();

        if (!in_array($request->redirect_uri, $client->redirect_uris)) {
            abort(400, 'Invalid redirect_uri');
        }

        $code = Str::random(64);

        OAuthAuthorizationCode::create([
            'code' => $code,
            'client_id' => $client->id,
            'user_id' => auth()->id(),
            'redirect_uri' => $request->redirect_uri,
            'code_challenge' => $request->code_challenge,
            'code_challenge_method' => $request->code_challenge_method,
            'scopes' => explode(' ', $request->scope ?? ''),
            'expires_at' => now()->addMinutes(10),
        ]);

        $redirectUrl = $request->redirect_uri . '?' . http_build_query([
            'code' => $code,
            'state' => $request->state,
        ]);

        return redirect($redirectUrl);
    }
}
```

### Token 端点（PKCE 验证核心）

```php
// app/Http/Controllers/Mcp/TokenController.php

namespace App\Http\Controllers\Mcp;

use App\Models\OAuthAuthorizationCode;
use App\Models\OAuthClient;
use App\Models\OAuthToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class TokenController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'grant_type' => 'required|in:authorization_code,refresh_token',
            'code' => 'required_if:grant_type,authorization_code',
            'code_verifier' => 'required_if:grant_type,authorization_code|string',
            'redirect_uri' => 'required_if:grant_type,authorization_code',
            'refresh_token' => 'required_if:grant_type,refresh_token',
            'client_id' => 'required|string',
        ]);

        $client = OAuthClient::where('client_id', $request->client_id)->firstOrFail();

        if ($request->grant_type === 'authorization_code') {
            return $this->handleAuthorizationCode($request, $client);
        }

        return $this->handleRefreshToken($request, $client);
    }

    private function handleAuthorizationCode(Request $request, OAuthClient $client): JsonResponse
    {
        $authCode = OAuthAuthorizationCode::where('code', $request->code)
            ->where('client_id', $client->id)
            ->where('expires_at', '>', now())
            ->first();

        if (!$authCode) {
            return response()->json([
                'error' => 'invalid_grant',
                'error_description' => 'Invalid or expired authorization code',
            ], 400);
        }

        $expectedChallenge = base64url_encode(
            hash('sha256', $request->code_verifier, true)
        );

        if ($expectedChallenge !== $authCode->code_challenge) {
            $authCode->delete();
            return response()->json([
                'error' => 'invalid_grant',
                'error_description' => 'PKCE verification failed',
            ], 400);
        }

        if ($request->redirect_uri !== $authCode->redirect_uri) {
            return response()->json([
                'error' => 'invalid_grant',
                'error_description' => 'redirect_uri mismatch',
            ], 400);
        }

        $accessToken = $this->createToken($client, $authCode->user_id, $authCode->scopes);

        $authCode->delete();

        return response()->json([
            'access_token' => $accessToken->access_token,
            'token_type' => 'Bearer',
            'expires_in' => $accessToken->access_token_expires_at->diffInSeconds(now()),
            'refresh_token' => $accessToken->refresh_token,
            'scope' => implode(' ', $accessToken->scopes),
        ]);
    }

    private function createToken(OAuthClient $client, ?int $userId, array $scopes): OAuthToken
    {
        $accessToken = Str::random(64);
        $refreshToken = Str::random(64);

        return OAuthToken::create([
            'access_token' => hash('sha256', $accessToken),
            'refresh_token' => hash('sha256', $refreshToken),
            'client_id' => $client->id,
            'user_id' => $userId,
            'scopes' => $scopes,
            'access_token_expires_at' => now()->addHours(1),
            'refresh_token_expires_at' => now()->addDays(30),
        ]);
    }

    private function handleRefreshToken(Request $request, OAuthClient $client): JsonResponse
    {
        $hashedToken = hash('sha256', $request->refresh_token);

        $token = OAuthToken::where('refresh_token', $hashedToken)
            ->where('client_id', $client->id)
            ->where('refresh_token_expires_at', '>', now())
            ->first();

        if (!$token) {
            return response()->json([
                'error' => 'invalid_grant',
                'error_description' => 'Invalid or expired refresh token',
            ], 400);
        }

        $newRefreshToken = Str::random(64);
        $newAccessToken = Str::random(64);

        $token->update([
            'access_token' => hash('sha256', $newAccessToken),
            'refresh_token' => hash('sha256', $newRefreshToken),
            'access_token_expires_at' => now()->addHours(1),
            'refresh_token_expires_at' => now()->addDays(30),
        ]);

        return response()->json([
            'access_token' => $newAccessToken,
            'token_type' => 'Bearer',
            'expires_in' => 3600,
            'refresh_token' => $newRefreshToken,
            'scope' => implode(' ', $token->scopes),
        ]);
    }
}
```

### Token 验证中间件

```php
// app/Http/Middleware/VerifyMcpToken.php

namespace App\Http\Middleware;

use App\Models\OAuthToken;
use Closure;
use Illuminate\Http\Request;

class VerifyMcpToken
{
    public function handle(Request $request, Closure $next)
    {
        $authHeader = $request->header('Authorization');

        if (!$authHeader || !str_starts_with($authHeader, 'Bearer ')) {
            return response()->json([
                'error' => 'invalid_token',
                'error_description' => 'Missing or malformed Authorization header',
            ], 401);
        }

        $token = substr($authHeader, 7);
        $hashedToken = hash('sha256', $token);

        $tokenRecord = OAuthToken::where('access_token', $hashedToken)
            ->where('access_token_expires_at', '>', now())
            ->first();

        if (!$tokenRecord) {
            return response()->json([
                'error' => 'invalid_token',
                'error_description' => 'Token is invalid or expired',
            ], 401);
        }

        $request->merge([
            'oauth_client_id' => $tokenRecord->client_id,
            'oauth_user_id' => $tokenRecord->user_id,
            'oauth_scopes' => $tokenRecord->scopes,
        ]);

        return $next($request);
    }
}
```

### 路由注册

```php
// routes/mcp.php

use App\Http\Controllers\Mcp\AuthorizationController;
use App\Http\Controllers\Mcp\MetadataController;
use App\Http\Controllers\Mcp\RegistrationController;
use App\Http\Controllers\Mcp\TokenController;
use App\Http\Middleware\VerifyMcpToken;

Route::get('/.well-known/oauth-authorization-server', MetadataController::class)
    ->withoutMiddleware([VerifyMcpToken::class]);

Route::post('/mcp/register', RegistrationController::class)
    ->withoutMiddleware([VerifyMcpToken::class]);

Route::get('/mcp/authorize', [AuthorizationController::class, 'authorize'])
    ->name('mcp.authorize')
    ->withoutMiddleware([VerifyMcpToken::class]);

Route::post('/mcp/token', TokenController::class)
    ->name('mcp.token')
    ->withoutMiddleware([VerifyMcpToken::class]);

Route::prefix('mcp/tools')->middleware(VerifyMcpToken::class)->group(function () {
    Route::post('/database-query', [ToolController::class, 'databaseQuery']);
    Route::post('/send-email', [ToolController::class, 'sendEmail']);
});
```

## 踩坑记录

### 1. Authorization Base URL 的陷阱

MCP 规范要求从 MCP Server URL 推导 Authorization Base URL，**丢弃 path 部分**：

```
MCP Server: https://api.example.com/v1/mcp
Metadata:   https://api.example.com/.well-known/oauth-authorization-server
```

很多开发者会错误地把 Metadata 端点放在 `/v1/mcp/.well-known/...`，导致 Client 无法发现认证端点。Laravel 中如果你的 MCP 路由在子路径下，需要单独注册 Metadata 路由到根路径。

### 2. Token 存储必须 Hash

Access Token 和 Refresh Token **不能明文存储**。数据库存 SHA256 hash，返回给 Client 的是原始值。这样即使数据库泄露，攻击者也无法直接使用 token。

```php
// 存储时
'access_token' => hash('sha256', $plainToken),

// 查询时
OAuthToken::where('access_token', hash('sha256', $inputToken))->first();
```

### 3. Refresh Token 轮转

每次使用 Refresh Token 换取新的 Access Token 时，**同时生成新的 Refresh Token**，旧的立即失效。防止 Refresh Token 被长期滥用。

### 4. Client Credentials 流程

对于 Server-to-Server 的场景（如 Agent 直接调用某个 API），不需要用户授权，使用 Client Credentials：

```
POST /mcp/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=xxx
&client_secret=xxx
&scope=read write
```

此时不需要 PKCE，但需要验证 `client_secret`。

### 5. MCP-Protocol-Version 头

Metadata Discovery 时 Client 应带上 `MCP-Protocol-Version` 头，Server 根据版本返回对应的 Metadata。Laravel 中可以直接在 Metadata 端点检查并返回：

```php
$protocolVersion = $request->header('MCP-Protocol-Version', '2025-03-26');
```

## 总结

MCP Authorization 规范的设计思路很清晰：**基于成熟的 OAuth 2.1 标准，加上 PKCE 和动态客户端注册，降低接入门槛的同时保证安全**。

实际落地时需要注意：

- **Metadata Discovery** 是第一步，确保端点可发现
- **PKCE 验证**是核心安全点，S256 是必须支持的
- **Token 存储 Hash**是基本要求，不要明文存
- **Refresh Token 轮转**防止长期滥用
- **动态客户端注册**降低接入成本，但要做好 rate limit

对于企业内部的 MCP Server，推荐使用 Client Credentials + 静态注册（提前注册好 client_id/secret）。对于面向用户的场景，Authorization Code + PKCE + 动态注册是更灵活的方案。

MCP 的鉴权本质上还是 OAuth，但规范的约束让它比传统 OAuth 更标准化。理解了这一点，实现起来并不复杂。
