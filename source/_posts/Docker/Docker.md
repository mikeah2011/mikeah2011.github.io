---
title: Docker
tags:
  - Docker
  - 容器
  - DevOps
categories:
  - Docker
date: 2020-03-20 15:05:07
description: 'Docker 是一个开源的容器化平台，通过 Linux Namespace + Cgroups 把进程打包成可移植的镜像，做到「一次构建、到处运行」。本文梳理核心概念、常用命令和踩坑笔记。'
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

## 参考

- 官方文档：<https://docs.docker.com>
- Dockerfile 最佳实践：<https://docs.docker.com/develop/develop-images/dockerfile_best-practices/>
- Play with Docker（在线沙箱）：<https://labs.play-with-docker.com>
