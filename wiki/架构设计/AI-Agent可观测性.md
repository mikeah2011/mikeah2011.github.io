# AI Agent 可观测性

> AI Agent 可观测性是对 LLM 应用的成本、延迟、质量进行追踪、分析和回归测试的工程实践。它解决了 LLM 应用特有的"黑盒"问题——Token 成本归因、多步链路延迟瓶颈、Prompt 版本追溯与幻觉调试。

## 定义

**AI Agent 可观测性（LLM Observability）** 是将传统软件可观测性（Metrics/Traces/Logs）应用于 LLM 应用的工程实践。它追踪每个 AI Agent 调用链路中的 Token 消耗、延迟分布、输入输出内容、模型参数和业务结果，使团队能够：

- **成本归因**：精确到每个用户/功能/模型的 Token 成本
- **延迟分析**：定位多步 Agent 链路中的瓶颈步骤
- **质量监控**：追踪幻觉率、准确率、用户满意度
- **回归测试**：Prompt 模板变更后的自动化质量验证

## 三大痛点

### 1. 成本黑盒 — Token 归因

```
问题：
  - GPT-4 调用一次 $0.03-$0.06，每天 10 万次调用 = $3,000-$6,000/天
  - 无法知道哪个用户、哪个功能、哪个 Prompt 模板消耗了多少 Token
  - 成本突然飙升时无法快速定位原因

解决：
  - 每次调用记录：input_tokens, output_tokens, model, prompt_template_id
  - 按 user_id, feature, model, prompt_version 聚合成本
  - 设置成本告警阈值，异常时自动通知
```

### 2. 延迟盲区 — 多步链路瓶颈

```
问题：
  - 一个 AI Agent 可能包含 3-5 个 LLM 调用 + 工具调用 + 后处理
  - 总延迟 8 秒，但不知道哪一步最慢
  - 用户体验差但无法定位瓶颈

解决：
  - Trace 树结构记录每步的 start_time, end_time, duration
  - 可视化调用链路，快速定位慢步骤
  - 按 P50/P95/P99 分位统计延迟分布
```

### 3. 幻觉调试 — Prompt 版本追溯

```
问题：
  - 用户反馈"AI 回答不准确"，但无法复现
  - 修改了 Prompt 模板，不知道是否影响了其他场景
  - 无法对比不同 Prompt 版本的质量差异

解决：
  - 每次调用记录完整的 input/output/prompt_template/metadata
  - Prompt 模板版本管理（Git 式追踪）
  - Golden Dataset + 自动化评估（LLM-as-Judge / 人工标注）
```

## 三大工具对比

### LangSmith

| 维度 | 详情 |
|------|------|
| **定位** | LangChain 生态官方可观测性平台 |
| **开源** | ❌ 商业 SaaS（有免费额度） |
| **部署** | 云端托管（LangChain 服务器） |
| **集成** | LangChain 深度 SDK 集成，自动 Trace |
| **Trace 结构** | 树状调用链，每个节点含 input/output/token/latency |
| **评估** | 内置评估框架，支持 LLM-as-Judge |
| **成本分析** | 按调用/用户/模型统计 Token 成本 |
| **适用** | 使用 LangChain 的团队，快速上手 |

```python
# LangSmith 集成（几乎零配置）
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "ls_..."
os.environ["LANGCHAIN_PROJECT"] = "my-project"

from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent

# 自动记录所有 LangChain 调用
llm = ChatOpenAI(model="gpt-4")
# 所有调用自动上报到 LangSmith
```

### LangFuse

| 维度 | 详情 |
|------|------|
| **定位** | 开源 LLM 可观测性平台 |
| **开源** | ✅ MIT 许可证 |
| **部署** | 自托管（Docker）或 LangFuse Cloud |
| **集成** | SDK 支持 Python/JS，LangChain/LlamaIndex/OpenAI 集成 |
| **Trace 结构** | Trace → Span → Generation，支持嵌套 |
| **评估** | 支持自定义评估函数，LLM-as-Judge |
| **成本分析** | Token 成本追踪，按模型/用户/标签 |
| **适用** | 需要自托管、数据合规、可定制性强的团队 |

```python
# LangFuse 集成
from langfuse import Langfuse
from langfuse.decorators import observe

langfuse = Langfuse(
    public_key="pk-...",
    secret_key="sk-...",
    host="https://cloud.langfuse.com"  # 或自托管地址
)

@observe()  # 自动追踪此函数
def ask_question(question: str) -> str:
    response = openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": question}],
    )
    # LangFuse 自动记录 input/output/token
    return response.choices[0].message.content

# 获取 trace_id 用于后续关联
trace_id = langfuse.get_current_trace_id()
```

