
title: ETL 实战：Laravel + Apache Airflow 数据管道构建
keywords: [ETL]
description: 详解 Laravel 与 Apache Airflow 协同构建 ETL 数据管道的完整实战方案，覆盖 DAG 设计、任务调度对接、增量抽取、数据转换加载、幂等重试、质量校验、监控告警、补数回填与性能优化，帮助团队搭建可观察、可扩展、可追溯的数据工程体系。
date: 2026-06-01 22:45:00
tags:
- ETL
- Laravel
- airflow
- 数据管道
categories:
  - php
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop---



在很多团队里，Laravel 负责业务系统，Airflow 负责调度平台，MySQL、Redis、对象存储和分析库负责承接数据，大家各自都能跑，但真正一到“日报、对账、埋点回流、用户标签、订单宽表、跨系统同步”这些场景时，问题就会迅速暴露：任务散落在 crontab、Laravel Scheduler、队列 Worker、SQL 脚本和临时 Python 文件中，失败没人看见，重跑没有边界，口径不统一，数据晚到时全链路一起乱。

这篇文章不谈抽象概念，直接围绕一个真实可落地的场景来写：如何用 Laravel 作为业务入口和数据服务层，用 Apache Airflow 作为编排与调度中心，搭建一条“可观察、可重试、可扩展、可追溯”的 ETL 数据管道。文章重点包括五部分：Airflow DAG 设计、Laravel 任务调度对接、数据抽取/转换/加载流程、错误重试与幂等控制、监控看板建设。你可以把它理解成一篇从 0 到 1 的工程落地笔记，而不是只停留在“ETL 是什么”的入门科普。

<!-- more -->

## 一、为什么是 Laravel + Airflow，而不是只靠一个框架硬扛

很多 PHP 团队做 ETL 时最自然的选择，是直接在 Laravel 里写命令，然后交给 `app/Console/Kernel.php` 做定时调度。这个方案不是不行，它在早期尤其高效：

1. 开发者都熟悉 PHP，业务模型和数据库连接已经在 Laravel 里现成可用。
2. 数据源通常就是业务库本身，用 Eloquent、Query Builder、Repository 很快能拿到数据。
3. 调度入口统一，命令行加上队列就能快速做出“每日跑一次”的报表任务。

但当任务一多，问题就出现了。

### 1.1 单靠 Laravel Scheduler 的典型瓶颈

第一，任务依赖关系复杂时难以管理。
比如“先抽订单，再补支付，再聚合 GMV，再推送报表”，你可以在一个 Artisan 命令里全写完，也可以拆成多个命令彼此调用，但无论哪种方式，依赖关系都隐藏在代码里，调度层并不知道全局状态。

第二，失败重跑粒度过粗。
一个 2 小时的任务在第 117 分钟失败，如果没有细粒度拆分、断点记录和阶段状态表，就只能整段重跑。数据越大，代价越高。

第三，可观测性不足。
Laravel 的日志和 Horizon 面板更偏向应用任务和队列消费，不擅长描述一个跨多个阶段、多个系统、多个时间窗口的数据工作流。

第四，补数成本高。
业务方一句“5 月 24 日那天漏了一批订单，要补一下”，如果没有清晰的数据分区和调度参数化设计，你就会开始手动改命令参数、临时发版、甚至连数据库里的中间表都要手工清理。

### 1.2 为什么引入 Airflow

Airflow 的价值不是“能定时”，而是“把数据工作流当作一等公民来管理”。

它天然适合这些场景：

- 同一条链路有清晰的阶段划分：extract → stage → transform → load → verify → notify。
- 每个阶段可能使用不同技术栈：Laravel API、PHP Command、Python 脚本、SQL、Shell、HTTP 回调。
- 需要对历史运行做审计：哪一天跑了、跑了多久、失败在哪个 task、重试了几次。
- 需要补数、重跑、backfill、按日期窗口并行执行。
- 需要从“某个脚本”升级到“可运维的生产数据流”。

所以 Laravel + Airflow 的组合，本质上是在做职责拆分：

- Laravel：负责业务语义、领域模型、业务口径、对业务库的安全访问、应用级 API 和命令。
- Airflow：负责编排、依赖、调度、重试、告警、运行记录和全局观测。

这也是本文的核心设计思想：不要让 Laravel 去伪装成工作流编排器，也不要让 Airflow 去承载本不属于它的业务逻辑。

## 二、项目场景设定：每日订单宽表与经营看板同步

为了让文章更具体，我们设定一个完整场景。

你有一个 Laravel 电商系统，核心表如下：

- `orders`：订单主表
- `order_items`：订单明细
- `payments`：支付信息
- `refunds`：退款信息
- `users`：用户信息
- `products`：商品信息

业务方有两个需求：

1. 每天早上 8 点之前，需要拿到前一天的经营分析数据，包括下单金额、支付金额、退款金额、下单用户数、支付转化率、客单价、类目贡献等。
2. 这些数据除了供内部 BI 使用，还要同步到一个供管理后台展示的统计表，支持 Laravel 后台接口快速查询。

从工程角度看，这不是一个简单 SQL 能解决的问题，原因在于：

- 订单状态可能延迟更新，前一天的数据在凌晨还会变化。
- 支付、退款、优惠、运费、渠道归因口径不同，转换逻辑复杂。
- 分析库需要宽表和汇总表，管理后台需要接口可读的聚合结果。
- 一旦有缺数，需要对指定日期补跑，并尽量避免影响其他日期。

于是我们把整条链路拆成一个标准 ETL 流程：

- Extract：从 Laravel 业务库按时间窗口抽取订单、支付、退款等增量数据。
- Transform：清洗字段、统一状态口径、补充维度、计算指标、生成订单宽表和日汇总表。
- Load：写入分析层表和 Laravel 侧的报表接口消费表。
- Verify：校验行数、金额、日期完整性。
- Notify：成功或失败后通知研发、数据、运营相关人员。

## 三、总体架构设计：编排层、业务层、存储层三层解耦

先看一个推荐的逻辑架构。

```text
┌────────────────────────────────────────────────────┐
│                    Airflow 编排层                  │
│ DAG / Task / Retry / SLA / Backfill / Alert       │
└───────────────────────┬────────────────────────────┘
                        │HTTP / CLI / SQL
        ┌───────────────┼────────────────┐
        │               │                │
        ▼               ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Laravel API  │  │ PHP Command  │  │ SQL / Python │
│ 抽取服务接口 │  │ 业务清洗任务 │  │ 聚合校验任务 │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
┌────────────────────────────────────────────────────┐
│                    存储与消息层                    │
│ MySQL OLTP / Staging Table / DWH / Redis / S3      │
└────────────────────────────────────────────────────┘
```

这里有一个很重要的原则：

### 3.1 业务规则尽量留在 Laravel

比如订单是否计入 GMV、取消订单是否参与分母、退款金额是否按成功时间归属、渠道归因是否使用首触点还是末触点，这些都属于业务口径。最熟悉这些规则的通常还是 Laravel 后端团队。

如果你把这些逻辑直接散落到 Airflow 的 Python 代码中，短期看很快，长期会形成“双份业务规则”：

- 应用接口一套口径
- Airflow ETL 一套口径

时间一长，谁都说不清哪边才是“对的”。

### 3.2 编排、依赖和调度留给 Airflow

Airflow 不负责定义你的业务指标，但非常适合负责这些问题：

- 这个任务几点开始跑？
- 依赖是否满足？
- 上游失败时是否阻塞下游？
- 某个阶段失败后重试几次？
- 某一天的实例是否需要补跑？
- 运行慢了是否要触发 SLA 告警？

### 3.3 数据落地要有分层

推荐至少分三层表：

1. `ods_` 原始抽取层：尽量接近源数据，按批次、按业务日期、按抽取时间记录。
2. `dwd_` 明细标准层：做字段标准化、状态统一、维度补全、去重、幂等处理。
3. `ads_` 应用汇总层：直接面向看板、报表或 API 查询。

不要一上来就“直接从业务表 select 出来 insert into 报表表”，这种做法前期轻松，后期排查问题会非常痛苦，因为你没有中间态，无法定位到底是抽取错了、转换错了，还是汇总错了。

## 四、Airflow DAG 设计：从“能跑”升级到“能维护”

这一节是本文重点。很多团队第一次写 DAG，容易把全部逻辑塞进一个 Python 文件、几个 PythonOperator 里，表面看很完整，实际上不利于维护。

一个更稳妥的做法是：DAG 只描述流程和依赖，真正的业务处理尽量外置到 Laravel 命令、HTTP 接口或 SQL 作业中。

### 4.1 我们的 DAG 划分

针对每日订单经营分析，定义下面这些 Task：

1. `start`
2. `check_source_ready`
3. `extract_orders`
4. `extract_payments`
5. `extract_refunds`
6. `build_order_detail`
7. `aggregate_daily_metrics`
8. `load_dashboard_table`
9. `verify_metrics`
10. `notify_success`
11. `notify_failure`
12. `end`

依赖关系大致如下：

