---
title: Feature Branch Preview 实战：PR 级预览环境——Vercel Preview/Cloudflare Pages Preview + Laravel API 的全栈预览方案
description: 深入讲解 Feature Branch Preview 实战方案：通过 Vercel Preview、Cloudflare Pages Preview 部署前端，配合 Laravel API 后端预览环境，利用 GitHub Actions 实现 PR 级全栈预览环境的自动化部署与清理。涵盖 Fly.io、Railway、Neon Branching 等方案的选型对比与踩坑记录。
date: 2026-06-06 00:00:00
tags: [ci/cd, preview, vercel, cloudflare, laravel, github actions]
categories:
  - devops
cover: /images/covers/feature-branch-preview-cover.jpg
---

# Feature Branch Preview 实战：PR 级预览环境——Vercel Preview/Cloudflare Pages Preview + Laravel API 的全栈预览方案

## 前言

在现代全栈开发团队中，代码审查（Code Review）的质量直接影响着产品的交付质量。然而，传统的 Code Review 流程存在一个根本性的缺陷——**审查者只能通过代码本身来想象最终效果，而无法真实地体验和验证功能**。这导致了大量的"代码看着没问题，实际上线就出 bug"的窘境。

Feature Branch Preview（特性分支预览）技术的出现彻底改变了这一现状。它让每一个 Pull Request（PR）都能自动获得一个独立的、可访问的预览 URL，使得产品经理、设计师、QA 工程师以及其他开发者都能在合并代码之前，真实地体验和验证每一个特性分支的完整效果。

本文将深入探讨如何利用 Vercel Preview / Cloudflare Pages Preview 部署前端，配合 Laravel API 的后端预览方案，通过 GitHub Actions 实现全自动化的全栈预览环境，并分享大量实战中的踩坑经验。无论你是独立开发者还是团队技术负责人，都能从本文找到可落地的实施方案。

---

## 一、为什么需要 PR 级预览环境

### 1.1 传统开发流程的痛点

在没有预览环境的团队中，开发流程通常面临以下问题：

**反馈滞后**：开发者提交 PR 后，审查者只能通过阅读代码来理解变更。当变更涉及 UI 调整、交互逻辑、API 对接等需要"眼见为实"的内容时，纯代码审查的效率极低。很多问题只有在功能合并并部署到 staging 环境后才能被发现，此时修复成本已经大幅增加。根据业界统计，一个在 Code Review 阶段就能发现的 bug，修复成本大约是编码阶段的 5 倍；而如果等到上线后才发现，修复成本可能高达 15 倍以上。

**Staging 环境成为瓶颈**：大多数团队只有一个共享的 staging 环境，多个 PR 的功能同时部署到这个环境上，互相干扰。当 staging 出现问题时，团队需要花费大量时间来定位是哪个 PR 引入的缺陷，甚至出现"谁的 PR 最后合并的谁背锅"的不健康现象。更糟糕的是，当两个 PR 修改了同一个页面或同一个 API 接口时，staging 环境上看到的效果可能是两个 PR 叠加的异常状态，根本无法代表任何一个 PR 的真实效果。

**跨团队协作困难**：产品经理想要提前预览某个功能，设计师想要验证 UI 实现是否符合设计稿，QA 工程师想要提前编写测试用例——这些需求在没有独立预览环境的情况下都无法得到满足。产品经理只能在每周的 Sprint Review 上才能看到功能进展，设计师只能在合并后才能发现问题，QA 只能在部署到 staging 后才能开始测试，整个团队的工作节奏被严重拖慢。

**部署验证风险高**：很多团队的做法是"先合并再验证"，这意味着有问题的代码已经被合并到了主分支，回滚操作既危险又耗时。特别是在多人协作的项目中，回滚一个 PR 可能会影响其他已经合并的 PR，造成连锁反应。

### 1.2 PR 级预览环境的价值

PR 级预览环境的核心价值在于：

- **所见即所得**：审查者可以通过一个 URL 直接访问 PR 对应的完整应用，不再需要在脑中构建代码的运行效果
- **环境隔离**：每个 PR 拥有独立的环境，互不干扰，一个 PR 的问题不会影响其他 PR 的预览
- **自动化**：PR 创建时自动部署预览，PR 关闭时自动清理资源，无需人工干预
- **降低风险**：在合并前就完成功能验证，大幅降低线上事故概率
- **提升协作效率**：非技术人员也能参与功能验收，打破开发与其他团队之间的信息壁垒
- **加速迭代**：开发者可以快速验证自己的修改效果，缩短"编码-验证"的反馈循环

---

## 二、Vercel Preview Deployments 的工作原理与配置

### 2.1 工作原理

Vercel 的 Preview Deployments 是目前最成熟的前端预览方案之一。当你将 Vercel 项目与 GitHub 仓库关联后，Vercel 会自动监听所有的 Pull Request 事件。每当有新的 PR 创建或更新时，Vercel 会：

1. 检测到 PR 事件，获取源分支的最新代码
2. 根据项目的构建配置执行构建流程
3. 将构建产物部署到一个唯一的预览 URL（如 `my-app-abc123-team.vercel.app`）
4. 在 PR 中自动添加带有预览链接的评论
5. 当 PR 有新的 commit push 时，自动重新部署
6. PR 关闭或合并后，预览部署可以选择性地保留或清理

Vercel 的构建系统非常智能，它会根据项目根目录的配置文件自动检测框架类型，并应用最佳的构建策略。对于 Next.js 项目，Vercel 还支持增量静态生成（ISR）和服务器端渲染（SSR）的预览模式，这意味着你的预览环境能够完整地展示应用的所有渲染模式。

### 2.2 配置步骤

**第一步：连接 GitHub 仓库**

