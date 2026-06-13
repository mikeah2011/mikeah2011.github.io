---
title: Laravel Pipeline 设计模式实战 - 订单处理编排、条件分支与可中断链路踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 23:59:59
updated: 2026-05-05 00:01:30
categories:
  - php
tags: [Laravel, Pipeline, 设计模式, 重构, PHP, 中间件]
keywords: [Laravel Pipeline, 设计模式实战, 订单处理编排, 条件分支与可中断链路踩坑记录, PHP]
description: 深入讲解 Laravel Illuminate\Pipeline 在 B2C 电商订单提交场景中的实战编排方案。从 Service 加 if-else 膨胀到一千八百行的真实痛点出发，对比 Pipeline 架构的优劣差异，详解 OrderBag 上下文对象设计、条件分支动态管道组装、可中断链路与统一错误收集机制。结合四个线上踩坑案例——DB 事务边界与高并发连接池冲突、Pipe 间数据隐式耦合污染原始输入、并行执行状态不确定、审计日志因提前返回而丢失——逐一给出修复方案与代码示例，附单元测试策略与适用场景选型指南。



---

Laravel 的中间件就是 Pipeline 模式的经典实现，但很多开发者只在 HTTP 层用过它，很少有人把 `Illuminate\Pipeline\Pipeline` 拿出来编排业务逻辑。直到我在一个 B2C 电商平台的订单提交模块踩了一个大坑——`CreateOrderService` 从 300 行膨胀到 1800 行，每次加一种新的校验规则都要在三个 if-else 嵌套里找位置——才意识到：**订单提交本质上就是一条管道：校验 → 库存 → 优惠 → 定价 → 创建，每一步都可能中断，每一步的顺序都不能乱。**

## 一、为什么不用 Service + if-else

先看一个真实的"腐化前"代码骨架：

```php
class CreateOrderService
{
    public function execute(array $input): Order
    {
        // 1. 参数校验
        if (!isset($input['items']) || empty($input['items'])) {
            throw new InvalidOrderException('购物车为空');
        }

        // 2. 库存检查
        foreach ($input['items'] as $item) {
            $stock = $this->inventory->available($item['sku_id']);
            if ($stock < $item['qty']) {
                throw new InsufficientStockException($item['sku_id']);
            }
        }

        // 3. 优惠券校验（新增）
        if (!empty($input['coupon_code'])) {
            $coupon = $this->coupon->find($input['coupon_code']);
            if (!$coupon || !$coupon->isValid()) {
                throw new InvalidCouponException();
            }
        }

        // 4. 黑名单检查（又新增）
        if ($this->blacklist->isBlocked(auth()->id())) {
            throw new BannedUserException();
        }

        // 5. 风控评估（再新增）
        $riskScore = $this->risk->evaluate($input);
        if ($riskScore > 80) {
            throw new RiskBlockedException($riskScore);
        }

        // 6. 定价计算
        // 7. 创建订单
        // ... 后续 200 行
    }
}
```

问题很明显：

1. **新增步骤必须改核心方法**，违反开闭原则
2. **步骤顺序散落在 if-else 里**，风控应该在库存之前还是之后？每次都要翻代码确认
3. **无法为不同渠道定制流程**——App 下单要风控，后台补单不要；跨境订单要关税计算，国内不需要
4. **单元测试必须跑完整个方法**，无法独立测试每一步

### 两种方案对比

| 对比维度 | Service + if-else | Pipeline |
|---|---|---|
| 新增步骤 | 修改核心方法，违反 OCP | 新建 Pipe 类 + 注册配置 |
| 步骤顺序 | 散落在代码中，隐式 | 配置数组显式声明 |
| 条件分支 | 代码内 if/switch 嵌套 | 按渠道组装不同管道 |
| 单元测试 | 必须跑完整方法 | 每个 Pipe 独立测试 |
| 可中断性 | try-catch 或提前 return | `$bag->stopped()` 统一机制 |
| 错误收集 | 异常中断后丢失后续信息 | 管道跑完，所有错误统一收集 |
| 事务边界 | 难以精确控制 | 仅写库 Pipe 开事务 |
| 代码膨胀 | 方法 300→1800 行 | 每个 Pipe 30-50 行，职责清晰 |

### 重构前后代码量对比

