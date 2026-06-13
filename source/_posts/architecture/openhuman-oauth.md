---
title: OpenHuman 插件开发实战：自定义集成与 OAuth 流程
date: 2026-06-02 10:00:00
tags: [OpenHuman, 插件开发, OAuth, 集成, API, AI Agent]
keywords: [OpenHuman, OAuth, 插件开发实战, 自定义集成与, 流程, 架构]
description: 本文是一篇 OpenHuman 插件开发的完整实战指南，系统讲解自定义集成与 OAuth 2.0 授权流程。内容涵盖插件系统架构拆解、插件生命周期管理、PKCE 安全增强、GitHub / Google / Slack 第三方 API 集成示例、token 加密存储与自动刷新、多租户隔离、插件调试测试与灰度发布。无论你是构建 AI Agent 工具链还是扩展企业内部平台集成，都能从中获得可迁移的工程方法与真实踩坑经验。
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


# OpenHuman 插件开发实战：自定义集成与 OAuth 流程

在 AI Agent 从“会聊天”走向“会执行”的阶段，插件系统已经成为决定平台扩展能力的核心部件。一个只会调用内置能力的 Agent，能够处理的场景总是有限；而一个具备插件能力的 Agent，则可以把外部系统、内部平台、团队工作流和第三方 SaaS 全部接到统一执行面板上。OpenHuman 的价值，恰恰就在这里：它并不是把所有能力都硬编码进主程序，而是通过插件机制，把“连接能力、授权能力、工具能力、上下文能力”解耦出来，让开发者可以围绕具体业务场景快速扩展。

这篇文章不是泛泛而谈的“什么是插件”，而是一篇偏工程实践的长文。我们会围绕 **OpenHuman 插件系统架构、插件生命周期管理、自定义集成开发步骤、OAuth 2.0 授权码流程实现（含 PKCE）、GitHub / Google / Slack 第三方 API 集成示例、插件调试测试、发布流程以及真实踩坑记录** 展开。文中会包含大量配置、伪代码、Node.js/TypeScript 示例与接口设计建议，目标是让你不仅知道“应该怎么做”，还知道“为什么要这样做”。

> 说明：本文示例采用较通用的 OpenHuman 插件开发模型来讲解，重点放在可迁移的工程方法，而不是依赖某个特定版本的私有实现细节。即便后续框架接口有微调，整体设计思路仍然成立。

---

## 一、为什么 OpenHuman 插件开发会绕不开 OAuth 与自定义集成

AI Agent 平台做集成时，通常会面临三类需求：

1. **无状态公开接口调用**：例如调用天气、公开知识库、无需用户授权的 REST API。
2. **系统级服务账号集成**：例如平台统一配置一个内部 API Key，供所有用户调用某个后端服务。
3. **用户级授权访问**：例如访问用户自己的 GitHub 仓库、Google Drive 文件、Slack Workspace 数据。

前两类相对简单，难点主要在 API 适配与稳定性；第三类则会迅速引出以下问题：

- 如何把用户从 OpenHuman 跳转到第三方授权页？
- 如何安全地处理回调与临时 code？
- 如何存储 access token 和 refresh token？
- 如何做多租户隔离？
- 如何在插件调用时自动刷新过期 token？
- 如何避免把授权逻辑写死在插件业务逻辑里？

这就是为什么一个真正可落地的插件系统，必须把 **插件运行协议、认证策略、连接配置和生命周期管理** 设计成一等公民。

---

## 二、OpenHuman 插件系统架构拆解

从工程角度看，一个完整的插件系统，至少包含以下层次：

```text
┌────────────────────────────────────────────┐
│                OpenHuman Core              │
│  对话编排 / Agent Runtime / Tool Router    │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│              Plugin Host Layer             │
│  插件注册 / 清单加载 / 生命周期回调 / 鉴权桥接 │
└────────────────────────────────────────────┘
                    │
     ┌──────────────┼───────────────┐
     ▼              ▼               ▼
┌───────────┐ ┌────────────┐ ┌──────────────┐
│ Tool 插件  │ │ Auth 插件   │ │ Integration 插件 │
│命令/动作层 │ │授权与凭证层  │ │第三方 API 适配层 │
└───────────┘ └────────────┘ └──────────────┘
     │              │               │
     └──────────────┴───────┬───────┘
                            ▼
                 ┌────────────────────┐
                 │ External Services   │
                 │ GitHub/Google/Slack │
                 └────────────────────┘
```

### 2.1 核心角色划分

在实践中，我建议把 OpenHuman 插件拆成四个明确角色：

#### 1）Manifest / Plugin Metadata
描述插件是谁、暴露哪些能力、需要哪些权限、依赖什么配置。

例如：

```json
{
  "id": "openhuman-github",
  "name": "GitHub Integration",
  "version": "1.0.0",
  "description": "为 OpenHuman 提供 GitHub 仓库、Issue、PR 操作能力",
  "entry": "dist/index.js",
  "auth": {
    "type": "oauth2",
    "provider": "github",
    "scopes": ["repo", "read:user", "workflow"]
  },
  "tools": [
    "github.list_repos",
    "github.create_issue",
    "github.get_pull_request"
  ],
  "config": {
    "required": ["clientId", "clientSecret", "redirectUri"]
  }
}
```

#### 2）Runtime Adapter
负责把 OpenHuman 的调用协议映射到插件内部实现，比如：

