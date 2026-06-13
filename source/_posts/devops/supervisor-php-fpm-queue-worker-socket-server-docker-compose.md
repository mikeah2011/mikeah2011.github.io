---

title: Supervisor 进程管理实战：PHP-FPM/Queue Worker/Socket Server 的统一进程治理——对比 Docker Compose
keywords: [Supervisor, PHP, FPM, Queue Worker, Socket Server, Docker Compose, 进程管理实战, 的统一进程治理]
date: 2026-06-10 10:00:00
tags:
- Supervisor
- PHP-FPM
- Queue
- WebSocket
- Process Management
- Docker Compose
- Linux
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: Supervisor 是 Linux 下成熟的进程管理工具，可统一守护 PHP-FPM、Laravel Queue Worker、WebSocket Server 等长运行进程，提供崩溃自动重启、日志轮转、进程组与事件钩子等能力。本文结合 Laravel B2C 项目实战，给出 Supervisor 的完整配置模板、与 Docker Compose 的编排对比，以及在生产环境中常见的踩坑与调优策略。"
---



## TL;DR

Supervisor 是 Python 编写的跨平台进程管理工具（BSD 许可），核心能力包括：按程序组管理进程、崩溃自动重启（可配 backoff 与 exitcodes）、统一日志轮转、事件钩子（process_state 发送通知）、支持 HTTP/XML-RPC 管理接口。相比 Docker Compose 的 `restart: always`，Supervisor 提供更精细的进程治理：多实例并行（如 8 个 queue worker）、信号转发与优雅停机、基于 PID 的精确健康检查、以及与 systemd 的无缝集成。本文将从架构原理、配置模板、实战对比、踩坑记录四个维度展开，给出可直接落地的运维方案。

---

## 一、为什么需要 Supervisor？

### 1.1 长运行进程的治理痛点

在 Laravel B2C 项目中，典型需要守护的进程包括：

| 进程类型 | 特点 | 常见问题 |
|---------|------|---------|
| PHP-FPM | 传统 CGI 模式，按请求 fork/销毁 | 进程耗尽、内存泄漏累积 |
| Queue Worker | 常驻内存，循环处理任务 | 内存泄漏、任务卡死、消费者堆积 |
| WebSocket Server | 长连接，状态有状态 | 连接泄漏、进程僵死、端口占用 |
| 定时任务 | cron 调度 | 任务重叠、超时无处理 |
| Socket Server | 监听 Unix/TCP 端口 | 端口未释放、连接积压 |

这些进程的共同特点是：**必须 7×24 小时运行，崩溃后必须自动恢复，日志必须可追溯**。

### 1.2 Supervisor 的核心价值

Supervisor 解决了三个核心问题：

1. **进程守护**：崩溃自动重启，可配置退出码、重启间隔、最大重启次数
2. **统一管理**：一个配置文件管理所有进程，`supervisorctl` 命令行工具统一操作
3. **可观测性**：日志轮转（防止磁盘爆满）、事件钩子（崩溃通知）、HTTP API（监控集成）

---

## 二、架构原理

### 2.1 进程模型

