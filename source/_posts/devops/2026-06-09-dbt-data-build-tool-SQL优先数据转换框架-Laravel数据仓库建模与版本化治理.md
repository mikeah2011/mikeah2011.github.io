---
title: dbt 实战：SQL 优先的数据转换框架——Laravel 项目的数据仓库建模与版本化治理
date: 2026-06-09 19:44:00
categories:
  - devops
tags:
  - dbt
  - 数据仓库
  - ETL
  - 数据建模
  - Laravel
  - Snowflake
  - PostgreSQL
description: 详解 dbt (data build tool) 在 Laravel 项目中的实战应用，涵盖 SQL 模型化、增量加载、测试治理、CI/CD 集成与生产级数据仓库架构，附完整可运行代码。
---

> 数据仓库的 ETL 不应该是一个黑盒。dbt 让你用 SQL + Git 管理整个数据转换层，每次变更可追溯、可测试、可回滚。

## 一、为什么 Laravel 项目需要 dbt

### 1.1 传统 ETL 的痛点

大多数 Laravel 项目的 BI 数据流长这样：

```
生产 DB → 队列/脚本抽取 → PHP 转换 → 写入分析库 → Superset/Metabase 展示
```

问题：

- **转换逻辑散落在 Artisan Command、Job、Controller 里**，没有版本化
- **口径不一致**：不同报表对「活跃用户」的定义不同，因为没人统一管
- **无测试**：改了转换逻辑，只能手动跑一遍看数字对不对
- **无法协作**：数据分析师不会 PHP，只能提需求等开发者实现

### 1.2 dbt 的定位

dbt（data build tool）不是 ETL 工具——它只做 **T**（Transform）。数据抽取交给 Fivetran/Airbyte/自定义脚本，dbt 负责把原始表变成可用的分析模型。

核心理念：

- **SQL 即代码**：每个模型就是一个 `.sql` 文件
- **DAG 依赖**：模型之间的引用自动解析为执行顺序
- **测试即文档**：`schema.yml` 定义测试，CI 自动运行
- **Git 工作流**：分支开发、PR 审查、合并部署

## 二、环境搭建

### 2.1 安装 dbt

```bash
# PostgreSQL 适配器（推荐用于 Laravel 项目）
pip install dbt-postgres

# Snowflake 适配器（如果用 Snowflake 做数仓）
pip install dbt-snowflake

# 验证安装
dbt --version
```

### 2.2 项目初始化

```bash
# 创建 dbt 项目
mkdir data-warehouse && cd data-warehouse
dbt init laravel_analytics
cd laravel_analytics

# 目录结构
# laravel_analytics/
# ├── dbt_project.yml        # 项目配置
# ├── models/                 # SQL 模型
# │   ├── staging/            # ODS → DWS（清洗层）
# │   ├── marts/              # DWS → ADS（应用层）
# │   └── schema.yml          # 测试定义
# ├── seeds/                  # 静态数据（CSV）
# ├── macros/                 # 自定义宏
# ├── tests/                  # 自定义测试
# └── profiles.yaml           # 数据库连接（在 ~/.dbt/）
```

### 2.3 连接 Laravel 的数据库

`~/.dbt/profiles.yaml`：

```yaml
laravel_analytics:
  target: dev
  outputs:
    dev:
      type: postgres
      host: "{{ env_var('DB_HOST') }}"
      port: 5432
      user: "{{ env_var('DB_USER') }}"
      pass: "{{ env_var('DB_PASSWORD') }}"
      dbname: analytics
      schema: dbt_dev
      threads: 4
    prod:
      type: postgres
      host: "{{ env_var('PROD_DB_HOST') }}"
      port: 5432
      user: "{{ env_var('PROD_DB_USER') }}"
      pass: "{{ env_var('PROD_DB_PASSWORD') }}"
      dbname: analytics
      schema: public
      threads: 8
```

`dbt_project.yml`：

```yaml
name: 'laravel_analytics'
version: '1.0.0'
config-version: 2

profile: 'laravel_analytics'

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["data"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

clean-targets:
  - "target"
  - "dbt_packages"

models:
  laravel_analytics:
    staging:
      +materialized: view
    marts:
      +materialized: table
      +schema: marts
```

