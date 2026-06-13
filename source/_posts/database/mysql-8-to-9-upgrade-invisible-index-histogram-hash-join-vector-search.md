---
title: MySQL 8.0 到 9.0 升级实战：不可见索引、直方图、Hash Join、向量搜索——Laravel 项目的平滑迁移路径
date: 2026-06-05 09:30:00
tags: [MySQL, Laravel, 升级, 不可见索引, 直方图, hash join, 向量搜索]
categories:
  - database
cover: /images/covers/mysql-8-to-9-upgrade-cover.jpg
description: "MySQL 8.0 到 9.0 升级实战指南：深入讲解不可见索引、直方图统计、Hash Join 与向量搜索四大核心特性，结合 Laravel 项目提供可落地的代码示例与平滑迁移路径。"
---

## 前言：为什么要从 MySQL 8.0 升级到 9.0？

在 2024 年 MySQL 8.0 达到长期支持版的成熟期后，Oracle 陆续发布了 MySQL 8.4 LTS 和 9.0 Innovation 版本。MySQL 9.0 作为 Innovation Release（创新版本），虽然不承诺十年级别的长期支持，但它所引入的新特性却为开发者带来了巨大的性能提升和功能扩展空间。这些特性包括不可见索引的进一步成熟、直方图统计信息的优化器增强、Hash Join 的全面落地，以及令人兴奋的向量搜索能力。

对于正在使用 Laravel 构建 B2C 电商 API 服务的团队来说，数据库层面的每一次升级都牵一发而动全身。业务高峰期间的毫秒级延迟可能直接影响转化率，一个错误的执行计划可能导致整条 API 链路超时。因此，MySQL 升级不仅仅是一个运维操作，更是一项需要深度规划的技术决策。

本文将基于一个真实的 Laravel B2C 电商项目，详细介绍从 MySQL 8.0 平滑升级到 9.0 的完整路径。我们将深入探讨四个核心特性——不可见索引、直方图、Hash Join 和向量搜索——在实际业务场景中的应用，并给出可落地的 Laravel 代码示例和运维操作步骤。

---

## 一、不可见索引：安全删除索引的"后悔药"

### 1.1 什么是不可见索引

在数据库的日常运维中，索引管理一直是一个高风险操作。我们在生产环境中经常面临这样的困境：某个索引看起来很少被使用，占用磁盘空间和写入性能，但又不敢轻易删除，因为不确定是否有哪些低频但关键的查询依赖它。不可见索引（Invisible Index）正是为了解决这一痛点而设计的。

不可见索引的核心机制是：索引在物理上仍然存在，数据写入时仍然会被维护更新，但 MySQL 优化器在生成执行计划时会完全忽略该索引。这意味着，将一个索引设为不可见后，所有查询将不再使用该索引——如果性能没有明显下降，说明该索引确实可以安全删除；如果性能恶化，只需将索引恢复为可见状态即可，无需任何数据重建操作，几乎是瞬时完成的。

### 1.2 实战操作演示

```sql
-- 第一步：查看当前表的索引状态
SHOW INDEX FROM orders;

-- 第二步：将候选索引设为不可见
-- 优化器不再使用该索引，但数据仍然被维护
ALTER TABLE orders ALTER INDEX idx_user_id INVISIBLE;

-- 第三步：观察慢查询日志，确认没有因索引不可见导致的性能问题
-- 可以通过 SHOW STATUS LIKE 'Handler_read%' 观察索引使用变化

-- 第四步：经过 3-7 天观察期后，确认安全再删除
ALTER TABLE orders DROP INDEX idx_user_id;

-- 如果在观察期内发现性能下降，立即恢复可见即可
ALTER TABLE orders ALTER INDEX idx_user_id VISIBLE;

-- 查看所有不可见索引的状态
SELECT TABLE_NAME, INDEX_NAME, IS_VISIBLE 
FROM information_schema.STATISTICS 
WHERE TABLE_SCHEMA = 'your_database' 
  AND IS_VISIBLE = 'NO';
```

### 1.3 在 Laravel Migration 中集成不可见索引

