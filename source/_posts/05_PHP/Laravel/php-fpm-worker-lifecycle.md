---
title: PHP 进程模型深度剖析：PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制
date: 2026-06-04 09:00:00
tags: [PHP, PHP-FPM, 进程模型, 信号处理, graceful reload]
categories: [PHP, Laravel]
cover: /images/covers/php-fpm-worker-lifecycle-cover.jpg
description: "从 C 源码级别深度剖析 PHP-FPM 的进程架构与 worker 生命周期机制。详解 master/worker 协作模型、fork 与 Copy-on-Write 原理、SIGTERM/SIGUSR1/SIGUSR2 信号处理、graceful reload 底层实现、pm.max_children 调优公式、容器化部署注意事项，助你彻底掌握 PHP-FPM 生产环境运维与性能优化。"
---

## 前言：为什么要深入理解 PHP-FPM 的进程模型？

在日常的 PHP 开发中，我们写的每一行代码最终都会在一个 PHP-FPM worker 进程中执行。然而，当生产环境出现以下问题时，大部分开发者会感到束手无策：部署新代码后，线上出现短暂的 502 错误；`reload` PHP-FPM 时，长连接请求被意外中断；worker 进程内存持续增长，最终 OOM Killer 杀掉了整个 PHP-FPM；高并发场景下 worker 池被打满，请求排队超时导致用户体验急剧下降；`strace` 跟踪 worker 进程时看不懂那些系统调用到底在干什么。

这些问题的根源，都在于我们对 PHP-FPM 内部进程模型的理解不够深入。大多数 PHP 开发者对 PHP-FPM 的认知停留在"它是一个进程管理器"这个层面，对于 master 和 worker 之间如何协作、信号如何传递、配置如何生效等核心机制一无所知。这种知识盲区在日常开发中或许不会造成困扰，但一旦进入生产环境的故障排查场景，就会成为致命的短板。

本文将从 C 源码级别出发，结合生产环境的真实案例，全面剖析 PHP-FPM 的进程架构、worker 生命周期、信号处理机制以及 graceful reload 的底层实现。无论你是运维工程师还是后端开发者，理解这些底层机制都将极大地提升你在生产环境中排查问题和优化性能的能力。

---

## 一、从操作系统的视角理解 PHP-FPM

### 1.1 为什么 PHP 选择多进程模型而不是多线程？

PHP 从设计之初就采用了进程隔离的模型，而非线程模型。这个选择并非偶然，而是与 PHP 的核心特性和历史背景密切相关。在 PHP 的早期版本中，代码的编写风格非常自由，全局变量随处可见，Zend Engine 的内部状态管理也没有考虑线程安全。这种设计在简单性和易用性上获得了巨大成功，但也意味着 PHP 天生不适合在多线程环境中运行。

从技术层面来看，PHP 内核中存在大量使用全局变量和进程级状态的代码。Zend Engine 的全局编译器状态、执行引擎状态、符号表、函数表等核心数据结构都存储在进程级别的全局变量中。如果使用多线程模型，这些全局变量将被所有线程共享，需要大量的锁机制来保证线程安全。这会带来两个严重问题：锁竞争会导致性能下降，特别是在高并发场景下，线程之间的锁争用会成为严重的性能瓶颈；任何一个线程中的段错误或内存越界都会导致整个进程崩溃，影响所有正在处理的请求。

采用多进程模型后，每个 worker 进程拥有独立的虚拟地址空间，一个 worker 的崩溃不会影响其他 worker 的正常运行，内存中的数据也不会被意外修改。同时，由于不存在共享状态，代码执行过程中无需任何锁机制，CPU 缓存的命中率也更高，实际性能反而优于多线程方案。此外，多进程模型与 Unix 的 `fork()` 系统调用完美配合，master 可以快速创建新的 worker，利用 Copy-on-Write 机制最大限度地减少内存开销。

### 1.2 PHP-FPM 的进程层次结构

PHP-FPM 采用经典的 Master-Worker 多层架构，这种架构在 Unix 系统的服务程序中极为常见，Nginx、PostgreSQL、Redis 等知名软件都采用了类似的模式。我们可以通过 `pstree` 命令清晰地观察到进程的层次关系：

```bash
$ pstree -p $(pgrep -f 'php-fpm: master')
php-fpm(1234)─┬─php-fpm(1235)
              ├─php-fpm(1236)
              ├─php-fpm(1237)
              ├─php-fpm(1238)
              ├─php-fpm(1239)
              └─php-fpm(1240)
```

其中 PID 1234 是 master 进程，其余是 worker 进程。通过 `ps` 命令可以看到更详细的信息：

```bash
$ ps aux | grep php-fpm
root     1234  0.0  0.1  php-fpm: master process (/etc/php/8.2/fpm/php-fpm.conf)
www-data 1235  0.1  0.5  php-fpm: pool www
www-data 1236  0.1  0.5  php-fpm: pool www
www-data 1237  0.1  0.5  php-fpm: pool www
```

注意一个重要的安全设计：master 进程以 `root` 用户运行（因为需要绑定特权端口、写 PID 文件等特权操作），而 worker 进程以 `www-data` 用户运行（遵循最小权限原则，避免安全漏洞导致整个系统被入侵）。这种权限分离是 Unix 安全模型的经典实践。

### 1.3 Master 进程的核心职责

在 PHP-FPM 源码 `sapi/fpm/fpm/fpm.c` 中，master 进程的入口函数揭示了它的核心工作内容。master 进程主要负责以下几个方面的工作：

首先是配置管理。master 进程在启动时读取 `php-fpm.conf` 以及各个 pool 的配置文件，解析所有配置项并存储在内存中的配置结构体中。当收到 SIGUSR2 信号时，master 会重新读取这些配置文件，对比新旧配置的差异，决定是否需要更新运行参数。

其次是进程生命周期管理。master 通过 `fork()` 系统调用创建 worker 子进程，并在 worker 退出时通过 `waitpid()` 回收僵尸进程。在 dynamic 模式下，master 还需要根据当前的负载情况动态调整 worker 的数量，确保有足够的 worker 来处理请求，同时避免浪费内存资源。

第三是信号处理。master 监听来自系统和管理员的各种信号，包括 SIGTERM（强制终止）、SIGQUIT（优雅终止）、SIGUSR1（重新打开日志）、SIGUSR2（平滑重载）以及 SIGCHLD（子进程状态变化）。每种信号都有对应的处理逻辑，这些逻辑构成了 PHP-FPM 运维操作的基础。

