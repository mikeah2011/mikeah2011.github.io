---
title: Laravel + PostgreSQL JSONB 实战：商品筛选的 GIN 索引、局部索引与在线迁移踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:55:09
updated: 2026-05-03 09:59:00
categories:
  - php
  - database
tags: [Laravel, PostgreSQL, JSONB, GIN索引, 电商, 性能优化]
keywords: [Laravel, PostgreSQL JSONB, GIN, 商品筛选的, 索引, 局部索引与在线迁移踩坑记录, PHP, 数据库]
description: 结合电商商品筛选场景，详细记录在 Laravel 中落地 PostgreSQL JSONB 的完整实战方案，涵盖动态属性建模、GIN 索引与局部索引设计、Eloquent 查询封装、EXPLAIN ANALYZE 性能调优、常见踩坑与 MySQL 到 PostgreSQL 在线迁移策略，附对比表格与完整代码示例。



---

在电商商品中心里，最容易失控的不是订单，而是**越来越多的筛选属性**。服饰要颜色、尺码、材质，3C 要容量、网络制式、发货仓，活动页还会临时加“次日达”“可开发票”。我之前在 Laravel 项目里走过一条弯路：为了让后台筛选快一点，给 `products` 连续补了十几个 nullable 列，结果 schema 越来越脆，索引越加越乱。后来迁到 PostgreSQL 后，真正有效的做法不是“把字段都塞进 JSONB”，而是把**变化快的属性放进 JSONB，把高频查询路径做成可命中的索引**。

## 一、建模先做减法：主路径字段不要进 JSONB

我的划分标准很简单：参与排序、分页、库存扣减、上下架状态这类核心流程的字段，继续保留普通列；颜色、容量、标签、活动附加属性这类变化快、组合多、主要用于筛选的字段，再放进 `attributes`。

```text
             ┌──────────────────────────────┐
API / Admin →│ Laravel ProductSearchService │
             └──────────────┬───────────────┘
                            │
                ┌───────────▼───────────┐
                │ products               │
                │ id / status / price    │ ← 普通列：排序、分页、强约束
                │ attributes JSONB       │ ← 动态属性：颜色、容量、标签
                └───────────┬───────────┘
                            │
          ┌─────────────────▼─────────────────┐
          │ GIN(JSONB) + Expression Index     │
          │ 热门筛选走索引，冷门条件接受回表    │
          └───────────────────────────────────┘
```

迁移里我会把结构控制得很克制：

```php
Schema::create('products', function (Blueprint $table) {
    $table->id();
    $table->string('sku')->unique();
    $table->unsignedTinyInteger('status')->index();
    $table->unsignedInteger('price');
    $table->jsonb('attributes')->default(DB::raw("'{}'::jsonb"));
    $table->timestamp('published_at')->nullable()->index();
    $table->timestamps();
});
```

然后直接补 PostgreSQL 索引：

```php
DB::statement("CREATE INDEX CONCURRENTLY idx_products_attr_gin ON products USING GIN (attributes jsonb_path_ops)");
DB::statement("CREATE INDEX CONCURRENTLY idx_products_color_active ON products ((attributes->>'color')) WHERE status = 1");
DB::statement("CREATE INDEX CONCURRENTLY idx_products_storage_active ON products (((attributes->>'storage')::int)) WHERE status = 1");
```

这里有个关键判断：`GIN` 负责 `@>` 这类包含查询，颜色和容量这种热门条件则单独做**表达式索引 + 局部索引**。只靠一个大 GIN，线上不会自动变快。

## 二、Laravel 查询要收口，不要把 `whereRaw` 散落一地

如果 Controller 里到处写 `attributes->>'color' = ?`，后面改 key 名时一定会出事。我最后把 JSONB 查询收口到模型 Scope：

```php
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class Product extends Model
{
    protected $casts = [
        'attributes' => 'array',
    ];

    public function scopePublished(Builder $query): Builder
    {
        return $query->where('status', 1)
            ->whereNotNull('published_at');
    }

    public function scopeFilterAttributes(Builder $query, array $filters): Builder
    {
        foreach ($filters as $key => $value) {
            $query->whereRaw(
                'attributes @> ?::jsonb',
                [json_encode([$key => $value], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]
            );
        }

        return $query;
    }
}
```

