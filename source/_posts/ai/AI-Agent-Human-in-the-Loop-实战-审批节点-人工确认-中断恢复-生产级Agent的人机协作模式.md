---
title: AI Agent Human-in-the-Loop 实战：审批节点、人工确认、中断恢复——生产级 Agent 的人机协作模式
date: 2026-06-06 10:00:00
description: "深入讲解 AI Agent Human-in-the-Loop (HITL) 人机协作模式的三种核心实现：审批节点、人工确认、中断恢复。基于 LangGraph interrupt/resume 机制，提供单级审批、多级审批、客服审核等完整代码实现，涵盖风险自适应路由、状态持久化、生产踩坑案例，适合需要构建安全可控 Agent 审批流的开发者。"
tags: [AI Agent, HITL, Human-in-the-Loop, LangGraph, LLM, 人机协作, 审批流]
categories: [AI]
cover: /images/covers/ai-agent-hitl-cover.jpg
---

## 前言

在实验室跑通 Agent demo 到部署生产，中间隔着一道鸿沟：**信任与控制**。当 Agent 需要删除数据、调用支付、发送邮件时，你敢让它全自动执行吗？

**Human-in-the-Loop（HITL）** 的核心命题——在 Agent 决策链路中插入人类判断节点，保留 AI 效率的同时守住安全底线。本文深入三种 HITL 模式：**审批节点**、**人工确认**、**中断恢复**，以 LangGraph 为主线给出完整实现。

---

## 一、为什么必须有 HITL

- **幻觉驱动的破坏性操作**：Agent 误判数据，删除不该删的记录
- **权限越界**：测试环境误操作生产数据库
- **合规风险**：金融、医疗等行业要求关键决策必须人类签字
- **级联故障**：基于错误信息做连锁决策，错误被放大

| 风险等级 | 自动化程度 | HITL 策略 |
|----------|-----------|-----------|
| 低（查询类） | 全自动 | 无需介入 |
| 中（写入类） | 半自动 | 人工确认 |
| 高（删除/支付） | 审批后执行 | 多级审批 |
| 关键（合规类） | 强制审批 | 审批+审计 |

---

## 二、审批节点（Approval Node）

### 2.1 LangGraph 的 interrupt/resume 机制

LangGraph 提供一等公民级中断/恢复支持。`interrupt()` 暂停图执行并返回信息给调用方，`Command(resume=)` 携带人类决策恢复执行。

```
Node A ──interrupt()──> 挂起 ──人类输入──> resume(value) ──> Node B
```

### 2.2 单级审批实现

```python
from langgraph.graph import StateGraph, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.sqlite import SqliteSaver
from typing import TypedDict, Literal
import uuid

class AgentState(TypedDict):
    task: str
    plan: str
    risk_level: str
    approval_result: str
    execution_result: str

def plan_node(state: AgentState) -> AgentState:
    plan = call_llm(f"为以下任务制定执行计划: {state['task']}")
    risk = assess_risk(plan)
    return {"plan": plan, "risk_level": risk}

def approval_node(state: AgentState) -> AgentState:
    if state["risk_level"] == "low":
        return {"approval_result": "auto_approved"}

    # interrupt() 暂停执行，等 resume 恢复
    human_decision = interrupt({
        "type": "approval_request",
        "task": state["task"],
        "plan": state["plan"],
        "risk_level": state["risk_level"],
        "timeout_seconds": 3600,
    })
    return {"approval_result": human_decision["result"]}

def route_after_approval(state: AgentState) -> Literal["execute", "reject"]:
    return "execute" if state["approval_result"] in ("approved", "auto_approved") else "reject"

def execute_node(state: AgentState) -> AgentState:
    return {"execution_result": execute_plan(state["plan"])}

def reject_node(state: AgentState) -> AgentState:
    return {"execution_result": "任务被拒绝，未执行"}

# 构建图
graph = StateGraph(AgentState)
graph.add_node("plan", plan_node)
graph.add_node("approval", approval_node)
graph.add_node("execute", execute_node)
graph.add_node("reject", reject_node)
graph.set_entry_point("plan")
graph.add_edge("plan", "approval")
graph.add_conditional_edges("approval", route_after_approval)
graph.add_edge("execute", END)
graph.add_edge("reject", END)

app = graph.compile(checkpointer=SqliteSaver.from_conn_string(":memory:"))

# 调用
config = {"configurable": {"thread_id": str(uuid.uuid4())}}
result = app.invoke({
    "task": "删除 30 天前的日志",
    "plan": "", "risk_level": "", "approval_result": "", "execution_result": ""
}, config)
# 图在 interrupt 处挂起，返回 interrupt 信息

# 人类审批后恢复
result = app.invoke(Command(resume={"result": "approved"}), config)
```

