---

title: OpenClaw 群聊行为准则：HEARTBEAT_OK 静默策略、反应礼仪、平台格式适配
keywords: [OpenClaw, HEARTBEAT, OK, 群聊行为准则, 静默策略, 反应礼仪, 平台格式适配]
date: 2026-06-02 00:00:00
tags:
- OpenClaw
- 群聊
- 静默策略
- 行为准则
- AI Agent
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: AI Agent 进入群聊后面临的首要挑战是社交礼仪而非技术能力。本文深入剖析 OpenClaw 的群聊行为准则体系，涵盖 HEARTBEAT_OK 静默策略的状态机设计与 Python 实现、Emoji 反应礼仪规范、回复长度分级策略、Telegram/Slack/飞书/QQ/企业微信五大平台的格式适配方案，以及统一行为编排器的完整架构，帮助你构建一个「安静但有用」的群聊 AI Agent。
---



# OpenClaw 群聊行为准则：HEARTBEAT_OK 静默策略、反应礼仪、平台格式适配

## 前言

AI Agent 进入群聊环境后面临的第一个挑战不是技术能力，而是**社交礼仪**。一个在一对一场景下表现完美的 Agent，到了群聊中可能会变成"话痨"——每条消息都回复、每次都发长篇大论、不区分正式讨论和随意聊天。这不仅影响群聊体验，还会让 Agent 被群管理员禁言甚至踢出。

OpenClaw 为此设计了一套完整的**群聊行为准则体系**，核心包括 HEARTBEAT_OK 静默策略、反应礼仪规范和平台格式适配三大机制。本文将深入剖析这套体系的设计哲学和实现细节。

## 一、群聊场景的特殊挑战

### 1.1 群聊与私聊的本质区别

群聊不是多人私聊的简单叠加。它有独特的社交动态：

**信息噪声敏感**：群聊中每条消息都会打扰所有成员。Agent 如果回复每条消息，即使回复质量很高，也会被视为"噪音制造者"。

**上下文碎片化**：群聊中的对话往往不是线性的。多个人可能同时讨论不同话题，Agent 需要判断哪些消息是发给自己的。

**身份边界模糊**：在群聊中，Agent 是一个"群成员"而非"个人助手"。它的行为需要符合群的社交规范，而非个人服务的模式。

**平台差异巨大**：Telegram 群、Slack 频道、飞书群、QQ 群、微信群的行为规范各不相同。

### 1.2 常见的群聊 Agent 反模式

| 反模式 | 症状 | 后果 |
|--------|------|------|
| 全量回复 | 回复每一条消息 | 被视为 spam，被禁言 |
| 长篇大论 | 每次回复都超过 500 字 | 群聊信息流被淹没 |
| 抢答王 | 别人问的问题还没回答完就插嘴 | 打断对话，引起反感 |
| 选择困难 | 不确定是否该回复时选择回复 | 噪音大于价值 |
| 格式错乱 | 在 QQ 群里发 Markdown 表格 | 内容无法正常显示 |

## 二、HEARTBEAT_OK 静默策略

### 2.1 设计理念

HEARTBEAT_OK 是 OpenClaw 群聊行为的核心机制。它来自一个简单的观察：**在群聊中，沉默往往比发言更有价值**。

Agent 的默认状态是"静默"（HEARTBEAT_OK）。只有当满足特定条件时，Agent 才会"开口说话"。这个设计确保 Agent 的每一次发言都是有价值的。

### 2.2 状态机设计

```
                    ┌──────────────┐
                    │  HEARTBEAT_OK │ ← 默认状态：静默
                    │  （监听中）    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     [直接 @提及]   [关键词匹配]  [主动触发]
              │            │            │
              ▼            ▼            ▼
        ┌─────────┐ ┌─────────┐ ┌─────────┐
        │ ENGAGED  │ │ TRIGGERED│ │ SCHEDULED│
        │（被召唤） │ │（被触发） │ │（定时任务）│
        └────┬────┘ └────┬────┘ └────┬────┘
             │            │            │
             ▼            ▼            ▼
        ┌─────────────────────────────────┐
        │          RESPONDING              │
        │       （生成并发送回复）           │
        └──────────────┬──────────────────┘
                       │
                       ▼
                ┌──────────────┐
                │  HEARTBEAT_OK │ ← 回复后自动回到静默
                └──────────────┘
```

### 2.3 触发条件配置

