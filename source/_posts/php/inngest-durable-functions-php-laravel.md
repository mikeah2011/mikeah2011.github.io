---

title: Inngest 实战：Durable Functions for PHP——Laravel 中的持久化工作流、步骤重试与长时间运行任务编排
keywords: [Inngest, Durable Functions for PHP, Laravel, 中的持久化工作流, 步骤重试与长时间运行任务编排]
date: 2026-06-04 10:00:00
tags:
- Inngest
- durable-functions
- Laravel
- 工作流
- 任务编排
- PHP
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: Inngest 是基于事件驱动的 Durable Functions 平台，现正式支持 PHP/Laravel。本文深入实战 Inngest 在 Laravel 中的持久化工作流编排：涵盖步骤级自动重试、step.sleep/step.waitForEvent 原生等待、事件驱动函数解耦、多步骤复杂工作流的声明式编写，以及与 Laravel Queue 的对比选型。告别在 Job 中手动管理状态机和重试逻辑的痛苦，用线性代码描述非线性异步流程，适合需要处理跨天任务、条件分支、外部事件等待等场景的 Laravel 开发者。
---




## 前言

在现代 Web 应用开发中，一个反复出现的矛盾是：HTTP 请求的生命周期是短暂的，但业务流程往往是长时间、多步骤、且需要容错能力的。从用户注册后的多步引导，到跨系统的支付对账，再到需要协调多个服务的数据迁移，这些场景都超出了传统请求-响应模型的能力范围。

Laravel Queue 是我们最熟悉的异步任务方案。但面对跨越数天、包含条件分支、需要等待外部事件、且每一步都可能失败的复杂工作流时，我们不得不用数据库手动追踪状态、在 Job 中嵌套大量重试和错误处理逻辑——代码迅速变得难以维护。

**Inngest** 正是为了解决这一问题而生。它是一个基于事件驱动的 Durable Functions 平台，让开发者用线性的、声明式的代码编写复杂的异步工作流，平台自动处理持久化、重试、等待和故障恢复。如今 Inngest 正式支持了 PHP/Laravel，为 PHP 开发者带来了与 AWS Step Functions 同等级别的持久化工作流能力。

<!-- more -->

---

## 一、核心概念：什么是 Durable Functions

### 1.1 传统队列的局限性

先回顾 Laravel 中处理复杂异步任务的两种常见方案：

```php
// 方案一：链式 Jobs——维护噩梦
class StepOneJob implements ShouldQueue {
    public function handle() {
        // 业务逻辑...
        StepTwoJob::dispatch($this->data); // 失败了怎么办？如何回滚？
    }
}

// 方案二：状态机 + 数据库——代码膨胀
class OrderWorkflowJob implements ShouldQueue {
    public function handle() {
        $order = Order::find($this->orderId);
        switch ($order->workflow_state) {
            case 'pending': $this->processPayment($order); break;
            case 'paid': $this->reserveInventory($order); break;
            // ... 无限膨胀的 switch-case
        }
    }
}
```

两种方案的共同问题：步骤之间没有关联，状态管理分散，失败恢复逻辑需要手动编写。

### 1.2 Durable Functions 的核心思想

**将复杂的、长时间运行的工作流表达为一个线性的、同步风格的函数，由平台负责持久化执行状态、自动重试和故障恢复。**

传统队列像是**寄一封信**——投进邮箱，要么送达要么退回。Durable Functions 像是**快递追踪**——你知道包裹在每个中转站的状态，任何环节出问题都能精准定位和恢复。

| 特性 | Laravel Workflow | AWS Step Functions | Temporal | Inngest |
|------|-----------------|-------------------|----------|---------|
| **PHP 支持** | ✅ 原生 Laravel | ❌ 无官方 SDK | ⚠️ 社区 SDK 不成熟 | ✅ 官方 Laravel SDK |
| **编程模型** | 编程式 PHP 类 | 声明式 JSON (ASL) | 编程式 (Go/Java/TS) | 编程式 PHP 函数 |
| **学习曲线** | 低 | 中 | 高 | 低 |
| **步骤级重试** | ❌ Job 级重试 | ✅ | ✅ | ✅ |
| **sleep 等待** | 有限 | ✅ | ✅ | ✅ |
| **外部事件等待** | ❌ | ✅ (Callback Task) | ✅ (Signal) | ✅ `waitForEvent` |
| **定价** | 免费 (自托管) | 按状态转换计费 | 开源免费 / Cloud 按计费 | 免费额度 + 按运行计费 |
| **语言支持** | PHP only | 任意 (Lambda) | Go, Java, PHP, TS, Python | PHP, TS, Python, Go, Rust |
| **可视化** | ❌ 无内置 | ✅ Workflow Studio | ✅ Web UI | ✅ Dashboard |
| **运行方式** | Laravel Queue Worker | 全托管 Serverless | 自托管 / Cloud | Serverless + Webhook |
| **适用场景** | Laravel 简单工作流 | AWS 生态编排 | 企业级高吞吐 | 中小型团队快速上手 |