### 2.3 多级审批

```python
from enum import Enum

class ApprovalLevel(Enum):
    TEAM_LEAD = 1
    ARCHITECT = 2
    VP_ENG = 3

RISK_LEVEL_MAP = {
    "medium": [ApprovalLevel.TEAM_LEAD],
    "high": [ApprovalLevel.TEAM_LEAD, ApprovalLevel.ARCHITECT],
    "critical": [ApprovalLevel.TEAM_LEAD, ApprovalLevel.ARCHITECT, ApprovalLevel.VP_ENG],
}

def multi_level_approval(state: AgentState) -> AgentState:
    required = RISK_LEVEL_MAP.get(state["risk_level"], [])
    approval_log = []

    for level in required:
        result = interrupt({
            "type": "multi_level_approval",
            "current_level": level.name,
            "level_index": level.value,
            "total_levels": len(required),
            "plan": state["plan"],
            "previous_approvals": approval_log,
        })
        if result["action"] != "approve":
            return {"approval_result": f"rejected_at_{level.name}"}
        approval_log.append({"level": level.name, "approver": result["approver"]})

    return {"approval_result": "all_approved", "approval_log": approval_log}
```

超时兜底：审批不能无限等待，超时后执行安全默认操作（通常拒绝）。

---

## 三、人工确认（Human Confirmation）

确认发生在 Agent 已生成结果、准备输出之前——"让我看看 AI 做了什么"。

```python
def human_confirmation(state: AgentState) -> AgentState:
    result = interrupt({
        "type": "confirmation_gate",
        "draft": state["draft"],
        "options": ["approve", "edit", "reject"],
        "risk_flags": detect_risk_flags(state["draft"]),
    })

    if result["action"] == "approve":
        return {"final_response": state["draft"]}
    elif result["action"] == "edit":
        revised = call_llm(f"根据反馈修改:\n原稿: {state['draft']}\n反馈: {result['feedback']}")
        return {"final_response": revised}
    return {"final_response": "已取消"}
```

**风险自适应**：低风险自动放行，中风险异步通知，高风险强制确认。

---

## 四、中断恢复与状态持久化

生产环境使用 PostgreSQL 持久化：

```python
from langgraph.checkpoint.postgres import PostgresSaver

checkpointer = PostgresSaver.from_conn_string(
    "postgresql://user:***@localhost:5432/agent_db"
)
checkpointer.setup()
app = graph.compile(checkpointer=checkpointer)
```

### 完整客服 Agent