- 输入参数校验
- 上下文注入
- 用户身份与租户信息绑定
- 错误统一格式化
- 超时、重试、熔断

#### 3）Auth Provider
将 OAuth、API Key、Service Account 等认证方式抽象成统一接口，避免业务工具函数里到处出现 `if (provider === 'github')` 之类的分支地狱。

```ts
export interface CredentialProvider {
  getAccessToken(input: {
    userId: string;
    tenantId?: string;
    connectionId?: string;
  }): Promise<string>;

  refreshIfNeeded(input: {
    userId: string;
    tenantId?: string;
    connectionId?: string;
  }): Promise<void>;

  revoke?(input: {
    userId: string;
    tenantId?: string;
    connectionId?: string;
  }): Promise<void>;
}
```

#### 4）Tool Handlers
真正执行业务动作，例如“列出仓库”“查询邮件”“发送 Slack 消息”。

它们不应该自己处理 OAuth 细节，只接收已准备好的 token 或 API client：

```ts
export async function listRepos(ctx: PluginContext, input: { visibility?: string }) {
  const token = await ctx.credentials.getAccessToken({
    userId: ctx.user.id,
    tenantId: ctx.tenant?.id,
    connectionId: ctx.connection.id
  });

  const resp = await fetch("https://api.github.com/user/repos?per_page=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json"
    }
  });

  if (!resp.ok) {
    throw new Error(`GitHub API failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.map((repo: any) => ({
    name: repo.full_name,
    private: repo.private,
    url: repo.html_url
  }));
}
```

### 2.2 为什么插件系统必须是“清单驱动”

很多团队一开始做插件，喜欢直接在代码里注册：

```ts
registerPlugin({ name: "github", handler: githubPlugin });
registerPlugin({ name: "slack", handler: slackPlugin });
```

这在 3 个插件时没问题，到了 30 个插件就会出现几个严重问题：

- 平台侧看不到插件声明信息，无法做权限审计。
- UI 层无法根据元信息渲染“连接/未连接/需要授权”的状态。
- 无法静态校验配置缺失。
- 插件版本升级与兼容性无法管理。

因此更好的做法是 **manifest-first**：先定义清单，再加载运行时。

一个更完整的 manifest 示例：

```yaml
id: openhuman-slack
name: Slack Workspace Connector
version: 1.2.0
description: 将 Slack 消息、频道、用户检索与发送能力接入 OpenHuman
entry: dist/index.js
minimumCoreVersion: 0.9.0
icon: ./assets/slack.png
homepage: https://example.com/plugins/slack
keywords:
  - slack
  - collaboration
  - messaging
auth:
  type: oauth2
  provider: slack
  authorizationUrl: https://slack.com/oauth/v2/authorize
  tokenUrl: https://slack.com/api/oauth.v2.access
  scopes:
    - channels:history
    - channels:read
    - chat:write
    - users:read
  pkce: true
configSchema:
  type: object
  required:
    - clientId
    - clientSecret
    - redirectUri
  properties:
    clientId:
      type: string
    clientSecret:
      type: string
      secret: true
    redirectUri:
      type: string
tools:
  - name: slack.post_message
    description: 发送消息到指定 Slack 频道
    inputSchema:
      type: object
      required: [channel, text]
      properties:
        channel:
          type: string
        text:
          type: string
  - name: slack.search_messages
    description: 检索最近消息
    inputSchema:
      type: object
      required: [query]
      properties:
        query:
          type: string
```

---

## 三、插件生命周期管理：从安装到卸载不能只靠一堆脚本

如果说 OAuth 解决的是“能不能连上”，那么生命周期管理解决的是“连上之后会不会乱”。

### 3.1 建议的生命周期阶段

一个可维护的 OpenHuman 插件建议具备以下阶段：

1. **discover**：被平台发现
2. **install**：安装依赖、写入元数据
3. **validate**：检查清单和配置
4. **initialize**：初始化运行环境
5. **authorize**：建立用户或系统授权
6. **activate**：暴露工具能力
7. **execute**：实际调用
8. **refresh**：刷新凭证或缓存
9. **deactivate**：停用但不删除数据
10. **uninstall**：卸载清理

### 3.2 生命周期接口设计

```ts
export interface OpenHumanPlugin {
  manifest: PluginManifest;

