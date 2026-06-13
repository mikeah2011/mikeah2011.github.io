---
title: OpenHuman 118+ 集成实战：Gmail/Notion/GitHub/Slack 一键 OAuth 连接
date: 2026-06-02 00:00:00
tags: [OpenHuman, OAuth, 集成, Gmail, Notion, GitHub, Slack]
keywords: [OpenHuman, Gmail, Notion, GitHub, Slack, OAuth, 集成实战, 一键, 连接, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 本文系统拆解 OpenHuman 118+ 集成体系与 OAuth 落地方法，手把手打通 Gmail、Notion、GitHub、Slack 一键授权连接，覆盖回调配置、Scope 最小化、Token 刷新、排障案例、自动化编排与安全治理，适合想把 OpenHuman 真正用于企业协作和 AI 工作流集成的开发者与架构师。
---


在 AI Agent、自动化工作流与企业内部数字化系统逐步融合的今天，“连接能力”已经不再只是锦上添花，而是平台能否真正落地的核心能力之一。一个模型再聪明，如果拿不到用户授权的数据、无法向外部系统发起安全调用、不能稳定处理令牌刷新与权限边界，那么它就只能停留在演示层面。OpenHuman 在这一点上给出的答案非常明确：通过 118+ 个集成能力与统一 OAuth 接入框架，把 Gmail、Notion、GitHub、Slack 等常用 SaaS 的授权、调用、审计、轮换和复用收敛到一个一致的工程模型中。

这篇文章不是泛泛而谈的“功能介绍”，而是一篇偏实战、偏架构、偏排障的长文。我们会从 OpenHuman 的集成架构开始，讲清楚它如何把“集成目录、连接实例、OAuth 应用配置、令牌托管、权限控制、运行时注入、审计日志”组合成一个完整体系；然后用 Gmail、Notion、GitHub、Slack 四个最常见的服务做逐步落地，尽可能写到“截图级细节”，也就是你即使不开文档，也能按本文把连接真正打通；最后再讲多连接管理、最小权限、Refresh Token 与 Access Token 的轮换策略、自定义集成开发、Marketplace 发布，以及常见 OAuth 错误的定位办法。

如果你正在把 OpenHuman 用作内部 Agent 平台、知识助理、研发自动化入口、客服运营中台或者个人 AI 工作台，这篇文章可以直接作为一份实施蓝图。

## 一、为什么是“118+ 集成 + 一键 OAuth”

很多平台也声称支持数十上百个集成，但真正难的不是“列出来”，而是以下几个工程问题：

1. **授权方式是否统一**：不同服务的 OAuth 2.0 页面、scope、redirect URI、refresh 规则各不相同，平台能否抽象出统一体验。
2. **连接是否可复用**：同一个 GitHub 连接能否被多个 Agent、多个工作流、多个插件共享，而不是每个流程重新授权。
3. **权限是否可解释**：用户能否看懂“为什么要这个 scope”，管理员能否限制高风险连接。
4. **令牌是否被托管与轮换**：是否支持 Access Token 过期后的自动刷新，是否支持失效检测与重新授权提醒。
5. **运行时是否安全注入**：Agent 在执行任务时，如何拿到所需连接但又不暴露明文密钥给提示词或日志。
6. **排障是否友好**：当用户看到 `redirect_uri_mismatch`、`invalid_scope`、`access_denied`、`invalid_grant` 时，平台是否给出可操作的定位路径。

OpenHuman 的“118+ 集成”价值不只在数量，而在于它把这些散落在各个平台文档中的复杂性封装进了统一的集成系统。站在使用者视角，你看到的是“点击 Connect → 跳转 OAuth → 同意权限 → 回到平台 → 立即可用”；站在架构师视角，背后其实是一个多层系统：

- **Integration Catalog（集成目录）**：描述某个外部系统支持哪些认证方式、哪些 scope、哪些 API 能力、哪些字段映射。
- **Provider Definition（提供方定义）**：例如 Google、Notion、GitHub、Slack 各自的授权地址、令牌地址、用户信息地址、scope 语法。
- **OAuth App Registration（应用注册）**：在各家开发者后台申请 Client ID / Client Secret，并配置回调地址。
- **Connection Instance（连接实例）**：每个用户、每个工作空间、每个项目维度的具体连接对象。
- **Secret & Token Vault（密钥与令牌保管）**：统一保存 client secret、access token、refresh token、过期时间与轮换元数据。
- **Runtime Injection（运行时注入）**：Agent 或 Workflow 执行时，仅以短时、按需、最小暴露的方式消费连接。
- **Audit & Governance（审计与治理）**：谁在什么时候创建了连接、用了哪些 scope、什么时候刷新、什么时候失败，都可追踪。

简而言之，OpenHuman 把“连接第三方服务”从一次性配置动作升级为“平台级能力层”。这也是为什么它适合做企业级 Agent 基础设施，而不只是一个演示性质的自动化面板。

## 二、OpenHuman 集成架构总览

为了后续实战先不迷路，我们先把架构图用文字方式拆开。一个典型的调用路径如下：

```text
用户/管理员
   ↓
OpenHuman Console
   ↓ 选择 Provider / Scope / Workspace
Integration Catalog
   ↓ 生成 OAuth 请求
Provider Auth Page（Google/Notion/GitHub/Slack）
   ↓ 授权码 code 回调
OpenHuman OAuth Callback Service
   ↓ 换取 token
Token Vault / Connection Store
   ↓ 挂载到 Agent / Workflow / Plugin
OpenHuman Runtime
   ↓
外部 API（Gmail / Notion / GitHub / Slack）
```

进一步细化，通常会落到以下几个逻辑组件：

### 1. 控制台层

控制台负责展示：

- 集成列表
- 可连接状态
- 已授权账户
- 当前 scope
- 连接归属（个人、团队、项目）
- 失效/过期/需要重新授权提示

对最终用户来说，这一层最重要的是“易用”；对管理员来说，最重要的是“可控”。OpenHuman 通常会在这里提供统一的 Connect/Disconnect/Reauthorize 操作，避免用户去记每一家服务不同的授权流程。

### 2. 集成元数据层

这一层是 OpenHuman 118+ 集成生态的关键。每个集成通常至少要描述：

- provider 名称，例如 `google-gmail`、`notion`、`github`、`slack`
- auth 类型，例如 `oauth2`、`api_key`、`service_account`
- 默认授权地址与 token 地址
- 默认 scope 集合
- 用户可选 scope
- 测试连接方式
- 目标 API 基础地址
- 是否支持 refresh token
- refresh token 失效规则
- 是否支持多租户/多工作空间授权

有了统一元数据，OpenHuman 就能把新增一个集成的成本压低。你不需要每接一个 SaaS 都重写一遍完整授权系统。

### 3. 连接存储层

连接对象本质上不是“一个 token”，而是一个结构化实体，例如：

```json
{
  "provider": "github",
  "workspace_id": "ws_prod_ops",
  "owner_id": "user_001",
  "connection_name": "github-main",
  "auth_type": "oauth2",
  "scopes": ["repo:status", "read:user", "user:email"],
  "access_token_expires_at": "2026-06-02T18:00:00Z",
  "refresh_token_expires_at": null,
  "status": "active",
  "last_refresh_at": "2026-06-02T09:10:01Z"
}
```

这样做的好处是，连接可以被查询、治理、迁移、审计和自动化处理，而不只是数据库里的一段密文。

### 4. 运行时注入层

这是很多平台最容易忽略的地方。真正成熟的系统不会把 access token 直接拼进 prompt 里，也不会简单粗暴地输出到日志。更理想的做法是：

- Agent 运行前，根据任务所需 capability 绑定连接
- 运行时只暴露短时凭证或内部代理句柄
- 日志中自动脱敏
- 模型无法直接读取 vault 中的原始 secret
- 通过平台工具层代替模型自己拼 HTTP 请求

也就是说，**OpenHuman 中“集成”最好被当成能力接口，而不是明文秘密文本。**

## 三、OpenHuman 中 OAuth 2.0 的标准流程

虽然 Gmail、Notion、GitHub、Slack 各有差异，但在 OpenHuman 中可以被归纳为一致流程。典型 Authorization Code Flow 如下：

### 步骤 1：发起连接

用户在 OpenHuman 控制台点击某个集成的“连接”按钮，例如 “Connect Gmail”。系统会准备：

- client_id
- redirect_uri
- response_type=code
- scope
- state
- 可选参数，如 `access_type=offline`、`prompt=consent`

### 步骤 2：跳转到 Provider 授权页

浏览器跳转到外部服务授权页。这里用户能看到：

- 当前登录的账号是谁
- OpenHuman 请求了哪些权限
- 允许后可访问哪些资源
- 是否允许长期访问（离线访问）

### 步骤 3：用户确认授权

用户点击 Allow / Authorize / Continue。Provider 将浏览器重定向回 OpenHuman 的回调地址，同时附带：

- `code`
- `state`
- 若拒绝，则可能附带 `error=access_denied`

### 步骤 4：回调服务校验 state

OpenHuman 必须校验 `state`，防止 CSRF 攻击。如果 `state` 对不上，应该直接拒绝，不做 token 交换。

### 步骤 5：用授权码交换 token

OpenHuman 后端调用 Provider 的 token endpoint，发送：

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

client_id=xxx
client_secret=yyy
code=zzz
redirect_uri=https://your-openhuman.example.com/oauth/callback/google
grant_type=authorization_code
```

Provider 返回 access token，某些服务还会返回 refresh token、expires_in、scope、token_type。

### 步骤 6：持久化连接

OpenHuman 把 token 加密存储，并记录：

- scope 列表
- 过期时间
- provider 账户标识
- 当前工作空间归属
- connection status
- refresh 策略

### 步骤 7：运行时消费连接

Agent 或工作流只需声明“我要用 Gmail 发信”或“我要查询 GitHub issue”，运行时自动拿到相应连接，无需再次登录。

## 四、OAuth 配置前的统一准备清单

在逐个接 Gmail、Notion、GitHub、Slack 之前，建议先准备好以下信息，否则你很容易在每个平台都踩一遍重复坑。

### 1. 明确 OpenHuman 的对外访问域名

你需要一个最终稳定的域名，例如：

```text
https://openhuman.example.com
```

因为 OAuth 回调地址必须与 Provider 后台登记的一致。如果你开发环境、测试环境、生产环境混用一个回调地址，后续排障会非常痛苦。

建议至少分三套：

```text
https://openhuman-dev.example.com
https://openhuman-staging.example.com
https://openhuman.example.com
```

### 2. 规划统一回调路径

常见做法是每个 provider 一个单独回调路径：

```text
https://openhuman.example.com/api/oauth/google/callback
https://openhuman.example.com/api/oauth/notion/callback
https://openhuman.example.com/api/oauth/github/callback
https://openhuman.example.com/api/oauth/slack/callback
```

也可以统一成一个入口，再通过 provider 参数分流：

```text
https://openhuman.example.com/api/oauth/callback/{provider}
```

### 3. 规划连接命名规范

如果你只连一个账号无所谓，但实际环境中常常会出现：

- 个人 Gmail 与团队 Gmail
- 个人 GitHub 与组织 GitHub App
- 多个 Slack Workspace
- 多个 Notion Workspace

所以建议在 OpenHuman 中统一命名，例如：

```text
gmail-personal
notion-product-docs
github-engineering
slack-ops
```

### 4. 提前定义 scope 最小集合

不要一上来就申请最大权限。正确方式是从业务需求倒推：

- 只读邮件标题？不要申请发送邮件权限
- 只读取 Notion 页面？不要申请写入 block 权限
- 只同步 GitHub issue？不要申请 workflow 管理权限
- 只发 Slack 消息？不要申请管理频道成员权限

### 5. 准备审计策略

至少要有以下字段：

- 谁创建了连接
- 连接到哪个外部账号/工作空间
- 申请了哪些 scope
- 最近一次成功刷新时间
- 最近一次失败原因
- 是否共享给团队
- 是否允许 Agent 自动使用

## 五、Gmail 集成实战：从 Google Cloud 到 OpenHuman 一键连接

Gmail 常见用法包括：读取收件箱、检索某类邮件、自动起草回复、发送通知邮件、将邮件归档到知识库等。Gmail 的 OAuth 接入相比其他平台更严格，因为 Google 对敏感 scope、测试用户、发布状态、验证流程都有明确要求。

### 1. 在 Google Cloud 创建项目

进入 Google Cloud Console 后，建议不要直接复用公司其他项目，而是新建一个专门的 OAuth 项目，例如：

```text
Project Name: openhuman-integrations
```

截图级操作可以理解为：

1. 打开 Google Cloud Console 首页
2. 点击顶部项目选择器
3. 右上角 `NEW PROJECT`
4. 填写项目名 `openhuman-integrations`
5. 选择计费账户/组织（如果有）
6. 点击 `CREATE`

### 2. 启用 Gmail API

新项目创建完成后：

1. 左侧菜单进入 `APIs & Services`
2. 点击 `Enabled APIs & services`
3. 点击顶部 `+ ENABLE APIS AND SERVICES`
4. 搜索 `Gmail API`
5. 进入详情页后点击 `ENABLE`

如果你未来还想顺手读取用户资料，通常也会启用：

- People API
- Gmail API

### 3. 配置 OAuth Consent Screen

这是最容易漏掉的一步。路径通常是：

`APIs & Services` → `OAuth consent screen`

你需要填写：

- App name：`OpenHuman Gmail Connector`
- User support email：你的管理员邮箱
- App logo：可选
- Authorized domains：你的 OpenHuman 域名
- Developer contact information：运维邮箱

如果你的应用还在测试模式，记得把实际测试账号加到 **Test users**，否则即使配置都对，非测试用户也无法完成授权。

### 4. 创建 OAuth Client ID

路径：

`APIs & Services` → `Credentials` → `Create Credentials` → `OAuth client ID`

选择：

- Application type：`Web application`
- Name：`OpenHuman Gmail Web Client`

在 `Authorized redirect URIs` 填入 OpenHuman 的回调地址，例如：

```text
https://openhuman.example.com/api/oauth/google/callback
```

创建后你会得到：

- Client ID
- Client Secret

这两个值后续填入 OpenHuman 的 Gmail 集成配置中。

### 5. 推荐的 Gmail scope 设计

不同业务需要不同 scope，常见最小权限示例如下：

**读取邮件元数据：**

```text
https://www.googleapis.com/auth/gmail.readonly
```

**发送邮件：**

```text
https://www.googleapis.com/auth/gmail.send
```

**读取并修改邮件标签：**

```text
https://www.googleapis.com/auth/gmail.modify
```

如果你只是想让 Agent 读取通知邮件并摘要，`gmail.readonly` 往往就够了，不要默认上 `gmail.modify`。

### 6. 在 OpenHuman 配置 Gmail Provider

在 OpenHuman 控制台中，进入集成管理页后，通常需要填写类似配置：

```yaml
provider: google-gmail
auth_type: oauth2
client_id: ${GOOGLE_CLIENT_ID}
client_secret: ${GOOGLE_CLIENT_SECRET}
authorize_url: https://accounts.google.com/o/oauth2/v2/auth
token_url: https://oauth2.googleapis.com/token
scopes:
  - https://www.googleapis.com/auth/gmail.readonly
  - https://www.googleapis.com/auth/gmail.send
extra_authorize_params:
  access_type: offline
  prompt: consent
redirect_uri: https://openhuman.example.com/api/oauth/google/callback
```

这里两个关键点：

- `access_type=offline`：尽可能拿到 refresh token
- `prompt=consent`：在某些重复授权场景下强制重新展示同意页，以便重新签发 refresh token

### 7. 发起连接时的页面观察点

点击 “Connect Gmail” 后，浏览器跳转到 Google 登录页。你应该重点观察：

- 地址栏中 `redirect_uri` 是否与你后台配置完全一致
- `scope` 是否是你预期的那些，而不是漏了或多了
- 授权页显示的应用名称是不是你刚才设置的 `OpenHuman Gmail Connector`
- 当前登录的是哪个 Google 账号

如果你看到 “This app isn’t verified”，说明你的 OAuth consent 配置或 Google 验证状态还没走完。这在测试环境并不一定阻塞，但在生产环境通常意味着你需要正式发布或完成验证。

### 8. 验证 Gmail 连接是否真的可用

授权成功后，不要只看控制台显示 “Connected”，还要做一次真实 API 测试。可以在 OpenHuman 的测试动作里调用一个最小接口，比如列出最近 5 封邮件：

```http
GET https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5
Authorization: Bearer <access_token>
```

若平台支持工具测试，可以做一个简单场景：

> “读取最近 3 封主题包含 build 的邮件，并输出发件人、主题、日期。”

如果返回正常，说明授权、scope、令牌和 API 路径都打通了。

### 9. Gmail 常见坑

- 只拿到 access token，没有 refresh token：通常是没加 `access_type=offline`，或用户以前已经授过权，需要 `prompt=consent`
- `redirect_uri_mismatch`：Google 后台配置的 redirect URI 与实际请求的一个字符都不能差
- `access_blocked`：OAuth consent screen 没配置好，或应用状态限制了授权用户
- `invalid_scope`：scope 拼写错误，或者请求了未启用/不允许的 scope

## 六、Notion 集成实战：页面、数据库与工作区授权

Notion 的优势在于知识管理、项目文档、数据库式信息组织。OpenHuman 接入 Notion 后，最常见的能力是：搜索页面、读取知识库、写入周报、同步任务、把 Agent 输出沉淀到数据库。

### 1. 在 Notion 创建 Integration

进入 Notion 开发者后台，创建一个新的 Integration。你一般会看到以下字段：

- Name：`OpenHuman Notion Connector`
- Associated workspace：选择目标工作区
- Logo：可选
- Capabilities：读取内容、更新内容、插入内容、读取用户信息等

Notion 与 Google 的区别是，它常常把能力颗粒度放在 Integration capability 和页面共享两个层面。

### 2. 获取 OAuth 基础信息

如果使用公有 OAuth 集成，需要在 Notion 集成设置中获取：

- Client ID
- Client Secret
- Redirect URI

回调地址例如：

```text
https://openhuman.example.com/api/oauth/notion/callback
```

### 3. 在 OpenHuman 配置 Notion Provider

典型配置可写成：

```yaml
provider: notion
auth_type: oauth2
client_id: ${NOTION_CLIENT_ID}
client_secret: ${NOTION_CLIENT_SECRET}
authorize_url: https://api.notion.com/v1/oauth/authorize
token_url: https://api.notion.com/v1/oauth/token
redirect_uri: https://openhuman.example.com/api/oauth/notion/callback
scopes:
  - read_content
  - update_content
  - insert_content
```

注意：Notion 的能力命名和传统 OAuth scope 语义有些平台差异，实际以其当前开发者后台定义为准，但在 OpenHuman 中建议抽象成“可理解的权限标签”，方便用户看懂。

### 4. 授权时的截图级观察点

点击 “Connect Notion” 后，页面通常会显示：

- 当前要授权给哪个 Notion workspace
- 这个 Integration 将可以访问哪些能力
- 是否允许读取页面内容、写入内容、插入 block

这里最关键的不是“授权成功”，而是授权后你还需要在 Notion 内部把目标页面/数据库共享给该 Integration。否则经常会出现：

- OAuth 成功
- 连接状态 active
- 但查询页面时 404 或 unauthorized

这不是 token 问题，而是资源本身没共享给 Integration。

### 5. 将页面或数据库共享给 Integration

在 Notion 目标页面右上角点击 `Share`：

1. 点击 `Invite`
2. 搜索你刚创建的 Integration 名称，例如 `OpenHuman Notion Connector`
3. 选中后点击 `Invite`

如果是数据库，也要对数据库本身执行共享，而不是只共享父页面。

### 6. 在 OpenHuman 中验证读取与写入

一个很实用的测试顺序是：

**第一步：搜索页面**

```json
{
  "query": "产品路线图",
  "filter": {"property": "object", "value": "page"}
}
```

**第二步：读取页面 block**

```http
GET /v1/blocks/{block_id}/children
```

**第三步：向指定页面追加一段内容**

```json
{
  "parent": {"page_id": "xxxxxxxx"},
  "children": [
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [
          {"type": "text", "text": {"content": "本段内容由 OpenHuman 自动写入。"}}
        ]
      }
    }
  ]
}
```

如果前两步成功，第三步失败，通常说明你只授予了读权限或页面共享范围不够。

### 7. Notion 最佳实践

- 为不同场景建立不同连接，例如“只读知识库”和“自动写周报”分开
- 不要让一个高权限 Integration 访问整个工作区所有文档
- 用独立数据库承接 Agent 输出，避免模型误写核心文档
- 对关键页面设置人工审核流程，不要让 Agent 直接覆盖原文档

## 七、GitHub 集成实战：仓库、Issue、PR 与组织权限

GitHub 接入是研发场景最常见、也最容易权限过大的地方。很多团队一上来就给 `repo` 全权限，结果 Agent 理论上可以读写所有私有仓库，这在审计上非常危险。

### 1. 选择 OAuth App 还是 GitHub App

如果你主要目标是“快速完成用户级 OAuth 连接”，那可以先用 OAuth App；如果你需要更细粒度的仓库级权限、组织安装、Webhook、可审计 installation 模型，那么 GitHub App 会更合理。

本文重点讲 OAuth 连接思路，因为题目强调一键 OAuth。但在实际生产中，如果你的 OpenHuman 需要大规模接企业 GitHub 组织，建议评估 GitHub App。

### 2. 创建 GitHub OAuth App

进入 GitHub Settings → Developer settings → OAuth Apps → New OAuth App。

关键字段：

- Application name：`OpenHuman GitHub Connector`
- Homepage URL：`https://openhuman.example.com`
- Authorization callback URL：

