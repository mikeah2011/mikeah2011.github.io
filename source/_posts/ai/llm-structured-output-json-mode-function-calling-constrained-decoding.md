---
title: "LLM Structured Output 实战进阶：JSON Mode vs Function Calling vs Constrained Decoding"
keywords: [LLM Structured Output, JSON Mode vs Function Calling vs Constrained Decoding, 实战进阶, AI]
date: 2026-06-10 08:09:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - LLM
  - Structured Output
  - Laravel
  - OpenAI
  - Function Calling
  - JSON Mode
  - Constrained Decoding
description: "深入对比三种 LLM 强制输出格式方案的原理与可靠性，并给出 Laravel 集成的完整实战代码。"
---


## 概述

在生产环境中使用 LLM，最大的痛点之一就是输出格式不可控。你让模型返回 JSON，它可能给你一段带注释的代码块；你让它按 schema 返回数据，它可能漏掉某个字段。Structured Output 就是解决这个问题的——让模型的输出严格符合我们预定义的格式。

目前主流有三种方案：

| 方案 | 原理 | 可靠性 | 灵活性 |
|------|------|--------|--------|
| **JSON Mode** | 系统提示 + 后处理 | 中 | 高 |
| **Function Calling** | 模型原生工具调用 | 高 | 中 |
| **Constrained Decoding** | Token 采样阶段强制约束 | 极高 | 低 |

本文会从原理讲起，逐步深入到 Laravel 中的实战集成，最后分享踩坑经验。

---

## 一、JSON Mode：最简单但最脆弱

### 原理

JSON Mode 本质上是两件事的组合：

1. **System Prompt 里要求模型输出 JSON**（"请以 JSON 格式返回"）
2. **API 层面的 `response_format` 参数**（OpenAI 的 `{"type": "json_object"}`）

模型在生成时会被引导输出合法的 JSON 字符串，但 **不保证结构和字段符合你的 schema**。

### OpenAI 的 JSON Mode

```php
use OpenAI\Laravel\Facades\OpenAI;

$response = OpenAI::chat()->create([
    'model' => 'gpt-4o',
    'response_format' => ['type' => 'json_object'],
    'messages' => [
        ['role' => 'system', 'content' => '你是一个返回JSON的助手，返回用户的基本信息。'],
        ['role' => 'user', 'content' => '张三，28岁，上海，工程师'],
    ],
]);

$content = $response->choices[0]->message->content;
// 可能返回：{"name":"张三","age":28,"city":"上海","job":"工程师"}
// 也可能返回：{"name":"张三","age":"28","location":{"city":"上海"},"occupation":"工程师"}
```

注意看——同样是合法 JSON，但字段名和嵌套结构完全不确定。这就是 JSON Mode 的核心问题：**只保证语法合法，不保证语义一致**。

### Laravel 中的实用封装

```php
<?php

namespace App\Services\LLM;

use OpenAI\Laravel\Facades\OpenAI;
use InvalidArgumentException;

class JsonModeExtractor
{
    /**
     * 使用 JSON Mode 提取结构化数据
     * 
     * @param string $systemPrompt 系统提示，描述期望的 JSON 结构
     * @param string $userMessage 用户输入
     * @param array $schema 期望的字段定义（用于后处理校验）
     * @return array
     * @throws \RuntimeException
     */
    public function extract(string $systemPrompt, string $userMessage, array $schema = []): array
    {
        $systemPrompt .= "\n\n请严格返回合法的 JSON 对象，不要包含任何其他文本。";

        if (!empty($schema)) {
            $systemPrompt .= "\n期望的 JSON 结构：\n" . json_encode($schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        }

        $response = OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'temperature' => 0.1,  // 低温度减少随机性
            'response_format' => ['type' => 'json_object'],
            'messages' => [
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => $userMessage],
            ],
        ]);

        $content = $response->choices[0]->message->content;

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \RuntimeException("JSON 解析失败: " . json_last_error_msg());
        }

        // 可选：校验必需字段
        if (!empty($schema)) {
            $this->validateSchema($data, $schema);
        }

        return $data;
    }

    private function validateSchema(array $data, array $schema): void
    {
        foreach ($schema as $field => $rules) {
            if (is_array($rules) && ($rules['required'] ?? false)) {
                if (!array_key_exists($field, $data)) {
                    throw new InvalidArgumentException("缺少必需字段: {$field}");
                }
            }
        }
    }
}
```

