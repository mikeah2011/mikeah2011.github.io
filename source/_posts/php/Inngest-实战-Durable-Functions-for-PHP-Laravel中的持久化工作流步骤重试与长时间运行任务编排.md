---
title: Inngest 实战：Durable Functions for PHP——Laravel 中的持久化工作流、步骤重试与长时间运行任务编排
date: 2026-06-04 09:00:00
tags: [Inngest, Laravel, 持久化工作流, 任务编排, Durable Functions]
categories:
  - php
cover: /images/covers/inngest-durable-functions-php-cover.jpg
description: "深入实战 Inngest Durable Functions for PHP/Laravel，详解持久化工作流、步骤级重试、事件驱动任务编排与长时间运行任务。涵盖 step.run/sleep/waitForEvent 核心 API、订单处理管道、用户引导邮件序列、Saga 补偿事务等生产级代码示例，对比 Laravel Queue 的优劣势，助你构建可靠的异步工作流系统。"
---

在现代 Web 应用开发中，我们经常面临一个核心矛盾：**HTTP 请求的生命周期是短暂的，但业务流程的执行往往是长时间、多步骤、且需要容错能力的**。从用户注册后的多步引导流程，到跨系统的支付对账，再到需要协调数十个微服务的数据迁移，这些场景都超出了传统请求-响应模型的能力范围。

在 Node.js / TypeScript 生态中，Inngest 作为 Durable Functions 的代表方案已经广受好评。如今 Inngest 正式支持了 PHP/Laravel，为 PHP 开发者带来了同等的持久化工作流能力。本文将从架构原理出发，结合大量 Laravel 实战代码，深入探讨如何利用 Inngest 构建可靠的长时间运行任务编排系统。

<!-- more -->

---

## 一、Durable Functions 概念：重新定义异步任务

### 1.1 什么是 Durable Execution

传统的异步任务处理遵循一个简单模型：将任务推入队列，Worker 消费执行，完成后标记为 done。这种模型在处理**单步、无状态、短生命周期**的任务时表现优异，但面对以下场景时就力不从心了：

- **多步骤工作流**：一个业务流程包含 5-10 个步骤，每一步都可能失败，且步骤之间存在数据依赖。
- **长时间运行**：流程可能跨越数小时、数天甚至数周（如用户引导邮件序列）。
- **人工介入**：某些步骤需要等待人工审批或外部系统回调。
- **跨服务编排**：需要调用多个微服务并聚合结果。

**Durable Execution（持久化执行）** 的核心思想是：将一个长时间运行的工作流拆解为一系列 **步骤（Steps）**，每个步骤的执行结果被自动持久化到外部状态存储中。当某个步骤失败时，系统可以从上次成功的步骤恢复执行，而不是从头开始。这类似于数据库事务中的 **检查点（Checkpoint）** 机制，但应用于函数执行层面。

具体来说，Durable Execution 具备以下特征：

1. **状态自动持久化**：每执行完一个步骤，其输入和输出被自动保存到 State Store 中。
2. **故障恢复（Recovery）**：当进程崩溃、服务器重启或网络中断后，系统自动从最后一个成功的步骤恢复。
3. **幂等保证**：每个步骤天然幂等，重复执行不会产生副作用。
4. **内置暂停与唤醒**：步骤可以声明性地暂停（sleep），等待特定时间或特定事件后再继续。
5. **步骤级重试**：可以为每个步骤单独配置重试策略，而非整个任务统一重试。

### 1.2 与传统队列系统的根本区别

| 维度 | 传统队列（如 Laravel Queue） | Durable Functions（如 Inngest） |
|------|--------------------------|-------------------------------|
| **执行单元** | 整个 Job 是一个原子操作 | Job 被拆解为多个独立的 Steps |
| **状态管理** | 无状态或手动管理 | 自动持久化每一步的状态 |
| **故障恢复** | 整个 Job 从头重试 | 从失败的步骤恢复 |
| **暂停/等待** | 需手动实现（sleep + 轮询） | 原生支持（step.sleep, step.waitForEvent） |
| **重试粒度** | 任务级 | 步骤级 |
| **可视化** | 基本（成功/失败/待处理） | 完整执行流时间线 |
| **长时间运行** | 受 Worker 超时限制 | 可运行数天/数周 |
| **代码复杂度** | 需手动编排步骤、处理错误 | 声明式，框架自动管理 |

用一个形象的比喻：传统队列像是 **寄一封信**——你把信投进邮箱，要么送达要么退回，你不知道中间经历了哪些中转站。而 Durable Functions 像是 **快递追踪**——你知道包裹在每个中转站的状态，任何一个环节出问题都能精准定位和恢复。

### 1.3 Durable Functions 方案全景对比

目前业界主流的 Durable Execution 方案包括：

| 特性 | Azure Durable Functions | Temporal | Inngest | Encorp |
|------|------------------------|----------|---------|--------|
| **语言支持** | C#, JS, Python, Java, PowerShell | Go, Java, PHP, Python, TypeScript, .NET | TypeScript, Python, PHP, Go | Go, TypeScript |
| **部署模型** | Azure Functions（Serverless） | 自托管或 Temporal Cloud | Inngest Cloud + 自托管 | Self-hosted |
| **状态存储** | Azure Storage / SQL | 自管理（Cassandra/MySQL/PostgreSQL） | Inngest Cloud 托管 | PostgreSQL |
| **编程模型** | Orchestrator + Activity + Entity | Workflow + Activity | Event → Function → Step | Workflow + Step |
| **事件驱动** | 有限（HTTP / Queue Trigger） | 信号机制 | 原生 Event-driven | Webhook |
| **Laravel 集成** | ❌ 不支持 | ⚠️ 社区 SDK | ✅ 官方支持 | ❌ 不支持 |
| **学习曲线** | 中等（需熟悉 Azure 生态） | 较高（需理解 Worker/TaskQueue） | 低（接近原生 PHP 开发） | 中等 |
| **可视化仪表盘** | Azure Portal | Temporal Web UI | Inngest Dashboard | 自建 |
| **定价** | 按执行次数计费 | Self-hosted 免费 / Cloud 按执行计费 | 免费额度 + 按量计费 | 开源免费 |
| **适合场景** | Azure 生态用户 | 大型企业级系统 | 中小型应用快速集成 | Go 微服务 |

对于 **PHP/Laravel 开发者**来说，Inngest 是目前最成熟的选择，原因有三：官方维护的 Laravel SDK、极低的集成成本、以及出色的开发者体验。

---

## 二、Inngest 架构与工作原理

### 2.1 核心执行模型：Event → Function → Step

Inngest 的架构围绕三个核心概念构建：

```
┌─────────────┐     Event API      ┌─────────────────┐     HTTP Invoke     ┌──────────────────┐
│  Your App   │ ──────────────────→ │  Inngest Cloud  │ ─────────────────→ │  Your App        │
│  (Producer) │                     │  (Orchestrator)  │                     │  (Functions)     │
└─────────────┘                     └─────────────────┘                     └──────────────────┘
                                           │                                         │
                                           │  State Store                            │ Step Results
                                           ▼                                         ▼
                                    ┌─────────────┐                         ┌──────────────┐
                                    │  Step State  │                         │  Database /  │
                                    │  Database    │                         │  Services    │
                                    └─────────────┘                         └──────────────┘
```

**Event（事件）** 是一切的起点。事件是结构化的 JSON 数据，通过 Inngest Event API 发送到 Inngest Cloud。一个事件包含：
- `name`：事件名称，用于匹配触发的函数
- `data`：事件的负载数据
- `user`：可选的用户标识，用于并发控制
- `ts`：时间戳

**Function（函数）** 是你的业务逻辑容器。每个函数通过 `event` 属性声明它监听哪种事件。当匹配的事件到达时，Inngest Cloud 会通过 HTTP 请求调用你的应用来执行函数。

**Step（步骤）** 是函数内部的工作单元。每个 Step 执行一个原子操作，其结果被自动持久化。Inngest 确保每个 Step 最多执行一次（at-most-once execution），即使在重试场景下也是如此。

### 2.2 Event API 与事件投递

Inngest 提供了 RESTful 的 Event API，你可以通过 HTTP POST 发送事件：

```
POST https://inn.gs/e/{event_key}
Content-Type: application/json

{
  "name": "user/signup",
  "data": {
    "user_id": "usr_123",
    "email": "john@example.com",
    "plan": "pro"
  },
  "user": {
    "id": "usr_123"
  }
}
```

