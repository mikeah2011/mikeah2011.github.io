---

title: AI Agent A2A (Agent-to-Agent) 协议实战：Google A2A 标准与 MCP 的互补——多组织 Agent 互操作的开放协议
keywords: [AI Agent A2A, Agent, Google A2A, MCP, 协议实战, 标准与, 的互补, 多组织, 互操作的开放协议]
date: 2026-06-07 10:00:00
tags:
- AI Agent
- A2A
- MCP
- 分布式
- Google
categories:
- ai
description: 深入解析 Google A2A（Agent-to-Agent）协议与 MCP 互补架构，通过 Python/TypeScript 完整代码示例，详解 Agent Card、Task 生命周期、SSE 流式通信及多组织 Agent 互操作实战，助你构建生产级 Agent 协作系统。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



## 引言：从单体 Agent 到 Agent 互联网

2024-2025 年是 AI Agent 从实验室走向生产的关键窗口期。MCP（Model Context Protocol）解决了"Agent 如何连接工具和数据源"的问题，但在多组织、多系统的真实企业场景中，一个更根本的需求浮出水面：**Agent 之间如何互操作？**

想象一个典型场景：你公司的采购 Agent 需要与供应商的报价 Agent 协作，再经过内部审批 Agent 确认，最终由物流 Agent 完成交付安排。这些 Agent 可能运行在不同的云、不同的框架、不同的组织中。它们需要一个共同语言来发现彼此、协商任务、交换数据——这就是 **Google A2A（Agent-to-Agent）协议** 要解决的问题。

本文将深入解析 A2A 协议的架构设计、核心概念，与 MCP 的互补关系，并通过完整的 Python/TypeScript 代码示例，展示如何构建一个 A2A 兼容的 Agent 系统。

---

## 一、A2A 协议概述

### 1.1 什么是 A2A？

A2A（Agent-to-Agent）是 Google 于 2025 年 4 月正式发布的开放协议，旨在为不同组织、不同框架构建的 AI Agent 提供标准化的通信机制。与 MCP 聚焦于 Agent-to-Tool 的连接不同，A2A 专注于 **Agent-to-Agent** 的互操作。

A2A 协议的核心设计理念：

| 设计原则 | 说明 |
|---------|------|
| **协议无关性** | 基于 HTTP/JSON-RPC，不绑定特定 LLM 或框架 |
| **异步优先** | 支持长时间运行任务和推送通知 |
| **能力发现** | 通过 Agent Card 自描述能力 |
| **安全性** | 企业级认证和授权，支持 OpenAPI 安全方案 |
| **互操作性** | 不同组织的 Agent 可直接协作 |

### 1.2 A2A 解决了什么问题？

在 A2A 之前，Agent 互操作面临以下挑战：

- **碎片化的通信方式**：每个框架都有自己的 Agent 通信协议
- **能力发现困难**：无法标准化地描述和发现其他 Agent 的能力
- **缺乏任务管理**：长时间运行的协作任务没有统一的状态管理
- **安全边界模糊**：跨组织 Agent 交互缺乏清晰的安全模型

A2A 提供了一个统一的解决方案，让任何符合协议的 Agent 都能被其他 Agent 发现、调用和协作。

---

## 二、A2A 核心架构

A2A 协议定义了四个核心概念：**Agent Card**、**Task**、**Message** 和 **Artifact**。它们共同构成了 Agent 间通信的完整模型。

### 2.1 Agent Card：能力自描述

Agent Card 是 A2A 的"名片"，以 JSON 格式描述一个 Agent 的能力、端点和认证要求。它通常托管在 `/.well-known/agent.json` 路径下。

```json
{
  "name": "TravelBookingAgent",
  "description": "专业的旅行预订 Agent，支持机票、酒店和行程规划",
  "url": "https://travel-agent.example.com/a2a",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransitionHistory": true
  },
  "authentication": {
    "schemes": ["Bearer"],
    "credentials": "Authorization header with JWT token"
  },
  "defaultInputModes": ["text", "file"],
  "defaultOutputModes": ["text", "file"],
  "skills": [
    {
      "id": "flight-booking",
      "name": "机票预订",
      "description": "搜索和预订国内外航班",
      "tags": ["travel", "flight", "booking"],
      "examples": [
        "帮我查一下 6 月 15 日北京到上海的机票",
        "预订一张明天去东京的经济舱"
      ]
    },
    {
      "id": "hotel-booking",
      "name": "酒店预订",
      "description": "搜索和预订酒店",
      "tags": ["travel", "hotel", "booking"]
    }
  ],
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"]
}
```

Agent Card 的关键字段：

- **`url`**：A2A 服务端点
- **`capabilities`**：支持的协议能力（流式、推送通知等）
- **`skills`**：Agent 可执行的具体技能列表
- **`authentication`**：认证方案
- **`defaultInputModes` / `defaultOutputModes`**：支持的数据格式

### 2.2 Task：工作单元

Task 是 A2A 中的基本工作单元，代表一个需要 Agent 完成的任务。Task 有明确的生命周期状态：

```
submitted → working → input-required → completed
                    ↘ failed
                    ↘ canceled
```

```json
{
  "id": "task-20260607-001",
  "sessionId": "session-abc123",
  "status": {
    "state": "working",
    "message": {
      "role": "agent",
      "parts": [
        {
          "type": "text",
          "text": "正在为您搜索 6 月 15 日北京到上海的航班..."
        }
      ],
      "timestamp": "2026-06-07T10:05:00Z"
    },
    "progress": 45
  },
  "artifacts": []
}
```

