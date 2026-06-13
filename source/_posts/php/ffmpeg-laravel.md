---

title: FFmpeg + Laravel 实战：音视频转码、截图、水印——上传处理管道与队列化异步任务
keywords: [FFmpeg, Laravel, 音视频转码, 截图, 水印, 上传处理管道与队列化异步任务]
date: 2026-06-06 10:00:00
description: 深入实战指南：如何将 FFmpeg 与 Laravel 框架深度集成，构建涵盖视频转码、音频提取、缩略图截图、水印叠加的完整音视频处理管道。通过 Laravel Queue 实现队列化异步任务调度，支持多分辨率转码、HLS 切片、硬件加速，并对比自建方案与云转码服务（AWS MediaConvert / 阿里云 MPS）的选型策略。附完整 Job 类、踩坑案例与生产环境最佳实践。
tags:
- FFmpeg
- Laravel
- 音视频
- 队列
- 异步任务
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



在当今内容驱动的互联网时代，音视频处理能力已成为众多 Web 应用的核心需求。无论是短视频平台的多码率转码、在线教育系统的课件处理，还是企业 CMS 的媒体资产管理，都离不开一套稳定可靠的后端媒体处理管道。本文将深入实战，手把手带你把 FFmpeg 与 Laravel 框架深度集成，构建一套涵盖视频转码、音频提取、缩略图截图、水印叠加的完整处理管道，并通过 Laravel 队列实现异步化任务调度，让你的应用能够从容应对大规模媒体文件处理场景。

<!-- more -->

## 一、技术选型与整体架构

在正式编码之前，我们先明确整体技术栈和数据流向：

**核心组件：**
- **FFmpeg**：音视频转码引擎，负责底层编解码、滤镜处理
- **Laravel 11**：Web 框架，提供路由、控制器、队列、存储等基础设施
- **protonemedia/laravel-ffmpeg**：FFmpeg 的 Laravel 封装包，提供优雅的链式 API
- **Laravel Horizon**：队列监控面板
- **Redis**：队列驱动 + 缓存

**数据流走向：**

```
用户上传 → 临时存储 → MediaUploadController 接收
    → 生成数据库记录（status=pending）
    → 分发 MediaProcessJob 到队列
    → Queue Worker 依次执行：
        1. 提取媒体信息（时长、分辨率、编码格式）
        2. 视频转码（多分辨率 + H.264/H.265）
        3. 音频提取（MP3/AAC）
        4. 缩略图截图（关键帧 / 自定义时间点）
        5. 水印叠加（图片水印 / 文字水印）
        6. 上传至云存储（OSS/S3）
        7. 更新数据库状态（status=completed）
    → 前端轮询或 WebSocket 获取处理进度
```

这套架构的核心设计原则是：**所有耗时操作全部异步化**。用户上传后立即返回响应，后台队列慢慢处理，避免 HTTP 请求超时，同时通过队列优先级和并发控制合理分配服务器资源。

## 二、环境准备与 FFmpeg 安装

### 2.1 安装 FFmpeg

不同操作系统的安装方式：

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg

# CentOS / RHEL
sudo yum install epel-release
sudo yum install ffmpeg ffmpeg-devel

# 验证安装
ffmpeg -version
```

确保输出中包含 `--enable-gpl`、`--enable-libx264`、`--enable-libx265` 等关键编译选项。生产环境推荐从源码编译以启用硬件加速（NVIDIA NVENC、Intel QSV）。

### 2.2 Laravel 项目初始化

```bash
composer create-project laravel/laravel media-pipeline
cd media-pipeline

# 安装 FFmpeg 封装包
composer require protonemedia/laravel-ffmpeg

# 发布配置文件
php artisan vendor:publish --provider="ProtoneMedia\LaravelFFmpeg\Support\ServiceProvider"

# 安装队列监控
composer require laravel/horizon
php artisan horizon:install
```

### 2.3 配置文件

`config/laravel-ffmpeg.php` 核心配置：

```php
return [
    'ffmpeg' => [
        'binaries' => env('FFMPEG_BINARIES', 'ffmpeg'),
        'threads' => 12,  // 根据 CPU 核数调整
    ],
    'ffprobe' => [
        'binaries' => env('FFPROBE_BINARIES', 'ffprobe'),
    ],
    'timeout' => 3600,  // 超时时间：1小时
    'enable_logging' => true,
];
```

`.env` 配置：

```env
FFMPEG_BINARIES=/usr/local/bin/ffmpeg
FFPROBE_BINARIES=/usr/local/bin/ffprobe

QUEUE_CONNECTION=redis
REDIS_HOST=127.0.0.1

MEDIA_DISK=local          # 本地临时存储
MEDIA_OUTPUT_DISK=s3      # 最终输出存储
```

## 三、数据库设计与模型

### 3.1 创建迁移文件

```bash
php artisan make:migration create_media_files_table
```

```php
// database/migrations/xxxx_create_media_files_table.php
Schema::create('media_files', function (Blueprint $table) {
    $table->id();
    $table->uuid('uuid')->unique();
    $table->string('original_name');           // 原始文件名
    $table->string('mime_type');               // MIME 类型
    $table->unsignedBigInteger('file_size');   // 文件大小（字节）
    $table->string('disk')->default('local');  // 存储磁盘
    $table->string('path');                    // 存储路径

    // 媒体信息
    $table->unsignedInteger('duration')->nullable();      // 时长（秒）
    $table->unsignedInteger('width')->nullable();         // 宽度
    $table->unsignedInteger('height')->nullable();        // 高度
    $table->string('video_codec')->nullable();            // 视频编码
    $table->string('audio_codec')->nullable();            // 音频编码
    $table->unsignedInteger('bitrate')->nullable();       // 码率

    // 处理状态
    $table->enum('status', [
        'pending',       // 等待处理
        'processing',    // 处理中
        'completed',     // 处理完成
        'failed',        // 处理失败
    ])->default('pending');
    $table->unsignedTinyInteger('progress')->default(0);  // 进度 0-100
    $table->text('error_message')->nullable();            // 错误信息
    $table->json('meta')->nullable();                     // 扩展元数据

    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->timestamps();

    $table->index(['status', 'created_at']);
    $table->index('user_id');
});
```

### 3.2 Eloquent 模型

```php
// app/Models/MediaFile.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Support\Facades\Storage;

