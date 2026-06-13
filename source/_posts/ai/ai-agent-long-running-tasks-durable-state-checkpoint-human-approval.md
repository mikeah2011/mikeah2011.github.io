---

title: AI Agent Long-Running Tasks 实战：持久化状态、断点恢复、人机审批节点——生产级 Agent 的长时间运行任务编排
keywords: [AI Agent Long, Running Tasks, Agent, 持久化状态, 断点恢复, 人机审批节点, 生产级, 的长时间运行任务编排]
date: 2026-06-05 10:00:00
tags:
- AI Agent
- workflow
- durable-execution
- Human-in-the-Loop
- Temporal
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: AI Agent 长运行任务的核心挑战在于持久化状态、断点恢复与人机审批。本文系统探讨 Temporal.io、Inngest 与自建方案三条技术路线，覆盖 DAG 工作流引擎、Saga 补偿模式、死信队列与状态版本兼容性踩坑，帮助你为生产级 Agent 选择最合适的 durable execution 架构。
---




## 为什么 Agent 需要"长时间运行"能力？

在 2024 到 2025 年的 Agent 应用浪潮中，绝大多数演示都是"一句话输入、调用一两个工具、立刻返回结果"的短生命周期模式。这种模式看起来很酷，但它只能覆盖最简单的场景——查天气、写一段代码片段、总结一篇短文章。

然而，当你试图把 Agent 部署到真正的生产环境中时，你会发现很多真实业务任务的执行时间远远超出了"几秒钟"这个范畴。举几个典型的例子：一份完整的代码安全审计需要扫描数万个文件、运行多个静态分析工具、再由大模型逐个审查高风险代码段，整个过程可能耗时数小时；一次跨系统的数据迁移需要在十多个微服务之间协调、校验数据一致性、分批执行转换脚本，加上中间的人工确认环节，整个流程可能跨越好几天；一份投资尽职调查报告需要从数十个数据源抓取信息、执行多轮数据清洗和交叉验证、生成初稿后还需要多级审批，每一步都可能因为网络波动、API 限流或审批人出差而中断。

这类长运行任务的核心挑战不在于"能不能实现"，而在于"执行到一半出了问题怎么办"。进程可能崩溃、网络可能超时、大模型的 API 可能限流、负责审批的同事可能今天休假——任何一个环节出问题，如果没有完善的持久化状态和断点恢复机制，你就只能从头再来。想象一下，一个已经运行了四小时的审计任务在最后一步崩溃，然后你告诉用户"请重新开始，预计再等四小时"——这在生产环境中是完全不可接受的。

这篇文章将从实战角度出发，系统性地探讨如何构建一个生产级的 Agent 长运行任务编排系统。我们会覆盖状态持久化、断点恢复、人机审批节点、Saga 补偿模式、死信队列等核心概念，并通过完整的代码示例来展示这些模式的具体实现。同时，我们会对比 Inngest、Temporal.io 和自建方案这三种主流技术路线的优劣，帮助你根据实际场景做出合理的技术选型。

---

## 一、长运行 Agent 的五大核心挑战

在深入代码之前，我们先梳理清楚长运行 Agent 面临的五个核心工程挑战，以及每个挑战的本质是什么。

### 1.1 状态持久化：Agent 的记忆不能只活在内存中

短运行 Agent 可以把所有状态都放在内存里——当前的对话上下文、已调用的工具列表、中间计算结果。但长运行 Agent 不行。一个持续数小时的工作流在任意时刻都可能因为进程重启、服务器迁移或部署更新而中断，内存中的状态会全部丢失。因此，我们需要一种机制，能够在每个关键节点将 Agent 的完整状态序列化到持久化存储中，并在恢复时能精确地重建到中断前的状态。这不仅仅是"把数据存到数据库"那么简单——你需要考虑序列化格式的向后兼容性、状态数据的版本控制、以及如何在并发场景下防止多个 worker 同时修改同一份状态。

### 1.2 断点恢复：从上次失败的地方继续，而非从头开始

断点恢复是状态持久化的自然延伸。它要求系统能够判断"上次执行到了哪一步"、"那一步的输入和输出分别是什么"、"中间生成了哪些可复用的结果"，然后从这个断点无缝地继续执行。这在概念上类似于数据库的 WAL（预写日志）或者视频播放器的断点续传——核心思想是一致的，但实现层面要考虑的问题要复杂得多。比如，一个正在调用大模型 API 的步骤在等待响应的过程中崩溃了，恢复时你需要知道这次 API 调用到底有没有成功（可能服务端已经处理了但响应还没到达客户端），然后决定是重试还是跳过。

### 1.3 人机审批：Agent 必须学会耐心等待人类

这是长运行 Agent 最独特的挑战，也是它和普通批处理任务最大的区别。在很多业务场景中，Agent 在执行某些关键操作之前必须获得人类的批准——比如发送一封重要邮件、修改生产数据库中的数据、或者批准一笔大额交易。这个审批等待的时间是完全不确定的：审批人可能五分钟内就回复了，也可能因为时差、出差或其他原因需要两天才响应。系统必须能够在等待期间保持状态、处理超时、支持审批升级，而且这一切都不能阻塞其他不相关的工作流。

### 1.4 错误处理与 Saga 补偿：失败后的优雅回滚

当一个包含十个步骤的工作流在第七步失败时，前六步可能已经产生了副作用——创建了云资源、发送了通知、修改了数据库记录。简单的"重试"并不能解决问题（前六步的结果可能已经不需要了），你需要一种补偿机制来撤销已完成步骤的副作用。这就是分布式系统中经典的 Saga 模式在 Agent 编排场景中的应用。需要强调的是，补偿不是完美的：有些副作用是不可逆的（比如发出去的邮件、对第三方 API 的调用），对于这些情况你需要接受"尽力补偿"的策略，并将无法补偿的操作记录到死信队列中等待人工处理。

### 1.5 可观测性：在迷雾中找到卡住的那一步

当一个工作流已经运行了六个小时，你怎么知道它当前卡在了哪一步？是正在等待大模型响应，还是在等待人类审批，还是某个外部服务超时了？可观测性对于长运行任务来说不是"锦上添花"，而是"生存必需"。你需要结构化的日志、分布式追踪、以及关键指标的实时监控。没有这些，你面对一个卡住的工作流时只能盲猜，而盲猜在生产环境中意味着灾难。

---

## 二、持久化状态管理：把 Agent 的记忆存到硬盘上

### 2.1 状态模型设计

一个长运行 Agent 的状态可以拆解为三层：工作流级别（整体进度、全局上下文）、步骤级别（每个步骤的输入输出和执行状态）、以及检查点级别（步骤内部的增量保存点）。下面是一个用 Python dataclass 实现的状态模型：

```python
from dataclasses import dataclass, field
from enum import Enum
import time

class StepStatus(Enum):
    """步骤执行状态枚举"""
    PENDING = "pending"            # 等待执行
    RUNNING = "running"            # 正在执行
    COMPLETED = "completed"        # 执行完成
    FAILED = "failed"              # 执行失败
    WAITING_APPROVAL = "waiting_approval"  # 等待人工审批
    COMPENSATING = "compensating"  # 正在执行补偿操作
    COMPENSATED = "compensated"    # 补偿完成

@dataclass
class StepState:
    """单个步骤的执行状态"""
    step_id: str
    name: str
    status: StepStatus
    input_data: dict
    output_data: dict | None = None
    error: str | None = None
    started_at: float | None = None
    completed_at: float | None = None
    retry_count: int = 0
    checkpoint_data: dict = field(default_factory=dict)

    @property
    def duration(self) -> float | None:
        """计算步骤执行耗时"""
        if self.started_at and self.completed_at:
            return self.completed_at - self.started_at
        elif self.started_at:
            return time.time() - self.started_at
        return None

@dataclass
class WorkflowState:
    """整个工作流的完整状态"""
    workflow_id: str
    workflow_type: str
    steps: list[StepState]
    global_context: dict          # 跨步骤共享的上下文数据
    status: str = "running"       # running | completed | failed | cancelled
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    version: int = 0              # 乐观锁版本号，用于并发控制

    def get_step(self, step_id: str) -> StepState | None:
        for s in self.steps:
            if s.step_id == step_id:
                return s
        return None

    def get_completed_steps(self) -> list[StepState]:
        return [s for s in self.steps if s.status == StepStatus.COMPLETED]
```

