
title: Linux 安全加固实战：AppArmor/SELinux/seccomp 策略——Docker/K8s 容器逃逸防护与最小权限落地
keywords: [Linux]
date: 2026-06-03 10:00:00
tags:
- Linux
- 安全加固
- AppArmor
- SELinux
- seccomp
- Docker
- Kubernetes
- 容器安全
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
description: Linux安全加固实战指南：深入解析AppArmor路径级访问控制、SELinux安全标签策略、seccomp系统调用白名单三大内核安全模块。结合Docker与Kubernetes容器逃逸CVE防护，提供从镜像构建到运行时监控的纵深防御方案，附完整代码示例与踩坑案例，适合运维工程师与开发者快速掌握容器安全加固技能。
---



# Linux 安全加固实战：AppArmor/SELinux/seccomp 策略——Docker/K8s 容器逃逸防护与最小权限落地

## 一、引言：为什么容器安全不能只靠"隔离"？

在云计算和微服务架构盛行的今天，容器技术已经成为企业部署应用的标准方式。然而，很多团队对容器安全的认知仍停留在"Docker 帮我们隔离了"的层面。实际上，容器并非虚拟机——它与宿主机共享同一个 Linux 内核，隔离的本质不过是内核提供的 namespace 和 cgroup 机制。一旦内核层的安全机制被绕过或容器运行时存在漏洞，攻击者就能突破容器边界，直接在宿主机上执行代码，这就是所谓的"容器逃逸"。

近年来，容器安全事件频频发生。CVE-2019-5736 是 runc 运行时的一个严重漏洞，攻击者可以在容器内部覆盖宿主机的 runc 二进制文件，从而在任何后续的 `docker exec` 操作中获得宿主机的 root 权限。CVE-2020-15257 则暴露了 containerd 在使用宿主机网络模式时的缺陷，攻击者可以通过 Unix 域套接字直接与 containerd 守护进程通信，绕过 Docker 的所有访问控制。这些真实案例一再提醒我们：仅靠 namespace 隔离远远不够，必须在内核层面构建多层防御体系。

Linux 内核为我们提供了丰富的安全原语，包括强制访问控制（MAC）机制如 AppArmor 和 SELinux、系统调用过滤机制 seccomp、细粒度的 Linux Capabilities、以及用于资源隔离的 Namespaces 和 Cgroups。这些机制各司其职，从不同维度限制容器的能力：AppArmor 和 SELinux 通过策略控制进程对文件、网络等资源的访问；seccomp 通过白名单机制限制进程可以发起的系统调用；Capabilities 将 root 的超级权限拆分为数十项独立能力，实现按需授予；Namespaces 提供了进程、网络、文件系统等维度的隔离；Cgroups 则限制了容器可以使用的计算资源上限。

本文将从实战角度出发，逐一深入讲解这些安全机制的原理与配置方法，结合 Docker 和 Kubernetes 环境中的真实场景，给出可落地的安全加固方案。无论你是运维工程师还是应用开发者，都能从本文中找到适合你团队的安全加固路径。

以下是 Linux 内核安全机制的全景概览：

| 机制 | 作用层级 | 核心能力 |
|------|---------|---------|
| **Namespaces** | 资源隔离 | PID/NET/MNT/UTS/IPC/USER/CGROUP 七类命名空间 |
| **Cgroups** | 资源限制 | CPU/内存/IO/网络带宽配额 |
| **Capabilities** | 权限细分 | 将 root 特权拆分为 41 项细粒度能力 |
| **seccomp** | 系统调用过滤 | 白名单/黑名单控制进程可执行的 syscall |
| **AppArmor** | 路径级 MAC | 基于路径的强制访问控制，profile 驱动 |
| **SELinux** | 标签级 MAC | 基于安全标签的强制访问控制，策略驱动 |

理解这些机制之间的层次关系非常重要：Namespaces 和 Cgroups 是容器隔离的基础，提供了最基本的进程可见性和资源边界；Capabilities 在此基础上细化了特权控制；seccomp 进一步收紧了容器进程可以调用的内核接口；AppArmor 和 SELinux 则在最高层实施强制访问控制，即使进程拥有必要的权限，也需要通过 MAC 策略的审查才能执行操作。这种层层递进的安全架构，正是纵深防御理念的核心体现。

---

## 二、AppArmor：基于路径的强制访问控制

### 2.1 AppArmor 核心概念与工作原理

AppArmor（Application Armor）是 Ubuntu、openSUSE 和 Debian 等发行版默认启用的 Linux 安全模块（LSM）。与 SELinux 基于安全标签的机制不同，AppArmor 使用文件路径作为匹配依据，这使得配置文件更加直观易懂，学习曲线也更为平缓。AppArmor 的核心思想是为每个应用程序定义一个"profile"（配置文件），明确规定该程序可以访问哪些文件、执行哪些操作、使用哪些网络资源。

AppArmor 有两种主要工作模式，理解这两种模式的区别对于安全策略的开发和调试至关重要：

**Enforce 模式**：这是生产环境应该使用的模式。在该模式下，任何违反 profile 定义的行为都会被内核直接拒绝，同时系统会在内核日志中记录违规事件。这意味着即使攻击者获得了容器内的代码执行权限，AppArmor 也能有效阻止其读取敏感文件、写入关键目录或执行未授权的操作。

**Complain 模式**：这是策略开发和调试阶段使用的模式。在该模式下，违反 profile 的行为不会被阻止，但会被记录到日志中。运维人员可以通过分析这些日志来了解应用程序的实际行为模式，逐步完善 profile 的规则定义。通常的工作流程是：先以 Complain 模式运行一段时间，收集日志，生成初始 profile，然后切换到 Enforce 模式进行测试和调整。

查看系统中 AppArmor 的状态和已加载的 profile：

```bash
# 查看当前加载的 profile 及其状态
sudo aa-status

# 输出示例：
# apparmor module is loaded.
# 45 profiles are loaded.
# 30 profiles are in enforce mode.
# 15 profiles are in complain mode.
```

### 2.2 编写 AppArmor Profile

编写一个高质量的 AppArmor profile 需要对应用程序的行为有深入的理解。以 Nginx Web 服务器为例，我们需要明确 Nginx 运行时需要访问哪些文件、监听哪些端口、以及需要哪些特权。一个好的 profile 应该遵循最小权限原则——只授予应用程序完成其功能所必需的最少权限。

下面是一个针对 Nginx 容器的安全加固 profile：

```bash
# /etc/apparmor.d/containers/nginx-hardened
#include <tunables/global>

profile nginx-hardened flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>
  #include <abstractions/openssl>
  #include <abstractions/ssl_certs>

  # 仅允许读取必要的配置文件和证书
  /etc/nginx/** r,
  /etc/ssl/** r,
  /var/log/nginx/** rw,
  /var/cache/nginx/** rw,
  /run/nginx.pid rw,

  # Web 根目录只读，防止攻击者篡改网页内容
  /var/www/html/** r,

  # 允许 IPv4 和 IPv6 的 TCP/UDP 网络访问
  network inet stream,
  network inet dgram,
  network inet6 stream,
  network inet6 dgram,

  # 允许绑定 80/443 端口提供 Web 服务
  network inet stream bind,
  network inet6 stream bind,

  # 关键：禁止执行任何 shell，防止反弹 shell 攻击
  deny /bin/sh cx,
  deny /bin/bash cx,
  deny /usr/bin/bash cx,

  # 禁止写入 /proc 和 /sys，防止内核参数篡改
  deny /proc/** w,
  deny /sys/** w,

  # 禁止 mount/umount/pivot_root 操作，防止文件系统逃逸
  deny mount,
  deny umount,
  deny pivot_root,

  # 限制信号发送，只允许向自身和 unconfined 进程发送信号
  signal (receive) peer=unconfined,
  signal (send,receive) peer=nginx-hardened,
}
```

这个 profile 的设计思路值得深入分析：首先，通过 `#include` 引入了基础的文件访问抽象层，这些抽象层定义了应用程序通常需要的最低限度的文件访问权限。然后，显式列出了 Nginx 需要访问的具体路径和操作类型。网络方面，只允许了 Nginx 正常工作所需的 socket 类型。最后，通过 `deny` 规则明确禁止了 shell 执行、内核参数写入、文件系统挂载等危险操作。这些 deny 规则即使在 profile 的其他部分意外授予了相关权限时也会生效，因为显式 deny 优先于允许规则。

加载和管理 AppArmor profile：

```bash
# 将 profile 加载到内核
sudo apparmor_parser -r /etc/apparmor.d/containers/nginx-hardened

# 切换到 enforce 模式（生产环境使用）
sudo aa-enforce /etc/apparmor.d/containers/nginx-hardened

# 切换到 complain 模式（调试时使用）
sudo aa-complain /etc/apparmor.d/containers/nginx-hardened

# 通过内核日志查看 AppArmor 的拒绝事件
sudo dmesg | grep apparmor="DENIED"
sudo journalctl -k | grep apparmor

# 查看特定 profile 的详细状态
sudo cat /sys/kernel/security/apparmor/profiles | grep nginx
```

### 2.3 Docker 中集成 AppArmor

Docker 默认为每个容器加载名为 `docker-default` 的 AppArmor profile。这个默认 profile 提供了基本的保护，阻止了容器内的一些危险操作（如挂载文件系统、写入 /proc 和 /sys 的关键路径等）。但在高安全需求的场景下，我们应该为不同类型的应用编写专用的 profile。

