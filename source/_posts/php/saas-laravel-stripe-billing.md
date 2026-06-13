---
title: 多租户 SaaS 定价模型实战：按量计费、阶梯定价、用量配额——Laravel + Stripe Billing 集成
date: 2026-06-02 08:00:00
tags: [SaaS, 多租户, Stripe, Billing, Laravel, 定价模型]
keywords: [SaaS, Laravel, Stripe Billing, 多租户, 定价模型实战, 按量计费, 阶梯定价, 用量配额, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 多租户 SaaS 定价模型深度实战，系统拆解按量计费、阶梯定价、混合订阅等模型的数据库设计与 Laravel + Stripe Billing 集成方案。涵盖用量计量器实现、配额管理、幂等计费、Rate Limiting 限流、账单对账与税务合规等工程细节，附完整代码示例，帮助 SaaS 团队设计可扩展的商业化定价体系。
---


SaaS 产品的定价模型直接决定了商业模式的天花板。选错了定价模型，要么用户觉得贵了不买，要么你赚不到钱维持不了服务。更棘手的是，定价模型一旦上线，改起来比改数据库 schema 还痛苦——因为你不能突然改变已经付费用户的计费方式。

本文将系统性地拆解 SaaS 定价模型的设计、数据库建模、Stripe Billing 集成、用量配额实现，以及多租户场景下的账单对账。所有代码基于 Laravel + Stripe PHP SDK 的真实项目经验。

<!-- more -->

## SaaS 定价模型分类

### 固定订阅（Flat-Rate Subscription）

最简单的模型：每月固定价格，使用不限量。

```
Basic Plan: $29/月
Pro Plan: $99/月
Enterprise Plan: $299/月
```

**优点**：用户理解成本、收入可预测、实现简单
**缺点**：轻度用户觉得贵、重度用户你亏钱

### 按量计费（Usage-Based Billing）

按实际使用量收费。适合 API 调用、存储、计算资源等场景。

```
API 调用: $0.001/次
存储: $0.10/GB/月
计算: $0.05/vCPU/小时
```

**优点**：公平、用户入门门槛低、与用户价值直接挂钩
**缺点**：收入不可预测、用户难以估算成本

### 阶梯定价（Tiered Pricing）

不同用量区间对应不同单价，类似电费的阶梯计价。

```
0 - 1,000 次:      免费
1,001 - 10,000 次:  $0.002/次
10,001 - 100,000 次: $0.001/次
100,001+ 次:        $0.0005/次
```

**优点**：鼓励用户增长、大客户享受折扣、兼顾公平和规模
**缺点**：计费逻辑复杂、账单难以理解

### 混合模式（Hybrid）

固定订阅 + 超出部分按量计费。这是目前最流行的 SaaS 定价模式。

```
Pro Plan: $99/月（含 10,000 次 API 调用）
超出部分: $0.001/次
```

**优点**：收入有基础保障、用户有明确预期、重度用户额外付费
**缺点**：需要同时管理订阅和用量两条线

## 数据库设计

### 核心表结构

```php
<?php

// database/migrations/2026_01_01_create_billing_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 套餐表
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name');                          // 'Pro Plan'
            $table->string('slug')->unique();                // 'pro'
            $table->string('stripe_price_id')->nullable();   // 'price_1ABC...'
            $table->decimal('monthly_price', 10, 2);         // 99.00
            $table->string('currency', 3)->default('USD');
            $table->json('features')->nullable();            // 功能列表
            $table->json('quotas')->nullable();              // 配额定义
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->timestamps();
        });

        // 租户订阅表
        Schema::create('tenant_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained();
            $table->string('stripe_subscription_id')->nullable()->unique();
            $table->string('stripe_customer_id')->nullable();
            $table->string('status')->default('active');     // active, past_due, canceled, trialing
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_start');
            $table->timestamp('current_period_end');
            $table->timestamp('canceled_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'status']);
        });

        // 用量记录表（核心！）
        Schema::create('usage_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('metric');                         // 'api_calls', 'storage_gb', 'compute_hours'
            $table->unsignedBigInteger('quantity');            // 用量值
            $table->timestamp('recorded_at');
            $table->string('idempotency_key')->unique();      // 幂等键，防止重复记录
            $table->json('metadata')->nullable();             // 扩展信息
            $table->timestamps();

            $table->index(['tenant_id', 'metric', 'recorded_at']);
        });

        // 用量汇总表（用于快速查询）
        Schema::create('usage_summaries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('metric');
            $table->unsignedBigInteger('quantity');
            $table->date('period_start');
            $table->date('period_end');
            $table->string('stripe_usage_record_id')->nullable();
            $table->enum('status', ['pending', 'reported', 'billed'])->default('pending');
            $table->timestamps();

            $table->unique(['tenant_id', 'metric', 'period_start']);
        });

        // 账单表
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('stripe_invoice_id')->nullable()->unique();
            $table->string('invoice_number')->unique();
            $table->string('status')->default('draft');       // draft, open, paid, void
            $table->decimal('subtotal', 12, 2);
            $table->decimal('tax', 12, 2)->default(0);
            $table->decimal('total', 12, 2);
            $table->string('currency', 3)->default('USD');
            $table->json('line_items')->nullable();
            $table->timestamp('due_date')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'status']);
        });

        // 配额使用表
        Schema::create('quota_usage', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('metric');
            $table->unsignedBigInteger('current_usage')->default(0);
            $table->unsignedBigInteger('limit');               // 配额上限
            $table->date('period_start');
            $table->date('period_end');
            $table->timestamps();

            $table->unique(['tenant_id', 'metric', 'period_start']);
        });
    }
};
```

### Eloquent 模型

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Plan extends Model
{
    protected $fillable = [
        'name', 'slug', 'stripe_price_id', 'monthly_price',
        'currency', 'features', 'quotas', 'is_active', 'sort_order',
    ];

    protected $casts = [
        'features' => 'array',
        'quotas' => 'array',
        'monthly_price' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function subscriptions(): HasMany
    {
        return $this->hasMany(TenantSubscription::class);
    }

    /**
     * 获取某个指标的配额
     */
    public function getQuota(string $metric): ?int
    {
        return $this->quotas[$metric] ?? null;
    }
}

class TenantSubscription extends Model
{
    protected $fillable = [
        'tenant_id', 'plan_id', 'stripe_subscription_id',
        'stripe_customer_id', 'status', 'trial_ends_at',
        'current_period_start', 'current_period_end', 'canceled_at',
    ];

    protected $casts = [
        'trial_ends_at' => 'datetime',
        'current_period_start' => 'datetime',
        'current_period_end' => 'datetime',
        'canceled_at' => 'datetime',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function isActive(): bool
    {
        return in_array($this->status, ['active', 'trialing']);
    }
}
```

## Stripe Billing 集成

### 创建 Stripe Customer 和 Subscription

```php
<?php

namespace App\Services\Billing;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\TenantSubscription;
use Illuminate\Support\Facades\DB;
use Stripe\Stripe;
use Stripe\Customer;
use Stripe\Subscription;
use Stripe\Exception\ApiErrorException;

class StripeBillingService
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    /**
     * 为租户创建 Stripe Customer
     */
    public function createCustomer(Tenant $tenant): string
    {
        $customer = Customer::create([
            'email' => $tenant->owner_email,
            'name' => $tenant->name,
            'metadata' => [
                'tenant_id' => $tenant->id,
                'company' => $tenant->company_name,
            ],
        ]);

        $tenant->update(['stripe_customer_id' => $customer->id]);

        return $customer->id;
    }

    /**
     * 创建订阅（固定订阅 + 按量计费）
     */
    public function createSubscription(
        Tenant $tenant,
        Plan $plan,
        ?string $paymentMethodId = null,
        int $trialDays = 0
    ): TenantSubscription {
        return DB::transaction(function () use ($tenant, $plan, $paymentMethodId, $trialDays) {
            // 确保有 Stripe Customer
            $customerId = $tenant->stripe_customer_id
                ?? $this->createCustomer($tenant);

            // 附加支付方式
            if ($paymentMethodId) {
                Customer::update($customerId, [
                    'invoice_settings' => [
                        'default_payment_method' => $paymentMethodId,
                    ],
                ]);
            }

            // 构建订阅项目
            $items = [
                ['price' => $plan->stripe_price_id],  // 基础订阅
            ];

            // 如果有按量计费指标，添加 metered item
            $meteredPriceId = $this->getMeteredPriceId($plan);
            if ($meteredPriceId) {
                $items[] = [
                    'price' => $meteredPriceId,
                ];
            }

            // 创建 Stripe Subscription
            $subscriptionData = [
                'customer' => $customerId,
                'items' => $items,
                'payment_behavior' => 'default_incomplete',
                'expand' => ['latest_invoice.payment_intent'],
                'metadata' => [
                    'tenant_id' => $tenant->id,
                    'plan_id' => $plan->id,
                ],
            ];

            if ($trialDays > 0) {
                $subscriptionData['trial_period_days'] = $trialDays;
            }

            $stripeSubscription = Subscription::create($subscriptionData);

            // 保存到本地
            $subscription = TenantSubscription::create([
                'tenant_id' => $tenant->id,
                'plan_id' => $plan->id,
                'stripe_subscription_id' => $stripeSubscription->id,
                'stripe_customer_id' => $customerId,
                'status' => $stripeSubscription->status,
                'trial_ends_at' => $stripeSubscription->trial_end
                    ? \Carbon\Carbon::createFromTimestamp($stripeSubscription->trial_end)
                    : null,
                'current_period_start' => \Carbon\Carbon::createFromTimestamp(
                    $stripeSubscription->current_period_start
                ),
                'current_period_end' => \Carbon\Carbon::createFromTimestamp(
                    $stripeSubscription->current_period_end
                ),
            ]);

            // 初始化配额
            $this->initializeQuotas($tenant, $plan);

            return $subscription;
        });
    }

    /**
     * 报告用量到 Stripe
     */
    public function reportUsage(
        Tenant $tenant,
        string $metric,
        int $quantity
    ): void {
        $subscription = $tenant->activeSubscription;
        if (!$subscription || !$subscription->isActive()) {
            return;
        }

        // 获取 metered subscription item
        $stripeSubscription = Subscription::retrieve(
            $subscription->stripe_subscription_id
        );

        $meteredItem = collect($stripeSubscription->items->data)
            ->first(fn($item) => $item->price->recurring->usage_type === 'metered');

        if (!$meteredItem) {
            return;
        }

        // 创建 usage record
        \Stripe\SubscriptionItem::createUsageRecord(
            $meteredItem->id,
            [
                'quantity' => $quantity,
                'timestamp' => time(),
                'action' => 'increment',
            ]
        );

        // 本地记录
        \App\Models\UsageRecord::create([
            'tenant_id' => $tenant->id,
            'metric' => $metric,
            'quantity' => $quantity,
            'recorded_at' => now(),
            'idempotency_key' => "{$tenant->id}:{$metric}:" . now()->format('Y-m-d:H:i'),
        ]);
    }

    /**
     * 升级/降级套餐
     */
    public function changePlan(
        Tenant $tenant,
        Plan $newPlan,
        string $prorationBehavior = 'always_invoice'
    ): TenantSubscription {
        $subscription = $tenant->activeSubscription;

        $stripeSubscription = Subscription::retrieve(
            $subscription->stripe_subscription_id
        );

        // 更新 Stripe Subscription
        $stripeSubscription->update([
            'items' => [
                [
                    'id' => $stripeSubscription->items->data[0]->id,
                    'price' => $newPlan->stripe_price_id,
                ],
            ],
            'proration_behavior' => $prorationBehavior,
        ]);

        // 更新本地记录
        $subscription->update([
            'plan_id' => $newPlan->id,
        ]);

        // 更新配额
        $this->updateQuotas($tenant, $newPlan);

        return $subscription;
    }

    /**
     * 取消订阅
     */
    public function cancelSubscription(Tenant $tenant, bool $immediately = false): void
    {
        $subscription = $tenant->activeSubscription;

        if ($immediately) {
            $stripeSubscription = Subscription::retrieve(
                $subscription->stripe_subscription_id
            );
            $stripeSubscription->cancel();
        } else {
            // 在当前周期结束时取消
            Subscription::update(
                $subscription->stripe_subscription_id,
                ['cancel_at_period_end' => true]
            );
        }

        $subscription->update([
            'status' => $immediately ? 'canceled' : 'active',
            'canceled_at' => now(),
        ]);
    }

    private function getMeteredPriceId(Plan $plan): ?string
    {
        // 从配置中获取 metered price ID
        return config("billing.metered_prices.{$plan->slug}");
    }

    private function initializeQuotas(Tenant $tenant, Plan $plan): void
    {
        $quotas = $plan->quotas ?? [];
        $periodStart = now()->startOfMonth();
        $periodEnd = now()->endOfMonth();

        foreach ($quotas as $metric => $limit) {
            \App\Models\QuotaUsage::create([
                'tenant_id' => $tenant->id,
                'metric' => $metric,
                'limit' => $limit,
                'period_start' => $periodStart,
                'period_end' => $periodEnd,
            ]);
        }
    }

    private function updateQuotas(Tenant $tenant, Plan $newPlan): void
    {
        $quotas = $newPlan->quotas ?? [];

        foreach ($quotas as $metric => $limit) {
            \App\Models\QuotaUsage::updateOrCreate(
                [
                    'tenant_id' => $tenant->id,
                    'metric' => $metric,
                    'period_start' => now()->startOfMonth(),
                ],
                ['limit' => $limit]
            );
        }
    }
}
```

### Webhook 处理

```php
<?php

namespace App\Http\Controllers\Webhooks;

use App\Models\TenantSubscription;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Stripe\Webhook;
use Stripe\Exception\SignatureVerificationException;

class StripeWebhookController
{
    public function handle(Request $request)
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');

        try {
            $event = Webhook::constructEvent(
                $payload,
                $sigHeader,
                config('services.stripe.webhook_secret')
            );
        } catch (SignatureVerificationException $e) {
            Log::error('Stripe webhook signature verification failed', [
                'error' => $e->getMessage(),
            ]);
            return response('Invalid signature', 400);
        }

        Log::info('Stripe webhook received', [
            'type' => $event->type,
            'id' => $event->id,
        ]);

        return match ($event->type) {
            'invoice.paid' => $this->handleInvoicePaid($event->data->object),
            'invoice.payment_failed' => $this->handleInvoicePaymentFailed($event->data->object),
            'customer.subscription.updated' => $this->handleSubscriptionUpdated($event->data->object),
            'customer.subscription.deleted' => $this->handleSubscriptionDeleted($event->data->object),
            'customer.subscription.trial_will_end' => $this->handleTrialWillEnd($event->data->object),
            default => response('Unhandled event', 200);
        };
    }

    private function handleInvoicePaid($invoice): \Illuminate\Http\Response
    {
        $subscription = TenantSubscription::where(
            'stripe_subscription_id',
            $invoice->subscription
        )->first();

        if (!$subscription) {
            Log::warning('Invoice paid for unknown subscription', [
                'invoice_id' => $invoice->id,
            ]);
            return response('OK', 200);
        }

        // 更新本地账单状态
        Invoice::where('stripe_invoice_id', $invoice->id)->update([
            'status' => 'paid',
            'paid_at' => now(),
        ]);

        // 确保订阅状态为 active
        $subscription->update(['status' => 'active']);

        // 重置配额（新周期开始）
        $this->resetQuotas($subscription->tenant_id);

        return response('OK', 200);
    }

    private function handleInvoicePaymentFailed($invoice): \Illuminate\Http\Response
    {
        $subscription = TenantSubscription::where(
            'stripe_subscription_id',
            $invoice->subscription
        )->first();

        if ($subscription) {
            $subscription->update(['status' => 'past_due']);

            // 发送通知给租户
            $subscription->tenant->notify(
                new \App\Notifications\PaymentFailedNotification($invoice)
            );
        }

        return response('OK', 200);
    }

    private function handleSubscriptionUpdated($stripeSubscription): \Illuminate\Http\Response
    {
        $subscription = TenantSubscription::where(
            'stripe_subscription_id',
            $stripeSubscription->id
        )->first();

        if ($subscription) {
            $subscription->update([
                'status' => $stripeSubscription->status,
                'current_period_start' => \Carbon\Carbon::createFromTimestamp(
                    $stripeSubscription->current_period_start
                ),
                'current_period_end' => \Carbon\Carbon::createFromTimestamp(
                    $stripeSubscription->current_period_end
                ),
            ]);
        }

        return response('OK', 200);
    }

    private function handleSubscriptionDeleted($stripeSubscription): \Illuminate\Http\Response
    {
        TenantSubscription::where(
            'stripe_subscription_id',
            $stripeSubscription->id
        )->update([
            'status' => 'canceled',
            'canceled_at' => now(),
        ]);

        return response('OK', 200);
    }

    private function handleTrialWillEnd($stripeSubscription): \Illuminate\Http\Response
    {
        $subscription = TenantSubscription::where(
            'stripe_subscription_id',
            $stripeSubscription->id
        )->first();

        if ($subscription) {
            // 通知用户试用即将结束
            $subscription->tenant->notify(
                new \App\Notifications\TrialEndingNotification(
                    $subscription->trial_ends_at
                )
            );
        }

        return response('OK', 200);
    }

    private function resetQuotas(int $tenantId): void
    {
        \App\Models\QuotaUsage::where('tenant_id', $tenantId)
            ->where('period_start', now()->startOfMonth())
            ->update(['current_usage' => 0]);
    }
}
```

## 用量配额与限流

### 中间件配额检查

```php
<?php

namespace App\Middleware;

use App\Models\QuotaUsage;
use App\Services\Usage\UsageTracker;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckQuota
{
    public function __construct(
        private UsageTracker $usageTracker
    ) {}

    public function handle(Request $request, Closure $next, string $metric): Response
    {
        $tenant = $request->user()->tenant;

        // 检查配额
        $quota = QuotaUsage::where('tenant_id', $tenant->id)
            ->where('metric', $metric)
            ->where('period_start', '<=', now())
            ->where('period_end', '>=', now())
            ->first();

        if (!$quota) {
            // 没有配额记录，可能还没订阅
            return response()->json([
                'error' => 'no_subscription',
                'message' => '请先订阅套餐以使用此功能',
            ], 403);
        }

        if ($quota->current_usage >= $quota->limit) {
            // 配额用完
            return response()->json([
                'error' => 'quota_exceeded',
                'message' => "{$metric} 配额已用完",
                'current_usage' => $quota->current_usage,
                'limit' => $quota->limit,
                'reset_at' => $quota->period_end->toISOString(),
                'upgrade_url' => '/billing/upgrade',
            ], 429);
        }

        // 检查是否接近配额上限（80%）
        $usagePercent = $quota->current_usage / $quota->limit;
        if ($usagePercent >= 0.8) {
            // 在响应头中添加警告
            $response = $next($request);
            $response->headers->set('X-Quota-Warning', 'Approaching quota limit');
            $response->headers->set('X-Quota-Usage', (string) $quota->current_usage);
            $response->headers->set('X-Quota-Limit', (string) $quota->limit);

            return $response;
        }

        $response = $next($request);

        // 请求成功后记录用量
        if ($response->isSuccessful()) {
            $this->usageTracker->track($tenant, $metric, 1);
        }

        return $response;
    }
}
```

### 用量追踪服务

```php
<?php

namespace App\Services\Usage;

use App\Models\Tenant;
use App\Models\QuotaUsage;
use App\Models\UsageRecord;
use App\Services\Billing\StripeBillingService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class UsageTracker
{
    public function __construct(
        private StripeBillingService $billingService
    ) {}

    /**
     * 追踪用量（带批量缓冲）
     */
    public function track(Tenant $tenant, string $metric, int $quantity = 1): void
    {
        // 更新本地配额
        $quota = QuotaUsage::where('tenant_id', $tenant->id)
            ->where('metric', $metric)
            ->where('period_start', '<=', now())
            ->where('period_end', '>=', now())
            ->first();

        if ($quota) {
            $quota->increment('current_usage', $quantity);
        }

        // 缓冲 Stripe 上报（每 5 分钟批量上报一次）
        $cacheKey = "usage_buffer:{$tenant->id}:{$metric}";
        Cache::increment($cacheKey, $quantity);

        // 设置 TTL，确保最终会触发上报
        if (!Cache::has("{$cacheKey}:scheduled")) {
            Cache::put("{$cacheKey}:scheduled", true, now()->addMinutes(5));

            // 调度批量上报
            dispatch(function () use ($tenant, $metric, $cacheKey) {
                $bufferedQuantity = (int) Cache::pull($cacheKey, 0);
                if ($bufferedQuantity > 0) {
                    $this->billingService->reportUsage($tenant, $metric, $bufferedQuantity);
                }
                Cache::forget("{$cacheKey}:scheduled");
            })->delay(now()->addMinutes(5));
        }
    }

    /**
     * 获取当前周期的用量
     */
    public function getCurrentUsage(Tenant $tenant, string $metric): array
    {
        $quota = QuotaUsage::where('tenant_id', $tenant->id)
            ->where('metric', $metric)
            ->where('period_start', '<=', now())
            ->where('period_end', '>=', now())
            ->first();

        if (!$quota) {
            return ['usage' => 0, 'limit' => 0, 'remaining' => 0, 'percent' => 0];
        }

        return [
            'usage' => $quota->current_usage,
            'limit' => $quota->limit,
            'remaining' => max(0, $quota->limit - $quota->current_usage),
            'percent' => $quota->limit > 0
                ? round($quota->current_usage / $quota->limit * 100, 2)
                : 0,
        ];
    }

    /**
     * 检查是否有足够配额
     */
    public function hasQuota(Tenant $tenant, string $metric, int $required = 1): bool
    {
        $usage = $this->getCurrentUsage($tenant, $metric);
        return $usage['remaining'] >= $required;
    }
}
```

### API Rate Limiting

```php
<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class RateLimitServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RateLimiter::for('api', function (Request $request) {
            $tenant = $request->user()?->tenant;

            if (!$tenant || !$tenant->activeSubscription) {
                // 未订阅用户：严格限流
                return Limit::perMinute(10)->by(
                    $request->user()?->id ?: $request->ip()
                );
            }

            // 根据套餐调整限流
            $plan = $tenant->activeSubscription->plan;

            $rateLimits = [
                'free' => Limit::perMinute(60),
                'basic' => Limit::perMinute(300),
                'pro' => Limit::perMinute(1000),
                'enterprise' => Limit::perMinute(5000),
            ];

            $limit = $rateLimits[$plan->slug]
                ?? Limit::perMinute(100);

            return $limit->by("tenant:{$tenant->id}")
                ->response(function () {
                    return response()->json([
                        'error' => 'rate_limit_exceeded',
                        'message' => 'API 调用频率超限，请稍后重试',
                    ], 429);
                });
        });
    }
}
```

## 阶梯定价实现

```php
<?php