Laravel 11 已经支持通过原生 SQL 语句来操作不可见索引。我们可以编写一个分阶段的 Migration 来实现安全的索引清理：

```php
// database/migrations/2026_06_01_000000_mark_unused_indexes_invisible.php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 将候选索引设为不可见，开始观察期
        $indexes = [
            ['orders', 'idx_user_id'],
            ['orders', 'idx_created_at'],
            ['order_items', 'idx_product_id_created'],
        ];

        foreach ($indexes as [$table, $index]) {
            DB::statement("ALTER TABLE {$table} ALTER INDEX {$index} INVISIBLE");
            info("已将 {$table}.{$index} 设为不可见索引");
        }
    }

    public function down(): void
    {
        $indexes = [
            ['orders', 'idx_user_id'],
            ['orders', 'idx_created_at'],
            ['order_items', 'idx_product_id_created'],
        ];

        foreach ($indexes as [$table, $index]) {
            DB::statement("ALTER TABLE {$table} ALTER INDEX {$index} VISIBLE");
            info("已恢复 {$table}.{$index} 为可见索引");
        }
    }
};
```

### 1.4 最佳实践流程

在实际项目中，建议按照以下流程执行索引清理：

首先，通过 `sys.schema_unused_indexes` 视图和慢查询日志分析，识别出长期未使用的候选索引。然后，通过 Migration 将这些索引设为不可见。进入观察期后，重点关注慢查询日志、API 响应时间和数据库的 Handler 计数器变化。观察期建议持续三到七天，覆盖完整的业务周期。确认安全后，编写新的 Migration 删除索引，释放磁盘空间和写入性能。

---

## 二、直方图统计：让优化器真正理解你的数据分布

### 2.1 为什么直方图如此重要

MySQL 的查询优化器在选择执行计划时，依赖的是统计信息。传统上，MySQL 只维护索引的基本统计（如基数、页面数等），但对数据的实际分布情况一无所知。这在数据分布均匀的场景下问题不大，但在 B2C 电商业务中，数据倾斜几乎是常态。

举例来说，在订单表中，`status` 字段的分布可能是这样的：`completed` 占 70%，`shipped` 占 15%，`pending` 占 10%，`cancelled` 占 5%。如果没有直方图，优化器可能认为对 `status` 列的查询会返回约 25% 的数据（按均匀分布估算），从而选择全表扫描而非索引扫描。但实际上查询 `status = 'pending'` 只会命中 10% 的数据，索引扫描才是最优选择。

直方图（Histogram）通过采样和分桶的方式，记录每一列数据的实际分布情况。优化器利用这些信息，可以更准确地估算查询结果集大小，从而选择更优的执行计划。

### 2.2 创建和管理直方图

```sql
-- 为 orders 表的 status 列创建直方图，使用 100 个桶
ANALYZE TABLE orders UPDATE HISTOGRAM ON status WITH 100 BUCKETS;

-- 同时为多个常用查询条件列创建直方图
ANALYZE TABLE products UPDATE HISTOGRAM ON category_id, price WITH 200 BUCKETS;

-- 为用户表的常用筛选列创建直方图
ANALYZE TABLE users UPDATE HISTOGRAM ON city_id, vip_level, register_source WITH 100 BUCKETS;

-- 查看直方图信息（返回 JSON 格式的分布数据）
SELECT COLUMN_NAME, HISTOGRAM 
FROM information_schema.COLUMN_STATISTICS 
WHERE TABLE_SCHEMA = 'your_database' 
  AND TABLE_NAME = 'orders';

-- 删除不再需要的直方图
ANALYZE TABLE orders DROP HISTOGRAM ON status;
```

### 2.3 直方图对 Laravel 查询的实际影响

创建直方图后，以下 Laravel 查询模式会自动受益，无需修改任何代码：