### Helicone

| 维度 | 详情 |
|------|------|
| **定位** | LLM API 代理/网关层可观测性 |
| **开源** | ✅ Apache 2.0 |
| **部署** | 云端或自托管 |
| **集成** | 零代码——仅需修改 API Base URL |
| **工作原理** | API 代理模式：请求 → Helicone → OpenAI → 响应 |
| **评估** | 基础评估，需结合外部工具 |
| **成本分析** | 最强——实时成本看板、按用户/模型/标签 |
| **适用** | 快速接入、不想改代码、关注成本分析 |

```python
# Helicone 集成（零代码，只改 Base URL）
import openai

client = openai.OpenAI(
    base_url="https://oai.hconeai.com/v1",  # 只需改这一行
    default_headers={
        "Helicone-Auth": "Bearer sk-...",
        "Helicone-User-Id": "user-123",      # 可选：按用户追踪
        "Helicone-Property-Feature": "chat",  # 可选：自定义标签
    }
)

# 正常调用，Helicone 自动记录
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### 三工具对比表

| 维度 | LangSmith | LangFuse | Helicone |
|------|-----------|----------|----------|
| **开源** | ❌ 商业 | ✅ MIT | ✅ Apache 2.0 |
| **自托管** | ❌ | ✅ | ✅ |
| **集成方式** | SDK 深度集成 | SDK + Decorator | API 代理 |
| **代码侵入** | 中（需用 LangChain） | 低（Decorator） | 极低（改 URL） |
| **Trace 详情** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **成本分析** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **评估能力** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Prompt 管理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **社区生态** | LangChain 生态 | 独立社区 | 独立社区 |
| **学习曲线** | 中 | 低 | 极低 |
| **适用团队** | LangChain 用户 | 需要自托管 | 快速接入 |

## 关键指标

### 核心指标定义

| 指标 | 英文 | 定义 | 目标值 |
|------|------|------|--------|
| 首 Token 延迟 | TTFT (Time to First Token) | 从请求发送到收到第一个 Token 的时间 | < 500ms |
| Token 消耗 | Token Usage | 每次调用的 input + output token 数 | 按模型优化 |
| 每步成本 | Cost per Step | 每个 Trace 节点的美元成本 | $0.001-$0.05 |
| 端到端延迟 | E2E Latency | 整个 Agent 链路的总耗时 | < 5s |
| 幻觉率 | Hallucination Rate | 回答中包含虚假信息的比例 | < 5% |
| 成功率 | Success Rate | 用户满意/任务完成的比例 | > 90% |
| Token 效率 | Token Efficiency | 有效 Token / 总 Token | > 80% |

### 成本计算公式

```
单次调用成本 = (input_tokens × input_price + output_tokens × output_price) / 1000

GPT-4o:  input $2.50/1M,  output $10.00/1M
GPT-4:   input $30.00/1M, output $60.00/1M
Claude 3.5: input $3.00/1M, output $15.00/1M

示例：GPT-4o 调用，input 500 tokens，output 200 tokens
成本 = (500 × $2.50 + 200 × $10.00) / 1,000,000
     = ($1,250 + $2,000) / 1,000,000
     = $0.00325
```

## Trace 模型

### 树状调用链路

```
Trace (Root)
├── Span: User Query Processing (200ms)
│   ├── Generation: GPT-4o Classification (150ms, 300 tokens)
│   └── Span: Context Retrieval (50ms)
│       └── Generation: Embedding Search (30ms, 1536 tokens)
├── Span: Agent Reasoning (2000ms)
│   ├── Generation: GPT-4o Planning (800ms, 500 tokens)
│   ├── Tool: Database Query (200ms)
│   ├── Generation: GPT-4o Analysis (600ms, 400 tokens)
│   └── Tool: API Call (400ms)
└── Span: Response Generation (1500ms)
    └── Generation: GPT-4o Final Answer (1500ms, 800 tokens)

