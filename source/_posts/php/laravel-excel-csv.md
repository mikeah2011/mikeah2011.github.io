---
title: Laravel 数据导入导出实战：Excel/CSV 大文件处理与队列化踩坑记录
date: 2026-06-01
categories:
  - php
tags: [Laravel, Excel, CSV, Maatwebsite, PhpSpreadsheet, 队列, 性能优化]
keywords: [Laravel, Excel, CSV, 数据导入导出实战, 大文件处理与队列化踩坑记录, PHP]
description: '在 B2C 电商后端开发中，Laravel 数据导入导出是高频需求：商品批量上架、订单导出、会员数据迁移、运营报表生成等场景均涉及 Excel 与 CSV 处理。本文基于 30+ Laravel 仓库的真实踩坑经验，深度解析 PhpSpreadsheet、Maatwebsite/Excel、League CSV 三大方案的选型策略，重点解决大文件处理的内存溢出、超时、乱码等痛点，并给出基于 Laravel Queue 的队列化异步导入导出完整落地方案，附可运行的代码示例与性能对比。'
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


## 一、为什么写这篇？

在 B2C 电商后端开发中，数据导入导出是一个"看起来简单、做起来全是坑"的需求：

- **商品批量上架**：运营给一个 5000 行的 Excel，要求一键导入商品库
- **订单导出**：财务要导出最近 3 个月的订单数据，10 万行以上
- **会员数据迁移**：从旧系统迁移到新系统，CSV 格式的用户数据需要清洗后导入
- **运营报表**：每日/每周生成销售报表，导出为 Excel 供运营分析

这些场景的共同特点是：**数据量大、格式复杂、用户期望高**。

### 真实踩过的坑

| 问题 | 表现 | 根因 |
|------|------|------|
| 内存溢出 | `Allowed memory size exhausted` | PhpSpreadsheet 默认将整个文件加载到内存 |
| 超时 | 请求 30s 后 502 | 同步处理大文件，PHP 执行时间限制 |
| 乱码 | 中文显示为 `????` | CSV 编码不是 UTF-8，或 BOM 头问题 |
| 数据丢失 | 导入后发现少了几百行 | Excel 公式未计算、空行未过滤 |
| 格式错乱 | 日期变成了数字 | Excel 内部存储格式与显示格式不一致 |
| 并发冲突 | 多人同时导入同一商品 | 缺少幂等设计和分布式锁 |

本文将从原理到实战，逐一解决这些问题。

---

## 二、核心概念/原理

### 2.1 Laravel 生态中的三大方案

| 方案 | 定位 | 适用场景 | 学习成本 |
|------|------|----------|----------|
| **Maatwebsite/Excel** | Laravel 官方推荐的 Excel 集成包 | 日常导入导出、队列化处理 | ⭐⭐ |
| **PhpSpreadsheet** | 底层 Excel 读写库（PHPExcel 继任者） | 复杂格式、公式、图表 | ⭐⭐⭐ |
| **League CSV** | 纯 CSV 处理库 | 大文件、流式处理 | ⭐⭐ |

### 2.2 内存模型对比

```
传统方式（全量加载）:
┌──────────────────────────────────┐
│         PHP Memory (256MB)       │
│  ┌────────────────────────────┐  │
│  │   整个 Excel 文件加载到内存  │  │
│  │   5000 行 ≈ 50MB          │  │
│  │   50000 行 ≈ 500MB 💥     │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘

流式处理（逐行读取）:
┌──────────────────────────────────┐
│         PHP Memory (256MB)       │
│  ┌──────────┐                    │
│  │ 当前批次  │ ← 只加载 1000 行   │
│  │ 1000 行  │    处理完释放内存    │
│  └──────────┘                    │
│  ┌──────────┐                    │
│  │ 下一批次  │ ← 继续读取         │
│  └──────────┘                    │
└──────────────────────────────────┘
```

### 2.3 队列化异步处理架构

```
用户上传文件
    │
    ▼
┌──────────────┐
│  Controller  │ ── 验证文件格式、大小
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Dispatch    │ ── 推入队列，立即返回 job_id
│  Import Job  │
└──────┬───────┘
       │
       ▼ (后台异步处理)
┌──────────────┐
│  Queue       │ ── 逐块读取、验证、入库
│  Worker      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  通知用户    │ ── 邮件/Slack/站内信
└──────────────┘
```

---

## 三、实战代码

### 3.1 环境准备

```bash
# 安装 Maatwebsite/Excel（Laravel 官方推荐）
composer require maatwebsite/excel

# 发布配置文件
php artisan vendor:publish --provider="Maatwebsite\Excel\ExcelServiceProvider"

# 安装 League CSV（用于纯 CSV 场景）
composer require league/csv
```

配置 `config/excel.php`：

