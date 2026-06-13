---
title: "Podman 5.x 实战：无 Daemon 容器运行时——对比 Docker 的 Rootless、Quadlet 与 Laravel docker-compose 迁移"
keywords: [Podman, Daemon, Docker, Rootless, Quadlet, Laravel docker, compose, 容器运行时, 迁移, 架构]
date: 2026-06-09 16:41:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Podman
  - Docker
  - 容器化
  - Laravel
  - Rootless
  - Quadlet
  - DevOps
description: "深入对比 Podman 5.x 与 Docker 的架构差异，实战 Rootless 容器、Quadlet systemd 集成，并手把手将 Laravel 项目的 docker-compose 迁移到 Podman 生态。"
---


## 概述

Docker 几乎统治了容器化开发的十年，但它有一个本质性的架构决策——**中心化 Daemon**。所有容器都由一个 root 权限的 `dockerd` 进程管理，这在安全性和资源隔离上带来了持续的争议。

Podman 从诞生之初就走了另一条路：**无 Daemon、Rootless、OCI 原生**。Podman 5.x 的发布标志着这个生态走向成熟——Quadlet 深度集成 systemd、Podman Machine 在 macOS/Windows 上的体验大幅改善、Compose 兼容性也趋于完善。

本文将从实际开发者的视角出发：

1. 解析 Podman 与 Docker 的架构本质差异
2. 手把手配置 Rootless 环境
3. 用 Quadlet 将容器服务托管到 systemd
4. **完整迁移一个 Laravel 项目的 docker-compose.yml 到 Podman**

如果你正在评估是否从 Docker 切换到 Podman，或者已经在用 Podman 但想深入 Quadlet，这篇文章会给你一个清晰的路线图。

---

## 一、架构差异：为什么 Podman 不需要 Daemon

### Docker 的 Daemon 模型

```
┌─────────────┐
│  docker CLI  │─── socket ──→ ┌─────────────┐
└─────────────┘                │   dockerd    │  (root daemon)
                               │  ┌────────┐ │
                               │  │container│ │
                               │  │container│ │
                               │  └────────┘ │
                               └─────────────┘
```

Docker CLI 本身不创建容器，它通过 Unix socket（`/var/run/docker.sock`）向 `dockerd` 发请求。`dockerd` 以 root 运行，管理所有容器的生命周期。

问题在于：
- **单点故障**：dockerd 挂了，所有容器管理操作全部停摆
- **安全隐患**：root 权限的 daemon 暴露 socket，任何能访问 socket 的进程都能完全控制容器
- **资源开销**：daemon 常驻内存，即使没有运行任何容器

### Podman 的 Fork/Exec 模型

```
┌─────────────┐
│  podman CLI  │──fork/exec──→ ┌───────────┐
└─────────────┘                │ container  │  (用户进程)
                               │  conmon    │  (monitor)
                               └───────────┘
```

Podman 每次 `podman run` 直接 fork 出容器进程，用 `conmon` 做监控。没有中间 daemon，容器就是用户的子进程。

这个设计带来的直接好处：

| 维度 | Docker | Podman 5.x |
|------|--------|------------|
| Daemon | 必须运行 dockerd | 无 Daemon |
| 默认权限 | root（需显式配置 rootless） | rootless 是默认 |
| systemd 集成 | 需要第三方方案 | Quadlet 原生集成 |
| Pod 概念 | 无（靠 compose） | 原生 Pod 支持 |
| OCI 兼容 | 自有格式 + OCI | 纯 OCI |
| 无 root 构建 | 需要额外配置 | Buildah 原生支持 |

---

## 二、安装与 Rootless 配置

### macOS 安装（Podman Machine）

```bash
# 安装 Podman
brew install podman

# 初始化 Podman Machine（基于 Linux VM）
podman machine init --cpus 4 --memory 4096 --disk-size 50

# 启动
podman machine start

# 验证
podman info
```

