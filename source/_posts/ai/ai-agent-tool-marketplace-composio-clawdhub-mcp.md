---
title: AI Agent Tool Marketplace 实战：Composio/ClawdHub/MCP 生态——工具发现、安装与版本管理
keywords: [AI Agent Tool Marketplace, Composio, ClawdHub, MCP, 生态, 工具发现, 安装与版本管理, AI]
date: 2026-06-09 08:38:00
categories:
  - ai
tags:
  - AI Agent
  - Tool Marketplace
  - Composio
  - ClawdHub
  - MCP
  - Laravel
  - PHP
description: 深入解析 AI Agent 工具生态：Composio、ClawdHub、MCP 三大平台的工具发现、安装、版本管理机制，附 Laravel 集成实战代码。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200
---


## 概述

AI Agent 的核心能力不在于"思考"，而在于**行动**。一个 Agent 再聪明，如果无法调用外部工具——查数据库、发邮件、操作浏览器、调用 API——它就只是一个聊天机器人。

2026 年，Agent 工具生态已经从"手动集成"走向**平台化、市场化**。三个关键玩家正在定义这个领域：

| 平台 | 定位 | 核心机制 |
|------|------|---------|
| **MCP (Model Context Protocol)** | 标准协议层 | Anthropic 提出的开放协议，Agent ↔ Tool 的通信标准 |
| **Composio** | 托管工具市场 | 400+ 预构建集成，OAuth 管理，权限沙箱 |
| **ClawdHub** | Agent Skill 市场 | 面向 Agent 的技能包分发，版本化管理，社区共享 |

这篇文章不讲概念，只讲**实战**：怎么发现工具、怎么安装、怎么管理版本、怎么在 Laravel 项目中集成。

---

## 核心概念：三层架构

工具生态的本质是三层：

```
┌─────────────────────────────────────────┐
│           Agent Runtime                 │
│    (Claude / GPT / 自建 Agent)          │
├─────────────────────────────────────────┤
│         Protocol Layer (MCP)            │
│    标准化的 Tool Discovery / Invocation  │
├─────────────────┬───────────────────────┤
│   Composio      │      ClawdHub         │
│  (托管服务)     │   (技能包市场)         │
│  400+ 集成      │   版本化 Skill         │
│  OAuth/沙箱     │   社区共享             │
└─────────────────┴───────────────────────┘
```

- **MCP** 是"语言"——Agent 和 Tool 用它对话
- **Composio** 是"应用商店"——预构建的、带权限管理的工具集
- **ClawdHub** 是"npm for Agent Skills"——可版本化的技能包

---

## MCP：工具发现与调用协议

### MCP 是什么

MCP（Model Context Protocol）是 Anthropic 在 2024 年底提出的开放协议，2026 年已成为事实标准。核心思想：**Tool 通过标准化接口暴露能力，Agent 通过统一协议发现和调用**。

一个 MCP Tool Server 暴露三个概念：

```json
{
  "tools": [
    {
      "name": "query_database",
      "description": "Execute a read-only SQL query",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sql": { "type": "string", "description": "SQL query" }
        },
        "required": ["sql"]
      }
    }
  ],
  "resources": [
    {
      "uri": "db://schema",
      "name": "Database Schema",
      "mimeType": "application/json"
    }
  ],
  "prompts": [
    {
      "name": "sql_helper",
      "description": "Help construct safe SQL queries"
    }
  ]
}
```

### MCP 的发现机制

Agent 连接到 MCP Server 后，通过 `tools/list` 请求获取可用工具列表：

```php
// Laravel 中实现 MCP 客户端
class McpClient
{
    private string $serverUrl;
    private HttpClientInterface $http;

    public function __construct(string $serverUrl, HttpClientInterface $http)
    {
        $this->serverUrl = $serverUrl;
        $this->http = $http;
    }

    /**
     * 发现服务器提供的所有工具
     */
    public function discoverTools(): array
    {
        $response = $this->http->request('POST', $this->serverUrl, [
            'json' => [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => 'tools/list',
                'params' => [],
            ],
        ]);

        $result = json_decode($response->getContent(), true);

        return $result['result']['tools'] ?? [];
    }

    /**
     * 调用指定工具
     */
    public function callTool(string $toolName, array $arguments): array
    {
        $response = $this->http->request('POST', $this->serverUrl, [
            'json' => [
                'jsonrpc' => '2.0',
                'id' => 2,
                'method' => 'tools/call',
                'params' => [
                    'name' => $toolName,
                    'arguments' => $arguments,
                ],
            ],
        ]);

        $result = json_decode($response->getContent(), true);

        return $result['result'] ?? [];
    }
}
```

