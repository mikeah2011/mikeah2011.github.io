---

title: PHP 进程模型深度剖析：PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制
keywords: [PHP, FPM worker, graceful reload, 进程模型深度剖析, 生命周期, 信号处理与, 的底层机制]
date: 2026-06-04 10:00:00
tags:
- PHP
- PHP-FPM
- 进程模型
- 信号处理
- 优雅重载
- 进程管理
categories:
- php
description: 深入剖析 PHP-FPM Worker 进程生命周期、信号处理机制与 Graceful Reload 底层实现。涵盖 Master-Worker 架构源码解析、SIGQUIT/SIGUSR2 信号分发、self-pipe trick、process_control_timeout 安全网、三种 PM 模式（static/dynamic/ondemand）对比，以及生产环境零停机部署脚本、reload 丢请求排查、Worker 僵尸进程诊断等踩坑案例。适合需要深入理解 PHP-FPM 进程管理与优雅重载机制的后端工程师和 SRE。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---




## 前言

在生产环境中部署 PHP 应用时，PHP-FPM（FastCGI Process Manager）是我们每天都在打交道的组件，但很多开发者对它的内部机制知之甚少。当执行 `systemctl reload php-fpm` 时，到底发生了什么？worker 进程是如何优雅退出的？master 进程又是如何管理数百个子进程的？

本文将从源码级别深度剖析 PHP-FPM 的进程模型、信号处理机制以及 graceful reload 的底层实现，帮助你真正理解这个"黑盒"的内部运作。

---

## 一、PHP-FPM 整体架构

PHP-FPM 采用经典的 **Master-Worker 多进程架构**，这种架构在 Unix 系统中极为常见（如 Nginx、PostgreSQL）。

### 1.1 三层进程模型

```
┌─────────────────────────────────────┐
│         php-fpm (master)            │  ← PID 1, 管理者
│   - 读取配置                         │
│   - 管理 worker 生命周期              │
│   - 处理信号                         │
│   - 监听端口/Unix socket             │
├─────────────────────────────────────┤
│   worker 1  │  worker 2  │  ...     │  ← 工作进程，处理实际请求
│   (fpm_     │  (fpm_     │          │
│   worker_   │  worker_   │          │
│   main)     │  main)     │          │
├─────────────────────────────────────┤
│   pool 1 (www)    │  pool 2 (api)  │  ← 进程池，独立配置
└─────────────────────────────────────┘
```

**Master 进程**的职责：
- 解析 `php-fpm.conf` 和各 pool 配置
- 创建并管理 worker 进程
- 监听信号（SIGTERM、SIGQUIT、SIGUSR1、SIGUSR2 等）
- 执行 graceful reload / restart

**Worker 进程**的职责：
- 接受来自 Nginx/Apache 的 FastCGI 请求
- 执行 PHP 脚本
- 返回处理结果

### 1.2 源码中的进程结构

查看 PHP 源码 `sapi/fpm/fpm/fpm_children.c`，master 通过 `fork()` 创建 worker：

```c
// 简化的源码逻辑
static struct fpm_child_s *fpm_resources_prepare(struct fpm_worker_pool_s *wp) {
    struct fpm_child_s *child;
    
    // 分配子进程资源结构体
    child = calloc(1, sizeof(struct fpm_child_s));
    child->wp = wp;
    child->scoreboard_i = fpm_scoreboard_proc_alloc(wp);
    return child;
}

pid_t pid = fork();
if (pid == 0) {
    // 子进程：执行 worker 主循环
    fpm_child_init(wp);
    fpm_worker_main(wp);  // 进入请求处理循环
} else {
    // 父进程（master）：记录子进程信息
    child->pid = pid;
    fpm_parent_children_add(child);
}
```

---

## 二、Worker 进程生命周期详解

### 2.1 生命周期状态机

一个 worker 进程从创建到消亡经历以下状态：

```
                 fork()
  [不存在] ──────────────→ [启动中]
                              │
                      fpm_child_init()
                              ↓
  [回收中] ←────────────── [运行中] ←──┐
      │                      │         │ accept()
      │                      │         │ 处理请求
      │               信号/超时        │
      │                      ↓         │
      │                 [停止中] ───────┘
      │                      │
      │              fpm_worker_exit()
      │                      ↓
      └──────────────── [僵尸进程]
                              │
                      waitpid() by master
                              ↓
                          [已回收]
```

### 2.2 各阶段详细说明

