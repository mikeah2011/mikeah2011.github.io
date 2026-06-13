---
title: 'AI Agent Structured Output 深度实战：JSON Schema 强制、Pydantic/Zod 校验与 Laravel Response DTO 的端到端类型安全'
date: 2026-06-06 10:00:00
description: "深入实战 AI Agent Structured Output 全链路方案：从 OpenAI/Anthropic JSON Schema 约束解码，到 Pydantic/Zod 运行时校验，再到 Laravel Response DTO 端到端类型安全。涵盖 Schema 设计、踩坑案例（token 溢出、嵌套校验、nullable 处理）、方案对比与完整代码示例，助你将 AI Agent 从实验推向生产级。"
tags: [AI, LLM, Structured Output, JSON Schema, Laravel, Pydantic, Zod]
keywords: [AI Agent Structured Output, JSON Schema, Pydantic, Zod, Laravel Response DTO, 深度实战, 强制, 校验与, 的端到端类型安全, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


## 引言：为什么你的 AI Agent 总在"自由发挥"？

在构建 AI Agent 系统时，我们经常遇到一个令人头疼的问题：大语言模型（LLM）返回的文本格式千变万化。你期望一个标准的 JSON 响应，它却给你一段自然语言描述；你要求返回一个数组，它却嵌套了三层对象。这种"自由发挥"在聊天场景下或许无伤大雅，但在生产系统中，结构化的数据流是管道（pipeline）正常运转的血液。

本文将从实战角度出发，深入探讨如何在整个技术栈中实现端到端的类型安全：

- **前端**使用 Zod（TypeScript）定义并校验 Schema
- **API 层**使用 Laravel Response DTO 统一输出格式
- **LLM 调用层**使用 OpenAI/Anthropic 的 Structured Output API 强制模型返回符合 Schema 的 JSON
- **后端校验**使用 Pydantic（Python）或 Laravel 自身的验证机制确保数据完整性

无论你是正在构建 RAG 系统、自动化工作流，还是复杂的多 Agent 协作平台，掌握 Structured Output 都是将 AI 从"玩具"推向"生产级"的关键一步。

---

## 一、Structured Output 概念与动机

### 1.1 什么是 Structured Output？

Structured Output 是指 LLM 在生成响应时，输出必须严格符合预定义的数据结构（通常是 JSON Schema）。与传统的自由文本生成不同，Structured Output 通过约束解码（Constrained Decoding）技术，在 Token 生成的每一步都限制模型只能选择符合 Schema 定义的 Token。

这不仅仅是"请返回 JSON"的 Prompt 工程技巧——而是在模型推理层面的硬性约束。

### 1.2 为什么需要 Structured Output？

| 痛点 | 传统方案 | Structured Output |
|------|---------|-------------------|
| 输出格式不稳定 | 正则表达式提取 + 多次重试 | 100% 符合 Schema |
| 类型不安全 | 手动类型转换 + 防御性编程 | 编译期类型保障 |
| 错误处理复杂 | 解析失败后 fallback 逻辑冗长 | 前置校验，问题在 LLM 端解决 |
| 多语言协作困难 | 每种语言各自定义接口 | JSON Schema 作为跨语言契约 |

### 1.3 典型应用场景

1. **表单数据提取**：从用户自然语言中提取结构化表单字段
2. **分类与标签**：将自由文本映射到枚举类型
3. **函数调用参数**：Agent 调用工具时的参数序列化
4. **RAG 答案返回**：带引用来源的结构化答案
5. **多步推理链**：Chain-of-Thought 的中间步骤存储

---

## 二、JSON Schema 规范详解

JSON Schema 是 Structured Output 的基石。理解它的工作原理对于正确使用各厂商 API 至关重要。

### 2.1 核心概念

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "产品名称"
    },
    "price": {
      "type": "number",
      "minimum": 0
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1
    },
    "status": {
      "type": "string",
      "enum": ["draft", "published", "archived"]
    }
  },
  "required": ["name", "price", "status"],
  "additionalProperties": false
}
```

### 2.2 LLM API 中的 Schema 限制

需要注意的是，不同 LLM 提供商对 JSON Schema 的支持程度不同：

- **OpenAI**：支持 `strict: true` 模式，要求 Schema 必须设置 `additionalProperties: false`，且所有属性必须列在 `required` 中。不支持 `oneOf`/`anyOf` 等组合关键字（截至 2026 年初，已逐步放宽）。
- **Anthropic**：通过 Tool Use 机制间接支持结构化输出，Schema 灵活度更高，但不保证严格解码约束。
- **Google Gemini**：支持 `responseMimeType: "application/json"` 配合 `responseSchema`。

### 2.3 设计最佳实践

1. **保持 Schema 扁平化**：深层嵌套会增加约束解码的复杂度，降低输出质量
2. **使用 `enum` 代替自由文本**：对于已知选项，枚举类型几乎不会出错
3. **添加 `description`**：每个字段的描述会作为语义提示帮助模型理解意图
4. **避免过于宽泛的 Schema**：`type: "object"` 不加约束等于没约束

---

## 三、OpenAI Structured Output API 实战

### 3.1 基础用法

```python
from openai import OpenAI
from pydantic import BaseModel

client = OpenAI()

class ProductAnalysis(BaseModel):
    name: str
    category: str
    sentiment: str  # "positive" | "negative" | "neutral"
    confidence: float
    key_points: list[str]