Task 状态流转说明：

| 状态 | 含义 | 下一步 |
|------|------|--------|
| `submitted` | 任务已提交，等待处理 | → `working` |
| `working` | Agent 正在处理任务 | → `completed` / `failed` / `input-required` |
| `input-required` | 需要额外输入才能继续 | → `working`（收到输入后） |
| `completed` | 任务已完成 | 终态 |
| `failed` | 任务失败 | 终态 |
| `canceled` | 任务被取消 | 终态 |

### 2.3 Message：对话交换

Message 是 Agent 间通信的基本单位，包含一个或多个 Part：

```json
{
  "role": "user",
  "messageId": "msg-001",
  "parts": [
    {
      "type": "text",
      "text": "帮我查一下 6 月 15 日北京到上海的机票，经济舱"
    },
    {
      "type": "file",
      "file": {
        "name": "travel_preferences.json",
        "mimeType": "application/json",
        "data": "eyJwYXNzcG9ydCI6ICJFMTIzNDU2NzgifQ=="
      }
    }
  ]
}
```

### 2.4 Artifact：结构化输出

Artifact 是 Agent 完成任务后的输出产物，可以是文本、文件、结构化数据等：

```json
{
  "name": "flight-search-results",
  "description": "航班搜索结果",
  "parts": [
    {
      "type": "data",
      "data": {
        "flights": [
          {
            "airline": "中国国航",
            "flightNo": "CA1234",
            "departure": "PEK",
            "arrival": "SHA",
            "departureTime": "2026-06-15T08:00:00+08:00",
            "price": 1280,
            "currency": "CNY",
            "class": "economy"
          },
          {
            "airline": "东方航空",
            "flightNo": "MU5678",
            "departure": "PEK",
            "arrival": "SHA",
            "departureTime": "2026-06-15T10:30:00+08:00",
            "price": 1150,
            "currency": "CNY",
            "class": "economy"
          }
        ]
      }
    }
  ]
}
```

---

## 三、A2A vs MCP vs OpenAI Function Calling

理解 A2A 的定位，需要将它与现有的 Agent 通信方案进行对比。

### 3.1 三者对比表

| 维度 | A2A | MCP | OpenAI Function Calling |
|------|-----|-----|------------------------|
| **设计目标** | Agent 间互操作 | Agent 连接工具和数据 | LLM 调用函数 |
| **通信模式** | Agent ↔ Agent | Agent → Tool | LLM → Function |
| **协议基础** | HTTP/JSON-RPC | JSON-RPC 2.0 | HTTP REST API |
| **能力发现** | Agent Card | Tool Schema | Function 定义 |
| **异步支持** | ✅ 完整支持 | ❌ 同步为主 | ❌ 同步 |
| **跨组织** | ✅ 设计目标 | ⚠️ 需额外封装 | ❌ 通常内部使用 |
| **会话管理** | ✅ Session + Task | ❌ 无状态 | ❌ 无状态 |
| **标准化程度** | 开放协议 | 开放协议 | 私有规范 |
| **适用场景** | 多 Agent 协作 | 工具集成 | 单 Agent 功能扩展 |

### 3.2 A2A 与 MCP 的互补关系

这是最关键的问题：**A2A 和 MCP 不是竞争关系，而是互补关系**。

```
┌─────────────────────────────────────────────────┐
│                    Agent A                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  LLM    │  │  Tools  │  │  Data   │        │
│  └────┬────┘  └────▲────┘  └────▲────┘        │
│       │            │ MCP        │ MCP           │
│       │            │            │               │
│       ▼            │            │               │
│  ┌─────────────────┴────────────┘               │
│  │         A2A Protocol Layer                   │
│  └──────────────┬───────────────────────────────│
└─────────────────┼───────────────────────────────┘
                  │ A2A
                  ▼
┌─────────────────────────────────────────────────┐
│                    Agent B                       │
│  ┌─────────┐  ┌─────────┐                       │
│  │  LLM    │  │  Tools  │  ← MCP 连接外部工具    │
│  └────┬────┘  └────▲────┘                       │
│       │            │ MCP                         │
│       ▼            │                             │
│  ┌─────────────────┘                             │
│  │         A2A Protocol Layer                   │
│  └───────────────────────────────────────────────│
└─────────────────────────────────────────────────┘
```

**MCP 的角色**：Agent 内部的"神经系统"，连接 LLM 与工具、数据库、API。

**A2A 的角色**：Agent 间的"外交协议"，让不同组织的 Agent 能够发现、协商、协作。

一个典型的协作流程：

1. **用户** 向 Agent A 发送请求："帮我规划一次北京到东京的商务旅行"
2. **Agent A**（旅行规划 Agent）通过 MCP 连接日历工具，查看用户空闲时间
3. **Agent A** 通过 A2A 协议发现 **Agent B**（机票预订 Agent）的能力
4. **Agent A** 向 **Agent B** 发起 A2A Task："预订 6 月 15 日北京到东京的航班"
5. **Agent B** 通过 MCP 调用航空公司 API 完成搜索
6. **Agent B** 通过 A2A 返回搜索结果给 **Agent A**
7. **Agent A** 综合所有信息，向用户展示完整的旅行方案

---

## 四、A2A 协议详解

### 4.1 JSON-RPC 通信

A2A 基于 JSON-RPC 2.0 协议，所有请求和响应都遵循标准的 JSON-RPC 格式：