登录 Vercel Dashboard，点击 "New Project"，选择你的 GitHub 仓库。Vercel 会自动检测项目类型（Next.js、Nuxt、Vite、Create React App 等）并配置合理的构建参数。整个过程通常只需要一分钟左右。

**第二步：配置构建设置**

在项目的 Settings → General 页面，可以配置：

```bash
# Build & Development Settings
Framework Preset: Vite (或其他你的框架)
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

对于 monorepo 项目，还需要设置 Root Directory 指向前端项目的子目录，并配置合理的 Ignored Build Step 来避免不必要的重新构建。

**第三步：配置 Preview 环境变量**

在 Settings → Environment Variables 页面，可以分别为 Production、Preview 和 Development 环境配置不同的环境变量：

```bash
# Preview 环境专用变量
VITE_API_URL = https://api-preview-${VERCEL_GIT_PULL_REQUEST_ID}.example.com
VITE_APP_ENV = preview
```

Vercel 提供了大量内置的环境变量，其中最有用的包括：

- `VERCEL_GIT_PULL_REQUEST_ID`：PR 编号
- `VERCEL_GIT_COMMIT_REF`：分支名称
- `VERCEL_URL`：当前预览部署的 URL
- `VERCEL_ENV`：环境类型（production / preview / development）
- `VERCEL_GIT_COMMIT_SHA`：当前 commit 的完整 SHA 值

这些内置变量在构建时自动注入，不需要手动配置，非常适合用于条件逻辑和动态配置。

**第四步：配置忽略规则（可选）**

在项目根目录创建 `vercel.json`：

```json
{
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- . ':!docs'",
  "github": {
    "silent": true
  }
}
```

这可以控制某些目录的变更不触发重新部署。比如，当你只修改了文档文件时，不需要重新部署前端应用，这样可以节省构建时间和资源。

### 2.3 高级配置

**自定义预览域名**：通过 Vercel 的 "Preview" 域名设置，可以让所有预览部署都使用你自己的域名，如 `${PR_ID}-preview.your-app.com`：

```json
{
  "preview": {
    "alias": ["${VERCEL_GIT_PULL_REQUEST_ID}-preview.your-app.com"]
  }
}
```

**密码保护**：Preview 部署可以设置访问密码，防止未授权访问。这在涉及内部项目或敏感数据时非常重要：

```json
{
  "passwordProtection": {
    "deployment": {
      "enabled": true,
      "password": "your-secret-password"
    }
  }
}
```

**Webhook 通知**：Vercel 支持配置 Webhook，在部署成功或失败时通知外部系统。你可以将通知发送到 Slack、飞书或钉钉等团队协作工具中，让整个团队实时了解预览环境的状态。

---

## 三、Cloudflare Pages Preview 的工作原理与配置

### 3.1 工作原理

Cloudflare Pages 是 Cloudflare 提供的前端部署平台，其 Preview 功能与 Vercel 类似但有自己的特点。Cloudflare Pages 的最大优势在于其全球边缘网络（Edge Network），预览部署的加载速度通常非常快，特别是在亚太地区的访问体验明显优于某些竞争对手。

Cloudflare Pages Preview 的工作流程：

1. 监听 GitHub 的 PR 事件
2. 使用 Cloudflare Build System 构建项目
3. 部署到唯一的预览子域名（如 `abc123.my-app.pages.dev`）
4. 在 PR 中添加预览链接评论
5. 支持增量更新，只重建变更的部分

Cloudflare Pages 的构建系统基于 Cloudflare Workers 运行时，构建速度非常快。对于大多数前端项目，从代码推送到预览可用通常只需要 30 秒到 2 分钟。

### 3.2 配置步骤

**第一步：连接仓库**

在 Cloudflare Dashboard 中进入 Pages，点击 "Create a project" → "Connect to Git"，选择你的 GitHub 仓库。Cloudflare 会请求 GitHub 的授权，授权完成后即可选择仓库和分支。

**第二步：配置构建设置**

```bash
# Build settings
Production branch: main
Build command: npm run build
Build output directory: dist
Root directory: / (项目根目录)
```

Cloudflare Pages 还支持环境变量级别的构建命令，你可以在 Preview 分支上使用不同于 Production 的构建参数。

**第三步：配置环境变量**

Cloudflare Pages 支持为 Production 和 Preview 环境分别配置环境变量：

```bash
# Preview 环境变量
VITE_API_URL = https://api-pr-$CF_PAGES_BRANCH.example.com
VITE_ENVIRONMENT = preview
```

Cloudflare 提供的内置变量：

- `CF_PAGES`：固定值 `1`，标识当前在 Cloudflare Pages 环境中
- `CF_PAGES_BRANCH`：当前分支名称
- `CF_PAGES_COMMIT_SHA`：当前 commit 的 SHA
- `CF_PAGES_URL`：当前预览部署的 URL

这些变量在构建过程中自动可用，可以用于条件构建逻辑。

**第四步：配置构建钩子和 Headers**

Cloudflare Pages 支持 `_headers` 文件来配置 HTTP 响应头，支持 `_redirects` 文件来配置 URL 重定向规则。这些文件放在构建输出目录中即可生效。

```text
# _headers
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

### 3.3 Wrangler CLI 本地调试

Cloudflare 提供了 Wrangler CLI 工具，可以在本地测试 Pages 的行为：

```bash
# 安装 wrangler
npm install -g wrangler

# 本地预览
npx wrangler pages dev dist

# 部署到预览环境
npx wrangler pages deploy dist --branch=feature/my-branch
```

Wrangler 还支持直接从 CI/CD 环境中部署，这在需要更复杂的构建流程时非常有用。

### 3.4 Vercel vs Cloudflare Pages 对比

