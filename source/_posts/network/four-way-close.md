---

title: TCP四次挥手详解：状态转换、抓包分析与常见面试题
keywords: [TCP, 四次挥手详解, 状态转换, 抓包分析与常见面试题, 网络]
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- TCP
- 网络协议
- 四次挥手
- 网络编程
- 面试题
- Wireshark
categories:
  - network
date: 2017-03-20 15:05:07
description: TCP四次挥手是连接关闭的核心机制，客户端与服务端通过四次报文交换安全终止全双工连接。本文深入解析FIN_WAIT_1、FIN_WAIT_2、CLOSE_WAIT、TIME_WAIT、LAST_ACK等状态转换过程，分析大量CLOSE_WAIT的成因与排查方案，介绍netstat/ss命令实战技巧，对比三次握手与四次挥手的设计差异，并提供Laravel连接池与优雅关闭的最佳实践，帮助开发者全面掌握TCP连接关闭原理与网络编程调试能力。
---



## 四次挥手概述

TCP 连接是全双工的，因此每个方向必须单独进行关闭。当一方完成数据发送任务后，即可发送一个 FIN 报文来终止这个方向的连接。收到 FIN 后，接收方不再接收数据，但仍可以发送数据。因此关闭一个 TCP 连接需要四次挥手。

![img](/images/四次挥手.png)

## 详细过程与状态转换

### 第一次挥手（FIN）

客户端设置 seq 和 ACK，向服务器发送一个 FIN（终结）报文段。此时客户端进入 `FIN_WAIT_1` 状态，表示客户端没有数据要发送给服务端了。

```
客户端 → 服务端: FIN, seq=u
客户端状态: ESTABLISHED → FIN_WAIT_1
服务端状态: ESTABLISHED（不变）
```

### 第二次挥手（ACK）

服务端收到了客户端发送的 FIN 报文段，向客户端回一个 ACK 报文段，确认号为 u+1。

```
服务端 → 客户端: ACK, seq=v, ack=u+1
服务端状态: ESTABLISHED → CLOSE_WAIT
客户端状态: FIN_WAIT_1 → FIN_WAIT_2
```

此时客户端到服务端的连接已经释放，TCP 连接处于**半关闭**状态。客户端已经没有数据要发送，但如果服务端还有数据要发送，客户端仍然可以接收。

### 第三次挥手（FIN）

服务端向客户端发送 FIN 报文段，请求关闭连接，同时服务端进入 `LAST_ACK` 状态。

```
服务端 → 客户端: FIN, seq=w, ack=u+1
服务端状态: CLOSE_WAIT → LAST_ACK
客户端状态: FIN_WAIT_2（不变）
```

### 第四次挥手（ACK）

客户端收到服务端发送的 FIN 报文段后，向服务端发送 ACK 报文段，然后客户端进入 `TIME_WAIT` 状态。服务端收到客户端的 ACK 报文段后关闭连接。

```
客户端 → 服务端: ACK, seq=u+1, ack=w+1
客户端状态: FIN_WAIT_2 → TIME_WAIT → CLOSED
服务端状态: LAST_ACK → CLOSED
```

客户端等待 **2MSL**（Maximum Segment Lifetime，一个片段在网络中最大的存活时间，通常为 2 分钟）后依然没有收到回复，则说明服务端已经正常关闭，此时客户端关闭连接。

### 完整状态转换图

```
        客户端                           服务端
        ------                           ------
      ESTABLISHED                      ESTABLISHED
           |                                |
           |--- FIN (seq=u) -------------> |
           |                                |
      FIN_WAIT_1                          |
           |                                |
           |<-- ACK (ack=u+1) ----------  |
           |                           CLOSE_WAIT
      FIN_WAIT_2                          |
           |                                |
           |<-- FIN (seq=w) ------------  |
           |                                |
           |--- ACK (ack=w+1) ----------> |
           |                           LAST_ACK
       TIME_WAIT                           |
           |                                |
       (等待2MSL)                           |
           |                                |
         CLOSED                          CLOSED
```

## 关键状态深入说明

### TIME_WAIT 状态

`TIME_WAIT` 存在于主动关闭方，持续时间为 **2MSL**（Linux 下通常为 60 秒）。存在两个原因：

