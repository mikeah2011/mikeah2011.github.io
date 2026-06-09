---
title: Stripe Billing 实战：订阅计费、Usage-based Pricing、发票管理——Laravel SaaS 的完整计费引擎与账单治理
date: 2026-06-10 06:03:00
categories:
  - PHP
tags:
  - Stripe
  - Laravel
  - SaaS
  - 订阅计费
  - Billing
  - Invoicing
description: 深入实战 Stripe Billing 在 Laravel SaaS 中的应用，涵盖订阅生命周期管理、Usage-based Pricing 动态计费、发票自动生成与治理、Webhook 事件处理、常见踩坑与生产环境最佳实践。
---

## 概述

SaaS 应用的核心命脉之一是**计费引擎**。一个健壮的计费系统需要处理订阅创建、升降级、用量计费、账单生成、支付失败重试、发票管理等一系列复杂流程。Stripe Billing 作为业界最成熟的支付基础设施之一，提供了 Subscription、Usage-based Pricing、Invoice 等完整 API，但如何在 Laravel 中正确集成并处理生产环境的各种边界情况，是很多团队踩坑的地方。

本文将从零构建一个 Laravel SaaS 项目的计费引擎，覆盖以下核心场景：

- 订阅生命周期（创建、升降级、取消、恢复）
- Usage-based Pricing（按量计费）的计量与上报
- 发票自动生成、预览、PDF 导出
- Webhook 事件的可靠处理与幂等性
- 支付失败的优雅降级与通知
- 生产环境的常见陷阱与解决方案

<!-- more -->

## 核心概念

### Stripe Billing 架构全景

```
┌─────────────────────────────────────────────────┐
│                  Your Laravel App                │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Subscribe │  │  Usage   │  │   Invoice    │   │
│  │  Service  │  │ Metering │  │   Service    │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │               │            │
│       └──────────────┼───────────────┘            │
│                      │                            │
│              ┌───────▼───────┐                    │
│              │ Stripe Service │                    │
│              └───────┬───────┘                    │
│                      │                            │
└──────────────────────┼────────────────────────────┘
                       │
              ┌────────▼────────┐
              │   Stripe API    │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   Webhooks      │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Your Webhook   │
              │  Controller     │
              └─────────────────┘
```

### 关键 Stripe 资源关系

- **Customer**：对应一个 User（一对一）
- **Subscription**：绑定 Customer 和 Price（一个 Customer 可有多个活跃订阅）
- **Price**：可以是 recurring（按月/年）或 metered（按量）
- **Invoice**：自动生成或手动创建，记录每期账单
- **Usage Record**：metered 类型 Price 的用量上报

## 实战代码

### 1. 环境准备

安装 Stripe PHP SDK：

```bash
composer require stripe/stripe-php
```

配置环境变量：

```env
STRIPE_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
```

### 2. Stripe Service 封装