**发送任务（tasks/send）：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tasks/send",
  "params": {
    "id": "task-20260607-001",
    "sessionId": "session-abc",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "帮我搜索明天北京到上海的航班"
        }
      ]
    },
    "metadata": {
      "priority": "high",
      "source": "enterprise-erp"
    }
  }
}
```

**响应：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "task-20260607-001",
    "sessionId": "session-abc",
    "status": {
      "state": "completed",
      "message": {
        "role": "agent",
        "parts": [
          {
            "type": "text",
            "text": "已为您找到 3 个航班选择"
          }
        ]
      }
    },
    "artifacts": [
      {
        "name": "flight-results",
        "parts": [
          {
            "type": "data",
            "data": {
              "flights": [
                {"airline": "国航", "flightNo": "CA1501", "price": 1280},
                {"airline": "东航", "flightNo": "MU5101", "price": 1150},
                {"airline": "南航", "flightNo": "CZ3101", "price": 1080}
              ]
            }
          }
        ]
      }
    ]
  }
}
```

### 4.2 流式通信（Streaming）

对于长时间运行的任务，A2A 支持基于 Server-Sent Events (SSE) 的流式通信：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/sendSubscribe",
  "params": {
    "id": "task-20260607-002",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "生成一份详细的北京三日游行程规划"
        }
      ]
    }
  }
}
```

**SSE 流式响应：**

```
event: task-status
data: {"id":"task-20260607-002","status":{"state":"working","message":{"role":"agent","parts":[{"type":"text","text":"正在分析北京热门景点..."}]},"progress":20}}

event: task-status
data: {"id":"task-20260607-002","status":{"state":"working","message":{"role":"agent","parts":[{"type":"text","text":"正在规划路线..."}]},"progress":60}}

event: task-artifact
data: {"id":"task-20260607-002","artifact":{"name":"beijing-trip-plan","parts":[{"type":"text","text":"## 北京三日游行程\n\n### 第一天：故宫与天安门..."}]}}

event: task-status
data: {"id":"task-20260607-002","status":{"state":"completed","message":{"role":"agent","parts":[{"type":"text","text":"行程规划已完成！"}]},"progress":100}}
```

### 4.3 推送通知

对于跨长时间的异步任务，A2A 支持 Webhook 推送通知：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/send",
  "params": {
    "id": "task-20260607-003",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "监控明天北京到东京的机票价格，低于 3000 元时通知我"
        }
      ]
    },
    "pushNotification": {
      "url": "https://my-app.example.com/a2a/callback",
      "token": "secure-callback-token-xyz"
    }
  }
}
```

---

## 五、实战：用 Python 构建 A2A 兼容 Agent

### 5.1 项目结构

```
a2a-agent/
├── server.py          # A2A 服务端
├── client.py          # A2A 客户端
├── agent_card.json    # Agent Card 定义
├── requirements.txt
└── utils/
    ├── __init__.py
    ├── task_manager.py
    └── models.py
```

### 5.2 定义数据模型

```python
# utils/models.py
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Any
import uuid
from datetime import datetime


class TaskState(str, Enum):
    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


@dataclass
class TextPart:
    type: str = "text"
    text: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class FilePart:
    type: str = "file"
    name: str = ""
    mimeType: str = ""
    data: str = ""  # base64 encoded


@dataclass
class DataPart:
    type: str = "data"
    data: Any = None


@dataclass
class Message:
    role: str  # "user" or "agent"
    parts: list = field(default_factory=list)
    messageId: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(
        default_factory=lambda: datetime.utcnow().isoformat() + "Z"
    )


@dataclass
class TaskStatus:
    state: TaskState
    message: Optional[Message] = None
    progress: Optional[int] = None


@dataclass
class Artifact:
    name: str
    parts: list = field(default_factory=list)
    description: str = ""
    artifactId: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class Task:
    id: str
    sessionId: str
    status: TaskStatus
    artifacts: list = field(default_factory=list)
    history: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
```

### 5.3 Task Manager（任务管理器）

