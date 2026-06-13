---
title: PostgreSQL Logical Decoding 实战：wal2json/pgoutput 的自定义变更流——对比 Debezium 的轻量级 CDC 方案
keywords: [PostgreSQL Logical Decoding, wal2json, pgoutput, Debezium, CDC, 的自定义变更流, 的轻量级, 数据库]
date: 2026-06-09 18:28:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - PostgreSQL
  - CDC
  - Logical Decoding
  - wal2json
  - pgoutput
  - Debezium
  - Laravel
description: 深入 PostgreSQL Logical Decoding 机制，实战 wal2json 和 pgoutput 插件构建自定义变更数据捕获（CDC）流，并与 Debezium 方案进行对比，给出轻量级 CDC 的最佳实践。
---


## 概述

变更数据捕获（CDC, Change Data Capture）是现代数据架构中的关键组件。无论是实现实时数据同步、事件驱动架构、还是构建审计日志系统，CDC 都扮演着核心角色。

市面上的 CDC 方案众多，Debezium + Kafka 是最常见的重量级组合。但对于很多中小项目来说，这套方案的运维成本过高。PostgreSQL 原生的 **Logical Decoding** 机制提供了一条更轻量的路径——直接从 WAL（Write-Ahead Log）中提取变更事件，无需额外的消息中间件。

本文将深入讲解：
- PostgreSQL Logical Decoding 的工作原理
- wal2json 和 pgoutput 两个核心输出插件的实战用法
- 如何用 PHP/Laravel 构建自定义 CDC 消费者
- 与 Debezium 方案的全面对比

## 核心概念

### WAL 与 Logical Decoding

PostgreSQL 的 WAL（Write-Ahead Log）是其持久性的基石。每一次数据变更（INSERT/UPDATE/DELETE）都会先写入 WAL，再应用到数据页。

传统的物理复制（Streaming Replication）是逐字节复制整个 WAL 流，备库和主库必须是相同的大版本、相同的架构。而 **Logical Decoding** 则是在 WAL 的基础上做了一层逻辑解析——它把物理变更翻译成逻辑操作（"某行的某列从 A 变成了 B"），从而实现：

- 按表过滤
- 跨版本复制
- 自定义消费端

### 输出插件

Logical Decoding 本身只负责解析 WAL，输出格式由 **输出插件** 决定。PostgreSQL 生态中最常用的两个插件：

| 插件 | 特点 | 适用场景 |
|------|------|----------|
| **wal2json** | 输出 JSON 格式，灵活可配置 | 自定义消费端、Webhook、脚本处理 |
| **pgoutput** | PostgreSQL 10+ 内置，输出二进制协议 | 逻辑复制槽、Debezium、原生订阅 |

### 逻辑复制槽（Replication Slot）

逻辑复制槽是 PostgreSQL 维护的一个标记位，它跟踪消费者已经读取到 WAL 的哪个位置。只要复制槽存在，PostgreSQL 就会保留对应的 WAL 文件，防止消费者还没读就被清理。

⚠️ **重要警告**：如果消费者长时间不读取，WAL 文件会不断堆积，最终撑爆磁盘。生产环境必须监控复制槽的 lag。

## 前置配置

### 1. 修改 postgresql.conf

```ini
# 必须 >= logical
wal_level = logical

# 最大复制槽数（默认 10）
max_replication_slots = 10

# 最大 WAL 发送进程数
max_wal_senders = 10
```

修改后需要重启 PostgreSQL。

### 2. 安装 wal2json

```bash
# macOS (Homebrew)
brew install wal2json

# Ubuntu/Debian
sudo apt install postgresql-16-wal2json

# 从源码编译
git clone https://github.com/eulerto/wal2json.git
cd wal2json
make && make install
```

pgoutput 是内置的，无需额外安装。

### 3. 创建具有复制权限的用户

```sql
-- 创建专用用户
CREATE ROLE cdc_user WITH LOGIN REPLICATION PASSWORD 'secure_password';

-- 授权读取需要监控的表
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cdc_user;

-- 或者对特定表授权
GRANT SELECT ON orders, products, users TO cdc_user;
```

## 实战一：wal2json 自定义变更流

### 创建复制槽

```sql
-- 使用 wal2json 插件创建逻辑复制槽
SELECT pg_create_logical_replication_slot(
    'cdc_orders_slot',   -- 槽名
    'wal2json'           -- 输出插件
);
```

