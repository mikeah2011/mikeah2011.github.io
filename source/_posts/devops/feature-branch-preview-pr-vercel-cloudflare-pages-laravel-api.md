---

title: Feature Branch Preview 实战：PR 级预览环境——Vercel Preview/Cloudflare Pages Preview
keywords: [Feature Branch Preview, PR, Vercel Preview, Cloudflare Pages Preview, 级预览环境]
description: Feature Branch Preview 全栈实战指南：Vercel Preview 与 Cloudflare Pages 前端自动部署、Fly.io/Railway 后端 API 预览、Neon 数据库分支隔离，结合 GitHub Actions CI/CD 自动化编排与生命周期管理，完整拆解 PR 级预览环境的架构设计、多平台选型对比与费用估算，实现每个 PR 独立可访问的全栈预览 URL，提升代码 Review 效率与团队协作体验。
date: 2026-06-07 12:00:00
tags:
- preview
- Vercel
- cloudflare-pages
- feature-branch
- CI/CD
- Laravel
- 全栈
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



## 一、开篇：为什么需要 PR 级预览环境

在传统的全栈开发流程中，一个 Pull Request 被提交后，代码审查者只能通过阅读 diff 来推断改动效果。当改动涉及 UI 调整、交互逻辑或 API 联调时，纯代码审查的效率极低。产品经理想看新功能，设计师想验证还原度，QA 想提前测试——这些需求在"一个共享 staging 环境"的模式下全部卡在了部署环节。

**PR 级预览环境**的核心理念：每个 Pull Request 自动获得一个独立的、可访问的预览 URL，涵盖前端和后端。团队成员无需任何额外操作，直接点击链接即可体验完整的功能变更。

### 核心价值

- **代码 Review 效率提升**：审查者不再是"脑补"代码效果，而是直接操作真实应用。UI 对齐、交互逻辑、API 数据流一目了然。
- **设计还原度保障**：设计师可以在 PR 阶段就验证 UI 是否符合设计稿，而无需等到合并后发现问题再返工。
- **QA 测试前置**：QA 工程师可以在 PR 合并前就开始编写和执行测试用例，缩短整体交付周期。
- **降低回滚风险**：所有验证在合并前完成，避免"先合并再祈祷"的高风险模式。

接下来，我们将从架构设计、前端方案选型、后端部署、数据库策略、自动化集成到生命周期管理，完整拆解这一全栈预览方案。

---

## 二、预览环境的架构设计

一个完整的全栈预览方案需要将前端 Preview 和后端 API Preview 解耦，各自独立部署，通过域名约定进行关联：

```
┌──────────────────────────────────────────────────┐
│                  Pull Request                     │
│                                                   │
│  ┌─────────────────┐     ┌─────────────────────┐ │
│  │  Frontend Branch │     │  Backend Branch     │ │
│  └────────┬────────┘     └─────────┬───────────┘ │
│           │                        │              │
│           ▼                        ▼              │
│  ┌─────────────────┐     ┌─────────────────────┐ │
│  │ Vercel Preview  │     │  Laravel API        │ │
│  │ or CF Pages     │     │  (Fly.io/Railway)   │ │
│  │                 │     │                     │ │
│  │ pr-N.app.dev    │     │  pr-N.api.dev       │ │
│  └─────────────────┘     └─────────────────────┘ │
│           │                        │              │
│           └───────────┬────────────┘              │
│                       ▼                           │
│              Preview Database                     │
│            (Neon Branch / Ephemeral)              │
└──────────────────────────────────────────────────┘
```

### 关键设计原则

1. **前端自动部署**：利用 Vercel 或 Cloudflare Pages 的原生 PR 集成，零配置触发预览部署。
2. **后端按需部署**：通过 GitHub Actions 在后端代码变更时触发 Laravel API 的预览部署。
3. **统一域名策略**：`pr-{N}.app.your-domain.com` 对应前端，`pr-{N}.api.your-domain.com` 对应后端，前端通过域名自动推导后端地址。
4. **数据库隔离**：每个 PR 使用独立的数据库分支或临时数据库，避免数据污染。

---

## 三、Vercel Preview Deploy 实战

Vercel 是目前前端预览部署最成熟的平台之一。将项目与 GitHub 仓库关联后，每个 PR 会自动生成一个 Preview URL。

### 3.1 基础配置

在项目根目录创建 `vercel.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}
```