这里有一个重要的设计决策：`version` 字段。在分布式部署场景中，多个 worker 进程可能同时尝试恢复同一个工作流。乐观锁机制可以确保只有一个 worker 能成功更新状态，其他 worker 会收到版本冲突异常并放弃。这比使用悲观锁（数据库行锁）的性能好得多，因为长运行任务的状态更新频率通常很低，冲突是小概率事件。

### 2.2 存储后端选型：SQLite、PostgreSQL 与 Redis

#### SQLite：单机部署的最优解

对于单机部署或中小规模场景，SQLite 是一个被严重低估的选择。很多工程师一提到"持久化"就想到 PostgreSQL 或 MySQL，但对于长运行 Agent 这种写入频率低、读取模式简单的场景，SQLite 提供了零运维成本、事务安全保障和足够的性能。SQLite 的 WAL（预写日志）模式允许多个读操作并发进行，虽然写操作仍然需要串行化，但对于我们的场景完全够用。

下面是基于 SQLite 的状态存储实现：

```python
import sqlite3
import json
import time
from contextlib import contextmanager

class VersionConflictError(Exception):
    """乐观锁版本冲突异常"""
    pass

class SQLiteStateStore:
    """基于 SQLite 的工作流状态持久化存储"""

    def __init__(self, db_path: str = "agent_workflows.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """初始化数据库表结构"""
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS workflow_states (
                    workflow_id TEXT PRIMARY KEY,
                    workflow_type TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS step_checkpoints (
                    workflow_id TEXT,
                    step_id TEXT,
                    checkpoint_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (workflow_id, step_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS approval_requests (
                    request_key TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    response_json TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dead_letters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workflow_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    error_message TEXT NOT NULL,
                    checkpoint_json TEXT,
                    status TEXT NOT NULL DEFAULT 'pending_review',
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL
                )
            """)
            # 创建常用查询的索引
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_workflow_updated
                ON workflow_states(workflow_type, updated_at)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_approval_status
                ON approval_requests(status, created_at)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_dlq_status
                ON dead_letters(status, created_at)
            """)

    @contextmanager
    def _conn(self):
        """获取数据库连接的上下文管理器，自动提交或回滚"""
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")  # 避免写锁冲突
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def save_state(self, state: WorkflowState) -> bool:
        """
        保存工作流状态。使用乐观锁防止并发覆盖。
        如果版本号不匹配，抛出 VersionConflictError。
        """
        state.updated_at = time.time()
        serialized = json.dumps(self._serialize_state(state), ensure_ascii=False)

        with self._conn() as conn:
            result = conn.execute(
                """UPDATE workflow_states
                   SET state_json = ?, version = version + 1, updated_at = ?
                   WHERE workflow_id = ? AND version = ?""",
                (serialized, state.updated_at, state.workflow_id, state.version)
            )
            if result.rowcount == 1:
                state.version += 1
                return True

            # 可能是新记录
            try:
                conn.execute(
                    """INSERT INTO workflow_states
                       (workflow_id, workflow_type, state_json, version, created_at, updated_at)
                       VALUES (?, ?, ?, 0, ?, ?)""",
                    (state.workflow_id, state.workflow_type, serialized,
                     state.created_at, state.updated_at)
                )
                return True
            except sqlite3.IntegrityError:
                raise VersionConflictError(
                    f"Workflow {state.workflow_id} version conflict at v{state.version}"
                )

    def load_state(self, workflow_id: str) -> WorkflowState | None:
        """从数据库加载工作流状态"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT state_json FROM workflow_states WHERE workflow_id = ?",
                (workflow_id,)
            ).fetchone()
            if row:
                return self._deserialize_state(json.loads(row[0]))
        return None

    def save_checkpoint(self, workflow_id: str, step_id: str, data: dict):
        """保存单个步骤的检查点数据"""
        with self._conn() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO step_checkpoints
                   (workflow_id, step_id, checkpoint_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (workflow_id, step_id, json.dumps(data, ensure_ascii=False),
                 time.time(), time.time())
            )

    def load_checkpoint(self, workflow_id: str, step_id: str) -> dict | None:
        """加载单个步骤的检查点数据"""
        with self._conn() as conn:
            row = conn.execute(
                """SELECT checkpoint_json FROM step_checkpoints
                   WHERE workflow_id = ? AND step_id = ?""",
                (workflow_id, step_id)
            ).fetchone()
            if row:
                return json.loads(row[0])
        return None

    def _serialize_state(self, state: WorkflowState) -> dict:
        return {
            "workflow_id": state.workflow_id,
            "workflow_type": state.workflow_type,
            "status": state.status,
            "steps": [
                {
                    "step_id": s.step_id,
                    "name": s.name,
                    "status": s.status.value,
                    "input_data": s.input_data,
                    "output_data": s.output_data,
                    "error": s.error,
                    "started_at": s.started_at,
                    "completed_at": s.completed_at,
                    "retry_count": s.retry_count,
                    "checkpoint_data": s.checkpoint_data,
                }
                for s in state.steps
            ],
            "global_context": state.global_context,
            "created_at": state.created_at,
            "updated_at": state.updated_at,
            "version": state.version,
        }

    def _deserialize_state(self, data: dict) -> WorkflowState:
        steps = [
            StepState(
                step_id=s["step_id"],
                name=s["name"],
                status=StepStatus(s["status"]),
                input_data=s["input_data"],
                output_data=s.get("output_data"),
                error=s.get("error"),
                started_at=s.get("started_at"),
                completed_at=s.get("completed_at"),
                retry_count=s.get("retry_count", 0),
                checkpoint_data=s.get("checkpoint_data", {}),
            )
            for s in data["steps"]
        ]
        return WorkflowState(
            workflow_id=data["workflow_id"],
            workflow_type=data["workflow_type"],
            steps=steps,
            global_context=data["global_context"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            version=data["version"],
        )
```

为什么我说 SQLite 被"严重低估"？因为很多工程师在选型时会下意识地跳过它，觉得它"不够专业"。但实际上，对于单机部署的 Agent 系统，SQLite 提供了你所需要的一切：ACID 事务、JSON 存储、零配置、零运维。更重要的是，SQLite 数据库就是一个普通文件，你可以轻松地用 `cp` 命令做备份、用 `scp` 迁移到另一台机器。这种简洁性在快速迭代的 Agent 开发阶段是非常有价值的。

#### PostgreSQL：多节点部署的标准选择

当你的 Agent 系统需要部署在多个节点上时，你需要一个真正的客户端-服务端数据库。PostgreSQL 配合 `psycopg` 或 `asyncpg` 是最常见的选择。它不仅提供了完整的事务支持，还支持 `SELECT ... FOR UPDATE` 这样的悲观锁语句，以及 `LISTEN/NOTIFY` 机制来实现审批结果的实时推送。

```python
import asyncpg
import json

class PostgreSQLStateStore:
    """基于 PostgreSQL 的工作流状态持久化存储"""

    def __init__(self, dsn: str):
        self.dsn = dsn
        self.pool: asyncpg.Pool | None = None

    async def initialize(self):
        """初始化连接池"""
        self.pool = await asyncpg.create_pool(self.dsn, min_size=2, max_size=10)

    async def save_state(self, state: WorkflowState) -> bool:
        """使用 PostgreSQL 的乐观锁机制保存状态"""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE workflow_states
                   SET state_json = $1, version = version + 1, updated_at = NOW()
                   WHERE workflow_id = $2 AND version = $3""",
                json.dumps(self._serialize_state(state), ensure_ascii=False),
                state.workflow_id,
                state.version,
            )
            # asyncpg 的 execute 返回类似 "UPDATE 1" 的字符串
            if result == "UPDATE 1":
                state.version += 1
                return True
            raise VersionConflictError(
                f"Workflow {state.workflow_id} version conflict"
            )

    async def wait_for_approval(
        self, workflow_id: str, step_id: str, timeout: float
    ) -> dict | None:
        """
        利用 PostgreSQL 的 LISTEN/NOTIFY 机制等待审批结果。
        这比轮询更高效，但也需要配合超时机制以防通知丢失。
        """
        channel = f"approval_{workflow_id}_{step_id}"
        async with self.pool.acquire() as conn:
            # 先检查是否已有审批结果
            row = await conn.fetchrow(
                """SELECT response_json FROM approval_requests
                   WHERE workflow_id = $1 AND step_id = $2 AND status = 'approved'""",
                workflow_id, step_id,
            )
            if row:
                return json.loads(row["response_json"])

            # 监听通知
            await conn.execute(f'LISTEN "{channel}"')
            try:
                # 等待通知或超时
                notification = await asyncio.wait_for(
                    conn.add_listener(channel, self._on_approval),
                    timeout=timeout,
                )
                return notification
            except asyncio.TimeoutError:
                return None
            finally:
                await conn.execute(f'UNLISTEN "{channel}"')
```

