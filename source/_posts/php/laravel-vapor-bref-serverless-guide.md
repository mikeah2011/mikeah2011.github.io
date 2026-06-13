---
title: Laravel Vapor / Bref Serverless 实战：报表导出与异步任务拆分、冷启动治理与临时存储踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 15:31:03
updated: 2026-05-04 15:33:43
categories:
  - php
tags: [AWS, Laravel, PHP, 消息队列]
keywords: [Laravel Vapor, Bref Serverless, 报表导出与异步任务拆分, 冷启动治理与临时存储踩坑记录, PHP]
description: 结合 Laravel 报表导出与异步任务的线上改造经验，记录如何用 Vapor/Bref 把 API、队列与对象存储拆到 Serverless，重点覆盖冷启动、临时文件、批处理与成本控制踩坑。



---

我们把一段后台"订单报表导出"链路从常驻 ECS 迁到 Serverless，不是为了追热点，而是因为这类流量非常典型：**平时很低、月底和活动后暴涨、单次执行又特别吃 CPU / IO**。继续把它塞在 Laravel FPM 或常驻 worker 里，结果就是机器长期空转，但一到高峰又把 API 实例拖慢。

最后落地的方案是：**Web 请求仍然走 Laravel，真正重的导出、压缩、上传动作拆到 Vapor / Bref 的队列函数里**。这样做完之后，导出高峰不再跟 API 抢资源，平均成本也比常驻两台报表机低很多。但过程中真正踩坑的，不是部署命令，而是冷启动、`/tmp` 临时目录、SQS 可见性超时和大文件分段处理。

本文会从架构设计、部署配置、代码实现、生产踩坑四个维度完整展开，把我们在迁移过程中的所有实战经验一次性讲透。

---

## 一、为什么选 Serverless：问题根源与方案对比

### 1.1 传统 ECS 部署的痛点

在迁移到 Serverless 之前，我们的报表导出跑在两台 4C8G 的 ECS 上，配合 Supervisor 拉起 Laravel Queue Worker。这种架构在日常流量下完全没问题，但一旦到了月底财务结算或者大促结束后的批量报表时段，就会出现三类问题：

- **资源空转**：平时 CPU 利用率不到 10%，两台机器每月成本约 ¥1200，大部分时间在"交房租"。
- **高峰期拖垮 API**：导出和 API 共用实例时，一个 15 万笔订单的 CSV 导出会直接把 `php-fpm` worker 打满，导致正常 API 请求 P99 飙升。
- **扩缩容滞后**：即使配了 Auto Scaling，从触发阈值到新实例 ready 至少 3-5 分钟，而报表高峰往往来得更突然。

### 1.2 Vapor vs Bref vs 传统 ECS 对比

| 维度 | Laravel Vapor | Bref (SAM/CDK) | 传统 ECS + Supervisor |
|------|---------------|-----------------|----------------------|
| **部署复杂度** | 低，一条 `vapor deploy` | 中，需写 `serverless.yml` + SAM 模板 | 低，Docker Compose 或 Supervisor |
| **冷启动** | 有，PHP 层 ~300-800ms | 有，PHP 层 ~300-800ms；可自定义 Bref layer | 无 |
| **最小成本** | 按请求计费，闲置 ≈ $0 | 按请求计费，闲置 ≈ $0 | ¥600+/月起步（单台） |
| **峰值弹性** | 自动，秒级 | 自动，秒级 | 手动或 Auto Scaling（分钟级） |
| **最大执行时长** | 15 分钟（Lambda 限制） | 15 分钟（Lambda 限制） | 无限制 |
| **本地存储** | /tmp 最大 10GB（Ephemeral） | /tmp 最大 10GB（Ephemeral） | 无限（磁盘多大就多大） |
| **队列支持** | SQS，内置 | SQS/自定义 Event | Redis/SQS/Database 均可 |
| **文件存储** | S3 | S3 | 本地磁盘或 EFS |
| **月成本（日均 100 次导出）** | ~$5-15 | ~$5-15 | ¥600-1200 |
| **月成本（日均 5000 次导出）** | ~$50-100 | ~$50-100 | ¥1200-2400（需扩容） |
| **适合场景** | Laravel 项目，快速上 Serverless | 任意 PHP 项目，需精细控制 | 持续高并发、长连接 |

**我们的结论**：报表导出是典型的"低频突发重任务"，完美匹配 Serverless 按请求计费的模型。如果是 7×24 高并发 API，ECS + Octane 反而更合适。

### 1.3 技术栈选择

- **Vapor**：如果你的项目是纯 Laravel，Vapor 是最快的路径，一条命令部署，SQS 队列和 S3 存储开箱即用。
- **Bref**：如果你需要更细粒度的 Lambda 配置控制，或者项目不是纯 Laravel（比如 Lumen、原生 PHP），Bref 更灵活。
- 我们最终选了 **Vapor**，原因是团队对 Laravel 生态熟悉度高，Vapor 的 `vapor.yml` 配置简洁，且内置了数据库 Proxy、缓存等组件，省去了大量 CloudFormation 模板的编写。

---

## 二、整体架构设计

### 2.1 架构总览