Vercel 检测到 PR 事件后，会自动获取源分支代码、执行构建、部署到唯一的预览 URL（如 `my-app-abc123-team.vercel.app`），并在 PR 中添加评论。

### 3.2 环境变量注入

Vercel 为 Preview 环境提供了一系列内置变量：

```bash
# Vercel 内置 Preview 变量（构建时自动可用）
VERCEL_GIT_PULL_REQUEST_ID    # PR 编号
VERCEL_GIT_COMMIT_REF         # 分支名称
VERCEL_URL                    # 当前预览部署 URL
VERCEL_ENV                    # "preview"
VERCEL_GIT_COMMIT_SHA         # 当前 commit SHA
```

在 Vercel Dashboard 的 Settings → Environment Variables 中，为 Preview 环境配置专用变量：

```bash
# Preview 环境专用
VITE_API_URL = https://api-pr-${VERCEL_GIT_PULL_REQUEST_ID}.your-domain.com
VITE_APP_ENV = preview
```

### 3.3 通过 GitHub Actions 动态部署（推荐）

更灵活的方式是使用 Vercel CLI + GitHub Actions 在构建时注入后端 API 地址：

```yaml
# .github/workflows/vercel-preview.yml
name: Vercel Preview Deploy
on:
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      PR_NUMBER: ${{ github.event.pull_request.number }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install & Build
        run: |
          cd frontend
          npm ci
          VITE_API_URL="https://api-pr-${PR_NUMBER}.your-domain.com" npm run build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prebuilt'
          working-directory: ./frontend

      - name: Comment PR with URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `🚀 **Frontend Preview:** https://${context.issue.number}-preview.your-domain.com\n\n⚙️ **API Preview:** https://api-pr-${context.issue.number}.your-domain.com`
            })
```

### 3.4 自定义预览域名

默认的 Vercel URL 辨识度不高，可通过 alias 设置自定义域名：

```bash
vercel alias set $DEPLOY_URL "pr-${PR_NUMBER}.app.your-domain.com" --token=$VERCEL_TOKEN
```

同时在 DNS 中配置通配符 CNAME：

```dns
*.app.your-domain.com    CNAME    cname.vercel-dns.com
```

---

## 四、Cloudflare Pages Preview 实战

Cloudflare Pages 是 Vercel 的强力竞争者，尤其在亚太地区拥有更好的访问速度和更慷慨的免费额度。

### 4.1 核心特性对比

| 特性 | Vercel | Cloudflare Pages |
|------|--------|-----------------|
| 免费 Preview 部署 | 100 次/月 | 500 次/月 |
| Preview URL 格式 | `{project}-{hash}-{team}.vercel.app` | `{branch}.{project}.pages.dev` |
| Edge Functions | Vercel Edge Runtime | Cloudflare Workers |
| 带宽 | 100 GB/月 | 无限 |
| Next.js 支持 | 原生最佳 | 支持但不如 Vercel |
| DDoS 防护 | 基础防护 | Cloudflare 全家桶 |
| 亚太区速度 | 良好 | 优秀 |

### 4.2 Wrangler CLI 部署

Cloudflare 提供了 Wrangler CLI，可以在 GitHub Actions 中精确控制部署流程：

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
          cd frontend
          npm ci
          VITE_API_URL="https://api-pr-${{ github.event.pull_request.number }}.your-domain.com" \
          npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy ./dist --project-name=my-app --branch=${{ github.head_ref }}
```

### 4.3 Workers 联动

Cloudflare Pages 的一大优势是与 Workers 的深度集成。你可以在 Pages 项目中直接添加 Functions（本质是 Workers），用于处理 API 代理、身份验证中间件等：

