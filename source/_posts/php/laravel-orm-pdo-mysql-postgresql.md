---
title: Laravel-ORM-PDO-MySQL-PostgreSQL-行为差异与兼容性实战踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 00:40:36
updated: 2026-05-05 00:43:48
categories:
  - php
  - database
tags: [Laravel, MySQL, PostgreSQL]
keywords: [Laravel, ORM, PDO, MySQL, PostgreSQL, 行为差异与兼容性实战踩坑记录, PHP, 数据库]
description: 在 KKday B2C 同一 Laravel 代码库中同时支持 MySQL 和 PostgreSQL 的真实踩坑记录——从 Eloquent Query Builder 的 SQL 生成差异、PDO 驱动行为、Schema Migration 到类型映射，涵盖大小写敏感、JSON 查询、NULL 语义、事务隔离级别等 10 大常见陷阱与生产级解决方案。



---

# Laravel ORM + PDO：MySQL 与 PostgreSQL 的行为差异与兼容性实战

## 前言

在 KKday B2C 后端项目中，我们面临着一个特殊的架构挑战：**同一个 Laravel 代码库需要同时支持 MySQL 和 PostgreSQL**。主站订单系统跑在 MySQL 8.0 上，而 Affiliate 联盟项目基于 PostgreSQL 14。两个数据库共享同一套 Eloquent Model 层，通过 Service Provider 动态切换连接。

起初我以为"反正都是 SQL，ORM 抹平了差异"——**这是个天真的想法**。上线后踩了无数坑，从大小写敏感性到 JSON 字段查询，从空字符串与 NULL 的语义差异到 PDO prepared statement 的行为区别。这篇文章记录了我们在 30+ 仓库中积累的真实兼容性经验。

---

## 架构概览

```
┌─────────────────────────────────────────────────┐
│              Laravel Application                 │
│  ┌─────────────┐     ┌─────────────────────┐    │
│  │ Eloquent     │     │ Query Builder       │    │
│  │ Model Layer  │────▶│ (shared logic)      │    │
│  └─────────────┘     └─────────┬───────────┘    │
│                                │                 │
│              ┌─────────────────┼──────────────┐  │
│              ▼                 ▼              │  │
│  ┌──────────────┐   ┌──────────────────┐    │  │
│  │ MySQL Driver │   │ PostgreSQL Driver │    │  │
│  │ (pdo_mysql)  │   │ (pdo_pgsql)      │    │  │
│  └──────┬───────┘   └────────┬─────────┘    │  │
│         │                    │               │  │
│         ▼                    ▼               │  │
│  ┌──────────────┐   ┌──────────────────┐    │  │
│  │  MySQL 8.0   │   │ PostgreSQL 14    │    │  │
│  │ (主站订单)    │   │ (Affiliate联盟)  │    │  │
│  └──────────────┘   └──────────────────┘    │  │
└─────────────────────────────────────────────────┘
```

**config/database.php** 的关键配置：

```php
// config/database.php
'connections' => [
    'mysql' => [
        'driver' => 'mysql',
        'host' => env('DB_MYSQL_HOST', '127.0.0.1'),
        'port' => env('DB_MYSQL_PORT', '3306'),
        'database' => env('DB_MYSQL_DATABASE', 'kkday_b2c'),
        'username' => env('DB_MYSQL_USERNAME', 'root'),
        'password' => env('DB_MYSQL_PASSWORD', ''),
        'charset' => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci',
        'prefix_indexes' => true,
        'strict' => true,
        'engine' => 'InnoDB',
    ],
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_PGSQL_HOST', '127.0.0.1'),
        'port' => env('DB_PGSQL_PORT', '5432'),
        'database' => env('DB_PGSQL_DATABASE', 'kkday_affiliate'),
        'username' => env('DB_PGSQL_USERNAME', 'postgres'),
        'password' => env('DB_PGSQL_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'prefix_indexes' => true,
        'search_path' => 'public',
        'sslmode' => 'prefer',
    ],
],
```

---

## 踩坑 1：大小写敏感性——最容易"翻车"的差异

### 问题描述

MySQL 的默认 collation（如 `utf8mb4_unicode_ci`）是**大小写不敏感**的，而 PostgreSQL 的字符串比较是**大小写敏感**的。

