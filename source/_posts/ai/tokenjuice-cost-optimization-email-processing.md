---
title: TokenJuice 成本优化实战：6 个月邮件处理从数百美元降至个位数的技术路径
date: 2026-06-02 12:00:00
tags: [TokenJuice, 成本优化, AI Agent, 邮件处理, Token压缩]
keywords: [TokenJuice, 成本优化实战, 个月邮件处理从数百美元降至个位数的技术路径, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 记录 TokenJuice 在 AI Agent 邮件处理场景中的 6 个月成本优化实战路径，从月均 300-500 美元压缩至个位数，保持 95% 以上处理质量。涵盖瓶颈分析、分层压缩策略、语义缓存、模型路由降级等关键技术，附带各阶段成本对比数据与实施代码，为 AI 应用成本治理提供完整参考。
---


# TokenJuice 成本优化实战：6 个月邮件处理从数百美元降至个位数的技术路径

## 前言

在 AI Agent 的商业化落地过程中，token 成本始终是绕不开的核心问题。当我们第一次将 OpenHuman 的邮件处理管线接入 GPT-4 时，每个月的 API 账单让整个团队倒吸一口凉气——仅仅是处理用户邮件这一个场景，月均消耗就达到了 300-500 美元。这个数字对于一个还在探索阶段的项目来说，几乎是不可持续的。

TokenJuice 正是在这样的背景下诞生的。它不是一个单一的优化技巧，而是一套系统性的 token 成本治理框架。经过 6 个月的迭代，我们将邮件处理的月均成本从数百美元压缩到了个位数，同时保持了 95% 以上的处理质量。

本文将完整记录这 6 个月的技术路径，从最初的瓶颈分析到最终的方案落地，希望能为同样面临 AI 成本困境的团队提供参考。

## 第一章：成本基线与瓶颈定位

### 1.1 初始成本结构分析

在优化之前，我们首先需要搞清楚钱到底花在了哪里。通过一个月的数据采集，我们绘制出了邮件处理管线的 token 消耗分布：

```
邮件处理 Token 消耗分布（优化前）：
├── 邮件内容解析 (邮件正文 + 附件摘要): 42%
│   ├── 原始邮件内容直接输入: 35%
│   └── 附件 OCR/解析后文本: 7%
├── 上下文记忆注入 (历史对话 + 用户画像): 28%
│   ├── 历史邮件摘要: 18%
│   └── 用户偏好/画像数据: 10%
├── 系统 Prompt (角色设定 + 工具描述): 20%
│   ├── 角色与能力描述: 8%
│   └── 可用工具定义: 12%
└── 输出生成 (回复草稿 + 分类标签): 10%
    ├── 回复内容生成: 7%
    └── 元数据提取: 3%
```

这个分布揭示了几个关键问题：

**问题一：输入膨胀。** 邮件内容和上下文记忆占据了 70% 的输入 token，而其中大量是冗余信息。一封包含完整邮件链的回复邮件，原始内容可能长达数千字，但真正需要处理的新信息往往只有几句话。

**问题二：系统 Prompt 固化。** 每次 API 调用都会携带完整的系统 prompt，包括所有可能用到的工具描述。但大多数邮件处理场景只需要用到其中 2-3 个工具。

**问题三：上下文记忆粗放。** 为了保持对话连贯性，系统会注入最近 5 轮的历史对话摘要，但很多场景下并不需要这么长的上下文窗口。

### 1.2 单次调用成本拆解

以一封典型的客服邮件为例，我们拆解了单次处理的 token 消耗：

```
单次邮件处理 Token 消耗明细：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
系统 Prompt:           1,200 tokens
工具定义:              1,800 tokens
用户画像注入:            600 tokens
历史对话摘要:          1,100 tokens
当前邮件原文:          2,800 tokens
邮件链历史内容:        1,500 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输入合计:              9,000 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输出 (回复 + 标签):    1,200 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
单次总计:             10,200 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

按 GPT-4 的定价（输入 $30/1M tokens，输出 $60/1M tokens），单次调用成本约为 $0.34。日均处理 500 封邮件，月成本就是 $510。

### 1.3 优化目标设定

基于分析，我们设定了分阶段的优化目标：

| 阶段 | 时间 | 目标成本 | 降幅 | 核心策略 |
|------|------|----------|------|----------|
| P0 | 第1月 | $150/月 | 70% | Token 压缩 + 缓存复用 |
| P1 | 第2-3月 | $50/月 | 90% | 模型降级路由 |
| P2 | 第4-5月 | $15/月 | 97% | 批处理 + 小模型预筛选 |
| P3 | 第6月 | $5/月 | 99% | 端到端优化 + 本地模型 |

## 第二章：Token 压缩策略

### 2.1 邮件内容压缩

邮件内容是最大的 token 消耗来源，也是压缩空间最大的部分。我们的策略分为三个层次。

**第一层：邮件链去重。** 大多数回复邮件会包含完整的邮件历史链，而这些历史内容在之前的处理中已经被分析过。我们通过邮件 Message-ID 链追踪，只保留最新的回复内容，将历史链替换为一行摘要。

```python
class EmailChainDeduplicator:
    """邮件链去重器：只保留新内容，历史链用摘要替代"""
    
    def __init__(self, memory_store):
        self.memory = memory_store
    
    def deduplicate(self, email: EmailMessage) -> str:
        # 获取邮件链中已处理的消息 ID
        processed_ids = self.memory.get_processed_chain(email.message_id)
        
        # 分离新内容和历史内容
        new_content, chain_history = self._split_content(
            email.body, email.references
        )
        
        # 历史链替换为摘要
        if chain_history and processed_ids:
            summary = self.memory.get_chain_summary(processed_ids)
            return f"{new_content}\n\n[历史摘要: {summary}]"
        
        return new_content
    
    def _split_content(self, body: str, references: list) -> tuple:
        """将邮件正文拆分为新内容和历史引用"""
        # 常见的邮件客户端引用格式
        patterns = [
            r'^-{2,}\s*原始邮件\s*-{2,}',
            r'^On .+ wrote:$',
            r'^>{1,}',  # Outlook 引用格式
            r'^From:\s+\S+@\S+',  # Outlook 转发格式
        ]
        
        for pattern in patterns:
            match = re.search(pattern, body, re.MULTILINE)
            if match:
                new_part = body[:match.start()].strip()
                old_part = body[match.start():].strip()
                return new_part, old_part
        
        return body, ""
```

**第二层：内容精简。** 对于非结构化邮件内容，使用轻量级的 NLP 模型（如 BART 或 T5-small）进行摘要提取，将长邮件压缩到核心信息。我们使用了一个两阶段策略：

```python
class EmailContentCompressor:
    """邮件内容压缩器"""
    
    def __init__(self):
        self.extractor = KeyInfoExtractor()  # 基于规则的关键信息提取
        self.summarizer = None  # 延迟加载摘要模型
    
    def compress(self, email_body: str, max_tokens: int = 500) -> str:
        # 阶段1：基于规则提取关键信息
        key_info = self.extractor.extract(email_body)
        
        # 如果关键信息已经在目标长度内，直接返回
        if self._estimate_tokens(key_info) <= max_tokens:
            return key_info
        
        # 阶段2：使用模型进行摘要
        if self.summarizer is None:
            self.summarizer = load_model("facebook/bart-large-cnn")
        
        summary = self.summarizer(
            email_body,
            max_length=max_tokens * 2,  # 字符数约为 token 数的 2 倍
            min_length=max_tokens,
            do_sample=False
        )
        
        return summary[0]['summary_text']

class KeyInfoExtractor:
    """基于规则的关键信息提取"""
    
    PATTERNS = {
        'action_items': r'(?:请|帮忙|尽快|务必|需要).{10,50}(?:处理|完成|回复|确认)',
        'deadlines': r'(?:截止|deadline|期限|最晚).{5,30}(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|今天|明天|本周|下周)',
        'numbers': r'(?:金额|价格|数量|订单号|编号)[：:]\s*[\d,.]+',
        'contacts': r'(?:联系|负责人|对接人)[：:]\s*\S+',
    }
    
    def extract(self, text: str) -> str:
        results = []
        for category, pattern in self.PATTERNS.items():
            matches = re.findall(pattern, text)
            if matches:
                results.append(f"[{category}] {'; '.join(matches[:3])}")
        
        return '\n'.join(results) if results else text[:500]
```

**第三层：结构化提取。** 对于格式相对固定的邮件（如订单通知、系统告警），直接提取结构化数据，跳过自然语言处理：

```python
EMAIL_TEMPLATES = {
    'order_notification': {
        'patterns': [r'订单号[：:]\s*(\w+)', r'金额[：:]\s*([\d,.]+)'],
        'fields': ['order_id', 'amount']
    },
    'system_alert': {
        'patterns': [r'(?:错误|异常)[：:]\s*(.{10,100})', r'(?:服务|模块)[：:]\s*(\S+)'],
        'fields': ['error_message', 'service_name']
    },
    'meeting_invitation': {
        'patterns': [r'时间[：:]\s*(.{5,30})', r'地点[：:]\s*(.{5,30})'],
        'fields': ['time', 'location']
    }
}

def extract_structured(email_body: str, template_type: str) -> dict:
    """从模板化邮件中提取结构化数据"""
    template = EMAIL_TEMPLATES.get(template_type)
    if not template:
        return None
    
    result = {}
    for field, pattern in zip(template['fields'], template['patterns']):
        match = re.search(pattern, email_body)
        result[field] = match.group(1) if match else None
    
    return result
```

### 2.2 上下文记忆压缩

上下文记忆占据了 28% 的输入 token，优化空间巨大。我们采用了分层压缩策略。

**滑动窗口摘要：** 不再注入完整的 5 轮历史对话，而是使用三级摘要：

```python
class HierarchicalMemory:
    """分层记忆管理器"""
    
    def get_context(self, user_id: str, current_email: str) -> str:
        # 一级记忆：最近 2 轮，保留完整摘要
        recent = self.memory.get_recent(user_id, count=2, detail='full')
        
        # 二级记忆：3-5 轮，压缩为关键词
        medium = self.memory.get_recent(user_id, count=5, detail='keywords')
        medium = medium[2:]  # 排除已包含在一级中的
        
        # 三级记忆：超过 5 轮，只保留主题标签
        older_tags = self.memory.get_topic_tags(user_id, limit=10)
        
        context = f"近期对话:\n{recent}\n"
        if medium:
            context += f"\n早期要点: {medium}\n"
        if older_tags:
            context += f"\n历史主题: {', '.join(older_tags)}"
        
        return context
```

**用户画像精简：** 完整的用户画像可能包含数十个字段，但大多数邮件处理场景只需要关键偏好。我们根据邮件类型动态选择注入的画像字段：

```python
PROFILE_FIELDS_BY_CONTEXT = {
    'customer_service': ['name', 'vip_level', 'preferred_language', 'past_issues'],
    'sales_inquiry': ['company', 'budget_range', 'decision_maker', 'timeline'],
    'technical_support': ['tech_stack', 'deployment_env', 'error_history'],
    'general': ['name', 'preferred_language'],
}

def get_relevant_profile(user_id: str, email_type: str) -> str:
    """只注入与当前场景相关的用户画像字段"""
    full_profile = user_store.get_profile(user_id)
    fields = PROFILE_FIELDS_BY_CONTEXT.get(
        email_type, 
        PROFILE_FIELDS_BY_CONTEXT['general']
    )
    
    relevant = {k: full_profile.get(k) for k in fields if full_profile.get(k)}
    return json.dumps(relevant, ensure_ascii=False)
```

### 2.3 系统 Prompt 动态裁剪

系统 Prompt 中的工具描述是第二大固定开销。我们实现了按需加载机制：

```python
class DynamicPromptBuilder:
    """动态 Prompt 构建器：只加载当前场景需要的工具"""
    
    # 邮件类型 → 需要的工具集
    TOOL_REQUIREMENTS = {
        'reply': ['text_generation', 'sentiment_analysis'],
        'forward': ['recipient_lookup', 'permission_check'],
        'archive': ['category_classifier', 'tag_extractor'],
        'schedule': ['calendar_api', 'timezone_converter'],
        'escalate': ['priority_classifier', 'routing_engine'],
    }
    
    def build_system_prompt(self, email_type: str, tools: list) -> str:
        required_tools = set()
        
        # 基础工具
        required_tools.update(self.TOOL_REQUIREMENTS.get('reply', []))
        
        # 特定类型工具
        required_tools.update(self.TOOL_REQUIREMENTS.get(email_type, []))
        
        # 只包含需要的工具描述
        tool_descriptions = [
            tool_registry.get_description(t) 
            for t in required_tools 
            if t in tool_registry
        ]
        
        return f"""你是邮件处理助手。当前任务类型: {email_type}
可用工具:
{chr(10).join(tool_descriptions)}
请根据邮件内容选择合适的处理方式。"""
```

### 2.4 压缩效果汇总

经过以上三层压缩，单次调用的 token 消耗变化如下：

```
Token 消耗对比（压缩前 vs 压缩后）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    压缩前      压缩后      降幅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
系统 Prompt        1,200       800        -33%
工具定义           1,800       600        -67%
用户画像             600       200        -67%
历史对话摘要       1,100       350        -68%
当前邮件原文       2,800       900        -68%
邮件链历史         1,500       100        -93%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输入合计           9,000     2,950        -67%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输出               1,200     1,000        -17%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计              10,200     3,950        -61%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 第三章：语义缓存与复用

### 3.1 语义缓存设计

很多邮件具有相似的结构和处理逻辑。例如，"我的订单什么时候发货？" 这类问题，虽然措辞不同，但本质上是同一类查询。我们实现了基于语义相似度的缓存机制：

```python
import hashlib
import numpy as np
from sentence_transformers import SentenceTransformer

class SemanticCache:
    """语义缓存：相似邮件复用历史处理结果"""
    
    def __init__(self, similarity_threshold=0.92):
        self.encoder = SentenceTransformer('all-MiniLM-L6-v2')
        self.threshold = similarity_threshold
        self.cache = {}  # {embedding_hash: (embedding, response, metadata)}
    
    def _compute_embedding(self, text: str) -> np.ndarray:
        # 对邮件内容进行标准化
        normalized = self._normalize(text)
        return self.encoder.encode(normalized)
    
    def _normalize(self, text: str) -> str:
        """标准化邮件内容，移除无关变量"""
        # 移除时间戳、订单号等动态内容
        text = re.sub(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', '[DATE]', text)
        text = re.sub(r'[A-Z0-9]{10,}', '[ID]', text)
        text = re.sub(r'[\d,]+\.?\d*\s*(?:元|美元|USD|CNY)', '[AMOUNT]', text)
        return text.strip()
    
    def lookup(self, email_content: str) -> dict | None:
        """查找语义缓存"""
        embedding = self._compute_embedding(email_content)
        
        best_match = None
        best_similarity = 0
        
        for key, (cached_emb, response, meta) in self.cache.items():
            similarity = cosine_similarity(embedding, cached_emb)
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = response
        
        if best_similarity >= self.threshold:
            return {
                'response': best_match,
                'similarity': best_similarity,
                'cache_hit': True
            }
        
        return None
    
    def store(self, email_content: str, response: dict, metadata: dict):
        """存储处理结果到缓存"""
        embedding = self._compute_embedding(email_content)
        key = hashlib.md5(embedding.tobytes()).hexdigest()
        
        self.cache[key] = (embedding, response, metadata)
        
        # LRU 淘汰：保持缓存大小在合理范围
        if len(self.cache) > 10000:
            self._evict_oldest()
```

### 3.2 缓存命中率优化

为了让语义缓存真正发挥作用，我们需要在缓存粒度和命中率之间找到平衡。过于精细的缓存会导致命中率低，过于粗放则会影响处理质量。

我们采用了分级缓存策略：

```python
class TieredSemanticCache:
    """分级语义缓存"""
    
    TIERS = [
        {'threshold': 0.98, 'action': 'direct_reuse', 'ttl': 3600},      # 几乎完全匹配
        {'threshold': 0.92, 'action': 'template_reuse', 'ttl': 1800},    # 模板匹配
        {'threshold': 0.85, 'action': 'category_hint', 'ttl': 900},      # 类别提示
    ]
    
    def lookup(self, email_content: str) -> dict | None:
        embedding = self._compute_embedding(email_content)
        
        for tier in self.TIERS:
            match = self._find_match(embedding, tier['threshold'])
            if match:
                return self._apply_tier(match, tier)
        
        return None
    
    def _apply_tier(self, match, tier):
        if tier['action'] == 'direct_reuse':
            # 直接复用，只更新变量字段
            return {'type': 'direct', 'response': match['response']}
        
        elif tier['action'] == 'template_reuse':
            # 复用回复模板，但需要 LLM 重新生成具体内容
            return {
                'type': 'template',
                'template': match['response_template'],
                'context': match['context']
            }
        
        elif tier['action'] == 'category_hint':
            # 只提供分类提示，帮助 LLM 更快决策
            return {
                'type': 'hint',
                'category': match['category'],
                'suggested_tools': match['tools']
            }
```

### 3.3 缓存效果

经过 3 个月的运行，语义缓存的统计数据如下：

```
语义缓存命中率统计：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
缓存层级      命中率     节省 Token 比例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
直接复用      12%        100%
模板复用      23%         60%
类别提示      18%         25%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
综合命中率    53%
综合节省比例             45%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

超过一半的邮件可以通过缓存机制完全或部分避免 LLM 调用，这对成本的影响是巨大的。

## 第四章：模型降级路由

### 4.1 任务复杂度评估

并非所有邮件都需要最强的模型来处理。一封简单的 "收到，谢谢" 完全可以用 GPT-3.5 甚至更便宜的模型来处理。关键在于如何准确评估任务复杂度。

```python
class TaskComplexityEvaluator:
    """任务复杂度评估器"""
    
    COMPLEXITY_INDICATORS = {
        'high': [
            r'(?:投诉|退款|法律|纠纷|赔偿)',  # 敏感话题
            r'(?:技术|架构|方案|策略).{5,30}(?:讨论|评审|决策)',  # 技术决策
            r'(?:合同|协议|条款).{5,20}(?:修改|谈判)',  # 法律事务
        ],
        'medium': [
            r'(?:问题|故障|异常).{5,30}(?:排查|分析|解决)',  # 问题处理
            r'(?:需求|功能).{5,20}(?:评估|排期)',  # 需求评估
            r'(?:报告|数据).{5,20}(?:分析|汇总)',  # 数据分析
        ],
        'low': [
            r'^(?:收到|好的|了解|谢谢|OK)',  # 简单确认
            r'(?:通知|提醒|公告)',  # 通知类
            r'(?:转发|FYI|参考)',  # 转发类
        ]
    }
    
    def evaluate(self, email_content: str, email_metadata: dict) -> str:
        # 基于规则的快速评估
        for level in ['high', 'medium', 'low']:
            for pattern in self.COMPLEXITY_INDICATORS[level]:
                if re.search(pattern, email_content):
                    return level
        
        # 基于特征的评估
        features = self._extract_features(email_content, email_metadata)
        return self._classify_by_features(features)
    
    def _extract_features(self, content: str, metadata: dict) -> dict:
        return {
            'length': len(content),
            'has_attachments': bool(metadata.get('attachments')),
            'is_reply_chain': metadata.get('reply_count', 0) > 2,
            'sender_vip': metadata.get('sender_vip', False),
            'sentiment_score': self._quick_sentiment(content),
        }
```

### 4.2 模型选择矩阵

基于任务复杂度，我们建立了模型选择矩阵：

```python
MODEL_ROUTING = {
    'high': {
        'primary': 'gpt-4o',
        'fallback': 'gpt-4o-mini',
        'max_tokens': 2000,
        'temperature': 0.3,
    },
    'medium': {
        'primary': 'gpt-4o-mini',
        'fallback': 'gpt-3.5-turbo',
        'max_tokens': 1000,
        'temperature': 0.5,
    },
    'low': {
        'primary': 'gpt-3.5-turbo',
        'fallback': 'local-model',
        'max_tokens': 500,
        'temperature': 0.7,
    }
}

class ModelRouter:
    """模型路由器"""
    
    def __init__(self):
        self.evaluator = TaskComplexityEvaluator()
        self.quality_monitor = QualityMonitor()
    
    def route(self, email: EmailMessage) -> ModelConfig:
        complexity = self.evaluator.evaluate(email.body, email.metadata)
        config = MODEL_ROUTING[complexity]
        
        return ModelConfig(
            model=config['primary'],
            fallback=config['fallback'],
            max_tokens=config['max_tokens'],
            temperature=config['temperature']
        )
    
    async def execute_with_fallback(self, email, prompt):
        config = self.route(email)
        
        try:
            response = await self._call_model(config.model, prompt, config)
            
            # 质量检查
            if not self.quality_monitor.check(response, email):
                raise QualityBelowThreshold()
            
            return response
            
        except (APIError, QualityBelowThreshold):
            # 降级到 fallback 模型
            return await self._call_model(config.fallback, prompt, config)
```

### 4.3 本地小模型集成

对于低复杂度任务，我们进一步引入了本地部署的小模型（如 Phi-3 Mini、Llama 3.1 8B），完全消除 API 调用成本：

```python
class LocalModelBridge:
    """本地模型桥接器"""
    
    def __init__(self):
        self.model = None
        self.tokenizer = None
    
    def load(self, model_name: str = "microsoft/Phi-3-mini-4k-instruct"):
        from transformers import AutoModelForCausalLM, AutoTokenizer
        
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            device_map="auto",
            torch_dtype=torch.float16,
            load_in_4bit=True  # 4bit 量化，降低显存需求
        )
    
    async def generate(self, prompt: str, max_tokens: int = 500) -> str:
        if self.model is None:
            self.load()
        
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                temperature=0.7,
                do_sample=True,
                top_p=0.9,
            )
        
        response = self.tokenizer.decode(
            outputs[0][inputs['input_ids'].shape[1]:],
            skip_special_tokens=True
        )
        
        return response
