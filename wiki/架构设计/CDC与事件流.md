# CDC 与事件流（Change Data Capture）

## 定义

CDC（Change Data Capture，变更数据捕获）是一种**捕获数据库变更事件并将其流式传播到下游系统**的技术模式。它不侵入业务代码，而是从数据库日志（如 MySQL binlog）中提取变更，转化为事件流供其他系统消费。

## 核心原理

### 1. CDC 工作原理

```
┌──────────┐    binlog/WAL    ┌──────────┐    事件流    ┌──────────┐
│  MySQL   │ ───────────────→ │  CDC 工具 │ ──────────→ │  Kafka   │
│ (源数据库)│                  │ (Debezium)│             │ (事件总线)│
└──────────┘                  └──────────┘              └────┬─────┘
                                                             │
                                         ┌───────────────────┼───────────────┐
                                         │                   │               │
                                    ┌────▼────┐        ┌────▼────┐    ┌────▼────┐
                                    │ ES 索引 │        │ 缓存刷新│    │ 数据仓库│
                                    └─────────┘        └─────────┘    └─────────┘
```

### 2. CDC vs 传统同步方式

| 方式 | 侵入性 | 延迟 | 数据一致性 | 复杂度 |
|------|--------|------|-----------|--------|
| 业务代码双写 | 高 | 低 | 弱（两阶段） | 中 |
| 定时轮询 | 低 | 高（分钟级） | 最终一致 | 低 |
| 触发器 | 中 | 低 | 强 | 高 |
| **CDC（binlog）** | **无** | **低（秒级）** | **最终一致** | **中** |

### 3. Debezium 核心组件

- **Source Connector**：连接 MySQL/PostgreSQL/MongoDB 等，读取变更日志
- **Kafka Connect**：Debezium 运行在 Kafka Connect 框架上
- **Schema Registry**：管理事件 Schema 演进（Avro/Protobuf/JSON Schema）
- **Transforms (SMT)**：单消息转换，如字段重命名、过滤、路由

### 4. 事件格式

```json
{
  "before": { "id": 1, "status": "pending", "amount": 100 },
  "after":  { "id": 1, "status": "paid", "amount": 100 },
  "source": { "connector": "mysql", "db": "orders", "table": "orders" },
  "op": "u",
  "ts_ms": 1717401600000
}
```

- `op`：操作类型（c=创建, u=更新, d=删除, r=快照读取）
- `before/after`：变更前后的完整行数据

### 5. CDC 与 Event Sourcing 的关系

| 维度 | CDC | Event Sourcing |
|------|-----|----------------|
| 事件粒度 | 数据库行变更 | 业务领域事件 |
| 语义 | "字段 A 从 X 变成 Y" | "订单已支付" |
| 事件源 | 数据库日志 | 应用代码主动发布 |
| Schema | 跟随数据库表结构 | 独立于存储 |
| 适用场景 | 数据同步、缓存刷新 | 业务逻辑回放、审计 |

**互补架构**：CDC 负责数据层同步，Event Sourcing 负责业务层事件。两者可以共存——业务事件通过 Event Sourcing 发布，数据变更通过 CDC 同步到搜索/缓存/数仓。

## 实战案例

来自博客文章：
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/2026/06/01/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [Schema Registry 实战：Confluent/Apicurio API 契约演进——事件驱动系统中的 Schema 兼容性治理](/2026/06/01/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/)

### Laravel 集成方案

1. **Debezium → Kafka → Laravel Consumer**：Laravel 队列 Worker 消费 CDC 事件
2. **缓存刷新**：订单状态变更时，通过 CDC 自动清除 Redis 缓存
3. **ES 索引同步**：商品数据变更自动同步到 Elasticsearch
4. **数据仓库 ETL**：替代传统 ETL 脚本，实时流式导入

## 相关概念

- [事件驱动架构](事件驱动架构.md) - CDC 是事件驱动的数据层实现
- [CQRS 模式](CQRS模式.md) - CDC 驱动读模型更新
- [微服务架构](微服务架构.md) - 跨服务数据同步的解决方案
- [分布式事务](分布式事务.md) - CDC 可用于实现 Saga 模式的事件传播

## 常见问题

### Q: CDC 会增加数据库负担吗？
A: Debezium 直接读取 binlog，不执行额外查询，对数据库几乎没有性能影响。但需要确保 binlog 保留足够时间。

### Q: 如何处理 Schema 变更？
A: 通过 Schema Registry 的兼容性策略（BACKWARD/FORWARD/FULL）管理。新增字段用默认值，删除字段先标记废弃。

### Q: CDC 的延迟是多少？
A: 通常秒级（1-5 秒）。取决于 Kafka Connect 的 `poll.interval.ms` 配置和网络延迟。

### Q: 如何保证事件顺序？
A: 同一行的变更保证有序（通过 binlog position）。不同行之间不保证全局有序，需要业务层处理。
