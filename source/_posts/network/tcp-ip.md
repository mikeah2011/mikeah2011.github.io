
title: TCP/IP 协议栈详解：三次握手、四次挥手与拥塞控制
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- TCP
- 网络协议
- HTTP
- UDP
categories:
  - network
keywords: [TCP/IP, 三次握手, 四次挥手, 拥塞控制, UDP, Socket编程]
date: 2016-03-20 15:05:07
description: 深入解析TCP/IP协议栈架构与工作原理，详细讲解TCP三次握手与四次挥手过程、TCP状态机转换、拥塞控制四大算法（慢启动、拥塞避免、快重传、快恢复），对比TCP与UDP差异，剖析HTTP/1.1至HTTP/3的演进及其与TCP的关系，并提供Wireshark抓包分析、netstat/ss命令实战及Socket编程代码示例。
---



TCP/IP（Transmission Control Protocol/Internet Protocol，传输控制协议/网际协议）

是指能够在多个不同网络间实现信息传输的协议簇。

TCP/IP协议不仅仅指的是TCP 和IP两个协议，

而是指一个由FTP、SMTP、TCP、UDP、IP等协议构成的协议簇，

同时是Internet最基本的协议、Internet国际互联网络的基础，

由网络层的IP协议和传输层的TCP协议组成。

TCP/IP 定义了电子设备如何连入因特网，以及数据如何在它们之间传输的标准。

## TCP/IP 四层模型

互联网中的设备要相互通信，必须基于相同的方式，

比如由哪一方发起通讯，使用什么语言进行通讯，怎么结束通讯这些都要事先确定，

不同设备之间的通讯都需要一种规则，我们将这种规则成为协议。

TCP/IP协议中最重要的特点就是分层。

由上往下分别为

​	【应用层】、【传输层】、【网络层】、【数据链路层】、【物理层】。

当然也有按不同的模型分为4层或者7层的。

![img](/images/TCP_IP.webp)


## 应用层

TCP/IP模型将OSI参考模型中的会话层和表示层的功能合并到应用层实现。这一层主要的代表有DNS域名解析、HTTP协议、HTTPS协议、FTP、SMTP等。

## 传输层

在TCP/IP模型中，传输层的功能是使源端主机和目标端主机上的对等实体可以进行会话。在传输层定义了两种服务质量不同的协议。即：传输控制协议TCP和用户数据报协议UDP。

## 网络层

网络层是整个TCP/IP协议栈的核心。它的功能是把分组发往目标网络或主机。同时，为了尽快地发送分组，可能需要沿不同的路径同时进行分组传递。因此，分组到达的顺序和发送的顺序可能不同，这就需要上层必须对分组进行排序。网络层定义了分组格式和协议，即IP协议（Internet Protocol ）。

## 数据链路层

控制网络层与物理层之间的通信，主要功能是保证物理线路上进行可靠的数据传递。为了保证传输，从网络层接收到的数据被分割成特定的可被物理层传输的帧。帧是用来移动数据结构的结构包，他不仅包含原始数据，还包含发送方和接收方的物理地址以及纠错和控制信息。其中的地址确定了帧将发送到何处，而纠错和控制信息则确保帧无差错到达。如果在传达数据时，接收点检测到所传数据中有差错，就要通知发送方重发这一帧。

## 物理层

该层负责 比特流在节点之间的传输，即负责物理传输，这一层的协议既与链路有关，也与传输的介质有关。通俗来说就是把计算机连接起来的物理手段。

## TCP 协议详解

TCP（Transmission Control Protocol）是一种面向连接的、可靠的、基于字节流的传输层通信协议。它通过以下机制保证数据的可靠传输：

- **序列号与确认应答**：每个字节都有编号，接收方收到后发送ACK确认
- **超时重传**：发送方在超时未收到ACK时重发数据
- **流量控制**：通过滑动窗口机制控制发送速率
- **拥塞控制**：根据网络状况动态调整发送速率

### TCP 三次握手（Three-Way Handshake）

