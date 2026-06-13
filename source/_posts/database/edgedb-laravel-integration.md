---
title: "EdgeDB 实战：下一代数据库——内置 ORM、Schema 即代码、GraphQL 自动生成与 Laravel 集成探索"
keywords: [EdgeDB, ORM, Schema, GraphQL, Laravel, 下一代数据库, 内置, 即代码, 自动生成与, 集成探索]
date: 2026-06-10 03:49:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - EdgeDB
  - GraphQL
  - ORM
  - Laravel
  - PostgreSQL
  - 数据库
description: "深入探索 EdgeDB 这个基于 PostgreSQL 的下一代数据库，从 Schema 即代码、内置 ORM、GraphQL 自动生成等核心特性出发，结合 Laravel 集成实战，对比传统 RDBMS 工作流的差异与优势。"
---


## 为什么又来一个数据库？

在 Laravel 生态里，Eloquent ORM 已经足够好用。MySQL / PostgreSQL 稳如老狗。那为什么还要看 EdgeDB？

答案很简单：**它想干掉"应用层 ORM + 数据库迁移 + GraphQL 网关"这三件套的重复劳动。**

传统架构：

```
数据库 Schema → Migration 文件 → Eloquent Model → GraphQL Schema → Resolver
五层映射，改一处要联动四层。
```

EdgeDB 的承诺：

```
Schema 文件 → 自动生成 ORM Query Builder + GraphQL API + Migration
一层定义，其余自动推导。
```

听起来很美好，但实际用起来如何？本文带你从安装到 Laravel 集成，完整走一遍。

## EdgeDB 是什么

EdgeDB 是一个基于 PostgreSQL 构建的图关系数据库（Graph-Relational Database）。它不是 PostgreSQL 的包装层，而是在 PostgreSQL 之上重新设计了查询语言 EdgeQL 和类型系统。

### 核心理念

| 特性 | 传统 RDBMS | EdgeDB |
|------|-----------|--------|
| Schema 定义 | SQL DDL / Migration | `.esdl` 文件，声明式 |
| ORM | 应用层实现（Eloquent / SQLAlchemy） | 内置，Schema 自动生成 |
| GraphQL | 需要单独搭建（Lighthouse / graphql-php） | 内置，一键开启 |
| Migration | 手写或生成 | 自动 diff 生成 |
| 查询语言 | SQL | EdgeQL（更强的类型推导） |
| 底层 | 无 | PostgreSQL |

### 架构定位

```
┌─────────────────────────────────────┐
│           Application Layer          │
│   (PHP/Laravel, JS, Python, etc.)   │
└──────────────┬──────────────────────┘
               │ EdgeQL / GraphQL / REST
┌──────────────▼──────────────────────┐
│            EdgeDB Server             │
│  ┌────────────────────────────────┐  │
│  │     EdgeDB Query Engine        │  │
│  │  (EdgeQL Compiler + Executor)  │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │     Built-in GraphQL Server    │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │     PostgreSQL Storage Engine  │  │
│  └────────────────────────────────┘  │
└─────────────────────────────────────┘
```

EdgeDB 底层确实跑着一个 PostgreSQL 实例，但你不需要直接和它打交道。所有操作通过 EdgeDB Server 完成。

## 安装与初始化

### 安装 EdgeDB CLI

```bash
# macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.edgedb.com | sh

# 或者用 brew
brew install edgedb/tap/edgedb

# 验证安装
edgedb --version
```

### 创建项目

```bash
mkdir edgedb-demo && cd edgedb-demo
edgedb project init
```

这个命令会：
1. 创建 `dbschema/` 目录
2. 生成 `dbschema/default.esdl` Schema 文件
3. 启动一个 EdgeDB 实例
4. 创建数据库

```bash
# 检查实例状态
edgedb instance status

# 连接到数据库 REPL
edgedb
```

### Docker 方式（推荐生产环境）

```yaml
# docker-compose.yml
version: "3.8"
services:
  edgedb:
    image: edgedb/edgedb:latest
    environment:
      EDGEDB_SERVER_SECURITY: insecure_dev_mode
      EDGEDB_SERVER_DATABASE: mydb
    ports:
      - "5656:5656"
    volumes:
      - edgedb-data:/var/lib/edgedb/data
      - ./dbschema:/dbschema

volumes:
  edgedb-data:
```