namespace App\Services\Billing;

class TieredPricingCalculator
{
    /**
     * 阶梯定价定义
     */
    private array $tiers = [
        ['min' => 0, 'max' => 1000, 'price' => 0],          // 免费
        ['min' => 1001, 'max' => 10000, 'price' => 0.002],   // $0.002/次
        ['min' => 10001, 'max' => 100000, 'price' => 0.001], // $0.001/次
        ['min' => 100001, 'max' => null, 'price' => 0.0005], // $0.0005/次
    ];

    /**
     * 计算阶梯定价的费用
     */
    public function calculate(int $quantity): array
    {
        $totalCost = 0;
        $lineItems = [];
        $remaining = $quantity;

        foreach ($this->tiers as $tier) {
            if ($remaining <= 0) break;

            $tierMin = $tier['min'];
            $tierMax = $tier['max'] ?? PHP_INT_MAX;
            $tierCapacity = $tierMax - $tierMin + 1;

            $quantityInTier = min($remaining, $tierCapacity);
            $cost = $quantityInTier * $tier['price'];

            if ($quantityInTier > 0) {
                $lineItems[] = [
                    'tier' => "{$tierMin} - " . ($tier['max'] ?? '∞'),
                    'quantity' => $quantityInTier,
                    'unit_price' => $tier['price'],
                    'cost' => round($cost, 4),
                ];
            }

            $totalCost += $cost;
            $remaining -= $quantityInTier;
        }

        return [
            'total_quantity' => $quantity,
            'total_cost' => round($totalCost, 2),
            'line_items' => $lineItems,
        ];
    }

