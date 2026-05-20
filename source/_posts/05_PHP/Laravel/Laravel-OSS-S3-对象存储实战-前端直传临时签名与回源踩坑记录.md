---
title: Laravel + OSS/S3 对象存储实战：前端直传、临时签名与回源踩坑记录
date: 2026-05-02 09:20:00
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - OSS
  - S3
  - Flysystem
  - 对象存储
  - 文件上传
  - CDN
description: 结合 Laravel B2C API 真实落地经验，记录阿里云 OSS 与 AWS S3 在前端直传、临时签名下载、回源鉴权、目录规划与踩坑处理中的一套生产可用方案。
---

在 B2C API 里，文件上传最容易做成“先能跑、后面很贵”：前端先把图片传到 Laravel，Laravel 再转传 OSS/S3；下载时所有文件都先经过 PHP；商品图、退款附件、导出报表全塞一个 bucket。上线后常见结果是：PHP worker 被大文件拖满、Nginx 临时目录暴涨、CDN 缓存混乱、私有文件还可能直接裸奔。

我后来把方案统一成：**前端直传 + 服务端签名 + 元数据入库 + 私有下载临时 URL**。这套在商品图、订单凭证、退款附件、运营导表里都能复用，而且不会把应用层当文件搬运工。

## 一、架构先定清楚

```text
Client/Web/App
    │ 1. 请求上传凭证
    ▼
Laravel API
    │ 生成 object key / 校验身份 / 返回签名
    ├──────────────► MySQL(media 元数据)
    │
    │ 2. 前端直传
    ▼
OSS / S3 Private Bucket
    │
    ├──────────────► Queue Worker
    │                 缩略图、病毒扫描、转码
    │
    └──────────────► CDN
                         公开资源走 CDN
                         私有资源走临时签名 URL
```

落地原则只有三条：

1. **大文件不穿过 PHP 进程。**
2. **数据库存元数据，不存文件内容。**
3. **公开资源和私有资源必须拆开。**

## 二、Laravel 磁盘配置别图省事

我不会把所有文件混一个 disk。最少拆成公开资源和私有附件两类。

```php
// config/filesystems.php
return [
    'disks' => [
        'public_assets' => [
            'driver' => 's3',
            'key' => env('OSS_ACCESS_KEY_ID'),
            'secret' => env('OSS_ACCESS_KEY_SECRET'),
            'region' => env('OSS_REGION', 'oss-cn-hangzhou'),
            'bucket' => env('OSS_PUBLIC_BUCKET'),
            'endpoint' => env('OSS_ENDPOINT'),
            'url' => env('OSS_CDN_URL'),
            'throw' => true,
        ],

        'private_docs' => [
            'driver' => 's3',
            'key' => env('S3_ACCESS_KEY_ID'),
            'secret' => env('S3_ACCESS_KEY_SECRET'),
            'region' => env('S3_REGION', 'ap-southeast-1'),
            'bucket' => env('S3_PRIVATE_BUCKET'),
            'endpoint' => env('S3_ENDPOINT'),
            'throw' => true,
        ],
    ],
];
```

目录规划我通常这样定：

- `products/`：商品图，公开读，走 CDN
- `receipts/`：发票/凭证，私有读，临时签名
- `exports/`：导出文件，7 天自动清理

## 三、前端直传的关键，不是上传本身，而是 object key 设计

真正容易出事故的是路径规则。只要把原始文件名直接当 key，用不了多久就会发生覆盖、缓存脏读和批量迁移困难。

```php
// app/Services/UploadPathService.php
namespace App\Services;

use Illuminate\Support\Str;

class UploadPathService
{
    public function makeProductImagePath(int $productId, string $extension): string
    {
        return sprintf(
            'products/%d/%s/%s.%s',
            $productId,
            now()->format('Y/m/d'),
            Str::uuid()->toString(),
            strtolower($extension)
        );
    }
}
```

然后由 API 返回一次性上传地址：

```php
// app/Http/Controllers/Api/UploadPolicyController.php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\UploadPathService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class UploadPolicyController extends Controller
{
    public function __invoke(Request $request, UploadPathService $pathService)
    {
        $request->validate([
            'product_id' => ['required', 'integer'],
            'extension' => ['required', 'in:jpg,jpeg,png,webp,pdf'],
            'mime' => ['required', 'string'],
        ]);

        $path = $pathService->makeProductImagePath(
            (int) $request->integer('product_id'),
            $request->string('extension')->toString()
        );

        return response()->json([
            'disk' => 'public_assets',
            'path' => $path,
            'upload' => Storage::disk('public_assets')->temporaryUploadUrl(
                $path,
                now()->addMinutes(10),
                ['Content-Type' => $request->string('mime')->toString()]
            ),
        ]);
    }
}
```