使用自定义 AppArmor profile 启动容器：

```bash
# 使用自定义 AppArmor profile 启动容器
docker run -d \
  --security-opt apparmor=nginx-hardened \
  --name nginx-secure \
  nginx:alpine

# 验证 profile 已正确加载
docker inspect --format='{{.AppArmorProfile}}' nginx-secure
# 输出: nginx-hardened

# 进入容器验证 AppArmor 状态
docker exec nginx-secure cat /proc/self/attr/current
# 输出: nginx-hardened (enforce)
```

查看和修改 Docker 默认的 AppArmor profile：

```bash
# 查看 Docker 默认 profile 的内容
cat /etc/apparmor.d/docker-default

# 如果修改了 docker-default，需要重新加载
sudo apparmor_parser -r /etc/apparmor.d/docker-default
sudo systemctl restart docker
```

### 2.4 自动生成 AppArmor Profile 的工具链

手动编写 profile 费时费力且容易出错。社区提供了多种工具来自动生成和优化 AppArmor profile。`aa-genprof` 是 AppArmor 自带的交互式 profile 生成工具，它会监控应用程序的运行行为，自动建议需要添加的规则。对于 Docker 环境，`Bane` 是一个更专业的工具，它专门为容器应用生成 AppArmor profile，考虑了容器运行时的特殊需求。

```bash
# 安装 AppArmor 工具集
sudo apt install apparmor-utils

# 使用 aa-genprof 交互式生成 profile
sudo aa-genprof /usr/sbin/nginx
# 按照提示操作：先运行应用程序，工具会自动记录行为
# 然后逐条审核建议的规则，决定允许或拒绝

# 使用 aa-logprof 从已有日志生成规则
sudo aa-logprof

# 使用 Bane 为 Docker 容器生成专用 profile
# 安装：https://github.com/genuinetools/bane
bane generate nginx
# 生成的 TOML 配置文件包含所有建议的规则
# 审核后编译为 AppArmor profile
bane build nginx.toml
```

### 2.5 AppArmor 踩坑案例与调试实战

**案例一：路径通配符 `**` 与 `*` 混淆导致策略失效**

初学者最容易犯的错误是混淆 `**` 和 `*` 的含义。`*` 只匹配单层目录下的文件，而 `**` 匹配任意深度的路径。如果你的 Web 应用有深层嵌套的目录结构，使用 `*` 会导致子目录中的文件无法被访问。

```bash
# ❌ 错误写法：/var/www/*/uploads/* 只能匹配一层目录
/var/www/*/uploads/* rw,

# ✅ 正确写法：/var/www/**/uploads/** 匹配任意深度
/var/www/**/uploads/** rw,

# 调试方法：在 complain 模式下观察哪些访问被记录
sudo aa-complain /etc/apparmor.d/containers/my-app
# 运行应用，触发所有功能
# 检查日志中是否有 DENIED 事件
sudo journalctl -k | grep apparmor | grep DENIED
```

**案例二：attach_disconnected 标志遗漏导致容器内 Profile 不生效**

在 Docker 容器中使用自定义 AppArmor profile 时，如果 profile 头部没有设置 `flags=(attach_disconnected)`，容器内的进程可能不会被正确关联到 profile，导致 profile 完全不生效但没有任何报错。

```bash
# ❌ 错误写法：缺少 attach_disconnected 标志
profile my-app {
  ...
}

# ✅ 正确写法：必须包含 attach_disconnected
profile my-app flags=(attach_disconnected,mediate_deleted) {
  ...
}

# 验证 profile 是否真的生效：
docker exec my-container cat /proc/self/attr/current
# 如果输出 "unconfined" 说明 profile 没有生效！
# 正确输出应为 "my-app (enforce)"
```

**案例三：deny 规则与 allow 规则冲突的排查**

当 profile 中同时存在 allow 和 deny 规则时，deny 规则始终优先。但如果通过 `#include` 引入的抽象层中包含了你想要 deny 的权限，排查会变得困难。

```bash
# 查看 profile 的完整合并规则（包括所有 include 展开后的内容）
sudo cat /sys/kernel/security/apparmor/profiles | grep my-app
# 或使用 aa-status 查看详细状态

# 查看特定路径的访问决策链
sudo aa-notify -u 10 -f /var/log/syslog  # 实时显示最近的拒绝事件

# 常见坑：abstractions/base 中包含了 /proc/sysrq-trigger 的读权限
# 但你又想 deny /proc/** w，两者可能产生意外交互
# 解决方案：在 include 之后再写 deny，确保 deny 生效
#include <abstractions/base>
deny /proc/** w,    # 这条 deny 会覆盖 abstractions 中对 /proc 的任何写权限
```

---

## 三、SELinux：基于安全标签的强制访问控制

### 3.1 SELinux 核心概念与架构

SELinux（Security-Enhanced Linux）最初由美国国家安全局（NSA）开发，是 Red Hat、CentOS、Fedora 和 Rocky Linux 等发行版默认启用的强制访问控制系统。与 AppArmor 的路径匹配机制不同，SELinux 采用安全上下文（Security Context）标签机制来控制访问。系统中的每个进程、文件、端口、套接字等资源都被分配了一个安全标签，SELinux 策略引擎根据主体（进程）和客体（资源）的标签来决定是否允许访问。

安全上下文的格式为 `user:role:type:level`，其中 type（类型）是最常用的匹配维度。例如，Web 服务器进程的类型通常是 `httpd_t`，Web 内容文件的类型是 `httpd_sys_content_t`。通过定义 `allow httpd_t httpd_sys_content_t:file { read open getattr };` 这样的策略规则，就可以精确控制 Web 服务器进程对 Web 内容的访问权限。

```bash
# 查看文件的安全上下文标签
ls -Z /var/www/html/
# 输出: system_u:object_r:httpd_sys_content_t:s0 index.html

# 查看进程的安全上下文标签
ps auxZ | grep nginx
# 输出: system_u:system_r:httpd_t:s0    nginx ...
```

SELinux 的策略体系分为三个层次：**目标策略（targeted）** 是默认策略，只对特定的守护进程实施 MAC 控制，不影响普通用户进程；**最小策略（minimum）** 是 targeted 的精简版本；**多级安全策略（MLS）** 实施最严格的多级安全模型，通常用于军事和政府场景。对于大多数企业环境，targeted 策略已经能够提供足够的安全保障。

### 3.2 SELinux 模式管理

SELinux 有三种运行模式，理解它们的区别对于安全管理至关重要：

**Enforcing（强制模式）**：SELinux 正常工作，所有违反策略的操作都会被阻止并记录。这是生产环境必须使用的模式。

**Permissive（宽容模式）**：违反策略的操作不会被阻止，但会被记录到审计日志中。这个模式主要用于策略调试和问题排查，绝对不能在生产环境中长期使用。

**Disabled（禁用模式）**：SELinux 完全不工作。需要注意的是，从 Disabled 切换到 Enforcing 之前需要重新标记整个文件系统的安全属性，这可能是一个耗时的操作。

```bash
# 查看当前 SELinux 模式
getenforce
# 输出: Enforcing

# 查看详细的 SELinux 状态信息
sestatus
# 输出包含：当前模式、配置文件中的模式、策略类型等

# 临时切换到 Permissive 模式（仅用于调试，重启后恢复）
sudo setenforce 0

# 切换回 Enforcing 模式
sudo setenforce 1

# 永久修改 SELinux 配置（需要重启生效）
sudo vi /etc/selinux/config
# 设置 SELINUX=enforcing 和 SELINUMLS=targeted
```

### 3.3 SELinux 布尔值：无需修改策略的快速开关

SELinux 布尔值（Booleans）是一种非常实用的机制，它允许运维人员在不修改策略源代码的情况下动态调整 SELinux 的行为。每个布尔值都是一个开关，控制着策略中的某个特定方面。这种方式既安全又灵活，因为布尔值的变化范围已经被策略开发者预先定义和审查过了。

```bash
# 列出系统中所有与 httpd 相关的布尔值
getsebool -a | grep httpd

# 最常用的 httpd 相关布尔值：
# httpd_can_network_connect     --> 允许 httpd 发起对外的 TCP 连接
# httpd_can_network_connect_db  --> 允许 httpd 连接数据库
# httpd_read_user_content       --> 允许 httpd 读取用户主目录内容
# httpd_enable_homedirs         --> 允许 httpd 访问用户主目录

# 临时设置布尔值（重启后失效，适合测试）
sudo setsebool httpd_can_network_connect on

# 永久设置布尔值（-P 参数将变更写入策略存储）
sudo setsebool -P httpd_can_network_connect on
sudo setsebool -P httpd_can_network_connect_db on

# 容器环境相关的布尔值
sudo setsebool -P container_manage_cgroup on
sudo setsebool -P container_connect_any on

# 列出所有容器相关的布尔值
getsebool -a | grep container
```

布尔值在容器环境中的应用尤为重要。例如，当你的 PHP 容器需要连接数据库时，如果没有正确设置 `container_connect_any` 布尔值，SELinux 会阻止容器内的进程建立网络连接，导致应用无法正常工作。这类问题在初次部署容器化应用时非常常见，了解布尔值机制可以快速定位和解决问题。

### 3.4 自定义 SELinux 策略模块开发