```typescript
// frontend/functions/api-proxy.ts
export onRequest: PagesFunction = async (context) => {
  const prNumber = new URL(context.request.url).searchParams.get('pr');
  const apiUrl = prNumber
    ? `https://api-pr-${prNumber}.your-domain.com`
    : 'https://api.your-domain.com';

  const response = await fetch(apiUrl, context.request);
  return new Response(response.body, response);
};
```

这种方式特别适合需要在前端侧做请求拦截或转发的场景。

### 4.4 选型建议

- **选择 Vercel**：如果项目使用 Next.js 或 Nuxt，需要 SSR/ISR 支持，且团队已在 Vercel 生态中。
- **选择 Cloudflare Pages**：如果项目以静态站为主，追求性价比（免费额度更高），或需要 Cloudflare 全家桶（Workers、R2、KV 等）。

---

## 五、Laravel API 后端的 Preview 方案

前端 Preview 有了平台级支持，后端 API 的 Preview 则需要自建方案。核心挑战在于：后端需要一个真正运行的服务器环境、数据库连接、可能还有队列和缓存服务。

### 5.1 方案一：Fly.io（推荐）

Fly.io 支持为每个 PR 创建独立的容器应用，支持自动休眠，成本可控。

```yaml
# .github/workflows/laravel-preview.yml
name: Laravel API Preview
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    env:
      PR_NUMBER: ${{ github.event.pull_request.number }}
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, pgsql

      - name: Install Dependencies
        run: cd api && composer install --no-dev --optimize-autoloader

      - name: Create & Deploy Preview App
        run: |
          cd api
          APP_NAME="myapp-api-pr-${PR_NUMBER}"
          
          # 创建应用
          flyctl apps create "$APP_NAME" --generate-name=false || true
          
          # 设置 Secrets
          flyctl secrets set \
            APP_KEY="base64:$(openssl rand -base64 32)" \
            APP_ENV=preview \
            APP_DEBUG=true \
            APP_URL="https://${APP_NAME}.fly.dev" \
            DB_CONNECTION=pgsql \
            DB_HOST="${{ secrets.PREVIEW_DB_HOST }}" \
            DB_DATABASE="preview_pr_${PR_NUMBER}" \
            DB_USERNAME="${{ secrets.PREVIEW_DB_USER }}" \
            DB_PASSWORD="${{ secrets.PREVIEW_DB_PASSWORD }}" \
            QUEUE_CONNECTION=sync \
            CACHE_DRIVER=file \
            --app "$APP_NAME"
          
          # 使用预览专用配置部署
          cp fly.preview.toml fly.toml
          flyctl deploy --app "$APP_NAME" --remote-only
```

对应 `fly.preview.toml`：

```toml
app = "PLACEHOLDER"
primary_region = "hkg"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

### 5.2 方案二：Railway PR Environments

Railway 提供了原生的 PR Environments 功能，开箱即用程度最高：

