---
title: Linux 运维与 Shell 完全指南：权限、命令、进程管理与网络调试
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags: [DevOps, Linux, 运维, Shell]
keywords: [Linux, Shell, 运维与, 完全指南, 权限, 命令, 进程管理与网络调试, 工程化]
categories:
  - engineering
  - linux
date: 2021-03-20 15:05:07
description: 'Linux 运维完全指南：详解文件权限体系（chmod/chown/SUID/SGID/Sticky Bit）、常用命令速查（find/grep/awk/sed/tar/rsync）、进程管理（systemd/journalctl）、网络调试（tcpdump/iptables）、磁盘管理（LVM）及 Shell 脚本编程，涵盖 20+ 实战命令示例，适合开发者与运维工程师快速查阅。'
---

# Linux 运维与 Shell 完全指南

本文是面向开发者和运维工程师的 Linux 综合参考手册。无论你是刚接触 Linux 的新手，还是有经验的系统管理员，都可以在这里找到日常工作中最常用的命令、配置方法和最佳实践。文章涵盖文件权限体系、常用命令速查、进程管理、网络调试、磁盘管理、用户管理以及 Shell 脚本编程七大主题，每个知识点都附带可直接运行的命令示例。

---

## 一、文件权限体系

Linux 的权限系统是保障系统安全的核心机制。理解权限管理是每一位 Linux 用户的必修课。Linux 中每个文件和目录都关联着三组权限——分别针对所有者（Owner）、所属组（Group）和其他用户（Others）。每一组权限又分为读取（r）、写入（w）和执行（x）三种级别。

### 1.1 权限基础：读、写、执行

权限值采用八进制表示，每种权限对应一个数值：

| 权限 | 简称 | 全称 | 值 | 表达式 |
| :------: | :--: | :-----: | :--: | :----: |
| 读取权限 | r | Read | 4 | 2² |
| 写入权限 | w | Write | 2 | 2¹ |
| 执行权限 | x | Execute | 1 | 2⁰ |
| 无权限 | – | — | 0 | 0 |

**示例：644 权限深度解读**

```
rw- r-- r--
```

当我们看到一个文件的权限为 `644` 时，需要将每一位数字拆解为三位二进制来理解：

- **第一位 6** = 4 + 2 + 0 → `rw-`：文件所有者拥有读取和写入权限，但没有执行权限。这适用于普通的数据文件，如网页的 HTML 文件或配置文件。
- **第二位 4** = 4 + 0 + 0 → `r--`：同组用户只有读取权限。这意味着同组成员可以查看文件内容，但无法修改。
- **第三位 4** = 4 + 0 + 0 → `r--`：其他用户也只有读取权限。这是对外部访问者最严格的限制之一，常见于需要公开读取但不允许修改的场景。

### 1.2 chmod：修改文件权限

`chmod`（change mode）是最常用的权限管理命令，支持两种设置方式：**数字模式**和**符号模式**。

**数字模式**（八进制）适合快速设置完整的权限值：

```bash
# 设置文件权限为 644（所有者读写，其他人只读）
chmod 644 index.html

# 设置目录权限为 755（所有人可读可进入，只有所有者可写）
chmod 755 /var/www/html

# 设置为 700（仅所有者可读写执行，常用于 SSH 密钥目录）
chmod 700 ~/.ssh
```

**符号模式**使用字母表示操作对象和操作类型，更加直观灵活：

```bash
# 给所有用户添加执行权限
chmod +x deploy.sh

# 给所有者添加写权限，同时移除其他用户的读权限
chmod u+w,o-r config.yml

# 给同组用户添加写权限
chmod g+w shared_dir

# 递归设置目录及其所有子文件和子目录的权限
chmod -R 755 /var/www/html
```

**符号模式中的操作对象说明**：

- `u`（user）：文件所有者
- `g`（group）：所属组
- `o`（others）：其他用户
- `a`（all）：所有用户

操作符 `+` 表示添加权限，`-` 表示移除权限，`=` 表示设置为指定权限（覆盖原有值）。

### 1.3 chown 与 chgrp：更改文件归属

当文件需要变更所有者或所属组时，使用 `chown` 和 `chgrp` 命令。这在部署应用、迁移数据或调整团队访问权限时非常常见：

