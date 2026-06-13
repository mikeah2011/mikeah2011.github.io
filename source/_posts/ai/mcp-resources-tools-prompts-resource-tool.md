---
title: MCP Resources vs Tools vs Prompts 实战：三种原语的工程化选型——何时用 Resource 而非 Tool？
keywords: [MCP Resources vs Tools vs Prompts, Resource, Tool, 三种原语的工程化选型, 何时用, 而非, AI]
date: 2026-06-09 23:45:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - MCP
  - AI
  - LLM
  - 工程化
  - 工具调用
description: 深入解析 MCP 协议中 Resources、Tools、Prompts 三种原语的区别与适用场景，结合 PHP/Laravel 实战代码，帮你做出正确的工程化选型决策。
---


## 概述

MCP（Model Context Protocol）定义了三种核心原语：**Resources**、**Tools** 和 **Prompts**。很多开发者在实际项目中经常混淆它们的使用场景，导致架构设计不够优雅。

本文将从工程化角度出发，逐一解析这三种原语的本质区别，并通过 PHP/Laravel 实战代码，帮你做出正确的选型决策。

## 核心概念

### 1. Resources：数据源

Resources 是**只读数据源**，用于向 LLM 提供上下文信息。它的核心特征是：

- **只读**：不产生副作用
- **幂等**：多次调用结果相同
- **被动**：由 LLM 主动请求，而非主动触发

**适用场景：**
- 读取数据库记录
- 获取配置信息
- 加载文件内容
- 查询 API 数据

```php
// Resources 示例：读取用户信息
class UserResource
{
    public function read(string $userId): array
    {
        $user = User::find($userId);
        
        return [
            'uri' => "user://{$userId}",
            'name' => '用户信息',
            'description' => "获取用户 {$user->name} 的详细信息",
            'mimeType' => 'application/json',
            'content' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'created_at' => $user->created_at->toIso8601String(),
            ],
        ];
    }
}
```

### 2. Tools：操作执行器

Tools 是**可执行的操作**，用于让 LLM 触发具体的业务逻辑。它的核心特征是：

- **有副作用**：会产生实际效果
- **非幂等**：多次调用可能产生不同结果
- **主动**：LLM 决定何时调用

**适用场景：**
- 发送邮件
- 创建/更新/删除记录
- 调用外部 API
- 执行计算

```php
// Tools 示例：发送邮件
class SendEmailTool
{
    public function execute(array $params): array
    {
        $to = $params['to'];
        $subject = $params['subject'];
        $body = $params['body'];
        
        // 执行发送操作（有副作用）
        Mail::to($to)->send(new NotificationMail($subject, $body));
        
        return [
            'success' => true,
            'message' => "邮件已发送至 {$to}",
        ];
    }
}
```

### 3. Prompts：交互模板

Prompts 是**预定义的交互模板**，用于标准化 LLM 与用户的交互流程。它的核心特征是：

- **模板化**：提供固定的交互模式
- **可组合**：可以包含多个 Resources 和 Tools
- **引导性**：引导 LLM 按特定流程工作

**适用场景：**
- 代码审查流程
- 文档生成流程
- 数据分析流程
- 客户服务流程

```php
// Prompts 示例：代码审查流程
class CodeReviewPrompt
{
    public function generate(array $params): array
    {
        $code = $params['code'];
        $language = $params['language'];
        
        return [
            'name' => '代码审查',
            'description' => '审查代码质量并提供改进建议',
            'arguments' => [
                [
                    'name' => 'code',
                    'description' => '待审查的代码',
                    'required' => true,
                ],
                [
                    'name' => 'language',
                    'description' => '编程语言',
                    'required' => false,
                ],
            ],
            'messages' => [
                [
                    'role' => 'user',
                    'content' => [
                        'type' => 'text',
                        'text' => "请审查以下 {$language} 代码：\n\n```{$language}\n{$code}\n```\n\n请从以下方面进行审查：\n1. 代码质量\n2. 性能优化\n3. 安全性\n4. 可维护性",
                    ],
                ],
            ],
        ];
    }
}
```

## 实战代码：构建 MCP 服务器

### 1. 基础架构设计

