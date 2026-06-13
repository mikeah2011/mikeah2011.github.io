---
title: AI Agent Output Validation 实战：LLM 输出的多层校验——Regex/JSON Schema/Pydantic/业务规则的四重防线
keywords: [AI Agent Output Validation, LLM, Regex, JSON Schema, Pydantic, 输出的多层校验, 业务规则的四重防线, AI]
date: 2026-06-10 00:40:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - AI Agent
  - LLM
  - Output Validation
  - Pydantic
  - JSON Schema
  - Laravel
description: 系统讲解 AI Agent 输出校验的四层防线架构：正则快速过滤、JSON Schema 结构校验、Pydantic 类型绑定、业务规则语义验证，并提供 Laravel 实战集成方案。
---


## 概述

在 AI Agent 系统中，LLM 的输出天然带有不确定性。同一个 Prompt，GPT-4 可能返回格式不一致的 JSON，Claude 可能多出意料之外的字段，而更小的模型甚至可能返回完全不可解析的内容。如果直接把 LLM 输出塞进业务逻辑，轻则报错、重则数据污染。

**输出校验不是可选的，是必须的。**

本文构建四层防线：

| 层级 | 工具 | 职责 | 延迟 |
|------|------|------|------|
| 第一层 | Regex | 快速过滤明显格式错误 | <1ms |
| 第二层 | JSON Schema | 结构完整性校验 | 1-5ms |
| 第三层 | Pydantic / Laravel Validator | 类型绑定与默认值填充 | 5-20ms |
| 第四层 | 业务规则 | 语义正确性与边界检查 | 自定义 |

核心原则：**逐层收紧，每一层都可能拒绝输出并触发重试或降级**。

---

## 核心概念

### 为什么需要多层校验？

LLM 输出的问题可以分为四类：

1. **格式错误**：返回了 Markdown 代码块包裹的 JSON、多了注释、多了逗号
2. **结构缺失**：缺少必需字段、嵌套层级错误
3. **类型错误**：字符串当数字、数组当对象
4. **语义错误**：结构正确但内容不符合业务逻辑（比如金额为负数）

单层校验无法同时处理这四类问题。Regex 擅长第一类但对后三类无能为力；JSON Schema 能处理第二类但对类型细节不够严格；Pydantic 能绑定类型但不懂业务语义。四层防线是工程上的最优解。

### 校验策略模式

```
LLM Output → [Regex Gate] → [JSON Schema] → [Pydantic] → [Business Rules] → Validated Output
                    ↓              ↓              ↓              ↓
                  Retry        Retry/Fallback   Retry         Fallback to Default
```

每一层失败后的处理策略不同：
- **Regex 失败**：直接重试，调整 Prompt 提示格式要求
- **JSON Schema 失败**：修复结构后重试，或返回默认模板
- **Pydantic 失败**：类型转换 + 默认值填充，能修则修
- **业务规则失败**：触发 Fallback Chain，降级到安全默认值

---

## 实战代码

### 第一层：Regex 快速过滤

在调用任何 JSON 解析器之前，先用正则快速排除明显的问题输出。

```python
import re
import json
from typing import Optional, Tuple


class RegexGate:
    """第一层防线：快速格式过滤"""

    # 常见 LLM 输出格式问题
    PATTERNS = {
        # Markdown 代码块包裹的 JSON
        "code_block": re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL),
        # 行内代码
        "inline_code": re.compile(r"`(.*?)`", re.DOTALL),
        # 常见前缀废话
        "chatty_prefix": re.compile(
            r"^(Sure!|Here's|Here is|Okay,|Of course,|Let me).*?({|\[)",
            re.DOTALL | re.IGNORECASE,
        ),
        # 常见后缀废话
        "chatty_suffix": re.compile(
            r"({|\]}).*?(Let me know|Hope this helps|Do you have|Is there anything).*$",
            re.DOTALL | re.IGNORECASE,
        ),
        # 注释行（JSON 里不该有注释）
        "json_comments": re.compile(r"//.*$", re.MULTILINE),
        # 尾部逗号
        "trailing_comma": re.compile(r",\s*([}\]])"),
    }

    @classmethod
    def extract_json(cls, raw: str) -> Tuple[Optional[str], Optional[str]]:
        """
        从 LLM 原始输出中提取 JSON 字符串。
        返回 (cleaned_json, error_message)
        """
        text = raw.strip()

        # 尝试从 Markdown 代码块提取
        match = cls.PATTERNS["code_block"].search(text)
        if match:
            text = match.group(1).strip()

        # 尝试从行内代码提取
        match = cls.PATTERNS["inline_code"].search(text)
        if match and not cls.PATTERNS["code_block"].search(text):
            text = match.group(1).strip()

        # 去掉前缀废话
        text = cls.PATTERNS["chatty_prefix"].sub(lambda m: m.group(0)[m.group(0).index("{") if "{" in m.group(0) else m.group(0).index("["):], text)

        # 去掉后缀废话
        text = cls.PATTERNS["chatty_suffix"].sub(lambda m: m.group(1), text)

        # 去掉注释
        text = cls.PATTERNS["json_comments"].sub("", text)

        # 去掉尾部逗号
        text = cls.PATTERNS["trailing_comma"].sub(r"\1", text)

        text = text.strip()

        # 基本合法性检查
        if not text:
            return None, "Empty output after regex cleaning"

        if not (text.startswith("{") or text.startswith("[")):
            return None, f"Output doesn't start with JSON: {text[:50]}..."

        return text, None


# 使用示例
raw_output = """
Here's the extracted information:

```json
{
    "name": "张三",
    "email": "zhangsan@example.com",
    "age": 28,
    "tags": ["backend", "laravel"],
}
```

Hope this helps! Let me know if you need more.
"""

gate = RegexGate()
cleaned, error = gate.extract_json(raw_output)

if error:
    print(f"Regex gate failed: {error}")
else:
    data = json.loads(cleaned)
    print(f"Extracted: {data}")
    # {'name': '张三', 'email': 'zhangsan@example.com', 'age': 28, 'tags': ['backend', 'laravel']}
```

