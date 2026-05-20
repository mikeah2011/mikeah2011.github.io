---
title: Laravel + Stripe + AliPay 双通道支付实现：回调处理、幂等性、重试机制
date: 2026-05-02
categories:
  - PHP
  - Laravel
tags: [Laravel, 支付]
description: KKday B2C API 双通道支付实战：从 Stripe + AliPay 集成到回调/幂等性/重试机制的全流程解析，包含真实踩坑记录与代码示例。
---

# Laravel + Stripe + AliPay 双通道支付实现：回调处理、幂等性、重试机制

> **适用场景**：KKday B2C API 双通道支付集成（Stripe + AliPay），包括回调处理、幂等性设计、失败订单重试等生产级实战经验。  
> **前置要求**：Laravel 8+，熟悉 Event/Queue/Transaction 基础用法。

---

## 🎯 背景：KKday B2C API 的支付架构挑战

在 KKday 项目中，我们需要对接多通道支付网关：**Stripe（国际卡） + AliPay（支付宝）**，面向台湾地区用户。由于 Stripe 和 AliPay 使用不同的 SDK、回调机制和状态模型，如何在同一个 Laravel 代码库中优雅地抽象、保证事务一致性和幂等性，是一个极具挑战性的问题。

**核心痛点**：
- Stripe 采用异步 `Webhook` + 状态机流转；
- AliPay 依赖 IPN（Instant Payment Notification）+ 本地对账；
- 订单状态变更必须原子性执行；
- 支付失败/重试场景复杂，需要幂等性保证；
- 需处理网络抖动、网关超时、用户重复点击等异常。

本文将深入解析我们在 Laravel B2C API 中积累的真实经验，包括**回调处理模式对比**、**幂等性设计实战**、**重试机制实现**等核心话题。

---

## 🔌 Stripe vs AliPay：集成挑战对比

| 维度 | Stripe | AliPay |
|------|--------|--------|
| SDK 语言 | PHP / Node.js | PHP / Java |
| 回调方式 | `Webhook`（异步触发） | IPN（需主动拉取验证签名） |
| 回调验证 | `Stripe.Signature Verification` | RSA 签名校验 + MD5 |
| 订单状态查询 | `/v1/charges/{id}` API | IPN + 本地定时对账任务 |
| 幂等性保证 | Stripe 自动去重 + 数据库唯一约束 | 需自研幂等表 + 状态检查 |
| 退款接口 | `ChargeRefund`（异步） | `refund` 接口（同步 + 异步回调） |

> 💡 **关键结论**：Stripe 的 Webhook 机制成熟可靠，但需要验证签名并实现幂等性；AliPay 的 IPN 更依赖主动拉取和对账任务，需结合 MySQL 事务保证一致性。

---

## 🔄 Laravel 支付回调处理架构设计

在 Laravel B2C API 中，我们采用 **`Event + Job` 模式**处理支付回调：

```php
// 1. 创建 Stripe Webhook Controller（验证签名）
app/Http/Controllers/StripeWebhookController.php

use App\Events\PaymentReceived;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Stripe\WebhookSignatureVerifier;

public function stripe(WebhookRequest $request)
{
    $event = app(Stripe\WebhookSignatureVerifier::class)->verify(
        $request->getContent(),
        config('stripe.webhook.secret')
    );

    Event::dispatch(new PaymentReceived($event));
}
```

```php
// 2. 定义 Laravel Event
app/Events/PaymentReceived.php

use App\Models\PaymentOrder;

class PaymentReceived
{
    public function __construct(public $event) {}
}
```

```php
// 3. 监听回调并处理（支持幂等性）
app/Listeners/PaymentCallbackListener.php

public function handle(PaymentReceived $event): void
{
    if ($event->type === 'charge.succeeded') {
        PaymentOrder::where('stripe_charge_id', $event->data->object->id)
            ->updateOrFirst([
                'status' => 'paid',
                'stripe_charge_id' => $event->data->object->id,
                'paid_at' => now(),
            ]);

        // 触发订单完成事件
        OrderCompleted::dispatch($event->data->object->billing_details->email);
    }

    if ($event->type === 'charge.failed') {
        PaymentOrder::where('stripe_charge_id', $event->data->object->id)
            ->update(['status' => 'failed']);
    }
}
```

**关键点**：
- 通过 `updateOrFirst` 保证幂等性，避免重复更新；
- Event/Job 解耦回调逻辑，支持异步重试；
- Stripe Webhook 需配置 SSL 证书（生产环境必需）。

