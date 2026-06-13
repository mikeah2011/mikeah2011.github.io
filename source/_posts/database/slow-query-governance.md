---
title: MySQL-慢查询治理实战-pt-query-digest-分析-索引优化与-SQL-重写-Laravel-B2C-API踩坑记录
date: 2026-05-05 06:55:04
description: "本文系统介绍 MySQL 慢查询的完整治理方法论，涵盖慢查询日志配置、使用 pt-query-digest 进行深度分析、EXPLAIN 执行计划解读、索引优化策略与 SQL 重写技巧。结合 Laravel B2C 电商 API 的真实踩坑经验，详解 N+1 查询、深分页、隐式类型转换等常见性能陷阱，并提供 CI/CD 慢查询防御、监控告警等生产环境最佳实践，帮助开发者建立从发现到修复的慢查询治理闭环。"
updated: 2026-05-05 06:58:22
tags: [Laravel, MySQL, 性能优化]
keywords: [MySQL, pt, query, digest, SQL, Laravel, B2C, API, 慢查询治理实战, 分析]
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-slow-query-01-content-1.jpg
  - /images/content/databases-slow-query-01-content-2.jpg



---

# MySQL 慢查询治理实战：pt-query-digest 分析 + 索引优化 + SQL 重写

## 前言

在 KKday B2C API 的日常运维中，"接口慢"是最高频的线上告警之一。排查一圈下来，90% 的根因都指向同一个地方——**MySQL 慢查询**。曾经我们有个商品列表接口，高峰期 P99 延迟飙到 3 秒，最终定位到一条全表扫描的 SQL，加了个联合索引后降到 50ms。

这篇文章记录的是我在 30+ 个 Laravel 仓库中实践出的**系统化慢查询治理方法论**：从发现、分析到修复的完整闭环。

---

## 一、架构概览：慢查询治理闭环

```
┌─────────────────────────────────────────────────────────┐
│                    慢查询治理闭环                          │
│                                                         │
│  ① 采集层          ② 分析层          ③ 修复层            │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐        │
│  │ slow_log │────▶│pt-query  │────▶│索引优化   │        │
│  │ 配置采集  │     │  digest  │     │SQL 重写   │        │
│  └──────────┘     └──────────┘     └──────────┘        │
│       │                │                │               │
│       ▼                ▼                ▼               │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐        │
│  │监控告警   │     │Top N 排序│     │回归验证   │        │
│  │Laravel   │     │执行计划   │     │EXPLAIN   │        │
│  │日志联动   │     │对比分析   │     │压测确认   │        │
│  └──────────┘     └──────────┘     └──────────┘        │
│                                                         │
│  ④ 防御层                                               │
│  ┌──────────────────────────────────────────────┐      │
│  │ CI 慢查询检测 → Code Review SQL Review → 线上巡检  │      │
│  └──────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

![慢查询治理闭环架构](/images/content/databases-slow-query-01-content-1.jpg)

---

## 二、开启 MySQL 慢查询日志

### 2.1 my.cnf 配置

```ini
[mysqld]
# 开启慢查询日志
slow_query_log = 1
# 慢查询阈值（秒），生产环境建议 1s，排查期可调到 0.5s
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1

# 记录没有使用索引的查询
log_queries_not_using_indexes = 1
# 限制每分钟记录的无索引查询数量，避免日志爆炸
log_throttle_queries_not_using_indexes = 60

# 记录管理语句
log_slow_admin_statements = 1
# 记录从库的慢查询
log_slow_replica_statements = 1
```

### 2.2 动态开启（不重启 MySQL）

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
SET GLOBAL log_queries_not_using_indexes = 'ON';
SET GLOBAL log_throttle_queries_not_using_indexes = 60;

-- 验证配置
SHOW VARIABLES LIKE '%slow_query%';
SHOW VARIABLES LIKE '%long_query_time%';
```

### ⚠️ 踩坑 1：log_queries_not_using_indexes 导致日志爆炸

生产环境第一次开启 `log_queries_not_using_indexes` 时，慢查询日志在 1 小时内涨到了 20GB，磁盘直接打满。

**根因**：开发环境的很多查询确实没走索引（数据量小无所谓），但生产环境全部涌入日志。

**解决方案**：
- 必须配合 `log_throttle_queries_not_using_indexes` 限制速率
- 先排查期开 1-2 小时，收集到足够样本后关闭
- 或者只在从库开启，避免影响主库性能

