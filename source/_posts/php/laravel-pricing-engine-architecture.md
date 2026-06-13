---
title: Laravel 定价引擎架构设计实战：动态定价、阶梯折扣、优惠券叠加、价格快照——B2C 电商的价格治理全链路踩坑记录
keywords: [Laravel, B2C, 定价引擎架构设计实战, 动态定价, 阶梯折扣, 优惠券叠加, 价格快照, 电商的价格治理全链路踩坑记录, PHP]
date: 2026-06-10 02:13:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - PHP
  - 架构设计
  - 定价引擎
  - 阶梯折扣
  - 优惠券叠加
  - 价格快照
  - B2C 电商
description: 深度实战 Laravel B2C 电商定价引擎架构设计，覆盖动态定价、阶梯折扣、优惠券叠加与价格快照全链路，提供可运行的 PHP/Laravel 代码示例，并总结 integer 精度、并发、折扣冲突等高频踩坑与落地方案。
---


# Laravel 定价引擎架构设计实战：动态定价、阶梯折扣、优惠券叠加、价格快照——B2C 电商的价格治理全链路踩坑记录

## 概述

电商系统里最脆弱的模块往往不是订单状态机，也不是支付接入，而是**定价**。

定价引擎的难点不在于某一个功能实现，而在于多个定价规则同时生效时的叠加、互斥、回溯和审计。一次价格计算背后通常要处理：

- 商品基础价格
- SKU 差异
- 阶梯折扣（满 2 件 9 折，满 5 件 8 折）
- 限时折扣
- 用户等级折扣
- 优惠券（满减券、折扣券、运费券）
- 平台补贴
- 积分抵扣
- 区域差异定价
- 汇率换算

如果架构没做好，最常见的后果是：

- 同一个商品在不同入口显示不同价格
- 优惠券叠加后价格变成负数
- 退款金额和实付金额对不上
- 财务对账时发现价格快照缺失
- 大促期间因为锁粒度太粗导致订单超卖或价格错乱

我之前在一个 B2C 项目里踩过很多坑，后来逐步把定价引擎重构成了一个相对稳定的方案。这篇文章就基于那个实战场景，讲清楚 Laravel 里的定价引擎应该怎么设计，代码可以直接跑，但更重要的是把背后的工程决策讲明白。

---

## 核心概念

### 定价引擎不是计算器

很多人会把定价引擎理解成“一串计算规则”，但真正到了生产环境，它其实是一套**治理系统**。它要解决的不只是算出最终价格，还要解决：

- **可追溯**：为什么这个订单是这个价格，每一步折扣来源是什么
- **可回滚**：退款时能还原到原始价格和各层折扣
- **可审计**：财务能看到价格快照，运营能解释活动规则
- **可扩展**：新增一种折扣类型时不要改核心计算逻辑
- **可并发**：高并发下单时不要因为锁粒度问题导致价格错误

### 定价上下文（PricingContext）

我认为做定价引擎最重要的抽象是先定义一个 `PricingContext`，把所有输入信息收敛到一个对象里：

```php
<?php

declare(strict_types=1);

namespace App\Pricing;

final readonly class PricingContext
{
    public function __construct(
        public int $userId,
        public int $skuId,
        public int $quantity,
        public string $regionCode,
        public string $currency,
        public \DateTimeImmutable $at,
        /** @var array<string, string> 优惠券码列表 */
        public array $couponCodes = [],
        /** @var array<string, mixed> 额外参数（会员等级、活动 ID 等） */
        public array $attributes = [],
    ) {}
}
```

这里有几个关键决策：

1. **时间点（at）必须显式传入**：定价依赖活动时间窗口，不能用 `now()` 随处取时间，否则回溯、对账、测试都会出问题。
2. **regionCode 必须存在**：跨境业务里同一个商品在不同区域可能有完全不同的定价策略。
3. **couponCodes 和 attributes 分离**：优惠券是显式输入，其他扩展参数走 attributes，避免接口越来越膨胀。

### 价格快照（PriceSnapshot）

价格快照是定价引擎里最被低估的部分。没有快照，退款、对账、客诉处理都会变成灾难。