第四是状态监控。master 维护着一块共享内存区域，称为 scoreboard，其中记录了每个 worker 的状态信息（空闲、忙碌、正在退出等）、已处理的请求数量、请求的开始和结束时间等统计数据。`php-fpm status` 页面显示的信息就来源于这块共享内存。

---

## 二、Worker 进程的完整生命周期

### 2.1 生命周期状态机

每个 worker 进程从创建到消亡，经历一个严格定义的状态转换过程。理解这个状态机是理解 PHP-FPM 行为的关键。完整的状态转换图如下所示：

```
           fork()                  fpm_child_init()
  [不存在] ─────→ [INITIALIZING] ──────────────→ [IDLE]
                                                    │
                                              accept() 接受连接
                                                    ↓
  [EXITING] ←──── [RUNNING] ←────────────────── [BUSY]
      │               │                              │
      │        收到 graceful 信号            处理完成或超时
      │               │                              │
      ↓               ↓                              ↓
  [TERMINATED]    [GRACEFUL_STOP]              回到 [IDLE]
      │               │
   exit(0)       当前请求完成后 exit(0)
```

这个状态机中的每一个状态转换都有明确的触发条件和对应的处理逻辑。INITIALIZING 状态发生在 fork 之后、worker 准备接受请求之前，这段时间 worker 会完成信号处理的初始化、事件循环的初始化、共享内存的映射等准备工作。IDLE 状态表示 worker 已经准备好接受请求，正在 epoll_wait 或 kqueue 上阻塞等待。BUSY 状态表示 worker 正在接受连接、读取请求、执行 PHP 脚本或返回响应。GRACEFUL_STOP 状态是收到 SIGQUIT 信号后进入的状态，此时 worker 不再接受新连接，但会继续处理当前正在执行的请求。

### 2.2 阶段一：Fork 与子进程初始化

当 master 进程决定创建一个新的 worker 时（无论是启动时的初始创建还是因负载增加而动态创建），都会调用 `fpm_children_make()` 函数。这个函数通过 `fork()` 系统调用创建子进程：

```c
// sapi/fpm/fpm/fpm_children.c
int fpm_children_make(struct fpm_worker_pool_s *wp, 
                      int in_event_loop, 
                      int nb_to_spawn, 
                      int is_debug) {
    pid_t pid;
    
    for (int i = 0; i < nb_to_spawn; i++) {
        pid = fork();
        
        switch (pid) {
            case -1:  // fork 失败
                zlog(ZLOG_SYSERROR, "fork() failed");
                return -1;
                
            case 0:   // 子进程（worker）
                // 子进程初始化
                fpm_child_init(wp);
                // 进入请求处理主循环
                fpm_worker_main(wp);
                // 理论上不会执行到这里
                exit(0);
                
            default:  // 父进程（master）
                // 记录子进程信息到进程管理链表
                fpm_parent_children_add(wp, pid, 
                    fpm_scoreboard_proc_alloc(wp));
                break;
        }
    }
    return 0;
}
```

子进程的初始化过程在 `fpm_child_init()` 中完成。这个函数做了几件关键的事情：第一是设置进程标题，通过修改 `argv[0]` 让 `ps` 命令能显示 `php-fpm: pool www` 这样的描述性标题；第二是初始化 scoreboard，让子进程能够访问共享内存中的统计数据；第三是关闭 master 专用的监听 socket，使用 `dup()` 复制出的独立 socket 进行工作；第四是重新初始化信号处理函数，因为子进程和 master 需要对同一信号做出不同的响应；第五是初始化事件驱动引擎（epoll 或 kqueue）；最后是调用 Zend Engine 的激活函数，完成 OPcache 共享内存的映射等操作。

这里有一个重要的性能知识点：`fork()` 系统调用使用 Copy-on-Write（写时复制）机制。当 master 进程拥有 2GB 内存时，fork 一个子进程并不需要立即复制 2GB 的物理内存。父子进程共享相同的物理内存页面，仅在某一方尝试写入某个页面时，内核才会复制该页面。这意味着 fork 的时间开销与父进程的内存大小基本无关，通常只需要几毫秒。但如果 worker 在处理请求时大量修改内存（如加载大量 PHP 类文件、创建大量对象、执行大量的字符串操作），Copy-on-Write 机制会导致大量的页面复制，内存占用会迅速增长到接近独立的程度。这就是为什么在 Laravel 这样的大型框架中，一个 worker 的内存占用可以轻易达到 50MB 甚至 100MB 以上。

### 2.3 阶段二：请求处理主循环

Worker 进程初始化完成后，进入它一生中最核心的工作——请求处理主循环。这个循环会一直运行，直到收到终止信号或达到最大请求数限制：

```c
// 简化的 worker 主循环
void fpm_worker_main(struct fpm_worker_pool_s *wp) {
    int requests_served = 0;
    int max_requests = wp->config->pm_max_requests;
    
    while (1) {
        // 1. 更新 scoreboard 状态为 IDLE
        fpm_scoreboard_proc_commit(NULL, FPM_SCOREBOARD_ACTION_SET, 
                                    FPM_PROC_IDLE, NULL);
        
        // 2. 等待新连接（阻塞在 epoll_wait/kqueue 上）
        fpm_event_wait(-1);
        
        // 3. 检查是否收到了终止信号
        if (fpm_got_signal) {
            if (fpm_got_signal == SIGQUIT) {
                fpm_got_signal = 0;
                graceful_stop = 1;
                if (!is_processing_request) break;
            } else {
                break;  // 强制终止
            }
        }
        
        // 4. 更新 scoreboard 状态为 BUSY
        fpm_scoreboard_proc_commit(NULL, FPM_SCOREBOARD_ACTION_SET, 
                                    FPM_PROC_RUNNING, NULL);
        
        // 5. 接受 FastCGI 连接
        int conn = fpm_event_accept(ev);
        
        // 6. 读取并解析 FastCGI 协议数据
        fpm_request_info(conn);
        
        // 7. 初始化 PHP 运行环境，执行脚本
        php_execute_script(request->script_filename);
        
        // 8. 通过 FastCGI 协议返回响应
        fpm_request_finished(request);
        
        // 9. 关闭连接
        close(conn);
        
        // 10. 检查是否达到最大请求数限制
        requests_served++;
        if (max_requests > 0 && requests_served >= max_requests) {
            break;
        }
    }
    
    fpm_worker_exit();
}
```

