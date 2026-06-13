---
title: 'FFmpeg + Laravel 实战：音视频转码、截图、水印——上传处理管道与队列化异步任务'
date: 2026-06-06 10:00:00
description: '基于实际 Laravel 项目经验，系统讲解 FFmpeg 音视频处理全流程：H.264/H.265 转码压缩、视频截图生成封面、品牌水印叠加、音频提取、HLS 切片自适应码率。集成 laravel-ffmpeg 包与 Pipeline 架构设计，队列化异步任务配合 Laravel Horizon 监控，WebSocket 实时进度推送，涵盖生产环境内存溢出、进程僵尸、磁盘空间、编码兼容性等 8 大踩坑场景与优化方案，附完整可运行代码。'
tags: [FFmpeg, Laravel, 音视频, 转码, 队列, 异步任务]
categories:
  - php
cover: /images/covers/ffmpeg-laravel-cover.jpg
---

在当今互联网产品中，音视频处理已成为许多 Web 应用不可或缺的核心能力。无论是短视频社交平台、在线教育课程系统、企业内部培训平台，还是电商直播回放系统，都绕不开一个关键环节——用户上传视频后，服务端需要对其进行转码、截图生成封面、叠加品牌水印、提取音频等后处理操作。这些处理直接决定了最终用户体验：视频能否在各端流畅播放、首帧加载是否够快、带宽成本是否可控。

然而，音视频处理是一个技术门槛较高、坑点密集的领域。FFmpeg 命令参数繁多，稍有不慎就会导致转码失败或输出质量低下；大文件处理动辄耗时数十分钟，必须依赖异步队列；生产环境中内存溢出、进程僵尸、磁盘空间不足等问题更是防不胜防。

本文将基于多个实际 Laravel 项目的开发经验，从零开始构建一套完整的音视频处理管道，涵盖从 FFmpeg 核心命令讲解、laravel-ffmpeg 包集成、Pipeline 架构设计、队列化异步任务、进度实时推送到生产环境踩坑与优化的全流程。文章会穿插大量可直接复用的代码示例和架构设计思路，希望能为正在或将要面对类似需求的开发者提供一份详尽的实战参考。

<!-- more -->

## 一、为什么需要服务端音视频处理？

在正式开始之前，我们有必要先厘清一个问题：为什么不能让用户在客户端完成这些处理？

事实上，用户通过前端上传的视频文件千差万别。首先是编码格式的多样性——常见的视频编码包括 H.264（AVC）、H.265（HEVC）、VP9、AV1 等，音频编码有 AAC、MP3、Opus、PCM 等。其次是容器格式的差异，MP4、MKV、MOV、AVI、WebM、FLV 等格式各有各的封装方式。再加上分辨率从 480p 到 4K 甚至 8K 不等，码率从几百 Kbps 到几十 Mbps 都有。

这种"百花齐放"的状况如果直接搬到前端播放，会引发一系列严重问题。第一是兼容性问题，浏览器原生的 `<video>` 标签对 H.265 编码的 MP4 支持非常有限，Safari 在 macOS 上能播放但 Chrome 和 Firefox 大多不支持，MKV 格式更是几乎没有浏览器原生支持。第二是体积问题，一部未经优化压缩的 1080p 视频每分钟可能占用 100MB 以上的存储空间，直接存储原始文件对服务器磁盘和用户带宽都是巨大浪费。第三是体验问题，用户无法根据网络状况自动切换清晰度，大文件在弱网环境下几乎无法播放。第四是功能缺失，没有缩略图预览就没有视频封面，没有水印保护就容易被盗用，没有音频提取就无法满足纯听场景。

因此，一个标准的服务端处理流程是：接收原始上传文件 → 异步入队等待处理 → FFmpeg 进行转码/截图/水印/音频提取 → 将产物存储到对象存储 → 通过 CDN 分发到终端用户。整个过程对用户透明，前端只需上传文件、轮询进度、等待完成即可。

## 二、FFmpeg 核心命令详解

FFmpeg 是音视频处理领域事实上的行业标准工具，几乎所有服务端音视频处理方案都以它为基础。它的能力覆盖了格式转换、编码压缩、滤镜处理、流媒体切片等方方面面。在集成到 Laravel 项目之前，我们有必要先掌握其最核心的命令用法，这不仅有助于后续调试排查问题，也能帮助你更好地理解 laravel-ffmpeg 包背后做了什么。

### 2.1 视频信息探测（ffprobe）

在处理视频之前，第一步永远是"探测"——了解原始文件的编码格式、分辨率、时长、码率等元信息。FFmpeg 的配套工具 ffprobe 专门负责这项工作。

```bash
# 获取视频完整元数据（JSON 格式输出，方便程序解析）
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4

# 只获取时长（单位：秒，带小数）
ffprobe -v quiet -show_entries format=duration -of csv=p=0 input.mp4

# 获取视频流的分辨率和编码器名称
ffprobe -v quiet -select_streams v:0 \
  -show_entries stream=width,height,codec_name \
  -of csv=p=0 input.mp4
```

其中 `-v quiet` 表示抑制冗余日志，`-print_format json` 指定输出格式为 JSON（便于 PHP 的 `json_decode` 解析），`-show_entries` 可以精确控制输出哪些字段，避免信息过载。在 Laravel 集成中，我们通常会用 `ffprobe` 获取的这些信息来决定后续的转码策略——比如原始视频已经是 H.264 720p 的话，可能就不需要再转码了。

### 2.2 视频转码（H.264 + AAC → MP4）

视频转码是最核心、最常用的场景。我们的目标是将各种格式的原始视频统一转换为浏览器兼容性最好的格式——H.264 编码 + AAC 音频 + MP4 容器。

```bash
ffmpeg -i input.mov \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 128k \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
  -movflags +faststart \
  -y output.mp4
```

让我们逐一拆解每个参数的含义：

- `-c:v libx264`：指定视频编码器为 libx264（即 H.264/AVC 编码）。这是目前兼容性最广泛的视频编码格式，几乎所有浏览器和设备都支持硬件解码。
- `-preset medium`：控制编码速度与压缩效率的平衡点。可选值从快到慢依次是：ultrafast、superfast、veryfast、faster、fast、medium、slow、slower、veryslow。越慢的预设压缩率越高（输出文件越小），但编码时间越长。生产环境中通常用 `medium` 或 `fast`，对质量要求极高的场景可以考虑 `slow`。
- `-crf 23`：恒定质量因子（Constant Rate Factor），取值范围 0-51，数值越小质量越高。一般推荐 18-28 之间，18 接近视觉无损，23 是默认值，28 开始会有明显的画质下降。这是控制输出质量最直观的方式。
- `-c:a aac -b:a 128k`：音频编码为 AAC 格式，码率 128kbps。对于大多数场景足够，音乐类内容可以提高到 192k 或 256k。
- `-vf "scale=..."`：视频滤镜链。这里用 `scale` 将画面缩放到 720p，同时 `force_original_aspect_ratio=decrease` 保证不拉伸变形，`pad` 在不足 720p 的部分填充黑边。
- `-movflags +faststart`：这是一个非常重要的参数！它将 MP4 文件中的 moov atom（包含索引信息）从文件末尾移到文件头部。没有这个参数的话，浏览器必须下载完整个文件才能开始播放；加上之后，视频可以边下载边播放（伪流式），对用户体验改善巨大。
- `-y`：覆盖输出文件（不提示确认）。