#### Redis：热缓存与分布式锁

Redis 在长运行 Agent 架构中通常不是作为主存储，而是作为热缓存和分布式锁服务。当你需要快速检查某个工作流的状态、或者确保某个步骤不会被多个 worker 同时执行时，Redis 是最佳选择。它的原子操作（`SETNX`、`WATCH/MULTI`）天然适合实现乐观锁和分布式锁。

### 2.3 中间结果的增量保存

对于特别耗时的单个步骤——比如大模型生成一份万字报告、或者处理一个大型数据集——你需要在步骤内部也做增量检查点。这样即使步骤执行到一半崩溃了，恢复时也能从最近的检查点继续，而不是重新处理整个数据集。

```python
class LongRunningStep(Step):
    """
    支持增量检查点的长运行步骤。
    适用于需要处理大量数据或多次调用 LLM 的场景。
    """

    async def execute(self, context: dict, checkpoint: dict | None) -> dict:
        # 从检查点恢复进度
        if checkpoint and checkpoint.get("status") == "in_progress":
            completed_ids = set(checkpoint.get("completed_item_ids", []))
            partial_results = checkpoint.get("partial_results", {})
        else:
            completed_ids = set()
            partial_results = {}

        items = context["items_to_process"]
        remaining = [item for item in items if item["id"] not in completed_ids]

        for item in remaining:
            # 处理单个数据项
            result = await self._process_item(item)
            partial_results[item["id"]] = result
            completed_ids.add(item["id"])

            # 每处理完一项就保存增量检查点
            # 这样即使崩溃也能从最近的检查点恢复
            await self._save_incremental_checkpoint(
                workflow_id=context["workflow_id"],
                step_id=self.step_id,
                checkpoint_data={
                    "status": "in_progress",
                    "completed_item_ids": list(completed_ids),
                    "partial_results": partial_results,
                    "progress": f"{len(completed_ids)}/{len(items)}",
                    "last_processed_id": item["id"],
                },
            )

        return {
            "total_processed": len(completed_ids),
            "results": partial_results,
        }
```

增量检查点的关键设计原则是：检查点数据必须是**幂等的**——也就是说，同一个检查点无论被加载多少次，恢复后的执行结果都是一样的。这要求你使用"已完成项的 ID 集合"来标记进度，而不是简单地记录"处理到第 N 个"。因为如果数据集在两次执行之间发生了变化（比如有人往待处理队列中插入了新数据），"第 N 个"可能指向了不同的数据项。

---

## 三、DAG 工作流引擎：从线性执行到图编排

### 3.1 为什么需要 DAG？

实际的 Agent 任务很少是简单的线性步骤序列。更常见的场景是：先并行获取多个数据源的数据，然后汇总分析，再根据分析结果走不同的分支。比如一个代码审计 Agent 可能需要同时运行静态分析、安全扫描和风格检查（这三个步骤可以并行执行），等所有结果都出来后再由大模型综合分析，最后交给人类审批。这种有分支、有并行的依赖关系自然地构成了一个有向无环图（DAG）。

### 3.2 DAG 引擎的核心实现

```python
import asyncio
from collections import defaultdict
from dataclasses import dataclass, field

@dataclass
class DAGNode:
    """DAG 中的一个节点，代表一个执行步骤"""
    node_id: str
    step: Step
    dependencies: list[str] = field(default_factory=list)

class DAGEngine:
    """
    基于拓扑排序的 DAG 工作流执行引擎。
    支持并行执行无依赖关系的步骤，支持断点恢复。
    """

    def __init__(self, store: "StateStore"):
        self.store = store

    async def execute(
        self,
        workflow_id: str,
        nodes: list[DAGNode],
        global_context: dict,
    ) -> dict[str, dict]:
        node_map = {n.node_id: n for n in nodes}
        graph: dict[str, list[str]] = defaultdict(list)
        in_degree: dict[str, int] = {}

        # 构建邻接表和入度表
        for node in nodes:
            in_degree.setdefault(node.node_id, 0)
            for dep in node.dependencies:
                graph[dep].append(node.node_id)
                in_degree[node.node_id] += 1

        # 加载已完成的步骤（断点恢复的关键）
        completed: set[str] = set()
        results: dict[str, dict] = {}
        existing_state = self.store.load_state(workflow_id)
        if existing_state:
            for step_state in existing_state.steps:
                if step_state.status == StepStatus.COMPLETED:
                    completed.add(step_state.step_id)
                    results[step_state.step_id] = step_state.output_data or {}

        # 拓扑排序执行
        while True:
            # 找出所有入度为 0 且未完成的节点——这些节点可以并行执行
            ready = [
                nid for nid, deg in in_degree.items()
                if deg == 0 and nid not in completed
            ]
            if not ready:
                break  # 所有节点都已执行完毕，或者存在循环依赖

            # 并行执行当前批次
            batch_tasks = []
            for node_id in ready:
                node = node_map[node_id]
                step_context = {
                    **global_context,
                    "_workflow_id": workflow_id,
                    "_upstream_results": {
                        dep: results[dep]
                        for dep in node.dependencies
                        if dep in results
                    },
                }
                checkpoint = self.store.load_checkpoint(workflow_id, node_id)
                batch_tasks.append(
                    self._execute_node_with_retry(
                        workflow_id, node, step_context, checkpoint
                    )
                )

            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)

            # 处理批次结果
            for node_id, result in zip(ready, batch_results):
                if isinstance(result, Exception):
                    raise WorkflowFailedError(
                        f"Node {node_id} failed: {result}"
                    )
                results[node_id] = result
                completed.add(node_id)

                # 更新入度表，解锁下游节点
                for downstream in graph[node_id]:
                    in_degree[downstream] -= 1

        return results

    async def _execute_node_with_retry(
        self,
        workflow_id: str,
        node: DAGNode,
        context: dict,
        checkpoint: dict | None,
        max_retries: int = 3,
    ) -> dict:
        """带重试机制的节点执行"""
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                return await node.step.execute_with_checkpoint(
                    self.store, workflow_id, context, checkpoint
                )
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    delay = min(2 ** attempt, 30)  # 指数退避，最大 30 秒
                    await asyncio.sleep(delay)
                    # 重试时更新 checkpoint 中的重试信息
                    if checkpoint:
                        checkpoint["retry_attempt"] = attempt + 1
        raise last_error
```

这个引擎有几个值得注意的设计细节。首先，它通过入度表来自动发现可以并行执行的节点，你不需要手动指定"这三个步骤可以并行"。其次，它在开始执行前会先加载已完成步骤的状态，这就是断点恢复的实现——如果一个包含十个步骤的工作流在第八步崩溃了，重启后引擎会自动跳过前七步，从第八步继续。最后，每个节点的执行都带有重试机制和指数退避，处理临时性的网络错误或 API 限流。

---

## 四、人机审批节点：让 Agent 学会耐心等待

### 4.1 审批节点的核心设计模式

人机审批是长运行 Agent 最具特色的组件。设计一个健壮的审批节点需要考虑多个方面：等待时间完全不确定（从几秒到几天都有可能）；进程可能在等待期间重启；审批人可能需要补充信息才能做出决策；审批可能需要升级到更高权限的人。