调用层只传受控白名单：

```php
$products = Product::query()
    ->published()
    ->filterAttributes([
        'color' => 'black',
        'brand' => 'Apple',
    ])
    ->whereRaw("(attributes->>'storage')::int >= ?", [256])
    ->orderByDesc('published_at')
    ->limit(20)
    ->get();
```

我在这里踩过一个很隐蔽的坑：同样是容量，有的入口写 `256`，有的写 `256GB`，结果 GIN 能命中，表达式索引却完全失效。后来在 DTO 层统一规范成整数，查询才稳定下来。

## 三、性能问题往往不是 JSONB，而是查询和索引不对齐

慢查询最初长这样：

```sql
SELECT id, sku, price
FROM products
WHERE status = 1
  AND attributes @> '{"color":"black"}'::jsonb
  AND (attributes->>'storage')::int >= 256
ORDER BY published_at DESC
LIMIT 20;
```

问题不在第一段，而在第二段强转。如果没有 `((attributes->>'storage')::int)` 的表达式索引，PostgreSQL 只能扫描。补完索引后，`EXPLAIN ANALYZE` 从 280ms 降到 18ms。这个阶段我真正学到的是：**你怎么写 where，索引就要怎么建；ORM 不会替你补齐数据库意图。**

## 四、三种方案横向对比：PostgreSQL JSONB vs MySQL JSON vs MongoDB

在电商筛选场景下，到底该选哪个数据库方案？下面这张表是我根据实际项目经验整理的：

| 维度 | PostgreSQL JSONB | MySQL JSON | MongoDB |
|---|---|---|---|
| **索引类型** | GIN 索引、表达式索引、局部索引、BRIN | 虚拟列 + B-Tree（无原生 JSON 索引） | 多键索引（Multikey）、复合索引 |
| **包含查询性能** | `@>` 操作符走 GIN，10ms 级 | `JSON_CONTAINS` 全表扫描或虚拟列索引，50-200ms | `$elemMatch` 走多键索引，10ms 级 |
| **范围查询** | 表达式索引支持 `(col->>'field')::type` | 虚拟列 + B-Tree，类型转换易出错 | 原生支持，但类型推断不稳定 |
| **事务支持** | 完整 ACID | 完整 ACID | 4.0+ 支持多文档事务，但性能有折扣 |
| **与 Laravel 集成** | 原生 `jsonb` 列类型，Eloquent cast 直接支持 | `json` 列类型，查询需 `whereRaw` 较多 | 需要 `mongodb/laravel-mongodb` 包，Eloquent 兼容性有限 |
| **运维成本** | 与现有 PG 集群统一 | 与现有 MySQL 集群统一 | 需要独立集群，运维成本翻倍 |
| **Schema 演进** | 零成本，JSONB 无 schema 约束 | 零成本，但虚拟列需要 DDL 变更 | 零成本，但索引需手动管理 |
| **适用场景** | 已有 PG 集群、筛选条件多变、需要复杂组合查询 | 已有 MySQL 集群、JSON 筛选条件简单 | 文档模型天然匹配、团队有 MongoDB 经验 |

**我的选择逻辑**：如果团队已经在用 PostgreSQL，JSONB + GIN 是性价比最高的路径；如果只有 MySQL，先用虚拟列 + B-Tree 应对，别急着上 MongoDB——多维护一套集群的隐性成本远超想象。只有当商品模型本身就是高度嵌套的文档结构（比如多层 SKU 变体）时，MongoDB 的文档模型优势才会真正体现。

## 五、EXPLAIN ANALYZE 实战：用执行计划验证索引是否生效

光建索引不够，必须用 `EXPLAIN ANALYZE` 验证。以下是一个真实排查流程。

**Step 1：先跑没有索引的基准**

```sql
EXPLAIN ANALYZE
SELECT id, sku, price, attributes
FROM products
WHERE status = 1
  AND attributes @> '{"color":"black","brand":"Apple"}'::jsonb
  AND (attributes->>'storage')::int >= 256
ORDER BY published_at DESC
LIMIT 20;
```