### 2.3 HLS 自适应码率切片

对于长视频或需要多清晰度切换的场景，HLS（HTTP Live Streaming）是工业界的标准方案。它将视频切成小的 TS 分片，配合 m3u8 索引文件，客户端可以根据网络带宽自动在不同清晰度之间切换。

```bash
ffmpeg -i input.mp4 \
  -filter_complex \
    "[0:v]split=3[v1][v2][v3]; \
     [v1]scale=1920:1080[v1out]; \
     [v2]scale=1280:720[v2out]; \
     [v3]scale=854:480[v3out]" \
  -map "[v1out]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k \
  -map "[v2out]" -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 3000k -bufsize:v:1 4200k \
  -map "[v3out]" -c:v:2 libx264 -b:v:2 1400k -maxrate:v:2 1500k -bufsize:v:2 2100k \
  -map a:0 -map a:0 -map a:0 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_list_size 0 \
  -hls_segment_filename "stream_%v/data%03d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  stream_%v/playlist.m3u8
```

这条命令看起来复杂，但逻辑很清晰：`filter_complex` 中用 `split` 滤镜将输入视频分成三路，分别缩放到 1080p、720p、480p；然后对每路分别设置码率参数（`-b:v`、`-maxrate`、`-bufsize`）；最后用 `-f hls` 输出为 HLS 格式。生成的 `master.m3u8` 是主索引文件，播放器读取它后会自动选择合适的清晰度流。

### 2.4 截图与缩略图

视频截图主要用于生成封面图和预览缩略图。

```bash
# 截取指定时间点的画面（-ss 放在 -i 之前可以快速定位，避免从头解码）
ffmpeg -ss 00:00:10 -i input.mp4 -vframes 1 -q:v 2 thumbnail.jpg

# 每秒截取一帧（fps=1），缩放到宽度 160px
ffmpeg -i input.mp4 -vf "fps=1,scale=160:-1" -q:v 5 thumbnails/%04d.jpg

# 生成雪碧图：每 10 秒截取一帧，每帧缩放到 160x90，排列成 5x5 的网格
ffmpeg -i input.mp4 -vf "fps=1/10,scale=160:90,tile=5x5" -q:v 5 sprite.jpg
```

雪碧图（Sprite）是视频网站的常用技巧——将多张缩略图拼成一张大图，前端通过 CSS background-position 来展示特定帧的预览，配合进度条 hover 事件就能实现鼠标悬停预览功能，比逐帧请求图片高效得多。

### 2.5 水印叠加

水印是保护视频版权的基本手段。FFmpeg 支持图片水印和文字水印两种方式。

```bash
# 图片水印（右下角，边距 10px）
ffmpeg -i input.mp4 -i watermark.png \
  -filter_complex "overlay=W-w-10:H-h-10" \
  -c:v libx264 -c:a copy output.mp4

# 文字水印（右下角，带阴影效果）
ffmpeg -i input.mp4 \
  -vf "drawtext=text='© MySite 2026':fontsize=24:fontcolor=white@0.7:\
shadowcolor=black:shadowx=2:shadowy=2:x=W-tw-20:y=H-th-20" \
  -c:v libx264 -c:a copy output.mp4
```

注意 `-c:a copy` 表示音频流直接复制而不重新编码，这样可以大幅加快处理速度。只有当视频流需要处理时才对音频重新编码。

### 2.6 音频提取与处理

有时候我们需要从视频中单独提取音频，比如提供"仅音频模式"供用户在通勤时收听课程。

```bash
# 从视频中提取音频并转为 MP3
ffmpeg -i input.mp4 -vn -c:a libmp3lame -b:a 192k output.mp3

# WAV 转 MP3（设置质量等级 0-9，2 是高质量推荐值）
ffmpeg -i input.wav -c:a libmp3lame -q:a 2 output.mp3

# 音频裁剪：取第 30 秒到第 90 秒的片段
ffmpeg -i input.mp3 -ss 00:00:30 -to 00:01:30 -c copy output.mp3
```

`-vn` 表示丢弃视频流，只处理音频。

## 三、Laravel 集成方案：laravel-ffmpeg 包

直接通过 `exec()` 或 `Symfony\Process` 调用 FFmpeg 命令行虽然可行，但在 Laravel 项目中维护成本较高——你需要手动处理文件路径、存储磁盘切换、错误捕获、进度解析等一系列琐碎问题。推荐使用社区维护的 `protonemedia/laravel-ffmpeg` 包，它提供了优雅的链式 API，并与 Laravel 的存储系统（Storage Facade）、队列系统（Queue）无缝集成，大幅降低开发成本。

### 3.1 安装与配置

```bash
composer require protonemedia/laravel-ffmpeg
php artisan vendor:publish --provider="ProtoneMedia\LaravelFFmpeg\FFmpegServiceProvider"
```

安装完成后会生成 `config/laravel-ffmpeg.php` 配置文件，下面是其中最需要关注的配置项：

```php
return [
    // FFmpeg 和 FFProbe 的二进制文件路径
    'ffmpeg' => [
        'binaries' => env('FFMPEG_BINARIES', '/usr/local/bin/ffmpeg'),
        'threads'  => 12,  // 编码线程数，建议设为 CPU 核心数
    ],
    'ffprobe' => [
        'binaries' => env('FFPROBE_BINARIES', '/usr/local/bin/ffprobe'),
    ],
    // 全局超时时间（秒），根据实际业务场景调整
    'timeout' => 3600,
    // 是否记录 FFmpeg 的完整命令输出（调试时建议开启）
    'enable_logging' => true,
    // 异常时是否在异常消息中附带 FFmpeg 的命令行和错误输出
    'set_command_and_error_output_on_exception' => true,
];
```

`threads` 参数直接影响转码速度，在多核服务器上设置合理的线程数可以获得显著的性能提升。生产环境建议设为 CPU 核心数的 50%-75%，避免过度占用影响 Web 服务的响应能力。

### 3.2 基础用法示例

`laravel-ffmpeg` 的 API 设计非常直观，链式调用清晰地表达了"从哪里读取 → 如何处理 → 输出到哪里"的逻辑流：

