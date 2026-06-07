---
title: OpenClaw 心跳机制实战：HEARTBEAT.md 主动检查与定时任务
date: 2026-06-02 00:00:00
description: 本文深度拆解 OpenClaw 心跳机制与 HEARTBEAT.md 主动检查方案，系统讲清定时任务调度、异常判定、自动恢复与生产踩坑经验，帮助 AI Agent 项目建立可观测、可恢复、可审计的稳定运行底座，适合准备将 Agent 真正落地上线的工程团队阅读。
tags: [OpenClaw, AI Agent, HEARTBEAT, 心跳机制, 定时任务]
categories: [架构]
cover: /images/covers/openclaw-heartbeat-cover.jpg
---

OpenClaw 这类具备自主调度、周期执行与状态感知能力的 Agent 系统，一旦从“玩具 Demo”走向“持续运行的工程系统”，心跳机制就不再是一个锦上添花的小组件，而是整个运行时可靠性的地基。很多团队最开始做 Agent 时，关注的都是模型能力、工具调用、记忆检索、任务编排；真正把系统跑到线上后才发现，决定系统稳定性的往往不是大模型本身，而是“这个 Agent 现在到底活着没有、卡住没有、偏航没有、需要不需要被拉起重试”。因此，本文围绕 OpenClaw 的心跳机制做一次面向工程落地的深度拆解，聚焦 `HEARTBEAT.md` 主动检查与定时任务这两个核心抓手，讲清楚它为什么存在、如何定义、如何解析、如何调度、如何恢复，以及在生产环境里最容易踩到哪些坑。

本文不是概念科普，而是偏实战的系统设计总结。你会看到文件规范、解析策略、巡检器实现、调度器策略、故障分级与恢复、监控指标设计、和其他 Agent 框架的对比，也会看到一系列带代码的实现示例。为了方便迁移到真实项目中，文中的示例以 Python 为主，但重点不在语言，而在运行机制本身。

## 一、为什么 OpenClaw 需要心跳机制

### 1.1 Agent 系统与传统服务的根本差异

传统 Web 服务的“活着”通常很容易定义：进程存在、端口可连、健康检查接口返回 200，即可认为实例健康。但 Agent 系统并不完全遵循这个判断逻辑。一个 Agent 可能出现以下状态：

1. **进程仍在，但主循环已经停滞**：例如阻塞在工具调用、外部 API 超时、锁竞争、事件队列饥饿。
2. **调度线程还活着，但业务任务已经失控**：比如定时任务不断积压，心跳文件没有更新。
3. **模型还能返回内容，但上下文或记忆已经偏航**：Agent 在“说话”，却不是在执行预期的行为。
4. **核心依赖异常但主进程未退出**：数据库失联、向量库超时、通知通道不可达。
5. **多 Agent 协作中的局部失活**：单个 Worker 崩了，Supervisor 还活着，整个系统却逐步失能。

这意味着，Agent 的健康状态不能只靠“端口探活”来判断，而必须引入一种更贴近“任务推进与状态更新”的机制。OpenClaw 中的 `HEARTBEAT.md`，本质上就是将运行态元数据、心跳时间、检查策略、恢复动作约定到一个工程可读、机器可解析、且便于人审阅的载体里。

### 1.2 设计动机：让“健康”从黑盒变成显式契约

OpenClaw 心跳设计的核心目标不是简单地产生一个时间戳，而是把以下信息变成**显式契约**：

- 谁负责发心跳；
- 心跳多久更新一次；
- 超过多久未更新判为异常；
- 检查器如何主动巡检；
- 异常时能否自恢复；
- 人工接管时到哪里看上下文；
- 定时任务与心跳之间如何解耦；
- 多角色 Agent 如何避免误判和惊群重启。

如果把 OpenClaw 系统看成一套“由模型驱动、由调度器维持、由工具执行”的自动化运行时，那么心跳机制就是它的神经系统：它既负责感知当前状态，也负责在异常发生时触发反射动作。

### 1.3 设计原则

在长期线上运行中，一个真正有价值的心跳机制至少要满足以下原则：

#### 原则一：**可读性优先**

很多系统把运行状态埋进数据库、埋进 Redis、埋进 Prometheus 标签里，机器很好处理，人却很难快速排查。OpenClaw 采用 `HEARTBEAT.md` 这类文本化协议，其优势在于：出问题时工程师第一时间打开文件，就能看到最近心跳、检查频率、恢复策略、关联任务。

#### 原则二：**机器可解析**

可读不等于不可机读。Markdown 文件不应该只是随便写的说明文档，而应当具备结构化字段、固定 section、严格时间格式与可扩展 metadata，使巡检器能够稳定提取信息。

#### 原则三：**主动检查优于被动等待**

仅依赖 Agent 自己写心跳，无法识别“Agent 自己不再写了但进程还活着”的情况。因此必须有独立的巡检器定期主动检查心跳新鲜度，并补充运行指标、依赖连通性、任务推进情况等外部视角。

#### 原则四：**恢复动作必须幂等**

故障恢复最怕“越修越坏”。重启、清理锁、回滚状态、补发任务、切主等动作都必须幂等，防止多个检查器同时触发、或者同一故障被重复触发时放大损伤。

#### 原则五：**时间语义要一致**

心跳机制的大部分误判都来自时间：本地时区、UTC、时间漂移、夏令时、容器暂停恢复后系统时钟异常等。OpenClaw 的工程实践里，建议统一使用 ISO 8601 + UTC 存储，展示时再做本地化。

## 二、OpenClaw 心跳机制的整体架构

### 2.1 组件视图

OpenClaw 心跳体系通常由五个角色构成：

