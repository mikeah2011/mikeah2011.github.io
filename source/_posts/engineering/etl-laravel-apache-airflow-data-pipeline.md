---

title: ETL 实战：Laravel + Apache Airflow 数据管道构建——从手动 Cron 到声明式 DAG 的踩坑记录
keywords: [ETL, Laravel, Apache Airflow, Cron, DAG, 数据管道构建, 从手动, 到声明式, 的踩坑记录]
date: 2026-06-01 10:00:00
updated: 2026-06-01 10:00:00
categories:
- engineering
- php
tags:
- Laravel
- ETL
- airflow
- 数据管道
- dag
- Python
- 数据工程
description: 在 KKday B2C 后端团队的实际项目中，数据管道是连接业务系统与数据仓库的命脉。本文记录从 Laravel Cron + 手动脚本迁移到 Apache Airflow 的完整实战过程：DAG 编排、Operator 选型、Laravel Artisan 命令集成、增量抽取策略、错误重试、监控告警，以及踩过的 15 个生产坑。
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
---



## 一、为什么写这篇？

在 KKday RD B2C 后端团队的实际项目中，我们面临这样的数据管道需求：

- **订单数据同步**：每天凌晨将 MySQL 订单数据同步到 ClickHouse，供运营报表使用
- **用户行为埋点**：将 Redis 中的用户行为日志定期抽取到 Elasticsearch
- **商品库存对账**：定时比对主库与缓存的库存数据，发现不一致自动告警
- **第三方数据拉取**：从 Stripe/AliPay 拉取支付对账文件，与本地订单数据核对
- **数据归档清理**：将 90 天前的订单数据从热库迁移到冷库

最初，我们用 Laravel Cron + 手动脚本来处理这些任务。但随着业务增长，问题逐渐暴露：

```bash
# 最初的方案：Laravel Cron + 手动脚本
* * * * * php artisan schedule:run  # 所有任务混在一起
```

**痛点清单**：

| 痛点 | 具体表现 | 影响 |
|------|----------|------|
| 任务依赖混乱 | B 任务依赖 A 的输出，但无法保证执行顺序 | 数据不一致 |
| 失败重试困难 | 脚本失败后需要手动排查和重启 | 运维成本高 |
| 可视化缺失 | 无法直观看到任务执行状态和历史 | 排障效率低 |
| 监控告警弱 | 任务失败只有日志，没有主动告警 | 发现滞后 |
| 资源竞争 | 多个任务同时运行，争抢数据库连接 | 性能下降 |
| 版本管理难 | 脚本散落在不同服务器，没有版本控制 | 配置漂移 |

**最终结论**：我们需要一个专业的任务编排系统。经过对比 Airflow、Prefect、Dagster、Temporal，我们选择了 Apache Airflow——因为它生态成熟、社区活跃、与 Python/SQL 生态无缝集成。

---

## 二、技术选型对比：为什么是 Airflow？

### 2.1 主流 ETL 编排工具对比

| 维度 | Apache Airflow | Prefect | Dagster | Temporal |
|------|---------------|---------|---------|----------|
| **定位** | 通用工作流编排 | 数据流编排 | 数据资产编排 | 通用微服务编排 |
| **DAG 定义** | Python 代码 | Python 代码 | Python 代码 | Go/Java/Python |
| **调度器** | 内置 Cron + 数据感知 | 内置 + 事件驱动 | 内置 + 传感器 | 需外部调度 |
| **UI** | 功能丰富 | 现代化 | 资产图谱 | 基础 |
| **社区** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **学习曲线** | 中等 | 低 | 中等 | 高 |
| **与 Laravel 集成** | 通过 BashOperator/PythonOperator | 通过 Shell/HTTP | 通过 Shell/HTTP | 通过 gRPC |
| **生产成熟度** | 非常成熟 | 较成熟 | 成长中 | 成熟 |
| **部署复杂度** | 中等（需 Celery/Redis） | 低（SaaS 或单机） | 中等 | 高 |

### 2.2 我们选择 Airflow 的核心理由

1. **Python 生态无缝集成**：数据处理用 Pandas/Polars，ML 用 scikit-learn，全部原生支持
2. **DAG 即代码**：版本控制、Code Review、CI/CD 全链路打通
3. **丰富的 Operator**：BashOperator、PythonOperator、SparkOperator、KubernetesPodOperator 等
4. **成熟的监控体系**：Web UI、Email/Slack 告警、Prometheus 指标导出
5. **社区生态**：2000+ Provider 包，覆盖 AWS/GCP/Azure/数据库/消息队列

---

## 三、架构设计：Laravel + Airflow 的分层架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据消费者                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Grafana  │  │ Metabase │  │ Laravel  │  │ 数据科学 │       │
│  │  看板    │  │  报表    │  │  后台    │  │  Notebooks│      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │             │
│  ┌────┴──────────────┴──────────────┴──────────────┴─────┐      │
│  │              数据仓库 / OLAP 层                        │      │
│  │         ClickHouse / PostgreSQL / Elasticsearch        │      │
│  └────────────────────────┬──────────────────────────────┘      │
│                           │                                     │
│  ┌────────────────────────┴──────────────────────────────┐      │
│  │              Apache Airflow（编排层）                   │      │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐             │      │
│  │  │  DAG    │  │  DAG     │  │  DAG     │             │      │
│  │  │ 订单同步│  │ 埋点抽取 │  │ 库存对账 │             │      │
│  │  └────┬────┘  └────┬─────┘  └────┬─────┘             │      │
│  │       │             │             │                    │      │
│  │  ┌────┴─────────────┴─────────────┴──────────────┐    │      │
│  │  │         BashOperator / PythonOperator          │    │      │
│  │  │         调用 Laravel Artisan 命令               │    │      │
│  │  └────────────────────┬──────────────────────────┘    │      │
│  └───────────────────────┼───────────────────────────────┘      │
│                          │                                       │
│  ┌───────────────────────┴───────────────────────────────┐      │
│  │              数据源层                                   │      │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │      │
│  │  │  MySQL   │  │  Redis   │  │ Stripe/  │            │      │
│  │  │  主库    │  │  缓存    │  │ AliPay   │            │      │
│  │  └──────────┘  └──────────┘  └──────────┘            │      │
│  └───────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 关键设计决策

