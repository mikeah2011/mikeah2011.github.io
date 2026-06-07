---
title: 'Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架'
date: 2026-06-03 10:00:00
tags: [platform-engineering, backstage, golden-paths, developer-portal, laravel, microservices]
description: 本文深入探讨 Platform Engineering 核心理念与 Golden Paths 黄金路径设计哲学，以 Backstage Scaffolder 为核心，手把手搭建标准化 Laravel 微服务 Cookiecutter 模板。涵盖 Dockerfile 多阶段构建、Kubernetes Deployment 与 Kustomize 多环境部署、GitHub Actions CI/CD 全流水线、健康检查与可观测性集成、Software Catalog 自动注册、ArgoCD GitOps 联动、自定义 Backstage 插件开发（PHP 版本矩阵、Composer 安全审计），附真实迁移案例与 DORA 度量指标，将新服务上线时间从 3-5 天缩短至 15 分钟。
categories: [运维]
cover: /images/covers/platform-engineering-backstage-cover.jpg
---

# Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架

> "平台工程的本质不是建工具，而是把组织的认知负载封装成自助服务。"

## 一、为什么我们需要 Platform Engineering？

### 1.1 开发者体验的困境

在过去的五年中，微服务架构已经成为中大型企业后端开发的事实标准。以我们团队为例，一个典型的 Laravel 微服务项目从立项到首次部署，需要经历以下步骤：

1. 从 GitLab/GitHub 手动创建仓库
2. 用 `laravel new` 脚手架初始化项目
3. 配置 `.env` 文件、数据库连接、Redis、队列等
4. 编写 `Dockerfile` 和 `docker-compose.yml`
5. 配置 GitHub Actions CI/CD 流水线
6. 创建 Kubernetes Deployment、Service、Ingress YAML
7. 配置 Helm Chart 或 Kustomize
8. 注册到服务发现系统（Consul/Nacos）
9. 配置监控告警（Prometheus + Grafana）
10. 接入日志收集（ELK/Loki）
11. 编写 API 文档并注册到统一门户

整个流程通常需要 **2-3 个工作日**，而且不同开发者搭建出来的项目结构、CI/CD 配置、部署方式往往千差万别。当团队规模扩大到 50+ 开发者、100+ 微服务时，这种不一致性带来的运维成本呈指数级增长。

这就是 **Platform Engineering（平台工程）** 要解决的核心问题。

### 1.2 平台工程的核心理念

根据 Gartner 的预测，到 2026 年，80% 的软件工程组织将建立平台工程团队。平台工程的核心理念可以概括为：

```
┌─────────────────────────────────────────────────┐
│              应用开发团队 (Stream-aligned)          │
│    "我只想写业务代码，快速上线"                       │
├─────────────────────────────────────────────────┤
│         内部开发者平台 (Internal Developer Platform)  │
│  ┌──────────┬──────────┬──────────┬──────────┐  │
│  │ 服务模板  │ CI/CD    │ 可观测性  │ 安全合规  │  │
│  │ Golden   │ Pipeline │ Logging  │ Policy   │  │
│  │ Paths    │ Auto     │ Tracing  │ As Code  │  │
│  └──────────┴──────────┴──────────┴──────────┘  │
├─────────────────────────────────────────────────┤
│              基础设施层 (Cloud / K8s / IaC)         │
│    "平台团队负责，对开发团队透明"                      │
└─────────────────────────────────────────────────┘
```

**关键原则：**

- **自助服务 (Self-service)**：开发者不需要提交工单等待运维团队操作
- **黄金路径 (Golden Paths)**：提供推荐的标准化路径，但不强制
- **抽象而非限制**：降低复杂度，而不是限制灵活性
- **产品思维**：把平台当作产品来运营，开发者是你的用户

### 1.3 "你构建它，你运行它" 的进化

亚马逊的 "You build it, you run it" 理念深刻影响了现代软件工程。但这并不意味着每个开发者都应该成为 Kubernetes 专家。平台工程的定位恰恰是：

> 让开发者拥有端到端的所有权，同时降低非功能性需求的认知负载。

开发者不需要理解 Ingress Controller 的 Nginx 配置细节，但需要知道自己的服务暴露了哪些端口、如何配置健康检查。这就是 Golden Path 的精髓。

---

## 二、Golden Paths：黄金路径的哲学

### 2.1 什么是 Golden Path？

Golden Path（黄金路径）是平台团队为常见开发任务定义的 **推荐的、经过验证的、开箱即用的标准化工作流**。它具有以下特征：

| 特征 | 说明 |
|------|------|
| **有主见 (Opinionated)** | 提供默认的最佳实践选择，如 PHP 8.3 + Laravel 11 |
| **但灵活 (Flexible)** | 允许在必要时偏离默认配置 |
| **可审计 (Auditable)** | 偏离黄金路径的行为是可见的、可追踪的 |
| **渐进式 (Progressive)** | 可以逐步增强，从简单脚本到完整自助门户 |

### 2.2 Golden Path 的层次模型

一个完整的 Laravel 微服务 Golden Path 应该涵盖以下层次：

```
Layer 4: 业务逻辑层 —— 领域代码、API 端点、事件处理
Layer 3: 应用框架层 —— Laravel 配置、中间件、服务提供者
Layer 2: 工程实践层 —— 代码规范、测试策略、API 文档
Layer 1: 基础设施层 —— Dockerfile、K8s 清单、CI/CD 流水线
Layer 0: 平台服务层 —— 容器镜像仓库、日志收集、监控告警
```

Golden Path 从 Layer 0 开始构建，逐步向上覆盖。越靠近底层，标准化程度越高；越靠近业务层，灵活性越大。

### 2.3 Golden Path vs. 脚手架模板

很多人会问：Golden Path 和 `laravel new`、`create-react-app` 有什么区别？

| 维度 | 传统脚手架 | Golden Path |
|------|-----------|-------------|
| 覆盖范围 | 仅项目初始化 | 从创建到部署到退役的全生命周期 |
| 维护方式 | 一次性生成，后续手动更新 | 模板版本化，支持增量更新 |
| 配置深度 | 应用层 | 应用 + CI/CD + 部署 + 监控 |
| 治理能力 | 无 | 内建策略检查、合规扫描 |
| 服务目录 | 无 | 自动注册到统一服务目录 |

---

## 三、Backstage：开源开发者门户的基石

### 3.1 Backstage 简介