当预置的 SELinux 策略无法满足特定应用的需求时，我们可以开发自定义策略模块。SELinux 策略模块的开发通常遵循一个"审计驱动"的工作流程：首先在 Enforcing 模式下运行应用，收集被拒绝的访问事件，然后使用工具自动生成策略模块，最后审查和调整生成的策略。

```bash
# 从审计日志中提取被拒绝的事件，自动生成策略模块
sudo ausearch -m avc -ts recent | audit2allow -M my_custom_policy

# 查看生成的策略模块源代码
cat my_custom_policy.te
# 里面包含了所有被拒绝操作的允许规则

# 重要：审查生成的规则，删除过于宽松的规则
# 只保留确实需要的最小权限

# 编译并安装策略模块
sudo semodule -i my_custom_policy.pp
```

对于需要从头编写策略的场景，下面是一个完整的自定义策略模块示例：

```bash
# 自定义策略模块 - 容器 Web 应用
cat > container_web_app.te << 'EOF'
module container_web_app 1.0;

require {
    type container_t;
    type container_file_t;
    type http_port_t;
    class tcp_socket { name_connect };
    class file { read open getattr execute };
    class dir { search getattr };
}

# 容义新的文件类型标签
type container_web_content_t;
files_type(container_web_content_t)

# 允许容器进程读取 Web 内容
allow container_t container_web_content_t:file { read open getattr };
allow container_t container_web_content_t:dir { search getattr };

# 允许容器连接 HTTP 端口
allow container_t http_port_t:tcp_socket name_connect;

# 禁止容器进程执行二进制文件（除非明确需要）
neverallow container_t container_file_t:file execute;
EOF

# 编译策略模块
checkmodule -M -m -o container_web_app.mod container_web_app.te
semodule_package -o container_web_app.pp -m container_web_app.mod

# 安装策略模块
sudo semodule -i container_web_app.pp
```

### 3.5 Docker 和 Kubernetes 中的 SELinux 标签配置

Docker 和 Kubernetes 都支持通过 SELinux 标签来控制容器的安全上下文。在 Docker 中，可以通过 `--security-opt label=` 参数为容器指定安全标签。在 Kubernetes 中，则通过 Pod 的 `securityContext.seLinuxOptions` 字段来配置。

```bash
# Docker 中为容器指定 SELinux 类型标签
docker run -d \
  --security-opt label=type:container_web_t \
  --name web \
  nginx:alpine

# 为容器指定 SELinux 安全级别（多类别安全 MCS）
# 不同级别的容器之间互相隔离
docker run -d \
  --security-opt label=level:s0:c100,c200 \
  --name web-s1 \
  nginx:alpine

docker run -d \
  --security-opt label=level:s0:c300,c400 \
  --name web-s2 \
  nginx:alpine

# 调试时临时禁用 SELinux 标签（仅用于排查问题）
docker run -d \
  --security-opt label=disable \
  nginx:alpine
```

在 Kubernetes 中配置 SELinux：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
  namespace: production
spec:
  securityContext:
    seLinuxOptions:
      level: "s0:c123,c456"
      type: "container_t"
      user: "system_u"
      role: "system_r"
  containers:
  - name: app
    image: nginx:alpine
```

### 3.6 SELinux 故障排除实战

SELinux 最让人头疼的问题就是"明明有权限却访问不了"，这通常是因为 SELinux 的标签不正确或策略不允许。掌握正确的故障排除方法至关重要。

```bash
# 查看今天的 AVC（Access Vector Cache）拒绝事件
sudo ausearch -m avc -ts today

# 使用 sealert 获取人类可读的详细分析和修复建议
sudo sealert -a /var/log/audit/audit.log

# sealert 的典型输出包含：
# 1. 被拒绝操作的详细描述
# 2. 涉及的源和目标安全上下文
# 3. 具体的修复建议（通常是 semanage 或 setsebool 命令）

# 修复文件标签问题（最常见的情况）
# 当文件被移动到新位置后，标签可能不正确
sudo semanage fcontext -a -t httpd_sys_content_t "/web(/.*)?"
sudo restorecon -Rv /web

# 修复端口标签问题
# 如果服务需要监听非标准端口
sudo semanage port -a -t http_port_t -p tcp 8080
sudo semanage port -l | grep http_port_t

# 查看策略建议
sudo ausearch -m avc | audit2allow -w
```

### 3.7 SELinux 踩坑案例与调试实战

**案例一：布尔值遗漏导致数据库连接失败（最常见！）**

这是新手遇到最多的问题：PHP/Java 应用容器明明网络配置正确，却死活连不上数据库。排查半天发现是 SELinux 的 `httpd_can_network_connect_db` 布尔值没有开启。

```bash
# 症状：应用日志显示 "Connection refused" 或 "Permission denied"
# 但 telnet 数据库端口是通的！
telnet mysql-host 3306  # 连接成功
curl http://app/login   # 应用报错 "SQLSTATE[HY000] [2002] Permission denied"

# 排查步骤：
# 1. 检查 SELinux 是否在阻止
sudo ausearch -m avc -ts recent | grep mysql
# 输出: avc: denied { name_connect } for pid=1234 comm="php-fpm"
#        scontext=system_u:system_r:httpd_t:s0
#        tcontext=system_u:object_r:mysqld_port_t:s0

# 2. 修复：开启 httpd 数据库连接布尔值
sudo setsebool -P httpd_can_network_connect_db on

# 3. 容器环境需要使用 container 前缀的布尔值
sudo setsebool -P container_connect_any on
```

**案例二：文件移动后标签丢失导致 403 Forbidden**

当你使用 `mv` 或 `cp` 命令移动 Web 内容文件时，文件的 SELinux 标签不会随文件一起移动到新路径的正确标签。这是导致 "403 Forbidden" 的经典原因——文件权限（chmod）完全正确，但 SELinux 标签不对。

```bash
# 症状：文件权限 755，Nginx 用户可以读取，但返回 403
ls -la /webapp/index.html    # -rw-r--r-- nginx nginx → 权限正确
curl http://localhost/        # 403 Forbidden

# 排查：
ls -Z /webapp/index.html
# 输出: unconfined_u:object_r:default_t:s0  ← 标签错误！
# 正确标签应该是: system_u:object_r:httpd_sys_content_t:s0

# 修复方案一：重新标记目录
sudo semanage fcontext -a -t httpd_sys_content_t "/webapp(/.*)?"
sudo restorecon -Rv /webapp

# 修复方案二：使用 cp -a 代替 mv（保留上下文）
sudo cp -a --preserve=context /source/index.html /webapp/

# 预防措施：始终使用 restorecon 检查部署后的标签
# 在 CI/CD 中加入标签验证步骤
sudo restorecon -Rv /var/www/ && echo "Labels restored"
```

**案例三：自定义端口未注册导致服务无法绑定**

当你让 Nginx/Apache 监听非标准端口（如 8443、9090）时，SELinux 不知道这些端口属于 HTTP 服务，会阻止绑定操作。

```bash
# 症状：Nginx 配置了 listen 8443，启动失败
nginx -t  # 配置语法正确
systemctl start nginx  # Job for nginx failed
journalctl -u nginx | grep -i "permission denied"
# 输出: bind() to 0.0.0.0:8443 failed (13: Permission denied)

# 排查：
sudo semanage port -l | grep http_port_t
# 只有 80, 443, 488, 8008, 8009, 8443(可能没有), 9000

# 修复：将端口注册到 SELinux
sudo semanage port -a -t http_port_t -p tcp 8443
# 如果端口已被其他类型占用，用 -m 修改
sudo semanage port -m -t http_port_t -p tcp 8443

# 验证：
sudo semanage port -l | grep 8443
# http_port_t   tcp   8443, 80, 443, ...
```

---

## 四、seccomp：系统调用级别的安全过滤

### 4.1 seccomp 的工作原理

seccomp（Secure Computing Mode）是 Linux 内核提供的一种系统调用过滤机制，它是容器安全中最为精细的防护层。要理解 seccomp 的价值，首先需要了解系统调用的概念。用户空间的程序（包括容器内的应用）不能直接访问硬件或内核数据结构，它们必须通过系统调用（syscall）这个唯一的"门"来请求内核提供服务。Linux 内核定义了超过 300 个系统调用，而一个典型的 Web 应用实际只需要使用其中的 50 到 100 个。seccomp 允许我们为进程定义一个白名单或黑名单，精确控制哪些系统调用被允许、哪些被拒绝。

这种过滤机制的安全意义在于：即使攻击者在容器内获得了代码执行能力，如果他需要使用的系统调用（比如 `mount` 用于挂载文件系统、`ptrace` 用于进程注入、`reboot` 用于重启系统）被 seccomp 策略阻止，攻击就无法成功。seccomp 是在内核层面实施的，容器内的进程无法绕过它。

seccomp 有三种运行模式：

| 模式 | 内核常量 | 说明 |
|------|---------|------|
| SECCOMP_MODE_DISABLED | 0 | 完全禁用 seccomp，不做任何过滤 |
| SECCOMP_MODE_STRICT | 1 | 严格模式，只允许 read/write/exit/sigreturn 四个系统调用 |
| SECCOMP_MODE_FILTER | 2 | 过滤模式，使用 BPF 程序定义自定义过滤规则（Docker 使用此模式） |

### 4.2 Docker 默认 seccomp Profile 分析

Docker 在默认情况下会为每个容器加载一个 seccomp profile，这个 profile 阻止了约 44 个被内核社区认为对容器环境有潜在危险的系统调用。这些被阻止的系统调用主要包括：`mount`/`umount`（文件系统挂载）、`reboot`（系统重启）、`ptrace`（进程追踪和注入）、`keyctl`（内核密钥管理）、`setns`（切换命名空间）、`personality`（修改进程执行域）、以及各种内核模块相关的调用。

Docker 默认 seccomp profile 阻止的关键系统调用包括：`clock_settime`（修改系统时钟）、`delete_module`/`finit_module`/`init_module`（内核模块操作）、`ioperm`/`iopl`（I/O 端口访问）、`kcmp`（进程资源比较）、`lookup_dcookie`（目录项缓存查找）、`mount`/`umount`/`umount2`（文件系统挂载操作）、`name_to_handle_at`/`open_by_handle_at`（文件句柄操作）、`perf_event_open`（性能事件）、`personality`（进程执行域）、`pivot_root`（根文件系统切换）、`process_vm_readv`/`process_vm_writev`（跨进程内存读写）、`ptrace`（进程追踪）、`reboot`（系统重启）、`request_key`（密钥请求）、`setns`（命名空间切换）、`swapoff`/`swapon`（交换空间管理）、`sysctl`（内核参数修改）和 `unshare`（创建新命名空间）。

```bash
# 查看容器的 seccomp 状态
docker run --rm alpine grep Seccomp /proc/self/status
# 输出: Seccomp:    2    (SECCOMP_MODE_FILTER，表示使用过滤模式)