class MediaFile extends Model
{
    protected $fillable = [
        'uuid', 'original_name', 'mime_type', 'file_size',
        'disk', 'path', 'duration', 'width', 'height',
        'video_codec', 'audio_codec', 'bitrate',
        'status', 'progress', 'error_message', 'meta', 'user_id',
    ];

    protected $casts = [
        'meta' => 'array',
    ];

    // 判断是否为视频文件
    public function isVideo(): bool
    {
        return str_starts_with($this->mime_type, 'video/');
    }

    // 判断是否为音频文件
    public function isAudio(): bool
    {
        return str_starts_with($this->mime_type, 'audio/');
    }

    // 获取原始文件 URL
    public function getOriginalUrlAttribute(): string
    {
        return Storage::disk($this->disk)->url($this->path);
    }

    // 获取转码后文件的路径规则
    public function getTranscodedPath(string $resolution): string
    {
        $ext = pathinfo($this->path, PATHINFO_EXTENSION);
        return "transcoded/{$this->uuid}/{$resolution}.{$ext}";
    }

    // 获取缩略图路径
    public function getThumbnailPath(): string
    {
        return "thumbnails/{$this->uuid}/thumb_{index}.jpg";
    }

    // 更新处理进度
    public function updateProgress(int $progress, string $status = 'processing'): void
    {
        $this->update([
            'status' => $status,
            'progress' => min(100, max(0, $progress)),
        ]);
    }

    // 关联用户
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
```

## 四、文件上传控制器

### 4.1 上传请求验证

```php
// app/Http/Requests/StoreMediaRequest.php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreMediaRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'file' => [
                'required',
                'file',
                'max:5242880',  // 5GB = 5 * 1024 * 1024 KB
                'mimes:mp4,avi,mov,wmv,flv,mkv,webm,mp3,wav,aac,flac,ogg',
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => '请选择要上传的文件',
            'file.max' => '文件大小不能超过 5GB',
            'file.mimes' => '不支持的文件格式',
        ];
    }
}
```

### 4.2 上传控制器

```php
// app/Http/Controllers/MediaUploadController.php
namespace App\Http\Controllers;

use App\Http\Requests\StoreMediaRequest;
use App\Jobs\MediaProcessJob;
use App\Models\MediaFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MediaUploadController extends Controller
{
    public function store(StoreMediaRequest $request)
    {
        $file = $request->file('file');
        $uuid = Str::uuid();
        $originalName = $file->getClientOriginalName();
        $ext = $file->getClientOriginalExtension();

        // 以 UUID 命名避免冲突，按日期分目录
        $path = $file->storeAs(
            'uploads/' . now()->format('Y/m/d'),
            "{$uuid}.{$ext}",
            'local'
        );

        // 创建数据库记录
        $mediaFile = MediaFile::create([
            'uuid'         => $uuid,
            'original_name' => $originalName,
            'mime_type'    => $file->getMimeType(),
            'file_size'    => $file->getSize(),
            'disk'         => 'local',
            'path'         => $path,
            'status'       => 'pending',
            'user_id'      => auth()->id(),
        ]);

        // 分发异步处理任务
        MediaProcessJob::dispatch($mediaFile)
            ->onQueue('media-processing')
            ->delay(now()->addSeconds(3));  // 延迟3秒，等待文件写入完成

        return response()->json([
            'message' => '文件上传成功，正在后台处理',
            'data' => [
                'uuid'     => $uuid,
                'status'   => 'pending',
                'file_name' => $originalName,
                'file_size' => $this->formatFileSize($file->getSize()),
            ],
        ], 202);
    }

    private function formatFileSize(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }
}
```

## 五、核心处理管道：提取信息、转码、截图、水印

这一节是本文的重中之重。我们将把整个处理流程拆解为独立的步骤方法，封装在一个 Service 类中。

### 5.1 MediaProcessService 服务类

```php
// app/Services/MediaProcessService.php
namespace App\Services;

use App\Models\MediaFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use ProtoneMedia\LaravelFFmpeg\Support\FFMpeg;

class MediaProcessService
{
    // 定义转码分辨率档位
    private array $resolutions = [
        '360p'  => ['width' => 640,  'height' => 360,  'bitrate' => '800k'],
        '480p'  => ['width' => 854,  'height' => 480,  'bitrate' => '1400k'],
        '720p'  => ['width' => 1280, 'height' => 720,  'bitrate' => '2800k'],
        '1080p' => ['width' => 1920, 'height' => 1080, 'bitrate' => '5000k'],
    ];

    /**
     * 第一步：提取媒体信息
     */
    public function extractMediaInfo(MediaFile $media): array
    {
        $media->updateProgress(5);

        $ffprobe = FFMpeg::create()->getFFProbe();
        $path = Storage::disk($media->disk)->path($media->path);
        $mediaInfo = $ffprobe->format($path);

        $info = [
            'duration'    => (int) $mediaInfo->get('duration'),
            'bitrate'     => (int) $mediaInfo->get('bit_rate'),
            'format_name' => $mediaInfo->get('format_name'),
        ];

        if ($media->isVideo()) {
            $videoStream = $ffprobe->streams($path)->videos()->first();
            if ($videoStream) {
                $info['width']       = $videoStream->get('width');
                $info['height']      = $videoStream->get('height');
                $info['video_codec'] = $videoStream->get('codec_name');
                $info['fps']         = $videoStream->get('r_frame_rate');
            }
        }

        if ($media->isVideo() || $media->isAudio()) {
            $audioStream = $ffprobe->streams($path)->audios()->first();
            if ($audioStream) {
                $info['audio_codec']     = $audioStream->get('codec_name');
                $info['audio_bitrate']   = $audioStream->get('bit_rate');
                $info['audio_channels']  = $audioStream->get('channels');
                $info['sample_rate']     = $audioStream->get('sample_rate');
            }
        }

        // 更新模型
        $media->update([
            'duration'    => $info['duration'] ?? null,
            'width'       => $info['width'] ?? null,
            'height'      => $info['height'] ?? null,
            'video_codec' => $info['video_codec'] ?? null,
            'audio_codec' => $info['audio_codec'] ?? null,
            'bitrate'     => $info['bitrate'] ?? null,
            'meta'        => $info,
        ]);

        $media->updateProgress(10);

        Log::info("Media info extracted", [
            'media_id' => $media->id,
            'info' => $info,
        ]);

        return $info;
    }