```text
start
  │
  ▼
check_source_ready
  │
  ├──────────────┬──────────────┐
  ▼              ▼              ▼
extract_orders extract_payments extract_refunds
  └──────────────┴──────────────┘
                 │
                 ▼
        build_order_detail
                 │
                 ▼
      aggregate_daily_metrics
           ├───────────────┐
           ▼               ▼
 load_dashboard_table   verify_metrics
           └───────┬───────┘
                   ▼
              notify_success
                   ▼
                  end
```

失败链路由 `on_failure_callback` 或独立通知节点处理。

### 4.2 DAG 参数设计

真正可用的 DAG，必须参数化。至少应支持：

- `biz_date`：业务日期，默认取 `data_interval_start` 或目标时区下的前一天。
- `rerun_mode`：重跑模式，例如 `full`、`partial`、`verify_only`。
- `force`：是否忽略部分前置检查。
- `batch_id`：一次运行生成的唯一批次编号，用于全链路追踪。

这些参数会带来三个直接好处：

1. 补数时不用改代码，只要触发带参运行。
2. 日志、表记录、告警消息都能带上同一个批次 ID。
3. 下游表可以做 `(biz_date, batch_id)` 级别的审计和回溯。

### 4.3 一个推荐的 Airflow DAG 示例

下面给出一个更偏生产风格的 DAG 示例。为了突出编排思想，业务处理通过 Laravel 命令和 SQL 任务来完成。

```python
from datetime import datetime, timedelta
import pendulum

from airflow import DAG
from airflow.operators.empty import EmptyOperator
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.providers.http.operators.http import SimpleHttpOperator
from airflow.utils.trigger_rule import TriggerRule

LOCAL_TZ = pendulum.timezone("Asia/Shanghai")


def build_batch_id(ds_nodash: str, run_id: str) -> str:
    safe_run_id = run_id.replace(":", "_").replace("+", "_")
    return f"etl_{ds_nodash}_{safe_run_id}"


def push_runtime_context(**context):
    ds_nodash = context["ds_nodash"]
    run_id = context["run_id"]
    batch_id = build_batch_id(ds_nodash, run_id)
    biz_date = context["dag_run"].conf.get("biz_date", context["ds"])
    context["ti"].xcom_push(key="batch_id", value=batch_id)
    context["ti"].xcom_push(key="biz_date", value=biz_date)


def failure_callback(context):
    task_id = context["task_instance"].task_id
    dag_id = context["dag"].dag_id
    run_id = context["run_id"]
    print(f"[ALERT] dag={dag_id}, task={task_id}, run_id={run_id} failed")


with DAG(
    dag_id="laravel_order_etl_pipeline",
    start_date=datetime(2026, 5, 1, tzinfo=LOCAL_TZ),
    schedule="30 2 * * *",
    catchup=True,
    max_active_runs=1,
    default_args={
        "owner": "data-platform",
        "depends_on_past": False,
        "retries": 3,
        "retry_delay": timedelta(minutes=10),
        "execution_timeout": timedelta(hours=2),
        "on_failure_callback": failure_callback,
    },
    tags=["laravel", "etl", "orders"],
    render_template_as_native_obj=True,
) as dag:

    start = EmptyOperator(task_id="start")

    prepare_context = PythonOperator(
        task_id="prepare_context",
        python_callable=push_runtime_context,
    )

    check_source_ready = BashOperator(
        task_id="check_source_ready",
        bash_command=(
            "php /var/www/app/artisan etl:check-source-ready "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }}"
        ),
    )

    extract_orders = BashOperator(
        task_id="extract_orders",
        bash_command=(
            "php /var/www/app/artisan etl:extract-orders "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
        retries=4,
        retry_delay=timedelta(minutes=5),
    )

    extract_payments = BashOperator(
        task_id="extract_payments",
        bash_command=(
            "php /var/www/app/artisan etl:extract-payments "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
    )

    extract_refunds = BashOperator(
        task_id="extract_refunds",
        bash_command=(
            "php /var/www/app/artisan etl:extract-refunds "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
    )

    build_order_detail = BashOperator(
        task_id="build_order_detail",
        bash_command=(
            "php /var/www/app/artisan etl:build-order-detail "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
    )

    aggregate_daily_metrics = BashOperator(
        task_id="aggregate_daily_metrics",
        bash_command=(
            "php /var/www/app/artisan etl:aggregate-daily-metrics "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
    )

    load_dashboard_table = BashOperator(
        task_id="load_dashboard_table",
        bash_command=(
            "php /var/www/app/artisan etl:load-dashboard-table "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
    )

    verify_metrics = BashOperator(
        task_id="verify_metrics",
        bash_command=(
            "php /var/www/app/artisan etl:verify-metrics "
            "--biz-date {{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }} "
            "--batch-id {{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        ),
    )

    notify_success = SimpleHttpOperator(
        task_id="notify_success",
        http_conn_id="ops_webhook",
        endpoint="/notify/etl-success",
        method="POST",
        headers={"Content-Type": "application/json"},
        data='''
        {
          "dag_id": "{{ dag.dag_id }}",
          "biz_date": "{{ ti.xcom_pull(task_ids='prepare_context', key='biz_date') }}",
          "batch_id": "{{ ti.xcom_pull(task_ids='prepare_context', key='batch_id') }}"
        }
        ''',
    )

    notify_failure = SimpleHttpOperator(
        task_id="notify_failure",
        http_conn_id="ops_webhook",
        endpoint="/notify/etl-failure",
        method="POST",
        headers={"Content-Type": "application/json"},
        data='''
        {
          "dag_id": "{{ dag.dag_id }}",
          "run_id": "{{ run_id }}"
        }
        ''',
        trigger_rule=TriggerRule.ONE_FAILED,
    )

    end = EmptyOperator(task_id="end")

    start >> prepare_context >> check_source_ready
    check_source_ready >> [extract_orders, extract_payments, extract_refunds]
    [extract_orders, extract_payments, extract_refunds] >> build_order_detail
    build_order_detail >> aggregate_daily_metrics
    aggregate_daily_metrics >> [load_dashboard_table, verify_metrics]
    [load_dashboard_table, verify_metrics] >> notify_success >> end
    [check_source_ready, extract_orders, extract_payments, extract_refunds,
     build_order_detail, aggregate_daily_metrics, load_dashboard_table, verify_metrics] >> notify_failure
```

这个 DAG 有几个工程上非常关键的点。

### 4.4 DAG 设计中的关键原则

#### 原则一：任务要小而清晰，不要“超级 Task”

如果你只有一个 `run_all_etl` 任务，失败时你只能看到“它失败了”，却不知道是抽取、转换、聚合还是装载失败。

任务拆分后的好处：

- 出问题时定位更快。
- 可以针对阶段设置不同重试策略。
- 可以局部重跑，不必整个流程全重来。
- 监控指标可以细分到阶段级别。

#### 原则二：DAG 不要承载复杂业务代码

很多人会在 PythonOperator 里直接写大量 SQL 和转换逻辑，这样会导致两个问题：

1. 业务规则分散，PHP 团队和数据团队很难协同维护。
2. 本地调试困难，复用性差。

更推荐的方式是：

- 核心业务逻辑放在 Laravel Command 或 Service 中。
- Airflow 只负责用参数调用它们。

#### 原则三：所有 Task 输入输出都要可追踪

至少要能回答这些问题：

- 这个 task 处理的是哪一天的数据？
- 使用的是哪个批次号？
- 读了哪些源表？
- 写了哪些目标表？
- 影响了多少行？

这意味着你不能只靠控制台打印“done”，而要把运行元数据写入专门的审计表。

## 五、Laravel 侧设计：把 ETL 做成标准命令和服务

既然 Airflow 主要做编排，那么 Laravel 侧就要提供稳定、可重复执行、幂等的 ETL 能力。

推荐的目录结构如下：

```text
app/
├── Console/
│   └── Commands/
│       └── Etl/
│           ├── CheckSourceReadyCommand.php
│           ├── ExtractOrdersCommand.php
│           ├── ExtractPaymentsCommand.php
│           ├── ExtractRefundsCommand.php
│           ├── BuildOrderDetailCommand.php
│           ├── AggregateDailyMetricsCommand.php
│           ├── LoadDashboardTableCommand.php
│           └── VerifyMetricsCommand.php
├── Services/
│   └── Etl/
│       ├── OrderExtractor.php
│       ├── PaymentExtractor.php
│       ├── RefundExtractor.php
│       ├── OrderDetailBuilder.php
│       ├── DailyMetricsAggregator.php
│       ├── DashboardLoader.php
│       └── MetricsVerifier.php
└── Models/
    ├── EtlJobRun.php
    ├── OdsOrder.php
    ├── OdsPayment.php
    ├── OdsRefund.php
    ├── DwdOrderDetail.php
    └── AdsDailyMetric.php
```

### 5.1 Artisan 命令设计原则

每个命令建议遵守以下规范：

- 必须显式接收 `biz-date` 与 `batch-id` 参数。
- 必须打印结构化日志。
- 必须将执行状态落库。
- 必须设计为幂等，可重复运行。
- 必须返回明确退出码，供 Airflow 判断成功或失败。

下面是一个订单抽取命令的示例。

