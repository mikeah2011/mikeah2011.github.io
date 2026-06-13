---

title: Docker 基础入门：镜像、容器、Dockerfile 核心概念
keywords: [Docker, Dockerfile, 基础入门, 镜像, 容器, 核心概念, DevOps]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- Docker
- 容器化
- DevOps
categories:
  - devops
  - docker
date: 2020-03-20 15:05:07
description: Docker 是一个开源的容器化平台，通过 Linux Namespace + Cgroups 把进程打包成可移植的镜像，做到「一次构建、到处运行」。本文梳理核心概念、常用命令和踩坑笔记。
---



## 一、Docker 是什么

Docker 是一个**开源的应用容器化引擎**。它把应用 + 依赖 + 运行环境打包成一个标准化的「镜像」（Image），任何装了 Docker 的机器拉下来都能跑出**完全一致**的「容器」（Container）。

它解决了一个老问题：**「在我机器上能跑啊」**。

> Docker ≠ 虚拟机。VM 模拟整个操作系统（含 Kernel），Docker 共享宿主机 Kernel，只隔离用户态 —— 启动秒级，资源开销极小。

底层依赖三个 Linux 内核特性：

| 机制 | 作用 |
|------|------|
| **Namespace** | 隔离视图（pid、net、mnt、uts、ipc、user）—— 容器以为自己独占一台机器 |
| **Cgroups** | 限制资源（CPU、内存、IO）—— 防止一个容器吃光宿主机 |
| **UnionFS** | 分层文件系统（overlay2）—— 镜像可复用层，节省磁盘 |

---

## 二、核心概念

```
Dockerfile  ──build──▶  Image  ──run──▶  Container
   (构建脚本)              (镜像)              (运行实例)
                            │
                            └──push──▶  Registry (Docker Hub / Harbor)
```

- **Image**：只读模板，分层存储。`nginx:1.25-alpine` 是镜像名:Tag。
- **Container**：镜像运行起来的实例，带一个可写层（容器删了，可写层数据就没了）。
- **Volume**：持久化数据的标准方式，容器删了数据还在。
- **Network**：默认 `bridge` 模式给每个容器分一个虚拟 IP；多容器互通常用自定义 bridge 网络。

---

## 三、常用命令速查

### 镜像管理

```bash
docker pull nginx:alpine              # 拉镜像
docker images                         # 列出本地镜像
docker rmi nginx:alpine               # 删镜像
docker build -t myapp:v1 .            # 用当前目录的 Dockerfile 构建
docker tag myapp:v1 registry.io/myapp:v1
docker push registry.io/myapp:v1
```

### 容器生命周期

```bash
docker run -d --name web -p 8080:80 nginx        # 后台启动 + 端口映射
docker ps                                         # 看运行中的容器
docker ps -a                                      # 看所有容器（含已停止）
docker logs -f web                                # 实时看日志
docker exec -it web sh                            # 进容器（Alpine 没 bash）
docker stop web && docker rm web                  # 停 + 删
docker rm -f $(docker ps -aq)                     # 一键清掉所有容器
```

### 数据 & 网络

```bash
docker volume create mydata
docker run -v mydata:/data alpine                 # 挂命名卷
docker run -v $(pwd):/app alpine                  # 挂宿主机目录（开发常用）
docker network create app-net
docker run --network app-net --name redis redis   # 同网络容器可用名字互访
```

---

## 四、Dockerfile 范例（多阶段构建）

```dockerfile
# 阶段 1：构建
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app .

# 阶段 2：运行（只复制二进制，镜像极小）
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app /app
EXPOSE 8080
ENTRYPOINT ["/app"]
```

多阶段构建能把最终镜像从几百 MB 压到十几 MB —— 生产环境必用。

---

## 五、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **macOS 文件挂载慢** | `-v` 挂代码目录 IO 卡顿 | 加 `:cached` 或 `:delegated` 标志；考虑 Mutagen / OrbStack |
| **镜像体积爆炸** | `apt install` 后镜像 1GB+ | 同一层 `apt-get update && install && rm -rf /var/lib/apt/lists/*` |
| **容器时区不对** | 日志时间 UTC | `ENV TZ=Asia/Shanghai` + 装 tzdata |
| **`COPY` 不生效** | 改了源码镜像没变 | `.dockerignore` 漏配，或层缓存命中 —— `--no-cache` 强制重建 |
| **僵尸进程** | PID 1 是 node/python，子进程不回收 | 用 `tini` 做 init，或 `docker run --init` |
| **存储驱动占满** | `docker system df` 很大 | `docker system prune -af --volumes` |