# 查看容器的 seccomp 配置详情
docker inspect --format='{{json .HostConfig.SecurityOpt}}' container_name
```

### 4.3 自定义 seccomp Profile 实战

对于高安全需求的场景，我们应该根据应用的实际行为编写专用的 seccomp 白名单 profile。编写思路是：首先追踪应用实际使用的系统调用，然后只允许这些调用，拒绝其他所有调用。这种方式比黑名单更安全，因为它遵循"默认拒绝"的原则。

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_AARCH64"
  ],
  "syscalls": [
    {
      "names": [
        "accept", "accept4", "access", "arch_prctl", "bind",
        "brk", "clock_getres", "clock_gettime", "clone", "close",
        "connect", "dup", "dup2", "dup3", "epoll_create",
        "epoll_create1", "epoll_ctl", "epoll_wait", "execve",
        "exit", "exit_group", "faccessat", "fadvise64",
        "fallocate", "fchdir", "fchmod", "fchown", "fcntl",
        "fdatasync", "flock", "fork", "fstat", "fstatfs",
        "fsync", "ftruncate", "futex", "getcwd", "getdents",
        "getdents64", "getegid", "geteuid", "getgid", "getpid",
        "getppid", "getrandom", "getsockname", "getsockopt",
        "gettid", "gettimeofday", "getuid", "ioctl", "listen",
        "lseek", "madvise", "memfd_create", "mmap", "mprotect",
        "munmap", "nanosleep", "newfstatat", "open", "openat",
        "pipe", "pipe2", "poll", "prctl", "pread64", "prlimit64",
        "pwrite64", "read", "readv", "recvfrom", "recvmsg",
        "rename", "renameat", "rt_sigaction", "rt_sigprocmask",
        "rt_sigreturn", "sched_getaffinity", "sched_yield",
        "select", "sendfile", "sendmsg", "sendto", "set_robust_list",
        "set_tid_address", "setsockopt", "shutdown", "sigaltstack",
        "socket", "stat", "statfs", "statx", "tgkill",
        "time", "tkill", "umask", "uname", "unlink", "unlinkat",
        "utimensat", "wait4", "waitid", "write", "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ],
  "seccompFilterSkip": ["containerd-shim", "runc"]
}
```

这个白名单 profile 的设计思路是只允许 Nginx、PHP-FPM 等 Web 应用正常运行所必需的系统调用。注意它不允许 `mount`、`umount`、`ptrace`、`keyctl`、`setns`、`unshare` 等高危调用，即使攻击者在容器内获得了代码执行能力，也无法利用这些调用来实现容器逃逸或提权。

使用自定义 seccomp profile 启动容器：

```bash
# 指定自定义 seccomp profile
docker run -d \
  --security-opt seccomp=/path/to/custom-seccomp.json \
  --name app-secure \
  nginx:alpine

# 调试时禁用 seccomp（绝对不要在生产环境使用）
docker run -d \
  --security-opt seccomp=unconfined \
  nginx:alpine
```

### 4.4 使用 strace 发现应用实际使用的系统调用

编写精确的 seccomp 白名单，关键在于准确了解应用到底使用了哪些系统调用。`strace` 是最经典的系统调用追踪工具，它可以在应用运行时记录所有的 syscall 调用。

```bash
# 追踪正在运行的 Nginx 进程的所有系统调用
sudo strace -f -c -p $(pgrep nginx) 2>&1 | tail -50
# -f: 跟踪子进程
# -c: 统计每个 syscall 的调用次数和耗时
# -p: 指定目标进程 PID

# 在容器启动时追踪
docker run --rm --security-opt seccomp=unconfined \
  strace -f -c nginx 2>&1 | grep -E "^%" | sort -t= -k2 -rn
# 输出按调用次数排序，可以看到 Nginx 实际使用的系统调用列表

# 使用基于 eBPF 的现代方案 - oci-seccomp-bpf-hook
# 这种方式不需要修改容器镜像，直接在宿主机上通过 eBPF 追踪
# 项目地址: https://github.com/containers/oci-seccomp-bpf-hook
```

### 4.5 seccomp 踩坑案例与调试实战

**案例一：白名单遗漏导致应用莫名崩溃**

这是 seccomp 白名单模式最常遇到的问题——应用在开发环境正常运行，部署到生产环境后莫名崩溃或功能异常，且没有任何有意义的错误信息。原因是白名单中遗漏了应用实际需要的系统调用。

```bash
# 症状：容器启动后立即退出，日志中只有 "Killed" 或 "Operation not permitted"
docker logs my-app
# 输出: standard_init_linux.go:228: exec user process caused: operation not permitted

# 排查步骤一：临时禁用 seccomp 确认是否是 seccomp 导致
docker run --security-opt seccomp=unconfined my-app
# 如果正常运行，说明确实是 seccomp 问题

# 排查步骤二：使用 strace 追踪实际使用的 syscall
docker run --rm --security-opt seccomp=unconfined \
  --entrypoint strace my-app -f -c 2>&1 | tail -30
# 记录输出中所有调用次数 > 0 的 syscall

# 排查步骤三：使用 oci-seccomp-bpf-hook 自动收集
# 先以 unconfined 模式运行，通过 eBPF 记录所有 syscall
# 工具会自动生成精确的白名单 profile

# 常见遗漏的 syscall：
# - statx（新版 glibc 使用，替代 stat/fstat）
# - clone3（内核 ≥ 5.3，替代 clone）
# - openat2（内核 ≥ 5.6，某些 Go 程序使用）
# - epoll_pwait2（内核 ≥ 5.11）
```

**案例二：architectures 字段未配置导致多架构部署失败**

当你的集群同时包含 x86_64 和 ARM64 节点时，如果 seccomp profile 的 `architectures` 字段只配置了一种架构，另一种架构上的容器会启动失败。

```bash
# ❌ 错误写法：只配置了 x86_64
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"]  // ARM64 节点上会失败！
}

# ✅ 正确写法：支持多架构
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_AARCH64"   // ARM64
  ]
}
```

**案例三：errnoRet 返回值不明确导致调试困难**

当 seccomp 阻止一个系统调用时，默认返回 `EPERM`（Permission denied），但有些应用会根据不同的 errno 做不同的错误处理。如果返回值设置不当，应用可能进入死循环或产生误导性的错误信息。

```bash
# 推荐：使用 EPERM (1) 作为默认拒绝返回值
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1   # EPERM - 明确的"权限不足"
}

# 调试技巧：使用 SCMP_ACT_LOG 模式记录但不阻止
{
  "defaultAction": "SCMP_ACT_LOG"   # 记录到 dmesg 但允许执行
}
# 然后查看内核日志：
dmesg | grep "seccomp"
# 输出: audit: type=1326 audit(1234567890.123:456): auid=1000 uid=1000
#        comm="nginx" exe="/usr/sbin/nginx" sig=0 arch=c000003e
#        syscall=165 compat=0 ip=0x7f1234567890 code=0x7ffc0000
# syscall=165 就是被阻止的系统调用编号
```

---

## 五、Linux Capabilities：细粒度特权控制

### 5.1 理解 Linux Capabilities 的设计初衷

传统的 Unix 权限模型非常简单粗暴：root 用户拥有一切权限，普通用户则处处受限。这种"全有或全无"的设计在安全上存在严重问题——很多系统管理操作确实需要特权（比如绑定 80 端口、修改系统时间），但为了完成这些操作而授予完整的 root 权限，就好像为了开门而把整串钥匙都交出去一样。

Linux Capabilities 机制正是为了解决这个问题而设计的。它将传统 root 用户的"全能"特权拆分为数十项独立的能力位，每项能力控制一个特定的特权操作。进程只需要获得完成其任务所必需的那些能力即可，不需要完整的 root 权限。这种"按需授予"的方式大大降低了特权滥用的风险。

以下是容器环境中最常见和最关键的 Linux Capabilities：