在实际选型时，两个平台各有优劣。以下是详细对比：

| 特性 | Vercel | Cloudflare Pages |
|------|--------|-----------------|
| 构建速度 | 快 | 非常快（Edge 部署） |
| 预览 URL 格式 | `{project}-{hash}-{team}.vercel.app` | `{hash}.{project}.pages.dev` |
| 付费方案免费额度 | Hobby 免费，Pro $20/月 | 免费方案更慷慨 |
| Serverless Functions | 支持（Node.js / Edge） | 支持（Workers） |
| 分支部署 | ✅ 自动 | ✅ 自动 |
| 密码保护 | ✅ 支持 | 需 Workers |
| 自定义域名预览 | ✅ 支持 | ✅ 支持 |
| 亚太区访问速度 | 良好 | 优秀 |
| Next.js 支持 | 原生最佳 | 支持但不如 Vercel |
| Monorepo 支持 | 优秀 | 一般 |

**选型建议**：如果你的项目使用 Next.js 或需要深度的框架集成，Vercel 是更好的选择；如果你更看重全球访问速度和免费额度，Cloudflare Pages 值得考虑。

---

## 四、Laravel API 后端的预览方案

前端有了 Preview Deployments，但全栈应用还需要后端 API 的预览环境。这是整个方案中最复杂的部分，因为后端涉及应用服务器、数据库、队列、缓存等多个组件。与前端的静态部署不同，后端预览需要一个真正运行的服务器环境。

### 4.1 Fly.io Preview Apps

Fly.io 是一个优秀的容器化部署平台，非常适合部署 Laravel 应用。它支持为每个 PR 自动创建独立的应用实例，并且具有自动休眠和唤醒的能力，能够在没有流量时自动停止以节省成本。

**核心思路**：通过 GitHub Actions，在 PR 创建时使用 `flyctl` 创建一个以 PR 编号命名的临时应用，PR 关闭时删除该应用。

```yaml
# 在 GitHub Actions 中创建 Fly.io Preview App
- name: Deploy Preview App
  if: github.event.action == 'opened' || github.event.action == 'synchronize'
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
  run: |
    APP_NAME="my-app-pr-${{ github.event.pull_request.number }}"
    cd backend
    
    # 创建或更新应用
    flyctl apps create "$APP_NAME" --generate-name=false || true
    
    # 设置 Secrets
    flyctl secrets set \
      APP_KEY=$(openssl rand -base64 32) \
      DATABASE_URL="${PREVIEW_DATABASE_URL}" \
      --app "$APP_NAME"
    
    # 部署
    flyctl deploy --app "$APP_NAME" --remote-only
    
    # 输出预览 URL
    echo "API_URL=https://${APP_NAME}.fly.dev" >> $GITHUB_ENV
```

**Fly.io 的优势**：

- 支持自动休眠：Preview App 没有流量时自动休眠，节省成本
- 全球部署：可以选择离开发团队最近的区域，降低延迟
- 支持 Volumes：可以挂载持久化存储，适合需要文件上传的场景
- 原生支持 IPv6 和 IPv4，网络兼容性好
- 内置健康检查和自动重启机制

**成本控制**：

Fly.io 的 Hobby 计划有免费额度，但预览环境可能超出免费额度。建议：

- 为 Preview App 设置较小的资源规格（shared-cpu-1x, 256MB RAM）
- 利用自动休眠功能减少空闲时间
- 设置自动清理定时任务，删除超过 7 天的预览应用
- 监控每月用量，设置预算告警

### 4.2 Railway PR Environments

Railway 提供了原生的 PR Environments 功能，与 GitHub PR 深度集成。它是目前最"开箱即用"的后端预览方案之一，几乎不需要额外的脚本编写。

**配置方式**：

```json
// railway.json（项目根目录）
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "php artisan serve --host=0.0.0.0 --port=$PORT",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Railway 的 PR Environments 特性：

- PR 创建时自动创建一个新的 Environment，无需额外配置
- 自动 fork 数据库（从 main 分支的数据库快照），实现数据隔离
- PR 关闭时自动销毁 Environment，清理所有资源
- 每个 Environment 有独立的 URL 和环境变量
- 支持自定义域名绑定
- 内置日志查看和监控面板

Railway 的定价模型基于实际资源使用量（CPU 时间和内存），对于 Preview 环境这种间歇性使用的场景非常友好。

### 4.3 Docker Compose per PR（自托管方案）

如果团队使用自己的服务器或者 Kubernetes 集群，可以通过 Docker Compose 为每个 PR 创建独立的服务栈。这种方式给予团队最大的控制权，但也需要更多的维护工作。

**Docker Compose 模板**：

```yaml
# docker-compose.preview.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - APP_ENV=preview
      - APP_KEY=${APP_KEY}
      - DB_CONNECTION=mysql
      - DB_HOST=db
      - DB_DATABASE=preview_${PR_NUMBER}
      - DB_USERNAME=preview
      - DB_PASSWORD=${DB_PASSWORD}
      - CACHE_DRIVER=redis
      - REDIS_HOST=redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.preview-${PR_NUMBER}.rule=Host(`pr-${PR_NUMBER}.api.example.com`)"
      - "traefik.http.routers.preview-${PR_NUMBER}.tls.certresolver=letsencrypt"

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: preview_${PR_NUMBER}
      MYSQL_USER: preview
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - preview_data_${PR_NUMBER}:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine

  queue:
    build:
      context: .
      dockerfile: Dockerfile
    command: php artisan queue:work --sleep=3 --tries=3
    environment:
      - APP_ENV=preview
    depends_on:
      - app

volumes:
  preview_data_${PR_NUMBER}:
