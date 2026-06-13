---
title: Laravel Context 实战进阶：请求级上下文的全链路透传——HTTP → Queue → Event → Notification 的 Correlation ID 治理
keywords: [Laravel Context, HTTP, Queue, Event, Notification, Correlation ID, 实战进阶, 请求级上下文的全链路透传, 治理, 架构]
date: 2026-06-10 01:11:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Context
  - CorrelationID
  - 可观测性
  - 全链路追踪
description: 深入 Laravel Context 的全链路透传机制，实战 Correlation ID 在 HTTP、Queue、Event、Notification 四个阶段的自动传递与治理，解决分布式系统中"日志对不上号"的痛点。
---


## 前言

在微服务和异步处理盛行的今天，一条用户请求可能经过 HTTP 入口 → 事件派发 → 队列消费 → 通知发送的完整链路。当线上出问题时，最头疼的事情莫过于：**日志散落在各个阶段，根本串不起来。**

Laravel 11 的 `Context` facade 提供了原生的请求级上下文透传能力，但官方文档点到为止，真正要在生产中用好，还有很多坑和细节。本文将从实战角度，完整演示 Correlation ID 在 HTTP → Queue → Event → Notification 四个阶段的自动传递方案。

## 核心概念：什么是请求级上下文

请求级上下文（Request-scoped Context）是指在一次用户请求的整个生命周期中，携带的元数据集合。典型的上下文信息包括：

- **Correlation ID**：唯一标识一次请求的 UUID
- **User ID**：当前操作用户
- **Tenant ID**：多租户场景下的租户标识
- **Trace ID**：OpenTelemetry 的分布式追踪 ID
- **自定义标签**：如 `source=mobile`、`env=staging`

核心目标：**任何一个阶段产生的日志，都能通过同一个 ID 串联起来。**

## Laravel Context 基础回顾

Laravel 11 引入了 `Context` facade，替代了之前 `Spatie\LaravelContext` 等第三方包：

```php
use Illuminate\Support\Facades\Context;

// 写入上下文
Context::add('correlation_id', $id);
Context::add('user_id', $user->id);

// 读取上下文
$correlationId = Context::get('correlation_id');

// 追加（不覆盖）
Context::push('tags', 'important');

// 获取所有上下文
$all = Context::all();

// 清空
Context::flush();
```

关键点：**Context 的数据存储在 `Illuminate\Support\Fluent` 实例中，通过 `ContextManager` 管理，底层使用 `Spatie\LaravelMacroable\Macroable` trait，支持自定义存储驱动。**

## 实战一：HTTP 阶段——Correlation ID 的生成与注入

### 中间件生成 Correlation ID

```php
// app/Http/Middleware/CorrelationIdMiddleware.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class CorrelationIdMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // 优先使用客户端传入的 ID，否则生成新的
        $correlationId = $request->header('X-Correlation-ID')
            ?? $request->input('correlation_id')
            ?? Str::uuid()->toString();

        // 写入 Context
        Context::add('correlation_id', $correlationId);
        Context::add('user_id', $request->user()?->id);
        Context::add('request_path', $request->path());
        Context::add('request_method', $request->method());

        // 响应头也带上，方便前端排查
        $response = $next($request);
        $response->headers->set('X-Correlation-ID', $correlationId);

        return $response;
    }
}
```

注册中间件（`bootstrap/app.php`）：

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->prepend(\App\Http\Middleware\CorrelationIdMiddleware::class);
})
```

### 日志自动附加上下文

Laravel 的日志系统已经原生支持 Context 附加。只要 Context 里有数据，日志自动带上：

```php
// 直接写日志，Context 数据会自动附加
Log::info('Order created', ['order_id' => $order->id]);

// 输出效果：
// [2026-06-10 01:00:00] local.INFO: Order created {"order_id":42}
// {"correlation_id":"550e8400-e29b-41d4-a716-446655440000","user_id":1,"request_path":"api/orders","request_method":"POST"}
```

## 实战二：Queue 阶段——异步任务的上下文透传

这是最容易断链的地方。默认情况下，`dispatch()` 派发的异步任务**不会**继承当前的 Context。

### 方案一：手动传递（最可靠）

```php
// 手动把 Context 数据传给 Job
$contextData = Context::all();

dispatch(new ProcessOrder($order, $contextData));
```

Job 内部恢复：

```php
// app/Jobs/ProcessOrder.php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Log;

