---
title: OpenClaw 隐私感知记忆分区：MEMORY.md 主会话隔离 vs 群聊上下文的安全边界
date: 2026-06-02 09:00:00
tags: [OpenClaw, AI Agent, 隐私安全, 记忆系统, 群聊安全]
keywords: [OpenClaw, MEMORY.md, 隐私感知记忆分区, 主会话隔离, 群聊上下文的安全边界, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "深入解析 OpenClaw 隐私感知记忆分区机制，涵盖 MEMORY.md 主会话隔离、群聊上下文三层安全边界、多维度敏感度分类器与信息流控制矩阵。文章提供完整的 Python 可运行代码示例、YAML 配置模板、pytest 安全测试套件及架构图，帮助 AI Agent 开发者在多群组部署场景中实现私聊与群聊的记忆隔离、跨群信息防泄漏、PII 自动脱敏，构建符合隐私安全要求的 Agent 记忆管理体系。"
---


# OpenClaw 隐私感知记忆分区：MEMORY.md 主会话隔离 vs 群聊上下文的安全边界

## 前言

在 AI Agent 从个人助手走向多场景部署的过程中，记忆系统不再只是"记住用户说了什么"那么简单。当一个 OpenClaw 实例同时服务于个人私聊、团队群聊、甚至多个社区频道时，记忆的隔离与隐私保护就成为了架构设计的核心命题。

你不会希望 Agent 在群聊中脱口而出你昨晚告诉它的私人烦恼，也不会希望它把 A 群的讨论内容泄露到 B 群。这种"记忆泄漏"一旦发生，轻则尴尬，重则引发隐私合规问题。

本文将深入剖析 OpenClaw 的隐私感知记忆分区机制，从 MEMORY.md 的主会话隔离设计，到群聊上下文的安全边界划定，再到实际的权限分级策略与配置实践，为你构建一套安全可靠的记忆管理体系。

---

## 一、问题定义：为什么需要记忆分区

### 1.1 记忆系统的本质

OpenClaw 的记忆系统由多个层次组成：

```
┌─────────────────────────────────────┐
│           MEMORY.md                  │  ← 策展后的长期记忆（持久化）
│  用户偏好、重要事实、长期关系         │
├─────────────────────────────────────┤
│         daily-notes/                 │  ← 原始对话日志（临时）
│  每日对话的原始记录                   │
├─────────────────────────────────────┤
│      heartbeat-state.json            │  ← 运行时状态（临时）
│  系统状态、最后心跳、健康指标         │
├─────────────────────────────────────┤
│       上下文窗口                      │  ← 当前会话上下文（内存）
│  本次对话的 token 窗口               │
└─────────────────────────────────────┘
```

在单用户场景下，所有记忆都属于同一个人，不存在隔离需求。但当 OpenClaw 接入群聊——无论是微信群、Discord 频道还是飞书群——记忆的归属就变得复杂了。

### 1.2 记忆泄漏的典型场景

**场景一：私人信息群聊泄露**

用户在私聊中告诉 Agent："我最近在考虑换工作，但还没告诉团队。"如果 Agent 在团队群聊中说"你最近的求职进展如何？"，后果不堪设想。

**场景二：跨群信息串联**

Agent 同时服务 A 项目群和 B 项目群。A 群讨论了一个未公开的技术方案，如果 Agent 在 B 群中无意提及，就违反了信息隔离要求。

**场景三：上下文污染**

群聊中的噪音信息（闲聊、表情包、无关讨论）被写入记忆，稀释了有价值的信息，导致 Agent 的记忆质量下降。

### 1.3 安全边界的核心诉求

基于以上场景，我们可以提炼出记忆分区的核心诉求：

| 诉求 | 描述 | 优先级 |
|------|------|--------|
| 会话隔离 | 私聊记忆不出现在群聊上下文中 | P0 |
| 群间隔离 | 不同群聊的记忆互不可见 | P0 |
| 权限分级 | 不同场景有不同的记忆读写权限 | P1 |
| 噪音过滤 | 群聊中的低质量信息不污染长期记忆 | P1 |
| 审计追踪 | 记忆的来源和流向可追溯 | P2 |

---

## 二、MEMORY.md 主会话隔离机制

### 2.1 MEMORY.md 的结构设计

MEMORY.md 是 OpenClaw 的核心记忆文件，存储经过策展的长期记忆。在隐私感知的设计中，MEMORY.md 不再是一个扁平的文本文件，而是采用了分区结构：

```markdown
# MEMORY.md

## [global]
- 用户的名字是 Michael
- 用户偏好中文交流
- 用户的技术栈：PHP/Laravel, MySQL, Redis, Docker, K8s

## [session:private]
- 用户最近在考虑职业变动
- 用户的家庭情况：有两个孩子
- 用户的健康状况：最近在健身

## [group:project-alpha]
- 项目 Alpha 使用 Laravel 11 + PostgreSQL
- 当前迭代目标：完成支付模块重构
- 关键决策：采用 Event Sourcing 模式

## [group:tech-community]
- 社区最近在讨论 RAG vs Fine-tuning 的选型
- 用户在社区中的角色：技术布道者
```

### 2.2 分区标签系统

每个记忆条目都通过标签（tag）关联到特定的上下文域：

```python
# memory_partition.py - 记忆分区核心逻辑
import re
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

class MemoryScope(Enum):
    GLOBAL = "global"          # 全局可见
    PRIVATE = "session:private"  # 仅私聊可见
    GROUP = "group"            # 群聊可见（需指定群ID）
    EPHEMERAL = "ephemeral"    # 仅当前会话可见，不持久化

@dataclass
class MemoryEntry:
    content: str
    scope: MemoryScope
    group_id: Optional[str] = None
    source_session: str = ""
    created_at: str = ""
    sensitivity: int = 0  # 0=公开, 1=内部, 2=敏感, 3=高度敏感

    def is_accessible_from(self, current_scope: MemoryScope,
                           current_group_id: Optional[str] = None) -> bool:
        """判断该记忆条目是否可从当前上下文访问"""
        # 全局记忆对所有上下文可见
        if self.scope == MemoryScope.GLOBAL:
            return True

        # 私聊记忆只在私聊上下文中可见
        if self.scope == MemoryScope.PRIVATE:
            return current_scope == MemoryScope.PRIVATE

        # 群聊记忆只在同一群聊上下文中可见
        if self.scope == MemoryScope.GROUP:
            return (current_scope == MemoryScope.GROUP
                    and self.group_id == current_group_id)

        # 临时记忆只在当前会话中可见
        if self.scope == MemoryScope.EPHEMERAL:
            return False  # 不持久化

        return False
```

### 2.3 记忆写入时的自动分区

当 Agent 在对话中产生新的记忆时，系统会根据当前会话上下文自动分配合适的分区：

```python
# auto_partition.py - 自动分区策略
class MemoryAutoPartitioner:
    """根据会话上下文自动为新记忆分配分区"""

    def __init__(self, sensitivity_classifier):
        self.classifier = sensitivity_classifier

    def partition(self, raw_memory: str, session_context: dict) -> MemoryEntry:
        """
        根据会话上下文和内容敏感度，自动分区

        Args:
            raw_memory: 原始记忆内容
            session_context: 包含 session_type, group_id 等信息

        Returns:
            带有正确分区标签的 MemoryEntry
        """
        # 第一步：判断敏感度
        sensitivity = self.classifier.classify(raw_memory)

        # 第二步：根据会话类型确定基础 scope
        session_type = session_context.get("session_type", "private")

        if session_type == "private":
            base_scope = MemoryScope.PRIVATE
        elif session_type == "group":
            base_scope = MemoryScope.GROUP
        else:
            base_scope = MemoryScope.EPHEMERAL

        # 第三步：高敏感内容强制升级为私有
        if sensitivity >= 2 and base_scope != MemoryScope.PRIVATE:
            # 高敏感内容即使在群聊中产生，也归入私有分区
            # 但记录来源群组以供审计
            base_scope = MemoryScope.PRIVATE

        # 第四步：提取通用知识归入全局
        if self._is_general_knowledge(raw_memory):
            base_scope = MemoryScope.GLOBAL

        return MemoryEntry(
            content=raw_memory,
            scope=base_scope,
            group_id=session_context.get("group_id"),
            source_session=session_context.get("session_id", ""),
            sensitivity=sensitivity,
        )

    def _is_general_knowledge(self, text: str) -> bool:
        """判断是否为通用知识（如用户姓名、技术偏好等）"""
        general_patterns = [
            r"用户.*名字",
            r"偏好.*语言",
            r"技术栈",
            r"常用.*工具",
        ]
        return any(re.search(p, text) for p in general_patterns)
```

### 2.4 记忆读取时的过滤机制

在生成回复之前，系统必须过滤当前上下文不可见的记忆：

```python
# memory_filter.py - 记忆读取过滤
class MemoryFilter:
    """根据当前会话上下文过滤可访问的记忆"""

    def __init__(self, memory_store):
        self.store = memory_store

    def get_accessible_memories(self, session_context: dict) -> list:
        """
        获取当前会话上下文可访问的所有记忆

        Args:
            session_context: {
                "session_type": "private" | "group",
                "group_id": "group-xxx" | None,
                "session_id": "session-xxx"
            }

        Returns:
            过滤后的记忆列表
        """
        current_scope = MemoryScope.PRIVATE
        current_group_id = None

        if session_context.get("session_type") == "group":
            current_scope = MemoryScope.GROUP
            current_group_id = session_context.get("group_id")

        all_memories = self.store.get_all()
        accessible = []

        for memory in all_memories:
            if memory.is_accessible_from(current_scope, current_group_id):
                accessible.append(memory)

        return accessible

    def build_context_prompt(self, session_context: dict) -> str:
        """
        构建包含可访问记忆的上下文提示

        这是 Agent 回复时实际使用的记忆注入点
        """
        memories = self.get_accessible_memories(session_context)

        if not memories:
            return "（无可用记忆）"

        # 按敏感度排序，低敏感度优先（减少泄漏风险）
        memories.sort(key=lambda m: m.sensitivity)

        context_parts = ["## 可用记忆\n"]
        for mem in memories:
            sensitivity_label = ["[公开]", "[内部]", "[敏感]", "[高度敏感]"][mem.sensitivity]
            context_parts.append(f"- {sensitivity_label} {mem.content}")

        return "\n".join(context_parts)
```

---

## 三、群聊上下文的安全边界

### 3.1 群聊上下文的三层边界

群聊场景比私聊复杂得多。OpenClaw 为群聊定义了三层安全边界：

```
┌─────────────────────────────────────────────┐
│            第一层：会话边界                    │
│  当前群聊的消息只在当前群聊的上下文中可见       │
│  ┌─────────────────────────────────────────┐ │
│  │        第二层：记忆边界                    │ │
│  │  群聊产生的记忆默认不写入长期记忆           │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │      第三层：输出边界                  │ │ │
│  │  │  Agent 回复前检查是否包含跨域信息      │ │ │
│  │  │  敏感内容自动脱敏或拒绝输出            │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 3.2 会话边界：上下文窗口隔离

每个群聊会话维护独立的上下文窗口，互不干扰：

```python
# session_manager.py - 会话管理器
import hashlib
from datetime import datetime
from collections import defaultdict

class SessionManager:
    """管理多个并行会话的上下文隔离"""

    def __init__(self):
        self.sessions = {}  # session_id -> SessionContext
        self.message_history = defaultdict(list)  # session_id -> messages

    def create_session(self, session_type: str, group_id: str = None,
                       user_id: str = None) -> str:
        """创建新的隔离会话"""
        session_id = self._generate_session_id(session_type, group_id, user_id)

        self.sessions[session_id] = {
            "session_id": session_id,
            "session_type": session_type,
            "group_id": group_id,
            "user_id": user_id,
            "created_at": datetime.now().isoformat(),
            "is_active": True,
            "memory_scope": self._determine_scope(session_type),
        }

        return session_id

    def add_message(self, session_id: str, role: str, content: str):
        """向指定会话添加消息（严格隔离）"""
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found")

        self.message_history[session_id].append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "session_id": session_id,
        })

    def get_context(self, session_id: str, max_tokens: int = 4000) -> list:
        """获取指定会话的上下文（只返回该会话的消息）"""
        if session_id not in self.sessions:
            return []

        messages = self.message_history.get(session_id, [])
        # 按 token 预算截断，保留最近的消息
        return self._truncate_by_tokens(messages, max_tokens)

    def _generate_session_id(self, session_type, group_id, user_id) -> str:
        raw = f"{session_type}:{group_id or ''}:{user_id or ''}:{datetime.now().date()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:12]

    def _determine_scope(self, session_type: str) -> MemoryScope:
        if session_type == "private":
            return MemoryScope.PRIVATE
        elif session_type == "group":
            return MemoryScope.GROUP
        return MemoryScope.EPHEMERAL

    def _truncate_by_tokens(self, messages, max_tokens):
        # 简化的 token 计算（实际应使用 tokenizer）
        result = []
        current_tokens = 0
        for msg in reversed(messages):
            estimated = len(msg["content"]) // 2  # 粗略估计
            if current_tokens + estimated > max_tokens:
                break
            result.insert(0, msg)
            current_tokens += estimated
        return result