```json
// railway.json
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

Railway 的 PR Environments 会自动 fork 数据库快照、创建独立 Environment，PR 关闭时自动销毁。

### 5.3 方案三：Docker Compose 自托管

对于有自己的服务器或 K8s 集群的团队，Docker Compose 方案提供最大的控制权：

```yaml
# docker-compose.preview.yml
version: '3.8'
services:
  app:
    build:
      context: ./api
      dockerfile: Dockerfile
    environment:
      - APP_ENV=preview
      - DB_CONNECTION=mysql
      - DB_HOST=db
      - DB_DATABASE=preview_${PR_NUMBER}
      - CACHE_DRIVER=redis
      - REDIS_HOST=redis
    depends_on:
      db:
        condition: service_healthy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api-pr-${PR_NUMBER}.rule=Host(\`api-pr-${PR_NUMBER}.your-domain.com\`)"
      - "traefik.http.routers.api-pr-${PR_NUMBER}.tls.certresolver=letsencrypt"

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: preview_${PR_NUMBER}
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine

  queue:
    build:
      context: ./api
      dockerfile: Dockerfile
    command: php artisan queue:work --sleep=3 --tries=3
    environment:
      - APP_ENV=preview
    depends_on:
      - app
```

---

## 六、数据库隔离策略

数据库是预览环境中最复杂的部分，需要在成本、速度和隔离性之间做权衡。

### 6.1 Neon Branching（PostgreSQL 推荐）

Neon 提供了独特的数据库分支功能——秒级创建、只存储差异数据、成本极低：

```yaml
# GitHub Actions 中创建 Neon 分支
- name: Create Neon Branch
  id: neon
  run: |
    RESPONSE=$(curl -s -X POST \
      "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
      -H "Authorization: Bearer ${{ secrets.NEON_API_KEY }}" \
      -H "Content-Type: application/json" \
      -d "{
        \"branch\": {
          \"parent_id\": \"${{ secrets.NEON_MAIN_BRANCH_ID }}\",
          \"name\": \"preview-pr-${PR_NUMBER}\"
        }
      }")
    
    DB_URL=$(echo $RESPONSE | jq -r '.connection_uris[0].connection_uri')
    echo "::add-mask::${DB_URL}"
    echo "db_url=${DB_URL}" >> $GITHUB_OUTPUT

# PR 合并后删除分支
- name: Delete Neon Branch
  if: github.event.pull_request.merged == true
  run: |
    curl -X DELETE \
      "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}" \
      -H "Authorization: Bearer ${{ secrets.NEON_API_KEY }}"
```

### 6.2 Schema 分支策略

对于 MySQL（如 PlanetScale），使用 deploy request 实现 Schema 变更的安全审查：

```bash
# 创建数据库分支
pscale branch create myapp feat-${PR_NUMBER} --from=main

# 运行迁移
pscale connect myapp feat-${PR_NUMBER} --port 3306 &
php artisan migrate --force

# 合并 Schema 变更
pscale deploy-request create myapp feat-${PR_NUMBER}
```

### 6.3 Seed 数据设计

预览环境不需要完整的生产数据。精心设计的 Seed 数据既能展示主要功能，又避免了隐私风险：

```php
<?php
// database/seeders/PreviewSeeder.php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\User;
use App\Models\Product;

class PreviewSeeder extends Seeder
{
    public function run(): void
    {
        // 创建预览管理员
        $admin = User::factory()->create([
            'name' => 'Preview Admin',
            'email' => 'admin@preview.test',
            'password' => bcrypt('preview123'),
        ]);

        // 创建各类测试数据
        $users = User::factory(15)->create();
        
        Product::factory(50)->create();
        
        // 创建包含边界情况的数据（超长文本、特殊字符）
        Product::factory()->create([
            'name' => str_repeat('A', 255),  // 最大长度
            'description' => '<script>alert("xss")</script>',  // XSS 测试
        ]);
    }
}
```

---

## 七、环境变量与密钥管理

### 7.1 分层配置策略

```
项目级（所有环境共享）
  ├── APP_NAME, APP_TIMEZONE, LOG_CHANNEL
  
环境级（Production / Preview / Development）
  ├── APP_ENV, APP_DEBUG, CACHE_DRIVER
  
PR 级（每个 PR 独立）
  ├── DB_URL, APP_KEY, PR-specific API URLs
```

### 7.2 .env.example 与 Preview 专用配置

```bash
# .env.preview.example
APP_ENV=preview
APP_DEBUG=true
APP_URL=https://pr-${PR_NUMBER}.app.your-domain.com
DB_CONNECTION=pgsql
DB_URL=${PREVIEW_DATABASE_URL}
QUEUE_CONNECTION=sync
CACHE_DRIVER=file
SESSION_DRIVER=file
MAIL_MAILER=log          # 预览环境不发真实邮件
SANCTUM_STATEFUL_DOMAINS=pr-${PR_NUMBER}.app.your-domain.com
```

### 7.3 GitHub Secrets 管理

```bash
# Repository Settings → Secrets → Actions
FLY_API_TOKEN              # Fly.io 部署 Token
VERCEL_TOKEN               # Vercel 部署 Token
NEON_API_KEY               # Neon 数据库 API Key
CLOUDFLARE_API_TOKEN       # Cloudflare Pages Token
PREVIEW_DB_HOST            # 预览数据库主机
PREVIEW_DB_USER            # 预览数据库用户
PREVIEW_DB_PASSWORD        # 预览数据库密码（使用 Masked）
```

在 GitHub Actions 中使用 `::add-mask::` 确保敏感信息不泄露到日志：

```yaml
- name: Set masked variables
  run: |
    DB_URL="postgresql://user:pass@host/db"
    echo "::add-mask::${DB_URL}"
    echo "DATABASE_URL=${DB_URL}" >> $GITHUB_ENV
```

---

## 八、GitHub Actions 集成

### 8.1 完整的自动化工作流

以下是一个端到端的 GitHub Actions 工作流，覆盖从 PR 创建到清理的完整生命周期：

```yaml
# .github/workflows/preview-environment.yml
name: Full-Stack Preview Environment

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  PR_NUMBER: ${{ github.event.pull_request.number }}

jobs:
  # ============ 后端部署 ============
  deploy-backend:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    outputs:
      api-url: ${{ steps.deploy.outputs.api-url }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, pgsql

      - name: Install Dependencies
        run: cd api && composer install --no-dev

      - name: Run Tests
        run: cd api && php artisan test --parallel

      - name: Deploy to Fly.io
        id: deploy
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          cd api
          APP_NAME="myapp-api-pr-${PR_NUMBER}"
          flyctl apps create "$APP_NAME" || true
          flyctl secrets set \
            APP_KEY="base64:$(openssl rand -base64 32)" \
            APP_ENV=preview \
            DB_URL="${{ secrets.PREVIEW_DB_URL }}" \
            --app "$APP_NAME"
          cp fly.preview.toml fly.toml
          flyctl deploy --app "$APP_NAME" --remote-only
          echo "api-url=https://${APP_NAME}.fly.dev" >> $GITHUB_OUTPUT

  # ============ 前端部署 ============
  deploy-frontend:
    needs: deploy-backend
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build Frontend
        env:
          VITE_API_URL: ${{ needs.deploy-backend.outputs.api-url }}
        run: cd frontend && npm ci && npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy frontend/dist --project-name=my-app --branch=pr-${{ env.PR_NUMBER }}

      - name: Comment Preview URL on PR
        uses: actions/github-script@v7
        with:
          script: |
            const feUrl = `https://pr-${context.issue.number}.my-app.pages.dev`;
            const apiUrl = '${{ needs.deploy-backend.outputs.api-url }}';
            const body = [
              `## 🚀 Preview Environment Ready`,
              ``,
              `| Service | URL |`,
              `|---------|-----|`,
              `| 🌐 Frontend | [${feUrl}](${feUrl}) |`,
              `| ⚙️ Backend API | [${apiUrl}](${apiUrl}) |`,
              `| 📋 API Health | [${apiUrl}/api/health](${apiUrl}/api/health) |`,
              ``,
              `> 🧹 Preview environment will be auto-cleaned when PR is closed.`,
            ].join('\n');

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body.includes('Preview Environment Ready'));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner, repo: context.repo.repo,
                comment_id: existing.id, body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: context.issue.number, body,
              });
            }

  # ============ 清理 ============
  cleanup:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Destroy Fly.io App
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          flyctl apps destroy "myapp-api-pr-${PR_NUMBER}" --yes || echo "App not found"

      - name: Delete Neon Branch
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        run: |
          # 获取并删除预览数据库分支
          BRANCH_ID=$(curl -s "https://console.neon.tech/api/v2/projects/${{ secrets.NEON_PROJECT_ID }}/branches" \
            -H "Authorization: Bearer $NEON_API_KEY" | \
            jq -r ".branches[] | select(.name==\"preview-pr-${PR_NUMBER}\") | .id")
          if [ -n "$BRANCH_ID" ]; then
            curl -X DELETE "https://console.neon.tech/api/v2/projects/${{ secrets.NEON_PROJECT_ID }}/branches/$BRANCH_ID" \
              -H "Authorization: Bearer $NEON_API_KEY"
          fi

      - name: Update PR Comment
        uses: actions/github-script@v7
        with:
          script: |
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const preview = comments.find(c => c.body.includes('Preview Environment Ready'));
            if (preview) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner, repo: context.repo.repo,
                comment_id: preview.id,
                body: `## 🧹 Preview Environment Cleaned Up\n\n> All preview resources have been automatically removed.`,
              });
            }
