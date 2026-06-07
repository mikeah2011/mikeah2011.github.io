---
title: 开发日志
date: 2024-09-01 10:00:00
tags: [开发日志, 博客, Hexo, CI/CD]
description: 本博客开发与运维日志，记录站点从零到一的每一次重要变更。覆盖 AI Agent 自动化写作流水线调度与执行、GitHub Actions CI/CD 自动部署流程、Hexo 主题与插件配置调优、选题 Backlog 管理以及 380+ 技术文章的持续产出过程，是博客迭代的完整时间线，持续更新。
cover: /images/covers/devlog-cover.jpg
---
## 什么是开发日志？

这份开发日志记录了 [mikeah2011.github.io](https://mikeah2011.github.io) 博客站点的每一次重要变更——从写作流水线的自动化调度执行，到 CI/CD 部署流程的迭代优化，再到 Hexo 主题配置和选题管理系统的演进。

### 博客技术栈

| 组件 | 技术方案 |
|------|----------|
| 静态站点生成器 | Hexo |
| 托管平台 | GitHub Pages |
| CI/CD | GitHub Actions（自动构建与部署） |
| 内容生产 | AI Agent 自动化写作流水线 |
| 选题管理 | `.writing-backlog.md`（380+ 待写选题） |

### 日志说明

每条日志条目包含：完成的文章数量与标题、对应分类目录、Backlog 剩余选题数，以及其他站点维护操作。写作流水线由定时任务（Cron Job）触发，每次运行自动从选题池中挑选题目并生成文章。

<!-- 最新日志请放在最上面 -->

### 2026-06-07 — 写作流水线（定时任务运行 #2）
- ✅ 完成 2 篇文章：
  - **Laravel Task Scheduling 进阶实战：Schedule::job()->onOneServer() 的 Redis 互斥实现**（31,311 bytes） → `source/_posts/06_运维/`
  - **Cache Stampede 防护深度实战：Lock + Probabilistic Early Expiration + Background Refresh**（30,386 bytes） → `source/_posts/02_Redis/`
- 📋 Backlog 剩余：364 个选题待写
- Backlog 中前 6 个已有文章的选题已跳过（Git Bisect、Feature Branch Preview、Rust+PHP FFI、OWASP Top 10、RAG Reranking、Task Scheduling #1 等均已写）

### 2026-06-07 — 写作流水线（定时任务运行 #1）
- ✅ 完成 6 篇文章：
  - AI Agent 数据分析实战
  - RAG Reranking 实战
  - OWASP Top 10 2025 实战
  - Rust + PHP FFI 实战
  - Feature Branch Preview 实战
  - Git Bisect + Automated Bug Finding 实战

### 2026-06-07 — 待写选题池
- 创建 `.writing-backlog.md`，收录 380+ 个技术文章选题
- 覆盖 Laravel/PHP、MySQL/Redis、运维/架构、前端、macOS、安全、AI 等分类

### 2026-06-07 — 博客站点维护
- 更新 `AI Agent 人机协作模式`、`RAG Reranking`、`Feature Branch Preview` 三篇文章的 Dev.to 链接
- 清理旧 backlog 文件，统一选题管理到 `.writing-backlog.md`

## 相关阅读

- [Git Worktree + Bare Repo 实战：多分支并行开发——Laravel 大型项目中同时处理多个 feature 的高效工作流](/categories/CI/CD/Git-Worktree-Bare-Repo-实战-多分支并行开发-Laravel大型项目高效工作流/)
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/CI/CD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [Dev Container + GitHub Codespaces 实战：云端开发环境——Laravel 项目的一键环境搭建与跨设备无缝切换](/categories/运维/2026-06-07-Dev-Container-GitHub-Codespaces-实战-云端开发环境-Laravel一键环境搭建/)