```bash
# 更改文件所有者
chown www-data index.html

# 同时更改所有者和所属组（冒号分隔）
chown www-data:www-data /var/www/html

# 递归更改目录及其中所有文件的归属
chown -R deploy:deploy /opt/app

# 仅更改所属组（不改变所有者）
chgrp developers project_dir
```

### 1.4 umask：默认权限掩码

`umask` 决定新创建的文件和目录的默认权限。计算规则如下：

- 文件的默认最大权限是 666（不包含执行权限，因为普通文件一般不需要执行）
- 目录的默认最大权限是 777
- 实际权限 = 最大权限 - umask 值

```bash
# 查看当前 umask 值
umask          # 常见输出: 0022

# 当 umask 为 022 时：
# 文件默认权限 = 666 - 022 = 644 (rw-r--r--)
# 目录默认权限 = 777 - 022 = 755 (rwxr-xr-x)

# 设置 umask 为 027（同组用户无写权限，其他用户无任何权限）
umask 027
# 文件默认权限 = 666 - 027 = 640 (rw-r-----)
# 目录默认权限 = 777 - 027 = 750 (rwxr-x---)
```

在多用户环境中，合理的 umask 设置能有效降低安全风险。一般生产环境建议设置为 `027` 或更严格的 `077`。

### 1.5 特殊权限位：SUID、SGID、Sticky Bit

除了标准的读写执行权限外，Linux 还提供三种特殊权限位，它们在系统安全和协作场景中发挥着关键作用：

| 特殊权限 | 数字表示 | 符号表示 | 作用说明 |
| :------: | :------: | :------: | ---- |
| SUID | 4xxx | `s`（位于所有者执行位） | 用户执行该文件时，将获得文件所有者的权限 |
| SGID | 2xxx | `s`（位于所属组执行位） | 用户执行文件时获得所属组权限；目录下新文件自动继承目录的组 |
| Sticky Bit | 1xxx | `t`（位于其他用户执行位） | 目录中只有文件所有者和 root 才能删除文件 |

**SUID 示例**：`passwd` 命令是 SUID 最经典的例子。普通用户运行 `passwd` 时需要修改 `/etc/shadow`（该文件由 root 所有），因此 `passwd` 设置了 SUID 位，使得执行时临时获得 root 权限：

```bash
# 查看 passwd 的权限（注意所有者执行位的 s）
ls -l /usr/bin/passwd
# -rwsr-xr-x 1 root root ... /usr/bin/passwd
#       ^ s 表示 SUID 已设置

# 手动设置 SUID（数字模式）
chmod 4755 /usr/local/bin/my_program

# 手动设置 SUID（符号模式）
chmod u+s /usr/local/bin/my_program
```

**SGID 示例**：当一个目录设置了 SGID 位后，在该目录中新创建的文件和子目录会自动继承父目录的所属组，而不是创建者的主组。这在团队共享目录中非常实用：

```bash
# 设置 SGID，确保团队成员创建的文件自动归属到 project 组
chmod 2775 /opt/team_project
chmod g+s /opt/team_project
# 此后任何人在该目录下创建的文件都归属于 team_project 组
```

**Sticky Bit 示例**：Linux 系统的 `/tmp` 目录是 Sticky Bit 最典型的使用场景。所有用户都可以在 `/tmp` 中创建文件，但只能删除自己创建的文件，防止他人误删或恶意删除：

```bash
# 查看 /tmp 的权限（注意最后的 t）
ls -ld /tmp
# drwxrwxrwt 15 root root 4096 ... /tmp
#          ^ t 表示 Sticky Bit 已设置

# 手动设置 Sticky Bit
chmod 1777 /shared/uploads
chmod +t /shared/uploads
```

---

## 二、常用命令速查

在日常的 Linux 操作中，以下命令是最常使用的工具。掌握它们能极大提升运维效率。

### 2.1 find：文件查找

`find` 是 Linux 中功能最强大的文件搜索工具，支持按名称、类型、大小、时间等多种条件进行精确查找：