```python
# utils/task_manager.py
import asyncio
from typing import Dict, Optional, Callable, Awaitable
from .models import Task, TaskState, TaskStatus, Message, Artifact
import uuid


class TaskManager:
    def __init__(self):
        self.tasks: Dict[str, Task] = {}
        self.handlers: Dict[str, Callable] = {}
        self.sse_queues: Dict[str, asyncio.Queue] = {}

    def register_skill_handler(
        self, skill_id: str, handler: Callable
    ):
        """注册技能处理器"""
        self.handlers[skill_id] = handler

    def create_task(
        self, task_id: Optional[str] = None,
        session_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Task:
        """创建新任务"""
        task = Task(
            id=task_id or str(uuid.uuid4()),
            sessionId=session_id or str(uuid.uuid4()),
            status=TaskStatus(state=TaskState.SUBMITTED),
            metadata=metadata or {},
        )
        self.tasks[task.id] = task
        self.sse_queues[task.id] = asyncio.Queue()
        return task

    def get_task(self, task_id: str) -> Optional[Task]:
        """获取任务"""
        return self.tasks.get(task_id)

    async def update_task_state(
        self, task_id: str, state: TaskState,
        message: Optional[Message] = None,
        progress: Optional[int] = None,
    ):
        """更新任务状态并通知 SSE 订阅者"""
        task = self.tasks.get(task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")

        task.status = TaskStatus(
            state=state, message=message, progress=progress
        )
        task.history.append(task.status)

        # 通知 SSE 订阅者
        queue = self.sse_queues.get(task_id)
        if queue:
            await queue.put({
                "event": "task-status",
                "data": self._serialize_task(task),
            })

    async def add_artifact(self, task_id: str, artifact: Artifact):
        """添加产出物"""
        task = self.tasks.get(task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")

        task.artifacts.append(artifact)

        queue = self.sse_queues.get(task_id)
        if queue:
            await queue.put({
                "event": "task-artifact",
                "data": {
                    "id": task_id,
                    "artifact": self._serialize_artifact(artifact),
                },
            })

    async def subscribe(self, task_id: str):
        """SSE 订阅任务更新"""
        queue = self.sse_queues.get(task_id)
        if not queue:
            queue = asyncio.Queue()
            self.sse_queues[task_id] = queue

        while True:
            event = await queue.get()
            yield event
            task = self.tasks.get(task_id)
            if task and task.status.state in [
                TaskState.COMPLETED,
                TaskState.FAILED,
                TaskState.CANCELED,
            ]:
                break

    def _serialize_task(self, task: Task) -> dict:
        result = {
            "id": task.id,
            "sessionId": task.sessionId,
            "status": {
                "state": task.status.state.value,
            },
        }
        if task.status.message:
            result["status"]["message"] = {
                "role": task.status.message.role,
                "parts": [
                    {"type": p.type, "text": p.text}
                    for p in task.status.message.parts
                ],
            }
        if task.status.progress is not None:
            result["status"]["progress"] = task.status.progress
        if task.artifacts:
            result["artifacts"] = [
                self._serialize_artifact(a) for a in task.artifacts
            ]
        return result

    def _serialize_artifact(self, artifact: Artifact) -> dict:
        parts = []
        for p in artifact.parts:
            if p.type == "text":
                parts.append({"type": "text", "text": p.text})
            elif p.type == "data":
                parts.append({"type": "data", "data": p.data})
        return {
            "name": artifact.name,
            "description": artifact.description,
            "artifactId": artifact.artifactId,
            "parts": parts,
        }
```

### 5.4 A2A Server（服务端）