```php
// MySQL：这条能查到结果
User::where('email', 'Mike@KKday.com')->first(); 
// → SELECT * FROM users WHERE email = 'Mike@KKday.com'
// → 命中 mike@kkday.com ✅（ci = case insensitive）

// PostgreSQL：查不到！
User::on('pgsql')->where('email', 'Mike@KKday.com')->first();
// → SELECT * FROM users WHERE email = 'Mike@KKday.com'
// → NULL ❌（PostgreSQL 严格区分大小写）
```

### 解决方案

我们创建了一个 `CaseInsensitiveQuery` Trait，在 Model 层统一处理：

```php
<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;

trait CaseInsensitiveQuery
{
    /**
     * 需要大小写不敏感查询的字段列表
     */
    protected array $caseInsensitiveFields = ['email', 'name', 'phone'];

    /**
     * 重写 where 方法，对特定字段使用 ILIKE（PostgreSQL）或保持原样（MySQL）
     */
    public function scopeWhereCi(Builder $query, string $column, mixed $value): Builder
    {
        $connection = $this->getConnectionName();

        if ($connection === 'pgsql' && in_array($column, $this->caseInsensitiveFields)) {
            // PostgreSQL 使用 ILIKE 做大小写不敏感匹配
            return $query->whereRaw('LOWER(?) = LOWER(?)', [$column, $value]);
        }

        // MySQL 默认就是不敏感的，直接 where
        return $query->where($column, $value);
    }

    /**
     * 全文搜索时的大小写处理
     */
    public function scopeSearchInsensitive(Builder $query, string $column, string $keyword): Builder
    {
        $connection = $this->getConnectionName();

        if ($connection === 'pgsql') {
            return $query->where($column, 'ILIKE', "%{$keyword}%");
        }

        return $query->where($column, 'LIKE', "%{$keyword}%");
    }
}
```

**使用方式：**

```php
// 统一调用，底层自动适配数据库
$user = User::whereCi('email', $request->input('email'))->first();
$products = Product::searchInsensitive('title', $keyword)->paginate(20);
```

---

## 踩坑 2：引号与标识符转义——SQL 注入的"隐形杀手"

### 问题描述

MySQL 使用**反引号** `` ` `` 转义标识符，PostgreSQL 使用**双引号** `"`：

```sql
-- MySQL：反引号
SELECT `order_id`, `status` FROM `orders` WHERE `user_id` = 1;

-- PostgreSQL：双引号
SELECT "order_id", "status" FROM "orders" WHERE "user_id" = 1;
```

当你在 `whereRaw()` 或 `selectRaw()` 中硬编码反引号时，PostgreSQL 会直接报错：

```php
// ❌ 这在 PostgreSQL 下会报错
DB::connection('pgsql')
    ->table('orders')
    ->whereRaw("`status` = ?", ['paid'])
    ->get();
// SQLSTATE[42601]: Syntax error: ERROR: syntax error at or near "`"
```

### 解决方案

我们封装了一个 `GrammarHelper` 工具类：

```php
<?php

namespace App\Support\Database;

use Illuminate\Support\Facades\DB;

class GrammarHelper
{
    /**
     * 获取当前连接对应的标识符包装字符
     */
    public static function getIdentifierWrapper(string $connection = null): array
    {
        $driver = config("database.connections.{$connection}.driver")
            ?? config('database.default');

        return match ($driver) {
            'mysql'      => ['`', '`'],
            'pgsql'      => ['"', '"'],
            'sqlsrv'     => ['[', ']'],
            default      => ['`', '`'],
        };
    }

    /**
     * 安全地包装标识符
     */
    public static function wrapIdentifier(string $column, string $connection = null): string
    {
        [$left, $right] = self::getIdentifierWrapper($connection);
        return $left . str_replace($left, '', $column) . $right;
    }

