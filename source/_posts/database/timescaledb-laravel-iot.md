---

title: TimescaleDB 实战：时序数据库在 Laravel 中的集成——IoT 数据、用户行为分析与物化视图踩坑记录
keywords: [TimescaleDB, Laravel, IoT, 时序数据库在, 中的集成, 数据, 用户行为分析与物化视图踩坑记录]
date: 2026-06-02 12:00:00
tags:
- TimescaleDB
- PostgreSQL
- Laravel
- IoT
- 数据库
- hypertable
- continuous-aggregate
- 物化视图
categories:
- database
description: TimescaleDB 在 Laravel 项目中的完整集成实战：Hypertable 建表、IoT 传感器批量写入优化（COPY 命令 10 万行/秒）、用户行为漏斗与留存分析、连续聚合物化视图配置、7 个生产踩坑与性能调优 Checklist，附 Docker Compose 环境与 Eloquent 代码示例。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---





## 前言

在构建现代 Web 应用时，我们经常会遇到一个尴尬的场景：业务数据用 MySQL/PostgreSQL 处理得游刃有余，但一旦涉及到**时间序列数据**——传感器读数、用户行为事件、系统日志、金融行情——传统关系型数据库就开始力不从心。数据量动辄数十亿行，按时间范围查询需要扫描大量数据，索引膨胀导致写入性能急剧下降。

TimescaleDB 正是为解决这一痛点而生的。作为 PostgreSQL 的扩展，它在不改变 SQL 语法的前提下，将时序数据的写入性能提升了 10-100 倍，查询速度提升了 10-1000 倍。更重要的是，它与 Laravel 的 PostgreSQL 驱动无缝集成——**你不需要安装任何新的 PHP 扩展**。

本文将从零开始，记录我在一个真实的 IoT 项目中集成 TimescaleDB 的全过程，包括数据建模、批量写入优化、连续聚合、保留策略配置，以及踩过的每一个坑。

---

## 一、时序数据库选型对比

### 1.1 为什么需要专用时序数据库？

传统的 PostgreSQL/MySQL 在处理时序数据时面临以下挑战：

1. **写入瓶颈**：每秒数万条 INSERT 操作会导致索引膨胀、WAL 日志压力大
2. **查询性能**：按时间范围查询需要扫描大量数据，即使有索引也很难优化
3. **数据老化**：旧数据的管理（压缩、删除）需要复杂的分区策略
4. **聚合分析**：时间窗口聚合（按小时/天/月汇总）需要编写复杂的 SQL

### 1.2 主流时序数据库对比

| 特性 | TimescaleDB | InfluxDB | QuestDB | ClickHouse |
|------|-------------|----------|---------|------------|
| 底层存储 | PostgreSQL | 自研 TSM | 列式存储 | 列式存储 |
| SQL 兼容 | 完全兼容 PG SQL | InfluxQL / Flux | SQL（部分） | SQL（方言） |
| 事务支持 | ✅（完整 ACID） | ❌ | ❌ | ❌ |
| JOIN 支持 | ✅（与 PG 表） | ❌ | 有限 | ✅ |
| 压缩率 | 10-20x | 10-20x | 10-50x | 10-100x |
| 写入速度 | 50-100 万行/秒 | 30-80 万行/秒 | 100-500 万行/秒 | 100-500 万行/秒 |
| 查询延迟 | 毫秒级 | 毫秒级 | 毫秒级 | 秒级 |
| 生态成熟度 | ★★★★★ | ★★★★ | ★★★ | ★★★★ |
| ORM 集成 | Eloquent 原生 | 需要自定义驱动 | 需要自定义驱动 | 需要自定义驱动 |
| 运维复杂度 | 低（PG 插件） | 中 | 中 | 高 |
| 许可证 | Apache 2.0 + Timescale License | MIT / Elastic 2.0 | Apache 2.0 | Apache 2.0 |

**选择 TimescaleDB 的核心理由**：

1. **零学习成本**：完全兼容 PostgreSQL，Laravel Eloquent 原生支持
2. **事务一致性**：支持完整 ACID，适合需要事务的业务场景
3. **混合工作负载**：同一数据库同时处理时序数据和业务数据，无需 ETL
4. **运维简单**：作为 PostgreSQL 扩展安装，不需要额外的运维技能

---

## 二、TimescaleDB 核心概念

### 2.1 Hypertable（超级表）

Hypertable 是 TimescaleDB 的核心抽象。表面上它是一张普通的 PostgreSQL 表，但底层 TimescaleDB 会自动将其按时间维度分区为多个 Chunk（数据块）。

```sql
-- 创建普通 PostgreSQL 表
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   INTEGER NOT NULL,
    temperature DOUBLE PRECISION,
    humidity    DOUBLE PRECISION,
    pressure    DOUBLE PRECISION
);

-- 转换为 Hypertable（自动按时间分区）
SELECT create_hypertable('sensor_data', 'time');

-- 自定义 Chunk 间隔（默认 7 天）
SELECT create_hypertable(
    'sensor_data',
    'time',
    chunk_time_interval => INTERVAL '1 day'
);
```

### 2.2 Chunk（数据块）

Chunk 是 Hypertable 的物理存储单元。每个 Chunk 覆盖一个时间范围，TimescaleDB 会自动创建新的 Chunk 并管理旧 Chunk。

```
sensor_data (Hypertable)
├── _hyper_1_chunk_1  (2026-01-01 ~ 2026-01-02)
├── _hyper_1_chunk_2  (2026-01-02 ~ 2026-01-03)
├── _hyper_1_chunk_3  (2026-01-03 ~ 2026-01-04)
└── ...（自动创建）
```

### 2.3 压缩策略

