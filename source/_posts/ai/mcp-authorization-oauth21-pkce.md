---

title: MCP Authorization 规范实战：OAuth 2.1 + PKCE 的 MCP Server 鉴权——企业级工具访问控制的工程化方案
keywords: [MCP Authorization, OAuth, PKCE, MCP Server, 规范实战, 鉴权, 企业级工具访问控制的工程化方案, AI]
date: 2026-06-10 02:00:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- MCP
- OAuth
- PKCE
- Authorization
- Laravel
- AI Agent
- 鉴权
- 安全
description: 深入 MCP Authorization 规范，用 Laravel 实现完整的 OAuth 2.1 + PKCE 鉴权流程：动态客户端注册、授权码交换、Token 生命周期管理、Scope 细粒度权限控制。
---



# MCP Authorization 规范实战：OAuth 2.1 + PKCE 的 MCP Server 鉴权

## 概述

上一篇 [MCP Gateway 实战](/2026/06/09/10_AI/2026-06-09-mcp-gateway-multi-server-aggregation-auth-rate-limiting/) 解决了多 MCP Server 的聚合与限流，但鉴权层只用了简单的 API Key。在企业场景下，这远远不够：

1. **API Key 无法细粒度控制** —— 一个 Key 就能调所有工具，没有 Scope 隔离
2. **Token 无法撤销** —— Key 泄露后只能轮换，影响所有使用者
3. **缺乏标准协议** —— 每个 MCP Server 各自实现 auth，Agent 侧适配成本高
4. **无法审计到人** —— 只知道哪个 Key 调了，不知道哪个用户授权的

MCP 官方规范在 2025 年底正式引入 **Authorization** 章节，基于 **OAuth 2.1 + PKCE** 构建，解决了上述所有问题。

本文用 Laravel 从零实现一个符合 MCP Authorization 规范的鉴权服务，覆盖完整生命周期。

---

## MCP Authorization 规范解读

### 协议架构

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   AI Agent   │────────▶│  MCP Server      │────────▶│  Tool/API   │
│  (MCP Client)│         │  (Resource Server)│         │  (Backend)  │
└──────┬───────┘         └────────┬─────────┘         └─────────────┘
       │                        │
       │  1. Discovery          │  4. Token Validation
       │                        │
       ▼                        ▼