    /**
     * 生成跨数据库兼容的 raw SQL
     * 替换所有 `{column}` 为正确包装的标识符
     */
    public static function compatibleRaw(string $sql, array $bindings = [], string $connection = null): array
    {
        [$left, $right] = self::getIdentifierWrapper($connection);
        $sql = preg_replace('/`([^`]+)`/', "{$left}$1{$right}", $sql);
        return [$sql, $bindings];
    }
}
```

**最佳实践：尽量避免 `whereRaw()`，用 Query Builder 的方法：**

```php
// ✅ 推荐：Query Builder 自动处理引号差异
Order::on('pgsql')
    ->where('status', 'paid')
    ->where('total_amount', '>', 100)
    ->get();

// ✅ 必须用 raw 时，用参数绑定，不硬编码标识符
Order::on('pgsql')
    ->whereRaw('LOWER(status) = ?', ['paid'])
    ->get();
```

---

## 踩坑 3：NULL 与空字符串的语义差异

### 问题描述

这是最容易被忽视的差异。MySQL 在某些模式下（`sql_mode` 不含 `CONCAT_NULL_YIELDS_NULL`）会把 NULL 当空字符串处理，而 PostgreSQL 对 NULL 的处理非常严格：

```php
// 假设数据库中 nick_name 字段值为 NULL

// MySQL（非严格模式下）
$row = DB::connection('mysql')
    ->table('users')
    ->selectRaw("CONCAT(nick_name, '-suffix') as result")
    ->first();
// result = '-suffix' （NULL 被当作空字符串拼接）

// PostgreSQL
$row = DB::connection('pgsql')
    ->table('users')
    ->selectRaw("nick_name || '-suffix' as result")
    ->first();
// result = NULL （NULL 参与任何运算 → 结果都是 NULL）
```

### Eloquent 中的 NULL 差异

```php
// MySQL：空字符串 '' ≠ NULL，但查询行为可能让人困惑
User::where('bio', '')->get();       // 返回 bio = '' 的记录
User::whereNull('bio')->get();       // 返回 bio IS NULL 的记录
User::where('bio', null)->get();     // ⚠️ Laravel 生成 WHERE bio IS NULL

// PostgreSQL：行为一致，但 NULL 排序不同
// MySQL: ORDER BY col ASC → NULL 排在最前面
// PostgreSQL: ORDER BY col ASC → NULL 排在最后面
```

### 解决方案

```php
<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;

trait NullSafeQuery
{
    /**
     * 安全的字符串拼接——兼容 MySQL 和 PostgreSQL 的 NULL 处理
     */
    public function scopeSelectConcatSafe(
        Builder $query,
        array $columns,
        string $separator = '',
        string $alias = 'concat_result'
    ): Builder {
        $connection = $this->getConnectionName();
        $driver = config("database.connections.{$connection}.driver");

        if ($driver === 'pgsql') {
            // PostgreSQL: 使用 COALESCE + || 拼接
            $parts = array_map(
                fn($col) => "COALESCE({$col}::text, '')",
                $columns
            );
            $expr = implode(" || '{$separator}' || ", $parts);
        } else {
            // MySQL: 使用 CONCAT + IFNULL
            $parts = array_map(
                fn($col) => "IFNULL({$col}, '')",
                $columns
            );
            $expr = "CONCAT(" . implode(", '{$separator}', ", $parts) . ")";
        }

        return $query->selectRaw("({$expr}) as {$alias}");
    }
}
```

---

## 踩坑 4：JSON 字段查询——Eloquent 的 `whereJsonContains` 差异

### 问题描述

Laravel 的 `whereJsonContains()` 在 MySQL 和 PostgreSQL 上生成的 SQL 完全不同：

```php
// 查询 tags JSON 数组中包含 'travel' 的记录
Product::whereJsonContains('tags', 'travel')->get();
```

**MySQL 生成的 SQL：**
```sql
SELECT * FROM products WHERE JSON_CONTAINS(tags, '"travel"');
```

**PostgreSQL 生成的 SQL：**
```sql
SELECT * FROM products WHERE tags @> '"travel"'::jsonb;
```

这本身没问题，但有几个隐藏的坑：

```php
// 坑 1：whereJsonContains 的嵌套路径
Product::whereJsonContains('metadata->tags', 'travel')->get();

// MySQL ✅ 正常
// PostgreSQL ❌ 在某些版本中，嵌套路径的行为不一致

// 坑 2：whereJsonLength
Product::whereJsonLength('tags', '>', 3)->get();