TimescaleDB 支持对旧 Chunk 进行列式压缩，压缩率通常可达 10-20 倍：

```sql
-- 启用压缩
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- 自动压缩超过 7 天的 Chunk
SELECT add_compression_policy('sensor_data', INTERVAL '7 days');
```

### 2.4 连续聚合（Continuous Aggregates）

连续聚合是 TimescaleDB 最强大的特性之一——它会在后台自动维护一个物化视图，增量更新聚合结果：

```sql
-- 创建连续聚合：每小时温度平均值
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(temperature) AS avg_temp,
    MAX(temperature) AS max_temp,
    MIN(temperature) AS min_temp,
    AVG(humidity) AS avg_humidity,
    COUNT(*) AS sample_count
FROM sensor_data
GROUP BY bucket, sensor_id;
```

### 2.5 保留策略（Retention Policy）

自动删除过期数据，无需手动清理：

```sql
-- 自动删除超过 90 天的数据
SELECT add_retention_policy('sensor_data', INTERVAL '90 days');
```

---

## 三、Laravel 集成

### 3.1 Docker Compose 本地开发环境

```yaml
# docker-compose.yml
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    container_name: laravel-timescaledb
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: laravel_iot
      POSTGRES_USER: laravel
      POSTGRES_PASSWORD: secret
    volumes:
      - timescaledb-data:/var/lib/postgresql/data
      - ./docker/timescaledb/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U laravel -d laravel_iot"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  # PostgreSQL 管理工具
  pgadmin:
    image: dpage/pgadmin4:latest
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@example.com
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    depends_on:
      - timescaledb

volumes:
  timescaledb-data:
```

初始化 SQL：

```sql
-- docker/timescaledb/init.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 验证扩展
SELECT default_version, installed_version 
FROM pg_available_extensions 
WHERE name = 'timescaledb';
```

### 3.2 Laravel 数据库配置

```php
<?php
// config/database.php
'connections' => [
    'pgsql' => [
        'driver' => 'pgsql',
        'url' => env('DATABASE_URL'),
        'host' => env('DB_HOST', '127.0.0.1'),
        'port' => env('DB_PORT', '5432'),
        'database' => env('DB_DATABASE', 'laravel_iot'),
        'username' => env('DB_USERNAME', 'laravel'),
        'password' => env('DB_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'prefix_indexes' => true,
        'search_path' => 'public',
        'sslmode' => 'prefer',
        'options' => [
            // 针对时序数据的优化
            PDO::ATTR_PERSISTENT => true,
            PDO::ATTR_EMULATE_PREPARES => false,
        ],
    ],
    
    // 分析数据库（TimescaleDB）
    'timescaledb' => [
        'driver' => 'pgsql',
        'host' => env('TIMESCALEDB_HOST', '127.0.0.1'),
        'port' => env('TIMESCALEDB_PORT', '5432'),
        'database' => env('TIMESCALEDB_DATABASE', 'laravel_iot'),
        'username' => env('TIMESCALEDB_USERNAME', 'laravel'),
        'password' => env('TIMESCALEDB_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'options' => [
            PDO::ATTR_PERSISTENT => true,
        ],
    ],
],
```

```env
# .env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=laravel_iot
DB_USERNAME=laravel
DB_PASSWORD=secret

TIMESCALEDB_HOST=127.0.0.1
TIMESCALEDB_PORT=5432
TIMESCALEDB_DATABASE=laravel_iot
TIMESCALEDB_USERNAME=laravel
TIMESCALEDB_PASSWORD=secret
```

### 3.3 Migration 创建 Hypertable

Laravel 的 Migration 系统原生支持 PostgreSQL，创建 Hypertable 只需要在 Migration 中调用 `SELECT create_hypertable()`：

```php
<?php
// database/migrations/2026_06_02_000001_create_sensor_data_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sensor_data', function (Blueprint $table) {
            $table->timestampTz('time')->nullable(false);
            $table->integer('sensor_id')->nullable(false);
            $table->double('temperature')->nullable();
            $table->double('humidity')->nullable();
            $table->double('pressure')->nullable();
            $table->jsonb('metadata')->nullable();
            
            // 注意：Hypertable 不支持传统的主键
            // 改用复合索引
            $table->index(['time', 'sensor_id']);
        });

        // 转换为 Hypertable
        DB::statement("SELECT create_hypertable('sensor_data', 'time', chunk_time_interval => INTERVAL '1 day')");

        // 启用压缩
        DB::statement("ALTER TABLE sensor_data SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'sensor_id',
            timescaledb.compress_orderby = 'time DESC'
        )");

        // 自动压缩超过 7 天的 Chunk
        DB::statement("SELECT add_compression_policy('sensor_data', INTERVAL '7 days')");

        // 自动删除超过 90 天的数据
        DB::statement("SELECT add_retention_policy('sensor_data', INTERVAL '90 days')");
    }

    public function down(): void
    {
        Schema::dropIfExists('sensor_data');
    }
};
```

**踩坑 #1**：Hypertable **不支持传统的自增主键**。如果你在 Migration 中使用了 `$table->id()` 或 `$table->primary()`，`create_hypertable()` 会报错。解决方案是使用复合唯一索引代替主键：

```php
// ❌ 错误做法
$table->id();
$table->timestampTz('time');
// create_hypertable 会失败：Hypertable doesn't support unique constraints without time dimension

// ✅ 正确做法
$table->timestampTz('time');
$table->integer('sensor_id');
$table->unique(['time', 'sensor_id']); // 包含时间列的唯一约束是可以的
```

**踩坑 #2**：Hypertable 的 `chunk_time_interval` 选择很重要。太小（如 1 小时）会导致 Chunk 数量爆炸，太大（如 30 天）会导致查询需要扫描过多数据。经验法则：

