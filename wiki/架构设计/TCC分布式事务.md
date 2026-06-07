# TCC 分布式事务

## 定义

TCC（Try-Confirm-Cancel）是一种两阶段提交的分布式事务模式，将每个参与者的操作分为三个阶段：Try（预留资源）、Confirm（确认提交）或 Cancel（回滚释放）。与 Saga 的补偿模式不同，TCC 在 Try 阶段就预留资源，通过业务层面的资源锁定实现强一致性语义，而非事后补偿。

## 核心原理

### 三阶段流程

```
Try 阶段（资源预留）:
  订单服务: 创建待确认订单（status=pending）
  库存服务: 预扣库存（available -= N, frozen += N）
  支付服务: 冻结金额（balance -= N, frozen += N）

Confirm 阶段（确认提交）:
  订单服务: 确认订单（status=confirmed）
  库存服务: 确认扣减（frozen -= N）
  支付服务: 确认扣款（frozen -= N）

Cancel 阶段（回滚释放）:
  订单服务: 取消订单（status=cancelled）
  库存服务: 释放预扣（available += N, frozen -= N）
  支付服务: 解冻金额（balance += N, frozen -= N）
```

### TCC vs Saga 对比

| 维度 | TCC | Saga |
|------|-----|------|
| 一致性模型 | Try 阶段预留资源，接近强一致 | 最终一致，补偿回滚 |
| 资源锁定 | 显式预留（frozen 字段） | 无预留，补偿时反向操作 |
| 业务侵入性 | 高（需设计 Try/Confirm/Cancel 三个接口） | 中（正向操作 + 补偿操作） |
| 性能 | 资源锁定时间短，吞吐高 | 无锁定，但补偿有额外开销 |
| 适用场景 | 金融支付、库存扣减等强一致场景 | 长事务、跨多服务编排 |
| 空回滚问题 | 需处理（Try 未到达就 Cancel） | 无此问题 |
| 悬挂问题 | 需处理（Cancel 后 Try 才到达） | 无此问题 |

### 三个异常场景

**1. 空回滚（Empty Rollback）**
- 场景：Try 请求超时未到达，协调者直接调用 Cancel
- 问题：Cancel 不知道 Try 是否执行过
- 方案：记录事务 ID，Cancel 时检查是否有关联的 Try 记录

**2. 悬挂（Suspension）**
- 场景：Cancel 执行完毕后，延迟的 Try 请求才到达
- 问题：Try 预留的资源永远不会被 Confirm 或 Cancel
- 方案：Try 执行前检查事务 ID 是否已被 Cancel，若是则拒绝执行

**3. 幂等性（Idempotency）**
- 场景：Confirm/Cancel 因网络重试被多次调用
- 方案：每个操作基于事务 ID 做幂等检查，使用数据库唯一约束或 Redis SETNX

### 资源预留设计

```sql
-- 库存表设计
ALTER TABLE products ADD COLUMN frozen_stock INT DEFAULT 0;

-- Try: 预扣库存
UPDATE products SET 
  available_stock = available_stock - #{quantity},
  frozen_stock = frozen_stock + #{quantity}
WHERE id = #{productId} AND available_stock >= #{quantity};

-- Confirm: 确认扣减
UPDATE products SET frozen_stock = frozen_stock - #{quantity}
WHERE id = #{productId};

-- Cancel: 释放预扣
UPDATE products SET 
  available_stock = available_stock + #{quantity},
  frozen_stock = frozen_stock - #{quantity}
WHERE id = #{productId};
```

### 超时与恢复机制

```
Try 超时 → 触发 Cancel（空回滚处理）
Confirm 失败 → 重试（幂等保障）
Cancel 失败 → 重试（幂等保障）
定期对账 → 扫描超时未完成事务 → 触发 Cancel
```

TCC 模式需要一个事务协调者（Transaction Coordinator）管理全局事务的生命周期：
1. 开启全局事务，获取全局事务 ID
2. 依次调用各参与者的 Try 接口
3. 全部 Try 成功 → 依次调用 Confirm
4. 任一 Try 失败 → 依次调用 Cancel
5. 超时未完成 → 定时任务触发 Cancel

## 实战案例

来自博客文章：[TCC 分布式事务模式实战：Try-Confirm-Cancel 在 Laravel 订单/支付/库存中的落地](/2026/06/01/TCC-分布式事务模式实战-Try-Confirm-Cancel-Laravel-订单支付库存落地/)

**关键技术点**：
- `TccTransaction` 事务模型（全局事务 ID + 参与者列表 + 状态机）
- `OrderService` / `InventoryService` / `PaymentService` 三个 TCC 参与者实现
- 空回滚防护：Redis `SETNX` 记录已 Cancel 的事务 ID
- 悬挂防护：Try 执行前检查事务 ID 状态
- 幂等保障：数据库唯一约束 `(transaction_id, participant_id)`
- 定时对账任务：扫描超时 30 分钟未完成事务
- Laravel 队列驱动 Confirm/Cancel 异步重试

## 相关概念

- [分布式事务](分布式事务.md) - Saga/TCC/本地消息表全景对比
- [事件最终一致性](事件最终一致性.md) - Outbox/Inbox 模式的最终一致性方案
- [订单状态机](订单状态机.md) - TCC 与订单状态流转的配合
- [限流与高并发](限流与高并发.md) - 秒杀场景 TCC 与 Redis 预扣减
- [分布式缓存一致性](分布式缓存一致性.md) - TCC 中缓存与数据库的一致性

## 常见问题

**Q: TCC 和 Saga 如何选择？**
A: TCC 适合短事务、需要资源预留的场景（支付、库存）。Saga 适合长事务、跨多服务的业务流程编排。TCC 侵入性高但一致性更强，Saga 更灵活但需处理补偿逻辑。

**Q: 空回滚怎么处理？**
A: 在 Cancel 接口开始时，用 Redis `SETNX` 记录该事务 ID。如果 Try 未执行过，标记为空回滚并记录，后续 Try 到达时检查该标记拒绝执行（防悬挂）。

**Q: Confirm/Cancel 失败怎么办？**
A: Confirm/Cancel 必须是幂等的。失败后通过队列重试机制反复调用，直到成功。设置最大重试次数（如 10 次），超过后告警人工介入。

**Q: frozen 字段会不会导致数据不一致？**
A: 定时对账任务是最后的安全网。每 5 分钟扫描 frozen > 0 且超过 30 分钟未完成的记录，自动触发 Cancel 释放资源。同时在 Grafana 中监控 frozen 总量。
