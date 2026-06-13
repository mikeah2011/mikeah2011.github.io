---

title: Braintrust 实战：LLM 评估即代码——Eval/Prompt/Score 的声明式管理与 CI 回归测试闭环
keywords: [Braintrust, LLM, Eval, Prompt, Score, CI, 评估即代码, 的声明式管理与, 回归测试闭环, AI]
date: 2026-06-10 00:15:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- BrainTrust
- LLM
- Prompt Engineering
- CI/CD
- 质量保障
description: 深入实战 Braintrust 框架，用声明式代码管理 Eval、Prompt、Score 三大核心，构建 LLM 应用的 CI 回归测试闭环，告别人工 eyeball test。
---



## 前言

LLM 应用开发最痛苦的事情是什么？不是写 Prompt，不是调参数，而是——**改了一个 Prompt 之后，不知道其他场景有没有被影响**。

传统的软件测试有单元测试、集成测试、端到端测试，每次 CI 跑一遍就知道有没有 break。但 LLM 应用呢？输出是非确定性的，质量是主观的，每次改动 Prompt 都得人工 eyeball test 一遍，效率极低。

Braintrust 就是来解决这个问题的。它把 LLM 评估的三要素——**Eval（评估用例）、Prompt（提示词模板）、Score（评分函数）**——全部用代码管理，接入 CI 流程后，每次提交自动跑回归测试，输出变化报告。

本文从零开始，用 PHP/Laravel 项目集成 Braintrust SDK，完整演示声明式 Eval 管理和 CI 回归测试闭环的搭建过程。

## 什么是 Braintrust

Braintrust 是一个 LLM 评估平台，核心理念是 **Eval as Code**。它提供：

- **Eval 管理**：用代码定义评估用例，版本化追踪
- **Prompt 管理**：Prompt 模板化、版本化，支持 A/B 对比
- **Scoring**：可编程评分函数，支持 LLM-as-Judge、正则、语义相似度等多种打分方式
- **CI 集成**：GitHub Action / CLI 工具，PR 级别的回归测试

与传统的手动测试相比，Braintrust 让你像管理代码一样管理 LLM 的质量。

### 核心概念

```
┌─────────────────────────────────────────────┐
│                 Braintrust                    │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Eval    │  │  Prompt  │  │  Score   │   │
│  │  (用例)  │  │  (模板)  │  │  (评分)  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │         │
│       └──────────┬───┘              │         │
│                  │                  │         │
│            ┌─────▼─────┐           │         │
│            │   Run     │◄──────────┘         │
│            │ (执行)    │                      │
│            └─────┬─────┘                      │
│                  │                            │
│            ┌─────▼─────┐                      │
│            │  Report   │                      │
│            │ (报告)    │                      │
│            └───────────┘                      │
└─────────────────────────────────────────────┘
```

## 环境准备

### 安装 Braintrust SDK

```bash
# Python SDK（Braintrust 主要支持 Python）
pip install braintrust

# 或用 uv
uv add braintrust
```

Braintrust 的 Python SDK 是主力，PHP/Laravel 项目通常通过 Python 子进程或 API 调用来集成。

### 获取 API Key

```bash
# 注册 https://braintrust.dev 后获取 API Key
export BRAINTRUST_API_KEY="your-api-key-here"
```

### 初始化项目

```bash
mkdir -p llm-eval && cd llm-eval
braintrust init
```

初始化后会生成一个标准目录结构：

```
llm-eval/
├── evals/          # 评估用例
├── prompts/        # Prompt 模板
├── scorers/        # 评分函数
├── braintrust.toml # 配置文件
└── tests/          # CI 测试脚本
```

## 第一步：声明式 Eval 管理

### 定义评估用例

评估用例是 Eval 的核心。每个用例包含 **input**（输入）和 **expected**（期望输出）。