**决策 1：Airflow 调用 Laravel Artisan 命令，而非直接连接数据库**

```python
# ✅ 推荐：通过 Artisan 命令抽取数据
BashOperator(
    task_id='extract_orders',
    bash_command='cd /var/www/laravel && php artisan etl:extract-orders --date={{ ds }}'
)

# ❌ 不推荐：Airflow 直接连接 MySQL
# 问题：绕过了 Laravel 的 Model 层、事件系统、审计日志
```

**理由**：
- 复用 Laravel 的 Model 关系、Scopes、Accessors
- 保持事件监听（Observers）和审计日志的一致性
- 数据验证逻辑统一，避免重复实现
- 便于本地开发和测试

**决策 2：增量抽取优于全量抽取**

```php
// ✅ 增量抽取：只处理新增/变更数据
php artisan etl:extract-orders --date=2026-06-01 --incremental

// ❌ 全量抽取：每次都扫描全表
php artisan etl:extract-orders --full
```

**决策 3：中间文件作为数据交换格式**

```
Laravel Artisan → JSON Lines 文件 → Airflow → ClickHouse
```

- 避免 Airflow 直连生产数据库
- JSON Lines 格式流式处理，内存友好
- 文件可作为数据快照，便于回溯和审计

---

## 四、Laravel 侧：Artisan ETL 命令开发

### 4.1 基础 ETL 命令框架

```php
<?php
// app/Console/Commands/EtlExtractOrders.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Order;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class EtlExtractOrders extends Command
{
    protected $signature = 'etl:extract-orders
        {--date= : 数据日期，格式 YYYY-MM-DD}
        {--incremental : 增量模式，只抽取指定日期的变更数据}
        {--output= : 输出路径，默认 storage/etl/orders/}';

    protected $description = '抽取订单数据到 JSON Lines 文件，供 Airflow 下游消费';

    public function handle(): int
    {
        $date = $this->option('date') ?? Carbon::yesterday()->format('Y-m-d');
        $incremental = $this->option('incremental');
        $outputPath = $this->option('output') ?? "storage/etl/orders/{$date}";

        $this->info("开始抽取订单数据: date={$date}, incremental={$incremental}");

        try {
            $count = $incremental
                ? $this->extractIncremental($date, $outputPath)
                : $this->extractFull($date, $outputPath);

            $this->info("抽取完成: {$count} 条记录");

            // 写入元数据文件，供 Airflow 读取
            $this->writeMetadata($date, $count, $outputPath);

            return self::SUCCESS;
        } catch (\Throwable $e) {
            $this->error("抽取失败: {$e->getMessage()}");
            report($e); // 上报到 Sentry
            return self::FAILURE;
        }
    }

    protected function extractIncremental(string $date, string $outputPath): int
    {
        $startDate = Carbon::parse($date)->startOfDay();
        $endDate = Carbon::parse($date)->endOfDay();

        $query = Order::query()
            ->whereBetween('updated_at', [$startDate, $endDate])
            ->with(['items', 'payment', 'user'])
            ->orderBy('id');

        return $this->writeToJsonLines($query, $outputPath, $date);
    }

    protected function extractFull(string $date, string $outputPath): int
    {
        $query = Order::query()
            ->where('created_at', '<=', Carbon::parse($date)->endOfDay())
            ->with(['items', 'payment', 'user'])
            ->orderBy('id');

        return $this->writeToJsonLines($query, $outputPath, $date);
    }

    protected function writeToJsonLines($query, string $outputPath, string $date): int
    {
        $count = 0;
        $chunkSize = 1000;
        $filePath = "{$outputPath}/orders-{$date}.jsonl";
        $tempPath = "{$filePath}.tmp";

        Storage::disk('local')->makeDirectory(dirname($filePath));

        $handle = Storage::disk('local')->path($tempPath);
        $fp = fopen($handle, 'w');

        $query->chunk($chunkSize, function ($orders) use ($fp, &$count) {
            foreach ($orders as $order) {
                $row = [
                    'id' => $order->id,
                    'order_no' => $order->order_no,
                    'user_id' => $order->user_id,
                    'status' => $order->status->value,
                    'total_amount' => $order->total_amount,
                    'currency' => $order->currency,
                    'items' => $order->items->map(fn($item) => [
                        'product_id' => $item->product_id,
                        'quantity' => $item->quantity,
                        'price' => $item->price,
                    ])->toArray(),
                    'payment_method' => $order->payment?->method,
                    'payment_status' => $order->payment?->status?->value,
                    'user_country' => $order->user?->country,
                    'created_at' => $order->created_at->toISOString(),
                    'updated_at' => $order->updated_at->toISOString(),
                ];

                fwrite($fp, json_encode($row, JSON_UNESCAPED_UNICODE) . "\n");
                $count++;
            }
        });

        fclose($fp);

        // 原子性重命名：确保下游不会读到半写文件
        Storage::disk('local')->move($tempPath, $filePath);

        return $count;
    }

    protected function writeMetadata(string $date, int $count, string $outputPath): void
    {
        $metadata = [
            'date' => $date,
            'record_count' => $count,
            'extracted_at' => now()->toISOString(),
            'file_path' => "{$outputPath}/orders-{$date}.jsonl",
            'checksum' => md5_file(Storage::disk('local')->path("{$outputPath}/orders-{$date}.jsonl")),
        ];

        Storage::disk('local')->put(
            "{$outputPath}/metadata.json",
            json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );
    }
}
```

### 4.2 增量抽取的水位线设计

```php
<?php
// app/Services/Etl/WatermarkManager.php

namespace App\Services\Etl;

use Illuminate\Support\Facades\Redis;

class WatermarkManager
{
    /**
     * 获取上次抽取的水位线（高水位）
     * 用于增量抽取的起始点
     */
    public function getHighWatermark(string $pipeline): ?string
    {
        return Redis::connection('etl')->get("etl:watermark:{$pipeline}");
    }

    /**
     * 更新高水位线
     * 只有在 ETL 成功完成后才更新
     */
    public function updateHighWatermark(string $pipeline, string $timestamp): void
    {
        Redis::connection('etl')->set("etl:watermark:{$pipeline}", $timestamp);
    }

    /**
     * 获取抽取范围
     * 从上次水位线到当前时间
     */
    public function getExtractRange(string $pipeline): array
    {
        $lastWatermark = $this->getHighWatermark($pipeline);
        $start = $lastWatermark
            ? \Carbon\Carbon::parse($lastWatermark)->addSecond()
            : now()->subDay()->startOfDay();

        return [
            'start' => $start->toISOString(),
            'end' => now()->toISOString(),
        ];
    }
}
```