**选型建议：** 如果团队纯 PHP 栈且需求是中等复杂度工作流，Inngest 和 Laravel Workflow 都是好选择——前者功能更强大（事件等待、步骤级重试），后者零依赖。深度 AWS 用户选 Step Functions，需要极致可靠性和自托管能力选 Temporal。

---

## 二、Inngest 架构与重放机制

Inngest 围绕三个核心概念构建：

- **Event（事件）**：结构化 JSON 数据，包含 `name`（如 `user/signup`）和 `data`（载荷）
- **Function（函数）**：业务逻辑容器，声明监听哪种事件
- **Step（步骤）**：函数内部的工作单元，结果自动持久化

### 重放机制——理解 Inngest 的关键

Inngest 不是在你的服务器上运行代码，而是在服务器上"重放"代码。当函数执行到 `step.run()` 时，SDK 将结果发送回 Inngest 平台存储。继续执行时，Inngest 发起新的 HTTP 请求，SDK 通过检查已存储的步骤结果来"快进"已完成的步骤：

```
第 1 次 HTTP 调用：
  步骤 1: run(createOrder)    → 执行 → 结果存入 Inngest
  步骤 2: run(processPayment) → 执行 → 结果存入 Inngest
  返回 206（还有步骤待执行）

第 2 次 HTTP 调用：
  步骤 1-2: 命中缓存 → 跳过
  步骤 3: run(reserveStock) → 执行
  sleep("7d") → 记录唤醒时间，暂停

7 天后第 3 次 HTTP 调用：
  步骤 1-3: 命中缓存 → 跳过
  步骤 4: run(sendReviewRequest) → 执行
  返回 200（函数完成）
```

即使进程重启、服务器宕机，工作流也不会丢失——所有状态都持久化在 Inngest 平台中。

---

## 三、Laravel 集成实战

### 3.1 安装配置

```bash
composer require inngest/inngest-laravel
php artisan vendor:publish --provider="Inngest\Laravel\InngestServiceProvider"
```

`.env` 配置：

```env
INNGEST_EVENT_KEY=evt_xxxxxxxxxxxx
INNGEST_SIGNING_KEY=signkey-prod-xxxxxxxxxxxx
```

注册端点：

```php
use Inngest\Laravel\InngestController;

Route::post('/inngest', [InngestController::class, 'handle'])
    ->name('inngest.handle')
    ->middleware(['api', 'throttle:100,1']);
```

### 3.2 定义第一个函数

```php
<?php
namespace App\Inngest;

use Illuminate\Support\Facades\Mail;
use Inngest\InngestFunction;
use Inngest\Step;

class SendWelcomeEmail extends InngestFunction
{
    protected string $id = 'app-send-welcome-email';
    protected array $triggers = [['event' => 'user/signup']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $userId = $event['data']['user_id'];
        $user = $step->run('load-user', fn() => User::findOrFail($userId)->toArray());
        $step->run('send-welcome', fn() => Mail::to($user['email'])->send(new WelcomeEmail($user)));
        $step->sleep('wait-3-days', '3 days');
        $step->run('send-followup', fn() => Mail::to($user['email'])->send(new FollowupEmail($user)));
    }
}
```

### 3.3 发送事件与本地开发

```php
use Inngest\Laravel\Facades\Inngest;

Inngest::send(['name' => 'user/signup', 'data' => ['user_id' => $user->id]]);
```

本地开发时启动 Inngest Dev Server：

```bash
php artisan serve       # 终端 1
npx inngest-cli@latest dev  # 终端 2，Dashboard 在 http://localhost:8288
```