| 数据写入频率 | 推荐 Chunk 间隔 |
|-------------|----------------|
| < 1000 行/秒 | 1 周 |
| 1000-10000 行/秒 | 1 天 |
| 10000-100000 行/秒 | 1 小时 |
| > 100000 行/秒 | 15 分钟 |

---

## 四、IoT 数据场景实战

### 4.1 Eloquent Model 定义

```php
<?php
// app/Models/SensorData.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;

class SensorData extends Model
{
    protected $connection = 'timescaledb';
    protected $table = 'sensor_data';
    
    // Hypertable 没有自增主键
    public $incrementing = false;
    public $timestamps = false;

    protected $casts = [
        'time' => 'datetime',
        'temperature' => 'float',
        'humidity' => 'float',
        'pressure' => 'float',
        'metadata' => 'array',
    ];

    protected $fillable = [
        'time',
        'sensor_id',
        'temperature',
        'humidity',
        'pressure',
        'metadata',
    ];

    // 按传感器查询
    public function scopeForSensor(Builder $query, int $sensorId): Builder
    {
        return $query->where('sensor_id', $sensorId);
    }

    // 按时间范围查询
    public function scopeBetween(Builder $query, $from, $to): Builder
    {
        return $query->whereBetween('time', [$from, $to]);
    }

    // 最近 N 小时的数据
    public function scopeRecent(Builder $query, int $hours = 24): Builder
    {
        return $query->where('time', '>=', now()->subHours($hours));
    }
}
```

### 4.2 批量写入优化

**踩坑 #3**：使用 Eloquent 的 `create()` 方法逐条插入时序数据是性能灾难。每次 INSERT 都需要一次数据库往返，在高吞吐场景下根本无法满足需求。

#### 方式一：DB::table 批量插入

```php
<?php

use Illuminate\Support\Facades\DB;

class SensorDataIngestionService
{
    /**
     * 批量写入传感器数据
     * 性能：约 5000-10000 行/秒
     */
    public function batchInsert(array $readings): void
    {
        $chunks = array_chunk($readings, 1000); // 每 1000 条一批
        
        foreach ($chunks as $chunk) {
            DB::connection('timescaledb')
                ->table('sensor_data')
                ->insert($chunk);
        }
    }
}

// 使用示例
$readings = [];
foreach ($sensorReadings as $reading) {
    $readings[] = [
        'time' => $reading->timestamp,
        'sensor_id' => $reading->sensorId,
        'temperature' => $reading->temperature,
        'humidity' => $reading->humidity,
        'pressure' => $reading->pressure,
        'metadata' => json_encode($reading->metadata),
    ];
}

$service->batchInsert($readings);
```

#### 方式二：COPY 命令（推荐，最高性能）

```php
<?php

class SensorDataCopyIngestionService
{
    /**
     * 使用 PostgreSQL COPY 命令批量写入
     * 性能：约 50000-100000 行/秒
     */
    public function copyInsert(array $readings): void
    {
        $connection = DB::connection('timescaledb');
        $pdo = $connection->getPdo();
        
        // 生成 CSV 格式的临时数据
        $csv = tmpfile();
        foreach ($readings as $reading) {
            fputcsv($csv, [
                $reading['time'],
                $reading['sensor_id'],
                $reading['temperature'],
                $reading['humidity'],
                $reading['pressure'],
                $reading['metadata'] ?? '{}',
            ]);
        }
        
        // 使用 COPY 命令
        $stream = $pdo->pgsqlCopyFromFile(
            'sensor_data',
            'php://temp', // 实际使用需要先写入临时文件
            ',',
            "\\N",
            "time,sensor_id,temperature,humidity,pressure,metadata"
        );
        
        fclose($csv);
    }
}
```

#### 方式三：异步队列批量写入（推荐生产使用）

```php
<?php
// app/Jobs/IngestSensorData.php

namespace App\Jobs;

use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class IngestSensorData implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        public readonly array $readings
    ) {
        $this->onQueue('ingestion');
    }

    public function handle(): void
    {
        $startTime = microtime(true);
        $count = count($this->readings);
        
        DB::connection('timescaledb')
            ->table('sensor_data')
            ->insert($this->readings);
        
        $elapsed = microtime(true) - $startTime;
        
        Log::info("Sensor data ingested", [
            'count' => $count,
            'elapsed_ms' => round($elapsed * 1000, 2),
            'rows_per_second' => round($count / $elapsed),
        ]);
    }
}

// 数据采集服务
class SensorDataCollector
{
    private array $buffer = [];
    private int $batchSize = 1000;

    public function ingest(array $reading): void
    {
        $this->buffer[] = [
            'time' => $reading['timestamp'],
            'sensor_id' => $reading['sensor_id'],
            'temperature' => $reading['temperature'],
            'humidity' => $reading['humidity'],
            'pressure' => $reading['pressure'],
            'metadata' => json_encode($reading['metadata'] ?? []),
        ];

        if (count($this->buffer) >= $this->batchSize) {
            $this->flush();
        }
    }

    public function flush(): void
    {
        if (empty($this->buffer)) {
            return;
        }

        IngestSensorData::dispatch($this->buffer);
        $this->buffer = [];
    }
}
```

### 4.3 查询优化

