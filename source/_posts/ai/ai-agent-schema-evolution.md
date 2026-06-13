---
title: AI Agent Schema Evolution 实战：工具定义版本化与向后兼容——MCP Server 的 API 演进与 Breaking Change 治理
keywords: [AI Agent Schema Evolution, MCP Server, API, Breaking Change, 工具定义版本化与向后兼容, 演进与, 治理, AI]
date: 2026-06-09 15:05:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - AI Agent
  - MCP
  - Schema Evolution
  - API Versioning
  - PHP
  - Laravel
description: 深入剖析 AI Agent 工具定义（Tool Schema）的版本演进策略，结合 MCP Server 实战，讲解如何在 PHP/Laravel 项目中实现工具定义的向后兼容、Breaking Change 治理与自动化迁移，确保 Agent 系统在持续迭代中稳定运行。
---


## 概述

AI Agent 系统正在从"单次调用"走向"多工具协作"。当你在 Laravel 项目中接入 MCP（Model Context Protocol）Server，为 Agent 定义几十个工具（Tools）时，一个核心问题会浮出水面：**工具的 Schema 怎么演进？**

每一次参数新增、字段重命名、返回值结构调整，都可能让已部署的 Agent 客户端"炸掉"。这和 REST API 的版本管理是同一个问题——只不过 Agent 工具定义的"调用方"不是前端程序员，而是 LLM 本身。LLM 不会读你的 changelog，它只认 Schema。

本文将从实战角度出发，讲解：

1. 为什么 Agent 工具定义需要版本化管理
2. MCP 协议下的 Schema 结构与演进约束
3. PHP/Laravel 中的实现方案：版本注册、兼容层、自动化迁移
4. 真实踩坑案例与避坑指南

## 核心概念

### 1. Tool Schema 是什么

在 MCP 协议中，每个工具（Tool）由一个 JSON Schema 定义：

```json
{
  "name": "search_orders",
  "description": "根据条件搜索订单",
  "inputSchema": {
    "type": "object",
    "properties": {
      "keyword": { "type": "string", "description": "搜索关键词" },
      "status": { "type": "string", "enum": ["pending", "completed", "cancelled"] },
      "page": { "type": "integer", "default": 1 }
    },
    "required": ["keyword"]
  }
}
```

LLM 在推理时会读取这个 Schema，理解工具的参数结构，然后生成调用请求。**Schema 就是工具的"契约"**——它是 LLM 和你的服务之间的唯一桥梁。

### 2. Breaking Change 的三种形态

| 类型 | 示例 | 风险等级 |
|------|------|---------|
| 字段删除 | 移除 `status` 参数 | 🔴 高（已有调用报错） |
| 字段重命名 | `keyword` → `query` | 🔴 高（LLM 传错参数） |
| 类型变更 | `page: integer` → `page: string` | 🟡 中（可能静默失败） |
| 可选→必填 | `status` 从可选变必填 | 🟡 中（LLM 可能不传） |
| 新增可选字段 | 增加 `date_range` | 🟢 低（向后兼容） |

### 3. MCP 协议的版本约束

MCP 协议本身**没有内置版本协商机制**。客户端连接 Server 后，通过 `tools/list` 获取工具列表，然后直接调用。这意味着：

- 你无法在协议层面声明"我支持 v1 和 v2"
- Schema 变更必须自保——靠服务端自己处理兼容性
- 多版本并存是你的责任，不是协议的责任

### 4. 为什么不能直接改 Schema

LLM 的工具调用是**概率性的**——它根据 Schema 生成参数。当你修改 Schema 后：

1. **已缓存的 System Prompt 会失效**：客户端可能缓存了旧 Schema
2. **微调模型可能崩掉**：基于旧 Schema 微调的模型会生成无效参数
3. **日志断裂**：历史调用记录和新 Schema 对不上，审计困难

## 实战代码：PHP/Laravel 实现

### 1. 版本化工具注册

首先，定义一个支持版本的工具注册系统：