```yaml
# config/group_chat.yaml
group_chat:
  # 默认行为：静默
  default_behavior: "silent"

  # 触发条件
  triggers:
    # 直接 @提及（最高优先级）
    mention:
      enabled: true
      priority: 1
      # 匹配模式：@agent_name 或 @bot
      patterns:
        - "@OpenClaw"
        - "@claw"

    # 关键词触发
    keywords:
      enabled: true
      priority: 2
      # 全局关键词
      global:
        - "OpenClaw"
        - "小爪"
        - "claw"
      # 分组关键词（不同群可以配置不同的关键词）
      groups:
        dev-team:
          - "代码审查"
          - "部署"
          - "CI 失败"
        ops-team:
          - "告警"
          - "服务异常"
          - "磁盘满了"

    # 定时触发
    schedule:
      enabled: true
      priority: 3
      tasks:
        - cron: "0 9 * * 1-5"  # 工作日早上 9 点
          action: "daily_standup"
          groups: ["dev-team"]
        - cron: "0 18 * * 5"   # 周五下午 6 点
          action: "weekly_summary"
          groups: ["dev-team", "ops-team"]

    # 问题检测触发（NLP 判断是否在问问题）
    question_detection:
      enabled: true
      priority: 4
      confidence_threshold: 0.8
      # 仅当问题与 Agent 能力相关时触发
      capability_keywords:
        - "怎么"
        - "如何"
        - "为什么"
        - "是什么"
        - "谁知道"
        - "有人知道"

  # 安静时段
  quiet_hours:
    enabled: true
    # 不回应非紧急消息的时间段
    periods:
      - start: "23:00"
        end: "07:00"
        timezone: "Asia/Shanghai"
      - start: "12:00"
        end: "13:30"
        timezone: "Asia/Shanghai"
        label: "午休时间"
    # 紧急消息不受安静时段限制
    urgent_override: true
    urgent_keywords:
      - "紧急"
      - "urgent"
      - "生产故障"
      - "P0"
```

### 2.4 静默策略的 Python 实现

