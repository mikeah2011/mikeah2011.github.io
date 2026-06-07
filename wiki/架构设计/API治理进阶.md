# API治理进阶

## 定义

API治理进阶是指在基础的 API 设计规范（RESTful、OpenAPI）之上，引入更高级的治理手段来应对复杂分布式系统中的挑战。本页面涵盖三个关键主题：

1. **API Composition Pattern（API 组合模式）**：在 [BFF模式](BFF模式.md) 或网关层聚合多个下游服务的响应，解决跨服务查询的"扇出-聚合"（Scatter-Gather）问题
2. **AsyncAPI**：事件驱动架构的 API 规范，类似于 REST API 的 OpenAPI，但面向异步消息和事件流
3. **ADR（Architectural Decision Records）**：用 Markdown 文件记录架构决策的上下文、选项和结论，形成可追溯的架构知识库

这三个主题分别对应 API 治理的"查询聚合"、"异步规范"和"决策管理"三个维度，是 [微服务架构](微服务架构.md) 成熟演进中不可或缺的治理能力。

## 核心原理

### 1. API Composition Pattern（API 组合模式）

#### 问题场景

在微服务架构中，一个前端页面可能需要来自多个服务的数据。例如，电商订单详情页需要：
- 订单服务（Order Service）：订单基本信息
- 用户服务（User Service）：用户姓名和地址
- 商品服务（Product Service）：商品名称和价格
- 库存服务（Inventory Service）：库存状态

如果前端分别调用 4 个服务，会导致：
- 前端逻辑复杂，需处理 4 次网络请求和数据拼装
- 前端直接依赖所有下游服务，违反封装原则
- 无法在服务端进行跨服务过滤、排序、分页

#### Scatter-Gather 模式

API Composition 的核心是 Scatter-Gather（分散-聚合）模式：

```
Client Request
     │
     ▼
┌─────────────────┐
│  API Composer    │
│  (BFF / Gateway) │
├─────────────────┤
│ 1. Scatter:     │
│   ┌─────┬─────┬─▼───┐
│   │Order│User │Prod  │  ← 并行调用多个服务
│   └──┬──┴──┬──┴──┬───┘
│      │     │     │
│ 2. Gather:        │
│   ┌▼─────▼─────▼─┐ │
│   │ 合并、过滤、  │ │
│   │ 排序、分页    │ │
│   └──────────────┘ │
└─────────┬──────────┘
          ▼
    Aggregated Response
```

#### 实现策略

**并行 vs 串行**：
```php
// 并行调用（推荐，适用于无依赖关系的查询）
[$order, $user, $products] = await([
    fn() => $this->orderService->getOrder($orderId),
    fn() => $this->userService->getUser($userId),
    fn() => $this->productService->getProducts($productIds),
]);

// 串行调用（当存在依赖关系时）
$order = $this->orderService->getOrder($orderId);
$user = $this->userService->getUser($order->user_id);
```

**降级策略**：
- 部分服务失败时返回降级数据（如"用户信息加载失败"）
- 设置合理的超时（每个服务调用设独立超时）
- 使用 Circuit Breaker 防止级联失败

**缓存策略**：
- 在 Composer 层缓存不常变化的数据（如商品名称、用户基本信息）
- 使用 ETag/Last-Modified 进行条件请求
- 缓存粒度：按数据类型设置不同的 TTL

#### 与 GraphQL 的对比

| 维度 | API Composition | GraphQL |
|------|----------------|---------|
| 查询灵活性 | 由 Composer 预定义 | 客户端自由组合 |
| 类型系统 | 无强制 | 强类型 Schema |
| 复杂度 | 低，REST 友好 | 高，需学习 GraphQL |
| 适用场景 | 前端已知、固定的聚合查询 | 需要灵活查询的场景 |
| N+1 问题 | 手动优化 | DataLoader 自动优化 |

### 2. AsyncAPI：事件驱动架构的 API 规范