```php
<?php

return [
    'imports' => [
        'read_only' => true,  // 只读模式，减少内存占用
        'heading_row' => [
            'formatter' => 'slug',  // 标题行自动转为 slug 格式
        ],
    ],
    'exports' => [
        'chunk_size' => 1000,  // 分块写入，每块 1000 行
    ],
    'queue' => [
        'connect' => 'redis',
        'queue' => 'imports',  // 专用队列，避免被其他任务阻塞
    ],
];
```

### 3.2 商品批量导入（Import 类）

#### 3.2.1 基础 Import 类

```php
<?php

namespace App\Imports;

use App\Models\Product;
use App\Models\Category;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Maatwebsite\Excel\Concerns\ToCollection;
use Maatwebsite\Excel\Concerns\WithHeadingRow;
use Maatwebsite\Excel\Concerns\WithValidation;
use Maatwebsite\Excel\Concerns\WithBatchInserts;
use Maatwebsite\Excel\Concerns\WithChunkReading;
use Maatwebsite\Excel\Concerns\Importable;

class ProductImport implements
    ToCollection,
    WithHeadingRow,
    WithValidation,
    WithBatchInserts,
    WithChunkReading
{
    use Importable;

    private int $successCount = 0;
    private int $failCount = 0;
    private array $errors = [];

    public function __construct(
        private readonly int $shopId,
        private readonly ?int $batchId = null
    ) {}

    /**
     * 分块读取：每块 1000 行
     * 大文件不会一次性加载到内存
     */
    public function chunkSize(): int
    {
        return 1000;
    }

    /**
     * 批量插入：每批 500 条
     * 减少数据库连接次数
     */
    public function batchSize(): int
    {
        return 500;
    }

    /**
     * 核心处理逻辑
     * 注意：这里是 Collection，不是每次一行
     */
    public function collection(Collection $rows): void
    {
        DB::beginTransaction();

        try {
            $products = [];

            foreach ($rows as $index => $row) {
                try {
                    // 数据清洗与转换
                    $products[] = $this->transformRow($row, $index);
                } catch (\Throwable $e) {
                    $this->failCount++;
                    $this->errors[] = [
                        'row' => $index + 2, // Excel 行号（+2 因为有标题行和 0-index）
                        'message' => $e->getMessage(),
                    ];
                    Log::warning('Product import row failed', [
                        'row' => $index + 2,
                        'error' => $e->getMessage(),
                        'data' => $row->toArray(),
                    ]);
                }
            }

            // 批量插入（忽略重复）
            if (!empty($products)) {
                Product::insertOrIgnore($products);
                $this->successCount += count($products);
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('Product import batch failed', [
                'error' => $e->getMessage(),
                'shop_id' => $this->shopId,
            ]);
            throw $e;
        }
    }

    /**
     * 数据转换：Excel 行 → 数据库记录
     */
    private function transformRow(Collection $row, int $index): array
    {
        // 处理分类：按名称查找，不存在则创建
        $categoryId = $this->resolveCategoryId($row['category'] ?? '');

        // 处理价格：去除货币符号和逗号
        $price = (float) str_replace([',', '¥', '$'], '', $row['price'] ?? '0');

        // 处理日期：Excel 日期格式兼容
        $releaseDate = $this->parseDate($row['release_date'] ?? null);

        return [
            'shop_id' => $this->shopId,
            'batch_id' => $this->batchId,
            'name' => mb_substr(trim($row['name'] ?? ''), 0, 255),
            'sku' => strtoupper(trim($row['sku'] ?? '')),
            'category_id' => $categoryId,
            'price' => $price,
            'stock' => (int) ($row['stock'] ?? 0),
            'description' => trim($row['description'] ?? ''),
            'status' => Product::STATUS_DRAFT,
            'release_date' => $releaseDate,
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    /**
     * 分类解析：按名称查找或创建
     */
    private function resolveCategoryId(string $categoryName): ?int
    {
        if (empty($categoryName)) {
            return null;
        }

        return Category::firstOrCreate(
            ['name' => $categoryName, 'shop_id' => $this->shopId],
            ['slug' => \Str::slug($categoryName)]
        )->id;
    }

    /**
     * 日期解析：兼容多种格式
     */
    private function parseDate(mixed $value): ?string
    {
        if (empty($value)) {
            return null;
        }

        // Excel 内部日期是数字（自 1900-01-01 的天数）
        if (is_numeric($value)) {
            return \Carbon\Carbon::createFromFormat('Y-m-d', '1900-01-01')
                ->addDays((int) $value - 2) // -2 是 Excel 的日期偏移 bug
                ->format('Y-m-d');
        }

        // 尝试多种日期格式
        $formats = ['Y-m-d', 'Y/m/d', 'd/m/Y', 'm/d/Y', 'Y年m月d日'];
        foreach ($formats as $format) {
            $parsed = \Carbon\Carbon::createFromFormat($format, $value);
            if ($parsed !== false) {
                return $parsed->format('Y-m-d');
            }
        }

        return null;
    }

    /**
     * 验证规则
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'sku' => ['required', 'string', 'max:50'],
            'price' => ['required', 'numeric', 'min:0'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'category' => ['nullable', 'string', 'max:100'],
        ];
    }

    /**
     * 自定义验证错误消息
     */
    public function customValidationMessages(): array
    {
        return [
            'name.required' => '商品名称不能为空',
            'sku.required' => 'SKU 不能为空',
            'sku.string' => 'SKU 必须是字符串',
            'price.required' => '价格不能为空',
            'price.numeric' => '价格必须是数字',
            'price.min' => '价格不能为负数',
        ];
    }

    public function getSuccessCount(): int
    {
        return $this->successCount;
    }

    public function getFailCount(): int
    {
        return $this->failCount;
    }

    public function getErrors(): array
    {
        return $this->errors;
    }
}
```