```python
# openclaw/group_chat/silence_policy.py
import re
import time
from datetime import datetime, time as dt_time
from typing import Optional, List, Dict
from dataclasses import dataclass
from enum import Enum
import logging
import pytz

logger = logging.getLogger(__name__)


class TriggerType(Enum):
    """触发类型"""
    MENTION = "mention"
    KEYWORD = "keyword"
    SCHEDULE = "schedule"
    QUESTION = "question"
    NONE = "none"


class ChatBehavior(Enum):
    """聊天行为"""
    SILENT = "silent"        # 静默：不回复
    REACTIVE = "reactive"    # 被动回复：仅在被提及时回复
    PROACTIVE = "proactive"  # 主动回复：检测到相关话题时回复
    SCHEDULED = "scheduled"  # 定时回复：按计划执行


@dataclass
class TriggerResult:
    """触发检测结果"""
    should_respond: bool
    trigger_type: TriggerType
    confidence: float
    reason: str
    priority: int = 99


class SilencePolicy:
    """
    HEARTBEAT_OK 静默策略引擎。

    核心逻辑：
    1. 接收群聊消息
    2. 按优先级检查触发条件
    3. 检查安静时段
    4. 检查去重（避免重复回复）
    5. 返回是否应该回复
    """

    def __init__(self, config: dict):
        self.config = config
        self.triggers = config.get('triggers', {})
        self.quiet_hours = config.get('quiet_hours', {})
        self.default_behavior = config.get('default_behavior', 'silent')

        # 去重：记录最近回复的消息 hash
        self._recent_responses: Dict[str, float] = {}
        self._dedup_window = 300  # 5 分钟内不重复回复相同内容

    def should_respond(
        self,
        message_text: str,
        sender_id: str,
        group_id: str,
        is_mentioned: bool = False,
        message_id: str = "",
    ) -> TriggerResult:
        """
        判断是否应该回复。

        检查顺序（按优先级）：
        1. 去重检查
        2. @提及检查
        3. 关键词检查
        4. 问题检测
        5. 安静时段检查
        6. 默认行为
        """
        # 0. 自己发的消息不回复
        if sender_id == self.config.get('bot_user_id', ''):
            return TriggerResult(
                should_respond=False,
                trigger_type=TriggerType.NONE,
                confidence=1.0,
                reason="Own message, ignoring",
            )

        # 1. 去重检查
        msg_hash = self._hash_message(message_text)
        if self._is_duplicate(msg_hash):
            logger.debug(f"Duplicate message detected: {msg_hash[:8]}")
            return TriggerResult(
                should_respond=False,
                trigger_type=TriggerType.NONE,
                confidence=1.0,
                reason="Duplicate message within dedup window",
            )

        # 2. @提及检查（最高优先级）
        if is_mentioned or self._check_mention(message_text):
            if not self._in_quiet_hours() or self._is_urgent(message_text):
                return TriggerResult(
                    should_respond=True,
                    trigger_type=TriggerType.MENTION,
                    confidence=1.0,
                    reason="Direct mention detected",
                    priority=1,
                )

        # 3. 关键词检查
        keyword_result = self._check_keywords(message_text, group_id)
        if keyword_result.should_respond:
            if not self._in_quiet_hours() or self._is_urgent(message_text):
                return keyword_result

        # 4. 问题检测
        question_result = self._check_question(message_text)
        if question_result.should_respond:
            if not self._in_quiet_hours():
                return question_result

        # 5. 安静时段检查
        if self._in_quiet_hours():
            return TriggerResult(
                should_respond=False,
                trigger_type=TriggerType.NONE,
                confidence=1.0,
                reason="Quiet hours active",
            )

        # 6. 默认行为
        return TriggerResult(
            should_respond=False,
            trigger_type=TriggerType.NONE,
            confidence=0.5,
            reason=f"Default behavior: {self.default_behavior}",
        )

    def _check_mention(self, text: str) -> bool:
        """检查是否被 @提及"""
        mention_config = self.triggers.get('mention', {})
        if not mention_config.get('enabled', False):
            return False

        patterns = mention_config.get('patterns', [])
        for pattern in patterns:
            if pattern.lower() in text.lower():
                return True
        return False

    def _check_keywords(self, text: str, group_id: str) -> TriggerResult:
        """检查关键词匹配"""
        keyword_config = self.triggers.get('keywords', {})
        if not keyword_config.get('enabled', False):
            return TriggerResult(False, TriggerType.NONE, 0, "Keywords disabled")

        text_lower = text.lower()

        # 检查全局关键词
        for kw in keyword_config.get('global', []):
            if kw.lower() in text_lower:
                return TriggerResult(
                    should_respond=True,
                    trigger_type=TriggerType.KEYWORD,
                    confidence=0.9,
                    reason=f"Global keyword matched: {kw}",
                    priority=2,
                )

        # 检查分组关键词
        group_keywords = keyword_config.get('groups', {}).get(group_id, [])
        for kw in group_keywords:
            if kw.lower() in text_lower:
                return TriggerResult(
                    should_respond=True,
                    trigger_type=TriggerType.KEYWORD,
                    confidence=0.85,
                    reason=f"Group keyword matched: {kw}",
                    priority=2,
                )

        return TriggerResult(False, TriggerType.NONE, 0, "No keyword match")

    def _check_question(self, text: str) -> TriggerResult:
        """检测是否在问问题"""
        q_config = self.triggers.get('question_detection', {})
        if not q_config.get('enabled', False):
            return TriggerResult(False, TriggerType.NONE, 0, "Question detection disabled")

        # 简单的问号检测
        has_question_mark = '?' in text or '？' in text

        # 能力关键词检测
        capability_kw = q_config.get('capability_keywords', [])
        matched_caps = [kw for kw in capability_kw if kw in text]

        if has_question_mark and matched_caps:
            confidence = min(0.9, 0.5 + len(matched_caps) * 0.1)
            threshold = q_config.get('confidence_threshold', 0.8)

            if confidence >= threshold:
                return TriggerResult(
                    should_respond=True,
                    trigger_type=TriggerType.QUESTION,
                    confidence=confidence,
                    reason=f"Question detected with capability keywords: {matched_caps}",
                    priority=4,
                )

        return TriggerResult(False, TriggerType.NONE, 0, "Not a relevant question")

    def _in_quiet_hours(self) -> bool:
        """检查当前是否在安静时段"""
        if not self.quiet_hours.get('enabled', False):
            return False

        now = datetime.now()
        for period in self.quiet_hours.get('periods', []):
            tz = pytz.timezone(period.get('timezone', 'Asia/Shanghai'))
            local_now = now.astimezone(tz)
            current_time = local_now.time()

            start = dt_time.fromisoformat(period['start'])
            end = dt_time.fromisoformat(period['end'])

            if start <= end:
                # 同一天内的时间段
                if start <= current_time <= end:
                    return True
            else:
                # 跨午夜的时间段
                if current_time >= start or current_time <= end:
                    return True

        return False

    def _is_urgent(self, text: str) -> bool:
        """检查消息是否为紧急消息"""
        urgent_kw = self.quiet_hours.get('urgent_keywords', [])
        return any(kw in text for kw in urgent_kw)

    def _is_duplicate(self, msg_hash: str) -> bool:
        """检查是否为重复消息"""
        now = time.time()
        # 清理过期记录
        self._recent_responses = {
            h: t for h, t in self._recent_responses.items()
            if now - t < self._dedup_window
        }
        return msg_hash in self._recent_responses

    def record_response(self, message_text: str):
        """记录已回复的消息"""
        msg_hash = self._hash_message(message_text)
        self._recent_responses[msg_hash] = time.time()

    def _hash_message(self, text: str) -> str:
        """计算消息的去重 hash"""
        import hashlib
        normalized = re.sub(r'\s+', ' ', text.strip().lower())
        return hashlib.md5(normalized.encode()).hexdigest()[:16]
```