```php
<?php

namespace App\Console\Commands\Etl;

use App\Services\Etl\OrderExtractor;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Throwable;

class ExtractOrdersCommand extends Command
{
    protected $signature = 'etl:extract-orders
                            {--biz-date= : 业务日期，如 2026-05-31}
                            {--batch-id= : 本次 ETL 批次号}';

    protected $description = '抽取指定业务日期的订单数据到 ODS 层';

    public function __construct(private readonly OrderExtractor $extractor)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $bizDate = $this->option('biz-date');
        $batchId = $this->option('batch-id');

        if (!$bizDate || !$batchId) {
            $this->error('biz-date and batch-id are required');
            return self::FAILURE;
        }

        try {
            $result = $this->extractor->handle($bizDate, $batchId);

            Log::info('etl.extract_orders.success', [
                'biz_date' => $bizDate,
                'batch_id' => $batchId,
                'affected_rows' => $result['affected_rows'],
                'duration_ms' => $result['duration_ms'],
            ]);

            $this->info(json_encode([
                'status' => 'success',
                'biz_date' => $bizDate,
                'batch_id' => $batchId,
                'affected_rows' => $result['affected_rows'],
            ], JSON_UNESCAPED_UNICODE));

            return self::SUCCESS;
        } catch (Throwable $e) {
            Log::error('etl.extract_orders.failed', [
                'biz_date' => $bizDate,
                'batch_id' => $batchId,
                'message' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            $this->error($e->getMessage());
            return self::FAILURE;
        }
    }
}
```

这个命令看起来普通，但它解决了一个很现实的问题：Airflow 并不理解你的业务异常，它只认退出码。只要 Laravel 侧能保证“成功返回 0，失败返回非 0”，Airflow 的编排与告警体系就能稳定工作。

## 六、Laravel 任务调度对接：不是替代，而是协同

题目要求里明确提到“Laravel 任务调度对接”，这部分非常重要。很多人会误以为“既然用了 Airflow，就不用 Laravel Scheduler 了”。其实并不是。

正确的做法是：

- 关键跨系统 ETL 流程由 Airflow 驱动。
- Laravel Scheduler 保留应用内部的轻量定时任务。
- 两者通过接口、命令和状态表协同，而不是互相覆盖。

### 6.1 哪些任务适合留在 Laravel Scheduler

例如：

- 清理临时表、过期缓存、历史日志。
- 更新某些本地统计快照。
- 补偿性的小任务，如修复少量异常状态。
- 心跳上报、运行状态检查。

这些任务通常：

- 不依赖复杂 DAG。
- 不需要 backfill。
- 对失败重跑要求不高。
- 更偏应用内部维护。

### 6.2 哪些任务应交给 Airflow

例如：

- 跨多个阶段、有依赖关系的 ETL。
- 需要按业务日期补数的任务。
- 需要完整运行记录和 SLA 的任务。
- 需要通知多个团队的任务。

### 6.3 两套调度体系的对接方式

常见有三种。

#### 方式一：Airflow 直接调用 Laravel Artisan 命令

优点：

- 实现简单。
- 复用 Laravel 业务逻辑最直接。
- 参数传递清晰。

缺点：

- Airflow Worker 需要能访问 Laravel 运行环境。
- 依赖 PHP、Composer、环境变量和数据库网络权限。

#### 方式二：Airflow 调用 Laravel HTTP API

优点：

- Airflow 与 Laravel 环境解耦。
- 易于权限控制与审计。
- 支持异步触发。

缺点：

- 需要设计额外接口与鉴权。
- 长任务不适合一直占用 HTTP 请求生命周期。

#### 方式三：Laravel Scheduler 触发 Airflow DAG

有些团队会保留 Laravel 作为统一业务入口，然后由 Laravel Scheduler 在某些时间点调用 Airflow REST API 触发 DAG。这种方式适合以下场景：

- 业务方希望在 Laravel 后台里统一配置启停。
- ETL 是否运行要受业务开关、节假日配置或租户设置影响。
- 调度决策在业务系统里，而执行编排在 Airflow 里。

下面给一个 Laravel 调 Airflow API 的例子。

```php
<?php

namespace App\Services\Airflow;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class AirflowClient
{
    public function triggerDag(string $dagId, array $conf = []): array
    {
        $baseUrl = config('services.airflow.base_url');
        $username = config('services.airflow.username');
        $password = config('services.airflow.password');

        $response = Http::withBasicAuth($username, $password)
            ->acceptJson()
            ->post("{$baseUrl}/api/v1/dags/{$dagId}/dagRuns", [
                'conf' => $conf,
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Trigger Airflow DAG failed: ' . $response->body());
        }

        return $response->json();
    }
}
```

然后在 Laravel 调度里这样写：

```php
<?php

namespace App\Console;

use App\Services\Airflow\AirflowClient;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use Illuminate\Support\Carbon;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        $schedule->call(function (AirflowClient $client) {
            $bizDate = Carbon::yesterday('Asia/Shanghai')->toDateString();

            $client->triggerDag('laravel_order_etl_pipeline', [
                'biz_date' => $bizDate,
                'trigger_source' => 'laravel_scheduler',
            ]);
        })->dailyAt('02:25')->name('trigger-order-etl-dag');
    }
}
```

这样设计后，Laravel Scheduler 不再直接跑 ETL，而是作为“触发入口”。

### 6.4 对接时最常见的坑

#### 坑一：重复触发

如果 Airflow 自己有 schedule，Laravel 又主动触发一次，就可能造成同一天跑两次。

解决办法：

- 约定由谁做唯一调度源。
- 如果 Laravel 负责触发，则 Airflow DAG 可以设为手动触发或仅作为补数入口。
- 在任务表中加 `(dag_id, biz_date)` 唯一约束或运行锁。

#### 坑二：时区不统一

Laravel 用 `Asia/Shanghai`，Airflow 部署却默认 UTC，凌晨任务最容易出问题。

解决办法：

- 统一在 DAG 中使用明确时区。
- 业务日期不要依赖服务器本地时间推导，统一显式传参。
- 所有表中的 `biz_date` 与 `created_at` 分开理解：一个是业务归属时间，一个是系统写入时间。

#### 坑三：Airflow 误判成功

如果 Laravel 命令 catch 了异常但最后仍然返回 0，Airflow 会认为任务成功，后果非常严重。

解决办法：

- 命令层出现致命异常必须返回失败码。
- 业务上的“部分失败”也要定义清楚阈值，比如校验误差超过阈值就直接 fail。

### 6.5 Airflow 与替代方案选型对比

很多团队在选型时会问：为什么是 Airflow，而不是继续用 Laravel Scheduler、Prefect、Dagster 或者 Luigi？这个问题没有绝对标准答案，但可以从团队技能栈、部署复杂度、可观测性和历史补数能力几个维度做判断。

| 方案 | 最适合场景 | 优势 | 局限 | 是否适合 Laravel ETL 主编排 |
|------|------------|------|------|------------------------------|
| Laravel Scheduler | 应用内轻量定时任务 | 上手快、复用现有 PHP 代码、部署简单 | DAG 依赖弱、补数和可视化不足、跨系统编排弱 | 中小规模可用，复杂链路不推荐单独承担 |
| Apache Airflow | 多阶段 ETL、补数、审计、跨系统任务编排 | DAG 成熟、社区大、backfill 能力强、任务审计完善 | Python 运维成本较高，初期部署比 Scheduler 重 | **最适合** |
| Prefect | 代码式工作流、云托管友好 | API 体验现代、开发体验好、适合 Python 团队 | 社区体量和传统数据平台渗透度略弱 | 可选，但 Laravel 团队通常不如 Airflow 普及 |
| Dagster | 强调资产建模、数据产品治理 | 数据资产视角强、测试与 lineage 体验好 | 学习曲线较陡，偏数据平台化 | 适合更成熟的数据团队 |
| Luigi | 轻量依赖编排 | 简洁、易于快速搭建 | UI、生态、现代特性较弱 | 老项目可用，新项目优先级较低 |

如果你的团队以 PHP 为主、已经有大量 Laravel 命令，同时又需要补数、重试、失败告警、阶段可视化，那么 Airflow 通常是比纯 Laravel Scheduler 更稳妥的主编排选择。

## 七、数据抽取（Extract）：增量优先、窗口清晰、幂等落地

ETL 的第一步是抽取。很多线上事故其实都不是转换逻辑错，而是抽取边界错了：漏数据、重数据、时间窗口错误、状态晚到没覆盖。

### 7.1 为什么不要无脑全量抽取

全量当然最简单，但成本通常太高：

- 每天扫描全部订单，数据库压力大。
- 流程耗时会越来越长。
- 重跑一天的数据却得重扫全表，不划算。

所以生产环境几乎总是增量抽取为主，全量校正为辅。

### 7.2 增量抽取的三种常见边界

#### 方案一：按主键递增

适合 append-only 的日志表、事件表。

优点是简单，缺点是对更新型业务表不可靠，因为旧记录可能被更新但 ID 不变。

#### 方案二：按 `updated_at` 时间窗口

适合订单、支付、退款这类会更新状态的表。

例如抽取 `[biz_date 00:00:00, biz_date+1 06:00:00)` 时间范围内所有 `updated_at` 变更的数据。

优点是能覆盖晚到更新；缺点是会重复扫到窗口内多次变更的记录，需要下游去重。

#### 方案三：按 CDC 或 Binlog