```text
https://openhuman.example.com/api/oauth/github/callback
```

创建后会看到：

- Client ID
- 生成 Client Secret 的入口

### 3. OpenHuman 中的 GitHub Provider 配置

```yaml
provider: github
auth_type: oauth2
client_id: ${GITHUB_CLIENT_ID}
client_secret: ${GITHUB_CLIENT_SECRET}
authorize_url: https://github.com/login/oauth/authorize
token_url: https://github.com/login/oauth/access_token
redirect_uri: https://openhuman.example.com/api/oauth/github/callback
scopes:
  - read:user
  - user:email
  - repo
```

但注意，`repo` 很大，包含私有仓库读写。如果你的业务只是读取公开仓库 issue，甚至可以不需要它。更谨慎的做法是分场景：

- 只识别用户身份：`read:user`, `user:email`
- 读 issue / PR：评估更细粒度权限或 GitHub App
- 提交代码/开 PR：单独创建高权限连接，不与普通读取连接混用

### 4. 授权页面观察点

GitHub 授权页相比 Google 简洁，但要特别注意：

- 页面会列出 OpenHuman 请求的 scopes
- 如果用户属于组织，组织策略可能拦截某些应用
- 若组织启用了第三方应用审批，用户授权后可能还不能立刻用，需要组织管理员批准