  onInstall?(ctx: PluginSystemContext): Promise<void>;
  onValidate?(ctx: PluginSystemContext): Promise<void>;
  onInit?(ctx: PluginSystemContext): Promise<void>;
  onAuthorize?(ctx: AuthorizationContext): Promise<AuthResult>;
  onActivate?(ctx: PluginActivationContext): Promise<void>;
  onExecute?(ctx: ToolExecutionContext): Promise<any>;
  onRefreshCredentials?(ctx: CredentialRefreshContext): Promise<void>;
  onDeactivate?(ctx: PluginSystemContext): Promise<void>;
  onUninstall?(ctx: PluginSystemContext): Promise<void>;
}
```

### 3.3 生命周期中的关键动作

#### 安装阶段

安装阶段不要做用户级授权。它只应该做：

- 注册插件元数据
- 检查 entry 文件存在
- 校验配置 schema
- 准备数据库表/索引（如需要）
- 检测依赖 SDK 可用性

```ts
async function onInstall(ctx: PluginSystemContext) {
  ctx.logger.info("Installing plugin", { id: ctx.manifest.id });

  if (!ctx.manifest.entry) {
    throw new Error("Plugin entry is required");
  }

  await ctx.storage.set(`plugin:${ctx.manifest.id}:installedAt`, new Date().toISOString());
}
```

#### 初始化阶段

初始化适合创建单例资源，例如 HTTP client、schema validator、缓存实例。

```ts
async function onInit(ctx: PluginSystemContext) {
  ctx.container.register("httpClient", createHttpClient({
    timeout: 15000,
    retries: 2,
    userAgent: `OpenHuman/${ctx.coreVersion} ${ctx.manifest.id}/${ctx.manifest.version}`
  }));
}
```

#### 激活阶段

只有通过配置校验和权限检查后才应该激活工具。

```ts
async function onActivate(ctx: PluginActivationContext) {
  for (const tool of ctx.manifest.tools) {
    ctx.toolRegistry.register(tool.name, async (input) => {
      return ctx.executor.execute(tool.name, input);
    });
  }
}
```

#### 卸载阶段

卸载要区分“停用”和“彻底删除”。

- 停用：插件对用户不可见，但授权关系保留。
- 卸载：删除缓存、吊销 token、清理连接记录。

```ts
async function onUninstall(ctx: PluginSystemContext) {
  const connections = await ctx.connectionStore.listByPlugin(ctx.manifest.id);
  for (const conn of connections) {
    try {
      await ctx.credentials.revoke({
        userId: conn.userId,
        tenantId: conn.tenantId,
        connectionId: conn.id
      });
    } catch (e) {
      ctx.logger.warn("Failed to revoke token", { connectionId: conn.id, error: String(e) });
    }
  }

  await ctx.connectionStore.deleteByPlugin(ctx.manifest.id);
}
```

---

## 四、自定义集成开发步骤：从需求到可执行插件

下面用一个“GitHub 仓库助手”插件为例，走一遍典型开发流程。

### 4.1 第一步：定义业务边界

先不要急着写 OAuth。先回答四个问题：

1. 这个插件解决什么业务问题？
2. 它面向系统账号还是终端用户？
3. 需要只读还是读写权限？
4. 失败时的最小可降级能力是什么？

例如 GitHub 插件可以定义为：

- 功能：列出仓库、读 PR、创建 Issue、触发 workflow
- 授权方式：用户级 OAuth
- 最小权限：`read:user`、`repo`、`workflow`
- 降级：未授权时只能返回“请先连接 GitHub”而不是让工具崩溃

### 4.2 第二步：建立目录结构

推荐目录：

```text
openhuman-github-plugin/
├── src/
│   ├── auth/
│   │   ├── oauth.ts
│   │   ├── pkce.ts
│   │   └── token-store.ts
│   ├── tools/
│   │   ├── list-repos.ts
│   │   ├── create-issue.ts
│   │   └── get-pull-request.ts
│   ├── clients/
│   │   └── github-client.ts
│   ├── schemas/
│   │   └── manifest.ts
│   ├── index.ts
│   └── types.ts
├── plugin.yaml
├── package.json
├── tsconfig.json
└── README.md
```

### 4.3 第三步：定义插件入口

```ts
import { z } from "zod";
import { startOAuth, completeOAuth, refreshTokenIfNeeded } from "./auth/oauth";
import { listRepos } from "./tools/list-repos";
import { createIssue } from "./tools/create-issue";
import { getPullRequest } from "./tools/get-pull-request";

const toolInputSchemas = {
  "github.list_repos": z.object({
    visibility: z.enum(["all", "public", "private"]).optional()
  }),
  "github.create_issue": z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string().optional()
  }),
  "github.get_pull_request": z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number()
  })
};

export default {
  manifest: {
    id: "openhuman-github",
    name: "GitHub Integration",
    version: "1.0.0"
  },

  async onAuthorize(ctx: any) {
    if (ctx.phase === "start") return startOAuth(ctx);
    if (ctx.phase === "callback") return completeOAuth(ctx);
    throw new Error(`Unknown authorization phase: ${ctx.phase}`);
  },

  async onExecute(ctx: any) {
    await refreshTokenIfNeeded(ctx);

    const schema = toolInputSchemas[ctx.toolName as keyof typeof toolInputSchemas];
    const input = schema.parse(ctx.input);

    switch (ctx.toolName) {
      case "github.list_repos":
        return listRepos(ctx, input);
      case "github.create_issue":
        return createIssue(ctx, input);
      case "github.get_pull_request":
        return getPullRequest(ctx, input);
      default:
        throw new Error(`Unknown tool: ${ctx.toolName}`);
    }
  }
};
```

### 4.4 第四步：做统一错误模型

集成插件最怕“第三方返回什么，你就把什么抛给上层”，这样 Agent 很难判断错误是否可恢复。

建议定义统一错误类型：

```ts
export class PluginError extends Error {
  code: string;
  status?: number;
  retriable?: boolean;
  details?: unknown;

