---
title: Feature Branch Preview 实战：PR 级预览环境——Vercel Preview/Cloudflare Pages Preview + Laravel API 的全栈预览方案
date: 2026-06-07 10:00:00
tags: [DevOps, Vercel, Cloudflare Pages, Laravel, Preview Environment, CI/CD]
categories: [运维]
cover: /images/covers/feature-branch-preview-cover.jpg
description: PR Preview 环境让每个 Pull Request 自动部署独立的预览实例，实现 Feature Branch 级别的所见即所得验证。本文实战对比 Vercel Preview 与 Cloudflare Pages Preview 的前端方案，结合 Laravel API 后端预览部署，通过 GitHub Actions 构建全栈 CI/CD 预览流水线，涵盖数据库策略与自动清理优化。
---

## 前言：为什么需要 PR 级预览环境？

在传统开发流程中，开发者提交 PR 后，Reviewer 只能通过代码阅读来判断改动是否正确。对于 UI 变更、交互逻辑、API 联调等场景，光看代码远远不够。**PR Preview Environment（预览环境）** 的核心理念是：每个 Pull Request 自动部署一个独立的、可访问的临时环境，让团队成员可以直接体验和验证改动。

本文将从实战角度，分别介绍 **Vercel Preview** 和 **Cloudflare Pages Preview** 两种前端预览方案，并重点讲解如何与 **Laravel API 后端** 集成，实现真正的全栈预览。

---

## 一、整体架构概览

一个完整的全栈预览方案包含三个层面：

```
┌─────────────────────────────────────────────────┐
│                   Pull Request                   │
│  ┌──────────────┐       ┌──────────────────────┐ │
│  │  Frontend PR  │       │    Backend PR (可选)  │ │
│  └──────┬───────┘       └──────────┬───────────┘ │
│         │                          │              │
│         ▼                          ▼              │
│  Vercel/CF Pages              Laravel API        │
│  Preview Deploy              Preview Deploy       │
│  (自动触发)                   (CI/CD 触发)         │
│         │                          │              │
│         └──────────┬───────────────┘              │
│                    ▼                              │
│          Preview Database                         │
│       (Ephemeral / Branch)                        │
└─────────────────────────────────────────────────┘
```

前端通过 Vercel 或 Cloudflare Pages 自动部署预览；后端 Laravel API 通过 GitHub Actions 部署到临时服务器或容器；数据库使用 ephemeral 实例或分支策略隔离数据。

---

## 二、Vercel Preview 配置实战

### 2.1 基本配置

Vercel 对 Git 集成的支持开箱即用。将 Next.js、Nuxt、Vite 等前端项目关联到 Vercel 后，每个 PR 都会自动生成一个 Preview URL。

首先在项目根目录创建 `vercel.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://api-preview.example.com/$1" }
  ]
}
```

### 2.2 按 PR 设置环境变量

Vercel 支持通过 Environment Variables 面板为 Preview 环境单独配置变量。但更实用的方式是通过 **Vercel CLI + GitHub Actions** 在部署时动态注入：

```yaml
# .github/workflows/vercel-preview.yml
name: Vercel Preview Deploy
on:
  pull_request:
    branches: [main]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Vercel CLI
        run: npm i -g vercel

      - name: Pull Vercel Environment
        run: vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}

      - name: Build
        run: vercel build --token=${{ secrets.VERCEL_TOKEN }}

      - name: Deploy Preview
        id: deploy
        run: |
          url=$(vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }})
          echo "preview_url=$url" >> $GITHUB_OUTPUT

      - name: Comment PR with Preview URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `🚀 **Preview URL:** ${{ steps.deploy.outputs.preview_url }}\n\n_API: https://api-preview-${{ github.event.pull_request.number }}.example.com_`
            })
```

### 2.3 自定义 Preview 域名

默认情况下 Vercel 会生成 `https://<project>-<hash>-<team>.vercel.app` 格式的 URL。如果你希望更有辨识度，可以在 GitHub Actions 中设置 alias：

```bash
vercel alias set $DEPLOY_URL "pr-${PR_NUMBER}.preview.yourdomain.com" --token=$VERCEL_TOKEN
```

---

## 三、Cloudflare Pages Preview 配置实战

### 3.1 连接 Git 仓库

在 Cloudflare Dashboard → Pages → Create a project → Connect to Git，选择你的仓库。Cloudflare Pages 会自动为每个 PR 创建 Preview deployment。

### 3.2 使用 Wrangler CLI 本地构建与部署

对于更复杂的 CI 流程，推荐使用 Wrangler：

