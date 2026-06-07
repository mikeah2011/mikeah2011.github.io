# Supabase Realtime

## 定义

Supabase Realtime 是基于 PostgreSQL 逻辑复制和 Elixir/BEAM 构建的实时数据推送服务，提供三大核心能力：**Broadcast**（自定义事件广播）、**Presence**（在线状态管理）和 **Postgres Changes**（数据库变更实时推送）。可与 Laravel 后端无缝集成，实现"写数据库即推送"的实时架构。

## 核心原理

### 架构全景

```
前端 (WebSocket) ──→ Realtime Server (Elixir/BEAM) ──→ PostgreSQL (Logical Repl.)
                              ↑
                         Laravel 后端 (REST/SQL)
```

Realtime Server 通过 PostgreSQL 的逻辑复制槽（Replication Slot）读取 WAL 变更记录，转化为实时事件推送给客户端。Laravel 后端正常写数据库，不需要任何推送逻辑。

### 三大核心能力

#### 1. Broadcast（自定义事件广播）

适合实时通知、聊天消息、协作编辑等场景：

```javascript
const channel = supabase.channel('room-1')
channel.on('broadcast', { event: 'message' }, (payload) => {
    console.log('收到消息:', payload)
})
channel.subscribe()
channel.send({ type: 'broadcast', event: 'message', payload: { text: 'hello' } })
```

#### 2. Presence（在线状态管理）

适合在线用户列表、协作光标、"正在输入"状态：

```javascript
const channel = supabase.channel('online-users')
channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    console.log('在线用户:', state)
})
channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
        await channel.track({ user_id: user.id, username: user.name })
    }
})
```

#### 3. Postgres Changes（数据库变更推送）

数据库行级变更自动推送到前端：

```javascript
const channel = supabase.channel('db-changes')
    .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${userId}`
    }, (payload) => {
        console.log('订单变更:', payload)
    })
    .subscribe()
```

### 认证机制

| 认证方式 | 适用场景 |
|---------|---------|
| 匿名密钥（Anon Key） | 公开数据，配合 RLS 控制访问 |
| 服务角色密钥（Service Role Key） | 后端完全访问，绕过 RLS |
| 自定义 JWT Token | 复用 Laravel Sanctum 用户体系 |

## Laravel 集成

### 典型集成架构

1. 用户通过 Laravel Sanctum 登录
2. Laravel 生成 Supabase 兼容 JWT Token 返回前端
3. 前端用 Token 初始化 Supabase 客户端并连接 Realtime
4. Laravel 写数据库 → PostgreSQL 逻辑复制 → Realtime 推送到前端

### 前端 RealtimeManager 封装

```javascript
class RealtimeManager {
    constructor(supabaseUrl, token) {
        this.client = createClient(supabaseUrl, token)
        this.channels = new Map()
    }

    subscribe(table, filter, callback) {
        const key = `${table}:${filter}`
        if (this.channels.has(key)) return this.channels.get(key)

        const channel = this.client.channel(`changes:${key}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table, filter
            }, callback)
            .subscribe()

        this.channels.set(key, channel)
        return channel
    }
}
```

### 指数退避重连

```javascript
let retryCount = 0
const maxRetries = 10
const baseDelay = 1000

channel.on('system', {}, ({ status }) => {
    if (status === 'CHANNEL_ERROR' && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount++)
        setTimeout(() => channel.subscribe(), delay)
    }
})
```

## 与传统方案对比

| 方案 | 成本 | 延迟 | 运维复杂度 | 与 PG 集成 |
|------|------|------|-----------|-----------|
| Supabase Realtime | 免费（自托管）/ 按量 | 低 | 低 | 原生 |
| Pusher | 按消息量付费 | 低 | 低 | 需应用层推送 |
| Laravel Echo Server | 免费（自建） | 低 | 中（需 Redis） | 需应用层推送 |
| Ably | 按消息量付费 | 极低 | 低 | 需应用层推送 |

## 实战案例

来自博客文章：
- [Supabase Realtime 实战：数据库变更实时推送——Broadcast/Presence/Postgres Changes 与 Laravel 实时架构集成](/categories/数据库/Supabase-Realtime-实战-数据库变更实时推送/)

## 相关概念

- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - PostgreSQL 生态优势
- [实时通信方案](../架构设计/实时通信方案.md) - SSE vs WebSocket vs HTTP Streaming
- [CDC 与事件流](../架构设计/CDC与事件流.md) - 变更数据捕获模式
- [Read-Write Split 中间件](读写分离中间件.md) - 数据库读写分离

## 常见问题

**Q: REPLICA IDENTITY 设置错误会怎样？**
A: Postgres Changes 需要表的 REPLICA IDENTITY 设置为 FULL 才能获取旧行数据。设置为 DEFAULT 时，UPDATE/DELETE 事件的 old_record 将为空。需要执行 `ALTER TABLE orders REPLICA IDENTITY FULL;`。

**Q: 如何处理连接风暴？**
A: 前端使用指数退避重连策略，后端通过 RLS 策略限制可见数据范围，减少不必要的连接。自托管场景下部署多个 Realtime Server 实例做负载均衡。

**Q: Supabase Realtime 与 Debezium CDC 有什么区别？**
A: Supabase Realtime 面向前端实时推送（WebSocket），Debezium 面向后端系统间数据同步（Kafka）。两者都基于 PostgreSQL 逻辑复制，但使用场景不同。