  constructor(input: {
    code: string;
    message: string;
    status?: number;
    retriable?: boolean;
    details?: unknown;
  }) {
    super(input.message);
    this.code = input.code;
    this.status = input.status;
    this.retriable = input.retriable;
    this.details = input.details;
  }
}
```

映射第三方错误：

```ts
export async function assertApiResponse(resp: Response) {
  if (resp.ok) return;

  const text = await resp.text();

  if (resp.status === 401) {
    throw new PluginError({
      code: "UNAUTHORIZED",
      message: "第三方授权已失效，请重新连接账号",
      status: 401,
      retriable: false,
      details: text
    });
  }

  if (resp.status === 429) {
    throw new PluginError({
      code: "RATE_LIMITED",
      message: "第三方接口触发限流，请稍后重试",
      status: 429,
      retriable: true,
      details: text
    });
  }

  throw new PluginError({
    code: "UPSTREAM_ERROR",
    message: `第三方接口调用失败: ${resp.status}`,
    status: resp.status,
    retriable: resp.status >= 500,
    details: text
  });
}
```

---

## 五、OAuth 2.0 授权码流程实现：为什么 PKCE 现在是默认项

当插件要访问用户在第三方平台上的私有资源时，最标准的方案就是 **OAuth 2.0 Authorization Code Flow**。而在 2026 年的工程实践里，如果你还没把 PKCE 当默认配置，基本等于在给自己埋坑。

### 5.1 OAuth 授权码流程回顾

标准授权码流程步骤如下：

```text
用户 → OpenHuman → 第三方授权页 → 回调到 OpenHuman → 用 code 换 token → 存储 token → 插件使用 token 调 API
```

更详细一点：

1. 用户点击“连接 GitHub / Google / Slack”
2. OpenHuman 生成 `state`、`code_verifier`、`code_challenge`
3. 浏览器跳转到第三方 `authorization_endpoint`
4. 用户登录并同意授权
5. 第三方回调 `redirect_uri?code=...&state=...`
6. OpenHuman 校验 `state`
7. OpenHuman 携带 `code_verifier` 请求 `token_endpoint`
8. 获得 `access_token` / `refresh_token`
9. 加密保存凭证
10. 后续插件调用时自动取 token，必要时刷新

### 5.2 为什么一定要用 state

`state` 不是可选装饰，而是 CSRF 防护核心。至少包含：

- userId
- pluginId
- nonce
- timestamp
- redirect hint（可选）

推荐不要直接把 JSON 明文塞进 state，而是先签名或存储到服务端。

```ts
import crypto from "node:crypto";

export function generateState(payload: Record<string, unknown>) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const raw = JSON.stringify({ ...payload, nonce, ts: Date.now() });
  return Buffer.from(raw).toString("base64url");
}
```

更安全的做法是只发一个随机引用：

```ts
export async function createStateRef(store: any, payload: Record<string, unknown>) {
  const state = crypto.randomBytes(24).toString("base64url");
  await store.set(`oauth_state:${state}`, JSON.stringify(payload), { ttl: 600 });
  return state;
}
```

### 5.3 PKCE 生成逻辑

PKCE 的关键是两个值：

- `code_verifier`：高熵随机串
- `code_challenge`：对 verifier 做 SHA-256 后 base64url 编码

Node.js 实现：

```ts
import crypto from "node:crypto";

export function generateCodeVerifier() {
  return crypto.randomBytes(64).toString("base64url");
}

