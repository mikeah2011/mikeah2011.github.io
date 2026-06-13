---
title: Stripe Billing 实战：订阅计费、Usage-based Pricing、发票管理——Laravel SaaS 的完整计费引擎与账单治理
keywords: [Stripe Billing, Usage, based Pricing, Laravel SaaS, 订阅计费, 发票管理, 的完整计费引擎与账单治理, PHP]
date: 2026-06-10 06:11:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Stripe
  - SaaS
  - Billing
  - Payment
  - Subscription
description: 从零构建 Laravel SaaS 的完整计费引擎：Stripe 订阅管理、Usage-based Pricing 实时用量上报、发票自动化与 Webhook 事件治理，附可运行代码与生产踩坑记录。
---


## 为什么需要 Stripe Billing？

每个 SaaS 产品都逃不开计费。当你从「免费 + 付费」的简单二分法，演进到多层级订阅、按量付费、试用期、优惠券、发票管理时，自研计费系统的复杂度会指数级增长。

Stripe Billing 不是一个简单的支付 SDK——它是 Stripe 提供的完整订阅管理引擎。它帮你处理：

- 订阅生命周期（创建、升级、降级、暂停、取消）
- 按量计费（Usage-based Pricing）的用量上报与账单聚合
- 发票自动生成、发送、收款、退款
- 税务合规（Tax、VAT）
- 优惠券与促销码

本文不是 Stripe API 的文档搬运，而是基于 Laravel + Cashier 的生产实战，覆盖从架构设计到踩坑修复的完整路径。

## 架构总览：Laravel + Cashier + Stripe Billing

```
┌─────────────────────────────────────────────────────┐
│                    Laravel Application              │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Auth     │  │ Feature  │  │ Billing Service  │  │
│  │ System   │  │ Gate     │  │ (Cashier)        │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                 │             │
│       └──────────────┼─────────────────┘             │
│                      │                               │
│              ┌───────▼────────┐                      │
│              │   Stripe API   │                      │
│              └───────┬────────┘                      │
└──────────────────────┼──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  Webhook Events │
              │  (Stripe → App) │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Event Handler  │
              │  Queue Workers  │
              └─────────────────┘
```

核心组件：

1. **Laravel Cashier**：Stripe 的官方 Laravel 封装，处理订阅、发票、Webhook 的基础逻辑
2. **Stripe Billing**：Stripe 端的计费引擎，管理 Subscription、Invoice、Usage Record
3. **Webhook Handler**：异步事件处理，确保应用状态与 Stripe 同步

## 一、环境搭建与配置

### 1.1 安装 Cashier

```bash
composer require laravel/cashier
php artisan vendor:publish --tag="cashier-migrations"
php artisan migrate
```

Cashier 会在 `users` 表追加 `stripe_id`、`pm_type`、`pm_last_four` 等字段，并创建 `subscriptions` 和 `subscription_items` 表。

### 1.2 配置 `.env`

```env
STRIPE_KEY=pk_test_xxxxx
STRIPE_SECRET=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
CASHIER_CURRENCY=usd
CASHIER_CURRENCY_LOCALE=en
```

### 1.3 User Model 集成

```php
<?php

namespace App\Models;

use Laravel\Cashier\Billable;

class User extends Authenticatable
{
    use Billable;

    /**
     * 判断用户是否在试用期内
     */
    public function isOnTrial(): bool
    {
        return $this->trial_ends_at && $this->trial_ends_at->isFuture();
    }

    /**
     * 获取当前活跃订阅
     */
    public function activeSubscription(string $name = 'default')
    {
        return $this->subscriptions()
            ->where('name', $name)
            ->where('stripe_status', 'active')
            ->first();
    }
}
```

## 二、订阅管理：多层级 Plan 设计

### 2.1 Stripe 端创建产品与价格

在 Stripe Dashboard 创建产品后，得到 Price ID：