```text
┌──────────────────────────────────────────────────────────────────┐
│                         用户 / 运营后台                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│              API Gateway (Vapor / ALB 自动配置)                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│           Lambda: HTTP Runtime (PHP 8.3 + Laravel)               │
│                                                                  │
│   POST /admin/reports/orders/export                              │
│     ├── 鉴权 & 参数校验                                          │
│     ├── 写入 export_histories (status=pending)                   │
│     ├── dispatch(ExportOrdersReportJob) → SQS                    │
│     └── 返回 202 { export_id, status: "pending" }                │
│                                                                  │
│   GET /admin/reports/orders/{id}/download                        │
│     ├── 校验 status === 'finished'                               │
│     └── 生成 S3 临时签名 URL → 返回 302                          │
└──────────────────────────────────────────────────────────────────┘
                             │
                             │ dispatch
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SQS Queue: "exports"                          │
│                                                                  │
│   visibility_timeout = 960s                                      │
│   message_retention = 1209600s (14 天)                           │
│   max_receive_count = 3 (失败 3 次进 DLQ)                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│          Lambda: Queue Runtime (PHP 8.3 + Laravel Worker)        │
│                                                                  │
│   ExportOrdersReportJob::handle()                                │
│     ├── chunkById 流式读取订单数据                                │
│     ├── fputcsv 写入 /tmp/orders-{id}.csv                        │
│     ├── Storage::disk('s3')->put() 上传到 S3                     │
│     ├── 更新 export_histories (status=finished, file_path=...)   │
│     └── /tmp 文件在 Lambda 实例回收时自动清除                     │
│                                                                  │
│   Memory: 2048 MB | Timeout: 900s                                │
└──────────────────────────────────────────────────────────────────┘
                             │
                             │ putObject
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                   S3 Bucket (Private)                            │
│                                                                  │
│   exports/orders/2026/05/04/orders-1234.csv                      │
│   exports/orders/2026/05/04/orders-1235.csv                      │
│                                                                  │
│   Lifecycle: 30 天后自动删除                                      │
│   Encryption: SSE-S3                                             │
└──────────────────────────────────────────────────────────────────┘
                             │
                             │ temporaryUrl (签名 10 分钟)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     用户下载文件                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

这里最关键的设计不是"把 Laravel 扔到 Lambda 上"，而是先拆边界：

1. **HTTP 只负责接单，不做重活。** API 函数的内存只需要 1024MB，处理一个 export 请求不到 100ms，完全够用。
2. **导出文件不落本地磁盘，最终一定进 S3。** Lambda 的 `/tmp` 只是中转，不是最终存储。
3. **状态一定入库，不要靠前端轮询内存状态。** 前端通过 `export_id` 轮询 `GET /admin/reports/orders/{id}/status`，所有状态变化都写 `export_histories` 表。
4. **队列和 API 分开配额。** 报表导出吃 2048MB 内存、最多跑 900 秒；API 只需要 1024MB、30 秒超时。两者混在一起，要么 API 浪费资源，要么导出超时。

### 2.3 状态机设计

```text
export_histories 状态流转：

  pending ──→ processing ──→ finished
     │            │
     │            └──→ failed (超过重试次数)
     │
     └──→ cancelled (用户取消)

关键字段：
  - id: 自增主键
  - type: 'orders' | 'invoices' | 'refunds'
  - status: 'pending' | 'processing' | 'finished' | 'failed' | 'cancelled'
  - file_path: S3 对象 key (nullable)
  - requested_by: 用户 ID
  - filters: JSON (查询条件)
  - attempts: 重试次数
  - error_message: 失败原因 (nullable)
  - created_at / updated_at / finished_at
```

---

## 三、部署配置：API 和队列必须分开

如果导出任务和 API 共用一套 Lambda 规格，通常会出现两个问题：API 浪费内存，或者导出任务频繁超时。我的做法是把 HTTP runtime 和 queue runtime 分开配。

### 3.1 Vapor 部署配置

```yaml
# vapor.yml
id: 12345
name: mikeah-orders-service

environments:
  production:
    runtime: php-8.3:al2
    memory: 1024                    # HTTP 函数内存
    queue-memory: 2048              # 队列函数内存（独立配置！）
    queue-timeout: 900              # 队列函数最大执行时间 15 分钟
    cli-memory: 1024                # Artisan 命令函数内存
    queue-concurrency: 5            # 最多 5 个并发队列 Lambda
    storage: true                   # 启用 Vapor 的 S3 存储桶
    build:
      - 'composer install --no-dev --optimize-autoloader'
      - 'php artisan config:cache'
      - 'php artisan route:cache'
      - 'php artisan view:cache'
      - 'php artisan event:cache'
    deploy:
      - 'php artisan migrate --force'
    warm: 5                         # 预热 5 个实例减少冷启动
    cache: true                     # 启用 ElastiCache (Redis)
    database: true                  # 启用 RDS Proxy

  staging:
    runtime: php-8.3:al2
    memory: 512
    queue-memory: 1024
    queue-timeout: 300
    warm: 2
    build:
      - 'composer install --optimize-autoloader'
      - 'php artisan config:cache'
      - 'php artisan route:cache'
```

几个关键配置项解释：

- **`queue-memory: 2048`**：独立于 `memory: 1024`，因为导出任务需要更多内存来做数据分块和 CSV 写入。如果你的导出涉及大量 join 或复杂计算，可以提到 3008MB（Lambda 最大值是 10240MB）。
- **`queue-timeout: 900`**：Lambda 最大执行时间就是 900 秒（15 分钟）。如果你的任务经常超过这个时间，说明需要拆分成更小的子任务。
- **`queue-concurrency: 5`**：控制同时处理导出任务的 Lambda 实例数。太高会打爆数据库连接池，太低会导致任务排队过久。
- **`warm: 5`**：Vapor 的预热机制，定期 ping 5 个实例保持"温"状态，减少冷启动概率。

### 3.2 Bref 部署配置（对比参考）

如果你走 Bref 而不是 Vapor，对应的 `serverless.yml` 大致如下：

```yaml
# serverless.yml (Bref)
service: mikeah-orders-service