completion = client.beta.chat.completions.parse(
    model="gpt-4o-2024-08-06",
    messages=[
        {"role": "system", "content": "分析以下产品评论，提取结构化信息。"},
        {"role": "user", "content": "这款蓝牙耳机音质不错，但续航有点短，总体来说性价比很高。"}
    ],
    response_format=ProductAnalysis,
)

result = completion.choices[0].message.parsed
print(result.name)       # "蓝牙耳机"
print(result.sentiment)  # "positive"
print(result.confidence) # 0.85
```

### 3.2 使用 JSON Schema 直接传入

当你不想定义 Pydantic 模型时，可以直接传入 JSON Schema：

```python
schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "category": {"type": "string"},
        "sentiment": {"type": "string", "enum": ["positive", "negative", "neutral"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "key_points": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 5
        }
    },
    "required": ["name", "category", "sentiment", "confidence", "key_points"],
    "additionalProperties": False
}

completion = client.beta.chat.completions.parse(
    model="gpt-4o-2024-08-06",
    messages=[
        {"role": "system", "content": "分析产品评论。"},
        {"role": "user", "content": "这款蓝牙耳机音质不错，但续航有点短。"}
    ],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "product_analysis",
            "strict": True,
            "schema": schema
        }
    }
)
```

### 3.3 Anthropic Tool Use 模拟 Structured Output

Anthropic 没有原生的 `response_format` 参数，但可以通过 Tool Use 机制实现类似效果：

```python
import anthropic
from pydantic import BaseModel, TypeAdapter

client = anthropic.Anthropic()

tools = [{
    "name": "output_product_analysis",
    "description": "输出产品评论分析结果",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "产品名称"},
            "category": {"type": "string", "description": "产品分类"},
            "sentiment": {
                "type": "string",
                "enum": ["positive", "negative", "neutral"],
                "description": "情感倾向"
            },
            "confidence": {
                "type": "number",
                "description": "置信度 0-1"
            },
            "key_points": {
                "type": "array",
                "items": {"type": "string"},
                "description": "关键要点"
            }
        },
        "required": ["name", "category", "sentiment", "confidence", "key_points"]
    }
}]

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    tools=tools,
    tool_choice={"type": "tool", "name": "output_product_analysis"},
    messages=[
        {"role": "user", "content": "分析：这款蓝牙耳机音质不错，但续航有点短。"}
    ]
)

# 从 tool_use block 中提取结果
tool_input = response.content[0].input
print(tool_input["name"])       # "蓝牙耳机"
print(tool_input["sentiment"])  # "positive"
```

---

## 四、Pydantic Schema 定义与校验实践

Pydantic 是 Python 生态中最成熟的 Schema 定义库，也是连接 LLM 输出与业务逻辑的桥梁。

### 4.1 复杂嵌套 Schema

```python
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
from enum import Enum

class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class Assignee(BaseModel):
    id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$')
    role: str

class Comment(BaseModel):
    author: str
    content: str = Field(min_length=1)
    created_at: datetime

class Task(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str
    priority: Priority
    assignee: Optional[Assignee] = None
    tags: list[str] = Field(default_factory=list, max_length=10)
    estimated_hours: float = Field(gt=0, le=1000)
    comments: list[Comment] = Field(default_factory=list)

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        return [tag.strip().lower() for tag in v if tag.strip()]

# 使用示例：LLM 输出经过 Pydantic 校验
raw_llm_output = {
    "title": "实现用户认证模块",
    "description": "使用 JWT + Refresh Token 实现双 Token 认证",
    "priority": "high",
    "assignee": {
        "id": 42,
        "name": "张三",
        "email": "zhangsan@example.com",
        "role": "后端工程师"
    },
    "tags": [" Auth ", "JWT", "Security"],
    "estimated_hours": 16.5,
    "comments": [
        {
            "author": "李四",
            "content": "建议同时实现 Rate Limiting",
            "created_at": "2026-06-06T10:30:00"
        }
    ]
}

task = Task.model_validate(raw_llm_output)
print(task.tags)  # ['auth', 'jwt', 'security']
```

### 4.2 与 OpenAI SDK 深度集成

Pydantic 模型可以直接作为 OpenAI 的 `response_format`，SDK 会自动将其转换为 JSON Schema：

```python
class MovieReview(BaseModel):
    """电影评论结构化分析"""
    title: str = Field(description="电影名称")
    year: int = Field(description="上映年份", ge=1888, le=2030)
    rating: float = Field(description="评分 1-10", ge=1, le=10)
    genres: list[str] = Field(description="类型标签", min_length=1)
    summary: str = Field(description="一句话总结", max_length=200)
    recommended: bool = Field(description="是否推荐")

    @field_validator('genres')
    @classmethod
    def normalize_genres(cls, v):
        valid_genres = {
            "动作", "喜剧", "剧情", "科幻", "恐怖",
            "爱情", "动画", "纪录片", "悬疑", "奇幻"
        }
        result = [g for g in v if g in valid_genres]
        if not result:
            raise ValueError(f"至少需要一个有效类型，可选: {valid_genres}")
        return result

# 调用
completion = client.beta.chat.completions.parse(
    model="gpt-4o-2024-08-06",
    messages=[
        {"role": "user", "content": "分析电影：星际穿越"}
    ],
    response_format=MovieReview,
)

review = completion.choices[0].message.parsed
# review.rating 一定是 1-10 之间的浮点数
# review.genres 一定是已知类型列表
```

---

## 五、TypeScript / Zod Schema 定义实践

在前端和 Node.js 后端，Zod 是定义 Schema 的首选工具。它的类型推导能力让 TypeScript 的类型安全真正贯穿从 API 响应到 UI 组件的每一个环节。

### 5.1 定义共享 Schema

```typescript
import { z } from "zod";

// === schemas/product-analysis.ts ===

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const AssigneeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.string(),
});
export type Assignee = z.infer<typeof AssigneeSchema>;