```bash
docker compose up -d
```

## Schema 即代码：定义数据模型

EdgeDB 的 Schema 文件使用 `.esdl` 格式，语法介于 TypeScript 和 GraphQL Schema 之间。

### 基础 Schema

```esdl
# dbschema/default.esdl

module default {
  # 用户类型
  type User {
    required property name -> str;
    required property email -> str {
      constraint exclusive;  # 唯一约束
    }
    property avatar -> str;
    property created_at -> datetime {
      default := datetime_current();
    }

    # 关联：一个用户有多篇文章
    multi link posts -> Post;
    # 关联：用户关注的标签
    multi link tags -> Tag {
      property starred_at -> datetime;
    }
  }

  # 文章类型
  type Post {
    required property title -> str;
    required property slug -> str {
      constraint exclusive;
    }
    required property content -> str;
    property summary -> str;
    property status -> PostStatus {
      default := 'draft';
    }
    property view_count -> int64 {
      default := 0;
    }
    property published_at -> datetime;
    property created_at -> datetime {
      default := datetime_current();
    }
    property updated_at -> datetime {
      default := datetime_current();
    }

    # 关联：作者
    required link author -> User;
    # 关联：分类
    link category -> Category;
    # 关联：多标签
    multi link tags -> Tag;
  }

  # 分类
  scalar type PostStatus extending enum<'draft', 'published', 'archived'>;

  type Category {
    required property name -> str {
      constraint exclusive;
    }
    property slug -> str;
    property description -> str;

    # 关联：该分类下的所有文章（反向查询）
    multi link posts := .<category[is Post];
  }

  # 标签
  type Tag {
    required property name -> str {
      constraint exclusive;
    }
    property slug -> str;

    # 计算属性：使用该标签的文章数量
    property post_count := count(.<tags[is Post]);
  }
}
```

### Schema 设计要点

**1. 类型声明**

```esdl
# required = NOT NULL
required property name -> str;

# 可选字段不需要 required
property avatar -> str;

# 默认值用 := 赋值
property created_at -> datetime {
  default := datetime_current();
}
```

**2. 唯一约束**

```esdl
constraint exclusive  # 等价于 SQL 的 UNIQUE
```

**3. 关联定义**

```esdl
# 多对一
required link author -> User;

# 多对多
multi link tags -> Tag;

# 带属性的关联（类似 Laravel 的 pivot）
multi link tags -> Tag {
  property starred_at -> datetime;
}
```

**4. 计算属性 / 反向关联**

```esdl
# 这不是存储的数据，而是实时计算的
multi link posts := .<category[is Post];
property post_count := count(.<tags[is Post]);
```

这是 EdgeDB 的一大亮点：**反向关联是自动推导的**，不需要像 SQL 那样写 JOIN。

### 迁移

```bash
# 自动检测 Schema 变更并生成迁移
edgedb migration create

# 应用迁移
edgedb migrate
```

EdgeDB 会读取 `.esdl` 文件的变更，自动生成迁移脚本。你只需要确认 diff 即可。

```
$ edgedb migration create
Did you create type 'default::User'? [y,n,l,c,b,s,q,?]
> y
Created dbschema/migrations/00001.edgeql
```

## EdgeQL 查询语言

EdgeQL 是 EdgeDB 的查询语言，语法上类似 GraphQL + SQL 的混合体。

### 基础 CRUD

#### 创建

```edgeql
# 插入一条 User
INSERT User {
  name := 'Michael',
  email := 'michael@example.com',
  avatar := 'https://avatar.url/michael'
};
```

#### 查询

```edgeql
# 查询所有用户
SELECT User {
  name,
  email,
  created_at
};

# 条件过滤
SELECT User {
  name,
  email
} FILTER .name = 'Michael';

# 排序 + 分页
SELECT Post {
  title,
  slug,
  published_at
}
FILTER .status = 'published'
ORDER BY .published_at DESC
LIMIT 10 OFFSET 0;
```

#### 嵌套查询（Eager Loading 等价）

