---
title: Backstage 实战：开发者门户搭建——内部开发者平台（IDP）与服务目录管理
date: 2026-06-02 10:00:00
description: Backstage 实战指南，详解 Spotify 开源开发者门户平台的架构设计与落地实践。涵盖 Software Catalog 服务目录管理、TechDocs 文档即代码、Scaffolder 模板脚手架三大核心模块，以及与 Laravel CI/CD 集成、自定义 Plugin 开发、Kubernetes 部署方案。包含新人 Onboarding 从 2 周缩短至 3 天的真实效果数据，适合 30+ 仓库规模的技术团队搭建内部开发者平台参考。
tags: [Backstage, IDP, DevOps, 开发者门户, Spotify]
keywords: [Backstage, IDP, 开发者门户搭建, 内部开发者平台, 与服务目录管理, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---


# Backstage 实战：开发者门户搭建——内部开发者平台（IDP）与服务目录管理

## 前言

当团队规模从 5 人增长到 30+ 人，仓库数量从 3 个增长到 30+ 个时，一个巨大的问题浮现了：**没有人知道整个系统长什么样**。

- 新人入职，不知道该从哪个仓库开始看
- 想查某个 API 的文档，翻遍 Confluence 也找不到
- 服务之间的依赖关系全靠口口相传
- CI/CD 配置分散在各个仓库的 `.github/workflows` 里，没有统一视图
- 监控面板散落在 Grafana、Datadog、Sentry 等多个平台

我们尝试了几个方案：
1. **Confluence 文档**：很快就过时了，没人维护
2. **自建 Wiki**：功能太弱，搜索体验差
3. **Backstage**：Spotify 开源的开发者门户平台

最终我们选择了 Backstage，这篇文章记录了从零搭建、自定义开发、与 Laravel CI/CD 集成的完整踩坑过程。

---

## 一、Backstage 架构概述

### 1.1 核心概念

Backstage 的核心由三部分组成：

```
┌─────────────────────────────────────────────┐
│                 Backstage App                │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │  Software  │ │  TechDocs │ │  Scaffolder│ │
│  │  Catalog   │ │  技术文档   │ │  模板创建   │ │
│  └───────────┘ └───────────┘ └───────────┘ │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │   Search   │ │   Graph   │ │  Plugins   │ │
│  │  全局搜索   │ │  依赖关系   │ │  自定义扩展 │ │
│  └───────────┘ └───────────┘ └───────────┘ │
├─────────────────────────────────────────────┤
│              Backstage Backend               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │  Database  │ │  Auth     │ │  Proxy     │ │
│  │ PostgreSQL │ │  多种认证   │ │  API 代理   │ │
│  └───────────┘ └───────────┘ └───────────┘ │
└─────────────────────────────────────────────┘
```

**Software Catalog（软件目录）**：所有服务、API、库、基础设施的注册表
**TechDocs（技术文档）**：Docs-as-Code，Markdown/MkDocs 文档即代码
**Scaffolder（脚手架）**：一键创建新项目、新服务、新 API

### 1.2 Backstage 的技术栈

- **前端**：React + TypeScript + Material UI
- **后端**：Node.js + Express + Knex
- **数据库**：PostgreSQL（推荐）/ SQLite（开发用）
- **插件系统**：TypeScript 包，通过 npm 安装

---

## 二、从零搭建 Backstage

### 2.1 创建 Backstage 应用

```bash
# 前置要求：Node.js >= 18, yarn >= 1.22
npx @backstage/create-app@latest

# 交互式配置
? Enter a name for the app: kkday-developer-portal
? Select the database for the backend: PostgreSQL
```

```bash
cd kkday-developer-portal

# 启动开发模式
yarn dev
# 前端：http://localhost:3000
# 后端：http://localhost:7007
```

### 2.2 目录结构

```
kkday-developer-portal/
├── app-config.yaml          # 主配置文件
├── app-config.production.yaml  # 生产环境配置
├── packages/
│   ├── app/                  # 前端应用
│   │   ├── src/
│   │   │   ├── components/   # 自定义组件
│   │   │   ├── plugins/      # 前端插件
│   │   │   └── App.tsx       # 应用入口
│   │   └── package.json
│   └── backend/              # 后端应用
│       ├── src/
│       │   ├── plugins/      # 后端插件
│       │   └── index.ts      # 后端入口
│       └── package.json
├── plugins/                  # 自定义插件目录
├── catalog-info.yaml         # 本项目的 catalog 注册
└── package.json
```

### 2.3 核心配置

```yaml
# app-config.yaml
app:
  title: KKday Developer Portal
  baseUrl: http://localhost:3000

organization:
  name: KKday

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST:localhost}
      port: ${POSTGRES_PORT:5432}
      user: ${POSTGRES_USER:backstage}
      password: ${POSTGRES_PASSWORD:backstage}
      database: ${POSTGRES_DB:backstage}
  cors:
    origin: http://localhost:3000
  csp:
    default-src: ["'self'"]
    script-src: ["'self'", "'unsafe-inline'"]
    style-src: ["'self'", "'unsafe-inline'"]

# GitHub 集成（用于 catalog 发现）
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}

# 认证配置
auth:
  providers:
    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}

# Catalog 配置
catalog:
  locations:
    # 从 GitHub 仓库自动发现
    - type: github-discovery
      target: https://github.com/kkday-org/blob/main/catalog-info.yaml
      rules:
        - allow: [Component, API, Resource, System]
    # 本地 YAML 文件
    - type: file
      target: ../catalog-local.yaml
```

---

## 三、Software Catalog 实战

### 3.1 注册服务

每个服务/仓库需要一个 `catalog-info.yaml` 文件：

```yaml
# 在 kkday-b2c-api 仓库根目录的 catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: kkday-b2c-api
  description: KKday B2C 电商后端 API，基于 Laravel 12
  annotations:
    github.com/project-slug: kkday-org/kkday-b2c-api
    backstage.io/techdocs-ref: dir:.
    jira/project-key: B2C
  tags:
    - PHP
    - Laravel
    - API
    - b2c
  links:
    - url: https://api.kkday.com/docs
      title: API Documentation
      icon: dashboard
    - url: https://grafana.kkday.com/d/b2c-api
      title: Grafana Dashboard
      icon: dashboard
    - url: https://sentry.io/organizations/kkday/projects/b2c-api/
      title: Sentry Error Tracking
      icon: bug
spec:
  type: service
  lifecycle: production
  owner: team-backend
  system: kkday-ecommerce
  providesApis:
    - kkday-b2c-api
  dependsOn:
    - resource:postgres-b2c
    - resource:redis-cluster
  consumesApis:
    - kkday-payment-api
    - kkday-notification-api
```

```yaml
# API 定义
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: kkday-b2c-api
  description: KKday B2C RESTful API
spec:
  type: openapi
  lifecycle: production
  owner: team-backend
  system: kkday-ecommerce
  definition:
    $text: https://raw.githubusercontent.com/kkday-org/kkday-b2c-api/main/docs/openapi.yaml
```

```yaml
# 系统定义
apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: kkday-ecommerce
  description: KKday 电商核心系统
spec:
  owner: team-platform
  domain: kkday-main
```

```yaml
# 资源定义（数据库、Redis 等）
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: postgres-b2c
  description: B2C 业务 PostgreSQL 数据库
  annotations:
    aws-console/arn: arn:aws:rds:ap-southeast-1:xxx:db:b2c-prod
spec:
  type: database
  lifecycle: production
  owner: team-infra
  system: kkday-ecommerce
```

### 3.2 Catalog 页面功能

注册完成后，Backstage 的 Catalog 页面提供：

1. **服务列表**：按 owner、lifecycle、tag 筛选
2. **服务详情页**：
   - Overview：描述、链接、依赖关系
   - API：OpenAPI 文档（可在线调试）
   - Dependencies：依赖关系图
   - TechDocs：技术文档
   - CI/CD：GitHub Actions 构建状态
   - SRE：Grafana/Sentry 面板

3. **依赖关系图**：可视化展示服务之间的调用关系

### 3.3 自动发现（GitHub Discovery）

手动注册 30+ 个仓库太累了。Backstage 支持从 GitHub Organization 自动发现：

```yaml
# app-config.yaml
catalog:
  locations:
    - type: github-discovery
      target: https://github.com/kkday-org
      rules:
        - allow: [Component, API, Resource, System, Domain, Template]
```

只要仓库根目录有 `catalog-info.yaml`，Backstage 就会自动发现并注册。

---

## 四、TechDocs 技术文档

### 4.1 Docs-as-Code 工作流

TechDocs 允许你在代码仓库中写文档，Backstage 自动渲染：

```
kkday-b2c-api/
├── docs/
│   ├── index.md          # 文档首页
│   ├── architecture.md   # 架构设计
│   ├── api-reference.md  # API 参考
│   ├── deployment.md     # 部署指南
│   └── troubleshooting.md # 故障排查
├── mkdocs.yaml           # MkDocs 配置
└── catalog-info.yaml
```

```yaml
# mkdocs.yaml
site_name: KKday B2C API Documentation
nav:
  - Home: index.md
  - Architecture: architecture.md
  - API Reference: api-reference.md
  - Deployment: deployment.md
  - Troubleshooting: troubleshooting.md
plugins:
  - techdocs-core
```

```markdown
<!-- docs/index.md -->
# KKday B2C API

## Overview
KKday B2C 电商后端 API，提供产品管理、订单处理、支付集成等核心功能。

## Quick Start
```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

## Architecture
See [Architecture](./architecture.md) for detailed system design.
```

### 4.2 TechDocs 生成方式

Backstage 支持两种 TechDocs 生成方式：

**方式一：Build Out-of-Process（推荐）**

在 CI/CD 中构建文档，上传到 S3：

```yaml
# .github/workflows/techdocs.yaml
name: Publish TechDocs
on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'mkdocs.yaml'

jobs:
  publish-techdocs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install TechDocs CLI
        run: npm install -g @techdocs/cli

      - name: Generate TechDocs
        run: techdocs-cli generate --no-docker --output-dir ./site

      - name: Upload to S3
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1

      - run: |
          aws s3 sync ./site s3://kkday-techdocs/${{ github.event.repository.name }}/ --delete
```

**方式二：Build In-Process**

Backstage 后端直接构建文档（简单但不适合大规模）：

```yaml
# app-config.yaml
techdocs:
  builder: 'local'
  generator:
    runIn: 'docker'
  publisher:
    type: 'local'
```

---

## 五、Scaffolder 模板系统

### 5.1 创建服务模板

Scaffolder 允许你定义"一键创建"模板，新人点几下就能创建符合规范的新服务：

```yaml
# scaffolder-templates/laravel-service.yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: create-laravel-service
  title: Create Laravel Service
  description: 创建一个符合 KKday 规范的 Laravel 服务
  tags:
    - PHP
    - Laravel
    - recommended
spec:
  owner: team-platform
  type: service

  parameters:
    - title: Service Information
      required:
        - name
        - description
        - owner
      properties:
        name:
          title: Service Name
          type: string
          description: 服务名称（小写，用 - 分隔）
          pattern: '^[a-z][a-z0-9-]*[a-z0-9]$'
          examples:
            - order-service
            - payment-gateway
        description:
          title: Description
          type: string
          description: 服务简要描述
        owner:
          title: Owner Team
          type: string
          description: 拥有此服务的团队
          ui:field: OwnerPicker
          ui:options:
            catalogFilter:
              kind: Group
        database:
          title: Database
          type: string
          enum:
            - postgresql
            - mysql
            - none
          default: postgresql
        redis:
          title: Redis
          type: boolean
          default: true
        queue:
          title: Queue Driver
          type: string
          enum:
            - redis
            - sqs
            - none
          default: redis

    - title: GitHub Settings
      required:
        - repoUrl
      properties:
        repoUrl:
          title: Repository Location
          type: string
          ui:field: RepoUrlPicker
          ui:options:
            allowedHosts:
              - github.com
            allowedOrganizations:
              - kkday-org

  steps:
    - id: fetch-template
      name: Fetch Template
      action: fetch:template
      input:
        url: https://github.com/kkday-org/backstage-templates/tree/main/laravel-service
        values:
          name: ${{ parameters.name }}
          description: ${{ parameters.description }}
          owner: ${{ parameters.owner }}
          database: ${{ parameters.database }}
          redis: ${{ parameters.redis }}
          queue: ${{ parameters.queue }}

    - id: create-github-repo
      name: Create GitHub Repository
      action: github:repo:create
      input:
        repoUrl: ${{ parameters.repoUrl }}
        description: ${{ parameters.description }}
        defaultBranch: main
        deleteBranchOnMerge: true
        protectDefaultBranch: true
        repoVisibility: private

    - id: publish
      name: Publish to GitHub
      action: github:repo:push
      input:
        repoUrl: ${{ parameters.repoUrl }}
        defaultBranch: main

    - id: register-catalog
      name: Register in Catalog
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps.publish.output.repoContentsUrl }}
        catalogInfoPath: /catalog-info.yaml

    - id: create-jira
      name: Create JIRA Project
      action: jira:createProject
      input:
        name: ${{ parameters.name }}
        key: ${{ parameters.name | replace('-', '') | truncate(10, true, '') | upper }}
        owner: ${{ parameters.owner }}

  output:
    links:
      - title: Repository
        url: ${{ steps.publish.output.remoteUrl }}
      - title: Catalog
        icon: catalog
        entityRef: ${{ steps['register-catalog'].output.entityRef }}