provider:
  name: aws
  region: ap-southeast-1
  runtime: php-83
  memorySize: 1024
  timeout: 30
  environment:
    APP_ENV: production
    QUEUE_CONNECTION: sqs
    FILESYSTEM_DISK: s3
    AWS_BUCKET: !Ref StorageBucket

functions:
  # HTTP 函数
  api:
    handler: public/index.php
    layers:
      - ${bref:layer.php-83-fpm}
    events:
      - httpApi: '*'
    memorySize: 1024
    timeout: 30
    reservedConcurrency: 50          # API 最大并发

  # 队列函数
  queue:
    handler: artisan
    layers:
      - ${bref:layer.php-83}
    events:
      - sqs:
          arn: !GetAtt ExportsQueue.Arn
          batchSize: 1               # 一次只处理 1 条消息
          maximumBatchingWindow: 0    # 不等攒批
    memorySize: 2048                 # 队列专用内存
    timeout: 900                     # 最大 15 分钟
    reservedConcurrency: 5           # 最多 5 个并发

resources:
  Resources:
    ExportsQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:service}-exports
        VisibilityTimeout: 960       # 必须 > Lambda timeout
        MessageRetentionPeriod: 1209600
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt ExportsDLQ.Arn
          maxReceiveCount: 3

    ExportsDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:service}-exports-dlq
        MessageRetentionPeriod: 1209600

    StorageBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${self:service}-exports-${sls:stage}
        LifecycleConfiguration:
          Rules:
            - ExpirationInDays: 30
              Status: Enabled
        BucketEncryption:
          ServerSideEncryptionConfiguration:
            - ServerSideEncryptionByDefault:
                SSEAlgorithm: AES256
```

两者的核心差异在于：Vapor 把 SQS、S3、RDS Proxy 等基础设施的创建和配置都封装了，你只需要在 `vapor.yml` 里说 `storage: true`、`cache: true`。而 Bref 需要你自己写 CloudFormation 资源定义，但换来的是对每一项基础设施的完全控制权。

---

## 四、Laravel 代码实现

### 4.1 数据库迁移

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('export_histories', function (Blueprint $table) {
            $table->id();
            $table->string('type', 50)->index();          // orders, invoices, refunds
            $table->string('status', 20)->default('pending')->index();
            $table->unsignedBigInteger('requested_by');
            $table->json('filters')->nullable();           // 查询条件快照
            $table->string('file_path')->nullable();       // S3 object key
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->text('error_message')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            // 防止重复导出：同一用户、同一类型、同一时间范围只允许一个 pending
            $table->unique(['type', 'requested_by', 'status'], 'unique_pending_export')
                ->where('status', 'pending');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('export_histories');
    }
};
```

### 4.2 导出触发入口

触发入口要非常轻，只做鉴权、记录和派发：

```php
<?php

namespace App\Http\Controllers;

use App\Jobs\ExportOrdersReportJob;
use App\Models\ExportHistory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportExportController extends Controller
{
    public function export(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => 'required|date',
            'to'   => 'required|date|after:from',
        ]);

        // 防重复：同一用户 5 分钟内不能重复提交相同条件
        $recentDuplicate = ExportHistory::query()
            ->where('type', 'orders')
            ->where('requested_by', $request->user()->id)
            ->where('status', 'pending')
            ->where('filters', json_encode($validated))
            ->where('created_at', '>=', now()->subMinutes(5))
            ->exists();

        if ($recentDuplicate) {
            return response()->json([
                'message' => '请勿重复提交，已有一个相同的导出任务在处理中',
            ], 409);
        }

        $history = ExportHistory::query()->create([
            'type'         => 'orders',
            'status'       => 'pending',
            'requested_by' => $request->user()->id,
            'filters'      => $validated,
        ]);

        ExportOrdersReportJob::dispatch(
            exportHistoryId: $history->id,
            from: $validated['from'],
            to: $validated['to'],
        )->onQueue('exports');

        return response()->json([
            'export_id' => $history->id,
            'status'    => 'pending',
            'message'   => '报表正在生成，完成后可在导出记录中下载',
        ], 202);
    }

    public function status(ExportHistory $history): JsonResponse
    {
        return response()->json([
            'export_id' => $history->id,
            'status'    => $history->status,
            'file_path' => $history->status === 'finished' ? $history->file_path : null,
            'error'     => $history->error_message,
            'created_at' => $history->created_at,
            'finished_at' => $history->finished_at,
        ]);
    }
}
```

### 4.3 核心导出 Job（流式处理）