#### 3.2.2 队列化异步导入

```php
<?php

namespace App\Jobs;

use App\Imports\ProductImport;
use App\Models\ImportTask;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Maatwebsite\Excel\Facades\Excel;

class ProcessProductImport implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;           // 最多重试 3 次
    public int $timeout = 600;       // 单个任务最长 10 分钟
    public int $backoff = 60;        // 重试间隔 60 秒

    public function __construct(
        public readonly string $filePath,      // 文件路径（S3 或本地）
        public readonly int $shopId,
        public readonly int $importTaskId,     // 导入任务 ID
        public readonly string $disk = 'local' // 存储盘
    ) {
        $this->queue = 'imports'; // 专用队列
    }

    public function handle(): void
    {
        $task = ImportTask::findOrFail($this->importTaskId);

        // 更新状态为处理中
        $task->update([
            'status' => ImportTask::STATUS_PROCESSING,
            'started_at' => now(),
        ]);

        try {
            $import = new ProductImport(
                shopId: $this->shopId,
                batchId: $task->batch_id
            );

            // 使用队列模式导入（自动分块）
            Excel::import($import, $this->filePath, $this->disk);

            // 更新任务状态
            $task->update([
                'status' => ImportTask::STATUS_COMPLETED,
                'success_count' => $import->getSuccessCount(),
                'fail_count' => $import->getFailCount(),
                'errors' => $import->getErrors(),
                'completed_at' => now(),
            ]);

            // 通知用户
            $this->notifyUser($task);

            Log::info('Product import completed', [
                'task_id' => $task->id,
                'success' => $import->getSuccessCount(),
                'fail' => $import->getFailCount(),
            ]);
        } catch (\Throwable $e) {
            $task->update([
                'status' => ImportTask::STATUS_FAILED,
                'error_message' => $e->getMessage(),
                'completed_at' => now(),
            ]);

            Log::error('Product import failed', [
                'task_id' => $task->id,
                'error' => $e->getMessage(),
            ]);

            throw $e; // 重新抛出，触发重试
        }
    }

    /**
     * 任务失败时的回调
     */
    public function failed(\Throwable $exception): void
    {
        $task = ImportTask::find($this->importTaskId);
        if ($task) {
            $task->update([
                'status' => ImportTask::STATUS_FAILED,
                'error_message' => '导入失败，已重试 ' . $this->tries . ' 次: ' . $exception->getMessage(),
                'completed_at' => now(),
            ]);
        }

        // 发送失败通知
        // Notification::send($task->user, new ImportFailedNotification($task));
    }

    private function notifyUser(ImportTask $task): void
    {
        // 方案 1：邮件通知
        // Mail::to($task->user->email)->send(new ImportCompletedMail($task));

        // 方案 2：站内信
        // $task->user->notifications()->create([...]);

        // 方案 3：Slack 通知
        // Notification::send($task->user, new SlackImportCompleted($task));
    }
}
```

#### 3.2.3 Controller 层

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessProductImport;
use App\Models\ImportTask;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProductImportController extends Controller
{
    /**
     * POST /api/v1/products/import
     * 上传文件并创建异步导入任务
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'file' => [
                'required',
                'file',
                'max:10240', // 最大 10MB
                'mimes:xlsx,xls,csv',
            ],
        ]);

        $file = $request->file('file');

        // 生成唯一文件名，防止冲突
        $filename = 'imports/' . now()->format('Y/m/d') . '/'
            . Str::uuid() . '.' . $file->getClientOriginalExtension();

        // 存储文件
        $path = $file->storeAs('local', $filename);

        // 创建导入任务记录
        $task = ImportTask::create([
            'user_id' => $request->user()->id,
            'shop_id' => $request->user()->shop_id,
            'type' => ImportTask::TYPE_PRODUCT_IMPORT,
            'file_path' => $filename,
            'file_name' => $file->getClientOriginalName(),
            'file_size' => $file->getSize(),
            'status' => ImportTask::STATUS_PENDING,
            'batch_id' => Str::uuid(),
        ]);

        // 推入队列
        ProcessProductImport::dispatch(
            filePath: $filename,
            shopId: $request->user()->shop_id,
            importTaskId: $task->id,
        );

        return response()->json([
            'message' => '文件已上传，正在后台处理',
            'task_id' => $task->id,
            'status' => 'pending',
        ], 202);
    }

    /**
     * GET /api/v1/products/import/{taskId}
     * 查询导入进度
     */
    public function show(int $taskId): JsonResponse
    {
        $task = ImportTask::findOrFail($taskId);

        return response()->json([
            'task_id' => $task->id,
            'status' => $task->status,
            'file_name' => $task->file_name,
            'success_count' => $task->success_count,
            'fail_count' => $task->fail_count,
            'errors' => $task->errors,
            'started_at' => $task->started_at,
            'completed_at' => $task->completed_at,
            'error_message' => $task->error_message,
        ]);
    }
}
```

### 3.3 大数据量导出（Export 类）

#### 3.3.1 基础 Export 类

```php
<?php