一次请求可以批量发送多个事件（数组格式），Event API 保证低延迟（p99 < 50ms）和高可用。

### 2.3 State Store 与执行保证

Inngest Cloud 内部维护了一个 **State Store**，它记录了每个函数执行的：
- 当前执行到哪一步
- 每一步的输入和输出
- 执行状态（运行中、等待中、已完成、失败）
- 重试计数和错误信息

当函数执行到某个 Step 时：
1. Inngest 先检查 State Store，该 Step 是否已有缓存结果
2. 如果有，直接返回缓存结果（这就是幂等性的基础）
3. 如果没有，执行该 Step，将结果写入 State Store，然后返回

这意味着即使你的服务器在 Step 执行后但在返回结果前崩溃了，Inngest 重新调用时会发现该 Step 已有缓存结果（来自上次的执行），从而直接跳过，实现了**自动故障恢复**。

### 2.4 执行流程详解

一个完整的函数执行流程如下：

1. **事件到达**：你的应用发送 `user/signup` 事件到 Inngest Event API
2. **函数匹配**：Inngest 根据事件名称匹配到所有监听该事件的函数
3. **创建执行实例**：为每个匹配的函数创建一个新的 Function Run
4. **调用你的应用**：Inngest 通过 HTTP POST 调用你注册的路由（通常类似 `/api/inngest`）
5. **执行第一步**：你的代码运行第一个 `step.run()`，Inngest 记录结果
6. **返回步骤断点**：函数返回该 Step 的结果和下一步的意图
7. **继续或等待**：如果是 `step.sleep()`，Inngest 记录唤醒时间，暂停执行
8. **唤醒执行**：到时间后，Inngest 再次调用你的应用，从 State Store 恢复状态，执行下一步
9. **重复直到完成**：所有步骤执行完毕，Function Run 标记为 completed

关键在于：**你的代码在每次被调用时，从第一步开始执行，但之前已完成的 Step 直接返回缓存结果，只有新的 Step 才真正执行**。这就是 "Replay" 机制。

---

## 三、Laravel 集成实战

### 3.1 环境准备与 Composer 安装

首先，确保你的 Laravel 项目版本 ≥ 9.x，PHP ≥ 8.1。安装 Inngest 的 Laravel SDK：

```bash
composer require inngest/inngest-laravel
```

Laravel 的包自动发现机制（Package Discovery）会自动注册 Service Provider，无需手动添加。

### 3.2 环境配置

在 `.env` 文件中添加 Inngest 配置：

```env
# Inngest Event API Key（从 Inngest Dashboard 获取）
INNGEST_EVENT_KEY=your_event_key_here

# Inngest Signing Key（用于签名验证，生产环境必须）
INNGEST_SIGNING_KEY=signkey-prod-xxxxxxxx

# 可选：自定义 Inngest API 地址（自托管时使用）
INNGEST_API_URL=https://api.inngest.com
```

### 3.3 路由注册

Inngest Laravel SDK 提供了一个自动路由注册。在 `routes/api.php` 中添加：

```php
use Inngest\Laravel\InngestController;

Route::post('/inngest', [InngestController::class, 'handle'])
    ->name('inngest.handle');
```

这会暴露一个 `/api/inngest` 端点，Inngest Cloud 通过这个端点调用你的函数。你也可以使用中间件来保护这个路由：

```php
Route::post('/inngest', [InngestController::class, 'handle'])
    ->name('inngest.handle')
    ->middleware('throttle:100,1');  // 限制每分钟 100 次请求
```

### 3.4 配置文件发布（可选）

```bash
php artisan vendor:publish --provider="Inngest\Laravel\InngestServiceProvider"
```

这会生成 `config/inngest.php`：

```php
<?php

return [
    'event_key' => env('INNGEST_EVENT_KEY'),
    'signing_key' => env('INNGEST_SIGNING_KEY'),
    'api_url' => env('INNGEST_API_URL', 'https://api.inngest.com'),
    'env' => env('INNGEST_ENV', env('APP_ENV', 'local')),
    'middleware' => [],
];
```

### 3.5 创建第一个 Inngest 函数

在 `app/Inngest/` 目录下创建函数类：

```php
<?php

namespace App\Inngest;

use Inngest\InngestFunction;
use Inngest\Step;

class SendWelcomeEmail extends InngestFunction
{
    public static function id(): string
    {
        return 'send-welcome-email';
    }

    public static function name(): string
    {
        return 'Send Welcome Email';
    }

    public function register(): array
    {
        return [
            'event' => 'user/signup',
        ];
    }

    public function handle(array $event, Step $step): mixed
    {
        $userId = $event['data']['user_id'];

        // Step 1: 获取用户信息
        $user = $step->run('get-user', function () use ($userId) {
            return User::findOrFail($userId)->toArray();
        });

        // Step 2: 发送欢迎邮件
        $step->run('send-email', function () use ($user) {
            Mail::to($user['email'])->send(new WelcomeMail($user));
            return ['sent' => true];
        });

        // Step 3: 记录日志
        $step->run('log-sent', function () use ($userId) {
            ActivityLog::create([
                'user_id' => $userId,
                'action' => 'welcome_email_sent',
            ]);
        });

        return ['success' => true];
    }
}
```

---

## 四、Step 函数详解与幂等性

Step 是 Inngest 的核心构建块。每个 Step 都是声明式的、幂等的、自动重试的工作单元。

### 4.1 step.run() —— 执行原子操作

`step.run()` 是最基础的 Step 类型，它执行一个闭包并持久化结果：

```php
$result = $step->run('step-name', function () {
    // 你的业务逻辑
    return $computedValue;
});
```

**重要规则**：
- Step 名称（第一个参数）在同一个函数中必须唯一
- 闭包内的代码应该是 **纯函数**——相同的输入产生相同的输出
- 避免在闭包中使用非确定性操作（如 `time()`、`rand()`），除非你将其作为 Step 的输入传入

```php
// ❌ 错误：使用非确定性值可能导致重试时结果不一致
$step->run('generate-token', function () {
    return Str::random(32);  // 每次重试都会生成不同的 token
});

// ✅ 正确：在 Step 外部确定值，作为参数传入
$token = Str::random(32);
$step->run('save-token', function () use ($token) {
    DB::table('tokens')->insert(['token' => $token]);
    return $token;
});
```

### 4.2 step.sleep() —— 声明式等待

`step.sleep()` 让函数暂停指定的时间段后继续执行。这在传统队列系统中需要复杂的延迟队列或定时任务来实现：

```php
// 等待 24 小时
$step->sleep('wait-24h', '24h');

// 等待 30 分钟
$step->sleep('wait-review', '30m');

// 等待 7 天
$step->sleep('wait-weekly-followup', '7d');

// 支持的时间格式
$step->sleep('wait', '1s');    // 秒
$step->sleep('wait', '5m');    // 分钟
$step->sleep('wait', '2h');    // 小时
$step->sleep('wait', '3d');    // 天
```

实战示例——欢迎邮件序列：

```php
public function handle(array $event, Step $step): mixed
{
    $userId = $event['data']['user_id'];
    $user = $step->run('get-user', fn () => User::find($userId));

    // 立即发送欢迎邮件
    $step->run('welcome-email', function () use ($user) {
        Mail::to($user->email)->send(new WelcomeMail($user));
    });

    // 等待 1 天后发送引导邮件
    $step->sleep('wait-1-day', '1d');
    $step->run('onboarding-email', function () use ($user) {
        Mail::to($user->email)->send(new OnboardingMail($user));
    });

    // 等待 6 天（共 7 天）后发送促销邮件
    $step->sleep('wait-6-more-days', '6d');
    $step->run('promo-email', function () use ($user) {
        Mail::to($user->email)->send(new PromoMail($user));
    });

    return ['sequence_completed' => true];
}
```

注意：`step.sleep` 不会阻塞 Worker 进程！Inngest 会在内部记录唤醒时间，然后释放连接。当时间到达时，它会重新调用你的函数，从 State Store 恢复到 sleep 之后的位置继续执行。

### 4.3 step.sleepUntil() —— 等待到指定时间点

`step.sleepUntil()` 让函数等待到一个精确的时间点：