---

## 四、Step Functions 深度实战

### 4.1 step.run()——原子步骤

```php
$customer = $step->run('fetch-customer', fn() => Customer::findOrFail($customerId)->toArray());
$invoice = $step->run('create-invoice', fn() => Invoice::create(['customer_id' => $customer['id']])->toArray());
$step->run('send-invoice', fn() => Mail::to($customer['email'])->send(new InvoiceEmail($invoice)));
```

每个 `step.run` 结果被持久化，步骤名称必须唯一，异常触发自动重试。

### 4.2 step.sleep()——持久化等待

```php
$step->sleep('wait', '3 days');          // 人类可读
$step->sleep('wait', 'P3DT12H');         // ISO 8601
$step->sleep('wait', now()->addDays(7)); // 精确时间戳
```

`sleep()` 不阻塞 Worker 进程。Inngest 记录唤醒时间后释放连接，到时间再重新调用。

### 4.3 step.waitForEvent()——等待外部事件

```php
$orderId = $event['data']['order_id'];
$step->run('reserve-inventory', fn() => Inventory::reserve($orderId));

$payment = $step->waitForEvent('wait-for-payment', 'payment/completed',
    new \Inngest\WaitForEventOptions(
        match: "async.data.order_id == '{$orderId}'",
        timeout: '30 minutes',
    ),
);

if ($payment === null) {
    $step->run('release-inventory', fn() => Inventory::release($orderId));
    return;
}
$step->run('confirm-order', fn() => Order::find($orderId)->update(['status' => 'confirmed']));
```

### 4.4 步骤级重试策略

```php
class ProcessPayment extends InngestFunction
{
    protected string $id = 'app-process-payment';
    protected array $triggers = [['event' => 'order/payment-requested']];

    public function retries(): ?array
    {
        return [
            'maxAttempts' => 5,
            'intervals' => ['10 seconds', '1 minute', '5 minutes', '30 minutes', '2 hours'],
        ];
    }

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $step->run('charge-gateway', function () use ($event) {
            $card = PaymentCard::find($event['data']['card_id']);
            if ($card->is_expired) {
                throw new \Inngest\Exceptions\NonRetryableError('Card expired');
            }
            return PaymentGateway::charge($card);
        });
    }
}
```

普通异常自动重试，`NonRetryableError` 跳过重试（用于业务逻辑错误如余额不足、卡片过期）。

### 4.5 条件分支与动态工作流

Inngest 函数就是普通 PHP 代码，`if/else`、`switch`、循环等控制流天然可用，无需声明式 DSL：

```php
class SubscriptionRenewal extends InngestFunction
{
    protected string $id = 'app-subscription-renewal';
    protected array $triggers = [['event' => 'subscription/renewal-due']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $subId = $event['data']['subscription_id'];
        $sub = $step->run('load-sub', fn() => Subscription::findOrFail($subId)->toArray());

        // 条件分支：根据订阅类型走不同逻辑
        $result = $step->run('charge', function () use ($sub) {
            return match ($sub['billing_provider']) {
                'stripe'  => StripeService::charge($sub['stripe_id'], $sub['amount']),
                'paypal'  => PayPalService::charge($sub['paypal_id'], $sub['amount']),
                default   => throw new NonRetryableError("Unknown provider: {$sub['billing_provider']}"),
            };
        });

        if (!$result['success']) {
            // 支付失败 → 进入催付流程
            $step->run('send-dunning', fn() => Mail::to($sub['email'])->send(new DunningEmail($sub)));
            $step->sleep('wait-retry', '3 days');

            // 重试一次
            $retry = $step->run('retry-charge', fn() => match ($sub['billing_provider']) {
                'stripe' => StripeService::charge($sub['stripe_id'], $sub['amount']),
                'paypal' => PayPalService::charge($sub['paypal_id'], $sub['amount']),
            });

            if (!$retry['success']) {
                $step->run('cancel-sub', fn() => Subscription::find($subId)->update(['status' => 'cancelled']));
                $step->run('notify-churn', fn() => ChurnNotification::dispatch($subId));
                return;
            }
        }

        // 支付成功 → 续期
        $step->run('extend-sub', fn() => Subscription::find($subId)->update([
            'expires_at' => now()->addMonth(),
            'status' => 'active',
        ]));
        $step->run('send-receipt', fn() => Mail::to($sub['email'])->send(new RenewalReceipt($sub, $result)));
    }
}
```