```python
# evals/customer_service_eval.py
import braintrust

# 定义评估数据集
eval_data = [
    {
        "input": {"query": "如何退款？"},
        "expected": "退款流程说明",
        "metadata": {"category": "refund", "difficulty": "easy"}
    },
    {
        "input": {"query": "订单状态查询"},
        "expected": "订单查询指引",
        "metadata": {"category": "order", "difficulty": "easy"}
    },
    {
        "input": {"query": "我买的东西有质量问题，想退货"},
        "expected": "质量问题退货流程",
        "metadata": {"category": "complaint", "difficulty": "medium"}
    },
    {
        "input": {"query": "你们的产品和竞品比有什么优势？"},
        "expected": "产品优势对比说明",
        "metadata": {"category": "comparison", "difficulty": "hard"}
    },
]

def get_eval_data():
    """返回评估数据集，可从数据库或文件加载"""
    return eval_data
```

### 版本化管理

关键点：Eval 数据集要像代码一样版本化。

```python
# evals/dataset_manager.py
import json
import hashlib
from pathlib import Path

class DatasetManager:
    """管理评估数据集的版本"""
    
    def __init__(self, dataset_path: str):
        self.dataset_path = Path(dataset_path)
        self._load()
    
    def _load(self):
        if self.dataset_path.exists():
            with open(self.dataset_path) as f:
                self.data = json.load(f)
        else:
            self.data = []
    
    def add_case(self, input_data: dict, expected: str, metadata: dict = None):
        """添加评估用例"""
        case = {
            "id": hashlib.md5(json.dumps(input_data, sort_keys=True).encode()).hexdigest()[:8],
            "input": input_data,
            "expected": expected,
            "metadata": metadata or {},
            "created_at": "2026-06-10"
        }
        self.data.append(case)
        self._save()
        return case["id"]
    
    def _save(self):
        with open(self.dataset_path, 'w') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
    
    def get_version_hash(self) -> str:
        """获取数据集的版本哈希"""
        content = json.dumps(self.data, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:12]
```

## 第二步：Prompt 模板管理

### 声明式 Prompt

```python
# prompts/customer_service.py

# 基础 Prompt
CUSTOMER_SERVICE_V1 = """
你是一个专业的客服助手。请根据用户的问题提供准确、友好的回答。

用户问题：{query}

回答要求：
1. 简洁明了
2. 提供具体操作步骤
3. 如需人工介入，明确告知
"""

# 优化版 Prompt（增加上下文和约束）
CUSTOMER_SERVICE_V2 = """
你是一个专业的客服助手，服务于电商平台。请根据用户的问题提供准确、友好的回答。

## 回答规范
- 使用中文回答
- 语气友好但专业
- 提供可执行的操作步骤
- 如涉及退款/退货，需说明时间节点
- 如无法解决，引导用户联系人工客服

## 用户信息
用户问题：{query}

## 回答
"""

# Prompt 版本映射
PROMPT_VERSIONS = {
    "v1": CUSTOMER_SERVICE_V1,
    "v2": CUSTOMER_SERVICE_V2,
    "latest": CUSTOMER_SERVICE_V2,
}
```

### Prompt 模板引擎

```python
# prompts/engine.py
from jinja2 import Template

class PromptEngine:
    """Prompt 模板引擎，支持版本管理和渲染"""
    
    def __init__(self):
        self.templates = {}
    
    def register(self, name: str, template_str: str, version: str = "latest"):
        key = f"{name}:{version}"
        self.templates[key] = Template(template_str)
    
    def render(self, name: str, version: str = "latest", **kwargs) -> str:
        key = f"{name}:{version}"
        if key not in self.templates:
            raise ValueError(f"Template {key} not found")
        return self.templates[key].render(**kwargs)
    
    def diff(self, name: str, v1: str, v2: str, **kwargs) -> dict:
        """对比两个版本的渲染结果"""
        rendered_v1 = self.render(name, v1, **kwargs)
        rendered_v2 = self.render(name, v2, **kwargs)
        return {
            "v1": rendered_v1,
            "v2": rendered_v2,
            "changed": rendered_v1 != rendered_v2
        }

# 使用示例
engine = PromptEngine()
engine.register("cs", CUSTOMER_SERVICE_V1, "v1")
engine.register("cs", CUSTOMER_SERVICE_V2, "v2")

result = engine.render("cs", "v2", query="如何退款？")
```