---

## 六、和 Kubernetes 的关系

Docker 解决「单机跑容器」，Kubernetes 解决「**一堆机器编排一堆容器**」—— 调度、自愈、滚动升级、服务发现。

K8s 早期通过 dockershim 调用 Docker，从 1.24 起移除了 dockershim，改用 containerd / CRI-O 这类轻量 runtime。但 **Docker 构建的镜像照样能用**（OCI 标准镜像格式）—— 开发用 Docker，生产用 K8s + containerd 是常见组合。

---

## 七、Docker vs 虚拟机（VM）深度对比

很多初学者会问：「我已经有虚拟机了，为什么还要用 Docker？」这个问题的答案需要从底层架构说起。虚拟机通过 Hypervisor（如 VMware ESXi、KVM、VirtualBox）模拟出一整套硬件环境，每个虚拟机内部都运行着一个完整的操作系统内核。这意味着即使你只想跑一个简单的 Nginx 服务，也需要先启动一整个 Linux 内核，占用几百 MB 内存和数 GB 磁盘。

Docker 的思路完全不同。它利用 Linux 内核的 Namespace 和 Cgroups 特性，在**进程级别**实现隔离，所有容器共享宿主机的同一个内核。这就像住在同一栋公寓里的不同住户 —— 共享地基和水电管道，但各有各的房间和门锁。相比之下，虚拟机更像是在一块空地上独立盖了多栋房子，每栋都有自己的地基。

这种架构差异带来了巨大的性能优势：Docker 容器的启动时间通常在毫秒到秒级，而虚拟机需要分钟级的时间来引导操作系统。在持续集成和持续部署（CI/CD）的场景中，这种差异被成倍放大 —— 一条流水线可能需要创建和销毁数十个容器，如果每个都要等几分钟，整个流程会变得无法忍受。

| 维度 | Docker 容器 | 虚拟机（VM） |
|------|------------|-------------|
| **虚拟化层级** | 应用层（共享宿主机 Kernel） | 硬件层（每个 VM 独立 Kernel） |
| **启动速度** | 毫秒～秒级 | 分钟级 |
| **磁盘占用** | MB 级（分层复用） | GB 级（完整 OS 镜像） |
| **内存开销** | 几十 MB | 数百 MB 起 |
| **隔离强度** | 进程级（Namespace + Cgroups） | 硬件级（Hypervisor） |
| **安全性** | 较弱（共享 Kernel，需加固） | 较强（完全隔离） |
| **迁移/分发** | 镜像推送/拉取，秒级完成 | 导出 OVA/QCOW2，动辄数 GB |
| **典型场景** | 微服务、CI/CD、开发环境 | 传统企业应用、强隔离需求 |

> **选型建议**：如果你的场景是 Web 应用 / 微服务 / CI/CD，优先选 Docker。如果需要运行不同 OS 内核（如在 Linux 上跑 Windows），或有强安全隔离要求（多租户），则用 VM 或 Firecracker 等轻量 MicroVM。两者并不互斥 —— Docker Desktop 本身就是跑在一个轻量 Linux VM 里的。在生产环境中，很多团队会采用「VM 打底 + 容器编排」的混合架构，既保证了宿主机级别的安全隔离，又享受容器化带来的部署效率。

---

## 八、Dockerfile 最佳实践（含 Laravel 多阶段构建）

写好 Dockerfile 是容器化的核心技能。一个糟糕的 Dockerfile 会导致镜像体积膨胀、构建缓慢、安全隐患丛生。我见过太多团队因为 Dockerfile 写得不好，一个镜像动辄 1GB 以上，构建一次要十几分钟，严重拖慢开发迭代速度。以下是我总结的最佳实践，每一条都附带原因和踩坑说明。

### 8.1 通用最佳实践

**1. 选择合适的基础镜像**

基础镜像的选择直接决定镜像体积和安全风险：

- **Alpine**：体积最小（约 5MB），适合纯静态二进制或 Go/Rust 应用。但使用 musl libc 而非 glibc，部分 C 扩展可能有兼容问题。
- **Debian slim**：体积中等（约 80MB），兼容性好，适合 Python / PHP / Java。
- **Distroless**：Google 出品，只含运行时必要文件，没有 shell，安全性最高。

