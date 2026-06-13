---

title: Prompt Template 工程化实战：Jinja2/Mustache/Laravel Blade 模板驱动的系统化 Prompt 管理与 A/B
keywords: [Prompt Template, Jinja2, Mustache, Laravel Blade, Prompt, 工程化实战, 模板驱动的系统化, 管理与]
date: 2026-06-06 08:00:00
description: 深入讲解 Prompt Template 工程化实战，系统对比 Jinja2、Mustache/Handlebars、Laravel Blade 三大模板引擎在 Prompt 管理中的应用。涵盖变量注入、条件分支、版本管理与 A/B 测试框架设计，提供完整的 Python/PHP 可运行代码示例。适合需要将 Prompt 从硬编码字符串升级为可维护、可测试、可回滚工程资产的 AI 应用开发者参考。
tags:
- Prompt Engineering
- Prompt Template
- Jinja2
- Blade
- A/B Testing
- 模板引擎
- 版本管理
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



## 前言

当你的 AI 应用只有一个 prompt、一个模型调用时，直接把字符串拼接写在代码里完全可行。但当你的系统需要支持：**数十种场景、多语言、多模型、多版本 Prompt、实时 A/B 测试、热更新与回滚**——原始字符串拼接方式会迅速崩溃。

本文将从工程实践出发，系统介绍如何使用 **Jinja2**（Python 生态）、**Mustache**（跨语言 Logic-less 模板）和 **Laravel Blade**（PHP 生态）三大模板引擎来驱动 Prompt 的工程化管理，并构建完整的 A/B 测试框架。

---

## 一、为什么原始字符串 Prompt 不可维护？

### 1.1 典型的反面模式

```python
# ❌ 典型的硬编码 prompt 模式
def get_product_description(product_name, style, audience):
    prompt = f"""你是一个{style}风格的文案写手。请为以下产品撰写面向{audience}的产品描述：
产品名称：{product_name}
要求：简洁有力，突出核心卖点，不超过100字。"""
    return llm_client.complete(prompt)
```

这段代码在 MVP 阶段完全可以工作，但它有以下致命问题：

- **内容与逻辑耦合**：Prompt 文本散落在业务代码中，修改需要重新部署
- **无法版本化**：没有 `git diff` 能清晰展示两个 prompt 版本之间的差异
- **无条件分支**：当需要根据 `audience` 的不同（如 B2B vs B2C）切换完全不同的 prompt 结构时，`if-else` 拼接将变得不可维护
- **无法做 A/B 测试**：替换 prompt 需要改代码，无法运行时动态切换
- **团队协作困难**：产品经理或内容运营无法直接编辑 prompt

### 1.2 Prompt 工程化的核心目标

| 目标 | 说明 |
|------|------|
| **模板与代码分离** | Prompt 模板独立存储，不嵌入业务逻辑代码 |
| **变量注入标准化** | 统一的变量占位符和渲染引擎 |
| **条件分支模板化** | 复杂的 prompt 逻辑通过模板语法表达 |
| **版本管理** | 每次 prompt 变更有据可查、可回滚 |
| **A/B 测试就绪** | 支持多变体并行测试，数据驱动决策 |

---

## 二、三大模板引擎对比

### 2.1 Jinja2（Python 生态）

Jinja2 是 Python 中最成熟的模板引擎，Flask 的默认模板引擎。它的表达能力强，支持宏（macro）、继承（extends）、过滤器（filter）等高级特性。

**核心语法**：

```jinja2
{# 变量注入 #}
你是一个{{ role }}。请用{{ language }}回答用户的问题。

{# 条件分支 #}
{% if audience == "enterprise" %}
你面向的是企业级客户，请使用专业术语，强调 ROI 和合规性。
{% elif audience == "consumer" %}
你面向的是普通消费者，请使用通俗易懂的语言。
{% endif %}

{# 循环 #}
{% for item in constraints %}
- {{ item }}
{% endfor %}

{# 过滤器 #}
用户输入：{{ user_input | truncate(500) }}
```

**Python 渲染代码**：

```python
from jinja2 import Environment, FileSystemLoader

env = Environment(loader=FileSystemLoader("prompts/templates"))
template = env.get_template("product_copy.j2")

rendered = template.render(
    role="资深文案写手",
    language="中文",
    audience="enterprise",
    product_name="CloudSync Pro",
    constraints=["不超过200字", "突出数据安全", "包含CTA"],
    user_input=user_message
)
```

**优势**：表达力最强，支持宏复用，社区生态丰富。
**劣势**：仅限 Python 生态，宏可嵌套过深导致模板难以理解。

### 2.2 Mustache / Handlebars（跨语言）

Mustache 是 Logic-less 模板的代表——它刻意不支持复杂逻辑（没有 `if-else` 的 else 分支、没有计算表达式），这在 Prompt 管理中反而是一个优势：**模板必须保持简单，复杂逻辑必须在渲染前由代码层处理**。