| Plan | Price ID | 价格 | 周期 |
|------|----------|------|------|
| Starter | `price_starter_monthly` | $29/月 | 月付 |
| Pro | `price_pro_monthly` | $99/月 | 月付 |
| Enterprise | `price_enterprise_monthly` | $299/月 | 月付 |
| Pro Yearly | `price_pro_yearly` | $999/年 | 年付 |

### 2.2 创建 Checkout Session

```php
<?php

namespace App\Http\Controllers\Billing;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class SubscriptionController extends Controller
{
    /**
     * 创建 Stripe Checkout 会话
     */
    public function checkout(Request $request)
    {
        $request->validate([
            'price_id' => 'required|string',
            'trial_days' => 'nullable|integer|min:0|max:30',
        ]);

        $user = Auth::user();

        // 如果已有活跃订阅，不允许重复订阅
        if ($user->subscribed('default')) {
            return redirect()->route('billing.dashboard')
                ->with('error', '你已有活跃订阅，请先取消后再更换。');
        }

        $checkout = $user->newSubscription('default', $request->price_id)
            ->checkout([
                'success_url' => route('billing.success') . '?session_id={CHECKOUT_SESSION_ID}',
                'cancel_url'  => route('billing.cancel'),
                'trial_period_days' => $request->trial_days ?? 14,
                'metadata' => [
                    'user_id' => $user->id,
                    'plan' => $request->price_id,
                ],
            ]);

        return redirect($checkout->url);
    }
}
```

### 2.3 订阅升级/降级

```php
/**
 * 切换订阅计划（支持升降级）
 */
public function changePlan(Request $request)
{
    $request->validate([
        'new_price_id' => 'required|string',
    ]);

    $user = Auth::user();
    $subscription = $user->subscription('default');

    if (!$subscription || !$subscription->valid()) {
        abort(400, '无有效订阅');
    }

    // 获取当前订阅项
    $subscriptionItem = $subscription->items()->first();

    // 切换计划，按比例计费（prorate）
    $subscription->swap($request->new_price_id, [
        'proration_behavior' => 'create_prorations', // 按比例退/补差价
    ]);

    return redirect()->route('billing.dashboard')
        ->with('success', '计划已切换，差价已按比例计算。');
}
```

**proration_behavior 选项说明：**

| 值 | 行为 |
|----|------|
| `create_prorations` | 按比例计算差价，下期发票体现 |
| `none` | 不计算差价，下个周期生效 |
| `always_invoice` | 立即生成发票，收取差价 |

### 2.4 订阅暂停与恢复

```php
/**
 * 暂停订阅（Stripe 的 pause 功能）
 */
public function pause()
{
    $user = Auth::user();
    $subscription = $user->subscription('default');

    // 暂停到当前周期结束，之后停止计费
    $subscription->pause([
        'behavior' => 'void', // 当前周期剩余时间作废
    ]);

    return redirect()->route('billing.dashboard')
        ->with('success', '订阅已暂停。');
}

/**
 * 恢复订阅
 */
public function resume()
{
    $user = Auth::user();
    $subscription = $user->subscription('default');

    if ($subscription->paused()) {
        $subscription->resume();
        return redirect()->route('billing.dashboard')
            ->with('success', '订阅已恢复。');
    }

    return redirect()->route('billing.dashboard')
        ->with('error', '订阅未处于暂停状态。');
}
```

## 三、Usage-based Pricing：按量计费实战

这是 Stripe Billing 最强大的功能之一。场景：API 调用次数、存储用量、消息发送量等。

### 3.1 创建 Meter（计量器）

在 Stripe Dashboard 创建一个 Meter：

- **Meter Name**: API Calls
- **Aggregation**: Sum（求和）
- **Price**: $0.001/call

得到 Meter Price ID: `price_meter_api_calls`

### 3.2 订阅包含计量项

```php
/**
 * 创建包含基础订阅 + 按量计费的混合订阅
 */
public function createHybridSubscription(Request $request)
{
    $user = Auth::user();

    $checkout = $user->newSubscription('default', 'price_pro_monthly')
        ->meteredPrice('price_meter_api_calls') // 添加计量项
        ->checkout([
            'success_url' => route('billing.success') . '?session_id={CHECKOUT_SESSION_ID}',
            'cancel_url'  => route('billing.cancel'),
        ]);

    return redirect($checkout->url);
}
```