Podman Machine 在 macOS 上创建一个轻量级 Linux VM（基于 QEMU/Apple Virtualization），容器实际运行在这个 VM 里。与 Docker Desktop 类似，但更轻量。

### Linux 安装（以 Ubuntu/Debian 为例）

```bash
# 添加源
source /etc/os-release
echo "deb https://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/unstable/xUbuntu_${VERSION_ID}/ /" | sudo tee /etc/apt/sources.list.d/devel:kubic:libcontainers:unstable.list
curl -L "https://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/unstable/xUbuntu_${VERSION_ID}/Release.key" | sudo apt-key add -

sudo apt-get update
sudo apt-get install -y podman

# 验证 rootless 是否就绪
podman unshare cat /proc/self/uid_map
```

### Rootless 关键配置

Rootless 容器需要用户命名空间（user namespace）支持。确认以下配置：

```bash
# 检查 subuid/subgid 分配
cat /etc/subuid
# michael:100000:65536

cat /etc/subgid
# michael:100000:65536

# 如果没有，手动添加：
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 michael
```

配置容器注册表（`/etc/containers/registries.conf`）：

```toml
[registries.search]
registries = ['docker.io', 'ghcr.io', 'quay.io']

[registries.insecure]
registries = []

[registries.block]
registries = []
```

配置镜像加速（可选，国内网络环境）：

```toml
# /etc/containers/registries.conf.d/mirrors.conf
[[registry]]
location = "docker.io"

[[registry.mirror]]
location = "mirror.gcr.io"
```

### 验证 Rootless 环境

```bash
# 确认以非 root 运行
podman run --rm alpine id
# uid=0(root) gid=0(root)  ← 容器内是 root

# 但宿主机上对应的是非特权用户
podman top $(podman run -d nginx) user huser
# 显示映射后的非 root uid
```

---

## 三、Podman 常用命令对比

对于从 Docker 迁移的用户，最大的好消息是：**Podman CLI 几乎 100% 兼容 Docker 命令**。

```bash
# 甚至可以设置别名
alias docker=podman

# 容器生命周期
podman run -d --name web -p 8080:80 nginx
podman ps -a
podman stop web
podman rm web

# 镜像管理
podman images
podman pull docker.io/library/php:8.4-fpm
podman build -t myapp:latest .
podman rmi myapp:latest

# 卷和网络
podman volume create app-data
podman volume ls
podman network create app-net
podman network ls

# 日志和调试
podman logs -f web
podman exec -it web bash
podman inspect web
```

### Pod 操作（Podman 特有）

Pod 是 Podman 的一等公民，类似 Kubernetes 的 Pod 概念——多个容器共享网络命名空间：

```bash
# 创建 Pod
podman pod create --name myapp -p 8080:80 -p 3306:3306

# 在 Pod 中运行容器
podman run -d --pod myapp --name web nginx
podman run -d --pod myapp --name db mariadb:10

# 这两个容器共享 localhost，web 可以直接用 127.0.0.1:3306 访问 db
podman pod ps
podman pod inspect myapp
```

---

## 四、Quadlet：systemd 原生集成

Quadlet 是 Podman 4.4+ 引入、5.x 完善的核心特性。它让你用声明式的 `.container`、`.volume`、`.network` 文件定义容器服务，由 systemd 直接管理——**不需要 docker-compose，不需要额外的编排工具**。

### 为什么需要 Quadlet

传统方式下，要让容器在 Linux 启动时自动运行，你需要：
- 写 systemd unit 文件，里面调用 `podman run`
- 处理容器的启动顺序、依赖、日志
- 手动管理端口映射、卷挂载

Quadlet 把这一切变成了声明式配置：

```ini
# ~/.config/containers/systemd/web.container
[Unit]
Description=My Nginx Web Server
After=network-online.target

[Container]
Image=docker.io/library/nginx:alpine
PublishPort=8080:80
Volume=web-data.volume:/usr/share/nginx/html:ro
AutoUpdate=registry

[Service]
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
# 重新加载 systemd 配置
systemctl --user daemon-reload

# 启动服务
systemctl --user start web

# 查看状态
systemctl --user status web

# 开机自启（需要 lingering）
sudo loginctl enable-linger $(whoami)
```