```php
<?php

namespace App\Services;

use App\Models\User;
use App\Models\Subscription;
use App\Models\UsageRecord;
use Illuminate\Support\Facades\Log;
use Stripe\Stripe;
use Stripe\Customer;
use Stripe\Subscription as StripeSubscription;
use Stripe\Price;
use Stripe\Invoice;
use Stripe\Exception\ApiErrorException;
use Stripe\Webhook;

class StripeService
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    /**
     * 创建 Stripe Customer（首次订阅时调用）
     */
    public function createCustomer(User $user): Customer
    {
        $customer = Customer::create([
            'email' => $user->email,
            'name' => $user->name,
            'metadata' => [
                'user_id' => $user->id,
            ],
        ]);

        $user->update(['stripe_customer_id' => $customer->id]);

        return $customer;
    }

    /**
     * 获取或创建 Stripe Customer
     */
    public function getOrCreateCustomer(User $user): Customer
    {
        if ($user->stripe_customer_id) {
            return Customer::retrieve($user->stripe_customer_id);
        }

        return $this->createCustomer($user);
    }

    /**
     * 创建订阅（支持多产品 + 试用期）
     */
    public function createSubscription(
        User $user,
        string $priceId,
        array $options = []
    ): StripeSubscription {
        $customer = $this->getOrCreateCustomer($user);

        $params = [
            'customer' => $customer->id,
            'items' => [
                [
                    'price' => $priceId,
                ],
            ],
            'payment_behavior' => 'default_incomplete',
            'payment_settings' => [
                'save_default_payment_method' => 'on_subscription',
            ],
            'expand' => ['latest_invoice.payment_intent'],
        ];

        if (isset($options['trial_period_days'])) {
            $params['trial_period_days'] = $options['trial_period_days'];
        }

        if (isset($options['coupon'])) {
            $params['coupon'] = $options['coupon'];
        }

        // 支持多产品订阅
        if (isset($options['additional_prices'])) {
            foreach ($options['additional_prices'] as $additionalPrice) {
                $params['items'][] = ['price' => $additionalPrice];
            }
        }

        $subscription = StripeSubscription::create($params);

        // 本地记录
        Subscription::create([
            'user_id' => $user->id,
            'stripe_subscription_id' => $subscription->id,
            'stripe_price_id' => $priceId,
            'status' => $subscription->status,
            'trial_ends_at' => $subscription->trial_end
                ? date('Y-m-d H:i:s', $subscription->trial_end)
                : null,
            'current_period_start' => date('Y-m-d H:i:s', $subscription->current_period_start),
            'current_period_end' => date('Y-m-d H:i:s', $subscription->current_period_end),
        ]);

        return $subscription;
    }

    /**
     * 升降级订阅
     */
    public function changePlan(
        User $user,
        string $newPriceId,
        bool $prorate = true
    ): StripeSubscription {
        $subscription = $user->activeSubscription;

        if (!$subscription) {
            throw new \RuntimeException('用户没有活跃订阅');
        }

        $stripeSubscription = StripeSubscription::retrieve(
            $subscription->stripe_subscription_id
        );

        // 获取当前订阅项
        $currentItem = $stripeSubscription->items->data[0];

        $updateParams = [
            'items' => [
                [
                    'id' => $currentItem->id,
                    'price' => $newPriceId,
                ],
            ],
            'proration_behavior' => $prorate ? 'create_prorations' : 'none',
            'billing_cycle_anchor' => 'unchanged',
        ];

        $updated = StripeSubscription::update(
            $subscription->stripe_subscription_id,
            $updateParams
        );

        // 更新本地
        $subscription->update([
            'stripe_price_id' => $newPriceId,
            'status' => $updated->status,
        ]);

        return $updated;
    }

    /**
     * 取消订阅（可选择是否立即或期末取消）
     */
    public function cancelSubscription(
        User $user,
        bool $immediately = false
    ): StripeSubscription {
        $subscription = $user->activeSubscription;

        if (!$subscription) {
            throw new \RuntimeException('用户没有活跃订阅');
        }

        if ($immediately) {
            $stripeSubscription = StripeSubscription::delete(
                $subscription->stripe_subscription_id
            );
        } else {
            $stripeSubscription = StripeSubscription::update(
                $subscription->stripe_subscription_id,
                [
                    'cancel_at_period_end' => true,
                ]
            );
        }

        $subscription->update([
            'status' => $stripeSubscription->status,
            'canceled_at' => now(),
        ]);

        return $stripeSubscription;
    }

    /**
     * 恢复已取消的订阅（在当前周期结束前）
     */
    public function resumeSubscription(User $user): StripeSubscription
    {
        $subscription = $user->canceledSubscription;

        if (!$subscription) {
            throw new \RuntimeException('用户没有可恢复的订阅');
        }

        $stripeSubscription = StripeSubscription::update(
            $subscription->stripe_subscription_id,
            [
                'cancel_at_period_end' => false,
            ]
        );

        $subscription->update([
            'status' => $stripeSubscription->status,
            'canceled_at' => null,
        ]);

        return $stripeSubscription;
    }

    /**
     * 上报 Usage（metered 类型）
     */
    public function reportUsage(
        User $user,
        int $quantity,
        string $description = '',
        ?int $timestamp = null
    ): UsageRecord {
        $subscription = $user->activeSubscription;

        if (!$subscription) {
            throw new \RuntimeException('用户没有活跃订阅');
        }

        $stripeSubscription = StripeSubscription::retrieve(
            $subscription->stripe_subscription_id,
            ['expand' => ['items']]
        );

        // 找到 metered 类型的 item
        $meteredItem = null;
        foreach ($stripeSubscription->items->data as $item) {
            if ($item->price->recurring->usage_type === 'metered') {
                $meteredItem = $item;
                break;
            }
        }

        if (!$meteredItem) {
            throw new \RuntimeException('订阅中没有 metered 类型的项目');
        }

        $params = [
            'quantity' => $quantity,
            'timestamp' => $timestamp ?? time(),
            'action' => 'increment', // increment 累加, set 直接设置
        ];

        if ($description) {
            $params['description'] = $description;
        }

        $usageRecord = \Stripe\UsageRecord::create([
            'quantity' => $params['quantity'],
            'timestamp' => $params['timestamp'],
            'action' => $params['action'],
        ], [
            'idempotency_key' => "usage_{$user->id}_" . ($timestamp ?? time()),
        ]);

        // 本地记录
        UsageRecord::create([
            'user_id' => $user->id,
            'subscription_id' => $subscription->id,
            'stripe_usage_record_id' => $usageRecord->id,
            'quantity' => $quantity,
            'description' => $description,
            'recorded_at' => date('Y-m-d H:i:s', $usageRecord->timestamp),
        ]);

        return $usageRecord;
    }

    /**
     * 预览下期账单
     */
    public function previewInvoice(User $user): ?Invoice
    {
        $subscription = $user->activeSubscription;

        if (!$subscription) {
            return null;
        }

        try {
            return Invoice::upcoming([
                'customer' => $user->stripe_customer_id,
                'subscription' => $subscription->stripe_subscription_id,
            ]);
        } catch (ApiErrorException $e) {
            Log::warning('预览发票失败', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * 验证 Webhook 签名
     */
    public function constructWebhookEvent(string $payload, string $sigHeader): object
    {
        return Webhook::constructEvent(
            $payload,
            $sigHeader,
            config('services.stripe.webhook_secret')
        );
    }
}
```

