---

title: TCP 三次握手详解：SYN、SYN-ACK、ACK 的完整流程
keywords: [TCP, SYN, ACK, 三次握手详解, 的完整流程]
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- TCP
- 三次握手
- HTTP
- 网络协议
- 面试
- 抓包
categories:
- network
date: 2017-03-20 15:05:07
description: 深入解析TCP三次握手原理，包括SYN、ACK报文交互过程、状态转换（SYN_SENT、SYN_RCVD、ESTABLISHED）、抓包实战（tcpdump/Wireshark）及常见面试题。涵盖为什么不是两次握手、SYN Flood攻击防御、TCP与UDP对比等核心知识点，帮助你全面掌握HTTP网络协议中TCP连接建立的底层机制。
---



## 什么是 TCP 三次握手？

TCP（Transmission Control Protocol）是一种面向连接的、可靠的传输层协议。在 HTTP 通信中，客户端与服务器之间在传输数据之前，必须先通过 **三次握手（Three-Way Handshake）** 建立一条可靠的 TCP 连接。

<!-- more -->

## TCP 报文头部关键字段

在理解三次握手之前，需要先了解 TCP 报文头部中的几个关键标志位和字段：

| 字段 | 含义 |
|------|------|
| **SYN**（Synchronize） | 同步序号标志，用于发起连接请求。SYN=1 表示这是一个连接请求或连接接受报文 |
| **ACK**（Acknowledgment） | 确认标志，ACK=1 时 ack 字段才有效。TCP 规定连接建立后所有报文的 ACK 都必须为 1 |
| **FIN**（Finish） | 终止标志，FIN=1 表示发送方数据已发完，要求释放连接 |
| **seq**（Sequence Number） | 序号，标识本报文段所发送数据的第一个字节的编号 |
| **ack**（Acknowledgment Number） | 确认号，期望收到对方下一个报文段的第一个数据字节的编号，值为对方 seq + 1 |

### TCP 报文头结构图

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Source Port          |       Destination Port        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Sequence Number                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Acknowledgment Number                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Data |       |C|E|U|A|P|R|S|F|                               |
| Offset| Rsrvd |W|C|R|C|S|S|Y|I|            Window             |
|       |       |R|E|G|K|H|T|N|N|                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Checksum            |         Urgent Pointer        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Options (variable)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                             Data                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**关键标志位详解：**

- **SYN**（Synchronize）：同步序号，`SYN=1` 表示连接请求或连接接受
- **ACK**（Acknowledgment）：确认标志，`ACK=1` 时 ack 字段有效，连接建立后所有报文必须置 1
- **FIN**（Finish）：终止标志，`FIN=1` 表示发送方数据已发完，请求释放连接
- **RST**（Reset）：重置标志，`RST=1` 表示强制关闭连接，通常在异常情况下使用（如连接不存在、收到非法报文）
- **PSH**（Push）：推送标志，`PSH=1` 要求接收方尽快将数据交付应用层，不要等缓冲区满
- **URG**（Urgent）：紧急标志，`URG=1` 表示紧急指针字段有效，数据需优先处理

## 三次握手的详细过程

### 第一次握手

Client 将标志位 **SYN** 置为 `1`，随机产生一个初始序号 `seq = J`，并将该数据包发送给 Server。此时 Client 进入 **SYN_SENT** 状态（已发送同步请求，等待确认）。

```
Client → Server: SYN=1, seq=J
Client 状态: CLOSED → SYN_SENT
```

### 第二次握手

Server 收到数据包后，由标志位 `SYN=1` 得知 Client 请求建立连接。Server 将标志位 **SYN** 和 **ACK** 都置为 `1`，确认号 `ack = J + 1`，同时随机产生一个初始序号 `seq = K`，并将该数据包发送给 Client。此时 Server 进入 **SYN_RCVD** 状态（已收到同步请求并回复确认）。

```
Server → Client: SYN=1, ACK=1, seq=K, ack=J+1
Server 状态: CLOSED → SYN_RCVD
```

### 第三次握手

Client 收到确认后，检查 `ack` 是否为 `J + 1`、`ACK` 是否为 `1`。如果正确，则将标志位 **ACK** 置为 `1`，`ack = K + 1`，并将该数据包发送给 Server。Server 检查 `ack` 是否为 `K + 1`、`ACK` 是否为 `1`，如果正确则连接建立成功。

```
Client → Server: ACK=1, seq=J+1, ack=K+1
Client 状态: SYN_SENT → ESTABLISHED
Server 状态: SYN_RCVD → ESTABLISHED
```

此时 Client 和 Server 都进入 **ESTABLISHED** 状态，三次握手完成，双方可以开始传输数据。

![img](/images/三次握手.png)

### 三次握手完整流程图

