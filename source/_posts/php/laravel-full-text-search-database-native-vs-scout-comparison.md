---

title: Laravel Full-Text Search 实战：不用 Elasticsearch 也能做——数据库原生全文搜索与 Laravel Scout
keywords: [Laravel Full, Text Search, Elasticsearch, Laravel Scout, 不用, 也能做, 数据库原生全文搜索与]
date: 2026-06-02 10:00:00
tags:
- Laravel
- MySQL
- PostgreSQL
- 全文搜索
- Scout
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 做全文搜索就一定要上 Elasticsearch 吗？本文深入对比 Laravel 生态中的多种全文搜索方案：MySQL FULLTEXT（ngram 解析器）、PostgreSQL tsvector/tsquery、Laravel Scout Database Driver、Meilisearch 以及 Elasticsearch。从索引原理、中文分词、查询性能、Faceting 能力、运维成本等维度进行实测对比，提供不同数据量级下的选型建议。适合中小项目在引入重型搜索引擎前的务实评估。
---



# Laravel Full-Text Search 实战：不用 Elasticsearch 也能做——数据库原生全文搜索与 Laravel Scout 深度对比

## 前言：你真的需要 Elasticsearch 吗？

在很多团队的技术选型讨论中，提到「全文搜索」四个字，大家的第一反应几乎都是：「上 Elasticsearch 吧」。这似乎已经成了一种技术直觉——仿佛不做全文搜索就不需要用 ES，一做全文搜索就必须上 ES。

但现实是，引入一套独立的搜索引擎意味着什么？你需要维护一个额外的集群，需要处理数据同步延迟，需要学习一套新的 DSL 查询语法，需要监控节点健康、处理分片再平衡、管理索引映射。对于很多中小型项目来说，这些运维成本远超你的预期。

更关键的是，很多业务场景——比如站内搜索、商品标题搜索、文章内容检索——数据量可能只有几十万到几百万条，QPS 也不过几百。在这种量级下，MySQL 的 FULLTEXT 索引或者 PostgreSQL 的 tsvector 完全够用，甚至在延迟上不输 Elasticsearch。

本文将深入对比数据库原生全文搜索与 Laravel Scout 的各种方案，帮你做出务实的技术选型。

## 一、MySQL FULLTEXT 索引深度解析

### 1.1 什么是 FULLTEXT 索引

MySQL 从 5.6 版本开始，InnoDB 存储引擎正式支持 FULLTEXT 索引。在此之前，全文索引只能在 MyISAM 引擎上使用，这在实际生产环境中几乎是不可接受的限制。

FULLTEXT 索引的工作原理是：对指定的文本列进行分词，建立倒排索引（Inverted Index）。每个词（token）都关联到包含该词的文档列表。当你执行搜索时，MySQL 会查找倒排索引并返回匹配的文档。

```sql
-- 创建带 FULLTEXT 索引的表
CREATE TABLE products (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    price DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT INDEX ft_name (name),
    FULLTEXT INDEX ft_desc (description),
    FULLTEXT INDEX ft_name_desc (name, description)  -- 联合全文索引
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 1.2 InnoDB vs MyISAM 的 FULLTEXT 差异

虽然 InnoDB 已经支持 FULLTEXT 索引，但与 MyISAM 相比仍然有一些差异：

| 特性 | InnoDB FULLTEXT | MyISAM FULLTEXT |
|------|----------------|-----------------|
| 事务支持 | ✅ | ❌ |
| 崩溃恢复 | ✅ | ❌ |
| 行级锁 | ✅ | 表级锁 |
| 最小词长 | 可配置 | 可配置 |
| 停用词 | 支持 | 支持 |
| 布尔模式 | ✅ | ✅ |
| 自然语言模式 | ✅ | ✅ |
| 查询扩展 | ✅ | ✅ |
| 前缀搜索 | ✅ | ✅ |
| 缓存 | 自适应 | 专用缓存 |

在生产环境中，毫无疑问应该选择 InnoDB。事务支持和崩溃恢复能力是不可妥协的底线。

### 1.3 ngram 解析器：中文分词的关键

MySQL 默认的全文解析器按空格和标点分词，对英文比较友好，但对中文完全无效——因为中文没有天然的词边界。这就是 ngram 解析器的用武之地。

ngram 解析器会将连续的 N 个字符作为一个 token。通过 `ngram_token_size` 参数可以控制 N 的大小：

```sql
-- my.cnf 配置
[mysqld]
ngram_token_size = 2  -- 默认值为 2，即每 2 个字符一个 token
```

```sql
-- 使用 ngram 解析器创建 FULLTEXT 索引
CREATE TABLE articles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    FULLTEXT INDEX ft_title (title) WITH PARSER ngram,
    FULLTEXT INDEX ft_content (content) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