```php
<?php

namespace App\Ai\Tools;

use Illuminate\Support\Arr;

class ToolRegistry
{
    protected array $tools = [];
    protected array $versions = [];

    /**
     * 注册工具，支持版本号
     */
    public function register(
        string $name,
        string $description,
        array $inputSchema,
        callable $handler,
        string $version = '1.0.0'
    ): void {
        $key = "{$name}@{$version}";
        
        $this->tools[$key] = [
            'name' => $name,
            'description' => $description,
            'inputSchema' => $inputSchema,
            'handler' => $handler,
            'version' => $version,
            'registered_at' => now()->toIso8601String(),
        ];

        // 维护版本索引
        $this->versions[$name][] = $version;
        sort($this->versions[$name]);
    }

    /**
     * 获取指定版本的工具定义
     */
    public function get(string $name, ?string $version = null): ?array
    {
        if ($version === null) {
            $version = $this->getLatestVersion($name);
        }

        return $this->tools["{$name}@{$version}"] ?? null;
    }

    /**
     * 获取工具的所有版本
     */
    public function getVersions(string $name): array
    {
        return $this->versions[$name] ?? [];
    }

    /**
     * 获取最新版本
     */
    public function getLatestVersion(string $name): ?string
    {
        $versions = $this->versions[$name] ?? [];
        return $versions ? end($versions) : null;
    }

    /**
     * 列出所有工具（最新版本），供 MCP tools/list 使用
     */
    public function listLatest(): array
    {
        $result = [];
        foreach ($this->versions as $name => $versions) {
            $latest = $this->get($name, end($versions));
            if ($latest) {
                $result[] = [
                    'name' => $latest['name'],
                    'description' => $latest['description'],
                    'inputSchema' => $latest['inputSchema'],
                    '_version' => $latest['version'], // 内部字段，不暴露给 LLM
                ];
            }
        }
        return $result;
    }
}
```

### 2. 兼容层：Schema Migration

关键组件——Schema 迁移器，处理版本间转换：

```php
<?php

namespace App\Ai\Tools\Migrations;

class SchemaMigrationManager
{
    protected array $migrations = [];

    /**
     * 注册迁移：从旧版本到新版本的参数转换
     */
    public function register(
        string $toolName,
        string $fromVersion,
        string $toVersion,
        callable $migrator
    ): void {
        $this->migrations[$toolName]["{$fromVersion}→{$toVersion}"] = $migrator;
    }

    /**
     * 自动迁移参数到最新版本
     */
    public function migrate(
        string $toolName,
        array $params,
        string $fromVersion
    ): array {
        $versions = app(ToolRegistry::class)->getVersions($toolName);
        $currentIndex = array_search($fromVersion, $versions);
        
        if ($currentIndex === false) {
            throw new \InvalidArgumentException(
                "Unknown version {$fromVersion} for tool {$toolName}"
            );
        }

        $result = $params;

        // 逐步迁移，每个版本跳跃一次
        for ($i = $currentIndex; $i < count($versions) - 1; $i++) {
            $from = $versions[$i];
            $to = $versions[$i + 1];
            $key = "{$from}→{$to}";

            if (isset($this->migrations[$toolName][$key])) {
                $result = ($this->migrations[$toolName][$key])($result);
            }
        }

        return $result;
    }
}
```

### 3. 定义工具和迁移

实际例子——订单搜索工具的版本演进：