```bash
# 安装 wrangler
npm install -g wrangler

# 构建并部署到 Pages
npx wrangler pages deploy ./dist --project-name=my-app --branch=feature/new-dashboard
```

### 3.3 GitHub Actions 自动化

```yaml
# .github/workflows/cf-pages-preview.yml
name: Cloudflare Pages Preview
on:
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install & Build
        run: |
          npm ci
          VITE_API_URL="https://api-preview-${{ github.event.pull_request.number }}.example.com" \
          npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy ./dist --project-name=my-app --branch=${{ github.head_ref }}

      - name: Get Preview URL
        id: preview
        run: |
          BRANCH=${{ github.head_ref }}
          SAFE_BRANCH=$(echo "$BRANCH" | tr '/' '-')
          echo "url=https://${SAFE_BRANCH}.my-app.pages.dev" >> $GITHUB_OUTPUT
```

### 3.4 Preview URL 格式

Cloudflare Pages 的 Preview URL 格式为：

```
https://<branch-slug>.<project-name>.pages.dev
```

例如分支 `feature/new-dashboard` 会生成：`https://feature-new-dashboard.my-app.pages.dev`。

---

## 四、Laravel API 后端的 Preview 集成

前端有了预览环境，后端也需要配套。以下是几种常见的 Laravel API Preview 部署策略。

### 4.1 GitHub Actions + Docker 部署到临时容器

最灵活的方案是使用 GitHub Actions 构建 Docker 镜像，部署到临时容器（如 Railway、Fly.io、或自建 K8s）：

```yaml
# .github/workflows/laravel-preview.yml
name: Laravel API Preview
on:
  pull_request:
    branches: [main]
    paths:
      - 'api/**'
      - '.github/workflows/laravel-preview.yml'

jobs:
  deploy-api-preview:
    runs-on: ubuntu-latest
    env:
      PR_NUMBER: ${{ github.event.pull_request.number }}
      PREVIEW_DOMAIN: "api-preview-${{ github.event.pull_request.number }}.example.com"
    
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, dom, zip, mysql
          coverage: none

      - name: Install Dependencies
        working-directory: ./api
        run: composer install --no-dev --optimize-autoloader

      - name: Create Ephemeral Database
        env:
          PLANETSCALE_TOKEN: ${{ secrets.PLANETSCALE_TOKEN }}
        run: |
          # 使用 PlanetScale 创建临时数据库分支
          pscale database create myapp_preview_${PR_NUMBER} --org=myorg
          pscale branch create myapp_preview_${PR_NUMBER} feat-${PR_NUMBER} \
            --from=main --org=myorg
          
          # 获取连接字符串
          CREDENTIALS=$(pscale password create myapp_preview_${PR_NUMBER} \
            feat-${PR_NUMBER} deploy_token_${PR_NUMBER} --format=json --org=myorg)
          echo "DB_HOST=$(echo $CREDENTIALS | jq -r '.host')" >> $GITHUB_ENV
          echo "DB_PASSWORD=$(echo $CREDENTIALS | jq -r '.password')" >> $GITHUB_ENV

      - name: Deploy to Fly.io
        uses: superfly/flyctl-actions/setup-flyctl@master
      
      - name: Fly Launch
        working-directory: ./api
        run: |
          flyctl launch --name myapp-api-pr-${PR_NUMBER} --no-deploy --region hkg
          flyctl secrets set \
            APP_ENV=preview \
            APP_URL="https://${PREVIEW_DOMAIN}" \
            DB_HOST="${DB_HOST}" \
            DB_DATABASE="myapp_preview_${PR_NUMBER}" \
            DB_USERNAME="deploy_token_${PR_NUMBER}" \
            DB_PASSWORD="${DB_PASSWORD}" \
            CACHE_DRIVER=redis \
            SESSION_DRIVER=redis
          flyctl deploy --remote-only

      - name: Setup Ingress / Subdomain
        run: |
          # 通过 API 或 CLI 配置路由
          curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
            -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
            -H "Content-Type: application/json" \
            --data '{
              "type": "CNAME",
              "name": "api-preview-'${PR_NUMBER}'",
              "content": "myapp-api-pr-'${PR_NUMBER}'.fly.dev",
              "proxied": true
            }'

      - name: Comment Preview Info on PR
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: [
                `## 🔗 全栈 Preview 环境`,
                ``,
                `| 服务 | URL |`,
                `|------|-----|`,
                `| Frontend | https://pr-${context.issue.number}.preview.yourdomain.com |`,
                `| API | https://api-preview-${context.issue.number}.example.com |`,
                `| Database Branch | feat-${context.issue.number} |`,
              ].join('\n')
            })