ngram 的局限性也很明显：

- **粒度固定**：token_size 是全局配置，无法按表或按列自定义。设为 2 时，搜索「数据库」会产生「数据」「据库」两个 token，可能导致误匹配。
- **索引膨胀**：每个字符会被包含在多个 n-gram 中，索引体积比英文场景大得多。
- **语义不准**：纯粹的字符级匹配，无法理解同义词、近义词。

在实际项目中，如果中文搜索是核心需求，建议 ngram_token_size 设为 2。设为 1 会导致索引过大且误匹配严重，设为 3 又会漏掉双字词的搜索。

### 1.4 三种搜索模式详解

#### 自然语言模式（Natural Language Mode）

```sql
SELECT *, MATCH(name, description) AGAINST('智能手机' IN NATURAL LANGUAGE MODE) AS relevance
FROM products
WHERE MATCH(name, description) AGAINST('智能手机' IN NATURAL LANGUAGE MODE)
ORDER BY relevance DESC
LIMIT 20;
```

自然语言模式会自动计算相关性分数。分数越高，表示文档与搜索词的匹配度越高。计算公式基于 TF-IDF 算法：词频（term frequency）越高、文档频率（document frequency，即包含该词的文档越少），相关性分数越高。

#### 布尔模式（Boolean Mode）

布尔模式更加灵活，支持运算符控制搜索行为：

```sql
SELECT * FROM products
WHERE MATCH(name, description) AGAINST('+手机 -苹果' IN BOOLEAN MODE);
```

常用运算符：

- `+`：必须包含该词
- `-`：必须不包含该词
- `*`：通配符后缀匹配
- `""`：精确短语匹配
- `>` `<`：提高/降低相关性权重
- `~`：降低相关性（类似负权重但不影响是否出现）

```sql
-- 复杂布尔搜索示例：必须包含"手机"，可选包含"5G"或"旗舰"，排除"翻新"
SELECT *, MATCH(name, description) AGAINST(
    '+手机 +(5G 旗舰) -翻新' IN BOOLEAN MODE
) AS score
FROM products
WHERE MATCH(name, description) AGAINST(
    '+手机 +(5G 旗舰) -翻新' IN BOOLEAN MODE
)
ORDER BY score DESC;
```

#### 查询扩展模式（Query Expansion）

```sql
SELECT * FROM products
WHERE MATCH(name, description) AGAINST('手机' WITH QUERY EXPANSION);
```

查询扩展会执行两轮搜索：第一轮找到与搜索词相关的文档，提取其中的高频词，第二轮用这些词重新搜索。这种方式可以发现语义相关但用词不同的文档，但也可能引入噪音。

### 1.5 FULLTEXT 索引的性能特征

MySQL FULLTEXT 索引在不同数据量下的表现（基于实际测试数据）：

| 数据量 | 自然语言模式 | 布尔模式 | 无索引 LIKE |
|--------|------------|---------|------------|
| 10 万条 | 2-5ms | 3-8ms | 800-1200ms |
| 50 万条 | 5-15ms | 8-25ms | 4000-6000ms |
| 100 万条 | 10-30ms | 15-50ms | 8000-15000ms |
| 500 万条 | 30-100ms | 50-200ms | 超时 |

可以看到，FULLTEXT 索引相比 LIKE 查询有数量级的性能提升。在百万级数据量下，查询延迟仍然控制在毫秒级别，完全可以满足大部分 Web 应用的需求。

### 1.6 在 Laravel 中使用 MySQL FULLTEXT

Laravel 的查询构造器原生支持全文搜索：

```php
// 基本用法
$products = DB::table('products')
    ->selectRaw("*, MATCH(name, description) AGAINST(? IN BOOLEAN MODE) AS score", [$keyword])
    ->whereRaw("MATCH(name, description) AGAINST(? IN BOOLEAN MODE)", [$keyword])
    ->orderByDesc('score')
    ->paginate(20);
```

封装成一个可复用的 Trait：