```php
use ProtoneMedia\LaravelFFmpeg\FFMpeg;

// 从本地磁盘读取原始文件，转码后保存到 processed 磁盘
FFMpeg::fromDisk('uploads')
    ->open('raw/user123/video.mov')
    ->export()
    ->toDisk('processed')
    ->inFormat(new \FFMpeg\Format\Video\X264('aac', 'libx264'))
    ->save('videos/user123/output.mp4');

// 截取第 10 秒的画面作为缩略图
FFMpeg::fromDisk('uploads')
    ->open('raw/user123/video.mov')
    ->getFrameFromSeconds(10)
    ->export()
    ->toDisk('processed')
    ->save('thumbnails/user123/frame_10.jpg');

// 从视频中提取音频并转为 MP3
FFMpeg::fromDisk('uploads')
    ->open('raw/user123/video.mov')
    ->export()
    ->toDisk('processed')
    ->inFormat(new \FFMpeg\Format\Audio\Mp3)
    ->save('audio/user123/audio.mp3');
```

`fromDisk()` 和 `toDisk()` 接受的参数是 `config/filesystems.php` 中定义的磁盘名称，这意味着你可以轻松地从本地磁盘读取、输出到 S3 或 OSS，存储层的切换对业务代码完全透明。

## 四、视频转码管道设计

在实际项目中，一个视频上传后的处理远不止简单转码这么简单。我们通常需要依次完成：探测媒体信息、按预设清晰度转码、生成多张缩略图和雪碧图、叠加品牌水印、提取音频。这些步骤之间有明确的先后依赖关系，适合用"处理管道"（Pipeline）模式来组织。

### 4.1 数据模型设计

首先定义数据库迁移，存储媒体文件的元信息和处理状态：

```php
Schema::create('media', function (Blueprint $table) {
    $table->id();
    $table->morphs('mediable');   // 多态关联：可属于 Article、Lesson 等任意模型
    $table->string('disk');            // 存储磁盘：local、s3、oss
    $table->string('original_path');   // 原始文件在磁盘中的路径
    $table->string('filename');        // 原始文件名
    $table->string('mime_type');       // MIME 类型
    $table->unsignedBigInteger('size'); // 文件大小（字节）
    
    // 视频专用字段
    $table->string('status')->default('uploaded');  // uploaded → processing → completed → failed
    $table->unsignedInteger('duration')->nullable(); // 视频时长（秒）
    $table->unsignedInteger('width')->nullable();    // 宽度（像素）
    $table->unsignedInteger('height')->nullable();   // 高度（像素）
    $table->string('codec')->nullable();             // 原始编码器名称
    $table->json('processing_config')->nullable();   // 处理配置（清晰度预设、水印等）
    $table->json('variants')->nullable();            // 转码产物路径映射
    $table->json('thumbnails')->nullable();          // 缩略图路径列表
    $table->string('watermark_path')->nullable();    // 带水印版本的路径
    $table->unsignedInteger('progress')->default(0); // 处理进度 0-100
    $table->text('error_message')->nullable();       // 失败时的错误信息
    
    $table->timestamps();
    $table->softDeletes();
});
```

这个表的设计有几个要点值得说明。首先 `morphs('mediable')` 让媒体文件可以关联到任意业务模型——一篇文章可以有配图，一门课程可以有视频，一个商品可以有展示视频。其次 `status` 字段用状态机模式管理生命周期，方便前端展示不同的 UI 状态。最后 `processing_config` 存储 JSON 格式的处理参数，使得同一套处理逻辑可以灵活适配不同业务场景的需求。

### 4.2 Media 模型定义

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Media extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'disk', 'original_path', 'filename', 'mime_type', 'size',
        'status', 'duration', 'width', 'height', 'codec',
        'processing_config', 'variants', 'thumbnails',
        'watermark_path', 'progress', 'error_message',
    ];

    protected $casts = [
        'processing_config' => 'array',
        'variants'          => 'array',
        'thumbnails'        => 'array',
    ];

    public function mediable(): MorphTo
    {
        return $this->morphTo();
    }

    public function isVideo(): bool
    {
        return str_starts_with($this->mime_type, 'video/');
    }

    public function isAudio(): bool
    {
        return str_starts_with($this->mime_type, 'audio/');
    }

    public function isImage(): bool
    {
        return str_starts_with($this->mime_type, 'image/');
    }

    /**
     * 更新处理进度并通过广播推送到前端
     */
    public function updateProgress(int $progress): void
    {
        $this->update(['progress' => min(100, max(0, $progress))]);
        broadcast(new \App\Events\MediaProcessingProgress($this))->toOthers();
    }
}
```

`updateProgress` 方法是连接后端处理逻辑和前端进度展示的桥梁。每完成一个处理步骤，就调用它更新进度百分比，同时通过 Laravel 的事件广播机制实时推送到前端。

### 4.3 处理管道步骤设计

采用 Laravel 内置的 Pipeline 组件，每个处理步骤实现统一的接口：

```php
namespace App\MediaProcessing;

use App\Models\Media;
use Closure;

interface ProcessingStep
{
    /**
     * 处理媒体文件的某一步骤
     * 调用 $next($media) 将控制权传给管道中的下一步
     */
    public function handle(Media $media, Closure $next): mixed;
}
```

下面逐个实现各个步骤。

**步骤一：探测媒体信息**

这一步使用 ffprobe 获取视频的分辨率、时长、编码器等基础信息，为后续的转码策略决策提供依据。同时也能在最早期发现损坏的文件，避免白白消耗转码资源。

```php
namespace App\MediaProcessing\Steps;

use App\MediaProcessing\ProcessingStep;
use App\Models\Media;
use Closure;
use FFMpeg\FFProbe;

class ProbeMediaInfo implements ProcessingStep
{
    public function handle(Media $media, Closure $next): mixed
    {
        if (!$media->isVideo() && !$media->isAudio()) {
            return $next($media);
        }

        $fullPath = storage_path('app/' . $media->original_path);
        
        // 验证文件确实存在
        if (!file_exists($fullPath)) {
            throw new \RuntimeException("Source file not found: {$media->original_path}");
        }

        $ffprobe = FFProbe::create(config('laravel-ffmpeg.ffprobe.binaries'));
        
        // 获取视频流信息
        $stream = $ffprobe->streams($fullPath)->videos()->first();
        $format = $ffprobe->format($fullPath);

        $media->update([
            'width'    => $stream ? $stream->get('width') : null,
            'height'   => $stream ? $stream->get('height') : null,
            'duration' => (int) ($format->get('duration') ?? 0),
            'codec'    => $stream ? $stream->get('codec_name') : null,
        ]);

        $media->updateProgress(10);

        return $next($media);
    }
}
```

**步骤二：视频转码**

这是整个管道中最耗时、最核心的步骤。根据用户选择的清晰度预设，逐一进行转码处理。每完成一个预设就更新一次进度。

```php
namespace App\MediaProcessing\Steps;

use App\MediaProcessing\ProcessingStep;
use App\Models\Media;
use Closure;
use ProtoneMedia\LaravelFFmpeg\FFMpeg;

class TranscodeVideo implements ProcessingStep
{
    // 清晰度预设配置：宽、高、视频码率（Kbps）
    private const PRESETS = [
        '1080p' => ['width' => 1920, 'height' => 1080, 'bitrate' => 5000],
        '720p'  => ['width' => 1280, 'height' => 720,  'bitrate' => 2800],
        '480p'  => ['width' => 854,  'height' => 480,  'bitrate' => 1400],
        '360p'  => ['width' => 640,  'height' => 360,  'bitrate' => 800],
    ];