Handlebars 是 Mustache 的超集，增加了 `helper` 机制。

**核心语法（Handlebars）**：

```handlebars
你是一个{{role}}。

{{#if isDetailed}}
请提供详细的分析，包含数据支持和案例引用。
{{else}}
请提供简洁的总结，不超过3个要点。
{{/if}}

{{#each examples}}
- 输入：{{this.input}} → 期望输出：{{this.output}}
{{/each}}
```

**跨语言渲染（以 Node.js 为例）**：

```javascript
const Handlebars = require('handlebars');
const fs = require('fs');

const source = fs.readFileSync('prompts/templates/analysis.hbs', 'utf8');
const template = Handlebars.compile(source);

const result = template({
    role: '数据分析师',
    isDetailed: true,
    examples: [
        { input: 'Q3营收', output: '同比增长23%' },
        { input: '用户留存', output: '7日留存率45%' }
    ]
});
```

**优势**：跨语言（JS/Python/PHP/Ruby/Go 均有实现），模板约束性强。
**劣势**：表达力有限，复杂条件需要在代码层预处理上下文。

### 2.3 Laravel Blade（PHP 生态）

Blade 是 Laravel 框架的模板引擎，语法简洁且与 PHP 完全兼容。对于 PHP 技术栈的团队，它是 Prompt 管理的天然选择。

**核心语法**：

```blade
你是一个{{ $role }}。

@if($mode === 'creative')
请发挥创意，不要局限于常规表达。
@elseif($mode === 'precise')
请严格基于提供的数据回答，不要臆测。
@endif

@isset($referenceDocs)
参考资料：
@foreach($referenceDocs as $doc)
{{ $loop->iteration }}. {{ $doc['title'] }} - {{ $doc['url'] }}
@endforeach
@endisset

@component('prompts.components.format_instruction')
    @slot('format'){{ $outputFormat }}@endslot
@endcomponent
```

**PHP 渲染代码**：

```php
use Illuminate\View\Factory;

class PromptRenderer
{
    public function __construct(
        private Factory $viewFactory,
        private PromptRepository $repository
    ) {}

    public function render(string $templateName, array $variables): string
    {
        return $this->viewFactory
            ->file("prompts/{$templateName}.blade.php")
            ->with($variables)
            ->render();
    }
}
```

**优势**：与 Laravel 生态深度集成，支持 Blade 组件复用。
**劣势**：仅限 PHP 生态，需要 Laravel 框架支撑。

### 2.4 选型决策矩阵

| 维度 | Jinja2 | Mustache/Handlebars | Laravel Blade |
|------|--------|-------------------|---------------|
| 语言支持 | Python 为主 | 跨语言（20+） | PHP 为主 |
| 表达能力 | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| 学习曲线 | 中等 | 低 | 低（需 Laravel） |
| 模板约束 | 弱（可写复杂逻辑） | 强（Logic-less） | 中等 |
| 适合场景 | Python 重度项目 | 多语言团队 | PHP/Laravel 项目 |
| Prompt 复用 | Jinja2 Macro | Partial / Helper | Blade Component |

**建议**：选择团队已有技术栈中最成熟的方案。Prompt 模板引擎不是越强大越好——恰恰相反，**适度的约束（如 Mustache 的 Logic-less）可以防止模板中隐藏过多业务逻辑**。

---

## 三、变量注入与条件逻辑的最佳实践

### 3.1 变量分层设计

在实际工程中，Prompt 变量应分为三层：

```yaml
# prompts/config/variables_schema.yaml
system_variables:      # 系统层：由代码自动注入
  - model_name
  - timestamp
  - user_tier
  - rate_limit_remaining

template_variables:    # 模板层：由模板开发者定义默认值
  - role
  - language
  - output_format
  - max_tokens_hint

business_variables:    # 业务层：由调用方传入
  - product_name
  - user_input
  - context_docs
```

在 Jinja2 中，可以通过 `defaults` 过滤器安全地处理缺失变量：

```jinja2
{# 安全的变量注入，提供默认值 #}
你的角色是{{ role | default('通用助手') }}。
语言偏好：{{ language | default('中文') }}。

{# 严格模式下，缺失变量应抛出错误 #}
{% if strict_mode and not user_input %}
  {{ raise("user_input is required in strict mode") }}
{% endif %}
```

### 3.2 条件逻辑模板化实战

一个真实场景：根据用户意图分类路由到不同的 prompt 分支。

```jinja2
{# Jinja2: 意图路由 prompt 模板 #}
{% macro intent_router(user_input) %}
用户说：{{ user_input }}

{% set intent = classify_intent(user_input) %}  {# 自定义 filter #}

{% if intent == "purchase" %}
请引导用户完成购买流程，提供产品对比和优惠信息。
{% elif intent == "complaint" %}
请以同理心回应，先确认问题，再提供解决方案。
给出工单编号：{{ ticket_id | default('待生成') }}
{% elif intent == "technical" %}
请检索技术文档：
{% for doc in technical_docs[:3] %}
- {{ doc.title }}：{{ doc.summary }}
{% endfor %}
{% else %}
请友好地询问用户的具体需求。
{% endif %}
{% endmacro %}
```

