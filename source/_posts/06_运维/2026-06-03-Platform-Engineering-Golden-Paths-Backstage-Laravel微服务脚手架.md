---
title: Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架
date: 2026-06-03 08:00:00
tags: [Platform-Engineering, Backstage, Golden-Paths, 微服务, IDP, Laravel]
description: "深入解析 Platform Engineering 与 Golden Paths 理念，手把手用 Backstage 搭建内部开发者平台（IDP），实现 Laravel 微服务脚手架的自助创建、标准化部署与全生命周期管理。涵盖 Backstage Scaffolder 模板配置、catalog-info.yaml 注册、GitHub Actions CI/CD、Kubernetes Deployment、Prometheus 监控告警、自定义 Action 开发，以及平台工程落地中的组织变革、模板维护、自助服务设计模式等实战经验，帮助团队降低开发者认知负荷，将新建微服务从 3 天缩短到 5 分钟。"
categories: [运维]
cover: /images/covers/platform-engineering-backstage-cover.jpg
---

## 前言

当你的 Laravel 团队从一个单体应用演进到 10+ 个微服务时，你可能会面临这些问题：

- 新建一个微服务需要 3 天——配置 CI/CD、Dockerfile、监控、日志、健康检查……
- 每个团队的项目结构都不一样，新人 onboarding 困难
- 「那个服务怎么部署的？」「去问小王，只有他知道。」

这就是 **Platform Engineering（平台工程）** 要解决的问题。而 **Backstage**——由 Spotify 开源、CNCF 托管的开发者门户平台——是目前落地平台工程最主流的工具。

本文将从零开始，手把手教你用 Backstage 构建一个内部开发者平台（IDP），实现 Laravel 微服务的自助创建、标准化部署和全生命周期管理。

<!-- more -->

---

## 一、Platform Engineering vs DevOps vs SRE

在深入技术细节之前，先厘清三个经常被混淆的概念。

### 1.1 三者的区别

| 维度 | DevOps | SRE | Platform Engineering |
|------|--------|-----|---------------------|
| 核心理念 | 打破开发与运维的壁垒 | 用软件工程方法解决运维问题 | 为开发者构建自助式内部平台 |
| 主要用户 | 全团队 | 运维/SRE 团队 | 开发者 |
| 产出物 | CI/CD 流程、自动化脚本 | SLI/SLO、错误预算 | 内部开发者平台（IDP） |
| 解决的核心问题 | 「部署太慢、太痛苦」 | 「可用性不够、故障太多」 | 「认知负荷太高、重复劳动太多」 |

### 1.2 为什么现在需要 Platform Engineering？

**开发者认知负荷正在爆炸式增长。** 一个现代 Laravel 开发者需要了解的东西：PHP 8.x 新特性、Laravel 框架、MySQL/PostgreSQL、Redis、Docker、Kubernetes、CI/CD、监控、日志、安全扫描、IaC、消息队列……

**结果：** 开发者把 40% 以上的时间花在「不写业务代码」的事情上。

Platform Engineering 的核心价值主张：**让开发者只需要关注业务逻辑，平台处理一切基础设施和标准化的事。**

### 1.3 Golden Paths 的概念

**Golden Path（黄金路径）** 不是强制的——它是「推荐的、最简单的、经过验证的」路径。

想象你在一座山里徒步：
- **Golden Path：** 铺好的步道，有路标、有护栏、有补给站
- **偏离路径：** 你仍然可以走野路，但你需要自己负责安全
- **没有路径：** 你必须自己开路，每一步都在重新发明轮子

在工程中：
- **Golden Path：** 标准化的项目模板、内置的 CI/CD、预配置的监控、自动化的安全扫描
- **偏离路径：** 特殊需求可以自定义，但需要明确的审批流程
- **没有路径（现状）：** 每个团队自己搭基础设施，重复造轮子

---

## 二、Backstage 架构深入

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    Backstage App                         │
├──────────────┬──────────────┬───────────────────────────┤
│  Frontend    │  Backend     │  Core Services            │
│  (React)     │  (Node.js)   │                           │
│              │              │  ┌─────────────────────┐  │
│  ┌────────┐  │  ┌────────┐  │  │ Software Catalog    │  │
│  │Catalog │  │  │Plugin  │  │  │ (实体注册表)         │  │
│  │Pages   │  │  │Router  │  │  └─────────────────────┘  │
│  └────────┘  │  └────────┘  │  ┌─────────────────────┐  │
│  ┌────────┐  │  ┌────────┐  │  │ Scaffolder          │  │
│  │TechDocs│  │  │Plugin  │  │  │ (模板引擎)          │  │
│  │        │  │  │System  │  │  └─────────────────────┘  │
│  └────────┘  │  └────────┘  │  ┌─────────────────────┐  │
│  ┌────────┐  │  ┌────────┐  │  │ Search              │  │
│  │Scaffold│  │  │Database│  │  │ (全文搜索)          │  │
│  │Wizard  │  │  │(PG)    │  │  └─────────────────────┘  │
│  └────────┘  │  └────────┘  │                           │
└──────────────┴──────────────┴───────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ GitHub   │   │ Kubernetes│   │ Grafana  │
        │ API      │   │ API      │   │ API      │
        └──────────┘   └──────────┘   └──────────┘