### 读取变更数据

```sql
-- 读取变更，输出 JSON
SELECT data FROM pg_logical_slot_get_changes(
    'cdc_orders_slot',   -- 槽名
    NULL,                -- LSN 起点（NULL = 从当前位置开始）
    -1,                  -1 表示读取所有可用变更）
    'pretty-print', '1',
    'include-lsn', '1',
    'add-msgprefixes', '1'
);
```

输出示例：

```json
{
  "change": [
    {
      "kind": "insert",
      "schema": "public",
      "table": "orders",
      "columnnames": ["id", "user_id", "total", "status", "created_at"],
      "columnvalues": [1001, 42, 299.00, "pending", "2026-06-09 18:00:00+08"],
      "lsn": "0/1A2B3C4",
      "xid": 12345
    }
  ]
}
```

### wal2json 配置参数

```sql
-- 只关注特定表
SELECT data FROM pg_logical_slot_get_changes(
    'cdc_orders_slot', NULL, -1,
    'filter-tables', 'public.logs,public.sessions',
    'add-tables', 'public.orders,public.products'
);

-- 包含旧值（UPDATE/DELETE 时）
SELECT data FROM pg_logical_slot_get_changes(
    'cdc_orders_slot', NULL, -1,
    'include-old', '1'
);

-- 包含事务信息
SELECT data FROM pg_logical_slot_get_changes(
    'cdc_orders_slot', NULL, -1,
    'include-transaction', '1',
    'write-in-chunks', '1'
);
```

### 用 Laravel 消费 wal2json 变更

创建一个 Artisan 命令来持续消费变更流：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Events\OrderStatusChanged;
use App\Events\InventoryUpdated;

class CdcConsumer extends Command
{
    protected $signature = 'cdc:consume {--slot=cdc_orders_slot : 复制槽名} {--batch=100 : 每批读取条数}';
    protected $description = '消费 PostgreSQL Logical Decoding 变更流';

    private array $tableHandlers = [
        'orders'   => 'handleOrderChange',
        'products' => 'handleProductChange',
        'users'    => 'handleUserChange',
    ];

    public function handle(): int
    {
        $slot = $this->option('slot');
        $batch = (int) $this->option('batch');

        $this->info("开始消费 CDC 变更流，槽: {$slot}");

        while (true) {
            try {
                $changes = DB::select(
                    "SELECT data FROM pg_logical_slot_get_changes(?, NULL, ?, 
                     'pretty-print', '1', 'include-lsn', '1', 'include-old', '1')",
                    [$slot, $batch]
                );

                foreach ($changes as $row) {
                    $this->processChange(json_decode($row->data, true));
                }

                if (empty($changes)) {
                    // 没有新变更，等待 1 秒
                    sleep(1);
                }
            } catch (\Throwable $e) {
                $this->error("CDC 消费异常: {$e->getMessage()}");
                report($e);
                sleep(5);
            }
        }

        return self::SUCCESS;
    }

    private function processChange(array $data): void
    {
        foreach ($data['change'] ?? [] as $change) {
            $table = $change['table'];
            $kind = $change['kind']; // insert / update / delete

            $this->line("[{$kind}] {$table} #" . ($change['columnvalues'][0] ?? '?'));

            if (isset($this->tableHandlers[$table])) {
                $handler = $this->tableHandlers[$table];
                $this->$handler($change);
            }
        }
    }

    private function handleOrderChange(array $change): void
    {
        if ($change['kind'] === 'update') {
            $columns = array_combine($change['columnnames'], $change['columnvalues']);
            $oldColumns = [];
            if (!empty($change['oldkeys'])) {
                $oldColumns = array_combine(
                    $change['oldkeys']['keynames'],
                    $change['oldkeys']['keyvalues']
                );
            }

            // 检测状态变更
            if (isset($oldColumns['status'], $columns['status'])
                && $oldColumns['status'] !== $columns['status']
            ) {
                event(new OrderStatusChanged(
                    orderId: $columns['id'],
                    oldStatus: $oldColumns['status'],
                    newStatus: $columns['status'],
                ));
            }
        }
    }

    private function handleProductChange(array $change): void
    {
        if ($change['kind'] === 'update') {
            $columns = array_combine($change['columnnames'], $change['columnvalues']);

            // 库存变更事件
            if (isset($columns['stock'])) {
                event(new InventoryUpdated(
                    productId: $columns['id'],
                    newStock: $columns['stock'],
                ));
            }
        }
    }

    private function handleUserChange(array $change): void
    {
        // 用户变更日志写入审计表
        DB::table('audit_logs')->insert([
            'table_name' => 'users',
            'action'     => $change['kind'],
            'record_id'  => $change['columnvalues'][0] ?? null,
            'data'       => json_encode($change),
            'created_at' => now(),
        ]);
    }
}
```

### 注册到 Supervisor

```ini
[program:cdc-consumer]
command=php /var/www/artisan cdc:consume --slot=cdc_orders_slot
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/cdc-consumer.log
```

## 实战二：pgoutput 原生逻辑复制

pgoutput 是 PostgreSQL 10+ 内置的输出插件，使用 PostgreSQL 的逻辑复制协议。它更适合与原生逻辑订阅配合使用。

### 使用原生逻辑订阅

```sql
-- 在发布端创建发布
CREATE PUBLICATION cdc_pub FOR TABLE orders, products;