```

**使用 Traefik 作为反向代理**：

```yaml
# traefik.yml（独立的 Traefik 配置）
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Traefik 会自动发现带有特定标签的 Docker 容器，并为其配置路由规则和 SSL 证书。当新的 PR 部署完成后，对应的域名会自动生效，无需手动配置。

---

## 五、全栈预览架构：前端 Preview + 后端 Preview 的组合方案

### 5.1 架构总览

一个完整的全栈 PR 预览环境架构如下：

```
PR #123 Created
        │
        ├── Frontend Preview (自动)
        │   ├── Vercel/Cloudflare 检测到 PR
        │   ├── 构建前端代码
        │   └── 部署到 https://pr-123-fe.your-app.com
        │
        └── Backend Preview (GitHub Actions 触发)
            ├── 构建 Laravel Docker 镜像
            ├── 创建预览数据库
            ├── 运行迁移和 Seed
            ├── 部署到 https://pr-123-api.your-app.com
            └── 设置环境变量使前端指向后端预览 URL
```

这种架构的关键在于前端和后端的预览环境是独立创建但又相互关联的。前端预览由 Vercel/Cloudflare 自动处理，后端预览由 GitHub Actions 触发部署，两者通过环境变量或域名规则进行关联。

### 5.2 统一域名策略

为了让整个系统更清晰，建议采用统一的域名命名策略：

```
前端预览：pr-{number}.app.your-app.com
后端预览：pr-{number}.api.your-app.com
```

使用 Cloudflare 或其他 DNS 提供商的通配符 DNS 记录来简化配置：

```dns
# Cloudflare DNS 配置
*.app.your-app.com    → CNAME → cname.vercel-dns.com
*.api.your-app.com    → CNAME → preview-proxy.your-app.com
```

这种统一的命名规则不仅便于管理，还能让团队成员通过直观的 URL 规则快速定位某个 PR 的前后端预览环境。

### 5.3 环境变量联动

前端 Preview 部署需要知道后端 API 的 URL，这需要一个联动机制：

**方案一：GitHub Actions 中动态设置**

```yaml
# deploy-preview.yml
- name: Set API URL for frontend
  run: |
    PR_NUMBER=${{ github.event.pull_request.number }}
    API_URL="https://pr-${PR_NUMBER}.api.your-app.com"
    
    # 通过 Vercel API 更新 Preview 环境变量
    curl -X PATCH "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${ENV_ID}" \
      -H "Authorization: Bearer *** \
      -H "Content-Type: application/json" \
      -d "{\"value\": \"${API_URL}\"}"
```

**方案二：前端代码中动态构建 URL（推荐）**

```typescript
// src/config/api.ts
const getApiUrl = (): string => {
  // 生产环境使用固定 URL
  if (import.meta.env.PROD && import.meta.env.VITE_APP_ENV === 'production') {
    return 'https://api.your-app.com';
  }
  
  // Preview 环境根据当前域名自动推导 API URL
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // pr-123.app.your-app.com → pr-123.api.your-app.com
    return `https://${hostname.replace('.app.', '.api.')}`;
  }
  
  return import.meta.env.VITE_API_URL || 'http://localhost:8000';
};

export const API_URL = getApiUrl();
```

方案二是更优雅的做法——前端不需要额外的环境变量配置，它会根据当前访问的域名自动推导出后端 API 的地址。这样即使前端预览先于后端预览部署完成，也不会出现配置错误的问题。

---

## 六、GitHub Actions 实现自动化

### 6.1 完整的 CI/CD 工作流

以下是一个完整的 GitHub Actions 工作流，实现 PR 创建时部署预览、PR 更新时重新部署、PR 关闭时清理资源：

```yaml
# .github/workflows/preview-environment.yml
name: Preview Environment

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  PR_NUMBER: ${{ github.event.pull_request.number }}
  FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
  VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

jobs:
  deploy-backend:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql

      - name: Install dependencies
        run: |
          cd backend
          composer install --no-dev --optimize-autoloader

      - name: Run tests
        run: |
          cd backend
          php artisan test --parallel

      - name: Deploy to Fly.io
        run: |
          cd backend
          APP_NAME="myapp-pr-${PR_NUMBER}"
          
          # 确保 fly.toml 存在
          cp fly.preview.toml fly.toml
          
          # 替换应用名称
          sed -i "s/\${APP_NAME}/${APP_NAME}/g" fly.toml
          
          # 创建应用（如果不存在）
          flyctl apps create "$APP_NAME" || true
          
          # 设置 Secrets
          flyctl secrets set \
            APP_KEY="base64:$(openssl rand -base64 32)" \
            APP_ENV=preview \
            APP_DEBUG=true \
            APP_URL="https://${APP_NAME}.fly.dev" \
            DB_CONNECTION=sqlite \
            SESSION_DRIVER=file \
            CACHE_DRIVER=file \
            QUEUE_CONNECTION=sync \
            --app "$APP_NAME"
          
          # 部署
          flyctl deploy --app "$APP_NAME" --remote-only --no-cache

      - name: Get API URL
        id: api-url
        run: |
          API_URL="https://myapp-pr-${PR_NUMBER}.fly.dev"
          echo "url=${API_URL}" >> $GITHUB_OUTPUT

    outputs:
      api-url: ${{ steps.api-url.outputs.url }}

  deploy-frontend:
    needs: deploy-backend
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Vercel CLI
        run: npm install -g vercel

      - name: Pull Vercel Environment
        run: |
          cd frontend
          vercel pull --yes --environment=preview \
            --token=${{ secrets.VERCEL_TOKEN }}

      - name: Build Frontend
        env:
          VITE_API_URL: ${{ needs.deploy-backend.outputs.api-url }}
        run: |
          cd frontend
          vercel build --token=${{ secrets.VERCEL_TOKEN }}

      - name: Deploy to Vercel
        id: vercel-deploy
        run: |
          cd frontend
          URL=$(vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }})
          echo "url=${URL}" >> $GITHUB_OUTPUT

      - name: Comment Preview URL on PR
        uses: actions/github-script@v7
        with:
          script: |
            const frontendUrl = '${{ steps.vercel-deploy.outputs.url }}';
            const apiUrl = '${{ needs.deploy-backend.outputs.api-url }}';
            
            const body = `## 🚀 Preview Environment Ready!
            
            | Service | URL |
            |---------|-----|
            | 🌐 Frontend | [${frontendUrl}](${frontendUrl}) |
            | ⚙️ Backend API | [${apiUrl}](${apiUrl}) |
            | 📋 API Docs | [${apiUrl}/docs](${apiUrl}/docs) |
            
            > Preview environment will be automatically cleaned up when this PR is closed.
            > Last updated: ${new Date().toISOString()}
            `;
            
            // 查找已有的评论并更新
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            
            const existing = comments.find(c => c.body.includes('Preview Environment Ready'));
            
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
                issue_number: context.issue.number,
                body,
              });
            }

  cleanup:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Cleanup Fly.io App
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          APP_NAME="myapp-pr-${PR_NUMBER}"
          flyctl apps destroy "$APP_NAME" --yes || echo "App not found or already deleted"

      - name: Cleanup Comment
        uses: actions/github-script@v7
        with:
          script: |
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            
            const previewComment = comments.find(c => c.body.includes('Preview Environment Ready'));
            
            if (previewComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: previewComment.id,
                body: `## 🧹 Preview Environment Cleaned Up\n\n> This preview environment has been automatically removed.\n> Cleaned at: ${new Date().toISOString()}`,
              });
            }