```edgeql
# 一次查询获取文章及其作者和标签
SELECT Post {
  title,
  content,
  author: {
    name,
    email
  },
  tags: {
    name,
    slug
  },
  category: {
    name
  }
}
FILTER .status = 'published'
ORDER BY .published_at DESC
LIMIT 20;
```

**这是 EdgeDB 最优雅的地方：关联查询是声明式的，不需要 N+1 问题，不需要 `with()` 或 `load()`。**

#### 更新

```edgeql
UPDATE Post
FILTER .slug = 'hello-world'
SET {
  status := 'published',
  published_at := datetime_current()
};
```

#### 删除

```edgeql
DELETE Post
FILTER .slug = 'old-post';
```

### 高级查询

#### 聚合

```edgeql
# 统计每个分类的文章数
SELECT Category {
  name,
  post_count := count(.posts)
}
ORDER BY .post_count DESC;
```

#### 子查询

```edgeql
# 查找热门文章（浏览量高于平均值的）
SELECT Post {
  title,
  view_count
}
FILTER .view_count > (
  SELECT avg(Post.view_count)
)
ORDER BY .view_count DESC;
```

#### WITH 子句

```edgeql
WITH
  recent := (
    SELECT Post
    FILTER .created_at > datetime_current() - <duration>'30 days'
  )
SELECT {
  total_count := count(recent),
  published_count := count(recent FILTER .status = 'published'),
  draft_count := count(recent FILTER .status = 'draft')
};
```

## 内置 GraphQL

EdgeDB 内置了一个 GraphQL 服务器，只需要开启就能用。

### 开启 GraphQL

```bash
# 在 EdgeDB REPL 中执行
CONFIGURE INSTANCE SET
  allow_bare_ddl := 'AlwaysAllow';

# 然后创建 GraphQL 扩展
CREATE EXTENSION graphql;
```

访问 `http://localhost:5656/<数据库名>/graphql` 即可使用。

### GraphQL 查询

```graphql
# 查询文章列表
query {
  Post(
    filter: { status: { eq: published } }
    order: { published_at: DESC }
    first: 10
  ) {
    title
    slug
    summary
    published_at
    author {
      name
      email
    }
    tags {
      name
    }
  }
}
```

```graphql
# 创建文章
mutation {
  insert_Post(
    data: {
      title: "Hello EdgeDB"
      slug: "hello-edgedb"
      content: "EdgeDB is awesome"
      author: { connect: { email: "michael@example.com" } }
      status: published
    }
  ) {
    title
    slug
  }
}
```

### GraphQL 的局限

EdgeDB 的 GraphQL 支持是"够用"级别：

- **不支持订阅（Subscription）**：实时推送需要其他方案
- **聚合功能受限**：复杂聚合建议用 EdgeQL
- **自定义 Resolver 不支持**：业务逻辑需要在应用层处理

如果你的场景是"快速暴露 CRUD API + 前端直接查询"，EdgeDB GraphQL 完全够用。如果需要复杂业务逻辑，建议用 EdgeQL。

## Laravel 集成实战

EdgeDB 官方没有 PHP SDK，但提供了 HTTP 协议接口，我们可以用 Guzzle 或 Laravel HTTP Client 对接。

### 方案一：HTTP API 直连

#### 配置

```php
// config/edgedb.php
<?php

return [
    'host' => env('EDGEDB_HOST', 'localhost'),
    'port' => env('EDGEDB_PORT', 5656),
    'database' => env('EDGEDB_DATABASE', 'mydb'),
    'instance' => env('EDGEDB_INSTANCE', 'my_instance'),
    // 生产环境需要配置 TLS 和认证
    'tls_ca' => env('EDGEDB_TLS_CA'),
    'secret_key' => env('EDGEDB_SECRET_KEY'),
];
```