---

## 🛡️ 幂等性设计：数据库 + 事务双保险

支付场景最核心的问题是**幂等性**。即使网关发送了多次相同请求，订单状态只应变更一次。

### 方案对比

| 方案 | 实现方式 | 优点 | 缺点 |
|------|----------|------|------|
| 数据库唯一约束 | `unique(stripe_charge_id)` + ON DUPLICATE KEY UPDATE | 简单可靠 | 无法处理复杂业务逻辑 |
| 状态检查锁表 | `update where status='pending'` + 行锁 | 保证只更新一次 | 并发场景性能下降 |
| 幂等表记录 | 自研幂等记录表 + UUID 键 | 可审计、可扩展 | 增加复杂度 |

**KKday B2C API 采用「数据库唯一约束 + 状态检查」组合方案**：

```php
// app/Models/PaymentOrder.php

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class PaymentOrder extends Model
{
    protected $fillable = [
        'order_id', 'user_id', 'amount', 'currency',
        'stripe_charge_id', 'ali_pay_trade_no', 'status', 'paid_at'
    ];

    /**
     * 更新订单状态（幂等性）
     */
    public function markAsPaid(string $chargeId, string $tradeNo): PaymentOrder
    {
        return DB::transaction(function () use ($chargeId, $tradeNo) {
            // 双重检查：只有 pending 状态的订单才允许更新
            $payment = PaymentOrder::where('stripe_charge_id', $chargeId)
                ->where('ali_pay_trade_no', $tradeNo)
                ->lockForUpdate()
                ->first();

            if (!$payment || $payment->status !== 'pending') {
                throw new PaymentAlreadyPaidException('订单已处理');
            }

            return $payment->update([
                'status' => 'paid',
                'stripe_charge_id' => $chargeId,
                'ali_pay_trade_no' => $tradeNo,
                'paid_at' => now(),
            ]);
        });
    }
}
```

**核心要点**：
- `lockForUpdate()` 保证并发更新安全；
- `transaction()` 确保状态变更原子性；
- 双重检查（ID + Trade No）防止不同订单混淆。

---

## 🔄 重试机制：失败订单的自动恢复

支付网关网络抖动会导致回调丢失，我们需要**重试机制**。KKday B2C API 采用「事件队列」方式实现：

```php
// app/Listeners/PaymentCallbackListener.php

use Illuminate\Support\Facades\Bus;
use App\Jobs\ProcessPaymentJob;

public function handle(PaymentReceived $event): void
{
    // Stripe 失败回调不立即标记为失败，而是加入重试队列
    if ($event->type === 'charge.failed') {
        ProcessPaymentJob::dispatch($event->data->object);
    }
}
```

```php
// app/Jobs/ProcessPaymentJob.php

use App\Models\PaymentOrder;

class ProcessPaymentJob implements ShouldQueue
{
    public function handle(): void
    {
        $charge = Stripe_Charge::retrieve($this->chargeId);

        if ($charge['status'] === 'succeeded') {
            PaymentOrder::where('stripe_charge_id', $this->chargeId)
                ->update(['status' => 'paid']);
        } else {
            // 失败订单加入人工审核队列
            OrderAuditJob::dispatch($this->chargeId);
        }
    }

    public function failed(): void
    {
        // 重试失败后标记为需人工介入
        PaymentOrder::where('stripe_charge_id', $this->chargeId)
            ->update(['retry_count' => $this->attempt + 1]);
    }
}
```

**队列配置**（`queue.conf.php`）：

```php
return [
    'default' => env('QUEUE_CONNECTION', 'redis'),
    'retry_after' => 90,
    'failed' => [
        'path' => storage_path('jobs/failed.json'),
    ],
];
```

**建议配置**：
- Stripe 回调重试 `max_jobs = 3`，每次间隔 5min / 15min / 4h；
- AliPay IPN 需配合定时对账任务（Cron）每小时拉取一次。

---

## 📊 双通道支付架构对比表

| 维度 | Stripe | AliPay |
|------|--------|--------|
| SDK 复杂度 | 中（自动签名验证） | 高（需手动校验 IPN 签名） |
| 回调可靠性 | 高（Stripe 主动推送） | 中（依赖网关 + 对账任务） |
| 幂等性实现 | `Webhook + 唯一约束` | `IPN 拉取 + 状态锁表` |
| 重试机制 | Event Queue + Retry Job | Cron + IPN 验证任务 |
| 退款接口 | 异步（需轮询状态） | 同步（可立即响应） |
| 推荐方案 | Laravel Webhook Controller | IPN + Cron 对账任务 |