```php
<?php

namespace App\Jobs;

use App\Models\ExportHistory;
use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

class ExportOrdersReportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 900;           // 与 SQS visibility timeout 对齐
    public int $tries = 3;               // 最多重试 3 次
    public int $backoff = 60;            // 重试间隔 60 秒

    public function __construct(
        public int $exportHistoryId,
        public string $from,
        public string $to,
    ) {}

    public function handle(): void
    {
        $history = ExportHistory::query()->findOrFail($this->exportHistoryId);

        // 状态保护：防止 SQS 重复投递导致重复执行
        if ($history->status !== 'pending') {
            Log::warning('Export job skipped: already processed', [
                'export_id' => $history->id,
                'current_status' => $history->status,
            ]);
            return;
        }

        // 使用 CAS 更新，避免并发问题
        $updated = ExportHistory::query()
            ->where('id', $history->id)
            ->where('status', 'pending')
            ->update([
                'status'  => 'processing',
                'attempts' => DB::raw('attempts + 1'),
            ]);

        if (!$updated) {
            Log::warning('Export job skipped: CAS update failed', [
                'export_id' => $history->id,
            ]);
            return;
        }

        // 刷新状态
        $history->refresh();

        try {
            $path = sprintf('/tmp/orders-%s.csv', uniqid());
            $fp = fopen($path, 'w');

            // 写入 CSV 头
            fputcsv($fp, [
                '订单号', '用户ID', '状态', '金额', '支付时间', '创建时间',
            ]);

            $totalRows = 0;

            // 分块拉取，每次 1000 条，避免内存溢出
            Order::query()
                ->select(['id', 'order_no', 'user_id', 'status', 'total_amount', 'paid_at', 'created_at'])
                ->whereBetween('created_at', [$this->from, $this->to])
                ->orderBy('id')
                ->chunkById(1000, function ($orders) use ($fp, &$totalRows) {
                    foreach ($orders as $order) {
                        fputcsv($fp, [
                            $order->order_no,
                            $order->user_id,
                            $this->mapStatus($order->status),
                            number_format($order->total_amount / 100, 2, '.', ''),
                            optional($order->paid_at)?->toDateTimeString(),
                            $order->created_at->toDateTimeString(),
                        ]);
                        $totalRows++;
                    }
                });

            fclose($fp);

            // 检查 /tmp 文件大小（Lambda /tmp 有 512MB-10GB 限制）
            $fileSize = filesize($path);
            Log::info('Export CSV generated', [
                'export_id' => $history->id,
                'rows' => $totalRows,
                'file_size_mb' => round($fileSize / 1024 / 1024, 2),
                'memory_peak_mb' => round(memory_get_peak_usage(true) / 1024 / 1024, 2),
            ]);

            // 上传到 S3
            $objectKey = sprintf(
                'exports/orders/%s/orders-%d.csv',
                date('Y/m/d'),
                $history->id
            );

            Storage::disk('s3')->put($objectKey, fopen($path, 'r'), [
                'ContentType' => 'text/csv; charset=UTF-8',
                'CacheControl' => 'private, max-age=3600',
            ]);

            // 更新状态为完成
            $history->update([
                'status'    => 'finished',
                'file_path' => $objectKey,
                'finished_at' => now(),
            ]);

            // 可选：发送通知（邮件/Slack/钉钉）
            // $history->requestedBy->notify(new ExportFinishedNotification($history));

            Log::info('Export completed', [
                'export_id' => $history->id,
                'object_key' => $objectKey,
                'duration_seconds' => now()->diffInSeconds($history->created_at),
            ]);

        } catch (Throwable $e) {
            $history->update([
                'status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);

            Log::error('Export failed', [
                'export_id' => $history->id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            throw $e; // 重新抛出，让 SQS 重试
        }
    }

    /**
     * 任务失败时的处理
     */
    public function failed(Throwable $exception): void
    {
        ExportHistory::query()
            ->where('id', $this->exportHistoryId)
            ->update([
                'status' => 'failed',
                'error_message' => '任务执行失败，已重试 ' . $this->tries . ' 次: ' . $exception->getMessage(),
            ]);

        Log::critical('Export job permanently failed', [
            'export_id' => $this->exportHistoryId,
            'exception' => $exception->getMessage(),
        ]);
    }

    private function mapStatus(string $status): string
    {
        return match ($status) {
            'pending'  => '待支付',
            'paid'     => '已支付',
            'shipped'  => '已发货',
            'finished' => '已完成',
            'refunded' => '已退款',
            'cancelled' => '已取消',
            default    => $status,
        };
    }
}
```

**三个实战要点：**

- 用 `chunkById`，不要一次性把结果集打进内存。`chunkById` 每次基于上一批的最后一个 `id` 来查询下一批，避免了 `offset` 随数据量增大而变慢的问题。
- 用 `fputcsv` 直接写文件流，别先拼一个超大数组。在 Lambda 的内存限制下，每节省 100MB 内存就意味着你能在更小的 Memory 规格下跑完任务。
- 上传 S3 后只保存对象路径，下载时再签名。这样文件不会经过 Laravel 的响应层，节省了带宽和 Lambda 的执行时间。

### 4.4 S3 文件上传与临时签名下载

```php
<?php

namespace App\Http\Controllers;

use App\Models\ExportHistory;
use Illuminate\Http\JsonResponse;

class ReportDownloadController extends Controller
{
    public function download(ExportHistory $history): JsonResponse
    {
        abort_unless($history->status === 'finished', 404);
        abort_unless($history->requested_by === auth()->id(), 403);

        // 生成 10 分钟有效的临时签名 URL
        $url = Storage::disk('s3')->temporaryUrl(
            $history->file_path,
            now()->addMinutes(10)
        );

        return response()->json([
            'url'         => $url,
            'filename'    => basename($history->file_path),
            'expires_in'  => 600,  // 秒
        ]);
    }

    /**
     * 列出用户的导出记录
     */
    public function index(): JsonResponse
    {
        $exports = ExportHistory::query()
            ->where('requested_by', auth()->id())
            ->orderByDesc('created_at')
            ->limit(50)
            ->get(['id', 'type', 'status', 'created_at', 'finished_at']);

        return response()->json($exports);
    }
}
```