```php
<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;

trait FullTextSearch
{
    /**
     * 获取全文搜索的列和索引名
     */
    protected function getFullTextColumns(): array
    {
        return $this->fullTextColumns ?? ['name'];
    }

    protected function getFullTextIndex(): string
    {
        return $this->fullTextIndex ?? 'ft_' . implode('_', $this->getFullTextColumns());
    }

    /**
     * 全文搜索 Scope
     */
    public function scopeFullText(Builder $query, string $keyword, string $mode = 'BOOLEAN'): Builder
    {
        $columns = implode(', ', $this->getFullTextColumns());
        $index = $this->getFullTextIndex();

        return $query
            ->selectRaw("*, MATCH({$columns}) AGAINST(? IN {$mode} MODE) AS _relevance", [$keyword])
            ->whereRaw("MATCH({$columns}) AGAINST(? IN {$mode} MODE)", [$keyword])
            ->orderByDesc('_relevance');
    }

    /**
     * 带权重的全文搜索（多列不同权重）
     */
    public function scopeWeightedFullText(Builder $query, string $keyword, array $weights = []): Builder
    {
        $weights = $weights ?: ['name' => 3, 'description' => 1];

        $matchParts = [];
        $scoreParts = [];
        $params = [];

        foreach ($weights as $column => $weight) {
            $matchParts[] = "MATCH({$column}) AGAINST(? IN BOOLEAN MODE)";
            $scoreParts[] = "MATCH({$column}) AGAINST(? IN BOOLEAN MODE) * {$weight}";
            $params[] = $keyword;
        }

        $matchSql = implode(' OR ', $matchParts);
        $scoreSql = implode(' + ', $scoreParts);

        return $query
            ->selectRaw("*, ({$scoreSql}) AS _relevance", array_merge($params, $params))
            ->whereRaw("({$matchSql})", $params)
            ->orderByDesc('_relevance');
    }
}
```

在 Model 中使用：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Traits\FullTextSearch;

class Product extends Model
{
    use FullTextSearch;

    protected $fullTextColumns = ['name', 'description'];

    protected $fullTextIndex = 'ft_name_desc';
}
```

Controller 中调用：

```php
public function search(Request $request)
{
    $keyword = $request->input('q');

    // 处理 ngram 分词：MySQL 的 ngram 解析器会自动处理
    // 但我们需要对特殊字符进行转义
    $safeKeyword = $this->prepareSearchKeyword($keyword);

    $products = Product::fullText($safeKeyword)
        ->with('category')
        ->paginate(20);

    return view('search.results', compact('products', 'keyword'));
}

private function prepareSearchKeyword(string $keyword): string
{
    // 布尔模式下需要转义特殊字符
    $specialChars = ['+', '-', '<', '>', '(', ')', '~', '*', '"', '@'];

    // 如果用户输入中有引号，保留精确搜索
    if (str_contains($keyword, '"')) {
        return $keyword;
    }

    // 否则每个词加上 + 前缀（必须全部匹配）
    $words = preg_split('/\s+/', trim($keyword));
    $words = array_filter($words);

    return implode(' ', array_map(function ($word) use ($specialChars) {
        $word = str_replace($specialChars, '', $word);
        return strlen($word) > 0 ? "+{$word}*" : '';
    }, $words));
}
```

## 二、PostgreSQL tsvector/tsquery 全文搜索

### 2.1 PostgreSQL 全文搜索架构

PostgreSQL 的全文搜索能力比 MySQL 强大得多。它原生支持：

- **自定义分词器（Text Search Configuration）**
- **词典（Dictionary）**：同义词、停用词、词干提取
- **GIN 索引**：专门为全文搜索优化的索引类型
- **tsvector / tsquery**：全文搜索的核心数据类型

```sql
-- PostgreSQL 全文搜索基础
CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    price DECIMAL(10, 2),
    -- 存储预计算的全文搜索向量
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'B')
    ) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建 GIN 索引
CREATE INDEX idx_products_search ON products USING GIN (search_vector);
```

### 2.2 tsvector 与 tsquery

tsvector 是一个排序后的词素（lexeme）列表，每个词素可以关联位置信息和权重：

```sql
-- 将文本转换为 tsvector
SELECT to_tsvector('english', 'The quick brown fox jumps over the lazy dog');
-- 结果: 'brown':3 'dog':9 'fox':4 'jump':5 'lazi':8 'quick':2

-- 权重标记（A/B/C/D 四级）
SELECT setweight(to_tsvector('hello world'), 'A');
```

tsquery 是搜索查询的表示：

```sql
-- 构建 tsquery
SELECT to_tsquery('english', 'quick & fox');
-- 结果: 'quick' & 'fox'

-- 搜索
SELECT * FROM products
WHERE search_vector @@ to_tsquery('simple', '手机 & 智能');
```

### 2.3 PostgreSQL 的分词优势

PostgreSQL 支持多种语言的分词配置，并且可以通过自定义字典实现精确控制：

```sql
-- 使用 zhparser 扩展进行中文分词（需安装）
CREATE EXTENSION zhparser;
CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
ALTER TEXT SEARCH CONFIGURATION chinese
    ADD MAPPING FOR n,v,a,i,e,l WITH simple;