```python
# server.py
import asyncio
import json
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from utils.models import (
    TaskState, Message, TextPart, Artifact, DataPart
)
from utils.task_manager import TaskManager

app = FastAPI(title="A2A Travel Agent")
task_manager = TaskManager()


# ─── Agent Card ──────────────────────────────────────
AGENT_CARD = {
    "name": "TravelPlanningAgent",
    "description": "智能旅行规划 Agent，支持航班搜索、酒店推荐和行程规划",
    "url": "http://localhost:8000/a2a",
    "version": "1.0.0",
    "capabilities": {
        "streaming": True,
        "pushNotifications": True,
        "stateTransitionHistory": True,
    },
    "authentication": {
        "schemes": ["Bearer"],
    },
    "defaultInputModes": ["text/plain", "application/json"],
    "defaultOutputModes": ["text/plain", "application/json"],
    "skills": [
        {
            "id": "flight-search",
            "name": "航班搜索",
            "description": "搜索国内国际航班",
            "tags": ["travel", "flight"],
            "examples": [
                "查一下明天北京到上海的航班",
                "搜索下周五去东京的机票",
            ],
        },
        {
            "id": "trip-planning",
            "name": "行程规划",
            "description": "根据目的地生成旅行行程",
            "tags": ["travel", "planning"],
        },
    ],
}


@app.get("/.well-known/agent.json")
async def get_agent_card():
    """发布 Agent Card"""
    return AGENT_CARD


# ─── 处理逻辑 ────────────────────────────────────────
async def handle_flight_search(task_id: str, query: str):
    """处理航班搜索任务"""
    # 模拟搜索过程
    await task_manager.update_task_state(
        task_id, TaskState.WORKING,
        Message(role="agent", parts=[
            TextPart(text="正在搜索航班信息...")
        ]),
        progress=30,
    )
    await asyncio.sleep(1)

    await task_manager.update_task_state(
        task_id, TaskState.WORKING,
        Message(role="agent", parts=[
            TextPart(text="已找到航班，正在整理结果...")
        ]),
        progress=80,
    )
    await asyncio.sleep(0.5)

    # 返回结果
    artifact = Artifact(
        name="flight-results",
        description="航班搜索结果",
        parts=[
            DataPart(data={
                "query": query,
                "flights": [
                    {
                        "airline": "中国国航",
                        "flightNo": "CA1501",
                        "departure": "PEK",
                        "arrival": "SHA",
                        "price": 1280,
                    },
                    {
                        "airline": "东方航空",
                        "flightNo": "MU5101",
                        "price": 1150,
                    },
                ],
            }),
        ],
    )
    await task_manager.add_artifact(task_id, artifact)

    await task_manager.update_task_state(
        task_id, TaskState.COMPLETED,
        Message(role="agent", parts=[
            TextPart(text="航班搜索完成！已为您找到 2 个航班选项。")
        ]),
        progress=100,
    )


async def handle_trip_planning(task_id: str, query: str):
    """处理行程规划任务"""
    await task_manager.update_task_state(
        task_id, TaskState.WORKING,
        Message(role="agent", parts=[
            TextPart(text="正在规划行程...")
        ]),
        progress=20,
    )
    await asyncio.sleep(1.5)

    artifact = Artifact(
        name="trip-plan",
        description="旅行行程规划",
        parts=[
            TextPart(text=(
                "## 三日行程规划\n\n"
                "### 第一天：历史文化之旅\n"
                "- 上午：故宫博物院\n"
                "- 下午：天坛公园\n"
                "- 晚上：前门大街美食\n\n"
                "### 第二天：现代都市之旅\n"
                "- 上午：国家博物馆\n"
                "- 下午：798 艺术区\n"
                "- 晚上：三里屯\n\n"
                "### 第三天：自然风光之旅\n"
                "- 上午：颐和园\n"
                "- 下午：圆明园\n"
                "- 晚上：返程准备"
            )),
        ],
    )
    await task_manager.add_artifact(task_id, artifact)

    await task_manager.update_task_state(
        task_id, TaskState.COMPLETED,
        Message(role="agent", parts=[
            TextPart(text="行程规划已完成！")
        ]),
        progress=100,
    )


# 技能路由
SKILL_ROUTES = {
    "flight-search": handle_flight_search,
    "trip-planning": handle_trip_planning,
}


# ─── A2A 端点 ────────────────────────────────────────
@app.post("/a2a")
async def handle_a2a_request(request: Request):
    """处理 A2A JSON-RPC 请求"""
    body = await request.json()
    method = body.get("method")
    params = body.get("params", {})
    req_id = body.get("id")

    if method == "tasks/send":
        return await handle_send_task(req_id, params)
    elif method == "tasks/sendSubscribe":
        return await handle_subscribe_task(req_id, params)
    elif method == "tasks/get":
        return await handle_get_task(req_id, params)
    elif method == "tasks/cancel":
        return await handle_cancel_task(req_id, params)
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


async def handle_send_task(req_id, params):
    """同步任务处理"""
    task_id = params.get("id")
    message = params.get("message", {})
    session_id = params.get("sessionId")

    task = task_manager.create_task(
        task_id=task_id, session_id=session_id
    )

    # 提取查询文本
    query = ""
    for part in message.get("parts", []):
        if part.get("type") == "text":
            query = part.get("text", "")
            break

    # 简单路由逻辑：根据关键词选择技能
    handler = None
    if any(kw in query for kw in ["航班", "机票", "飞机"]):
        handler = handle_flight_search
    elif any(kw in query for kw in ["行程", "规划", "旅游"]):
        handler = handle_trip_planning

    if handler:
        await handler(task.id, query)
    else:
        await task_manager.update_task_state(
            task.id, TaskState.FAILED,
            Message(role="agent", parts=[
                TextPart(text="无法识别您的请求，请指定航班搜索或行程规划。")
            ]),
        )

    updated_task = task_manager.get_task(task.id)
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": task_manager._serialize_task(updated_task),
    }


async def handle_subscribe_task(req_id, params):
    """流式任务处理（SSE）"""
    task_id = params.get("id")
    message = params.get("message", {})

    task = task_manager.create_task(task_id=task_id)

    query = ""
    for part in message.get("parts", []):
        if part.get("type") == "text":
            query = part.get("text", "")
            break

    async def event_generator():
        # 启动后台任务
        handler = None
        if any(kw in query for kw in ["航班", "机票"]):
            handler = handle_flight_search
        elif any(kw in query for kw in ["行程", "规划"]):
            handler = handle_trip_planning

        if handler:
            asyncio.create_task(handler(task.id, query))

        async for event in task_manager.subscribe(task.id):
            event_type = event.get("event", "task-status")
            data = json.dumps(event.get("data", {}))
            yield f"event: {event_type}\ndata: {data}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
    )


async def handle_get_task(req_id, params):
    """获取任务状态"""
    task_id = params.get("id")
    task = task_manager.get_task(task_id)

    if not task:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32001, "message": f"Task not found: {task_id}"},
        }

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": task_manager._serialize_task(task),
    }


async def handle_cancel_task(req_id, params):
    """取消任务"""
    task_id = params.get("id")
    await task_manager.update_task_state(
        task_id, TaskState.CANCELED,
        Message(role="agent", parts=[
            TextPart(text="任务已被取消")
        ]),
    )

    task = task_manager.get_task(task_id)
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": task_manager._serialize_task(task),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 5.5 A2A Client（客户端）

```python
# client.py
import httpx
import json


class A2AClient:
    def __init__(self, base_url: str, token: str = None):
        self.base_url = base_url
        self.headers = {"Content-Type": "application/json"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        self._request_id = 0

    def _next_id(self):
        self._request_id += 1
        return self._request_id

    async def discover_agent(self, agent_url: str) -> dict:
        """发现远程 Agent 的能力"""
        well_known_url = agent_url.rstrip("/") + "/.well-known/agent.json"
        async with httpx.AsyncClient() as client:
            resp = await client.get(well_known_url)
            resp.raise_for_status()
            return resp.json()

    async def send_task(
        self, task_id: str, message_text: str,
        session_id: str = None, skill_id: str = None,
    ) -> dict:
        """发送同步任务"""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tasks/send",
            "params": {
                "id": task_id,
                "sessionId": session_id,
                "message": {
                    "role": "user",
                    "parts": [{"type": "text", "text": message_text}],
                },
            },
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self.base_url,
                json=payload,
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_task(self, task_id: str) -> dict:
        """查询任务状态"""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tasks/get",
            "params": {"id": task_id},
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self.base_url,
                json=payload,
                headers=self.headers,
            )
            return resp.json()

    async def cancel_task(self, task_id: str) -> dict:
        """取消任务"""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tasks/cancel",
            "params": {"id": task_id},
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self.base_url,
                json=payload,
                headers=self.headers,
            )
            return resp.json()

    async def send_task_stream(
        self, task_id: str, message_text: str
    ):
        """发送流式任务（SSE）"""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tasks/sendSubscribe",
            "params": {
                "id": task_id,
                "message": {
                    "role": "user",
                    "parts": [{"type": "text", "text": message_text}],
                },
            },
        }

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                self.base_url,
                json=payload,
                headers=self.headers,
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data = json.loads(line[6:])
                        yield data