    /**
     * 第二步：视频转码（多分辨率）
     */
    public function transcodeVideo(MediaFile $media): void
    {
        $media->updateProgress(15);
        $sourcePath = Storage::disk($media->disk)->path($media->path);
        $originalHeight = $media->height ?? 0;

        // 根据原始分辨率决定需要输出哪些档位
        $targetResolutions = array_filter(
            $this->resolutions,
            fn($config) => $config['height'] <= $originalHeight
        );

        if (empty($targetResolutions)) {
            // 原始分辨率太低，直接拷贝
            $targetResolutions = ['original' => [
                'width' => $originalHeight > 0 ? $media->width : 640,
                'height' => max($originalHeight, 360),
                'bitrate' => '800k',
            ]];
        }

        $totalSteps = count($targetResolutions);
        $currentStep = 0;

        foreach ($targetResolutions as $label => $config) {
            $outputPath = Storage::disk('local')->path(
                $media->getTranscodedPath($label)
            );

            // 确保输出目录存在
            $dir = dirname($outputPath);
            if (!is_dir($dir)) {
                mkdir($dir, 0755, true);
            }

            try {
                $media->updateProgress(15 + (int)(($currentStep / $totalSteps) * 35));

                $ffmpeg = FFMpeg::create()
                    ->open($sourcePath)
                    ->export()
                    ->asVideoCodec('libx264')
                    ->asAudioCodec('aac')
                    ->addFilter('-vf', "scale={$config['width']}:{$config['height']}")
                    ->addFilter('-preset', 'medium')
                    ->addFilter('-crf', '23')
                    ->addFilter('-movflags', '+faststart')  // 便于网络流式播放
                    ->addFilter('-maxrate', $config['bitrate'])
                    ->addFilter('-bufsize', (int)$config['bitrate'] * 2 . 'k')
                    ->addFilter('-pix_fmt', 'yuv420p')      // 确保兼容性
                    ->addFilter('-r', '30')                   // 统一帧率
                    ->save($outputPath);

                Log::info("Video transcoded", [
                    'media_id' => $media->id,
                    'resolution' => $label,
                    'output' => $outputPath,
                ]);

            } catch (\Exception $e) {
                Log::error("Transcode failed for {$label}", [
                    'media_id' => $media->id,
                    'error' => $e->getMessage(),
                ]);
                throw $e;
            }

            $currentStep++;
        }

        $media->updateProgress(50);
    }