1. **Heartbeat Writer**：由 Agent 主循环或关键任务执行器负责，定期更新心跳状态。
2. **HEARTBEAT.md**：本地或共享存储中的状态声明文件，承载配置与最近运行信息。
3. **Heartbeat Parser**：负责把 Markdown 中的结构化字段解析成内部对象。
4. **Active Checker**：独立巡检任务，主动读取并评估心跳、依赖状态、任务进度。
5. **Recovery Executor**：根据故障等级执行重启、隔离、降级、告警、补偿等恢复动作。

可以用文字描述一个典型架构图：

- 左侧是 OpenClaw Agent Runtime，内部包含主循环、工具执行器、任务调度器；
- Agent Runtime 周期性向中间的 `HEARTBEAT.md` 写入状态；
- 上方是 Cron/Scheduler，定时触发 Active Checker；
- Active Checker 从 `HEARTBEAT.md`、日志、进程状态、依赖服务中拉取信息；
- 若判断异常，则调用右侧的 Recovery Executor；
- Recovery Executor 可进一步操作进程管理器、锁服务、告警通道、审计日志；
- 最终所有动作回写到 `HEARTBEAT.md` 的故障历史或恢复备注中。

### 2.2 数据流与控制流分离

一个成熟的设计要把“状态上报”与“状态判定”分开：

- **数据流**：Agent 负责持续写心跳、写最近任务、写耗时指标；
- **控制流**：Checker 独立做评估、做阈值判断、做恢复决策。

这样设计有两个好处：

1. Agent 不需要知道自己是否已经“被判死刑”，从而减少业务线程复杂度；
2. Checker 作为外部视角更容易发现“进程还在但业务已死”的情况。

### 2.3 单机与分布式两种部署场景

#### 单机场景

最简单的模式是单机运行一个 OpenClaw 进程，心跳文件放在本地工作目录：

- 优点：实现简单、排查成本低；
- 缺点：机器宕机时文件不可访问，外部巡检能力弱。

#### 分布式场景

多 Agent、多 Worker、多节点部署时，常见方案有：

- 每个实例一个 `HEARTBEAT.md`，文件放共享存储；
- 本地文件 + 汇聚上报到对象存储；
- Markdown 为人类入口，底层解析后同步到数据库或指标系统。

工程上比较稳妥的做法是：**保留 `HEARTBEAT.md` 作为源描述文件，同时将关键字段提取到监控系统**。Markdown 解决可读性，指标系统解决聚合分析。

## 三、HEARTBEAT.md 文件规范设计

### 3.1 为什么用 Markdown 而不是 JSON/YAML

很多人第一反应会问：既然需要结构化，为何不直接用 JSON/YAML？

这是个好问题。答案在于 OpenClaw 的使用场景通常不是单纯的“配置文件”，而是**兼具运行说明、状态快照、人工排障入口**的混合文档。Markdown 有三个优势：

1. **可读性更高**：工程师打开就能读，不需要心里先解析一层数据结构；
2. **可承载结构化 + 说明文本**：既能放固定字段，也能写事故备注、运行说明、手工干预步骤；
3. **版本管理友好**：Git diff 对 Markdown 的人类可读性通常优于复杂 JSON。

当然，Markdown 的代价是解析更复杂。因此规范必须足够严格。

### 3.2 推荐文件结构

下面给出一个在实战中比较稳健的 `HEARTBEAT.md` 结构示例：

```md
# HEARTBEAT

## Meta
- agent_id: openclaw-main
- role: supervisor
- environment: production
- version: 1.8.2
- host: node-a-01
- timezone: UTC

## Policy
- interval_seconds: 30
- timeout_seconds: 90
- check_mode: active
- recovery_mode: auto
- max_consecutive_failures: 3
- stale_action: restart_agent

## Runtime
- status: healthy
- last_heartbeat_at: 2026-06-02T08:30:00Z
- last_success_task_at: 2026-06-02T08:29:41Z
- current_task: digest_daily_events
- current_task_started_at: 2026-06-02T08:29:10Z
- queue_depth: 2
- avg_loop_latency_ms: 143

## Dependencies
- llm_api: healthy
- vector_store: healthy
- database: healthy
- notifier: degraded

## Recovery
- last_recovery_at: 2026-06-02T07:10:00Z
- last_recovery_action: restart_agent
- recovery_count_24h: 1
- last_recovery_reason: heartbeat_stale

## Notes
- notifier 在 08:00-09:00 间偶发超时，已启用降级缓冲队列。
```

这个格式看起来简单，但已经包含了心跳判断所需的大多数关键信息：身份、策略、运行态、依赖态、恢复态、人工说明。

### 3.3 字段设计要点

#### 1）Meta：身份与上下文

`agent_id`、`role`、`environment`、`version`、`host` 等字段决定了这份心跳记录属于谁。尤其在多实例场景中，`agent_id` 必须全局唯一，否则巡检汇总时会发生覆盖。

#### 2）Policy：策略声明

这部分相当于“系统对自己如何被检查的承诺”。核心字段有：

- `interval_seconds`：期望写心跳频率；
- `timeout_seconds`：超时阈值；
- `check_mode`：比如 active/passive；
- `recovery_mode`：auto/manual/semi-auto；
- `max_consecutive_failures`：连续失败多少次后升级；
- `stale_action`：超时默认恢复动作。

#### 3）Runtime：运行态快照

这是最常用的 section。实际判断心跳“新鲜度”的通常是 `last_heartbeat_at`；但为了降低误判，最好同时记录：

- 最近成功任务时间；
- 当前任务名；
- 当前任务起始时间；
- 队列深度；
- 主循环平均延迟。

这样当 `last_heartbeat_at` 没更新时，Checker 才能进一步分析是彻底卡死，还是只是当前长任务尚未完成。

#### 4）Dependencies：依赖健康