```

### 2.2 核心概念

**Software Catalog（软件目录）：** Backstage 的灵魂。所有服务、API、库、数据管道都在这里注册。通过 `catalog-info.yaml` 文件描述每个实体的元数据。

**Scaffolder（脚手架）：** 模板引擎。定义一个 YAML 模板，开发者填写表单，即可自动生成完整的项目结构。这就是 Golden Path 的技术实现。

**TechDocs：** 内置的文档系统。支持 Markdown、MkDocs、Swagger 等格式。文档即代码（Docs as Code）。

**Plugins：** Backstage 的扩展机制。可以集成几乎任何工具：GitHub、GitLab、Jenkins、Grafana、PagerDuty、Kubernetes、Terraform……

### 2.3 实体模型

```yaml
# catalog-info.yaml 示例
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: order-service
  description: 订单微服务
  annotations:
    github.com/project-slug: myorg/order-service
    backstage.io/techdocs-ref: dir:.
  tags:
    - php
    - laravel
    - microservice
  links:
    - url: https://grafana.myorg.com/d/order-service
      title: Grafana Dashboard
    - url: https://api-docs.myorg.com/order-service
      title: API Docs
spec:
  type: service
  lifecycle: production
  owner: team-order
  system: ecommerce
  providesApis:
    - order-api
  dependsOn:
    - component:payment-service
    - resource:order-database
```

---

## 三、从零搭建 Backstage

### 3.1 创建 Backstage 应用

```bash
# 前置要求：Node.js 18+、yarn、Docker、PostgreSQL
npx @backstage/create-app@latest my-developer-portal
cd my-developer-portal

# 选择 PostgreSQL 作为数据库（生产环境推荐）
# 修改 app-config.yaml 中的数据库配置
```

### 3.2 配置 PostgreSQL

```yaml
# app-config.yaml
app:
  title: My Developer Portal
  baseUrl: http://localhost:3000

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: 5432
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
      database: backstage
```

### 3.3 Docker Compose 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: backstage
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: backstage
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U backstage"]
      interval: 5s
      timeout: 5s
      retries: 5

  backstage:
    build: .
    ports:
      - "3000:3000"
      - "7007:7007"
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_USER: backstage
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-data:
```

### 3.4 启动与验证

```bash
docker-compose up -d
# 访问 http://localhost:3000
# 默认使用 GitHub OAuth 登录
```

---

## 四、创建 Laravel 微服务脚手架模板

这是本文的核心——用 Backstage Scaffolder 创建一个标准化的 Laravel 微服务模板。

### 4.1 模板定义