1. **确保最后一个 ACK 能到达**：如果服务端没有收到最后的 ACK，会重发 FIN。客户端在 TIME_WAIT 期间可以重新发送 ACK。
2. **让旧连接的报文在网络中过期**：防止延迟到达的数据包被新连接误收。

#### TIME_WAIT 过多的危害

- 占用端口资源（默认端口范围有限）
- 每个 TIME_WAIT 占用少量内存（约 300 字节）
- 端口耗尽时新连接无法建立

#### 解决方案

```bash
# 查看当前 TIME_WAIT 数量
ss -tan state time-wait | wc -l

# 调整内核参数（/etc/sysctl.conf）
# 开启 TIME_WAIT 快速回收
net.ipv4.tcp_tw_reuse = 1
# 允许 TIME_WAIT 状态的 socket 被快速回收
net.ipv4.tcp_fin_timeout = 30
# 增大可用端口范围
net.ipv4.ip_local_port_range = 1024 65535
```

### CLOSE_WAIT 状态

`CLOSE_WAIT` 存在于被动关闭方。当被动关闭方收到 FIN 但还没有调用 `close()` 关闭 socket 时，连接就处于 CLOSE_WAIT 状态。

**大量 CLOSE_WAIT 是线上最常见的问题之一**，通常意味着程序存在 Bug——没有正确关闭连接。

#### 大量 CLOSE_WAIT 的常见原因

1. **应用程序没有调用 close()**：代码中遗漏了连接关闭逻辑
2. **异常处理不当**：在 catch/except 块中没有关闭连接
3. **连接池配置问题**：连接池中的连接未被正确归还或销毁
4. **阻塞操作**：线程阻塞在读写操作上，无法执行到 close()
5. **长连接未设超时**：keep-alive 连接没有设置合理的超时时间

#### 排查步骤

```bash
# 查看 CLOSE_WAIT 数量
ss -tnp state close-wait | wc -l

# 查看哪些进程产生了 CLOSE_WAIT
ss -tnp state close-wait
# 输出示例：
# Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process
# 0      0      10.0.0.1:8080       10.0.0.2:54321     users:(("php-fpm",pid=1234,fd=23))

# 使用 netstat 查看（传统方式）
netstat -tnp | grep CLOSE_WAIT

# 统计各状态的连接数
ss -tan | awk '{print $1}' | sort | uniq -c | sort -rn
```

#### 解决方案

- 检查代码中所有创建连接的地方，确保在 finally 块中调用 close()
- 配置合理的连接超时和空闲超时
- 对连接池设置 `maxIdleTime` 和 `maxLifetime`
- 添加监控告警，当 CLOSE_WAIT 超过阈值时及时通知

### FIN_WAIT_2 状态

被动关闭方不关闭 socket 导致主动关闭方一直停留在 `FIN_WAIT_2`。Linux 提供了 `tcp_fin_timeout` 参数来控制 FIN_WAIT_2 的超时时间：

```bash
cat /proc/sys/net/ipv4/tcp_fin_timeout
# 默认值：60（秒）
```

### LAST_ACK 状态

被动关闭方在发送 FIN 后进入此状态，等待最后的 ACK 到达。收到 ACK 后立即变为 CLOSED。如果 ACK 丢失，被动关闭方会重传 FIN。

## netstat / ss 命令实战

### 查看所有连接状态统计

```bash
# 使用 ss（推荐，更快）
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c | sort -rn
#  156 ESTAB
#   23 TIME-WAIT
#    5 CLOSE-WAIT
#    2 LISTEN

# 使用 netstat
netstat -tan | awk '/^tcp/ {print $6}' | sort | uniq -c | sort -rn
```

### 查看特定端口的连接状态

```bash
ss -tnp '( dport = :80 or sport = :80 )'
ss -tn state established '( dport = :3306 )'
```

### 监控连接状态变化

```bash
# 每 2 秒刷新一次
watch -n 2 'ss -tan | awk "{print \$1}" | sort | uniq -c | sort -rn'
```

## 三次握手与四次挥手的对比