```
┌─────────────────────────────────────────┐
│              supervisord 主进程           │
│  ┌───────────────┐  ┌───────────────┐  │
│  │  事件监听器     │  │  HTTP 服务器   │  │
│  │  (EventListener)│  │  (XML-RPC)   │  │
│  └───────┬───────┘  └───────┬───────┘  │
│          │                  │           │
│  ┌───────▼──────────────────▼───────┐  │
│  │           进程管理器              │  │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│  │
│  │  │FPM  │ │Queue│ │WS   │ │Cron ││  │
│  │  │proc1│ │proc2│ │proc3│ │proc4││  │
│  │  └─────┘ └─────┘ └─────┘ └─────┘│  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

关键设计：

- **supervisord**：主守护进程，以 root 身份运行，负责 fork/管理所有子进程
- **supervisorctl**：命令行客户端，通过 Unix socket 或 TCP 与 supervisord 通信
- **program 配置**：每个程序块定义一个进程类型，支持 `numprocs` 多实例并行

### 2.2 重启策略

Supervisor 的重启机制是其核心价值所在：

```ini
[program:laravel-worker]
command=php artisan queue:work --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
startsecs=10
startretries=3
exitcodes=0
stopsignal=QUIT
stopwaitsecs=10
```

参数解析：

| 参数 | 含义 | 推荐值 |
|------|------|-------|
| `autostart` | supervisord 启动时自动启动 | true |
| `autorestart` | 进程退出后自动重启 | true / unexpected |
| `startsecs` | 启动后持续运行多久算"成功" | 10 |
| `startretries` | 启动失败重试次数 | 3 |
| `exitcodes` | 正常退出码（不触发重启） | 0 |
| `stopsignal` | 停止进程的信号 | QUIT（Worker）/ TERM（FPM） |
| `stopwaitsecs` | 等待进程优雅退出的时间 | 10-60 |

---

## 三、配置模板

### 3.1 Laravel Queue Worker（多实例）

```ini
[program:laravel-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/html/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
startsecs=10
startretries=3
exitcodes=0
stopsignal=QUIT
stopwaitsecs=30
user=www-data
numprocs=8
stdout_logfile=/var/log/supervisor/laravel-worker.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stderr_logfile=/var/log/supervisor/laravel-worker-error.log
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=5
stopasgroup=true
killasgroup=true
```

关键配置说明：

- **`numprocs=8`**：启动 8 个 Worker 进程，并行处理队列任务
- **`--max-time=3600`**：每个 Worker 处理 1 小时后退出，防止内存泄漏累积
- **`stopasgroup=true`**：停止时发送信号给整个进程组，确保子进程也被终止
- **`killasgroup=true`**：强制终止时同样处理进程组

### 3.2 PHP-FPM 管理

```ini
[program:php-fpm]
command=/usr/sbin/php-fpm8.3 --nodaemonize --fpm-config /etc/php/8.3/fpm/php-fpm.conf
autostart=true
autorestart=true
startsecs=5
startretries=3
exitcodes=0
stopsignal=TERM
stopwaitsecs=10
user=root
stdout_logfile=/var/log/supervisor/php-fpm.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stderr_logfile=/var/log/supervisor/php-fpm-error.log
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=5
```

### 3.3 WebSocket Server（Laravel Reverb）

```ini
[program:laravel-reverb]
command=php /var/www/html/artisan reverb:start --port=8080
autostart=true
autorestart=true
startsecs=5
startretries=3
exitcodes=0
stopsignal=QUIT
stopwaitsecs=30
user=www-data
stdout_logfile=/var/log/supervisor/laravel-reverb.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stderr_logfile=/var/log/supervisor/laravel-reverb-error.log
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=5
```

### 3.4 事件钩子：崩溃自动通知

```ini
[eventlistener:crash-notification]
command=/var/www/scripts/crash-notify.sh
events=PROCESS_STATE
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/www/logs/crash-notify.log
```

对应的脚本：

```bash
#!/bin/bash
# /var/www/scripts/crash-notify.sh
# 读取 Supervisor 事件协议的数据

while read -r line; do
    # 跳过 header 部分
    if [[ "$line" == "end" ]]; then
        break
    fi
done

# 读取 event body
while read -r line; do
    if [[ "$line" == "end" ]]; then
        break
    fi

    case "$line" in
        process_name:*)
            PROCESS_NAME="${line#process_name: }"
            ;;
        from_state:*)
            FROM_STATE="${line#from_state: }"
            ;;
        to_state:*)
            TO_STATE="${line#to_state: }"
            ;;
        expected:*)
            EXPECTED="${line#expected: }"
            ;;
    esac
done

# 只处理意外退出
if [[ "$TO_STATE" == "FATAL" ]]; then
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    MESSAGE="[$TIMESTAMP] 进程异常退出: $PROCESS_NAME (from=$FROM_STATE, expected=$EXPECTED)"

    # 写入日志
    echo "$MESSAGE" >> /var/www/logs/process-crashes.log

    # 发送通知（Slack/企业微信/钉钉）
    curl -s -X POST https://hooks.slack.com/services/xxx \
        -H 'Content-Type: application/json' \
        -d "{\"text\": \"🚨 $MESSAGE\"}" > /dev/null 2>&1
fi

# 输出 OK 响应
echo "OK"
```

---

## 四、实战对比：Supervisor vs Docker Compose

### 4.1 场景设定

以 Laravel B2C 项目为例，需要管理：

- 1 个 PHP-FPM 进程池（8 个 worker）
- 8 个 Queue Worker 进程
- 1 个 WebSocket Server
- 1 个定时任务调度器

### 4.2 Docker Compose 方案

```yaml
# docker-compose.yml
services:
  app:
    image: laravel-app:latest
    volumes:
      - .:/var/www/html
    depends_on:
      - redis
      - mysql

  php-fpm:
    image: php:8.3-fpm
    volumes:
      - .:/var/www/html
    command: php-fpm

  queue-worker:
    image: laravel-app:latest
    command: php artisan queue:work redis --sleep=3 --tries=3
    deploy:
      replicas: 8
    depends_on:
      - redis

  reverb:
    image: laravel-app:latest
    command: php artisan reverb:start --port=8080
    depends_on:
      - redis

  scheduler:
    image: laravel-app:latest
    command: >
      sh -c "while true; do php artisan schedule:run --verbose --no-interaction & sleep 60; done"