```
    Client                                      Server
      |                                           |
      |   +-------+                               |
      |   | CLOSED|                               |   +-------+
      |   +---+---+                               |   | CLOSED|
      |       |                                   |   +---+---+
      |       |  服务器 bind/listen                |       |
      |       |  ─────────────────────────────>   |       |
      |       |                                   |   +---+---+
      |       |                                   |   | LISTEN|
      |       |                                   |   +---+---+
      |       |                                   |       |
      |   +---+--------+                          |       |
      |   | SYN_SENT   |                          |       |
      |   +---+--------+                          |       |
      |       |                                   |       |
      |       |  ① SYN=1, seq=J                   |       |
      |       |  ─────────────────────────────>   |       |
      |       |                                   |   +---+---------+
      |       |                                   |   | SYN_RCVD    |
      |       |                                   |   +---+---------+
      |       |                                   |       |
      |       |  ② SYN=1, ACK=1, seq=K, ack=J+1  |       |
      |       |  <─────────────────────────────   |       |
      |       |                                   |       |
      |   +---+-----------+                       |       |
      |   | ESTABLISHED   |                       |       |
      |   +---+-----------+                       |       |
      |       |                                   |       |
      |       |  ③ ACK=1, seq=J+1, ack=K+1       |       |
      |       |  ─────────────────────────────>   |       |
      |       |                                   |   +---+-----------+
      |       |                                   |   | ESTABLISHED   |
      |       |                                   |   +---+-----------+
      |       |                                   |       |
      |       |  ======= 数据传输开始 =======      |       |
      |       |                                   |       |
```

### 状态转换总结

```
Client:  CLOSED → SYN_SENT → ESTABLISHED
Server:  CLOSED → LISTEN → SYN_RCVD → ESTABLISHED
```

## 为什么要进行三次握手？

第三次握手是为了防止**失效的连接请求**到达服务器，让服务器错误打开连接。

客户端发送的连接请求如果在网络中滞留，那么就会隔很长一段时间才能收到服务器端发回的连接确认。客户端等待一个超时重传时间之后，就会重新请求连接。但是这个滞留的连接请求最后还是会到达服务器，如果不进行三次握手，那么服务器就会打开两个连接。

如果有第三次握手，客户端会忽略服务器之后发送的对滞留连接请求的连接确认，不进行第三次握手，因此就不会再次打开连接。

### 用打电话的例子理解三次握手

- **第一次握手**：A 给 B 打电话说：「你可以听到我说话吗？」
- **第二次握手**：B 收到了 A 的信息，然后对 A 说：「我可以听得到你说话啊，你能听得到我说话吗？」
- **第三次握手**：A 收到了 B 的信息，然后说：「可以的，我要给你发信息啦！」

**结论：** 在三次握手之后，A 和 B 都能确定一件事：我能听到你，你也能听到我。这样就可以开始正常通信了。

## 使用 tcpdump 抓包观察三次握手

在 Linux/macOS 上可以使用 `tcpdump` 抓取 TCP 三次握手过程：

```bash
# 抓取访问某个 HTTP 服务器的 TCP 握手包
sudo tcpdump -i eth0 -nn host example.com and port 80 -c 6

# 使用 curl 发起请求触发握手
curl http://example.com
```

抓包输出示例：

```
192.168.1.100.54321 > 93.184.216.34.80: Flags [S], seq 1234567890
93.184.216.34.80 > 192.168.1.100.54321: Flags [S.], seq 987654321, ack 1234567891
192.168.1.100.54321 > 93.184.216.34.80: Flags [.], ack 987654322
```

其中 `Flags [S]` 表示 SYN，`Flags [S.]` 表示 SYN+ACK，`Flags [.]` 表示 ACK。

### tcpdump 详细抓包示例（带注解）

下面是一个完整的 tcpdump 抓包示例，包含详细的时间戳、窗口大小和选项信息：

```bash
# 带详细输出的抓包命令（-v 显示更多信息，-S 显示绝对序列号）
sudo tcpdump -i eth0 -nn -v -S host 192.168.1.100 and 10.0.0.1 and port 80 -c 6
```

**抓包输出（带注解）：**

