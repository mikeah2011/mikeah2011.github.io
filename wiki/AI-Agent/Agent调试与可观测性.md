# Agent 调试与可观测性

## 定义

Agent 调试与可观测性是指对 AI Agent 的推理过程、工具调用链、Token 消耗、延迟分布等进行全链路追踪、结构化日志记录和可视化分析的能力。从「黑盒」到「可调试」是 Agent 工程化的关键跨越。

## 核心原理

### MCP Inspector

MCP（Model Context Protocol）Inspector 是调试 MCP 服务器和工具调用的专用工具：

```bash
# 启动 MCP Inspector
npx @modelcontextprotocol/inspector

# 连接到 MCP 服务器
# 支持查看：工具列表、参数 Schema、调用历史、响应内容
```

**核心功能**：
- 工具发现：列出所有注册工具及其 Schema
- 调用测试：手动触发工具调用，查看返回结果
- 参数验证：检查参数是否符合 Schema 定义
- 错误诊断：查看工具执行错误详情

### LangSmith Trace

LangSmith 提供全链路追踪能力：

```python
from langsmith import traceable

@traceable(name="agent_reasoning")
def agent_reason(query: str):
    # 自动记录输入、输出、耗时
    response = llm.chat(messages)
    return response

@traceable(name="tool_execution")
def execute_tool(tool_name: str, params: dict):
    # 工具调用追踪
    result = tools[tool_name](**params)
    return result
```

**Trace 结构**：
```
Root Trace (agent_run)
├── Span: LLM Call (200ms)
│   ├── Input: messages
│   ├── Output: tool_calls
│   └── Tokens: 150 prompt + 30 completion
├── Span: Tool Execution (500ms)
│   ├── Tool: search_orders
│   ├── Params: {user_id: 123}
│   └── Result: [{...}]
├── Span: LLM Call (300ms)
│   └── Output: final_answer
└── Total: 1000ms, 450 tokens
```

### 结构化日志回放

将 Agent 执行过程记录为可回放的结构化日志：

```json
{
  "trace_id": "abc-123",
  "steps": [
    {
      "type": "llm_call",
      "timestamp": "2026-06-05T10:00:00Z",
      "input": {"messages": [...]},
      "output": {"tool_calls": [...]},
      "duration_ms": 200,
      "tokens": {"prompt": 150, "completion": 30}
    },
    {
      "type": "tool_call",
      "timestamp": "2026-06-05T10:00:00.2Z",
      "tool": "search_orders",
      "params": {"user_id": 123},
      "result": [...],
      "duration_ms": 500
    }
  ]
}
```

### 可观测性指标

| 指标 | 含义 | 告警阈值 |
|------|------|---------|
| TTFT | Time to First Token | > 2s |
| 工具调用延迟 | 工具执行耗时 | > 5s |
| Token 消耗 | 每次交互的 Token 数 | > 4000 |
| 幻觉率 | 生成内容与检索不一致的比例 | > 10% |
| 工具成功率 | 工具调用成功比例 | < 90% |
| 重试率 | 需要重试的请求比例 | > 20% |

## 实战案例

来自博客文章：
- [AI Agent Debugging：MCP Inspector / LangSmith Trace](/2026/06/05/2026-06-05-ai-agent-debugging-mcp-inspector-langsmith-trace-log-replay/) - 从黑盒到可调试的开发工作流

## 相关概念

- [Agent 评估体系](Agent评估体系.md) - 评估与调试互补
- [Agent 错误恢复与韧性](Agent错误恢复与韧性.md) - 错误诊断与恢复
- [Agent 成本优化](Agent成本优化.md) - Token 消耗监控

## 常见问题

### Q: Trace 数据量太大怎么办？
采样策略：关键路径 100% 采样，常规路径 10% 采样，错误路径 100% 采样。

### Q: 如何在生产环境启用调试？
使用条件采样 + 结构化日志，避免全量 Trace 影响性能。关键指标接入 Prometheus/Grafana 监控。
