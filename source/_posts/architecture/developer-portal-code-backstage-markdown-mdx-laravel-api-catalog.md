---
title: "Developer Portal as Code 实战：Backstage + Markdown/MDX——Laravel 团队的内部文档站自动化构建与 API Catalog 集成"
keywords: [Developer Portal as Code, Backstage, Markdown, MDX, Laravel, API Catalog, 团队的内部文档站自动化构建与, 架构]
date: 2026-06-09 17:01:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Backstage
  - Developer Portal
  - Markdown
  - MDX
  - Laravel
  - API Catalog
  - Internal Developer Platform
description: "用 Backstage 框架搭建 Laravel 团队内部 Developer Portal，将文档、API Catalog、组件注册表全部用 Markdown/MDX 管理，实现 as Code 的开发者门户。"
---


# Developer Portal as Code 实战：Backstage + Markdown/MDX——Laravel 团队的内部文档站自动化构建与 API Catalog 集成

## 概述

随着团队规模扩大，内部文档散落在 Confluence、Notion、飞书、Git README 各处，新人入职找不到东西，老人也不确定某个 API 由谁维护。**Developer Portal**（开发者门户）的核心目标是把所有开发者需要的信息聚合到一个地方——代码仓库、API 文档、运维 Runbook、服务所有权，一站式可发现。

但传统方案（买 SaaS 门户、手动维护页面）维护成本高。**Backstage**（Spotify 开源）提供了一个 **Developer Portal as Code** 的路径：所有内容用 Markdown/MDX 管理，版本控制在 Git 里，CI 自动构建部署。

本文实战演示：如何用 Backstage 为 Laravel 团队搭建一个轻量级内部 Developer Portal，把文档、API Catalog、组件注册表全部 as Code 化。

<!-- more -->

## 核心概念

### Backstage 是什么

Backstage 是 Spotify 开源的 **内部开发者平台（Internal Developer Platform）** 框架。它提供：

- **Software Catalog**：所有服务、库、API 的统一注册表，有明确的 Owner
- **TechDocs**：基于 MkDocs 的文档系统，文档和代码同仓库
- **Plugin 生态**：API Catalog、CI/CD 集成、成本管理等

### Why "as Code"

| 传统方式 | as Code |
|---------|---------|
| 文档在 Wiki，和代码脱节 | 文档在 Git，和代码同生命周期 |
| 手动维护页面 | CI 自动构建 |
| 权限靠平台配置 | 权限靠 Git 分支保护 |
| 搜索靠 Wiki 自带 | 搜索靠 Backstage 统一 |

### 与 Laravel 团队的契合

Laravel 项目通常有多个微服务（api、admin、worker、sdk），每个服务有 API 文档、部署流程、配置说明。Backstage 的 Software Catalog 可以把这些全部注册进来，形成统一的**服务地图**。

## 实战：搭建 Backstage + Laravel 文档站

### 1. 初始化 Backstage 项目

```bash
# 创建 Backstage 项目
npx @backstage/create-app@latest my-portal
cd my-portal

# 安装核心依赖
yarn add @backstage/plugin-techdocs
yarn add @backstage/plugin-techdocs-node
yarn add @backstage/plugin-catalog
yarn add @backstage/plugin-catalog-import

# 启动开发服务器
yarn dev
```

默认在 `http://localhost:3000` 启动，能看到 Backstage 的 Software Catalog 界面。

### 2. 配置 TechDocs（Markdown 文档站）

TechDocs 默认用 MkDocs 引擎，在 `app-config.yaml` 中配置：

```yaml
# app-config.yaml
techdocs:
  builder: 'local'  # 本地构建
  generator:
    runIn: 'docker'  # 用 Docker 运行 MkDocs
  publisher:
    type: 'local'  # 本地存储
```

在 `packages/backend/src/index.ts` 中注册 TechDocs 后端插件：

```typescript
import { createBackend } from '@backstage/backend-defaults';
import { techdocsModule } from '@backstage/plugin-techdocs-node';

const backend = createBackend();
backend.add(techdocsModule);
```

### 3. 创建 Laravel 项目的文档目录

在 Laravel 仓库根目录创建 `docs/` 目录：