```

**Docker Compose 的局限**：

- `replicas: 8` 创建 8 个相同容器，每个容器一个 Worker——**内存开销 ×8**
- 无法共享 PHP 运行时内存（OPcache、框架引导状态）
- 崩溃恢复依赖 Docker 引擎，重启延迟更高
- 无法细粒控制退出码、重启间隔、最大重试次数
- 日志分散在各个容器中，需要额外的日志聚合

### 4.3 Supervisor 方案

```ini
# /etc/supervisor/conf.d/laravel.conf

[program:php-fpm]
command=/usr/sbin/php-fpm8.3 --nodaemonize
autostart=true
autorestart=true
user=www-data

[program:laravel-worker]
command=php /var/www/html/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
numprocs=8
process_name=%(program_name)s_%(process_num)02d
autostart=true
autorestart=true
user=www-data
stopasgroup=true
killasgroup=true

[program:laravel-reverb]
command=php /var/www/html/artisan reverb:start --port=8080
autostart=true
autorestart=true
user=www-data

[program:laravel-scheduler]
command=sh -c "while true; do php /var/www/html/artisan schedule:run --verbose --no-interaction & sleep 60; done"
autostart=true
autorestart=true
user=www-data
```

**Supervisor 的优势**：

| 维度 | Docker Compose | Supervisor |
|------|---------------|-----------|
| 内存效率 | 每容器独立运行时（8 Worker ≈ 8×64MB） | 共享运行时（8 Worker ≈ 200MB 总计） |
| 启动速度 | 需拉取镜像、创建容器 | 直接 fork 进程，秒级启动 |
| 重启延迟 | Docker 引擎响应（5-30s） | Supervisor 直接重启（<1s） |
| 进程控制 | `docker compose restart`（粗粒度） | `supervisorctl restart worker_01`（细粒度） |
| 日志管理 | `docker logs`（无轮转） | `stdout_logfile_maxbytes`（自动轮转） |
| 信号处理 | 容器级信号转发 | 进程级信号转发（`stopsignal=QUIT`） |
| 监控集成 | 需要额外工具 | 内置 HTTP API / XML-RPC |

### 4.4 混合方案（推荐）

在实际生产中，**容器内 + Supervisor** 是最常见的组合：

```dockerfile
# Dockerfile
FROM php:8.3-fpm

# 安装 Supervisor
RUN apt-get update && apt-get install -y supervisor