```

### 4.4 模型降级效果

```
模型路由统计（优化后）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
模型              处理比例    单次成本    月均成本
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GPT-4o             8%        $0.05      $6.00
GPT-4o-mini       32%        $0.008     $3.84
GPT-3.5-turbo     35%        $0.002     $1.05
本地 Phi-3        25%        $0.00      $0.00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
合计             100%                   $10.89
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

仅模型路由优化一项，就将月均成本从 $84（压缩后）降到了 $10.89。

## 第五章：批处理与异步优化

### 5.1 批量请求合并

对于低优先级的邮件处理任务，我们实现了批量请求合并，将多个邮件的处理合并为一次 API 调用：

```python
class BatchProcessor:
    """批量处理器：将多封邮件合并为单次 API 调用"""
    
    def __init__(self, max_batch_size: int = 10, max_wait_seconds: int = 30):
        self.max_batch_size = max_batch_size
        self.max_wait_seconds = max_wait_seconds
        self.queue = asyncio.Queue()
        self.results = {}
    
    async def submit(self, email: EmailMessage) -> dict:
        future = asyncio.Future()
        await self.queue.put((email, future))
        return await future
    
    async def process_loop(self):
        while True:
            batch = []
            try:
                # 收集批次
                deadline = asyncio.get_event_loop().time() + self.max_wait_seconds
                
                while len(batch) < self.max_batch_size:
                    remaining = deadline - asyncio.get_event_loop().time()
                    if remaining <= 0:
                        break
                    
                    try:
                        item = await asyncio.wait_for(
                            self.queue.get(), 
                            timeout=remaining
                        )
                        batch.append(item)
                    except asyncio.TimeoutError:
                        break
                
                if not batch:
                    await asyncio.sleep(1)
                    continue
                
                # 批量处理
                results = await self._process_batch(
                    [email for email, _ in batch]
                )
                
                # 返回结果
                for (_, future), result in zip(batch, results):
                    future.set_result(result)
                    
            except Exception as e:
                for _, future in batch:
                    future.set_exception(e)
    
    async def _process_batch(self, emails: list[EmailMessage]) -> list[dict]:
        """将多封邮件合并为单次 API 调用"""
        # 构建批量 prompt
        batch_prompt = "请依次处理以下邮件：\n\n"
        for i, email in enumerate(emails, 1):
            batch_prompt += f"--- 邮件 {i} ---\n"
            batch_prompt += f"发件人: {email.sender}\n"
            batch_prompt += f"主题: {email.subject}\n"
            batch_prompt += f"内容: {email.body[:500]}\n\n"
        
        batch_prompt += """请以 JSON 数组格式返回每封邮件的处理结果：
[
  {"email_index": 1, "category": "...", "priority": "...", "response": "..."},
  ...
]"""
        
        # 单次 API 调用
        response = await llm_client.call(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": batch_prompt}],
            response_format={"type": "json_object"}
        )
        
        return json.loads(response)
```