```bash
# 在指定目录下按名称递归查找日志文件
find /var/log -name "*.log"

# 按文件类型查找（f=普通文件，d=目录，l=符号链接）
find /home -type f -name "*.conf"

# 按文件大小查找（查找大于 100MB 的文件）
find / -type f -size +100M

# 按修改时间查找（最近 7 天内修改过的文件）
find /var/www -mtime -7 -type f

# 找到后直接执行操作（删除 30 天前的旧日志）
find /var/log -name "*.log" -mtime +30 -delete

# 排除特定目录进行查找
find . -name "*.js" -not -path "./node_modules/*"
```

### 2.2 grep：文本搜索

`grep` 是文本搜索的利器，可以在海量日志和配置文件中快速定位关键字：

```bash
# 递归搜索目录中包含 ERROR 的文件（显示行号）
grep -rn "ERROR" /var/log/app/

# 忽略大小写搜索
grep -i "error" application.log

# 显示匹配行的前后 3 行上下文（帮助定位问题）
grep -C 3 "Exception" app.log

# 使用正则表达式匹配日期格式开头的行
grep -E "^[0-9]{4}-[0-9]{2}" access.log

# 排除搜索（显示非注释行，常用于查看配置文件的实际生效内容）
grep -v "^#" nginx.conf

# 统计匹配关键字出现的次数
grep -c "404" access.log
```

### 2.3 awk：文本处理

`awk` 是一种强大的文本处理语言，特别适合处理结构化的日志和数据文件：

```bash
# 打印日志中的第一列（IP 地址）和第四列（时间戳）
awk '{print $1, $4}' access.log

# 按逗号分隔符处理 CSV 文件
awk -F',' '{print $2, $3}' data.csv

# 条件过滤：只打印 HTTP 状态码为 500 的行
awk '$9 == 500 {print $0}' access.log

# 求和统计：计算所有请求的总字节数
awk '{sum += $10} END {print "Total bytes:", sum}' access.log

# 格式化输出（对齐列）
awk '{printf "%-20s %s\n", $1, $7}' access.log
```

### 2.4 sed：流编辑器

`sed`（stream editor）可以在不打开文件的情况下，对文件内容进行替换、删除和插入操作：

```bash
# 替换文件中的字符串并直接修改原文件（-i 选项）
sed -i 's/old_domain/new_domain/g' config.yml

# 删除文件中的空行
sed -i '/^$/d' file.txt

# 删除包含 DEBUG 关键字的行（清理日志）
sed -i '/DEBUG/d' application.log

# 在第 3 行之后插入一行新内容
sed -i '3a\new_line_content' config.txt

# 只显示文件的第 10 到第 20 行（类似 head + tail 的组合）
sed -n '10,20p' large_file.txt
```

### 2.5 xargs：参数传递

`xargs` 可以将标准输入转化为命令参数，常与 `find`、`grep` 等命令组合使用：

```bash
# 查找并删除 7 天前的临时文件
find /tmp -name "*.tmp" -mtime +7 | xargs rm -f

# 查找所有目录并设置权限
find /var/www -type d | xargs chmod 755

# 限制每次传递的参数数量（每次处理 5 个文件）
find . -name "*.jpg" | xargs -n 5 gzip

# 正确处理带空格的文件名（-print0 和 -0 配合使用）
find . -name "*.txt" -print0 | xargs -0 rm
```

### 2.6 curl：HTTP 请求工具

`curl` 是调试 API 和下载文件的必备工具，在开发和运维中使用频率极高：

```bash
# 发送 GET 请求
curl https://api.example.com/users

# 发送 POST 请求（附带 JSON 数据）
curl -X POST https://api.example.com/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Michael","email":"test@example.com"}'

# 下载文件
curl -O https://releases.example.com/app-v2.0.tar.gz

# 只查看 HTTP 响应头
curl -I https://example.com

# 跟随重定向
curl -L https://short.url/abc

# 限速下载（最大速度 1MB/s，避免占用全部带宽）
curl --limit-rate 1M -O https://large-file.com/data.zip
```

### 2.7 tar：归档与压缩

`tar` 是 Linux 下最常用的打包工具，支持 gzip 和 bzip2 两种压缩方式：

```bash
# 创建 tar.gz 归档（-c 创建，-z 使用 gzip，-f 指定文件名）
tar -czf backup.tar.gz /var/www/html

# 解压 tar.gz 文件（-x 解压）
tar -xzf backup.tar.gz

# 只查看归档内容列表（不解压）
tar -tzf backup.tar.gz

# 解压到指定目录
tar -xzf release.tar.gz -C /opt/app/

# 使用 bzip2 压缩（压缩率更高，但速度较慢）
tar -cjf project.tar.bz2 ./project/
```