若只看主进程心跳，常常漏掉“核心依赖已挂”的问题。通过依赖状态字段，Checker 可以在判定时增加权重：

- 若 `llm_api=down`，则可将状态从 `healthy` 下调为 `degraded`；
- 若 `database=down` 且当前任务依赖数据库，则可直接触发降级或暂停调度。

#### 5）Recovery：恢复审计

恢复记录能帮助排查“为什么总在重启”“今天已经自恢复多少次”“是不是进入震荡状态”。这是生产环境里非常关键但常被忽略的一部分。

### 3.4 Markdown 解析的边界与约束

为了避免解析歧义，建议约定以下规则：

1. section 名固定：`Meta`、`Policy`、`Runtime`、`Dependencies`、`Recovery`、`Notes`；
2. 结构化项统一使用 `- key: value`；
3. 时间字段统一 ISO 8601 UTC；
4. 数值字段严格数字；
5. 布尔字段统一 `true/false`；
6. `Notes` 允许自由文本，但解析器可选择忽略；
7. 未识别字段保留但不作为核心判定依据；
8. 缺失关键字段时视为配置错误，而非健康状态正常。

## 四、HEARTBEAT.md 的解析实现

### 4.1 解析器设计目标

解析器不能只做“读一读文本”，它要满足以下要求：

- 支持固定 section 抽取；
- 支持字段类型校验；
- 支持容错与错误定位；
- 对缺失关键字段给出明确异常；
- 支持扩展字段透传；
- 能输出统一内部对象供 Checker 使用。

### 4.2 Python 解析示例

下面给出一个实战可用的简化解析器：

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import re

SECTION_PATTERN = re.compile(r"^##\s+(?P<name>[A-Za-z0-9_-]+)\s*$")
ITEM_PATTERN = re.compile(r"^-\s+(?P<key>[a-zA-Z0-9_\-]+):\s*(?P<value>.*)$")


class HeartbeatParseError(Exception):
    pass


@dataclass
class HeartbeatDocument:
    meta: dict[str, Any] = field(default_factory=dict)
    policy: dict[str, Any] = field(default_factory=dict)
    runtime: dict[str, Any] = field(default_factory=dict)
    dependencies: dict[str, Any] = field(default_factory=dict)
    recovery: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def parse_scalar(value: str) -> Any:
    raw = value.strip()
    if raw.lower() in {"true", "false"}:
        return raw.lower() == "true"
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if re.fullmatch(r"-?\d+\.\d+", raw):
        return float(raw)
    return raw


def parse_heartbeat_markdown(text: str) -> HeartbeatDocument:
    current_section = None
    sections: dict[str, dict[str, Any] | list[str]] = {
        "Meta": {},
        "Policy": {},
        "Runtime": {},
        "Dependencies": {},
        "Recovery": {},
        "Notes": [],
    }

    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.rstrip()
        section_match = SECTION_PATTERN.match(line)
        if section_match:
            current_section = section_match.group("name")
            if current_section not in sections:
                sections[current_section] = {}
            continue

        if not current_section or not line.strip():
            continue

        if current_section == "Notes":
            sections["Notes"].append(line)
            continue

        item_match = ITEM_PATTERN.match(line)
        if not item_match:
            raise HeartbeatParseError(
                f"Invalid line at {lineno}: expected '- key: value', got {line!r}"
            )

        key = item_match.group("key")
        value = parse_scalar(item_match.group("value"))
        assert isinstance(sections[current_section], dict)
        sections[current_section][key] = value

    doc = HeartbeatDocument(
        meta=dict(sections.get("Meta", {})),
        policy=dict(sections.get("Policy", {})),
        runtime=dict(sections.get("Runtime", {})),
        dependencies=dict(sections.get("Dependencies", {})),
        recovery=dict(sections.get("Recovery", {})),
        notes=list(sections.get("Notes", [])),
    )
    validate_heartbeat_document(doc)
    return doc


def parse_utc_timestamp(value: str, field_name: str) -> datetime:
    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except Exception as exc:
        raise HeartbeatParseError(f"Invalid timestamp in {field_name}: {value}") from exc


def validate_heartbeat_document(doc: HeartbeatDocument) -> None:
    required_meta = ["agent_id", "role", "environment"]
    required_policy = ["interval_seconds", "timeout_seconds", "check_mode", "recovery_mode"]
    required_runtime = ["status", "last_heartbeat_at"]

    for field_name in required_meta:
        if field_name not in doc.meta:
            raise HeartbeatParseError(f"Missing Meta.{field_name}")

    for field_name in required_policy:
        if field_name not in doc.policy:
            raise HeartbeatParseError(f"Missing Policy.{field_name}")

    for field_name in required_runtime:
        if field_name not in doc.runtime:
            raise HeartbeatParseError(f"Missing Runtime.{field_name}")

    if not isinstance(doc.policy["interval_seconds"], int) or doc.policy["interval_seconds"] <= 0:
        raise HeartbeatParseError("Policy.interval_seconds must be a positive integer")

    if not isinstance(doc.policy["timeout_seconds"], int) or doc.policy["timeout_seconds"] <= 0:
        raise HeartbeatParseError("Policy.timeout_seconds must be a positive integer")

    parse_utc_timestamp(doc.runtime["last_heartbeat_at"], "Runtime.last_heartbeat_at")


def load_heartbeat_file(path: str | Path) -> HeartbeatDocument:
    text = Path(path).read_text(encoding="utf-8")
    return parse_heartbeat_markdown(text)