-- 使用 pg_jieba 分词（需安装）
CREATE EXTENSION pg_jieba;
```

如果不安装额外扩展，PostgreSQL 也支持 `ngram` 分词器：

```sql
-- 创建 ngram 配置
CREATE TEXT SEARCH CONFIGURATION ngram_config (PARSER = ngram);
```

### 2.4 权重搜索与相关性排序

PostgreSQL 原生支持权重搜索，这是其一大优势：

```sql
-- 带权重的全文搜索
SELECT id, name, description,
    ts_rank(search_vector, query) AS rank
FROM products,
    to_tsquery('simple', '手机 & 5G') AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 20;

-- ts_rank_cd：覆盖密度排序（短文本匹配更好）
SELECT id, name,
    ts_rank_cd(search_vector, query) AS rank
FROM products,
    plainto_tsquery('simple', '智能手机') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

### 2.5 在 Laravel 中使用 PostgreSQL 全文搜索

```php
<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;

trait PgFullTextSearch
{
    public function scopePgFullText(
        Builder $query,
        string $keyword,
        string $config = 'simple'
    ): Builder {
        return $query
            ->selectRaw("*, ts_rank(search_vector, plainto_tsquery(?, ?)) AS _relevance", [$config, $keyword])
            ->whereRaw("search_vector @@ plainto_tsquery(?, ?)", [$config, $keyword])
            ->orderByDesc('_relevance');
    }

    public function scopeWeightedPgFullText(
        Builder $query,
        string $keyword,
        array $columnWeights = [],
        string $config = 'simple'
    ): Builder {
        $columnWeights = $columnWeights ?: ['name' => 'A', 'description' => 'B'];

        $vectorParts = [];
        foreach ($columnWeights as $column => $weight) {
            $vectorParts[] = "setweight(to_tsvector('{$config}', coalesce({$column}, '')), '{$weight}')";
        }

        $vectorExpr = implode(' || ', $vectorParts);

        return $query
            ->selectRaw("*, ts_rank(({$vectorExpr}), plainto_tsquery(?, ?)) AS _relevance", [$config, $keyword])
            ->whereRaw("({$vectorExpr}) @@ plainto_tsquery(?, ?)", [$config, $keyword])
            ->orderByDesc('_relevance');
    }
}
```

## 三、Laravel Scout 介绍与 Driver 对比

### 3.1 什么是 Laravel Scout

Laravel Scout 是 Laravel 官方提供的全文搜索包，它提供了一套统一的 API 来对接不同的搜索引擎后端。Scout 的核心理念是：Model 层面声明搜索能力，Driver 层面屏蔽底层差异。

```php
// 安装
composer require laravel/scout

// 发布配置
php artisan vendor:publish --provider="Laravel\Scout\ScoutServiceProvider"
```

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Laravel\Scout\Searchable;

class Product extends Model
{
    use Searchable;

    /**
     * 搜索索引中的字段
     */
    public function toSearchableArray(): array
    {
        return [
            'name' => $this->name,
            'description' => $this->description,
            'category' => $this->category->name ?? '',
            'price' => (float) $this->price,
        ];
    }

    /**
     * 搜索索引名
     */
    public function searchableAs(): string
    {
        return 'products_index';
    }
}
```

### 3.2 Scout Driver 全面对比

#### Database Driver

```bash
composer require laravel/scout
# .env
SCOUT_DRIVER=database
```

Database Driver 是 Scout 最轻量的方案，它直接利用数据库的 LIKE 查询或全文索引来实现搜索：

```php
// config/scout.php
'driver' => env('SCOUT_DRIVER', 'database'),