// MySQL: JSON_LENGTH(tags) > 3
// PostgreSQL: jsonb_array_length(tags) > 3
// 两者都能工作，但性能差异大——PostgreSQL 可以用 GIN 索引
```

### 解决方案

```php
<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;

trait JsonQueryCompatible
{
    /**
     * 兼容的 JSON 数组包含查询
     */
    public function scopeWhereJsonContainsSafe(
        Builder $query,
        string $column,
        mixed $value,
        string $boolean = 'and'
    ): Builder {
        $connection = $this->getConnectionName();
        $driver = config("database.connections.{$connection}.driver");

        if ($driver === 'pgsql') {
            // PostgreSQL: 使用 @> 操作符 + GIN 索引友好
            $jsonValue = is_string($value) ? "\"{$value}\"" : json_encode($value);
            return $query->whereRaw(
                "?::jsonb @> ?::jsonb",
                [$column, $jsonValue],
                $boolean
            );
        }

        // MySQL: 使用原生 whereJsonContains
        return $query->whereJsonContains($column, $value, $boolean);
    }

    /**
     * 兼容的 JSON 键值存在检查
     */
    public function scopeWhereJsonHasKeySafe(
        Builder $query,
        string $column,
        string $key,
        string $boolean = 'and'
    ): Builder {
        $connection = $this->getConnectionName();
        $driver = config("database.connections.{$connection}.driver");

        if ($driver === 'pgsql') {
            return $query->whereRaw(
                "?::jsonb ? ?",
                [$column, '?', $key],
                $boolean
            );
        }

        return $query->whereJsonContains($column, $key, $boolean);
    }
}
```

---

## 踩坑 5：PDO Prepared Statement 的行为差异

### 问题描述

这是最隐蔽的坑。PDO 在 MySQL 和 PostgreSQL 上对 prepared statement 的实现有本质区别：

```php
// 场景：动态表名查询（虽然不推荐，但遗留代码中很常见）

// MySQL：表名可以用 ? 占位符（虽然不安全）
DB::connection('mysql')
    ->select("SELECT * FROM ? WHERE id = ?", ['orders', 1]);
// MySQL PDO: 能执行（把表名当字符串处理，恰好能工作）

// PostgreSQL：直接报错！
DB::connection('pgsql')
    ->select("SELECT * FROM ? WHERE id = ?", ['orders', 1]);
// SQLSTATE[42601]: Syntax error
// PostgreSQL 不允许用参数绑定来传递标识符（表名、列名）
```

### 还有 emulated prepared statement 的差异

```php
// config/database.php 中的 PDO 属性
'mysql' => [
    'options' => [
        // MySQL 默认开启 emulate prepares（模拟预处理）
        PDO::ATTR_EMULATE_PREPARES => true,
    ],
],

'pgsql' => [
    'options' => [
        // PostgreSQL 默认使用真正的 prepared statements
        PDO::ATTR_EMULATE_PREPARES => false,
    ],
],
```

这意味着：

```php
// MySQL（emulated）：同一个 statement 可以用不同类型的参数
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute(['123']);  // 字符串 '123' 也能匹配 int id

// PostgreSQL（native）：严格类型检查
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute(['123']);  // 如果 id 是 INTEGER 类型，可能需要类型转换
```

### 解决方案

```php
<?php

namespace App\Support\Database;

use Illuminate\Support\Facades\DB;
use PDO;

class PdoCompatibility
{
    /**
     * 安全的跨数据库 raw query
     * 动态部分用字符串拼接（已经白名单过滤），参数部分用 binding
     */
    public static function safeRawQuery(
        string $connection,
        string $table,
        array $conditions,
        array $selectColumns = ['*']
    ): array {
        $driver = config("database.connections.{$connection}.driver");

        // 表名和列名必须白名单验证，不能用参数绑定
        if (!preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $table)) {
            throw new \InvalidArgumentException("Invalid table name: {$table}");
        }