### 3.3 上报用量

这是关键环节——每次 API 调用后，向 Stripe 上报用量。

```php
<?php

namespace App\Services\Billing;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Laravel\Cashier\Cashier;

class UsageReportService
{
    /**
     * 上报单次 API 调用
     */
    public function reportApiCall(User $user, int $count = 1): void
    {
        $subscription = $user->subscription('default');

        if (!$subscription || !$subscription->valid()) {
            return;
        }

        // 找到 metered 订阅项
        $meteredItem = $subscription->items()
            ->where('stripe_price', 'price_meter_api_calls')
            ->first();

        if (!$meteredItem) {
            Log::warning('User has no metered item', ['user_id' => $user->id]);
            return;
        }

        // 上报用量（使用 subscription_item 级别的 usage record）
        $meteredItem->reportUsage($count);
    }

    /**
     * 批量上报（减少 API 调用次数）
     */
    public function reportBatch(User $user, int $totalCount, ?string $timestamp = null): void
    {
        $subscription = $user->subscription('default');

        if (!$subscription || !$subscription->valid()) {
            return;
        }

        $meteredItem = $subscription->items()
            ->where('stripe_price', 'price_meter_api_calls')
            ->first();

        if (!$meteredItem) {
            return;
        }

        $meteredItem->reportUsageFor(
            $totalCount,
            $timestamp ?? now()->timestamp
        );
    }
}
```

### 3.4 Middleware 自动上报

```php
<?php

namespace App\Http\Middleware;

use App\Services\Billing\UsageReportService;
use Closure;
use Illuminate\Http\Request;

class ReportApiUsage
{
    public function __construct(
        private UsageReportService $usageService
    ) {}

    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 仅对成功的 API 请求上报
        if ($request->user() && $response->isSuccessful()) {
            try {
                $this->usageService->reportApiCall($request->user());
            } catch (\Exception $e) {
                // 上报失败不影响正常请求
                report($e);
            }
        }

        return $response;
    }
}
```

**⚠️ 生产环境注意：** 逐条上报会触发大量 Stripe API 调用。建议用队列批量处理：

```php
<?php

namespace App\Jobs;

use App\Models\User;
use App\Services\Billing\UsageReportService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class BatchReportUsage implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public int $userId,
        public int $count
    ) {}

    public function handle(UsageReportService $usageService): void
    {
        $user = User::find($this->userId);
        if ($user) {
            $usageService->reportBatch($user, $this->count);
        }
    }
}
```

### 3.5 用量查询与配额控制

```php
/**
 * 查询当前周期用量
 */
public function getCurrentUsage(): array
{
    $user = Auth::user();
    $subscription = $user->subscription('default');

    if (!$subscription) {
        return ['usage' => 0, 'limit' => 0];
    }

    $meteredItem = $subscription->items()
        ->where('stripe_price', 'price_meter_api_calls')
        ->first();

    if (!$meteredItem) {
        return ['usage' => 0, 'limit' => 0];
    }

    // 从 Stripe 查询用量摘要
    $usageRecords = $meteredItem->usageRecords();
    $totalUsage = collect($usageRecords->data)->sum('total_usage');

    return [
        'usage' => $totalUsage,
        'limit' => $user->plan_limit ?? 10000, // 从数据库读取配额
        'percentage' => $totalUsage > 0 ? round(($totalUsage / ($user->plan_limit ?? 10000)) * 100, 1) : 0,
    ];
}
```

## 四、发票管理

### 4.1 发票自动发送

Stripe 默认会在发票 finalize 后自动发送。在 Customer Portal 或代码中配置：