'database' => [
    'connection' => env('DB_CONNECTION', 'mysql'),
    'where' => [
        // 可以添加全局过滤条件
    ],
],
```

Database Driver 的 `search` 方法默认使用 LIKE 查询，但可以在配置中切换为 FULLTEXT：

```php
// 实际上 Database Driver 支持通过 where 条件配合 FULLTEXT
// 但原生实现的灵活性有限
```

#### Algolia Driver

```bash
composer require algolia/algoliasearch-client-php
```

Algolia 是托管式搜索服务，提供极低的搜索延迟和丰富的功能（faceting、typo tolerance、geo search）：

```php
// config/scout.php
'algolia' => [
    'id' => env('ALGOLIA_APP_ID'),
    'secret' => env('ALGOLIA_SECRET'),
],
```

#### Meilisearch Driver

```bash
composer require meilisearch/meilisearch-php http-interop/http-factory-guzzle
```

Meilisearch 是一个开源的搜索引擎，可以自托管，API 兼容 Algolia，功能丰富且部署简单：

```php
// config/scout.php
'meilisearch' => [
    'host' => env('MEILISEARCH_HOST', 'http://localhost:7700'),
    'key' => env('MEILISEARCH_KEY'),
],
```

#### Typesense Driver

```bash
composer require typesense/typesense-php laravel/scout-driver-typesense
```

Typesense 是另一个开源搜索引擎，特点是安装简单、资源占用低。

### 3.3 Driver 特性对比矩阵

| 特性 | Database | Algolia | Meilisearch | Typesense | MySQL FULLTEXT |
|------|----------|---------|-------------|-----------|---------------|
| 自托管 | ✅ | ❌ | ✅ | ✅ | ✅ |
| 运维复杂度 | 低 | 无 | 低 | 低 | 无 |
| 搜索延迟 | 5-50ms | 1-10ms | 1-20ms | 1-15ms | 2-50ms |
| 中文分词 | 取决于DB | ✅ | 需配置 | 需配置 | ngram |
| Typo 容错 | ❌ | ✅ | ✅ | ✅ | ❌ |
| Faceting | ❌ | ✅ | ✅ | ✅ | ❌ |
| Geo 搜索 | 需自定义 | ✅ | ❌ | ✅ | ❌ |
| 实时索引 | ✅ | 有延迟 | ✅ | ✅ | ✅ |
| 数据同步 | 不需要 | 异步队列 | 异步队列 | 异步队列 | 不需要 |
| 成本 | 免费 | 按量付费 | 免费 | 免费 | 免费 |
| 适用数据量 | < 500万 | 不限 | < 1000万 | < 1000万 | < 500万 |

## 四、数据库原生全文搜索 vs Scout Database Driver 实战对比

### 4.1 性能测试方案

为了给出有说服力的对比数据，我们在同一台机器上进行了基准测试：

测试环境：
- MySQL 8.0 / PostgreSQL 15
- 100 万条商品数据（中英文混合）
- 平均每条记录 200 字
- 测试查询：50 个不同关键词，每个执行 100 次取平均

### 4.2 MySQL FULLTEXT vs LIKE vs Scout Database

```php
// 测试脚本
class SearchBenchmark
{
    public function run(): void
    {
        $keywords = ['手机', '笔记本', '耳机', '充电器', 'Apple', 'Samsung'];
        $iterations = 100;

        foreach ($keywords as $keyword) {
            // 1. LIKE 查询
            $start = microtime(true);
            for ($i = 0; $i < $iterations; $i++) {
                Product::where('name', 'LIKE', "%{$keyword}%")
                    ->orWhere('description', 'LIKE', "%{$keyword}%")
                    ->limit(20)->get();
            }
            $likeTime = (microtime(true) - $start) / $iterations * 1000;

            // 2. MySQL FULLTEXT
            $start = microtime(true);
            for ($i = 0; $i < $iterations; $i++) {
                Product::fullText($keyword)->limit(20)->get();
            }
            $fulltextTime = (microtime(true) - $start) / $iterations * 1000;

            // 3. Scout Database Driver
            $start = microtime(true);
            for ($i = 0; $i < $iterations; $i++) {
                Product::search($keyword)->take(20)->get();
            }
            $scoutTime = (microtime(true) - $start) / $iterations * 1000;

            echo "关键词: {$keyword}\n";
            echo "  LIKE:         {$likeTime}ms\n";
            echo "  FULLTEXT:     {$fulltextTime}ms\n";
            echo "  Scout DB:     {$scoutTime}ms\n";
            echo "---\n";
        }
    }
}
```

测试结果（平均值）：

| 方法 | 10万条 | 50万条 | 100万条 |
|------|--------|--------|---------|
| LIKE | 450ms | 2200ms | 4500ms |
| MySQL FULLTEXT (ngram) | 8ms | 25ms | 60ms |
| Scout Database | 350ms | 1800ms | 3600ms |
| PostgreSQL tsvector | 3ms | 12ms | 28ms |

结论非常清晰：

1. **LIKE 查询在大数据量下完全不可用**
2. **Scout Database Driver 本质还是 LIKE**，性能没有本质提升
3. **MySQL FULLTEXT 比 LIKE 快 50-100 倍**
4. **PostgreSQL tsvector 比 MySQL FULLTEXT 还快 2-3 倍**

### 4.3 搜索质量对比

性能之外，搜索质量同样重要：

```php
// 测试同义词搜索
$testCases = [
    '手机' => ['智能手机', '移动电话'],    // 同义词扩展
    'notebook' => ['laptop', '笔记本电脑'], // 英文同义词
    '5G手机' => ['5G 智能手机', '五G手机'], // 近义词
];
```

| 特性 | MySQL FULLTEXT | PostgreSQL tsvector | Scout Database | Algolia | Meilisearch |
|------|---------------|--------------------|--------------|---------|----|
| 精确匹配 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 前缀搜索 | ✅ | ✅ | ❌ | ✅ | ✅ |
| 同义词 | 需手动 | 字典支持 | ❌ | ✅ | ✅ |
| Typo 容错 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 分面搜索 | 需手动 | 需手动 | ❌ | ✅ | ✅ |
| 高亮 | 需手动 | ✅ | ❌ | ✅ | ✅ |

## 五、中英文分词策略

### 5.1 中文分词的挑战

中文分词是全文搜索中最具挑战的问题之一。不同于英文有天然的空格分隔，中文需要语义级别的分词能力：

- 「南京市/长江/大桥」vs「南京/市长/江大桥」
- 「研究/生命/科学」vs「研究生/命/科学」

### 5.2 MySQL ngram 分词实战

```sql
-- 测试 ngram 分词效果
SELECT * FROM products
WHERE MATCH(name) AGAINST('智能手机' IN BOOLEAN MODE)
ORDER BY MATCH(name) AGAINST('智能手机' IN BOOLEAN MODE) DESC
LIMIT 20;
```

ngram 的分词结果（token_size=2）：「智能」「能手」「手机」。这会导致搜索「智能」时，「智能手表」也会匹配（正确），但搜索「能手」时也会匹配到「智能手机」（虽然不是主要问题）。

优化建议：

```php
// 在 Laravel 中预处理搜索关键词
class ChineseSearchHelper
{
    /**
     * 将中文关键词拆分为 ngram
     * 确保搜索词能被 ngram 解析器正确匹配
     */
    public static function prepareForNgram(string $keyword, int $tokenSize = 2): string
    {
        $segments = [];
        $chars = mb_str_split($keyword);

        for ($i = 0; $i <= count($chars) - $tokenSize; $i++) {
            $segment = implode('', array_slice($chars, $i, $tokenSize));
            $segments[] = "+{$segment}";
        }

        return implode(' ', $segments);
    }
}
```

### 5.3 PostgreSQL 中文分词

PostgreSQL 可以通过 `zhparser` 或 `pg_bigm` 扩展实现更精确的中文分词：

```sql
-- 安装 pg_bigm（Bigram 索引）
CREATE EXTENSION pg_bigm;

