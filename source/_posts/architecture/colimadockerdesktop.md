---

title: Colima 替代 Docker Desktop：Laravel docker-compose 实战与性能对比
keywords: [Colima, Docker Desktop, Laravel docker, compose, 替代, 实战与性能对比]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-01 21:50:00
categories:
- architecture
- docker
tags:
- Docker
- Laravel
- macOS
description: Colima替代Docker Desktop实战指南：基于KKday B2C Laravel 8项目，详解Colima安装配置、vz虚拟化与virtiofs性能优化、docker-compose编排、Pest/ParaTest测试加速，对比Docker Desktop与Rancher Desktop在macOS M系列芯片上的许可证、内存占用与IO性能差异，附常见踩坑与团队迁移方案
---


> 一句话总结：**M 系列 Mac + Laravel docker-compose，Colima 已经可以无缝替代 Docker Desktop**，而且免费、轻量、可脚本化。本文是我在 KKday B2C 后端日常用了半年多之后的复盘。

## 1. 为什么要把 Docker Desktop 换掉

公司里 Mac 装 Docker Desktop 这件事，从 2021 年 Docker 改许可协议之后就一直是个尴尬话题：

- 250 人以上 / 年营收 1000 万美金以上的公司**商用必须付费**（Pro/Team/Business）。
- M1/M2/M3 上 Docker Desktop 一开就吃 4~6G 内存，风扇起飞。
- VirtioFS 之后 IO 是好了不少，但 `vendor/` 目录上百 MB 的 Laravel 项目，第一次 `composer install` + `php artisan` 启动还是肉眼可见的慢。
- 后台常驻进程 `com.docker.backend`、`Docker Desktop Helper` 一堆，关掉之后系统瞬间凉快。

我们 BFF 项目的 `docker-compose.yml` 大致结构：

```yaml
services:
  php-fpm:
    build: ./local-docker/php-fpm-8.0
    volumes:
      - ./:/var/www/html:cached
    depends_on: [mysql, redis]
  nginx:
    image: nginx:1.25-alpine
    ports: ["8080:80"]
  mysql:
    image: mysql:8.0
  postgres:
    image: postgres:15
  redis:
    image: redis:7-alpine
```

跑 Pest 全量测试 + ParaTest 8 进程的时候，Docker Desktop 下 CPU 长期 200%+，风扇直接拉满。换 Colima 之后明显安静。

## 2. Colima 是什么

