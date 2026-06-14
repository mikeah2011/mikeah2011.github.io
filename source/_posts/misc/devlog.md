---

title: 开发日志与踩坑记录
date: 2024-09-01 10:00:00
categories:
  - 博客
keywords: [开发日志与踩坑记录]
tags:
- 开发日志
- 博客
- Hexo
- CI/CD
description: 博客开发运维日志，记录 AI Agent 写作流水线、GitHub Actions 自动部署、Hexo 主题配置调优及选题管理系统的完整迭代过程，持续更新。
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
---

## 什么是开发日志？

这份开发日志记录了 [mikeah2011.github.io](https://mikeah2011.github.io) 博客站点的每一次重要变更——从写作流水线的自动化调度执行，到 CI/CD 部署流程的迭代优化，再到 Hexo 主题配置和选题管理系统的演进。

### 博客技术栈

| 组件 | 技术方案 |
|------|----------|
| 静态站点生成器 | Hexo 7.x |
| 托管平台 | GitHub Pages（自定义域名 + CDN） |
| CI/CD | GitHub Actions（push 触发自动构建与部署） |
| 内容生产 | AI Agent 自动化写作流水线（OpenClaw Cron Job） |
| 选题管理 | `.writing-backlog.md`（380+ 待写选题） |
| 主题 | Aurora（深度定制） |
| 评论系统 | Giscus（GitHub Discussions 驱动） |
| 统计分析 | Google Analytics 4 |

### 写作流水线架构

写作流水线的核心思路是 **选题池 → 定时任务 → AI 生成 → 人工审核 → 自动部署**：

1. **选题池**：`.writing-backlog.md` 维护 380+ 个待写选题，按分类（Laravel/Redis/运维/前端/AI 等）组织
2. **定时触发**：OpenClaw Cron Job 定期触发，从选题池中挑选尚未有对应文章的题目
3. **AI 生成**：Agent 根据选题生成完整技术文章，包含 frontmatter、正文、代码示例
4. **去重检查**：运行前先检查已有文章标题，避免重复生成同一选题
5. **自动提交**：生成的文章通过 `git add/commit/push` 推送到仓库
6. **自动部署**：GitHub Actions 检测到 push 后自动构建 Hexo 站点并部署到 GitHub Pages

```yaml
# .github/workflows/deploy.yml 完整配置
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch: # 支持手动触发

permissions:
  contents: write
  pages: write

concurrency:
  group: deploy
  cancel-in-progress: true # 避免并发部署冲突

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # 完整历史，用于 git dated

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm # 缓存 node_modules

      - run: npm ci

      - name: Generate
        run: npx hexo generate
        env:
          NODE_ENV: production

      - name: Deploy
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
          commit_message: 'deploy: ${{ github.event.head_commit.message }}'
          cname: mikeah2011.github.io # 自定义域名
```

### 写作流水线踩坑记录

#### 1. Hexo 文章去重

选题池有 380+ 题目，但同一篇可能被多次触发。解决方案是在 Agent 侧做标题匹配：

```bash
# 检查已有文章标题，避免重复生成
EXISTING=$(grep -r "^title:" source/_posts/*.md | sed 's/.*title: //')
if echo "$EXISTING" | grep -qi "$TOPIC"; then
  echo "跳过：$TOPIC 已有对应文章"
  exit 0
fi
```

#### 2. GitHub Actions 缓存失效

`npm ci` 在 `package-lock.json` 未变化时会复用缓存，但 Hexo 插件版本不一致会导致生成失败。经验：

- 锁定 `package-lock.json`，不使用 `^` 版本范围
- CI 中加 `--prefer-offline` 加速安装
- 遇到 `hexo-renderer-*` 报错时先删 `node_modules` 重新 `npm ci`

#### 3. Hexo Frontmatter 格式

AI 生成的 YAML frontmatter 常见问题：

```yaml
# ❌ 错误：多行 description 未加引号
description: 这是一篇关于
Laravel 的文章

# ✅ 正确：多行用引号包裹
description: "这是一篇关于 Laravel 的文章"

# ❌ 错误：tags 用字符串而非数组
tags: Laravel, Redis

# ✅ 正确：tags 用数组格式
tags: [Laravel, Redis]
```

每次生成后跑一次 lint 脚本：

```bash
# 检查 frontmatter 格式
for f in source/_posts/*.md; do
  # 确保 tags 是数组格式
  if grep -q "^tags: [^\[]" "$f"; then
    echo "⚠️ $f: tags 应使用数组格式 [tag1, tag2]"
  fi
  # 确保有 description
  if ! grep -q "^description:" "$f"; then
    echo "⚠️ $f: 缺少 description"
  fi
done
```

#### 4. 大文件 Git 提交

单篇文章超过 30KB 时，`git diff` 输出会很冗长。在 CI 中加 `--stat` 查看摘要即可，不需要逐行 review 自动生成的文章。

### 选题管理

选题池文件 `.writing-backlog.md` 的结构：

```markdown
## Laravel/PHP
- [ ] Laravel Octane 性能调优实战
- [ ] PHP 8.4 Property Hooks 深度解析
- [x] Laravel Task Scheduling 进阶实战 ← 已生成

## Redis/缓存
- [ ] Redis Cluster 故障转移实战
- [x] Cache Stampede 防护深度实战 ← 已生成
```

Agent 执行时用脚本统计剩余选题：

```bash
REMAINING=$(grep -c "^\- \[ \]" .writing-backlog.md)
echo "📋 Backlog 剩余：$REMAINING 个选题待写"
```

### 日志说明

每条日志条目包含：完成的文章数量与标题、对应分类目录、Backlog 剩余选题数，以及其他站点维护操作。写作流水线由定时任务（Cron Job）触发，每次运行自动从选题池中挑选题目并生成文章。

<!-- 最新日志请放在最上面 -->

### 2026-06-07 — 写作流水线（定时任务运行 #2）
- ✅ 完成 2 篇文章：
  - **Laravel Task Scheduling 进阶实战：Schedule::job()->onOneServer() 的 Redis 互斥实现**（31,311 bytes） → `source/_posts/06_运维/`
    - 涵盖多服务器环境下定时任务去重的 Redis 互斥锁方案，包括 `onOneServer()` 原理、Redis `SET NX EX` 实现、失败重试策略
  - **Cache Stampede 防护深度实战：Lock + Probabilistic Early Expiration + Background Refresh**（30,386 bytes） → `source/_posts/02_Redis/`
    - 深入分析缓存雪崩的三种防护模式，含 Laravel Cache Lock 的实际用法和 PEE 算法的 PHP 实现
- 📋 Backlog 剩余：364 个选题待写
- Backlog 中前 6 个已有文章的选题已跳过（Git Bisect、Feature Branch Preview、Rust+PHP FFI、OWASP Top 10、RAG Reranking、Task Scheduling #1 等均已写）

### 2026-06-07 — 写作流水线（定时任务运行 #1）
- ✅ 完成 6 篇文章（首批批量生成）：
  - **AI Agent 数据分析实战** — AI 辅助数据清洗、可视化、异常检测的完整流程
  - **RAG Reranking 实战** — 检索增强生成中的重排序策略与实现
  - **OWASP Top 10 2025 实战** — Web 安全最新威胁清单的逐项攻防演练
  - **Rust + PHP FFI 实战** — 通过 FFI 在 PHP 中调用 Rust 高性能模块
  - **Feature Branch Preview 实战** — 多分支预览环境的自动化搭建
  - **Git Bisect + Automated Bug Finding 实战** — 二分法定位 bug + 自动化回归测试

### 2026-06-07 — 待写选题池
- 创建 `.writing-backlog.md`，收录 380+ 个技术文章选题
- 覆盖 Laravel/PHP、MySQL/Redis、运维/架构、前端、macOS、安全、AI 等分类
- 选题来源：实际项目踩坑经验、技术社区热门话题、官方文档深度解读

### 2026-06-07 — 博客站点维护
- 更新 `AI Agent 人机协作模式`、`RAG Reranking`、`Feature Branch Preview` 三篇文章的 Dev.to 链接
- 清理旧 backlog 文件，统一选题管理到 `.writing-backlog.md`

## 站点里程碑

| 时间 | 里程碑 |
|------|--------|
| 2024-09 | 博客正式上线，基于 Hexo + GitHub Pages |
| 2025-Q1 | 引入 Aurora 主题深度定制 |
| 2025-Q3 | 文章数量突破 200 篇 |
| 2026-06 | AI 写作流水线投产，文章数量突破 400 篇 |

## 相关阅读

- [Git Worktree + Bare Repo 实战：多分支并行开发——Laravel 大型项目中同时处理多个 feature 的高效工作流](/categories/CI/CD/Git-Worktree-Bare-Repo-实战-多分支并行开发-Laravel大型项目高效工作流/)
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/CI/CD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [Dev Container + GitHub Codespaces 实战：云端开发环境——Laravel 项目的一键环境搭建与跨设备无缝切换](/categories/运维/2026-06-07-Dev-Container-GitHub-Codespaces-实战-云端开发环境-Laravel一键环境搭建/)