```
# 第一次握手：客户端 → 服务端（SYN）
# 客户端发起连接，初始序列号 seq=2093743273，窗口大小=65535，支持 MSS=1460
15:32:01.123456 IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF],
    proto TCP (6), length 64)
    192.168.1.100.54321 > 10.0.0.1.80: Flags [S], seq 2093743273,
    win 65535, options [mss 1460,sackOK,TS val 12345678 ecr 0,
    nop,wscale 7], length 0
    ~~~~~~~~~~~~~~~~
    ▲ 关键信息：
    - Flags [S]：SYN 标志位，表示这是一个连接请求
    - seq 2093743273：客户端随机生成的初始序列号(ISN)
    - win 65535：客户端通告的接收窗口大小（字节）
    - mss 1460：最大报文段长度（不含 TCP/IP 头部）
    - wscale 7：窗口缩放因子 7，实际窗口 = 65535 × 2^7 = 8,388,480 字节

# 第二次握手：服务端 → 客户端（SYN+ACK）
# 服务端确认客户端的 SYN，同时发送自己的 SYN，序列号 seq=954978827
15:32:01.125678 IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF],
    proto TCP (6), length 64)
    10.0.0.1.80 > 192.168.1.100.54321: Flags [S.], seq 954978827,
    ack 2093743274, win 65483, options [mss 1460,sackOK,
    TS val 87654321 ecr 12345678, nop,wscale 7], length 0
    ~~~~~~~~~~~~~~~~
    ▲ 关键信息：
    - Flags [S.]：SYN+ACK 标志位，同时完成确认和同步
    - seq 954978827：服务端随机生成的初始序列号
    - ack 2093743274：确认号 = 客户端 seq + 1，表示已收到客户端的 SYN
    - TS val/echo reply：时间戳，用于计算 RTT（往返时间）
    - 此处 RTT = 125678 - 123456 = 2.2ms

# 第三次握手：客户端 → 服务端（ACK）
# 客户端确认服务端的 SYN，连接建立完成
15:32:01.125890 IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF],
    proto TCP (6), length 52)
    192.168.1.100.54321 > 10.0.0.1.80: Flags [.], seq 2093743274,
    ack 954978828, win 502, options [nop,nop,TS val 12345680 ecr 87654321],
    length 0
    ~~~~~~~~~~~~~~~~
    ▲ 关键信息：
    - Flags [.]：纯 ACK 报文，确认服务端的 SYN
    - seq 2093743274：等于第二次握手中的 ack 值
    - ack 954978828：确认号 = 服务端 seq + 1
    - 三次握手完成，双方进入 ESTABLISHED 状态，可以开始传输数据
```

**常用 tcpdump 过滤技巧：**

```bash
# 只抓 SYN 包（观察连接发起）
sudo tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0'

# 只抓 RST 包（排查连接异常重置）
sudo tcpdump -i eth0 'tcp[tcpflags] & tcp-rst != 0'

# 抓取半连接（只有 SYN 没有 ACK 的包 - SYN Flood 排查）
sudo tcpdump -i eth0 'tcp[tcpflags] == tcp-syn'

# 统计某段时间内的连接建立数量（三次握手中的 SYN 数量）
sudo tcpdump -i eth0 -c 100 'tcp[tcpflags] & tcp-syn != 0 and tcp[tcpflags] & tcp-ack == 0' | wc -l
```

### Wireshark 详细抓包分析

**步骤：**

1. 打开 Wireshark，选择要监听的网卡
2. 设置显示过滤器：`tcp.flags.syn == 1 and tcp.flags.ack == 0` 只查看 SYN 包
3. 或使用组合过滤器：`tcp.flags.syn == 1 || tcp.flags.ack == 1` 查看握手全貌
4. 使用浏览器访问一个 HTTP 网站
5. 在抓包结果中可以看到三次握手的完整过程

**Wireshark 中观察到的关键信息：**

```
# Wireshark 详情面板（Packet Details）中需要关注的字段：

Frame 1: SYN
├── Transmission Control Protocol
│   ├── Source Port: 54321
│   ├── Destination Port: 80
│   ├── Sequence Number: 2093743273 (relative sequence number: 0)
│   ├── Flags: 0x002 (SYN)
│   │   ├── 0... .... = Reserved: Not set
│   │   ├── .0.. .... = Nonce: Not set
│   │   ├── ..0. .... = Congestion Window Reduced: Not set
│   │   ├── ...0 .... = ECN-Echo: Not set
│   │   ├── .... 0... = Urgent: Not set
│   │   ├── .... .0.. = Acknowledgment: Not set
│   │   ├── .... ..1. = Push: Not set          ← SYN=1
│   │   ├── .... ...0 = Reset: Not set
│   │   ├── .... ...1 = Syn: Set               ← SYN 标志位
│   │   └── .... .... = Fin: Not set
│   ├── Window Size Value: 65535
│   ├── TCP Options
│   │   ├── Maximum Segment Size: 1460 bytes
│   │   ├── Window Scale: 7 (multiply by 128)
│   │   ├── Timestamps: TSval=12345678, TSecr=0
│   │   └── SACK permitted
```

**Wireshark 过滤器速查表：**

| 用途 | 过滤器 |
|------|--------|
| 所有 SYN 包 | `tcp.flags.syn == 1` |
| 只有 SYN（无 ACK） | `tcp.flags.syn == 1 && tcp.flags.ack == 0` |
| 三次握手 | `tcp.flags.syn == 1 \|\| (tcp.flags.syn == 1 && tcp.flags.ack == 1) \|\| tcp.len == 0 && tcp.flags.ack == 1` |
| 异常 RST | `tcp.flags.reset == 1` |
| 跟踪一个 TCP 流 | 右键 → Follow → TCP Stream |
| 重传包 | `tcp.analysis.retransmission` |
| 乱序包 | `tcp.analysis.out_of_order` |
| 重复 ACK | `tcp.analysis.duplicate_ack` |

