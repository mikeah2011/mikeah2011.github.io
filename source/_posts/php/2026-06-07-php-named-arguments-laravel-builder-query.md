---
title: PHP Named Arguments 深度实战：API 设计的可读性革命——Laravel Builder/Query 的命名参数重构案例
date: 2026-06-07 08:00:00
tags:
- PHP
- Named Arguments
- Laravel
- API设计
- 代码可读性
categories:
- php
cover: /images/covers/php-named-arguments-cover.jpg
description: 深入探讨 PHP 8.0 Named Arguments 命名参数在 Laravel Builder/Query 查询构建器中的实战应用。通过
  where、join、paginate 等数十个真实代码案例，对比传统位置传参与命名参数的可读性差异，解决布尔参数语义模糊、参数顺序记忆负担、跳过默认值参数等痛点，涵盖
  Macro 自定义 API 设计、Repository 模式、枚举类型协同、渐进式迁移策略与性能分析，为 Laravel 开发者提供完整可落地的代码可读性提升方案。
---



# PHP Named Arguments 深度实战：API 设计的可读性革命——Laravel Builder/Query 的命名参数重构案例

## 引言：从一个令人困惑的调用说起

在日常 Laravel 开发中，你是否曾经遇到过这样的场景？深夜排查线上问题，眼睛布满血丝地盯着屏幕上的查询构建器代码，试图理解某个方法调用中最后一个 `true` 参数到底代表什么含义。你不得不翻开 IDE 跳转到方法定义，或者打开浏览器查找文档，甚至在某些极端情况下直接阅读框架源码才能确认一个布尔参数的语义。

```php
// 这行代码到底在干什么？第四个参数 true 是什么意思？
$builder->whereBetween('created_at', [$start, $end], 'and', true);
```

这种痛苦并非个例。在 PHP 社区长达二十余年的演进历程中，函数参数的设计一直受到位置传递机制的制约。参数顺序的记忆负担、布尔参数的语义模糊、以及大量可选参数之间的"占位陷阱"，长期困扰着无数开发者。当我们编写 `str_replace('world', 'PHP', 'Hello world')` 时，几乎每个人都要在脑海中快速闪过一个念头：第一个参数是搜索值还是替换值？第二个参数呢？

PHP 8.0 引入的 **Named Arguments（命名参数）** 特性，从根本上改变了这一局面。它不仅仅是语法糖，更是一种 API 设计哲学的转变——让代码自文档化，让调用者的意图对任何阅读代码的人完全透明。命名参数允许开发者在调用函数时通过参数名称而非位置来传递值，这意味着即使面对拥有十几个参数的复杂方法，代码阅读者也能在不查阅文档的情况下理解每个参数的用途。

本文将深入探讨 Named Arguments 在 Laravel 框架的 Builder/Query 系统中的实战应用。Laravel 作为 PHP 生态中最流行的框架之一，其查询构建器拥有大量参数密集型方法，是展示命名参数价值的绝佳场景。我们将通过真实的代码案例，展示如何利用这一特性重构 API 设计，从而实现真正意义上的可读性革命。

---

## 一、Named Arguments 核心语法与机制

### 1.1 基础语法详解

命名参数的核心语法极其简洁——在参数名后加上冒号，然后接参数值。这里冒号的使用方式与数组键值对的语法类似，但语义完全不同：冒号左边的不是字符串键，而是方法签名中声明的参数名称。

```php
// 传统方式：按位置传参
str_replace('world', 'PHP', 'Hello world');

// 命名参数方式：按名称传参
str_replace(
    search: 'world',
    replace: 'PHP',
    subject: 'Hello world'
);
```

这两种调用方式产生的结果完全一致，但第二种方式的可读性有了质的飞跃。任何阅读代码的人都不需要查阅 `str_replace` 的文档就能理解：我们正在将字符串 `'Hello world'` 中的 `'world'` 替换为 `'PHP'`。

### 1.2 核心特性深入

命名参数具备几个重要特性，理解这些特性对于正确使用它至关重要：

**跳过默认值参数的能力**——这是命名参数最实用的特性之一。在传统的位置传参中，如果你想使用某个靠后参数的非默认值，必须显式传递前面所有参数的值（即使你想使用它们的默认值）。命名参数彻底解决了这个问题：

```php
// 传统方式：想设置 double_encode 为 false，必须传中间的参数
htmlspecialchars($string, ENT_QUOTES, 'UTF-8', false);

// 命名参数：直接跳过中间的默认值参数
htmlspecialchars($string, double_encode: false);
```

在 Laravel 的查询构建器中，这种能力尤其有价值。`whereNull` 方法有三个参数，其中第二个参数 `$boolean` 的默认值是 `'and'`，第三个参数 `$not` 的默认值是 `false`。如果我们想查询 `IS NOT NULL` 条件，在传统方式下必须同时传递布尔连接符，而在命名参数方式下可以直接跳过：

```php
// 传统方式：必须传递中间参数
$query->whereNull('email_verified_at', 'and', true);

// 命名参数：意图一目了然
$query->whereNull(column: 'email_verified_at', not: true);
```