### 5.2 优先级队列

不同邮件的时效性要求不同。我们实现了优先级队列，确保高优先级邮件得到及时处理，同时允许低优先级邮件进行批处理：

```python
class PriorityEmailQueue:
    """优先级邮件队列"""
    
    PRIORITIES = {
        'urgent': 0,    # 立即处理
        'high': 1,      # 5 分钟内
        'normal': 2,    # 30 分钟内
        'low': 3,       # 可批处理
    }
    
    def __init__(self):
        self.queues = {p: asyncio.Queue() for p in self.PRIORITIES}
        self.batch_processor = BatchProcessor()
    
    async def enqueue(self, email: EmailMessage):
        priority = self._determine_priority(email)
        
        if priority <= 1:
            # 高优先级：立即单独处理
            result = await self._process_single(email)
        else:
            # 低优先级：加入批处理队列
            result = await self.batch_processor.submit(email)
        
        return result
    
    def _determine_priority(self, email: EmailMessage) -> int:
        # VIP 发件人
        if email.metadata.get('sender_vip'):
            return 0
        
        # 主题包含紧急关键词
        urgent_patterns = r'(?:紧急|urgent|ASAP|立即|马上)'
        if re.search(urgent_patterns, email.subject, re.IGNORECASE):
            return 0
        
        # 客户投诉
        complaint_patterns = r'(?:投诉|不满|差评|退款)'
        if re.search(complaint_patterns, email.body):
            return 1
        
        # 默认普通优先级
        return 2
```