```

### 4.2 使用 Laravel Sail（Docker Compose）的一键 Preview

如果团队使用 Laravel Sail，可以为 Preview 场景准备一个专用的 `docker-compose.preview.yml`：

```yaml
# docker-compose.preview.yml
version: '3.8'
services:
  laravel.test:
    build:
      context: ./api
      dockerfile: Dockerfile
    environment:
      APP_ENV: preview
      APP_URL: ${PREVIEW_APP_URL:-http://localhost}
      DB_HOST: mysql
      DB_DATABASE: preview_${PR_NUMBER:-0}
      DB_USERNAME: preview
      DB_PASSWORD: ${DB_PASSWORD:-secret}
    depends_on:
      mysql:
        condition: service_healthy

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: "preview_${PR_NUMBER:-0}"
      MYSQL_USER: preview
      MYSQL_PASSWORD: ${DB_PASSWORD:-secret}
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-root}
    healthcheck:
      test: ["CMD", "mysqladmin", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - mysql-preview-data:/var/lib/mysql

  redis:
    image: redis:7-alpine

volumes:
  mysql-preview-data:
```

在 CI 中只需：

```bash
PR_NUMBER=${{ github.event.pull_request.number }} \
docker compose -f docker-compose.preview.yml up -d --build
docker compose -f docker-compose.preview.yml exec -T laravel.test php artisan migrate --force
docker compose -f docker-compose.preview.yml exec -T laravel.test php artisan db:seed --force
```

---

## 五、数据库策略对比

Preview 环境的数据库管理是全栈预览中最关键的一环。以下是三种主流方案：

### 方案 A：Ephemeral Database（临时数据库）

每次 PR 创建时新建一个数据库，PR 关闭/合并后销毁。

**适用场景：** PlanetScale、Neon、Supabase 等支持快速创建/销毁 database 的服务。

```bash
# PlanetScale CLI
pscale branch create myapp feature/pr-123 --from=main
# 获取连接 URL
pscale connect myapp feature/pr-123 --port 3306

# PR 合并后销毁
pscale branch delete myapp feature/pr-123
```

**优点：** 数据完全隔离，不怕脏数据，清理彻底
**缺点：** 有一定延迟（创建耗时 10-30 秒），数据库数量受计划限制

### 方案 B：Database Branch（数据库分支）

利用 PlanetScale 等服务的 branching 功能，在一个数据库集群中通过分支隔离数据。

```yaml
# GitHub Actions 中
- name: Create DB Branch
  run: |
    pscale deploy-request create myapp "pr-${PR_NUMBER}" \
      --deploy-to production --org=myorg
    
  # PR 合并后自动部署 schema 变更
- name: Merge Deploy Request
  if: github.event.pull_request.merged == true
  run: |
    pscale deploy-request deploy myapp "pr-${PR_NUMBER}" --org=myorg
```

**优点：** Schema 变更可以安全地通过 deploy request 审查后合并，与代码 PR 流程一致
**缺点：** 仅 PlanetScale 支持此特性

### 方案 C：共享数据库 + Table Prefix

最简单的方案——所有 Preview 共享同一个数据库，但通过 table prefix 隔离。

```php
// config/database.php
'connections' => [
    'mysql' => [
        'driver' => 'mysql',
        'host' => env('DB_HOST', '127.0.0.1'),
        'database' => env('DB_DATABASE', 'myapp'),
        'prefix' => env('DB_TABLE_PREFIX', ''),
        // ...
    ],
],
```

```bash
# CI 中为每个 PR 设置不同的 prefix
DB_TABLE_PREFIX="pr123_" php artisan migrate --force
```

**优点：** 零额外成本，实现最简单
**缺点：** 存在数据污染风险，清理麻烦，不推荐生产级项目使用

---

## 六、Preview URL 自动分享到 PR 评论

让每个 PR 自动显示预览链接是提升团队体验的关键。以下是一个可复用的 GitHub Action：

```yaml
# .github/actions/comment-preview-url/action.yml
name: 'Comment Preview URL'
description: '在 PR 中评论预览链接'
inputs:
  frontend_url:
    description: '前端预览 URL'
    required: true
  api_url:
    description: 'API 预览 URL'
    required: false
    default: ''
  pr_number:
    description: 'PR 编号'
    required: true

runs:
  using: 'composite'
  steps:
    - name: Comment on PR
      uses: actions/github-script@v7
      with:
        script: |
          const body = [
            `## ✅ Preview Environment Ready`,
            ``,
            `| 服务 | 预览链接 |`,
            `|------|----------|`,
            `| 🖥️ Frontend | ${ '${{ inputs.frontend_url }}' } |`,
            inputs.api_url ? `| ⚙️ API | ${ '${{ inputs.api_url }}' } |` : null,
            ``,
            `> 💡 预览环境会在 PR 关闭后自动销毁。`,
          ].filter(Boolean).join('\n');
          
          // 先查找是否已有评论，避免重复
          const comments = await github.rest.issues.listComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: parseInt('${{ inputs.pr_number }}'),
          });
          const existing = comments.data.find(c => c.body.includes('Preview Environment Ready'));
          
          if (existing) {
            await github.rest.issues.updateComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: existing.id,
              body,
            });
          } else {
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: parseInt('${{ inputs.pr_number }}'),
              body,
            });
          }