    /**
     * 第三步：音频提取
     */
    public function extractAudio(MediaFile $media): void
    {
        $media->updateProgress(55);

        $sourcePath = Storage::disk($media->disk)->path($media->path);
        $outputPath = Storage::disk('local')->path(
            "audio/{$media->uuid}/audio.mp3"
        );

        $dir = dirname($outputPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        try {
            FFMpeg::create()
                ->open($sourcePath)
                ->export()
                ->asAudioCodec('libmp3lame')
                ->addFilter('-ab', '192k')
                ->addFilter('-ar', '44100')
                ->addFilter('-ac', '2')
                ->save($outputPath);

            Log::info("Audio extracted", [
                'media_id' => $media->id,
                'output' => $outputPath,
            ]);

        } catch (\Exception $e) {
            Log::error("Audio extraction failed", [
                'media_id' => $media->id,
                'error' => $e->getMessage(),
            ]);
            // 音频提取失败不阻断主流程
            Log::warning("Skipping audio extraction, continuing pipeline");
        }

        $media->updateProgress(60);
    }

    /**
     * 第四步：缩略图截图
     */
    public function generateThumbnails(MediaFile $media, int $count = 3): void
    {
        $media->updateProgress(65);

        $sourcePath = Storage::disk($media->disk)->path($media->path);
        $duration = $media->duration ?? 0;

        if ($duration <= 0) {
            Log::warning("Cannot generate thumbnails: duration unknown", [
                'media_id' => $media->id,
            ]);
            return;
        }

        $thumbnailDir = Storage::disk('local')->path("thumbnails/{$media->uuid}");
        if (!is_dir($thumbnailDir)) {
            mkdir($thumbnailDir, 0755, true);
        }

        try {
            $ffmpeg = FFMpeg::create()->open($sourcePath);

            // 策略：均匀分布截图时间点，跳过首尾各 10%
            $startTime = $duration * 0.1;
            $endTime = $duration * 0.9;
            $interval = ($endTime - $startTime) / max($count - 1, 1);

            for ($i = 0; $i < $count; $i++) {
                $timePoint = (int) ($startTime + $interval * $i);
                $outputPath = $thumbnailDir . "/thumb_{$i}.jpg";

                $ffmpeg->frame(\FFMpeg\Coordinate\TimeCode::fromSeconds($timePoint))
                    ->save($outputPath, [
                        'quality' => 2,
                    ]);

                Log::info("Thumbnail generated", [
                    'media_id' => $media->id,
                    'time_point' => $timePoint,
                    'output' => $outputPath,
                ]);
            }

            // 选择第一张作为封面
            $coverPath = $thumbnailDir . "/thumb_0.jpg";
            if (file_exists($coverPath)) {
                Storage::disk('local')->put(
                    "covers/{$media->uuid}.jpg",
                    file_get_contents($coverPath)
                );
            }

        } catch (\Exception $e) {
            Log::error("Thumbnail generation failed", [
                'media_id' => $media->id,
                'error' => $e->getMessage(),
            ]);
        }

        $media->updateProgress(75);
    }

    /**
     * 第五步：水印叠加
     */
    public function addWatermark(MediaFile $media): void
    {
        $media->updateProgress(80);

        if (!$media->isVideo()) {
            return;
        }

        $sourcePath = Storage::disk('local')->path(
            $media->getTranscodedPath('720p')
        );

        // 如果 720p 不存在，尝试其他档位
        if (!file_exists($sourcePath)) {
            $sourcePath = Storage::disk('local')->path(
                $media->getTranscodedPath('480p')
            );
        }
        if (!file_exists($sourcePath)) {
            Log::warning("No transcoded file found for watermarking");
            return;
        }

        $watermarkPath = storage_path('app/watermarks/logo.png');
        if (!file_exists($watermarkPath)) {
            Log::warning("Watermark image not found, skipping");
            $media->updateProgress(85);
            return;
        }

        $outputPath = Storage::disk('local')->path(
            "watermarked/{$media->uuid}/720p.mp4"
        );

        $dir = dirname($outputPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        try {
            // 右下角水印，边距 20px
            $filter = "movie={$watermarkPath}[wm];[in][wm]overlay=W-w-20:H-h-20[out]";

            FFMpeg::create()
                ->open($sourcePath)
                ->export()
                ->addFilter('-vf', $filter)
                ->addFilter('-codec:a', 'copy')
                ->save($outputPath);

            Log::info("Watermark added", [
                'media_id' => $media->id,
                'output' => $outputPath,
            ]);

        } catch (\Exception $e) {
            Log::error("Watermark failed", [
                'media_id' => $media->id,
                'error' => $e->getMessage(),
            ]);
        }

        $media->updateProgress(85);
    }

    /**
     * 第六步：上传至云存储
     */
    public function uploadToCloud(MediaFile $media): void
    {
        $media->updateProgress(90);

        $filesToUpload = [
            "transcoded/{$media->uuid}/" => 'transcoded',
            "thumbnails/{$media->uuid}/" => 'thumbnails',
            "audio/{$media->uuid}/"      => 'audio',
            "covers/{$media->uuid}.jpg"  => 'covers',
        ];

        foreach ($filesToUpload as $localPrefix => $cloudPrefix) {
            $localPath = Storage::disk('local')->path($localPrefix);

            if (is_dir($localPath)) {
                $files = glob($localPath . '/*');
                foreach ($files as $file) {
                    $relativePath = $cloudPrefix . '/' . basename($file);
                    $content = file_get_contents($file);
                    Storage::disk('s3')->put($relativePath, $content, [
                        'visibility' => 'public',
                        'ContentType' => mime_content_type($file),
                    ]);
                }
            } elseif (file_exists($localPath)) {
                $content = file_get_contents($localPath);
                Storage::disk('s3')->put($cloudPrefix, $content, [
                    'visibility' => 'public',
                ]);
            }
        }

        $media->updateProgress(95);
    }

    /**
     * 清理本地临时文件
     */
    public function cleanup(MediaFile $media): void
    {
        $paths = [
            "uploads/{$media->path}",
            "transcoded/{$media->uuid}",
            "thumbnails/{$media->uuid}",
            "audio/{$media->uuid}",
            "watermarked/{$media->uuid}",
            "covers/{$media->uuid}.jpg",
        ];

        foreach ($paths as $path) {
            try {
                if (Storage::disk('local')->exists($path)) {
                    if (Storage::disk('local')->isDirectory($path)) {
                        // 递归删除目录
                        $files = Storage::disk('local')->allFiles($path);
                        Storage::disk('local')->delete($files);
                    } else {
                        Storage::disk('local')->delete($path);
                    }
                }
            } catch (\Exception $e) {
                Log::warning("Cleanup failed for path: {$path}", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::info("Cleanup completed", ['media_id' => $media->id]);
    }
}
```

## 六、队列 Job 与异步任务编排

### 6.1 主处理 Job

```php
// app/Jobs/MediaProcessJob.php
namespace App\Jobs;

use App\Models\MediaFile;
use App\Services\MediaProcessService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class MediaProcessJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 3600;  // 1小时超时
    public int $maxExceptions = 3;
    public $backoff = [60, 300, 600];  // 重试间隔：1分钟、5分钟、10分钟

    public function __construct(
        public MediaFile $mediaFile
    ) {}

    public function handle(MediaProcessService $service): void
    {
        $this->mediaFile->update(['status' => 'processing']);
        $this->mediaFile->updateProgress(0);

        Log::info("MediaProcessJob started", [
            'media_id' => $this->mediaFile->id,
            'uuid' => $this->mediaFile->uuid,
        ]);

        try {
            // 步骤1：提取媒体信息
            $service->extractMediaInfo($this->mediaFile);

            // 步骤2：视频转码
            if ($this->mediaFile->isVideo()) {
                $service->transcodeVideo($this->mediaFile);
            }

            // 步骤3：音频提取
            if ($this->mediaFile->isVideo() || $this->mediaFile->isAudio()) {
                $service->extractAudio($this->mediaFile);
            }

            // 步骤4：缩略图截图
            if ($this->mediaFile->isVideo()) {
                $service->generateThumbnails($this->mediaFile);
            }

            // 步骤5：水印叠加
            if ($this->mediaFile->isVideo()) {
                $service->addWatermark($this->mediaFile);
            }

            // 步骤6：上传至云存储
            $service->uploadToCloud($this->mediaFile);

            // 步骤7：清理临时文件
            $service->cleanup($this->mediaFile);

            // 标记完成
            $this->mediaFile->updateProgress(100, 'completed');

            // 触发完成事件（可用于通知前端）
            event(new \App\Events\MediaProcessedEvent($this->mediaFile));

            Log::info("MediaProcessJob completed", [
                'media_id' => $this->mediaFile->id,
            ]);

        } catch (\Exception $e) {
            Log::error("MediaProcessJob failed", [
                'media_id' => $this->mediaFile->id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            $this->mediaFile->update([
                'status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);

            // 触发失败事件
            event(new \App\Events\MediaProcessFailedEvent($this->mediaFile, $e));

            throw $e;  // 重新抛出以触发重试机制
        }
    }

    /**
     * 任务失败时的回调
     */
    public function failed(\Throwable $exception): void
    {
        Log::error("MediaProcessJob permanently failed", [
            'media_id' => $this->mediaFile->id,
            'error' => $exception->getMessage(),
        ]);

        $this->mediaFile->update([
            'status' => 'failed',
            'error_message' => "处理失败（已重试 {$this->tries} 次）: " . $exception->getMessage(),
        ]);
    }
}
```

### 6.2 Pipeline 模式——链式 Job（可选方案）

如果你希望每个步骤都是独立的 Job，方便细粒度重试和监控，可以使用 Laravel 的 Pipeline 模式：

```php
// app/Jobs/MediaProcessPipelineJob.php
namespace App\Jobs;

use App\Models\MediaFile;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Bus;

class MediaProcessPipelineJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(public MediaFile $mediaFile) {}

    public function handle(): void
    {
        $chain = [
            new ExtractMediaInfoJob($this->mediaFile),
            new TranscodeVideoJob($this->mediaFile),
            new ExtractAudioJob($this->mediaFile),
            new GenerateThumbnailsJob($this->mediaFile),
            new AddWatermarkJob($this->mediaFile),
            new UploadToCloudJob($this->mediaFile),
            new CleanupTempFilesJob($this->mediaFile),
        ];

        Bus::chain($chain)->onQueue('media-pipeline')->dispatch();
    }
}
```

这种模式下每个步骤独立执行、独立重试，某一步失败不会影响已完成的步骤。

## 七、进度追踪与前端通知

### 7.1 轮询接口

```php
// app/Http/Controllers/MediaStatusController.php
namespace App\Http\Controllers;

use App\Models\MediaFile;

class MediaStatusController extends Controller
{
    public function show(string $uuid)
    {
        $media = MediaFile::where('uuid', $uuid)->firstOrFail();

        return response()->json([
            'uuid'     => $media->uuid,
            'status'   => $media->status,
            'progress' => $media->progress,
            'error'    => $media->error_message,
            'meta'     => $media->meta,
        ]);
    }
}
```

### 7.2 WebSocket 实时推送（使用 Laravel Reverb）

```php
// app/Events/MediaProgressEvent.php
namespace App\Events;

use App\Models\MediaFile;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class MediaProgressEvent implements ShouldBroadcast
{
    use InteractsWithSockets;

    public function __construct(
        public MediaFile $media,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new Channel('media.' . $this->media->user_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'media.progress';
    }

    public function broadcastWith(): array
    {
        return [
            'uuid'     => $this->media->uuid,
            'status'   => $this->media->status,
            'progress' => $this->media->progress,
        ];
    }
}
```

在 `MediaProcessService` 的 `updateProgress` 方法中广播事件：

```php
// 在 MediaFile 模型的 updateProgress 中增加广播
public function updateProgress(int $progress, string $status = 'processing'): void
{
    $this->update([
        'status' => $status,
        'progress' => min(100, max(0, $progress)),
    ]);

    // 广播进度事件
    event(new \App\Events\MediaProgressEvent($this));
}
```

## 八、错误处理与健壮性保障

### 8.1 多层错误处理策略

```php
// app/Exceptions/MediaProcessExceptionHandler.php
namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Queue\MaxAttemptsExceededException;

class MediaProcessExceptionHandler extends ExceptionHandler
{
    public function register(): void
    {
        $this->reportable(function (\Throwable $e) {
            // 记录所有媒体处理相关的异常
            if (str_contains($e->getMessage(), 'ffmpeg') ||
                str_contains($e->getMessage(), 'FFmpeg')) {
                \Log::channel('media')->error('FFmpeg Error', [
                    'message' => $e->getMessage(),
                    'file' => $e->getFile(),
                    'line' => $e->getLine(),
                ]);
            }
        });
    }
}
```

### 8.2 超时与内存保护

```php
// 在 Job 中设置资源限制
class MediaProcessJob implements ShouldQueue
{
    public int $timeout = 3600;
    public int $tries = 3;

    public function handle(MediaProcessService $service): void
    {
        // 设置最大内存为 512MB
        ini_set('memory_limit', '512M');

        // 设置执行时间限制
        set_time_limit(3500);

        // 处理前检查磁盘空间
        $freeSpace = disk_free_space(storage_path('app'));
        if ($freeSpace < 5 * 1024 * 1024 * 1024) {  // 5GB
            throw new \RuntimeException('磁盘空间不足，无法继续处理');
        }

        // ... 正常处理逻辑
    }
}
```

### 8.3 进程超时监控

```php
// app/Observers/MediaFileObserver.php
namespace App\Observers;

use App\Models\MediaFile;
use Carbon\Carbon;

class MediaFileObserver
{
    /**
     * 定时检查卡住的处理任务
     * 通过 Laravel Scheduler 每5分钟执行一次
     */
    public static function resetStuckJobs(): void
    {
        $stuckThreshold = Carbon::now()->subHour();

        $stuckMedia = MediaFile::where('status', 'processing')
            ->where('updated_at', '<', $stuckThreshold)
            ->get();

        foreach ($stuckMedia as $media) {
            $media->update([
                'status' => 'pending',
                'error_message' => '处理超时，已自动重置',
            ]);

            MediaProcessJob::dispatch($media)
                ->onQueue('media-processing');

            \Log::warning("Reset stuck media process", [
                'media_id' => $media->id,
            ]);
        }
    }
}
```

在 `app/Console/Kernel.php` 中注册定时任务：

```php
protected function schedule(Schedule $schedule): void
{
    $schedule->call(function () {
        \App\Observers\MediaFileObserver::resetStuckJobs();
    })->everyFiveMinutes()->name('reset-stuck-media-jobs');
}
```

## 九、生产环境最佳实践

### 9.1 Horizon 队列配置

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['media-processing'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 5,
            'maxTime' => 3600,
            'maxJobs' => 10,
            'memory' => 512,
            'tries' => 3,
            'timeout' => 3600,
            'nice' => 10,  // 降低进程优先级
        ],
    ],
    'local' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['media-processing'],
            'balance' => 'simple',
            'maxProcesses' => 2,
            'maxTime' => 3600,
            'tries' => 1,
            'timeout' => 3600,
        ],
    ],
],
```

### 9.2 FFmpeg 硬件加速

对于高并发场景，启用硬件加速可以大幅提升转码效率：

```php
// NVIDIA NVENC 加速
public function transcodeVideoWithGPU(MediaFile $media): void
{
    $sourcePath = Storage::disk($media->disk)->path($media->path);
    $outputPath = Storage::disk('local')->path(
        $media->getTranscodedPath('720p')
    );

    $command = sprintf(
        'ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i %s ' .
        '-c:v h264_nvenc -preset medium -b:v 2800k -maxrate 2800k ' .
        '-bufsize 5600k -c:a aac -b:a 128k -movflags +faststart %s ' .
        '2>&1',
        escapeshellarg($sourcePath),
        escapeshellarg($outputPath)
    );

    $process = new \Symfony\Component\Process\Process(
        explode(' ', $command)
    );
    $process->setTimeout(3600);
    $process->run();

    if (!$process->isSuccessful()) {
        throw new \RuntimeException(
            'GPU transcode failed: ' . $process->getErrorOutput()
        );
    }
}
```

### 9.3 多级存储策略

```php
// config/media-storage.php
return [
    // 热存储：处理中的临时文件（本地 SSD）
    'hot' => [
        'disk' => 'local',
        'ttl' => 72,  // 小时
    ],

    // 温存储：近期的转码文件（云存储标准层）
    'warm' => [
        'disk' => 's3',
        'storage_class' => 'STANDARD',
    ],

    // 冷存储：归档文件（云存储低频访问层）
    'cold' => [
        'disk' => 's3-archive',
        'storage_class' => 'GLACIER',
    ],
];
```

### 9.4 日志与监控

```php
// config/logging.php 中添加媒体专用通道
'channels' => [
    'media' => [
        'driver' => 'daily',
        'path' => storage_path('logs/media.log'),
        'level' => 'info',
        'days' => 30,
    ],
],
```

使用 Prometheus + Grafana 监控关键指标：

```php
// app/Services/MetricsService.php
namespace App\Services;

class MetricsService
{
    public static function recordTranscodeTime(
        string $resolution,
        float $seconds
    ): void {
        // 记录转码耗时，用于容量规划和性能优化
        \Log::channel('media')->info('Transcode metric', [
            'resolution' => $resolution,
            'duration_seconds' => $seconds,
            'memory_peak_mb' => memory_get_peak_usage(true) / 1024 / 1024,
        ]);
    }
}
```

### 9.5 安全考虑

```php
// 上传文件安全校验
public function validateUploadedFile(UploadedFile $file): void
{
    // 1. 验证文件扩展名与实际 MIME 类型一致
    $finfo = new \finfo(FILEINFO_MIME_TYPE);
    $realMimeType = $finfo->file($file->getRealPath());

    $allowedMimes = [
        'video/mp4', 'video/quicktime', 'video/x-msvideo',
        'video/x-matroska', 'video/webm',
        'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg',
    ];

    if (!in_array($realMimeType, $allowedMimes)) {
        throw new \InvalidArgumentException(
            "文件类型不允许: {$realMimeType}"
        );
    }

    // 2. 使用 ffprobe 验证是合法的媒体文件
    $path = $file->getRealPath();
    $process = new \Symfony\Component\Process\Process([
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=format_name',
        '-of', 'csv=p=0',
        $path,
    ]);
    $process->run();

    if (!$process->isSuccessful()) {
        throw new \InvalidArgumentException('非法的媒体文件');
    }

    // 3. 检查文件大小不超过系统限制
    $maxSize = config('media.max_upload_size', 5 * 1024 * 1024 * 1024);
    if ($file->getSize() > $maxSize) {
        throw new \InvalidArgumentException('文件过大');
    }
}
```

## 十、踩坑案例与解决方案

在实际生产中，FFmpeg 集成远比 Demo 复杂。以下是我在多个项目中踩过的坑以及对应的解决方案。

### 10.1 FFmpeg 进程超时处理

**问题描述：** 处理大型视频文件（如 4K 原片、2 小时以上的长视频）时，FFmpeg 进程可能运行数十分钟甚至数小时。如果 Laravel Queue Worker 的 `timeout` 设置不当，进程会被强制杀死，导致已转码的部分文件残留、数据库状态不一致。

```php
// ❌ 错误做法：timeout 设置过短
class MediaProcessJob implements ShouldQueue
{
    public int $timeout = 300;  // 5分钟，远远不够
}

// ✅ 正确做法：根据文件大小动态计算超时时间
class MediaProcessJob implements ShouldQueue
{
    public int $timeout = 7200;  // 最大 2 小时

    public function handle(MediaProcessService $service): void
    {
        // 根据文件大小预估处理时间，提前抛出异常避免浪费资源
        $fileSizeMB = $this->mediaFile->file_size / (1024 * 1024);
        $estimatedMinutes = max(30, $fileSizeMB / 10);  // 粗略估算：10MB/分钟

        if ($estimatedMinutes > 100) {
            // 超大文件走专用队列，使用更高配置的 Worker
            $this->release(now()->addMinutes(5));
            $this->onQueue('media-large-files');
            return;
        }

        $service->process($this->mediaFile);
    }
}
```

**Supervisor 层面的保护：**

```ini
; /etc/supervisor/conf.d/horizon.conf
[program:horizon]
command=php /var/www/artisan horizon
autostart=true
autorestart=true
stopwaitsecs=3600          # 等待 Worker 优雅退出的时间
stopasgroup=true            # 杀死整个进程组
killasgroup=true
```

### 10.2 内存溢出（OOM）

**问题描述：** FFmpeg 在处理高分辨率视频时，FFMpeg PHP 扩展会将帧数据加载到内存。处理 4K 视频的缩略图截图时，单帧数据可达数十 MB，连续截图容易触发 PHP 内存限制。

```php
// ❌ 会触发 OOM 的写法：一次性打开视频并连续截图
public function generateThumbnails(MediaFile $media, int $count = 10): void
{
    $ffmpeg = FFMpeg::create()->open($sourcePath);
    for ($i = 0; $i < $count; $i++) {
        // 每次 frame() 都会在内存中保留帧数据
        $ffmpeg->frame(TimeCode::fromSeconds($timePoint))->save($outputPath);
    }
    // 内存持续增长，10 张 4K 截图可能占用 500MB+
}

// ✅ 修复方案：每次截图后释放资源，或使用原生 FFmpeg 命令
public function generateThumbnailsSafe(MediaFile $media, int $count = 10): void
{
    $sourcePath = Storage::disk($media->disk)->path($media->path);
    $thumbnailDir = Storage::disk('local')->path("thumbnails/{$media->uuid}");

    // 方案 A：使用原生 FFmpeg 的 select 滤镜一次性生成多张截图
    $interval = $media->duration / ($count + 1);
    $selectFilters = collect(range(1, $count))
        ->map(fn($i) => "eq(n\\,{$i})")
        ->implode('+');

    $command = sprintf(
        'ffmpeg -y -i %s -vf "select=%s" -vsync vfr -q:v 2 %s/thumb_%%03d.jpg 2>&1',
        escapeshellarg($sourcePath),
        $selectFilters,
        escapeshellarg($thumbnailDir)
    );

    $process = Process::fromShellCommandline($command);
    $process->setTimeout(300);
    $process->run();

    if (!$process->isSuccessful()) {
        throw new \RuntimeException('Thumbnail generation failed: ' . $process->getErrorOutput());
    }

    // 方案 B：如果必须使用 PHP-FFMpeg，每张截图后手动释放
    for ($i = 0; $i < $count; $i++) {
        $ffmpeg = FFMpeg::create()->open($sourcePath);  // 每次重新打开
        $frame = $ffmpeg->frame(TimeCode::fromSeconds($timePoint));
        $frame->save($outputPath);
        unset($frame, $ffmpeg);  // 显式释放
        gc_collect_cycles();      // 强制回收
    }
}
```

**Queue Worker 内存配置建议：**

```php
// config/horizon.php
'supervisor-1' => [
    'memory' => 1024,        // Worker 进程内存上限 1GB
    'maxJobs' => 5,          // 每个 Worker 最多处理 5 个任务后重启
    'maxTime' => 3600,       // 最大运行时间
],
```

### 10.3 编码器兼容性问题

**问题描述：** 不同服务器环境安装的 FFmpeg 版本和编译选项不同，导致某些编码器不可用。常见的坑：

```php
// 常见错误：libx265 未编译进 FFmpeg
// FFmpeg 输出：Unknown encoder 'libx265'

// 解决方案：启动时检测可用编码器
class EncoderDetector
{
    private static ?array $availableEncoders = null;

    public static function getAvailable(): array
    {
        if (self::$availableEncoders === null) {
            $process = Process::fromShellCommandline('ffmpeg -encoders 2>&1');
            $process->run();
            $output = $process->getOutput();

            self::$availableEncoders = [];
            $knownEncoders = [
                'libx264', 'libx265', 'libvpx', 'libvpx-vp9',
                'h264_nvenc', 'hevc_nvenc',       // NVIDIA
                'h264_vaapi', 'hevc_vaapi',        // Intel VAAPI
                'libmp3lame', 'libopus', 'aac',
            ];

            foreach ($knownEncoders as $encoder) {
                if (str_contains($output, $encoder)) {
                    self::$availableEncoders[] = $encoder;
                }
            }
        }

        return self::$availableEncoders;
    }

    public static function getBestVideoCodec(): string
    {
        $available = self::getAvailable();

        // 优先使用 GPU 加速，其次 H.265，最后 H.264
        $priority = ['h264_nvenc', 'hevc_nvenc', 'libx265', 'libx264'];

        foreach ($priority as $codec) {
            if (in_array($codec, $available)) {
                return $codec;
            }
        }

        throw new \RuntimeException('No suitable video encoder found');
    }
}
```

**H.265 兼容性注意事项：**

> ⚠️ H.265（HEVC）虽然压缩率更高，但在部分浏览器（尤其是旧版 Firefox、Safari）和移动端播放器中可能不被支持。生产环境中务必同时提供 H.264 版本作为兜底，并在前端通过 `MediaSource.isTypeSupported()` 检测后再决定使用哪个版本。

```php
// 双编码器策略：同时输出 H.264 和 H.265
public function transcodeDualCodec(MediaFile $media): void
{
    $resolutions = ['720p' => ['width' => 1280, 'height' => 720, 'bitrate' => '2800k']];

    foreach ($resolutions as $label => $config) {
        // H.264 版本（通用兼容）
        $h264Path = "transcoded/{$media->uuid}/{$label}_h264.mp4";
        FFMpeg::create()->open($sourcePath)->export()
            ->asVideoCodec('libx264')
            ->addFilter('-crf', '23')
            ->addFilter('-preset', 'medium')
            ->save(Storage::disk('local')->path($h264Path));

        // H.265 版本（高压缩率）
        if (EncoderDetector::getAvailable() && in_array('libx265', EncoderDetector::getAvailable())) {
            $h265Path = "transcoded/{$media->uuid}/{$label}_h265.mp4";
            FFMpeg::create()->open($sourcePath)->export()
                ->asVideoCodec('libx265')
                ->addFilter('-crf', '28')      // H.265 的 CRF 值比 H.264 高约 6 可获得同等画质
                ->addFilter('-preset', 'medium')
                ->save(Storage::disk('local')->path($h265Path));
        }
    }
}
```

### 10.4 其他常见坑

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 转码后视频无声音 | 音频流复制失败或编码器不支持 | 明确指定 `-c:a aac` 而非 `copy` |
| 竖屏视频被拉伸 | 未保持宽高比 | 使用 `scale=-2:720` 替代固定宽高，`-2` 保证能被 2 整除 |
| 缩略图全黑 | 截取时间点恰好是黑场 | 跳过首尾 10%，或使用 `thumbnail` 滤镜自动选关键帧 |
| 字幕烧录乱码 | 字体文件缺失或编码不匹配 | 指定字体路径：`force_style='FontName=Noto Sans CJK'` |
| HLS 切片首帧慢 | 缺少 `-hls_flags append_list` | 添加 `-hls_flags independent_segments` |

## 十一、方案对比：自建 FFmpeg vs 云转码服务

在技术选型阶段，你需要权衡自建 FFmpeg 方案与云转码服务的利弊。以下从多个维度进行对比：

| 维度 | 自建 FFmpeg | AWS MediaConvert | 阿里云 MPS |
|------|-------------|-------------------|------------|
| **初始成本** | 需要购买/租赁 GPU 服务器，运维成本高 | 按量付费，无前期投入 | 按量付费，无前期投入 |
| **单价（1080p/分钟）** | 电费 + 服务器折旧 ≈ ¥0.01-0.03 | ≈ $0.024（约 ¥0.17） | ≈ ¥0.06-0.12 |
| **月均成本（10万分钟）** | ≈ ¥1,000-3,000（含服务器） | ≈ ¥17,000 | ≈ ¥6,000-12,000 |
| **启动延迟** | 无，立即开始处理 | API 调用后需排队，通常 5-30 秒 | API 调用后需排队，通常 3-15 秒 |
| **转码速度** | 取决于硬件配置，可水平扩展 | 自动弹性扩展，大文件很快 | 自动弹性扩展 |
| **输出格式** | 完全自定义，支持所有 FFmpeg 格式 | 支持主流格式，自定义程度中等 | 支持主流格式，自定义程度中等 |
| **HLS/DASH** | 完全自定义切片策略 | 内置支持，可配置 | 内置支持，含窄带高清转码 |
| **AI 能力** | 需自行集成，开发成本高 | 内置内容审核、字幕生成 | 内容审核、智能标签、人脸识别 |
| **运维负担** | 高：需要监控、扩缩容、故障恢复 | 低：全托管服务 | 低：全托管服务 |
| **适用场景** | 高吞吐量（>50万分钟/月）、特殊编码需求 | 已在 AWS 生态、需要 AI 增值能力 | 已在阿里云生态、需要国内合规 |
| **成本拐点** | 当月处理量 > 30 万分钟时，自建更划算 | 月处理量 < 10 万分钟时性价比高 | 月处理量 < 20 万分钟时性价比高 |

**选型建议：**

- **初创团队 / 低频场景**：直接用云转码服务，省去运维成本，快速上线
- **中等规模（月 10-30 万分钟）**：混合方案——常用格式自建 FFmpeg，特殊需求（审核、字幕）走云服务
- **大规模（月 50 万分钟+）**：自建方案 + GPU 集群 + Kubernetes 弹性调度，成本优势明显
- **已有云生态**：优先使用对应云厂商的转码服务，减少架构复杂度

```php
// 混合方案示例：根据文件大小动态选择处理方式
class TranscodeStrategyResolver
{
    public function resolve(MediaFile $media): string
    {
        $sizeMB = $media->file_size / (1024 * 1024);
        $duration = $media->duration ?? 0;

        // 短视频（<5分钟）且文件小（<200MB）：本地 FFmpeg 处理
        if ($duration < 300 && $sizeMB < 200) {
            return 'local';
        }

        // 需要 AI 审核：走云服务
        if ($media->meta['needs_content_review'] ?? false) {
            return 'cloud_mps';
        }

        // 大文件走专用 GPU 服务器
        if ($sizeMB > 1024) {
            return 'gpu_cluster';
        }

        return 'local';
    }
}
```

## 十二、完整的路由与前端集成示例

```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/media/upload', [MediaUploadController::class, 'store']);
    Route::get('/media/{uuid}/status', [MediaStatusController::class, 'show']);
    Route::delete('/media/{uuid}', [MediaUploadController::class, 'destroy']);
    Route::get('/media/{uuid}/download/{resolution}', [MediaDownloadController::class, 'show']);
});
```

前端 JavaScript 轮询示例：

```javascript
async function pollMediaStatus(uuid) {
    const interval = setInterval(async () => {
        const response = await fetch(`/api/media/${uuid}/status`);
        const data = await response.json();

        updateProgressBar(data.progress);

        if (data.status === 'completed') {
            clearInterval(interval);
            showSuccess('处理完成！');
            loadVideoPlayer(data.meta);
        } else if (data.status === 'failed') {
            clearInterval(interval);
            showError(`处理失败: ${data.error}`);
        }
    }, 2000);  // 每2秒轮询一次
}
```

## 总结

本文从零开始构建了一套完整的 FFmpeg + Laravel 音视频处理管道，核心架构设计要点包括：

1. **异步化**：所有耗时操作通过 Laravel Queue 异步执行，上传接口秒级响应
2. **管道化**：处理流程拆解为独立步骤，支持逐级重试和监控
3. **多分辨率**：根据原始分辨率自动选择合适的转码档位
4. **水印保护**：在转码后叠加品牌水印，保护内容版权
5. **健壮性**：多层错误处理、超时保护、磁盘检查、卡住任务自动恢复
6. **可观测性**：进度追踪、日志记录、Horizon 监控、事件广播
7. **安全防护**：MIME 类型验证、ffprobe 文件校验、大小限制

在实际生产中，还需要根据业务规模做进一步优化：启用硬件加速提升转码速度、使用分布式队列集群提升并发能力、实现 CDN 加速分发降低带宽成本、引入 FFmpeg 的 HLS 切片实现自适应码率播放等。希望本文能够为你构建音视频处理系统提供扎实的技术基础和实践参考。

## 相关阅读

- [Laravel Pipeline 源码解析：闭包洋葱模型的精妙设计](/categories/PHP/Laravel/laravel-pipeline-source-closure-onion-model/) —— 深入理解本文中 `Bus::chain()` 管道模式背后的 Laravel Pipeline 核心原理
- [PHP FFI 调用 C/Rust 共享库实现高性能计算](/categories/PHP/Laravel/php-ffi-c-rust-shared-library-high-performance/) —— 如果需要极致性能，可以通过 FFI 直接调用 FFmpeg 的 C 库
- [PHP 8.5 Pipe 操作符：链式数据处理与 Laravel Pipeline 实践](/categories/PHP/Laravel/php85-pipe-operator-chain-data-processing-laravel-pipeline/) —— 用 PHP 8.5 新特性简化媒体处理管道的数据流转