```php
// 场景一：查询特定状态的订单（数据严重倾斜）
// 假设 pending 只占 10%，直方图能让优化器选择索引扫描
$pendingOrders = Order::where('status', 'pending')
    ->where('created_at', '>=', now()->subDays(7))
    ->with(['user', 'items'])
    ->paginate(20);

// 场景二：价格区间筛选（价格分布通常不均匀）
// 直方图能准确估算落在该区间的商品数量
$affordableProducts = Product::whereBetween('price', [50, 200])
    ->where('category_id', 5)
    ->orderBy('sales_count', 'desc')
    ->get();

// 场景三：多条件组合查询
// 直方图为每个条件提供准确的过滤因子估算
$orders = Order::query()
    ->where('status', 'shipped')
    ->whereBetween('total_amount', [100, 5000])
    ->whereHas('items', function ($query) {
        $query->where('category_id', 5)->where('quantity', '>', 1);
    })
    ->get();
```

### 2.4 自动化直方图更新

数据分布会随着业务变化而改变，因此直方图需要定期更新。建议创建一个 Laravel 调度任务来自动化这个过程：

```php
// app/Console/Commands/UpdateHistograms.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class UpdateHistograms extends Command
{
    protected $signature = 'db:update-histograms 
                            {--force : 强制更新所有直方图}
                            {--table= : 指定更新特定表}';
    
    protected $description = '更新业务核心表的直方图统计信息，提升查询优化器的决策准确性';

    private array $histograms = [
        'orders'    => ['status', 'total_amount'],
        'products'  => ['category_id', 'price', 'brand_id'],
        'users'     => ['city_id', 'vip_level'],
        'order_items' => ['product_id'],
    ];

    public function handle(): int
    {
        $targetTable = $this->option('table');
        $tables = $targetTable 
            ? [$targetTable => $this->histograms[$targetTable] ?? []] 
            : $this->histograms;

        foreach ($tables as $table => $columns) {
            if (empty($columns)) {
                $this->warn("表 {$table} 没有配置需要更新的直方图列");
                continue;
            }

            $columnsStr = implode(', ', $columns);
            $this->info("正在更新 {$table} 的直方图: {$columnsStr}");
            
            try {
                DB::statement(
                    "ANALYZE TABLE {$table} UPDATE HISTOGRAM ON {$columnsStr} WITH 100 BUCKETS"
                );
                $this->info("  ✅ {$table} 直方图更新成功");
            } catch (\Throwable $e) {
                $this->error("  ❌ {$table} 直方图更新失败: {$e->getMessage()}");
            }
        }

        $this->info('直方图更新任务完成。');
        return self::SUCCESS;
    }
}
```

在 `app/Console/Kernel.php` 中配置定时执行，建议每天凌晨业务低峰期运行：

```php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('db:update-histograms')
        ->dailyAt('03:00')
        ->withoutOverlapping()
        ->appendOutputTo(storage_path('logs/histogram-update.log'));
}
```

---

## 三、Hash Join：多表关联查询的性能飞跃

### 3.1 理解 Hash Join 与 Nested Loop 的区别

在 MySQL 9.0 之前，多表关联查询主要依赖 Nested Loop Join（嵌套循环连接）。这种方式的逻辑非常直观：外层表取一行，到内层表中通过索引查找匹配的行，然后循环往复。当两张表都有合适的索引时，这种方式效率很高。

但在实际的 B2C 电商业务中，我们经常遇到这样的查询：需要关联订单明细表和商品表进行报表统计，关联条件是等值匹配，但结果集非常大。此时 Nested Loop 需要为每一行都发起一次索引查找，在大数据量下性能急剧下降。

Hash Join 的原理完全不同：它先将较小的表加载到内存中，构建一个哈希表，然后扫描较大的表，通过哈希查找直接定位匹配的行。这种方式在等值连接条件下，特别是当一张表较小而另一张表较大时，性能提升非常显著。

### 3.2 Hash Join 的触发条件

Hash Join 在以下条件同时满足时会自动启用：连接条件必须是等值比较（如 `ON a.id = b.a_id`），非等值条件（如范围比较）不适用；优化器估算认为 Hash Join 的代价低于 Nested Loop；连接缓冲区的大小足够容纳构建阶段的数据。

MySQL 9.0 中，Hash Join 的实现相比 8.0 有了显著改进，包括支持更多连接场景、更好的内存管理、以及与并行查询的集成。