```php
// 等待到明天上午 9 点
$step->sleepUntil('tomorrow-9am', now()->addDay()->setTime(9, 0));

// 等待到月底
$step->sleepUntil('end-of-month', now()->endOfMonth());

// 等待到特定日期（例如免费试用到期时）
$trialEndsAt = $user->trial_ends_at->toDateTimeString();
$step->sleepUntil('trial-expiry', $trialEndsAt);
```

实战示例——免费试用到期提醒：

```php
public function handle(array $event, Step $step): mixed
{
    $userId = $event['data']['user_id'];

    $user = $step->run('load-user', fn () => User::find($userId));

    // 等待到试用期结束前一天
    $reminderDate = $user->trial_ends_at->subDay();
    $step->sleepUntil('before-trial-ends', $reminderDate->toIso8601String());

    // 发送试用到期提醒
    $step->run('send-trial-reminder', function () use ($user) {
        Mail::to($user->email)->send(new TrialEndingSoonMail($user));
    });

    // 再等一天（试用正式结束）
    $step->sleepUntil('trial-ends', $user->trial_ends_at->toIso8601String());

    // 检查是否已付费
    $hasPaid = $step->run('check-payment', function () use ($userId) {
        return Subscription::where('user_id', $userId)
            ->where('status', 'active')
            ->exists();
    });

    if (!$hasPaid) {
        $step->run('send-final-reminder', function () use ($user) {
            Mail::to($user->email)->send(new ConvertToPaidMail($user));
        });
    }

    return ['trial_processed' => true];
}
```

### 4.4 step.waitForEvent() —— 等待外部事件

`step.waitForEvent()` 是最强大的 Step 类型之一，它让函数暂停并等待另一个特定事件的到达。这对于需要 **人工审批** 或 **外部系统回调** 的场景至关重要：

```php
// 等待 'approval/granted' 事件，超时 48 小时
$result = $step->waitForEvent(
    'wait-for-approval',           // Step 名称
    'approval/granted',            // 等待的事件名称
    '48h'                          // 超时时间
);

if ($result === null) {
    // 超时了，没有人审批
    $step->run('auto-reject', function () {
        // 自动拒绝
    });
} else {
    // 收到了审批事件
    $approver = $result['data']['approver_id'];
    // 继续处理...
}
```

实战示例——订单人工审批工作流：

```php
public function handle(array $event, Step $step): mixed
{
    $orderData = $event['data'];

    // Step 1: 创建待审批订单
    $order = $step->run('create-pending-order', function () use ($orderData) {
        return Order::create([
            'user_id' => $orderData['user_id'],
            'amount' => $orderData['amount'],
            'status' => 'pending_approval',
        ]);
    });

    // Step 2: 通知审批人
    $step->run('notify-approver', function () use ($order) {
        Notification::send(
            User::role('manager')->get(),
            new OrderNeedsApproval($order)
        );
    });

    // Step 3: 等待审批事件（带过滤条件，只接受当前订单的审批）
    $approval = $step->waitForEvent(
        'wait-approval',
        'order.approved',
        '72h',
        // 过滤表达式：只匹配当前订单 ID
        "async.data.order_id == '{$order->id}'"
    );

    if ($approval === null) {
        // 超时自动拒绝
        $step->run('auto-cancel', function () use ($order) {
            $order->update(['status' => 'auto_cancelled']);
        });
        return ['status' => 'cancelled', 'reason' => 'timeout'];
    }

    // Step 4: 处理支付
    $payment = $step->run('process-payment', function () use ($order) {
        return PaymentService::charge($order);
    });

    // Step 5: 确认订单
    $step->run('confirm-order', function () use ($order, $payment) {
        $order->update([
            'status' => 'confirmed',
            'payment_id' => $payment['id'],
        ]);
    });

    return ['status' => 'confirmed', 'order_id' => $order->id];
}
```

### 4.5 step.sendEvent() —— 发送事件触发其他函数

`step.sendEvent()` 让当前函数在执行过程中发送新事件，从而触发其他 Inngest 函数。这是实现 **函数间解耦** 的关键：

```php
// 在 Step 中发送事件
$step->run('complete-order', function () use ($order) {
    $order->update(['status' => 'completed']);
});

// 发送事件触发后续流程
$step->sendEvent('order-completed-event', [
    'name' => 'order/completed',
    'data' => [
        'order_id' => $order->id,
        'user_id' => $order->user_id,
        'total' => $order->total,
    ],
]);
```

这使得你可以将复杂的系统拆分为多个独立的 Inngest 函数，通过事件进行编排：

```
user/signup
    └→ SendWelcomeEmail 函数
    └→ CreateDefaultWorkspace 函数
    └→ SetupAnalytics 函数

order/completed
    └→ SendOrderConfirmationEmail 函数
    └→ UpdateInventory 函数
    └→ TriggerLoyaltyPoints 函数
```

### 4.6 幂等性设计原理

Inngest 的幂等性基于 **Step Name + Function Run ID** 的唯一组合。当 Inngest 调用你的函数时：

1. 函数从头开始执行
2. 对于每个 `step.run('name', ...)`，Inngest 先查询 State Store
3. 如果该 Step 已经在当前 Function Run 中执行过，直接返回缓存结果
4. 如果没有执行过，运行闭包，存储结果，然后返回

这意味着：
- **网络中断后重试**：不会重复执行已完成的步骤
- **Worker 重启**：自动从断点恢复
- **并发调用**：同一 Function Run 不会被并发执行（Inngest 内部加锁）

但这 **不等于** 业务幂等性。如果你的 Step 内部调用了非幂等的外部 API（如支付网关），你需要在业务层面确保幂等：

```php
$step->run('charge-payment', function () use ($order) {
    // ✅ 使用 idempotency key 确保业务幂等
    return Stripe::paymentIntents()->create([
        'amount' => $order->amount_in_cents,
        'currency' => 'usd',
        'customer' => $order->user->stripe_id,
        'idempotency_key' => "order_{$order->id}_charge",
    ]);
});
```

---

## 五、重试策略与死信队列

### 5.1 Step 级重试配置

Inngest 默认为每个 Step 提供重试机制。你可以在函数定义中精细控制重试行为：

```php
class ProcessPayment extends InngestFunction
{
    public static function config(): array
    {
        return [
            'id' => 'process-payment',
            'name' => 'Process Payment',
            'retries' => 5,  // 默认重试 5 次
        ];
    }

    public function register(): array
    {
        return ['event' => 'payment/initiated'];
    }

    public function handle(array $event, Step $step): mixed
    {
        // Step 1 使用默认重试次数（5 次）
        $order = $step->run('load-order', function () {
            return Order::findOrFail($this->event['data']['order_id']);
        });

        // Step 2 自定义重试策略
        $payment = $step->run('charge-customer', function () {
            return PaymentGateway::charge($this->event['data']);
        }, [
            'retries' => 3,           // 最多重试 3 次
        ]);

        return $payment;
    }
}
```

### 5.2 指数退避（Exponential Backoff）

Inngest 默认使用指数退避策略，间隔为 `min(2^n * 2, 43200)` 秒（最长 12 小时）：

| 重试次数 | 间隔时间 |
|---------|---------|
| 第 1 次重试 | 4 秒 |
| 第 2 次重试 | 8 秒 |
| 第 3 次重试 | 16 秒 |
| 第 4 次重试 | 32 秒 |
| 第 5 次重试 | 64 秒 |
| 第 6 次重试 | 128 秒 |
| ... | ... |

你可以在 `config/inngest.php` 中自定义退避策略：

```php
'retry' => [
    'max_attempts' => 5,
    'backoff' => [
        'type' => 'exponential',
        'factor' => 3,
        'min_delay' => 10,   // 最小延迟 10 秒
        'max_delay' => 3600, // 最大延迟 1 小时
    ],
],
```

### 5.3 最大重试次数与 Dead Letter Queue

当一个 Step 的重试次数达到上限后，该函数执行会被标记为 **失败**。Inngest 会自动将这类失败的函数推送到 **Dead Letter Queue (DLQ)**：

```php
class CriticalWorkflow extends InngestFunction
{
    public static function config(): array
    {
        return [
            'id' => 'critical-workflow',
            'name' => 'Critical Payment Workflow',
            'retries' => 3,
        ];
    }

    public function register(): array
    {
        return ['event' => 'payment/process'];
    }

    public function handle(array $event, Step $step): mixed
    {
        // 这个 Step 失败 3 次后，整个函数进入 DLQ
        $result = $step->run('call-payment-gateway', function () {
            // 可能因网络问题多次失败
            return Http::timeout(10)
                ->post('https://api.payment.com/charge', [
                    'amount' => $this->event['data']['amount'],
                ])
                ->throw()
                ->json();
        });

        return $result;
    }
}
```

