---
title: Laravel DDD 实战：优惠券核销的聚合边界、值对象与 afterCommit 领域事件
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:10:00
categories:
  - php
tags: [Laravel, 架构, DDD, 领域驱动设计, 设计模式, 聚合根, 值对象, 领域事件, afterCommit]
keywords: [Laravel DDD, afterCommit, 优惠券核销的聚合边界, 值对象与, 领域事件, PHP]
description: 深入讲解 Laravel 中 DDD（领域驱动设计）的实战落地：以优惠券核销场景为例，完整覆盖聚合边界划分、值对象建模、聚合根行为封装、领域事件与 afterCommit 事务一致性、跨聚合协调、测试策略及常见踩坑记录，帮助中高级 PHP 开发者在真实项目中用好聚合、领域事件与事务边界。


---

优惠券核销很适合拿来验证 Laravel 里 DDD 到底是不是"有用的复杂度"。这个模块往往同时具备几种特征：规则多、入口多、状态变化多。Web 下单能用，后台补单也能用，支付回调失败还要回滚，活动规则又常常按渠道、商品、用户等级叠加。如果继续把逻辑堆在 `CouponService`，最终一定会变成 Controller、Job、Listener 都能改券状态的局面。

我后来重构时的目标很明确：**让优惠券是否可核销，只能通过一个聚合动作决定；让通知、埋点、报表全部晚于事务提交执行。**

## 一、先把边界切对

优惠券域不要和订单域揉成一个超级 Service。订单负责订单金额与状态流转，优惠券只负责自己"能不能被核销"。真正做跨聚合编排的是应用服务。

```text
API / Job / Admin
      │
      ▼
RedeemCouponService
      │  DB::transaction
      ├── OrderRepository
      ├── CouponRepository
      └── DB::afterCommit()
              │
              ▼
        Coupon Aggregate
        ├── 有效期
        ├── 适用范围
        └── 用户/总量限制
              │
              ▼
   CouponRedeemed -> 统计 / 通知 / 埋点
```

这里有个非常实战的判断标准：**凡是"核销成功后要做什么"都不属于聚合根，凡是"这张券此刻能不能核销"才属于聚合根。** 这条线一清楚，代码就不会继续膨胀。

很多团队切边界时容易犯两个错误：

1. **聚合切太小**——把 `CouponScope`、`UsageLimit` 也拆成独立聚合，导致核销时要跨聚合做一致性检查，事务复杂度飙升。
2. **聚合切太大**——把"核销 + 通知用户 + 更新报表 + 发放积分"全塞进一个聚合，每次改通知逻辑都要动领域层。

正确的切法是：**一个聚合对应一个"业务不变量"**。优惠券的不变量是"这张券能不能被核销"，所以有效期、适用范围、使用额度是聚合内的值对象；而"核销后通知用户"是应用层关心的事，不属于聚合。

## 二、先用值对象把规则收口

最常见的坏味道，是满项目传数组：`$scope['channels']`、`$scope['products']`、`$limit['per_user']`。今天字段名改了，三个入口一起炸。与其让规则散落，不如先把最容易变化的部分做成值对象。

```php
<?php

final readonly class CouponScope
{
    public function __construct(
        public array $channels,
        public array $productIds,
    ) {}

    public function match(string $channel, int $productId): bool
    {
        $channelAllowed = $this->channels === [] || in_array($channel, $this->channels, true);
        $productAllowed = $this->productIds === [] || in_array($productId, $this->productIds, true);

        return $channelAllowed && $productAllowed;
    }
}

final readonly class UsageLimit
{
    public function __construct(
        public int $perUser,
        public int $total,
    ) {}
}
```

值对象的价值不是"面向对象更优雅"，而是**规则入口只有一个**。活动从"全站通用"改成"指定渠道 + 指定商品"时，只改 `CouponScope`，不需要回头清 6 个 if/else。

值对象还有一个隐含的好处：**不可变性**。`readonly` 保证了创建之后没人能偷偷改 `$channels`，聚合根的所有行为判断都基于创建时传入的值。这在调试时非常有用——你只需要看聚合根被构造时的值，就能复现所有分支判断，不用再追溯"谁在哪个 Listener 里偷偷 `setChannels` 了"。