┌──────────────┐         ┌──────────────────┐
│  Auth Server  │◀───────│  Protected       │
│  (OAuth 2.1) │         │  Resource        │
└──────────────┘         └──────────────────┘
```

MCP Authorization 的核心思路：

- **MCP Server** 同时充当 OAuth 2.1 的 **Resource Server**（验证 Token）和 **Authorization Server**（签发 Token）
- 或者分离部署：MCP Server 只做 Resource Server，独立的 Auth Server 负责 Token 签发
- **MCP Client**（AI Agent）通过标准 OAuth 2.1 流程获取 Access Token
- 所有通信走 HTTPS，Token 通过 `Authorization: Bearer` 头传递

### 与标准 OAuth 2.1 的差异

MCP Authorization 规范在 OAuth 2.1 基础上做了几个关键约束：

| 特性 | 标准 OAuth 2.1 | MCP Authorization |
|------|---------------|-------------------|
| PKCE | 推荐但可选 | **强制要求** |
| Dynamic Client Registration | 可选 | **必须支持** |
| Token Endpoint Auth | 多种方式 | 仅 `none`（公开客户端） |
| Refresh Token | 可选 | **必须签发** |
| Scope 命名 | 自定义 | 遵循 MCP Tool 命名空间 |

为什么强制 PKCE？因为 MCP Client 通常是公开客户端（CLI 工具、本地 Agent），无法安全存储 client_secret。PKCE 通过 code_verifier/code_challenge 机制防止授权码拦截攻击。

### Discovery 端点

MCP Server 必须暴露一个 **OAuth Metadata** 端点：

```
GET /.well-known/oauth-authorization-server
```

返回 JSON：

```json
{
  "issuer": "https://mcp.example.com",
  "authorization_endpoint": "https://mcp.example.com/oauth/authorize",
  "token_endpoint": "https://mcp.example.com/oauth/token",
  "registration_endpoint": "https://mcp.example.com/oauth/register",
  "scopes_supported": ["tools:read", "tools:write", "resources:read"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"]
}
```

---

## 实战：Laravel 实现 MCP Authorization Server

### 项目结构

```
mcp-auth-server/
├── app/
│   ├── Http/Controllers/
│   │   ├── OAuthController.php          # 授权端点
│   │   ├── TokenController.php          # Token 端点
│   │   ├── RegistrationController.php   # 动态客户端注册
│   │   └── MetadataController.php       # Discovery 端点
│   ├── Models/
│   │   ├── OAuthClient.php              # 客户端模型
│   │   ├── AuthCode.php                 # 授权码模型
│   │   └── AccessToken.php              # Access Token 模型
│   ├── Services/
│   │   └── PKCEVerifier.php             # PKCE 验证
│   └── Middleware/
│       └── McpAuthMiddleware.php        # Token 验证中间件
├── database/migrations/
└── routes/web.php
```

### 数据库设计

```php
// database/migrations/2026_06_10_001_create_oauth_clients_table.php
Schema::create('oauth_clients', function (Blueprint $table) {
    $table->id();
    $table->string('client_id')->unique();
    $table->string('client_name');
    $table->text('redirect_uris');       // JSON 数组
    $table->string('grant_types')->default('authorization_code,refresh_token');
    $table->string('token_endpoint_auth_method')->default('none');
    $table->timestamps();
});

// database/migrations/2026_06_10_002_create_auth_codes_table.php
Schema::create('auth_codes', function (Blueprint $table) {
    $table->id();
    $table->string('code')->unique();
    $table->string('client_id');
    $table->string('user_id')->nullable();
    $table->text('redirect_uri');
    $table->text('scopes')->nullable();          // JSON
    $table->string('code_challenge');
    $table->string('code_challenge_method')->default('S256');
    $table->timestamp('expires_at');
    $table->boolean('used')->default(false);
    $table->timestamps();
});

// database/migrations/2026_06_10_003_create_access_tokens_table.php
Schema::create('access_tokens', function (Blueprint $table) {
    $table->id();
    $table->string('token')->unique();
    $table->string('refresh_token')->unique()->nullable();
    $table->string('client_id');
    $table->string('user_id')->nullable();
    $table->text('scopes')->nullable();          // JSON
    $table->timestamp('expires_at');
    $table->timestamp('refresh_expires_at')->nullable();
    $table->timestamps();
});
```

### 动态客户端注册

MCP Client 首次连接时，通过 Dynamic Registration 获取 client_id：

```php
// app/Http/Controllers/RegistrationController.php
class RegistrationController extends Controller
{
    public function register(Request $request)
    {
        $validated = $request->validate([
            'client_name' => 'required|string|max:255',
            'redirect_uris' => 'required|array|min:1',
            'redirect_uris.*' => 'url',
            'grant_types' => 'array',
            'token_endpoint_auth_method' => 'in:none',
        ]);

        $clientId = 'mcp_' . Str::random(32);

        $client = OAuthClient::create([
            'client_id' => $clientId,
            'client_name' => $validated['client_name'],
            'redirect_uris' => json_encode($validated['redirect_uris']),
            'grant_types' => implode(',', $validated['grant_types'] ?? ['authorization_code', 'refresh_token']),
            'token_endpoint_auth_method' => 'none',
        ]);

        return response()->json([
            'client_id' => $client->client_id,
            'client_name' => $client->client_name,
            'redirect_uris' => json_decode($client->redirect_uris),
            'grant_types' => explode(',', $client->grant_types),
            'token_endpoint_auth_method' => 'none',
        ], 201);
    }
}
```

### 授权端点（Authorization Endpoint）

用户被重定向到这里进行授权：

```php
// app/Http/Controllers/OAuthController.php
class OAuthController extends Controller
{
    public function authorize(Request $request)
    {
        $request->validate([
            'response_type' => 'required|in:code',
            'client_id' => 'required|string',
            'redirect_uri' => 'required|url',
            'code_challenge' => 'required|string|size:43',
            'code_challenge_method' => 'required|in:S256',
            'scope' => 'nullable|string',
            'state' => 'required|string',
        ]);

        $client = OAuthClient::where('client_id', $request->client_id)->firstOrFail();

        // 验证 redirect_uri 是否在注册范围内
        $allowedUris = json_decode($client->redirect_uris, true);
        if (!in_array($request->redirect_uri, $allowedUris)) {
            return response()->json(['error' => 'invalid_redirect_uri'], 400);
        }

        // 实际场景：展示授权页面让用户确认
        // 这里简化为自动授权（适合开发/内部工具）
        $code = Str::random(32);

        AuthCode::create([
            'code' => $code,
            'client_id' => $request->client_id,
            'user_id' => auth()->id() ?? 'anonymous',
            'redirect_uri' => $request->redirect_uri,
            'scopes' => json_encode(explode(' ', $request->scope ?? '')),
            'code_challenge' => $request->code_challenge,
            'code_challenge_method' => $request->code_challenge_method,
            'expires_at' => now()->addMinutes(10),
        ]);

        return redirect($request->redirect_uri . '?' . http_build_query([
            'code' => $code,
            'state' => $request->state,
        ]));
    }
}
```

### Token 端点 + PKCE 验证

这是整个流程的核心——用 code_verifier 验证 code_challenge：

```php
// app/Services/PKCEVerifier.php
class PKCEVerifier
{
    public static function verify(string $verifier, string $challenge, string $method): bool
    {
        if ($method !== 'S256') {
            return false;
        }
        $computed = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        return hash_equals($challenge, $computed);
    }
}

// app/Http/Controllers/TokenController.php
class TokenController extends Controller
{
    public function token(Request $request)
    {
        $request->validate([
            'grant_type' => 'required|in:authorization_code,refresh_token',
            'code' => 'required_if:grant_type,authorization_code',
            'redirect_uri' => 'required_if:grant_type,authorization_code|url',
            'client_id' => 'required|string',
            'code_verifier' => 'required_if:grant_type,authorization_code|string|size:43',
            'refresh_token' => 'required_if:grant_type,refresh_token',
        ]);

        if ($request->grant_type === 'authorization_code') {
            return $this->handleAuthorizationCode($request);
        }

        return $this->handleRefreshToken($request);
    }

    private function handleAuthorizationCode(Request $request)
    {
        $authCode = AuthCode::where('code', $request->code)
            ->where('client_id', $request->client_id)
            ->where('used', false)
            ->firstOrFail();

        // 检查过期
        if ($authCode->expires_at->isPast()) {
            return response()->json(['error' => 'invalid_grant', 'message' => 'Code expired'], 400);
        }

        // 验证 redirect_uri
        if ($authCode->redirect_uri !== $request->redirect_uri) {
            return response()->json(['error' => 'invalid_grant', 'message' => 'Redirect URI mismatch'], 400);
        }

        // PKCE 验证——这是安全的关键
        if (!PKCEVerifier::verify($request->code_verifier, $authCode->code_challenge, $authCode->code_challenge_method)) {
            return response()->json(['error' => 'invalid_grant', 'message' => 'PKCE verification failed'], 400);
        }

        // 标记 code 已使用（一次性）
        $authCode->update(['used' => true]);

        // 签发 Token
        return $this->issueToken($authCode->client_id, $authCode->user_id, json_decode($authCode->scopes, true));
    }

    private function handleRefreshToken(Request $request)
    {
        $token = AccessToken::where('refresh_token', $request->refresh_token)
            ->where('client_id', $request->client_id)
            ->firstOrFail();

        if ($token->refresh_expires_at && $token->refresh_expires_at->isPast()) {
            return response()->json(['error' => 'invalid_grant', 'message' => 'Refresh token expired'], 400);
        }

        // 撤销旧 Token
        $token->delete();

        return $this->issueToken($token->client_id, $token->user_id, json_decode($token->scopes, true));
    }

    private function issueToken(string $clientId, ?string $userId, ?array $scopes)
    {
        $accessToken = Str::random(64);
        $refreshToken = Str::random(64);

        AccessToken::create([
            'token' => hash('sha256', $accessToken),
            'refresh_token' => hash('sha256', $refreshToken),
            'client_id' => $clientId,
            'user_id' => $userId,
            'scopes' => json_encode($scopes),
            'expires_at' => now()->addHour(),
            'refresh_expires_at' => now()->addDays(30),
        ]);

        return response()->json([
            'access_token' => $accessToken,
            'token_type' => 'Bearer',
            'expires_in' => 3600,
            'refresh_token' => $refreshToken,
            'scope' => implode(' ', $scopes ?? []),
        ]);
    }
}
```

### MCP Server 侧的 Token 验证中间件

MCP Server 作为 Resource Server，需要验证 Bearer Token：

```php
// app/Http/Controllers/MetadataController.php
class MetadataController extends Controller
{
    public function metadata()
    {
        return response()->json([
            'issuer' => config('app.url'),
            'authorization_endpoint' => config('app.url') . '/oauth/authorize',
            'token_endpoint' => config('app.url') . '/oauth/token',
            'registration_endpoint' => config('app.url') . '/oauth/register',
            'scopes_supported' => [
                'tools:read',
                'tools:write',
                'tools:admin',
                'resources:read',
                'resources:write',
                'prompts:read',
            ],
            'response_types_supported' => ['code'],
            'grant_types_supported' => ['authorization_code', 'refresh_token'],
            'code_challenge_methods_supported' => ['S256'],
            'token_endpoint_auth_methods_supported' => ['none'],
        ]);
    }
}

// app/Http/Middleware/McpAuthMiddleware.php
class McpAuthMiddleware
{
    public function handle(Request $request, Closure $next, ?string $requiredScope = null)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'error' => 'unauthorized',
                'message' => 'Missing Bearer token',
                'resource_metadata' => config('app.url') . '/.well-known/oauth-authorization-server',
            ], 401, [
                'WWW-Authenticate' => 'Bearer resource_metadata="' . config('app.url') . '/.well-known/oauth-authorization-server"',
            ]);
        }

        $tokenHash = hash('sha256', $token);
        $accessToken = AccessToken::where('token', $tokenHash)
            ->where('expires_at', '>', now())
            ->first();

        if (!$accessToken) {
            return response()->json(['error' => 'invalid_token', 'message' => 'Token expired or invalid'], 401);
        }

        // Scope 检查
        if ($requiredScope) {
            $scopes = json_decode($accessToken->scopes, true) ?? [];
            if (!in_array($requiredScope, $scopes)) {
                return response()->json([
                    'error' => 'insufficient_scope',
                    'message' => "Required scope: {$requiredScope}",
                ], 403);
            }
        }

        // 注入用户上下文
        $request->merge([
            'mcp_user_id' => $accessToken->user_id,
            'mcp_client_id' => $accessToken->client_id,
            'mcp_scopes' => json_decode($accessToken->scopes, true),
        ]);

        return $next($request);
    }
}
```

### 路由配置

```php
// routes/web.php
// Discovery
Route::get('/.well-known/oauth-authorization-server', [MetadataController::class, 'metadata']);