```

### 8.2 并发控制

`concurrency` 配置确保同一 PR 的多次 push 只保留最新的部署任务，避免资源浪费：

```yaml
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true  # 新 push 到来时取消正在运行的部署
```

### 8.3 Fork PR 安全限制

来自 fork 仓库的 PR 无法访问 Secrets，需要限制部署范围：

```yaml
deploy-backend:
  if: >
    github.event.action != 'closed' &&
    github.event.pull_request.head.repo.full_name == github.repository
```

---

## 九、多服务预览环境

真实的全栈应用不止前端和后端，还可能依赖 Redis、消息队列、第三方服务等。

### 9.1 Redis 缓存

```yaml
# docker-compose.preview.yml 中添加
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru
```

如果使用云 Redis（如 Upstash），可以为每个 PR 创建独立的 Key 前缀：

```php
// config/database.php
'redis' => [
    'options' => [
        'prefix' => env('REDIS_PREFIX', 'myapp:'),
    ],
],
```

```bash
# Preview 环境设置独立前缀
REDIS_PREFIX="preview-pr-${PR_NUMBER}:" php artisan cache:clear
```

### 9.2 队列 Worker

Preview 环境通常使用 `sync` 队列驱动（任务在当前请求中同步执行）。如果确实需要测试异步队列：

```yaml
queue:
  build:
    context: ./api
    dockerfile: Dockerfile
  command: php artisan queue:work --sleep=3 --tries=3 --max-jobs=100
  environment:
    - QUEUE_CONNECTION=redis
    - REDIS_HOST=redis
  depends_on:
    - redis