### 4.3 数据质量检查命令

```php
<?php
// app/Console/Commands/EtlValidateData.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class EtlValidateData extends Command
{
    protected $signature = 'etl:validate-data
        {--date= : 数据日期}
        {--pipeline= : 管道名称}';

    protected $description = '验证 ETL 数据质量：完整性、一致性、格式正确性';

    public function handle(): int
    {
        $date = $this->option('date');
        $pipeline = $this->option('pipeline');

        $checks = [
            'file_exists' => $this->checkFileExists($date, $pipeline),
            'record_count' => $this->checkRecordCount($date, $pipeline),
            'no_empty_lines' => $this->checkNoEmptyLines($date, $pipeline),
            'json_valid' => $this->checkJsonValid($date, $pipeline),
            'checksum_match' => $this->checkChecksum($date, $pipeline),
        );

        $passed = collect($checks)->every(fn($result) => $result['passed']);

        foreach ($checks as $name => $result) {
            $status = $result['passed'] ? '✅' : '❌';
            $this->line("{$status} {$name}: {$result['message']}");
        }

        if (!$passed) {
            $this->error("数据质量检查失败，终止后续流程");
            return self::FAILURE;
        }

        $this->info("数据质量检查通过");
        return self::SUCCESS;
    }

    protected function checkFileExists(string $date, string $pipeline): array
    {
        $path = "etl/{$pipeline}/{$date}/{$pipeline}-{$date}.jsonl";
        $exists = Storage::disk('local')->exists($path);

        return [
            'passed' => $exists,
            'message' => $exists ? "文件存在: {$path}" : "文件不存在: {$path}",
        ];
    }

    protected function checkRecordCount(string $date, string $pipeline): array
    {
        $metadataPath = "etl/{$pipeline}/{$date}/metadata.json";
        $metadata = json_decode(Storage::disk('local')->get($metadataPath), true);
        $expectedCount = $metadata['record_count'] ?? 0;

        $filePath = "etl/{$pipeline}/{$date}/{$pipeline}-{$date}.jsonl";
        $actualCount = 0;
        $handle = fopen(Storage::disk('local')->path($filePath), 'r');
        while (fgets($handle) !== false) {
            $actualCount++;
        }
        fclose($handle);

        return [
            'passed' => $expectedCount === $actualCount,
            'message' => "期望 {$expectedCount} 条，实际 {$actualCount} 条",
        ];
    }

    protected function checkNoEmptyLines(string $date, string $pipeline): array
    {
        $filePath = "etl/{$pipeline}/{$date}/{$pipeline}-{$date}.jsonl";
        $handle = fopen(Storage::disk('local')->path($filePath), 'r');
        $lineNum = 0;
        $emptyLines = [];

        while (($line = fgets($handle)) !== false) {
            $lineNum++;
            if (trim($line) === '') {
                $emptyLines[] = $lineNum;
            }
        }
        fclose($handle);

        return [
            'passed' => empty($emptyLines),
            'message' => empty($emptyLines) ? '无空行' : "发现空行: 第 " . implode(',', $emptyLines) . " 行",
        ];
    }

    protected function checkJsonValid(string $date, string $pipeline): array
    {
        $filePath = "etl/{$pipeline}/{$date}/{$pipeline}-{$date}.jsonl";
        $handle = fopen(Storage::disk('local')->path($filePath), 'r');
        $lineNum = 0;
        $invalidLines = [];

        while (($line = fgets($handle)) !== false) {
            $lineNum++;
            if (trim($line) !== '' && json_decode($line) === null) {
                $invalidLines[] = $lineNum;
            }
        }
        fclose($handle);

        return [
            'passed' => empty($invalidLines),
            'message' => empty($invalidLines) ? 'JSON 格式全部合法' : "JSON 解析失败: 第 " . implode(',', $invalidLines) . " 行",
        ];
    }

    protected function checkChecksum(string $date, string $pipeline): array
    {
        $metadataPath = "etl/{$pipeline}/{$date}/metadata.json";
        $metadata = json_decode(Storage::disk('local')->get($metadataPath), true);
        $expectedChecksum = $metadata['checksum'] ?? '';

        $filePath = "etl/{$pipeline}/{$date}/{$pipeline}-{$date}.jsonl";
        $actualChecksum = md5_file(Storage::disk('local')->path($filePath));

        return [
            'passed' => $expectedChecksum === $actualChecksum,
            'message' => $expectedChecksum === $actualChecksum ? '校验和匹配' : '校验和不匹配，文件可能被篡改',
        ];
    }
}
```

---

## 五、Airflow 侧：DAG 编排与 Operator 选型

### 5.1 DAG 定义：订单数据同步管道