**参数顺序自由调整**——命名参数打破了位置传递的顺序约束，让开发者可以按照自己的逻辑组织参数的传递顺序。通常我们会把最重要的参数放在前面，把配置性参数放在后面，这种组织方式更符合人类的思维习惯：

```php
// 可以按照重要性组织参数顺序
array_filter(
    callback: fn($v) => $v > 0,
    array: $numbers,
    mode: ARRAY_FILTER_USE_BOTH
);
```

**与可变参数的配合**——当函数使用 `...` 接收可变参数时，命名参数可以让每个值的含义更加清晰：

```php
function createConnection(string $driver, string ...$options) {}

createConnection(
    driver: 'mysql',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci'
);
```

### 1.3 PHP 8.0 之前的历史困境

在命名参数诞生之前，PHP 社区尝试过多种方案来缓解参数可读性问题。最常见的是"参数数组"模式——将所有配置项封装到一个关联数组中传递。这种模式在 Laravel 的早期版本中非常普遍：

```php
// 旧式数组参数模式
$query->where(['column' => 'status', 'operator' => '=', 'value' => 'active']);
```

这种方案虽然解决了命名的问题，但引入了新的问题：失去了类型检查能力，无法利用 IDE 的自动补全，参数名称变成了容易拼错的字符串，而且在运行时之前无法发现参数名的拼写错误。命名参数则不同，它是语言层面的特性，完全支持类型检查和 IDE 智能提示。

另一个常见的做法是使用 PHPDoc 注释来标注参数含义。这种方案的缺陷在于，注释会随着代码的演进而过时——开发者修改了函数签名却忘记更新注释，导致注释与实际行为不一致，反而造成误导。命名参数则没有这个问题，因为参数名称就是函数签名的一部分，永远不会与实现脱节。

### 1.4 为什么 Laravel 是最佳试验场

Laravel 框架的设计哲学本身就追求表达力和可读性，其标志性的流畅接口（Fluent Interface）和链式调用（Method Chaining）模式让查询构建器的代码读起来几乎像自然语言。然而，即使在如此注重可读性的框架中，参数语义的模糊性问题依然存在。其查询构建器系统拥有大量参数密集型方法，是命名参数的天然应用场景：

- `where()` 系列方法：包含列名、运算符、值、布尔连接符、是否取反等多个参数
- `orderBy()` 系列方法：包含列名、排序方向、空值处理策略等参数
- `join()` 系列方法：包含表名、连接条件、比较运算符、连接类型等参数
- `select()` / `with()` / `chunk()` 等方法：各自包含多种可选配置参数

正是这些参数密集型方法，让我们能够充分展示命名参数在提升代码可读性方面的巨大潜力。

---

## 二、Laravel Builder 中的参数痛点深度分析

### 2.1 布尔参数的"语义地狱"

布尔参数是 API 设计中最常见的可读性杀手。在 Laravel 的查询构建器中，大量方法使用布尔参数来控制行为的细微差别，但调用代码中的 `true` 和 `false` 完全无法传达其意图：

```php
// 传统调用——这些 true/false 分别代表什么？
$users = DB::table('users')
    ->where('active', true)                    // 这里的 true 是查询值，不是布尔开关
    ->whereNull('deleted_at', 'and', true)     // 第三个 true 表示 NOT NULL
    ->whereBetween('age', [18, 65], 'and')     // 'and' 还是 'or'？
    ->distinct()                               // 无参数，没问题
    ->limit(10)
    ->get();
```

`whereNull('deleted_at', 'and', true)` 这行代码中，第二个参数 `'and'` 是布尔连接符，第三个参数 `true` 表示取反（即生成 `IS NOT NULL` 条件而非 `IS NULL`）。但如果不看文档，几乎没有人能从代码中直接推断出这个含义。更糟糕的是，如果有人在维护代码时不小心把 `'and'` 和 `true` 的位置颠倒了，PHP 不会报任何错误——因为第一个参数确实是字符串，第二个确实是布尔值，只是语义完全不同了。

这种问题在团队协作环境中尤为严重。新入职的开发者面对这样的代码需要花费大量时间去理解每个参数的含义，甚至经验丰富的开发者也可能因为记忆混淆而写出错误的调用。

### 2.2 参数顺序的隐性记忆负担

Laravel 的 `join` 方法是参数顺序问题的典型代表。该方法接受多达六个参数，其中多个参数的类型相同（字符串），非常容易混淆：

```php
// join 方法签名
public function join(
    $table,
    $first,
    $operator = null,
    $second = null,
    $type = 'inner',
    $where = false
)

// 传统调用——参数密集，容易出错
$query->join('orders', 'users.id', '=', 'orders.user_id', 'left', false);
```

在这行代码中， `'orders'` 是表名，`'users.id'` 是左连接条件的列，`'='` 是比较运算符，`'orders.user_id'` 是右连接条件的列，`'left'` 是连接类型，`false` 是 `$where` 标志。六个参数中有五个是字符串类型，仅凭位置很难快速确认每个参数的正确性。

更令人头疼的是，`operator` 和 `second` 参数有特殊的省略语法——当只传递三个参数时，`$first` 被当作原始 SQL 表达式。这种灵活的设计虽然方便了简单场景，但在代码审查中却增加了理解的复杂度。审查者必须先确认方法的调用形式属于哪种重载模式，才能正确理解代码的含义。