TCP建立连接需要进行三次握手，过程如下：

```
客户端                          服务器
  |                               |
  |--- SYN (seq=x) ------------->|   第1次握手：客户端发送SYN
  |                               |
  |<-- SYN+ACK (seq=y, ack=x+1) -|   第2次握手：服务器回复SYN+ACK
  |                               |
  |--- ACK (ack=y+1) ----------->|   第3次握手：客户端发送ACK
  |                               |
  |====== 连接建立，开始通信 ======|
```

**为什么需要三次握手？**

三次握手的核心目的是**同步双方的初始序列号（ISN）**。如果只有两次握手，服务器无法确认客户端收到了自己的序列号，可能导致历史连接的误建立或数据丢失。三次握手能防止已失效的连接请求报文到达服务器，导致错误连接。

### TCP 四次挥手（Four-Way Teardown）

TCP断开连接需要四次挥手，因为TCP是全双工通信，每个方向需要单独关闭：

```
客户端                          服务器
  |                               |
  |--- FIN (seq=u) ------------->|   第1次挥手：客户端请求关闭
  |                               |
  |<-- ACK (ack=u+1) ------------|   第2次挥手：服务器确认收到
  |                               |
  |   （服务器可能继续发送数据）      |
  |                               |
  |<-- FIN (seq=w) --------------|   第3次挥手：服务器请求关闭
  |                               |
  |--- ACK (ack=w+1) ----------->|   第4次挥手：客户端确认
  |                               |
  |--- 等待2MSL后彻底关闭 ---------|
```

**TIME_WAIT 状态（2MSL等待）**：客户端发送最后的ACK后等待2MSL（Maximum Segment Lifetime），目的是确保最后的ACK能到达服务器。如果服务器没收到ACK会重发FIN，客户端需要能处理。

### TCP 状态机

TCP连接在其生命周期中经历多种状态：

| 状态 | 说明 |
|------|------|
| `LISTEN` | 服务器等待客户端连接 |
| `SYN_SENT` | 客户端已发送SYN，等待服务器回复 |
| `SYN_RECEIVED` | 服务器收到SYN，已回复SYN+ACK |
| `ESTABLISHED` | 连接已建立，可以传输数据 |
| `FIN_WAIT_1` | 主动关闭方已发送FIN |
| `CLOSE_WAIT` | 被动关闭方收到FIN，等待应用层关闭 |
| `FIN_WAIT_2` | 主动关闭方收到ACK，等待对方FIN |
| `LAST_ACK` | 被动关闭方已发送FIN，等待最后ACK |
| `TIME_WAIT` | 主动关闭方收到FIN，等待2MSL |
| `CLOSED` | 连接完全关闭 |

### TCP 拥塞控制算法

TCP通过四种核心算法进行拥塞控制：

**1. 慢启动（Slow Start）**

连接建立后，拥塞窗口（cwnd）从1个MSS开始，每收到一个ACK就增加1个MSS（指数增长）。直到cwnd达到慢启动阈值（ssthresh），进入拥塞避免阶段。

```
cwnd: 1 → 2 → 4 → 8 → 16 → ... （指数增长）
```

**2. 拥塞避免（Congestion Avoidance）**

当 cwnd >= ssthresh 时，每经过一个RTT，cwnd增加1个MSS（线性增长），避免网络拥塞。

```
cwnd: ssthresh → ssthresh+1 → ssthresh+2 → ... （线性增长）
```

**3. 快重传（Fast Retransmit）**

当发送方连续收到3个重复ACK时，立即重传丢失的报文段，而不等待超时。

**4. 快恢复（Fast Recovery）**

快重传之后，ssthresh = cwnd / 2，cwnd = ssthresh + 3，直接进入拥塞避免阶段（线性增长），而不是回到慢启动。

```
               cwnd
                ^
                |        快恢复
                |       /  拥塞避免（线性增长）
                |      /  /
   检测到丢包 → |     / /
                |    //
                |   / 慢启动（指数增长）
                |  /
                | /
                +----------------------------→ 时间
                 ssthresh
```