这是更先进的方式，但实施复杂度更高。对于以 Laravel 为主的团队，前期完全可以先用 `updated_at + 幂等覆盖` 的模式，把链路搭稳。

### 7.3 订单抽取的实现示例

```php
<?php

namespace App\Services\Etl;

use App\Models\Order;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class OrderExtractor
{
    public function handle(string $bizDate, string $batchId): array
    {
        $start = microtime(true);

        $windowStart = Carbon::parse($bizDate, 'Asia/Shanghai')->startOfDay();
        $windowEnd = Carbon::parse($bizDate, 'Asia/Shanghai')->addDay()->startOfDay()->addHours(6);

        $affectedRows = 0;

        Order::query()
            ->whereBetween('updated_at', [$windowStart, $windowEnd])
            ->orderBy('id')
            ->chunkById(1000, function ($orders) use ($bizDate, $batchId, &$affectedRows) {
                $rows = [];

                foreach ($orders as $order) {
                    $rows[] = [
                        'biz_date' => $bizDate,
                        'batch_id' => $batchId,
                        'order_id' => $order->id,
                        'user_id' => $order->user_id,
                        'status' => $order->status,
                        'currency' => $order->currency,
                        'total_amount' => $order->total_amount,
                        'discount_amount' => $order->discount_amount,
                        'shipping_amount' => $order->shipping_amount,
                        'paid_amount' => $order->paid_amount,
                        'created_at_source' => $order->created_at,
                        'updated_at_source' => $order->updated_at,
                        'extracted_at' => now(),
                    ];
                }

                DB::table('ods_orders')->upsert(
                    $rows,
                    ['biz_date', 'order_id'],
                    [
                        'batch_id',
                        'user_id',
                        'status',
                        'currency',
                        'total_amount',
                        'discount_amount',
                        'shipping_amount',
                        'paid_amount',
                        'created_at_source',
                        'updated_at_source',
                        'extracted_at',
                    ]
                );

                $affectedRows += count($rows);
            });

        return [
            'affected_rows' => $affectedRows,
            'duration_ms' => (int) ((microtime(true) - $start) * 1000),
        ];
    }
}
```

这里用 `upsert` 而不是单纯 insert，原因在于：

- 同一个业务日期可能被补跑。
- 同一个订单可能在窗口内多次更新。
- 重试时不能写出重复明细。

这就是 ETL 幂等的第一层保障。

### 7.4 抽取阶段的审计字段建议

每个 ODS 表建议至少有这些字段：

- `biz_date`
- `batch_id`
- 业务主键，如 `order_id`
- 源表更新时间，如 `updated_at_source`
- 抽取时间 `extracted_at`
- 抽取来源 `source_system`
- 数据版本 `record_version` 或 hash

有了这些字段，后面查问题会非常方便：

- 这个订单有没有被抽到？
- 被哪次批次抽到？
- 这次补数有没有覆盖旧版本？

## 八、数据转换（Transform）：统一口径比“代码优雅”更重要

ETL 的技术难点通常不是写 SQL，而是写对口径。因为大多数业务报表不是直接把原始字段搬过去，而是要把业务状态、时间口径、金额口径统一成“可分析”的模型。

### 8.1 订单宽表的核心目标

我们最终希望得到一个 `dwd_order_detail`，一行代表一个订单在分析语义下的标准明细，至少包括：

- 订单基本信息：订单号、用户、店铺、渠道、终端
- 金额字段：原价、折扣、实付、运费、退款
- 状态字段：是否下单、是否支付、是否退款成功、是否取消
- 时间字段：下单时间、支付时间、退款时间、业务归属日期
- 维度字段：类目、品牌、地区、用户分层、活动来源

这样后续所有日报、看板、接口都可以从这张表统一出发。

### 8.2 典型转换规则

#### 规则一：订单状态映射

源系统状态可能很多，例如：

- pending
- created
- paid
- shipped
- completed
- canceled
- refunding
- refunded

分析层不一定需要这么细。通常会统一成：

- `is_created`
- `is_paid`
- `is_refunded`
- `is_canceled`
- `is_net_valid`

其中 `is_net_valid` 可以定义为“支付成功且未全额退款且未取消”，用于净 GMV 等指标。

#### 规则二：时间归属

同一笔订单可以有多个重要时间：

- 创建时间
- 支付时间
- 完成时间
- 退款成功时间

所以不同指标可能属于不同日期：

- 下单金额按 `created_at`
- 支付金额按 `paid_at`
- 退款金额按 `refund_success_at`

如果不提前设计好时间归属字段，后面所有日报都会混乱。

#### 规则三：金额标准化

很多业务表中的金额字段并不直接可用，比如：

- 有的存分，有的存元。
- 有的字段含税，有的不含税。
- 有的退款表里有申请金额和成功金额两套口径。

因此转换层必须统一单位、精度和含义。

### 8.3 构建订单宽表示例

```php
<?php

namespace App\Services\Etl;

use Illuminate\Support\Facades\DB;

class OrderDetailBuilder
{
    public function handle(string $bizDate, string $batchId): array
    {
        $start = microtime(true);

        DB::transaction(function () use ($bizDate, $batchId) {
            DB::table('dwd_order_detail')
                ->where('biz_date', $bizDate)
                ->delete();

            DB::statement(
                "
                INSERT INTO dwd_order_detail (
                    biz_date,
                    batch_id,
                    order_id,
                    user_id,
                    order_status,
                    total_amount,
                    paid_amount,
                    refund_amount,
                    is_created,
                    is_paid,
                    is_refunded,
                    is_canceled,
                    is_net_valid,
                    order_created_at,
                    payment_paid_at,
                    refund_success_at,
                    channel,
                    device_type,
                    category_id,
                    province,
                    created_at,
                    updated_at
                )
                SELECT
                    o.biz_date,
                    ?,
                    o.order_id,
                    o.user_id,
                    o.status,
                    o.total_amount,
                    COALESCE(p.success_paid_amount, 0) AS paid_amount,
                    COALESCE(r.success_refund_amount, 0) AS refund_amount,
                    1 AS is_created,
                    CASE WHEN p.success_paid_amount > 0 THEN 1 ELSE 0 END AS is_paid,
                    CASE WHEN r.success_refund_amount > 0 THEN 1 ELSE 0 END AS is_refunded,
                    CASE WHEN o.status IN ('canceled', 'closed') THEN 1 ELSE 0 END AS is_canceled,
                    CASE
                        WHEN p.success_paid_amount > 0
                             AND COALESCE(r.success_refund_amount, 0) < COALESCE(p.success_paid_amount, 0)
                             AND o.status NOT IN ('canceled', 'closed')
                        THEN 1 ELSE 0
                    END AS is_net_valid,
                    o.created_at_source,
                    p.last_paid_at,
                    r.last_refund_success_at,
                    u.register_channel,
                    u.device_type,
                    oi.main_category_id,
                    u.province,
                    NOW(),
                    NOW()
                FROM ods_orders o
                LEFT JOIN (
                    SELECT
                        order_id,
                        SUM(CASE WHEN payment_status = 'success' THEN paid_amount ELSE 0 END) AS success_paid_amount,
                        MAX(CASE WHEN payment_status = 'success' THEN paid_at END) AS last_paid_at
                    FROM ods_payments
                    WHERE biz_date = ?
                    GROUP BY order_id
                ) p ON p.order_id = o.order_id
                LEFT JOIN (
                    SELECT
                        order_id,
                        SUM(CASE WHEN refund_status = 'success' THEN refund_amount ELSE 0 END) AS success_refund_amount,
                        MAX(CASE WHEN refund_status = 'success' THEN refund_success_at END) AS last_refund_success_at
                    FROM ods_refunds
                    WHERE biz_date = ?
                    GROUP BY order_id
                ) r ON r.order_id = o.order_id
                LEFT JOIN users u ON u.id = o.user_id
                LEFT JOIN (
                    SELECT order_id, MAX(category_id) AS main_category_id
                    FROM order_items
                    GROUP BY order_id
                ) oi ON oi.order_id = o.order_id
                WHERE o.biz_date = ?
                ",
                [$batchId, $bizDate, $bizDate, $bizDate]
            );
        });

        $count = DB::table('dwd_order_detail')->where('biz_date', $bizDate)->count();

        return [
            'affected_rows' => $count,
            'duration_ms' => (int) ((microtime(true) - $start) * 1000),
        ];
    }
}
```

这个写法虽然不是唯一方案，但体现了三个很重要的思想：

1. 以 `biz_date` 为边界先删后插，保证该分区内结果可重复构建。
2. 支付、退款等多源数据先聚合，再回填订单维度。
3. 所有“分析层状态”都在这一层统一定义，避免每个报表重复写判断逻辑。

### 8.4 转换层需要特别关注的坑

#### 坑一：重复订单

如果订单有拆单、补单、支付多次回调，多表 join 后很容易出现一对多放大，导致金额翻倍。

解决方法：

- 在 join 前先做子查询聚合。
- 每张输入表都明确主键粒度。
- 对关键指标做“去重前后比对”。

#### 坑二：状态晚到

凌晨 2 点抽取前一天订单，但某些退款到凌晨 3 点才成功。

解决方法：