### 2.8 rsync：远程同步

`rsync` 是增量同步工具，只传输变化的文件，比 `scp` 更高效，特别适合大数据量的备份和部署：

```bash
# 本地目录同步（-a 归档模式，-v 详细输出，-z 压缩传输）
rsync -avz /source/ /destination/

# 推送到远程服务器
rsync -avz --progress ./dist/ user@server:/var/www/html/

# 从远程服务器拉取文件
rsync -avz user@server:/var/log/app/ ./local_logs/

# 排除特定文件或目录
rsync -avz --exclude='node_modules' --exclude='.git' ./project/ /backup/

# 模拟运行（-n 选项，只显示会传输什么但不实际执行）
rsync -avzn --delete /source/ /destination/
```

---

## 三、进程管理

Linux 是一个多任务操作系统，理解进程管理对于排查系统问题、优化性能至关重要。

### 3.1 ps 与 top：查看进程

```bash
# 查看所有进程的详细信息
ps aux

# 按 CPU 使用率降序排列（找出最消耗 CPU 的进程）
ps aux --sort=-%cpu | head -20

# 按内存使用率降序排列（找出最消耗内存的进程）
ps aux --sort=-%mem | head -20

# 查找特定进程
ps aux | grep nginx

# 树状显示进程父子关系（理解进程之间的依赖关系）
ps -ef --forest

# 实时监控系统资源（CPU、内存、进程排行）
top

# 更友好的实时监控界面（支持鼠标操作和颜色高亮，需要安装）
htop
```

### 3.2 kill 与 nohup：进程控制

当需要停止或管理后台进程时，以下命令必不可少：

```bash
# 发送 SIGTERM 信号正常终止进程（推荐方式）
kill PID

# 发送 SIGKILL 信号强制终止进程（最后手段）
kill -9 PID

# 按名称批量终止进程
killall node

# 后台运行脚本，即使终端关闭也不会中断
nohup ./deploy.sh > deploy.log 2>&1 &

# 查看当前 shell 会话中的后台任务
jobs -l

# 将后台任务切换到前台
fg %1
```

### 3.3 systemd 与 journalctl：现代服务管理

`systemd` 是目前绝大多数 Linux 发行版使用的初始化系统和服务管理器。它取代了传统的 SysVinit，提供了并行启动、自动依赖解析和统一的服务管理接口。

**systemd 服务管理命令**：

```bash
# 启动 Nginx 服务
sudo systemctl start nginx

# 停止 Nginx 服务
sudo systemctl stop nginx

# 重启服务（先停止再启动）
sudo systemctl restart nginx

# 重新加载配置文件（不中断当前连接，推荐用于生产环境）
sudo systemctl reload nginx

# 设置服务开机自动启动
sudo systemctl enable nginx

# 禁止服务开机自动启动
sudo systemctl disable nginx

# 查看服务的运行状态、最近日志和进程信息
sudo systemctl status nginx

# 列出所有正在运行的服务
systemctl list-units --type=service --state=running
```

**journalctl 日志查询**：

`journalctl` 是 systemd 的日志管理工具，取代了传统的 syslog，提供了结构化的日志查询能力：

```bash
# 查看指定服务的全部日志
journalctl -u nginx.service

# 只查看最近 100 行日志
journalctl -u nginx.service -n 100

# 实时跟踪日志输出（类似 tail -f，调试时非常有用）
journalctl -u nginx.service -f

# 查看从今天开始的所有日志
journalctl --since today

# 查看指定时间段的日志
journalctl --since "2024-01-01 00:00" --until "2024-01-02 00:00"

# 只显示错误及以上严重级别的日志
journalctl -p err
```

### 3.4 systemd vs SysVinit 对比

下表总结了两种初始化系统的主要差异，帮助你理解为什么 systemd 已成为主流：