```

### 3.3 记忆边界：群聊记忆的默认策略

群聊产生的信息通常比私聊噪音更大。OpenClaw 采用"默认不持久化"策略：

```python
# group_memory_policy.py - 群聊记忆策略
class GroupMemoryPolicy:
    """群聊场景的记忆写入策略"""

    # 默认策略：群聊消息不写入长期记忆
    DEFAULT_PERSIST = False

    # 例外：以下情况可以写入
    PERSIST_EXCEPTIONS = [
        "explicit_save",      # 用户明确要求保存
        "action_item",        # 包含待办事项
        "decision",           # 包含团队决策
        "knowledge_article",  # 包含技术知识点
    ]

    def should_persist(self, message: str, session_context: dict,
                       classifier) -> tuple:
        """
        判断群聊消息是否应该持久化

        Returns:
            (should_persist: bool, reason: str)
        """
        # 私聊消息默认持久化
        if session_context.get("session_type") == "private":
            return True, "private_session_default"

        # 群聊消息默认不持久化
        if session_context.get("session_type") == "group":
            # 检查是否命中例外条件
            for exception_type in self.PERSIST_EXCEPTIONS:
                if self._matches_exception(message, exception_type, classifier):
                    return True, f"exception:{exception_type}"

            return False, "group_default_no_persist"

        return False, "unknown_session_type"

    def _matches_exception(self, message: str, exception_type: str,
                           classifier) -> bool:
        """判断消息是否匹配持久化例外条件"""
        if exception_type == "explicit_save":
            save_keywords = ["记住", "保存", "记下来", "save", "remember"]
            return any(kw in message.lower() for kw in save_keywords)

        if exception_type == "action_item":
            action_keywords = ["TODO", "待办", "任务", "TODO:", "ACTION:"]
            return any(kw in message for kw in action_keywords)

        if exception_type == "decision":
            decision_keywords = ["决定", "确定", "方案是", "采用", "agreed"]
            return any(kw in message for kw in decision_keywords)

        if exception_type == "knowledge_article":
            # 使用分类器判断是否为技术知识点
            return classifier.is_knowledge_content(message)

        return False