### 3. Webhook Handler（幂等处理）

```php
<?php

namespace App\Http\Controllers;

use App\Services\StripeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Stripe\Exception\SignatureVerificationException;

class StripeWebhookController extends Controller
{
    public function __construct(
        private StripeService $stripe
    ) {}

    public function handleWebhook(Request $request)
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');

        try {
            $event = $this->stripe->constructWebhookEvent($payload, $sigHeader);
        } catch (SignatureVerificationException $e) {
            Log::error('Stripe webhook 签名验证失败', [
                'error' => $e->getMessage(),
            ]);
            return response('Invalid signature', 400);
        }

        Log::info('Stripe webhook 收到', [
            'type' => $event->type,
            'id' => $event->id,
        ]);

        // 使用 idempotency key 防止重复处理
        $lockKey = "stripe_webhook_{$event->id}";
        $lock = \Illuminate\Support\Facades\Cache::lock($lockKey, 60);

        if (!$lock->get()) {
            Log::info('Stripe webhook 已处理，跳过', ['event_id' => $event->id]);
            return response('Already processed', 200);
        }

        try {
            match ($event->type) {
                'customer.subscription.created' => $this->handleSubscriptionCreated($event->data->object),
                'customer.subscription.updated' => $this->handleSubscriptionUpdated($event->data->object),
                'customer.subscription.deleted' => $this->handleSubscriptionDeleted($event->data->object),
                'invoice.paid' => $this->handleInvoicePaid($event->data->object),
                'invoice.payment_failed' => $this->handleInvoicePaymentFailed($event->data->object),
                'invoice.created' => $this->handleInvoiceCreated($event->data->object),
                'customer.subscription.trial_will_end' => $this->handleTrialWillEnd($event->data->object),
                default => Log::info('未处理的 Stripe webhook', ['type' => $event->type]),
            };
        } catch (\Throwable $e) {
            Log::error('Stripe webhook 处理异常', [
                'type' => $event->type,
                'error' => $e->getMessage(),
            ]);
            $lock->release();
            throw $e;
        }

        return response('OK', 200);
    }

    private function handleSubscriptionCreated($subscription): void
    {
        $localSub = \App\Models\Subscription::where(
            'stripe_subscription_id',
            $subscription->id
        )->first();

        if ($localSub) {
            $localSub->update(['status' => $subscription->status]);
        }
    }

    private function handleSubscriptionUpdated($subscription): void
    {
        $localSub = \App\Models\Subscription::where(
            'stripe_subscription_id',
            $subscription->id
        )->first();

        if ($localSub) {
            $localSub->update([
                'status' => $subscription->status,
                'current_period_start' => date(
                    'Y-m-d H:i:s',
                    $subscription->current_period_start
                ),
                'current_period_end' => date(
                    'Y-m-d H:i:s',
                    $subscription->current_period_end
                ),
                'stripe_price_id' => $subscription->items->data[0]->price->id ?? $localSub->stripe_price_id,
            ]);
        }
    }

    private function handleSubscriptionDeleted($subscription): void
    {
        $localSub = \App\Models\Subscription::where(
            'stripe_subscription_id',
            $subscription->id
        )->first();

        if ($localSub) {
            $localSub->update([
                'status' => 'canceled',
                'canceled_at' => now(),
            ]);
        }
    }

    private function handleInvoicePaid($invoice): void
    {
        // 更新订阅状态为 active
        if ($invoice->subscription) {
            $localSub = \App\Models\Subscription::where(
                'stripe_subscription_id',
                $invoice->subscription
            )->first();

            if ($localSub) {
                $localSub->update(['status' => 'active']);
            }
        }

        // 记录支付成功
        \App\Models\Invoice::updateOrCreate(
            ['stripe_invoice_id' => $invoice->id],
            [
                'user_id' => $this->getUserIdFromCustomer($invoice->customer),
                'amount_paid' => $invoice->amount_paid,
                'currency' => $invoice->currency,
                'status' => 'paid',
                'invoice_pdf' => $invoice->invoice_pdf,
                'period_start' => date('Y-m-d H:i:s', $invoice->period_start),
                'period_end' => date('Y-m-d H:i:s', $invoice->period_end),
            ]
        );
    }

    private function handleInvoicePaymentFailed($invoice): void
    {
        $userId = $this->getUserIdFromCustomer($invoice->customer);

        if (!$userId) {
            return;
        }

        // 通知用户支付失败
        \App\Notifications\PaymentFailedNotification::dispatch(
            \App\Models\User::find($userId),
            $invoice
        );

        // 标记订阅为 past_due
        if ($invoice->subscription) {
            $localSub = \App\Models\Subscription::where(
                'stripe_subscription_id',
                $invoice->subscription
            )->first();

            if ($localSub) {
                $localSub->update(['status' => 'past_due']);
            }
        }
    }

    private function handleInvoiceCreated($invoice): void
    {
        // 记录即将生成的发票
        Log::info('发票即将生成', [
            'invoice_id' => $invoice->id,
            'customer' => $invoice->customer,
            'amount_due' => $invoice->amount_due,
        ]);
    }

    private function handleTrialWillEnd($subscription): void
    {
        $userId = $this->getUserIdFromCustomer($subscription->customer);

        if (!$userId) {
            return;
        }

        // 试用期即将结束通知
        \App\Notifications\TrialEndingNotification::dispatch(
            \App\Models\User::find($userId),
            $subscription
        );
    }

    private function getUserIdFromCustomer(string $customerId): ?int
    {
        return \App\Models\User::where('stripe_customer_id', $customerId)
            ->value('id');
    }
}
```

