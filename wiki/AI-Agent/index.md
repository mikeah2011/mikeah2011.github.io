# AI Agent 知识图谱

> 从 LLM 基础到 Agent 工程化的完整知识体系，覆盖 Function Calling、RAG、记忆系统、流式响应、错误恢复、评估、调试、工作流编排、安全护栏、多租户、成本优化等核心领域。

## 核心概念

### 🧠 LLM 基础与推理
- [Function Calling 与工具使用](Function-Calling与工具使用.md) - 并行工具调用、强制工具选择、多模型对比
- [LLM 推理基础设施](LLM推理基础设施.md) - vLLM PagedAttention、量化、GPU 优化

### 📚 RAG 架构
- [RAG 架构全览](RAG架构全览.md) - 基础 RAG、Agentic RAG、Multi-Modal RAG
- [向量数据库与嵌入](../MySQL/向量数据库选型.md) - Pinecone/Qdrant/Weaviate/pgvector（关联 MySQL 知识图谱）

### 🧩 Agent 核心能力
- [Agent 记忆系统](Agent记忆系统.md) - 记忆压缩、蒸馏、衰减、多框架对比
- [Agent 流式响应](Agent流式响应.md) - SSE/WebSocket、Token 渲染、断线恢复
- [Agent 错误恢复与韧性](Agent错误恢复与韧性.md) - 工具失败、幻觉检测、上下文溢出、重试策略
- [Agent 工作流编排](Agent工作流编排.md) - LangGraph、Temporal、DAG、Human-in-the-Loop

### 🔍 质量保障
- [Agent 评估体系](Agent评估体系.md) - LLM-as-Judge、RAGAS、DeepEval、回归测试
- [Agent 调试与可观测性](Agent调试与可观测性.md) - MCP Inspector、LangSmith Trace、日志回放
- [Agent 安全与护栏](Agent安全与护栏.md) - NeMo Guardrails、越狱防护、幻觉缓解、PII 检测

### 🏗️ 工程化实践
- [Agent 多租户架构](Agent多租户架构.md) - 租户隔离、用量计量、按租户路由
- [Agent 成本优化](Agent成本优化.md) - Token 压缩、模型路由、本地推理
- [Agent 知识管理](Agent知识管理.md) - Obsidian + RAG、个人知识库构建
- [Agent 多平台集成](Agent多平台集成.md) - Telegram/Discord/WeChat/WhatsApp 统一网关

### 🔧 框架与生态
- [AI Agent 框架对比](AI-Agent框架对比.md) - Hermes vs OpenClaw vs OpenHuman 深度评测
- [MLOps 模型生命周期](MLOps模型生命周期.md) - MLflow/Kubeflow 训练到部署

## 实战文章（来自博客）

### Function Calling 与工具使用
- [LLM Function Calling 进阶：并行工具调用与强制工具使用](/2026/06/05/2026-06-05-llm-function-calling-advanced-parallel-tool-calls-forced-tool-use/) - OpenAI/Anthropic/Gemini 多模型对比

### RAG 架构
- [Agentic RAG 实战：Self-RAG / Corrective-RAG / Adaptive-RAG](/2026/06/05/Agentic-RAG-实战-让Agent自主决定检索策略/) - Agent 自主决定检索策略
- [Multi-Modal RAG 实战：CLIP 嵌入与跨模态向量搜索](/2026/06/05/Multi-Modal-RAG-实战-图文混合检索/) - 电商商品图文问答

### Agent 记忆系统
- [AI Agent Memory Consolidation：压缩、蒸馏、衰减](/2026/06/05/2026-06-05-ai-agent-memory-consolidation-compression-distillation-decay/) - Atkinson-Shiffrin 记忆模型
- [AI Agent 记忆系统对比：Hermes vs OpenClaw vs OpenHuman](/2026/06/02/ai-agent-memory-system-hermes-vs-openclaw-vs-openhuman/) - 三种记忆架构

### Agent 流式响应
- [AI Agent Streaming 进阶：SSE 分块传输与断线恢复](/2026/06/05/2026-06-05-ai-agent-streaming-sse-token-rendering-recovery-laravel/) - Laravel 后端实战
- [AI Agent Streaming 实战：SSE/WebSocket 实时流式响应](/2026/06/05/AI-Agent-Streaming-实战/) - Token-by-Token 推送

### Agent 错误恢复
- [AI Agent Error Recovery：工具失败、幻觉、上下文溢出](/2026/06/05/2026-06-05-ai-agent-error-recovery-tool-failure-hallucination-overflow-degradation-retry/) - 韧性设计模式

### Agent 工作流编排
- [AI Agent Long-Running Tasks：持久化状态与 Human-in-the-Loop](/2026/06/05/2026-06-05-ai-agent-long-running-tasks-durable-state-checkpoint-human-approval/) - Temporal/Inngest/DAG
- [LangGraph：有状态 Agent 图编排](/2026/06/02/2026-06-02-langgraph-stateful-agent-graph-orchestration/) - StateGraph 条件路由

### Agent 评估与调试
- [AI Agent Evaluation as Code：LLM-as-Judge 回归测试](/2026/06/05/2026-06-05-ai-agent-evaluation-as-code-llm-as-judge-regression-testing/) - 评估即代码
- [LLM 评估框架：RAGAS / DeepEval](/2026/06/05/LLM-Evaluation-RAGAS-DeepEval/) - RAG 系统质量量化
- [AI Agent Debugging：MCP Inspector / LangSmith Trace](/2026/06/05/2026-06-05-ai-agent-debugging-mcp-inspector-langsmith-trace-log-replay/) - 从黑盒到可调试