-- 在订阅端创建订阅（可以是同一实例的不同数据库）
CREATE SUBSCRIPTION cdc_sub
    CONNECTION 'host=localhost dbname=mydb user=cdc_user password=your_password'
    PUBLICATION cdc_pub;
```

### 直接消费 pgoutput 流

pgoutput 输出的是二进制协议，直接解析比较复杂。在实际项目中，通常有两种方式：

**方式一：通过 pg_recvlogical 转储**

```bash
# 使用 pg_recvlogical 接收 pgoutput 流并保存
pg_recvlogical -d mydb \
    --slot=cdc_pg_slot \
    --start \
    -f - \
    --plugin=pgoutput
```

**方式二：使用 PHP 的 PostgreSQL 流复制 API**

```php
<?php

namespace App\Services\CDC;

use PgSql\Connection;

class PgOutputConsumer
{
    private Connection $conn;
    private string $slotName;
    private string $publicationName;

    public function __construct(
        string $dsn,
        string $slotName = 'cdc_pg_slot',
        string $publicationName = 'cdc_pub'
    ) {
        $this->conn = pg_connect($dsn, PGSQL_CONNECT_REPLICATION);
        $this->slotName = $slotName;
        $this->publicationName = $publicationName;
    }

    public function createSlot(): void
    {
        $result = pg_query($this->conn, sprintf(
            "CREATE_REPLICATION_SLOT %s LOGICAL pgoutput",
            pg_escape_identifier($this->conn, $this->slotName)
        ));

        if (!$result) {
            throw new \RuntimeException(
                "创建复制槽失败: " . pg_last_error($this->conn)
            );
        }
    }

    public function consume(callable $callback): void
    {
        $startLsn = $this->getSlotLsn();
        $result = pg_query($this->conn, sprintf(
            "START_REPLICATION SLOT %s LOGICAL %s (proto_version '1', publication_names '%s')",
            pg_escape_identifier($this->conn, $this->slotName),
            pg_escape_string($this->conn, $startLsn),
            pg_escape_string($this->conn, $this->publicationName)
        ));

        if (!$result) {
            throw new \RuntimeException(
                "启动复制失败: " . pg_last_error($this->conn)
            );
        }

        while (true) {
            $raw = pg_get_copy_data($this->conn, true, 10); // 10s timeout

            if ($raw === false) {
                throw new \RuntimeException("复制连接断开");
            }

            if ($raw === -1) {
                // 超时，发送心跳
                $this->sendStandbyStatus();
                continue;
            }

            $type = $raw[0];
            $message = substr($raw, 1);

            switch ($type) {
                case 'w': // WAL 数据
                    $this->handleWalData($message, $callback);
                    break;
                case 'k': // 心跳确认
                    $this->handleKeepalive($message);
                    break;
            }
        }
    }

    private function handleWalData(string $data, callable $callback): void
    {
        // pgoutput 二进制协议解析（简化版）
        // 实际生产中建议使用 amphp/postgres 或 pgoutput-decode 库
        $lsn = unpack('Nhigh/Nlow', substr($data, 0, 8));
        $lsnStr = sprintf('%X/%08X', $lsn['high'], $lsn['low']);

        // 跳过 serverTime (8 bytes) + walEnd (8 bytes)
        $relationId = unpack('N', substr($data, 25, 4));

        $callback([
            'lsn' => $lsnStr,
            'relation_id' => $relationId[1],
            'raw' => $data,
        ]);
    }

