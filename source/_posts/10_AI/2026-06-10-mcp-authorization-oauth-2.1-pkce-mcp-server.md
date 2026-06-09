---
title: MCP Authorization 规范实战：OAuth 2.1 + PKCE 的 MCP Server 鉴权——企业级工具访问控制的工程化方案
date: 2026-06-10 00:04:00
categories:
  - AI
  - MCP
  - 安全
tags:
  - MCP
  - OAuth 2.1
  - PKCE
  - Laravel
  - PHP
  - Agent
  - 工具调用
description: 以企业级 MCP Server 鉴权为背景，结合 OAuth 2.1 + PKCE 授权框架，给出 Laravel/PHP 工程化实现方案，覆盖动态 Client Registration、Token 管理、Scope 与工具访问控制、审计与可观测，以及常见踩坑记录。
---

## 一、概述：为什么 MCP Server 要做 Authorization

MCP（Model Context Protocol）把 LLM Agent 从“只能聊天”推进到“可以调用工具”。当工具从个人开发者的本地脚本变成企业的共享服务时，第一个要解决的问题就是：

- **谁在调用？**
- **它能调哪些工具？**
- **这个调用是合法的、可审计的吗？**

所以 MCP 的 Authorization 并不是“锦上添花”，而是企业落地的门槛。尤其在多租户、多 Agent、多工具的场景下，Authorization 会直接影响架构选择。

本文的定位是**工程实战**，而不是协议科普。核心思路是：

- 以 **OAuth 2.1** 为主干授权协议；
- 通过 **PKCE** 防止授权码被截获；
- 用 Laravel/PHP 落地一个可扩展的 MCP Server 鉴权层；
- 把鉴权结果接入工具访问控制、审计日志和监控。

---

## 二、核心概念：MCP + OAuth 2.1 + PKCE

### 2.1 MCP 的三类角色

在 MCP 生态里，典型的鉴权关系可以简化为三类角色：

- **MCP Server**：暴露工具、资源、Prompt 的服务端；
- **MCP Client**：调用 MCP Server 的应用，比如 AI Agent 运行时、IDE 插件、内部平台；
- **Resource Owner / Tenant**：真正拥有数据和权限的一方，比如企业、租户、用户。

当 Client 代表用户去访问 Server 的工具时，本质上就是一个 OAuth 授权问题。

### 2.2 为什么选 OAuth 2.1 而不是自己造轮子

很多早期 MCP 实现会走“共享 API Key + 内部白名单”的路线。这个方式在个人项目上没问题，在企业场景下会出现几个硬伤：

- 缺乏标准化的授权与撤销机制；
- Token 生命周期不清晰；
- 多系统集成时，每家都要自己造鉴权逻辑；
- 跨团队协作时，权限模型难以统一。

OAuth 2.1 的价值在于它把以下问题标准化了：

- 授权发起与回调；
- Access Token / Refresh Token 的生命周期；
- Client 身份识别；
- Scope 与权限边界；
- PKCE 增强的公开客户端安全性。

简单说，**MCP 解决的是“如何描述工具”，OAuth 2.1 解决的是“谁能调工具、怎么安全地拿到令牌”。**

### 2.3 PKCE 的关键作用

PKCE（Proof Key for Code Exchange）解决的是授权码被截获的风险。

在 MCP 场景里，以下客户端很容易变成“公开客户端”：

- 本地 Agent 运行时；
- 桌面 IDE 插件；
- 前端 Web 应用；
- 浏览器内 Agent UI。

这类 Client 通常拿不到安全的 Client Secret，所以更依赖 PKCE：

- Client 先生成 `code_verifier`；
- 授权请求携带 `code_challenge`；
- 换 Token 时再传回 `code_verifier`；
- Server 校验后才发 Token。

这样即使授权码被截获，没有 verifier 也换不到 Token。

---

## 三、MCP Server 鉴权的工程化设计

### 3.1 总体架构

企业级 MCP Server 的鉴权层通常可以分成四层：