namespace App\Exports;

use App\Models\Order;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Maatwebsite\Excel\Concerns\FromQuery;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;
use Maatwebsite\Excel\Concerns\WithColumnFormatting;
use Maatwebsite\Excel\Concerns\WithChunkReading;
use Maatwebsite\Excel\Concerns\ShouldAutoSize;
use Maatwebsite\Excel\Concerns\WithStyles;
use PhpOffice\PhpSpreadsheet\Style\NumberFormat;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

class OrderExport implements
    FromQuery,
    WithHeadings,
    WithMapping,
    WithColumnFormatting,
    WithChunkReading,
    ShouldAutoSize,
    WithStyles
{
    public function __construct(
        private readonly int $shopId,
        private readonly string $startDate,
        private readonly string $endDate,
        private readonly ?string $status = null
    ) {}

    /**
     * 使用 Query Builder（而非 Collection）
     * 关键：不会一次性加载所有数据到内存
     */
    public function query(): Builder
    {
        $query = Order::query()
            ->where('shop_id', $this->shopId)
            ->whereBetween('created_at', [$this->startDate, $this->endDate])
            ->with(['user:id,name,email', 'items.product:id,name,sku'])
            ->orderBy('created_at', 'desc');

        if ($this->status) {
            $query->where('status', $this->status);
        }

        return $query;
    }

    /**
     * 分块读取：每次 1000 条
     */
    public function chunkSize(): int
    {
        return 1000;
    }

    /**
     * 表头
     */
    public function headings(): array
    {
        return [
            '订单号',
            '客户姓名',
            '客户邮箱',
            '商品明细',
            '订单金额',
            '折扣金额',
            '实付金额',
            '支付方式',
            '订单状态',
            '下单时间',
            '支付时间',
            '发货时间',
        ];
    }

    /**
     * 数据映射：模型 → 数组
     */
    public function map($order): array
    {
        return [
            $order->order_no,
            $order->user->name ?? '-',
            $order->user->email ?? '-',
            $this->formatOrderItems($order->items),
            number_format($order->total_amount, 2),
            number_format($order->discount_amount, 2),
            number_format($order->paid_amount, 2),
            $this->formatPaymentMethod($order->payment_method),
            $this->formatStatus($order->status),
            $order->created_at->format('Y-m-d H:i:s'),
            $order->paid_at?->format('Y-m-d H:i:s') ?? '-',
            $order->shipped_at?->format('Y-m-d H:i:s') ?? '-',
        ];
    }

    /**
     * 列格式：金额列保留 2 位小数
     */
    public function columnFormats(): array
    {
        return [
            'E' => NumberFormat::FORMAT_NUMBER_COMMA_SEPARATED1,
            'F' => NumberFormat::FORMAT_NUMBER_COMMA_SEPARATED1,
            'G' => NumberFormat::FORMAT_NUMBER_COMMA_SEPARATED1,
        ];
    }

    /**
     * 样式：表头加粗、金额右对齐
     */
    public function styles(Worksheet $sheet): array
    {
        return [
            1 => ['font' => ['bold' => true, 'size' => 12]],
            'E:G' => ['alignment' => ['horizontal' => 'right']],
        ];
    }

    private function formatOrderItems($items): string
    {
        return $items->map(function ($item) {
            return sprintf('%s x%d', $item->product->name ?? '已删除', $item->quantity);
        })->implode('; ');
    }

    private function formatPaymentMethod(string $method): string
    {
        return match ($method) {
            'credit_card' => '信用卡',
            'alipay' => '支付宝',
            'wechat' => '微信支付',
            'bank_transfer' => '银行转账',
            default => $method,
        };
    }

    private function formatStatus(string $status): string
    {
        return match ($status) {
            'pending' => '待支付',
            'paid' => '已支付',
            'shipped' => '已发货',
            'completed' => '已完成',
            'cancelled' => '已取消',
            'refunded' => '已退款',
            default => $status,
        };
    }
}
```

#### 3.3.2 队列化导出

```php
<?php

namespace App\Jobs;

use App\Exports\OrderExport;
use App\Models\ExportTask;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Maatwebsite\Excel\Facades\Excel;