### 实际使用

```php
$client = new McpClient('http://localhost:3001/mcp', $httpClient);

// 1. 发现工具
$tools = $client->discoverTools();
// 返回: [['name' => 'query_database', 'description' => '...', ...]]

// 2. 调用工具
$result = $client->callTool('query_database', [
    'sql' => 'SELECT COUNT(*) as total FROM orders WHERE status = "completed"',
]);
// 返回: ['content' => [['type' => 'text', 'text' => '{"total": 15823}']]]
```

MCP 的关键优势：**工具描述是机器可读的**。Agent 可以自动理解每个工具的用途和参数，无需硬编码。

---

## Composio：托管工具市场

### Composio 的定位

Composio 是一个托管的工具集成平台，提供 400+ 预构建连接器（GitHub、Slack、Notion、Jira、Google Workspace、数据库等）。核心价值：

1. **OAuth 管理**——不用自己处理 token 刷新
2. **权限沙箱**——每个工具限定最小权限
3. **执行日志**——谁在什么时候调了什么，全有记录

### Composio 的工具发现

```php
class ComposioClient
{
    private string $apiKey;
    private HttpClientInterface $http;

    public function __construct(string $apiKey, HttpClientInterface $http)
    {
        $this->apiKey = $apiKey;
        $this->http = $http;
    }

    /**
     * 列出所有可用的 App（集成）
     */
    public function listApps(): array
    {
        $response = $this->http->request('GET', 'https://api.composio.dev/v1/apps', [
            'headers' => [
                'x-api-key' => $this->apiKey,
            ],
        ]);

        return json_decode($response->getContent(), true)['items'] ?? [];
    }

    /**
     * 获取特定 App 的所有 Actions（工具）
     */
    public function listActions(string $appName): array
    {
        $response = $this->http->request('GET', "https://api.composio.dev/v1/actions", [
            'headers' => [
                'x-api-key' => $this->apiKey,
            ],
            'query' => [
                'appNames' => $appName,
            ],
        ]);

        return json_decode($response->getContent(), true)['items'] ?? [];
    }

    /**
     * 执行一个 Action
     */
    public function executeAction(string $actionId, array $params, string $connectedAccountId): array
    {
        $response = $this->http->request('POST', "https://api.composio.dev/v1/actions/{$actionId}/execute", [
            'headers' => [
                'x-api-key' => $this->apiKey,
            ],
            'json' => [
                'params' => $params,
                'connectedAccountId' => $connectedAccountId,
            ],
        ]);

        return json_decode($response->getContent(), true);
    }
}
```

### OAuth 连接管理

```php
// 1. 创建 OAuth 连接
$composio = new ComposioClient(config('composio.api_key'), $httpClient);

// 2. 获取授权 URL（用户点击后跳转到 GitHub 授权）
$authUrl = $composio->getAuthorizationUrl('github', [
    'redirect_uri' => route('composio.callback'),
    'scope' => 'repo,user',
]);

// 3. 用户授权后，回调处理
public function handleCallback(Request $request)
{
    $code = $request->query('code');
    
    // Composio 自动处理 token 交换和存储
    $connectedAccount = $this->composio->exchangeCode($code);
    
    // 4. 之后调用工具时，只需传 connectedAccountId
    $result = $this->composio->executeAction(
        'github_create_issue',
        [
            'owner' => 'mikeah2011',
            'repo' => 'my-project',
            'title' => 'Auto-generated issue',
            'body' => 'Created by AI Agent',
        ],
        $connectedAccount['id']
    );
}
```