> **实战技巧：** 在 Wireshark 中，选中一个 SYN 包后，右键选择「Follow → TCP Stream」可以看到整个连接的完整数据交换，非常适合排查连接建立失败的问题。使用 `Statistics → Conversations → TCP` 可以查看所有 TCP 会话的统计信息，快速定位问题连接。

## 常见面试题

### 1. 为什么不是两次握手？

如果是两次握手，存在以下问题：

- **无法确认双方的接收能力**：两次握手只能确认 Client 能发送、Server 能接收，但无法确认 Client 能接收
- **历史重复连接问题**：如果 Client 发送的第一个 SYN 在网络中滞留，Client 超时后重发 SYN 并完成通信。之后滞留的 SYN 到达 Server，Server 误以为是新连接并直接分配资源，但 Client 并不知道也不会发送数据，造成资源浪费

### 2. 为什么不是四次握手？

理论上四次握手也可以建立连接（将 Server 的 SYN 和 ACK 分成两个报文发送），但完全没有必要。Server 的 SYN 和 ACK 可以合并在一个报文中发送，三次握手已足以确认双方的收发能力。更多的握手次数只会增加网络开销和延迟。

### 3. SYN Flood 攻击原理及防御

**攻击原理：** 攻击者伪造大量不存在的 IP 地址，向 Server 不断发送 SYN 包。Server 回复确认（SYN+ACK），但这些伪造的 IP 不会回复第三次握手。Server 会不断重试直到超时，这些半连接（SYN_RCVD 状态）会耗尽 Server 的资源，导致正常的连接请求无法被处理。

**防御方法：**

- **SYN Cookie**：Server 不为 SYN_RCVD 状态分配资源，而是通过源/目的 IP、端口和时间戳计算出一个 cookie 作为初始序号，只有收到正确的第三次握手才分配资源
- **增大半连接队列**：增大 `tcp_max_syn_backlog` 的值
- **缩短 SYN_RCVD 超时时间**：减少重试次数，加快释放半连接
- **防火墙限制**：限制单个 IP 的 SYN 请求频率

**SYN Flood 防御实战代码：**

**① iptables 限速规则：**

```bash
# 限制每个 IP 每秒最多 50 个 SYN 包，超过直接丢弃
iptables -A INPUT -p tcp --syn -m limit --limit 50/s --limit-burst 100 -j ACCEPT
iptables -A INPUT -p tcp --syn -j DROP

# 限制每个 IP 的并发 SYN 连接数为 100
iptables -A INPUT -p tcp --syn -m connlimit --connlimit-above 100 -j REJECT

# 针对特定端口（如 80）限制 SYN 请求速率
iptables -A INPUT -p tcp --dport 80 --syn -m limit --limit 100/s --limit-burst 200 -j ACCEPT
iptables -A INPUT -p tcp --dport 80 --syn -j DROP
```

**② 开启 SYN Cookie（Linux 内核级别防御）：**

```bash
# 开启 SYN Cookie（最有效的防御手段）
echo 1 > /proc/sys/net/ipv4/tcp_syncookies

# 调整相关参数
echo 2048 > /proc/sys/net/ipv4/tcp_max_syn_backlog    # 增大半连接队列
echo 2 > /proc/sys/net/ipv4/tcp_synack_retries        # 减少 SYN+ACK 重试次数
echo 1 > /proc/sys/net/ipv4/tcp_abort_on_overflow     # 队列满时直接 RST

# 查看当前半连接数（SYN_RECV 状态）
ss -n state syn-recv | wc -l
# 或使用 netstat
netstat -n | grep SYN_RECV | wc -l
```

**③ Nginx 层面防御：**

```nginx
# /etc/nginx/nginx.conf
http {
    # 限制单 IP 每秒连接数
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
    limit_req_zone  $binary_remote_addr zone=req_limit:10m rate=50r/s;

    server {
        listen 80;

        # 最大并发连接限制
        limit_conn conn_limit 100;

        # 请求速率限制（突发 200 个请求排队）
        limit_req zone=req_limit burst=200 nodelay;

        # 超时设置（加速释放异常连接）
        client_header_timeout 5s;
        client_body_timeout 10s;
        keepalive_timeout 30s;
    }
}
```

**④ 使用 Haproxy 进行 SYN 代理：**

```haproxy
# /etc/haproxy/haproxy.cfg
frontend http-in
    bind *:80
    # 启用 SYN 代理，在收到有效 SYN 后才与后端建立连接
    option tcp-smart-connect
    maxconn 100000
    default_backend servers

backend servers
    server web1 10.0.0.1:8080 check
    server web2 10.0.0.2:8080 check
```

**⑤ 监控和告警脚本：**