这一步改完后，3~5MB 图片上传不再占用 PHP worker，接口机器的 CPU 峰值和超时率会明显下降。

## 四、上传成功后一定要入库，不要只存 URL

```php
// app/Models/Media.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Media extends Model
{
    protected $fillable = [
        'disk', 'object_key', 'origin_name', 'mime_type',
        'size', 'etag', 'visibility', 'owner_type', 'owner_id',
    ];
}
```

我至少会保存：`disk`、`object_key`、`mime_type`、`size`、`etag`、`owner_type/owner_id`。原因很实际：

- 后面切 CDN 域名，不需要回写全量 URL
- 可以清理孤儿文件
- 可以做跨云迁移
- 能追踪谁上传了什么文件

如果项目里还没有这张表，我通常会直接补一个比较克制的 migration：

```php
// database/migrations/2026_05_02_000001_create_media_table.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('media', function (Blueprint $table) {
            $table->id();
            $table->string('disk', 50);
            $table->string('object_key', 512)->unique();
            $table->string('origin_name', 255)->nullable();
            $table->string('mime_type', 120);
            $table->unsignedBigInteger('size')->default(0);
            $table->string('etag', 120)->nullable();
            $table->string('visibility', 20)->default('private');
            $table->string('owner_type', 100)->nullable();
            $table->unsignedBigInteger('owner_id')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['owner_type', 'owner_id']);
            $table->index(['disk', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('media');
    }
};
```

这张表别一开始就设计得太“平台化”。先解决上传、绑定、审计和清理四个问题，后面再慢慢长，不然很容易做成另一个复杂系统。

## 五、上传回调一定要验，不然前端可以伪造“已上传”

很多团队做直传时只返回一个 object key，前端上传完再调一次 `/complete`，服务端就信了。这个模型最大的问题是：**API 根本不知道文件是否真的上传成功、大小是否匹配、MIME 是否一致。**

我的做法一般是“前端提交 object key + 服务端主动确认对象存在”。如果是 OSS 回调或 S3 Event，也一样会再做一次服务端确认，而不是盲信回调体。

```php
// app/Services/UploadConfirmService.php
namespace App\Services;

use App\Models\Media;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class UploadConfirmService
{
    public function confirm(string $disk, string $objectKey, array $payload): Media
    {
        $adapter = Storage::disk($disk);

        if (! $adapter->exists($objectKey)) {
            throw new RuntimeException('Object not found in storage.');
        }

        $size = $adapter->size($objectKey);
        $mimeType = $adapter->mimeType($objectKey) ?? 'application/octet-stream';

        return Media::updateOrCreate(
            ['object_key' => $objectKey],
            [
                'disk' => $disk,
                'origin_name' => Arr::get($payload, 'origin_name'),
                'mime_type' => $mimeType,
                'size' => $size,
                'visibility' => Arr::get($payload, 'visibility', 'private'),
                'meta' => Arr::only($payload, ['sha256', 'width', 'height']),
            ]
        );
    }
}
```

这一步会多一次存储侧请求，但收益很大：

- 能阻断伪造上传完成的请求
- 能拿到最终对象真实 `size` / `mimeType`
- 能在业务提交前发现分片上传不完整的问题
- 后面做风控审计时，不会只剩前端传来的半可信数据

## 六、私有下载不要再让 Laravel 读流再回传

```php
// app/Services/PrivateFileUrlService.php
namespace App\Services;

use App\Models\Media;
use Illuminate\Support\Facades\Storage;

class PrivateFileUrlService
{
    public function makeTemporaryUrl(Media $media): string
    {
        return Storage::disk($media->disk)->temporaryUrl(
            $media->object_key,
            now()->addMinutes(5),
            [
                'ResponseContentDisposition' => 'attachment; filename="receipt.pdf"',
            ]
        );
    }
}
```

如果用 `readStream()` 让 PHP 做透传，文件一大、并发一高，应用层带宽和 worker 会先出问题。临时 URL 的好处是：权限有时效、流量不经过应用、定位故障也更清晰。

但这里还有一个经常被忽略的点：**下载文件名不要直接信任用户原始输入**。如果把原始文件名直接塞进 `Content-Disposition`，遇到空格、中文、双引号甚至换行字符，浏览器兼容性会很差，某些代理层还会出响应头异常。我的做法通常是：

- 下载文件名由服务端生成安全版本
- 原始文件名只用于页面展示和审计
- 需要保留原名时，先做 RFC 5987 编码

## 七、CDN 回源不要只配域名，还要想清楚缓存策略

商品图是公开资源，最适合走 CDN。但回源如果只是“挂个域名就完了”，上线后通常会遇到两个问题：

1. 新图替换了，用户还命中旧缓存
2. 私有资源被错误缓存到边缘节点