- **身份层**：识别 Client / User / Tenant；
- **授权层**：判断是否允许访问某个工具或资源；
- **令牌层**：签发、刷新、吊销 Token；
- **审计层**：记录调用链、权限变更和异常行为。

对应到技术实现上，可以拆成以下模块：

- `AuthorizationServer`：负责 OAuth 流程；
- `TokenService`：生成、解析、刷新、吊销 Token；
- `ScopeRegistry`：管理 scope 与工具映射；
- `ToolAccessGuard`：在工具调用前做最终拦截；
- `AuditLogger`：记录鉴权和调用事件。

### 3.2 MCP Server 的授权模型

在 MCP 场景中，授权模型通常比传统 REST API 更细。常见粒度有：

- **工具级别**：例如 `tool:search.read`、`tool:payment.create`；
- **资源级别**：例如 `resource:dataset.123.read`；
- **Prompt 模板级别**：例如 `prompt:internal.rag.invoke`；
- **租户级别**：例如 `tenant:acme`；
- **环境级别**：例如 `env:staging`、`env:production`。

一个比较稳的做法是：

1. 在 OAuth 登录时签发**基础 Access Token**；
2. Access Token 里带租户、环境、基础 scope；
3. 调用具体工具时，再做一次**细粒度 scope 校验**；
4. 高风险工具再叠加**二次确认或 MFA**。

这样既能保持标准 OAuth 流程，也能满足 MCP 对工具调用粒度的要求。

### 3.3 授权流程建议

对于 MCP Server，推荐的核心流程是：

- **Authorization Code + PKCE**
- 可选 Client Authentication
- Refresh Token Rotation

典型时序如下：

1. Client 发现 MCP Server 需要登录；
2. Client 跳转到 MCP Server 的授权端点；
3. Server 返回授权页或自动完成企业 SSO；
4. Client 用 `authorization_code` + `code_verifier` 换 Token；
5. Server 校验成功，返回 Access Token 和 Refresh Token；
6. Client 用 Access Token 调用 MCP Server 的工具接口；
7. 过期后用 Refresh Token 换新 Access Token；
8. 可选：检测到 Token 重用时立刻吊销整个 Token Family。

这个模式在 PHP/Laravel 下实现成本不高，同时也能和企业 IdP 对接。

---

## 四、Laravel/PHP 工程化实现

下面给出一个最小但可扩展的 Laravel 实现骨架，重点不是“把所有细节写满”，而是展示企业级 MCP Server 鉴权的核心结构。

### 4.1 数据库设计

MCP Server 的鉴权至少要保留以下几张表：

- `oauth_clients`
- `oauth_auth_codes`
- `oauth_access_tokens`
- `oauth_refresh_tokens`
- `mcp_tool_scopes`
- `mcp_audit_logs`

其中 `oauth_clients` 需要区分：

- 机密客户端（Confidential）；
- 公开客户端（Public）。

公开客户端必须强制 PKCE。

```sql
CREATE TABLE oauth_clients (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type ENUM('confidential','public') NOT NULL DEFAULT 'confidential',
    redirect_uris JSON NOT NULL,
    scopes JSON NOT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,
    UNIQUE KEY (uuid)
) ENGINE=InnoDB;

CREATE TABLE oauth_auth_codes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(128) NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    tenant_id BIGINT UNSIGNED NULL,
    scopes JSON NOT NULL,
    code_challenge VARCHAR(255) NULL,
    code_challenge_method VARCHAR(20) NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP NULL,
    UNIQUE KEY (code)
) ENGINE=InnoDB;

CREATE TABLE oauth_access_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    tenant_id BIGINT UNSIGNED NULL,
    scopes JSON NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP NULL,
    UNIQUE KEY (token)
) ENGINE=InnoDB;

CREATE TABLE oauth_refresh_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    refresh_token VARCHAR(255) NOT NULL,
    access_token_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP NULL,
    UNIQUE KEY (refresh_token)
) ENGINE=InnoDB;

CREATE TABLE mcp_tool_scopes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tool_slug VARCHAR(125) NOT NULL,
    scope VARCHAR(125) NOT NULL,
    created_at TIMESTAMP NULL,
    UNIQUE KEY (tool_slug_scope')
) ENGINE=InnoDB;

CREATE TABLE mcp_audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    actor_type ENUM('client','user','system') NOT NULL,
    actor_id VARCHAR(100) NULL,
    tenant_id BIGINT UNSIGNED NULL,
    tool_slug VARCHAR(125) NULL,
    action VARCHAR(125) NULL,
    ip VARCHAR(45) NULL,
    meta JSON NULL,
    created_at TIMESTAMP NULL,
    KEY idx_event (event_type),
    KEY idx_tenant (tenant_id)
) ENGINE=InnoDB;
```

