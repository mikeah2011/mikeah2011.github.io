# Agent 工作流编排

## 定义

Agent 工作流编排是将复杂的 AI 任务分解为多个步骤，通过有向无环图（DAG）或状态机组织执行顺序，支持条件分支、循环、并行执行和人工审批的工程化模式。

## 核心原理

### 三种编排范式

#### 1. LangGraph（有状态图编排）

LangGraph 是 LangChain 生态中的图编排框架，基于 StateGraph 实现：

```python
from langgraph.graph import StateGraph, END

# 定义状态
class AgentState(TypedDict):
    messages: list
    tool_results: list
    iteration: int

# 构建图
graph = StateGraph(AgentState)
graph.add_node("reason", reason_node)
graph.add_node("act", act_node)
graph.add_node("observe", observe_node)

# 条件路由
graph.add_conditional_edges(
    "reason",
    should_act,  # 判断是否需要工具调用
    {True: "act", False: END}
)
graph.add_edge("act", "observe")
graph.add_edge("observe", "reason")  # 循环

# 中断点（Human-in-the-Loop）
graph.compile(interrupt_before=["act"])
```

**核心特性**：
- `StateGraph`：定义状态结构与节点
- 条件路由：根据状态动态选择下一节点
- `interrupt_before`/`interrupt_after`：人工审批点
- `MemorySaver`：持久化检查点

#### 2. Temporal（持久化工作流）

Temporal 提供分布式、持久化的工作流执行引擎：

```python
@workflow.defn
class AgentWorkflow:
    @workflow.run
    async def run(self, input: AgentInput):
        # 步骤1：检索
        docs = await workflow.execute_activity(
            retrieve, input.query, start_to_close_timeout=timedelta(seconds=30)
        )
        # 步骤2：生成
        response = await workflow.execute_activity(
            generate, docs, start_to_close_timeout=timedelta(seconds=60)
        )
        # 步骤3：人工审批（等待信号）
        await workflow.wait_condition(lambda: self.approved)
        # 步骤4：执行
        await workflow.execute_activity(execute, response)
```

**核心特性**：
- 持久化执行（进程崩溃后自动恢复）
- 超时与重试策略
- 信号机制（Human-in-the-Loop）
- 版本管理（工作流热更新）

#### 3. Inngest（Durable Functions for PHP/Laravel）

```php
// Laravel Inngest Durable Function
Inngest::createFunction(
    new FunctionOptions(id: 'order-processing'),
    new EventTrigger('order.created'),
    function (Event $event, Step $step) {
        // 步骤1：验证库存
        $inventory = $step->run('check-inventory', fn() => 
            InventoryService::check($event->data['items'])
        );
        
        // 步骤2：等待支付（最长 30 分钟）
        $payment = $step->waitForEvent('payment.completed', 
            new WaitForEventOptions(timeout: '30m')
        );
        
        // 步骤3：发货
        $step->run('ship', fn() => ShippingService::ship($event->data));
    }
);
```

### Saga 补偿模式

分布式事务中的补偿机制：

```
步骤1（成功）→ 步骤2（成功）→ 步骤3（失败！）
                                      ↓
                              补偿步骤2（回滚）
                                      ↓
                              补偿步骤1（回滚）
```

### Human-in-the-Loop

在关键决策点插入人工审批：

| 审批时机 | 场景 | 实现方式 |
|---------|------|---------|
| 工具调用前 | 敏感操作确认 | `interrupt_before` |
| 生成后执行前 | 内容审核 | Webhook 审批界面 |
| 异常处理时 | 故障升级 | 通知 + 等待信号 |

## 实战案例

来自博客文章：
- [AI Agent Long-Running Tasks：持久化状态与 Human-in-the-Loop](/2026/06/05/2026-06-05-ai-agent-long-running-tasks-durable-state-checkpoint-human-approval/) - Temporal/Inngest/DAG 对比
- [LangGraph：有状态 Agent 图编排](/2026/06/02/2026-06-02-langgraph-stateful-agent-graph-orchestration/) - StateGraph 条件路由实战

## 相关概念

- [Function Calling 与工具使用](Function-Calling与工具使用.md) - 工具调用是工作流的原子步骤
- [Agent 错误恢复与韧性](Agent错误恢复与韧性.md) - Saga 补偿、死信队列
- [Agent 流式响应](Agent流式响应.md) - 工作流中间状态的实时推送
- [Agent 评估体系](Agent评估体系.md) - 工作流质量评估

## 常见问题

### Q: LangGraph vs Temporal 怎么选？
- LangGraph：Python 生态、LangChain 集成、适合研究/原型
- Temporal：多语言支持、生产级可靠性、适合关键业务
- Inngest：PHP/Laravel 生态、Serverless 友好

### Q: 如何处理长时间运行的工作流？
使用 Temporal/Inngest 的持久化机制，配合检查点（Checkpoint）和心跳（Heartbeat），确保进程崩溃后可恢复。