class ProcessOrderExport implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 1800; // 导出超时 30 分钟

    public function __construct(
        public readonly int $shopId,
        public readonly string $startDate,
        public readonly string $endDate,
        public readonly ?string $status,
        public readonly int $exportTaskId,
        public readonly int $userId,
    ) {
        $this->queue = 'exports';
    }

    public function handle(): void
    {
        $task = ExportTask::findOrFail($this->exportTaskId);

        $task->update([
            'status' => ExportTask::STATUS_PROCESSING,
            'started_at' => now(),
        ]);

        try {
            $filename = sprintf(
                'exports/%s/orders_%s_%s_%s.xlsx',
                now()->format('Y/m/d'),
                $this->shopId,
                $this->startDate,
                $this->endDate
            );

            $export = new OrderExport(
                shopId: $this->shopId,
                startDate: $this->startDate,
                endDate: $this->endDate,
                status: $this->status
            );

            // 存储到本地或 S3
            Excel::store($export, $filename, 'local');

            $task->update([
                'status' => ExportTask::STATUS_COMPLETED,
                'file_path' => $filename,
                'file_size' => Storage::disk('local')->size($filename),
                'completed_at' => now(),
            ]);

            // 生成临时下载链接（有效期 24 小时）
            $downloadUrl = Storage::disk('local')->temporaryUrl(
                $filename,
                now()->addHours(24)
            );

            $task->update(['download_url' => $downloadUrl]);

            // 通知用户下载
            $this->notifyUser($task);

            Log::info('Order export completed', [
                'task_id' => $task->id,
                'file' => $filename,
            ]);
        } catch (\Throwable $e) {
            $task->update([
                'status' => ExportTask::STATUS_FAILED,
                'error_message' => $e->getMessage(),
                'completed_at' => now(),
            ]);

            throw $e;
        }
    }

    private function notifyUser(ExportTask $task): void
    {
        // 通知实现...
    }
}
```

### 3.4 纯 CSV 流式处理（League CSV）

当数据量极大（百万级）或不需要 Excel 格式时，League CSV 是更好的选择：

```php
<?php

namespace App\Services;

use League\Csv\Reader;
use League\Csv\Writer;
use League\Csv\CharsetConverter;
use League\Csv\Statement;
use Illuminate\Support\Facades\Storage;

class CsvService
{
    /**
     * 流式读取大 CSV 文件
     * 内存占用恒定，不随文件大小增长
     */
    public function readLargeCsv(string $filePath, int $chunkSize = 1000): \Generator
    {
        // 处理编码：检测并转换为 UTF-8
        $csv = Reader::createFromPath(Storage::path($filePath), 'r');
        $csv->setHeaderOffset(0);

        // 自动检测编码
        $inputBom = $csv->getInputBOM();
        if ($inputBom === Reader::BOM_UTF16_LE || $inputBom === Reader::BOM_UTF16_BE) {
            (new CharsetConverter())
                ->inputEncoding('UTF-16')
                ->on($csv);
        }

        // 使用 Statement 进行分页查询
        $stmt = (new Statement())->limit($chunkSize);

        $offset = 0;
        while (true) {
            $stmt = (new Statement())->offset($offset)->limit($chunkSize);
            $records = $stmt->process($csv);

            $batch = iterator_to_array($records);
            if (empty($batch)) {
                break;
            }

            yield $batch;

            $offset += $chunkSize;

            // 释放内存
            unset($batch);
        }
    }