```

### 3.4 输出边界：回复前的安全检查

Agent 在生成回复前，必须检查回复内容是否包含不应在当前上下文出现的信息：

```python
# output_guard.py - 输出安全检查
import re

class OutputGuard:
    """Agent 回复输出的安全守卫"""

    def __init__(self, memory_store):
        self.store = memory_store
        self.sensitive_patterns = [
            r"密码|password|passwd|secret",
            r"token|api[_-]?key",
            r"薪资|工资|salary",
            r"个人.*信息|身份证|手机.*号",
        ]

    def check_output(self, response: str, session_context: dict) -> dict:
        """
        检查 Agent 回复是否包含不安全内容

        Returns:
            {
                "safe": bool,
                "issues": list,
                "sanitized_response": str
            }
        """
        issues = []
        sanitized = response

        # 检查 1：是否包含敏感模式
        for pattern in self.sensitive_patterns:
            if re.search(pattern, response, re.IGNORECASE):
                issues.append({
                    "type": "sensitive_pattern",
                    "pattern": pattern,
                    "severity": "high",
                })

        # 检查 2：群聊中是否引用了私聊记忆
        if session_context.get("session_type") == "group":
            private_memories = self.store.get_by_scope(MemoryScope.PRIVATE)
            for mem in private_memories:
                if self._text_overlap(response, mem.content):
                    issues.append({
                        "type": "private_memory_leak",
                        "memory_preview": mem.content[:50],
                        "severity": "critical",
                    })

        # 检查 3：是否引用了其他群聊的记忆
        if session_context.get("session_type") == "group":
            current_group = session_context.get("group_id")
            other_group_memories = self.store.get_by_scope(
                MemoryScope.GROUP,
                exclude_group=current_group,
            )
            for mem in other_group_memories:
                if self._text_overlap(response, mem.content):
                    issues.append({
                        "type": "cross_group_leak",
                        "memory_preview": mem.content[:50],
                        "severity": "high",
                    })

        # 如果有严重问题，生成安全版本
        if any(i["severity"] in ("critical", "high") for i in issues):
            sanitized = self._sanitize(response, issues)

        return {
            "safe": len(issues) == 0,
            "issues": issues,
            "sanitized_response": sanitized,
        }

    def _text_overlap(self, text_a: str, text_b: str,
                      threshold: float = 0.3) -> bool:
        """检测两段文本的重叠程度"""
        # 使用简单的 n-gram 重叠检测
        def get_ngrams(text, n=3):
            return set(text[i:i+n] for i in range(len(text) - n + 1))

        ngrams_a = get_ngrams(text_a)
        ngrams_b = get_ngrams(text_b)

        if not ngrams_a or not ngrams_b:
            return False

        overlap = len(ngrams_a & ngrams_b)
        return overlap / min(len(ngrams_a), len(ngrams_b)) > threshold

    def _sanitize(self, response: str, issues: list) -> str:
        """生成脱敏后的安全回复"""
        for issue in issues:
            if issue["type"] == "private_memory_leak":
                return "抱歉，我无法在群聊中讨论这个话题。请私聊我。"
            if issue["type"] == "cross_group_leak":
                return "抱歉，这个话题属于另一个项目的上下文，不适合在这里讨论。"

        return response