这个设计不追求极致性能，但能满足企业场景下的审计、扩容和演进需要。

### 4.2 PKCE 校验服务

PKCE 核心逻辑建议独立成一个 Service，便于测试和复用。

```php
<?php

declare(strict_types=1);

namespace App\Services\McpAuth;

use InvalidArgumentException;
use RuntimeException;

final class PkceGuard
{
    public function generateChallenge(): array
    {
        $verifier = bin2hex(random_bytes(32));

        return [
            'code_verifier' => $verifier,
            'code_challenge' => $this->challenge($verifier),
            'code_challenge_method' => 'S256',
        ];
    }

    public function validate(string $verifier, string $challenge, string $method = 'S256'): bool
    {
        if ($method !== 'S256') {
            throw new InvalidArgumentException('Only S256 PKCE method is supported.');
        }

        if (mb_strlen($verifier) < 43 || mb_strlen($verifier) > 128) {
            throw new RuntimeException('Invalid PKCE verifier length.');
        }

        return hash_equals($challenge, $this->challenge($verifier));
    }

    private function challenge(string $verifier): string
    {
        return rtrim(base64_hash('sha256', $verifier, true), '=');
    }
}
```

在企业级实现里，这个类还会带上：

- verifier 长度校验；
- 字符集校验；
- 统一错误码；
- 测试用例。

### 4.3 Token 签发服务

Token 签发建议不要直接依赖第三方包的所有默认逻辑，而是用自己的 Service 做封装，这样更方便：

- 控制 Token 内容；
- 控制 Refresh Token Rotation；
- 对接审计日志；
- 按租户扩展策略。

下面是一个简化示例：

```php
<?php

declare(strict_types=1);

namespace App\Services\McpAuth;

use App\Models\OAuthAccessToken;
use App\Models\OAuthRefreshToken;
use Carbon\Carbon;
use Illuminate\Support\Str;

final class TokenService
{
    public function issueTokenPair(array $payload): array
    {
        $accessToken = $this->createAccessToken($payload);
        $refreshToken = $this->createRefreshToken($accessToken);

        return [
            'access_token' => $accessToken->token,
            'refresh_token' => $refreshToken->refresh_token,
            'token_type' => 'Bearer',
            'expires_in' => $accessToken->expires_at->diffInSeconds(now()),
            'scope' => $payload['scopes'],
        ];
    }

    public function rotateRefreshToken(OAuthRefreshToken $oldRefresh): array
    {
        if ($oldRefresh->revoked_at) {
            $this->revokeTokenFamily($oldRefresh->access_token_id);
            throw new \RuntimeException('Refresh token reuse detected.');
        }

        $oldRefresh->update(['revoked_at' => Carbon::now()]);

        return $this->issueTokenPair([
            'client_id' => $oldRefresh->client_id,
            'user_id' => $oldRefresh->access_token->user_id,
            'tenant_id' => $oldRefresh->access_token->tenant_id,
            'scopes' => $oldRefresh->access_token->scopes,
        ]);
    }

    private function createAccessToken(array $payload): OAuthAccessToken
    {
        return OAuthAccessToken::create([
            'token' => $this->generateToken(),
            'client_id' => $payload['client_id'],
            'user_id' => $payload['user_id'] ?? null,
            'tenant_id' => $payload['tenant_id'] ?? null,
            'scopes' => $payload['scopes'],
            'expires_at' => Carbon::now()->addSeconds(
                $payload['expires_in'] ?? 3600
            ),
        ]);
    }

    private function createRefreshToken(OAuthAccessToken $accessToken): OAuthRefreshToken
    {
        return OAuthRefreshToken::create([
            'refresh_token' => $this->generateToken(),
            'access_token_id' => $accessToken->id,
            'client_id' => $accessToken->client_id,
            'expires_at' => Carbon::now()->addDays(30),
        ]);
    }

    private function generateToken(): string
    {
        return Str::random(80);
    }

    private function revokeTokenFamily(int $accessTokenId): void
    {
        OAuthRefreshToken::where('access_token_id', $accessTokenId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => Carbon::now()]);
    }
}
```