这一步看似普通，但它直接决定了 PHP 会不会再次变成"文件中转站"。只要文件已经在 S3，就没必要再把下载流量拉回 Lambda。**S3 临时签名 URL 的优势**：

- 不消耗 Lambda 的执行时间和内存。
- S3 直接服务下载，带宽无上限。
- 签名过期后自动失效，无需手动清理。
- 支持断点续传（HTTP Range 请求）。

### 4.5 SQS 队列配置最佳实践

```php
<?php

// config/queue.php 中的 SQS 配置
return [
    'connections' => [
        'sqs' => [
            'driver' => 'sqs',
            'key'    => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.ap-southeast-1.amazonaws.com/your-account-id'),
            'queue'  => env('SQS_QUEUE', 'default'),
            'suffix' => '',
            'region' => env('AWS_DEFAULT_REGION', 'ap-southeast-1'),
        ],

        'sqs-exports' => [
            'driver' => 'sqs',
            'key'    => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX'),
            'queue'  => env('SQS_EXPORTS_QUEUE', 'mikeah-orders-service-exports'),
            'suffix' => '',
            'region' => env('AWS_DEFAULT_REGION', 'ap-southeast-1'),
        ],
    ],
];
```

在 `ExportOrdersReportJob` 中使用 `->onQueue('exports')` 时，Laravel 会查找名为 `sqs-exports` 的连接。如果你用 Vapor，这些配置会自动注入，不需要手动设置。

---

## 五、生产环境踩坑实录

### 5.1 坑一：`/tmp` 存储限制——不是你以为的"无限磁盘"

**现象**：导出一份 50 万笔的退款记录时，`/tmp/orders-xxx.csv` 写到 3.2GB，Lambda 直接 OOM Kill，没有任何有意义的错误日志。

**根因**：Lambda 的 `/tmp` 目录有存储上限：
- 默认：**512MB**
- 配置 `ephemeralStorage` 后：最大 **10GB**
- `/tmp` 与 Lambda 内存共享同一块存储资源（但存储和内存是独立计量的）

**解决方案**：

```php
// 方案 1：在 vapor.yml 中增大 /tmp 配额
// Vapor 不直接暴露 ephemeralStorage 配置，需要在 AWS Console 手动修改
// 或使用 Bref 直接配置：

// serverless.yml (Bref)
functions:
  queue:
    ephemeralStorageSize: 2048  # 2GB /tmp

// 方案 2：代码层面优化——分段写入 + 流式上传
// 如果文件可能很大，不要先完整写入 /tmp 再上传
// 而是使用 S3 Multipart Upload：

use Aws\S3\MultipartUploader;
use Aws\Exception\MultipartUploadException;
use Illuminate\Support\Facades\Storage;

$tmpPath = '/tmp/orders-' . uniqid() . '.csv';
$fp = fopen($tmpPath, 'w');
fputcsv($fp, ['order_no', 'user_id', ...]);

// 每写 1000 行就 flush 一次，确保 /tmp 不会积累太多缓冲
Order::query()->chunkById(1000, function ($orders) use ($fp) {
    foreach ($orders as $order) {
        fputcsv($fp, [...]);
    }
    fflush($fp);  // 强制写入磁盘
});
fclose($fp);

// 方案 3：如果数据量极大（百万级），考虑拆分子任务
// 一个 Job 只导出 1 万笔，拆成 50 个子 Job 并行执行
```

**踩坑经验**：

- **监控 `/tmp` 使用量**：在 Job 的 `handle()` 方法中加入 `disk_free_space('/tmp')` 检查，如果剩余空间不足 100MB 就提前告警。
- **及时清理**：每次 `fclose()` 之后立即上传 S3，然后用 `unlink($path)` 删除本地文件。不要在 Job 结束后指望 Lambda 自动清理——有时候实例会被复用。
- **XLSX 的 /tmp 消耗更严重**：PhpSpreadsheet 生成 XLSX 时，内存峰值通常是 CSV 的 5-10 倍，且临时文件也会写到 `/tmp`。如果必须生成 XLSX，建议先生成 CSV，再用 `PhpOffice\PhpSpreadsheet\Reader\Csv` 转换。

### 5.2 坑二：SQS 可见性超时——任务被重复消费

**现象**：报表导出 Job 实际执行 6-8 分钟，但同一份报表被消费了 2 次，生成了两份一模一样的 CSV 文件，且第二份覆盖了第一份的 S3 路径。

**根因**：SQS 的 `VisibilityTimeout` 默认是 30 秒。如果 Job 在 30 秒内没有 `delete` 这条消息，SQS 会认为这个消费者挂了，把消息重新投递给下一个消费者。

**时间线还原**：

```text
T+0s    : Lambda A 从 SQS 取到消息，开始执行
T+30s   : SQS visibility timeout 到期，消息重新可见
T+31s   : Lambda B 从 SQS 取到同一条消息，开始执行（重复！）
T+360s  : Lambda A 执行完成，delete 消息（但 B 已经在跑了）
T+420s  : Lambda B 也执行完成，覆盖了 A 的结果
```

**解决方案**：