```python
from enum import Enum

class ApprovalDecision(Enum):
    """审批决策枚举"""
    APPROVED = "approved"                    # 批准
    REJECTED = "rejected"                    # 拒绝
    APPROVED_WITH_CHANGES = "approved_with_changes"  # 修改后批准
    ESCALATED = "escalated"                  # 转交给更高权限的人

@dataclass
class ApprovalRequest:
    """审批请求数据结构"""
    workflow_id: str
    step_id: str
    title: str                    # 审批请求的标题
    description: str              # 详细描述
    context_data: dict            # 展示给人类的上下文信息
    options: list[str] | None     # 可选的决策选项
    timeout_seconds: float        # 超时时间（秒）
    escalation_target: str | None # 超时后的升级目标
    created_at: float = field(default_factory=time.time)

@dataclass
class ApprovalResponse:
    """审批响应数据结构"""
    decision: ApprovalDecision
    comments: str = ""            # 审批人留下的备注
    changes: dict | None = None   # 如果是"修改后批准"，附带的修改内容
    decided_by: str = ""          # 审批人标识
    decided_at: float = field(default_factory=time.time)
```

### 4.2 持久化审批：进程重启后继续等待

这是审批节点最关键的特性。在进程重启后，审批节点必须能够恢复到"等待审批"的状态，而不是重新发起一次新的审批请求。实现方式是：将审批请求持久化到数据库，然后用轮询机制来检查审批结果。

```python
class DurableApprovalStep(Step):
    """
    可持久化的人机审批步骤。
    进程重启后能从上次等待的位置继续。
    """

    def __init__(
        self,
        step_id: str,
        store: "StateStore",
        notification_service: "NotificationService",
        timeout_seconds: float = 172800,  # 默认 48 小时
        on_timeout: str = "escalate",     # auto_approve | reject | escalate
        poll_base_interval: float = 5.0,
        poll_max_interval: float = 60.0,
    ):
        super().__init__(step_id, f"Human Approval: {step_id}", timeout_seconds)
        self.store = store
        self.notifier = notification_service
        self.on_timeout = on_timeout
        self.poll_base_interval = poll_base_interval
        self.poll_max_interval = poll_max_interval

    async def execute(self, context: dict, checkpoint: dict | None) -> dict:
        pending_key = f"{context['_workflow_id']}:{self.step_id}"

        # 第一步：检查是否已有审批结果（断点恢复的关键）
        existing = self.store.load_approval_response(pending_key)
        if existing:
            return {
                "decision": existing["decision"],
                "comments": existing.get("comments", ""),
                "changes": existing.get("changes"),
                "decided_by": existing.get("decided_by", ""),
            }

        # 第二步：检查是否已有待处理的审批请求（避免重复发送通知）
        existing_request = self.store.load_approval_request(pending_key)
        if not existing_request:
            # 创建并持久化审批请求
            request = ApprovalRequest(
                workflow_id=context["_workflow_id"],
                step_id=self.step_id,
                title=context.get("approval_title", "需要您的审批"),
                description=context.get("approval_description", ""),
                context_data=context.get("approval_context", {}),
                options=context.get("approval_options"),
                timeout_seconds=self.timeout,
            )
            self.store.save_approval_request(pending_key, request)
            # 发送通知给审批人
            await self.notifier.send_approval_notification(request)

        # 第三步：轮询等待审批结果
        start_time = time.time()
        poll_interval = self.poll_base_interval

        while True:
            # 检查审批结果
            response = self.store.load_approval_response(pending_key)
            if response:
                return {
                    "decision": response["decision"],
                    "comments": response.get("comments", ""),
                    "changes": response.get("changes"),
                    "decided_by": response.get("decided_by", ""),
                }

            # 检查是否超时
            elapsed = time.time() - start_time
            if elapsed > self.timeout:
                return await self._handle_timeout(context, pending_key)

            # 指数退避轮询，避免频繁查询数据库
            await asyncio.sleep(poll_interval)
            poll_interval = min(poll_interval * 1.5, self.poll_max_interval)

    async def _handle_timeout(self, context: dict, pending_key: str) -> dict:
        """处理审批超时"""
        if self.on_timeout == "auto_approve":
            result = {"decision": "approved", "comments": "超时自动批准"}
        elif self.on_timeout == "reject":
            result = {"decision": "rejected", "comments": "超时自动拒绝"}
        elif self.on_timeout == "escalate":
            # 转交给更高权限的审批人，重新开始等待
            self.notifier.send_escalation_notification(context)
            # 递归调用自身，但这次等待时间翻倍
            escalated_step = DurableApprovalStep(
                step_id=f"{self.step_id}_escalated",
                store=self.store,
                notification_service=self.notifier,
                timeout_seconds=self.timeout * 2,
                on_timeout="reject",  # 升级后再超时就直接拒绝
            )
            return await escalated_step.execute(context, None)
        else:
            result = {"decision": "rejected", "comments": "未知超时策略"}

        return result

    async def compensate(self, context: dict, output: dict):
        """补偿操作：通知相关人员审批已作废"""
        await self.notifier.send_cancellation_notice(
            workflow_id=context["_workflow_id"],
            step_id=self.step_id,
            original_decision=output.get("decision"),
        )
```

### 4.3 审批服务的 Webhook 接口

审批结果通常通过 Webhook 从外部系统（比如 Slack、飞书、企业微信或者自建的审批平台）传入。你需要一个 API 端点来接收这些回调：

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class ApprovalWebhookPayload(BaseModel):
    workflow_id: str
    step_id: str
    decision: str
    comments: str = ""
    changes: dict | None = None
    decided_by: str = ""

@app.post("/api/v1/approvals/callback")
async def handle_approval_callback(payload: ApprovalWebhookPayload):
    """
    接收外部系统的审批回调。
    将审批结果持久化到数据库，供正在轮询的审批步骤读取。
    """
    store = get_state_store()  # 依赖注入
    pending_key = f"{payload.workflow_id}:{payload.step_id}"

    # 验证审批请求确实存在
    existing = store.load_approval_request(pending_key)
    if not existing:
        raise HTTPException(status_code=404, detail="审批请求不存在")

    # 持久化审批结果
    store.save_approval_response(pending_key, {
        "decision": payload.decision,
        "comments": payload.comments,
        "changes": payload.changes,
        "decided_by": payload.decided_by,
        "decided_at": time.time(),
    })

    return {"status": "ok", "message": "审批结果已记录"}
```

这里有一个重要的架构决策：审批结果通过 Webhook 写入数据库，而审批步骤通过轮询从数据库读取。这种"写入方和读取方解耦"的设计使得系统更加健壮——即使 Agent 进程在审批结果到达时恰好重启了，审批结果也不会丢失，因为已经安全地存储在数据库中了。

---

## 五、Saga 补偿模式：失败后的优雅回滚

### 5.1 为什么简单的重试不够？

考虑这样一个场景：你的 Agent 工作流包含三个步骤——"创建云服务器"、"部署应用"、"更新 DNS 记录"。第二步失败了。如果你只是简单地重试第二步，第一步骤创建的云服务器就变成了孤儿资源——它在正常运行、产生费用，但没有被任何 DNS 记录指向。你需要的不是"重试"，而是"补偿"——先回滚第一步创建的云服务器（删除它），然后决定是放弃整个工作流还是重新开始。

这就是 Saga 模式的核心思想：为每个可能产生副作用的步骤定义一个对应的补偿操作，当后续步骤失败时，按逆序执行已完成步骤的补偿操作。

### 5.2 Saga 编排器的实现

```python
class SagaOrchestrator:
    """
    Saga 模式编排器。
    执行正向步骤，失败时按逆序执行补偿操作。
    """

    def __init__(self, store: "StateStore", engine: DAGEngine):
        self.store = store
        self.engine = engine

    async def execute_with_saga(
        self,
        workflow_id: str,
        nodes: list[DAGNode],
        context: dict,
    ) -> dict:
        # 按拓扑排序记录实际执行顺序
        execution_trace: list[str] = []
        node_map = {n.node_id: n for n in nodes}

        try:
            results = await self.engine.execute(workflow_id, nodes, context)
            execution_trace = list(results.keys())
            return results

        except WorkflowFailedError:
            # 执行失败，启动 Saga 补偿
            await self._run_compensation(
                workflow_id, node_map, execution_trace, context
            )
            raise

    async def _run_compensation(
        self,
        workflow_id: str,
        node_map: dict[str, DAGNode],
        execution_trace: list[str],
        context: dict,
    ):
        """
        按逆序执行补偿操作。
        注意：补偿顺序很重要！如果步骤 A → B → C，补偿顺序必须是 C → B → A。
        """
        compensation_errors = []

        for node_id in reversed(execution_trace):
            node = node_map[node_id]
            checkpoint = self.store.load_checkpoint(workflow_id, node_id)

            # 只有确实已完成的步骤才需要补偿
            if not checkpoint or checkpoint.get("status") != "completed":
                continue

            try:
                await node.step.compensate(context, checkpoint.get("output", {}))
                self.store.save_checkpoint(workflow_id, node_id, {
                    "status": "compensated",
                    "compensated_at": time.time(),
                })
            except Exception as e:
                # 补偿也失败了——记录到死信队列
                compensation_errors.append((node_id, e))
                self._enqueue_dead_letter(
                    workflow_id=workflow_id,
                    step_id=node_id,
                    error=e,
                    checkpoint=checkpoint,
                    reason="compensation_failed",
                )

        if compensation_errors:
            # 有补偿失败的操作，记录并告警
            error_summary = [
                f"{nid}: {err}" for nid, err in compensation_errors
            ]
            # 发送告警通知运维团队
            await self._alert_compensation_failures(
                workflow_id, error_summary
            )

    def _enqueue_dead_letter(
        self,
        workflow_id: str,
        step_id: str,
        error: Exception,
        checkpoint: dict,
        reason: str,
    ):
        """将失败的补偿操作发送到死信队列"""
        self.store.save_dead_letter({
            "workflow_id": workflow_id,
            "step_id": step_id,
            "error_type": type(error).__name__,
            "error_message": str(error),
            "checkpoint": checkpoint,
            "reason": reason,
            "status": "pending_review",
            "retry_count": 0,
            "created_at": time.time(),
        })