### 4.6 多步骤审批工作流（等待多个外部事件）

```php
class DocumentApprovalWorkflow extends InngestFunction
{
    protected string $id = 'app-document-approval';
    protected array $triggers = [['event' => 'document/submitted']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $docId = $event['data']['document_id'];

        // 等待经理审批（带超时）
        $mgrApproval = $step->waitForEvent('wait-mgr', 'document/approved',
            new \Inngest\WaitForEventOptions(
                match: "async.data.document_id == '{$docId}' && async.data.role == 'manager'",
                timeout: '48 hours',
            ),
        );

        if ($mgrApproval === null) {
            $step->run('escalate', fn() => Document::find($docId)->update(['status' => 'escalated']));
            return;
        }

        // 经理通过后，等待财务审批
        $finApproval = $step->waitForEvent('wait-finance', 'document/approved',
            new \Inngest\WaitForEventOptions(
                match: "async.data.document_id == '{$docId}' && async.data.role == 'finance'",
                timeout: '72 hours',
            ),
        );

        if ($finApproval === null) {
            $step->run('finance-timeout', fn() => Document::find($docId)->update(['status' => 'finance-timeout']));
            return;
        }

        $step->run('finalize', fn() => Document::find($docId)->update(['status' => 'approved', 'approved_at' => now()]));
        $step->run('notify-author', fn() => DocumentApprovedMail::dispatch($docId));
    }
}
```

---

## 五、错误处理与补偿机制——Saga 模式

```php
class TransferFundsSaga extends InngestFunction
{
    protected string $id = 'app-transfer-funds-saga';
    protected array $triggers = [['event' => 'finance/transfer-requested']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $fromId = $event['data']['from_account_id'];
        $toId = $event['data']['to_account_id'];
        $amount = $event['data']['amount'];

        $step->run('debit-source', function () use ($fromId, $amount) {
            $account = Account::lockForUpdate()->find($fromId);
            if ($account->balance < $amount) throw new NonRetryableError('Insufficient balance');
            $account->decrement('balance', $amount);
        });

        $step->run('credit-target', function () use ($toId, $amount) {
            Account::find($toId)->increment('balance', $amount);
        });

        $step->run('record-transfer', function () use ($fromId, $toId, $amount) {
            Transfer::create(['from' => $fromId, 'to' => $toId, 'amount' => $amount]);
        });
    }

    // 步骤 2 反复失败时的补偿操作
    public function handleFailure(Inngest $client, Step $step, array $event): void
    {
        $step->run('compensate', fn() => Account::find($event['data']['from_account_id'])
            ->increment('balance', $event['data']['amount']));
    }
}
```

步骤级重试确保只有失败的步骤被重试，已完成的步骤（如扣款）不会重复执行。配合 `handleFailure` 实现自动补偿。

---

## 六、Webhook 驱动的工作流

### 6.1 接收外部 Webhook 并触发 Inngest

```php
class StripeWebhookController extends Controller
{
    public function handle(Request $request)
    {
        $payload = $this->verifyStripeSignature($request);
        $inngestEvent = match ($payload['type']) {
            'checkout.session.completed' => ['name' => 'stripe/checkout-completed', 'data' => [
                'session_id' => $payload['data']['object']['id'],
                'customer_id' => $payload['data']['object']['customer'],
            ]],
            'invoice.payment_failed' => ['name' => 'stripe/payment-failed', 'data' => [
                'invoice_id' => $payload['data']['object']['id'],
            ]],
            default => null,
        };
        if ($inngestEvent) Inngest::send($inngestEvent);
        return response()->json(['received' => true]);
    }
}
```

### 6.2 订阅生命周期管理

```php
class SubscriptionLifecycle extends InngestFunction
{
    protected string $id = 'app-subscription-lifecycle';
    protected array $triggers = [['event' => 'stripe/subscription-created']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $sub = $step->run('create-record', fn() => Subscription::create([
            'stripe_id' => $event['data']['subscription_id'], 'status' => 'active',
        ])->toArray());

        $step->run('send-welcome', fn() => Mail::to($sub['email'])->send(new SubWelcomeMail($sub)));
        $step->sleep('wait-trial-end', '14 days');

        $usage = $step->run('check-usage', fn() => [
            'features' => FeatureLog::countFor($sub['id']),
            'sessions' => SessionLog::countFor($sub['user_id']),
        ]);

        $template = $usage['features'] >= 3 ? 'power-user' : 're-engagement';
        $step->run('send-conversion', fn() => Mail::to($sub['email'])->send(new ConversionEmail($sub, $template)));
    }
}
```