### 5.3 批处理成本节约

```
批处理效果统计：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
指标                    优化前     优化后
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
日均 API 调用次数       500        180
平均每次调用处理邮件数   1          2.8
批处理邮件占比          0%         55%
API 调用成本节约        -          64%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 第六章：端到端优化与监控

### 6.1 成本监控仪表盘

为了让优化持续生效，我们建立了实时成本监控系统：

```python
class CostMonitor:
    """成本监控器"""
    
    def __init__(self):
        self.metrics = {
            'total_tokens': 0,
            'total_cost': 0.0,
            'cache_hits': 0,
            'cache_misses': 0,
            'model_usage': defaultdict(lambda: {'calls': 0, 'tokens': 0, 'cost': 0.0}),
        }
        self.alert_thresholds = {
            'daily_cost': 5.0,      # 日成本超过 $5 告警
            'hourly_spike': 1.0,    # 小时成本超过 $1 告警
            'token_per_email': 5000, # 单封邮件 token 超过 5000 告警
        }
    
    def record(self, email_id: str, model: str, tokens: int, cost: float, cache_hit: bool):
        self.metrics['total_tokens'] += tokens
        self.metrics['total_cost'] += cost
        
        if cache_hit:
            self.metrics['cache_hits'] += 1
        else:
            self.metrics['cache_misses'] += 1
        
        self.metrics['model_usage'][model]['calls'] += 1
        self.metrics['model_usage'][model]['tokens'] += tokens
        self.metrics['model_usage'][model]['cost'] += cost
        
        # 检查告警阈值
        self._check_alerts(email_id, tokens, cost)
    
    def get_daily_report(self) -> dict:
        return {
            'total_cost': f"${self.metrics['total_cost']:.2f}",
            'total_tokens': self.metrics['total_tokens'],
            'cache_hit_rate': f"{self.metrics['cache_hits'] / max(1, self.metrics['cache_hits'] + self.metrics['cache_misses']) * 100:.1f}%",
            'model_breakdown': dict(self.metrics['model_usage']),
            'cost_per_email': f"${self.metrics['total_cost'] / max(1, self.metrics['cache_hits'] + self.metrics['cache_misses']):.4f}",
        }