```php
<?php

use App\Ai\Tools\ToolRegistry;
use App\Ai\Tools\Migrations\SchemaMigrationManager;

// === 注册 V1.0.0 ===
app(ToolRegistry::class)->register(
    name: 'search_orders',
    description: '根据关键词搜索订单',
    inputSchema: [
        'type' => 'object',
        'properties' => [
            'keyword' => ['type' => 'string', 'description' => '搜索关键词'],
            'status' => ['type' => 'string', 'enum' => ['pending', 'completed']],
            'page' => ['type' => 'integer', 'default' => 1],
        ],
        'required' => ['keyword'],
    ],
    handler: fn($params) => app(OrderSearchService::class)->search($params),
    version: '1.0.0'
);

// === 注册 V1.1.0：新增 date_range、增加 status 选项 ===
app(ToolRegistry::class)->register(
    name: 'search_orders',
    description: '根据条件搜索订单，支持日期范围和更多状态',
    inputSchema: [
        'type' => 'object',
        'properties' => [
            'keyword' => ['type' => 'string', 'description' => '搜索关键词'],
            'status' => ['type' => 'string', 'enum' => ['pending', 'completed', 'cancelled', 'refunded']],
            'date_range' => [
                'type' => 'object',
                'properties' => [
                    'from' => ['type' => 'string', 'format' => 'date'],
                    'to' => ['type' => 'string', 'format' => 'date'],
                ],
            ],
            'page' => ['type' => 'integer', 'default' => 1],
        ],
        'required' => ['keyword'],
    ],
    handler: fn($params) => app(OrderSearchService::class)->searchV2($params),
    version: '1.1.0'
);

// === V1.0.0 → V1.1.0 迁移规则 ===
app(SchemaMigrationManager::class)->register(
    toolName: 'search_orders',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    migrator: function (array $params) {
        // V1.1.0 新增的 date_range 是可选的，不需要处理
        // V1.1.0 扩展了 status 枚举，旧值依然有效
        // 无需转换，直接返回
        return $params;
    }
);
```

### 4. 兼容层：请求拦截与版本检测

在 MCP Server 的请求处理层加入版本兼容：

```php
<?php

namespace App\Ai\Mcp;

use App\Ai\Tools\ToolRegistry;
use App\Ai\Tools\Migrations\SchemaMigrationManager;

class ToolCallMiddleware
{
    public function handle(mixed $request, \Closure $next): mixed
    {
        $toolName = $request->params['name'] ?? null;
        $arguments = $request->params['arguments'] ?? [];

        if ($toolName === null) {
            return $next($request);
        }

        $registry = app(ToolRegistry::class);
        $migrator = app(SchemaMigrationManager::class);

        // 从请求头或参数中获取客户端声称的 Schema 版本
        $clientVersion = $request->headers['x-schema-version'] ?? null;

        if ($clientVersion !== null) {
            // 客户端指定了版本，需要迁移
            $latestVersion = $registry->getLatestVersion($toolName);

            if ($clientVersion !== $latestVersion) {
                $arguments = $migrator->migrate(
                    toolName: $toolName,
                    params: $arguments,
                    fromVersion: $clientVersion
                );

                // 记录迁移日志
                \Log::info('Schema migration applied', [
                    'tool' => $toolName,
                    'from' => $clientVersion,
                    'to' => $latestVersion,
                ]);
            }
        }

        // 注入版本信息到请求
        $request->params['arguments'] = $arguments;
        $request->params['_schema_version'] = $registry->getLatestVersion($toolName);

        return $next($request);
    }
}
```

### 5. 自动版本协商：让 LLM 知道当前版本

在 System Prompt 中动态注入工具版本信息：

```php
<?php

namespace App\Ai\Tools;

class SystemPromptBuilder
{
    public function buildWithToolVersions(array $tools): string
    {
        $toolList = collect($tools)->map(function ($tool) {
            $version = $tool['_version'] ?? 'unknown';
            $required = $tool['inputSchema']['required'] ?? [];
            $props = $tool['inputSchema']['properties'] ?? [];

            $paramStr = collect($props)->map(function ($schema, $name) use ($required) {
                $req = in_array($name, $required) ? '(必填)' : '(可选)';
                $type = $schema['type'] ?? 'mixed';
                $desc = $schema['description'] ?? '';
                return "  - {$name}: {$type} {$req} - {$desc}";
            })->implode("\n");

            return "## {$tool['name']} (v{$version})\n{$tool['description']}\n参数:\n{$paramStr}";
        })->implode("\n\n");

        return <<<PROMPT
你是一个 AI 助手，可以使用以下工具。注意每个工具都有版本号。

**重要规则：**
1. 调用工具时，必须在请求头中携带当前工具的版本号
2. 如果工具版本发生变化，参数结构可能已更新
3. 优先使用最新版本的参数结构

{$toolList}
PROMPT;
    }
}
```