export function generateCodeChallenge(verifier: string) {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
```

### 5.4 启动授权：构造 authorization URL

```ts
export async function startOAuth(ctx: any) {
  const state = await ctx.oauthStore.createState({
    userId: ctx.user.id,
    pluginId: ctx.plugin.id,
    tenantId: ctx.tenant?.id,
    createdAt: Date.now()
  });

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await ctx.oauthStore.setCodeVerifier(state, codeVerifier, 600);

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", ctx.config.clientId);
  url.searchParams.set("redirect_uri", ctx.config.redirectUri);
  url.searchParams.set("scope", "repo read:user workflow");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    type: "redirect",
    url: url.toString()
  };
}
```

### 5.5 处理回调：用 code 换 token

```ts
export async function completeOAuth(ctx: any) {
  const { code, state } = ctx.request.query;
  if (!code || !state) {
    throw new Error("Missing code or state");
  }

  const savedState = await ctx.oauthStore.getState(state);
  if (!savedState) {
    throw new Error("Invalid or expired state");
  }

  const codeVerifier = await ctx.oauthStore.getCodeVerifier(state);
  if (!codeVerifier) {
    throw new Error("Missing PKCE code_verifier");
  }

  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({
      client_id: ctx.config.clientId,
      client_secret: ctx.config.clientSecret,
      code,
      redirect_uri: ctx.config.redirectUri,
      code_verifier: codeVerifier
    })
  });

  const tokenData = await tokenResp.json();

  if (!tokenResp.ok || tokenData.error) {
    throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  await ctx.connectionStore.save({
    pluginId: ctx.plugin.id,
    userId: savedState.userId,
    tenantId: savedState.tenantId,
    provider: "github",
    accessToken: await ctx.secrets.encrypt(tokenData.access_token),
    refreshToken: tokenData.refresh_token
      ? await ctx.secrets.encrypt(tokenData.refresh_token)
      : null,
    scope: tokenData.scope,
    expiresAt: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null
  });

  await ctx.oauthStore.consume(state);

  return {
    type: "success",
    message: "GitHub 账号连接成功"
  };
}
```

### 5.6 刷新 token 的正确姿势

很多开发者只写首次授权，不写刷新；上线后过几天才发现全部调用 401。刷新流程必须进入插件基础设施层。

```ts
export async function refreshTokenIfNeeded(ctx: any) {
  const connection = await ctx.connectionStore.getActiveConnection({
    pluginId: ctx.plugin.id,
    userId: ctx.user.id,
    tenantId: ctx.tenant?.id
  });

  if (!connection) {
    throw new Error("No active OAuth connection found");
  }

  if (!connection.expiresAt) return;

  const expiresSoon = new Date(connection.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return;

  if (!connection.refreshToken) {
    throw new Error("Access token expired and refresh token is missing");
  }

  const refreshToken = await ctx.secrets.decrypt(connection.refreshToken);

  const resp = await fetch(ctx.auth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ctx.config.clientId,
      client_secret: ctx.config.clientSecret
    })
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Refresh token failed: ${JSON.stringify(data)}`);
  }

  await ctx.connectionStore.update(connection.id, {
    accessToken: await ctx.secrets.encrypt(data.access_token),
    refreshToken: data.refresh_token
      ? await ctx.secrets.encrypt(data.refresh_token)
      : connection.refreshToken,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null
  });
}
```

### 5.7 OAuth 流程中的安全基线

至少做到以下几点：

- `state` 必须校验且一次性使用。
- `code_verifier` 不要写到前端本地存储里长期保存。
- token 必须加密存储，不能明文入库。
- 回调地址必须精准匹配，避免通配或临时地址泄露。
- refresh token 轮换时要覆盖旧值。
- 日志中永远不要打印 access token / refresh token。
- 多租户场景要把 `tenantId + userId + pluginId` 作为连接主键的一部分。

---

## 六、第三方 API 集成示例一：GitHub

GitHub 是最适合演示插件模式的平台，因为它的资源模型清晰，API 文档完整，授权场景也贴近开发者日常。

### 6.1 GitHub 插件配置

```yaml
auth:
  type: oauth2
  provider: github
  authorizationUrl: https://github.com/login/oauth/authorize
  tokenUrl: https://github.com/login/oauth/access_token
  scopes:
    - repo
    - read:user
    - workflow
  pkce: true
```

### 6.2 创建 GitHub API 客户端

```ts
export function createGitHubClient(token: string) {
  return {
    async request(path: string, init: RequestInit = {}) {
      const resp = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.headers || {})
        }
      });

      await assertApiResponse(resp);
      return resp.json();
    }
  };
}
```

### 6.3 列出仓库

```ts
export async function listRepos(ctx: any, input: { visibility?: string }) {
  const token = await ctx.credentials.getAccessToken({
    userId: ctx.user.id,
    tenantId: ctx.tenant?.id,
    connectionId: ctx.connection?.id
  });

  const client = createGitHubClient(token);
  const qs = new URLSearchParams({
    per_page: "100",
    visibility: input.visibility || "all"
  });

  const repos = await client.request(`/user/repos?${qs.toString()}`);

  return repos.map((repo: any) => ({
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    url: repo.html_url
  }));
}
```

### 6.4 创建 Issue

```ts
export async function createIssue(ctx: any, input: {
  owner: string;
  repo: string;
  title: string;
  body?: string;
}) {
  const token = await ctx.credentials.getAccessToken({
    userId: ctx.user.id,
    tenantId: ctx.tenant?.id,
    connectionId: ctx.connection?.id
  });

  const client = createGitHubClient(token);
  const issue = await client.request(`/repos/${input.owner}/${input.repo}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      body: input.body
    })
  });

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state
  };
}
```

### 6.5 实战建议

- GitHub 的 scope 不要一开始就申请 `admin:*` 级权限。
- 对 PR、Issue、Repo 等对象做字段裁剪，避免把太多无用字段暴露给 Agent。
- 对写操作增加幂等策略，比如在请求头带上自定义 `Idempotency-Key`，或者业务层先查重。

---

## 七、第三方 API 集成示例二：Google

Google 的难点不在“能不能调通”，而在它的授权粒度、refresh token 获取规则和不同 API 的差异性。

### 7.1 Google OAuth 常见参数

如果你要获得 refresh token，通常需要：

- `access_type=offline`
- `prompt=consent`（某些场景首次后不会再发 refresh token）

构造授权 URL：

```ts
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.searchParams.set("client_id", config.clientId);
url.searchParams.set("redirect_uri", config.redirectUri);
url.searchParams.set("response_type", "code");
url.searchParams.set("scope", [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly"
].join(" "));
url.searchParams.set("state", state);
url.searchParams.set("access_type", "offline");
url.searchParams.set("prompt", "consent");
url.searchParams.set("code_challenge", codeChallenge);
url.searchParams.set("code_challenge_method", "S256");
```

### 7.2 获取用户资料

```ts
async function getGoogleProfile(accessToken: string) {
  const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  await assertApiResponse(resp);
  const data = await resp.json();
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture
  };
}
```

### 7.3 读取 Google Drive 文件列表

```ts
async function listDriveFiles(accessToken: string) {
  const resp = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime,webViewLink)",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  await assertApiResponse(resp);
  const data = await resp.json();
  return data.files;
}
```

### 7.4 Google 集成常见坑

- 同一个 Google 应用在测试模式下，未加入测试用户的账号无法授权。
- 如果用户已经授权过，后续不一定还能拿到 refresh token，需要引导重新 consent。
- 不同 Google API 的 quota 和错误结构不完全一致，不能只依赖通用错误解析。

---

## 八、第三方 API 集成示例三：Slack

Slack 的特点是“一个工作区就是一个边界”。你不仅要知道“哪个用户授权了”，还要知道“授权的是哪个 workspace”。

### 8.1 Slack OAuth 配置

```yaml
auth:
  type: oauth2
  provider: slack
  authorizationUrl: https://slack.com/oauth/v2/authorize
  tokenUrl: https://slack.com/api/oauth.v2.access
  scopes:
    - channels:read
    - channels:history
    - chat:write
    - users:read
  pkce: true