### Agent 安全
- [AI Agent Guardrails：NeMo Guardrails / Rebuff](/2026/06/05/AI-Agent-Guardrails-实战/) - 越狱防护与幻觉缓解

### 工程化实践
- [AI Agent 多租户实战](/2026/06/05/AI-Agent-多租户实战/) - SaaS 场景下的隔离与计量
- [Agent 成本优化：Token 压缩、模型路由、本地推理](/2026/06/02/ai-agent-cost-optimization-token-compression-model-routing-local-inference/) - 降本增效
- [Agent 个人知识管理：Obsidian + RAG + Vector DB](/2026/06/02/ai-agent-personal-knowledge-management-obsidian-rag-vector-db/) - PARA + Zettelkasten
- [Agent 多平台集成：Telegram/Discord/WeChat/WhatsApp](/2026/06/02/ai-agent-multi-platform-integration-telegram-discord-wechat-whatsapp/) - 统一消息网关

### 框架与生态
- [2026 开源 AI Agent 框架深度评测](/2026/06/02/2026-open-source-ai-agent-hermes-vs-openclaw-vs-openhuman-deep-review/) - Hermes vs OpenClaw vs OpenHuman
- [Hermes Skills 渐进式披露设计](/2026/06/02/2026-06-02-hermes-skills-progressive-disclosure-design-philosophy/) - 93%+ Token 节省
- [MLOps：MLflow/Kubeflow 模型生命周期管理](/2026/06/05/MLOps-MLflow-Kubeflow/) - 训练到部署
- [vLLM 高吞吐 LLM 推理](/2026/06/02/2026-06-02-vllm-high-throughput-llm-inference-pagedattention-gpu/) - PagedAttention 与 GPU 优化

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. Function Calling 与工具使用 → 2. RAG 架构全览
                                          │
                                          ▼
3. Agent 流式响应 → 4. Agent 记忆系统 → 5. Agent 错误恢复与韧性
                                          │
                                          ▼
6. Agent 评估体系 → 7. Agent 调试与可观测性 → 8. Agent 安全与护栏
                                          │
                                          ▼
9. Agent 工作流编排 → 10. Agent 多租户架构 → 11. Agent 成本优化
                                          │
                                          ▼
12. Agent 知识管理 → 13. Agent 多平台集成 → 14. MLOps 模型生命周期
                                          │
                                          ▼
15. AI Agent 框架对比 → 16. LLM 推理基础设施 → 17. 实战综合应用
```

## 知识关联图

```
Function Calling ──→ 工具调用链 ──→ 并行工具调用
       │
       ▼
  Agent 核心循环 ──→ 观察 → 思考 → 行动 → 反馈
       │
       ├──→ RAG 架构 ──→ 基础 RAG → Agentic RAG → Multi-Modal RAG
       │         │
       │         └──→ 向量数据库 ──→ 嵌入模型 ──→ 检索策略
       │
       ├──→ 记忆系统 ──→ 短期记忆（滑动窗口）
       │         ├──→ 长期记忆（向量存储 + 蒸馏）
       │         └──→ 衰减与压缩（Ebbinghaus 曲线）
       │
       ├──→ 流式响应 ──→ SSE ──→ Token 渲染 ──→ 断线恢复
       │         └──→ WebSocket ──→ 双向通信
       │
       ├──→ 错误恢复 ──→ 工具失败重试（指数退避）
       │         ├──→ 幻觉检测（Schema 验证 + 自我反思）
       │         └──→ 上下文溢出（摘要 + 滑动窗口）
       │
       ├──→ 工作流编排 ──→ LangGraph（有状态图）
       │         ├──→ Temporal（持久化工作流）
       │         └──→ Human-in-the-Loop（人工审批）
       │
       ├──→ 评估体系 ──→ LLM-as-Judge ──→ 评估即代码
       │         ├──→ RAGAS（忠实度/相关性）
       │         └──→ DeepEval（GEval 自定义指标）
       │
       ├──→ 调试可观测 ──→ MCP Inspector（工具调试）
       │         ├──→ LangSmith Trace（全链路追踪）
       │         └──→ 结构化日志回放
       │
       ├──→ 安全护栏 ──→ 越狱防护 ──→ NeMo Guardrails
       │         ├──→ 幻觉缓解 ──→ 事实核查
       │         └──→ PII 检测 ──→ 数据脱敏
       │
       └──→ 工程化 ──→ 多租户（隔离 + 计量 + 路由）
                 ├──→ 成本优化（压缩 + 路由 + 本地推理）
                 ├──→ 知识管理（Obsidian + RAG）
                 └──→ 多平台集成（统一消息网关）
```

## 跨领域关联
- → [MySQL 知识图谱](../MySQL/index.md)：向量数据库选型、数据存储
- → [Redis 知识图谱](../Redis/index.md)：缓存层、分布式限流、消息队列
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：Laravel 集成、队列、API 开发
- → [架构设计知识图谱](../架构设计/index.md)：微服务、事件驱动、分布式事务
- → [DevOps 知识图谱](../DevOps/index.md)：MLOps、Kubernetes 部署、可观测性
- → [前端知识图谱](../前端/index.md)：流式渲染、SSE/WebSocket 前端集成