## 三、反应礼仪规范

### 3.1 Emoji 反应 vs 文字回复

在群聊中，不是所有消息都需要用文字回复。很多情况下，一个 Emoji 反应（reaction）比一段文字更合适：

```python
# openclaw/group_chat/reaction_policy.py
from enum import Enum
from typing import Optional, Dict, List
import logging

logger = logging.getLogger(__name__)


class ReactionType(Enum):
    """反应类型"""
    ACKNOWLEDGE = "acknowledge"    # 确认收到
    APPROVE = "approve"            # 赞同
    THINKING = "thinking"          # 思考中
    DONE = "done"                  # 完成
    DECLINE = "decline"            # 婉拒
    HUMOR = "humor"                # 幽默回应


# 反应策略配置
REACTION_STRATEGY: Dict[ReactionType, Dict] = {
    ReactionType.ACKNOWLEDGE: {
        "emojis": ["👍", "✅", "👀"],
        "use_when": [
            "收到指令但不需要详细回复",
            "确认已阅读但无需行动",
            "简单的收悉确认",
        ],
        "platforms": {
            "telegram": "👍",
            "slack": "thumbsup",
            "feishu": "THUMBSUP",
            "qq": "👍",
            "wechat": None,  # 企业微信不支持 reaction
        }
    },
    ReactionType.APPROVE: {
        "emojis": ["❤️", "🎉", "💪"],
        "use_when": [
            "赞同某个提议",
            "庆祝完成的里程碑",
            "鼓励团队成员",
        ],
    },
    ReactionType.THINKING: {
        "emojis": ["🤔", "💭"],
        "use_when": [
            "收到复杂问题，需要时间处理",
            "表示正在思考中",
        ],
    },
    ReactionType.DONE: {
        "emojis": ["✅", "☑️", "🎯"],
        "use_when": [
            "任务已完成",
            "问题已解决",
        ],
    },
    ReactionType.DECLINE: {
        "emojis": ["❌", "🚫"],
        "use_when": [
            "不赞同某个提议",
            "标记不可行的方案",
        ],
    },
}


class ReactionPolicy:
    """反应策略管理器"""

    def __init__(self, config: dict):
        self.config = config
        self.reaction_cooldown: Dict[str, float] = {}  # 防止 reaction 洪水
        self.cooldown_seconds = 5

    def should_use_reaction(
        self,
        message_text: str,
        context: str,
        platform: str,
    ) -> Optional[ReactionType]:
        """
        判断是否应该用 emoji reaction 而非文字回复。

        使用 reaction 而非文字回复的场景：
        1. 简单的确认/收到
        2. 表达赞同/反对
        3. 表示正在处理中
        4. 频繁互动中避免刷屏
        """
        text_lower = message_text.lower().strip()

        # 简短确认场景
        if len(text_lower) < 20:
            if any(w in text_lower for w in ['收到', 'ok', '好的', '了解', 'got it']):
                return ReactionType.ACKNOWLEDGE

        # 任务完成场景
        if any(w in text_lower for w in ['完成了', '搞定了', 'done', 'fixed', '已修复']):
            return ReactionType.DONE

        # 问题场景
        if any(w in text_lower for w in ['看看', 'check', '查一下']):
            return ReactionType.THINKING

        return None

    def get_reaction_emoji(self, reaction_type: ReactionType, platform: str) -> Optional[str]:
        """获取平台对应的 emoji"""
        strategy = REACTION_STRATEGY.get(reaction_type, {})
        platform_emojis = strategy.get('platforms', {})

        if platform in platform_emojis:
            return platform_emojis[platform]

        # 默认使用通用 emoji
        emojis = strategy.get('emojis', ['👍'])
        return emojis[0]
```