---

## 七、与 Laravel Queue/Horizon 的对比

| 维度 | Laravel Queue + Horizon | Inngest |
|------|------------------------|---------|
| **粒度** | Job 级别 | Step 级别 |
| **状态管理** | 无（需自实现） | 自动持久化 |
| **重试** | Job 整体重试 | 步骤级重试 |
| **等待** | `sleep()` 阻塞 Worker | `step.sleep()` 不阻塞 |
| **事件等待** | 不支持 | `step.waitForEvent()` |
| **长时间运行** | 需特殊处理 | 原生支持 |
| **可视化** | Horizon（队列级） | Dashboard（步骤级） |
| **补偿/回滚** | 手动实现 | 自然融入代码流 |

**选择指南：** 简单单步任务继续用 Queue；多步骤工作流、需等待外部事件、长时间运行场景选 Inngest。两者不互斥，同一应用中可混合使用。

---

## 八、实际业务场景

### 8.1 完整订单处理管线

```php
class OrderProcessingPipeline extends InngestFunction
{
    protected string $id = 'app-order-processing-pipeline';
    protected array $triggers = [['event' => 'order/created']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $orderId = $event['data']['order_id'];

        $order = $step->run('validate-order', function () use ($orderId) {
            $order = Order::with(['items.product', 'user'])->findOrFail($orderId);
            foreach ($order->items as $item) {
                if ($item->product->stock < $item->quantity)
                    throw new NonRetryableError("Insufficient stock for #{$item->product->id}");
            }
            return $order->toArray();
        });

        $payment = $step->run('process-payment', fn() => PaymentGateway::charge([
            'customer' => $order['user']['stripe_id'], 'amount' => $order['total_amount'],
        ]));

        $step->run('deduct-inventory', function () use ($order) {
            foreach ($order['items'] as $item)
                Product::find($item['product_id'])->decrement('stock', $item['quantity']);
        });

        $shipment = $step->waitForEvent('wait-for-shipment', 'order/shipped',
            new \Inngest\WaitForEventOptions(match: "async.data.order_id == '{$orderId}'", timeout: '7 days'));

        if ($shipment === null) { $step->run('refund', fn() => PaymentGateway::refund($payment['id'])); return; }

        $step->run('mark-shipped', fn() => Order::find($orderId)->update(['status' => 'shipped']));
        $step->sleep('wait-delivery', '7 days');
        $step->run('request-review', fn() => Mail::to($order['user']['email'])->send(new ReviewRequest()));
    }
}
```

### 8.2 用户引导邮件序列

```php
class UserOnboardingSequence extends InngestFunction
{
    protected string $id = 'app-user-onboarding';
    protected array $triggers = [['event' => 'user/signup']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $userId = $event['data']['user_id'];
        $step->run('day-0', fn() => $this->sendEmail($userId, 'welcome'));
        $step->sleep('wait-1', '1 day');

        if (!$step->run('check-setup', fn() => User::find($userId)->hasCompletedSetup()))
            $step->run('setup-reminder', fn() => $this->sendEmail($userId, 'setup-reminder'));

        $step->sleep('wait-3', '2 days');
        $step->run('day-3', fn() => $this->sendEmail($userId, 'key-features'));

        $action = $step->waitForEvent('wait-action', 'user/performed-action',
            new \Inngest\WaitForEventOptions(match: "async.data.user_id == '{$userId}'", timeout: '4 days'));

        $step->sleep('wait-7', '3 days');
        $step->run('day-7', fn() => $this->sendEmail($userId, $action ? 'advanced-tips' : 'we-miss-you'));
    }
}
```

### 8.3 Cron 定时任务