| Capability | 作用说明 | 风险评估 |
|-----------|---------|---------|
| `CAP_SYS_ADMIN` | 涵盖几乎所有特权操作，包括挂载文件系统、命名空间管理等 | 极高——应尽可能避免授予 |
| `CAP_NET_ADMIN` | 配置网络接口、路由表、防火墙规则等 | 高 |
| `CAP_NET_BIND_SERVICE` | 绑定 1024 以下的特权端口 | 中——Web 服务器常用 |
| `CAP_SYS_PTRACE` | 追踪和调试其他进程，可读取进程内存 | 高——可被用于窃取敏感数据 |
| `CAP_SYS_MODULE` | 加载和卸载内核模块 | 极高——可直接修改内核 |
| `CAP_SYS_RAWIO` | 直接访问 I/O 端口和物理内存 | 极高 |
| `CAP_DAC_OVERRIDE` | 绕过文件的所有权和权限检查 | 高 |
| `CAP_FOWNER` | 绕过文件所有者的权限限制 | 高 |
| `CAP_SETUID` / `CAP_SETGID` | 在运行时切换进程的 UID/GID | 中——可被用于提权 |
| `CAP_CHOWN` | 修改文件的所有者和组 | 中 |
| `CAP_MKNOD` | 创建设备文件 | 中——可用于访问宿主机设备 |
| `CAP_AUDIT_WRITE` | 向内核审计系统写入记录 | 低 |

### 5.2 Docker 容器的默认 Capabilities 分析

Docker 默认不会给容器完整的 root 权限，而是只授予约 14 个 Capabilities。这个默认集经过精心选择，涵盖了大多数应用的基本需求，同时排除了最危险的能力。但这并不意味着默认配置就是安全的——在高安全场景下，我们应该丢弃所有 Capabilities，然后按需添加应用真正需要的那几个。

```bash
# 查看容器内进程的 Capabilities
docker run --rm alpine cat /proc/1/status | grep -i cap

# 使用 capsh 工具解码 Capabilities 位图
capsh --decode=00000000a80425fb
# 输出: cap_chown,cap_dac_override,cap_fowner,cap_fsetid,
# cap_kill,cap_setgid,cap_setuid,cap_setpcap,
# cap_net_bind_service,cap_net_raw,cap_sys_chroot,
# cap_mknod,cap_audit_write,cap_setfcap
```

Docker 默认授予容器的 14 个 Capabilities 包括：`CHOWN`（修改文件所有者）、`DAC_OVERRIDE`（绕过文件权限检查）、`FOWNER`（绕过文件所有者限制）、`FSETID`（设置 setuid/setgid 位）、`KILL`（发送信号给其他进程）、`SETGID`/`SETUID`（切换 GID/UID）、`SETPCAP`（修改进程 Capabilities）、`NET_BIND_SERVICE`（绑定特权端口）、`NET_RAW`（使用原始套接字）、`SYS_CHROOT`（使用 chroot）、`MKNOD`（创建设备文件）、`AUDIT_WRITE`（写入审计日志）和 `SETFCAP`（设置文件 Capabilities）。

### 5.3 精细控制容器 Capabilities

在生产环境中，最佳实践是丢弃所有 Capabilities，然后只添加应用真正需要的能力。例如，一个只需要监听 80 端口的 Nginx 容器，实际上只需要 `NET_BIND_SERVICE` 这一个 Capability。如果容器不以 root 用户运行（推荐做法），甚至可能不需要任何 Capability。

```bash
# 丢弃所有 Capabilities，只添加应用必需的
docker run -d \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  --name app-minimal \
  nginx:alpine

# 对于以非 root 用户运行的只读应用
docker run -d \
  --cap-drop=ALL \
  --read-only \
  --tmpfs /tmp:size=64M,noexec,nosuid,nodev \
  --user=1000:1000 \
  --name app-hardened \
  nginx:alpine

# 验证 Capabilities 已被正确限制
docker exec app-minimal cat /proc/1/status | grep -i cap
```

在 Kubernetes 中，通过 Pod 的 SecurityContext 来配置 Capabilities：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
spec:
  containers:
  - name: app
    image: nginx:alpine
    securityContext:
      capabilities:
        drop:
          - ALL          # 丢弃所有 Capabilities
        add:
          - NET_BIND_SERVICE  # 只添加绑端口的能力
      allowPrivilegeEscalation: false  # 禁止权限提升
      readOnlyRootFilesystem: true     # 只读根文件系统
      runAsNonRoot: true               # 必须以非 root 运行
      runAsUser: 1000
      runAsGroup: 1000
```

---

## 六、Namespaces 与 Cgroups：容器隔离的内核基石

### 6.1 Linux Namespaces 深入理解

容器的"隔离"并不是一个全新的技术概念，它本质上是 Linux 内核 Namespaces 机制的应用。Namespace 为进程创建了一个独立的"视图"，使得进程在自己的命名空间中"以为"自己拥有独立的系统资源。目前 Linux 内核支持八种命名空间（cgroup 命名空间在 Linux 4.6 引入），每种命名空间负责隔离一类系统资源：

**PID 命名空间**隔离了进程 ID 空间，使得容器内的进程只能看到同一命名空间内的其他进程，容器内的 PID 从 1 开始。**Network 命名空间**隔离了网络协议栈，每个命名空间拥有独立的网络接口、路由表、防火墙规则和端口空间。**Mount 命名空间**隔离了文件系统挂载点，容器看不到宿主机和其他容器的挂载。**UTS 命名空间**隔离了主机名和域名。**IPC 命名空间**隔离了进程间通信资源（消息队列、信号量、共享内存）。**User 命名空间**隔离了用户和组 ID，是安全隔离中最关键的一环。**Cgroup 命名空间**隔离了 cgroup 文件系统视图。

```bash
# 查看某个进程所属的所有命名空间
ls -la /proc/$$/ns/
# 每个符号链接指向一个命名空间实例

# 使用 nsenter 进入容器的命名空间（故障排查利器）
PID=$(docker inspect --format='{{.State.Pid}}' container_name)
sudo nsenter --target $PID --mount --uts --ipc --net --pid -- bash

# 使用 unshare 创建全新的命名空间
sudo unshare --mount --uts --ipc --net --pid --fork /bin/bash
```

**用户命名空间**（User Namespace）是最重要的安全增强机制之一。它实现了容器内 UID/UID 与宿主机 UID/GID 的映射，使得容器内的 root（UID 0）在宿主机上实际上是一个没有特权的普通用户。这意味着即使攻击者突破了容器并在容器内获得了 root 权限，在宿主机的视角来看他只是一个无权限的普通用户，无法对宿主机造成实质性损害。

```bash
# 在 Docker 中启用用户命名空间重映射
# 编辑 /etc/docker/daemon.json
{
  "userns-remap": "default"
}

# 验证用户命名空间映射是否生效
docker run --rm alpine id
# 容器内显示 root (uid 0)

# 但在宿主机上查看，实际是高 UID
cat /proc/$(docker inspect --format='{{.State.Pid}}' container_name)/uid_map
#          0     100000      65536
# 含义：容器内的 UID 0 映射到宿主机的 UID 100000，范围 65536 个 ID
```

### 6.2 Cgroups 资源限制与安全

Cgroups（Control Groups）不仅用于资源管理，也是安全防护的重要一环。合理的资源限制可以防止容器内的恶意进程耗尽宿主机资源（如 fork 炸弹、内存泄漏攻击）。Cgroups v2 提供了更精细和统一的资源控制接口。

```bash
# Docker 容器资源限制
docker run -d \
  --memory=512m \
  --memory-swap=512m \
  --cpus=1.5 \
  --pids-limit=100 \
  --ulimit nofile=1024:2048 \
  --ulimit nproc=512 \
  --name limited \
  nginx:alpine

# pids-limit 防止 fork 炸弹攻击
# memory-swap 等于 memory 表示不使用交换空间（推荐）
# ulimit nofile 限制打开文件数量
# ulimit nproc 限制进程数量
```

在 Kubernetes 中，资源限制通过 resources 字段配置，并且可以设置 LimitRange 和 ResourceQuota 来强制整个命名空间的资源约束：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: resource-limited
spec:
  containers:
  - name: app
    image: nginx:alpine
    resources:
      requests:
        cpu: "250m"       # 请求 0.25 个 CPU 核心
        memory: "128Mi"   # 请求 128MB 内存
      limits:
        cpu: "500m"       # 最多使用 0.5 个 CPU 核心
        memory: "256Mi"   # 最多使用 256MB 内存
```

---

## 七、容器逃逸技术与真实 CVE 深度分析

### 7.1 CVE-2019-5736：runc 容器逃逸漏洞

CVE-2019-5736 是容器安全史上最著名的漏洞之一，它影响了几乎所有使用 runc 的容器运行时（包括 Docker、Kubernetes 等）。这个漏洞的严重性在于，它允许恶意容器在 `docker exec` 操作时覆盖宿主机上的 runc 二进制文件，从而获得宿主机的完全控制权。

攻击过程的技术细节如下：当管理员执行 `docker exec` 进入一个恶意容器时，容器内的恶意进程会打开 `/proc/self/exe` 文件描述符，该文件描述符指向宿主机上的 runc 二进制文件。通过精心构造的竞争条件和 `/proc/self/fd/` 的符号链接特性，攻击者可以绕过 Linux 内核的文件描述符检查，获得对宿主机 runc 二进制文件的写入权限。随后，攻击者将 runc 替换为恶意代码。当管理员或其他自动化工具下次执行 `docker exec` 或启动新容器时，就会执行被篡改的 runc，从而让攻击者获得宿主机的 root 权限。