### 3.3 Laravel 中的典型应用场景

```php
// 场景：月度销售报表查询，关联订单明细、商品和用户三张表
// 这类多表等值连接在 Hash Join 下性能提升非常明显

$report = DB::table('order_items as oi')
    ->join('products as p', 'p.id', '=', 'oi.product_id')
    ->join('orders as o', 'o.id', '=', 'oi.order_id')
    ->join('users as u', 'u.id', '=', 'o.user_id')
    ->where('o.status', 'completed')
    ->whereBetween('o.created_at', [$startDate, $endDate])
    ->select(
        'p.name as product_name',
        'u.city_id',
        DB::raw('COUNT(DISTINCT o.id) as order_count'),
        DB::raw('SUM(oi.quantity) as total_qty'),
        DB::raw('SUM(oi.subtotal) as total_revenue')
    )
    ->groupBy('p.id', 'p.name', 'u.city_id')
    ->orderByDesc('total_revenue')
    ->limit(100)
    ->get();

// 场景：用户画像分析，关联多维度数据
$userInsights = DB::table('orders as o')
    ->join('order_items as oi', 'oi.order_id', '=', 'o.id')
    ->join('products as p', 'p.id', '=', 'oi.product_id')
    ->where('o.user_id', $userId)
    ->where('o.status', 'completed')
    ->select(
        'p.category_id',
        DB::raw('COUNT(*) as purchase_count'),
        DB::raw('SUM(oi.subtotal) as total_spent'),
        DB::raw('AVG(oi.unit_price) as avg_price')
    )
    ->groupBy('p.category_id')
    ->orderByDesc('total_spent')
    ->get();
```

### 3.4 Hash Join 的性能调优

```sql
-- 使用 EXPLAIN FORMAT=TREE 查看是否启用了 Hash Join
EXPLAIN FORMAT=TREE 
SELECT p.name, SUM(oi.quantity)
FROM order_items oi
JOIN products p ON p.id = oi.product_id
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'completed'
GROUP BY p.id, p.name;

-- 输出中如果包含 "Hash join" 关键字，说明已启用
-- 例如：-> Hash join (inner join) ...

-- 适当增大 join buffer 以容纳更大的构建表
SET SESSION join_buffer_size = 256 * 1024 * 1024; -- 256MB

-- 查看当前 join buffer 大小
SHOW VARIABLES LIKE 'join_buffer_size';
```

在生产环境的 MySQL 配置文件中建议添加：

```ini
[mysqld]
# Hash Join 相关配置
join_buffer_size = 256M
# MySQL 9.0 默认启用 hash_join，通常无需手动设置
# hash_join = ON
```

---

## 四、向量搜索：MySQL 的原生 AI 能力

### 4.1 全新的 VECTOR 数据类型

MySQL 9.0 最令人激动的新特性之一是原生的 `VECTOR` 数据类型。它允许在数据库中直接存储高维向量数据，并提供内置的距离计算函数和相似度搜索能力。这意味着在 Laravel 项目中实现语义搜索、推荐系统等 AI 功能时，不再必须引入 Pinecone、Milvus 等外部向量数据库——MySQL 自身就能胜任中小规模的向量检索任务。

`VECTOR` 类型支持存储浮点数组，维度理论上没有硬性上限（受行大小限制）。数据以紧凑的二进制格式存储，查询时通过内置函数计算向量间的距离。

```sql
-- 创建带向量列的表
CREATE TABLE product_embeddings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    embedding VECTOR NOT NULL COMMENT '商品的文本嵌入向量',
    model_version VARCHAR(50) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_product_id (product_id)
);

-- 插入向量数据（以 JSON 数组格式表示）
INSERT INTO product_embeddings (product_id, embedding) 
VALUES (1, STRING_TO_VECTOR('[0.123, -0.456, 0.789, ..., 0.321]'));

-- 查询向量的维度信息
SELECT product_id, VECTOR_DIMENSION(embedding) as dimensions 
FROM product_embeddings LIMIT 5;
```

