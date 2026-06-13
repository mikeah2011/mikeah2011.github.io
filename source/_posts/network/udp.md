---

title: UDP 协议详解：无连接传输与实时应用场景
keywords: [UDP, 协议详解, 无连接传输与实时应用场景, 网络]
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- UDP
- TCP
- 网络协议
- Socket
categories:
  - network
date: 2016-03-20 15:05:07
description: 全面解析UDP和TCP网络协议的核心差异与应用场景。深入介绍UDP无连接、面向报文的特性，对比TCP的可靠传输机制（三次握手、四次挥手），涵盖UDP首部格式、Socket编程实战（PHP代码示例）、DNS查询/视频直播/在线游戏等典型应用，以及QUIC协议、应用层ACK等UDP可靠传输实现思路和网络编程常见踩坑。
---



## UDP 概述

用户数据报协议 UDP（User Datagram Protocol）是 TCP/IP 协议族中最重要的传输层协议之一。与 TCP 不同，UDP 采用了截然不同的设计理念——**简单、轻量、高效**。其核心特性如下：

- **无连接：** 发送数据前不需要建立连接，减少了延迟开销
- **尽最大努力交付：** 不保证数据包一定能到达，不保证顺序
- **面向报文：** 应用层交给 UDP 多长的报文，UDP 就发送多长的报文，不做拆分或合并
- **无拥塞控制：** 网络拥塞时不会降低发送速率（这既是优势也是风险）
- **支持多种通信模式：** 支持一对一、一对多、多对一、多对多
- **首部开销小：** 仅 8 字节（TCP 至少 20 字节）

UDP 是面向报文的传输方式：应用层交给 UDP 多长的报文，UDP 就发送多长的报文，即一次发送一个报文。因此，应用程序必须选择合适大小的报文。过大的报文会导致 IP 层分片，增加丢包风险；过小的报文则会增加首部比例，降低传输效率。

## UDP vs TCP 详细对比

| 特性 | UDP | TCP |
|------|-----|-----|
| **连接性** | 无连接，直接发送 | 面向连接，需三次握手 |
| **可靠性** | 不可靠，可能丢包、乱序 | 可靠，有序号/确认/重传机制 |
| **传输方式** | 面向报文 | 面向字节流 |
| **速度** | 快，延迟低 | 相对较慢，握手和确认开销 |
| **首部大小** | 8 字节 | 20-60 字节 |
| **流量控制** | 无 | 滑动窗口机制 |
| **拥塞控制** | 无 | 慢开始、拥塞避免、快重传、快恢复 |
| **通信模式** | 一对一、一对多、多对一、多对多 | 仅支持一对一（点对点） |
| **双工性** | 支持 | 全双工 |
| **典型应用** | DNS、直播、游戏、IoT | HTTP、FTP、SMTP、SSH |
| **适用场景** | 实时性要求高，容忍少量丢包 | 可靠性要求高，可容忍延迟 |

## UDP 首部格式

![img](/images/UDP.png)

用户数据报由两个字段组成：**数据字段**和**首部字段**。首部很简单，只有 8 个字节，由四个字段组成，每个字段的长度都是两个字节：

1. **源端口：** 源端口号，在需要给对方回信时使用。不需要时可全用 0。
2. **目的端口号：** 在终点交付报文时必须使用。
3. **长度：** 用户数据报 UDP 的长度（首部 + 数据），最小为 8（仅首部）。
4. **校验和：** 用于校验用户数据报在传输过程中是否出错，出错则丢弃。UDP 的校验和是可选的（IPv4），但在 IPv6 中是强制的。

UDP 校验和的计算包含了 12 字节的**伪首部**（源 IP、目的 IP、全零、协议号、UDP 长度），这使得 UDP 不仅能检测数据本身的错误，还能检测 IP 地址等信息的错误。

## TCP 报文首部格式

![img](/images/TCP.png)

**源端口和目的端口：** 各占两个字节，分别写入源端口号和目的端口号。

**序号：** 占 4 个字节；用于对字节流进行编号，例如序号为 301，表示第一个字节的编号为 301，如果携带的数据长度为 100 字节，那么下一个报文段的序号应为 401。

**确认号：** 占 4 个字节；期望收到的下一个报文段的序号。例如 B 正确收到 A 发送来的一个报文段，序号为 501，携带的数据长度为 200 字节，因此 B 期望下一个报文段的序号为 701，B 发送给 A 的确认报文段中确认号就为 701。