    /**
     * 预估费用（用于定价页面展示）
     */
    public function estimate(int $quantity): float
    {
        return $this->calculate($quantity)['total_cost'];
    }
}
```

## 账单对账

```php
<?php

namespace App\Services\Billing;

use App\Models\Tenant;
use App\Models\Invoice;
use Illuminate\Support\Facades\Log;
use Stripe\Stripe;
use Stripe\Invoice as StripeInvoice;

class InvoiceReconciliationService
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    /**
     * 同步 Stripe 账单到本地
     */
    public function syncInvoices(Tenant $tenant): array
    {
        $customerId = $tenant->stripe_customer_id;
        $synced = [];
        $errors = [];

        // 获取 Stripe 的账单列表
        $stripeInvoices = StripeInvoice::all([
            'customer' => $customerId,
            'limit' => 100,
        ]);

        foreach ($stripeInvoices->autoPagingIterator() as $stripeInvoice) {
            try {
                $localInvoice = Invoice::updateOrCreate(
                    ['stripe_invoice_id' => $stripeInvoice->id],
                    [
                        'tenant_id' => $tenant->id,
                        'invoice_number' => $stripeInvoice->number,
                        'status' => $stripeInvoice->status,
                        'subtotal' => $stripeInvoice->subtotal / 100,  // 分转元
                        'tax' => ($stripeInvoice->tax ?? 0) / 100,
                        'total' => $stripeInvoice->total / 100,
                        'currency' => strtoupper($stripeInvoice->currency),
                        'line_items' => $this->extractLineItems($stripeInvoice),
                        'due_date' => $stripeInvoice->due_date
                            ? \Carbon\Carbon::createFromTimestamp($stripeInvoice->due_date)
                            : null,
                        'paid_at' => $stripeInvoice->status_transitions->paid_at
                            ? \Carbon\Carbon::createFromTimestamp(
                                $stripeInvoice->status_transitions->paid_at
                            )
                            : null,
                    ]
                );

                $synced[] = $localInvoice->invoice_number;
            } catch (\Exception $e) {
                Log::error('Invoice sync failed', [
                    'tenant_id' => $tenant->id,
                    'stripe_invoice_id' => $stripeInvoice->id,
                    'error' => $e->getMessage(),
                ]);
                $errors[] = [
                    'stripe_invoice_id' => $stripeInvoice->id,
                    'error' => $e->getMessage(),
                ];
            }
        }

        return [
            'synced_count' => count($synced),
            'error_count' => count($errors),
            'synced' => $synced,
            'errors' => $errors,
        ];
    }

    /**
     * 对账：检查本地和 Stripe 的金额是否一致
     */
    public function reconcile(Tenant $tenant): array
    {
        $discrepancies = [];

        $localInvoices = Invoice::where('tenant_id', $tenant->id)
            ->where('status', 'paid')
            ->where('paid_at', '>=', now()->subDays(90))
            ->get();

        foreach ($localInvoices as $local) {
            if (!$local->stripe_invoice_id) continue;

            try {
                $stripe = StripeInvoice::retrieve($local->stripe_invoice_id);

                $stripeTotal = $stripe->total / 100;
                if (abs($local->total - $stripeTotal) > 0.01) {
                    $discrepancies[] = [
                        'invoice_number' => $local->invoice_number,
                        'local_total' => $local->total,
                        'stripe_total' => $stripeTotal,
                        'difference' => round($local->total - $stripeTotal, 2),
                    ];
                }
            } catch (\Exception $e) {
                $discrepancies[] = [
                    'invoice_number' => $local->invoice_number,
                    'error' => "Failed to retrieve from Stripe: {$e->getMessage()}",
                ];
            }
        }

        return [
            'tenant_id' => $tenant->id,
            'invoices_checked' => $localInvoices->count(),
            'discrepancies' => $discrepancies,
            'is_consistent' => empty($discrepancies),
        ];
    }

    private function extractLineItems(StripeInvoice $invoice): array
    {
        $items = [];

        foreach ($invoice->lines->data as $line) {
            $items[] = [
                'description' => $line->description,
                'quantity' => $line->quantity,
                'unit_amount' => $line->price->unit_amount / 100,
                'amount' => $line->amount / 100,
                'period_start' => \Carbon\Carbon::createFromTimestamp($line->period->start),
                'period_end' => \Carbon\Carbon::createFromTimestamp($line->period->end),
            ];
        }

        return $items;
    }
}
```

## 税务与多币种

### Stripe Tax 集成

```php
<?php