    public function handle(Media $media, Closure $next): mixed
    {
        if (!$media->isVideo()) {
            return $next($media);
        }

        $config = $media->processing_config ?? [];
        $presets = $config['presets'] ?? ['720p'];
        $variants = [];
        $totalPresets = count($presets);

        foreach ($presets as $index => $preset) {
            $presetConfig = self::PRESETS[$preset] ?? self::PRESETS['720p'];
            $outputPath = "videos/{$media->id}/{$preset}.mp4";

            // 如果原始分辨率低于目标预设，跳过该预设
            if ($media->height && $media->height < $presetConfig['height']) {
                continue;
            }

            FFMpeg::fromDisk($media->disk)
                ->open($media->original_path)
                ->export()
                ->toDisk($media->disk)
                ->addFilter(function ($filters) use ($presetConfig) {
                    $filters->resize(
                        new \FFMpeg\Coordinate\Dimension(
                            $presetConfig['width'],
                            $presetConfig['height']
                        )
                    );
                })
                ->inFormat(function ($format) use ($presetConfig) {
                    $format->setKiloBitrate($presetConfig['bitrate'])
                        ->setAudioKiloBitrate(128)
                        ->setAudioCodec('aac')
                        ->setVideoCodec('libx264');
                })
                ->onProgress(function ($percentage) use ($media, $index, $totalPresets) {
                    // 将每个预设的进度映射到总体 10%-60% 的区间
                    $base = 10 + ($index / $totalPresets) * 50;
                    $step = (1 / $totalPresets) * 50;
                    $media->updateProgress((int) ($base + $percentage / 100 * $step));
                })
                ->save($outputPath);

            $variants[$preset] = $outputPath;
        }

        $media->update(['variants' => $variants]);
        return $next($media);
    }
}
```

值得注意的是 `onProgress` 回调的用法——laravel-ffmpeg 在 FFmpeg 编码过程中会定期触发这个回调，传入当前的百分比进度（0-100）。我们将每个预设的进度映射到总体进度的一个区间段，这样前端就能看到一个持续增长的进度条，而不是卡在某个数字不动。

**步骤三：提取缩略图和雪碧图**

```php
namespace App\MediaProcessing\Steps;

use App\MediaProcessing\ProcessingStep;
use App\Models\Media;
use Closure;
use ProtoneMedia\LaravelFFmpeg\FFMpeg;

class ExtractThumbnails implements ProcessingStep
{
    public function handle(Media $media, Closure $next): mixed
    {
        if (!$media->isVideo()) {
            return $next($media);
        }

        $thumbnails = [];
        $duration = $media->duration ?: 60;
        
        // 在视频的 5 个均匀分布的时间点截取画面
        $timestampPoints = [0.02, 0.25, 0.5, 0.75, 0.95]; // 百分比位置
        $timestamps = array_map(function ($pct) use ($duration) {
            return max(1, (int) ($duration * $pct));
        }, $timestampPoints);
        $timestamps = array_unique($timestamps);

        foreach ($timestamps as $index => $second) {
            $path = "thumbnails/{$media->id}/frame_{$index}.jpg";

            FFMpeg::fromDisk($media->disk)
                ->open($media->original_path)
                ->getFrameFromSeconds($second)
                ->export()
                ->toDisk($media->disk)
                ->save($path);

            $thumbnails[] = $path;
        }

        // 生成雪碧图（缩略图拼接大图，用于视频进度条预览）
        $spritePath = "thumbnails/{$media->id}/sprite.jpg";
        $this->generateSprite($media, $spritePath);
        $thumbnails['sprite'] = $spritePath;

        $media->update(['thumbnails' => $thumbnails]);
        $media->updateProgress(70);

        return $next($media);
    }

    /**
     * 生成雪碧图：每隔一定时间截取一帧，排列成 tile 网格
     * laravel-ffmpeg 不直接支持 tile 滤镜，需要通过命令行调用
     */
    private function generateSprite(Media $media, string $outputPath): void
    {
        $inputPath = storage_path('app/' . $media->original_path);
        $outFullPath = storage_path('app/' . $outputPath);
        
        // 根据视频时长决定采样频率：大约生成 25 帧用于雪碧图
        $interval = max(1, (int) ($media->duration / 25));
        
        $cmd = sprintf(
            'ffmpeg -i %s -vf "fps=1/%d,scale=160:90,tile=5x5" -q:v 5 -y %s 2>&1',
            escapeshellarg($inputPath),
            $interval,
            escapeshellarg($outFullPath)
        );

        exec($cmd, $output, $exitCode);

        if ($exitCode !== 0) {
            \Log::warning('Sprite generation failed for media #' . $media->id, [
                'exit_code' => $exitCode,
                'output'    => implode("\n", array_slice($output, -10)),
            ]);
        }
    }
}
```

雪碧图的生成用到了 `tile` 滤镜，这个功能 laravel-ffmpeg 没有封装，所以这里直接通过 `exec()` 调用 FFmpeg 命令行。这也是实际开发中的常见情况——不是所有 FFmpeg 功能都有对应的 PHP 包装，对于复杂的滤镜链，直接调命令行往往更可靠。

**步骤四：叠加水印**

```php
namespace App\MediaProcessing\Steps;

use App\MediaProcessing\ProcessingStep;
use App\Models\Media;
use Closure;
use ProtoneMedia\LaravelFFmpeg\FFMpeg;

class AddWatermark implements ProcessingStep
{
    public function handle(Media $media, Closure $next): mixed
    {
        $config = $media->processing_config ?? [];

        // 如果没有配置水印或不是视频文件，跳过此步骤
        if (empty($config['watermark']) || !$media->isVideo()) {
            return $next($media);
        }

        $watermarkPath = $config['watermark']; // 水印图片在 storage 中的路径
        $outputPath = "videos/{$media->id}/watermarked.mp4";

        FFMpeg::fromDisk($media->disk)
            ->open($media->original_path)
            ->export()
            ->toDisk($media->disk)
            ->addWatermark(function ($watermark) use ($watermarkPath) {
                $watermark->fromDisk('public')
                    ->open($watermarkPath)
                    ->right(10)     // 距离右边 10 像素
                    ->bottom(10)    // 距离底部 10 像素
                    ->width(120);   // 水印图片宽度 120 像素（高度自动等比缩放）
            })
            ->inFormat(new \FFMpeg\Format\Video\X264('aac', 'libx264'))
            ->save($outputPath);

        $media->update(['watermark_path' => $outputPath]);
        $media->updateProgress(85);

        return $next($media);
    }
}
```

**步骤五：提取音频**

```php
namespace App\MediaProcessing\Steps;

use App\MediaProcessing\ProcessingStep;
use App\Models\Media;
use Closure;
use FFMpeg\Format\Audio\Mp3;
use ProtoneMedia\LaravelFFmpeg\FFMpeg;