在 Mustache 中，由于 Logic-less 的设计，同样的逻辑需要在代码层处理：

```python
# Python: Mustache 代码层预处理
def build_context(user_input):
    intent = classify_intent(user_input)
    context = {
        "user_input": user_input,
        "intent": intent,
        # 将 if-else 逻辑转化为布尔标志
        "is_purchase": intent == "purchase",
        "is_complaint": intent == "complaint",
        "is_technical": intent == "technical",
        "is_unknown": intent not in ("purchase", "complaint", "technical"),
    }
    if intent == "technical":
        context["technical_docs"] = retrieve_docs(user_input)[:3]
    return context
```

对应的 Mustache 模板：

```handlebars
用户说：{{user_input}}

{{#is_purchase}}
请引导用户完成购买流程，提供产品对比和优惠信息。
{{/is_purchase}}

{{#is_complaint}}
请以同理心回应，先确认问题，再提供解决方案。工单编号：{{#ticket_id}}{{ticket_id}}{{/ticket_id}}{{^ticket_id}}待生成{{/ticket_id}}
{{/is_complaint}}

{{#is_technical}}
请检索技术文档：
{{#technical_docs}}
- {{title}}：{{summary}}
{{/technical_docs}}
{{/is_technical}}
```

**关键洞察**：Mustache 的 Logic-less 设计强制你将决策逻辑放在代码中（可测试、可调试），而非隐藏在模板中（难以测试）。

---

## 四、Prompt 版本管理与 A/B 测试框架

### 4.1 版本管理方案

#### 方案一：Git 原生版本管理

最简单且最推荐的方案：将 prompt 模板文件纳入 Git 管理。

```
prompts/
├── templates/
│   ├── product_copy/
│   │   ├── v1.j2              # 版本 1
│   │   ├── v2.j2              # 版本 2（当前活跃）
│   │   └── variants/
│   │       ├── creative.j2    # 创意风格变体
│   │       └── formal.j2      # 正式风格变体
│   ├── intent_router/
│   │   └── v3.j2
│   └── components/
│       ├── format_instruction.j2
│       └── safety_guard.j2
├── config/
│   ├── routing.yaml            # 模板路由配置
│   └── ab_experiments.yaml     # A/B 实验配置
└── CHANGELOG.md                # Prompt 变更日志
```

`routing.yaml` 配置文件：

```yaml
prompts:
  product_copy:
    active_version: v2
    fallback_version: v1
    variants:
      creative:
        weight: 0.3
        template: product_copy/variants/creative.j2
      formal:
        weight: 0.7
        template: product_copy/variants/formal.j2

  intent_router:
    active_version: v3
    fallback_version: v2
    variants: {}
```

#### 方案二：数据库 + 模板引擎

对于需要运行时热更新的场景，可以将模板存储在数据库中：

```php
// Laravel: 数据库存储的 Prompt 模板
class PromptTemplate extends Model
{
    protected $fillable = [
        'name',           // 如 'product_copy'
        'version',        // 版本号，如 'v2.1.0'
        'content',        // Blade 模板内容
        'engine',         // 'blade' | 'mustache' | 'jinja2'
        'is_active',      // 是否为当前活跃版本
        'variables_schema', // JSON Schema 定义输入变量
        'rollback_target',  // 回滚目标版本
    ];

    public function experiments(): HasMany
    {
        return $this->hasMany(ABExperiment::class);
    }
}
```

### 4.2 A/B 测试框架设计

#### 核心架构

```
用户请求 → AB Router → 权重分配 → 模板渲染 → LLM 调用 → 结果记录
                                              ↓
                                       指标采集（质量分/延迟/成本）
                                              ↓
                                       统计分析（显著性检验）
                                              ↓
                                       决策：优胜版本上线
```

#### Python 实现：A/B 测试引擎