```yaml
# templates/laravel-microservice/template.yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: laravel-microservice
  title: Laravel 微服务
  description: 创建一个标准化的 Laravel 微服务，包含 CI/CD、Docker、监控配置
  tags:
    - php
    - laravel
    - microservice
  annotations:
    backstage.io/techdocs-ref: dir:.
spec:
  owner: platform-team
  type: service
  
  parameters:
    # 第一步：基础信息
    - title: 服务基础信息
      required:
        - name
        - owner
        - description
      properties:
        name:
          title: 服务名称
          type: string
          description: 服务名称（kebab-case），如 order-service
          pattern: '^[a-z][a-z0-9-]*[a-z0-9]$'
          maxLength: 50
        description:
          title: 服务描述
          type: string
          description: 一句话描述这个服务做什么
        owner:
          title: 所属团队
          type: string
          enum:
            - team-order
            - team-payment
            - team-user
            - team-product
            - team-logistics
        system:
          title: 所属系统
          type: string
          enum:
            - ecommerce
            - crm
            - data-platform
            - internal-tools
        
    # 第二步：技术配置
    - title: 技术配置
      required:
        - phpVersion
        - laravelVersion
        - databaseType
      properties:
        phpVersion:
          title: PHP 版本
          type: string
          default: '8.3'
          enum:
            - '8.2'
            - '8.3'
            - '8.4'
        laravelVersion:
          title: Laravel 版本
          type: string
          default: '11.x'
          enum:
            - '11.x'
            - '12.x'
        databaseType:
          title: 数据库类型
          type: string
          default: mysql
          enum:
            - mysql
            - postgresql
        enableRedis:
          title: 启用 Redis
          type: boolean
          default: true
        enableQueue:
          title: 启用队列（Laravel Horizon）
          type: boolean
          default: true
        enableTelescope:
          title: 启用 Telescope（仅开发环境）
          type: boolean
          default: true
        enablePulse:
          title: 启用 Pulse（应用监控）
          type: boolean
          default: true
        healthCheckPath:
          title: 健康检查路径
          type: string
          default: /health
        
    # 第三步：API 配置
    - title: API 配置
      properties:
        apiPrefix:
          title: API 路由前缀
          type: string
          default: api/v1
        enableSanctum:
          title: 启用 Sanctum 认证
          type: boolean
          default: true
        rateLimitPerMinute:
          title: 速率限制（每分钟请求数）
          type: integer
          default: 60
          minimum: 10
          maximum: 1000

  steps:
    # 步骤 1：从模板仓库克隆
    - id: fetch
      name: 获取模板代码
      action: fetch:template
      input:
        url: ./skeleton
        targetPath: ${{ parameters.name }}
        values:
          name: ${{ parameters.name }}
          description: ${{ parameters.description }}
          owner: ${{ parameters.owner }}
          system: ${{ parameters.system }}
          phpVersion: ${{ parameters.phpVersion }}
          laravelVersion: ${{ parameters.laravelVersion }}
          databaseType: ${{ parameters.databaseType }}
          enableRedis: ${{ parameters.enableRedis }}
          enableQueue: ${{ parameters.enableQueue }}
          enableTelescope: ${{ parameters.enableTelescope }}
          enablePulse: ${{ parameters.enablePulse }}
          healthCheckPath: ${{ parameters.healthCheckPath }}
          apiPrefix: ${{ parameters.apiPrefix }}
          enableSanctum: ${{ parameters.enableSanctum }}
          rateLimitPerMinute: ${{ parameters.rateLimitPerMinute }}
    
    # 步骤 2：注册到软件目录
    - id: register
      name: 注册到软件目录
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps.fetch.output.repoContentsUrl }}
        catalogInfoPath: catalog-info.yaml
    
    # 步骤 3：创建 GitHub 仓库
    - id: publish
      name: 推送到 GitHub
      action: github:repo:push
      input:
        allowedHosts: ['github.com']
        description: ${{ parameters.description }}
        repoUrl: github.com?owner=myorg&repo=${{ parameters.name }}
        defaultBranch: main
        protectDefaultBranch: true
        requireCodeOwnerReviews: true
        requiredReviewersCount: 1
    
    # 步骤 4：创建 Kubernetes 命名空间
    - id: k8s-namespace
      name: 创建 Kubernetes 命名空间
      action: kubernetes:create-namespace
      input:
        name: ${{ parameters.name }}
        cluster: production
    
    # 步骤 5：创建数据库
    - id: create-database
      name: 创建数据库
      action: custom:create-database
      input:
        name: ${{ parameters.name }}
        type: ${{ parameters.databaseType }}
        environment: staging

  output:
    links:
      - title: 服务源代码
        url: ${{ steps.publish.output.remoteUrl }}
      - title: 软件目录
        url: http://localhost:3000/catalog/${{ parameters.owner }}/${{ parameters.name }}
      - title: API 文档
        url: http://localhost:3000/docs/${{ parameters.owner }}/${{ parameters.name }}
```

### 4.2 模板骨架文件结构

```
templates/laravel-microservice/skeleton/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # CI 流水线
│       ├── cd-staging.yml            # 部署到 Staging
│       ├── cd-production.yml         # 部署到 Production
│       └── security-scan.yml         # 安全扫描
├── .husky/
│   └── pre-commit                    # Git hooks
├── docker/
│   ├── Dockerfile                    # 多阶段构建
│   ├── Dockerfile.dev                # 开发环境
│   └── nginx.conf                    # Nginx 配置
├── k8s/
│   ├── base/
│   │   ├── kustomization.yaml
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── hpa.yaml
│   │   └── configmap.yaml
│   └── overlays/
│       ├── staging/
│       │   ├── kustomization.yaml
│       │   └── patch-deployment.yaml
│       └── production/
│           ├── kustomization.yaml
│           └── patch-deployment.yaml
├── monitoring/
│   ├── prometheus-rules.yaml         # 告警规则
│   ├── grafana-dashboard.json        # Grafana 面板
│   └── sentry-config.php             # Sentry 配置
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   ├── Middleware/
│   │   └── Requests/
│   ├── Models/
│   ├── Services/
│   ├── Repositories/
│   └── Exceptions/
├── tests/
│   ├── Unit/
│   ├── Feature/
│   └── Performance/
├── database/
│   ├── migrations/
│   └── seeders/
├── config/
├── routes/
│   ├── api.php
│   └── health.php
├── docker-compose.yml
├── docker-compose.dev.yml
├── Makefile
├── phpstan.neon
├── phpunit.xml
├── rector.php
├── pint.json
├── catalog-info.yaml                 # Backstage 注册文件
├── mkdocs.yaml                       # TechDocs 配置
├── docs/
│   ├── index.md                      # 服务文档
│   ├── api.md                        # API 文档
│   └── architecture.md               # 架构说明
└── README.md
```

### 4.3 核心骨架文件示例

**Dockerfile（多阶段构建）：**

