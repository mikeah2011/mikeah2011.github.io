---

title: OpenClaw 多平台分发架构：daily-report.py 五通道（Telegram/Slack/飞书/QQ/微信）实现
keywords: [OpenClaw, daily, report.py, Telegram, Slack, QQ, 多平台分发架构, 五通道, 飞书, 微信]
date: 2026-06-02 00:00:00
tags:
- OpenClaw
- 多平台
- Telegram
- Slack
- 飞书
- 消息推送
- AI Agent
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: AI Agent 产生的信息需要触达不同平台的用户。本文深入剖析 OpenClaw 的多平台消息分发架构，涵盖统一消息模型设计、Telegram Bot API / Slack Webhook / 飞书 Open API / QQ 频道机器人 / 企业微信五大通道适配器的完整实现，并发分发引擎与重试降级机制，以及各平台 Markdown 方言差异和 API 限流处理的最佳实践。
---




# OpenClaw 多平台分发架构：daily-report.py 五通道（Telegram/Slack/飞书/QQ/微信）实现

## 前言

AI Agent 产生的信息需要触达用户，而用户分布在不同的平台上。有人习惯 Telegram 的简洁，有人依赖 Slack 的协作，国内团队可能用飞书或企业微信，社区场景则常见 QQ。OpenClaw 的 `daily-report.py` 模块正是为了解决这个痛点——**一次生成，五通道分发**。

本文将深入剖析 OpenClaw 的多平台消息分发架构，涵盖 Telegram Bot API、Slack Incoming Webhook、飞书 Open API、QQ 频道机器人和微信公众号/企业微信五个通道的完整接入方案。

## 一、架构总览

### 1.1 分发管道设计

OpenClaw 的消息分发采用经典的**生产者-多消费者**模式：

```
┌─────────────────┐
│  Report Generator │  ← 生产者：生成报告内容
└────────┬────────┘
         │ ReportMessage (统一消息对象)
         ▼
┌─────────────────┐
│  Channel Router   │  ← 路由层：决定发往哪些通道
└────────┬────────┘
         │
    ┌────┼────┬────┬────┐
    ▼    ▼    ▼    ▼    ▼
┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐
│ TG  ││Slack││飞书 ││ QQ  ││微信 │  ← 五个通道适配器
└─────┘└─────┘└─────┘└─────┘└─────┘
```

### 1.2 统一消息模型

所有通道共享一个统一的消息模型，屏蔽各平台的格式差异：

```python
# openclaw/channels/message.py
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime


class MessagePriority(Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class MessageType(Enum):
    TEXT = "text"
    MARKDOWN = "markdown"
    RICH_CARD = "rich_card"
    FILE = "file"


@dataclass
class MessageAttachment:
    """消息附件"""
    filename: str
    content: bytes
    mime_type: str = "application/octet-stream"


@dataclass
class RichCard:
    """富卡片消息（用于支持卡片的平台）"""
    title: str
    subtitle: str = ""
    content: str = ""
    image_url: Optional[str] = None
    actions: List[Dict[str, str]] = field(default_factory=list)
    fields: List[Dict[str, str]] = field(default_factory=list)


@dataclass
class ReportMessage:
    """统一消息模型"""
    content: str                          # 消息正文（Markdown 格式）
    title: str = ""                       # 消息标题
    message_type: MessageType = MessageType.MARKDOWN
    priority: MessagePriority = MessagePriority.NORMAL
    timestamp: datetime = field(default_factory=datetime.now)
    rich_card: Optional[RichCard] = None  # 富卡片（可选）
    attachments: List[MessageAttachment] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    target_channels: List[str] = field(default_factory=list)  # 目标通道
    tags: List[str] = field(default_factory=list)


@dataclass
class DeliveryResult:
    """投递结果"""
    channel: str
    success: bool
    message_id: Optional[str] = None
    error: Optional[str] = None
    latency_ms: float = 0.0
    retry_count: int = 0
```

## 二、通道适配器实现

### 2.1 适配器基类

```python
# openclaw/channels/base.py
from abc import ABC, abstractmethod
from typing import Optional
from .message import ReportMessage, DeliveryResult
import logging

logger = logging.getLogger(__name__)


class ChannelAdapter(ABC):
    """通道适配器基类"""

    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        self.enabled = config.get('enabled', True)
        self.max_retries = config.get('max_retries', 3)
        self.retry_delay = config.get('retry_delay', 2.0)

    @abstractmethod
    async def send(self, message: ReportMessage) -> DeliveryResult:
        """发送消息到平台"""
        pass

    @abstractmethod
    def format_message(self, message: ReportMessage) -> dict:
        """将统一消息格式转换为平台特定格式"""
        pass

    async def send_with_retry(self, message: ReportMessage) -> DeliveryResult:
        """带重试的发送"""
        import asyncio
        last_error = None

        for attempt in range(self.max_retries):
            try:
                result = await self.send(message)
                if result.success:
                    result.retry_count = attempt
                    return result
                last_error = result.error
            except Exception as e:
                last_error = str(e)
                logger.warning(f"[{self.name}] Attempt {attempt + 1} failed: {last_error}")

            if attempt < self.max_retries - 1:
                delay = self.retry_delay * (2 ** attempt)
                await asyncio.sleep(delay)

        return DeliveryResult(
            channel=self.name,
            success=False,
            error=f"All {self.max_retries} attempts failed. Last error: {last_error}",
            retry_count=self.max_retries,
        )
```

