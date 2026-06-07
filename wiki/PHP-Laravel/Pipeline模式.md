# Laravel Pipeline 模式

## 定义

Pipeline 模式将处理流程拆分为多个可串联的步骤（Stage），每个步骤只关注自己的逻辑，通过管道传递数据。

## 核心思想

```
Input → Stage1 → Stage2 → Stage3 → Output
```

每个 Stage 可以：
- 处理数据并传递给下一个
- 短路返回（中断管道）
- 条件跳过某个 Stage

## Laravel Pipeline 实现

```php
class OrderPipeline {
    public function handle(Order $order): Order {
        return app(Pipeline::class)
            ->send($order)
            ->through([
                ValidateOrder::class,
                CalculateDiscount::class,
                DeductInventory::class,
                ProcessPayment::class,
                SendNotification::class,
            ])
            ->thenReturn();
    }
}

// 每个 Stage
class ValidateOrder {
    public function handle(Order $order, Closure $next): Order {
        if (!$order->isValid()) {
            throw new InvalidOrderException();
        }
        return $next($order);
    }
}
```

## 条件分支

```php
->through([
    ValidateOrder::class,
    fn ($order, $next) => $order->isVip()
        ? $next(VipDiscount::apply($order))
        : $next(NormalDiscount::apply($order)),
    ProcessPayment::class,
])
```

## 踩坑记录

- **Stage 顺序敏感**：支付必须在库存扣减之后，否则付款成功但无库存
- **异常传播**：Stage 中抛异常会中断整个管道，需要统一异常处理
- **调试困难**：管道太长时调试困难 → 加日志中间件

## 实战案例

来自博客文章：[Pipeline 设计模式](/categories/PHP/laravel-pipeline-design-patternsguide-orchestration/)

## 相关概念

- [中间件](中间件.md) - Laravel 中间件底层就是 Pipeline
- [事件驱动架构](事件驱动架构.md) - 管道 vs 事件的区别
- [CQRS 模式](CQRS模式.md) - 管道用于写入流程

## 常见问题

**Q: Pipeline 和 Event 有什么区别？**
A: Pipeline 是同步串行的处理链，数据依次经过每个 Stage；Event 是异步并行的发布-订阅模式。