```python
import hashlib
import time
from dataclasses import dataclass, field
from typing import Optional
from jinja2 import Environment, FileSystemLoader

@dataclass
class ExperimentVariant:
    name: str
    template_path: str
    weight: float  # 0.0 - 1.0
    metadata: dict = field(default_factory=dict)

@dataclass
class ExperimentConfig:
    experiment_id: str
    prompt_name: str
    variants: list[ExperimentVariant]
    metrics: list[str] = field(default_factory=lambda: ["quality_score", "latency_ms"])
    min_sample_size: int = 100
    significance_level: float = 0.05

class PromptABRouter:
    def __init__(self, env: Environment, experiments: dict[str, ExperimentConfig]):
        self.env = env
        self.experiments = experiments
        self.results_db = []  # 实际项目中使用数据库

    def route(self, prompt_name: str, variables: dict, user_id: str) -> tuple[str, dict]:
        """路由到对应的实验变体，返回渲染后的 prompt 和实验元数据"""
        experiment = self.experiments.get(prompt_name)
        if not experiment:
            template = self.env.get_template(f"{prompt_name}.j2")
            return template.render(**variables), {"variant": "default"}

        # 基于用户 ID 的一致性哈希分流
        variant = self._assign_variant(experiment, user_id)
        template = self.env.get_template(variant.template_path)
        rendered = template.render(**variables)

        experiment_meta = {
            "experiment_id": experiment.experiment_id,
            "variant": variant.name,
            "assigned_at": time.time(),
        }
        return rendered, experiment_meta

    def _assign_variant(self, experiment: ExperimentConfig, user_id: str) -> ExperimentVariant:
        """一致性哈希：同一用户始终分配到同一变体"""
        hash_input = f"{experiment.experiment_id}:{user_id}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16) % 10000 / 10000.0

        cumulative = 0.0
        for variant in experiment.variants:
            cumulative += variant.weight
            if hash_value < cumulative:
                return variant
        return experiment.variants[-1]

    def record_result(self, experiment_id: str, variant: str, user_id: str, metrics: dict):
        """记录实验结果"""
        self.results_db.append({
            "experiment_id": experiment_id,
            "variant": variant,
            "user_id": user_id,
            "metrics": metrics,
            "timestamp": time.time(),
        })

# 使用示例
env = Environment(loader=FileSystemLoader("prompts/templates"))
experiments = {
    "product_copy": ExperimentConfig(
        experiment_id="exp_001",
        prompt_name="product_copy",
        variants=[
            ExperimentVariant("creative", "product_copy/variants/creative.j2", 0.3),
            ExperimentVariant("formal", "product_copy/variants/formal.j2", 0.7),
        ],
    )
}

router = PromptABRouter(env, experiments)
prompt, meta = router.route("product_copy", {"product_name": "CloudSync Pro"}, user_id="u_12345")

# 调用 LLM
response = llm_client.complete(prompt)

# 记录结果
router.record_result(meta["experiment_id"], meta["variant"], "u_12345", {
    "quality_score": evaluate_quality(response),
    "latency_ms": response.latency_ms,
    "token_count": response.usage.total_tokens,
})
```

#### 统计显著性检验

```python
from scipy import stats
import numpy as np

def analyze_experiment(results: list[dict], experiment_id: str) -> dict:
    """分析 A/B 实验结果的统计显著性"""
    # 按变体分组
    groups = {}
    for r in results:
        if r["experiment_id"] != experiment_id:
            continue
        variant = r["variant"]
        groups.setdefault(variant, []).append(r["metrics"]["quality_score"])

    if len(groups) < 2:
        return {"status": "insufficient_variants"}

    variant_names = list(groups.keys())
    # 假设双变体场景，使用 t 检验
    control = np.array(groups[variant_names[0]])
    treatment = np.array(groups[variant_names[1]])

    if len(control) < 30 or len(treatment) < 30:
        return {"status": "insufficient_samples", "min_required": 30}

    t_stat, p_value = stats.ttest_ind(control, treatment)
    effect_size = (treatment.mean() - control.mean()) / np.sqrt(
        (control.std() ** 2 + treatment.std() ** 2) / 2
    )

    return {
        "control": {"name": variant_names[0], "mean": control.mean(), "n": len(control)},
        "treatment": {"name": variant_names[1], "mean": treatment.mean(), "n": len(treatment)},
        "p_value": p_value,
        "is_significant": p_value < 0.05,
        "effect_size_cohens_d": effect_size,
        "recommendation": "adopt_treatment" if p_value < 0.05 and effect_size > 0 else "keep_control",
    }
```

---

## 五、Laravel 服务层集成实战

### 5.1 完整的 Prompt 服务层

```php
<?php

namespace App\Services\Prompt;

use App\Models\PromptTemplate;
use App\Models\ABExperiment;
use Illuminate\Support\Facades\Cache;

class PromptService
{
    public function __construct(
        private PromptRenderer $renderer,
        private ABRouter $abRouter,
        private MetricsCollector $metrics
    ) {}

    /**
     * 渲染 Prompt 并记录 A/B 实验
     */
    public function render(string $name, array $variables, ?string $userId = null): PromptResult
    {
        // 1. 获取活跃实验配置
        $experiment = ABExperiment::where('prompt_name', $name)
            ->where('is_active', true)
            ->first();

        // 2. 确定变体
        $variant = $experiment
            ? $this->abRouter->assign($experiment, $userId ?? 'anonymous')
            : 'default';

        // 3. 获取模板（带缓存）
        $template = $this->getTemplate($name, $variant);

        // 4. 渲染
        $rendered = $this->renderer->render($template, $variables);

        // 5. 记录分配
        if ($experiment) {
            $this->metrics->recordAssignment($experiment->id, $variant, $userId);
        }

        return new PromptResult(
            content: $rendered,
            templateId: $template->id,
            variant: $variant,
            experimentId: $experiment?->id
        );
    }

    /**
     * 记录 Prompt 效果指标
     */
    public function recordMetrics(
        string $promptResultId,
        float $qualityScore,
        int $latencyMs,
        int $tokenCount
    ): void {
        $this->metrics->record([
            'prompt_result_id' => $promptResultId,
            'quality_score' => $qualityScore,
            'latency_ms' => $latencyMs,
            'token_count' => $tokenCount,
        ]);
    }

    private function getTemplate(string $name, string $variant): PromptTemplate
    {
        $cacheKey = "prompt:{$name}:{$variant}";

        return Cache::tags(['prompts'])->remember($cacheKey, 300, function () use ($name, $variant) {
            return PromptTemplate::where('name', $name)
                ->where('variant', $variant)
                ->where('is_active', true)
                ->latest('version')
                ->firstOrFail();
        });
    }
}
```