### Quadlet 支持的单元类型

| 文件后缀 | 用途 | 示例 |
|----------|------|------|
| `.container` | 容器服务 | Nginx、PHP-FPM |
| `.volume` | 持久化卷 | 数据库存储 |
| `.network` | 自定义网络 | 应用隔离网络 |
| `.pod` | Pod 定义 | 多容器组合 |
| `.image` | 镜像拉取 | 预拉取策略 |
| `.build` | 构建镜像 | Dockerfile 构建 |
| `.kube` | Kubernetes YAML | K8s 兼容部署 |

### 实战：用 Quadlet 部署 Laravel 应用

创建以下文件结构：

```
~/.config/containers/systemd/
├── laravel-app.network
├── laravel-db.volume
├── laravel-app.container
├── laravel-nginx.container
└── laravel-queue.container
```

**网络定义**：

```ini
# ~/.config/containers/systemd/laravel-app.network
[Network]
NetworkName=laravel-app
Subnet=10.89.0.0/24
Gateway=10.89.0.1
```

**数据库卷**：

```ini
# ~/.config/containers/systemd/laravel-db.volume
[Volume]
VolumeName=laravel-db-data
```

**MySQL 容器**：

```ini
# ~/.config/containers/systemd/laravel-mysql.container
[Unit]
Description=Laravel MySQL Database
After=network-online.target

[Container]
Image=docker.io/library/mysql:8.0
Network=laravel-app.network
Volume=laravel-db.volume:/var/lib/mysql
Environment=MYSQL_ROOT_PASSWORD=secret
Environment=MYSQL_DATABASE=laravel
Environment=MYSQL_USER=laravel
Environment=MYSQL_PASSWORD=secret
HealthCmd=mysqladmin ping -h localhost
HealthInterval=30s
HealthRetries=3

[Service]
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**PHP-FPM + Laravel 容器**：

```ini
# ~/.config/containers/systemd/laravel-app.container
[Unit]
Description=Laravel PHP-FPM Application
After=laravel-mysql.container
Requires=laravel-mysql.container

[Container]
Image=docker.io/library/php:8.4-fpm-alpine
Network=laravel-app.network
Volume=/home/michael/projects/my-laravel-app:/var/www/html:Z
Volume=laravel-socket.volume:/var/run/php
Environment=APP_ENV=production
Environment=DB_HOST=laravel-mysql
Environment=DB_DATABASE=laravel
Environment=DB_USERNAME=laravel
Environment=DB_PASSWORD=secret
WorkingDir=/var/www/html

[Service]
Restart=always
RestartSec=5
ExecStartPre=/usr/local/bin/php artisan migrate --force

[Install]
WantedBy=multi-user.target
```

**Nginx 反向代理容器**：

```ini
# ~/.config/containers/systemd/laravel-nginx.container
[Unit]
Description=Laravel Nginx Reverse Proxy
After=laravel-app.container
Requires=laravel-app.container

[Container]
Image=docker.io/library/nginx:alpine
Network=laravel-app.network
PublishPort=80:80
PublishPort=443:443
Volume=/home/michael/projects/my-laravel-app/nginx.conf:/etc/nginx/conf.d/default.conf:ro,Z
Volume=laravel-socket.volume:/var/run/php:ro

[Service]
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**队列 Worker 容器**：