### 4.2 距离函数与相似度搜索

MySQL 9.0 提供了三种核心距离度量函数，每种适用于不同的应用场景：

```sql
-- 1. 欧氏距离（L2 距离）：用 <-> 运算符表示
-- 适用于数值特征比较，距离越小越相似
SELECT product_id, 
       STRING_TO_VECTOR('[0.1, 0.2, 0.3]') <-> embedding AS euclidean_distance
FROM product_embeddings
ORDER BY euclidean_distance
LIMIT 10;

-- 2. 余弦距离：用 <=> 运算符表示
-- 适用于文本嵌入的语义搜索，值越小表示越相似
-- 相似度 = 1 - 余弦距离
SELECT product_id,
       1 - (STRING_TO_VECTOR('[0.1, 0.2, 0.3]') <=> embedding) AS cosine_similarity
FROM product_embeddings
ORDER BY cosine_similarity DESC
LIMIT 10;

-- 3. 内积距离：用 <*> 运算符表示
-- 适用于归一化向量的快速比较
SELECT product_id,
       STRING_TO_VECTOR('[0.1, 0.2, 0.3]') <*> embedding AS inner_product
FROM product_embeddings
ORDER BY inner_product DESC
LIMIT 10;
```

### 4.3 在 Laravel 中集成向量搜索服务

以下是一个完整的 Laravel 向量搜索服务实现，包含向量生成、存储和检索功能：

```php
// app/Services/ProductVectorSearchService.php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProductVectorSearchService
{
    private string $model = 'text-embedding-3-small';
    private int $dimensions = 1536;

    /**
     * 调用 OpenAI API 生成文本嵌入向量
     */
    public function generateEmbedding(string $text): array
    {
        $response = \OpenAI::client()->embeddings()->create([
            'model' => $this->model,
            'input' => $text,
        ]);

        return $response->embeddings[0]->embedding;
    }

    /**
     * 为商品生成并存储向量嵌入
     */
    public function indexProduct(int $productId): void
    {
        $product = DB::table('products')->where('id', $productId)->first();
        if (!$product) {
            Log::warning("商品 {$productId} 不存在，跳过向量索引");
            return;
        }

        // 拼接商品的文本描述用于生成嵌入
        $text = implode(' ', array_filter([
            $product->name,
            $product->description,
            $product->category_name ?? '',
            $product->brand_name ?? '',
        ]));

        $embedding = $this->generateEmbedding($text);
        $vectorStr = '[' . implode(',', $embedding) . ']';

        DB::table('product_embeddings')->updateOrInsert(
            ['product_id' => $productId],
            [
                'embedding'      => DB::raw("STRING_TO_VECTOR('{$vectorStr}')"),
                'model_version'  => $this->model,
                'updated_at'     => now(),
            ]
        );

        Log::info("商品 {$productId} 向量索引已更新，维度: {$this->dimensions}");
    }

    /**
     * 基于语义的相似商品搜索
     */
    public function searchSimilar(int $productId, int $limit = 10): array
    {
        $target = DB::table('product_embeddings')
            ->where('product_id', $productId)
            ->first();

        if (!$target) {
            return [];
        }

        // 使用余弦距离进行相似度搜索
        return DB::table('product_embeddings as pe')
            ->join('products as p', 'p.id', '=', 'pe.product_id')
            ->where('pe.product_id', '!=', $productId)
            ->select(
                'p.id', 'p.name', 'p.price', 'p.main_image',
                DB::raw("1 - (pe.embedding <=> (SELECT embedding FROM product_embeddings WHERE product_id = {$productId})) AS similarity")
            )
            ->orderBy('similarity', 'desc')
            ->limit($limit)
            ->get()
            ->toArray();
    }

    /**
     * 基于文本查询的语义搜索
     */
    public function searchByQuery(string $query, int $limit = 20): array
    {
        $embedding = $this->generateEmbedding($query);
        $vectorStr = '[' . implode(',', $embedding) . ']';

        return DB::table('product_embeddings as pe')
            ->join('products as p', 'p.id', '=', 'pe.product_id')
            ->where('p.status', 'active')
            ->select(
                'p.id', 'p.name', 'p.price', 'p.main_image',
                DB::raw("1 - (STRING_TO_VECTOR('{$vectorStr}') <=> pe.embedding) AS relevance")
            )
            ->orderBy('relevance', 'desc')
            ->limit($limit)
            ->get()
            ->toArray();
    }
}
```