如果规则更复杂（比如"周一至周五可用"），可以把值对象进一步封装：

```php
<?php

final readonly class CouponValidPeriod
{
    public function __construct(
        public CarbonImmutable $startsAt,
        public CarbonImmutable $endsAt,
        public array $availableDays, // [1,2,3,4,5] 周一到周五
    ) {}

    public function isValidAt(CarbonImmutable $time): bool
    {
        if ($time->lt($this->startsAt) || $time->gt($this->endsAt)) {
            return false;
        }

        return in_array((int) $time->dayOfWeek, $this->availableDays, true);
    }
}
```

这样"周一到周五可用"的规则就被值对象完全封装了，聚合根只需要调 `$this->validPeriod->isValidAt($now)`，不需要知道具体怎么判断的。

## 三、聚合根只暴露业务动作

```php
<?php

use Carbon\CarbonImmutable;
use DomainException;

final class Coupon
{
    /** @var DomainEvent[] */
    private array $domainEvents = [];

    public function __construct(
        public readonly int $id,
        private bool $enabled,
        private CouponValidPeriod $validPeriod,
        private CouponScope $scope,
        private UsageLimit $limit,
        private int $usedTotal,
    ) {}

    public function redeem(string $channel, int $productId, int $usedByUser, CarbonImmutable $now): void
    {
        if (! $this->enabled) {
            throw new DomainException('coupon disabled');
        }

        if (! $this->validPeriod->isValidAt($now)) {
            throw new DomainException('coupon expired');
        }

        if (! $this->scope->match($channel, $productId)) {
            throw new DomainException('coupon scope mismatch');
        }

        if ($usedByUser >= $this->limit->perUser || $this->usedTotal >= $this->limit->total) {
            throw new DomainException('coupon quota exceeded');
        }

        $this->usedTotal++;

        $this->recordDomainEvent(new CouponRedeemed(
            couponId: $this->id,
            channelId: $channel,
            productId: $productId,
            occurredAt: $now,
        ));
    }

    public function recordDomainEvent(DomainEvent $event): void
    {
        $this->domainEvents[] = $event;
    }

    /** @return DomainEvent[] */
    public function pullDomainEvents(): array
    {
        $events = $this->domainEvents;
        $this->domainEvents = [];

        return $events;
    }
}
```

这里我故意不提供 `setUsedTotal()`、`setEnabled()` 之类的方法。聚合根如果能被外部随意改字段，DDD 只是换了个目录名，本质还是贫血模型。

注意 `domainEvents` 的设计：聚合根在执行 `redeem()` 时把领域事件"暂存"在自身内部，等事务提交后由应用服务统一拉取。这个模式和 Laravel 原生的 `event()` 调用有本质区别——事件的产生时机被严格绑定在聚合行为内部，而不是散落在各种 Service 方法里。

## 四、领域事件建模：什么时候该用、怎么定义

领域事件不是"做完一件事后发个通知"那么简单。它代表的是**"聚合内发生了一件业务上重要的事"**。判断标准很简单：如果某个监听者关心这件事，那就值得定义成领域事件。

```php
<?php

// 领域事件基接口
interface DomainEvent
{
    public function occurredAt(): CarbonImmutable;
    public function eventName(): string;
}

// 优惠券核销事件
final readonly class CouponRedeemed implements DomainEvent
{
    public function __construct(
        public int $couponId,
        public string $channelId,
        public int $productId,
        public CarbonImmutable $occurredAt,
    ) {}

    public function eventName(): string
    {
        return 'coupon.redeemed';
    }

    public function occurredAt(): CarbonImmutable
    {
        return $this->occurredAt;
    }
}
```

几个注意事项：

1. **值对象承载数据**——事件本身就是值对象，所有属性 `readonly`，构造后不可变。
2. **不要在事件里放 Entity**——放 ID 就够了，监听者需要实体时自己去查。否则序列化、日志打印都会出问题。
3. **事件命名用过去时**——`CouponRedeemed` 而不是 `RedeemCoupon`，因为事件描述的是"已经发生的事"。