**数据偏移：** 占 4 位；指的是数据部分距离报文段起始处的偏移量，实际上指的是首部的长度。

**确认 ACK：** 当 ACK=1 时确认号字段有效，否则无效。TCP 规定，在连接建立后所有传送的报文段都必须把 ACK 置 1。

**同步 SYN：** 在连接建立时用来同步序号。当 SYN=1，ACK=0 时表示这是一个连接请求报文段。若对方同意建立连接，则响应报文中 SYN=1，ACK=1。

**终止 FIN：** 用来释放一个连接，当 FIN=1 时，表示此报文段的发送方的数据已发送完毕，并要求释放连接。

**窗口：** 占 2 字节；窗口值作为接收方让发送方设置其发送窗口的依据。之所以要有这个限制，是因为接收方的数据缓存空间是有限的。

**检验和：** 占 2 个字节；检验和字段检验的范围包括首部和数据这两个部分。在计算检验和时，在 TCP 报文段的前面加上 12 字节的伪首部。

**套接字：** TCP 连接的端点叫做套接字或插口。端口号拼接到 IP 地址即构成了套接字。

## TCP 三次握手与四次挥手

### 三次握手（建立连接）

TCP 建立连接需要三次握手，确保双方都能正常收发数据：

1. **第一次握手：** 客户端发送 SYN 报文（SYN=1, seq=x），进入 `SYN_SENT` 状态
2. **第二次握手：** 服务器收到后回复 SYN+ACK 报文（SYN=1, ACK=1, seq=y, ack=x+1），进入 `SYN_RCVD` 状态
3. **第三次握手：** 客户端收到后发送 ACK 报文（ACK=1, seq=x+1, ack=y+1），双方进入 `ESTABLISHED` 状态

**为什么需要三次握手？** 核心原因是防止已失效的连接请求报文到达服务器，导致服务器错误地建立连接、浪费资源。

### 四次挥手（断开连接）

TCP 断开连接需要四次挥手，因为双方需要分别关闭各自的发送通道：

1. **第一次挥手：** 客户端发送 FIN 报文（FIN=1, seq=u），进入 `FIN_WAIT_1` 状态
2. **第二次挥手：** 服务器收到后回复 ACK（ACK=1, ack=u+1），进入 `CLOSE_WAIT` 状态；客户端收到后进入 `FIN_WAIT_2` 状态
3. **第三次挥手：** 服务器发送 FIN 报文（FIN=1, seq=w），进入 `LAST_ACK` 状态
4. **第四次挥手：** 客户端收到后回复 ACK（ACK=1, ack=w+1），进入 `TIME_WAIT` 状态，等待 2MSL 后关闭

**为什么需要四次？** 因为 TCP 是全双工的，每个方向的关闭需要独立进行。服务器收到 FIN 后可能还有数据需要发送，不能立即关闭。

## UDP 的典型应用场景

### 1. DNS 查询

DNS 是 UDP 最经典的应用场景。DNS 查询通常只有一个请求包和一个响应包，数据量很小（通常不到 512 字节）。使用 UDP 可以避免 TCP 的三次握手开销，大幅降低查询延迟。

```bash
# 使用 dig 命令查看 DNS 查询（底层使用 UDP 53端口）
dig example.com A
```

如果 DNS 响应超过 512 字节，DNS 会自动切换到 TCP 进行传输（这称为 DNS over TCP）。此外，现代 DNS 还支持 DNS over HTTPS (DoH) 和 DNS over TLS (DoT)。

### 2. 视频直播

视频直播对**实时性**要求极高，而对少量丢帧有一定容忍度。UDP 的无连接特性使其成为直播协议的首选：

- **RTP/RTCP：** 实时传输协议，基于 UDP，广泛用于音视频传输
- **SRT：** 安全可靠传输协议，基于 UDP，专为低延迟直播设计
- **WebRTC：** 浏览器实时通信，底层使用 UDP + SRTP

在直播场景中，丢一两帧画面用户几乎察觉不到，但如果等待 TCP 重传导致画面卡顿几秒，用户体验会严重下降。

### 3. 在线游戏

在线游戏需要极低的延迟和高频率的状态同步：

- **FPS 游戏：** 每秒可能发送 20-60 次位置更新，延迟要求 <50ms
- **MOBA 游戏：** 技能释放指令必须及时到达，过时的操作状态已无意义
- **语音通信：** 实时语音传输使用 UDP（如 TeamSpeak、Discord 底层）