    /**
     * 流式写入大 CSV 文件
     */
    public function writeLargeCsv(string $outputPath, \Generator $rows, array $headers): string
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'csv_');
        $csv = Writer::createFromPath($tempPath, 'w+');

        // 写入 BOM（确保 Excel 正确识别 UTF-8）
        $csv->setOutputBOM(Reader::BOM_UTF8);

        // 写入表头
        $csv->insertOne($headers);

        // 流式写入数据
        $batchSize = 1000;
        $buffer = [];

        foreach ($rows as $row) {
            $buffer[] = $row;

            if (count($buffer) >= $batchSize) {
                $csv->insertAll($buffer);
                $buffer = [];
            }
        }

        // 写入剩余数据
        if (!empty($buffer)) {
            $csv->insertAll($buffer);
        }

        // 移动到目标路径
        $fullPath = Storage::path($outputPath);
        rename($tempPath, $fullPath);

        return $outputPath;
    }

    /**
     * CSV 编码修复：处理常见的乱码问题
     */
    public function fixEncoding(string $filePath): string
    {
        $content = Storage::get($filePath);

        // 检测编码
        $encoding = mb_detect_encoding($content, ['UTF-8', 'GBK', 'GB2312', 'BIG5', 'SJIS'], true);

        if ($encoding === false || $encoding === 'ASCII') {
            return $filePath; // 已经是 UTF-8 或 ASCII
        }

        if ($encoding !== 'UTF-8') {
            // 转换为 UTF-8
            $content = mb_convert_encoding($content, 'UTF-8', $encoding);

            // 去除 BOM（如果有）
            if (str_starts_with($content, "\xEF\xBB\xBF")) {
                $content = substr($content, 3);
            }

            // 保存修复后的文件
            $fixedPath = str_replace('.csv', '_fixed.csv', $filePath);
            Storage::put($fixedPath, $content);

            return $fixedPath;
        }

        return $filePath;
    }
}
```

### 3.5 数据库迁移式大批量导入

当需要导入数十万甚至百万级数据时，ORM 方式太慢，需要直接操作数据库：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use League\Csv\Reader;

class BulkImportService
{
    /**
     * 使用 LOAD DATA INFILE（MySQL 原生批量导入）
     * 比 ORM 快 10-100 倍
     */
    public function loadCsvToDatabase(string $filePath, string $table): int
    {
        $fullPath = Storage::path($filePath);

        $sql = sprintf("
            LOAD DATA LOCAL INFILE '%s'
            INTO TABLE %s
            CHARACTER SET utf8mb4
            FIELDS TERMINATED BY ','
            ENCLOSED BY '\"'
            ESCAPED BY '\\\\'
            LINES TERMINATED BY '\\n'
            IGNORE 1 ROWS
            (name, sku, price, stock, category, description)
            SET
                created_at = NOW(),
                updated_at = NOW(),
                status = 'draft'
        ", addslashes($fullPath), $table);

        $affected = DB::statement($sql);

        return $affected;
    }

    /**
     * 使用临时表 + INSERT SELECT（不支持 LOAD DATA 时的替代方案）
     */
    public function importViaTempTable(string $filePath, string $targetTable): int
    {
        $tempTable = 'temp_import_' . uniqid();

        // 创建临时表
        DB::statement("CREATE TEMPORARY TABLE {$tempTable} (
            name VARCHAR(255),
            sku VARCHAR(50),
            price DECIMAL(10,2),
            stock INT DEFAULT 0,
            category VARCHAR(100),
            description TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        try {
            // 分块插入临时表
            $csv = Reader::createFromPath(Storage::path($filePath), 'r');
            $csv->setHeaderOffset(0);

            $batchSize = 5000;
            $buffer = [];

            foreach ($csv->getRecords() as $record) {
                $buffer[] = [
                    $record['name'] ?? '',
                    $record['sku'] ?? '',
                    (float) ($record['price'] ?? 0),
                    (int) ($record['stock'] ?? 0),
                    $record['category'] ?? '',
                    $record['description'] ?? '',
                ];

                if (count($buffer) >= $batchSize) {
                    DB::table($tempTable)->insert(
                        array_map(fn($row) => array_combine(
                            ['name', 'sku', 'price', 'stock', 'category', 'description'],
                            $row
                        ), $buffer)
                    );
                    $buffer = [];
                }
            }

            // 插入剩余数据
            if (!empty($buffer)) {
                DB::table($tempTable)->insert(
                    array_map(fn($row) => array_combine(
                        ['name', 'sku', 'price', 'stock', 'category', 'description'],
                        $row
                    ), $buffer)
                );
            }

            // 从临时表插入目标表（可做去重/清洗）
            $affected = DB::statement("
                INSERT IGNORE INTO {$targetTable} (name, sku, price, stock, category, description, status, created_at, updated_at)
                SELECT name, sku, price, stock, category, description, 'draft', NOW(), NOW()
                FROM {$tempTable}
                WHERE name IS NOT NULL AND name != ''
            ");

            return $affected;
        } finally {
            DB::statement("DROP TEMPORARY TABLE IF EXISTS {$tempTable}");
        }
    }
}
```

### 3.6 进度追踪（前端轮询 + WebSocket）

```php
<?php

namespace App\Events;

use App\Models\ImportTask;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ImportProgressUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly ImportTask $task,
        public readonly int $processedRows,
        public readonly int $totalRows
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('shop.' . $this->task->shop_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'import.progress';
    }

    public function broadcastWith(): array
    {
        return [
            'task_id' => $this->task->id,
            'status' => $this->task->status,
            'progress' => $this->totalRows > 0
                ? round(($this->processedRows / $this->totalRows) * 100, 1)
                : 0,
            'processed' => $this->processedRows,
            'total' => $this->totalRows,
            'success_count' => $this->task->success_count,
            'fail_count' => $this->task->fail_count,
        ];
    }
}
```

在 Import Job 中广播进度：

```php
// 在 ProcessProductImport 的 handle() 方法中
$import = new ProductImport($this->shopId, $task->batch_id);

// 使用 WithEvents 接口监听导入事件
// 或者手动在每块处理后广播
Excel::import($import, $this->filePath, $this->disk);

// 在 Import 类的 collection 方法末尾添加：
event(new ImportProgressUpdated($task, $this->successCount + $this->failCount, $totalRows));
```

---

## 四、踩坑记录

### 坑 1：Excel 日期变成了数字

**现象**：导入 Excel 后，日期列显示为 `44927` 而不是 `2023-01-15`。