所以你在 OpenHuman 里看到“连接成功”，不一定意味着对组织私有仓库就有权限。

### 5. 连接验证：从最小动作开始

建议按以下顺序验证：

**身份测试：**

```http
GET https://api.github.com/user
Authorization: Bearer <token>
```

**列出可见仓库：**

```http
GET https://api.github.com/user/repos?per_page=10
```

**读取某仓库 issue：**

```http
GET https://api.github.com/repos/org/repo/issues?state=open&per_page=5
```

**尝试创建 issue（仅当你确实授予写权限）：**

```json
{
  "title": "OpenHuman OAuth 集成验证",
  "body": "如果你看到这条 issue，说明 GitHub 写权限已经打通。"
}
```

### 6. GitHub 研发自动化的几个典型模式

#### 模式 A：PR 摘要机器人

- 使用只读仓库权限
- 拉取最新 PR 描述、diff 概览、评论
- 让 Agent 生成代码评审摘要
- 输出回 Slack 或 Notion

#### 模式 B：Issue 分诊机器人

- 定期读取新 issue
- 按标签或语义归类
- 需要时自动回复模板

#### 模式 C：发布流程协同

- 从 GitHub 读取 release note 草稿
- 推送到 Slack 发布频道
- 同步到 Notion 版本记录