```ini
# ~/.config/containers/systemd/laravel-queue.container
[Unit]
Description=Laravel Queue Worker
After=laravel-mysql.container
Requires=laravel-mysql.container

[Container]
Image=docker.io/library/php:8.4-fpm-alpine
Network=laravel-app.network
Volume=/home/michael/projects/my-laravel-app:/var/www/html:Z
Environment=APP_ENV=production
Environment=DB_HOST=laravel-mysql
Environment=DB_DATABASE=laravel
Environment=DB_USERNAME=laravel
Environment=DB_PASSWORD=secret
WorkingDir=/var/www/html
ExecStart=/usr/local/bin/php artisan queue:work --sleep=3 --tries=3 --max-time=3600

[Service]
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

一次性启动整个应用栈：

```bash
systemctl --user daemon-reload
systemctl --user start laravel-mysql laravel-app laravel-nginx laravel-queue

# 查看所有服务状态
systemctl --user status 'laravel-*'

# 查看日志
journalctl --user -u laravel-app -f
```

---

## 五、从 docker-compose.yml 迁移到 Podman

这是很多人最关心的部分。实际上你有两条路：

### 路径一：直接用 podman-compose

Podman 5.x 对 compose 的兼容性已经很好：

```bash
# 安装 podman-compose
pip3 install podman-compose

# 直接用现有的 docker-compose.yml
cd ~/projects/my-laravel-app
podman-compose up -d

# 或者用 podman compose（Podman 5.x 内置）
podman compose up -d
```

大部分 `docker-compose.yml` 可以直接运行，但有一些注意事项：

```yaml
# docker-compose.yml 中的常见兼容性问题

services:
  app:
    # ❌ 不支持 build.context + build.dockerfile 的某些高级特性
    # ✅ 基本的 build: . 和 build: Dockerfile 可以工作
    build: .
    
    # ❌ depends_on.condition: service_healthy 在某些版本不完全支持
    # ✅ depends_on 的基本形式可以工作
    depends_on:
      - db
    
    # ❌ container_name 在 podman-compose 中可能导致问题
    # 因为 Podman 使用 pod 管理容器名
    # container_name: my-app  # 建议注释掉
    
    # ✅ 其他大部分配置完全兼容
    ports:
      - "8080:80"
    volumes:
      - .:/var/www/html
    environment:
      - DB_HOST=db
```

### 路径二：迁移到 Quadlet（推荐长期方案）

如果你在 Linux 上运行生产环境，Quadlet 是更好的选择。迁移步骤：

**第一步：分析 docker-compose.yml**

以一个典型的 Laravel 项目为例：

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - .:/var/www/html
    depends_on:
      - redis
      - mysql
    networks:
      - laravel

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - .:/var/www/html
    depends_on:
      - app
    networks:
      - laravel

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: laravel
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - laravel

  redis:
    image: redis:7-alpine
    networks:
      - laravel

  queue:
    build:
      context: .
      dockerfile: Dockerfile
    command: php artisan queue:work
    depends_on:
      - redis
      - mysql
    networks:
      - laravel

networks:
  laravel:

volumes:
  mysql-data:
```

**第二步：逐一转换为 Quadlet 文件**

```ini
# laravel.network
[Network]
NetworkName=laravel
```

```ini
# laravel-mysql.volume
[Volume]
VolumeName=mysql-data
```

```ini
# laravel-mysql.container
[Unit]
Description=MySQL for Laravel
After=network-online.target

[Container]
Image=docker.io/library/mysql:8.0
Network=laravel.network
Volume=laravel-mysql.volume:/var/lib/mysql
Environment=MYSQL_ROOT_PASSWORD=root
Environment=MYSQL_DATABASE=laravel
HealthCmd=mysqladmin ping -h localhost
HealthInterval=30s
HealthRetries=5

[Service]
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```ini
# laravel-redis.container
[Unit]
Description=Redis for Laravel
After=network-online.target

[Container]
Image=docker.io/library/redis:7-alpine
Network=laravel.network

[Service]
Restart=always

[Install]
WantedBy=multi-user.target
```

```ini
# laravel-app.container
[Unit]
Description=Laravel PHP-FPM
After=laravel-mysql.container laravel-redis.container
Requires=laravel-mysql.container