```
your-laravel-api/
├── app/
├── docs/
│   ├── mkdocs.yml          # MkDocs 配置
│   ├── index.md            # 首页
│   ├── architecture.md     # 架构说明
│   ├── api.md              # API 文档
│   ├── deployment.md       # 部署流程
│   └── troubleshooting.md  # 踩坑记录
└── catalog-info.yaml       # Backstage Catalog 注册
```

`docs/mkdocs.yml` 配置：

```yaml
site_name: Laravel API 文档
site_description: KKday B2C API 内部文档

nav:
  - 首页: index.md
  - 架构: architecture.md
  - API: api.md
  - 部署: deployment.md
  - 踩坑: troubleshooting.md

theme:
  name: material
  palette:
    primary: deep purple
    accent: amber
```

`docs/index.md` 示例：

```markdown
---
title: Laravel API 文档
---

# KKday B2C API

## 服务概览

- **框架**: Laravel 8 (PHP 8.1)
- **数据库**: MySQL 8.0 + Redis
- **部署**: Docker + Kubernetes

## 快速开始

### 本地开发

git clone <repo-url>
cp .env.example .env
composer install
php artisan key:generate
php artisan migrate
php artisan serve

### API Base URL

| 环境 | 地址 |
|------|------|
| DEV | https://dev-api.kkday.com |
| STG | https://stg-api.kkday.com |
| PRD | https://api.kkday.com |
```

### 4. 注册到 Backstage Catalog

在 Laravel 仓库根目录创建 `catalog-info.yaml`：

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: kkday-b2c-api
  description: KKday B2C 核心 API 服务
  annotations:
    github.com/project-slug: kkday/kkday-b2c-api
    backstage.io/techdocs-ref: dir:.
  tags:
    - Laravel
    - PHP
    - API
  links:
    - url: https://stg-api.kkday.com
      title: STG 环境
    - url: https://grafana.internal/kkday-b2c-api
      title: Grafana 监控
spec:
  type: service
  lifecycle: production
  owner: team-b2c
  system: b2c-platform
  providesApis:
    - kkday-b2c-api
```

然后在 Backstage 中导入：

```bash
# 通过 CLI 注册
backstage-cli catalog:import --url https://github.com/kkday/kkday-b2c-api
```

或在 UI 中通过 **Catalog → Register Component** 粘贴仓库 URL。

### 5. 多服务 Catalog 编排

假设团队有 5 个 Laravel 服务，每个仓库都有 `catalog-info.yaml`：

```yaml
# api-gateway/catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: api-gateway
  description: API 网关，路由分发
  tags: [laravel, nginx, gateway]
spec:
  type: service
  lifecycle: production
  owner: team-platform
  system: b2c-platform

# order-worker/catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: order-worker
  description: 订单异步处理 Worker
  tags: [laravel, queue, redis]
spec:
  type: service
  lifecycle: production
  owner: team-order
  system: b2c-platform
```

创建一个顶层 `catalog-info.yaml` 定义 System 和 Group：

```yaml
apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: b2c-platform
  description: KKday B2C 平台系统
spec:
  owner: team-b2c
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: team-b2c
  description: B2C 核心团队
spec:
  type: team
  children: []
```

### 6. GitHub Actions 自动构建 TechDocs

在 Laravel 仓库创建 `.github/workflows/techdocs.yml`：

```yaml
name: Build TechDocs
on:
  push:
    branches: [main]
    paths:
      - 'docs/**'

jobs:
  build-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install MkDocs
        run: |
          pip install mkdocs-material
          pip install mkdocs-awesome-nav
      
      - name: Build TechDocs
        run: |
          cd docs
          mkdocs build --site-dir ../site
        
      - name: Upload to S3
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          aws s3 sync site/ s3://backstage-techdocs/kkday-b2c-api/ \
            --delete
```

### 7. API Catalog 集成

Backstage 支持注册 OpenAPI/Swagger 规范。在 Laravel 中导出 OpenAPI：

```bash
# 安装 Swagger 包
composer require darkaonline/l5-swagger

# 导出 OpenAPI spec
php artisan l5-swagger:generate
```

在 `catalog-info.yaml` 中引用：

```yaml
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: kkday-b2c-api
  description: B2C API OpenAPI 规范
  links:
    - url: https://stg-api.kkday.com/api/documentation
      title: Swagger UI