```

### 5.3 死信队列：无法自动恢复时的最后一道防线

死信队列存储那些无法通过自动重试或补偿来恢复的失败项。这些失败项需要人工审查和处理。在实践中，死信队列通常是运维团队最不希望看到但又必须存在的组件。

```python
class DeadLetterProcessor:
    """
    死信队列处理器。
    定期扫描队列中的条目，尝试自动恢复或升级为人工处理。
    """

    def __init__(self, store: "StateStore", alert_service: "AlertService"):
        self.store = store
        self.alert_service = alert_service

    async def process_pending_letters(self, max_auto_retries: int = 2):
        """处理死信队列中待处理的条目"""
        pending = self.store.load_pending_dead_letters()

        for letter in pending:
            if letter["retry_count"] >= max_auto_retries:
                # 超过自动重试次数，升级为人工处理
                self.store.update_dead_letter_status(
                    letter["id"], "requires_manual_intervention"
                )
                await self.alert_service.send_alert(
                    level="warning",
                    title=f"死信队列需要人工介入: {letter['workflow_id']}",
                    details=letter,
                )
                continue

            try:
                # 尝试重新执行失败的步骤
                await self._retry_step(letter)
                self.store.update_dead_letter_status(letter["id"], "resolved")
            except Exception as e:
                # 重试也失败了，增加重试计数
                self.store.increment_dead_letter_retry(letter["id"])

    async def _retry_step(self, letter: dict):
        """
        重新执行失败的步骤。
        这里需要根据 letter 中的 checkpoint 数据重建执行上下文。
        """
        workflow_id = letter["workflow_id"]
        step_id = letter["step_id"]
        # 根据具体业务逻辑恢复并重试
        # ...
        pass
```

---

## 六、平台对比：三条技术路线的深度分析

### 6.1 Temporal.io：工业级工作流引擎

Temporal 源自 Uber 的 Cadence 项目，是目前长运行任务编排领域最成熟的开源解决方案。它的核心理念是"将工作流代码写成普通函数"——你用普通的 Python 或 Go 代码来描述工作流逻辑，Temporal 引擎在后台自动处理状态持久化、重试、超时和信号传递。

Temporal 的 Python SDK 示例展示了它如何优雅地处理长运行任务：

```python
from temporalio import workflow
from temporalio.common import RetryPolicy
from datetime import timedelta

@workflow.defn
class AgentAuditWorkflow:
    """基于 Temporal 的代码审计 Agent 工作流"""

    def __init__(self):
        self._approval_received = False
        self._approval_decision = None

    @workflow.signal
    def receive_approval(self, decision: str):
        """接收外部审批信号"""
        self._approval_decision = decision
        self._approval_received = True

    @workflow.run
    async def run(self, input_data: dict) -> dict:
        # 步骤 1：获取代码仓库
        repo_path = await workflow.execute_activity(
            fetch_repo_activity,
            input_data,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(seconds=5),
            ),
        )

        # 步骤 2：并行运行多个分析任务
        static_result, security_result, style_result = await asyncio.gather(
            workflow.execute_activity(
                static_analysis_activity, repo_path,
                start_to_close_timeout=timedelta(minutes=30),
            ),
            workflow.execute_activity(
                security_scan_activity, repo_path,
                start_to_close_timeout=timedelta(minutes=20),
            ),
            workflow.execute_activity(
                style_check_activity, repo_path,
                start_to_close_timeout=timedelta(minutes=15),
            ),
        )

        # 步骤 3：大模型综合分析
        report = await workflow.execute_activity(
            llm_analysis_activity,
            {
                "static": static_result,
                "security": security_result,
                "style": style_result,
            },
            start_to_close_timeout=timedelta(minutes=30),
        )

        # 步骤 4：等待人工审批
        # 使用 workflow.wait_condition 等待信号或超时
        try:
            await workflow.wait_condition(
                lambda: self._approval_received,
                timeout=timedelta(hours=48),
            )
        except asyncio.TimeoutError:
            return {"status": "approval_timeout", "report": report}

        if self._approval_decision == "approved":
            final = await workflow.execute_activity(
                publish_report_activity, report,
                start_to_close_timeout=timedelta(minutes=5),
            )
            return {"status": "completed", "result": final}
        else:
            return {"status": "rejected", "report": report}
```

Temporal 的优势是显而易见的：状态持久化完全透明（开发者不需要手动管理检查点）、内置了完善的重试和超时机制、Web UI 提供了出色的调试和监控体验、支持跨语言和跨服务的工作流编排。但它的劣势同样明显：运维复杂度高（需要部署 Temporal Server 集群，包括前端服务、匹配服务、历史服务和工作节点）、学习曲线陡峭（workflow 代码有严格的确定性约束——不能直接调用随机数生成器、不能使用当前时间等）、对于简单场景来说可能过度工程化。

为了更深入地展示 Temporal 的完整能力，下面给出一个带 Activity 定义、Signal 处理和 Worker 启动的完整示例：

```python
# activity.py —— 所有 IO 密集型操作必须放在 Activity 中
from temporalio import activity
import httpx

@activity.defn
async def fetch_repo_activity(input_data: dict) -> str:
    """克隆代码仓库并返回本地路径"""
    repo_url = input_data["repo_url"]
    branch = input_data.get("branch", "main")
    # 实际实现：git clone --depth 1 -b {branch} {repo_url}
    clone_path = f"/tmp/repos/{input_data['workflow_id']}"
    activity.logger.info(f"Cloning {repo_url}@{branch} to {clone_path}")
    # ... 执行 git clone ...
    return clone_path

@activity.defn
async def static_analysis_activity(repo_path: str) -> dict:
    """运行静态代码分析工具"""
    activity.logger.info(f"Running static analysis on {repo_path}")
    # ... 调用 pylint, mypy, bandit 等工具 ...
    return {"issues": [], "score": 92}

@activity.defn
async def security_scan_activity(repo_path: str) -> dict:
    """运行安全漏洞扫描"""
    activity.logger.info(f"Running security scan on {repo_path}")
    return {"vulnerabilities": [], "risk_level": "low"}

@activity.defn
async def llm_analysis_activity(analysis_results: dict) -> str:
    """调用大模型进行综合分析"""
    activity.logger.info("Calling LLM for comprehensive analysis")
    async with httpx.AsyncClient() as client:
        resp = await client.post("https://api.openai.com/v1/chat/completions", json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": f"Analyze: {analysis_results}"}],
        })
        return resp.json()["choices"][0]["message"]["content"]