// OAuth 流程
Route::post('/oauth/register', [RegistrationController::class, 'register']);
Route::get('/oauth/authorize', [OAuthController::class, 'authorize']);
Route::post('/oauth/token', [TokenController::class, 'token']);

// MCP 工具端点（受保护）
Route::middleware('mcp.auth:tools:read')->group(function () {
    Route::get('/mcp/tools', [McpController::class, 'listTools']);
    Route::post('/mcp/tools/call', [McpController::class, 'callTool']);
});
```

---

## MCP Client 侧：完整的授权流程

### Python 实现（适配 Claude/Agent 使用）

```python
import hashlib
import base64
import secrets
import requests
from urllib.parse import urlencode

class MCPAuthorizationClient:
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip('/')
        self.metadata = None
        self.access_token = None
        self.refresh_token = None

    def discover(self) -> dict:
        """Step 1: 发现 OAuth 端点"""
        resp = requests.get(f"{self.server_url}/.well-known/oauth-authorization-server")
        resp.raise_for_status()
        self.metadata = resp.json()
        return self.metadata

    def register(self, client_name: str, redirect_uris: list[str]) -> dict:
        """Step 2: 动态客户端注册"""
        resp = requests.post(self.metadata['registration_endpoint'], json={
            'client_name': client_name,
            'redirect_uris': redirect_uris,
            'grant_types': ['authorization_code', 'refresh_token'],
            'token_endpoint_auth_method': 'none',
        })
        resp.raise_for_status()
        return resp.json()

    def generate_pkce(self) -> tuple[str, str]:
        """生成 PKCE code_verifier 和 code_challenge"""
        verifier = secrets.token_urlsafe(32)[:43]
        digest = hashlib.sha256(verifier.encode('ascii')).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')
        return verifier, challenge

    def get_authorization_url(self, client_id: str, redirect_uri: str, scopes: list[str]) -> tuple[str, str]:
        """Step 3: 构建授权 URL"""
        verifier, challenge = self.generate_pkce()
        state = secrets.token_urlsafe(16)

        params = {
            'response_type': 'code',
            'client_id': client_id,
            'redirect_uri': redirect_uri,
            'scope': ' '.join(scopes),
            'state': state,
            'code_challenge': challenge,
            'code_challenge_method': 'S256',
        }

        url = f"{self.metadata['authorization_endpoint']}?{urlencode(params)}"
        return url, verifier

    def exchange_code(self, code: str, client_id: str, redirect_uri: str, code_verifier: str) -> dict:
        """Step 4: 用授权码换 Token（PKCE 验证在这里发生）"""
        resp = requests.post(self.metadata['token_endpoint'], data={
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': redirect_uri,
            'client_id': client_id,
            'code_verifier': code_verifier,
        })
        resp.raise_for_status()
        data = resp.json()
        self.access_token = data['access_token']
        self.refresh_token = data.get('refresh_token')
        return data

    def refresh(self, client_id: str) -> dict:
        """Step 5: 刷新 Token"""
        resp = requests.post(self.metadata['token_endpoint'], data={
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token,
            'client_id': client_id,
        })
        resp.raise_for_status()
        data = resp.json()
        self.access_token = data['access_token']
        self.refresh_token = data.get('refresh_token')
        return data

    def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """Step 6: 带 Token 调用 MCP 工具"""
        resp = requests.post(
            f"{self.server_url}/mcp/tools/call",
            json={'tool': tool_name, 'arguments': arguments},
            headers={'Authorization': f'Bearer {self.access_token}'},
        )
        if resp.status_code == 401:
            # Token 过期，尝试刷新
            self.refresh(client_id=self._client_id)
            resp = requests.post(
                f"{self.server_url}/mcp/tools/call",
                json={'tool': tool_name, 'arguments': arguments},
                headers={'Authorization': f'Bearer {self.access_token}'},
            )
        resp.raise_for_status()
        return resp.json()


