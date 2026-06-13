---

title: Linux 基础命令速查：文件操作、进程管理与网络调试
keywords: [Linux, 基础命令速查, 文件操作, 进程管理与网络调试, 工程化]
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags:
- Linux
- 命令行
- DevOps
- 运维
- Shell
categories:
  - engineering
  - linux
date: 2019-03-20 15:05:07
description: Linux命令行是运维工程师和开发者日常工作的核心工具。本文系统整理了文件操作、网络调试、进程管理、磁盘存储、系统监控、权限管理等常用Linux命令，涵盖实用示例与真实踩坑案例，帮助你快速掌握DevOps与系统管理必备的命令行技能，提升服务器运维效率。
---


## 基础命令速查

[参考](https://mp.weixin.qq.com/s/LxuwP-f-PivzmaKeN5bcZA)

| 命令                                                         | 释义                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `shutdown -h now`                                            | 关机                                                         |
| `shutdown -r now`                                            | 重启                                                         |
| `uname -a`                                                   | 查看系统内核信息                                             |
| cat /proc/version                                            | 查看系统内核版本                                             |
| env                                                          | 查看当前用户的环境变量                                       |
| cat /proc/cpuinfo                                            | 查看系统内存信息                                             |
| cat /proc/cpuinfo \| grep name \| cut -f2 -d: \| uniq -c     | 查看有几个逻辑CPU及型号                                      |
| cat /proc/cpuinfo \| grep physical \| uniq -c                | 查看有几颗CPU，每颗分别是几核                                |
| getconf LONG_BIT                                             | 查看当前CPU运行在32bit                                       |
| cat /proc/cpuinfo \| grep flags \| grep ' lm ' \| wc -l      | 结果大于0，说明支持64bit                                     |
| ln -s /usr/local/jdk1.8 jdk                                  | 建立软连接                                                   |
| rpm -qa \| grep 软件名                                       | 查看是否通过rpm安装了该软件                                  |
| ssh-keygen -t rsa -C your_email@example.com                  | 创建sshkey                                                   |
| alias ll='ls -alF'                                           | 在各个用户的.bash_profile中添加重命名配置                    |
| sudo ntpdate -u ntp.api.bz                                   | 同步服务器时间                                               |
| nohup xxx &                                                  | 后台运行,并且有nohup.out输出                                 |
| nohup xxx > /dev/null &                                      | 后台运行, 不输出任何日志                                     |
| nohup xxx >out.log 2>&1 &                                    | 后台运行, 并将错误信息做标准输出到日志中                     |
| pkill -kill -t [TTY]                                         | 命令来完成强制活动用户退出.其中TTY表示终端名称               |
| which <命令>                                                 | 查看命令路径                                                 |
| ulimit -n                                                    | 查看进程所有打开最大fd数                                     |
| vim /etc/resolv.conf                                         | 配置dns                                                      |
| nslookup google.com                                          | 查看域名路由表                                               |
| last -n 5                                                    | 最近登录信息列表                                             |
| ifconfig em1 192.168.5.177 netmask 255.255.255.0             | 设置固定ip                                                   |
| ps eww -p XXXXX(进程号)                                      | 查看进程内加载的环境变量                                     |
| ps auwxf                                                     | 查看进程树找到服务器进程                                     |
| cd /proc/xxx(进程号)                                         | 查看进程启动路径                                             |
| useradd 用户名 && passwd 用户名                              | 添加用户                                                     |
| vim /etc/sudoers                                             | 配置sudo权限                                                 |
| ps aux \| grep xxx \| grep -v grep \| awk '{print $2}' \| xargs kill -9 | 强制关闭进程名包含xxx的所有进程                              |
| :%s/x/y/g                                                    | normal模式下 g表示全局, x表示查找的内容, y表示替换后的内容   |
| mount                                                        | 查看磁盘挂载情况                                             |
| df                                                           | 查看磁盘分区信息                                             |
| du -H -h                                                     | 查看目录及子目录大小                                         |
| du -sh *                                                     | 查看当前目录下各个文件, 文件夹占了多少空间, 不会递归         |
| wc -l filename                                               | 查看文件里有多少行                                           |
| wc -w filename                                               | 看文件里有多少个word                                         |
| wc -L filename                                               | 文件里最长的那一行是多少个字                                 |
| wc -c                                                        | 统计字节数                                                   |
| tar czvf xxx.tar                                             | 压缩目录                                                     |
| zip -r xxx.zip                                                | 压缩目录                                                     |
| tar zxvf xxx.tar                                             |                                                              |
| tar zxvf xxx.tar -C /xxx/yyy/                                | 解压到指定文件夹                                             |
| unzip xxx.zip                                                |                                                              |
| chown eagleye.eagleye xxx.log                                | 变更文件所属用户, 用户组                                     |
| cp xxx.log                                                   | 复制                                                         |
| cp -f xxx.log                                                | 复制并强制覆盖同名文件                                       |
| cp -r xxx(源文件夹) yyy(目标文件夹)                          | 复制文件夹                                                   |
| scp -P ssh端口 username@10.10.10.101:/home/username/xxx /home/xxx | 远程复制                                                     |
| mkdir -p /xxx/yyy/zzz                                        | 级联创建目录                                                 |
| mkdir -p src/{test,main}/{java,resources}                    | 批量创建文件夹, 会在test,main下都创建java, resources文件夹   |
| diff -u 1.txt 2.txt                                          | 比较两个文件                                                 |
| tail -f xxx.log \| pv -bt                                    | 如果做性能测试, 可以每执行一次, 往日志里面输出 "." , 这样日志中的字节数就是实际的性能测试运行的次数, 还可以看见实时速率. |
| cat -v xxx.sh                                                | 查看特殊字符                                                 |
| sed -i 's/^M//g' env.sh 去除文件的特殊字符, 比如^M: 需要这样输入: ctrl+v+enter | 去除特殊字符                                                 |
| cat file.sh > file.sh_bak                                    | 可以转换为该系统下的文件格式                                 |
| cat > file1.sh                                               | 先将file.sh中文件内容复制下来然后运行, 然后粘贴内容, 最后ctrl + d 保存退出 |
| :set fileencodings=utf-8 ，然后 w （存盘）一下即可转化为 utf8 格式，<br/>:set fileformat=unix | 在vim中通过如下设置文件编码和文件格式                        |
| find . -name "*.sh" \| xargs dos2unix                        | 在mac下使用dos2unix进行文件格式化                            |
| awk '{print $0}' xxx.log \| tee test.log                     | 重定向的同时输出到屏幕                                       |
| grep -v xxx                                                  | 反向匹配, 查找不包含xxx的内容                                |
| grep -v '^$'                                                  | 排除所有空行                                                 |
| grep -n "^$" 111.txt                                         | 返回结果 2,则说明第二行是空行                                |
| awk -F ':' '{if ($5 ~ /user/) print $0}' /etc/passwd         | 以':' 为分隔符,如果第五域有user则输出该行                    |
| awk -v RS='character' 'END {print --NR}' xxx.txt             | 统计单个文件中某个字符（串）(中文无效)出现的次数             |
| find /home/eagleye -name '*.mysql' -print                    | 在目录下找后缀是.mysql的文件                                 |
| find /doc -name '*bak' -exec rm {} \;                        | 会从 /doc 目录开始往下找，找到凡是文件名结尾为 bak的文件，把它删除掉。-exec 选项是执行的意思，rm 是删除命令，{ } 表示文件名，"\;"是规定的命令结尾 |
| lsof -i:port                                                 | 查看什么进程使用了该端口                                     |
| /sbin/ifconfig -a \| grep inet \| grep -v 127.0.0.1 \| grep -v inet6 \| awk '{print $2}' \| tr -d "addr:" | 获取本机ip地址                                               |
| service iptables status                                      | 查看iptables状态                                             |
| iptables -I INPUT -s \*\*\*.\*\*\*.\*\*\*.\*\*\*  -j DROP   | 要封停一个ip                                                 |
| iptables -D INPUT -s \*\*\*.\*\*\*.\*\*\*.\*\*\*  -j DROP   | 要解封一个IP                                                 |
| /etc/init.d/iptables status \| start \| stop \| restart      | 防火墙查看状态、开启、关闭、重启                             |
| nc 192.168.0.11 8000 < data.txt                              | 给某一个endpoint发送TCP请求,就将data的内容发送到对端         |
| tcpdump -i em1 tcp port 12301 -s 1500 -w abc.pcap            | dump出本机12301端口的tcp包                                   |
| traceroute -I www.163.com                                    | traceroute默认使用udp方式, 如果是-I则改成icmp方式            |
| netstat -n \| awk '/^tcp/ {n=split($(NF-1),array,":");if(n<=2)++S[array[(1)]];else++S[array[(4)]];++s[$NF];++N} END {for(a in S){printf("%-20s %s\n", a, S[a]);++I}printf("%-20s %s\n","TOTAL_IP",I);for(a in s) printf("%-20s %s\n",a, s[a]);printf("%-20s %s\n","TOTAL_LINK",N);}' | 输出每个ip的连接数，以及总的各个状态的连接数                 |
| top                                                          | 监控linux性能命令                                            |
| dmesg                                                        | 查看系统日志                                                 |
| iostat -xz 1                                                 | 磁盘IO情况监控                                               |
| free -m                                                      | 内存使用情况                                                 |

---

## 常用文件操作

### 查找文件

```bash
# 按文件名查找
find /var/log -name "*.log" -type f

# 按大小查找（大于100MB的文件）
find / -size +100M -type f 2>/dev/null

# 按修改时间查找（7天内修改过的文件）
find /home -mtime -7 -type f

# 查找并批量删除（交互式确认）
find /tmp -name "*.tmp" -mtime +30 -ok rm {} \;

# locate 快速查找（需要先 updatedb）
locate nginx.conf
```

### 文件内容搜索

```bash
# 递归搜索目录中包含关键字的文件
grep -rn "ERROR" /var/log/ --include="*.log"

# 只显示匹配的文件名
grep -rl "TODO" ./src/

# 显示匹配行的前后3行上下文
grep -C 3 "Exception" app.log

# 使用正则匹配IP地址
grep -oP '\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}' access.log

# 统计关键字出现次数
grep -c "404" access.log
```

### 文件权限与属性

```bash
# 查看文件详细信息
ls -lah /etc/nginx/nginx.conf

# 递归修改目录权限
chmod -R 755 /var/www/html/

# 递归修改所有者
chown -R www-data:www-data /var/www/html/

# 设置 SUID（以文件所有者身份执行）
chmod u+s /usr/bin/passwd

# 设置 SGID（目录下新建文件继承组）
chmod g+s /shared/project/
```

### 批量操作

```bash
# 批量重命名：将 .txt 改为 .md
for f in *.txt; do mv "$f" "${f%.txt}.md"; done

# 批量查找并替换文件内容
find . -name "*.conf" -exec sed -i 's/old_value/new_value/g' {} +

# 统计当前目录下各类型文件数量
find . -type f | sed 's/.*\.//' | sort | uniq -c | sort -rn

# 查找重复文件（基于 MD5）
find . -type f -exec md5sum {} \; | sort | uniq -w32 -dD
```

---

## 网络调试

### 网络连通性测试

```bash
# 测试端口连通性
nc -zv 192.168.1.100 80

# curl 测试 HTTP 响应
curl -o /dev/null -s -w "HTTP Code: %{http_code}\nTime: %{time_total}s\n" https://example.com

# 查看 DNS 解析过程
dig +trace example.com

# 批量测试多个端口
nc -zv 192.168.1.100 22 80 443 3306
```

### 网络抓包分析

```bash
# 抓取指定主机的 HTTP 流量
tcpdump -i eth0 host 192.168.1.100 and tcp port 80 -A

# 抓取 DNS 查询
tcpdump -i eth0 port 53 -n

# 抓取前100个包保存到文件
tcpdump -i eth0 -c 100 -w capture.pcap

# 读取 pcap 文件并过滤
tcpdump -r capture.pcap 'tcp port 443'
```

### 连接状态分析

```bash
# 查看所有 TCP 连接状态统计
ss -ant | awk '{print $1}' | sort | uniq -c | sort -rn

# 查看指定端口的连接数
ss -ant | grep ':80' | wc -l

# 查看 TIME_WAIT 状态连接数
ss -ant | grep TIME-WAIT | wc -l

# 实时监控网络连接变化
watch -n 1 "ss -ant | awk '{print \$1}' | sort | uniq -c | sort -rn"
```

### 防火墙与安全

```bash
# iptables 常用操作
iptables -L -n -v                           # 查看规则及流量统计
iptables -A INPUT -p tcp --dport 22 -j ACCEPT  # 允许 SSH
iptables -A INPUT -p tcp --dport 80 -j ACCEPT  # 允许 HTTP
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT  # 允许已建立连接
iptables -P INPUT DROP                      # 默认拒绝入站

# firewalld（CentOS 7+）
firewall-cmd --list-all                     # 查看当前区域规则
firewall-cmd --add-port=8080/tcp --permanent  # 永久开放端口
firewall-cmd --reload                       # 重载规则

# 查看端口占用并终止进程
lsof -i:8080
fuser -k 8080/tcp
```

---

## 进程管理

### 进程查看与控制

```bash
# 查看进程树（显示父子关系）
pstree -p

# 按 CPU 使用率排序显示进程
ps aux --sort=-%cpu | head -20

# 按内存使用率排序
ps aux --sort=-%mem | head -20

# 查看指定进程的线程数
ps -eLf | grep nginx | wc -l

# 查看进程打开的文件描述符
ls -la /proc/<PID>/fd | wc -l

# 查看进程的网络连接
ss -tlnp | grep <PID>
```

### 服务管理

```bash
# systemctl 常用操作（systemd）
systemctl status nginx                    # 查看服务状态
systemctl restart php-fpm                 # 重启服务
systemctl enable nginx                    # 设置开机自启
systemctl disable postfix                 # 禁止开机自启
systemctl list-units --type=service --state=running  # 列出运行中的服务

# 查看服务启动日志
journalctl -u nginx --since "1 hour ago"

# 查看服务依赖关系
systemctl list-dependencies nginx.service
```

### 后台任务管理

```bash
# 将当前前台任务放到后台（Ctrl+Z 后执行）
bg %1

# 查看后台任务列表
jobs -l

# 将后台任务调回前台
fg %1

# 使用 screen 保持会话
screen -S mysession                      # 创建会话
screen -ls                               # 列出会话
screen -r mysession                      # 恢复会话

# 使用 tmux（推荐替代 screen）
tmux new -s work                         # 创建会话
tmux attach -t work                      # 恢复会话
tmux ls                                  # 列出会话
```

---

## 磁盘与存储

### 磁盘使用分析

```bash
# 查看磁盘空间使用情况（人类可读）
df -hT

# 查看指定目录占用空间
du -sh /var/log/*

# 查找大于 500MB 的目录
du -h --max-depth=2 / 2>/dev/null | awk '$1 ~ /[0-9]*G/ || ($1 ~ /[0-9]*M/ && $1+0 > 500)' | sort -rh

# 查看 inode 使用情况（inode 耗尽也会导致无法写入）
df -i

# 清理日志的常用命令
journalctl --vacuum-size=500M            # 限制 systemd 日志大小
find /var/log -name "*.gz" -mtime +30 -delete  # 删除30天前的压缩日志
```

### 磁盘 IO 监控

```bash
# 查看磁盘 IO 实时统计
iostat -xz 1 5

# 使用 iotop 查看哪个进程在写磁盘
iotop -oP

# 查看磁盘设备信息
lsblk -f

# 查看磁盘 SMART 信息
smartctl -a /dev/sda
```

### 挂载管理

```bash
# 查看当前挂载
mount | column -t

# 临时挂载
mount /dev/sdb1 /mnt/data

# 查看 /etc/fstab 中的挂载配置
cat /etc/fstab

# 重新挂载（使 fstab 生效）
mount -a

# 查看 NFS 挂载
showmount -e nfs-server-ip
```

---

## 系统监控

### CPU 与内存

```bash
# 查看 CPU 使用率详情（多核）
mpstat -P ALL 1

# 查看内存使用详情
free -h

# 查看内存使用最多的前10个进程
ps aux --sort=-%mem | head -11

# 查看 swap 使用情况
swapon --show

# 查看系统负载（1/5/15分钟平均值）
uptime
cat /proc/loadavg
```

### 综合监控

```bash
# htop（增强版 top，需安装）
htop

# vmstat 查看系统整体性能
vmstat 1 10

# sar 系统活动报告（需安装 sysstat）
sar -u 1 5                                # CPU 使用率
sar -r 1 5                                # 内存使用
sar -n DEV 1 5                            # 网络接口流量
sar -d 1 5                                # 磁盘 IO

# 查看系统运行时间与用户数
w
```

> top

| 列名    | 含义                                                         |
| :------ | :----------------------------------------------------------- |
| PID     | 进程id                                                       |
| PPID    | 父进程id                                                     |
| RUSER   | Real user name                                               |
| UID     | 进程所有者的用户id                                           |
| USER    | 进程所有者的用户名                                           |
| GROUP   | 进程所有者的组名                                             |
| TTY     | 启动进程的终端名。不是从终端启动的进程则显示为 ?             |
| PR      | 优先级                                                       |
| NI      | nice值。负值表示高优先级，正值表示低优先级                   |
| P       | 最后使用的CPU，仅在多CPU环境下有意义                         |
| %CPU    | 上次更新到现在的CPU时间占用百分比                            |
| TIME    | 进程使用的CPU时间总计，单位秒                                |
| TIME+   | 进程使用的CPU时间总计，单位1/100秒                           |
| %MEM    | 进程使用的物理内存百分比                                     |
| VIRT    | 进程使用的虚拟内存总量，单位kb。VIRT=SWAP+RES                |
| SWAP    | 进程使用的虚拟内存中，被换出的大小，单位kb。                 |
| RES     | 进程使用的、未被换出的物理内存大小，单位kb。RES=CODE+DATA    |
| CODE    | 可执行代码占用的物理内存大小，单位kb                         |
| DATA    | 可执行代码以外的部分(数据段+栈)占用的物理内存大小，单位kb    |
| SHR     | 共享内存大小，单位kb                                         |
| nFLT    | 页面错误次数                                                 |
| nDRT    | 最后一次写入到现在，被修改过的页面数。                       |
| S       | 进程状态。D=不可中断的睡眠状态,R=运行,S=睡眠,T=跟踪/停止,Z=僵尸进程 |
| COMMAND | 命令名/命令行                                                |
| WCHAN   | 若该进程在睡眠，则显示睡眠中的系统函数名                     |
| Flags   | 任务标志，参考 sched.h                                       |

---

## 权限管理

### 用户与组管理

```bash
# 查看当前用户信息
id
whoami

# 查看所有用户
cat /etc/passwd

# 查看用户所属组
groups username
id username

# 添加用户并指定 home 目录和 shell
useradd -m -s /bin/bash -G sudo deploy

# 修改用户密码
passwd deploy

# 锁定/解锁用户账户
usermod -L deploy                      # 锁定
usermod -U deploy                      # 解锁

# 删除用户及其 home 目录
userdel -r olduser

# 添加组
groupadd developers

# 将用户加入组
usermod -aG developers deploy
```

### sudo 权限配置

```bash
# 编辑 sudoers 文件（推荐使用 visudo，有语法检查）
visudo

# 允许用户执行所有命令（需要密码）
deploy ALL=(ALL) ALL

# 允许用户无密码执行所有命令
deploy ALL=(ALL) NOPASSWD: ALL

# 允许用户只执行特定命令
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart nginx, /usr/bin/systemctl restart php-fpm

# 查看当前用户的 sudo 权限
sudo -l
```

### 文件权限深入

```bash
# 权限数字对照：r=4, w=2, x=1
# 常见权限组合：
# 644 = rw-r--r--  （文件默认）
# 755 = rwxr-xr-x  （目录默认）
# 600 = rw-------  （私密文件）
# 700 = rwx------  （私密目录）

# 使用字母设置权限
chmod u+x script.sh                    # 给所有者添加执行权限
chmod go-w config.txt                   # 移除组和其他人的写权限
chmod a+r public.txt                    # 给所有人添加读权限

# 设置 ACL（更细粒度的权限控制）
setfacl -m u:deploy:rwx /var/www/html  # 给特定用户设置权限
getfacl /var/www/html                   # 查看 ACL 权限

# 查看文件特殊权限
ls -la /usr/bin/passwd                  # 注意 s 标志（SUID）
```

---

## 踩坑案例

### 案例一：rm -rf 的致命误操作

**场景**：在脚本中使用变量拼接删除路径，变量为空时导致灾难性后果。

```bash
# 危险写法！如果 $DIR 为空，实际执行的是 rm -rf /
DIR=""
rm -rf $DIR/

# 安全写法：始终加引号，并设置 nounset
set -euo pipefail
DIR="${1:?Usage: $0 <directory>}"
rm -rf "$DIR/"
```

**教训**：Shell 脚本中变量务必加双引号，生产环境执行删除前先 `echo` 确认命令。

### 案例二：nohup 进程被 OOM Killer 杀死

**场景**：使用 `nohup` 运行 Java 服务，第二天发现进程消失了，`nohup.out` 中无错误。

```bash
# 排查步骤
dmesg | grep -i "oom"                    # 检查是否被 OOM Killer 杀死
grep -i "oom" /var/log/messages          # 系统日志中查找
journalctl -k | grep -i "oom"           # systemd 日志中查找
```

**解决方案**：
```bash
# 调整 OOM 优先级（-1000 表示不可被杀）
echo -1000 > /proc/<PID>/oom_score_adj

# 或者使用 systemd 管理服务，自动重启
# [Service]
# Restart=always
# RestartSec=5
```

### 案例三：磁盘空间满但 df 显示还有空间

**场景**：应用报 "No space left on device"，但 `df -h` 显示磁盘只用了 80%。

```bash
# 原因一：inode 耗尽
df -i                                    # 查看 inode 使用率

# 原因二：已删除文件仍被进程持有
lsof | grep deleted                      # 查找被删除但未释放的文件
# 解决：重启持有该文件的进程

# 原因三：挂载点覆盖
# 新写入的文件实际写到了另一个挂载点
mount | grep /data
```

### 案例四：SSH 连接突然断开

**场景**：SSH 连接服务器执行长时间任务，中途断开导致任务中断。

```bash
# 解决方案一：在 SSH 配置中设置保活
# ~/.ssh/config
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3

# 解决方案二：服务端配置
# /etc/ssh/sshd_config
ClientAliveInterval 60
ClientAliveCountMax 3

# 解决方案三：使用 tmux/screen（推荐）
tmux new -s deploy
# 即使 SSH 断开，tmux 中的任务继续运行
# 重新连接后：tmux attach -t deploy
```

### 案例五：find + xargs 文件名含空格导致命令失败

```bash
# 错误写法：文件名含空格会参数错乱
find . -name "*.log" | xargs rm

# 正确写法：使用 -print0 和 -0
find . -name "*.log" -print0 | xargs -0 rm

# 或者使用 -exec
find . -name "*.log" -exec rm {} +
```

### 案例六：crontab 环境变量与交互式 Shell 不同

**场景**：命令在终端手动执行正常，放到 crontab 中却失败。

```bash
# 原因：crontab 环境变量极简，PATH 不完整
# 在 crontab 中指定完整路径
0 2 * * * /usr/bin/python3 /opt/scripts/backup.py >> /var/log/backup.log 2>&1

# 或者在 crontab 开头设置环境变量
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SHELL=/bin/bash
0 2 * * * python3 /opt/scripts/backup.py
```

---

## 常用组合技巧

### 日志分析

```bash
# 实时统计 Nginx 访问日志中各状态码数量
tail -f access.log | awk '{print $9}' | sort | uniq -c | sort -rn

# 统计过去1小时访问量 Top 10 的 IP
awk -v d="$(date -d '1 hour ago' '+%d/%b/%Y:%H')" '$4 ~ d {print $1}' access.log | sort | uniq -c | sort -rn | head -10

# 查找慢请求（响应时间 > 3秒）
awk '$NF > 3.0 {print $0}' access.log

# 统计每小时请求量
awk '{print $4}' access.log | cut -d: -f2 | sort | uniq -c
```

### 系统排查流程速查

```bash
# 1. 系统负载高排查
uptime                                   # 查看负载
top                                      # 找到占用 CPU 的进程
vmstat 1 5                               # 查看是否 IO 等待
iostat -xz 1 3                           # 磁盘 IO 情况

# 2. 内存不足排查
free -h                                  # 查看内存使用
ps aux --sort=-%mem | head -10           # 找到内存大户
dmesg | grep -i "oom"                    # 是否触发 OOM

# 3. 网络不通排查
ping gateway-ip                          # 网关是否通
traceroute target-ip                     # 路径追踪
ss -ant | grep ":80"                     # 端口是否监听
curl -v http://localhost:80              # 本地服务是否正常
```

---

## 相关阅读

- [Linux 运维与 Shell 完全指南：权限、命令、进程管理与网络调试](/categories/Engineering/linux/)
- [Git基础命令与工作流实战指南](/categories/Engineering/git/)
- [Kubernetes-HPA-实战-Laravel-应用自动扩缩容策略与踩坑记录](/categories/Engineering/kubernetes-hpa-guide-laravel/)
