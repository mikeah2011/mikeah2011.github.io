# AI Agent 框架对比

## 定义

AI Agent 框架是提供 Agent 运行时、工具管理、记忆系统、调度机制等基础设施的软件平台。本文对比 2026 年三大开源 Agent 框架：Hermes（Nous Research）、OpenClaw、OpenHuman。

## 核心原理

### 六维评估模型

| 维度 | 权重 | 评估内容 |
|------|------|---------|
| 架构设计 | 20% | 可扩展性、模块化、插件机制 |
| 工具生态 | 20% | 内置工具数量、自定义工具支持 |
| 记忆系统 | 15% | 短期/长期记忆、检索策略 |
| 多模型支持 | 15% | 模型切换、路由、本地推理 |
| 开发体验 | 15% | 文档、调试、社区 |
| 生产就绪 | 15% | 安全性、可观测性、部署方案 |

### 框架对比矩阵

| 特性 | Hermes | OpenClaw | OpenHuman |
|------|--------|----------|-----------|
| **核心理念** | 文件即记忆，Skill 渐进披露 | 三层记忆，自改进循环 | 桌面吉祥物，状态机动画 |
| **语言** | Python | Python | Python/TypeScript |
| **记忆架构** | Markdown 文件 + 文件搜索 | 感知层→工作层→长期层 | 知识图谱 + Obsidian 双向同步 |
| **工具系统** | Plugin + Skill + CLI | Agent Skill + Tool | Source Adapter + Pipeline |
| **模型支持** | OpenAI/Anthropic/本地/自定义 | 多模型路由 | 多模型 + 语音管道 |
| **调度** | Cron Job + 后台任务 | 自改进循环 | 后台任务系统 |
| **安全模型** | Profile 隔离 + Subagent 沙箱 | 权限分级 | 设备级权限 |
| **部署** | CLI + Docker | Docker + 云部署 | 桌面 + 云同步 |

### Hermes 特色

**Skill 渐进式披露**：
- `skills_list`：返回技能名称列表（极低 Token）
- `skill_view(name)`：返回完整技能文档
- 93%+ Token 节省（相比一次性加载所有技能）

**Profile 隔离**：
```
~/.hermes/profiles/
├── default/
│   ├── skills/
│   ├── plugins/
│   ├── cron/
│   └── memories/
├── work/
│   ├── skills/
│   ├── plugins/
│   └── memories/
```

### OpenClaw 特色

**三层记忆架构**：
- 感知层：实时输入处理
- 工作层：当前会话上下文
- 长期层：持久化知识存储

**自改进循环**：
```
执行任务 → 分析结果 → 提取学习 → 生成 Skill → 存储经验
```

### OpenHuman 特色

**桌面吉祥物**：
- 状态机动画（Idle/Thinking/Speaking）
- VAD（Voice Activity Detection）口型同步
- 多设备云同步

**Source Adapter 架构**：
- Gmail/Slack/GitHub 数据管道
- 统一数据格式转换
- 定时拉取 + 增量同步

## 实战案例

来自博客文章：
- [2026 开源 AI Agent 框架深度评测](/2026/06/02/2026-open-source-ai-agent-hermes-vs-openclaw-vs-openhuman-deep-review/) - 六维评估与选型决策
- [Hermes Skills 渐进式披露设计](/2026/06/02/2026-06-02-hermes-skills-progressive-disclosure-design-philosophy/) - 93%+ Token 节省

## 相关概念

- [Agent 记忆系统](Agent记忆系统.md) - 三大框架的记忆架构对比
- [Agent 工作流编排](Agent工作流编排.md) - 框架的编排能力对比
- [Agent 成本优化](Agent成本优化.md) - Hermes Skill 渐进披露的 Token 节省

## 常见问题

### Q: 如何选择 Agent 框架？
- **Hermes**：注重透明可控、文件级记忆、CLI 工作流
- **OpenClaw**：注重自动化、自改进、三层记忆
- **OpenHuman**：注重多模态交互、桌面体验、云同步

### Q: 框架可以混用吗？
可以。Hermes 的 MCP 协议支持与 OpenClaw/OpenHuman 的工具互通。记忆系统可以通过 Obsidian 作为共享中间层。