class ExtractAudio implements ProcessingStep
{
    public function handle(Media $media, Closure $next): mixed
    {
        $config = $media->processing_config ?? [];

        if (empty($config['extract_audio']) || !$media->isVideo()) {
            return $next($media);
        }

        $audioPath = "audio/{$media->id}/audio.mp3";

        FFMpeg::fromDisk($media->disk)
            ->open($media->original_path)
            ->export()
            ->toDisk($media->disk)
            ->inFormat(new Mp3)
            ->save($audioPath);

        $variants = $media->variants ?? [];
        $variants['audio'] = $audioPath;
        $media->update(['variants' => $variants]);
        $media->updateProgress(95);

        return $next($media);
    }
}
```

**步骤六：标记完成**

```php
namespace App\MediaProcessing\Steps;

use App\MediaProcessing\ProcessingStep;
use App\Models\Media;
use Closure;

class MarkAsCompleted implements ProcessingStep
{
    public function handle(Media $media, Closure $next): mixed
    {
        $media->update([
            'status'   => 'completed',
            'progress' => 100,
        ]);

        event(new \App\Events\MediaProcessingCompleted($media));

        return $next($media);
    }
}
```

### 4.4 管道执行器

将所有步骤组合起来，通过 Laravel 的 Pipeline 组件串联执行：

```php
namespace App\MediaProcessing;

use App\Models\Media;
use Illuminate\Pipeline\Pipeline;

class MediaProcessingPipeline
{
    // 视频文件的完整处理步骤
    private array $videoSteps = [
        Steps\ProbeMediaInfo::class,
        Steps\TranscodeVideo::class,
        Steps\ExtractThumbnails::class,
        Steps\AddWatermark::class,
        Steps\ExtractAudio::class,
        Steps\MarkAsCompleted::class,
    ];

    // 音频文件的处理步骤（跳过转码和截图）
    private array $audioSteps = [
        Steps\ProbeMediaInfo::class,
        Steps\ExtractAudio::class,
        Steps\MarkAsCompleted::class,
    ];

    /**
     * 根据媒体类型自动选择合适的处理步骤
     */
    public function process(Media $media): void
    {
        $steps = match (true) {
            $media->isVideo() => $this->videoSteps,
            $media->isAudio() => $this->audioSteps,
            default           => [Steps\MarkAsCompleted::class],
        };

        app(Pipeline::class)
            ->send($media)
            ->through($steps)
            ->thenReturn();
    }
}
```

Pipeline 模式的优势在于解耦和可扩展性。每个步骤只关注自己的职责，通过 `$next($media)` 将控制权传给下一步。如果未来需要新增"生成字幕"或"AI 内容审核"步骤，只需实现新的 `ProcessingStep` 类并插入管道即可，不需要修改已有的任何步骤代码。

## 五、队列化异步任务（Laravel Queue + Horizon）

视频转码是典型的 CPU 密集型操作，一个 10 分钟的 1080p 视频在普通服务器上可能需要 5-15 分钟才能转码完成。如果在 HTTP 请求中同步处理，不仅用户要等很久，还可能触发 PHP 的 `max_execution_time` 限制导致进程被杀。因此，所有音视频处理任务必须异步执行。

### 5.1 Job 定义

```php
namespace App\Jobs;

use App\MediaProcessing\MediaProcessingPipeline;
use App\Models\Media;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessMediaJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, SerializesModels;

    public int $tries = 3;           // 最多重试 3 次
    public int $maxExceptions = 2;   // 最多抛出 2 次异常
    public int $timeout = 3600;      // 单次执行超时 1 小时
    public int $backoff = 60;        // 重试间隔 60 秒

    public function __construct(
        public Media $media
    ) {
        // 指定队列名称，与其他业务队列隔离
        $this->onQueue('media-processing');
    }

    public function handle(MediaProcessingPipeline $pipeline): void
    {
        Log::info('Starting media processing', [
            'media_id' => $this->media->id,
            'filename' => $this->media->filename,
            'size'     => $this->media->size,
        ]);

        $this->media->update(['status' => 'processing', 'progress' => 0]);

        try {
            $pipeline->process($this->media);

            Log::info('Media processing completed', ['media_id' => $this->media->id]);
        } catch (\Exception $e) {
            $this->media->update([
                'status'        => 'failed',
                'error_message' => $e->getMessage(),
            ]);

            Log::error('Media processing failed', [
                'media_id' => $this->media->id,
                'error'    => $e->getMessage(),
            ]);

            throw $e; // 重新抛出以触发 Laravel 的自动重试机制
        }
    }

    /**
     * 所有重试都失败后的最终处理
     */
    public function failed(\Throwable $exception): void
    {
        $this->media->update([
            'status'        => 'failed',
            'error_message' => "Processing failed after {$this->tries} attempts: {$exception->getMessage()}",
        ]);

        Log::critical('Media processing failed permanently', [
            'media_id' => $this->media->id,
            'error'    => $exception->getMessage(),
        ]);

        // 可以在这里发送告警通知，比如 Slack、钉钉、邮件等
    }
}
```

Job 的几个关键参数需要根据业务场景仔细调整。`timeout` 设为 3600 秒是因为长视频转码确实可能耗时很久，但如果绝大多数视频都在 5 分钟以内，可以适当缩短到 600 秒。`tries` 和 `backoff` 配合实现指数退避重试——第一次失败后等 60 秒重试，第二次再等 60 秒，第三次仍然失败就进入 `failed` 方法。

### 5.2 上传控制器

```php
namespace App\Http\Controllers;