class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public Order $order,
        public array $contextData = [],
    ) {}

    public function handle(): void
    {
        // 恢复 Context
        Context::add($this->contextData);

        Log::info('Processing order', ['order_id' => $this->order->id]);
        // 日志会自动带上 correlation_id
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('Order processing failed', [
            'order_id' => $this->order->id,
            'error' => $exception->getMessage(),
        ]);
    }
}
```

### 方案二：Queueable trait 自动透传（推荐）

更优雅的做法是通过 Job 的 `withContext` 方法或自定义 trait：

```php
// app/Concerns/AutoContext.php
<?php

namespace App\Concerns;

use Illuminate\Support\Facades\Context;

trait AutoContext
{
    protected array $savedContext = [];

    public function saveContext(): void
    {
        $this->savedContext = Context::all();
    }

    public function restoreContext(): void
    {
        Context::flush();
        Context::add($this->savedContext);
    }
}
```

在 Job 中使用：

```php
class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, AutoContext;

    public function __construct(
        public Order $order,
    ) {
        $this->saveContext(); // 构造时保存
    }

    public function handle(): void
    {
        $this->restoreContext(); // 执行时恢复
        // ...
    }
}
```

### 方案三：Laravel 原生 Context 序列化（Laravel 11.15+）

从 Laravel 11.15 开始，`Context` 支持自动序列化到 Job：

```php
// 在 AppServiceProvider 中启用
use Illuminate\Support\Facades\Context;

Context::serializeForQueue(); // 自动序列化 Context 到 Job payload
```

这样 Job 执行时会自动恢复 Context，无需手动传递。**但要注意性能开销：每次 dispatch 都会序列化整个 Context。**

## 实战三：Event 阶段——事件监听器的上下文透传

### 事件定义

```php
// app/Events/OrderCreated.php
<?php

namespace App\Events;

use App\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderCreated
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public Order $order,
    ) {}
}
```

### 监听器恢复上下文

```php
// app/Listeners/SendOrderConfirmation.php
<?php

namespace App\Listeners;

use App\Events\OrderCreated;
use App\Mail\OrderConfirmation;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class SendOrderConfirmation
{
    public function handle(OrderCreated $event): void
    {
        // 事件触发时 Context 还在（同步事件）
        Log::info('Sending order confirmation', [
            'order_id' => $event->order->id,
        ]);

        Mail::to($event->order->email)
            ->send(new OrderConfirmation($event->order));
    }
}
```

### 异步监听器的上下文传递

如果监听器标记为 `ShouldQueue`，Context **不会**自动传递：

```php
class SendOrderConfirmation implements ShouldQueue
{
    public function __construct(
        public Order $order,
    ) {
        // 需要在这里保存 Context
    }

    public function handle(): void
    {
        // 需要在这里恢复 Context
    }
}
```

解决方案与 Queue 阶段相同：在构造函数中 `saveContext()`，在 `handle()` 中 `restoreContext()`。

## 实战四：Notification 阶段——通知的上下文透传

### 通知定义

```php
// app/Notifications/OrderShipped.php
<?php

namespace App\Notifications;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\Context;

class OrderShipped extends Notification
{
    use Queueable;

    public function __construct(
        public Order $order,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail', 'database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        // Notification 内部无法直接访问 Context
        // 需要在 dispatch 时传入
        return (new MailMessage)
            ->subject('订单已发货')
            ->line('您的订单 #' . $this->order->id . ' 已发货')
            ->line('物流单号：' . $this->order->tracking_number);
    }
}
```

### 在通知中传递 Context

```php
// 在控制器或 Job 中发送通知
$notification = new OrderShipped($order);

// 手动附加 Context 数据
$contextData = Context::all();
$notification->context($contextData); // 使用 Queueable 的 context 方法

$notifiable->notify($notification);
```

或者在通知的 `__construct` 中保存：

```php
class OrderShipped extends Notification
{
    use Queueable;

    protected array $contextData = [];

    public function __construct(Order $order)
    {
        $this->order = $order;
        $this->contextData = Context::all();
    }

    public function via(object $notifiable): array
    {
        // 恢复 Context 供后续使用
        Context::add($this->contextData);
        return ['mail', 'database'];
    }
}
```

## 进阶：自定义 Context Store

默认的 Context 存储在内存中（`ArrayContextStore`），在进程内有效。如果你需要跨进程持久化，可以自定义 Store：

```php
// app/Context/RedisContextStore.php
<?php

namespace App\Context;

use Illuminate\Support\Facades\Redis;
use Spatie\LaravelContext\ContextStore;

class RedisContextStore implements ContextStore
{
    public function get(string $correlationId): array
    {
        $key = "context:{$correlationId}";
        $data = Redis::get($key);
        return $data ? json_decode($data, true) : [];
    }