---

## 三、pt-query-digest 深度分析

### 3.1 安装 Percona Toolkit

```bash
# macOS
brew install percona-toolkit

# Ubuntu/Debian
apt-get install percona-toolkit

# CentOS/RHEL
yum install percona-toolkit

# 验证安装
pt-query-digest --version
```

### 3.2 基本用法：分析慢查询日志

```bash
# 分析整个慢查询日志
pt-query-digest /var/log/mysql/slow.log > slow_query_report.txt

# 分析最近 1 小时的日志
pt-query-digest --since '1h' /var/log/mysql/slow.log

# 分析特定时间范围
pt-query-digest --since '2026-05-04 10:00:00' --until '2026-05-04 12:00:00' \
    /var/log/mysql/slow.log

# 只看执行时间超过 2s 的查询
pt-query-digest --filter '$event->{Query_time} >= 2' /var/log/mysql/slow.log
```

### 3.3 报告解读

pt-query-digest 输出的报告分为三个主要部分：

```
# Profile
# Rank Query ID                      Response time  Calls  R/Call  V/M
# ==== ============================== ============= ====== ======= =====
#    1 0x7D98E4A2B1C3F5E6D7A8B9C0...  350.2345 45.2%    150  2.3349  0.12
#    2 0x8E0A9F3D2B4C6E8F1A3D5B7C...  120.5678 15.6%   2000  0.0603  0.01
#    3 0x9F1B0C4E3D5F7A9B2C4E6D8F...   85.4321 11.0%    800  0.1068  0.05
```

**关键指标**：
- **Rank**：按总响应时间排序
- **Response time**：该类查询的总耗时及占比
- **Calls**：执行次数
- **R/Call**：单次平均耗时
- **V/M**：方差/均值比，越大说明性能越不稳定

### 3.4 实战：分析 Laravel B2C API 的慢查询

```bash
# 从 MySQL 直接分析（推荐，不依赖日志文件）
pt-query-digest \
    --user=monitor \
    --password=your_password \
    --review h=localhost,D=slow_query,t=query_review \
    --history h=localhost,D=slow_query,t=query_review_history \
    /var/log/mysql/slow.log

# 结合 Laravel 日志交叉分析
pt-query-digest \
    --filter '$event->{arg} =~ m/SELECT.*FROM.*orders/i' \
    /var/log/mysql/slow.log
```

### ⚠️ 踩坑 2：pt-query-digest 分析大日志文件 OOM

30GB 的慢查询日志直接分析，pt-query-digest 内存直接打爆（默认会把所有查询指纹缓存在内存中）。

**解决方案**：

```bash
# 方案一：先用 head/tail 截取时间范围
# 用 awk 按时间过滤，只分析特定时段
awk '/^# Time: 2026-05-04T1[0-2]/' /var/log/mysql/slow.log > /tmp/slow_subset.log
pt-query-digest /tmp/slow_subset.log

# 方案二：使用 --limit 限制输出
pt-query-digest --limit 20 /var/log/mysql/slow.log

# 方案三：使用管道 + 分段处理
tail -100000 /var/log/mysql/slow.log | pt-query-digest -
```

---

## 四、EXPLAIN 深度分析

![EXPLAIN 执行计划分析](/images/content/databases-slow-query-01-content-2.jpg)

拿到 pt-query-digest 的 Top N 慢查询后，下一步是用 EXPLAIN 分析执行计划。

### 4.1 EXPLAIN 输出关键字段

```sql
EXPLAIN SELECT o.id, o.order_no, o.status, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.merchant_id = 123
  AND o.status = 'paid'
  AND o.created_at >= '2026-05-01'
ORDER BY o.created_at DESC
LIMIT 20;
```

```
+----+-------------+-------+------------+-------+----------------+---------+---------+------+--------+----------+------------------------------------+
| id | select_type | table | partitions | type  | possible_keys  | key     | key_len | ref  | rows   | filtered | Extra                              |
+----+-------------+-------+------------+-------+----------------+---------+---------+------+--------+----------+------------------------------------+
|  1 | SIMPLE      | o     | NULL       | range | idx_merchant   | idx_mer | 8       | NULL | 152340 |    10.00 | Using index condition; Using where |
|  1 | SIMPLE      | u     | NULL       | eq_ref| PRIMARY        | PRIMARY | 8       | o.ui |      1 |   100.00 | Using where                        |
+----+-------------+-------+------------+-------+----------------+---------+---------+------+--------+----------+------------------------------------+
```