在实际项目里，还会补充：

- JWT 或 opaque token 的选择策略；
- Token 存储加密；
- 多环境签名密钥；
- Token 黑名单机制。

### 4.4 MCP 工具访问控制

OAuth Token 只是“进门”。MCP Server 还要在“调工具”时做二次判断。

这里建议设计一个统一的 `ToolAccessGuard`：

```php
<?php

declare(strict_types=1);

namespace App\Services\McpAuth;

use App\Enums\McpAccessDecision;
use App\Models\McpToolScope;
use App\Models\OAuthAccessToken;

final class ToolAccessGuard
{
    public function authorize(OAuthAccessToken $token, string $toolSlug): McpAccessDecision
    {
        if ($token->revoked_at) {
            return McpAccessDecision::Denied;
        }

        if ($token->expires_at->isPast()) {
            return McpAccessDecision::Expired;
        }

        $requiredScopes = $this->getToolRequiredScopes($toolSlug);
        $grantedScopes = (array) $token->scopes;

        if (!empty($requiredScopes) && empty(array_intersect($requiredScopes, $grantedScopes))) {
            return McpAccessDecision::InsufficientScope;
        }

        if ($this->isTenantMismatch($token, $toolSlug)) {
            return McpAccessDecision::TenantMismatch;
        }

        if ($this->isHighRiskTool($toolSlug)) {
            return McpAccessDecision::RequireStepUp;
        }

        return McpAccessDecision::Allowed;
    }

    private function getToolRequiredScopes(string $toolSlug): array
    {
        return McpToolScope::where('tool_slug', $toolSlug)
            ->pluck('scope')
            ->toArray();
    }

    private function isTenantMismatch(OAuthAccessToken $token, string $toolSlug): bool
    {
        $toolTenantId = $this->resolveToolTenantId($toolSlug);

        if (!$toolTenantId) {
            return false;
        }

        return $token->tenant_id !== $toolTenantId;
    }

    private function isHighRiskTool(string $toolSlug): bool
    {
        $highRiskTools = [
            'tool:payment.initiate',
            'tool:refund.approve',
            'tool:dataset.export',
        ];

        return in_array($toolSlug, $highRiskTools, true);
    }

    private function resolveToolTenantId(string $toolSlug): ?int
    {
        // 工具和租户的绑定关系需要按实际表结构实现
        return null;
    }
}
```

这个 Guard 的价值在于：

- 把鉴权逻辑从 Controller/Action 里解耦出来；
- 方便统一拦截工具调用；
- 方便做监控、限流、审计；
- 方便后续演进成策略引擎。

### 4.5 审计日志记录

企业级 MCP Server 必须有审计。建议至少记录：

- 授权事件；
- Token 签发、刷新、吊销；
- 工具调用成功/失败；
- scope 不足；
- 租户越权；
- 高风险操作。