游戏通常采用 UDP + 应用层序列号的方式，让客户端自行处理乱序和丢包，只关注最新的游戏状态。

### 4. IoT（物联网）

物联网设备通常资源受限（CPU弱、内存小、电池供电），UDP 的轻量特性非常适合：

- **CoAP：** 受限应用协议，基于 UDP，专为 IoT 设计
- **MQTT-SN：** MQTT 的传感器网络版本，支持 UDP 传输
- **NB-IoT/LTE-M：** 窄带物联网大量使用 UDP 进行数据上报

传感器数据通常是周期性上报的小数据包，丢失一次可以在下一个周期补上，不必像 TCP 那样维持长连接。

## PHP 中使用 UDP 的代码示例

### UDP 发送端

```php
<?php
/**
 * UDP 发送端示例
 * 使用 PHP Socket 扩展发送 UDP 数据报
 */

// 创建 UDP Socket
$socket = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
if ($socket === false) {
    die("Socket 创建失败: " . socket_strerror(socket_last_error()) . "\n");
}

// 目标地址和端口
$host = '127.0.0.1';
$port = 9501;
$message = 'Hello, UDP Server!';

// 发送数据
$bytesSent = socket_sendto($socket, $message, strlen($message), 0, $host, $port);
if ($bytesSent === false) {
    echo "发送失败: " . socket_strerror(socket_last_error($socket)) . "\n";
} else {
    echo "成功发送 {$bytesSent} 字节到 {$host}:{$port}\n";
}

// 关闭 Socket
socket_close($socket);
```

### UDP 接收端

```php
<?php
/**
 * UDP 接收端示例
 * 监听指定端口接收 UDP 数据报
 */

// 创建 UDP Socket
$socket = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
if ($socket === false) {
    die("Socket 创建失败: " . socket_strerror(socket_last_error()) . "\n");
}

// 绑定地址和端口
$host = '0.0.0.0';
$port = 9501;

if (socket_bind($socket, $host, $port) === false) {
    die("绑定失败: " . socket_strerror(socket_last_error($socket)) . "\n");
}

echo "UDP 服务器已启动，监听 {$host}:{$port}\n";

// 循环接收数据
while (true) {
    $buffer = '';
    $fromHost = '';
    $fromPort = 0;

    // 接收数据（阻塞模式）
    $bytesReceived = socket_recvfrom($socket, $buffer, 65535, 0, $fromHost, $fromPort);
    
    if ($bytesReceived === false) {
        echo "接收失败: " . socket_strerror(socket_last_error($socket)) . "\n";
        continue;
    }

    echo "收到来自 {$fromHost}:{$fromPort} 的数据 ({$bytesReceived} 字节): {$buffer}\n";

    // 可选：回复发送端
    $reply = "已收到: {$buffer}";
    socket_sendto($socket, $reply, strlen($reply), 0, $fromHost, $fromPort);
}

socket_close($socket);
```

### PHP Stream 方式发送 UDP

```php
<?php
/**
 * 使用 PHP Stream 封装发送 UDP（更简洁的写法）
 */

$host = '127.0.0.1';
$port = 9501;
$message = 'Hello via Stream!';

// 直接通过 stream 发送
$fp = stream_socket_client("udp://{$host}:{$port}", $errno, $errstr);
if (!$fp) {
    die("连接失败: {$errstr} ({$errno})\n");
}

fwrite($fp, $message);
fclose($fp);

echo "数据已发送\n";
```

## UDP 可靠传输的实现思路

虽然 UDP 本身不可靠，但我们可以**在应用层构建可靠性**。以下是两种主流方案：

### QUIC 协议

QUIC（Quick UDP Internet Connections）是由 Google 设计、现已成为 IETF 标准（RFC 9000）的传输层协议。它是 **HTTP/3** 的底层协议，在 UDP 之上实现了：

- **可靠传输：** 类似 TCP 的确认重传机制，但基于独立的流（Stream）
- **多路复用：** 单个连接上支持多个独立的字节流，避免队头阻塞
- **0-RTT 连接建立：** 首次连接 1-RTT，后续连接可 0-RTT
- **内置加密：** 集成 TLS 1.3，握手与加密一步完成
- **连接迁移：** 基于 Connection ID 而非 IP:Port，网络切换不断连

QUIC 的核心思想是：既然 TCP 在内核中难以修改，那就在用户空间基于 UDP 重新实现一套更优秀的传输协议。

