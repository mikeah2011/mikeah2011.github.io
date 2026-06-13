---
title: OpenHuman 源适配器架构：Gmail/Slack/GitHub 数据摄入 → 规范化 → 分块 → 记忆树的完整管道
date: 2026-06-02 00:00:00
tags: [OpenHuman, 数据管道, Gmail, Slack, GitHub, AI Agent, 记忆系统]
keywords: [OpenHuman, Gmail, Slack, GitHub, 源适配器架构, 数据摄入, 规范化, 分块, 记忆树的完整管道, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: "深入剖析 OpenHuman 源适配器架构的完整数据管道：从 Gmail、Slack、GitHub 等异构数据源摄入、格式规范化、智能分块到记忆树构建的全流程。详解适配器模式设计、规范化抽象层、增量同步策略与并发控制机制，附带各数据源适配器能力对比表格和 Python/TypeScript 代码示例。涵盖 OAuth2 认证、Webhook 实时同步、断点续传等生产级实践，帮助开发者为 AI Agent 构建多源数据整合能力。"
---


# OpenHuman 源适配器架构：Gmail/Slack/GitHub 数据摄入 → 规范化 → 分块 → 记忆树的完整管道

## 前言

AI Agent 的记忆质量直接取决于数据摄入的质量。一个只从对话中学习的 Agent，其记忆永远是片面的。真实的用户上下文散布在多个平台：Gmail 中的邮件往来、Slack 中的团队讨论、GitHub 中的代码审查和 Issue。OpenHuman 的源适配器（Source Adapter）架构正是为了解决这个问题——**从多个异构数据源中摄入、规范化、分块并最终构建统一的记忆树**。

本文将深入剖析 OpenHuman 的源适配器管道架构，涵盖数据摄入、格式规范化、智能分块和记忆树构建的完整流程。

## 一、管道架构总览

### 1.1 数据流向

```
┌─────────────────────────────────────────────────────────────────┐
│                     Source Adapters (数据摄入层)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Gmail   │  │  Slack   │  │  GitHub  │  │  本地文件     │   │
│  │  Adapter │  │  Adapter │  │  Adapter │  │  Adapter     │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │             │             │               │            │
└───────┼─────────────┼─────────────┼───────────────┼────────────┘
        │             │             │               │
        ▼             ▼             ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Normalizer (规范化层)                          │
│  原始格式 → 统一 Document 对象（title, body, metadata, chunks）  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Chunker (分块层)                               │
│  长文档 → 智能分块（语义分块、固定大小、段落感知）                    │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Memory Tree Builder (记忆树构建层)                │
│  Chunks → 实体提取 → 关系构建 → 主题聚类 → 摘要生成              │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Memory Store (存储层)                          │
│  向量索引 + 实体图 + 全文索引 + 元数据索引                         │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心数据模型

```python
# openhuman/pipeline/models.py
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum
import hashlib


class SourceType(Enum):
    """数据源类型"""
    GMAIL = "gmail"
    SLACK = "slack"
    GITHUB = "github"
    LOCAL_FILE = "local_file"
    CONVERSATION = "conversation"
    WEB = "web"


@dataclass
class RawDocument:
    """原始文档：从数据源摄入的未处理数据"""
    source_type: SourceType
    source_id: str               # 源中的唯一 ID（如 email ID, message_ts）
    raw_content: str             # 原始内容
    raw_metadata: Dict[str, Any] = field(default_factory=dict)
    fetched_at: datetime = field(default_factory=datetime.now)


@dataclass
class NormalizedDocument:
    """规范化文档：统一格式后的文档"""
    doc_id: str                  # 全局唯一 ID
    source_type: SourceType
    source_id: str
    title: str
    body: str
    author: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)
    links: List[str] = field(default_factory=list)  # 提取的链接/引用
    content_hash: str = ""

    def __post_init__(self):
        if not self.content_hash:
            self.content_hash = hashlib.sha256(
                (self.title + self.body).encode()
            ).hexdigest()[:16]


@dataclass
class Chunk:
    """文档分块"""
    chunk_id: str
    doc_id: str                  # 所属文档 ID
    content: str                 # 分块内容
    index: int                   # 在文档中的序号
    start_offset: int = 0       # 起始字符偏移
    end_offset: int = 0         # 结束字符偏移
    metadata: Dict[str, Any] = field(default_factory=dict)
    embedding: Optional[List[float]] = None  # 向量嵌入


@dataclass
class Entity:
    """提取的实体"""
    entity_id: str
    entity_type: str             # person, project, topic, concept
    name: str
    aliases: List[str] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)
    source_chunks: List[str] = field(default_factory=list)  # 来源 chunk IDs
    mentions: int = 0


@dataclass
class Relation:
    """实体关系"""
    source_entity_id: str
    target_entity_id: str
    relation_type: str           # works_on, knows, uses, related_to
    confidence: float = 1.0
    evidence_chunks: List[str] = field(default_factory=list)
```

## 二、数据摄入层：Source Adapter

### 2.1 适配器基类

```python
# openhuman/pipeline/adapters/base.py
from abc import ABC, abstractmethod
from typing import List, AsyncIterator, Optional
from datetime import datetime
from ..models import RawDocument, SourceType
import logging

logger = logging.getLogger(__name__)