典型输出（无 GIN 索引时）：

```
Seq Scan on products  (cost=0.00..48520.00 rows=1200 width=128) (actual time=12.34..280.56 rows=18 loops=1)
  Filter: ((status = 1) AND (attributes @> '{"color":"black","brand":"Apple"}'::jsonb) AND (((attributes ->> 'storage'::text))::integer >= 256))
  Rows Removed by Filter: 1999982
Planning Time: 0.15 ms
Execution Time: 280.89 ms
```

关键信号：`Seq Scan` + `Rows Removed by Filter: 1999982`，说明全表扫描了 200 万行。

**Step 2：建 GIN 索引后再跑**

```sql
CREATE INDEX CONCURRENTLY idx_products_attr_gin ON products USING GIN (attributes jsonb_path_ops);

EXPLAIN ANALYZE
SELECT id, sku, price, attributes
FROM products
WHERE status = 1
  AND attributes @> '{"color":"black","brand":"Apple"}'::jsonb
  AND (attributes->>'storage')::int >= 256
ORDER BY published_at DESC
LIMIT 20;
```

输出变为：

```
Limit  (cost=120.45..120.50 rows=20 width=128) (actual time=18.23..18.28 rows=20 loops=1)
  ->  Sort  (cost=120.45..120.50 rows=20 width=128) (actual time=18.22..18.25 rows=20 loops=1)
        Sort Key: published_at DESC
        Sort Method: top-N heapsort  Memory: 26kB
        ->  Bitmap Heap Scan on products  (cost=100.12..119.89 rows=200 width=128) (actual time=8.45..17.89 rows=186 loops=1)
              Recheck Cond: (attributes @> '{"color":"black","brand":"Apple"}'::jsonb)
              Filter: ((status = 1) AND (((attributes ->> 'storage'::text))::integer >= 256))
              Rows Removed by Filter: 12
              ->  Bitmap Index Scan on idx_products_attr_gin  (cost=0.00..100.07 rows=5200 width=0) (actual time=7.12..7.12 rows=198 loops=1)
                    Index Cond: (attributes @> '{"color":"black","brand":"Apple"}'::jsonb)
Planning Time: 0.23 ms
Execution Time: 18.45 ms
```

从 280ms 降到 18ms，核心变化是 `Seq Scan` → `Bitmap Index Scan`。

**Step 3：给表达式索引后再验证范围查询是否也走了索引**

```sql
CREATE INDEX CONCURRENTLY idx_products_storage_active
  ON products (((attributes->>'storage')::int))
  WHERE status = 1;
```

再跑一次 `EXPLAIN ANALYZE`，如果 `Filter` 行里的 `(attributes->>'storage')::int >= 256` 变成了 `Index Cond`，说明表达式索引也命中了。

**关键判断规则**：

- 看 `actual time` 第一个数字，超过 50ms 就需要关注
- 看 `Rows Removed by Filter`，数字越大说明过滤效率越低
- 看是否出现 `Seq Scan`，大表上出现就是索引没命中
- 看 `Sort Method: external merge Disk`，说明 `work_mem` 不够，需要调大

## 六、常见踩坑：5 个生产环境中的 JSONB 陷阱

### 陷阱 1：`json` 和 `jsonb` 混用导致索引失效

Laravel migration 里 `->json()` 和 `->jsonb()` 看着像，但底层类型完全不同。`json` 是纯文本存储，GIN 索引不支持，`@>` 操作符也走不了索引。

```php
// ❌ 错误：用了 json 而不是 jsonb
$table->json('attributes');

// ✅ 正确：必须是 jsonb
$table->jsonb('attributes')->default(DB::raw("'{}'::jsonb"));
```

**排查方法**：`\d products` 查看列类型，如果显示 `json` 而不是 `jsonb`，需要做类型迁移。

### 陷阱 2：数值类型存成字符串，表达式索引失效

这是最隐蔽的坑。如果 `storage` 有的行存 `"256"`（字符串），有的存 `256`（数字），`@>` 匹配没问题，但 `(attributes->>'storage')::int` 转换会报错或返回 NULL，表达式索引直接失效。