```

### 6.2 并发控制

`concurrency` 配置确保同一个 PR 的多次 push 不会产生多个并行的部署任务。`cancel-in-progress: true` 会在新的 push 到来时取消之前还在进行中的部署，避免浪费资源。这对于频繁提交的开发者来说非常重要——如果你在一个 PR 上连续推送了三次，只有最后一次会被完整地部署。

### 6.3 安全考虑

对于来自 fork 仓库的 PR，需要特别注意安全问题：

```yaml
# 对于 fork 仓库的 PR，限制 secrets 的访问
jobs:
  deploy:
    # 只对非 fork 的 PR 进行部署
    if: github.event.pull_request.head.repo.full_name == github.repository
```

Fork PR 无法访问仓库的 Secrets，这是 GitHub 的安全限制。如果你仍然想为 fork PR 提供预览环境，可以考虑使用有限权限的公共 token 或者通过 GitHub Environments 配合审批机制来实现。

---

## 七、数据库预览策略

数据库是预览环境中最复杂的部分。不同的团队和项目可能需要不同的策略，选择合适的方案需要在成本、速度和数据隔离性之间做权衡。

### 7.1 Neon Branching（推荐）

Neon 是一个 Serverless PostgreSQL 服务，它提供了独特的数据库分支功能——可以从主数据库在几秒钟内创建一个分支副本，而且只存储差异数据，成本极低。

```yaml
# 在 GitHub Actions 中创建 Neon 数据库分支
- name: Create Neon Branch
  id: neon-branch
  run: |
    # 使用 Neon API 创建分支
    RESPONSE=$(curl -s -X POST \
      "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
      -H "Authorization: Bearer *** \
      -H "Content-Type: application/json" \
      -d "{
        \"branch\": {
          \"parent_id\": \"${PARENT_BRANCH_ID}\",
          \"name\": \"preview-pr-${PR_NUMBER}\"
        }
      }")
    
    BRANCH_ID=$(echo $RESPONSE | jq -r '.branch.id')
    CONNECTION_STRING=$(echo $RESPONSE | jq -r '.connection_uris[0].connection_uri')
    
    echo "branch_id=${BRANCH_ID}" >> $GITHUB_OUTPUT
    echo "db_url=${CONNECTION_STRING}" >> $GITHUB_OUTPUT
```

**Neon Branching 的优势**：

- 创建速度快（秒级），不需要等待数据复制完成
- 存储成本低（只存储与父分支的差异数据）
- 支持独立的读写操作，完全不影响主分支的数据
- 支持自动过期清理，可以设置分支的 TTL
- 提供完整的 PostgreSQL 兼容性，不需要修改 Laravel 的数据库配置

**Laravel 适配**：

```php
// config/database.php 中添加 preview 连接
'preview' => [
    'driver' => 'pgsql',
    'url' => env('PREVIEW_DATABASE_URL'),
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '5432'),
    'database' => env('DB_DATABASE', 'preview'),
    'username' => env('DB_USERNAME', 'postgres'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8',
    'prefix' => '',
    'prefix_indexes' => true,
    'search_path' => 'public',
    'sslmode' => 'prefer',
],
```

### 7.2 Seed 数据策略

对于预览环境，通常不需要完整的生产数据。使用 Seed 数据更加合适，它既安全（不包含真实用户数据）又高效（数据量小、构建快）：

```php
// database/seeders/PreviewSeeder.php
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\User;
use App\Models\Post;
use App\Models\Comment;