export const TaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string(),
  priority: PrioritySchema,
  assignee: AssigneeSchema.nullable().optional(),
  tags: z.array(z.string()).max(10).default([]),
  estimatedHours: z.number().positive().max(1000),
  comments: z.array(z.object({
    author: z.string(),
    content: z.string().min(1),
    createdAt: z.string().datetime(),
  })).default([]),
});
export type Task = z.infer<typeof TaskSchema>;
```

### 5.2 API 响应校验

```typescript
// === api/tasks.ts ===

import { TaskSchema, type Task } from "../schemas/product-analysis";

async function fetchTask(taskId: number): Promise<Task> {
  const response = await fetch(`/api/tasks/${taskId}`);
  const json = await response.json();

  // Zod 校验 + 类型收窄
  const result = TaskSchema.safeParse(json);

  if (!result.success) {
    console.error("Schema validation failed:", result.error.flatten());
    throw new Error(`Invalid task data: ${result.error.message}`);
  }

  // result.data 的类型自动推导为 Task
  return result.data;
}

// 使用
const task = await fetchTask(123);
console.log(task.priority);    // 类型安全，IDE 自动补全
console.log(task.estimatedHours);
```

### 5.3 Zod → JSON Schema 转换

当你需要将前端定义的 Schema 发送给后端或 LLM API 时：

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";

const jsonSchema = zodToJsonSchema(TaskSchema, {
  target: "openApi3",  // 兼容 OpenAPI 3.0
  $refStrategy: "none",
});

console.log(JSON.stringify(jsonSchema, null, 2));
// 生成标准 JSON Schema，可直接用于 OpenAI structured output
```

### 5.4 React Hook Form 集成

Zod Schema 可以直接驱动表单验证：

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

function TaskForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(TaskSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("title")} />
      {errors.title && <span>{errors.title.message}</span>}
      {/* ... */}
    </form>
  );
}
```

---

## 六、Laravel Response DTO 模式

在 Laravel 后端，我们需要一种优雅的方式将 LLM 返回的结构化数据转换为 API 响应。Data Transfer Object（DTO）模式是最佳实践。

### 6.1 使用 spatie/laravel-data

`spatie/laravel-data` 是 Laravel 生态中最流行的 DTO 库，它支持类型转换、验证、序列化等开箱即用的功能。

**安装：**

```bash
composer require spatie/laravel-data
```

**定义 DTO：**

```php
<?php
// app/Data/TaskData.php

namespace App\Data;

use Spatie\LaravelData\Data;
use Spatie\LaravelData\Attributes\WithCast;
use Spatie\LaravelData\Casts\EnumCast;
use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Attributes\Validation\Required;

enum Priority: string
{
    case Low = 'low';
    case Medium = 'medium';
    case High = 'high';
    case Critical = 'critical';
}

class AssigneeData extends Data
{
    public function __construct(
        #[Required]
        public int $id,
        #[Required, Min(1), Max(100)]
        public string $name,
        #[Required]
        public string $email,
        #[Required]
        public string $role,
    ) {}
}

class CommentData extends Data
{
    public function __construct(
        public string $author,
        public string $content,
        public string $created_at,
    ) {}
}

class TaskData extends Data
{
    public function __construct(
        #[Required, Min(1), Max(200)]
        public string $title,
        #[Required]
        public string $description,
        #[Required, WithCast(EnumCast::class, Priority::class)]
        public Priority $priority,
        public ?AssigneeData $assignee = null,
        /** @var string[] */
        public array $tags = [],
        #[Required]
        public float $estimated_hours,
        /** @var CommentData[] */
        public array $comments = [],
    ) {}

    /**
     * 从 LLM 的原始 JSON 响应创建 DTO
     */
    public static function fromLlmResponse(string $json): self
    {
        $data = json_decode($json, true);
        return self::from($data);
    }

    /**
     * 转换为 API 响应格式（snake_case）
     */
    public function toApiResponse(): array
    {
        return [
            'success' => true,
            'data' => $this->toArray(),
            'meta' => [
                'source' => 'llm_structured_output',
                'validated_at' => now()->toISOString(),
            ],
        ];
    }
}
```

### 6.2 在 Service 中集成 LLM 调用

```php
<?php
// app/Services/TaskAnalysisService.php

namespace App\Services;

