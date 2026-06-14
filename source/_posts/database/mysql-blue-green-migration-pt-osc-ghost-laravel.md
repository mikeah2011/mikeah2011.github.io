---

title: 数据库蓝绿迁移实战：pt-osc vs gh-ost vs Laravel 大表无锁变更——生产环境零停机 Schema 演进的工程化路径
date: 2026-06-09 15:37:00
categories:
  - database
keywords: [pt, osc vs gh, ost vs Laravel, Schema, 数据库蓝绿迁移实战, 大表无锁变更, 生产环境零停机, 演进的工程化路径, 数据库]
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
- pt-osc
- gh-ost
- 数据库
- 蓝绿部署
- Laravel
- 大表变更
- 零停机
- Schema演进
description: 深入对比 pt-osc、gh-ost 和 Laravel 原生方案在大表无锁变更中的表现，结合生产环境实战案例，提供 MySQL Schema 演进的完整工程化路径。
---


## 前言

在生产环境中对 MySQL 大表执行 DDL（ALTER TABLE）操作，是 DBA 和后端开发者最头疼的事情之一。一张千万级甚至亿级的订单表，执行一条 `ALTER TABLE` 加个字段，可能直接锁表数小时，业务雪崩。

本文将从实战角度出发，系统对比三种主流的大表无锁变更方案：**Percona pt-osc**、**GitHub gh-ost**、以及 **Laravel 原生迁移策略**，并给出生产环境零停机 Schema 演进的完整工程化路径。

---

## 为什么大表 DDL 是个问题？

### MySQL DDL 的锁机制演进

MySQL 的 DDL 锁机制经历了几个重要阶段：

**MySQL 5.5 及之前**：`ALTER TABLE` 直接锁表，全程不可读写（Copy Table）。

**MySQL 5.6**：引入 Online DDL（`ALGORITHM=INPLACE`），支持部分操作的无锁变更，但仍有局限。

**MySQL 5.7+**：Online DDL 进一步增强，支持大部分 `ALTER TABLE` 操作的 `INPLACE` 算法和 `LOCK=NONE`。

**MySQL 8.0**：引入 Instant DDL（`ALGORITHM=INSTANT`），支持瞬间完成加列操作。

### 实际问题依然存在

即使 MySQL 8.0 支持 Instant DDL，以下场景仍然需要长时间持锁或消耗大量资源：

- **修改列类型**（如 `VARCHAR(100)` → `VARCHAR(255)`）
- **添加/删除索引**（虽然 Online，但大表仍需数小时构建）
- **修改主键**
- **字符集转换**
- **分区操作**

一张 5000 万行的订单表，添加一个普通索引可能需要 30-60 分钟。在此期间，虽然理论上不阻塞 DML，但实际上会造成：

- 大量 IO 消耗，影响正常查询性能
- 复制延迟（主从同步 lag）
- 磁盘空间临时翻倍（某些情况下）

---

## 方案一：Percona pt-osc（pt-online-schema-change）

### 工作原理

pt-osc（Percona Toolkit 中的 pt-online-schema-change）是最早成熟的在线 DDL 工具，核心原理：

1. **创建影子表**：创建与原表结构相同的新表，在新表上执行 DDL
2. **创建触发器**：在原表上创建 `INSERT`、`UPDATE`、`DELETE` 触发器，将变更同步到影子表
3. **分批拷贝数据**：按主键范围分批将原表数据拷贝到影子表
4. **原子切换**：拷贝完成后，用 `RENAME TABLE` 原子交换原表和影子表
5. **清理**：删除旧表和触发器

### 安装

```bash
# macOS
brew install percona-toolkit

# Ubuntu/Debian
apt-get install percona-toolkit

# CentOS/RHEL
yum install percona-toolkit
```

### 实战用法

#### 基本用法：加字段

```bash
pt-online-schema-change \
  --alter "ADD COLUMN status TINYINT NOT NULL DEFAULT 0 COMMENT '状态: 0=待处理, 1=处理中, 2=完成'" \
  --host=127.0.0.1 \
  --port=3306 \
  --user=dba_user \
  --password='YourPassword' \
  --charset=utf8mb4 \
  --chunk-size=1000 \
  --max-lag=1s \
  --check-interval=1 \
  --max-load="Threads_running=25" \
  --critical-load="Threads_running=100" \
  --progress=time,30 \
  --statistics \
  --execute \
  D=mydb,t=orders
```