```

### 5.6 使用示例

```python
# examples/basic_usage.py
import asyncio
from client import A2AClient


async def main():
    client = A2AClient("http://localhost:8000/a2a")

    # 1. 发现 Agent 能力
    print("=== 发现 Agent ===")
    card = await client.discover_agent("http://localhost:8000")
    print(f"Agent 名称: {card['name']}")
    print(f"技能列表: {[s['name'] for s in card['skills']]}")

    # 2. 同步发送任务
    print("\n=== 同步任务：航班搜索 ===")
    result = await client.send_task(
        task_id="task-001",
        message_text="帮我查一下明天北京到上海的航班",
    )
    print(f"任务状态: {result['result']['status']['state']}")

    artifacts = result['result'].get('artifacts', [])
    for artifact in artifacts:
        for part in artifact.get('parts', []):
            if part.get('type') == 'data':
                flights = part['data'].get('flights', [])
                print(f"找到 {len(flights)} 个航班:")
                for f in flights:
                    print(f"  - {f['airline']} {f.get('flightNo', '')} ¥{f['price']}")

    # 3. 流式任务
    print("\n=== 流式任务：行程规划 ===")
    async for event in client.send_task_stream(
        task_id="task-002",
        message_text="帮我规划一个北京三日游行程",
    ):
        if 'status' in event:
            state = event['status'].get('state')
            msg_parts = event['status'].get('message', {}).get('parts', [])
            if msg_parts:
                print(f"[{state}] {msg_parts[0].get('text', '')}")
        if 'artifact' in event:
            print(f"[产出物] {event['artifact'].get('name', '')}")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 六、TypeScript 实现

### 6.1 Agent Card 定义（TypeScript）

```typescript
// types/a2a.ts
interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Skill[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

interface Task {
  id: string;
  sessionId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: TaskStatus[];
  metadata?: Record<string, any>;
}

interface TaskStatus {
  state:
    | "submitted"
    | "working"
    | "input-required"
    | "completed"
    | "failed"
    | "canceled";
  message?: Message;
  progress?: number;
}

interface Message {
  role: "user" | "agent";
  parts: Part[];
  messageId?: string;
  timestamp?: string;
}

type Part = TextPart | FilePart | DataPart;

interface TextPart {
  type: "text";
  text: string;
  metadata?: Record<string, any>;
}

interface FilePart {
  type: "file";
  file: {
    name: string;
    mimeType: string;
    data: string; // base64
  };
}

interface DataPart {
  type: "data";
  data: any;
}

interface Artifact {
  name: string;
  description?: string;
  parts: Part[];
  artifactId?: string;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: Record<string, any>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
```

### 6.2 A2A Client（TypeScript）

```typescript
// src/a2a-client.ts
import EventSource from "eventsource";

interface A2AClientOptions {
  baseUrl: string;
  token?: string;
}

export class A2AClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private requestId = 0;

  constructor(options: A2AClientOptions) {
    this.baseUrl = options.baseUrl;
    this.headers = {
      "Content-Type": "application/json",
      ...(options.token
        ? { Authorization: `Bearer ${options.token}` }
        : {}),
    };
  }

  async discoverAgent(agentUrl: string): Promise<AgentCard> {
    const url = `${agentUrl.replace(/\/$/, "")}/.well-known/agent.json`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to discover agent: ${resp.status}`);
    }
    return resp.json();
  }

  async sendTask(
    taskId: string,
    messageText: string,
    sessionId?: string
  ): Promise<JSONRPCResponse> {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "tasks/send",
      params: {
        id: taskId,
        sessionId,
        message: {
          role: "user",
          parts: [{ type: "text", text: messageText }],
        },
      },
    };

    const resp = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });

    return resp.json();
  }

  async getTask(taskId: string): Promise<JSONRPCResponse> {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "tasks/get",
      params: { id: taskId },
    };

    const resp = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });

    return resp.json();
  }

  async *streamTask(
    taskId: string,
    messageText: string
  ): AsyncGenerator<any, void, unknown> {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "tasks/sendSubscribe",
      params: {
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "text", text: messageText }],
        },
      },
    };

    const resp = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!resp.body) {
      throw new Error("No response body for streaming");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            yield JSON.parse(line.slice(6));
          } catch (e) {
            // skip malformed JSON
          }
        }
      }
    }
  }
}

// 使用示例
async function main() {
  const client = new A2AClient({
    baseUrl: "http://localhost:8000/a2a",
  });

  // 发现 Agent
  const card = await client.discoverAgent("http://localhost:8000");
  console.log("Agent:", card.name);
  console.log("Skills:", card.skills.map((s) => s.name));

  // 发送任务
  const result = await client.sendTask(
    "ts-task-001",
    "帮我查一下明天北京到上海的航班"
  );

  if (result.result) {
    const task = result.result as Task;
    console.log("Status:", task.status.state);
    task.artifacts?.forEach((a) => {
      a.parts.forEach((p) => {
        if (p.type === "data") {
          console.log("Flights:", (p as DataPart).data.flights);
        }
      });
    });
  }

  // 流式任务
  console.log("\n--- Streaming ---");
  for await (const event of client.streamTask(
    "ts-task-002",
    "帮我规划一个北京三日游行程"
  )) {
    if (event.status) {
      console.log(`[${event.status.state}]`, event.status.message?.parts?.[0]?.text);
    }
  }
}