**原因**：Excel 内部以"自 1900-01-01 的天数"存储日期，且有一个历史遗留 bug（1900 年被错误地当作闰年）。

**解决**：

```php
private function parseExcelDate(mixed $value): ?string
{
    if (empty($value)) return null;

    if (is_numeric($value)) {
        // Excel 日期序列号 → Carbon
        // 关键：-2 是因为 Excel 的 Lotus 1-2-3 日期 bug
        return \Carbon\Carbon::create(1899, 12, 30)
            ->addDays((int) $value)
            ->format('Y-m-d');
    }

    // 字符串日期尝试解析...
    return \Carbon::parse($value)->format('Y-m-d');
}
```

### 坑 2：CSV 乱码（GBK vs UTF-8）

**现象**：从 Excel 另存为 CSV 后，中文全部变成乱码。

**原因**：Windows Excel 另存为 CSV 默认使用 GBK 编码，而服务器是 UTF-8。

**解决**：

```php
// 方案 1：在服务器端转换
$content = file_get_contents($path);
$encoding = mb_detect_encoding($content, ['UTF-8', 'GBK', 'GB2312'], true);
if ($encoding !== 'UTF-8') {
    $content = mb_convert_encoding($content, 'UTF-8', $encoding);
    file_put_contents($path, $content);
}

// 方案 2：让前端上传时就转为 UTF-8（推荐）
// 在前端上传组件中添加编码检测和转换

// 方案 3：使用 League CSV 的 CharsetConverter
$csv = League\Csv\Reader::createFromPath($path, 'r');
(new League\Csv\CharsetConverter())
    ->inputEncoding('GBK')
    ->on($csv);
```

### 坑 3：内存溢出（PhpSpreadsheet 默认行为）

**现象**：导入 2 万行 Excel，PHP 报 `Allowed memory size exhausted`。

**原因**：PhpSpreadsheet 默认将整个文件加载到内存，包括所有单元格格式、公式等。

**解决**：

```php
// 方案 1：使用 read_only 模式
$reader = new \PhpOffice\PhpSpreadsheet\Reader\Xlsx();
$reader->setReadDataOnly(true); // 只读数据，忽略格式
$spreadsheet = $reader->load($filePath);

// 方案 2：使用 Maatwebsite/Excel 的 ChunkReading（推荐）
class ProductImport implements WithChunkReading
{
    public function chunkSize(): int
    {
        return 1000; // 每次只加载 1000 行
    }
}

// 方案 3：对于 CSV，使用 League CSV 流式读取
// 详见 3.4 节
```

### 坑 4：导出超时（10 万行订单）

**现象**：导出 10 万行订单数据，请求 30 秒后超时。

**解决**：

```php
// 1. 必须使用队列异步导出
// 2. 使用 FromQuery 而非 FromCollection
class OrderExport implements FromQuery, WithChunkReading
{
    public function query(): Builder
    {
        return Order::query()->where(...); // 延迟加载
    }

    public function chunkSize(): int
    {
        return 1000;
    }
}

// 3. 队列 Worker 设置足够的超时时间
public int $timeout = 1800; // 30 分钟
```

### 坑 5：重复导入（用户点击两次上传按钮）

**现象**：同一个文件被导入两次，产生重复数据。

**解决**：

```php
// 方案 1：前端防抖 + 后端幂等
// 在 Controller 中检查是否有相同文件的导入任务
$existingTask = ImportTask::where('user_id', $userId)
    ->where('file_hash', md5_file($file))
    ->where('status', '!=', ImportTask::STATUS_FAILED)
    ->first();

if ($existingTask) {
    return response()->json([
        'message' => '该文件正在处理中或已处理完成',
        'task_id' => $existingTask->id,
    ], 409);
}

// 方案 2：数据库唯一索引
// 在 products 表上添加 (shop_id, sku) 唯一索引
// 使用 INSERT IGNORE 或 ON DUPLICATE KEY UPDATE

// 方案 3：分布式锁
use Illuminate\Support\Facades\Cache;

$lockKey = "import:shop:{$shopId}";
if (!Cache::lock($lockKey, 300)->get()) {
    return response()->json(['message' => '有导入任务正在进行中'], 429);
}
```

### 坑 6：Excel 公式导致数据错误

**现象**：导入的 Excel 中有 `=SUM(A1:A10)` 公式，读取到的是公式字符串而不是计算结果。

**解决**：

```php
// 方案 1：强制计算公式
$reader = new \PhpOffice\PhpSpreadsheet\Reader\Xlsx();
$reader->setReadDataOnly(false); // 不能设为 true，否则公式会丢失
$spreadsheet = $reader->load($filePath);

// 读取计算后的值（而非公式）
$value = $spreadsheet->getActiveSheet()
    ->getCell('E1')
    ->getCalculatedValue();

// 方案 2：让运营在上传前"粘贴为值"（流程解决）
// 在上传页面提示："请确保 Excel 中没有公式，或将公式结果复制为纯文本"
```