**启动阶段（Startup）**

```c
// fpm.c - 子进程初始化
int fpm_child_init(struct fpm_worker_pool_s *wp) {
    // 1. 设置进程标题
    fpm_process_set_title("pool %s worker", wp->config->name);
    
    // 2. 初始化 scoreboard（性能统计共享内存）
    fpm_scoreboard_child_use(wp);
    
    // 3. 设置信号处理函数
    fpm_signals_init_child();
    
    // 4. 初始化事件循环（epoll/kqueue）
    fpm_event_init_child();
    
    // 5. 关闭 master 的监听 socket（子进程需要 dup 自己的）
    fpm_sockets_close_master();
    
    return 0;
}
```

**运行阶段（Running）**

worker 在主循环中执行以下操作：

```
while (1) {
    // 1. 等待连接事件（epoll_wait/kqueue）
    ret = fpm_event_wait(-1);
    
    // 2. 检查是否收到终止信号
    if (fpm_got_signal) {
        break;
    }
    
    // 3. 接受 FastCGI 连接
    conn = accept(listen_fd, ...);
    
    // 4. 读取 FastCGI 请求
    request = fpm_request_read(conn);
    
    // 5. 执行 PHP 脚本
    fpm_execute_script(request);
    
    // 6. 返回响应
    fpm_request_write_response(request);
    
    // 7. 关闭连接
    close(conn);
    
    // 8. 检查 max_requests 限制
    if (++requests_handled >= max_requests) {
        break;  // 达到最大请求数，退出以便 master 重建
    }
}
```

**停止阶段（Shutdown）**

当 worker 收到终止信号或达到 `pm.max_requests` 时，进入停止流程：

```c
void fpm_worker_exit() {
    // 1. 完成当前请求处理
    // 2. 关闭数据库连接、清理资源
    // 3. 更新 scoreboard 状态
    fpm_scoreboard_proc_free(scoreboard_i);
    // 4. 调用扩展的 shutdown 函数（如 opcache、redis 连接池等）
    zend_deactivate();
    // 5. 进程退出
    exit(0);
}
```

---

## 三、信号处理机制深度解析

### 3.1 信号注册源码

在 `sapi/fpm/fpm/fpm_signals.c` 中，master 进程注册信号处理函数：

```c
// master 进程的信号处理
static void sig_handler(int signo) {
    // 注意：信号处理器中不能调用非异步安全函数
    // 只能通过管道通知主事件循环
    const char msg = signo;
    write(sp[1], &msg, sizeof(msg));
}

int fpm_signals_init_main() {
    struct sigaction act;
    
    memset(&act, 0, sizeof(act));
    act.sa_handler = sig_handler;
    sigemptyset(&act.sa_mask);
    act.sa_flags = 0;
    
    // 注册关键信号
    sigaction(SIGTERM, &act, NULL);  // 强制终止
    sigaction(SIGINT,  &act, NULL);  // Ctrl+C
    sigaction(SIGUSR1, &act, NULL);  // 重新打开日志
    sigaction(SIGUSR2, &act, NULL);  // 平滑重载
    sigaction(SIGQUIT, &act, NULL);  // 优雅退出
    sigaction(SIGCHLD, &act, NULL);  // 子进程退出
    
    return 0;
}
```

通过 **self-pipe trick**（自管道技巧），信号处理函数将信号编号写入管道，主事件循环从管道读取并处理，避免了在信号处理器中调用不安全函数。

### 3.2 五大关键信号

| 信号 | 作用 | 影响范围 | 生产场景 |
|------|------|----------|----------|
| `SIGTERM` | 强制终止所有进程 | master + all workers | 紧急停止服务 |
| `SIGQUIT` | 优雅终止 | master + all workers | 正常停止服务 |
| `SIGUSR1` | 重新打开日志 | master only | 日志轮转（logrotate） |
| `SIGUSR2` | 平滑重载 | master only | 部署新代码/修改配置 |
| `SIGCHLD` | 子进程状态变化 | master only | 进程回收管理 |

### 3.3 各信号处理源码