- 设计“延迟窗口”，例如 T+1 早上 2:30 跑前一天，或允许 T+2 再次回补。
- 为关键表设计修正任务，而不是强行要求一次抽取拿齐所有状态。

#### 坑三：口径漂移

今天运营说取消单不算下单，明天又说下单数应该包含取消单但支付率分母不包含，这类变化非常常见。

解决方法：

- 把业务口径写成注释、文档和代码常量，而不是口头约定。
- 关键口径变化要带版本号，必要时保留旧口径兼容表。

## 九、数据加载（Load）：写入目标层时必须保证幂等和可回滚

很多人觉得 Load 最简单，其实未必。因为这一步直接面向消费方，一旦写错数据，影响最直观。

### 9.1 两类目标表

在本场景中，通常会有两类目标：

1. 分析层汇总表，如 `ads_daily_metrics`。
2. Laravel 后台 API 直接查询的接口表，如 `dashboard_daily_stats`。

如果你的管理后台和分析库是同一个 MySQL，也仍然建议逻辑上区分它们，因为访问模式不同。

### 9.2 聚合示例

```php
<?php

namespace App\Services\Etl;

use Illuminate\Support\Facades\DB;

class DailyMetricsAggregator
{
    public function handle(string $bizDate, string $batchId): array
    {
        $start = microtime(true);

        DB::transaction(function () use ($bizDate, $batchId) {
            DB::table('ads_daily_metrics')->where('biz_date', $bizDate)->delete();

            $rows = DB::table('dwd_order_detail')
                ->selectRaw('biz_date')
                ->selectRaw('? as batch_id', [$batchId])
                ->selectRaw('COUNT(DISTINCT CASE WHEN is_created = 1 THEN order_id END) as order_count')
                ->selectRaw('COUNT(DISTINCT CASE WHEN is_paid = 1 THEN order_id END) as paid_order_count')
                ->selectRaw('COUNT(DISTINCT CASE WHEN is_paid = 1 THEN user_id END) as paid_user_count')
                ->selectRaw('SUM(CASE WHEN is_created = 1 THEN total_amount ELSE 0 END) as order_amount')
                ->selectRaw('SUM(CASE WHEN is_paid = 1 THEN paid_amount ELSE 0 END) as paid_amount')
                ->selectRaw('SUM(CASE WHEN is_refunded = 1 THEN refund_amount ELSE 0 END) as refund_amount')
                ->selectRaw('SUM(CASE WHEN is_net_valid = 1 THEN paid_amount - refund_amount ELSE 0 END) as net_gmv')
                ->where('biz_date', $bizDate)
                ->groupBy('biz_date')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();

            if (!empty($rows)) {
                DB::table('ads_daily_metrics')->insert(array_map(function ($row) {
                    $row['created_at'] = now();
                    $row['updated_at'] = now();
                    return $row;
                }, $rows));
            }
        });

        return [
            'affected_rows' => DB::table('ads_daily_metrics')->where('biz_date', $bizDate)->count(),
            'duration_ms' => (int) ((microtime(true) - $start) * 1000),
        ];
    }
}
```

### 9.3 加载后台看板表

有些团队会直接让 Laravel 后台查询 `ads_daily_metrics`。这不是不行，但若后台查询逻辑还需要多表 join、权限过滤、时间范围汇总，就建议落一张专用消费表，避免前台接口查数时把分析表扫得很重。

```php
<?php

namespace App\Services\Etl;

use Illuminate\Support\Facades\DB;

class DashboardLoader
{
    public function handle(string $bizDate, string $batchId): array
    {
        $start = microtime(true);

        DB::transaction(function () use ($bizDate, $batchId) {
            $metric = DB::table('ads_daily_metrics')->where('biz_date', $bizDate)->first();

            if (!$metric) {
                throw new \RuntimeException("ads_daily_metrics not found for {$bizDate}");
            }

            DB::table('dashboard_daily_stats')->upsert([
                [
                    'biz_date' => $bizDate,
                    'batch_id' => $batchId,
                    'order_count' => $metric->order_count,
                    'paid_order_count' => $metric->paid_order_count,
                    'paid_user_count' => $metric->paid_user_count,
                    'order_amount' => $metric->order_amount,
                    'paid_amount' => $metric->paid_amount,
                    'refund_amount' => $metric->refund_amount,
                    'net_gmv' => $metric->net_gmv,
                    'load_status' => 'ready',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            ], ['biz_date'], [
                'batch_id',
                'order_count',
                'paid_order_count',
                'paid_user_count',
                'order_amount',
                'paid_amount',
                'refund_amount',
                'net_gmv',
                'load_status',
                'updated_at',
            ]);
        });

        return [
            'affected_rows' => 1,
            'duration_ms' => (int) ((microtime(true) - $start) * 1000),
        ];
    }
}
```

### 9.4 装载阶段的建议

- 面向分区写入，尽量以 `biz_date` 为最小重跑单元。
- 先写临时表再原子替换，适用于超大表或需要避免消费者读到半成品的场景。
- 所有结果表都保留 `batch_id`，便于快速追踪来源批次。
- 对关键报表表设计“状态字段”，例如 `preparing`、`ready`、`failed`，让前台知道当前是否可读。

## 十、错误重试：不是“多试几次”，而是分层治理

题目要求包含错误重试，这一节必须讲透。很多任务失败后默认配置个 `retries=3` 就结束了，但实际工程里，重试策略要按错误类型分层设计。

### 10.1 为什么盲目重试会出事故

有些错误适合重试：

- 短暂网络抖动
- 数据库连接超时
- 下游 API 502
- 锁冲突

有些错误不适合重试：

- SQL 写错
- 字段不存在
- 业务口径校验失败
- 数据重复键逻辑错误
- 输入参数缺失

如果把所有失败都重试 3 次，只会延长恢复时间，甚至制造更多脏数据。

### 10.2 建议的重试分层

#### 第一层：Airflow Task 级重试

适用于外部依赖抖动、瞬时失败。

例如：

- `extract_orders`：可重试 4 次，每次间隔 5 分钟。
- `verify_metrics`：如果是 SQL 连接超时，可重试 2 次。

#### 第二层：Laravel 服务级重试

适用于局部数据库事务、HTTP 请求、Redis 锁获取等细粒度操作。

例如：

```php
use Illuminate\Support\Facades\DB;
use Throwable;

function retryTransaction(callable $callback, int $times = 3, int $sleepMs = 500)
{
    $attempt = 0;

    beginning:
    $attempt++;

    try {
        return DB::transaction($callback, 3);
    } catch (Throwable $e) {
        $message = $e->getMessage();

        $retryable = str_contains($message, 'Deadlock')
            || str_contains($message, 'Lock wait timeout')
            || str_contains($message, 'server has gone away');

        if ($retryable && $attempt < $times) {
            usleep($sleepMs * 1000);
            goto beginning;
        }

        throw $e;
    }
}
```

这种重试应该只包裹最小必要范围，而不是整个 ETL 流程。

#### 第三层：业务补偿重试

有些失败不是立刻重试能解决的，比如上游支付系统凌晨延迟同步。此时需要的是“延迟补偿任务”，而不是在当前 DAG 里狂试十次。

比如：

- 主 DAG 在 2:30 跑 T-1 数据。
- 修正 DAG 在 7:00 再扫一次最近 3 天的支付和退款状态，纠正晚到数据。

这类设计在真实生产环境里非常实用。

### 10.3 幂等是重试的前提

如果任务不可幂等，就不能安全重试。

幂等常见做法有：

1. 以业务主键 + 日期做唯一约束。
2. 使用 `upsert` 而不是 insert。
3. 以分区删后重建替代追加写入。
4. 生成幂等键，例如 `biz_date + order_id + task_name`。
5. 对下游通知加去重标记，避免多次发消息。

### 10.4 错误分类与告警等级

推荐把错误分成三类：

- P1：核心链路失败，导致日报无法产出或金额严重异常。
- P2：部分维度缺失、非核心指标失败、局部数据延迟。
- P3：性能告警、轻微波动、自动重试后恢复。

这样你的监控才不会“所有错误都很严重”，导致告警疲劳。

## 十一、校验与数据质量：没有 Verify 的 ETL 只能算半成品

很多团队做 ETL 到 Load 就结束了，但真正上线后，最难的是“如何证明这批数据是可信的”。

### 11.1 最基本的校验项

至少建议做以下校验：

1. 行数校验：ODS、DWD、ADS 各层数量是否在合理范围内。
2. 主键唯一性校验：订单明细是否一单一行。
3. 金额范围校验：支付金额、退款金额是否出现负数或异常放大。
4. 空值校验：核心维度是否为空，如 `order_id`、`biz_date`。
5. 对账校验：ADS 汇总是否能和 DWD 汇总结果对上。
6. 波动校验：与前 7 天均值相比，波动是否超阈值。

### 11.2 校验命令示例