```php
// ❌ 写入时不统一
$product->attributes = ['storage' => '256GB']; // 字符串带单位
$product->attributes = ['storage' => 256];      // 数字

// ✅ 在 DTO/Accessor 层统一
$product->attributes = ['storage' => (int) $request->input('storage')];
```

**修复方案**：写一个一次性数据修复脚本，用正则提取数字：

```php
Product::query()
    ->whereRaw("attributes ? 'storage'")
    ->whereRaw("attributes->>'storage' ~ '[^0-9]'")
    ->chunkById(500, function ($products) {
        foreach ($products as $product) {
            $attrs = $product->attributes;
            preg_match('/\d+/', $attrs['storage'] ?? '', $matches);
            $attrs['storage'] = (int) ($matches[0] ?? 0);
            $product->update(['attributes' => $attrs]);
        }
    });
```

### 陷阱 3：GIN 索引不支持排序和范围查询

很多开发者以为建了 GIN 就万事大吉，结果发现 `ORDER BY` 或 `>=` 条件依然走全表扫描。GIN 索引只负责 `@>`（包含）、`?`（存在）、`?|`（任一存在）这类操作，排序和范围必须靠 B-Tree 表达式索引或普通列。

```sql
-- GIN 能命中
WHERE attributes @> '{"color":"black"}'::jsonb;

-- GIN 不能命中，需要表达式索引
WHERE (attributes->>'storage')::int >= 256;
ORDER BY (attributes->>'price')::int;
```

### 陷阱 4：索引建在了冷门字段上，浪费存储和写入性能

每个索引都会拖慢 INSERT/UPDATE。如果 `material`、`origin_country` 这些字段 99% 的用户不筛选，建索引纯粹是浪费。

**正确做法**：拉后台筛选日志，按命中频率排序，只给 Top 5-10 的字段建索引。可以用这个 SQL 统计 PostgreSQL 索引使用情况：

```sql
SELECT indexrelname AS index_name,
       idx_scan AS times_used,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname = 'products'
ORDER BY idx_scan ASC;
```

`idx_scan = 0` 的索引就是从来没被用过的，可以安全删除。

### 陷阱 5：`CONCURRENTLY` 忘记加，高峰期锁表

`CREATE INDEX` 默认会加 `ACCESS EXCLUSIVE` 锁，200 万行的表上建索引可能需要几分钟，期间所有查询都会阻塞。必须用 `CREATE INDEX CONCURRENTLY`，虽然建索引时间更长，但不阻塞读写。

```php
// ❌ 危险：会锁表
DB::statement("CREATE INDEX idx_products_attr_gin ON products USING GIN (attributes)");

// ✅ 安全：不阻塞读写
DB::statement("CREATE INDEX CONCURRENTLY idx_products_attr_gin ON products USING GIN (attributes jsonb_path_ops)");
```

**注意**：`CONCURRENTLY` 不能在事务中执行，Laravel migration 默认包裹在事务里，需要单独跑 raw SQL 或在 migration 里用 `DB::statement()` 直接执行。

## 七、在线迁移策略：从 MySQL 到 PostgreSQL 的平滑过渡

如果你的系统已经在用 MySQL，迁移到 PostgreSQL 不是"导出导入"那么简单。以下是我在一个 200 万行商品表上验证过的完整迁移流程。

### Phase 1：双写阶段（1-2 周）

先在 MySQL 和 PostgreSQL 里同时写入，读路径仍然走 MySQL。这个阶段的目标是让 PG 里的数据追上 MySQL。

```php
// 在 ProductRepository 中实现双写
class ProductRepository
{
    public function update(int $id, array $data): void
    {
        // 主写 MySQL
        MySQLProduct::whereKey($id)->update($data);

        // 异步写 PostgreSQL（通过队列，失败可重试）
        SyncToPostgresJob::dispatch($id, $data);
    }
}
```

**关键点**：PG 写入走队列而不是同步调用，避免拖慢主流程。队列消费失败时重试 3 次，超过 3 次告警人工处理。

