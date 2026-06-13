---
title: "Laravel Observers 实战：模型事件监听与审计日志自动记录——30+ 仓库踩坑记录"
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 11:15:29
updated: 2026-05-05 11:46:48
categories:
  - php
  - logging
tags: [Laravel, Observer, 日志, 审计, 模型事件]
keywords: [Laravel Observers, 模型事件监听与审计日志自动记录, 仓库踩坑记录, PHP]
description: "深入讲解 Laravel Observers 模型事件监听机制与审计日志自动记录实战方案，覆盖 created/updated/deleted/restored 全生命周期事件，详解 Octane 兼容性陷阱、批量操作盲区、性能优化与队列异步写入，附完整可运行代码示例与 30+ 仓库真实踩坑总结指南"



---

## 背景：为什么需要 Observers？

在 KKday B2C API 项目中，随着业务增长，Controller 和 Service Layer 里充斥着大量「模型保存后顺便写日志、发通知、清缓存」的代码。原本 3 行的 `update()` 调用，后面跟了 20 行 `if ($model->wasChanged('status')) { ... }` 的副效应逻辑。

**核心痛点**：

1. **关注点泄漏** — 业务逻辑和副作用（日志、通知、缓存）混在一起，Service 方法越来越臃肿
2. **遗漏风险** — 手动埋点容易漏掉某个变更字段的记录，出事后无法溯源
3. **测试困难** — 副效应写在 Service 里，单元测试必须连带测试日志逻辑

Observer 模式的价值在于把「模型发生了什么」的观察和「因此要做什么」的反应解耦。

```
┌─────────────────────────────────────────────────────┐
│                    请求处理流程                        │
│                                                     │
│  Controller → Service → Model::save()               │
│                              │                      │
│                              ▼                      │
│                    ┌─────────────────┐               │
│                    │  Model Observer │               │
│                    └────┬───┬───┬───┘                │
│                         │   │   │                    │
│                    ┌────┘   │   └────┐               │
│                    ▼        ▼        ▼               │
│              写审计日志  清缓存   发通知              │
│              (AuditLog) (Cache) (Slack)              │
│                                                     │
│  Service 只负责业务逻辑，不关心副作用                 │
└─────────────────────────────────────────────────────┘
```

## 一、Observer 基础：注册与生命周期

### 1.1 创建 Observer

```bash
php artisan make:observer OrderObserver --model=Order
```

生成的骨架：

```php
<?php
// app/Observers/OrderObserver.php

namespace App\Observers;

use App\Models\Order;

class OrderObserver
{
    public function created(Order $order): void
    {
        //
    }

    public function updated(Order $order): void
    {
        //
    }

    public function deleted(Order $order): void
    {
        //
    }

    public function restored(Order $order): void
    {
        //
    }

    public function forceDeleted(Order $order): void
    {
        //
    }
}
```

### 1.2 注册方式对比

Laravel 提供两种注册路径，选错了会有隐性 bug：

```php
// 方式 A：ServiceProvider 显式注册（推荐）
// app/Providers/EventServiceProvider.php
protected $observers = [
    \App\Models\Order::class => [\App\Observers\OrderObserver::class],
];

// 方式 B：自动发现（依赖命名约定）
// config/app.php 中确保没有关闭
'observers' => [], // 不需要手动配置
// 要求：Observer 放在 app/Observers/ 且命名空间为 App\Observers
```

**踩坑 #1：自动发现在生产环境失效**

> 某次部署后发现 Observer 完全不触发。排查发现是运维在 CI 流水线里跑了 `php artisan optimize`，生成了缓存的 class manifest。自动发现依赖 `get_declared_classes()` 的反射扫描，被缓存后新增的 Observer 类不会被加载。
>
> **结论**：生产环境永远用 **方式 A 显式注册**，不要依赖自动发现。

### 1.3 完整生命周期