### 2.3 跨参数的默认值跳跃困境

在传统的参数传递中，如果你想使用一个靠后参数的非默认值，同时保留中间参数的默认值，你面临一个尴尬的选择。要么显式传递中间参数的默认值（这既冗余又容易出错），要么完全放弃使用该方法，转而编写更复杂的替代代码。

以 `orderBy` 方法为例，假设你想设置排序列和空值处理策略，但希望保留默认的升序排列方向：

```php
// 传统方式的困境
// 方案一：显式传递默认值
$query->orderBy('priority', 'asc', 'first'); // 'asc' 是默认值，但必须写出来

// 方案二：使用 orderByRaw 绕过
$query->orderByRaw('priority ASC NULLS FIRST'); // 更底层，但失去了抽象
```

方案一的问题在于，如果未来框架修改了 `direction` 参数的默认值，你的代码行为会悄然改变。方案二的问题在于，直接编写 SQL 片段绕过了框架的抽象层，失去了数据库兼容性优势。命名参数完美解决了这个困境：

```php
// 命名参数：直接跳到需要设置的参数
$query->orderBy(column: 'priority', nulls: 'first');
```

这行代码明确表达了意图——按 `priority` 列排序，空值排在前面，同时使用默认的升序方向。既清晰又安全。

### 2.4 复杂查询中的参数累积效应

在实际业务中，复杂的查询往往涉及多个方法的链式调用，每个方法都有若干参数。当这些方法的传统调用方式叠加在一起时，代码的可读性会急剧下降：

```php
// 复杂查询——参数的含义在层层传递中变得模糊
$results = DB::table('orders')
    ->selectRaw('DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as count')
    ->join('users', 'orders.user_id', '=', 'users.id')
    ->leftJoin('user_profiles', 'users.id', '=', 'user_profiles.user_id')
    ->where('orders.status', 'completed')
    ->whereBetween('orders.created_at', [$from, $to], 'and')
    ->whereNotNull('users.email', 'and')
    ->groupBy('date')
    ->having('revenue', '>', 1000)
    ->orderByRaw('FIELD(region, ?, ?, ?)', ['east', 'west', 'south'])
    ->limit(50, 0)
    ->get();
```

这段代码虽然功能完整，但阅读者需要逐行分析每个方法的参数才能理解查询逻辑。特别是 `having('revenue', '>', 1000)` 和 `limit(50, 0)` 这样的调用，参数的含义并不直观——`limit` 的第二个参数 `0` 代表偏移量，但在快速浏览代码时很容易被忽略或误解。

---

## 三、Named Arguments 重构实战

### 3.1 where 子句的可读性革命

where 子句是查询构建器中最常用的方法之一，也是参数语义模糊问题最集中的地方。让我们通过完整的对比来展示命名参数带来的可读性提升：

**重构前的传统写法：**

```php
$users = User::query()
    ->where('status', 'active')
    ->where('age', '>=', 18)
    ->where('role', '!=', 'admin')
    ->whereBetween('created_at', [$from, $to], 'or')
    ->whereNull('email_verified_at', 'and', true)
    ->get();
```

**重构后的命名参数写法：**

```php
$users = User::query()
    ->where(column: 'status', operator: '=', value: 'active')
    ->where(column: 'age', operator: '>=', value: 18)
    ->where(column: 'role', operator: '!=', value: 'admin')
    ->whereBetween(
        column: 'created_at',
        values: [$from, $to],
        boolean: 'or',
        not: false
    )
    ->whereNull(
        column: 'email_verified_at',
        boolean: 'and',
        not: true  // NOT NULL ——意图一目了然
    )
    ->get();
```

重构后的代码中，`not: true` 比第三个位置参数 `true` 清晰了无数倍。任何阅读代码的人都不需要查阅文档就知道这是 `IS NOT NULL` 条件。更重要的是，当团队中的新人看到 `not: true` 这样的写法时，他们可以立刻理解其含义，而不需要先学习框架的方法签名。

在 `whereBetween` 的调用中，`boolean: 'or'` 和 `not: false` 的写法同样让条件的逻辑关系变得透明。阅读者一眼就能看出：这个条件用 `OR` 连接，且不取反（即正常的 `BETWEEN` 语义）。

### 3.2 join 操作的彻底改造

join 操作是命名参数最具价值的应用场景之一。由于 join 方法参数众多且类型相似，位置传参的可读性问题在这里被放大到了极致：

**重构前：**

```php
$orders = DB::table('users')
    ->join('orders', 'users.id', '=', 'orders.user_id')
    ->leftJoin('products', 'orders.product_id', '=', 'products.id')
    ->join('categories', function ($join) {
        $join->on('products.category_id', '=', 'categories.id')
             ->where('categories.active', '=', true);
    })
    ->get();
```

**重构后：**

```php
$orders = DB::table('users')
    ->join(
        table: 'orders',
        first: 'users.id',
        operator: '=',
        second: 'orders.user_id'
    )
    ->leftJoin(
        table: 'products',
        first: 'orders.product_id',
        operator: '=',
        second: 'products.id'
    )
    ->join(
        table: 'categories',
        first: fn(JoinClause $join) => $join
            ->on('products.category_id', '=', 'categories.id')
            ->where('categories.active', '=', true)
    )
    ->get();
```