```php
<?php

class SensorDataQueryService
{
    /**
     * 查询传感器最近 24 小时的数据
     */
    public function getRecentData(int $sensorId, int $hours = 24): \Illuminate\Support\Collection
    {
        return SensorData::forSensor($sensorId)
            ->recent($hours)
            ->orderBy('time', 'desc')
            ->get();
    }

    /**
     * 按时间桶聚合查询（使用 time_bucket）
     */
    public function getHourlyStats(int $sensorId, $from, $to): array
    {
        return DB::connection('timescaledb')
            ->table('sensor_data')
            ->select(
                DB::raw("time_bucket('1 hour', time) AS bucket"),
                DB::raw('AVG(temperature) AS avg_temp'),
                DB::raw('MAX(temperature) AS max_temp'),
                DB::raw('MIN(temperature) AS min_temp'),
                DB::raw('AVG(humidity) AS avg_humidity'),
                DB::raw('COUNT(*) AS samples')
            )
            ->where('sensor_id', $sensorId)
            ->whereBetween('time', [$from, $to])
            ->groupBy('bucket')
            ->orderBy('bucket', 'desc')
            ->get()
            ->toArray();
    }

    /**
     * 查询异常数据（温度超过阈值）
     */
    public function getAnomalies(float $tempThreshold = 40.0): array
    {
        return DB::connection('timescaledb')
            ->table('sensor_data')
            ->select('sensor_id', 'time', 'temperature', 'humidity')
            ->where('temperature', '>', $tempThreshold)
            ->where('time', '>=', now()->subHours(24))
            ->orderBy('temperature', 'desc')
            ->limit(100)
            ->get()
            ->toArray();
    }

    /**
     * 使用 last() 函数获取每个传感器的最新读数
     */
    public function getLatestReadings(): array
    {
        return DB::connection('timescaledb')
            ->table('sensor_data')
            ->select(
                'sensor_id',
                DB::raw('last(temperature, time) AS latest_temp'),
                DB::raw('last(humidity, time) AS latest_humidity'),
                DB::raw('last(time, time) AS latest_time')
            )
            ->groupBy('sensor_id')
            ->get()
            ->toArray();
    }

    /**
     * 使用 first() 函数获取每个传感器在指定时间窗口内的第一个读数
     */
    public function getFirstReadingsOfHour(string $hour): array
    {
        return DB::connection('timescaledb')
            ->table('sensor_data')
            ->select(
                'sensor_id',
                DB::raw("first(temperature, time) AS first_temp"),
                DB::raw("first(time, time) AS first_time")
            )
            ->whereBetween('time', [
                $hour,
                date('Y-m-d H:i:s', strtotime($hour) + 3600)
            ])
            ->groupBy('sensor_id')
            ->get()
            ->toArray();
    }
}
```

**踩坑 #4**：TimescaleDB 的 `time_bucket()` 函数不支持 `INTERVAL` 类型的变量绑定。你必须直接在 SQL 字符串中写死间隔值，或者使用 `DB::raw()`：

```php
// ❌ 错误写法（会报错）
->select(DB::raw("time_bucket(?, time) AS bucket", ['1 hour']))

// ✅ 正确写法
->select(DB::raw("time_bucket('1 hour', time) AS bucket"))
```

---

## 五、用户行为分析场景

### 5.1 事件追踪表设计

```php
<?php
// database/migrations/2026_06_02_000002_create_user_events_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_events', function (Blueprint $table) {
            $table->timestampTz('time')->nullable(false);
            $table->uuid('user_id')->nullable(false);
            $table->string('event_type', 100)->nullable(false);
            $table->string('event_name', 200)->nullable(false);
            $table->string('page_url', 2048)->nullable();
            $table->string('session_id', 100)->nullable();
            $table->string('device_type', 20)->nullable(); // mobile/desktop/tablet
            $table->string('country', 2)->nullable();
            $table->jsonb('properties')->nullable();
            $table->float('duration_ms')->nullable(); // 事件持续时间
        });

        // 转换为 Hypertable
        DB::statement("SELECT create_hypertable('user_events', 'time', chunk_time_interval => INTERVAL '1 day')");

        // 复合索引
        Schema::table('user_events', function (Blueprint $table) {
            $table->index(['user_id', 'time']);
            $table->index(['event_type', 'time']);
            $table->index(['session_id', 'time']);
        });

        // 启用压缩
        DB::statement("ALTER TABLE user_events SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'user_id, event_type',
            timescaledb.compress_orderby = 'time DESC'
        )");

        DB::statement("SELECT add_compression_policy('user_events', INTERVAL '3 days')");
        DB::statement("SELECT add_retention_policy('user_events', INTERVAL '365 days')");
    }

    public function down(): void
    {
        Schema::dropIfExists('user_events');
    }
};
```

### 5.2 漏斗分析 SQL

漏斗分析是用户行为分析中最常见的需求之一。以电商场景为例，分析从"浏览商品"到"完成支付"的转化漏斗：