| 特性 | SysVinit（传统） | systemd（现代） |
| :--- | :--- | :--- |
| 启动速度 | 按顺序串行启动，速度较慢 | 并行启动服务，启动速度快 |
| 服务管理方式 | 通过 `/etc/init.d/` 下的 Shell 脚本管理 | 使用 `systemctl` 命令统一管理 |
| 依赖管理 | 需要手动配置启动顺序和依赖 | 自动分析和处理服务依赖关系 |
| 日志系统 | 使用 syslog，日志分散在多个文件中 | 使用 journalctl，日志统一存储为二进制格式 |
| 服务类型支持 | 仅支持系统服务 | 支持 service、socket、timer、mount 等多种单元类型 |
| 配置文件格式 | 每个服务是一个 Shell 脚本 | 使用 INI 风格的 unit 文件，结构清晰 |
| 进程监控 | 无内置进程监控能力 | 内置 watchdog 和自动重启机制 |
| 资源限制 | 功能有限 | 通过 cgroups 精确控制 CPU、内存等资源 |

---

## 四、网络调试

网络问题是运维中最常见的故障类型之一。掌握网络调试工具能帮助你快速定位连接超时、端口不通、DNS 解析失败等问题。

### 4.1 网络连接与端口查看

```bash
# 查看所有正在监听的 TCP 端口（-t TCP，-l 监听，-n 数字显示，-p 显示进程）
ss -tlnp

# 查看所有已建立的 TCP 连接
ss -tnp

# 只查看特定端口的连接状态
ss -tnp | grep :443

# 查看 socket 连接的统计摘要
ss -s

# 传统 netstat 命令（功能类似 ss，但 ss 更新更快）
netstat -tlnp
netstat -anp | grep ESTABLISHED
```

### 4.2 ping、traceroute 与 DNS 查询

```bash
# 测试到目标主机的网络连通性（发送 4 个包）
ping -c 4 google.com

# 追踪数据包到目标主机经过的路由路径（排查中间节点故障）
traceroute google.com

# DNS 解析查询（查看域名对应的 IP 地址）
dig example.com

# 查询特定类型的 DNS 记录（如邮件服务器的 MX 记录）
dig MX example.com

# 反向 DNS 查询（通过 IP 地址查域名）
dig -x 8.8.8.8

# 使用指定的 DNS 服务器进行查询
nslookup example.com 8.8.8.8
```

### 4.3 tcpdump：网络抓包

`tcpdump` 是 Linux 下最强大的网络抓包工具，可以捕获和分析流经网卡的所有数据包：

```bash
# 抓取 eth0 网卡上的 HTTP 流量
sudo tcpdump -i eth0 port 80

# 只捕获特定主机的流量
sudo tcpdump -i eth0 host 192.168.1.100

# 抓取 DNS 查询并显示详细协议内容
sudo tcpdump -i eth0 port 53 -vv

# 将抓包结果保存为 pcap 文件（可用 Wireshark 进行图形化分析）
sudo tcpdump -i eth0 -w capture.pcap

# 读取之前保存的抓包文件
sudo tcpdump -r capture.pcap

# 只捕获 TCP SYN 包（可用于检测端口扫描行为）
sudo tcpdump -i eth0 'tcp[tcpflags] & (tcp-syn) != 0'
```

### 4.4 iptables：防火墙规则管理

`iptables` 是 Linux 内核自带的防火墙工具，通过配置规则来控制网络流量的进出：

```bash
# 查看当前所有防火墙规则（-n 用数字显示地址，-v 详细模式）
sudo iptables -L -n -v

# 允许 SSH 连接（放行 22 端口）
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# 同时允许 HTTP 和 HTTPS 流量
sudo iptables -A INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT

# 设置默认策略为拒绝所有入站连接（白名单模式）
sudo iptables -P INPUT DROP

# 允许已经建立的连接和相关连接（确保已有的 SSH 会话不中断）
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 按行号删除指定规则
sudo iptables -D INPUT 3

# 将当前规则持久化保存（Ubuntu/Debian 系统）
sudo iptables-save > /etc/iptables/rules.v4
```

**使用 ufw 简化防火墙操作**（Ubuntu 推荐方式）：

```bash
sudo ufw allow 22/tcp           # 放行 SSH
sudo ufw allow 80,443/tcp       # 放行 HTTP 和 HTTPS
sudo ufw enable                 # 启用防火墙
sudo ufw status verbose         # 查看规则和状态
```

---

## 五、磁盘管理