@activity.defn
async def publish_report_activity(report: str) -> str:
    """发布审计报告"""
    # ... 发布到内部 wiki / S3 / 数据库 ...
    return "https://internal.example.com/reports/abc123"

# workflow.py —— 工作流定义（必须满足确定性约束）
import asyncio
from temporalio import workflow
from temporalio.common import RetryPolicy
from datetime import timedelta

# 注意：在 workflow 代码中导入 activity 使用 @workflow.defn 的沙盒安全导入
with workflow.unsafe.imports_passed_through():
    from activity import (
        fetch_repo_activity,
        static_analysis_activity,
        security_scan_activity,
        llm_analysis_activity,
        publish_report_activity,
    )

@workflow.defn
class AgentAuditWorkflow:
    """基于 Temporal 的代码审计 Agent 工作流——带完整 Activity 和 Signal"""

    def __init__(self) -> None:
        self._approval_received: bool = False
        self._approval_decision: str | None = None

    @workflow.signal
    def receive_approval(self, decision: str) -> None:
        """接收外部审批信号——通过 Temporal Client 或 tctl 命令触发"""
        self._approval_decision = decision
        self._approval_received = True

    @workflow.signal
    def cancel_workflow(self) -> None:
        """取消工作流信号"""
        raise workflow.CancelledError("Workflow cancelled by user signal")

    @workflow.run
    async def run(self, input_data: dict) -> dict:
        # Activity 执行策略：失败后最多重试 3 次，初始间隔 5 秒
        retry_policy = RetryPolicy(
            maximum_attempts=3,
            initial_interval=timedelta(seconds=5),
            backoff_coefficient=2.0,
            maximum_interval=timedelta(minutes=1),
        )

        # 步骤 1：获取代码仓库
        repo_path = await workflow.execute_activity(
            fetch_repo_activity,
            input_data,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        # 步骤 2：并行运行多个分析任务
        static_result, security_result, llm_report = await asyncio.gather(
            workflow.execute_activity(
                static_analysis_activity, repo_path,
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=retry_policy,
            ),
            workflow.execute_activity(
                security_scan_activity, repo_path,
                start_to_close_timeout=timedelta(minutes=20),
                retry_policy=retry_policy,
            ),
            workflow.execute_activity(
                llm_analysis_activity,
                {"repo_path": repo_path},
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=retry_policy,
            ),
        )

        # 步骤 3：等待人工审批信号（带超时）
        try:
            await workflow.wait_condition(
                lambda: self._approval_received,
                timeout=timedelta(hours=48),
            )
        except asyncio.TimeoutError:
            workflow.logger.warn("Approval timeout after 48h")
            return {"status": "approval_timeout", "report": llm_report}

        if self._approval_decision == "approved":
            final = await workflow.execute_activity(
                publish_report_activity, llm_report,
                start_to_close_timeout=timedelta(minutes=5),
            )
            return {"status": "completed", "result": final}
        else:
            return {"status": "rejected", "report": llm_report}

# worker.py —— Worker 启动入口
import asyncio
from temporalio.client import Client
from temporalio.worker import Worker

async def main():
    client = await Client.connect("localhost:7233")
    worker = Worker(
        client,
        task_queue="agent-audit-queue",
        workflows=[AgentAuditWorkflow],
        activities=[
            fetch_repo_activity,
            static_analysis_activity,
            security_scan_activity,
            llm_analysis_activity,
            publish_report_activity,
        ],
    )
    await worker.run()

if __name__ == "__main__":
    asyncio.run(main())
```

这个完整示例展示了几个关键点：所有涉及 IO 的操作（git clone、HTTP 调用、数据库操作）必须放在 Activity 中，而不是直接写在 Workflow 代码里——这是 Temporal 确定性约束的核心要求；Signal 允许外部系统异步地向正在运行的工作流发送消息，这是实现人机审批最优雅的方式；Worker 是执行 Workflow 和 Activity 的进程，你可以通过增加 Worker 实例来水平扩展处理能力。

### 6.2 Inngest：事件驱动的轻量方案

Inngest 采用了完全不同的架构理念——基于事件驱动和函数即服务。它特别适合 Serverless 环境和快速原型开发。每个 `step.run()` 调用都是自动持久化的，`step.waitForEvent()` 天然支持人机审批模式。

```typescript
import { inngest } from "./client";

export const agentAuditWorkflow = inngest.createFunction(
  {
    id: "agent-audit-workflow",
    retries: 3,
    concurrency: { limit: 5 },
  },
  { event: "agent/audit.requested" },
  async ({ event, step }) => {
    // 每个 step 自动持久化到 Inngest 的状态存储
    const repoPath = await step.run("fetch-repo", async () => {
      return await fetchRepository(event.data.repoUrl);
    });

    // 并行执行多个分析步骤
    const [staticResult, securityResult] = await Promise.all([
      step.run("static-analysis", async () => {
        return await runStaticAnalysis(repoPath);
      }),
      step.run("security-scan", async () => {
        return await runSecurityScan(repoPath);
      }),
    ]);

    const report = await step.run("llm-analysis", async () => {
      return await callLLM({ staticResult, securityResult });
    });

    // 等待人工审批事件，最多等待 48 小时
    const approval = await step.waitForEvent("wait-approval", {
      event: "agent/audit.approved",
      match: "data.workflowId",
      timeout: "48h",
    });

    if (!approval) {
      return { status: "approval_timeout" };
    }

    const result = await step.run("publish-report", async () => {
      return await publishReport(report);
    });

    return { status: "completed", result };
  }
);
```

Inngest 的最大优势是开发体验极佳——你几乎不需要关心底层的状态管理，所有 `step.run()` 调用都被自动持久化。它与 Next.js、Express 等框架的集成非常紧密，对于 Web 应用开发者来说上手成本很低。但它的局限在于：对复杂 DAG 的支持不如 Temporal 灵活（本质上是线性执行加并行等待）、调试工具不如 Temporal 成熟、存在一定的 vendor lock-in 风险。

下面补充 `step.sleep_until`（定时等待）和 `step.waitForEvent`（事件等待）的更完整用法，展示如何在同一个工作流中组合使用它们：

```typescript
import { inngest } from "./client";

/**
 * 更复杂的 Agent 工作流：展示 step.sleep_until + step.waitForEvent + step.sendEvent 的组合
 */
export const complexAgentWorkflow = inngest.createFunction(
  {
    id: "complex-agent-workflow",
    retries: 3,
    concurrency: { limit: 10 },
  },
  { event: "agent/complex-task.requested" },
  async ({ event, step }) => {
    // 1. 事件驱动触发：调用 LLM 生成初稿
    const draft = await step.run("generate-draft", async () => {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: event.data.prompt }],
        }),
      });
      const json = await response.json();
      return json.choices[0].message.content;
    });

    // 2. 发送审批请求事件（通知外部系统）
    await step.sendEvent("notify-reviewer", {
      name: "agent/approval.requested",
      data: {
        workflowId: event.data.workflowId,
        draft,
        reviewerEmail: event.data.reviewerEmail,
      },
    });

    // 3. 等待人工审批事件——匹配 workflowId 确保只接收对应回调
    const approval = await step.waitForEvent("wait-approval", {
      event: "agent/approval.responded",
      match: "data.workflowId",
      timeout: "72h",  // 最多等待 72 小时
    });

    if (!approval) {
      // 超时：发送超时通知并结束
      await step.run("handle-timeout", async () => {
        await sendSlackNotification({
          text: `⏰ Workflow ${event.data.workflowId} approval timed out after 72h`,
          channel: "#agent-alerts",
        });
      });
      return { status: "approval_timeout", draft };
    }

    // 4. 根据审批结果分支
    if (approval.data.decision === "rejected") {
      return { status: "rejected", reason: approval.data.reason };
    }

    // 5. 如果需要"延迟执行"（比如等审批通过后再等 10 分钟做最终发布）
    // step.sleep_until 接受 ISO 8601 时间戳或 Date 对象
    const publishAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟后
    await step.sleepUntil("delay-publish", publishAt);

    // 6. 最终发布
    const result = await step.run("publish", async () => {
      return await publishToInternalWiki({
        title: `Report: ${event.data.workflowId}`,
        content: draft,
        approvedBy: approval.data.approvedBy,
      });
    });

    return { status: "completed", result };
  }
);
```

`step.sleep_until` 和 `step.sleep` 的区别在于：`step.sleep` 接受相对时间（如 `"2h"`），`step.sleep_until` 接受绝对时间（ISO 8601 字符串或 `Date` 对象）。在生产环境中，`step.sleep_until` 更常用于"在特定时间窗口执行"的场景——比如避开夜间批处理高峰、在工作日的工作时间内发布报告等。两个 API 都是持久化的，即使 Inngest 服务重启或你的函数进程崩溃，到期后依然会准时恢复执行。

### 6.3 自建方案：灵活但需要更多工程投入

如果你的团队有足够的工程能力，或者你的需求有一些特殊的约束（比如数据不能离开内网、需要深度定制执行逻辑），自建是一个合理的选择。本文中展示的 SQLite/PostgreSQL 加 DAG 引擎的方案就是一个自建方案的起点。

自建方案的核心优势是完全可控——你可以精确地控制每一个行为细节，从状态序列化格式到重试策略到监控指标。但你需要自己处理所有边界条件：并发控制、死锁检测、状态版本兼容性、数据迁移等等。根据我的经验，一个功能完备的自建工作流引擎大约需要 3000 到 5000 行代码，加上不少于两周的测试和调试时间。

### 6.4 选型决策建议

基于实际项目经验，我给出以下选型建议：如果你的团队规模在五人以下，部署环境是单机或者简单的云服务器，优先选择自建 SQLite 方案——它简单、可控、零运维。如果你的系统需要部署在 Kubernetes 集群中，涉及多个微服务之间的协调，而且团队有专门的平台工程能力，选择 Temporal——它的学习成本是值得付出的。如果你的系统是 Serverless 架构，团队规模较小，需要快速上线，选择 Inngest——它的开发效率是最高的。

### 6.5 方案对比表格

| 维度 | Temporal.io | Inngest | 自建方案（SQLite/PostgreSQL） |
|------|------------|---------|---------------------------|
| **开发复杂度** | 中高：需要理解 Activity/Workflow 分离、确定性约束、Signal/Query 机制 | 低：step.run 自动持久化，API 设计直觉化，几乎零学习成本 | 中：需要自建状态机、DAG 引擎、重试逻辑、乐观锁等核心组件（约 3000-5000 行代码） |
| **运维成本** | 高：需要部署 Temporal Server 集群（Frontend/Matching/History/Worker），依赖 Cassandra/PostgreSQL/ES | 极低：托管 SaaS，零运维；自托管版本（Temporal Cloud 替代）可选 | 低-中：单机用 SQLite 零运维；多节点需 PostgreSQL + 连接池 + 监控 |
| **社区生态** | ⭐⭐⭐⭐⭐：GitHub 12k+ stars，活跃的 Slack 社区，官方支持 Python/Go/Java/TypeScript SDK，丰富的文档和教程 | ⭐⭐⭐⭐：GitHub 3k+ stars，社区活跃度增长快，TypeScript/Python SDK，Vercel/Next.js 生态深度集成 | ⭐⭐：无统一社区，依赖个人技术博客和开源参考实现，需要自建一切 |
| **学习曲线** | 陡峭：确定性约束是最常见的坑源（不能在 workflow 中用 time.sleep、random、外部 IO），需要理解 replay 机制 | 平缓：对 Web 开发者非常友好，step API 设计符合直觉，文档质量高 | 中等：如果你有分布式系统经验则上手快；否则需要理解乐观锁、幂等性、状态机等基础概念 |
| **可观测性** | ⭐⭐⭐⭐⭐：自带 Web UI，工作流历史完整回放，支持搜索/过滤/重试，OpenTelemetry 集成 | ⭐⭐⭐⭐：自带 Function Runs 面板，支持 step 级别的输入/输出查看，但不如 Temporal 的历史回放强大 | ⭐⭐：需要自建——集成 structlog/Prometheus/Grafana，日志和指标全靠自己 |
| **适用场景** | 多服务协调、K8s 部署、需要长时间运行的复杂工作流、对可靠性要求极高的场景 | Serverless 架构、快速原型、Web 应用中的后台任务、事件驱动型流程 | 单机部署、中小规模、数据不能离网、需要深度定制、团队有分布式系统经验 |
| **Vendor Lock-in** | 低：开源协议（MIT），可自托管，API 稳定，迁移成本中等 | 中-高：托管 SaaS 为主，自托管版本成熟度有限，深度依赖 Inngest 的事件机制 | 无：完全自控，代码和数据都在自己手中 |
### 6.6 踩坑案例：持久化状态的版本兼容性问题

这是自建方案中最容易被忽视、也最容易在生产环境中造成灾难的问题：**当你修改了 State schema（数据结构），旧的序列化数据怎么处理？**

假设你的 `WorkflowState` 最初只有 `status` 和 `steps` 两个字段。三个月后，你发现需要增加一个 `priority` 字段来支持工作流优先级调度。你更新了代码，部署上线。然后——所有正在运行的旧工作流在尝试反序列化时崩溃了，因为旧数据中没有 `priority` 字段。

```python
# ❌ 危险的反序列化：旧数据中没有 "priority" 字段会直接 KeyError
def _deserialize_state_v1(self, data: dict) -> WorkflowState:
    return WorkflowState(
        workflow_id=data["workflow_id"],
        status=data["status"],
        priority=data["priority"],  # 💥 旧数据没有这个字段！
        steps=[...],
    )