```c
// fpm_process_ctl.c - 简化的信号分发逻辑
static void fpm_handle_signal(struct fpm_event_s *ev) {
    char c;
    read(fd_signal_pipe[0], &c, sizeof(c));
    
    switch (c) {
        case SIGTERM:  // 暴力终止
        case SIGINT:
            fpm_pctl(FPM_PCTL_STATE_TERMINATING, 0);
            // 立即 kill 所有 worker: kill(child->pid, SIGKILL)
            break;
            
        case SIGQUIT:  // 优雅终止
            fpm_pctl(FPM_PCTL_STATE_FINISHING, 0);
            // 给 worker 发 SIGQUIT，等待完成当前请求
            break;
            
        case SIGUSR1:  // 重新打开日志
            fpm_pctl(FPM_PCTL_STATE_RELOADING, 0);
            // 只 master 处理，重新打开 log 文件
            fpm_stdio_reopen_log_files();
            // 通知所有 worker 也重新打开
            fpm_bcast(FPM_PCTL_ACTION_LOG_ROTATE);
            break;
            
        case SIGUSR2:  // 平滑重载
            fpm_pctl(FPM_PCTL_STATE_RELOADING, 0);
            // 执行 graceful reload
            fpm_pctl_kill_all(SIGQUIT);  // 优雅停止旧 worker
            // master 重新加载配置并 fork 新 worker
            fpm_run_master();
            break;
            
        case SIGCHLD:
            // 子进程退出，master 调用 waitpid 回收
            fpm_children_bury();
            // 根据 PM 策略决定是否补充新 worker
            break;
    }
}
```

### 3.4 实战：信号操作命令

```bash
# 查看 php-fpm master 进程 PID
cat /run/php/php8.2-fpm.pid
# 或
ps aux | grep 'php-fpm: master' | grep -v grep | awk '{print $2}'

# 强制终止（不推荐，可能导致请求中断）
kill -SIGTERM $(cat /run/php/php8.2-fpm.pid)

# 优雅终止（等当前请求处理完毕再退出）
kill -SIGQUIT $(cat /run/php/php8.2-fpm.pid)

# 重新打开日志文件（用于 logrotate 配合）
kill -SIGUSR1 $(cat /run/php/php8.2-fpm.pid)

# 平滑重载（重新加载配置 + 平滑重启 worker）
kill -SIGUSR2 $(cat /run/php/php8.2-fpm.pid)
```

---

## 四、Graceful Reload 底层机制

### 4.1 完整流程图

```
Nginx 发送请求
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 1. 执行: kill -SIGUSR2 master_pid                        │
│    或: systemctl reload php-fpm                          │
└──────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 2. Master 收到 SIGUSR2，进入 RELOADING 状态              │
│    - 重新读取配置文件（php-fpm.conf + pool.d/*.conf）    │
│    - 检查配置是否有变化                                   │
└──────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Master 向所有旧 worker 发送 SIGQUIT                   │
│    - worker 设置 "graceful_stop" 标志                    │
│    - worker 不再接受新连接                                │
│    - worker 继续处理当前正在执行的请求                    │
└──────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 4. Master 创建新的 listen socket（新配置可能端口/协议变了）│
│    - fork 新的 worker 进程                               │
│    - 新 worker 使用新配置、新 socket                      │
└──────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 5. 旧 worker 完成所有请求后自行退出                       │
│    - 如果超过 process_control_timeout 仍未退出            │
│    - Master 发送 SIGKILL 强制杀死                        │
└──────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────┐
│ 6. Master waitpid() 回收旧 worker                        │
│    - 更新 scoreboard                                     │
│    - 完成 reload                                         │
└──────────────────────────────────────────────────────────┘
```

### 4.2 关键配置：process_control_timeout

```ini
; php-fpm.conf
; Graceful reload 的超时时间
; 如果 worker 在此时间内仍未完成当前请求，master 会发送 SIGKILL
process_control_timeout = 10s
```

这个配置项是 graceful reload 的安全网：

```bash
# 生产环境建议值
# - 如果你的请求最长需要 30s 处理（如大数据报表），设为 35s
# - 如果请求一般 1-3s 完成，10s 就够了
process_control_timeout = 10s

# 设置为 0 则永不超时（不推荐！可能导致旧 worker 永远不退出）
```

### 4.3 安全的 graceful reload 脚本