## 第三步：可编程评分函数

### 多维度评分

评分是 Eval 的灵魂。Braintrust 支持自定义评分函数，可以从多个维度评估输出质量。

```python
# scorers/quality_scorer.py
import re
from difflib import SequenceMatcher

def exact_match_score(output: str, expected: str) -> float:
    """精确匹配评分"""
    return 1.0 if output.strip() == expected.strip() else 0.0

def keyword_coverage_score(output: str, expected: str) -> float:
    """关键词覆盖率评分"""
    # 从期望输出中提取关键词
    keywords = set(re.findall(r'[\u4e00-\u9fff]+|[a-zA-Z]+', expected))
    if not keywords:
        return 0.0
    
    matched = sum(1 for kw in keywords if kw in output)
    return matched / len(keywords)

def semantic_similarity_score(output: str, expected: str) -> float:
    """语义相似度评分（简化版，实际可用 embedding）"""
    return SequenceMatcher(None, output, expected).ratio()

def format_compliance_score(output: str) -> float:
    """格式合规性评分"""
    score = 1.0
    
    # 检查长度
    if len(output) < 10:
        score -= 0.3
    if len(output) > 2000:
        score -= 0.2
    
    # 检查是否有结构化内容
    if any(marker in output for marker in ['1.', '2.', '•', '-']):
        score += 0.1
    
    # 检查是否包含有害内容
    harmful_patterns = ['不知道', '无法回答', '我不确定']
    if any(p in output for p in harmful_patterns):
        score -= 0.2
    
    return max(0.0, min(1.0, score))

def composite_score(output: str, expected: str) -> dict:
    """综合评分"""
    return {
        "exact_match": exact_match_score(output, expected),
        "keyword_coverage": keyword_coverage_score(output, expected),
        "semantic_similarity": semantic_similarity_score(output, expected),
        "format_compliance": format_compliance_score(output),
        "overall": (
            exact_match_score(output, expected) * 0.2 +
            keyword_coverage_score(output, expected) * 0.3 +
            semantic_similarity_score(output, expected) * 0.3 +
            format_compliance_score(output) * 0.2
        )
    }
```

### LLM-as-Judge 评分

```python
# scorers/llm_judge.py
import os
from openai import OpenAI

client = OpenAI()

JUDGE_PROMPT = """
你是一个专业的 AI 输出质量评审员。请根据以下标准对回答进行评分：

## 评分标准
- 准确性（0-10）：回答是否准确无误
- 完整性（0-10）：是否涵盖了所有要点
- 友好度（0-10）：语气是否友好专业
- 可操作性（0-10）：是否提供了具体的操作步骤

## 用户问题
{query}

## AI 回答
{output}

## 参考答案
{expected}

请以 JSON 格式输出评分：
{{"accuracy": X, "completeness": X, "friendliness": X, "actionability": X, "overall": X, "reasoning": "..."}}
"""

def llm_judge_score(query: str, output: str, expected: str) -> dict:
    """使用 LLM 进行质量评分"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "你是一个严格的评审员，只输出 JSON。"},
            {"role": "user", "content": JUDGE_PROMPT.format(
                query=query, output=output, expected=expected
            )}
        ],
        response_format={"type": "json_object"},
        temperature=0
    )
    
    import json
    result = json.loads(response.choices[0].message.content)
    
    # 归一化到 0-1
    for key in ["accuracy", "completeness", "friendliness", "actionability", "overall"]:
        if key in result:
            result[key] = result[key] / 10.0
    
    return result
```

## 第四步：运行 Eval

### 完整的 Eval Runner