重构后的代码虽然在行数上有所增加，但每一列的含义都实现了自文档化。在代码审查中，审查者不需要打开 Builder 源码去确认参数顺序，只需要阅读参数名称就能理解每个连接的具体配置。这对于包含多个 join 的复杂查询来说，可读性的提升是决定性的。

特别值得注意的是，第三个 join 使用了闭包作为 `first` 参数——这是 Laravel 支持的条件连接语法。通过命名参数，即使这种不太常见的调用方式也变得清晰易懂，审查者一眼就能看出 `first` 参数接收的是一个闭包而非普通的列名字符串。

### 3.3 高级查询构建器的参数管理

对于更复杂的聚合查询和分组操作，命名参数的优势更加明显：

**重构前——眼睛需要反复对照参数位置：**

```php
$stats = Order::query()
    ->selectRaw('DATE(created_at) as date, SUM(total) as revenue')
    ->where('status', 'completed')
    ->groupBy('date')
    ->having('revenue', '>', 1000)
    ->orderByDesc('date')
    ->limit(30)
    ->get();
```

**重构后——每个参数的用途一目了然：**

```php
$stats = Order::query()
    ->selectRaw(
        expression: 'DATE(created_at) as date, SUM(total) as revenue'
    )
    ->where(
        column: 'status',
        operator: '=',
        value: 'completed'
    )
    ->groupBy(columns: ['date'])
    ->having(
        column: 'revenue',
        operator: '>',
        value: 1000
    )
    ->orderBy(
        column: 'date',
        direction: 'desc'
    )
    ->limit(value: 30)
    ->get();
```

在这个重构后的版本中，即使是对 Laravel 不熟悉的开发者也能快速理解查询逻辑。`having(column: 'revenue', operator: '>', value: 1000)` 比 `having('revenue', '>', 1000)` 提供了更明确的语义，特别是当 `having` 与 `where` 的参数顺序不同（having 的参数顺序是 column-operator-value，而某些 where 变体是 column-value-operator）时，命名参数有效避免了参数顺序混淆的风险。

### 3.4 Eloquent 关系加载中的命名参数

Eloquent 的关系加载是 Laravel 中另一个参数密集的场景。虽然 `with` 方法本身只接受一个数组参数，但在闭包内部的查询构建中，命名参数同样能带来显著的可读性提升：

```php
// 重构后的嵌套关系查询
$users = User::with([
    'posts' => function (Builder $query) {
        $query->where(column: 'published', value: true)
              ->orderBy(column: 'created_at', direction: 'desc')
              ->limit(value: 5);
    },
    'profile',
    'roles' => function (Builder $query) {
        $query->wherePivot(column: 'active', value: true);
    }
])->get();
```

在这个例子中，闭包内部的查询构建使用了命名参数，使得每个条件的含义都非常清晰。特别是 `wherePivot(column: 'active', value: true)` 这样的调用，明确表明了 `active` 是中间表（pivot table）的列，而非关联表的列。

### 3.5 聚合与分页查询的重构

分页和聚合操作是 Web 应用中最常见的查询模式。通过命名参数，我们可以让这些常见模式的代码更加清晰：

```php
// 重构前
$report = Order::query()
    ->selectRaw('MONTH(created_at) as month, SUM(total) as monthly_total')
    ->where('status', 'completed')
    ->whereYear('created_at', 2026)
    ->groupBy('month')
    ->orderBy('month', 'asc')
    ->having('monthly_total', '>', 5000)
    ->paginate(12, ['*'], 'page', 1);

// 重构后——每一层逻辑都清晰可辨
$report = Order::query()
    ->selectRaw(expression: 'MONTH(created_at) as month, SUM(total) as monthly_total')
    ->where(column: 'status', value: 'completed')
    ->whereYear(column: 'created_at', value: 2026)
    ->groupBy(columns: ['month'])
    ->orderBy(column: 'month', direction: 'asc')
    ->having(column: 'monthly_total', operator: '>', value: 5000)
    ->paginate(
        perPage: 12,
        columns: ['*'],
        pageName: 'page',
        page: 1
    );
```

`paginate` 方法的四个参数在传统写法中很容易混淆——`12` 是每页数量，`['*']` 是选择的列，`'page'` 是页码参数名，`1` 是当前页码。通过命名参数，这些参数的含义变得一目了然，即使维护者不记得 `paginate` 的方法签名也能正确理解和修改。

---

## 四、自定义 API 的命名参数设计模式

### 4.1 为 Builder 宏添加语义化参数

Laravel 的 Macro 系统允许我们扩展查询构建器的功能。利用命名参数，我们可以设计更加语义化的自定义查询宏，让团队内部的 API 也能享受命名参数带来的可读性优势：