### 3.2 回复长度策略

```python
# openclaw/group_chat/response_length_policy.py
from enum import Enum
from typing import Optional


class ResponseLength(Enum):
    """回复长度级别"""
    REACTION = 0       # 仅 emoji reaction
    ONE_LINER = 50     # 一句话（50 字以内）
    BRIEF = 200        # 简短回复（200 字以内）
    NORMAL = 500       # 正常回复（500 字以内）
    DETAILED = 2000    # 详细回复（2000 字以内）
    FULL = 10000       # 完整回复（不受限制）


class ResponseLengthPolicy:
    """
    回复长度策略。

    核心原则：群聊中，能短则短。
    """

    def determine_length(
        self,
        is_group_chat: bool,
        trigger_type: str,
        question_complexity: float,  # 0-1
        is_thread: bool = False,
        platform: str = "telegram",
    ) -> ResponseLength:
        """
        确定回复的长度级别。

        决策逻辑：
        - 群聊中默认简短
        - 被直接 @提及时可以稍长
        - 在 thread 中可以详细
        - 复杂问题允许更长
        """
        if not is_group_chat:
            # 私聊不受长度限制
            return ResponseLength.FULL

        if trigger_type == "mention" and not is_thread:
            # 被 @提及但不在 thread 中
            if question_complexity < 0.3:
                return ResponseLength.BRIEF
            elif question_complexity < 0.7:
                return ResponseLength.NORMAL
            else:
                return ResponseLength.DETAILED

        if is_thread:
            # 在 thread 中可以详细
            return ResponseLength.DETAILED

        if trigger_type == "keyword":
            # 关键词触发，简短回应
            return ResponseLength.BRIEF

        if trigger_type == "question":
            # 问题检测触发
            if question_complexity < 0.5:
                return ResponseLength.ONE_LINER
            else:
                return ResponseLength.BRIEF

        # 默认
        return ResponseLength.ONE_LINER

    def truncate_to_length(self, text: str, max_length: ResponseLength) -> str:
        """截断回复到指定长度"""
        if max_length == ResponseLength.FULL:
            return text
        if max_length == ResponseLength.REACTION:
            return ""

        limit = max_length.value
        if len(text) <= limit:
            return text

        # 智能截断：在句号/换行处截断
        truncated = text[:limit]
        for sep in ['\n\n', '。', '.\n', '\n', '. ']:
            last_sep = truncated.rfind(sep)
            if last_sep > limit * 0.5:
                return truncated[:last_sep + len(sep)] + "..."

        return truncated + "..."
```

## 四、平台格式适配

### 4.1 消息格式适配器