use App\Data\TaskData;
use App\Data\LLMResponseData;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TaskAnalysisService
{
    private string $apiKey;
    private string $model;

    public function __construct()
    {
        $this->apiKey = config('services.openai.key');
        $this->model = config('services.openai.model', 'gpt-4o-2024-08-06');
    }

    /**
     * 从自然语言描述中提取任务结构化信息
     */
    public function analyzeTask(string $userInput): TaskData
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->post('https://api.openai.com/v1/chat/completions', [
            'model' => $this->model,
            'messages' => [
                [
                    'role' => 'system',
                    'content' => $this->getSystemPrompt(),
                ],
                [
                    'role' => 'user',
                    'content' => $userInput,
                ],
            ],
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'task_analysis',
                    'strict' => true,
                    'schema' => $this->getJsonSchema(),
                ],
            ],
            'temperature' => 0.1,
        ]);

        if ($response->failed()) {
            Log::error('LLM API call failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException('LLM 服务不可用，请稍后重试');
        }

        $content = $response->json('choices.0.message.content');

        try {
            return TaskData::fromLlmResponse($content);
        } catch (\Throwable $e) {
            Log::error('Failed to parse LLM response into TaskData', [
                'content' => $content,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('LLM 返回数据格式异常');
        }
    }

    private function getSystemPrompt(): string
    {
        return <<<'PROMPT'
你是一个任务分析助手。请从用户的自然语言描述中提取任务信息。
- 优先级根据关键词判断：紧急/阻塞 = critical，重要/尽快 = high，日常 = medium，不急 = low
- 预估工时基于任务复杂度合理估算
- tags 应该是简洁的技术标签
- 如果没有明确提到负责人，assignee 设为 null
PROMPT;
    }

    private function getJsonSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'title' => [
                    'type' => 'string',
                    'description' => '任务标题，简洁描述任务内容',
                    'minLength' => 1,
                    'maxLength' => 200,
                ],
                'description' => [
                    'type' => 'string',
                    'description' => '任务详细描述',
                ],
                'priority' => [
                    'type' => 'string',
                    'enum' => ['low', 'medium', 'high', 'critical'],
                    'description' => '优先级',
                ],
                'assignee' => [
                    'type' => ['object', 'null'],
                    'properties' => [
                        'id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'email' => ['type' => 'string'],
                        'role' => ['type' => 'string'],
                    ],
                    'required' => ['id', 'name', 'email', 'role'],
                    'additionalProperties' => false,
                ],
                'tags' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'maxItems' => 10,
                    'description' => '技术标签',
                ],
                'estimated_hours' => [
                    'type' => 'number',
                    'minimum' => 0.5,
                    'maximum' => 1000,
                    'description' => '预估工时（小时）',
                ],
                'comments' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'author' => ['type' => 'string'],
                            'content' => ['type' => 'string'],
                            'created_at' => ['type' => 'string'],
                        ],
                        'required' => ['author', 'content', 'created_at'],
                    ],
                ],
            ],
            'required' => ['title', 'description', 'priority', 'estimated_hours', 'tags', 'comments'],
            'additionalProperties' => false,
        ];
    }
}
```

### 6.3 Controller 与路由

```php
<?php
// app/Http/Controllers/TaskAnalysisController.php

namespace App\Http\Controllers;

use App\Services\TaskAnalysisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class TaskAnalysisController extends Controller
{
    public function __construct(
        private TaskAnalysisService $service
    ) {}

    /**
     * POST /api/tasks/analyze
     */
    public function analyze(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'input' => 'required|string|min:5|max:2000',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'error' => '参数校验失败',
                'details' => $validator->errors(),
            ], 422);
        }

        try {
            $taskData = $this->service->analyzeTask($request->input('input'));

            return response()->json($taskData->toApiResponse(), 200);
        } catch (\RuntimeException $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 503);
        }
    }
}
```

```php
// routes/api.php
Route::post('/tasks/analyze', [TaskAnalysisController::class, 'analyze']);
```

### 6.4 不使用 spatie 包的纯手写 DTO

如果你不想引入第三方包，也可以用简单的 PHP 类实现 DTO：

```php
<?php

namespace App\Data;

use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Contracts\Support\Jsonable;

class TaskDTO implements Arrayable, Jsonable
{
    public function __construct(
        public readonly string $title,
        public readonly string $description,
        public readonly string $priority,
        public readonly ?array $assignee,
        public readonly array $tags,
        public readonly float $estimatedHours,
        public readonly array $comments,
    ) {}

    public static function fromArray(array $data): self
    {
        // 手动验证
        if (empty($data['title'])) {
            throw new \InvalidArgumentException('title is required');
        }
        if (!in_array($data['priority'] ?? '', ['low', 'medium', 'high', 'critical'], true)) {
            throw new \InvalidArgumentException("Invalid priority: {$data['priority']}");
        }

        return new self(
            title: $data['title'],
            description: $data['description'] ?? '',
            priority: $data['priority'],
            assignee: $data['assignee'] ?? null,
            tags: array_map('strtolower', $data['tags'] ?? []),
            estimatedHours: (float) ($data['estimated_hours'] ?? 0),
            comments: $data['comments'] ?? [],
        );
    }

    public function toArray(): array
    {
        return [
            'title' => $this->title,
            'description' => $this->description,
            'priority' => $this->priority,
            'assignee' => $this->assignee,
            'tags' => $this->tags,
            'estimated_hours' => $this->estimatedHours,
            'comments' => $this->comments,
        ];
    }

    public function toJson($options = 0): string
    {
        return json_encode($this->toArray(), $options | JSON_UNESCAPED_UNICODE);
    }
}
```

---

## 七、端到端类型安全链路

现在，让我们将所有组件串联起来，展示一个完整的类型安全数据流。

### 7.1 架构总览

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  前端 (Zod) │────▶│ Laravel API  │────▶│   LLM API    │────▶│ 校验 & 响应 │
│  Schema 定义 │     │  接收请求     │     │ Structured   │     │ DTO → JSON  │
│  响应校验    │◀────│  返回 DTO     │◀────│ Output       │◀────│ Pydantic    │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
     Zod Schema    →  Laravel Request   →  JSON Schema      →  Pydantic/Laravel
     类型推导         Validation           约束解码              DTO 转换
```

### 7.2 统一 Schema 管理

在实际项目中，建议将 Schema 作为单一数据源（Single Source of Truth），生成各语言的类型定义：

**Schema 源文件（JSON Schema）：**