        $columns = implode(', ', array_map(function ($col) {
            if (!preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $col)) {
                throw new \InvalidArgumentException("Invalid column name: {$col}");
            }
            return $col;
        }, $selectColumns));

        $whereClauses = [];
        $bindings = [];

        foreach ($conditions as $column => $value) {
            if (!preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $column)) {
                throw new \InvalidArgumentException("Invalid column name: {$column}");
            }
            $whereClauses[] = "{$column} = ?";
            $bindings[] = $value;
        }

        $where = $whereClauses ? 'WHERE ' . implode(' AND ', $whereClauses) : '';
        $sql = "SELECT {$columns} FROM {$table} {$where}";

        return DB::connection($connection)->select($sql, $bindings);
    }
}
```

---

## 踩坑 6：Migration 和 Schema 的差异

### AUTO_INCREMENT vs SERIAL

```php
// MySQL 的自增主键
Schema::create('orders', function (Blueprint $table) {
    $table->id();                    // BIGINT UNSIGNED AUTO_INCREMENT
    $table->string('order_no')->unique();
    $table->timestamps();
});

// PostgreSQL 的自增主键——$table->id() 在 pgsql 下生成的是：
// BIGINT GENERATED BY DEFAULT AS IDENTITY（PostgreSQL 10+）
// 这是兼容的 ✅

// 但如果你用 $table->increments()：
// MySQL: INT UNSIGNED AUTO_INCREMENT
// PostgreSQL: SERIAL（实际上是 SEQUENCE + INT）
// ⚠️ 区别：PostgreSQL 的 SERIAL 列，插入时如果显式指定值，SEQUENCE 不会更新！
```

```php
// 踩坑实录：PostgreSQL 中显式插入 id 后，下次自动插入会冲突
DB::connection('pgsql')->table('products')->insert([
    'id' => 100,
    'name' => 'Test Product',
]);

// 下次 auto insert:
DB::connection('pgsql')->table('products')->insert([
    'name' => 'Auto Product',
]);
// ❌ ERROR: duplicate key value violates unique constraint "products_pkey"
// 因为 SEQUENCE 还停留在原来的值，不知道你手动插入了 100
```

**修复方式：**

```php
// PostgreSQL：插入显式 id 后，重置 sequence
DB::connection('pgsql')->statement(
    "SELECT setval(pg_get_serial_sequence('products', 'id'), 
     (SELECT MAX(id) FROM products))"
);
```

### ENUM 类型的差异

```php
// MySQL 支持原生 ENUM
$table->enum('status', ['pending', 'paid', 'shipped', 'cancelled']);

// PostgreSQL 14+ 没有原生 ENUM 列（有 ENUM TYPE，但用法不同）
// Laravel 在 pgsql 下会用 VARCHAR + CHECK 约束替代
// 生成的 SQL 类似：
// status VARCHAR(255) CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled'))
```

**我们的做法：统一用 VARCHAR + Application 层 Enum（PHP 8.1 Enum）：**

```php
<?php

namespace App\Enums;

enum OrderStatus: string
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Shipped = 'shipped';
    case Cancelled = 'cancelled';
}

// Migration：不用 enum()，用 string() + PHP Enum 校验
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->string('status', 20)->default('pending')->index();
    // 不用 $table->enum()，避免 MySQL/PostgreSQL 行为差异
});

// Model 中用 cast
class Order extends Model
{
    protected $casts = [
        'status' => OrderStatus::class,
    ];
}

// 创建时自动校验
Order::create([
    'status' => OrderStatus::Paid,  // ✅ 自动转为 'paid' 字符串
]);
```

---

## 踩坑 7：LIKE 查询与索引的差异

```php
// MySQL：LIKE '%keyword%' 在 utf8mb4_unicode_ci 下不区分大小写
Product::where('name', 'LIKE', '%hotel%')->get();
// → 可以命中索引（如果使用前缀匹配 'hotel%'）

// PostgreSQL：LIKE '%keyword%' 是大小写敏感的！
Product::on('pgsql')->where('name', 'LIKE', '%hotel%')->get();
// → 只匹配小写的 'hotel'，不匹配 'Hotel' 或 'HOTEL'

// PostgreSQL 需要用 ILIKE
Product::on('pgsql')->where('name', 'ILIKE', '%hotel%')->get();
// → 大小写不敏感，但 ILIKE 无法使用普通 B-tree 索引！
```

**生产级解决方案——使用 pg_trgm 扩展 + GIN 索引：**

```sql
-- PostgreSQL: 安装 pg_trgm 扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建 GIN 索引
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