[Backstage](https://backstage.io/) 是 Spotify 于 2020 年开源的开发者门户框架，后来捐赠给 CNCF 成为孵化项目。截至目前，它已经成为构建内部开发者平台（IDP）最流行的开源方案之一。

**核心架构：**

```
┌──────────────────────────────────────────────────────┐
│                    Backstage Frontend                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Software  │ │ Scaffolder│ │  TechDocs │ │ Explore │ │
│  │ Catalog   │ │ (模板)    │ │ (文档)    │ │ (搜索)  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
├──────────────────────────────────────────────────────┤
│                    Backstage Backend                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Catalog   │ │ Scaffolder│ │ Search   │ │ Auth    │ │
│  │ Plugin    │ │ Plugin    │ │ Engine   │ │ Plugin  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
├──────────────────────────────────────────────────────┤
│              Plugin System (200+ 社区插件)              │
│  GitHub | GitLab | ArgoCD | Kubernetes | SonarQube    │
│  PagerDuty | Grafana | Jira | LDAP | Prometheus      │
└──────────────────────────────────────────────────────┘
```

### 3.2 核心概念

**Software Catalog（软件目录）：** Backstage 的核心概念。通过 `catalog-info.yaml` 文件，将组织内所有软件资产（服务、库、API、数据管道、基础设施）统一注册和管理。

**Scaffolder（脚手架器）：** 基于模板的自助服务创建引擎。开发者通过填写表单，一键完成项目创建、代码初始化、CI/CD 配置、部署注册等操作。

**TechDocs：** 内建的文档系统，支持 Markdown、MkDocs 等格式，实现文档即代码。

**Plugins：** Backstage 的扩展性核心。社区已有 200+ 插件，覆盖主流 DevOps 工具链。

### 3.3 安装 Backstage

```bash
# 创建 Backstage 应用
npx @backstage/create-app@latest
# 按提示输入应用名称，如：my-platform-portal

cd my-platform-portal

# 启动开发模式
yarn install
yarn dev
```

访问 `http://localhost:3000` 即可看到 Backstage 默认界面。

---

## 四、构建 Laravel 微服务模板：从零到一

这是本文的核心部分。我们将构建一个完整的 Laravel 微服务 Cookiecutter 模板，集成到 Backstage Scaffolder 中。

### 4.1 模板目录结构

首先，在一个 Git 仓库中创建以下目录结构：

```
laravel-microservice-template/
├── template.yaml                    # Backstage 模板定义
├── cookiecutter.json                # Cookiecutter 变量定义
├── {{cookiecutter.project_slug}}/   # 模板目录
│   ├── app/
│   │   ├── Http/
│   │   │   ├── Controllers/
│   │   │   │   └── HealthController.php
│   │   │   └── Middleware/
│   │   │       └── RequestIdMiddleware.php
│   │   ├── Providers/
│   │   │   └── AppServiceProvider.php
│   │   └── Exceptions/
│   │       └── Handler.php
│   ├── config/
│   │   ├── app.php
│   │   ├── database.php
│   │   └── observability.php
│   ├── database/
│   │   ├── migrations/
│   │   └── seeders/
│   ├── docker/
│   │   ├── Dockerfile
│   │   ├── Dockerfile.dev
│   │   └── nginx.conf
│   ├── k8s/
│   │   ├── base/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   ├── ingress.yaml
│   │   │   ├── hpa.yaml
│   │   │   └── kustomization.yaml
│   │   └── overlays/
│   │       ├── dev/
│   │       ├── staging/
│   │       └── production/
│   ├── .github/
│   │   └── workflows/
│   │       ├── ci.yml
│   │       ├── deploy.yml
│   │       └── security-scan.yml
│   ├── tests/
│   │   ├── Unit/
│   │   ├── Feature/
│   │   └── Pest.php
│   ├── composer.json
│   ├── .env.example
│   ├── .php-cs-fixer.php
│   ├── phpstan.neon
│   ├── catalog-info.yaml            # 自动注册到 Software Catalog
│   ├── README.md
│   └── docker-compose.yml
├── hooks/
│   ├── pre_gen.py                   # Cookiecutter 钩子
│   └── post_gen.py
└── README.md
```

### 4.2 Backstage 模板定义 (template.yaml)

这是连接 Backstage Scaffolder 和 Cookiecutter 模板的桥梁：

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: laravel-microservice
  title: Laravel 微服务脚手架
  description: >
    一键创建标准化的 Laravel 微服务项目，包含完整的 CI/CD 流水线、
    Docker 构建、Kubernetes 部署清单、可观测性配置和 API 文档。
  tags:
    - php
    - laravel
    - microservice
    - recommended
  annotations:
    backstage.io/techdocs-ref: dir:.
    backstage.io/source-location: url:https://github.com/your-org/laravel-microservice-template
  links:
    - title: 模板文档
      url: https://internal-docs.your-org.com/templates/laravel
    - title: Golden Path 指南
      url: https://internal-docs.your-org.com/golden-paths/php-laravel
spec:
  owner: platform-team
  type: service
  parameters:
    # ============ 第一步：基础信息 ============
    - title: 服务基本信息
      required:
        - name
        - description
        - owner
        - system
      properties:
        name:
          title: 服务名称
          type: string
          description: 服务的唯一标识，将用作仓库名和 K8s 资源名
          pattern: '^[a-z][a-z0-9-]{2,62}$'
          examples:
            - order-service
            - user-profile-api
            - payment-gateway
          ui:autofocus: true
          maxLength: 63

        description:
          title: 服务描述
          type: string
          description: 简要描述该服务的业务职责
          maxLength: 200

        owner:
          title: 所属团队
          type: string
          description: 负责该服务的团队
          ui:field: OwnerPicker
          ui:options:
            catalogFilter:
              - kind: Group

        system:
          title: 所属系统
          type: string
          description: 该服务所属的业务系统
          ui:field: EntityPicker
          ui:options:
            catalogFilter:
              - kind: System

        lifecycle:
          title: 生命周期阶段
          type: string
          enum:
            - experimental
            - production
            - deprecated
          default: experimental
          description: 服务当前的成熟度阶段

    # ============ 第二步：技术配置 ============
    - title: 技术配置
      required:
        - phpVersion
        - laravelVersion
        - databaseType
      properties:
        phpVersion:
          title: PHP 版本
          type: string
          enum:
            - '8.2'
            - '8.3'
            - '8.4'
          default: '8.3'
          description: 选择 PHP 版本（推荐 8.3）

        laravelVersion:
          title: Laravel 版本
          type: string
          enum:
            - '10.x'
            - '11.x'
            - '12.x'
          default: '11.x'
          description: 选择 Laravel 框架版本

        databaseType:
          title: 数据库类型
          type: string
          enum:
            - mysql
            - postgresql
            - none
          default: mysql
          description: 选择主数据库类型

        cacheDriver:
          title: 缓存驱动
          type: string
          enum:
            - redis
            - memcached
            - none
          default: redis

        queueDriver:
          title: 队列驱动
          type: string
          enum:
            - redis
            - sqs
            - database
            - none
          default: redis

        enableTelescope:
          title: 启用 Laravel Telescope（仅开发环境）
          type: boolean
          default: true

        enableHorizon:
          title: 启用 Laravel Horizon（队列监控）
          type: boolean
          default: false
          description: 如果使用 Redis 队列，建议启用

    # ============ 第三步：部署配置 ============
    - title: 部署配置
      required:
        - environment
        - cloudProvider
      properties:
        environment:
          title: 目标环境
          type: string
          enum:
            - kubernetes
            - lambda
            - ecs
          default: kubernetes

        cloudProvider:
          title: 云服务商
          type: string
          enum:
            - aws
            - aliyun
            - tencent
            - self-hosted
          default: aws

        enableAutoScaling:
          title: 启用自动伸缩
          type: boolean
          default: true

        minReplicas:
          title: 最小副本数
          type: number
          default: 2
          minimum: 1
          maximum: 50

        maxReplicas:
          title: 最大副本数
          type: number
          default: 10
          minimum: 1
          maximum: 100

        resourceTier:
          title: 资源配额等级
          type: string
          enum:
            - small (0.5 CPU / 512Mi)
            - medium (1 CPU / 1Gi)
            - large (2 CPU / 2Gi)
            - xlarge (4 CPU / 4Gi)
          default: 'medium (1 CPU / 1Gi)'

    # ============ 第四步：高级选项 ============
    - title: 高级选项
      properties:
        enableApiDocs:
          title: 启用 API 文档 (OpenAPI/Swagger)
          type: boolean
          default: true

        enableRateLimiting:
          title: 启用 API 限流
          type: boolean
          default: true

        rateLimitPerMinute:
          title: 每分钟请求限制
          type: number
          default: 600
          minimum: 10
          maximum: 10000
          dependencies:
            enableRateLimiting:
              const: true

        enableGrpc:
          title: 启用 gRPC 支持
          type: boolean
          default: false

        extraMiddleware:
          title: 额外中间件
          type: array
          items:
            type: string
            enum:
              - cors
              - throttle
              - signed-urls
              - force-https
              - request-id
              - log-context
          uniqueItems: true
          default:
            - cors
            - request-id
            - log-context

  steps:
    # 步骤 1：克隆模板仓库
    - id: fetch
      name: 从模板仓库拉取代码
      action: fetch:cookiecutter
      input:
        url: https://github.com/your-org/laravel-microservice-template
        targetPath: .
        values:
          project_name: ${{ parameters.name }}
          project_slug: ${{ parameters.name }}
          project_description: ${{ parameters.description }}
          owner: ${{ parameters.owner }}
          system: ${{ parameters.system }}
          lifecycle: ${{ parameters.lifecycle }}
          php_version: ${{ parameters.phpVersion }}
          laravel_version: ${{ parameters.laravelVersion }}
          database_type: ${{ parameters.databaseType }}
          cache_driver: ${{ parameters.cacheDriver }}
          queue_driver: ${{ parameters.queueDriver }}
          enable_telescope: ${{ parameters.enableTelescope }}
          enable_horizon: ${{ parameters.enableHorizon }}
          cloud_provider: ${{ parameters.cloudProvider }}
          enable_auto_scaling: ${{ parameters.enableAutoScaling }}
          min_replicas: ${{ parameters.minReplicas }}
          max_replicas: ${{ parameters.maxReplicas }}
          resource_tier: ${{ parameters.resourceTier }}
          enable_api_docs: ${{ parameters.enableApiDocs }}
          enable_rate_limiting: ${{ parameters.enableRateLimiting }}
          rate_limit_per_minute: ${{ parameters.rateLimitPerMinute }}
          enable_grpc: ${{ parameters.enableGrpc }}
          extra_middleware: ${{ parameters.extraMiddleware }}

    # 步骤 2：创建 GitHub 仓库
    - id: create-repo
      name: 创建 GitHub 仓库
      action: github:repo:create
      input:
        repoUrl: github.com?repo=${{ parameters.name }}&owner=your-org
        description: ${{ parameters.description }}
        repoVisibility: private
        defaultBranch: main
        deleteBranchOnMerge: true
        branchProtectionRules:
          - pattern: main
            requiredStatusCheckContexts:
              - 'lint'
              - 'test'
              - 'security-scan'
            requireCodeOwnerReviews: true
            requiredApprovingReviewCount: 1

    # 步骤 3：推送到 GitHub
    - id: push
      name: 推送代码到 GitHub
      action: github:repo:push
      input:
        repoUrl: github.com?repo=${{ parameters.name }}&owner=your-org
        branch: main

    # 步骤 4：创建 GitHub Secrets
    - id: create-secrets
      name: 配置 CI/CD 密钥
      action: github:actions:createSecrets
      input:
        repoUrl: github.com?repo=${{ parameters.name }}&owner=your-org
        secrets:
          REGISTRY_URL: ${{ secrets.REGISTRY_URL }}
          REGISTRY_USERNAME: ${{ secrets.REGISTRY_USERNAME }}
          REGISTRY_PASSWORD: ${{ secrets.REGISTRY_PASSWORD }}

    # 步骤 5：注册到 Software Catalog
    - id: register
      name: 注册到服务目录
      action: catalog:register
      input:
        repoContentsUrl: https://github.com/your-org/${{ parameters.name }}/blob/main/catalog-info.yaml
        catalogInfoPath: /catalog-info.yaml

    # 步骤 6：创建初始监控看板
    - id: create-dashboard
      name: 创建 Grafana 监控看板
      action: grafana:create-dashboard
      input:
        serviceName: ${{ parameters.name }}
        templateId: laravel-service-default

  output:
    links:
      - title: 仓库地址
        icon: github
        url: ${{ steps['create-repo'].output.remoteUrl }}
      - title: 服务目录页面
        icon: catalog
        url: ${{ steps['register'].output.entityRef }}
      - title: Grafana 看板
        icon: dashboard
        url: ${{ steps['create-dashboard'].output.dashboardUrl }}
      - title: CI/CD 流水线
        icon: pipeline
        url: https://github.com/your-org/${{ parameters.name }}/actions
```

### 4.3 Cookiecutter 模板配置

`cookiecutter.json` 文件定义了所有模板变量及其默认值：

```json
{
  "project_name": "my-service",
  "project_slug": "{{ cookiecutter.project_name | lower | replace(' ', '-') }}",
  "project_description": "A Laravel microservice",
  "owner": "platform-team",
  "system": "default-system",
  "lifecycle": "experimental",
  "php_version": "8.3",
  "laravel_version": "11.x",
  "database_type": "mysql",
  "cache_driver": "redis",
  "queue_driver": "redis",
  "enable_telescope": true,
  "enable_horizon": false,
  "cloud_provider": "aws",
  "enable_auto_scaling": true,
  "min_replicas": 2,
  "max_replicas": 10,
  "resource_tier": "medium (1 CPU / 1Gi)",
  "enable_api_docs": true,
  "enable_rate_limiting": true,
  "rate_limit_per_minute": 600,
  "enable_grpc": false,
  "extra_middleware": ["cors", "request-id", "log-context"],
  "_copy_without_render": ["*.blade.php"],
  "_template": "gh:your-org/laravel-microservice-template"
}
```

### 4.4 关键模板文件内容

#### Dockerfile

```dockerfile
# {{cookiecutter.project_slug}}/docker/Dockerfile
# ====== 构建阶段 ======
FROM composer:2.7 AS vendor

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install \
    --no-dev \
    --no-scripts \
    --no-autoloader \
    --prefer-dist \
    --ignore-platform-reqs

COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative
{% if cookiecutter.enable_telescope %}
RUN composer dump-autoload --optimize --classmap-authoritative
{% endif %}

# ====== 生产镜像 ======
FROM php:{{ cookiecutter.php_version }}-fpm-alpine AS production

# 系统依赖
RUN apk add --no-cache \
    nginx \
    supervisor \
    libzip-dev \
    oniguruma-dev \
    icu-dev \
    libxml2-dev \
    freetype-dev \
    libjpeg-turbo-dev \
    libpng-dev \
{% if cookiecutter.database_type == 'mysql' %}
    mysql-client \
{% elif cookiecutter.database_type == 'postgresql' %}
    postgresql-client \
{% endif %}
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo \
{% if cookiecutter.database_type == 'mysql' %}
        pdo_mysql \
{% elif cookiecutter.database_type == 'postgresql' %}
        pdo_pgsql \
{% endif %}
        mbstring \
        xml \
        bcmath \
        zip \
        intl \
        opcache \
        gd \
        sockets

# Redis 扩展
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del .build-deps

{% if cookiecutter.enable_grpc %}
# gRPC 扩展
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
    && pecl install grpc protobuf \
    && docker-php-ext-enable grpc protobuf \
    && apk del .build-deps
{% endif %}

# PHP 配置
COPY docker/php.ini /usr/local/etc/php/conf.d/app.ini

# 应用代码
WORKDIR /var/www/html
COPY --from=vendor /app .

# Nginx 配置
COPY docker/nginx.conf /etc/nginx/http.d/default.conf

# Supervisor 配置
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/up || exit 1

EXPOSE 80
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

#### Kubernetes Deployment

```yaml
# k8s/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ cookiecutter.project_slug }}
  labels:
    app.kubernetes.io/name: {{ cookiecutter.project_slug }}
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/managed-by: platform-team
    backstage.io/managed-by-location: url:https://github.com/your-org/{{ cookiecutter.project_slug }}
spec:
  replicas: {{ cookiecutter.min_replicas }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ cookiecutter.project_slug }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ cookiecutter.project_slug }}
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9113"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: {{ cookiecutter.project_slug }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 33
        fsGroup: 33
      containers:
        - name: app
          image: registry.your-org.com/{{ cookiecutter.project_slug }}:latest
          ports:
            - containerPort: 80
              protocol: TCP
              name: http
          envFrom:
            - configMapRef:
                name: {{ cookiecutter.project_slug }}-config
            - secretRef:
                name: {{ cookiecutter.project_slug }}-secrets
          resources:
            requests:
{% if 'small' in cookiecutter.resource_tier %}
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
{% elif 'medium' in cookiecutter.resource_tier %}
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 1000m
              memory: 1Gi
{% elif 'large' in cookiecutter.resource_tier %}
              cpu: 1000m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 2Gi
{% elif 'xlarge' in cookiecutter.resource_tier %}
              cpu: 2000m
              memory: 2Gi
            limits:
              cpu: 4000m
              memory: 4Gi
{% endif %}
          livenessProbe:
            httpGet:
              path: /up
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]

        # Sidecar: Prometheus 导出器
        - name: metrics
          image: nginx/nginx-prometheus-exporter:1.1
          args:
            - "-nginx.scrape-uri=http://localhost:80/stub_status"
          ports:
            - containerPort: 9113
              name: metrics

      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: {{ cookiecutter.project_slug }}
```

#### GitHub Actions CI 流水线

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, 'release/**']
  pull_request:
    branches: [main]