```

---

## 四、敏感度分类器实现

### 4.1 多维度敏感度评估

敏感度分类是记忆分区的基础。OpenClaw 使用多维度评估模型：

```python
# sensitivity_classifier.py - 敏感度分类器
from dataclasses import dataclass
from typing import List
import re

@dataclass
class SensitivitySignal:
    dimension: str      # 维度名称
    score: float        # 0.0 - 1.0
    evidence: str       # 触发证据
    confidence: float   # 置信度

class SensitivityClassifier:
    """多维度敏感度分类器"""

    # 关键词库
    HIGH_SENSITIVITY_KEYWORDS = {
        "personal": ["密码", "工资", "薪资", "身份证", "银行卡", "健康", "疾病",
                     "感情", "离婚", "抑郁", "焦虑"],
        "professional": ["解雇", "裁员", "离职", "跳槽", "面试", "offer",
                        "竞业", "NDA", "保密协议"],
        "financial": ["收入", "投资", "亏损", "贷款", "信用卡", "存款"],
    }

    MEDIUM_SENSITIVITY_KEYWORDS = {
        "opinion": ["我觉得", "我认为", "个人看法", "私下说"],
        "internal": ["内部", "公司内部", "团队内部", "别对外说"],
    }

    def classify(self, text: str, context: dict = None) -> int:
        """
        评估文本的敏感度等级

        Returns:
            0: 公开 - 可在任何上下文中使用
            1: 内部 - 限于同一组织/团队
            2: 敏感 - 限于私聊或特定授权群组
            3: 高度敏感 - 仅限私聊，且不写入长期记忆
        """
        signals = self._extract_signals(text)

        if not signals:
            return 0

        # 取最高敏感度信号
        max_score = max(s.score for s in signals)

        if max_score >= 0.8:
            return 3
        elif max_score >= 0.6:
            return 2
        elif max_score >= 0.3:
            return 1
        return 0

    def _extract_signals(self, text: str) -> List[SensitivitySignal]:
        """从文本中提取敏感度信号"""
        signals = []

        # 高敏感关键词检测
        for category, keywords in self.HIGH_SENSITIVITY_KEYWORDS.items():
            for kw in keywords:
                if kw in text:
                    signals.append(SensitivitySignal(
                        dimension=category,
                        score=0.8,
                        evidence=f"包含高敏感关键词: {kw}",
                        confidence=0.9,
                    ))

        # 中敏感关键词检测
        for category, keywords in self.MEDIUM_SENSITIVITY_KEYWORDS.items():
            for kw in keywords:
                if kw in text:
                    signals.append(SensitivitySignal(
                        dimension=category,
                        score=0.5,
                        evidence=f"包含中敏感关键词: {kw}",
                        confidence=0.7,
                    ))

        # 数字模式检测（手机号、身份证等）
        phone_pattern = r'1[3-9]\d{9}'
        if re.search(phone_pattern, text):
            signals.append(SensitivitySignal(
                dimension="pii",
                score=0.9,
                evidence="包含手机号码",
                confidence=0.95,
            ))

        return signals