# 使用示例
client = MCPAuthorizationClient("https://mcp.example.com")

# 1. 发现
metadata = client.discover()

# 2. 注册
reg = client.register("MyAgent", ["http://localhost:8080/callback"])
client_id = reg['client_id']

# 3. 构建授权 URL（用户在浏览器中打开）
auth_url, verifier = client.get_authorization_url(
    client_id, "http://localhost:8080/callback",
    ["tools:read", "tools:write"]
)
print(f"请在浏览器中打开: {auth_url}")

# 4. 用户授权后，从回调获取 code
code = input("请输入授权码: ")

# 5. 换取 Token（PKCE 验证发生在这里）
token_data = client.exchange_code(code, client_id, "http://localhost:8080/callback", verifier)

# 6. 调用 MCP 工具
result = client.call_tool("database_query", {"sql": "SELECT * FROM users LIMIT 10"})
print(result)
```

---

## Scope 设计：细粒度权限控制

### MCP 命名空间规范

MCP Authorization 的 Scope 遵循 `{resource_type}:{action}` 的命名规范：

```
tools:read          # 列出工具、查看工具描述
tools:write         # 调用工具（执行操作）
tools:admin         # 注册/删除工具
resources:read      # 读取 MCP Resources
resources:write     # 写入 MCP Resources
prompts:read        # 列出 Prompts
prompts:execute     # 执行 Prompts
```

### 实际业务映射

企业场景下，Scope 可以映射到具体业务权限：

```php
// config/mcp-scopes.php
return [
    // 数据库相关工具
    'tools:db:read' => '查询数据库（只读）',
    'tools:db:write' => '写入数据库（INSERT/UPDATE/DELETE）',

    // 支付相关工具
    'tools:payment:read' => '查询订单/支付状态',
    'tools:payment:create' => '创建支付单',
    'tools:payment:refund' => '退款操作',

    // 用户管理工具
    'tools:user:read' => '查询用户信息',
    'tools:user:write' => '修改用户信息',
    'tools:user:delete' => '删除用户账号',

    // 运维工具
    'tools:ops:read' => '查看服务器状态/日志',
    'tools:ops:execute' => '执行运维命令（危险）',
];
```

### 中间件中使用 Scope

```php
// routes/web.php
Route::middleware('mcp.auth:tools:db:read')->group(function () {
    Route::post('/mcp/tools/query', [DbToolController::class, 'query']);
});