### 第二层：JSON Schema 结构校验

用 JSON Schema 验证结构完整性。这层在 Regex 通过后执行。

```python
import jsonschema
from jsonschema import validate, ValidationError


class SchemaValidator:
    """第二层防线：JSON Schema 结构校验"""

    # 用户信息提取的 Schema
    USER_EXTRACTION_SCHEMA = {
        "type": "object",
        "required": ["name", "email"],
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 100},
            "email": {"type": "string", "format": "email"},
            "age": {"type": "integer", "minimum": 0, "maximum": 150},
            "phone": {"type": "string", "pattern": r"^1[3-9]\d{9}$"},
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 20,
            },
            "address": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "district": {"type": "string"},
                },
                "required": ["city"],
            },
        },
        "additionalProperties": False,
    }

    @classmethod
    def validate(cls, data: dict, schema: dict = None) -> tuple[bool, str]:
        schema = schema or cls.USER_EXTRACTION_SCHEMA
        try:
            validate(instance=data, schema=schema)
            return True, "OK"
        except ValidationError as e:
            path = ".".join(str(p) for p in e.absolute_path) or "root"
            return False, f"Schema violation at {path}: {e.message}"


# 使用示例
data = {
    "name": "张三",
    "email": "not-an-email",  # 格式不对
    "age": -5,                # 范围不对
    "phone": "12345",         # 格式不对
    "tags": ["a"] * 25,       # 超过上限
    "unknown_field": "oops",  # 多余字段
}

ok, msg = SchemaValidator.validate(data)
print(f"Valid: {ok}, Error: {msg}")
# Valid: False, Error: Schema violation at email: 'not-an-email' is not a 'email'
```

在 Laravel 中，可以用 `laravel/json-schema` 或直接用 `symfony/validator`：

```php
<?php

namespace App\Services\Validation;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class LlmOutputValidator
{
    /**
     * 第二层防线：JSON Schema 结构校验（Laravel 版）
     */
    public static function validateUserExtraction(array $data): array
    {
        $validator = Validator::make($data, [
            'name'    => 'required|string|max:100',
            'email'   => 'required|email',
            'age'     => 'nullable|integer|min:0|max:150',
            'phone'   => 'nullable|regex:/^1[3-9]\d{9}$/',
            'tags'    => 'nullable|array|max:20',
            'tags.*'  => 'string',
            'address' => 'nullable|array',
            'address.city' => 'required_with:address|string',
        ]);

        if ($validator->fails()) {
            $errors = $validator->errors()->toArray();
            $firstError = collect($errors)->mapWithKeys(fn($msgs, $key) => [$key => $msgs[0]])->toArray();

            return [
                'valid'   => false,
                'errors'  => $firstError,
                'message' => collect($firstError)->implode('; '),
            ];
        }

        return ['valid' => true, 'data' => $validator->validated()];
    }
}
```

### 第三层：Pydantic 类型绑定

Pydantic 的强项在于类型强制转换和默认值填充。即使 JSON Schema 通过了，Pydantic 能进一步确保 Python 层的类型安全。

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
from datetime import datetime


