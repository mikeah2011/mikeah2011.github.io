
title: Laravel Batch Job 实战：大数据量批量处理的内存治理、分块策略与进度追踪
keywords: [Laravel, Batch, Job]
date: 2026-06-02 10:00:00
tags:
- Laravel
- Queue
- batch
- 内存优化
- PHP
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
description: Laravel Batch Job 大数据量批处理实战指南：深入讲解内存溢出治理、chunkById 分块策略、进度追踪、失败重试与断点续传等核心问题。涵盖
  Bus::batch 高级用法、Horizon 监控、数据库连接池优化等生产级方案，附带 50 万条数据导出、批量通知发送等真实场景代码，解决 PHP 批处理的
  OOM、超时、并发冲突等痛点。
---



## 引言：大数据量批处理的常见问题

在 Laravel 应用中，批量处理是一个高频场景：批量导出报表、批量发送通知、批量更新数据、批量同步第三方数据。这些操作看似简单，但在实际生产环境中，它们带来了一系列棘手的问题：

**内存溢出**：一次性加载 10 万条记录到内存，PHP 进程直接 OOM。我们曾经有一个导出功能，在本地测试时 1000 条数据运行良好，上线后处理 50 万条数据时直接把服务器内存吃光。

**超时中断**：PHP-FPM 默认 30 秒超时，一个批量操作可能需要数分钟。即使用了 `set_time_limit(0)`，Nginx 的 `proxy_read_timeout` 也会断开连接。

**进度不可见**：用户点击「导出」按钮后，页面一直转圈，不知道是在处理还是已经卡死。客服每天接到大量「导出失败」的反馈，实际上只是处理时间太长。

**失败不可恢复**：处理到第 8 万条时失败了，需要从头开始。没有断点续传，没有失败重试。

**并发冲突**：多个用户同时触发批量操作，或者定时任务与手动操作并发执行，导致数据不一致。

Laravel 提供了强大的 Batch（批处理）系统来解决这些问题。本文将深入探讨 Laravel Batch 的使用，包括内存治理、分块策略、进度追踪、失败处理等核心主题。

## 二、Laravel Batch 基础

### 2.1 什么是 Laravel Batch

Laravel 的 Batch 系统允许你将一组 Job 组织为一个批次，统一管理它们的执行、进度追踪和失败处理。

```php
use Illuminate\Bus\Batch;
use Illuminate\Support\Facades\Bus;

$batch = Bus::batch([
    new ProcessOrderJob($order1),
    new ProcessOrderJob($order2),
    new ProcessOrderJob($order3),
    // ... 更多 Job
])->then(function (Batch $batch) {
    // 所有 Job 完成后执行
    Log::info("Batch {$batch->id} 完成");
})->catch(function (Batch $batch, Throwable $e) {
    // 有 Job 失败时执行
    Log::error("Batch {$batch->id} 失败: {$e->getMessage()}");
})->finally(function (Batch $batch) {
    // 无论成功失败都执行
    Log::info("Batch {$batch->id} 结束");
})->dispatch();
```

### 2.2 Batch 的核心 API

```php
// 创建 Batch
$batch = Bus::batch($jobs)
    ->name('订单导出')                    // Batch 名称
    ->onConnection('redis')              // 指定连接
    ->onQueue('exports')                 // 指定队列
    ->allowFailures()                    // 允许失败（不中断整个 Batch）
    ->withOption('max_attempts', 3)      // 最大重试次数
    ->then(fn (Batch $batch) => ...)     // 全部完成回调
    ->catch(fn (Batch $batch) => ...)    // 失败回调
    ->finally(fn (Batch $batch) => ...)  // 结束回调
    ->progress()                         // 进度回调
    ->dispatch();

// 查询 Batch 状态
$batch = Bus::findBatch($batchId);
$batch->progress();          // 进度百分比
$batch->totalJobs;           // 总任务数
$batch->pendingJobs;         // 待处理任务数
$batch->processedJobs();     // 已处理任务数
$batch->failedJobs;          // 失败任务数
$batch->isFinished();        // 是否完成
$batch->cancelled();         // 是否已取消
$batch->cancel();            // 取消 Batch
```

### 2.3 在 Job 中报告进度

每个 Job 可以向 Batch 报告自己的进度：