Route::middleware('mcp.auth:tools:payment:create')->group(function () {
    Route::post('/mcp/tools/create-payment', [PaymentToolController::class, 'create']);
});

Route::middleware('mcp.auth:tools:ops:execute')->group(function () {
    Route::post('/mcp/tools/exec-command', [OpsToolController::class, 'execute']);
});
```

---

## 安全加固

### 1. 授权码一次性使用

```php
// 在 TokenController 中
$authCode = AuthCode::where('code', $request->code)
    ->where('used', false)
    ->firstOrFail();

// 先标记为已用，再签发 Token（防止并发重复使用）
$authCode->update(['used' => true]);
```

### 2. Token 存储只存 Hash

```php
// 存储时
'token' => hash('sha256', $accessToken),

// 验证时
$tokenHash = hash('sha256', $request->bearerToken());
$accessToken = AccessToken::where('token', $tokenHash)->first();
```

数据库泄露也不会暴露有效 Token。

### 3. PKCE 防止授权码拦截

```python
# 攻击者截获了 code，但没有 code_verifier
# S256 验证：base64url(sha256(verifier)) === challenge
# 暴力破解 43 字符的 base64url 字符串在计算上不可行
```

### 4. Rate Limiting

```php
// 限制 Token 端点的请求频率
Route::post('/oauth/token', [TokenController::class, 'token'])
    ->middleware('throttle:10,1');  // 每分钟最多 10 次

