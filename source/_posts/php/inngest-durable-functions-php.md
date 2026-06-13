---
title: "Inngest 实战：Durable Functions for PHP——Laravel 中的持久化工作流、步骤重试与长时间运行任务编排"
date: 2026-06-04 00:00:00
tags: [Inngest, DurableFunctions, PHP, Laravel, 工作流, 任务编排]
categories:
  - php
cover: /images/covers/inngest-durable-functions-php-cover.jpg
description: "Inngest 为 PHP/Laravel 带来了真正的 Durable Functions 能力，彻底改变复杂异步任务的处理方式。本文深入解析 Inngest 的事件驱动持久化工作流架构，涵盖步骤级重试、step.sleep 长时间等待、waitForEvent 外部事件监听等核心 API，并通过用户注册引导、多步骤支付流程、跨系统数据同步等 Laravel 实战案例，演示如何用原生 PHP 代码构建可靠的持久化工作流与任务编排系统，告别手动状态机与脆弱的队列 Job。"
---

在现代 Web 应用开发中，我们经常面临一个核心矛盾：HTTP 请求的生命周期是短暂的，但业务流程的执行往往是长时间、多步骤、且需要容错能力的。从用户注册后的多步引导流程，到跨系统的支付对账，再到需要协调数十个微服务的数据迁移，这些场景都超出了传统请求-响应模型的能力范围。在 Node.js 生态中，Inngest 作为 Durable Functions 的代表方案已经广受好评，而如今，Inngest 正式支持了 PHP/Laravel，为 PHP 开发者带来了同等的持久化工作流能力。本文将从架构原理出发，结合 Laravel 实战，深入探讨如何利用 Inngest 构建可靠的长时间运行任务编排系统。

<!-- more -->

## 一、传统方案的痛点

在深入了解 Inngest 之前，我们先回顾一下 Laravel 中处理复杂异步任务的常见方案及其局限：

### 1.1 Laravel Jobs + Queues

Laravel 的队列系统是最常用的异步处理方案。通过 `dispatch()` 发送 Job 到队列，由 Worker 消费执行。这在简单的"发一封邮件"、"生成一张缩略图"等场景下表现优秀，但一旦涉及多步骤工作流，问题就暴露了：

```php
// ❌ 多步骤工作流的脆弱实现
class OnboardingJob implements ShouldQueue
{
    public function handle()
    {
        $this->createWorkspace();       // 步骤 1：如果失败呢？
        $this->inviteTeamMembers();     // 步骤 2：需要步骤 1 的结果
        $this->sendWelcomeEmail();      // 步骤 3：如果步骤 2 间歇性失败呢？
        $this->generateSampleData();    // 步骤 4：需要等待外部 API 回调
    }
}
```

这种实现存在几个致命问题：

- **没有步骤级重试**：Job 整体重试意味着已完成的步骤会被重复执行
- **无法等待外部事件**：如果"邀请团队成员"需要等待用户确认，Job 无法"暂停"
- **状态管理困难**：需要手动在数据库中追踪每个步骤的执行状态
- **超时限制**：PHP 的 `max_execution_time` 和队列 Worker 的超时配置限制了执行时长

### 1.2 手动状态机

面对上述问题，一些团队选择在数据库中手动实现状态机：

```php
// 手动状态机的维护噩梦
$workflow = WorkflowState::create([
    'current_step' => 'invite_team',
    'status' => 'waiting_confirmation',
    'context' => json_encode(['workspace_id' => $ws->id]),
]);

// 然后在各处监听状态变化...
// 定时任务检查超时...
// 手动处理重试逻辑...
```

这种方式的问题在于：代码分散在多个地方、状态转换容易出错、维护成本随复杂度指数增长。

### 1.3 AWS Step Functions

AWS Step Functions 提供了基于状态机的可视化工作流编排，理论上是解决这类问题的成熟方案。但对于 PHP/Laravel 项目来说，引入 Step Functions 意味着：

- 需要学习 AWS 独有的状态机定义语言（ASL）
- 每个步骤需要是独立的 Lambda 函数，增加了部署复杂度
- 本地开发和调试体验差
- 与 Laravel 生态的集成需要大量胶水代码