这个主循环中有几个关键的设计决策值得深入分析。

关于请求计数与 worker 重建：`pm.max_requests` 参数控制每个 worker 最多处理多少个请求后自动退出。这个机制是 PHP-FPM 防止内存泄漏的核心策略。假设一个 worker 处理了 1000 个请求后内存从 30MB 增长到了 100MB（由于 PHP 扩展或代码中的内存泄漏），当它达到 max_requests 后会自动退出，master 随后 fork 一个全新的 worker，新 worker 的内存又回到 30MB。在生产环境中，这个值通常设为 500 到 5000 之间。设得太小会导致频繁的 fork 开销（每次 fork 需要几毫秒），设太大会让内存泄漏累积过多。

关于 Scoreboard 机制：master 和所有 worker 之间通过共享内存中的 scoreboard 进行通信。每个 worker 在 scoreboard 中有一个 slot，记录了自己的状态（IDLE、RUNNING、GRACEFUL_STOP）、当前处理的请求信息（脚本路径、请求开始时间等）、CPU 使用情况、累计请求数等统计数据。这就是 `php-fpm status` 页面显示的数据来源。通过定期读取 scoreboard，运维系统可以实时监控每个 worker 的健康状况。

关于事件驱动模型：worker 使用 epoll（Linux）或 kqueue（macOS/BSD）来管理连接和定时器事件。这使得单个 worker 能够高效地处理连接等待、信号通知等多种事件源，而不会因为某个系统调用的阻塞而影响其他事件的处理。

### 2.4 阶段三：优雅退出与进程清理

当 worker 收到 SIGQUIT 信号（graceful shutdown）时，它不会立即退出，而是进入优雅退出模式。这个模式的核心思想是：不接受新的连接请求，但继续处理当前正在执行的请求，直到当前请求完成后再退出。如果 worker 当前没有正在处理的请求，它会立即退出。

退出清理阶段需要完成以下工作：调用所有注册的 shutdown 函数（包括 PHP 扩展的 RSHUTDOWN 回调）；关闭所有打开的数据库连接（MySQL、Redis 等）；释放 OPcache 中的进程级引用；更新 scoreboard 中的状态为退出；最后调用 `exit(0)` 结束进程。

worker 退出后，它成为僵尸进程（zombie process），直到 master 调用 `waitpid()` 回收。此时 master 会根据进程管理策略（static、dynamic、ondemand）决定是否需要创建新的 worker 来替代退出的 worker。

---

## 三、信号处理机制的深度解析

### 3.1 Self-Pipe Trick：信号处理的核心技巧

POSIX 标准规定，在信号处理函数中只能安全地调用异步信号安全函数（async-signal-safe functions）。像 `malloc()`、`printf()`、`epoll_ctl()`、`pthread_mutex_lock()` 这些常见函数都不在安全函数列表中。如果在信号处理函数中调用了这些函数，可能会导致死锁、内存损坏或其他未定义行为。

PHP-FPM 使用了经典的 self-pipe trick 来解决这个问题。这个技巧的核心思想是创建一个管道，将管道的读端加入事件循环监听，信号处理函数只需要向管道的写端写入一个字节。这样，信号处理函数只调用了 `write()` 这一个异步信号安全的函数，复杂的信号处理逻辑全部在事件循环中完成：

```c
// sapi/fpm/fpm/fpm_signals.c
int fpm_signals_init_main() {
    int sp[2];
    
    // 创建一个 Unix 域套接字对（比 pipe 更灵活）
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sp) < 0) {
        zlog(ZLOG_SYSERROR, "socketpair() failed");
        return -1;
    }
    
    // 设置为非阻塞模式
    fpm_sockets_set_noblock(sp[0]);
    fpm_sockets_set_noblock(sp[1]);
    
    // 将读端加入事件循环监听
    fpm_event_add(sp[0], FPM_EV_READ, fpm_got_signal_handler, NULL);
    
    signal_pipe[0] = sp[0];  // 读端（事件循环监听）
    signal_pipe[1] = sp[1];  // 写端（信号处理函数使用）
    
    // 注册信号处理函数
    struct sigaction act;
    memset(&act, 0, sizeof(act));
    act.sa_handler = sig_handler;
    sigemptyset(&act.sa_mask);
    act.sa_flags = SA_RESTART;
    
    sigaction(SIGTERM, &act, NULL);
    sigaction(SIGQUIT, &act, NULL);
    sigaction(SIGUSR1, &act, NULL);
    sigaction(SIGUSR2, &act, NULL);
    sigaction(SIGCHLD, &act, NULL);
    sigaction(SIGINT,  &act, NULL);
    
    return 0;
}

// 信号处理函数：只做最小限度的工作
static void sig_handler(int signo) {
    int saved_errno = errno;
    write(signal_pipe[1], &signo, 1);
    errno = saved_errno;  // 恢复 errno，避免影响被中断的系统调用
}
```

这个实现中有几个细节值得注意。首先使用 `socketpair()` 而不是 `pipe()` 创建管道，因为 `socketpair` 创建的是双向的套接字对，在某些场景下更灵活。其次信号处理函数中保存并恢复了 `errno` 的值，这是因为信号可能在任何时刻到达，如果中断了某个正在执行的系统调用，修改 errno 会导致该调用的行为异常。最后设置了 `SA_RESTART` 标志，这告诉内核自动重启被信号中断的系统调用，避免了在应用层处理 `EINTR` 错误。

### 3.2 四大关键信号的完整行为

PHP-FPM 对四个关键信号有明确的处理逻辑，每个信号的行为都直接影响生产环境的运维操作：

| 信号 | 编号 | 发送对象 | 典型命令 | 行为描述 |
|------|------|----------|----------|----------|
| `SIGTERM` | 15 | master | `kill -15 <pid>` | Master 向所有 worker 发送 SIGKILL 强制杀死，不等待当前请求完成 |
| `SIGQUIT` | 3 | master | `systemctl stop`（部分系统） | Master 向所有 worker 发送 SIGQUIT，worker 完成当前请求后退出 |
| `SIGUSR1` | 10 | master | `kill -USR1 <pid>` | Master 重新打开日志文件，通知所有 worker 也重新打开各自的日志 fd |
| `SIGUSR2` | 12 | master | `systemctl reload php-fpm` | Master 执行 graceful reload，旧 worker 优雅退出，新 worker 用新配置启动 |