```

使用方式：

```yaml
- name: Comment Preview URL
  uses: ./.github/actions/comment-preview-url
  with:
    frontend_url: https://pr-${{ github.event.pull_request.number }}.preview.yourdomain.com
    api_url: https://api-preview-${{ github.event.pull_request.number }}.example.com
    pr_number: ${{ github.event.pull_request.number }}
```

---

## 七、PR 合并后的自动清理（Teardown）

Preview 环境不清理会快速耗尽资源。以下是自动清理方案：

```yaml
# .github/workflows/preview-teardown.yml
name: Cleanup Preview Environment
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  teardown:
    runs-on: ubuntu-latest
    steps:
      - name: Remove Vercel Deployment
        run: |
          # Vercel 会自动清理，但也可以手动触发
          curl -X DELETE "https://api.vercel.com/v13/deployments?projectId=${{ secrets.VERCEL_PROJECT_ID }}&state=READY&target=preview" \
            -H "Authorization: Bearer ${{ secrets.VERCEL_TOKEN }}"

      - name: Remove Fly.io Preview App
        if: github.event.pull_request.merged == true
        run: |
          flyctl destroy myapp-api-pr-${{ github.event.pull_request.number }} --yes
          echo "✅ Destroyed preview app"

      - name: Remove Database Branch
        run: |
          PR=${{ github.event.pull_request.number }}
          pscale branch delete myapp_preview_${PR} "feat-${PR}" --force --org=myorg
          pscale database delete myapp_preview_${PR} --force --org=myorg
          echo "✅ Cleaned up database"

      - name: Remove DNS Record
        run: |
          # 查找并删除 CNAME 记录
          RECORD_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=api-preview-${{ github.event.pull_request.number }}.example.com" \
            -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" | jq -r '.result[0].id')
          
          curl -X DELETE "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
            -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}"
          echo "✅ Removed DNS record"

      - name: Delete S3/Storage Preview Assets
        run: |
          PR=${{ github.event.pull_request.number }}
          aws s3 rm s3://myapp-preview-assets/pr-${PR}/ --recursive
          echo "✅ Cleaned up storage"
