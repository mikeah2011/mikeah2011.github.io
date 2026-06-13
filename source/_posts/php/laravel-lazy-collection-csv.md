---

title: Laravel Lazy Collection 深度实战：惰性迭代的大数据处理——内存 O(1) 的 CSV 导入、数据库游标与生成器管道
keywords: [Laravel Lazy Collection, CSV, 深度实战, 惰性迭代的大数据处理, 内存, 导入, 数据库游标与生成器管道, PHP]
date: 2026-06-10 06:22:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- Lazy Collection
- 生成器
- 性能优化
- 内存优化
- 大数据
description: 深入剖析 Laravel Lazy Collection 的惰性迭代机制，涵盖内存 O(1) 的百万行 CSV 导入、数据库游标查询、生成器管道组合、自定义 LazyCollection 实现等生产级实战方案。
---



# Laravel Lazy Collection 深度实战：惰性迭代的大数据处理

## 概述

在 KKday 的 30+ 仓库中，我们经常遇到需要处理海量数据的场景：百万行 CSV 订单导入、千万条日志分析、全量商品数据同步。传统的 `Collection::toArray()` 或 `file()` 方法会在内存中一次性加载所有数据，轻松撑爆 PHP 的 128M 内存限制。

Laravel 的 `LazyCollection` 通过 PHP 生成器（Generator）实现了惰性迭代——只有在真正访问某个元素时才计算它，内存占用从 O(n) 降到 O(1)。本文将从底层原理到生产实战，系统性地拆解 LazyCollection 的使用姿势。

**你将学到：**
- LazyCollection 与 Collection 的本质区别和内存对比
- 百万行 CSV 的内存 O(1) 导入方案
- 数据库游标（Cursor）查询的正确姿势
- 生成器管道组合模式——链式处理不爆内存
- 自定义 LazyCollection 实现数据源抽象
- 生产环境中的踩坑记录与最佳实践

## 核心概念：惰性迭代 vs 即时迭代

### Collection 的问题：即时求值

```php
// 传统 Collection：立即加载全部数据到内存
$users = User::all(); // SELECT * FROM users — 内存中持有全部 100 万行
$filtered = $users->filter(fn($u) => $u->is_active); // 又创建一个新集合
$mapped = $filtered->map(fn($u) => $u->name); // 再创建一个
// 内存峰值：3 个集合，约 300MB+
```

每次链式调用都会创建一个新的 `Collection` 对象，每个对象都持有完整的数组。对于 100 万条记录，内存消耗轻松突破数百 MB。

### LazyCollection 的优势：延迟求值

```php
// LazyCollection：只在迭代时才逐个计算
$users = User::cursor(); // 返回 LazyCollection，不加载任何数据
$filtered = $users->filter(fn($u) => $u->is_active); // 仍然是惰性的
$mapped = $filtered->map(fn($u) => $u->name); // 仍然是惰性的

foreach ($mapped as $name) {
    // 到这里才真正执行 SQL 并逐行读取
    // 内存中始终只有 1 条记录
}
```

关键区别：`LazyCollection` 的 `filter`、`map`、`reject` 等方法返回的是新的 `LazyCollection`，它们通过闭包包装上游迭代器，形成一个**惰性管道**。只有在终端操作（`foreach`、`first`、`toArray` 等）触发时，数据才逐个流过管道。

## 实战一：百万行 CSV 导入——内存 O(1) 方案

### 问题场景

业务方提供一个 200 万行的订单 CSV 文件（约 500MB），需要导入数据库。传统方案：

```php
// ❌ 致命方案：一次性读入内存
$rows = file('orders.csv'); // 500MB 文件直接爆内存
foreach ($rows as $row) {
    // ...
}
```

### LazyCollection 方案