## 三、数据建模实战

### 3.1 源数据定义

假设 Laravel 生产库有这些核心表（通过 CDC 或定时同步到分析库）：

`models/staging/sources.yml`：

```yaml
version: 2

sources:
  - name: laravel_prod
    database: analytics
    schema: raw
    tables:
      - name: users
        description: "用户主表"
        loaded_at_field: updated_at
        freshness:
          error_after: {count: 12, period: hour}
          warn_after: {count: 6, period: hour}
      - name: orders
        description: "订单表"
        loaded_at_field: updated_at
      - name: order_items
        description: "订单商品明细"
      - name: products
        description: "商品表"
      - name: payments
        description: "支付记录"
      - name: user_sessions
        description: "用户会话（Laravel Telescope 或自定义埋点）"
```

### 3.2 Staging 层：清洗与标准化

Staging 层做三件事：重命名、类型转换、过滤无效数据。

`models/staging/stg_users.sql`：

```sql
-- models/staging/stg_users.sql
with source as (
    select * from {{ source('laravel_prod', 'users') }}
),

renamed as (
    select
        id as user_id,
        name,
        email,
        email_verified_at,
        phone,
        country_code,
        status,
        created_at as registered_at,
        updated_at
    from source
    where id is not null
      and email is not null
      and status != 'deleted'
)

select * from renamed
```

`models/staging/stg_orders.sql`：

```sql
-- models/staging/stg_orders.sql
with source as (
    select * from {{ source('laravel_prod', 'orders') }}
),

renamed as (
    select
        id as order_id,
        user_id,
        order_number,
        status,
        currency,
        total_amount,
        discount_amount,
        tax_amount,
        shipping_amount,
        (total_amount - discount_amount + tax_amount + shipping_amount) as net_amount,
        payment_method,
        created_at as ordered_at,
        paid_at,
        shipped_at,
        completed_at,
        cancelled_at,
        updated_at
    from source
    where id is not null
      and user_id is not null
)

select * from renamed
```

`models/staging/stg_order_items.sql`：

```sql
-- models/staging/stg_order_items.sql
with source as (
    select * from {{ source('laravel_prod', 'order_items') }}
),

renamed as (
    select
        id as order_item_id,
        order_id,
        product_id,
        quantity,
        unit_price,
        (quantity * unit_price) as line_total,
        created_at
    from source
    where id is not null
)

select * from renamed
```

### 3.3 Mart 层：业务聚合

Mart 层是最终给 BI/报表用的宽表。

`models/marts/mart_user_lifetime_value.sql`：

```sql
-- models/marts/mart_user_lifetime_value.sql
-- 用户生命周期价值（LTV）：每个用户从注册至今的累计消费

with users as (
    select * from {{ ref('stg_users') }}
),

orders as (
    select * from {{ ref('stg_orders') }}
    where status in ('completed', 'paid')
),

user_orders as (
    select
        o.user_id,
        count(distinct o.order_id) as total_orders,
        sum(o.net_amount) as total_revenue,
        min(o.ordered_at) as first_order_at,
        max(o.ordered_at) as last_order_at,
        avg(o.net_amount) as avg_order_value
    from orders o
    group by 1
),

user_segments as (
    select
        u.user_id,
        u.registered_at,
        coalesce(ud.total_orders, 0) as total_orders,
        coalesce(ud.total_revenue, 0) as total_revenue,
        ud.first_order_at,
        ud.last_order_at,
        ud.avg_order_value,

        -- RFM 分层
        case
            when ud.total_orders >= 10 and ud.total_revenue >= 5000 then 'champion'
            when ud.total_orders >= 5 and ud.total_revenue >= 2000 then 'loyal'
            when ud.total_orders >= 2 then 'potential'
            when ud.total_orders = 1 then 'new'
            else 'at_risk'
        end as user_segment,

        -- 生命周期天数
        datediff('day', u.registered_at, current_timestamp) as lifecycle_days,

        -- 日均价值（简化 LTV 预估）
        case
            when datediff('day', u.registered_at, current_timestamp) > 0
            then coalesce(ud.total_revenue, 0) / datediff('day', u.registered_at, current_timestamp)
            else 0
        end as daily_revenue

    from users u
    left join user_orders ud on u.user_id = ud.user_id
)

select * from user_segments
```