```json
// schemas/task-analysis.json
{
  "$id": "https://your-app.com/schemas/task-analysis",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TaskAnalysis",
  "type": "object",
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
    "description": { "type": "string" },
    "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
    "estimated_hours": { "type": "number", "minimum": 0.5, "maximum": 1000 },
    "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 10 }
  },
  "required": ["title", "description", "priority", "estimated_hours", "tags"]
}
```

**生成 TypeScript 类型（使用 json-schema-to-typescript）：**

```bash
npx json-schema-to-typescript schemas/task-analysis.json > types/task-analysis.ts
```

**生成 Python Pydantic 模型（使用 datamodel-code-generator）：**

```bash
pip install datamodel-code-generator
datamodel-codegen --input schemas/task-analysis.json --output models/task_analysis.py --output-model-type pydantic_v2.BaseModel
```

### 7.3 前端完整校验流程

```typescript
// === api/task-client.ts ===
import { z } from "zod";

// 与后端 DTO 对齐的响应 Schema
const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    title: z.string().min(1).max(200),
    description: z.string(),
    priority: z.enum(["low", "medium", "high", "critical"]),
    assignee: z.object({
      id: z.number().int().positive(),
      name: z.string(),
      email: z.string().email(),
      role: z.string(),
    }).nullable(),
    tags: z.array(z.string()),
    estimated_hours: z.number().positive(),
    comments: z.array(z.object({
      author: z.string(),
      content: z.string(),
      created_at: z.string(),
    })),
  }),
  meta: z.object({
    source: z.string(),
    validated_at: z.string().datetime(),
  }),
});

type ApiResponse = z.infer<typeof ApiResponseSchema>;

export async function analyzeTask(input: string): Promise<ApiResponse> {
  const response = await fetch("/api/tasks/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });

  const json = await response.json();
  const result = ApiResponseSchema.safeParse(json);

  if (!result.success) {
    console.error("Response schema mismatch:", result.error.flatten());
    throw new Error("Server returned unexpected data format");
  }

  // result.data 完全类型安全
  const task = result.data.data;
  console.log(`${task.title} [${task.priority}] - ${task.estimated_hours}h`);
  task.tags.forEach(tag => console.log(`  #${tag}`));

  return result.data;
}
```

---

## 八、错误处理与 Fallback 策略

Structured Output 并非万无一失。网络超时、模型降级、Schema 过于复杂都可能导致失败。一个健壮的系统需要多层防御。

### 8.1 LLM 输出校验失败的重试策略

```php
<?php
// app/Services/ResilientLLMService.php

namespace App\Services;

use App\Data\TaskData;
use Illuminate\Support\Facades\Log;

class ResilientLLMService
{
    private int $maxRetries = 3;

    public function analyzeWithRetry(string $input): TaskData
    {
        $lastException = null;

        for ($attempt = 1; $attempt <= $this->maxRetries; $attempt++) {
            try {
                $task = $this->analyzeTask($input);

                // 业务层校验（超出 Schema 范围的规则）
                $this->validateBusinessRules($task);

                return $task;
            } catch (\Throwable $e) {
                $lastException = $e;
                Log::warning("LLM attempt {$attempt} failed", [
                    'error' => $e->getMessage(),
                    'input' => mb_substr($input, 0, 100),
                ]);

                // 指数退避
                if ($attempt < $this->maxRetries) {
                    usleep(pow(2, $attempt) * 100_000);
                }
            }
        }

        // 所有重试都失败，返回 fallback
        Log::error('All LLM attempts exhausted, returning fallback');
        return $this->getFallbackTask($input);
    }

    private function validateBusinessRules(TaskData $task): void
    {
        // Schema 无法表达的业务规则
        if ($task->priority === Priority::Critical && $task->estimated_hours > 40) {
            throw new \DomainException(
                'Critical 任务预估不应超过 40 小时，请拆分'
            );
        }
    }

    private function getFallbackTask(string $input): TaskData
    {
        // 返回一个安全的默认值，由人工审核
        return new TaskData(
            title: '[待人工确认] ' . mb_substr($input, 0, 50),
            description: $input,
            priority: Priority::Medium,
            assignee: null,
            tags: ['needs-review'],
            estimated_hours: 4.0,
            comments: [],
        );
    }
}
```

### 8.2 前端 Fallback UI

```typescript
// === components/TaskAnalysisResult.tsx ===