**SIGTERM 与 SIGQUIT 的关键区别**体现在对正在处理的请求的处理方式上。SIGTERM 是强制终止模式，它不关心 worker 当前是否正在处理请求，master 会向所有 worker 发送 SIGKILL 信号，而 SIGKILL 是无法被捕获或忽略的，进程会被内核立即杀死。这意味着如果一个 worker 正在执行一个耗时 5 秒的数据库查询，它会在查询进行到一半时被强制终止，导致 Nginx 收到连接重置错误（502 Bad Gateway）。

SIGQUIT 则是优雅终止模式，它会等待 worker 完成当前正在处理的请求后再退出。master 向所有 worker 发送 SIGQUIT 信号后，每个 worker 会设置一个 `graceful_stop` 标志，然后继续处理当前请求。处理完成后，worker 检测到这个标志，执行清理逻辑后自行退出。这个过程中，worker 不再接受新的连接请求，但正在执行的请求会得到完整的处理。

### 3.3 SIGUSR2 的特殊行为与常见误解

SIGUSR2 在 PHP-FPM 中的含义可能与许多开发者的直觉不同。很多开发者认为发送 SIGUSR2 会"重新加载配置"，但实际上 SIGUSR2 触发的是一个更复杂的过程——graceful reload。这个过程不仅重新加载配置，还会创建全新的 master 进程和一组全新的 worker 进程。

具体来说，当 master 收到 SIGUSR2 信号后，它会执行以下操作：首先重新读取所有配置文件并检查是否有变化；然后向所有现有的 worker 发送 SIGQUIT 信号，让它们优雅退出；接着 master 自身 fork 出一个新的 master 进程（这也是为什么你会在 `ps` 输出中看到两个 master 进程的原因）；新的 master 创建一组新的 worker 进程，使用新的配置参数；旧的 worker 完成请求处理后退出，旧的 master 等待所有旧 worker 退出后也退出。

这里有一个重要的细微差别：在某些 PHP-FPM 版本中，SIGUSR2 不会导致 master 自身重新 fork，而是直接在当前 master 中重新创建 worker。具体行为取决于 PHP-FPM 的版本和配置。但无论哪种实现，核心目标都是一样的：在不中断服务的情况下更新配置和代码。

### 3.4 SIGUSR1 与日志轮转

SIGUSR1 的用途相对简单但非常重要——重新打开日志文件。这通常与 logrotate 配合使用。当 logrotate 执行日志轮转时，它将当前的日志文件重命名（如从 `php-fpm.log` 变为 `php-fpm.log.1`），然后创建一个新的空文件。但问题是，PHP-FPM 的 master 和 worker 进程持有的文件描述符仍然指向旧的文件（已被重命名的那个），后续的日志会继续写入旧文件。通过发送 SIGUSR1 信号，PHP-FPM 会关闭旧的文件描述符，打开新的日志文件，确保日志正确地写入新文件。

---

## 四、Graceful Reload 的底层机制

### 4.1 为什么需要 Graceful Reload？

在生产环境中，我们经常需要更新 PHP 代码、修改 php.ini 配置、调整 PHP-FPM 的运行参数。最简单的做法是停止 PHP-FPM 然后重新启动，但这会导致所有正在处理的请求被中断，在高并发场景下会产生大量的 502 错误。Graceful reload 机制的出现解决了这个问题，它实现了零请求损失的平滑过渡。

### 4.2 完整的 Graceful Reload 流程

当 master 收到 SIGUSR2 信号后，会执行一个精心设计的多阶段流程。理解这个流程的每个细节，对于排查部署相关的问题至关重要。

**第一阶段：配置重载**。master 重新读取 `php-fpm.conf` 和各个 pool 的配置文件，对比新旧配置的差异。有些配置项的变化需要创建新的 worker 才能生效（如 `pm.max_children`），而有些配置项可以立即生效（如日志级别）。

**第二阶段：旧 worker 的优雅停止**。master 向所有现有的 worker 发送 SIGQUIT 信号。每个 worker 收到信号后，会设置 `graceful_stop` 标志，然后在主循环中检测到这个标志。如果当前没有正在处理的请求，worker 会立即退出；如果正在处理请求，worker 会等待请求完成后再退出。在此期间，worker 不再接受新的连接请求。

**第三阶段：新 worker 的创建**。master 使用新的配置参数 fork 出一组新的 worker 进程。新 worker 从 master 继承了更新后的配置，开始监听连接并处理请求。此时，新旧 worker 会短暂地共存：旧 worker 仍在处理未完成的请求，新 worker 已经开始接受新请求。

**第四阶段：旧进程的回收**。master 通过 `waitpid()` 系统调用监控旧 worker 的退出状态。当旧 worker 全部退出后，旧的 master 进程也会退出。如果某个旧 worker 在 `process_control_timeout` 规定的时间内仍未退出，master 会向它发送 SIGKILL 信号强制终止。

### 4.3 新旧 Worker 共存期间的请求路由

在 graceful reload 过程中，存在一个新旧 worker 共存的过渡期。这个期间，Nginx 如何知道应该将新请求发送给哪个 worker 呢？

答案是：PHP-FPM 使用的监听 socket（无论是 TCP 端口还是 Unix 域套接字文件）在整个过程中保持不变。旧 worker 不再调用 `accept()` 接受新连接，但监听 socket 仍然存在。新 worker 接管了同一个监听 socket，开始接受新连接。这意味着 Nginx 不需要做任何修改，它仍然连接到同一个 socket 地址，只是新连接会被新 worker 处理，而旧连接（正在处理中的请求）仍然由旧 worker 负责。

这种设计的精妙之处在于，它完全消除了 Nginx 端的配置变更需求，实现了真正的无缝切换。不过需要注意的是，在某些特殊配置下（如使用了 TCP 端口监听且修改了端口号），监听 socket 会重新创建，这时可能会出现短暂的连接中断。

### 4.4 process_control_timeout 的重要性

`process_control_timeout` 参数是 graceful reload 的安全阀。它定义了 master 等待旧 worker 退出的最大时间。如果旧 worker 在这个时间内仍未完成当前请求并退出，master 会向它发送 SIGKILL 信号强制终止。