use App\Jobs\ProcessMediaJob;
use App\Models\Media;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class MediaUploadController extends Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'file'           => 'required|file|max:2097152', // 最大 2GB（单位 KB）
            'preset'         => 'sometimes|array',
            'preset.*'       => 'string|in:1080p,720p,480p,360p',
            'watermark'      => 'sometimes|boolean',
            'extract_audio'  => 'sometimes|boolean',
        ]);

        $file = $request->file('file');
        
        // 生成唯一文件名，避免冲突和路径穿越攻击
        $filename = date('Ymd') . '/' . uniqid('media_', true) . '.' . $file->getClientOriginalExtension();
        $path = $file->storeAs('raw/' . auth()->id(), $filename);

        $media = Media::create([
            'disk'       => config('filesystems.default'),
            'original_path' => $path,
            'filename'   => $file->getClientOriginalName(),
            'mime_type'  => $file->getMimeType(),
            'size'       => $file->getSize(),
            'status'     => 'uploaded',
            'processing_config' => [
                'presets'       => $request->input('preset', ['720p']),
                'watermark'     => $request->boolean('watermark') ? 'watermarks/default.png' : null,
                'extract_audio' => $request->boolean('extract_audio', false),
            ],
        ]);

        // 分发异步任务，立即返回 202 响应
        ProcessMediaJob::dispatch($media);

        return response()->json([
            'message'   => '文件上传成功，正在后台处理',
            'media_id'  => $media->id,
            'status'    => $media->status,
        ], 202);
    }

    /**
     * 查询媒体处理进度（供前端轮询使用）
     */
    public function progress(Media $media)
    {
        // 权限检查：只有上传者才能查看进度
        $this->authorize('view', $media);

        return response()->json([
            'status'     => $media->status,
            'progress'   => $media->progress,
            'error'      => $media->error_message,
            'variants'   => $media->isCompleted() ? $media->variants : null,
            'thumbnails' => $media->isCompleted() ? $media->thumbnails : null,
        ]);
    }
}
```

返回 202 状态码是 RESTful 设计中的最佳实践，表示"请求已接受，但处理尚未完成"，语义上比 200 更准确。

### 5.3 Horizon 配置与监控

Laravel Horizon 是 Redis 队列的管理面板和监控工具，提供了一个可视化的 Web 界面来查看队列状态、Worker 数量、任务吞吐量等信息。

```bash
composer require laravel/horizon
php artisan horizon:install
php artisan horizon:publish
```

Horizon 的核心配置文件 `config/horizon.php` 中，`environments` 部分定义了不同环境下的 Worker 配置：

```php
'environments' => [
    'production' => [
        'media-supervisor' => [
            'connection'    => 'redis',
            'queue'         => ['media-processing'],
            'maxProcesses'  => 5,      // 视频处理占用大量 CPU，不宜开太多 Worker
            'maxTime'       => 3600,
            'maxJobs'       => 50,     // 每个 Worker 处理 50 个任务后重启（防内存泄漏）
            'memory'        => 512,    // 每个进程最大内存 512MB
            'tries'         => 3,
            'timeout'       => 3600,
            'nice'          => 10,     // 降低 CPU 优先级，避免抢占 Web 请求的计算资源
            'balance'       => 'auto', // 自动负载均衡
        ],
        'general-supervisor' => [
            'connection'   => 'redis',
            'queue'        => ['default', 'emails', 'notifications'],
            'maxProcesses' => 10,
            'memory'       => 128,
        ],
    ],
    'local' => [
        'supervisor-1' => [
            'maxProcesses' => 3,
            'queue'        => ['media-processing', 'default'],
            'balance'      => 'false',
        ],
    ],
],
```

`nice => 10` 是一个容易被忽略但非常重要的配置。它将 Worker 进程的 CPU 优先级降低，确保在视频转码高峰期间 Web 请求（如页面加载、API 调用）不会因为 CPU 被抢占而变慢。`maxJobs => 50` 让每个 Worker 处理一定数量的任务后自动重启进程，这是防止内存泄漏的经典手段——即使代码中有微小的内存泄漏，Worker 重启后也会释放掉。

## 六、存储策略设计

### 6.1 多磁盘配置

生产环境中，原始文件和处理产物通常存储在不同的位置。原始文件上传后先保存在本地磁盘（因为 FFmpeg 从本地读取速度最快），处理完成后将产物上传到对象存储（S3/OSS），最后通过 CDN 分发给终端用户。

```php
// config/filesystems.php
'disks' => [
    'uploads' => [
        'driver' => 'local',
        'root'   => storage_path('app/uploads'),
        'url'    => env('APP_URL') . '/storage/uploads',
    ],
    'processed' => [
        'driver'     => 's3',
        'key'        => env('AWS_ACCESS_KEY_ID'),
        'secret'     => env('AWS_SECRET_ACCESS_KEY'),
        'region'     => env('AWS_DEFAULT_REGION'),
        'bucket'     => env('AWS_PROCESSED_BUCKET'),
        'url'        => env('AWS_PROCESSED_URL'),
        'visibility' => 'public',
    ],
],
```

### 6.2 原始文件清理策略

原始文件在处理完成后不会立即删除，而是设置一个过期时间。这样如果转码出了问题需要重新处理，还有原始文件可用。过期后由定时任务清理。

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每天凌晨 3 点清理过期的原始文件
    $schedule->call(function () {
        Media::query()
            ->where('status', 'completed')
            ->whereNotNull('original_path')
            ->where('updated_at', '<', now()->subDays(7))
            ->each(function (Media $media) {
                Storage::disk($media->disk)->delete($media->original_path);
                $media->update(['original_path' => null]);
            });
    })->dailyAt('03:00');
}
```

## 七、进度回调与前端实时展示

### 7.1 WebSocket 广播方案

前面已经提到通过 `broadcast()` 推送进度事件，下面是完整的事件类和前端消费代码：

```php
namespace App\Events;

use App\Models\Media;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class MediaProcessingProgress implements ShouldBroadcast
{
    use InteractsWithSockets;

    public function __construct(public Media $media) {}

    public function broadcastOn(): array
    {
        return [new Channel("media.{$this->media->id}")];
    }

    public function broadcastAs(): string
    {
        return 'processing.progress';
    }

    public function broadcastWith(): array
    {
        return [
            'progress' => $this->media->progress,
            'status'   => $this->media->status,
        ];
    }
}
```

前端 JavaScript 通过 Laravel Echo 订阅进度频道：

```javascript
// 上传文件后监听处理进度
Echo.channel(`media.${mediaId}`)
    .listen('.processing.progress', (event) => {
        document.getElementById('progress-bar').style.width = `${event.progress}%`;
        document.getElementById('progress-text').textContent = `${event.progress}%`;
        
        if (event.status === 'completed') {
            showToast('视频处理完成！', 'success');
            Echo.leave(`media.${mediaId}`);
            // 加载转码后的视频播放器
            loadVideoPlayer(event.mediaId);
        } else if (event.status === 'failed') {
            showToast('视频处理失败，请重试', 'error');
            Echo.leave(`media.${mediaId}`);
        }
    });
```

### 7.2 轮询降级方案

WebSocket 连接可能因为网络问题断开，因此建议同时实现 HTTP 轮询作为降级方案：

```javascript
function pollProgress(mediaId) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/media/${mediaId}/progress`);
            const data = await res.json();
            updateProgressBar(data.progress);
            
            if (['completed', 'failed'].includes(data.status)) {
                clearInterval(interval);
                handleFinalStatus(data);
            }
        } catch (e) {
            console.warn('Progress polling failed, will retry...', e);
        }
    }, 3000); // 每 3 秒轮询一次
    
    return interval; // 返回 ID 以便需要时清除
}
```

## 八、生产环境踩坑记录

在多个项目的生产环境部署和运维过程中，我们遇到了大量意料之外的问题。以下是最高频、最典型的坑点及其解决方案，希望读者能引以为鉴。

### 8.1 内存溢出（OOM）

**现象**：处理 4K 视频时，Worker 进程内存迅速飙升到 512MB 以上，被系统 OOM Killer 强制终止。

**根因分析**：laravel-ffmpeg 底层使用的 PHP-FFMpeg 库在解码视频帧时，会将帧数据加载到 PHP 内存中。4K 视频一帧未压缩的画面数据约 3840 × 2160 × 3 ≈ 24MB，如果同时处理多帧或者进行复杂滤镜运算，内存消耗会急剧上升。

**解决方案**：

```php
// 方案一：调高内存限制（治标）
public function handle(): void
{
    ini_set('memory_limit', '1024M');
    // ...
}