env:
  REGISTRY: registry.your-org.com
  IMAGE_NAME: {{ cookiecutter.project_slug }}
  PHP_VERSION: '{{ cookiecutter.php_version }}'

jobs:
  lint:
    name: 代码规范检查
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ env.PHP_VERSION }}
          tools: composer:v2, php-cs-fixer, phpstan

      - name: Cache Composer packages
        uses: actions/cache@v4
        with:
          path: vendor
          key: ${{ runner.os }}-php-${{ hashFiles('**/composer.lock') }}

      - name: Install dependencies
        run: composer install --prefer-dist --no-progress

      - name: PHP CS Fixer
        run: php-cs-fixer fix --dry-run --diff --format=github-action

      - name: PHPStan
        run: phpstan analyse --no-progress --error-format=github

  test:
    name: 测试套件
    runs-on: ubuntu-latest
    needs: lint
    strategy:
      matrix:
        php: ['{{ cookiecutter.php_version }}']
{% if cookiecutter.database_type == 'mysql' %}
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: secret
          MYSQL_DATABASE: testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
{% elif cookiecutter.database_type == 'postgresql' %}
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: testing
          POSTGRES_USER: testing
          POSTGRES_PASSWORD: secret
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
{% endif %}
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          coverage: xdebug

      - name: Copy .env
        run: cp .env.example .env

      - name: Install dependencies
        run: composer install --prefer-dist --no-progress

      - name: Generate app key
        run: php artisan key:generate

      - name: Run migrations
        run: php artisan migrate --force
        env:
          DB_CONNECTION: {{ 'mysql' if cookiecutter.database_type == 'mysql' else 'pgsql' }}
          DB_HOST: 127.0.0.1
          DB_DATABASE: testing
          DB_USERNAME: {{ 'root' if cookiecutter.database_type == 'mysql' else 'testing' }}
          DB_PASSWORD: secret

      - name: Run tests (Pest)
        run: php artisan test --parallel --coverage-clover=coverage.xml
        env:
          DB_CONNECTION: {{ 'mysql' if cookiecutter.database_type == 'mysql' else 'pgsql' }}
          DB_HOST: 127.0.0.1
          DB_DATABASE: testing
          DB_USERNAME: {{ 'root' if cookiecutter.database_type == 'mysql' else 'testing' }}
          DB_PASSWORD: secret
          REDIS_HOST: 127.0.0.1

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml

  build:
    name: 构建容器镜像
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push'
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  security-scan:
    name: 安全扫描
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4

      - name: Run Composer Audit
        run: composer audit --format=plain

      - name: Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

  deploy:
    name: 部署
    runs-on: ubuntu-latest
    needs: [build, security-scan]
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Setup kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBECONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/{{ cookiecutter.project_slug }} \
            app=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -n {{ cookiecutter.project_slug }}
          kubectl rollout status deployment/{{ cookiecutter.project_slug }} \
            -n {{ cookiecutter.project_slug }} --timeout=300s
```

#### Health Controller

```php
<?php
// app/Http/Controllers/HealthController.php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
{% if cookiecutter.cache_driver == 'redis' %}
use Illuminate\Support\Facades\Redis;
{% endif %}