// 限制动态注册
Route::post('/oauth/register', [RegistrationController::class, 'register'])
    ->middleware('throttle:5,60');  // 每小时最多 5 次
```

### 5. Token 自动过期与刷新

```php
// 定期清理过期 Token
// app/Console/Commands/CleanExpiredTokens.php
class CleanExpiredTokens extends Command
{
    protected $signature = 'mcp:clean-tokens';

    public function handle()
    {
        $deleted = AccessToken::where('expires_at', '<', now())->delete();
        $this->info("Cleaned {$deleted} expired tokens");
    }
}

// Kernel.php
$schedule->command('mcp:clean-tokens')->daily();
```

---

## 踩坑记录

### 1. PKCE 的 code_verifier 长度必须是 43

RFC 7636 规定 code_verifier 长度为 43-128 字符。MCP 规范直接固定为 43。如果生成的 verifier 长度不对，S256 验证会直接失败，错误信息很模糊。

```python
# 正确
verifier = secrets.token_urlsafe(32)[:43]

# 错误——长度不是 43
verifier = secrets.token_urlsafe(32)  # 可能是 44 字符
```

### 2. redirect_uri 必须完全匹配

`http://localhost:8080/callback` 和 `http://localhost:8080/callback/` 是两个不同的 URI。注册时用什么，回调时必须用什么，连 trailing slash 都不能差。