class UserExtraction(BaseModel):
    """第三层防线：类型绑定与默认值"""

    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., pattern=r"^[^@]+@[^@]+\.[^@]+$")
    age: Optional[int] = Field(default=None, ge=0, le=150)
    phone: Optional[str] = Field(default=None, pattern=r"^1[3-9]\d{9}$")
    tags: list[str] = Field(default_factory=list, max_length=20)
    address: Optional[dict] = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    extracted_at: datetime = Field(default_factory=datetime.now)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower().strip()

    @field_validator("tags", mode="before")
    @classmethod
    def deduplicate_tags(cls, v):
        if isinstance(v, list):
            return list(dict.fromkeys(v))  # 保序去重
        return v

    @model_validator(mode="after")
    def check_confidence_threshold(self):
        if self.confidence < 0.5:
            # 低置信度时清空不确定的字段
            self.age = None
            self.phone = None
        return self

    class Config:
        str_strip_whitespace = True


# 使用示例 — Pydantic 会自动修复许多问题
raw_data = {
    "name": "  张三  ",           # 有空格 → strip
    "Email": "ZhangSan@QQ.COM",  # 大写 + key 大写
    "age": "28",                  # 字符串 → 自动转 int
    "phone": 13800138000,         # 数字 → 转字符串
    "tags": ["laravel", "laravel", "python"],  # 重复 → 去重
    "confidence": 0.3,            # 低置信度 → 清空不确定字段
}

user = UserExtraction(**raw_data)
print(user.model_dump_json(indent=2))
# {
#   "name": "张三",
#   "email": "zhangsan@qq.com",
#   "age": null,
#   "phone": null,
#   "tags": ["laravel", "python"],
#   "address": null,
#   "confidence": 0.3,
#   "extracted_at": "2026-06-10T00:40:00"
# }
```

### 第四层：业务规则验证

业务规则是最个性化的层。结构正确不代表业务正确。

```python
from enum import Enum


class BusinessRule:
    """第四层防线：业务规则验证"""

    # 规则注册表
    _rules: list = []

    @classmethod
    def register(cls, rule_fn, description: str):
        cls._rules.append({"fn": rule_fn, "desc": description})
        return rule_fn

    @classmethod
    def validate(cls, data: dict) -> tuple[bool, list[str]]:
        errors = []
        for rule in cls._rules:
            ok, err = rule["fn"](data)
            if not ok:
                errors.append(f"[{rule['desc']}] {err}")
        return len(errors) == 0, errors


@BusinessRule.register
def email_not_disposable(data: dict) -> tuple[bool, str]:
    """禁止临时邮箱"""
    disposable_domains = {"tempmail.com", "throwaway.email", "guerrillamail.com"}
    email = data.get("email", "")
    domain = email.split("@")[-1] if "@" in email else ""
    if domain in disposable_domains:
        return False, f"Disposable email domain: {domain}"
    return True, ""


@BusinessRule.register
def tags_match_allowed_list(data: dict) -> tuple[bool, str]:
    """标签必须在白名单内"""
    allowed = {"backend", "frontend", "devops", "ai", "database", "security"}
    tags = data.get("tags", [])
    invalid = [t for t in tags if t not in allowed]
    if invalid:
        return False, f"Invalid tags: {invalid}. Allowed: {allowed}"
    return True, ""


@BusinessRule.register
def age_reasonable_for_context(data: dict) -> tuple[bool, str]:
    """年龄在合理范围内"""
    age = data.get("age")
    if age is not None and age > 120:
        return False, f"Age {age} is unreasonable"
    return True, ""


# 使用示例
data = {
    "name": "张三",
    "email": "zhang@tempmail.com",  # 违反规则 1
    "age": 150,                     # 违反规则 3
    "tags": ["backend", "hacking"], # 违反规则 2
}

ok, errors = BusinessRule.validate(data)
if not ok:
    print("Business rule violations:")
    for err in errors:
        print(f"  ❌ {err}")
```

### 完整集成：四层防线串联

```python
from dataclasses import dataclass
from typing import Optional


@dataclass
class ValidationResult:
    success: bool
    data: Optional[dict] = None
    layer: Optional[str] = None  # 在哪一层失败的
    errors: Optional[list[str]] = None
    retries: int = 0