```php
<?php

declare(strict_types=1);

namespace App\Services\McpAuth;

use Illuminate\Support\Facades\DB;

final class AuditLogger
{
    public function logTokenIssued(array $payload): void
    {
        $this->log('token.issued', $payload);
    }

    public function logToolAccess(array $payload): void
    {
        $this->log('tool.access', $payload);
    }

    public function logToolDenied(array $payload): void
    {
        $this->log('tool.denied', $payload);
    }

    public function logRefreshTokenReuse(array $payload): void
    {
        $this->log('token.refresh_reuse', array_merge($payload, [
            'severity' => 'high',
        ]));
    }

    private function log(string $eventType, array $payload): void
    {
        DB::table('mcp_audit_logs')->insert([
            'event_type' => $eventType,
            'actor_type' => $payload['actor_type'] ?? 'client',
            'actor_id' => $payload['actor_id'] ?? null,
            'tenant_id' => $payload['tenant_id'] ?? null,
            'tool_slug' => $payload['tool_slug'] ?? null,
            'action' => $payload['action'] ?? null,
            'ip' => $payload['ip'] ?? request()->ip(),
            'meta' => json_encode($payload['meta'] ?? []),
            'created_at' => now(),
        ]);
    }
}
```

在高流量系统里，建议把审计日志异步化，避免阻塞主链路。

### 4.6 Middleware 接入示例