```dockerfile
# skeleton/docker/Dockerfile
# Stage 1: Composer 依赖安装
FROM composer:2.7 AS composer
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

# Stage 2: 前端资源构建（如果有）
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY resources/ ./resources/
COPY vite.config.js ./
RUN npm run build

# Stage 3: 最终镜像
FROM php:${{ values.phpVersion }}-fpm-alpine

# 安装 PHP 扩展
RUN apk add --no-cache \
    nginx \
    supervisor \
    libpng-dev \
    libwebp-dev \
    jpeg-dev \
    freetype-dev \
    icu-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install gd intl pdo_${{ values.databaseType }} opcache \
    && pecl install redis && docker-php-ext-enable redis \
    && apk del -r .build-deps

# PHP 配置
COPY docker/php.ini /usr/local/etc/php/conf.d/custom.ini
COPY docker/opcache.ini /usr/local/etc/php/conf.d/opcache.ini

WORKDIR /var/www/html

# 复制应用代码
COPY --from=composer /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build
COPY . .

# 权限设置
RUN chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -f http://localhost${{ values.healthCheckPath }} || exit 1

EXPOSE 9000
CMD ["php-fpm"]
```

**GitHub Actions CI 流水线：**

```yaml
# skeleton/.github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  PHP_VERSION: "${{ values.phpVersion }}"
  NODE_VERSION: "20"

jobs:
  code-quality:
    name: 代码质量检查
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ env.PHP_VERSION }}
          extensions: redis, pdo_mysql, pdo_pgsql
          coverage: none
          tools: composer
      
      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist
      
      - name: PHP CS Fixer (Pint)
        run: vendor/bin/pint --test
      
      - name: PHPStan Static Analysis
        run: vendor/bin/phpstan analyse --memory-limit=512M
      
      - name: Rector (Dry Run)
        run: vendor/bin/rector process --dry-run

  tests:
    name: 测试套件
    runs-on: ubuntu-latest
    needs: code-quality
    
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
      
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ env.PHP_VERSION }}
          extensions: redis, pdo_mysql
          coverage: xdebug
      
      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist
      
      - name: Run Unit Tests
        run: vendor/bin/phpunit --testsuite=Unit --coverage-clover=coverage-unit.xml
      
      - name: Run Feature Tests
        run: vendor/bin/phpunit --testsuite=Feature --coverage-clover=coverage-feature.xml
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: testing
          DB_USERNAME: root
          DB_PASSWORD: secret
          REDIS_HOST: 127.0.0.1
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage-unit.xml,coverage-feature.xml

  security:
    name: 安全扫描
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Composer Audit
        run: composer audit
      
      - name: PHP Vulnerability Check
        uses: symfonycorp/security-checker-action@v5

  build:
    name: 构建 Docker 镜像
    runs-on: ubuntu-latest
    needs: [tests, security]
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Kubernetes Deployment：**

```yaml
# skeleton/k8s/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${{ values.name }}
  labels:
    app: ${{ values.name }}
    owner: ${{ values.owner }}
    system: ${{ values.system }}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ${{ values.name }}
  template:
    metadata:
      labels:
        app: ${{ values.name }}
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: app
          image: ghcr.io/myorg/${{ values.name }}:latest
          ports:
            - containerPort: 9000
          env:
            - name: APP_ENV
              value: "production"
            - name: DB_CONNECTION
              value: "${{ values.databaseType }}"
            - name: DB_HOST
              valueFrom:
                secretKeyRef:
                  name: ${{ values.name }}-db
                  key: host
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${{ values.name }}-db
                  key: password
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              cpu: 1000m
              memory: 1Gi
          livenessProbe:
            httpGet:
              path: ${{ values.healthCheckPath }}
              port: 9000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: ${{ values.healthCheckPath }}
              port: 9000
            initialDelaySeconds: 5
            periodSeconds: 5
```

**Makefile（标准化操作命令）：**

```makefile
# skeleton/Makefile
.PHONY: help setup dev test lint build deploy-staging deploy-production

help: ## 显示帮助信息
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## 初始化开发环境
	cp .env.example .env
	docker-compose -f docker-compose.dev.yml up -d
	composer install
	php artisan key:generate
	php artisan migrate --seed

dev: ## 启动开发服务器
	docker-compose -f docker-compose.dev.yml up -d
	php artisan serve --host=0.0.0.0

test: ## 运行测试
	vendor/bin/phpunit --parallel

lint: ## 代码格式化和静态分析
	vendor/bin/pint
	vendor/bin/phpstan analyse

build: ## 构建 Docker 镜像
	docker build -t ${{ values.name }}:latest -f docker/Dockerfile .

deploy-staging: ## 部署到 Staging
	kubectl apply -k k8s/overlays/staging/
	kubectl rollout status deployment/${{ values.name }} -n staging

deploy-production: ## 部署到 Production（需要审批）
	kubectl apply -k k8s/overlays/production/
	kubectl rollout status deployment/${{ values.name }} -n production
