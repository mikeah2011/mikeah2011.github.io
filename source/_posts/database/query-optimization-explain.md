---
title: 百万级数据表查询优化实战-Laravel-B2C-API-EXPLAIN-深度分析索引重构与分页治理踩坑记录
date: 2026-05-05 00:45:46
updated: 2026-05-05 00:50:30
categories:
  - database
tags: [Laravel, MySQL, 性能优化, EXPLAIN, 索引优化, 覆盖索引, 游标分页]
keywords: [Laravel, B2C, API, EXPLAIN, 百万级数据表查询优化实战, 深度分析索引重构与分页治理踩坑记录, 数据库]
description: 在 KKday B2C API 中面对千万级订单表和百万级商品表的真实查询优化实战——从 EXPLAIN 逐行分析到覆盖索引设计、从 OFFSET 分页风暴到游标分页、从慢查询埋点到归档策略，完整还原一次「P1 级慢查询治理」的全过程。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-021-content-1.jpg
  - /images/content/databases-021-content-2.jpg



---

## 前言：当 API 响应从 200ms 飙到 8s

KKday 的 B2C API 在 2024 年 Q3 接到前端团队的告警：「商品列表页偶发 8s+ 响应」。压测数据显示 p99 延迟从正常的 300ms 飙到 8200ms，且只在特定筛选条件下触发。

问题定位到两条 SQL：

```sql
-- 商品列表（带筛选+排序+分页）
SELECT * FROM products WHERE category_id = ? AND status = 1
  ORDER BY score DESC, id DESC LIMIT 20 OFFSET 48000;

-- 订单历史（用户维度查询）
SELECT * FROM orders WHERE user_id = ? AND status IN (1,2,3)
  ORDER BY created_at DESC LIMIT 20 OFFSET 120000;
```

products 表 120 万行，orders 表 800 万行。`OFFSET 48000` 意味着 MySQL 需要扫描并丢弃 48000 行再返回 20 行——这不是索引能解决的问题。

以下是完整的治理过程。

---

## 一、EXPLAIN 逐行分析：先搞清楚「慢在哪」

优化的第一步永远不是加索引，而是 `EXPLAIN ANALYZE`：

```sql
EXPLAIN ANALYZE
SELECT * FROM products
WHERE category_id = 5 AND status = 1
ORDER BY score DESC, id DESC
LIMIT 20 OFFSET 48000\G
```

输出（简化）：

```
-> Limit: 20 row(s) offset 48000
  -> Index lookup on products using idx_category_status (category_id=5, status=1)
       (actual rows=48020 loops=1)
```

**关键发现**：虽然走了 `idx_category_status` 索引，但 MySQL 必须回表 48020 次来获取 `score` 值进行排序，然后丢弃前 48000 行。回表成本 = 48020 次随机 IO。

### 踩坑 1：EXPLAIN 和 EXPLAIN ANALYZE 的区别

MySQL 8.0.18+ 才支持 `EXPLAIN ANALYZE`，它会**实际执行**查询并返回真实行数和时间。普通的 `EXPLAIN` 只返回估算行数，经常误导优化方向。在我们的案例中，`EXPLAIN` 显示 `rows: 1200`（估算），但实际扫描了 48020 行——差了 40 倍。

---

## 二、索引重构：覆盖索引 + 排序索引的组合拳

![索引重构与覆盖索引设计](/images/content/databases-021-content-1.jpg)

### 2.1 原始索引的问题

```sql
-- 原始索引
ALTER TABLE products ADD INDEX idx_category_status (category_id, status);
```

这个索引能快速定位 `category_id = 5 AND status = 1` 的行，但**不包含** `score` 和 `id`，所以排序必须回表。

### 2.2 覆盖索引设计

```sql
-- 覆盖索引：包含 WHERE 条件 + ORDER BY 字段
ALTER TABLE products ADD INDEX idx_cat_status_score_id
  (category_id, status, score DESC, id DESC);
```

优化后 EXPLAIN：

```
-> Limit: 20 row(s) offset 48000
  -> Index scan on products using idx_cat_status_score_id (reverse)
       (actual rows=48020 loops=1)
       (actual time=0.045..12.3ms)
```

**关键变化**：`Using index`（覆盖索引），无需回表。但 OFFSET 48000 仍然要扫描 48020 行，耗时从 8200ms 降到 380ms——快了 20 倍，但还不够。

### 踩坑 2：覆盖索引的列顺序必须严格匹配

我们最初尝试了 `(category_id, status, id, score)` 的顺序，结果 MySQL 无法用它做 `ORDER BY score DESC, id DESC` 的排序优化。**索引列的顺序必须和 ORDER BY 完全一致**，否则退化为 filesort。

验证方法：