### 4.4 向量索引优化

当数据量达到十万级以上时，暴力扫描所有向量计算距离的方式会变得很慢。MySQL 9.0 支持创建向量索引来加速查询：

```sql
-- 创建基于 HNSW 算法的向量索引
-- HNSW 是目前最常用的近似最近邻算法，在精度和速度之间取得了良好平衡
ALTER TABLE product_embeddings 
ADD VECTOR INDEX idx_embedding_hnsw (embedding) 
ALGORITHM = HNSW;

-- 查看向量索引的创建状态
SHOW CREATE TABLE product_embeddings;
```

---

## 五、升级路径：从 8.0 到 9.0 的完整步骤

### 5.1 升级前的准备工作

升级前的准备工作是整个流程中最关键的环节。任何疏忽都可能导致数据丢失或服务中断。

```bash
# 1. 完整备份数据库（这是最重要的一步，绝不可以跳过！）
mysqldump --single-transaction --routines --triggers --all-databases \
  --result-file=backup_before_upgrade_$(date +%Y%m%d%H%M).sql

# 2. 确认当前版本
mysql -e "SELECT VERSION();"
# 期望输出：8.0.x

# 3. 检查表的完整性和兼容性
mysqlcheck --all-databases --check-upgrade --auto-repair

# 4. 导出当前的慢查询基线数据
# 用于升级后对比，确认没有出现性能回归
mysql -e "SELECT * FROM sys.statements_with_full_table_access LIMIT 20;"
```

### 5.2 兼容性检查清单

在升级前，务必逐项检查以下兼容性问题：

```sql
-- 检查是否有使用废弃语法的存储过程或函数
SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE 
FROM information_schema.ROUTINES 
WHERE ROUTINE_DEFINITION LIKE '%STRAIGHT_JOIN%'
   OR ROUTINE_DEFINITION LIKE '%SQL_CALC_FOUND_ROWS%';

-- 检查所有表的字符集是否为 utf8mb4（utf8mb3 在 9.0 中已废弃）
SELECT TABLE_SCHEMA, TABLE_NAME, CCSA.CHARACTER_SET_NAME 
FROM information_schema.TABLES T
JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY CCSA
  ON T.TABLE_COLLATION = CCSA.COLLATION_NAME
WHERE CCSA.CHARACTER_SET_NAME = 'utf8';

-- 对所有核心表执行完整性检查
CHECK TABLE orders, products, users, order_items;

-- 检查当前的认证插件配置
SELECT user, host, plugin FROM mysql.user;
```

### 5.3 执行升级

```bash
# 方式一：包管理器升级（适合开发和测试环境）
# Ubuntu/Debian 系统
sudo apt update && sudo apt install mysql-server-9.0

# CentOS/RHEL 系统  
sudo yum update mysql-server

# 方式二：Docker 容器升级（推荐用于生产环境的渐进式迁移）
docker pull mysql:9.0
docker stop mysql8-container
docker run -d --name mysql9-container \
  -v /data/mysql:/var/lib/mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=your_secure_password \
  -e MYSQL_DATABASE=your_database \
  mysql:9.0

# 方式三：云服务原地升级（AWS RDS、阿里云 RDS、腾讯云 CDB 等）
# 在云控制台选择目标版本，执行原地升级操作
# 通常支持蓝绿部署，可快速回滚
```

### 5.4 升级后验证

```sql
-- 确认版本已升级成功
SELECT VERSION();
-- 期望输出：9.0.x

-- 运行系统表的自动修复（MySQL 9.0 通常会自动完成）
-- 但建议手动确认

-- 运行核心业务查询，确认执行计划没有异常变化
EXPLAIN SELECT * FROM orders WHERE user_id = 12345 AND status = 'pending';
EXPLAIN SELECT o.*, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'completed';

-- 开启慢查询日志进行对比分析
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.5;
```