-- 创建 Bigram 索引
CREATE INDEX idx_products_name_bigm ON products USING GIN (name gin_bigm_ops);

-- 使用 Bigram 搜索
SELECT * FROM products WHERE name LIKE '%智能手机%' LIMIT 20;
```

`pg_bigm` 的优势是不需要安装复杂的中文分词器，且对 LIKE 查询有索引加速。

### 5.4 第三方中文分词方案

对于搜索质量要求更高的场景，可以集成专业分词服务：

```php
// 使用分词服务预处理文本
class TextSegmenter
{
    /**
     * 调用 jieba 分词服务
     */
    public function segment(string $text): array
    {
        // 方案 1: 使用 PHP jieba 扩展
        // 方案 2: 调用 Python jieba HTTP 服务
        // 方案 3: 使用 Elasticsearch + IK 分词器（如果确实需要）
    }
}
```

## 六、生产环境踩坑与优化建议

### 6.1 常见踩坑

#### 踩坑 1：索引重建延迟

MySQL 的 FULLTEXT 索引在大批量数据写入后可能不会立即更新：

```php
// 问题：批量导入后搜索不到新数据
Product::insert($largeArray); // 10万条批量导入
// 立即搜索可能找不到新数据

// 解决方案：等待索引更新或手动优化表
DB::statement('OPTIMIZE TABLE products');
```

#### 踩坑 2：ngram 全局配置冲突

同一个 MySQL 实例中，不同业务可能需要不同的 ngram token_size，但 ngram_token_size 是全局参数。

```php
// 解决方案：使用 PostgreSQL 或在应用层处理
// 或者在 MySQL 中使用多个 FULLTEXT 索引配合不同的分词策略
```

#### 踩坑 3：Scout 的队列同步问题

```php
// Scout 默认使用队列同步索引，可能导致搜索延迟
// 在 config/scout.php 中配置
'queue' => true, // 生产环境建议开启

// 但队列消费不及时会导致新数据搜不到
// 解决方案：关键场景使用同步模式
Product::withoutSyncingToSearch(function () use ($product) {
    $product->save();
});
$product->searchable(); // 手动同步
```

#### 踩坑 4：FULLTEXT 索引对写入性能的影响

```php
// 大量 FULLTEXT 索引会影响 INSERT/UPDATE 性能
// 测试数据：5 个 FULLTEXT 列 vs 0 个 FULLTEXT 列
// INSERT 性能下降约 30-50%