```bash
#!/bin/bash
# safe_reload_php_fpm.sh - 生产环境安全重载脚本

set -euo pipefail

FPM_PID_FILE="/run/php/php8.2-fpm.pid"
FPM_LOG="/var/log/php8.2-fpm.log"
TIMEOUT=60

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 检查 php-fpm 是否运行
check_fpm_running() {
    local pid
    pid=$(cat "$FPM_PID_FILE" 2>/dev/null)
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
        log "ERROR: PHP-FPM is not running"
        exit 1
    fi
    echo "$pid"
}

# 记录当前 worker 数量
get_worker_count() {
    ps aux | grep 'php-fpm: pool' | grep -v grep | wc -l
}

# 主流程
main() {
    local master_pid
    local old_workers
    local new_workers
    
    master_pid=$(check_fpm_running)
    old_workers=$(get_worker_count)
    
    log "Master PID: $master_pid, Current workers: $old_workers"
    
    # 记录当前 worker PIDs
    local old_pids=($(ps aux | grep 'php-fpm: pool' | grep -v grep | awk '{print $2}'))
    
    log "Sending SIGUSR2 to master for graceful reload..."
    kill -SIGUSR2 "$master_pid"
    
    # 等待新 master 启动（SIGUSR2 会导致 master fork 新的自己）
    sleep 2
    
    # 获取新 master PID（可能不变，也可能重新 fork）
    local new_master_pid
    new_master_pid=$(cat "$FPM_PID_FILE" 2>/dev/null)
    log "New master PID: $new_master_pid"
    
    # 监控旧 worker 是否全部退出
    local elapsed=0
    while [[ $elapsed -lt $TIMEOUT ]]; do
        local remaining=0
        for old_pid in "${old_pids[@]}"; do
            if kill -0 "$old_pid" 2>/dev/null; then
                remaining=$((remaining + 1))
            fi
        done
        
        if [[ $remaining -eq 0 ]]; then
            log "All old workers have exited gracefully"
            break
        fi
        
        log "Waiting for $remaining old workers to finish... (${elapsed}s elapsed)"
        sleep 2
        elapsed=$((elapsed + 2))
    done
    
    if [[ $elapsed -ge $TIMEOUT ]]; then
        log "WARNING: Timeout waiting for old workers, some may still be running"
    fi
    
    new_workers=$(get_worker_count)
    log "Reload complete. Workers: $old_workers -> $new_workers"
    
    # 验证服务正常
    if curl -sf -o /dev/null http://127.0.0.1:9000/status 2>/dev/null; then
        log "FPM status check: OK"
    fi
}

main "$@"
```

---

## 五、进程管理器（Process Manager）三种模式

### 5.1 static 模式

```ini
[www]
pm = static
pm.max_children = 50          ; 固定 worker 数量
pm.max_requests = 5000        ; 每个 worker 最多处理请求数（防内存泄漏）
pm.process_idle_timeout = 10s ; 不适用于 static
```

**工作原理**：master 启动时一次性 fork 指定数量的 worker，始终保持不变。

```
时间线：
t=0   ██████████████████████████████ (50 workers)
t=1   ██████████████████████████████ (50 workers)
t=2   ██████████████████████████████ (50 workers)
      即使只有 5 个请求，也有 50 个 worker 驻留内存
```

**适用场景**：高并发、流量稳定的生产环境（如 API 网关、大型电商平台）。

**优点**：无进程创建开销，响应时间稳定。

**缺点**：内存占用固定，低流量时浪费资源。

### 5.2 dynamic 模式

```ini
[www]
pm = dynamic
pm.max_children = 50          ; 最大 worker 数量
pm.start_servers = 10         ; 启动时初始 worker 数
pm.min_spare_servers = 5      ; 最小空闲 worker 数
pm.max_spare_servers = 20     ; 最大空闲 worker 数
pm.max_requests = 1000        ; 每个 worker 最大请求数
pm.process_idle_timeout = 10s ; 空闲 worker 超时退出
```

**工作原理**：master 根据负载动态调整 worker 数量。

```
空闲时（2个请求）：
  worker: ████ (按 min_spare_servers 保持 5+2=7 个)

负载增加（40个请求）：
  worker: ████████████████████████████████████████ (最多 50 个)

负载降低后 10 秒：
  worker: ████████ (回收空闲 worker，回到 min_spare_servers 水平)
```

**核心逻辑**（源码简化）：