```php
class DailyReportGenerator extends InngestFunction
{
    protected string $id = 'app-daily-report';
    protected array $triggers = [['cron' => '0 8 * * *']]; // 每天 UTC 8:00

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $metrics = $step->run('collect', fn() => [
            'users' => User::whereDate('created_at', yesterday())->count(),
            'orders' => Order::whereDate('created_at', yesterday())->count(),
            'revenue' => Order::whereDate('created_at', yesterday())->sum('total'),
        ]);
        $url = $step->run('report', fn() => ReportGenerator::daily($metrics));
        $step->run('notify', fn() => AdminNotification::dispatch("Report: {$url}"));
    }
}
```

---

## 九、生产实践要点

**并发控制：** 防止应用被过多并发执行压垮，通过 `concurrency()` 方法限制：

```php
public function concurrency(): ?int { return 5; } // 最多同时执行 5 个实例
```

**安全：** 生产环境必须配置 `INNGEST_SIGNING_KEY`，SDK 自动验证 HMAC-SHA256 签名。使用 Branch Environments 隔离开发和生产环境。

**监控：** 在关键步骤中添加 `Log::info()` 记录执行日志，结合 Inngest Dashboard 的步骤级可视化实现全链路追踪。

**部署：** Inngest 函数与 Laravel 应用一起部署，无需额外步骤。注意不要更改函数 ID（会导致正在进行的执行失败）。

---

## 十、生产环境踩坑记录

以下是我们在生产环境中遇到的典型问题及解决方案：

### 10.1 事件乱序与幂等性

**问题：** 外部系统（如 Stripe Webhook）可能重复或乱序发送事件。例如 `payment/completed` 在 `order/created` 之前到达。

```php
// ❌ 脆弱设计：假设事件严格有序
$order = $step->run('load-order', fn() => Order::findOrFail($event['data']['order_id']));

// ✅ 健壮设计：处理事件尚未到达的情况
$order = $step->run('load-order', function () use ($event) {
    $order = Order::find($event['data']['order_id']);
    if (!$order) {
        // 重新抛出异常触发重试，等待 order/created 事件处理完成
        throw new \RuntimeException("Order #{$event['data']['order_id']} not found, retrying...");
    }
    return $order->toArray();
});
```

**最佳实践：** 每个 step 的业务逻辑应设计为幂等操作。对于数据库写入，使用 `updateOrCreate` 或唯一约束 + `INSERT ... ON CONFLICT DO NOTHING`。

### 10.2 函数执行超时

**问题：** Inngest 函数有执行时间限制（单次 HTTP 调用默认 30 秒，可调整至最大 5 分钟）。如果某个 `step.run()` 内的操作耗时过长（如批量处理 10000 条记录），会触发超时。

```php
// ❌ 可能超时：一次性处理所有记录
$step->run('process-all', function () {
    Order::where('status', 'pending')->chunk(500, function ($orders) {
        foreach ($orders as $order) {
            // 每条订单处理 50ms → 总计 500 秒，必然超时
            $this->processOrder($order);
        }
    });
});

// ✅ 分批为独立步骤：利用步骤级持久化规避超时
$pendingIds = $step->run('fetch-pending-ids', fn() =>
    Order::where('status', 'pending')->pluck('id')->toArray()
);

foreach (array_chunk($pendingIds, 100) as $i => $batch) {
    $step->run("process-batch-{$i}", function () use ($batch) {
        Order::whereIn('id', $batch)->each(fn($order) => $this->processOrder($order));
    });
}
```

**关键思路：** 把大任务拆成多个小 step，每个 step 在超时限制内完成。Inngest 的步骤持久化天然支持这种分段执行。

### 10.3 调试与日志策略

```php
class OrderProcessingPipeline extends InngestFunction
{
    protected string $id = 'app-order-processing-pipeline';
    protected array $triggers = [['event' => 'order/created']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $orderId = $event['data']['order_id'];

        // 策略 1：在 step.run 外添加上下文日志
        Log::info("Inngest: Processing order #{$orderId}", [
            'function_id' => $this->id,
            'event_id' => $event['id'] ?? 'unknown',
        ]);

        $result = $step->run('process', function () use ($orderId) {
            // 策略 2：catch 块中记录结构化错误信息
            try {
                return $this->processOrder($orderId);
            } catch (\Throwable $e) {
                Log::error("Inngest step failed: process", [
                    'order_id' => $orderId,
                    'error' => $e->getMessage(),
                    'trace' => $e->getTraceAsString(),
                ]);
                throw $e; // 重新抛出以触发重试
            }
        });

        // 策略 3：关键步骤结果日志
        Log::info("Inngest: Order #{$orderId} processed", [
            'payment_status' => $result['payment_status'],
            'total_steps' => 6,
            'current_step' => 3,
        ]);
    }
}
```