如果你还需要更复杂的事件追踪（比如事件溯源），可以引入事件 ID 和关联 ID：

```php
final readonly class CouponRedeemed implements DomainEvent
{
    public function __construct(
        public readonly string $eventId,      // Uuid::uuid7()
        public readonly string $correlationId, // 追踪同一次业务流程
        public int $couponId,
        public string $channelId,
        public int $productId,
        public CarbonImmutable $occurredAt,
    ) {}
}
```

## 五、Laravel 里真正落地的关键：事务编排 + afterCommit

```php
<?php

final class RedeemCouponService
{
    public function handle(int $orderId, string $couponCode, int $userId): void
    {
        DB::transaction(function () use ($orderId, $couponCode, $userId) {
            $order = app(OrderRepository::class)->findOrFail($orderId);
            $coupon = app(CouponRepository::class)->lockByCode($couponCode);
            $usedByUser = app(CouponRepository::class)->countUserUsage($coupon->id, $userId);

            $coupon->redeem($order->channel, $order->product_id, $usedByUser, now()->toImmutable());

            app(CouponRepository::class)->appendUsage($coupon->id, $userId, $order->id);
            app(OrderRepository::class)->markCouponApplied($order->id, $coupon->id);
            app(CouponRepository::class)->save($coupon);

            // 事务提交后才触发事件
            DB::afterCommit(function () use ($coupon, $order, $userId) {
                foreach ($coupon->pullDomainEvents() as $event) {
                    dispatch(new DomainEventSubscriber($event));
                }

                // 或者用 Laravel Event facade
                CouponRedeemed::dispatch($coupon->id, $order->id, $userId);
            });
        });
    }
}
```

这段代码里最值钱的其实不是 DDD，而是两个落地细节：

1. `lockByCode()` 解决高并发下的超发问题。
2. `DB::afterCommit()` 解决"消息发出去了，事务却回滚"的一致性问题。

如果没有第二条，监控、埋点、运营报表都会比数据库更早看到"核销成功"，这种脏成功比直接报错更难查。

### afterCommit 的底层机制

`DB::afterCommit()` 并不是什么黑魔法，它的原理很朴素：在 PDO 事务提交成功后，遍历注册的回调队列依次执行。在 Laravel 中，它的行为取决于当前是否在数据库事务内：

```php
// 如果当前不在事务中，afterCommit 立即执行
DB::afterCommit(fn () => dump('immediate')); // 立即输出

// 如果在事务中，等 commit 后才执行
DB::transaction(function () {
    DB::afterCommit(fn () => dump('after commit')); // 事务提交后输出
});
```

这意味着你的事件分发代码可以无差别地写在 `DB::afterCommit()` 里，不管外层是否开启了事务，行为都是安全的。

**一个容易忽略的坑**：如果事务嵌套了两层，`afterCommit` 只在最外层 `commit` 后触发。如果你在内层事务里注册了 `afterCommit`，但外层事务回滚了，事件不会触发——这恰好是你想要的行为。

### 手动实现 afterCommit（适用于非 Laravel 框架）

如果你想在其他框架或自定义连接上实现类似机制，可以参考这个简化版本：

```php
<?php

trait AfterCommitTrait
{
    private bool $transactionActive = false;
    private array $afterCommitCallbacks = [];

    public function beginTransaction(): void
    {
        $this->transactionActive = true;
        $this->afterCommitCallbacks = [];
    }

    public function commit(): void
    {
        $this->transactionActive = false;
        foreach ($this->afterCommitCallbacks as $callback) {
            $callback();
        }
        $this->afterCommitCallbacks = [];
    }

    public function afterCommit(callable $callback): void
    {
        if ($this->transactionActive) {
            $this->afterCommitCallbacks[] = $callback;
        } else {
            $callback();
        }
    }
}
```

## 六、跨聚合协调：订单 + 优惠券的事务边界

优惠券核销涉及两个聚合（Order 和 Coupon），但它们不应该共享同一个聚合根。跨聚合的协调逻辑应该放在应用服务中：