class OutputValidationPipeline:
    """四层防线完整管道"""

    def __init__(self, max_retries: int = 2):
        self.regex_gate = RegexGate
        self.schema_validator = SchemaValidator
        self.max_retries = max_retries

    def validate(self, raw_output: str) -> ValidationResult:
        retries = 0

        while retries <= self.max_retries:
            # 第一层：Regex
            cleaned, error = self.regex_gate.extract_json(raw_output)
            if error:
                retries += 1
                if retries > self.max_retries:
                    return ValidationResult(
                        success=False,
                        layer="regex",
                        errors=[error],
                        retries=retries,
                    )
                continue

            # 第二层：JSON Schema
            try:
                data = json.loads(cleaned)
            except json.JSONDecodeError as e:
                retries += 1
                continue

            ok, msg = self.schema_validator.validate(data)
            if not ok:
                retries += 1
                continue

            # 第三层：Pydantic（类型绑定）
            try:
                user = UserExtraction(**data)
                data = user.model_dump()
            except Exception as e:
                retries += 1
                continue

            # 第四层：业务规则
            ok, errors = BusinessRule.validate(data)
            if not ok:
                # 业务规则失败不一定重试，可能需要降级
                return ValidationResult(
                    success=False,
                    layer="business",
                    errors=errors,
                    retries=retries,
                )

            return ValidationResult(
                success=True,
                data=data,
                retries=retries,
            )

        return ValidationResult(
            success=False,
            layer="max_retries",
            errors=["Exceeded max retries"],
            retries=retries,
        )


# 使用
pipeline = OutputValidationPipeline(max_retries=2)
result = pipeline.validate(raw_output)

if result.success:
    print(f"Validated in {result.retries} retries: {result.data}")
else:
    print(f"Failed at {result.layer}: {result.errors}")
```

### Laravel 集成：完整的验证服务

```php
<?php

namespace App\Services\LLM;

use App\Services\Validation\LlmOutputValidator;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class LlmOutputValidationService
{
    private int $maxRetries;
    private LlmOutputValidator $validator;

    public function __construct(int $maxRetries = 2)
    {
        $this->maxRetries = $maxRetries;
        $this->validator = new LlmOutputValidator();
    }

    /**
     * 四层防线完整验证
     */
    public function validate(string $rawOutput, string $schema = 'user_extraction'): array
    {
        $retries = 0;

        while ($retries <= $this->maxRetries) {
            // 第一层：Regex 清洗
            $cleaned = $this->regexGate($rawOutput);
            if ($cleaned === null) {
                $retries++;
                continue;
            }

            // 第二层：JSON 解析 + Schema 校验
            $data = json_decode($cleaned, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                $retries++;
                continue;
            }

            $result = LlmOutputValidator::validateUserExtraction($data);
            if (!$result['valid']) {
                $retries++;
                continue;
            }

            $data = $result['data'];

            // 第三层：类型转换（Laravel 自带）
            $data = $this->castTypes($data);

            // 第四层：业务规则
            $businessResult = $this->validateBusinessRules($data);
            if (!$businessResult['valid']) {
                return [
                    'success' => false,
                    'layer'   => 'business',
                    'errors'  => $businessResult['errors'],
                    'retries' => $retries,
                ];
            }

            return [
                'success' => true,
                'data'    => $data,
                'retries' => $retries,
            ];
        }

        return [
            'success' => false,
            'layer'   => 'max_retries',
            'errors'  => ['Exceeded max retries'],
            'retries' => $retries,
        ];
    }

    private function regexGate(?string $raw): ?string
    {
        if (empty($raw)) return null;

        $text = trim($raw);

        // 提取 Markdown 代码块
        if (preg_match('/```(?:json)?\s*\n?(.*?)\n?\s*```/s', $text, $m)) {
            $text = trim($m[1]);
        }

        // 去掉前缀废话
        $text = preg_replace('/^(Sure!|Here\'?s?|Okay,|Of course,|Let me).*?({|\[)/s', '$2', $text);

        // 去掉尾部逗号
        $text = preg_replace('/,\s*([}\]])/', '$1', $text);

        $text = trim($text);

        if (empty($text) || !in_array($text[0], ['{', '['])) {
            return null;
        }

        return $text;
    }

    private function castTypes(array $data): array
    {
        // 确保 age 是整数
        if (isset($data['age'])) {
            $data['age'] = (int) $data['age'];
        }

        // phone 转字符串
        if (isset($data['phone'])) {
            $data['phone'] = (string) $data['phone'];
        }

        // tags 去重
        if (isset($data['tags']) && is_array($data['tags'])) {
            $data['tags'] = array_values(array_unique($data['tags']));
        }

        return $data;
    }

    private function validateBusinessRules(array $data): array
    {
        $errors = [];

        // 规则 1：禁止临时邮箱
        $disposableDomains = ['tempmail.com', 'throwaway.email'];
        if (!empty($data['email'])) {
            $domain = substr(strrchr($data['email'], '@'), 1);
            if (in_array($domain, $disposableDomains)) {
                $errors[] = "Disposable email: {$data['email']}";
            }
        }

        // 规则 2：年龄合理性
        if (isset($data['age']) && $data['age'] > 120) {
            $errors[] = "Unreasonable age: {$data['age']}";
        }

        // 规则 3：标签白名单
        $allowedTags = ['backend', 'frontend', 'devops', 'ai', 'database', 'security'];
        if (isset($data['tags'])) {
            $invalid = array_diff($data['tags'], $allowedTags);
            if (!empty($invalid)) {
                $errors[] = "Invalid tags: " . implode(', ', $invalid);
            }
        }

        return [
            'valid'  => empty($errors),
            'errors' => $errors,
        ];
    }
}