class PreviewSeeder extends Seeder
{
    public function run(): void
    {
        // 创建管理员账号
        $admin = User::factory()->create([
            'name' => 'Preview Admin',
            'email' => 'admin@preview.test',
            'password' => bcrypt('preview123'),
        ]);

        // 创建测试用户
        $users = User::factory(10)->create();

        // 创建示例文章
        $posts = Post::factory(30)
            ->for($admin, 'author')
            ->create();

        // 为其他用户也创建文章
        foreach ($users as $user) {
            Post::factory(rand(1, 5))
                ->for($user, 'author')
                ->create();
        }

        // 创建评论
        Comment::factory(100)
            ->for($posts->random(), 'post')
            ->for($users->random(), 'user')
            ->create();
    }
}
```

```bash
# 在部署脚本中运行 Seed
php artisan migrate --force
php artisan db:seed --class=PreviewSeeder --force
```

**Seed 数据设计原则**：数据量适中，能够展示应用的主要功能即可；数据之间有合理的关联关系；包含一些边界情况（如超长文本、特殊字符等）以便测试。

### 7.3 共享数据库策略

在某些情况下，可以使用共享数据库配合数据隔离的方式。这种方法适合小型项目或者数据库成本敏感的场景：

```php
// app/Http/Middleware/PreviewScope.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\Eloquent\Builder;

class PreviewScope
{
    public function handle($request, Closure $next)
    {
        // 在预览环境中，通过 PR 编号隔离数据
        if (config('app.preview_pr_number')) {
            Builder::macro('previewScope', function () {
                return $this->where('preview_pr', config('app.preview_pr_number'));
            });
        }
        
        return $next($request);
    }
}
```

**重要提醒**：共享数据库方案只适合小型项目或开发早期阶段。在正式的生产预览中，强烈建议使用数据库分支或独立数据库来确保数据隔离性和安全性。

---

## 八、环境变量与密钥管理

### 8.1 分层管理策略

环境变量应该按层级管理，避免重复配置和管理混乱：

```
项目级（所有环境共享）
  ├── 应用名称、时区、日志格式
  │
环境级（Production / Preview / Development）
  ├── API URL、调试开关、缓存驱动
  │
PR 级（每个 PR 独立）
  ├── 数据库连接、APP_KEY、特定服务的 URL
```

这种分层策略使得大部分配置只需要设置一次，只有真正需要差异化的变量才在 PR 级别进行覆盖。

### 8.2 GitHub Secrets 配置

```bash
# 必需的 Secrets（Repository Settings → Secrets）
FLY_API_TOKEN           # Fly.io API Token
VERCEL_TOKEN            # Vercel API Token
VERCEL_ORG_ID           # Vercel 团队 ID
VERCEL_PROJECT_ID       # Vercel 项目 ID
NEON_API_KEY            # Neon 数据库 API Key
NEON_PROJECT_ID         # Neon 项目 ID
PREVIEW_DB_ROOT_PASSWORD # 数据库 root 密码
```

**安全建议**：不要在 Secrets 中存放可以在代码中公开的配置（如非敏感的环境标识），Secrets 应该只用于真正的敏感信息。同时，定期轮换 Secrets 的值，特别是在团队成员变动时。

### 8.3 环境变量注入的最佳实践

```yaml
# 使用 GitHub Actions 的 Environment Files 安全地传递变量
- name: Set environment
  run: |
    echo "APP_ENV=preview" >> $GITHUB_ENV
    echo "APP_DEBUG=true" >> $GITHUB_ENV
    echo "LOG_CHANNEL=stderr" >> $GITHUB_ENV
    
    # 敏感信息使用 Masked 方式
    DB_URL=$(generate_db_url)
    echo "::add-mask::${DB_URL}"
    echo "DATABASE_URL=${DB_URL}" >> $GITHUB_ENV
```

`::add-mask::` 指令会将该值标记为敏感信息，后续的日志输出中该值会被自动替换为 `***`，防止敏感信息泄露到 CI 日志中。

### 8.4 Laravel 环境配置

```php
// config/preview.php（在 Laravel 中）
<?php

return [
    'enabled' => (bool) env('PREVIEW_ENABLED', false),
    'pr_number' => env('PREVIEW_PR_NUMBER'),
    'show_banner' => (bool) env('PREVIEW_SHOW_BANNER', true),
    'database_url' => env('PREVIEW_DATABASE_URL'),
];
```

在前端展示一个明显的预览环境标识非常重要，它可以避免团队成员误以为预览环境就是正式环境：

```blade
{{-- resources/views/components/preview-banner.blade.php --}}
@if(config('preview.enabled') && config('preview.show_banner'))
<div class="bg-yellow-500 text-black text-center py-2 px-4 text-sm font-medium">
    ⚠️ 预览环境 — PR #{{ config('preview.pr_number') }} — 
    此为功能预览，不代表最终上线效果
</div>
@endif
```

---

## 九、实战踩坑记录

在实际实施全栈预览环境的过程中，我们遇到了许多问题。以下是最重要的几个踩坑点和解决方案，希望能帮助读者少走弯路。

### 9.1 CORS 问题

**问题**：前端预览 URL（`https://pr-123.app.your-app.com`）向后端预览 URL（`https://pr-123.api.your-app.com`）发送请求时，浏览器报 CORS 错误。

**原因**：后端的 CORS 配置没有包含前端的预览 URL。

**解决方案**：

```php
// config/cors.php
<?php

$previewOrigins = [];

// 动态添加预览环境的 Origin
if (app()->environment('preview')) {
    $prNumber = config('preview.pr_number');
    if ($prNumber) {
        $previewOrigins[] = "https://pr-{$prNumber}.app.your-app.com";
    }
}

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['*'],
    'allowed_origins' => array_merge(
        [
            'https://app.your-app.com',    // 生产环境
            'http://localhost:5173',        // 本地开发
        ],
        $previewOrigins
    ),
    'allowed_origins_patterns' => [
        '#^https://pr-\d+\.app\.your-app\.com$#',  // 使用正则匹配所有预览 URL
    ],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => true,
];
```