class SourceAdapter(ABC):
    """数据源适配器基类"""

    def __init__(self, source_type: SourceType, config: dict):
        self.source_type = source_type
        self.config = config
        self.enabled = config.get('enabled', True)
        self.sync_interval = config.get('sync_interval_minutes', 20)

    @abstractmethod
    async def fetch(
        self,
        since: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[RawDocument]:
        """
        从数据源获取文档。

        参数：
            since: 只获取此时间之后的文档（增量同步）
            limit: 最大获取数量

        返回：
            原始文档列表
        """
        pass

    @abstractmethod
    async def fetch_single(self, source_id: str) -> Optional[RawDocument]:
        """获取单个文档"""
        pass

    @abstractmethod
    async def stream(
        self,
        since: Optional[datetime] = None,
    ) -> AsyncIterator[RawDocument]:
        """流式获取文档（适用于大量数据）"""
        pass

    def _rate_limit_key(self) -> str:
        """限流键"""
        return f"source_adapter:{self.source_type.value}"
```

### 2.2 Gmail 适配器

```python
# openhuman/pipeline/adapters/gmail.py
import base64
import email
from email.header import decode_header
from typing import List, Optional, AsyncIterator
from datetime import datetime
from .base import SourceAdapter
from ..models import RawDocument, SourceType
import logging

logger = logging.getLogger(__name__)


class GmailAdapter(SourceAdapter):
    """
    Gmail 数据适配器。

    使用 Gmail API 获取邮件数据。
    支持：
    - 增量同步（基于历史 ID）
    - 邮件线程追踪
    - 附件元数据提取
    - 标签过滤
    """

    SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

    def __init__(self, config: dict):
        super().__init__(SourceType.GMAIL, config)
        self.credentials_path = config.get('credentials_path', 'credentials.json')
        self.token_path = config.get('token_path', 'token.json')
        self.label_filter = config.get('label_filter', 'INBOX')
        self.exclude_labels = config.get('exclude_labels', ['SPAM', 'TRASH'])
        self.max_body_length = config.get('max_body_length', 50000)
        self._service = None

    async def _get_service(self):
        """获取 Gmail API service"""
        if self._service:
            return self._service

        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
        import os

        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, self.SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_path, self.SCOPES
                )
                creds = flow.run_local_server(port=0)

            with open(self.token_path, 'w') as f:
                f.write(creds.to_json())

        self._service = build('gmail', 'v1', credentials=creds)
        return self._service

    async def fetch(
        self,
        since: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[RawDocument]:
        """获取邮件列表"""
        service = await self._get_service()

        # 构建查询
        query_parts = []
        if self.label_filter:
            query_parts.append(f"label:{self.label_filter}")
        if since:
            after_date = since.strftime('%Y/%m/%d')
            query_parts.append(f"after:{after_date}")

        query = ' '.join(query_parts)

        # 获取邮件列表
        results = service.users().messages().list(
            userId='me',
            q=query,
            maxResults=limit,
        ).execute()

        messages = results.get('messages', [])
        documents = []

        for msg_meta in messages:
            try:
                doc = await self._fetch_message(service, msg_meta['id'])
                if doc:
                    documents.append(doc)
            except Exception as e:
                logger.error(f"Error fetching Gmail message {msg_meta['id']}: {e}")

        logger.info(f"Fetched {len(documents)} emails from Gmail")
        return documents

    async def fetch_single(self, source_id: str) -> Optional[RawDocument]:
        """获取单封邮件"""
        service = await self._get_service()
        return await self._fetch_message(service, source_id)

    async def stream(self, since=None) -> AsyncIterator[RawDocument]:
        """流式获取邮件"""
        service = await self._get_service()
        query = f"label:{self.label_filter}"
        if since:
            query += f" after:{since.strftime('%Y/%m/%d')}"

        page_token = None
        while True:
            results = service.users().messages().list(
                userId='me',
                q=query,
                maxResults=50,
                pageToken=page_token,
            ).execute()

            for msg_meta in results.get('messages', []):
                doc = await self._fetch_message(service, msg_meta['id'])
                if doc:
                    yield doc

            page_token = results.get('nextPageToken')
            if not page_token:
                break

    async def _fetch_message(self, service, message_id: str) -> Optional[RawDocument]:
        """获取单封邮件的完整内容"""
        msg = service.users().messages().get(
            userId='me',
            id=message_id,
            format='full',
        ).execute()

        # 解析邮件头
        headers = {h['name']: h['value'] for h in msg.get('payload', {}).get('headers', [])}
        subject = self._decode_header(headers.get('Subject', '(no subject)'))
        from_addr = headers.get('From', '')
        to_addr = headers.get('To', '')
        date_str = headers.get('Date', '')
        message_id_header = headers.get('Message-ID', '')
        in_reply_to = headers.get('In-Reply-To', '')
        references = headers.get('References', '')

        # 解析邮件正文
        body = self._extract_body(msg.get('payload', {}))

        # 解析标签
        labels = msg.get('labelIds', [])

        # 解析附件元数据
        attachments = self._extract_attachment_info(msg.get('payload', {}))

        return RawDocument(
            source_type=SourceType.GMAIL,
            source_id=message_id,
            raw_content=body[:self.max_body_length],
            raw_metadata={
                'subject': subject,
                'from': from_addr,
                'to': to_addr,
                'date': date_str,
                'message_id': message_id_header,
                'in_reply_to': in_reply_to,
                'references': references,
                'labels': labels,
                'thread_id': msg.get('threadId', ''),
                'attachments': attachments,
                'snippet': msg.get('snippet', ''),
            },
        )

    def _decode_header(self, header_value: str) -> str:
        """解码邮件头（处理编码）"""
        if not header_value:
            return ''
        decoded_parts = decode_header(header_value)
        result = []
        for part, charset in decoded_parts:
            if isinstance(part, bytes):
                result.append(part.decode(charset or 'utf-8', errors='replace'))
            else:
                result.append(part)
        return ''.join(result)

    def _extract_body(self, payload: dict) -> str:
        """递归提取邮件正文"""
        mime_type = payload.get('mimeType', '')
        body_data = payload.get('body', {}).get('data', '')

        if mime_type == 'text/plain' and body_data:
            return base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')

        if mime_type == 'text/html' and body_data:
            html = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')
            return self._html_to_text(html)

        # multipart：递归处理子部分
        parts = payload.get('parts', [])
        text_parts = []
        for part in parts:
            text = self._extract_body(part)
            if text:
                text_parts.append(text)

        return '\n\n'.join(text_parts)

    def _html_to_text(self, html: str) -> str:
        """简单 HTML 转文本"""
        import re
        text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
        text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
        text = re.sub(r'<br\s*/?>', '\n', text)
        text = re.sub(r'</p>', '\n\n', text)
        text = re.sub(r'</div>', '\n', text)
        text = re.sub(r'</li>', '\n', text)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def _extract_attachment_info(self, payload: dict) -> list:
        """提取附件元数据（不下载附件内容）"""
        attachments = []
        parts = payload.get('parts', [])
        for part in parts:
            filename = part.get('filename', '')
            if filename:
                attachments.append({
                    'filename': filename,
                    'mime_type': part.get('mimeType', ''),
                    'size': part.get('body', {}).get('size', 0),
                })
            # 递归处理嵌套 part
            attachments.extend(self._extract_attachment_info(part))
        return attachments
```

### 2.3 Slack 适配器

```python
# openhuman/pipeline/adapters/slack.py
import aiohttp
import time
from typing import List, Optional, AsyncIterator
from datetime import datetime
from .base import SourceAdapter
from ..models import RawDocument, SourceType
import logging

logger = logging.getLogger(__name__)


class SlackAdapter(SourceAdapter):
    """
    Slack 数据适配器。

    使用 Slack Web API 获取频道消息。
    支持：
    - 增量同步（基于 timestamp cursor）
    - 频道过滤
    - 线程消息获取
    - 用户信息解析
    """

    BASE_URL = "https://slack.com/api"

    def __init__(self, config: dict):
        super().__init__(SourceType.SLACK, config)
        self.token = config['bot_token']
        self.channels = config.get('channels', [])  # 空列表 = 所有频道
        self.exclude_channels = config.get('exclude_channels', [])
        self.include_threads = config.get('include_threads', True)
        self.include_reactions = config.get('include_reactions', True)
        self._user_cache = {}
        self._channel_cache = {}

    async def _api_call(self, method: str, params: dict = None) -> dict:
        """调用 Slack API"""
        headers = {'Authorization': f'Bearer {self.token}'}
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.BASE_URL}/{method}",
                headers=headers,
                params=params or {},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                if not data.get('ok'):
                    logger.error(f"Slack API error: {data.get('error', 'unknown')}")
                return data

    async def fetch(
        self,
        since: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[RawDocument]:
        """获取频道消息"""
        documents = []

        # 获取目标频道列表
        target_channels = await self._get_target_channels()

        for channel_id, channel_name in target_channels:
            try:
                channel_docs = await self._fetch_channel_history(
                    channel_id, channel_name, since, limit
                )
                documents.extend(channel_docs)
            except Exception as e:
                logger.error(f"Error fetching Slack channel {channel_name}: {e}")

        logger.info(f"Fetched {len(documents)} messages from Slack")
        return documents

    async def _get_target_channels(self) -> list:
        """获取目标频道列表"""
        if self._channel_cache:
            return list(self._channel_cache.items())

        data = await self._api_call('conversations.list', {
            'types': 'public_channel,private_channel',
            'limit': 200,
        })

        channels = []
        for ch in data.get('channels', []):
            ch_id = ch['id']
            ch_name = ch['name']

            if self.channels and ch_name not in self.channels:
                continue
            if ch_name in self.exclude_channels:
                continue

            channels.append((ch_id, ch_name))
            self._channel_cache[ch_id] = ch_name

        return channels

    async def _fetch_channel_history(
        self,
        channel_id: str,
        channel_name: str,
        since: Optional[datetime],
        limit: int,
    ) -> List[RawDocument]:
        """获取频道历史消息"""
        params = {
            'channel': channel_id,
            'limit': min(limit, 200),
        }
        if since:
            params['oldest'] = str(since.timestamp())

        data = await self._api_call('conversations.history', params)
        documents = []

        for msg in data.get('messages', []):
            # 跳过 bot 消息和系统消息
            if msg.get('subtype') in ('bot_message', 'channel_join', 'channel_leave'):
                continue

            user_id = msg.get('user', '')
            user_name = await self._get_user_name(user_id)

            doc = RawDocument(
                source_type=SourceType.SLACK,
                source_id=f"{channel_id}:{msg['ts']}",
                raw_content=msg.get('text', ''),
                raw_metadata={
                    'channel_id': channel_id,
                    'channel_name': channel_name,
                    'user_id': user_id,
                    'user_name': user_name,
                    'timestamp': msg['ts'],
                    'thread_ts': msg.get('thread_ts', ''),
                    'reply_count': msg.get('reply_count', 0),
                    'reactions': msg.get('reactions', []),
                    'attachments': msg.get('attachments', []),
                },
            )
            documents.append(doc)

            # 获取线程回复
            if self.include_threads and msg.get('reply_count', 0) > 0:
                thread_docs = await self._fetch_thread(
                    channel_id, channel_name, msg['ts']
                )
                documents.extend(thread_docs)

        return documents

    async def _fetch_thread(
        self,
        channel_id: str,
        channel_name: str,
        thread_ts: str,
    ) -> List[RawDocument]:
        """获取线程消息"""
        data = await self._api_call('conversations.replies', {
            'channel': channel_id,
            'ts': thread_ts,
            'limit': 100,
        })

        documents = []
        for msg in data.get('messages', []):
            if msg.get('ts') == thread_ts:
                continue  # 跳过父消息（已经获取过）

            user_id = msg.get('user', '')
            user_name = await self._get_user_name(user_id)

            doc = RawDocument(
                source_type=SourceType.SLACK,
                source_id=f"{channel_id}:{msg['ts']}",
                raw_content=msg.get('text', ''),
                raw_metadata={
                    'channel_id': channel_id,
                    'channel_name': channel_name,
                    'user_id': user_id,
                    'user_name': user_name,
                    'timestamp': msg['ts'],
                    'thread_ts': thread_ts,
                    'is_thread_reply': True,
                },
            )
            documents.append(doc)

        return documents

    async def _get_user_name(self, user_id: str) -> str:
        """获取用户显示名称"""
        if not user_id:
            return "unknown"
        if user_id in self._user_cache:
            return self._user_cache[user_id]

        data = await self._api_call('users.info', {'user': user_id})
        user = data.get('user', {})
        name = user.get('real_name', user.get('name', user_id))
        self._user_cache[user_id] = name
        return name

    async def fetch_single(self, source_id: str) -> Optional[RawDocument]:
        """获取单条消息"""
        parts = source_id.split(':')
        if len(parts) != 2:
            return None
        channel_id, ts = parts

        data = await self._api_call('conversations.history', {
            'channel': channel_id,
            'latest': ts,
            'inclusive': 'true',
            'limit': 1,
        })

        messages = data.get('messages', [])
        if not messages:
            return None

        msg = messages[0]
        return RawDocument(
            source_type=SourceType.SLACK,
            source_id=source_id,
            raw_content=msg.get('text', ''),
            raw_metadata={
                'channel_id': channel_id,
                'timestamp': msg['ts'],
            },
        )

    async def stream(self, since=None) -> AsyncIterator[RawDocument]:
        """流式获取消息"""
        target_channels = await self._get_target_channels()
        for channel_id, channel_name in target_channels:
            async for doc in self._stream_channel(channel_id, channel_name, since):
                yield doc

    async def _stream_channel(self, channel_id, channel_name, since):
        """流式获取单个频道"""
        params = {'channel': channel_id, 'limit': 100}
        if since:
            params['oldest'] = str(since.timestamp())

        cursor = None
        while True:
            if cursor:
                params['cursor'] = cursor

            data = await self._api_call('conversations.history', params)

            for msg in data.get('messages', []):
                if msg.get('subtype') in ('bot_message',):
                    continue
                yield RawDocument(
                    source_type=SourceType.SLACK,
                    source_id=f"{channel_id}:{msg['ts']}",
                    raw_content=msg.get('text', ''),
                    raw_metadata={
                        'channel_id': channel_id,
                        'channel_name': channel_name,
                        'timestamp': msg['ts'],
                    },
                )

            cursor = data.get('response_metadata', {}).get('next_cursor')
            if not cursor:
                break
```

### 2.4 GitHub 适配器

```python
# openhuman/pipeline/adapters/github.py
import aiohttp
from typing import List, Optional, AsyncIterator
from datetime import datetime
from .base import SourceAdapter
from ..models import RawDocument, SourceType
import logging

logger = logging.getLogger(__name__)


class GitHubAdapter(SourceAdapter):
    """
    GitHub 数据适配器。

    获取的数据类型：
    - Issue 和 Pull Request（含评论）
    - Code Review 评论
    - Commit messages
    - Discussions（如果启用）
    """

    BASE_URL = "https://api.github.com"

    def __init__(self, config: dict):
        super().__init__(SourceType.GITHUB, config)
        self.token = config['token']
        self.repos = config.get('repos', [])  # ['owner/repo', ...]
        self.include_issues = config.get('include_issues', True)
        self.include_prs = config.get('include_prs', True)
        self.include_reviews = config.get('include_reviews', True)
        self.include_commits = config.get('include_commits', False)
        self.state_filter = config.get('state_filter', 'all')  # open/closed/all

    async def _api_get(self, endpoint: str, params: dict = None) -> dict:
        """调用 GitHub API"""
        headers = {
            'Authorization': f'token {self.token}',
            'Accept': 'application/vnd.github.v3+json',
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.BASE_URL}{endpoint}",
                headers=headers,
                params=params or {},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                else:
                    logger.error(f"GitHub API error {resp.status}: {await resp.text()}")
                    return {}

    async def fetch(
        self,
        since: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[RawDocument]:
        """获取 GitHub 数据"""
        documents = []

        for repo in self.repos:
            if self.include_issues:
                issues = await self._fetch_issues(repo, since, limit)
                documents.extend(issues)

            if self.include_prs:
                prs = await self._fetch_pull_requests(repo, since, limit)
                documents.extend(prs)

        logger.info(f"Fetched {len(documents)} items from GitHub")
        return documents

    async def _fetch_issues(
        self, repo: str, since: Optional[datetime], limit: int
    ) -> List[RawDocument]:
        """获取 Issue 列表"""
        params = {
            'state': self.state_filter,
            'per_page': min(limit, 100),
            'sort': 'updated',
            'direction': 'desc',
        }
        if since:
            params['since'] = since.isoformat()

        data = await self._api_get(f"/repos/{repo}/issues", params)
        documents = []

        for issue in data:
            # 跳过 PR（GitHub API 中 PR 也出现在 issues 端点）
            if 'pull_request' in issue:
                continue

            doc = RawDocument(
                source_type=SourceType.GITHUB,
                source_id=f"{repo}#issue-{issue['number']}",
                raw_content=issue.get('body', '') or '',
                raw_metadata={
                    'repo': repo,
                    'type': 'issue',
                    'number': issue['number'],
                    'title': issue['title'],
                    'state': issue['state'],
                    'author': issue['user']['login'],
                    'created_at': issue['created_at'],
                    'updated_at': issue['updated_at'],
                    'labels': [l['name'] for l in issue.get('labels', [])],
                    'assignees': [a['login'] for a in issue.get('assignees', [])],
                    'comments_count': issue.get('comments', 0),
                    'url': issue['html_url'],
                },
            )
            documents.append(doc)

            # 获取评论
            if issue.get('comments', 0) > 0:
                comments = await self._fetch_issue_comments(
                    repo, issue['number']
                )
                documents.extend(comments)

        return documents

    async def _fetch_issue_comments(
        self, repo: str, issue_number: int
    ) -> List[RawDocument]:
        """获取 Issue 评论"""
        data = await self._api_get(f"/repos/{repo}/issues/{issue_number}/comments")
        documents = []

        for comment in data:
            doc = RawDocument(
                source_type=SourceType.GITHUB,
                source_id=f"{repo}#issue-{issue_number}-comment-{comment['id']}",
                raw_content=comment.get('body', ''),
                raw_metadata={
                    'repo': repo,
                    'type': 'issue_comment',
                    'issue_number': issue_number,
                    'author': comment['user']['login'],
                    'created_at': comment['created_at'],
                    'url': comment['html_url'],
                },
            )
            documents.append(doc)

        return documents

    async def _fetch_pull_requests(
        self, repo: str, since: Optional[datetime], limit: int
    ) -> List[RawDocument]:
        """获取 Pull Request"""
        params = {
            'state': self.state_filter,
            'per_page': min(limit, 100),
            'sort': 'updated',
            'direction': 'desc',
        }

        data = await self._api_get(f"/repos/{repo}/pulls", params)
        documents = []

        for pr in data:
            doc = RawDocument(
                source_type=SourceType.GITHUB,
                source_id=f"{repo}#pr-{pr['number']}",
                raw_content=pr.get('body', '') or '',
                raw_metadata={
                    'repo': repo,
                    'type': 'pull_request',
                    'number': pr['number'],
                    'title': pr['title'],
                    'state': pr['state'],
                    'author': pr['user']['login'],
                    'created_at': pr['created_at'],
                    'updated_at': pr['updated_at'],
                    'base_branch': pr['base']['ref'],
                    'head_branch': pr['head']['ref'],
                    'additions': pr.get('additions', 0),
                    'deletions': pr.get('deletions', 0),
                    'changed_files': pr.get('changed_files', 0),
                    'url': pr['html_url'],
                },
            )
            documents.append(doc)

            # 获取 PR review 评论
            if self.include_reviews:
                reviews = await self._fetch_pr_reviews(repo, pr['number'])
                documents.extend(reviews)

        return documents

    async def _fetch_pr_reviews(
        self, repo: str, pr_number: int
    ) -> List[RawDocument]:
        """获取 PR Review"""
        data = await self._api_get(f"/repos/{repo}/pulls/{pr_number}/reviews")
        documents = []

        for review in data:
            if not review.get('body'):
                continue

            doc = RawDocument(
                source_type=SourceType.GITHUB,
                source_id=f"{repo}#pr-{pr_number}-review-{review['id']}",
                raw_content=review.get('body', ''),
                raw_metadata={
                    'repo': repo,
                    'type': 'pr_review',
                    'pr_number': pr_number,
                    'author': review['user']['login'],
                    'state': review['state'],  # APPROVED, CHANGES_REQUESTED, etc.
                    'submitted_at': review.get('submitted_at', ''),
                    'url': review.get('html_url', ''),
                },
            )
            documents.append(doc)

        return documents

    async def fetch_single(self, source_id: str) -> Optional[RawDocument]:
        """获取单个文档"""
        # 解析 source_id: "owner/repo#issue-123"
        parts = source_id.split('#')
        if len(parts) != 2:
            return None

        repo = parts[0]
        id_parts = parts[1].split('-')
        item_type = id_parts[0]
        number = int(id_parts[1])

        if item_type == 'issue':
            data = await self._api_get(f"/repos/{repo}/issues/{number}")
            return RawDocument(
                source_type=SourceType.GITHUB,
                source_id=source_id,
                raw_content=data.get('body', ''),
                raw_metadata={'repo': repo, 'type': 'issue', 'number': number},
            )
        elif item_type == 'pr':
            data = await self._api_get(f"/repos/{repo}/pulls/{number}")
            return RawDocument(
                source_type=SourceType.GITHUB,
                source_id=source_id,
                raw_content=data.get('body', ''),
                raw_metadata={'repo': repo, 'type': 'pr', 'number': number},
            )

        return None

    async def stream(self, since=None) -> AsyncIterator[RawDocument]:
        """流式获取"""
        for repo in self.repos:
            async for doc in self._stream_repo(repo, since):
                yield doc

    async def _stream_repo(self, repo, since):
        """流式获取单个仓库"""
        params = {'state': 'all', 'per_page': 100, 'sort': 'updated'}
        if since:
            params['since'] = since.isoformat()

        page = 1
        while True:
            params['page'] = page
            data = await self._api_get(f"/repos/{repo}/issues", params)
            if not data:
                break

            for item in data:
                if 'pull_request' in item:
                    continue
                yield RawDocument(
                    source_type=SourceType.GITHUB,
                    source_id=f"{repo}#issue-{item['number']}",
                    raw_content=item.get('body', ''),
                    raw_metadata={'repo': repo, 'title': item['title']},
                )

            if len(data) < 100:
                break
            page += 1
```

## 三、规范化层

### 3.1 文档规范化器

```python
# openhuman/pipeline/normalizer.py
import re
from typing import Optional, List
from datetime import datetime
from .models import RawDocument, NormalizedDocument, SourceType
import logging
import hashlib

logger = logging.getLogger(__name__)


class DocumentNormalizer:
    """
    文档规范化器。

    将不同数据源的原始文档转换为统一的 NormalizedDocument 格式。
    处理包括：
    - 正文清洗（去除 HTML、特殊字符）
    - 元数据标准化（统一日期格式、字段命名）
    - 链接提取
    - 标签推断
    """

    def normalize(self, raw: RawDocument) -> Optional[NormalizedDocument]:
        """规范化单个文档"""
        try:
            if raw.source_type == SourceType.GMAIL:
                return self._normalize_gmail(raw)
            elif raw.source_type == SourceType.SLACK:
                return self._normalize_slack(raw)
            elif raw.source_type == SourceType.GITHUB:
                return self._normalize_github(raw)
            elif raw.source_type == SourceType.LOCAL_FILE:
                return self._normalize_local(raw)
            else:
                return self._normalize_generic(raw)
        except Exception as e:
            logger.error(f"Normalization error for {raw.source_id}: {e}")
            return None

    def _normalize_gmail(self, raw: RawDocument) -> NormalizedDocument:
        """规范化 Gmail 邮件"""
        meta = raw.raw_metadata
        body = self._clean_text(raw.raw_content)
        subject = meta.get('subject', '(no subject)')
        from_addr = meta.get('from', '')

        # 提取发件人名称
        author = self._extract_email_name(from_addr)

        # 解析日期
        created_at = self._parse_email_date(meta.get('date', ''))

        # 提取链接
        links = self._extract_links(body)

        # 推断标签
        tags = ['email']
        labels = meta.get('labels', [])
        if 'IMPORTANT' in labels:
            tags.append('important')
        if meta.get('in_reply_to'):
            tags.append('reply')

        # 构建 title
        title = f"📧 {subject}"

        return NormalizedDocument(
            doc_id=f"gmail-{raw.source_id}",
            source_type=SourceType.GMAIL,
            source_id=raw.source_id,
            title=title,
            body=body,
            author=author,
            created_at=created_at,
            metadata={
                'from': from_addr,
                'to': meta.get('to', ''),
                'thread_id': meta.get('thread_id', ''),
                'message_id': meta.get('message_id', ''),
                'in_reply_to': meta.get('in_reply_to', ''),
                'attachments': meta.get('attachments', []),
            },
            tags=tags,
            links=links,
        )

    def _normalize_slack(self, raw: RawDocument) -> NormalizedDocument:
        """规范化 Slack 消息"""
        meta = raw.raw_metadata
        body = self._clean_slack_text(raw.raw_content)
        channel = meta.get('channel_name', 'unknown')
        author = meta.get('user_name', 'unknown')

        # 解析 timestamp
        ts = meta.get('timestamp', '')
        created_at = datetime.fromtimestamp(float(ts)) if ts else None

        # 构建 title
        is_thread = meta.get('is_thread_reply', False)
        if is_thread:
            title = f"💬 #{channel} (thread reply by {author})"
        else:
            preview = body[:50].replace('\n', ' ')
            title = f"💬 #{channel}: {preview}..."

        tags = ['slack', channel]
        if is_thread:
            tags.append('thread')

        return NormalizedDocument(
            doc_id=f"slack-{raw.source_id}",
            source_type=SourceType.SLACK,
            source_id=raw.source_id,
            title=title,
            body=body,
            author=author,
            created_at=created_at,
            metadata={
                'channel_id': meta.get('channel_id', ''),
                'channel_name': channel,
                'thread_ts': meta.get('thread_ts', ''),
                'reactions': meta.get('reactions', []),
            },
            tags=tags,
        )

    def _normalize_github(self, raw: RawDocument) -> NormalizedDocument:
        """规范化 GitHub 数据"""
        meta = raw.raw_metadata
        body = self._clean_text(raw.raw_content)
        item_type = meta.get('type', 'unknown')
        repo = meta.get('repo', '')
        number = meta.get('number', 0)
        title_text = meta.get('title', '')
        author = meta.get('author', '')

        created_at = None
        if meta.get('created_at'):
            try:
                created_at = datetime.fromisoformat(meta['created_at'].replace('Z', '+00:00'))
            except ValueError:
                pass

        # 构建 title
        type_emoji = {'issue': '🐛', 'pull_request': '🔀', 'issue_comment': '💬', 'pr_review': '👀'}
        emoji = type_emoji.get(item_type, '📋')
        title = f"{emoji} {repo}#{number}: {title_text}"

        tags = ['github', repo, item_type]
        if meta.get('state'):
            tags.append(meta['state'])
        if meta.get('labels'):
            tags.extend(meta['labels'])

        return NormalizedDocument(
            doc_id=f"github-{raw.source_id}",
            source_type=SourceType.GITHUB,
            source_id=raw.source_id,
            title=title,
            body=body,
            author=author,
            created_at=created_at,
            metadata={
                'repo': repo,
                'type': item_type,
                'number': number,
                'state': meta.get('state', ''),
                'url': meta.get('url', ''),
            },
            tags=tags,
            links=[meta.get('url', '')],
        )

    def _normalize_local(self, raw: RawDocument) -> NormalizedDocument:
        """规范化本地文件"""
        return NormalizedDocument(
            doc_id=f"local-{raw.source_id}",
            source_type=SourceType.LOCAL_FILE,
            source_id=raw.source_id,
            title=raw.raw_metadata.get('filename', raw.source_id),
            body=self._clean_text(raw.raw_content),
            metadata=raw.raw_metadata,
            tags=['local', raw.raw_metadata.get('extension', '')],
        )

    def _normalize_generic(self, raw: RawDocument) -> NormalizedDocument:
        """通用规范化"""
        return NormalizedDocument(
            doc_id=f"{raw.source_type.value}-{raw.source_id}",
            source_type=raw.source_type,
            source_id=raw.source_id,
            title=raw.raw_metadata.get('title', raw.source_id[:50]),
            body=self._clean_text(raw.raw_content),
            metadata=raw.raw_metadata,
        )

    def _clean_text(self, text: str) -> str:
        """清洗文本"""
        # 移除多余空白
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        # 移除控制字符
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
        return text.strip()

    def _clean_slack_text(self, text: str) -> str:
        """清洗 Slack 格式文本"""
        # 解析 Slack 用户提及 <@U12345> → @username
        text = re.sub(r'<@(\w+)>', r'@\1', text)
        # 解析 Slack 链接 <http://...|text> → text (url)
        text = re.sub(r'<(https?://[^|>]+)\|([^>]+)>', r'\2 (\1)', text)
        text = re.sub(r'<(https?://[^>]+)>', r'\1', text)
        # 解析频道引用 <#C12345|channel> → #channel
        text = re.sub(r'<#(\w+)\|([^>]+)>', r'#\2', text)
        return self._clean_text(text)

    def _extract_email_name(self, from_addr: str) -> str:
        """从邮件地址提取姓名"""
        match = re.match(r'^"?([^"<]+)"?\s*<', from_addr)
        if match:
            return match.group(1).strip()
        return from_addr.split('@')[0] if '@' in from_addr else from_addr

    def _parse_email_date(self, date_str: str) -> Optional[datetime]:
        """解析邮件日期"""
        from email.utils import parsedate_to_datetime
        try:
            return parsedate_to_datetime(date_str)
        except Exception:
            return None

    def _extract_links(self, text: str) -> List[str]:
        """提取文本中的链接"""
        return re.findall(r'https?://[^\s<>\"\)]+', text)
```

## 四、分块层

### 4.1 智能分块器

```python
# openhuman/pipeline/chunker.py
from typing import List
from .models import NormalizedDocument, Chunk
import hashlib
import logging

logger = logging.getLogger(__name__)


class DocumentChunker:
    """
    文档分块器。

    支持三种分块策略：
    1. 语义分块：按段落和标题分割
    2. 固定大小：按字符数分割
    3. 滑动窗口：固定大小 + 重叠区域

    策略选择：
    - 邮件/消息：通常不分块（本身较短）
    - Issue/PR：按段落语义分块
    - 长文档：滑动窗口分块
    """

    def __init__(
        self,
        max_chunk_size: int = 2000,
        overlap_size: int = 200,
        min_chunk_size: int = 100,
    ):
        self.max_chunk_size = max_chunk_size
        self.overlap_size = overlap_size
        self.min_chunk_size = min_chunk_size

    def chunk(self, doc: NormalizedDocument) -> List[Chunk]:
        """对文档进行分块"""
        body = doc.body

        # 短文档不分块
        if len(body) <= self.max_chunk_size:
            return [Chunk(
                chunk_id=f"{doc.doc_id}-0",
                doc_id=doc.doc_id,
                content=body,
                index=0,
                start_offset=0,
                end_offset=len(body),
                metadata=doc.metadata,
            )]

        # 尝试语义分块
        semantic_chunks = self._semantic_chunk(body, doc.doc_id)
        if len(semantic_chunks) > 1:
            return semantic_chunks

        # 回退到滑动窗口分块
        return self._sliding_window_chunk(body, doc.doc_id, doc.metadata)

    def _semantic_chunk(self, text: str, doc_id: str) -> List[Chunk]:
        """语义分块：按段落和标题分割"""
        import re

        # 按标题或双换行分段
        sections = re.split(r'\n(?=#{1,3}\s)|(?:\n\n)', text)

        chunks = []
        current_content = ""
        current_offset = 0

        for section in sections:
            section = section.strip()
            if not section:
                continue

            # 如果当前块加上新段落不超过限制，合并
            if len(current_content) + len(section) + 2 <= self.max_chunk_size:
                current_content += ('\n\n' + section if current_content else section)
            else:
                # 保存当前块
                if current_content and len(current_content) >= self.min_chunk_size:
                    chunks.append(Chunk(
                        chunk_id=f"{doc_id}-{len(chunks)}",
                        doc_id=doc_id,
                        content=current_content,
                        index=len(chunks),
                        start_offset=current_offset,
                        end_offset=current_offset + len(current_content),
                    ))
                    current_offset += len(current_content)

                # 当前段落作为新块的开始
                # 如果单个段落就超过限制，需要进一步拆分
                if len(section) > self.max_chunk_size:
                    sub_chunks = self._split_large_section(section, doc_id, current_offset, len(chunks))
                    chunks.extend(sub_chunks)
                    current_offset += sum(len(c.content) for c in sub_chunks)
                    current_content = ""
                else:
                    current_content = section

        # 保存最后一块
        if current_content and len(current_content) >= self.min_chunk_size:
            chunks.append(Chunk(
                chunk_id=f"{doc_id}-{len(chunks)}",
                doc_id=doc_id,
                content=current_content,
                index=len(chunks),
                start_offset=current_offset,
                end_offset=current_offset + len(current_content),
            ))

        return chunks

    def _sliding_window_chunk(
        self,
        text: str,
        doc_id: str,
        metadata: dict,
    ) -> List[Chunk]:
        """滑动窗口分块"""
        chunks = []
        start = 0

        while start < len(text):
            end = min(start + self.max_chunk_size, len(text))

            # 尝试在句子边界处断开
            if end < len(text):
                # 在 max_chunk_size 范围内找最后一个句号
                search_start = max(start + self.max_chunk_size - 200, start)
                last_period = -1
                for sep in ['\n\n', '。', '.\n', '. ', '\n', '；', ';']:
                    pos = text.rfind(sep, search_start, end)
                    if pos > last_period:
                        last_period = pos

                if last_period > start + self.min_chunk_size:
                    end = last_period + 1

            chunk_content = text[start:end]

            if len(chunk_content) >= self.min_chunk_size:
                chunks.append(Chunk(
                    chunk_id=f"{doc_id}-{len(chunks)}",
                    doc_id=doc_id,
                    content=chunk_content,
                    index=len(chunks),
                    start_offset=start,
                    end_offset=end,
                    metadata=metadata,
                ))

            # 滑动窗口：下一块的起始位置 = 当前块结束位置 - 重叠大小
            start = end - self.overlap_size if end < len(text) else end

        return chunks

    def _split_large_section(
        self,
        text: str,
        doc_id: str,
        base_offset: int,
        base_index: int,
    ) -> List[Chunk]:
        """拆分超大段落"""
        chunks = []
        start = 0

        while start < len(text):
            end = min(start + self.max_chunk_size, len(text))

            # 在换行处断开
            if end < len(text):
                last_newline = text.rfind('\n', start + self.min_chunk_size, end)
                if last_newline > start:
                    end = last_newline + 1

            chunk_content = text[start:end].strip()
            if chunk_content:
                chunks.append(Chunk(
                    chunk_id=f"{doc_id}-{base_index + len(chunks)}",
                    doc_id=doc_id,
                    content=chunk_content,
                    index=base_index + len(chunks),
                    start_offset=base_offset + start,
                    end_offset=base_offset + end,
                ))

            start = end

        return chunks
```

## 五、记忆树构建

### 5.1 记忆树构建器

```python
# openhuman/pipeline/memory_tree_builder.py
from typing import List, Dict, Any
from .models import Chunk, Entity, Relation, NormalizedDocument
import logging
import json

logger = logging.getLogger(__name__)


class MemoryTreeBuilder:
    """
    记忆树构建器。

    将分块后的内容转化为结构化的记忆树：
    1. 从 chunks 中提取实体
    2. 识别实体间关系
    3. 按主题聚类
    4. 生成层次化摘要
    """

    def __init__(self, llm_client, entity_store):
        self.llm_client = llm_client
        self.entity_store = entity_store

    async def build_from_chunks(
        self,
        chunks: List[Chunk],
        doc: NormalizedDocument,
    ) -> Dict[str, Any]:
        """
        从分块构建记忆树。

        返回：
        {
            "entities": [Entity, ...],
            "relations": [Relation, ...],
            "topics": [{"name": str, "chunks": [str], "summary": str}],
            "summary": str,
        }
        """
        # 步骤 1：从每个 chunk 提取实体
        all_entities = []
        for chunk in chunks:
            entities = await self._extract_entities(chunk, doc)
            all_entities.extend(entities)

        # 步骤 2：合并去重
        merged_entities = self._merge_entities(all_entities)

        # 步骤 3：识别关系
        relations = await self._extract_relations(chunks, merged_entities)

        # 步骤 4：主题聚类
        topics = await self._cluster_topics(chunks, merged_entities)

        # 步骤 5：生成摘要
        summary = await self._generate_summary(doc, merged_entities, topics)

        return {
            "entities": merged_entities,
            "relations": relations,
            "topics": topics,
            "summary": summary,
        }

    async def _extract_entities(self, chunk: Chunk, doc: NormalizedDocument) -> List[Entity]:
        """从单个 chunk 提取实体"""
        prompt = f"""从以下文本中提取实体。返回 JSON 数组。

实体类型：person, project, topic, tool, concept, organization

文本：
{chunk.content[:3000]}

返回格式：
[{{"type": "person", "name": "Alice", "aliases": ["Alice Chen"], "attributes": {{"role": "engineer"}}}}]
"""

        try:
            response = await self.llm_client.chat(
                messages=[{"role": "user", "content": prompt}],
                model="deepseek-v3",
                max_tokens=1000,
            )
            entities_data = json.loads(response)
            entities = []
            for ed in entities_data:
                entity = Entity(
                    entity_id=f"{ed['type']}-{ed['name'].lower().replace(' ', '_')}",
                    entity_type=ed.get('type', 'concept'),
                    name=ed['name'],
                    aliases=ed.get('aliases', []),
                    attributes=ed.get('attributes', {}),
                    source_chunks=[chunk.chunk_id],
                    mentions=1,
                )
                entities.append(entity)
            return entities
        except Exception as e:
            logger.warning(f"Entity extraction failed for chunk {chunk.chunk_id}: {e}")
            return []

    def _merge_entities(self, entities: List[Entity]) -> List[Entity]:
        """合并重复实体"""
        merged = {}
        for entity in entities:
            eid = entity.entity_id
            if eid in merged:
                existing = merged[eid]
                existing.source_chunks.extend(entity.source_chunks)
                existing.mentions += entity.mentions
                # 合并 aliases
                for alias in entity.aliases:
                    if alias not in existing.aliases:
                        existing.aliases.append(alias)
                # 合并 attributes
                for k, v in entity.attributes.items():
                    if k not in existing.attributes:
                        existing.attributes[k] = v
            else:
                merged[eid] = entity
        return list(merged.values())

    async def _extract_relations(
        self,
        chunks: List[Chunk],
        entities: List[Entity],
    ) -> List[Relation]:
        """提取实体关系"""
        entity_names = [e.name for e in entities]
        full_text = '\n'.join(c.content[:500] for c in chunks[:5])

        prompt = f"""根据以下文本，分析这些实体之间的关系：{', '.join(entity_names[:20])}

文本：
{full_text[:3000]}

返回 JSON 数组：
[{{"source": "Alice", "target": "ProjectX", "type": "works_on", "confidence": 0.9}}]

关系类型：works_on, uses, knows, manages, contributes_to, related_to
"""

        try:
            response = await self.llm_client.chat(
                messages=[{"role": "user", "content": prompt}],
                model="deepseek-v3",
                max_tokens=1000,
            )
            relations_data = json.loads(response)

            entity_name_to_id = {e.name: e.entity_id for e in entities}
            for e in entities:
                for alias in e.aliases:
                    entity_name_to_id[alias] = e.entity_id

            relations = []
            for rd in relations_data:
                src_id = entity_name_to_id.get(rd['source'], '')
                tgt_id = entity_name_to_id.get(rd['target'], '')
                if src_id and tgt_id:
                    relations.append(Relation(
                        source_entity_id=src_id,
                        target_entity_id=tgt_id,
                        relation_type=rd.get('type', 'related_to'),
                        confidence=rd.get('confidence', 0.7),
                    ))
            return relations
        except Exception as e:
            logger.warning(f"Relation extraction failed: {e}")
            return []

    async def _cluster_topics(
        self,
        chunks: List[Chunk],
        entities: List[Entity],
    ) -> List[Dict[str, Any]]:
        """主题聚类"""
        # 简单实现：基于实体类型聚类
        topic_groups = {}
        for entity in entities:
            topic = entity.entity_type
            if topic not in topic_groups:
                topic_groups[topic] = []
            topic_groups[topic].append(entity.name)

        topics = []
        for topic_name, members in topic_groups.items():
            topics.append({
                'name': topic_name,
                'members': members,
                'chunk_count': sum(
                    1 for c in chunks
                    if any(m.lower() in c.content.lower() for m in members[:5])
                ),
            })

        return topics

    async def _generate_summary(
        self,
        doc: NormalizedDocument,
        entities: List[Entity],
        topics: List[Dict],
    ) -> str:
        """生成文档摘要"""
        entity_list = ', '.join(e.name for e in entities[:10])
        topic_list = ', '.join(t['name'] for t in topics[:5])

        prompt = f"""用 2-3 句话总结以下文档的核心内容。

标题：{doc.title}
作者：{doc.author}
涉及实体：{entity_list}
涉及主题：{topic_list}

正文（节选）：
{doc.body[:1500]}
"""

        try:
            response = await self.llm_client.chat(
                messages=[{"role": "user", "content": prompt}],
                model="deepseek-v3",
                max_tokens=300,
            )
            return response.strip()
        except Exception as e:
            logger.warning(f"Summary generation failed: {e}")
            return f"Document from {doc.source_type.value}: {doc.title}"
```

## 六、完整管道编排

### 6.1 管道编排器

```python
# openhuman/pipeline/orchestrator.py
import asyncio
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from .adapters.base import SourceAdapter
from .normalizer import DocumentNormalizer
from .chunker import DocumentChunker
from .memory_tree_builder import MemoryTreeBuilder
from .models import RawDocument, SourceType
import logging
import time

logger = logging.getLogger(__name__)


class PipelineOrchestrator:
    """
    数据管道编排器。

    职责：
    1. 管理所有数据源适配器
    2. 协调摄入 → 规范化 → 分块 → 记忆树构建的完整流程
    3. 增量同步与去重
    4. 错误处理与重试
    5. 性能监控
    """

    def __init__(
        self,
        adapters: Dict[str, SourceAdapter],
        normalizer: DocumentNormalizer,
        chunker: DocumentChunker,
        memory_builder: MemoryTreeBuilder,
        memory_store,
        sync_interval_minutes: int = 20,
    ):
        self.adapters = adapters
        self.normalizer = normalizer
        self.chunker = chunker
        self.memory_builder = memory_builder
        self.memory_store = memory_store
        self.sync_interval = sync_interval_minutes
        self._running = False
        self._task = None

        # 同步状态
        self.last_sync: Dict[str, datetime] = {}
        self.sync_stats = {
            'total_documents': 0,
            'total_chunks': 0,
            'total_entities': 0,
            'errors': 0,
        }

    async def start(self):
        """启动管道（定期自动同步）"""
        self._running = True
        self._task = asyncio.create_task(self._sync_loop())
        logger.info(f"Pipeline started, sync interval: {self.sync_interval} minutes")

    async def stop(self):
        """停止管道"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Pipeline stopped")

    async def _sync_loop(self):
        """主同步循环"""
        while self._running:
            try:
                await self.sync_all()
            except Exception as e:
                logger.error(f"Sync loop error: {e}", exc_info=True)

            await asyncio.sleep(self.sync_interval * 60)

    async def sync_all(self) -> Dict[str, Any]:
        """
        执行全量同步。

        从所有适配器获取数据，经过完整管道处理。
        """
        start_time = time.time()
        results = {}

        # 并行从所有数据源获取
        fetch_tasks = []
        adapter_names = []
        for name, adapter in self.adapters.items():
            if adapter.enabled:
                since = self.last_sync.get(name)
                fetch_tasks.append(adapter.fetch(since=since, limit=100))
                adapter_names.append(name)

        raw_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

        for i, result in enumerate(raw_results):
            name = adapter_names[i]
            if isinstance(result, Exception):
                logger.error(f"Fetch error from {name}: {result}")
                self.sync_stats['errors'] += 1
                results[name] = {'error': str(result)}
                continue

            raw_docs = result
            logger.info(f"Fetched {len(raw_docs)} documents from {name}")

            # 处理管道
            doc_results = await self._process_documents(raw_docs)
            results[name] = doc_results

            # 更新同步时间
            self.last_sync[name] = datetime.now()

        elapsed = time.time() - start_time
        logger.info(
            f"Sync complete in {elapsed:.1f}s: "
            f"docs={self.sync_stats['total_documents']}, "
            f"chunks={self.sync_stats['total_chunks']}, "
            f"entities={self.sync_stats['total_entities']}"
        )

        return results

    async def _process_documents(self, raw_docs: List[RawDocument]) -> Dict[str, int]:
        """
        处理文档管道：规范化 → 分块 → 记忆树构建。

        使用信号量控制并发度，避免 API 限流。
        """
        semaphore = asyncio.Semaphore(3)  # 最多 3 个并发
        stats = {'processed': 0, 'skipped': 0, 'errors': 0}

        async def process_one(raw_doc):
            async with semaphore:
                try:
                    # 步骤 1：规范化
                    doc = self.normalizer.normalize(raw_doc)
                    if not doc:
                        stats['skipped'] += 1
                        return

                    # 去重检查
                    if await self.memory_store.exists(doc.doc_id):
                        stats['skipped'] += 1
                        return

                    # 步骤 2：分块
                    chunks = self.chunker.chunk(doc)

                    # 步骤 3：记忆树构建
                    memory_tree = await self.memory_builder.build_from_chunks(chunks, doc)

                    # 步骤 4：存储
                    await self.memory_store.store(doc, chunks, memory_tree)

                    stats['processed'] += 1
                    self.sync_stats['total_documents'] += 1
                    self.sync_stats['total_chunks'] += len(chunks)
                    self.sync_stats['total_entities'] += len(memory_tree.get('entities', []))

                except Exception as e:
                    stats['errors'] += 1
                    self.sync_stats['errors'] += 1
                    logger.error(f"Processing error for {raw_doc.source_id}: {e}")

        # 并行处理所有文档
        tasks = [process_one(doc) for doc in raw_docs]
        await asyncio.gather(*tasks)

        return stats

    async def sync_single(self, source_type: str, source_id: str) -> bool:
        """同步单个文档"""
        adapter = self.adapters.get(source_type)
        if not adapter:
            logger.error(f"Unknown source type: {source_type}")
            return False

        raw_doc = await adapter.fetch_single(source_id)
        if not raw_doc:
            logger.error(f"Document not found: {source_id}")
            return False

        result = await self._process_documents([raw_doc])
        return result.get('processed', 0) > 0

    def get_status(self) -> Dict[str, Any]:
        """获取管道状态"""
        return {
            'running': self._running,
            'sync_interval_minutes': self.sync_interval,
            'last_sync': {
                name: dt.isoformat() for name, dt in self.last_sync.items()
            },
            'stats': self.sync_stats,
            'adapters': {
                name: {
                    'enabled': adapter.enabled,
                    'source_type': adapter.source_type.value,
                }
                for name, adapter in self.adapters.items()
            },
        }
```

### 6.2 启动配置

```yaml
# config/pipeline.yaml
pipeline:
  sync_interval_minutes: 20
  max_concurrent_processing: 3
  chunk_size: 2000
  chunk_overlap: 200

  sources:
    gmail:
      enabled: true
      credentials_path: "credentials/gmail.json"
      token_path: "credentials/gmail_token.json"
      label_filter: "INBOX"
      exclude_labels: ["SPAM", "TRASH", "Promotions"]
      max_body_length: 50000

    slack:
      enabled: true
      bot_token: "${SLACK_BOT_TOKEN}"
      channels: []  # 空 = 所有频道
      exclude_channels: ["random", "fun"]
      include_threads: true
      sync_interval_minutes: 10

    github:
      enabled: true
      token: "${GITHUB_TOKEN}"
      repos:
        - "mikeah2011/project-x"
        - "mikeah2011/project-y"
      include_issues: true
      include_prs: true
      include_reviews: true
      state_filter: "all"

    local_files:
      enabled: true
      watch_paths:
        - "~/Documents/notes"
        - "~/Documents/projects"
      extensions: [".md", ".txt", ".org"]
```

## 七、最佳实践与注意事项

### 7.1 数据摄入的注意事项

1. **API 限流**：所有外部 API 都有调用频率限制，务必在适配器中实现限流
2. **增量同步**：只获取上次同步后的新数据，避免重复处理
3. **错误隔离**：单个文档处理失败不应影响整个管道
4. **隐私合规**：敏感数据（如邮件中的个人信息）在进入记忆系统前需要脱敏

### 7.2 分块策略选择

- **邮件**：通常不需要分块，单封邮件就是一个完整的语义单元
- **Slack 消息**：同一 thread 的消息可以合并为一个文档再分块
- **GitHub Issue**：Issue 正文 + 评论合并分块，保持上下文连贯
- **长文档**：使用滑动窗口 + 语义边界感知

### 7.3 记忆树的维护

- 定期清理不再相关的实体和关系
- 合并指向同一概念的重复实体
- 根据提及频率调整实体的重要性权重
- 用户手动编辑（通过 Obsidian Wiki）的记忆优先级最高

## 总结

OpenHuman 的源适配器架构通过四层管道（摄入 → 规范化 → 分块 → 记忆树构建），实现了从 Gmail、Slack、GitHub 等异构数据源到统一记忆系统的自动化数据流转。其核心设计价值在于：

1. **适配器模式**：每个数据源一个独立适配器，新增数据源只需实现适配器接口
2. **规范化抽象**：屏蔽不同数据源的格式差异，下游处理无需关心数据来源
3. **智能分块**：根据文档类型选择最佳分块策略，平衡上下文完整性和处理效率
4. **增量同步**：只处理新数据，避免重复计算
5. **并发控制**：信号量限流 + 并行处理，兼顾效率和稳定性

这套管道不仅为 OpenHuman 的记忆系统提供数据支撑，其架构模式也可以被任何需要多源数据整合的 AI Agent 系统所复用。

## 相关阅读

- [OpenHuman Memory Tree 深度剖析：确定性分块、实体提取、主题树与全局摘要](/categories/架构/OpenHuman-Memory-Tree-深度剖析-确定性分块-实体提取-主题树-全局摘要四层架构/)
- [OpenHuman 知识图谱构建实战：实体索引、关系提取与力导向可视化](/categories/架构/OpenHuman-知识图谱构建实战-实体索引-关系提取-力导向可视化/)
- [Hermes MCP 集成架构：动态工具发现与传输安全](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/)
