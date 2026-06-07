# Agent 记忆系统

## 定义

Agent 记忆系统是使 AI Agent 能够跨会话保持上下文、学习用户偏好、积累经验的核心机制。借鉴认知心理学的记忆模型，Agent 记忆通常分为短期记忆（工作记忆）、长期记忆（持久化存储）和情景记忆（对话历史）。

## 核心原理

### 记忆分类

| 类型 | 存储方式 | 生命周期 | 用途 |
|------|---------|---------|------|
| 工作记忆 | 上下文窗口 | 单次对话 | 当前任务上下文 |
| 短期记忆 | 滑动窗口 | 数轮对话 | 近期对话摘要 |
| 长期记忆 | 向量数据库 | 持久化 | 用户偏好、知识积累 |
| 情景记忆 | 结构化存储 | 持久化 | 关键事件、决策记录 |

### Atkinson-Shiffrin 记忆模型

借鉴人类记忆的三级模型：

```
感觉记忆（Sensory）→ 短期记忆（STM）→ 长期记忆（LTM）
     │                    │                    │
     ▼                    ▼                    ▼
  原始输入            滑动窗口             向量存储
  Token 流            上下文管理           持久化检索
```

### 记忆压缩策略

#### 滑动窗口压缩
保留最近 N 轮对话，超出部分丢弃或摘要：

```python
def compress_memory(messages, max_tokens=4000):
    if count_tokens(messages) <= max_tokens:
        return messages
    # 保留系统消息 + 最近 N 轮
    system = [m for m in messages if m.role == "system"]
    recent = messages[-MAX_RECENT_TURNS:]
    # 中间部分生成摘要
    middle = messages[len(system):-MAX_RECENT_TURNS]
    summary = llm.summarize(middle)
    return system + [{"role": "system", "content": summary}] + recent
```

#### LLM 蒸馏压缩
使用 LLM 将长对话蒸馏为结构化知识：

```
原始对话（1000 tokens）
    ↓ LLM 蒸馏
结构化记忆（200 tokens）
- 用户偏好：喜欢简洁回答
- 上下文：正在开发 Laravel 项目
- 关键决策：选择 MySQL 而非 PostgreSQL
```

### Ebbinghaus 遗忘曲线

记忆随时间衰减，使用 SM-2 间隔重复算法管理记忆重要性：

```
记忆强度 = 初始强度 × e^(-t/S)

其中：
- t = 距上次访问的时间
- S = 记忆稳定性（每次成功检索后增加）
```

## 三大框架记忆架构对比

| 维度 | Hermes | OpenClaw | OpenHuman |
|------|--------|----------|-----------|
| 核心理念 | 文件即记忆 | 三层记忆 | 知识图谱 |
| 存储方式 | Markdown 文件 | 分层向量存储 | 图数据库 |
| 检索策略 | 文件搜索 + 关键词 | 语义检索 + 时间衰减 | 图遍历 + 语义搜索 |
| 压缩方式 | 文件归档 | 自动摘要蒸馏 | 节点合并 |
| 优势 | 透明可编辑 | 自动化程度高 | 关系推理强 |
| 劣势 | 依赖人工维护 | 黑盒化 | 实现复杂度高 |

## 实战案例

来自博客文章：
- [AI Agent Memory Consolidation：压缩、蒸馏、衰减](/2026/06/05/2026-06-05-ai-agent-memory-consolidation-compression-distillation-decay/) - Atkinson-Shiffrin 模型工程化
- [AI Agent 记忆系统对比：Hermes vs OpenClaw vs OpenHuman](/2026/06/02/ai-agent-memory-system-hermes-vs-openclaw-vs-openhuman/) - 三种架构深度对比

## 相关概念

- [RAG 架构全览](RAG架构全览.md) - 长期记忆依赖 RAG 检索
- [Agent 成本优化](Agent成本优化.md) - 记忆压缩减少 Token 消耗
- [Agent 错误恢复与韧性](Agent错误恢复与韧性.md) - 上下文溢出处理
- [Agent 知识管理](Agent知识管理.md) - 个人知识库与记忆系统结合

## 常见问题

### Q: 记忆太多导致上下文溢出怎么办？
采用分层压缩策略：近期记忆保留原文 → 中期记忆摘要 → 远期记忆蒸馏为关键知识点。详见 [Agent 错误恢复与韧性](Agent错误恢复与韧性.md)。

### Q: 如何防止记忆中的过时信息影响回答？
使用时间衰减权重 + 记忆版本管理，过时记忆标记为 archived，检索时降低权重。