function TaskAnalysisResult({ input }: { input: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["taskAnalysis", input],
    queryFn: () => analyzeTask(input),
    retry: 2,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;

  if (error) {
    return (
      <Alert variant="warning">
        <AlertTitle>分析失败</AlertTitle>
        <AlertDescription>
          AI 暂时无法处理您的请求，请手动填写任务信息。
          <Button onClick={navigateToManualForm}>手动创建</Button>
        </AlertDescription>
      </Alert>
    );
  }

  // data 已经通过 Zod 校验，完全类型安全
  return <TaskCard task={data.data} />;
}
```

### 8.3 Schema 降级策略

当 Schema 过于复杂导致 LLM 输出质量下降时，可以采用分步提取策略：

```python
# 复杂 Schema 拆分为多步调用
async def analyze_task_complex(user_input: str) -> FullTaskAnalysis:
    """分两步提取，降低单次 Schema 复杂度"""

    # Step 1: 基础信息
    basic = await llm_call(
        messages=[...],
        response_format=BasicTaskSchema,
    )

    # Step 2: 基于基础信息提取详细分析
    detail = await llm_call(
        messages=[
            {"role": "system", "content": f"基于以下任务信息进行详细分析：{basic.json()}"},
            {"role": "user", "content": user_input},
        ],
        response_format=TaskDetailSchema,
    )

    return FullTaskAnalysis.merge(basic, detail)
```

---

## 九、性能考量

### 9.1 Schema 复杂度对延迟的影响

| Schema 规模 | 预估额外延迟 | 建议 |
|------------|-------------|------|
| < 10 个字段 | +100-300ms | 直接使用 |
| 10-30 个字段 | +300-800ms | 可接受，注意监控 |
| 30-50 个字段 | +800ms-2s | 考虑拆分 |
| > 50 个字段 | > 2s | 必须拆分或简化 |

### 9.2 `strict` 模式的权衡

OpenAI 的 `strict: true` 模式保证输出 100% 符合 Schema，但代价是：

1. **首次请求延迟增加**：需要预处理 Schema
2. **不支持所有 JSON Schema 特性**：如 `oneOf`/`anyOf`（正在逐步放开）
3. **模型选择受限**：只有特定模型版本支持

建议在开发和测试阶段使用 `strict: true`，在对延迟敏感的生产场景中评估是否可以降级为 `strict: false` + 后端校验。

### 9.3 缓存策略

```php
<?php
// 对相同输入的 LLM 结果进行缓存

class CachedTaskAnalysisService
{
    public function analyzeTask(string $input): TaskData
    {
        $cacheKey = 'task_analysis:' . md5($input);

        return Cache::remember($cacheKey, now()->addHours(24), function () use ($input) {
            return $this->llmService->analyzeWithRetry($input);
        });
    }
}
```

### 9.4 并发场景下的批量处理

```python
import asyncio
from openai import AsyncOpenAI

async def batch_analyze(inputs: list[str]) -> list[TaskAnalysis]:
    """并发调用 LLM，受 semaphore 限制并发数"""
    client = AsyncOpenAI()
    semaphore = asyncio.Semaphore(10)  # 最多 10 个并发

    async def analyze_one(text: str) -> TaskAnalysis:
        async with semaphore:
            result = await client.beta.chat.completions.parse(
                model="gpt-4o-2024-08-06",
                messages=[{"role": "user", "content": text}],
                response_format=TaskAnalysis,
            )
            return result.choices[0].message.parsed

    tasks = [analyze_one(inp) for inp in inputs]
    return await asyncio.gather(*tasks, return_exceptions=False)
```

---

## 十、实际应用场景

### 10.1 智能工单分类系统

一个典型的客服工单自动分类系统，使用 Structured Output 将自由文本工单映射为结构化分类：

```php
<?php

namespace App\Services\TicketClassification;

use App\Data\TicketClassificationData;
use App\Enums\TicketCategory;
use App\Enums\TicketPriority;

class TicketClassifier
{
    public function classify(string $ticketContent): TicketClassificationData
    {
        $response = $this->callLLM(
            systemPrompt: <<<'PROMPT'
            你是一个客服工单分类助手。请对工单进行分类和优先级判断。
            - 技术问题：系统错误、功能异常、性能问题
            - 账户问题：登录、注册、密码、权限
            - 计费问题：付款、退款、发票、套餐
            - 功能建议：新功能需求、改进建议
            PROMPT,
            userMessage: $ticketContent,
            schema: TicketClassificationData::jsonSchema(),
        );

        $classification = TicketClassificationData::fromLlmResponse($response);

        // 自动路由：根据分类结果分发到对应队列
        match ($classification->category) {
            TicketCategory::Technical => dispatch(new HandleTechnicalTicket($classification)),
            TicketCategory::Billing => dispatch(new HandleBillingTicket($classification)),
            TicketCategory::Account => dispatch(new HandleAccountTicket($classification)),
            default => dispatch(new HandleGeneralTicket($classification)),
        };

        return $classification;
    }
}
```

### 10.2 RAG 系统的答案聚合

在 RAG（Retrieval-Augmented Generation）场景中，Structured Output 确保每次返回的答案都带有可追溯的引用来源：

```python
class RAGAnswer(BaseModel):
    """带引用的结构化答案"""
    answer: str = Field(description="基于检索文档的回答")
    confidence: float = Field(ge=0, le=1, description="回答置信度")
    sources: list[Source] = Field(description="引用来源列表", min_length=1)
    follow_up_questions: list[str] = Field(
        description="建议的后续问题",
        max_length=3
    )

class Source(BaseModel):
    document_id: str
    title: str
    relevant_excerpt: str = Field(max_length=500)
    page_number: Optional[int] = None
```

这种结构化的答案格式让前端可以渲染"跳转到原文"的交互，也让 A/B 测试变得更加精确——你可以直接比较不同模型在 `confidence` 和 `sources` 质量上的差异。

---

## 十一、踩坑案例与解决方案

在实际生产中使用 Structured Output，以下几个坑几乎人人都会踩。以下是经过血泪验证的解决方案。

### 11.1 Schema 过于复杂导致 Token 溢出

**问题描述**：当 JSON Schema 包含大量嵌套对象和字段时，OpenAI 的 `strict: true` 模式会在预处理阶段消耗大量 Token，导致 `max_tokens` 不足，输出被截断为不完整 JSON。

```python
# ❌ 错误示例：一个包含 60+ 字段的复杂 Schema
class OverComplexSchema(BaseModel):
    basic_info: BasicInfo
    detailed_analysis: DetailedAnalysis
    recommendations: list[Recommendation]  # 每个 Recommendation 又有 8 个字段
    history: list[HistoryEntry]
    # ... 总计 60+ 个叶子节点

# 调用时出现：Error: maximum context length exceeded
# 或输出被截断，JSON 解析失败
```

**解决方案**：将大 Schema 拆分为多次调用，使用分层提取策略。

```python
# ✅ 正确做法：分两步调用
class BasicTaskInfo(BaseModel):
    """第一步：提取基础信息（字段少，准确率高）"""
    title: str
    priority: str
    category: str

class DetailedAnalysis(BaseModel):
    """第二步：基于基础信息做深度分析"""
    risk_factors: list[str]
    estimated_effort: str
    dependencies: list[str]

async def smart_extract(user_input: str) -> dict:
    # Step 1: 基础提取（Schema 简单，Token 消耗少）
    basic = await client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": user_input}],
        response_format=BasicTaskInfo,
    )
    basic_result = basic.choices[0].message.parsed

    # Step 2: 基于第一步结果做深度分析
    detail = await client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"基于以下任务做深度分析：{basic_result.model_dump_json()}"},
            {"role": "user", "content": user_input},
        ],
        response_format=DetailedAnalysis,
    )

    return {**basic_result.model_dump(), **detail.choices[0].message.parsed.model_dump()}