```php
class ProcessOrderJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private int $orderId,
    ) {}

    public function handle(): void
    {
        // 处理订单
        $order = Order::find($this->orderId);
        $this->processOrder($order);
        
        // 报告进度
        $this->job->delete();
    }
}
```

## 三、内存治理：chunk()、lazy()、cursor() 的区别与选型

### 3.1 问题：为什么直接查询会 OOM

```php
// ❌ 这会导致 OOM
$orders = Order::all();  // 加载所有记录到内存
foreach ($orders as $order) {
    $this->process($order);
}
```

`Order::all()` 会将所有记录加载到 PHP 内存中。如果表中有 100 万条记录，每条记录占用 1KB 内存，总共需要约 1GB 内存。

### 3.2 chunk()：分块查询

```php
// ✅ 使用 chunk 分块处理
Order::chunk(1000, function ($orders) {
    foreach ($orders as $order) {
        $this->process($order);
    }
});
```

`chunk()` 的工作原理：
1. 执行 `SELECT * FROM orders LIMIT 1000 OFFSET 0`
2. 处理这 1000 条记录
3. 执行 `SELECT * FROM orders LIMIT 1000 OFFSET 1000`
4. 重复直到没有更多记录

**优点**：内存占用恒定（只保持 1000 条在内存中）
**缺点**：使用 OFFSET 分页，在大数据量下性能下降（OFFSET 越大越慢）

```php
// chunk 的底层 SQL
// 第 1 次: SELECT * FROM orders ORDER BY id LIMIT 1000 OFFSET 0
// 第 2 次: SELECT * FROM orders ORDER BY id LIMIT 1000 OFFSET 1000
// 第 100 次: SELECT * FROM orders ORDER BY id LIMIT 1000 OFFSET 100000
// ⚠️ 第 100 次查询会扫描前 100000 行然后跳过，非常慢
```

### 3.3 chunkById()：基于 ID 的分块

```php
// ✅ 使用 chunkById 避免 OFFSET 性能问题
Order::chunkById(1000, function ($orders) {
    foreach ($orders as $order) {
        $this->process($order);
    }
});
```

`chunkById()` 的工作原理：
1. 执行 `SELECT * FROM orders WHERE id > 0 ORDER BY id LIMIT 1000`
2. 处理这 1000 条记录，记录最后一条的 ID
3. 执行 `SELECT * FROM orders WHERE id > 1000 ORDER BY id LIMIT 1000`
4. 重复直到没有更多记录

**优点**：不使用 OFFSET，性能恒定
**缺点**：必须有连续的 ID 列（或可排序的列）

```php
// chunkById 的底层 SQL
// 第 1 次: SELECT * FROM orders WHERE id > 0 ORDER BY id LIMIT 1000
// 第 2 次: SELECT * FROM orders WHERE id > 1000 ORDER BY id LIMIT 1000
// 第 100 次: SELECT * FROM orders WHERE id > 100000 ORDER BY id LIMIT 1000
// ✅ 每次查询都使用索引，性能恒定
```

### 3.4 lazy()：延迟加载

```php
// ✅ 使用 lazy 延迟加载
Order::lazy()->each(function ($order) {
    $this->process($order);
});
```

`lazy()` 返回一个 `LazyCollection`，它在需要时才从数据库加载记录。底层使用 PDO 的游标（cursor），每次只从数据库读取一条记录。

**优点**：内存占用最小（只保持一条记录在内存中）
**缺点**：保持数据库连接打开时间长，不适合需要批量操作的场景

### 3.5 cursor()：游标查询

```php
// ✅ 使用 cursor
foreach (Order::cursor() as $order) {
    $this->process($order);
}
```

`cursor()` 与 `lazy()` 类似，但返回的是 `Generator`，不是 `LazyCollection`。

### 3.6 选型对比

| 方法 | 内存占用 | 性能 | 适用场景 |
|------|----------|------|----------|
| `all()` | ❌ 全量加载 | 最快（一次查询） | 数据量 < 1000 |
| `chunk()` | ✅ 恒定 | ⚠️ 大数据量下降 | 需要批量操作 |
| `chunkById()` | ✅ 恒定 | ✅ 恒定 | 大数据量处理（推荐） |
| `lazy()` | ✅ 最小 | ⚠️ 保持连接 | 逐条处理 |
| `cursor()` | ✅ 最小 | ⚠️ 保持连接 | 逐条处理 |