class HealthController extends Controller
{
    /**
     * 健康检查端点 - Kubernetes liveness probe
     */
    public function up(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * 就绪检查端点 - Kubernetes readiness probe
     * 验证所有外部依赖是否可用
     */
    public function ready(): JsonResponse
    {
        $checks = [];
        $healthy = true;

{% if cookiecutter.database_type != 'none' %}
        // 数据库连接检查
        try {
            DB::connection()->getPdo();
            $checks['database'] = [
                'status' => 'ok',
                'driver' => config('database.default'),
            ];
        } catch (\Throwable $e) {
            $checks['database'] = [
                'status' => 'error',
                'message' => $e->getMessage(),
            ];
            $healthy = false;
        }
{% endif %}

{% if cookiecutter.cache_driver == 'redis' %}
        // Redis 连接检查
        try {
            Redis::ping();
            $checks['redis'] = ['status' => 'ok'];
        } catch (\Throwable $e) {
            $checks['redis'] = [
                'status' => 'error',
                'message' => $e->getMessage(),
            ];
            $healthy = false;
        }
{% endif %}

{% if cookiecutter.queue_driver == 'redis' %}
        // 队列连接检查
        try {
            $queueSize = Cache::store('redis')->get('queue:health:check', 0);
            $checks['queue'] = [
                'status' => 'ok',
                'driver' => '{{ cookiecutter.queue_driver }}',
            ];
        } catch (\Throwable $e) {
            $checks['queue'] = [
                'status' => 'error',
                'message' => $e->getMessage(),
            ];
            $healthy = false;
        }
{% endif %}

        return response()->json([
            'status' => $healthy ? 'ok' : 'error',
            'checks' => $checks,
            'timestamp' => now()->toIso8601String(),
        ], $healthy ? 200 : 503);
    }

{% if cookiecutter.enable_api_docs %}
    /**
     * OpenAPI 规范端点
     */
    public function openApiSpec(): JsonResponse
    {
        $spec = config('openapi.spec');
        return response()->json($spec);
    }
{% endif %}
}
```

---

## 五、高级模板配置：条件逻辑与参数化

### 5.1 Cookiecutter 条件渲染

模板的精髓在于条件逻辑。以下是 `composer.json` 的条件化生成：

```json
{
    "name": "your-org/{{ cookiecutter.project_slug }}",
    "type": "project",
    "description": "{{ cookiecutter.project_description }}",
    "require": {
        "php": "^{{ cookiecutter.php_version }}",
        "laravel/framework": "^{{ cookiecutter.laravel_version }}",
        "laravel/sanctum": "^4.0",
        "laravel/telescope": "^5.0",
{% if cookiecutter.enable_api_docs %}
        "vyuldashev/laravel-openapi": "^2.0",
{% endif %}
{% if cookiecutter.enable_rate_limiting %}
        "laravel/framework": "^{{ cookiecutter.laravel_version }}",
{% endif %}
{% if cookiecutter.enable_grpc %}
        "spiral/roadrunner-grpc": "^3.0",
        "google/protobuf": "^3.21",
{% endif %}
{% if cookiecutter.queue_driver == 'redis' and cookiecutter.enable_horizon %}
        "laravel/horizon": "^5.0",
{% endif %}
        "predis/predis": "^2.2"
    },
    "require-dev": {
        "pestphp/pest": "^2.0",
        "pestphp/pest-plugin-laravel": "^2.0",
        "laravel/pint": "^1.0",
        "phpstan/phpstan": "^1.10",
        "phpstan/phpstan-strict-rules": "^1.5",
        "nunomaduro/larastan": "^2.0"
{% if cookiecutter.enable_telescope %},
        "laravel/telescope": "^5.0"
{% endif %}
    },
    "autoload": {
        "psr-4": {
            "App\\": "app/",
            "Database\\Factories\\": "database/factories/",
            "Database\\Seeders\\": "database/seeders/"
        }
    },
    "scripts": {
        "post-autoload-dump": [
            "Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
            "@php artisan package:discover --ansi"
        ],
        "post-update-cmd": [
            "@php artisan vendor:publish --tag=laravel-assets --ansi --force"
        ],
        "post-root-package-install": [
            "@php -r \"file_exists('.env') || copy('.env.example', '.env');\""
        ],
        "post-create-project-cmd": [
            "@php artisan key:generate --ansi"
        ],
        "analyse": "phpstan analyse",
        "test": "pest",
        "format": "pint"
    },
    "config": {
        "optimize-autoloader": true,
        "preferred-install": "dist",
        "sort-packages": true,
        "allow-plugins": {
            "pestphp/pest-plugin": true,
            "php-http/discovery": true
        }
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}
```

### 5.2 自定义 Cookiecutter 钩子

`hooks/pre_gen.py`：在模板生成前验证输入参数。

```python
#!/usr/bin/env python3
"""pre_gen.py - 在模板生成前执行参数验证"""

import re
import sys

PROJECT_SLUG = '{{ cookiecutter.project_slug }}'

if not re.match(r'^[a-z][a-z0-9-]{2,62}$', PROJECT_SLUG):
    print(
        f'\n❌ 错误: 服务名称 "{PROJECT_SLUG}" 不符合规范！\n'
        f'   规则: 小写字母开头，仅包含小写字母、数字和连字符，长度 3-63\n'
        f'   示例: order-service, user-profile-api\n'
    )
    sys.exit(1)

# 验证资源配额等级格式
TIER = '{{ cookiecutter.resource_tier }}'
valid_tiers = ['small', 'medium', 'large', 'xlarge']
if not any(t in TIER.lower() for t in valid_tiers):
    print(f'\n❌ 错误: 无效的资源等级 "{TIER}"')
    sys.exit(1)

print('\n✅ 参数验证通过，开始生成项目...\n')
```

`hooks/post_gen.py`：模板生成后的清理和初始化操作。

```python
#!/usr/bin/env python3
"""post_gen.py - 模板生成后执行清理和初始化"""

import os
import shutil
import subprocess

def remove_file(filepath):
    """删除指定文件"""
    if os.path.exists(filepath):
        os.remove(filepath)

def remove_dir(dirpath):
    """删除指定目录"""
    if os.path.exists(dirpath):
        shutil.rmtree(dirpath)

# 根据数据库类型移除不相关的配置
db_type = '{{ cookiecutter.database_type }}'
if db_type == 'none':
    remove_file('database/migrations/.gitkeep')
    remove_file('config/database.php')
elif db_type != 'mysql':
    # 移除 MySQL 专用配置
    remove_file('docker/mysql/init.sql')
elif db_type != 'postgresql':
    # 移除 PostgreSQL 专用配置
    remove_file('docker/postgres/init.sql')

# 如果不启用 gRPC，移除相关文件
if '{{ cookiecutter.enable_grpc }}' != 'True':
    remove_dir('app/gRPC')
    remove_file('proto/service.proto')

# 如果不启用 Horizon，移除配置
if '{{ cookiecutter.enable_horizon }}' != 'True':
    remove_file('config/horizon.php')

# 如果不启用 Telescope，移除配置
if '{{ cookiecutter.enable_telescope }}' != 'True':
    remove_file('config/telescope.php')

# 移除未使用的中间件
extra_middleware = {{ cookiecutter.extra_middleware }}
middleware_dir = 'app/Http/Middleware'
all_middleware = {
    'cors': 'CorsMiddleware.php',
    'request-id': 'RequestIdMiddleware.php',
    'log-context': 'LogContextMiddleware.php',
    'force-https': 'ForceHttpsMiddleware.php',
    'signed-urls': 'SignedUrlMiddleware.php',
}

for key, filename in all_middleware.items():
    if key not in extra_middleware:
        remove_file(os.path.join(middleware_dir, filename))

print('✅ 项目生成完成！')
print('')
print('📋 后续步骤:')
print('   1. cd {{ cookiecutter.project_slug }}')
print('   2. cp .env.example .env')
print('   3. composer install')
print('   4. php artisan key:generate')
print('   5. php artisan migrate')
print('   6. php artisan test')
print('')
```

---

## 六、Software Catalog：统一服务目录

### 6.1 catalog-info.yaml

每个通过模板创建的服务都会自动注册到 Backstage Software Catalog。以下是 `catalog-info.yaml` 的内容：

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: {{ cookiecutter.project_slug }}
  description: {{ cookiecutter.project_description }}
  annotations:
    github.com/project-slug: your-org/{{ cookiecutter.project_slug }}
    backstage.io/techdocs-ref: dir:.
{% if cookiecutter.enable_api_docs %}
    backstage.io/openapi-spec-path: /api/v1/openapi.json
{% endif %}
    lighthouse.com/website-url: https://{{ cookiecutter.project_slug }}.api.your-org.com
    grafana/dashboard-url: https://grafana.your-org.com/d/{{ cookiecutter.project_slug }}
    pagerduty.com/service-id: P{{ cookiecutter.project_slug[:8] | upper }}
  tags:
    - php
    - laravel
    - microservice
    - {{ cookiecutter.cloud_provider }}
  links:
    - title: API 文档
      url: https://{{ cookiecutter.project_slug }}.api.your-org.com/docs
    - title: Grafana 监控
      url: https://grafana.your-org.com/d/{{ cookiecutter.project_slug }}
    - title: 日志 (Kibana)
      url: https://kibana.your-org.com/app/discover#/?_a=(query:(query_string:(query:'{{ cookiecutter.project_slug }}')))
    - title: 错误追踪 (Sentry)
      url: https://sentry.your-org.com/projects/{{ cookiecutter.project_slug }}/
spec:
  type: service
  lifecycle: {{ cookiecutter.lifecycle }}
  owner: {{ cookiecutter.owner }}
  system: {{ cookiecutter.system }}
  providesApis:
    - {{ cookiecutter.project_slug }}-api
  consumesApis: []
  dependsOn:
    - resource:{{ cookiecutter.project_slug }}-db
{% if cookiecutter.cache_driver == 'redis' %}
    - resource:{{ cookiecutter.project_slug }}-redis
{% endif %}
  subcomponentOf: ''
```

### 6.2 注册已有服务

对于已经存在的 Laravel 服务，可以使用 Backstage 的 `catalog-import` 插件批量导入。也可以编写一个脚本来自动化这个过程：

```bash
#!/bin/bash
# scripts/register-existing-services.sh
# 自动扫描 GitHub 组织中的 Laravel 服务并注册到 Backstage

set -euo pipefail

GITHUB_ORG="your-org"
BACKSTAGE_URL="https://backstage.your-org.com"
BACKSTAGE_TOKEN="${BACKSTAGE_API_TOKEN}"

echo "🔍 扫描 GitHub 组织: ${GITHUB_ORG}"

# 获取组织中所有仓库
REPOS=$(gh repo list "$GITHUB_ORG" --json name,description --limit 500 \
    | jq -r '.[] | .name')

REGISTERED=0
SKIPPED=0

for repo in $REPOS; do
    # 检查是否是 Laravel 项目（通过 composer.json 中的 laravel/framework 依赖）
    IS_LARAVEL=$(gh api "repos/${GITHUB_ORG}/${repo}/contents/composer.json" \
        --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | \
        jq -r '.require["laravel-framework"] // empty' 2>/dev/null || echo "")

    if [ -z "$IS_LARAVEL" ]; then
        continue
    fi

    # 检查是否已有 catalog-info.yaml
    HAS_CATALOG=$(gh api "repos/${GITHUB_ORG}/${repo}/contents/catalog-info.yaml" \
        --jq '.name' 2>/dev/null || echo "")

    if [ -n "$HAS_CATALOG" ]; then
        # 已有 catalog-info.yaml，直接注册
        echo "📦 注册已有服务: ${repo}"
        curl -s -X POST "${BACKSTAGE_URL}/api/catalog/locations" \
            -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "{
                \"type\": \"url\",
                \"target\": \"https://github.com/${GITHUB_ORG}/${repo}/blob/main/catalog-info.yaml\"
            }" > /dev/null
        REGISTERED=$((REGISTERED + 1))
    else
        echo "⏭️  跳过服务 ${repo}（缺少 catalog-info.yaml）"
        SKIPPED=$((SKIPPED + 1))
    fi
done

echo ""
echo "✅ 完成！已注册: ${REGISTERED}, 跳过: ${SKIPPED}"
```

### 6.3 依赖关系图

Backstage 内建了服务依赖关系的可视化能力。通过在 `catalog-info.yaml` 中声明 `dependsOn` 和 `providesApis`，可以自动生成依赖关系图。

在 Backstage 界面中，访问任何服务的详情页，点击 "Dependencies" 标签页，即可看到：

```
┌──────────────┐     dependsOn      ┌──────────────┐
│ order-service│ ──────────────────> │ user-service │
└──────────────┘                     └──────────────┘
       │                                    │
       │ dependsOn                          │ dependsOn
       ▼                                    ▼
┌──────────────┐                     ┌──────────────┐
│ order-db     │                     │ user-db      │
│ (MySQL)      │                     │ (PostgreSQL) │
└──────────────┘                     └──────────────┘
```

---

## 七、自定义 Backstage 插件：Laravel 专属能力

### 7.1 PHP 版本矩阵插件

为平台团队开发一个 Backstage 插件，展示所有 Laravel 服务的 PHP 版本分布，并在版本 EOL 前发出告警。

```typescript
// plugins/php-version-matrix/src/plugin.ts
import {
  createPlugin,
  createRoutableExtension,
  createComponentExtension,
} from '@backstage/core-plugin-api';
import { rootRouteRef } from './routes';

export const phpVersionMatrixPlugin = createPlugin({
  id: 'php-version-matrix',
  routes: {
    root: rootRouteRef,
  },
});

export const PhpVersionMatrixPage = phpVersionMatrixPlugin.provide(
  createRoutableExtension({
    name: 'PhpVersionMatrixPage',
    component: () =>
      import('./components/PhpVersionMatrixPage').then(m => m.default),
    mountPoint: rootRouteRef,
  }),
);

export const PhpVersionCard = phpVersionMatrixPlugin.provide(
  createComponentExtension({
    name: 'PhpVersionCard',
    component: {
      lazy: () =>
        import('./components/PhpVersionCard').then(m => m.default),
    },
  }),
);
```

核心组件实现：

```typescript
// plugins/php-version-matrix/src/components/PhpVersionMatrixPage.tsx
import React, { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Typography,
  Box,
  LinearProgress,
  Alert,
} from '@material-ui/core';
import { useApi, catalogApiRef } from '@backstage/core-plugin-api';
import { Entity } from '@backstage/catalog-model';

interface PhpVersionInfo {
  version: string;
  eolDate: string;
  services: Entity[];
  status: 'active' | 'security-only' | 'eol';
}

const PHP_EOL_DATES: Record<string, { eol: string; status: 'active' | 'security-only' | 'eol' }> = {
  '8.1': { eol: '2025-12-31', status: 'security-only' },
  '8.2': { eol: '2026-12-08', status: 'active' },
  '8.3': { eol: '2027-11-23', status: 'active' },
  '8.4': { eol: '2028-11-23', status: 'active' },
};

export const PhpVersionMatrixPage: React.FC = () => {
  const catalogApi = useApi(catalogApiRef);
  const [loading, setLoading] = useState(true);
  const [versionMatrix, setVersionMatrix] = useState<PhpVersionInfo[]>([]);

  useEffect(() => {
    const fetchEntities = async () => {
      const { items } = await catalogApi.getEntities({
        filter: {
          kind: 'Component',
          'metadata.annotations.backstage.io/php-version': '',
        },
      });

      const versionMap = new Map<string, Entity[]>();

      items.forEach(entity => {
        const phpVersion =
          entity.metadata.annotations?.['backstage.io/php-version'] ||
          entity.spec?.phpVersion as string ||
          'unknown';

        if (!versionMap.has(phpVersion)) {
          versionMap.set(phpVersion, []);
        }
        versionMap.get(phpVersion)!.push(entity);
      });

      const matrix: PhpVersionInfo[] = Array.from(versionMap.entries())
        .map(([version, services]) => ({
          version,
          eolDate: PHP_EOL_DATES[version]?.eol || 'Unknown',
          services,
          status: PHP_EOL_DATES[version]?.status || 'eol',
        }))
        .sort((a, b) => a.version.localeCompare(b.version));

      setVersionMatrix(matrix);
      setLoading(false);
    };

    fetchEntities();
  }, [catalogApi]);

  if (loading) {
    return <LinearProgress />;
  }

  const eolServices = versionMatrix.filter(v => v.status === 'eol');

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        PHP 版本矩阵
      </Typography>

      {eolServices.length > 0 && (
        <Alert severity="error" style={{ marginBottom: 16 }}>
          ⚠️ 发现 {eolServices.length} 个服务运行在已停止支持的 PHP 版本上，
          请尽快升级！
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>PHP 版本</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>EOL 日期</TableCell>
              <TableCell align="right">服务数量</TableCell>
              <TableCell>占比</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versionMatrix.map(row => {
              const total = versionMatrix.reduce(
                (sum, v) => sum + v.services.length,
                0,
              );
              const percentage = ((row.services.length / total) * 100).toFixed(1);

              return (
                <TableRow key={row.version}>
                  <TableCell>
                    <Typography variant="subtitle2">PHP {row.version}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={
                        row.status === 'active'
                          ? '活跃支持'
                          : row.status === 'security-only'
                          ? '仅安全更新'
                          : '已停止支持'
                      }
                      color={
                        row.status === 'active'
                          ? 'primary'
                          : row.status === 'security-only'
                          ? 'secondary'
                          : 'default'
                      }
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{row.eolDate}</TableCell>
                  <TableCell align="right">{row.services.length}</TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center">
                      <Box width="100%" mr={1}>
                        <LinearProgress
                          variant="determinate"
                          value={parseFloat(percentage)}
                          color={row.status === 'eol' ? 'secondary' : 'primary'}
                        />
                      </Box>
                      <Typography variant="body2">{percentage}%</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    {row.status !== 'active' && (
                      <Typography
                        variant="body2"
                        color="secondary"
                        style={{ cursor: 'pointer' }}
                      >
                        查看受影响服务 →
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default PhpVersionMatrixPage;
```

### 7.2 Composer 审计插件

```typescript
// plugins/composer-audit/src/api/ComposerAuditClient.ts
import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';

export interface AuditVulnerability {
  packageName: string;
  advisory: {
    title: string;
    severity: string;
    cve: string | null;
    link: string;
  };
  affectedVersions: string;
  patchedVersions: string;
}

export interface AuditResult {
  serviceName: string;
  scannedAt: string;
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  vulnerabilities: AuditVulnerability[];
}

export interface ComposerAuditApi {
  getAuditResults(serviceName: string): Promise<AuditResult>;
  getOrganizationSummary(): Promise<{
    totalServices: number;
    vulnerableServices: number;
    totalVulnerabilities: number;
    topVulnerablePackages: Array<{ name: string; count: number }>;
  }>;
}

export class ComposerAuditClient implements ComposerAuditApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async getAuditResults(serviceName: string): Promise<AuditResult> {
    const baseUrl = await this.discoveryApi.getBaseUrl('composer-audit');
    const response = await this.fetchApi.fetch(
      `${baseUrl}/audit/${encodeURIComponent(serviceName)}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch audit results: ${response.statusText}`);
    }

    return response.json();
  }

  async getOrganizationSummary() {
    const baseUrl = await this.discoveryApi.getBaseUrl('composer-audit');
    const response = await this.fetchApi.fetch(`${baseUrl}/summary`);

    if (!response.ok) {
      throw new Error(`Failed to fetch summary: ${response.statusText}`);
    }

    return response.json();
  }
}
```

后端插件实现：

```typescript
// plugins/composer-audit-backend/src/service/router.ts
import { Logger } from 'winston';
import express from 'express';
import Router from 'express-promise-router';

export interface RouterOptions {
  logger: Logger;
  catalogClient: any;
  gitClient: any;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, catalogClient, gitClient } = options;
  const router = Router();

  // 获取单个服务的 Composer 审计结果
  router.get('/audit/:serviceName', async (req, res) => {
    const { serviceName } = req.params;

    try {
      // 从 Software Catalog 获取服务信息
      const entity = await catalogClient.getEntityByRef(
        `component:default/${serviceName}`,
      );

      if (!entity) {
        res.status(404).json({ error: `Service ${serviceName} not found` });
        return;
      }

      // 从 Git 仓库拉取 composer.lock
      const repoSlug =
        entity.metadata.annotations?.['github.com/project-slug'];
      if (!repoSlug) {
        res.status(400).json({
          error: 'Missing github.com/project-slug annotation',
        });
        return;
      }

      const composerLock = await gitClient.getFileContents(
        repoSlug,
        'composer.lock',
      );

      // 解析并执行安全审计
      const vulnerabilities = parseComposerLock(composerLock);

      res.json({
        serviceName,
        scannedAt: new Date().toISOString(),
        totalVulnerabilities: vulnerabilities.length,
        criticalCount: vulnerabilities.filter(
          v => v.advisory.severity === 'critical',
        ).length,
        highCount: vulnerabilities.filter(
          v => v.advisory.severity === 'high',
        ).length,
        mediumCount: vulnerabilities.filter(
          v => v.advisory.severity === 'medium',
        ).length,
        lowCount: vulnerabilities.filter(
          v => v.advisory.severity === 'low',
        ).length,
        vulnerabilities,
      });
    } catch (error) {
      logger.error(`Audit failed for ${serviceName}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 组织级安全概览
  router.get('/summary', async (_req, res) => {
    try {
      const entities = await catalogClient.getEntities({
        filter: {
          kind: 'Component',
          'spec.type': 'service',
          'metadata.tags': 'laravel',
        },
      });

      // 聚合所有服务的安全审计结果
      // ... 实现省略

      res.json({
        totalServices: entities.items.length,
        vulnerableServices: 0,
        totalVulnerabilities: 0,
        topVulnerablePackages: [],
      });
    } catch (error) {
      logger.error('Summary generation failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

function parseComposerLock(lockContent: string) {
  // 解析 composer.lock 并检查已知漏洞
  // 实际实现中会调用 Packagist 安全数据库或 Symfony 安全检查器
  return [];
}
```

---

## 八、CI/CD 深度集成

### 8.1 与 ArgoCD 集成

Backstage 可以通过 `@backstage/plugin-argocd` 插件直接展示 ArgoCD 部署状态：

```yaml
# app-config.yaml 中添加 ArgoCD 配置
argocd:
  appLocatorMethods:
    - type: 'config',
      instances:
        - name: argocd-production
          url: https://argocd.your-org.com
          token: ${ARGOCD_AUTH_TOKEN}
        - name: argocd-staging
          url: https://argocd-staging.your-org.com
          token: ${ARGOCD_STAGING_AUTH_TOKEN}
```

在 `catalog-info.yaml` 中添加 ArgoCD 注解：

```yaml
metadata:
  annotations:
    argocd/app-name: {{ cookiecutter.project_slug }}
    argocd/instance-name: argocd-production
```

### 8.2 部署状态自动同步

```yaml
# k8s/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

metadata:
  name: {{ cookiecutter.project_slug }}

resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
  - configmap.yaml
  - secret.yaml
{% if cookiecutter.enable_auto_scaling %}
  - hpa.yaml
{% endif %}
  - serviceaccount.yaml
  - pdb.yaml

commonLabels:
  app.kubernetes.io/name: {{ cookiecutter.project_slug }}
  app.kubernetes.io/managed-by: argocd

images:
  - name: app
    newName: registry.your-org.com/{{ cookiecutter.project_slug }}
    newTag: latest
```

### 8.3 多环境部署配置

```yaml
# k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: {{ cookiecutter.project_slug }}-production

resources:
  - ../../base

patchesStrategicMerge:
  - deployment-patch.yaml

patches:
  # 生产环境 HPA 配置
  - target:
      group: autoscaling
      version: v2
      kind: HorizontalPodAutoscaler
      name: {{ cookiecutter.project_slug }}
    patch: |-
      - op: replace
        path: /spec/minReplicas
        value: {{ cookiecutter.min_replicas }}
      - op: replace
        path: /spec/maxReplicas
        value: {{ cookiecutter.max_replicas }}

configMapGenerator:
  - name: {{ cookiecutter.project_slug }}-config
    behavior: merge
    literals:
      - APP_ENV=production
      - APP_DEBUG=false
      - LOG_LEVEL=warning
      - CACHE_TTL=3600
```

---

## 九、平台团队运营模式

### 9.1 团队组成

一个成熟的平台工程团队通常包含以下角色：

| 角色 | 职责 | 技能要求 |
|------|------|---------|
| 平台架构师 | 整体技术方向、架构决策 | 深度 DevOps 经验、系统设计 |
| 平台工程师 | 模板开发、插件维护、基础设施 | TypeScript、Kubernetes、Go |
| DevRel / 开发者布道师 | 文档、培训、社区建设 | 沟通能力、技术写作 |
| 产品经理 | 需求收集、优先级排序、路线图 | 用户研究、数据分析 |

### 9.2 平台即产品（Platform as a Product）

```
┌─────────────────────────────────────────────────────┐
│                  平台产品生命周期                       │
├────────────┬────────────┬────────────┬──────────────┤
│  发现阶段   │  采用阶段   │  深化阶段   │  优化阶段     │
├────────────┼────────────┼────────────┼──────────────┤
│• 用户调研   │• Golden    │• 高级模板   │• 自动化运营   │
│• 痛点收集   │  Path MVP  │• 自定义插件 │• 智能推荐     │
│• 竞品分析   │• 早期采用者 │• 全组织推广 │• 持续改进     │
│• 路线图规划 │  反馈循环   │• 培训计划   │• 成本优化     │
└────────────┴────────────┴────────────┴──────────────┘
```

### 9.3 Golden Path 的演进策略

```yaml
# golden-path-roadmap.yaml
golden_paths:
  php_laravel:
    v1.0:  # 2024-Q1: 基础版
      - 基础项目脚手架
      - Dockerfile
      - GitHub Actions CI
    v1.1:  # 2024-Q2: 增强版
      - Kubernetes 部署清单
      - 多环境支持
      - 健康检查端点
    v2.0:  # 2024-Q3: 完整版
      - ArgoCD 集成
      - 可观测性全套（Metrics + Logs + Traces）
      - 安全扫描流水线
    v2.1:  # 2024-Q4: 智能版
      - 成本预估
      - 性能基线
      - 自动依赖更新
      - 合规检查
```

---

## 十、平台采纳度量指标

### 10.1 DORA 指标 + 平台指标

| 指标类别 | 具体指标 | 目标值 | 数据来源 |
|---------|---------|-------|---------|
| **采纳率** | Golden Path 采用率 | > 80% 新项目 | GitHub API + Catalog |
| **效率** | 新服务上线时间 | < 30 分钟 | Scaffolder 日志 |
| **DORA** | 部署频率 | 每服务每周 > 2 次 | ArgoCD / GitHub Actions |
| **DORA** | 变更前置时间 | < 4 小时 | Git 提交到部署时间 |
| **质量** | 服务标准化合规率 | > 95% | 自定义插件扫描 |
| **满意度** | 开发者 NPS | > 40 | 季度调研 |
| **稳定性** | 平台可用性 | > 99.9% | Uptime 监控 |
| **成本** | 平台人均成本 | 持续下降 | 云账单分析 |

### 10.2 自动化度量采集

```typescript
// plugins/platform-metrics/src/backend/collectors.ts
import { CatalogClient } from '@backstage/catalog-client';
import { Octokit } from '@octokit/rest';

export class PlatformMetricsCollector {
  private catalogClient: CatalogClient;
  private octokit: Octokit;

  constructor(catalogClient: CatalogClient, octokit: Octokit) {
    this.catalogClient = catalogClient;
    this.octokit = octokit;
  }

  /**
   * 计算 Golden Path 采用率
   * 定义：包含标准 catalog-info.yaml 且有 Scaffolder 标记的服务占比
   */
  async calculateGoldenPathAdoption(): Promise<{
    totalServices: number;
    goldenPathServices: number;
    adoptionRate: number;
  }> {
    const { items: allServices } = await this.catalogClient.getEntities({
      filter: {
        kind: 'Component',
        'spec.type': 'service',
      },
    });

    const goldenPathServices = allServices.filter(entity => {
      // 检查是否有平台团队的 Scaffolder 标记
      const hasScaffolderTag =
        entity.metadata.annotations?.['backstage.io/scaffolder-template'] !==
        undefined;

      // 检查是否有标准目录结构标记
      const hasStandardStructure =
        entity.metadata.annotations?.[
          'backstage.io/standard-structure-version'
        ] !== undefined;

      return hasScaffolderTag || hasStandardStructure;
    });

    return {
      totalServices: allServices.length,
      goldenPathServices: goldenPathServices.length,
      adoptionRate:
        allServices.length > 0
          ? (goldenPathServices.length / allServices.length) * 100
          : 0,
    };
  }

  /**
   * 计算新服务上线时间
   * 从模板创建到首次生产部署的时间
   */
  async calculateTimeToProduction(): Promise<{
    averageDays: number;
    medianDays: number;
    p90Days: number;
  }> {
    // 通过 GitHub API 获取仓库创建时间和首次部署 tag 的时间
    // 计算时间差
    // 这里简化实现，实际需要查询多个数据源
    return {
      averageDays: 0.5, // 目标：半天内
      medianDays: 0.3,
      p90Days: 1,
    };
  }
}
```

### 10.3 定期度量报告生成

```bash
#!/bin/bash
# scripts/generate-platform-report.sh
# 每周自动生成平台运营报告

set -euo pipefail

REPORT_DATE=$(date +%Y-%m-%d)
REPORT_DIR="reports/platform/${REPORT_DATE}"
mkdir -p "$REPORT_DIR"

echo "📊 生成平台运营报告 - ${REPORT_DATE}"

# 1. Golden Path 采纳率
echo "--- Golden Path 采纳率 ---"
curl -s "${BACKSTAGE_URL}/api/platform-metrics/adoption" \
  -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" | \
  jq '.' > "${REPORT_DIR}/adoption.json"

# 2. Scaffolder 使用统计
echo "--- Scaffolder 使用统计 ---"
curl -s "${BACKSTAGE_URL}/api/scaffolder/v2/tasks?limit=1000" \
  -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" | \
  jq '[.tasks[] | select(.status == "completed")] | length' \
  > "${REPORT_DIR}/scaffolder-usage.json"

# 3. Composer 安全审计汇总
echo "--- 安全审计汇总 ---"
curl -s "${BACKSTAGE_URL}/api/composer-audit/summary" \
  -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" | \
  jq '.' > "${REPORT_DIR}/security-audit.json"

# 4. 生成 Markdown 报告
cat > "${REPORT_DIR}/report.md" << EOF
# 平台运营周报 - ${REPORT_DATE}

## Golden Path 采纳情况
$(cat "${REPORT_DIR}/adoption.json" | jq -r '"- 总服务数: \(.totalServices)\n- Golden Path 服务数: \(.goldenPathServices)\n- 采纳率: \(.adoptionRate)%"')

## Scaffolder 使用情况
$(cat "${REPORT_DIR}/scaffolder-usage.json" | jq -r '"- 本周创建的项目数: \(.)"')

## 安全状况
$(cat "${REPORT_DIR}/security-audit.json" | jq -r '"- 存在漏洞的服务数: \(.vulnerableServices)\n- 总漏洞数: \(.totalVulnerabilities)"')
EOF

echo "✅ 报告已生成: ${REPORT_DIR}/report.md"
```

---

## 十一、竞品对比

### 11.1 主流平台工程工具对比

| 维度 | Backstage | Port | Cortex | Kratix | Humanitec |
|------|-----------|------|--------|--------|-----------|
| **类型** | 开发者门户框架 | 开发者门户 SaaS | 服务目录 SaaS | 平台编排框架 | 平台编排引擎 |
| **开源** | ✅ CNCF 孵化 | ❌ | ❌ | ✅ Syntasso | ❌ |
| **自托管** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **自定义能力** | 极高（插件体系） | 中等（配置驱动） | 中等 | 高（K8s 原生） | 高（API 驱动） |
| **学习曲线** | 陡峭 | 平缓 | 平缓 | 中等 | 中等 |
| **社区生态** | 最大（200+ 插件） | 较大 | 中等 | 较小 | 中等 |
| **适合团队** | 有前端开发能力 | 快速上手 | 服务目录为主 | K8s 原生团队 | 多云环境 |
| **模板系统** | Scaffolder | Self-service Actions | Actions | Promises | Score + Workload |
| **服务目录** | ✅ 核心功能 | ✅ 核心功能 | ✅ 核心功能 | 非核心 | 部分支持 |
| **价格** | 免费+自托管成本 | 按用户收费 | 按用户收费 | 免费+企业版 | 按用户收费 |

### 11.2 选择建议

**选择 Backstage 当：**
- 团队有 TypeScript/React 开发能力
- 需要高度自定义的开发者门户
- 重视开源社区和避免厂商锁定
- 已有大量工具链需要集成

**选择 Port 当：**
- 团队没有前端开发资源
- 需要快速启动（几天内）
- 预算充足，愿意为 SaaS 付费

**选择 Kratix 当：**
- 团队是 Kubernetes 原生
- 关注平台编排而非门户界面
- 需要声明式平台管理

**选择 Humanitec 当：**
- 多云/混合云环境
- 需要动态环境配置（Score 规范）
- 重视 GitOps 工作流

### 11.3 为什么不从零开始？

一些团队会考虑从零构建开发者门户。以下是从零构建 vs 使用 Backstage 的对比：

```
从零构建的成本估算（第一年）：
├── 前端开发: 2 FTE × 12 月 = 24 人月
├── 后端开发: 2 FTE × 12 月 = 24 人月
├── 设计师:   0.5 FTE × 12 月 = 6 人月
├── 运维:     1 FTE × 6 月 = 6 人月
└── 总计: 约 60 人月 ≈ 5 FTE 一年

使用 Backstage 的成本估算（第一年）：
├── 初始搭建: 1 FTE × 2 月 = 2 人月
├── 定制开发: 1 FTE × 6 月 = 6 人月
├── 持续维护: 0.5 FTE × 10 月 = 5 人月
└── 总计: 约 13 人月 ≈ 1 FTE 一年

节省: 约 78% 的开发成本
```

---

## 十二、真实迁移故事：从手工搭建到 Golden Path

### 12.1 背景

某中型互联网公司，技术团队 120 人，后端以 PHP/Laravel 为主，拥有 87 个微服务。主要痛点：

- **服务创建成本高**：新服务从立项到首次上线平均需要 **3-5 个工作日**
- **配置不一致**：87 个服务使用了 12 种不同的 Dockerfile 结构、8 种 CI/CD 配置
- **运维负担重**：平均每个服务需要 0.5 人/天的运维投入
- **知识孤岛**：服务架构信息分散在 Wiki、Confluence、飞书文档中
- **新人上手慢**：新入职开发者平均需要 2 周才能独立创建和部署一个服务

### 12.2 迁移路线图

```
Phase 1 (Month 1-2): 基础建设
├── 部署 Backstage 实例
├── 配置 Software Catalog
├── 开发第一个 Golden Path 模板 (Laravel 微服务 v1.0)
└── 内部培训和文档

Phase 2 (Month 3-4): 推广采用
├── 选择 3 个新项目作为试点
├── 收集反馈，迭代模板 (v1.1)
├── 开发 PHP 版本矩阵插件
└── 建立平台团队常规例会

Phase 3 (Month 5-6): 深化集成
├── ArgoCD 集成
├── Composer 审计插件
├── 自动化合规检查
├── 模板升级到 v2.0

Phase 4 (Month 7-8): 全面推广
├── 存量服务迁移计划
├── 编写迁移自动化脚本
├── 建立 Golden Path 合规指标
└── 全组织培训

Phase 5 (Month 9-12): 持续优化
├── 自动化度量报告
├── 成本优化建议
├── 多语言模板扩展 (Go, Node.js)
└── AI 辅助服务创建
```

### 12.3 存量服务迁移脚本

对于已有的 87 个 Laravel 服务，我们编写了自动化迁移脚本：

```bash
#!/bin/bash
# scripts/migrate-existing-services.sh
# 将存量 Laravel 服务迁移到 Golden Path 标准结构

set -euo pipefail

SERVICE_NAME="$1"
REPO_URL="https://github.com/your-org/${SERVICE_NAME}"
WORK_DIR="/tmp/migration/${SERVICE_NAME}"

echo "🔄 开始迁移服务: ${SERVICE_NAME}"
echo "   仓库: ${REPO_URL}"

# 1. 克隆仓库
git clone "$REPO_URL" "$WORK_DIR"
cd "$WORK_DIR"

# 2. 备份当前分支
ORIGINAL_BRANCH=$(git branch --show-current)
git checkout -b "migration/golden-path-v2"

# 3. 添加标准 Dockerfile（如果不存在）
if [ ! -f "docker/Dockerfile" ]; then
    echo "📦 添加标准 Dockerfile"
    mkdir -p docker
    cp /path/to/templates/Dockerfile docker/Dockerfile
fi

# 4. 添加 K8s 部署清单
if [ ! -d "k8s" ]; then
    echo "☸️  添加 Kubernetes 部署清单"
    mkdir -p k8s/base k8s/overlays/{dev,staging,production}
    cp /path/to/templates/k8s/* k8s/base/

    # 根据服务名替换模板变量
    sed -i "s/SERVICE_NAME/${SERVICE_NAME}/g" k8s/base/*.yaml
fi

# 5. 添加 catalog-info.yaml
if [ ! -f "catalog-info.yaml" ]; then
    echo "📋 添加 Software Catalog 配置"
    cat > catalog-info.yaml << EOF
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${SERVICE_NAME}
  description: $(jq -r '.description // "Laravel service"' composer.json)
  annotations:
    github.com/project-slug: your-org/${SERVICE_NAME}
    backstage.io/migrated-from: manual-setup
    backstage.io/migration-date: $(date +%Y-%m-%d)
  tags:
    - php
    - laravel
    - microservice
    - migrated
spec:
  type: service
  lifecycle: production
  owner: $(jq -r '.authors[0].name // "unknown"' composer.json 2>/dev/null || echo "unknown")
  system: default
EOF
fi

# 6. 添加健康检查端点（如果不存在）
CONTROLLER_FILE="app/Http/Controllers/HealthController.php"
if [ ! -f "$CONTROLLER_FILE" ]; then
    echo "❤️  添加健康检查端点"
    cp /path/to/templates/HealthController.php "$CONTROLLER_FILE"

    # 添加路由
    if ! grep -q "health" routes/api.php 2>/dev/null; then
        cat >> routes/api.php << 'EOF'

// Health check endpoints (added by platform migration)
Route::get('/up', [App\Http\Controllers\HealthController::class, 'up']);
Route::get('/ready', [App\Http\Controllers\HealthController::class, 'ready']);
EOF
    fi
fi

# 7. 添加标准 CI/CD 流水线
if [ ! -f ".github/workflows/ci.yml" ]; then
    echo "🔧 添加 CI/CD 流水线"
    mkdir -p .github/workflows
    cp /path/to/templates/.github/workflows/ci.yml .github/workflows/ci.yml
    sed -i "s/SERVICE_NAME/${SERVICE_NAME}/g" .github/workflows/ci.yml
fi

# 8. 添加标准 .php-cs-fixer.php
if [ ! -f ".php-cs-fixer.php" ]; then
    echo "📐 添加代码规范配置"
    cp /path/to/templates/.php-cs-fixer.php .php-cs-fixer.php
fi

# 9. 添加 phpstan.neon
if [ ! -f "phpstan.neon" ]; then
    echo "🔍 添加静态分析配置"
    cp /path/to/templates/phpstan.neon phpstan.neon
fi

# 10. 提交并推送
echo "📝 提交迁移更改"
git add -A
git commit -m "chore: migrate to Golden Path v2 structure

Migrated by platform team automated migration script.
Changes:
- Added standard Dockerfile
- Added Kubernetes deployment manifests
- Added catalog-info.yaml
- Added health check endpoints
- Added CI/CD pipeline
- Added code quality configs (PHP CS Fixer, PHPStan)

This service is now registered in Backstage Software Catalog."

echo "⬆️  推送迁移分支"
git push origin "migration/golden-path-v2"

echo ""
echo "✅ 迁移完成！"
echo "   分支: migration/golden-path-v2"
echo "   下一步: 创建 PR 并请求平台团队 Review"
echo "   仓库: ${REPO_URL}/compare/migration/golden-path-v2"
```

### 12.4 迁移成果

经过 8 个月的持续努力，迁移取得了显著成效：

| 指标 | 迁移前 | 迁移后 | 改善幅度 |
|------|-------|-------|---------|
| 新服务上线时间 | 3-5 天 | 15 分钟 | **-99%** |
| 配置标准化率 | 23% | 94% | **+309%** |
| Dockerfile 规范率 | 31% | 98% | **+216%** |
| CI/CD 覆盖率 | 67% | 100% | **+49%** |
| 安全扫描覆盖 | 12% | 95% | **+692%** |
| 新人上手时间 | 2 周 | 1 天 | **-93%** |
| 平均部署频率 | 每服务 1.2 次/周 | 每服务 4.8 次/周 | **+300%** |
| 变更失败率 | 18% | 5% | **-72%** |
| 开发者 NPS | 22 | 51 | **+132%** |

### 12.5 关键经验教训

**1. 不要试图一次迁移所有服务**
先从新项目开始采用 Golden Path，积累经验后再迁移存量服务。

**2. 平台团队需要"吃自己的狗粮"**
平台团队自己创建服务时也要使用 Golden Path 模板。

**3. 允许偏离，但要可见**
不要强制所有服务都使用 Golden Path，但要确保偏离是可追踪的。

**4. 持续收集反馈**
每月进行开发者满意度调研，把反馈转化为产品迭代。

**5. 投资文档和培训**
再好的工具，如果开发者不知道怎么用，也是白搭。

**6. 自动化合规检查优于人工审核**
使用 Backstage 自定义插件自动检查服务合规性，而不是依赖人工 Review。

---

## 十三、最佳实践与常见陷阱

### 13.1 最佳实践

1. **模板版本管理**：使用语义化版本管理模板，支持增量更新
2. **最小权限原则**：Scaffolder 创建的 GitHub Token 只赋予必要权限
3. **模板测试**：编写自动化测试验证模板生成结果的正确性
4. **文档即代码**：Golden Path 的文档和模板放在同一个仓库
5. **渐进式复杂度**：初版模板保持简单，根据反馈逐步增加功能
6. **开发者自助**：尽量减少需要平台团队人工介入的操作

### 13.2 常见陷阱

1. **过度标准化**：强制所有服务使用相同技术栈，限制了技术创新
2. **模板膨胀**：一个模板试图覆盖所有场景，导致模板过于复杂
3. **忽视反馈**：平台团队闭门造车，不听取开发者的真实需求
4. **文档缺失**：只建模板不写文档，开发者不知道如何使用
5. **单点依赖**：平台团队成为瓶颈，所有问题都需要人工处理
6. **忽视存量**：只关注新项目，遗留服务的标准化被忽视

---

## 十四、总结与展望

Platform Engineering 不是一个技术项目，而是一场组织文化的变革。Golden Path 和 Backstage 只是实现这一目标的工具。真正重要的是：

1. **以开发者为中心**：把开发者当作用户，平台当作产品
2. **降低认知负载**：让开发者专注于业务逻辑，而不是基础设施细节
3. **标准化但不僵化**：提供推荐路径，但允许在必要时偏离
4. **度量驱动改进**：用数据说话，持续优化平台能力

随着 AI 技术的发展，下一代平台工程将会更加智能化：

- **AI 辅助服务创建**：基于自然语言描述自动生成服务模板
- **智能配置推荐**：基于服务特征自动推荐最佳配置
- **预测性运维**：基于历史数据预测和预防服务故障
- **自动化文档生成**：从代码自动生成 API 文档和架构图

Platform Engineering 的旅程才刚刚开始。希望本文能为你提供一个实用的起点，帮助你的团队构建高效、标准化、可扩展的内部开发者平台。

---

## 相关阅读

- [Backstage 实战：开发者门户搭建——内部开发者平台（IDP）与服务目录管理](/categories/运维/2026-06-02-backstage-developer-portal-idp-service-catalog/)
- [蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚](/categories/运维/2026-06-02-蓝绿部署实战-Laravel-零停机发布-流量切换-数据库迁移与一键回滚/)
- [Developer Productivity Metrics 实战：SPACE 框架度量开发者效能——DORA 之外的代码质量、协作效率与满意度追踪](/categories/运维/2026-06-03-Developer-Productivity-Metrics-SPACE-DORA-代码质量协作效率满意度追踪/)

---

## 参考资源

- [Backstage 官方文档](https://backstage.io/docs/)
- [CNCF Platform White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [Team Topologies](https://teamtopologies.com/)
- [Spotify Backstage: The Story](https://engineering.atspotify.com/2020/03/what-the-heck-is-backstage-anyway/)
- [Gartner: Platform Engineering](https://www.gartner.com/en/articles/what-is-platform-engineering)
- [Cookiecutter 官方文档](https://cookiecutter.readthedocs.io/)
- [Humanitec: Platform Engineering Benchmark](https://humanitec.com/platform-engineering-benchmark)

---

*本文作者是平台工程实践者，如果你对文中的内容有任何疑问或建议，欢迎在评论区交流讨论。*