### 6. 完整的 MCP Server 集成

将所有组件整合到 Laravel 的 MCP Server 实现中：

```php
<?php

namespace App\Mcp;

use App\Ai\Tools\ToolRegistry;
use App\Ai\Tools\Migrations\SchemaMigrationManager;
use App\Ai\Tools\SystemPromptBuilder;

class McpServer
{
    public function __construct(
        protected ToolRegistry $registry,
        protected SchemaMigrationManager $migrator,
        protected SystemPromptBuilder $promptBuilder,
    ) {}

    /**
     * 处理 tools/list 请求
     */
    public function handleToolsList(): array
    {
        $tools = $this->registry->listLatest();

        return [
            'tools' => array_map(function ($tool) {
                return [
                    'name' => $tool['name'],
                    'description' => $tool['description'],
                    'inputSchema' => $tool['inputSchema'],
                ];
            }, $tools),
        ];
    }

    /**
     * 处理 tools/call 请求
     */
    public function handleToolCall(string $name, array $arguments, ?string $version = null): array
    {
        $tool = $this->registry->get($name, $version);

        if ($tool === null) {
            // 版本不存在，尝试最新版本并迁移
            if ($version !== null) {
                $latestVersion = $this->registry->getLatestVersion($name);
                $arguments = $this->migrator->migrate($name, $arguments, $version);
                $tool = $this->registry->get($name, $latestVersion);
            }

            if ($tool === null) {
                throw new \RuntimeException("Tool '{$name}' not found");
            }
        }

        // 参数校验
        $validator = \Validator::make(
            $arguments,
            $this->buildValidationRules($tool['inputSchema'])
        );

        if ($validator->fails()) {
            return [
                'content' => [
                    ['type' => 'text', 'text' => '参数校验失败: ' . $validator->errors()->first()],
                ],
                'isError' => true,
            ];
        }

        // 执行工具
        $result = ($tool['handler'])($arguments);

        return [
            'content' => [
                ['type' => 'text', 'text' => is_string($result) ? $result : json_encode($result)],
            ],
        ];
    }

    protected function buildValidationRules(array $schema): array
    {
        $rules = [];
        $required = $schema['required'] ?? [];
        $properties = $schema['properties'] ?? [];

        foreach ($properties as $name => $prop) {
            $fieldRules = [];

            if (in_array($name, $required)) {
                $fieldRules[] = 'required';
            } else {
                $fieldRules[] = 'nullable';
            }

            switch ($prop['type'] ?? 'string') {
                case 'string':
                    $fieldRules[] = 'string';
                    if (isset($prop['enum'])) {
                        $fieldRules[] = 'in:' . implode(',', $prop['enum']);
                    }
                    break;
                case 'integer':
                    $fieldRules[] = 'integer';
                    break;
                case 'number':
                    $fieldRules[] = 'numeric';
                    break;
                case 'boolean':
                    $fieldRules[] = 'boolean';
                    break;
                case 'object':
                    $fieldRules[] = 'array';
                    break;
            }

            $rules[$name] = $fieldRules;
        }

        return $rules;
    }
}
```

## 踩坑记录

### 坑 1：LLM 不会传版本号

**现象**：LLM 调用工具时，不会自动在请求头中携带 Schema 版本。

**解决**：不要依赖 LLM 传版本号。改用以下策略：
- 服务端维护"已知客户端版本"映射表
- 通过 session/连接标识追踪客户端版本
- 在连接建立时协商版本

```php
// 在 MCP 连接初始化时记录版本
protected function handleInitialize(array $params): array
{
    $clientInfo = $params['clientInfo'] ?? [];
    $clientVersion = $clientInfo['schemaVersion'] ?? '1.0.0';

    session(['mcp_schema_version' => $clientVersion]);

    return [
        'protocolVersion' => '2024-11-05',
        'serverInfo' => [
            'name' => 'kkday-mcp-server',
            'version' => '2.0.0',
        ],
        'capabilities' => ['tools' => ['listChanged' => true]],
    ];
}
```