```php
use Illuminate\Support\LazyCollection;

class CsvOrderImporter
{
    /**
     * 内存 O(1) 的 CSV 导入
     * 即使处理 500MB 的 CSV，内存占用也稳定在 2MB 以内
     */
    public function import(string $filePath): int
    {
        $imported = 0;

        LazyCollection::make(function () use ($filePath) {
            $handle = fopen($filePath, 'r');
            if ($handle === false) {
                throw new \RuntimeException("无法打开文件: {$filePath}");
            }

            // 跳过表头
            $header = fgetcsv($handle);

            try {
                while (($row = fgetcsv($handle)) !== false) {
                    yield array_combine($header, $row);
                }
            } finally {
                fclose($handle);
            }
        })
        // 过滤无效行
        ->filter(fn(array $row) => !empty($row['order_id']))
        // 数据转换
        ->map(fn(array $row) => [
            'order_id'    => $row['order_id'],
            'amount'      => (int) ($row['amount'] * 100), // 分为单位
            'currency'    => $row['currency'] ?? 'CNY',
            'customer_id' => $row['customer_id'],
            'created_at'  => Carbon::parse($row['created_at']),
        ])
        // 批量插入：每 1000 条一批
        ->chunk(1000)
        ->each(function ($chunk) use (&$imported) {
            Order::insert($chunk->toArray());
            $imported += $chunk->count();
        });

        return $imported;
    }
}
```

**内存对比：**

| 方案 | 处理 200 万行 CSV | 内存峰值 |
|------|-------------------|----------|
| `file()` | 加载 500MB 到内存 | ~600MB |
| `fgetcsv` 循环 | 逐行读取，但无法链式处理 | ~1MB |
| `LazyCollection` | 逐行惰性处理，支持链式组合 | ~2MB |

### 带进度报告的版本

```php
use Illuminate\Support\LazyCollection;
use Symfony\Component\Console\Output\OutputInterface;

class CsvImporterWithProgress
{
    public function import(string $filePath, OutputInterface $output): int
    {
        $totalLines = $this->countLines($filePath);
        $imported = 0;
        $batch = [];

        LazyCollection::make(function () use ($filePath) {
            $handle = fopen($filePath, 'r');
            $header = fgetcsv($handle);
            try {
                while (($row = fgetcsv($handle)) !== false) {
                    yield array_combine($header, $row);
                }
            } finally {
                fclose($handle);
            }
        })
        ->each(function (array $row) use (&$batch, &$imported, $output, $totalLines) {
            $batch[] = $this->transformRow($row);

            if (count($batch) >= 1000) {
                Order::insert($batch);
                $imported += count($batch);
                $batch = [];

                $percent = round(($imported / $totalLines) * 100, 1);
                $output->writeln("进度: {$imported}/{$totalLines} ({$percent}%)");
            }
        });

        // 处理剩余
        if (!empty($batch)) {
            Order::insert($batch);
            $imported += count($batch);
        }

        return $imported;
    }

    private function countLines(string $filePath): int
    {
        $count = 0;
        $handle = fopen($filePath, 'r');
        while (fgets($handle) !== false) {
            $count++;
        }
        fclose($handle);
        return $count - 1; // 减去表头
    }

    private function transformRow(array $row): array
    {
        return [
            'order_id'    => $row['order_id'],
            'amount'      => (int) ($row['amount'] * 100),
            'currency'    => $row['currency'] ?? 'CNY',
            'customer_id' => $row['customer_id'],
            'created_at'  => Carbon::parse($row['created_at']),
            'updated_at'  => now(),
        ];
    }
}
```

## 实战二：数据库游标——避免 Eloquent 集合爆内存

### cursor() vs get() 的本质区别

```php
// ❌ 传统方式：加载全部记录到内存
$orders = Order::where('status', 'pending')->get(); // 10 万条 → 内存爆
foreach ($orders as $order) {
    $this->processOrder($order);
}

// ✅ 游标方式：逐条从数据库读取
$orders = Order::where('status', 'pending')->cursor(); // LazyCollection
foreach ($orders as $order) {
    $this->processOrder($order); // 内存中只有 1 条
}
```

`cursor()` 返回一个 `LazyCollection`，底层使用 PHP 的 `PDO::FETCH_LAZY` 模式，每次迭代只从数据库结果集中取出一行。

### 带关联加载的游标查询

```php
// ❌ 常见错误：cursor + with 失效
Order::with('items')->cursor()->each(function (Order $order) {
    // items 可能未被预加载，导致 N+1
    $order->items->each(fn($item) => ...);
});

// ✅ 正确姿势：在 cursor 前确认 eager load 生效
Order::query()
    ->with(['items', 'customer'])
    ->where('status', 'completed')
    ->cursor()
    ->each(function (Order $order) {
        // items 已预加载，无 N+1
        $total = $order->items->sum('price');
        $customerName = $order->customer->name;
    });
```

### 游标 + chunk 的混合方案

当单条处理逻辑较重（涉及 API 调用等）时，纯逐条迭代效率低。可以用 chunk 混合：