```bash
#!/bin/bash
# syn_flood_monitor.sh - SYN Flood 实时监控脚本

THRESHOLD=500  # SYN_RECV 状态阈值
LOG_FILE="/var/log/syn_monitor.log"

while true; do
    SYN_COUNT=$(ss -n state syn-recv | wc -l)
    if [ "$SYN_COUNT" -gt "$THRESHOLD" ]; then
        echo "$(date): WARNING - SYN_RECV count: $SYN_COUNT (threshold: $THRESHOLD)" >> "$LOG_FILE"
        # 可选：自动开启防护
        echo 1 > /proc/sys/net/ipv4/tcp_syncookies
        # 可选：发送告警邮件
        echo "SYN Flood detected: $SYN_COUNT half-open connections" | mail -s "SYN Flood Alert" admin@example.com
    fi
    sleep 5
done
```

### 4. 三次握手中如果丢包会怎样？

| 丢失的包 | 客户端行为 | 服务端行为 |
|---------|-----------|-----------|
| **第一次包（SYN）丢失** | 客户端重传 SYN，直到超时放弃连接 | 服务端无感知 |
| **第二次包（SYN+ACK）丢失** | 客户端重传 SYN（指数退避），超时后放弃 | 服务端保持 SYN_RCVD 状态，超时后释放 |
| **第三次包（ACK）丢失** | 客户端认为连接已建立，发送数据时会触发重传 | 服务端保持 SYN_RCVD 状态，重传 SYN+ACK，超时后释放 |

TCP 默认会进行多次重传（通常 5-6 次），采用**指数退避**策略，重传间隔依次为 1s、2s、4s、8s...

### 5. Linux 内核中与三次握手相关的参数有哪些？

以下参数对 TCP 三次握手性能和安全至关重要：

| 参数 | 作用 | 默认值 | 推荐值 |
|------|------|--------|--------|
| `tcp_max_syn_backlog` | SYN 半连接队列的最大长度 | 128~256（视内核版本） | 8192 或更高 |
| `somaxconn` | 全连接队列（accept queue）的最大长度 | 128 | 4096~65535 |
| `tcp_syncookies` | 是否开启 SYN Cookie 防御 SYN Flood | 0（关闭） | 1（开启） |
| `tcp_synack_retries` | SYN+ACK 的重试次数 | 5 | 2~3 |
| `tcp_abort_on_overflow` | 全连接队列满时是否直接 RST 拒绝 | 0（等待重试） | 0（建议保持默认） |

**查看当前值：**

```bash
sysctl net.ipv4.tcp_max_syn_backlog
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_syncookies
```

**临时修改：**

```bash
sudo sysctl -w net.ipv4.tcp_max_syn_backlog=8192
sudo sysctl -w net.core.somaxconn=4096
sudo sysctl -w net.ipv4.tcp_syncookies=1
```

**永久修改（写入 `/etc/sysctl.conf`）：**