```yaml
# SQS 队列配置
VisibilityTimeout: 960  # 必须 > Lambda 的最大执行时间 (900s)
                        # 建议: Lambda timeout + 60s 缓冲

# 或者在 Vapor 中，Vapor 会自动设置 visibility timeout
# 但你需要确保 queue-timeout 配置正确
```

```php
// 代码层面的双重保护
public function handle(): void
{
    $history = ExportHistory::query()->findOrFail($this->exportHistoryId);

    // 保护 1：状态检查，防止重复执行
    if ($history->status !== 'pending') {
        Log::warning('Export job skipped: already processed');
        return;
    }

    // 保护 2：CAS 更新，数据库层面防止并发
    $updated = ExportHistory::query()
        ->where('id', $history->id)
        ->where('status', 'pending')
        ->update(['status' => 'processing']);

    if (!$updated) {
        Log::warning('Export job skipped: CAS update failed');
        return;
    }

    // ... 继续执行导出逻辑
}
```

**踩坑经验**：

- **VisibilityTimeout 必须大于 Lambda timeout**：这是最常见的配置错误。Lambda 执行 900 秒，但 VisibilityTimeout 只有 60 秒，结果就是每条消息都会被消费 15 次。
- **`batchSize` 设为 1**：对于重量级任务，每次只取一条消息。如果 `batchSize > 1`，一条消息的失败可能影响整批消息的处理。
- **Dead Letter Queue (DLQ) 是必须的**：如果一条消息失败 3 次（`maxReceiveCount: 3`），自动转入 DLQ，避免毒消息无限循环。
- **幂等性设计**：即使有了上述保护，也要假设任务可能被执行多次。使用 CAS 更新或乐观锁来保证幂等。

### 5.3 坑三：冷启动——P95 延迟飙升的元凶

**现象**：早上 9 点运营第一波登录，连续点击 5 个导出按钮，前 2-3 个请求的响应时间从平时的 200ms 飙升到 3-5 秒。

**根因**：Lambda 冷启动的典型延迟组成：

```text
冷启动延迟分解 (PHP 8.3 + Laravel)：

  ┌─ Lambda Runtime 初始化          ~100ms
  ├─ PHP 进程启动                   ~50ms
  ├─ Composer Autoloader 加载       ~80ms
  ├─ Laravel Framework Bootstrap    ~200ms
  │   ├─ Config Loading             ~30ms
  │   ├─ Service Providers          ~120ms
  │   └─ Route Registration         ~50ms
  ├─ OPcache 预热                   ~100ms
  └─ 首次请求处理                   ~100ms
  ─────────────────────────────────────
  总计                              ~630ms

  如果内存只有 512MB，可能到 1000ms+
```

**解决方案**：

```php
<?php

// 方案 1：精简 Service Providers（减少 bootstrap 时间）
// config/app.php 中，只注册用到的 Provider
'providers' => [
    // 只保留必要的
    Illuminate\Foundation\Providers\FoundationServiceProvider::class,
    Illuminate\Auth\AuthServiceProvider::class,
    Illuminate\Cache\CacheServiceProvider::class,
    Illuminate\Database\DatabaseServiceProvider::class,
    Illuminate\Queue\QueueServiceProvider::class,
    Illuminate\Filesystem\FilesystemServiceProvider::class,
    // 你的业务 Provider
    App\Providers\AppServiceProvider::class,
    // 移除不需要的：
    // Illuminate\Session\SessionServiceProvider::class,  // API 不需要 session
    // Illuminate\View\ViewServiceProvider::class,         // API 不需要 view
    // Illuminate\Broadcasting\BroadcastServiceProvider::class,
],
```

```php
<?php

// 方案 2：条件加载重型包
// 在 AppServiceProvider 中，只在需要时加载
public function register(): void
{
    // 只在非 Lambda 环境加载开发工具
    if (!app()->runningInConsole() && !config('app.lambda')) {
        $this->app->register(\Barryvdh\LaravelIdeHelper\IdeHelperServiceProvider::class);
    }

    // Lazy register 重型服务
    $this->app->singleton(ExportService::class, function ($app) {
        return new ExportService(
            $app->make(OrderRepository::class),
            $app->make(S3Storage::class)
        );
    });
}
```

```yaml
# 方案 3：Vapor 预热配置
environments:
  production:
    warm: 5  # 保持 5 个"温"实例，减少冷启动概率
```

```php
<?php

// 方案 4：Bref 预热插件
// composer require bref/bref-extra
// 使用 Provisioned Concurrency（预置并发）
// serverless.yml:
// functions:
//   api:
//     provisionedConcurrency: 3  # 始终保持 3 个预热实例
//     # 注意：预置并发有额外费用，约 $15/实例/月
```

**踩坑经验**：

- **内存越大，冷启动越快**：Lambda 分配的 CPU 与内存成正比。512MB 内存对应 0.17 vCPU，2048MB 对应 1 vCPU。把队列函数从 1024MB 提到 2048MB 后，冷启动时间从 ~800ms 降到 ~400ms，虽然内存成本增加，但任务执行时间也缩短了，总成本反而可能下降。
- **`config:cache` 和 `route:cache` 是必须的**：Vapor 的 build 阶段已经帮你做了，但要确保没有遗漏。如果你有动态路由注册，`route:cache` 会报错，需要先修复。
- **OPcache 在 Lambda 中的特殊性**：每次冷启动后 OPcache 是空的，第一次请求会特别慢。Vapor 和 Bref 都内置了 OPcache 预热脚本，但如果你的路由/控制器特别多，预热本身也要 100-200ms。
- **不要为了减少冷启动而滥用 Provisioned Concurrency**：3 个预置实例约 $45/月，对于日均 100 次的报表导出场景，这个成本比按请求计费贵 3-5 倍。只在 API 函数上有 P99 延迟要求时才考虑。