```c
// fpm_children.c - 简化的 dynamic 调度逻辑
static void fpm_pctl_perform_idle_server_maintenance() {
    int idle_count = 0;
    
    // 统计当前空闲 worker 数量
    for (child = fpm_worker_all_pools->children; child; child = child->next) {
        if (child->idle) idle_count++;
    }
    
    if (idle_count < wp->config->pm_min_spare_servers) {
        // 空闲太少，fork 新 worker
        int to_create = wp->config->pm_min_spare_servers - idle_count;
        for (int i = 0; i < to_create; i++) {
            fpm_children_make(wp, 0, 0, 0);
        }
    } else if (idle_count > wp->config->pm_max_spare_servers) {
        // 空闲太多，杀掉一些
        int to_kill = idle_count - wp->config->pm_max_spare_servers;
        fpm_pctl_kill_idle_workers(to_kill);
    }
}
```

**适用场景**：流量波动较大的 Web 应用。

### 5.3 ondemand 模式

```ini
[www]
pm = ondemand
pm.max_children = 50
pm.process_idle_timeout = 10s ; 空闲 worker 超时后退出并释放内存
pm.max_requests = 500
```

**工作原理**：只有在收到请求时才 fork worker，空闲超过指定时间后退出。

```
无请求时：
  (没有任何 worker 进程，只保留 master)

收到 3 个请求：
  worker: ███ (fork 3 个 worker 处理请求)

请求完成后 10 秒：
  (worker 全部退出，内存释放)
```

**适用场景**：低流量站点、开发/测试环境、资源受限的容器环境。

**注意**：第一次请求会有额外的 fork 延迟（通常几毫秒到十几毫秒），高并发下不适合。

---

## 六、生产环境实战场景

### 6.1 场景一：零停机部署

使用 graceful reload 实现零停机代码更新：

```bash
#!/bin/bash
# deploy.sh - 零停机部署脚本

DEPLOY_DIR="/var/www/app"
RELEASE="release_$(date +%Y%m%d_%H%M%S)"
RELEASE_DIR="$DEPLOY_DIR/releases/$RELEASE"

# 1. 拉取新代码
git clone --depth 1 git@github.com:org/app.git "$RELEASE_DIR"
cd "$RELEASE_DIR"

# 2. 安装依赖
composer install --no-dev --optimize-autoloader

# 3. 生成 OPcache 预加载列表
php artisan opcache:compile

# 4. 原子切换软链接
ln -sfn "$RELEASE_DIR" "$DEPLOY_DIR/current"

# 5. Graceful reload PHP-FPM（不停服务）
sudo systemctl reload php-fpm

# 6. 验证部署
sleep 2
if curl -sf -o /dev/null http://localhost/health; then
    echo "Deploy successful: $RELEASE"
    # 清理旧版本，保留最近 5 个
    ls -dt "$DEPLOY_DIR"/release_* | tail -n +6 | xargs rm -rf
else
    echo "Deploy failed, rolling back..."
    ln -sfn "$DEPLOY_DIR/previous_release" "$DEPLOY_DIR/current"
    sudo systemctl reload php-fpm
    exit 1
fi
```

### 6.2 场景二：日志轮转不丢日志

```bash
# /etc/logrotate.d/php8.2-fpm
/var/log/php8.2-fpm.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        # 关键：通知 FPM 重新打开日志文件
        /bin/kill -SIGUSR2 $(cat /run/php/php8.2-fpm.pid 2>/dev/null) 2>/dev/null || true
    endscript
}
```

### 6.3 场景三：监控 Worker 状态

```bash
# 开启 FPM status 页面
# php-fpm.conf:
# pm.status_path = /fpm-status

# 查看 FPM 实时状态
curl http://localhost/fpm-status?json

# 输出示例：
# {
#   "pool": "www",
#   "process manager": "dynamic",
#   "start time": 1748995200,
#   "start since": 86400,
#   "accepted conn": 1234567,
#   "listen queue": 0,
#   "max listen queue": 5,
#   "listen queue len": 128,
#   "idle processes": 15,
#   "active processes": 8,
#   "total processes": 23,
#   "max active processes": 42,
#   "max children reached": 0,
#   "slow requests": 3
# }

# 查看每个 worker 的详细状态
curl http://localhost/fpm-status?full

# 实时监控脚本
watch -n 1 'curl -s http://localhost/fpm-status?json | python3 -m json.tool'
```

### 6.4 场景四：诊断 Worker 卡死