```php
<?php

namespace App\Services\Etl;

use Illuminate\Support\Facades\DB;
use RuntimeException;

class MetricsVerifier
{
    public function handle(string $bizDate, string $batchId): array
    {
        $start = microtime(true);

        $detailCount = DB::table('dwd_order_detail')
            ->where('biz_date', $bizDate)
            ->count();

        $duplicateCount = DB::table('dwd_order_detail')
            ->select('order_id')
            ->where('biz_date', $bizDate)
            ->groupBy('order_id')
            ->havingRaw('COUNT(*) > 1')
            ->get()
            ->count();

        $adsMetric = DB::table('ads_daily_metrics')
            ->where('biz_date', $bizDate)
            ->first();

        if (!$adsMetric) {
            throw new RuntimeException("ads metrics missing for {$bizDate}");
        }

        $recalculated = DB::table('dwd_order_detail')
            ->where('biz_date', $bizDate)
            ->selectRaw('SUM(CASE WHEN is_paid = 1 THEN paid_amount ELSE 0 END) as paid_amount')
            ->selectRaw('SUM(CASE WHEN is_refunded = 1 THEN refund_amount ELSE 0 END) as refund_amount')
            ->first();

        if ($duplicateCount > 0) {
            throw new RuntimeException("duplicate order rows found: {$duplicateCount}");
        }

        if (abs((float) $adsMetric->paid_amount - (float) $recalculated->paid_amount) > 0.01) {
            throw new RuntimeException('paid_amount verification failed');
        }

        if ($detailCount === 0) {
            throw new RuntimeException("empty detail rows for {$bizDate}");
        }

        DB::table('etl_data_quality_reports')->insert([
            'biz_date' => $bizDate,
            'batch_id' => $batchId,
            'check_name' => 'daily_metrics_verification',
            'check_status' => 'passed',
            'check_payload' => json_encode([
                'detail_count' => $detailCount,
                'duplicate_count' => $duplicateCount,
                'paid_amount' => $recalculated->paid_amount,
                'refund_amount' => $recalculated->refund_amount,
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'affected_rows' => 1,
            'duration_ms' => (int) ((microtime(true) - $start) * 1000),
        ];
    }
}
```

### 11.3 校验失败时怎么办

这点非常关键。不要让校验变成“打印一句 warning 就继续成功”。

如果校验失败：

- 核心指标不一致时，直接 fail 整个 DAG。
- 非核心维度缺失时，可视情况降级为告警但不阻断。
- 所有校验结果必须落表，不能只出现在日志里。

这样后面做数据质量看板时，你才能知道哪天、哪种检查、失败了多少次。

## 十二、监控看板：让数据链路从“黑盒”变成“透明”

题目要求包含监控看板，这里我会从 Airflow 原生监控、应用层状态表、业务指标看板三层来讲。

### 12.1 只看 Airflow UI 远远不够

Airflow UI 能看到：

- DAG 是否成功
- Task 耗时
- 重试次数
- 日志

但它看不到：

- 这次 ETL 具体抽了多少订单
- 金额与昨天相比波动是否异常
- 后台接口消费的目标表是不是 ready
- 哪一层表最容易失败

所以生产级监控一定是多层的。

### 12.2 运行状态表设计

推荐在 Laravel 侧维护一张 `etl_job_runs` 表，记录每个阶段的运行情况。

字段建议包括：

- `job_name`
- `dag_id`
- `task_id`
- `biz_date`
- `batch_id`
- `status`：running / success / failed / skipped
- `attempt`
- `started_at`
- `finished_at`
- `duration_ms`
- `affected_rows`
- `error_message`
- `extra_payload`

这样即使不登录 Airflow，研发也能在 Laravel 后台直接看任务状态。

### 12.3 Laravel 后台 ETL 看板建议展示什么

一个好用的 ETL 看板，我建议至少包含以下模块。

#### 模块一：今日任务总览

- 今日应跑 DAG 数
- 已成功数
- 失败数
- 运行中数
- 平均耗时
- 最晚完成时间

#### 模块二：按业务日期查看批次

- `biz_date`
- `batch_id`
- DAG 状态
- 各 Task 耗时
- 抽取行数、明细行数、汇总行数
- 是否校验通过

#### 模块三：错误 Top N

- 最近 7 天失败最多的 Task
- 失败原因聚类
- 平均恢复时间
- 自动重试成功率

#### 模块四：数据质量波动图

- 订单量日趋势
- 支付金额日趋势
- 退款金额日趋势
- 与上周同期偏差
- 异常阈值标记

### 12.4 一个适合 Grafana/Metabase 的监控指标清单

如果你有 Prometheus + Grafana 或者至少有 Metabase，也可以把 ETL 指标标准化：

- `etl_task_duration_seconds{dag_id, task_id}`
- `etl_task_success_total{dag_id, task_id}`
- `etl_task_failure_total{dag_id, task_id}`
- `etl_task_retry_total{dag_id, task_id}`
- `etl_rows_extracted_total{source_table}`
- `etl_rows_loaded_total{target_table}`
- `etl_data_quality_failed_total{check_name}`
- `etl_freshness_delay_minutes{dataset}`

这样你就能回答很多过去答不上来的问题：

- 最近一个月哪个 Task 最慢？
- 哪个阶段最容易失败？
- 哪天的数据延迟最严重？
- 自动重试到底有没有价值？

### 12.5 告警渠道建议

推荐至少三类：

1. 即时消息：飞书、Slack、企业微信，用于失败即时通知。
2. 邮件日报：汇总昨日 ETL 运行情况和核心指标。
3. 后台状态页：给研发、运营、数据同学自助查看。

告警消息不要只写“任务失败”，建议包含：

- 环境：prod / staging
- DAG 名称
- task 名称
- biz_date
- batch_id
- 第几次重试
- 错误摘要
- 日志链接或后台详情页链接

## 十三、表结构与元数据设计：让排查问题变得可操作

工程实践中，元数据表非常重要。很多团队脚本能跑，但没有任何元数据落地，最后排查问题只能翻日志，非常低效。

### 13.1 ETL 运行表

```sql
CREATE TABLE etl_job_runs (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    dag_id VARCHAR(128) NOT NULL,
    task_id VARCHAR(128) NOT NULL,
    job_name VARCHAR(128) NOT NULL,
    biz_date DATE NOT NULL,
    batch_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    affected_rows BIGINT NOT NULL DEFAULT 0,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    extra_payload JSON NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_biz_date (biz_date),
    KEY idx_batch_id (batch_id),
    KEY idx_dag_task (dag_id, task_id)
);
```

### 13.2 数据质量报告表

```sql
CREATE TABLE etl_data_quality_reports (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    biz_date DATE NOT NULL,
    batch_id VARCHAR(128) NOT NULL,
    check_name VARCHAR(128) NOT NULL,
    check_status VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'high',
    check_payload JSON NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_biz_date (biz_date),
    KEY idx_check_name (check_name)
);
```

### 13.3 批次元数据的价值

`batch_id` 看起来只是个字符串，但实际上很有用：

- 从 Airflow DAG Run 一路关联到 Laravel 命令、数据库记录、通知消息。
- 快速定位“这次重跑覆盖了哪些目标表”。
- 如果一个日期跑了多次，可以清楚区分哪个是最新有效批次。

## 十四、补数与回填：真正让系统具备生产可维护性的关键能力

大多数 ETL 系统不是死在首次上线，而是死在第一次补数。因为“正常每日跑一次”远比“回补某 7 天历史、只重跑中间两层、还不能影响线上查询”简单得多。

### 14.1 补数的基本要求

一个可维护的 ETL 至少应支持：

- 指定某一天重跑。
- 指定日期区间批量补跑。
- 仅重跑某些 task。
- 重跑前清理该日期旧分区或做版本替换。
- 补跑结果可追踪，不污染主线数据。

### 14.2 Airflow Backfill 的使用建议

Airflow 天生支持回补历史调度实例，但真正上线时要注意：

- 回补时限制并发，避免压垮业务库。
- 区分“调度日期”和“业务日期”。
- 历史逻辑变更后，旧日期是否适用新口径，要有明确策略。

### 14.3 Laravel 侧配合补数

Laravel 命令不要写死“默认 yesterday”，应允许显式传参。否则一旦做 backfill，命令本身就不可用。

同时，建议在后台做一个简单的“补数入口”：

- 选择任务类型
- 选择日期区间
- 选择是否全量覆盖
- 调用 Airflow API 触发带参 DAG

这会极大降低补数的人力成本。

## 十五、性能优化：任务能跑与任务稳定跑，不是一个级别

当数据量上来后，性能问题会直接影响稳定性。

### 15.1 抽取层优化

- 对 `updated_at`、`id`、`biz_date` 建索引。
- 使用 `chunkById` 分批读取，避免大内存。
- 只取必要字段，避免 `select *`。
- 尽量走只读库或分析副本，减少对主库冲击。

### 15.2 转换层优化

- 大量聚合优先在数据库中完成，避免把明细拉到 PHP 内存里再算。
- 对中间表按 `biz_date` 分区或索引，减少 delete / rebuild 成本。
- 多表 join 前先聚合，减少一对多放大。
- 必要时将最重的汇总迁移到分析引擎，而不是永远硬扛在 OLTP MySQL。

### 15.3 装载层优化

- 使用批量 insert / upsert。
- 对只重建单日分区的数据，不要全表 truncate。
- 对前台要读的表做冷热分离，避免 ETL 写入影响查询体验。

### 15.4 Airflow 侧优化