**推荐**：大多数场景使用 `chunkById()`，它是性能和内存的最佳平衡。

## 四、分块策略

### 4.1 按 ID 范围分片

```php
class ExportOrdersJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private int $startId,
        private int $endId,
        private string $exportId,
    ) {}

    public function handle(): void
    {
        Order::whereBetween('id', [$this->startId, $this->endId])
            ->chunkById(1000, function ($orders) {
                $this->appendToFile($orders);
            });
    }

    private function appendToFile($orders): void
    {
        $filePath = storage_path("exports/{$this->exportId}.csv");
        $file = fopen($filePath, 'a');
        
        foreach ($orders as $order) {
            fputcsv($file, [
                $order->id,
                $order->user->name,
                $order->total,
                $order->created_at,
            ]);
        }
        
        fclose($file);
    }
}

// 创建 Batch
$batch = Bus::batch($this->createExportJobs($startId, $endId))
    ->name('订单导出')
    ->onQueue('exports')
    ->then(function (Batch $batch) use ($exportId) {
        // 导出完成，通知用户
        $this->notifyUser($exportId);
    })
    ->dispatch();

private function createExportJobs(int $startId, int $endId): array
{
    $jobs = [];
    $chunkSize = 10000;
    
    for ($start = $startId; $start <= $endId; $start += $chunkSize) {
        $jobs[] = new ExportOrdersJob(
            startId: $start,
            endId: min($start + $chunkSize - 1, $endId),
            exportId: $this->exportId,
        );
    }
    
    return $jobs;
}
```

### 4.2 按时间窗口分片

```php
class SendDailyReportJob implements ShouldQueue
{
    public function handle(): void
    {
        $yesterday = now()->subDay();
        
        // 按小时分片
        $batch = Bus::batch(
            collect(range(0, 23))->map(function ($hour) use ($yesterday) {
                return new ProcessReportForHourJob(
                    date: $yesterday->format('Y-m-d'),
                    hour: $hour,
                );
            })->toArray()
        )->name("日报处理 - {$yesterday->format('Y-m-d')}")
         ->onQueue('reports')
         ->then(function (Batch $batch) {
             Log::info("日报处理完成");
         })
         ->dispatch();
    }
}

class ProcessReportForHourJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private string $date,
        private int $hour,
    ) {}

    public function handle(): void
    {
        $start = Carbon::parse($this->date)->addHours($this->hour);
        $end = $start->copy()->addHour();
        
        Order::whereBetween('created_at', [$start, $end])
            ->chunkById(500, function ($orders) {
                $this->processOrders($orders);
            });
    }
}
```

### 4.3 按状态分片

```php
class ProcessPendingOrdersJob implements ShouldQueue
{
    public function handle(): void
    {
        // 按状态分片，每个状态一个 Job
        $statuses = ['pending', 'processing', 'shipped', 'delivered'];
        
        $batch = Bus::batch(
            collect($statuses)->map(fn ($status) => 
                new ProcessOrdersByStatusJob($status)
            )->toArray()
        )->name('订单状态处理')
         ->allowFailures()  // 允许部分失败
         ->dispatch();
    }
}

class ProcessOrdersByStatusJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(private string $status) {}

    public function handle(): void
    {
        Order::where('status', $this->status)
            ->chunkById(1000, function ($orders) {
                foreach ($orders as $order) {
                    $this->processOrder($order);
                }
            });
    }
}
```

## 五、进度追踪

### 5.1 Batch 进度回调

```php
$batch = Bus::batch($jobs)
    ->progress(function (Batch $batch) {
        // 每个 Job 完成时触发
        $progress = $batch->progress();
        $this->updateProgressCache($batch->id, $progress);
    })
    ->then(function (Batch $batch) {
        $this->markAsCompleted($batch->id);
    })
    ->dispatch();

private function updateProgressCache(string $batchId, int $progress): void
{
    Cache::put("batch:{$batchId}:progress", $progress, now()->addHours(1));
}
```

### 5.2 前端进度条