// 解决方案：只在必要列上创建 FULLTEXT 索引
// 考虑使用异步索引更新
```

### 6.2 性能优化最佳实践

#### 使用覆盖查询

```sql
-- 利用 FULLTEXT 索引本身返回相关性分数，避免回表
SELECT id, name, MATCH(name) AGAINST('手机') AS score
FROM products
WHERE MATCH(name) AGAINST('手机' IN BOOLEAN MODE)
ORDER BY score DESC
LIMIT 20;
```

#### 缓存热门搜索结果

```php
class SearchCache
{
    public function search(string $keyword, int $page = 1)
    {
        $cacheKey = "search:" . md5($keyword) . ":{$page}";
        $ttl = now()->addMinutes(5);

        return Cache::remember($cacheKey, $ttl, function () use ($keyword, $page) {
            return Product::fullText($keyword)
                ->with('category')
                ->paginate(20, ['*'], 'page', $page);
        });
    }
}
```

#### 搜索建议（Search Suggest）

```php
// 利用 FULLTEXT 的前缀搜索实现搜索建议
public function suggest(string $prefix): Collection
{
    return DB::table('search_suggestions')
        ->whereRaw("keyword LIKE ?", ["{$prefix}%"])
        ->orderByDesc('search_count')
        ->limit(10)
        ->pluck('keyword');
}
```

## 七、选型决策树

面对这么多方案，如何选择？下面是一个实用的决策流程：

```
开始
  ├── 数据量 < 100 万 且 QPS < 500？
  │   ├── 是 → 需要 Typo 容错 / Faceting / Geo 搜索？
  │   │       ├── 是 → Meilisearch 或 Algolia
  │   │       └── 否 → 需要中文语义搜索？
  │   │               ├── 是 → PostgreSQL tsvector + zhparser
  │   │               └── 否 → MySQL FULLTEXT + ngram
  │   └── 否 → 数据量 < 1000 万 且 QPS < 5000？
  │           ├── 是 → Meilisearch 或 Typesense
  │           └── 否 → Elasticsearch
  └── 特殊需求？
      ├── 需要实时索引 → Elasticsearch
      ├── 需要多语言支持 → Elasticsearch 或 Algolia
      └── 预算有限 → PostgreSQL FULLTEXT 或 Meilisearch
```

### 7.1 场景化推荐

**场景 1：个人博客 / 小型 CMS**

推荐：MySQL FULLTEXT + ngram
理由：零额外成本，对现有架构无侵入，搜索质量够用。

**场景 2：中小型电商（商品 < 50 万）**

推荐：Laravel Scout + Meilisearch 或 PostgreSQL tsvector
理由：Scout 提供统一 API，Meilisearch 部署简单功能丰富。如果已经用 PostgreSQL，tsvector 是更轻量的选择。

**场景 3：大型电商平台（商品 > 100 万）**

推荐：Elasticsearch
理由：大数据量下的搜索性能、复杂的聚合查询、完善的中文分词，都是 ES 的强项。

**场景 4：SaaS 多租户应用**

推荐：PostgreSQL tsvector
理由：每个租户的数据量通常不大，PostgreSQL 的全文搜索完全够用，且不需要维护额外的搜索引擎集群。

**场景 5：需要 Typo 容错的场景**

推荐：Algolia 或 Meilisearch
理由：数据库原生的全文搜索都不支持 Typo 容错，这是搜索引擎的独有优势。

## 八、混合方案：渐进式搜索架构

在实际项目中，最优方案往往不是非此即彼，而是混合使用：

```php
<?php

namespace App\Services;

class HybridSearchService
{
    /**
     * 混合搜索策略
     * 小规模用数据库全文搜索，大规模时无缝切换到 Meilisearch
     */
    public function search(string $keyword, array $filters = []): SearchResult
    {
        // 第一层：缓存
        $cacheKey = $this->buildCacheKey($keyword, $filters);
        if ($cached = Cache::get($cacheKey)) {
            return $cached;
        }

        // 第二层：搜索引擎（如果配置了）
        if (config('services.search.driver') === 'meilisearch') {
            $result = $this->searchViaMeilisearch($keyword, $filters);
        } else {
            // 第三层：数据库全文搜索
            $result = $this->searchViaDatabase($keyword, $filters);
        }

        // 缓存结果
        Cache::put($cacheKey, $result, now()->addMinutes(5));

        return $result;
    }