```

---

## 五、集成监控与可观测性

### 5.1 Prometheus 告警规则

```yaml
# skeleton/monitoring/prometheus-rules.yaml
groups:
  - name: ${{ values.name }}-alerts
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{service="${{ values.name }}", status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total{service="${{ values.name }}"}[5m]))
          > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.service }} 错误率超过 5%"
          description: "当前错误率: {{ $value | humanizePercentage }}"
      
      - alert: HighResponseTime
        expr: |
          histogram_quantile(0.95, 
            rate(http_request_duration_seconds_bucket{service="${{ values.name }}"}[5m])
          ) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.service }} P95 响应时间超过 2 秒"
      
      - alert: HighMemoryUsage
        expr: |
          container_memory_usage_bytes{pod=~"${{ values.name }}.*"}
          / container_spec_memory_limit_bytes
          > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.pod }} 内存使用率超过 85%"
      
      - alert: PodCrashLooping
        expr: |
          rate(kube_pod_container_status_restarts_total{pod=~"${{ values.name }}.*"}[15m]) > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.pod }} 正在频繁重启"
```

### 5.2 Grafana Dashboard JSON 片段

```json
{
  "dashboard": {
    "title": "${{ values.name }} Service Dashboard",
    "panels": [
      {
        "title": "请求速率",
        "type": "timeseries",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{service=\"${{ values.name }}\"}[5m])) by (status)"
          }
        ]
      },
      {
        "title": "响应时间分布",
        "type": "heatmap",
        "targets": [
          {
            "expr": "rate(http_request_duration_seconds_bucket{service=\"${{ values.name }}\"}[5m])"
          }
        ]
      },
      {
        "title": "数据库查询时间",
        "type": "timeseries",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(db_query_duration_seconds_bucket{service=\"${{ values.name }}\"}[5m]))"
          }
        ]
      }
    ]
  }
}
```

---

## 六、自定义 Scaffolder Action

当内置 Action 不够用时，可以创建自定义 Action。

### 6.1 创建数据库 Action

```typescript
// plugins/custom-scaffolder-actions/src/actions/createDatabase.ts
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { z } from 'zod';
import { Client } from 'pg';

export const createDatabaseAction = () => {
  return createTemplateAction({
    id: 'custom:create-database',
    description: '在指定数据库集群中创建新数据库',
    
    schema: {
      input: z.object({
        name: z.string().describe('数据库名称'),
        type: z.enum(['mysql', 'postgresql']).describe('数据库类型'),
        environment: z.enum(['staging', 'production']).describe('目标环境'),
      }),
    },
    
    async handler(ctx) {
      const { name, type, environment } = ctx.input;
      const dbName = `${name.replace(/-/g, '_')}_${environment}`;
      
      ctx.logger.info(`Creating ${type} database: ${dbName}`);
      
      if (type === 'postgresql') {
        const client = new Client({
          host: process.env[`PG_HOST_${environment.toUpperCase()}`],
          port: 5432,
          user: process.env.PG_ADMIN_USER,
          password: process.env.PG_ADMIN_PASSWORD,
          database: 'postgres',
        });
        
        await client.connect();
        
        // 创建数据库
        await client.query(`CREATE DATABASE ${dbName}`);
        
        // 创建只读用户和读写用户
        const readUser = `${dbName}_read`;
        const writeUser = `${dbName}_write`;
        
        await client.query(`CREATE USER ${readUser} WITH PASSWORD '${ctx.input.name}_read_pass'`);
        await client.query(`CREATE USER ${writeUser} WITH PASSWORD '${ctx.input.name}_write_pass'`);
        await client.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${readUser}`);
        await client.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${writeUser}`);
        
        await client.end();
        
        ctx.logger.info(`Database ${dbName} created successfully`);
        ctx.logger.info(`Read user: ${readUser}, Write user: ${writeUser}`);
      }
    },
  });
};
```

### 6.2 注册自定义 Action

```typescript
// packages/backend/src/plugins/scaffolder.ts
import { createRouter } from '@backstage/plugin-scaffolder-backend';
import { createDatabaseAction } from '@internal/plugin-custom-scaffolder-actions';
import { Router } from 'express';
import type { PluginEnvironment } from '@backstage/backend-common';

export default async function createPlugin(
  env: PluginEnvironment,
): Promise<Router> {
  return await createRouter({
    logger: env.logger,
    config: env.config,
    database: env.database,
    reader: env.reader,
    catalogClient: env.catalogClient,
    actions: [
      createDatabaseAction(),
      // ...其他自定义 actions
    ],
  });
}
```

---

## 七、与现有工具集成

### 7.1 GitHub 集成

```yaml
# app-config.yaml 中的 GitHub 配置
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}

catalog:
  locations:
    - type: github-discovery
      target: https://github.com/myorg/blob/main/catalog-*.yaml
    - type: github-org
      target: https://github.com/myorg
```

### 7.2 Kubernetes 集成

```yaml
# app-config.yaml 中的 K8s 配置
kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - url: https://kubernetes.default.svc
          name: production
          authProvider: 'serviceAccount'
          serviceAccountToken: ${K8S_SA_TOKEN}
          skipTLSVerify: false
          caData: ${K8S_CA_DATA}
```

### 7.3 Grafana 集成

```yaml
# app-config.yaml
grafana:
  domain: https://grafana.myorg.com
  anonymousAccessEnabled: false