```php
use Illuminate\Database\Query\Builder;

Builder::macro('whereDateRange', function (
    string $column,
    ?string $start = null,
    ?string $end = null,
    string $boolean = 'and',
    bool $not = false,
    bool $inclusive = true,
    string $timezone = 'UTC'
) {
    /** @var Builder $this */
    $query = $this;

    if ($start !== null) {
        $startCarbon = \Carbon\Carbon::parse($start, $timezone);
        $operator = $inclusive ? '>=' : '>';
        $query = $not
            ? $query->where($column, $this->negateOperator($operator), $startCarbon, $boolean)
            : $query->where($column, $operator, $startCarbon, $boolean);
    }

    if ($end !== null) {
        $endCarbon = \Carbon\Carbon::parse($end, $timezone);
        $operator = $inclusive ? '<=' : '<';
        $query = $query->where($column, $operator, $endCarbon, $boolean);
    }

    return $query;
});

// 使用命名参数调用——意图极其清晰
$reports = DB::table('orders')
    ->whereDateRange(
        column: 'created_at',
        start: '2026-01-01',
        end: '2026-06-07',
        inclusive: true,
        timezone: 'Asia/Shanghai'
    )
    ->get();
```

这个自定义宏展示了命名参数在设计团队内部 API 时的价值。`inclusive` 参数明确表示是否包含边界日期，`timezone` 参数指定了时区——这些语义在位置传参中需要查阅文档才能理解，而在命名参数中则直接自文档化。

注意这里的一个重要设计考量：参数的默认值应该覆盖最常见的使用场景。`inclusive` 默认为 `true`（包含边界），`timezone` 默认为 `'UTC'`，这样在最常见的情况下调用者只需要传递少数几个必要参数即可。同时，对于需要特殊配置的场景，命名参数让调用者可以精确地覆盖任意默认值。

### 4.2 Repository 层的查询封装

在实际的分层架构中，Repository 层是封装数据访问逻辑的核心。命名参数让我们可以设计出既灵活又清晰的 Repository 方法：

```php
class UserRepository
{
    public function search(
        string $keyword = '',
        array $roles = [],
        bool $activeOnly = true,
        ?string $sortBy = null,
        string $sortDirection = 'asc',
        int $perPage = 15,
        bool $withTrashed = false,
        array $withRelations = []
    ): LengthAwarePaginator {
        $query = User::query();

        if ($withTrashed) {
            $query->withTrashed();
        }

        if ($keyword !== '') {
            $query->where(function (Builder $q) use ($keyword) {
                $q->where(column: 'name', operator: 'like', value: "%{$keyword}%")
                  ->orWhere(column: 'email', operator: 'like', value: "%{$keyword}%");
            });
        }

        if ($roles !== []) {
            $query->whereHas(
                relation: 'roles',
                callback: fn(Builder $q) => $q->whereIn(column: 'name', values: $roles)
            );
        }

        if ($activeOnly) {
            $query->where(column: 'is_active', value: true);
        }

        if ($withRelations !== []) {
            $query->with(relations: $withRelations);
        }

        $sortBy ??= 'created_at';

        return $query
            ->orderBy(column: $sortBy, direction: $sortDirection)
            ->paginate(perPage: $perPage);
    }
}
```

调用时，命名参数让每个选项的含义不言自明。不同的业务场景可以只传递需要的参数，其他参数使用合理的默认值：

```php
$repo = new UserRepository();

// 场景一：简单的关键词搜索
$results = $repo->search(keyword: '张三');

// 场景二：带角色过滤的搜索
$results = $repo->search(
    keyword: '张三',
    roles: ['admin', 'editor'],
    withRelations: ['profile', 'roles']
);

// 场景三：查看已归档的用户
$trashed = $repo->search(
    keyword: 'test',
    activeOnly: false,
    withTrashed: true,
    sortBy: 'deleted_at',
    sortDirection: 'desc',
    perPage: 50
);
```

每种调用场景都清晰地表达了业务意图，维护者可以快速理解每个参数的作用，而不需要记忆参数的顺序或查阅方法定义。

### 4.3 分页与排序的通用组件设计

在中大型项目中，排序和分页逻辑通常会被抽取为可复用的 trait。命名参数让这些通用组件的接口更加直观：

```php
trait HasSortableQuery
{
    public function scopeSortable(
        Builder $query,
        ?string $sortBy = null,
        string $direction = 'asc',
        array $allowedColumns = [],
        string $defaultColumn = 'created_at',
        bool $allowMultiSort = false,
        string $nullsPosition = 'auto'
    ): Builder {
        $direction = in_array($direction, ['asc', 'desc']) ? $direction : 'desc';

        if ($sortBy && in_array($sortBy, $allowedColumns)) {
            $query->orderBy(column: $sortBy, direction: $direction);

            if ($nullsPosition === 'last') {
                $query->orderByRaw("{$sortBy} IS NULL");
            } elseif ($nullsPosition === 'first') {
                $query->orderByRaw("{$sortBy} IS NOT NULL");
            }
        } else {
            $query->orderBy(column: $defaultColumn, direction: 'desc');
        }

        return $query;
    }
}
```

使用时，开发者可以精确控制排序行为的每个细节：

```php
$products = Product::query()
    ->sortable(
        sortBy: request('sort', 'name'),
        direction: request('dir', 'asc'),
        allowedColumns: ['name', 'price', 'created_at', 'stock'],
        nullsPosition: 'last'
    )
    ->paginate(perPage: 20);
```

这里 `nullsPosition: 'last'` 的写法比传递一个位置参数 `'last'` 语义清晰得多。阅读者不需要查看 `sortable` 方法的定义就知道空值排序策略是"排在最后"。