```
重构前 CreateOrderService.php    → 1800 行（单文件）
重构后 OrderPipeline.php         →  30 行（编排）
          OrderBag.php            →  80 行（上下文）
          OrderConfig.php         →  40 行（配置）
          ValidateInputPipe.php   →  35 行
          CheckBlacklistPipe.php  →  25 行
          RiskAssessmentPipe.php  →  45 行
          ValidateInventoryPipe.php → 40 行
          ApplyCouponPipe.php     →  50 行
          CalculatePricingPipe.php → 60 行
          PersistOrderPipe.php    →  45 行
          ─────────────────────────────
          合计：~450 行，10 个文件，每个职责单一
```

## 二、用 Pipeline 重构的架构

重构后的调用链路：

```
Controller / Job / Console
       │
       ▼
  OrderPipeline（编排层）
       │
       ├── ValidateInputPipe        ← 参数校验
       ├── CheckBlacklistPipe       ← 黑名单
       ├── RiskAssessmentPipe       ← 风控评估
       ├── ValidateInventoryPipe    ← 库存检查
       ├── ApplyCouponPipe          ← 优惠券核销
       ├── CalculatePricingPipe     ← 定价引擎
       └── PersistOrderPipe         ← 持久化
              │
              ▼
        OrderCreated Event
```

核心编排代码：

```php
use Illuminate\Pipeline\Pipeline;

class OrderPipeline
{
    public function __construct(
        private Pipeline $pipeline,
        private OrderConfig $config,
    ) {}

    public function handle(array $input): Order
    {
        $orderBag = new OrderBag($input);

        $result = $this->pipeline
            ->send($orderBag)
            ->through($this->config->pipesFor(
                $input['channel'] ?? 'web'
            ))
            ->thenReturn();

        return $result->getOrder();
    }
}
```

其中 `OrderBag` 是贯穿整条管道的上下文对象：

```php
class OrderBag
{
    private ?Order $order = null;
    private ?string $stopReason = null;
    private array $errors = [];
    private array $computed = [];

    public function __construct(
        public readonly array $input,
    ) {}

    public function stop(string $reason, string $code = ''): void
    {
        $this->stopReason = $reason;
        $this->errors[] = [
            'code'    => $code,
            'message' => $reason,
        ];
    }

    public function stopped(): bool
    {
        return $this->stopReason !== null;
    }

    public function setOrder(Order $order): void
    {
        $this->order = $order;
    }

    public function getOrder(): Order
    {
        if (!$this->order) {
            throw new OrderNotCreatedException(
                'Pipeline 结束但未创建订单',
                $this->errors
            );
        }
        return $this->order;
    }

    // 用于 Pipe 之间传递中间计算结果
    public function setComputed(string $key, mixed $value): void
    {
        $this->computed[$key] = $value;
    }

    public function computed(string $key, mixed $default = null): mixed
    {
        return $this->computed[$key] ?? $default;
    }
}
```

## 三、每个 Pipe 的实现规范

每个 Pipe 是一个独立的类，实现 `Closure $next` 的标准接口：

```php
class ValidateInventoryPipe
{
    public function __construct(
        private InventoryService $inventory,
    ) {}

    public function handle(OrderBag $bag, Closure $next): OrderBag|Closure
    {
        // 已经被上游中断，直接跳过
        if ($bag->stopped()) {
            return $next($bag);
        }

        foreach ($bag->input['items'] as $item) {
            $available = $this->inventory->available(
                $item['sku_id'],
                $item['warehouse_id'] ?? 'default'
            );

            if ($available < $item['qty']) {
                $bag->stop(
                    "SKU[{$item['sku_id']}] 库存不足，" .
                    "需要 {$item['qty']}，剩余 {$available}",
                    'INSUFFICIENT_STOCK'
                );
                return $next($bag); // 不中断管道，让后续 Pipe 能收集信息
            }
        }

        return $next($bag);
    }
}
```

**关键设计决策：`stopped()` 后仍然调用 `$next($bag)`，而不是直接 `return $bag`。** 原因后面踩坑部分详细讲。

## 四、条件分支——不同渠道走不同管道

这是 Pipeline 最大的优势。`OrderConfig` 负责根据渠道组装管道：