### 4.2 必须关注的几个指标

| 字段 | 含义 | 告警阈值 |
|------|------|----------|
| `type` | ALL（全表扫描）、index（全索引扫描）需要重点关注 | ALL 或 index |
| `rows` | 预估扫描行数 | > 10000 |
| `filtered` | 过滤比例，越低说明索引选择性差 | < 20% |
| `Extra` | Using filesort / Using temporary 需要优化 | 出现即关注 |
| `key` | NULL 表示没有使用索引 | NULL |

### 4.3 实战案例：一个典型的慢查询优化

**原始 SQL（P99 耗时 2.8s）**：

```sql
SELECT SQL_CALC_FOUND_ROWS
    p.id, p.title, p.price, p.cover_image,
    c.name AS category_name,
    AVG(r.score) AS avg_score
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN reviews r ON r.product_id = p.id
WHERE p.merchant_id = 456
  AND p.status = 'active'
  AND p.price BETWEEN 100 AND 500
GROUP BY p.id
ORDER BY p.sort_order ASC, p.id DESC
LIMIT 0, 20;
```

**EXPLAIN 结果**：products 表 type=ALL，全表扫描 50 万行。

**诊断过程**：

```sql
-- 检查现有索引
SHOW INDEX FROM products;

-- 发现有 idx_merchant_status(merchant_id, status)，但查询条件加了 price BETWEEN
-- 联合索引没有覆盖 price 范围查询
```

**优化方案**：

```sql
-- 添加覆盖查询条件的联合索引
ALTER TABLE products ADD INDEX idx_merchant_status_price_sort(
    merchant_id, status, price, sort_order, id
);

-- 去掉 SQL_CALC_FOUND_ROWS（MySQL 8.0.17 已废弃，改用子查询）
-- 重写后的 SQL
SELECT p.id, p.title, p.price, p.cover_image,
       c.name AS category_name,
       COALESCE(r.avg_score, 0) AS avg_score
FROM products p
INNER JOIN categories c ON p.category_id = c.id
LEFT JOIN (
    SELECT product_id, AVG(score) AS avg_score
    FROM reviews
    GROUP BY product_id
) r ON r.product_id = p.id
WHERE p.merchant_id = 456
  AND p.status = 'active'
  AND p.price BETWEEN 100 AND 500
ORDER BY p.sort_order ASC, p.id DESC
LIMIT 0, 20;
```

**效果**：P99 从 2.8s → 45ms，rows 从 50 万 → 120。

---

## 五、SQL 重写模式

### 5.1 避免 SELECT *

```php
// ❌ 反模式：Laravel ORM 默认 select *
$orders = Order::where('merchant_id', $merchantId)
    ->where('status', 'paid')
    ->get();

// ✅ 只查需要的字段
$orders = Order::where('merchant_id', $merchantId)
    ->where('status', 'paid')
    ->select(['id', 'order_no', 'total_amount', 'created_at'])
    ->get();
```

### 5.2 避免子查询，改用 JOIN

```php
// ❌ 反模式：相关子查询，每行都执行一次
$orders = DB::table('orders')
    ->whereRaw('user_id IN (SELECT id FROM users WHERE vip_level > 3)')
    ->where('status', 'paid')
    ->get();

// ✅ 改用 JOIN
$orders = DB::table('orders')
    ->join('users', 'orders.user_id', '=', 'users.id')
    ->where('users.vip_level', '>', 3)
    ->where('orders.status', 'paid')
    ->select(['orders.*'])
    ->get();
```

### 5.3 分页优化：深分页问题

```php
// ❌ 反模式：OFFSET 深分页（第 10000 页，跳过 20 万行）
$products = Product::where('merchant_id', $merchantId)
    ->orderBy('id', 'desc')
    ->offset(200000)
    ->limit(20)
    ->get();

// ✅ 游标分页（Cursor-based Pagination）
$products = Product::where('merchant_id', $merchantId)
    ->where('id', '<', $lastId) // 使用上一页最后一条的 ID
    ->orderBy('id', 'desc')
    ->limit(20)
    ->get();

// ✅ 延迟关联（Deferred Join）
$ids = Product::where('merchant_id', $merchantId)
    ->orderBy('id', 'desc')
    ->offset(200000)
    ->limit(20)
    ->pluck('id');

$products = Product::whereIn('id', $ids)
    ->orderByRaw('FIELD(id, ' . $ids->implode(',') . ')')
    ->get();
```