### 3. Token 验证要用 hash_equals 防止时序攻击

```php
// 错误
if ($storedToken === $providedToken) { ... }

// 正确
if (hash_equals($storedToken, $providedToken)) { ... }
```

虽然这里用了 SHA256 hash 比较，概率上时序攻击影响不大，但养成好习惯。

### 4. 动态注册要限流

不加限流的动态注册端点是 DDoS 攻击面。攻击者可以疯狂注册客户端，耗尽数据库。务必加 rate limiting。

### 5. Refresh Token 要轮换

每次使用 Refresh Token 换新 Token 时，旧的 Refresh Token 必须失效（Token Rotation）。防止 Refresh Token 泄露后被重复使用。

---

## 与 MCP Gateway 集成

把 Authorization Server 集成到上一篇的 MCP Gateway 中：

```php
// 在 MCP Gateway 的路由中
Route::middleware(['mcp.auth'])->prefix('mcp/v1')->group(function () {
    // 工具发现（tools:read）
    Route::get('/tools', [GatewayController::class, 'listTools']);

    // 工具调用（tools:write + 具体工具 scope）
    Route::post('/tools/{toolName}', [GatewayController::class, 'callTool'])
        ->middleware('mcp.scope:tools:{toolName}');

    // 资源访问（resources:read）
    Route::get('/resources', [GatewayController::class, 'listResources']);
    Route::get('/resources/{uri}', [GatewayController::class, 'readResource']);
});
```

Gateway 层统一做 Token 验证和 Scope 检查，后端 MCP Server 只需信任 Gateway 传递的用户上下文。

---

## 总结

| 维度 | 方案 |
|------|------|
| 协议 | OAuth 2.1 + PKCE（MCP 官方规范） |
| 客户端注册 | Dynamic Client Registration |
| 授权流程 | Authorization Code + PKCE（S256） |
| Token 存储 | SHA256 Hash，数据库不存明文 |
| 权限控制 | MCP 命名空间 Scope |
| 刷新机制 | Refresh Token Rotation |
| 安全加固 | 限流、一次性 Code、Token 自动过期 |

MCP Authorization 规范的核心价值在于**标准化**：Agent 侧只需实现一次 OAuth 2.1 客户端，就能对接所有符合规范的 MCP Server。不再需要为每个 Server 写定制的鉴权逻辑。

对于已有 OAuth 2.0 基础设施的企业，最务实的路径是：让 MCP Server 作为 Resource Server，复用现有的 Authorization Server（Keycloak、Auth0、自建），通过 `.well-known/oauth-authorization-server` 暴露端点即可。

---

> 本文代码示例已上传至 GitHub：[mcp-auth-server-demo](https://github.com/mikeah2011/mcp-auth-server-demo)