```dockerfile
# ✅ 推荐：用 slim 或 alpine 标签
FROM php:8.3-fpm-alpine

# ❌ 避免：用 latest 标签（不可复现，体积大）
FROM php:8.3-fpm
```

**2. 合并 RUN 指令减少层数**

Docker 每条 `RUN` 都会产生一个新层。合并相关操作可以减小镜像体积：

```dockerfile
# ❌ 每条 RUN 一层，清理无效（已在上一层写死了）
RUN apt-get update
RUN apt-get install -y curl git
RUN rm -rf /var/lib/apt/lists/*

# ✅ 合并成一层，安装完立即清理
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl git && \
    rm -rf /var/lib/apt/lists/*
```

**3. 利用层缓存加速构建**

Docker 从上到下逐层构建，一旦某层内容变了，后续层全部重新构建。把**变化频率低**的指令放前面：

```dockerfile
# 先装依赖（不常变）
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist

# 再拷代码（经常变）
COPY . .
RUN composer dump-autoload --optimize
```

**4. 使用 `.dockerignore`**

跟 `.gitignore` 类似，避免把不需要的文件打入镜像：

```gitignore
.git
node_modules
.env
vendor
tests
*.md
```

**5. 不要以 root 运行应用**

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

### 8.2 Laravel 多阶段构建完整示例

下面是一个生产级 Laravel 应用的 Dockerfile，包含 Composer 依赖安装、前端资源编译、PHP-FPM 运行三个阶段：

```dockerfile
# ============ 阶段 1：安装 Composer 依赖 ============
FROM composer:2.7 AS vendor

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-scripts \
    --prefer-dist \
    --ignore-platform-reqs \
    --optimize-autoloader

# ============ 阶段 2：编译前端资源 ============
FROM node:20-alpine AS frontend

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY resources/ resources/
COPY vite.config.js ./
RUN npm run build

# ============ 阶段 3：最终 PHP-FPM 镜像 ============
FROM php:8.3-fpm-alpine

# 安装系统依赖和 PHP 扩展
RUN apk add --no-cache \
        freetype-dev libjpeg-turbo-dev libpng-dev libzip-dev \
        icu-dev oniguruma-dev linux-headers && \
    docker-php-ext-configure gd --with-freetype --with-jpeg && \
    docker-php-ext-install -j$(nproc) \
        pdo_mysql mbstring zip gd bcmath intl opcache pcntl && \
    apk del freetype-dev libjpeg-turbo-dev libpng-dev && \
    rm -rf /tmp/*

# 安装 OPcache 和 PHP 配置
COPY docker/php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY docker/php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/html

# 从各阶段拷贝产物
COPY --from=vendor /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build
COPY . .

# 权限设置
RUN chown -R www-data:www-data storage bootstrap/cache && \
    chmod -R 775 storage bootstrap/cache

# 使用非 root 用户
USER www-data

EXPOSE 9000
CMD ["php-fpm"]
```

这个多阶段构建的关键优势：

- **Composer 依赖**在独立阶段安装，不会污染最终镜像的层缓存
- **Node.js 编译阶段**不会出现在最终镜像中（节省约 300MB）
- **最终镜像只有 PHP-FPM 运行时**，体积控制在 100MB 左右
- **每层职责单一**，改动代码不会触发 Composer 重新安装

---

## 九、Docker Compose 实战：Laravel 全栈环境

单个容器用 `docker run` 就够了，但实际项目通常需要多个服务配合。一个典型的 Laravel 应用至少需要 Web 服务器（Nginx）、PHP-FPM 处理器、数据库（MySQL）、缓存（Redis）四个组件，如果用 `docker run` 逐个启动，光是管理容器之间的网络连接和启动顺序就够让人头大的了。

Docker Compose 正是为了解决这个问题而生的。它允许你用一个 YAML 文件（`docker-compose.yml`）声明式地定义整个应用栈，包括每个服务使用的镜像、端口映射、数据卷挂载、环境变量、依赖关系和健康检查。然后只需一条 `docker compose up -d` 命令，就能把所有服务按照正确的顺序和依赖关系一键启动。

在本地开发环境中，Docker Compose 的价值尤为突出。新入职的开发者不需要花几天时间手动安装 MySQL、Redis、PHP 等环境，只需要克隆代码仓库，执行一条命令就能获得与团队其他人完全一致的开发环境。这极大地降低了环境差异导致的「在我机器上能跑」类问题。此外，Compose 文件本身就是一份活的环境文档，比任何 README 都更准确、更可执行。