```php
// app/MCP/MCPServer.php
namespace App\MCP;

class MCPServer
{
    private array $resources = [];
    private array $tools = [];
    private array $prompts = [];
    
    public function registerResource(string $name, callable $handler): void
    {
        $this->resources[$name] = $handler;
    }
    
    public function registerTool(string $name, callable $handler): void
    {
        $this->tools[$name] = $handler;
    }
    
    public function registerPrompt(string $name, callable $handler): void
    {
        $this->prompts[$name] = $handler;
    }
    
    public function listResources(): array
    {
        $result = [];
        foreach ($this->resources as $name => $handler) {
            $info = $handler([]);
            $result[] = [
                'name' => $name,
                'uri' => $info['uri'] ?? '',
                'description' => $info['description'] ?? '',
            ];
        }
        return $result;
    }
    
    public function listTools(): array
    {
        $result = [];
        foreach ($this->tools as $name => $handler) {
            $result[] = [
                'name' => $name,
                'description' => $handler['description'] ?? '',
            ];
        }
        return $result;
    }
    
    public function listPrompts(): array
    {
        $result = [];
        foreach ($this->prompts as $name => $handler) {
            $result[] = [
                'name' => $name,
                'description' => $handler['description'] ?? '',
            ];
        }
        return $result;
    }
    
    public function callTool(string $name, array $params): array
    {
        if (!isset($this->tools[$name])) {
            throw new \InvalidArgumentException("Tool {$name} not found");
        }
        
        return $this->tools[$name]($params);
    }
    
    public function callPrompt(string $name, array $params): array
    {
        if (!isset($this->prompts[$name])) {
            throw new \InvalidArgumentException("Prompt {$name} not found");
        }
        
        return $this->prompts[$name]($params);
    }
}
```

### 2. 实际业务场景选型

**场景 1：获取订单详情**

应该使用 **Resource**，因为：
- 只读操作
- 幂等
- 提供上下文信息

```php
// ✅ 正确：使用 Resource
$server->registerResource('order_detail', function (array $params) {
    $orderId = $params['orderId'];
    $order = Order::find($orderId);
    
    return [
        'uri' => "order://{$orderId}",
        'name' => '订单详情',
        'description' => "获取订单 {$order->order_no} 的详细信息",
        'content' => [
            'id' => $order->id,
            'order_no' => $order->order_no,
            'status' => $order->status,
            'total' => $order->total,
            'items' => $order->items,
        ],
    ];
});
```

**场景 2：更新订单状态**

应该使用 **Tool**，因为：
- 有副作用（修改数据）
- 非幂等（多次调用可能产生不同结果）
- 需要执行具体操作

```php
// ✅ 正确：使用 Tool
$server->registerTool('update_order_status', [
    'description' => '更新订单状态',
    'handler' => function (array $params) {
        $orderId = $params['orderId'];
        $status = $params['status'];
        
        $order = Order::find($orderId);
        $order->status = $status;
        $order->save();
        
        // 记录状态变更日志
        OrderLog::create([
            'order_id' => $orderId,
            'action' => 'status_change',
            'from' => $order->getOriginal('status'),
            'to' => $status,
        ]);
        
        return [
            'success' => true,
            'message' => "订单状态已更新为 {$status}",
        ];
    },
]);
```

**场景 3：生成订单报告**

应该使用 **Prompt**，因为：
- 需要标准化的报告生成流程
- 可以组合多个 Resources
- 引导 LLM 按特定格式输出

```php
// ✅ 正确：使用 Prompt
$server->registerPrompt('order_report', [
    'description' => '生成订单分析报告',
    'handler' => function (array $params) {
        $startDate = $params['startDate'];
        $endDate = $params['endDate'];
        
        return [
            'name' => '订单报告生成',
            'description' => '分析指定时间段的订单数据并生成报告',
            'arguments' => [
                ['name' => 'startDate', 'description' => '开始日期', 'required' => true],
                ['name' => 'endDate', 'description' => '结束日期', 'required' => true],
            ],
            'messages' => [
                [
                    'role' => 'user',
                    'content' => [
                        'type' => 'text',
                        'text' => "请分析 {$startDate} 至 {$endDate} 的订单数据，生成包含以下内容的报告：\n1. 订单总量与趋势\n2. 销售额分析\n3. 热门商品排行\n4. 异常订单识别\n5. 优化建议",
                    ],
                ],
            ],
            'resources' => [
                ['name' => 'order_stats', 'params' => ['startDate' => $startDate, 'endDate' => $endDate]],
                ['name' => 'product_ranking', 'params' => ['startDate' => $startDate, 'endDate' => $endDate]],
            ],
        ];
    },
]);
```