### 坑 2：Schema 校验过严导致迁移失败

**现象**：V1.1.0 新增了 `date_range` 可选字段，但 V1.0.0 的客户端传入的参数没有这个字段，校验失败。

**解决**：校验时只校验 `required` 字段，不对可选字段做强制校验：

```php
// ❌ 错误：对所有字段做校验
$validator = Validator::make($arguments, [
    'keyword' => 'required|string',
    'status' => 'nullable|string',
    'date_range' => 'nullable|array', // V1.0.0 客户端不会传这个
]);

// ✅ 正确：只校验当前版本 Schema 中声明的字段
$rules = $this->buildValidationRules($tool['inputSchema']);
$validator = Validator::make($arguments, $rules);
```

### 坑 3：枚举值扩展导致旧客户端异常

**现象**：V1.0.0 的 `status` 枚举是 `['pending', 'completed']`，V1.1.0 扩展为 `['pending', 'completed', 'cancelled', 'refunded']`。旧客户端传入 `pending`，但 LLM 看到新枚举后可能生成 `cancelled`，而旧服务端不认。

**解决**：枚举值只能**新增**，不能删除或重命名。在迁移层做值映射：

```php
// V1.0.0 → V1.1.0 迁移：如果客户端传了未知枚举值，映射到默认值
'migrator' => function (array $params) {
    $validStatuses = ['pending', 'completed', 'cancelled', 'refunded'];
    
    if (isset($params['status']) && !in_array($params['status'], $validStatuses)) {
        \Log::warning('Invalid status from old client', ['status' => $params['status']]);
        unset($params['status']);
    }
    
    return $params;
}
```

### 坑 4：工具重命名导致历史数据断裂

**现象**：`search_orders` 改名为 `find_orders`，历史日志中的工具名对不上。

**解决**：工具名一旦发布就不能改。如果确实需要重命名：
1. 保留旧名作为别名
2. 新工具内部调用旧逻辑
3. 日志同时记录新旧名

```php
// 注册别名
$this->registry->register(
    name: 'search_orders',  // 旧名保留
    description: '[已弃用] 请使用 find_orders',
    inputSchema: $oldSchema,
    handler: fn($params) => $this->handleDeprecatedCall('find_orders', $params),
    version: '1.1.0'
);

$this->registry->register(
    name: 'find_orders',  // 新名
    description: '根据条件搜索订单',
    inputSchema: $newSchema,
    handler: fn($params) => app(OrderSearchService::class)->search($params),
    version: '2.0.0'
);
```

### 坑 5：多版本并存的内存开销

**现象**：工具太多，每个工具维护 3-4 个版本，内存占用翻倍。

**解决**：
- 活跃版本不超过 3 个（当前版本 + 前 2 个版本）
- 超过 3 个版本的旧版本标记为 deprecated
- 旧版本的 handler 指向迁移层，不重复注册完整逻辑

## 总结

AI Agent 工具定义的 Schema 演进，本质上是**契约管理**问题。和传统 API 版本管理相比，它有两个独特挑战：

1. **调用方是 LLM，不是程序员**：LLM 不会读 changelog，不会主动升级 SDK。你的兼容层必须足够厚，能自动处理版本差异。

2. **Schema 是概率性的**：LLM 根据 Schema 生成参数，Schema 的微小变化可能显著影响 LLM 的调用行为。

**实践原则**：

- **工具名不改**，参数只增不删
- **枚举值只增不减**，旧值永远有效
- **版本迁移自动做**，不依赖客户端升级
- **活跃版本控制在 3 个以内**，避免维护地狱
- **日志记录版本信息**，出问题能追溯

在 KKday 的 MCP Server 实践中，这套机制帮助我们在不停服的情况下完成了 5 次工具定义升级，零线上事故。关键在于：**把 Schema 演进当作数据库迁移来做——有版本、有迁移脚本、有回滚方案。**

---

*本文基于 KKday 30+ 仓库的 MCP Server 实践总结，PHP 8.2 + Laravel 11 环境。*