### 2.2 Telegram Bot API 适配器

```python
# openclaw/channels/telegram.py
import aiohttp
import json
from .base import ChannelAdapter
from .message import ReportMessage, DeliveryResult, MessageType
import logging

logger = logging.getLogger(__name__)


class TelegramAdapter(ChannelAdapter):
    """
    Telegram Bot API 适配器。

    支持：
    - MarkdownV2 格式化
    - 富卡片（通过 InlineKeyboard）
    - 文件附件
    - 长消息自动拆分
    """

    API_BASE = "https://api.telegram.org/bot{token}"

    def __init__(self, config: dict):
        super().__init__("telegram", config)
        self.token = config['bot_token']
        self.chat_id = config['chat_id']
        self.api_base = self.API_BASE.format(token=self.token)
        self.max_message_length = 4096

    def format_message(self, message: ReportMessage) -> dict:
        """转换为 Telegram MarkdownV2 格式"""
        text = message.content

        # Telegram MarkdownV2 特殊字符转义
        escape_chars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']
        for char in escape_chars:
            text = text.replace(char, f'\\{char}')

        # 保留 Markdown 格式标记
        text = text.replace('\\*\\*', '**')  # 恢复粗体
        text = text.replace('\\`\\`\\`', '```')  # 恢复代码块

        payload = {
            'chat_id': self.chat_id,
            'text': text,
            'parse_mode': 'MarkdownV2',
            'disable_web_page_preview': True,
        }

        # 如果有 rich card，添加 InlineKeyboard
        if message.rich_card and message.rich_card.actions:
            inline_keyboard = []
            row = []
            for action in message.rich_card.actions:
                row.append({
                    'text': action.get('label', 'Click'),
                    'url': action.get('url', ''),
                })
                if len(row) >= 2:
                    inline_keyboard.append(row)
                    row = []
            if row:
                inline_keyboard.append(row)
            payload['reply_markup'] = json.dumps({
                'inline_keyboard': inline_keyboard
            })

        return payload

    async def send(self, message: ReportMessage) -> DeliveryResult:
        """发送消息到 Telegram"""
        import time
        start = time.time()

        # 检查消息长度，必要时拆分
        chunks = self._split_message(message.content)

        try:
            last_message_id = None
            async with aiohttp.ClientSession() as session:
                for i, chunk in enumerate(chunks):
                    chunk_msg = ReportMessage(
                        content=chunk,
                        title=message.title if i == 0 else f"{message.title} (续 {i + 1})",
                        message_type=message.message_type,
                    )
                    payload = self.format_message(chunk_msg)

                    async with session.post(
                        f"{self.api_base}/sendMessage",
                        data=payload,
                        timeout=aiohttp.ClientTimeout(total=30),
                    ) as resp:
                        if resp.status != 200:
                            error_text = await resp.text()
                            return DeliveryResult(
                                channel="telegram",
                                success=False,
                                error=f"HTTP {resp.status}: {error_text[:200]}",
                                latency_ms=(time.time() - start) * 1000,
                            )
                        result = await resp.json()
                        last_message_id = result.get('result', {}).get('message_id')

            return DeliveryResult(
                channel="telegram",
                success=True,
                message_id=str(last_message_id),
                latency_ms=(time.time() - start) * 1000,
            )

        except Exception as e:
            return DeliveryResult(
                channel="telegram",
                success=False,
                error=str(e),
                latency_ms=(time.time() - start) * 1000,
            )

    def _split_message(self, text: str) -> list:
        """拆分超过长度限制的消息"""
        if len(text) <= self.max_message_length:
            return [text]

        chunks = []
        current = ""
        for line in text.split('\n'):
            if len(current) + len(line) + 1 > self.max_message_length - 50:
                chunks.append(current)
                current = line
            else:
                current += ('\n' + line if current else line)
        if current:
            chunks.append(current)
        return chunks

    async def send_file(self, file_path: str, caption: str = "") -> DeliveryResult:
        """发送文件到 Telegram"""
        import time
        start = time.time()

        try:
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field('chat_id', self.chat_id)
                if caption:
                    data.add_field('caption', caption[:1024])
                data.add_field(
                    'document',
                    open(file_path, 'rb'),
                    filename=file_path.split('/')[-1],
                )

                async with session.post(
                    f"{self.api_base}/sendDocument",
                    data=data,
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as resp:
                    if resp.status == 200:
                        return DeliveryResult(
                            channel="telegram",
                            success=True,
                            latency_ms=(time.time() - start) * 1000,
                        )
                    else:
                        error = await resp.text()
                        return DeliveryResult(
                            channel="telegram",
                            success=False,
                            error=error[:200],
                            latency_ms=(time.time() - start) * 1000,
                        )
        except Exception as e:
            return DeliveryResult(
                channel="telegram",
                success=False,
                error=str(e),
                latency_ms=(time.time() - start) * 1000,
            )
```

### 2.3 Slack Webhook 适配器