### 5.4 COUNT 优化

```php
// ❌ 反模式：用 SQL_CALC_FOUND_ROWS 或 COUNT(*) 做总数
$total = DB::table('orders')
    ->where('merchant_id', $merchantId)
    ->where('status', 'paid')
    ->count();

// ✅ 缓存总数（适用于实时性要求不高的场景）
$total = Cache::remember("orders_count:{$merchantId}:paid", 300, function () use ($merchantId) {
    return DB::table('orders')
        ->where('merchant_id', $merchantId)
        ->where('status', 'paid')
        ->count();
});

// ✅ 使用近似值（InnoDB 行数估算）
$total = DB::selectOne(
    "SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
)->TABLE_ROWS;
```

### ⚠️ 踩坑 3：Laravel Eager Loading 的 N+1 陷阱

```php
// ❌ N+1 查询：100 个订单 × (1 + 查询 user + 查询 items) = 301 次查询
$orders = Order::where('merchant_id', $merchantId)->get();
foreach ($orders as $order) {
    echo $order->user->name;      // 每次触发一条 SELECT
    echo $order->items->count();  // 每次触发一条 SELECT
}

// ✅ Eager Loading：3 次查询搞定
$orders = Order::with(['user', 'items'])
    ->where('merchant_id', $merchantId)
    ->get();

// ✅ 条件 Eager Loading + 指定字段
$orders = Order::with([
    'user:id,name,email',
    'items:id,order_id,product_id,quantity,price',
])->where('merchant_id', $merchantId)->get();
```

**Laravel 开发环境检测 N+1**：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Database\Eloquent\Model;

public function boot()
{
    // 开发环境严格模式：N+1 查询直接抛异常
    if ($this->app->isLocal()) {
        Model::preventLazyLoading(!$this->app->isProduction());
    }
}
```

---

## 六、索引优化最佳实践

### 6.1 联合索引的最左前缀原则

```sql
-- 联合索引: idx_a_b_c(a, b, c)

-- ✅ 走索引
WHERE a = 1
WHERE a = 1 AND b = 2
WHERE a = 1 AND b = 2 AND c = 3

-- ✅ 走部分索引（只用到 a）
WHERE a = 1 AND c = 3  -- c 不走索引，但 a 走

-- ❌ 不走索引
WHERE b = 2
WHERE c = 3
WHERE b = 2 AND c = 3
```

### 6.2 覆盖索引（Covering Index）

```sql
-- 查询只需要索引中的字段，无需回表
-- 联合索引: idx_merchant_status_created(merchant_id, status, created_at)

SELECT merchant_id, status, created_at
FROM orders
WHERE merchant_id = 123 AND status = 'paid';

-- EXPLAIN 的 Extra 列显示 "Using index" 表示覆盖索引命中
```

### 6.3 索引选择性与前缀索引

```sql
-- 对于 VARCHAR(255) 的字段，用前缀索引节省空间
-- 计算最佳前缀长度
SELECT
    COUNT(DISTINCT LEFT(order_no, 8)) / COUNT(*) AS sel_8,
    COUNT(DISTINCT LEFT(order_no, 12)) / COUNT(*) AS sel_12,
    COUNT(DISTINCT LEFT(order_no, 16)) / COUNT(*) AS sel_16,
    COUNT(DISTINCT order_no) / COUNT(*) AS sel_full
FROM orders;
-- 如果 sel_12 已经接近 sel_full，用 12 位前缀索引
ALTER TABLE orders ADD INDEX idx_order_no_prefix(order_no(12));
```

### ⚠️ 踩坑 4：索引过多导致写入性能暴跌

一次上线加了 5 个索引，INSERT 的 P99 从 5ms 飙到 80ms。

**根因**：每写一行数据，MySQL 需要同步更新所有索引的 B+ 树。

**解决方案**：
- 单表索引不超过 5-6 个
- 定期清理未使用的索引：

```sql
-- MySQL 8.0+：查看索引使用情况
SELECT * FROM sys.schema_unused_indexes WHERE object_schema = 'your_db';