```

### 4.3 解析实现中的关键细节

#### 细节一：Markdown 不是无限自由文本

很多团队一开始随手写 Markdown，后面才发现解析器越来越复杂。正确做法是：**只允许固定 section 下的固定行格式**，超出规范就报错。宁可写的人多一点约束，也不要让解析器无限兜底。

#### 细节二：失败要尽早暴露

一旦 `HEARTBEAT.md` 格式错误，系统应当把它视为**可观测性失效**，而不是默认健康。因为心跳文件坏了，本身就是一种高风险信号。

#### 细节三：不要把全部逻辑写进解析器

解析器只负责“读”和“校验格式”，具体的健康判定应该在 Checker 层完成。否则解析器会逐渐演变成难以维护的业务判断器。

## 五、主动健康检查实现

### 5.1 为什么必须有主动检查

若系统完全依赖 Agent 自己更新心跳，那么当 Agent 主线程卡死时，根本没人会知道。主动检查器的作用就是：**从 Agent 外部定期审视它是否仍在履行预期行为**。

主动检查通常至少做四类判断：

1. 心跳时间是否陈旧；
2. 当前任务是否超长执行；
3. 关键依赖是否不可用；
4. 进程是否存在但业务无推进。

### 5.2 健康状态分级

不要把健康判定设计成二元的 healthy/unhealthy，生产系统更适合分级：

- `healthy`：一切正常；
- `degraded`：可运行但性能或依赖异常；
- `stale`：心跳陈旧但尚未确认彻底失活；
- `failed`：确认异常，需要恢复；
- `recovering`：恢复动作执行中；
- `paused`：人为暂停，不参与告警。

### 5.3 检查器的核心逻辑

下面是一个主动健康检查器示例：

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class HealthState(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    STALE = "stale"
    FAILED = "failed"
    RECOVERING = "recovering"
    PAUSED = "paused"


@dataclass
class CheckResult:
    agent_id: str
    state: HealthState
    reasons: list[str]
    heartbeat_age_seconds: int
    should_recover: bool
    recovery_action: str | None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def seconds_since(ts: datetime) -> int:
    return int((now_utc() - ts).total_seconds())


def evaluate_dependencies(dependencies: dict[str, Any]) -> list[str]:
    issues = []
    for name, status in dependencies.items():
        status_text = str(status).lower()
        if status_text in {"down", "failed", "unhealthy"}:
            issues.append(f"dependency {name} is {status_text}")
        elif status_text in {"degraded", "slow"}:
            issues.append(f"dependency {name} is degraded")
    return issues


def check_heartbeat(doc) -> CheckResult:
    last_heartbeat = parse_utc_timestamp(
        doc.runtime["last_heartbeat_at"],
        "Runtime.last_heartbeat_at",
    )
    heartbeat_age = seconds_since(last_heartbeat)
    timeout_seconds = int(doc.policy["timeout_seconds"])
    reasons: list[str] = []
    should_recover = False
    recovery_action = None

    dependency_issues = evaluate_dependencies(doc.dependencies)
    degraded_dependency_issues = [x for x in dependency_issues if "degraded" in x]
    fatal_dependency_issues = [x for x in dependency_issues if "degraded" not in x]

    if heartbeat_age <= timeout_seconds:
        state = HealthState.HEALTHY
    elif heartbeat_age <= timeout_seconds * 2:
        state = HealthState.STALE
        reasons.append(
            f"heartbeat stale: age={heartbeat_age}s exceeds timeout={timeout_seconds}s"
        )
    else:
        state = HealthState.FAILED
        reasons.append(
            f"heartbeat expired: age={heartbeat_age}s exceeds hard limit={timeout_seconds * 2}s"
        )
        should_recover = True
        recovery_action = str(doc.policy.get("stale_action", "restart_agent"))

    if degraded_dependency_issues and state == HealthState.HEALTHY:
        state = HealthState.DEGRADED
        reasons.extend(degraded_dependency_issues)

    if fatal_dependency_issues:
        if state in {HealthState.HEALTHY, HealthState.DEGRADED}:
            state = HealthState.DEGRADED
        reasons.extend(fatal_dependency_issues)

    current_task_started_at = doc.runtime.get("current_task_started_at")
    current_task = doc.runtime.get("current_task")
    if current_task and current_task_started_at:
        task_start = parse_utc_timestamp(current_task_started_at, "Runtime.current_task_started_at")
        task_age = seconds_since(task_start)
        if task_age > timeout_seconds * 3:
            reasons.append(f"current task {current_task} running too long: {task_age}s")
            if state == HealthState.HEALTHY:
                state = HealthState.DEGRADED

    return CheckResult(
        agent_id=str(doc.meta["agent_id"]),
        state=state,
        reasons=reasons,
        heartbeat_age_seconds=heartbeat_age,
        should_recover=should_recover,
        recovery_action=recovery_action,
    )
```

### 5.4 为什么要分“软超时”和“硬超时”

在很多线上故障里，心跳偶发延迟并不等于 Agent 已经死亡。比如：

- GC 抖动导致暂停几秒到几十秒；
- 一个工具调用耗时突然升高；
- 节点 CPU 抢占导致调度延迟；
- 短时 IO 阻塞。

因此，建议使用两段阈值：

- **软超时**：进入 `stale`，先告警不立刻恢复；
- **硬超时**：进入 `failed`，触发自动恢复。

这种设计可以显著减少误重启。

### 5.5 主动检查不只读文件

严格来说，主动检查器不应只读 `HEARTBEAT.md`，还应补充外部信息源，例如：

- 进程是否存在；
- 进程 CPU/内存是否异常；
- 日志里最近是否有连续错误；
- 任务队列是否持续积压；
- 锁是否长期被占用；
- 下游 API 是否整体不可达。

一个常见的增强版判断矩阵是：

| 信号 | 正常 | 可疑 | 故障 |
|---|---|---|---|
| 心跳年龄 | < timeout | 1x-2x timeout | > 2x timeout |
| 当前任务时长 | < 3x interval | 3x-6x interval | > 6x interval |
| 队列深度 | 低 | 上升中 | 长期高位 |
| 错误率 | 低 | 偶发 | 连续高 |
| 依赖状态 | healthy | degraded | down |