### JSON Mode 的局限

- 模型可能返回 `"age": "28"` 而不是 `"age": 28`（字符串 vs 整数）
- 嵌套结构不稳定，同一 prompt 可能返回不同的 JSON 结构
- 无法强制枚举值，模型可能返回 `{"status": "active"}` 或 `{"status": "激活"}`
- **总结：适合原型验证，不适合生产环境对格式要求严格的场景**

---

## 二、Function Calling：生产级首选

### 原理

Function Calling 是 OpenAI（以及大多数主流模型）提供的原生能力。你定义一个函数的 JSON Schema，模型会：

1. 理解你的函数定义
2. 根据用户输入决定是否调用该函数
3. **严格按照 schema 生成函数参数**

关键区别：Function Calling 的输出是模型训练阶段就内化的约束，不是靠 prompt 引导的。

### OpenAI Function Calling 的 JSON Schema

```php
use OpenAI\Laravel\Facades\OpenAI;

$response = OpenAI::chat()->create([
    'model' => 'gpt-4o',
    'messages' => [
        ['role' => 'system', 'content' => '你是一个信息提取助手。'],
        ['role' => 'user', 'content' => '张三，28岁，上海，工程师，月薪15k'],
    ],
    'tools' => [[
        'type' => 'function',
        'function' => [
            'name' => 'extract_user_info',
            'description' => '从文本中提取用户信息',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'name' => [
                        'type' => 'string',
                        'description' => '用户姓名',
                    ],
                    'age' => [
                        'type' => 'integer',
                        'description' => '年龄',
                        'minimum' => 0,
                        'maximum' => 150,
                    ],
                    'city' => [
                        'type' => 'string',
                        'enum' => ['北京', '上海', '广州', '深圳', '杭州', '成都', '其他'],
                        'description' => '所在城市',
                    ],
                    'job_title' => [
                        'type' => 'string',
                        'description' => '职位名称',
                    ],
                    'salary' => [
                        'type' => 'number',
                        'description' => '月薪（元）',
                    ],
                ],
                'required' => ['name', 'age', 'city'],
            ],
        ],
    ]],
    'tool_choice' => [
        'type' => 'function',
        'function' => ['name' => 'extract_user_info'],
    ],  // 强制调用指定函数
]);

$toolCall = $response->choices[0]->message->toolCalls[0];
$arguments = json_decode($toolCall->function->arguments, true);

// 结果稳定可靠：
// [
//     'name' => '张三',
//     'age' => 28,          // 整数，不是字符串
//     'city' => '上海',     // 枚举约束，不会出现"魔都"
//     'job_title' => '工程师',
//     'salary' => 15000.0,
// ]
```

### `tool_choice` 的三种模式

```php
// 1. auto - 模型自己决定是否调用（可能不调用）
'tool_choice' => 'auto',

// 2. required - 必须调用某个函数（但不指定哪个）
'tool_choice' => 'required',

// 3. 指定函数 - 强制调用特定函数（最严格）
'tool_choice' => [
    'type' => 'function',
    'function' => ['name' => 'extract_user_info'],
],
```

**生产环境建议：如果你的场景是"必须提取数据"，用第三种（指定函数），确保模型一定会调用。**

### Laravel Service 封装

```php
<?php

namespace App\Services\LLM;

use OpenAI\Laravel\Facades\OpenAI;
use RuntimeException;

class FunctionCallingExtractor
{
    /**
     * 通过 Function Calling 提取结构化数据
     * 
     * @param array $messages 对话消息
     * @param array $functionDef 函数定义（name, description, parameters）
     * @param bool $forceCall 是否强制调用
     * @return array 提取的数据
     */
    public function extract(array $messages, array $functionDef, bool $forceCall = true): array
    {
        $tool = [
            'type' => 'function',
            'function' => $functionDef,
        ];

        $toolChoice = $forceCall
            ? ['type' => 'function', 'function' => ['name' => $functionDef['name']]]
            : 'auto';

        $response = OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'temperature' => 0.1,
            'messages' => $messages,
            'tools' => [$tool],
            'tool_choice' => $toolChoice,
        ]);

        $message = $response->choices[0]->message;

        // 检查是否有工具调用
        if (empty($message->toolCalls)) {
            throw new RuntimeException('模型未返回工具调用，可能无法从输入中提取数据');
        }

        $toolCall = $message->toolCalls[0];
        $arguments = json_decode($toolCall->function->arguments, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException("函数参数 JSON 解析失败: " . json_last_error_msg());
        }

        return $arguments;
    }
}
```