```bash
echo "net.ipv4.tcp_max_syn_backlog = 8192" | sudo tee -a /etc/sysctl.conf
echo "net.core.somaxconn = 4096" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_syncookies = 1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

> **提示：** 在高并发 Web 服务器上（如 Nginx），`somaxconn` 默认值 128 远远不够，需要调大到 4096 以上，否则会出现大量连接超时和 SYN 被丢弃的问题。

## TCP 三次握手 vs 四次挥手对比

| 对比项 | 三次握手（建立连接） | 四次挥手（关闭连接） |
|--------|---------------------|---------------------|
| 报文数量 | 3 个 | 4 个 |
| 目的 | 建立可靠的双向连接 | 优雅地关闭双向连接 |
| 发起方 | 客户端先发起 | 任一方均可发起 |
| 关键标志 | SYN、ACK | FIN、ACK |
| 超时重传 | SYN 丢失时重传 | FIN/ACK 丢失时重传 |
| 等待时间 | 无额外等待 | TIME_WAIT 等待 2MSL |
| 状态转换 | CLOSED → SYN_SENT → SYN_RCVD → ESTABLISHED | ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED |
| 为什么需要 | 双方都需要确认对方的收发能力 | TCP 是全双工的，双方需各自关闭发送通道 |
| 资源分配 | 第二次握手后服务端分配资源 | 第二次挥手后客户端不再发送数据 |

**核心区别：** 三次握手中 Server 的 SYN 和 ACK 合并发送（第 2 步），所以只需 3 次；而四次挥手中 Server 收到 FIN 后可能还有数据未发送完毕，不能立即将 FIN 和 ACK 合并，因此需要 4 次。

## 常见面试题补充

### TCP 中的 TIME_WAIT 状态是什么？

- **定义：** 主动关闭方在发送最后一个 ACK 后进入 TIME_WAIT 状态，等待 **2MSL**（Maximum Segment Lifetime，通常为 60 秒）后才关闭
- **存在的意义：**
  1. **确保最后一个 ACK 能到达对方**：如果 ACK 丢失，对方会重发 FIN，TIME_WAIT 状态可以处理这种情况
  2. **防止旧连接的数据干扰新连接**：确保本连接中所有报文在网络中消失，避免与新连接混淆
- **TIME_WAIT 过多的问题**：大量短连接场景下会产生大量 TIME_WAIT，占用端口资源
- **解决方案：** 开启 `tcp_tw_reuse`、设置 `net.ipv4.tcp_fin_timeout` 缩小等待时间、使用长连接代替短连接

## TCP 与 UDP 对比

| 特性 | TCP | UDP |
|------|-----|-----|
| 连接方式 | 面向连接（需要三次握手） | 无连接 |
| 可靠性 | 可靠传输（确认重传机制） | 不可靠传输 |
| 传输方式 | 面向字节流 | 面向报文 |
| 有序性 | 保证数据顺序 | 不保证数据顺序 |
| 流量控制 | 有（滑动窗口） | 无 |
| 拥塞控制 | 有 | 无 |
| 传输效率 | 较低（开销大） | 较高（开销小） |
| 典型应用 | HTTP、FTP、SMTP、SSH | DNS、DHCP、视频直播、游戏 |

## TCP 三次握手 vs QUIC 连接建立对比

QUIC（Quick UDP Internet Connections）是 Google 开发的基于 UDP 的传输协议，已被 IETF 标准化为 HTTP/3。QUIC 的出现正是为了解决 TCP 三次握手带来的延迟问题。

| 对比项 | TCP 三次握手 | QUIC 连接建立 |
|--------|-------------|--------------|
| **传输层协议** | TCP | UDP |
| **建立连接所需 RTT** | 1 RTT（TCP 握手）+ 可能的 TLS 握手 = 2~3 RTT | 1 RTT（首次连接）/ 0 RTT（恢复连接） |
| **握手过程** | 3 次包交互（SYN → SYN+ACK → ACK） | 客户端发送 Initial → 服务端回复 Handshake + 1-RTT 数据 |
| **加密方式** | 可选 TLS，需要额外 RTT | 强制加密，握手与 TLS 1.3 融合 |
| **队头阻塞** | 有（TCP 层保证有序，一个包丢失阻塞所有流） | 无（多路复用，流之间独立） |
| **连接迁移** | 不支持（基于四元组 IP+Port） | 支持（基于 Connection ID，IP 变化不影响连接） |
| **0-RTT 数据发送** | 不支持 | 支持（重连时可立即发送数据，有重放攻击风险） |
| **拥塞控制** | 内建（如 CUBIC、BBR） | 用户态实现（如 QUIC-Cubic、BBR v2） |
| **握手延迟（典型值）** | TCP+TLS 1.3: ~100ms（跨洋） | QUIC 1-RTT: ~50ms / 0-RTT: ~1ms（本地） |
| **部署复杂度** | 低（内核支持广泛） | 较高（用户态实现，需更新基础设施） |
| **浏览器支持** | 所有浏览器 | Chrome、Firefox、Edge、Safari（HTTP/3） |
| **典型应用** | HTTP/1.1、HTTP/2、FTP、SMTP | HTTP/3、Google 服务、Cloudflare CDN |

**QUIC 为什么能做到 0-RTT？**

```
# QUIC 首次连接（1-RTT）：
Client ──[Initial: ClientHello]──> Server     # 同时发送加密参数
Client <─[Handshake: ServerHello, 证书]── Server  # 服务端响应
Client ──[1-RTT: 应用数据 + Finished]──> Server   # 立即发送数据

# QUIC 恢复连接（0-RTT，使用之前缓存的密钥）：
Client ──[Initial + 0-RTT: 应用数据]──> Server    # 第一个包就带数据！
Client <─[Handshake: ServerHello]── Server         # 服务端确认
```

> **实际效果：** 对于 HTTPS 网站，使用 HTTP/2 over TCP + TLS 1.3 需要 2 个 RTT 才能发送第一个 HTTP 请求，而 HTTP/3 over QUIC 首次连接仅需 1 RTT，恢复连接时 0 RTT 即可发送请求。在跨洋网络（RTT ≈ 200ms）场景下，这意味着页面加载速度快 200~400ms。

## 生产环境调试案例

### 案例一：Nginx 高并发下大量 SYN_RECV

**现象：** 某电商平台在大促期间，Nginx 服务器 CPU 使用率正常，但大量用户反馈页面加载超时。通过 `ss -s` 查看发现 SYN_RECV 状态的连接数超过 20000。

**排查过程：**

```bash
# 1. 查看当前 TCP 连接状态统计
$ ss -s
Total: 45023
TCP:   38412 (estab 15234, closed 12345, orphaned 123, timewait 1234)

# 2. 重点关注半连接数
$ ss -n state syn-recv | wc -l
21567

# 3. 检查全连接队列是否溢出
$ nstat -az | grep TcpExtListenOverflows
TcpExtListenOverflows    18234    0.0    # 大量全连接队列溢出！