### Composio vs 手动集成

| 维度 | 手动集成 | Composio |
|------|---------|---------|
| OAuth 管理 | 自己写 token 刷新逻辑 | 自动处理 |
| 权限控制 | 全有或全无 | 细粒度沙箱 |
| 工具发现 | 读文档、写代码 | API 自动获取 |
| 维护成本 | API 变更要自己适配 | 平台统一升级 |

---

## ClawdHub：Agent Skill 市场

### ClawdHub 的定位

如果说 Composio 是"API 集成商店"，ClawdHub 更像"npm for Agent Skills"。每个 Skill 是一个可版本化的指令包，告诉 Agent **如何使用某个工具或完成某类任务**。

### Skill 结构

一个典型的 ClawdHub Skill：

```
skill-name/
├── SKILL.md          # 核心指令（Agent 读取这个文件）
├── package.json      # 元数据：名称、版本、依赖
└── assets/           # 支持文件
    ├── templates/
    └── examples/
```

`SKILL.md` 是关键——它用自然语言告诉 Agent 怎么干活：

```markdown
# GitHub Issue Manager

## 触发条件
当用户要求创建、查询、更新 GitHub Issue 时激活。

## 步骤
1. 使用 `gh` CLI 获取仓库信息
2. 解析用户需求为 Issue 结构
3. 执行创建/更新操作
4. 返回 Issue URL

## 约束
- 不要删除 Issue，只创建和更新
- 每次操作前确认仓库名
```

### 版本管理

ClawdHub 的版本管理类似 npm：

```bash
# 安装特定版本
clawdhub install github-issue-manager@1.2.0

# 更新到最新
clawdhub update github-issue-manager

# 查看已安装版本
clawdhub list
# github-issue-manager@1.2.0
# browser-automation@2.0.1
# database-migration@1.0.3
```

### 在 Laravel 中集成 ClawdHub

```php
class SkillManager
{
    private string $skillsDir;

    public function __construct(string $skillsDir)
    {
        $this->skillsDir = $skillsDir;
    }

    /**
     * 加载已安装的 Skills
     */
    public function loadInstalledSkills(): array
    {
        $skills = [];
        $manifestPath = $this->skillsDir . '/.manifest.json';

        if (!file_exists($manifestPath)) {
            return $skills;
        }

        $manifest = json_decode(file_get_contents($manifestPath), true);

        foreach ($manifest['installed'] ?? [] as $name => $version) {
            $skillDir = "{$this->skillsDir}/{$name}@{$version}";
            $skillMd = $skillDir . '/SKILL.md';

            if (file_exists($skillMd)) {
                $skills[] = [
                    'name' => $name,
                    'version' => $version,
                    'instructions' => file_get_contents($skillMd),
                ];
            }
        }

        return $skills;
    }

    /**
     * 将 Skills 注入 Agent 的 System Prompt
     */
    public function buildAgentPrompt(string $basePrompt): string
    {
        $skills = $this->loadInstalledSkills();

        if (empty($skills)) {
            return $basePrompt;
        }

        $skillSection = "\n\n## Available Skills\n\n";
        foreach ($skills as $skill) {
            $skillSection .= "### {$skill['name']} (v{$skill['version']})\n";
            $skillSection .= "{$skill['instructions']}\n\n";
        }

        return $basePrompt . $skillSection;
    }
}
```

---

## 实战：构建 Agent 工具注册中心

在实际项目中，我们通常需要一个统一的工具注册中心，把 MCP、Composio、ClawdHub 的工具聚合在一起。

### 工具注册表

