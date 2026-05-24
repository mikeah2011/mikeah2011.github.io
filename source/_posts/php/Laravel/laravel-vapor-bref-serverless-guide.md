---
title: Laravel Vapor / Bref Serverless 实战：报表导出与异步任务拆分、冷启动治理与临时存储踩坑记录
date: 2026-05-04 15:31:03
updated: 2026-05-04 15:33:43
categories:
  - PHP
  - Laravel
tags: [AWS, Laravel, PHP, 消息队列]
description: 结合 Laravel 报表导出与异步任务的线上改造经验，记录如何用 Vapor/Bref 把 API、队列与对象存储拆到 Serverless，重点覆盖冷启动、临时文件、批处理与成本控制踩坑。



---
我们把一段后台“订单报表导出”链路从常驻 ECS 迁到 Serverless，不是为了追热点，而是因为这类流量非常典型：**平时很低、月底和活动后暴涨、单次执行又特别吃 CPU / IO**。继续把它塞在 Laravel FPM 或常驻 worker 里，结果就是机器长期空转，但一到高峰又把 API 实例拖慢。

最后落地的方案是：**Web 请求仍然走 Laravel，真正重的导出、压缩、上传动作拆到 Vapor / Bref 的队列函数里**。这样做完之后，导出高峰不再跟 API 抢资源，平均成本也比常驻两台报表机低很多。但过程中真正踩坑的，不是部署命令，而是冷启动、`/tmp` 临时目录、SQS 可见性超时和大文件分段处理。

## 一、我们最后上线的结构

```text
Admin UI
  │
  │ POST /admin/reports/orders/export
  ▼
Laravel API on Vapor / Bref HTTP Runtime
  │
  ├── 写入 export_histories
  ├── dispatch(new ExportOrdersReportJob(...))
  ▼
SQS Queue
  ▼
Lambda Queue Runtime
  │
  ├── chunkById 拉订单数据
  ├── 写 CSV 到 /tmp/orders-xxxx.csv
  ├── 上传到 S3 private bucket
  └── 更新 export_histories 为 finished
  ▼
S3
  ▼
临时签名下载 URL
```

这里最关键的设计不是“把 Laravel 扔到 Lambda 上”，而是先拆边界：

1. **HTTP 只负责接单，不做重活。**
2. **导出文件不落本地磁盘，最终一定进 S3。**
3. **状态一定入库，不要靠前端轮询内存状态。**

## 二、部署配置别把 API 和队列混成一个规格

如果导出任务和 API 共用一套 Lambda 规格，通常会出现两个问题：API 浪费内存，或者导出任务频繁超时。我的做法是把 HTTP runtime 和 queue runtime 分开配。

```yaml
# vapor.yml
id: 12345
name: mikeah2011-blog-demo
environments:
  production:
    runtime: php-8.3:al2
    memory: 1024
    queue-memory: 2048
    queue-timeout: 900
    cli-memory: 1024
    build:
      - 'composer install --no-dev --optimize-autoloader'
      - 'php artisan config:cache'
      - 'php artisan route:cache'
    deploy:
      - 'php artisan migrate --force'
```

如果你走 Bref，也建议把 `web` 和 `queue` 函数拆开，而不是一个函数全包。报表导出、图片压缩、批量补数，本质上都不该拿 API 那点内存去赌。

## 三、Laravel 里的导出任务要天然支持分块

我最早的版本是 `Order::with(...)->get()`，测试库几千笔没问题，一上生产十几万笔直接把内存顶满。后来改成 `chunkById` + `fputcsv`，让函数始终以流式方式工作。

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
use Illuminate\Support\Facades\Storage;

class ExportOrdersReportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 900;

    public function __construct(
        public int $exportHistoryId,
        public string $from,
        public string $to,
    ) {}

    public function handle(): void
    {
        $history = ExportHistory::query()->findOrFail($this->exportHistoryId);
        $path = sprintf('/tmp/orders-%d.csv', $history->id);
        $fp = fopen($path, 'w');

        fputcsv($fp, ['order_no', 'user_id', 'status', 'total_amount', 'paid_at']);

        Order::query()
            ->select(['id', 'order_no', 'user_id', 'status', 'total_amount', 'paid_at'])
            ->whereBetween('created_at', [$this->from, $this->to])
            ->orderBy('id')
            ->chunkById(1000, function ($orders) use ($fp) {
                foreach ($orders as $order) {
                    fputcsv($fp, [
                        $order->order_no,
                        $order->user_id,
                        $order->status,
                        $order->total_amount,
                        optional($order->paid_at)?->toDateTimeString(),
                    ]);
                }
            });

        fclose($fp);

        $objectKey = sprintf('exports/orders/%d/orders-%d.csv', date('Y/m/d'), $history->id);
        Storage::disk('s3')->put($objectKey, fopen($path, 'r'));

        $history->update([
            'status' => 'finished',
            'file_path' => $objectKey,
            'finished_at' => now(),
        ]);
    }
}
```

上面这段代码里有三个实战点：

- 用 `chunkById`，不要一次性把结果集打进内存。
- 用 `fputcsv` 直接写文件，别先拼一个超大数组。
- 上传 S3 后只保存对象路径，下载时再签名。

触发入口也要非常轻，只做鉴权、记录和派发：

```php
public function export(Request $request): JsonResponse
{
    $history = ExportHistory::query()->create([
        'type' => 'orders',
        'status' => 'pending',
        'requested_by' => $request->user()->id,
        'filters' => $request->only(['from', 'to']),
    ]);

    ExportOrdersReportJob::dispatch(
        exportHistoryId: $history->id,
        from: $request->string('from')->toString(),
        to: $request->string('to')->toString(),
    )->onQueue('exports');

    return response()->json([
        'export_id' => $history->id,
        'status' => 'pending',
    ], 202);
}
```

## 四、下载不要回源 Laravel，直接给临时签名

```php
public function download(ExportHistory $history): JsonResponse
{
    abort_unless($history->status === 'finished', 404);

    $url = Storage::disk('s3')->temporaryUrl(
        $history->file_path,
        now()->addMinutes(10)
    );

    return response()->json(['url' => $url]);
}
```

这一步看似普通，但它直接决定了 PHP 会不会再次变成“文件中转站”。只要文件已经在 S3，就没必要再把下载流量拉回 Laravel。

## 五、几个最容易翻车的坑

### 1. 坑一：把 `/tmp` 当永久磁盘

Lambda 的 `/tmp` 只是**当前执行环境的临时目录**，实例回收后文件就没了。它适合做中转，不适合做最终存储。所以流程必须是：生成文件 → 上传 S3 → 更新状态；不要指望下一次执行还能拿到同一个本地文件。

### 2. 坑二：SQS 可见性超时比任务时间短

我第一次上线时，Job 实际要跑 6~8 分钟，但 SQS visibility timeout 配太短，结果同一份报表被重复消费两次。后来统一把**队列超时、Job timeout、SQS visibility timeout**按同一套预算对齐，并在 `export_histories` 上加唯一状态流转保护，避免重复产物覆盖。

### 3. 坑三：冷启动把 P95 拉高

如果把所有后台操作都塞进 Lambda，晨间第一波流量会很明显地吃到冷启动。我的经验是：**前台高频接口保持轻量，重任务异步化；真正低频但重计算的任务交给 queue runtime**。不要拿 Serverless 去硬扛同步大报表下载，这会把用户体验做坏。

### 4. 坑四：XLSX 比你想的更贵

很多业务一上来就要 Excel，但在 Serverless 场景里，XLSX 生成通常比 CSV 更吃内存和 CPU。除非确实需要样式、多个 sheet、公式，否则后台导出优先 CSV，运营真正需要格式化时再离线二次处理。

## 六、什么时候值得上 Vapor / Bref

我自己的判断标准很简单：

- 流量有明显峰谷，常驻机器利用率低；
- 任务天然异步，能接受排队执行；
- 文件、图片、报表这类重 IO 任务可以外置到 S3；
- 团队已经能接受云上观测、队列和对象存储这一套约束。

如果系统是**持续高并发、低延迟、长连接**，那 Octane 或常驻 K8s 反而更顺手；但像报表导出、账单汇总、运营批处理这种“偶发重任务”，Serverless 的弹性和成本模型很有优势。真正决定方案成败的，不是 Vapor 还是 Bref，而是你有没有先把任务拆成“接单、执行、存档、下载”四个阶段，并接受云函数对本地状态、执行时长和文件系统的限制。