spec:
  type: openapi
  lifecycle: production
  owner: team-b2c
  definition:
    $text: https://raw.githubusercontent.com/kkday/kkday-b2c-api/main/storage/api-docs/api-docs.json
```

### 8. 自定义 Plugin：Laravel 健康检查

创建一个简单的 Backstage Plugin 显示 Laravel 服务状态：

```typescript
// plugins/laravel-health/src/plugin.ts
import { createPlugin, createApiRef } from '@backstage/core-plugin-api';

export const laravelHealthApiRef = createApiRef<LaravelHealthApi>({
  id: 'plugin.laravel-health',
});

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: string;
  php_version: string;
  laravel_version: string;
  last_deploy: string;
}

export interface LaravelHealthApi {
  getHealth(): Promise<ServiceHealth[]>;
}

// plugins/laravel-health/src/api/LaravelHealthClient.ts
export class LaravelHealthClient implements LaravelHealthApi {
  constructor(private readonly baseUrl: string) {}

  async getHealth(): Promise<ServiceHealth[]> {
    const response = await fetch(`${this.baseUrl}/api/health`);
    return response.json();
  }
}
```

在 Laravel 中添加健康检查端点：

```php
// routes/api.php
Route::get('/health', function () {
    return response()->json([
        'status' => 'healthy',
        'php_version' => PHP_VERSION,
        'laravel_version' => app()->version(),
        'uptime' => (new \DateTime())->diff(
            \Carbon\Carbon::parse(file_get_contents(storage_path('.install_time')))
        )->format('%a days'),
        'last_deploy' => env('DEPLOY_TIME', 'unknown'),
    ]);
});
```

## 踩坑记录

### MkDocs 主题配置

**问题**：MkDocs 默认主题太丑，Material 主题配置项多。

**解决**：直接用 `mkdocs-material`，配置精简版：

```yaml
theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - search.suggest
    - content.code.copy
  font:
    text: Noto Sans SC
    code: JetBrains Mono
```

### TechDocs 构建慢

**问题**：Docker 构建 MkDocs 镜像慢，CI 耗时长。

**解决**：用 GitHub Actions 缓存 Docker 层，或直接用 `pip install` 跳过 Docker：

```yaml
# 跳过 Docker，直接本地构建
techdocs:
  builder: 'local'
  generator:
    runIn: 'local'  # 不用 Docker
```

### 中文搜索

**问题**：MkDocs 默认搜索对中文分词效果差。

**解决**：安装 `mkdocs-awesome-nav` 插件并配置中文搜索：

```yaml
plugins:
  - search:
      separator: '[\s\-\.]+'
      lang:
        - zh
        - en
```

### Catalog 导入失败

**问题**：Backstage 导入仓库时找不到 `catalog-info.yaml`。

**解决**：确保文件在仓库**根目录**，且 `apiVersion` 正确：

```yaml
apiVersion: backstage.io/v1alpha1  # 不是 v1
kind: Component
```

### 权限控制

**问题**：不想让所有人都能看所有服务的文档。

**解决**：Backstage 支持基于 Group 的权限：

```yaml
spec:
  owner: team-b2c  # 只有 team-b2c 成员能编辑
  system: b2c-platform
```

在 `app-config.yaml` 中配置权限策略：

```yaml
permission:
  enabled: true
```

## 总结

Developer Portal as Code 的核心价值：

| 维度 | 效果 |
|------|------|
| **可维护性** | 文档和代码同仓库，CI 自动构建 |
| **可发现性** | 所有服务注册到 Catalog，统一搜索 |
| **可追溯性** | 文档变更有 Git 历史，谁改了什么一目了然 |
| **可扩展性** | Plugin 生态丰富，可接入监控、CI/CD、成本 |

对于 Laravel 团队，Backstage 的投入产出比很高：
- **初始化成本**：半天搭建基础框架
- **维护成本**：极低，文档跟着代码走
- **收益**：新人入职效率提升 50%+，跨团队协作成本下降

下一步可以扩展的方向：
- 集成 Grafana 监控面板
- 集成 GitHub Actions CI/CD 状态
- 接入成本分析（AWS/GCP 费用看板）
- 自定义 Plugin 对接内部 CMDB

**最终目标**：开发者只需要知道一个 URL，就能找到所有需要的信息。这就是 Developer Portal 的意义。