-- 查看冗余索引
SELECT * FROM sys.schema_redundant_indexes WHERE table_schema = 'your_db';
```

---

## 七、Laravel 集成慢查询监控

### 7.1 Laravel Query Log 中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QueryMonitor
{
    public function handle($request, Closure $next)
    {
        if (!app()->isProduction() || $request->has('debug_queries')) {
            DB::enableQueryLog();
        }

        $response = $next($request);

        if (DB::getQueryLog()) {
            $slowQueries = array_filter(DB::getQueryLog(), function ($query) {
                return $query['time'] > 100; // 超过 100ms
            });

            if (!empty($slowQueries)) {
                Log::warning('Slow queries detected', [
                    'url'    => $request->fullUrl(),
                    'method' => $request->method(),
                    'queries' => array_map(function ($q) {
                        return [
                            'sql'  => $q['query'],
                            'time' => $q['time'] . 'ms',
                            'bindings' => $q['bindings'],
                        ];
                    }, $slowQueries),
                ]);
            }
        }

        return $response;
    }
}
```

### 7.2 注册到 Kernel

```php
// app/Http/Kernel.php
protected $middlewareGroups = [
    'api' => [
        // ... 其他中间件
        \App\Http\Middleware\QueryMonitor::class,
    ],
];
```

### 7.3 定时慢查询巡检脚本

```bash
#!/bin/bash
# scripts/slow-query-patrol.sh

SLOW_LOG="/var/log/mysql/slow.log"
REPORT_DIR="/var/reports/slow-query"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$REPORT_DIR"

# 使用 pt-query-digest 生成报告
pt-query-digest \
    --since '1h' \
    --limit 20 \
    --output report \
    "$SLOW_LOG" > "${REPORT_DIR}/report_${DATE}.txt"

# 提取 Top 5 慢查询
TOP_QUERIES=$(pt-query-digest --since '1h' --limit 5 --format json "$SLOW_LOG" 2>/dev/null)

# 发送 Slack 通知（如果 Top 1 查询超过 5s）
MAX_TIME=$(echo "$TOP_QUERIES" | jq -r '.classes[0].metrics.Query_time.sum // 0')
if (( $(echo "$MAX_TIME > 5" | bc -l) )); then
    curl -X POST "$SLACK_WEBHOOK" \
        -H 'Content-Type: application/json' \
        -d "{\"text\": \"🐌 慢查询告警：Top1 查询总耗时 ${MAX_TIME}s，报告：${REPORT_DIR}/report_${DATE}.txt\"}"
fi
```

---

## 八、CI/CD 中的慢查询防御

### 8.1 Laravel 测试中检测慢查询

```php
<?php

namespace Tests\Concerns;

use Illuminate\Support\Facades\DB;

trait DetectSlowQueries
{
    public function setUpDetectSlowQueries(): void
    {
        DB::enableQueryLog();
        $this->beforeApplicationDestroyed(function () {
            $slowQueries = array_filter(DB::getQueryLog(), fn($q) => $q['time'] > 500);
            if (!empty($slowQueries)) {
                $details = collect($slowQueries)->map(fn($q) =>
                    "[{$q['time']}ms] {$q['query']}"
                )->implode("\n");
                $this->fail("检测到慢查询:\n{$details}");
            }
        });
    }
}

// 在 TestCase 中使用
abstract class TestCase extends BaseTestCase
{
    use DetectSlowQueries;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDetectSlowQueries();
    }
}
```

### 8.2 GitLab CI SQL Review

```yaml
# .gitlab-ci.yml
sql-review:
  stage: test
  script:
    - php artisan migrate --pretend --database=mysql 2>&1 | grep -i "alter\|create\|add index" > sql_changes.txt
    - |
      if [ -s sql_changes.txt ]; then
        echo "📋 SQL Changes detected:"
        cat sql_changes.txt
        # 检查是否包含索引
        if grep -qi "add index" sql_changes.txt; then
          echo "⚠️ New index detected - please review for redundancy"
        fi
      fi
  rules:
    - changes:
        - database/migrations/**
```

---

## 九、生产环境踩坑合集

### 踩坑 5：隐式类型转换导致索引失效

```sql
-- user_id 是 VARCHAR(36)，但 Laravel 传了整数
SELECT * FROM orders WHERE user_id = 12345;
-- MySQL 会把 VARCHAR 转成数字比较，导致索引失效！
-- EXPLAIN 显示 type=ALL，rows=全表

-- 正确写法
SELECT * FROM orders WHERE user_id = '12345';
```