// Controller 调用
class AiAgentController extends Controller
{
    public function extractUserInfo(Request $request)
    {
        $llmOutput = $request->input('llm_output');

        $service = new LlmOutputValidationService(maxRetries: 2);
        $result = $service->validate($llmOutput);

        if (!$result['success']) {
            Log::warning('LLM output validation failed', [
                'layer'   => $result['layer'],
                'errors'  => $result['errors'],
                'retries' => $result['retries'],
            ]);

            // 根据失败层级决定降级策略
            return match ($result['layer']) {
                'business' => response()->json([
                    'error' => 'LLM output violates business rules',
                    'errors' => $result['errors'],
                    'fallback' => 'using_cached_data',
                ], 422),
                default => response()->json([
                    'error' => 'LLM output format invalid after retries',
                ], 422),
            };
        }

        return response()->json([
            'data' => $result['data'],
            'meta' => ['retries' => $result['retries']],
        ]);
    }
}
```

---

## 踩坑记录

### 坑 1：正则贪婪匹配导致 JSON 被截断

```python
# 错误：.*? 在嵌套 JSON 时仍然可能贪婪
re.search(r'```json\n(.*)\n```', text, re.DOTALL)

# 正确：用非贪婪 + 明确的结束标记
re.search(r'```json\n(.*?)\n```', text, re.DOTALL)
# 或者更保险：匹配最后一个 ```
```

### 坑 2：Pydantic 的 Optional 字段默认值陷阱

```python
# 错误：age=0 会被 None 覆盖
class Bad(BaseModel):
    age: Optional[int] = Field(default=None)

# 正确：如果 0 是合法值，用 sentinel pattern
class Good(BaseModel):
    age: Optional[int] = None
    # 或者用 Union 区分 "未提供" 和 "值为 0"
```

### 坑 3：业务规则和 Schema 校验的职责混淆

常见错误是把业务逻辑塞进 JSON Schema：

```python
# 错误：Schema 不该管业务语义
{
    "email": {
        "type": "string",
        "not": {"pattern": ".*@tempmail\\.com$"}  # 业务规则不该在这里
    }
}

# 正确：Schema 只管结构，业务规则独立
# Schema:
{"email": {"type": "string", "format": "email"}}
# 业务规则层单独检查 tempmail
```

### 坑 4：重试时 Prompt 没有携带上次的错误信息

```python
# 错误：盲目重试
for i in range(max_retries):
    output = llm.generate(prompt)
    if validate(output):
        break

# 正确：把错误反馈给 LLM
for i in range(max_retries):
    output = llm.generate(prompt)
    ok, errors = validate(output)
    if ok:
        break
    prompt = f"""{original_prompt}

Your previous output had errors:
{errors}

Please fix and output valid JSON only."""

```

### 坑 5：并发场景下的校验管道线程安全

Pydantic 的 `model_validator` 如果有副作用（比如写日志），在并发场景下会出问题。确保校验管道是无状态的，或者用锁保护。

---

## 总结

四层防线的核心思想是**纵深防御**：

1. **Regex** — 最快的过滤，处理 LLM 最常见的格式问题（Markdown 包裹、废话前后缀）
2. **JSON Schema** — 结构校验，确保输出符合预期的字段和类型约束
3. **Pydantic/Laravel Validator** — 类型绑定、默认值填充、数据标准化
4. **业务规则** — 最后一道门，确保数据符合业务语义

每一层都独立可测试、独立可替换。在 Laravel 项目中，建议把这四层封装成一个 `LlmOutputValidationService`，所有调用 LLM 的地方统一走这个管道。

**关键原则：不要信任 LLM 的输出，但也不要对每次输出都跑全量校验。** 根据场景选择合适的防线深度——高风险场景（支付、用户数据）四层全开，低风险场景（摘要生成、标签分类）可以只跑前两层。