    private function getSlotLsn(): string
    {
        $result = pg_query($this->conn, sprintf(
            "SELECT confirmed_flush_lsn FROM pg_replication_slots WHERE slot_name = '%s'",
            pg_escape_string($this->conn, $this->slotName)
        ));

        $row = pg_fetch_assoc($result);
        return $row['confirmed_flush_lsn'] ?? '0/0';
    }

    private function sendStandbyStatus(): void
    {
        // 发送 Standby Status Update 确认已接收的 LSN
        pg_put_copy_data($this->conn, 'r' . pack('NN', 0, 0) . pack('NN', 0, 0) . pack('NN', 0, 0) . pack('N', time()));
    }
}
```

### 使用第三方库简化 pgoutput 解析

对于生产环境，推荐使用成熟的解码库：

```bash
composer require event-machine/pg-output-decode
```

```php
<?php

use EventMachine\PgOutputDecode\Decoder;
use EventMachine\PgOutputDecode\Message\Relation;
use EventMachine\PgOutputDecode\Message\Insert;
use EventMachine\PgOutputDecode\Message\Update;
use EventMachine\PgOutputDecode\Message\Delete;

$decoder = new Decoder();

$messages = $decoder->decode($binaryData);
foreach ($messages as $msg) {
    match (true) {
        $msg instanceof Relation => $this->registerRelation($msg),
        $msg instanceof Insert   => $this->handleInsert($msg),
        $msg instanceof Update   => $this->handleUpdate($msg),
        $msg instanceof Delete   => $this->handleDelete($msg),
    };
}
```

## 实战三：Laravel 集成方案

### CDC 服务类封装

```php
<?php

namespace App\Services\CDC;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PostgresCDC
{
    private string $slotName;

    public function __construct(string $slotName = 'app_cdc_slot')
    {
        $this->slotName = $slotName;
    }

    /**
     * 创建逻辑复制槽
     */
    public function createSlot(string $plugin = 'wal2json'): bool
    {
        try {
            DB::select("SELECT pg_create_logical_replication_slot(?, ?)", [
                $this->slotName,
                $plugin,
            ]);
            return true;
        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'already exists')) {
                return true; // 槽已存在，视为成功
            }
            throw $e;
        }
    }

    /**
     * 获取变更（非阻塞，单次调用）
     */
    public function getChanges(int $limit = 1000, array $options = []): array
    {
        $params = [$this->slotName, $limit];
        $optionClauses = [];

        $defaults = [
            'pretty-print'  => '1',
            'include-lsn'   => '1',
            'include-old'   => '1',
            'write-in-chunks' => '0',
        ];

        $options = array_merge($defaults, $options);
        foreach ($options as $key => $value) {
            $optionClauses[] = "?, ?";
            $params[] = $key;
            $params[] = $value;
        }

        $optionStr = implode(', ', $optionClauses);
        $rows = DB::select(
            "SELECT data FROM pg_logical_slot_get_changes(?, NULL, ?, {$optionStr})",
            $params
        );

        return array_map(
            fn($row) => json_decode($row->data, true),
            $rows
        );
    }

    /**
     * 查看变更（不消费，只预览）
     */
    public function peekChanges(int $limit = 10): array
    {
        $rows = DB::select(
            "SELECT data FROM pg_logical_slot_peek_changes(?, NULL, ?)",
            [$this->slotName, $limit]
        );

        return array_map(
            fn($row) => json_decode($row->data, true),
            $rows
        );
    }

    /**
     * 获取复制槽状态
     */
    public function getSlotStatus(): ?array
    {
        $rows = DB::select("
            SELECT 
                slot_name,
                plugin,
                active,
                restart_lsn,
                confirmed_flush_lsn,
                pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
            FROM pg_replication_slots 
            WHERE slot_name = ?
        ", [$this->slotName]);

        return $rows[0] ?? null;
    }

    /**
     * 删除复制槽
     */
    public function dropSlot(): bool
    {
        DB::select("SELECT pg_drop_replication_slot(?)", [$this->slotName]);
        return true;
    }

    /**
     * 健康检查：lag 是否在安全范围内
     */
    public function isHealthy(int $maxLagBytes = 100 * 1024 * 1024): bool
    {
        $status = $this->getSlotStatus();

        if (!$status || !$status->active) {
            return false;
        }

        return abs((int) $status->lag_bytes) < $maxLagBytes;
    }
}
```

### 事件分发中间件

```php
<?php