在 Inngest Dashboard 中，你可以：
1. 查看所有 DLQ 中的函数执行
2. 查看完整的执行历史和错误信息
3. 手动重试（从失败的步骤或从头开始）
4. 设置告警通知（当 DLQ 队列深度超过阈值时）

### 5.4 自定义错误处理与条件重试

某些错误不应该重试（如验证错误），而某些错误应该立即重试（如限流）：

```php
use Inngest\Exceptions\NonRetryableError;

class SmartRetryFunction extends InngestFunction
{
    public function handle(array $event, Step $step): mixed
    {
        try {
            $result = $step->run('api-call', function () {
                $response = Http::post('https://external-api.com/data', [
                    'payload' => $this->event['data'],
                ]);

                if ($response->status() === 429) {
                    // 限流错误：抛出可重试错误
                    throw new \Exception('Rate limited, will retry');
                }

                if ($response->status() === 400) {
                    // 业务错误：不可重试
                    throw new NonRetryableError('Invalid request data');
                }

                $response->throw();
                return $response->json();
            });
        } catch (NonRetryableError $e) {
            // 不可重试的错误：记录日志并优雅处理
            $step->run('log-failure', function () use ($event, $e) {
                FailedEvent::create([
                    'event_name' => $event['name'],
                    'error' => $e->getMessage(),
                    'data' => json_encode($event['data']),
                ]);
            });
            return ['status' => 'failed', 'reason' => $e->getMessage()];
        }

        return $result;
    }
}
```

### 5.5 生产环境 DLQ 处理策略

建议在生产环境中配合 Laravel 的通知系统处理 DLQ：

```php
// 通过 Inngest Webhook 监听函数失败事件
class HandleInngestFailure extends InngestFunction
{
    public static function id(): string
    {
        return 'handle-inngest-failure';
    }

    public function register(): array
    {
        return [
            'event' => 'inngest/function.failed',
        ];
    }

    public function handle(array $event, Step $step): mixed
    {
        $functionId = $event['data']['function_id'];
        $error = $event['data']['error'];
        $runId = $event['data']['run_id'];

        // 发送 Slack 通知
        $step->run('notify-slack', function () use ($functionId, $error, $runId) {
            Http::post(config('services.slack.webhook_url'), [
                'text' => "🚨 Inngest 函数失败: {$functionId}\n"
                    . "Run ID: {$runId}\n"
                    . "错误: {$error}",
            ]);
        });

        // 发送邮件给运维团队
        $step->run('notify-team', function () use ($functionId, $error) {
            Mail::to('ops@company.com')
                ->send(new InngestFailureAlert($functionId, $error));
        });

        return ['notified' => true];
    }
}
```

---

## 六、长时间运行工作流实战

### 6.1 实战一：多步骤订单处理管道

这是一个完整的电商订单处理流程，涵盖下单 → 扣库存 → 支付 → 发货 → 通知的全流程：

```php
<?php

namespace App\Inngest;

use Inngest\InngestFunction;
use Inngest\Step;
use App\Models\Order;
use App\Models\Product;
use App\Services\PaymentService;
use App\Services\ShippingService;

class OrderProcessingPipeline extends InngestFunction
{
    public static function id(): string
    {
        return 'order-processing-pipeline';
    }

    public static function name(): string
    {
        return 'Order Processing Pipeline';
    }

    public static function config(): array
    {
        return [
            'retries' => 3,
            'concurrency' => [
                'limit' => 10,  // 最多同时处理 10 个订单
            ],
        ];
    }

    public function register(): array
    {
        return ['event' => 'order/created'];
    }

    public function handle(array $event, Step $step): mixed
    {
        $orderData = $event['data'];
        $orderId = $orderData['order_id'];

        // ====== Phase 1: 订单验证 ======

        $order = $step->run('load-order', function () use ($orderId) {
            return Order::with(['items.product', 'user'])->findOrFail($orderId)->toArray();
        });

        // ====== Phase 2: 扣减库存 ======

        $reservation = $step->run('reserve-inventory', function () use ($order) {
            $reservations = [];
            foreach ($order['items'] as $item) {
                $product = Product::lockForUpdate()->find($item['product_id']);
                if ($product->stock < $item['quantity']) {
                    throw new \Exception("库存不足: {$product->name}");
                }
                $product->decrement('stock', $item['quantity']);
                $reservations[] = [
                    'product_id' => $product->id,
                    'quantity' => $item['quantity'],
                ];
            }

            Order::find($order['id'])->update(['status' => 'inventory_reserved']);
            return $reservations;
        });

        // ====== Phase 3: 处理支付 ======

        try {
            $payment = $step->run('process-payment', function () use ($order) {
                return PaymentService::createCharge([
                    'amount' => $order['total'],
                    'currency' => $order['currency'] ?? 'usd',
                    'customer_id' => $order['user']['stripe_id'],
                    'description' => "Order #{$order['order_number']}",
                    'idempotency_key' => "order_{$order['id']}_payment",
                ]);
            });
        } catch (\Exception $e) {
            // 支付失败，回滚库存
            $step->run('rollback-inventory', function () use ($order, $reservation) {
                foreach ($reservation as $res) {
                    Product::find($res['product_id'])
                        ->increment('stock', $res['quantity']);
                }
                Order::find($order['id'])->update(['status' => 'payment_failed']);
            });

            // 通知用户支付失败
            $step->run('notify-payment-failure', function () use ($order) {
                \Mail::to($order['user']['email'])
                    ->send(new PaymentFailedMail($order));
            });

            return ['status' => 'payment_failed', 'order_id' => $orderId];
        }

        // ====== Phase 4: 创建发货单 ======

        $step->sleep('wait-for-fraud-check', '30m');  // 等待欺诈检查窗口期

        $shipment = $step->run('create-shipment', function () use ($order, $payment) {
            Order::find($order['id'])->update([
                'status' => 'confirmed',
                'payment_id' => $payment['id'],
                'confirmed_at' => now(),
            ]);

            return ShippingService::createShipment([
                'order_id' => $order['id'],
                'address' => $order['shipping_address'],
                'items' => $order['items'],
            ]);
        });

        // ====== Phase 5: 等待发货确认 ======

        $shipped = $step->waitForEvent(
            'wait-for-shipped',
            'order/shipped',
            '7d',  // 最长等待 7 天
            "async.data.order_id == '{$orderId}'"
        );

        if ($shipped === null) {
            // 超时未发货，告警处理
            $step->run('shipping-timeout-alert', function () use ($order) {
                \Slack::send("⚠️ 订单 #{$order['order_number']} 超过 7 天未发货！");
                Order::find($order['id'])->update(['status' => 'shipping_overdue']);
            });
            return ['status' => 'shipping_overdue'];
        }

        // ====== Phase 6: 通知客户 ======

        $step->run('send-shipping-notification', function () use ($order, $shipped) {
            \Mail::to($order['user']['email'])
                ->send(new OrderShippedMail($order, $shipped['data']['tracking_number']));
        });

        // 发送事件触发后续流程（积分、评价提醒等）
        $step->sendEvent('order-complete-trigger', [
            'name' => 'order/fulfilled',
            'data' => [
                'order_id' => $orderId,
                'user_id' => $order['user']['id'],
                'total' => $order['total'],
            ],
        ]);

        return [
            'status' => 'fulfilled',
            'order_id' => $orderId,
            'tracking_number' => $shipped['data']['tracking_number'],
        ];
    }
}
```

这个工作流展示了 Inngest 的核心优势：
- **步骤级错误处理**：支付失败时只回滚库存，不需要从头重试
- **声明式等待**：欺诈检查等待、发货确认等待都是声明式的
- **事件驱动衔接**：发货确认通过事件触发，不阻塞 Worker
- **并发控制**：通过 `concurrency` 配置防止过载

### 6.2 实战二：用户引导邮件序列