```

### 8.2 Slack token 返回结构处理

Slack 的 token 交换不是简单标准字段，有时会包含 team、authed_user 等嵌套结构。

```ts
async function exchangeSlackToken(input: {
  code: string;
  codeVerifier: string;
  config: { clientId: string; clientSecret: string; redirectUri: string };
}) {
  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.config.redirectUri,
      code_verifier: input.codeVerifier
    })
  });

  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`Slack token exchange failed: ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    scope: data.scope,
    botUserId: data.bot_user_id,
    teamId: data.team?.id,
    teamName: data.team?.name,
    authedUserId: data.authed_user?.id
  };
}
```

### 8.3 发送消息

```ts
async function postSlackMessage(accessToken: string, channel: string, text: string) {
  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ channel, text })
  });

  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return {
    channel: data.channel,
    ts: data.ts,
    message: data.message?.text
  };
}
```

### 8.4 Slack 特殊注意事项

- Slack scope 变化后，通常需要用户重新安装或重新授权应用。
- Workspace 维度的数据隔离要体现在连接模型中。
- 某些 API 返回 HTTP 200，但 JSON 里的 `ok` 为 `false`，不能只看 HTTP 状态码。

---

## 九、凭证存储设计：不要把“接入成功”建立在明文 token 上

插件系统上线后，最大风险往往不来自代码，而来自凭证管理草率。

### 9.1 连接模型建议

```ts
export interface PluginConnection {
  id: string;
  pluginId: string;
  provider: string;
  userId: string;
  tenantId?: string;
  externalAccountId?: string;
  externalAccountName?: string;
  workspaceId?: string;
  scope?: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
```

### 9.2 加密封装

```ts
export interface SecretManager {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}
```

一个简单的 Node 示例：

```ts
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

export function createSecretManager(masterKeyBase64: string): SecretManager {
  const key = Buffer.from(masterKeyBase64, "base64");

  return {
    async encrypt(value: string) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(ALGO, key, iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    },

    async decrypt(payload: string) {
      const raw = Buffer.from(payload, "base64");
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const encrypted = raw.subarray(28);
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    }
  };
}
```

### 9.3 日志脱敏

```ts
function redactSecrets(input: string) {
  return input
    .replace(/access_token=([^&\s]+)/g, "access_token=[REDACTED]")
    .replace(/refresh_token=([^&\s]+)/g, "refresh_token=[REDACTED]")
    .replace(/"access_token":"[^"]+"/g, '"access_token":"[REDACTED]"')
    .replace(/"refresh_token":"[^"]+"/g, '"refresh_token":"[REDACTED]"');
}
```

---

## 十、插件调试与测试：不做这部分，OAuth 成功一次不代表插件可上线

插件开发最常见的误判是：浏览器点一次授权成功，就以为集成完成。实际上，真正的问题通常在异常路径和续期路径里。

### 10.1 本地调试建议

建议本地至少准备以下环境变量：

```bash
export OPENHUMAN_PLUGIN_ENV=development
export OPENHUMAN_BASE_URL=http://localhost:8787
export OPENHUMAN_ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
export GITHUB_CLIENT_ID=xxx
export GITHUB_CLIENT_SECRET=xxx
export GITHUB_REDIRECT_URI=http://localhost:8787/oauth/callback/github
```

### 10.2 使用 ngrok / cloudflared 调试回调

因为很多 OAuth 平台要求公网回调地址，本地调试时常用隧道工具：

```bash
ngrok http 8787
# 或者
cloudflared tunnel --url http://localhost:8787
```

然后把得到的 HTTPS 地址配置到 OAuth 应用的 redirect URI。

### 10.3 为 OAuth 流程写集成测试

```ts
import { describe, it, expect, vi } from "vitest";
import { completeOAuth } from "../src/auth/oauth";

describe("completeOAuth", () => {
  it("should exchange code and save connection", async () => {
    const ctx = {
      request: { query: { code: "abc", state: "state-1" } },
      oauthStore: {
        getState: vi.fn().mockResolvedValue({ userId: "u1", tenantId: "t1" }),
        getCodeVerifier: vi.fn().mockResolvedValue("verifier-1"),
        consume: vi.fn().mockResolvedValue(undefined)
      },
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://example.com/callback"
      },
      plugin: { id: "openhuman-github" },
      secrets: {
        encrypt: vi.fn().mockImplementation(async (v) => `enc:${v}`)
      },
      connectionStore: {
        save: vi.fn().mockResolvedValue(undefined)
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token-1",
        refresh_token: "refresh-1",
        scope: "repo",
        expires_in: 3600
      })
    } as any);

    const result = await completeOAuth(ctx);

    expect(result.type).toBe("success");
    expect(ctx.connectionStore.save).toHaveBeenCalled();
    expect(ctx.oauthStore.consume).toHaveBeenCalledWith("state-1");
  });
});
```