```php
<?php

class FunnelAnalysisService
{
    /**
     * 分析用户转化漏斗
     * 步骤：浏览商品 → 加入购物车 → 提交订单 → 完成支付
     */
    public function analyzeConversionFunnel($from, $to): array
    {
        $sql = <<<SQL
            WITH funnel AS (
                SELECT
                    user_id,
                    MAX(CASE WHEN event_name = 'product_view' THEN 1 ELSE 0 END) AS step1,
                    MAX(CASE WHEN event_name = 'add_to_cart' THEN 1 ELSE 0 END) AS step2,
                    MAX(CASE WHEN event_name = 'checkout_start' THEN 1 ELSE 0 END) AS step3,
                    MAX(CASE WHEN event_name = 'payment_complete' THEN 1 ELSE 0 END) AS step4
                FROM user_events
                WHERE time BETWEEN :from AND :to
                  AND event_name IN ('product_view', 'add_to_cart', 'checkout_start', 'payment_complete')
                GROUP BY user_id
            )
            SELECT
                COUNT(*) FILTER (WHERE step1 = 1) AS "浏览商品",
                COUNT(*) FILTER (WHERE step1 = 1 AND step2 = 1) AS "加入购物车",
                COUNT(*) FILTER (WHERE step1 = 1 AND step2 = 1 AND step3 = 1) AS "提交订单",
                COUNT(*) FILTER (WHERE step1 = 1 AND step2 = 1 AND step3 = 1 AND step4 = 1) AS "完成支付"
            FROM funnel
        SQL;

        $result = DB::connection('timescaledb')
            ->select($sql, [
                'from' => $from,
                'to' => $to,
            ]);

        $data = $result[0];
        
        // 计算转化率
        $funnel = [
            ['step' => '浏览商品', 'users' => $data->浏览商品, 'rate' => '100%'],
            ['step' => '加入购物车', 'users' => $data->加入购物车, 'rate' => $this->calcRate($data->加入购物车, $data->浏览商品)],
            ['step' => '提交订单', 'users' => $data->提交订单, 'rate' => $this->calcRate($data->提交订单, $data->加入购物车)],
            ['step' => '完成支付', 'users' => $data->完成支付, 'rate' => $this->calcRate($data->完成支付, $data->提交订单)],
        ];

        return $funnel;
    }

    /**
     * 按天的活跃用户（DAU）趋势
     */
    public function getDauTrend($from, $to): array
    {
        return DB::connection('timescaledb')
            ->table('user_events')
            ->select(
                DB::raw("time_bucket('1 day', time) AS day"),
                DB::raw('COUNT(DISTINCT user_id) AS dau')
            )
            ->whereBetween('time', [$from, $to])
            ->groupBy('day')
            ->orderBy('day')
            ->get()
            ->toArray();
    }

    /**
     * 用户留存分析（N日留存率）
     */
    public function getRetentionAnalysis(string $cohortDate, int $days = 30): array
    {
        $sql = <<<SQL
            WITH cohort AS (
                -- 确定 cohort 的用户（在指定日期首次出现的用户）
                SELECT DISTINCT user_id
                FROM user_events
                WHERE time::date = :cohort_date
                  AND event_name = 'product_view'
            ),
            retention AS (
                SELECT
                    (time::date - :cohort_date::date) AS day_number,
                    COUNT(DISTINCT user_id) AS active_users
                FROM user_events
                WHERE user_id IN (SELECT user_id FROM cohort)
                  AND time::date BETWEEN :cohort_date AND (:cohort_date::date + :days)
                GROUP BY day_number
            )
            SELECT
                day_number,
                active_users,
                ROUND(active_users * 100.0 / (SELECT COUNT(*) FROM cohort), 2) AS retention_rate
            FROM retention
            ORDER BY day_number
        SQL;

        return DB::connection('timescaledb')
            ->select($sql, [
                'cohort_date' => $cohortDate,
                'days' => $days,
            ]);
    }

    private function calcRate(int $current, int $previous): string
    {
        if ($previous === 0) return '0%';
        return round($current * 100 / $previous, 2) . '%';
    }
}
```

### 5.3 实时仪表盘 API

```php
<?php
// app/Http/Controllers/AnalyticsDashboardController.php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class AnalyticsDashboardController extends Controller
{
    /**
     * 获取实时仪表盘数据
     */
    public function dashboard(): JsonResponse
    {
        $now = Carbon::now();
        $today = $now->copy()->startOfDay();
        $yesterday = $today->copy()->subDay();

        // 并行查询多个指标
        [$todayStats, $yesterdayStats, $topPages, $deviceBreakdown, $recentEvents] = 
            $this->fetchDashboardData($today, $yesterday, $now);

        return response()->json([
            'today' => [
                'page_views' => $todayStats->page_views ?? 0,
                'unique_users' => $todayStats->unique_users ?? 0,
                'avg_session_duration' => round($todayStats->avg_duration ?? 0, 2),
            ],
            'yesterday' => [
                'page_views' => $yesterdayStats->page_views ?? 0,
                'unique_users' => $yesterdayStats->unique_users ?? 0,
            ],
            'top_pages' => $topPages,
            'device_breakdown' => $deviceBreakdown,
            'recent_events' => $recentEvents,
            'generated_at' => $now->toIso8601String(),
        ]);
    }

    private function fetchDashboardData($today, $yesterday, $now): array
    {
        $connection = DB::connection('timescaledb');

        $todayStats = $connection->table('user_events')
            ->select(
                DB::raw('COUNT(*) AS page_views'),
                DB::raw('COUNT(DISTINCT user_id) AS unique_users'),
                DB::raw('AVG(duration_ms) AS avg_duration')
            )
            ->where('time', '>=', $today)
            ->first();

        $yesterdayStats = $connection->table('user_events')
            ->select(
                DB::raw('COUNT(*) AS page_views'),
                DB::raw('COUNT(DISTINCT user_id) AS unique_users')
            )
            ->whereBetween('time', [$yesterday, $today])
            ->first();

        $topPages = $connection->table('user_events')
            ->select('page_url', DB::raw('COUNT(*) AS views'))
            ->where('time', '>=', $today)
            ->whereNotNull('page_url')
            ->groupBy('page_url')
            ->orderByDesc('views')
            ->limit(10)
            ->get();

        $deviceBreakdown = $connection->table('user_events')
            ->select('device_type', DB::raw('COUNT(DISTINCT user_id) AS users'))
            ->where('time', '>=', $today)
            ->whereNotNull('device_type')
            ->groupBy('device_type')
            ->get();

        $recentEvents = $connection->table('user_events')
            ->select('event_name', 'user_id', 'page_url', 'time')
            ->where('time', '>=', $now->copy()->subMinutes(5))
            ->orderBy('time', 'desc')
            ->limit(50)
            ->get();

        return [$todayStats, $yesterdayStats, $topPages, $deviceBreakdown, $recentEvents];
    }
}
```