# 复制 Supervisor 配置
COPY docker/supervisor/*.conf /etc/supervisor/conf.d/

# 启动 Supervisor（而非 php-fpm）
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
```

这样可以同时获得：

- **容器化**：环境一致性、镜像版本管理、K8s 编排
- **进程治理**：细粒度控制、自动重启、日志轮转、事件钩子

---

## 五、踩坑记录

### 5.1 进程组信号转发

**问题**：停止 Queue Worker 时，子进程未被完全终止，导致端口占用或任务卡死。

**原因**：默认情况下，`supervisorctl stop` 只发送信号给直接子进程，不会传递给孙进程。

**解决方案**：

```ini
[program:laravel-worker]
stopasgroup=true
killasgroup=true
```

`stopasgroup=true`：停止时向整个进程组发送信号。
`killasgroup=true`：强制终止时同样处理进程组。

### 5.2 内存泄漏累积

**问题**：Worker 运行数天后，内存持续增长，最终触发 OOM Killer。

**原因**：PHP 长期运行会累积内存泄漏（主要是扩展和全局变量）。

**解决方案**：

```ini
[program:laravel-worker]
command=php /var/www/html/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
```

`--max-time=3600`：每个 Worker 处理 1 小时后自动退出，Supervisor 会重启新进程。

### 5.3 日志轮转导致文件描述符泄漏

**问题**：Supervisor 日志轮转后，旧进程仍持有已删除文件的文件描述符，磁盘空间不释放。

**原因**：`stdout_logfile_maxbytes` 触发轮转时，如果子进程未重新打开日志文件，文件描述符仍指向旧文件。

**解决方案**：

```ini
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stdout_logfile=/var/log/supervisor/%(program_name)s.log
```

或者使用 `stdout_logfile_maxbytes=0` 禁用日志轮转，改用外部工具（如 logrotate）管理。

### 5.4 Supervisor 自身崩溃恢复

**问题**：supervisord 进程本身崩溃，所有子进程变成孤儿进程。

**解决方案**：使用 systemd 管理 supervisord：

```ini
# /etc/systemd/system/supervisor.service
[Unit]
Description=Supervisor process manager
After=network.target

[Service]
Type=forking
ExecStart=/usr/bin/supervisord -c /etc/supervisor/supervisord.conf
ExecReload=/usr/bin/supervisorctl reread && /usr/bin/supervisorctl update
ExecStop=/usr/bin/supervisorctl shutdown
PIDFile=/var/run/supervisord.pid
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5.5 多实例 Worker 的任务重复

**问题**：8 个 Queue Worker 同时抢同一个任务，导致任务重复执行。

**原因**：Laravel Queue 默认使用 Redis 的 `BRPOP`，多个 Worker 同时阻塞等待。

**解决方案**：

```bash
# 方案 1：使用不同的队列
php artisan queue:work redis --queue=high,default,low

# 方案 2：使用 --once 参数（每个 Worker 只处理一个任务后退出）
php artisan queue:work redis --once

# 方案 3：使用 Laravel Horizon（内置负载均衡）
php artisan horizon
```

### 5.6 端口冲突

**问题**：WebSocket Server 进程崩溃后重启，但端口仍被旧进程占用。

**解决方案**：

```ini
[program:laravel-reverb]
command=php /var/www/html/artisan reverb:start --port=8080
stopwaitsecs=30
stopsignal=TERM
```

确保 `stopwaitsecs` 足够长，让进程有时间释放端口。如果仍然冲突，可以在启动脚本中检查端口：

```bash
#!/bin/bash
PORT=8080
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "端口 $PORT 已被占用，等待释放..."
    sleep 5
    fuser -k $PORT/tcp 2>/dev/null
fi
exec php /var/www/html/artisan reverb:start --port=$PORT
```

---

## 六、监控与告警

### 6.1 HTTP API 集成

Supervisor 内置 HTTP 服务器，可暴露进程状态：

```ini
[inet_http_server]
port=*:9001
username=admin
password=secret
```

通过 `curl` 查询进程状态：

```bash
# 查看所有进程状态
curl -u admin:secret http://localhost:9001/RPC2 -d '<?xml version="1.0"?><methodCall><methodName>supervisor.getAllProcessInfo</methodName></methodCall>'

# 查看特定进程
curl -u admin:secret http://localhost:9001/RPC2 -d '<?xml version="1.0"?><methodCall><methodName>supervisor.getProcessInfo</methodName><params><param><value><string>laravel-worker:laravel-worker_00</string></value></param></params></methodCall>'
```

### 6.2 Prometheus + Grafana 监控

使用 `supervisor_exporter` 将进程状态暴露为 Prometheus 指标：

```bash
# 安装 supervisor_exporter
go install github.com/lynxsecurity/supervisor_exporter@latest

# 启动 exporter
supervisor_exporter --supervisor.url=http://localhost:9001/RPC2 --web.listen-address=:9002
```

Grafana Dashboard 关键指标：

- `supervisor_process_info{state="running"}`：运行中进程数
- `supervisor_process_info{state="fatal"}`：崩溃进程数
- `supervisor_process_exit_time`：进程退出时间戳

---

## 七、与 systemd 的集成

在现代 Linux 发行版中，systemd 是事实上的进程管理标准。Supervisor 可以作为 systemd 的上层管理器：

```
systemd → supervisord → php-fpm / queue-worker / reverb
```

或者直接使用 systemd 替代 Supervisor：

```ini
# /etc/systemd/system/laravel-worker@.service
[Unit]
Description=Laravel Queue Worker %i
After=network.target redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/html
ExecStart=/usr/bin/php artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3

[Install]
WantedBy=multi-user.target
```

启动 8 个 Worker：

```bash
# 使用 systemd template 启动 8 个实例
for i in {01..08}; do
    systemctl enable --now laravel-worker@${i}
done
```

**选型建议**：

- **简单场景**（2-3 个进程）：直接用 systemd
- **复杂场景**（10+ 进程、需要事件钩子）：用 Supervisor
- **容器化场景**：容器内用 Supervisor，外部用 Kubernetes

---

## 八、总结

Supervisor 不是银弹，但它解决了 PHP 长运行进程治理的核心问题：

1. **自动恢复**：崩溃自动重启，可配退出码和重试策略
2. **统一管理**：一个配置文件管理所有进程，`supervisorctl` 命令行操作
3. **可观测性**：日志轮转、事件钩子、HTTP API
4. **资源效率**：共享运行时内存，比容器化方案更高效

在 Laravel B2C 项目中，推荐的架构是：**systemd → supervisord → PHP-FPM / Queue Worker / WebSocket Server**。这样既获得了 systemd 的可靠守护，又获得了 Supervisor 的细粒度进程治理能力。

---

## 参考资源

- [Supervisor 官方文档](http://supervisord.org/index.html)
- [Laravel Queue 文档](https://laravel.com/docs/queues)
- [Laravel Horizon 文档](https://laravel.com/docs/horizon)
- [Laravel Reverb 文档](https://laravel.com/docs/reverb)
- [PHP-FPM 配置指南](https://www.php.net/manual/en/install.fpm.configuration.php)