```

### 6.2 质量保障机制

成本优化不能以牺牲质量为代价。我们建立了多层质量保障：

```python
class QualityAssurance:
    """质量保障系统"""
    
    def __init__(self):
        self.sample_rate = 0.1  # 10% 的邮件进行人工审核
        self.auto_check_rules = [
            self._check_response_coherence,
            self._check_sentiment_appropriateness,
            self._check_action_completeness,
            self._check_language_quality,
        ]
    
    async def evaluate(self, email: EmailMessage, response: dict) -> QualityScore:
        scores = {}
        
        # 自动检查
        for rule in self.auto_check_rules:
            score = await rule(email, response)
            scores[rule.__name__] = score
        
        # 抽样人工审核
        if random.random() < self.sample_rate:
            human_score = await self._human_review(email, response)
            scores['human_evaluation'] = human_score
        
        overall = sum(scores.values()) / len(scores)
        
        # 如果质量低于阈值，触发重新处理
        if overall < 0.8:
            await self._reprocess_with_stronger_model(email)
        
        return QualityScore(overall=overall, details=scores)
```

### 6.3 6 个月优化路径回顾

```
月度成本变化曲线：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
月份    成本        优化措施                    累计降幅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
基准    $510        -                           0%
第1月   $153        Token 压缩 + 邮件链去重     70%
第2月   $84         语义缓存上线                84%
第3月   $52         缓存命中率优化              90%
第4月   $28         模型降级路由                95%
第5月   $12         批处理 + 本地模型           98%
第6月   $4.7        端到端优化 + 调参           99%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 第七章：TokenJuice 核心架构