```php
/**
 * 配置发票自动发送
 */
public function configureInvoiceSettings()
{
    $user = Auth::user();

    // 创建 Stripe Customer 时设置
    $user->createAsStripeCustomer([
        'email' => $user->email,
        'name'  => $user->name,
        'invoice_settings' => [
            'custom_fields' => [
                ['name' => 'Company', 'value' => $user->company_name ?? ''],
            ],
        ],
    ]);
}
```

### 4.2 自定义发票 PDF

```php
<?php

namespace App\Services\Billing;

use App\Models\Invoice as LocalInvoice;
use Illuminate\Support\Facades\Storage;
use Laravel\Cashier\Invoice;

class InvoiceService
{
    /**
     * 生成并存储发票 PDF
     */
    public function generatePdf(Invoice $invoice, int $userId): string
    {
        $pdf = $invoice->pdf([
            'vendor'  => config('app.name'),
            'product' => 'SaaS Subscription',
        ]);

        $path = "invoices/{$userId}/{$invoice->id}.pdf";

        Storage::disk('local')->put($path, $pdf);

        return $path;
    }

    /**
     * 获取用户的发票列表
     */
    public function getUserInvoices(int $userId, int $limit = 20): array
    {
        $user = \App\Models\User::find($userId);

        if (!$user->hasStripeId()) {
            return [];
        }

        return $user->invoices($limit)->map(fn(Invoice $invoice) => [
            'id'         => $invoice->id,
            'date'       => $invoice->date()->toDateString(),
            'total'      => $invoice->total(),
            'currency'   => $invoice->currency,
            'status'     => $invoice->status,
            'pdf_url'    => $invoice->invoice_pdf,
            'hosted_url' => $invoice->hosted_invoice_url,
        ])->toArray();
    }
}
```

### 4.3 发票 Webhook 处理

```php
<?php

namespace App\Http\Controllers\Webhooks;

use Illuminate\Http\Request;
use Laravel\Cashier\Http\Controllers\WebhookController as CashierController;

class StripeWebhookController extends CashierController
{
    /**
     * 处理发票支付成功
     */
    protected function handleInvoicePaymentSucceeded(array $payload): void
    {
        $invoice = $payload['data']['object'];
        $customerId = $invoice['customer'];

        // 记录到本地数据库
        \App\Models\PaymentLog::create([
            'stripe_customer_id' => $customerId,
            'stripe_invoice_id'  => $invoice['id'],
            'amount'             => $invoice['amount_paid'],
            'currency'           => $invoice['currency'],
            'status'             => 'paid',
            'paid_at'            => now(),
        ]);

        // 发送收据邮件
        $user = \App\Models\User::where('stripe_id', $customerId)->first();
        if ($user) {
            \App\Mail\InvoicePaid::dispatch($user, $invoice);
        }
    }

    /**
     * 处理发票支付失败
     */
    protected function handleInvoicePaymentFailed(array $payload): void
    {
        $invoice = $payload['data']['object'];
        $customerId = $invoice['customer'];

        $user = \App\Models\User::where('stripe_id', $customerId)->first();

        if ($user) {
            // 记录失败
            \App\Models\PaymentLog::create([
                'stripe_customer_id' => $customerId,
                'stripe_invoice_id'  => $invoice['id'],
                'amount'             => $invoice['amount_due'],
                'currency'           => $invoice['currency'],
                'status'             => 'failed',
                'failed_at'          => now(),
            ]);

            // 发送支付失败通知
            $user->notify(new \App\Notifications\PaymentFailed($invoice));

            // 如果连续失败 3 次，暂停订阅
            $failures = \App\Models\PaymentLog::where('stripe_customer_id', $customerId)
                ->where('status', 'failed')
                ->where('failed_at', '>', now()->subDays(7))
                ->count();

            if ($failures >= 3) {
                $subscription = $user->subscription('default');
                if ($subscription && $subscription->valid()) {
                    $subscription->cancel();
                    $user->notify(new \App\Notifications\SubscriptionCancelledDueToPaymentFailure());
                }
            }
        }
    }
}
```

## 五、Webhook 事件治理