## TCP vs UDP 对比

| 特性 | TCP | UDP |
|------|-----|-----|
| 连接方式 | 面向连接（三次握手） | 无连接 |
| 可靠性 | 可靠（确认应答、重传） | 不可靠 |
| 传输方式 | 面向字节流 | 面向报文 |
| 传输效率 | 较低（开销大） | 较高（开销小） |
| 有序性 | 保证有序 | 不保证有序 |
| 流量控制 | 有（滑动窗口） | 无 |
| 拥塞控制 | 有 | 无 |
| 首部大小 | 20字节（最小） | 8字节 |
| 典型应用 | HTTP/HTTPS、FTP、SMTP、SSH | DNS、DHCP、视频直播、游戏、VoIP |

## HTTP/HTTPS 与 TCP 的关系

### HTTP

HTTP（HyperText Transfer Protocol）是应用层协议，基于TCP传输。每次HTTP请求都需要先通过TCP三次握手建立连接：

```
[HTTP请求/响应] ← 应用层
    ↓
[TCP连接管理]  ← 传输层（三次握手建立，四次挥手断开）
    ↓
[IP路由]      ← 网络层
    ↓
[以太网帧]    ← 数据链路层
```

- **HTTP/1.0**：每次请求都新建一个TCP连接，请求完成后立即关闭
- **HTTP/1.1**：引入持久连接（Keep-Alive），一个TCP连接可以发送多个请求
- **HTTP/2**：在单个TCP连接上实现多路复用，通过帧和流机制并行传输
- **HTTP/3**：弃用TCP，改用基于UDP的QUIC协议，解决队头阻塞问题

### HTTPS

HTTPS = HTTP + TLS/SSL，在TCP三次握手之后、HTTP通信之前，还需要进行TLS握手：

```
TCP三次握手 → TLS握手（证书验证、密钥交换） → 加密的HTTP通信
```

TLS握手过程：
1. 客户端发送支持的加密套件列表
2. 服务器选择加密套件并发送数字证书
3. 客户端验证证书，生成预主密钥并用服务器公钥加密发送
4. 双方根据预主密钥生成会话密钥，后续通信使用对称加密

## 实用工具与命令

### netstat / ss 查看 TCP 连接状态

在 Linux/macOS 系统中，`netstat` 和 `ss` 是排查 TCP 连接问题的常用工具：

```bash
# 查看所有 TCP 连接（不含 DNS 解析，显示数字地址）
netstat -ant

# 查看各 TCP 状态的连接数量统计
netstat -ant | awk '{print $6}' | sort | uniq -c | sort -rn
# 输出示例：
#  12 ESTABLISHED
#   3 TIME_WAIT
#   1 LISTEN

# 使用 ss 命令（比 netstat 更高效，直接读取 /proc/net/tcp）
ss -t -a              # 列出所有 TCP 连接
ss -t -p              # 显示进程信息（需 root）
ss -t -p | grep :80   # 查看 80 端口的连接
ss -s                 # 查看连接状态汇总统计

# 查看 TIME_WAIT 连接数量（排查端口耗尽问题）
ss -t state time-wait | wc -l

# 查看特定状态的连接
ss -t state established
ss -t state close-wait   # 排查 CLOSE_WAIT 堆积（应用未正确关闭连接）
```

**常见排查场景：**

| 场景 | 现象 | 命令 |
|------|------|------|
| 端口被占用 | `bind: Address already in use` | `ss -t -p \| grep :端口` |
| CLOSE_WAIT 堆积 | 连接无法释放 | `ss -t state close-wait` |
| TIME_WAIT 过多 | 端口耗尽 | `ss -t state time-wait \| wc -l` |
| SYN Flood 攻击 | SYN_RECEIVED 过多 | `ss -t state syn-recv \| wc -l` |

### Wireshark 抓包分析 TCP 通信

Wireshark 是最流行的网络封包分析工具，可以直观地观察 TCP 三次握手、数据传输和四次挥手的全过程。