```

### 4.2 上下文感知的敏感度调整

同样的内容在不同上下文中可能有不同的敏感度。例如"今天下午3点开会"在工作群中是正常信息，在社交群中就可能需要脱敏：

```python
class ContextAwareClassifier(SensitivityClassifier):
    """上下文感知的敏感度分类器"""

    CONTEXT_ADJUSTMENTS = {
        "work_group": {
            "schedule": -0.3,     # 工作群中日程信息降敏
            "opinion": +0.2,      # 工作群中个人意见更敏感
        },
        "social_group": {
            "schedule": +0.2,     # 社交群中日程信息更敏感
            "opinion": -0.2,      # 社交群中意见更随意
        },
        "private": {
            # 私聊中所有信息都可接受
            "default": -0.3,
        },
    }

    def classify(self, text: str, context: dict = None) -> int:
        base_score = super().classify(text, context)

        if context:
            group_type = context.get("group_type", "default")
            adjustments = self.CONTEXT_ADJUSTMENTS.get(group_type, {})

            # 根据上下文调整敏感度
            dimension = self._identify_primary_dimension(text)
            adjustment = adjustments.get(dimension, adjustments.get("default", 0))

            adjusted_score = max(0, min(1, base_score / 3 + adjustment))
            return int(adjusted_score * 3)

        return base_score

    def _identify_primary_dimension(self, text: str) -> str:
        """识别文本的主要敏感维度"""
        # 简化实现：返回第一个匹配的维度
        for category, keywords in self.HIGH_SENSITIVITY_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                return category
        for category, keywords in self.MEDIUM_SENSITIVITY_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                return category
        return "default"
```

---

## 五、跨域信息流动控制

### 5.1 信息流矩阵

在多会话场景下，信息的流动必须遵循严格的规则：

```
信息流向        │ 私聊  │ 工作群A │ 工作群B │ 社交群 │ 全局记忆
───────────────┼───────┼────────┼────────┼───────┼─────────
私聊            │  ✅   │   ❌   │   ❌   │  ❌   │   ✅
工作群A         │  ⚠️   │   ✅   │   ❌   │  ❌   │   ⚠️
工作群B         │  ⚠️   │   ❌   │   ✅   │  ❌   │   ⚠️
社交群          │  ❌   │   ❌   │   ❌   │  ✅   │   ❌
全局记忆        │  ✅   │   ✅   │   ✅   │  ✅   │   ✅

✅ = 允许  ⚠️ = 条件允许（需过滤）  ❌ = 禁止
```

### 5.2 信息流控制器实现

```python
# information_flow_controller.py
from enum import Enum

class FlowPolicy(Enum):
    ALLOW = "allow"
    DENY = "deny"
    FILTER = "filter"  # 条件允许，需过滤

class InformationFlowController:
    """控制跨会话的信息流动"""

    # 信息流规则矩阵
    FLOW_RULES = {
        # (source_type, target_type) -> policy
        ("private", "private"): FlowPolicy.ALLOW,
        ("private", "group"): FlowPolicy.DENY,
        ("group", "private"): FlowPolicy.FILTER,  # 允许但需脱敏
        ("group", "group"): FlowPolicy.DENY,       # 跨群禁止（除非同一群）
        ("global", "private"): FlowPolicy.ALLOW,
        ("global", "group"): FlowPolicy.ALLOW,
        ("private", "global"): FlowPolicy.FILTER,  # 可写入但需脱敏
        ("group", "global"): FlowPolicy.FILTER,    # 可写入但需过滤噪音
    }

    def check_flow(self, source_session: dict, target_session: dict,
                   content: str) -> dict:
        """
        检查信息从源会话流向目标会话是否允许

        Returns:
            {
                "allowed": bool,
                "policy": FlowPolicy,
                "requires_filtering": bool,
                "reason": str
            }
        """
        source_type = source_session.get("session_type", "unknown")
        target_type = target_session.get("session_type", "unknown")

        # 同一会话内的流动总是允许
        if source_session.get("session_id") == target_session.get("session_id"):
            return {
                "allowed": True,
                "policy": FlowPolicy.ALLOW,
                "requires_filtering": False,
                "reason": "same_session",
            }

        # 同一群组内的流动允许
        if (source_type == "group" and target_type == "group"
                and source_session.get("group_id") == target_session.get("group_id")):
            return {
                "allowed": True,
                "policy": FlowPolicy.ALLOW,
                "requires_filtering": False,
                "reason": "same_group",
            }

        # 查找规则
        rule_key = (source_type, target_type)
        policy = self.FLOW_RULES.get(rule_key, FlowPolicy.DENY)

        return {
            "allowed": policy != FlowPolicy.DENY,
            "policy": policy,
            "requires_filtering": policy == FlowPolicy.FILTER,
            "reason": f"rule:{rule_key[0]}->{rule_key[1]}={policy.value}",
        }

    def apply_flow_control(self, content: str, source_session: dict,
                           target_session: dict,
                           classifier) -> str:
        """应用信息流控制，返回处理后的内容"""
        check = self.check_flow(source_session, target_session, content)

        if not check["allowed"]:
            return None  # 信息被拦截

        if check["requires_filtering"]:
            return self._filter_content(content, source_session, target_session,
                                        classifier)

        return content

    def _filter_content(self, content: str, source: dict, target: dict,
                        classifier) -> str:
        """过滤敏感内容"""
        sensitivity = classifier.classify(content, target)

        # 高敏感内容不允许跨域流动
        if sensitivity >= 2:
            return None

        # 中敏感内容脱敏后允许
        if sensitivity >= 1:
            return self._redact_sensitive_parts(content)

        return content

    def _redact_sensitive_parts(self, text: str) -> str:
        """脱敏处理"""
        import re
        # 手机号脱敏
        text = re.sub(r'1[3-9]\d{9}', '1**********', text)
        # 邮箱脱敏
        text = re.sub(r'[\w.]+@[\w.]+\.\w+', '***@***.***', text)
        return text