一个可用的价格快照应该包含：

```php
<?php

declare(strict_types=1);

namespace App\Pricing;

final readonly class PriceSnapshot
{
    public function __construct(
        public int $originalUnitPriceCents,
        public int $finalUnitPriceCents,
        public int $totalAmountCents,
        public int $discountAmountCents,
        /** @var array<int, DiscountLine> */
        public array $discountLines,
        public \DateTimeImmutable $calculatedAt,
        public string $currency,
        /** @var array<string, mixed> 完整计算上下文（用于审计） */
        public array $metadata,
    ) {}

    public static function fromCalculation(PricingResult $result): self
    {
        return new self(
            originalUnitPriceCents: $result->originalUnitPriceCents,
            finalUnitPriceCents: $result->finalUnitPriceCents,
            totalAmountCents: $result->totalAmountCents,
            discountAmountCents: $result->originalUnitPriceCents * $result->quantity - $result->totalAmountCents,
            discountLines: $result->discountLines,
            calculatedAt: $result->calculatedAt,
            currency: $result->currency,
            metadata: [
                'context_hash' => hash('xxh3', json_encode($result->context, JSON_THROW_ON_ERROR)),
                'rule_versions' => $result->appliedRuleVersions,
                'channel' => $result->attributes['channel'] ?? 'unknown',
            ],
        );
    }
}
```

---

## 实战代码

### 第一层：定价引擎主流程

我最终采用的是**责任链 + 排序规则 + 中间件模式**，而不是单纯的策略模式。原因是折扣之间经常有顺序依赖，比如：

- 阶梯折扣先算
- 再算限时折扣
- 优惠券在最后叠加

如果用简单的策略集合，排序会变得很难控制。

```php
<?php

declare(strict_types=1);

namespace App\Pricing;

use App\Pricing\Rules\PricingRule;
use App\Pricing\Rules\PricingRuleCollection;

final class PricingEngine
{
    public function __construct(
        private PricingRuleCollection $rules,
        private PriceRepository $priceRepo,
    ) {}

    public function calculate(PricingContext $context): PricingResult
    {
        // 1. 获取原始价格
        $originalPriceCents = $this->priceRepo->resolveOriginalUnitPrice($context);

        $result = new PricingResult(
            context: $context,
            originalUnitPriceCents: $originalPriceCents,
            finalUnitPriceCents: $originalPriceCents,
            totalAmountCents: $originalPriceCents * $context->quantity,
            currency: $context->currency,
            discountLines: [],
            appliedRuleVersions: [],
            calculatedAt: new \DateTimeImmutable('now', new \DateTimeZone('Asia/Shanghai')),
        );

        // 2. 按优先级顺序应用规则
        $sortedRules = $this->rules->sorted();

        foreach ($sortedRules as $rule) {
            if ($rule->supports($context, $result)) {
                $result = $rule->apply($context, $result);
            }
        }

        // 3. 防御性兜底：不允许出现负数价格
        $result = $this->guardFinalPrice($result);

        return $result;
    }

    private function guardFinalPrice(PricingResult $result): PricingResult
    {
        $minCents = 0;

        // 部分业务允许 0 元，但不允许负数
        if ($result->finalUnitPriceCents < $minCents) {
            $overDiscountCents = abs($result->finalUnitPriceCents - $minCents);

            $result = $result->withOverrideFinalPrice(
                finalUnitPriceCents: $minCents,
                newDiscountLine: new DiscountLine(
                    code: 'GUARD_ZERO_FLOOR',
                    label: '价格兜底：不允许负数',
                    amountCents: -$overDiscountCents,
                    type: 'adjustment',
                ),
            );
        }

        return $result;
    }
}
```

### 第二层：PricingResult 的不可变演进

这里一个关键点是 `PricingResult` 必须是**值对象 / 不可变对象**。很多早期实现会直接 `mutate` 结果对象，最后在并发和回溯时出现诡异问题。