#### 背景

[事件驱动架构](事件驱动架构.md) 中，服务间通过消息和事件通信，但长期以来缺乏像 OpenAPI 这样的标准化描述规范。AsyncAPI 填补了这一空白。

#### 核心概念

AsyncAPI 规范定义了：
- **Channel**：消息通道（对应 Topic/Queue）
- **Message**：消息的 Schema 和描述
- **Operation**：publish（发布）或 subscribe（订阅）
- **Server**：消息中间件的连接信息

#### AsyncAPI 文档示例

```yaml
asyncapi: '3.0.0'
info:
  title: Order Service Events
  version: '1.0.0'

servers:
  production:
    host: rabbitmq:5672
    protocol: amqp

channels:
  order.created:
    address: order.created
    messages:
      orderCreated:
        $ref: '#/components/messages/OrderCreated'
    description: 订单创建事件

  order.paid:
    address: order.paid
    messages:
      orderPaid:
        $ref: '#/components/messages/OrderPaid'

operations:
  publishOrderCreated:
    action: send
    channel:
      $ref: '#/channels/order~1created'
    summary: 订单服务发布订单创建事件

  subscribeOrderCreated:
    action: receive
    channel:
      $ref: '#/channels/order~1created'
    summary: 库存服务订阅订单创建事件

components:
  messages:
    OrderCreated:
      payload:
        type: object
        properties:
          order_id:
            type: string
          user_id:
            type: integer
          items:
            type: array
            items:
              $ref: '#/components/schemas/OrderItem'

  schemas:
    OrderItem:
      type: object
      properties:
        product_id:
          type: integer
        quantity:
          type: integer
        price:
          type: number
```

#### AsyncAPI 工具链

- **代码生成**：根据 AsyncAPI 文档自动生成 PHP/Python/Go 的消息发布者和消费者代码
- **Mock Server**：根据文档自动生成 Mock 消息服务，用于前端开发和测试
- **文档生成**：生成交互式 API 文档（类似 Swagger UI）
- **验证**：运行时验证消息格式是否符合 AsyncAPI Schema
- **Studio**：在线可视化编辑器（https://studio.asyncapi.com）

#### 与 OpenAPI 的对比

| 维度 | OpenAPI | AsyncAPI |
|------|---------|---------|
| 协议 | HTTP/REST | AMQP, MQTT, Kafka, WebSocket |
| 通信模式 | 同步请求-响应 | 异步发布-订阅 |
| 核心元素 | Path, Operation, Schema | Channel, Message, Operation |
| 工具成熟度 | 非常成熟 | 快速成长中 |
| 治理价值 | API 文档、Mock、测试 | 事件文档、Mock、Schema 验证 |

### 3. ADR（Architectural Decision Records）

#### 为什么需要 ADR

架构决策往往在会议、即时通讯中做出，缺乏记录导致：
- 新成员无法理解决策背景
- 同样的问题反复讨论
- 无法追溯"当初为什么这样设计"

#### ADR 模板

```markdown
# ADR-0042: 订单服务使用事件溯源模式

## 状态
已接受 (2026-05-15)

## 上下文
订单状态变更频繁，需要完整的状态变更历史用于审计和问题排查。
当前的 CRUD 模式无法满足"回溯任意时间点订单状态"的需求。

## 决策
订单服务采用事件溯源（Event Sourcing）模式，使用 Kafka 作为事件存储。

## 选项
1. **事件溯源 + Kafka** — 选中
   - 优势：完整审计轨迹、支持回放、天然集成[事件驱动架构](事件驱动架构.md)
   - 劣势：查询复杂度高、需要 CQRS 配合
2. **数据库审计日志**
   - 优势：实现简单、对现有架构影响小
   - 劣势：缺乏领域语义、查询能力有限
3. **双写（主表 + 审计表）**
   - 优势：查询方便
   - 劣势：数据一致性挑战

## 后果
- 需要引入 CQRS 模式处理查询
- 需要建设事件 Schema 管理能力
- 团队需要学习事件溯源模式
- 与 [六边形架构](六边形架构.md) 的端口-适配器模式天然兼容

## 相关 ADR
- ADR-0035: 微服务间通信采用事件驱动
- ADR-0040: 统一使用 AsyncAPI 描述事件
```

