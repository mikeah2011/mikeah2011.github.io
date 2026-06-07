# CQRS 模式（Command Query Responsibility Segregation）

## 定义

CQRS 将系统的**写操作（Command）** 和 **读操作（Query）** 分离到不同的模型甚至不同的数据库中。写侧负责业务规则和数据变更，读侧负责高效查询和数据展示。两者通过事件异步同步。

## 核心原理

### 架构对比

```
传统 Repository 模式：
  Controller → Repository → Eloquent Model → MySQL
                ↑↓ 读写混用

CQRS 分离后：
  Command Bus → Command Handler → Domain → Write DB
                      ↓ Domain Events
                  Event Handler → Read Model → Read DB

  Query Bus → Query Handler → Read Model → Read DB
```

### 三阶段渐进式演进

**阶段一：Command/Query 分离（轻量级）**
不引入额外数据库，仅在代码层面分离 Command 和 Query：

```
app/Domains/Order/
├── Commands/
│   ├── PlaceOrderCommand.php
│   └── PlaceOrderHandler.php
├── Queries/
│   ├── GetOrderDetailQuery.php
│   └── GetOrderDetailHandler.php
└── Events/
    └── OrderPlaced.php
```

**阶段二：读模型独立**
引入物化视图或独立的读模型表，写模型保持范式化，读模型反范式化。

**阶段三：读写数据库分离**
写入 MySQL，读取 Elasticsearch/Redis，通过 Domain Events 异步同步。

### 核心设计原则

| 原则 | 说明 |
|------|------|
| **Command 表达意图** | `PlaceOrderCommand` 而非 `UpdateOrderStatus` |
| **Query 无副作用** | 读操作不修改任何数据 |
| **事件驱动同步** | 写入后发布 Domain Event，读模型异步消费 |
| **读模型可重建** | 读模型是写模型的投影，可从事件重建 |

### 何时需要 CQRS

| 场景 | 是否需要 CQRS |
|------|--------------|
| CRUD 为主，读写比例均衡 | ❌ 不需要 |
| 查询复杂（多表 JOIN、聚合统计） | ✅ 读模型独立 |
| 读写比例悬殊（100:1） | ✅ 读写分别扩缩容 |
| 需要 Elasticsearch/Redis 做读 | ✅ 读模型独立存储 |
| 简单的内部管理系统 | ❌ 过度设计 |

## 实战案例

来自博客文章：[CQRS 模式实战：读写分离架构在 Laravel 中的落地](/2026/05/05/cqrs-guide-architecture-laravel-queryperformance/)

**踩坑经验**：
- 不搞大爆炸重写，按模块逐步拆分
- 写入侧保持范式化表结构，读模型反范式化 + ES 全文搜索
- 缓存命中率从 40% 提升到 85%+（读模型独立后缓存策略更清晰）

## 相关概念

- [DDD 领域驱动设计](DDD领域驱动设计.md) - CQRS 的领域层基础
- [事件驱动架构](事件驱动架构.md) - CQRS 的事件同步机制
- [微服务架构](微服务架构.md) - CQRS 可在单体或微服务中使用

## 常见问题

**Q: CQRS 必须配合 Event Sourcing 吗？**
A: 不必须。CQRS 可以独立使用（代码层面分离即可），Event Sourcing 是可选的进阶方案。

**Q: 读写数据不一致怎么办？**
A: 这是 CQRS 的固有特性——最终一致性。通过补偿机制、对账任务、前端乐观更新来缓解。

**Q: Laravel 中怎么实现 CQRS？**
A: 轻量方案用 Command Bus（Laravel 原生支持），进阶方案用独立读库 + Event Handler 同步。
