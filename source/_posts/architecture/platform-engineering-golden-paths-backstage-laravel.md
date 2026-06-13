---
title: 'Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架'
date: 2026-06-03 10:00:00
tags: [Platform Engineering, Backstage, Golden Paths, 微服务, Laravel, IDP]
keywords: [Platform Engineering, Golden Paths, Backstage, Laravel, 与服务模板, 自助创建标准化, 微服务脚手架, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "深入解析 Platform Engineering 核心理念与 Golden Paths 设计方法论，以 Backstage 开源开发者门户为平台，完整实现一套自助式 Laravel 微服务脚手架创建系统。涵盖 IDP 分层架构设计、Backstage 软件模板 YAML 编写、Spring Boot 与 Laravel 模板对比分析、CI/CD 流水线自动化、Kubernetes 部署清单生成、Prometheus 告警与 Jaeger 链路追踪集成、TechDocs 文档自动化等全流程，附可落地的模板代码与实施路线图，帮助中大型 Laravel 团队从零构建标准化微服务体系。"
---


# Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架

## 前言：为什么平台工程成为 2026 年的核心趋势？

在过去三年中，软件工程领域经历了一次深刻的范式转变。从 DevOps 的「你构建，你运行」理念到如今的 Platform Engineering（平台工程），业界逐渐认识到：**仅仅将运维责任转移给开发团队是不够的，我们还需要为开发者构建一个自助式、高度抽象的内部开发平台（Internal Developer Platform, IDP）。**

根据 Gartner 的预测，到 2026 年底，超过 80% 的大型软件工程组织将建立专门的平台工程团队。这一趋势的背后有着深刻的现实原因：随着微服务架构的普及，一个中等规模的团队可能同时维护数十甚至上百个服务，每个服务都需要独立的 CI/CD 流水线、容器化配置、Kubernetes 部署清单、监控告警规则以及完善的文档体系。如果每个团队都从零开始搭建这些基础设施，不仅效率低下，更会导致整个组织的技术栈碎片化严重，维护成本呈指数级增长。

本文将深入探讨如何利用 Backstage——由 Spotify 开源的开发者门户平台——来构建一套标准化的 Laravel 微服务脚手架系统。我们将从平台工程的理论基础出发，逐步深入到实际的模板配置、Golden Path 设计、CI/CD 流水线编排、Kubernetes 部署清单生成、可观测性集成等方方面面，最终交付一个完整的、可投入生产使用的自助式服务创建平台。

**你将从本文获得：**

- 对平台工程和 Golden Paths 概念的深入理解
- Backstage 的完整部署与配置指南
- 一套生产级别的 Laravel 微服务模板（含 CI/CD、Docker、K8s、监控）
- 可复用的 YAML 模板代码和架构设计模式
- TechDocs 集成和文档自动化实践
- 从零到一的完整实施路线图

---

## 第一章：平台工程核心概念深度解析

### 1.1 从 DevOps 到 Platform Engineering 的演进

DevOps 运动的核心理念是打破开发与运维之间的壁垒，通过自动化工具链和文化变革来加速软件交付。这一理念在过去十年中取得了巨大成功——CI/CD 流水线、基础设施即代码（IaC）、容器化等技术已成为行业标准。

然而，随着云原生技术栈的爆炸式增长，一个新的问题浮出水面：**认知过载（Cognitive Overload）**。开发人员不再仅仅编写业务逻辑，他们还需要理解 Kubernetes 的 Pod、Service、Ingress、ConfigMap、Secret 等抽象概念，配置 Helm Chart 或 Kustomize，编写 Dockerfile，设置 Prometheus 的抓取规则，管理 Terraform 模块……这些复杂性严重分散了开发者的注意力，使他们无法专注于核心业务价值的创造。

Platform Engineering 应运而生，它提出了一种新的解决思路：

```
┌─────────────────────────────────────────────────────────────┐
│                    传统 DevOps 模式                          │
│                                                             │
│   开发者 ──→ 直接操作底层基础设施 ──→ 高认知负载               │
│                                                             │
│   ├── K8s 集群管理      ├── CI/CD 配置                       │
│   ├── 容器镜像构建      ├── 监控告警设置                      │
│   ├── 网络策略配置      ├── 日志收集方案                      │
│   └── 安全合规检查      └── 数据库迁移                       │
│                                                             │
│   问题：每个团队重复造轮子，标准不一致，维护成本高              │
└─────────────────────────────────────────────────────────────┘

                          ↓ 演进 ↓

┌─────────────────────────────────────────────────────────────┐
│                  Platform Engineering 模式                    │
│                                                             │
│   平台团队 ──→ 构建内部开发平台（IDP）──→ 自助式抽象层         │
│                                                             │
│   ┌─────────────────────────────────────────────┐           │
│   │          开发者门户（Backstage）              │           │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │           │
│   │  │ 服务目录  │ │ 软件模板 │ │ TechDocs │    │           │
│   │  └──────────┘ └──────────┘ └──────────┘    │           │
│   └─────────────────────────────────────────────┘           │
│   ┌─────────────────────────────────────────────┐           │
│   │          平台服务层（API & CLI）              │           │
│   │  ├── CI/CD 抽象    ├── 部署编排             │           │
│   │  ├── 配置管理       ├── 监控集成             │           │
│   │  └── 安全策略       └── 成本管理             │           │
│   └─────────────────────────────────────────────┘           │
│   ┌─────────────────────────────────────────────┐           │
│   │          基础设施层（K8s / Cloud）            │           │
│   └─────────────────────────────────────────────┘           │
│                                                             │
│   结果：认知负载降低，标准化提升，自助服务加速交付              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 内部开发平台（IDP）的分层架构

一个成熟的内部开发平台通常包含以下层次：

**第一层：基础设施层（Infrastructure Layer）**

这是最底层，包括 Kubernetes 集群、云服务商资源（VPC、IAM、数据库服务）、网络拓扑等。这一层由基础设施团队通过 Terraform、Pulumi 等 IaC 工具管理，对上层完全抽象。

**第二层：平台服务层（Platform Services Layer）**

这一层封装了面向开发者的通用能力，包括但不限于：

- **容器编排抽象**：将复杂的 Kubernetes 对象封装为开发者友好的接口
- **CI/CD 平台**：提供标准化的流水线模板，开发者只需声明式地描述构建和部署需求
- **可观测性套件**：统一的日志（Loki/Elasticsearch）、指标（Prometheus）、追踪（Jaeger/Tempo）解决方案
- **密钥管理**：集成 Vault 或云原生密钥管理服务
- **数据库即服务**：自助式的数据库实例申请与管理

**第三层：开发者体验层（Developer Experience Layer）**

这是开发者直接交互的界面，核心是开发者门户（Developer Portal）。Backstage 正是这一层的典型实现，它提供了：

- **软件目录（Software Catalog）**：组织内所有服务、API、资源的统一视图
- **软件模板（Software Templates）**：自助式的项目脚手架生成工具
- **TechDocs**：与代码仓库集成的技术文档系统
- **插件生态**：丰富的第三方集成能力

### 1.3 Golden Paths：标准化的自助通道

**Golden Path（黄金路径）是平台工程中最核心的概念之一。** 它不是强制性的标准，而是一条经过精心设计的、推荐的、被充分文档化的最佳实践路径。

Golden Path 的设计哲学可以概括为：

> **「我们不强制你走这条路，但这是一条最平坦、最安全、最有路标的道路。如果你选择其他路径，你需要自己承担额外的复杂性。」**

对于一个 Laravel 微服务项目，一条完整的 Golden Path 应该覆盖以下方面：

```
Golden Path for Laravel Microservice
├── 项目初始化
│   ├── 标准化的目录结构
│   ├── 预配置的依赖包（Laravel Sanctum, Telescope, Horizon 等）
│   ├── 统一的代码风格配置（PHP-CS-Fixer, Pint）
│   └── 预设的测试框架（PHPUnit + Pest）
├── 开发环境
│   ├── Docker Compose 本地开发环境
│   ├── 统一的 PHP 版本和扩展要求
│   └── IDE 配置模板（PhpStorm / VS Code）
├── CI/CD 流水线
│   ├── 代码质量检查（Lint, Static Analysis with PHPStan）
│   ├── 自动化测试（Unit, Feature, Integration）
│   ├── 安全扫描（Dependency Audit, SAST）
│   ├── 容器镜像构建与推送
│   └── 自动化部署（Staging → Production）
├── 容器化
│   ├── 多阶段构建的 Dockerfile
│   ├── 优化的镜像层级
│   └── 安全基础镜像
├── Kubernetes 部署
│   ├── Deployment（含 HPA, PDB）
│   ├── Service, Ingress
│   ├── ConfigMap, Secret
│   ├── Health Check 配置
│   └── Resource Quota
├── 可观测性
│   ├── 结构化日志输出
│   ├── Prometheus 指标暴露
│   ├── OpenTelemetry 分布式追踪
│   └── Grafana Dashboard 模板
└── 文档
    ├── README 模板
    ├── API 文档（OpenAPI Spec）
    ├── 架构决策记录（ADR）
    └── 运维手册（Runbook）
```

### 1.4 为什么选择 Laravel + Backstage 的组合？

在众多技术栈中选择 Laravel 和 Backstage 并非偶然：

**Laravel 的优势：**

- PHP 生态中最具生产力的全栈框架，拥有完善的生态系统
- 原生支持队列、事件广播、任务调度等微服务常用能力
- Laravel Sanctum 提供轻量级 API 认证方案
- Laravel Octane（基于 Swoole/RoadRunner）突破传统 PHP-FPM 性能瓶颈
- 丰富的社区包和成熟的最佳实践

**Backstage 的优势：**

- 最受欢迎的开源开发者门户平台（CNCF 毕业项目）
- 强大的模板引擎，支持 Cookiecutter 和自定义 Node.js 模板
- 丰富的插件生态系统
- 活跃的社区和持续的迭代
- 可扩展的架构设计

---

## 第二章：Backstage 部署与核心配置

### 2.1 Backstage 架构概览

```
┌───────────────────────────────────────────────────────────┐
│                    Backstage 架构                          │
│                                                           │
│  ┌──────────────────────────────────────────────────┐     │
│  │                  前端（React App）                 │     │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │     │
│  │  │Catalog│ │Templates│ │TechDocs│ │Search│ │Plugins│ │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │     │
│  └──────────────────────────────────────────────────┘     │
│                         │ API 调用                        │
│  ┌──────────────────────────────────────────────────┐     │
│  │              后端（Node.js Backend）               │     │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │     │
│  │  │Catalog   │ │Scaffolder│ │TechDocs   │         │     │
│  │  │Processor │ │Engine    │ │Builder    │         │     │
│  │  └──────────┘ └──────────┘ └──────────┘         │     │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │     │
│  │  │Auth      │ │Proxy     │ │Search    │         │     │
│  │  └──────────┘ └──────────┘ └──────────┘         │     │
│  └──────────────────────────────────────────────────┘     │
│                         │                                 │
│  ┌──────────────────────────────────────────────────┐     │
│  │                  数据存储层                        │     │
│  │  ┌──────────────┐  ┌──────────────────┐          │     │
│  │  │ PostgreSQL   │  │ Git Repository   │          │     │
│  │  │ (Catalog DB) │  │ (Templates/Docs) │          │     │
│  │  └──────────────┘  └──────────────────┘          │     │
│  └──────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────┘
```

### 2.2 从零开始安装 Backstage

首先确保开发环境满足以下要求：

- Node.js 18 或 20
- Yarn 1.22+
- Docker（用于构建和运行容器）
- Git

```bash
# 创建 Backstage 项目
npx @backstage/create-app@latest backstage-platform
cd backstage-platform

# 安装依赖
yarn install

# 启动开发服务器
yarn dev
```

启动后，Backstage 默认运行在 `http://localhost:3000`。首次访问需要配置认证。

### 2.3 核心配置文件 app-config.yaml

`app-config.yaml` 是 Backstage 的核心配置文件，以下是一份针对 Laravel 微服务平台的完整配置示例：

```yaml
# app-config.yaml
app:
  title: 'Laravel Microservice Platform'
  baseUrl: https://backstage.internal.company.com

organization:
  name: 'Platform Engineering Team'
  url: https://internal.company.com

backend:
  baseUrl: https://backstage.internal.company.com
  listen:
    port: 7007
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: 5432
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
  cors:
    origin: https://backstage.internal.company.com
    methods: [GET, POST, PUT, DELETE, PATCH]
  csp:
    connect-src: ["'self'", 'http:', 'https:']
    img-src: ["'self'", 'data:']

# 软件目录配置 - 自动从 Git 仓库发现实体
catalog:
  locations:
    # 从 GitHub 组织自动发现
    - type: github-discovery
      target: https://github.com/your-org
      rules:
        - allow: [Component, API, Resource, System, Domain]

    # 软件模板仓库
    - type: url
      target: https://github.com/your-org/backstage-templates/blob/main/templates.yaml
      rules:
        - allow: [Template]

    # 自定义模板目录
    - type: file
      target: ./templates/laravel-microservice/template.yaml
      rules:
        - allow: [Template]

# 认证配置
auth:
  providers:
    github:
      development:
        clientId: ${GITHUB_CLIENT_ID}
        clientSecret: ${GITHUB_CLIENT_SECRET}
    # 也可以配置 GitLab、Okta 等
    gitlab:
      development:
        clientId: ${GITLAB_CLIENT_ID}
        clientSecret: ${GITLAB_CLIENT_SECRET}
        audience: https://gitlab.com

# Scaffolder 配置
scaffolder:
  # 默认 Git 提交者信息
  defaultAuthor:
    name: 'Platform Bot'
    email: 'platform-bot@company.com'
  # 并行任务数
  taskWorkers: 4

# Kubernetes 集成（用于查看部署状态）
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - name: staging
          url: https://k8s-staging.internal.company.com
          authProvider: 'serviceAccount'
          serviceAccountToken: ${K8S_STAGING_SA_TOKEN}
          caData: ${K8S_STAGING_CA_DATA}
        - name: production
          url: https://k8s-production.internal.company.com
          authProvider: 'serviceAccount'
          serviceAccountToken: ${K8S_PROD_SA_TOKEN}
          caData: ${K8S_PROD_CA_DATA}

# GitHub 集成（用于模板仓库访问和代码推送）
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
    # 或使用 GitHub Enterprise
    - host: github.internal.company.com
      token: ${GITHUB_ENTERPRISE_TOKEN}
      apiBaseUrl: https://github.internal.company.com/api/v3

# TechDocs 配置
techdocs:
  builder: 'local'
  generator:
    runIn: 'docker'
    dockerImage: 'spotify/techdocs:latest'
  publisher:
    type: 'awsS3'
    awsS3:
      bucketName: 'backstage-techdocs'
      region: 'ap-southeast-1'
      credentials:
        accessKeyId: ${AWS_ACCESS_KEY_ID}
        secretAccessKey: ${AWS_SECRET_ACCESS_KEY}

# 搜索配置
search:
  engine:
    type: postgres
  collators:
    catalog:
      schedule:
        frequency: { minutes: 30 }
        timeout: { minutes: 3 }
    techdocs:
      schedule:
        frequency: { minutes: 30 }
        timeout: { minutes: 3 }

# SonarQube 集成（代码质量）
sonarqube:
  baseUrl: https://sonarqube.internal.company.com
  apiKey: ${SONARQUBE_API_KEY}

# ArgoCD 集成（GitOps 部署）
argocd:
  baseUrl: https://argocd.internal.company.com
  username: ${ARGOCD_USERNAME}
  password: ${ARGOCD_PASSWORD}
  appLocatorMethods:
    - type: 'config'
      instances:
        - name: main
          url: https://argocd.internal.company.com
          username: ${ARGOCD_USERNAME}
          password: ${ARGOCD_PASSWORD}
```

### 2.4 插件安装与配置

Backstage 的强大之处在于其丰富的插件生态。以下是我们需要安装的关键插件：

```bash
# 核心增强插件
yarn --cwd packages/backend add \
  @backstage/plugin-catalog-backend-module-github \
  @backstage/plugin-scaffolder-backend-module-github \
  @backstage/plugin-kubernetes-backend \
  @backstage/plugin-search-backend-module-catalog \
  @backstage/plugin-search-backend-module-techdocs

# 可观测性集成
yarn --cwd packages/backend add \
  @backstage-community/plugin-prometheus-backend \
  @backstage-community/plugin-grafana

# SonarQube 集成
yarn --cwd packages/app add \
  @backstage-community/plugin-sonarqube

# ArgoCD 集成
yarn --cwd packages/app add \
  @backstage-community/plugin-argocd

# GitHub Actions 集成（查看 CI/CD 状态）
yarn --cwd packages/app add \
  @backstage-community/plugin-github-actions
```

在后端注册插件：

```typescript
// packages/backend/src/index.ts
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// 核心功能
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-techdocs-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// GitHub 集成
backend.add(import('@backstage/plugin-catalog-backend-module-github'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));

// Kubernetes
backend.add(import('@backstage/plugin-kubernetes-backend'));

// 搜索增强
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

backend.start();
```

---

## 第三章：Laravel 微服务软件模板深度设计

### 3.1 模板设计哲学

在设计 Laravel 微服务模板之前，我们需要明确几个设计原则：

**原则一：约定优于配置（Convention over Configuration）**

模板应该内嵌团队的最佳实践，而不是暴露大量配置选项让开发者做决策。80% 的场景应该通过默认配置直接满足。

**原则二：渐进式复杂性（Progressive Complexity）**

模板生成的项目应该开箱即用，但也要允许高级用户进行深度定制。通过分层的配置和可选模块来实现。

**原则三：安全左移（Shift Left Security）**

安全性不应是事后考虑的问题。模板应该内置安全最佳实践，包括依赖审计、SAST 扫描、容器镜像安全扫描等。

**原则四：可观测性优先（Observability First）**

每个微服务从创建之初就应该具备完善的可观测性能力，包括结构化日志、指标暴露和分布式追踪。

### 3.2 完整的 Backstage 模板定义

以下是一个生产级别的 Laravel 微服务 Backstage 模板的完整定义：

```yaml
# templates/laravel-microservice/template.yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: laravel-microservice
  title: Laravel 微服务脚手架
  description: |
    创建一个标准化的 Laravel 微服务项目，包含完整的 CI/CD 流水线、
    Docker 容器化配置、Kubernetes 部署清单、监控告警规则和技术文档模板。
    遵循团队 Golden Path 标准，开箱即用。
  tags:
    - PHP
    - Laravel
    - microservice
    - recommended
  annotations:
    backstage.io/techdocs-ref: dir:.
  links:
    - title: 平台工程文档
      url: https://docs.internal.company.com/platform
    - title: 微服务开发指南
      url: https://docs.internal.company.com/microservices
spec:
  owner: platform-engineering
  type: service
  system: microservice-platform

  parameters:
    # ========== 基础信息 ==========
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
          description: |
            服务名称，将用作项目名、Git 仓库名和 Kubernetes 部署名。
            仅允许小写字母、数字和连字符，长度 3-40 个字符。
          pattern: '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'
          examples:
            - order-service
            - payment-gateway
            - user-profile-api
          ui:autofocus: true

        description:
          title: 服务描述
          type: string
          description: 简要描述服务的业务功能，将写入 README 和软件目录
          maxLength: 200

        owner:
          title: 服务所有者
          type: string
          description: 负责该服务的团队或用户组（采用 Group 引用格式）
          ui:field: OwnerPicker
          ui:options:
            catalogFilter:
              kind: Group

        system:
          title: 所属系统
          type: string
          description: 服务所属的业务系统
          ui:field: EntityPicker
          ui:options:
            catalogFilter:
              kind: System

        lifecycle:
          title: 生命周期阶段
          type: string
          description: 服务当前所处的生命周期阶段
          enum:
            - experimental
            - production
            - deprecated
          default: experimental

    # ========== 技术配置 ==========
    - title: 技术配置
      required:
        - phpVersion
        - laravelVersion
        - database
      properties:
        phpVersion:
          title: PHP 版本
          type: string
          enum:
            - '8.3'
            - '8.2'
            - '8.1'
          default: '8.3'
          description: 选择 PHP 运行时版本

        laravelVersion:
          title: Laravel 版本
          type: string
          enum:
            - '11.x'
            - '10.x'
          default: '11.x'

        database:
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

        enableHorizon:
          title: 启用 Laravel Horizon
          type: boolean
          default: true
          description: Laravel Horizon 提供队列监控和管理能力

        enableTelescope:
          title: 启用 Laravel Telescope（仅非生产环境）
          type: boolean
          default: true

        enableOctane:
          title: 启用 Laravel Octane（高性能模式）
          type: boolean
          default: false
          description: 使用 Swoole 作为应用服务器，提升吞吐量

    # ========== 部署配置 ==========
    - title: 部署配置
      required:
        - environment
        - cluster
        - replicas
      properties:
        environment:
          title: 部署环境
          type: string
          enum:
            - staging
            - production
          default: staging

        cluster:
          title: 目标集群
          type: string
          enum:
            - k8s-main-ap-southeast
            - k8s-main-us-east
            - k8s-eu-central
          default: k8s-main-ap-southeast

        namespace:
          title: Kubernetes 命名空间
          type: string
          default: microservices
          description: 默认为 microservices，可自定义

        replicas:
          title: 初始副本数
          type: integer
          minimum: 1
          maximum: 10
          default: 2

        resources:
          title: 资源配额
          type: object
          properties:
            cpuRequest:
              title: CPU 请求
              type: string
              default: '100m'
            cpuLimit:
              title: CPU 限制
              type: string
              default: '500m'
            memoryRequest:
              title: 内存请求
              type: string
              default: '256Mi'
            memoryLimit:
              title: 内存限制
              type: string
              default: '512Mi'

        enableAutoScaling:
          title: 启用自动扩缩容
          type: boolean
          default: true

        autoScaling:
          title: 自动扩缩容配置
          type: object
          properties:
            minReplicas:
              title: 最小副本数
              type: integer
              default: 2
            maxReplicas:
              title: 最大副本数
              type: integer
              default: 10
            targetCPU:
              title: CPU 目标利用率 (%)
              type: integer
              default: 70

    # ========== 可观测性配置 ==========
    - title: 可观测性与监控
      properties:
        enablePrometheus:
          title: 启用 Prometheus 指标
          type: boolean
          default: true

        enableTracing:
          title: 启用分布式追踪（OpenTelemetry）
          type: boolean
          default: true

        enableStructuredLogging:
          title: 启用结构化日志（JSON 格式）
          type: boolean
          default: true

        alerting:
          title: 告警配置
          type: object
          properties:
            enabled:
              title: 启用告警
              type: boolean
              default: true
            slackChannel:
              title: Slack 告警频道
              type: string
              default: '#platform-alerts'
            pagerdutyServiceKey:
              title: PagerDuty 服务密钥（生产环境必需）
              type: string

    # ========== 仓库配置 ==========
    - title: 代码仓库
      required:
        - repoUrl
      properties:
        repoUrl:
          title: 仓库位置
          type: string
          ui:field: RepoPicker
          ui:options:
            allowedHosts:
              - github.com
              - github.internal.company.com

        enableBranchProtection:
          title: 启用分支保护
          type: boolean
          default: true
          description: 对 main 分支启用保护规则，要求 PR 审查和状态检查

  # ========== 模板执行步骤 ==========
  steps:
    # 步骤 1：从模板仓库克隆 Laravel 微服务骨架
    - id: fetch
      name: 获取 Laravel 微服务模板
      action: fetch:template
      input:
        url: ./skeleton
        targetPath: ${{ parameters.name }}
        values:
          name: ${{ parameters.name }}
          description: ${{ parameters.description }}
          owner: ${{ parameters.owner }}
          system: ${{ parameters.system }}
          lifecycle: ${{ parameters.lifecycle }}
          phpVersion: ${{ parameters.phpVersion }}
          laravelVersion: ${{ parameters.laravelVersion }}
          database: ${{ parameters.database }}
          cacheDriver: ${{ parameters.cacheDriver }}
          queueDriver: ${{ parameters.queueDriver }}
          enableHorizon: ${{ parameters.enableHorizon }}
          enableTelescope: ${{ parameters.enableTelescope }}
          enableOctane: ${{ parameters.enableOctane }}
          enablePrometheus: ${{ parameters.enablePrometheus }}
          enableTracing: ${{ parameters.enableTracing }}
          enableStructuredLogging: ${{ parameters.enableStructuredLogging }}
          enableAutoScaling: ${{ parameters.enableAutoScaling }}
          namespace: ${{ parameters.namespace }}
          replicas: ${{ parameters.replicas }}
          repoUrl: ${{ parameters.repoUrl }}

    # 步骤 2：注册目录实体
    - id: register
      name: 注册到软件目录
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps.fetch.output.repoContentsUrl }}
        catalogInfoPath: /catalog-info.yaml

    # 步骤 3：创建 GitHub 仓库并推送代码
    - id: publish
      name: 推送到代码仓库
      action: github:publish
      input:
        allowedHosts:
          - github.com
          - github.internal.company.com
        description: ${{ parameters.description }}
        repoUrl: ${{ parameters.repoUrl }}
        defaultBranch: main
        protectDefaultBranch: ${{ parameters.enableBranchProtection }}
        requireCodeOwnerReviews: true
        requiredStatusCheckContexts:
          - 'CI / lint'
          - 'CI / test'
          - 'CI / security-scan'
          deleteBranchOnMerge: true

    # 步骤 4：配置 GitHub Actions Secrets
    - id: setup-secrets
      name: 配置 CI/CD 密钥
      action: github:actions:dispatch
      input:
        repoUrl: ${{ parameters.repoUrl }}
        workflowId: setup-secrets.yml
        branchOrTagName: main

    # 步骤 5：在 Kubernetes 中创建命名空间和资源
    - id: k8s-setup
      name: 初始化 Kubernetes 资源
      action: kubernetes:create-namespace
      input:
        clusterName: ${{ parameters.cluster }}
        namespace: ${{ parameters.namespace }}

    # 步骤 6：创建 ArgoCD Application
    - id: argocd-app
      name: 注册 ArgoCD 应用
      action: argocd:create-app
      input:
        appName: ${{ parameters.name }}
        namespace: ${{ parameters.namespace }}
        repoUrl: ${{ steps.publish.output.remoteUrl }}
        path: k8s/overlays/${{ parameters.environment }}

    # 步骤 7：输出结果
    - id: output
      name: 生成结果摘要
      action: debug:log
      input:
        message: |
          ✅ 服务 "${{ parameters.name }}" 创建成功！
          📦 代码仓库: ${{ steps.publish.output.remoteUrl }}
          📋 目录注册: ${{ steps.register.output.entityRef }}
          🚀 ArgoCD 应用: ${{ parameters.name }}

  output:
    links:
      - title: 代码仓库
        icon: github
        url: ${{ steps.publish.output.remoteUrl }}
      - title: 软件目录
        icon: catalog
        url: /catalog/default/${{ steps.fetch.output.entityRef }}
      - title: 技术文档
        icon: docs
        url: /docs/default/component/${{ parameters.name }}
      - title: ArgoCD 应用
        icon: deployment
        url: https://argocd.internal.company.com/applications/${{ parameters.name }}
```

### 3.3 模板骨架（Skeleton）详解

模板的骨架目录是生成项目的蓝本。以下是完整的目录结构：

```
templates/laravel-microservice/skeleton/
├── .github/
│   ├── workflows/
│   │   ├── ci.yaml                  # CI 流水线
│   │   ├── cd.yaml                  # CD 流水线
│   │   └── release.yaml             # 发布流水线
│   ├── CODEOWNERS                   # 代码所有者
│   └── pull_request_template.md     # PR 模板
├── .vscode/
│   ├── settings.json
│   └── extensions.json
├── app/
│   ├── Console/
│   │   └── Commands/
│   ├── Exceptions/
│   │   └── Handler.php.tpl          # 自定义异常处理
│   ├── Http/
│   │   ├── Controllers/
│   │   ├── Middleware/
│   │   │   ├── PrometheusMiddleware.php.tpl
│   │   │   └── RequestTraceMiddleware.php.tpl
│   │   └── Requests/
│   ├── Models/
│   ├── Providers/
│   ├── Services/
│   └── Observability/
│       ├── MetricsService.php.tpl
│       └── TracingService.php.tpl
├── config/
│   ├── app.php.tpl
│   ├── database.php.tpl
│   ├── logging.php.tpl              # 结构化日志配置
│   ├── observability.php.tpl        # 可观测性配置
│   └── queue.php.tpl
├── database/
│   ├── migrations/
│   ├── seeders/
│   └── factories/
├── docker/
│   ├── Dockerfile.tpl               # 多阶段构建
│   ├── Dockerfile.octane.tpl        # Octane 模式 Dockerfile
│   ├── docker-compose.yaml.tpl      # 本地开发环境
│   ├── nginx.conf.tpl               # Nginx 配置
│   ├── php.ini.tpl                  # PHP 配置
│   ├── opcache.ini.tpl              # OPcache 配置
│   └── supervisord.conf.tpl         # Supervisor 配置
├── k8s/
│   ├── base/
│   │   ├── kustomization.yaml
│   │   ├── deployment.yaml.tpl
│   │   ├── service.yaml.tpl
│   │   ├── ingress.yaml.tpl
│   │   ├── hpa.yaml.tpl
│   │   ├── pdb.yaml.tpl
│   │   ├── configmap.yaml.tpl
│   │   ├── secret.yaml.tpl
│   │   ├── serviceaccount.yaml.tpl
│   │   └── networkpolicy.yaml.tpl
│   └── overlays/
│       ├── staging/
│       │   ├── kustomization.yaml
│       │   └── patches/
│       └── production/
│           ├── kustomization.yaml
│           └── patches/
├── monitoring/
│   ├── prometheus/
│   │   ├── servicemonitor.yaml.tpl
│   │   └── alerting-rules.yaml.tpl
│   ├── grafana/
│   │   └── dashboard.json.tpl
│   └── loki/
│       └── log-pipeline.yaml.tpl
├── docs/
│   ├── index.md.tpl
│   ├── architecture.md
│   ├── api.md.tpl
│   ├── runbook.md.tpl
│   └── mkdocs.yml.tpl
├── tests/
│   ├── Unit/
│   ├── Feature/
│   └── Integration/
├── catalog-info.yaml.tpl
├── README.md.tpl
├── .env.example.tpl
├── .gitignore
├── .editorconfig
├── .php-cs-fixer.dist.php
├── phpstan.neon
├── phpunit.xml.tpl
├── pest.php
└── composer.json.tpl
```

### 3.4 关键骨架文件详解

#### 3.4.1 catalog-info.yaml.tpl — 软件目录实体定义

```yaml
# catalog-info.yaml.tpl
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${{ values.name }}
  description: ${{ values.description }}
  annotations:
    github.com/project-slug: ${{ values.repoUrl | parseRepoUrl | pick("projectSlug") }}
    backstage.io/techdocs-ref: dir:.
    backstage.io/kubernetes-id: ${{ values.name }}
    backstage.io/kubernetes-namespace: ${{ values.namespace }}
    ${{ values.enablePrometheus ? 'prometheus.io/scrape: "true"' : '' }}
    ${{ values.enablePrometheus ? 'prometheus.io/port: "9090"' : '' }}
    ${{ values.enablePrometheus ? 'prometheus.io/path: "/metrics"' : '' }}
    argocd/app-name: ${{ values.name }}
  tags:
    - PHP
    - Laravel
    - microservice
    - ${{ values.lifecycle }}
  links:
    - title: API Documentation
      url: /docs/default/component/${{ values.name }}/api
    - title: Grafana Dashboard
      url: https://grafana.internal.company.com/d/${{ values.name }}
    - title: ArgoCD
      url: https://argocd.internal.company.com/applications/${{ values.name }}
spec:
  type: service
  lifecycle: ${{ values.lifecycle }}
  system: ${{ values.system }}
  owner: ${{ values.owner }}
  providesApis:
    - ${{ values.name }}-api
  consumesApis: []
  dependsOn: []
  definition: /docs/default/component/${{ values.name }}/architecture
```

#### 3.4.2 Dockerfile.tpl — 生产级多阶段构建

```dockerfile
# docker/Dockerfile.tpl
# ============================================
# 阶段 1：依赖安装
# ============================================
FROM composer:2.7 AS composer

# 安装系统依赖（用于编译 PHP 扩展）
RUN apk add --no-cache \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    icu-dev \
    oniguruma-dev \
    linux-headers

WORKDIR /app

# 先复制依赖文件以利用 Docker 缓存层
COPY composer.json composer.lock ./

# 安装生产依赖（不含开发依赖）
RUN composer install \
    --no-dev \
    --no-scripts \
    --no-autoloader \
    --prefer-dist \
    --optimize-autoloader

# ============================================
# 阶段 2：Node.js 构建（如有前端资源）
# ============================================
FROM node:20-alpine AS node

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY . .
RUN npm run build 2>/dev/null || echo "No frontend build step"

# ============================================
# 阶段 3：PHP 运行时基础镜像
# ============================================
FROM php:${{ values.phpVersion }}-fpm-alpine AS base

# 安装 PHP 扩展
RUN apk add --no-cache \
    libpng \
    libjpeg-turbo \
    freetype \
    icu-libs \
    oniguruma \
    libzip \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        pdo_pgsql \
        gd \
        bcmath \
        intl \
        opcache \
        pcntl \
        zip \
        sockets

# 安装 Redis 扩展
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del .build-deps

${{ if values.enableOctane }}
# 安装 Swoole（用于 Octane）
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
    && pecl install swoole \
    && docker-php-ext-enable swoole \
    && apk del .build-deps
${{ endif }}

# PHP 配置优化
COPY docker/php.ini /usr/local/etc/php/conf.d/app.ini
COPY docker/opcache.ini /usr/local/etc/php/conf.d/opcache.ini

# ============================================
# 阶段 4：最终应用镜像
# ============================================
FROM base AS app

WORKDIR /var/www/html

# 从 Composer 阶段复制依赖
COPY --from=composer /app/vendor ./vendor
COPY --from=composer /app/composer.json ./

# 从 Node 构建阶段复制前端资源
COPY --from=node /app/public/build ./public/build 2>/dev/null || true

# 复制应用代码
COPY . .

# 生成优化的自动加载器
RUN composer dump-autoload --optimize --classmap-authoritative

# 安装 Passport 密钥（如使用 API 认证）
# RUN php artisan key:generate --force
# RUN php artisan passport:keys --force

# 设置文件权限
RUN chown -R www-data:www-data \
    storage \
    bootstrap/cache \
    && chmod -R 775 \
    storage \
    bootstrap/cache

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:9000/up || exit 1

EXPOSE 9000
CMD ["php-fpm"]

# ============================================
# 阶段 5：Web 服务器镜像（Nginx + PHP-FPM）
# ============================================
FROM nginx:1.25-alpine AS web

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=app /var/www/html /var/www/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/up || exit 1

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

# ============================================
# 阶段 6：队列工作进程镜像
# ============================================
FROM base AS worker

COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

# ============================================
# 阶段 7：定时任务镜像
# ============================================
FROM base AS scheduler

COPY docker/crontab /etc/crontabs/www-data
RUN crontab -u www-data /etc/crontabs/www-data

CMD ["crond", "-f", "-l", "2"]
```

#### 3.4.3 GitHub Actions CI 流水线

```yaml
# .github/workflows/ci.yaml.tpl
name: CI

on:
  push:
    branches: [main, develop, 'feature/**']
  pull_request:
    branches: [main, develop]

env:
  PHP_VERSION: '${{ values.phpVersion }}'
  NODE_VERSION: '20'
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ========== 代码质量检查 ==========
  lint:
    name: 'Lint & Code Style'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ env.PHP_VERSION }}
          tools: composer:v2
          coverage: none

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ runner.os }}-${{ hashFiles('composer.lock') }}

      - name: Install dependencies
        run: composer install --prefer-dist --no-progress --no-interaction

      - name: PHP CS Fixer (Pint)
        run: vendor/bin/pint --test --format=github

      - name: PHPStan Static Analysis
        run: vendor/bin/phpstan analyse --error-format=github

  # ========== 自动化测试 ==========
  test:
    name: 'Tests'
    runs-on: ubuntu-latest
    needs: lint
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ env.PHP_VERSION }}
          extensions: dom, curl, libxml, mbstring, zip, pdo, pdo_mysql
          tools: composer:v2
          coverage: xdebug

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ runner.os }}-${{ hashFiles('composer.lock') }}

      - name: Install dependencies
        run: composer install --prefer-dist --no-progress --no-interaction

      - name: Prepare environment
        run: |
          cp .env.ci .env
          php artisan key:generate

      - name: Run migrations
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: test_db
          DB_USERNAME: root
          DB_PASSWORD: root
        run: php artisan migrate --force

      - name: Run tests
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: test_db
          DB_USERNAME: root
          DB_PASSWORD: root
        run: vendor/bin/pest --coverage --min=80 --coverage-clover=coverage.xml

      - name: Upload coverage
        if: success()
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml
          token: ${{ secrets.CODECOV_TOKEN }}

  # ========== 安全扫描 ==========
  security-scan:
    name: 'Security Scan'
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ env.PHP_VERSION }}
          tools: composer:v2

      - name: Install dependencies
        run: composer install --prefer-dist --no-progress --no-interaction

      - name: Composer Audit
        run: composer audit --no-dev

      - name: Run Semgrep SAST
        uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/php
            p/laravel
            p/owasp-top-ten
          generateSarif: true

      - name: Check for hardcoded secrets
        uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --only-verified

  # ========== 构建 Docker 镜像 ==========
  build:
    name: 'Build Image'
    runs-on: ubuntu-latest
    needs: [test, security-scan]
    permissions:
      contents: read
      packages: write
    outputs:
      image_tag: ${{ steps.meta.outputs.tags }}
      image_digest: ${{ steps.build-push.outputs.digest }}

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}

      - name: Build and push
        id: build-push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile
          target: web
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan image for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

  # ========== 部署到 Staging ==========
  deploy-staging:
    name: 'Deploy to Staging'
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    environment:
      name: staging
      url: https://${{ values.name }}.staging.internal.company.com

    steps:
      - uses: actions/checkout@v4

      - name: Update Kubernetes manifests
        uses: mikefarah/yq@master
        with:
          cmd: |
            yq -i '.spec.template.spec.containers[0].image = "${{ needs.build.outputs.image_tag }}"' \
              k8s/overlays/staging/patches/deployment-patch.yaml

      - name: Commit and push changes
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add k8s/
          git commit -m "chore: update staging image to ${{ github.sha }}"
          git push

      - name: Wait for ArgoCD sync
        uses: argoproj/argo-cd-action@v2
        with:
          command: app wait ${{ values.name }}-staging --timeout 300
```

#### 3.4.4 Kubernetes 部署清单

```yaml
# k8s/base/deployment.yaml.tpl
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${{ values.name }}
  namespace: ${{ values.namespace }}
  labels:
    app.kubernetes.io/name: ${{ values.name }}
    app.kubernetes.io/component: web
    app.kubernetes.io/part-of: ${{ values.system }}
    app.kubernetes.io/managed-by: kustomize
    backstage.io/namespace: ${{ values.namespace }}
spec:
  replicas: ${{ values.replicas }}
  revisionHistoryLimit: 5
  selector:
    matchLabels:
      app.kubernetes.io/name: ${{ values.name }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${{ values.name }}
        app.kubernetes.io/component: web
      annotations:
        prometheus.io/scrape: "${{ values.enablePrometheus }}"
        prometheus.io/port: "9145"
        prometheus.io/path: "/metrics"
        checksum/config: ${CONFIGMAP_CHECKSUM}
    spec:
      serviceAccountName: ${{ values.name }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 33
        runAsGroup: 33
        fsGroup: 33

      # 初始化容器：等待数据库就绪
      initContainers:
        - name: wait-for-db
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              until nc -z ${DB_HOST} ${DB_PORT}; do
                echo "Waiting for database..."
                sleep 2
              done
              echo "Database is ready!"
          resources:
            limits:
              cpu: 100m
              memory: 64Mi

        # 数据库迁移
        - name: migrate
          image: ${IMAGE_NAME}:${IMAGE_TAG}
          command: ['php', 'artisan', 'migrate', '--force']
          envFrom:
            - configMapRef:
                name: ${{ values.name }}-config
            - secretRef:
                name: ${{ values.name }}-secrets
          resources:
            limits:
              cpu: 200m
              memory: 256Mi

      containers:
        # 主容器：Web 服务
        - name: web
          image: ${IMAGE_NAME}:${IMAGE_TAG}
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          envFrom:
            - configMapRef:
                name: ${{ values.name }}-config
            - secretRef:
                name: ${{ values.name }}-secrets
          env:
            - name: APP_ENV
              value: ${{ values.environment }}
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_IP
              valueFrom:
                fieldRef:
                  fieldPath: status.podIP

          # 资源限制
          resources:
            requests:
              cpu: ${{ values.resources.cpuRequest }}
              memory: ${{ values.resources.memoryRequest }}
            limits:
              cpu: ${{ values.resources.cpuLimit }}
              memory: ${{ values.resources.memoryLimit }}

          # 启动探针（给应用充足的启动时间）
          startupProbe:
            httpGet:
              path: /up
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 30

          # 存活探针
          livenessProbe:
            httpGet:
              path: /up
              port: http
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 3

          # 就绪探针
          readinessProbe:
            httpGet:
              path: /up
              port: http
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3

          # 安全上下文
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL

          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: storage
              mountPath: /var/www/html/storage
            - name: bootstrap-cache
              mountPath: /var/www/html/bootstrap/cache

        ${{ if values.enableHorizon }}
        # 队列工作进程
        - name: horizon
          image: ${IMAGE_NAME}:${IMAGE_TAG}
          command: ['php', 'artisan', 'horizon']
          envFrom:
            - configMapRef:
                name: ${{ values.name }}-config
            - secretRef:
                name: ${{ values.name }}-secrets
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: storage
              mountPath: /var/www/html/storage
            - name: bootstrap-cache
              mountPath: /var/www/html/bootstrap/cache
        ${{ endif }}

      volumes:
        - name: tmp
          emptyDir:
            medium: Memory
            sizeLimit: 128Mi
        - name: storage
          emptyDir:
            sizeLimit: 1Gi
        - name: bootstrap-cache
          emptyDir:
            sizeLimit: 64Mi

      # Pod 反亲和性：确保副本分布在不同节点
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app.kubernetes.io/name
                      operator: In
                      values:
                        - ${{ values.name }}
                topologyKey: kubernetes.io/hostname

      # 优雅终止
      terminationGracePeriodSeconds: 60
```

```yaml
# k8s/base/hpa.yaml.tpl
${{ if values.enableAutoScaling }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${{ values.name }}
  namespace: ${{ values.namespace }}
  labels:
    app.kubernetes.io/name: ${{ values.name }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${{ values.name }}
  minReplicas: ${{ values.autoScaling.minReplicas }}
  maxReplicas: ${{ values.autoScaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: ${{ values.autoScaling.targetCPU }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
${{ endif }}
```

#### 3.4.5 监控告警配置

```yaml
# monitoring/prometheus/alerting-rules.yaml.tpl
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ${{ values.name }}-alerts
  namespace: ${{ values.namespace }}
  labels:
    app.kubernetes.io/name: ${{ values.name }}
    prometheus: kube-prometheus
    role: alert-rules
spec:
  groups:
    - name: ${{ values.name }}.rules
      rules:
        # 服务可用性
        - alert: ${{ values.name | upper | replace("-", "_") }}_ServiceDown
          expr: |
            up{job="${{ values.name }}"} == 0
          for: 1m
          labels:
            severity: critical
            service: ${{ values.name }}
            team: ${{ values.owner }}
          annotations:
            summary: '服务 {{ $labels.instance }} 已停止响应'
            description: '${{ values.name }} 服务实例 {{ $labels.instance }} 已宕机超过 1 分钟。'
            runbook_url: 'https://docs.internal.company.com/runbooks/${{ values.name }}#service-down'

        # 高错误率
        - alert: ${{ values.name | upper | replace("-", "_") }}_HighErrorRate
          expr: |
            (
              sum(rate(http_requests_total{job="${{ values.name }}", status=~"5.."}[5m]))
              /
              sum(rate(http_requests_total{job="${{ values.name }}"}[5m]))
            ) > 0.05
          for: 5m
          labels:
            severity: warning
            service: ${{ values.name }}
            team: ${{ values.owner }}
          annotations:
            summary: '${{ values.name }} 5xx 错误率超过 5%'
            description: '过去 5 分钟内，{{ $labels.instance }} 的 5xx 错误率为 {{ $value | humanizePercentage }}。'
            runbook_url: 'https://docs.internal.company.com/runbooks/${{ values.name }}#high-error-rate'

        # 高延迟
        - alert: ${{ values.name | upper | replace("-", "_") }}_HighLatency
          expr: |
            histogram_quantile(0.95,
              sum(rate(http_request_duration_seconds_bucket{job="${{ values.name }}"}[5m])) by (le)
            ) > 2
          for: 5m
          labels:
            severity: warning
            service: ${{ values.name }}
            team: ${{ values.owner }}
          annotations:
            summary: '${{ values.name }} P95 延迟超过 2 秒'
            runbook_url: 'https://docs.internal.company.com/runbooks/${{ values.name }}#high-latency'

        # 高 CPU 使用率
        - alert: ${{ values.name | upper | replace("-", "_") }}_HighCPU
          expr: |
            rate(container_cpu_usage_seconds_total{container="web", pod=~"${{ values.name }}.*"}[5m]) > 0.8
          for: 10m
          labels:
            severity: warning
            service: ${{ values.name }}
          annotations:
            summary: '${{ values.name }} CPU 使用率持续过高'

        # 高内存使用率
        - alert: ${{ values.name | upper | replace("-", "_") }}_HighMemory
          expr: |
            container_memory_working_set_bytes{container="web", pod=~"${{ values.name }}.*"}
            / container_spec_memory_limit_bytes{container="web", pod=~"${{ values.name }}.*"}
            > 0.85
          for: 5m
          labels:
            severity: warning
            service: ${{ values.name }}
          annotations:
            summary: '${{ values.name }} 内存使用率超过 85%'

        ${{ if values.enableHorizon }}
        # 队列积压
        - alert: ${{ values.name | upper | replace("-", "_") }}_QueueBacklog
          expr: |
            laravel_queue_jobs_total{job="${{ values.name }}", status="pending"} > 1000
          for: 5m
          labels:
            severity: warning
            service: ${{ values.name }}
          annotations:
            summary: '${{ values.name }} 队列积压超过 1000 个任务'
        ${{ endif }}
```

---

## 第四章：Laravel 应用层的可观测性集成

### 4.1 结构化日志配置

在微服务架构中，结构化日志是排查问题的基础。以下配置将 Laravel 的日志输出为 JSON 格式，便于 Loki/ELK 等日志系统解析：

```php
<?php
// config/logging.php.tpl
return [
    'default' => env('LOG_CHANNEL', 'structured'),

    'channels' => [
        'structured' => [
            'driver' => 'monolog',
            'handler' => StreamHandler::class,
            'formatter' => env('LOG_JSON_FORMAT', true)
                ? \Monolog\Formatter\JsonFormatter::class
                : null,
            'level' => env('LOG_LEVEL', 'info'),
            'with' => [
                'stream' => 'php://stdout',
            ],
            'processors' => [
                \Monolog\Processor\PsrLogMessageProcessor::class,
                // 添加请求 ID 用于分布式追踪
                function (array $record) {
                    $record['extra']['request_id'] =
                        request()->header('X-Request-Id', uniqid());
                    $record['extra']['trace_id'] =
                        request()->header('X-Trace-Id', '');
                    $record['extra']['service'] = config('app.name');
                    $record['extra']['environment'] = config('app.env');
                    $record['extra']['pod_name'] = env('POD_NAME', gethostname());
                    return $record;
                },
            ],
        ],

        // Loki 专用通道
        'loki' => [
            'driver' => 'monolog',
            'handler' => \Grafana\Laravel\Handlers\LokiHandler::class,
            'handler_with' => [
                'url' => env('LOKI_URL', 'http://loki:3100/loki/api/v1/push'),
                'labels' => [
                    'service' => config('app.name'),
                    'environment' => config('app.env'),
                ],
            ],
        ],
    ],
];
```

### 4.2 Prometheus 指标暴露

通过中间件和自定义服务，为 Laravel 应用暴露 Prometheus 格式的指标：

```php
<?php
// app/Observability/MetricsService.php.tpl
declare(strict_types=1);

namespace App\Observability;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class MetricsService
{
    /**
     * 收集应用级别的自定义指标
     * 这些指标会被 Prometheus 抓取
     */
    public function collect(): array
    {
        return [
            // HTTP 请求指标
            'http_requests_total' => [
                'help' => 'Total HTTP requests',
                'type' => 'counter',
                'labels' => ['method', 'route', 'status'],
            ],
            'http_request_duration_seconds' => [
                'help' => 'HTTP request duration in seconds',
                'type' => 'histogram',
                'labels' => ['method', 'route'],
                'buckets' => [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            ],

            // 业务指标示例
            'laravel_queue_jobs_total' => [
                'help' => 'Total queue jobs',
                'type' => 'gauge',
                'labels' => ['queue', 'status'],
            ],
            'laravel_database_connections' => [
                'help' => 'Active database connections',
                'type' => 'gauge',
            ],

            // 自定义业务指标
            ${{ if values.database == 'mysql' }}
            'laravel_db_query_duration_seconds' => [
                'help' => 'Database query duration',
                'type' => 'histogram',
                'labels' => ['query_type'],
                'buckets' => [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0],
            ],
            ${{ endif }}
        ];
    }

    /**
     * 获取当前指标快照
     */
    public function snapshot(): array
    {
        $metrics = [];

        // 队列状态
        $metrics['laravel_queue_jobs_total'] = [
            ['queue' => 'default', 'status' => 'pending'] =>
                $this->getQueueSize('default'),
            ['queue' => 'default', 'status' => 'failed'] =>
                $this->getFailedJobs(),
        ];

        // 数据库连接数
        $metrics['laravel_database_connections'] =
            DB::selectOne('SELECT COUNT(*) as count FROM information_schema.processlist')
                ->count ?? 0;

        // 缓存命中率
        $cacheStats = Cache::getStats();
        if ($cacheStats) {
            $metrics['laravel_cache_hit_ratio'] = $cacheStats['hits'] /
                max($cacheStats['hits'] + $cacheStats['misses'], 1);
        }

        return $metrics;
    }

    protected function getQueueSize(string $queue): int
    {
        try {
            return DB::table('jobs')->where('queue', $queue)->count();
        } catch (\Throwable $e) {
            return 0;
        }
    }

    protected function getFailedJobs(): int
    {
        try {
            return DB::table('failed_jobs')->count();
        } catch (\Throwable $e) {
            return 0;
        }
    }
}
```

```php
<?php
// app/Http/Middleware/PrometheusMiddleware.php.tpl
declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use App\Observability\MetricsService;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusMiddleware
{
    private CollectorRegistry $registry;

    public function __construct()
    {
        Redis::setDefault(
            new Redis([
                'host' => config('services.redis.host', 'redis'),
                'port' => config('services.redis.port', 6379),
            ])
        );
        $this->registry = CollectorRegistry::getDefault();
    }

    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);

        /** @var Response $response */
        $response = $next($request);

        $duration = microtime(true) - $start;

        // 记录 HTTP 请求指标
        $counter = $this->registry->getOrRegisterCounter(
            'http_requests_total',
            'Total HTTP requests',
            ['method', 'route', 'status']
        );
        $counter->inc([
            $request->method(),
            $request->route()?->getName() ?? $request->path(),
            (string) $response->getStatusCode(),
        ]);

        // 记录请求延迟
        $histogram = $this->registry->getOrRegisterHistogram(
            'http_request_duration_seconds',
            'HTTP request duration in seconds',
            ['method', 'route'],
            [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
        );
        $histogram->observe($duration, [
            $request->method(),
            $request->route()?->getName() ?? $request->path(),
        ]);

        return $response;
    }
}
```

### 4.3 OpenTelemetry 分布式追踪

```php
<?php
// app/Observability/TracingService.php.tpl
declare(strict_types=1);

namespace App\Observability;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\Contrib\Otlp\OtlpHttpExporter;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SemConv\ResourceAttributes;

class TracingService
{
    private $tracer;

    public function __construct()
    {
        if (!config('observability.tracing.enabled', false)) {
            return;
        }

        $resource = ResourceInfoFactory::merge(
            ResourceInfo::defaultResource(),
            ResourceInfo::create(ResourceInfo::create([
                ResourceAttributes::SERVICE_NAME => config('app.name'),
                ResourceAttributes::SERVICE_VERSION => config('app.version', '1.0.0'),
                ResourceAttributes::DEPLOYMENT_ENVIRONMENT => config('app.env'),
            ]))
        );

        $exporter = new OtlpHttpExporter(
            config('observability.tracing.endpoint', 'http://otel-collector:4318')
        );

        $tracerProvider = TracerProvider::builder()
            ->addSpanProcessor(new BatchSpanProcessor($exporter))
            ->setResource($resource)
            ->build();

        Globals::registerTracerProvider($tracerProvider);
        $this->tracer = $tracerProvider->getTracer(
            config('app.name'),
            config('app.version', '1.0.0')
        );
    }

    /**
     * 追踪一个操作
     */
    public function trace(string $name, callable $callback, array $attributes = [])
    {
        if (!config('observability.tracing.enabled', false)) {
            return $callback();
        }

        $span = $this->tracer->spanBuilder($name)
            ->setSpanKind(SpanKind::KIND_INTERNAL)
            ->startSpan();

        foreach ($attributes as $key => $value) {
            $span->setAttribute($key, $value);
        }

        $scope = $span->activate();

        try {
            $result = $callback();
            $span->setStatus(StatusCode::OK);
            return $result;
        } catch (\Throwable $e) {
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            $span->recordException($e);
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }

    /**
     * 在数据库查询中添加追踪信息
     */
    public function traceQuery(string $query, callable $callback): mixed
    {
        return $this->trace(
            'db.query',
            $callback,
            [
                'db.system' => config('database.default'),
                'db.statement' => $query,
            ]
        );
    }

    /**
     * 在 HTTP 外部调用中添加追踪信息
     */
    public function traceHttpCall(string $method, string $url, callable $callback): mixed
    {
        return $this->trace(
            "HTTP {$method}",
            $callback,
            [
                'http.method' => $method,
                'http.url' => $url,
            ]
        );
    }
}
```

---

## 第五章：TechDocs 集成与文档自动化

### 5.1 TechDocs 架构

Backstage 的 TechDocs 基于 MkDocs，允许团队在代码仓库中维护文档，自动构建和发布。以下是集成方案：

```
代码仓库结构（含文档）
├── docs/
│   ├── index.md          # 服务概述
│   ├── architecture.md   # 架构设计
│   ├── api.md            # API 文档
│   ├── runbook.md        # 运维手册
│   ├── changelog.md      # 变更日志
│   └── assets/
│       └── images/
├── mkdocs.yml            # MkDocs 配置
├── catalog-info.yaml     # Backstage 目录实体（含 techdocs-ref 注解）
└── src/                  # 应用代码
```

### 5.2 MkDocs 模板配置

```yaml
# docs/mkdocs.yml.tpl
site_name: ${{ values.name }}
site_description: ${{ values.description }}

repo_url: https://github.com/${{ values.repoUrl }}
edit_uri: edit/main/docs/

nav:
  - Home: index.md
  - Architecture: architecture.md
  - API Reference: api.md
  - Operations:
    - Runbook: runbook.md
    - Monitoring: monitoring.md
  - Development:
    - Getting Started: development.md
    - Contributing: contributing.md
  - Changelog: changelog.md

plugins:
  - techdocs-core
  - search
  - mkdocs-monorepo-plugin

markdown_extensions:
  - admonition
  - codehilite:
      guess_lang: false
  - toc:
      permalink: true
  - pymdownx.details
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.tabbed:
      alternate_style: true
  - pymdownx.snippets

theme:
  name: material
  palette:
    primary: deep purple
    accent: purple
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.expand
    - search.suggest
    - content.code.copy
```

### 5.3 服务文档模板

```markdown
<!-- docs/index.md.tpl -->
---
title: ${{ values.name }}
description: ${{ values.description }}
---

# ${{ values.name }}

> **Owner:** ${{ values.owner }}
> **System:** ${{ values.system }}
> **Lifecycle:** ${{ values.lifecycle }}

${{ values.description }}

## 快速开始

### 前置条件

- Docker & Docker Compose
- PHP ${{ values.phpVersion }}+
- Composer 2.x
- Node.js 20+ (前端开发)

### 本地开发环境启动

```bash
# 克隆仓库
git clone https://${{ values.repoUrl }}.git
cd ${{ values.name }}

# 启动开发环境
make dev

# 或使用 Docker Compose
cp .env.example .env
docker-compose up -d
```

### 运行测试

```bash
make test              # 运行所有测试
make test-unit         # 仅运行单元测试
make test-feature      # 仅运行功能测试
make test-coverage     # 生成覆盖率报告
```

## 架构概览

```
┌─────────────────────────────────────────┐
│            ${{ values.name }}            │
├─────────────────────────────────────────┤
│  HTTP Layer (Nginx + PHP-FPM)          │
│  ├── Route Middleware                   │
│  └── Controllers                       │
├─────────────────────────────────────────┤
│  Application Layer                      │
│  ├── Services                           │
│  ├── Actions (单任务操作)               │
│  └── DTOs (数据传输对象)                │
├─────────────────────────────────────────┤
│  Domain Layer                           │
│  ├── Models (Eloquent)                  │
│  ├── Events                             │
│  └── Policies                           │
├─────────────────────────────────────────┤
│  Infrastructure Layer                   │
│  ├── Repositories                       │
│  ├── External API Clients               │
│  └── Queue Jobs                         │
└─────────────────────────────────────────┘
```

## API 端点

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/health | 健康检查 |
| GET | /api/v1/status | 服务状态 |
| ... | ... | ... |

## 依赖服务

| Service | Purpose | Endpoint |
|---------|---------|----------|
| MySQL | 主数据库 | mysql.microservices:3306 |
| Redis | 缓存和队列 | redis.microservices:6379 |
| ... | ... | ... |

## 相关链接

- [API 文档](./api.md)
- [运维手册](./runbook.md)
- [架构决策记录](./architecture.md)
```

---

## 第六章：开发者自助门户的进阶使用

### 6.1 自定义 Backstage 前端页面

Backstage 允许通过自定义插件来扩展前端功能。以下是一个为 Laravel 微服务平台定制的仪表板组件示例：

```tsx
// packages/app/src/components/LaravelDashboard/LaravelServiceCard.tsx
import React from 'react';
import {
  InfoCard,
  StatusOK,
  StatusWarning,
  StatusError,
  MissingAnnotationEmptyState,
} from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Grid, Typography, Chip, Box } from '@material-ui/core';
import { useApi, fetchApiRef } from '@backstage/core-plugin-api';

export const LaravelServiceCard = () => {
  const { entity } = useEntity();
  const fetch = useApi(fetchApiRef);

  const annotations = entity.metadata.annotations || {};
  const serviceName = entity.metadata.name;
  const k8sId = annotations['backstage.io/kubernetes-id'];

  if (!k8sId) {
    return <MissingAnnotationEmptyState annotation="backstage.io/kubernetes-id" />;
  }

  // 从 Laravel 应用获取状态信息
  const [status, setStatus] = React.useState<any>(null);

  React.useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch.fetch(
          `/api/proxy/${serviceName}/api/v1/platform/status`
        );
        const data = await response.json();
        setStatus(data);
      } catch (error) {
        console.error('Failed to fetch service status:', error);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [serviceName, fetch]);

  const StatusIndicator = () => {
    if (!status) return <StatusWarning>Loading...</StatusWarning>;
    switch (status.health) {
      case 'healthy':
        return <StatusOK>Healthy</StatusOK>;
      case 'degraded':
        return <StatusWarning>Degraded</StatusWarning>;
      default:
        return <StatusError>Unhealthy</StatusError>;
    }
  };

  return (
    <InfoCard title={`${serviceName} - Laravel 微服务状态`}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Box mb={2}>
            <Typography variant="subtitle2">运行状态</Typography>
            <StatusIndicator />
          </Box>
          <Box mb={2}>
            <Typography variant="subtitle2">PHP 版本</Typography>
            <Chip label={status?.php_version || 'N/A'} size="small" />
          </Box>
          <Box mb={2}>
            <Typography variant="subtitle2">Laravel 版本</Typography>
            <Chip label={status?.laravel_version || 'N/A'} size="small" />
          </Box>
        </Grid>
        <Grid item xs={12} md={6}>
          <Box mb={2}>
            <Typography variant="subtitle2">队列状态</Typography>
            <Typography>
              待处理: {status?.queue?.pending ?? 0} |
              处理中: {status?.queue?.processing ?? 0} |
              失败: {status?.queue?.failed ?? 0}
            </Typography>
          </Box>
          <Box mb={2}>
            <Typography variant="subtitle2">数据库连接</Typography>
            <Typography>
              {status?.database?.connections ?? 0} 个活跃连接
            </Typography>
          </Box>
          <Box mb={2}>
            <Typography variant="subtitle2">缓存命中率</Typography>
            <Typography>
              {status?.cache?.hit_rate
                ? `${(status.cache.hit_rate * 100).toFixed(1)}%`
                : 'N/A'}
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </InfoCard>
  );
};
```

### 6.2 Laravel 端的平台 API 端点

为了让 Backstage 能够获取 Laravel 微服务的运行状态，我们需要暴露一个平台专用的 API 端点：

```php
<?php
// routes/platform.php.tpl
declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\PlatformController;

Route::prefix('api/v1/platform')
    ->middleware(['auth:platform-token'])
    ->group(function () {
        Route::get('/health', [PlatformController::class, 'health']);
        Route::get('/status', [PlatformController::class, 'status']);
        Route::get('/metrics-summary', [PlatformController::class, 'metricsSummary']);
    });
```

```php
<?php
// app/Http/Controllers/PlatformController.php.tpl
declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

class PlatformController extends Controller
{
    /**
     * 健康检查端点
     * K8s Liveness 和 Readiness Probe 使用
     */
    public function health(): JsonResponse
    {
        $checks = [];
        $healthy = true;

        // 数据库检查
        try {
            DB::connection()->getPdo();
            $checks['database'] = 'ok';
        } catch (\Throwable $e) {
            $checks['database'] = 'error';
            $healthy = false;
        }

        // 缓存检查
        try {
            Cache::put('_health_check', 'ok', 10);
            $checks['cache'] = Cache::get('_health_check') === 'ok' ? 'ok' : 'error';
        } catch (\Throwable $e) {
            $checks['cache'] = 'error';
        }

        // 队列检查
        try {
            $checks['queue'] = Queue::size() !== null ? 'ok' : 'error';
        } catch (\Throwable $e) {
            $checks['queue'] = 'error';
        }

        return response()->json([
            'status' => $healthy ? 'healthy' : 'unhealthy',
            'checks' => $checks,
            'timestamp' => now()->toIso8601String(),
        ], $healthy ? 200 : 503);
    }

    /**
     * 详细状态信息
     * 用于 Backstage 仪表板展示
     */
    public function status(): JsonResponse
    {
        return response()->json([
            'health' => $this->determineHealth(),
            'php_version' => PHP_VERSION,
            'laravel_version' => app()->version(),
            'environment' => app()->environment(),
            'queue' => [
                'pending' => $this->getQueuePendingCount(),
                'processing' => $this->getQueueProcessingCount(),
                'failed' => $this->getFailedJobCount(),
            ],
            'database' => [
                'connections' => $this->getActiveDbConnections(),
                'migration_status' => $this->getMigrationStatus(),
            ],
            'cache' => [
                'driver' => config('cache.default'),
                'hit_rate' => $this->getCacheHitRate(),
            ],
            'uptime' => $this->getUptime(),
            'version' => config('app.version', '1.0.0'),
            'build' => [
                'commit' => env('APP_BUILD_COMMIT', 'unknown'),
                'build_time' => env('APP_BUILD_TIME', 'unknown'),
                'pipeline_url' => env('APP_PIPELINE_URL', ''),
            ],
        ]);
    }

    /**
     * 指标摘要
     */
    public function metricsSummary(): JsonResponse
    {
        return response()->json([
            'requests' => [
                'total_today' => $this->getRequestCount(),
                'avg_response_time_ms' => $this->getAvgResponseTime(),
                'error_rate' => $this->getErrorRate(),
            ],
            'resources' => [
                'memory_usage_mb' => round(memory_get_usage(true) / 1024 / 1024, 2),
                'memory_peak_mb' => round(memory_get_peak_usage(true) / 1024 / 1024, 2),
            ],
        ]);
    }

    protected function determineHealth(): string
    {
        try {
            DB::connection()->getPdo();
            Cache::put('_health', 'ok', 5);
            return 'healthy';
        } catch (\Throwable) {
            return 'unhealthy';
        }
    }

    protected function getQueuePendingCount(): int
    {
        try {
            return DB::table('jobs')->count();
        } catch (\Throwable) {
            return 0;
        }
    }

    protected function getQueueProcessingCount(): int
    {
        try {
            return DB::table('jobs')->whereNotNull('reserved_at')->count();
        } catch (\Throwable) {
            return 0;
        }
    }

    protected function getFailedJobCount(): int
    {
        try {
            return DB::table('failed_jobs')->count();
        } catch (\Throwable) {
            return 0;
        }
    }

    protected function getActiveDbConnections(): int
    {
        try {
            $driver = config('database.default');
            if ($driver === 'mysql') {
                return (int) DB::selectOne(
                    'SHOW STATUS WHERE Variable_name = "Threads_connected"'
                )->Value;
            }
            return 0;
        } catch (\Throwable) {
            return 0;
        }
    }

    protected function getMigrationStatus(): string
    {
        try {
            $pending = count(Artisan::call('migrate:status', ['--pending' => true]));
            return $pending === 0 ? 'up-to-date' : "{$pending} pending";
        } catch (\Throwable) {
            return 'unknown';
        }
    }

    protected function getCacheHitRate(): ?float
    {
        return null; // 需要从 Redis INFO 命令获取
    }

    protected function getUptime(): string
    {
        $startTime = file_exists(storage_path('app/uptime'))
            ? (int) file_get_contents(storage_path('app/uptime'))
            : time();
        $uptime = time() - $startTime;
        return gmdate('d\\d H\\h i\\m s\\s', $uptime);
    }

    protected function getRequestCount(): int
    {
        return (int) Cache::get('metrics:requests:today', 0);
    }

    protected function getAvgResponseTime(): float
    {
        return (float) Cache::get('metrics:avg_response_time', 0);
    }

    protected function getErrorRate(): float
    {
        return (float) Cache::get('metrics:error_rate', 0);
    }
}
```

---

## 第七章：从零到一的实施路线图

### 7.1 阶段化实施方案

采用平台工程不是一蹴而就的事情，需要分阶段推进：

```
实施路线图（约 12-16 周）

阶段 1：基础搭建（第 1-3 周）
├── 部署 Backstage 实例
├── 配置身份认证（GitHub/GitLab SSO）
├── 配置软件目录（从现有仓库导入实体）
├── 建立第一个简单的 Laravel 微服务模板
└── 团队培训和概念普及

阶段 2：模板完善（第 4-6 周）
├── 完善 Laravel 微服务模板（CI/CD、Docker、K8s）
├── 集成 TechDocs，建立文档标准
├── 配置 Prometheus + Grafana 监控
├── 实现自动化的安全扫描
└── 收集团队反馈，迭代模板

阶段 3：平台增强（第 7-10 周）
├── 集成 ArgoCD 实现 GitOps 部署
├── 集成 SonarQube 代码质量门禁
├── 建立完善的告警体系
├── 开发自定义 Backstage 插件
├── 实现自助式的数据库和缓存资源申请
└── 建立平台 API（CLI 工具）

阶段 4：推广优化（第 11-16 周）
├── 全面推广到所有开发团队
├── 迁移现有服务到标准化模板
├── 建立平台成熟度度量体系
├── 持续优化开发者体验
└── 建立内部社区和最佳实践分享机制
```

### 7.2 平台成熟度度量

衡量平台工程的成功需要关注以下关键指标：

**开发者体验指标（DX Metrics）：**

| 指标 | 目标值 | 度量方式 |
|------|--------|---------|
| 新服务创建时间 | < 10 分钟 | 从填写模板到代码仓库可用的总时间 |
| 首次部署时间 | < 30 分钟 | 从代码推送至 Staging 环境可用 |
| 开发者满意度 (NPS) | > 40 | 季度调查问卷 |
| 模板采用率 | > 80% | 新服务使用模板的比例 |
| 文档覆盖率 | > 90% | 有 TechDocs 的服务占比 |

**工程效能指标（DORA Metrics）：**

| 指标 | 基线 | 目标 |
|------|------|------|
| 部署频率 | 每周 1-2 次 | 每天多次 |
| 变更前置时间 | 1-2 周 | < 1 天 |
| 变更失败率 | 15-30% | < 5% |
| 故障恢复时间 | 1-2 小时 | < 30 分钟 |

### 7.3 常见挑战与应对策略

**挑战一：模板僵化——过度标准化导致灵活性不足**

应对策略：采用「内核 + 插件」模式。模板提供一个不可修改的核心（安全基线、CI/CD 框架、K8s 基础结构），同时允许通过可选模块和参数化配置来满足不同团队的个性化需求。

**挑战二：模板维护——多模板版本管理困难**

应对策略：
- 使用独立的 Git 仓库管理模板，遵循语义化版本
- 模板自身也使用 CI/CD 流水线，包含自动化测试
- 建立模板评审委员会，定期评估和更新模板
- 使用 Backstage 的 `templateInfo` 注解追踪每个服务使用的模板版本

**挑战三：平台采用——开发团队不愿改变现有工作流**

应对策略：
- 首先在技术前瞻性强的团队试点，树立成功案例
- 提供清晰的迁移指南和一对一的迁移支持
- 量化对比：使用模板前后的效率差异
- 建立「平台大使」制度，在每个团队中培养平台倡导者
- 不强制，用吸引力而非强制力推动采用

**挑战四：安全合规——如何在自助服务中保证安全**

应对策略：
- 将安全检查嵌入模板的 CI/CD 流水线，作为质量门禁
- 使用 OPA（Open Policy Agent）在 Kubernetes 层面强制执行安全策略
- 模板内置安全最佳实践（非 root 用户运行、只读文件系统、最小权限）
- 定期自动化安全审计

### 7.4 生产环境部署注意事项

将 Backstage 部署到生产环境时，需要关注以下方面：

**高可用性部署：**

```yaml
# Backstage 生产部署的 K8s 配置要点
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backstage
  namespace: platform
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    spec:
      containers:
        - name: backstage-backend
          image: backstage:latest
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: "2"
              memory: 2Gi
          env:
            - name: NODE_ENV
              value: production
          readinessProbe:
            httpGet:
              path: /api/catalog/health
              port: 7007
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/catalog/health
              port: 7007
            initialDelaySeconds: 30
            periodSeconds: 30
```

**数据库优化：**

- 使用 PostgreSQL 的连接池（PgBouncer）
- 配置适当的连接数限制
- 定期清理过期的 catalog 实体
- 启用数据库备份和监控

**缓存策略：**

```yaml
# 使用 Redis 缓存 Backstage 的 catalog 查询
backend:
  cache:
    store: redis
    connection: redis://redis-backstage:6379
    defaultOptions:
      ttl: 3600000  # 1 hour
```

---

## 第八章：高级话题与最佳实践

### 8.1 模板版本管理与迁移

随着模板不断演进，需要管理模板版本并支持已生成服务的迁移：

```yaml
# 在 catalog-info.yaml 中追踪模板版本
metadata:
  annotations:
    backstage.io/source-template: laravel-microservice@v2.1.0
    backstage.io/template-generation-time: '2026-06-03T10:00:00Z'
```

当模板更新时，可以编写迁移脚本来批量更新已生成的服务：

```bash
#!/bin/bash
# scripts/migrate-template.sh
# 从旧版本模板迁移到新版本

TEMPLATE_VERSION="v2.1.0"
TEMPLATE_REPO="your-org/backstage-templates"

# 查询所有使用该模板的服务
SERVICES=$(curl -s "https://backstage.internal.company.com/api/catalog/entities" \
  -H "Authorization: Bearer ${BACKSTAGE_TOKEN}" \
  | jq -r '.[] | select(.metadata.annotations["backstage.io/source-template"] | startswith("laravel-microservice")) | .metadata.name')

for service in $SERVICES; do
  echo "Migrating service: $service"

  # 克隆服务仓库
  git clone "git@github.com:your-org/${service}.git" /tmp/$service

  # 应用模板更新（增量合并）
  cd /tmp/$service

  # 更新 Dockerfile
  cp "$TEMPLATE_REPO/templates/laravel-microservice/skeleton/docker/Dockerfile.tpl" \
     docker/Dockerfile

  # 更新 K8s manifests
  cp -r "$TEMPLATE_REPO/templates/laravel-microservice/skeleton/k8s/base/" \
     k8s/base/

  # 更新 CI/CD 配置
  cp "$TEMPLATE_REPO/templates/laravel-microservice/skeleton/.github/workflows/ci.yaml.tpl" \
     .github/workflows/ci.yaml

  # 更新模板版本注解
  yq -i '.metadata.annotations["backstage.io/source-template"] = "laravel-microservice@'$TEMPLATE_VERSION'"' \
     catalog-info.yaml

  # 提交并推送
  git add -A
  git commit -m "chore: upgrade template to $TEMPLATE_VERSION"
  git push origin main

  echo "✅ $service migrated to $TEMPLATE_VERSION"
done
```

### 8.2 多环境管理策略

在生产环境中，通常需要管理多个部署环境（开发、测试、预发布、生产）。以下是使用 Kustomize 实现的多环境管理方案：

```yaml
# k8s/overlays/staging/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: staging

resources:
  - ../../base

commonLabels:
  environment: staging

patches:
  - target:
      kind: Deployment
      name: REPLACE_WITH_SERVICE_NAME
    patch: |
      - op: replace
        path: /spec/replicas
        value: 2
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: APP_ENV
          value: staging
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: LOG_LEVEL
          value: debug

  - target:
      kind: HorizontalPodAutoscaler
      name: REPLACE_WITH_SERVICE_NAME
    patch: |
      - op: replace
        path: /spec/minReplicas
        value: 2
      - op: replace
        path: /spec/maxReplicas
        value: 5

configMapGenerator:
  - name: REPLACE_WITH_SERVICE_NAME-config
    behavior: merge
    literals:
      - APP_ENV=staging
      - APP_DEBUG=true
      - LOG_CHANNEL=structured
      - LOG_LEVEL=debug
```

```yaml
# k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: production

resources:
  - ../../base

commonLabels:
  environment: production

patches:
  - target:
      kind: Deployment
      name: REPLACE_WITH_SERVICE_NAME
    patch: |
      - op: replace
        path: /spec/replicas
        value: 3
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: APP_ENV
          value: production
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: LOG_LEVEL
          value: warning

  - target:
      kind: HorizontalPodAutoscaler
      name: REPLACE_WITH_SERVICE_NAME
    patch: |
      - op: replace
        path: /spec/minReplicas
        value: 3
      - op: replace
        path: /spec/maxReplicas
        value: 20

configMapGenerator:
  - name: REPLACE_WITH_SERVICE_NAME-config
    behavior: merge
    literals:
      - APP_ENV=production
      - APP_DEBUG=false
      - LOG_CHANNEL=structured
      - LOG_LEVEL=warning
```

### 8.3 安全最佳实践

在模板中嵌入安全最佳实践是平台工程的核心价值之一：

```yaml
# k8s/base/networkpolicy.yaml.tpl
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${{ values.name }}-netpol
  namespace: ${{ values.namespace }}
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: ${{ values.name }}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # 允许来自 Ingress Controller 的流量
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - port: 8080
          protocol: TCP

    # 允许来自 Prometheus 的抓取请求
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - port: 9145
          protocol: TCP

  egress:
    # 允许 DNS 查询
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP

    # 允许连接数据库
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: mysql
      ports:
        - port: 3306

    # 允许连接 Redis
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: redis
      ports:
        - port: 6379

    # 允许连接外部 API（根据需要调整）
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - port: 443
          protocol: TCP
```

### 8.4 GitOps 与持续部署

结合 ArgoCD 实现完整的 GitOps 工作流：

```yaml
# argocd/application.yaml.tpl
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${{ values.name }}
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: microservices

  source:
    repoURL: https://github.com/${{ values.repoUrl }}.git
    targetRevision: main
    path: k8s/overlays/${{ values.environment }}

  destination:
    server: https://kubernetes.default.svc
    namespace: ${{ values.namespace }}

  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
      - PruneLast=true
      - RespectIgnoreDifferences=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m

  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas  # 忽略 HPA 管理的副本数

  healthChecks:
    - group: apps
      kind: Deployment
      name: ${{ values.name }}
      namespace: ${{ values.namespace }}
```

---

## 第九章：Makefile 和本地开发体验

### 9.1 统一的 Makefile

为模板生成的项目提供统一的命令行接口：

```makefile
# Makefile.tpl
.PHONY: help dev build test deploy clean

# 默认目标
help: ## 显示帮助信息
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ===== 开发环境 =====
dev: ## 启动本地开发环境
	docker-compose up -d
	@echo "✅ 开发环境已启动"
	@echo "   🌐 应用: http://localhost:8080"
	@echo "   📊 Horizon: http://localhost:8080/horizon"
	@echo "   🔍 Telescope: http://localhost:8080/telescope"

dev-down: ## 停止本地开发环境
	docker-compose down

dev-logs: ## 查看开发环境日志
	docker-compose logs -f

dev-shell: ## 进入应用容器 Shell
	docker-compose exec app bash

# ===== 依赖管理 =====
install: ## 安装 Composer 依赖
	composer install

update: ## 更新依赖
	composer update

# ===== 代码质量 =====
lint: ## 运行代码风格检查
	vendor/bin/pint --test

lint-fix: ## 自动修复代码风格
	vendor/bin/pint

analyse: ## 运行静态分析
	vendor/bin/phpstan analyse

quality: lint analyse ## 运行所有代码质量检查

# ===== 测试 =====
test: ## 运行所有测试
	vendor/bin/pest

test-unit: ## 运行单元测试
	vendor/bin/pest --filter=Unit

test-feature: ## 运行功能测试
	vendor/bin/pest --filter=Feature

test-coverage: ## 生成测试覆盖率报告
	vendor/bin/pest --coverage --coverage-html=coverage-report
	@echo "✅ 覆盖率报告已生成: coverage-report/index.html"

# ===== 构建 =====
build: ## 构建 Docker 镜像
	docker build -t $${IMAGE_NAME:-$(APP_NAME)}:$${IMAGE_TAG:-latest} \
		-f docker/Dockerfile \
		--target web .

build-worker: ## 构建工作进程镜像
	docker build -t $${IMAGE_NAME:-$(APP_NAME)}:$${IMAGE_TAG:-latest}-worker \
		-f docker/Dockerfile \
		--target worker .

# ===== 部署 =====
deploy-staging: ## 部署到 Staging 环境
	@echo "🚀 部署到 Staging..."
	git push origin main
	@echo "✅ 已推送至 main 分支，ArgoCD 将自动部署"

deploy-production: ## 部署到生产环境
	@echo "🚀 部署到 Production..."
	git tag -a "v$$(date +%Y%m%d%H%M%S)" -m "Production release"
	git push origin --tags
	@echo "✅ 已创建生产标签"

# ===== 数据库 =====
migrate: ## 运行数据库迁移
	php artisan migrate

migrate-rollback: ## 回滚数据库迁移
	php artisan migrate:rollback

seed: ## 填充测试数据
	php artisan db:seed

# ===== 清理 =====
clean: ## 清理缓存和临时文件
	php artisan cache:clear
	php artisan config:clear
	php artisan route:clear
	php artisan view:clear
	rm -rf storage/logs/*.log

# ===== 监控 =====
metrics: ## 查看当前指标
	curl -s http://localhost:8080/api/v1/platform/status | jq .

health: ## 检查服务健康状态
	curl -s http://localhost:8080/api/v1/platform/health | jq .
```

---

## 第十章：总结与展望

### 10.1 核心价值回顾

通过本文的深度实践，我们构建了一套完整的平台工程解决方案。回顾整个方案的核心价值：

**效率提升：** 开发者通过 Backstage 模板自助创建 Laravel 微服务，从填写表单到代码仓库可用仅需 5 分钟，到首次部署到 Staging 环境仅需 20 分钟。相比传统的手工创建和配置流程，效率提升了 10 倍以上。

**标准化保障：** 每个微服务从诞生之初就遵循团队的最佳实践——统一的代码结构、容器化配置、Kubernetes 部署清单、CI/CD 流水线、监控告警和文档标准。这消除了技术栈碎片化问题，大幅降低了维护成本。

**安全左移：** 安全检查不再是在发布前的最后一道关卡，而是从服务创建的那一刻起就嵌入到整个生命周期中——依赖审计、SAST 扫描、容器镜像漏洞扫描、K8s 安全策略，形成了完整的安全防线。

**开发者体验：** 内部开发平台将复杂的技术栈抽象为友好的自助界面，开发者可以专注于业务逻辑的创新，而不必成为 Kubernetes、Prometheus、Jaeger 等基础设施工具的专家。

### 10.2 未来展望

平台工程仍处于快速演进中，以下趋势值得持续关注：

**AI 驱动的平台工程：** LLM 正在被集成到开发者门户中，帮助生成模板代码、自动诊断部署问题、智能推荐最佳实践。Backstage 社区已经在探索 AI 辅助的模板生成和智能搜索能力。

**eBPF 与无侵入式可观测性：** 传统的可观测性方案需要在应用代码中插桩，eBPF 技术使得我们可以在内核层面无侵入地收集网络通信、系统调用等数据，极大简化了微服务的可观测性集成。

**WebAssembly（Wasm）服务：** 随着 WASI 标准的成熟，WebAssembly 正在成为微服务的新兴运行时。平台工程需要提前为 Wasm 服务的模板和部署做好准备。

**平台即产品思维：** 越来越多的组织将内部开发平台视为产品来运营——有专门的产品经理收集用户需求、有定期的用户满意度调查、有清晰的路线图和版本发布计划。这种产品化思维确保平台真正服务于开发者，而不是成为另一个官僚化的工具。

### 10.3 行动建议

如果你正在考虑在组织中推行平台工程，以下是一些具体的起步建议：

1. **从痛点出发**：不要为了做平台工程而做平台工程。先识别开发团队面临的最大痛点——是创建新项目太慢？是部署流程太复杂？是监控告警不够完善？从最紧迫的问题开始。

2. **小步快跑**：不要试图一次性构建一个完美的平台。先实现最小可用的模板，让一两个团队试用，快速收集反馈并迭代。

3. **投资开发者体验**：平台团队的本质是产品团队，开发者是你的用户。投入时间去理解他们的工作流、痛点和需求。

4. **度量驱动**：建立清晰的度量体系，用数据说话。DORA 指标、开发者满意度（DX Score）、模板采用率等都是重要的衡量标准。

5. **建立社区**：平台工程不仅仅是工具和技术，更是文化和社区。建立内部的平台用户社区、定期举办分享会、编写丰富的文档和教程。

---

## 附录 A：平台工程工具与方案对比

| 维度 | 手工脚本 | Helm Chart | Backstage 模板 | Kratix / Crossplane |
|------|---------|------------|---------------|---------------------|
| 学习曲线 | 低 | 中 | 中高 | 高 |
| 标准化程度 | 低（依赖个人规范） | 中（Chart 模板） | 高（Golden Path 强制） | 高（声明式 CRD） |
| 自助体验 | 无（需运维介入） | 低（CLI 命令） | 高（GUI 表单 + 向导） | 中（kubectl / GitOps） |
| 可观测性集成 | 手动 | 手动或 Helm Hook | 模板内置 Prometheus/Jaeger | 需额外配置 |
| 文档自动化 | 无 | 无 | TechDocs 内置 | 无 |
| CI/CD 集成 | 手动 | 需额外配置 | 模板内置完整流水线 | 需 GitOps 搭配 |
| 适用规模 | 小团队 / POC | 中型团队 | 中大型团队 | 大型 / 多集群 |
| 典型工具 | Shell + Makefile | Helm + ArgoCD | Backstage + Cookiecutter | Kratix + Crossplane + ArgoCD |

> **选型建议：** 对于 20-100 人的 Laravel 团队，Backstage 模板是性价比最高的选择——它在自助体验和标准化之间取得了最佳平衡，且社区生态活跃、插件丰富。如果团队已经在使用 Kubernetes 且需要更深度的基础设施编排，可以考虑 Backstage + Crossplane 的组合方案。

---

## 附录：相关资源

- [Backstage 官方文档](https://backstage.io/docs/)
- [Platform Engineering 官网](https://platformengineering.org/)
- [CNCF Platform White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [Team Topologies](https://teamtopologies.com/) - 组织架构设计参考
- [Laravel 官方文档](https://laravel.com/docs)
- [Kubernetes 文档](https://kubernetes.io/docs/home/)
- [ArgoCD 文档](https://argo-cd.readthedocs.io/)
- [OpenTelemetry 文档](https://opentelemetry.io/docs/)

---

*本文是 Platform Engineering 实战系列的第一篇，后续将深入探讨更多高级主题，包括多集群管理、服务网格集成、混沌工程实践、FinOps 成本管理等。欢迎关注和讨论。*

---

## 相关阅读

- [Laravel Modular Monolith 实战：模块化单体架构——介于单体与微服务之间的最佳平衡点](/categories/架构/2026-06-04-Laravel-Modular-Monolith-实战-模块化单体架构-介于单体与微服务之间的最佳平衡点/)
- [Saga 编排模式深度实战：Laravel 分布式事务的三种实现路线对比](/categories/架构/2026-06-05-Saga-编排模式深度实战-Choreography-Orchestration-Temporal-Laravel分布式事务三种实现路线对比/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