| 对比项 | 三次握手 | 四次挥手 |
|--------|----------|----------|
| 目的 | 建立连接 | 关闭连接 |
| 报文数量 | 3 次 | 4 次 |
| 状态变化 | SYN_SENT → ESTABLISHED | ESTABLISHED → CLOSED |
| 核心标志位 | SYN、ACK | FIN、ACK |
| 为什么不能合并 | 服务端的 SYN 和 ACK 可以同时发送 | 服务端可能还有数据未发完，ACK 和 FIN 需要分开发送 |
| 资源消耗 | 建立连接，分配资源 | 释放连接，回收资源 |
| 超时等待 | 无 | 2MSL（TIME_WAIT） |

三次握手时，服务端收到 SYN 后可以立即回复 SYN+ACK（因为建立连接时没有残留数据要发送）。而四次挥手时，服务端收到 FIN 后，可能还有数据没有发送完毕，所以先发 ACK，等数据发完再发 FIN，因此需要四次交互。

## HTTP 持久连接

如果有大量的连接，每次连接和关闭都要经历三次握手和四次挥手，这显然会造成性能低下。

HTTP 有一种叫做**长连接（keepalive connections）**的机制。它可以在传输数据后仍保持连接，当客户端需要再次获取数据时，直接使用刚刚空闲下来的连接而无需再次握手。

在 HTTP/1.1 中，默认启用持久连接。通过 `Connection: keep-alive` 头部控制：

```
# 请求头
Connection: keep-alive
Keep-Alive: timeout=5, max=100

# 关闭持久连接
Connection: close
```

HTTP/2 更进一步，使用**多路复用**技术，在单个 TCP 连接上并行处理多个请求/响应，大幅减少连接建立和关闭的开销。

## Laravel 中的连接池与优雅关闭

### Laravel 数据库连接管理

Laravel 默认每次请求结束后会关闭数据库连接。在使用连接池时需要注意：

```php
// config/database.php 中配置连接超时
'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST'),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    'options' => [
        PDO::ATTR_PERSISTENT => true,  // 持久连接
    ],
],
```

### Octane / Swoole 下的连接管理

Laravel Octane 使用 Swoole 作为运行时，连接不会在每个请求后关闭。需要特别注意：

```php
// 在 Octane 中，连接可能在请求间复用
// 需要处理连接断开后重连
use Illuminate\Support\Facades\DB;

// 监听请求结束事件，重置连接
app()->terminating(function () {
    DB::reconnect();
});
```

### 优雅关闭（Graceful Shutdown）

```bash
# Laravel Queue Worker 优雅关闭
php artisan queue:work --max-time=3600

# 发送 SIGTERM 信号
kill -SIGTERM <pid>

# Supervisor 配置
[program:laravel-worker]
command=php artisan queue:work
stopwaitsecs=3600
stopsignal=SIGTERM
```

在 `AppServiceProvider` 中注册关闭回调：

```php
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register()
    {
        $this->app->terminating(function () {
            // 确保所有数据库连接释放
            \DB::disconnect();
            // 刷新日志缓冲区
            \Log::getLogger()->close();
        });
    }
}
```

## 常见面试题

**Q1: 为什么建立连接是三次握手，关闭连接是四次挥手？**
建立连接时，服务端收到 SYN 后可以把 ACK 和 SYN 放在一个报文中发送。关闭连接时，服务端收到 FIN 后，可能还有数据没有发送完，所以只能先发 ACK，等数据发完再发 FIN。

**Q2: 如果已经建立了连接，但是客户端突然出现故障了怎么办？**
TCP 设有**保活计时器**（keepalive timer）。服务端每次收到客户端的数据后都会重置保活计时器。如果 2 小时内没有收到客户端的数据，服务端会发送探测报文段。若连续发送 10 个探测报文段仍无响应，则关闭连接。

**Q3: TIME_WAIT 需要等待 2MSL 的原因？**
第一，保证客户端发送的最后一个 ACK 能到达服务端（若丢失，服务端会重发 FIN）。第二，让本次连接的所有报文在网络中消失，防止影响新连接。

**Q4: 为什么 TIME_WAIT 是 2MSL 而不是 1MSL？**
1MSL 是报文单向最大存活时间。最后一个 ACK 从客户端到服务端最多需要 1MSL，如果服务端没收到会重发 FIN，FIN 从服务端到客户端又最多需要 1MSL，因此客户端需要等待 2MSL 来确保能收到可能的重传 FIN。