```php
<?php

namespace App\Inngest;

use Inngest\InngestFunction;
use Inngest\Step;
use App\Models\User;
use App\Mail\WelcomeMail;
use App\Mail\OnboardingTipMail;
use App\Mail\FeatureHighlightMail;
use App\Mail\PromoOfferMail;
use App\Mail\FeedbackRequestMail;

class UserOnboardingSequence extends InngestFunction
{
    public static function id(): string
    {
        return 'user-onboarding-sequence';
    }

    public static function name(): string
    {
        return 'User Onboarding Email Sequence';
    }

    public function register(): array
    {
        return ['event' => 'user/signup'];
    }

    public function handle(array $event, Step $step): mixed
    {
        $userId = $event['data']['user_id'];

        $user = $step->run('load-user', fn () => User::findOrFail($userId));

        // Day 0: 欢迎邮件
        $step->run('day0-welcome', function () use ($user) {
            Mail::to($user->email)->send(new WelcomeMail($user));
            EmailLog::create(['user_id' => $user->id, 'type' => 'welcome']);
        });

        // Day 1: 上手引导
        $step->sleep('wait-day1', '1d');
        $step->run('day1-onboarding', function () use ($user) {
            if ($user->fresh()->has_completed_tutorial) return 'skipped';
            Mail::to($user->email)->send(new OnboardingTipMail($user));
            EmailLog::create(['user_id' => $user->id, 'type' => 'onboarding_tip']);
        });

        // Day 3: 功能介绍
        $step->sleep('wait-day3', '2d');
        $step->run('day3-features', function () use ($user) {
            $topFeature = $this->getUnexploredFeature($user);
            Mail::to($user->email)->send(new FeatureHighlightMail($user, $topFeature));
            EmailLog::create(['user_id' => $user->id, 'type' => 'feature_highlight']);
        });

        // Day 7: 促销优惠
        $step->sleep('wait-day7', '4d');
        $step->run('day7-promo', function () use ($user) {
            if ($user->fresh()->is_paying) return 'skipped';
            Mail::to($user->email)->send(new PromoOfferMail($user, ['discount' => 20]));
            EmailLog::create(['user_id' => $user->id, 'type' => 'promo_offer']);
        });

        // Day 14: 反馈收集
        $step->sleep('wait-day14', '7d');
        $step->run('day14-feedback', function () use ($user) {
            Mail::to($user->email)->send(new FeedbackRequestMail($user));
            EmailLog::create(['user_id' => $user->id, 'type' => 'feedback_request']);
        });

        return ['onboarding_completed' => true, 'user_id' => $userId];
    }

    private function getUnexploredFeature(User $user): string
    {
        $features = ['dashboard', 'reports', 'integrations', 'api'];
        foreach ($features as $feature) {
            if (!$user->hasUsedFeature($feature)) {
                return $feature;
            }
        }
        return 'dashboard';
    }
}
```

### 6.3 实战三：大规模数据同步管道

```php
<?php

namespace App\Inngest;

use Inngest\InngestFunction;
use Inngest\Step;

class DataSyncPipeline extends InngestFunction
{
    public static function id(): string
    {
        return 'data-sync-pipeline';
    }

    public static function name(): string
    {
        return 'External Data Sync Pipeline';
    }

    public static function config(): array
    {
        return [
            'retries' => 5,
            'concurrency' => [
                'limit' => 3,  // 限制并发同步任务数
            ],
        ];
    }

    public function register(): array
    {
        return ['event' => 'sync/triggered'];
    }

    public function handle(array $event, Step $step): mixed
    {
        $sourceId = $event['data']['source_id'];
        $syncId = uniqid('sync_');

        // Step 1: 初始化同步记录
        $syncJob = $step->run('init-sync', function () use ($sourceId, $syncId) {
            return SyncJob::create([
                'sync_id' => $syncId,
                'source_id' => $sourceId,
                'status' => 'running',
                'started_at' => now(),
            ]);
        });

        // Step 2: 获取数据源元信息
        $meta = $step->run('fetch-metadata', function () use ($sourceId) {
            $source = DataSource::find($sourceId);
            $totalRecords = Http::get("{$source->api_url}/count")->json('total');
            return [
                'source' => $source->toArray(),
                'total_records' => $totalRecords,
                'page_size' => 100,
                'total_pages' => ceil($totalRecords / 100),
            ];
        });

        // Step 3: 分页拉取、转换、写入
        $totalProcessed = 0;
        $totalErrors = 0;

        for ($page = 1; $page <= $meta['total_pages']; $page++) {
            $pageResult = $step->run("process-page-{$page}", function () use ($meta, $page) {
                $source = $meta['source'];

                // 拉取
                $rawData = Http::get("{$source['api_url']}/data", [
                    'page' => $page,
                    'per_page' => $meta['page_size'],
                ])->json('data');

                // 转换
                $transformed = array_map(function ($record) use ($source) {
                    return [
                        'external_id' => $record[$source['id_field']],
                        'name' => $record[$source['name_field']],
                        'data' => $record,
                        'synced_at' => now(),
                    ];
                }, $rawData);

                // 写入（upsert）
                $inserted = 0;
                $errors = 0;
                foreach ($transformed as $record) {
                    try {
                        ExternalRecord::updateOrCreate(
                            ['external_id' => $record['external_id'], 'source_id' => $source['id']],
                            $record
                        );
                        $inserted++;
                    } catch (\Exception $e) {
                        $errors++;
                        Log::warning("Sync error", ['record' => $record, 'error' => $e->getMessage()]);
                    }
                }

                return ['inserted' => $inserted, 'errors' => $errors];
            });

            $totalProcessed += $pageResult['inserted'];
            $totalErrors += $pageResult['errors'];

            // 每处理 5 页暂停一下，避免过载外部 API
            if ($page % 5 === 0 && $page < $meta['total_pages']) {
                $step->sleep("rate-limit-page-{$page}", '30s');
            }
        }

        // Step 4: 数据校验
        $validation = $step->run('validate-data', function () use ($sourceId, $meta, $totalProcessed) {
            $localCount = ExternalRecord::where('source_id', $sourceId)->count();
            $matchRate = $localCount / $meta['total_records'] * 100;

            return [
                'expected' => $meta['total_records'],
                'actual' => $localCount,
                'match_rate' => round($matchRate, 2),
                'passed' => $matchRate >= 99.0,
            ];
        });

        // Step 5: 更新同步记录
        $step->run('finalize-sync', function () use ($syncJob, $totalProcessed, $totalErrors, $validation) {
            SyncJob::find($syncJob['id'])->update([
                'status' => $validation['passed'] ? 'completed' : 'validation_failed',
                'records_processed' => $totalProcessed,
                'records_errors' => $totalErrors,
                'match_rate' => $validation['match_rate'],
                'completed_at' => now(),
            ]);
        });

        return [
            'sync_id' => $syncId,
            'processed' => $totalProcessed,
            'errors' => $totalErrors,
            'validation' => $validation,
        ];
    }
}
```

---

## 七、Event-Driven 触发机制

### 7.1 InngestEvent 模型

在 Laravel 中发送事件到 Inngest：

```php
use Inngest\Laravel\Facades\Inngest;

// 发送单个事件
Inngest::send([
    'name' => 'user/signup',
    'data' => [
        'user_id' => $user->id,
        'email' => $user->email,
        'plan' => 'free',
    ],
    'user' => ['id' => $user->id],
]);

// 批量发送事件
Inngest::send([
    [
        'name' => 'user/signup',
        'data' => ['user_id' => 1],
    ],
    [
        'name' => 'analytics/track',
        'data' => ['event' => 'signup', 'user_id' => 1],
    ],
]);
```

在 Laravel 的 Eloquent 模型中集成事件发送：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Inngest\Laravel\Facades\Inngest;