```php
<?php

declare(strict_types=1);

namespace App\Pricing;

final readonly class PricingResult
{
    public function __construct(
        public PricingContext $context,
        public int $originalUnitPriceCents,
        public int $finalUnitPriceCents,
        public int $totalAmountCents,
        public string $currency,
        /** @var array<int, DiscountLine> */
        public array $discountLines,
        /** @var array<string, string> */
        public array $appliedRuleVersions,
        public \DateTimeImmutable $calculatedAt,
    ) {}

    public function withDiscount(DiscountLine $line): self
    {
        $newFinalUnitPrice = $this->finalUnitPriceCents + $line->amountCents;
        $newFinalUnitPrice = max(0, $newFinalUnitPrice);

        $newDiscountLines = array_merge($this->discountLines, [$line]);
        $newTotalAmountCents = $newFinalUnitPrice * $this->context->quantity;

        $newVersions = $this->appliedRuleVersions;
        $newVersions[$line->code] = $line->version ?? '1.0.0';

        return new self(
            context: $this->context,
            originalUnitPriceCents: $this->originalUnitPriceCents,
            finalUnitPriceCents: $newFinalUnitPrice,
            totalAmountCents: $newTotalAmountCents,
            currency: $this->currency,
            discountLines: $newDiscountLines,
            appliedRuleVersions: $newVersions,
            calculatedAt: $this->calculatedAt,
        );
    }

    public function withOverrideFinalPrice(int $finalUnitPriceCents, DiscountLine $newDiscountLine): self
    {
        $newDiscountLines = array_merge($this->discountLines, [$newDiscountLine]);

        return new self(
            context: $this->context,
            originalUnitPriceCents: $this->originalUnitPriceCents,
            finalUnitPriceCents: $finalUnitPriceCents,
            totalAmountCents: $finalUnitPriceCents * $this->context->quantity,
            currency: $this->currency,
            discountLines: $newDiscountLines,
            appliedRuleVersions: $this->appliedRuleVersions,
            calculatedAt: $this->calculatedAt,
        );
    }

    public function discountAmountCents(): int
    {
        return $this->originalUnitPriceCents * $this->context->quantity - $this->totalAmountCents;
    }
}
```

---

## 阶梯折扣实战

阶梯折扣看起来简单，实际上有两个容易踩坑的地方：

1. 阶梯是“整单生效”还是“分段生效”
2. 与其他折扣叠加时，是基于原价还是折后价

在 B2C 场景里，我最终选择的是**整单生效**，因为用户体验更清晰；但如果做批发或者复杂促销，分段生效会更合理。

### 阶梯折扣规则示例

```php
<?php

declare(strict_types=1);

namespace App\Pricing\Rules;

use App\Pricing\DiscountLine;
use App\Pricing\PricingContext;
use App\Pricing\PricingResult;

final readonly class TieredDiscountRule implements PricingRule
{
    public function __construct(
        /** @var array<int, array{min_qty: int, percent_off: int}> */
        private array $tiers,
        private string $version = '1.0.0',
    ) {}

    public function supports(PricingContext $context, PricingResult $result): bool
    {
        return $this->resolveTier($context->quantity) !== null;
    }

    public function apply(PricingContext $context, PricingResult $result): PricingResult
    {
        $tier = $this->resolveTier($context->quantity);
        if ($tier === null) {
            return $result;
        }

        $percentOff = $tier['percent_off'];
        $basePriceCents = $result->finalUnitPriceCents;

        $discountPerUnitCents = (int) round($basePriceCents * $percentOff / 100);

        return $result->withDiscount(
            new DiscountLine(
                code: 'TIERED_DISCOUNT',
                label: "阶梯折扣：购买 {$context->quantity} 件，减 {$percentOff}%",
                amountCents: -$discountPerUnitCents,
                type: 'tiered',
                version: $this->version,
            ),
        );
    }

    private function resolveTier(int $quantity): ?array
    {
        $selected = null;

        foreach ($this->tiers as $tier) {
            if ($quantity >= $tier['min_qty']) {
                $selected = $tier;
            }
        }

        return $selected;
    }
}
```

用法：