#### ADR 管理最佳实践

- **编号连续**：ADR-0001, ADR-0002...便于引用
- **状态管理**：提议 → 已接受 → 已废弃 → 已取代
- **存放在代码仓库**：`docs/adr/` 或 `adr/` 目录，与代码一起版本管理
- **工具支持**：adr-tools (CLI)、Log4brains (Web UI)、Markdown 编辑器
- **定期回顾**：每季度回顾已接受的 ADR，标记过时的为"已废弃"

## 实战案例

### API Composition Pattern 实战

来自博客文章：[API Composition Pattern 实战：跨服务查询聚合 - Laravel BFF scatter-gather](/2026/06/03/API-Composition-Pattern-实战-跨服务查询聚合-Laravel-BFF-scatter-gather/)

该文章演示了在 Laravel BFF 层实现 Scatter-Gather 模式，聚合多个微服务的数据返回给前端，包含并行调用、超时控制、降级策略的完整实现。

### AsyncAPI 实战

来自博客文章：[AsyncAPI 实战：事件驱动架构的 API 规范 - Laravel微服务中的事件文档化Mock与代码生成](/2026/06/01/AsyncAPI-实战-事件驱动架构的API规范-Laravel微服务中的事件文档化Mock与代码生成/)

该文章演示了如何在 Laravel 微服务中使用 AsyncAPI 规范化描述事件消息、生成代码、搭建 Mock 服务。

### ADR 实战

来自博客文章：[ADR 实战：用 Markdown 管理架构决策](/2026/06/01/Architectural-Decision-Records-ADR-实战-用Markdown管理架构决策/)

该文章演示了如何在项目中建立 ADR 实践，使用 adr-tools 管理决策记录，以及与团队协作的最佳实践。

## 相关概念

- [BFF模式](BFF模式.md)
- [API网关](API网关.md)
- [微服务架构](微服务架构.md)
- [事件驱动架构](事件驱动架构.md)
- [六边形架构](六边形架构.md)

## 常见问题

### Q: API Composition 和 BFF 模式的关系？

[BFF模式](BFF模式.md) 是一种架构模式，定义了"为特定前端定制的聚合层"；API Composition 是 BFF 内部实现数据聚合的具体技术手段。一个 BFF 可以使用 API Composition 来聚合多个下游服务的数据。

### Q: 何时用 AsyncAPI 而不是 OpenAPI？

当你的服务间通信主要是异步消息（RabbitMQ、Kafka、Redis Streams）时，使用 AsyncAPI。当是同步 HTTP 调用时，使用 OpenAPI。在微服务中，一个服务通常同时有两种：对外暴露 OpenAPI，内部事件用 AsyncAPI。

### Q: ADR 应该由谁来写？

任何做出或参与架构决策的人都可以写。推荐的做法是：决策提议者负责起草，团队评审后合并。不要求只有架构师才能写 ADR，鼓励所有开发者参与。

### Q: 如何处理 ADR 之间的冲突或取代？

使用"已取代"状态，并在新 ADR 中引用被取代的 ADR。例如："ADR-0050 取代 ADR-0042"。被取代的 ADR 保留在仓库中作为历史记录。

### Q: API Composition 如何处理分页和排序？

对于跨服务分页，常见策略：
1. **优先从一个主服务分页**：如订单列表分页从订单服务获取，再聚合其他服务数据
2. **内存聚合后分页**：适用于数据量小的场景
3. **搜索引擎辅助**：将聚合数据写入 Elasticsearch，在搜索层分页