通过多信号交叉判断，远比单靠一个时间戳稳健。

## 六、心跳写入端实现

### 6.1 写入端职责

心跳写入端通常在以下位置触发：

- 主循环每轮结束时；
- 长任务执行期间的阶段性 checkpoint；
- 关键依赖探测后；
- 恢复动作执行完成后。

重点是：**不要只在任务成功结束时写心跳**。否则长任务期间会被误判超时。正确做法是长任务内部也要定期刷新状态。

### 6.2 原子写入示例

心跳文件是 Checker 的关键输入，因此写入必须尽可能原子，避免半写入状态。下面给出示例：

```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import os
import tempfile


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def render_heartbeat_doc(data: dict) -> str:
    def render_section(title: str, items: dict) -> str:
        lines = [f"## {title}"]
        for key, value in items.items():
            lines.append(f"- {key}: {value}")
        return "\n".join(lines)

    sections = ["# HEARTBEAT"]
    sections.append(render_section("Meta", data["Meta"]))
    sections.append("")
    sections.append(render_section("Policy", data["Policy"]))
    sections.append("")
    sections.append(render_section("Runtime", data["Runtime"]))
    sections.append("")
    sections.append(render_section("Dependencies", data.get("Dependencies", {})))
    sections.append("")
    sections.append(render_section("Recovery", data.get("Recovery", {})))
    sections.append("")
    sections.append("## Notes")
    for line in data.get("Notes", []):
        sections.append(line)
    sections.append("")
    return "\n".join(sections)


def atomic_write(path: str | Path, content: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def write_heartbeat(path: str | Path, *, meta: dict, policy: dict, runtime: dict,
                    dependencies: dict | None = None, recovery: dict | None = None,
                    notes: list[str] | None = None) -> None:
    doc = {
        "Meta": meta,
        "Policy": policy,
        "Runtime": runtime,
        "Dependencies": dependencies or {},
        "Recovery": recovery or {},
        "Notes": notes or [],
    }
    atomic_write(path, render_heartbeat_doc(doc))
```

### 6.3 为什么原子写入很重要

曾经有团队直接 `open(..., 'w')` 写文件，结果 Checker 正好在写入中途读取，看到的是一半内容：`last_heartbeat_at` 还没写完，解析器报错，监控把实例判死并拉起重启。最终真实问题不是 Agent 崩了，而是心跳文件写入和读取竞争导致的误判。

因此，心跳文件必须：

1. 临时文件写完后再 replace；
2. 在同一文件系统中原子替换；
3. 尽量避免多个写入者；
4. 必要时加文件锁或单写者约束。

## 七、定时任务调度策略

### 7.1 为什么心跳与定时任务必须一起讨论

OpenClaw 的心跳机制不是孤立存在的。绝大多数场景下，Agent 心跳与调度器是相互影响的：

- 定时任务负责触发主动巡检；
- Agent 主循环本身可能也是定时任务驱动；
- 恢复动作可能需要重新注册调度；
- 错误的调度策略会直接制造心跳假死。

因此，讨论心跳就必须讨论调度。

### 7.2 常见调度模式

#### 模式一：固定间隔轮询

例如每 30 秒检查一次所有 `HEARTBEAT.md`。优点是简单，缺点是当实例数量上升时容易产生瞬时高峰。

#### 模式二：错峰调度

给不同 Agent 分配不同秒级 offset，例如：

- A：每分钟第 05 秒；
- B：每分钟第 15 秒；
- C：每分钟第 25 秒。

这样可避免巡检惊群。

#### 模式三：事件驱动 + 周期兜底

当 Agent 写入心跳时主动发出事件，Checker 被动接收并更新状态；同时保留定时任务兜底检查。这个模式最稳健，但实现复杂度也最高。

### 7.3 调度间隔如何设定

一个常见但错误的做法是：`interval_seconds=60`，Checker 也每 60 秒跑一次，超时阈值也是 60 秒。这样只要有一点时间抖动就容易误判。

实战中建议满足：

- 写心跳间隔：较短，常见 15s / 30s / 60s；
- 检查间隔：不大于写心跳间隔；
- 超时阈值：至少为写心跳间隔的 2-3 倍；
- 自动恢复阈值：至少为超时阈值的 1.5-2 倍。

一个较稳妥的组合示例：

- 写心跳：30s；
- Checker：20s；
- soft timeout：90s；
- hard timeout：180s。

### 7.4 调度器实现示例

下面给出一个基于 APScheduler 思想的简化实现：

```python
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


class HeartbeatScheduler:
    def __init__(self, heartbeat_paths: list[Path], check_interval: int = 20):
        self.heartbeat_paths = heartbeat_paths
        self.check_interval = check_interval
        self.executor = ThreadPoolExecutor(max_workers=8)
        self.running = False

    def run_once(self) -> None:
        futures = []
        for path in self.heartbeat_paths:
            futures.append(self.executor.submit(self.check_one, path))
        for future in futures:
            future.result()

    def check_one(self, path: Path) -> None:
        try:
            doc = load_heartbeat_file(path)
            result = check_heartbeat(doc)
            self.handle_result(path, result, doc)
        except Exception as exc:
            print(f"[checker] failed to process {path}: {exc}")

    def handle_result(self, path: Path, result: CheckResult, doc) -> None:
        print(
            f"[checker] agent={result.agent_id} state={result.state} "
            f"heartbeat_age={result.heartbeat_age_seconds}s reasons={result.reasons}"
        )
        if result.should_recover:
            execute_recovery(doc, result)

    def loop_forever(self) -> None:
        self.running = True
        while self.running:
            started = time.time()
            self.run_once()
            elapsed = time.time() - started
            sleep_seconds = max(0, self.check_interval - elapsed)
            time.sleep(sleep_seconds)
```