[Colima](https://github.com/abiosoft/colima) = **Co**ntainers on **Lima**。

- 底层是 [Lima](https://github.com/lima-vm/lima)（轻量 Linux VM）。
- 容器运行时可选 Docker 或 containerd。
- 完全 CLI、零 GUI、无 Electron。
- **MIT 许可证**，公司用合规无压力。

它和 Docker Desktop 的关系，可以理解为：

| 维度 | Docker Desktop | Colima |
| --- | --- | --- |
| GUI | 有（Electron） | 无 |
| 许可证 | 商业付费 | MIT 免费 |
| 内存占用（空载） | 3~5 GB | 800MB ~ 1.5 GB |
| 文件共享 | VirtioFS / gRPC FUSE | 9p / sshfs / **virtiofs**（推荐） |
| K8s | 内置 | `colima start --kubernetes` 一键 |
| Compose | 自带 | 装 `docker-compose` plugin 即可 |
| Apple Silicon | 原生 arm64 | 原生 arm64，可 `--arch x86_64` 跑 amd64 镜像 |

### Colima vs Docker Desktop vs Rancher Desktop 三者对比

除了 Colima，macOS 上还有 [Rancher Desktop](https://github.com/rancher-sandbox/rancher-desktop) 可以选择。下表从多个维度做横向对比：

| 维度 | Docker Desktop | Colima | Rancher Desktop |
| --- | --- | --- | --- |
| 许可证 | 商业付费（250人+公司） | MIT 免费 | Apache 2.0 免费 |
| GUI | Electron GUI | 纯 CLI | Electron GUI |
| 空载内存 | 4~6 GB | 0.8~1.5 GB | 1.5~2.5 GB |
| 虚拟化 | HyperKit / VirtioFS / QEMU | vz / QEMU | vz / QEMU / gVisor |
| 容器运行时 | Docker Engine | Docker 或 containerd | containerd（nerdctl） |
| K8s 支持 | 内置一键开启 | `colima start --kubernetes` | 内置一键开启 |
| docker compose | 自带 | 需装 plugin | 需装 nerdctl compose |
| 原生 docker CLI | ✅ 完全兼容 | ✅ 完全兼容 | ❌ 用 nerdctl 替代 |
| macOS 启动项 | 有 | 无 | 有 |
| 更新方式 | App 自动更新 | `brew upgrade colima` | App 自动更新 |
| ARM → x86 兼容 | Rosetta 模式 | `--arch x86_64`（QEMU） | QEMU user-mode |
| 适用场景 | 重度 GUI 用户 / 企业合规 | CLI 为主的后端开发 | 想要 GUI + containerd 的团队 |

> **选型建议**：如果你是命令行为主的 PHP/Go 后端开发者，Colima 性能最优、内存最省。如果你团队需要 GUI 管理容器且不想付 Docker Desktop 费用，Rancher Desktop 是不错的折中。

## 3. 一次干净的安装

```bash
# 卸载 Docker Desktop（如果还装着）
brew uninstall --cask docker

# 装 Colima 套件
brew install colima docker docker-compose docker-buildx

# 让 docker compose 子命令生效
mkdir -p ~/.docker/cli-plugins
ln -sfn $(brew --prefix)/opt/docker-compose/bin/docker-compose \
        ~/.docker/cli-plugins/docker-compose
ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx \
        ~/.docker/cli-plugins/docker-buildx
```

启动一台**给 Laravel 用的合理配置**的 VM：

```bash
colima start \
  --cpu 4 \
  --memory 8 \
  --disk 60 \
  --vm-type vz \
  --mount-type virtiofs \
  --mount $HOME/GitHub:w
```

几个关键参数解释：

- `--vm-type vz`：用 macOS 13+ 自带的 **Virtualization.framework**，比默认 QEMU 快很多。
- `--mount-type virtiofs`：文件共享性能最好的方式，PHP `require` 上千个文件不再卡。
- `--mount $HOME/GitHub:w`：只挂代码目录、可写。**不要全盘挂 `$HOME`**，会拖慢 IO。

验证：

```bash
docker context ls
docker run --rm hello-world
docker compose version
```

## 4. Laravel docker-compose 的实测对比

用我们 BFF 项目（Laravel 8 + PHP-FPM 8.0 + MySQL 8 + Redis 7 + Postgres 15），同一台 M2 Pro / 32G。

| 场景 | Docker Desktop 4.32 | Colima 0.7 (vz + virtiofs) |
| --- | --- | --- |
| `docker compose up -d` 冷启动 | 38s | **22s** |
| `composer install`（vendor 已存在） | 19s | **11s** |
| `php artisan route:list` | 4.2s | **2.1s** |
| Pest 全量（约 600 用例 / ParaTest 8） | 2m48s | **1m52s** |
| 空载内存占用 | 4.6 GB | **1.3 GB** |
| 风扇噪音（主观） | 起飞 | 几乎听不到 |

> 性能差距核心来自两点：**vz 虚拟化 + virtiofs**。如果你 Colima 还在用默认 `qemu` + `sshfs`，体感不会比 Docker Desktop 好。

## 5. 我踩过的坑

### 5.1 `docker compose` 找不到

`brew install docker` 只装 CLI，不会自动放 compose 插件。要手动 `ln` 到 `~/.docker/cli-plugins`。否则 `docker compose up` 会报 `'compose' is not a docker command`。

### 5.2 多 context 串味

如果之前装过 Docker Desktop，会留下 `desktop-linux` context。Colima 启动会建 `colima` context，记得：

```bash
docker context use colima
```

否则你 `docker ps` 看不到容器还以为没起来。

### 5.3 `host.docker.internal` 不通

Colima 默认**没有**这个 hostname。Laravel 里如果有代码写死 `host.docker.internal` 连本机 Java svc-search，会连不上。两种解法：

```bash
# 方法 A：启动时加 dns hosts
colima start --dns-hosts host.docker.internal=192.168.5.2

# 方法 B：compose 里显式声明
services:
  php-fpm:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

我们项目最后选了方法 B，因为对队友零侵入。

### 5.4 跑 amd64 镜像

公司 CI 推的镜像有些只有 amd64（老的 Java 服务），M 芯片直接 pull 会报 `no matching manifest`。

```bash
# 单次跑
docker run --platform linux/amd64 some/legacy:tag

# 或开一台 amd64 的 colima profile
colima start --profile amd --arch x86_64 --vm-type qemu
docker context use colima-amd
```

注意 `--arch x86_64` 时**不能用 vz**，只能回到 qemu，性能会差不少。

### 5.5 端口被占

Colima 把容器端口转发到 host 是通过 `socket_vmnet` / `gvproxy` 实现的。如果你之前 brew 装过 `nginx`、`mysql` 没关，`8080`、`3306` 会冲突。`lsof -iTCP -sTCP:LISTEN -P` 一把梭。

### 5.6 磁盘膨胀

Colima 的虚拟磁盘是 sparse 的，但**只增不减**。半年下来我那个 60G 盘真实占用 45G。清理：

```bash
docker system prune -a --volumes
colima ssh -- sudo fstrim -av
```

如果要彻底回收，只能 `colima delete` 重建。

### 5.7 容器健康检查配置

迁移到 Colima 后，建议给 `docker-compose.yml` 加上 health check，避免服务还没 ready 就开始请求：

```yaml
services:
  mysql:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p$$MYSQL_ROOT_PASSWORD"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
  php-fpm:
    build: ./local-docker/php-fpm-8.0
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
```

> **注意**：Docker Desktop 的 `depends_on` 默认行为和 Colima 一致（都依赖 Docker Engine），但早期版本的 Compose 不支持 `condition: service_healthy`，需要 Compose V2+。

### 5.8 实战调试案例

#### 案例一：`php artisan migrate` 卡住不动

**症状**：`docker compose exec php-fpm php artisan migrate` 执行后无响应，Ctrl+C 也退不出来。

**排查过程**：

```bash
# 1. 查看容器资源使用
docker stats --no-stream
# 发现 mysql 容器 CPU 100%，内存持续增长

# 2. 进入 MySQL 容器看日志
docker compose logs mysql --tail 50
# 发现 InnoDB buffer pool 在初始化，60G 磁盘分配了 1G buffer pool

# 3. 解决：限制 MySQL 内存
# 在 docker-compose.yml 中加：
#   command: --innodb-buffer-pool-size=256M --max-connections=50
```

**修复后的 MySQL 配置**：

```yaml
mysql:
  image: mysql:8.0
  command: >
    --innodb-buffer-pool-size=256M
    --max-connections=50
    --slow-query-log=1
    --long-query-time=2
  volumes:
    - mysql_data:/var/lib/mysql
    - ./docker/mysql/my.cnf:/etc/mysql/conf.d/custom.cnf
```

#### 案例二：`composer install` 报 `proc_open(): fork failed`

**症状**：容器内执行 `composer install` 时报 `proc_open(): fork failed - Cannot allocate memory`。

**原因**：Colima VM 内存分配不足，PHP 进程 fork 失败。

**修复**：

```bash
# 查看当前 VM 配置
colima status

# 重启并增加内存
colima stop
colima start --memory 8  # 从默认 2G 增加到 8G

# 如果已经是 8G，检查宿主机是否内存不足
# Colima 默认使用 ~60% 可用内存，32G Mac 约分配 19G
# 确保没有其他大型应用占用内存
```

#### 案例三：容器间 DNS 解析失败

**症状**：`php-fpm` 容器无法解析 `mysql` 主机名，`ping mysql` 返回 `bad address`。

**排查**：

```bash
# 1. 检查容器网络
docker network ls
docker network inspect <project>_default

# 2. 检查 docker-compose.yml 中网络配置
# 确保所有服务在同一个网络下

# 3. 重启 Docker 引擎（Colima）
colima stop
colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs
```

**预防措施**：在 `docker-compose.yml` 中显式声明网络：

```yaml
networks:
  laravel-net:
    driver: bridge

services:
  php-fpm:
    networks: [laravel-net]
  mysql:
    networks: [laravel-net]
  redis:
    networks: [laravel-net]
```

#### 案例四：`Xdebug` 远程调试连不上

**症状**：PhpStorm 配置了 Xdebug 但断点不生效，连接被拒绝。

**原因**：Colima 的端口转发机制与 Docker Desktop 不同，Xdebug 的 `client_host` 需要指向宿主机。

**修复**：

```bash
# 获取宿主机 IP（Colima 环境下）
colima ssh -- ip route | grep default | awk '{print $3}'
# 输出类似 192.168.5.2
```

```yaml
# docker-compose.yml 中配置 Xdebug 环境变量
php-fpm:
  environment:
    XDEBUG_MODE: debug
    XDEBUG_CLIENT_HOST: host.docker.internal
    XDEBUG_CLIENT_PORT: 9003
    # 如果 host.docker.internal 不通，用宿主机实际 IP：
    # XDEBUG_CLIENT_HOST: 192.168.5.2
  extra_hosts:
    - "host.docker.internal:host-gateway"
```

### 5.9 常用排查命令速查

```bash
# 查看 Colima VM 状态
colima status

# 查看 VM 磁盘使用情况
colima ssh -- df -h

# 查看 VM 内存使用
colima ssh -- free -h

# 进入 Colima VM 调试
colima ssh

# 查看 Docker daemon 日志
colima ssh -- sudo journalctl -u docker --no-pager -n 50

# 重启 Docker daemon（不重启 VM）
colima ssh -- sudo systemctl restart docker

# 查看端口占用（宿主机）
lsof -iTCP -sTCP:LISTEN -P | grep -E '(8080|3306|5432|6379)'

# 完整重建流程
colima delete
colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs --mount $HOME/GitHub:w
docker compose up -d --build
```

## 6. 怎么把团队迁过去

我在团队里推这个的步骤，供参考：

1. **先解决许可证焦虑**：把 Docker Desktop 商用条款邮件转给主管，让 IT 出政策。
2. **写一个 `make colima-up` 脚本**：把 `colima start` 那一长串参数封装好，新人 `git clone` 完直接跑。
3. **CI 不动**：CI 还是 Linux 原生 docker，本地切 Colima 不影响 pipeline。
4. **保留逃生通道**：Docker Desktop 的 cask 留着安装包，万一某个新工具（比如 Docker Scout、Docker Build Cloud）只在 Desktop 里有，可以临时切回去。

`Makefile` 片段：

```makefile
COLIMA_PROFILE ?= default

up:
	@colima status -p $(COLIMA_PROFILE) >/dev/null 2>&1 || \
	colima start -p $(COLIMA_PROFILE) \
	  --cpu 4 --memory 8 --disk 60 \
	  --vm-type vz --mount-type virtiofs \
	  --mount $$HOME/GitHub:w
	docker compose up -d

down:
	docker compose down

nuke:
	docker compose down -v
	colima stop -p $(COLIMA_PROFILE)
```

## 7. 什么时候**不要**用 Colima

- 你团队里有不会命令行的设计/PM 也要跑容器 → Docker Desktop 的 GUI 还是更友好。
- 你重度依赖 Docker Desktop 的 Dev Environments、Docker Scout、Build Cloud。
- 你需要 **Windows + WSL2 + Docker** 一致体验 → Colima 只在 macOS 和 Linux 上有。
- 你跑大量 amd64 老镜像 → 性能会被 QEMU 拖累，可能还不如 Docker Desktop 的 Rosetta 模式。

## 8. 小结

对一个典型的 KKday 后端 RD 工作流（Laravel 8 BFF + 多服务 compose + Pest 测试 + 偶尔起一下 Postgres / Kafka），Colima 已经完全够用，而且：

- ✅ 合规免费
- ✅ 内存省一半以上
- ✅ vz + virtiofs 性能略胜 Docker Desktop
- ✅ 完全 CLI，可纳入 Makefile / dotfiles
- ⚠️ amd64 跨架构、GUI 操作仍是短板

如果你和我一样长期在 Mac 上跑 docker-compose，强烈建议花一个下午迁过去。回不去了。

---

**后续可写**：

- Colima 跑 Kafka + Schema Registry 的 docker-compose 模板
- `colima` + `lima` 起一台纯 Linux dev VM 当 staging
- Tailscale + Colima：让队友直连我本地 BFF

## 相关阅读

- [Docker Compose Laravel 本地开发环境实战：PHP-FPM 8.3 + MySQL + Redis + Mailpit 完整搭建指南](/categories/DevOps/docker-compose-laravel-guide-php-fpm-8-3-mysql-redis-mailpit-guide/)
- [Docker 多阶段构建实战：PHP 应用镜像从 500MB 优化到 50MB](/categories/DevOps/docker-guide-php-imageoptimization-500mb50mb/)
- [Kubernetes 本地开发：minikube vs kind vs k3s 选型实战](/categories/DevOps/kubernetes-minikube-kind-k3s-guide-laravel/)
