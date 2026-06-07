# RAG 架构全览

## 定义

RAG（Retrieval-Augmented Generation，检索增强生成）是将外部知识检索与 LLM 生成能力结合的架构模式。通过在生成前检索相关文档，RAG 有效解决了 LLM 的知识截止日期、幻觉和领域知识不足等问题。

## 核心原理

### 基础 RAG 流程

```
用户查询 → 查询嵌入 → 向量检索 → 文档拼接 → LLM 生成 → 响应
```

### RAG 架构演进

| 阶段 | 模式 | 特点 |
|------|------|------|
| RAG 1.0 | 基础检索 | 查询 → 检索 → 生成，简单直接 |
| RAG 2.0 | Agentic RAG | Agent 自主决定是否检索、检索什么、如何整合 |
| RAG 3.0 | Multi-Modal RAG | 支持文本、图像、音频等多模态检索 |

### Agentic RAG 三种模式

#### Self-RAG（自反思 RAG）
模型在生成过程中插入「反思 Token」，自主判断：
- 是否需要检索（Retrieve Token）
- 检索结果是否相关（IsRel Token）
- 生成内容是否被检索支持（IsSup Token）
- 生成内容是否有用（IsUse Token）

#### Corrective-RAG（纠正 RAG）
在检索后增加质量评估步骤：
1. 检索文档 → 相关性评分
2. 低相关文档 → 丢弃或重新检索
3. 高相关文档 → 知识精炼后生成

#### Adaptive-RAG（自适应 RAG）
根据查询复杂度动态选择策略：
- 简单查询 → 直接 LLM 生成（无需检索）
- 中等查询 → 单次检索 + 生成
- 复杂查询 → 多轮迭代检索 + 推理链

### Multi-Modal RAG

使用 CLIP（Contrastive Language-Image Pre-training）双塔模型实现跨模态检索：

```
文本查询 → CLIP 文本编码器 → 文本向量
                                    ↕ 相似度计算
商品图片 → CLIP 图像编码器 → 图像向量
```

- **嵌入模型**：CLIP ViT-L/14（512 维向量）
- **向量数据库**：Milvus / Qdrant / Weaviate
- **检索策略**：Top-K + 重排序（Reranking）

## 实战案例

来自博客文章：
- [Agentic RAG 实战：Self-RAG / Corrective-RAG / Adaptive-RAG](/2026/06/05/Agentic-RAG-实战-让Agent自主决定检索策略/) - Laravel 中的 Agentic RAG 落地
- [Multi-Modal RAG 实战：CLIP 嵌入与跨模态向量搜索](/2026/06/05/Multi-Modal-RAG-实战-图文混合检索/) - 电商商品图文问答
- [向量数据库选型](../MySQL/向量数据库选型.md) - Pinecone/Qdrant/Weaviate/pgvector 对比

## 相关概念

- [Agent 记忆系统](Agent记忆系统.md) - 长期记忆依赖 RAG 检索
- [Agent 评估体系](Agent评估体系.md) - RAGAS 评估 RAG 质量
- [Agent 成本优化](Agent成本优化.md) - RAG 检索优化减少 Token 消耗
- [向量数据库选型](../MySQL/向量数据库选型.md) - 底层存储与检索引擎

## 常见问题

### Q: RAG vs Fine-tuning 如何选择？
- RAG：知识频繁更新、需要引用来源、领域知识广
- Fine-tuning：固定领域、需要特定风格、对延迟敏感

### Q: 如何评估 RAG 质量？
使用 RAGAS 框架的忠实度（Faithfulness）、相关性（Relevancy）、答案正确性（Correctness）指标，详见 [Agent 评估体系](Agent评估体系.md)。

### Q: 如何处理检索结果中的噪声？
采用 Corrective-RAG 的相关性评分过滤，或使用 Reranker 模型（如 Cohere Rerank）对检索结果重排序。
