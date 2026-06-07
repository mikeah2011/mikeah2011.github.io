# CQRS 模式

## 定义

CQRS（Command Query Responsibility Segregation）= 读写分离。命令（写）和查询（读）使用不同的模型和数据结构。

## 核心思想

```
┌─────────────┐        ┌─────────────┐
│   Command   │        │    Query    │
│   (写模型)   │        │   (读模型)   │
│  复杂业务逻辑 │        │  简单查询优化 │
└──────┬──────┘        └──────┬──────┘
       │                      │
       ▼                      ▼
  Write Database ──同步──▶ Read Database
  (MySQL)                   (ES/Redis/物化视图)
```

## Laravel 实现

### Command 端

```php
// Command
class PlaceOrderCommand {
    public function __construct(
        public int $userId,
        public array $items,
    ) {}
}

// Handler
class PlaceOrderHandler {
    public function handle(PlaceOrderCommand $cmd): Order {
        return DB::transaction(function () use ($cmd) {
            $order = Order::create([...]);
            event(new OrderPlaced($order));
            return $order;
        });
    }
}
```

### Query 端

```php
// 投影同步（监听事件更新读模型）
class OrderProjection {
    public function handle(OrderPlaced $event): void {
        // 更新 Redis/ES 中的订单快照
        Cache::put("order:{$event->order->id}", $event->order->toArray());
    }
}

// 查询（只读，高性能）
class OrderQueryService {
    public function find(int $id): array {
        return Cache::get("order:{$id}");
    }
}
```

## 适用场景

- 读写比例悬殊（读多写少）
- 读写模型差异大（写入需要复杂校验，查询需要平铺数据）
- 需要独立扩展读写性能

## 踩坑记录

- **投影同步延迟**：写入后读模型可能还未同步 → 前端轮询或 WebSocket 推送
- **一致性问题**：最终一致性，不是强一致性
- **过度设计**：简单 CRUD 不需要 CQRS

## 实战案例

来自博客文章：[CQRS 实战](/categories/PHP/laravel-cqrs-guide-query/)

## 相关概念

- [DDD 实践](DDD实践.md) - CQRS 常与 DDD 配合使用
- [事件驱动架构](事件驱动架构.md) - 事件驱动的投影同步

## 常见问题

**Q: 什么时候不需要 CQRS？**
A: 简单 CRUD、读写模型一致、没有性能瓶颈时不需要。CQRS 增加了复杂度。