```python
from typing import Annotated
import operator

class CSState(TypedDict):
    query: str
    classification: str
    draft: str
    final_response: str
    history: Annotated[list, operator.add]

def classify(state: CSState) -> CSState:
    cls = call_llm(f"分类: {state['query']}\n类别: [billing, technical, general]")
    return {"classification": cls, "history": [f"[分类] {cls}"]}

def generate(state: CSState) -> CSState:
    draft = call_llm(f"问题: {state['query']}\n类型: {state['classification']}\n生成回复")
    return {"draft": draft, "history": [f"[草稿] {draft[:80]}..."]}

def review(state: CSState) -> CSState:
    result = interrupt({
        "query": state["query"],
        "draft": state["draft"],
        "options": ["approve", "edit", "escalate"],
    })
    if result["action"] == "approve":
        return {"final_response": state["draft"], "history": ["[审批] 通过"]}
    elif result["action"] == "edit":
        return {"final_response": result["text"], "history": ["[审批] 修改通过"]}
    return {"final_response": "已升级", "history": ["[审批] 升级工单"]}

graph = StateGraph(CSState)
for name, fn in [("classify", classify), ("generate", generate), ("review", review)]:
    graph.add_node(name, fn)
graph.set_entry_point("classify")
graph.add_edge("classify", "generate")
graph.add_edge("generate", "review")
graph.add_edge("review", END)
app = graph.compile(checkpointer=SqliteSaver.from_conn_string(":memory:"))
```

---

## 五、最佳实践与踩坑

### 最佳实践

1. **分层控制**：定义操作风险矩阵，按风险等级路由到不同 HITL 策略
2. **审计日志**：每次 interrupt/resume 的完整上下文都记录，用于复盘和合规
3. **超时兜底**：永远不让 Agent 无限挂起，设置合理超时和安全默认操作
4. **人类输入校验**：对反馈做基本校验，不盲目传给 LLM

### 常见踩坑案例

#### 踩坑 1：interrupt 返回值类型未校验

```python
# ❌ 错误：直接访问 dict key，类型不匹配时崩溃
result = interrupt({"type": "approval"})
action = result["action"]  # 如果人类返回的不是 dict，直接 KeyError

# ✅ 正确：做防御性类型检查
result = interrupt({"type": "approval"})
if not isinstance(result, dict) or "action" not in result:
    return {"approval_result": "rejected", "reason": "无效输入"}
action = result["action"]
```

#### 踩坑 2：长时间挂起导致数据库连接泄露

checkpointer 在 Agent 挂起期间保持连接，连接池配置不当会导致连接耗尽：

```python
# ❌ 错误：默认连接池，高并发下耗尽
checkpointer = PostgresSaver.from_conn_string(conn_string)

# ✅ 正确：设置连接池上限 + 连接回收
import psycopg
pool = psycopg.ConnectionPool(
    min_size=2, max_size=10,  # 限制最大连接
    conninfo=conn_string,
)
checkpointer = PostgresSaver(pool)
```

#### 踩坑 3：并发 resume 重复执行

多个 webhook 或 UI 按钮同时触发 resume，导致同一个审批操作被执行多次：

```python
# ✅ 幂等校验：用 approval_id 去重
def resume_approval(thread_id: str, approval_id: str, decision: str):
    existing = db.query("SELECT 1 FROM approvals WHERE id = %s", approval_id)
    if existing:
        return {"error": "该审批已处理"}
    db.execute("INSERT INTO approvals VALUES (%s)", approval_id)
    return app.invoke(Command(resume={"action": decision, "id": approval_id}), config)
```

#### 踩坑 4：审批 UI 缺少关键上下文

审批者看到的只有"是否执行？"，缺乏操作详情和风险评估，导致盲目审批。审批卡片至少需要：操作描述、影响范围、风险等级、历史操作记录。

#### 踩坑 5：interrupt 后状态未持久化，服务重启丢失上下文

开发环境用 `MemorySaver`，部署后忘记换 PostgreSQL，服务重启后所有挂起的审批全部丢失。务必在生产配置中切换到持久化 checkpointer。

#### 踩坑 6：LLM 重试耗尽 token

审批被拒绝后 Agent 自动重试修改方案，但没有设置重试上限，导致无限消耗 token：

```python
# ✅ 设置最大重试次数
def retry_node(state: AgentState) -> AgentState:
    if state.get("retry_count", 0) >= 3:
        return {"final_response": "已达到最大重试次数，任务终止"}
    return {"retry_count": state.get("retry_count", 0) + 1}
```