在 Laravel 中排查：

```php
// 开启严格模式，禁止隐式类型转换
// config/database.php
'mysql' => [
    'strict' => true, // 会抛出类型不匹配的警告
],
```

### 踩坑 6：OR 条件不走索引

```sql
-- ❌ OR 条件导致索引失效
SELECT * FROM products
WHERE merchant_id = 123 OR slug = 'iphone-15';
-- 即使 merchant_id 和 slug 都有索引，OR 也可能不走索引

-- ✅ 改用 UNION ALL
SELECT * FROM products WHERE merchant_id = 123
UNION ALL
SELECT * FROM products WHERE slug = 'iphone-15' AND merchant_id != 123;
```

### 踩坑 7：LIKE '%keyword%' 全表扫描

```sql
-- ❌ 前缀模糊匹配不走索引
SELECT * FROM products WHERE title LIKE '%手机%';

-- ✅ 方案一：全文索引（MySQL 5.7+）
ALTER TABLE products ADD FULLTEXT INDEX ft_title(title) WITH PARSER ngram;
SELECT * FROM products WHERE MATCH(title) AGAINST('手机' IN BOOLEAN MODE);

-- ✅ 方案二：Elasticsearch（推荐用于复杂搜索场景）
-- 参见：Elasticsearch-全文搜索深度调优实战
```

### 踩坑 8：ORDER BY RAND() 性能灾难

```sql
-- ❌ 每次全表扫描 + 排序
SELECT * FROM products ORDER BY RAND() LIMIT 10;

-- ✅ 先随机取 ID，再回表
SELECT p.* FROM products p
INNER JOIN (
    SELECT id FROM products
    WHERE merchant_id = 123 AND status = 'active'
    ORDER BY RAND() LIMIT 10
) t ON p.id = t.id;
```

---

## 十、监控与告警方案

```
┌──────────────────────────────────────────────────┐
│               慢查询监控架构                       │
│                                                  │
│  MySQL slow_log                                  │
│      │                                           │
│      ▼                                           │
│  Filebeat / Promtail                             │
│      │                                           │
│      ▼                                           │
│  Elasticsearch / Loki                            │
│      │                                           │
│      ▼                                           │
│  Grafana Dashboard                               │
│  ┌──────────────────────────────────────────┐   │
│  │ 指标：                                    │   │
│  │ • 慢查询数量/分钟                          │   │
│  │ • Top 10 慢查询 SQL 指纹                   │   │
│  │ • 慢查询耗时 P50/P95/P99                   │   │
│  │ • 无索引查询占比                            │   │
│  └──────────────────────────────────────────┘   │
│      │                                           │
│      ▼                                           │
│  Alertmanager → Slack/钉钉/PagerDuty             │
│  • 慢查询数量突增 > 200%（同比）                   │
│  • 新出现的 SQL 指纹                              │
│  • 单条查询 P99 > 5s                             │
└──────────────────────────────────────────────────┘
```

---

## 总结

| 阶段 | 工具 | 目标 |
|------|------|------|
| 发现 | MySQL slow_log + Laravel Query Log | 定位慢查询 |
| 分析 | pt-query-digest + EXPLAIN | 量化影响、定位根因 |
| 修复 | 索引优化 + SQL 重写 + 架构调整 | 降低查询耗时 |
| 防御 | CI 检测 + 定时巡检 + 监控告警 | 防止回归 |

慢查询治理不是一次性的事，而是**持续的工程实践**。建议每周跑一次 pt-query-digest 巡检，把 Top 10 慢查询纳入 Sprint 的技术债务中。30+ 个仓库的经验告诉我：**80% 的慢查询问题都可以通过加对索引 + 改写 SQL 解决**，剩下 20% 才需要动架构（读写分离、分库分表、引入缓存/ES）。

---

*本文基于 KKday B2C Backend Team 真实项目经验，持续更新中。*

---

## 相关阅读

- [数据库索引优化实战](/categories/Databases/index-optimization-explain/) — 从 B+ 树原理出发，系统讲解索引设计与优化策略
- [MySQL 索引优化实战 EXPLAIN 分析](/categories/Databases/index-deep-dive-explain/) — 深入 EXPLAIN 各字段解读与索引优化案例
- [SQL 语句性能分析工具 explain](/categories/Databases/explain/) — 掌握 EXPLAIN 工具，快速定位 SQL 性能瓶颈