    public function put(string $correlationId, array $data): void
    {
        $key = "context:{$correlationId}";
        Redis::setex($key, 3600, json_encode($data)); // 1 小时过期
    }

    public function flush(string $correlationId): void
    {
        Redis::del("context:{$correlationId}");
    }
}
```

注册：

```php
// AppServiceProvider
$this->app->bind(\Spatie\LaravelContext\ContextStore::class, function () {
    return new \App\Context\RedisContextStore();
});
```

## 踩坑记录

### 坑 1：Context 在 fork 进程中丢失

```php
// ❌ Context 不会传递到 fork 的子进程
pcntl_fork(function () {
    Log::info('In child process'); // correlation_id 丢失
});
```

**解决**：在 fork 前手动保存 Context，子进程中恢复。

### 坑 2：事件广播时 Context 不传递

Laravel Event Broadcasting 使用 WebSocket 推送，Context 不会自动传递到前端。

**解决**：在事件类中手动添加 broadcastWith：

```php
class OrderCreated
{
    public function broadcastWith(): array
    {
        return [
            'order_id' => $this->order->id,
            'correlation_id' => Context::get('correlation_id'),
        ];
    }
}
```

### 坑 3：Artisan 命令没有 Context

在 `php artisan` 命令中，没有 HTTP 请求，Context 为空。

**解决**：在命令中手动生成 Correlation ID：

```php
handle(): int
{
    Context::add('correlation_id', Str::uuid()->toString());
    Context::add('source', 'artisan');
    // ...
}
```

### 坑 4：多租户场景下 Context 被覆盖

```php
// ❌ 多租户切换时，直接覆盖 Context
Context::flush();
Context::add('tenant_id', $newTenant->id); // 其他字段丢失
```

**解决**：使用 `Context::add` 而不是 flush + add，或使用 `Context::only` 保留需要的字段：

```php
$correlationId = Context::get('correlation_id');
Context::flush();
Context::add('correlation_id', $correlationId);
Context::add('tenant_id', $newTenant->id);
```

### 坑 5：Context 数据量过大导致序列化慢

如果 Context 存了大量数据（如完整请求体），序列化到 Job 会显著增加延迟。

**解决**：只传递必要的字段：

```php
$lightContext = Context::only([
    'correlation_id',
    'user_id',
    'tenant_id',
]);

dispatch(new ProcessOrder($order, $lightContext));
```

## 完整架构图

```
用户请求
  ↓
[HTTP Middleware]
  生成 Correlation ID → 写入 Context
  ↓
[Controller]
  Log::info() → 自动带 correlation_id
  ↓
[Event Dispatch]
  OrderCreated → 同步监听器（Context 在）
  ↓
[Queue Dispatch]
  ProcessOrder → 手动保存/恢复 Context
  ↓
[Notification]
  OrderShipped → 传递 Context 到通知
  ↓
[日志聚合]
  所有日志通过 correlation_id 串联
```

## 测试验证

写一个完整的测试来验证 Context 全链路传递：

```php
// tests/Feature/CorrelationIdTest.php
<?php

namespace Tests\Feature;

use App\Jobs\ProcessOrder;
use App\Models\Order;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\TestCase;

class CorrelationIdTest extends TestCase
{
    use RefreshDatabase;

    public function test_correlation_id_passes_to_queue(): void
    {
        $correlationId = Str::uuid()->toString();
        Context::add('correlation_id', $correlationId);

        $order = Order::factory()->create();

        // 手动传递 Context
        $contextData = Context::all();
        ProcessOrder::dispatchSync($order, $contextData);

        // 验证 Job 内部的日志包含 correlation_id
        Log::assertLogged('info', function ($message, $context) use ($correlationId) {
            return str_contains($message, 'Processing order')
                && ($context['correlation_id'] ?? null) === $correlationId;
        });
    }
}
```

## 总结

Laravel Context 是一个轻量但强大的工具，关键要点：

1. **HTTP 阶段**：中间件生成 Correlation ID，日志自动附带
2. **Queue 阶段**：手动传递或使用 `serializeForQueue()`
3. **Event 阶段**：同步事件自动继承，异步事件需要手动处理
4. **Notification 阶段**：通过构造函数或 `context()` 方法传递
5. **踩坑**：注意 fork 进程、广播、Artisan 命令、多租户、数据量大小

Correlation ID 不是银弹，但在排查线上问题时，它是最简单有效的手段。**一条 ID 串联所有日志，问题定位效率提升一个数量级。**
