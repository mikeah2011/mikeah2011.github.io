---
title: OpenClaw 记忆维护循环：日常日志→长期记忆蒸馏→过时信息修剪
date: 2026-06-02 09:15:00
tags: [OpenClaw, AI Agent, 记忆维护, 数据蒸馏, 自动化]
keywords: [OpenClaw, 记忆维护循环, 日常日志, 长期记忆蒸馏, 过时信息修剪, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 深入剖析 OpenClaw AI Agent 记忆维护循环的完整工作流，涵盖日常日志收集、长期记忆蒸馏与过时信息修剪三大核心环节。从设计理念到实现细节，详解如何构建自我进化的记忆系统，包括 LLM 驱动的信息提取、矛盾检测、调度策略与闭环验证机制，帮助你打造越用越聪明的 AI Agent。
---


# OpenClaw 记忆维护循环：日常日志 → 长期记忆蒸馏 → 过时信息修剪

## 前言

记忆系统是 AI Agent 的灵魂。但记忆不是写入就完事——就像人类的大脑需要睡眠来巩固记忆、遗忘来清理冗余，AI Agent 的记忆系统也需要一套完整的维护机制来保持健康。

OpenClaw 的记忆维护循环包含三个核心环节：

1. **日常日志收集**：忠实记录每一次对话
2. **长期记忆蒸馏**：从原始日志中提取有价值的信息
3. **过时信息修剪**：清理不再相关或已过时的记忆

这个循环不是一次性的操作，而是一个持续运行的"新陈代谢"过程。本文将深入剖析这个完整工作流的每一个环节，从设计理念到实现细节，从调度策略到错误处理，带你构建一个自我进化的记忆系统。

---

## 一、记忆维护循环概览

### 1.1 循环架构

```
                    ┌─────────────────────────────────────┐
                    │          记忆维护循环                  │
                    │                                      │
                    │   ┌───────────┐                      │
                    │   │ 1. 收集   │  daily-notes/*.md    │
                    │   │ Collect   │  原始对话日志         │
                    │   └─────┬─────┘                      │
                    │         │                            │
                    │         ▼                            │
                    │   ┌───────────┐                      │
                    │   │ 2. 蒸馏   │  LLM 提取关键信息     │
                    │   │ Distill   │  → 去重 → 合并        │
                    │   └─────┬─────┘                      │
                    │         │                            │
                    │         ▼                            │
                    │   ┌───────────┐                      │
                    │   │ 3. 集成   │  MEMORY.md 更新       │
                    │   │ Integrate │  新增/更新/矛盾处理    │
                    │   └─────┬─────┘                      │
                    │         │                            │
                    │         ▼                            │
                    │   ┌───────────┐                      │
                    │   │ 4. 修剪   │  清理过时/低价值记忆   │
                    │   │ Prune     │  归档/压缩/删除       │
                    │   └─────┬─────┘                      │
                    │         │                            │
                    │         ▼                            │
                    │   ┌───────────┐                      │
                    │   │ 5. 验证   │  一致性检查            │
                    │   │ Validate  │  质量评估              │
                    │   └───────────┘                      │
                    └─────────────────────────────────────┘
```

### 1.2 数据流

```
用户对话 ──→ daily-notes/2026-06-02.md
                │
                │ [蒸馏触发器：定时/手动/阈值]
                ▼
           蒸馏器 (Distiller)
           ├── LLM 提取关键信息
           ├── 去重检查
           ├── 矛盾检测
           └── 输出候选记忆
                │
                │ [集成策略：新增/更新/标记矛盾]
                ▼
           MEMORY.md 更新
           ├── 用户画像
           ├── 项目状态
           ├── 技术知识
           └── 关系网络
                │
                │ [修剪触发器：定时/容量阈值]
                ▼
           修剪器 (Pruner)
           ├── 移除已否定记忆
           ├── 归档低优先记忆
           ├── 合并重复记忆
           └── 压缩过长内容
                │
                ▼
           heartbeat-state.json 更新状态
```

---

## 二、日常日志收集

### 2.1 收集策略

日常日志是记忆维护循环的"原材料"。收集策略决定了什么信息值得记录：

```python
# collection_strategy.py
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

class CollectionMode(Enum):
    """收集模式"""
    FULL = "full"              # 完整记录所有对话
    SELECTIVE = "selective"    # 选择性记录（过滤噪音）
    MINIMAL = "minimal"        # 最小化记录（只记关键事件）

@dataclass
class CollectionRule:
    """收集规则"""
    name: str
    condition: str             # 条件表达式
    action: str                # collect / skip / summarize
    priority: int = 0

class CollectionStrategy:
    """日常日志收集策略"""

    def __init__(self, mode: CollectionMode = CollectionMode.SELECTIVE):
        self.mode = mode
        self.rules = self._build_rules()

    def _build_rules(self) -> List[CollectionRule]:
        """构建收集规则"""
        rules = [
            # 规则 1：私聊对话完整记录
            CollectionRule(
                name="private_full",
                condition="session_type == 'private'",
                action="collect",
                priority=10,
            ),
            # 规则 2：群聊中的闲聊跳过
            CollectionRule(
                name="group_skip_chitchat",
                condition="session_type == 'group' and is_chitchat",
                action="skip",
                priority=5,
            ),
            # 规则 3：群聊中的技术讨论记录
            CollectionRule(
                name="group_collect_tech",
                condition="session_type == 'group' and is_technical",
                action="collect",
                priority=8,
            ),
            # 规则 4：包含决策的对话记录
            CollectionRule(
                name="collect_decisions",
                condition="contains_decision",
                action="collect",
                priority=9,
            ),
            # 规则 5：重复性问答摘要记录
            CollectionRule(
                name="summarize_repeated",
                condition="is_repeated_question",
                action="summarize",
                priority=3,
            ),
        ]
        return sorted(rules, key=lambda r: r.priority, reverse=True)

    def evaluate(self, message: dict, session_context: dict) -> str:
        """
        评估一条消息的收集策略

        Returns:
            "collect" / "skip" / "summarize"
        """
        if self.mode == CollectionMode.FULL:
            return "collect"

        if self.mode == CollectionMode.MINIMAL:
            if self._is_important(message, session_context):
                return "collect"
            return "skip"

        # SELECTIVE 模式：按规则评估
        context = {**message, **session_context}
        for rule in self.rules:
            if self._evaluate_condition(rule.condition, context):
                return rule.action

        return "collect"  # 默认收集

    def _is_important(self, message: dict, context: dict) -> bool:
        """判断消息是否重要（MINIMAL 模式）"""
        important_indicators = [
            "决定", "方案", "确认", "部署", "上线",
            "bug", "故障", "紧急", "deadline",
        ]
        content = message.get("content", "").lower()
        return any(indicator in content for indicator in important_indicators)

    def _evaluate_condition(self, condition: str, context: dict) -> bool:
        """评估条件表达式"""
        try:
            return eval(condition, {"__builtins__": {}}, context)
        except:
            return False
```

### 2.2 日志写入器

```python
# daily_log_writer.py
import os
from datetime import datetime
from pathlib import Path
from typing import List, Dict

class DailyLogWriter:
    """日常日志写入器"""

    def __init__(self, base_path: str, strategy: CollectionStrategy):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.strategy = strategy
        self._current_file = None
        self._current_date = None

    def write_conversation(self, session_context: dict,
                           messages: List[dict],
                           metadata: dict = None):
        """
        写入一次对话记录

        Args:
            session_context: 会话上下文
            messages: 对话消息列表
            metadata: 额外元数据
        """
        today = datetime.now().strftime("%Y-%m-%d")

        # 按日期切换文件
        if today != self._current_date:
            self._rotate_file(today)

        # 应用收集策略
        collected_messages = []
        for msg in messages:
            action = self.strategy.evaluate(msg, session_context)
            if action == "collect":
                collected_messages.append(msg)
            elif action == "summarize":
                # 对摘要模式，只保留关键信息
                summary = self._summarize_message(msg)
                if summary:
                    collected_messages.append({"role": msg["role"],
                                               "content": summary})

        if not collected_messages:
            return  # 全部被过滤，不写入

        # 构建日志条目
        entry = self._build_entry(session_context, collected_messages, metadata)

        # 写入文件
        with open(self._current_file, "a", encoding="utf-8") as f:
            f.write(entry)

    def _rotate_file(self, date: str):
        """切换到新的日期文件"""
        self._current_date = date
        self._current_file = self.base_path / f"{date}.md"

        if not self._current_file.exists():
            header = f"# {date} Daily Notes\n\n"
            with open(self._current_file, "w", encoding="utf-8") as f:
                f.write(header)

    def _build_entry(self, session_context: dict, messages: list,
                     metadata: dict) -> str:
        """构建日志条目"""
        now = datetime.now().strftime("%H:%M")
        session_type = session_context.get("session_type", "unknown")

        if session_type == "group":
            group_id = session_context.get("group_id", "unknown")
            header = f"## {now} - 群聊 [{group_id}]"
        else:
            header = f"## {now} - 私聊"

        lines = [header, ""]

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            lines.append(f"**{'用户' if role == 'user' else '助手'}**: {content}")
            lines.append("")

        # 元数据标记
        if metadata:
            for key, value in metadata.items():
                lines.append(f"**[{key}]** {value}")

        lines.append("\n---\n")
        return "\n".join(lines)

    def _summarize_message(self, message: dict) -> str:
        """对消息进行摘要（简化版）"""
        content = message.get("content", "")
        if len(content) < 50:
            return content
        return content[:50] + "..."
```

### 2.3 日志质量评估

```python
# log_quality_assessor.py
class LogQualityAssessor:
    """日志质量评估器"""

    def assess(self, log_content: str) -> dict:
        """
        评估日志内容的质量

        Returns:
            {
                "score": float,  # 0.0 - 1.0
                "metrics": dict,
                "suggestions": list,
            }
        """
        metrics = {
            "information_density": self._calc_information_density(log_content),
            "conversation_completeness": self._calc_completeness(log_content),
            "noise_ratio": self._calc_noise_ratio(log_content),
            "actionability": self._calc_actionability(log_content),
        }

        # 综合评分
        score = (
            metrics["information_density"] * 0.3 +
            metrics["conversation_completeness"] * 0.2 +
            (1 - metrics["noise_ratio"]) * 0.2 +
            metrics["actionability"] * 0.3
        )

        suggestions = []
        if metrics["noise_ratio"] > 0.5:
            suggestions.append("噪音比例过高，建议启用更严格的收集策略")
        if metrics["information_density"] < 0.3:
            suggestions.append("信息密度低，建议过滤无关对话")
        if metrics["actionability"] < 0.2:
            suggestions.append("可操作信息少，建议关注包含决策和任务的对话")

        return {
            "score": round(score, 2),
            "metrics": metrics,
            "suggestions": suggestions,
        }

    def _calc_information_density(self, text: str) -> float:
        """计算信息密度"""
        lines = text.strip().split("\n")
        non_empty = [l for l in lines if l.strip() and not l.startswith("---")]
        if not lines:
            return 0.0
        return len(non_empty) / len(lines)

    def _calc_completeness(self, text: str) -> float:
        """计算对话完整性"""
        has_user = "用户" in text or "**user**" in text.lower()
        has_assistant = "助手" in text or "**assistant**" in text.lower()
        if has_user and has_assistant:
            return 1.0
        elif has_user or has_assistant:
            return 0.5
        return 0.0

    def _calc_noise_ratio(self, text: str) -> float:
        """计算噪音比例"""
        noise_patterns = ["哈哈", "666", "👍", "收到", "好的", "OK", "😄"]
        lines = text.strip().split("\n")
        noise_count = sum(
            1 for line in lines
            if any(p in line for p in noise_patterns)
        )
        return noise_count / max(len(lines), 1)

    def _calc_actionability(self, text: str) -> float:
        """计算可操作性"""
        action_keywords = [
            "TODO", "待办", "任务", "决定", "确认", "部署",
            "ACTION", "下一步", "需要", "应该",
        ]
        count = sum(1 for kw in action_keywords if kw in text)
        return min(count / 5, 1.0)
```

---

## 三、长期记忆蒸馏

### 3.1 蒸馏调度器

蒸馏不是实时进行的，而是由调度器根据条件触发：

```python
# distillation_scheduler.py
from datetime import datetime, timedelta
from typing import Callable, Optional
import logging

logger = logging.getLogger(__name__)

class DistillationScheduler:
    """蒸馏调度器"""

    def __init__(self, config: dict):
        self.config = config

        # 调度策略
        self.strategies = {
            "time_based": TimeBasedStrategy(config.get("time_based", {})),
            "threshold_based": ThresholdBasedStrategy(config.get("threshold_based", {})),
            "manual": ManualStrategy(),
        }

        # 默认策略
        self.active_strategy = config.get("active_strategy", "time_based")

    def should_distill(self, state: dict) -> dict:
        """
        判断是否应该执行蒸馏

        Args:
            state: 当前系统状态（来自 heartbeat-state.json）

        Returns:
            {
                "should_distill": bool,
                "reason": str,
                "strategy": str,
                "priority": int,
            }
        """
        strategy = self.strategies.get(self.active_strategy)
        if not strategy:
            return {"should_distill": False, "reason": "未知策略"}

        return strategy.evaluate(state)

    def schedule_distillation(self, distiller, state_manager):
        """安排并执行蒸馏任务"""
        state = state_manager.get_state()
        decision = self.should_distill(state)

        if not decision["should_distill"]:
            logger.debug(f"不执行蒸馏: {decision['reason']}")
            return None

        logger.info(f"触发蒸馏: {decision['reason']} (策略: {decision['strategy']})")

        try:
            result = distiller.distill()
            logger.info(f"蒸馏完成: 新增 {result['new_memories']} 条, "
                       f"更新 {result['updated_memories']} 条")
            return result
        except Exception as e:
            logger.error(f"蒸馏失败: {e}", exc_info=True)
            return None


class TimeBasedStrategy:
    """基于时间的调度策略"""

    def __init__(self, config: dict):
        self.interval_hours = config.get("interval_hours", 6)
        self.preferred_hour = config.get("preferred_hour", 3)  # 凌晨 3 点

    def evaluate(self, state: dict) -> dict:
        distillation_state = state.get("distillation_state", {})
        last_processed = distillation_state.get("last_processed_date")

        if not last_processed:
            return {
                "should_distill": True,
                "reason": "从未执行过蒸馏",
                "strategy": "time_based",
                "priority": 10,
            }

        try:
            last_time = datetime.fromisoformat(last_processed)
        except:
            return {
                "should_distill": True,
                "reason": "上次蒸馏时间格式错误",
                "strategy": "time_based",
                "priority": 9,
            }

        elapsed = datetime.now() - last_time
        if elapsed > timedelta(hours=self.interval_hours):
            return {
                "should_distill": True,
                "reason": f"距离上次蒸馏已过 {elapsed.total_seconds()/3600:.1f} 小时",
                "strategy": "time_based",
                "priority": 5,
            }

        return {
            "should_distill": False,
            "reason": f"距下次蒸馏还需 {(timedelta(hours=self.interval_hours) - elapsed).total_seconds()/3600:.1f} 小时",
            "strategy": "time_based",
        }


class ThresholdBasedStrategy:
    """基于阈值的调度策略"""

    def __init__(self, config: dict):
        self.min_pending_notes = config.get("min_pending_notes", 3)
        self.min_pending_bytes = config.get("min_pending_bytes", 50000)

    def evaluate(self, state: dict) -> dict:
        distillation_state = state.get("distillation_state", {})
        pending = distillation_state.get("pending_notes", 0)

        if pending >= self.min_pending_notes:
            return {
                "should_distill": True,
                "reason": f"待处理笔记数 ({pending}) 达到阈值 ({self.min_pending_notes})",
                "strategy": "threshold_based",
                "priority": 8,
            }

        return {
            "should_distill": False,
            "reason": f"待处理笔记数 ({pending}) 未达到阈值 ({self.min_pending_notes})",
            "strategy": "threshold_based",
        }


class ManualStrategy:
    """手动触发策略"""

    def evaluate(self, state: dict) -> dict:
        # 手动策略总是返回 False，由外部直接调用
        return {
            "should_distill": False,
            "reason": "手动策略等待外部触发",
            "strategy": "manual",
        }
```

### 3.2 蒸馏器核心实现

```python
# memory_distiller_v2.py
from typing import List, Dict, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class MemoryDistillerV2:
    """记忆蒸馏器 V2 - 增强版"""

    def __init__(self, llm_client, memory_store, note_reader,
                 config: dict):
        self.llm = llm_client
        self.store = memory_store
        self.reader = note_reader
        self.config = config

        # 蒸馏参数
        self.batch_size = config.get("batch_size", 5)
        self.max_tokens_per_batch = config.get("max_tokens_per_batch", 8000)
        self.confidence_threshold = config.get("confidence_threshold", 0.6)

    def distill(self, date_range: tuple = None) -> Dict:
        """
        执行蒸馏

        Returns:
            {
                "processed_dates": list,
                "new_memories": int,
                "updated_memories": int,
                "contradictions": int,
                "skipped": int,
                "errors": int,
            }
        """
        stats = {
            "processed_dates": [],
            "new_memories": 0,
            "updated_memories": 0,
            "contradictions": 0,
            "skipped": 0,
            "errors": 0,
        }

        # 获取待处理的笔记
        notes = self.reader.get_unprocessed_notes(date_range)
        logger.info(f"获取到 {len(notes)} 条待处理笔记")

        # 分批处理
        for batch_start in range(0, len(notes), self.batch_size):
            batch = notes[batch_start:batch_start + self.batch_size]

            for note in batch:
                try:
                    result = self._process_note(note)
                    stats["new_memories"] += result["new"]
                    stats["updated_memories"] += result["updated"]
                    stats["contradictions"] += result["contradictions"]
                    stats["skipped"] += result["skipped"]
                    stats["processed_dates"].append(note["date"])
                except Exception as e:
                    logger.error(f"处理笔记 {note['date']} 失败: {e}")
                    stats["errors"] += 1

        return stats

    def _process_note(self, note: dict) -> Dict:
        """处理单条笔记"""
        content = self.reader.read_note(note["path"])

        if not content.strip():
            return {"new": 0, "updated": 0, "contradictions": 0, "skipped": 0}

        # Step 1: 使用 LLM 提取记忆候选
        candidates = self._extract_candidates(content)

        # Step 2: 对每个候选拟合到已有记忆
        result = {"new": 0, "updated": 0, "contradictions": 0, "skipped": 0}

        for candidate in candidates:
            outcome = self._integrate_candidate(candidate)
            result[outcome] += 1

        return result

    def _extract_candidates(self, content: str) -> List[Dict]:
        """使用 LLM 从笔记内容中提取记忆候选"""
        existing_summary = self._get_existing_summary()

        prompt = f"""请从以下对话日志中提取值得长期记忆的信息。

## 提取规则
1. 只提取有长期价值的信息，忽略临时性内容
2. 每条记忆必须包含：
   - content: 记忆内容（简洁明确）
   - category: 分类（用户画像/项目/技术知识/关系/决策）
   - confidence: 置信度（高/中/低）
   - importance: 重要性（1-5）
3. 如果发现与已有记忆矛盾的信息，标记 contradiction=true
4. 输出 JSON 数组格式

## 已有记忆摘要
{existing_summary}

## 对话日志
{content}

## 输出格式
```json
[
  {{
    "content": "...",
    "category": "...",
    "confidence": "高/中/低",
    "importance": 3,
    "contradiction": false,
    "contradicts_id": null
  }}
]
```"""

        try:
            response = self.llm.generate(prompt)
            return self._parse_candidates(response)
        except Exception as e:
            logger.error(f"LLM 提取失败: {e}")
            return []

    def _integrate_candidate(self, candidate: Dict) -> str:
        """
        将候选记忆集成到存储

        Returns:
            "new" / "updated" / "contradictions" / "skipped"
        """
        content = candidate.get("content", "")
        confidence = candidate.get("confidence", "中")
        importance = candidate.get("importance", 3)

        # 置信度过滤
        confidence_score = {"高": 0.9, "中": 0.7, "低": 0.5}.get(confidence, 0.5)
        if confidence_score < self.confidence_threshold:
            return "skipped"

        # 矛盾检查
        if candidate.get("contradiction"):
            return self._handle_contradiction(candidate)

        # 查找相似记忆
        similar = self._find_similar(content)

        if not similar:
            # 新增记忆
            entry = MemoryEntry(
                id=self._generate_id(),
                content=content,
                category=candidate.get("category", "未分类"),
                confidence=self._map_confidence(confidence),
                priority=self._map_priority(importance),
                created_at=datetime.now(),
            )
            self.store.add(entry)
            return "new"

        # 更新已有记忆
        best_match = similar[0]
        self._update_existing(best_match, candidate)
        return "updated"

    def _handle_contradiction(self, candidate: Dict) -> str:
        """处理矛盾记忆"""
        contradicts_id = candidate.get("contradicts_id")

        if contradicts_id:
            existing = self.store.get_by_id(contradicts_id)
            if existing:
                # 标记已有记忆为"已否定"
                existing.confidence = Confidence.CONTRADICTED
                existing.tags.append(f"矛盾来源: {candidate.get('content', '')[:30]}")

        # 添加新的候选（标记为待验证）
        entry = MemoryEntry(
            id=self._generate_id(),
            content=candidate.get("content", ""),
            category=candidate.get("category", "未分类"),
            confidence=Confidence.LOW,
            priority=Priority.MEDIUM,
            tags=["矛盾候选", "待人工确认"],
        )
        self.store.add(entry)

        return "contradictions"

    def _find_similar(self, content: str) -> List:
        """查找相似记忆"""
        all_memories = self.store.get_all()
        similar = []
        for mem in all_memories:
            sim = self._calculate_similarity(content, mem.content)
            if sim > self.config.get("similarity_threshold", 0.6):
                similar.append((mem, sim))
        similar.sort(key=lambda x: x[1], reverse=True)
        return [m for m, s in similar]

    def _update_existing(self, existing: MemoryEntry, candidate: Dict):
        """更新已有记忆"""
        new_content = candidate.get("content", "")

        # 如果新信息更详细，更新内容
        if len(new_content) > len(existing.content) * 1.2:
            existing.content = new_content

        # 提升置信度
        if existing.confidence == Confidence.MEDIUM:
            existing.confidence = Confidence.HIGH
        elif existing.confidence == Confidence.HIGH:
            existing.confidence = Confidence.CONFIRMED

        existing.last_accessed = datetime.now()
        existing.access_count += 1

    def _get_existing_summary(self) -> str:
        """获取已有记忆摘要"""
        memories = self.store.get_all()
        if not memories:
            return "（暂无已有记忆）"

        lines = []
        for m in memories[:30]:  # 限制数量
            lines.append(f"- [{m.category}] {m.content}")
        return "\n".join(lines)

    def _calculate_similarity(self, text_a: str, text_b: str) -> float:
        """计算相似度"""
        def ngrams(text, n=2):
            return set(text[i:i+n] for i in range(len(text) - n + 1))
        a, b = ngrams(text_a), ngrams(text_b)
        if not a or not b:
            return 0.0
        return len(a & b) / min(len(a), len(b))

    def _generate_id(self) -> str:
        import hashlib
        return "M" + hashlib.md5(
            str(datetime.now().timestamp()).encode()
        ).hexdigest()[:6].upper()

    def _map_confidence(self, c: str) -> Confidence:
        return {"高": Confidence.HIGH, "中": Confidence.MEDIUM,
                "低": Confidence.LOW}.get(c, Confidence.MEDIUM)

    def _map_priority(self, i: int) -> Priority:
        return {5: Priority.CRITICAL, 4: Priority.HIGH, 3: Priority.MEDIUM,
                2: Priority.LOW, 1: Priority.ARCHIVED}.get(i, Priority.MEDIUM)

    def _parse_candidates(self, response: str) -> List[Dict]:
        """解析 LLM 输出"""
        import json
        import re
        # 提取 JSON 部分
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        return []
```

---

## 四、过时信息修剪

### 4.1 修剪策略引擎

```python
# pruning_strategy_engine.py
from datetime import datetime, timedelta
from typing import List, Dict
import logging

logger = logging.getLogger(__name__)

class PruningStrategyEngine:
    """修剪策略引擎"""

    def __init__(self, memory_store, config: dict):
        self.store = memory_store
        self.config = config

        # 修剪策略列表
        self.strategies = [
            ContradictedMemoryPrune(config.get("contradicted", {})),
            StaleMemoryPrune(config.get("stale", {})),
            LowValueMemoryPrune(config.get("low_value", {})),
            DuplicateMemoryPrune(config.get("duplicate", {})),
            OversizedMemoryPrune(config.get("oversized", {})),
        ]

    def execute(self) -> Dict:
        """执行所有修剪策略"""
        stats = {
            "removed": 0,
            "archived": 0,
            "compressed": 0,
            "merged": 0,
            "total_before": len(self.store.get_all()),
        }

        for strategy in self.strategies:
            try:
                result = strategy.execute(self.store)
                for key, value in result.items():
                    stats[key] = stats.get(key, 0) + value
                logger.info(f"策略 {strategy.name} 执行完成: {result}")
            except Exception as e:
                logger.error(f"策略 {strategy.name} 执行失败: {e}")

        stats["total_after"] = len(self.store.get_all())
        return stats


class PruningStrategy:
    """修剪策略基类"""

    def __init__(self, config: dict):
        self.config = config
        self.name = self.__class__.__name__

    def execute(self, store) -> Dict:
        raise NotImplementedError


class ContradictedMemoryPrune(PruningStrategy):
    """移除已否定的记忆"""

    def __init__(self, config: dict):
        super().__init__(config)
        self.retention_days = config.get("retention_days", 7)

    def execute(self, store) -> Dict:
        removed = 0
        memories = store.get_by_confidence(Confidence.CONTRADICTED)

        for mem in memories:
            age = datetime.now() - mem.created_at
            if age > timedelta(days=self.retention_days):
                store.remove(mem)
                removed += 1

        return {"removed": removed}


class StaleMemoryPrune(PruningStrategy):
    """归档长期未访问的记忆"""

    def __init__(self, config: dict):
        super().__init__(config)
        self.archive_after_days = config.get("archive_after_days", 30)
        self.min_priority = config.get("min_priority", 3)

    def execute(self, store) -> Dict:
        archived = 0
        memories = store.get_all()

        for mem in memories:
            # 高优先记忆不归档
            if mem.priority.value >= self.min_priority:
                continue

            last_access = datetime.now() - mem.last_accessed
            if last_access > timedelta(days=self.archive_after_days):
                mem.priority = Priority.ARCHIVED
                archived += 1

        return {"archived": archived}


class LowValueMemoryPrune(PruningStrategy):
    """移除低价值记忆"""

    LOW_VALUE_PATTERNS = [
        "哈哈", "666", "👍", "收到", "好的", "OK",
        "😄", "🎉", "lol", "haha", "嗯", "哦",
    ]

    def __init__(self, config: dict):
        super().__init__(config)
        self.min_length = config.get("min_length", 10)

    def execute(self, store) -> Dict:
        removed = 0
        memories = store.get_all()

        for mem in memories:
            # 短且低价值的内容
            if len(mem.content) < self.min_length:
                if any(p in mem.content for p in self.LOW_VALUE_PATTERNS):
                    store.remove(mem)
                    removed += 1

        return {"removed": removed}


class DuplicateMemoryPrune(PruningStrategy):
    """合并重复记忆"""

    def __init__(self, config: dict):
        super().__init__(config)
        self.similarity_threshold = config.get("similarity_threshold", 0.85)

    def execute(self, store) -> Dict:
        merged = 0
        memories = store.get_all()
        processed = set()

        for i, mem_a in enumerate(memories):
            if mem_a.id in processed:
                continue

            for mem_b in memories[i+1:]:
                if mem_b.id in processed:
                    continue

                similarity = self._similarity(mem_a.content, mem_b.content)
                if similarity > self.similarity_threshold:
                    # 保留置信度更高的
                    if mem_a.confidence.value >= mem_b.confidence.value:
                        store.remove(mem_b)
                        processed.add(mem_b.id)
                    else:
                        store.remove(mem_a)
                        processed.add(mem_a.id)
                        break
                    merged += 1

        return {"merged": merged}

    def _similarity(self, a: str, b: str) -> float:
        def ngrams(text, n=2):
            return set(text[i:i+n] for i in range(len(text) - n + 1))
        na, nb = ngrams(a), ngrams(b)
        if not na or not nb:
            return 0.0
        return len(na & nb) / min(len(na), len(nb))


class OversizedMemoryPrune(PruningStrategy):
    """压缩过长的记忆"""

    def __init__(self, config: dict):
        super().__init__(config)
        self.max_length = config.get("max_length", 500)

    def execute(self, store) -> Dict:
        compressed = 0
        memories = store.get_all()

        for mem in memories:
            if len(mem.content) > self.max_length:
                # 保留开头和结尾，中间用省略号
                half = self.max_length // 2 - 5
                mem.content = mem.content[:half] + " ... " + mem.content[-half:]
                compressed += 1

        return {"compressed": compressed}
```

---

## 五、完整性验证

### 5.1 记忆一致性检查

```python
# memory_validator.py
class MemoryValidator:
    """记忆一致性验证器"""

    def __init__(self, memory_store):
        self.store = memory_store

    def validate(self) -> Dict:
        """
        执行全面的一致性检查

        Returns:
            {
                "valid": bool,
                "issues": list,
                "warnings": list,
                "stats": dict,
            }
        """
        issues = []
        warnings = []

        memories = self.store.get_all()

        # 检查 1：ID 唯一性
        id_issues = self._check_id_uniqueness(memories)
        issues.extend(id_issues)

        # 检查 2：内容有效性
        content_issues = self._check_content_validity(memories)
        issues.extend(content_issues)

        # 检查 3：引用完整性
        ref_issues = self._check_reference_integrity(memories)
        issues.extend(ref_issues)

        # 检查 4：分类一致性
        cat_warnings = self._check_category_consistency(memories)
        warnings.extend(cat_warnings)

        # 检查 5：时间合理性
        time_warnings = self._check_temporal_consistency(memories)
        warnings.extend(time_warnings)

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
            "stats": {
                "total_memories": len(memories),
                "issue_count": len(issues),
                "warning_count": len(warnings),
            },
        }

    def _check_id_uniqueness(self, memories: list) -> list:
        """检查 ID 唯一性"""
        issues = []
        seen_ids = {}
        for mem in memories:
            if mem.id in seen_ids:
                issues.append({
                    "type": "duplicate_id",
                    "id": mem.id,
                    "message": f"ID {mem.id} 重复",
                })
            seen_ids[mem.id] = mem
        return issues

    def _check_content_validity(self, memories: list) -> list:
        """检查内容有效性"""
        issues = []
        for mem in memories:
            if not mem.content or not mem.content.strip():
                issues.append({
                    "type": "empty_content",
                    "id": mem.id,
                    "message": f"记忆 {mem.id} 内容为空",
                })
            if len(mem.content) > 10000:
                issues.append({
                    "type": "oversized_content",
                    "id": mem.id,
                    "message": f"记忆 {mem.id} 内容过长 ({len(mem.content)} 字符)",
                })
        return issues

    def _check_reference_integrity(self, memories: list) -> list:
        """检查引用完整性"""
        issues = []
        all_ids = {m.id for m in memories}

        for mem in memories:
            for ref_id in mem.related_entries:
                if ref_id not in all_ids:
                    issues.append({
                        "type": "broken_reference",
                        "id": mem.id,
                        "message": f"记忆 {mem.id} 引用了不存在的记忆 {ref_id}",
                    })
        return issues

    def _check_category_consistency(self, memories: list) -> list:
        """检查分类一致性"""
        warnings = []
        valid_categories = {"用户画像", "项目", "技术知识", "关系", "决策", "未分类"}

        for mem in memories:
            if mem.category not in valid_categories:
                warnings.append({
                    "type": "invalid_category",
                    "id": mem.id,
                    "message": f"记忆 {mem.id} 使用了非标准分类: {mem.category}",
                })
        return warnings

    def _check_temporal_consistency(self, memories: list) -> list:
        """检查时间合理性"""
        warnings = []
        now = datetime.now()

        for mem in memories:
            if mem.created_at > now:
                warnings.append({
                    "type": "future_timestamp",
                    "id": mem.id,
                    "message": f"记忆 {mem.id} 的创建时间在未来",
                })
            if mem.last_accessed < mem.created_at:
                warnings.append({
                    "type": "inconsistent_timestamp",
                    "id": mem.id,
                    "message": f"记忆 {mem.id} 的最后访问时间早于创建时间",
                })
        return warnings
```

---

## 六、完整工作流编排

### 6.1 记忆维护编排器

```python
# memory_maintenance_orchestrator.py
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class MemoryMaintenanceOrchestrator:
    """记忆维护编排器 - 协调整个维护循环"""

    def __init__(self, config: dict, components: dict):
        """
        Args:
            config: 配置
            components: {
                "writer": DailyLogWriter,
                "reader": DailyNotesReader,
                "distiller": MemoryDistillerV2,
                "pruner": PruningStrategyEngine,
                "validator": MemoryValidator,
                "state_manager": HeartbeatStateManager,
                "scheduler": DistillationScheduler,
                "notifier": NotificationSender,
            }
        """
        self.config = config
        self.c = components

    def run_full_cycle(self) -> Dict:
        """
        执行完整的记忆维护循环

        Returns:
            {
                "distillation": dict,
                "pruning": dict,
                "validation": dict,
                "duration_seconds": float,
            }
        """
        start_time = datetime.now()
        results = {}

        # Phase 1: 检查是否需要蒸馏
        logger.info("=== Phase 1: 蒸馏检查 ===")
        distillation_decision = self.c["scheduler"].should_distill(
            self.c["state_manager"].get_state()
        )

        if distillation_decision["should_distill"]:
            logger.info(f"触发蒸馏: {distillation_decision['reason']}")
            results["distillation"] = self.c["distiller"].distill()
            logger.info(f"蒸馏完成: {results['distillation']}")
        else:
            logger.info(f"跳过蒸馏: {distillation_decision['reason']}")
            results["distillation"] = {"skipped": True}

        # Phase 2: 修剪
        logger.info("=== Phase 2: 修剪 ===")
        results["pruning"] = self.c["pruner"].execute()
        logger.info(f"修剪完成: {results['pruning']}")

        # Phase 3: 验证
        logger.info("=== Phase 3: 验证 ===")
        results["validation"] = self.c["validator"].validate()
        logger.info(f"验证完成: 有效={results['validation']['valid']}, "
                    f"问题={len(results['validation']['issues'])}")

        # Phase 4: 更新状态
        self._update_state(results)

        # Phase 5: 发送通知（如有问题）
        if results["validation"]["issues"]:
            self._notify_issues(results["validation"]["issues"])

        duration = (datetime.now() - start_time).total_seconds()
        results["duration_seconds"] = duration

        logger.info(f"维护循环完成，耗时 {duration:.1f} 秒")
        return results

    def _update_state(self, results: dict):
        """更新心跳状态"""
        with self.c["state_manager"]._lock:
            state = self.c["state_manager"]._state

            # 更新蒸馏状态
            if not results["distillation"].get("skipped"):
                state["distillation_state"]["last_processed_date"] = (
                    datetime.now().strftime("%Y-%m-%d")
                )

            # 更新修剪状态
            state["distillation_state"]["last_prune_date"] = (
                datetime.now().strftime("%Y-%m-%d")
            )

            # 更新记忆总数
            total = results["validation"]["stats"]["total_memories"]
            state["distillation_state"]["total_memories"] = total

            self.c["state_manager"]._save()

    def _notify_issues(self, issues: list):
        """通知发现的问题"""
        if not self.c.get("notifier"):
            return

        summary = f"记忆验证发现 {len(issues)} 个问题:\n"
        for issue in issues[:5]:  # 最多通知 5 个
            summary += f"- [{issue['type']}] {issue['message']}\n"

        if len(issues) > 5:
            summary += f"... 还有 {len(issues) - 5} 个问题"

        self.c["notifier"].send(
            channel="private",
            type="memory_validation",
            content=summary,
        )
```

### 6.2 定时任务配置

```yaml
# config/maintenance.yaml
memory_maintenance:
  # 完整维护循环
  full_cycle:
    schedule: "0 3 * * *"  # 每天凌晨 3 点
    enabled: true

  # 蒸馏调度
  distillation:
    active_strategy: "time_based"
    time_based:
      interval_hours: 6
      preferred_hour: 3
    threshold_based:
      min_pending_notes: 5

  # 修剪配置
  pruning:
    contradicted:
      retention_days: 7
    stale:
      archive_after_days: 30
      min_priority: 3
    low_value:
      min_length: 10
    duplicate:
      similarity_threshold: 0.85
    oversized:
      max_length: 500

  # 验证配置
  validation:
    run_after_distillation: true
    run_after_pruning: true
    notify_on_issues: true
```

---

## 七、监控与可观测性

### 7.1 维护指标收集

```python
# maintenance_metrics.py
class MaintenanceMetrics:
    """维护指标收集器"""

    def __init__(self):
        self.metrics = {
            "distillation_runs": 0,
            "pruning_runs": 0,
            "validation_runs": 0,
            "total_memories_processed": 0,
            "total_memories_pruned": 0,
            "total_contradictions_found": 0,
            "avg_cycle_duration_seconds": 0,
            "last_cycle_timestamp": None,
        }

    def record_cycle(self, results: dict):
        """记录一次维护循环的结果"""
        if "distillation" in results and not results["distillation"].get("skipped"):
            self.metrics["distillation_runs"] += 1
            d = results["distillation"]
            self.metrics["total_memories_processed"] += (
                d.get("new_memories", 0) + d.get("updated_memories", 0)
            )
            self.metrics["total_contradictions_found"] += d.get("contradictions", 0)

        if "pruning" in results:
            self.metrics["pruning_runs"] += 1
            self.metrics["total_memories_pruned"] += results["pruning"].get("removed", 0)

        if "validation" in results:
            self.metrics["validation_runs"] += 1

        duration = results.get("duration_seconds", 0)
        n = self.metrics["distillation_runs"] + self.metrics["pruning_runs"]
        if n > 0:
            self.metrics["avg_cycle_duration_seconds"] = (
                (self.metrics["avg_cycle_duration_seconds"] * (n - 1) + duration) / n
            )

        self.metrics["last_cycle_timestamp"] = datetime.now().isoformat()

    def get_report(self) -> dict:
        """生成指标报告"""
        return self.metrics.copy()
```

---

## 总结

OpenClaw 的记忆维护循环——从日常日志收集，到长期记忆蒸馏，再到过时信息修剪——构成了一个完整的"记忆新陈代谢"系统。

核心设计理念：

1. **分层收集**：根据对话类型和内容重要性选择性记录，避免噪音
2. **智能蒸馏**：利用 LLM 从原始日志中提取关键信息，处理矛盾和重复
3. **主动修剪**：定期清理过时、低价值、重复的记忆，保持记忆质量
4. **闭环验证**：每次维护后进行一致性检查，确保记忆系统健康

这个循环不是一次性的批处理，而是一个持续运行的自我进化机制。通过合理的调度策略（时间触发 + 阈值触发），它可以在不影响用户交互的前提下，默默地维护着 Agent 的"大脑"。

记住：一个没有维护的记忆系统，终将被噪音和过时信息淹没。而一个良好维护的记忆系统，会让 Agent 越用越聪明，越用越懂你。

---

*本文是 OpenClaw 深度剖析系列的一部分。下一篇将探讨 OpenClaw 的文档漂移问题剖析：IDENTITY.md/MEMORY.md/MODEL_STRATEGY.md 不一致的根因与治理。*

---

## 相关阅读

- [OpenClaw 分层记忆架构：daily notes vs MEMORY.md vs heartbeat-state.json](/categories/架构/OpenClaw-分层记忆架构-daily-notes-vs-MEMORY-md-vs-heartbeat-state-json/)
- [OpenClaw 记忆系统实战：MEMORY.md 长期记忆与日常记忆管理](/categories/架构/OpenClaw-记忆系统实战-MEMORY-md-长期记忆与日常记忆管理/)
- [OpenClaw 隐私感知记忆分区：主会话隔离 vs 群聊上下文的安全边界](/categories/架构/OpenClaw-隐私感知记忆分区-MEMORY-md-主会话隔离-vs-群聊上下文的安全边界/)
- [OpenClaw 文档漂移问题剖析：IDENTITY.md/MEMORY.md/MODEL_STRATEGY.md 不一致的根因与治理](/categories/架构/OpenClaw-文档漂移问题剖析-IDENTITY-MEMORY-MODEL-STRATEGY-不一致的根因与治理/)