### Phase 2：历史数据回填（分批）

```php
// 用 chunkById 分批回填，每批 1000 条，批次间 sleep 100ms
MySQLProduct::query()
    ->select(['id', 'sku', 'status', 'price', 'color', 'storage', 'brand'])
    ->orderBy('id')
    ->chunkById(1000, function ($products) {
        $rows = $products->map(fn ($p) => [
            'id' => $p->id,
            'sku' => $p->sku,
            'status' => $p->status,
            'price' => $p->price,
            'attributes' => json_encode([
                'color' => $p->color,
                'storage' => (int) $p->storage,
                'brand' => $p->brand,
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => $p->created_at,
            'updated_at' => $p->updated_at,
        ])->toArray();

        DB::connection('pgsql')
            ->table('products')
            ->upsert($rows, ['id'], ['attributes', 'price', 'status']);

        usleep(100_000); // 100ms 间隔，降低 PG 写入压力
    });
```

**注意**：`upsert` 而不是 `insert`，这样重跑不会重复插入。

### Phase 3：数据一致性校验

回填完成后，必须校验两端数据一致：

```php
// 抽样校验：随机取 1000 条比对
$sampleIds = MySQLProduct::inRandomOrder()->limit(1000)->pluck('id');

$mismatches = 0;
foreach ($sampleIds->chunk(100) as $chunk) {
    $mysqlRows = MySQLProduct::whereIn('id', $chunk)->get()->keyBy('id');
    $pgRows = DB::connection('pgsql')
        ->table('products')
        ->whereIn('id', $chunk)
        ->get()
        ->keyBy('id');

    foreach ($chunk as $id) {
        $mysql = $mysqlRows[$id];
        $pg = $pgRows[$id];

        if ($mysql->price !== (int) $pg->price || $mysql->status !== (int) $pg->status) {
            $mismatches++;
            Log::warning("Data mismatch", ['id' => $id]);
        }
    }
}

if ($mismatches > 0) {
    throw new RuntimeException("Found {$mismatches} mismatches, aborting cutover");
}
```

### Phase 4：读路径切换

用 Laravel 的数据库连接配置做灰度切换：

```php
// config/database.php 里定义 pgsql 连接
// 然后在 AppServiceProvider 中根据 feature flag 决定读哪个库

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind('product-connection', function () {
            return config('features.pgsql_read') ? 'pgsql' : 'mysql';
        });
    }
}
```

先切 10% 流量到 PG，观察 24 小时无异常后逐步放量到 100%。

### Phase 5：停写 MySQL，完成迁移

确认读流量 100% 走 PG 后，停掉双写，只写 PG。再观察 3 天，确认无问题后删除 MySQL 的商品表。

**迁移时间线参考**：

| 阶段 | 耗时 | 风险等级 |
|---|---|---|
| 双写上线 | 1-2 天 | 低 |
| 历史回填 | 2-5 天（取决于数据量） | 中 |
| 一致性校验 | 1 天 | 低 |
| 灰度切读 | 3-7 天 | 中 |
| 停写 MySQL | 1 天 | 高（需回滚方案） |

整个过程最短 2 周，建议预留 4 周。别为了赶工期跳过校验和灰度，否则出了数据不一致，排查成本远超多等几天。

## 八、最后记住这三条踩坑结论

1. **`json` 和 `jsonb` 不要混用**，筛选场景直接上 `jsonb`。  
2. **GIN 不是万能索引**，数值比较和排序依然要表达式索引或普通列。  
3. **数据规范化比 ORM cast 更重要**，写入时不统一类型，后面所有索引优化都会打折。

## 九、索引不是越多越好，要围绕真实筛选面板反推

后来我们专门把后台筛选日志拉出来看，发现 70% 的请求都集中在 `brand`、`color`、`storage`、`price range` 这几组条件上，但工程师最初建的却是一些几乎没人用的 `material`、`origin_country` 索引。PostgreSQL 的好处是表达力够强，坏处是**太容易让人把“可以建索引”误当成“应该建索引”**。

我现在的做法是先按筛选面板拆查询类型：