```python
# openclaw/channels/slack.py
import aiohttp
import json
from .base import ChannelAdapter
from .message import ReportMessage, DeliveryResult, MessageType, RichCard
import logging
import time

logger = logging.getLogger(__name__)


class SlackAdapter(ChannelAdapter):
    """
    Slack Incoming Webhook 适配器。

    支持：
    - Block Kit 消息格式
    - mrkdwn 格式化（Slack 特有的 Markdown 方言）
    - 附件与文件上传
    - 线程回复
    """

    def __init__(self, config: dict):
        super().__init__("slack", config)
        self.webhook_url = config['webhook_url']
        self.default_channel = config.get('channel', '#general')
        self.bot_token = config.get('bot_token', '')  # 用于文件上传等高级功能

    def format_message(self, message: ReportMessage) -> dict:
        """转换为 Slack Block Kit 格式"""
        blocks = []

        # 标题块
        if message.title:
            blocks.append({
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": message.title,
                    "emoji": True,
                }
            })

        # 分隔线
        if message.title:
            blocks.append({"type": "divider"})

        # 主内容块
        # Slack mrkdwn 与标准 Markdown 有差异
        mrkdwn_content = self._to_mrkdwn(message.content)

        # Slack 单个文本块最大 3000 字符
        for chunk in self._split_content(mrkdwn_content, 2900):
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": chunk,
                }
            })

        # 如果有 rich card，添加字段
        if message.rich_card and message.rich_card.fields:
            fields = []
            for field in message.rich_card.fields[:10]:  # Slack 限制最多 10 个字段
                fields.append({
                    "type": "mrkdwn",
                    "text": f"*{field['label']}*\n{field['value']}",
                })
            blocks.append({
                "type": "section",
                "fields": fields,
            })

        # 操作按钮
        if message.rich_card and message.rich_card.actions:
            elements = []
            for action in message.rich_card.actions[:5]:
                elements.append({
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": action.get('label', 'Click'),
                    },
                    "url": action.get('url', ''),
                    "style": action.get('style', 'primary'),
                })
            blocks.append({
                "type": "actions",
                "elements": elements,
            })

        # 时间戳和标签
        context_elements = []
        if message.tags:
            context_elements.append({
                "type": "mrkdwn",
                "text": " ".join(f"`{tag}`" for tag in message.tags),
            })
        context_elements.append({
            "type": "mrkdwn",
            "text": f"📅 {message.timestamp.strftime('%Y-%m-%d %H:%M:%S')}",
        })
        blocks.append({
            "type": "context",
            "elements": context_elements,
        })

        payload = {
            "channel": self.default_channel,
            "username": "OpenClaw Agent",
            "icon_emoji": ":robot_face:",
            "blocks": blocks,
        }

        return payload

    def _to_mrkdwn(self, text: str) -> str:
        """将标准 Markdown 转换为 Slack mrkdwn 格式"""
        # 标题转换
        text = text.replace('### ', '*')
        text = text.replace('## ', '*')
        text = text.replace('# ', '*')
        # 代码块保持不变
        # 链接格式: [text](url) -> <url|text>
        import re
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<\2|\1>', text)
        # 粗体保持 **text** -> *text*（Slack 使用单星号）
        text = text.replace('**', '*')
        return text

    def _split_content(self, text: str, max_len: int) -> list:
        """拆分超长内容"""
        if len(text) <= max_len:
            return [text]
        chunks = []
        current = ""
        for line in text.split('\n'):
            if len(current) + len(line) + 1 > max_len:
                chunks.append(current)
                current = line
            else:
                current += ('\n' + line if current else line)
        if current:
            chunks.append(current)
        return chunks

    async def send(self, message: ReportMessage) -> DeliveryResult:
        """发送消息到 Slack"""
        start = time.time()
        payload = self.format_message(message)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.webhook_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    latency = (time.time() - start) * 1000
                    if resp.status == 200:
                        return DeliveryResult(
                            channel="slack",
                            success=True,
                            latency_ms=latency,
                        )
                    else:
                        error_text = await resp.text()
                        return DeliveryResult(
                            channel="slack",
                            success=False,
                            error=f"HTTP {resp.status}: {error_text[:200]}",
                            latency_ms=latency,
                        )
        except Exception as e:
            return DeliveryResult(
                channel="slack",
                success=False,
                error=str(e),
                latency_ms=(time.time() - start) * 1000,
            )
```

### 2.4 飞书 Open API 适配器

