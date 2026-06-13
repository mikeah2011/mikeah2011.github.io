---
title: "LLM Structured Generation 实战：Outlines/LMQL/Instructor——强制 JSON Schema 输出的底层原理与 Laravel 集成"
keywords: [LLM Structured Generation, Outlines, LMQL, Instructor, JSON Schema, Laravel, 强制, 输出的底层原理与, AI]
date: 2026-06-09 08:35:00
categories:
  - ai
tags:
  - LLM
  - Structured-Generation
  - JSON-Schema
  - Outlines
  - LMQL
  - Instructor
  - Laravel
  - Constrained-Decoding
description: "深入解析 LLM Structured Generation 的三大主流方案（Outlines、LMQL、Instructor），从底层 constrained decoding 原理到 Laravel 项目集成实战，彻底解决 LLM 输出格式不稳定的问题。"
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200
---


## 概述

你有没有遇到过这样的场景：让 LLM 返回 JSON，它偏偏给你加个 `Here is the JSON:` 前缀；让它返回特定枚举值，它给你一个不在选项里的回答；让它按 schema 输出，它少了一个字段或者多了一层嵌套。

这就是 **Structured Generation**（结构化生成）要解决的核心问题。

传统做法是写一堆后处理逻辑：正则提取 JSON、try-catch 解析、重试。但这治标不治本。真正的解决方案是在 **token 生成阶段** 就强制约束输出格式——让模型物理上不可能生成不符合要求的 token。

本文深入对比三大主流方案：

| 方案 | 定位 | 约束方式 | 适用场景 |
|------|------|----------|----------|
| **Outlines** | Python 推理引擎 | Constrained Decoding（底层 logits 屏蔽） | 自建模型推理、vLLM/Ollama 集成 |
| **LMQL** | 查询语言 | 编译期约束 + 运行时屏蔽 | 复杂交互式 prompt、多轮对话 |
| **Instructor** | 库/SDK | 后处理 + 重试 + 结构化 API | 调用 OpenAI/Anthropic 等商业 API |

三者解决同一问题，但切入层面完全不同。理解它们的差异，才能在 Laravel 项目中选对工具。

## 核心概念：为什么 LLM 输出会"跑偏"

### 自回归生成的本质

LLM 本质是一个 **next-token predictor**。每一步，它给词表中所有 token 分配一个概率（logits），然后采样出下一个 token。这个过程是概率性的，所以输出天然不稳定。

```
输入: "返回一个 JSON，包含 name 和 age 字段"
输出可能是:
  {"name": "Alice", "age": 30}          ✅
  Here is the JSON: {"name": "Alice"}   ❌ 多了前缀
  {"name": "Alice", "age": "thirty"}    ❌ 类型错误
  {"name": "Alice"}                      ❌ 缺字段
```

### Constrained Decoding：从根源解决

**Constrained Decoding** 的核心思想：在每一步采样时，根据当前的 JSON Schema 状态，**直接屏蔽掉不合法的 token 的 logits**（设为 -inf），让模型只能选择合法的 token。

```
假设当前状态: {"name": "Alice",
合法的下一个 token 只能是: " (引号开始下一个 key) 或 } (结束对象)
其他所有 token 的 logits 被设为 -inf → 概率为 0
```

这是 **硬约束**，不是软提示（prompt engineering）。模型在物理上无法生成不符合 schema 的输出。

### 约束的三个层面

1. **Prompt 层**：在 system prompt 里要求 "返回 JSON"（最弱，模型可能忽略）
2. **API 层**：利用 OpenAI 的 `response_format: { type: "json_object" }`（中等，只能保证是 JSON，不保证 schema）
3. **Token 层**：Constrained Decoding（最强，100% 符合 schema）

## 方案一：Outlines——底层 Constrained Decoding 引擎