### 10.4 模拟 token 过期测试

```ts
it("should refresh access token when expired soon", async () => {
  const ctx = {
    plugin: { id: "openhuman-google" },
    user: { id: "u1" },
    tenant: { id: "t1" },
    auth: { tokenUrl: "https://oauth2.googleapis.com/token" },
    config: { clientId: "cid", clientSecret: "csecret" },
    connectionStore: {
      getActiveConnection: vi.fn().mockResolvedValue({
        id: "conn-1",
        refreshToken: "enc:refresh",
        expiresAt: new Date(Date.now() + 30 * 1000).toISOString()
      }),
      update: vi.fn().mockResolvedValue(undefined)
    },
    secrets: {
      decrypt: vi.fn().mockResolvedValue("refresh-token"),
      encrypt: vi.fn().mockImplementation(async (v) => `enc:${v}`)
    }
  };

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 7200
    })
  } as any);

  await refreshTokenIfNeeded(ctx);

  expect(ctx.connectionStore.update).toHaveBeenCalled();
});
```

### 10.5 必测场景清单

建议至少覆盖：

- state 缺失
- state 过期
- code_verifier 丢失
- token endpoint 返回 400
- refresh token 已失效
- 第三方 API 429 限流
- 第三方 API 5xx 重试
- 用户撤销授权后的调用行为
- 多租户下错误串用连接

### 10.6 可观测性设计

建议在插件层打以下指标：

- `plugin_auth_start_total`
- `plugin_auth_success_total`
- `plugin_auth_failure_total`
- `plugin_token_refresh_total`
- `plugin_tool_execute_total`
- `plugin_tool_execute_failed_total`
- `plugin_upstream_latency_ms`

日志字段至少包括：

```json
{
  "pluginId": "openhuman-slack",
  "toolName": "slack.post_message",
  "userId": "u_123",
  "tenantId": "t_001",
  "connectionId": "conn_789",
  "requestId": "req_abc",
  "status": "success",
  "latencyMs": 182
}
```

---

## 十一、发布流程：从本地可用到平台可安装

很多团队把“写完代码推到仓库”当成发布，其实插件上线至少还需要以下环节。

### 11.1 版本管理

建议采用语义化版本：

- `MAJOR`：破坏性变更，例如工具入参变更
- `MINOR`：新增工具或新增兼容字段
- `PATCH`：修复 bug，不改变接口契约

### 11.2 构建与打包

`package.json` 示例：

```json
{
  "name": "openhuman-github-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts",
    "test": "vitest run",
    "lint": "eslint src --ext .ts",
    "check": "npm run lint && npm run test && npm run build"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "tsup": "^8.2.0",
    "typescript": "^5.8.0",
    "vitest": "^2.1.0",
    "eslint": "^9.0.0"
  }
}
```

### 11.3 发布前检查清单

- manifest 版本号是否递增
- redirect URI 是否使用正式域名
- 是否移除调试日志
- 是否确认 scope 最小化
- 是否确认密钥来自正式 Secret 管理系统
- 是否做了回滚预案
- 是否验证旧连接兼容性

### 11.4 插件注册元数据示例

```json
{
  "id": "openhuman-google-drive",
  "version": "1.3.0",
  "checksum": "sha256:...",
  "artifactUrl": "https://plugins.example.com/openhuman-google-drive-1.3.0.tgz",
  "manifestUrl": "https://plugins.example.com/openhuman-google-drive-1.3.0.yaml",
  "signature": "base64-signature"
}
```

### 11.5 灰度发布建议

对于涉及 OAuth 和真实用户数据的插件，不建议一次性全量上线。更稳妥的做法：

1. 内部环境安装
2. 指定测试租户灰度
3. 小比例生产用户放量
4. 观察 token 刷新成功率与 API 错误率
5. 再全量发布

---

## 十二、实战踩坑记录：这些问题几乎每个团队都会遇到

### 12.1 坑一：把授权回调和插件业务逻辑耦合在一个 handler 里

最开始图省事，把 `/oauth/callback` 和 `createIssue()` 写在同一个模块，导致：

- 单元测试难写
- token 刷新逻辑难复用
- 不同 provider 的回调处理混成一团

**经验**：把 OAuth 作为“基础设施层”，业务工具作为“能力层”。

### 12.2 坑二：只存 userId，不存 tenantId / workspaceId

单租户时没问题，多租户立刻串数据。比如 Slack 授权其实是“用户 + workspace”的组合，不加 workspace 维度，后面就分不清到底发往哪个工作区。

**经验**：连接主键至少考虑 `pluginId + userId + tenantId + providerResourceId`。

### 12.3 坑三：以为所有平台都稳定支持 refresh token

GitHub、Google、Slack 在 token 生命周期策略上差异非常大。有的平台 refresh token 长期有效，有的平台会轮换，有的平台在某些配置下根本不给。

**经验**：不要把 refresh token 当作永远存在。系统要能处理“需要重新授权”。

### 12.4 坑四：HTTP 200 不等于成功

Slack 很典型，HTTP 200 但 `ok=false`；某些 Google API 也会在 JSON 里返回结构化错误。

**经验**：每个 provider 都要有单独的响应解析器。

### 12.5 坑五：scope 开得太大，审核和用户信任都过不去

一开始为了省事申请了所有能想到的 scope，结果：

- 安全审计卡住
- 用户不敢授权
- 某些平台审核被拒