-- 现在 ILIKE 可以走索引了
EXPLAIN ANALYZE SELECT * FROM products WHERE name ILIKE '%hotel%';
-- → Bitmap Index Scan on idx_products_name_trgm ✅
```

```php
// Laravel Migration 中创建 pg_trgm 索引
public function up()
{
    $connection = config('database.default');

    if ($connection === 'pgsql') {
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        Schema::table('products', function (Blueprint $table) {
            DB::statement('CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops)');
        });
    } else {
        Schema::table('products', function (Blueprint $table) {
            $table->index('name');
        });
    }
}
```

---

## 踩坑 8：事务隔离级别的隐式差异

```php
// Laravel 默认事务隔离级别
// MySQL: REPEATABLE READ（InnoDB 默认）
// PostgreSQL: READ COMMITTED（默认）

// 这会导致"幻读"行为不一致：

// MySQL (REPEATABLE READ):
DB::transaction(function () {
    $count1 = Order::where('status', 'paid')->count(); // 10
    // 另一个事务插入了一条 paid 订单并提交
    $count2 = Order::where('status', 'paid')->count(); // 仍然是 10！
    // REPEATABLE READ 保证了快照一致性
});

// PostgreSQL (READ COMMITTED):
DB::connection('pgsql')->transaction(function () {
    $count1 = Order::where('status', 'paid')->count(); // 10
    // 另一个事务插入了一条 paid 订单并提交
    $count2 = Order::where('status', 'paid')->count(); // 11！
    // READ COMMITTED 每次 SELECT 都能看到最新已提交的数据
});
```

**统一行为的方案：**

```php
// 如果需要跨数据库一致的事务行为，显式设置隔离级别
// config/database.php
'pgsql' => [
    // ...
    'options' => [
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_OBJ,
    ],
],

// 在关键事务中显式设置
DB::connection('pgsql')->statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
DB::connection('pgsql')->transaction(function () {
    // 现在行为和 MySQL 一致了
});
```

---

## 踩坑 9：日期时间函数的差异

```php
// MySQL: DATE_FORMAT / NOW() / UNIX_TIMESTAMP()
Order::selectRaw("DATE_FORMAT(created_at, '%Y-%m-%d') as date")
    ->groupBy('date')
    ->get();

// PostgreSQL: TO_CHAR / NOW() / EXTRACT(EPOCH FROM ...)
Order::on('pgsql')
    ->selectRaw("TO_CHAR(created_at, 'YYYY-MM-DD') as date")
    ->groupBy('date')
    ->get();

// ❌ 如果直接用 DATE_FORMAT 在 PostgreSQL 上会报错！
```

**封装兼容的日期函数：**

```php
<?php

namespace App\Support\Database;

class DateExpression
{
    /**
     * 兼容的日期格式化
     */
    public static function dateFormat(string $column, string $format): string
    {
        $driver = config('database.connections.' . config('database.default') . '.driver');

        if ($driver === 'pgsql') {
            $pgFormat = self::phpToPgFormat($format);
            return "TO_CHAR({$column}, '{$pgFormat}')";
        }

        return "DATE_FORMAT({$column}, '{$format}')";
    }

    /**
     * 兼容的时间戳提取
     */
    public static function unixTimestamp(string $column): string
    {
        $driver = config('database.connections.' . config('database.default') . '.driver');

        if ($driver === 'pgsql') {
            return "EXTRACT(EPOCH FROM {$column})";
        }

        return "UNIX_TIMESTAMP({$column})";
    }

    /**
     * PHP date format → PostgreSQL format 转换
     */
    private static function phpToPgFormat(string $format): string
    {
        return str_replace(
            ['Y', 'm', 'd', 'H', 'i', 's'],
            ['YYYY', 'MM', 'DD', 'HH24', 'MI', 'SS'],
            $format
        );
    }
}
```

---

## 踩坑 10：批量插入与 ON DUPLICATE KEY / ON CONFLICT

```php
// MySQL: INSERT ... ON DUPLICATE KEY UPDATE
DB::table('product_stats')->upsert(
    [
        ['product_id' => 1, 'view_count' => 100, 'date' => '2026-05-05'],
        ['product_id' => 2, 'view_count' => 200, 'date' => '2026-05-05'],
    ],
    ['product_id', 'date'],           // unique columns
    ['view_count']                     // columns to update
);
// MySQL: INSERT ... ON DUPLICATE KEY UPDATE view_count = VALUES(view_count)