main().catch(console.error);
```

---

## 七、多组织 Agent 互操作实战场景

### 7.1 场景一：企业采购自动化

在一个典型的 B2B 采购场景中，涉及多个组织的 Agent 协作：

```
┌──────────────┐     A2A      ┌──────────────┐
│  采购 Agent  │ ◄──────────► │  供应商 Agent │
│  (买方)      │              │  (卖方)       │
└──────┬───────┘              └──────────────┘
       │ A2A
       ▼
┌──────────────┐     A2A      ┌──────────────┐
│  审批 Agent  │ ◄──────────► │  物流 Agent   │
│  (内部)      │              │  (第三方)     │
└──────────────┘              └──────────────┘
```

**采购 Agent 的 Agent Card：**

```json
{
  "name": "ProcurementAgent",
  "description": "企业采购自动化 Agent",
  "url": "https://procurement.company-a.com/a2a",
  "skills": [
    {
      "id": "create-rfq",
      "name": "创建询价单",
      "description": "根据需求创建询价单并发送给供应商"
    },
    {
      "id": "evaluate-bids",
      "name": "评估报价",
      "description": "对比多家供应商的报价并生成评估报告"
    }
  ]
}
```

**交互流程：**

1. 用户告诉采购 Agent："需要采购 100 台笔记本电脑"
2. 采购 Agent 创建询价单
3. 采购 Agent 通过 A2A 发现并调用多家供应商 Agent
4. 各供应商 Agent 返回报价（Artifact）
5. 采购 Agent 汇总结果，生成评估报告

### 7.2 场景二：Agent 市场（Agent Marketplace）

A2A 的 Agent Card 机制天然支持 Agent 市场的构建：

```python
# marketplace/registry.py
class AgentRegistry:
    """Agent 注册中心"""

    def __init__(self):
        self.agents: Dict[str, AgentCard] = {}

    async def register_agent(self, agent_url: str) -> AgentCard:
        """注册新 Agent"""
        client = A2AClient(agent_url)
        card = await client.discover_agent(agent_url)

        # 验证 Agent Card 的合法性
        self._validate_card(card)

        self.agents[card["name"]] = card
        return card

    def search_agents(self, skill_tag: str) -> list:
        """根据技能标签搜索 Agent"""
        results = []
        for name, card in self.agents.items():
            for skill in card.get("skills", []):
                if skill_tag in skill.get("tags", []):
                    results.append({
                        "agent": name,
                        "skill": skill,
                        "url": card["url"],
                    })
        return results

    def _validate_card(self, card: dict):
        """验证 Agent Card"""
        required = ["name", "url", "skills"]
        for field in required:
            if field not in card:
                raise ValueError(f"Missing required field: {field}")
```

### 7.3 场景三：跨云多 Agent 编排

在微服务架构中，A2A 可以作为跨云 Agent 编排的基础设施：

```python
# orchestrator/agent_orchestrator.py
class AgentOrchestrator:
    """多 Agent 编排器"""

    def __init__(self):
        self.clients: Dict[str, A2AClient] = {}
        self.task_graph: Dict[str, list] = {}

    async def discover_and_connect(self, agent_urls: list):
        """发现并连接多个 Agent"""
        for url in agent_urls:
            client = A2AClient(url)
            card = await client.discover_agent(url)
            self.clients[card["name"]] = client
            print(f"已连接: {card['name']} ({len(card['skills'])} 个技能)")

    async def execute_workflow(
        self, workflow: list
    ) -> Dict[str, Any]:
        """
        执行工作流
        workflow 格式:
        [
            {
                "agent": "TravelAgent",
                "skill": "flight-search",
                "input": "搜索明天北京到上海的航班",
                "depends_on": []
            },
            {
                "agent": "HotelAgent",
                "skill": "hotel-search",
                "input": "搜索上海酒店",
                "depends_on": ["step-1"]
            }
        ]
        """
        results = {}
        completed = set()

        for step in workflow:
            step_id = step.get("id", str(uuid.uuid4()))

            # 检查依赖
            for dep in step.get("depends_on", []):
                if dep not in completed:
                    raise ValueError(
                        f"Step {step_id} depends on {dep} which is not completed"
                    )

            # 执行任务
            client = self.clients.get(step["agent"])
            if not client:
                raise ValueError(f"Agent not found: {step['agent']}")

            result = await client.send_task(
                task_id=step_id,
                message_text=step["input"],
            )

            results[step_id] = result
            completed.add(step_id)

        return results
```

---

## 八、A2A 安全模型

### 8.1 认证与授权

A2A 协议内置了企业级安全支持：

```python
# security/auth.py
import jwt
from datetime import datetime, timedelta


class A2AAuthenticator:
    def __init__(self, secret_key: str):
        self.secret_key = secret_key

    def create_token(
        self, agent_id: str, permissions: list,
        expires_hours: int = 24
    ) -> str:
        """为 Agent 创建认证令牌"""
        payload = {
            "sub": agent_id,
            "permissions": permissions,
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(hours=expires_hours),
        }
        return jwt.encode(payload, self.secret_key, algorithm="HS256")

    def verify_token(self, token: str) -> dict:
        """验证 Agent 令牌"""
        try:
            return jwt.decode(
                token, self.secret_key, algorithms=["HS256"]
            )
        except jwt.ExpiredSignatureError:
            raise PermissionError("Token expired")
        except jwt.InvalidTokenError:
            raise PermissionError("Invalid token")

    def check_permission(self, token: str, required_permission: str) -> bool:
        """检查权限"""
        payload = self.verify_token(token)
        return required_permission in payload.get("permissions", [])