```

限制 `--max-jobs=100` 防止预览环境的队列任务无限积累。

### 9.3 第三方服务 Mock

预览环境不应调用真实的支付、短信、邮件等第三方服务。使用 Mock 或 Log 驱动：

```php
// .env.preview
MAIL_MAILER=log                 # 邮件只写日志
SMS_DRIVER=log                  # 短信只写日志
PAYMENT_MOCK=true               # 支付走 Mock 网关

// config/services.php
'mailgun' => [
    'domain' => env('MAIL_MAILER') === 'log' ? null : env('MAILGUN_DOMAIN'),
],
```

对于需要真实 API 但不想产生费用的场景，可以使用 Mock 服务器：

```yaml
mock-services:
  image: node:20-alpine
  working_dir: /app
  volumes:
    - ./mocks:/app
  command: node server.js
  ports:
    - "3001:3001"
```

---

## 十、预览环境的生命周期管理

### 10.1 自动销毁策略

PR 关闭时自动销毁所有预览资源（见第八节的 cleanup job）。对于因异常未被清理的"僵尸"预览环境，需要定时清理任务：

```yaml
# .github/workflows/cleanup-stale-previews.yml
name: Cleanup Stale Previews
on:
  schedule:
    - cron: '0 3 * * *'  # 每天凌晨 3 点

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Cleanup orphaned Fly.io Apps
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          APPS=$(flyctl apps list --json | jq -r '.[] | select(.Name | startswith("myapp-api-pr-")) | .Name')
          for APP in $APPS; do
            PR_NUM=$(echo $APP | grep -oP '\d+')
            PR_STATE=$(gh pr view $PR_NUM --json state -q .state 2>/dev/null || echo "MERGED")
            if [ "$PR_STATE" != "OPEN" ]; then
              echo "Destroying orphaned app: $APP (PR #$PR_NUM is $PR_STATE)"
              flyctl apps destroy "$APP" --yes || true
            fi
          done

      - name: Cleanup orphaned Neon Branches
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        run: |
          BRANCHES=$(curl -s "https://console.neon.tech/api/v2/projects/${{ secrets.NEON_PROJECT_ID }}/branches" \
            -H "Authorization: Bearer $NEON_API_KEY" | \
            jq -r '.branches[] | select(.name | startswith("preview-pr-")) | "\(.id) \(.name)"')
          
          while read -r BRANCH_ID BRANCH_NAME; do
            PR_NUM=$(echo $BRANCH_NAME | grep -oP '\d+')
            PR_STATE=$(gh pr view $PR_NUM --json state -q .state 2>/dev/null || echo "MERGED")
            if [ "$PR_STATE" != "OPEN" ]; then
              echo "Deleting orphaned branch: $BRANCH_NAME"
              curl -X DELETE "https://console.neon.tech/api/v2/projects/${{ secrets.NEON_PROJECT_ID }}/branches/$BRANCH_ID" \
                -H "Authorization: Bearer $NEON_API_KEY"
            fi
          done <<< "$BRANCHES"
```

### 10.2 成本控制

1. **最小资源规格**：Fly.io Preview App 使用 `shared-cpu-1x, 256MB RAM`。
2. **自动休眠**：`auto_stop_machines = true`，无流量时自动停止。
3. **构建优化**：使用 `paths` 过滤，只在相关文件变更时触发部署。

```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'frontend/**'
      - 'api/**'
      - '.github/workflows/preview-environment.yml'