---

## 五点五、HITL 模式对比

| 特性 | 审批节点 (Approval) | 人工确认 (Confirmation) | 中断恢复 (Interrupt) |
|------|---------------------|------------------------|---------------------|
| **介入时机** | 操作执行**前** | 结果输出**前** | 任意节点 |
| **人类角色** | 审批者（决策权） | 检查者（修正权） | 恢复者（中断修复） |
| **典型场景** | 数据删除、支付调用 | 客户回复、代码部署 | 长流程断点续跑、故障恢复 |
| **状态保存** | 必须持久化 | 可选持久化 | 必须持久化 |
| **超时处理** | 默认拒绝 + 审计 | 自动放行或拒绝 | 重新执行或跳过 |
| **多级支持** | 天然支持（链式 interrupt） | 不适用 | 不适用 |
| **实现复杂度** | 中等 | 低 | 中等 |
| **LangGraph API** | `interrupt()` + `Command(resume=)` | 同左 | 同左 + checkpointer |
| **并发风险** | 高（需幂等校验） | 低 | 中等 |

### 选型决策流程图

```
Agent 要执行一个操作
  │
  ├── 操作不可逆/高风险？ ──是──> 审批节点（多级）
  │
  ├── 操作可逆/中风险？ ──是──> 人工确认（单次）
  │
  └── 流程可能中断/恢复？ ──是──> 中断恢复 + 持久化 checkpointer
```

---

## 五点七、LangGraph 完整进阶：带超时与重试的审批流

以下是一个生产级的完整实现，整合了超时兜底、重试计数、审计日志和状态持久化：

```python
from langgraph.graph import StateGraph, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.postgres import PostgresSaver
from typing import TypedDict, Literal, Annotated
import operator, time, uuid, json

class ProductionState(TypedDict):
    task: str
    plan: str
    risk_level: str
    approval_result: str
    retry_count: int
    max_retries: int
    audit_log: Annotated[list, operator.add]
    final_result: str

def plan_node(state: ProductionState) -> ProductionState:
    plan = call_llm(f"为以下任务制定执行计划:\n{state['task']}")
    risk = assess_risk(plan)
    return {
        "plan": plan,
        "risk_level": risk,
        "audit_log": [json.dumps({"step": "plan", "ts": time.time(), "risk": risk})]
    }

def approval_node(state: ProductionState) -> ProductionState:
    if state["risk_level"] == "low":
        return {
            "approval_result": "auto_approved",
            "audit_log": [json.dumps({"step": "auto_approve", "ts": time.time()})]
        }

    # 多级审批路由
    levels = {
        "medium": ["team_lead"],
        "high": ["team_lead", "architect"],
        "critical": ["team_lead", "architect", "vp_eng"],
    }
    required = levels.get(state["risk_level"], ["team_lead"])
    approval_log = []

    for level in required:
        result = interrupt({
            "type": "approval_request",
            "level": level,
            "task": state["task"],
            "plan": state["plan"],
            "timeout_seconds": 3600,  # 1小时超时
            "previous_approvals": approval_log,
        })

        # 超时或拒绝都中止
        if not isinstance(result, dict) or result.get("action") != "approve":
            reason = result.get("reason", "超时或无效输入") if isinstance(result, dict) else "无效输入"
            return {
                "approval_result": f"rejected_at_{level}",
                "audit_log": [json.dumps({
                    "step": "reject", "level": level, "reason": reason, "ts": time.time()
                })]
            }
        approval_log.append({"level": level, "approver": result.get("approver", "unknown")})

    return {
        "approval_result": "all_approved",
        "audit_log": [json.dumps({"step": "all_approved", "ts": time.time()})]
    }

def execute_node(state: ProductionState) -> ProductionState:
    return {
        "final_result": execute_plan(state["plan"]),
        "audit_log": [json.dumps({"step": "executed", "ts": time.time()})]
    }

def reject_node(state: ProductionState) -> ProductionState:
    # 重试逻辑：拒绝后可重试，超过上限则终止
    if state.get("retry_count", 0) < state.get("max_retries", 3):
        return {
            "retry_count": state.get("retry_count", 0) + 1,
            "audit_log": [json.dumps({
                "step": "retry",
                "count": state.get("retry_count", 0) + 1,
                "ts": time.time()
            })]
        }
    return {
        "final_result": "任务被拒绝，已达最大重试次数",
        "audit_log": [json.dumps({"step": "terminated", "ts": time.time()})]
    }

def route_after_approval(state: ProductionState) -> Literal["execute", "reject", "plan"]:
    if state["approval_result"] in ("approved", "all_approved", "auto_approved"):
        return "execute"
    if state.get("retry_count", 0) < state.get("max_retries", 3):
        return "plan"  # 重新规划
    return "reject"

# 构建图
graph = StateGraph(ProductionState)
graph.add_node("plan", plan_node)
graph.add_node("approval", approval_node)
graph.add_node("execute", execute_node)
graph.add_node("reject", reject_node)
graph.set_entry_point("plan")
graph.add_edge("plan", "approval")
graph.add_conditional_edges("approval", route_after_approval)
graph.add_edge("execute", END)
graph.add_edge("reject", END)

# 生产级持久化
checkpointer = PostgresSaver.from_conn_string(
    "postgresql://user:***@localhost:5432/agent_db"
)
app = graph.compile(checkpointer=checkpointer)

# 调用示例
config = {"configurable": {"thread_id": str(uuid.uuid4())}}
result = app.invoke({
    "task": "删除 30 天前的用户日志",
    "plan": "", "risk_level": "high",
    "approval_result": "", "retry_count": 0, "max_retries": 3,
    "audit_log": [], "final_result": ""
}, config)

# Agent 在 interrupt 处挂起...
# 人类审批后恢复：
result = app.invoke(Command(resume={"action": "approve", "approver": "张工"}), config)

# 查看审计日志
print(json.dumps(result["audit_log"], indent=2, ensure_ascii=False))
```