你会发现，一个 GitHub 连接往往不会单独存在，它常常和 Slack、Notion 联动，这正是 OpenHuman 多集成协同的价值所在。

## 八、Slack 集成实战：工作区授权、Bot Scope 与消息流

Slack 几乎是企业 Agent 的默认入口。把 OpenHuman 接上 Slack 后，最常见的能力是：

- 机器人接收用户消息
- 主动发送通知
- 回复线程
- 读取频道上下文
- 与 GitHub、Notion、Gmail 数据联动

### 1. 在 Slack API 平台创建 App

进入 Slack API 后：

1. 点击 `Create New App`
2. 选择 `From scratch`
3. App Name 输入 `OpenHuman Slack Connector`
4. 选择目标 workspace

### 2. 配置 OAuth & Permissions

在左侧找到 `OAuth & Permissions`，重点配置：

- Redirect URLs
- Bot Token Scopes
- User Token Scopes（如果需要）

回调地址例如：

```text
https://openhuman.example.com/api/oauth/slack/callback
```

### 3. 常用 Slack Bot Scopes

按最小权限原则，常见选择如下：

- `chat:write`：发送消息
- `channels:history`：读取公开频道历史
- `groups:history`：读取私有频道历史
- `channels:read`：读取公开频道基础信息
- `groups:read`：读取私有频道基础信息
- `im:history`：读取私聊历史
- `users:read`：读取用户资料

如果你的 Agent 只是给固定频道发送通知，很多情况下只要 `chat:write` 加少量读取权限就够了。

### 4. OpenHuman 中的 Slack 配置示例

```yaml
provider: slack
auth_type: oauth2
client_id: ${SLACK_CLIENT_ID}
client_secret: ${SLACK_CLIENT_SECRET}
authorize_url: https://slack.com/oauth/v2/authorize
token_url: https://slack.com/api/oauth.v2.access
redirect_uri: https://openhuman.example.com/api/oauth/slack/callback
scopes:
  - chat:write
  - channels:read
  - channels:history
  - users:read
```

### 5. 授权页的截图级检查点

点击 “Connect Slack” 后，通常会看到：

- 顶部显示要安装到哪个 workspace
- 中间列出该 App 将获得哪些权限
- 底部是 `Allow`

检查点如下：

- 当前安装的 workspace 是否正确，很多人会误装到个人测试 workspace
- scope 是否与预期一致
- 如果是多工作区企业环境，是否需要管理员批准

### 6. 授权成功后别忘了安装/加入频道

Slack OAuth 成功并不代表机器人已经能在所有频道发消息。常见还需要做两件事：

1. 确保 App 已经安装到 workspace
2. 如果向特定频道发消息，机器人可能还需要被邀请进该频道，例如：

```text
/invite @OpenHuman Slack Connector
```

否则典型报错是 `not_in_channel`。

### 7. 验证 Slack 连接

推荐做一个简单到不能再简单的测试：

- 选择一个测试频道 `#openhuman-sandbox`
- 发送一条消息：`OpenHuman 集成验证成功，当前时间：{{timestamp}}`

如果平台支持读取频道历史，再验证：

- 读取该频道最近 10 条消息
- 把其中包含关键词 `deploy` 的消息提取出来

### 8. Slack 集成的常见问题

- `invalid_redirect_uri`：回调地址不匹配
- `missing_scope`：动作所需权限未授予，例如发消息缺少 `chat:write`
- `not_in_channel`：机器人没加入频道
- `account_inactive` 或 `token_revoked`：安装被移除、令牌失效或工作区策略变化

## 九、多连接管理：当同一平台不止一个账号时

真正进入生产环境后，“连接”一定不是每个平台一个那么简单。典型情况：

- Gmail：个人邮箱、共享邮箱、客服邮箱
- Notion：产品文档工作区、研发知识库工作区、运营数据库工作区
- GitHub：个人账号、公司组织账号、开源社区账号
- Slack：总部工作区、研发工作区、外包协作工作区