Inngest 的出现，正是为了在不离开 PHP/Laravel 生态的前提下，提供与 Step Functions 同等级别的持久化工作流能力。

## 二、Inngest 架构原理：事件驱动的持久化执行

Inngest 的核心设计理念是 **Event-Driven Durable Execution（事件驱动的持久化执行）**。理解这一模型是正确使用 Inngest 的关键。

### 2.1 核心架构

Inngest 的架构由三个核心组件组成：

1. **Inngest 云平台（Inngest Platform）**：负责事件存储、调度、状态管理和监控
2. **SDK（inngest/laravel）**：嵌入到你的 Laravel 应用中，提供函数定义和执行框架
3. **你的应用服务器**：通过 HTTP 端点接收 Inngest 的执行指令

工作流程如下：

```
[事件源] --> [Inngest 云平台] --> [HTTP 调用你的 Laravel 应用]
    |              |                         |
    |         事件存储/状态                   |
    |         调度/重试                       |
    |              |                         |
    v              v                         v
 发送事件 --> 持久化执行计划 --> SDK 指导函数逐步执行
```

关键洞察在于：**Inngest 不是在你的服务器上运行代码，而是在你的服务器上"重放"代码**。当一个函数执行到 `step.run()` 时，SDK 会将该步骤的执行结果发送回 Inngest 平台存储。如果函数需要继续执行，Inngest 会发起一个新的 HTTP 请求，SDK 通过检查已存储的步骤结果来"快进"已完成的步骤，直接跳到下一个待执行步骤。

### 2.2 重放机制（Replay Mechanism）

这是理解 Inngest 的关键概念。假设一个函数有 5 个步骤：

```
步骤 1: run(createWorkspace) → 结果存入 Inngest
步骤 2: run(inviteTeam)      → 结果存入 Inngest
步骤 3: sleep(24h)           → 24 小时后触发新请求
步骤 4: run(sendReport)      → 这次执行时，步骤 1-3 从缓存中恢复
步骤 5: run(notifyAdmin)     → 继续执行
```

每次 Inngest 向你的应用发送执行请求时，请求中携带了之前所有步骤的缓存结果。SDK 在执行函数时，遇到已完成的步骤会直接返回缓存结果，而不重新执行。这就是为什么即使进程重启、服务器宕机，工作流也不会丢失——因为所有状态都持久化在 Inngest 平台中。

### 2.3 与传统队列的本质区别

| 特性 | Laravel Queues | Inngest |
|------|---------------|---------|
| 执行单位 | 整个 Job | 单个步骤（step） |
| 重试粒度 | Job 级别 | 步骤级别 |
| 状态持久化 | 需要自行实现 | 内建 |
| 等待外部事件 | 不支持 | `step.waitForEvent()` |
| 定时等待 | 需要 `delay` | `step.sleep()` 任意时长 |
| 可观测性 | 需要额外工具 | 内建 Dashboard |

## 三、Laravel 集成实战

### 3.1 环境准备与 SDK 安装

首先通过 Composer 安装 Inngest 的 Laravel SDK：

```bash
composer require inngest/laravel
```

该 SDK 会自动注册服务提供者和路由。安装完成后，发布配置文件：

```bash
php artisan vendor:publish --provider="Inngest\Laravel\InngestServiceProvider"
```

这会在 `config/inngest.php` 中生成配置文件：

```php
<?php

return [
    // Inngest 签名密钥，用于验证来自 Inngest 平台的请求
    'signing_key' => env('INNGEST_SIGNING_KEY'),

    // 事件密钥，用于发送事件到 Inngest
    'event_key' => env('INNGEST_EVENT_KEY'),

    // 应用环境标识
    'env' => env('INNGEST_ENV', env('APP_ENV')),

    // 是否自动注册路由
    'serve' => true,

    // 函数注册路径
    'functions_path' => base_path('app/Inngest'),
];
```

在 `.env` 中配置密钥：

```env
INNGEST_SIGNING_KEY=signkey-prod-xxxxxxxxxxxxxxx
INNGEST_EVENT_KEY=evt_xxxxxxxxxxxxxxxxx
```