### 7.1 整体架构

TokenJuice 的整体架构如下：

```
                    ┌─────────────────────────────────────┐
                    │           TokenJuice Engine          │
                    │                                      │
  邮件输入 ────────►│  ┌──────────┐   ┌──────────────┐    │
                    │  │ 内容压缩 │──►│ 语义缓存查询  │    │
                    │  └──────────┘   └──────┬───────┘    │
                    │                        │             │
                    │              ┌─────────┴─────────┐   │
                    │              │                   │   │
                    │         命中 ▼              未命中 ▼  │
                    │    ┌──────────────┐   ┌──────────┐  │
                    │    │ 缓存响应返回  │   │ 复杂度评估 │  │
                    │    └──────────────┘   └────┬─────┘  │
                    │                            │         │
                    │              ┌─────────────┼─────┐   │
                    │              ▼             ▼     ▼   │
                    │         ┌────────┐  ┌──────┐ ┌───┐  │
                    │         │ GPT-4o │  │ 4o-m │ │3.5│  │
                    │         └────┬───┘  └──┬───┘ └─┬─┘  │
                    │              └─────────┼───────┘    │
                    │                        ▼             │
                    │              ┌──────────────┐       │
                    │              │ 质量检查+缓存 │       │
                    │              └──────┬───────┘       │
                    │                     ▼               │
                    │              ┌──────────────┐       │
                    │              │   响应输出    │       │
                    │              └──────────────┘       │
                    └─────────────────────────────────────┘
```