Outlines 是 [Outlines.ai](https://github.com/outlines-dev/outlines) 开发的 Python 库，直接操作模型的 logits 层，实现真正的 constrained decoding。

### 工作原理

Outlines 使用 **有限状态机（FSM）** 来跟踪 JSON Schema 的状态转移：

```python
# JSON Schema 对应的 FSM 状态转移示例
# 状态: 等待 key → 等待冒号 → 等待 value → 等待逗号或结束
# 每个状态都有一组合法 token

# Outlines 内部流程:
# 1. 将 JSON Schema 编译为正则表达式
# 2. 将正则表达式编译为 FSM
# 3. 在每一步生成时，根据 FSM 当前状态计算合法 token 集合
# 4. 将不合法 token 的 logits 设为 -inf
# 5. 从合法 token 中采样
```

### 基础用法

```python
import outlines
import json

# 加载模型（支持 HuggingFace、vLLM、Ollama 等）
model = outlines.models.transformers("Qwen/Qwen2.5-7B-Instruct")

# 定义 JSON Schema
schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer", "minimum": 0},
        "email": {"type": "string", "format": "email"}
    },
    "required": ["name", "age", "email"]
}

# 使用 schema 约束生成
generator = outlines.generate.json(model, schema)
result = generator("Extract info: John is 25 years old, email john@example.com")

print(result)
# {"name": "John", "age": 25, "email": "john@example.com"}
# 100% 符合 schema，不可能出现其他格式
```

### 枚举约束

```python
# 强制模型只能输出预定义的选项
sentiment = outlines.generate.choice(
    model,
    ["positive", "negative", "neutral"]
)

result = sentiment("This movie was terrible!")
# 输出: "negative"
# 不可能出现 "The sentiment is negative" 这种自由文本
```

### 正则表达式约束

```python
# 强制输出匹配特定格式
email_generator = outlines.generate.regex(
    model,
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
)

result = email_generator("My email is alice at gmail dot com")
# 输出: "alice@gmail.com"
# 只会输出合法的邮箱格式
```

### 与 vLLM 集成（高性能推理）

```python
from vllm import LLM, SamplingParams
from outlines.serve.vllm import JSONLogitsProcessor

# vLLM + Outlines 结合，兼顾性能和约束
llm = LLM(model="Qwen/Qwen2.5-7B-Instruct")

logits_processors = [JSONLogitsProcessor(schema, llm.get_tokenizer())]
sampling_params = SamplingParams(
    temperature=0.7,
    max_tokens=512,
    logits_processors=logits_processors
)

output = llm.generate(["Extract: ..."], sampling_params)
```

## 方案二：LMQL——查询语言级别的约束

LMQL（Language Model Query Language）是一种专门为 LLM 设计的查询语言，它把约束写在查询语句里，编译时就确定了约束逻辑。

### 工作原理

LMQL 的核心是 **compile-time constraint resolution**：

```lmql
"Extract entity from: {text}\n"
"Name: [name]" where STOPS_BEFORE(name, "\n")
"Age: [age]" where regex(age, r"\d{1,3}")
"Type: [etype]" where etype in ["person", "company", "location"]
```

LMQL 编译器会：
1. 解析查询语句中的约束
2. 在运行时将约束转换为 token 层面的屏蔽规则
3. 与模型推理过程同步执行

### 基础用法

```python
import lmql

@lmql.query
def extract_person(text):
    '''lmql
    "Extract person info from: {text}\n\n"
    "Name: [name]" where STOPS_BEFORE(name, "\n")
    "Age: [age]" where INT(age)
    "Email: [email]" where STOPS_BEFORE(email, "\n") and REGEX(email, r"[^@]+@[^@]+\.[^@]+")
    
    return {"name": name.strip(), "age": int(age), "email": email.strip()}
    '''

result = extract_person("Alice is 30, contact: alice@example.com")
# {"name": "Alice", "age": 30, "email": "alice@example.com"}
```

### JSON Schema 约束

```python
import lmql
import json

@lmql.query
def structured_extract(text, schema):
    '''lmql
    "Given the schema: {json.dumps(schema)}\n"
    "Extract from: {text}\n\n"
    "Result: [result]" where JSON(result, schema)
    
    return json.loads(result)
    '''

schema = {
    "type": "object",
    "properties": {
        "product": {"type": "string"},
        "price": {"type": "number"},
        "currency": {"type": "string", "enum": ["USD", "EUR", "CNY"]}
    }
}

result = structured_extract("The laptop costs $999", schema)
# {"product": "laptop", "price": 999, "currency": "USD"}
```

### 多轮对话约束

LMQL 的独特优势是可以约束多轮对话中的每一步：

```python
@lmql.query
def multi_step_extract(text):
    '''lmql
    "Analyze the following text: {text}\n\n"
    
    "Step 1 - Language: [lang]" where lang in ["en", "zh", "ja", "ko"]
    "Step 2 - Sentiment: [sent]" where sent in ["positive", "negative", "neutral"]
    "Step 3 - Confidence: [conf]" where FLOAT(conf) and 0 <= float(conf) <= 1
    
    return {
        "language": lang,
        "sentiment": sent,
        "confidence": float(conf)
    }
    '''
```

## 方案三：Instructor——面向商业 API 的最佳实践

Instructor 是 [Jason Liu](https://github.com/jxnl/instructor) 开发的 Python 库，专门为 OpenAI、Anthropic 等商业 API 设计。它不直接做 constrained decoding（因为商业 API 的 logits 不可访问），而是利用 **Structured Output** 和 **重试机制** 来保证输出格式。

### 工作原理

```
1. 将 Pydantic 模型转换为 JSON Schema
2. 通过 API 的 response_format 或 tool_use 传递 schema
3. 解析返回结果到 Pydantic 模型
4. 如果解析失败（字段缺失、类型错误），自动重试并附带错误信息
5. 最多重试 N 次，每次都告诉模型哪里错了
```

### 基础用法

```python
import instructor
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import Literal

# 初始化（自动 patch OpenAI client）
client = instructor.from_openai(OpenAI())

class Person(BaseModel):
    name: str = Field(description="Full name")
    age: int = Field(ge=0, le=150, description="Age in years")
    role: Literal["admin", "user", "guest"] = Field(description="User role")

# 使用 Pydantic 模型约束输出
person = client.chat.completions.create(
    model="gpt-4o",
    response_model=Person,
    messages=[
        {"role": "user", "content": "Extract: Alice, 30 years old, admin"}
    ]
)

print(person.name)   # "Alice"
print(person.age)    # 30
print(person.role)   # "admin"
# 返回的是 Pydantic 对象，不是字符串
```

### 嵌套模型

```python
from pydantic import BaseModel
from typing import List

class Address(BaseModel):
    street: str
    city: str
    country: str

class Company(BaseModel):
    name: str
    industry: str
    employees: int = Field(ge=1)
    headquarters: Address  # 嵌套模型
    offices: List[Address] = []

company = client.chat.completions.create(
    model="gpt-4o",
    response_model=Company,
    messages=[
        {"role": "user", "content": """
            Acme Corp is a tech company with 500 employees.
            HQ: 123 Main St, San Francisco, USA.
            Also has offices at: 456 Oak Ave, New York, USA
            and 789 Pine Rd, London, UK.
        """}
    ]
)
# 自动解析嵌套结构，字段缺失会重试
```

### 验证与重试

```python
from pydantic import BaseModel, field_validator

class Transaction(BaseModel):
    amount: float
    currency: str
    
    @field_validator("currency")
    @classmethod
    def validate_currency(cls, v):
        valid = ["USD", "EUR", "CNY", "JPY", "GBP"]
        if v.upper() not in valid:
            raise ValueError(f"Currency must be one of {valid}")
        return v.upper()

# Instructor 会自动重试，把验证错误反馈给模型
transaction = client.chat.completions.create(
    model="gpt-4o",
    response_model=Transaction,
    max_retries=3,  # 最多重试 3 次
    messages=[
        {"role": "user", "content": "The price is 99 dollars"}
    ]
)
# 第一次可能返回 {"amount": 99, "currency": "dollars"}
# 验证失败，重试时把错误信息发给模型
# 第二次返回 {"amount": 99, "currency": "USD"}
```

### 流式输出

```python
from typing import Generator

class Summary(BaseModel):
    title: str
    key_points: List[str]
    score: float

# 流式生成，逐步构建对象
stream = client.chat.completions.create_partial(
    model="gpt-4o",
    response_model=Summary,
    stream=True,
    messages=[{"role": "user", "content": "Summarize this article..."}]
)

for partial in stream:
    print(partial)  # 逐步显示完整对象
    # Summary(title='...', key_points=['point 1'], score=None)
    # Summary(title='...', key_points=['point 1', 'point 2'], score=0.85)
```

## 三大方案对比

| 维度 | Outlines | LMQL | Instructor |
|------|----------|------|------------|
| **约束强度** | 硬约束（logits 层） | 硬约束（logits 层） | 软约束（重试） |
| **成功率** | 100% | 100% | ~99%（依赖重试） |
| **性能开销** | 低（FSM 编译一次） | 中（编译查询） | 高（可能多次 API 调用） |
| **适用模型** | 自建模型、vLLM、Ollama | 自建模型、部分 API | OpenAI、Anthropic、Cohere |
| **学习曲线** | 中 | 高（新语言） | 低（Python 原生） |
| **JSON Schema 支持** | ✅ 原生 | ✅ 原生 | ✅ Pydantic 转换 |
| **枚举约束** | ✅ | ✅ | ✅ Literal 类型 |
| **正则约束** | ✅ | ✅ | ❌ 需要 validator |
| **流式输出** | ⚠️ 有限 | ⚠️ 有限 | ✅ 完整支持 |
| **多轮对话** | ❌ 单次生成 | ✅ 原生支持 | ✅ 手动管理 |

## Laravel 集成实战

### 方案选择

在 Laravel 项目中，最常见的场景是调用商业 API（OpenAI、Anthropic、国内大模型），所以 **Instructor** 是最实用的选择。如果你用 Ollama 跑本地模型，Outlines 是更好的选择。

### 安装与配置

```bash
# Python 依赖
pip install instructor pydantic openai

# 或者用 Anthropic
pip install instructor anthropic
```

### Laravel + Instructor 微服务架构

把 Instructor 包装成一个独立的 Python 微服务，Laravel 通过 HTTP 调用：

```python
# app.py - FastAPI + Instructor 微服务
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import instructor
from openai import OpenAI
import os

app = FastAPI()
client = instructor.from_openai(OpenAI(api_key=os.getenv("OPENAI_API_KEY")))

# ====== 定义数据模型 ======

class SentimentResult(BaseModel):
    sentiment: Literal["positive", "negative", "neutral"] = Field(
        description="情感分类"
    )
    confidence: float = Field(ge=0, le=1, description="置信度 0-1")
    keywords: List[str] = Field(description="关键词列表")

class ProductInfo(BaseModel):
    name: str = Field(description="产品名称")
    category: str = Field(description="产品类别")
    price: Optional[float] = Field(None, description="价格")
    currency: Optional[str] = Field(None, description="货币")
    features: List[str] = Field(default_factory=list, description="产品特性")

class ExtractedEntity(BaseModel):
    text: str = Field(description="实体文本")
    entity_type: Literal["person", "org", "location", "product", "date"] = Field(
        description="实体类型"
    )
    start_pos: Optional[int] = Field(None, description="起始位置")

class NERResult(BaseModel):
    entities: List[ExtractedEntity] = Field(description="提取的实体列表")
    summary: str = Field(description="文本摘要")

# ====== API 端点 ======

@app.post("/api/extract/sentiment", response_model=SentimentResult)
async def extract_sentiment(text: str):
    """情感分析"""
    try:
        result = client.chat.completions.create(
            model="gpt-4o-mini",
            response_model=SentimentResult,
            max_retries=2,
            messages=[
                {"role": "system", "content": "分析用户输入文本的情感倾向。"},
                {"role": "user", "content": text}
            ]
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/extract/product", response_model=ProductInfo)
async def extract_product(text: str):
    """产品信息提取"""
    try:
        result = client.chat.completions.create(
            model="gpt-4o-mini",
            response_model=ProductInfo,
            max_retries=2,
            messages=[
                {"role": "system", "content": "从文本中提取产品信息。"},
                {"role": "user", "content": text}
            ]
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/extract/ner", response_model=NERResult)
async def extract_ner(text: str):
    """命名实体识别"""
    try:
        result = client.chat.completions.create(
            model="gpt-4o",
            response_model=NERResult,
            max_retries=2,
            messages=[
                {"role": "system", "content": "从文本中提取所有命名实体。"},
                {"role": "user", "content": text}
            ]
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### Laravel 调用端

```php
<?php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StructuredExtractionService
{
    private string $baseUrl;
    private int $timeout;

    public function __construct()
    {
        $this->baseUrl = config('services.llm_extractor.url', 'http://localhost:8000');
        $this->timeout = config('services.llm_extractor.timeout', 30);
    }

    /**
     * 情感分析
     */
    public function analyzeSentiment(string $text): array
    {
        return $this->call('/api/extract/sentiment', ['text' => $text]);
    }

    /**
     * 产品信息提取
     */
    public function extractProduct(string $text): array
    {
        return $this->call('/api/extract/product', ['text' => $text]);
    }

    /**
     * 命名实体识别
     */
    public function extractEntities(string $text): array
    {
        return $this->call('/api/extract/ner', ['text' => $text]);
    }

    /**
     * 通用调用方法
     */
    private function call(string $endpoint, array $data): array
    {
        try {
            $response = Http::timeout($this->timeout)
                ->post("{$this->baseUrl}{$endpoint}", $data);

            if ($response->successful()) {
                return $response->json();
            }

            Log::error('LLM extraction failed', [
                'endpoint' => $endpoint,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            throw new \RuntimeException("LLM extraction failed: {$response->body()}");

        } catch (\Exception $e) {
            Log::error('LLM service unavailable', [
                'endpoint' => $endpoint,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }
}
```

### 服务注册与配置

```php
// config/services.php
'llm_extractor' => [
    'url' => env('LLM_EXTRACTOR_URL', 'http://localhost:8000'),
    'timeout' => env('LLM_EXTRACTOR_TIMEOUT', 30),
],
```

```php
// app/Providers/AppServiceProvider.php
use App\Services\LLM\StructuredExtractionService;

$this->app->singleton(StructuredExtractionService::class, function ($app) {
    return new StructuredExtractionService();
});
```

### 在 Controller 中使用

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\LLM\StructuredExtractionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExtractionController extends Controller
{
    public function __construct(
        private StructuredExtractionService $extractor
    ) {}

    public function sentiment(Request $request): JsonResponse
    {
        $request->validate(['text' => 'required|string|max:5000']);

        $result = $this->extractor->analyzeSentiment($request->input('text'));

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }

    public function product(Request $request): JsonResponse
    {
        $request->validate(['text' => 'required|string|max:5000']);

        $result = $this->extractor->extractProduct($request->input('text'));

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }

    public function ner(Request $request): JsonResponse
    {
        $request->validate(['text' => 'required|string|max:10000']);

        $result = $this->extractor->extractEntities($request->input('text'));

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }
}
```

### 路由

```php
// routes/api.php
use App\Http\Controllers\Api\ExtractionController;

Route::prefix('extraction')->group(function () {
    Route::post('/sentiment', [ExtractionController::class, 'sentiment']);
    Route::post('/product', [ExtractionController::class, 'product']);
    Route::post('/ner', [ExtractionController::class, 'ner']);
});
```

### 纯 PHP 方案：直接调用 OpenAI Structured Output

如果你不想引入 Python 微服务，也可以在 PHP 中直接利用 OpenAI 的 Structured Output 功能：

```php
<?php

namespace App\Services\LLM;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OpenAIStructuredService
{
    private string $apiKey;
    private string $model;
    private string $baseUrl;

    public function __construct()
    {
        $this->apiKey = config('services.openai.api_key');
        $this->model = config('services.openai.model', 'gpt-4o-mini');
        $this->baseUrl = config('services.openai.base_url', 'https://api.openai.com/v1');
    }

    /**
     * 使用 Structured Output 提取结构化数据
     */
    public function extract(string $systemPrompt, string $userContent, array $jsonSchema): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->timeout(30)->post("{$this->baseUrl}/chat/completions", [
            'model' => $this->model,
            'messages' => [
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => $userContent],
            ],
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'extraction_result',
                    'strict' => true,
                    'schema' => $jsonSchema,
                ],
            ],
        ]);

        if (!$response->successful()) {
            Log::error('OpenAI API error', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException('OpenAI API call failed');
        }

        $content = $response->json('choices.0.message.content');
        return json_decode($content, true);
    }

    /**
     * 情感分析示例
     */
    public function analyzeSentiment(string $text): array
    {
        $schema = [
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
            'additionalProperties' => false,
        ];

        return $this->extract(
            '分析用户输入文本的情感倾向，返回结构化结果。',
            $text,
            $schema
        );
    }

    /**
     * 通用实体提取
     */
    public function extractEntities(string $text, array $entityTypes = ['person', 'org', 'location']): array
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'entities' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'text' => ['type' => 'string'],
                            'type' => [
                                'type' => 'string',
                                'enum' => $entityTypes,
                            ],
                            'confidence' => ['type' => 'number'],
                        ],
                        'required' => ['text', 'type', 'confidence'],
                        'additionalProperties' => false,
                    ],
                ],
                'summary' => ['type' => 'string'],
            ],
            'required' => ['entities', 'summary'],
            'additionalProperties' => false,
        ];

        return $this->extract(
            '从文本中提取命名实体。',
            $text,
            $schema
        );
    }
}
```

## 踩坑记录

### 坑 1：Outlines 与 vLLM 版本不兼容

Outlines 的 vLLM 集成经常因为版本更新而 break。解决方案：

```bash
# 固定版本组合
pip install outlines==0.1.1 vllm==0.6.3
# 不要无脑升级，先看 changelog
```

### 坑 2：LMQL 的 `where` 子句不支持复杂 Python 表达式

```python
# ❌ 错误：LMQL 的 where 是编译时约束，不能调用任意 Python
"[result]" where json.loads(result)["price"] > 0

# ✅ 正确：用内置约束函数
"[result]" where JSON(result, schema)
```

### 坑 3：Instructor 的 Pydantic v2 兼容性

```bash
# Pydantic v2 的 model_validator 和 field_validator 语法变了
# 确保 instructor >= 1.0.0
pip install "instructor>=1.0.0" "pydantic>=2.0.0"
```

### 坑 4：OpenAI Structured Output 的 `additionalProperties` 必须为 false

```python
# ❌ 错误：OpenAI 严格模式要求 additionalProperties: false
schema = {
    "type": "object",
    "properties": {"name": {"type": "string"}},
    # 缺少 additionalProperties: false
}

# ✅ 正确
schema = {
    "type": "object",
    "properties": {"name": {"type": "string"}},
    "required": ["name"],
    "additionalProperties": false,  # 必须有
}
```

### 坑 5：大 Schema 导致 token 浪费

JSON Schema 本身会占用大量 context。对于复杂 schema：

```python
# 方案 1：精简 schema，移除不必要的 description
# 方案 2：拆分多个小请求
# 方案 3：使用 OpenAI 的 strict: false 模式（但会降低约束强度）
```

### 坑 6：PHP 端 JSON 解析的类型陷阱

```php
// ❌ 坑：json_decode 默认返回混合类型
$result = json_decode($response, true);
$price = $result['price']; // 可能是 string "99" 而不是 float 99.0

// ✅ 正确：显式类型转换
$price = (float) ($result['price'] ?? 0);
$confidence = (float) ($result['confidence'] ?? 0);
```

## 总结

Structured Generation 不是可选的优化，而是生产级 LLM 应用的**必备能力**。没有它，你就要花大量时间写后处理逻辑、处理边界情况、写重试代码。

**选型建议：**

- **调用商业 API（OpenAI、Anthropic、国内大模型）** → 用 **Instructor**（Python）或直接用 OpenAI Structured Output（PHP）
- **自建模型推理（vLLM、Ollama、HuggingFace）** → 用 **Outlines**，100% 约束成功率
- **复杂多轮对话、交互式场景** → 用 **LMQL**，查询语言级别的约束表达力最强
- **Laravel 项目** → Python 微服务（FastAPI + Instructor）是最佳实践，纯 PHP 方案用 OpenAI Structured Output

记住核心原则：**能在 token 层约束的，不要在 prompt 层祈祷。**