### 7.5 定时任务的三个关键策略

#### 策略一：错峰

若几十个 Agent 的检查任务都在整点触发，很可能同时读取文件、请求依赖、写审计，造成瞬间负载峰值。解决办法是：

- 用 agent_id hash 计算 offset；
- 在分布式部署中按节点维度打散；
- 避免所有实例统一“每分钟整点”。

#### 策略二：防重入

如果某次检查执行时间超过下次调度间隔，就可能出现检查任务重叠。检查任务必须具备**防重入**能力，例如基于锁文件、Redis 分布式锁或进程内互斥，避免同一对象被并发判定、并发恢复。

#### 策略三：超时控制

检查本身不能无限阻塞。一个成熟的 Checker 在检查依赖服务时，需要为每个探测设置短超时，例如 2-5 秒，否则检查器自己会卡死，进而整个心跳体系失效。

## 八、故障检测与自动恢复

### 8.1 故障分层

OpenClaw 中的故障恢复不能一刀切地“只会重启”。更推荐按层次设计：

#### 层 1：轻度异常

症状：心跳陈旧一次、依赖偶发降级、当前任务稍慢。

动作：
- 标记 `degraded` 或 `stale`；
- 发送告警但不恢复；
- 记录连续失败计数。

#### 层 2：中度异常

症状：连续多次心跳超时、任务时长明显超限、单个依赖持续 down。

动作：
- 执行轻量恢复，例如取消当前任务、刷新连接池、清理过期锁；
- 将状态置为 `recovering`；
- 若恢复成功则回到 `healthy`。

#### 层 3：重度异常

症状：主循环停滞、进程僵死、连续恢复失败、错误率急升。

动作：
- 重启 Agent 进程；
- 必要时切换备用实例；
- 暂停新任务进入；
- 升级告警。

### 8.2 恢复动作设计原则

恢复动作要满足四个字：**小、稳、可审计、可回滚**。

- **小**：先用最小动作恢复，不要默认大锤重启；
- **稳**：动作幂等、防并发、防连环触发；
- **可审计**：每次恢复都要有记录；
- **可回滚**：恢复动作不应造成不可逆损伤。

### 8.3 自动恢复执行器示例

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import subprocess


@dataclass
class RecoveryOutcome:
    success: bool
    action: str
    message: str


def execute_recovery(doc, result: CheckResult) -> RecoveryOutcome:
    action = result.recovery_action or "restart_agent"
    agent_id = doc.meta["agent_id"]

    if action == "restart_agent":
        return restart_agent_process(agent_id)
    if action == "clear_stale_lock":
        return clear_stale_lock(agent_id)
    if action == "pause_schedule":
        return pause_schedule(agent_id)

    return RecoveryOutcome(False, action, f"unsupported recovery action: {action}")