### 5.4 坑四：Lambda 内存调优——找到甜点

**现象**：队列函数配了 3072MB 内存，但实际 `memory_get_peak_usage()` 只有 400MB，每月账单比预期高。

**根因**：Lambda 的计费公式是 `内存 × 执行时间 × 请求数`。内存从 1024MB 提到 3072MB，即使执行时间缩短了，总成本也可能更高。

**调优方法**：

```php
// 在 Job handle() 中监控内存使用
$startTime = microtime(true);
$startMemory = memory_get_usage(true);

// ... 执行导出逻辑 ...

$peakMemory = memory_get_peak_usage(true);
$duration = microtime(true) - $startTime;

Log::info('Export resource usage', [
    'export_id'    => $history->id,
    'duration_sec' => round($duration, 2),
    'peak_memory_mb' => round($peakMemory / 1024 / 1024, 2),
    'lambda_memory_mb' => getenv('AWS_LAMBDA_FUNCTION_MEMORY_SIZE'),
    'memory_utilization' => round($peakMemory / (intval(getenv('AWS_LAMBDA_FUNCTION_MEMORY_SIZE')) * 1024 * 1024) * 100, 1) . '%',
]);
```

**内存调优参考表**：

| 数据量 | 推荐内存 | 预计执行时间 | 单次成本 (us-east-1) |
|--------|---------|-------------|---------------------|
| 1 万笔 | 1024 MB | ~10 秒 | ~$0.0002 |
| 10 万笔 | 1024 MB | ~60 秒 | ~$0.001 |
| 50 万笔 | 2048 MB | ~120 秒 | ~$0.005 |
| 100 万笔 | 2048 MB | ~300 秒 | ~$0.012 |
| 500 万笔 | 3008 MB | ~900 秒 | ~$0.056 |

**踩坑经验**：

- **内存利用率目标 60-80%**：太低浪费钱，太高有 OOM 风险。
- **CPU 与内存成正比**：2048MB = 1 vCPU，如果你的任务 CPU 密集（如 CSV 编码、压缩），提高内存可以缩短执行时间，总成本反而可能下降。
- **用 AWS Lambda Power Tuning 工具**：这是一个开源工具（`alexcasalboni/aws-lambda-power-tuning`），自动测试不同内存配置下的执行时间和成本，帮你找到最优配置。

### 5.5 坑五：XLSX 比你想的更贵

很多业务一上来就要 Excel，但在 Serverless 场景里，XLSX 生成通常比 CSV 更吃内存和 CPU。

```php
<?php

// CSV 方式（推荐）：内存占用低，速度快
// 10 万笔订单：~50MB 内存，~15 秒
$fp = fopen('/tmp/orders.csv', 'w');
fputcsv($fp, ['header1', 'header2']);
foreach ($rows as $row) {
    fputcsv($fp, $row);
}
fclose($fp);

// XLSX 方式（谨慎使用）：内存占用高，速度慢
// 10 万笔订单：~300MB 内存，~90 秒
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

$spreadsheet = new Spreadsheet();
$sheet = $spreadsheet->getActiveSheet();
$sheet->fromArray($headers, null, 'A1');
$rowNum = 2;
foreach ($rows as $row) {
    $sheet->fromArray($row, null, 'A' . $rowNum);
    $rowNum++;
}
$writer = new Xlsx($spreadsheet);
$writer->save('/tmp/orders.xlsx');
$spreadsheet->disconnectWorksheets(); // 释放内存！
```

**建议**：后台导出优先 CSV，运营真正需要格式化时再离线二次处理（比如用 Python 或 Excel 宏转换）。如果必须支持 XLSX，把 Lambda 内存调到 3008MB 以上，并在 Job 中加入 `memory_get_peak_usage()` 监控。

### 5.6 坑六：数据库连接池爆满

**现象**：5 个并发队列 Lambda 同时执行导出，每个都在 `chunkById` 时持有数据库连接，导致 RDS 的 `max_connections` 被打满。

**解决方案**：

```php
<?php

// 方案 1：使用 RDS Proxy（Vapor 内置）
// vapor.yml: database: true 会自动创建 RDS Proxy
// RDS Proxy 可以复用连接，50 个 Lambda 共享 20 个数据库连接

// 方案 2：控制队列并发
// vapor.yml: queue-concurrency: 3

// 方案 3：代码层面，读完数据立即释放连接
Order::query()
    ->select([...])
    ->whereBetween('created_at', [$this->from, $this->to])
    ->orderBy('id')
    ->chunkById(1000, function ($orders) use ($fp) {
        // chunkById 内部会自动管理连接
        foreach ($orders as $order) {
            fputcsv($fp, [...]);
        }
    });

// 如果担心连接占用，可以在 chunk 之间手动释放
DB::connection()->getPdo()?->close(); // 慎用，会影响后续查询
```

---

## 六、监控与告警

Serverless 的监控比传统架构更重要，因为你看不到"服务器"，只能看到函数指标。

### 6.1 CloudWatch 关键指标