防护措施包括多个层面：

```bash
# 1. 升级 runc 到安全版本（>= 1.0-rc6）
runc --version

# 2. 使用不可变的文件系统保护 runc 二进制
sudo chattr +i /usr/bin/runc  # 设置不可变属性

# 3. 使用 AppArmor 或 SELinux 限制容器对 /proc 的访问
# AppArmor profile 中添加：deny /proc/self/exe rw,

# 4. 确保 Docker 版本 >= 18.09.2
docker version

# 5. 使用用户命名空间重映射
# 即使容器逃逸，攻击者也只是宿主机上的无权限用户
```

### 7.2 CVE-2020-15257：containerd 缺陷

CVE-2020-15257 揭示了 containerd 在处理宿主机网络模式容器时的一个严重缺陷。当容器使用 `--net=host`（宿主机网络模式）运行时，容器内的进程可以直接访问宿主机的网络命名空间，其中包括 containerd 的 gRPC Unix 域套接字。攻击者可以通过这个套接字直接与 containerd 守护进程通信，绕过 Docker 的 API 和所有基于 Docker API 的安全控制，直接调用 containerd 的底层 API 创建新的特权容器或执行其他恶意操作。

```bash
# 查看 containerd socket 是否暴露在容器内
docker run --net=host --rm alpine ls -la /run/containerd/containerd.sock
# 如果能看到这个文件，说明容器可以控制 containerd

# 防护措施：
# 1. 升级 containerd 到安全版本（>= 1.4.3）
containerd --version

# 2. 避免使用宿主机网络模式，改用端口映射
docker run -d -p 8080:80 nginx   # 推荐
docker run -d --net=host nginx   # 危险！

# 3. 使用 AppArmor 限制对 containerd socket 的访问
# 在 profile 中添加：deny /run/containerd/** rw,
```

### 7.3 其他常见的容器逃逸手法

**Docker Socket 挂载逃逸**是最常见也最危险的配置错误之一。有些运维团队为了方便在容器内管理 Docker（比如 CI/CD 流水线中的构建容器），将宿主机的 Docker socket 挂载到容器内。这相当于将 Docker daemon 的完全控制权交给了容器内的所有进程，攻击者可以轻易地通过创建特权新容器来逃逸。

```bash
# 危险操作：将 Docker socket 挂载到容器内
docker run -v /var/run/docker.sock:/var/run/docker.sock -it alpine

# 攻击者可以在容器内这样实现逃逸：
# 安装 Docker CLI
apk add docker-cli
# 创建一个挂载宿主机根目录的新容器
docker run -v /:/host --privileged -it alpine chroot /host
# 现在攻击者拥有宿主机的完整 root 权限
```

**特权容器逃逸**同样简单直接。`--privileged` 参数赋予容器完整的宿主机设备访问权限和几乎所有的 Linux Capabilities，本质上就是消除了容器与宿主机之间的所有安全边界。

**内核漏洞导致的容器逃逸**（如 Dirty COW CVE-2016-5195）利用的是 Linux 内核本身的漏洞，这类漏洞的防护主要依赖于及时更新内核版本，以及使用 seccomp 限制关键系统调用的访问。

---

## 八、Docker 安全加固全面配置指南

### 8.1 Docker Daemon 守护进程安全配置

Docker daemon 的安全配置是容器安全的起点。daemon.json 配置文件中的选项会影响所有通过该 daemon 运行的容器，因此正确的 daemon 配置可以"默认安全"地保护所有容器。

```json
{
  "icc": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "no-new-privileges": true,
  "userland-proxy": false,
  "live-restore": true,
  "userns-remap": "default",
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    },
    "nproc": {
      "Name": "nproc",
      "Hard": 4096,
      "Soft": 4096
    }
  },
  "storage-driver": "overlay2"
}
```

这些配置项的安全含义：`icc: false` 禁止同一宿主机上的容器之间直接通信，容器之间必须通过显式的 Docker 网络连接才能通信，这有效防止了横向移动攻击。`no-new-privileges: true` 是一个非常重要的安全选项，它阻止进程通过 setuid 或 setgid 二进制文件获得新的权限，防止容器内的提权攻击。`userns-remap: "default"` 启用用户命名空间重映射，使得容器内的 root 在宿主机上映射为无权限的普通用户。`live-restore: true` 确保 Docker daemon 重启时不会中断正在运行的容器。

### 8.2 容器运行时安全选项最佳实践

将前面讨论的所有安全机制组合在一起，形成一个全面加固的容器启动命令：

```bash
docker run -d \
  --name secure-app \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=/etc/docker/seccomp-custom.json \
  --security-opt apparmor=docker-custom \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  --read-only \
  --tmpfs /tmp:size=128M,noexec,nosuid,nodev \
  --memory=512m \
  --cpus=1.0 \
  --pids-limit=100 \
  --network=app-network \
  --health-cmd="curl -f http://localhost/health || exit 1" \
  --health-interval=30s \
  --health-timeout=10s \
  --health-retries=3 \
  --restart=unless-stopped \
  --user=1000:1000 \
  nginx:alpine
```

这个命令同时应用了：自定义 seccomp profile 限制系统调用、AppArmor profile 控制文件和网络访问、丢弃所有非必需的 Capabilities、只读文件系统防止篡改、资源限制防止资源耗尽、健康检查确服务可用性。

### 8.3 Docker 镜像安全最佳实践

镜像是容器安全的第一道防线。一个安全的镜像应该：使用最小化基础镜像减少攻击面、通过多阶段构建分离构建环境和运行环境、以非 root 用户运行、移除不必要的工具和库。

```dockerfile
# 使用多阶段构建，最终镜像只包含运行时必需的文件
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine
# 创建非 root 用户
RUN addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser

WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules

# 使用 tini 作为 PID 1 进程，正确处理信号和僵尸进程
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# 切换到非 root 用户
USER appuser
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

```bash
# 使用扫描工具检查镜像漏洞
docker scout cves nginx:alpine
trivy image --severity HIGH,CRITICAL nginx:alpine

# 启用 Docker Content Trust 验证镜像签名
export DOCKER_CONTENT_TRUST=1
```

---

## 九、Kubernetes 安全策略全面落地

### 9.1 PodSecurityAdmission 替代废弃的 PSP

Kubernetes 1.25 正式移除了 PodSecurityPolicy（PSP），取而代之的是内置的 PodSecurityAdmission（PSA）准入控制器。PSA 通过命名空间标签来实施安全策略，配置更简单、行为更可预测。

PSA 定义了三个安全级别：

**Privileged（特权级）**：没有限制，适用于系统级组件。**Baseline（基线级）**：禁止明显的权限提升操作，如特权容器、hostPID、hostNetwork 等，适用于大多数应用。**Restricted（受限级）**：严格执行最小权限原则，要求 non-root 运行、drop ALL capabilities、只读根文件系统、使用 RuntimeDefault seccomp profile 等，适用于高安全需求的应用。

```yaml
# 为生产命名空间设置 restricted 安全级别
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

### 9.2 SecurityContext 完整配置指南

SecurityContext 是 Kubernetes 中控制 Pod 和容器安全属性的核心机制。合理配置 SecurityContext 可以将前面讨论的所有安全机制（Capabilities、seccomp、只读文件系统、非 root 运行等）统一应用到 Kubernetes 工作负载中。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-pod
  namespace: production
spec:
  # Pod 级别的安全配置，对所有容器生效
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
    seccompProfile:
      type: RuntimeDefault
    supplementalGroups: [4000]
  automountServiceAccountToken: false
  hostNetwork: false
  hostPID: false
  hostIPC: false
  
  containers:
  - name: app
    image: myregistry.io/app:v1.2.3@sha256:abc123...
    # 容器级别的安全配置
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
        add:
          - NET_BIND_SERVICE
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
    resources:
      requests:
        cpu: "250m"
        memory: "256Mi"
      limits:
        cpu: "1000m"
        memory: "512Mi"
```

### 9.3 RuntimeClass：选择合适的容器运行时

对于安全要求极高的场景，可以使用比标准 runc 更安全的容器运行时。gVisor（由 Google 开发）在用户空间实现了 Linux 内核的部分功能，为容器提供了一个"应用内核"，即使容器逃逸突破了用户空间内核，攻击者还需要再突破真正的 Linux 内核。Kata Containers 则为每个容器创建一个轻量级虚拟机，提供了硬件级别的隔离。

```yaml
# gVisor RuntimeClass 定义
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  nodeSelector:
    sandbox: "true"

---
# 使用 gVisor 运行安全敏感的 Pod
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: app
    image: nginx:alpine
```

### 9.4 NetworkPolicy 网络隔离策略

默认情况下，Kubernetes 集群中所有 Pod 之间都可以自由通信。NetworkPolicy 可以限制 Pod 的入站和出站流量，实现网络层面的微隔离，有效防止攻击者在突破某个 Pod 后进行横向移动。

```yaml
# 默认拒绝所有入站流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress

---
# 只允许前端访问后端
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 8080
```

---

## 十、纵深防御：构建多层安全体系

### 10.1 安全层级模型

纵深防御（Defense in Depth）是安全领域的核心理念，其核心思想是：不要把安全寄托在单一机制上，而是构建多层安全防线，使得攻击者必须同时突破多层防御才能达到目的。在容器安全领域，纵深防御的层次模型如下：

第一层是**宿主机安全**，包括内核及时更新、最小化安装、文件系统加密等。第二层是**镜像安全**，使用最小基础镜像、多阶段构建、定期漏洞扫描。第三层是**容器引擎安全**，通过 Capabilities、Namespaces、Cgroups 实现基本隔离。第四层是**运行时安全**，通过 seccomp、AppArmor、SELinux 限制容器行为。第五层是**编排层安全**，利用 Kubernetes 的 PSA、SecurityContext、NetworkPolicy 实施策略。第六层是**运行时策略**，使用 OPA Gatekeeper 或 Kyverno 实施策略即代码。第七层是**监控与响应**，通过 Falco、auditd、SIEM 系统检测和响应安全事件。

### 10.2 多层策略组合实战

将所有安全机制组合使用，实现最大化防护：

```bash
docker run -d \
  --name defense-in-depth \
  --security-opt apparmor=docker-custom \
  --security-opt seccomp=custom-seccomp.json \
  --security-opt no-new-privileges:true \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  --read-only \
  --tmpfs /tmp:size=128M,noexec,nosuid,nodev \
  --tmpfs /var/cache/nginx:size=64M \
  --memory=256m \
  --cpus=0.5 \
  --pids-limit=50 \
  --user=1000:1000 \
  --network=isolated-network \
  --ulimit nofile=1024:2048 \
  --ulimit nproc=256 \
  --health-cmd="wget -qO- http://localhost/healthz || exit 1" \
  --restart=on-failure:5 \
  nginx:alpine
```

---

## 十一、运行时安全监控：Falco 实战部署

### 11.1 Falco 架构与安装

Falco 是云原生计算基金会（CNCF）的毕业项目，是目前最流行的开源运行时安全工具。它通过内核级别的系统调用监控（使用 eBPF 或内核模块），结合灵活的规则引擎，实时检测容器和主机上的异常行为。Falco 可以检测到的威胁包括：容器内启动 shell（可能表示反弹 shell 攻击）、异常的文件系统访问（读取 /etc/shadow 等敏感文件）、异常的网络连接（与已知恶意 IP 通信）、特权容器的创建、以及对 Kubernetes 集群资源的异常访问等。

```bash
# 使用 Helm 安装 Falco
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update

helm install falco falcosecurity/falco \
  --namespace falco --create-namespace \
  --set driver.kind=modern_ebpf \
  --set falcosidekick.enabled=true \
  --set falcosidekick.config.slack.webhookurl="https://hooks.slack.com/xxx" \
  --set falcosidekick.config.slack.channel="#security-alerts"

# 验证安装
kubectl get pods -n falco
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=20
```

### 11.2 自定义 Falco 检测规则

Falco 的规则由三个核心组件构成：规则（rule）定义了检测条件和输出格式；宏（macro）是可复用的条件表达式；列表（list）是可复用的字符串集合。下面是一些针对容器安全的关键检测规则：

```yaml
# 检测容器内启动 shell - 可能是反弹 shell 攻击
- rule: Shell Spawned in Container
  desc: Detect any shell started inside a container
  condition: >
    spawned_process and container and
    proc.name in (bash, sh, dash, zsh, csh, ksh, ash)
  output: >
    Shell spawned in container 
    (user=%user.name shell=%proc.name parent=%proc.pname 
    cmdline=%proc.cmdline container=%container.name 
    image=%container.image.repository)
  priority: WARNING
  tags: [container, shell, mitre_execution]

# 检测容器内新增可执行文件 - 可能是恶意软件下载
- rule: New Binary Deployed in Container
  desc: Detect new executables written to container filesystem
  condition: >
    write and container and
    evt.arg.mode contains "x" and
    not proc.name in (package_managers)
  output: >
    New executable written in container 
    (user=%user.name file=%fd.name command=%proc.cmdline 
    container=%container.name image=%container.image.repository)
  priority: CRITICAL
  tags: [container, filesystem, mitre_persistence]

# 检测对 Docker socket 的访问
- rule: Docker Socket Accessed
  desc: Detect access to Docker socket from container
  condition: >
    open_read and container and
    (fd.name startswith /var/run/docker.sock or
     fd.name startswith /run/containerd)
  output: >
    Container runtime socket accessed 
    (user=%user.name command=%proc.cmdline 
    file=%fd.name container=%container.name)
  priority: CRITICAL
  tags: [container, privilege_escalation, mitre_privilege_escalation]

# 检测特权容器创建
- rule: Privileged Container Started
  desc: Detect creation of privileged containers
  condition: >
    evt.type=container and container.privileged=true
  output: >
    Privileged container started 
    (user=%user.name container=%container.name 
    image=%container.image.repository)
  priority: CRITICAL
  tags: [container, privilege_escalation]
```

---

## 十二、合规框架与安全基准

### 12.1 CIS Docker Benchmark 核心检查项

CIS（Center for Internet Security）发布的 Docker 安全基准是业界公认的容器安全标准。使用 `docker-bench-security` 工具可以自动化地检查你的 Docker 环境是否符合 CIS 基准。

```bash
# 运行 CIS Docker Benchmark 自动扫描
docker run --rm --net host --pid host --userns host \
  --cap-add audit_control \
  -e DOCKER_CONTENT_TRUST=$DOCKER_CONTENT_TRUST \
  -v /etc:/etc:ro \
  -v /var/lib:/var/lib:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /usr/lib/systemd:/usr/lib/systemd:ro \
  docker/docker-bench-security
```

以下是 CIS 基准中最重要的检查项及对应的加固措施：

| CIS 编号 | 检查项描述 | 加固方法 |
|---------|----------|---------|
| 2.1 | 限制容器间网络通信 | daemon.json 设置 `icc: false` |
| 2.4 | 不使用特权容器 | 禁止 `--privileged` 参数 |
| 2.8 | 使用非 root 用户运行容器 | Dockerfile 中设置 `USER` 或 `--user` 参数 |
| 2.11 | 设置 CPU 和内存限制 | `--memory` 和 `--cpus` 参数 |
| 2.12 | 只读挂载容器根文件系统 | `--read-only` 参数 |
| 2.14 | 限制容器获取新特权 | `--security-opt no-new-privileges:true` |
| 2.15 | 限制 Linux Capabilities | `--cap-drop=ALL` 加按需添加 |
| 5.2 | 启用 Docker Content Trust | 环境变量 `DOCKER_CONTENT_TRUST=1` |
| 5.12 | 扫描镜像漏洞 | 定期使用 Trivy 或 Docker Scout 扫描 |

### 12.2 NIST SP 800-190 容器安全指南

NIST 800-190（应用容器安全指南）由美国国家标准与技术研究院发布，是容器安全的权威参考文档。该指南涵盖了容器安全的全生命周期，从镜像构建到运行时监控，每个阶段都有明确的安全要求和建议。

核心安全要求可以归纳为五个维度：**镜像安全**要求使用最小基础镜像、定期扫描漏洞、验证镜像签名、使用可信仓库。**仓库安全**要求实施访问控制、启用传输加密、集成漏洞扫描。**编排安全**要求配置 RBAC、实施网络策略、设置资源限制、使用安全上下文。**容器安全**要求实施最小权限、只读文件系统、启用 seccomp 和 AppArmor。**主机安全**要求及时更新内核、最小化安装组件、启用审计日志。

```bash
# 使用 cosign 进行镜像签名和验证
cosign sign --key cosign.key myregistry.io/app:v1.0
cosign verify --key cosign.pub myregistry.io/app:v1.0

# 使用 cosign 验证来自公共仓库的官方镜像
cosign verify --certificate-identity-regexp=@ --certificate-oidc-issuer-regexp=@ \
  nginx:alpine
```

---

## 十三、实战 Playbook：Laravel 容器安全加固全流程

### 13.1 应用架构设计

以一个典型的 Laravel Web 应用为例，展示从零开始的安全加固全流程。应用架构由三层组成：Nginx 作为反向代理和静态文件服务（入口层）、PHP-FPM 处理应用逻辑（应用层）、MySQL 存储数据（数据层）。三层之间通过 Docker 网络隔离，只有必要的通信被允许。

### 13.2 安全加固的 Dockerfile

```dockerfile
# ===== PHP-FPM 安全加固镜像 =====
FROM php:8.3-fpm-alpine AS php

# 创建非 root 运行用户
RUN addgroup -g 1001 php-app && \
    adduser -u 1001 -G php-app -s /sbin/nologin -D php-app

# 安装必要扩展
RUN apk add --no-cache \
      libzip-dev libpng-dev libjpeg-turbo-dev freetype-dev icu-dev && \
    docker-php-ext-configure gd --with-freetype --with-jpeg && \
    docker-php-ext-install -j$(nproc) \
      pdo_mysql zip gd opcache intl bcmath && \
    # 清理构建依赖，减小镜像体积和攻击面
    apk del --no-cache libzip-dev libpng-dev libjpeg-turbo-dev freetype-dev icu-dev

# PHP 安全配置
RUN echo "expose_php = Off" >> /usr/local/etc/php/conf.d/security.ini && \
    echo "display_errors = Off" >> /usr/local/etc/php/conf.d/security.ini && \
    echo "log_errors = On" >> /usr/local/etc/php/conf.d/security.ini && \
    echo "open_basedir = /var/www/html:/tmp" >> /usr/local/etc/php/conf.d/security.ini && \
    echo "disable_functions = exec,passthru,shell_exec,system,proc_open,popen,curl_multi_exec,parse_ini_file,show_source" >> /usr/local/etc/php/conf.d/security.ini

