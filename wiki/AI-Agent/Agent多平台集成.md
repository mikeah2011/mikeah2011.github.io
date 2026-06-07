# Agent 多平台集成

## 定义

Agent 多平台集成是指将 AI Agent 接入 Telegram、Discord、微信、WhatsApp 等多个即时通讯平台，通过统一消息网关实现「一套 Agent，多端服务」的工程化方案。

## 核心原理

### 平台 API 对比

| 平台 | Bot API | 消息格式 | 速率限制 | 富媒体 | 群组支持 |
|------|---------|---------|---------|--------|---------|
| Telegram | Bot API | Markdown/HTML | 30 msg/s | 图片/视频/文件 | ✅ |
| Discord | Discord.js/REST | Embed/Components | 5 msg/s | Embed/按钮/菜单 | ✅ |
| 微信 | 企业微信 API | XML/JSON | 20 msg/s | 图文/小程序 | ✅ |
| WhatsApp | Cloud API | Template/Text | 80 msg/s | 图片/文档 | ✅ |

### 统一消息网关架构

```
Telegram ──┐
Discord  ──┤    ┌─────────────┐    ┌──────────────┐
微信     ──┼──→ │ 消息适配层   │──→ │ Agent 核心   │
WhatsApp ──┤    │ (统一格式)   │    │ (LLM + Tools)│
Slack    ──┘    └─────────────┘    └──────────────┘
                       │
                       ▼
              ┌─────────────┐
              │ 平台适配层   │
              │ (回复格式化) │
              └─────────────┘
                       │
Telegram ←──┐
Discord  ←──┤
微信     ←──┤
WhatsApp ←──┘
```

### 消息格式标准化

```python
class UnifiedMessage:
    platform: str       # telegram, discord, wechat, whatsapp
    user_id: str
    chat_id: str
    text: str
    media: list         # 图片/文件/音频
    reply_to: str       # 回复的消息 ID
    timestamp: datetime

class MessageAdapter:
    def to_unified(self, platform_message) -> UnifiedMessage:
        """平台消息 → 统一格式"""
        ...
    
    def from_unified(self, unified_message) -> PlatformMessage:
        """统一格式 → 平台消息"""
        ...
```

### 合规与限制

| 平台 | 关键限制 | 合规要求 |
|------|---------|---------|
| Telegram | 无端到端加密（Bot） | GDPR |
| Discord | 2000 字符限制 | ToS 合规 |
| 微信 | 严格的审核机制 | 实名认证、内容审核 |
| WhatsApp | 模板消息限制 | Business 验证 |

## 实战案例

来自博客文章：
- [Agent 多平台集成：Telegram/Discord/WeChat/WhatsApp](/2026/06/02/ai-agent-multi-platform-integration-telegram-discord-wechat-whatsapp/) - 统一消息网关实战

## 相关概念

- [Agent 流式响应](Agent流式响应.md) - 多平台的流式消息推送
- [Agent 安全与护栏](Agent安全与护栏.md) - 多平台内容审核
- [Agent 多租户架构](Agent多租户架构.md) - 按平台的用户隔离

## 常见问题

### Q: 如何处理不同平台的消息长度限制？
分段发送：长消息按平台限制拆分。Telegram 4096 字符、Discord 2000 字符、微信 2048 字节。

### Q: 如何统一处理图片/文件？
下载到统一存储（S3/OSS）→ 生成临时链接 → 传递给 Agent 处理。