### 关键设计点

1. **审计日志链**：每个节点都追加日志，支持事后回溯完整决策链路
2. **重试循环**：`route_after_approval` 可路由回 `plan` 节点，让 Agent 根据反馈重新规划
3. **多级中断**：for 循环内的多个 `interrupt()` 调用天然形成审批链
4. **持久化 checkpointer**：服务重启后仍能恢复到中断点继续执行

---

## 六、总结

| 模式 | 时机 | 适用场景 |
|------|------|----------|
| 审批节点 | 操作执行前 | 删除数据、调用支付、发送通知 |
| 人工确认 | 结果生成后 | 客户回复、报告发布、代码部署 |
| 中断恢复 | 任意节点 | 长流程中断、故障断点续跑 |

核心原则：让 AI 做擅长的（快速推理、大量数据处理），让人做擅长的（价值判断、风险评估、最终决策）。HITL 是连接两者的桥梁，也是生产级 Agent 从 demo 走向落地的关键一步。

---

## 相关阅读

- [LangGraph 实战：有状态的 AI Agent 图编排——条件路由、循环与人机协作节点](/ai/2026-06-02-langgraph-stateful-agent-graph-orchestration/) — LangGraph 核心概念与完整实战案例
- [2026 开源 AI Agent 框架深度对比：Hermes vs OpenClaw vs OpenHuman](/ai/2026-open-source-ai-agent-hermes-vs-openclaw-vs-openhuman-deep-review/) — OpenHuman 的 HITL 机制对比分析
- [2026 主流 AI Agent 框架深度对比：LangChain/CrewAI/AutoGen/Dify/Coze 实战评测](/09_macOS/2026-主流-AI-Agent-框架深度对比-LangChain-CrewAI-AutoGen-Dify-Coze-实战评测/) — 各框架 HITL 支持横向对比
