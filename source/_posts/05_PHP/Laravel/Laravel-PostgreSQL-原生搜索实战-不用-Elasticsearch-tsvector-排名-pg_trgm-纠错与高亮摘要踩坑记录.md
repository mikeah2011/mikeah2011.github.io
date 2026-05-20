---
title: 不用 Elasticsearch：Laravel + PostgreSQL 原生搜索实战，tsvector 排名、pg_trgm 纠错与高亮摘要踩坑记录
date: 2026-05-04 14:59:31
updated: 2026-05-04 15:01:18
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - PostgreSQL
  - Full Text Search
  - tsvector
  - pg_trgm
  - Search
description: 结合 Laravel 商品后台与站内搜索场景，记录一套不用 Elasticsearch、直接基于 PostgreSQL 原生全文检索落地搜索、拼写纠错与高亮摘要的实战方案。
---

很多团队一提到“搜索”就先上 Elasticsearch，我也这么干过。但在一个 Laravel 商品后台里复盘后发现：真实需求只是按标题、SKU、标签搜索，再加错别字兜底；搜索量不高，却要维护同步链路、索引重建、别名切换和补数任务。最后我们把搜索收回 PostgreSQL，事务提交后立即可查，排障链路也短很多。

## 一、什么场景适合 PostgreSQL 原生搜索

这套方案适合：字段集中、QPS 中低、强调事务一致性的站内搜索。我们最后的结构很简单：

```text
┌──────── Client / Admin ────────┐
│ keyword + filters              │
└──────────────┬─────────────────┘
               v
   Laravel ProductSearchService
               │
      ┌────────┴────────┐
      v                 v
 PostgreSQL FTS     pg_trgm 纠错
search_vector+GIN   similarity()
      └────────┬────────┘
               v
          排名 + 高亮摘要
```

主路径走 `tsvector`，没结果时才让 `pg_trgm` 兜底，这样数据库压力比较可控。

## 二、不要在线算 `to_tsvector`

线上最容易踩的坑，是在查询里直接写 `to_tsvector(title || subtitle)`。SQL 虽然能跑，但很难稳定命中索引。更稳的做法是提前存一列 `search_vector`：

```php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        DB::statement("ALTER TABLE products ADD COLUMN search_vector tsvector");
        DB::statement("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        DB::statement("CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector)");
        DB::statement("CREATE INDEX idx_products_title_trgm ON products USING GIN (title gin_trgm_ops)");
    }
};
```

然后用触发器统一维护权重，标题权重高于副标题和标签：

```sql
CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(NEW.subtitle, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(
          ARRAY(SELECT jsonb_array_elements_text(coalesce(NEW.tags, '[]'::jsonb))), ' '
      ), '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
```

这个权重非常关键。我们一开始把长描述也放高权重，结果标题精准命中的商品反而排不到前面，后来只保留标题和副标题高权重，排序才稳定。

## 三、Laravel 查询拆成两段

主搜索先走全文检索，查不到结果再走 trigram 相似度：

```php
final class ProductSearchService
{
    public function search(string $keyword, ?int $categoryId = null)
    {
        $base = Product::query()
            ->where('status', 'published')
            ->when($categoryId, fn ($q) => $q->where('category_id', $categoryId));

        $items = (clone $base)
            ->selectRaw("id, title, ts_rank_cd(search_vector, plainto_tsquery('simple', ?)) as rank", [$keyword])
            ->selectRaw("ts_headline('simple', coalesce(subtitle, title), plainto_tsquery('simple', ?), 'StartSel=<mark>, StopSel=</mark>') as snippet", [$keyword])
            ->whereRaw("search_vector @@ plainto_tsquery('simple', ?)", [$keyword])
            ->orderByDesc('rank')
            ->limit(20)
            ->get();

        if ($items->isNotEmpty()) {
            return $items;
        }

        return (clone $base)
            ->selectRaw('id, title, similarity(title, ?) as score', [$keyword])
            ->whereRaw('char_length(?) >= 3', [$keyword])
            ->whereRaw('title % ?', [$keyword])
            ->orderByDesc('score')
            ->limit(10)
            ->get();
    }
}
```

这里最有效的优化不是 `ts_rank_cd`，而是**先过滤业务条件，再做全文排名**。像 `status=published`、`category_id` 这类条件能明显缩小候选集。

## 四、踩坑记录

### 1. 把 `pg_trgm` 当主查询

短词搜索时，`similarity()` 很容易把 CPU 拉高。后来我们规定：只有全文检索无结果时才走 trigram，而且关键字长度至少 3。

### 2. 直接拿长详情做 `ts_headline`

一开始我把商品详情整段做高亮，列表接口耗时抖得很厉害。后来只对副标题做摘要，详情页需要全文高亮时单独处理。

### 3. 全表回填 `search_vector`

新增字段后如果直接全表 `UPDATE`，WAL 和 I/O 都会被打爆。我们最后按主键分批回填，每批 5000 行，低峰跑完后再挂触发器。

## 五、什么时候我还是会选 Elasticsearch

如果需求变成跨商品、店铺、内容统一检索，或者要复杂同义词、拼音、聚合分析，我还是会直接上 ES。但对很多 Laravel 中后台来说，`tsvector + GIN + pg_trgm` 已经能解决大部分站内搜索问题。

这套方案最大的价值，不是功能更强，而是**一致性自然、维护成本低、慢查询更容易定位**。只要把索引、权重、过滤顺序和兜底策略设计清楚，PostgreSQL 原生搜索在中等规模业务里完全够用。
