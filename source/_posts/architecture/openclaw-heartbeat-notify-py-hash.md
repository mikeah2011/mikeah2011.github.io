---
title: OpenClaw heartbeat-notify.py 实现：警告级过滤、hash 去重与多通道分发
date: 2026-06-02 09:10:00
tags: [OpenClaw, AI Agent, 通知系统, Python, 消息分发]
keywords: [OpenClaw heartbeat, notify.py, hash, 实现, 警告级过滤, 去重与多通道分发, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 深入解析 OpenClaw heartbeat-notify.py 的三层通知机制：警告级过滤精准拦截噪音、hash 去重避免通知疲劳、多通道分发确保消息可达。涵盖冷却期策略、安静时段、通道降级等关键设计决策，附完整 Python 实现代码，适用于任何需要构建可靠告警系统的 AI Agent 场景。
---


# OpenClaw heartbeat-notify.py 实现：警告级过滤、hash 去重与多通道分发

## 前言

一个 7×24 运行的 AI Agent 系统，如果没有可靠的告警机制，就像一个没有仪表盘的汽车——你不知道它什么时候会抛锚。OpenClaw 的 heartbeat-notify.py 就是这个"仪表盘"，它负责监控系统健康状态，在异常发生时通过合适的通道（微信、飞书、QQ）通知用户。

但通知系统的设计远不是"有异常就发消息"这么简单。如果你曾经被一个疯狂发送告警的监控系统骚扰过，你就知道通知疲劳（alert fatigue）是多么严重的问题。heartbeat-notify.py 通过三层机制解决这个问题：

1. **警告级过滤**：只通知真正重要的事件，过滤噪音
2. **hash 去重**：相同类型的告警在冷却期内只发送一次
3. **多通道分发**：根据告警级别和用户偏好选择合适的通知渠道

本文将深入剖析 heartbeat-notify.py 的完整实现，带你理解每一个设计决策背后的权衡。

---

## 一、通知系统架构概览

### 1.1 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    heartbeat-notify.py                    │
│                                                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ 事件收集  │───→│ 警告过滤  │───→│    去重引擎       │   │
│  │ Collector │    │ Filter   │    │  Deduplication   │   │
│  └──────────┘    └──────────┘    └────────┬─────────┘   │
│                                            │              │
│                                            ▼              │
│                                    ┌──────────────────┐   │
│                                    │   通道分发器       │   │
│                                    │  Channel Router   │   │
│                                    └───┬────┬────┬────┘   │
│                                        │    │    │        │
│                                        ▼    ▼    ▼        │
│                                    ┌───┐┌───┐┌───┐       │
│                                    │WX ││FS ││QQ │       │
│                                    └───┘└───┘└───┘       │
└─────────────────────────────────────────────────────────┘
```

### 1.2 数据流

```python
# 整体数据流概览
"""
1. 事件收集器从以下来源收集事件：
   - heartbeat-state.json 的健康状态变化
   - MEMORY.md 的蒸馏/修剪结果
   - 系统错误日志
   - 模型服务状态变化

2. 警告过滤器根据以下规则过滤：
   - 事件级别（DEBUG/INFO/WARNING/ERROR/CRITICAL）
   - 时间窗口（安静时段不发送）
   - 事件类型白名单/黑名单

3. 去重引擎使用 hash 去重：
   - 对事件内容生成 hash
   - 在冷却期内相同 hash 的事件只发送一次
   - 使用 LRU 缓存管理 hash 记录

4. 通道分发器根据规则选择通道：
   - CRITICAL -> 所有通道
   - WARNING -> 优先飞书，备选微信
   - INFO -> 仅飞书（低优先级通道）
"""
```

---

## 二、事件定义与收集

### 2.1 事件数据模型

```python
# event_model.py
from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum
from typing import Optional, Dict
import hashlib
import json

class AlertLevel(IntEnum):
    """告警级别，数值越大越严重"""
    DEBUG = 0
    INFO = 1
    WARNING = 2
    ERROR = 3
    CRITICAL = 4

@dataclass
class NotifyEvent:
    """通知事件"""
    id: str = ""
    level: AlertLevel = AlertLevel.INFO
    source: str = ""              # 事件来源（heartbeat/distillation/system）
    title: str = ""               # 事件标题
    message: str = ""             # 事件详情
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict = field(default_factory=dict)  # 额外元数据
    hash_key: str = ""            # 用于去重的 hash
    channels_sent: list = field(default_factory=list)  # 已发送的通道
    suppressed: bool = False      # 是否被抑制

    def __post_init__(self):
        if not self.id:
            self.id = self._generate_id()
        if not self.hash_key:
            self.hash_key = self._compute_hash()

    def _generate_id(self) -> str:
        """生成事件 ID"""
        raw = f"{self.source}:{self.title}:{self.timestamp.isoformat()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:12]

    def _compute_hash(self) -> str:
        """
        计算事件的去重 hash

        hash 基于：来源 + 标题 + 级别
        不包含时间戳，这样相同类型的事件会产生相同的 hash
        """
        hash_input = f"{self.source}:{self.title}:{self.level.value}"
        return hashlib.md5(hash_input.encode()).hexdigest()

    def to_message(self, format_type: str = "text") -> str:
        """转换为通知消息格式"""
        level_emoji = {
            AlertLevel.DEBUG: "🔍",
            AlertLevel.INFO: "ℹ️",
            AlertLevel.WARNING: "⚠️",
            AlertLevel.ERROR: "❌",
            AlertLevel.CRITICAL: "🚨",
        }

        emoji = level_emoji.get(self.level, "📢")
        time_str = self.timestamp.strftime("%H:%M:%S")

        if format_type == "markdown":
            return f"""{emoji} **{self.title}**
- 级别: {self.level.name}
- 时间: {time_str}
- 来源: {self.source}
- 详情: {self.message}"""
        else:
            return (f"{emoji} [{self.level.name}] {self.title}\n"
                    f"时间: {time_str}\n"
                    f"来源: {self.source}\n"
                    f"详情: {self.message}")
```

### 2.2 事件收集器

```python
# event_collector.py
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import List

class EventCollector:
    """事件收集器：从各种来源收集告警事件"""

    def __init__(self, heartbeat_state_path: str,
                 memory_store=None,
                 log_path: str = None):
        self.state_path = Path(heartbeat_state_path)
        self.memory_store = memory_store
        self.log_path = Path(log_path) if log_path else None
        self._last_check = datetime.now()

    def collect(self) -> List[NotifyEvent]:
        """
        收集所有来源的事件

        Returns:
            自上次检查以来产生的新事件列表
        """
        events = []

        # 来源 1：心跳状态变化
        events.extend(self._collect_heartbeat_events())

        # 来源 2：系统健康状态
        events.extend(self._collect_health_events())

        # 来源 3：错误日志
        events.extend(self._collect_error_events())

        # 来源 4：记忆系统事件
        events.extend(self._collect_memory_events())

        self._last_check = datetime.now()
        return events

    def _collect_heartbeat_events(self) -> List[NotifyEvent]:
        """从 heartbeat-state.json 收集事件"""
        events = []

        if not self.state_path.exists():
            events.append(NotifyEvent(
                level=AlertLevel.ERROR,
                source="heartbeat",
                title="心跳状态文件缺失",
                message=f"heartbeat-state.json 不存在: {self.state_path}",
            ))
            return events

        try:
            with open(self.state_path, "r") as f:
                state = json.load(f)
        except json.JSONDecodeError as e:
            events.append(NotifyEvent(
                level=AlertLevel.ERROR,
                source="heartbeat",
                title="心跳状态文件损坏",
                message=f"JSON 解析失败: {str(e)}",
            ))
            return events

        heartbeat = state.get("heartbeat", {})

        # 检查心跳状态
        status = heartbeat.get("status", "unknown")
        if status == "unhealthy":
            failures = heartbeat.get("consecutive_failures", 0)
            events.append(NotifyEvent(
                level=AlertLevel.CRITICAL,
                source="heartbeat",
                title="系统心跳异常",
                message=f"连续 {failures} 次心跳失败，系统状态: {status}",
                metadata={"consecutive_failures": failures},
            ))
        elif status == "degraded":
            events.append(NotifyEvent(
                level=AlertLevel.WARNING,
                source="heartbeat",
                title="系统心跳降级",
                message=f"系统状态: {status}",
            ))

        # 检查心跳超时
        last_beat = heartbeat.get("last_beat")
        if last_beat:
            last_beat_time = datetime.fromisoformat(last_beat)
            interval = heartbeat.get("interval_seconds", 300)
            expected_next = last_beat_time + timedelta(seconds=interval * 2)
            if datetime.now() > expected_next:
                events.append(NotifyEvent(
                    level=AlertLevel.WARNING,
                    source="heartbeat",
                    title="心跳超时",
                    message=f"最后心跳: {last_beat}，已超过预期间隔 {interval}s",
                ))

        # 检查待处理任务堆积
        pending_tasks = state.get("pending_tasks", [])
        overdue_tasks = [
            t for t in pending_tasks
            if t.get("status") == "pending"
            and datetime.fromisoformat(t["scheduled_at"]) < datetime.now()
        ]
        if len(overdue_tasks) > 3:
            events.append(NotifyEvent(
                level=AlertLevel.WARNING,
                source="heartbeat",
                title="待处理任务堆积",
                message=f"有 {len(overdue_tasks)} 个任务已过期未执行",
                metadata={"overdue_count": len(overdue_tasks)},
            ))

        return events

    def _collect_health_events(self) -> List[NotifyEvent]:
        """收集系统健康事件"""
        events = []

        if not self.state_path.exists():
            return events

        try:
            with open(self.state_path, "r") as f:
                state = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return events

        health = state.get("system_health", {})

        # 检查模型状态
        model_status = health.get("model_status", {})
        for model, status in model_status.items():
            if status == "unavailable":
                events.append(NotifyEvent(
                    level=AlertLevel.ERROR,
                    source="health",
                    title=f"模型不可用: {model}",
                    message=f"模型 {model} 状态: {status}",
                ))
            elif status == "degraded":
                events.append(NotifyEvent(
                    level=AlertLevel.WARNING,
                    source="health",
                    title=f"模型性能降级: {model}",
                    message=f"模型 {model} 状态: {status}",
                ))

        # 检查内存使用
        memory_usage = health.get("memory_usage", {})
        context_pct = memory_usage.get("context_window_used_pct", 0)
        if context_pct > 80:
            events.append(NotifyEvent(
                level=AlertLevel.WARNING,
                source="health",
                title="上下文窗口使用率过高",
                message=f"当前使用率: {context_pct}%",
                metadata={"usage_pct": context_pct},
            ))

        return events

    def _collect_error_events(self) -> List[NotifyEvent]:
        """从错误日志收集事件"""
        events = []

        if not self.state_path.exists():
            return events

        try:
            with open(self.state_path, "r") as f:
                state = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return events

        error_log = state.get("system_health", {}).get("error_log", [])

        # 只处理上次检查之后的新错误
        for error in error_log:
            error_time = datetime.fromisoformat(error.get("timestamp", ""))
            if error_time > self._last_check:
                level = AlertLevel.WARNING
                if error.get("level") == "error":
                    level = AlertLevel.ERROR
                elif error.get("level") == "critical":
                    level = AlertLevel.CRITICAL

                events.append(NotifyEvent(
                    level=level,
                    source="error_log",
                    title="系统错误",
                    message=error.get("message", "未知错误"),
                ))

        return events

    def _collect_memory_events(self) -> List[NotifyEvent]:
        """收集记忆系统事件"""
        events = []

        if not self.state_path.exists():
            return events

        try:
            with open(self.state_path, "r") as f:
                state = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return events

        distillation = state.get("distillation_state", {})

        # 检查待蒸馏笔记堆积
        pending = distillation.get("pending_notes", 0)
        if pending > 10:
            events.append(NotifyEvent(
                level=AlertLevel.WARNING,
                source="memory",
                title="待蒸馏笔记堆积",
                message=f"有 {pending} 条笔记等待蒸馏处理",
                metadata={"pending_count": pending},
            ))

        return events
```

---

## 三、警告级过滤器

### 3.1 过滤策略

警告级过滤是通知系统的"第一道关卡"。它的目标是：只让真正重要的事件通过，过滤掉噪音。

```python
# alert_filter.py
from datetime import datetime, time
from typing import List, Set, Optional

class AlertFilter:
    """警告级过滤器"""

    def __init__(self, config: dict):
        self.config = config

        # 最低通知级别（低于此级别的事件直接丢弃）
        self.min_level = AlertLevel[config.get("min_level", "WARNING")]

        # 安静时段
        self.quiet_start = config.get("quiet_start_hour", 23)
        self.quiet_end = config.get("quiet_end_hour", 7)

        # 事件类型白名单（为空则允许所有）
        self.whitelist: Set[str] = set(config.get("whitelist", []))

        # 事件类型黑名单
        self.blacklist: Set[str] = set(config.get("blacklist", []))

        # 源白名单
        self.source_whitelist: Set[str] = set(config.get("source_whitelist", []))

        # 紧急事件忽略安静时段
        self.urgent_bypass_quiet = config.get("urgent_bypass_quiet", True)

    def filter(self, events: List[NotifyEvent]) -> List[NotifyEvent]:
        """
        过滤事件列表

        Args:
            events: 原始事件列表

        Returns:
            通过过滤的事件列表
        """
        filtered = []

        for event in events:
            result = self._should_pass(event)
            if result["pass"]:
                filtered.append(event)
            else:
                event.suppressed = True

        return filtered

    def _should_pass(self, event: NotifyEvent) -> dict:
        """
        判断单个事件是否应该通过过滤

        Returns:
            {"pass": bool, "reason": str}
        """
        # 规则 1：级别过滤
        if event.level < self.min_level:
            return {
                "pass": False,
                "reason": f"级别 {event.level.name} 低于最低要求 {self.min_level.name}",
            }

        # 规则 2：黑名单过滤
        if event.source in self.blacklist:
            return {"pass": False, "reason": f"来源 {event.source} 在黑名单中"}

        # 规则 3：白名单过滤（如果设置了白名单）
        if self.source_whitelist and event.source not in self.source_whitelist:
            return {"pass": False, "reason": f"来源 {event.source} 不在白名单中"}

        # 规则 4：安静时段过滤
        if self._is_quiet_hours():
            # 紧急事件可以突破安静时段
            if self.urgent_bypass_quiet and event.level >= AlertLevel.CRITICAL:
                return {"pass": True, "reason": "紧急事件，突破安静时段"}
            elif event.level < AlertLevel.ERROR:
                return {"pass": False, "reason": "安静时段，非紧急事件被抑制"}

        # 规则 5：标题白名单
        if self.whitelist and event.title not in self.whitelist:
            return {"pass": False, "reason": f"标题不在白名单中"}

        return {"pass": True, "reason": "通过所有过滤规则"}

    def _is_quiet_hours(self) -> bool:
        """检查当前是否在安静时段"""
        now = datetime.now().time()
        start = time(self.quiet_start, 0)
        end = time(self.quiet_end, 0)

        if self.quiet_start > self.quiet_end:
            # 跨午夜的情况
            return now >= start or now < end
        else:
            return start <= now < end

    def get_filter_stats(self, events: List[NotifyEvent]) -> dict:
        """获取过滤统计信息"""
        total = len(events)
        passed = sum(1 for e in events if not e.suppressed)
        suppressed = total - passed

        reasons = {}
        for event in events:
            if event.suppressed:
                result = self._should_pass(event)
                reason = result["reason"]
                reasons[reason] = reasons.get(reason, 0) + 1

        return {
            "total": total,
            "passed": passed,
            "suppressed": suppressed,
            "pass_rate": f"{passed/total*100:.1f}%" if total > 0 else "N/A",
            "suppression_reasons": reasons,
        }
```

### 3.2 动态阈值调整

在某些特殊时期（如系统升级、大规模部署），可能需要临时调整过滤阈值：

```python
class DynamicThresholdManager:
    """动态阈值管理器"""

    def __init__(self, alert_filter: AlertFilter):
        self.filter = alert_filter
        self._overrides = {}  # 临时覆盖配置

    def set_temporary_override(self, key: str, value, duration_minutes: int = 30):
        """设置临时覆盖配置"""
        from datetime import datetime, timedelta
        self._overrides[key] = {
            "value": value,
            "expires_at": datetime.now() + timedelta(minutes=duration_minutes),
        }
        self._apply_overrides()

    def clear_override(self, key: str):
        """清除临时覆盖"""
        self._overrides.pop(key, None)
        self._apply_overrides()

    def _apply_overrides(self):
        """应用当前有效的覆盖配置"""
        now = datetime.now()
        expired = [k for k, v in self._overrides.items()
                   if now > v["expires_at"]]
        for k in expired:
            del self._overrides[k]

        for key, override in self._overrides.items():
            if key == "min_level":
                self.filter.min_level = override["value"]
            elif key == "quiet_start_hour":
                self.filter.quiet_start = override["value"]
            elif key == "quiet_end_hour":
                self.filter.quiet_end = override["value"]

    def get_active_overrides(self) -> dict:
        """获取当前活跃的覆盖配置"""
        now = datetime.now()
        active = {}
        for key, override in self._overrides.items():
            if now <= override["expires_at"]:
                remaining = (override["expires_at"] - now).seconds // 60
                active[key] = {
                    "value": override["value"],
                    "expires_in_minutes": remaining,
                }
        return active
```

---

## 四、Hash 去重引擎

### 4.1 去重原理

Hash 去重的核心思想是：对每个事件计算一个"指纹"（hash），如果在冷却期内已经发送过相同指纹的事件，就不再重复发送。

```
事件 A (hash=abc123) ──→ 首次出现 ──→ 发送通知 ──→ 记录 hash + 时间戳
事件 B (hash=abc123) ──→ 冷却期内  ──→ 跳过（已发送）
事件 C (hash=abc123) ──→ 冷却期后  ──→ 发送通知 ──→ 更新时间戳
事件 D (hash=def456) ──→ 首次出现 ──→ 发送通知 ──→ 记录 hash + 时间戳
```

### 4.2 去重引擎实现

```python
# deduplication_engine.py
import hashlib
import json
import time
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Optional, Dict, List

class DeduplicationEngine:
    """Hash 去重引擎"""

    def __init__(self, config: dict):
        # 冷却期（秒）：同一 hash 的事件在此期间内只发送一次
        self.cooldown_seconds = config.get("cooldown_seconds", 3600)  # 默认 1 小时

        # LRU 缓存大小
        self.max_cache_size = config.get("max_cache_size", 10000)

        # 持久化路径
        self.persistence_path = config.get("persistence_path", None)

        # 内存缓存：hash -> (timestamp, count)
        self._cache: OrderedDict[str, tuple] = OrderedDict()
        self._lock = Lock()

        # 统计信息
        self._stats = {
            "total_checked": 0,
            "duplicates_blocked": 0,
            "unique_passed": 0,
            "cache_hits": 0,
            "cache_misses": 0,
        }

        # 从持久化存储加载
        if self.persistence_path:
            self._load_from_disk()

    def should_send(self, event: NotifyEvent) -> dict:
        """
        判断事件是否应该发送（去重检查）

        Args:
            event: 待检查的事件

        Returns:
            {
                "should_send": bool,
                "reason": str,
                "duplicate_count": int,  # 该 hash 的累计出现次数
                "last_sent": str,        # 上次发送时间
            }
        """
        with self._lock:
            self._stats["total_checked"] += 1
            hash_key = event.hash_key
            now = time.time()

            if hash_key in self._cache:
                last_time, count = self._cache[hash_key]
                elapsed = now - last_time

                if elapsed < self.cooldown_seconds:
                    # 冷却期内，抑制发送
                    self._cache[hash_key] = (last_time, count + 1)
                    self._stats["duplicates_blocked"] += 1
                    self._stats["cache_hits"] += 1

                    return {
                        "should_send": False,
                        "reason": f"冷却期内（剩余 {int(self.cooldown_seconds - elapsed)}s）",
                        "duplicate_count": count + 1,
                        "last_sent": datetime.fromtimestamp(last_time).isoformat(),
                    }
                else:
                    # 冷却期已过，允许发送并更新时间
                    self._cache[hash_key] = (now, count + 1)
                    self._cache.move_to_end(hash_key)
                    self._stats["unique_passed"] += 1
                    self._stats["cache_hits"] += 1

                    return {
                        "should_send": True,
                        "reason": "冷却期已过",
                        "duplicate_count": count + 1,
                        "last_sent": datetime.fromtimestamp(last_time).isoformat(),
                    }
            else:
                # 首次出现，允许发送
                self._cache[hash_key] = (now, 1)
                self._stats["unique_passed"] += 1
                self._stats["cache_misses"] += 1

                # LRU 淘汰
                if len(self._cache) > self.max_cache_size:
                    self._cache.popitem(last=False)

                return {
                    "should_send": True,
                    "reason": "首次出现",
                    "duplicate_count": 1,
                    "last_sent": None,
                }

    def mark_sent(self, event: NotifyEvent):
        """标记事件已发送（用于外部确认）"""
        with self._lock:
            now = time.time()
            if event.hash_key in self._cache:
                _, count = self._cache[event.hash_key]
                self._cache[event.hash_key] = (now, count)
            else:
                self._cache[event.hash_key] = (now, 1)

    def force_send(self, event: NotifyEvent):
        """强制发送（绕过去重）"""
        with self._lock:
            self._cache.pop(event.hash_key, None)

    def clear_cache(self):
        """清空去重缓存"""
        with self._lock:
            self._cache.clear()

    def get_stats(self) -> dict:
        """获取去重统计信息"""
        with self._lock:
            return {
                **self._stats,
                "cache_size": len(self._cache),
                "block_rate": (
                    f"{self._stats['duplicates_blocked'] / max(self._stats['total_checked'], 1) * 100:.1f}%"
                ),
            }

    def save_to_disk(self):
        """持久化缓存到磁盘"""
        if not self.persistence_path:
            return

        with self._lock:
            data = {
                "cache": {
                    k: {"timestamp": v[0], "count": v[1]}
                    for k, v in self._cache.items()
                },
                "stats": self._stats,
                "saved_at": datetime.now().isoformat(),
            }

            path = Path(self.persistence_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w") as f:
                json.dump(data, f, indent=2)

    def _load_from_disk(self):
        """从磁盘加载缓存"""
        path = Path(self.persistence_path)
        if not path.exists():
            return

        try:
            with open(path, "r") as f:
                data = json.load(f)

            for hash_key, info in data.get("cache", {}).items():
                self._cache[hash_key] = (info["timestamp"], info["count"])

            self._stats.update(data.get("stats", {}))

            # 清理过期缓存
            now = time.time()
            expired = [
                k for k, v in self._cache.items()
                if now - v[0] > self.cooldown_seconds * 2
            ]
            for k in expired:
                del self._cache[k]

        except (json.JSONDecodeError, KeyError):
            pass  # 缓存文件损坏，忽略
```

### 4.3 分级冷却策略

不同级别的事件应该有不同的冷却期：

```python
class TieredCooldownDeduplication(DeduplicationEngine):
    """分级冷却去重引擎"""

    # 默认冷却策略
    DEFAULT_COOLDOWNS = {
        AlertLevel.DEBUG: 0,           # DEBUG 不发送
        AlertLevel.INFO: 7200,         # INFO 2 小时
        AlertLevel.WARNING: 3600,      # WARNING 1 小时
        AlertLevel.ERROR: 1800,        # ERROR 30 分钟
        AlertLevel.CRITICAL: 300,      # CRITICAL 5 分钟（允许更频繁提醒）
    }

    def __init__(self, config: dict):
        super().__init__(config)

        # 自定义冷却策略
        custom_cooldowns = config.get("tiered_cooldowns", {})
        self.cooldowns = {**self.DEFAULT_COOLDOWNS}
        for level_name, seconds in custom_cooldowns.items():
            level = AlertLevel[level_name]
            self.cooldowns[level] = seconds

    def should_send(self, event: NotifyEvent) -> dict:
        """使用事件级别对应的冷却期进行去重"""
        # 临时设置冷却期
        original_cooldown = self.cooldown_seconds
        self.cooldown_seconds = self.cooldowns.get(
            event.level, self.cooldown_seconds)

        result = super().should_send(event)

        # 恢复原始冷却期
        self.cooldown_seconds = original_cooldown

        return result
```

---

## 五、多通道分发器

### 5.1 通道抽象

```python
# channel_abstraction.py
from abc import ABC, abstractmethod
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class NotifyChannel(ABC):
    """通知通道抽象基类"""

    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        self.enabled = config.get("enabled", True)
        self._failure_count = 0
        self._max_failures = config.get("max_failures", 5)

    @abstractmethod
    def send(self, event: NotifyEvent) -> dict:
        """
        发送通知

        Returns:
            {
                "success": bool,
                "message_id": str | None,
                "error": str | None,
            }
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """检查通道是否可用"""
        pass

    def send_with_retry(self, event: NotifyEvent,
                        max_retries: int = 3) -> dict:
        """带重试的发送"""
        for attempt in range(max_retries):
            result = self.send(event)
            if result["success"]:
                self._failure_count = 0
                return result

            self._failure_count += 1
            logger.warning(
                f"通道 {self.name} 发送失败 (尝试 {attempt + 1}/{max_retries}): "
                f"{result.get('error', '未知错误')}"
            )

        return {
            "success": False,
            "message_id": None,
            "error": f"重试 {max_retries} 次后仍然失败",
        }

    @property
    def is_healthy(self) -> bool:
        """通道是否健康（连续失败次数未超限）"""
        return self._failure_count < self._max_failures
```

### 5.2 微信通道实现

```python
# wechat_channel.py
import requests
import json
from typing import Optional

class WeChatChannel(NotifyChannel):
    """微信通知通道（通过 iLink 协议）"""

    def __init__(self, config: dict):
        super().__init__("wechat", config)
        self.api_base = config.get("api_base", "http://localhost:8080")
        self.bot_token = config.get("bot_token", "")
        self.user_id = config.get("user_id", "")
        self.group_ids = config.get("group_ids", [])

    def send(self, event: NotifyEvent) -> dict:
        """通过微信发送通知"""
        if not self.enabled:
            return {"success": False, "error": "通道已禁用"}

        try:
            message = event.to_message(format_type="text")

            # 根据事件级别选择接收者
            targets = self._get_targets(event)

            results = []
            for target in targets:
                result = self._send_message(target, message)
                results.append(result)

            success = any(r["success"] for r in results)
            return {
                "success": success,
                "message_id": results[0].get("message_id") if results else None,
                "error": results[0].get("error") if not success else None,
            }

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_targets(self, event: NotifyEvent) -> list:
        """根据事件级别确定发送目标"""
        if event.level >= AlertLevel.CRITICAL:
            # 紧急事件发送到所有目标
            return [self.user_id] + self.group_ids
        elif event.level >= AlertLevel.WARNING:
            # 警告事件只发送到私聊
            return [self.user_id]
        else:
            # 低级别事件不通过微信发送
            return []

    def _send_message(self, target_id: str, message: str) -> dict:
        """发送单条消息"""
        url = f"{self.api_base}/api/send"
        headers = {
            "Authorization": f"Bearer {self.bot_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "to": target_id,
            "type": "text",
            "content": message,
        }

        try:
            response = requests.post(url, json=payload, headers=headers,
                                     timeout=10)
            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "message_id": data.get("message_id"),
                }
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}",
                }
        except requests.RequestException as e:
            return {"success": False, "error": str(e)}

    def is_available(self) -> bool:
        """检查微信通道是否可用"""
        try:
            response = requests.get(
                f"{self.api_base}/api/health",
                timeout=5,
            )
            return response.status_code == 200
        except:
            return False
```

### 5.3 飞书通道实现

```python
# feishu_channel.py
import requests
import json

class FeishuChannel(NotifyChannel):
    """飞书通知通道"""

    def __init__(self, config: dict):
        super().__init__("feishu", config)
        self.webhook_url = config.get("webhook_url", "")
        self.secret = config.get("secret", "")

    def send(self, event: NotifyEvent) -> dict:
        """通过飞书发送通知"""
        if not self.enabled:
            return {"success": False, "error": "通道已禁用"}

        try:
            # 构建飞书卡片消息
            card = self._build_card(event)

            headers = {"Content-Type": "application/json"}
            payload = {
                "msg_type": "interactive",
                "card": card,
            }

            response = requests.post(
                self.webhook_url,
                json=payload,
                headers=headers,
                timeout=10,
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("code") == 0:
                    return {"success": True, "message_id": "feishu_sent"}
                else:
                    return {"success": False, "error": data.get("msg", "未知错误")}
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}",
                }

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _build_card(self, event: NotifyEvent) -> dict:
        """构建飞书卡片消息"""
        color_map = {
            AlertLevel.DEBUG: "grey",
            AlertLevel.INFO: "blue",
            AlertLevel.WARNING: "orange",
            AlertLevel.ERROR: "red",
            AlertLevel.CRITICAL: "red",
        }

        return {
            "header": {
                "title": {
                    "tag": "plain_text",
                    "content": f"[{event.level.name}] {event.title}",
                },
                "template": color_map.get(event.level, "blue"),
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": (
                            f"**来源**: {event.source}\n"
                            f"**时间**: {event.timestamp.strftime('%Y-%m-%d %H:%M:%S')}\n"
                            f"**详情**: {event.message}"
                        ),
                    },
                },
            ],
        }

    def is_available(self) -> bool:
        """检查飞书 webhook 是否可用"""
        return bool(self.webhook_url)
```

### 5.4 QQ 通道实现

```python
# qq_channel.py
import requests

class QQChannel(NotifyChannel):
    """QQ 通知通道"""

    def __init__(self, config: dict):
        super().__init__("qq", config)
        self.api_base = config.get("api_base", "http://localhost:5700")
        self.user_qq = config.get("user_qq", "")
        self.group_qq = config.get("group_qq", "")

    def send(self, event: NotifyEvent) -> dict:
        """通过 QQ 发送通知"""
        if not self.enabled:
            return {"success": False, "error": "通道已禁用"}

        try:
            message = event.to_message(format_type="text")

            # 紧急事件发送到私聊，普通事件发送到群
            if event.level >= AlertLevel.CRITICAL:
                result = self._send_private(message)
            else:
                result = self._send_group(message)

            return result

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _send_private(self, message: str) -> dict:
        """发送私聊消息"""
        url = f"{self.api_base}/send_private_msg"
        payload = {
            "user_id": int(self.user_qq),
            "message": message,
        }
        return self._do_send(url, payload)

    def _send_group(self, message: str) -> dict:
        """发送群消息"""
        url = f"{self.api_base}/send_group_msg"
        payload = {
            "group_id": int(self.group_qq),
            "message": message,
        }
        return self._do_send(url, payload)

    def _do_send(self, url: str, payload: dict) -> dict:
        """执行发送请求"""
        try:
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    return {"success": True, "message_id": str(data.get("data", {}).get("message_id"))}
                else:
                    return {"success": False, "error": data.get("msg", "发送失败")}
            return {"success": False, "error": f"HTTP {response.status_code}"}
        except requests.RequestException as e:
            return {"success": False, "error": str(e)}

    def is_available(self) -> bool:
        """检查 QQ 通道是否可用"""
        try:
            response = requests.get(f"{self.api_base}/get_login_info", timeout=5)
            return response.status_code == 200
        except:
            return False
```

### 5.5 通道路由器

```python
# channel_router.py
from typing import List, Dict

class ChannelRouter:
    """通道路由器：根据事件级别和配置选择发送通道"""

    # 默认路由策略
    DEFAULT_ROUTING = {
        AlertLevel.DEBUG: [],                           # DEBUG 不发送
        AlertLevel.INFO: ["feishu"],                     # INFO 只发飞书
        AlertLevel.WARNING: ["feishu", "wechat"],        // WARNING 发飞书+微信
        AlertLevel.ERROR: ["feishu", "wechat", "qq"],    // ERROR 全部通道
        AlertLevel.CRITICAL: ["feishu", "wechat", "qq"], // CRITICAL 全部通道
    }

    def __init__(self, channels: Dict[str, NotifyChannel], config: dict):
        self.channels = channels
        self.config = config

        # 自定义路由策略
        custom_routing = config.get("routing", {})
        self.routing = {**self.DEFAULT_ROUTING}
        for level_name, channel_names in custom_routing.items():
            level = AlertLevel[level_name]
            self.routing[level] = channel_names

    def route(self, event: NotifyEvent) -> List[NotifyChannel]:
        """
        根据事件级别选择发送通道

        Returns:
            应该接收此事件的通道列表
        """
        target_channel_names = self.routing.get(event.level, [])
        target_channels = []

        for name in target_channel_names:
            channel = self.channels.get(name)
            if channel and channel.enabled and channel.is_healthy:
                target_channels.append(channel)

        # 如果所有通道都不可用，返回空列表
        return target_channels

    def route_with_fallback(self, event: NotifyEvent) -> List[NotifyChannel]:
        """
        带降级的通道选择

        如果首选通道不可用，自动降级到备选通道
        """
        primary_channels = self.route(event)

        if primary_channels:
            return primary_channels

        # 降级：使用任何可用的通道
        fallback = [
            ch for ch in self.channels.values()
            if ch.enabled and ch.is_healthy
        ]

        if fallback:
            return [fallback[0]]  # 返回第一个可用通道

        return []  # 所有通道都不可用

    def get_routing_table(self) -> dict:
        """获取当前路由表"""
        table = {}
        for level, channel_names in self.routing.items():
            available = []
            for name in channel_names:
                ch = self.channels.get(name)
                status = "可用" if ch and ch.is_healthy else "不可用"
                available.append(f"{name} ({status})")
            table[level.name] = available
        return table
```

---

## 六、主程序：heartbeat-notify.py

### 6.1 完整主程序

```python
#!/usr/bin/env python3
"""
heartbeat-notify.py - OpenClaw 通知分发系统

功能：
1. 从 heartbeat-state.json 收集事件
2. 警告级过滤
3. Hash 去重
4. 多通道分发（微信/飞书/QQ）
"""

import json
import signal
import sys
import time
import logging
from datetime import datetime
from pathlib import Path

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("logs/notify.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("heartbeat-notify")

class HeartbeatNotify:
    """心跳通知系统主程序"""

    def __init__(self, config_path: str = "config/notify.yaml"):
        self.config = self._load_config(config_path)

        # 初始化组件
        self.collector = EventCollector(
            heartbeat_state_path=self.config["heartbeat_state_path"],
            log_path=self.config.get("log_path"),
        )

        self.filter = AlertFilter(self.config.get("filter", {}))
        self.dynamic_threshold = DynamicThresholdManager(self.filter)

        self.dedup = TieredCooldownDeduplication(
            self.config.get("deduplication", {}))

        # 初始化通道
        self.channels = self._init_channels()
        self.router = ChannelRouter(self.channels, self.config.get("routing", {}))

        # 运行状态
        self._running = False
        self._check_interval = self.config.get("check_interval_seconds", 60)

    def _load_config(self, config_path: str) -> dict:
        """加载配置文件"""
        import yaml
        path = Path(config_path)
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)

        # 默认配置
        return {
            "heartbeat_state_path": "./heartbeat-state.json",
            "check_interval_seconds": 60,
            "filter": {
                "min_level": "WARNING",
                "quiet_start_hour": 23,
                "quiet_end_hour": 7,
            },
            "deduplication": {
                "cooldown_seconds": 3600,
                "persistence_path": "./data/notify_dedup.json",
            },
            "channels": {
                "wechat": {"enabled": False},
                "feishu": {"enabled": False},
                "qq": {"enabled": False},
            },
        }

    def _init_channels(self) -> dict:
        """初始化通知通道"""
        channels = {}
        channel_configs = self.config.get("channels", {})

        if "wechat" in channel_configs:
            channels["wechat"] = WeChatChannel(channel_configs["wechat"])

        if "feishu" in channel_configs:
            channels["feishu"] = FeishuChannel(channel_configs["feishu"])

        if "qq" in channel_configs:
            channels["qq"] = QQChannel(channel_configs["qq"])

        return channels

    def start(self):
        """启动通知系统"""
        logger.info("启动 heartbeat-notify 通知系统")
        self._running = True

        # 注册信号处理
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

        # 主循环
        while self._running:
            try:
                self._process_cycle()
                time.sleep(self._check_interval)
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"处理周期异常: {e}", exc_info=True)
                time.sleep(min(self._check_interval, 30))

        self._shutdown()

    def stop(self):
        """停止通知系统"""
        self._running = False

    def _process_cycle(self):
        """执行一个处理周期"""
        # Step 1: 收集事件
        events = self.collector.collect()
        if not events:
            return

        logger.info(f"收集到 {len(events)} 个事件")

        # Step 2: 警告级过滤
        filtered_events = self.filter.filter(events)
        filter_stats = self.filter.get_filter_stats(events)
        if filter_stats["suppressed"] > 0:
            logger.info(
                f"过滤统计: 通过 {filter_stats['passed']}, "
                f"抑制 {filter_stats['suppressed']}"
            )

        if not filtered_events:
            return

        # Step 3: 去重 + 分发
        sent_count = 0
        for event in filtered_events:
            dedup_result = self.dedup.should_send(event)

            if not dedup_result["should_send"]:
                logger.debug(
                    f"事件被去重抑制: {event.title} "
                    f"(hash={event.hash_key[:8]}, "
                    f"原因={dedup_result['reason']})"
                )
                continue

            # Step 4: 路由到通道
            channels = self.router.route_with_fallback(event)
            if not channels:
                logger.warning(f"没有可用通道发送事件: {event.title}")
                continue

            # Step 5: 发送通知
            for channel in channels:
                result = channel.send_with_retry(event)
                if result["success"]:
                    event.channels_sent.append(channel.name)
                    self.dedup.mark_sent(event)
                    sent_count += 1
                    logger.info(
                        f"通知已发送: [{event.level.name}] {event.title} "
                        f"-> {channel.name}"
                    )
                else:
                    logger.warning(
                        f"通知发送失败: [{event.level.name}] {event.title} "
                        f"-> {channel.name}: {result.get('error')}"
                    )

        if sent_count > 0:
            logger.info(f"本周期发送 {sent_count} 条通知")

            # 持久化去重缓存
            self.dedup.save_to_disk()

    def _handle_shutdown(self, signum, frame):
        """处理关闭信号"""
        logger.info(f"收到信号 {signum}，准备关闭...")
        self._running = False

    def _shutdown(self):
        """关闭清理"""
        logger.info("正在关闭 heartbeat-notify...")
        self.dedup.save_to_disk()
        logger.info("heartbeat-notify 已关闭")

    def get_status(self) -> dict:
        """获取系统状态"""
        return {
            "running": self._running,
            "check_interval": self._check_interval,
            "filter_stats": self.filter.get_filter_stats([]),
            "dedup_stats": self.dedup.get_stats(),
            "channels": {
                name: {
                    "enabled": ch.enabled,
                    "healthy": ch.is_healthy,
                    "available": ch.is_available() if hasattr(ch, 'is_available') else True,
                }
                for name, ch in self.channels.items()
            },
            "routing_table": self.router.get_routing_table(),
        }


# CLI 入口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="OpenClaw 心跳通知系统")
    parser.add_argument("--config", default="config/notify.yaml",
                        help="配置文件路径")
    parser.add_argument("--once", action="store_true",
                        help="只执行一次（不循环）")
    parser.add_argument("--status", action="store_true",
                        help="显示系统状态")
    parser.add_argument("--dry-run", action="store_true",
                        help="干运行模式（不实际发送）")

    args = parser.parse_args()

    notifier = HeartbeatNotify(config_path=args.config)

    if args.status:
        import pprint
        pprint.pprint(notifier.get_status())
        sys.exit(0)

    if args.once:
        notifier._process_cycle()
        sys.exit(0)

    notifier.start()
```

---

## 七、配置文件

### 7.1 完整配置示例

```yaml
# config/notify.yaml
# heartbeat-notify 配置文件

# 心跳状态文件路径
heartbeat_state_path: "./heartbeat-state.json"

# 检查间隔（秒）
check_interval_seconds: 60

# 日志路径
log_path: "./logs/notify.log"

# 警告过滤配置
filter:
  # 最低通知级别（DEBUG/INFO/WARNING/ERROR/CRITICAL）
  min_level: "WARNING"

  # 安静时段（不发送非紧急通知）
  quiet_start_hour: 23
  quiet_end_hour: 7

  # 紧急事件是否突破安静时段
  urgent_bypass_quiet: true

  # 来源黑名单（不通知这些来源的事件）
  blacklist:
    - "debug"

  # 来源白名单（为空则允许所有）
  source_whitelist: []

# 去重配置
deduplication:
  # 分级冷却时间（秒）
  tiered_cooldowns:
    DEBUG: 0
    INFO: 7200      # 2 小时
    WARNING: 3600   # 1 小时
    ERROR: 1800     # 30 分钟
    CRITICAL: 300   # 5 分钟

  # LRU 缓存大小
  max_cache_size: 10000

  # 持久化路径
  persistence_path: "./data/notify_dedup.json"

# 通道配置
channels:
  wechat:
    enabled: true
    api_base: "http://localhost:8080"
    bot_token: "${WECHAT_BOT_TOKEN}"
    user_id: "${WECHAT_USER_ID}"
    group_ids: []
    max_failures: 5

  feishu:
    enabled: true
    webhook_url: "${FEISHU_WEBHOOK_URL}"
    secret: "${FEISHU_SECRET}"
    max_failures: 5

  qq:
    enabled: false
    api_base: "http://localhost:5700"
    user_qq: "${QQ_USER_ID}"
    group_qq: "${QQ_GROUP_ID}"
    max_failures: 5

# 路由策略
routing:
  DEBUG: []
  INFO:
    - feishu
  WARNING:
    - feishu
    - wechat
  ERROR:
    - feishu
    - wechat
    - qq
  CRITICAL:
    - feishu
    - wechat
    - qq
```

---

## 八、测试与验证

### 8.1 单元测试

```python
# test_notify.py
import pytest
from datetime import datetime, timedelta

class TestAlertFilter:
    """测试警告过滤器"""

    def test_below_min_level_filtered(self):
        """低于最低级别的事件应被过滤"""
        filter = AlertFilter({"min_level": "WARNING"})
        event = NotifyEvent(
            level=AlertLevel.INFO,
            source="test",
            title="测试事件",
        )
        result = filter.filter([event])
        assert len(result) == 0

    def test_above_min_level_passed(self):
        """高于最低级别的事件应通过"""
        filter = AlertFilter({"min_level": "WARNING"})
        event = NotifyEvent(
            level=AlertLevel.ERROR,
            source="test",
            title="错误事件",
        )
        result = filter.filter([event])
        assert len(result) == 1

    def test_blacklisted_source_filtered(self):
        """黑名单来源的事件应被过滤"""
        filter = AlertFilter({
            "min_level": "INFO",
            "blacklist": ["debug"],
        })
        event = NotifyEvent(
            level=AlertLevel.WARNING,
            source="debug",
            title="调试事件",
        )
        result = filter.filter([event])
        assert len(result) == 0


class TestDeduplicationEngine:
    """测试去重引擎"""

    def test_first_event_should_send(self):
        """首次出现的事件应该发送"""
        engine = DeduplicationEngine({"cooldown_seconds": 3600})
        event = NotifyEvent(
            source="test",
            title="测试事件",
            level=AlertLevel.WARNING,
        )
        result = engine.should_send(event)
        assert result["should_send"] is True
        assert result["reason"] == "首次出现"

    def test_duplicate_within_cooldown_blocked(self):
        """冷却期内的重复事件应被阻止"""
        engine = DeduplicationEngine({"cooldown_seconds": 3600})
        event = NotifyEvent(
            source="test",
            title="测试事件",
            level=AlertLevel.WARNING,
        )

        # 第一次发送
        result1 = engine.should_send(event)
        assert result1["should_send"] is True

        # 第二次应被阻止
        result2 = engine.should_send(event)
        assert result2["should_send"] is False
        assert "冷却期" in result2["reason"]

    def test_different_events_not_deduplicated(self):
        """不同事件不应被去重"""
        engine = DeduplicationEngine({"cooldown_seconds": 3600})
        event1 = NotifyEvent(source="test", title="事件A", level=AlertLevel.WARNING)
        event2 = NotifyEvent(source="test", title="事件B", level=AlertLevel.WARNING)

        result1 = engine.should_send(event1)
        result2 = engine.should_send(event2)

        assert result1["should_send"] is True
        assert result2["should_send"] is True


class TestChannelRouter:
    """测试通道路由器"""

    def test_critical_event_routed_to_all_channels(self):
        """CRITICAL 事件应路由到所有通道"""
        channels = {
            "wechat": MockChannel("wechat", enabled=True),
            "feishu": MockChannel("feishu", enabled=True),
            "qq": MockChannel("qq", enabled=True),
        }
        router = ChannelRouter(channels, {})

        event = NotifyEvent(
            level=AlertLevel.CRITICAL,
            source="test",
            title="紧急事件",
        )

        routed = router.route(event)
        assert len(routed) == 3

    def test_info_event_routed_to_feishu_only(self):
        """INFO 事件应只路由到飞书"""
        channels = {
            "wechat": MockChannel("wechat", enabled=True),
            "feishu": MockChannel("feishu", enabled=True),
        }
        router = ChannelRouter(channels, {})

        event = NotifyEvent(
            level=AlertLevel.INFO,
            source="test",
            title="信息事件",
        )

        routed = router.route(event)
        assert len(routed) == 1
        assert routed[0].name == "feishu"


class MockChannel(NotifyChannel):
    """测试用的模拟通道"""

    def __init__(self, name, enabled=True):
        super().__init__(name, {"enabled": enabled})

    def send(self, event):
        return {"success": True, "message_id": "mock_id"}

    def is_available(self):
        return True
```

---

## 九、最佳实践

### 9.1 通知系统设计原则

1. **宁可漏报，不可误报**：误报会导致通知疲劳，最终用户会忽略所有通知
2. **分级处理**：不同级别用不同策略，不要一刀切
3. **可追溯性**：每次通知都应记录原因，便于事后分析
4. **自愈能力**：通道故障时自动降级，恢复后自动回切
5. **可观测性**：提供完整的统计信息，便于调优

### 9.2 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 通知太多 | 过滤阈值太低 | 提高 min_level 或添加黑名单 |
| 通知丢失 | 通道不可用 | 启用多通道降级 |
| 重复通知 | 去重失效 | 检查 hash 计算逻辑 |
| 通知延迟 | 检查间隔太长 | 减小 check_interval_seconds |
| 安静时段误报 | 紧急事件阈值太低 | 调整 urgent_bypass_quiet 策略 |

### 9.3 监控指标

```python
# 应该监控的关键指标
KEY_METRICS = {
    "notify_events_total": "总事件数",
    "notify_events_filtered": "被过滤的事件数",
    "notify_events_deduplicated": "被去重的事件数",
    "notify_events_sent": "实际发送的事件数",
    "notify_channel_failures": "通道发送失败数",
    "notify_latency_seconds": "通知延迟（秒）",
}
```

---

## 总结

heartbeat-notify.py 通过三层机制——警告级过滤、hash 去重、多通道分发——构建了一个可靠且不会造成通知疲劳的告警系统。

核心设计决策：

1. **分级过滤**确保只有重要事件通过，减少噪音
2. **Hash 去重**避免同一问题反复通知，冷却期策略允许紧急事件更频繁提醒
3. **多通道分发**确保通知可达，降级机制保证通道故障时仍能通知
4. **安静时段**尊重用户的休息时间，紧急事件可突破限制

这套通知系统不仅适用于 OpenClaw，其设计模式可以复用到任何需要告警的场景。关键是要理解：好的通知系统不是发送更多的通知，而是在正确的时间，通过正确的通道，发送正确的通知。

---

*本文是 OpenClaw 深度剖析系列的一部分。下一篇将探讨 OpenClaw 的记忆维护循环：日常日志 → 长期记忆蒸馏 → 过时信息修剪的完整工作流。*

---

## 相关阅读

- [OpenClaw 分层记忆架构：daily notes vs MEMORY.md vs heartbeat-state.json](/categories/架构/OpenClaw-分层记忆架构-daily-notes-vs-MEMORY-md-vs-heartbeat-state-json/)
- [OpenClaw 文档漂移问题剖析：IDENTITY.md/MEMORY.md/MODEL_STRATEGY.md 不一致的根因与治理](/categories/架构/OpenClaw-文档漂移问题剖析-IDENTITY-MEMORY-MODEL-STRATEGY-不一致的根因与治理/)
- [OpenClaw 记忆维护循环：日常日志→长期记忆蒸馏→过时信息修剪](/categories/架构/OpenClaw-记忆维护循环-日常日志-长期记忆蒸馏-过时信息修剪/)