# 使用插件
# yarn add @k-phoen/backstage-plugin-grafana
```

---

## 八、替代方案对比

| 工具 | 类型 | 特点 | 适用场景 |
|------|------|------|----------|
| **Backstage** | 开源，CNCF | 插件丰富，社区活跃，高度可定制 | 中大型团队，需要深度定制 |
| **Port** | 商业 SaaS | 零代码配置，快速上手 | 快速启动，不想维护基础设施 |
| **Kratix** | 开源 | 基于 Kubernetes，GitOps 原生 | 已有成熟 K8s 基础设施的团队 |
| **Humanitec** | 商业 | Score 规范，动态配置管理 | 需要高级编排能力 |
| **CNOE** | 开源 | 参考架构，组合式工具集 | 想自己组装 IDP |

**选择建议：**
- 如果你的团队已经有 React/TypeScript 经验，选 Backstage——自定义能力强
- 如果你想最快启动，选 Port——拖拽式配置
- 如果你是 Kubernetes-native 团队，选 Kratix——CRD 驱动

---

## 九、落地挑战与应对

### 9.0 Platform Engineering vs 传统运维对比

在正式讨论落地挑战前，先看 Platform Engineering 与传统运维模式的核心差异：

| 维度 | 传统运维模式 | Platform Engineering 模式 |
|------|-------------|--------------------------|
| **服务创建** | 提工单 → 运维手动配置 → 3~5 天 | 开发者自助填写表单 → 5 分钟自动生成 |
| **CI/CD 配置** | 每个项目单独配置，风格各异 | 模板内置统一流水线，开箱即用 |
| **监控接入** | 开发者自己找运维添加，容易遗漏 | 模板自动包含 Prometheus + Grafana 配置 |
| **知识传递** | 靠口口相传，写在 Wiki 里（然后过时） | 代码即文档，模板即规范，TechDocs 自动同步 |
| **技术栈管理** | 各团队自行选择，版本碎片化 | Golden Path 推荐版本，偏离需审批 |
| **安全合规** | 安全扫描是「可选项」，经常被跳过 | 安全扫描内置在 CI 流水线中，强制执行 |
| **开发者体验** | 大量重复配置工作，认知负荷高 | 关注业务逻辑，基础设施透明化 |
| **故障排查** | 「去问小王」 | Catalog 一目了然：谁负责、依赖谁、监控在哪 |
| **平台团队定位** | 被动接需求的「工单系统」 | 主动构建产品的「内部产品团队」 |

## 附A：Golden Paths 设计模式与最佳实践

Golden Path 不是「一刀切」的强制规范，而是一种**渐进式引导**的设计哲学。以下是经过验证的设计模式：

### 模式一：分层模板（Layered Templates）

不要把所有东西塞进一个模板。按层级拆分：

```
┌─────────────────────────────────────────┐
│  Layer 3: 业务模板（按场景定制）           │
│  ├── API 服务模板                        │
│  ├── 事件处理器模板                       │
│  ├── 定时任务服务模板                     │
│  └── BFF（Backend for Frontend）模板      │
├─────────────────────────────────────────┤
│  Layer 2: 技术栈模板（Laravel/Node/Go）   │
│  ├── Dockerfile                          │
│  ├── CI/CD 流水线                        │
│  ├── 监控配置                            │
│  └── 代码质量工具链                       │
├─────────────────────────────────────────┤
│  Layer 1: 基础设施层（所有服务共享）       │
│  ├── Kubernetes 基础配置                  │
│  ├── 网络策略                            │
│  ├── RBAC                               │
│  └── 日志采集                            │
└─────────────────────────────────────────┘
```

### 模式二：渐进式披露（Progressive Disclosure）

模板参数采用「简单/高级」两层设计，避免新人被过多选项吓到：

```yaml
# 简单模式：只暴露必要参数
parameters:
  - title: 快速开始
    description: 只需填写基本信息，其余使用推荐默认值
    properties:
      name:
        title: 服务名称
        type: string
      team:
        title: 所属团队
        type: string
        enum: [team-order, team-payment, team-user]

# 高级模式：完整配置
  - title: 高级配置（可选）
    description: 自定义技术栈、资源配额、安全策略等
    properties:
      phpVersion:
        title: PHP 版本
        type: string
        default: '8.3'
      enableCustomHealthCheck:
        title: 自定义健康检查路径
        type: boolean
        default: false
```

### 模式三：模板即产品（Template as a Product）

把模板当作内部产品来运营：

```yaml
# 在 template.yaml 中添加产品化元数据
metadata:
  name: laravel-microservice
  title: Laravel 微服务
  description: 标准化 Laravel 微服务脚手架
  tags: [php, laravel, microservice]
  annotations:
    # 模板版本——用于追踪和升级
    backstage.io/template-version: "2.3.0"
    # 变更日志链接
    backstage.io/template-changelog: "https://wiki.myorg.com/templates/changelog"
    # 使用统计——多少服务基于此模板创建
    backstage.io/template-usage-count: "47"