class Order extends Model
{
    protected static function booted(): void
    {
        static::created(function (Order $order) {
            Inngest::send([
                'name' => 'order/created',
                'data' => [
                    'order_id' => $order->id,
                    'user_id' => $order->user_id,
                    'total' => $order->total,
                    'items_count' => $order->items()->count(),
                ],
                'user' => ['id' => $order->user_id],
            ]);
        });

        static::updated(function (Order $order) {
            if ($order->wasChanged('status')) {
                Inngest::send([
                    'name' => 'order/status_changed',
                    'data' => [
                        'order_id' => $order->id,
                        'old_status' => $order->getOriginal('status'),
                        'new_status' => $order->status,
                    ],
                ]);
            }
        });
    }
}
```

### 7.2 Webhook 触发

外部服务可以通过 Inngest 的 Webhook 触发事件。在 Inngest Dashboard 中配置 Webhook 来接收 Stripe、GitHub、Shopify 等服务的回调，然后映射为 Inngest 事件：

```php
// 在 Laravel 路由中接收 Stripe Webhook 并转发给 Inngest
Route::post('/webhooks/stripe', function (Request $request) {
    $payload = $request->all();

    // 验证 Stripe 签名
    $sig = $request->header('Stripe-Signature');
    $event = \Stripe\Webhook::constructEvent(
        $request->getContent(), $sig, config('services.stripe.webhook_secret')
    );

    // 映射为 Inngest 事件
    $inngestEvent = match ($event->type) {
        'checkout.session.completed' => [
            'name' => 'stripe/checkout.completed',
            'data' => $event->data->object,
        ],
        'invoice.payment_failed' => [
            'name' => 'stripe/payment.failed',
            'data' => $event->data->object,
        ],
        'customer.subscription.deleted' => [
            'name' => 'stripe/subscription.cancelled',
            'data' => $event->data->object,
        ],
        default => null,
    };

    if ($inngestEvent) {
        Inngest::send($inngestEvent);
    }

    return response()->json(['received' => true]);
});
```

### 7.3 Cron 定时触发

Inngest 支持 cron 表达式来定时触发函数，无需配置 Laravel Scheduler：

```php
class DailyReportGenerator extends InngestFunction
{
    public static function id(): string
    {
        return 'daily-report-generator';
    }

    public function register(): array
    {
        return [
            'cron' => '0 8 * * *',  // 每天早上 8 点
        ];
    }

    public function handle(array $event, Step $step): mixed
    {
        // 收集昨日数据
        $stats = $step->run('collect-stats', function () {
            return [
                'new_users' => User::whereDate('created_at', yesterday())->count(),
                'orders' => Order::whereDate('created_at', yesterday())->count(),
                'revenue' => Order::whereDate('created_at', yesterday())->sum('total'),
            ];
        });

        // 生成报告
        $report = $step->run('generate-report', function () use ($stats) {
            return ReportGenerator::createDailyReport($stats);
        });

        // 发送报告
        $step->run('send-report', function () use ($report) {
            Mail::to('team@company.com')
                ->send(new DailyReportMail($report));
        });

        return ['report_sent' => true];
    }
}
```

另一个示例——每周清理过期数据：

```php
class WeeklyCleanup extends InngestFunction
{
    public static function id(): string
    {
        return 'weekly-cleanup';
    }

    public function register(): array
    {
        return [
            'cron' => '0 3 * * 0',  // 每周日凌晨 3 点
        ];
    }

    public function handle(array $event, Step $step): mixed
    {
        $deletedSessions = $step->run('cleanup-sessions', function () {
            return Session::where('last_activity', '<', now()->subDays(30))->delete();
        });

        $deletedLogs = $step->run('cleanup-logs', function () {
            return ActivityLog::where('created_at', '<', now()->subDays(90))->delete();
        });

        $deletedTempFiles = $step->run('cleanup-temp-files', function () {
            $files = Storage::files('temp', true);
            $deleted = 0;
            foreach ($files as $file) {
                if (Storage::lastModified($file) < now()->subDays(7)->timestamp) {
                    Storage::delete($file);
                    $deleted++;
                }
            }
            return $deleted;
        });

        return [
            'sessions' => $deletedSessions,
            'logs' => $deletedLogs,
            'files' => $deletedTempFiles,
        ];
    }
}
```

---

## 八、本地开发与测试

### 8.1 Inngest CLI Dev Server

Inngest 提供了一个本地开发服务器，让你无需连接生产环境即可开发和调试函数：

```bash
# 安装 Inngest CLI
brew install inngest/inngest/inngest

# 启动本地开发服务器
inngest dev

# 或者指定你的应用 URL
inngest dev --url http://localhost:8000/api/inngest
```

这会启动一个本地的 Inngest 服务器（默认在 `http://localhost:8288`），你可以在浏览器中查看：
- 所有已注册的函数
- 发送的事件
- 函数执行时间线
- 每一步的输入/输出
- 错误信息和重试状态

在 Laravel 项目中，确保 `.env` 指向本地：

```env
INNGEST_API_URL=http://localhost:8288
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=signkey-test-local
```

### 8.2 单元测试与 Mock

Inngest 函数本质上是普通的 PHP 类，可以用标准的 PHPUnit 测试：

```php
<?php

namespace Tests\Unit\Inngest;

use Tests\TestCase;
use App\Inngest\SendWelcomeEmail;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use App\Mail\WelcomeMail;

class SendWelcomeEmailTest extends TestCase
{
    public function test_it_sends_welcome_email(): void
    {
        $user = User::factory()->create();
        Mail::fake();

        // 创建一个模拟的 Step 对象
        $step = new MockStep();

        $event = [
            'name' => 'user/signup',
            'data' => ['user_id' => $user->id],
        ];

        $fn = new SendWelcomeEmail();
        $result = $fn->handle($event, $step);

        Mail::assertSent(WelcomeEmail::class, function ($mail) use ($user) {
            return $mail->hasTo($user->email);
        });

        $this->assertTrue($result['success']);
    }
}
```

### 8.3 MockStep 辅助类

创建一个测试用的 Mock Step：

```php
<?php

namespace Tests\Helpers;

use Inngest\Step;

class MockStep extends Step
{
    private array $results = [];
    private array $calls = [];

    public function withResult(string $stepName, mixed $result): static
    {
        $this->results[$stepName] = $result;
        return $this;
    }

    public function run(string $name, callable $fn, array $opts = []): mixed
    {
        $this->calls[] = ['type' => 'run', 'name' => $name];

        if (array_key_exists($name, $this->results)) {
            return $this->results[$name];
        }

        return $fn();
    }

    public function sleep(string $name, string $duration): void
    {
        $this->calls[] = ['type' => 'sleep', 'name' => $name, 'duration' => $duration];
    }

    public function sleepUntil(string $name, string $timestamp): void
    {
        $this->calls[] = ['type' => 'sleepUntil', 'name' => $name, 'timestamp' => $timestamp];
    }

    public function waitForEvent(
        string $name,
        string $eventName,
        string $timeout,
        ?string $if = null
    ): ?array {
        $this->calls[] = [
            'type' => 'waitForEvent',
            'name' => $name,
            'event' => $eventName,
        ];
        return $this->results[$name] ?? null;
    }

    public function sendEvent(string $name, array $event): void
    {
        $this->calls[] = ['type' => 'sendEvent', 'name' => $name, 'event' => $event];
    }

    public function getCalls(): array
    {
        return $this->calls;
    }
}
```

### 8.4 集成测试策略

使用 Inngest CLI 的测试模式进行端到端测试：

```php
<?php

namespace Tests\Integration;

use Tests\TestCase;
use Illuminate\Support\Facades\Http;
use Inngest\Laravel\Facades\Inngest;

class OrderPipelineIntegrationTest extends TestCase
{
    public function test_full_order_pipeline(): void
    {
        Http::fake([
            'api.inngest.com/*' => Http::response(['ok' => true]),
            'api.payment.com/*' => Http::response(['id' => 'pay_123', 'status' => 'succeeded']),
        ]);

        $order = Order::factory()->create(['status' => 'pending']);

        // 发送事件触发流程
        Inngest::send([
            'name' => 'order/created',
            'data' => ['order_id' => $order->id],
        ]);

        // 验证订单状态变化
        // 由于 Inngest 是异步的，你需要等待或使用同步测试模式
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'status' => 'pending',
        ]);
    }
}
```

### 8.5 使用 Inngest 的测试助手

```php
<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Inngest\UserOnboardingSequence;

class OnboardingSequenceTest extends TestCase
{
    public function test_onboarding_email_sequence(): void
    {
        $user = User::factory()->create();
        $step = (new MockStep())
            ->withResult('load-user', $user);

        $fn = new UserOnboardingSequence();
        $event = [
            'name' => 'user/signup',
            'data' => ['user_id' => $user->id],
        ];

        $result = $fn->handle($event, $step);

        // 验证执行了正确的步骤
        $calls = $step->getCalls();
        $this->assertEquals('run', $calls[0]['type']);
        $this->assertEquals('load-user', $calls[0]['name']);
        $this->assertEquals('day0-welcome', $calls[1]['name']);
        $this->assertEquals('sleep', $calls[2]['type']);
        $this->assertEquals('wait-day1', $calls[2]['name']);
    }
}
```