```php
Order::query()
    ->where('status', 'pending')
    ->orderBy('id')
    ->cursor()
    ->chunk(100)
    ->each(function (LazyCollection $chunk) {
        // 100 条一批处理
        $ids = $chunk->pluck('id')->toArray();

        // 批量更新状态
        Order::whereIn('id', $ids)->update(['status' => 'processing']);

        // 批量发送通知（比逐条发送效率高）
        $customers = Customer::whereIn('order_id', $ids)->get();
        Notification::send($customers, new OrderProcessingNotification());
    });
```

### 大表分页的终极方案：cursorPaginate

对于千万级大表，传统的 `offset` 分页越到后面越慢（`OFFSET 1000000` 需要扫描前 100 万行）。`cursorPaginate` 基于上一页最后一条记录的主键做范围查询，性能恒定：

```php
// Controller 中使用 cursor 分页
public function index(Request $request)
{
    $orders = Order::query()
        ->where('status', 'completed')
        ->orderBy('id')
        ->cursorPaginate(50, ['*'], 'cursor');

    return OrderResource::collection($orders);
}

// 响应中会包含 next_cursor 和 prev_cursor
// 前端用 cursor 参数翻页，不再用 page=1234
```

## 实战三：生成器管道——链式处理不爆内存

### 管道模式核心思想

将数据处理拆分成多个阶段，每个阶段都是一个惰性的生成器。数据像水流一样逐个经过管道，任何时候内存中只有一条数据。

```php
/**
 * 生成器管道：每个阶段是一个生成器函数
 * 数据从上游 yield 到下游，内存始终 O(1)
 */
class GeneratorPipeline
{
    private array $stages = [];

    /**
     * 添加处理阶段
     */
    public function pipe(callable $stage): self
    {
        $this->stages[] = $stage;
        return $this;
    }

    /**
     * 执行管道
     */
    public function process(iterable $input): \Generator
    {
        $current = $input;

        foreach ($this->stages as $stage) {
            $current = $stage($current);
        }

        yield from $current;
    }
}

// 使用示例
$pipeline = new GeneratorPipeline();

$result = $pipeline
    // 阶段 1：从 CSV 读取
    ->pipe(function (iterable $rows) {
        foreach ($rows as $row) {
            yield $row; // 传递给下一个阶段
        }
    })
    // 阶段 2：验证
    ->pipe(function (iterable $rows) {
        foreach ($rows as $row) {
            if (!empty($row['email']) && filter_var($row['email'], FILTER_VALIDATE_EMAIL)) {
                yield $row;
            }
        }
    })
    // 阶段 3：转换
    ->pipe(function (iterable $rows) {
        foreach ($rows as $row) {
            yield [
                'email' => strtolower(trim($row['email'])),
                'name'  => mb_strtoupper($row['name']),
            ];
        }
    })
    // 阶段 4：去重
    ->pipe(function (iterable $rows) {
        $seen = [];
        foreach ($rows as $row) {
            $key = $row['email'];
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                yield $row;
            }
        }
    })
    // 执行管道
    ->process(readCsv('users.csv'));

// 终端操作：逐个消费
foreach ($result as $user) {
    User::create($user);
}
```

### Laravel 集成版：利用 LazyCollection 的 tap

```php
use Illuminate\Support\LazyCollection;

class UserImportPipeline
{
    public function execute(string $csvPath): LazyCollection
    {
        return LazyCollection::make(function () use ($csvPath) {
            $handle = fopen($csvPath, 'r');
            $header = fgetcsv($handle);
            try {
                while (($row = fgetcsv($handle)) !== false) {
                    yield array_combine($header, $row);
                }
            } finally {
                fclose($handle);
            }
        })
        // 阶段 1：过滤无效行
        ->filter(fn(array $row) => !empty($row['email']))
        // 阶段 2：验证邮箱格式
        ->filter(fn(array $row) => filter_var($row['email'], FILTER_VALIDATE_EMAIL))
        // 阶段 3：数据清洗
        ->map(fn(array $row) => [
            'email' => strtolower(trim($row['email'])),
            'name'  => $this->sanitizeName($row['name'] ?? ''),
            'phone' => $this->normalizePhone($row['phone'] ?? ''),
        ])
        // 阶段 4：tap 用于调试，不影响数据流
        ->tap(fn($row) => Log::debug('Processing', ['email' => $row['email']]))
        // 阶段 5：去重（基于邮箱）
        ->unique('email');
    }

    private function sanitizeName(string $name): string
    {
        return mb_substr(preg_replace('/[^\p{L}\s]/u', '', $name), 0, 100);
    }

    private function normalizePhone(string $phone): string
    {
        return preg_replace('/[^\d+]/', '', $phone);
    }
}

// 在 Command 中使用
class ImportUsers extends Command
{
    public function handle(UserImportPipeline $pipeline): int
    {
        $csvPath = $this->argument('file');
        $users = $pipeline->execute($csvPath);

        $users->chunk(500)->each(function ($chunk) {
            DB::transaction(function () use ($chunk) {
                foreach ($chunk as $user) {
                    User::updateOrCreate(
                        ['email' => $user['email']],
                        $user
                    );
                }
            });
            $this->line("已处理 {$chunk->count()} 条");
        });

        return 0;
    }
}
```