在生产环境中，必须根据应用的请求处理时间合理设置这个参数。如果设置得太小，一些耗时较长的请求会被强制中断，导致 502 错误；如果设置得太大，graceful reload 的过程会非常缓慢，在紧急需要更新配置时可能无法及时生效。

以下是一些推荐的配置方案：

```ini
; 普通 API 服务，请求处理时间一般在 100ms-2s 之间
process_control_timeout = 10s

; 包含文件上传处理的服务，请求可能需要 30s-60s
process_control_timeout = 90s

; 包含大数据报表生成的服务，单个请求可能耗时数分钟
process_control_timeout = 300s

; 极端危险的设置：永不超时，旧 worker 可能永远不会退出
; process_control_timeout = 0
```

---

## 五、进程管理策略深度调优

### 5.1 三种 PM 模式的对比分析

PHP-FPM 提供三种进程管理策略，每种策略都有其特定的适用场景和性能特征。选择正确的策略对于应用的性能和稳定性至关重要。

**static 模式**：master 启动时一次性 fork 指定数量的 worker，之后始终保持这个数量不变，无论当前的负载是多少。这种模式的优势是没有任何进程创建和销毁的开销，响应延迟最为稳定。劣势是内存占用固定，低流量时浪费资源。适用于高并发、流量稳定的生产环境，如 API 网关、电商平台的核心服务等。

**dynamic 模式**：master 根据当前的负载情况动态调整 worker 的数量。它通过维护一个空闲 worker 池来平衡响应速度和资源使用。当空闲 worker 数量低于 `pm.min_spare_servers` 时，master 会 fork 新的 worker；当空闲 worker 数量超过 `pm.max_spare_servers` 时，master 会让多余的 worker 退出。这种模式适用于流量波动较大的 Web 应用。

**ondemand 模式**：只有在收到请求时才创建 worker，空闲超过指定时间后 worker 自动退出。这种模式的内存占用最低，但第一个请求的延迟会较高（需要等待 fork 完成）。适用于开发环境或非常低流量的生产环境。

### 5.2 pm.max_children 的科学计算方法

`pm.max_children` 是 PHP-FPM 最重要的参数。设得太小会导致请求排队，设太大会导致内存溢出。以下是科学的计算方法：

```bash
#!/bin/bash
# 计算合适的 max_children 值

# 1. 获取单个 worker 的平均内存占用（RSS）
worker_mem=$(ps aux | grep 'php-fpm: pool' | grep -v grep \
    | awk '{sum += $6; count++} END {print int(sum/count/1024)}')
echo "每个 worker 平均内存占用: ${worker_mem}MB"

# 2. 获取系统总可用内存（排除系统和其他服务的使用）
available_mem=$(free -m | awk '/Mem:/{print $7}')
echo "当前可用内存: ${available_mem}MB"

# 3. 预留 20% 给操作系统和其他服务
# 4. 计算理论上可以支持的最大 worker 数
recommended=$((available_mem * 80 / 100 / worker_mem))
echo "基于内存计算的推荐 max_children: $recommended"
```

在实际的生产环境中，还需要考虑以下因素：数据库连接池的大小（每个 worker 可能占用一个数据库连接，总的数据库连接数不应超过数据库服务器的连接上限）；外部服务的并发限制（如 Redis、Elasticsearch 等）；操作系统级别的文件描述符限制（`ulimit -n`）。

### 5.3 动态模式参数的约束关系

在 dynamic 模式下，`pm.start_servers`、`pm.min_spare_servers`、`pm.max_spare_servers` 和 `pm.max_children` 之间存在隐含的约束关系。如果这些参数设置不当，PHP-FPM 可能会在启动时报警告，或者行为异常。

正确的约束是：`pm.min_spare_servers` 必须小于 `pm.max_spare_servers`；`pm.max_spare_servers` 必须小于 `pm.max_children`；`pm.start_servers` 应该介于 `pm.min_spare_servers` 和 `pm.max_spare_servers` 之间。

master 的动态调整逻辑每秒执行一次，其核心算法是：统计当前空闲的 worker 数量；如果空闲数量低于 `pm.min_spare_servers`，则创建差值数量的新 worker；如果空闲数量超过 `pm.max_spare_servers`，则终止多余的空闲 worker；如果总 worker 数量已达 `pm.max_children`，即使空闲 worker 为零也不会创建新 worker，新请求只能在 listen queue 中等待。

---

## 六、OPcache 与 PHP-FPM 的交互

### 6.1 OPcache 在多进程模型下的工作原理

OPcache 是 PHP 官方提供的字节码缓存扩展，它通过将 PHP 脚本编译后的字节码存储在共享内存中，避免了每次请求都重新解析和编译 PHP 源文件的开销。在 PHP-FPM 的多进程模型下，OPcache 的工作方式有其独特之处。

当 master 进程 fork 出 worker 子进程时，所有 worker 共享同一块 OPcache 共享内存区域。这意味着第一个请求某个 PHP 文件的 worker 会负责编译该文件并将字节码存入共享内存，后续的 worker 处理相同文件时直接从共享内存读取已编译的字节码，无需重复编译。这种共享机制极大地提升了整体性能，特别是在大型 Laravel 应用中，框架本身就有数百个 PHP 文件需要加载。

然而，OPcache 与 graceful reload 的交互有时会导致令人困惑的问题。当执行 graceful reload 时，旧 worker 退出前会在共享内存中留下旧版本的字节码缓存。新 worker 启动后，如果源文件没有变化，它们会继续使用旧 worker 留下的缓存。但如果源文件已经更新（这就是我们执行 reload 的原因），新 worker 需要重新编译更新过的文件。OPcache 通过检查文件的修改时间戳和 inode 号来判断缓存是否过期。

这里有一个常见的陷阱：当使用 Docker 容器或 Kubernetes 部署时，如果新旧代码部署在不同的容器中，或者使用了只读文件系统，文件的时间戳可能不会正确更新，导致 OPcache 继续使用旧版本的字节码。解决方法是在部署脚本中显式地调用 `opcache_reset()` 函数，或者使用 `opcache.revalidate_path` 和 `opcache.validate_timestamps` 配置来强制 OPcache 检查文件变化。

### 6.2 OPcache 的内存管理与调优

OPcache 的共享内存大小由 `opcache.memory_consumption` 参数控制，默认值为 128MB。对于大型 Laravel 应用，这个值可能不够用。当 OPcache 的内存耗尽时，它会停止缓存新的脚本文件，导致性能下降。可以通过 `opcache_get_status()` 函数查看当前的内存使用情况：