总计: 3700ms, 2136 tokens, $0.015
```

### 每个节点的数据模型

```json
{
  "trace_id": "tr_abc123",
  "span_id": "sp_def456",
  "parent_span_id": "sp_abc123",
  "name": "GPT-4o Planning",
  "type": "generation",
  "start_time": "2026-06-05T10:00:00.000Z",
  "end_time": "2026-06-05T10:00:00.800Z",
  "latency_ms": 800,
  "input": {
    "model": "gpt-4o",
    "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
    "temperature": 0.7,
    "max_tokens": 1000
  },
  "output": {
    "content": "...",
    "finish_reason": "stop"
  },
  "usage": {
    "input_tokens": 350,
    "output_tokens": 150,
    "total_tokens": 500
  },
  "cost_usd": 0.002375,
  "metadata": {
    "user_id": "user-123",
    "feature": "order-assistant",
    "prompt_version": "v2.3",
    "model_version": "gpt-4o-2024-08-06"
  },
  "scores": {
    "relevance": 0.92,
    "accuracy": 0.88,
    "hallucination": 0.05
  }
}
```

## 回归测试

### Prompt 模板版本管理

```python
# Prompt 版本管理
class PromptManager:
    def __init__(self, langfuse: Langfuse):
        self.langfuse = langfuse
    
    def get_prompt(self, name: str, version: int = None) -> str:
        """获取指定版本的 Prompt 模板"""
        prompt = self.langfuse.get_prompt(name, version=version)
        return prompt.compile(user_input="...")
    
    def create_version(self, name: str, template: str, config: dict):
        """创建新版本"""
        self.langfuse.create_prompt(
            name=name,
            prompt=template,
            config=config,  # model, temperature, etc.
            labels=["production"],  # 或 "staging", "testing"
        )
```

### Golden Dataset + 自动化评估

```python
# 定义 Golden Dataset
golden_dataset = [
    {
        "input": "订单 #12345 的状态是什么？",
        "expected_output": "订单 #12345 当前状态为：已发货",
        "expected_tools": ["query_order_status"],
        "tags": ["order", "status_query"],
    },
    {
        "input": "帮我取消订单 #67890",
        "expected_output": "订单 #67890 已成功取消",
        "expected_tools": ["cancel_order"],
        "tags": ["order", "cancellation"],
    },
]

# 自动化评估
class AgentEvaluator:
    def evaluate(self, trace_id: str, golden: dict) -> dict:
        trace = self.langfuse.get_trace(trace_id)
        
        return {
            "accuracy": self.check_accuracy(trace.output, golden["expected_output"]),
            "tool_usage": self.check_tools(trace.spans, golden["expected_tools"]),
            "latency_ms": trace.latency_ms,
            "cost_usd": trace.total_cost,
            "hallucination_score": self.detect_hallucination(
                trace.output, golden["expected_output"]
            ),
        }
    
    def run_regression(self, dataset: list, prompt_version: str):
        """运行回归测试"""
        results = []
        for golden in dataset:
            output = self.agent.run(golden["input"])
            trace_id = self.langfuse.get_current_trace_id()
            result = self.evaluate(trace_id, golden)
            result["prompt_version"] = prompt_version
            results.append(result)
        
        return self.generate_report(results)
```

### CI/CD 集成

```yaml
# .github/workflows/llm-regression.yml
name: LLM Regression Tests
on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'src/agents/**'

jobs:
  llm-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run LLM Regression Tests
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}
        run: |
          python scripts/run_eval.py \
            --dataset golden_dataset.json \
            --prompt-version ${{ github.sha }} \
            --threshold accuracy=0.9 latency_p95=5000 cost_per_call=0.05
      
      - name: Comment PR with Results
        uses: actions/github-script@v7
        with:
          script: |
            const results = require('./eval_results.json');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              body: `## LLM Evaluation Results\n
                Accuracy: ${results.accuracy}\n
                P95 Latency: ${results.latency_p95}ms\n
                Avg Cost: $${results.avg_cost}`
            });
```

## Laravel/PHP 集成

### SDK Wrapper

```php
// app/Services/AI/Observability/LangFuseClient.php
class LangFuseClient
{
    private string $baseUrl;
    private string $publicKey;
    private string $secretKey;
    private array $traces = [];

    public function __construct(
        string $baseUrl = 'https://cloud.langfuse.com',
        ?string $publicKey = null,
        ?string $secretKey = null,
    ) {
        $this->baseUrl = $baseUrl;
        $this->publicKey = $publicKey ?? config('ai.langfuse.public_key');
        $this->secretKey = $secretKey ?? config('ai.langfuse.secret_key');
    }

    public function trace(string $name, array $metadata = []): TraceBuilder
    {
        return new TraceBuilder($this, $name, $metadata);
    }