### 应用层 ACK

对于自定义协议，可以在应用层实现简单的可靠传输：

```php
<?php
/**
 * 简化的应用层 ACK 机制示例
 */

// 发送方：带序列号和重传
function reliableSend($socket, $data, $host, $port, $maxRetries = 3) {
    static $seqNum = 0;
    $seqNum++;
    
    // 构造带序列号的数据包
    $packet = json_encode([
        'seq' => $seqNum,
        'data' => $data,
        'timestamp' => microtime(true)
    ]);
    
    for ($retry = 0; $retry < $maxRetries; $retry++) {
        socket_sendto($socket, $packet, strlen($packet), 0, $host, $port);
        
        // 设置超时等待 ACK
        socket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, ['sec' => 1, 'usec' => 0]);
        
        $buffer = '';
        $fromHost = '';
        $fromPort = 0;
        $result = socket_recvfrom($socket, $buffer, 1024, 0, $fromHost, $fromPort);
        
        if ($result !== false) {
            $ack = json_decode($buffer, true);
            if (isset($ack['ack']) && $ack['ack'] == $seqNum) {
                return true; // ACK 收到
            }
        }
    }
    
    return false; // 重试耗尽
}

// 接收方：处理数据并发送 ACK
function handlePacket($socket, $buffer, $fromHost, $fromPort) {
    $packet = json_decode($buffer, true);
    if (!isset($packet['seq'])) return;
    
    // 处理数据...
    echo "收到数据 [seq={$packet['seq']}]: {$packet['data']}\n";
    
    // 发送 ACK
    $ack = json_encode(['ack' => $packet['seq']]);
    socket_sendto($socket, $ack, strlen($ack), 0, $fromHost, $fromPort);
}
```

## UDP 网络编程常见踩坑

### 1. 丢包处理

UDP 没有内置的丢包检测和重传机制。在网络拥塞或信号不佳时，数据包可能被静默丢弃：

- **解决思路：** 应用层添加序列号和确认机制（如上文的 ACK 方案）
- **监控手段：** 定期发送心跳包，检测连接是否存活
- **权衡选择：** 根据业务场景决定是否需要重传——对于实时视频，丢帧直接跳过比等待重传更好

### 2. 数据包乱序

UDP 不保证数据包的到达顺序。先发的包可能后到，甚至完全丢失：

- **解决思路：** 在应用层数据中添加序列号，接收端按序列号重组
- **缓冲策略：** 设置接收缓冲区，等待短暂时间后按序交付
- **取舍：** 对于实时性要求高的场景（如游戏），可以直接使用最新数据，忽略过期的旧包

### 3. 拥塞控制缺失

UDP 没有拥塞控制，如果应用层不加限制地高速发送数据，可能导致：

- **网络拥塞：** 大量 UDP 流量可能导致路由器丢包，影响同网络的其他流量
- **公平性问题：** TCP 有拥塞退避机制，无限制的 UDP 会"抢占"带宽
- **被运营商限制：** 部分 ISP 会对大流量 UDP 进行限速或 QoS 降级

**解决思路：** 在应用层实现简单的拥塞控制，如：
- 基于丢包率动态调整发送速率
- 使用令牌桶算法限制发送速度
- 参考 QUIC 的拥塞控制算法（如 BBR、CUBIC）

### 4. 数据报大小限制

UDP 数据报建议不超过 **MTU**（通常 1500 字节，减去 IP 和 UDP 首部后有效载荷约 1472 字节）：

- 超过 MTU 的 UDP 数据报会在 IP 层分片
- IP 分片后任何一个片段丢失，整个数据报都会被丢弃（接收端无法重组）
- 分片还会增加路由器和接收端的处理负担

### 5. 广播和多播的注意事项

UDP 支持广播和多播，但使用时需注意：

- **广播**（如 `255.255.255.255`）仅在同一子网内有效，路由器默认不转发
- **多播**（如 `224.0.0.0/4`）需要网络设备和操作系统支持 IGMP
- 多播不会自动穿越 NAT，需要特殊处理

## 相关阅读

- [TCP/IP协议](/categories/Network/tcp-ip/)
- [HTTP协议](/categories/Network/http/)
- [Socket编程](/categories/Network/socket/)
- [HTTP状态码](/categories/Network/status-codes/)
- [三次握手](/categories/Network/three-way-handshake/)
- [四次挥手](/categories/Network/four-way-close/)