```
新建模型:
  creating → created

更新模型:
  saving → updating → updated → saved

删除模型:
  deleting → deleted

软删除后恢复:
  restoring → restored

强制删除:
  forceDeleting → forceDeleted
```

`saving`/`saved` 在 create 和 update 时都会触发，适合做通用逻辑（如统一的字段格式化）。

## 二、实战：审计日志自动记录

### 2.1 数据库设计

```sql
CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `auditable_type` VARCHAR(255) NOT NULL COMMENT '模型类名',
    `auditable_id` BIGINT UNSIGNED NOT NULL COMMENT '模型主键',
    `event` VARCHAR(20) NOT NULL COMMENT 'created/updated/deleted',
    `old_values` JSON COMMENT '变更前的字段值',
    `new_values` JSON COMMENT '变更后的字段值',
    `user_id` BIGINT UNSIGNED NULL COMMENT '操作人',
    `ip_address` VARCHAR(45) NULL COMMENT '请求IP',
    `user_agent` VARCHAR(500) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_auditable` (`auditable_type`, `auditable_id`),
    INDEX `idx_user` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.2 通用审计 Observer

```php
<?php
// app/Observers/AuditLogObserver.php

namespace App\Observers;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Request;

class AuditLogObserver
{
    /**
     * 只记录这些字段的变更（白名单）
     * 跳过 updated_at、created_at 等时间戳
     */
    protected array $trackedFields = [];

    public function __construct()
    {
        $this->trackedFields = config('audit.tracked_fields', []);
    }

    public function created(Model $model): void
    {
        $this->log($model, 'created', [], $model->getAttributes());
    }

    public function updated(Model $model): void
    {
        $dirty = $model->getDirty();
        if (empty($dirty)) {
            return;
        }

        // 只记录白名单字段
        if (!empty($this->trackedFields)) {
            $dirty = array_intersect_key($dirty, array_flip($this->trackedFields));
            if (empty($dirty)) {
                return;
            }
        }

        $old = array_intersect_key(
            $model->getOriginal(),
            array_flip(array_keys($dirty))
        );

        $this->log($model, 'updated', $old, $dirty);
    }

    public function deleted(Model $model): void
    {
        $this->log($model, 'deleted', $model->getAttributes(), []);
    }

    protected function log(
        Model $model,
        string $event,
        array $old,
        array $new
    ): void {
        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id'   => $model->getKey(),
            'event'          => $event,
            'old_values'     => $old,
            'new_values'     => $new,
            'user_id'        => auth()->id(),
            'ip_address'     => Request::ip(),
            'user_agent'     => str(Request::userAgent())->limit(500),
        ]);
    }
}
```

**踩坑 #2：`getDirty()` 在 `created` 事件里是空的**

> `created` 触发时，模型刚入库，`getDirty()` 返回 `[]`。要用 `getAttributes()` 获取全部字段值。这个 bug 在本地很难发现，因为开发环境数据少，上线后审计日志 `new_values` 全是空 JSON 才被发现。
>
> **修复**：`created` 事件必须用 `$model->getAttributes()`，不能用 `getDirty()`。

### 2.3 按模型差异化配置

```php
<?php
// app/Providers/EventServiceProvider.php

protected $observers = [
    \App\Models\Order::class  => [\App\Observers\OrderObserver::class],
    \App\Models\Product::class => [\App\Observers\AuditLogObserver::class],
    \App\Models\Member::class  => [\App\Observers\AuditLogObserver::class],
];

// 对 Order 用专门的 Observer（含业务逻辑）
// 对 Product/Member 用通用的审计 Observer
```

## 三、高级实战：Order Observer 业务场景