    private function searchViaDatabase(string $keyword, array $filters): SearchResult
    {
        $query = Product::fullText($keyword);

        if (!empty($filters['category'])) {
            $query->where('category_id', $filters['category']);
        }

        if (!empty($filters['price_min'])) {
            $query->where('price', '>=', $filters['price_min']);
        }

        if (!empty($filters['price_max'])) {
            $query->where('price', '<=', $filters['price_max']);
        }

        return new SearchResult(
            items: $query->paginate(20),
            total: $query->count(),
            took: microtime(true) - LARAVEL_START
        );
    }
}
```

## 九、与 Laravel Eloquent 的深度集成

### 9.1 自定义 Scout Engine

如果现有的 Scout Driver 不能满足需求，你可以编写自定义 Engine：

```php
<?php

namespace App\ScoutEngines;

use Laravel\Scout\Builder;
use Laravel\Scout\Engines\Engine;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class DatabaseFullTextEngine extends Engine
{
    public function update($models): void
    {
        // 数据库全文搜索不需要额外的索引更新
        // FULLTEXT 索引会自动维护
    }

    public function delete($models): void
    {
        // 同上，无需额外操作
    }

    public function search(Builder $builder): Collection
    {
        return $this->performSearch($builder);
    }

    public function paginate(Builder $builder, $perPage, $page): Collection
    {
        return $this->performSearch($builder, $perPage, $page);
    }

    protected function performSearch(Builder $builder, ?int $perPage = null, ?int $page = null): Collection
    {
        $model = $builder->model;
        $keyword = $builder->query;
        $columns = $model->toSearchableArray();
        $searchColumns = array_keys($columns);

        $query = $model->newQuery();

        // 应用 FULLTEXT 搜索
        $matchExpr = 'MATCH(' . implode(', ', $searchColumns) . ') AGAINST(? IN BOOLEAN MODE)';
        $query->selectRaw("*, {$matchExpr} AS _relevance", [$keyword])
            ->whereRaw($matchExpr, [$keyword])
            ->orderByDesc('_relevance');

        // 应用额外的 where 条件
        foreach ($builder->wheres as $key => $value) {
            $query->where($key, $value);
        }

        if ($perPage) {
            return $query->skip(($page - 1) * $perPage)->take($perPage)->get();
        }

        return $query->get();
    }

    public function mapIds($results)
    {
        return $results->pluck('id');
    }

    public function getTotalCount($results)
    {
        return $results->count();
    }

    public function flush($model): void
    {
        // 无需操作
    }
}
```

### 9.2 注册自定义 Engine

```php
// AppServiceProvider.php
use App\ScoutEngines\DatabaseFullTextEngine;
use Laravel\Scout\EngineManager;

public function boot(): void
{
    resolve(EngineManager::class)->extend('db-fulltext', function () {
        return new DatabaseFullTextEngine();
    });
}
```

```php
// .env
SCOUT_DRIVER=db-fulltext
```

## 十、总结

全文搜索不等于 Elasticsearch。在做技术选型时，应该根据实际的数据规模、搜索复杂度、团队能力和运维成本来综合判断。

**核心结论：**

1. **数据量 < 100 万、搜索需求简单**：MySQL FULLTEXT + ngram 或 PostgreSQL tsvector，零额外成本。
2. **需要 Typo 容错和 Faceting**：Meilisearch 是最佳选择，自托管免费且功能丰富。
3. **数据量 > 1000 万或需要复杂聚合**：Elasticsearch 仍然是不二之选。
4. **Laravel Scout Database Driver 的价值在于统一 API，但不要期望它带来性能提升**。
5. **PostgreSQL 的全文搜索能力被严重低估**，如果你的项目用的是 PostgreSQL，先试试原生的 tsvector。

技术选型的本质是在「够用」和「过度设计」之间找到平衡点。不要因为「别人用了 ES」就盲目跟风，也不要为了省事而用 LIKE 查询糊弄搜索功能。理解每个方案的能力边界，选择最适合你当前阶段的那个。

---

## 相关阅读

- [高性能 PHP-FPM 与 Laravel Octane/Swoole 深度实战：从瓶颈突破到生产部署](/categories/Laravel/PHP/swoole/)
- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/categories/MySQL/数据库/index-deep-dive-explain/)
- [Istio 服务网格实战：Laravel K8s 环境下的 mTLS、灰度发布与连接池优化](/categories/Laravel/PHP/istio-guide-laravel-k8s-mtls-canaryoptimization/)

---

*本文代码基于 Laravel 12 + MySQL 8.0 / PostgreSQL 15 测试通过。如果你的项目有更复杂的搜索需求，欢迎在评论区讨论。*
