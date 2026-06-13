---
title: Laravel-Migrations-零停机数据库变更与回滚策略实战
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-06 11:23:35
updated: 2026-05-06 11:34:49
tags: [Laravel, MySQL, 零停机, 工程管理]
keywords: [Laravel, Migrations, 零停机数据库变更与回滚策略实战, PHP]
categories:
  - php
description: 基于 Laravel B2C API 高并发真实发布经验，系统拆解零停机数据库变更的四段式落地方法（Expand-Contract 模式）、独立回填命令与进度追踪设计、功能开关切流与双写兼容策略、生产环境安全回滚五步法，附完整 Migration 代码示例与三种方案对比表，覆盖大表加索引、字段类型迁移、唯一约束等高频场景。



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

## 七、完整 Expand-Contract 实战：orders 表字段类型迁移

下面把四段式完整串起来。场景：把 `orders.total_amount` 从 `DECIMAL(10,2)` 改成整数分（`BIGINT`），避免浮点精度问题。

### Step 1 — Expand：加新字段

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('total_amount_cents')
                ->nullable()
                ->after('total_amount');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('total_amount_cents');
        });
    }
};
```

### Step 2 — Backfill：分批转换

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class BackfillOrderAmountCentsCommand extends Command
{
    protected $signature = 'orders:backfill-amount-cents {--chunk=2000}';

    public function handle(): int
    {
        $chunk = (int) $this->option('chunk');

        while (true) {
            $rows = DB::table('orders')
                ->whereNull('total_amount_cents')
                ->orderBy('id')
                ->limit($chunk)
                ->pluck('id');

            if ($rows->isEmpty()) {
                break;
            }

            DB::table('orders')
                ->whereIn('id', $rows)
                ->update([
                    'total_amount_cents' => DB::raw('CAST(total_amount * 100 AS SIGNED)'),
                ]);

            $this->info("Backfilled {$rows->count()} rows (last id: {$rows->last()})");

            usleep(50_000); // 50ms 限速，降低主从延迟
        }

        return self::SUCCESS;
    }
}
```

### Step 3 — Switch + Contract：切读写后删旧列

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 先加 NOT NULL 约束 + 默认值
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('total_amount_cents')
                ->default(0)
                ->change();
        });

        // 再删旧列（至少延后一个发布周期）
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('total_amount');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('total_amount', 10, 2)->nullable();
        });
    }
};
```

## 八、三种方案对比

| 维度 | Expand-Contract（本文方案） | 直接 Migration | Online DDL 工具（gh-ost / pt-osc） |
|---|---|---|---|
| 停机时间 | 零 | 取决于表大小 | 零 |
| 实现复杂度 | 中等，需多步 Migration + Command | 低，一条 Migration | 中等，需额外部署工具 |
| 回滚风险 | 低，旧字段保留可切回 | 高，DDL 回滚成本大 | 中等，需手动处理影子表 |
| 适用场景 | 逻辑变更（字段语义、类型迁移） | 小表 / 索引操作 | 大表物理结构变更（加列、改类型） |
| 对线上流量影响 | 可控，分批限速 | 不可控，可能全表锁 | 可控，工具自动限速 |
| Laravel 集成度 | 原生，无外部依赖 | 原生 | 需 Shell 调用或 CI 集成 |

**经验法则**：小表 (<50万行) 直接 Migration；大表逻辑变更用 Expand-Contract；大表物理结构变更优先考虑 gh-ost。

## 九、回填策略进阶

### 策略 1：带进度追踪的回填命令

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class TrackedBackfillCommand extends Command
{
    protected $signature = 'orders:tracked-backfill {--chunk=1000} {--resume}';

    public function handle(): int
    {
        $lastId = $this->option('resume')
            ? (int) Cache::get('backfill:orders:last_id', 0)
            : 0;

        $total = DB::table('orders')->where('id', '>', $lastId)->count();
        $bar = $this->output->createProgressBar($total);
        $bar->start();

        while (true) {
            $rows = DB::table('orders')
                ->where('id', '>', $lastId)
                ->whereNull('status_code')
                ->orderBy('id')
                ->limit((int) $this->option('chunk'))
                ->get();

            if ($rows->isEmpty()) {
                break;
            }

            foreach ($rows as $row) {
                DB::table('orders')->where('id', $row->id)->update([
                    'status_code' => match ($row->status) {
                        'pending' => 0, 'paid' => 1, 'cancelled' => 2, 'refunded' => 3, default => 0,
                    },
                ]);
            }

            $lastId = $rows->last()->id;
            Cache::put('backfill:orders:last_id', $lastId, 86400);
            $bar->advance($rows->count());
        }

        $bar->finish();
        $this->newLine();
        Cache::forget('backfill:orders:last_id');

        return self::SUCCESS;
    }
}
```

特点：`--resume` 支持断点续跑；Cache 记录进度；进度条直观展示。

### 策略 2：分段并行回填

当表超过千万行时，单进程回填太慢。可以用多个子任务并行：

```php
// 在 Laravel Schedule 中按 ID 段分发
Schedule::command('orders:backfill-status-code', ['--from' => 1, '--to' => 1000000])
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('orders:backfill-status-code', ['--from' => 1000001, '--to' => 2000000])
    ->withoutOverlapping()
    ->runInBackground();
```

关键：每个分段加 `--from` / `--to` 参数，用 `whereBetween('id', ...)` 限定范围，避免重复扫描。

## 相关阅读

- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/categories/架构/Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [PHP-FPM 长连接与短连接实战：数据库连接池性能差异与 MySQL 踩坑记录](/categories/PHP/php-fpm-guide-databasemysql/)
- [Data Contract 实战：Laravel 微服务数据契约版本化验证与 Breaking Change 检测](/categories/架构/2026-06-05-Data-Contract-Pact-style-Laravel微服务数据契约版本化验证Breaking-Change检测/)