磁盘空间不足是服务器最常见的告警之一。学会使用磁盘管理工具，能够及时发现和处理存储问题。

### 5.1 df 与 du：磁盘空间监控

```bash
# 查看所有挂载分区的磁盘使用情况（-h 人类可读格式）
df -h

# 查看指定目录所在分区的剩余空间
df -h /var/www

# 查看某个目录的总大小
du -sh /var/log

# 列出当前目录下各子目录的大小并按从大到小排序
du -sh */ | sort -rh

# 查看文件系统类型（ext4、xfs 等）
df -T

# 查看 inode 使用情况（inode 耗尽也会导致无法创建文件）
df -i
```

### 5.2 挂载与格式化

```bash
# 查看当前已挂载的文件系统
mount | grep "/dev/sd"

# 挂载一个新分区到指定目录
sudo mount /dev/sdb1 /mnt/data

# 挂载 ISO 镜像文件
sudo mount -o loop image.iso /mnt/iso

# 卸载文件系统
sudo umount /mnt/data

# 查看磁盘分区表
sudo fdisk -l

# 将分区格式化为 ext4 文件系统
sudo mkfs.ext4 /dev/sdb1
```

### 5.3 LVM 基础：逻辑卷管理

LVM（Logical Volume Manager）是 Linux 下的逻辑卷管理方案，它在物理磁盘和文件系统之间引入了一层抽象，使得在线扩展和缩小分区成为可能。对于需要灵活管理存储的生产环境，LVM 是推荐的选择。

LVM 的三个核心概念：**物理卷（PV）** → **卷组（VG）** → **逻辑卷（LV）**。

```bash
# 查看物理卷信息
sudo pvs

# 查看卷组信息
sudo vgs

# 查看逻辑卷信息
sudo lvs

# 将物理磁盘初始化为物理卷
sudo pvcreate /dev/sdb

# 创建卷组（将物理卷加入卷组）
sudo vgcreate data_vg /dev/sdb

# 在卷组中创建逻辑卷（分配 20GB 空间）
sudo lvcreate -L 20G -n app_lv data_vg

# 在线扩展逻辑卷（增加 10GB）
sudo lvextend -L +10G /dev/data_vg/app_lv

# 扩展文件系统以使用新增的空间（ext4 文件系统）
sudo resize2fs /dev/data_vg/app_lv

# 扩展文件系统（如果是 xfs 文件系统）
sudo xfs_growfs /dev/data_vg/app_lv
```

---

## 六、用户管理

在多用户环境中，合理管理用户和权限是系统安全的基础。

### 6.1 用户与组操作

```bash
# 创建新用户（-m 自动创建主目录，-s 指定登录 Shell）
sudo useradd -m -s /bin/bash deploy

# 设置用户密码
sudo passwd deploy

# 将用户添加到附加组（-a 追加模式，-G 指定附加组）
sudo usermod -aG sudo deploy
sudo usermod -aG www-data deploy

# 修改用户的默认登录 Shell
sudo usermod -s /bin/zsh deploy

# 创建新的用户组
sudo groupadd developers

# 查看用户所属的所有组
groups deploy
id deploy

# 锁定用户账户（禁止登录但不删除）
sudo usermod -L deploy

# 删除用户及其主目录
sudo userdel -r deploy
```

### 6.2 sudo 与 /etc/sudoers

`sudo` 允许普通用户以 root 权限执行特定命令，是 Linux 权限提升的标准方式。通过合理配置 `/etc/sudoers` 文件，可以实现精细化的权限控制：

```bash
# 使用 sudo 执行需要 root 权限的命令
sudo apt update

# 切换到 root 用户的交互式 Shell
sudo -i

# 以其他用户身份执行命令
sudo -u www-data cat /var/www/.env

# 编辑 sudoers 文件（务必使用 visudo 命令，它会在保存时检查语法，防止配置错误导致无法使用 sudo）
sudo visudo
```

**常见 sudoers 配置示例**：

```bash
# 允许 deploy 用户无密码执行所有命令（谨慎使用）
deploy ALL=(ALL) NOPASSWD: ALL

# 只允许 deploy 用户执行 systemctl 和 nginx 命令
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl, /usr/sbin/nginx

# 允许 developers 组的成员重启 PHP-FPM 服务
%developers ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart php*-fpm
```