所以 OpenHuman 里最好具备多连接治理能力。

### 1. 连接分层

建议至少分为三层：

- **个人连接**：仅当前用户可见和可用
- **工作空间连接**：团队共享，用于公共 Agent 或共享流程
- **系统连接**：由管理员维护，供平台级自动化使用

### 2. 命名与标签

连接对象建议带标签，例如：

```yaml
name: github-engineering-prod
provider: github
owner_scope: workspace
labels:
  env: prod
  team: engineering
  privilege: medium
```

这样在 Agent 选择连接时可以按标签路由，而不是靠手工点选。

### 3. 默认连接与显式连接

有些场景允许配置“默认连接”，例如默认 Slack workspace、默认 Notion 知识库；但对高风险操作，如 GitHub 写仓库、Gmail 发外部邮件，建议要求显式指定连接，避免误用。

### 4. 连接健康度检查

建议 OpenHuman 定时执行以下检查：

- access token 是否即将过期
- refresh token 是否刷新失败
- 目标账户是否仍存在
- scope 是否被提供方缩减
- API 探活是否成功

可以设计一个连接健康状态机：

```text
active -> expiring_soon -> refresh_failed -> reauth_required -> disabled
```

## 十、权限最小化：Scope 不是越多越好

OAuth 安全的第一原则不是“能连上”，而是“只给必须的权限”。

### 1. 以能力倒推 scope

错误做法：

- 先给最大权限，后面慢慢用

正确做法：

- 明确动作：读、写、发消息、建 issue、读页面
- 为每个动作找最小 scope
- 高风险写操作单独隔离连接

### 2. 四个平台的最小权限建议

**Gmail**
- 只读摘要：`gmail.readonly`
- 自动发送通知：`gmail.send`
- 修改标签：`gmail.modify`

**Notion**
- 只读知识库：仅启用读取相关 capability
- 自动写日报：启用插入/更新，但只共享目标数据库

**GitHub**
- 只识别身份：`read:user`, `user:email`
- 只读 repo 元数据：尽量不直接给大 scope，能用 GitHub App 更好
- 写 issue/PR：单独高权限连接

**Slack**
- 只发通知：`chat:write`
- 读取频道上下文：额外 `channels:history` 等
- 管理频道成员等高风险能力通常不要给 Agent

### 3. Scope 变更要重新审查

任何一个连接 scope 增加，都应该视为一次安全变更。建议流程：

1. 提出变更申请
2. 说明业务原因
3. 审查新增加的权限风险
4. 重新授权
5. 记录审计日志

## 十一、Token 刷新、过期与轮换策略

只连上还不够，令牌生命周期管理才是长期稳定运行的关键。

### 1. Access Token 与 Refresh Token 的职责分工

- **Access Token**：短期有效，用于实际 API 调用
- **Refresh Token**：较长期有效，用于在 access token 过期后换新

不是所有平台都返回 refresh token，也不是所有 refresh token 都长期有效。例如：

- Google 比较依赖离线授权参数
- Slack 有自己的令牌策略
- GitHub OAuth token 的过期和刷新能力要看具体应用与平台策略
- Notion 也要根据其当前 OAuth 行为来设计刷新流程

### 2. OpenHuman 中推荐的刷新策略

推荐不要“等到过期再说”，而是：

- 记录 `expires_at`
- 在过期前 5~10 分钟尝试刷新
- 刷新失败时进入重试退避
- 连续失败达到阈值后标记 `reauth_required`

伪代码示例：

```python
from datetime import datetime, timedelta

def should_refresh(connection):
    if not connection.access_token_expires_at:
        return False
    return datetime.utcnow() >= connection.access_token_expires_at - timedelta(minutes=10)


def refresh_connection(connection, provider_client):
    if not connection.refresh_token:
        return {"status": "reauth_required", "reason": "missing_refresh_token"}

    token = provider_client.refresh_token(connection.refresh_token)
    if token.ok:
        return {
            "status": "active",
            "access_token": token.access_token,
            "expires_at": token.expires_at,
            "refresh_token": token.refresh_token or connection.refresh_token,
        }
    return {"status": "refresh_failed", "reason": token.error}
```

### 3. 刷新失败的常见原因

- 用户主动撤销了应用授权
- refresh token 长期未使用而失效
- provider 更换了 token 策略
- client secret 被轮换但 OpenHuman 未同步
- redirect URI / app 配置变更导致交换失败

### 4. Secret 轮换策略

Client Secret 也不是永久不变的。建议：

- 每隔固定周期轮换 provider 的 client secret
- OpenHuman 中支持双 secret 过渡期
- 轮换前后做连接探活
- 对关键连接配置再授权演练

## 十二、安全最佳实践：别让 OAuth 成为系统短板

OpenHuman 做集成很强，但真正安全与否，取决于实施细节。

### 1. 强制使用 HTTPS

所有 OAuth 回调与控制台页面必须走 HTTPS，否则 code、state、session 都有泄露风险。

### 2. 校验 state，必要时加入 PKCE

即便是服务端 Web 应用，也建议在能力允许时使用 PKCE 增强安全性。最基本的是：

- state 必须随机生成
- state 必须与会话绑定
- 回调时必须严格校验

### 3. Token 必须加密存储

不要把 access token、refresh token 明文放数据库。应使用：

- KMS
- Vault
- 数据库字段级加密
- 最少权限访问控制

### 4. 日志脱敏

日志中禁止输出：

- access token
- refresh token
- client secret
- 完整授权码 `code`

可以只保留前后几位用于排障，例如：

```text
access_token=gho_xxxx****9AbC
```

### 5. 按环境隔离应用

开发、测试、生产环境不要共用同一个 OAuth App。否则你很难判断某个失效问题来自哪个环境，也容易把测试权限带入生产。

### 6. 高风险动作加二次确认

例如：

- Gmail 向外部域发送邮件
- GitHub 向主仓库创建 PR
- Notion 更新核心知识库页面
- Slack 群发通知到生产告警频道

建议在 OpenHuman 里配置显式确认或审批节点。

## 十三、把 Gmail/Notion/GitHub/Slack 串起来：一个完整自动化案例

单个连接打通只是起点，真正体现 OpenHuman 价值的是多集成编排。这里给一个典型研发协作工作流：

### 场景：构建失败通知与知识沉淀

目标流程：

1. GitHub 上某仓库 CI 失败
2. OpenHuman 读取失败 PR、commit、最近 issue 上下文
3. Slack 通知研发频道
4. 同时在 Notion 故障记录数据库中创建一条记录
5. 若失败涉及外部客户交付，再由 Gmail 自动起草一封内部同步邮件

### 可能的工作流描述

```yaml
workflow: build-failure-assistant
steps:
  - name: load_github_context
    integration: github-engineering-prod
    action: get_pull_request_and_checks

  - name: summarize_failure
    agent: root-cause-agent
    input: github_context

  - name: notify_slack
    integration: slack-engineering
    action: post_message
    args:
      channel: '#build-alerts'

  - name: write_notion
    integration: notion-incident-db
    action: create_database_row

  - name: draft_email
    integration: gmail-internal
    action: create_draft
    when: severity in ['high', 'critical']
```