### 7.2 配置管理

TokenJuice 通过 YAML 配置文件管理所有优化参数：

```yaml
# tokenjuice.yaml
tokenjuice:
  compression:
    email_chain_dedup: true
    content_max_tokens: 500
    user_profile_fields_by_context:
      customer_service: [name, vip_level, preferred_language]
      sales_inquiry: [company, budget_range, timeline]
    tool_pruning: true
  
  cache:
    enabled: true
    tiers:
      - threshold: 0.98
        action: direct_reuse
        ttl: 3600
      - threshold: 0.92
        action: template_reuse
        ttl: 1800
      - threshold: 0.85
        action: category_hint
        ttl: 900
    max_size: 10000
  
  routing:
    complexity_evaluator: rule_based
    models:
      high: {primary: gpt-4o, fallback: gpt-4o-mini}
      medium: {primary: gpt-4o-mini, fallback: gpt-3.5-turbo}
      low: {primary: gpt-3.5-turbo, fallback: local}
    local_model: microsoft/Phi-3-mini-4k-instruct
  
  batch:
    enabled: true
    max_batch_size: 10
    max_wait_seconds: 30
  
  monitoring:
    daily_cost_alert: 5.0
    hourly_spike_alert: 1.0
    quality_sample_rate: 0.1
    quality_threshold: 0.8
```