```python
# openclaw/group_chat/format_adapter.py
from typing import Dict, Optional
from dataclasses import dataclass
import re


@dataclass
class PlatformLimits:
    """平台消息限制"""
    max_length: int
    supports_markdown: bool
    supports_html: bool
    supports_code_block: bool
    supports_image: bool
    supports_reaction: bool
    supports_thread: bool
    supports_reply: bool
    mention_format: str  # @提及的格式


PLATFORM_LIMITS: Dict[str, PlatformLimits] = {
    "telegram": PlatformLimits(
        max_length=4096,
        supports_markdown=True,
        supports_html=True,
        supports_code_block=True,
        supports_image=True,
        supports_reaction=True,
        supports_thread=False,
        supports_reply=True,
        mention_format="@{username}",
    ),
    "slack": PlatformLimits(
        max_length=40000,  # Block Kit 的限制
        supports_markdown=True,  # mrkdwn
        supports_html=False,
        supports_code_block=True,
        supports_image=True,
        supports_reaction=True,
        supports_thread=True,
        supports_reply=True,
        mention_format="<@{user_id}>",
    ),
    "feishu": PlatformLimits(
        max_length=2000,
        supports_markdown=True,  # lark_md
        supports_html=False,
        supports_code_block=True,
        supports_image=True,
        supports_reaction=True,
        supports_thread=True,
        supports_reply=True,
        mention_format="<at user_id=\"{user_id}\">{name}</at>",
    ),
    "qq": PlatformLimits(
        max_length=2000,
        supports_markdown=True,  # QQ 频道支持
        supports_html=False,
        supports_code_block=True,
        supports_image=True,
        supports_reaction=False,
        supports_thread=False,
        supports_reply=True,
        mention_format="<@{qq_id}>",
    ),
    "wechat": PlatformLimits(
        max_length=4096,
        supports_markdown=True,  # 有限支持
        supports_html=False,
        supports_code_block=False,  # 不支持
        supports_image=False,       # Webhook 不支持
        supports_reaction=False,
        supports_thread=False,
        supports_reply=True,
        mention_format="@{userid}",
    ),
}


class FormatAdapter:
    """群聊消息格式适配器"""

    def adapt(self, text: str, platform: str) -> str:
        """
        将标准 Markdown 适配为平台特定格式。

        处理：
        1. 格式标记转换
        2. 长度截断
        3. 不支持的特性降级
        """
        limits = PLATFORM_LIMITS.get(platform)
        if not limits:
            return text

        result = text

        # 代码块处理
        if not limits.supports_code_block:
            result = self._strip_code_blocks(result)

        # 格式转换
        if platform == "slack":
            result = self._to_mrkdwn(result)
        elif platform == "feishu":
            result = self._to_lark_md(result)
        elif platform == "wechat":
            result = self._to_wechat_md(result)

        # 长度截断
        if len(result) > limits.max_length:
            result = result[:limits.max_length - 20] + "\n\n... (已截断)"

        return result

    def _to_mrkdwn(self, text: str) -> str:
        """转换为 Slack mrkdwn"""
        # 标题 → 粗体
        text = re.sub(r'^#{1,3}\s+(.+)$', r'*\1*', text, flags=re.MULTILINE)
        # 链接
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<\2|\1>', text)
        # 粗体 **text** → *text*
        text = text.replace('**', '*')
        return text

    def _to_lark_md(self, text: str) -> str:
        """转换为飞书 lark_md"""
        # 飞书 lark_md 基本兼容标准 Markdown
        # 但不支持有序列表，转换为无序
        text = re.sub(r'^\d+\.\s+', '• ', text, flags=re.MULTILINE)
        return text

    def _to_wechat_md(self, text: str) -> str:
        """转换为企业微信 Markdown"""
        # 企业微信不支持图片、表格
        text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
        # 移除表格
        lines = text.split('\n')
        result = []
        in_table = False
        for line in lines:
            if '|' in line and line.strip().startswith('|'):
                if not in_table:
                    in_table = True
                    result.append('---')
                continue
            if in_table:
                in_table = False
            result.append(line)
        return '\n'.join(result)

    def _strip_code_blocks(self, text: str) -> str:
        """移除代码块，保留内容"""
        text = re.sub(r'```[\w]*\n(.*?)```', r'\1', text, flags=re.DOTALL)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        return text

    def format_mention(self, user_info: dict, platform: str) -> str:
        """格式化 @提及"""
        limits = PLATFORM_LIMITS.get(platform)
        if not limits:
            return f"@{user_info.get('name', 'user')}"

        return limits.mention_format.format(
            username=user_info.get('username', 'user'),
            user_id=user_info.get('id', ''),
            name=user_info.get('name', 'user'),
            qq_id=user_info.get('qq_id', ''),
            userid=user_info.get('userid', ''),
        )
```

## 五、群聊行为编排器

### 5.1 统一行为决策引擎