### 使用示例：产品信息提取

```php
<?php

namespace App\Services\Product;

use App\Services\LLM\FunctionCallingExtractor;

class ProductInfoExtractor
{
    public function __construct(
        private FunctionCallingExtractor $extractor
    ) {}

    public function extractFromDescription(string $description): array
    {
        $functionDef = [
            'name' => 'extract_product',
            'description' => '从产品描述中提取结构化产品信息',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'name' => [
                        'type' => 'string',
                        'description' => '产品名称',
                    ],
                    'category' => [
                        'type' => 'string',
                        'enum' => ['电子产品', '服装', '食品', '家居', '美妆', '其他'],
                    ],
                    'price_range' => [
                        'type' => 'object',
                        'properties' => [
                            'min' => ['type' => 'number'],
                            'max' => ['type' => 'number'],
                        ],
                        'required' => ['min', 'max'],
                    ],
                    'features' => [
                        'type' => 'array',
                        'items' => ['type' => 'string'],
                        'description' => '产品特点列表',
                    ],
                    'in_stock' => [
                        'type' => 'boolean',
                    ],
                ],
                'required' => ['name', 'category'],
            ],
        ];

        return $this->extractor->extract(
            messages: [
                ['role' => 'system', 'content' => '从产品描述中提取信息。'],
                ['role' => 'user', 'content' => $description],
            ],
            functionDef: $functionDef,
        );
    }
}

// 调用
$service = app(ProductInfoExtractor::class);
$result = $service->extractFromDescription(
    '新款 AirPods Pro 3 无线降噪耳机，支持空间音频，售价 1899-2299 元，现货发售'
);

// [
//     'name' => 'AirPods Pro 3',
//     'category' => '电子产品',
//     'price_range' => ['min' => 1899, 'max' => 2299],
//     'features' => ['无线降噪', '空间音频'],
//     'in_stock' => true,
// ]
```

---

## 三、Constrained Decoding：终极可靠性

### 原理

Constrained Decoding 是在模型推理的 **token 采样阶段** 进行约束。不是靠 prompt 引导，也不是靠函数定义，而是在每一步生成 token 时，直接屏蔽掉不符合规则的 token。

想象一个有限状态机（FSM）：模型每生成一个 token，FSM 就更新状态，下一步只允许符合当前状态的 token 被采样。

```
状态: 等待key → 只允许 '"' token
状态: 在key中 → 只允许字母/数字 token  
状态: 等待冒号 → 只允许 ':' token
状态: 等待value → 只允许 '"', 数字, '{', '[', 'true', 'false', 'null'
... 以此类推
```

### 支持 Constrained Decoding 的工具

目前主流支持：

- **Outlines**（Python）：基于正则表达式或 JSON Schema 的约束生成
- **Guidance**（微软）：支持多种约束类型
- **llama.cpp / vLLM**：原生支持 grammar-based sampling
- **OpenAI Structured Outputs**：API 级别支持（基于 response_format + schema）

### OpenAI Structured Outputs（最简单的 Constrained Decoding）

OpenAI 在 2024 年推出的 Structured Outputs 本质上就是 Constrained Decoding：

```php
use OpenAI\Laravel\Facades\OpenAI;

$response = OpenAI::chat()->create([
    'model' => 'gpt-4o-2024-08-06',  // 需要支持 structured outputs 的模型版本
    'messages' => [
        ['role' => 'system', 'content' => '从文本中提取数学表达式。'],
        ['role' => 'user', 'content' => '计算 3 加 5 乘以 2 的结果'],
    ],
    'response_format' => [
        'type' => 'json_schema',
        'json_schema' => [
            'name' => 'math_expression',
            'strict' => true,  // 开启严格模式
            'schema' => [
                'type' => 'object',
                'properties' => [
                    'expression' => [
                        'type' => 'string',
                        'description' => '数学表达式',
                    ],
                    'result' => [
                        'type' => 'number',
                        'description' => '计算结果',
                    ],
                    'steps' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'object',
                            'properties' => [
                                'operation' => ['type' => 'string'],
                                'operands' => [
                                    'type' => 'array',
                                    'items' => ['type' => 'number'],
                                ],
                                'result' => ['type' => 'number'],
                            ],
                            'required' => ['operation', 'operands', 'result'],
                            'additionalProperties' => false,
                        ],
                    ],
                ],
                'required' => ['expression', 'result', 'steps'],
                'additionalProperties' => false,
            ],
        ],
    ],
]);

$content = json_decode($response->choices[0]->message->content, true);

// 100% 符合 schema，不会有多余字段，不会缺少必需字段
// [
//     'expression' => '3 + 5 * 2',
//     'result' => 13.0,
//     'steps' => [
//         ['operation' => '*', 'operands' => [5, 2], 'result' => 10],
//         ['operation' => '+', 'operands' => [3, 10], 'result' => 13],
//     ],
// ]
```