### 9.1 docker-compose.yml 示例

以下是一个 Laravel 项目的典型编排：Nginx + PHP-FPM + MySQL + Redis：

```yaml
version: "3.8"

services:
  # ========== Web 服务器 ==========
  nginx:
    image: nginx:1.25-alpine
    ports:
      - "8080:80"
    volumes:
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - .:/var/www/html:cached
    depends_on:
      php:
        condition: service_started
    networks:
      - app-net

  # ========== PHP-FPM ==========
  php:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - .:/var/www/html:cached
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_DATABASE=laravel
      - DB_USERNAME=root
      - DB_PASSWORD=secret
      - REDIS_HOST=redis
      - CACHE_DRIVER=redis
      - SESSION_DRIVER=redis
    networks:
      - app-net

  # ========== MySQL 数据库 ==========
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: laravel
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/mysql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-net

  # ========== Redis 缓存 ==========
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    networks:
      - app-net

  # ========== 队列 Worker ==========
  queue:
    build:
      context: .
      dockerfile: Dockerfile
    command: php artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      - DB_HOST=mysql
      - REDIS_HOST=redis
    networks:
      - app-net
    restart: unless-stopped

# ========== 命名卷（持久化） ==========
volumes:
  mysql-data:
    driver: local
  redis-data:
    driver: local

# ========== 自定义网络 ==========
networks:
  app-net:
    driver: bridge
```

### 9.2 Compose 常用命令

```bash
# 一键启动所有服务（后台运行）
docker compose up -d

# 查看所有服务状态
docker compose ps

# 查看某个服务的日志（实时跟踪）
docker compose logs -f php

# 进入 PHP 容器执行 Artisan 命令
docker compose exec php php artisan migrate
docker compose exec php php artisan tinker

# 重建镜像（Dockerfile 有变动时）
docker compose build --no-cache
docker compose up -d --build

# 停止并清除所有容器、网络
docker compose down

# 停止并清除容器、网络、数据卷（⚠️ 数据会丢失）
docker compose down -v
```

### 9.3 depends_on 与健康检查

上例中 MySQL 配置了 `healthcheck`，PHP-FPM 用 `depends_on` + `condition: service_healthy` 确保 MySQL 真正可用后才启动。这比简单的 `depends_on`（只等容器启动，不等服务就绪）更可靠，避免了 Laravel 报 `Connection refused` 的经典坑。

---

## 十、Volume 与网络基础

数据持久化和网络通信是容器化应用的两大基础设施。理解这两个概念是部署任何有状态应用（如数据库、文件存储）的前提。

### 10.1 Volume 持久化

容器的可写层是临时的 —— 容器一旦删除，数据就没了。这是很多新手踩的第一个大坑：在容器里装了数据库、写了几 GB 数据，结果一次 `docker rm` 就全没了。

为什么会这样？因为 Docker 的文件系统是分层的：镜像层是只读的，容器启动时会在最上面加一个可写层（Container Layer）。所有运行时的文件写入都发生在这个可写层里。但这个可写层的生命周期和容器绑定 —— 容器没了，可写层也跟着消失。

Volume 就是 Docker 提供的「跳出」这个生命周期绑定的方案。它把数据存储在宿主机的一个独立目录中，由 Docker 管理。无论容器如何创建、销毁、重建，只要挂载了同一个 Volume，数据就不会丢失。

Docker 提供三种持久化方式：

| 类型 | 语法示例 | 特点 | 适用场景 |
|------|---------|------|---------|
| **Named Volume** | `-v mysql-data:/var/lib/mysql` | Docker 管理，跨容器复用，易备份 | 数据库数据、应用缓存 |
| **Bind Mount** | `-v $(pwd)/src:/app/src` | 直接映射宿主机目录，开发时实时同步 | 代码热重载、配置文件 |
| **tmpfs** | `--tmpfs /tmp` | 内存文件系统，容器停止即消失 | 临时文件、敏感数据缓存 |

```bash
# 创建命名卷
docker volume create mydata

# 查看卷详情
docker volume inspect mydata

# 列出所有卷
docker volume ls

# 删除未使用的卷（⚠️ 确认后再执行）
docker volume prune
```

> **生产建议**：数据库数据务必使用 Named Volume 或挂载到宿主机专用目录。Bind Mount 开发时方便，但在 macOS/Windows 上因文件系统转发会有明显性能损耗，建议搭配 `:cached` 或 `:delegated` 标志。

### 10.2 网络模式