```python
# dags/order_sync_dag.py

from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.operators.empty import EmptyOperator
from airflow.utils.trigger_rule import TriggerRule
from airflow.providers.slack.operators.slack_webhook import SlackWebhookOperator

# 默认参数
default_args = {
    'owner': 'michael',
    'depends_on_past': False,
    'email': ['michael@kkday.com'],
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
    'retry_exponential_backoff': True,
    'max_retry_delay': timedelta(minutes=30),
    'execution_timeout': timedelta(hours=2),
    'sla': timedelta(hours=3),
}

# Laravel 项目路径
LARAVEL_PATH = '/var/www/laravel'

# 数据日期：使用 Airflow 的 execution_date
DATA_DATE = '{{ ds }}'

with DAG(
    dag_id='order_etl_daily',
    default_args=default_args,
    description='每日订单数据 ETL 管道：MySQL → JSON Lines → ClickHouse',
    schedule_interval='0 2 * * *',  # 每天凌晨 2 点
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=['etl', 'order', 'clickhouse'],
) as dag:

    # 任务 1：抽取订单数据
    extract_orders = BashOperator(
        task_id='extract_orders',
        bash_command=f'''
            cd {LARAVEL_PATH} && \
            php artisan etl:extract-orders \
                --date={DATA_DATE} \
                --incremental \
                --output=/data/etl/orders/{DATA_DATE}
        ''',
        env={
            'APP_ENV': 'production',
            'DB_CONNECTION': 'mysql',
        },
    )

    # 任务 2：数据质量检查
    validate_data = BashOperator(
        task_id='validate_data',
        bash_command=f'''
            cd {LARAVEL_PATH} && \
            php artisan etl:validate-data \
                --date={DATA_DATE} \
                --pipeline=orders
        ''',
    )

    # 任务 3：转换数据（Python 处理）
    def transform_orders(**context):
        """转换订单数据格式，适配 ClickHouse 表结构"""
        import json
        from pathlib import Path

        date = context['ds']
        input_path = f'/data/etl/orders/{date}/orders-{date}.jsonl'
        output_path = f'/data/etl/orders/{date}/orders-transformed-{date}.jsonl'

        transformed_count = 0
        error_count = 0

        with open(input_path, 'r') as infile, open(output_path, 'w') as outfile:
            for line_num, line in enumerate(infile, 1):
                try:
                    record = json.loads(line)
                    # 数据转换逻辑
                    transformed = {
                        'order_id': record['id'],
                        'order_no': record['order_no'],
                        'user_id': record['user_id'],
                        'status': record['status'],
                        'total_amount': float(record['total_amount']),
                        'currency': record['currency'],
                        'item_count': len(record.get('items', [])),
                        'payment_method': record.get('payment_method', ''),
                        'payment_status': record.get('payment_status', ''),
                        'user_country': record.get('user_country', ''),
                        'created_date': record['created_at'][:10],
                        'created_at': record['created_at'],
                        'updated_at': record['updated_at'],
                    }
                    outfile.write(json.dumps(transformed, ensure_ascii=False) + '\n')
                    transformed_count += 1
                except Exception as e:
                    error_count += 1
                    print(f"Line {line_num} transform error: {e}")

        # 推送到 XCom，供下游任务使用
        context['ti'].xcom_push(key='transformed_count', value=transformed_count)
        context['ti'].xcom_push(key='error_count', value=error_count)
        context['ti'].xcom_push(key='output_path', value=output_path)

        print(f"转换完成: {transformed_count} 条成功, {error_count} 条失败")

    transform = PythonOperator(
        task_id='transform_orders',
        python_callable=transform_orders,
    )

    # 任务 4：加载到 ClickHouse
    load_to_clickhouse = BashOperator(
        task_id='load_to_clickhouse',
        bash_command=f'''
            python3 /airflow/dags/scripts/load_to_clickhouse.py \
                --date={DATA_DATE} \
                --input-path=/data/etl/orders/{DATA_DATE}/orders-transformed-{DATA_DATE}.jsonl \
                --table=analytics.orders
        ''',
    )

    # 任务 5：更新水位线
    update_watermark = BashOperator(
        task_id='update_watermark',
        bash_command=f'''
            cd {LARAVEL_PATH} && \
            php artisan etl:update-watermark \
                --pipeline=orders \
                --date={DATA_DATE}
        ''',
        trigger_rule=TriggerRule.ALL_SUCCESS,
    )

    # 任务 6：失败告警
    notify_failure = SlackWebhookOperator(
        task_id='notify_failure',
        slack_webhook_conn_id='slack_alerts',
        message=f'''
            :x: *ETL 管道失败*
            *DAG*: order_etl_daily
            *日期*: {DATA_DATE}
            *任务*: {{{{ ti.task_id }}}}
            *日志*: {{{{ ti.log_url }}}}
        ''',
        trigger_rule=TriggerRule.ONE_FAILED,
    )

    # 任务 7：成功通知
    notify_success = SlackWebhookOperator(
        task_id='notify_success',
        slack_webhook_conn_id='slack_alerts',
        message=f'''
            :white_check_mark: *ETL 管道成功*
            *DAG*: order_etl_daily
            *日期*: {DATA_DATE}
            *抽取*: {{{{ ti.xcom_pull(task_ids='transform_orders', key='transformed_count') }}}} 条
        ''',
        trigger_rule=TriggerRule.ALL_SUCCESS,
    )

    # 任务依赖关系
    start = EmptyOperator(task_id='start')
    end = EmptyOperator(task_id='end')

    start >> extract_orders >> validate_data >> transform >> load_to_clickhouse >> update_watermark >> end
    [validate_data, transform, load_to_clickhouse, update_watermark] >> notify_failure
    update_watermark >> notify_success
```

### 5.2 ClickHouse 加载脚本

```python
# dags/scripts/load_to_clickhouse.py

import argparse
import json
import sys
from datetime import datetime

import clickhouse_connect


def load_to_clickhouse(date: str, input_path: str, table: str):
    """将 JSON Lines 数据加载到 ClickHouse"""

    client = clickhouse_connect.get_client(
        host='clickhouse.internal',
        port=8123,
        database='analytics',
        username='etl_writer',
        password='***',  # 从环境变量读取
    )

    # 创建临时表，避免加载失败影响生产表
    temp_table = f"{table}_tmp_{date.replace('-', '')}"
    client.command(f"""
        CREATE TABLE {temp_table} AS {table}
        ENGINE = MergeTree()
        ORDER BY (order_id, created_date)
    """)

    # 批量插入
    batch_size = 10000
    batch = []
    total_inserted = 0

    with open(input_path, 'r') as f:
        for line in f:
            record = json.loads(line)
            batch.append([
                record['order_id'],
                record['order_no'],
                record['user_id'],
                record['status'],
                record['total_amount'],
                record['currency'],
                record['item_count'],
                record['payment_method'],
                record['payment_status'],
                record['user_country'],
                record['created_date'],
                datetime.fromisoformat(record['created_at'].replace('Z', '+00:00')),
                datetime.fromisoformat(record['updated_at'].replace('Z', '+00:00')),
            ])

            if len(batch) >= batch_size:
                client.insert(temp_table, batch, column_names=[
                    'order_id', 'order_no', 'user_id', 'status', 'total_amount',
                    'currency', 'item_count', 'payment_method', 'payment_status',
                    'user_country', 'created_date', 'created_at', 'updated_at',
                ])
                total_inserted += len(batch)
                batch = []

    # 插入剩余数据
    if batch:
        client.insert(temp_table, batch, column_names=[
            'order_id', 'order_no', 'user_id', 'status', 'total_amount',
            'currency', 'item_count', 'payment_method', 'payment_status',
            'user_country', 'created_date', 'created_at', 'updated_at',
        ])
        total_inserted += len(batch)

    # 原子性交换：用 RENAME 替换生产表
    # 注意：ClickHouse 没有原生的原子交换，需要使用 EXCHANGE TABLES（21.8+）
    # 或者使用分区替换
    client.command(f"""
        ALTER TABLE {table}
        REPLACE PARTITION '{date}'
        FROM {temp_table}
    """)

    # 清理临时表
    client.command(f"DROP TABLE IF EXISTS {temp_table}")

    print(f"加载完成: {total_inserted} 条记录插入 {table}")
    return total_inserted


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', required=True)
    parser.add_argument('--input-path', required=True)
    parser.add_argument('--table', required=True)
    args = parser.parse_args()

    try:
        load_to_clickhouse(args.date, args.input_path, args.table)
    except Exception as e:
        print(f"加载失败: {e}", file=sys.stderr)
        sys.exit(1)
```