**调试工具矩阵：**

| 场景 | 工具 | 用途 |
|------|------|------|
| 本地开发 | `npx inngest-cli@latest dev` | 本地 Dashboard，实时查看步骤执行 |
| 生产监控 | Inngest Cloud Dashboard | 函数执行状态、错误率、步骤耗时 |
| 日志聚合 | Laravel Log + CloudWatch/ELK | 搜索特定事件 ID 的完整执行链路 |
| 告警 | Inngest Webhooks + Slack | 函数失败时即时通知 |

---

## 十一、从 Laravel Queue Jobs 迁移到 Inngest

### 迁移决策清单

在迁移之前，评估现有 Job 是否真的需要 Inngest：

| 信号 | 适合留在 Queue | 适合迁移到 Inngest |
|------|---------------|-------------------|
| 单步操作（发邮件、生成 PDF） | ✅ | ❌ 过度设计 |
| 链式 Job（Job A → Job B → Job C） | ❌ 手动管理链路 | ✅ 合并为单个函数 |
| 需要 sleep/wait 的 Job | ❌ 阻塞 Worker | ✅ `step.sleep()` |
| 等待外部事件的 Job | ❌ 用轮询 hack | ✅ `step.waitForEvent()` |
| 有补偿/回滚逻辑的 Job | ❌ 手动状态机 | ✅ Saga 模式 |
| 运行超过 5 分钟的 Job | ❌ 需要特殊配置 | ✅ 原生支持 |

### 逐步迁移路径

**阶段 1：新功能用 Inngest，旧 Job 不动**

新功能直接用 Inngest 函数编写，旧的 Queue Job 继续运行。通过事件桥接两者：

```php
// 旧 Job 触发 Inngest 事件
class LegacyOrderJob implements ShouldQueue
{
    public function handle()
    {
        // 旧逻辑...
        // 迁移点：触发 Inngest 事件，让新函数接管后续流程
        Inngest::send(['name' => 'order/legacy-migrated', 'data' => [
            'order_id' => $this->order->id,
            'source' => 'legacy-queue',
        ]]);
    }
}
```

**阶段 2：重写关键路径**

将最痛苦的链式 Job / 状态机 Job 重写为 Inngest 函数：

```php
// ❌ 旧代码：3 个独立 Job + 数据库状态追踪
class ValidateOrderJob implements ShouldQueue { /* ... */ }
class ProcessPaymentJob implements ShouldQueue { /* ... */ }
class ShipOrderJob implements ShouldQueue { /* ... */ }

// ✅ 新代码：一个线性函数，步骤自动持久化
class OrderLifecycle extends InngestFunction
{
    protected string $id = 'app-order-lifecycle';
    protected array $triggers = [['event' => 'order/created']];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $orderId = $event['data']['order_id'];
        $step->run('validate', fn() => $this->validate($orderId));
        $step->run('payment', fn() => $this->processPayment($orderId));
        $step->run('ship', fn() => $this->ship($orderId));
    }
}
```

**阶段 3：渐进替换**

使用 Inngest 的 cron 触发器替代 `app/Console/Kernel.php` 中的调度任务，逐步减少对 Laravel Scheduler 的依赖。

---

## 十二、本地测试 Inngest 函数

### 12.1 单元测试：直接调用 handle 方法

```php
// tests/Unit/Inngest/SendWelcomeEmailTest.php
use App\Inngest\SendWelcomeEmail;
use Inngest\Inngest;
use Inngest\Step;
use Tests\TestCase;

class SendWelcomeEmailTest extends TestCase
{
    public function test_sends_welcome_and_followup_emails(): void
    {
        Mail::fake();

        $client = app(Inngest::class);
        $step = app(Step::class);
        $event = [
            'name' => 'user/signup',
            'data' => ['user_id' => User::factory()->create()->id],
        ];

        // 直接调用 handle 方法（跳过 step 持久化）
        $fn = new SendWelcomeEmail();
        $fn->handle($client, $step, $event);

        Mail::assertSent(WelcomeEmail::class);
    }
}
```