### 5.2 Blade 组件化 Prompt 片段

将可复用的 prompt 片段封装为 Blade 组件：

```php
{{-- resources/views/prompts/components/safety_guard.blade.php --}}
你必须遵守以下安全准则：
1. 不生成有害、违法或误导性内容
2. 拒绝回答涉及个人隐私的请求
3. 对不确定的事实标注"未验证"
@if($strictMode ?? false)
4. 任何违规请求请直接回复"无法回答此问题"
@endif
```

```php
{{-- resources/views/prompts/product_copy.blade.php --}}
你是一名{{ $role ?? '资深文案策划' }}。

@include('prompts.components.safety_guard', ['strictMode' => true])

任务：为以下产品撰写{{ $language ?? '中文' }}产品描述。
产品名称：{{ $productName }}
产品类目：{{ $category }}

@if(isset($targetAudience))
目标受众：{{ $targetAudience }}
请根据受众特征调整用语风格和重点卖点。
@endif

@isset($referenceCopy)
参考风格：
@foreach($referenceCopy as $ref)
「{{ $ref }}」
@endforeach
@endisset

输出要求：
- 字数控制在{{ $minWords ?? 80 }}-{{ $maxWords ?? 150 }}字
- 格式：纯文本，无 Markdown
```

在控制器中使用：

```php
class ProductCopyController extends Controller
{
    public function store(Request $request, PromptService $promptService, LlmClient $llm)
    {
        $result = $promptService->render('product_copy', [
            'productName' => $request->input('product_name'),
            'category' => $request->input('category'),
            'targetAudience' => $request->input('audience'),
            'language' => $request->input('lang', '中文'),
        ], userId: auth()->id());

        $response = $llm->complete($result->content);

        $promptService->recordMetrics(
            $result->id,
            qualityScore: $this->evaluateQuality($response),
            latencyMs: $response->latencyMs,
            tokenCount: $response->usage->totalTokens,
        );

        return response()->json(['copy' => $response->text]);
    }
}
```

---

## 六、最佳实践总结

### 6.1 Prompt 模板设计原则

1. **单一职责**：一个模板只负责一个场景，避免"万能模板"
2. **显式变量声明**：模板顶部用注释或 schema 文件声明所需变量
3. **防御性默认值**：所有可选变量提供合理的 `default` 值
4. **结构化输出约束**：在模板末尾明确指定输出格式（JSON Schema、Markdown 等）

### 6.2 A/B 测试运营建议

- **最小样本量先行**：先用 10% 流量验证变体不产生明显退化，再逐步放量
- **多维度评估**：不仅看质量分，还要关注延迟、成本、用户满意度
- **灰度发布**：新 prompt 版本先在 5% 流量中运行 24-48 小时
- **自动回滚**：当关键指标（如质量分）下降超过阈值时，自动回退到上一版本

### 6.3 模板安全

- **输入消毒**：用户输入必须经过截断和过滤，防止 prompt 注入
- **模板沙箱**：Jinja2 的 `SandboxedEnvironment` 可以限制模板能访问的对象和方法
- **审计日志**：记录每次模板渲染的输入和输出，便于追溯问题

```python
# Jinja2 沙箱模式
from jinja2.sandbox import SandboxedEnvironment

safe_env = SandboxedEnvironment(loader=loader)
# 模板中无法执行任意 Python 代码或访问危险属性
```

---

## 七、完整可运行示例

### 7.1 Jinja2 完整可运行示例（Python）

以下是一个可直接运行的完整示例，展示从模板定义到渲染到 A/B 分流的全流程：

