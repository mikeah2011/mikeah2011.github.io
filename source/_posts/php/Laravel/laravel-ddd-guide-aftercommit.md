---
title: Laravel DDD 实战：优惠券核销的聚合边界、值对象与 afterCommit 领域事件
date: 2026-05-03 09:10:00
categories:
  - PHP
  - Laravel
tags: [Laravel, 架构]
description: 结合 B2C 订单优惠券核销场景，记录一套在 Laravel 中落地 DDD 的实战方案，重点覆盖聚合边界、值对象建模、事务一致性、afterCommit 领域事件以及真实踩坑记录。



---
优惠券核销很适合拿来验证 Laravel 里 DDD 到底是不是“有用的复杂度”。这个模块往往同时具备几种特征：规则多、入口多、状态变化多。Web 下单能用，后台补单也能用，支付回调失败还要回滚，活动规则又常常按渠道、商品、用户等级叠加。如果继续把逻辑堆在 `CouponService`，最终一定会变成 Controller、Job、Listener 都能改券状态的局面。

我后来重构时的目标很明确：**让优惠券是否可核销，只能通过一个聚合动作决定；让通知、埋点、报表全部晚于事务提交执行。**

## 一、先把边界切对

优惠券域不要和订单域揉成一个超级 Service。订单负责订单金额与状态流转，优惠券只负责自己“能不能被核销”。真正做跨聚合编排的是应用服务。

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

这里有个非常实战的判断标准：**凡是“核销成功后要做什么”都不属于聚合根，凡是“这张券此刻能不能核销”才属于聚合根。** 这条线一清楚，代码就不会继续膨胀。

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

值对象的价值不是“面向对象更优雅”，而是**规则入口只有一个**。活动从“全站通用”改成“指定渠道 + 指定商品”时，只改 `CouponScope`，不需要回头清 6 个 if/else。

## 三、聚合根只暴露业务动作

```php
<?php

use Carbon\CarbonImmutable;
use DomainException;

final class Coupon
{
    public function __construct(
        public readonly int $id,
        private bool $enabled,
        private CarbonImmutable $startsAt,
        private CarbonImmutable $endsAt,
        private CouponScope $scope,
        private UsageLimit $limit,
        private int $usedTotal,
    ) {}

    public function redeem(string $channel, int $productId, int $usedByUser, CarbonImmutable $now): void
    {
        if (! $this->enabled) {
            throw new DomainException('coupon disabled');
        }

        if ($now->lt($this->startsAt) || $now->gt($this->endsAt)) {
            throw new DomainException('coupon expired');
        }

        if (! $this->scope->match($channel, $productId)) {
            throw new DomainException('coupon scope mismatch');
        }

        if ($usedByUser >= $this->limit->perUser || $this->usedTotal >= $this->limit->total) {
            throw new DomainException('coupon quota exceeded');
        }

        $this->usedTotal++;
    }
}
```

这里我故意不提供 `setUsedTotal()`、`setEnabled()` 之类的方法。聚合根如果能被外部随意改字段，DDD 只是换了个目录名，本质还是贫血模型。

## 四、Laravel 里真正落地的关键：事务编排 + afterCommit

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

            DB::afterCommit(fn () => CouponRedeemed::dispatch($coupon->id, $order->id, $userId));
        });
    }
}
```

这段代码里最值钱的其实不是 DDD，而是两个落地细节：

1. `lockByCode()` 解决高并发下的超发问题。
2. `DB::afterCommit()` 解决“消息发出去了，事务却回滚”的一致性问题。

如果没有第二条，监控、埋点、运营报表都会比数据库更早看到“核销成功”，这种脏成功比直接报错更难查。

## 五、数据库约束必须一起上

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

## 六、仓库层不要把 Eloquent 直接泄漏进领域层

很多 Laravel 项目说自己在做 DDD，最后其实只是把 Eloquent Model 挪到了 `Domain` 目录。真正麻烦的地方在于：一旦聚合根直接依赖 Eloquent，外部代码就很容易又开始 `CouponModel::query()->update(...)`，领域约束马上失效。

我比较能接受的做法，是让仓库层负责“模型 <-> 聚合”映射：

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
            startsAt: $model->starts_at->toImmutable(),
            endsAt: $model->ends_at->toImmutable(),
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

这样做的好处是，领域层不需要知道表结构细节；以后 `channels` 从 JSON 换成中间表，影响也被限制在仓库层。Laravel 本身并不阻止你做 DDD，真正阻止你的往往是“图省事，先直接拿 Model 改一下”。

## 七、测试方式也要跟着变

优惠券模块一旦建模完成，最该补的不是 Controller Feature Test，而是**聚合级单测**。因为最值钱的规则都在 `redeem()` 里，如果这里只能靠接口测试覆盖，排障成本会非常高。

我一般会先把规则测透：

```php
<?php

it('rejects coupon when user quota exceeded', function () {
    $coupon = new Coupon(
        id: 1,
        enabled: true,
        startsAt: now()->subDay()->toImmutable(),
        endsAt: now()->addDay()->toImmutable(),
        scope: new CouponScope(['app'], [1001]),
        limit: new UsageLimit(1, 100),
        usedTotal: 5,
    );

    $this->expectException(DomainException::class);

    $coupon->redeem('app', 1001, 1, now()->toImmutable());
});
```

然后再补应用层测试，验证事务边界、唯一索引冲突、`afterCommit` 事件是否真的只在提交后触发。这里我吃过一个亏：只测 HTTP 返回 200，不测事务提交后的副作用，结果上线后发现监听器已经消费了事件，数据库却因为唯一索引冲突回滚。后来凡是涉及消息、埋点、报表的地方，我都会单独补一层“提交后行为”测试。

## 八、三个踩坑记录

### 1. 聚合边界切太大
最早把“核销、改价、发通知、打埋点”全塞进 `Coupon`，结果每次活动改报表字段都得动领域层。后来只保留“能不能核销”，复杂度立刻降下来。

### 2. 在聚合里直接查 Redis / HTTP
早期为了判断用户标签，直接在聚合里调外部服务，单测极难写，失败重试也很乱。修正方式是：外部数据在应用层先查完，再作为参数传入聚合。

### 3. 事务里直接 `event()`
这是最贵的坑。订单更新失败回滚，但监听器已经记了一次成功核销。改成 `DB::afterCommit()` 后，这类脏消息才彻底消失。

## 九、结论

Laravel 做 DDD，真正值得上的不是“目录结构”，而是**让业务状态变化只能走聚合动作**。像优惠券、库存预占、退款单这种规则密集型模块，非常适合；普通 CRUD 后台就没必要硬上。我的实际体会是：只要 Controller、Job、Listener 还在各自改券状态，项目无论怎么分层，最后都会重新长成一坨大泥球。