#### EdgeDB Client Service

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class EdgeDBClient
{
    private string $baseUrl;
    private string $database;

    public function __construct()
    {
        $host = config('edgedb.host');
        $port = config('edgedb.port');
        $this->database = config('edgedb.database');
        $this->baseUrl = "http://{$host}:{$port}";
    }

    /**
     * 执行 EdgeQL 查询
     */
    public function query(string $edgeql, array $args = []): array
    {
        $response = Http::timeout(30)
            ->withHeaders([
                'Content-Type' => 'application/json',
            ])
            ->post("{$this->baseUrl}/db/{$this->database}", [
                'query' => $edgeql,
                'args' => $args,
            ]);

        if ($response->failed()) {
            throw new \RuntimeException(
                "EdgeDB query failed: " . $response->body()
            );
        }

        return $response->json();
    }

    /**
     * 查询多条记录
     */
    public function select(string $edgeql, array $args = []): array
    {
        return $this->query($edgeql, $args);
    }

    /**
     * 查询单条记录
     */
    public function selectSingle(string $edgeql, array $args = []): ?array
    {
        $result = $this->query($edgeql, $args);
        return $result[0] ?? null;
    }

    /**
     * 插入记录
     */
    public function insert(string $edgeql, array $args = []): array
    {
        return $this->query($edgeql, $args);
    }

    /**
     * 更新记录
     */
    public function update(string $edgeql, array $args = []): array
    {
        return $this->query($edgeql, $args);
    }

    /**
     * 删除记录
     */
    public function delete(string $edgeql, array $args = []): array
    {
        return $this->query($edgeql, $args);
    }

    /**
     * 使用 GraphQL 查询
     */
    public function graphql(string $query, array $variables = []): array
    {
        $response = Http::timeout(30)
            ->post("{$this->baseUrl}/db/{$this->database}/graphql", [
                'query' => $query,
                'variables' => $variables,
            ]);

        if ($response->failed()) {
            throw new \RuntimeException(
                "EdgeDB GraphQL failed: " . $response->body()
            );
        }

        return $response->json();
    }
}
```

#### Service Provider

```php
<?php

namespace App\Providers;

use App\Services\EdgeDBClient;
use Illuminate\Support\ServiceProvider;

class EdgeDBServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(EdgeDBClient::class, function () {
            return new EdgeDBClient();
        });

        // 简短别名
        $this->app->alias(EdgeDBClient::class, 'edgedb');
    }
}
```

#### Facade（可选）

```php
<?php

namespace App\Facades;

use Illuminate\Support\Facades\Facade;

class EdgeDB extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'edgedb';
    }
}
```

### 方案二：封装 Repository 层

为了让业务代码更优雅，封装一个 Post Repository：

```php
<?php

namespace App\Repositories;

use App\Services\EdgeDBClient;

class EdgeDBPostRepository
{
    public function __construct(
        private EdgeDBClient $db
    ) {}