```php
<?php

final class RedeemCouponService
{
    public function handle(int $orderId, string $couponCode, int $userId): void
    {
        DB::transaction(function () use ($orderId, $couponCode, $userId) {
            $order = app(OrderRepository::class)->findOrFail($orderId);
            $coupon = app(CouponRepository::class)->lockByCode($couponCode);
            $usedByUser = app(CouponRepository::class)->countUserUsage($coupon->id, $userId);

            // 1. 聚合根内做规则校验
            $coupon->redeem($order->channel, $order->product_id, $usedByUser, now()->toImmutable());

            // 2. 应用层做跨聚合状态同步
            app(CouponRepository::class)->appendUsage($coupon->id, $userId, $order->id);
            app(OrderRepository::class)->markCouponApplied($order->id, $coupon->id);
            app(CouponRepository::class)->save($coupon);

            // 3. 事务提交后发领域事件
            DB::afterCommit(fn () => CouponRedeemed::dispatch($coupon->id, $order->id, $userId));
        });
    }
}
```

跨聚合协调的几种常见模式：

| 模式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| 同一事务内同步写 | 强一致性要求 | 简单、可靠 | 事务边界大、性能差 |
| 领域事件 + 最终一致性 | 异步解耦 | 聚合边界清晰 | 需要处理补偿逻辑 |
| Saga 编排模式 | 多聚合长流程 | 可回滚、可追踪 | 复杂度高 |

优惠券核销场景推荐第一种（同一事务），因为操作本身很轻量。只有当核销后需要触发重量级操作（如发短信、通知第三方）时，才用领域事件异步处理。

## 七、数据库约束必须一起上

只靠聚合判断不够，唯一索引要兜底：

```php
Schema::create('coupon_usages', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('coupon_id');
    $table->unsignedBigInteger('user_id');
    $table->unsignedBigInteger('order_id');
    $table->timestamps();

    $table->unique(['coupon_id', 'order_id']);
    $table->index(['coupon_id', 'user_id']);
});
```

线上有一次网关超时重试，请求第二次打进来，应用层判断没完全挡住，最终还是靠 `coupon_id + order_id` 唯一索引拦住重复核销。**领域规则负责表达业务意图，数据库负责做最后一道保险。**

数据库约束和领域规则的关系应该是"双重校验"：

- **领域规则**：在内存中快速校验，返回有意义的错误消息（"优惠券已过期"、"不在适用范围内"）。
- **数据库约束**：在持久化层兜底，防止并发和重试导致的数据不一致。

不要觉得这是"重复校验"——它们解决的问题不同。领域规则给用户看，数据库约束给系统保底。

## 八、仓库层不要把 Eloquent 直接泄漏进领域层

很多 Laravel 项目说自己在做 DDD，最后其实只是把 Eloquent Model 挪到了 `Domain` 目录。真正麻烦的地方在于：一旦聚合根直接依赖 Eloquent，外部代码就很容易又开始 `CouponModel::query()->update(...)`，领域约束马上失效。

我比较能接受的做法，是让仓库层负责"模型 <-> 聚合"映射：

```php
<?php

final class EloquentCouponRepository implements CouponRepository
{
    public function lockByCode(string $code): Coupon
    {
        $model = CouponModel::query()
            ->where('code', $code)
            ->lockForUpdate()
            ->firstOrFail();

        return new Coupon(
            id: $model->id,
            enabled: $model->enabled,
            validPeriod: new CouponValidPeriod(
                startsAt: $model->starts_at->toImmutable(),
                endsAt: $model->ends_at->toImmutable(),
                availableDays: $model->available_days ?? [0,1,2,3,4,5,6],
            ),
            scope: new CouponScope(
                channels: $model->channels ?? [],
                productIds: $model->product_ids ?? [],
            ),
            limit: new UsageLimit(
                perUser: $model->per_user_limit,
                total: $model->total_limit,
            ),
            usedTotal: $model->used_total,
        );
    }

    public function save(Coupon $coupon): void
    {
        CouponModel::query()
            ->whereKey($coupon->id)
            ->update([
                'used_total' => DB::raw('used_total + 1'),
                'updated_at' => now(),
            ]);
    }
}
```