```python
"""
完整可运行的 Jinja2 Prompt 模板引擎示例
安装依赖：pip install jinja2
"""
from jinja2 import Environment, BaseLoader, select_autoescape
from jinja2.sandbox import SandboxedEnvironment
import hashlib
from dataclasses import dataclass, field
from typing import Optional
import json

# --- 模板定义 ---
PRODUCT_COPY_TEMPLATE = """
你是一名{{ role | default('资深文案策划') }}。

安全准则：
1. 不生成有害、违法或误导性内容
2. 对不确定的事实标注"未验证"

任务：为以下产品撰写{{ language | default('中文') }}产品描述。
产品名称：{{ product_name }}
{% if category %}
产品类目：{{ category }}
{% endif %}

{% if target_audience %}
目标受众：{{ target_audience }}
请根据受众特征调整用语风格。
{% endif %}

{% if reference_copy %}
参考风格：
{% for ref in reference_copy %}
「{{ ref }}」
{% endfor %}
{% endif %}

输出要求：
- 字数控制在{{ min_words | default(80) }}-{{ max_words | default(150) }}字
- 格式：纯文本，无 Markdown
{% if output_format == 'json' %}
- 返回 JSON 格式：{"copy": "文案内容", "tags": ["标签1", "标签2"]}
{% endif %}
"""

INTENT_ROUTER_TEMPLATE = """
你是一个智能客服助手。

{% if intent == 'purchase' %}
用户有购买意向，请引导完成购买流程。
产品信息：{{ product_name | default('未指定') }}
优惠信息：{{ discount_info | default('暂无优惠') }}
{% elif intent == 'complaint' %}
用户有投诉，请以同理心回应。
工单编号：{{ ticket_id | default('待生成') }}
{% elif intent == 'technical' %}
用户有技术问题，请检索以下文档：
{% for doc in technical_docs[:3] %}
- {{ doc.title }}：{{ doc.summary }}
{% endfor %}
{% else %}
请友好地询问用户的具体需求。
{% endif %}
"""


# --- A/B 测试路由器 ---
@dataclass
class Variant:
    name: str
    template: str
    weight: float

def assign_variant(experiment_id: str, user_id: str, variants: list[Variant]) -> Variant:
    """基于一致性哈希的 A/B 分流"""
    hash_input = f"{experiment_id}:{user_id}"
    hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16) % 10000 / 10000.0
    cumulative = 0.0
    for v in variants:
        cumulative += v.weight
        if hash_value < cumulative:
            return v
    return variants[-1]


# --- 主流程 ---
def main():
    # 使用沙箱环境，防止模板中执行危险代码
    env = SandboxedEnvironment(loader=BaseLoader(), autoescape=select_autoescape([]))

    # 定义 A/B 实验
    variants = [
        Variant("formal", PRODUCT_COPY_TEMPLATE, 0.7),
        Variant("creative", PRODUCT_COPY_TEMPLATE, 0.3),  # 实际项目中使用不同模板
    ]

    # 渲染 prompt
    user_id = "user_001"
    variant = assign_variant("exp_product_copy", user_id, variants)
    template = env.from_string(variant.template)

    rendered = template.render(
        role="资深科技产品文案",
        language="中文",
        product_name="CloudSync Pro",
        category="云服务",
        target_audience="企业 IT 经理",
        reference_copy=["简洁有力，突出核心卖点", "用数据说话，增强可信度"],
        output_format="json",
    )

    print(f"=== A/B 实验分流结果 ===")
    print(f"用户: {user_id}")
    print(f"命中变体: {variant.name}")
    print(f"权重: {variant.weight}")
    print(f"\n=== 渲染后的 Prompt ===")
    print(rendered)


if __name__ == "__main__":
    main()
```

### 7.2 Laravel Blade 完整可运行示例（PHP）

以下是一个可直接在 Laravel 项目中运行的完整示例：

```php
<?php
// 文件：app/Services/Prompt/PromptTemplateEngine.php
// 使用方法：php artisan tinker --include=prompt_example.php

namespace App\Services\Prompt;

use Illuminate\View\Factory as ViewFactory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;

/**
 * Prompt 模板引擎服务
 * 将 Blade 模板用于 Prompt 管理
 */
class PromptTemplateEngine
{
    public function __construct(
        private ViewFactory $viewFactory,
    ) {}

    /**
     * 渲染 Prompt 模板
     */
    public function render(string $templateName, array $variables): string
    {
        $templatePath = resource_path("views/prompts/{$templateName}.blade.php");

        if (!File::exists($templatePath)) {
            throw new \RuntimeException("Prompt template not found: {$templateName}");
        }

        return $this->viewFactory
            ->file($templatePath, $variables)
            ->render();
    }

    /**
     * 渲染带 A/B 变体的 Prompt
     */
    public function renderWithExperiment(
        string $templateName,
        array $variables,
        string $userId,
        ?string $experimentId = null
    ): array {
        $variant = 'default';

        if ($experimentId) {
            $variant = $this->assignVariant($experimentId, $userId);
            $templateName = "{$templateName}_{$variant}";
        }

        $rendered = $this->render($templateName, $variables);

        return [
            'prompt' => $rendered,
            'variant' => $variant,
            'experiment_id' => $experimentId,
        ];
    }

    /**
     * 一致性哈希分流
     */
    private function assignVariant(string $experimentId, string $userId): string
    {
        $hash = md5("{$experimentId}:{$userId}");
        $bucket = hexdec(substr($hash, 0, 8)) % 10000 / 10000.0;

        // 70% formal, 30% creative
        return $bucket < 0.7 ? 'formal' : 'creative';
    }
}
```

