---
title: Linux 安全加固实战：AppArmor/SELinux/seccomp 策略——Docker/K8s 容器逃逸防护与最小权限落地
date: 2026-06-03 09:00:00
tags: [Linux, AppArmor, SELinux, seccomp, Docker, K8s, 安全]
categories:
  - devops
cover: /images/covers/linux-security-hardening-cover.jpg
description: "容器共享宿主机内核，逃逸风险真实存在。本文通过 CVE-2022-0185、CVE-2020-15257 等真实漏洞案例，系统讲解 Linux 三大安全机制 AppArmor、SELinux、seccomp 的原理与实战配置。覆盖 Docker/K8s 环境下的容器逃逸防护、最小权限策略落地、安全 Profile 编写、自动化测试与 CI 集成，附带完整的安全加固检查清单，帮助运维和安全团队构建纵深防御体系。"
---

# Linux 安全加固实战：AppArmor/SELinux/seccomp 策略——Docker/K8s 容器逃逸防护与最小权限落地

## 一、容器逃逸案例分析

容器不是虚拟机。Docker 容器共享宿主机内核，一旦内核存在漏洞或容器配置不当，攻击者就能从容器内部"逃逸"到宿主机，控制整个节点。

### 1.1 典型容器逃逸 CVE

#### CVE-2022-0185：内核堆溢出漏洞

```bash
# 影响：Linux Kernel < 5.16.2
# 攻击者通过 filesystem context 操作触发堆溢出
# 在具有 CAP_SYS_ADMIN 的容器中可实现逃逸

# 复现 PoC（仅供安全研究）
#include <sys/syscall.h>
#include <fcntl.h>

int main() {
    int fd = fsopen("ext4", 0);
    for (int i = 0; i < 5000; i++) {
        fsconfig(fd, FSCONFIG_SET_STRING, "AAAAAAAAAAAAAAAA", "BBBB", 0);
    }
    // 触发堆溢出...
}
```

#### CVE-2020-15257：Host 网络模式逃逸

```bash
# 当容器使用 --network=host 时
# 容器内可访问宿主机的 abstract Unix socket
# 攻击者可连接 containerd 的 gRPC socket 获取宿主机控制权

docker run --network=host vulnerable-image
# 在容器内：
ls -la /proc/self/ns/net  # 与宿主机共享网络命名空间
```

#### CVE-2019-5736：runc 逃逸

```bash
# 攻击者替换容器内的 runc 二进制
# 当宿主机再次执行 docker exec 时，宿主机的 runc 被替换为恶意版本
# 影响 runc < 1.0-rc6

# 防护措施：
# 1. 升级 runc 到最新版
# 2. 将 runc 设为只读
# 3. 使用 SELinux/AppArmor 限制容器权限
```

### 1.2 容器逃逸攻击面总结