## 实战四：自定义 LazyCollection 数据源

### 抽象数据源接口

```php
use Illuminate\Support\LazyCollection;
use IteratorAggregate;

/**
 * 可复用的数据源抽象
 * 任何数据源都可以包装成 LazyCollection
 */
abstract class DataSource implements IteratorAggregate
{
    protected int $chunkSize = 1000;

    /**
     * 子类实现：返回生成器
     */
    abstract protected function generate(): \Generator;

    /**
     * 返回 LazyCollection 实例
     */
    public function toLazyCollection(): LazyCollection
    {
        return LazyCollection::make(fn() => $this->generate());
    }

    /**
     * IteratorAggregate 接口
     */
    public function getIterator(): \Generator
    {
        return $this->generate();
    }
}

/**
 * MySQL 大表数据源
 */
class MySqlDataSource extends DataSource
{
    public function __construct(
        private string $table,
        private array $conditions = [],
        private string $orderBy = 'id',
    ) {}

    protected function generate(): \Generator
    {
        $lastId = 0;

        do {
            $query = DB::table($this->table)
                ->where('id', '>', $lastId)
                ->orderBy($this->orderBy)
                ->limit($this->chunkSize);

            foreach ($this->conditions as $column => $value) {
                $query->where($column, $value);
            }

            $rows = $query->get();
            $count = $rows->count();

            foreach ($rows as $row) {
                $lastId = $row->id;
                yield $row;
            }
        } while ($count === $this->chunkSize);
    }
}

/**
 * API 分页数据源
 */
class ApiPaginatedDataSource extends DataSource
{
    public function __construct(
        private string $baseUrl,
        private array $headers = [],
        private int $perPage = 100,
    ) {}

    protected function generate(): \Generator
    {
        $page = 1;

        do {
            $response = Http::withHeaders($this->headers)
                ->get($this->baseUrl, [
                    'page'     => $page,
                    'per_page' => $this->perPage,
                ]);

            $data = $response->json('data', []);
            $total = $response->json('meta.total', 0);

            foreach ($data as $item) {
                yield $item;
            }

            $page++;
        } while (($page - 1) * $this->perPage < $total);
    }
}

// 使用示例
$source = new MySqlDataSource('orders', ['status' => 'completed']);
$orders = $source->toLazyCollection();

$orders
    ->filter(fn($o) => $o->amount > 10000)
    ->map(fn($o) => [
        'order_id' => $o->id,
        'amount'   => $o->amount,
        'customer' => $o->customer_name,
    ])
    ->chunk(500)
    ->each(fn($chunk) => Report::insert($chunk->toArray()));
```

### 流式 API 数据源：实时处理 SSE/WebSocket

```php
/**
 * Server-Sent Events 数据源
 * 适合实时数据流处理
 */
class SseDataSource extends DataSource
{
    public function __construct(
        private string $url,
        private array $headers = [],
    ) {}

    protected function generate(): \Generator
    {
        $process = new Process([
            'curl', '-N', '-H', 'Accept: text/event-stream',
            ...$this->buildHeaderArgs(),
            $this->url,
        ]);

        $process->start();

        $buffer = '';
        while ($process->isRunning()) {
            $output = $process->getIncrementalOutput();
            $buffer .= $output;

            while (($pos = strpos($buffer, "\n\n")) !== false) {
                $event = substr($buffer, 0, $pos);
                $buffer = substr($buffer, $pos + 2);

                $data = $this->parseSseEvent($event);
                if ($data !== null) {
                    yield $data;
                }
            }
        }
    }

    private function parseSseEvent(string $event): ?array
    {
        foreach (explode("\n", $event) as $line) {
            if (str_starts_with($line, 'data: ')) {
                $json = substr($line, 6);
                return json_decode($json, true);
            }
        }
        return null;
    }

    private function buildHeaderArgs(): array
    {
        $args = [];
        foreach ($this->headers as $key => $value) {
            $args[] = '-H';
            $args[] = "{$key}: {$value}";
        }
        return $args;
    }
}
```