```python
# openclaw/channels/feishu.py
import aiohttp
import json
import time
from .base import ChannelAdapter
from .message import ReportMessage, DeliveryResult
import logging

logger = logging.getLogger(__name__)


class FeishuAdapter(ChannelAdapter):
    """
    飞书 Open API 适配器。

    支持：
    - 富文本消息（post 格式）
    - 交互式卡片消息
    - Webhook 和 Bot 两种模式
    - 自动获取 tenant_access_token
    """

    TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    MESSAGE_URL = "https://open.feishu.cn/open-apis/im/v1/messages"

    def __init__(self, config: dict):
        super().__init__("feishu", config)
        self.app_id = config.get('app_id', '')
        self.app_secret = config.get('app_secret', '')
        self.chat_id = config.get('chat_id', '')
        self.webhook_url = config.get('webhook_url', '')
        self._token = None
        self._token_expire = 0

    async def _get_token(self) -> str:
        """获取 tenant_access_token"""
        if self._token and time.time() < self._token_expire:
            return self._token

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.TOKEN_URL,
                json={
                    "app_id": self.app_id,
                    "app_secret": self.app_secret,
                },
            ) as resp:
                data = await resp.json()
                if data.get('code') == 0:
                    self._token = data['tenant_access_token']
                    self._token_expire = time.time() + data.get('expire', 7200) - 300
                    return self._token
                else:
                    raise Exception(f"Failed to get Feishu token: {data}")

    def format_message(self, message: ReportMessage) -> dict:
        """转换为飞书消息格式"""
        if self.webhook_url:
            # Webhook 模式：使用富文本
            return self._format_webhook(message)
        else:
            # Bot API 模式：使用交互式卡片
            return self._format_card(message)

    def _format_webhook(self, message: ReportMessage) -> dict:
        """Webhook 消息格式"""
        # 飞书 Webhook 支持 text/post/interactive 三种类型
        content_lines = message.content.split('\n')
        post_content = []

        for line in content_lines:
            if line.startswith('# '):
                post_content.append([{"tag": "text", "text": line[2:], "style": ["bold"]}])
            elif line.startswith('## '):
                post_content.append([{"tag": "text", "text": line[3:], "style": ["bold"]}])
            elif line.startswith('```'):
                continue  # 代码块标记，简化处理
            elif line.strip():
                # 解析行内格式
                elements = self._parse_inline(line)
                post_content.append(elements)

        return {
            "msg_type": "post",
            "content": {
                "post": {
                    "zh_cn": {
                        "title": message.title,
                        "content": post_content,
                    }
                }
            }
        }

    def _format_card(self, message: ReportMessage) -> dict:
        """交互式卡片格式"""
        elements = []

        # 内容
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": message.content[:2000],  # 飞书卡片内容限制
            }
        })

        # 如果有 rich card 字段
        if message.rich_card and message.rich_card.fields:
            elements.append({"tag": "hr"})
            fields_content = ""
            for f in message.rich_card.fields:
                fields_content += f"**{f['label']}**: {f['value']}\n"
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": fields_content,
                }
            })

        # 操作按钮
        if message.rich_card and message.rich_card.actions:
            elements.append({"tag": "hr"})
            actions = []
            for action in message.rich_card.actions:
                actions.append({
                    "tag": "button",
                    "text": {
                        "tag": "plain_text",
                        "content": action.get('label', '查看'),
                    },
                    "url": action.get('url', ''),
                    "type": "primary",
                })
            elements.append({
                "tag": "action",
                "actions": actions,
            })

        card = {
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": {
                        "tag": "plain_text",
                        "content": message.title,
                    },
                    "template": "blue",
                },
                "elements": elements,
            }
        }

        return card

    def _parse_inline(self, text: str) -> list:
        """解析行内格式"""
        import re
        elements = []
        # 简单的粗体解析
        parts = re.split(r'(\*\*[^*]+\*\*)', text)
        for part in parts:
            if part.startswith('**') and part.endswith('**'):
                elements.append({
                    "tag": "text",
                    "text": part[2:-2],
                    "style": ["bold"],
                })
            elif part:
                elements.append({"tag": "text", "text": part})
        return elements

    async def send(self, message: ReportMessage) -> DeliveryResult:
        """发送消息到飞书"""
        start = time.time()

        try:
            if self.webhook_url:
                return await self._send_webhook(message, start)
            else:
                return await self._send_bot(message, start)
        except Exception as e:
            return DeliveryResult(
                channel="feishu",
                success=False,
                error=str(e),
                latency_ms=(time.time() - start) * 1000,
            )

    async def _send_webhook(self, message: ReportMessage, start: float) -> DeliveryResult:
        """通过 Webhook 发送"""
        payload = self.format_message(message)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.webhook_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                latency = (time.time() - start) * 1000

                if result.get('code') == 0 or result.get('StatusCode') == 0:
                    return DeliveryResult(
                        channel="feishu",
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    return DeliveryResult(
                        channel="feishu",
                        success=False,
                        error=result.get('msg', str(result)),
                        latency_ms=latency,
                    )

    async def _send_bot(self, message: ReportMessage, start: float) -> DeliveryResult:
        """通过 Bot API 发送"""
        token = await self._get_token()
        payload = self.format_message(message)
        payload['receive_id'] = self.chat_id

        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json; charset=utf-8',
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.MESSAGE_URL}?receive_id_type=chat_id",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                latency = (time.time() - start) * 1000

                if result.get('code') == 0:
                    msg_id = result.get('data', {}).get('message_id', '')
                    return DeliveryResult(
                        channel="feishu",
                        success=True,
                        message_id=msg_id,
                        latency_ms=latency,
                    )
                else:
                    return DeliveryResult(
                        channel="feishu",
                        success=False,
                        error=result.get('msg', str(result)),
                        latency_ms=latency,
                    )
```

### 2.5 QQ 频道机器人适配器

```python
# openclaw/channels/qq.py
import aiohttp
import json
import time
from .base import ChannelAdapter
from .message import ReportMessage, DeliveryResult
import logging

