# Agent 成本优化

## 定义

Agent 成本优化是指通过 Token 压缩、智能模型路由、本地推理等策略，在保持输出质量的前提下降低 LLM API 调用成本的工程化实践。

## 核心原理

### Token 压缩策略

#### LLMLingua 系统提示压缩

```python
from llmlingua import PromptCompressor

compressor = PromptCompressor(
    model_name="microsoft/llmlingua-2-xlm-roberta-large-meetingbank"
)

# 压缩系统提示
compressed = compressor.compress_prompt(
    original_prompt,
    rate=0.5,           # 压缩到 50%
    force_tokens=['[', ']']  # 保留关键 Token
)
# 原始: 2000 tokens → 压缩后: 1000 tokens
```

#### 工具描述精简

```python
# 不推荐：冗长描述
tools = [{
    "name": "search",
    "description": "This is a very powerful search tool that can search for "
                   "anything in the database. It supports full-text search, "
                   "fuzzy matching, and many other features..."
}]

# 推荐：精简描述
tools = [{
    "name": "search",
    "description": "搜索数据库，支持关键词和模糊匹配"
}]
```

### 智能模型路由

根据查询复杂度动态选择模型：

```python
class ModelRouter:
    def select_model(self, query, context):
        # 规则路由：简单查询 → 便宜模型
        if self.is_simple(query):
            return 'gpt-3.5-turbo'      # $0.5/1M tokens
        
        # LLM 路由：复杂查询 → 强模型
        if self.needs_reasoning(query, context):
            return 'gpt-4o'             # $5/1M tokens
        
        # 嵌入路由：语义相似度判断
        complexity = self.embedding_classifier.predict(query)
        if complexity > 0.8:
            return 'gpt-4o'
        return 'gpt-3.5-turbo'
```

### 本地推理部署

| 方案 | 硬件要求 | 延迟 | 适用场景 |
|------|---------|------|---------|
| Ollama | CPU/低配 GPU | 2-10s | 开发测试 |
| vLLM | A100/H100 | 100-500ms | 生产部署 |
| llama.cpp | CPU（量化） | 1-5s | 边缘设备 |

### 缓存策略

```python
class SemanticCache:
    def get(self, query, threshold=0.95):
        embedding = embed(query)
        cached = vector_db.search(embedding, top_k=1)
        if cached and cached[0].score > threshold:
            return cached[0].response
        return None
    
    def set(self, query, response):
        embedding = embed(query)
        vector_db.insert(embedding, response)
```

### 成本对比

| 策略 | 节省比例 | 质量影响 |
|------|---------|---------|
| 系统提示压缩 | 30-50% | 轻微 |
| 模型路由 | 40-60% | 取决于路由准确率 |
| 语义缓存 | 50-80% | 无（缓存命中时） |
| 本地推理 | 90-99% | 取决于模型大小 |
| 工具描述精简 | 10-20% | 无 |

## 实战案例

来自博客文章：
- [Agent 成本优化：Token 压缩、模型路由、本地推理](/2026/06/02/ai-agent-cost-optimization-token-compression-model-routing-local-inference/) - 完整降本方案

## 相关概念

- [Agent 多租户架构](Agent多租户架构.md) - 租户级别的成本计量
- [Agent 记忆系统](Agent记忆系统.md) - 记忆压缩减少 Token
- [LLM 推理基础设施](LLM推理基础设施.md) - vLLM 本地推理

## 常见问题

### Q: 模型路由的准确率怎么保证？
使用 Golden Dataset 评估路由准确率，持续优化分类器。建议先用规则路由兜底，再叠加 ML 路由。

### Q: 语义缓存的命中率怎么提升？
降低相似度阈值（如 0.9 → 0.85）+ 查询改写标准化 + 定期清理过期缓存。