---

## 五、完整实战案例：订单搜索 API 重构

### 5.1 重构前的代码

以下是一个接近真实的订单搜索服务代码。注意其中的痛点——参数以关联数组传递，缺少类型约束，参数名称的拼写错误在运行时才能发现：

```php
class OrderSearchService
{
    public function search($params)
    {
        $query = Order::query()
            ->select(['orders.*'])
            ->join('users', 'orders.user_id', '=', 'users.id')
            ->leftJoin('order_items', 'orders.id', '=', 'order_items.order_id');

        if (!empty($params['status'])) {
            $query->whereIn('orders.status', (array)$params['status']);
        }

        if (!empty($params['date_from'])) {
            $query->where('orders.created_at', '>=', $params['date_from']);
        }

        if (!empty($params['date_to'])) {
            $query->where('orders.created_at', '<=', $params['date_to']);
        }

        if (!empty($params['min_total'])) {
            $query->having('order_total', '>=', $params['min_total']);
        }

        if (!empty($params['customer_name'])) {
            $query->where('users.name', 'like', '%' . $params['customer_name'] . '%');
        }

        $query->groupBy('orders.id')
            ->selectRaw('SUM(order_items.quantity * order_items.price) as order_total')
            ->orderBy($params['sort'] ?? 'created_at', $params['dir'] ?? 'desc')
            ->paginate($params['per_page'] ?? 15);

        return $query;
    }
}
```

这段代码存在多个问题。首先，`$params` 是一个无类型的关联数组，调用者可以传递任意键名，拼写错误不会被检测到。其次，每个 `if` 块中重复调用 `where` 方法的模式既冗长又容易出错。最后，`orderBy` 和 `paginate` 中的 fallback 值使用了空合并运算符，但如果调用者传递了不合法的值（比如 `direction` 传了 `'up'`），代码不会报错，只会产生意外的行为。

### 5.2 重构后的代码

利用命名参数和类型声明，我们可以将这段代码重构为一个类型安全、语义清晰的服务：

```php
class OrderSearchService
{
    private const ALLOWED_SORT_COLUMNS = [
        'created_at', 'total', 'status', 'customer_name'
    ];

    public function search(
        array $statuses = [],
        ?string $dateFrom = null,
        ?string $dateTo = null,
        ?float $minTotal = null,
        ?float $maxTotal = null,
        ?string $customerName = null,
        ?int $customerId = null,
        string $sortBy = 'created_at',
        string $sortDirection = 'desc',
        int $perPage = 15,
        bool $includeItems = false,
        bool $includeCustomer = false,
        array $selectColumns = ['orders.*']
    ): LengthAwarePaginator {
        $query = Order::query()
            ->select(columns: $selectColumns)
            ->join(
                table: 'users',
                first: 'orders.user_id',
                operator: '=',
                second: 'users.id'
            )
            ->leftJoin(
                table: 'order_items',
                first: 'orders.id',
                operator: '=',
                second: 'order_items.order_id'
            )
            ->groupBy(columns: ['orders.id'])
            ->selectRaw(expression: 'SUM(order_items.quantity * order_items.price) as order_total');

        if ($statuses !== []) {
            $query->whereIn(column: 'orders.status', values: $statuses);
        }

        if ($dateFrom !== null) {
            $query->where(
                column: 'orders.created_at',
                operator: '>=',
                value: $dateFrom
            );
        }

        if ($dateTo !== null) {
            $query->where(
                column: 'orders.created_at',
                operator: '<=',
                value: $dateTo
            );
        }

        if ($minTotal !== null) {
            $query->having(
                column: 'order_total',
                operator: '>=',
                value: $minTotal
            );
        }

        if ($maxTotal !== null) {
            $query->having(
                column: 'order_total',
                operator: '<=',
                value: $maxTotal
            );
        }

        if ($customerName !== null) {
            $query->where(
                column: 'users.name',
                operator: 'like',
                value: "%{$customerName}%"
            );
        }

        if ($customerId !== null) {
            $query->where(
                column: 'orders.user_id',
                value: $customerId
            );
        }

        if ($includeItems) {
            $query->with(relations: ['items']);
        }

        if ($includeCustomer) {
            $query->with(relations: ['user']);
        }

        $sortBy = in_array($sortBy, self::ALLOWED_SORT_COLUMNS) ? $sortBy : 'created_at';

        return $query
            ->orderBy(column: $sortBy, direction: $sortDirection)
            ->paginate(perPage: $perPage);
    }
}
```

### 5.3 Controller 调用对比

重构后最大的变化体现在调用端。Controller 中的代码从一个不透明的关联数组调用，变成了完全自文档化的命名参数调用：

```php
// 重构前——$params 数组的 key 完全靠猜，IDE 无法提供补全
$orders = $this->searchService->search([
    'status' => ['completed', 'shipped'],
    'date_from' => '2026-01-01',
    'min_total' => 100,
    'sort' => 'created_at',
    'dir' => 'desc',
    'per_page' => 20,
]);

// 重构后——IDE 自动补全参数名，参数含义一目了然
$orders = $this->searchService->search(
    statuses: ['completed', 'shipped'],
    dateFrom: '2026-01-01',
    minTotal: 100.0,
    sortBy: 'created_at',
    sortDirection: 'desc',
    perPage: 20,
    includeItems: true,
    includeCustomer: true
);
```