```python
# run_eval.py
import braintrust
import asyncio
from evals.customer_service_eval import get_eval_data
from prompts.customer_service import PROMPT_VERSIONS
from scorers.quality_scorer import composite_score

def run_customer_service_eval(prompt_version: str = "latest"):
    """运行客服评估"""
    
    # 创建 Braintrust 项目
    project = braintrust.init(
        project="customer-service-eval",
        metadata={
            "prompt_version": prompt_version,
            "eval_date": "2026-06-10"
        }
    )
    
    eval_data = get_eval_data()
    prompt_template = PROMPT_VERSIONS[prompt_version]
    
    results = []
    
    for case in eval_data:
        query = case["input"]["query"]
        expected = case["expected"]
        
        # 渲染 Prompt
        prompt = prompt_template.format(query=query)
        
        # 调用 LLM（这里用 OpenAI，实际可换成你的服务）
        from openai import OpenAI
        client = OpenAI()
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=500
        )
        
        output = response.choices[0].message.content
        
        # 评分
        scores = composite_score(output, expected)
        
        # 记录到 Braintrust
        project.log(
            input={"query": query},
            output=output,
            expected=expected,
            scores=scores,
            metadata=case.get("metadata", {})
        )
        
        results.append({
            "query": query,
            "output": output,
            "scores": scores
        })
    
    return results

if __name__ == "__main__":
    results = run_customer_service_eval("v2")
    
    # 输出摘要
    avg_score = sum(r["scores"]["overall"] for r in results) / len(results)
    print(f"\n📊 评估完成：共 {len(results)} 个用例")
    print(f"📈 平均综合分：{avg_score:.2%}")
    
    for r in results:
        status = "✅" if r["scores"]["overall"] >= 0.7 else "⚠️"
        print(f"{status} {r['query'][:20]}... → {r['scores']['overall']:.2%}")
```

## 第五步：CI 回归测试闭环

### GitHub Action 配置