```sql
EXPLAIN SELECT score, id FROM products
WHERE category_id = 5 AND status = 1
ORDER BY score DESC, id DESC
LIMIT 20;
-- Extra 中必须看到 "Using index"，不能有 "Using filesort"
```

---

## 三、分页治理：OFFSET 是万恶之源

![游标分页与OFFSET性能对比](/images/content/databases-021-content-2.jpg)

### 3.1 OFFSET 的本质问题

```
OFFSET 0   → 扫描 20 行  → 0.5ms
OFFSET 10000  → 扫描 10020 行 → 45ms
OFFSET 100000 → 扫描 100020 行 → 450ms
OFFSET 500000 → 扫描 500020 行 → 2200ms  ← 前端在第 25000 页时崩溃
```

OFFSET 的时间复杂度是 O(N)，N 越大越慢。这不是索引能解决的——**必须换分页策略**。

### 3.2 游标分页（Cursor Pagination）

用上一页最后一条记录的排序字段作为游标：

```php
// ❌ 传统 OFFSET 分页
$products = Product::where('category_id', $categoryId)
    ->where('status', 1)
    ->orderByDesc('score')
    ->orderByDesc('id')
    ->paginate(20);  // 内部用 OFFSET

// ✅ 游标分页
$products = Product::where('category_id', $categoryId)
    ->where('status', 1)
    ->when($request->cursor, function ($query) use ($request) {
        $cursor = json_decode(base64_decode($request->cursor));
        $query->where(function ($q) use ($cursor) {
            $q->where('score', '<', $cursor->score)
              ->orWhere(function ($q2) use ($cursor) {
                  $q2->where('score', $cursor->score)
                     ->where('id', '<', $cursor->id);
              });
        });
    })
    ->orderByDesc('score')
    ->orderByDesc('id')
    ->limit(20)
    ->get();

// 生成下一页游标
$last = $products->last();
$nextCursor = $last
    ? base64_encode(json_encode(['score' => $last->score, 'id' => $last->id]))
    : null;
```

游标分页的 EXPLAIN：

```
-> Limit: 20 row(s)
  -> Index range scan on products using idx_cat_status_score_id
       (actual rows=20 loops=1)
       (actual time=0.012..0.015ms)  ← 永远只扫描 20 行！
```

**性能对比**：

| 指标 | OFFSET 分页 | 游标分页 | 说明 |
|------|------------|---------|------|
| 第 1 页延迟 | 0.5ms | 0.5ms | 起点相同 |
| 第 100 页延迟 | 5ms | 0.5ms | OFFSET 开始显现差距 |
| 第 1000 页延迟 | 45ms | 0.5ms | 差 90 倍 |
| 第 25000 页延迟 | 2200ms | 0.5ms | 差 4400 倍，前端已不可用 |
| 时间复杂度 | O(N) | O(1) | N = OFFSET 偏移量 |
| 索引扫描行数 | offset + limit | limit | 游标永远只扫 limit 行 |
| 是否支持跳页 | ✅ | ❌ | 游标只能上一页/下一页 |
| 深分页内存消耗 | 高（需临时表排序） | 极低 | OFFSET 越大临时表越大 |
| 网络传输量 | 恒定（只返回 limit 行） | 恒定 | 两者返回量相同 |
| 适用场景 | 后台管理（页数有限） | C 端列表/无限滚动 | 按业务场景选择 |

### 踩坑 3：游标分页不支持「跳页」

游标分页只支持「上一页/下一页」，不支持「跳到第 500 页」。这在 B2C 场景下其实不是问题——用户很少翻到第 100 页之后。但后台管理页面需要跳页，我们的方案是：

- 前台（C 端）：游标分页
- 后台（Admin）：OFFSET 分页 + 强制限制 `page <= 100`，超过的用搜索/筛选缩小范围

---

## 四、查询层优化：Laravel ORM 的隐藏陷阱

### 4.1 避免 `SELECT *`

```php
// ❌ SELECT * — 800 万行表每行返回 40+ 字段
Order::where('user_id', $userId)->get();

// ✅ 只取需要的字段
Order::where('user_id', $userId)
    ->select('id', 'order_no', 'status', 'total_amount', 'created_at')
    ->get();
```

`SELECT *` 的影响在百万级表上被放大：每个字段都增加网络传输量和内存占用。我们的订单表有 45 个字段，但列表页只需要 5 个。优化后单次查询的网络传输从 12MB 降到 1.5MB。

### 4.2 Chunk 分批处理

批量导出、数据迁移等场景绝不能一次性 `get()`：

```php
// ❌ 一次加载 800 万行到内存 → OOM
$orders = Order::all();

// ✅ 分批处理，每批 1000 行
Order::where('status', 3)
    ->orderBy('id')
    ->chunk(1000, function ($orders) {
        foreach ($orders as $order) {
            // 处理逻辑
        }
        // 每批处理完后立即释放内存
    });
```

