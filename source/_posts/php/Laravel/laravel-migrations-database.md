---
title: Laravel-Migrations-零停机数据库变更与回滚策略实战
date: 2026-05-06 11:23:35
updated: 2026-05-06 11:34:49
tags: [Kubernetes, Laravel, MySQL, 工程管理]
categories:
  - PHP
  - Laravel
description: 基于 Laravel B2C API 的真实发布经验，拆解零停机数据库变更的落地方法：Expand-Contract、独立回填、功能开关切流、双写兼容，以及真正安全的生产回滚策略。



---
## 前言

很多团队把 `php artisan migrate --force` 当成“数据库上线完成”。但线上真正危险的不是 Migration 能不能跑完，而是**新旧代码和新旧表结构能不能共存**。

我在订单系统里把 `orders.status` 从字符串迁到整数码时踩过一次坑：DDL 已经成功，Web 请求也正常，但旧 Horizon worker 仍按旧字段消费，结果支付成功后订单状态没更新。那次事故之后，团队把数据库发布固定成四段：**Expand → Backfill → Switch → Contract**。

<!-- more -->

## 一、零停机迁移的最小架构

```text
┌────────────────────────────────────────────────────┐
│ Expand   │ 加字段/索引，旧代码继续运行            │
│ Backfill │ Command/Job 分批回填历史数据           │
│ Switch   │ Feature Flag 切读，必要时短期双写      │
│ Contract │ 延后删除旧字段和旧逻辑                 │
└────────────────────────────────────────────────────┘
```

我只坚持两条规则：

1. 破坏性变更不和业务切流同批上线。
2. 生产回滚优先回代码，不优先回数据库结构。

因为数据库一旦被新旧版本同时写过，`migrate:rollback` 往往不是救火，而是补一刀。

## 二、Expand：Migration 只做加法

下面是我们固定使用的 Migration 写法。目标很明确：先把新结构放进去，但不破坏旧逻辑。

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedTinyInteger('status_code')
                ->nullable()
                ->after('status');
        });

        DB::statement(
            'ALTER TABLE orders ADD INDEX idx_status_code_created_at (status_code, created_at), ALGORITHM=INPLACE, LOCK=NONE'
        );
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_status_code_created_at');
            $table->dropColumn('status_code');
        });
    }
};
```

这里有三个关键点：新字段先允许 `NULL`、旧字段先不删、索引显式命名。只要旧代码还能跑，兼容窗口就存在。

## 三、Backfill：历史数据回填必须脱离 Migration

我们后来明确禁止在 Migration 里做全表更新。DDL 和大批量 DML 混在一起，发布窗口会失控。回填统一拆成命令：

```php
<?php

namespace App\Console\Commands;

use App\Models\Order;
use Illuminate\Console\Command;

class BackfillOrderStatusCodeCommand extends Command
{
    protected $signature = 'orders:backfill-status-code {--chunk=1000}';

    public function handle(): int
    {
        Order::query()
            ->whereNull('status_code')
            ->orderBy('id')
            ->chunkById((int) $this->option('chunk'), function ($orders) {
                foreach ($orders as $order) {
                    $order->forceFill([
                        'status_code' => match ($order->status) {
                            'pending' => 0,
                            'paid' => 1,
                            'cancelled' => 2,
                            'refunded' => 3,
                            default => 0,
                        },
                    ])->saveQuietly();
                }
            });

        return self::SUCCESS;
    }
}
```

实战里我会先用小 chunk 跑一段，只看三件事：慢查询、主从延迟、锁等待。**能暂停、能续跑、能限速**，比一次跑完更重要。

## 四、Switch：切读靠开关，切写靠双写

回填完成后，再切读路径：

```php
$query = Order::query();

if (config('features.order_status_code_read')) {
    $query->where('status_code', 1);
} else {
    $query->where('status', 'paid');
}
```

写路径则短期双写，给回滚留空间：

```php
$order->fill([
    'status' => 'paid',
    'status_code' => 1,
])->save();
```

双写虽然不优雅，但在报表、ETL、异步消费者还没完全改完时非常有效。

## 五、我在线上真的这样回滚

```text
1. 关闭新读开关
2. 回滚应用代码到兼容版本
3. php artisan horizon:terminate
4. 保留已扩展的数据库结构
5. 检查是否需要补数据，而不是立刻 rollback migration
```

这里最容易漏的是第 3 步。很多“Web 正常、异步异常”的事故，本质上都是常驻 worker 没重启。

## 六、踩坑记录

### 坑 1：高峰期给大表加唯一索引

我曾在 `user_coupons` 上直接加唯一索引，结果写入延迟明显上升。后来的做法是：先清理重复脏数据，再离峰执行，并把唯一约束和功能发布拆开。

### 坑 2：Contract 做太早

字段切换成功两天就删旧列，结果 BI SQL 还在查 `status`。现在我们的规则是：Contract 至少延后一个发布周期，并先查下游脚本引用。

### 坑 3：把回填写进 Migration

一次 `migrate --force` 跑了十几分钟，整批容器都在等，发布窗口完全不可控。从那以后，Migration 必须短，长任务全部拆出去。

## 总结

我的结论只有四句：Migration 只做短平快 schema 变更；回填拆成可暂停、可续跑命令；切读靠开关、切写靠双写；回滚优先回代码。

一句话总结：**先让数据库兼容未来，再让代码兼容过去，最后再清理历史。**