```

---

## 六、配置与部署实践

### 6.1 OpenClaw 记忆安全配置

在 OpenClaw 的配置文件中，可以通过以下设置启用记忆分区：

```yaml
# openclaw-config.yaml
memory:
  # 记忆存储路径
  store_path: "./memory"

  # 分区策略
  partition:
    enabled: true
    default_scope: "ephemeral"  # 默认临时，不持久化
    auto_classify: true         # 自动分类

  # 群聊记忆策略
  group_policy:
    persist_default: false      # 群聊消息默认不持久化
    persist_exceptions:
      - "explicit_save"
      - "action_item"
      - "decision"
    noise_filter: true          # 启用噪音过滤
    noise_threshold: 0.7        # 噪音阈值

  # 敏感度分类
  sensitivity:
    enabled: true
    high_sensitivity_action: "block"  # block | redact | warn
    auto_redact_pii: true             # 自动脱敏个人信息

  # 输出安全
  output_guard:
    enabled: true
    check_private_leak: true          # 检查私聊记忆泄漏
    check_cross_group_leak: true      # 检查跨群泄漏
    block_on_critical: true           # 严重问题直接阻断
```

### 6.2 多群组部署配置

```yaml
# groups-config.yaml
groups:
  - id: "project-alpha"
    name: "项目 Alpha 技术群"
    type: "work_group"
    memory_scope: "group:project-alpha"
    allow_cross_group: false
    persist_policy: "selective"
    sensitivity_adjustment:
      schedule: -0.2
      opinion: +0.2

  - id: "tech-community"
    name: "技术交流社区"
    type: "social_group"
    memory_scope: "group:tech-community"
    allow_cross_group: false
    persist_policy: "none"
    sensitivity_adjustment:
      schedule: +0.1
      opinion: -0.2

  - id: "family"
    name: "家人群"
    type: "private_group"
    memory_scope: "group:family"
    allow_cross_group: false
    persist_policy: "full"
    sensitivity_adjustment:
      schedule: -0.3
```

### 6.3 运维监控配置

```yaml
# monitoring.yaml
memory_monitoring:
  # 泄漏检测
  leak_detection:
    enabled: true
    check_interval: "5m"
    alert_channels:
      - type: "log"
        level: "warning"
      - type: "notification"
        channel: "private"

  # 记忆统计
  statistics:
    enabled: true
    metrics:
      - "memory_count_by_scope"
      - "cross_domain_attempt_count"
      - "sensitivity_distribution"
      - "noise_filter_rate"

  # 审计日志
  audit:
    enabled: true
    log_path: "./logs/memory-audit.log"
    include_blocked_flows: true
    include_filtered_content: false  # 不记录被过滤的内容（隐私）