### 4.3 Cursor 逐行流式处理

对于数据迁移脚本，`cursor()` 比 `chunk()` 更省内存：

```php
// cursor() 每次只在内存中保持一行
foreach (Order::where('created_at', '<', '2024-01-01')->cursor() as $order) {
    archiveOrder($order);
}
```

### 踩坑 4：chunk + delete 的事务陷阱

```php
// ❌ 在 chunk 回调中直接 delete — 可能跳过记录
Order::where('status', 5)->chunk(1000, function ($orders) {
    $orders->each->delete();  // 删除后分页偏移错乱
});

// ✅ 用 chunkById 保证稳定性
Order::where('status', 5)->chunkById(1000, function ($orders) {
    Order::whereIn('id', $orders->pluck('id'))->delete();
});
```

`chunkById` 始终用 `WHERE id > lastId` 而非 OFFSET，删除/插入不影响分页。

---

## 五、架构层面：分区 + 归档 + 冷热分离

### 5.1 按月分区（订单表）

```sql
ALTER TABLE orders PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202401 VALUES LESS THAN (202402),
    PARTITION p202402 VALUES LESS THAN (202403),
    -- ...
    PARTITION p202412 VALUES LESS THAN (202501),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

查询当月订单时，MySQL 自动裁剪到单个分区：

```sql
-- 分区裁剪：只扫描 p202405
SELECT * FROM orders
WHERE user_id = 12345
  AND created_at >= '2024-05-01'
  AND created_at < '2024-06-01';
```

### 5.2 冷数据归档

```php
// 每月 1 日凌晨，归档 6 个月前的已完成订单
class ArchiveOldOrders implements ShouldQueue
{
    public function handle(): void
    {
        $cutoff = now()->subMonths(6);
        
        Order::where('created_at', '<', $cutoff)
            ->where('status', OrderStatus::COMPLETED)
            ->orderBy('id')
            ->chunkById(5000, function ($orders) {
                $ids = $orders->pluck('id');
                
                // 复制到归档表
                DB::statement(
                    'INSERT INTO orders_archive SELECT * FROM orders WHERE id IN (?)',
                    [$ids]
                );
                
                // 从主表删除
                Order::whereIn('id', $ids)->delete();
                
                Log::info('Archived orders', ['count' => $ids->count()]);
            });
    }
}
```

归档后，orders 表从 800 万行降到 200 万行，查询 p99 延迟下降 60%。

---

## 六、监控闭环：慢查询日志 + 自动告警

### 6.1 MySQL 慢查询日志配置

```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;          -- 超过 1s 的查询记录
SET GLOBAL log_queries_not_using_indexes = ON;  -- 记录未走索引的查询
```

### 6.2 Laravel Query Log + Prometheus 埋点

```php
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    DB::listen(function (QueryExecuted $query) {
        $duration = $query->time; // ms
        
        if ($duration > 500) {
            Log::warning('Slow query detected', [
                'sql' => $query->sql,
                'bindings' => $query->bindings,
                'time' => $duration,
            ]);
        }
        
        // Prometheus 指标上报
        app(PrometheusExporter::class)->observeQuery($query);
    });
}
```

---

## 优化成果总结

```
┌──────────────────────────────────────────────────────┐
│                    优化前后对比                        │
├─────────────────┬──────────────┬─────────────────────┤
│      指标        │   优化前      │      优化后          │
├─────────────────┼──────────────┼─────────────────────┤
│ 商品列表 p99     │   8200ms     │      12ms           │
│ 订单历史 p99     │   3500ms     │       8ms           │
│ orders 表行数    │   800 万     │    200 万 (归档后)   │
│ 分页深度极限     │  ~2000 页    │     无限制 (游标)     │
│ 导出脚本内存     │  2.1GB       │    恒定 32MB         │
└─────────────────┴──────────────┴─────────────────────┘
```

**核心原则**：百万级数据表的优化不是某一个银弹，而是「索引 + 分页策略 + 查询裁剪 + 归档」的组合拳。每一步都有 10-100 倍的收益，叠加起来才是最终的效果。

## 相关阅读

- [数据库索引优化实战：覆盖索引、联合索引与索引下推——Laravel B2C API 踩坑记录](/categories/Databases/index-optimization-explain/)
- [MySQL 窗口函数实战：ROW_NUMBER / RANK / DENSE_RANK 在运营报表中的应用](/categories/Databases/mysql-guide-row-number-rank-dense-rank/)
- [TiDB 实战：分布式 SQL 数据库在 Laravel 中的集成——MySQL 兼容的 NewSQL 选型指南](/categories/MySQL/TiDB-实战-分布式SQL数据库在Laravel中的集成-MySQL兼容的NewSQL选型指南/)