```

### 8.2 跨组织信任链

```
┌─────────────────────────────────────────────┐
│              Trust Broker                    │
│  (Certificate Authority / Identity Provider) │
└─────────┬───────────────┬───────────────────┘
          │               │
    ┌─────▼─────┐   ┌─────▼─────┐
    │  Org A    │   │  Org B    │
    │  Agent    │   │  Agent    │
    │  Trust    │   │  Trust    │
    │  Anchor   │   │  Anchor   │
    └───────────┘   └───────────┘
```

---

## 九、最佳实践与设计建议

### 9.1 Agent Card 设计原则

| 原则 | 说明 |
|------|------|
| **细粒度技能** | 每个 Skill 应聚焦单一职责 |
| **清晰的示例** | 在 Skill 中提供 `examples`，帮助调用方理解 |
| **版本管理** | 在 Card 中明确 `version` 字段 |
| **能力声明** | 准确声明支持的能力（streaming、push 等） |

### 9.2 错误处理

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Task not found",
    "data": {
      "taskId": "invalid-task-id",
      "suggestion": "Please check the task ID and try again"
    }
  }
}
```

标准错误码：

| 错误码 | 含义 |
|--------|------|
| -32700 | JSON 解析错误 |
| -32600 | 无效请求 |
| -32601 | 方法不存在 |
| -32602 | 无效参数 |
| -32001 | 任务不存在 |
| -32002 | 任务已取消 |
| -32003 | 认证失败 |

### 9.3 性能优化建议

1. **连接池复用**：对频繁通信的 Agent 使用 HTTP 连接池
2. **Agent Card 缓存**：缓存远端 Agent Card，避免重复发现
3. **批量任务**：对于批量操作，使用异步并发发送多个 Task
4. **流式优先**：对长时间任务优先使用 SSE 流式模式
5. **超时控制**：为每个 A2A 请求设置合理的超时时间

```python
# 示例：并发批量任务
async def batch_search(queries: list[str]) -> list:
    client = A2AClient("http://agent.example.com/a2a")

    tasks = [
        client.send_task(f"batch-{i}", query)
        for i, query in enumerate(queries)
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    successful = [r for r in results if not isinstance(r, Exception)]
    failed = [r for r in results if isinstance(r, Exception)]

    print(f"成功: {len(successful)}, 失败: {len(failed)}")
    return successful
```

---

## 十、A2A 生态与未来展望

### 10.1 当前生态

截至 2026 年中，A2A 协议已获得广泛的行业支持：

- **框架支持**：LangChain、CrewAI、AutoGen、Semantic Kernel 等主流框架已集成 A2A
- **云平台**：Google Cloud、AWS、Azure 均提供 A2A 托管服务
- **企业采用**：多家 Fortune 500 企业已在内部系统中试点 A2A

### 10.2 与 MCP 的融合趋势

随着 MCP 和 A2A 的成熟，一个统一的 Agent 互操作栈正在形成：

```
┌─────────────────────────────────────┐
│         用户界面 / API               │
├─────────────────────────────────────┤
│      Agent 编排层（LangGraph 等）     │
├─────────────────────────────────────┤
│      A2A 协议层（Agent 间通信）       │
├─────────────────────────────────────┤
│      MCP 协议层（Agent-Tool 连接）    │
├─────────────────────────────────────┤
│      基础设施（LLM / 数据库 / API）   │
└─────────────────────────────────────┘
```

### 10.3 未来方向

1. **Agent 身份标准化**：跨组织的 Agent 身份和信任体系
2. **协议增强**：更丰富的协商机制和多轮对话支持
3. **治理框架**：Agent 间交互的审计、合规和治理
4. **性能优化**：gRPC 传输层支持、二进制协议优化
5. **去中心化**：基于 DID（去中心化标识符）的 Agent 发现机制

---

## 总结

A2A 协议的出现，标志着 AI Agent 生态从"单体智能"走向"协作智能"的关键一步。它与 MCP 的互补关系，共同构建了一个完整的 Agent 互操作栈：

- **MCP 解决**：Agent 如何连接工具和数据 → Agent 内部的"神经系统"
- **A2A 解决**：Agent 如何与其他 Agent 协作 → Agent 间的"外交协议"

对于开发者而言，现在是拥抱 A2A 的最佳时机：

1. **为你的 Agent 添加 Agent Card**：让其他 Agent 能发现你的能力
2. **使用标准的 Task/Message 模型**：确保互操作性
3. **结合 MCP 构建完整的 Agent 系统**：内部用 MCP 连接工具，外部用 A2A 协作

Agent 互联网的时代正在到来，而 A2A 和 MCP 正是这个新时代的 TCP/IP。

---

> **参考资料**
>
> - [Google A2A 协议官方文档](https://github.com/google/A2A)
> - [A2A 协议规范](https://github.com/google/A2A/blob/main/spec)
> - [MCP 协议规范](https://modelcontextprotocol.io/)
> - [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)

---

## 相关阅读

- [AI Agent Tool Composition 实战：工具组合与编排——单工具调用 vs 多工具链 vs 并行工具的架构设计](/post/ai-agent-tool-composition-orchestration/)
- [AI Agent Debugging 实战：MCP Inspector/LangSmith Trace/日志回放——从黑盒到可调试的 Agent 开发工作流](/post/ai-agent-guide-claude-gpt-mimo-optimization/)
- [OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比](/post/openhuman-hermes-openclaw-ai-agent/)