重构后的代码在多个维度上优于重构前。IDE 可以基于方法签名提供精确的参数名自动补全，拼写错误在编译期就能被检测到。每个参数都带有类型声明，传递错误类型的值会产生类型错误。最重要的是，代码的意图对任何阅读者都是透明的——不需要查看 `search` 方法的定义就能理解每个搜索条件的含义。

---

## 六、工程最佳实践与设计原则

### 6.1 何时使用命名参数

命名参数并非在所有场景下都是最佳选择。过度使用会导致代码冗长，反而降低可读性。以下是经过实践验证的使用指导原则：

**强烈推荐使用的场景：**

1. **布尔参数**：`not: true` 远胜裸 `true`，这是命名参数最有价值的应用场景
2. **三个以上参数的方法**：参数越多，位置记忆的负担越重，命名参数的价值越大
3. **相同类型的连续参数**：当两个或更多连续参数的类型相同时，位置混淆的风险最高
4. **需要跳过默认值参数**：这是命名参数的独有能力，传统传参无法优雅实现
5. **团队新人友好的代码**：降低新人理解代码的门槛，加速团队协作

**不推荐使用的场景：**

```php
// 单参数方法——命名参数反而冗余
$builder->get();              // ✓ 简洁直观
$builder->get(columns: ['*']); // ✗ 对于常见方法显得多余

// 广为人知的标准模式
strlen($string);              // ✓ 每个 PHP 开发者都知道参数含义
strlen(string: $string);      // ✗ 多此一举

// 简单的赋值或配置调用
$model->save();               // ✓ 无需解释
$model->save(touch: true);    // ✓ 这里用命名参数有意义，因为有参数
```

### 6.2 与类型系统的协同

命名参数与 PHP 的类型系统结合使用时，可以实现更强的代码安全性。枚举类型特别适合与命名参数配合，它们不仅提供了类型安全，还通过枚举值的名称提供了额外的语义信息：

```php
enum SortDirection: string
{
    case Asc = 'asc';
    case Desc = 'desc';
}

enum NullsPosition: string
{
    case First = 'first';
    case Last = 'last';
    case Auto = 'auto';
}

// 类型安全 + 命名参数 = 极致可读性
$products = Product::query()
    ->orderBy(
        column: 'price',
        direction: SortDirection::Desc,
        nulls: NullsPosition::Last
    )
    ->get();
```

在这种设计下，不仅参数的名称传递了语义，参数的值本身（`SortDirection::Desc`、`NullsPosition::Last`）也通过枚举的命名传递了语义。即使是最不熟悉代码库的开发者，也能在不查阅任何文档的情况下理解这行代码的完整含义。

### 6.3 测试代码中的命名参数价值

命名参数在测试代码中的价值往往被忽视。测试代码需要清晰地表达"给定什么输入，期望什么输出"的语义，命名参数恰好能让测试用例的设置部分更加直观：

```php
class OrderSearchServiceTest extends TestCase
{
    public function test_can_search_orders_by_date_range(): void
    {
        Order::factory()->count(10)->create();

        $service = new OrderSearchService();

        $results = $service->search(
            dateFrom: '2026-01-01',
            dateTo: '2026-12-31',
            statuses: ['completed'],
            perPage: 5
        );

        $this->assertLessThanOrEqual(5, $results->total());
    }

    public function test_builder_macro_date_range(): void
    {
        $builder = DB::table('test_records');

        $sql = $builder->whereDateRange(
            column: 'created_at',
            start: '2026-01-01',
            end: '2026-06-07',
            inclusive: true,
            timezone: 'UTC'
        )->toSql();

        $this->assertStringContainsString('>=', $sql);
        $this->assertStringContainsString('<=', $sql);
    }
}
```

在测试失败时，测试代码中命名参数的使用让维护者能快速理解测试的设置逻辑，从而更快地定位失败原因。这对于复杂的集成测试尤其有价值。

---

## 七、性能与兼容性考量

### 7.1 性能影响分析

一个常见的疑虑是：命名参数是否会影响运行时性能？答案是否定的。命名参数是纯编译期特性——PHP 的编译器在将源代码转换为 opcodes 时，会将命名参数解析为与位置参数完全相同的字节码指令。这意味着在 opcache 编译后的执行层面，命名参数与位置参数的性能完全一致，不存在任何运行时开销。

```php
// 这两种方式编译后的字节码完全相同
$query->where('status', '=', 'active');
$query->where(column: 'status', operator: '=', value: 'active');
```

唯一的微小差异出现在编译阶段——解析命名参数需要额外的名称查找步骤。但在启用了 opcache 的生产环境中，编译结果会被缓存，这个差异可以忽略不计。

### 7.2 渐进式迁移策略

对于现有的大型 Laravel 项目，全面重写所有方法调用是不现实的。推荐采用渐进式迁移策略：

### 7.2.1 传统传参与命名参数对比总结