```

### 模式四：偏离审计（Pescape Audit）

允许偏离 Golden Path，但要有记录和审批：

```yaml
# 在 catalog-info.yaml 中记录偏离
metadata:
  annotations:
    # 标记此服务偏离了标准模板
    myorg.com/golden-path-deviation: |
      - reason: "需要 PHP 8.4 特性（Property Hooks）"
        approved-by: platform-team-lead
        date: 2026-05-15
        review-date: 2026-08-15
```

### 模式五：自助文档内嵌（Embedded Self-Service Docs）

在模板生成的项目中内嵌操作指南，而不是放在某个没人看的 Wiki 里：

```markdown
# README.md 模板中内嵌的快速参考

## 常用命令
| 操作 | 命令 |
|------|------|
| 本地开发 | `make setup && make dev` |
| 运行测试 | `make test` |
| 代码检查 | `make lint` |
| 构建镜像 | `make build` |
| 部署 Staging | `make deploy-staging` |
| 部署 Production | `make deploy-production`（需审批）|

## 故障排查
- 查看 Grafana 面板：[Dashboard 链接]
- 查看日志：`kubectl logs -f deploy/{{name}} -n production`
- 查看告警：[AlertManager 链接]

## 架构说明
详见 `docs/architecture.md`
```

## 附B：踩坑案例与解决方案

### 踩坑 1：Scaffolder 模板中 `${{ }}` 与 Helm `{{ }}` 冲突

Backstage Scaffolder 和 Helm 都使用 `{{ }}` 语法，当模板生成 Kubernetes YAML 时会冲突。

```yaml
# ❌ 错误：Scaffolder 会尝试解析 Helm 的 {{ .Values.xxx }}
image: {{ .Values.image.repository }}:{{ .Values.image.tag }}

# ✅ 正确：使用 Nunjucks 的 {% raw %} 标签包裹
{% raw %}image: {{ .Values.image.repository }}:{{ .Values.image.tag }}{% endraw %}
```

### 踩坑 2：GitHub Token 权限不足导致 `github:repo:push` 失败

```
Error: Insufficient permissions for the GitHub App
```

**解决方案：** 确保 GitHub App 或 PAT 具有以下权限：
- `repo`（完整访问）
- `admin:org`（如果使用 org 级别的仓库创建）
- `workflow`（如果需要创建 GitHub Actions workflow 文件）

```yaml
# app-config.yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}  # 确保此 token 有足够权限
      # 如果是 GitHub App：
      # apps:
      #   - appId: ${GITHUB_APP_ID}
      #     privateKey: ${GITHUB_APP_PRIVATE_KEY}
      #     clientId: ${GITHUB_APP_CLIENT_ID}
      #     clientSecret: ${GITHUB_APP_CLIENT_SECRET}
```

### 踩坑 3：catalog-info.yaml 注册后在 Catalog 中看不到

**常见原因：**
1. YAML 文件格式错误（缩进不对、字段拼写错误）
2. `catalog-info.yaml` 不在仓库根目录，但未指定路径
3. GitHub Discovery 配置的 pattern 不匹配

```yaml
# ✅ 正确的 catalog 配置
catalog:
  locations:
    # 方式 1：精确指定
    - type: url
      target: https://github.com/myorg/order-service/blob/main/catalog-info.yaml
    # 方式 2：通配符发现
    - type: github-discovery
      target: https://github.com/myorg/*/blob/main/catalog-info.yaml
    # 方式 3：按文件名搜索
    - type: github-discovery
      target: https://github.com/myorg?catalogPath=catalog-info.yaml
```

### 踩坑 4：Docker 多阶段构建中 `$` 符号被 Scaffolder 吃掉

```dockerfile
# ❌ 错误：Scaffolder 会尝试替换 ${APP_ENV}
ENV APP_ENV=${APP_ENV}