# 4. 检查半连接队列是否溢出
$ nstat -az | grep TcpExtListenDrops
TcpExtListenDrops    15678    0.0

# 5. 查看当前的内核参数
$ sysctl net.core.somaxconn
net.core.somaxconn = 128    # 默认值太小！
$ sysctl net.ipv4.tcp_max_syn_backlog
net.ipv4.tcp_max_syn_backlog = 256    # 也是默认值！
```

**根因：** Nginx 的 `listen` 指令默认 backlog 为 511，但受 `somaxconn`（128）限制，全连接队列最大只有 128。高并发时队列溢出，大量连接被丢弃。

**修复：**

```bash
# 1. 调大内核参数
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.ipv4.tcp_syncookies=1

# 2. 修改 Nginx 配置
# listen 80 backlog=65535;

# 3. 重启 Nginx 后验证
$ ss -ltn | grep :80
LISTEN  0  65535  *:80  *:*
```

**效果：** 全连接队列容量提升到 65535，SYN_RECV 数量下降到个位数，用户恢复正常访问。

---

### 案例二：MySQL 连接超时排查

**现象：** 后端 Java 应用连接 MySQL 频繁出现 `Communications link failure` 错误，尤其在业务高峰期。抓包发现 TCP 三次握手阶段就失败了。

**排查过程：**

```bash
# 1. 在应用服务器上抓包
sudo tcpdump -i eth0 host mysql-server-ip and port 3306 -w /tmp/mysql_conn.pcap

# 2. 分析 pcap 文件
$ tcpdump -r /tmp/mysql_conn.pcap 'tcp[tcpflags] & tcp-syn != 0' | head -20
10:15:01.123 IP app-server.45678 > mysql-server.3306: Flags [S]
10:15:01.124 IP mysql-server.3306 > app-server.45678: Flags [S.]
10:15:01.124 IP app-server.45678 > mysql-server.3306: Flags [.]
# ↑ 正常的三次握手

10:15:01.456 IP app-server.45679 > mysql-server.3306: Flags [S]
10:15:01.458 IP mysql-server.3306 > app-server.45679: Flags [S.]
# ↑ 第三次握手缺失，连接未建立！

# 3. 检查 MySQL 服务器端
$ netstat -n | grep SYN_RECV | grep 3306 | wc -l
312    # 大量半连接

# 4. 检查 MySQL 的连接数限制
mysql> SHOW VARIABLES LIKE 'max_connections';
+-----------------+-------+
| Variable_name   | Value |
+-----------------+-------+
| max_connections | 151   |
+-----------------+-------+

# 5. 检查实际连接数
mysql> SHOW STATUS LIKE 'Threads_connected';
+-------------------+-------+
| Variable_name     | Value |
+-------------------+-------+
| Threads_connected | 149   |
+-------------------+-------+
```

**根因：** MySQL `max_connections` 只有 151，高峰期几乎用尽。当全连接队列满时，MySQL 的三次握手无法完成（应用端发了 SYN，MySQL 端也回了 SYN+ACK，但队列满时 ACK 被丢弃或直接 RST）。

**修复：**

```bash
# 1. 增大 MySQL 最大连接数
mysql> SET GLOBAL max_connections = 1000;

# 2. 修改 MySQL 配置文件 /etc/my.cnf
# [mysqld]
# max_connections = 1000
# back_log = 256    # 全连接队列大小

# 3. 应用端使用连接池（避免频繁创建/销毁连接）
```

---

### 案例三：容器网络中 SYN 被静默丢弃

**现象：** Kubernetes 集群中，Pod 间通信偶发超时。tcpdump 显示 SYN 包被发送但没有收到 SYN+ACK。

**排查过程：**

```bash
# 1. 在发送方 Pod 内抓包
$ tcpdump -i eth0 host target-pod-ip and port 8080
10:00:01.100 IP source-pod.34567 > target-pod.8080: Flags [S], seq 1000
# 无任何回复

# 2. 在目标 Pod 内抓包
$ tcpdump -i eth0 host source-pod-ip and port 8080
# 没有收到任何 SYN 包！

# 3. 在 Node 级别抓包（CNI 网桥）
$ tcpdump -i cbr0 host target-pod-ip and port 8080
10:00:01.100 IP source-pod.34567 > target-pod.8080: Flags [S], seq 1000
# 到了网桥，但没有转发到目标 Pod

# 4. 检查 conntrack 表
$ conntrack -L | grep -c "SYN_SENT"
142356    # conntrack 表接近满！

# 5. 检查 conntrack 最大值
$ sysctl net.netfilter.nf_conntrack_max
net.netfilter.nf_conntrack_max = 65536    # 对于高密度集群太小