# ✅ 安全的反序列化：提供默认值，兼容新旧两种数据格式
def _deserialize_state_v2(self, data: dict) -> WorkflowState:
    return WorkflowState(
        workflow_id=data["workflow_id"],
        status=data["status"],
        priority=data.get("priority", "normal"),  # 旧数据默认为 normal
        steps=[...],
        # 新增字段同理
        tags=data.get("tags", []),
        max_retries=data.get("max_retries", 3),
    )
```

**生产环境中的状态迁移策略：**

1. **永远使用 `.get()` 带默认值**：新增字段必须有默认值，反序列化时用 `.get()` 而非直接索引。这是最基本的防御。

2. **在序列化数据中嵌入 schema version**：每份持久化数据都带上版本号，反序列化时根据版本号选择不同的解析逻辑。

```python
def _serialize_state(self, state: WorkflowState) -> dict:
    return {
        "schema_version": 3,  # ← 当前 schema 版本号
        "workflow_id": state.workflow_id,
        # ... 其他字段
    }

def _deserialize_state(self, data: dict) -> WorkflowState:
    version = data.get("schema_version", 1)

    if version == 1:
        # v1 → v2：新增了 priority 字段
        data["priority"] = "normal"
        data["tags"] = []
        version = 2

    if version == 2:
        # v2 → v3：steps 结构变了，从 list 变成了 dict
        if isinstance(data.get("steps"), list):
            data["steps"] = {s["step_id"]: s for s in data["steps"]}
        version = 3

    return WorkflowState(**{k: data[k] for k in WORKFLOW_STATE_FIELDS if k in data})
```

3. **渐进式迁移而非一次性迁移**：不要写一个大迁移脚本把所有旧数据一次性转换——在线迁移期间系统需要保持可用。采用"读时迁移"（lazy migration）策略：读到旧格式数据时就地升级并写回，新数据直接用新格式写入。

4. **Temporal 和 Inngest 为什么不受此困扰**：Temporal 的 Worker 在 replay 时会用当前代码版本重新执行历史事件，只要 Activity 的输入输出类型向后兼容就不会有问题。Inngest 的 step 数据是按 step ID 索引的，新增 step 不影响旧 step。自建方案没有这层保护，必须自己处理。
---

## 七、可观测性：让长运行任务不再神秘

### 7.1 结构化日志

对于长运行任务来说，日志不仅仅是"出了错看看"的调试工具，它是你理解任务执行过程的核心手段。每一条日志都应该包含足够的上下文信息——工作流 ID、步骤 ID、当前状态、耗时等。

```python
import structlog