### 4. Usage Metering 中间件

```php
<?php

namespace App\Http\Middleware;

use App\Services\StripeService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class MeterApiUsage
{
    public function __construct(
        private StripeService $stripe
    ) {}

    public function handle(Request $request, Closure $next, ?string $weight = null): Response
    {
        $response = $next($request);

        // 仅在成功响应时计量
        if ($response->getStatusCode() >= 200 && $response->getStatusCode() < 300) {
            try {
                $user = $request->user();

                if ($user && $user->activeSubscription) {
                    $usageWeight = (int) ($weight ?? 1);

                    $this->stripe->reportUsage(
                        $user,
                        $usageWeight,
                        sprintf(
                            'API call: %s %s',
                            $request->method(),
                            $request->path()
                        )
                    );
                }
            } catch (\Throwable $e) {
                // 计量失败不应影响正常请求
                Log::warning('Usage metering 失败', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $response;
    }
}
```

### 5. 订阅控制器

```php
<?php

namespace App\Http\Controllers;

use App\Http\Requests\SubscribeRequest;
use App\Services\StripeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SubscriptionController extends Controller
{
    public function __construct(
        private StripeService $stripe
    ) {}

    /**
     * 获取可选套餐列表
     */
    public function plans(): JsonResponse
    {
        $plans = config('stripe.plans');

        return response()->json([
            'plans' => $plans,
        ]);
    }

    /**
     * 创建订阅（返回 PaymentIntent 客户端密钥）
     */
    public function subscribe(SubscribeRequest $request): JsonResponse
    {
        $user = $request->user();
        $priceId = $request->input('price_id');

        $subscription = $this->stripe->createSubscription(
            $user,
            $priceId,
            [
                'trial_period_days' => $request->input('trial_days', 14),
                'coupon' => $request->input('coupon'),
            ]
        );

        return response()->json([
            'subscription_id' => $subscription->id,
            'client_secret' => $subscription->latest_invoice->payment_intent->client_secret,
            'status' => $subscription->status,
        ]);
    }

    /**
     * 升降级
     */
    public function changePlan(Request $request): JsonResponse
    {
        $user = $request->user();
        $newPriceId = $request->input('price_id');
        $prorate = $request->boolean('prorate', true);

        $subscription = $this->stripe->changePlan(
            $user,
            $newPriceId,
            $prorate
        );

        return response()->json([
            'status' => $subscription->status,
            'message' => '套餐已变更',
        ]);
    }

    /**
     * 取消订阅
     */
    public function cancel(Request $request): JsonResponse
    {
        $user = $request->user();
        $immediately = $request->boolean('immediately', false);

        $subscription = $this->stripe->cancelSubscription(
            $user,
            $immediately
        );

        return response()->json([
            'status' => $subscription->status,
            'cancel_at_period_end' => $subscription->cancel_at_period_end,
            'message' => $immediately ? '订阅已立即取消' : '订阅将在当前周期结束后取消',
        ]);
    }

    /**
     * 恢复订阅
     */
    public function resume(Request $request): JsonResponse
    {
        $user = $request->user();

        $subscription = $this->stripe->resumeSubscription($user);

        return response()->json([
            'status' => $subscription->status,
            'message' => '订阅已恢复',
        ]);
    }

    /**
     * 上报用量
     */
    public function reportUsage(Request $request): JsonResponse
    {
        $user = $request->user();
        $quantity = $request->input('quantity', 1);
        $description = $request->input('description', '');

        $usageRecord = $this->stripe->reportUsage(
            $user,
            $quantity,
            $description
        );

        return response()->json([
            'usage_record_id' => $usageRecord->id,
            'quantity' => $usageRecord->quantity,
        ]);
    }

    /**
     * 预览下期账单
     */
    public function previewInvoice(Request $request): JsonResponse
    {
        $user = $request->user();

        $invoice = $this->stripe->previewInvoice($user);

        if (!$invoice) {
            return response()->json([
                'message' => '暂无待出账单',
            ]);
        }

        return response()->json([
            'amount_due' => $invoice->amount_due,
            'currency' => $invoice->currency,
            'lines' => collect($invoice->lines->data)->map(fn ($line) => [
                'description' => $line->description,
                'amount' => $line->amount,
                'quantity' => $line->quantity,
            ])->toArray(),
            'period_start' => date('Y-m-d', $invoice->period_start),
            'period_end' => date('Y-m-d', $invoice->period_end),
        ]);
    }

    /**
     * 获取当前订阅状态
     */
    public function current(Request $request): JsonResponse
    {
        $user = $request->user();
        $subscription = $user->activeSubscription;

        if (!$subscription) {
            return response()->json([
                'active' => false,
            ]);
        }

        return response()->json([
            'active' => true,
            'status' => $subscription->status,
            'plan' => $subscription->plan_name,
            'current_period_end' => $subscription->current_period_end,
            'cancel_at_period_end' => $subscription->canceled_at !== null,
        ]);
    }
}
```