```php
$rule = new TieredDiscountRule(
    tiers: [
        ['min_qty' => 2, 'percent_off' => 10],
        ['min_qty' => 5, 'percent_off' => 20],
        ['min_qty' => 10, 'percent_off' => 30],
    ],
);

$context = new PricingContext(
    userId: 12001,
    skuId: 30001,
    quantity: 6,
    regionCode: 'CN',
    currency: 'CNY',
    at: new \DateTimeImmutable('2026-06-10 10:00:00', new \DateTimeZone('Asia/Shanghai')),
);

$engine = new PricingEngine(
    rules: new PricingRuleCollection([$rule]),
    priceRepo: $fakePriceRepo,
);

$result = $engine->calculate($context);
```

---

## 优惠券叠加实战

优惠券是定价引擎里最容易失控的地方。

常见翻车场景：

- 同类型券可以叠加多张
- 折扣券和满减券同时生效，总价被压到极低
- 优惠券的使用门槛是基于原价还是折后价，没有统一标准
- 优惠券和阶梯折扣重复折上折

我的经验是：**必须把优惠券分层**。

### 优惠券类型分层

```php
<?php

declare(strict_types=1);

namespace App\Pricing\Coupon;

enum CouponType: string
{
    case FixedAmount = 'fixed_amount';
    case PercentDiscount = 'percent_discount';
    case FreeShipping = 'free_shipping';
    case BuyXGetY = 'buy_x_get_y';
}

enum CouponLayer: string
{
    case PreTier = 'pre_tier';       // 在阶梯折扣前
    case PostTier = 'post_tier';     // 在阶梯折扣后
    case FinalAdjust = 'final_adjust'; // 最终调整（如运费券、补贴券）
}
```

### 优惠券规则实现

```php
<?php

declare(strict_types=1);

namespace App\Pricing\Rules;

use App\Pricing\Coupon\CouponRepository;
use App\Pricing\Coupon\CouponType;
use App\Pricing\DiscountLine;
use App\Pricing\PricingContext;
use App\Pricing\PricingResult;

final readonly class CouponRule implements PricingRule
{
    public function __construct(
        private CouponRepository $couponRepo,
        private string $version = '1.0.0',
    ) {}

    public function supports(PricingContext $context, PricingResult $result): bool
    {
        return $context->couponCodes !== [];
    }

    public function apply(PricingContext $context, PricingResult $result): PricingResult
    {
        $current = $result;

        foreach ($context->couponCodes as $code) {
            $coupon = $this->couponRepo->findActiveByCode($code, $context->at);
            if ($coupon === null) {
                continue;
            }

            // 门槛检查：这里用折后价，避免折上折超卖
            $meets = $coupon->minSpendCents <= $current->totalAmountCents;
            if (!$meets) {
                continue;
            }

            $current = match ($coupon->type) {
                CouponType::FixedAmount => $this->applyFixedAmount($context, $current, $coupon),
                CouponType::PercentDiscount => $this->applyPercentDiscount($context, $current, $coupon),
                CouponType::FreeShipping => $current, // 运费在另外一层处理
                CouponType::BuyXGetY => $this->applyBuyXGetY($context, $current, $coupon),
            };
        }

        return $current;
    }

    private function applyFixedAmount(PricingContext $context, PricingResult $result, object $coupon): PricingResult
    {
        $discountCents = min($coupon->valueCents, $result->finalUnitPriceCents);

        return $result->withDiscount(
            new DiscountLine(
                code: 'COUPON_FIXED',
                label: "满减券 {$coupon->code}：-{$coupon->valueCents} 分",
                amountCents: -$discountCents,
                type: 'coupon',
                version: $this->version,
            ),
        );
    }

    private function applyPercentDiscount(PricingContext $context, PricingResult $result, object $coupon): PricingResult
    {
        $discountCents = (int) round($result->finalUnitPriceCents * $coupon->percentOff / 100);

        return $result->withDiscount(
            new DiscountLine(
                code: 'COUPON_PERCENT',
                label: "折扣券 {$coupon->code}：{$coupon->percentOff}%",
                amountCents: -$discountCents,
                type: 'coupon',
                version: $this->version,
            ),
        );
    }

    private function applyBuyXGetY(PricingContext $context, PricingResult $result, object $coupon): PricingResult
    {
        // 简化示例：买 3 送 1
        $freeQty = intdiv($context->quantity, $coupon->buyQty) * $coupon->giftQty;
        $freeAmountCents = $freeQty * $result->finalUnitPriceCents;

        return $result->withDiscount(
            new DiscountLine(
                code: 'COUPON_BXYG',
                label: "买赠券 {$coupon->code}：免 {$freeQty} 件",
                amountCents: -$freeAmountCents,
                type: 'coupon',
                version: $this->version,
            ),
        );
    }
}
```