### `strict: true` 的限制

OpenAI Structured Outputs 的严格模式有一些限制：

```php
// ✅ 支持的类型
'type' => 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object'

// ✅ 支持的约束
'enum' => [...]
'anyOf' => [...]
'required' => [...]

// ❌ 不支持
'pattern' => '正则表达式'      // 不支持
'minLength' / 'maxLength'      // 不支持
'minimum' / 'maximum'          // 不支持
'format' => 'email'            // 不支持
```

**注意：`additionalProperties: false` 是必须的，否则会报错。**

### 本地 Constrained Decoding（Outlines）

如果你用的是本地部署的模型（比如 Llama 3），可以用 Outlines 实现更灵活的约束：

```python
import outlines

model = outlines.models.transformers("meta-llama/Llama-3-8B-Instruct")

# 方式1：正则表达式约束
generator = outlines.generate.regex(
    model,
    r"\d{4}-\d{2}-\d{2}"  # 只允许日期格式
)
result = generator("今天是几号？")  # 输出: 2026-06-10

# 方式2：JSON Schema 约束
schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer", "minimum": 0},
    },
    "required": ["name", "age"],
}
generator = outlines.generate.json(model, schema)
result = generator("张三28岁")  # 输出: {"name": "张三", "age": 28}

# 方式3：枚举约束
generator = outlines.generate.choice(
    model,
    ["positive", "negative", "neutral"]
)
result = generator("这个产品太棒了！")  # 输出: positive
```

---

## 四、三种方案对比实战

同一个任务，三种方案的效果对比：

**任务：从用户评论中提取情感分析结果**

```php
<?php

namespace App\Services\LLM;

class SentimentAnalyzer
{
    // 方案1: JSON Mode
    public function withJsonMode(string $comment): array
    {
        $response = \OpenAI\Laravel\Facades\OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'temperature' => 0,
            'response_format' => ['type' => 'json_object'],
            'messages' => [
                ['role' => 'system', 'content' => <<<PROMPT
分析评论情感，返回JSON：
{
  "sentiment": "positive" | "negative" | "neutral",
  "confidence": 0.0-1.0,
  "keywords": ["关键词1", "关键词2"]
}
PROMPT],
                ['role' => 'user', 'content' => $comment],
            ],
        ]);

        return json_decode($response->choices[0]->message->content, true);
    }

    // 方案2: Function Calling
    public function withFunctionCalling(string $comment): array
    {
        $response = \OpenAI\Laravel\Facades\OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'temperature' => 0,
            'messages' => [
                ['role' => 'system', 'content' => '分析评论情感。'],
                ['role' => 'user', 'content' => $comment],
            ],
            'tools' => [[
                'type' => 'function',
                'function' => [
                    'name' => 'analyze_sentiment',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'sentiment' => [
                                'type' => 'string',
                                'enum' => ['positive', 'negative', 'neutral'],
                            ],
                            'confidence' => [
                                'type' => 'number',
                            ],
                            'keywords' => [
                                'type' => 'array',
                                'items' => ['type' => 'string'],
                            ],
                        ],
                        'required' => ['sentiment', 'confidence', 'keywords'],
                    ],
                ],
            ]],
            'tool_choice' => [
                'type' => 'function',
                'function' => ['name' => 'analyze_sentiment'],
            ],
        ]);

        return json_decode(
            $response->choices[0]->message->toolCalls[0]->function->arguments,
            true
        );
    }

    // 方案3: Structured Outputs (Constrained Decoding)
    public function withStructuredOutput(string $comment): array
    {
        $response = \OpenAI\Laravel\Facades\OpenAI::chat()->create([
            'model' => 'gpt-4o-2024-08-06',
            'temperature' => 0,
            'messages' => [
                ['role' => 'system', 'content' => '分析评论情感。'],
                ['role' => 'user', 'content' => $comment],
            ],
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'sentiment',
                    'strict' => true,
                    'schema' => [
                        'type' => 'object',
                        'properties' => [
                            'sentiment' => [
                                'type' => 'string',
                                'enum' => ['positive', 'negative', 'neutral'],
                            ],
                            'confidence' => ['type' => 'number'],
                            'keywords' => [
                                'type' => 'array',
                                'items' => ['type' => 'string'],
                            ],
                        ],
                        'required' => ['sentiment', 'confidence', 'keywords'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
        ]);

        return json_decode($response->choices[0]->message->content, true);
    }
}
```