```

**经验法则**：单次调用的 Schema 叶子节点不超过 30 个，嵌套深度不超过 3 层。

### 11.2 嵌套对象校验失败

**问题描述**：LLM 返回的嵌套对象经常出现类型偏差——期望 `int` 返回 `string`，期望 `array` 返回 `null`，期望嵌套对象返回扁平字符串。

```python
# LLM 常见的"创造性"输出：
# 期望: {"assignee": {"id": 42, "name": "张三", ...}}
# 实际: {"assignee": "张三"}  ← 直接返回了字符串

# 期望: {"tags": ["python", "fastapi"]}
# 实际: {"tags": "python, fastapi"}  ← 返回了逗号分隔的字符串
```

**解决方案**：使用 Pydantic 的 `model_validator` 和自定义类型转换。

```python
from pydantic import BaseModel, model_validator, field_validator
from typing import Any

class FlexibleAssignee(BaseModel):
    id: int
    name: str
    email: str
    role: str

class RobustTask(BaseModel):
    title: str
    assignee: Optional[FlexibleAssignee] = None
    tags: list[str] = []

    @field_validator('tags', mode='before')
    @classmethod
    def normalize_tags(cls, v: Any) -> list[str]:
        """兼容字符串和数组两种输入"""
        if isinstance(v, str):
            return [t.strip() for t in v.split(',') if t.strip()]
        if isinstance(v, list):
            return [str(t).strip() for t in v if t]
        return []

    @model_validator(mode='before')
    @classmethod
    def coerce_assignee(cls, data: dict) -> dict:
        """将字符串形式的 assignee 自动转为 null"""
        assignee = data.get('assignee')
        if isinstance(assignee, str):
            import logging
            logging.warning(f"assignee 应为对象，收到字符串: {assignee}，已忽略")
            data['assignee'] = None
        return data
```

### 11.3 Nullable 字段处理的陷阱

**问题描述**：JSON Schema 中的 nullable 处理在不同 LLM 提供商之间存在显著差异，是跨平台兼容性的重灾区。

```python
# ❌ OpenAI strict 模式下的 nullable 陷阱
# OpenAI 要求使用 "type": ["string", "null"] 形式
# 而非 JSON Schema 标准的 "nullable": true

# 错误写法（OpenAI strict 模式会报错）：
schema_wrong = {
    "type": "object",
    "properties": {
        "middle_name": {
            "type": "string",
            "nullable": True  # ❌ OpenAI 不识别这个字段
        }
    }
}

# 正确写法：
schema_correct = {
    "type": "object",
    "properties": {
        "middle_name": {
            "type": ["string", "null"]  # ✅ 数组形式
        }
    },
    "required": ["middle_name"]  # 即使可空，也必须列入 required
}
```

```python
# Pydantic 中的正确 nullable 定义
from typing import Optional
from pydantic import BaseModel, Field

class UserProfile(BaseModel):
    first_name: str
    middle_name: Optional[str] = None  # 生成 "type": ["string", "null"]
    bio: Optional[str] = Field(default=None, max_length=500)
```

**跨平台兼容建议**：

| 场景 | OpenAI | Anthropic | 建议 |
|------|--------|-----------|------|
| 可空字符串 | `type: ["string", "null"]` | `nullable: true` | 用 Pydantic/Zod 生成，避免手写 |
| 可空对象 | 同上 + `required` 必须包含 | 同上 | 始终在 `required` 中列出 |
| 可空数组 | `type: ["array", "null"]` | 同上 | 考虑用空数组 `[]` 替代 null |
| 嵌套可空 | 限制嵌套层级 | 灵活 | 尽量扁平化设计 |

### 11.4 模型降级时的 Schema 兼容性

**问题描述**：当主力模型（如 GPT-4o）不可用，降级到较弱模型（如 GPT-3.5-turbo）时，Structured Output 可能不被支持或输出质量大幅下降。

**解决方案**：实现自适应 Schema 策略。

```python
class AdaptiveLLMService:
    """根据模型能力自动调整 Schema 复杂度"""

    MODEL_CAPABILITIES = {
        "gpt-4o-2024-08-06": {"strict_output": True, "max_schema_nodes": 50},
        "gpt-4o-mini": {"strict_output": True, "max_schema_nodes": 30},
        "gpt-3.5-turbo": {"strict_output": False, "max_schema_nodes": 15},
    }

    def get_schema_for_model(self, model: str, full_schema: type[BaseModel]) -> dict:
        caps = self.MODEL_CAPABILITIES.get(model, {"strict_output": False, "max_schema_nodes": 10})

        if caps["strict_output"]:
            return full_schema
        else:
            return self._simplify_schema(full_schema, caps["max_schema_nodes"])

    def _simplify_schema(self, model: type, max_nodes: int) -> dict:
        """递归裁剪 Schema，保留最关键的字段"""
        schema = model.model_json_schema()
        return self._prune_schema(schema, max_nodes, depth=0)