    public function generation(
        string $traceId,
        string $parentSpanId,
        string $model,
        array $input,
        array $output,
        array $usage,
    ): void {
        $this->traces[] = [
            'traceId' => $traceId,
            'parentSpanId' => $parentSpanId,
            'type' => 'generation',
            'model' => $model,
            'input' => $input,
            'output' => $output,
            'usage' => $usage,
            'cost' => $this->calculateCost($model, $usage),
            'timestamp' => now()->toIso8601String(),
        ];
    }

    public function flush(): void
    {
        if (empty($this->traces)) return;

        Http::withBasicAuth($this->publicKey, $this->secretKey)
            ->post("{$this->baseUrl}/api/public/ingestion", [
                'batch' => $this->traces,
            ]);

        $this->traces = [];
    }

    private function calculateCost(string $model, array $usage): float
    {
        $pricing = [
            'gpt-4o' => ['input' => 2.5, 'output' => 10.0],
            'gpt-4' => ['input' => 30.0, 'output' => 60.0],
            'claude-3-5-sonnet' => ['input' => 3.0, 'output' => 15.0],
        ];

        $p = $pricing[$model] ?? $pricing['gpt-4o'];
        return ($usage['input_tokens'] * $p['input'] + $usage['output_tokens'] * $p['output']) / 1_000_000;
    }
}
```

### Middleware 拦截

```php
// app/Http/Middleware/AIObservabilityMiddleware.php
class AIObservabilityMiddleware
{
    public function __construct(
        private LangFuseClient $langfuse,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->is('api/ai/*')) {
            return $next($request);
        }

        $trace = $this->langfuse->trace('api-request', [
            'user_id' => $request->user()?->id,
            'feature' => $request->route()->getName(),
            'method' => $request->method(),
            'path' => $request->path(),
        ]);

        $startTime = microtime(true);

        $response = $next($request);

        $trace->end([
            'status_code' => $response->getStatusCode(),
            'latency_ms' => (microtime(true) - $startTime) * 1000,
        ]);

        // 异步上传 Trace（不阻塞响应）
        dispatch(fn () => $this->langfuse->flush());

        return $response;
    }
}
```

### Async Trace Upload

```php
// app/Jobs/UploadTraceJob.php
class UploadTraceJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private array $traceData,
    ) {}

    public function handle(LangFuseClient $langfuse): void
    {
        $langfuse->ingest($this->traceData);
    }

    public function failed(\Throwable $exception): void
    {
        Log::warning('Trace upload failed', [
            'error' => $exception->getMessage(),
            'trace_data' => $this->traceData,
        ]);
    }
}
```

## 最佳实践

1. **从成本追踪开始** — 最快见效，Token 成本是 LLM 应用最大的"暗债"
2. **Trace 全链路** — 不只追踪 LLM 调用，也追踪工具调用、数据库查询、API 调用
3. **关联业务指标** — Trace 不只是技术指标，要关联用户满意度、任务完成率
4. **Prompt 版本化** — 每个 Prompt 模板都有版本号，变更可追溯
5. **自动化回归** — 每次 Prompt 变更都跑 Golden Dataset 评估
6. **设置告警** — 成本突增、延迟 P95 超阈值、幻觉率上升时自动通知
7. **采样策略** — 生产环境可按比例采样（如 10%），降低成本
8. **数据保留** — 设置合理的数据保留期（如 30 天详细数据，90 天聚合数据）

## 选型建议

```
使用 LangChain 生态 + 需要深度评估能力
  → LangSmith

需要自托管 + 数据合规 + 可定制性
  → LangFuse

快速接入 + 零代码 + 重点是成本分析
  → Helicone

组合使用（推荐）:
  → Helicone（API 代理，成本分析）+ LangFuse（自托管，深度 Trace）
```

## 相关概念

- [事件驱动架构](事件驱动架构.md) — AI Agent 的工具调用可建模为事件
- [工程效能度量](工程效能度量.md) — AI 可观测性是效能度量的 AI 扩展
- [API 治理进阶](API治理进阶.md) — LLM API 的治理与传统 API 治理的融合
- [流批一体计算引擎](流批一体计算引擎.md) — Trace 数据的实时聚合分析
- [分布式工作流引擎](分布式工作流引擎.md) — 多步 Agent 编排的可观测性

## 延伸阅读

- [AI Agent Observability 实战](/2026/06/05/ai-agent-observability-langsmith-langfuse-helicone/) — LangSmith vs LangFuse vs Helicone 实战对比
- [Rust 异步生态对比](/2026/06/05/rust-async-ecosystem-tokio-async-std-smol/) — 高性能 Agent Runtime 的底层技术选型