---

## 九、与 Laravel Queue / Horizon 的深度对比

### 9.1 架构层面

| 维度 | Laravel Queue + Horizon | Inngest |
|------|------------------------|---------|
| **执行模型** | Worker 进程池轮询队列 | 事件驱动，HTTP 调用 |
| **状态持久化** | Redis/Database 仅存储 Job 状态 | 每个 Step 的输入/输出持久化 |
| **故障恢复** | 整个 Job 重新执行 | 从失败的 Step 恢复 |
| **长时间运行** | 受 `timeout` 和 `maxTries` 限制 | 原生支持数天/数周运行 |
| **步骤编排** | 需手动 Chain Jobs 或 Bus::chain() | 声明式 Step 编排 |
| **等待外部事件** | 需自建（轮询 + Redis Flag） | 原生 `waitForEvent` |
| **可视化** | Horizon Dashboard（队列级） | Inngest Dashboard（步骤级） |

### 9.2 重试机制对比

Laravel Queue 的重试是 **任务级** 的：

```php
class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = 60;

    public function handle(): void
    {
        $this->validateOrder();      // ✓ 成功
        $this->reserveInventory();   // ✓ 成功
        $this->processPayment();     // ❌ 失败！
        $this->createShipment();     // 未执行
    }
}
```

当 `processPayment()` 失败时，Laravel 会重试整个 Job，这意味着 `validateOrder()` 和 `reserveInventory()` 会被重复执行。你需要手动添加幂等性检查。

Inngest 的重试是 **步骤级** 的：

```php
class ProcessOrder extends InngestFunction
{
    public function handle(array $event, Step $step): mixed
    {
        $order = $step->run('validate-order', ...);      // ✓ 已缓存
        $reservation = $step->run('reserve-inventory', ...);  // ✓ 已缓存
        $payment = $step->run('process-payment', ...);    // ❌ 只重试这一步
        $shipment = $step->run('create-shipment', ...);   // 等待 payment 成功
    }
}
```

当 `process-payment` 失败时，Inngest 只重试这一个 Step，其他 Step 直接返回缓存结果。

### 9.3 长时间等待对比

Laravel Queue 实现一个"等待 24 小时后发送提醒邮件"的需求：

```php
// 方案 A：使用延迟队列
SendReminderJob::dispatch($user)->delay(now()->addDay());

// 问题：
// 1. 如果 Worker 在延迟期间重启，Job 可能丢失（取决于驱动）
// 2. 无法在等待期间取消
// 3. 无法在等待期间检查状态
```

```php
// 方案 B：使用数据库 + 调度器
class CheckReminders extends Command
{
    public function handle()
    {
        $pending = Reminder::where('send_at', '<=', now())->get();
        foreach ($pending as $reminder) {
            Mail::to($reminder->email)->send(new ReminderMail($reminder));
            $reminder->update(['sent' => true]);
        }
    }
}

// Schedule:
// $schedule->command('check:reminders')->everyMinute();

// 问题：
// 1. 需要维护额外的数据库表
// 2. 需要定时轮询
// 3. 增加了基础设施复杂度
```

Inngest 的实现：

```php
public function handle(array $event, Step $step): mixed
{
    $user = $step->run('load-user', fn () => User::find($event['data']['user_id']));

    $step->sleep('wait-24h', '24h');  // 一行代码，完美等待

    $step->run('send-reminder', function () use ($user) {
        Mail::to($user->email)->send(new ReminderMail($user));
    });
}

// 优势：
// 1. 无需额外数据库表
// 2. 无需定时轮询
// 3. 状态自动持久化
// 4. Dashboard 可视化等待状态
// 5. 可通过发送事件提前唤醒
```

### 9.4 何时选择哪个？

**选择 Laravel Queue + Horizon**：
- 简单的后台任务（发邮件、生成报表）
- 已有成熟的 Horizon 监控体系
- 团队对 Laravel 生态更熟悉
- 任务间无依赖关系
- 不需要长时间运行的工作流

**选择 Inngest**：
- 多步骤工作流，步骤间有数据依赖
- 需要等待外部事件或人工审批
- 需要步骤级重试和错误处理
- 长时间运行的任务（天/周级别）
- 需要更好的可观测性
- 事件驱动架构

**混合使用**：两者并不互斥。在同一个 Laravel 应用中，简单任务用 Queue，复杂工作流用 Inngest，是完全合理的架构选择。

---

## 十、生产环境部署注意事项

### 10.1 Vercel / Railway 部署

Inngest 的工作原理是通过 HTTP 调用你的函数端点，因此你的应用需要有一个可公开访问的 URL。

**Railway 部署**：

```bash
# railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "php artisan serve --host=0.0.0.0 --port=$PORT"
healthcheckPath = "/api/inngest"
```

确保在 Railway 环境变量中设置：

```env
INNGEST_EVENT_KEY=your_event_key
INNGEST_SIGNING_KEY=signkey-prod-xxxx
INNGEST_ENV=production
```

**Vercel 部署**（使用 Laravel Vapor 或 Vercel PHP Runtime）：

```json
// vercel.json
{
  "routes": [
    { "src": "/api/inngest(.*)", "dest": "/api/inngest" }
  ]
}
```

### 10.2 签名验证（Signing Key）

生产环境 **必须** 启用签名验证，确保只有 Inngest 可以调用你的函数端点。Inngest 使用 HMAC-SHA256 签名每个请求：

```php
// config/inngest.php
return [
    'signing_key' => env('INNGEST_SIGNING_KEY'),
    // 签名验证中间件会自动处理
];
```

Inngest Laravel SDK 会自动验证签名。如果签名无效，请求会被拒绝并返回 401。

如果你需要手动实现签名验证：

```php
class VerifyInngestSignature
{
    public function handle(Request $request, Closure $next)
    {
        $signingKey = config('inngest.signing_key');
        if (!$signingKey) {
            return $next($request);
        }

        $signature = $request->header('x-inngest-signature');
        $timestamp = $request->header('x-inngest-timestamp');
        $body = $request->getContent();

        $expectedSignature = hash_hmac('sha256', "{$timestamp}.{body}", $signingKey);

        if (!hash_equals($expectedSignature, $signature)) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        // 检查时间戳防止重放攻击（5 分钟窗口）
        if (abs(time() - (int)$timestamp) > 300) {
            return response()->json(['error' => 'Request expired'], 401);
        }

        return $next($request);
    }
}
```

### 10.3 并发控制

Inngest 提供了函数级的并发控制，防止你的应用被过多的并发执行压垮：

```php
class ExpensiveOperation extends InngestFunction
{
    public static function config(): array
    {
        return [
            'id' => 'expensive-operation',
            'concurrency' => [
                // 方法 1：简单的并发限制
                'limit' => 5,  // 最多同时运行 5 个

                // 方法 2：按用户限制并发
                // 'limit' => 1,
                // 'key' => "event.user.id",  // 每个用户最多 1 个并发
            ],
        ];
    }

    public function register(): array
    {
        return ['event' => 'data/heavy-process'];
    }

    public function handle(array $event, Step $step): mixed
    {
        // 即使同时发送了 100 个事件，也最多只有 5 个并发执行
        // 其余的会在队列中等待
    }
}
```

### 10.4 Rate Limiting

除了并发控制，你还可以配置速率限制：

```php
class ApiSyncFunction extends InngestFunction
{
    public static function config(): array
    {
        return [
            'id' => 'api-sync',
            'rateLimit' => [
                'limit' => 100,        // 每个窗口最多 100 次执行
                'period' => '1m',      // 1 分钟窗口
                'key' => 'event.data.api_host',  // 按 API 主机限流
            ],
        ];
    }

    public function register(): array
    {
        return ['event' => 'sync/api-call'];
    }

    public function handle(array $event, Step $step): mixed
    {
        // 自动限流：每分钟对每个 API 主机最多 100 次调用
    }
}
```

### 10.5 Lambda / Serverless 部署注意事项

如果你在 AWS Lambda 上运行 Laravel（通过 Bref 或 Vapor），需要注意：