```

---

## 十二、方案对比：Structured Output vs Prompt Engineering vs Function Calling

在实现 LLM 结构化输出时，有三种主流方案。下表帮助你根据场景选择最合适的方案：

| 维度 | Prompt Engineering | Structured Output (JSON Mode) | Function Calling |
|------|-------------------|-------------------------------|------------------|
| **实现方式** | 在 prompt 中要求返回 JSON | API 层面的约束解码 | 定义工具 Schema，模型选择调用 |
| **输出保证** | ❌ 不保证，可能返回额外文本 | ✅ 100% 符合 Schema | ✅ 参数符合 Schema |
| **额外文本** | 可能包含"以下是JSON:"等前缀 | 纯 JSON，无多余内容 | 工具参数为 JSON |
| **Token 效率** | 差（需要 few-shot 示例引导） | 好（无需额外提示） | 中等（工具定义占用 Token） |
| **适用场景** | 原型验证、非关键路径 | 所有需要可靠 JSON 输出的场景 | Agent 调用工具、多步推理 |
| **成本** | 低（无额外 API 开销） | 中（首次有 Schema 预处理） | 中（工具定义占上下文） |
| **模型要求** | 任何模型 | 特定模型版本 | 支持 Tool Use 的模型 |
| **嵌套支持** | 差 | 好（但建议限制深度） | 好（但单工具参数有限） |
| **推荐指数** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**选择建议**：

1. **需要 100% 格式可靠** → Structured Output（首选）
2. **Agent 需要调用外部工具** → Function Calling
3. **简单场景 + 快速原型** → Prompt Engineering 足够
4. **复杂 Agent 工作流** → Function Calling + Structured Output 组合使用
5. **跨模型兼容** → Function Calling（支持最广）+ 后端 Pydantic 校验兜底

```python
# 三种方案的实际对比代码

# 方案 A: Prompt Engineering（最不可靠）
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": '请以JSON格式返回产品信息，格式：{"name": "...", "price": 0}\n分析：蓝牙耳机'
    }]
)
# 可能返回: "以下是分析结果：\n```json\n{"name": "蓝牙耳机", "price": 199}\n```"
# 需要正则提取，不安全

# 方案 B: Structured Output（最可靠）
class ProductInfo(BaseModel):
    name: str
    price: float = Field(ge=0)

response = client.beta.chat.completions.parse(
    model="gpt-4o-2024-08-06",
    messages=[{"role": "user", "content": "分析：蓝牙耳机"}],
    response_format=ProductInfo,
)
# 100% 返回合法 JSON，直接 .parsed 拿到 Pydantic 对象

# 方案 C: Function Calling（适合 Agent 场景）
tools = [{
    "type": "function",
    "function": {
        "name": "save_product",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "price": {"type": "number"}
            },
            "required": ["name", "price"]
        }
    }
}]
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "分析并保存：蓝牙耳机"}],
    tools=tools,
    tool_choice={"type": "function", "function": {"name": "save_product"}}
)
# 模型通过 tool_calls 返回参数，需要额外处理调用逻辑
```

---

## 总结

Structured Output 不仅仅是一个 API 特性，它代表了 AI 工程化的一个重要方向：**让 LLM 的输出变得可预测、可校验、可集成**。

本文的核心要点回顾：

1. **JSON Schema 是契约**：它是前后端、LLM 之间的统一语言
2. **Pydantic / Zod 是守门人**：在应用层强制类型安全，不信任任何外部输入
3. **Laravel DTO 是转换器**：将 LLM 输出优雅地映射为标准化 API 响应
4. **分层校验是保障**：Schema 校验 → 业务规则校验 → UI 校验，层层防御
5. **Fallback 是必须的**：任何依赖 LLM 的系统都需要优雅的降级方案

随着 LLM 能力的持续提升和 API 标准的逐步统一，Structured Output 将成为构建 AI 应用的基础设施层。掌握它，就是掌握了将 AI 从实验室搬进生产环境的钥匙。

---

> **参考资料**
> - [OpenAI Structured Outputs 文档](https://platform.openai.com/docs/guides/structured-outputs)
> - [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
> - [Pydantic V2 文档](https://docs.pydantic.dev/)
> - [Zod 文档](https://zod.dev/)
> - [spatie/laravel-data 文档](https://spatie.be/docs/laravel-data)
> - [JSON Schema 规范](https://json-schema.org/specification)

---

## 相关阅读

- [Anthropic Claude Opus4 / OpenAI o3 实战：最新推理模型接入、思维链输出、Tool Use 与 Laravel 集成](/categories/架构/Anthropic-Claude-Opus4-OpenAI-o3-实战-最新推理模型接入-思维链输出-Tool-Use与Laravel集成/)
- [AI Agent Orchestration Patterns 2026：Supervisor / Router / Swarm / DAG 编排模式选型](/categories/架构/AI-Agent-Orchestration-Patterns-2026-Supervisor-Router-Swarm-DAG-编排模式选型/)
- [FastAPI 实战：高性能 Python API 框架、Pydantic 校验、依赖注入与 OpenAPI 自动生成](/categories/架构/FastAPI-实战-高性能-Python-API-框架-Pydantic校验-依赖注入与OpenAPI自动生成/)