这些密钥从 [Inngest 控制台](https://app.inngest.com) 的设置页面获取。

### 3.2 定义你的第一个 Inngest Function

在 `app/Inngest` 目录下创建函数类：

```php
<?php

namespace App\Inngest;

use Inngest\Inngest;
use Inngest\Step;

class UserOnboarding
{
    /**
     * Inngest 函数标识，格式为应用名-函数名
     */
    public string $id = 'myapp-user-onboarding';

    /**
     * 触发该函数的事件名称
     */
    public array $triggers = [
        ['event' => 'user.registered'],
    ];

    /**
     * 函数执行逻辑
     */
    public function handle(Inngest $client, Step $step, array $event): void
    {
        $userId = $event['data']['user_id'];

        // 步骤 1：创建用户工作区
        $workspace = $step->run('create-workspace', function () use ($userId) {
            return Workspace::createForUser($userId);
        });

        // 步骤 2：发送欢迎邮件
        $step->run('send-welcome-email', function () use ($userId, $workspace) {
            Mail::to(User::find($userId))->send(new WelcomeMail($workspace));
            return ['sent' => true];
        });

        // 步骤 3：等待 24 小时后发送跟进邮件
        $step->sleep('wait-24h', '24h');

        // 步骤 4：24 小时后发送跟进邮件
        $step->run('send-follow-up', function () use ($userId) {
            $user = User::find($userId);
            if ($user->profile_completed_at === null) {
                Mail::to($user)->send(new FollowUpMail());
            }
            return ['sent' => true];
        });
    }
}
```

这里有几个重要的设计细节：

- `$id` 是函数的全局唯一标识，一旦确定不应更改（否则会被视为新函数）
- `$triggers` 定义了触发条件，这里监听 `user.registered` 事件
- `handle()` 方法接收三个参数：Inngest 客户端、Step 对象、触发事件的完整数据
- 每个 `$step->run()` 都是一个独立的、可重试的步骤

### 3.3 发送事件

在 Laravel 代码中发送事件到 Inngest，通常在控制器或事件监听器中完成：

```php
<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Inngest\Laravel\Facades\Inngest;

class RegisterController extends Controller
{
    public function store(Request $request)
    {
        $user = User::create($request->validated());

        // 发送事件到 Inngest，触发 onboarding 工作流
        Inngest::send([
            'name' => 'user.registered',
            'data' => [
                'user_id' => $user->id,
                'email' => $user->email,
                'registered_at' => now()->toISOString(),
            ],
        ]);

        return response()->json(['user' => $user], 201);
    }
}
```

事件数据遵循 CloudEvents 规范的子集，`name` 和 `data` 是必需字段，还可以包含 `id`、`ts`（时间戳）、`user` 等可选字段。

### 3.4 本地开发与 serve 模式

Inngest 提供了一个优雅的本地开发方案。在开发时，你需要运行 `inngest dev` 命令启动本地 Inngest 服务：

```bash
# 终端 1：启动 Laravel 开发服务器
php artisan serve

# 终端 2：启动 Inngest 开发模式
npx inngest-cli@latest dev
```

`inngest dev` 会启动一个本地的 Inngest 平台，自动发现你 Laravel 应用中的所有 Inngest 函数，并提供一个本地 Dashboard 用于查看事件和函数执行状态。你可以在 `http://localhost:8288` 访问本地 Dashboard。

在本地开发环境中，你不需要配置 `INNGEST_SIGNING_KEY` 和 `INNGEST_EVENT_KEY`，SDK 会自动使用本地模式。

## 四、核心 API 深入解析

### 4.1 `step.run()` —— 可重试的步骤执行

`step.run()` 是最基础的原语，它将一段代码包装为一个独立的、可重试的步骤：

```php
$step->run('create-payment', function () use ($order) {
    // 这段代码会被独立执行和重试
    $payment = PaymentGateway::create([
        'amount' => $order->total,
        'currency' => 'USD',
    ]);

    return [
        'payment_id' => $payment->id,
        'status' => $payment->status,
    ];
});
```

`step.run()` 的返回值会被 Inngest 平台持久化存储。后续步骤可以通过变量访问这个返回值：

```php
$payment = $step->run('create-payment', fn () => createPayment($order));

// 在后续步骤中使用
$step->run('update-order', function () use ($order, $payment) {
    $order->update(['payment_id' => $payment['payment_id']]);
});
```

### 4.2 `step.sleep()` —— 持久化等待

`step.sleep()` 让函数暂停执行指定的时间。这是传统 PHP 所不具备的能力：

```php
// 支持多种时间格式
$step->sleep('wait-a-bit', '30s');      // 30 秒
$step->sleep('wait-a-while', '2h');     // 2 小时
$step->sleep('wait-tomorrow', '1d');    // 1 天
$step->sleep('wait-next-week', '7d');   // 7 天

// 也可以使用 DateTime 对象
$step->sleepUntil('wait-until-midnight', Carbon::tomorrow());
```

`step.sleep()` 不会阻塞你的服务器进程。当函数执行到 `sleep()` 时，Inngest 平台记录下"需要在 X 时间后继续"，然后释放当前的 HTTP 请求。到达指定时间后，Inngest 会发起新的请求，SDK 通过重放机制快进到 sleep 之后的步骤。

这种机制使得 PHP 能够实现**数天、数周甚至数月的长时间工作流**，完全不受 PHP 进程超时的限制。

### 4.3 `step.waitForEvent()` —— 等待外部事件

这是 Inngest 最强大的原语之一。它让函数暂停执行，等待一个特定的外部事件发生：

```php
public function handle(Inngest $client, Step $step, array $event): void
{
    $userId = $event['data']['user_id'];

    // 步骤 1：发送邀请
    $step->run('send-invite', function () use ($userId) {
        InvitationService::sendTeamInvite($userId);
    });

    // 步骤 2：等待用户接受邀请的事件（最多等 7 天）
    $acceptance = $step->waitForEvent(
        'wait-for-acceptance',
        'user.invite_accepted',
        [
            'match' => 'data.user_id',  // 只接受匹配 user_id 的事件
            'timeout' => '7d',           // 超时时间
        ]
    );

    // 步骤 3：检查是否超时
    if ($acceptance === null) {
        // 超时：发送提醒邮件
        $step->run('send-reminder', function () use ($userId) {
            Mail::to(User::find($userId))->send(new InviteReminderMail());
        });
        return;
    }

    // 步骤 4：用户已接受，继续初始化
    $step->run('init-team', function () use ($userId) {
        TeamSetup::initialize(User::find($userId));
    });
}
```

`match` 参数是一个强大的特性：它指定了等待事件中哪个字段需要与触发事件匹配。这里 `data.user_id` 意味着只有当 `user.invite_accepted` 事件的 `data.user_id` 与原始 `user.registered` 事件的 `data.user_id` 相同时，才会被接受。这确保了函数不会被其他用户的事件错误触发。

### 4.4 `step.sendEvent()` —— 步骤中发送事件

有时你需要在步骤中发送事件来触发其他函数或实现跨函数通信：

```php
$step->run('process-payment', function () use ($order) {
    $result = PaymentGateway::charge($order);
    return $result;
});

// 在步骤中发送事件，触发另一个 Inngest 函数
$step->sendEvent('trigger-invoice', [
    'name' => 'invoice.generate',
    'data' => [
        'order_id' => $order->id,
        'payment_id' => $payment['id'],
    ],
]);
```

## 五、错误处理与重试策略

### 5.1 默认重试行为

Inngest 默认为每个步骤配置了指数退避重试策略：最多重试 **4 次**，间隔从 1 秒开始，逐步增长到 1 分钟左右。当步骤抛出异常时，Inngest 会自动按照策略重试该步骤，而不影响已完成的步骤。

```php
$step->run('call-external-api', function () {
    // 如果这里抛出异常，Inngest 会自动重试最多 4 次
    return Http::post('https://api.example.com/process', [...]);
});
```

### 5.2 自定义重试策略

你可以通过函数级别的配置自定义重试行为：

```php
class PaymentFlow
{
    public string $id = 'myapp-payment-flow';

    public array $triggers = [
        ['event' => 'order.placed'],
    ];

    /**
     * 自定义重试配置
     */
    public array $retries = [
        'maxAttempts' => 5,
    ];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        // 整个函数使用最多 5 次重试
    }
}
```

对于更精细的控制，可以在特定步骤中使用 `step.run()` 配合 `step.retry()` 来定义步骤级别的重试策略：

```php
// 对于关键步骤，使用更激进的重试策略
$payment = $step->run('charge-card', function () use ($order) {
    return PaymentGateway::charge($order);
}, [
    'retries' => [
        'maxAttempts' => 8,
    ],
]);
```

### 5.3 死信模式（Dead Letter Pattern）

当一个函数的所有重试都失败后，该函数的执行会进入"失败"状态。在 Inngest Dashboard 中，你可以看到所有失败的函数执行及其详细错误信息和重试历史。

对于需要"人工干预"的场景，可以结合 `step.waitForEvent()` 实现死信队列的效果：

```php
public function handle(Inngest $client, Step $step, array $event): void
{
    try {
        $result = $step->run('critical-operation', function () {
            return $this->doCriticalWork();
        });
    } catch (\Throwable $e) {
        // 通知人工介入
        $step->run('alert-operator', function () use ($event, $e) {
            NotificationService::sendAlert([
                'type' => 'workflow_failed',
                'function' => 'critical-operation',
                'event' => $event,
                'error' => $e->getMessage(),
            ]);
        });

        // 发送死信事件
        $step->sendEvent('dead-letter', [
            'name' => 'workflow.dead_letter',
            'data' => [
                'original_event' => $event,
                'error' => $e->getMessage(),
                'failed_at' => now()->toISOString(),
            ],
        ]);
    }
}
```

你还可以监听 `inngest/function.failed` 这个内置事件来集中处理所有失败的函数：

```php
class HandleFailedFunctions
{
    public string $id = 'myapp-handle-failures';

    public array $triggers = [
        ['event' => 'inngest/function.failed'],
    ];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $functionId = $event['data']['function_id'];
        $error = $event['data']['error'];

        $step->run('log-failure', function () use ($functionId, $error) {
            Log::critical("Inngest function failed: {$functionId}", [
                'error' => $error,
            ]);
        });
    }
}
```

## 六、实战案例

### 6.1 多步骤支付流程

一个典型的电商支付流程，涉及创建订单、扣款、发货、通知等多个步骤：

```php
class ProcessOrder
{
    public string $id = 'myapp-process-order';

    public array $triggers = [
        ['event' => 'order.placed'],
    ];

    public array $retries = ['maxAttempts' => 5];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $orderData = $event['data'];

        // 步骤 1：验证库存
        $step->run('validate-inventory', function () use ($orderData) {
            foreach ($orderData['items'] as $item) {
                $product = Product::find($item['product_id']);
                if ($product->stock < $item['quantity']) {
                    throw new InsufficientStockException($product->id);
                }
            }
            return ['validated' => true];
        });

        // 步骤 2：扣款
        $payment = $step->run('charge-payment', function () use ($orderData) {
            return PaymentService::charge($orderData['user_id'], $orderData['total']);
        });

        // 步骤 3：确认订单
        $step->run('confirm-order', function () use ($orderData, $payment) {
            Order::where('id', $orderData['order_id'])->update([
                'status' => 'confirmed',
                'payment_id' => $payment['payment_id'],
            ]);
        });

        // 步骤 4：等待发货确认（最多等 3 天）
        $shipment = $step->waitForEvent(
            'wait-shipment',
            'order.shipped',
            [
                'match' => 'data.order_id',
                'timeout' => '3d',
            ]
        );

        if ($shipment === null) {
            // 步骤 5a：超时，发出警告
            $step->run('alert-shipment-delay', function () use ($orderData) {
                NotificationService::alertShippingDelay($orderData['order_id']);
            });
            return;
        }

        // 步骤 5b：发货确认，通知客户
        $step->run('notify-customer', function () use ($orderData, $shipment) {
            User::find($orderData['user_id'])->notify(
                new OrderShippedNotification($orderData['order_id'], $shipment['data']['tracking_number'])
            );
        });

        // 步骤 6：等待 7 天后检查是否需要请求评价
        $step->sleep('wait-for-delivery', '7d');

        $step->run('request-review', function () use ($orderData) {
            Mail::to(User::find($orderData['user_id']))->send(
                new ReviewRequestMail($orderData['order_id'])
            );
        });
    }
}
```

这个工作流展示了 Inngest 的核心优势：步骤级重试（库存验证失败不影响已扣款）、等待外部事件（等待发货）、长时间睡眠（7 天后请求评价）——所有这些都在一个清晰的、线性的代码结构中完成。

### 6.2 跨系统数据同步

在企业应用中，经常需要将数据从一个系统同步到另一个系统，涉及轮询、批量处理、错误恢复等逻辑：

```php
class DataSyncWorkflow
{
    public string $id = 'myapp-data-sync';

    public array $triggers = [
        ['event' => 'sync.requested'],
    ];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $syncId = $event['data']['sync_id'];
        $batchSize = 100;
        $cursor = null;

        // 步骤 1：获取总数和初始化
        $meta = $step->run('init-sync', function () use ($syncId) {
            $total = ExternalApi::getTotalRecords();
            SyncJob::create(['sync_id' => $syncId, 'total' => $total, 'processed' => 0]);
            return ['total' => $total];
        });

        $totalRecords = $meta['total'];
        $batches = ceil($totalRecords / $batchSize);

        // 步骤 2：逐批同步
        for ($i = 0; $i < $batches; $i++) {
            $step->run("sync-batch-{$i}", function () use ($syncId, $batchSize, $cursor, $i) {
                $offset = $i * $batchSize;
                $records = ExternalApi::fetchBatch($offset, $batchSize);

                foreach ($records as $record) {
                    LocalRecord::upsert($record, ['external_id']);
                }

                SyncJob::where('sync_id', $syncId)->increment('processed', count($records));

                return ['processed' => $offset + count($records)];
            });

            // 每批次之间暂停，避免对目标系统造成压力
            $step->sleep("pause-batch-{$i}", '10s');
        }

        // 步骤 3：完成同步
        $step->run('finalize-sync', function () use ($syncId) {
            SyncJob::where('sync_id', $syncId)->update(['status' => 'completed']);
        });
    }
}
```

### 6.3 定时报告生成

利用 Inngest 的 Cron 功能，可以实现复杂的时间驱动工作流：

```php
class WeeklyReport
{
    public string $id = 'myapp-weekly-report';

    public array $triggers = [
        ['cron' => '0 9 * * 1'],  // 每周一早上 9 点
    ];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        // 步骤 1：收集数据
        $data = $step->run('collect-data', function () {
            return [
                'users' => User::where('created_at', '>=', now()->subWeek())->count(),
                'orders' => Order::where('created_at', '>=', now()->subWeek())->count(),
                'revenue' => Order::where('created_at', '>=', now()->subWeek())->sum('total'),
            ];
        });

        // 步骤 2：生成报告
        $reportPath = $step->run('generate-report', function () use ($data) {
            $pdf = ReportGenerator::create($data);
            $path = Storage::put('reports/weekly-' . now()->format('Y-m-d') . '.pdf', $pdf);
            return ['path' => $path];
        });

        // 步骤 3：发送给管理层
        $step->run('distribute-report', function () use ($reportPath) {
            $managers = User::where('role', 'manager')->get();
            foreach ($managers as $manager) {
                Mail::to($manager)->send(new WeeklyReportMail($reportPath['path']));
            }
        });
    }
}
```

## 七、与同类方案的对比分析

### 7.1 Inngest vs Laravel Queues

| 维度 | Laravel Queues | Inngest |
|------|---------------|---------|
| 适用场景 | 简单的异步任务 | 复杂的多步骤工作流 |
| 重试机制 | Job 级别，简单指数退避 | 步骤级别，可自定义策略 |
| 状态管理 | 需要自行实现 | 内建持久化状态 |
| 长时间等待 | 不支持（需轮询） | 原生支持 sleep 和 waitForEvent |
| 调度 | 依赖 cron 或 Horizon | 内建 cron 支持 |
| 运维复杂度 | 需要管理 Worker 进程 | 无服务器模式，无需运维 |
| 学习成本 | 低（Laravel 原生） | 中（需理解新概念） |

**建议**：简单任务（发邮件、处理图片）继续使用 Laravel Queues。当涉及多步骤工作流、需要等待外部事件、或需要长时间运行时，考虑迁移到 Inngest。

### 7.2 Inngest vs AWS Step Functions

| 维度 | AWS Step Functions | Inngest |
|------|-------------------|---------|
| 开发语言 | JSON 状态机定义 | 原生 PHP 代码 |
| 本地开发 | 需要 SAM/LocalStack | 内建 `inngest dev` |
| 代码版本控制 | 状态机定义文件 | 与应用代码一致 |
| 与 Laravel 集成 | 需要 Lambda + API Gateway | 原生 SDK |
| 可视化 | AWS Console | Inngest Dashboard |
| 定价 | 按状态转换计费 | 按函数执行计费 |
| 运维依赖 | AWS 生态 | 语言无关的 SaaS |

**建议**：如果你的团队已经深度使用 AWS 生态且需要与 AWS 服务紧密集成，Step Functions 是合理选择。对于 Laravel 项目，Inngest 提供了更好的开发体验。

### 7.3 Inngest vs Temporal.io

| 维度 | Temporal.io | Inngest |
|------|------------|---------|
| 部署模式 | 自托管或 Temporal Cloud | 纯 SaaS |
| 运维成本 | 高（需要管理 Worker + 历史服务） | 低 |
| 语言支持 | Go、Java、TypeScript、Python、PHP（社区） | 原生 PHP SDK |
| 成熟度 | 高（源于 Cadence/Uber） | 相对较新 |
| 灵活性 | 极高（复杂编排、信号、查询） | 中高 |
| 学习曲线 | 陡峭 | 平缓 |

**建议**：大型企业、高吞吐量场景、需要极致灵活性时考虑 Temporal。中小型项目、快速迭代、最小化运维开销时选择 Inngest。

## 八、可观测性与监控

### 8.1 Inngest Dashboard

Inngest 提供了功能完善的云 Dashboard，包含以下核心视图：

- **Functions 列表**：所有注册的函数及其最近执行状态
- **Runs 详情**：单次函数执行的完整步骤时间线，包括每个步骤的输入、输出、耗时
- **Events 流**：实时查看进入系统的事件流
- **Failures**：所有失败的执行及其错误详情和重试历史

### 8.2 日志集成

在 Laravel 中，你可以结合 Inngest 的步骤与 Laravel 的日志系统：

```php
$step->run('process-data', function () use ($data) {
    Log::info('Inngest: Processing data batch', [
        'batch_size' => count($data),
        'function' => 'data-processing',
    ]);

    $result = $this->processBatch($data);

    Log::info('Inngest: Data batch processed', [
        'results' => $result,
    ]);

    return $result;
});
```

### 8.3 自定义监控

Inngest 支持通过 Webhook 将函数执行状态推送到外部监控系统：

```php
class InngestHealthCheck
{
    public string $id = 'myapp-inngest-health';

    public array $triggers = [
        ['event' => 'inngest/function.finished'],
    ];

    public function handle(Inngest $client, Step $step, array $event): void
    {
        $functionId = $event['data']['function_id'];
        $duration = $event['data']['duration_ms'];

        $step->run('report-metrics', function () use ($functionId, $duration) {
            // 推送到 Prometheus、DataDog 等监控系统
            Metrics::gauge('inngest.function.duration', $duration, [
                'function' => $functionId,
            ]);
        });
    }
}
```

## 九、生产环境最佳实践

### 9.1 函数设计原则

1. **单一职责**：每个函数只负责一个业务流程，避免在一个函数中处理不相关的逻辑
2. **幂等设计**：由于重试机制，每个步骤可能被多次执行，确保步骤的幂等性
3. **最小化数据传递**：只在步骤间传递必要的数据，避免传递大量数据增加网络开销
4. **合理使用 `waitForEvent`**：确保 `match` 参数正确配置，避免函数被错误事件触发

### 9.2 步骤幂等性

```php
// ✅ 好的做法：使用唯一键确保幂等
$step->run('create-payment', function () use ($order) {
    $existing = Payment::where('order_id', $order->id)->first();
    if ($existing) {
        return $existing->toArray();  // 返回已有记录
    }

    return Payment::create([
        'order_id' => $order->id,
        'amount' => $order->total,
    ])->toArray();
});

// ❌ 糟糕的做法：重复创建记录
$step->run('create-payment', function () use ($order) {
    return Payment::create(['order_id' => $order->id, 'amount' => $order->total]);
});
```

### 9.3 安全性考虑

Inngest 使用签名密钥验证来自平台的请求，防止伪造。确保：

- 签名密钥存储在环境变量中，不提交到代码仓库
- 在生产环境中使用独立的密钥
- 定期轮换密钥

### 9.4 部署策略

Inngest 函数与你的 Laravel 应用一起部署，无需额外的部署步骤。当你推送新代码时，Inngest 会自动检测函数的变化。需要注意的是：

- **函数 ID 不要更改**：更改 ID 会导致 Inngest 将其视为新函数，正在进行的执行会失败
- **渐进式修改**：如果需要修改正在运行的函数逻辑，确保新代码向后兼容
- **使用 `inngest dev` 测试**：在部署到生产环境前，确保在本地测试通过

## 十、性能与成本考量

### 10.1 性能特征

Inngest 的重放机制意味着每次步骤执行都需要一次 HTTP 请求/响应。对于有 N 个步骤的函数，完整执行需要 N 次 HTTP 往返。在大多数场景下这不是问题，但对于需要极低延迟的场景（毫秒级），传统的进程内执行可能更合适。

### 10.2 成本模型

Inngest 采用基于函数执行次数的定价模型。免费计划提供了每月一定数量的函数执行额度。在评估成本时，需要考虑：

- 每个 `step.run()`、`step.sleep()`、`step.waitForEvent()` 都是一次执行
- 重试也算执行次数
- 长时间睡眠后的唤醒算一次执行

### 10.3 优化建议

- **合并相关操作**：将多个紧密相关的操作合并到一个 `step.run()` 中，减少步骤数量
- **合理设置重试次数**：对于不可恢复的错误（如数据验证失败），立即抛出不可重试的异常
- **利用 `sleep` 替代轮询**：使用 `step.sleep()` 替代数据库轮询，减少数据库压力

## 十一、总结

Inngest 为 PHP/Laravel 生态带来了真正意义上的 Durable Functions 能力。它的核心价值在于：

1. **将复杂性内化**：将状态管理、重试机制、长时间等待等复杂逻辑从应用代码中移除，由平台统一管理
2. **保持开发体验**：开发者使用原生 PHP 代码定义工作流，无需学习新的 DSL 或状态机语言
3. **渐进式采用**：可以从一个简单的多步骤工作流开始，逐步扩展到更复杂的场景
4. **生产就绪**：内建的监控、重试、错误处理机制让你的代码更加健壮

对于 Laravel 开发者来说，Inngest 填补了 Laravel Queues 与 AWS Step Functions/Temporal.io 之间的空白。当你发现自己在 Laravel Jobs 中编写了大量的状态管理、错误恢复、和轮询逻辑时，可能就是引入 Inngest 的最佳时机。

从今天开始，尝试将你最复杂的一个异步任务重构为 Inngest 函数，亲身体验持久化工作流带来的开发效率提升和代码可维护性改善。你的队列 Worker 会感谢你的。

## 相关阅读

- [重试与退避策略实战：Exponential Backoff、Jitter 与 Laravel HTTP Client 韧性设计模式](/posts/05_PHP/Laravel/重试与退避策略实战-Exponential-Backoff-Jitter-Laravel-HTTP-Client韧性设计模式/)
- [Laravel Action Pattern 实战](/posts/05_PHP/Laravel/Laravel-Action-Pattern-实战/)
- [Device Authorization Flow 与 Laravel Passport 实战](/posts/05_PHP/Laravel/device-authorization-flow-laravel-passport/)