这种场景下，你会立刻意识到“统一连接管理”有多重要：每个步骤都依赖不同 provider，但运行时应该被当成稳定能力，而不是临时拼凑的 token。

## 十四、自定义集成：当 118+ 还不够时如何扩展

虽然 OpenHuman 已有 118+ 集成，但实际企业环境永远会冒出“内部系统”“垂直 SaaS”“自建平台”需要对接。好消息是，如果 OpenHuman 的集成模型设计合理，自定义一个 OAuth2 provider 通常不算太难。

### 1. 自定义集成需要哪些最小信息

你至少需要拿到：

- authorize endpoint
- token endpoint
- user info endpoint（可选但很有帮助）
- scope 定义
- refresh token 规则
- 回调地址格式
- API base URL

### 2. 一个通用 OAuth2 Provider 配置示意

```yaml
provider: internal-docs
display_name: Internal Docs
auth_type: oauth2
authorize_url: https://sso.example.com/oauth/authorize
token_url: https://sso.example.com/oauth/token
user_info_url: https://sso.example.com/api/userinfo
client_id: ${INTERNAL_DOCS_CLIENT_ID}
client_secret: ${INTERNAL_DOCS_CLIENT_SECRET}
redirect_uri: https://openhuman.example.com/api/oauth/internal-docs/callback
scopes:
  - docs.read
  - docs.write
  - comments.write
capabilities:
  - search_documents
  - read_document
  - write_document
  - comment_document
```

### 3. 自定义连接测试清单

开发一个新集成时，建议最少覆盖以下测试：

- 授权成功路径
- 用户拒绝授权路径
- state 不匹配路径
- token 交换失败路径
- refresh 成功与失败路径
- scope 不足时的错误提示
- 连接删除/撤销后行为

### 4. 把自定义集成封装成 Marketplace 条目

如果你的团队里多个项目都需要同一个内部系统集成，最好的方式不是每个项目复制一份配置，而是把它沉淀成一个标准化 Marketplace 条目。这样可以获得：

- 统一版本管理
- 统一权限说明
- 统一连接测试
- 统一文档入口

## 十五、集成 Marketplace：从“能接”到“好用、可治理”

118+ 集成的另一个价值是形成 Marketplace，而不只是一个杂乱列表。

一个成熟的集成市场应该至少展示：

- Provider 名称和图标
- 支持的认证方式
- 可用动作/能力
- 所需 scope 说明
- 版本号
- 最近更新时间
- 是否官方维护
- 风险等级
- 已知限制
- 安装与授权向导

### 1. Marketplace 中如何选型

以 GitHub 为例，你可能会看到：

- GitHub OAuth Connector
- GitHub App Connector
- GitHub Enterprise Connector

这时就不能只看名字，而要看：

- 面向的是个人账号还是组织安装
- 支持哪些 API
- 是否支持细粒度仓库授权
- 是否支持企业私有域名 API 地址

### 2. 企业内部的 Marketplace 治理建议

如果你是企业管理员，建议给集成打分级：

- **低风险**：只读知识库、只读公开信息
- **中风险**：可写内部文档、发内部通知
- **高风险**：发外部邮件、写私有代码仓库、访问生产告警系统

高风险条目应默认隐藏或受审批控制。

## 十六、常见 OAuth 错误排障手册

这一节非常重要，因为 OAuth 最大的挫败感往往不是配置本身，而是报错信息太抽象。下面按错误类型给出定位路径。

### 1. `redirect_uri_mismatch`

**现象**：授权页跳转时报错，或者回调时 provider 拒绝。

**定位步骤**：

1. 检查 OpenHuman 发起请求时的 `redirect_uri`
2. 检查 provider 后台登记的回调地址
3. 比较协议、域名、端口、路径、尾部斜杠是否完全一致
4. 注意 URL 编码后是否被重复编码

**典型坑**：

- `https://openhuman.example.com/callback` 与 `https://openhuman.example.com/callback/` 不同
- 测试环境误用了生产域名
- 代理层重写了路径

### 2. `invalid_scope`

**现象**：授权发起时被拒绝，或 token 交换后权限不符合预期。

**定位步骤**：

1. 确认 scope 名称拼写正确
2. 确认 provider 当前确实支持该 scope
3. 确认应用已启用相应 API
4. 检查 scope 分隔符是空格、逗号还是数组形式

### 3. `access_denied`

**现象**：用户授权页点拒绝，或 provider 因策略拒绝。

**定位步骤**：

- 区分是用户主动取消，还是组织管理员/策略系统拦截
- 查看是否需要管理员批准第三方应用
- 对 Google 检查测试用户与发布状态

### 4. `invalid_grant`

**现象**：使用 code 换 token 失败，或 refresh token 刷新失败。

**常见原因**：

- code 已被使用过
- code 过期
- redirect URI 不一致
- refresh token 已失效或被撤销
- 客户端 secret 错误

### 5. `unauthorized_client`

**现象**：客户端没有资格使用某种授权流程。

**排查方向**：

- 应用类型是否配置为 Web application
- 当前授权流程是否需要 PKCE 或额外配置
- 某些 provider 对未发布应用有限制

### 6. `token_revoked` / `invalid_auth`

**多见于 Slack/GitHub 等**：

- 用户撤销安装
- 工作区移除应用
- 组织安全策略使 token 失效
- 平台 secret 轮换不同步

### 7. OpenHuman 平台侧也要记录哪些日志

为了把排障效率拉起来，建议记录以下脱敏信息：

```json
{
  "provider": "slack",
  "connection_id": "conn_01J...",
  "phase": "token_exchange",
  "result": "failed",
  "http_status": 400,
  "error": "invalid_grant",
  "redirect_uri_hash": "sha256:...",
  "scope_count": 4,
  "timestamp": "2026-06-02T09:33:21Z"
}
```

这样你既能定位问题，又不会把敏感信息打进日志。

## 十七、运维建议：把集成当作基础设施来运营

如果你的 OpenHuman 准备服务多个团队，建议建立一套集成运维制度，而不是让每个项目组各自为战。

### 1. 建立连接台账

至少包含：

- 连接名称
- provider
- owner
- workspace
- scope
- 风险等级
- 创建时间
- 最近使用时间
- 最近刷新时间
- 是否生产使用

### 2. 设立定期审查

例如每季度审查一次：

- 不再使用的连接及时删除
- 高权限连接是否仍有必要
- 共享连接是否存在 owner 缺失
- Provider 应用是否仍由有效管理员管理

### 3. 监控关键指标

推荐监控：

- 授权成功率
- 回调失败率
- token 刷新成功率
- API 调用 401/403 比例
- 连接失效数量
- 需要重新授权的连接数

### 4. 做好灾备与迁移演练

如果 OpenHuman 实例迁移域名、升级架构或切换 secret 管理方案，OAuth 集成往往是最脆弱的点。建议提前演练：

- 域名切换后如何批量更新 redirect URI
- client secret 轮换如何平滑过渡
- 旧连接如何重新绑定到新环境