```php
// API 端点：获取进度
class BatchProgressController extends Controller
{
    public function show(string $batchId)
    {
        $batch = Bus::findBatch($batchId);
        
        if (!$batch) {
            return response()->json(['error' => 'Batch not found'], 404);
        }
        
        return response()->json([
            'id' => $batch->id,
            'name' => $batch->name,
            'progress' => $batch->progress(),
            'total_jobs' => $batch->totalJobs,
            'pending_jobs' => $batch->pendingJobs,
            'processed_jobs' => $batch->processedJobs(),
            'failed_jobs' => $batch->failedJobs,
            'is_finished' => $batch->isFinished(),
            'is_cancelled' => $batch->cancelled(),
        ]);
    }
}
```

```javascript
// 前端轮询进度
class BatchProgressTracker {
    constructor(batchId, progressBar) {
        this.batchId = batchId;
        this.progressBar = progressBar;
        this.interval = null;
    }

    start() {
        this.interval = setInterval(() => this.checkProgress(), 2000);
    }

    async checkProgress() {
        const response = await fetch(`/api/batches/${this.batchId}/progress`);
        const data = await response.json();

        this.progressBar.setValue(data.progress);
        this.progressBar.setText(`${data.progress}% (${data.processed_jobs}/${data.total_jobs})`);

        if (data.is_finished) {
            this.stop();
            this.onComplete(data);
        }

        if (data.failed_jobs > 0) {
            this.onPartialFailure(data);
        }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    onComplete(data) {
        Swal.fire('完成', `导出已完成，共处理 ${data.total_jobs} 个任务`, 'success');
    }

    onPartialFailure(data) {
        Swal.fire('警告', `${data.failed_jobs} 个任务失败`, 'warning');
    }
}
```

### 5.3 使用 Laravel Echo 实时推送进度

```php
// Job 中广播进度
class ExportOrdersJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(): void
    {
        Order::chunkById(1000, function ($orders) {
            $this->processOrders($orders);
            
            // 广播进度
            broadcast(new BatchProgressUpdated(
                batchId: $this->batchId(),
                progress: $this->batch()->progress(),
            ));
        });
    }
}

// 前端监听
Echo.private(`batch.${batchId}`)
    .listen('BatchProgressUpdated', (e) => {
        progressBar.setValue(e.progress);
    });
```

## 六、实战：百万级数据导出

### 6.1 完整的导出实现

```php
<?php

namespace App\Jobs\Export;

use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ExportOrdersChunkJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 300;  // 5 分钟超时

    public function __construct(
        private string $exportId,
        private int $startId,
        private int $endId,
        private array $filters,
        private string $format,  // csv, xlsx
    ) {}

    public function handle(): void
    {
        $query = Order::query()
            ->whereBetween('id', [$this->startId, $this->endId])
            ->with(['user', 'items.product']);
        
        // 应用筛选条件
        if (!empty($this->filters['status'])) {
            $query->where('status', $this->filters['status']);
        }
        if (!empty($this->filters['date_from'])) {
            $query->where('created_at', '>=', $this->filters['date_from']);
        }
        
        $filePath = $this->getFilePath();
        $file = fopen($filePath, 'w');
        
        // 写入表头（只有第一个 chunk）
        if ($this->startId === $this->getFirstStartId()) {
            $this->writeHeader($file);
        }
        
        // 写入数据
        $query->chunkById(500, function ($orders) use ($file) {
            foreach ($orders as $order) {
                $this->writeRow($file, $order);
            }
        });
        
        fclose($file);
    }

    private function writeHeader($file): void
    {
        fputcsv($file, [
            '订单ID', '用户', '商品', '总金额', '状态', '创建时间'
        ]);
    }

    private function writeRow($file, $order): void
    {
        fputcsv($file, [
            $order->id,
            $order->user->name,
            $order->items->pluck('product.name')->implode(', '),
            number_format($order->total / 100, 2),
            $order->status,
            $order->created_at->format('Y-m-d H:i:s'),
        ]);
    }

    private function getFilePath(): string
    {
        return storage_path("exports/{$this->exportId}/chunk_{$this->startId}.csv");
    }

    private function getFirstStartId(): int
    {
        return Cache::get("export:{$this->exportId}:first_start_id", $this->startId);
    }
}

// 创建导出任务
class ExportService
{
    public function createExport(array $filters, string $format = 'csv'): string
    {
        $exportId = Str::uuid();
        
        // 确定 ID 范围
        $minId = Order::min('id') ?? 0;
        $maxId = Order::max('id') ?? 0;
        
        // 记录第一个 chunk 的起始 ID
        Cache::put("export:{$exportId}:first_start_id", $minId, now()->addHours(1));
        
        // 创建 Job 列表
        $jobs = [];
        $chunkSize = 10000;
        
        for ($start = $minId; $start <= $maxId; $start += $chunkSize) {
            $jobs[] = new ExportOrdersChunkJob(
                exportId: $exportId,
                startId: $start,
                endId: min($start + $chunkSize - 1, $maxId),
                filters: $filters,
                format: $format,
            );
        }
        
        // 创建 Batch
        $batch = Bus::batch($jobs)
            ->name("订单导出 - {$exportId}")
            ->onQueue('exports')
            ->allowFailures()
            ->then(function () use ($exportId) {
                $this->mergeChunks($exportId);
                $this->notifyUser($exportId);
            })
            ->catch(function ($batch) use ($exportId) {
                $this->handleExportFailure($exportId, $batch);
            })
            ->dispatch();
        
        return $exportId;
    }

    private function mergeChunks(string $exportId): void
    {
        $exportDir = storage_path("exports/{$exportId}");
        $finalFile = storage_path("exports/{$exportId}.csv");
        
        $output = fopen($finalFile, 'w');
        $firstChunk = true;
        
        foreach (glob("{$exportDir}/chunk_*.csv") as $chunkFile) {
            $input = fopen($chunkFile, 'r');
            
            // 跳过后续 chunk 的表头
            if (!$firstChunk) {
                fgetcsv($input);
            }
            
            while (($row = fgetcsv($input)) !== false) {
                fputcsv($output, $row);
            }
            
            fclose($input);
            $firstChunk = false;
        }
        
        fclose($output);
        
        // 清理临时文件
        $this->cleanupChunks($exportDir);
    }
}
```