```yaml
# 告警配置示例（CloudFormation / SAM）
Resources:
  ExportQueueDepthAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: export-queue-depth-high
      MetricName: ApproximateNumberOfMessagesVisible
      Namespace: AWS/SQS
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 10
      ComparisonOperator: GreaterThanThreshold
      AlarmDescription: "导出队列积压超过 10 条"

  ExportDurationAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: export-duration-high
      MetricName: Duration
      Namespace: AWS/Lambda
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 600000  # 600 秒（10 分钟）
      ComparisonOperator: GreaterThanThreshold
      AlarmDescription: "导出函数平均执行时间超过 10 分钟"

  ExportErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: export-errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 3
      ComparisonOperator: GreaterThanOrEqualToThreshold
      AlarmDescription: "导出函数 5 分钟内错误 ≥ 3 次"
```

### 6.2 日志聚合

```php
<?php

// 在 config/logging.php 中配置 CloudWatch 日志通道
'channels' => [
    'cloudwatch' => [
        'driver' => 'monolog',
        'handler' => \Monolog\Handler\StreamHandler::class,
        'with' => [
            'stream' => 'php://stderr',  // Lambda 会自动把 stderr 转发到 CloudWatch
        ],
        'formatter' => \Monolog\Formatter\JsonFormatter::class,
    ],
],
```

---

## 七、什么时候值得上 Vapor / Bref

我自己的判断标准很简单：

- **流量有明显峰谷，常驻机器利用率低**：报表导出、月末批处理、活动后汇总。
- **任务天然异步，能接受排队执行**：导出、压缩、通知、数据同步。
- **文件、图片、报表这类重 IO 任务可以外置到 S3**：不需要本地持久化存储。
- **团队已经能接受云上观测、队列和对象存储这一套约束**：CloudWatch、SQS、S3。

**不适合的场景**：

- **持续高并发、低延迟**：WebSocket、长连接、实时通信，用 Octane + ECS 更合适。
- **需要本地文件持久化**：比如用户上传的文件需要在本地处理，Lambda 的 `/tmp` 不可靠。
- **执行时间超过 15 分钟**：Lambda 的硬限制，需要拆分任务或用 Step Functions 编排。
- **需要 GPU 计算**：Lambda 不支持 GPU，ML 推理、视频转码需要 EC2 或 ECS。

真正决定方案成败的，不是 Vapor 还是 Bref，而是你有没有先把任务拆成"接单、执行、存档、下载"四个阶段，并接受云函数对本地状态、执行时长和文件系统的限制。

---

## 八、成本估算与优化技巧

### 8.1 月成本估算

以日均 200 次报表导出（每次平均 5 万笔数据，执行 60 秒，内存 2048MB）为例：

| 项目 | 计算方式 | 月成本 |
|------|---------|--------|
| Lambda 队列函数 | 2048MB × 60s × 200次/天 × 30天 | ~$7.50 |
| Lambda HTTP 函数 | 1024MB × 0.5s × 200次/天 × 30天 | ~$0.06 |
| SQS 请求 | 200次/天 × 30天 × $0.40/百万 | ~$0.002 |
| S3 存储 | 200 × 5MB × 30天 ≈ 30GB × $0.023/GB | ~$0.69 |
| API Gateway | 400次/天 × 30天 × $3.50/百万 | ~$0.04 |
| **合计** | | **~$8.30/月** |

对比传统 ECS（2 台 4C8G）：¥600-1200/月（约 $83-166）。**成本降低 90%+**。

### 8.2 优化技巧

1. **用 Spot/Reserved 实例处理非实时任务**：如果导出不需要秒级响应，可以用 Step Functions 加上延迟队列，在凌晨低价时段执行。
2. **S3 生命周期策略**：导出文件 30 天后自动删除，避免存储成本持续增长。
3. **压缩 CSV**：在上传 S3 前用 `gzopen` 压缩，文件大小减少 70-80%，S3 存储和下载带宽都省。

```php
// 上传前压缩
$gzPath = $path . '.gz';
$fp = fopen($path, 'r');
$gz = gzopen($gzPath, 'wb9');
while (!feof($fp)) {
    gzwrite($gz, fread($fp, 8192));
}
gzclose($gz);
fclose($fp);
unlink($path); // 删除原始 CSV

Storage::disk('s3')->put($objectKey . '.gz', fopen($gzPath, 'r'), [
    'ContentType' => 'application/gzip',
    'ContentEncoding' => 'gzip',
]);
```

4. **DLQ 消息告警**：Dead Letter Queue 里的消息意味着任务彻底失败，需要人工介入。设置 SQS → SNS → 邮件的告警链路。

---

## 相关阅读

- [Laravel 缓存策略全解：Route/Config/View/Query 缓存最佳实践踩坑记录](/categories/PHP/laravel-cache-route-config-view-query-cache/) — Serverless 场景下缓存策略的选型和配置，对减少冷启动延迟有直接帮助。
- [Laravel + PostgreSQL SKIP LOCKED 实战：不用 Redis 也能做任务出队、重试回收与死锁规避](/categories/PHP/laravel-postgresql-skip-locked-guide-redis-lock/) — 如果你的队列场景不需要 SQS 的分布式能力，数据库队列 + SKIP LOCKED 是更轻量的替代方案。
- [PHP OpCache 调优实战：高并发场景下的内存优化与真实踩坑记录](/categories/PHP/php-opcache-guide-high-concurrencyoptimization/) — Lambda 冷启动优化的关键环节之一就是 OPcache 的预热和调优，本文深入讲解了生产环境中的 OPcache 陷阱。