[Container]
Image=localhost/laravel-app:latest
Network=laravel.network
Volume=/home/michael/projects/my-laravel-app:/var/www/html:Z
Environment=DB_HOST=laravel-mysql
Environment=REDIS_HOST=laravel-redis
WorkingDir=/var/www/html

[Service]
Restart=always

[Install]
WantedBy=multi-user.target
```

```ini
# laravel-nginx.container
[Unit]
Description=Nginx for Laravel
After=laravel-app.container

[Container]
Image=docker.io/library/nginx:alpine
Network=laravel.network
PublishPort=80:80
Volume=/home/michael/projects/my-laravel-app/nginx.conf:/etc/nginx/conf.d/default.conf:ro,Z
Volume=/home/michael/projects/my-laravel-app:/var/www/html:ro,Z

[Service]
Restart=always

[Install]
WantedBy=multi-user.target
```

```ini
# laravel-queue.container
[Unit]
Description=Laravel Queue Worker
After=laravel-mysql.container laravel-redis.container

[Container]
Image=localhost/laravel-app:latest
Network=laravel.network
Volume=/home/michael/projects/my-laravel-app:/var/www/html:Z
Environment=DB_HOST=laravel-mysql
Environment=REDIS_HOST=laravel-redis
WorkingDir=/var/www/html
ExecStart=/usr/local/bin/php artisan queue:work --sleep=3 --tries=3

[Service]
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**第三步：构建自定义镜像**

Quadlet 支持 `.build` 单元：

```ini
# laravel-app.build
[Unit]
Description=Build Laravel App Image

[Build]
ImageTag=localhost/laravel-app:latest
File=Dockerfile
SetWorkingDirectory=/home/michael/projects/my-laravel-app
```

构建并启动：

```bash
# 构建镜像
systemctl --user start laravel-app.build

# 启动所有服务
systemctl --user start laravel-mysql laravel-redis laravel-app laravel-nginx laravel-queue
```

---

## 六、踩坑记录

### 坑 1：SELinux 卷标签

在 Fedora/RHEL 系统上，Rootless 容器挂载宿主机目录时会遇到 SELinux 权限问题。

```bash
# 错误现象：容器内无法读写挂载的目录
# permission denied

# 解决方案：在 Volume 挂载后加 :Z 标签
Volume=/home/michael/app:/var/www/html:Z

# :Z — 私有标签，只给这个容器用（推荐）
# :z — 共享标签，多个容器可以共用
```

### 坑 2：端口绑定 < 1024

Rootless 容器默认不能绑定 80/443 等特权端口：

```bash
# 错误：Error: rootlessport cannot expose privileged port 80

# 方案一：使用高端口映射
PublishPort=8080:80

# 方案二：调整内核参数（需要 root）
sudo sysctl net.ipv4.ip_unprivileged_port_start=80

# 方案三：使用 setcap
sudo setcap cap_net_bind_service=ep /usr/bin/podman
```

### 坑 3：DNS 解析

Rootless 容器内的 DNS 解析有时会失败：

```bash
# 检查 resolv.conf
podman run --rm alpine cat /etc/resolv.conf

# 如果为空或错误，手动指定 DNS
podman run --rm --dns 8.8.8.8 alpine nslookup google.com

# 全局配置
# ~/.config/containers/containers.conf
[network]
dns_servers = ["8.8.8.8", "1.1.1.1"]
```

### 坑 4：Podman Machine 磁盘空间

macOS 上的 Podman Machine 虚拟机磁盘默认较小：

```bash
# 查看磁盘使用
podman system df

# 清理未使用的资源
podman system prune -a --volumes

# 如果需要扩容 VM 磁盘
podman machine stop
podman machine rm
podman machine init --disk-size 100
podman machine start
```

### 坑 5：镜像仓库认证

Podman 使用的认证文件路径与 Docker 不同：