### 5.1 完整的 Webhook 路由

```php
// routes/web.php
Route::post(
    '/stripe/webhook',
    [StripeWebhookController::class, 'handleWebhook']
)->name('cashier.webhook');
```

### 5.2 关键事件清单

必须监听的事件：

| 事件 | 用途 |
|------|------|
| `customer.subscription.created` | 初始化订阅记录 |
| `customer.subscription.updated` | 同步计划变更 |
| `customer.subscription.deleted` | 处理取消 |
| `invoice.payment_succeeded` | 确认付款 |
| `invoice.payment_failed` | 付款失败重试 |
| `customer.subscription.trial_will_end` | 试用期即将结束通知 |
| `payment_method.attached` | 更新支付方式 |
| `charge.refunded` | 退款处理 |

### 5.3 Webhook 签名验证

Cashier 自动处理，但如果你需要手动验证：

```php
use Laravel\Cashier\Http\Middleware\VerifyWebhookSignature;

// 确保中间件已注册
Route::middleware([VerifyWebhookSignature::class])->group(function () {
    Route::post('/stripe/webhook', [StripeWebhookController::class, 'handleWebhook']);
});
```

### 5.4 Webhook 幂等性

Stripe 可能重复发送事件，必须保证幂等：

```php
<?php

namespace App\Services\Billing;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class WebhookIdempotency
{
    /**
     * 检查事件是否已处理
     */
    public function isProcessed(string $eventId): bool
    {
        return DB::table('webhook_events')
            ->where('stripe_event_id', $eventId)
            ->exists();
    }

    /**
     * 标记事件已处理
     */
    public function markProcessed(string $eventId, string $eventType): void
    {
        DB::table('webhook_events')->insert([
            'stripe_event_id' => $eventId,
            'type'            => $eventType,
            'processed_at'    => now(),
            'created_at'      => now(),
        ]);
    }

    /**
     * 获取锁（防止并发处理同一事件）
     */
    public function acquireLock(string $eventId, int $ttl = 60): bool
    {
        return Cache::lock("webhook:{$eventId}", $ttl)->get();
    }
}
```

## 六、Customer Portal：自助管理

### 6.1 创建 Portal Session

```php
/**
 * 生成 Stripe Customer Portal 链接
 */
public function portal()
{
    $user = Auth::user();

    return $user->redirectToBillingPortal([
        'return_url' => route('billing.dashboard'),
    ]);
}
```

### 6.2 自定义 Portal 配置

在 Stripe Dashboard → Settings → Customer Portal 中配置：

- 允许客户切换计划
- 允许取消订阅（立即/周期结束）
- 允许更新支付方式
- 允许查看发票历史

## 七、生产踩坑记录

### 踩坑 1：Webhook 事件乱序

**现象：** `invoice.payment_succeeded` 在 `customer.subscription.created` 之前到达，导致找不到订阅记录。

**解决：** 在 Webhook handler 中加入重试逻辑：

```php
protected function handleInvoicePaymentSucceeded(array $payload): void
{
    $customerId = $payload['data']['object']['customer'];

    // 确保用户和订阅记录存在
    $user = \App\Models\User::where('stripe_id', $customerId)->first();

    if (!$user) {
        // 用户可能还没创建完成，延迟重试
        static::failWebhookJob(new \RuntimeException("User not found for customer {$customerId}"));
        return;
    }

    // ... 正常处理
}
```

### 踩坑 2：试用期转换时的双重扣款

**现象：** 用户试用期结束时，Stripe 先扣了订阅费，又扣了一次 usage 费用，总金额不符合预期。

**原因：** `trial_days` 和 metered 计费周期不匹配。

**解决：** 试用期内禁止上报用量：

```php
public function reportApiCall(User $user, int $count = 1): void
{
    // 试用期内不上报用量
    if ($user->onTrial()) {
        return;
    }

    // ... 正常上报
}
```

### 踩坑 3：订阅取消后仍有活跃状态

**现象：** 用户取消订阅后，`stripe_status` 仍然是 `active` 直到周期结束。