```php
class OrderConfig
{
    private array $pipeMap = [
        'web' => [
            ValidateInputPipe::class,
            CheckBlacklistPipe::class,
            RiskAssessmentPipe::class,
            ValidateInventoryPipe::class,
            ApplyCouponPipe::class,
            CalculatePricingPipe::class,
            PersistOrderPipe::class,
        ],
        'admin' => [
            ValidateInputPipe::class,
            ValidateInventoryPipe::class,
            ApplyCouponPipe::class,
            CalculatePricingPipe::class,
            PersistOrderPipe::class,
        ],
        'cross_border' => [
            ValidateInputPipe::class,
            CheckBlacklistPipe::class,
            RiskAssessmentPipe::class,
            ValidateInventoryPipe::class,
            CustomsDutyPipe::class,         // 跨境专有
            ApplyCouponPipe::class,
            CalculatePricingPipe::class,
            PersistOrderPipe::class,
        ],
    ];

    public function pipesFor(string $channel): array
    {
        return $this->pipeMap[$channel]
            ?? throw new UnsupportedChannelException($channel);
    }
}
```

新增渠道只需加一个数组键值，新增步骤只需写一个 Pipe 类，**核心编排逻辑永远不需要改动。**

## 五、踩坑记录：四个真实生产问题

### 踩坑 1：stopped 后直接 return，后续步骤不执行

最初我的实现是：

```php
public function handle(OrderBag $bag, Closure $next): OrderBag
{
    if ($bag->stopped()) {
        return $bag; // ❌ 不调用 $next，后续所有 Pipe 被跳过
    }
    // ...
}
```

这导致一个隐蔽问题：最后的 `PersistOrderPipe` 里有一段「无论成功失败都记录审计日志」的逻辑。因为前面 Pipe 在库存不足时直接 return，审计日志从来不写。**改为始终调用 `$next($bag)`，让管道跑完，审计 Pipe 检查 `$bag->stopped()` 来决定写成功日志还是失败日志。**

### 踩坑 2：DB 事务边界与 Pipeline 不匹配

最初我把整条 Pipeline 包在一个 `DB::transaction` 里：

```php
DB::transaction(fn() => $pipeline->handle($input));
```

结果 `RiskAssessmentPipe` 会调用外部风控 API，网络超时 3 秒。这 3 秒内数据库连接被持有不释放，高并发下连接池被打爆（配合 PgBouncer 的坑更大）。

**修正方案：只有真正写库的 Pipe 内部开事务：**

```php
class PersistOrderPipe
{
    public function handle(OrderBag $bag, Closure $next): OrderBag
    {
        if ($bag->stopped()) {
            return $next($bag);
        }

        $order = DB::transaction(function () use ($bag) {
            return $this->orderRepo->create($bag->input);
        });

        $bag->setOrder($order);
        return $next($bag);
    }
}
```

校验类 Pipe 绝对不碰数据库事务。

### 踩坑 3：Pipe 之间传数据的隐式耦合

`ApplyCouponPipe` 计算了优惠金额，`CalculatePricingPipe` 要用。最初的做法是直接把优惠金额挂到 `$bag->input` 上：

```php
$bag->input['discount'] = $coupon->calculateDiscount(); // ❌ 污染输入数据
```

后来发现 `$bag->input` 被传给了 `PersistOrderPipe`，优惠金额被当作"原始输入"一起存进数据库了。一旦优惠券规则变了，历史订单的金额全乱。

**修正方案：用 `$bag->setComputed()` / `$bag->computed()` 做中间数据传递，与原始输入隔离。**

### 踩坑 4：并行 Pipe 的执行顺序不可控

有一段时间我试图把「库存检查」和「风控评估」并行执行来加速：

```php
->through([
    [ValidateInventoryPipe::class, RiskAssessmentPipe::class], // 同时跑
])
```

Laravel 的 Pipeline 确实支持嵌套数组来实现并行，但两个 Pipe 都可能调用 `$bag->stop()`。当两个 Pipe 几乎同时停止时，`$bag->stopReason` 的值取决于谁先写入——这在高并发下是不确定的。

**教训：只有纯读取、不修改 bag 状态的 Pipe 才能并行。校验类（会 stop 的）必须串行。**

## 六、测试策略：独立测试每个 Pipe

Pipeline 的最大收益之一是测试变得简单。每个 Pipe 可以独立测试：

```php
test('库存不足时 OrderBag 被标记为 stopped', function () {
    $bag = new OrderBag([
        'items' => [['sku_id' => 'SKU-001', 'qty' => 999]],
    ]);

    $pipe = app(ValidateInventoryPipe::class);
    $pipe->handle($bag, fn($b) => $b);

    expect($bag->stopped())->toBeTrue()
        ->and($bag->errors)->toHaveCount(1)
        ->and($bag->errors[0]['code'])->toBe('INSUFFICIENT_STOCK');
});

test('整条 Pipeline 端到端：正常订单创建成功', function () {
    $input = OrderFixture::validInput();

    $order = app(OrderPipeline::class)->handle($input);

    expect($order)->toBeInstanceOf(Order::class)
        ->and($order->status)->toBe('pending');
});
```