// 方案二：使用 Symfony Process 直接调 FFmpeg 二进制（治本）
// 这样 FFmpeg 在独立进程中运行，不占用 PHP Worker 的内存
use Symfony\Component\Process\Process;

$process = new Process([
    'ffmpeg', '-i', $inputPath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', $outputPath,
]);

$process->setTimeout(3600);
$process->run();

if (!$process->isSuccessful()) {
    throw new \RuntimeException('FFmpeg failed: ' . $process->getErrorOutput());
}
```

对于大型视频文件，强烈推荐方案二。FFmpeg 本身有完善的内存管理，但在 PHP 进程内通过 FFmpeg binding 调用时会多一层内存开销。直接 spawn FFmpeg 子进程是最安全的做法。

### 8.2 处理超时

**现象**：2 小时的培训课程视频，转码时间超过 1 小时，触发了 Job 的 `timeout` 限制。

**解决方案**：

```php
// 1. 延长超时时间
public int $timeout = 7200; // 2 小时

// 2. 对于超长视频，采用分段处理策略
class ProcessLongVideoJob implements ShouldQueue
{
    public int $timeout = 7200;
    
    public function handle(): void
    {
        $duration = $this->media->duration;
        
        if ($duration > 5400) { // 超过 90 分钟的视频分段处理
            $this->processInSegments();
        } else {
            $this->processInOneGo();
        }
    }
    
    private function processInSegments(): void
    {
        $segmentDuration = 600; // 每段 10 分钟
        $totalSegments = (int) ceil($this->media->duration / $segmentDuration);
        $segmentFiles = [];
        
        for ($i = 0; $i < $totalSegments; $i++) {
            $start = $i * $segmentDuration;
            $segmentPath = "temp/{$this->media->id}/seg_{$i}.mp4";
            $fullPath = storage_path('app/' . $segmentPath);
            
            $process = new Process([
                'ffmpeg', '-ss', (string) $start,
                '-i', storage_path('app/' . $this->media->original_path),
                '-t', (string) $segmentDuration,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
                '-c:a', 'aac', '-b:a', '128k',
                '-y', $fullPath,
            ]);
            $process->setTimeout(600); // 每段最多 10 分钟
            $process->run();
            
            $segmentFiles[] = $fullPath;
            $this->media->updateProgress((int) (($i + 1) / $totalSegments * 60));
        }
        
        // 用 concat demuxer 合并分段
        $this->concatSegments($segmentFiles);
    }
    
    private function concatSegments(array $segmentFiles): void
    {
        // 生成 concat 列表文件
        $listPath = storage_path("app/temp/{$this->media->id}/concat.txt");
        $listContent = collect($segmentFiles)
            ->map(fn($f) => "file '{$f}'")
            ->join("\n");
        file_put_contents($listPath, $listContent);
        
        $outputPath = storage_path("app/videos/{$this->media->id}/720p.mp4");
        
        $process = new Process([
            'ffmpeg', '-f', 'concat', '-safe', '0',
            '-i', $listPath, '-c', 'copy', '-y', $outputPath,
        ]);
        $process->setTimeout(600);
        $process->run();
        
        // 清理临时文件
        array_map('unlink', $segmentFiles);
        unlink($listPath);
    }
}
```

### 8.3 FFmpeg 进程僵尸

**现象**：Horizon 重启或 Worker 被 kill 后，FFmpeg 子进程仍然在后台运行，持续消耗 CPU 和磁盘 I/O。

**解决方案**：

```php
// 使用 timeout 命令为 FFmpeg 设置运行时间上限
$process = new Process([
    'timeout', '3600',  // 绝对超时：最多运行 1 小时
    'ffmpeg', '-i', $inputPath,
    // ... 其他参数
]);

// Job 的 failed 回调中清理残留进程
public function failed(\Throwable $exception): void
{
    // 通过进程名查找并终止残留的 FFmpeg 进程
    $process = new Process([
        'pkill', '-f', "ffmpeg.*{$this->media->id}"
    ]);
    $process->run();
}
```

也可以在 crontab 中添加定期清理任务，防止极端情况下出现大量僵尸进程：

```bash
# 每小时清理运行超过 2 小时的 FFmpeg 进程
0 * * * * ps -eo pid,etime,comm | awk '/ffmpeg/ { split($2,t,":"); if (t[1]>=2) print $1 }' | xargs -r kill -9
```

### 8.4 磁盘空间耗尽

**现象**：多个大视频同时处理，临时文件和输出文件迅速填满磁盘，导致其他服务（如数据库、Redis）也受影响。

**解决方案**：

```php
// 在开始处理前检查磁盘空间
private function ensureDiskSpace(string $path, int $fileSize): void
{
    $freeSpace = disk_free_space(dirname($path));
    $requiredSpace = $fileSize * 3; // 预留 3 倍空间（原始 + 输出 + 临时）
    
    if ($freeSpace < $requiredSpace) {
        throw new \RuntimeException(
            sprintf(
                'Insufficient disk space. Need %s, available %s',
                $this->formatBytes($requiredSpace),
                $this->formatBytes($freeSpace)
            )
        );
    }
}

// 在 Queue Worker 层面设置磁盘空间下限
// .env 中配置，低于此值 Worker 拒绝接收新任务
HORIZON_DISK_SPACE_THRESHOLD=5368709120  // 5GB
```

### 8.5 编解码器兼容性问题

**现象**：用户上传的某些 MOV 文件使用 ProRes 编码或 VP9 编码，服务器的 FFmpeg 没有对应的解码器，转码失败。

**解决方案**：

```php
class ProbeMediaInfo implements ProcessingStep
{
    // 当前服务器 FFmpeg 支持的编码器列表（启动时缓存）
    private static ?array $supportedCodecs = null;

    public function handle(Media $media, Closure $next): mixed
    {
        $ffprobe = FFProbe::create();
        $stream = $ffprobe->streams($fullPath)->videos()->first();
        $sourceCodec = $stream->get('codec_name');
        
        // 检查源编码器是否可解码
        $supported = $this->getSupportedDecoders();
        if (!in_array($sourceCodec, $supported)) {
            throw new \RuntimeException(
                "Unsupported video codec: {$sourceCodec}. " .
                "Supported codecs: " . implode(', ', $supported)
            );
        }
        
        // 检查目标编码器是否可用
        if (!in_array('libx264', $this->getSupportedEncoders())) {
            throw new \RuntimeException('Server FFmpeg does not support libx264 encoder');
        }
        
        return $next($media);
    }
    
    private function getSupportedDecoders(): array
    {
        if (self::$supportedCodecs === null) {
            $output = shell_exec('ffmpeg -decoders 2>/dev/null');
            preg_match_all('/^\s[D.][VAS.]{4}\s+(\S+)/m', $output ?? '', $matches);
            self::$supportedCodecs = $matches[1] ?? [];
        }
        return self::$supportedCodecs;
    }
    
