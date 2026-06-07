# Docker 容器化

## 定义

Docker 是一个开源的容器化平台，通过操作系统级虚拟化（Linux Namespace + Cgroups）将应用及其依赖打包为标准化的、可移植的容器镜像，实现「一次构建，到处运行」。与虚拟机不同，容器共享宿主机内核，启动速度从分钟级缩短到秒级，资源开销降低 90% 以上。

## 核心原理

### 镜像分层与 UnionFS
Docker 镜像由多个只读层（Layer）叠加组成，每一层代表一次文件系统变更。运行时在顶部添加一个可写层（Container Layer），所有修改都发生在这一层。这种设计使得多个容器可以共享相同的底层镜像，大幅减少存储和传输开销。

### 多阶段构建（Multi-stage Build）
生产环境的镜像应尽可能精简。多阶段构建允许在一个 Dockerfile 中使用多个 `FROM` 指令：第一阶段包含完整的编译工具链（Composer、Node.js），第二阶段仅复制编译产物到精简基础镜像（如 `php:8.3-fpm-alpine`），最终镜像体积可缩小 60-80%。

```dockerfile
# 第一阶段：编译
FROM composer:2 AS builder
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist
COPY . .
RUN composer dump-autoload --optimize

# 第二阶段：生产镜像
FROM php:8.3-fpm-alpine
COPY --from=builder /app /var/www/html
```

### Docker Compose 编排
当应用由多个服务组成（Web + Queue Worker + Scheduler + Database + Redis），Docker Compose 通过声明式 YAML 定义服务间的依赖关系、网络拓扑和数据卷挂载，一条命令 `docker compose up -d` 即可启动完整环境。

### 容器网络模式
- **bridge**：默认模式，容器间通过虚拟网桥通信
- **host**：共享宿主机网络栈，性能最高但隔离性最差
- **none**：无网络，适用于纯计算任务
- **overlay**：跨主机容器通信，Docker Swarm/K8s 使用

### 数据持久化
- **Volume**：Docker 管理的存储卷，生命周期独立于容器
- **Bind Mount**：直接挂载宿主机目录，适合开发环境热重载
- **tmpfs**：内存文件系统，适合临时数据

## 生产环境最佳实践

### 安全加固
- 不以 root 用户运行容器（`USER www-data`）
- 使用 `.dockerignore` 排除敏感文件（`.env`、`.git`）
- 定期扫描镜像漏洞（`docker scout cves`）
- 设置只读文件系统（`--read-only`）

### 日志管理
Docker 默认使用 `json-file` 日志驱动，长时间运行的容器可能吃满磁盘。生产环境应配置日志轮转：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

### 健康检查
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD php-fpm-healthcheck || exit 1
```

## 实战案例

来自博客文章：
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/2026/06/02/Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/) — Docker Compose 多服务编排、Dockerfile 最佳实践
- [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器](/2026/06/02/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/) — Docker/K8s 集成方案
- [Railway vs Fly.io vs Render：2026 年 Laravel 应用云部署平台选型对比](/2026/06/02/Railway-vs-Fly-io-vs-Render-2026年Laravel应用云部署平台选型对比/) — Dockerfile 配置示例

## 相关概念

- [CI/CD 流水线](CI-CD流水线.md) — GitHub Actions 中构建与推送 Docker 镜像
- [云部署平台选型](云部署平台选型.md) — Coolify/Fly.io/Railway 的容器化部署
- [基础设施即代码](基础设施即代码.md) — Terraform 管理容器基础设施
- [Web 服务器选型](Web服务器选型.md) — Caddy/Nginx 在容器中的反向代理配置

## 常见问题

### 镜像体积过大
- 使用 Alpine 基础镜像而非 Ubuntu/Debian
- 合并 `RUN` 指令减少层数
- 使用 `.dockerignore` 排除不必要文件
- 多阶段构建分离编译与运行环境

### 容器时区不一致
```dockerfile
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
```

### 容器间通信失败
- 确认服务在同一 Docker network 中
- 使用服务名而非 `localhost` 作为主机名
- 检查端口映射是否正确（`ports` vs `expose`）