#### 参数详解

| 参数 | 说明 |
|------|------|
| `--chunk-size` | 每批拷贝的行数，建议 1000-5000 |
| `--max-lag` | 允许的最大复制延迟，超过则暂停拷贝 |
| `--max-load` | 超过此负载则暂停拷贝 |
| `--critical-load` | 超过此负载则终止操作 |
| `--progress` | 进度报告间隔 |
| `--execute` | 实际执行（不加则为 dry-run） |
| `--dry-run` | 仅测试，不实际执行 |

#### 删除索引

```bash
pt-online-schema-change \
  --alter "DROP INDEX idx_user_status" \
  --host=127.0.0.1 \
  --user=dba \
  --password='your_password' \
  --execute \
  D=mydb,t=orders
```

#### 修改列类型

```bash
pt-online-schema-change \
  --alter "MODIFY COLUMN remark VARCHAR(500) DEFAULT '' COMMENT '备注'" \
  --host=127.0.0.1 \
  --user=dba \
  --password='your_password' \
  --execute \
  D=mydb,t=orders
```

### pt-osc 的优势

1. **成熟稳定**：经过十几年生产验证
2. **支持外键**：通过 `--alter-foreign-keys-method` 处理外键依赖
3. **灵活控制**：丰富的负载控制参数
4. **原子切换**：`RENAME TABLE` 是原子操作

### pt-osc 的劣势

1. **触发器开销**：原表上的触发器会增加 DML 延迟
2. **触发器冲突**：如果原表已有触发器，处理起来复杂
3. **复制延迟**：大量 INSERT 触发器可能导致从库延迟
4. **外键处理复杂**：需要特殊处理外键引用

---

## 方案二：GitHub gh-ost

### 工作原理

gh-ost 是 GitHub 在 2016 年开源的在线 DDL 工具，采用完全不同的架构：

1. **创建影子表**：与 pt-osc 相同，创建新表并执行 DDL
2. **binlog 流式解析**：不使用触发器，而是通过解析 MySQL binlog 获取变更
3. **分批拷贝数据**：同样按主键范围分批拷贝
4. **应用 binlog 变更**：将解析到的 binlog 事件应用到影子表
5. **原子切换**：`RENAME TABLE` 交换，然后清理

### 安装

```bash
# macOS
brew install gh-ost

# 从 GitHub Release 下载
wget https://github.com/github/gh-ost/releases/latest/download/gh-ost-linux-amd64.tar.gz
tar xzf gh-ost-linux-amd64.tar.gz
sudo mv gh-ost /usr/local/bin/
```

### 实战用法

#### 基本用法：加字段

```bash
gh-ost \
  --host=127.0.0.1 \
  --port=3306 \
  --user=dba_user \
  --password='YourPassword' \
  --database=mydb \
  --table=orders \
  --alter="ADD COLUMN status TINYINT NOT NULL DEFAULT 0 COMMENT '状态'" \
  --chunk-size=1000 \
  --max-lag-millis=1500 \
  --throttle-control-replicas="slave1:3306,slave2:3306" \
  --initially-drop-ghost-table \
  --initially-drop-old-table \
  --serve-socket-file=/tmp/gh-ost.sock \
  --verbose \
  --execute
```

#### 使用阿里云 RDS

对于云数据库，通常无法直接读取 binlog，需要额外配置：

```bash
gh-ost \
  --host=rm-xxxxxx.mysql.rds.aliyuncs.com \
  --port=3306 \
  --user=dba_user \
  --password='YourPassword' \
  --database=mydb \
  --table=orders \
  --alter="ADD COLUMN status TINYINT NOT NULL DEFAULT 0" \
  --allow-on-master \
  --assume-master-host="rm-xxxxxx.mysql.rds.aliyuncs.com:3306" \
  --chunk-size=500 \
  --execute
```

#### 交互式控制

gh-ost 支持通过 Unix socket 进行实时交互控制：

```bash
# 查看进度
echo status | nc -U /tmp/gh-ost.sock

# 暂停迁移
echo throttle | nc -U /tmp/gh-ost.sock

# 恢复迁移
echo no-throttle | nc -U /tmp/gh-ost.sock

# 终止迁移
echo panic | nc -U /tmp/gh-ost.sock
```