### 6. 路由配置

```php
// routes/api.php

Route::middleware('auth:sanctum')->prefix('billing')->group(function () {
    Route::get('/plans', [SubscriptionController::class, 'plans']);
    Route::post('/subscribe', [SubscriptionController::class, 'subscribe']);
    Route::post('/change-plan', [SubscriptionController::class, 'changePlan']);
    Route::post('/cancel', [SubscriptionController::class, 'cancel']);
    Route::post('/resume', [SubscriptionController::class, 'resume']);
    Route::post('/usage', [SubscriptionController::class, 'reportUsage']);
    Route::get('/invoice/preview', [SubscriptionController::class, 'previewInvoice']);
    Route::get('/subscription', [SubscriptionController::class, 'current']);
});

// Webhook 路由（不走认证中间件）
Route::post('/stripe/webhook', [StripeWebhookController::class, 'handleWebhook']);
```

### 7. 发票 PDF 生成（自定义模板）

```php
<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\User;
use Barryvdh\DomPDF\Facade\Pdf;

class InvoicePdfService
{
    /**
     * 生成发票 PDF
     */
    public function generate(Invoice $invoice): string
    {
        $user = User::find($invoice->user_id);

        $pdf = Pdf::loadView('invoices.pdf', [
            'invoice' => $invoice,
            'user' => $user,
            'company' => config('app.company'),
            'items' => $this->formatInvoiceItems($invoice),
        ]);

        $filename = "invoice_{$invoice->stripe_invoice_id}.pdf";
        $path = storage_path("app/invoices/{$filename}");

        // 确保目录存在
        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0755, true);
        }

        $pdf->save($path);

        return $path;
    }

    private function formatInvoiceItems(Invoice $invoice): array
    {
        return [
            [
                'description' => $invoice->plan_name ?? '订阅费用',
                'quantity' => 1,
                'unit_price' => $invoice->amount_paid,
                'total' => $invoice->amount_paid,
            ],
        ];
    }
}
```