`models/marts/mart_daily_revenue.sql`：

```sql
-- models/marts/mart_daily_revenue.sql
-- 每日营收汇总：GMV、订单数、客单价、新客占比

with orders as (
    select * from {{ ref('stg_orders') }}
    where status in ('completed', 'paid')
),

daily_metrics as (
    select
        date_trunc('day', ordered_at) as order_date,
        count(distinct order_id) as order_count,
        sum(net_amount) as gmv,
        avg(net_amount) as avg_order_value,

        -- 新客订单（首次下单日期 = 当天）
        count(distinct case
            when ordered_at = first_order_date then order_id
        end) as new_customer_orders,

        -- 新客占比
        case
            when count(distinct order_id) > 0
            then count(distinct case
                when ordered_at = first_order_date then order_id
            end)::float / count(distinct order_id)
            else 0
        end as new_customer_ratio

    from orders o
    left join (
        select user_id, min(ordered_at) as first_order_date
        from orders
        group by 1
    ) fo on o.user_id = fo.user_id
    group by 1
)

select * from daily_metrics
order by 1
```

### 3.4 数据血缘与 DAG

dbt 自动构建 DAG（有向无环图）：

```
sources (raw) → stg_users ─┐
                           ├─→ mart_user_lifetime_value
sources (raw) → stg_orders ┘
                           ├─→ mart_daily_revenue
sources (raw) → stg_order_items ┘
```

运行 `dbt docs generate && dbt docs serve` 可以在浏览器查看交互式血缘图。

## 四、测试治理

### 4.1 Schema 测试

`models/staging/schema.yml`：

```yaml
version: 2

models:
  - name: stg_users
    description: "清洗后的用户表"
    columns:
      - name: user_id
        description: "用户主键"
        tests:
          - unique
          - not_null
      - name: email
        description: "用户邮箱"
        tests:
          - unique
          - not_null
          - dbt_utils.expression_is_true:
              expression: "email like '%@%'"

  - name: stg_orders
    description: "清洗后的订单表"
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
      - name: user_id
        tests:
          - not_null
          - relationships:
              to: ref('stg_users')
              field: user_id
      - name: net_amount
        tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: "net_amount >= 0"
```

### 4.2 自定义数据质量测试

`tests/test_revenue_positive.sql`：

```sql
-- 自定义测试：确保每日营收不为负数
-- dbt 会检测返回的行数，> 0 则测试失败

select
    order_date,
    gmv
from {{ ref('mart_daily_revenue') }}
where gmv < 0
```

`tests/test_order_count_consistency.sql`：

```sql
-- 自定义测试：stg_orders 的 order_id 数量与源表一致

with source_count as (
    select count(*) as cnt from {{ source('laravel_prod', 'orders') }}
),
staging_count as (
    select count(*) as cnt from {{ ref('stg_orders') }}
)

select 1 as check_failed
from source_count s, staging_count t
where s.cnt != t.cnt
```

### 4.3 运行测试

```bash
# 运行所有模型和测试
dbt run && dbt test

# 只测试特定模型
dbt test --select mart_daily_revenue

# 运行后自动检测 freshness
dbt source freshness
```

## 五、增量模型与性能优化

### 5.1 增量加载

对于大表（如 `user_sessions`），全量刷新太慢。dbt 增量模型只处理新增/变更数据：

`models/marts/mart_user_sessions_daily.sql`：

```sql
-- models/marts/mart_user_sessions_daily.sql
-- 增量模型：只处理今天的数据

{{
    config(
        materialized='incremental',
        unique_key='session_id',
        incremental_strategy='merge'
    )
}}

with sessions as (
    select
        session_id,
        user_id,
        page_views,
        duration_seconds,
        created_at,
        date_trunc('day', created_at) as session_date
    from {{ source('laravel_prod', 'user_sessions') }}

    {% if is_incremental() %}
    where updated_at > (select max(updated_at) from {{ this }})
    {% endif %}
)

select * from sessions
```