## 十八、示例：OpenHuman 中的统一连接配置片段

下面给一个更完整的示例，展示四种集成统一纳管时的思路：

```yaml
integrations:
  - name: gmail-internal
    provider: google-gmail
    auth_type: oauth2
    owner_scope: workspace
    scopes:
      - https://www.googleapis.com/auth/gmail.readonly
      - https://www.googleapis.com/auth/gmail.send
    risk_level: high
    rotation:
      refresh_before_expiry_minutes: 10
      reauth_on_refresh_failure: true

  - name: notion-kb
    provider: notion
    auth_type: oauth2
    owner_scope: workspace
    scopes:
      - read_content
      - insert_content
    risk_level: medium

  - name: github-engineering
    provider: github
    auth_type: oauth2
    owner_scope: workspace
    scopes:
      - read:user
      - user:email
      - repo
    risk_level: high

  - name: slack-alerts
    provider: slack
    auth_type: oauth2
    owner_scope: workspace
    scopes:
      - chat:write
      - channels:read
      - channels:history
    risk_level: medium
```

这个配置的重点不是语法，而是思路：**连接应该被平台化管理，而不是散落在脚本里。**

## 十八点五、可直接复用的代码示例：回调、刷新与多平台调用

前文讲了很多配置思路，下面补一组更偏工程实现的代码片段，帮助你在 OpenHuman 周边系统里快速做验证、联调和排障。即便你的最终实现语言不是 Python，也可以把这些示例当作伪代码模板。

### 1. OAuth 回调处理示例

下面是一个最小但工程上比较完整的回调处理逻辑，覆盖 `state` 校验、授权码换 token、异常处理和连接持久化。

```python
import os
import secrets
import requests
from datetime import datetime, timedelta, timezone


class OAuthError(Exception):
    pass


def exchange_code_for_token(provider, code, redirect_uri):
    provider_map = {
        "google-gmail": {
            "token_url": "https://oauth2.googleapis.com/token",
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
        },
        "github": {
            "token_url": "https://github.com/login/oauth/access_token",
            "client_id": os.environ["GITHUB_CLIENT_ID"],
            "client_secret": os.environ["GITHUB_CLIENT_SECRET"],
            "headers": {"Accept": "application/json"},
        },
        "slack": {
            "token_url": "https://slack.com/api/oauth.v2.access",
            "client_id": os.environ["SLACK_CLIENT_ID"],
            "client_secret": os.environ["SLACK_CLIENT_SECRET"],
        },
    }

    meta = provider_map[provider]
    payload = {
        "client_id": meta["client_id"],
        "client_secret": meta["client_secret"],
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    resp = requests.post(
        meta["token_url"],
        data=payload,
        headers=meta.get("headers", {}),
        timeout=15,
    )
    data = resp.json()
    if resp.status_code >= 400 or data.get("error"):
        raise OAuthError(f"token exchange failed: {data}")
    return data


def handle_oauth_callback(provider, request_args, session, connection_store):
    error = request_args.get("error")
    if error:
        raise OAuthError(f"provider denied authorization: {error}")

    code = request_args["code"]
    state = request_args["state"]
    if state != session.get("oauth_state"):
        raise OAuthError("state mismatch")

    redirect_uri = f"https://openhuman.example.com/api/oauth/{provider}/callback"
    token_data = exchange_code_for_token(provider, code, redirect_uri)
    expires_in = int(token_data.get("expires_in", 3600))

    connection = {
        "provider": provider,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "scope": token_data.get("scope"),
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        "status": "active",
    }
    connection_store.save(connection)
    return connection


def init_oauth_session(session):
    session["oauth_state"] = secrets.token_urlsafe(24)
    return session["oauth_state"]
```

这个示例的重点在于：OpenHuman 周边服务即便只是做自定义入口，也不要跳过 `state` 校验，也不要把 token 交换逻辑塞进前端。

### 2. 提供方差异对照表

实际接入时，同样叫 OAuth，不同平台的行为差异很大。为了减少“明明流程一样却总有个地方不一样”的摩擦，建议把差异固化成表格给实施团队使用。

| 平台 | 常见授权地址 | 常见 token 地址 | 是否常见 refresh token | 容易踩坑的点 | 适合的最小验证动作 |
| --- | --- | --- | --- | --- | --- |
| Gmail | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` | 是，但常依赖 `access_type=offline` | Consent Screen、测试用户、`redirect_uri_mismatch` | 列出最近 5 封邮件 |
| Notion | `https://api.notion.com/v1/oauth/authorize` | `https://api.notion.com/v1/oauth/token` | 取决于当前平台策略 | 页面未共享给 Integration，导致 OAuth 成功但读不到内容 | 搜索页面并读取 block |
| GitHub | `https://github.com/login/oauth/authorize` | `https://github.com/login/oauth/access_token` | 取决于应用类型与策略 | `repo` 权限过大、组织审批未通过 | 调用 `/user` 和 `/user/repos` |
| Slack | `https://slack.com/oauth/v2/authorize` | `https://slack.com/api/oauth.v2.access` | 部分场景需要结合当前 token 策略 | 机器人未进频道、Scope 漏配、工作区装错 | 向测试频道发一条消息 |

### 3. 统一健康检查脚本示例

如果你已经在 OpenHuman 中维护多个连接，建议增加一个巡检脚本定期跑探活，而不是等工作流报错后才发现连接已失效。

```python
import requests
from dataclasses import dataclass


@dataclass
class Connection:
    name: str
    provider: str
    access_token: str


def healthcheck(connection: Connection):
    headers = {"Authorization": f"Bearer {connection.access_token}"}

    if connection.provider == "google-gmail":
        url = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
    elif connection.provider == "github":
        url = "https://api.github.com/user"
        headers["Accept"] = "application/vnd.github+json"
    elif connection.provider == "slack":
        url = "https://slack.com/api/auth.test"
    elif connection.provider == "notion":
        url = "https://api.notion.com/v1/users/me"
        headers["Notion-Version"] = "2022-06-28"
    else:
        return {"name": connection.name, "status": "unknown_provider"}

    resp = requests.get(url, headers=headers, timeout=15)
    return {
        "name": connection.name,
        "provider": connection.provider,
        "status_code": resp.status_code,
        "ok": resp.status_code < 400,
        "body_preview": resp.text[:160],
    }


connections = [
    Connection("gmail-internal", "google-gmail", "***"),
    Connection("github-engineering", "github", "***"),
    Connection("slack-alerts", "slack", "***"),
]

for item in connections:
    print(healthcheck(item))
```

这类脚本最好输出到监控系统，而不是只打印到控制台；否则你只能在问题已经影响业务后才知道连接坏了。

### 4. 多平台统一调用封装示例

当你的 OpenHuman Workflow 需要同时触达 Gmail、Notion、GitHub、Slack 时，不建议在 Agent 层拼接四套完全不同的 HTTP 逻辑，更适合抽成 provider client 层。