- 合理设置 `max_active_runs`，防止同一 DAG 多批次互相打架。
- 使用 Pool 控制访问数据库的并发量。
- 对重量级 task 单独分配队列或 worker。
- 设定 `execution_timeout`，避免假死任务长期占坑。

## 十六、安全与权限：数据管道不只是技术问题，也是合规问题

这篇文章虽然主题是 ETL，但在真实项目里，数据链路经常涉及敏感信息，所以权限设计不能忽略。

建议至少做到：

- Airflow 调 Laravel API 使用专用服务账号。
- Laravel 暴露给 Airflow 的接口做签名或 Basic Auth，不要裸奔。
- ETL 使用的数据库账号权限最小化，只给需要的库表权限。
- 日志中避免打印用户手机号、身份证、邮箱等敏感字段。
- 管理后台 ETL 看板对普通运营只展示任务状态，不展示底层明细。

如果你的订单宽表包含敏感字段，一定要在转换层就做脱敏或隔离，不要为了“后面可能会用到”把所有原始隐私数据都一路复制到分析层。

## 十七、一个更完整的上线清单

如果你准备把 Laravel + Airflow 的 ETL 真正上线，我建议至少检查以下事项：

### 17.1 功能层

- DAG 已参数化，支持 `biz_date` 和 `batch_id`
- 各命令支持幂等重跑
- ODS / DWD / ADS 分层明确
- 校验任务可阻断异常数据发布

### 17.2 运维层

- Airflow 有失败告警
- Laravel 有状态表与后台看板
- 关键表有索引与分区策略
- 任务超时、重试、并发上限已配置

### 17.3 质量层

- 核心指标有对账校验
- 有晚到补偿机制
- 有历史补数能力
- 有错误分类与恢复 SOP

### 17.4 团队协作层

- 业务口径文档已沉淀
- 谁负责 DAG、谁负责 Laravel 服务逻辑边界清晰
- 补数流程有固定入口，不靠人工 SSH 上机
- 告警通知对象明确，不是发到一个没人看的群里

## 十八、实战经验总结：最容易踩的 12 个坑

最后，我把这类项目里最常见、也最容易被忽略的问题集中列一下。

1. 只做调度，不做审计表，导致问题只能翻日志。
2. 任务不可幂等，一重试就重复写数据。
3. `biz_date` 和系统时间混用，凌晨数据归属经常错一天。
4. Airflow 和 Laravel 时区不一致。
5. DAG 写成一个大 task，失败后无法局部重跑。
6. 业务口径散落在 SQL、Python、PHP 多处，最终互相冲突。
7. 只验证任务成功，不验证数据正确。
8. 抽取窗口过窄，晚到数据永远漏。
9. 抽取窗口过宽但没有去重，下游数据翻倍。
10. 失败告警不带上下文，收到消息还是要登录多套系统排查。
11. 看板只展示 Airflow 状态，不展示业务影响范围。
12. 首次上线只考虑“今天能跑通”，没考虑“半年后怎么补数、怎么迁移、怎么改口径”。

## 十九、结语：把 ETL 当产品建设，而不是把脚本堆起来

如果你看到这里，应该已经能感受到，Laravel + Apache Airflow 这套组合的价值，并不只是“一个写业务、一个负责调度”这么简单。真正重要的是，它能帮助团队把原本零散、脆弱、不可观测的数据任务，升级成一套有边界、有责任分工、有质量保障的工程系统。

回到本文的五个重点：

- Airflow DAG 设计：关键是任务拆分、参数化、依赖清晰、编排与业务逻辑解耦。
- Laravel 任务调度对接：关键是协同而非替代，Laravel 可触发 Airflow，也可继续承载轻量内部任务。
- 数据抽取/转换/加载流程：关键是分层、窗口明确、口径统一、结果可重建。
- 错误重试：关键不是次数，而是分类、幂等、补偿与可恢复性。
- 监控看板：关键是让任务状态、数据质量、业务波动和批次上下文都能被看见。

当你的 ETL 还只是“一两个脚本”时，上述设计看起来可能有些重；但只要任务开始进入日报、经营分析、财务对账、用户标签这些关键链路，这些看似“额外”的设计，最后都会变成你节省事故成本、沟通成本和补救成本的核心资产。

如果你正准备在 Laravel 项目里引入 Airflow，我给你的最简建议是：

先别急着追求最复杂的架构，先把一条最核心的数据链路按本文思路搭起来：

- 一个参数化 DAG
- 一组幂等 Artisan 命令
- 三层数据表
- 一套基本校验
- 一个最小可用监控看板

只要这五件事做扎实，你的数据管道就已经不再是“定时脚本”，而是一套真正可演进的生产系统。

## 二十、附录：推荐的命名规范、状态机与落地约定

如果准备把这套方案长期维护下去，我非常建议在团队内部把命名规范、表字段规则、状态机约定一次性定清楚。原因很简单，ETL 最怕的不是代码写不出来，而是随着需求增长，大家对同一个概念开始有不同叫法，最终让查询、看板、告警、排错全都失去一致性。

### 20.1 表命名建议

- `ods_`：原始抽取层，例如 `ods_orders`、`ods_payments`
- `dwd_`：标准明细层，例如 `dwd_order_detail`
- `ads_`：应用汇总层，例如 `ads_daily_metrics`
- `dim_`：维表层，例如 `dim_shop`, `dim_channel`
- `tmp_`：临时计算表，仅用于中间过程
- `etl_`：任务元数据表，例如 `etl_job_runs`, `etl_job_locks`, `etl_data_quality_reports`

这样命名的好处是，研发一眼就知道一张表处于哪一层，排查时也更容易建立路径感。

### 20.2 通用字段建议

无论是 ODS、DWD 还是 ADS，都建议尽量统一一些基础字段：

- `biz_date`：业务归属日期
- `batch_id`：本次批次号
- `created_at`：记录写入时间
- `updated_at`：记录更新时间
- `source_system`：数据来源系统
- `etl_version`：转换逻辑版本
- `is_deleted`：是否逻辑删除（如有需要）

尤其是 `etl_version`，很多团队会忽略它。但如果某次上线修改了核心口径，而你又要解释为什么 5 月和 6 月的指标定义不同，这个字段会非常有价值。

### 20.3 状态机统一

在 ETL 系统中，最常见的问题之一就是状态名混乱。有人用 `done`，有人用 `success`，有人用 `finished`，还有人写 `ok`。短期内似乎都能看懂，长期则会在 API、前端和告警规则里不断埋雷。

建议统一任务状态：

- `pending`
- `running`
- `success`
- `failed`
- `skipped`
- `retrying`

建议统一数据发布状态：

- `preparing`
- `ready`
- `stale`
- `invalid`

一个是任务执行层状态，一个是数据可消费状态，千万不要混在一起。

## 二十一、任务锁与并发控制：避免“同一份数据被两拨人同时处理”

线上很常见的一种事故，是同一个 `biz_date` 的任务被重复触发：

- Airflow 正常调度跑了一次；
- 运维误操作又手工触发了一次；
- Laravel 后台补数页面又来了一次；
- 开发临时 SSH 到服务器上执行了一遍 Artisan 命令。

如果没有锁和并发控制，结果就会非常混乱。

### 21.1 为什么必须做运行锁

因为即使你用了 `max_active_runs=1`，也只是限制同一个 DAG 的活跃运行数，并不一定能彻底约束其他入口。尤其当 Laravel 还能独立执行某些命令时，数据库层的运行锁仍然有必要。

### 21.2 推荐的锁粒度

建议最少做两层：

1. DAG 层：`dag_id + biz_date`
2. Task 层：`task_id + biz_date + batch_id`

这样就能防止：

- 同一天同一个 DAG 被重复跑
- 同一个 task 在同一批次内被多次并发执行

### 21.3 一个简单的 Laravel 锁表示例

```sql
CREATE TABLE etl_job_locks (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    lock_key VARCHAR(191) NOT NULL,
    owner VARCHAR(128) NOT NULL,
    expired_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uk_lock_key (lock_key)
);
```

配合服务层写一个简易锁：

```php
<?php

namespace App\Services\Etl;

use Illuminate\Support\Facades\DB;
use RuntimeException;

class EtlLockService
{
    public function acquire(string $lockKey, string $owner, int $ttlSeconds = 7200): void
    {
        $expiredAt = now()->addSeconds($ttlSeconds);

        try {
            DB::table('etl_job_locks')->insert([
                'lock_key' => $lockKey,
                'owner' => $owner,
                'expired_at' => $expiredAt,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            $existing = DB::table('etl_job_locks')->where('lock_key', $lockKey)->first();

            if ($existing && now()->lt($existing->expired_at)) {
                throw new RuntimeException("lock already acquired: {$lockKey}");
            }

            DB::table('etl_job_locks')
                ->where('lock_key', $lockKey)
                ->update([
                    'owner' => $owner,
                    'expired_at' => $expiredAt,
                    'updated_at' => now(),
                ]);
        }
    }

    public function release(string $lockKey): void
    {
        DB::table('etl_job_locks')->where('lock_key', $lockKey)->delete();
    }
}
```

生产里你也可以直接用 Redis 分布式锁，但无论是哪种实现，原则都一样：任务开始前抢锁，结束后释放，异常退出要有过期时间兜底。