#### 与 Telegram 集成监控

```bash
# 在迁移脚本中加入 webhook 通知
gh-ost \
  --host=127.0.0.1 \
  --user=dba \
  --password='your_password' \
  --database=mydb \
  --table=orders \
  --alter="ADD INDEX idx_created (created_at)" \
  --hooks-path=/opt/gh-ost/hooks \
  --execute

# hooks/before-ddl 文件示例
#!/bin/bash
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "text=gh-ost 开始执行 DDL: ${GH_OST_DATABASE}.${GH_OST_TABLE}"
```

### gh-ost 的优势

1. **无触发器**：通过 binlog 同步，不增加原表 DML 开销
2. **可暂停/恢复**：支持运行时动态控制
3. **更安全**：不会因为触发器失败导致数据不一致
4. **从库友好**：可以指定控制从库，减少主库压力
5. **实时进度**：精确的进度和 ETA 报告

### gh-ost 的劣势

1. **不支持外键**：这是设计决定，外键表需要先去掉外键
2. **binlog 格式要求**：需要 ROW 格式的 binlog
3. **资源消耗**：binlog 解析需要额外的 CPU 和内存
4. **切换瞬间**：最后的 cut-over 阶段会有极短暂的写阻塞

---

## 方案三：Laravel 原生迁移策略

### Laravel Migration 的痛点

Laravel 的迁移系统默认使用标准的 `ALTER TABLE`，在大表上直接执行会导致长时间锁表。但通过合理的策略，可以在应用层实现类似 Online DDL 的效果。

### 策略一：分步迁移 + 后台执行

将大迁移拆分为多个小步骤，利用 Laravel Queue 后台执行：

```php
<?php
// database/migrations/2026_06_09_add_status_to_orders.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 第一步：只添加列，使用 Instant DDL（MySQL 8.0+）
        Schema::table('orders', function (Blueprint $table) {
            $table->tinyInteger('status')->default(0)->comment('状态')->after('amount');
        });
        
        // 第二步：后台批量更新历史数据（如果有需要）
        // 通过 Queue 分批处理
        UpdateOrderStatusBatch::dispatch();
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }
};
```

### 策略二：使用 Doctrine DBAL 避免表重建

Laravel 默认使用 Doctrine DBAL 来判断是否需要重建表。确保安装正确版本：

```bash
composer require doctrine/dbal:^3.0
```

```php
<?php
// 正确的列修改方式——避免不必要的表重建
Schema::table('orders', function (Blueprint $table) {
    // 这些操作在 MySQL 8.0 上可以 Instant 完成
    $table->string('new_field', 100)->nullable()->after('amount');
    
    // 这些操作会触发 table rebuild，需要谨慎
    // $table->string('remark', 500)->change(); // 修改列类型
});
```

### 策略三：Ghost Column 模式（应用层蓝绿）

这是最安全的方式，适用于不能使用 pt-osc/gh-ost 的场景：

**Phase 1：添加新列（瞬间完成）**

```php
<?php
// Migration 1: 添加新列
Schema::table('orders', function (Blueprint $table) {
    $table->string('order_no_new', 32)->nullable()->after('order_no');
});
```

**Phase 2：双写（应用层同时写新旧列）**

```php
<?php
// app/Observers/OrderObserver.php

class OrderObserver
{
    public function creating(Order $order): void
    {
        // 双写阶段：同时写入新旧字段
        $order->order_no_new = $order->order_no_new ?? $order->order_no;
    }

    public function updating(Order $order): void
    {
        if ($order->isDirty('order_no')) {
            $order->order_no_new = $order->order_no;
        }
    }
}
```

**Phase 3：后台回填历史数据**

```php
<?php
// app/Jobs/BackfillOrderNoNew.php

class BackfillOrderNoNew implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 3600;

    public function handle(): void
    {
        $lastId = 0;
        $batchSize = 1000;

        while (true) {
            $orders = DB::table('orders')
                ->where('id', '>', $lastId)
                ->whereNull('order_no_new')
                ->orderBy('id')
                ->limit($batchSize)
                ->get(['id', 'order_no']);

            if ($orders->isEmpty()) {
                break;
            }

            foreach ($orders as $order) {
                DB::table('orders')
                    ->where('id', $order->id)
                    ->update(['order_no_new' => $order->order_no]);
            }

            $lastId = $orders->last()->id;

            // 控制速度，避免影响线上
            usleep(100000); // 100ms
        }
    }
}
```