| 维度 | 传统位置传参 | 命名参数 |
|------|------------|---------|
| **可读性** | `whereNull('email', 'and', true)` — 需查阅文档 | `whereNull(column: 'email', boolean: 'and', not: true)` — 意图自明 |
| **参数顺序** | 固定顺序，必须记住位置 | 自由调整，按逻辑组织 |
| **跳过默认值** | 必须显式传递中间参数 | 直接跳到目标参数 |
| **类型安全** | 仅靠位置匹配，同类型参数易混淆 | 参数名 + 类型双重约束 |
| **IDE 支持** | 无法基于参数名补全 | 精确补全参数名与类型 |
| **拼写错误检测** | 运行时才暴露 | 编译期即可发现 |
| **向后兼容** | — | 完全兼容，可与传统方式共存 |
| **性能** | 编译期解析 | 编译期解析，运行时零开销 |
| **代码审查效率** | 审阅者需对照方法签名 | 参数名即文档，审查一目了然 |

**第一阶段：文档化阶段**——在 PHPDoc 注释中使用 `@param` 标注参数含义，为后续迁移做准备。这个阶段不修改任何代码，只是增强文档。

**第二阶段：痛点优先**——优先重构团队反馈最多的痛点代码，通常是参数最多的公共方法和最常被新人误解的调用。

**第三阶段：规范建立**——制定团队编码规范，明确规定"超过三个参数的公开方法调用必须使用命名参数"，并配置 PHPStan 或 CS Fixer 等工具进行自动化检查。

**第四阶段：全面推广**——将命名参数的使用扩展到内部方法、测试代码、以及新编写的全部代码中。

### 7.3 向后兼容的 API 设计

设计新的自定义方法时，命名参数与传统的位置传参方式是完全兼容的。这意味着你不需要强制调用者使用命名参数，两种方式可以在同一个代码库中共存：

```php
// 方法定义（支持两种调用方式）
public function scopeAdvancedSearch(
    Builder $query,
    string $keyword = '',
    array $filters = [],
    string $sortBy = 'created_at',
    string $direction = 'desc',
    int $perPage = 15
): Builder {
    // 实现逻辑...
}

// 传统方式仍然完全有效
$products = Product::advancedSearch('手机', ['category' => 1], 'price', 'asc', 20);

// 命名参数方式——更清晰
$products = Product::advancedSearch(
    keyword: '手机',
    filters: ['category' => 1],
    sortBy: 'price',
    direction: 'asc',
    perPage: 20
);
```

这种兼容性意味着迁移可以是完全渐进的——新代码使用命名参数，旧代码保持不变，两者可以无缝协作。

---

## 八、总结与展望

PHP Named Arguments 不仅仅是语法层面的改进，它代表了一种 API 设计哲学的转变——**代码即文档，调用即说明**。在 Laravel Builder/Query 系统的深入应用中，我们看到了这一特性的巨大潜力。

回顾全文的核心收获：

第一，命名参数有效消除了布尔参数的语义模糊。`not: true` 比裸 `true` 语义明确了一个数量级，这在包含大量布尔开关的查询构建器中价值巨大。

第二，命名参数解除了参数顺序的隐性约束。开发者不再需要记忆参数的位置，也不必为了跳过中间参数而传递占位值。

第三，命名参数显著提升了代码审查的效率。审查者不需要查阅方法签名就能理解每个参数的用途，大幅缩短了审查时间。

第四，命名参数强化了 IDE 的辅助能力。自动补全基于参数名称而非猜测，类型检查覆盖了值的合法性，两者结合大幅减少了参数传递的错误率。

第五，命名参数实现了真正的代码自文档化。调用代码本身即是最准确、最及时的文档，永远不会与实现脱节。

在设计自定义 API 时，我们应该拥抱命名参数这一特性，将其作为提升代码可读性的有力工具。但同时也要遵循适度原则——对于简单直观的方法调用，保持简洁仍然是第一要务。过度使用命名参数会让代码变得冗长，反而降低可读性。

PHP 生态正在从"能用"走向"好用"，而命名参数正是这场变革中的重要里程碑。在 Laravel 这样追求开发者体验的框架中，善用命名参数将使我们的代码更加优雅、可维护、自文档化。展望未来，随着 PHP 语言特性的持续演进和 Laravel 框架的不断发展，命名参数将在 API 设计中扮演越来越重要的角色，成为每个 PHP 开发者工具箱中不可或缺的利器。

> **实践建议**：从今天开始，在你下一个 Laravel 项目的 Builder 调用中尝试使用命名参数。从三个参数以上的方法开始，逐步养成习惯。设定一个简单的规则——当参数含义不直观时，使用命名参数。你会发现，代码的可读性和可维护性会有质的飞跃，团队的协作效率也会随之提升。

## 相关阅读

- [PHP 8.5 Pipe Operator 实战进阶：链式数据处理管道与 Laravel Pipeline 的互补设计](/categories/PHP/laravel/2026-06-05-php85-pipe-operator-chain-data-processing-laravel-pipeline/)
- [Laravel Macroable Trait 实战：为框架类动态扩展方法](/categories/Laravel/PHP/2026-06-06-Laravel-Macroable-Trait-实战-动态扩展框架类方法/)
- [PHP Enum 替魔术字符串 - 30+ 仓库重构经验与最佳实践](/categories/PHP/php-enum-30/)