## 七、什么时候该用 Pipeline，什么时候不该

| 场景 | 推荐方案 |
|---|---|
| 步骤 ≤ 3 且不太会增加 | 直接写在 Service 里 |
| 步骤多、顺序敏感、不同渠道不同流程 | Pipeline |
| 步骤之间需要异步（发邮件、推消息） | Pipeline + Event/Queue |
| 步骤之间有复杂数据依赖（下一步依赖上一步结果） | DDD Application Service（Pipeline 不擅长条件依赖） |

Pipeline 不是银弹。如果下一步的逻辑高度依赖上一步的结果（不是简单的"通过/不通过"，而是"用上一步的返回值来决定自己怎么走"），Pipeline 的 `OrderBag` 会退化成一个万能上下文，反而更乱。这种场景用 DDD 的 Application Service 编排更清晰。

## 常见错误与排查清单

| 现象 | 原因 | 修复方案 |
|---|---|---|
| Pipe 之间数据丢失 | 直接修改 `$bag->input`，下游读不到 | 使用 `$bag->setComputed()` / `$bag->computed()` |
| 审计日志不完整 | `stopped()` 后直接 return，跳过后续 Pipe | 始终调用 `$next($bag)`，审计 Pipe 检查 `stopped()` |
| 高并发下 DB 连接池耗尽 | 整条 Pipeline 包在 `DB::transaction` 里 | 仅 `PersistOrderPipe` 内部开事务 |
| 并行 Pipe 状态不确定 | 两个校验 Pipe 同时修改 `stopReason` | 校验类 Pipe 必须串行，只有纯读 Pipe 可并行 |
| 管道未按预期顺序执行 | `OrderConfig` 数组键顺序错误 | 用 `array_values()` 确保顺序，添加集成测试验证 |
| Dependency Injection 失效 | Pipe 构造函数未注册到容器 | 确保 Pipe 类在 `AppServiceProvider` 或 `管道配置` 中正确绑定 |

### 动态添加/移除 Pipe 的运行时技巧

```php
// 运行时根据条件移除某个 Pipe
$pipes = $this->config->pipesFor($channel);

if ($input['skip_risk_check'] ?? false) {
    $pipes = array_values(array_filter(
        $pipes,
        fn($pipe) => $pipe !== RiskAssessmentPipe::class
    ));
}

// 运行时在指定位置插入 Pipe
$insertAt = array_search(ValidateInventoryPipe::class, $pipes);
array_splice($pipes, $insertAt, 0, [CustomValidationPipe::class]);
```

### 使用 Pipeline 实现请求预处理中间件

Pipeline 不仅能编排业务逻辑，还能用于 API 请求预处理：

```php
class ApiRequestPipeline
{
    public function handle(Request $request, Closure $next): JsonResponse
    {
        return app(Pipeline::class)
            ->send($request)
            ->through([
                RateLimitPipe::class,
                AuthSanctumPipe::class,
                RequestLoggingPipe::class,
                FormatValidationPipe::class,
            ])
            ->then(fn($req) => $next($req));
    }
}
```

## 总结

`Illuminate\Pipeline\Pipeline` 是 Laravel 内置的、被严重低估的设计模式工具。它最大的价值不是代码结构的美化，而是**让业务流程的编排变成配置而非代码**——新增步骤写一个 Pipe 类、新增渠道加一行配置、移除步骤删一行配置，核心编排逻辑永远不动。

但要注意：事务边界要缩到最小、stopped 状态下仍要保持管道完整传递、中间数据与原始输入必须隔离、并行执行要谨慎评估。这些坑，只有在线上跑过才知道。

## 相关阅读

- [Laravel Pipeline 源码剖析：闭包洋葱模型——对比 Symfony Pipeline 与 Java Filter Chain 的中间件栈实现](/categories/PHP/Laravel/2026-06-05-laravel-pipeline-source-closure-onion-model/)
- [Laravel 12.x Pipeline 实战：复杂业务流程编排与条件分支——从 if-else 地狱到管道模式的重构之路](/categories/Laravel/PHP/Laravel-12x-Pipeline-重构实战/)
- [Choreography vs Orchestration 实战：事件驱动 vs 工作流驱动——Laravel 微服务中的两种分布式编排范式深度对比](/categories/架构/Choreography-vs-Orchestration-事件驱动vs工作流驱动-Laravel微服务分布式编排范式深度对比/)