```yaml
# .github/workflows/llm-eval.yml
name: LLM Eval Regression

on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'evals/**'
      - 'scorers/**'
  push:
    branches: [main]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      
      - name: Install dependencies
        run: |
          pip install braintrust openai
      
      - name: Run Eval
        env:
          BRAINTRUST_API_KEY: ${{ secrets.BRAINTRUST_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          python run_eval.py --output results.json
      
      - name: Check Regression
        run: |
          python -c "
          import json, sys
          with open('results.json') as f:
              results = json.load(f)
          avg = sum(r['scores']['overall'] for r in results) / len(results)
          if avg < 0.7:
              print(f'❌ 回归检测：平均分 {avg:.2%} 低于阈值 70%')
              sys.exit(1)
          print(f'✅ 通过：平均分 {avg:.2%}')
          "
      
      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('results.json', 'utf8'));
            const avg = results.reduce((sum, r) => sum + r.scores.overall, 0) / results.length;
            
            const body = `## 🧪 LLM Eval 回归测试报告
            
            **平均分：** ${(avg * 100).toFixed(1)}%
            
            | 用例 | 分数 | 状态 |
            |------|------|------|
            ${results.map(r => `| ${r.query.slice(0, 20)}... | ${(r.scores.overall * 100).toFixed(1)}% | ${r.scores.overall >= 0.7 ? '✅' : '⚠️'} |`).join('\n')}
            
            [查看完整报告](https://braintrust.dev)
            `;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

### 本地 CI 脚本

```bash
#!/bin/bash
# scripts/run-eval-ci.sh

set -e

echo "🧪 开始 LLM 评估..."

# 运行评估
python run_eval.py --output results.json

# 检查结果
python -c "
import json, sys

with open('results.json') as f:
    results = json.load(f)

avg = sum(r['scores']['overall'] for r in results) / len(results)
failed = [r for r in results if r['scores']['overall'] < 0.7]

print(f'📊 评估完成：{len(results)} 个用例')
print(f'📈 平均分：{avg:.2%}')

if failed:
    print(f'❌ {len(failed)} 个用例未通过：')
    for r in failed:
        print(f'   - {r[\"query\"][:30]}... ({r[\"scores\"][\"overall\"]:.2%})')
    sys.exit(1)

print('✅ 所有用例通过')
"
```

## 第六步：与 Laravel 项目集成

### 通过 Python 子进程调用

```php
<?php
// app/Services/LlmEvalService.php

namespace App\Services;

use Illuminate\Support\Process;

class LlmEvalService
{
    protected string $evalPath;
    
    public function __construct()
    {
        $this->evalPath = base_path('llm-eval');
    }
    
    /**
     * 运行评估并返回结果
     */
    public function runEval(string $promptVersion = 'latest'): array
    {
        $process = Process::path($this->evalPath)
            ->env([
                'BRAINTRUST_API_KEY' => config('services.braintrust.api_key'),
                'OPENAI_API_KEY' => config('services.openai.api_key'),
                'PROMPT_VERSION' => $promptVersion,
            ])
            ->run('python run_eval.py --output results.json --version ' . $promptVersion);
        
        if (!$process->successful()) {
            throw new \RuntimeException('Eval failed: ' . $process->errorOutput());
        }
        
        $resultsPath = $this->evalPath . '/results.json';
        return json_decode(file_get_contents($resultsPath), true);
    }
    
    /**
     * 检查是否有回归
     */
    public function checkRegression(array $results, float $threshold = 0.7): array
    {
        $avgScore = collect($results)->avg('scores.overall');
        $failed = collect($results)
            ->filter(fn($r) => $r['scores']['overall'] < $threshold)
            ->values()
            ->toArray();
        
        return [
            'passed' => empty($failed),
            'average_score' => $avgScore,
            'failed_count' => count($failed),
            'failed_cases' => $failed,
        ];
    }
}
```

### Artisan 命令

```php
<?php
// app/Console/Commands/RunLlmEval.php

namespace App\Console\Commands;

use App\Services\LlmEvalService;
use Illuminate\Console\Command;

class RunLlmEval extends Command
{
    protected $signature = 'llm:eval 
                            {--version=latest : Prompt 版本}
                            {--threshold=0.7 : 通过阈值}';
    
    protected $description = '运行 LLM 评估回归测试';
    
    public function handle(LlmEvalService $evalService): int
    {
        $version = $this->option('version');
        $threshold = (float) $this->option('threshold');
        
        $this->info("🧪 开始评估 (Prompt: {$version})...");
        
        try {
            $results = $evalService->runEval($version);
            $report = $evalService->checkRegression($results, $threshold);
            
            $this->newLine();
            $this->info("📊 评估报告");
            $this->line("━━━━━━━━━━━━━━━━━━━━━━━━━━");
            $this->line("用例总数: " . count($results));
            $this->line("平均分数: " . number_format($report['average_score'] * 100, 1) . "%");
            $this->line("未通过数: " . $report['failed_count']);
            
            if ($report['passed']) {
                $this->newLine();
                $this->info("✅ 所有用例通过！");
                return self::SUCCESS;
            }
            
            $this->newLine();
            $this->error("❌ 存在回归问题：");
            
            foreach ($report['failed_cases'] as $case) {
                $query = mb_substr($case['query'], 0, 30);
                $score = number_format($case['scores']['overall'] * 100, 1);
                $this->line("  ⚠️  {$query}... ({$score}%)");
            }
            
            return self::FAILURE;
            
        } catch (\Throwable $e) {
            $this->error("💥 评估执行失败: " . $e->getMessage());
            return self::FAILURE;
        }
    }
}
```

### 集成到 CI 流程

```yaml
# .github/workflows/laravel-ci.yml（追加步骤）
      - name: Run LLM Eval
        if: contains(github.event.pull_request.labels.*.name, 'llm-change')
        env:
          BRAINTRUST_API_KEY: ${{ secrets.BRAINTRUST_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          php artisan llm:eval --threshold=0.7
```

## 踩坑记录

### 1. 评估结果不可复现

**问题**：同一个 Prompt 跑两次，分数不一样。

**原因**：LLM 的 `temperature` 不为 0，或者使用了有状态的模型。

**解决**：

```python
# 评估时固定 temperature=0
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[...],
    temperature=0,  # 关键！
    seed=42         # 部分模型支持 seed
)
```

### 2. 评分函数过于严格

**问题**：用例通过率只有 20%，但人工看输出其实质量不错。

**原因**：精确匹配和关键词覆盖率对 LLM 输出太严格，LLM 的表达方式多样。

**解决**：降低精确匹配权重，提高语义相似度和 LLM-as-Judge 权重。

```python
def composite_score_v2(output: str, expected: str) -> dict:
    """调整权重后的综合评分"""
    return {
        "overall": (
            exact_match_score(output, expected) * 0.05 +      # 降低
            keyword_coverage_score(output, expected) * 0.25 +
            semantic_similarity_score(output, expected) * 0.35 +  # 提高
            format_compliance_score(output) * 0.10 +
            llm_judge_score(output, expected) * 0.25          # 新增
        )
    }
```

### 3. CI 运行超时

**问题**：评估用例多了之后，CI 跑 10 分钟都跑不完。

**原因**：串行调用 LLM，每个用例等 2-3 秒。

**解决**：并发执行 + 设置超时。

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

async def run_eval_concurrent(eval_data, prompt_template, max_workers=10):
    """并发运行评估"""
    loop = asyncio.get_event_loop()
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        tasks = [
            loop.run_in_executor(executor, evaluate_single_case, case, prompt_template)
            for case in eval_data
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # 过滤异常
    return [r for r in results if not isinstance(r, Exception)]
```

### 4. Prompt 版本管理混乱

**问题**：Prompt 改了但忘记更新版本号，导致评估结果对比错乱。

**解决**：用 Git hook 自动检测 Prompt 变更。

```bash
#!/bin/bash
# .git/hooks/pre-commit

# 检查 Prompt 文件是否有变更
changed_prompts=$(git diff --cached --name-only | grep 'prompts/')

if [ -n "$changed_prompts" ]; then
    echo "⚠️  检测到 Prompt 文件变更："
    echo "$changed_prompts"
    echo ""
    echo "请确保已更新版本号！"
    
    # 自动递增版本号（可选）
    # python scripts/bump_prompt_version.py
fi
```

## 最佳实践总结

### Eval 设计原则

1. **覆盖边界用例**：正常流程、异常流程、边界条件都要覆盖
2. **分层评估**：简单用例 + 复杂用例，不要一刀切
3. **数据驱动**：从生产日志中提取真实用例，不要凭空编造

### 评分策略

1. **多维度打分**：不要只用一个指标
2. **权重可调**：根据业务场景调整权重
3. **人工校准**：定期用人工评估校准自动评分

### CI 集成策略

1. **增量评估**：只评估受影响的 Prompt
2. **阈值告警**：设置合理的通过阈值（建议 70%-80%）
3. **趋势追踪**：关注分数趋势，不要只看单次结果

## 总结

Braintrust 的核心价值在于把 LLM 评估从"人工 eyeball test"变成了"代码化的回归测试"。通过 Eval/Prompt/Score 三件套，配合 CI 流程，你可以：

- **放心改 Prompt**：改完跑一遍评估就知道有没有 break
- **量化质量**：不再是"感觉还行"，而是"综合分 82%"
- **持续改进**：通过历史数据追踪质量趋势

LLM 应用的质量保障是一个系统工程，Braintrust 提供了一个很好的起点。关键是把评估融入开发流程，变成习惯，而不是事后补救。

---

**参考链接：**

- [Braintrust 官方文档](https://braintrust.dev/docs)
- [Braintrust GitHub](https://github.com/braintrustdata/braintrust)
- [LLM Eval Best Practices](https://braintrust.dev/docs/cookbook)