**抓包步骤：**

1. 打开 Wireshark，选择要监听的网卡（如 `en0` 或 `eth0`）
2. 设置过滤器 `tcp.port == 80` 只捕获目标端口的流量
3. 在浏览器中访问目标网站
4. 停止抓包，分析 TCP 流

**三次握手抓包示例（过滤 `tcp.flags.syn == 1 || tcp.flags.fin == 1`）：**

```
No.  Time     Source          Dest            Protocol  Info
1    0.000000 192.168.1.100   93.184.216.34   TCP       54321 → 80 [SYN] Seq=0 Win=65535
2    0.023456 93.184.216.34   192.168.1.100   TCP       80 → 54321 [SYN, ACK] Seq=0 Ack=1 Win=65535
3    0.023789 192.168.1.100   93.184.216.34   TCP       54321 → 80 [ACK] Seq=1 Ack=1 Win=65535
4    0.024012 192.168.1.100   93.184.216.34   HTTP      GET / HTTP/1.1
...
```

**关键过滤器：**

| 过滤器 | 用途 |
|--------|------|
| `tcp.flags.syn == 1` | 过滤 SYN 包，查看握手过程 |
| `tcp.flags.fin == 1` | 过滤 FIN 包，查看挥手过程 |
| `tcp.flags.reset == 1` | 过滤 RST 包，查看异常断开 |
| `tcp.analysis.retransmission` | 过滤重传包，排查丢包 |
| `tcp.analysis.zero_window` | 过滤零窗口，排查流控问题 |
| `tcp.stream eq N` | 追踪第 N 个 TCP 流的完整通信 |

**分析技巧：** 右键某个 TCP 包 → 选择 "Follow" → "TCP Stream"，可以查看该连接的完整 HTTP 请求和响应内容。

## Socket 编程示例

### Python TCP 服务端

```python
import socket

# 创建TCP Socket
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server_socket.bind(('0.0.0.0', 8888))
server_socket.listen(5)
print("服务器启动，监听端口 8888...")

while True:
    # accept() 会阻塞，直到客户端连接（三次握手完成后返回）
    client_socket, addr = server_socket.accept()
    print(f"客户端 {addr} 已连接")

    data = client_socket.recv(1024)
    print(f"收到数据: {data.decode('utf-8')}")

    client_socket.send("Hello from server!".encode('utf-8'))
    client_socket.close()  # 触发四次挥手
```

### Python TCP 客户端

```python
import socket

client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
# connect() 触发三次握手
client_socket.connect(('127.0.0.1', 8888))

client_socket.send("Hello from client!".encode('utf-8'))

response = client_socket.recv(1024)
print(f"服务器回复: {response.decode('utf-8')}")

client_socket.close()  # 触发四次挥手
```

### Python UDP 示例

```python
import socket

# UDP 服务端
server_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)  # SOCK_DGRAM 表示UDP
server_socket.bind(('0.0.0.0', 9999))
print("UDP服务器启动，监听端口 9999...")

while True:
    data, addr = server_socket.recvfrom(1024)
    print(f"收到来自 {addr} 的数据: {data.decode('utf-8')}")
    server_socket.sendto("ACK".encode('utf-8'), addr)
```

## 总结

TCP/IP协议栈是互联网的基础架构，理解各层的工作原理对于网络编程和故障排查至关重要：

- **TCP** 通过三次握手/四次挥手、序列号、滑动窗口、拥塞控制等机制保证可靠传输
- **UDP** 以低开销换取速度，适用于实时性要求高的场景
- **HTTP/HTTPS** 建立在TCP之上，HTTPS额外使用TLS保证安全性
- **Socket** 是应用层与传输层之间的编程接口，是网络编程的基础

## 相关阅读

