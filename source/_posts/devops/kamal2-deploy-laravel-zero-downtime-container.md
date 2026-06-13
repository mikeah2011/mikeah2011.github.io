---
title: Kamal 2 实战：DHH 的容器部署工具——对比 Docker Compose/K8s 的极简部署哲学与 Laravel 应用一键发布
date: 2026-06-07 14:30:00
tags: [Kamal, Docker, Laravel, DevOps, 部署, 容器化]
keywords: [Kamal, DHH, Docker Compose, K8s, Laravel, 的容器部署工具, 的极简部署哲学与, 应用一键发布, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "全面解析 Kamal 2 容器部署工具在 Laravel 应用中的实战应用，涵盖零停机部署流程、Docker 多阶段构建、Traefik 自动 HTTPS 证书、Accessory 附件服务管理、CI/CD 集成与健康检查回滚机制，并对比 Docker Compose 和 Kubernetes 的技术选型，帮助开发者选择最适合的容器化部署方案。"
---


## 引言：当 DHH 说"部署应该简单"时，他是认真的

David Heinemeier Hansson（DHH）——Ruby on Rails 的创造者、37signals 的创始人——一直是一个"极简主义者"。从 Rails 的"约定优于配置"哲学，到后来公开宣布将所有应用从 AWS 云服务迁移到自托管的裸金属服务器上，DHH 始终坚信一件事：**大多数 Web 应用不需要 Kubernetes 带来的那套复杂体系**。

2023 年，37signals 发表了一篇轰动业界的博文《We Have Left the Cloud》，宣布每年节省超过一百万美元的基础设施费用。在迁移过程中，他们开发了一个内部部署工具，后来将其开源，命名为 MRSK，随后更名为 **Kamal**。2024 年，Kamal 2 正式发布，带来了更完善的 Traefik 集成、Accessory 容器管理、改进的健康检查机制以及全新的 `kamal-proxy` 路由层。

Kamal 的核心主张非常大胆：**你只需要一台能通过 SSH 访问的 Linux 服务器和一个 YAML 配置文件，就能实现生产级别的零停机容器部署**。没有 etcd，没有控制平面，没有额外的编排层——只有 SSH、Docker 和一点点巧妙的脚本编排。

这篇文章将带你深入了解 Kamal 2 的设计哲学和架构细节，手把手演示如何用它部署一个完整的 Laravel 应用（包括数据库、缓存、队列和定时任务等附属服务），全面对比 Docker Compose 和 Kubernetes 的优劣，并分享真实项目中积累的部署模式和踩坑经验，帮助你在面对技术选型时做出最适合自己团队的决策。

<!-- more -->

## 一、Kamal 2 的设计哲学：恰到好处的复杂性

DHH 在 2024 年 Rails World 大会上明确阐述了 Kamal 的设计原则："我们不追求成为最强大的部署工具，我们追求的是在强大和简单之间找到最佳平衡点。" 这种哲学体现在以下几个层面：

### SSH 是一切的基础

Kamal 的所有操作都通过 SSH 完成。它不依赖任何远程代理（agent）、API 服务器或云服务商的特定接口。只要你的服务器开放了 SSH 端口，Kamal 就能工作。这意味着你可以在任何地方部署——DigitalOcean、Hetzner、AWS EC2、你机房里的物理服务器，甚至是你家里的一台旧笔记本电脑。

### Docker 是交付格式

Kamal 使用标准的 Docker 镜像作为应用的交付单元。它不发明新的打包格式，不强制你使用特定的构建工具。你可以用 `docker build`，可以使用多阶段构建，也可以集成 BuildKit 的缓存功能。Kamal 的角色是在构建完成之后——将镜像推送到注册表，然后在目标服务器上拉取并运行。

### 约定优于配置

与 Kubernetes 需要你定义 Deployment、Service、Ingress、ConfigMap、Secret、PersistentVolumeClaim 等大量资源对象不同，Kamal 用一个 `config/deploy.yml` 文件就能描述整个部署拓扑。服务名称、服务器地址、镜像仓库、环境变量、健康检查——所有信息集中在一处。这不是功能的缺失，而是设计的选择。

### 不做不必要的抽象

Kamal 不会试图将多台服务器抽象成一个"集群"。你明确知道你的应用运行在哪台机器上，你可以 SSH 上去直接查看日志、调试问题。这种"不隐藏细节"的做法在调试生产问题时极为宝贵。当你的 Laravel 应用在凌晨两点出现性能问题时，你不需要通过 kubectl exec 进入一个随机的 Pod，也不需要在茫茫的日志聚合系统中搜索关键词——你只需要 SSH 登录到那台明确的服务器上，直接查看 Docker 日志、检查进程状态、甚至临时修改代码来排查问题。这种"人与机器之间没有中间层"的直接感，是很多运维工程师非常珍视的。

### 与 Rails 生态的无缝融合

虽然 Kamal 最初是为 Ruby on Rails 项目设计的，但它的设计是完全通用的——任何能打包成 Docker 镜像的应用都能用 Kamal 部署。Laravel、Django、Express、Go 服务、静态站点——统统不在话下。Kamal 不关心你的应用使用什么语言或框架，它只关心三件事：你有没有 Dockerfile、你有没有服务器的 SSH 权限、你的配置文件写对了没有。

## 二、架构概览：三大核心组件

Kamal 2 的运行时架构由三个核心组件构成，它们各司其职，通过 Docker 网络进行内部通信。整个系统的设计理念是"每个组件只做一件事，但把它做好"。下面我们逐一剖析每个组件的角色和工作原理。

```
                    ┌──────────────┐
                    │   用户请求    │
                    │  HTTPS/HTTP  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Traefik    │  ← 反向代理 + Let's Encrypt 自动 HTTPS
                    │   (容器)      │     路由基于容器标签动态配置
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼────────┐ ┌─▼──────────┐
       │  App 新容器  │ │ App 旧容器 │ │ Accessory  │
       │   v2 (活跃)  │ │ v1 (待停)  │ │  MySQL     │
       │  Port 80    │ │ Port 80   │ │  Redis     │
       └─────────────┘ └───────────┘ └────────────┘
```

### Traefik 反向代理层

Traefik 是 Kamal 选择的反向代理和负载均衡器。它以独立容器的形式运行在每台部署服务器上，负责接收所有外部 HTTP/HTTPS 流量。Kamal 在部署过程中会自动通过 Docker labels 配置 Traefik 的路由规则——当新版本的应用容器启动时，Traefik 会自动检测到新的后端服务并开始将流量路由过去；当旧版本的容器被移除时，Traefik 也会相应地更新路由表。

Traefik 还负责自动管理 SSL/TLS 证书。通过集成 Let's Encrypt ACME 协议，Traefik 会在首次接收到 HTTPS 请求时自动申请证书，到期前自动续期，完全无需手动干预。这对于中小团队来说省去了大量证书管理的运维负担。在传统的部署方案中，你可能需要手动使用 Certbot 申请证书、编写续期脚本、配置 Nginx 的 SSL 参数，这些繁琐的步骤在 Kamal 中全部被自动化了。你只需要确保域名的 DNS 记录指向了服务器的 IP 地址，剩下的事情 Traefik 会帮你搞定。

### 应用容器层

你的 Laravel 应用运行在标准的 Docker 容器中。Kamal 会为每次部署创建一个新的容器（使用新的镜像版本），等待该容器通过健康检查后，再将旧容器移除。这种"先启后停"的策略是零停机部署的关键所在。Kamal 会自动为容器分配端口映射，确保新旧容器可以并行运行而不会产生端口冲突。

这里有一个重要的细节值得展开：Kamal 在启动新容器时，会为其分配一个随机的高位端口（例如 32768 以上），然后通过 Traefik 的 Docker provider 自动检测新容器的存在并更新路由规则。旧容器在收到 SIGTERM 信号后会进入"优雅关闭"模式——停止接收新请求，但会继续处理当前正在进行的请求，直到所有请求完成或超时。这种设计确保了在任何时刻都不会有请求被丢弃。

### Accessory 附件容器层

这是 Kamal 2 的一个重要特性。除了核心的应用容器之外，数据库（MySQL、PostgreSQL）、缓存服务（Redis）、全文搜索引擎（Meilisearch）、消息队列（RabbitMQ）等附属服务都可以通过 Accessory 机制来管理。与应用容器不同的是，Accessory 容器通常是长期运行的有状态服务，不会随每次部署而重新创建，它们拥有独立的生命周期管理命令。

这种设计体现了一个关键的架构决策：**有状态服务和无状态服务应该分别管理**。你的 Laravel 应用是无状态的——每次部署都可以从一个全新的容器开始，只要配置正确就能正常工作。但 MySQL 数据库是有状态的——它存储着你所有的业务数据，你不可能每次部署都重建数据库。Kamal 通过将这两类服务用不同的机制管理，既保证了无状态服务的快速迭代，又确保了有状态服务的稳定运行。

在实际项目中，你可以根据需要选择将 Accessory 服务部署在同一台服务器上，也可以将它们分散到不同的服务器。例如，你可以将数据库放在一台配有 SSD 的专用服务器上，将 Redis 放在另一台内存较大的服务器上，而将应用服务器放在多台普通的 VPS 上实现水平扩展。这种灵活的部署拓扑是 Kamal 的一大优势。

## 三、实战：完整部署 Laravel 应用

接下来，我们将从零开始，一步步将一个 Laravel 应用部署到一台 VPS 服务器上。整个过程包括：编写生产级 Dockerfile、初始化 Kamal 配置、配置部署拓扑、设置密钥管理、定义附件服务、执行首次部署。我们将覆盖每一个细节，确保你能够跟着步骤顺利完成部署。

### 3.1 编写生产级 Dockerfile

首先，为 Laravel 应用创建一个优化的多阶段构建 Dockerfile：

```dockerfile
# === 第一阶段：基础镜像 ===
FROM serversideup/php:8.3-fpm-nginx AS base
WORKDIR /var/www/html

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装 Laravel 必需的 PHP 扩展
RUN install-php-extensions \
    pdo_mysql \
    redis \
    gd \
    zip \
    opcache \
    bcmath \
    intl \
    pcntl

# === 第二阶段：安装依赖 ===
FROM base AS dependencies

# 先复制依赖清单，利用 Docker 缓存层
COPY composer.json composer.lock ./
RUN composer install \
    --no-dev \
    --no-scripts \
    --no-autoloader \
    --prefer-dist \
    --no-interaction

# 复制完整源码
COPY . .

# 优化 Composer 自动加载
RUN composer dump-autoload --optimize --classmap-authoritative

# 缓存 Laravel 配置、路由和视图
RUN php artisan config:cache
RUN php artisan route:cache
RUN php artisan view:cache

# === 第三阶段：生产镜像 ===
FROM base AS production
COPY --from=dependencies /var/www/html /var/www/html

# 设置正确的文件权限
RUN chown -R www-data:www-data \
    /var/www/html/storage \
    /var/www/html/bootstrap/cache

# 健康检查端点（Laravel 默认提供 /up 路由）
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost/up || exit 1

EXPOSE 80
```

几个关键优化点值得注意：首先，`composer.json` 和 `composer.lock` 先于源代码复制，这样只要依赖文件没有变化，Composer 安装这一步就会被 Docker 缓存命中，大幅加速构建速度。其次，使用 `--classmap-authoritative` 选项可以生成一个权威的类映射文件，避免 Composer 在运行时扫描文件系统，提升自动加载性能。另外，`--no-dev` 参数确保生产镜像中不包含开发依赖（如 PHPUnit、PHPStan 等），这不仅减小了镜像体积，还降低了攻击面——生产环境中不应该存在任何调试和测试工具。

关于镜像体积的优化，还有一个容易被忽略的技巧：在多阶段构建中，第一阶段（dependencies）包含了 Composer 的缓存目录和临时文件，这些在最终镜像中是不需要的。通过只从 dependencies 阶段复制 `/var/www/html` 目录，我们可以确保最终镜像尽可能精简。在实际测试中，一个典型的 Laravel 应用的生产镜像大小约为 200-350MB，相比单阶段构建的 600MB+ 有显著缩减。


### 3.2 创建 .dockerignore 文件

构建上下文的大小直接影响构建速度。创建 `.dockerignore` 排除不需要的文件：

```gitignore
.git
.github
node_modules
vendor
.env
.env.*
docker-compose*.yml
storage/logs/*
storage/framework/cache/*
storage/framework/sessions/*
storage/framework/views/*
tests
phpunit.xml
.idea
.vscode
*.md
```

### 3.3 初始化 Kamal 项目

在 Laravel 项目根目录下初始化 Kamal：

```bash
# 安装 Kamal（需要 Ruby 环境）
gem install kamal

# 初始化 Kamal 配置
kamal init
```

执行 `kamal init` 会在项目中创建两个关键文件：

- `config/deploy.yml` —— 部署配置主文件
- `.kamal/secrets` —— 密钥注入脚本

### 3.4 配置 config/deploy.yml

这是 Kamal 的核心配置文件，定义了整个部署拓扑。以下是一个完整的 Laravel 部署配置：

```yaml
# 服务名称，用于容器命名和标签
service: my-laravel-app

# Docker 镜像名称（不含标签，Kamal 会自动追加 Git SHA 或时间戳）
image: your-username/my-laravel-app

# 目标服务器配置
servers:
  web:
    hosts:
      - 159.89.123.45    # 你的 VPS IP 地址
    options:
      network: "kamal-private"  # 使用自定义 Docker 网络

# Docker 镜像仓库认证
registry:
  server: ghcr.io               # 使用 GitHub Container Registry
  username:
    - KAMAL_REGISTRY_USERNAME    # 从 .kamal/secrets 读取
  password:
    - KAMAL_REGISTRY_PASSWORD

# 环境变量配置
env:
  clear:                         # 明文环境变量
    APP_ENV: production
    APP_DEBUG: "false"
    APP_URL: https://myapp.example.com
    LOG_CHANNEL: stderr
    LOG_LEVEL: warning
    SESSION_DRIVER: redis
    QUEUE_CONNECTION: redis
    CACHE_STORE: redis
    DB_CONNECTION: mysql
    DB_HOST: my-laravel-app-db   # 使用 Accessory 容器名
    DB_PORT: "3306"
    DB_DATABASE: laravel_production
    DB_USERNAME: laravel
    REDIS_HOST: my-laravel-app-redis
    REDIS_PORT: "6379"
  secret:                        # 敏感环境变量（从 secrets 读取）
    - APP_KEY
    - DB_PASSWORD
    - REDIS_PASSWORD
    - SESSION_SECRET

# Docker 构建配置
builder:
  arch: amd64                    # 目标架构
  args:
    COMPOSER_AUTH: '{"github-oauth": {"github.com": "${GITHUB_TOKEN}"}}'

# 健康检查
healthcheck:
  path: /up
  port: 80
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 30s             # 启动宽限期

# Traefik 配置
traefik:
  host_port: 80
  options:
    memory: 256m
  args:
    accesslog: "true"
    accesslog.format: "json"

# 部署钩子
hooks:
  pre-deploy:
    - docker exec $(kamal container_id --version current) php artisan down --render=maintenance 2>/dev/null || true
  post-deploy:
    - docker exec $(kamal container_id) php artisan up
    - docker exec $(kamal container_id) php artisan migrate --force
    - docker exec $(kamal container_id) php artisan config:cache
    - docker exec $(kamal container_id) php artisan event:cache
    - echo "✅ Laravel 应用部署成功！"
```

### 3.5 配置密钥管理

编辑 `.kamal/secrets` 文件，定义密钥的获取方式：

```bash
# .kamal/secrets
# 从本地 .env.production 文件读取
KAMAL_REGISTRY_USERNAME=$(gh auth token 2>/dev/null | head -c1)
KAMAL_REGISTRY_PASSWORD=$(gh auth token 2>/dev/null)

# 应用密钥
APP_KEY=$(grep '^APP_KEY=' .env.production | cut -d '=' -f2)

# 数据库密码
DB_PASSWORD=$(grep '^DB_PASSWORD=' .env.production | cut -d '=' -f2)

# Redis 密码
REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' .env.production | cut -d '=' -f2)

# 会话密钥
SESSION_SECRET=$(grep '^SESSION_SECRET=' .env.production | cut -d '=' -f2)
```

**生产环境最佳实践**：强烈建议使用 1Password CLI 或 HashiCorp Vault 来管理密钥，而不是将密钥存储在本地文件中。将密钥存储在文件中有一个明显的风险：如果 `.kamal/secrets` 文件意外被提交到 Git 仓库，所有敏感信息都会泄露。以下示例展示了如何使用 1Password CLI 安全地注入密钥：

```bash
APP_KEY=$(op item get "laravel-production" --field "APP_KEY")
DB_PASSWORD=$(op item get "mysql-production" --field "password")
```

## 四、Accessory 附件服务管理

在 `deploy.yml` 中定义所有附属服务：

```yaml
accessories:
  # MySQL 数据库
  db:
    image: mysql:8.0
    host: 159.89.123.45
    port: "127.0.0.1:3306:3306"  # 仅本地监听，安全第一
    env:
      clear:
        MYSQL_DATABASE: laravel_production
        MYSQL_USER: laravel
        MYSQL_CHARACTER_SET_SERVER: utf8mb4
        MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
      secret:
        - MYSQL_ROOT_PASSWORD
        - MYSQL_PASSWORD
    directories:
      - /data/mysql:/var/lib/mysql
    files:
      - config/mysql/custom.cnf:/etc/mysql/conf.d/custom.cnf
    options:
      network: "kamal-private"
      health-cmd: "mysqladmin ping -h localhost || exit 1"
      health-interval: "10s"
      health-retries: "5"

  # Redis 缓存
  redis:
    image: redis:7-alpine
    host: 159.89.123.45
    port: "127.0.0.1:6379:6379"
    cmd: >
      redis-server
      --requirepass $REDIS_PASSWORD
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
    directories:
      - /data/redis:/data
    options:
      network: "kamal-private"
      health-cmd: "redis-cli -a $REDIS_PASSWORD ping || exit 1"

  # Laravel Queue Worker（可选，独立于 Web 容器运行）
  queue:
    image: ghcr.io/your-username/my-laravel-app:latest
    host: 159.89.123.45
    cmd: "php artisan queue:work redis --sleep=3 --tries=3 --max-time=3600"
    env:
      clear:
        APP_ENV: production
      secret:
        - APP_KEY
        - REDIS_PASSWORD
        - DB_PASSWORD
    options:
      network: "kamal-private"
      restart: "unless-stopped"

  # Laravel Scheduler（定时任务）
  scheduler:
    image: ghcr.io/your-username/my-laravel-app:latest
    host: 159.89.123.45
    cmd: >
      sh -c "echo '*/1 * * * * php /var/www/html/artisan schedule:run --no-interaction' > /etc/crontabs/root && crond -f -l 8"
    env:
      clear:
        APP_ENV: production
      secret:
        - APP_KEY
        - REDIS_PASSWORD
        - DB_PASSWORD
    options:
      network: "kamal-private"
```

Accessory 的管理命令非常直观：

```bash
# 首次启动所有附件
kamal accessory boot --all

# 单独管理某个服务
kamal accessory boot db
kamal accessory reboot redis
kamal accessory stop db

# 查看日志
kamal accessory logs db --tail 200
kamal accessory logs queue --follow

# 执行交互式命令
kamal accessory exec db mysql -u laravel -p laravel_production
kamal accessory exec redis redis-cli

# 数据库备份
kamal accessory exec db sh -c \
  "mysqldump -u root -p\$MYSQL_ROOT_PASSWORD laravel_production" \
  > backup_$(date +%Y%m%d).sql
```

**重要提示**：Accessory 容器不会随应用部署自动更新。如果你更新了 Queue Worker 的镜像，需要手动执行 `kamal accessory reboot queue` 来重启。这是一个有意为之的设计——有状态服务不应该随意重建。

## 五、零停机部署与滚动更新详解

Kamal 的零停机部署流程如下：

```
kamal deploy
     │
     ▼
┌─ 第一步：构建与推送 ─────────────────────┐
│  1. 本地执行 docker build 生成新镜像      │
│  2. 打标签：image:git-sha                │
│  3. 推送到配置的镜像仓库                  │
└──────────────────────────────────────────┘
     │
     ▼
┌─ 第二步：拉取镜像 ───────────────────────┐
│  1. SSH 到目标服务器                      │
│  2. 从镜像仓库拉取最新镜像                │
└──────────────────────────────────────────┘
     │
     ▼
┌─ 第三步：滚动更新 ───────────────────────┐
│  1. 启动新容器（使用新镜像）              │
│  2. 等待健康检查通过                      │
│  3. Traefik 将流量路由到新容器            │
│  4. 优雅停止旧容器（发送 SIGTERM）        │
│  5. 等待旧容器处理完当前请求              │
│  6. 移除旧容器                            │
└──────────────────────────────────────────┘
     │
     ▼
┌─ 第四步：后置钩子 ───────────────────────┐
│  1. 执行数据库迁移                        │
│  2. 清理缓存                              │
│  3. 发送部署通知                          │
└──────────────────────────────────────────┘
```

**执行回滚**：

```bash
# 查看当前运行的版本
kamal details

# 回滚到上一个版本（同样零停机）
kamal rollback
```

Kamal 保留了上一个版本的镜像，回滚操作本质上就是用旧镜像重新执行一次滚动更新。整个过程对用户完全透明。

**部分部署**：如果有多台服务器，你可以只部署到其中一台进行验证，这种做法在灰度发布场景中非常有用。你可以先将新版本部署到一台服务器上，让一小部分用户体验新功能，观察一段时间后再全量发布：

```bash
# 仅部署到特定主机
kamal deploy --hosts "159.89.123.45"
```

## 六、健康检查与自愈机制

健康检查是零停机部署的安全网。在 Laravel 端，确保 `/up` 路由正常工作：

```php
// routes/web.php — Laravel 11 默认已包含
Route::get('/up', function () {
    // 可选：检查关键依赖
    try {
        DB::connection()->getPdo();
        Redis::ping();
    } catch (\Exception $e) {
        report($e);
        return response()->json(['status' => 'degraded'], 503);
    }

    return response()->json([
        'status' => 'healthy',
        'timestamp' => now()->toIso8601String(),
        'version' => config('app.version', 'unknown'),
    ]);
})->name('health');
```

在 `deploy.yml` 中的健康检查配置解读：

```yaml
healthcheck:
  path: /up              # 健康检查端点
  port: 80               # 检查端口
  interval: 10s          # 每 10 秒检查一次
  timeout: 5s            # 单次检查超时时间
  retries: 3             # 连续失败 3 次则判定为不健康
  start_period: 30s      # 启动后 30 秒内不计入检查（给 Laravel 启动时间）
```

如果新容器的健康检查失败，Kamal 会：
1. 输出详细的错误日志
2. 自动回滚到上一个版本
3. 退出部署流程并返回非零退出码

你也可以在紧急情况下跳过健康检查（不推荐）：

```bash
kamal deploy --skip-push --skip-health-check
```

## 七、完整对比：Kamal 2 vs Docker Compose vs Kubernetes

为了帮助你在技术选型时做出判断，下面是一张详尽的对比表：

| 对比维度 | Kamal 2 | Docker Compose | Kubernetes |
|---------|---------|----------------|------------|
| **学习曲线** | 低：一个 YAML + 十余条命令 | 最低：本地开发首选 | 高：Pod、Service、Ingress、PVC 等概念众多 |
| **基础设施要求** | SSH + Docker，任意 VPS 或裸金属 | 单机 Docker 环境 | etcd + API Server + 多节点集群 |
| **最小部署单元** | 单台服务器 | 单台服务器 | 3+ 台服务器（高可用） |
| **零停机部署** | ✅ 内置滚动更新 | ❌ 需手动编写脚本实现 | ✅ RollingUpdate 原生支持 |
| **自动 HTTPS** | ✅ Traefik + Let's Encrypt 自动管理 | ❌ 需额外配置 Certbot 等 | ⚠️ 需安装 cert-manager 并配置 Issuer |
| **水平扩展** | ✅ 在 deploy.yml 中添加 host 即可 | ❌ 仅限单机垂直扩展 | ✅ HPA 自动扩缩容 |
| **服务发现** | 基于 Docker 网络 | 基于 Docker 网络 | CoreDNS + Service 原生支持 |
| **自愈能力** | 基础健康检查 + 部署回滚 | ❌ 容器崩溃不自动重启 | ✅ 完整的自愈和调度策略 |
| **配置文件复杂度** | 约 50-80 行 YAML | 约 20-40 行 YAML | 通常 200-500 行 YAML，且分散在多个文件中 |
| **密钥管理** | .kamal/secrets 脚本，灵活可扩展 | .env 文件或 Docker Secrets | 原生 Secret 资源 + 外部密钥管理工具 |
| **有状态服务支持** | Accessory 容器 + 目录挂载 | volumes 挂载 | PVC + StorageClass |
| **CI/CD 集成** | 简单：kamal deploy 命令 | 需要脚本封装 | 需要 kubectl + Helm + 可能的 GitOps 工具 |
| **社区生态** | 快速成长中，文档完善 | 非常成熟，资源丰富 | 最成熟，CNCF 生态庞大 |
| **适用规模** | 1-20 台服务器 | 开发/测试/单机生产 | 10-10000+ 台服务器 |
| **月基础设施成本** | VPS 费用：$5-100/台 | 本地开发机 | 云 K8s 服务：$70-500+/月起（不含节点费） |
| **故障排查难度** | 低：SSH 直接登录，docker logs 查看 | 最低：本地调试，直接查看 | 高：需要 kubectl、日志聚合、监控面板等工具链 |
| **多租户支持** | ❌ 不适合 | ❌ 不适合 | ✅ Namespace + RBAC |
| **适用团队规模** | 1-5 人，无专职 DevOps | 任意 | 5+ 人，有平台工程团队 |

## 八、真实世界的部署模式与常见陷阱

### 模式一：GitHub Actions CI/CD 全自动部署

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer install --no-progress
      - run: php artisan test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'

      - name: Install Kamal
        run: gem install kamal

      - name: Run Deploy
        env:
          KAMAL_REGISTRY_USERNAME: ${{ github.actor }}
          KAMAL_REGISTRY_PASSWORD: ${{ secrets.GITHUB_TOKEN }}
          APP_KEY: ${{ secrets.APP_KEY }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
          REDIS_PASSWORD: ${{ secrets.REDIS_PASSWORD }}
        run: |
          kamal setup    # 首次部署使用 setup
          # kamal deploy # 后续部署使用 deploy
```

### 模式二：蓝绿部署策略

虽然 Kamal 本身已经通过滚动更新实现了零停机部署，但在某些对发布风险控制要求更高的场景下（例如金融系统或医疗健康应用），你可能需要更严格的蓝绿部署策略。蓝绿部署的核心思想是同时维护两个完全相同的生产环境，只有在新版本被完全验证之后才将流量全部切换过去：

```bash
# 部署到"绿色"环境
kamal deploy --version green-$(date +%Y%m%d)

# 验证新版本
curl -f https://myapp.example.com/up

# 如有问题，快速回滚
kamal rollback
```

### 模式三：多环境管理

Kamal 支持通过环境名称区分不同部署目标：

```bash
# 创建环境特定的配置文件
config/deploy.production.yml
config/deploy.staging.yml

# 部署到不同环境
KAMAL_VERSION=production kamal deploy -d production
KAMAL_VERSION=staging kamal deploy -d staging
```

### 常见陷阱与解决方案

**陷阱一：构建上下文过大导致部署缓慢**
这是新手最常遇到的问题。如果你的 Laravel 项目包含了 `vendor`、`node_modules`、`.git` 等目录，Docker 构建上下文可能达到数 GB，每次构建都需要将这些文件发送到 Docker daemon，导致构建时间长达数十分钟。务必创建完善的 `.dockerignore` 文件。另外，一个安全方面的重要提醒：确保在 `.dockerignore` 中排除 `.env` 文件，避免敏感信息（数据库密码、API 密钥等）被意外打包到镜像中，任何能够拉取你镜像的人都可以轻松提取出这些密钥。

**陷阱二：容器文件存储丢失**
这是容器化部署中最容易犯的错误之一。容器是临时性的，每次部署都会创建新容器并销毁旧容器。用户上传的头像、生成的报表、写入的日志等数据如果没有持久化存储，部署后会全部丢失，而且这种丢失往往是不可逆的。最佳实践是使用对象存储服务（如 AWS S3、阿里云 OSS、MinIO）来存储所有用户上传的文件，并在 Laravel 的 `config/filesystems.php` 中将默认存储驱动配置为 `s3`。如果确实需要本地存储，可以使用 Kamal 的 `directories` 配置项将宿主机目录挂载到容器中，但要注意这样做会影响应用的可移植性。

**陷阱三：数据库迁移导致服务中断**
某些数据库迁移操作（如向大表添加索引、修改列类型）可能会长时间锁表，导致整个应用无响应。在生产环境中，一次不当的 `ALTER TABLE` 操作可能锁表数分钟甚至数小时，直接影响用户体验和业务收入。最佳实践包括：使用 `--batch-size` 参数分批处理大量数据变更；对于大表的结构变更，使用在线 DDL 工具如 `pt-online-schema-change`（MySQL）或 `pg_repack`（PostgreSQL），这些工具能在不锁表的情况下完成表结构修改；将迁移操作放在部署前的准备阶段执行，而不是在部署过程中的钩子中执行，这样即使迁移失败也不会影响当前正在运行的版本。

**陷阱四：队列任务在部署期间丢失**
当旧容器被优雅停止时，正在处理的队列任务可能未完成就被强制终止。更糟糕的是，如果队列任务涉及支付处理或邮件发送等关键业务操作，丢失的任务可能导致用户付款后未收到商品确认邮件，或者后台订单状态与实际不一致。因此，在部署前让队列 worker 优雅退出至关重要。你需要确保 Laravel 的队列配置中设置了合理的超时时间和重试策略，让 worker 有足够的时间完成当前正在处理的任务：

```php
// config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => 'default',
    'retry_after' => 180,    // 任务超时时间
    'block_for' => null,
    'after_commit' => false,
],
```

同时在 `deploy.yml` 的 `pre-deploy` 钩子中让队列 worker 优雅退出：

```yaml
hooks:
  pre-deploy:
    - docker exec $(kamal container_id --version current) \
        php artisan queue:restart 2>/dev/null || true
```

**陷阱五：Traefik 证书申请失败**
Let's Encrypt 有速率限制，频繁部署可能导致证书申请被限流。确保 DNS 记录正确指向服务器 IP，并且 80 端口可以从外部访问。Traefik 需要通过 HTTP-01 challenge 来验证域名所有权。

## 九、何时选择 Kamal，何时选择 Kubernetes

### 选择 Kamal 的场景

Kamal 并不适合所有场景，但在它擅长的领域中，它几乎是无可匹敌的选择。以下是 Kamal 最能发挥优势的几种典型场景：

- **初创公司和独立开发者**：团队规模小（1-5 名开发者），没有专职的 DevOps 或平台工程师。Kamal 的学习曲线极低，一个有基本 Docker 知识的开发者可以在几个小时内从零完成首次部署到生产环境。不需要理解 Pod、Service、Ingress 这些复杂的 Kubernetes 概念，也不需要花钱请 DevOps 工程师来维护集群。
- **中小型 Web 应用**：典型的 Laravel、Rails、Django 单体应用或少量微服务。日活用户从几百到几万的规模，一两台 VPS 就能从容应对。这类应用通常不需要 Kubernetes 的自动扩缩容和复杂的流量管理功能。
- **预算敏感型项目**：不想为托管 Kubernetes 服务买单。AWS EKS、Google GKE 的控制平面费用每月 $70-100 起步，这还不包括节点实例、负载均衡和存储的费用。而 Kamal 部署在 Hetzner 或 DigitalOcean 的 $5-20/月 VPS 上就能跑得很好，对于个人项目和小型商业项目来说，这是一个巨大的成本优势。
- **快速验证想法**：MVP 阶段的产品需要快速上线、频繁迭代。Kamal 的部署速度通常在 1-3 分钟之间（取决于镜像大小），这比搭建和维护一套完整的 Kubernetes CI/CD 流水线要快得多。在创业早期，速度就是一切。
- **从传统部署迁移**：目前还在用 FTP 上传代码或手动 SSH 脚本部署的团队，Kamal 是一个非常好的"现代化跳板"。它保留了你熟悉的 SSH + 服务器的心智模型，同时引入了容器化和零停机部署的最佳实践。

### 选择 Kubernetes 的场景

尽管 Kamal 在中小规模场景中表现出色，但当你的系统规模和复杂度增长到一定程度时，Kubernetes 仍然是不可替代的选择：

- **大规模微服务架构**：管理数十甚至上百个服务，需要服务网格、分布式追踪、复杂的路由策略。
- **弹性伸缩需求**：流量波动大的应用，需要根据 CPU、内存或自定义指标自动扩缩容。
- **多团队协作**：大型组织中多个团队共享基础设施，需要命名空间隔离、RBAC 权限控制、资源配额管理。
- **合规与安全要求**：金融、医疗等行业对网络策略、审计日志、多租户隔离有严格要求。
- **混合云或多云部署**：需要跨 AWS、GCP、Azure 以及私有数据中心统一管理应用。

### 渐进式迁移路径

值得强调的是，选择 Kamal 和选择 Kubernetes 并不矛盾。很多团队采用渐进式的演进策略：

1. **初期（0-10 万用户）**：使用 Kamal 部署在 1-2 台 VPS 上，快速上线迭代
2. **成长期（10-100 万用户）**：继续使用 Kamal，增加服务器数量，引入 CDN 和外部数据库服务
3. **规模期（100 万+ 用户）**：评估是否需要迁移到 Kubernetes，此时应用已经是 Docker 化的，迁移成本可控

由于 Kamal 和 Kubernetes 都使用标准的 Docker 镜像作为交付格式，这种迁移在技术层面是相对顺畅的。你的 `Dockerfile`、CI 构建流程、镜像仓库都不需要改变——变的只是"谁来编排这些容器"这个编排层而已。这也是为什么我们一直强调"容器化是一切的基础"——一个好的 Docker 化策略不仅能让你今天用 Kamal 轻松部署，也为未来可能的架构演进留下了充足的空间。

## 总结：简单是一种能力

Kamal 2 代表了一种"反复杂性"的工程哲学。在一个被 Kubernetes、服务网格、GitOps 工具链、可观测性平台层层堆叠的云原生时代，它提醒我们一个朴素的事实：**很多 Web 应用根本不需要那么复杂的基础设施**。一家年收入千万级别的 SaaS 公司，完全可能只需要几台 VPS 和一个 Kamal 配置文件就能支撑起所有的线上服务。

对于 Laravel 开发者来说，Kamal 提供了一条从"FTP 上传代码"到"生产级容器部署"之间最优雅的路径。你不需要学习 Helm charts、不需要配置 cert-manager、不需要理解 Ingress 资源对象和 NetworkPolicy 网络策略——你只需要一个 YAML 配置文件、几条命令，就能获得零停机部署、自动 HTTPS 证书管理、容器健康检查和自动回滚等生产级别的能力。这种"开箱即用"的体验正是 DHH 所追求的——让开发者专注于构建产品，而不是与基础设施搏斗。

当然，Kamal 不是万能的银弹。当你面对的是一个需要管理数百个微服务、支持多租户隔离、要求基于自定义指标的自动弹性伸缩、需要跨多个可用区做高可用的大规模平台时，Kubernetes 仍然是无可替代的选择。关键在于认清自己团队的实际需求和技术能力，选择"刚好够用"的工具——既不过度工程化，也不会在系统规模增长时捉襟见肘。

正如 DHH 所说："复杂性从来都不是免费的。每增加一层抽象，就增加了一层需要理解、维护和调试的东西。" Kamal 2 的真正价值不在于它做了什么技术创新，而在于它证明了一个观点：部署可以简单，同时不牺牲可靠性。在一个动辄要求你学习几十个新概念才能把应用上线的行业里，Kamal 2 像一股清流，用最朴素的方式解决了最实际的问题。

---

**参考资源**：

- [Kamal 官方文档](https://kamal-deploy.org/) — 最权威的参考资料
- [Kamal GitHub 仓库](https://github.com/basecamp/kamal) — 源代码与 Issue 讨论
- [DHH：We Have Left the Cloud](https://world.hey.com/dhh/we-have-left-the-cloud-251760fb) — 37signals 上云始末
- [Serversideup PHP Docker 镜像](https://serversideup.net/open-source/docker-php/) — 本文 Dockerfile 基础镜像
- [Traefik 官方文档](https://doc.traefik.io/traefik/) — Kamal 使用的反向代理

## 相关阅读
- [Laravel Forge vs Ploi vs Deployer 实战：三种部署方案深度对比](/06_运维/2026-06-07-Laravel-Forge-vs-Ploi-vs-Deployer-实战-三种部署方案深度对比/) — 对比传统 PHP 部署平台与 Kamal 的容器化路线差异
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/06_运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/) — 同为自托管部署方案，Coolify 提供图形化界面的 PaaS 体验
- [蓝绿部署实战：Laravel 零停机发布——流量切换、数据库迁移与一键回滚](/06_运维/2026-06-02-蓝绿部署实战-Laravel-零停机发布-流量切换-数据库迁移与一键回滚/) — 深入零停机发布的另一种策略：蓝绿部署与流量切换
- [Ansible 实战：Laravel 应用自动化部署与配置管理](/categories/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/) — 探索 Ansible 自动化工具在 Laravel 部署与配置管理中的实战应用
- [金丝雀发布实战：渐进式流量放量——Nginx/Envoy 权重路由与 Laravel 版本共存](/categories/07_CICD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/) — 了解金丝雀发布策略与零停机部署的协同实践
- [容器安全扫描实战：Trivy/Snyk/Grype CI 集成](/categories/07_CICD/容器安全扫描实战-Trivy-Snyk-Grype-CI集成-镜像漏洞检测-SBOM生成与修复工作流/) — 容器化部署不可或缺的安全扫描与漏洞检测实践