```php
class ToolRegistry
{
    private array $providers = [];
    private array $tools = [];

    /**
     * 注册工具提供者
     */
    public function registerProvider(string $name, ToolProvider $provider): void
    {
        $this->providers[$name] = $provider;
    }

    /**
     * 从所有提供者发现工具
     */
    public function discoverAll(): array
    {
        $this->tools = [];

        foreach ($this->providers as $providerName => $provider) {
            $providerTools = $provider->discover();

            foreach ($providerTools as &$tool) {
                $tool['provider'] = $providerName;
                $tool['global_id'] = "{$providerName}::{$tool['name']}";
            }

            $this->tools = array_merge($this->tools, $providerTools);
        }

        return $this->tools;
    }

    /**
     * 通过全局 ID 调用工具
     */
    public function call(string $globalId, array $params): array
    {
        $parts = explode('::', $globalId, 2);
        $providerName = $parts[0];
        $toolName = $parts[1];

        if (!isset($this->providers[$providerName])) {
            throw new \RuntimeException("Unknown provider: {$providerName}");
        }

        return $this->providers[$providerName]->call($toolName, $params);
    }

    /**
     * 搜索工具（按名称或描述）
     */
    public function search(string $query): array
    {
        $query = strtolower($query);

        return array_filter($this->tools, function ($tool) use ($query) {
            return str_contains(strtolower($tool['name']), $query)
                || str_contains(strtolower($tool['description'] ?? ''), $query);
        });
    }
}
```

### 接口定义

```php
interface ToolProvider
{
    /**
     * 发现该提供者的所有工具
     * @return array<array{name: string, description: string, inputSchema: array}>
     */
    public function discover(): array;

    /**
     * 调用指定工具
     */
    public function call(string $toolName, array $params): array;
}
```

### MCP Provider 实现

```php
class McpToolProvider implements ToolProvider
{
    private McpClient $client;

    public function __construct(McpClient $client)
    {
        $this->client = $client;
    }

    public function discover(): array
    {
        return $this->client->discoverTools();
    }

    public function call(string $toolName, array $params): array
    {
        return $this->client->callTool($toolName, $params);
    }
}
```

### Composio Provider 实现

```php
class ComposioToolProvider implements ToolProvider
{
    private ComposioClient $client;
    private string $connectedAccountId;

    public function __construct(ComposioClient $client, string $connectedAccountId)
    {
        $this->client = $client;
        $this->connectedAccountId = $connectedAccountId;
    }

    public function discover(): array
    {
        $actions = $this->client->listActions('github');

        return array_map(function ($action) {
            return [
                'name' => $action['name'],
                'description' => $action['description'],
                'inputSchema' => $action['inputSchema'] ?? [],
            ];
        }, $actions);
    }

    public function call(string $toolName, array $params): array
    {
        return $this->client->executeAction($toolName, $params, $this->connectedAccountId);
    }
}
```

### 组装使用

```php
// 注册所有提供者
$registry = new ToolRegistry();

// MCP Server（本地运行的工具服务器）
$registry->registerProvider('mcp', new McpToolProvider(
    new McpClient('http://localhost:3001/mcp', $httpClient)
));

// Composio（GitHub 集成）
$registry->registerProvider('composio', new ComposioToolProvider(
    new ComposioClient(config('composio.api_key'), $httpClient),
    $connectedAccountId
));

// 发现所有工具
$allTools = $registry->discoverAll();

// 搜索特定工具
$dbTools = $registry->search('database');
// 返回: [['global_id' => 'mcp::query_database', ...]]

// 调用工具
$result = $registry->call('mcp::query_database', [
    'sql' => 'SELECT * FROM products WHERE active = 1 LIMIT 10',
]);
```

---

## 版本管理最佳实践

工具生态的最大痛点之一是**版本兼容性**。工具 API 可能变更，Agent 的行为需要跟上。

### 工具版本锁定

```json
{
  "tools": {
    "mcp_servers": {
      "database": {
        "url": "http://localhost:3001/mcp",
        "version": "1.2.0",
        "checksum": "sha256:abc123..."
      },
      "github": {
        "url": "http://localhost:3002/mcp",
        "version": "2.0.1",
        "checksum": "sha256:def456..."
      }
    },
    "composio": {
      "apps": ["github", "slack", "notion"],
      "version_constraint": ">=1.0.0"
    },
    "clawdhub_skills": {
      "browser-automation": "2.0.1",
      "database-migration": "1.0.3"
    }
  }
}
```

### 兼容性检查