### 3. 选型决策树

```
开始
  │
  ├─ 是只读操作吗？
  │   ├─ 是 → Resource
  │   └─ 否 ↓
  │
  ├─ 需要执行具体业务逻辑吗？
  │   ├─ 是 → Tool
  │   └─ 否 ↓
  │
  ├─ 需要标准化交互流程吗？
  │   ├─ 是 → Prompt
  │   └─ 否 → 重新评估需求
```

## 踩坑记录

### 1. 误用 Tool 做只读操作

```php
// ❌ 错误：把只读操作设计为 Tool
$server->registerTool('get_user', [
    'description' => '获取用户信息',
    'handler' => function (array $params) {
        $user = User::find($params['userId']);
        return ['data' => $user];
    },
]);

// ✅ 正确：使用 Resource
$server->registerResource('user_info', function (array $params) {
    $user = User::find($params['userId']);
    return [
        'uri' => "user://{$params['userId']}",
        'content' => $user->toArray(),
    ];
});
```

### 2. Resource 产生副作用

```php
// ❌ 错误：Resource 中执行了写操作
$server->registerResource('create_order', function (array $params) {
    // Resource 不应该创建数据！
    $order = Order::create($params);
    return [
        'uri' => "order://{$order->id}",
        'content' => $order->toArray(),
    ];
});

// ✅ 正确：使用 Tool
$server->registerTool('create_order', [
    'description' => '创建新订单',
    'handler' => function (array $params) {
        $order = Order::create($params);
        return ['success' => true, 'order_id' => $order->id];
    },
]);
```

### 3. Prompt 缺少必要参数验证

```php
// ❌ 错误：不验证参数
$server->registerPrompt('code_review', [
    'handler' => function (array $params) {
        // 直接使用，不验证必填参数
        return ['messages' => [...]];
    },
]);

// ✅ 正确：验证参数
$server->registerPrompt('code_review', [
    'arguments' => [
        ['name' => 'code', 'description' => '代码内容', 'required' => true],
        ['name' => 'language', 'description' => '编程语言', 'required' => true],
    ],
    'handler' => function (array $params) {
        // 验证必填参数
        if (empty($params['code']) || empty($params['language'])) {
            throw new \InvalidArgumentException('缺少必要参数');
        }
        
        return ['messages' => [...]];
    },
]);
```

### 4. 资源 URI 格式不规范

```php
// ❌ 错误：URI 格式混乱
$server->registerResource('user', function (array $params) {
    return [
        'uri' => '/api/users/' . $params['id'],  // HTTP 风格
        'content' => [...],
    ];
});

// ✅ 正确：使用标准 URI 格式
$server->registerResource('user', function (array $params) {
    return [
        'uri' => "user://{$params['id']}",  // 自定义协议
        'content' => [...],
    ];
});
```

### 5. 并发调用时的状态管理

```php
// ❌ 错误：Resource 依赖外部状态
$server->registerResource('counter', function (array $params) {
    $count = Cache::increment('api_calls');
    return ['count' => $count];
});

// ✅ 正确：Resource 应该幂等
$server->registerResource('system_status', function (array $params) {
    return [
        'uri' => 'system://status',
        'content' => [
            'uptime' => $this->getUptime(),
            'memory' => $this->getMemoryUsage(),
            'cpu' => $this->getCpuUsage(),
        ],
    ];
});
```

## 总结

### 选型对照表

| 原语 | 特征 | 适用场景 | 示例 |
|-----|------|---------|------|
| **Resource** | 只读、幂等 | 数据查询、配置获取 | 用户信息、订单详情、系统状态 |
| **Tool** | 有副作用、非幂等 | 业务操作、数据修改 | 发送邮件、更新订单、创建记录 |
| **Prompt** | 模板化、可组合 | 标准化流程、复杂交互 | 代码审查、报告生成、数据分析 |

### 决策原则

1. **优先 Resource**：如果只是读取数据，用 Resource
2. **Tool 用于操作**：需要执行具体逻辑时，用 Tool
3. **Prompt 用于流程**：需要标准化交互时，用 Prompt
4. **保持职责单一**：每个原语只做一件事
5. **验证参数**：所有原语都应该验证输入参数

### 下一步行动

1. 审查现有 MCP 实现，识别误用的原语
2. 重构不合理的工具设计
3. 为复杂交互场景创建 Prompt 模板
4. 建立原语使用的代码审查规范