**Phase 4：切换读取（灰度切流）**

```php
<?php
// app/Services/OrderService.php

class OrderService
{
    public function getOrderNo(Order $order): string
    {
        // 通过 Feature Flag 控制读取哪个字段
        if (Feature::active('use_new_order_no')) {
            return $order->order_no_new ?? $order->order_no;
        }
        
        return $order->order_no;
    }
}
```

**Phase 5：清理旧列**

```php
<?php
// Migration 2: 删除旧列（确认所有代码已切换后）
Schema::table('orders', function (Blueprint $table) {
    $table->dropColumn('order_no');
    $table->renameColumn('order_no_new', 'order_no');
});
```

### 策略四：Laravel + gh-ost 集成

在 Laravel 项目中集成 gh-ost，通过 Artisan 命令封装：

```php
<?php
// app/Console/Commands/GhostMigrate.php

namespace App\Console Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

class GhostMigrate extends Command
{
    protected $signature = 'db:ghost-migrate 
        {table : 表名} 
        {--alter= : ALTER 语句} 
        {--chunk-size=1000 : 每批行数}
        {--max-lag=1500 : 最大延迟毫秒}
        {--dry-run : 仅测试}';

    protected $description = '使用 gh-ost 执行在线 DDL 变更';

    public function handle(): int
    {
        $table = $this->argument('table');
        $alter = $this->option('alter');
        $dryRun = $this->option('dry-run');

        if (empty($alter)) {
            $this->error('必须指定 --alter 参数');
            return self::FAILURE;
        }

        $dbConfig = config('database.connections.mysql');
        
        $command = sprintf(
            'gh-ost --host=%s --port=%d --user=%s --password=%s --database=%s --table=%s --alter="%s" --chunk-size=%d --max-lag-millis=%d',
            $dbConfig['host'],
            $dbConfig['port'],
            $dbConfig['username'],
            escapeshellarg($dbConfig['password']),
            $dbConfig['database'],
            $table,
            $alter,
            $this->option('chunk-size'),
            $this->option('max-lag')
        );

        if ($dryRun) {
            $this->info("DRY RUN: {$command}");
            return self::SUCCESS;
        }

        $this->info("开始执行 gh-ost 迁移...");
        $this->info("表: {$table}");
        $this->info("变更: {$alter}");
        $this->newLine();

        $result = Process::timeout(86400) // 24小时超时
            ->env([
                'PATH' => '/usr/local/bin:/usr/bin:/bin',
            ])
            ->run($command, function (string $type, string $output) {
                $this->line($output);
            });

        if ($result->successful()) {
            $this->info('迁移完成！');
            return self::SUCCESS;
        }

        $this->error('迁移失败: ' . $result->errorOutput());
        return self::FAILURE;
    }
}
```

使用方式：

```bash
# 添加字段
php artisan db:ghost-migrate orders --alter="ADD COLUMN status TINYINT NOT NULL DEFAULT 0"

# 添加索引
php artisan db:ghost-migrate orders --alter="ADD INDEX idx_status_created (status, created_at)"

# 先测试
php artisan db:ghost-migrate orders --alter="ADD COLUMN test_col INT" --dry-run
```

---

## 三种方案深度对比

### 性能对比（5000 万行订单表）

| 指标 | pt-osc | gh-ost | Laravel 原生 |
|------|--------|--------|-------------|
| 执行时间 | 45-60 min | 50-70 min | 2-5 min (Instant) |
| 主库 CPU 增量 | +15-25% | +10-20% | +5% (仅回填) |
| 复制延迟峰值 | 3-10s | 1-3s | <1s |
| 磁盘临时空间 | 1x 表大小 | 1x 表大小 | 0 |
| 写阻塞时间 | ~0.5s | ~0.1s | 0 |

### 功能对比