```php
<?php
// app/Observers/OrderObserver.php

namespace App\Observers;

use App\Models\Order;
use App\Models\AuditLog;
use App\Notifications\OrderStatusChanged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Notification;

class OrderObserver
{
    public function updated(Order $order): void
    {
        // 状态变更：发通知 + 写审计
        if ($order->wasChanged('status')) {
            $this->notifyStatusChange($order);
            $this->recordStatusTransition($order);
        }

        // 支付信息变更：清缓存
        if ($order->wasChanged(['payment_status', 'paid_at'])) {
            $this->flushOrderCache($order);
        }
    }

    protected function notifyStatusChange(Order $order): void
    {
        try {
            Notification::route('slack', config('services.slack.webhook'))
                ->notify(new OrderStatusChanged(
                    $order,
                    $order->getOriginal('status'),
                    $order->status
                ));
        } catch (\Throwable $e) {
            // Observer 里的异常不能影响主流程
            report($e);
        }
    }

    protected function recordStatusTransition(Order $order): void
    {
        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id'   => $order->id,
            'event'          => 'status_changed',
            'old_values'     => ['status' => $order->getOriginal('status')],
            'new_values'     => ['status' => $order->status],
            'user_id'        => auth()->id(),
            'ip_address'     => request()->ip(),
        ]);
    }

    protected function flushOrderCache(Order $order): void
    {
        Cache::forget("order:detail:{$order->id}");
        Cache::forget("order:summary:{$order->order_no}");
    }
}
```

**踩坑 #3：Observer 里不能 `throw` 异常**

> Observer 的回调是在 Eloquent 模型事件 dispatcher 里同步执行的。如果 Observer 抛异常，整个数据库事务会回滚。我们在 `OrderObserver` 里发 Slack 通知时网络超时，导致用户的订单状态更新跟着一起失败了。
>
> **修复**：Observer 里所有「尽力而为」的操作（通知、日志、缓存）必须 `try-catch`，不能让异常向上冒泡。

## 四、Octane 环境下的 Observer 陷阱

### 4.1 静态属性/单例状态污染

Swoole Worker 常驻内存，Observer 实例被复用：

```php
// ❌ 危险：静态属性在 Worker 间共享
class OrderObserver
{
    protected static array $processedIds = []; // 内存泄漏 + 跨请求污染

    public function updated(Order $order): void
    {
        if (in_array($order->id, self::$processedIds)) {
            return; // 跳过已处理
        }
        self::$processedIds[] = $order->id;
        // ... 业务逻辑
    }
}

// ✅ 正确：利用 Eloquent 的 wasChanged() 避免重复处理
class OrderObserver
{
    public function updated(Order $order): void
    {
        if (!$order->wasChanged('status')) {
            return;
        }
        // 状态确实变了才处理，不需要手动去重
    }
}
```

**踩坑 #4：Observer 注册在 Octane 下只执行一次**

> `EventServiceProvider` 的 `boot()` 方法在 Octane Worker 启动时只执行一次。如果 Observer 依赖请求级的服务（如 `auth()->id()`），在构造函数里注入会有问题。解决方案：把依赖注入放在方法参数里，或者在 Observer 方法内通过容器解析。

```php
// ❌ 构造函数注入在 Octane 下被固化
class AuditLogObserver
{
    protected int $userId;

    public function __construct()
    {
        $this->userId = auth()->id(); // Worker 重启前永远是第一个请求的值！
    }
}

// ✅ 每次方法调用时解析
class AuditLogObserver
{
    protected function log(Model $model, string $event, array $old, array $new): void
    {
        AuditLog::create([
            // ...
            'user_id' => auth()->id(), // 每次请求实时获取
        ]);
    }
}
```

## 五、批量操作的 Observer 盲区

这是最容易踩的坑，也是很多团队不知道的。

### 5.1 `Model::query()->update()` 不触发 Observer

```php
// ❌ 不会触发 OrderObserver::updated()
Order::where('status', 'pending')
    ->where('created_at', '<', now()->subDays(7))
    ->update(['status' => 'expired']);

// ✅ 必须逐条 save() 才触发 Observer
Order::where('status', 'pending')
    ->where('created_at', '<', now()->subDays(7))
    ->get()
    ->each(function (Order $order) {
        $order->status = 'expired';
        $order->save(); // 触发 Observer
    });
```