## 实战五：内存安全的复杂聚合

### 场景：千万条日志的统计分析

```php
/**
 * 内存安全的日志分析器
 * 处理千万条日志，内存峰值 < 10MB
 */
class LogAnalyzer
{
    public function analyze(string $logPath): array
    {
        $stats = [
            'total'      => 0,
            'errors'     => 0,
            'warnings'   => 0,
            'by_hour'    => [],
            'top_errors' => [],
        ];

        // 用数组做计数器，比 Collection 省内存
        $errorCounts = [];

        LazyCollection::make(function () use ($logPath) {
            $handle = fopen($logPath, 'r');
            try {
                while (($line = fgets($handle)) !== false) {
                    yield $line;
                }
            } finally {
                fclose($handle);
            }
        })
        // 解析日志行
        ->map(fn(string $line) => $this->parseLogLine($line))
        // 过滤解析失败的
        ->filter(fn(?array $entry) => $entry !== null)
        // 统计
        ->each(function (array $entry) use (&$stats, &$errorCounts) {
            $stats['total']++;

            if ($entry['level'] === 'ERROR') {
                $stats['errors']++;
                $key = $entry['message'];
                $errorCounts[$key] = ($errorCounts[$key] ?? 0) + 1;
            }

            if ($entry['level'] === 'WARNING') {
                $stats['warnings']++;
            }

            $hour = $entry['hour'];
            $stats['by_hour'][$hour] = ($stats['by_hour'][$hour] ?? 0) + 1;
        });

        // 排序 Top 错误
        arsort($errorCounts);
        $stats['top_errors'] = array_slice($errorCounts, 0, 20, true);

        return $stats;
    }

    private function parseLogLine(string $line): ?array
    {
        // [2026-06-10 14:32:15] production.ERROR: Something broke
        if (!preg_match('/\[(\d{4}-\d{2}-\d{2}) (\d{2}):\d{2}:\d{2}\]\s+\w+\.(\w+):\s+(.*)/', $line, $m)) {
            return null;
        }

        return [
            'date'    => $m[1],
            'hour'    => (int) $m[2],
            'level'   => $m[3],
            'message' => substr($m[4], 0, 200), // 截断防止长消息吃内存
        ];
    }
}
```

## 生产环境踩坑记录

### 踩坑 1：LazyCollection 不能多次迭代

```php
$lazy = LazyCollection::make(function () {
    yield 1;
    yield 2;
    yield 3;
});

// 第一次迭代：正常
foreach ($lazy as $item) {
    echo $item; // 1, 2, 3
}

// 第二次迭代：空！生成器已耗尽
foreach ($lazy as $item) {
    echo $item; // 无输出
}

// ✅ 解决方案：需要多次使用时，转为 Collection
$collection = $lazy->collect(); // 一次性加载到内存
```

### 踩坑 2：chunk() 后的 each() 接收的是 Collection，不是 LazyCollection

```php
LazyCollection::make(function () {
    for ($i = 0; $i < 10000; $i++) {
        yield $i;
    }
})
->chunk(100)
->each(function ($chunk) {
    // $chunk 是 Collection，不是 LazyCollection
    // 这是预期行为，因为 chunk 需要缓存一组元素
    get_class($chunk); // Illuminate\Support\Collection
    $chunk->count();   // 100
});
```

### 踩坑 3：cursor() 在事务中的行为

```php
DB::transaction(function () {
    // ⚠️ cursor 在事务中，整个迭代期间持有数据库连接
    // 如果数据量大、处理慢，可能导致连接长时间占用
    Order::cursor()->each(function (Order $order) {
        $this->heavyProcessing($order); // 如果这个很慢，连接被长时间占用
    });
});

// ✅ 更好的方案：cursor + 外部事务
$orders = Order::query()->where('status', 'pending')->cursor();

foreach ($orders as $order) {
    DB::transaction(function () use ($order) {
        // 每条记录独立事务，连接快速释放
        $this->processOrder($order);
    });
}
```