// PostgreSQL: INSERT ... ON CONFLICT DO UPDATE SET
// Laravel 的 upsert() 在两个数据库上都支持 ✅
// ⚠️ 但 PostgreSQL 版本需要注意冲突目标必须有唯一约束或索引
```

```php
// ⚠️ PostgreSQL 踩坑：ON CONFLICT 需要显式指定冲突目标
// 如果你的唯一约束名不是默认格式，需要显式指定

// Migration 中确保两个数据库都有正确的唯一约束
Schema::table('product_stats', function (Blueprint $table) {
    $table->unique(['product_id', 'date'], 'uq_product_stats_product_date');
    // 显式命名约束，两个数据库行为一致
});
```

---

## 跨数据库兼容性的最佳实践总结

### 1. 使用 Repository Pattern 隔离数据库差异

```php
<?php

namespace App\Repositories;

interface OrderRepositoryInterface
{
    public function findByOrderNo(string $orderNo): ?Order;
    public function getDailyStats(string $date): array;
}

// MySQL 实现
class MySQLOrderRepository implements OrderRepositoryInterface
{
    public function findByOrderNo(string $orderNo): ?Order
    {
        return Order::where('order_no', $orderNo)->first();
    }

    public function getDailyStats(string $date): array
    {
        return Order::selectRaw("DATE(created_at) as date, COUNT(*) as total")
            ->whereDate('created_at', $date)
            ->groupBy('date')
            ->get()
            ->toArray();
    }
}

// PostgreSQL 实现
class PgSQLOrderRepository implements OrderRepositoryInterface
{
    public function getDailyStats(string $date): array
    {
        return Order::on('pgsql')
            ->selectRaw("DATE(created_at) as date, COUNT(*) as total")
            ->whereDate('created_at', $date)
            ->groupBy('date')
            ->get()
            ->toArray();
    }
}
```

### 2. CI/CD 中同时跑两个数据库的测试

```yaml
# .github/workflows/test.yml
jobs:
  test-mysql:
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: secret
          MYSQL_DATABASE: kkday_test
    steps:
      - uses: actions/checkout@v4
      - run: vendor/bin/pest --configuration phpunit.mysql.xml

  test-pgsql:
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: secret
          POSTGRES_DB: kkday_test
    steps:
      - uses: actions/checkout@v4
      - run: vendor/bin/pest --configuration phpunit.pgsql.xml
```

### 3. 关键对照表

```
┌──────────────────────┬─────────────────────┬──────────────────────────┐
│ 场景                  │ MySQL               │ PostgreSQL               │
├──────────────────────┼─────────────────────┼──────────────────────────┤
│ 大小写敏感            │ 不敏感（默认ci）      │ 敏感（需 ILIKE）         │
│ 标识符转义            │ 反引号 `             │ 双引号 "                 │
│ NULL + 字符串拼接     │ NULL → ''           │ 结果为 NULL              │
│ LIKE 查询索引         │ 前缀匹配可走索引      │ 需 pg_trgm + GIN 索引   │
│ 事务默认隔离级别      │ REPEATABLE READ     │ READ COMMITTED           │
│ JSON 操作             │ JSON_CONTAINS       │ @> (jsonb)               │
│ 自增主键              │ AUTO_INCREMENT      │ IDENTITY / SEQUENCE      │
│ ENUM 列              │ 原生支持             │ ENUM TYPE 或 CHECK       │
│ 日期格式化            │ DATE_FORMAT()       │ TO_CHAR()                │
│ UPSERT               │ ON DUPLICATE KEY    │ ON CONFLICT              │
│ 默认排序中 NULL 位置   │ 最前               │ 最后                     │
│ 引擎/存储             │ InnoDB              │ heap + TOAST             │
└──────────────────────┴─────────────────────┴──────────────────────────┘
```