---

## 五、对比/选型建议

### 5.1 三大方案性能对比

| 指标 | Maatwebsite/Excel | PhpSpreadsheet | League CSV |
|------|-------------------|----------------|------------|
| **内存占用** | 低（支持分块） | 高（全量加载） | 极低（流式） |
| **读取速度** | 中等 | 中等 | 极快 |
| **写入速度** | 中等 | 中等 | 极快 |
| **格式支持** | Excel/CSV | Excel/CSV/ODS | 仅 CSV |
| **样式控制** | 支持 | 完整支持 | 不支持 |
| **队列集成** | 原生支持 | 需手动封装 | 需手动封装 |
| **Laravel 集成** | 原生 | 需封装 | 需封装 |

### 5.2 选型决策树

```
需要导入导出 Excel 格式？
├── 是 → 数据量 < 5 万行？
│   ├── 是 → Maatwebsite/Excel（简单场景）
│   └── 否 → Maatwebsite/Excel + ChunkReading + 队列
└── 否 → 只需要 CSV？
    ├── 数据量 < 10 万行 → League CSV
    └── 数据量 > 10 万行 → League CSV + LOAD DATA INFILE
```

### 5.3 性能优化最佳实践

| 场景 | 推荐方案 | 预期性能 |
|------|----------|----------|
| 5000 行商品导入 | Maatwebsite/Excel 同步 | 5-10 秒 |
| 5 万行订单导入 | Maatwebsite/Excel + 队列 | 1-3 分钟 |
| 100 万行数据迁移 | LOAD DATA INFILE | 10-30 秒 |
| 5000 行订单导出 | Maatwebsite/Excel 同步 | 3-5 秒 |
| 10 万行报表导出 | Maatwebsite/Excel + 队列 | 2-5 分钟 |
| 100 万行数据导出 | League CSV + 流式写入 | 1-3 分钟 |

---

## 六、总结与最佳实践

### 核心原则

1. **永远不要同步处理大文件**：超过 1 万行的数据，必须队列化异步处理
2. **分块是王道**：无论是读取还是写入，分块处理是控制内存的关键
3. **编码先行**：在处理 CSV 前，先检测和统一编码
4. **幂等设计**：导入操作必须支持重复执行而不产生重复数据
5. **进度可见**：用户上传后应该能看到处理进度，而不是"请等待"

### 推荐技术栈

```php
// composer.json
{
    "require": {
        "maatwebsite/excel": "^3.1",  // Laravel Excel 集成
        "league/csv": "^9.0",         // 纯 CSV 处理
        "phpoffice/phpspreadsheet": "^1.29"  // 底层库（自动安装）
    }
}
```

### 代码组织建议

```
app/
├── Exports/
│   ├── OrderExport.php          # 订单导出
│   ├── ProductExport.php        # 商品导出
│   └── Concerns/
│       └── WithChineseHeadings.php  # 中文表头 Trait
├── Imports/
│   ├── ProductImport.php        # 商品导入
│   ├── UserImport.php           # 用户导入
│   └── Concerns/
│       └── WithEncodingFix.php  # 编码修复 Trait
├── Jobs/
│   ├── ProcessProductImport.php # 导入队列任务
│   └── ProcessOrderExport.php   # 导出队列任务
├── Models/
│   ├── ImportTask.php           # 导入任务记录
│   └── ExportTask.php           # 导出任务记录
└── Services/
    ├── CsvService.php           # CSV 工具类
    └── BulkImportService.php    # 大批量导入服务
```

### 安全注意事项

1. **文件类型白名单**：只允许 `.xlsx`、`.xls`、`.csv`，拒绝其他格式
2. **文件大小限制**：设置合理的上传限制（建议 10MB）
3. **文件存储隔离**：上传文件存放在非 Web 可访问的目录
4. **数据验证**：导入数据必须经过验证，不能直接入库
5. **敏感数据处理**：导出包含用户隐私数据的文件，应设置下载链接过期时间

---

> **参考资源**
>
> - [Maatwebsite/Excel 官方文档](https://docs.laravel-excel.com/)
> - [PhpSpreadsheet 官方文档](https://phpspreadsheet.readthedocs.io/)
> - [League CSV 官方文档](https://csv.thephpleague.com/)
> - [MySQL LOAD DATA INFILE 文档](https://dev.mysql.com/doc/refman/8.0/en/load-data.html)

---

## 相关阅读

- [Retry with Dead Letter Queue 深度实战：Laravel 队列的失败消息治理](/categories/PHP/Laravel/2026-06-06-Retry-Dead-Letter-Queue-深度实战-Laravel队列失败消息治理/)
- [Laravel Broadcasting 深度实战：Reverb + Private Channel + Presence Channel](/categories/PHP/Laravel/2026-06-06-Laravel-Broadcasting-Reverb-Private-Presence-Channel-B2C-Realtime-Notification/)
- [导入&导出优选CSV格式的理由](/categories/Misc/csv/)