这样做的好处是，领域层不需要知道表结构细节；以后 `channels` 从 JSON 换成中间表，影响也被限制在仓库层。Laravel 本身并不阻止你做 DDD，真正阻止你的往往是"图省事，先直接拿 Model 改一下"。

仓库接口的定义也很重要，建议用 PHP 接口约束：

```php
<?php

interface CouponRepository
{
    public function lockByCode(string $code): Coupon;
    public function countUserUsage(int $couponId, int $userId): int;
    public function appendUsage(int $couponId, int $userId, int $orderId): void;
    public function save(Coupon $coupon): void;
}
```

这样你可以在测试中用内存实现替换 Eloquent 仓库，测试速度从毫秒级降到微秒级。

## 九、测试方式也要跟着变

优惠券模块一旦建模完成，最该补的不是 Controller Feature Test，而是**聚合级单测**。因为最值钱的规则都在 `redeem()` 里，如果这里只能靠接口测试覆盖，排障成本会非常高。

### 聚合级单测（最优先）

我一般会先把规则测透：

```php
<?php

it('rejects coupon when user quota exceeded', function () {
    $coupon = new Coupon(
        id: 1,
        enabled: true,
        validPeriod: new CouponValidPeriod(
            startsAt: now()->subDay()->toImmutable(),
            endsAt: now()->addDay()->toImmutable(),
            availableDays: [0,1,2,3,4,5,6],
        ),
        scope: new CouponScope(['app'], [1001]),
        limit: new UsageLimit(1, 100),
        usedTotal: 5,
    );

    $this->expectException(DomainException::class);
    $coupon->redeem('app', 1001, 1, now()->toImmutable());
});

it('redeems coupon successfully and emits domain event', function () {
    $coupon = new Coupon(
        id: 1,
        enabled: true,
        validPeriod: new CouponValidPeriod(
            startsAt: now()->subDay()->toImmutable(),
            endsAt: now()->addDay()->toImmutable(),
            availableDays: [0,1,2,3,4,5,6],
        ),
        scope: new CouponScope(['app'], [1001]),
        limit: new UsageLimit(10, 100),
        usedTotal: 0,
    );

    $coupon->redeem('app', 1001, 0, now()->toImmutable());

    expect($coupon->pullDomainEvents())->toHaveCount(1)
        ->and($coupon->pullDomainEvents()[0])->toBeInstanceOf(CouponRedeemed::class);
});
```

### 事务边界测试

然后再补应用层测试，验证事务边界、唯一索引冲突、`afterCommit` 事件是否真的只在提交后触发：

```php
<?php

it('does not dispatch event when transaction rolls back', function () {
    Event::fake([CouponRedeemed::class]);

    // 故意让事务回滚
    DB::shouldReceive('afterCommit')->once()->andReturnUsing(function ($callback) {
        // 模拟事务回滚，afterCommit 回调不会被执行
    });

    // 调用核销，但让数据库操作失败
    // ...

    Event::assertNotDispatched(CouponRedeemed::class);
});

it('prevents duplicate redemption via unique index', function () {
    // 第一次核销成功
    // 第二次核销同一张券 + 同一订单，应该抛出 UniqueConstraintViolationException
    $this->expectException(UniqueConstraintViolationException::class);
    // ...
});
```

这里我吃过一个亏：只测 HTTP 返回 200，不测事务提交后的副作用，结果上线后发现监听器已经消费了事件，数据库却因为唯一索引冲突回滚。后来凡是涉及消息、埋点、报表的地方，我都会单独补一层"提交后行为"测试。

### 仓库层测试

用内存实现替换 Eloquent 仓库，确保测试不依赖数据库：