- [TCP三次握手详解](/categories/Network/three-way-handshake/) - 深入分析TCP建立连接的三次握手过程与序列号同步机制
- [TCP四次挥手详解](/categories/Network/four-way-close/) - 详细讲解TCP连接断开的四次挥手及TIME_WAIT状态的作用
- [HTTP协议详解](/categories/Network/http/) - HTTP协议的工作原理、请求响应模型与版本演进
- [HTTPS原理与TLS握手](/categories/Network/https/) - HTTPS加密机制、TLS握手过程与证书验证流程
---
tle: TCP/IP 协议栈详解：三次握手、四次挥手与拥塞控制
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- TCP
- 网络协议
- HTTP
- UDP
categories:
  - network
keywords: [TCP/IP , 三次握手 , 四次挥手 , 拥塞控制 , UDP , Socket编程 date: 2016]
---



TCP/IP（Transmission Control Protocol/Internet Protocol，传输控制协议/网际协议）

是指能够在多个不同网络间实现信息传输的协议簇。

TCP/IP协议不仅仅指的是TCP 和IP两个协议，

而是指一个由FTP、SMTP、TCP、UDP、IP等协议构成的协议簇，

同时是Internet最基本的协议、Internet国际互联网络的基础，

由网络层的IP协议和传输层的TCP协议组成。

TCP/IP 定义了电子设备如何连入因特网，以及数据如何在它们之间传输的标准。

## TCP/IP 四层模型

互联网中的设备要相互通信，必须基于相同的方式，

比如由哪一方发起通讯，使用什么语言进行通讯，怎么结束通讯这些都要事先确定，

不同设备之间的通讯都需要一种规则，我们将这种规则成为协议。

TCP/IP协议中最重要的特点就是分层。

由上往下分别为

​	【应用层】、【传输层】、【网络层】、【数据链路层】、【物理层】。

当然也有按不同的模型分为4层或者7层的。

![img](/images/TCP_IP.webp)


## 应用层

TCP/IP模型将OSI参考模型中的会话层和表示层的功能合并到应用层实现。这一层主要的代表有DNS域名解析、HTTP协议、HTTPS协议、FTP、SMTP等。

## 传输层

在TCP/IP模型中，传输层的功能是使源端主机和目标端主机上的对等实体可以进行会话。在传输层定义了两种服务质量不同的协议。即：传输控制协议TCP和用户数据报协议UDP。

## 网络层

网络层是整个TCP/IP协议栈的核心。它的功能是把分组发往目标网络或主机。同时，为了尽快地发送分组，可能需要沿不同的路径同时进行分组传递。因此，分组到达的顺序和发送的顺序可能不同，这就需要上层必须对分组进行排序。网络层定义了分组格式和协议，即IP协议（Internet Protocol ）。

## 数据链路层

控制网络层与物理层之间的通信，主要功能是保证物理线路上进行可靠的数据传递。为了保证传输，从网络层接收到的数据被分割成特定的可被物理层传输的帧。帧是用来移动数据结构的结构包，他不仅包含原始数据，还包含发送方和接收方的物理地址以及纠错和控制信息。其中的地址确定了帧将发送到何处，而纠错和控制信息则确保帧无差错到达。如果在传达数据时，接收点检测到所传数据中有差错，就要通知发送方重发这一帧。

## 物理层

该层负责 比特流在节点之间的传输，即负责物理传输，这一层的协议既与链路有关，也与传输的介质有关。通俗来说就是把计算机连接起来的物理手段。

## TCP 协议详解

TCP（Transmission Control Protocol）是一种面向连接的、可靠的、基于字节流的传输层通信协议。它通过以下机制保证数据的可靠传输：

- **序列号与确认应答**：每个字节都有编号，接收方收到后发送ACK确认
- **超时重传**：发送方在超时未收到ACK时重发数据
- **流量控制**：通过滑动窗口机制控制发送速率
- **拥塞控制**：根据网络状况动态调整发送速率

### TCP 三次握手（Three-Way Handshake）

TCP建立连接需要进行三次握手，过程如下：

```
客户端                          服务器
  |                               |
  |--- SYN (seq=x) ------------->|   第1次握手：客户端发送SYN
  |                               |
  |<-- SYN+ACK (seq=y, ack=x+1) -|   第2次握手：服务器回复SYN+ACK
  |                               |
  |--- ACK (ack=y+1) ----------->|   第3次握手：客户端发送ACK
  |                               |
  |====== 连接建立，开始通信 ======|
```