### 5.3 DAG 依赖关系图

```
┌─────────┐
│  start  │
└────┬────┘
     │
     ▼
┌──────────────────┐
│ extract_orders   │  ← BashOperator: php artisan etl:extract-orders
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  validate_data   │  ← BashOperator: php artisan etl:validate-data
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ transform_orders │  ← PythonOperator: 数据格式转换
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│load_to_clickhouse│  ← BashOperator: python3 load_to_clickhouse.py
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│update_watermark  │  ← BashOperator: php artisan etl:update-watermark
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌───────────┐
│ notify │ │  notify   │
│ failure│ │  success  │
└────────┘ └───────────┘
```

---

## 六、Airflow 部署与配置

### 6.1 Docker Compose 部署

```yaml
# docker-compose.airflow.yml

version: '3.8'

x-airflow-common: &airflow-common
  image: apache/airflow:2.9.0-python3.11
  environment:
    AIRFLOW__CORE__EXECUTOR: CeleryExecutor
    AIRFLOW__DATABASE__SQL_ALCHEMY_CONN: postgresql+psycopg2://airflow:airflow@postgres/airflow
    AIRFLOW__CELERY__RESULT_BACKEND: db+postgresql://airflow:airflow@postgres/airflow
    AIRFLOW__CELERY__BROKER_URL: redis://redis:6379/0
    AIRFLOW__CORE__FERNET_KEY: 'your-fernet-key-here'
    AIRFLOW__CORE__LOAD_EXAMPLES: 'false'
    AIRFLOW__WEBSERVER__SECRET_KEY: 'your-secret-key-here'
    # Slack 告警连接
    AIRFLOW_CONN_SLACK_ALERTS: 'https://hooks.slack.com/services/T00/B00/xxx'
    # ClickHouse 连接
    AIRFLOW_CONN_CLICKHOUSE: 'clickhouse://etl_writer:***@clickhouse.internal:8123/analytics'
  volumes:
    - ./dags:/opt/airflow/dags
    - ./logs:/opt/airflow/logs
    - ./plugins:/opt/airflow/plugins
    - ./data:/data/etl
    - /var/www/laravel:/var/www/laravel:ro
  depends_on:
    redis:
      condition: service_healthy
    postgres:
      condition: service_healthy

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: airflow
      POSTGRES_PASSWORD: airflow
      POSTGRES_DB: airflow
    volumes:
      - postgres-db-volume:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "airflow"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

  airflow-webserver:
    <<: *airflow-common
    command: webserver
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "curl", "--fail", "http://localhost:8080/health"]
      interval: 10s
      retries: 5

  airflow-scheduler:
    <<: *airflow-common
    command: scheduler
    healthcheck:
      test: ["CMD-SHELL", 'airflow jobs check --job-type SchedulerJob --hostname "$${HOSTNAME}"']
      interval: 10s
      retries: 5

  airflow-worker:
    <<: *airflow-common
    command: celery worker
    healthcheck:
      test:
        - "CMD-SHELL"
        - 'celery --app airflow.providers.celery.executors.celery_executor.app inspect ping -d "celery@$${HOSTNAME}"'
      interval: 10s
      timeout: 10s
      retries: 5

  airflow-triggerer:
    <<: *airflow-common
    command: triggerer
    healthcheck:
      test: ["CMD-SHELL", 'airflow jobs check --job-type TriggererJob --hostname "$${HOSTNAME}"']
      interval: 10s
      retries: 5

  airflow-init:
    <<: *airflow-common
    entrypoint: /bin/bash
    command:
      - -c
      - |
        airflow db init
        airflow users create \
          --username admin \
          --password admin \
          --firstname Michael \
          --lastname Admin \
          --role Admin \
          --email michael@kkday.com
    user: "0:0"

volumes:
  postgres-db-volume:
```

### 6.2 Airflow 关键配置

```ini
# airflow.cfg 关键配置项

[core]
# 执行器：CeleryExecutor 适合生产环境
executor = CeleryExecutor

# 并行度：同时运行的最大任务数
parallelism = 32

# 每个 DAG 的最大活跃运行数
max_active_runs_per_dag = 1

# 每个 DAG 的最大并发任务数
max_active_tasks_per_dag = 16

# DAG 文件夹
dags_folder = /opt/airflow/dags

# 任务超时（秒）
task_timeout = 7200

[scheduler]
# DAG 文件解析间隔（秒）
min_file_process_interval = 30

# 调度器心跳间隔（秒）
scheduler_heartbeat_sec = 5

# 解析 DAG 的并行进程数
parsing_processes = 4

[webserver]
# Web UI 端口
web_server_port = 8080

# DAG 默认视图
dag_default_view = graph

# 时区
default_ui_timezone = Asia/Taipei

[email]
# 邮件告警配置
email_backend = airflow.utils.email.send_email_smtp
smtp_host = smtp.gmail.com
smtp_port = 587
smtp_user = alerts@kkday.com
smtp_password = ***
smtp_mail_from = alerts@kkday.com

[logging]
# 日志级别
logging_level = INFO

# 远程日志存储（可选）
# remote_base_log_folder = s3://airflow-logs/
```

---

## 七、踩坑记录：15 个生产环境真实问题

### 坑 1：DAG 文件修改后不生效