## 踩坑记录

### 坑 1：Webhook 事件顺序不确定

**问题**：`invoice.paid` 可能在 `customer.subscription.created` 之前到达。

**解决**：使用幂等性设计，每次处理前先检查本地状态，允许任意顺序到达。

### 坑 2：Metered 计量的时序问题

**问题**：Usage Record 上报后，Stripe 在下个结算周期才会创建 Invoice 包含用量。中间如果订阅被取消，用量可能丢失。

**解决**：在本地维护用量记录，即使 Stripe 未结算也有完整数据；在取消订阅前提醒用户用量尚未结算。

### 坑 3：Proration 计算与实际账单不一致

**问题**：API 返回的 Proration 和实际 Invoice 金额有微小差异（通常 1-2 分）。

**解决**：不要用 Proration 结果作为最终账单金额，以 Invoice.paid 事件中的 amount_paid 为准。

### 坑 4：Webhook 签名验证的 raw body

**问题**：Laravel 默认会解析 JSON body，导致签名验证失败。

**解决**：在 Webhook 路由中使用 `Illuminate\Http\Middleware\TrustProxies` 并确保读取原始 body：

```php
// 方式一：在路由中禁用中间件
Route::post('/stripe/webhook', [StripeWebhookController::class, 'handleWebhook'])
    ->withoutMiddleware(['web']);

// 方式二：在 Kernel 中排除
// 确保 $request->getContent() 返回原始字符串
```

### 坑 5：试用期用户的 Payment Method

**问题**：试用期不要求绑定支付方式，但试用结束转正式时需要，此时容易流失。

**解决**：在订阅创建时使用 `payment_behavior: 'default_incomplete'` + `payment_settings.save_default_payment_method: 'on_subscription'`，即使有试用期也提前收集支付方式。

### 坑 6：Invoice PDF 的中文显示

**问题**：DomPDF 默认不支持中文，生成的发票中文显示为方块。

**解决**：在 DomPDF 配置中添加中文字体：

```php
// config/dompdf.php
'tfont_dir' => resource_path('fonts/'),
'font_data' => [
    'noto-sans-sc' => [
        'uv' => null,
        'cid' => [
            'CAP_HEIGHT' => 700,
            'X_HEIGHT' => 500,
        ],
    ],
],
'default_font' => 'noto-sans-sc',
```

## 总结

Stripe Billing 在 Laravel 中的集成远不止调 API 这么简单。真正困难的是：

1. **Webhook 的可靠性**：幂等处理、事件排序、签名验证
2. **状态同步**：本地数据库与 Stripe 状态的一致性
3. **边界情况**：试用期转正式、支付失败重试、跨周期升降级
4. **用户体验**：预览账单、清晰的订阅管理页面

核心原则是**以 Stripe 为 source of truth，本地数据库为 cache**。Webhook 是唯一的同步机制，必须保证幂等性。订阅状态永远以 Stripe 返回的为准，本地只是缓存和查询优化。

计费引擎没有银弹，但 Stripe Billing + 正确的 Laravel 集成模式，能让你专注在业务逻辑而不是支付基础设施上。