**为什么需要三次握手？**

三次握手的核心目的是**同步双方的初始序列号（ISN）**。如果只有两次握手，服务器无法确认客户端收到了自己的序列号，可能导致历史连接的误建立或数据丢失。三次握手能防止已失效的连接请求报文到达服务器，导致错误连接。

### TCP 四次挥手（Four-Way Teardown）

TCP断开连接需要四次挥手，因为TCP是全双工通信，每个方向需要单独关闭：

```
客户端                          服务器
  |                               |
  |--- FIN (seq=u) ------------->|   第1次挥手：客户端请求关闭
  |                               |
  |<-- ACK (ack=u+1) ------------|   第2次挥手：服务器确认收到
  |                               |
  |   （服务器可能继续发送数据）      |
  |                               |
  |<-- FIN (seq=w) --------------|   第3次挥手：服务器请求关闭
  |                               |
  |--- ACK (ack=w+1) ----------->|   第4次挥手：客户端确认
  |                               |
  |--- 等待2MSL后彻底关闭 ---------|
```

**TIME_WAIT 状态（2MSL等待）**：客户端发送最后的ACK后等待2MSL（Maximum Segment Lifetime），目的是确保最后的ACK能到达服务器。如果服务器没收到ACK会重发FIN，客户端需要能处理。

### TCP 状态机

TCP连接在其生命周期中经历多种状态：

| 状态 | 说明 |
|------|------|
| `LISTEN` | 服务器等待客户端连接 |
| `SYN_SENT` | 客户端已发送SYN，等待服务器回复 |
| `SYN_RECEIVED` | 服务器收到SYN，已回复SYN+ACK |
| `ESTABLISHED` | 连接已建立，可以传输数据 |
| `FIN_WAIT_1` | 主动关闭方已发送FIN |
| `CLOSE_WAIT` | 被动关闭方收到FIN，等待应用层关闭 |
| `FIN_WAIT_2` | 主动关闭方收到ACK，等待对方FIN |
| `LAST_ACK` | 被动关闭方已发送FIN，等待最后ACK |
| `TIME_WAIT` | 主动关闭方收到FIN，等待2MSL |
| `CLOSED` | 连接完全关闭 |

### TCP 拥塞控制算法

TCP通过四种核心算法进行拥塞控制：

**1. 慢启动（Slow Start）**

连接建立后，拥塞窗口（cwnd）从1个MSS开始，每收到一个ACK就增加1个MSS（指数增长）。直到cwnd达到慢启动阈值（ssthresh），进入拥塞避免阶段。

```
cwnd: 1 → 2 → 4 → 8 → 16 → ... （指数增长）
```

**2. 拥塞避免（Congestion Avoidance）**

当 cwnd >= ssthresh 时，每经过一个RTT，cwnd增加1个MSS（线性增长），避免网络拥塞。

```
cwnd: ssthresh → ssthresh+1 → ssthresh+2 → ... （线性增长）
```

**3. 快重传（Fast Retransmit）**

当发送方连续收到3个重复ACK时，立即重传丢失的报文段，而不等待超时。

**4. 快恢复（Fast Recovery）**

快重传之后，ssthresh = cwnd / 2，cwnd = ssthresh + 3，直接进入拥塞避免阶段（线性增长），而不是回到慢启动。

```
               cwnd
                ^
                |        快恢复
                |       /  拥塞避免（线性增长）
                |      /  /
   检测到丢包 → |     / /
                |    //
                |   / 慢启动（指数增长）
                |  /
                | /
                +----------------------------→ 时间
                 ssthresh
```

## TCP vs UDP 对比