namespace App\Services\CDC;

use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;

class CDCEventDispatcher
{
    private array $mapping = [];

    public function register(string $table, string $eventClass, ?callable $transformer = null): static
    {
        $this->mapping[$table][] = [
            'event'       => $eventClass,
            'transformer' => $transformer,
        ];
        return $this;
    }

    public function dispatch(array $change): void
    {
        $table = $change['table'] ?? null;
        if (!$table || !isset($this->mapping[$table])) {
            return;
        }

        $columns = array_combine(
            $change['columnnames'] ?? [],
            $change['columnvalues'] ?? []
        );

        $oldColumns = [];
        if (!empty($change['oldkeys'])) {
            $oldColumns = array_combine(
                $change['oldkeys']['keynames'] ?? [],
                $change['oldkeys']['keyvalues'] ?? []
            );
        }

        foreach ($this->mapping[$table] as $handler) {
            $transformer = $handler['transformer'];
            $payload = $transformer
                ? $transformer($columns, $oldColumns, $change['kind'])
                : $columns;

            Event::dispatch(new $handler['event']($payload, $change['kind'], $oldColumns));
        }
    }
}
```

### 注册服务提供者

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Services\CDC\PostgresCDC;
use App\Services\CDC\CDCEventDispatcher;
use App\Events\OrderStatusChanged;
use App\Events\InventoryUpdated;

class CDCServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PostgresCDC::class, function ($app) {
            return new PostgresCDC(config('cdc.slot_name', 'app_cdc_slot'));
        });

        $this->app->singleton(CDCEventDispatcher::class, function () {
            $dispatcher = new CDCEventDispatcher();

            $dispatcher->register('orders', OrderStatusChanged::class, function ($cols, $old, $kind) {
                return [
                    'order_id'   => $cols['id'],
                    'old_status' => $old['status'] ?? null,
                    'new_status' => $cols['status'],
                    'kind'       => $kind,
                ];
            });

            $dispatcher->register('products', InventoryUpdated::class, function ($cols) {
                return [
                    'product_id' => $cols['id'],
                    'stock'      => $cols['stock'],
                ];
            });

            return $dispatcher;
        });
    }
}
```

## 踩坑记录

### 1. 复制槽撑爆磁盘

这是最常见的问题。如果消费者停止消费但复制槽还在，PostgreSQL 会无限保留 WAL 文件。

**监控脚本**：

```sql
-- 查看复制槽 lag
SELECT 
    slot_name,
    active,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS consumer_lag
FROM pg_replication_slots;
```

**自动清理策略**（Laravel 命令）：

```php
// 检测不活跃的复制槽，超过 24 小时未活跃则告警
$slots = DB::select("SELECT slot_name, active FROM pg_replication_slots");
foreach ($slots as $slot) {
    if (!$slot->active) {
        Log::warning("CDC 复制槽 {$slot->slot_name} 不活跃，可能导致 WAL 堆积");
        // 可选：自动删除
        // DB::select("SELECT pg_drop_replication_slot(?)", [$slot->slot_name]);
    }
}
```

### 2. 大事务导致内存溢出

一个包含百万行 UPDATE 的事务，会一次性产生海量变更事件。

**解决方案**：使用 `write-in-chunks` 参数分块读取：

```sql
SELECT data FROM pg_logical_slot_get_changes(
    'cdc_slot', NULL, -1,
    'write-in-chunks', '1'
);
```

配合 `include-transaction` 参数，可以识别事务边界，按事务粒度处理。

### 3. 表结构变更导致解码失败

ALTER TABLE 添加列后，wal2json 的输出格式会变化。消费者端需要做 schema 兼容处理。

**防御性代码**：

```php
private function safeColumnValue(array $columns, string $key, mixed $default = null): mixed
{
    return $columns[$key] ?? $default;
}
```

### 4. TOAST 字段的坑

PostgreSQL 对大字段使用 TOAST 存储。在 UPDATE 时，如果 TOAST 值没有变化，wal2json 不会包含该字段的值（只有 `unchanged-toast` 标记）。

**处理方式**：

```php
if (isset($change['toast'])) {
    // 有 TOAST 字段未展开，需要从数据库重新读取
    $record = DB::table($table)->find($id);
}
```