```bash
#!/bin/bash
# diagnose_stuck_workers.sh - 诊断卡死的 worker

echo "=== FPM Pool Status ==="
curl -s http://localhost/fpm-status?json 2>/dev/null | python3 -m json.tool

echo ""
echo "=== Worker Process Details ==="
ps -eo pid,ppid,%cpu,%mem,rss,stat,etime,cmd | grep 'php-fpm: pool' | sort -k2 -n

echo ""
echo "=== Workers Running > 30 seconds ==="
ps -eo pid,etime,cmd | grep 'php-fpm: pool' | while read pid etime cmd; do
    # 解析 etime (格式：[[DD-]HH:]MM:SS)
    seconds=$(echo "$etime" | awk -F'[-:]' '{
        if (NF==4) print $1*86400+$2*3600+$3*60+$4;
        else if (NF==3) print $1*3600+$2*60+$3;
        else print $1*60+$2;
    }')
    if [[ $seconds -gt 30 ]]; then
        echo "PID $pid running for $etime: $cmd"
        # 可以用 strace 查看在做什么
        # strace -p $pid -e trace=network -c 2>&1 &
    fi
done

echo ""
echo "=== Open File Descriptors Count ==="
for pid in $(pgrep -f 'php-fpm: pool'); do
    count=$(ls /proc/$pid/fd 2>/dev/null | wc -l)
    echo "PID $pid: $count open FDs"
done
```

## 6.5 踩坑案例：reload 丢请求与僵尸进程

### 案例一：Reload 期间请求 502

**现象**：执行 `systemctl reload php-fpm` 后，Nginx 日志出现大量 502 Bad Gateway，持续 2-3 秒。

**根因分析**：

```bash
# Nginx 错误日志
[error] 12345#0: *67890 connect() failed (111: Connection refused)
# 原因：旧 worker 收到 SIGQUIT 后立即 close() 了 listen socket，
# 但新 worker 还未完成 fork + bind，导致短暂的"连接真空期"
```

**解决方案**：使用 `listen.backlog` 和 Nginx 的 `proxy_next_upstream` 配合：

```nginx
# nginx.conf
upstream php_backend {
    server unix:/run/php/php8.2-fpm.sock max_fails=3 fail_timeout=5s;
}

server {
    location ~ \.php$ {
        fastcgi_pass php_backend;
        fastcgi_next_upstream error timeout invalid_header http_502 http_503;
        fastcgi_next_upstream_tries 2;
        fastcgi_connect_timeout 5s;
    }
}
```

```ini
; php-fpm.conf - 增大 backlog 队列，确保新 worker 启动前内核能缓存住待处理连接
listen.backlog = 512
```

### 案例二：Worker 僵尸进程堆积

**现象**：`ps aux` 中出现大量 `[php-fpm: pool www] <defunct>` 状态的僵尸进程。

```bash
# 检测僵尸进程
ps aux | grep 'php-fpm' | grep -E 'Z|defunct'
# 输出示例：
# www-data  12345  0.0  0.0  0  0 ?  Z  10:30  0:00 [php-fpm] <defunct>
```

**根因**：Master 进程未正确调用 `waitpid()` 回收子进程。常见触发条件：

1. Master 收到 SIGCHLD 时正在处理其他信号（信号丢失）
2. `fork()` 之后 master 崩溃重启，旧子进程成为孤儿进程后退出
3. 容器环境中 PID 1 不是 php-fpm（Docker 中需要使用 `exec` 形式启动）

```dockerfile
# Dockerfile - 关键：使用 exec 形式让 php-fpm 成为 PID 1
# ❌ 错误：CMD php-fpm（shell 形式，PID 1 是 sh）
# ✅ 正确：
CMD ["php-fpm", "--nodaemonize"]
```

**紧急处理**：

```bash
# 方法 1：向 master 发送 SIGCHLD 触发回收
kill -SIGCHLD $(cat /run/php/php8.2-fpm.pid)

# 方法 2：如果 master 已异常，优雅重启整个 FPM
systemctl restart php-fpm

# 方法 3：预防性监控脚本
zombie_count=$(ps aux | grep 'php-fpm' | grep -c 'defunct')
if [[ $zombie_count -gt 5 ]]; then
    echo "ALERT: $zombie_count php-fpm zombies detected" | \
        mail -s "FPM Zombie Alert" ops@example.com
fi
```

### 案例三：pm.max_requests 导致 reload 期间请求失败

**现象**：高并发下执行 graceful reload，部分请求返回空响应或截断的 HTML。

**根因**：`pm.max_requests` 的检查点在请求**开始前**而非结束后。如果 worker 已达到 max_requests 限制，它会在 accept 新连接后立即退出，导致连接被中途关闭。