COPY --chown=php-app:php-app . /var/www/html
WORKDIR /var/www/html
RUN composer install --no-dev --optimize-autoloader --no-scripts && \
    chmod -R 755 storage bootstrap/cache

USER 1001
EXPOSE 9000
```

### 13.3 Docker Compose 安全配置

```yaml
version: '3.8'

services:
  nginx:
    build: ./docker/nginx
    read_only: true
    tmpfs:
      - /tmp:size=64M,noexec,nosuid,nodev
      - /var/cache/nginx:size=128M
      - /var/run:size=16M
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: [no-new-privileges:true]
    networks: [frontend]
    deploy:
      resources:
        limits: { cpus: '0.5', memory: 256M }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  php:
    build: ./docker/php
    read_only: true
    tmpfs:
      - /tmp:size=128M,noexec,nosuid,nodev
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    networks: [frontend, backend]
    deploy:
      resources:
        limits: { cpus: '1.0', memory: 512M }

  mysql:
    image: mysql:8.0
    read_only: true
    tmpfs:
      - /tmp:size=64M
      - /var/run/mysqld:size=16M
    cap_drop: [ALL]
    cap_add: [DAC_OVERRIDE, SETGID, SETUID, SYS_RESOURCE]
    security_opt: [no-new-privileges:true]
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/mysql_root_password
    volumes:
      - mysql-data:/var/lib/mysql
    networks: [backend]
    secrets: [mysql_root_password]

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true  # 后端网络不允许外部访问
```

### 13.4 安全加固检查清单

完成所有配置后，使用以下检查清单逐一验证：

```bash
#!/bin/bash
echo "=== Laravel 容器安全加固验证清单 ==="

echo "[1/8] 镜像漏洞扫描..."
trivy image --severity HIGH,CRITICAL myregistry.io/laravel-php:v1.0

echo "[2/8] 验证非 root 运行..."
docker exec laravel_php id
# 预期: uid=1001(appuser) gid=1001(appgroup)

echo "[3/8] 验证只读文件系统..."
docker exec laravel_php touch /test 2>&1
# 预期: Read-only file system

echo "[4/8] 验证 Capabilities..."
docker exec laravel_php cat /proc/1/status | grep Cap
# 预期: 所有 Cap 字段值为 0 或最小值

echo "[5/8] 验证 seccomp..."
docker exec laravel_php grep Seccomp /proc/self/status
# 预期: Seccomp: 2

echo "[6/8] 验证网络隔离..."
docker network inspect laravel_backend | grep internal
# 预期: "Internal": true

echo "[7/8] 验证敏感信息..."
docker exec laravel_php env | grep -i password
# 预期: 无输出

echo "[8/8] 验证端口暴露..."
docker port laravel_php
# 预期: 无输出
```

---

## 十四、总结与建议

### 14.1 安全加固优先级矩阵

基于实施难度和安全收益的综合评估，以下是安全加固措施的优先级排序：

| 优先级 | 安全措施 | 实施难度 | 安全收益 |
|-------|---------|---------|---------|
| P0 | 镜像漏洞扫描 | 低 | 高 |
| P0 | 非 root 用户运行容器 | 低 | 高 |
| P0 | `--cap-drop=ALL` 后按需添加 | 低 | 高 |
| P1 | 只读文件系统 | 中 | 中 |
| P1 | seccomp 白名单过滤 | 中 | 高 |
| P1 | PodSecurityAdmission restricted | 中 | 高 |
| P2 | AppArmor/SELinux 自定义 profile | 高 | 高 |
| P2 | 用户命名空间重映射 | 高 | 高 |
| P2 | RuntimeClass (gVisor/Kata) | 高 | 极高 |
| P3 | Falco 运行时安全监控 | 中 | 中 |
| P3 | OPA/Gatekeeper 策略即代码 | 高 | 高 |

### 14.2 分阶段实施建议

安全加固不可能一蹴而就，建议分四个阶段逐步推进：

**第一阶段（第一周）**：完成基础安全加固——镜像漏洞扫描、非 root 运行、丢弃所有 Capabilities、启用只读文件系统。这些措施实施简单、风险低、收益高，应该首先完成。

**第二阶段（第二周）**：实施编排层安全——配置 PodSecurityAdmission 为 restricted 级别、创建 NetworkPolicy 实现网络微隔离、设置合理的资源限制。

**第三阶段（第三周）**：深入运行时安全——为关键应用编写专用的 seccomp 白名单 profile、配置 AppArmor 或 SELinux 强制访问控制策略。

**第四阶段（第四周）**：建立监控响应体系——部署 Falco 运行时安全监控、集成告警到 Slack/PagerDuty、定期运行 CIS Benchmark 扫描、建立安全事件响应流程。

### 14.3 核心安全原则总结

经过全文的深入讨论，以下是容器安全加固的核心原则：

第一，**最小权限是基石**。`--cap-drop=ALL`、非 root 用户、只读文件系统——这三项是最基本也最有效的措施，每个容器都应该遵循。

第二，**纵深防御是保障**。没有任何单一机制可以提供 100% 的保护。AppArmor、seccomp、Capabilities、NetworkPolicy 应该组合使用，形成多层防线。

第三，**监控是眼睛**。即使有完善的安全策略，也需要持续监控来发现策略配置漂移和新型攻击手法。Falco 等运行时安全工具是不可或缺的。

第四，**合规是底线**。CIS Benchmark 和 NIST 800-190 等框架提供了经过验证的安全基线，定期扫描可以确保安全配置没有退化。

第五，**安全左移是趋势**。在 CI/CD 管道中集成镜像扫描、策略检查、IaC 安全审计，将安全问题在开发阶段就拦截，而不是等到生产环境才暴露。

---

## 十五、三大安全模块横向对比：AppArmor vs SELinux vs seccomp

在实际选型中，很多团队会纠结"该用 AppArmor 还是 SELinux？需不需要 seccomp？"下面从多个维度进行横向对比，帮助你做出合理决策：

| 对比维度 | AppArmor | SELinux | seccomp |
|---------|----------|---------|---------|
| **防护层级** | 文件路径级 MAC | 安全标签级 MAC | 系统调用级过滤 |
| **匹配机制** | 基于文件路径 | 基于安全上下文标签 | 基于 syscall 编号/名称 |
| **默认发行版** | Ubuntu、Debian、openSUSE | RHEL、CentOS、Fedora、Rocky | 所有 Linux（内核 ≥ 3.5） |
| **学习曲线** | ⭐⭐ 低——路径语法直观 | ⭐⭐⭐⭐ 高——标签体系复杂 | ⭐⭐⭐ 中——需理解 syscall |
| **策略粒度** | 文件、网络、Capability | 文件、端口、套接字、IPC 全覆盖 | 仅 syscall 名称/编号 |
| **容器集成** | Docker/K8s 原生支持 | Docker/K8s 原生支持 | Docker/K8s 原生支持 |
| **性能开销** | 极低（< 1%） | 低（1-3%，标签查找） | 极低（BPF JIT 编译） |
| **适用场景** | Ubuntu/Debian 容器环境 | RHEL 系企业环境 | 所有容器环境的 syscall 收敛 |
| **策略热更新** | 支持（apparmor_parser -r） | 支持（semodule -i） | 需重新加载容器 |
| **调试工具** | aa-logprof、dmesg | audit2allow、sealert | strace、oci-seccomp-bpf-hook |
| **常见踩坑** | 路径通配符误配、符号链接绕过 | 布尔值遗漏、标签不匹配 | syscall 遗漏导致应用崩溃 |

**选型建议**：

- **Ubuntu/Debian 环境**：优先 AppArmor + seccomp 组合，学习成本低、效果好
- **RHEL/CentOS/Rocky 环境**：优先 SELinux + seccomp 组合，利用发行版预置策略
- **所有环境**：seccomp 都应该启用，它是成本最低、收益最高的系统调用收敛手段
- **高安全场景**：三者叠加使用——seccomp 收敛 syscall，AppArmor/SELinux 控制资源访问，形成纵深防御

---

## 相关阅读

- [容器安全扫描实战：Trivy/Snyk/Grype CI 集成——镜像漏洞检测、SBOM 生成与修复工作流](/categories/CI/CD/容器安全扫描实战-Trivy-Snyk-Grype-CI集成-镜像漏洞检测-SBOM生成与修复工作流/)
- [WASI 0.2 组件模型实战：服务端 WebAssembly——在 Laravel 中安全运行不受信任的用户代码沙箱](/categories/运维/wasi-0.2-component-model-laravel-sandbox/)
- [API Gateway 安全实战：WAF + Bot 管理 + mTLS——Cloudflare/AWS WAF 与 Laravel 微服务的纵深防御架构](/categories/运维/API-Gateway-安全实战-WAF-Bot管理-mTLS-纵深防御架构/)

容器安全的最佳状态不是让你的系统"无法被攻破"——这在理论上就不可能实现——而是让攻击者在突破某一层防御后仍然面临层层阻碍，无法获得有价值的目标，同时为安全团队的检测和响应争取到宝贵的时间窗口。通过本文介绍的多层安全机制的合理组合和分阶段落地，你可以为你的容器化应用构建一个坚实的安全防线。