```php
<?php
$status = opcache_get_status();
$used = $status['memory_usage']['used_memory'];
$free = $status['memory_usage']['free_memory'];
$wasted = $status['memory_usage']['wasted_memory'];

echo "OPcache 内存使用: " . round($used / 1024 / 1024, 2) . "MB\n";
echo "OPcache 空闲内存: " . round($free / 1024 / 1024, 2) . "MB\n";
echo "OPcache 浪费内存: " . round($wasted / 1024 / 1024, 2) . "MB\n";
echo "已缓存脚本数量: " . $status['opcache_statistics']['num_cached_scripts'] . "\n";
```

在生产环境中，建议将 `opcache.memory_consumption` 设置为应用所有 PHP 文件编译后字节码总大小的 1.5 到 2 倍。同时设置 `opcache.max_accelerated_files` 为应用中 PHP 文件数量的 1.2 倍以上，确保所有文件都能被缓存。此外，还需要关注 `opcache.validate_timestamps` 的设置。在生产环境中将其设为 0 可以获得最佳性能（因为不需要在每次请求时检查文件修改时间），但在更新代码后必须手动调用 `opcache_reset()` 或重启 PHP-FPM。在开发环境中则应该设为 1，让 OPcache 自动检测文件变化。这种开发与生产环境的配置差异，也是很多开发者在本地修改代码后看不到更新效果的常见原因。

### 6.3 OPcache 的预加载功能

PHP 7.4 引入了 OPcache 预加载（preloading）功能，允许在 PHP-FPM 启动时预先编译和加载一组指定的 PHP 文件。这对于 Laravel 这样的大型框架特别有价值，因为框架的核心文件（如服务容器、路由、中间件等）在每个请求中都会被使用。通过预加载，这些文件的字节码在 worker 启动时就已经在共享内存中准备好了，第一个请求就能享受到完整的缓存加速效果，而不需要等待"冷启动"过程。

预加载的配置需要在 `php.ini` 中指定一个预加载脚本文件，该脚本使用 `opcache_compile_file()` 函数来加载指定的 PHP 文件。需要注意的是，预加载的文件有一些限制，例如不能包含 `include` 或 `require` 语句，也不能使用条件定义的类或函数。在实际应用中，预加载通常只用于框架最核心的文件，而不是整个应用代码。

## 七、使用 strace 和 gdb 调试 PHP-FPM 进程

### 7.1 strace 跟踪 Worker 的系统调用

当 worker 行为异常（如长时间不响应、占用过多 CPU、频繁的上下文切换等）时，`strace` 是最直接的调试工具。它能够显示进程的每一个系统调用及其参数和返回值，让我们能够精确定位问题所在。

```bash
# 跟踪单个 worker 的所有系统调用，显示时间戳
strace -p <worker_pid> -e trace=all -f -tt -T

# 只跟踪网络相关的系统调用（connect、recv、send 等）
strace -p <worker_pid> -e trace=network -tt

# 跟踪文件 I/O（open、read、write、stat 等）
strace -p <worker_pid> -e trace=file -tt

# 跟踪进程相关系统调用（fork、clone、waitpid 等）
strace -p <worker_pid> -e trace=process -tt

# 输出到文件（生产环境推荐，避免终端输出影响性能）
strace -p <worker_pid> -e trace=all -tt -T -o /tmp/strace_worker.log
```

通过分析 strace 的输出，我们可以了解 worker 在等待什么（是数据库查询、网络请求还是文件 I/O）；worker 卡在哪个系统调用上（是 `read` 阻塞了还是 `connect` 超时了）；每个系统调用的耗时是多少（`-T` 参数会显示每个系统调用的执行时间）。

### 7.2 strace 诊断 Graceful Reload 问题

当 graceful reload 出现问题时（如旧 worker 没有按时退出），strace 可以帮助我们精确定位原因：

```bash
# 终端 1：跟踪 master 进程的信号处理
strace -p <master_pid> -e trace=signal -tt -f -o /tmp/master_signal.log

# 终端 2：发送 SIGUSR2 触发 graceful reload
kill -USR2 <master_pid>

# 终端 3：观察旧 worker 的状态
# 找到旧 worker 的 PID 列表
OLD_WORKERS=$(ps aux | grep 'php-fpm: pool' | grep -v grep | awk '{print $2}')
for pid in $OLD_WORKERS; do
    strace -p $pid -e trace=signal,read,write,close,exit_group -tt -o /tmp/worker_${pid}.log &
done
```

通过分析 strace 输出的时间线，我们可以精确地看到：master 何时收到 SIGUSR2 信号；master 何时向每个 worker 发送 SIGQUIT 信号；每个 worker 何时收到 SIGQUIT；每个 worker 何时完成最后一个 `write` 系统调用（响应写回）；每个 worker 何时调用 `exit_group` 退出；是否有 worker 在某个系统调用上长时间阻塞。

### 7.3 gdb 调试 Worker 的内部状态

gdb 可以让我们查看进程的内部变量和调用栈，这在排查复杂问题时非常有用：

```bash
# 附着到正在运行的 worker
gdb -p <worker_pid>

# 查看 PHP 调用栈
(gdb) bt
#0  0x00007f8c12345678 in epoll_wait () from /lib/x86_64-linux-gnu/libc.so.6
#1  0x00005555556789ab in fpm_event_loop ()
#2  0x0000555555678123 in fpm_worker_main ()
#3  0x0000555555677456 in fpm_children_make ()

# 查看信号处理相关变量
(gdb) p fpm_got_signal
(gdb) p fpm_config->process_control_timeout
(gdb) p graceful_stop

# 查看 worker 的 scoreboard 信息
(gdb) p fpm_scoreboard->procs[0]

# 设置断点，在信号处理时暂停
(gdb) break fpm_got_signal_handler
(gdb) continue
```

### 7.4 lsof 排查文件描述符泄漏

文件描述符泄漏是 PHP 扩展中常见的问题。当 worker 长时间运行且 `pm.max_requests` 设置过大时，泄漏的文件描述符会逐渐累积，最终导致 `Too many open files` 错误：