```

---

## 七、实际场景演练

### 7.1 场景一：私聊到群聊的信息拦截

```
时间线：
1. 用户在私聊中说："我最近在准备面试，目标是字节跳动的高级工程师"
2. Agent 将此信息存入 [session:private] 分区，敏感度=3
3. 用户切换到工作群，问："我最近有什么重要的事？"
4. Agent 调用 MemoryFilter.get_accessible_memories()
5. 群聊上下文无法访问 [session:private] 分区
6. Agent 回复："在当前群聊的上下文中，我了解到您最近在推进项目 Alpha 的支付模块重构。"
```

### 7.2 场景二：跨群信息的阻断

```
时间线：
1. 项目 Alpha 群讨论了新的微服务架构方案（未公开）
2. 信息被存入 [group:project-alpha] 分区
3. 技术社区群有人问："最近有什么好的架构方案推荐？"
4. Agent 检查 [group:project-alpha] 的记忆
5. FlowController 判定 group:project-alpha -> group:tech-community = DENY
6. Agent 回复不包含 Alpha 项目的架构方案
```

### 7.3 场景三：群聊中的信息提取到全局

```
时间线：
1. 技术社区群讨论了 Laravel 12 的新特性
2. 用户说："记住，Laravel 12 的新 Event 系统很值得研究"
3. GroupMemoryPolicy 匹配 "explicit_save" 例外
4. 内容通过敏感度检查（sensitivity=0，技术知识）
5. 信息被写入 [global] 分区，所有上下文可访问
```

---

## 八、安全边界的形式化验证

### 8.1 安全属性定义

为了确保记忆分区的正确性，我们可以形式化定义安全属性：

```python
# security_properties.py
class MemorySecurityProperties:
    """记忆系统的安全属性定义"""

    @staticmethod
    def property_1_no_private_leak(memory_store, session_context):
        """
        属性 1：私聊记忆不出现在群聊上下文中

        ∀ memory ∈ store, ∀ session:
            memory.scope = PRIVATE →
            session.type = GROUP →
            memory ∉ accessible(session)
        """
        if session_context.get("session_type") != "group":
            return True  # 非群聊上下文，属性自动满足

        private_memories = memory_store.get_by_scope(MemoryScope.PRIVATE)
        accessible = memory_store.get_accessible(session_context)

        for pm in private_memories:
            if pm in accessible:
                return False  # 属性违反！

        return True

    @staticmethod
    def property_2_no_cross_group_leak(memory_store, session_context):
        """
        属性 2：群聊 A 的记忆不出现在群聊 B 的上下文中

        ∀ memory ∈ store, ∀ session:
            memory.scope = GROUP ∧ memory.group_id ≠ session.group_id →
            memory ∉ accessible(session)
        """
        if session_context.get("session_type") != "group":
            return True

        current_group = session_context.get("group_id")
        all_group_memories = memory_store.get_by_scope(MemoryScope.GROUP)
        accessible = memory_store.get_accessible(session_context)

        for gm in all_group_memories:
            if gm.group_id != current_group and gm in accessible:
                return False

        return True

    @staticmethod
    def property_3_output_safety(output_guard, response, session_context):
        """
        属性 3：Agent 的回复不包含当前上下文不可访问的记忆内容

        ∀ response, ∀ session:
            output_guard.check(response, session).safe = True
        """
        check = output_guard.check_output(response, session_context)
        return check["safe"]
```

### 8.2 持续集成测试

```python
# test_memory_security.py
import pytest

class TestMemoryPartitionSecurity:
    """记忆分区安全测试套件"""

    def test_private_memory_not_accessible_in_group(self):
        """测试：私聊记忆在群聊上下文中不可访问"""
        store = MemoryStore()
        store.add(MemoryEntry(
            content="用户的私人信息",
            scope=MemoryScope.PRIVATE,
        ))

        filter = MemoryFilter(store)
        group_context = {"session_type": "group", "group_id": "test-group"}
        accessible = filter.get_accessible_memories(group_context)

        assert len(accessible) == 0

    def test_cross_group_memory_not_accessible(self):
        """测试：A 群的记忆在 B 群上下文中不可访问"""
        store = MemoryStore()
        store.add(MemoryEntry(
            content="A 群的讨论内容",
            scope=MemoryScope.GROUP,
            group_id="group-a",
        ))

        filter = MemoryFilter(store)
        group_b_context = {"session_type": "group", "group_id": "group-b"}
        accessible = filter.get_accessible_memories(group_b_context)

        assert len(accessible) == 0

    def test_global_memory_accessible_everywhere(self):
        """测试：全局记忆在任何上下文中都可访问"""
        store = MemoryStore()
        store.add(MemoryEntry(
            content="通用技术知识",
            scope=MemoryScope.GLOBAL,
        ))

        filter = MemoryFilter(store)

        # 私聊可访问
        private_accessible = filter.get_accessible_memories(
            {"session_type": "private"})
        assert len(private_accessible) == 1

        # 群聊可访问
        group_accessible = filter.get_accessible_memories(
            {"session_type": "group", "group_id": "any-group"})
        assert len(group_accessible) == 1

    def test_output_guard_blocks_private_leak(self):
        """测试：输出守卫阻断私聊记忆泄漏"""
        store = MemoryStore()
        store.add(MemoryEntry(
            content="用户准备跳槽到字节跳动",
            scope=MemoryScope.PRIVATE,
            sensitivity=3,
        ))

        guard = OutputGuard(store)
        group_context = {"session_type": "group", "group_id": "work"}

        # Agent 尝试在群聊中提及私聊内容
        response = "您最近在准备字节跳动的面试"
        check = guard.check_output(response, group_context)

        assert check["safe"] is False
        assert any(i["type"] == "private_memory_leak" for i in check["issues"])
```

---

## 九、性能考量与优化

### 9.1 记忆过滤的性能影响

在记忆条目数量增长后，每次都遍历全部记忆进行过滤会产生性能问题。优化方案：

```python
# memory_index.py - 记忆索引优化
class MemoryIndex:
    """基于分区索引的记忆快速检索"""

    def __init__(self):
        self._scope_index = {}  # scope -> [memory_ids]
        self._group_index = {}  # group_id -> [memory_ids]
        self._sensitivity_index = {}  # sensitivity -> [memory_ids]

    def index_memory(self, memory: MemoryEntry):
        """为新记忆建立索引"""
        mid = id(memory)

        # 按 scope 索引
        scope_key = memory.scope.value
        self._scope_index.setdefault(scope_key, []).append(mid)

        # 按 group 索引
        if memory.group_id:
            self._group_index.setdefault(memory.group_id, []).append(mid)

        # 按敏感度索引
        self._sensitivity_index.setdefault(memory.sensitivity, []).append(mid)

    def get_accessible_ids(self, session_context: dict) -> set:
        """快速获取可访问的记忆 ID 集合"""
        accessible = set()

        # 全局记忆总是可访问
        accessible.update(self._scope_index.get("global", []))

        session_type = session_context.get("session_type")

        if session_type == "private":
            accessible.update(self._scope_index.get("session:private", []))

        elif session_type == "group":
            group_id = session_context.get("group_id")
            accessible.update(self._group_index.get(group_id, []))

        return accessible