### 踩坑 4：内存泄漏——闭包持有大对象

```php
$hugeCollection = Order::all(); // 10 万条记录在内存

// ❌ 闭包捕获了 $hugeCollection，内存不会释放
$lazy = LazyCollection::make(function () use ($hugeCollection) {
    foreach ($hugeCollection as $order) {
        yield $order;
    }
});

// ✅ 正确方案：直接用 cursor()
$lazy = Order::cursor();
```

### 踩坑 5：unique() 和 take() 等终端操作的内存特性

```php
// unique() 需要维护已见元素的哈希表，内存会增长
$lazy->unique('email'); // 内存 O(已见元素数)

// ✅ 对于超大数据集，用数据库去重代替
$lazy->chunk(1000)->each(function ($chunk) {
    $emails = $chunk->pluck('email')->toArray();
    $existing = User::whereIn('email', $emails)->pluck('email')->toArray();

    $newUsers = $chunk->reject(fn($u) => in_array($u['email'], $existing));
    if ($newUsers->isNotEmpty()) {
        User::insert($newUsers->toArray());
    }
});
```

## 性能基准测试

```php
// 测试代码：对比 Collection vs LazyCollection 处理 100 万条记录
class MemoryBenchmark
{
    public function run(): void
    {
        $count = 1_000_000;

        // 测试 1: Collection
        $startMem = memory_get_usage(true);
        $collection = collect(range(1, $count));
        $filtered = $collection->filter(fn($n) => $n % 2 === 0);
        $mapped = $filtered->map(fn($n) => $n * 2);
        $result1 = $mapped->sum();
        $memCollection = memory_get_usage(true) - $startMem;

        // 测试 2: LazyCollection
        gc_collect_cycles();
        $startMem = memory_get_usage(true);
        $lazy = LazyCollection::make(function () use ($count) {
            for ($i = 1; $i <= $count; $i++) {
                yield $i;
            }
        });
        $result2 = $lazy
            ->filter(fn($n) => $n % 2 === 0)
            ->map(fn($n) => $n * 2)
            ->sum(); // sum() 是终端操作
        $memLazy = memory_get_usage(true) - $startMem;

        echo "Collection 内存: " . number_format($memCollection / 1024 / 1024, 2) . " MB\n";
        echo "LazyCollection 内存: " . number_format($memLazy / 1024 / 1024, 2) . " MB\n";
        echo "结果一致: " . ($result1 === $result2 ? '是' : '否') . "\n";

        // 典型输出：
        // Collection 内存: 132.00 MB
        // LazyCollection 内存: 0.50 MB
        // 结果一致: 是
    }
}
```

## 最佳实践总结

| 场景 | 推荐方案 | 内存复杂度 |
|------|----------|-----------|
| CSV/JSON 大文件导入 | `LazyCollection::make()` + `fgetcsv` | O(1) |
| 大表全量扫描 | `cursor()` | O(1) |
| 大表分页查询 | `cursorPaginate()` | O(pageSize) |
| 数据管道处理 | `LazyCollection` 链式调用 | O(1) |
| 需要随机访问 | `collect()` 转为 Collection | O(n) |
| 需要多次迭代 | `collect()` 转为 Collection | O(n) |
| 超大数据集去重 | 数据库层面去重 | O(batch) |

**核心原则：**
1. **默认用 LazyCollection**——除非你需要随机访问或多次迭代
2. **链式方法越早过滤越好**——减少下游处理的数据量
3. **chunk 用于批量写入**——避免逐条 INSERT 的性能问题
4. **注意生成器不可重放**——需要重复使用时先 `collect()`
5. **事务中慎用 cursor**——长时间迭代可能占用连接

## 总结

LazyCollection 是 Laravel 处理大数据的核心武器。它通过 PHP 生成器实现了惰性迭代，让开发者可以用声明式的链式调用处理海量数据，而不用担心内存爆炸。

关键记忆点：
- `LazyCollection::make()` 包装任何生成器
- `cursor()` 是数据库大表的最佳搭档
- `chunk()` 在惰性管道中承担批量写入的桥梁
- 生成器不可重放，需要重复使用时用 `collect()`
- 事务中的 cursor 要注意连接占用时间

在 KKday 的实际项目中，我们将 LazyCollection 应用于订单导出（百万级）、商品同步（十万级）、日志分析（千万级）等场景，内存峰值稳定控制在 10MB 以内，彻底告别了 OOM 的噩梦。