# 6. 检查是否有丢弃记录
$ dmesg | grep conntrack | tail -5
nf_conntrack: table full, dropping packet
nf_conntrack: table full, dropping packet
```

**根因：** Kubernetes 使用 iptables/conntrack 管理网络连接，高并发时 conntrack 表满，新连接的 SYN 包被静默丢弃（不返回 RST，也不返回 ICMP），导致客户端反复超时重传。

**修复：**

```bash
# 1. 增大 conntrack 表
sysctl -w net.netfilter.nf_conntrack_max=524288
sysctl -w net.netfilter.nf_conntrack_tcp_timeout_syn_sent=30
sysctl -w net.netfilter.nf_conntrack_tcp_timeout_syn_recv=15

# 2. 缩短 TCP 超时（加速释放不活跃连接）
sysctl -w net.netfilter.nf_conntrack_tcp_timeout_established=600

# 3. 永久生效
cat >> /etc/sysctl.conf << EOF
net.netfilter.nf_conntrack_max = 524288
net.netfilter.nf_conntrack_tcp_timeout_syn_sent = 30
net.netfilter.nf_conntrack_tcp_timeout_syn_recv = 15
net.netfilter.nf_conntrack_tcp_timeout_established = 600
EOF
sysctl -p
```

## 连接池优化策略

理解三次握手的开销后，连接池（Connection Pool）就显得尤为重要。每次新建 TCP 连接都需要一次完整的三次握手（1 RTT），如果是 HTTPS 还需要 TLS 握手（额外 1~2 RTT）。连接池通过复用已建立的连接来消除这些开销。

### 连接池基本原理

```
# 不使用连接池（每次请求都建立新连接）：
Request 1: [TCP 3-way handshake] → [发送请求] → [等待响应] → [TCP 4-way close]
Request 2: [TCP 3-way handshake] → [发送请求] → [等待响应] → [TCP 4-way close]
Request 3: [TCP 3-way handshake] → [发送请求] → [等待响应] → [TCP 4-way close]
# 总耗时 = 3 × (握手 + 传输 + 关闭)

# 使用连接池（复用已有连接）：
Request 1: [TCP 3-way handshake] → [发送请求] → [等待响应] ─┐
Request 2:                          [发送请求] → [等待响应] ─┤（复用连接）
Request 3:                          [发送请求] → [等待响应] ─┘
# 总耗时 = 握手 + 3 × 传输（省去 2 次握手和 3 次关闭）
```

### HTTP 客户端连接池配置

**Java OkHttp 连接池：**

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectionPool(new ConnectionPool(
        50,              // 最大空闲连接数
        5, TimeUnit.MINUTES  // 空闲连接存活时间
    ))
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .keepAliveDuration(5, TimeUnit.MINUTES)
    .build();
```

**Python requests 连接池：**

```python
import requests
from requests.adapters import HTTPAdapter

session = requests.Session()
adapter = HTTPAdapter(
    pool_connections=20,    # 连接池中保持的主机数
    pool_maxsize=100,       # 每个主机的最大连接数
    pool_block=False        # 连接池满时是否阻塞等待
)
session.mount('http://', adapter)
session.mount('https://', adapter)

# 复用 session 发送请求（底层复用 TCP 连接）
response = session.get('https://api.example.com/data')
```

**Go net/http 连接池：**

```go
transport := &http.Transport{
    MaxIdleConns:        200,            // 最大空闲连接总数
    MaxIdleConnsPerHost: 50,             // 每个 host 的最大空闲连接
    MaxConnsPerHost:     100,            // 每个 host 的最大连接数
    IdleConnTimeout:     90 * time.Second, // 空闲连接超时
    TLSHandshakeTimeout: 10 * time.Second,
}
client := &http.Client{
    Transport: transport,
    Timeout:   30 * time.Second,
}
```

### 连接池调优建议

| 参数 | 建议范围 | 说明 |
|------|---------|------|
| 最大连接数 | 50~200（每 host） | 根据后端处理能力设置，过大反而增加后端压力 |
| 最大空闲连接数 | 最大连接数的 50%~80% | 保持足够空闲连接减少握手开销 |
| 空闲超时时间 | 30~120 秒 | 与服务端的 `keepalive_timeout` 匹配 |
| 连接最大生命周期 | 5~15 分钟 | 避免使用过期的后端实例 |
| 获取连接超时 | 3~10 秒 | 防止线程长时间阻塞 |

> **关键原则：** 连接池大小的黄金法则是 **连接数 ≈ 并发请求数 / 每个连接的 QPS**。例如后端接口平均 50ms 响应，QPS 为 2000，则需要约 100 个连接（2000 × 0.05s）。过多的连接会导致资源浪费和服务端压力，过少则会导致请求排队。

## 相关阅读

- [HTTP四次挥手](/categories/Network/four-way-close/)
- [TCP/IP 协议详解](/categories/Network/tcp-ip/)
- [HTTPS 加密通信](/categories/Network/https/)
- [UDP 协议详解](/categories/Network/udp/)
- [HTTP 协议基础](/categories/Network/http/)