```bash
# Docker 使用 ~/.docker/config.json
# Podman 使用 ~/.config/containers/auth.json

# 登录私有仓库
podman login registry.example.com -u user -p pass

# 或者从 Docker 迁移认证
cp ~/.docker/config.json ~/.config/containers/auth.json
```

### 坑 6：Quadlet 环境变量文件

Quadlet 支持 `EnvironmentFile`，但路径解析有时让人困惑：

```ini
[Container]
# 绝对路径
EnvironmentFile=/home/michael/.config/containers/env/laravel.env

# .env 文件格式：KEY=VALUE（不加引号）
# 注意：不支持 ${VAR} 变量插值
```

### 坑 7：Podman 与 Docker Compose 的 network_mode

```yaml
# docker-compose.yml 中
services:
  app:
    # ❌ Podman 不支持 host 模式下的某些网络特性
    network_mode: host
    
    # ✅ 推荐使用明确的端口映射
    ports:
      - "8080:80"
```

---

## 七、性能对比实测

在同一台机器（M2 MacBook Pro, 16GB）上对比 Docker Desktop 和 Podman Machine：

| 测试项 | Docker Desktop | Podman Machine |
|--------|---------------|----------------|
| 冷启动 nginx | 1.2s | 0.9s |
| 构建 Laravel 镜像（首次） | 45s | 42s |
| 构建 Laravel 镜像（缓存） | 8s | 7s |
| 内存占用（空闲状态） | 2.1GB | 1.4GB |
| 100 容器并发启动 | 12s | 10s |

Podman 在资源占用上有明显优势，主要因为没有常驻 Daemon。

---

## 八、何时该用 Podman，何时留着 Docker

### 推荐用 Podman 的场景

- **生产环境 Linux 服务器**：Quadlet + systemd 是最优雅的方案
- **安全敏感场景**：Rootless 默认，无 Daemon 攻击面
- **CI/CD 流水线**：无 Daemon 意味着更快的启动和更低的资源消耗
- **Kubernetes 预研**：Pod 概念与 K8s 一致，平滑过渡

### 建议保留 Docker 的场景

- **团队协作**：如果团队都用 Docker，迁移成本高
- **Docker Desktop 重度用户**：Extensions、Scout 等生态依赖
- **macOS/Windows 日常开发**：Podman Machine 体验已接近，但仍有小差距
- **复杂的 Compose 项目**：某些高级 Compose 特性 Podman 还在追赶

### 混合使用方案

实际上两者可以共存：

```bash
# 根据项目选择工具
cd ~/projects/legacy-app && docker compose up -d
cd ~/projects/new-app && podman compose up -d

# 或者设置别名按需切换
alias ctool='podman'  # 默认用 podman
# 临时切回 docker
ctool=docker docker compose up
```

---

## 总结

Podman 5.x 已经不是一个"Docker 替代品"的实验性项目，而是一个有着独立设计理念的成熟容器运行时。它的核心优势：

1. **无 Daemon 架构**：更安全、更轻量、没有单点故障
2. **Rootless 默认**：容器逃逸不会获得 root 权限
3. **Quadlet + systemd**：生产环境的容器管理回归 Linux 原生方式
4. **Pod 原生支持**：为 Kubernetes 迁移铺路
5. **CLI 兼容**：迁移成本极低，`alias docker=podman` 即可

对于 Laravel 开发者来说，迁移的关键在于：
- 开发环境可以继续用 `podman-compose` 读取现有的 `docker-compose.yml`
- 生产环境建议逐步迁移到 Quadlet，享受 systemd 的进程管理能力
- 注意 SELinux 标签、特权端口、DNS 解析这几个常见坑

容器化的下一个十年，不一定属于 Docker。Podman 代表的无 Daemon、Rootless、OCI 原生方向，值得每个后端开发者认真对待。

---

*参考资料：*
- [Podman 官方文档](https://podman.io/docs)
- [Quadlet 文档](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
- [Podman vs Docker: A Comprehensive Comparison](https://www.redhat.com/en/topics/containers/podman-vs-docker)