```php
<?php

final class InMemoryCouponRepository implements CouponRepository
{
    private array $coupons = [];
    private array $usages = [];

    public function lockByCode(string $code): Coupon
    {
        foreach ($this->coupons as $coupon) {
            if ($coupon->code === $code) {
                return $coupon;
            }
        }
        throw new ModelNotFoundException();
    }

    public function save(Coupon $coupon): void
    {
        $this->coupons[$coupon->id] = $coupon;
    }

    // ...
}

it('redeems coupon using in-memory repository', function () {
    $repo = new InMemoryCouponRepository();
    // 注册内存仓库
    app()->bind(CouponRepository::class, fn () => $repo);

    // 执行核销逻辑...
    // 不需要数据库连接，测试在毫秒级完成
});
```

## 十、DDD vs Service 模式 vs Event Sourcing 对比

| 维度 | DDD（聚合 + 领域事件） | Service 模式（贫血模型） | Event Sourcing |
|------|----------------------|------------------------|----------------|
| 业务规则位置 | 聚合根内 | Service 方法中 | Event Handler 中 |
| 状态变化方式 | 聚合动作（`redeem()`） | 直接调用 `update()` | 事件重放 |
| 可测试性 | 高（纯内存单元测试） | 中（需要 Mock） | 高（事件即事实） |
| 审计追踪 | 需额外设计 | 需额外设计 | 天然支持 |
| 事务复杂度 | 中等 | 低 | 高（需要投影） |
| 学习曲线 | 陡峭 | 平缓 | 陡峭 |
| 适用场景 | 规则密集型模块 | 简单 CRUD | 审计要求高的金融/电商 |
| 团队要求 | 需要 DDD 经验 | 不需要特殊培训 | 需要事件驱动经验 |

**我的建议**：对于大多数 Laravel 项目，DDD（聚合 + 领域事件）是最佳平衡点。Event Sourcing 功能强大但运维成本高，Service 模式简单但容易失控。先用 DDD 做好聚合边界，如果将来需要完整审计追踪，再逐步引入 Event Sourcing。

## 十一、三个踩坑记录

### 1. 聚合边界切太大

最早把"核销、改价、发通知、打埋点"全塞进 `Coupon`，结果每次活动改报表字段都得动领域层。后来只保留"能不能核销"，复杂度立刻降下来。

### 2. 在聚合里直接查 Redis / HTTP

早期为了判断用户标签，直接在聚合里调外部服务，单测极难写，失败重试也很乱。修正方式是：外部数据在应用层先查完，再作为参数传入聚合。

```php
// ❌ 错误：聚合根依赖外部服务
$coupon->redeem($channel, $productId, $usedByUser, Redis::get('user_tag'));

// ✅ 正确：应用层查完，作为参数传入
$userTag = app(UserTagService::class)->getForUser($userId);
$coupon->redeem($channel, $productId, $usedByUser, $now);
```

### 3. 事务里直接 `event()`

这是最贵的坑。订单更新失败回滚，但监听器已经记了一次成功核销。改成 `DB::afterCommit()` 后，这类脏消息才彻底消失。

### 4. 事件监听器顺序导致数据不一致

核销事件触发后，A 监听器更新统计表，B 监听器发通知。如果 A 失败了，B 还是会执行，导致"通知发了但统计没更新"。解决方式是让监听器各自做幂等，不要假设其他监听器一定成功。

### 5. 跨聚合事务过长

同时核销优惠券 + 扣减库存 + 创建订单，一个事务锁住三张表。高峰期死锁频繁。解决方式是把库存预占拆到独立事务，用最终一致性代替强一致性。

## 十二、结论

Laravel 做 DDD，真正值得上的不是"目录结构"，而是**让业务状态变化只能走聚合动作**。像优惠券、库存预占、退款单这种规则密集型模块，非常适合；普通 CRUD 后台就没必要硬上。我的实际体会是：只要 Controller、Job、Listener 还在各自改券状态，项目无论怎么分层，最后都会重新长成一坨大泥球。

最后分享一个简单的判断标准：如果你的 `CouponService` 里有超过 5 个 public 方法在直接修改券状态，那你的项目已经需要 DDD 了。如果只有一个 `apply()` 方法，那保持现状就好。

## 相关阅读

- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/categories/架构/Saga-编排模式深度实战-Choreography-vs-Orchestration-vs-Temporal-Laravel分布式事务的三种实现路线对比/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/categories/架构/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
