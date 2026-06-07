# Function Calling 与工具使用

## 定义

Function Calling（函数调用）是 LLM 与外部世界交互的核心机制。模型根据用户意图，生成结构化的函数调用请求（JSON 格式），由应用程序执行后将结果返回给模型，形成「观察 → 思考 → 行动 → 反馈」的 Agent 核心循环。

## 核心原理

### 工具定义与描述

```json
{
  "name": "search_orders",
  "description": "根据用户ID和时间范围搜索订单",
  "parameters": {
    "type": "object",
    "properties": {
      "user_id": { "type": "integer", "description": "用户ID" },
      "start_date": { "type": "string", "format": "date" },
      "end_date": { "type": "string", "format": "date" }
    },
    "required": ["user_id"]
  }
}
```

### 三种工具选择策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| `auto` | 模型自行决定是否调用工具 | 通用对话 |
| `required` | 强制模型调用至少一个工具 | 必须执行操作的场景 |
| `none` | 禁止工具调用 | 纯对话模式 |

### 并行工具调用（Parallel Tool Calls）

现代 LLM（GPT-4o、Claude 3.5、Gemini 1.5）支持在单次响应中返回多个工具调用请求，应用端可并行执行后一次性返回结果，显著减少交互轮次。

```python
# OpenAI 并行工具调用示例
response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    parallel_tool_calls=True  # 启用并行调用
)
# response.choices[0].message.tool_calls 可能包含多个调用
```

### 多模型对比

| 特性 | OpenAI GPT-4o | Claude 3.5 | Gemini 1.5 |
|------|--------------|------------|------------|
| 并行工具调用 | ✅ | ✅ | ✅ |
| 强制工具使用 | `tool_choice: "required"` | `tool_choice: {"type": "any"}` | `tool_config: "ANY"` |
| 流式工具调用 | ✅ | ✅ | ✅ |
| 工具结果分块 | ✅ | ✅ | ✅ |
| 嵌套工具调用 | ❌ | ❌ | ❌ |

## 实战案例

来自博客文章：
- [LLM Function Calling 进阶：并行工具调用与强制工具使用](/2026/06/05/2026-06-05-llm-function-calling-advanced-parallel-tool-calls-forced-tool-use/) - OpenAI/Anthropic/Gemini 多模型对比实战

## 相关概念

- [Agent 流式响应](Agent流式响应.md) - 流式工具调用的 Token 渲染
- [Agent 错误恢复与韧性](Agent错误恢复与韧性.md) - 工具调用失败的重试策略
- [Agent 工作流编排](Agent工作流编排.md) - 多工具编排与 DAG
- [Agent 安全与护栏](Agent安全与护栏.md) - 工具调用的安全限制

## 常见问题

### Q: 如何防止模型滥用工具？
通过 `tool_choice` 限制、系统提示约束、以及 Guardrails 护栏系统（见 [Agent 安全与护栏](Agent安全与护栏.md)）。

### Q: 工具调用失败怎么办？
采用指数退避重试 + 熔断器模式，详见 [Agent 错误恢复与韧性](Agent错误恢复与韧性.md)。

### Q: 如何优化工具调用的 Token 消耗？
工具描述要精简、使用 Schema 压缩、避免冗余参数，详见 [Agent 成本优化](Agent成本优化.md)。
