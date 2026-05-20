---
title: Laravel 审计日志与字段级脱敏实战：后台高风险操作留痕、Diff 快照与合规回放踩坑记录
date: 2026-05-03 10:20:55
updated: 2026-05-03 10:23:32
categories:
  - PHP
  - Laravel
tags: [Laravel, 安全]
description: 结合后台退款、改价、优惠券回收等高风险操作，记录一套在 Laravel 中落地审计日志与字段级脱敏的实战方案，重点覆盖 Diff 快照、事务一致性、PII 脱敏、回放查询与真实踩坑。
---

后台系统真正出问题时，最难的不是修 Bug，而是还原现场：谁把订单从 `paid` 改成 `refunded`，谁把退款金额从 `0` 改成 `5000`，谁在投诉前后看过完整手机号。很多团队虽然有“操作日志”，但内容只有一句 `update success`，既不能追责，也不能过合规审计。

我后来在 Laravel 后台补了一套可回放的审计日志，只覆盖三类动作：**高风险写操作、敏感数据读取、安全相关动作**。核心目标不是“记得多”，而是“记得准”：记录变化字段、记录操作人和请求上下文、对敏感字段做脱敏、并且只在事务成功提交后落库。

## 一、先定边界：不是所有 CRUD 都要审计

我一开始试过给 `Order`、`Coupon`、`User` 全挂 Observer，结果日志量很快失控：系统自动补状态、定时任务修脏数据、后台备注同步，全被记成一次“人工操作”。后来我把规则收紧：

- `order.refunded`
- `order.price_changed`
- `coupon.revoked`
- `user.profile_exported`
- `admin.role_escalated`

这样做的好处很实际：日志量降下来后，排障和风控规则才有意义，比如“同一管理员 10 分钟退款 20 次”才能被准确识别。

```text
┌──────────── Admin / API ────────────┐
│ Controller -> Application Service   │
│ -> DB Transaction                   │
└────────────────┬────────────────────┘
                 │ afterCommit
                 ▼
        ┌─────────────────────┐
        │ AuditLogService     │
        │ diff + mask + save  │
        └─────────┬───────────┘
                  ▼
        ┌─────────────────────┐
        │ audit_logs          │
        │ actor / target / diff│
        └─────────────────────┘
```

这里最关键的设计点是 **afterCommit**。审计日志描述的应该是“已经发生的事实”，而不是“准备发生的动作”。

## 二、表结构：存 Diff，不存整份快照

最早我把整份 `before`、`after` JSON 全塞进审计表，看起来最省事，后来问题非常明显：单条日志太大、查询困难、手机号和 Token 也一起落库。后来我改成只存变化字段：

```php
// database/migrations/create_audit_logs_table.php
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id();
    $table->string('trace_id', 64)->nullable()->index();
    $table->unsignedBigInteger('actor_id')->nullable()->index();
    $table->string('action', 100)->index();
    $table->string('target_type', 100)->index();
    $table->string('target_id', 64)->index();
    $table->json('before_diff')->nullable();
    $table->json('after_diff')->nullable();
    $table->json('request_context')->nullable();
    $table->timestamp('created_at')->useCurrent();
    $table->index(['target_type', 'target_id', 'created_at']);
});
```

比如退款动作里，只记录 `status`、`refund_amount`、`refund_reason` 三个变化字段。后台回放时可以直接看到差异，不需要从一整坨快照里硬找。

## 三、统一服务层：先比较，再脱敏，再落库

真正稳定的做法，不是让 Controller 自己拼日志，而是把 Diff、脱敏、落库收口到一个服务里：

```php
namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Support\Facades\DB;

class AuditLogService
{
    private array $maskedFields = ['phone', 'email', 'id_card', 'token'];

    public function record(string $action, string $targetType, string|int $targetId, array $before, array $after): void
    {
        [$beforeDiff, $afterDiff] = $this->diff($before, $after);

        if ($beforeDiff === [] && $afterDiff === []) {
            return;
        }

        DB::afterCommit(function () use ($action, $targetType, $targetId, $beforeDiff, $afterDiff) {
            AuditLog::query()->create([
                'trace_id' => request()?->header('X-Trace-Id'),
                'actor_id' => auth('admin')->id(),
                'action' => $action,
                'target_type' => $targetType,
                'target_id' => (string) $targetId,
                'before_diff' => $this->mask($beforeDiff),
                'after_diff' => $this->mask($afterDiff),
                'request_context' => ['route' => request()?->path()],
            ]);
        });
    }

    private function diff(array $before, array $after): array
    {
        $old = $new = [];
        foreach (array_unique(array_merge(array_keys($before), array_keys($after))) as $key) {
            if (($before[$key] ?? null) !== ($after[$key] ?? null)) {
                $old[$key] = $before[$key] ?? null;
                $new[$key] = $after[$key] ?? null;
            }
        }
        return [$old, $new];
    }

    private function mask(array $payload): array
    {
        foreach ($payload as $key => $value) {
            if (in_array($key, $this->maskedFields, true)) {
                $payload[$key] = $key === 'phone'
                    ? preg_replace('/^(\d{3})\d{4}(\d{4})$/', '$1****$2', (string) $value)
                    : '***MASKED***';
            }
        }
        return $payload;
    }
}
```

这段实现里我最看重三件事：**只存变化字段、统一脱敏、只在事务提交后写日志**。这三点缺一个，后面都会出问题。

## 四、业务接入：关键动作手动打点，不依赖通用 Observer

我现在只在应用服务中对关键动作手动记录，比如后台退款：

```php
class AdminRefundService
{
    public function __construct(private AuditLogService $auditLogService) {}

    public function refund(Order $order, int $amount, string $reason): void
    {
        DB::transaction(function () use ($order, $amount, $reason) {
            $before = $order->only(['status', 'refund_amount', 'refund_reason']);

            $order->update([
                'status' => 'refunded',
                'refund_amount' => $amount,
                'refund_reason' => $reason,
            ]);

            $this->auditLogService->record(
                'order.refunded',
                Order::class,
                $order->getKey(),
                $before,
                $order->fresh()->only(['status', 'refund_amount', 'refund_reason'])
            );
        });
    }
}
```

这样回放订单时就很清楚：谁操作、改了哪些字段、请求来自哪条后台路由。

## 五、三个最值钱的坑

### 1. 事务里直接写审计日志

我第一次上线时，退款事务回滚了，但审计表里已经有一条“退款成功”。这个坑只有一个正确解法：统一走 `DB::afterCommit()`。

### 2. 直接记录 `request()->all()`

这会把 Token、邮箱、手机号一起写进审计表。短期排查方便，长期就是合规炸弹。后来我只保留白名单字段，敏感字段统一脱敏。

### 3. 审计表跟主业务表共用热点写路径

大促期间后台批量改价，审计写入会突然放大，订单 RT 也会被拖高。后来我的做法是主库只保留近 7 天热数据，历史日志异步归档，后台默认只查热窗口。

## 六、结论

审计日志本质上是后台系统的“事故第一现场”。真正有用的方案通常都具备同一组特征：**高风险动作、Diff 快照、字段级脱敏、afterCommit、可按人和对象回放**。如果你的 Laravel 后台已经涉及退款、改价、权限调整、资料导出，这套能力最好在事故前补齐；因为等到真要追责时，再好的数据库也补不回第一现场。