**踩坑点**：`allowed_origins_patterns` 中的正则表达式需要完整的域名匹配，不能只写路径部分。另外，当 `supports_credentials` 设置为 `true` 时，`allowed_methods` 不能使用通配符 `['*']`，需要明确列出允许的 HTTP 方法。这是浏览器的安全限制，很多开发者在这一点上踩坑。

### 9.2 域名与 SSL 证书问题

**问题**：使用通配符域名时，SSL 证书没有覆盖到预览子域名，导致浏览器显示不安全警告。

**解决方案**：

1. 使用 Cloudflare 的 Universal SSL 证书，它自动覆盖通配符域名，无需手动管理证书
2. 或者在 Traefik/Nginx 中配置 ACME 自动申请证书：

```toml
# traefik dynamic config
[tls]
  [[tls.certificates]]
    certFile = "/certs/wildcard.your-app.com.crt"
    keyFile = "/certs/wildcard.your-app.com.key"
```

3. 使用 `mkcert` 在开发环境中创建本地证书：

```bash
mkcert "*.app.your-app.com" "*.api.your-app.com"
```

**注意事项**：通配符证书只覆盖一级子域名，`*.your-app.com` 不匹配 `a.b.your-app.com`。如果你的预览域名有多层子域名，需要申请对应的通配符证书。

### 9.3 数据库迁移失败

**问题**：Preview 环境的数据库迁移顺序与主分支不一致，导致迁移失败。

**根本原因**：当多个 PR 各自添加了迁移文件，且这些迁移文件有依赖关系时，从某个分支创建的数据库副本可能缺少必要的迁移历史。

**解决方案**：

```bash
# 方案一：在创建分支时确保从最新的 main 分支创建
git checkout main
git pull origin main
git checkout -b feature/my-branch

# 方案二：在部署脚本前先 squash 迁移文件
php artisan migrate:fresh --seed --force

# 方案三：使用 Neon 的 Branch Reset 功能，每次从 main 重新 fork
```

**最佳实践**：在预览环境的部署脚本中始终使用 `migrate:fresh` 而不是普通的 `migrate`。虽然这会丢失之前的预览数据，但能确保数据库状态的一致性。

### 9.4 成本控制

**问题**：Preview 环境的资源消耗超出预期，月底账单让人惊讶。

**解决方案**：

1. **自动过期清理**：设置定时任务清理超过 7 天的预览环境

```yaml
# .github/workflows/cleanup-stale-previews.yml
name: Cleanup Stale Previews

on:
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点执行

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Cleanup stale Fly.io apps
        run: |
          # 列出所有预览应用
          APPS=$(flyctl apps list --json | jq -r '.[] | select(.Name | startswith("myapp-pr-")) | .Name')
          
          for APP in $APPS; do
            # 检查对应的 PR 是否已关闭
            PR_NUMBER=$(echo $APP | grep -oP '\d+')
            PR_STATE=$(gh pr view $PR_NUMBER --json state -q .state 2>/dev/null || echo "MERGED")
            
            if [ "$PR_STATE" != "OPEN" ]; then
              echo "Destroying $APP (PR #$PR_NUMBER is $PR_STATE)"
              flyctl apps destroy "$APP" --yes || true
            fi
          done
```

2. **资源限制**：为 Preview 应用设置最小的资源规格

```toml
# fly.preview.toml
[vm]
  size = "shared-cpu-1x"
  memory = "256mb"

[[services]]
  auto_stop_machines = true    # 无流量时自动停止
  auto_start_machines = true   # 有流量时自动启动
  min_machines_running = 0     # 允许降到 0
```

3. **预算监控**：使用 Fly.io / Vercel 的用量告警功能，设置月度预算上限。当接近预算时及时收到通知，避免意外账单。

### 9.5 队列和后台任务

**问题**：Laravel 的队列任务在 Preview 环境中不执行，导致异步操作（如邮件发送、图片处理）无法正常工作。

**解决方案**：在 Preview 环境中使用 `sync` 队列驱动，这样任务会在当前请求中同步执行，不需要独立的队列 Worker：

```env
QUEUE_CONNECTION=sync
```

如果确实需要异步队列（比如需要测试队列相关功能），可以在 Docker Compose 中添加独立的 Queue Worker 服务（如前面 4.3 节所示）。但要注意，同步队列在大多数 Preview 场景下已经足够，额外的 Worker 会增加资源消耗和系统复杂度。

### 9.6 文件存储问题

**问题**：Preview 环境中的文件上传无法持久化，每次重新部署后上传的文件都会丢失。

**解决方案**：使用 S3 兼容的对象存储，为每个 PR 创建独立的 bucket 前缀：

```php
// config/filesystems.php
'preview_prefix' => env('PREVIEW_FILE_PREFIX', 'local'),
```

```env
AWS_BUCKET=preview-pr-${PR_NUMBER}
PREVIEW_FILE_PREFIX=pr-${PR_NUMBER}/
```

**额外建议**：对于 Preview 环境中的文件上传，还可以在前端使用客户端直传（Client-side Upload）的方式，将文件直接上传到 S3，减少后端服务器的压力。Vercel 和 Cloudflare 都提供了 Blob Storage 服务，可以方便地处理文件上传需求。

---

## 十、与传统 Staging 环境的对比

### 10.1 对比表

| 维度 | 传统 Staging | PR Preview 环境 |
|------|-------------|----------------|
| **环境数量** | 1 个共享 | 每个 PR 1 个独立 |
| **部署速度** | 手动触发，较慢 | 自动触发，快 |
| **环境隔离** | 差，互相干扰 | 完全隔离 |
| **资源成本** | 固定成本 | 按需分配，动态伸缩 |
| **适用场景** | 集成测试、UAT | 功能验收、Code Review |
| **数据管理** | 固定的测试数据 | 独立的 Seed 数据 |
| **维护成本** | 需要专人维护 | 自动化管理 |
| **反馈速度** | 慢（需要等待部署） | 快（PR 创建即部署） |
| **多版本并行** | 困难 | 天然支持 |
| **访问权限** | 通常全团队共享 | 可按 PR 控制 |