---

## 六、物化视图与连续聚合

### 6.1 连续聚合 vs 手动物化视图

| 特性 | 连续聚合（Continuous Aggregate） | 手动物化视图 |
|------|--------------------------------|-------------|
| 自动刷新 | ✅ 后台自动增量更新 | ❌ 需要手动 REFRESH |
| 增量更新 | ✅ 只处理新数据 | ❌ 全量刷新 |
| 实时查询 | ✅ 可配置实时聚合 | ❌ 数据可能过期 |
| 存储占用 | 较低（增量存储） | 较高（全量存储） |
| 刷新粒度 | 可配置时间窗口 | 全量或无 |

### 6.2 创建连续聚合

```php
<?php
// database/migrations/2026_06_02_000003_create_continuous_aggregates.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 小时级聚合
        DB::statement(<<<'SQL'
            CREATE MATERIALIZED VIEW sensor_hourly
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('1 hour', time) AS bucket,
                sensor_id,
                AVG(temperature) AS avg_temp,
                MAX(temperature) AS max_temp,
                MIN(temperature) AS min_temp,
                AVG(humidity) AS avg_humidity,
                MAX(humidity) AS max_humidity,
                AVG(pressure) AS avg_pressure,
                COUNT(*) AS sample_count,
                -- 用于增量更新的统计信息
                SUM(temperature) AS temp_sum,
                SUM(humidity) AS humidity_sum,
                SUM(pressure) AS pressure_sum
            FROM sensor_data
            GROUP BY bucket, sensor_id
            WITH NO DATA
        SQL);

        // 添加自动刷新策略（每小时刷新一次）
        DB::statement(<<<'SQL'
            SELECT add_continuous_aggregate_policy('sensor_hourly',
                start_offset => INTERVAL '3 hours',
                end_offset => INTERVAL '1 hour',
                schedule_interval => INTERVAL '1 hour'
            )
        SQL);

        // 天级聚合（基于小时级聚合，进一步提升性能）
        DB::statement(<<<'SQL'
            CREATE MATERIALIZED VIEW sensor_daily
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('1 day', bucket) AS day,
                sensor_id,
                AVG(avg_temp) AS avg_temp,
                MAX(max_temp) AS max_temp,
                MIN(min_temp) AS min_temp,
                AVG(avg_humidity) AS avg_humidity,
                SUM(sample_count) AS total_samples
            FROM sensor_hourly
            GROUP BY day, sensor_id
            WITH NO DATA
        SQL);

        DB::statement(<<<'SQL'
            SELECT add_continuous_aggregate_policy('sensor_daily',
                start_offset => INTERVAL '3 days',
                end_offset => INTERVAL '1 day',
                schedule_interval => INTERVAL '1 day'
            )
        SQL);
    }

    public function down(): void
    {
        DB::statement('DROP MATERIALIZED VIEW IF EXISTS sensor_daily');
        DB::statement('DROP MATERIALIZED VIEW IF EXISTS sensor_hourly');
    }
};
```

### 6.3 查询连续聚合

```php
<?php

class ContinuousAggregateQueryService
{
    /**
     * 查询小时级聚合数据
     */
    public function getHourlyAggregates(int $sensorId, $from, $to): array
    {
        return DB::connection('timescaledb')
            ->table('sensor_hourly')
            ->where('sensor_id', $sensorId)
            ->whereBetween('bucket', [$from, $to])
            ->orderBy('bucket', 'desc')
            ->get()
            ->toArray();
    }

    /**
     * 查询天级聚合数据
     */
    public function getDailyAggregates(int $sensorId, $from, $to): array
    {
        return DB::connection('timescaledb')
            ->table('sensor_daily')
            ->where('sensor_id', $sensorId)
            ->whereBetween('day', [$from, $to])
            ->orderBy('day', 'desc')
            ->get()
            ->toArray();
    }

    /**
     * 手动触发连续聚合刷新
     * 通常不需要，因为自动刷新策略已经配置
     * 但在以下场景需要手动刷新：
     * 1. 导入了历史数据
     * 2. 修改了聚合定义
     * 3. 需要立即看到最新数据
     */
    public function refreshAggregates(): void
    {
        DB::connection('timescaledb')
            ->statement("CALL refresh_continuous_aggregate('sensor_hourly', NULL, NULL)");
        
        DB::connection('timescaledb')
            ->statement("CALL refresh_continuous_aggregate('sensor_daily', NULL, NULL)");
    }
}
```

**踩坑 #5**：连续聚合的 `start_offset` 和 `end_offset` 配置非常重要。如果设置不当，可能导致以下问题：

- `start_offset` 太小：历史数据修正后不会被聚合
- `end_offset` 太小：最新数据可能还没被聚合，查询实时数据不准确
- `end_offset` 太大：可能聚合到正在写入的数据，导致数据不一致

推荐配置：

```sql
-- 对于传感器数据（写入可能延迟几分钟）
start_offset => INTERVAL '3 hours',  -- 覆盖可能的延迟写入
end_offset => INTERVAL '1 hour',      -- 避免聚合正在写入的数据
schedule_interval => INTERVAL '1 hour'

-- 对于用户行为事件（写入实时性要求高）
start_offset => INTERVAL '1 day',
end_offset => INTERVAL '30 minutes',
schedule_interval => INTERVAL '15 minutes'
```

**踩坑 #6**：连续聚合不支持 `WHERE` 子句中的非时间列过滤。如果你需要只聚合特定传感器的数据，需要在创建聚合时使用 `HAVING` 或在查询时过滤。