### 5.2 快照（SCD Type 2）

跟踪维度表的缓慢变化——比如用户等级变更历史：

`snapshots/user_status_snapshot.sql`：

```sql
-- snapshots/user_status_snapshot.sql
-- SCD Type 2：记录用户状态的历史变更

{% snapshot user_status_snapshot %}

{{
    config(
        target_schema='snapshots',
        unique_key='user_id',
        strategy='timestamp',
        updated_at='updated_at'
    )
}}

select
    user_id,
    name,
    email,
    status,
    country_code,
    updated_at
from {{ source('laravel_prod', 'users') }}

{% endsnapshot %}
```

## 六、与 Laravel 集成

### 6.1 Artisan 命令触发 dbt

```php
<?php
// app/Console/Commands/RunDataWarehouse.php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class RunDataWarehouse extends Command
{
    protected $signature = 'dw:run {--model= : 指定模型名称} {--full : 全量刷新}';
    protected $description = '运行 dbt 数据仓库转换';

    public function handle(): int
    {
        $model = $this->option('model');
        $full = $this->option('full');

        $commands = [];

        if ($full) {
            $commands[] = 'dbt clean';
            $commands[] = 'dbt seed';
        }

        $runCmd = 'dbt run';
        if ($model) {
            $runCmd .= " --select {$model}";
        }
        $commands[] = $runCmd;
        $commands[] = 'dbt test';

        foreach ($commands as $cmd) {
            $this->info("执行: {$cmd}");
            $exitCode = 0;
            exec("cd " . base_path('data-warehouse') . " && {$cmd} 2>&1", $output, $exitCode);

            foreach ($output as $line) {
                $this->line($line);
            }

            if ($exitCode !== 0) {
                $this->error("命令失败: {$cmd}");
                return 1;
            }
        }

        $this->info('数据仓库更新完成');
        return 0;
    }
}
```

### 6.2 定时调度

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每天凌晨 2 点运行全量转换
    $schedule->command('dw:run --full')
        ->dailyAt('02:00')
        ->withoutOverlapping()
        ->emailOutputOnFailure('admin@example.com');
}
```

### 6.3 Laravel 队列异步执行

```php
<?php
// app/Jobs/RunDataWarehouseJob.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class RunDataWarehouseJob implements ShouldQueue
{
    use Queueable, InteractsWithQueue;

    public int $timeout = 600; // 10 分钟超时
    public int $tries = 2;

    public function handle(): void
    {
        $process = new \Symfony\Component\Process\Process(
            ['dbt', 'run', '--select', $this->model],
            base_path('data-warehouse')
        );

        $process->setTimeout(600);
        $process->run();

        if (!$process->isSuccessful()) {
            throw new \RuntimeException(
                "dbt 失败: {$process->getErrorOutput()}"
            );
        }
    }
}
```

## 七、CI/CD 流水线

### 7.1 GitHub Actions 配置

`.github/workflows/dbt-ci.yml`：

```yaml
name: dbt CI

on:
  pull_request:
    paths:
      - 'data-warehouse/**'

jobs:
  dbt-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dbt
        run: pip install dbt-postgres

      - name: dbt deps
        working-directory: data-warehouse
        run: dbt deps

      - name: dbt build (run + test)
        working-directory: data-warehouse
        run: dbt build --select state:modified+ --defer --state ./manifest
        env:
          DB_HOST: ${{ secrets.DB_HOST }}
          DB_USER: ${{ secrets.DB_USER }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}

      - name: dbt docs generate
        if: github.event_name == 'pull_request'
        working-directory: data-warehouse
        run: dbt docs generate

      - name: Comment PR with lineage
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const manifest = JSON.parse(
              fs.readFileSync('data-warehouse/target/manifest.json')
            );
            // 提取受影响的模型并评论
```

### 7.2 PR 审查检查清单

每次 dbt PR 应该包含：

- [ ] 新模型有 `schema.yml` 测试
- [ ] 增量模型有 `unique_key`
- [ ] 破坏性变更（列删除/重命名）有 migration 说明
- [ ] `dbt run && dbt test` 在 CI 通过

## 八、踩坑记录

### 8.1 PostgreSQL 的 `datediff` 不存在

PostgreSQL 没有 `datediff` 函数，需要用减法：

```sql
-- 错误（Snowflake 语法）
datediff('day', created_at, current_timestamp)