def restart_agent_process(agent_id: str) -> RecoveryOutcome:
    try:
        completed = subprocess.run(
            ["systemctl", "restart", f"openclaw@{agent_id}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        return RecoveryOutcome(
            True,
            "restart_agent",
            completed.stdout.strip() or "restart requested successfully",
        )
    except Exception as exc:
        return RecoveryOutcome(False, "restart_agent", str(exc))


def clear_stale_lock(agent_id: str) -> RecoveryOutcome:
    # 这里用伪代码表示：实际应接入锁服务并做 owner 校验
    return RecoveryOutcome(True, "clear_stale_lock", f"stale lock cleared for {agent_id}")


def pause_schedule(agent_id: str) -> RecoveryOutcome:
    return RecoveryOutcome(True, "pause_schedule", f"schedule paused for {agent_id}")
```

### 8.4 恢复前一定要做“二次确认”

一个常见误区是：检查器一发现超时，立即重启。结果长任务本来只是暂时没更新心跳，重启后任务中断，造成更大损失。

正确实践是：在重度恢复前做二次确认，例如：

1. 再读一次 `HEARTBEAT.md`；
2. 检查进程是否仍在推进 CPU 时间或日志；
3. 若当前任务允许，尝试发一个轻量 ping；
4. 确认连续 N 次失败后再恢复。

### 8.5 防止恢复风暴

所谓恢复风暴，是指多个 Checker 同时认为 Agent 异常，随后并发执行恢复。后果包括：

- 重启被连续触发；
- 同一个锁被多次删除；
- 任务补偿被重复投递；
- 告警雪崩。

解决方法：

- 每个 Agent 恢复前先拿恢复锁；
- 用 `recovery_count_24h` 限制每日恢复次数；
- 连续恢复失败时进入 `manual` 模式；
- 将“恢复中”状态写回心跳或独立审计存储。

## 九、生产环境踩坑记录

下面这一部分是最有工程价值的内容：很多机制在纸面上很完美，真正上线后才知道问题不在大方向，而在细节。

### 9.1 坑一：把心跳更新放在任务结束时，导致长任务全被判死

最常见。某个 Agent 执行日报汇总、长链路抓取、批量向量化等任务，一跑就是 5-10 分钟，但开发者只在任务结束后更新一次 `last_heartbeat_at`。结果 Checker 按 90 秒超时判断，任务还没做完就被拉起重启。

**解决方案：**

- 长任务必须内置 checkpoint；
- 每个阶段至少刷新一次心跳；
- 记录 `current_task_started_at` 与阶段进度；
- Checker 对已知长任务应用专门阈值。

### 9.2 坑二：使用本地时间写时间戳，跨时区部署后全线误判

有团队在北京时区机器上写 `2026-06-02 08:30:00`，Checker 在 UTC 环境读取后默认按 UTC 解释，结果直接差了 8 小时，心跳瞬间陈旧。

**解决方案：**

- 一律 ISO 8601 UTC，如 `2026-06-02T08:30:00Z`；
- 解析器禁止无时区时间字符串；
- 展示层再做人类友好的本地化。

### 9.3 坑三：Checker 和 Writer 争抢同一文件，出现半写入内容

前文已经提过，这是非常隐蔽的误判来源。更糟的是，如果 Markdown 被截断，解析器可能误读成“缺失关键字段”，进而走故障恢复流程。

**解决方案：**

- 原子写；
- 单写者；
- 多 Checker 只读；
- 必要时版本号或 checksum 校验。

### 9.4 坑四：调度器整点齐发，导致检查自己把系统打挂

某次线上事故中，100+ 个 Agent 的 Checker 都在每分钟 00 秒执行：读文件、打数据库、探测向量库、发 Prometheus push。结果数据库连接池被瞬间打满，Checker 误认为依赖 down，又触发大量恢复和告警，形成放大回路。

**解决方案：**

- 错峰调度；
- 探测依赖时限制并发；
- 用缓存降低重复健康探测；
- 将“共享依赖的健康状态”集中采集，不要每个 Agent 都单独打一次。

### 9.5 坑五：自动恢复太激进，把瞬时抖动放大成事故

比如 LLM API 短暂 30 秒超时，系统就把所有 Agent 逐个重启。实际上依赖恢复后这些 Agent 本可自动继续，但因为重启导致上下文清空、队列回放、缓存失效，业务反而进一步抖动。

**解决方案：**

- 依赖异常优先进入 `degraded` 而非立刻重启；
- 只在确认主循环失活时做进程级恢复；
- 设置恢复冷却期（cooldown）。

### 9.6 坑六：恢复动作不幂等，导致重复消费与数据污染

某 Agent 在心跳超时后触发“重放最近任务”，因为没有任务幂等键，恢复器执行了两次，导致外部系统收到重复写入。

**解决方案：**

- 补偿动作必须带幂等键；
- 重启与补偿分离；
- 恢复前检查最近动作是否已经执行成功。

### 9.7 坑七：把 HEARTBEAT.md 当日志写，文件越来越大

有团队把每一次检查结果都追加进 `HEARTBEAT.md`，几天后文件膨胀到几 MB，解析成本上升，Git diff 也不可读。

**解决方案：**

- `HEARTBEAT.md` 只保留最新状态与少量恢复摘要；
- 历史详情写入独立日志或审计文件；
- 保持心跳文件“短、小、可快读”。

## 十、与其他 Agent 框架心跳机制对比

### 10.1 与 AutoGen 一类会话编排框架对比

AutoGen 这类框架更强调多 Agent 对话编排与任务协作，本身在“长期运行时心跳”上通常没有 OpenClaw 这样显式的文件契约。它的优势在于交互抽象强，但在**工程可观测性与运维接管**方面，往往需要额外补齐。

对比来看：

- AutoGen 更关注 conversation state；
- OpenClaw 心跳更关注 runtime liveness 与运维治理；
- 如果把 AutoGen 跑到生产，也需要外加类似 `HEARTBEAT.md` 的运行态契约。

### 10.2 与 LangGraph / 工作流框架对比

LangGraph 这类框架擅长把 Agent 流程建模为图，并支持持久化状态、节点恢复、人工介入。它在“任务状态可恢复性”方面通常强于简单 Agent Runtime。

但其心跳更多隐含在运行引擎、状态存储或外部编排系统中，而不是显式暴露为一个人类可读文档。OpenClaw 的优势在于：

- 更强调“系统当前活着没有”的显式声明；
- 适合值班排障与轻量级部署；
- 与文件系统、Cron、systemd 等传统运维手段兼容性强。

### 10.3 与 Kubernetes Probe 对比

很多人会问：K8s 不是已经有 liveness/readiness probe 吗？为什么还需要 Agent 心跳？

答案是两者解决的问题层次不同：

- **K8s Probe**：判断容器/进程是否适合存活或接流量；
- **Agent Heartbeat**：判断业务循环、任务推进、依赖健康、恢复策略是否正常。

举个例子：

- 容器端口 8080 仍然返回 200；
- 但 Agent 主逻辑已经卡死 15 分钟，队列持续堆积；
- 对 Kubernetes 来说容器是“活着”的；
- 对 OpenClaw 运维来说，这个 Agent 已经“业务死亡”。

因此，最好的做法不是二选一，而是分层组合：

- Kubernetes 负责基础容器生死；
- OpenClaw Heartbeat 负责业务运行态。

### 10.4 与传统分布式调度系统对比

像 Airflow、Celery、Nomad 一类系统也有 worker heartbeat 概念，但这些机制通常面向“任务执行器在线性”，而不一定能表达 LLM Agent 的上下文偏航、工具阻塞、记忆层退化等问题。

OpenClaw 的心跳设计更贴近 Agent 特性，尤其体现在：

- 可写入当前任务语义；
- 可记录依赖退化状态；
- 可配置恢复动作；
- 可承载人工说明与值班注释。

它不是为了替代成熟调度系统，而是补足 Agent 这一层的运行可见性。

## 十一、一个完整的实战落地方案

为了把上面的设计串起来，下面给出一个生产上可落地的最小可行方案。

### 11.1 目录约定

```text
openclaw/
├── agent/
│   ├── main.py
│   ├── heartbeat.py
│   └── tasks/
├── runtime/
│   ├── HEARTBEAT.md
│   └── recovery.log
├── checker/
│   ├── parser.py
│   ├── checker.py
│   └── recovery.py
└── scripts/
    ├── run-agent.sh
    └── run-heartbeat-check.sh
```

### 11.2 运行流程

1. Agent 启动时初始化 `HEARTBEAT.md`；
2. 主循环每 30 秒刷新一次心跳；
3. 长任务阶段性更新 `current_task` 与 `last_heartbeat_at`；
4. Checker 每 20 秒主动检查一次；
5. 若连续检测心跳陈旧则标记 `stale`；
6. 若超过硬阈值且二次确认失败，则执行恢复；
7. 恢复结果写审计日志，并更新 `Recovery` section；
8. 超过每日恢复次数上限后，切换为人工介入模式。

### 11.3 关键监控指标

除了 `HEARTBEAT.md` 本身，建议额外输出以下指标：

- `openclaw_heartbeat_age_seconds`
- `openclaw_check_result_total{state=...}`
- `openclaw_recovery_total{action=...}`
- `openclaw_task_duration_seconds{task=...}`
- `openclaw_dependency_status{name=...}`
- `openclaw_queue_depth`

这些指标能用于监控聚合，而 `HEARTBEAT.md` 负责单点排障入口。

### 11.4 告警建议

建议至少配置三层告警：

1. **告警级别 P3**：单次 `stale` 或依赖 `degraded`；
2. **告警级别 P2**：连续超时、恢复动作触发；
3. **告警级别 P1**：恢复失败、连续恢复超过阈值、多个实例同时失败。

### 11.5 面向值班工程师的排障清单

当收到 OpenClaw 心跳异常告警时，可按如下顺序排查：

1. 打开 `HEARTBEAT.md`，看 `last_heartbeat_at`；
2. 看 `current_task` 是否为已知长任务；
3. 看 `Dependencies` 是否有 down/degraded；
4. 看 `Recovery` 是否最近频繁重启；
5. 查看进程日志最近 5 分钟错误；
6. 确认调度器是否重入或卡住；
7. 若恢复频繁，立即切人工模式避免震荡。

## 十二、进阶优化建议

### 12.1 把心跳从“点”升级为“状态机”

很多团队的心跳只是一个时间戳。更进一步的做法是把它变成状态机：

- `initializing`
- `healthy`
- `busy`
- `degraded`
- `stale`
- `recovering`
- `paused`
- `failed`

这样可以更清楚地区分“真的挂了”和“正在忙”。

### 12.2 对不同任务类型使用不同心跳策略

不是所有任务都适合同一阈值。例如：

- 高速轮询型任务：心跳间隔 10-30 秒；
- 批处理型任务：心跳间隔 60-120 秒，但要求阶段性 checkpoint；
- 外部 API 驱动型任务：允许短时等待，但要记录等待原因。

最怕的是“一刀切”。

### 12.3 引入恢复冷却窗口

当某 Agent 刚刚恢复完成后，在 5-10 分钟内若再次抖动，不应立刻重复执行相同重动作，而应该：

- 优先告警；
- 收集更多上下文；
- 判断是否为系统性依赖故障。

这能有效避免震荡。

### 12.4 引入“租约式心跳”而不是只有文件时间戳

更高级的实现方式是：心跳不仅写一个时间，还写一个**租约到期时间**。例如：

- `lease_issued_at`
- `lease_expires_at`

Checker 不只判断“多久没更新”，还判断“租约是否过期”。这种方式在分布式切主场景下更自然，因为它接近 Leader Lease 模型。

### 12.5 对 Markdown 做结构签名

如果担心人工误改、脚本串改或文件损坏，可对结构化区块计算 checksum，例如：

- `document_version`
- `schema_version`
- `payload_sha256`

Checker 读取后先验证签名，再做解析。这对高可靠环境尤其有用。

## 十三、总结：为什么 HEARTBEAT.md 是 OpenClaw 可靠性的关键抓手

OpenClaw 的心跳机制看似只是一个 `HEARTBEAT.md` 文件和几个定时任务，但本质上它解决的是 Agent 系统在线上最难回答的问题：**系统现在是否真的在按预期运行，以及当它不再按预期运行时，谁来发现、如何恢复、如何避免误伤。**

如果只从“有没有时间戳”理解心跳，那它的价值会被严重低估。一个成熟的 OpenClaw 心跳机制应当同时具备：

- 面向人的可读性；
- 面向机器的可解析性；
- 主动巡检能力；
- 分层故障判定；
- 幂等自动恢复；
- 定时调度治理；
- 与监控、告警、审计系统的联动。

在实际落地中，最关键的经验可以浓缩成几句话：

1. **不要把心跳理解成“进程活着”**，而要理解成“业务循环仍在推进”；
2. **不要只有被动写入**，一定要有独立的主动检查器；
3. **不要用单一阈值粗暴重启**，要引入软硬超时和多信号交叉判断；
4. **不要忽略恢复幂等与冷却机制**，否则恢复本身会成为事故放大器；
5. **不要把 `HEARTBEAT.md` 写成随意文档**，它必须是一份严格定义、稳定可解析的运行契约。

对于 OpenClaw 这样的 Agent 系统来说，模型能力决定上限，心跳与恢复机制决定下限。真正能长期稳定运行的系统，往往不是最聪明的那个，而是最早把“怎么知道自己没死、怎么优雅地恢复”这件事做扎实的那个。

当你准备把 Agent 从实验室搬进生产环境时，我会建议优先做三件事：先定义好 `HEARTBEAT.md` 的 schema，再实现外部主动 Checker，最后把恢复动作做成幂等且可审计。把这三步做完，OpenClaw 才算真正具备了持续运行的工程基础。

## 相关阅读

- [OpenClaw-模型策略实战-多模型路由与成本优化](/categories/架构/OpenClaw-模型策略实战-多模型路由与成本优化/)
- [OpenClaw-安全实战-权限控制-隐私保护-群聊行为边界](/categories/架构/OpenClaw-安全实战-权限控制-隐私保护-群聊行为边界/)
- [OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比/)