**经验**：按工具拆 scope，按场景最小化申请，必要时做二次授权升级。

### 12.6 坑六：日志里打印了 token 响应

开发环境里看起来很方便，生产环境就是事故源。

**经验**：统一日志脱敏函数，禁止在任何异常分支直接 `JSON.stringify(tokenData)` 原样输出。

### 12.7 坑七：回调地址在不同环境不一致

开发、测试、生产三个环境共用一个 OAuth 应用时，经常因为 redirect URI 不一致导致 `redirect_uri_mismatch`。

**经验**：

- 每个环境单独应用最稳妥
- 或者在配置层严格管理回调地址白名单

---

## 十三、一个可复用的 OpenHuman OAuth 插件基座思路

如果你未来不只做一个插件，而是要做 GitHub、Google、Slack、Notion、Jira 一整套，那么最好抽一个 OAuth 基座。

### 13.1 Provider 抽象

```ts
export interface OAuthProviderDefinition {
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  defaultScopes: string[];
  supportsPKCE: boolean;
  buildAuthorizationParams(ctx: any): Record<string, string>;
  parseTokenResponse(data: any): {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    scope?: string;
    metadata?: Record<string, any>;
  };
}
```

### 13.2 通用 OAuth 服务

```ts
export class OAuthService {
  constructor(
    private provider: OAuthProviderDefinition,
    private store: any,
    private secrets: SecretManager
  ) {}

  async start(ctx: any) {
    const state = await this.store.createState({
      userId: ctx.user.id,
      tenantId: ctx.tenant?.id,
      provider: this.provider.name
    });

    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    await this.store.setCodeVerifier(state, verifier, 600);

    const params = this.provider.buildAuthorizationParams({
      ...ctx,
      state,
      codeChallenge: challenge
    });

    const url = new URL(this.provider.authorizationUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    return { type: "redirect", url: url.toString() };
  }

  async callback(ctx: any) {
    const state = ctx.request.query.state;
    const code = ctx.request.query.code;
    const stateData = await this.store.getState(state);
    const verifier = await this.store.getCodeVerifier(state);

    const resp = await fetch(this.provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: ctx.config.clientId,
        client_secret: ctx.config.clientSecret,
        redirect_uri: ctx.config.redirectUri,
        code_verifier: verifier,
        grant_type: "authorization_code"
      })
    });

    const data = await resp.json();
    const parsed = this.provider.parseTokenResponse(data);

    await ctx.connectionStore.save({
      pluginId: ctx.plugin.id,
      provider: this.provider.name,
      userId: stateData.userId,
      tenantId: stateData.tenantId,
      accessToken: await this.secrets.encrypt(parsed.accessToken),
      refreshToken: parsed.refreshToken
        ? await this.secrets.encrypt(parsed.refreshToken)
        : null,
      expiresAt: parsed.expiresIn
        ? new Date(Date.now() + parsed.expiresIn * 1000).toISOString()
        : null,
      metadata: parsed.metadata || {}
    });

    await this.store.consume(state);
    return { type: "success" };
  }
}
```

这个基座的意义在于：新增 provider 时，只需要补 provider definition 和工具实现，不必重写整套授权基础设施。

---

## 十四、给 OpenHuman 插件开发者的最终建议

如果把本文压缩成几条最重要的经验，我会总结为下面这些：

1. **先抽象插件模型，再写第三方 API 代码。**
2. **把 OAuth 当基础设施，不要散落在每个工具函数里。**
3. **PKCE、state 校验、token 加密存储是默认项，不是加分项。**
4. **多租户、多 workspace、多账号绑定要在数据模型阶段解决。**
5. **对 GitHub / Google / Slack 分别做 provider 级适配，不要幻想一个万能解析器。**
6. **把调试、测试、刷新 token、撤销授权这些“非 happy path”当成主流程的一部分。**
7. **发布时坚持最小权限、灰度上线、可观测性先行。**

OpenHuman 插件开发的难点从来不只是“调通一个 API”，而是把外部系统接入到 Agent 能稳定、可追踪、可扩展、可治理地使用。真正成熟的集成系统，表面上看只是“多了几个工具按钮”，背后却是插件架构、身份授权、安全模型、生命周期、错误治理与发布流程共同支撑的结果。

如果你正在构建自己的 OpenHuman 插件生态，我建议从一个最小但完整的 OAuth 插件开始：哪怕只做 `list repos` 或 `post message`，也要把 manifest、连接模型、PKCE、state、token 加密、日志脱敏、测试用例和灰度发布一并做好。这样后面无论是接 GitHub、Google、Slack，还是接企业内部系统，都能沿着同一套工程骨架快速扩张，而不会在每新增一个集成时都重新发明轮子。

这才是"插件开发实战"的真正价值：不是把接口调通，而是把能力体系搭稳。

---

## 相关阅读

- [OpenHuman 安全实战：本地加密、数据主权、隐私合规](/categories/架构/OpenHuman-安全实战-本地加密-数据主权-隐私合规/)
- [OpenHuman TokenJuice 实战：智能 Token 压缩与成本优化](/categories/架构/OpenHuman-TokenJuice-实战-智能Token压缩与成本优化/)
- [OpenHuman Cloud Deploy 实战：云端部署与多设备同步](/categories/AI/2026-06-02-openhuman-cloud-deploy-multi-device-sync-guide/)