```
┌─────────────────────────────────────────────────────────┐
│              容器逃逸攻击面                               │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. 内核漏洞                                             │
│     ├─ syscall 漏洞（CVE-2022-0185）                    │
│     ├─ 文件系统漏洞（overlayfs）                        │
│     └─ 网络栈漏洞                                       │
│                                                          │
│  2. 容器运行时漏洞                                       │
│     ├─ runc 逃逸（CVE-2019-5736）                       │
│     ├─ containerd 漏洞                                  │
│     └─ Docker daemon API 暴露                           │
│                                                          │
│  3. 配置错误                                             │
│     ├─ --privileged（所有能力）                          │
│     ├─ --network=host（共享网络）                        │
│     ├─ --pid=host（共享进程空间）                        │
│     ├─ 挂载 Docker socket                               │
│     └─ 挂载敏感目录（/etc, /proc, /sys）                │
│                                                          │
│  4. 镜像漏洞                                             │
│     ├─ 基础镜像包含漏洞软件                              │
│     ├─ 镜像中嵌入密钥                                    │
│     └─ 恶意镜像投毒                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## 二、Linux 安全模块概述

Linux Security Modules (LSM) 是内核提供的安全框架，通过 hook 系统调用来实现强制访问控制。

```
┌──────────────────────────────────────────────────────┐
│                  LSM 框架                              │
├──────────────────────────────────────────────────────┤
│                                                       │
│  应用程序 (PHP, Python, Go...)                        │
│        │                                              │
│        ▼                                              │
│  系统调用 (open, write, connect, exec...)             │
│        │                                              │
│        ▼                                              │
│  ┌─────────────────────────────────────┐             │
│  │         LSM Hook Points             │             │
│  │  (security_file_open, etc.)         │             │
│  └─────────────────────────────────────┘             │
│        │                                              │
│   ┌────┼────────┬─────────────┐                      │
│   ▼    ▼        ▼             ▼                      │
│ SELinux AppArmor seccomp    Yama/Lockdown            │
│ (MAC)   (path)   (syscall)  (ptrace)                 │
│                                                       │
│   ↓                                              ↓    │
│  内核 → 执行/拒绝                              ↓    │
└──────────────────────────────────────────────────────┘
```

### LSM 子系统对比

| 特性 | SELinux | AppArmor | seccomp | Yama |
|------|---------|----------|---------|------|
| 类型 | 强制访问控制 (MAC) | 路径访问控制 | syscall 过滤 | ptrace 控制 |
| 粒度 | 极高（标签） | 高（路径） | 中（syscall） | 低（ptrace） |
| 复杂度 | 🔴 极高 | 🟡 中 | 🟢 低 | 🟢 极低 |
| 默认启用 | RHEL/CentOS | Ubuntu/SUSE | Docker/K8s | 所有发行版 |
| 学习曲线 | 数周 | 数天 | 数小时 | 数分钟 |
| 容器支持 | Podman/Docker | Docker/K8s | Docker/K8s | 通用 |

## 三、AppArmor：路径级访问控制

### 3.1 AppArmor 工作原理

AppArmor 通过**路径**来标识资源，每个进程关联一个 Profile，Profile 定义了该进程可以访问哪些文件、执行哪些操作。

```
┌──────────────────────────────────────────┐
│           AppArmor 架构                   │
├──────────────────────────────────────────┤
│                                           │
│  Profile 文件 (/etc/apparmor.d/)         │
│  ┌────────────────────────────────────┐  │
│  │ profile myapp /usr/bin/php {       │  │
│  │   /var/www/** r,                   │  │
│  │   /tmp/** rw,                      │  │
│  │   network inet stream,             │  │
│  │   deny /etc/shadow r,              │  │
│  │ }                                  │  │
│  └────────────────────────────────────┘  │
│          │                                │
│          ▼                                │
│  AppArmor 内核模块                        │
│  ├─ 解析进程请求的路径                   │
│  ├─ 匹配 Profile 规则                   │
│  └─ 允许/拒绝/审计                      │
│                                           │
│  模式：                                   │
│  ├─ enforce：强制执行，违规直接拒绝       │
│  └─ complain：仅记录，不拒绝（调试用）   │
└──────────────────────────────────────────┘
```

### 3.2 Docker 容器的 AppArmor Profile

Docker 默认使用 `docker-default` Profile：

```bash
# 查看默认 Profile
cat /etc/apparmor.d/docker-default

# 或查看运行中容器的 Profile
docker inspect --format='{{.AppArmorProfile}}' <container_id>
```

自定义 AppArmor Profile：

```bash
# /etc/apparmor.d/containers/myapp-laravel
#include <tunables/global>

profile myapp-laravel flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>
  #include <abstractions/php>
  #include <abstractions/mysql>

  # === 文件访问 ===

  # 应用代码（只读）
  /var/www/html/** r,

  # Laravel 存储目录（读写）
  /var/www/html/storage/** rwk,
  /var/www/html/bootstrap/cache/** rwk,

  # 临时文件
  /tmp/** rwk,
  /var/tmp/** rwk,

  # PHP 配置（只读）
  /etc/php/** r,
  /usr/lib/php/** r,

  # 系统库（只读）
  /lib/x86_64-linux-gnu/** r,
  /usr/lib/x86_64-linux-gnu/** r,

  # 禁止访问敏感文件
  deny /etc/shadow r,
  deny /etc/passwd w,
  deny /root/** rwx,
  deny /home/** rwx,

  # 禁止访问 Docker socket
  deny /var/run/docker.sock rw,

  # === 网络 ===

  # 允许 TCP 出站（HTTP/HTTPS/MySQL/Redis）
  network inet stream,
  network inet6 stream,

  # 禁止 raw socket（防止 ARP 欺骗等）
  deny network raw,
  deny network packet,

  # === 能力 ===

  # 允许的 capabilities
  capability net_bind_service,  # 绑定 <1024 端口

  # 禁止危险 capabilities
  deny capability sys_admin,
  deny capability sys_ptrace,
  deny capability sys_rawio,
  deny capability net_admin,

  # === 信号 ===

  # 允许发送 SIGTERM/SIGQUIT（graceful shutdown）
  signal (send) set=(term, quit) peer=myapp-laravel,

  # 禁止发送信号到其他进程
  deny signal (send) peer=!myapp-laravel,

  # === 执行 ===

  # 允许执行的程序
  /usr/bin/php ix,
  /usr/bin/composer ix,
  /usr/bin/node ix,

  # 禁止执行 shell（生产环境）
  deny /bin/bash x,
  deny /bin/sh x,
  deny /usr/bin/env x,

  # === Ptrace ===

  deny ptrace,
}
```

### 3.3 加载与应用 Profile

```bash
# 编译 Profile
apparmor_parser -r /etc/apparmor.d/containers/myapp-laravel

# 检查 Profile 状态
aa-status | grep myapp

# 切换到 complain 模式（调试）
aa-complain /etc/apparmor.d/containers/myapp-laravel

# 切换到 enforce 模式（生产）
aa-enforce /etc/apparmor.d/containers/myapp-laravel

# Docker 使用自定义 Profile
docker run --security-opt apparmor=myapp-laravel \
  -v /var/www/html:/var/www/html \
  php:8.3-fpm

# 生成 Profile（基于运行时行为）
aa-genprof /usr/bin/php  # 交互式生成
# 或使用 aa-logprof 从日志中学习
```

### 3.4 K8s 中使用 AppArmor

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-laravel
  annotations:
    # 注解方式指定 AppArmor Profile
    container.apparmor.security.beta.kubernetes.io/myapp: localhost/myapp-laravel
spec:
  template:
    spec:
      containers:
      - name: myapp
        image: myapp:latest
        securityContext:
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          runAsUser: 1000
          allowPrivilegeEscalation: false
          capabilities:
            drop:
              - ALL
            add:
              - NET_BIND_SERVICE
```

## 四、SELinux：标签级强制访问控制

### 4.1 SELinux 工作原理

SELinux 使用**安全标签**（Security Context）来标识每个进程和资源，通过策略规则控制访问。

```bash
# 查看文件标签
ls -Z /var/www/html/
# -rw-r--r--. unconfined_u:object_r:httpd_sys_content_t:s0 index.php

# 查看进程标签
ps auxZ | grep php
# system_u:system_r:httpd_t:s0    apache  /usr/sbin/php-fpm

# 标签格式：user:role:type:level
# user    - SELinux 用户
# role    - 角色（system_r, object_r）
# type    - 类型（最重要的维度）
# level   - MLS/MCS 级别
```

### 4.2 SELinux 布尔值（快速调优）

```bash
# 列出所有布尔值
getsebool -a | grep httpd

# 常用布尔值
setsebool -P httpd_can_network_connect on      # 允许 HTTP 出站连接
setsebool -P httpd_can_network_connect_db on   # 允许连接数据库
setsebool -P httpd_execmem on                  # 允许 JIT（PHP OPcache）
setsebool -P httpd_use_nfs on                  # 允许使用 NFS
setsebool -P container_manage_cgroup on        # 容器管理 cgroup

# 查看布尔值说明
semanage boolean -l | grep httpd_can_network
```

### 4.3 SELinux 自定义策略模块

```bash
# 生成策略模块（基于 AVC 拒绝日志）
ausearch -m avc -ts recent | audit2allow -M myapp_policy

# 生成的 .te 文件：
```

```
# myapp_policy.te
module myapp_policy 1.0;

require {
    type httpd_t;
    type httpd_sys_content_t;
    type redis_port_t;
    type mysqld_port_t;
    class tcp_socket { name_connect };
    class file { read open getattr };
}

# 允许 HTTP 进程读取应用文件
allow httpd_t httpd_sys_content_t:file { read open getattr };

# 允许连接 Redis 端口
allow httpd_t redis_port_t:tcp_socket name_connect;

# 允许连接 MySQL 端口
allow httpd_t mysqld_port_t:tcp_socket name_connect;
```

```bash
# 编译并加载策略
checkmodule -M -m -o myapp_policy.mod myapp_policy.te
semodule_package -o myapp_policy.pp -m myapp_policy.mod
sudo semodule -i myapp_policy.pp

# 文件标签管理
semanage fcontext -a -t httpd_sys_content_t "/var/www/html(/.*)?"
semanage fcontext -a -t httpd_sys_rw_content_t "/var/www/html/storage(/.*)?"
restorecon -Rv /var/www/html/

# 端口标签管理
semanage port -a -t http_port_t -p tcp 8080
```

### 4.4 容器中的 SELinux

```bash
# Docker 使用 SELinux 标签
docker run --security-opt label=type:container_t \
  -v /var/www/html:/var/www/html:z \
  myapp:latest

# Podman（默认启用 SELinux）
podman run -v /var/www/html:/var/www/html:Z \
  myapp:latest
# :z = 共享标签（多容器共享卷）
# :Z = 私有标签（单容器独占卷）
```

## 五、seccomp：系统调用过滤

### 5.1 seccomp 工作原理

seccomp (Secure Computing Mode) 允许进程声明自己只使用有限的系统调用。Docker 默认启用 seccomp，限制了约 44 个危险 syscall。

```
┌────────────────────────────────────────────────┐
│            seccomp 工作流程                     │
├────────────────────────────────────────────────┤
│                                                 │
│  应用程序                                      │
│     │                                           │
│     │ syscall (e.g., open, read, write)         │
│     ▼                                           │
│  seccomp BPF filter                             │
│  ┌───────────────────────────────────┐         │
│  │  if syscall == mount:             │         │
│  │      return SECCOMP_RET_KILL      │ ← 杀死 │
│  │  elif syscall == clone:           │         │
│  │      return SECCOMP_RET_ERRNO     │ ← 报错 │
│  │  elif syscall == write:           │         │
│  │      return SECCOMP_RET_ALLOW     │ ← 允许 │
│  │  elif syscall == read:            │         │
│  │      return SECCOMP_RET_TRACE     │ ← 跟踪 │
│  └───────────────────────────────────┘         │
│     │                                           │
│     ▼                                           │
│  内核执行/拒绝                                  │
└────────────────────────────────────────────────┘
```

### 5.2 Docker 默认 seccomp Profile

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "archMap": [
    { "architecture": "SCMP_ARCH_X86_64", "subArchitectures": ["SCMP_ARCH_X86"] }
  ],
  "syscalls": [
    {
      "names": [
        "accept", "access", "arch_prctl", "bind", "brk",
        "clone", "close", "connect", "dup", "dup2",
        "epoll_create", "epoll_wait", "execve", "exit",
        "fstat", "futex", "getcwd", "getpid", "getuid",
        "ioctl", "listen", "lseek", "mmap", "mprotect",
        "munmap", "nanosleep", "newfstatat", "open", "openat",
        "pipe", "poll", "read", "recvfrom", "rt_sigaction",
        "rt_sigprocmask", "sendto", "set_robust_list",
        "set_tid_address", "socket", "stat", "write",
        "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

### 5.3 自定义 seccomp Profile

```json
// myapp-seccomp.json - 针对 Laravel PHP-FPM 的 seccomp Profile
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "comment": "Custom seccomp profile for Laravel PHP-FPM",
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86"
  ],
  "syscalls": [
    {
      "comment": "Essential syscalls",
      "names": [
        "accept4", "access", "arch_prctl", "bind", "brk",
        "clock_gettime", "clone", "close", "connect",
        "dup", "dup2", "dup3",
        "epoll_create1", "epoll_ctl", "epoll_wait",
        "execve", "exit", "exit_group",
        "faccessat", "fadvise64", "fallocate",
        "fcntl", "flock", "fstat", "ftruncate", "futex",
        "getcwd", "getdents64", "getegid", "geteuid",
        "getgid", "getpeername", "getpid", "getppid",
        "getrandom", "getsockname", "getsockopt", "getuid",
        "inotify_add_watch", "inotify_init1",
        "ioctl", "listen",
        "lseek", "lstat",
        "madvise", "memfd_create", "mincore", "mkdir",
        "mmap", "mprotect", "munmap",
        "nanosleep", "newfstatat",
        "open", "openat",
        "pipe2", "poll", "prctl",
        "pread64", "prlimit64", "pwrite64",
        "read", "readlink", "recvfrom", "recvmsg",
        "rename", "rt_sigaction", "rt_sigprocmask",
        "rt_sigreturn",
        "sendmsg", "sendto",
        "set_robust_list", "set_tid_address",
        "setsockopt", "shutdown",
        "sigaltstack", "socket", "stat", "statfs",
        "tgkill", "umask", "unlink",
        "utimensat",
        "wait4", "write", "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    },
    {
      "comment": "Block dangerous syscalls",
      "names": [
        "mount", "umount2", "pivot_root",
        "reboot", "kexec_load",
        "ptrace", "process_vm_readv", "process_vm_writev",
        "userfaultfd",
        "bpf", "perf_event_open",
        "unshare", "setns"
      ],
      "action": "SCMP_ACT_KILL"
    },
    {
      "comment": "Block network raw sockets",
      "names": ["socket"],
      "action": "SCMP_ACT_ERRNO",
      "args": [
        { "index": 0, "value": 3, "op": "SCMP_CMP_EQ" }
      ]
    }
  ]
}
```

```bash
# 使用自定义 seccomp Profile
docker run --security-opt seccomp=myapp-seccomp.json \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  php:8.3-fpm

# 完全禁用 seccomp（危险！仅调试用）
docker run --security-opt seccomp=unconfined php:8.3-fpm
```

### 5.4 seccomp BPF 编程

```python
# 使用 Python-bpfcc 编写动态 seccomp 规则
#!/usr/bin/env python3
from bcc import BPF

# BPF 程序：记录所有 openat 调用
bpf_code = """
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

struct data_t {
    u32 pid;
    u32 uid;
    char comm[TASK_COMM_LEN];
    char filename[256];
};

BPF_PERF_OUTPUT(events);

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    struct data_t data = {};
    data.pid = bpf_get_current_pid_tgid() >> 32;
    data.uid = bpf_get_current_uid_gid();
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    bpf_probe_read_user_str(&data.filename, sizeof(data.filename),
                             args->filename);
    events.perf_submit(args, &data, sizeof(data));
    return 0;
}
"""

b = BPF(text=bpf_code)

def print_event(cpu, data, size):
    event = b["events"].event(data)
    print(f"PID={event.pid} UID={event.uid} "
          f"COMM={event.comm.decode()} FILE={event.filename.decode()}")

b["events"].open_perf_buffer(print_event)
print("Tracing openat syscalls... Ctrl+C to stop.")
while True:
    b.perf_buffer_poll()
```

## 六、Docker 安全最佳实践

### 6.1 完整的安全配置

```bash
# 安全的 Docker 运行命令
docker run \
  # === 用户隔离 ===
  --user 1000:1000 \                    # 非 root 用户
  --security-opt no-new-privileges \    # 禁止提权
  
  # === 能力限制 ===
  --cap-drop=ALL \                      # 丢弃所有 capabilities
  --cap-add=NET_BIND_SERVICE \          # 仅添加必要的
  
  # === 文件系统 ===
  --read-only \                         # 只读根文件系统
  --tmpfs /tmp:size=100m,noexec \       # 临时目录
  --tmpfs /var/run:size=10m,noexec \
  
  # === 资源限制 ===
  --memory=512m \                       # 内存限制
  --memory-swap=512m \                  # 禁止 swap
  --cpus=1.0 \                          # CPU 限制
  --pids-limit=100 \                    # 进程数限制
  --ulimit nofile=1024:2048 \           # 文件描述符
  
  # === 网络 ===
  --network=myapp-network \             # 自定义网络
  --dns=8.8.8.8 \                       # DNS 设置
  
  # === 安全模块 ===
  --security-opt apparmor=myapp \       # AppArmor Profile
  --security-opt seccomp=myapp.json \   # seccomp Profile
  --security-opt label=type:container_t \ # SELinux 标签
  
  # === 日志 ===
  --log-opt max-size=50m \              # 日志大小限制
  --log-opt max-file=3 \                # 日志文件数
  
  # 镜像
  myapp:latest
```

### 6.2 Dockerfile 安全编写

```dockerfile
# 安全的 Dockerfile 示例
FROM php:8.3-fpm-alpine AS base

# 安全加固
RUN apk add --no-cache \
    su-exec \
    tini \
    && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -g 1000 -S appgroup \
    && adduser -u 1000 -S appuser -G appgroup

# 安装 PHP 扩展（使用官方脚本）
COPY --from=mlocati/php-extension-installer /usr/bin/install-php-extensions /usr/bin/
RUN install-php-extensions pdo_mysql redis opcache

# 复制应用代码
COPY --chown=appuser:appgroup . /var/www/html

WORKDIR /var/www/html

# 设置安全的文件权限
RUN chmod -R 550 /var/www/html \
    && chmod -R 770 /var/www/html/storage \
    && chmod -R 770 /var/www/html/bootstrap/cache

# 移除敏感文件
RUN rm -f .env .env.* \
    && rm -rf .git .gitignore

# 使用 tini 作为 init 进程
ENTRYPOINT ["/sbin/tini", "--"]

# 切换到非 root 用户
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD php-fpm-healthcheck || exit 1

CMD ["php-fpm"]
```

## 七、Kubernetes 安全配置

### 7.1 Pod Security Standards

```yaml
# Pod Security Admission (K8s 1.25+)
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # 强制执行 restricted 级别
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    # 警告 baseline 违规
    pod-security.kubernetes.io/warn: baseline
    pod-security.kubernetes.io/audit: baseline
```

### 7.2 SecurityContext 完整配置

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-laravel
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      # === Pod 级别安全 ===
      automountServiceAccountToken: false  # 不自动挂载 SA token
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault

      containers:
      - name: myapp
        image: myapp:latest
        imagePullPolicy: Always

        # === 容器级别安全 ===
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
              - ALL
            add:
              - NET_BIND_SERVICE

        # === 资源限制 ===
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "1000m"

        # === 健康检查 ===
        livenessProbe:
          httpGet:
            path: /health
            port: 9000
          initialDelaySeconds: 30
          periodSeconds: 10

        readinessProbe:
          httpGet:
            path: /ready
            port: 9000
          initialDelaySeconds: 5
          periodSeconds: 5

        # === 卷挂载 ===
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/www/html/bootstrap/cache
        - name: storage
          mountPath: /var/www/html/storage

      volumes:
      - name: tmp
        emptyDir:
          sizeLimit: "100Mi"
      - name: cache
        emptyDir:
          sizeLimit: "50Mi"
      - name: storage
        persistentVolumeClaim:
          claimName: myapp-storage
```

### 7.3 NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: myapp-network-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: myapp
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: nginx-ingress
    ports:
    - protocol: TCP
      port: 9000
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: mysql
    ports:
    - protocol: TCP
      port: 3306
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
  - to:  # 允许 DNS
    - namespaceSelector: {}
    ports:
    - protocol: UDP
      port: 53
```

### 7.4 OPA/Gatekeeper 策略

```yaml
# 禁止 privileged 容器
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8spspprivilegedcontainer
spec:
  crd:
    spec:
      names:
        kind: K8sPSPPrivilegedContainer
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8spspprivileged

        violation[{"msg": msg, "details": {}}] {
            c := input_containers[_]
            c.securityContext.privileged
            msg := sprintf("Privileged container is not allowed: %v", [c.name])
        }

        input_containers[c] {
            c := input.review.object.spec.containers[_]
        }
        input_containers[c] {
            c := input.review.object.spec.initContainers[_]
        }
```

## 八、纵深防御架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    纵深防御架构                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: 镜像安全                                           │
│  ├─ 镜像扫描（Trivy/Snyk）                                  │
│  ├─ 最小基础镜像（Alpine/Distroless）                        │
│  └─ 签名验证（Cosign/Notary）                                │
│                                                              │
│  Layer 2: 运行时安全                                         │
│  ├─ 非 root 用户                                             │
│  ├─ 只读文件系统                                             │
│  ├─ seccomp 系统调用过滤                                     │
│  └─ AppArmor/SELinux 访问控制                                │
│                                                              │
│  Layer 3: 网络安全                                           │
│  ├─ NetworkPolicy 微分段                                     │
│  ├─ mTLS（Istio/Linkerd）                                   │
│  └─ Ingress WAF                                             │
│                                                              │
│  Layer 4: 资源控制                                           │
│  ├─ CPU/Memory limits                                        │
│  ├─ PID limits                                               │
│  └─ Ephemeral storage limits                                 │
│                                                              │
│  Layer 5: 检测与响应                                         │
│  ├─ Falco 运行时威胁检测                                     │
│  ├─ Sysdig 审计                                              │
│  └─ Prometheus + Alertmanager 告警                           │
│                                                              │
│  Layer 6: 准入控制                                           │
│  ├─ OPA/Gatekeeper 策略                                      │
│  ├─ Pod Security Admission                                   │
│  └─ Image Policy Webhook                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 九、自动化安全扫描

### 9.1 Trivy 镜像扫描

```bash
# 安装 Trivy
brew install trivy  # macOS
sudo apt install trivy  # Ubuntu

# 扫描镜像
trivy image myapp:latest

# 扫描 Dockerfile
trivy config Dockerfile

# CI 集成（失败阈值）
trivy image --exit-code 1 --severity HIGH,CRITICAL myapp:latest
```

### 9.2 Falco 运行时检测

```yaml
# /etc/falco/falco_rules.yaml - 自定义规则

- rule: Detect Shell in Container
  desc: Detect any shell spawned in a container
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, zsh, dash)
  output: >
    Shell spawned in container
    (user=%user.name container=%container.name
     shell=%proc.name parent=%proc.pname
     cmdline=%proc.cmdline)
  priority: WARNING
  tags: [container, shell]

- rule: Detect Crypto Mining
  desc: Detect cryptocurrency mining processes
  condition: >
    spawned_process and container and
    (proc.name contains "miner" or
     proc.name contains "xmrig" or
     proc.cmdline contains "stratum+tcp://")
  output: >
    Crypto mining detected!
    (user=%user.name container=%container.name
     proc=%proc.name cmdline=%proc.cmdline)
  priority: CRITICAL
  tags: [container, crypto]

- rule: Detect Sensitive File Access
  desc: Detect access to sensitive files in container
  condition: >
    open_read and container and
    (fd.name startswith /etc/shadow or
     fd.name startswith /etc/passwd or
     fd.name contains "id_rsa" or
     fd.name contains ".env")
  output: >
    Sensitive file accessed in container
    (user=%user.name container=%container.name
     file=%fd.name proc=%proc.name)
  priority: WARNING
  tags: [container, file_access]
```

### 9.3 安全基准测试

```bash
# Docker Bench for Security
docker run --rm --net host --pid host --userns host --cap-add audit_control \
  -v /etc:/etc:ro \
  -v /var/lib:/var/lib:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  docker/docker-bench-security

# Kube-bench (CIS Kubernetes Benchmark)
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job.yaml
kubectl logs kube-bench
```

## 十、生产环境落地检查清单

### 容器安全检查清单

```
□ 基础镜像
  □ 使用最小基础镜像（Alpine/Distroless）
  □ 定期更新基础镜像
  □ 镜像签名验证

□ Dockerfile
  □ 非 root 用户（USER 指令）
  □ 多阶段构建（减小攻击面）
  □ 不嵌入密钥或 secrets
  □ .dockerignore 排除敏感文件

□ 运行时配置
  □ --cap-drop=ALL
  □ --security-opt no-new-privileges
  □ --read-only（只读文件系统）
  □ --memory 和 --cpus 限制
  □ 自定义 seccomp Profile
  □ AppArmor/SELinux Profile

□ 网络
  □ 不使用 --network=host
  □ 自定义 bridge 网络
  □ NetworkPolicy 限制出入站

□ 日志与监控
  □ Falco 运行时检测
  □ 审计日志（auditd）
  □ Prometheus 指标采集

□ CI/CD
  □ 镜像扫描（Trivy/Snyk）
  □ Dockerfile linting（Hadolint）
  □ 自动化安全测试
```

## 总结

Linux 安全加固不是"一刀切"的事情，而是**纵深防御**——在每一层都增加安全限制：

1. **AppArmor**：适合 Ubuntu 环境，路径级控制，学习曲线适中
2. **SELinux**：适合 RHEL 环境，标签级控制，最强大但最复杂
3. **seccomp**：系统调用级过滤，所有容器都应启用

最重要的是：**默认拒绝、最小权限、持续监控**。安全不是一个状态，而是一个持续的过程。

> 下一篇文章我们将探讨如何使用 Falco 和 eBPF 实现更细粒度的容器运行时安全监控。

## 相关阅读

- [Secrets Management 实战：HashiCorp Vault/SOPS/age 密钥管理——Laravel 应用的密钥轮换与审计日志](/categories/运维/Secrets-Management-HashiCorp-Vault-SOPS-age-密钥管理-Laravel密钥轮换与审计日志/)
- [Software Bill of Materials (SBOM) 实战：Syft/Trivy 生成依赖清单——供应链安全合规与 CI 集成](/categories/运维/Software-Bill-of-Materials-SBOM-实战-Syft-Trivy生成依赖清单-供应链安全合规与CI集成踩坑记录/)
- [PCI DSS 合规实战：支付系统安全标准落地——Laravel Token 化、审计日志与网络分段](/categories/运维/2026-06-02-PCI-DSS-合规实战-支付系统安全标准落地-Laravel-Token化-审计日志与网络分段/)