Laravel 下可以封装一个 `McpAuthorizeTool` 中间件，用于统一拦截 MCP 工具接口。

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Enums\McpAccessDecision;
use App\Services\McpAuth\AuditLogger;
use App\Services\McpAuth\TokenService;
use App\Services\McpAuth\ToolAccessGuard;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class McpAuthorizeTool
{
    public function __construct(
        private readonly ToolAccessGuard $guard,
        private readonly TokenService $tokenService,
        private readonly AuditLogger $audit,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tokenValue = $request->bearerToken();

        if (!$tokenValue) {
            return response()->json(['error' => 'missing_token'], 401);
        }

        $token = \App\Models\OAuthAccessToken::where('token', $tokenValue)->first();

        if (!$token) {
            return response()->json(['error' => 'invalid_token'], 401);
        }

        $toolSlug = $request->route('toolSlug');

        $decision = $this->guard->authorize($token, $toolSlug);

        if ($decision === McpAccessDecision::Allowed) {
            $this->audit->logToolAccess([
                'actor_type' => $token->user_id ? 'user' : 'client',
                'actor_id' => (string) ($token->user_id ?? $token->client_id),
                'tenant_id' => $token->tenant_id,
                'tool_slug' => $toolSlug,
                'action' => 'invoke',
            ]);

            $request->attributes->set('mcp_token', $token);

            return $next($request);
        }

        $this->audit->logToolDenied([
            'actor_type' => $token->user_id ? 'user' : 'client',
            'actor_id' => (string) ($token->user_id ?? $token->client_id),
            'tenant_id' => $token->tenant_id,
            'tool_slug' => $toolSlug,
            'action' => 'invoke',
            'meta' => ['decision' => $decision->value],
        ]);

        $statusMap = [
            McpAccessDecision::Expired->value => 401,
            McpAccessDecision::Denied->value => 403,
            McpAccessDecision::InsufficientScope->value => 403,
            McpAccessDecision::TenantMismatch->value => 403,
            McpAccessDecision::RequireStepUp->value => 403,
        ];

        $status = $statusMap[$decision->value] ?? 403;

        return response()->json([
            'error' => 'tool_access_denied',
            'decision' => $decision->value,
        ], $status);
    }
}
```

这样做的好处是：

- Controller 只关心业务逻辑；
- 鉴权规则可以集中治理；
- 审计日志天然统一。

---

## 五、企业级 MCP Server 的扩展设计

### 5.1 动态 Client Registration

在多团队协作场景下，建议支持动态 Client Registration。流程可以设计为：

1. 内部团队先在 MCP 平台注册应用；
2. 平台分配 `client_id`；
3. 公开客户端只允许 PKCE；
4. 机密客户端才允许 `client_secret`；
5. 所有 Client 必须绑定环境、租户、owner。

这样后续做权限回收、限流、审计时都有清晰主体。

### 5.2 Token 设计建议

MCP Server 常见有两种 Token 策略：

- **Opaque Token**：实现简单，校验必须查库或查缓存， revoke 更方便；
- **JWT**：自包含，校验快，但 revoke 需要额外机制。

在企业初期，建议优先选：

- Opaque Access Token + 中心化校验；
- Refresh Token Rotation；
- Token 黑名单/吊销列表放在 Redis。

等性能和场景更稳定后，再考虑 JWT + 主动吊销方案。

### 5.3 Scope 策略建议

Scope 设计建议分两层：

- **全局 scope**：决定 Client 能进入哪些能力域；
- **工具 scope**：决定具体工具的读写级别。

例如：

- `mcp:tools.read`
- `mcp:tools.write`
- `mcp:resources.read`
- `mcp:prompts.invoke`

这个方式比直接把所有权限扁平化成一个数组更清晰，也更容易做治理。

### 5.4 MCP Server 多租户鉴权

多租户场景下，Authorization 和数据隔离必须联动。常见策略：

- Token 携带 `tenant_id`；
- 工具调用时校验租户一致性；
- 数据查询层再加租户过滤；
- 高风险操作加强二次验证。

只做“工具鉴权”不够，必须和“数据隔离”一起做，否则很容易出现越权漏洞。

---

## 六、踩坑记录：MCP Authorization 常见问题

### 6.1 忘记强制 PKCE

最常见的坑是公开客户端没有强制 PKCE。本地 Agent、IDE 插件这类客户端通常不适合存 Secret，如果只用 Authorization Code 而不带 PKCE，Token 泄露风险会明显上升。

建议策略：

- Client 类型为 `public` 时，强制要求 `code_challenge`；
- 注册时标记客户端类型；
- 授权端点校验失败直接拒绝。

### 6.2 Refresh Token 不做 Rotation

如果 Refresh Token 长期不变，一旦泄露，攻击者可以持续获取新 Access Token。企业场景建议：

- 每次 Refresh 都签发新 Refresh Token；
- 旧 Refresh Token 标记为 used；
- 检测到重用立即吊销整条 Token Family。

这一步很关键，很多授权系统出问题都出在 Refresh Token 管理上。

### 6.3 Scope 过宽

另一个常见问题是默认给的 Scope 太大，例如直接给 `*`。MCP Server 上线后，工具会越来越多，一旦 Scope 过宽，就越容易出现：

- 越权调用；
- 越权读取资源；
- 审计时看不出真实风险。

建议默认最小权限，再按应用/租户/工具逐步授权。

### 6.4 审计日志只记录成功请求

很多系统只在成功时记日志，失败请求反而不记。但实际排查安全事件时，失败请求往往更有价值。建议记录：

- 授权成功；
- 授权失败；
- Token 刷新失败；
- Scope 不足；
- 高风险工具拦截；
- Refresh Token 重用。

### 6.5 没有把鉴权和工具层解耦

如果鉴权逻辑散落在各个 Controller、Handler、SDK 里，后续升级会非常痛苦。建议统一成 Guard / Middleware / Policy 三层结构，避免业务代码和权限逻辑耦合。

---

## 七、监控与可观测

MCP Server 上线后，Authorization 也需要观测，不能只做“静态权限配置”。建议关注：

- Token 签发 QPS；
- Refresh 成功率；
- Refresh Token 重用告警；
- Scope 拒绝率；
- 工具访问拒绝率；
- 高风险工具调用分布；
- 租户维度异常请求。

这些指标对运维和安全都很重要。尤其是 Refresh Token 重用告警，通常是攻击征兆。

---

## 八、总结

MCP 让 LLM Agent 真正具备了“工具调用能力”，而 Authorization 决定了这个能力是否可控、可审计、可治理。

从工程角度看，企业级 MCP Server 的鉴权重点并不是“发明新协议”，而是把已有标准落到实际系统里。核心做法可以概括为：

- 用 **OAuth 2.1** 作为授权主干；
- 用 **PKCE** 保护公开客户端；
- 用 **Scope + Tool Access Control** 做工具级权限；
- 用 **Refresh Token Rotation** 降低长期泄露风险；
- 用 **审计日志** 和监控形成闭环；
- 用 Laravel/PHP 服务层把鉴权从业务代码中解耦。

一句话总结：

**MCP 负责定义工具，Authorization 负责定义边界。企业级 MCP Server 的竞争力，不在“能调多少工具”，而在“能安全地调哪些工具”。**