-- 正确（PostgreSQL）
(current_timestamp::date - created_at::date)

-- 或者用 dbt_utils 兼容
{{ dbt_utils.datediff("created_at", "current_timestamp", "day") }}
```

### 8.2 大表全量刷新超时

`user_sessions` 表有 5000 万行，全量刷新要 20 分钟。解决方案：

```yaml
# dbt_project.yml 中为大表配置独立 schema
models:
  laravel_analytics:
    marts:
      mart_user_sessions_daily:
        +materialized: incremental
        +unique_key: session_id
        +incremental_strategy: merge
```

### 8.3 密码中的特殊字符

`profiles.yaml` 中密码含 `@` 或 `#` 时会解析失败：

```yaml
# 错误
pass: "P@ss#word"

# 正确：用环境变量
pass: "{{ env_var('DB_PASSWORD') }}"
```

### 8.4 并发写入冲突

多个 dbt job 同时写同一张表会冲突。解决方案：

- **开发环境**：每个开发者用独立 schema（`dbt_dev_michael`、`dbt_dev_alice`）
- **生产环境**：`dbt run` 加锁，不要并发执行
- **增量模型**：用 `merge` 策略避免锁表

### 8.5 模型引用循环

不小心写了循环引用：

```sql
-- model_a.sql 引用 model_b
select * from {{ ref('model_b') }}

-- model_b.sql 引用 model_a
select * from {{ ref('model_a') }}
```

dbt 会报错 `Found a cycle`。解决：提取公共 CTE，或者拆分为三个模型。

## 九、监控与告警

### 9.1 dbt 与数据质量监控

```php
<?php
// app/Console/Commands/MonitorDataQuality.php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class MonitorDataQuality extends Command
{
    protected $signature = 'dw:monitor';

    public function handle(): int
    {
        // 运行 dbt test 并收集结果
        $process = new \Symfony\Component\Process\Process(
            ['dbt', 'test', '--output', 'json'],
            base_path('data-warehouse')
        );
        $process->run();

        $results = json_decode($process->getOutput(), true);

        $failures = array_filter($results, fn($r) => $r['status'] === 'error');

        if (!empty($failures)) {
            // 发送告警到飞书/Slack
            $this->notifyFailure($failures);
        }

        return empty($failures) ? 0 : 1;
    }

    private function notifyFailure(array $failures): void
    {
        $message = "⚠️ 数据质量告警\n\n";
        foreach ($failures as $f) {
            $message .= "❌ {$f['unique_id']}: {$f['message']}\n";
        }

        // 集成飞书 webhook
        \Http::post(config('services.feishu.webhook'), [
            'msg_type' => 'text',
            ['content' => ['text' => $message]],
        ]);
    }
}
```

## 十、总结

| 维度 | 传统 PHP ETL | dbt |
|------|-------------|-----|
| 版本控制 | 分散在代码各处 | Git 仓库，PR 审查 |
| 测试 | 手动验证 | 自动化 schema + 数据测试 |
| 血缘 | 靠文档（或没有） | 自动生成 DAG |
| 协作 | 开发者独占 | 分析师可直接写 SQL |
| 回滚 | 靠运气 | Git revert |
| 文档 | 过期的 Wiki | `dbt docs` 实时生成 |

**适用场景**：

- Laravel 项目的 BI 数据流超过 3 个表的转换
- 团队有数据分析师，需要自主写转换逻辑
- 需要数据质量保障（测试 + 监控）
- 已有或计划建设数据仓库

**不适用**：

- 简单报表，直接 SQL 查询就够
- 实时流处理（dbt 是批处理）
- 数据抽取（dbt 只做 Transform）

dbt 的核心价值：**让数据转换像应用代码一样可测试、可协作、可追溯**。如果你的 Laravel 项目已经有一定规模的数据分析需求，dbt 是最值得投入的基础设施。