---

## 七、Shell 脚本编程

Shell 脚本是 Linux 自动化运维的核心技能。通过编写脚本，可以将重复的手动操作自动化，提高效率并减少人为错误。

### 7.1 变量

```bash
#!/bin/bash

# 定义变量（注意：等号两边不能有空格）
NAME="Michael"
AGE=30

# 使用变量（花括号可以明确变量边界）
echo "你好，${NAME}！年龄：${AGE}"

# 只读变量（定义后不能修改，尝试修改会报错）
readonly PI=3.14159

# 导出为环境变量（子进程也可以访问）
export APP_ENV="production"

# 常用的特殊变量
echo "脚本名称: $0"          # 当前脚本的文件名
echo "第一个参数: $1"         # 脚本接收到的第一个参数
echo "参数个数: $#"           # 传入参数的总数
echo "所有参数: $@"           # 所有参数（各自独立）
echo "上一条命令的退出码: $?"  # 0 通常表示成功

# 字符串操作
STR="Hello World"
echo "字符串长度: ${#STR}"             # 11
echo "提取子串: ${STR:0:5}"            # Hello
echo "替换子串: ${STR/World/Linux}"    # Hello Linux
```

### 7.2 条件判断

```bash
#!/bin/bash

# 文件测试（检查文件是否存在）
FILE="/etc/nginx/nginx.conf"
if [ -f "$FILE" ]; then
    echo "文件存在"
elif [ -d "$FILE" ]; then
    echo "这是一个目录"
else
    echo "路径不存在"
fi

# 数值比较（-gt 大于，-lt 小于，-eq 等于）
NUM=42
if [ "$NUM" -gt 40 ]; then
    echo "数值大于 40"
fi

# 字符串比较
STR="hello"
if [ "$STR" = "hello" ]; then
    echo "字符串匹配"
fi

# 多条件组合（&& 逻辑与，|| 逻辑或）
if [ -f "$FILE" ] && [ -r "$FILE" ]; then
    echo "文件存在且可读"
fi

# case 语句（类似其他语言的 switch-case）
case "$1" in
    start)
        echo "正在启动服务..."
        ;;
    stop)
        echo "正在停止服务..."
        ;;
    restart)
        echo "正在重启服务..."
        ;;
    *)
        echo "用法: $0 {start|stop|restart}"
        exit 1
        ;;
esac
```

### 7.3 循环

```bash
#!/bin/bash

# for 循环遍历列表
for i in 1 2 3 4 5; do
    echo "数字: $i"
done

# 花括号范围循环
for i in {1..10}; do
    echo "第 $i 次迭代"
done

# C 风格的 for 循环（适合需要计数器的场景）
for ((i=0; i<5; i++)); do
    echo "索引: $i"
done

# 遍历文件列表（处理日志文件）
for file in /var/log/*.log; do
    echo "正在处理: $file"
    wc -l "$file"
done

# while 循环
COUNTER=0
while [ $COUNTER -lt 5 ]; do
    echo "计数器当前值: $COUNTER"
    COUNTER=$((COUNTER + 1))
done

# 逐行读取文件（处理配置文件中的每一行）
while IFS= read -r line; do
    echo "读取到: $line"
done < /etc/hosts
```

### 7.4 函数

```bash
#!/bin/bash

# 定义一个日志输出函数（local 关键字限制变量作用域）
log_info() {
    local message="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $message"
}

# 带返回值的函数（通过 return 或全局变量返回结果）
check_service() {
    local service_name="$1"
    if systemctl is-active --quiet "$service_name"; then
        return 0  # 服务正在运行
    else
        return 1  # 服务未运行
    fi
}

# 调用函数
log_info "开始执行任务..."

if check_service "nginx"; then
    log_info "Nginx 服务运行正常"
else
    log_info "Nginx 未在运行，正在尝试启动..."
    sudo systemctl start nginx
fi

# 带默认参数值的函数
backup_db() {
    local db_name="${1:-mydb}"           # 默认数据库名为 mydb
    local backup_dir="${2:-/backup/mysql}" # 默认备份目录
    local timestamp=$(date +%Y%m%d_%H%M%S)

    mkdir -p "$backup_dir"
    mysqldump "$db_name" > "${backup_dir}/${db_name}_${timestamp}.sql"
    log_info "数据库 ${db_name} 已备份到 ${backup_dir}/${db_name}_${timestamp}.sql"
}

backup_db "production" "/data/backup"
```