```python
# openclaw/group_chat/behavior_orchestrator.py
from typing import Optional, Dict, Any
from dataclasses import dataclass
from .silence_policy import SilencePolicy, TriggerResult, TriggerType
from .reaction_policy import ReactionPolicy, ReactionType
from .response_length_policy import ResponseLengthPolicy, ResponseLength
from .format_adapter import FormatAdapter
import logging

logger = logging.getLogger(__name__)


@dataclass
class BehaviorDecision:
    """行为决策结果"""
    action: str  # "silent", "react", "reply"
    reaction_emoji: Optional[str] = None
    reply_text: Optional[str] = None
    reply_length: ResponseLength = ResponseLength.BRIEF
    platform: str = "telegram"
    reason: str = ""


class BehaviorOrchestrator:
    """
    群聊行为编排器。

    将静默策略、反应策略、长度策略和格式适配整合在一起，
    做出最终的行为决策。
    """

    def __init__(self, config: dict):
        self.silence_policy = SilencePolicy(config.get('silence', {}))
        self.reaction_policy = ReactionPolicy(config.get('reaction', {}))
        self.length_policy = ResponseLengthPolicy()
        self.format_adapter = FormatAdapter()

    async def decide(
        self,
        message_text: str,
        sender_id: str,
        group_id: str,
        platform: str,
        is_mentioned: bool = False,
        is_thread: bool = False,
        message_id: str = "",
        context: Dict[str, Any] = None,
    ) -> BehaviorDecision:
        """
        做出群聊行为决策。

        决策流程：
        1. 检查是否应该回复（静默策略）
        2. 如果应该回复，检查是否用 reaction 代替
        3. 确定回复长度
        4. 格式适配
        """
        context = context or {}

        # 步骤 1：静默策略
        trigger_result = self.silence_policy.should_respond(
            message_text=message_text,
            sender_id=sender_id,
            group_id=group_id,
            is_mentioned=is_mentioned,
            message_id=message_id,
        )

        if not trigger_result.should_respond:
            return BehaviorDecision(
                action="silent",
                reason=trigger_result.reason,
                platform=platform,
            )

        # 步骤 2：反应策略
        reaction_type = self.reaction_policy.should_use_reaction(
            message_text=message_text,
            context=str(context),
            platform=platform,
        )

        if reaction_type:
            emoji = self.reaction_policy.get_reaction_emoji(reaction_type, platform)
            if emoji:
                return BehaviorDecision(
                    action="react",
                    reaction_emoji=emoji,
                    reason=f"Reaction preferred: {reaction_type.value}",
                    platform=platform,
                )

        # 步骤 3：确定回复长度
        question_complexity = context.get('question_complexity', 0.5)
        reply_length = self.length_policy.determine_length(
            is_group_chat=True,
            trigger_type=trigger_result.trigger_type.value,
            question_complexity=question_complexity,
            is_thread=is_thread,
            platform=platform,
        )

        # 步骤 4：记录回复（用于去重）
        self.silence_policy.record_response(message_text)

        return BehaviorDecision(
            action="reply",
            reply_length=reply_length,
            reason=f"Triggered by {trigger_result.trigger_type.value}: {trigger_result.reason}",
            platform=platform,
        )

    def format_reply(self, text: str, platform: str, max_length: ResponseLength) -> str:
        """格式化回复文本"""
        # 先截断
        text = self.length_policy.truncate_to_length(text, max_length)
        # 再格式适配
        text = self.format_adapter.adapt(text, platform)
        return text
```

## 六、群聊安全边界

### 6.1 隐私保护

群聊中的隐私保护至关重要。Agent 不应该将一个群聊的信息带到另一个群聊中：

```python
# config/group_chat_security.yaml
group_chat_security:
  # 上下文隔离
  context_isolation:
    enabled: true
    # 不同群聊的上下文完全隔离
    cross_group_memory: false
    # 不在群聊中引用私聊内容
    no_private_context_in_group: true

  # 敏感信息过滤
  sensitive_info_filter:
    enabled: true
    patterns:
      - "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"  # 邮箱
      - "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b"       # 信用卡
      - "\\b1[3-9]\\d{9}\\b"                                          # 手机号
    action: "redact"  # redact / warn / block

  # 权限控制
  permissions:
    # 仅群管理员可以触发的操作
    admin_only:
      - "config_change"
      - "system_command"
      - "data_export"
    # 所有成员都可以触发的操作
    all_members:
      - "query"
      - "help"
      - "search"
```

### 6.2 行为审计

```python
# openclaw/group_chat/audit.py
import json
import time
from pathlib import Path
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)


class GroupChatAuditor:
    """群聊行为审计器"""

    def __init__(self, audit_dir: str):
        self.audit_dir = Path(audit_dir)
        self.audit_dir.mkdir(parents=True, exist_ok=True)

    def log_decision(
        self,
        group_id: str,
        platform: str,
        message_text: str,
        sender_id: str,
        decision: str,
        reason: str,
        response: str = "",
    ):
        """记录行为决策"""
        record = {
            "timestamp": time.time(),
            "group_id": group_id,
            "platform": platform,
            "sender_id": sender_id,
            "message_preview": message_text[:100],
            "decision": decision,
            "reason": reason,
            "response_preview": response[:100] if response else "",
        }

        # 追加到审计日志
        log_file = self.audit_dir / f"audit_{time.strftime('%Y-%m-%d')}.jsonl"
        with open(log_file, 'a') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

        logger.debug(
            f"AUDIT: [{platform}:{group_id}] "
            f"decision={decision}, reason={reason}"
        )

    def get_stats(self, group_id: str, hours: int = 24) -> Dict[str, Any]:
        """获取群聊统计"""
        cutoff = time.time() - hours * 3600
        stats = {
            "total_messages_seen": 0,
            "silent_count": 0,
            "react_count": 0,
            "reply_count": 0,
            "top_triggers": {},
        }

        log_file = self.audit_dir / f"audit_{time.strftime('%Y-%m-%d')}.jsonl"
        if not log_file.exists():
            return stats

        with open(log_file, 'r') as f:
            for line in f:
                try:
                    record = json.loads(line)
                    if record.get('timestamp', 0) < cutoff:
                        continue
                    if record.get('group_id') != group_id:
                        continue

                    stats["total_messages_seen"] += 1
                    decision = record.get('decision', 'silent')
                    if decision == "silent":
                        stats["silent_count"] += 1
                    elif decision == "react":
                        stats["react_count"] += 1
                    elif decision == "reply":
                        stats["reply_count"] += 1

                    reason = record.get('reason', '')
                    stats["top_triggers"][reason] = stats["top_triggers"].get(reason, 0) + 1
                except json.JSONDecodeError:
                    continue

        return stats
```