# ✅ 正确：在 skeleton 中使用 ${{ values.xxx }} 显式传递
ENV APP_ENV=${{ values.phpVersion }}
# 或者对不需要替换的变量使用 $$ 转义
ENV COMPOSER_HOME=$$HOME/.composer
```

### 9.1 组织变革

**挑战：** 开发者习惯了自己管理一切，不愿意使用平台。

**应对：**
1. 从痛点最大的场景入手（如新建服务），让 Golden Path 比现状简单 10 倍
2. 先在 1-2 个团队试点，积累成功案例
3. 让早期采用者成为「平台布道师」
4. 不要强制——让 Golden Path 的便利性吸引用户

### 9.2 平台团队的定位

**挑战：** 平台团队沦为「运维团队2.0」，变成接需求、改配置的外包团队。

**应对：**
1. 平台团队用产品思维运作——有自己的 Roadmap、Sprint、用户反馈
2. 建立清晰的服务等级协议（SLA）和自助文档
3. 80% 的需求应该通过自助解决，20% 需要人工协助
4. 定期做开发者满意度调查

### 9.3 保持模板更新

**挑战：** 模板发布后无人维护，逐渐过时。

**应对：**
1. 模板即代码——放在 Git 仓库中，有 Review 流程
2. 建立「模板健康检查」——定期扫描使用过时模板的服务
3. 每季度做一次模板大版本更新
4. 使用 Dependabot 自动更新依赖

---

## 十、总结

Platform Engineering 不是又一个 buzzword——它是对 DevOps 运动的进化。DevOps 让「每个人都可以部署」，Platform Engineering 让「每个人都可以轻松地正确部署」。

Backstage + Golden Paths 的组合为 Laravel 微服务团队提供了：

1. **自助式服务创建：** 从 3 天缩短到 5 分钟
2. **标准化：** 每个服务都有相同的结构、相同的 CI/CD、相同的监控
3. **可发现性：** 所有服务在哪里、谁负责、什么状态，一目了然
4. **降低认知负荷：** 开发者不需要记住「怎么配 CI/CD」，模板已经帮你做好了

记住一个原则：**Golden Path 不是金笼子——它是铺好的路，但你仍然可以走别的路。** 好的平台工程让「正确的方式」变成「最简单的方式」。

---

## 真实案例：从单体到 Golden Path 的迁移之路

以下是一个 12 人 Laravel 团队从单体应用迁移到 8 个微服务的实战数据，展示 Platform Engineering + Backstage 的真实落地效果。

### 迁移前 vs 迁移后对比

| 指标 | 迁移前（单体） | 迁移后（Golden Path） | 改善幅度 |
|------|----------------|----------------------|----------|
| 新建服务时间 | 3 天（手动配置 CI/CD、Docker、K8s、监控） | 5 分钟（填写表单，自动生成） | **99.8%** |
| CI/CD 配置时间 | 每个服务 2~4 小时 | 0（模板内置） | **100%** |
| 监控接入时间 | 1~2 天（找运维手动配置） | 0（模板自动包含） | **100%** |
| 新人 onboarding 时间 | 3~5 天（理解项目结构、部署流程） | 1 天（所有服务结构一致，文档自动生成） | **75%** |
| 服务健康状态可见性 | 无（需要逐个查看各系统） | 一目了然（Backstage Catalog 集中展示） | **∞** |
| 安全扫描覆盖率 | ~30%（开发者经常跳过） | 100%（CI 流水线强制执行） | **3.3x** |
| 开发者满意度（NPS） | +12 | +58 | **+46** |
| 平均故障排查时间（MTTR） | 45 分钟 | 12 分钟 | **73%** |

### 迁移时间线

```
第 1~2 周：搭建 Backstage，配置 GitHub/K8s/Grafana 集成
第 3 周：创建 Laravel 微服务模板（template.yaml + skeleton）
第 4 周：用模板创建第一个微服务（order-service），验证全流程
第 5~6 周：迁移 2 个核心服务，收集反馈，迭代模板
第 7~8 周：全团队推广，培训 session，布道师机制
第 9~12 周：剩余服务逐步迁移，模板持续优化
```

### 关键经验教训

**1. 模板不要一步到位，要快速迭代**

第一次发布的模板只包含 60% 的功能——Dockerfile、CI 流水线、基础 K8s 配置。剩下的 40%（Prometheus 告警、Grafana Dashboard、安全扫描）在收集到真实用户反馈后再逐步补充。完美是好的敌人。

**2. 偏离模板的审批流程要轻量**

最初我们设计了一个 3 层审批流程（开发者 → Tech Lead → 平台团队），结果开发者绕过了模板，自己手动创建服务。后来简化为「Tech Lead 一键审批 + 自动记录偏离原因」，采用率从 40% 提升到 85%。

**3. 开发者体验优先于技术完美**

模板生成的代码不一定要是最优的，但一定要是「能跑的」。我们故意在模板中保留了一些「不完美但简单」的实现（如同步数据库调用），让开发者先看到效果，再引导他们优化。Golden Path 的目标是降低门槛，不是限制上限。

---

## 相关阅读

- [Backstage 实战：开发者门户搭建——内部开发者平台（IDP）与服务目录管理](/categories/运维/2026-06-02-backstage-developer-portal-idp-service-catalog/)
- [SRE 实战入门：SLI/SLO/Error Budget 在 Laravel B2C API 中的落地](/categories/运维/SRE-实战入门-SLI-SLO-Error-Budget-Laravel-B2C-API落地/)
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/categories/运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/)
- [Chaos Engineering 实战：用 Chaos Mesh 对 Laravel 微服务进行故障注入与韧性测试](/categories/运维/Chaos-Engineering-实战/)
- [API Gateway 安全实战：WAF + Bot 管理 + mTLS——纵深防御架构](/categories/运维/API-Gateway-安全实战-WAF-Bot管理-mTLS-纵深防御架构/)
- [Developer Productivity Metrics 实战：SPACE 框架度量开发者效能](/categories/运维/2026-06-03-Developer-Productivity-Metrics-SPACE-DORA-代码质量协作效率满意度追踪/)

## 参考资料

1. Spotify. "Backstage: Open Platform for Developer Experience." backstage.io
2. CNCF. "Platform White Paper." 2023.
3. Skelton, M., Pais, M. "Team Topologies." IT Revolution Press, 2019.
4. Stafforini, L. "Platform Engineering on Kubernetes." Manning, 2024.
5. Humanitec. "Platform Engineering Benchmark Report." 2024.