| 特性 | TCP | UDP |
|------|-----|-----|
| 连接方式 | 面向连接（三次握手） | 无连接 |
| 可靠性 | 可靠（确认应答、重传） | 不可靠 |
| 传输方式 | 面向字节流 | 面向报文 |
| 传输效率 | 较低（开销大） | 较高（开销小） |
| 有序性 | 保证有序 | 不保证有序 |
| 流量控制 | 有（滑动窗口） | 无 |
| 拥塞控制 | 有 | 无 |
| 首部大小 | 20字节（最小） | 8字节 |
| 典型应用 | HTTP/HTTPS、FTP、SMTP、SSH | DNS、DHCP、视频直播、游戏、VoIP |

## HTTP/HTTPS 与 TCP 的关系

### HTTP

HTTP（HyperText Transfer Protocol）是应用层协议，基于TCP传输。每次HTTP请求都需要先通过TCP三次握手建立连接：

```
[HTTP请求/响应] ← 应用层
    ↓
[TCP连接管理]  ← 传输层（三次握手建立，四次挥手断开）
    ↓
[IP路由]      ← 网络层
    ↓
[以太网帧]    ← 数据链路层
```

- **HTTP/1.0**：每次请求都新建一个TCP连接，请求完成后立即关闭
- **HTTP/1.1**：引入持久连接（Keep-Alive），一个TCP连接可以发送多个请求
- **HTTP/2**：在单个TCP连接上实现多路复用，通过帧和流机制并行传输
- **HTTP/3**：弃用TCP，改用基于UDP的QUIC协议，解决队头阻塞问题

### HTTPS

HTTPS = HTTP + TLS/SSL，在TCP三次握手之后、HTTP通信之前，还需要进行TLS握手：

```
TCP三次握手 → TLS握手（证书验证、密钥交换） → 加密的HTTP通信
```

TLS握手过程：
1. 客户端发送支持的加密套件列表
2. 服务器选择加密套件并发送数字证书
3. 客户端验证证书，生成预主密钥并用服务器公钥加密发送
4. 双方根据预主密钥生成会话密钥，后续通信使用对称加密

## 实用工具与命令

### netstat / ss 查看 TCP 连接状态

在 Linux/macOS 系统中，`netstat` 和 `ss` 是排查 TCP 连接问题的常用工具：

```bash
# 查看所有 TCP 连接（不含 DNS 解析，显示数字地址）
netstat -ant

# 查看各 TCP 状态的连接数量统计
netstat -ant | awk '{print $6}' | sort | uniq -c | sort -rn
# 输出示例：
#  12 ESTABLISHED
#   3 TIME_WAIT
#   1 LISTEN

# 使用 ss 命令（比 netstat 更高效，直接读取 /proc/net/tcp）
ss -t -a              # 列出所有 TCP 连接
ss -t -p              # 显示进程信息（需 root）
ss -t -p | grep :80   # 查看 80 端口的连接
ss -s                 # 查看连接状态汇总统计

# 查看 TIME_WAIT 连接数量（排查端口耗尽问题）
ss -t state time-wait | wc -l

# 查看特定状态的连接
ss -t state established
ss -t state close-wait   # 排查 CLOSE_WAIT 堆积（应用未正确关闭连接）
```

**常见排查场景：**

| 场景 | 现象 | 命令 |
|------|------|------|
| 端口被占用 | `bind: Address already in use` | `ss -t -p \| grep :端口` |
| CLOSE_WAIT 堆积 | 连接无法释放 | `ss -t state close-wait` |
| TIME_WAIT 过多 | 端口耗尽 | `ss -t state time-wait \| wc -l` |
| SYN Flood 攻击 | SYN_RECEIVED 过多 | `ss -t state syn-recv \| wc -l` |

### Wireshark 抓包分析 TCP 通信

Wireshark 是最流行的网络封包分析工具，可以直观地观察 TCP 三次握手、数据传输和四次挥手的全过程。

**抓包步骤：**

1. 打开 Wireshark，选择要监听的网卡（如 `en0` 或 `eth0`）
2. 设置过滤器 `tcp.port == 80` 只捕获目标端口的流量
3. 在浏览器中访问目标网站
4. 停止抓包，分析 TCP 流