---

## 六、Laravel 项目的特殊考量

### 6.1 数据库配置更新

升级 MySQL 后，需要同步更新 Laravel 的数据库配置：

```php
// config/database.php 中的 mysql 连接配置
'mysql' => [
    'driver' => 'mysql',
    'url' => env('DATABASE_URL'),
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'forge'),
    'username' => env('DB_USERNAME', 'forge'),
    'password' => env('DB_PASSWORD', ''),
    'unix_socket' => env('DB_SOCKET', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'prefix_indexes' => true,
    'strict' => true,
    'engine' => null,
    'server_version' => '9.0', // 更新版本号，影响 Doctrine DBAL 的行为
    'options' => extension_loaded('pdo_mysql') ? array_filter([
        PDO::ATTR_CASE => PDO::CASE_NATURAL,
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]) : [],
],
```

### 6.2 自动化升级兼容性测试

```php
// app/Console/Commands/TestUpgradeCompatibility.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class TestUpgradeCompatibility extends Command
{
    protected $signature = 'upgrade:test-compatibility';
    protected $description = '全面测试 MySQL 9.0 升级兼容性';

    public function handle(): int
    {
        $tests = [
            '数据库版本'    => fn() => DB::select('SELECT VERSION()'),
            'InnoDB 引擎'  => fn() => DB::select('SHOW ENGINE INNODB STATUS'),
            '字符集配置'    => fn() => DB::select("SHOW VARIABLES LIKE 'character_set_server'"),
            '核心查询-订单' => fn() => DB::table('orders')->limit(1)->get(),
            '核心查询-用户' => fn() => DB::table('users')->limit(1)->get(),
            '多表关联查询'  => fn() => DB::table('orders')
                ->join('users', 'users.id', '=', 'orders.user_id')
                ->limit(5)->get(),
            '聚合查询'      => fn() => DB::table('orders')
                ->selectRaw('status, COUNT(*) as cnt')
                ->groupBy('status')->get(),
            '向量功能'      => fn() => DB::select("SELECT STRING_TO_VECTOR('[1,2,3]')"),
        ];

        $passed = 0;
        $failed = 0;

        foreach ($tests as $name => $test) {
            try {
                $result = $test();
                $this->info("  ✅ {$name} — 通过");
                $passed++;
            } catch (\Throwable $e) {
                $this->error("  ❌ {$name} — 失败: {$e->getMessage()}");
                $failed++;
            }
        }

        $this->newLine();
        $this->info("测试完成: {$passed} 项通过, {$failed} 项失败");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
```

### 6.3 Eloquent 查询的最佳实践

升级到 MySQL 9.0 后，以下 Eloquent 使用习惯值得关注：

```php
// 1. GROUP BY 查询更严格：确保 SELECT 中的非聚合列都在 GROUP BY 中
// 不推荐（可能在 9.0 中报错）：
Order::selectRaw('user_id, status, COUNT(*) as cnt')->groupBy('user_id')->get();

// 推荐写法：
Order::selectRaw('user_id, status, COUNT(*) as cnt')
    ->groupBy('user_id', 'status')
    ->get();

// 2. 充分利用 Hash Join：对于大数据量的等值连接，可以放心交给优化器
// 9.0 的优化器会自动选择 Hash Join，通常无需使用 hint

// 3. 向量查询的 Laravel 封装
$nearby = DB::table('product_embeddings')
    ->selectRaw('product_id, VECTOR_DIMENSION(embedding) as dims')
    ->whereRaw('VECTOR_DIMENSION(embedding) = ?', [1536])
    ->count();
```

---

## 七、踩坑指南与回滚策略

### 7.1 升级过程中常见的问题

根据实际升级经验，以下是最高频的问题和对应的解决方案：

**认证方式变化**：MySQL 9.0 默认使用 `caching_sha2_password` 认证插件，如果 Laravel 使用的是旧版 `mysql_native_password`，可能导致连接失败。解决方案是更新 `config/database.php` 中的 PDO 连接参数，或者在 MySQL 端为应用用户切换认证插件。