---

## 七、性能优化

### 7.1 Chunk 索引策略

```php
<?php
// database/migrations/2026_06_02_000004_add_sensor_data_indexes.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 为 sensor_id 添加索引（在每个 Chunk 内部）
        // TimescaleDB 会自动将索引添加到所有 Chunk
        Schema::table('sensor_data', function (Blueprint $table) {
            $table->index('sensor_id', 'idx_sensor_data_sensor_id');
        });

        // 添加部分索引（只索引高温数据）
        DB::statement(<<<'SQL'
            CREATE INDEX idx_sensor_data_high_temp 
            ON sensor_data (time, sensor_id) 
            WHERE temperature > 35.0
        SQL);

        // 添加 BRIN 索引（适合时序数据的范围查询）
        DB::statement(<<<'SQL'
            CREATE INDEX idx_sensor_data_time_brin 
            ON sensor_data USING BRIN (time) 
            WITH (pages_per_range = 32)
        SQL);
    }

    public function down(): void
    {
        Schema::table('sensor_data', function (Blueprint $table) {
            $table->dropIndex('idx_sensor_data_sensor_id');
        });
        DB::statement('DROP INDEX IF EXISTS idx_sensor_data_high_temp');
        DB::statement('DROP INDEX IF EXISTS idx_sensor_data_time_brin');
    }
};
```

### 7.2 压缩策略配置

```php
<?php

class CompressionPolicyService
{
    /**
     * 查看压缩状态
     */
    public function getCompressionStats(): array
    {
        return DB::connection('timescaledb')
            ->table('chunks')
            ->select(
                'chunk_name',
                'range_start',
                'range_end',
                'is_compressed',
                'compressed_chunk_size',
                'uncompressed_chunk_size'
            )
            ->where('hypertable_name', 'sensor_data')
            ->orderBy('range_start', 'desc')
            ->limit(20)
            ->get()
            ->toArray();
    }

    /**
     * 手动压缩指定 Chunk
     */
    public function compressChunk(string $chunkName): void
    {
        DB::connection('timescaledb')
            ->statement("SELECT compress_chunk(?)", [$chunkName]);
    }

    /**
     * 解压缩指定 Chunk（用于数据修正）
     */
    public function decompressChunk(string $chunkName): void
    {
        DB::connection('timescaledb')
            ->statement("SELECT decompress_chunk(?)", [$chunkName]);
    }
}
```

### 7.3 查询计划分析

```php
<?php

class QueryAnalysisService
{
    /**
     * 分析查询计划
     */
    public function analyzeQuery(string $sql, array $params = []): array
    {
        $explainSql = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " . $sql;
        
        $result = DB::connection('timescaledb')
            ->select($explainSql, $params);

        return $result[0]->{"QUERY PLAN"} ?? [];
    }

    /**
     * 常见查询优化示例
     */
    public function optimizedQueryExample(): void
    {
        // ❌ 不好的查询：全表扫描
        $bad = DB::connection('timescaledb')
            ->table('sensor_data')
            ->where('temperature', '>', 30)
            ->get();

        // ✅ 好的查询：先按时间过滤，再按条件筛选
        $good = DB::connection('timescaledb')
            ->table('sensor_data')
            ->where('time', '>=', now()->subHours(24))
            ->where('temperature', '>', 30)
            ->get();

        // ✅ 更好的查询：使用连续聚合
        $best = DB::connection('timescaledb')
            ->table('sensor_hourly')
            ->where('bucket', '>=', now()->subDays(7))
            ->where('max_temp', '>', 30)
            ->get();
    }
}
```

---

## 八、踩坑记录汇总

### 坑 #1: Hypertable 不支持自增主键

**现象**：Migration 中使用 `$table->id()` 后，`create_hypertable()` 报错。

**原因**：Hypertable 的分区机制要求数据可以按时间维度分散到不同 Chunk，传统的自增主键无法满足这一要求。

**解决方案**：使用包含时间列的复合唯一约束，或者干脆不设主键（对于纯时序数据，通常不需要主键）。

### 坑 #2: Chunk 间隔设置不当导致性能问题

**现象**：查询慢，`EXPLAIN` 显示扫描了大量 Chunk。

**原因**：Chunk 间隔设置过大（如 30 天），导致一个 Chunk 包含数亿行数据。

**解决方案**：根据数据写入频率调整 Chunk 间隔。对于日志级别数据（每秒数万行），建议使用 1 天间隔。

### 坑 #3: 时区问题

**现象**：查询结果中的时间与预期不符，某些时间点的数据"丢失"。

**原因**：使用了 `TIMESTAMP` 而非 `TIMESTAMPTZ`，或者 Laravel 的 Carbon 时区配置与数据库不一致。

**解决方案**：

```php
// Migration 中始终使用 timestampTz
$table->timestampTz('time');

// 确保 Laravel 时区配置正确
// config/app.php
'timezone' => 'Asia/Shanghai',

// 查询时明确时区
DB::raw("time_bucket('1 hour', time AT TIME ZONE 'Asia/Shanghai') AS bucket")
```

### 坑 #4: 大范围查询未走 Chunk 裁剪

**现象**：查询 30 天的数据，但 `EXPLAIN` 显示扫描了所有 Chunk。

**原因**：查询条件中时间列使用了函数转换，导致 TimescaleDB 无法进行 Chunk 裁剪。

```php
// ❌ 错误写法：对 time 列使用函数
->whereRaw("DATE(time) = '2026-06-01'")

// ✅ 正确写法：直接使用时间范围
->whereBetween('time', ['2026-06-01 00:00:00', '2026-06-01 23:59:59'])
```

### 坑 #5: 压缩后无法直接 UPDATE/DELETE