logger = structlog.get_logger()

class ObservableStep(Step):
    """带可观测性支持的步骤基类"""

    async def execute_with_checkpoint(
        self,
        store: "StateStore",
        workflow_id: str,
        context: dict,
        checkpoint: dict | None,
    ) -> dict:
        start_time = time.time()

        logger.info(
            "step.execution_started",
            workflow_id=workflow_id,
            step_id=self.step_id,
            step_name=self.name,
            has_checkpoint=checkpoint is not None,
            retry_count=checkpoint.get("retry_attempt", 0) if checkpoint else 0,
        )

        try:
            result = await self.execute(context, checkpoint)
            duration = time.time() - start_time

            logger.info(
                "step.execution_completed",
                workflow_id=workflow_id,
                step_id=self.step_id,
                duration_seconds=round(duration, 2),
            )
            return result

        except Exception as e:
            duration = time.time() - start_time

            logger.error(
                "step.execution_failed",
                workflow_id=workflow_id,
                step_id=self.step_id,
                error_type=type(e).__name__,
                error_message=str(e),
                duration_seconds=round(duration, 2),
            )
            raise
```

### 7.2 关键监控指标

在生产环境中，我建议至少监控以下指标：活跃工作流数量（突然增长可能意味着工作流泄漏或调度器异常）、每个步骤的平均执行时长（某个步骤突然变慢往往意味着外部依赖出了问题）、审批等待时长的分布（帮助你识别审批流程中的瓶颈）、死信队列的深度（持续增长说明有系统性问题需要关注）、以及 Saga 补偿的触发频率（频繁的补偿说明上游步骤不够稳定）。

### 7.3 分布式追踪

如果你的 Agent 系统涉及多个服务之间的调用（比如 Agent 调用 LLM 服务、LLM 服务再调用工具服务），分布式追踪就变得非常重要。使用 OpenTelemetry 可以轻松地在多个服务之间传递追踪上下文，让你能够看到一个请求从 Agent 发出、经过 LLM 处理、到最终工具调用完成的完整链路。

---

## 八、生产实战：一个完整的代码审计 Agent

把以上所有模式组合在一起，让我们实现一个完整的、可用于生产的代码审计 Agent 工作流。这个例子展示了如何将 DAG 编排、Saga 补偿、人机审批和断点恢复结合在一个实际的业务场景中。

```python
import asyncio
import uuid

async def run_code_audit(
    repo_url: str,
    branch: str,
    store: "StateStore",
):
    """
    执行一次完整的代码审计工作流。
    支持断点恢复：如果之前执行到一半中断了，会从断点继续。
    """
    workflow_id = str(uuid.uuid4())

    # 定义 DAG 节点及其依赖关系
    nodes = [
        DAGNode(
            node_id="fetch_repo",
            step=GenericStep(
                "fetch_repo", "获取代码仓库",
                execute_fn=fetch_repository,
                compensate_fn=cleanup_temp_repo,
            ),
        ),
        DAGNode(
            node_id="static_analysis",
            step=GenericStep(
                "static_analysis", "静态代码分析",
                execute_fn=run_static_analysis,
            ),
            dependencies=["fetch_repo"],
        ),
        DAGNode(
            node_id="security_scan",
            step=GenericStep(
                "security_scan", "安全漏洞扫描",
                execute_fn=run_security_scan,
            ),
            dependencies=["fetch_repo"],
        ),
        DAGNode(
            node_id="llm_review",
            step=LongRunningStep(
                "llm_review", "大模型代码审查",
            ),
            dependencies=["fetch_repo"],
        ),
        DAGNode(
            node_id="human_approval",
            step=DurableApprovalStep(
                "human_approval",
                store=store,
                notification_service=SlackNotificationService(),
                timeout_seconds=172800,  # 48 小时
                on_timeout="escalate",
            ),
            dependencies=["static_analysis", "security_scan", "llm_review"],
        ),
        DAGNode(
            node_id="publish_report",
            step=GenericStep(
                "publish_report", "发布审计报告",
                execute_fn=publish_report,
                compensate_fn=unpublish_report,
            ),
            dependencies=["human_approval"],
        ),
    ]

    # 全局上下文
    context = {
        "_workflow_id": workflow_id,
        "repo_url": repo_url,
        "branch": branch,
        "approval_title": "代码审计报告需要您的审批",
        "approval_description": "请审阅以下代码审计结果，确认无误后批准发布。",
        "approval_options": ["批准发布", "需要修改", "拒绝"],
    }

    # 使用 Saga 编排器执行
    saga = SagaOrchestrator(store, DAGEngine(store))
    try:
        results = await saga.execute_with_saga(workflow_id, nodes, context)
        return {
            "status": "completed",
            "workflow_id": workflow_id,
            "report": results.get("publish_report"),
        }
    except WorkflowFailedError as e:
        return {
            "status": "failed",
            "workflow_id": workflow_id,
            "error": str(e),
        }

# 入口
if __name__ == "__main__":
    store = SQLiteStateStore("audit_workflows.db")
    result = asyncio.run(run_code_audit(
        repo_url="https://github.com/example/project",
        branch="main",
        store=store,
    ))
    print(f"审计结果: {result}")
```

这个工作流的执行流程是：首先获取代码仓库并创建临时目录；然后并行执行静态分析、安全扫描和大模型审查三个步骤；三个步骤全部完成后，提交人类审批请求并等待；审批通过后发布审计报告。如果任何一步失败，Saga 编排器会按逆序执行补偿操作——比如清理临时目录、撤回已发布的报告。如果审批超过 48 小时没有响应，系统会自动升级审批请求到更高级别的审批人。

---

## 九、总结与实践建议

经过前面八个章节的深入探讨，我想给出几条核心的实践建议。

**从最简单的方案开始，按需升级。** 很多工程师在项目初期就急于引入 Temporal 这样的重量级框架，但大多数 Agent 项目的长运行需求其实可以用 SQLite 加简单的状态机来满足。先跑起来，遇到瓶颈再迁移。

**每个步骤都必须是幂等的。** 这意味着你的 LLM 调用需要支持从中间结果恢复，你的工具调用需要能够安全地重复执行。幂等性是长运行任务能够正确恢复的前提条件。

**人机审批用数据库轮询而非 WebSocket。** 在长运行场景下，WebSocket 连接可能因为网络波动而断开，进程可能因为部署更新而重启。将审批请求和审批结果都持久化到数据库中，通过轮询来检查状态变化，虽然看起来不够"实时"，但它的可靠性远超任何基于连接的方案。

**可观测性是第一天就要做的事情，而不是事后补救。** 当你调试一个运行了三小时却在第四十七步卡住的工作流时，你会感谢自己当初多写了那几行结构化日志。

长运行 Agent 任务的本质是一个分布式系统问题。你需要处理的部分失败、重试风暴、时钟偏移，和你构建微服务时遇到的挑战一模一样。区别只是，这次"服务"是大模型 API，"消息队列"是人类审批者的收件箱，"数据库"是你的工作流状态存储。理解了这一点，你会发现已有的分布式系统模式——Saga、CQRS、事件溯源、断路器——几乎可以直接复用。

Agent 不是一个黑魔法。它是一个需要被认真工程化的软件系统。而长运行任务编排，是这个工程化过程中最考验架构功力的一环。做好了这一层，你的 Agent 才真正具备了在生产环境中持续运行的能力。

---

## 相关阅读

- [AI Agent Error Recovery 实战：工具调用失败、LLM 幻觉、上下文溢出的自动降级与重试策略](/categories/AI/2026-06-05-ai-agent-error-recovery-tool-failure-hallucination-overflow-degradation-retry/)
- [Temporal.io 实战：持久化工作流引擎——Laravel 中的长事务编排与 Saga 模式的工程化替代方案](/categories/架构/Temporal-io-实战-持久化工作流引擎-Laravel中的长事务编排与Saga模式的工程化替代方案/)
- [AI Agent Debugging 实战：MCP Inspector/LangSmith Trace/日志回放](/categories/AI/AI-Agent-Debugging-实战-MCP-Inspector-LangSmith-Trace-日志回放-从黑盒到可调试的Agent开发工作流/)