```

### 9.2 定期清理与压缩

```python
# memory_gc.py - 记忆垃圾回收
class MemoryGarbageCollector:
    """记忆系统的垃圾回收器"""

    def __init__(self, memory_store, config):
        self.store = memory_store
        self.config = config

    def collect(self):
        """执行一轮垃圾回收"""
        # 1. 清理过期的临时记忆
        self._cleanup_ephemeral()

        # 2. 压缩低价值的群聊记忆
        self._compress_low_value_group_memories()

        # 3. 合并重复记忆
        self._deduplicate()

    def _cleanup_ephemeral(self):
        """清理超过 TTL 的临时记忆"""
        from datetime import datetime, timedelta
        ttl = timedelta(hours=self.config.get("ephemeral_ttl_hours", 24))
        cutoff = datetime.now() - ttl

        ephemeral = self.store.get_by_scope(MemoryScope.EPHEMERAL)
        for mem in ephemeral:
            if mem.created_at < cutoff:
                self.store.remove(mem)

    def _compress_low_value_group_memories(self):
        """压缩低价值的群聊记忆（如闲聊、表情包相关）"""
        group_memories = self.store.get_by_scope(MemoryScope.GROUP)
        for mem in group_memories:
            if self._is_low_value(mem):
                self.store.compress(mem)  # 标记为可压缩

    def _is_low_value(self, memory) -> bool:
        """判断记忆是否为低价值"""
        low_value_indicators = [
            "哈哈", "666", "👍", "收到", "好的", "OK",
            "😄", "🎉", "lol", "haha",
        ]
        content = memory.content.lower()
        return any(indicator in content for indicator in low_value_indicators)

    def _deduplicate(self):
        """去除重复记忆"""
        all_memories = self.store.get_all()
        seen = {}
        for mem in all_memories:
            fingerprint = self._fingerprint(mem.content)
            if fingerprint in seen:
                self.store.mark_duplicate(mem, seen[fingerprint])
            else:
                seen[fingerprint] = mem

    def _fingerprint(self, text: str) -> str:
        """生成文本指纹用于去重"""
        import hashlib
        normalized = text.strip().lower()
        return hashlib.md5(normalized.encode()).hexdigest()
```

---

## 十、最佳实践总结

### 10.1 设计原则

1. **最小权限原则**：默认不暴露任何记忆，只在明确允许的上下文中可见
2. **默认安全**：群聊记忆默认不持久化，高敏感内容强制隔离
3. **纵深防御**：写入时分类 + 读取时过滤 + 输出时检查，三层防护
4. **可审计性**：所有跨域信息流动都有日志记录

### 10.2 常见陷阱

| 陷阱 | 后果 | 解决方案 |
|------|------|----------|
| 群聊中引用私聊信息 | 隐私泄露 | 输出守卫检查 |
| 跨群串联项目信息 | 信息泄露 | 信息流矩阵控制 |
| 群聊噪音污染长期记忆 | 记忆质量下降 | 默认不持久化策略 |
| 敏感信息写入全局分区 | 全面上下文暴露 | 自动分类 + 强制升级 |
| 记忆条目过多导致性能下降 | 响应延迟 | 分区索引 + 垃圾回收 |

### 10.3 渐进式采用路径

```
阶段 1：基础隔离
├── 启用 MEMORY.md 分区结构
├── 私聊/群聊上下文分离
└── 默认不持久化群聊记忆

阶段 2：敏感度分级
├── 部署敏感度分类器
├── 高敏感内容自动隔离
└── PII 自动脱敏

阶段 3：信息流控制
├── 实施信息流矩阵
├── 输出守卫上线
└── 跨群阻断生效

阶段 4：运维与监控
├── 泄漏检测告警
├── 审计日志上线
├── 定期安全评审
└── 垃圾回收与优化
```

---

## 总结

OpenClaw 的隐私感知记忆分区机制，通过 MEMORY.md 的分区结构、群聊上下文的三层安全边界、多维度敏感度分类器、以及严格的信息流控制矩阵，构建了一套完整的记忆安全体系。

核心设计理念是：**在 AI Agent 的记忆系统中，隐私不是事后补救的功能，而是架构层面的一等公民。** 从记忆的写入、存储、读取到输出，每一个环节都内置了安全检查，确保用户的私人信息不会在不恰当的上下文中暴露。

随着 AI Agent 在更多场景中部署——从个人助手到团队协作，从技术社区到客户服务——记忆分区将成为不可或缺的基础设施。希望本文的分析和实现方案，能为你的 OpenClaw 部署提供有价值的参考。

---

*本文是 OpenClaw 深度剖析系列的一部分。下一篇将探讨 OpenClaw 的分层记忆架构：daily notes、MEMORY.md 与 heartbeat-state.json 的协作机制。*

---

## 相关阅读

- [三大框架模型路由对比：Hermes ProviderProfile vs OpenClaw Fallback Chain vs OpenHuman Hint Router](/post/openclaw-hermes-providerprofile-fallback-chain/)
- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/post/ai-agent-sql/)