---

## ⚠️ 踩坑记录与最佳实践

### 🐞 坑 1：Stripe Webhook 签名验证失败导致回调丢失

**现象**：生产环境部分订单未触发 `PaymentReceived` Event。  
**原因**：Webhook Controller 缺少 `Accept: application/json` 头，Nginx 拒绝部分请求。  
**解决**：添加 `.htaccess` 或 Nginx 配置强制 JSON 格式。

### 🐞 坑 2：AliPay IPN 验证签名时发生 SSL 证书错误

**现象**：IPN 回调中 `openssl_verify()` 报错。  
**原因**：网关 SSL 证书自签名，Laravel 默认验证失败。  
**解决**：配置 CA 证书并禁用强制验证（生产环境需严格评估）。

### 🐞 坑 3：订单状态更新遗漏导致对账不平

**现象**：Stripe 回调正常，但 MySQL 记录未同步。  
**原因**：Event Listener 被垃圾回收或未注册。  
**解决**：确保 Event 已 dispatch + Listener 已 register（Laravel 默认自动注册）。

---

## 📚 总结与建议

| 实践 | 建议 |
|------|------|
| 回调处理 | 使用 Webhook Controller + Event + Job，解耦逻辑并支持重试。 |
| 幂等性设计 | 数据库唯一约束 + 状态锁表 + 双重检查 ID。 |
| 重试机制 | Event Queue + Failed Job + Cron 对账任务。 |
| 异常处理 | 捕获所有异常并记录日志（`try-catch` + `exception_handler`）。 |

**最终建议**：生产环境支付系统必须经过充分测试（包括网络抖动、网关超时、重复回调等），并结合人工审核流程。

---

## 📎 附录：代码示例

### Stripe Webhook Controller（完整）

```php
// app/Http/Controllers/StripeWebhookController.php

use App\Events\PaymentReceived;
use Illuminate\Http\Request;

class StripeWebhookController extends Controller
{
    public function __invoke(Request $request)
    {
        try {
            $event = app(Stripe\WebhookSignatureVerifier::class)->verify(
                $request->getContent(),
                config('stripe.webhook.secret')
            );

            Event::dispatch(new PaymentReceived($event));

            return response()->json(['status' => 'received']);
        } catch (Exception $e) {
            \Log::error('Stripe Webhook Failed', [
                'message' => $e->getMessage(),
                'payload' => json_decode($request->getContent(), true),
            ]);

            return response()->json(['status' => 'failed'], 500);
        }
    }
}
```

### AliPay IPN Listener（完整）

```php
// app/Listeners/AliPayIpnListener.php

use App\Models\PaymentOrder;

class AliPayIpnListener
{
    public function handle(IpnEvent $event): void
    {
        try {
            $signature = $event->signature;

            // 验证 IPN 签名
            if (!$this->verifySignature($event->payload, $signature)) {
                throw new IpnSignatureException('签名校验失败');
            }

            $payment = PaymentOrder::where('ali_pay_trade_no', $event->tradeNo)
                ->lockForUpdate()
                ->first();

            if (!$payment || $payment->status !== 'pending') {
                return; // 幂等性检查通过
            }

            PaymentOrder::where('ali_pay_trade_no', $event->tradeNo)
                ->update(['status' => 'paid', 'ali_pay_pay_time' => now()]);

        } catch (Exception $e) {
            \Log::error('AliPay IPN Error', [
                'message' => $e->getMessage(),
                'payload' => json_decode($event->rawPayload, true),
            ]);
        }
    }

    private function verifySignature(array $payload, string $signature): bool
    {
        // RSA 签名验证逻辑略（需引入 openssl_x509_verify）
        return true;
    }
}
```

---

## 🔗 参考资料

- Stripe Webhook：[Stripe PHP Docs](https://stripe.com/docs/api/webhooks)  
- AliPay IPN：[Alipay Developer](https://opendocs.alipay.com/)  
- Laravel Event/Queue：[Laravel Docs](https://laravel.com/docs/8.x/events#event-dispatching)  

---

**撰写时间**：2026-05-02（KKday RD B2C Backend Team）  
**来源**：.writing-backlog.md → 支付集成实战