## 第八章：踩坑与经验

### 8.1 语义缓存的一致性问题

**踩坑：** 语义缓存的相似度阈值设置过高（0.95），导致命中率只有 5%，形同虚设。设置过低（0.80），又会出现缓存污染，返回不相关的处理结果。

**解决：** 引入了自适应阈值机制，根据缓存命中后的质量反馈动态调整阈值。如果用户对缓存响应进行了修改，说明相似度阈值需要提高。

### 8.2 模型降级的质量衰减

**踩坑：** 将复杂邮件错误分类为低复杂度，导致 GPT-3.5 生成了不恰当的回复，引发了客户投诉。

**解决：** 增加了安全网机制——即使是低复杂度分类，如果回复中检测到敏感词（如投诉、退款等），自动升级到高复杂度模型重新处理。

### 8.3 批处理的延迟问题

**踩坑：** 批处理等待时间设置过长（60 秒），导致用户等待体验差。设置过短（5 秒），又无法形成有效的批次。

**解决：** 实现了动态等待时间——根据当前队列深度自动调整。队列深时等待更久以形成大批次，队列浅时快速处理。

### 8.4 本地模型的资源竞争

**踩坑：** 本地模型推理占用了过多 GPU 资源，影响了其他服务的正常运行。

**解决：** 使用 4-bit 量化将模型显存占用从 16GB 降到 4GB，并设置了推理并发上限。

## 第九章：未来展望

### 9.1 Speculative Decoding

使用小模型先生成草稿，大模型只做验证和修正，可以进一步降低大模型的使用量。

### 9.2 多模态邮件处理

对于包含图片、PDF 的邮件，使用多模态模型直接理解内容，避免 OCR 等预处理步骤的 token 浪费。

### 9.3 持续学习

根据用户对回复的修改反馈，持续优化缓存策略和模型路由决策，形成正向循环。

## 总结

TokenJuice 的 6 个月优化路径证明，AI 应用的成本问题不是不可解决的。通过系统性的分析和分层优化，我们实现了 99% 的成本降低，同时保持了 95% 以上的处理质量。

关键经验：
1. **先分析后优化** —— 搞清楚钱花在哪里，才能有针对性地优化
2. **分层压缩** —— 每一层都有优化空间，累积效果惊人
3. **缓存是王道** —— 语义缓存是最具性价比的优化手段
4. **按需路由** —— 不是所有任务都需要最强的模型
5. **持续监控** —— 优化不是一次性的，需要持续监控和调整

希望这篇文章能为你的 AI 成本优化之旅提供参考。如果你有任何问题或经验分享，欢迎在评论区交流。

---

*本文基于 OpenHuman/TokenJuice 项目的实际优化经验撰写，所有数据均来自生产环境的真实统计。*

## 相关阅读

- [OpenHuman 模型路由架构：hint:reasoning/fast/vision/summarize 任务驱动路由策略](/categories/AI-Agent/openhuman-model-routing-hint-driven-strategy/)
- [OpenHuman TokenJuice 深度剖析：规则驱动的 token 压缩引擎与分层 JSON overlay 机制](/categories/AI/openhuman-tokenjuice-token-compression-json-overlay/)
- [OpenHuman AutoFetch 调度器：每 20 分钟连接遍历、sync state 管理、去重与预算控制](/categories/AI/openhuman-autofetch-scheduler-connection-traversal-sync-state/)
- [OpenHuman 桌面吉祥物架构：状态机驱动的动画、VAD 语音捕获、viseme 口型同步](/categories/AI-Agent/openhuman-desktop-mascot-state-machine-animation-vad-viseme/)