对应的 Blade 模板文件 `resources/views/prompts/product_copy.blade.php`：

```blade
{{-- resources/views/prompts/product_copy.blade.php --}}
你是一名{{ $role ?? '资深文案策划' }}。

安全准则：
1. 不生成有害、违法或误导性内容
2. 对不确定的事实标注"未验证"

任务：为以下产品撰写{{ $language ?? '中文' }}产品描述。
产品名称：{{ $productName }}
@if(isset($category))
产品类目：{{ $category }}
@endif

@if(isset($targetAudience))
目标受众：{{ $targetAudience }}
请根据受众特征调整用语风格和重点卖点。
@endif

@isset($referenceCopy)
参考风格：
@foreach($referenceCopy as $ref)
「{{ $ref }}」
@endforeach
@endisset

输出要求：
- 字数控制在{{ $minWords ?? 80 }}-{{ $maxWords ?? 150 }}字
- 格式：纯文本，无 Markdown
@if(($outputFormat ?? '') === 'json')
- 返回 JSON 格式：{"copy": "文案内容", "tags": ["标签1", "标签2"]}
@endif
```

在控制器中调用：

```php
<?php
// 文件：app/Http/Controllers/ProductCopyController.php

namespace App\Http\Controllers;

use App\Services\Prompt\PromptTemplateEngine;
use Illuminate\Http\Request;

class ProductCopyController extends Controller
{
    public function generate(
        Request $request,
        PromptTemplateEngine $engine
    ) {
        $result = $engine->renderWithExperiment(
            'product_copy',
            [
                'productName' => $request->input('product_name'),
                'category' => $request->input('category'),
                'targetAudience' => $request->input('audience'),
                'language' => $request->input('lang', '中文'),
                'outputFormat' => 'json',
            ],
            userId: auth()->id() ?? 'anonymous',
            experimentId: 'exp_product_copy_v2',
        );

        // result['prompt'] 即为渲染后的完整 Prompt，可直接传给 LLM
        return response()->json([
            'prompt' => $result['prompt'],
            'variant' => $result['variant'],
        ]);
    }
}
```

### 7.3 模板引擎选型对比（扩展版）

| 维度 | Jinja2 | Mustache/Handlebars | Laravel Blade | Go Template | Handlebars.js |
|------|--------|-------------------|---------------|-------------|---------------|
| 语言支持 | Python | 跨语言（20+） | PHP（需 Laravel） | Go | JavaScript |
| 表达能力 | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | ★★★★☆ |
| 宏/组件复用 | Macro + Extends | Partial + Helper | Blade Component | 内置模板函数 | Helper + Partial |
| 沙箱安全 | SandboxedEnvironment | 无内置 | 无内置 | 无内置 | 无内置 |
| 条件分支 | if/elif/else | Logic-less | @if/@elseif | {{if}} | #if/#unless |
| 循环 | for | #each | @foreach | {{range}} | #each |
| 过滤器/管道 | 管道过滤器 | 无 | Blade Components | 函数调用 | Helper |
| 热更新 | 支持（文件监听） | 支持 | 需清缓存 | 需重新编译 | 支持 |
| 学习曲线 | 中等 | 低 | 低（需 Laravel） | 低 | 低 |
| 适合场景 | Python AI 项目 | 多语言微服务 | Laravel/PHP 项目 | Go 后端 | 前端渲染 |
| Prompt 约束力 | 弱（可写复杂逻辑） | 强（Logic-less） | 中等 | 中等 | 中等 |
| 社区生态 | 极丰富（Flask/Jupyter） | 丰富 | Laravel 生态 | Go 标准库 | npm 生态 |

**选型建议总结**：

1. **Python AI 团队** → Jinja2：表达力最强，`SandboxedEnvironment` 提供安全沙箱，配合 Flask/Jupyter 生态
2. **多语言微服务** → Mustache/Handlebars：Logic-less 强制逻辑外移，模板可跨 JS/Python/PHP/Go 共享
3. **Laravel/PHP 团队** → Blade：与 Laravel 深度集成，`@component` 天然支持 Prompt 片段复用
4. **前端 Prompt 渲染** → Handlebars.js：浏览器端直接渲染，适合 Copilot 类前端 Prompt

---

## 八、踩坑案例与实战教训

### 8.1 Jinja2 宏嵌套过深导致的可读性危机

**问题**：某团队将 20+ 个 Prompt 场景的公共逻辑抽取为 Jinja2 宏，最终出现 5 层嵌套的宏调用链，模板可读性急剧下降，修改一个变量需要追踪 3 个文件。