这里一个核心原则是：**优惠券折扣基于 `finalUnitPriceCents`，而不是 `originalUnitPriceCents`**。除非产品明确要求“原价券”，否则大多数 B2C 促销都应该是折后叠加，否则容易出现比价异常。

---

## 价格快照落地

价格快照要和订单、退款、对账打通，最好做成**事件驱动**：

```php
<?php

declare(strict_types=1);

namespace App\Pricing\Listeners;

use App\Events\OrderCreated;
use App\Pricing\PriceSnapshot;
use App\Pricing\PriceSnapshotRepository;

final class StorePriceSnapshotOnOrderCreated
{
    public function __construct(
        private PriceSnapshotRepository $repo,
    ) {}

    public function handle(OrderCreated $event): void
    {
        $snapshot = PriceSnapshot::fromCalculation($event->pricingResult);

        $this->repo->store(
            orderId: $event->orderId,
            snapshot: $snapshot,
        );
    }
}
```

下单时把 `PricingResult` 一起传给事件：

```php
<?php

declare(strict_types=1);

namespace App\Orders;

use App\Events\OrderCreated;
use App\Pricing\PricingContext;
use App\Pricing\PricingEngine;
use App\Pricing\PriceSnapshot;

final class CreateOrderAction
{
    public function __construct(
        private PricingEngine $engine,
    ) {}

    public function execute(CreateOrderRequest $request): Order
    {
        $context = new PricingContext(
            userId: $request->userId,
            skuId: $request->skuId,
            quantity: $request->quantity,
            regionCode: $request->regionCode,
            currency: $request->currency,
            at: new \DateTimeImmutable('now', new \DateTimeZone('Asia/Shanghai')),
            couponCodes: $request->couponCodes,
        );

        $pricingResult = $this->engine->calculate($context);

        // 写订单
        $order = Order::create([
            'user_id' => $context->userId,
            'sku_id' => $context->skuId,
            'quantity' => $context->quantity,
            'original_price_cents' => $pricingResult->originalUnitPriceCents,
            'final_price_cents' => $pricingResult->finalUnitPriceCents,
            'total_amount_cents' => $pricingResult->totalAmountCents,
            'currency' => $pricingResult->currency,
        ]);

        // 发事件，存快照
        event(new OrderCreated(
            orderId: $order->id,
            pricingResult: $pricingResult,
        ));

        return $order;
    }
}
```

退款时直接从快照还原：

```php
<?php

declare(strict_types=1);

namespace App\Refunds;

use App\Pricing\PriceSnapshotRepository;

final class RefundAction
{
    public function __construct(
        private PriceSnapshotRepository $snapshotRepo,
    ) {}

    public function execute(int $orderId, int $refundQty): RefundResult
    {
        $snapshot = $this->snapshotRepo->getByOrderId($orderId);

        $refundAmountCents = $snapshot->finalUnitPriceCents * $refundQty;

        // 这里再走风控、渠道退款逻辑
        return new RefundResult(
            orderId: $orderId,
            refundAmountCents: $refundAmountCents,
            currency: $snapshot->currency,
            snapshotHash: hash('xxh3', json_encode($snapshot, JSON_THROW_ON_ERROR)),
        );
    }
}
```

---

## 踩坑记录

### 1. 用 float 存价格是定时炸弹

这是我见过最高频的电商事故源之一。

```php
// 错误
$price = 19.99;
$discount = $price * 0.85;

// 正确
$priceCents = 1999;
$discountCents = (int) round($priceCents * 0.85); // 1699
```

