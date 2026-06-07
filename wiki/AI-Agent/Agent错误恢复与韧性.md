# Agent 错误恢复与韧性

## 定义

Agent 错误恢复是指 AI Agent 在面对工具调用失败、LLM 幻觉、上下文窗口溢出、模型降级等异常情况时，能够自动检测、重试、降级或优雅处理的能力。韧性设计是 Agent 从 Demo 走向生产的关键。

## 核心原理

### 三类常见故障

#### 1. 工具调用失败
- 网络超时（API 调用超时）
- 权限不足（Token 过期、权限变更）
- 数据格式错误（返回值 Schema 不匹配）
- 服务不可用（下游服务宕机）

#### 2. LLM 幻觉
- 编造不存在的工具名
- 生成不符合 Schema 的参数
- 虚构事实性信息
- 错误引用检索结果

#### 3. 上下文溢出
- 对话轮次过多导致超出上下文窗口
- 工具返回结果过大
- 系统提示 + 记忆 + 对话总 Token 超限

### 韧性设计模式

#### 指数退避重试（Exponential Backoff）

```python
def retry_with_backoff(func, max_retries=3, base_delay=1):
    for attempt in range(max_retries):
        try:
            return func()
        except TransientError as e:
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
            time.sleep(delay)
```

#### 熔断器模式（Circuit Breaker）

```
关闭状态（正常调用）
    ↓ 连续失败 ≥ 阈值
打开状态（快速失败，不调用下游）
    ↓ 超时窗口到期
半开状态（允许一次试探调用）
    ↓ 成功 → 关闭状态
    ↓ 失败 → 打开状态
```

#### Schema 验证与自我反思

```python
def validate_and_reflect(response, expected_schema):
    # 1. Schema 验证
    if not validate_json(response, expected_schema):
        # 2. 自我反思：将错误信息反馈给 LLM
        reflection = llm.chat([
            {"role": "system", "content": "你的上一次输出格式有误"},
            {"role": "assistant", "content": response},
            {"role": "user", "content": f"期望格式：{expected_schema}，请修正"}
        ])
        return reflection
    return response
```

#### 上下文溢出处理

| 策略 | 实现 | 适用场景 |
|------|------|---------|
| 滑动窗口 | 保留最近 N 轮对话 | 长对话 |
| 摘要压缩 | LLM 生成对话摘要 | 中等长度对话 |
| 工具结果截断 | 限制工具返回长度 | 工具返回大数据 |
| 分块处理 | 将大任务拆分为子任务 | 复杂推理 |

### 模型降级策略

```
首选模型（GPT-4o）
    ↓ 失败/超时
备用模型（Claude 3.5）
    ↓ 失败/超时
降级模型（GPT-3.5-turbo）
    ↓ 失败
本地模型（Ollama llama3）
    ↓ 失败
返回错误提示
```

## 实战案例

来自博客文章：
- [AI Agent Error Recovery：工具失败、幻觉、上下文溢出](/2026/06/05/2026-06-05-ai-agent-error-recovery-tool-failure-hallucination-overflow-degradation-retry/) - 完整韧性设计模式

## 相关概念

- [Function Calling 与工具使用](Function-Calling与工具使用.md) - 工具调用的错误来源
- [Agent 工作流编排](Agent工作流编排.md) - Saga 补偿、死信队列
- [Agent 评估体系](Agent评估体系.md) - 幻觉检测评估
- [Agent 成本优化](Agent成本优化.md) - 模型降级降低成本

## 常见问题

### Q: 如何区分暂时性错误和永久性错误？
暂时性错误（网络超时、503）适合重试；永久性错误（权限不足、参数错误）应立即报告。通过 HTTP 状态码和错误类型判断。

### Q: 熔断器阈值怎么设置？
建议：连续 5 次失败打开熔断器，30 秒后进入半开状态，1 次成功关闭。根据服务 SLA 动态调整。