logger = logging.getLogger(__name__)


class QQBotAdapter(ChannelAdapter):
    """
    QQ 频道机器人适配器。

    使用 QQ 开放平台 API 实现消息推送。
    支持：
    - 文本消息
    - Markdown 消息（QQ 频道支持）
    - 富文本消息
    - @成员
    """

    BASE_URL = "https://api.sgroup.qq.com"

    def __init__(self, config: dict):
        super().__init__("qq", config)
        self.app_id = config['app_id']
        self.app_secret = config['app_secret']
        self.channel_id = config['channel_id']
        self.guild_id = config.get('guild_id', '')
        self._token = None
        self._token_expire = 0

    async def _get_token(self) -> str:
        """获取 Bot Access Token"""
        if self._token and time.time() < self._token_expire:
            return self._token

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://bots.qq.com/app/getAppAccessToken",
                json={
                    "appId": self.app_id,
                    "clientSecret": self.app_secret,
                },
            ) as resp:
                data = await resp.json()
                self._token = data.get('access_token', '')
                self._token_expire = time.time() + int(data.get('expires_in', 7200)) - 300
                return self._token

    def format_message(self, message: ReportMessage) -> dict:
        """转换为 QQ 消息格式"""
        # QQ 频道支持 Markdown 消息
        content = message.content

        # QQ Markdown 与标准 Markdown 略有差异
        # 标题
        if message.title:
            content = f"# {message.title}\n\n{content}"

        # 截断超长消息
        if len(content) > 2000:
            content = content[:1950] + "\n\n... (内容过长，已截断)"

        return {
            "content": content,
            "msg_type": 0,  # 0=文本, 2=Markdown, 3=Ark, 4=Embed, 7=富媒体
        }

    async def send(self, message: ReportMessage) -> DeliveryResult:
        """发送消息到 QQ 频道"""
        start = time.time()
        token = await self._get_token()

        payload = self.format_message(message)
        headers = {
            'Authorization': f'Bot {self.app_id}.{token}',
            'Content-Type': 'application/json',
        }

        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.BASE_URL}/channels/{self.channel_id}/messages"
                async with session.post(
                    url,
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    latency = (time.time() - start) * 1000
                    if resp.status in (200, 201):
                        result = await resp.json()
                        return DeliveryResult(
                            channel="qq",
                            success=True,
                            message_id=result.get('id', ''),
                            latency_ms=latency,
                        )
                    else:
                        error_text = await resp.text()
                        return DeliveryResult(
                            channel="qq",
                            success=False,
                            error=f"HTTP {resp.status}: {error_text[:200]}",
                            latency_ms=latency,
                        )
        except Exception as e:
            return DeliveryResult(
                channel="qq",
                success=False,
                error=str(e),
                latency_ms=(time.time() - start) * 1000,
            )
```

### 2.6 企业微信适配器

```python
# openclaw/channels/wechat.py
import aiohttp
import json
import time
import hashlib
from .base import ChannelAdapter
from .message import ReportMessage, DeliveryResult
import logging

logger = logging.getLogger(__name__)


class WeChatWorkAdapter(ChannelAdapter):
    """
    企业微信适配器。

    支持：
    - 群机器人 Webhook
    - 应用消息推送
    - Markdown 消息格式
    - 文本卡片消息
    """

    TOKEN_URL = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
    MESSAGE_URL = "https://qyapi.weixin.qq.com/cgi-bin/message/send"

    def __init__(self, config: dict):
        super().__init__("wechat", config)
        self.corp_id = config.get('corp_id', '')
        self.agent_id = config.get('agent_id', '')
        self.corp_secret = config.get('corp_secret', '')
        self.webhook_url = config.get('webhook_url', '')
        self.to_user = config.get('to_user', '@all')
        self._token = None
        self._token_expire = 0

    async def _get_token(self) -> str:
        """获取 access_token"""
        if self._token and time.time() < self._token_expire:
            return self._token

        async with aiohttp.ClientSession() as session:
            async with session.get(
                self.TOKEN_URL,
                params={
                    "corpid": self.corp_id,
                    "corpsecret": self.corp_secret,
                },
            ) as resp:
                data = await resp.json()
                if data.get('errcode') == 0:
                    self._token = data['access_token']
                    self._token_expire = time.time() + data.get('expires_in', 7200) - 300
                    return self._token
                else:
                    raise Exception(f"WeChat token error: {data}")

    def format_message(self, message: ReportMessage) -> dict:
        """转换为企业微信消息格式"""
        if self.webhook_url:
            return self._format_webhook(message)
        return self._format_app_message(message)

    def _format_webhook(self, message: ReportMessage) -> dict:
        """Webhook 消息格式（Markdown）"""
        content = message.content

        # 企业微信 Markdown 支持有限
        # 支持：标题(#)、粗体、链接、引用、代码
        # 不支持：图片、表格、有序列表
        if message.title:
            content = f"# {message.title}\n{content}"

        # 截断
        if len(content) > 4096:
            content = content[:4000] + "\n\n... (内容截断)"

        return {
            "msgtype": "markdown",
            "markdown": {
                "content": content,
            }
        }

    def _format_app_message(self, message: ReportMessage) -> dict:
        """应用消息格式"""
        # 使用文本卡片格式
        if message.rich_card:
            return {
                "touser": self.to_user,
                "msgtype": "textcard",
                "agentid": self.agent_id,
                "textcard": {
                    "title": message.title,
                    "description": message.content[:512],
                    "url": message.rich_card.actions[0].get('url', '') if message.rich_card.actions else '',
                    "btntxt": message.rich_card.actions[0].get('label', '详情') if message.rich_card.actions else '详情',
                }
            }
        else:
            # 纯文本
            content = message.content
            if len(content) > 2048:
                content = content[:2000] + "... (截断)"
            return {
                "touser": self.to_user,
                "msgtype": "markdown",
                "agentid": self.agent_id,
                "markdown": {
                    "content": f"## {message.title}\n{content}" if message.title else content,
                }
            }

    async def send(self, message: ReportMessage) -> DeliveryResult:
        """发送消息到企业微信"""
        start = time.time()

        try:
            if self.webhook_url:
                return await self._send_webhook(message, start)
            else:
                return await self._send_app(message, start)
        except Exception as e:
            return DeliveryResult(
                channel="wechat",
                success=False,
                error=str(e),
                latency_ms=(time.time() - start) * 1000,
            )

    async def _send_webhook(self, message: ReportMessage, start: float) -> DeliveryResult:
        """通过 Webhook 发送"""
        payload = self.format_message(message)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.webhook_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                latency = (time.time() - start) * 1000

                if result.get('errcode') == 0:
                    return DeliveryResult(
                        channel="wechat",
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    return DeliveryResult(
                        channel="wechat",
                        success=False,
                        error=result.get('errmsg', str(result)),
                        latency_ms=latency,
                    )

    async def _send_app(self, message: ReportMessage, start: float) -> DeliveryResult:
        """通过应用消息发送"""
        token = await self._get_token()
        payload = self.format_message(message)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.MESSAGE_URL}?access_token={token}",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                latency = (time.time() - start) * 1000

                if result.get('errcode') == 0:
                    return DeliveryResult(
                        channel="wechat",
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    return DeliveryResult(
                        channel="wechat",
                        success=False,
                        error=result.get('errmsg', str(result)),
                        latency_ms=latency,
                    )
```

## 三、Channel Router：统一分发引擎

### 3.1 路由与并发分发

```python
# openclaw/channels/router.py
import asyncio
from typing import Dict, List, Optional
from .base import ChannelAdapter
from .message import ReportMessage, DeliveryResult
import logging
import time

logger = logging.getLogger(__name__)


class ChannelRouter:
    """
    通道路由器：负责将消息分发到指定的通道。

    功能：
    1. 注册和管理多个通道适配器
    2. 并发分发到多个通道
    3. 失败重试与降级
    4. 分发结果汇总
    """

    def __init__(self):
        self.channels: Dict[str, ChannelAdapter] = {}

    def register(self, name: str, adapter: ChannelAdapter):
        """注册通道适配器"""
        self.channels[name] = adapter
        logger.info(f"Registered channel: {name} (enabled={adapter.enabled})")

    async def dispatch(self, message: ReportMessage) -> List[DeliveryResult]:
        """
        将消息分发到目标通道。

        如果 message.target_channels 为空，则发往所有已启用的通道。
        """
        target_names = message.target_channels or [
            name for name, adapter in self.channels.items() if adapter.enabled
        ]

        tasks = []
        for name in target_names:
            adapter = self.channels.get(name)
            if adapter and adapter.enabled:
                tasks.append(adapter.send_with_retry(message))
            else:
                logger.warning(f"Channel {name} not found or disabled, skipping")

        if not tasks:
            logger.warning("No target channels available")
            return []

        results = await asyncio.gather(*tasks, return_exceptions=True)

        delivery_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                delivery_results.append(DeliveryResult(
                    channel=target_names[i] if i < len(target_names) else "unknown",
                    success=False,
                    error=str(result),
                ))
            else:
                delivery_results.append(result)

        # 日志汇总
        success_count = sum(1 for r in delivery_results if r.success)
        total_count = len(delivery_results)
        logger.info(
            f"Dispatch complete: {success_count}/{total_count} channels succeeded. "
            f"Channels: {', '.join(r.channel for r in delivery_results)}"
        )

        return delivery_results

    async def dispatch_to_single(
        self,
        channel_name: str,
        message: ReportMessage,
    ) -> DeliveryResult:
        """发送到单个通道"""
        adapter = self.channels.get(channel_name)
        if not adapter:
            return DeliveryResult(
                channel=channel_name,
                success=False,
                error=f"Channel {channel_name} not registered",
            )
        if not adapter.enabled:
            return DeliveryResult(
                channel=channel_name,
                success=False,
                error=f"Channel {channel_name} is disabled",
            )
        return await adapter.send_with_retry(message)
```

## 四、daily-report.py 完整实现

### 4.1 报告生成与分发

```python
# daily-report.py
#!/usr/bin/env python3
"""
OpenClaw Daily Report 生成与多通道分发脚本。

功能：
1. 从 OpenClaw 记忆系统提取关键信息
2. 生成结构化的日报
3. 并行分发到 Telegram/Slack/飞书/QQ/微信
"""

import asyncio
import os
import yaml
import logging
from datetime import datetime
from pathlib import Path

from openclaw.channels.router import ChannelRouter
from openclaw.channels.message import ReportMessage, RichCard, MessagePriority
from openclaw.channels.telegram import TelegramAdapter
from openclaw.channels.slack import SlackAdapter
from openclaw.channels.feishu import FeishuAdapter
from openclaw.channels.qq import QQBotAdapter
from openclaw.channels.wechat import WeChatWorkAdapter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DailyReportGenerator:
    """日报生成器"""

    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        self.router = self._setup_channels()

    def _setup_channels(self) -> ChannelRouter:
        """初始化所有通道"""
        router = ChannelRouter()
        channel_config = self.config.get('channels', {})

        if 'telegram' in channel_config and channel_config['telegram'].get('enabled'):
            router.register('telegram', TelegramAdapter(channel_config['telegram']))

        if 'slack' in channel_config and channel_config['slack'].get('enabled'):
            router.register('slack', SlackAdapter(channel_config['slack']))

        if 'feishu' in channel_config and channel_config['feishu'].get('enabled'):
            router.register('feishu', FeishuAdapter(channel_config['feishu']))

        if 'qq' in channel_config and channel_config['qq'].get('enabled'):
            router.register('qq', QQBotAdapter(channel_config['qq']))

        if 'wechat' in channel_config and channel_config['wechat'].get('enabled'):
            router.register('wechat', WeChatWorkAdapter(channel_config['wechat']))

        return router

    def generate_report(self) -> ReportMessage:
        """生成日报内容"""
        today = datetime.now().strftime('%Y-%m-%d')

        # 这里从 OpenClaw 记忆系统获取数据
        # 实际实现中会读取 MEMORY.md、heartbeat-state.json 等
        content = self._build_report_content()

        rich_card = RichCard(
            title=f"OpenClaw 日报 - {today}",
            subtitle="AI Agent 每日状态摘要",
            fields=[
                {"label": "今日处理任务", "value": "42"},
                {"label": "活跃连接数", "value": "15"},
                {"label": "错误率", "value": "0.3%"},
                {"label": "Token 消耗", "value": "128K"},
            ],
            actions=[
                {"label": "查看详情", "url": "https://dashboard.openclaw.dev"},
                {"label": "历史记录", "url": "https://dashboard.openclaw.dev/history"},
            ],
        )

        return ReportMessage(
            title=f"🤖 OpenClaw 日报 — {today}",
            content=content,
            priority=MessagePriority.NORMAL,
            rich_card=rich_card,
            tags=["daily-report", "openclaw"],
        )

    def _build_report_content(self) -> str:
        """构建报告正文"""
        return """
## 📊 今日概览

- **处理任务**: 42 个
- **成功率**: 99.7%
- **平均响应时间**: 1.2s
- **Token 消耗**: 128,450

## 🔍 关键事件

1. **新技能激活**: `code-review` 技能已上线
2. **模型切换**: 主模型从 GPT-4o 迁移到 DeepSeek-V3（成本降低 60%）
3. **性能优化**: 缓存命中率提升至 85%

## ⚠️ 告警摘要

- 14:32 — Slack 连接超时，已自动重连
- 16:45 — 月度预算已使用 72%，建议关注

## 📈 明日计划

- 更新 `memory-consolidation` 技能
- 完成 OpenClaw v2.3 的 fallback chain 优化
- 整理本周所有 learnings 到 MEMORY.md
"""

    async def run(self, target_channels: list = None):
        """执行报告生成与分发"""
        report = self.generate_report()
        if target_channels:
            report.target_channels = target_channels

        logger.info(f"Dispatching report to channels: {report.target_channels or 'all'}")
        results = await self.router.dispatch(report)

        for result in results:
            status = "✅" if result.success else "❌"
            logger.info(
                f"{status} {result.channel}: "
                f"{'OK' if result.success else result.error} "
                f"({result.latency_ms:.0f}ms, retries={result.retry_count})"
            )

        return results


async def main():
    config_path = os.environ.get('OPENCLAW_CONFIG', 'config/channels.yaml')
    generator = DailyReportGenerator(config_path)
    await generator.run()


if __name__ == '__main__':
    asyncio.run(main())
```

### 4.2 通道配置文件

```yaml
# config/channels.yaml
channels:
  telegram:
    enabled: true
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    chat_id: "${TELEGRAM_CHAT_ID}"
    max_retries: 3
    retry_delay: 2.0

  slack:
    enabled: true
    webhook_url: "${SLACK_WEBHOOK_URL}"
    channel: "#openclaw-daily"
    bot_token: "${SLACK_BOT_TOKEN}"
    max_retries: 3

  feishu:
    enabled: true
    app_id: "${FEISHU_APP_ID}"
    app_secret: "${FEISHU_APP_SECRET}"
    chat_id: "${FEISHU_CHAT_ID}"
    # 或使用 webhook
    # webhook_url: "${FEISHU_WEBHOOK_URL}"
    max_retries: 3

  qq:
    enabled: false
    app_id: "${QQ_APP_ID}"
    app_secret: "${QQ_APP_SECRET}"
    channel_id: "${QQ_CHANNEL_ID}"
    guild_id: "${QQ_GUILD_ID}"
    max_retries: 3

  wechat:
    enabled: true
    # 企业微信群机器人（推荐）
    webhook_url: "${WECHAT_WORK_WEBHOOK}"
    # 或使用应用消息
    # corp_id: "${WECHAT_CORP_ID}"
    # agent_id: "${WECHAT_AGENT_ID}"
    # corp_secret: "${WECHAT_CORP_SECRET}"
    max_retries: 3
```

## 五、平台格式适配的难点与解决方案

### 5.1 Markdown 方言差异

不同平台对 Markdown 的支持程度差异巨大：

| 特性 | Telegram | Slack | 飞书 | QQ | 企业微信 |
|------|----------|-------|------|-----|---------|
| 粗体 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 斜体 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 代码块 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 表格 | ❌ | ❌ | ✅ | ❌ | ❌ |
| 图片 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 链接 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 列表 | ✅ | ✅ | ✅ | 部分 | 部分 |
| 引用 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 最大长度 | 4096 | 无限* | 2000 | 2000 | 4096 |

**解决方案**：在统一消息模型中保留原始 Markdown，在各适配器中做降级处理——不支持的格式自动转换为纯文本或最接近的替代格式。

### 5.2 限流处理

各平台都有 API 调用频率限制：

- **Telegram**: 同一 chat_id 每秒最多 1 条消息，群组每分钟 20 条
- **Slack**: Webhook 每秒 1 条，Burst 最多 5 条
- **飞书**: 应用消息每分钟 100 条
- **QQ**: 频道消息每分钟 5 条
- **企业微信**: 应用消息每分钟 200 条

**解决方案**：在 ChannelAdapter 基类中实现令牌桶限流：

```python
class RateLimitedAdapter(ChannelAdapter):
    """带限流的适配器基类"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.rate_limit = config.get('rate_limit', 1)  # 每秒请求数
        self._tokens = self.rate_limit
        self._last_refill = time.time()
        self._lock = asyncio.Lock()

    async def _acquire_token(self):
        """令牌桶限流"""
        async with self._lock:
            now = time.time()
            elapsed = now - self._last_refill
            self._tokens = min(
                self.rate_limit,
                self._tokens + elapsed * self.rate_limit,
            )
            self._last_refill = now

            if self._tokens < 1:
                wait_time = (1 - self._tokens) / self.rate_limit
                await asyncio.sleep(wait_time)
                self._tokens = 0
            else:
                self._tokens -= 1
```

## 六、总结

OpenClaw 的多平台分发架构通过统一消息模型、通道适配器模式和并发分发引擎三层抽象，实现了"一次生成，五通道分发"的设计目标。每个平台的格式差异和 API 限制都被封装在各自的适配器中，对上层业务完全透明。

关键设计要点：
1. **统一消息模型**：ReportMessage 是跨平台的通用载体
2. **适配器模式**：每个平台一个 Adapter，独立处理格式转换和 API 调用
3. **并发分发**：asyncio.gather 实现真正的并行推送
4. **重试与降级**：指数退避重试 + 失败告警
5. **限流保护**：令牌桶算法避免触发平台限流

这套架构不仅适用于 daily-report 场景，任何需要多平台消息推送的 AI Agent 系统都可以复用这个模式。

## 七、常见踩坑案例

### 7.1 Telegram MarkdownV2 转义地狱

Telegram 的 MarkdownV2 格式要求对 `_`、`*`、`[`、`]`、`(`、`)`、`~`、`` ` ``、`>`、`#`、`+`、`-`、`=`、`|`、`{`、`}`、`.`、`!` 等字符进行转义。在实际使用中，最常见的错误是忘记转义消息正文中的 `.` 和 `!`，导致 API 返回 400 Bad Request。建议在适配器中实现一个 `_escape_markdownv2` 方法，对非格式标记的特殊字符统一转义。

### 7.2 飞书 Token 过期静默失败

飞书的 `tenant_access_token` 有效期为 2 小时。如果 Token 缓存逻辑不完善（例如只缓存 token 不检查过期时间），会在运行一段时间后突然发送失败。建议在 `_get_token` 中使用 `expire` 字段设置过期时间，并预留 5 分钟的安全余量。

### 7.3 企业微信 Webhook 频率限制

企业微信群机器人 Webhook 的频率限制为每分钟 20 条。当日报内容较长被拆分为多条消息时，如果发送间隔过短会触发限流返回错误码 45009。建议在拆分消息后加入 3-5 秒的发送间隔。

## 相关阅读

- [OpenClaw 群聊行为准则：HEARTBEAT_OK 静默策略、反应礼仪、平台格式适配](/categories/AI%20Agent/OpenClaw-群聊行为准则-HEARTBEAT-OK-静默策略-反应礼仪-平台格式适配/)
- [OpenClaw Discord 实战：多频道 AI 助手与社区管理](/categories/架构/OpenClaw-Discord-实战-多频道-AI-助手与社区管理/)
- [OpenClaw WhatsApp 实战：跨平台消息集成与自动化](/categories/架构/OpenClaw-WhatsApp-实战-跨平台消息集成与自动化/)