```

4. **预算告警**：在 Vercel、Fly.io、Neon 的 Dashboard 中设置月度预算上限。
5. **定期监控**：通过清理脚本每周扫描并销毁过期资源。

### 10.3 预览环境费用估算

以下为 **5 个并行 PR** 场景下的月度费用估算（2026 年参考价格）：

| 服务 | 免费额度 | 5 PR 场景用量 | 预估月费 |
|------|---------|-------------|---------|
| **Vercel** (Hobby) | 100 次 Preview 部署/月 | ~50-80 次 | $0 |
| **Cloudflare Pages** (Free) | 500 次部署/月，无限带宽 | ~50-80 次 | $0 |
| **Fly.io** (Free) | 3 共享 CPU-1x VM，160GB 出站 | 5 个 256MB VM 按需休眠 | $0-3 |
| **Railway** (Trial → $5/月) | $5 免费额度 | 5 个轻量容器 | $0-5 |
| **Neon** (Free) | 0.5GB 存储，10 个分支 | 5 个 Copy 分支 | $0 |
| **PlanetScale** (Hobby) | 5GB 存储，1 个分支 | 需 Pro 计划 | $39 |
| **GitHub Actions** (Free) | 2,000 分钟/月 (公有仓库无限) | ~500 分钟 | $0 |

> 💡 **省钱组合推荐**：Cloudflare Pages + Fly.io + Neon = **$0-3/月**，适合中小团队日常开发。

| 场景 | 推荐组合 | 月费估算 |
|------|---------|---------|
| 个人/小团队 | Cloudflare Pages + Fly.io + Neon | $0-3 |
| 中型团队 (10 PR/天) | Vercel Pro + Railway + Neon | $20-40 |
| 企业级 (50+ PR/天) | Vercel Enterprise + K8s 自托管 + RDS | $200+ |

---

## 十一、生产案例与踩坑记录

### 11.1 CORS 跨域问题

前端 Preview URL 向后端 Preview URL 发请求时，浏览器报 CORS 错误。

**解决方案**：使用正则匹配所有预览 Origin：

```php
// config/cors.php
return [
    'paths' => ['api/*'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    'allowed_origins_patterns' => [
        '#^https://pr-\d+\.app\.your-domain\.com$#',
    ],
    'supports_credentials' => true,  // 注意：使用通配符时此选项有限制
];
```

**踩坑点**：当 `supports_credentials` 为 `true` 时，`allowed_methods` 不能使用 `['*']` 通配符，必须明确列出 HTTP 方法。

### 11.2 数据库迁移顺序冲突

多个 PR 各自添加迁移文件，Preview 环境的迁移历史与 main 分支不一致。

**解决方案**：Preview 环境始终使用 `migrate:fresh`：

```bash
php artisan migrate:fresh --seed --force
```

### 11.3 前端→后端 URL 自动推导

避免为每个 PR 手动配置前端的 API URL，通过域名规则自动推导：

```typescript
// src/config/api.ts
export function getApiUrl(): string {
  if (import.meta.env.VITE_APP_ENV === 'production') {
    return 'https://api.your-domain.com';
  }
  
  // Preview 环境：pr-123.app.your-domain.com → pr-123.api.your-domain.com
  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    const match = hostname.match(/^pr-(\d+)\.app\./);
    if (match) {
      return `https://pr-${match[1]}.api.your-domain.com`;
    }
  }
  
  return import.meta.env.VITE_API_URL || 'http://localhost:8000';
}
```

### 11.4 文件存储持久化

Preview 环境重新部署后上传的文件会丢失。使用 S3 兼容存储按 PR 隔离：

```php
// config/filesystems.php
'preview' => [
    'driver' => 's3',
    'bucket' => env('AWS_BUCKET', 'myapp-uploads'),
    'root' => 'preview-pr-' . env('PREVIEW_PR_NUMBER', 'local') . '/',
],
```

---

## 十二、总结与选型建议

### 全平台方案对比总结

#### 前端平台对比

| 维度 | Vercel Preview | Cloudflare Pages Preview | GitHub Pages* |
|------|---------------|------------------------|---------------|
| 适合框架 | Next.js、Nuxt、Vite | 静态站、Vite、Astro | 纯静态站 |
| 免费 Preview 部署 | 100 次/月 | 500 次/月 | 不支持自动 PR 预览 |
| Preview URL 格式 | `{project}-{hash}.vercel.app` | `{branch}.{project}.pages.dev` | — |
| Edge Functions | Vercel Edge Runtime | Cloudflare Workers | 不支持 |
| 带宽 | 100 GB/月 | 无限 | 100 GB/月 |
| DDoS 防护 | 基础 | Cloudflare 全家桶 | 基础 |
| 亚太区速度 | 良好 | 优秀 | 一般 |
| 自定义域名 | 支持通配符 | 支持通配符 | 不支持通配符 |

> *GitHub Pages 不支持 PR 级自动预览，仅适合纯静态文档站。

#### 后端平台对比

| 维度 | Fly.io | Railway | Docker Compose 自托管 | AWS App Runner |
|------|--------|---------|---------------------|---------------|
| PR 自动部署 | GitHub Actions 集成 | 原生 PR Environments | 需自建脚本 | 需自建脚本 |
| 自动休眠 | ✅ 支持 | ✅ 支持 | 需自行实现 | 不支持 |
| 数据库分支 | 搭配 Neon/PlanetScale | 内置 fork 快照 | 手动管理 | 搭配 RDS |
| 最小规格 | shared-cpu-1x / 256MB | 512MB / 1 vCPU | 取决于配置 | 0.25 vCPU / 0.5GB |
| 免费额度 | 3 VM (共享) | $5/月额度 | 取决于基础设施 | 无 |
| 运维复杂度 | 低 | 最低 | 高 | 中 |
| 适用场景 | 中小项目 | 快速验证 | 自建 K8s 集群 | 企业 AWS 生态 |

| 维度 | Vercel Preview | Cloudflare Pages Preview |
|------|---------------|------------------------|
| 适合框架 | Next.js、Nuxt | 静态站、Vite 项目 |
| 免费额度 | 100 次/月 | 500 次/月 |
| 亚太速度 | 良好 | 优秀 |
| 生态集成 | Vercel 生态 | Cloudflare Workers/R2/KV |

| 后端方案 | 适用场景 | 成本 | 复杂度 |
|---------|---------|------|--------|
| Fly.io | 中小项目，需要自动休眠 | 低 | 中 |
| Railway | 开箱即用，PR Environments 原生支持 | 中 | 低 |
| Docker Compose | 自建 K8s 集群，最大控制权 | 取决于基础设施 | 高 |

#### 数据库方案对比

| 数据库方案 | 适用场景 | 分支速度 | 免费额度 | 月费估算 |
|-----------|---------|---------|---------|---------|
| Neon Branching | PostgreSQL，推荐首选 | 秒级 | 0.5GB / 10 分支 | $0 |
| PlanetScale | MySQL，Schema 分支审查 | 秒级 | 5GB / 1 分支 (Hobby) | $0-39 |
| 独立临时数据库 | 需要完全隔离 | 分钟级 | 无 | $10-50 |

### 推荐方案

对于大多数全栈 Laravel + Vue/React 项目，推荐以下组合：

- **前端**：Cloudflare Pages Preview（性价比最高）或 Vercel Preview（Next.js 最佳）
- **后端**：Fly.io（自动休眠节省成本）或 Railway（最省心）
- **数据库**：Neon Branching（PostgreSQL）或 PlanetScale（MySQL）
- **自动化**：GitHub Actions（本方案的核心编排层）

### 渐进式采用路径

1. **第一步（10 分钟）**：为前端配置 Vercel/Cloudflare Preview，零代码改动。
2. **第二步（1 小时）**：添加 Laravel API 的 Fly.io/Railway 预览部署。
3. **第三步（半天）**：集成 Neon/PlanetScale 数据库分支，实现完全隔离。
4. **第四步（持续优化）**：添加定时清理、成本监控、Mock 服务等运维能力。

Feature Branch Preview 不仅仅是一个技术工具，它从根本上改变了团队的协作方式——**让反馈更早、更快、更真实**。从"读代码猜效果"到"点链接体验功能"，这就是 PR 级预览环境带来的质变。

---

*相关阅读：*

- *[GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件踩坑记录](/categories/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/) — 将 Preview 部署逻辑封装为可复用 Action*
- *[PR Review Checklist 自动化实战：Danger.js + lint-staged + Husky 组合拳 + CI 门禁](/categories/07_CICD/PR-Review-Checklist-自动化实战-Danger-js-lint-staged-Husky组合拳-CI门禁/) — PR 提交时的自动化质量门禁*
- *[Conventional Commits + Semantic Release 实战：自动版本号、CHANGELOG 生成与 npm/Composer 包发布](/categories/07_CICD/Conventional-Commits-Semantic-Release-实战-自动版本号-CHANGELOG生成与npm-Composer包发布/) — 从提交规范到自动化发布的完整 CI/CD 流水线*
- *[Progressive Delivery 实战：Feature Flag + 渐进式发布——Unleash + Argo Rollouts 完整工程化工作流](/categories/07_CICD/Progressive-Delivery-实战-Feature-Flag-渐进式发布-Unleash-Argo-Rollouts完整工程化工作流/) — PR Preview 合并后的进阶实践*
- *[Ansible 实战：Laravel 应用自动化部署与配置管理踩坑记录](/categories/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/) — 自托管 Preview 环境的配置管理工具*

---

> 💬 你的团队目前使用什么方案管理 Preview 环境？欢迎在评论区分享经验！