**现象**：修改了 DAG 文件，但 Airflow UI 中没有更新。

**原因**：Airflow Scheduler 默认 30 秒扫描一次 DAG 文件夹，但会缓存已解析的 DAG。

**解决**：

```python
# 方法 1：触发 DAG 刷新
airflow dags reserialize

# 方法 2：在 DAG 中设置 catchup=False，避免历史回填
with DAG(
    dag_id='order_etl_daily',
    catchup=False,  # 关键：不回填历史
    ...
) as dag:

# 方法 3：使用 version 参数强制刷新
with DAG(
    dag_id='order_etl_daily',
    dag_display_name='Order ETL Daily v2',  # 修改显示名触发更新
    ...
) as dag:
```

### 坑 2：任务超时但 Airflow 不重试

**现象**：任务运行超过 1 小时后被标记为失败，但没有触发重试。

**原因**：`execution_timeout` 和 `retries` 的优先级问题。超时触发的是 `AirflowTaskTimeout` 异常，不是常规失败。

**解决**：

```python
default_args = {
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
    'execution_timeout': timedelta(hours=2),
    # 关键：超时后也要重试
    'retry_on_timeout': True,  # Airflow 2.4+
}
```

### 坑 3：BashOperator 找不到 PHP 命令

**现象**：`php artisan` 命令在服务器上能正常运行，但 Airflow 执行时报 `php: command not found`。

**原因**：Airflow Worker 容器内没有安装 PHP，或者 PATH 环境变量不正确。

**解决**：

```python
# 方案 1：使用完整路径
BashOperator(
    task_id='extract_orders',
    bash_command='/usr/local/bin/php /var/www/laravel/artisan etl:extract-orders ...',
)

# 方案 2：在 Dockerfile 中安装 PHP
# FROM apache/airflow:2.9.0-python3.11
# USER root
# RUN apt-get update && apt-get install -y php8.2-cli php8.2-mysql php8.2-xml
# USER airflow

# 方案 3：通过 SSH 在远程服务器执行（推荐）
from airflow.providers.ssh.operators.ssh import SSHOperator

extract_orders = SSHOperator(
    task_id='extract_orders',
    ssh_conn_id='laravel_server',
    command=f'cd {LARAVEL_PATH} && php artisan etl:extract-orders --date={DATA_DATE}',
)
```

### 坑 4：XCom 传递大量数据导致数据库膨胀

**现象**：Airflow 元数据库（PostgreSQL）占用空间持续增长。

**原因**：PythonOperator 的返回值默认通过 XCom 存储到元数据库。如果返回大量数据（如整个 DataFrame），会导致元数据库膨胀。

**解决**：

```python
def transform_orders(**context):
    # ❌ 不要返回大量数据
    # return df.to_dict()  # 可能有数百万行

    # ✅ 只返回摘要信息
    context['ti'].xcom_push(key='record_count', value=len(df))
    context['ti'].xcom_push(key='output_path', value='/data/output.jsonl')

# 或者在 DAG 级别禁用 XCom
PythonOperator(
    task_id='transform',
    python_callable=transform_orders,
    do_xcom_push=False,  # 禁用自动 XCom
)
```

### 坑 5：时区问题导致任务执行时间错乱

**现象**：DAG 设置了 `schedule_interval='0 2 * * *'`（凌晨 2 点），但实际在 UTC 时间 2 点执行。

**原因**：Airflow 默认使用 UTC 时区。

**解决**：

```python
# airflow.cfg
[core]
default_timezone = Asia/Taipei

# 或在 DAG 中使用 pendulum
import pendulum

with DAG(
    dag_id='order_etl_daily',
    start_date=datetime(2026, 1, 1, tzinfo=pendulum.timezone('Asia/Taipei')),
    ...
) as dag:
```

### 坑 6：并发任务导致数据库连接池耗尽

**现象**：多个 ETL 任务同时运行时，MySQL 报 `Too many connections` 错误。

**原因**：每个任务都创建独立的数据库连接，没有连接池管理。

**解决**：

```python
# 方案 1：限制 DAG 并发
with DAG(
    dag_id='order_etl_daily',
    max_active_tasks_per_dag=2,  # 限制并发数
    ...
) as dag:

# 方案 2：使用 Semaphore 限制资源访问
from airflow.models import Variable

def extract_with_connection_limit(**context):
    # 使用 Redis 分布式锁
    import redis
    r = redis.Redis()
    lock = r.lock('etl:mysql:connection', timeout=300)

    if lock.acquire(blocking=True, blocking_timeout=60):
        try:
            # 执行数据库操作
            ...
        finally:
            lock.release()
    else:
        raise Exception("获取数据库连接锁超时")
```

### 坑 7：DAG 依赖关系复杂导致维护困难

**现象**：随着 ETL 管道增多，DAG 文件变得难以维护。

**解决**：使用 TaskGroup 组织相关任务。

```python
from airflow.utils.task_group import TaskGroup

with DAG(...) as dag:
    with TaskGroup(group_id='extract_phase') as extract_group:
        extract_orders = BashOperator(...)
        extract_users = BashOperator(...)
        extract_products = BashOperator(...)

    with TaskGroup(group_id='transform_phase') as transform_group:
        transform_orders = PythonOperator(...)
        transform_users = PythonOperator(...)

    with TaskGroup(group_id='load_phase') as load_group:
        load_orders = BashOperator(...)
        load_users = BashOperator(...)

    extract_group >> transform_group >> load_group
```

### 坑 8：传感器（Sensor）长时间占用 Worker

**现象**：使用 `FileSensor` 等待文件生成，但文件迟迟不来，Worker 被占用数小时。

**解决**：

```python
from airflow.sensors.filesystem import FileSensor

# 使用 reschedule 模式，释放 Worker
file_sensor = FileSensor(
    task_id='wait_for_file',
    filepath='/data/input/{{ ds }}/orders.jsonl',
    mode='reschedule',  # 关键：释放 Worker，定期重新检查
    poke_interval=60,   # 每 60 秒检查一次
    timeout=3600,       # 最多等待 1 小时
    soft_fail=True,     # 超时不标记为失败，而是 skipped
)
```

### 坑 9：数据量暴增导致任务执行超时

**现象**：某天订单量突然暴增（如大促），导致抽取任务执行时间从 10 分钟变成 2 小时。

