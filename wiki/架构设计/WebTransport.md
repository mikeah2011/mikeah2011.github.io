# WebTransport

## 定义

WebTransport 是基于 HTTP/3（QUIC 协议）的双向低延迟传输协议，提供三种传输模式：双向流（可靠有序）、单向流（服务端推送）和数据报（不可靠无序）。相比 WebSocket 基于 TCP 的全双工通信，WebTransport 通过 QUIC 的 UDP 多路复用消除了队头阻塞，在高丢包网络环境下性能显著优于 WebSocket。

## 核心原理

### 协议栈对比

```
WebSocket:  应用层 → WebSocket 协议 → TLS → TCP → IP
WebTransport: 应用层 → WebTransport API → HTTP/3 → QUIC(UDP) → IP
```

### 三种传输模式

| 模式 | 可靠性 | 有序性 | 适用场景 |
|------|--------|--------|----------|
| 双向流 (Bidirectional Stream) | ✅ 可靠 | ✅ 有序 | 聊天消息、命令交互 |
| 单向流 (Unidirectional Stream) | ✅ 可靠 | ✅ 有序 | 服务端推送、日志流 |
| 数据报 (Datagram) | ❌ 不可靠 | ❌ 无序 | 游戏状态、实时音视频、传感器数据 |

**数据报是 WebTransport 的关键差异化能力**——WebSocket 没有等价模式。对于可以容忍丢帧但不能容忍延迟的场景（如游戏、直播），数据报模式避免了 TCP 重传等待。

### QUIC 核心优势

- **0-RTT 连接建立**：首次握手 1-RTT，后续重连 0-RTT（TCP+TLS 需要 2-3 RTT）
- **内置 TLS 1.3**：无需额外 TLS 层，加密是协议内置的
- **独立流控**：每个流独立的流量控制，一个流的丢包不影响其他流（消除队头阻塞）
- **连接迁移**：客户端 IP 变化时连接不断开（基于 Connection ID 而非 IP:Port）

### 性能对比（5% 丢包率）

| 指标 | WebSocket | WebTransport | 提升 |
|------|-----------|--------------|------|
| P99 延迟 | 380ms | 45ms | 8.4× |
| 重连时间 | 200ms | 15ms | 13.3× |
| 抖动 | 85ms | 12ms | 7.1× |

**关键发现**：理想网络（0% 丢包）下两者无差异。在真实移动网络（5% 丢包）中，WebTransport 性能提升 3-10 倍。重连速度提升 10-20 倍对移动端用户体验影响最大。

### 浏览器支持

- Chrome 97+ / Edge 97+：完整支持
- Safari：开发中（需 WebSocket 回退方案）
- Firefox：实验性支持

**生产策略**：必须实现 WebSocket 回退——检测 WebTransport 可用性，不可用时自动降级到 WebSocket。

### 服务端实现

| 语言 | 库 | 内存占用（10K 连接） |
|------|-----|---------------------|
| Go | quic-go / webtransport-go | ~120MB |
| Rust | wtransport | ~70-80MB |

### Laravel 集成架构

```
Laravel App → Redis Pub/Sub → WebTransport Gateway (Go/Rust) → 客户端
                    ↓
           自定义 WebTransportBroadcaster
           扩展 Laravel Broadcasting Driver
```

Laravel 不直接提供 WebTransport 服务，而是通过桥接模式：
1. Laravel 事件通过 Broadcasting 发布到 Redis
2. 独立的 Go/Rust WebTransport Gateway 订阅 Redis
3. Gateway 通过 WebTransport 推送给客户端

### 渐进式迁移策略

```
Phase 1: WebTransport Gateway 部署 + WebSocket 保持
Phase 2: 客户端双协议支持 + 自动降级
Phase 3: 流量灰度切换（10% → 50% → 100%）
Phase 4: WebSocket 降级为只读备份
```

## 实战案例

来自博客文章：[WebTransport 实战：HTTP/3 上的双向通信——对比 WebSocket 的低延迟传输协议与 Laravel 实时应用集成](/2026/06/05/WebTransport-实战-HTTP3-双向通信-对比WebSocket低延迟传输协议-Laravel实时应用集成/)

**关键技术点**：
- `WebTransportClient` JavaScript 类（自动重连 + 指数退避）
- `UnifiedRealtimeTransport` 统一传输层（WT→WS 自动降级）
- Go Gateway 实现（ChatServer + 房间管理 + 数据报处理）
- Rust Gateway 实现（wtransport crate，内存占用降低 30-40%）
- `WebTransportBroadcaster` Laravel 自定义广播驱动
- Caddy 自动 HTTP/3 配置 / Nginx 1.25+ 配置

## 相关概念

- [实时通信方案](实时通信方案.md) - SSE vs WebSocket vs HTTP Streaming 对比
- [并发模型对比](并发模型对比.md) - 异步 I/O 与事件驱动模型
- [BFF 模式](BFF模式.md) - BFF 层实时推送架构
- [Server-Driven UI](Server-Driven-UI.md) - 后端驱动前端实时渲染
- [限流与高并发](限流与高并发.md) - WebTransport 数据报的流控策略

## 常见问题

**Q: WebTransport 能完全替代 WebSocket 吗？**
A: 不能。Safari 支持尚在开发中，必须保留 WebSocket 回退。推荐使用 `UnifiedRealtimeTransport` 统一封装，根据浏览器能力自动选择协议。

**Q: 如何配置 TLS 和 UDP 端口？**
A: WebTransport 基于 HTTP/3，需要 TLS 1.3 和 UDP 端口（默认 443）。Caddy 2 自动支持 HTTP/3。Nginx 需要 1.25+ 版本并配置 `http3` 指令。注意防火墙需放行 UDP 端口。

**Q: 连接数规划？**
A: 每个 WebTransport 连接基础内存 50-80KB。10K 连接需要约 500MB-800MB。Go 服务端建议 2 核 4GB 起步。Rust 服务端可节省 30-40% 内存。

**Q: 数据报模式丢了数据怎么办？**
A: 数据报不保证送达。应用层需要自行实现丢包检测和重传逻辑（如序列号 + ACK 机制），或使用双向流模式替代。适用于能容忍少量丢帧的场景（游戏状态同步、实时音视频）。