### 6.2 导出 API

```php
class ExportController extends Controller
{
    public function store(ExportRequest $request, ExportService $service)
    {
        $exportId = $service->createExport(
            filters: $request->validated(),
            format: $request->input('format', 'csv')
        );
        
        return response()->json([
            'export_id' => $exportId,
            'status_url' => route('exports.status', $exportId),
        ], 202);
    }

    public function status(string $exportId)
    {
        $batch = Bus::findBatch($exportId);
        
        if (!$batch) {
            return response()->json(['error' => 'Export not found'], 404);
        }
        
        $response = [
            'id' => $exportId,
            'progress' => $batch->progress(),
            'is_finished' => $batch->isFinished(),
        ];
        
        if ($batch->isFinished()) {
            $response['download_url'] = route('exports.download', $exportId);
        }
        
        return response()->json($response);
    }

    public function download(string $exportId)
    {
        $filePath = storage_path("exports/{$exportId}.csv");
        
        if (!file_exists($filePath)) {
            return response()->json(['error' => 'File not found'], 404);
        }
        
        return response()->download($filePath, "orders_export_{$exportId}.csv");
    }
}
```

## 七、实战：批量通知发送

### 7.1 限流与重试

```php
class SendBatchNotificationJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 60;

    public function __construct(
        private array $userIds,
        private string $template,
        private array $data,
    ) {}

    public function handle(): void
    {
        $users = User::whereIn('id', $this->userIds)->get();
        
        foreach ($users as $user) {
            // 限流：每秒最多发送 10 条
            usleep(100000);  // 100ms
            
            try {
                $user->notify(new BatchNotification(
                    template: $this->template,
                    data: $this->data,
                ));
            } catch (\Exception $e) {
                Log::warning("发送通知失败: user={$user->id}", [
                    'error' => $e->getMessage(),
                ]);
                
                // 记录失败但不中断
                $this->recordFailure($user->id, $e);
            }
        }
    }

    public function retryUntil(): \DateTime
    {
        return now()->addHours(1);
    }
}
```

### 7.2 优先级队列

```php
class NotificationBatchService
{
    public function sendToAll(string $template, array $data, string $priority = 'normal'): void
    {
        $userIds = User::pluck('id')->toArray();
        
        $jobs = collect($userIds)
            ->chunk(100)
            ->map(fn ($chunk) => new SendBatchNotificationJob(
                userIds: $chunk->toArray(),
                template: $template,
                data: $data,
            ))
            ->toArray();
        
        Bus::batch($jobs)
            ->name("批量通知 - {$template}")
            ->onQueue($priority === 'high' ? 'notifications-high' : 'notifications')
            ->allowFailures()
            ->dispatch();
    }
}
```