**解决**：使用动态分区策略。

```php
// 动态调整 chunk 大小
protected function extractIncremental(string $date, string $outputPath): int
{
    $totalOrders = Order::whereBetween('updated_at', [
        Carbon::parse($date)->startOfDay(),
        Carbon::parse($date)->endOfDay(),
    ])->count();

    // 动态调整 chunk 大小
    $chunkSize = match (true) {
        $totalOrders > 100000 => 5000,
        $totalOrders > 10000 => 2000,
        default => 1000,
    });

    $this->info("订单数量: {$totalOrders}, chunk 大小: {$chunkSize}");

    // ... 使用 $chunkSize 进行分批处理
}
```

### 坑 10：ClickHouse 加载失败但 Airflow 显示成功

**现象**：ClickHouse 加载脚本报错，但 Airflow 任务标记为成功。

**原因**：BashOperator 默认只检查命令的退出码（exit code），但如果 Python 脚本内部异常被捕获但没有 `sys.exit(1)`，退出码仍然是 0。

**解决**：

```python
# load_to_clickhouse.py 末尾
if __name__ == '__main__':
    try:
        load_to_clickhouse(args.date, args.input_path, args.table)
    except Exception as e:
        print(f"加载失败: {e}", file=sys.stderr)
        sys.exit(1)  # 关键：返回非零退出码
```

### 坑 11：Airflow 元数据库迁移导致服务中断

**现象**：升级 Airflow 版本后，数据库迁移需要很长时间，期间服务不可用。

**解决**：

```bash
# 在升级前先执行迁移（离线模式）
airflow db migrate --from-version 2.7.0

# 使用 Alembic 的离线迁移生成 SQL
airflow db downgrade -r 2.7.0 --show-sql-only > migration.sql
# 手动在数据库维护窗口执行 migration.sql
```

### 坑 12：Secret 管理不当导致密钥泄露

**现象**：DAG 文件中硬编码了数据库密码，提交到 Git 仓库后泄露。

**解决**：

```python
# 方案 1：使用 Airflow Connections（推荐）
from airflow.hooks.base import BaseHook

conn = BaseHook.get_connection('mysql_source')
# conn.host, conn.login, conn.password

# 方案 2：使用环境变量
import os
db_password = os.environ.get('ETL_DB_PASSWORD')

# 方案 3：使用 Airflow Variables
from airflow.models import Variable
api_key = Variable.get('stripe_api_key', deserialize_json=False)
```

### 坑 13：DAG 文件过多导致 Scheduler 性能下降

**现象**：当 DAG 文件超过 100 个时，Scheduler 解析变慢，任务调度延迟。

**解决**：

```ini
# airflow.cfg
[scheduler]
# 增加解析进程数
parsing_processes = 8

# 减少不必要的文件扫描
min_file_process_interval = 60

# 使用 .airflowignore 排除不需要的文件
```

```bash
# .airflowignore
.*test.*
.*__pycache__.*
.*\.pyc
```

### 坑 14：任务失败后数据不一致

**现象**：抽取成功、转换成功、但加载失败。重跑时数据重复。

**解决**：实现幂等性设计。

```php
// 幂等性抽取：覆盖写入而非追加
protected function writeToJsonLines($query, string $outputPath, string $date): int
{
    $filePath = "{$outputPath}/orders-{$date}.jsonl";
    $tempPath = "{$filePath}.tmp";

    // 清理旧文件
    if (Storage::disk('local')->exists($filePath)) {
        Storage::disk('local')->delete($filePath);
    }

    // 写入新文件（使用临时文件 + 原子重命名）
    // ...
}
```

```python
# ClickHouse 加载：使用 REPLACE PARTITION 保证幂等性
client.command(f"""
    ALTER TABLE {table}
    REPLACE PARTITION '{date}'
    FROM {temp_table}
""")
```

### 坑 15：监控告警配置不当导致告警风暴

**现象**：一个任务失败后，触发了 10+ 条告警通知。

**解决**：配置合理的告警策略。

```python
default_args = {
    # 只在最终失败时发送邮件（不是每次重试都发）
    'email_on_retry': False,
    'email_on_failure': True,

    # 使用指数退避重试
    'retry_exponential_backoff': True,
    'max_retry_delay': timedelta(minutes=30),
}

# 使用 Slack 告警替代邮件，便于去重
from airflow.providers.slack.operators.slack_webhook import SlackWebhookOperator

notify_failure = SlackWebhookOperator(
    task_id='notify_failure',
    trigger_rule=TriggerRule.ONE_FAILED,
    message='''
        :x: ETL 失败: {{ dag.dag_id }} / {{ ti.task_id }}
        日期: {{ ds }}
        日志: {{ ti.log_url }}
    ''',
)
```

---

## 八、性能优化策略

### 8.1 并行执行独立任务

```python
# ✅ 并行执行无依赖的任务
start >> [extract_orders, extract_users, extract_products] >> validate >> load

# ❌ 串行执行
start >> extract_orders >> extract_users >> extract_products >> validate >> load
```

### 8.2 增量抽取减少数据量

```php
// ✅ 增量：只处理变更数据
$orders = Order::where('updated_at', '>=', $lastWatermark)->get();

// ❌ 全量：每次扫描全表
$orders = Order::all();
```

### 8.3 批量操作减少数据库往返

```php
// ✅ 批量插入
DB::table('temp_orders')->insert($batch);

// ❌ 逐条插入
foreach ($orders as $order) {
    DB::table('temp_orders')->insert($order);
}
```

### 8.4 流式处理减少内存占用

```php
// ✅ 流式处理：chunk + 写入文件
Order::chunk(1000, function ($orders) use ($fp) {
    foreach ($orders as $order) {
        fwrite($fp, json_encode($order) . "\n");
    }
});

// ❌ 一次性加载所有数据到内存
$orders = Order::all();
file_put_contents('output.jsonl', $orders->toJson());
```

---

## 九、监控与告警设计

### 9.1 Airflow 监控指标