### 12.2 集成测试：使用 Inngest Dev Server

```bash
# 终端 1：启动 Laravel
php artisan serve --port=8000

# 终端 2：启动 Inngest Dev Server（自动发现 localhost:8000 的函数）
npx inngest-cli@latest dev --no-discovery -u http://localhost:8000/inngest
```

然后通过 Dev Server Dashboard (http://localhost:8288) 手动发送事件触发函数，观察步骤级执行过程。

### 12.3 自动化测试：模拟事件触发

```php
// tests/Feature/Inngest/OrderProcessingTest.php
class OrderProcessingTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_processing_pipeline(): void
    {
        $order = Order::factory()->create(['status' => 'pending']);
        PaymentGateway::fake(); // 模拟支付网关

        // 模拟 Inngest 事件触发
        $this->postJson('/inngest', $this->buildInngestPayload(
            event: ['name' => 'order/created', 'data' => ['order_id' => $order->id]],
        ))->assertOk();

        // 断言第一个步骤执行完成
        $order->refresh();
        $this->assertEquals('processing', $order->status);
    }

    private function buildInngestPayload(array $event): array
    {
        return [
            'events' => [$event],
            'ctx' => [
                'run_id' => 'test-run-001',
                'attempt' => 0,
            ],
            'steps' => new \stdClass(), // 空 steps = 首次执行
        ];
    }
}
```

### 12.4 测试 waitForEvent 超时场景

```php
public function test_payment_timeout_releases_inventory(): void
{
    $order = Order::factory()->create();
    Inventory::reserve($order->id);

    // 第一次调用：执行到 waitForEvent 后暂停
    $response = $this->postJson('/inngest', $this->buildInngestPayload(
        event: ['name' => 'order/created', 'data' => ['order_id' => $order->id]],
    ));
    $response->assertStatus(206); // 206 = 还有步骤待执行

    // 模拟超时：模拟 waitForEvent 返回 null（超时后重新调用）
    // 在测试中直接传入 waitForEvent 返回 null 的 steps 配置
    $timeoutSteps = [
        'wait-for-payment' => ['data' => null], // 超时返回 null
    ];

    $this->postJson('/inngest', $this->buildInngestPayloadWithSteps(
        event: ['name' => 'order/created', 'data' => ['order_id' => $order->id]],
        steps: $timeoutSteps,
    ))->assertOk();

    $this->assertFalse(Inventory::isReserved($order->id));
}
```

---

## 总结

Inngest 为 PHP/Laravel 生态带来了真正意义上的 Durable Functions 能力。核心价值在于：

1. **声明式工作流**：线性的、同步风格的代码描述复杂异步流程
2. **自动持久化**：每个步骤结果自动持久化，进程崩溃不影响工作流
3. **步骤级重试**：失败的步骤独立重试，已完成步骤不重复执行
4. **原生等待**：`step.sleep()` 和 `step.waitForEvent()` 不阻塞资源
5. **事件驱动**：通过事件解耦函数，实现灵活的系统编排

Inngest 不是取代 Laravel Queue，而是在 Queue 之上提供更高层次的编排能力。简单任务继续用 Queue + Horizon，复杂工作流交给 Inngest。当你发现自己在 Laravel Jobs 中编写大量状态管理、错误恢复和轮询逻辑时，就是引入 Inngest 的最佳时机。

---

## 相关阅读

- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/2026/06/02/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/) —— 另一种事件驱动架构范式，用聚合根和领域事件实现 Laravel 订单系统，与 Inngest 的事件驱动工作流形成互补视角。
- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/2026/06/02/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/) —— 深入对比 goroutine/channel 与 Laravel Queue 的并发思维差异，理解不同语言处理异步任务的哲学。
- [Outbox Pattern 实战：保证数据库与消息队列的最终一致性——Laravel + Debezium 的可靠事件发布](/2026/06/03/Outbox-Pattern-实战-保证数据库与消息队列的最终一致性-Laravel-Debezium/) —— 解决微服务中数据库与消息队列双写问题，Outbox 表 + CDC 方案保证事件可靠发布，与 Inngest 的事件驱动工作流配合可构建端到端可靠架构。
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/2026/06/03/Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/) —— 数据库层面的事件驱动方案，配合 Inngest 可构建完整的端到端事件驱动工作流。