```bash
# 查看某个 worker 打开的所有文件描述符
lsof -p <worker_pid>

# 统计每个 worker 的 fd 数量（正常应为 20-30 个）
for pid in $(pgrep -f 'php-fpm: pool'); do
    echo "PID $pid: $(ls /proc/$pid/fd 2>/dev/null | wc -l) fds"
done

# 如果发现某个 worker 有上千个 fd，说明存在泄漏
# 可以通过 lsof 的输出分析泄漏的 fd 类型（socket、pipe、file 等）
```

---

## 八、生产环境的真实案例分析

### 8.1 案例一：Graceful Reload 导致 502 错误

在实际的运维工作中，graceful reload 引发的 502 错误是最常见的部署相关问题之一。这类问题通常表现为：部署流水线执行完毕后，监控系统短暂地出现一波 502 告警，持续几秒到十几秒后自动恢复。虽然问题持续时间很短，但在高并发的业务场景下，这几秒钟的故障可能会影响成百上千个用户请求，在电商大促或金融交易等关键时段更是不可接受的。要彻底解决这个问题，必须理解 graceful reload 的时序特征和各种超时参数之间的关系。

**现象描述**：某电商网站在每次部署新代码时（执行 `systemctl reload php-fpm`），监控系统都会记录到 3-5 个 502 错误。虽然数量不多，但在大促期间这些错误可能影响用户体验和订单转化率。

**排查过程**：通过分析 Nginx 错误日志，发现这些 502 错误的类型都是 `recv() failed (104: Connection reset by peer)`，说明 PHP-FPM 端主动关闭了连接。进一步检查 PHP-FPM 的慢日志，发现 reload 发生时正好有几个请求在处理耗时的外部 API 调用。

**根因分析**：当时 `process_control_timeout` 设置为 5 秒，而某些请求（如调用支付接口、物流查询接口）的响应时间偶尔会超过 5 秒。当 graceful reload 发生时，这些正在处理的请求还没有完成，但已经超过了超时时间，master 就向这些 worker 发送了 SIGKILL 强制终止，导致 Nginx 收到连接重置。

**解决方案**：将 `process_control_timeout` 增加到 30 秒，同时在代码层面优化外部 API 调用的超时设置，确保大部分请求在 10 秒内完成。此外，将部署操作安排在流量低谷期进行，进一步减少影响。

### 8.2 案例二：Worker 内存持续增长导致 OOM（内存溢出）

内存泄漏是 PHP 生产环境中最隐蔽也最危险的问题之一。由于 PHP-FPM 的 worker 是长驻内存的进程，即使是每次请求只泄漏几百字节的微小泄漏，在累积数千次请求后也会演变为严重的内存问题。更棘手的是，这种泄漏往往不会在开发环境中被发现，因为开发环境的请求量远低于生产环境，而且开发人员通常不会让一个 worker 持续运行数千次请求。这就是为什么设置合理的 `pm.max_requests` 值如此重要——它是对抗内存泄漏的最后一道防线。

**现象描述**：某 Laravel 应用部署后运行数小时，服务器内存逐渐被耗尽，最终触发 Linux 的 OOM Killer，杀掉了 PHP-FPM 的 master 进程，导致整个服务完全不可用。运维团队发现，每次重启 PHP-FPM 后内存使用都会回到正常水平，但几小时后又会缓慢增长到危险线以上。

**排查过程**：编写了一个监控脚本，每隔 60 秒记录所有 worker 的 RSS（Resident Set Size）内存使用情况。观察到 worker 的内存从初始的 40MB 逐渐增长到 200MB 以上，且增长曲线近似线性，没有收敛的趋势。这说明存在慢速内存泄漏。

**根因分析**：通过 Xdebug 的内存分析功能，定位到某个第三方 PHP 扩展在每次请求后不释放其内部缓存。加上 `pm.max_requests` 设置为 0（无限制），单个 worker 可以处理无限数量的请求，内存泄漏持续累积。在处理了约 5000 个请求后，每个 worker 的内存占用达到了系统可用内存的上限。

**解决方案**：将 `pm.max_requests` 设置为 1000，让 worker 在处理 1000 个请求后自动退出并由 master 重新创建。同时联系扩展开发者修复内存泄漏问题。在问题修复之前，通过 Prometheus 监控 worker 内存使用，在达到阈值时提前告警。

### 8.3 案例三：Worker 池被打满导致全站超时（级联故障）

Worker 池被打满是 PHP-FPM 最典型的故障模式之一，也是最容易引发级联故障的场景。当所有 worker 都处于忙碌状态时，新到达的请求只能在 listen queue 中排队等待。随着排队时间的增长，越来越多的请求会超时，前端的 Nginx 开始返回 504 错误。如果此时有健康检查或监控探针在请求服务，它们也会超时，可能导致负载均衡器将该节点标记为不健康，进而将所有流量转移到其他节点，引发雪崩效应。因此，理解 worker 池被打满的根因并提前做好防护，是保障服务可用性的关键。

**现象描述**：某 API 服务在高峰期出现大规模的请求超时，响应时间从正常的 50ms 飙升到 5000ms 以上，大量客户端收到 504 Gateway Timeout 错误。用户反馈页面加载极慢，部分功能完全不可用。

**排查过程**：通过 `php-fpm status` 页面查看 worker 状态，发现所有 100 个 worker 都处于 active（忙碌）状态，idle 为 0，listen queue 长度持续增长。查看每个 active worker 正在处理的请求，发现它们全部阻塞在同一个第三方 API 调用上。

**根因分析**：第三方支付服务的响应时间突然飙升（从正常的 200ms 变成了 10 秒以上），但代码中没有设置 cURL 超时。100 个 worker 全部被阻塞在 `curl_exec()` 调用上，无法处理任何新的请求。新到达的请求在 listen queue 中排队，当队列满了之后就被拒绝。

**解决方案**：在 cURL 调用中设置了 3 秒的总超时和 1 秒的连接超时。同时引入了熔断器模式，当第三方服务连续失败时自动降级。将 `pm.max_children` 从 100 增加到 200 以提供更多的缓冲空间。在 Nginx 层面添加了 `fastcgi_read_timeout` 和请求速率限制。

---

## 九、Nginx 与 PHP-FPM 的协作机制

### 9.1 FastCGI 协议简述

PHP-FPM 与 Nginx 之间的通信基于 FastCGI 协议，这是一个二进制协议，设计用于在 Web 服务器和应用程序之间高效地传递请求和响应。与传统的 CGI 模式（每个请求 fork 一个新进程）不同，FastCGI 使用长驻进程来处理请求，避免了频繁 fork 的开销。