```python
# dags/scripts/export_metrics.py

from prometheus_client import CollectorRegistry, Gauge, push_to_gateway

def export_etl_metrics(dag_id, task_id, record_count, duration, status):
    """导出 ETL 指标到 Prometheus"""
    registry = CollectorRegistry()

    g_records = Gauge('etl_records_total', 'ETL records processed',
                      ['dag_id', 'task_id'], registry=registry)
    g_duration = Gauge('etl_task_duration_seconds', 'ETL task duration',
                       ['dag_id', 'task_id'], registry=registry)
    g_status = Gauge('etl_task_status', 'ETL task status (1=success, 0=failure)',
                     ['dag_id', 'task_id'], registry=registry)

    g_records.labels(dag_id=dag_id, task_id=task_id).set(record_count)
    g_duration.labels(dag_id=dag_id, task_id=task_id).set(duration)
    g_status.labels(dag_id=dag_id, task_id=task_id).set(1 if status == 'success' else 0)

    push_to_gateway('pushgateway:9091', job='airflow_etl', registry=registry)
```

### 9.2 Grafana 告警规则

```yaml
# alert_rules.yml

groups:
  - name: etl_alerts
    rules:
      - alert: ETLTaskFailed
        expr: etl_task_status == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "ETL 任务失败: {{ $labels.dag_id }}/{{ $labels.task_id }}"
          description: "任务 {{ $labels.task_id }} 已失败超过 5 分钟"

      - alert: ETLTaskSlow
        expr: etl_task_duration_seconds > 3600
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "ETL 任务执行缓慢: {{ $labels.dag_id }}/{{ $labels.task_id }}"
          description: "任务 {{ $labels.task_id }} 执行时间超过 1 小时"

      - alert: ETLDataGap
        expr: increase(etl_records_total[1d]) == 0
        for: 24h
        labels:
          severity: critical
        annotations:
          summary: "ETL 数据断流: {{ $labels.dag_id }}"
          description: "过去 24 小时没有新数据被处理"
```

---

## 十、最佳实践总结

### 10.1 ETL 管道设计原则

| 原则 | 说明 | 实践 |
|------|------|------|
| **幂等性** | 同一管道多次执行结果一致 | 使用 REPLACE PARTITION，临时文件 + 原子重命名 |
| **可回溯** | 支持重新处理历史数据 | 保留原始 JSON Lines 文件，支持按日期回溯 |
| **增量优先** | 只处理变更数据 | 使用高水位线标记上次抽取点 |
| **分层解耦** | 抽取、转换、加载分离 | Artisan 命令负责抽取，Python 负责转换，ClickHouse 负责加载 |
| **数据质量** | 每个环节都有检查 | 抽取后验证格式，转换后验证完整性，加载后验证一致性 |
| **监控告警** | 任务状态实时可见 | Prometheus 指标 + Grafana 看板 + Slack 告警 |
| **资源隔离** | ETL 不影响在线服务 | 限流、错峰执行、独立连接池 |

### 10.2 Laravel Artisan 命令规范

```php
// 命令命名规范
php artisan etl:{action}-{entity} --{options}

// 示例
php artisan etl:extract-orders --date=2026-06-01 --incremental
php artisan etl:validate-data --date=2026-06-01 --pipeline=orders
php artisan etl:update-watermark --pipeline=orders --date=2026-06-01
php artisan etl:cleanup-archives --before=2025-01-01 --dry-run
```

### 10.3 DAG 文件组织规范

```
dags/
├── order_etl_daily.py          # 订单数据 ETL
├── user_behavior_etl.py        # 用户行为 ETL
├── payment_reconciliation.py   # 支付对账
├── data_archival.py            # 数据归档
├── scripts/                    # 辅助脚本
│   ├── load_to_clickhouse.py
│   ├── load_to_elasticsearch.py
│   └── data_quality_check.py
└── .airflowignore
```

---

## 十一、总结

从 Laravel Cron + 手动脚本迁移到 Apache Airflow，我们的 ETL 管道获得了质的提升：

| 维度 | 迁移前 | 迁移后 |
|------|--------|--------|
| **任务依赖** | 手动编排，执行顺序靠运气 | DAG 声明式依赖，自动编排 |
| **失败处理** | 手动排查，人工重启 | 自动重试 + 指数退避 + 告警通知 |
| **监控可视化** | 只有日志文件 | Airflow UI + Grafana 看板 |
| **资源管理** | 所有任务抢同一个连接池 | CeleryExecutor 分布式执行 |
| **版本控制** | 脚本散落在服务器 | DAG 文件 Git 管理，Code Review |
| **数据质量** | 无检查，下游发现脏数据 | 每个环节都有验证 |
| **运维成本** | 每天 2 小时人工巡检 | 全自动，只有失败时才需要介入 |

**核心教训**：

1. **不要自己造轮子**：Cron + 脚本能跑，但无法规模化
2. **幂等性是 ETL 的生命线**：任何任务都可能被重跑
3. **增量优于全量**：减少数据量，减少风险
4. **监控告警不能省**：没有监控的 ETL 就是定时炸弹
5. **Laravel Artisan 是好东西**：复用 Model 层、事件系统、验证逻辑

ETL 不是高深的技术，但细节决定成败。希望这篇文章能帮你少踩一些坑。

---

## 相关阅读

- [dbt (data build tool) 实战：SQL 优先的数据转换框架——Laravel 项目的数据仓库建模与版本化治理](/00_架构/dbt-data-build-tool-实战-SQL优先数据转换框架-Laravel数据仓库建模与版本化治理/) — 与本篇的 Airflow 编排形成互补，聚焦 ELT 模式下 SQL 层的数据转换与质量治理
- [Data Consistency Patterns 实战：Saga/TCC/2PC/XA 在 Laravel 中的选型决策树](/00_架构/data-consistency-patterns-laravel-saga-tcc-2pc-xa/) — ETL 管道失败时的数据一致性保障，分布式事务模式在 Laravel 中的选型参考
- [Laravel Pipeline 设计模式实战——订单处理编排、条件分支与可中断链路踩坑记录](/php/Laravel/laravel-pipeline-design-patternsguide-orchestration/) — Laravel 应用内的数据流转编排，与 Airflow 跨服务编排形成内/外两层对比

---

**字数统计**：约 6500 字
**适用场景**：Laravel B2C 后端、数据工程、ETL 管道设计
**参考文档**：
- [Apache Airflow 官方文档](https://airflow.apache.org/docs/)
- [Airflow Best Practices](https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html)
- [ClickHouse 官方文档](https://clickhouse.com/docs/)