在 PHP 里 `float` 的精度问题会随着累计计算放大，尤其在多次折扣叠加后，一分钱误差都会导致财务对账失败。

所以核心原则是：

- 数据库存 **int cents**
- 展示层再做 `/100`
- 计算层禁止直接用 float 做金额运算

### 2. 阶梯折扣和优惠券叠加顺序写死会导致业务僵化

早期我们把规则顺序硬编码在 `PricingEngine` 里，结果每次活动规则变更都要改代码上线。

后来改成**规则带 metadata + 排序字段**：

```php
final readonly class PricingRuleMetadata
{
    public function __construct(
        public int $priority, // 数字越小越先执行
        public string $layer,
        public bool $stackable = true,
    ) {}
}
```

这样运营和产品调整规则顺序时，只需要改配置，不改计算引擎。

### 3. 活动时间回溯会炸掉定价一致性

一个经典问题：

- 活动 2026-06-10 00:00:00 开始
- 用户在 23:59:59 提交订单
- 服务端在 00:00:03 才落库

如果用数据库 `created_at` 判定活动状态，就会出现“活动还没开始却享受了折扣”。

正确做法是：

- **订单创建时把 `PricingResult` 快照写死**
- 后续展示、退款、对账都用快照，不再重新计算活动价
- 活动规则变更只影响新订单，不影响存量

### 4. 优惠券和满减规则没有互斥设计

最容易被忽略的业务问题：

- 满 200 减 30
- 有一张 8 折券
- 用户买了一个 210 元商品

如果先算满减再算折扣：

```php
$after满减 = 210 - 30 = 180;
$after折扣 = 180 * 0.8 = 144;
```

如果先算折扣再算满减：

```php
$after折扣 = 210 * 0.8 = 168;
// 不满足 200 满减门槛
```

两种顺序结果完全不同。

我的方案是：

1. 明确券的 layer
2. 明确门槛是基于 `current price` 还是 `original price`
3. 写成规则文档，不要藏在代码逻辑里

### 5. 退款金额和实付金额对不上

这通常是缺少价格快照导致的。如果退款时重新计算活动价，一旦活动已结束，就会出现：

- 实付 144 元
- 退款时按原价算成 210 元
- 或按当前无活动价算成 180 元

所以必须做快照。

### 6. 高并发场景下折扣规则不要依赖实时锁更新

比如库存联动折扣：

- 库存 <= 100 时打 9 折
- 库存 <= 50 时打 8 折

如果每次下单都实时判断库存，高并发下很容易出现：

- 多个请求同时读到库存 51
- 全都按 9 折下单
- 最后实际库存已经到 30

这类规则要么：

- 改成异步结算
- 或把折扣判断收敛到统一状态机
- 或接受短时间价格抖动，用对账修正

---

## 总结

Laravel 里的定价引擎做到后面，会发现它越来越像一个**小型业务内核**：

- 有输入上下文
- 有规则执行顺序
- 有中间结果演进
- 有价格快照
- 有审计链路
- 有兜底保护

如果一开始就把它当成“只是算一下价格”，后面一定会被优惠券叠加、阶梯折扣、退款快照、财务对账反复折磨。

我自己的经验总结下来，最重要的几条是：

1. **金额全部用 int cents**，不要用 float
2. **计算结果要不可变**，不要原地修改 PricingResult
3. **价格快照必须在下单时固定**，不要事后重算
4. **优惠券和折扣要分层**，别把所有规则混在一起
5. **规则顺序要可配置**，不要硬编码到引擎核心
6. **一定要有兜底逻辑**，防止价格变成负数或者异常值
7. **退款和对账必须基于快照**，而不是重新计算当前活动价

定价引擎不是最难的算法问题，却是最难治理的业务问题。因为它直接和钱挂钩，出了问题不仅影响用户体验，还会直接影响财务和运营信任。

把规则理清楚、把快照做扎实、把审计留出来，后面会省很多事。

---

*本文基于 Laravel 8 / PHP 8.x 环境实战总结，代码示例已做脱敏处理，可根据实际业务场景调整规则实现与快照存储方式。*