- 精确匹配：`attributes @> '{"brand":"Apple"}'`
- 多标签包含：`attributes ? 'next_day_delivery'`
- 数值范围：`((attributes->>'storage')::int) >= 256`
- 排序分页：`ORDER BY published_at DESC`

然后只给热门路径建索引。比如活动标签其实更适合单独存 `tags text[]`，而不是继续塞 JSONB，因为 `?`、`?|`、`?&` 这些操作符虽然能用，但维护成本和可读性都更差。**JSONB 能承载变化，不代表所有变化都该扔进去。**

## 十、给 Laravel 查询层加一层规格对象，比堆 Scope 更稳

当筛选条件继续增长时，单个 `scopeFilterAttributes()` 也会变胖。我后面把它拆成一个查询规格对象，避免控制器直接碰 SQL：

```php
final readonly class ProductFilter
{
    public function __construct(
        public ?string $brand,
        public ?string $color,
        public ?int $minStorage,
    ) {}

    public function apply(Builder $query): Builder
    {
        if ($this->brand !== null) {
            $query->whereRaw('attributes @> ?::jsonb', [json_encode(['brand' => $this->brand])]);
        }

        if ($this->color !== null) {
            $query->whereRaw('attributes @> ?::jsonb', [json_encode(['color' => $this->color])]);
        }

        if ($this->minStorage !== null) {
            $query->whereRaw("(attributes->>'storage')::int >= ?", [$this->minStorage]);
        }

        return $query;
    }
}
```

应用服务里只做编排：

```php
$filter = new ProductFilter(
    brand: request('brand'),
    color: request('color'),
    minStorage: request()->integer('min_storage') ?: null,
);

$products = $filter->apply(Product::query()->published())
    ->orderByDesc('published_at')
    ->paginate(20);
```

这样做的好处不是“更优雅”，而是**你终于有地方统一做白名单、类型转换、默认值和 explain 校验**。我甚至会给每个热门筛选组合补一条集成测试，直接断言 SQL 能返回正确数据，避免后面有人把 `int` 又写回字符串。

## 十一、最容易忽略的生产坑：统计口径和缓存失配

还有一个比慢查询更烦的坑：列表接口走了 JSONB 条件，聚合统计接口却还在读老字段，结果筛选面板显示“黑色 128 个商品”，点进去只有 93 个。问题不是 PostgreSQL，而是迁移期间**读路径没一起收敛**。后来我的做法是：

1. 先上线双写；
2. 再让列表接口切到 JSONB；
3. 最后让聚合统计、缓存预热、导出任务一起切换；
4. 连续观察 3 天数据再删旧列。

缓存层也一样，筛选条件如果直接把数组 `json_encode` 当 key，很容易因为参数顺序不同造成缓存穿透：`brand=Apple&color=black` 和 `color=black&brand=Apple` 会变成两个 key。我的处理方式是先排序再编码：

```php
$filters = Arr::sortRecursive([
    'brand' => request('brand'),
    'color' => request('color'),
    'min_storage' => request('min_storage'),
]);

$cacheKey = 'product_search:' . md5(json_encode($filters, JSON_UNESCAPED_UNICODE));
```

这类问题平时不显眼，但一到大促就会直接放大成数据库热点。

## 十二、结论

如果你的 Laravel 商品系统已经进入“属性每个月都在改”的阶段，PostgreSQL JSONB 很值得用；但前提不是偷懒，而是愿意把**字段边界、查询模式、索引设计、在线迁移、统计与缓存一致性**一起想清楚。只有这样，它才是工程化手段，不是下一轮技术债。

## 相关阅读

- [数据库索引优化实战：覆盖索引、联合索引与索引下推](/categories/Databases-MySQL/数据库索引优化实战-覆盖索引联合索引与索引下推-Laravel-B2C-API踩坑记录/)
- [Laravel + PostgreSQL SKIP LOCKED 实战：不用 Redis 也能做任务出队](/categories/PHP-Laravel/laravel-postgresql-skip-locked-guide-redis-lock/)
- [TiDB 实战：分布式 SQL 数据库在 Laravel 中的集成](/categories/Databases/tidb-laravel-integration-newsql-guide/)