### 运行结果对比

```php
$analyzer = app(SentimentAnalyzer::class);
$comment = '这家餐厅的菜品味道不错，但是服务太慢了，等了半小时才上菜';

// JSON Mode - 可能返回不一致的结构
$r1 = $analyzer->withJsonMode($comment);
// 第1次: {"sentiment": "mixed", "confidence": 0.7, "keywords": ["味道不错", "服务慢"]}
// 第2次: {"sentiment": "neutral", "score": 0.5, "key_words": ["菜品", "服务"]}  ← 字段名变了！

// Function Calling - 结构稳定
$r2 = $analyzer->withFunctionCalling($comment);
// 每次: {"sentiment": "neutral", "confidence": 0.6, "keywords": ["味道不错", "服务慢"]}

// Structured Output - 结构100%稳定
$r3 = $analyzer->withStructuredOutput($comment);
// 每次: {"sentiment": "neutral", "confidence": 0.6, "keywords": ["味道不错", "服务慢"]}
```

---

## 五、踩坑记录

### 坑1：JSON Mode 的 `temperature` 陷阱

```php
// ❌ 高温度 + JSON Mode = 灾难
'temperature' => 1.0,
'response_format' => ['type' => 'json_object'],
// 可能返回: {"name": "张三", "age": "twenty-eight"}  ← 字符串！
// 甚至可能返回带注释的"JSON"：{"name": "张三", // 姓名\n "age": 28}

// ✅ 低温度 + JSON Mode
'temperature' => 0.1,
'response_format' => ['type' => 'json_object'],
```

### 坑2：Function Calling 的 `required` 不是万能的

```php
// 即使设了 required，模型偶尔仍可能不返回某些字段
'properties' => [
    'email' => ['type' => 'string'],
],
'required' => ['email'],

// 用户输入: "我叫张三"
// 模型可能返回: {"email": ""}  ← 空字符串凑数

// 解决方案：后端校验不可省略
private function validateEmail(array $data): void
{
    if (empty($data['email']) || !filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
        throw new InvalidDataException('邮箱字段缺失或格式无效');
    }
}
```

### 坑3：Structured Outputs 的 `additionalProperties: false`

```php
// ❌ 忘记加 additionalProperties: false
'schema' => [
    'type' => 'object',
    'properties' => [...],
    'required' => [...],
],
// 报错: "schema must have additionalProperties set to false"

// ✅ 正确写法
'schema' => [
    'type' => 'object',
    'properties' => [...],
    'required' => [...],
    'additionalProperties' => false,
],
```

### 坑4：Function Calling 的函数名长度限制

```php
// ❌ 函数名太长
'function' => [
    'name' => 'extract_comprehensive_user_information_from_text',  // 超过64字符
    ...
],
// 报错或截断

// ✅ 简洁命名
'function' => [
    'name' => 'extract_user',
    ...
],
```

### 坑5：嵌套对象的 Schema 定义

```php
// ❌ 嵌套对象忘记定义 properties
'address' => [
    'type' => 'object',
    // 没有 properties，模型可能返回任意结构
],

// ✅ 完整定义嵌套结构
'address' => [
    'type' => 'object',
    'properties' => [
        'province' => ['type' => 'string'],
        'city' => ['type' => 'string'],
        'district' => ['type' => 'string'],
        'detail' => ['type' => 'string'],
    ],
    'required' => ['city'],
    'additionalProperties' => false,
],
```

---

## 六、方案选型指南

```
你需要严格符合 schema 的输出？
├── 是 → 用 Structured Outputs (response_format: json_schema)
│        ├── 模型支持？（gpt-4o-2024-08-06+）→ 直接用
│        └── 模型不支持？→ 用 Function Calling
│
└── 否 → 你能接受偶尔格式不一致？
    ├── 是 → JSON Mode 够用（省 token、简单）
    └── 否 → Function Calling
```