| 功能 | pt-osc | gh-ost | Laravel |
|------|--------|--------|---------|
| 无触发器 | ❌ | ✅ | ✅ |
| 可暂停 | ❌ | ✅ | ✅ |
| 支持外键 | ✅ | ❌ | ✅ |
| 实时进度 | ✅ | ✅ | ❌ |
| 无需外部工具 | ❌ | ❌ | ✅ |
| binlog 依赖 | ❌ | ✅ | ❌ |
| 从库控制 | ❌ | ✅ | ❌ |

### 适用场景

**选 pt-osc**：
- 有外键依赖的表
- 不想额外配置 binlog
- 团队熟悉 Percona Toolkit
- 需要处理触发器冲突的特殊场景

**选 gh-ost**：
- 无外键（或已去掉外键）
- 需要暂停/恢复能力
- 主库负载敏感，需要精确控制
- 需要更好的可观测性

**选 Laravel 原生**：
- MySQL 8.0+，操作支持 Instant DDL
- 简单的加列操作
- 不想引入外部工具
- 配合 Ghost Column 模式处理复杂变更

---

## 踩坑记录

### 坑 1：pt-osc 触发器导致死锁

**现象**：执行 pt-osc 期间，业务出现大量死锁错误。

**原因**：pt-osc 创建的触发器在事务中执行额外的 INSERT/UPDATE，与业务事务产生锁竞争。

**解决**：
```bash
# 降低并发，增加间隔
pt-online-schema-change \
  --alter "ADD INDEX idx_created (created_at)" \
  --chunk-size=500 \
  --chunk-time=0.5 \
  --max-load="Threads_running=15" \
  --execute \
  D=mydb,t=orders
```

### 坑 2：gh-ost cut-over 失败

**现象**：gh-ost 数据拷贝完成，但最后切换失败，提示表被锁。

**原因**：切换时有长事务未提交，`RENAME TABLE` 无法获取元数据锁。

**解决**：
```bash
# 增加 cut-over 锁等待时间
gh-ost \
  --cut-over-lock-timeout-seconds=10 \
  --default-retries=3 \
  ...
```

或者在低峰期执行，并提前检查长事务：
```sql
-- 检查长事务
SELECT * FROM information_schema.innodb_trx 
WHERE TIMESTAMPDIFF(SECOND, trx_started, NOW()) > 60;
```

### 坑 3：Laravel 迁移超时

**现象**：`php artisan migrate` 执行大表 ALTER 超时。

**原因**：Laravel 默认的命令超时和 PHP 的 max_execution_time 限制。

**解决**：
```php
<?php
// 在 Migration 中设置超时
Schema::table('orders', function (Blueprint $table) {
    DB::statement('SET SESSION lock_wait_timeout = 60');
    DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
    
    $table->string('new_field', 100)->nullable();
});
```

```bash
# 执行时增加超时
php artisan migrate --timeout=3600
```

### 坑 4：磁盘空间不足

**现象**：gh-ost 执行到一半失败，提示磁盘空间不足。

**原因**：影子表 + binlog 临时文件需要额外空间。

**解决**：
```bash
# 提前检查空间（至少需要 1.5x 表大小）
df -h /var/lib/mysql

# 使用流式模式减少空间占用（gh-ost 1.1+）
gh-ost --chunk-size=5000 --initially-drop-ghost-table ...
```

### 坑 5：从库复制延迟导致数据不一致

**现象**：pt-osc 切换后，从库数据缺少最后几批数据。

**原因**：切换时从库还有未应用的 relay log。

**解决**：
```bash
# pt-osc：严格控制复制延迟
pt-online-schema-change \
  --max-lag=1s \
  --check-interval=1 \
  --recursion-method=processlist \
  ...

# gh-ost：指定控制从库
gh-ost \
  --throttle-control-replicas="slave1:3306" \
  --max-lag-millis=1000 \
  ...
```

---

## 生产环境最佳实践

### 1. 变更前检查清单