我自己的经验是：**公开资源用版本化 key，私有资源不要给 CDN 长缓存。** 例如商品主图更新时，不覆盖原对象，而是生成新 key，数据库更新引用。这样不需要到处做刷新预热，也不会被边缘节点缓存坑住。

```nginx
location /media/products/ {
    proxy_pass https://cdn-origin.example.com;
    proxy_set_header Host bucket.example.com;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location /media/private/ {
    proxy_pass https://api.example.com;
    add_header Cache-Control "private, no-store";
}
```

这类配置的核心不是语法，而是边界：

- `products/` 这类静态对象，尽量不可变
- `private/` 这类受控下载，不要被 CDN 误缓存
- 同一个域名下混放公私资源时，务必按路径做明确策略

## 八、异步后处理要和上传链路解耦

文件传上去不代表流程结束。实际生产里我常做三类异步任务：

- 图片缩略图生成
- PDF/视频元信息提取
- 病毒扫描或敏感内容识别

```php
// app/Jobs/GenerateProductThumbnail.php
namespace App\Jobs;

use App\Models\Media;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\ImageManager;

class GenerateProductThumbnail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public int $mediaId)
    {
    }

    public function handle(ImageManager $imageManager): void
    {
        $media = Media::query()->findOrFail($this->mediaId);
        $stream = Storage::disk($media->disk)->readStream($media->object_key);

        $image = $imageManager->read($stream)->cover(600, 600);

        Storage::disk('public_assets')->put(
            str_replace('products/', 'products/thumbs/', $media->object_key),
            (string) $image->toWebp(82)
        );
    }
}
```

这里我有个很明确的边界：**上传 API 只负责把文件安全落到存储，缩略图和转码都异步做。** 否则一旦图片压缩、PDF 解析、视频探测塞回同步链路，接口尾延迟会直接被拉长。

## 九、6 个最容易踩的坑

### 1）原始文件名直接做 key

结果：`image.jpg` 被反复覆盖，CDN 还会继续命中旧缓存。后来统一改成“业务前缀 + 日期 + UUID”，原文件名只存数据库展示。

### 2）整个 bucket 开公网读

早期为了省事，把退款附件和商品图放一起，结果任意人拿到链接都能访问。正确做法是：**默认私有，公开资源单独 bucket 或 prefix。**

### 3）只校验扩展名，不校验真实类型

用户把可执行文件改成 `.jpg` 一样能传上去。现在我会至少做两层：

- 上传前校验扩展名和 MIME
- 上传后异步抽检 `finfo`，关键业务再加病毒扫描

### 4）只写文件，不写元数据绑定

最常见后果是：上传成功了，但业务提交失败，bucket 留下一堆孤儿文件。我的处理方式是：上传成功先写 `media` 表，业务完成后再绑定 `owner_id`，最后定时清理 24 小时内未绑定的数据。

### 5）时钟不一致，临时签名在多台机器上间歇性失效

这个问题在多台应用机器、又没有统一 NTP 时特别烦。A 机器签名，B 机器校验，时间差一大，前端会偶发遇到“刚拿到 URL 就过期”。后来我们把应用节点和宿主机的时间同步统一收口，临时签名失败率才降下来。

### 6）同一个 bucket 混开发、测试、生产环境

这会让对象 key 看起来很整齐，但清理策略、权限和审计都会变复杂。更糟的是测试环境可能误删生产资源。我的建议很简单：**环境级隔离优先于路径级隔离**，至少 bucket 或账号层要隔开。

## 十、上线前我会检查的清单

- [ ] object key 是否完全避免同名覆盖
- [ ] public/private bucket 或 prefix 是否隔离
- [ ] 上传完成后是否做服务端确认
- [ ] `media` 表是否能追溯 owner 与上传人
- [ ] 私有下载是否统一走 `temporaryUrl`
- [ ] 导出文件是否配置生命周期自动清理
- [ ] 是否有清理未绑定孤儿文件的任务
- [ ] CDN 是否按路径拆分缓存策略

这些看起来像“运维小事”，但线上真正会爆的，往往就是这些边界配置。

## 十一、什么时候用 OSS，什么时候用 S3

如果业务主要在阿里云内、配合国内 CDN、成本更敏感，OSS 很顺手；如果系统天然是多区域、海外分发或需要更丰富的生态，S3 更合适。对 Laravel 来说，真正决定上线质量的不是供应商，而是下面四件事有没有做好：

- key 规则是否可迁移
- 权限是否分公开/私有
- 下载是否用签名 URL
- 生命周期和孤儿清理是否落地

对象存储最怕的不是不会用 `Storage::put()`，而是把应用层硬生生做成文件中转站。只要你把直传、签名、元数据和清理机制这四步补齐，OSS 和 S3 都能跑得很稳。