### 10.2 并非替代关系

需要强调的是，PR Preview 环境**并非 Staging 环境的替代品**，而是**补充**。两者各有其不可替代的价值：

- **PR Preview**：适合功能级别的验证和 Code Review，环境生命周期与 PR 一致，强调的是"单个功能的完整体验"
- **Staging**：适合集成测试、性能测试、UAT（用户验收测试），环境相对持久，强调的是"多个功能合并后的整体验证"

一个成熟的团队应该同时拥有这两种环境，形成完整的质量保障体系：

```
开发 → PR Preview（功能验证）→ Code Review → 合并到 main → 
Staging（集成测试）→ Production
```

### 10.3 渐进式采用策略

如果团队从未使用过预览环境，建议采用渐进式的策略，避免一次性引入过多变化：

1. **第一阶段**：先为前端项目配置 Vercel/Cloudflare Preview（零成本起步，10 分钟即可完成）
2. **第二阶段**：为后端添加简单的预览部署（使用 Docker + 共享数据库），让前后端都能预览
3. **第三阶段**：引入数据库分支（如 Neon Branching），实现完全隔离的预览环境
4. **第四阶段**：优化自动化流程，添加清理机制、预算监控、告警通知等运维能力

每个阶段都可以在团队适应后再进入下一个阶段，循序渐进地提升预览环境的成熟度。

---

## 十一、总结与最佳实践

### 11.1 核心总结

Feature Branch Preview 是现代全栈开发团队提升开发效率和代码质量的重要实践。通过 Vercel Preview / Cloudflare Pages Preview 配合 Laravel API 的预览方案，我们可以为每个 PR 创建完整的、隔离的预览环境，让 Code Review 从"读代码"升级为"体验功能"。

关键要点：

1. **前端预览零门槛**：Vercel 和 Cloudflare Pages 都提供了开箱即用的 PR Preview 功能，接入成本极低
2. **后端预览是核心挑战**：需要根据团队的基础设施选择合适的方案（Fly.io / Railway / Docker Compose）
3. **数据库策略决定体验**：Neon Branching 是目前最佳的数据库分支方案，成本低、速度快
4. **自动化是关键**：整个流程应该完全自动化，开发者只需要关心 PR 本身
5. **清理机制不可少**：必须有完善的资源清理机制，避免成本失控

### 11.2 最佳实践清单

**配置层面**：
- ✅ 使用统一的域名命名策略（`pr-{N}.app.domain.com` / `pr-{N}.api.domain.com`）
- ✅ 前端通过域名自动推导后端 URL，避免手动配置环境变量
- ✅ 在 PR 评论中展示预览链接和服务信息
- ✅ 为 Preview 环境添加明显的视觉标识（顶部横幅）
- ✅ 设置环境变量分层管理，避免敏感信息泄露

**安全层面**：
- ✅ Fork PR 不暴露 Secrets（使用条件判断限制）
- ✅ Preview 环境禁用邮件发送、支付等真实外部服务
- ✅ Preview 环境的调试模式可以开启，但日志中要脱敏
- ✅ 设置 Preview 环境的访问密码（可选）

**成本层面**：
- ✅ 使用自动休眠（Fly.io auto_stop_machines）
- ✅ Preview 环境使用最小规格的资源
- ✅ 设置定时清理任务（删除超过 7 天的预览环境）
- ✅ 配置用量告警，避免意外账单
- ✅ 利用 concurrency 配置避免重复部署

**开发体验层面**：
- ✅ PR 创建时自动触发部署，不需要手动操作
- ✅ PR 更新时自动重新部署，使用 `cancel-in-progress` 避免排队
- ✅ PR 关闭时自动清理所有预览资源
- ✅ 部署失败时在 PR 中通知开发者，附带错误日志链接

### 11.3 最后的建议

Feature Branch Preview 的投入产出比非常高。即使是一个人的独立开发者，花半小时配置 Vercel Preview 也能立刻受益——每次 push 后不用手动部署就能看到最新的效果。

对于团队而言，预览环境更是提升协作效率的利器。当产品经理可以直接打开 PR 链接查看新功能，当设计师可以实时验证 UI 实现，当 QA 可以在合并前就开始编写测试用例——整个团队的协作效率会产生质的飞跃。

开始你的第一个 PR Preview 环境吧，相信你不会再想回到那个"先合并再祈祷"的时代。预览环境不仅仅是一个技术工具，它更是一种开发文化的体现——**让反馈更早、更快、更真实**。

---

*本文首发于作者技术博客，欢迎关注获取更多 CI/CD 实践内容。*
## 相关阅读

- [PR Review Checklist 自动化实战：Danger.js/lint-staged/Husky 的组合拳——CI 门禁](/categories/07_CICD/PR-Review-Checklist-自动化实战-Danger-js-lint-staged-Husky组合拳-CI门禁/) — 将代码规范检查集成到 PR 工作流，与本文的 PR 预览环境形成完整的 Code Review 闭环
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/) — 将预览环境部署逻辑封装为可复用的 Composite Action，提升工作流的可维护性
- [Conventional Commits + Semantic Release 实战：自动版本号、CHANGELOG 生成与 npm/Composer 包发布](/categories/07_CICD/Conventional-Commits-Semantic-Release-实战-自动版本号-CHANGELOG生成与npm-Composer包发布/) — 从提交规范到自动化发布的完整 CI/CD 流水线