```python
import requests


class ProviderClient:
    def __init__(self, token, headers=None):
        self.token = token
        self.headers = headers or {}

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}", **self.headers}


class GmailClient(ProviderClient):
    def recent_messages(self):
        return requests.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5",
            headers=self._headers(), timeout=15
        ).json()


class GitHubClient(ProviderClient):
    def open_issues(self, owner, repo):
        return requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=5",
            headers={**self._headers(), "Accept": "application/vnd.github+json"}, timeout=15
        ).json()


class SlackClient(ProviderClient):
    def post_message(self, channel, text):
        return requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={**self._headers(), "Content-Type": "application/json; charset=utf-8"},
            json={"channel": channel, "text": text}, timeout=15
        ).json()


class NotionClient(ProviderClient):
    def search(self, query):
        return requests.post(
            "https://api.notion.com/v1/search",
            headers={**self._headers(), "Notion-Version": "2022-06-28"},
            json={"query": query}, timeout=15
        ).json()
```

把这一层抽出来的好处是：

- OAuth 连接对象和业务动作分离
- 统一处理重试、超时、限流、日志脱敏
- 后续替换成 OpenHuman 原生工具接口也更容易

### 5. 自动化编排中的错误分级建议

并不是每一种连接报错都该立刻中断整个工作流。对于 Gmail、Notion、GitHub、Slack 的混合编排，建议预先定义错误等级。

| 错误类型 | 典型平台 | 建议等级 | 处理动作 | 是否要求立即重试 |
| --- | --- | --- | --- | --- |
| `invalid_grant` | Gmail / Slack / GitHub | P1 | 标记连接失效并通知管理员 | 否，通常需重授 |
| `not_in_channel` | Slack | P2 | 自动补充操作提示或改投递备选频道 | 否 |
| 资源未共享 | Notion | P2 | 提醒把页面/数据库共享给 Integration | 否 |
| `403 insufficient permissions` | GitHub / Gmail | P2 | 对比 scope 与动作需求，必要时升级连接 | 否 |
| `429 rate limited` | 各平台 | P3 | 指数退避并记录限流指标 | 是 |
| 临时 `5xx` | 各平台 | P3 | 自动重试并保留审计日志 | 是 |

### 6. 典型排障案例补充

除了前文的通用错误名，下面给几个项目里最常遇到、但很容易误判的问题。

#### 案例 A：Gmail 已连接，但第二天批处理全部失败

**现象**：OpenHuman 控制台中连接状态仍显示 active，但读取 Gmail 时返回未授权。

**高概率原因**：

1. 首次授权时没有正确拿到 refresh token；
2. access token 夜间过期，定时任务在无人值守场景下全部失败；
3. 平台只缓存了 access token，没有持久化 refresh token。

**解决建议**：

- 检查 Google 授权参数中是否包含 `access_type=offline`
- 对重复授权场景加入 `prompt=consent`
- 在连接详情页展示“是否存在 refresh token”的审计字段

#### 案例 B：Notion 授权成功，但搜索页面一直为空

**现象**：OAuth 全程成功，没有报错，但搜索 API 返回空列表。

**高概率原因**：

1. 页面没有共享给 Integration；
2. 共享的是父页面，没有共享目标数据库本身；
3. 接入的是错误的工作区。

**解决建议**：

- 到 Notion 页面右上角重新执行 Share
- 单独检查数据库权限，不要只看页面树
- 在 OpenHuman 中记录 `workspace_name`，避免装错工作区后难以识别

#### 案例 C：GitHub 连接能识别身份，但读不到组织仓库

**现象**：`GET /user` 正常，`GET /repos/org/repo/issues` 却返回 404 或 403。

**高概率原因**：

1. 组织启用了第三方应用审批；
2. 用户级 OAuth 已通过，但组织资源未开放；
3. scope 看似足够，实际缺少组织侧授权。

**解决建议**：

- 去 GitHub 组织设置中检查 OAuth App access restrictions
- 对组织级访问优先评估 GitHub App 模式
- 在 OpenHuman UI 上明确区分“用户授权成功”和“组织资源可访问”

#### 案例 D：Slack 测试频道能发，生产频道不能发

**现象**：在个人测试频道一切正常，切到生产频道就报 `not_in_channel` 或 `channel_not_found`。

**高概率原因**：

1. 机器人并未加入生产频道；
2. OAuth 安装在错误 workspace；
3. 工作流里写的是频道名，但底层 API 实际要求 channel ID。

**解决建议**：

- 统一在配置中保存 channel ID 而不是显示名
- 为每个 workspace 维护单独的 Slack 连接
- 上线前增加一次“目标频道探活”检查

## 十九、给实施者的落地建议：从试点到规模化

如果你现在准备真正落地 OpenHuman 118+ 集成，我建议按下面的节奏推进：

### 阶段 1：单用户试点

- 先打通 Gmail + Notion
- 验证 OAuth 流程、回调、刷新
- 建立最小日志与排障机制

### 阶段 2：研发场景扩展

- 加入 GitHub + Slack
- 做第一个跨系统自动化工作流
- 评估多连接命名规范与团队共享策略

### 阶段 3：安全与治理补齐

- 做 scope 审查
- 加密与审计补齐
- 建立失效告警和定期审查制度

### 阶段 4：自定义集成与 Marketplace

- 把内部系统纳入统一模型
- 沉淀为 Marketplace 条目
- 把“连接”升级成平台通用资产

## 二十、结语：一键连接只是表象，真正的价值是统一能力层

很多人第一次看到 OpenHuman 的 118+ 集成，会被“数量”吸引；但真正用下来，你会发现决定平台上限的不是数量，而是统一性。统一的 OAuth 体验、统一的连接对象、统一的 scope 治理、统一的刷新机制、统一的安全边界、统一的运行时注入，才是让 Gmail、Notion、GitHub、Slack 这些看似分散的 SaaS 真正变成 Agent 能力底座的关键。

如果你只是把 OAuth 当成“登录一下拿个 token”，那集成一定会在规模化时失控；如果你把集成当作 OpenHuman 的基础设施层来建设，那么 118+ 不是复杂度的来源，反而是平台复用能力和交付速度的来源。

对于个人开发者，这意味着你可以更快做出真正可用的 AI 工作流；对于企业团队，这意味着你终于可以在安全、审计、权限和可运维的前提下，让 Agent 接入真实业务系统，而不再停留在 Demo。

归根结底，OpenHuman 的“一键 OAuth 连接”并不只是一个按钮，而是一整套关于连接、权限、运行时和治理的工程方法论。把这套方法用好，Gmail 可以成为沟通入口，Notion 可以成为知识沉淀层，GitHub 可以成为研发事实源，Slack 可以成为行动与协同界面；而 OpenHuman，则站在中间，把这些系统组织成一个真正可用的智能操作平面。

## 相关阅读

- [OpenHuman 实战：开源 AI 超级智能框架入门与 macOS 安装](/categories/架构/OpenHuman-实战-开源AI超级智能框架入门与macOS安装/)
- [OpenHuman TokenJuice 实战：智能 Token 压缩与成本优化](/categories/架构/OpenHuman-TokenJuice-实战-智能Token压缩与成本优化/)
- [OpenClaw + Discord 实战：多频道 AI 助手与社区管理](/categories/架构/OpenClaw-Discord-实战-多频道-AI-助手与社区管理/)