**我的建议：**

1. **生产环境提取数据** → Structured Outputs（如果模型支持）或 Function Calling
2. **快速原型** → JSON Mode
3. **本地模型** → Constrained Decoding（Outlines / llama.cpp grammar）
4. **需要正则约束**（如电话号码、日期格式）→ 本地 Constrained Decoding

---

## 七、高级技巧：三种方案组合使用

在实际项目中，我通常会组合使用：

```php
<?php

namespace App\Services\LLM;

use RuntimeException;

class RobustExtractor
{
    /**
     * 三级降级策略：
     * 1. 优先用 Structured Outputs（最可靠）
     * 2. 失败降级到 Function Calling
     * 3. 最后降级到 JSON Mode + 后处理
     */
    public function extract(array $messages, array $schema): array
    {
        // Level 1: Structured Outputs
        try {
            return $this->withStructuredOutput($messages, $schema);
        } catch (\Throwable $e) {
            \Log::warning("Structured Output 失败，降级到 Function Calling", [
                'error' => $e->getMessage(),
            ]);
        }

        // Level 2: Function Calling
        try {
            return $this->withFunctionCalling($messages, $schema);
        } catch (\Throwable $e) {
            \Log::warning("Function Calling 失败，降级到 JSON Mode", [
                'error' => $e->getMessage(),
            ]);
        }

        // Level 3: JSON Mode + 后处理
        return $this->withJsonModeAndPostProcess($messages, $schema);
    }

    private function withStructuredOutput(array $messages, array $schema): array
    {
        $response = \OpenAI\Laravel\Facades\OpenAI::chat()->create([
            'model' => 'gpt-4o-2024-08-06',
            'temperature' => 0,
            'messages' => $messages,
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'extraction',
                    'strict' => true,
                    'schema' => array_merge($schema, [
                        'additionalProperties' => false,
                    ]),
                ],
            ],
        ]);

        $data = json_decode($response->choices[0]->message->content, true);
        if (!$data) {
            throw new RuntimeException('Structured Output 返回空数据');
        }

        return $data;
    }

    private function withFunctionCalling(array $messages, array $schema): array
    {
        $response = \OpenAI\Laravel\Facades\OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'temperature' => 0,
            'messages' => $messages,
            'tools' => [[
                'type' => 'function',
                'function' => [
                    'name' => 'extract_data',
                    'parameters' => $schema,
                ],
            ]],
            'tool_choice' => [
                'type' => 'function',
                'function' => ['name' => 'extract_data'],
            ],
        ]);

        $args = $response->choices[0]->message->toolCalls[0]->function->arguments ?? null;
        if (!$args) {
            throw new RuntimeException('Function Calling 未返回参数');
        }

        return json_decode($args, true);
    }

    private function withJsonModeAndPostProcess(array $messages, array $schema): array
    {
        $messages[] = [
            'role' => 'system',
            'content' => '请返回合法JSON，结构如下：' . json_encode($schema['properties'] ?? $schema),
        ];

        $response = \OpenAI\Laravel\Facades\OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'temperature' => 0,
            'messages' => $messages,
            'response_format' => ['type' => 'json_object'],
        ]);

        $data = json_decode($response->choices[0]->message->content, true);
        if (!$data) {
            throw new RuntimeException('所有提取方案均失败');
        }

        return $data;
    }
}
```

---

## 总结

| 维度 | JSON Mode | Function Calling | Structured Outputs |
|------|-----------|------------------|--------------------|
| **可靠性** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **灵活性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **实现难度** | 简单 | 中等 | 简单 |
| **模型支持** | 全部 | 主流 | 有限 |
| **Token 开销** | 低 | 中（需传 schema） | 中 |
| **适用场景** | 原型验证 | 生产环境 | 严格格式要求 |

**一句话总结：能用 Structured Outputs 就用，不行就 Function Calling，JSON Mode 只留给原型。**

生产环境永远要加后端校验——LLM 再可靠，也比不上你的 `validate()` 方法。

---

> 参考资料：
> - [OpenAI Structured Outputs 官方文档](https://platform.openai.com/docs/guides/structured-outputs)
> - [Outlines - Structured Generation](https://github.com/dottxt-ai/outlines)
> - [OpenAI Function Calling 指南](https://platform.openai.com/docs/guides/function-calling)