**现象**：对压缩 Chunk 执行 UPDATE 或 DELETE 时报错。

**原因**：压缩后的 Chunk 是只读的列式存储，不支持行级修改。

**解决方案**：

```php
// 先解压缩，再修改，再重新压缩
DB::statement("SELECT decompress_chunk('_hyper_1_chunk_5')");
// 执行 UPDATE/DELETE
DB::table('sensor_data')->where('id', 123)->delete();
DB::statement("SELECT compress_chunk('_hyper_1_chunk_5')");
```

### 坑 #6: 连续聚合的实时查询性能问题

**现象**：连续聚合查询变慢，尤其是查询最新时间窗口的数据时。

**原因**：开启了 `realtime` 模式，每次查询都需要聚合最新数据。

**解决方案**：

```sql
-- 关闭实时聚合（如果可以接受数据延迟）
ALTER MATERIALIZED VIEW sensor_hourly SET (timescaledb.materialized_only = true);

-- 或者调整 end_offset，减少实时聚合的数据量
SELECT add_continuous_aggregate_policy('sensor_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',  -- 从 5 minutes 改为 1 hour
    schedule_interval => INTERVAL '1 hour'
);
```

### 坑 #7: Laravel Migration 中的 TimescaleDB 语法

**现象**：在 Migration 中执行 TimescaleDB 特有的 SQL 时报语法错误。

**原因**：某些 TimescaleDB 函数不能在事务中执行。

**解决方案**：

```php
return new class extends Migration
{
    // 禁用事务
    public $withinTransaction = false;

    public function up(): void
    {
        Schema::create('sensor_data', function (Blueprint $table) {
            // ...
        });

        // 这些语句不能在事务中执行
        DB::unprepared("SELECT create_hypertable('sensor_data', 'time')");
    }
};
```

---

## 九、生产部署 Checklist

### 9.1 硬件规划

| 数据量 | 推荐配置 |
|-------|---------|
| < 1 亿行 | 4 核 16GB 内存，SSD 200GB |
| 1-10 亿行 | 8 核 32GB 内存，SSD 1TB |
| 10-100 亿行 | 16 核 64GB 内存，NVMe SSD 4TB |
| > 100 亿行 | 集群部署，分片架构 |

### 9.2 PostgreSQL 配置优化

```sql
-- postgresql.conf
shared_buffers = 8GB                    -- 内存的 25%
effective_cache_size = 24GB             -- 内存的 75%
work_mem = 256MB
maintenance_work_mem = 1GB
wal_buffers = 64MB
max_wal_size = 4GB
checkpoint_completion_target = 0.9
random_page_cost = 1.1                  -- SSD 存储

-- TimescaleDB 特定配置
timescaledb.max_background_workers = 8
```

### 9.3 监控配置

```sql
-- 查看 Hypertable 信息
SELECT * FROM timescaledb_information.hypertables;

-- 查看 Chunk 信息
SELECT * FROM timescaledb_information.chunks
WHERE hypertable_name = 'sensor_data'
ORDER BY range_start DESC;

-- 查看压缩状态
SELECT * FROM timescaledb_information.compressed_chunk_stats;

-- 查看连续聚合策略
SELECT * FROM timescaledb_information.continuous_aggregates;

-- 查看后台任务
SELECT * FROM timescaledb_information.jobs;
```

### 9.4 备份策略

```bash
# 使用 pg_dump 时需要包含 TimescaleDB 扩展
pg_dump -Fc -f backup.dump laravel_iot

# 恢复
pg_restore -d laravel_iot backup.dump

# 注意：如果使用了连续聚合，备份时需要确保扩展已安装
# 否则恢复时会失败
```

---

## 十、总结

TimescaleDB 是 Laravel 开发者处理时序数据的最佳选择之一。它的核心优势在于：

1. **零学习成本**：完全兼容 PostgreSQL，Eloquent 原生支持
2. **自动分区**：Hypertable 自动管理 Chunk，无需手动分区
3. **高效压缩**：10-20 倍压缩率，显著降低存储成本
4. **连续聚合**：自动增量更新物化视图，无需手动刷新
5. **保留策略**：自动清理过期数据，无需 cron 任务

核心踩坑点：

1. Hypertable 不支持自增主键
2. Chunk 间隔需要根据数据量调整
3. 始终使用 `TIMESTAMPTZ` 避免时区问题
4. 压缩 Chunk 是只读的，修改前需要解压
5. 连续聚合的 offset 配置需要仔细调优

如果你的 Laravel 应用需要处理时间序列数据（IoT、日志、行为分析、金融行情），TimescaleDB 绝对值得一试。

## 相关阅读

- [TiDB 实战：分布式 SQL 数据库在 Laravel 中的集成——MySQL 兼容的 NewSQL 选型指南](/databases/tidb-laravel-integration-newsql-guide/)
- [数据库连接池实战：PgBouncer vs ProxySQL vs Supabase 在高并发 Laravel 中的选型对比](/databases/database-connection-pool-pgbouncer-proxysql-supabase-comparison/)
- [ScyllaDB 实战：C++ 重写的高性能 NoSQL——Laravel 分布式缓存与高吞吐写入选型对比](/databases/ScyllaDB-实战-C++重写的高性能NoSQL-Laravel分布式缓存与高吞吐写入选型对比/)

---

## 参考资料

- [TimescaleDB 官方文档](https://docs.timescale.com/)
- [TimescaleDB GitHub](https://github.com/timescale/timescaledb)
- [Laravel PostgreSQL 文档](https://laravel.com/docs/11.x/database)
- [PostgreSQL 性能调优指南](https://www.postgresql.org/docs/current/runtime-config-resource.html)
