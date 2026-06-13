---
title: OpenClaw 分层记忆架构：daily notes vs MEMORY.md vs heartbeat-state.json
date: 2026-06-02 09:05:00
tags: [OpenClaw, AI Agent, 记忆架构, 分层设计, 状态管理]
keywords: [OpenClaw, daily notes vs MEMORY.md vs heartbeat, state.json, 分层记忆架构, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 全面剖析 OpenClaw 三层记忆架构设计：daily notes 原始日志记录、MEMORY.md 长期知识存储、heartbeat-state.json 运行时状态管理。深入解析信息生命周期、蒸馏流转机制与三层协同原理，涵盖数据格式、读写策略、一致性保障，帮助你理解和正确部署 AI Agent 的分层记忆系统。
---


# OpenClaw 分层记忆架构：daily notes vs MEMORY.md vs heartbeat-state.json

## 前言

人类的记忆系统是分层的：短期记忆负责即时信息处理，工作记忆维持当前任务的上下文，长期记忆存储经过编码和巩固的知识与经验。OpenClaw 的记忆架构借鉴了这种分层设计，但做了更适合 AI Agent 场景的改造。

在 OpenClaw 中，记忆被分为三层：

- **daily notes**（每日笔记）：原始日志，记录每一次对话的原始内容
- **MEMORY.md**（策展记忆）：经过蒸馏和筛选的长期记忆
- **heartbeat-state.json**（心跳状态）：系统运行时的瞬态状态

这三层之间的关系不是简单的"新旧替换"，而是形成了一个完整的信息生命周期：信息从 daily notes 中产生，经过策展蒸馏进入 MEMORY.md，而 heartbeat-state.json 则为整个系统提供运行时的"工作记忆"。

本文将深入剖析这三层架构的设计理念、数据格式、信息流动机制，以及它们如何协同工作来支撑 OpenClaw 的智能交互能力。

---

## 一、三层架构概览

### 1.1 架构图

```
                    ┌──────────────────────────────┐
                    │     Agent 对话交互层           │
                    │  (与用户的实时对话)             │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────▼───────────────────┐
                    │   heartbeat-state.json        │  ← 第三层：运行时状态
                    │   - 最后心跳时间               │     （瞬态，频繁读写）
                    │   - 当前活跃会话               │
                    │   - 系统健康指标               │
                    │   - 待处理任务队列              │
                    └──────────┬───────────────────┘
                               │ 触发蒸馏
                    ┌──────────▼───────────────────┐
                    │   daily-notes/                │  ← 第一层：原始日志
                    │   - 2026-06-01.md             │     （写入密集，短期保留）
                    │   - 2026-06-02.md             │
                    │   - ...                       │
                    └──────────┬───────────────────┘
                               │ 策展蒸馏
                    ┌──────────▼───────────────────┐
                    │   MEMORY.md                   │  ← 第二层：策展记忆
                    │   - 用户画像                   │     （读取密集，长期保留）
                    │   - 重要决策                   │
                    │   - 技术知识                   │
                    │   - 关系网络                   │
                    └──────────────────────────────┘
```

### 1.2 三层对比

| 维度 | daily notes | MEMORY.md | heartbeat-state.json |
|------|-------------|-----------|---------------------|
| **定位** | 原始日志 | 策展记忆 | 运行时状态 |
| **数据格式** | Markdown 文件 | Markdown 文件 | JSON 文件 |
| **写入频率** | 每次对话 | 定期蒸馏 | 每次心跳/事件 |
| **读取频率** | 低（主要在蒸馏时） | 高（每次对话） | 高（每次心跳） |
| **保留周期** | 7-30 天 | 永久（定期修剪） | 当前运行周期 |
| **数据大小** | 大（原始对话） | 中（精炼后） | 小（结构化状态） |
| **一致性要求** | 低 | 高 | 中 |
| **故障影响** | 低（可重建） | 高（核心知识） | 中（可恢复） |

---

## 二、第一层：daily notes（每日笔记）

### 2.1 设计理念

daily notes 是 OpenClaw 记忆系统的"原始数据层"。它的核心原则是：

1. **只追加不修改**：每次对话产生新的记录，不修改已有内容
2. **保留原始性**：记录对话的原始内容，不做任何加工
3. **时间有序**：按日期组织，便于后续检索和蒸馏
4. **自动过期**：超过保留期限后自动清理

### 2.2 文件结构

```
daily-notes/
├── 2026-06-01.md
├── 2026-06-02.md
├── 2026-06-03.md
└── ...
```

每个日期文件的格式：

```markdown
# 2026-06-02 Daily Notes

## 09:15 - 私聊会话 [session-abc123]

**用户**: 早上好，帮我查一下 Laravel 12 的新特性

**助手**: Laravel 12 引入了以下新特性...

**[记忆标记]** 用户对 Laravel 12 新特性感兴趣
**[情感标记]** neutral
**[重要度]** 2/5

---

## 10:30 - 项目 Alpha 群 [group:project-alpha]

**用户A**: 支付模块的重构方案确定了吗？

**用户B**: 确定了，采用 Event Sourcing 模式

**助手**: 关于 Event Sourcing 模式，我建议...

**[记忆标记]** 项目 Alpha 支付模块确定采用 Event Sourcing
**[情感标记]** neutral
**[重要度]** 4/5

---

## 14:00 - 私聊会话 [session-abc123]

**用户**: 我最近压力有点大，项目太多

**助手**: 理解你的感受。项目管理方面...

**[记忆标记]** 用户近期工作压力大
**[情感标记]** concern
**[重要度]** 3/5
```

### 2.3 daily notes 写入器

```python
# daily_note_writer.py
import os
from datetime import datetime
from pathlib import Path

class DailyNoteWriter:
    """每日笔记写入器"""

    def __init__(self, base_path: str = "./daily-notes"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def append_conversation(self, session_context: dict,
                            messages: list,
                            metadata: dict = None):
        """
        追加一次对话记录到当日笔记

        Args:
            session_context: 会话上下文信息
            messages: 对话消息列表
            metadata: 额外元数据（情感、重要度等）
        """
        today = datetime.now().strftime("%Y-%m-%d")
        file_path = self.base_path / f"{today}.md"

        # 如果文件不存在，创建新文件
        if not file_path.exists():
            self._create_daily_file(file_path, today)

        # 构建对话记录
        entry = self._build_entry(session_context, messages, metadata)

        # 追加到文件
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(entry)

    def _create_daily_file(self, file_path: Path, date: str):
        """创建新的每日笔记文件"""
        header = f"""# {date} Daily Notes

"""
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(header)

    def _build_entry(self, session_context: dict, messages: list,
                     metadata: dict = None) -> str:
        """构建单次对话的记录文本"""
        now = datetime.now().strftime("%H:%M")
        session_type = session_context.get("session_type", "unknown")
        session_id = session_context.get("session_id", "unknown")

        if session_type == "group":
            group_id = session_context.get("group_id", "unknown")
            header = f"## {now} - {group_id} [group:{group_id}]"
        else:
            header = f"## {now} - 私聊会话 [{session_id}]"

        lines = [header, ""]

        # 添加消息
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                lines.append(f"**用户**: {content}")
            else:
                lines.append(f"**助手**: {content}")
            lines.append("")

        # 添加元数据标记
        if metadata:
            if "memory_tag" in metadata:
                lines.append(f"**[记忆标记]** {metadata['memory_tag']}")
            if "emotion" in metadata:
                lines.append(f"**[情感标记]** {metadata['emotion']}")
            if "importance" in metadata:
                lines.append(f"**[重要度]** {metadata['importance']}/5")

        lines.append("\n---\n")
        return "\n".join(lines)
```

### 2.4 daily notes 的生命周期管理

```python
# daily_notes_lifecycle.py
from datetime import datetime, timedelta
from pathlib import Path
import os

class DailyNotesLifecycleManager:
    """daily notes 的生命周期管理"""

    def __init__(self, base_path: str, retention_days: int = 14):
        self.base_path = Path(base_path)
        self.retention_days = retention_days

    def cleanup_expired(self):
        """清理过期的每日笔记"""
        cutoff_date = datetime.now() - timedelta(days=self.retention_days)
        cutoff_str = cutoff_date.strftime("%Y-%m-%d")

        cleaned_count = 0
        for file_path in self.base_path.glob("*.md"):
            file_date = file_path.stem  # 获取文件名（不含扩展名）
            if file_date < cutoff_str:
                file_path.unlink()
                cleaned_count += 1

        return cleaned_count

    def get_unprocessed_notes(self, last_processed_date: str = None) -> list:
        """获取尚未处理（蒸馏）的每日笔记"""
        notes = []
        for file_path in sorted(self.base_path.glob("*.md")):
            file_date = file_path.stem
            if last_processed_date and file_date <= last_processed_date:
                continue
            notes.append({
                "date": file_date,
                "path": str(file_path),
                "size": file_path.stat().st_size,
            })
        return notes

    def get_statistics(self) -> dict:
        """获取 daily notes 的统计信息"""
        files = list(self.base_path.glob("*.md"))
        if not files:
            return {"count": 0, "total_size": 0, "date_range": None}

        dates = sorted([f.stem for f in files])
        total_size = sum(f.stat().st_size for f in files)

        return {
            "count": len(files),
            "total_size": total_size,
            "total_size_mb": round(total_size / 1024 / 1024, 2),
            "date_range": {
                "earliest": dates[0],
                "latest": dates[-1],
            },
            "retention_days": self.retention_days,
        }
```

### 2.5 daily notes 的检索与查询

虽然 daily notes 主要用于蒸馏输入，但有时也需要直接检索历史对话：

```python
# daily_notes_search.py
import re
from pathlib import Path
from typing import List, Dict

class DailyNotesSearcher:
    """daily notes 的搜索与检索"""

    def __init__(self, base_path: str):
        self.base_path = Path(base_path)

    def search(self, query: str, date_range: tuple = None,
               session_type: str = None) -> List[Dict]:
        """
        在 daily notes 中搜索

        Args:
            query: 搜索关键词
            date_range: (start_date, end_date) 日期范围
            session_type: 会话类型过滤

        Returns:
            匹配的对话片段列表
        """
        results = []

        for file_path in sorted(self.base_path.glob("*.md")):
            file_date = file_path.stem

            # 日期范围过滤
            if date_range:
                if file_date < date_range[0] or file_date > date_range[1]:
                    continue

            # 读取并搜索文件内容
            content = file_path.read_text(encoding="utf-8")
            entries = self._parse_entries(content)

            for entry in entries:
                # 会话类型过滤
                if session_type and entry.get("session_type") != session_type:
                    continue

                # 关键词匹配
                if query.lower() in entry.get("content", "").lower():
                    results.append({
                        "date": file_date,
                        "time": entry.get("time"),
                        "session_type": entry.get("session_type"),
                        "content": entry.get("content"),
                        "relevance": self._calculate_relevance(query, entry),
                    })

        # 按相关度排序
        results.sort(key=lambda x: x["relevance"], reverse=True)
        return results

    def _parse_entries(self, content: str) -> List[Dict]:
        """解析每日笔记文件中的对话条目"""
        entries = []
        current_entry = None

        for line in content.split("\n"):
            # 检测新条目的开始
            if line.startswith("## "):
                if current_entry:
                    entries.append(current_entry)

                current_entry = {
                    "time": self._extract_time(line),
                    "session_type": self._extract_session_type(line),
                    "content": "",
                }
            elif current_entry:
                current_entry["content"] += line + "\n"

        if current_entry:
            entries.append(current_entry)

        return entries

    def _extract_time(self, header_line: str) -> str:
        """从标题行提取时间"""
        match = re.search(r"(\d{2}:\d{2})", header_line)
        return match.group(1) if match else ""

    def _extract_session_type(self, header_line: str) -> str:
        """从标题行提取会话类型"""
        if "group:" in header_line:
            return "group"
        elif "私聊" in header_line:
            return "private"
        return "unknown"

    def _calculate_relevance(self, query: str, entry: dict) -> float:
        """计算搜索结果的相关度"""
        content = entry.get("content", "").lower()
        query_lower = query.lower()

        # 简单的 TF 计算
        count = content.count(query_lower)
        length = max(len(content), 1)

        return count / length * 1000
```

---

## 三、第二层：MEMORY.md（策展记忆）

### 3.1 设计理念

MEMORY.md 是 OpenClaw 记忆系统的"长期知识层"。与 daily notes 的"全部记录"不同，MEMORY.md 存储的是经过策展（curated）的高质量记忆。

策展的核心原则：

1. **蒸馏而非复制**：从原始对话中提取关键信息，而非原文照搬
2. **结构化存储**：使用清晰的分类和标签组织记忆
3. **可追溯性**：每条记忆都标注来源和置信度
4. **动态更新**：随新信息不断更新和修正
5. **容量控制**：定期修剪过时或低价值的记忆

### 3.2 MEMORY.md 的完整结构

```markdown
# MEMORY.md - OpenClaw 长期记忆

> 最后更新: 2026-06-02 15:30:00
> 记忆条目总数: 47
> 上次蒸馏: 2026-06-02 09:00:00

---

## 用户画像

### 基本信息
- 姓名：Michael
- 职业：高级后端工程师 / 技术博主
- 所在地：台北
- 语言偏好：中文（繁体/简体均可），英文技术文档

### 技术栈
- 主要：PHP 8.3 / Laravel 11, MySQL 8.0, Redis 7
- 次要：Docker, Kubernetes, Terraform, Ansible
- 兴趣：AI Agent, 系统架构, DevOps
- 博客：https://mikeah2011.github.io

### 工作风格
- 偏好深度技术文章，喜欢结合实际项目经验
- 写作风格：踩坑记录 + 原理分析
- 文章长度偏好：10000-15000 字
- 重视代码示例和架构图

---

## 活跃项目

### 项目 Alpha（KKday B2C API）
- 状态：进行中
- 技术栈：Laravel 11 + PostgreSQL + Redis Cluster
- 当前迭代：支付模块重构
- 关键决策：
  - 采用 Event Sourcing 模式 [2026-05-28, 置信度: 高]
  - 使用 ShardingSphere-Proxy 处理分库分表 [2026-05-20, 置信度: 高]

### 博客项目（mikeah2011.github.io）
- 状态：持续维护
- 框架：Hexo
- 当前目标：增加 OpenClaw 系列文章
- 文章统计：
  - 架构类：15 篇
  - 数据库类：35 篇
  - DevOps 类：25 篇

---

## 技术知识库

### 已验证的知识
- MySQL 索引最左前缀原则的适用条件 [2026-04-15, 来源: 实战验证]
- Redis Cluster 的 slot 迁移机制 [2026-05-01, 来源: 生产环境]
- Laravel Queue Worker 的内存泄漏问题及修复 [2026-05-10, 来源: 生产环境]

### 待验证的知识
- PostgreSQL 的 BRIN 索引在时序数据上的性能 [2026-06-01, 来源: 社区讨论, 置信度: 中]
- K8s HPA 自定义指标的最佳实践 [2026-05-28, 来源: 文档, 置信度: 中]

---

## 关系网络

### 技术社区
- 台湾 PHP 社区活跃成员
- KKday 技术团队核心开发者

### 互动模式
- 群聊中倾向于技术讨论，少闲聊
- 私聊中会讨论职业发展和个人感受
- 对 AI Agent 领域有浓厚兴趣

---

## 记忆元数据

| ID | 记忆摘要 | 来源 | 创建时间 | 最后访问 | 置信度 | 优先级 |
|----|---------|------|---------|---------|--------|--------|
| M001 | 用户姓名 Michael | 私聊 | 2026-01-15 | 2026-06-02 | 确定 | 高 |
| M002 | Laravel B2C 项目经验 | 多次对话 | 2026-03-01 | 2026-06-01 | 确定 | 高 |
| M003 | Event Sourcing 决策 | 群聊 | 2026-05-28 | 2026-06-02 | 确定 | 中 |
| M004 | PostgreSQL BRIN 索引 | 社区讨论 | 2026-06-01 | 2026-06-01 | 待验证 | 低 |
```

### 3.3 记忆条目的数据模型

```python
# memory_entry_model.py
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List
from enum import Enum

class Confidence(Enum):
    """记忆置信度"""
    CONFIRMED = "confirmed"    # 已确认（多次验证）
    HIGH = "high"              # 高置信（来源可靠）
    MEDIUM = "medium"          # 中置信（单一来源）
    LOW = "low"                # 低置信（待验证）
    CONTRADICTED = "contradicted"  # 已被新信息否定

class Priority(Enum):
    """记忆优先级"""
    CRITICAL = 5  # 关键信息，每次对话都应加载
    HIGH = 4      # 高优先，相关对话时加载
    MEDIUM = 3    # 中优先，需要时加载
    LOW = 2       # 低优先，很少使用
    ARCHIVED = 1  # 归档，几乎不使用

@dataclass
class MemoryEntry:
    """MEMORY.md 中的单条记忆"""
    id: str                          # 唯一标识
    content: str                     # 记忆内容
    category: str                    # 分类（用户画像/项目/知识/关系）
    subcategory: str = ""            # 子分类
    source: str = ""                 # 来源描述
    source_session_id: str = ""      # 来源会话 ID
    created_at: datetime = field(default_factory=datetime.now)
    last_accessed: datetime = field(default_factory=datetime.now)
    confidence: Confidence = Confidence.MEDIUM
    priority: Priority = Priority.MEDIUM
    access_count: int = 0            # 访问次数
    related_entries: List[str] = field(default_factory=list)  # 关联记忆 ID
    tags: List[str] = field(default_factory=list)             # 标签

    def to_markdown(self) -> str:
        """转换为 Markdown 格式"""
        confidence_label = {
            Confidence.CONFIRMED: "确定",
            Confidence.HIGH: "高",
            Confidence.MEDIUM: "中",
            Confidence.LOW: "低",
            Confidence.CONTRADICTED: "已否定",
        }

        return (f"- {self.content} "
                f"[{self.created_at.strftime('%Y-%m-%d')}, "
                f"置信度: {confidence_label[self.confidence]}]")

    def touch(self):
        """更新最后访问时间和访问次数"""
        self.last_accessed = datetime.now()
        self.access_count += 1
```

### 3.4 蒸馏器：从 daily notes 到 MEMORY.md

蒸馏（distillation）是将原始对话日志转化为长期记忆的核心过程：

```python
# memory_distiller.py
from datetime import datetime
from typing import List, Dict

class MemoryDistiller:
    """记忆蒸馏器：从 daily notes 提炼长期记忆"""

    def __init__(self, llm_client, memory_store, note_reader):
        self.llm = llm_client
        self.store = memory_store
        self.reader = note_reader

    def distill(self, date_range: tuple = None) -> Dict:
        """
        执行一轮蒸馏

        Args:
            date_range: (start_date, end_date) 蒸馏的日期范围

        Returns:
            {
                "processed_dates": list,
                "new_memories": int,
                "updated_memories": int,
                "contradictions": int,
            }
        """
        # 获取待处理的 daily notes
        notes = self.reader.get_unprocessed_notes(date_range)

        stats = {
            "processed_dates": [],
            "new_memories": 0,
            "updated_memories": 0,
            "contradictions": 0,
        }

        for note in notes:
            memories = self._extract_memories(note)
            for memory in memories:
                result = self._integrate_memory(memory)
                if result == "new":
                    stats["new_memories"] += 1
                elif result == "updated":
                    stats["updated_memories"] += 1
                elif result == "contradiction":
                    stats["contradictions"] += 1

            stats["processed_dates"].append(note["date"])

        return stats

    def _extract_memories(self, note: dict) -> List[Dict]:
        """
        使用 LLM 从 daily note 中提取记忆候选

        这是蒸馏过程的核心：让 AI 理解对话内容，
        提取值得长期保存的信息
        """
        content = self.reader.read_note(note["path"])

        prompt = f"""
请从以下对话日志中提取值得长期记忆的信息。

要求：
1. 只提取有长期价值的信息，忽略临时性、一次性的内容
2. 每条记忆应包含：内容、分类、重要度(1-5)、置信度(高/中/低)
3. 如果发现与已有记忆矛盾的信息，标记为"矛盾"

对话日志：
{content}

当前已有记忆（用于去重和矛盾检测）：
{self._get_existing_memory_summary()}

请以 JSON 格式输出提取的记忆列表。
"""

        response = self.llm.generate(prompt)
        return self._parse_extraction_result(response)

    def _integrate_memory(self, new_memory: dict) -> str:
        """
        将提取的记忆集成到 MEMORY.md

        处理三种情况：
        1. 全新记忆 -> 新增
        2. 已有记忆的更新 -> 更新（附带历史）
        3. 与已有记忆矛盾 -> 标记矛盾，需要人工确认
        """
        # 检查是否与已有记忆重复或矛盾
        similar = self._find_similar_memories(new_memory["content"])

        if not similar:
            # 全新记忆
            entry = MemoryEntry(
                id=self._generate_id(),
                content=new_memory["content"],
                category=new_memory.get("category", "未分类"),
                confidence=self._map_confidence(new_memory.get("confidence")),
                priority=self._map_priority(new_memory.get("importance", 3)),
            )
            self.store.add(entry)
            return "new"

        # 检查是否矛盾
        for existing in similar:
            if self._is_contradiction(existing, new_memory):
                self._handle_contradiction(existing, new_memory)
                return "contradiction"

        # 更新已有记忆
        best_match = similar[0]
        self._update_memory(best_match, new_memory)
        return "updated"

    def _is_contradiction(self, existing: MemoryEntry,
                          new: dict) -> bool:
        """判断新记忆是否与已有记忆矛盾"""
        # 简化实现：使用 LLM 判断
        prompt = f"""
判断以下两条信息是否矛盾：

已有记忆：{existing.content}
新信息：{new["content"]}

回答：矛盾 / 不矛盾 / 补充
"""
        result = self.llm.generate(prompt)
        return "矛盾" in result

    def _handle_contradiction(self, existing: MemoryEntry, new: dict):
        """处理记忆矛盾"""
        existing.confidence = Confidence.CONTRADICTED
        existing.tags.append("需要人工确认")

        # 添加新的候选记忆（标记为待验证）
        candidate = MemoryEntry(
            id=self._generate_id(),
            content=new["content"],
            category=existing.category,
            confidence=Confidence.LOW,
            tags=["矛盾候选", f"与 {existing.id} 矛盾"],
        )
        self.store.add(candidate)

    def _get_existing_memory_summary(self) -> str:
        """获取已有记忆的摘要（用于蒸馏上下文）"""
        memories = self.store.get_all()
        summaries = []
        for m in memories[:50]:  # 限制数量避免 token 过多
            summaries.append(f"- [{m.category}] {m.content}")
        return "\n".join(summaries) if summaries else "（暂无已有记忆）"

    def _find_similar_memories(self, content: str) -> List[MemoryEntry]:
        """查找与新内容相似的已有记忆"""
        all_memories = self.store.get_all()
        similar = []
        for mem in all_memories:
            similarity = self._calculate_similarity(content, mem.content)
            if similarity > 0.6:
                similar.append(mem)
        return similar

    def _calculate_similarity(self, text_a: str, text_b: str) -> float:
        """计算两段文本的相似度"""
        def get_ngrams(text, n=2):
            return set(text[i:i+n] for i in range(len(text) - n + 1))

        ngrams_a = get_ngrams(text_a)
        ngrams_b = get_ngrams(text_b)

        if not ngrams_a or not ngrams_b:
            return 0.0

        overlap = len(ngrams_a & ngrams_b)
        return overlap / min(len(ngrams_a), len(ngrams_b))

    def _generate_id(self) -> str:
        """生成记忆 ID"""
        import hashlib
        return "M" + hashlib.md5(
            str(datetime.now().timestamp()).encode()
        ).hexdigest()[:6].upper()

    def _map_confidence(self, confidence_str: str) -> Confidence:
        mapping = {
            "高": Confidence.HIGH,
            "中": Confidence.MEDIUM,
            "低": Confidence.LOW,
            "确定": Confidence.CONFIRMED,
        }
        return mapping.get(confidence_str, Confidence.MEDIUM)

    def _map_priority(self, importance: int) -> Priority:
        mapping = {
            5: Priority.CRITICAL,
            4: Priority.HIGH,
            3: Priority.MEDIUM,
            2: Priority.LOW,
            1: Priority.ARCHIVED,
        }
        return mapping.get(importance, Priority.MEDIUM)

    def _update_memory(self, existing: MemoryEntry, new: dict):
        """更新已有记忆"""
        # 如果新信息更详细，更新内容
        if len(new["content"]) > len(existing.content):
            existing.content = new["content"]

        # 更新置信度（新确认来源提高置信度）
        if existing.confidence == Confidence.MEDIUM:
            existing.confidence = Confidence.HIGH
        elif existing.confidence == Confidence.HIGH:
            existing.confidence = Confidence.CONFIRMED

        existing.last_accessed = datetime.now()
```

### 3.5 MEMORY.md 的修剪策略

随着时间推移，MEMORY.md 中会积累越来越多的记忆。修剪（pruning）是保持记忆质量的关键：

```python
# memory_pruner.py
from datetime import datetime, timedelta

class MemoryPruner:
    """MEMORY.md 的修剪器"""

    def __init__(self, memory_store, config):
        self.store = memory_store
        self.config = config

    def prune(self) -> Dict:
        """
        执行一轮修剪

        修剪策略：
        1. 移除已否定的记忆
        2. 归档长期未访问的低优先记忆
        3. 合并重复记忆
        4. 压缩过长的记忆内容
        """
        stats = {
            "removed": 0,
            "archived": 0,
            "merged": 0,
            "compressed": 0,
        }

        all_memories = self.store.get_all()

        for memory in all_memories:
            # 策略 1：移除已否定的记忆
            if memory.confidence == Confidence.CONTRADICTED:
                age = datetime.now() - memory.created_at
                if age > timedelta(days=self.config.get(
                        "contradicted_retention_days", 7)):
                    self.store.remove(memory)
                    stats["removed"] += 1
                    continue

            # 策略 2：归档长期未访问的低优先记忆
            if memory.priority in (Priority.LOW, Priority.ARCHIVED):
                last_access = datetime.now() - memory.last_accessed
                if last_access > timedelta(days=self.config.get(
                        "archive_after_days", 30)):
                    memory.priority = Priority.ARCHIVED
                    stats["archived"] += 1

            # 策略 3：压缩过长的记忆
            max_length = self.config.get("max_memory_length", 500)
            if len(memory.content) > max_length:
                memory.content = memory.content[:max_length] + "..."
                stats["compressed"] += 1

        # 策略 4：合并重复记忆
        stats["merged"] = self._merge_duplicates()

        return stats

    def _merge_duplicates(self) -> int:
        """合并重复或高度相似的记忆"""
        all_memories = self.store.get_all()
        merged_count = 0
        processed = set()

        for i, mem_a in enumerate(all_memories):
            if mem_a.id in processed:
                continue

            for j, mem_b in enumerate(all_memories[i+1:], i+1):
                if mem_b.id in processed:
                    continue

                similarity = self._calculate_similarity(
                    mem_a.content, mem_b.content)
                if similarity > 0.8:
                    # 保留置信度更高的那个
                    if mem_a.confidence.value >= mem_b.confidence.value:
                        self.store.remove(mem_b)
                        processed.add(mem_b.id)
                    else:
                        self.store.remove(mem_a)
                        processed.add(mem_a.id)
                        break
                    merged_count += 1

        return merged_count

    def _calculate_similarity(self, text_a: str, text_b: str) -> float:
        """计算文本相似度"""
        def get_ngrams(text, n=2):
            return set(text[i:i+n] for i in range(len(text) - n + 1))

        ngrams_a = get_ngrams(text_a)
        ngrams_b = get_ngrams(text_b)

        if not ngrams_a or not ngrams_b:
            return 0.0

        overlap = len(ngrams_a & ngrams_b)
        return overlap / min(len(ngrams_a), len(ngrams_b))
```

---

## 四、第三层：heartbeat-state.json（心跳状态）

### 4.1 设计理念

heartbeat-state.json 是 OpenClaw 的"运行时工作记忆"。它不存储知识或历史，而是维护系统当前的运行状态。

核心原则：

1. **瞬态性**：状态只在当前运行周期内有效
2. **高频读写**：每次心跳都可能更新
3. **结构化**：使用 JSON 格式，便于程序解析
4. **可恢复**：系统重启后可从其他层重建

### 4.2 数据结构

```json
{
  "version": "1.2.0",
  "last_updated": "2026-06-02T15:30:45+08:00",

  "heartbeat": {
    "last_beat": "2026-06-02T15:30:45+08:00",
    "interval_seconds": 300,
    "consecutive_failures": 0,
    "status": "healthy"
  },

  "active_sessions": {
    "session-abc123": {
      "type": "private",
      "user_id": "michael",
      "started_at": "2026-06-02T15:00:00+08:00",
      "last_message_at": "2026-06-02T15:28:30+08:00",
      "message_count": 12,
      "context_tokens_used": 2048,
      "mood": "neutral"
    },
    "group-project-alpha": {
      "type": "group",
      "group_id": "project-alpha",
      "started_at": "2026-06-02T10:00:00+08:00",
      "last_message_at": "2026-06-02T14:55:00+08:00",
      "message_count": 45,
      "active_users": ["michael", "alice", "bob"],
      "topic": "支付模块重构讨论"
    }
  },

  "pending_tasks": [
    {
      "id": "task-001",
      "type": "distillation",
      "scheduled_at": "2026-06-02T16:00:00+08:00",
      "status": "pending",
      "description": "蒸馏 2026-06-02 的 daily notes"
    },
    {
      "id": "task-002",
      "type": "pruning",
      "scheduled_at": "2026-06-02T03:00:00+08:00",
      "status": "completed",
      "description": "修剪过期记忆"
    }
  ],

  "system_health": {
    "model_status": {
      "primary": "healthy",
      "fallback_1": "healthy",
      "fallback_2": "degraded"
    },
    "memory_usage": {
      "daily_notes_mb": 15.2,
      "memory_md_mb": 0.8,
      "context_window_used_pct": 45.3
    },
    "error_log": [
      {
        "timestamp": "2026-06-02T14:30:00+08:00",
        "level": "warning",
        "message": "Fallback model latency > 2s"
      }
    ]
  },

  "notifications": {
    "pending": [
      {
        "id": "notif-001",
        "channel": "wechat",
        "type": "heartbeat_alert",
        "content": "备用模型延迟升高",
        "created_at": "2026-06-02T14:30:00+08:00"
      }
    ],
    "sent_today": 3,
    "suppressed_today": 7
  },

  "distillation_state": {
    "last_processed_date": "2026-06-01",
    "total_memories": 47,
    "pending_notes": 1,
    "last_prune_date": "2026-06-02"
  }
}
```

### 4.3 心跳状态管理器

```python
# heartbeat_state_manager.py
import json
from datetime import datetime
from pathlib import Path
from threading import Lock

class HeartbeatStateManager:
    """心跳状态管理器"""

    def __init__(self, state_path: str = "./heartbeat-state.json"):
        self.state_path = Path(state_path)
        self._lock = Lock()
        self._state = self._load_or_create()

    def _load_or_create(self) -> dict:
        """加载现有状态或创建新状态"""
        if self.state_path.exists():
            with open(self.state_path, "r", encoding="utf-8") as f:
                return json.load(f)

        return self._create_initial_state()

    def _create_initial_state(self) -> dict:
        """创建初始状态"""
        now = datetime.now().isoformat()
        return {
            "version": "1.2.0",
            "last_updated": now,
            "heartbeat": {
                "last_beat": now,
                "interval_seconds": 300,
                "consecutive_failures": 0,
                "status": "initializing",
            },
            "active_sessions": {},
            "pending_tasks": [],
            "system_health": {
                "model_status": {},
                "memory_usage": {},
                "error_log": [],
            },
            "notifications": {
                "pending": [],
                "sent_today": 0,
                "suppressed_today": 0,
            },
            "distillation_state": {
                "last_processed_date": None,
                "total_memories": 0,
                "pending_notes": 0,
                "last_prune_date": None,
            },
        }

    def update_heartbeat(self):
        """更新心跳时间"""
        with self._lock:
            now = datetime.now()
            self._state["heartbeat"]["last_beat"] = now.isoformat()
            self._state["heartbeat"]["status"] = "healthy"
            self._state["heartbeat"]["consecutive_failures"] = 0
            self._state["last_updated"] = now.isoformat()
            self._save()

    def record_failure(self, error_message: str = ""):
        """记录心跳失败"""
        with self._lock:
            self._state["heartbeat"]["consecutive_failures"] += 1
            failures = self._state["heartbeat"]["consecutive_failures"]

            if failures >= 3:
                self._state["heartbeat"]["status"] = "unhealthy"
            elif failures >= 1:
                self._state["heartbeat"]["status"] = "degraded"

            if error_message:
                self._state["system_health"]["error_log"].append({
                    "timestamp": datetime.now().isoformat(),
                    "level": "error",
                    "message": error_message,
                })

            self._save()

    def update_session(self, session_id: str, session_data: dict):
        """更新活跃会话信息"""
        with self._lock:
            self._state["active_sessions"][session_id] = {
                **session_data,
                "last_updated": datetime.now().isoformat(),
            }
            self._save()

    def remove_session(self, session_id: str):
        """移除会话"""
        with self._lock:
            self._state["active_sessions"].pop(session_id, None)
            self._save()

    def add_pending_task(self, task_type: str, scheduled_at: str,
                         description: str) -> str:
        """添加待处理任务"""
        import hashlib
        task_id = "task-" + hashlib.md5(
            f"{task_type}:{scheduled_at}".encode()
        ).hexdigest()[:6]

        with self._lock:
            self._state["pending_tasks"].append({
                "id": task_id,
                "type": task_type,
                "scheduled_at": scheduled_at,
                "status": "pending",
                "description": description,
            })
            self._save()

        return task_id

    def complete_task(self, task_id: str):
        """标记任务完成"""
        with self._lock:
            for task in self._state["pending_tasks"]:
                if task["id"] == task_id:
                    task["status"] = "completed"
                    task["completed_at"] = datetime.now().isoformat()
                    break
            self._save()

    def get_health_summary(self) -> dict:
        """获取系统健康摘要"""
        with self._lock:
            heartbeat = self._state["heartbeat"]
            sessions = self._state["active_sessions"]
            health = self._state["system_health"]

            return {
                "status": heartbeat["status"],
                "last_beat": heartbeat["last_beat"],
                "active_session_count": len(sessions),
                "pending_task_count": sum(
                    1 for t in self._state["pending_tasks"]
                    if t["status"] == "pending"
                ),
                "error_count": len(health["error_log"]),
                "memory_count": self._state["distillation_state"]["total_memories"],
            }

    def _save(self):
        """保存状态到文件"""
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(self._state, f, indent=2, ensure_ascii=False)
```

### 4.4 心跳检查循环

```python
# heartbeat_loop.py
import time
from datetime import datetime, timedelta

class HeartbeatLoop:
    """心跳检查循环"""

    def __init__(self, state_manager, health_checker,
                 notification_sender, config):
        self.state = state_manager
        self.health = health_checker
        self.notifier = notification_sender
        self.config = config
        self._running = False

    def start(self):
        """启动心跳循环"""
        self._running = True
        interval = self.config.get("heartbeat_interval_seconds", 300)

        while self._running:
            try:
                self._beat()
                time.sleep(interval)
            except Exception as e:
                self.state.record_failure(str(e))
                time.sleep(min(interval, 60))  # 失败后缩短等待

    def stop(self):
        """停止心跳循环"""
        self._running = False

    def _beat(self):
        """执行一次心跳"""
        # 1. 检查系统健康状态
        health_result = self.health.check_all()

        # 2. 更新心跳状态
        self.state.update_heartbeat()

        # 3. 更新系统健康指标
        self._update_health_metrics(health_result)

        # 4. 检查是否需要发送通知
        self._check_notifications(health_result)

        # 5. 检查是否需要执行定时任务
        self._check_scheduled_tasks()

    def _update_health_metrics(self, health_result: dict):
        """更新健康指标"""
        with self.state._lock:
            self.state._state["system_health"]["model_status"] = (
                health_result.get("model_status", {})
            )
            self.state._state["system_health"]["memory_usage"] = (
                health_result.get("memory_usage", {})
            )
            self.state._save()

    def _check_notifications(self, health_result: dict):
        """检查是否需要发送通知"""
        if health_result.get("status") != "healthy":
            # 检查是否在安静时段
            if self._is_quiet_hours():
                self.state._state["notifications"]["suppressed_today"] += 1
                return

            # 检查去重（相同内容不重复发送）
            alert_key = health_result.get("alert_key", "generic")
            if self._is_duplicate_alert(alert_key):
                return

            # 发送通知
            self.notifier.send(
                channel="private",
                type="heartbeat_alert",
                content=f"系统状态异常: {health_result.get('message', '未知错误')}",
            )

            with self.state._lock:
                self.state._state["notifications"]["sent_today"] += 1
                self.state._save()

    def _is_quiet_hours(self) -> bool:
        """检查当前是否在安静时段"""
        now = datetime.now()
        quiet_start = self.config.get("quiet_hours_start", 23)
        quiet_end = self.config.get("quiet_hours_end", 7)

        if quiet_start > quiet_end:
            return now.hour >= quiet_start or now.hour < quiet_end
        return quiet_start <= now.hour < quiet_end

    def _is_duplicate_alert(self, alert_key: str) -> bool:
        """检查是否为重复告警"""
        recent_alerts = self.state._state["notifications"].get("recent_keys", [])
        if alert_key in recent_alerts:
            return True

        # 记录新的告警 key
        recent_alerts.append(alert_key)
        if len(recent_alerts) > 10:
            recent_alerts.pop(0)

        with self.state._lock:
            self.state._state["notifications"]["recent_keys"] = recent_alerts
            self.state._save()

        return False

    def _check_scheduled_tasks(self):
        """检查并执行到期的定时任务"""
        now = datetime.now()
        pending_tasks = [
            t for t in self.state._state["pending_tasks"]
            if t["status"] == "pending"
        ]

        for task in pending_tasks:
            scheduled = datetime.fromisoformat(task["scheduled_at"])
            if now >= scheduled:
                self._execute_task(task)

    def _execute_task(self, task: dict):
        """执行定时任务"""
        task_type = task["type"]

        if task_type == "distillation":
            # 触发记忆蒸馏
            from memory_distiller import MemoryDistiller
            # distiller.distill(...)
            pass
        elif task_type == "pruning":
            # 触发记忆修剪
            from memory_pruner import MemoryPruner
            # pruner.prune(...)
            pass

        self.state.complete_task(task["id"])
```

---

## 五、三层之间的信息流动

### 5.1 完整的信息生命周期

```
用户对话 ──→ daily notes ──蒸馏──→ MEMORY.md
    │              │                    │
    │              │                    │
    ▼              ▼                    ▼
heartbeat-state.json ←──── 健康检查 ────┘
    │
    │──→ 通知分发（微信/飞书/QQ）
    │──→ 定时任务调度
    └──→ 运行时状态维护
```

### 5.2 信息流动编排器

```python
# information_flow_orchestrator.py
class InformationFlowOrchestrator:
    """三层记忆系统的信息流动编排器"""

    def __init__(self, daily_writer, distiller, pruner,
                 state_manager, memory_store):
        self.daily_writer = daily_writer
        self.distiller = distiller
        self.pruner = pruner
        self.state = state_manager
        self.store = memory_store

    def on_conversation_end(self, session_context: dict,
                            messages: list, metadata: dict):
        """
        对话结束时的处理流程

        这是信息从对话层进入记忆系统的入口
        """
        # Step 1: 写入 daily notes
        self.daily_writer.append_conversation(
            session_context, messages, metadata)

        # Step 2: 更新心跳状态中的会话信息
        self.state.update_session(
            session_context["session_id"],
            {
                "type": session_context["session_type"],
                "last_message_at": datetime.now().isoformat(),
                "message_count": len(messages),
            }
        )

        # Step 3: 检查是否需要安排蒸馏任务
        self._maybe_schedule_distillation()

    def on_heartbeat(self):
        """
        心跳触发时的处理流程

        检查是否有需要执行的维护任务
        """
        # 更新心跳
        self.state.update_heartbeat()

        # 检查是否需要蒸馏
        distillation_state = self.state._state["distillation_state"]
        if distillation_state["pending_notes"] > 0:
            self._trigger_distillation()

        # 检查是否需要修剪
        last_prune = distillation_state.get("last_prune_date")
        if self._should_prune(last_prune):
            self._trigger_pruning()

    def _maybe_schedule_distillation(self):
        """根据条件决定是否安排蒸馏任务"""
        distillation_state = self.state._state["distillation_state"]

        # 如果待处理笔记超过阈值，安排蒸馏
        if distillation_state["pending_notes"] >= 3:
            self.state.add_pending_task(
                task_type="distillation",
                scheduled_at=(datetime.now() + timedelta(minutes=5)).isoformat(),
                description=f"蒸馏 {distillation_state['pending_notes']} 条待处理笔记",
            )

    def _trigger_distillation(self):
        """触发蒸馏任务"""
        try:
            result = self.distiller.distill()
            self.state._state["distillation_state"].update({
                "last_processed_date": datetime.now().strftime("%Y-%m-%d"),
                "total_memories": len(self.store.get_all()),
                "pending_notes": 0,
            })
            self.state._save()
        except Exception as e:
            self.state.record_failure(f"蒸馏失败: {str(e)}")

    def _trigger_pruning(self):
        """触发修剪任务"""
        try:
            result = self.pruner.prune()
            self.state._state["distillation_state"]["last_prune_date"] = (
                datetime.now().strftime("%Y-%m-%d")
            )
            self.state._save()
        except Exception as e:
            self.state.record_failure(f"修剪失败: {str(e)}")

    def _should_prune(self, last_prune_date: str) -> bool:
        """判断是否需要执行修剪"""
        if not last_prune_date:
            return True
        last = datetime.strptime(last_prune_date, "%Y-%m-%d")
        return (datetime.now() - last).days >= 1  # 每天修剪一次
```

---

## 六、实际部署与运维

### 6.1 目录结构

```
openclaw/
├── daily-notes/
│   ├── 2026-05-30.md
│   ├── 2026-05-31.md
│   ├── 2026-06-01.md
│   └── 2026-06-02.md
├── MEMORY.md
├── heartbeat-state.json
├── config/
│   ├── memory.yaml
│   ├── heartbeat.yaml
│   └── distillation.yaml
└── logs/
    ├── heartbeat.log
    ├── distillation.log
    └── memory-audit.log
```

### 6.2 配置文件示例

```yaml
# memory.yaml
memory:
  daily_notes:
    path: "./daily-notes"
    retention_days: 14
    max_file_size_mb: 10

  memory_md:
    path: "./MEMORY.md"
    max_entries: 200
    max_size_mb: 2
    prune_after_days: 90

  heartbeat_state:
    path: "./heartbeat-state.json"
    heartbeat_interval_seconds: 300
    quiet_hours:
      start: 23
      end: 7

distillation:
  schedule: "0 */6 * * *"  # 每6小时
  batch_size: 5
  llm_model: "default"
  timeout_seconds: 120

pruning:
  schedule: "0 3 * * *"  # 每天凌晨3点
  contradicted_retention_days: 7
  archive_after_days: 30
  max_memory_length: 500
```

### 6.3 监控与告警

```python
# memory_monitor.py
class MemorySystemMonitor:
    """三层记忆系统的监控"""

    def __init__(self, state_manager, memory_store, daily_notes_path):
        self.state = state_manager
        self.store = memory_store
        self.notes_path = daily_notes_path

    def generate_report(self) -> dict:
        """生成系统状态报告"""
        state = self.state.get_health_summary()

        return {
            "timestamp": datetime.now().isoformat(),
            "heartbeat": {
                "status": state["status"],
                "last_beat": state["last_beat"],
            },
            "daily_notes": {
                "count": self._count_note_files(),
                "total_size_mb": self._get_notes_size_mb(),
                "oldest_date": self._get_oldest_note_date(),
            },
            "memory_md": {
                "entry_count": len(self.store.get_all()),
                "size_mb": self._get_memory_md_size_mb(),
                "categories": self._get_category_distribution(),
            },
            "active_sessions": state["active_session_count"],
            "pending_tasks": state["pending_task_count"],
            "errors_today": state["error_count"],
        }

    def _count_note_files(self) -> int:
        from pathlib import Path
        return len(list(Path(self.notes_path).glob("*.md")))

    def _get_notes_size_mb(self) -> float:
        from pathlib import Path
        total = sum(f.stat().st_size for f in Path(self.notes_path).glob("*.md"))
        return round(total / 1024 / 1024, 2)

    def _get_oldest_note_date(self) -> str:
        from pathlib import Path
        files = sorted(Path(self.notes_path).glob("*.md"))
        return files[0].stem if files else "N/A"

    def _get_memory_md_size_mb(self) -> float:
        from pathlib import Path
        p = Path("./MEMORY.md")
        if p.exists():
            return round(p.stat().st_size / 1024 / 1024, 2)
        return 0.0

    def _get_category_distribution(self) -> dict:
        memories = self.store.get_all()
        dist = {}
        for m in memories:
            dist[m.category] = dist.get(m.category, 0) + 1
        return dist
```

---

## 七、故障恢复与数据一致性

### 7.1 故障场景与恢复策略

| 故障场景 | 影响范围 | 恢复策略 |
|---------|---------|---------|
| heartbeat-state.json 损坏 | 运行时状态丢失 | 从 MEMORY.md 和 daily notes 重建 |
| daily notes 文件损坏 | 历史对话丢失 | 不影响核心功能，可从 MEMORY.md 恢复 |
| MEMORY.md 损坏 | 长期记忆丢失 | 从 daily notes 重新蒸馏 |
| 全部文件损坏 | 完全重置 | 从备份恢复，或从零开始 |

### 7.2 恢复器实现

```python
# memory_recovery.py
class MemorySystemRecovery:
    """记忆系统故障恢复器"""

    def __init__(self, daily_notes_path, memory_md_path,
                 heartbeat_state_path, state_manager, memory_store):
        self.notes_path = daily_notes_path
        self.memory_path = memory_md_path
        self.state_path = heartbeat_state_path
        self.state = state_manager
        self.store = memory_store

    def recover_heartbeat_state(self):
        """
        从其他层重建 heartbeat-state.json

        重建逻辑：
        1. 扫描 daily notes 获取最近的会话信息
        2. 读取 MEMORY.md 获取记忆统计
        3. 构建新的心跳状态
        """
        from pathlib import Path

        # 重建初始状态
        new_state = self.state._create_initial_state()

        # 从 daily notes 恢复会话信息
        note_files = sorted(Path(self.notes_path).glob("*.md"))
        if note_files:
            latest_note = note_files[-1]
            sessions = self._extract_sessions_from_note(latest_note)
            new_state["active_sessions"] = sessions

        # 从 MEMORY.md 恢复记忆统计
        memory_count = self._count_memories_in_md()
        new_state["distillation_state"]["total_memories"] = memory_count

        # 恢复待处理笔记计数
        last_processed = new_state["distillation_state"].get(
            "last_processed_date")
        unprocessed = self._count_unprocessed_notes(last_processed)
        new_state["distillation_state"]["pending_notes"] = unprocessed

        # 写入恢复的状态
        self.state._state = new_state
        self.state._save()

        return {
            "recovered_sessions": len(sessions),
            "recovered_memory_count": memory_count,
            "unprocessed_notes": unprocessed,
        }

    def rebuild_memory_md(self):
        """
        从 daily notes 重建 MEMORY.md

        这是一个重量级操作，需要重新蒸馏所有 daily notes
        """
        from pathlib import Path

        note_files = sorted(Path(self.notes_path).glob("*.md"))

        # 逐个蒸馏
        all_extracted = []
        for note_file in note_files:
            content = note_file.read_text(encoding="utf-8")
            extracted = self._extract_key_memories(content)
            all_extracted.extend(extracted)

        # 去重和合并
        unique_memories = self._deduplicate(all_extracted)

        # 写入新的 MEMORY.md
        self._write_memory_md(unique_memories)

        return {
            "total_extracted": len(all_extracted),
            "unique_memories": len(unique_memories),
        }

    def _extract_sessions_from_note(self, note_path) -> dict:
        """从 daily note 中提取会话信息"""
        # 简化实现
        return {}

    def _count_memories_in_md(self) -> int:
        """统计 MEMORY.md 中的记忆条目数"""
        from pathlib import Path
        p = Path(self.memory_path)
        if not p.exists():
            return 0
        content = p.read_text(encoding="utf-8")
        return content.count("\n- ")

    def _count_unprocessed_notes(self, last_processed_date) -> int:
        """统计未处理的 daily notes 数量"""
        from pathlib import Path
        if not last_processed_date:
            return len(list(Path(self.notes_path).glob("*.md")))

        count = 0
        for f in Path(self.notes_path).glob("*.md"):
            if f.stem > last_processed_date:
                count += 1
        return count

    def _extract_key_memories(self, content: str) -> list:
        """从 daily note 内容中提取关键记忆"""
        # 实际实现中应使用 LLM
        return []

    def _deduplicate(self, memories: list) -> list:
        """去重记忆列表"""
        seen = set()
        unique = []
        for m in memories:
            key = m.get("content", "")[:100]
            if key not in seen:
                seen.add(key)
                unique.append(m)
        return unique

    def _write_memory_md(self, memories: list):
        """将记忆列表写入 MEMORY.md"""
        from pathlib import Path

        lines = [
            "# MEMORY.md - OpenClaw 长期记忆\n",
            f"> 最后更新: {datetime.now().isoformat()}\n",
            f"> 记忆条目总数: {len(memories)}\n",
            "\n---\n\n",
        ]

        # 按分类组织
        categories = {}
        for m in memories:
            cat = m.get("category", "未分类")
            categories.setdefault(cat, []).append(m)

        for category, items in categories.items():
            lines.append(f"## {category}\n\n")
            for item in items:
                lines.append(f"- {item['content']}\n")
            lines.append("\n")

        Path(self.memory_path).write_text(
            "".join(lines), encoding="utf-8")
```

---

## 八、性能优化与最佳实践

### 8.1 性能优化建议

**daily notes 优化**：
- 使用 append 模式写入，避免全文件重写
- 定期清理过期文件，控制磁盘占用
- 对大文件建立索引，加速搜索

**MEMORY.md 优化**：
- 控制记忆条目总数（建议 < 200）
- 定期修剪低价值记忆
- 使用分段加载，避免一次性读取全部记忆

**heartbeat-state.json 优化**：
- 使用文件锁避免并发写入冲突
- 控制 error_log 大小，定期截断
- 使用内存缓存减少文件读取频率

### 8.2 容量规划

| 组件 | 日增量 | 月增量 | 建议上限 |
|------|--------|--------|---------|
| daily notes | ~500KB | ~15MB | 保留 14 天 |
| MEMORY.md | ~5KB | ~150KB | 2MB / 200 条 |
| heartbeat-state.json | ~1KB | ~30KB | 1MB |

### 8.3 常见问题排查

**问题 1：蒸馏任务不执行**
- 检查 heartbeat-state.json 中的 pending_tasks
- 确认 distillation schedule 配置正确
- 查看 distillation.log 中的错误日志

**问题 2：MEMORY.md 持续增长**
- 检查 pruning schedule 是否生效
- 确认 prune_after_days 配置合理
- 手动触发一次修剪任务

**问题 3：心跳状态异常**
- 检查 heartbeat-state.json 的 consecutive_failures
- 确认模型服务可用性
- 查看 error_log 中的具体错误

---

## 总结

OpenClaw 的三层记忆架构——daily notes、MEMORY.md、heartbeat-state.json——各司其职，共同构成了一个完整的信息生命周期管理系统：

- **daily notes** 负责忠实记录，是记忆系统的"事实来源"
- **MEMORY.md** 负责长期知识存储，是记忆系统的"智慧结晶"
- **heartbeat-state.json** 负责运行时状态，是记忆系统的"工作台"

三层之间的信息流动（对话 → 日志 → 蒸馏 → 长期记忆 → 状态更新）形成了一个自洽的闭环，使得 OpenClaw 能够在持续运行中不断积累知识、优化记忆、保持健康状态。

理解这三层架构的设计理念和实现细节，是正确部署和运维 OpenClaw 的基础。希望本文的深入剖析能帮助你更好地利用 OpenClaw 的记忆系统，构建更智能、更可靠的 AI Agent。

---

*本文是 OpenClaw 深度剖析系列的一部分。下一篇将探讨 OpenClaw 的 heartbeat-notify.py 实现：警告级过滤、hash 去重与多通道分发机制。*

---

## 相关阅读

- [OpenClaw 记忆系统实战：MEMORY.md 长期记忆与日常记忆管理](/categories/架构/OpenClaw-记忆系统实战-MEMORY-md-长期记忆与日常记忆管理/)
- [OpenClaw 记忆维护循环：日常日志→长期记忆蒸馏→过时信息修剪](/categories/架构/OpenClaw-记忆维护循环-日常日志-长期记忆蒸馏-过时信息修剪/)
- [OpenClaw 隐私感知记忆分区：主会话隔离 vs 群聊上下文的安全边界](/categories/架构/OpenClaw-隐私感知记忆分区-MEMORY-md-主会话隔离-vs-群聊上下文的安全边界/)
- [OpenClaw 文档漂移问题剖析：IDENTITY.md/MEMORY.md/MODEL_STRATEGY.md 不一致的根因与治理](/categories/架构/OpenClaw-文档漂移问题剖析-IDENTITY-MEMORY-MODEL-STRATEGY-不一致的根因与治理/)