**性能权衡**：逐条 `save()` 有 N+1 性能代价。如果需要批量操作且保留审计日志，有两个选择：

1. **用队列**：把批量任务拆成 Job，每个 Job 内逐条处理
2. **手动触发**：批量 SQL 更新后，再跑一个 `INSERT INTO audit_logs ... SELECT` 来补记录

### 5.2 `Model::withoutEvents()` 绕过 Observer

```php
// 有时候你确实需要跳过 Observer（如数据迁移、种子数据）
Order::withoutEvents(function () {
    Order::insert($seedData);
});
```

**踩坑 #5：开发同学在正常业务代码里误用了 `withoutEvents()`**

> 某次 code review 发现，有同事为了「性能优化」在更新订单状态时加了 `withoutEvents()`，导致审计日志断了一个月。
>
> **建议**：在团队规范中明确 `withoutEvents()` 只能用于数据迁移脚本（`database/migrations` 和 `database/seeders`），业务代码中禁止使用。

## 六、性能优化

### 6.1 审计日志异步写入

高 QPS 场景下，同步写 `audit_logs` 表会拖慢主流程：

```php
<?php
// app/Observers/AuditLogObserver.php

use App\Jobs\RecordAuditLog;

class AuditLogObserver
{
    public function updated(Model $model): void
    {
        $dirty = $model->getDirty();
        if (empty($dirty)) {
            return;
        }

        // 异步写入，不阻塞主请求
        RecordAuditLog::dispatch(
            get_class($model),
            $model->getKey(),
            'updated',
            array_intersect_key($model->getOriginal(), $dirty),
            $dirty
        )->onQueue('low');
    }
}
```

**踩坑 #6：异步日志要确保 Job 失败有告警**

> 用了队列后，如果 Redis 宕机或队列 worker 挂了，审计日志就静默丢失了。需要配合 Horizon 监控 + 失败 Job 告警，确保日志不丢。

### 6.2 避免 Observer 内的 N+1 查询

```php
// ❌ Observer 里做关联查询（如果批量更新触发很多次 Observer）
public function updated(Order $order): void
{
    $member = $order->member()->first(); // 每次触发都查一次 members 表
    Notification::send($member, new OrderUpdated($order));
}

// ✅ 如果需要关联数据，在 Observer 方法里用 loadMissing
public function updated(Order $order): void
{
    $order->loadMissing('member');
    Notification::send($order->member, new OrderUpdated($order));
}
```

## 七、Observer vs Events & Listeners 选型

```
┌────────────────────┬──────────────────────┬──────────────────────┐
│       维度         │      Observer        │  Events & Listeners  │
├────────────────────┼──────────────────────┼──────────────────────┤
│ 作用范围           │ 单个模型的所有事件     │ 跨模型/跨服务的事件   │
│ 触发时机           │ Eloquent 生命周期     │ 手动 dispatch()      │
│ 事务内/外          │ 事务内同步执行        │ 可队列化、可延迟      │
│ 适合场景           │ 审计日志、缓存清理    │ 下单→扣库存→发通知   │
│ 测试复杂度         │ 直接用模型触发        │ 需要 mock Event      │
│ 排查难度           │ 隐式触发，不好 grep   │ 显式 dispatch，可搜索│
└────────────────────┴──────────────────────┴──────────────────────┘
```

**经验法则**：
- 只关心「某个模型的 CRUD」→ 用 Observer
- 需要「一个动作触发多个下游」→ 用 Event + Listener
- 别把业务流程编排放在 Observer 里（那是 Event 的职责）

## 八、测试策略