```php
class ToolVersionChecker
{
    private ToolRegistry $registry;

    public function checkCompatibility(array $requiredVersions): array
    {
        $issues = [];

        foreach ($requiredVersions as $toolName => $required) {
            $installed = $this->registry->getInstalledVersion($toolName);

            if ($installed === null) {
                $issues[] = [
                    'tool' => $toolName,
                    'issue' => 'not_installed',
                    'required' => $required,
                ];
                continue;
            }

            if (version_compare($installed, $required['min'], '<')) {
                $issues[] = [
                    'tool' => $toolName,
                    'issue' => 'version_too_old',
                    'installed' => $installed,
                    'required_min' => $required['min'],
                ];
            }

            if (isset($required['max']) && version_compare($installed, $required['max'], '>')) {
                $issues[] = [
                    'tool' => $toolName,
                    'issue' => 'version_too_new',
                    'installed' => $installed,
                    'required_max' => $required['max'],
                ];
            }
        }

        return $issues;
    }
}
```

---

## 踩坑记录

### 1. MCP Server 的连接超时

MCP Server 默认使用 stdio 传输，但在 Laravel 的 HTTP 环境中需要 SSE（Server-Sent Events）传输。如果用 stdio，进程会阻塞。

**解决：** 使用 `mcp-proxy` 桥接 stdio 到 HTTP：

```bash
npx mcp-proxy --port 3001 ./my-mcp-server
```

### 2. Composio OAuth Token 过期

Composio 的 OAuth token 会过期，但有些 Action 执行时才报错。

**解决：** 在每次调用前检查 token 状态：

```php
$account = $composio->getConnectedAccount($connectedAccountId);
if ($account['tokenExpired'] ?? false) {
    $composio->refreshToken($connectedAccountId);
}
```

### 3. ClawdHub Skill 版本冲突

两个 Skill 可能定义了同名的工具，导致 Agent 行为不确定。

**解决：** 在 Skill 加载时检查命名冲突：

```php
$toolNames = [];
foreach ($skills as $skill) {
    foreach ($skill['tools'] as $tool) {
        if (isset($toolNames[$tool['name']])) {
            throw new \RuntimeException(
                "Tool name conflict: '{$tool['name']}' in {$skill['name']} "
                . "conflicts with {$toolNames[$tool['name']]['skill']}"
            );
        }
        $toolNames[$tool['name']] = ['skill' => $skill['name']];
    }
}
```

### 4. 工具调用的幂等性

Agent 可能重复调用同一个工具（比如网络重试）。非幂等操作（创建 Issue、发送邮件）可能重复执行。

**解决：** 为每次工具调用生成唯一 ID，服务端做去重：

```php
class IdempotentToolCaller
{
    private Redis $redis;

    public function call(string $toolId, string $idempotencyKey, array $params): array
    {
        $lockKey = "tool_call:{$toolId}:{$idempotencyKey}";

        // 检查是否已执行
        $cached = $this->redis->get($lockKey);
        if ($cached) {
            return json_decode($cached, true);
        }

        // 执行工具
        $result = $this->registry->call($toolId, $params);

        // 缓存结果 1 小时
        $this->redis->setex($lockKey, 3600, json_encode($result));

        return $result;
    }
}
```

---

## 总结

2026 年的 AI Agent 工具生态已经形成了清晰的分工：

1. **MCP** 提供标准化协议，让工具发现和调用有统一的"语言"
2. **Composio** 提供托管集成，解决 OAuth、权限、维护等脏活累活
3. **ClawdHub** 提供技能包市场，让 Agent 的能力可以版本化、可分享

在 Laravel 项目中的集成路径：

- 实现 `ToolProvider` 接口适配不同来源
- 构建 `ToolRegistry` 统一管理所有工具
- 做好版本锁定和兼容性检查
- 处理好幂等性和错误重试

工具生态的核心挑战不再是"能不能调用"，而是"怎么管理"。版本兼容性、权限控制、调用追踪——这些才是生产环境中的真正痛点。

---

> 参考资料：
> - [MCP 官方文档](https://modelcontextprotocol.io)
> - [Composio 文档](https://docs.composio.dev)
> - [ClawdHub Registry](https://clawdhub.com)
> - 项目实战：Agent 工具注册中心设计