```ini
; 解决方案：reload 前临时调大 max_requests
; 或在部署脚本中先修改配置再 reload
pm.max_requests = 10000  ; 适当调大，减少 reload 期间的 worker 退出频率
```

```bash
# 更安全的部署流程：先 reload，等稳定后再清理 OPcache
sudo systemctl reload php-fpm
sleep 3  # 等待新 worker 完全就绪
# 然后再清理 OPcache（如果有需要）
curl -s http://localhost/opcache-clear.php > /dev/null
```

---

## 七、性能调优实战建议

### 7.1 内存估算公式

```bash
# 单个 worker 平均内存（RSS）
avg_rss=$(ps -eo pid,rss,cmd | grep 'php-fpm: pool' | \
          awk '{sum+=$2; n++} END {print int(sum/n)}')

# 建议的 max_children 值
available_mem_mb=4096  # 留给 FPM 的内存
avg_rss_mb=$((avg_rss / 1024))
recommended_max=$((available_mem_mb / avg_rss_mb))

echo "Average worker RSS: ${avg_rss_mb}MB"
echo "Recommended max_children: $recommended_max"
```

### 7.2 推荐配置模板

```ini
; /etc/php/8.2/fpm/pool.d/www.conf
; 高并发生产环境推荐配置
[www]
user = www-data
group = www-data

; 监听配置
listen = /run/php/php8.2-fpm.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

; 进程管理
pm = dynamic
pm.max_children = 60
pm.start_servers = 15
pm.min_spare_servers = 10
pm.max_spare_servers = 30
pm.max_requests = 2000
pm.process_idle_timeout = 10s

; 状态监控
pm.status_path = /fpm-status
ping.path = /fpm-ping
ping.response = pong

; 日志
access.log = /var/log/php-fpm/$pool-access.log
slowlog = /var/log/php-fpm/$pool-slow.log
request_slowlog_timeout = 5s
request_terminate_timeout = 30s

; 安全
security.limit_extensions = .php

; 优雅重载超时
process_control_timeout = 10s
```

### 7.3 OPcache 与 Graceful Reload 的配合

Graceful reload 时要注意 OPcache 的行为：

```ini
; php.ini - OPcache 相关配置
; reload 时是否重新加载 OPcache 缓存
; 设为 0 可以让 reload 更快（适合只改配置不改代码的场景）
opcache.revalidate_freq = 60
opcache.validate_timestamps = 1

; 如果使用 atomic deploy（原子切换软链接），建议：
; opcache.revalidate_path = 1
; 这样即使路径变了，OPcache 也会检测到
```

```bash
# 强制清空 OPcache（谨慎使用）
curl "http://localhost/opcache-clear.php" 
# 该脚本内容：
# <?php opcache_reset();
```

### 7.4 关键监控指标

| 指标 | 告警阈值 | 含义 |
|------|----------|------|
| `listen queue` | > 0 持续 30s | 连接排队，worker 不够 |
| `max children reached` | > 0 | 曾触及 max_children 上限 |
| `slow requests` | 持续增长 | 慢请求过多 |
| `idle processes` | = 0 | 所有 worker 都在忙碌 |
| `active processes` / `total processes` | > 80% | 负载较高 |

---

## 八、总结

PHP-FPM 的进程模型虽然看起来简单，但其内部的信号处理、graceful reload、动态调度等机制都经过精心设计：

1. **Master-Worker 架构**通过 fork 隔离请求处理，单个 worker 崩溃不影响整体服务。
2. **信号机制**是进程控制的核心，SIGQUIT/SIGUSR1/SIGUSR2 分别对应不同的运维操作。
3. **Graceful Reload**通过 SIGQUIT + process_control_timeout 实现零停机更新。
4. **三种 PM 模式**（static/dynamic/ondemand）适合不同的流量特征。
5. **生产环境**需要关注 max_children、listen queue、slow requests 等关键指标。

理解这些底层机制，不仅能帮助你更高效地运维 PHP 应用，还能在遇到性能问题时快速定位根因。当你的线上服务出现请求排队、worker 卡死等问题时，这些知识将是你排查问题的利器。

---

## 相关阅读

- [Swoole 常驻内存踩坑深度剖析：全局变量污染、静态属性残留、连接泄漏——PHP-FPM 到 Octane 的思维模式迁移](/categories/PHP/swoole-resident-memory-pitfalls-deep-dive/)
- [Elixir OTP 实战：Supervisor 树、GenServer、分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/categories/架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