### 5. pgoutput 的 schema 缓存

pgoutput 在连接开始时发送 Relation 消息来描述表结构。如果连接中途表结构变了，需要重新建立连接。确保消费者有重连机制。

## Debezium 对比

| 维度 | PostgreSQL Logical Decoding (本文方案) | Debezium + Kafka |
|------|----------------------------------------|------------------|
| **架构复杂度** | 低（只需 PostgreSQL） | 高（Kafka + Connect + 监控） |
| **运维成本** | 低 | 高（ZooKeeper/KRaft、分区、副本） |
| **延迟** | 毫秒级 | 秒级（经过 Kafka 中转） |
| **数据格式** | wal2json JSON / pgoutput 二进制 | Avro / JSON Schema |
| **Exactly-Once** | 需要自行实现 | Kafka 事务 + 偏移量提交 |
| **多消费者** | 每个消费者需要独立复制槽 | Topic 天然支持多消费者 |
| **Schema 演化** | 需要自行处理 | Schema Registry 自动管理 |
| **回放能力** | 复制槽有 WAL 保留 | Kafka 保留策略可配 |
| **水平扩展** | 单实例限制 | Kafka 分区天然支持 |
| **适用场景** | 小团队、简单同步、Webhook | 大规模、多下游、事件驱动架构 |

### 什么时候选 Debezium？

- 需要多个下游系统同时消费同一变更流
- 需要 Exactly-Once 语义保证
- 已有 Kafka 基础设施
- 需要 Schema Registry 管理数据格式演化
- 变更量非常大（百万级/小时）

### 什么时候用 Logical Decoding？

- 只需要一两个消费者
- 不想引入 Kafka 的运维复杂度
- 团队规模小，追求简单
- 需要极低延迟
- 做审计日志、Webhook 通知等轻量场景

## 生产环境建议

### 复制槽监控（Prometheus + Grafana）

```yaml
# postgres_exporter 查询
- record: pg_replication_slot_lag_bytes
  expr: pg_wal_lsn_diff(pg_current_wal_lsn(), pg_replication_slots_confirmed_flush_lsn)
```

告警规则：lag > 100MB 持续 5 分钟触发告警。

### 健康检查端点

```php
Route::get('/health/cdc', function (PostgresCDC $cdc) {
    $status = $cdc->getSlotStatus();

    if (!$status) {
        return response()->json(['status' => 'error', 'message' => '复制槽不存在'], 503);
    }

    return response()->json([
        'status'         => $status->active ? 'ok' : 'inactive',
        'lag_bytes'      => (int) $status->lag_bytes,
        'lag_pretty'     => formatBytes(abs((int) $status->lag_bytes)),
        'restart_lsn'    => $status->restart_lsn,
        'flush_lsn'      => $status->confirmed_flush_lsn,
    ], $status->active ? 200 : 503);
});
```

### 容灾方案

```php
// 复制槽备份：定期导出槽状态
public function backupSlotState(): array
{
    $status = $this->getSlotStatus();
    Cache::put('cdc_slot_backup', [
        'lsn'    => $status->confirmed_flush_lsn,
        'time'   => now()->toIso8601String(),
    ], now()->addDays(7));
    
    return $status;
}

// 恢复时：从备份的 LSN 位置重新开始
public function restoreFromBackup(): void
{
    $backup = Cache::get('cdc_slot_backup');
    if ($backup) {
        // 创建新槽并设置起始位置
        Log::info("CDC 从备份恢复，LSN: {$backup['lsn']}");
    }
}
```

## 总结

PostgreSQL Logical Decoding 是一个被低估的 CDC 方案。对于中小项目来说，它提供了足够的能力来实现变更数据捕获，同时避免了 Debezium + Kafka 的复杂度。

**核心要点**：
1. wal2json 适合自定义消费场景，输出灵活、易于调试
2. pgoutput 适合与逻辑订阅配合，或接入 Debezium
3. 复制槽的 lag 监控是运维的重中之重，必须有告警机制
4. 大事务、TOAST、Schema 变更是三大坑点，需要提前防御
5. 对于简单的同步和 Webhook 场景，Logical Decoding 比 Debezium 更轻量、更直接

选型建议：先用 Logical Decoding + wal2json 快速验证，等到确实需要多消费者、Exactly-Once、Schema Registry 时再引入 Debezium。架构演进应该是渐进式的，而不是一开始就上最重的方案。