**三次握手抓包示例（过滤 `tcp.flags.syn == 1 || tcp.flags.fin == 1`）：**

```
No.  Time     Source          Dest            Protocol  Info
1    0.000000 192.168.1.100   93.184.216.34   TCP       54321 → 80 [SYN] Seq=0 Win=65535
2    0.023456 93.184.216.34   192.168.1.100   TCP       80 → 54321 [SYN, ACK] Seq=0 Ack=1 Win=65535
3    0.023789 192.168.1.100   93.184.216.34   TCP       54321 → 80 [ACK] Seq=1 Ack=1 Win=65535
4    0.024012 192.168.1.100   93.184.216.34   HTTP      GET / HTTP/1.1
...
```

**关键过滤器：**

| 过滤器 | 用途 |
|--------|------|
| `tcp.flags.syn == 1` | 过滤 SYN 包，查看握手过程 |
| `tcp.flags.fin == 1` | 过滤 FIN 包，查看挥手过程 |
| `tcp.flags.reset == 1` | 过滤 RST 包，查看异常断开 |
| `tcp.analysis.retransmission` | 过滤重传包，排查丢包 |
| `tcp.analysis.zero_window` | 过滤零窗口，排查流控问题 |
| `tcp.stream eq N` | 追踪第 N 个 TCP 流的完整通信 |

**分析技巧：** 右键某个 TCP 包 → 选择 "Follow" → "TCP Stream"，可以查看该连接的完整 HTTP 请求和响应内容。

## Socket 编程示例

### Python TCP 服务端

```python
import socket

# 创建TCP Socket
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server_socket.bind(('0.0.0.0', 8888))
server_socket.listen(5)
print("服务器启动，监听端口 8888...")

while True:
    # accept() 会阻塞，直到客户端连接（三次握手完成后返回）
    client_socket, addr = server_socket.accept()
    print(f"客户端 {addr} 已连接")

    data = client_socket.recv(1024)
    print(f"收到数据: {data.decode('utf-8')}")

    client_socket.send("Hello from server!".encode('utf-8'))
    client_socket.close()  # 触发四次挥手
```

### Python TCP 客户端

```python
import socket

client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
# connect() 触发三次握手
client_socket.connect(('127.0.0.1', 8888))

client_socket.send("Hello from client!".encode('utf-8'))

response = client_socket.recv(1024)
print(f"服务器回复: {response.decode('utf-8')}")

client_socket.close()  # 触发四次挥手
```

### Python UDP 示例

```python
import socket

# UDP 服务端
server_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)  # SOCK_DGRAM 表示UDP
server_socket.bind(('0.0.0.0', 9999))
print("UDP服务器启动，监听端口 9999...")

while True:
    data, addr = server_socket.recvfrom(1024)
    print(f"收到来自 {addr} 的数据: {data.decode('utf-8')}")
    server_socket.sendto("ACK".encode('utf-8'), addr)
```

## 总结

TCP/IP协议栈是互联网的基础架构，理解各层的工作原理对于网络编程和故障排查至关重要：

- **TCP** 通过三次握手/四次挥手、序列号、滑动窗口、拥塞控制等机制保证可靠传输
- **UDP** 以低开销换取速度，适用于实时性要求高的场景
- **HTTP/HTTPS** 建立在TCP之上，HTTPS额外使用TLS保证安全性
- **Socket** 是应用层与传输层之间的编程接口，是网络编程的基础

## 相关阅读

- [TCP三次握手详解](/categories/Network/three-way-handshake/) - 深入分析TCP建立连接的三次握手过程与序列号同步机制
- [TCP四次挥手详解](/categories/Network/four-way-close/) - 详细讲解TCP连接断开的四次挥手及TIME_WAIT状态的作用
- [HTTP协议详解](/categories/Network/http/) - HTTP协议的工作原理、请求响应模型与版本演进
- [HTTPS原理与TLS握手](/categories/Network/https/) - HTTPS加密机制、TLS握手过程与证书验证流程