namespace App\Services\Billing;

use Stripe\Stripe;
use Stripe\Tax\Calculation;

class TaxService
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    /**
     * 计算税额
     */
    public function calculateTax(
        string $customerId,
        string $lineDescription,
        int $amountCents,
        string $currency = 'usd'
    ): array {
        $calculation = Calculation::create([
            'currency' => $currency,
            'customer' => $customerId,
            'line_items' => [
                [
                    'amount' => $amountCents,
                    'reference' => $lineDescription,
                    'tax_behavior' => 'exclusive',
                ],
            ],
        ]);

        return [
            'tax_amount' => $calculation->tax_amount_exclusive / 100,
            'total_amount' => $calculation->amount_total / 100,
            'tax_rate' => $calculation->tax_breakdown[0]->tax_rate_details->percentage ?? 0,
            'tax_jurisdiction' => $calculation->tax_breakdown[0]->tax_rate_details->jurisdiction ?? '',
        ];
    }
}
```

## 最佳实践总结

1. **定价模型选择**：混合模式（固定订阅 + 按量计费）是大多数 SaaS 的最佳选择
2. **幂等性**：所有用量记录必须有幂等键，防止网络重试导致的重复计费
3. **批量上报**：不要每次 API 调用都上报 Stripe，使用缓冲批量上报降低成本
4. **配额前置检查**：在业务逻辑执行前检查配额，避免做了一堆计算才发现没额度
5. **Webhook 可靠性**：Stripe Webhook 必须幂等处理，同一事件可能被多次发送
6. **对账自动化**：定期自动对账，发现金额差异及时告警
7. **灰度发布**：定价模型变更时，先对新用户生效，确认无误后再迁移老用户
8. **用户透明**：在用户 Dashboard 实时展示用量和配额，避免账单惊吓

## 结语

SaaS 定价看似是产品和商业问题，但实际上它是一个深度的技术问题。从数据库设计到 Stripe 集成，从用量配额到 Rate Limiting，从账单对账到税务合规，每一个环节都需要工程化的解决方案。

Laravel + Stripe Billing 的组合提供了成熟的基础设施。关键在于：设计合理的数据模型、保证计费的准确性（幂等性 + 对账）、让用户对费用有清晰的预期。当定价模型成为产品的核心竞争力时，它值得你投入与核心业务逻辑同等的工程关注。

## 相关阅读

- [Laravel Sanctum 实战：SPA/API 令牌认证与移动端适配](/categories/Laravel/PHP/Laravel-Sanctum-实战-SPA-API-令牌认证与移动端适配/)
- [API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践](/categories/Laravel/PHP/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [敏感数据保护实战：加密存储、脱敏展示、审计日志合规](/categories/Laravel/PHP/敏感数据保护实战-加密存储脱敏展示审计日志合规-Laravel-B2C-API踩坑记录/)
- [Laravel 加密架构实战：应用层加密 vs 数据库透明加密（TDE）](/categories/Laravel/PHP/2026-06-02-laravel-encryption-architecture-tde-compliance/)