## Eloquent 常见方法行为对照表

以下表格汇总了 Eloquent 常用方法在 MySQL 与 PostgreSQL 下的行为差异，方便快速查阅：

| Eloquent / Query Builder 方法 | MySQL 生成的 SQL | PostgreSQL 生成的 SQL | 常见陷阱 |
|---|---|---|---|
| `where('name', 'Hotel')` | `WHERE name = 'Hotel'`（不区分大小写） | `WHERE name = 'Hotel'`（严格区分大小写） | PG 下可能查不到预期结果 |
| `where('name', 'LIKE', '%hotel%')` | `LIKE '%hotel%'`（ci） | `LIKE '%hotel%'`（cs） | PG 需改用 `ILIKE` |
| `whereNull('deleted_at')` | `WHERE deleted_at IS NULL` | `WHERE deleted_at IS NULL` | 行为一致，但 NULL 排序相反 |
| `where('amount', '!=', 0)` | 排除 0 和 NULL | 只排除 0，保留 NULL 行 | PG 下可能返回意外的 NULL 行 |
| `whereJsonContains('tags', 'a')` | `JSON_CONTAINS(tags, '"a"')` | `tags @> '"a"'::jsonb` | 嵌套路径在 PG 某些版本不一致 |
| `whereJsonLength('tags', '>', 3)` | `JSON_LENGTH(tags) > 3` | `jsonb_array_length(tags) > 3` | PG 可用 GIN 索引加速 |
| `upsert([...], ['id'], ['val'])` | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE SET` | PG 要求冲突目标有唯一约束 |
| `selectRaw("CONCAT(a, b)")` | 正常工作 | 报错：`CONCAT` 不存在 | PG 需用 `\|\|` 运算符 |
| `->groupBy('date')->orderBy('date')` | NULL 排最前 | NULL 排最后 | 排序结果不一致 |
| `DB::raw("NOW()")` | `NOW()` | `NOW()` | 行为一致，但时区处理可能不同 |
| `chunkById(1000)` | `WHERE id > ? ORDER BY id` | 同左 | 行为一致 ✅ |
| `lockForUpdate()` | `FOR UPDATE` | `FOR UPDATE` | PG 下必须在事务中使用 |

> **提示**：在双数据库场景下，建议对所有 `where()` 查询中涉及用户输入的字段统一使用 `scopeWhereCi()` 包装，避免大小写敏感问题在线上悄然出现。

---

## 结语

在同一个 Laravel 代码库中支持 MySQL 和 PostgreSQL 并不是一件轻松的事。ORM 确实帮我们抹平了大部分差异，但在以下场景中仍然需要格外小心：

1. **Raw SQL**：`selectRaw()`、`whereRaw()`、`DB::select()` 等直接写 SQL 的地方
2. **JSON 字段操作**：嵌套路径、数组包含、长度查询等
3. **大小写处理**：搜索、登录、邮箱匹配等用户输入场景
4. **NULL 语义**：拼接、聚合、排序等涉及 NULL 的计算
5. **Migration 中的数据库特有语法**：ENUM、索引类型、自增策略等

我们的经验是：**尽量用 Query Builder 的抽象方法，少写 Raw SQL；需要写 Raw SQL 时，封装兼容层；CI/CD 中同时跑两个数据库的测试。** 这三板斧让我们在 30+ 仓库中保持了代码的数据库无关性。

> 💡 **最终建议**：如果你的项目不需要同时支持两种数据库，**就不要主动做兼容**。选择最适合业务场景的数据库，充分利用其特性（PostgreSQL 的 JSONB、全文搜索、RLS；MySQL 的全文索引、内存表等）。过度抽象反而会让代码变得难以维护。

---

## 相关阅读

- [Laravel + PgBouncer 连接池实战：PostgreSQL 连接风暴治理](/categories/php/Laravel/laravel-pgbouncer-guide-postgresql-transaction-prepared-statement/)
- [Laravel + PostgreSQL 分区表实战：订单流水月分区、分区裁剪与冷热归档踩坑记录](/categories/php/Laravel/laravel-postgresql-guide/)
- [数据库索引优化实战-覆盖索引联合索引与索引下推](/categories/databases/index-optimization-explain/)