## 八、实战：数据库批量更新

### 8.1 安全的批量更新

```php
class BatchUpdatePricesJob implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600;

    public function __construct(
        private string $category,
        private float $multiplier,
    ) {}

    public function handle(): void
    {
        Product::where('category', $this->category)
            ->chunkById(500, function ($products) {
                DB::transaction(function () use ($products) {
                    foreach ($products as $product) {
                        $newPrice = (int) ($product->price * $this->multiplier);
                        
                        $product->update([
                            'price' => $newPrice,
                            'price_updated_at' => now(),
                        ]);
                        
                        // 记录价格变更历史
                        PriceHistory::create([
                            'product_id' => $product->id,
                            'old_price' => $product->getOriginal('price'),
                            'new_price' => $newPrice,
                            'reason' => 'batch_update',
                        ]);
                    }
                });
                
                // 每批处理后休息一下，避免数据库压力过大
                usleep(50000);  // 50ms
            });
    }
}
```

### 8.2 事务与锁治理

```php
class SafeBatchUpdateService
{
    public function updateWithLock(string $model, array $conditions, array $updates): void
    {
        $query = $model::query();
        
        foreach ($conditions as $field => $value) {
            $query->where($field, $value);
        }
        
        $query->chunkById(100, function ($records) use ($updates) {
            DB::transaction(function () use ($records, $updates) {
                foreach ($records as $record) {
                    // 使用悲观锁
                    $locked = $model::lockForUpdate()->find($record->id);
                    
                    if ($locked) {
                        $locked->update($updates);
                    }
                }
            });
        });
    }
}
```

## 九、失败处理

### 9.1 死信队列

```php
class BatchJobFailedListener
{
    public function handle(JobFailed $event): void
    {
        $job = $event->job;
        $exception = $event->exception;
        
        // 记录到死信队列
        FailedJob::create([
            'connection' => $job->getConnectionName(),
            'queue' => $job->getQueue(),
            'payload' => $job->getRawBody(),
            'exception' => $exception->getMessage(),
            'failed_at' => now(),
        ]);
        
        // 如果是 Batch 的一部分，通知 Batch
        if (method_exists($job, 'batch')) {
            $batch = $job->batch();
            if ($batch) {
                Log::warning("Batch {$batch->id} 中有 Job 失败", [
                    'job' => get_class($job),
                    'error' => $exception->getMessage(),
                ]);
            }
        }
    }
}
```

### 9.2 告警通知

```php
class BatchFailureAlert
{
    public function handle(Batch $batch): void
    {
        if ($batch->failedJobs > 0) {
            $failureRate = $batch->failedJobs / $batch->totalJobs;
            
            // 失败率超过 10% 发送告警
            if ($failureRate > 0.1) {
                Notification::route('slack', '#ops-alerts')
                    ->notify(new BatchFailureNotification(
                        batchId: $batch->id,
                        batchName: $batch->name,
                        totalJobs: $batch->totalJobs,
                        failedJobs: $batch->failedJobs,
                        failureRate: $failureRate,
                    ));
            }
        }
    }
}
```

### 9.3 手动重试

```php
class BatchRetryController extends Controller
{
    public function retry(string $batchId)
    {
        $batch = Bus::findBatch($batchId);
        
        if (!$batch) {
            return response()->json(['error' => 'Batch not found'], 404);
        }
        
        // 重试所有失败的 Job
        foreach ($batch->failedJobs as $failedJob) {
            $failedJob->retry();
        }
        
        return response()->json([
            'message' => '已重试 ' . $batch->failedJobs . ' 个失败的 Job',
        ]);
    }
}
```

## 十、性能调优

### 10.1 队列 Worker 配置

```bash
# .env 配置
QUEUE_CONNECTION=redis
QUEUE_BATCH_DRIVER=database

# Supervisor 配置
[program:laravel-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/artisan queue:work redis --queue=exports,default --tries=3 --timeout=300 --memory=512
autostart=true
autorestart=true
numprocs=4
```