**解决方案**：
- 宏层级不超过 2 层，超过时将逻辑上移到 Python 代码层
- 使用 `jinja2.ext.do` 扩展减少宏依赖
- 每个模板文件顶部用注释块声明所有入参和出参

```jinja2
{# 模板头部文档块 - 强制规范 #}
{# 
=== Prompt 模板文档 ===
名称: product_copy
版本: v2.1.0
作者: @zhangsan
入参: product_name(str), category(str?), target_audience(str?), language(str, default='中文')
出参: 纯文本产品描述，80-150字
依赖: safety_guard.j2, format_instruction.j2
=== End ===
#}
```

### 8.2 Blade 模板缓存导致 Prompt 更新延迟

**问题**：Laravel 的 Blade 模板会自动缓存编译结果，修改模板后用户仍在使用旧版本 Prompt。

```php
// ❌ 错误：忘记清除编译缓存
// php artisan view:clear

// ✅ 正确：在 Prompt 模板上禁用缓存
// config/view.php 中设置:
'compiled' => null, // 禁用视图编译缓存

// 或者在生产环境使用文件修改时间戳检测
$cacheKey = "prompt:{$name}:{$variant}:" . filemtime($templatePath);
```

### 8.3 A/B 测试的分流偏差陷阱

**问题**：使用 `user_id % 2` 做分流，导致新注册用户（ID 递增）全部落入同一变体。

**解决方案**：
```python
# ❌ 错误：简单取模会导致顺序偏差
variant = "A" if int(user_id) % 2 == 0 else "B"

# ✅ 正确：使用一致性哈希（MD5/SHA256）分散分布
hash_value = int(hashlib.md5(f"exp_001:{user_id}".encode()).hexdigest(), 16)
variant = "A" if hash_value % 100 < 50 else "B"
```

### 8.4 Prompt 注入防护

**问题**：用户输入直接注入模板，恶意用户通过输入内容操控 Prompt 行为。

```python
from jinja2.sandbox import SandboxedEnvironment

def safe_render(template_str: str, variables: dict) -> str:
    """安全的模板渲染，防止 Prompt 注入"""
    # 1. 使用沙箱环境
    env = SandboxedEnvironment(autoescape=True)

    # 2. 对用户输入进行消毒
    sanitized = {}
    for key, value in variables.items():
        if isinstance(value, str):
            # 截断过长输入
            value = value[:2000]
            # 移除潜在的模板语法
            for marker in ['{{', '}}', '{%', '%}', '{#', '#}']:
                value = value.replace(marker, '')
        sanitized[key] = value

    template = env.from_string(template_str)
    return template.render(**sanitized)
```

### 8.5 Mustache 的"Logic-less 之痛"与解法

**问题**：业务需要根据 `user_tier` 动态调整 Prompt 长度和详细程度，但 Mustache 不支持 `if-else` 的 else 分支。

**解决方案**：在代码层预计算布尔标志，或使用 Handlebars 的 `#unless`：

```python
# 代码层预处理
context = {
    "user_tier": user.tier,
    "is_premium": user.tier in ("gold", "platinum"),
    "is_free": user.tier == "free",
    "show_detailed_analysis": user.tier in ("gold", "platinum"),
    "max_examples": 5 if user.tier in ("gold", "platinum") else 2,
}
```

```handlebars
{{#is_premium}}
请提供详细的分析报告，包含数据可视化建议。
可用示例数量：{{max_examples}}
{{/is_premium}}

{{#is_free}}
请提供简洁的摘要，不超过3个要点。
{{/is_free}}
```

---

## 九、总结

Prompt 管理的工程化不是过度设计——当你的 AI 应用跨越"原型"阶段进入生产环境时，模板化管理就是必需品。选择适合团队技术栈的模板引擎，建立清晰的版本管理和 A/B 测试流程，你的 Prompt 体系将具备可维护、可测试、可优化的工程品质。

记住核心公式：**Prompt 工程化 = 模板引擎 + 版本控制 + A/B 测试 + 指标闭环 + 安全防护**。

不要让 prompt 成为代码中的魔法字符串——让它成为可管理、可演进的工程资产。

---

## 相关阅读

- [Prompt Engineering 实战：Few-shot/CoT/Tool-use 提示词工程最佳实践——从直觉式提问到系统化 Prompt 架构的完整指南](/categories/AI%20工程化/2026-06-01-prompt-engineering-few-shot-cot-tool-use-best-practices/)
- [AI Agent Evaluation as Code 实战：用 LLM-as-Judge 构建自动化回归测试——Agent 输出质量的持续集成保障](/categories/AI%20Agent/2026-06-05-ai-agent-evaluation-as-code-llm-as-judge-regression-testing/)
- [AI Agent Guardrails 实战：NeMo Guardrails/Rebuff 护栏系统——防止越狱、幻觉与有害输出的工程化方案](/categories/AI/AI-Agent-Guardrails-实战-NeMo-Guardrails-Rebuff护栏系统-防止越狱幻觉与有害输出的工程化方案/)