```php
<?php
// tests/Feature/Observers/OrderObserverTest.php

namespace Tests\Feature\Observers;

use App\Models\Order;
use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderObserverTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function it_creates_audit_log_when_order_is_created(): void
    {
        $order = Order::factory()->create();

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => Order::class,
            'auditable_id'   => $order->id,
            'event'          => 'created',
        ]);
    }

    /** @test */
    public function it_records_status_change_in_audit_log(): void
    {
        $order = Order::factory()->create(['status' => 'pending']);

        $order->update(['status' => 'confirmed']);

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => Order::class,
            'auditable_id'   => $order->id,
            'event'          => 'updated',
        ]);

        $log = AuditLog::where('auditable_id', $order->id)
            ->where('event', 'updated')
            ->first();

        $this->assertEquals('pending', $log->old_values['status']);
        $this->assertEquals('confirmed', $log->new_values['status']);
    }

    /** @test */
    public function it_does_not_create_audit_log_when_nothing_changed(): void
    {
        $order = Order::factory()->create(['status' => 'pending']);

        // 触发 update 但没有实际变更
        $order->touch();

        $this->assertDatabaseCount('audit_logs', 1); // 只有 created 的记录
    }
}
```

## 九、踩坑总结

| # | 问题 | 根因 | 解法 |
|---|------|------|------|
| 1 | Observer 生产环境不触发 | class manifest 缓存导致自动发现失效 | 显式注册到 EventServiceProvider |
| 2 | `created` 事件 `new_values` 为空 | `getDirty()` 在新建后返回空 | 用 `getAttributes()` |
| 3 | Observer 异常导致事务回滚 | Slack 超时抛出未捕获异常 | try-catch + report() |
| 4 | Octane 下 auth() 返回错误用户 | Observer 构造函数在 Worker 启动时固化 | 方法内调用 auth() |
| 5 | 审计日志断了一个月 | 误用 `withoutEvents()` | 团队规范 + CR 禁止 |
| 6 | 异步审计日志静默丢失 | 队列 worker 崩溃无感知 | Horizon 监控 + 失败告警 |
| 7 | `Model::update()` 不触发 Observer | 批量更新绕过 Eloquent 生命周期 | 逐条 save() 或手动补记录 |

## 总结

Laravel Observers 是一个轻量但强大的工具，特别适合做模型级的「横切关注点」（审计日志、缓存清理、字段校验）。但在 B2C 高并发场景下，需要注意：

1. **不要依赖自动发现** — 显式注册，CI 里有保障
2. **Observer 里不要抛异常** — 所有副作用 try-catch
3. **注意 Octane 内存模型** — 避免静态属性、构造函数注入
4. **批量操作是盲区** — `update()` 不触发，需要特殊处理
5. **审计日志异步化** — 高 QPS 下别同步写表

在我们的实际项目中，审计日志 Observer 帮助解决了一次线上事故：某用户声称自己没有修改过收货地址，但系统显示已更新。通过 `audit_logs` 表精确查到了变更记录（包括操作 IP 和 User-Agent），证明是用户的浏览器自动填充插件导致的。如果没有这套 Observer 自动记录，这类纠纷将无法取证。

## 相关阅读

- [Laravel Event-Listener 事件驱动架构 - 解耦订单处理](/2026/05/05/Laravel-Event-Listener-事件驱动架构-解耦订单处理-KKday-B2C-API-真实踩坑记录/) — Observer 适合单模型 CRUD 监听，Event & Listener 适合跨服务的业务流程编排，本文详解两者选型与踩坑。
- [Laravel 日志实战：多通道、结构化、日志聚合与生产环境治理踩坑记录](/2026/05/05/Laravel-日志实战-多通道-结构化-日志聚合与生产环境治理踩坑记录/) — Observer 审计日志只是日志体系的一部分，本文覆盖 Laravel Logging 全链路：多通道配置、结构化 JSON、日志聚合与生产治理。
- [Laravel Horizon 队列监控与生产环境运维实战](/2026/05/05/Laravel-Horizon-队列监控与生产环境运维实战-多队列优先级-指标采集与自动恢复踩坑记录/) — 审计日志异步写入依赖队列，Horizon 是监控队列健康的关键工具，本文详解多队列优先级配置与故障自动恢复。