### 10.2 内存限制

```php
class MemoryAwareJob implements ShouldQueue
{
    public function handle(): void
    {
        $memoryLimit = 256 * 1024 * 1024;  // 256MB
        
        Order::chunkById(1000, function ($orders) use ($memoryLimit) {
            foreach ($orders as $order) {
                $this->processOrder($order);
            }
            
            // 检查内存使用
            if (memory_get_usage() > $memoryLimit * 0.8) {
                // 强制垃圾回收
                gc_collect_cycles();
                
                Log::warning('内存使用过高，已触发 GC', [
                    'memory' => memory_get_usage(),
                    'peak' => memory_get_peak_usage(),
                ]);
            }
        });
    }
}
```

### 10.3 超时设置

```php
class ExportJob implements ShouldQueue
{
    public int $timeout = 300;           // Job 超时 5 分钟
    public int $retryAfter = 600;        // 重试等待 10 分钟
    public int $maxExceptions = 3;       // 最大异常次数
    
    public function retryUntil(): \DateTime
    {
        return now()->addHours(2);  // 2 小时内可重试
    }
}
```

## 十一、与 Laravel Horizon 的集成监控

### 11.1 Horizon 配置

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['default', 'exports', 'notifications'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 10,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 512,
            'tries' => 3,
            'timeout' => 300,
            'nice' => 0,
        ],
    ],
],
```

### 11.2 Horizon 监控 API

```php
class HorizonMonitorController extends Controller
{
    public function stats()
    {
        $stats = [
            'jobs_per_minute' => app(HorizonRepository::class)->recentJobs()->count(),
            'wait_time' => app(HorizonRepository::class)->waitTime(),
            'queue_lengths' => app(HorizonRepository::class)->metrics(),
        ];
        
        return response()->json($stats);
    }
}
```

## 十二、踩坑记录与最佳实践

### 12.1 踩坑一：Batch Job 的序列化问题

**问题**：Batch Job 中使用了不可序列化的对象（如数据库连接、文件句柄）。

**解决方案**：
```php
class ExportJob implements ShouldQueue
{
    use SerializesModels;
    
    // ✅ 只传 ID，不传 Model
    public function __construct(private int $orderId) {}
    
    // ❌ 不要传整个 Model
    // public function __construct(private Order $order) {}
}
```

### 12.2 踩坑二：队列优先级反转

**问题**：高优先级的 Batch Job 被低优先级的 Job 阻塞。

**解决方案**：使用独立的队列：
```php
Bus::batch($jobs)
    ->onQueue('high-priority-exports')
    ->dispatch();
```

### 12.3 踩坑三：数据库连接池耗尽

**问题**：大量 Batch Job 同时运行，耗尽数据库连接。

**解决方案**：
```php
class ExportJob implements ShouldQueue
{
    public $connection = 'export';  // 使用独立的数据库连接
}
```

## 总结

Laravel Batch 是处理大数据量批量操作的利器。通过合理的分块策略、内存治理、进度追踪和失败处理，我们可以构建出健壮的批量处理系统。

关键要点：

1. **使用 `chunkById()` 代替 `all()`**：避免 OOM
2. **合理设置分块大小**：1000-5000 条为宜
3. **报告进度**：让用户知道处理状态
4. **允许失败**：部分失败不应中断整个 Batch
5. **监控与告警**：使用 Horizon 监控队列状态
6. **超时与重试**：设置合理的超时和重试策略

大数据量批处理不是简单的循环处理，它需要考虑内存、性能、可靠性、可观察性等多个维度。Laravel Batch 为我们提供了强大的基础设施，让我们能够专注于业务逻辑，而不是底层的工程问题。


## 相关阅读

- [Laravel 12.x Pipeline 实战：从 if-else 地狱到管道模式的重构之路](/categories/Laravel/PHP/Laravel-12x-Pipeline-重构实战/)
- [Laravel 数据导入导出实战：Excel/CSV 大文件处理与队列化踩坑记录](/categories/Laravel/PHP/Laravel-数据导入导出实战-Excel-CSV-大文件处理与队列化踩坑记录/)
- [ETL 实战：Laravel + Apache Airflow 数据管道构建](/categories/Laravel/PHP/ETL-实战-Laravel-Airflow-数据管道构建/)