Docker 默认使用 `bridge` 网络。多容器协作时，建议创建自定义网络：

```bash
# 创建自定义 bridge 网络
docker network create app-net

# 在同一网络中，容器可以用服务名互访（内置 DNS）
docker run -d --name redis --network app-net redis:alpine
docker run -d --name php --network app-net my-php-app
# PHP 容器中直接用 redis:6379 连接 Redis
```

Docker 提供三种主要网络模式：

| 模式 | 说明 | 使用场景 |
|------|------|---------|
| **bridge**（默认） | 容器有独立网络栈，通过虚拟网桥通信 | 单机多容器互访 |
| **host** | 容器直接使用宿主机网络（无隔离） | 高性能网络应用、对延迟极敏感的场景 |
| **none** | 无网络 | 安全沙箱、离线计算 |

> **进阶**：overlay 网络用于 Docker Swarm 跨主机通信。在 Kubernetes 场景下，网络由 CNI 插件（如 Calico、Cilium）接管，详见 [Docker 网络实战](/devops/docker-guide-bridge-host-overlay-service-discovery/) 一文。

---

## 十一、Docker 安全最佳实践

容器安全经常被忽视，但在生产环境中至关重要。以下是最关键的安全加固措施。

### 11.1 镜像安全

**1. 使用最小基础镜像**

镜像越大，包含的系统工具越多，攻击面越大。`alpine` 和 `distroless` 是首选。

**2. 定期扫描镜像漏洞**

```bash
# 使用 Docker Scout 扫描（Docker 23.11+ 内置）
docker scout cves myapp:latest

# 或使用 Trivy（开源，更全面）
trivy image myapp:latest
```

**3. 固定镜像版本，避免 `latest`**

```dockerfile
# ❌ latest 不可复现，可能引入破坏性变更
FROM node:latest

# ✅ 锁定具体版本
FROM node:20.11-alpine3.19
```

### 11.2 运行时安全

**1. 非 root 用户运行**

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

**2. 只读文件系统**

```bash
docker run --read-only --tmpfs /tmp myapp
# 容器无法写入文件系统，只能写 /tmp
```

**3. 限制资源**

```bash
docker run \
  --memory=512m \
  --cpus=1.0 \
  --pids-limit=100 \
  myapp
```

**4. 禁用特权模式**

```bash
# ❌ 拥有宿主机 root 权限，极度危险
docker run --privileged myapp

# ✅ 只添加需要的权限
docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE myapp
```

**5. 不要在镜像中存放敏感信息**

```dockerfile
# ❌ 密钥硬编码在镜像里
ENV DB_PASSWORD=supersecret

# ✅ 运行时通过环境变量或 Secret 注入
# docker run -e DB_PASSWORD=xxx myapp
# 或在 Docker Compose 中使用 env_file / secrets
```

**6. 使用 Docker Content Trust**

```bash
export DOCKER_CONTENT_TRUST=1
# 之后 docker pull / docker build 只会拉取签名镜像
```

### 11.3 CI/CD 中的安全实践

- 在 CI 流水线中集成镜像扫描（Trivy / Snyk / Docker Scout），发现高危漏洞时自动阻断部署
- 使用 BuildKit 的 `--secret` 传递构建密钥，避免密钥留在镜像层中
- 定期更新基础镜像，修补已知 CVE
- 使用 Harbor 等私有镜像仓库，配合签名验证和漏洞扫描

---

## 参考

- 官方文档：<https://docs.docker.com>
- Dockerfile 最佳实践：<https://docs.docker.com/develop/develop-images/dockerfile_best-practices/>
- Play with Docker（在线沙箱）：<https://labs.play-with-docker.com>

---

## 相关阅读

- [Docker Compose 5.x 实战：多服务编排、健康检查与开发环境搭建](/devops/docker-compose-5-x-guide-orchestration-laravel/) — 从单容器到多服务编排，覆盖健康检查、条件启动、网络隔离等进阶话题
- [Docker 多阶段构建实战：PHP 应用镜像从 500MB 优化到 50MB](/devops/docker-guide-php-imageoptimization-500mb50mb/) — 生产环境中 PHP-FPM 镜像瘦身的完整过程，含层缓存治理和 CI 集成
- [Docker Volume 实战：数据持久化、备份恢复与 NFS 挂载](/devops/docker-volume-guide-nfs-laravel/) — 从 bind mount 到 NFS 共享存储，覆盖 MySQL/Redis 数据备份恢复策略