## 七、最佳实践总结

### 7.1 群聊行为的黄金法则

1. **沉默是金**：默认不回复，只在有明确理由时才发言
2. **短胜于长**：群聊回复控制在 200 字以内，详细内容引导到 thread 或私聊
3. **reaction 优先**：能用 emoji 表达的不用文字
4. **上下文敏感**：理解群聊的上下文，不要答非所问
5. **尊重安静时段**：非紧急消息不在深夜回复
6. **格式适配**：根据平台能力选择合适的格式
7. **隐私隔离**：群聊信息不跨群泄露
8. **行为可审计**：所有决策都有日志

### 7.2 不同场景的调参建议

| 场景 | silence 模式 | 反应策略 | 回复长度 |
|------|-------------|----------|---------|
| 技术讨论群 | keyword + question | 仅确认类 | brief |
| 运维告警群 | 全量响应 | 无 | normal |
| 项目管理群 | mention only | 确认 + 完成 | brief |
| 社区交流群 | mention only | 多用 reaction | one_liner |
| 内部团队群 | keyword + mention | 灵活 | normal |

## 总结

OpenClaw 的群聊行为准则体系通过 HEARTBEAT_OK 静默策略、反应礼仪规范和平台格式适配三个层次，解决了 AI Agent 在群聊环境中的"社交困境"。其核心设计理念是：**在群聊中，Agent 的价值不在于说了多少，而于说了什么**。通过精确的触发条件判断、恰当的反应形式选择和平台感知的格式适配，Agent 可以在群聊中成为一个受欢迎的"安静但有用"的成员，而非令人厌烦的"话痨机器人"。

## 八、常见踩坑案例

### 8.1 反应 API 差异导致的兼容性问题

不同平台对 Emoji Reaction 的支持差异巨大。在实际部署中，一个常见的错误是在企业微信群中调用 Reaction API，结果返回 400 错误。这是因为企业微信的群机器人 Webhook 根本不支持 reaction 功能。解决方案是在 `ReactionPolicy` 中为每个平台维护一个 `supports_reaction` 标志，对不支持的平台降级为简短文字回复。

### 8.2 关键词触发的误判

在运维告警群中，如果将关键词配置为 `["告警", "异常", "失败"]`，Agent 可能会对"这次部署没有失败"这样的否定句也触发回复。建议在关键词触发后增加一个简单的语义判断层，检查消息是否包含否定词（如"没有"、"未"、"不要"），降低误判率。

### 8.3 安静时段的跨时区问题

当 Agent 服务的群成员分布在不同时区时，统一的安静时段设置会导致部分成员在白天收到 Agent 回复而另一部分成员在深夜被打扰。最佳实践是按群组配置不同的安静时段，或者根据最近活跃成员的时区动态调整。

## 相关阅读

- [OpenClaw 隐私感知记忆分区：MEMORY.md 主会话隔离 vs 群聊上下文的安全边界](/categories/架构/OpenClaw-隐私感知记忆分区-MEMORY-md-主会话隔离-vs-群聊上下文的安全边界/)
- [OpenClaw 多平台分发架构：daily-report.py 五通道（Telegram/Slack/飞书/QQ/微信）实现](/categories/AI%20Agent/OpenClaw-多平台分发架构-daily-report-py-五通道-Telegram-Slack-飞书-QQ-微信-实现/)
- [OpenClaw Discord 实战：多频道 AI 助手与社区管理](/categories/架构/OpenClaw-Discord-实战-多频道-AI-助手与社区管理/)