当 Nginx 收到一个 PHP 请求时，它会通过 FastCGI 协议将请求信息（包括请求方法、URI、查询字符串、请求头、请求体等）编码为二进制格式，通过预先建立的 TCP 连接或 Unix 域套接字发送给 PHP-FPM 的 worker 进程。worker 进程接收到完整的请求数据后，初始化 PHP 运行环境，执行对应的 PHP 脚本，将输出通过 FastCGI 协议返回给 Nginx，最后关闭连接或保持连接以处理后续请求。

这种架构的优势在于，Nginx 可以专注于处理静态文件、SSL 终止、请求路由、负载均衡等网络密集型工作，而 PHP-FPM 专注于执行 PHP 脚本这种计算密集型工作。两者通过高效的二进制协议通信，各司其职，整体性能远优于将 PHP 模块直接嵌入 Web 服务器的方案。

### 9.2 Nginx 的 FastCGI 配置与 PHP-FPM 的关联

在 Nginx 的配置中，有几个关键参数直接影响 PHP-FPM 的行为。`fastcgi_pass` 指定了 PHP-FPM 的监听地址，可以是 TCP 端口（如 `127.0.0.1:9000`）或 Unix 域套接字（如 `/run/php/php8.2-fpm.sock`）。Unix 域套接字在本地通信时性能更好，因为它避免了 TCP 协议栈的开销。`fastcgi_read_timeout` 定义了 Nginx 等待 PHP-FPM 响应的最大时间，如果 PHP 脚本执行时间超过这个值，Nginx 会返回 504 错误。这个参数必须大于 PHP 的 `max_execution_time`，否则用户会看到 504 而不是 PHP 的致命错误信息。

### 9.3 PHP-FPM 的 status 和 ping 端点

PHP-FPM 提供了两个内置的监控端点：`status` 和 `ping`。启用这些端点需要在 pool 配置中添加以下内容：

```ini
[www]
pm.status_path = /fpm-status
ping.path = /fpm-ping
```

然后在 Nginx 中配置对应的 location：

```nginx
location ~ ^/(fpm-status|fpm-ping)$ {
    access_log off;
    allow 127.0.0.1;
    allow 10.0.0.0/8;
    deny all;
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    include fastcgi_params;
}
```

通过定期请求 `fpm-status` 端点，监控系统可以获取到 worker 的实时状态数据，包括已接受的连接数、活跃进程数、空闲进程数、监听队列长度等关键指标。这些指标是判断 PHP-FPM 是否健康的重要依据。例如，如果 `idle processes` 持续为零且 `listen queue` 持续增长，说明 worker 池已经饱和，需要增加 `pm.max_children` 或优化应用代码的响应速度。

## 十、总结与最佳实践

通过对 PHP-FPM 进程模型的深度剖析，我们可以总结出以下关键认知和最佳实践：

在架构层面，PHP-FPM 采用的 Master-Worker 多进程模型虽然在内存效率上不如 Node.js 的单进程事件循环模型，但它在稳定性、安全性和易调试性方面有着显著的优势。每个 worker 的独立地址空间保证了一个请求的崩溃不会影响其他请求，这也是 PHP 能够在生产环境中长期稳定运行的基石。

在配置层面，`pm.max_children` 是最关键的参数，必须根据服务器的内存和应用的内存使用模式科学计算，而不是凭感觉设置。`pm.max_requests` 是防止内存泄漏的安全阀，建议设置为 500 到 5000 之间的值。`process_control_timeout` 是 graceful reload 的保障，必须根据应用的最长请求处理时间合理设置。

在运维层面，理解信号的行为是安全运维的基础。部署新代码时使用 `reload`（SIGUSR2）而不是 `restart`（SIGTERM），可以实现零请求损失的平滑更新。日志轮转时使用 SIGUSR1 重新打开日志文件，避免日志丢失。监控 `php-fpm status` 页面的关键指标，做到问题的早发现、早处理。

在调试层面，`strace` 和 `gdb` 是排查 PHP-FPM 问题的两大利器。`strace` 能让我们看到系统调用级别的细节，`gdb` 能让我们查看进程的内部状态。掌握这两个工具的使用方法，将极大地提升在生产环境中排查问题的效率。

最后，建议在生产环境中建立完善的 PHP-FPM 监控体系，包括 worker 状态分布（idle/active/total）、listen queue 长度、每个 worker 的内存和 CPU 使用、slow log 的分析和告警、graceful reload 的成功率监控等。这些监控数据不仅能帮助我们及时发现和处理问题，还能为容量规划和性能优化提供数据支撑。

在容器化部署日益普及的今天，理解 PHP-FPM 的进程模型变得更加重要。在 Docker 或 Kubernetes 环境中，一个容器通常只运行一个 PHP-FPM 实例，容器的资源限制（CPU 和内存配额）直接影响 `pm.max_children` 的设置上限。如果 `pm.max_children` 设置过大，容器可能因为内存超限被 Kubernetes 的 OOM Killer 杀掉；如果设置过小，则无法充分利用分配的资源。建议在容器化部署时，根据容器的内存配额和单个 worker 的平均内存使用来精确计算 `pm.max_children` 的值，并预留 10% 到 15% 的内存余量给操作系统和 OPcache 使用。同时，在 Kubernetes 的 Pod 配置中设置合理的 `livenessProbe` 和 `readinessProbe`，使用 PHP-FPM 的 `ping` 端点作为健康检查接口，确保容器在 PHP-FPM 不可用时能够自动重启。

## 相关阅读

- [PHP 进程模型深度剖析：PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制](/post/php-fpm-worker-lifecycle-signal-graceful-reload.html)
- [RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP 进程模型与选型决策](/post/RoadRunner-实战-Go驱动的PHP高性能应用服务器-对比Octane-Swoole-FrankenPHP进程模型与选型决策.html)
- [PHP Fiber 深度实战：从零实现一个协程调度器——理解 Swoole/Octane 的底层原理](/post/2026-06-02-php-fiber-deep-dive-coroutine-scheduler-swoole-octane-internals.html)
- [Rust Tokio 异步运行时深度实战：事件循环、任务调度、背压控制——对比 PHP Fibers 与 Go goroutine](/post/Rust-Tokio-异步运行时深度实战-事件循环-任务调度-背压控制-对比PHP-Fibers与Go-goroutine.html)