```bash
#!/bin/bash
# pre-migration-check.sh

TABLE=$1
DB=$2

echo "=== 迁移前检查 ==="

# 表大小
echo "表大小："
mysql -e "SELECT table_name, ROUND(data_length/1024/1024, 2) AS '数据MB', 
  ROUND(index_length/1024/1024, 2) AS '索引MB',
  table_rows AS '行数'
  FROM information_schema.tables 
  WHERE table_schema='${DB}' AND table_name='${TABLE}'"

# 检查是否有外键
echo "外键检查："
mysql -e "SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME 
  FROM information_schema.KEY_COLUMN_USAGE 
  WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='${TABLE}' 
  AND REFERENCED_TABLE_NAME IS NOT NULL"

# 检查触发器
echo "触发器检查："
mysql -e "SELECT TRIGGER_NAME, EVENT_MANIPULATION 
  FROM information_schema.TRIGGERS 
  WHERE EVENT_OBJECT_SCHEMA='${DB}' AND EVENT_OBJECT_TABLE='${TABLE}'"

# 检查长事务
echo "长事务检查："
mysql -e "SELECT trx_id, trx_state, trx_started, 
  TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_sec
  FROM information_schema.innodb_trx 
  WHERE TIMESTAMPDIFF(SECOND, trx_started, NOW()) > 30"

# 检查复制延迟
echo "复制延迟："
mysql -e "SHOW SLAVE STATUS\G" | grep -E "Seconds_Behind|Slave_SQL_Running"

echo "=== 检查完成 ==="
```

### 2. 迁移执行脚本模板

```bash
#!/bin/bash
# safe-migrate.sh

set -euo pipefail

DB="mydb"
TABLE="orders"
ALTER_STMT="ADD COLUMN status TINYINT NOT NULL DEFAULT 0"
LOG_FILE="/var/log/migration/$(date +%Y%m%d_%H%M%S)_${TABLE}.log"

mkdir -p /var/log/migration

echo "[$(date)] 开始迁移: ${DB}.${TABLE}" | tee -a "$LOG_FILE"
echo "[$(date)] 变更: ${ALTER_STMT}" | tee -a "$LOG_FILE"

# 执行 gh-ost
gh-ost \
  --host=127.0.0.1 \
  --port=3306 \
  --user=dba \
  --password="${DB_PASSWORD}" \
  --database="${DB}" \
  --table="${TABLE}" \
  --alter="${ALTER_STMT}" \
  --chunk-size=1000 \
  --max-lag-millis=1500 \
  --initially-drop-ghost-table \
  --initially-drop-old-table \
  --serve-socket-file="/tmp/gh-ost_${TABLE}.sock" \
  --verbose \
  --execute \
  2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date)] 迁移成功完成" | tee -a "$LOG_FILE"
else
  echo "[$(date)] 迁移失败，退出码: ${EXIT_CODE}" | tee -a "$LOG_FILE"
  # 发送告警
  curl -s -X POST "${WEBHOOK_URL}" \
    -H 'Content-Type: application/json' \
    -d "{\"text\": \"⚠️ 数据库迁移失败: ${DB}.${TABLE}\"}"
fi

exit $EXIT_CODE
```

### 3. 监控指标

迁移期间需要监控的关键指标：

```sql
-- 实时查看 gh-ost 进度
-- 通过 socket: echo status | nc -U /tmp/gh-ost.sock

-- 监控复制延迟
SHOW SLAVE STATUS\G

-- 监控锁等待
SELECT * FROM sys.innodb_lock_waits;

-- 监控 IO
-- iostat -x 1

-- 监控进程
SHOW PROCESSLIST;
```

---

## 总结

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 简单加列（MySQL 8.0） | Laravel 原生 | Instant DDL，零开销 |
| 复杂 DDL，无外键 | gh-ost | 无触发器，可暂停 |
| 有外键的表 | pt-osc | 唯一支持外键处理 |
| 需要精细控制 | gh-ost + Laravel Artisan | 最佳可观测性 |
| 云数据库（RDS） | gh-ost（allow-on-master） | 兼容性最好 |
| 应用层完全可控 | Ghost Column 模式 | 最安全，零依赖 |

**最终建议**：

1. **能用 Instant DDL 的，直接用 Laravel 原生迁移**
2. **需要 Online DDL 的，优先选 gh-ost**
3. **有外键约束的，用 pt-osc**
4. **关键业务表，用 Ghost Column 模式做最安全的演进**

Schema 演进不是一次性的事，而是持续的工程实践。建立规范的变更流程、选择合适的工具、做好监控告警，才能让数据库变更不再是「午夜惊魂」。