### 7.5 实战脚本：自动化部署

下面是一个简化的自动部署脚本示例，展示了如何将以上知识点组合运用到实际场景中：

```bash
#!/bin/bash
# deploy.sh - 自动化部署脚本
# 使用方式: ./deploy.sh [分支名]
set -euo pipefail  # 遇到错误立即退出，未定义变量报错，管道错误传播

APP_DIR="/opt/app"
BACKUP_DIR="/opt/backup"
BRANCH="${1:-main}"  # 默认部署 main 分支

log_info() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# 步骤 1：备份当前版本
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
tar -czf "${BACKUP_DIR}/app_${TIMESTAMP}.tar.gz" -C "$APP_DIR" .
log_info "当前版本已备份: app_${TIMESTAMP}.tar.gz"

# 步骤 2：拉取最新代码
cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"
log_info "代码已更新至 ${BRANCH} 分支"

# 步骤 3：安装依赖
composer install --no-dev --optimize-autoloader
log_info "Composer 依赖安装完成"

# 步骤 4：运行数据库迁移
php artisan migrate --force
log_info "数据库迁移完成"

# 步骤 5：刷新应用缓存
php artisan config:cache
php artisan route:cache
php artisan view:cache
log_info "应用缓存已刷新"

# 步骤 6：重启服务
sudo systemctl reload php8.2-fpm
sudo systemctl reload nginx
log_info "PHP-FPM 和 Nginx 已重新加载"

log_info "✅ 部署完成！"
```

---

## 八、系统信息快速查看

在排查问题时，快速获取系统信息是第一步。以下命令能帮助你全面了解服务器的运行状态：

```bash
# 查看内核版本和系统架构
uname -a

# 查看操作系统发行版信息
cat /etc/os-release

# 查看主机名和操作系统设置
hostnamectl

# 查看 CPU 架构和型号详情
lscpu

# 查看 CPU 核心数
nproc

# 查看内存和交换空间使用情况（人类可读格式）
free -h

# 查看内存占用最高的 10 个进程
ps aux --sort=-%mem | head -11

# 查看系统运行时间和平均负载
uptime

# 查看磁盘 I/O 统计（每秒采样一次，共 5 次）
iostat -x 1 5

# 实时跟踪系统日志（传统方式）
tail -f /var/log/syslog

# 查看最近 20 次登录记录
last -20

# 查看失败的登录尝试（安全审计）
lastb -20
```

---

## 九、实用组合技巧

以下是一些在实际工作中非常实用的命令组合，能够帮助你高效完成日常运维任务：

```bash
# 实时监控日志中的错误信息（带缓冲输出）
tail -f /var/log/app/error.log | grep --line-buffered "ERROR"

# 批量重命名文件（将 .jpeg 扩展名改为 .jpg）
for f in *.jpeg; do mv "$f" "${f%.jpeg}.jpg"; done

# 统计项目中 PHP 文件的总代码行数（排除 vendor 目录）
find . -name "*.php" -not -path "./vendor/*" | xargs wc -l | tail -1

# 用 Python 3 一行命令启动一个临时的 HTTP 文件服务器
python3 -m http.server 8080

# 查看哪个进程占用了 80 端口
sudo lsof -i :80

# 生成一个 32 字节的 Base64 编码随机密码
openssl rand -base64 32

# 查看历史命令并执行第 N 条
history | grep "docker"
!42  # 执行历史记录中的第 42 条命令

# 找出磁盘占用最大的 20 个目录
du -ah / 2>/dev/null | sort -rh | head -20

# 使用 inotifywait 实时监控目录中的文件变化
inotifywait -m -r /var/www/html/

# 快速对比两个文件的差异
diff file_a.txt file_b.txt
colordiff file_a.txt file_b.txt  # 带颜色高亮的差异输出

# 使用 parallel 并行压缩所有日志文件（比逐个处理快很多）
parallel gzip ::: *.log
```

---

## 相关阅读

- [macOS 常用命令速查](/categories/macOS/common-commands/)
- [Homebrew 包管理器指南](/categories/macOS/brew/)