**字符集废弃**：`utf8mb3`（即传统的 `utf8`）在 9.0 中已被标记为废弃，所有表和列应统一使用 `utf8mb4`。升级前务必检查并转换。

**GROUP BY 更严格**：MySQL 9.0 对 `ONLY_FULL_GROUP_BY` 模式的执行更加严格，不再允许 SELECT 中出现未在 GROUP BY 中列出的非聚合列。需要修改相关的 Laravel 查询代码。

**废弃语法移除**：一些在 8.0 中仅标记为 deprecated 的语法在 9.0 中可能被彻底移除，包括 `\N` 字面量的使用、部分空间函数的旧语法等。

### 7.2 完善的回滚策略

无论准备多么充分，都必须为最坏的情况做好回滚准备：

```bash
# 方案一：使用备份恢复（最可靠，适用于任何场景）
mysql -u root -p < backup_before_upgrade_202606011200.sql

# 方案二：主从切换（推荐生产环境使用）
# 步骤一：确保 8.0 从库数据同步完成
# 步骤二：在从库上停止复制：STOP REPLICA;
# 步骤三：将从库提升为新的主库
# 步骤四：更新 Laravel .env 中的 DB_HOST 配置
# 步骤五：重启 Laravel 队列和调度器

# 方案三：Docker 快速回滚（最快速）
docker stop mysql9-container
docker start mysql8-container
# 配合 .env 中的 DB_HOST 切换即可

# 方案四：云服务蓝绿部署回滚
# 大多数云数据库服务支持版本回滚或蓝绿切换
# 在控制台一键操作即可
```

### 7.3 推荐的生产环境升级时间线

一个稳妥的升级计划应该覆盖四周时间：

第一周在开发环境完成升级，进行全量功能测试，修复所有兼容性问题。第二周在测试环境升级，执行压力测试和慢查询基线对比，重点观察 Hash Join 带来的执行计划变化。第三周在预发布环境升级，导入真实流量进行灰度验证。第四周选择业务低峰期（通常是工作日凌晨）在生产环境执行升级，全程保留回滚方案，升级后持续观察 48 小时。

---

## 总结

MySQL 9.0 的升级不仅仅是版本号的变更，更是一次数据库能力的全面提升。不可见索引让我们可以安全地优化索引结构，不再需要"赌运气"式地删除索引。直方图统计让查询优化器真正理解数据分布，自动选择最优执行计划。Hash Join 为复杂多表关联查询带来了数量级的性能提升。而向量搜索能力的原生集成，更是让 Laravel 项目在不引入外部依赖的情况下，具备了基础的 AI 语义搜索能力。

对于 Laravel 项目而言，升级的核心原则是三个词：**充分测试、渐进迁移、保留回滚**。不可见索引和直方图可以在升级前就开始使用，Hash Join 会在升级后自动生效带来性能提升，而向量搜索则需要根据业务需求逐步引入。

技术升级永远不是目的，让技术更好地服务业务才是。按照本文提供的路径和最佳实践，你的团队可以安全、高效地完成 MySQL 9.0 的升级，让 B2C API 服务获得更强劲的数据库性能支撑。祝升级顺利！🚀

---

## 相关阅读

- [MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配](/categories/MySQL/2026-06-02-MySQL-9.x-新特性实战-向量搜索-JSON增强-性能改进与Laravel适配/)
- [PostgreSQL 高级特性实战：窗口函数、CTE、JSONB、pg_trgm 与 Laravel 集成](/categories/MySQL/postgresql-advanced-features-window-cte-jsonb-pgtrgm-laravel/)
- [MySQL 分区表实战：Range、List、Hash 分区策略与 Laravel 月度订单查询路由](/categories/MySQL/2026-06-05-MySQL-分区表实战-Range-List-Hash-Laravel月度订单分区策略与查询路由/)
- [MySQL HeatWave 实战：HTAP 架构与 Laravel 集成](/categories/MySQL/mysql-heatwave-htap-laravel/)