    private function getSupportedEncoders(): array
    {
        $output = shell_exec('ffmpeg -encoders 2>/dev/null');
        preg_match_all('/^\s[D.][VAS.]{4}\s+(\S+)/m', $output ?? '', $matches);
        return $matches[1] ?? [];
    }
}
```

**最佳实践**：在 Docker 镜像构建阶段就安装完整的 FFmpeg（包含所有常用编解码器），使用 `ffmpeg -buildconf` 确认编译时启用了 libx264、libx265、libmp3lame、libfdk_aac 等常用编码器。

### 8.6 多服务器部署的一致性问题

**现象**：水平扩展了多台 Worker 服务器后，原始文件在 A 服务器上，B 服务器无法访问。

**解决方案**：将原始文件存储在共享存储（NFS/EFS）或对象存储（S3/OSS）上，所有 Worker 从同一个位置读取。另一种方案是 Worker 先从共享存储下载到本地临时目录，处理完再上传回去。

## 九、架构总结与最佳实践

经过前面各章节的详细讨论，我们将整个方案的架构做一个全局性的梳理。整个处理流程可以概括为六个阶段：

第一阶段，前端将用户选择的文件上传到 Laravel 后端，后端将文件保存到本地磁盘（或直接上传到对象存储），创建 Media 记录，分发 ProcessMediaJob 到 Redis 队列，立即返回 202 响应给前端。

第二阶段，Horizon 的 Worker 进程从队列中取出 Job，调用 MediaProcessingPipeline 开始执行处理管道。

第三阶段，管道依次执行：ffprobe 探测媒体信息 → FFmpeg 按预设清晰度转码 → 截取缩略图和雪碧图 → 叠加水印 → 提取音频 → 标记完成。每个步骤完成后更新进度并广播到前端。

第四阶段，处理产物存储到对象存储（S3/OSS），原始文件按策略延迟清理。

第五阶段，前端通过 WebSocket 或轮询获取进度，完成后加载播放器展示转码后的视频。

第六阶段，CDN 缓存和分发处理产物，终端用户通过最近的 CDN 节点访问视频。

在编码和架构层面，有几个最佳实践值得再次强调。一是永远不要在 HTTP 请求中同步处理视频，队列化是必须的。二是 Pipeline 模式比巨型 Service 类更容易维护和扩展。三是对 FFmpeg 进程设置绝对超时，避免失控。四是处理前检查磁盘空间，处理后及时清理临时文件。五是使用 onProgress 回调和事件广播实现进度反馈，让前端用户知道"还在处理中"而不是"是否卡住了"。六是在 Worker 配置中降低 CPU 优先级（nice），避免影响 Web 服务的响应速度。

## 十、性能优化进阶

### 10.1 硬件加速

如果服务器配备 NVIDIA GPU，使用 NVENC 硬件编码器可以获得 5-10 倍的编码速度提升，代价是同码率下画质略低于 libx264 软编码。对于实时性要求高的场景（如直播转码），这是非常值得的取舍。

```bash
# 使用 NVENC 硬件加速
ffmpeg -i input.mp4 -c:v h264_nvenc -preset p4 -b:v 5000k -c:a aac output.mp4
```

### 10.2 两趟编码（Two-Pass）

对于需要精确控制输出文件大小的场景，可以使用两趟编码。第一趟分析视频内容的复杂度分布，第二趟根据分析结果智能分配码率。

```bash
# 第一趟：分析
ffmpeg -i input.mp4 -c:v libx264 -b:v 3000k -pass 1 -f null /dev/null
# 第二趟：编码
ffmpeg -i input.mp4 -c:v libx264 -b:v 3000k -pass 2 -c:a aac output.mp4
```

### 10.3 预处理优化

对于已经是 H.264 编码且分辨率合适的视频，可以跳过视频流的重新编码，只处理音频或元数据，速度会快几十倍：

```bash
# 直接复制视频流，只重新编码音频
ffmpeg -i input.mp4 -c:v copy -c:a aac -b:a 128k -movflags +faststart output.mp4
```

## 十一、安全注意事项

音视频处理涉及文件上传和命令执行，安全风险不容忽视。以下是几个关键的安全要点。

第一，文件类型验证不能仅依赖客户端传来的 MIME Type 或文件扩展名。应该使用 `finfo` 或 ffprobe 实际探测文件内容的真实类型，防止恶意用户通过修改扩展名上传可执行文件。

第二，所有传给 FFmpeg 的文件路径必须用 `escapeshellarg()` 转义，防止命令注入攻击。如果文件名中包含分号、反引号等特殊字符而未转义，可能导致任意命令执行。

第三，设置合理的上传大小限制和处理时间限制。允许用户上传 10GB 的视频文件不仅浪费存储和计算资源，还可能被恶意利用进行 DoS 攻击。

第四，缩略图截图功能需要谨慎使用。某些视频内容可能包含敏感或不当画面，自动生成的截图可能带来合规风险。必要时可以结合 AI 内容审核服务对截图进行过滤。

## 结语

通过 Laravel + FFmpeg + Queue + Horizon 的组合，我们构建了一套完整的生产级音视频处理管道。整套方案的核心设计理念可以总结为：异步解耦（上传与处理分离）、管道化（处理步骤可插拔）、可观测（进度实时反馈）、容错（重试、超时、清理）、安全（类型校验、命令注入防护、资源限制）。

这套架构已在多个实际项目中经受住了日均数千个视频文件处理的考验。当然，音视频处理是一个深不见底的领域，本文覆盖的只是最核心、最常见的场景。更高级的话题——比如 HLS 加密（AES-128）、DRM 版权保护、AI 智能剪辑、实时转码推流等——有机会将在后续文章中探讨。

希望本文能为正在 Laravel 项目中集成音视频处理功能的你提供一份详实的参考。如果在实践中遇到问题，欢迎留言交流。

---

> **参考资源**
> - [FFmpeg 官方文档](https://ffmpeg.org/documentation.html) — 最权威的 FFmpeg 参考
> - [protonemedia/laravel-ffmpeg](https://github.com/pascalbaljetmedia/laravel-ffmpeg) — Laravel FFmpeg 集成包
> - [Laravel Horizon 官方文档](https://laravel.com/docs/horizon) — 队列监控面板
> - [Laravel Broadcasting 文档](https://laravel.com/docs/broadcasting) — 事件广播机制
> - [HLS Authoring Specification for Apple Devices](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) — HLS 规范

## 相关阅读

- [Laravel Horizon 实战：队列监控与自动扩缩容策略](/categories/PHP/Laravel/Laravel-Horizon-实战-队列监控与自动扩缩容策略/)
- [Laravel 事件广播实战：WebSocket 实时通知与进度推送](/categories/PHP/Laravel/Laravel-事件广播实战-WebSocket-实时通知与进度推送/)
- [Docker Compose 实战：多服务编排与 Laravel 开发环境搭建](/categories/运维/Docker-Compose-实战-多服务编排与Laravel开发环境搭建/)