    /**
     * 获取已发布的文章列表（带作者和标签）
     */
    public function getPublishedPosts(int $limit = 20, int $offset = 0): array
    {
        $edgeql = <<<EDGEQL
            SELECT Post {
                id,
                title,
                slug,
                summary,
                content,
                status,
                view_count,
                published_at,
                created_at,
                author: {
                    id,
                    name,
                    email,
                    avatar
                },
                category: {
                    name,
                    slug
                },
                tags: {
                    name,
                    slug
                }
            }
            FILTER .status = 'published'
            ORDER BY .published_at DESC
            LIMIT <int64>\$limit
            OFFSET <int64>\$offset
        EDGEQL;

        return $this->db->select($edgeql, [
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    /**
     * 根据 slug 获取文章详情
     */
    public function getBySlug(string $slug): ?array
    {
        $edgeql = <<<EDGEQL
            SELECT Post {
                id,
                title,
                slug,
                summary,
                content,
                status,
                view_count,
                published_at,
                created_at,
                updated_at,
                author: {
                    id,
                    name,
                    email,
                    avatar
                },
                category: {
                    name,
                    slug,
                    description
                },
                tags: {
                    name,
                    slug,
                    post_count
                }
            }
            FILTER .slug = <str>\$slug
            LIMIT 1
        EDGEQL;

        return $this->db->selectSingle($edgeql, ['slug' => $slug]);
    }

    /**
     * 创建文章
     */
    public function create(array $data): array
    {
        $edgeql = <<<EDGEQL
            INSERT Post {
                title := <str>\$title,
                slug := <str>\$slug,
                content := <str>\$content,
                summary := <str>\$summary,
                status := <str>\$status,
                author := (SELECT User FILTER .id = <uuid>\$author_id),
                category := (
                    SELECT Category FILTER .id = <uuid>\$category_id
                ),
                tags := (
                    SELECT Tag FILTER .id IN array_unpack(<array<uuid>>\$tag_ids)
                )
            }
        EDGEQL;

        return $this->db->insert($edgeql, [
            'title' => $data['title'],
            'slug' => $data['slug'],
            'content' => $data['content'],
            'summary' => $data['summary'] ?? null,
            'status' => $data['status'] ?? 'draft',
            'author_id' => $data['author_id'],
            'category_id' => $data['category_id'] ?? null,
            'tag_ids' => $data['tag_ids'] ?? [],
        ]);
    }

    /**
     * 更新文章
     */
    public function update(string $id, array $data): array
    {
        $sets = [];
        $args = ['id' => $id];

        foreach ($data as $key => $value) {
            if ($key === 'tag_ids') {
                $sets[] = "tags := (SELECT Tag FILTER .id IN array_unpack(<array<uuid>>\$tag_ids))";
                $args['tag_ids'] = $value;
            } elseif ($key === 'category_id') {
                $sets[] = "category := (SELECT Category FILTER .id = <uuid>\$category_id)";
                $args['category_id'] = $value;
            } else {
                $sets[] = "{$key} := <str>\${$key}";
                $args[$key] = $value;
            }
        }

        $edgeql = <<<EDGEQL
            UPDATE Post
            FILTER .id = <uuid>\$id
            SET {
                {$sets[0]}
            }
        EDGEQL;

        return $this->db->update($edgeql, $args);
    }

    /**
     * 增加浏览量（原子操作）
     */
    public function incrementViewCount(string $slug): void
    {
        $edgeql = <<<EDGEQL
            UPDATE Post
            FILTER .slug = <str>\$slug
            SET {
                view_count := .view_count + 1
            }
        EDGEQL;

        $this->db->update($edgeql, ['slug' => $slug]);
    }

    /**
     * 搜索文章（全文搜索）
     */
    public function search(string $keyword, int $limit = 20): array
    {
        $edgeql = <<<EDGEQL
            SELECT Post {
                id,
                title,
                slug,
                summary,
                published_at,
                author: { name },
                tags: { name }
            }
            FILTER
                .status = 'published'
                AND (
                    str_contains(str_lower(.title), str_lower(<str>\$keyword))
                    OR str_contains(str_lower(.content), str_lower(<str>\$keyword))
                )
            ORDER BY .published_at DESC
            LIMIT <int64>\$limit
        EDGEQL;

        return $this->db->select($edgeql, [
            'keyword' => $keyword,
            'limit' => $limit,
        ]);
    }

    /**
     * 获取分类统计
     */
    public function getCategoryStats(): array
    {
        $edgeql = <<<EDGEQL
            SELECT Category {
                name,
                slug,
                description,
                post_count := count(.posts FILTER .status = 'published')
            }
            ORDER BY .post_count DESC
        EDGEQL;

        return $this->db->select($edgeql);
    }
}
```

### 方案三：Eloquent 桥接层

如果不想完全放弃 Eloquent 生态，可以做一个薄桥接层：

```php
<?php

namespace App\Models;

use App\Services\EdgeDBClient;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\App;

/**
 * EdgeDB Post 桥接模型
 * 
 * 不使用 Eloquent 的数据库连接，
 * 而是将查询转发给 EdgeDB。
 */
class EdgeDBPost extends Model
{
    protected $guarded = [];

    private static function db(): EdgeDBClient
    {
        return App::make(EdgeDBClient::class);
    }

    /**
     * 重写 query builder，转发到 EdgeDB
     */
    public function newQuery()
    {
        // 返回一个自定义 builder
        return new EdgeDBQueryBuilder($this, static::db());
    }

    /**
     * 将 EdgeDB 结果转换为 Model 集合
     */
    public static function fromEdgeDBResult(array $items): \Illuminate\Support\Collection
    {
        return collect($items)->map(function ($item) {
            $model = new static();
            $model->fill($item);
            $model->exists = true;
            return $model;
        });
    }
}
```

```php
<?php

namespace App\Models;

use App\Services\EdgeDBClient;

class EdgeDBQueryBuilder
{
    private string $edgeql = '';
    private array $filters = [];
    private ?int $limit = null;
    private ?int $offset = null;
    private array $orderBy = [];

    public function __construct(
        private $model,
        private EdgeDBClient $db
    ) {}

    public function where(string $field, mixed $value): static
    {
        $this->filters[] = ['field' => $field, 'op' => '=', 'value' => $value];
        return $this;
    }

    public function orderBy(string $field, string $direction = 'ASC'): static
    {
        $this->orderBy[] = "{$field} {$direction}";
        return $this;
    }

    public function take(int $limit): static
    {
        $this->limit = $limit;
        return $this;
    }

    public function skip(int $offset): static
    {
        $this->offset = $offset;
        return $this;
    }

    public function get(): \Illuminate\Support\Collection
    {
        // 根据 model 类型确定 EdgeDB type
        $type = class_basename($this->model);

        $edgeql = "SELECT {$type} { *, author: { name, email } }";

        if (!empty($this->filters)) {
            $conditions = array_map(function ($f) {
                return ".{$f['field']} = <str>\${$f['field']}";
            }, $this->filters);
            $edgeql .= " FILTER " . implode(' AND ', $conditions);
        }

        if (!empty($this->orderBy)) {
            $edgeql .= " ORDER BY " . implode(', ', $this->orderBy);
        }

        if ($this->limit) {
            $edgeql .= " LIMIT <int64>\$limit";
        }

        if ($this->offset) {
            $edgeql .= " OFFSET <int64>\$offset";
        }

        $args = [];
        foreach ($this->filters as $f) {
            $args[$f['field']] = $f['value'];
        }
        if ($this->limit) $args['limit'] = $this->limit;
        if ($this->offset) $args['offset'] = $this->offset;

        $results = $this->db->select($edgeql, $args);

        return $this->model::fromEdgeDBResult($results);
    }

    public function first(): ?object
    {
        $this->limit = 1;
        return $this->get()->first();
    }

    public function count(): int
    {
        $type = class_basename($this->model);
        $edgeql = "SELECT count({$type})";
        $result = $this->db->selectSingle($edgeql);
        return $result ?? 0;
    }
}
```

## GraphQL 直接对接前端

如果你的前端（Vue / React）想直接查询数据库，EdgeDB 的 GraphQL 模式非常方便：

### Laravel 代理层

```php
<?php

namespace App\Http\Controllers;

use App\Services\EdgeDBClient;
use Illuminate\Http\Request;

class GraphQLController extends Controller
{
    public function __invoke(Request $request, EdgeDBClient $db)
    {
        $request->validate([
            'query' => 'required|string',
            'variables' => 'nullable|array',
        ]);

        $result = $db->graphql(
            $request->input('query'),
            $request->input('variables', [])
        );

        return response()->json($result);
    }
}
```

```php
// routes/api.php
Route::post('/graphql', GraphQLController::class);
```

### Vue 前端调用

```typescript
// composables/useEdgeDB.ts
import { ref } from 'vue'

export function useEdgeDB() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function query<T>(query: string, variables?: Record<string, any>): Promise<T> {
    loading.value = true
    error.value = null

    try {
      const response = await fetch('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
      })

      const data = await response.json()

      if (data.errors) {
        throw new Error(data.errors[0].message)
      }

      return data.data as T
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  return { query, loading, error }
}

// 使用
const { query } = useEdgeDB()

const posts = await query(`
  query {
    Post(filter: { status: { eq: published } }, first: 10) {
      title
      slug
      summary
      author { name }
    }
  }
`)
```

## 踩坑记录

### 1. 类型系统严格

EdgeDB 的类型系统比 SQL 严格得多：

```edgeql
# ❌ 错误：类型不匹配
SELECT Post FILTER .view_count > '100';

# ✅ 正确：需要类型转换
SELECT Post FILTER .view_count > <int64>'100';
```

### 2. NULL 处理不同

```edgeql
# EdgeDB 中 optional 字段用 EXISTS 判断
SELECT Post FILTER EXISTS .summary;

# 而不是
SELECT Post FILTER .summary IS NOT NULL;  # ❌ 语法不同
```

### 3. 关联查询的陷阱

```edgeql
# ❌ 这会返回所有有标签的文章，不是"有特定标签的文章"
SELECT Post FILTER EXISTS .tags;

# ✅ 这才是按标签过滤
SELECT Post FILTER .tags.name = 'Laravel';
```

### 4. Migration 冲突处理

当多人协作修改 Schema 时，Migration 可能冲突：

```bash
# 查看当前 migration 状态
edgedb migration log

# 重置到某个版本（开发环境）
edgedb migration revert --to-revision <revision>

# 生产环境建议：先备份再操作
edgedb dump backup.dump
edgedb migrate
```

### 5. 性能注意事项

- **N+1 不存在**：EdgeDB 的查询是声明式的，引擎自动优化 JOIN
- **复杂计算属性慎用**：`count()` 等计算属性在大表上可能慢，建议用缓存
- **批量操作用 UNLESS CONFLICT**：

```edgeql
# 批量插入，冲突时跳过
FOR item IN {json_array_unpack(<json>$items)}
UNION (
  INSERT Tag {
    name := <str>item['name'],
    slug := <str>item['slug']
  }
  UNLESS CONFLICT ON .name
);
```

### 6. 与现有 Laravel Eloquent 共存

不要试图让 EdgeDB 完全替代 Eloquent。推荐策略：

- **新功能用 EdgeDB**：Schema 定义清晰，开发效率高
- **老功能保持 Eloquent**：稳定性优先
- **共享数据用同步任务**：通过 Event + Job 同步关键数据

```php
<?php

namespace App\Listeners;

use App\Events\PostPublished;
use App\Services\EdgeDBClient;

class SyncPostToEdgeDB
{
    public function __construct(private EdgeDBClient $db) {}

    public function handle(PostPublished $event): void
    {
        $post = $event->post;

        // 同步到 EdgeDB
        $this->db->query(<<<'EDGEQL'
            INSERT Post {
                title := <str>$title,
                slug := <str>$slug,
                content := <str>$content,
                status := 'published'
            }
            UNLESS CONFLICT ON .slug
        EDGEQL, [
            'title' => $post->title,
            'slug' => $post->slug,
            'content' => $post->content,
        ]);
    }
}
```

## 总结

### EdgeDB 适合什么场景

- **快速原型**：Schema 定义 → 自动生成 API → 前端直接对接，开发速度飞快
- **GraphQL 优先架构**：不想维护单独的 GraphQL 网关
- **复杂关联查询**：声明式关联比 Eloquent 的 `with()` 更直观
- **新项目尝试**：作为技术储备和探索

### EdgeDB 不适合什么场景

- **已有成熟的 Laravel + MySQL 架构**：迁移成本高，收益有限
- **需要极致性能调优**：EdgeDB 的查询优化不如直接写 SQL 灵活
- **团队不熟悉**：学习曲线存在，EdgeQL 需要适应
- **生态成熟度**：PHP SDK 缺失，社区规模小

### 最终判断

EdgeDB 是一个有野心的产品。它确实解决了"ORM ↔ 数据库 ↔ GraphQL"三者之间的重复映射问题。对于新项目，特别是前后端分离的全栈应用，值得一试。

但对于 KKday 这样的成熟 Laravel 项目，**不建议冒然迁移**。更务实的做法是：

1. 在内部工具或新模块中试点
2. 用 GraphQL 模式为前端提供灵活查询能力
3. 关注 EdgeDB 的 PHP SDK 进展

数据库选型没有银弹，关键是理解每个工具的设计哲学和适用边界。EdgeDB 的"Schema 即代码"理念，即使不直接使用，也能启发我们重新思考 ORM 和 Migration 的设计方式。

---

**参考链接：**
- [EdgeDB 官方文档](https://www.edgedb.com/docs)
- [EdgeQL 语言参考](https://www.edgedb.com/docs/edgeql/index)
- [EdgeDB GitHub](https://github.com/edgedb/edgedb)
- [EdgeDB vs 传统 ORM 对比](https://www.edgedb.com/docs/intro/index)