**原因：** Stripe 的取消是「周期结束生效」，不是立即失效。

**解决：** 使用 `valid()` 而非检查 `active`：

```php
// ❌ 错误：只检查 active 状态
if ($user->subscription('default')->stripe_status === 'active') {
    // 取消后仍然进入这里
}

// ✅ 正确：使用 valid()，它处理了 active、trialing、past_due 等有效状态
if ($user->subscription('default')?->valid()) {
    // 有效期内正常访问
}
```

### 踩坑 4：金额精度问题

**现象：** `$99.99` 的订阅在 Stripe 中显示为 `9999`（分），转换回元时出现浮点精度问题。

**解决：** Cashier 的 `asStripeAmount()` 和 `asDecimal()` 方法：

```php
// ✅ 正确做法
$amount = $invoice->total(); // 返回整数（分）
$display = number_format($amount / 100, 2); // "99.99"

// ✅ 或使用 Cashier 的格式化
$display = $invoice->total() / 100; // 直接除以 100
```

### 踩坑 5：Webhook 签名验证在 Nginx 反代后失败

**现象：** 本地测试正常，部署到生产后 Webhook 返回 403。

**原因：** Nginx 反向代理修改了请求头。

**解决：** 在 Nginx 配置中保留原始头：

```nginx
location /stripe/webhook {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Stripe-Signature $http_stripe_signature;
}
```

## 八、测试策略

### 8.1 Stripe CLI 本地测试

```bash
# 安装 Stripe CLI
brew install stripe/stripe-cli/stripe

# 登录
stripe login

# 转发 Webhook 到本地
stripe listen --forward-to localhost:8000/stripe/webhook

# 触发测试事件
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
```

### 8.2 PHPUnit 测试

```php
<?php

namespace Tests\Feature\Billing;

use App\Models\User;
use Laravel\Cashier\Cashier;
use Tests\TestCase;

class SubscriptionTest extends TestCase
{
    public function test_user_can_subscribe(): void
    {
        $user = User::factory()->create();

        // 使用 Stripe 测试 Token
        $user->newSubscription('default', 'price_starter_monthly')
            ->create('pm_card_visa');

        $this->assertTrue($user->subscribed('default'));
        $this->assertTrue($user->subscription('default')->active());
    }

    public function test_user_can_switch_plan(): void
    {
        $user = User::factory()->create();
        $user->newSubscription('default', 'price_starter_monthly')
            ->create('pm_card_visa');

        $user->subscription('default')->swap('price_pro_monthly');

        $this->assertEquals(
            'price_pro_monthly',
            $user->subscription('default')->stripe_price
        );
    }
}
```

## 九、安全与合规

1. **Webhook Secret 必须配置**——不要跳过签名验证
2. **敏感数据不落库**——信用卡号、CVV 永远不要存到自己的数据库
3. **PCI 合规**——使用 Stripe Elements / Checkout，避免接触原始卡号
4. **日志脱敏**——Webhook payload 中的 `customer` 对象可能包含敏感信息，日志中不要原样输出
5. **速率限制**——Webhook endpoint 需要限流，防止被恶意调用

## 总结

Stripe Billing 不是「接入支付」这么简单——它是一个完整的计费引擎。关键认知：

1. **设计先行**：先想清楚 Plan 结构、计量逻辑、发票需求，再动手写代码
2. **Webhook 是生命线**：所有状态同步都靠 Webhook，必须保证可靠、幂等、可重试
3. **用量上报要批量化**：逐条上报是性能杀手，用队列 + 批量上报
4. **测试用 Stripe CLI**：不要在生产环境测试，用 `stripe listen` + `stripe trigger` 在本地完成
5. **关注边界情况**：试用期转换、取消后的宽限期、支付失败重试，这些是 bug 重灾区

Stripe Billing 处理了计费 80% 的脏活累活，剩下 20% 是你的业务逻辑和异常处理。把精力花在那 20% 上，而不是重复造轮子。