```

---

## 八、成本考虑与优化

Preview 环境的成本是团队引入该方案前必须评估的因素。

### 8.1 Vercel 成本

Vercel 的 Hobby 计划每月有 100 次 Preview 部署额度，Pro 计划则为 1000 次。超出后按量计费。**优化技巧：**

- 通过 `paths` 过滤只在前后端代码变更时才触发部署
- 对非关键 PR（如文档更新）跳过 Preview 部署
- 使用 Vercel 的 `ignoreCommand` 在构建前判断是否需要部署

```json
// vercel.json
{
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- src/ public/ package.json"
}
```

### 8.2 Cloudflare Pages 成本

Cloudflare Pages 的免费计划每月提供 500 次 Preview 部署和 100 GB 带宽。付费计划（$20/月起）提供更多构建次数。这是目前性价比最高的 Preview 方案之一。

### 8.3 后端 API 成本

后端的 Preview 环境成本主要来自：

- **Fly.io：** 免费层支持 3 个共享 CPU 实例，适合轻量 API
- **Railway：** 按用量计费，Preview 部署与 Production 相同费率
- **自建 K8s：** 需要考虑节点资源，可通过 Cluster Autoscaler 自动伸缩
- **数据库分支：** PlanetScale 的 Hobby 计划支持 1000 个分支，通常足够

### 8.4 成本优化建议

1. **按需启动：** 不要为所有 PR 自动部署，可以设置 label（如 `deploy-preview`）触发
2. **自动休眠：** 配置无流量时自动缩容至 0，有请求时冷启动
3. **共享数据库方案：** 开发阶段使用共享 DB + Table Prefix，测试阶段再使用独立 DB
4. **清理及时：** PR 合并/关闭后立即销毁所有资源，避免僵尸环境

---

## 九、Vercel Preview vs Cloudflare Pages Preview 对比

| 特性 | Vercel Preview | Cloudflare Pages Preview |
|------|---------------|------------------------|
| **免费额度** | 100 次/月（Hobby） | 500 次/月（免费计划） |
| **构建速度** | 快（Node 运行时优化） | 快（Edge 构建） |
| **Preview URL 格式** | `<project>-<hash>-<team>.vercel.app` | `<branch>.<project>.pages.dev` |
| **自定义域名** | ✅ 支持 alias | ✅ 支持自定义域 |
| **Edge Functions** | ✅ Vercel Edge Runtime | ✅ Cloudflare Workers |
| **环境变量隔离** | ✅ Preview/Production 分离 | ✅ Preview/Production 分离 |
| **Git 集成** | GitHub/GitLab/Bitbucket | GitHub/GitLab |
| **PR 评论** | ✅ 自动（内置） | ✅ 需配置 |
| **DDoS 防护** | ✅ 基础防护 | ✅ Cloudflare 全家桶 |
| **全球 CDN** | ✅ 全球边缘节点 | ✅ 300+ 城市边缘节点 |
| **带宽限制** | 100 GB/月（Hobby） | 无限（免费计划） |
| **适合场景** | Next.js 生态、Vercel 用户 | 静态站、需要 Cloudflare 生态 |

**建议：**

- 如果你的项目以 **Next.js** 为核心且已在 Vercel 生态中，继续使用 Vercel Preview 是最无缝的选择
- 如果你追求 **性价比**，且项目以静态站 + SSR 为主，Cloudflare Pages 的免费额度更慷慨
- 对于 **全栈项目**，两者都能与 Laravel API 灵活集成，核心差异在于前端部署的便利程度

---

## 十、完整流程总结

一个成熟的 Feature Branch Preview 工作流如下：

```
1. 开发者创建 PR
       │
       ▼
2. GitHub Actions 检测变更
       │
       ├─► 前端代码变更 → 触发 Vercel/CF Pages Preview Deploy
       │
       └─► 后端代码变更 → 触发 Laravel API Preview Deploy
              │
              ▼
         创建临时数据库分支
              │
              ▼
         部署 API 到临时容器
              │
              ▼
         配置 DNS 记录
              │
              ▼
3. 自动评论 PR（包含所有 Preview URL）
       │
       ▼
4. 团队成员访问 Preview URL 进行 Review
       │
       ▼
5. PR 合并或关闭
       │
       ├─► 合并 → 部署到 Production + 销毁 Preview 环境
       └─► 关闭 → 直接销毁 Preview 环境（清理 DB、容器、DNS）
```

---

## 结语

Feature Branch Preview 不仅仅是"好看的技术"，它从根本上改变了 Code Review 的质量。当 Reviewer 可以直接点击链接、操作真实的应用，bug 发现率显著提升，UI 争论大幅减少。

**关键收获：**

1. **Vercel 和 Cloudflare Pages** 都提供了优秀的 Preview 部署能力，选择取决于你的技术栈和预算
2. **后端 Preview 是核心难点**，推荐使用 PlanetScale 分支 + Fly.io/Railway 的组合
3. **自动化清理** 不可忽略，否则成本会快速失控
4. **成本可控**，通过合理的触发条件和及时清理，大多数中小团队的额外成本在 $20-50/月

在下一篇文章中，我们将介绍如何使用 **Terraform** 将这些 Preview 环境的基础设施管理代码化（IaC），实现完全可复现的 Preview 环境搭建流程。

---

## 相关阅读

- [Feature Branch Preview 实战（完整版）：PR 级预览环境——Vercel/Cloudflare Pages + Laravel 的全栈方案](/categories/07_CICD/feature-branch-preview-pr-level-preview-environment-vercel-cloudflare-laravel/) — 本文的扩展版，包含 Neon Branching、Railway PR Environments、完整踩坑记录等更多内容
- [Ansible 实战：Laravel 应用自动化部署与配置管理踩坑记录](/categories/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/) — 如果你选择自托管方案部署 Preview 环境，Ansible 是自动化配置管理的理想工具
- [Progressive Delivery 实战：Feature Flag + 渐进式发布——Unleash + Argo Rollouts 完整工程化工作流](/categories/07_CICD/Progressive-Delivery-实战-Feature-Flag-渐进式发布-Unleash-Argo-Rollouts完整工程化工作流/) — PR Preview 合并后的进阶实践，通过 Feature Flag 实现灰度发布与渐进式交付

---

> 💬 你的团队目前使用什么方案管理 Preview 环境？欢迎在评论区分享经验！
