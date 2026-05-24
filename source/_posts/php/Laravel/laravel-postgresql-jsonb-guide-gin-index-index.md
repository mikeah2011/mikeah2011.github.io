---
title: Laravel + PostgreSQL JSONB 实战：商品筛选的 GIN 索引、局部索引与在线迁移踩坑记录
date: 2026-05-03 09:55:09
updated: 2026-05-03 09:59:00
categories:
  - PHP
  - MySQL
tags: [Laravel, MySQL, PostgreSQL]
description: 结合电商商品筛选场景，记录一套在 Laravel 中落地 PostgreSQL JSONB 的实战方案，重点覆盖动态属性建模、GIN/局部索引、Eloquent 查询封装、在线迁移与真实踩坑。



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

## 四、在线迁移别一把梭，复制延迟会先把你打醒

最早我为了图快，直接把老字段一次性回填到 JSONB，200 多万行更新把只读副本延迟顶到了几十秒。后来改成双写 + 分批回填：先在新代码里同时写普通列和 JSONB，再用 `chunkById` 慢慢补历史数据，最后切读路径。

```php
Product::query()
    ->whereRaw("attributes = '{}'::jsonb")
    ->select(['id', 'legacy_color', 'legacy_storage'])
    ->chunkById(1000, function ($products) {
        foreach ($products as $product) {
            Product::whereKey($product->id)->update([
                'attributes' => [
                    'color' => $product->legacy_color,
                    'storage' => (int) $product->legacy_storage,
                ],
            ]);
        }
    });
```

建索引时也必须用 `CONCURRENTLY`，否则高峰期一次锁表，前台商品列表就会直接超时。

## 五、最后记住这三条踩坑结论

1. **`json` 和 `jsonb` 不要混用**，筛选场景直接上 `jsonb`。  
2. **GIN 不是万能索引**，数值比较和排序依然要表达式索引或普通列。  
3. **数据规范化比 ORM cast 更重要**，写入时不统一类型，后面所有索引优化都会打折。

## 六、索引不是越多越好，要围绕真实筛选面板反推

后来我们专门把后台筛选日志拉出来看，发现 70% 的请求都集中在 `brand`、`color`、`storage`、`price range` 这几组条件上，但工程师最初建的却是一些几乎没人用的 `material`、`origin_country` 索引。PostgreSQL 的好处是表达力够强，坏处是**太容易让人把“可以建索引”误当成“应该建索引”**。

我现在的做法是先按筛选面板拆查询类型：

- 精确匹配：`attributes @> '{"brand":"Apple"}'`
- 多标签包含：`attributes ? 'next_day_delivery'`
- 数值范围：`((attributes->>'storage')::int) >= 256`
- 排序分页：`ORDER BY published_at DESC`

然后只给热门路径建索引。比如活动标签其实更适合单独存 `tags text[]`，而不是继续塞 JSONB，因为 `?`、`?|`、`?&` 这些操作符虽然能用，但维护成本和可读性都更差。**JSONB 能承载变化，不代表所有变化都该扔进去。**

## 七、给 Laravel 查询层加一层规格对象，比堆 Scope 更稳

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

## 八、最容易忽略的生产坑：统计口径和缓存失配

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

## 九、结论

如果你的 Laravel 商品系统已经进入“属性每个月都在改”的阶段，PostgreSQL JSONB 很值得用；但前提不是偷懒，而是愿意把**字段边界、查询模式、索引设计、在线迁移、统计与缓存一致性**一起想清楚。只有这样，它才是工程化手段，不是下一轮技术债。