```

### 5.2 模板变量和条件逻辑

```yaml
steps:
  # 条件步骤
  - id: setup-database
    name: Setup Database
    if: ${{ parameters.database !== 'none' }}
    action: fetch:template
    input:
      url: https://github.com/kkday-org/backstage-templates/tree/main/database/${{ parameters.database }}
      targetPath: database

  # 列表输入
  - id: add-team-members
    name: Add Team Members to Repo
    action: github:teams:create
    input:
      repoUrl: ${{ parameters.repoUrl }}
      teams:
        ${{ parameters.teams }}
```

---

## 六、自定义 Plugin 开发

### 6.1 创建 CI/CD 面板插件

```bash
# 创建新插件
yarn new --select plugin
? Enter an ID for the plugin: cicd-dashboard
? Enter the owner: team-platform
```

```typescript
// plugins/cicd-dashboard/src/components/CICDDashboard.tsx
import React from 'react'
import { useApi, githubActionsApiRef } from '@backstage/plugin-github-actions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  StatusOK,
  StatusError,
  StatusPending,
  Link,
} from '@backstage/core-components'

export const CICDDashboard = ({ entity }: { entity: Entity }) => {
  const githubActionsApi = useApi(githubActionsApiRef)
  const [runs, setRuns] = React.useState<WorkflowRun[]>([])

  const repoSlug = entity.metadata.annotations?.['github.com/project-slug']

  React.useEffect(() => {
    if (repoSlug) {
      githubActionsApi.listWorkflowRuns({ owner: 'kkday-org', repo: repoSlug })
        .then(data => setRuns(data.workflow_runs))
    }
  }, [repoSlug])

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Status</TableCell>
          <TableCell>Workflow</TableCell>
          <TableCell>Branch</TableCell>
          <TableCell>Commit</TableCell>
          <TableCell>Duration</TableCell>
          <TableCell>Time</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {runs.map(run => (
          <TableRow key={run.id}>
            <TableCell>
              {run.conclusion === 'success' && <StatusOK />}
              {run.conclusion === 'failure' && <StatusError />}
              {run.status === 'in_progress' && <StatusPending />}
            </TableCell>
            <TableCell>
              <Link to={run.html_url}>{run.name}</Link>
            </TableCell>
            <TableCell>{run.head_branch}</TableCell>
            <TableCell>{run.head_commit?.message?.slice(0, 50)}</TableCell>
            <TableCell>
              {formatDuration(run.created_at, run.updated_at)}
            </TableCell>
            <TableCell>{formatTimeAgo(run.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

### 6.2 集成 Grafana 面板

```typescript
// plugins/grafana-dashboard/src/plugin.ts
import { createPlugin, createRouteRef, createRoutableExtension } from '@backstage/core-plugin-api'

export const grafanaDashboardPlugin = createPlugin({
  id: 'grafana-dashboard',
  routes: {
    root: rootRouteRef,
  },
})

export const GrafanaDashboardPage = grafanaDashboardPlugin.provide(
  createRoutableExtension({
    name: 'GrafanaDashboardPage',
    component: () => import('./components/GrafanaDashboard').then(m => m.GrafanaDashboard),
    mountPoint: rootRouteRef,
  }),
)

// 嵌入 Grafana 面板
export const GrafanaDashboard = ({ entity }: { entity: Entity }) => {
  const grafanaUrl = entity.metadata.annotations?.['grafana/dashboard-url']

  if (!grafanaUrl) {
    return <MissingAnnotationEmptyState annotation="grafana/dashboard-url" />
  }

  return (
    <iframe
      src={`${grafanaUrl}?orgId=1&kiosk`}
      width="100%"
      height="800"
      frameBorder="0"
      title="Grafana Dashboard"
    />
  )
}
```

---

## 七、与 GitHub Actions 集成

### 7.1 构建状态展示

```yaml
# .github/workflows/ci.yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, pdo_mysql, pdo_pgsql
          coverage: xdebug

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Run Tests
        run: php artisan test --parallel --coverage

      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Production
        run: |
          # 部署逻辑
          echo "Deploying..."

      # 通知 Backstage catalog 更新
      - name: Update Backstage Catalog
        run: |
          curl -X POST "${{ secrets.BACKSTAGE_URL }}/api/catalog/refresh" \
            -H "Authorization: Bearer ${{ secrets.BACKSTAGE_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"entityRef": "component:default/kkday-b2c-api"}'
```

---

## 八、踩坑总结

### 踩坑一：Catalog 发现配置的 token 权限不足

```yaml
# ❌ 错误：token 只有 read 权限，无法读取私有仓库的 catalog-info.yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}  # 这个 token 权限不够

# ✅ 正确：使用 Fine-grained Personal Access Token
# GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
# 权限：Contents (Read), Metadata (Read)
integrations:
  github:
    - host: github.com
      token: ${GITHUB_PAT_TOKEN}
```

### 踩坑二：TechDocs Docker 构建超时

```yaml
# ❌ 错误：Docker 构建在网络不好时会超时
techdocs:
  generator:
    runIn: 'docker'

# ✅ 正确：使用本地构建（需要预装 mkdocs）
techdocs:
  generator:
    runIn: 'local'
  # 或者增加超时时间
  generator:
    runIn: 'docker'
    dockerImage: 'spotify/techdocs:v1.2.3'
    pullImage: false  # 本地已有镜像，不拉取
```

### 踩坑三：插件版本冲突

```bash
# ❌ 错误：不同插件依赖不同版本的 @backstage/core
yarn add @backstage/plugin-github-actions@0.8.0  # 需要 @backstage/core@1.20.0
yarn add @backstage/plugin-techdocs@1.10.0       # 需要 @backstage/core@1.19.0

# ✅ 正确：使用 yarn resolutions 统一版本
# package.json
{
  "resolutions": {
    "@backstage/core": "^1.20.0"
  }
}

# 或者使用 backstage-cli 自动升级
yarn backstage-cli versions:bump
```

### 踩坑四：生产环境反向代理配置

```nginx
# Nginx 反向代理配置
server {
    listen 80;
    server_name portal.kkday.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://localhost:7007;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 踩坑五：大数据量 Catalog 的性能问题

当注册的服务超过 200 个时，Catalog 页面加载变慢。解决方案：

```yaml
# app-config.yaml
catalog:
  # 启用缓存
  cache:
    ttl:
      default: 300  # 5 分钟缓存

  # 限制单页数量
  pagination:
    defaultLimit: 50

  # 使用 PostgreSQL 的全文搜索
  providers:
    postgres:
      search:
        enabled: true
```

---

## 九、效果与收获

### 落地效果

| 指标 | 搭建前 | 搭建后 |
|------|--------|--------|
| 新人 Onboarding 时间 | 2 周 | 3 天 |
| 查找 API 文档的时间 | 15 分钟 | 30 秒 |
| 服务依赖关系可见性 | 0%（靠口传） | 100%（可视化） |
| 创建新服务的时间 | 1-2 天 | 5 分钟 |
| 文档维护率 | 20% | 80%（Docs-as-Code） |

### 团队反馈

- **新人**："入职第一天就知道有哪些服务，文档在哪里，Owner 是谁"
- **后端**："不用再被问'这个 API 怎么调'，直接在 Backstage 看 OpenAPI 文档"
- **SRE**："所有 Grafana 面板集中在一个地方，不用记 URL 了"
- **Tech Lead**："服务依赖关系一目了然，重构时不再遗漏"

---

## 十、总结

Backstage 是目前最成熟的开源 IDP 方案，特别适合：
- 服务数量 > 10 个的团队
- 需要统一文档、API、监控入口的团队
- 新人 Onboarding 成本高的团队

核心建议：
1. **先注册 Catalog，再慢慢完善**：不要等所有东西都准备好了再用，先把所有服务注册进去
2. **Docs-as-Code 是关键**：文档放在代码仓库里，PR Review 时一起 Review 文档
3. **Scaffolder 模板要尽早做**：统一项目结构，减少维护成本
4. **自定义 Plugin 按需开发**：先用社区插件，不够再自己写

---

*本文基于 KKday 30+ 仓库规模下搭建 Backstage 开发者门户的真实踩坑经验整理。*

## 相关阅读

- [用 AI Agent 实现自动化 DevOps](/categories/运维/用-AI-Agent-实现自动化-DevOps/)
- [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器——自动 HTTPS、反向代理与 Laravel 部署](/categories/运维/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/)
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/categories/运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/)