## 二十二、日志设计：让日志真正服务于排错，而不是制造噪音

日志是另一个极其容易被低估的环节。很多 ETL 系统日志要么太少，出事后找不到线索；要么太多，动不动一万行，结果还是没法快速定位问题。

### 22.1 推荐结构化日志字段

每条关键日志建议带上：

- `dag_id`
- `task_id`
- `biz_date`
- `batch_id`
- `attempt`
- `stage`
- `affected_rows`
- `duration_ms`
- `error_code`
- `message`

### 22.2 日志级别建议

- `info`：任务开始、任务结束、影响行数、关键里程碑
- `warning`：非致命异常、异常波动、重试行为
- `error`：任务失败、校验失败、关键依赖失败

不要把所有东西都打成 `error`，否则告警系统和日志系统很快都会失去价值。

### 22.3 日志与状态表的关系

一个经验是：

- 日志负责过程细节。
- 状态表负责结果摘要。

不要试图用日志替代表。比如“这次影响了 12345 行”这种信息，应该同时落到状态表里，而不是只存在日志文件中。

## 二十三、面向团队协作的职责分工建议

Laravel + Airflow 最大的一个组织价值，是它天然适合团队协作分层。但前提是边界必须清楚。

### 23.1 后端团队负责什么

- 定义业务口径
- 提供可靠的 Artisan 命令或 API
- 维护业务表、领域模型、维度关联
- 维护管理后台中的 ETL 状态页和补数入口

### 23.2 数据平台或数据工程团队负责什么

- 维护 DAG 编排
- 配置告警、并发、SLA、重试策略
- 维护 Airflow 运行环境
- 维护数据质量规则与监控体系

### 23.3 产品、运营、财务需要知道什么

他们通常不关心你是 Python 还是 PHP 写的，但他们非常关心：

- 这份报表什么时候更新？
- 数据是否可信？
- 异常时谁负责？
- 能不能补某一天的数据？

所以别把 ETL 只当作工程内部的技术细节。它最终服务的是业务决策，最好在流程和看板层面让业务方也能看懂最重要的状态。

## 二十四、从 0 到 1 的实施路线图

如果你的团队还没有 Airflow，也没有规范的 ETL 体系，直接照着大厂全套方案落地通常会过重。更实际的方式是分阶段推进。

### 阶段一：单链路治理

目标：先把最核心的一条数据链路跑稳。

你只需要完成：

- 一个 Airflow DAG
- 一套 Laravel Artisan 命令
- ODS / DWD / ADS 三层表
- 一份基础校验
- 一张状态页

### 阶段二：补数与告警

目标：让系统具备生产运行能力。

要补齐：

- DAG 参数化
- Laravel 后台触发补数
- 告警消息模板
- 失败自动重试
- 运行锁

### 阶段三：标准化与平台化

目标：从单任务走向可复用。

可以进一步建设：

- ETL 命令基类
- 通用状态落库中间件
- 通用质量校验框架
- DAG 模板化
- 统一监控指标埋点

### 阶段四：多数据集扩展

目标：把经验复制到用户标签、商品分析、营销归因、财务对账等链路。

到这个阶段，你就会发现，前面那些看似“偏工程规范”的设计，反而成了复用效率最高的部分。

## 二十五、一个最小可用的 Laravel ETL 命令基类思路

当 ETL 命令越来越多后，最容易出现的问题是每个命令各写各的，参数、日志、异常处理、状态落库风格都不一致。解决方法是抽一个基类。

```php
<?php

namespace App\Console\Commands\Etl;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

abstract class BaseEtlCommand extends Command
{
    abstract protected function process(string $bizDate, string $batchId): array;

    public function handle(): int
    {
        $bizDate = $this->option('biz-date');
        $batchId = $this->option('batch-id');
        $jobName = static::class;
        $startedAt = now();

        if (!$bizDate || !$batchId) {
            $this->error('biz-date and batch-id are required');
            return self::FAILURE;
        }

        DB::table('etl_job_runs')->insert([
            'dag_id' => env('ETL_DAG_ID', 'unknown'),
            'task_id' => $this->getName(),
            'job_name' => $jobName,
            'biz_date' => $bizDate,
            'batch_id' => $batchId,
            'status' => 'running',
            'attempt' => 1,
            'started_at' => $startedAt,
            'finished_at' => null,
            'duration_ms' => 0,
            'affected_rows' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $result = $this->process($bizDate, $batchId);

            DB::table('etl_job_runs')
                ->where('task_id', $this->getName())
                ->where('biz_date', $bizDate)
                ->where('batch_id', $batchId)
                ->orderByDesc('id')
                ->limit(1)
                ->update([
                    'status' => 'success',
                    'finished_at' => now(),
                    'duration_ms' => $result['duration_ms'] ?? 0,
                    'affected_rows' => $result['affected_rows'] ?? 0,
                    'updated_at' => now(),
                ]);

            return self::SUCCESS;
        } catch (Throwable $e) {
            DB::table('etl_job_runs')
                ->where('task_id', $this->getName())
                ->where('biz_date', $bizDate)
                ->where('batch_id', $batchId)
                ->orderByDesc('id')
                ->limit(1)
                ->update([
                    'status' => 'failed',
                    'finished_at' => now(),
                    'error_message' => mb_substr($e->getMessage(), 0, 1000),
                    'updated_at' => now(),
                ]);

            $this->error($e->getMessage());
            return self::FAILURE;
        }
    }
}
```

有了这个基类后，后续每个命令只要关注自己的业务处理逻辑，整体风格会统一很多。

## 二十六、监控看板落地范例：管理后台应该长什么样

为了避免“监控看板”这四个字太抽象，这里给一个更贴近 Laravel 管理后台的页面结构建议。

### 26.1 列表页

筛选条件：

- 业务日期范围
- DAG 名称
- 任务状态
- 批次号
- 是否校验失败

列表字段：

- 业务日期
- DAG 名称
- 批次号
- 总体状态
- 开始时间
- 结束时间
- 总耗时
- 抽取行数
- 明细行数
- 汇总行数
- 校验状态
- 操作：查看详情 / 触发补跑

### 26.2 详情页

模块建议：

1. 运行摘要
2. DAG 各 Task 时间线
3. 每层表影响行数
4. 数据质量检查结果
5. 错误日志摘要
6. 下游消费状态

### 26.3 补跑弹窗

建议参数：

- `biz_date`
- `rerun_mode`
- `force`
- `tasks`（可选，只重跑特定阶段）
- 触发原因备注

这一套做下来，研发和数据同学通常就不需要再靠口头沟通“你帮我跑一下昨天那批”。

## 二十七、关于测试：没有测试的 ETL 很难放心迭代

很多团队给业务 API 写单元测试，却不给 ETL 写测试，理由通常是“ETL 太依赖数据库，不好测”。实际上 ETL 更需要测试，因为它一改就可能影响整份经营报表。

### 27.1 至少该测哪些内容

- 命令参数校验
- 关键转换规则
- 状态映射
- 金额汇总逻辑
- 幂等重跑结果一致
- 校验失败时能正确返回失败码

### 27.2 一个转换规则测试示例思路

```php
public function test_paid_and_partially_refunded_order_should_be_net_valid(): void
{
    $builder = app(OrderDetailBuilder::class);

    // 准备 ODS 订单、支付、退款测试数据
    // 执行 build
    // 断言 dwd_order_detail 中 is_net_valid = 1
}
```

不需要一开始就把所有链路都测满，但至少把最容易出经营口径事故的逻辑覆盖掉。

## 二十八、总结性的落地建议

如果让我把全文压缩成一份最实用的落地建议清单，我会给出下面这 15 条：

1. 先定业务日期 `biz_date` 的含义，再写代码。
2. 所有命令显式接收 `biz-date` 和 `batch-id`。
3. ODS、DWD、ADS 分层，不要一步到位直写报表表。
4. DAG 只做编排，不承担复杂业务口径。
5. Laravel 负责业务规则，Airflow 负责流程治理。
6. 每个 task 要能独立重跑。
7. 所有核心写入都要幂等。
8. 抽取窗口要覆盖晚到数据。
9. 校验失败必须能阻断错误数据发布。
10. 所有运行结果要落状态表，不只写日志。
11. 告警消息必须包含 `biz_date`、`batch_id`、task 名称。
12. 后台提供补数入口，不靠人工登录服务器。
13. 对热点任务做索引、分区和并发控制。
14. 用看板把任务状态和数据质量可视化。
15. 把 ETL 当作长期产品维护，而不是一次性脚本。

做到这些，你的 Laravel + Airflow 数据管道就已经不是“能跑的脚本合集”，而是一套可审计、可补数、可观察、可协作的工程体系。

## 相关阅读

- [Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录](/categories/DevOps/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Terraform 实战：Laravel 应用基础设施即代码（IaC）— 从手动点 AWS 控制台到代码化部署的踩坑记录](/categories/DevOps/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
- [数据库读写分离实战：Laravel 中间件 + MySQL 主从复制配置](/categories/Databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/)
- [数据库索引优化实战-覆盖索引联合索引与索引下推-Laravel-B2C-API踩坑记录](/categories/Databases/index-optimization-explain/)