**Q5: 四次挥手中如果丢失了某个报文会怎样？**
- **第一次 FIN 丢失**：客户端重传 FIN（受重传定时器控制），直到收到 ACK 或超时。
- **第二次 ACK 丢失**：客户端收不到 ACK，重传 FIN。服务端重新发送 ACK。
- **第三次 FIN 丢失**：客户端等不到 FIN，由 `tcp_fin_timeout` 控制超时后关闭。
- **第四次 ACK 丢失**：服务端收不到 ACK，重传 FIN。客户端在 TIME_WAIT 期间重新发送 ACK。

**Q6: TCP 的半关闭（half-close）是什么？**
四次挥手过程中，客户端发送 FIN 后不再发送数据但仍能接收服务端数据，这就是半关闭状态（`FIN_WAIT_2`）。可以通过 `shutdown(fd, SHUT_WR)` 系统调用实现半关闭，只关闭写方向而不关闭读方向。

## tcpdump 抓包实战

以下是使用 tcpdump 抓取 TCP 四次挥手过程的实际示例：

```bash
# 抓取与目标服务器的挥手过程
tcpdump -i eth0 -nn host 192.168.1.100 and port 80
```

```
# 抓包输出示例（四次挥手）
21:04:01.123456 IP 192.168.1.50.45678 > 192.168.1.100.80: Flags [F.], seq 1001, ack 5001, win 256
21:04:01.124567 IP 192.168.1.100.80 > 192.168.1.50.45678: Flags [.], ack 1002, win 512
21:04:01.200000 IP 192.168.1.100.80 > 192.168.1.50.45678: Flags [F.], seq 5001, ack 1002, win 512
21:04:01.200123 IP 192.168.1.50.45678 > 192.168.1.100.80: Flags [.], ack 5002, win 256
```

> **Flags 说明**：`[F.]` 表示 FIN+ACK，`[.]` 表示纯 ACK。注意观察 seq/ack 号的递增关系。

### Wireshark 过滤技巧

```bash
# 在 Wireshark 中过滤 TCP 关闭过程
tcp.flags.fin == 1 || tcp.flags.reset == 1
# 只看挥手
tcp.flags.fin == 1
# 关闭连接的完整四步
tcp.stream eq N && (tcp.flags.fin == 1 || tcp.flags.ack == 1)
```

## 与其他协议关闭机制的对比

| 协议 | 关闭方式 | 报文数 | 特点 |
|------|---------|--------|------|
| TCP 四次挥手 | FIN/ACK 交互 | 4 次 | 全双工、半关闭、TIME_WAIT |
| HTTP/1.1 | Connection: close 头部 | - | 依赖底层 TCP 四次挥手 |
| HTTP/2 | GOAWAY 帧 | 1 帧 | 优雅关闭，允许在途请求完成 |
| WebSocket | Close 帧 | 2 次 | 双方各发一个 Close 帧 |
| UDP | 无连接，无需关闭 | 0 | 无状态，无连接维护开销 |

**关键区别**：
- **HTTP/2 GOAWAY**：服务端发送 GOAWAY 帧并携带最后处理的 stream ID，客户端知道哪些请求被处理、哪些需要重试，比 TCP 四次挥手更精细。
- **WebSocket Close**：双方各发一个 Close 控制帧（opcode=0x8），然后由底层 TCP 完成四次挥手。
- **UDP**：无连接协议，不需要关闭过程，但也无法保证数据可靠到达。

## 相关阅读

- [HTTP 三次握手](/network/three-way-handshake) — TCP 三次握手的详细过程与原理
- [TCP/IP](/network/tcp-ip) — TCP/IP 协议栈全面解析
- [UDP](/network/udp) — UDP 协议特点与应用场景
- [HTTP](/network/http) — HTTP 协议详解
- [Socket](/network/socket) — Socket 编程基础
- [网络编程](/network-programming) — 网络编程入门与实践
- [MySQL主从复制与读写分离](/categories/databases/replication/) — MySQL 主从复制架构与读写分离实践
- [MySQL的三种日志](/categories/databases/redo-log-binlog/) — redo log、undo log 与 binlog 详解
- [MySQL - 锁](/categories/databases/locking/) — MySQL 锁机制深度解析