1. **冷启动问题**：函数冷启动时首次调用可能较慢，建议设置合理的超时
2. **执行时间限制**：Lambda 有最大执行时间限制（15 分钟），确保你的单个 Step 不会超时
3. **VPC 配置**：如果 Lambda 在 VPC 中，确保能访问 Inngest API 和你的数据库
4. **并发限制**：注意 Lambda 的并发限制，通过 Inngest 的 concurrency 配置来协调

```php
// 针对 Lambda 环境的函数配置
class LambdaFriendlyFunction extends InngestFunction
{
    public static function config(): array
    {
        return [
            'id' => 'lambda-task',
            'retries' => 3,
            'concurrency' => [
                'limit' => 50,  // 不要超过 Lambda 并发限制
            ],
        ];
    }
}
```

### 10.6 监控与告警

在生产环境中，建议配置以下监控：

```php
// 监控 Inngest 端点的健康状态
Route::get('/health/inngest', function () {
    return response()->json([
        'status' => 'healthy',
        'functions' => Inngest::getRegisteredFunctions()->count(),
        'timestamp' => now()->toIso8601String(),
    ]);
});
```

在 Inngest Dashboard 中配置：
- **函数失败告警**：当某个函数的失败率超过阈值时发送通知
- **DLQ 深度告警**：当 Dead Letter Queue 中的项目数超过阈值时告警
- **执行延迟告警**：当函数执行时间异常增长时告警

### 10.7 安全最佳实践

1. **签名密钥轮换**：定期轮换 Inngest Signing Key
2. **环境隔离**：使用 Inngest 的分支环境（Branch Environments）隔离开发和生产
3. **最小权限**：Event Key 和 Signing Key 分别用于不同的操作
4. **IP 白名单**：如果可能，限制只允许 Inngest 的 IP 范围访问你的函数端点
5. **日志审计**：记录所有 Inngest 函数的调用和执行日志

```php
// .env 生产环境配置
INNGEST_EVENT_KEY=event-prod-xxxx
INNGEST_SIGNING_KEY=signkey-prod-xxxx
INNGEST_ENV=production
```

---

## 十一、高级模式与最佳实践

### 11.1 Fan-Out 模式

一个事件触发多个独立的函数执行：

```php
// 函数 A：用户注册后扇出多个任务
class UserSignupFanOut extends InngestFunction
{
    public static function id(): string { return 'user-signup-fanout'; }

    public function register(): array
    {
        return ['event' => 'user/signup'];
    }

    public function handle(array $event, Step $step): mixed
    {
        $userId = $event['data']['user_id'];

        // 发送多个事件，每个触发独立的函数
        $step->sendEvent('trigger-welcome', [
            'name' => 'user/welcome',
            'data' => ['user_id' => $userId],
        ]);

        $step->sendEvent('trigger-workspace', [
            'name' => 'user/setup-workspace',
            'data' => ['user_id' => $userId],
        ]);

        $step->sendEvent('trigger-analytics', [
            'name' => 'user/analytics-setup',
            'data' => ['user_id' => $userId],
        ]);

        return ['fanned_out' => true];
    }
}
```

### 11.2 Saga 模式（补偿事务）

分布式事务的 Saga 模式在 Inngest 中的实现：

```php
class TransferFundsSaga extends InngestFunction
{
    public static function id(): string { return 'transfer-funds-saga'; }

    public function register(): array
    {
        return ['event' => 'transfer/initiated'];
    }

    public function handle(array $event, Step $step): mixed
    {
        $transfer = $event['data'];

        try {
            // Step 1: 从发送方扣款
            $debitResult = $step->run('debit-sender', function () use ($transfer) {
                return AccountService::debit(
                    $transfer['from_account'],
                    $transfer['amount']
                );
            });

            // Step 2: 向接收方打款
            $creditResult = $step->run('credit-receiver', function () use ($transfer) {
                return AccountService::credit(
                    $transfer['to_account'],
                    $transfer['amount']
                );
            });

            // Step 3: 记录转账完成
            $step->run('record-transfer', function () use ($transfer, $debitResult, $creditResult) {
                Transfer::create([
                    'from' => $transfer['from_account'],
                    'to' => $transfer['to_account'],
                    'amount' => $transfer['amount'],
                    'debit_ref' => $debitResult['ref'],
                    'credit_ref' => $creditResult['ref'],
                    'status' => 'completed',
                ]);
            });

            return ['status' => 'completed'];

        } catch (\Exception $e) {
            // 补偿逻辑
            $step->run('compensation-refund', function () use ($transfer, $e) {
                // 如果扣款成功但打款失败，退款给发送方
                if ($e->getStep() === 'credit-receiver') {
                    AccountService::credit(
                        $transfer['from_account'],
                        $transfer['amount']
                    );
                }
                Transfer::create([
                    'from' => $transfer['from_account'],
                    'to' => $transfer['to_account'],
                    'amount' => $transfer['amount'],
                    'status' => 'compensated',
                    'error' => $e->getMessage(),
                ]);
            });

            return ['status' => 'compensated', 'error' => $e->getMessage()];
        }
    }
}
```

### 11.3 函数版本控制

当你需要更新一个正在运行中的函数时，Inngest 支持平滑版本迁移：

```php
// V1 版本
class ProcessOrderV1 extends InngestFunction
{
    public static function id(): string { return 'process-order'; }
    public static function name(): string { return 'Process Order V1'; }

    public function register(): array { return ['event' => 'order/created']; }

    public function handle(array $event, Step $step): mixed
    {
        // V1 逻辑
    }
}

// V2 版本 - 增加新的步骤
class ProcessOrderV2 extends InngestFunction
{
    public static function id(): string { return 'process-order'; }
    public static function name(): string { return 'Process Order V2'; }

    public function register(): array { return ['event' => 'order/created']; }

    public function handle(array $event, Step $step): mixed
    {
        // V1 逻辑...
        // V2 新增：欺诈检查步骤
        $fraudCheck = $step->run('fraud-check', function () {
            return FraudService::check($this->event['data']);
        });
        // ...
    }
}
```

已运行的 V1 实例会继续使用 V1 逻辑执行完毕，新触发的实例使用 V2 逻辑。

---

## 十二、总结

Inngest 为 PHP/Laravel 生态带来了真正意义上的 Durable Functions 能力。它的核心价值在于：

1. **声明式的工作流编排**：用 `step.run`、`step.sleep`、`step.waitForEvent` 等原语组合出复杂的业务流程，代码即文档。
2. **步骤级的容错能力**：每个 Step 独立持久化、独立重试，故障恢复精准到步骤级别。
3. **原生事件驱动**：天然适配事件驱动架构，函数间通过事件解耦。
4. **极低的集成成本**：几行 Composer 安装 + 路由注册即可上手，无需学习新的基础设施。
5. **出色的开发体验**：本地 CLI、完整的 Dashboard、详细的执行时间线。

对于 Laravel 开发者来说，Inngest 弥补了传统队列系统在 **长时间运行工作流**、**步骤级重试**、**声明式等待** 等方面的不足。它不是要取代 Laravel Queue，而是在 Queue 之上提供了一个更高层次的编排能力。简单任务继续用 Queue + Horizon，复杂工作流交给 Inngest，两者协同构建一个既简单又强大的异步处理体系。

随着 Inngest PHP SDK 的持续迭代和社区的壮大，我们有理由相信，Durable Functions 将成为 PHP 生态中处理复杂异步任务的标准范式。现在正是拥抱这一技术的最佳时机。

---

## 相关阅读

- [Laravel Batch Job 实战：大数据量批量处理的内存治理、分块策略与进度追踪](/posts/Laravel-Batch-Job-实战/) —— 当任务可以拆解为大量独立 Job 时，Bus::batch 与 Horizon 提供了另一种批量编排视角，与 Inngest 的步骤编排形成互补。
- [ETL 实战：Laravel + Apache Airflow 数据管道构建](/posts/ETL-实战-Laravel-Airflow-数据管道构建/) —— 如果你的长时间运行任务更偏向数据工程领域，Airflow 的 DAG 编排与 Inngest 的事件驱动编排各有适用场景，本文做了详细对比。
- [Laravel 数据导入导出实战：Excel/CSV 大文件处理与队列化踩坑记录](/posts/Laravel-数据导入导出实战-Excel-CSV-大文件处理与队列化踩坑记录/) —— 大文件导入导出是典型需要分步处理与重试的场景，了解传统队列方案的痛点有助于理解 Durable Functions 的价值。
