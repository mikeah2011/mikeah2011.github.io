---
title: 'FFmpeg + Laravel 实战：音视频转码、截图、水印——上传处理管道与队列化异步任务'
date: 2026-06-06 10:00:00
tags: [FFmpeg, Laravel, 音视频, 队列, PHP]
categories: [PHP, Laravel]
description: 从零到一构建基于 FFmpeg + Laravel 的音视频处理管道，覆盖上传校验、多格式转码、自适应码率 HLS 切片、关键帧截图、水印叠加与队列化异步任务，深入讲解 Laravel Queue Worker 调优、失败重试、死信队列治理，附完整可运行代码与生产环境踩坑经验。
cover: /images/covers/ffmpeg-laravel-cover.jpg
---

在当今内容为王的时代，音视频处理已成为许多 Web 应用的核心需求。无论是短视频平台、在线教育系统、企业培训门户，还是内容创作社区，都需要一个稳定、高效、可扩展的音视频上传处理管道。本文将从零到一，深入讲解如何利用 FFmpeg 强大的命令行能力，结合 Laravel 优雅的框架生态，构建一套完整的音视频处理解决方案——涵盖上传校验、多格式转码、自适应码率切片、关键帧截图、水印叠加，以及基于队列的异步任务处理体系。

<!-- more -->

## 一、FFmpeg 基础：编解码器、容器与转码管道

在动手写代码之前，我们必须对 FFmpeg 的核心概念有清晰的认知。FFmpeg 是一套开源的音视频处理工具集，它能实现几乎所有你能想到的多媒体操作。理解其底层概念，能帮助我们在实际项目中做出更合理的技术决策。

### 1.1 编解码器（Codec）与容器（Container）

编解码器是负责对音视频数据进行编码和解码的算法。视频常用的编解码器包括：

- **H.264（AVC）**：目前兼容性最广泛的视频编码标准，几乎所有的浏览器和移动设备都原生支持。它的压缩率适中，编码速度相对较快，是 Web 视频分发的事实标准。
- **H.265（HEVC）**：H.264 的继任者，在相同画质下可以节省约 40%-50% 的带宽。但由于专利授权问题，浏览器端支持仍然有限，在 Safari 上表现良好，Chrome 支持则需要硬件解码。
- **VP9 / AV1**：Google 主导的开源编码标准，AV1 压缩率甚至优于 HEVC，但编码速度较慢，适合对带宽敏感且允许较长编码时间的场景。

音频编解码器则以 **AAC** 为主流，兼具良好的兼容性和压缩率。MP3 虽然老牌但仍有大量存量设备支持。Opus 则在低码率语音场景下表现卓越。

容器格式是将编码后的音视频流、字幕、元数据等封装在一起的"包裹"。常见容器包括：

- **MP4（MPEG-4 Part 14）**：最通用的视频容器，配合 H.264 + AAC 几乎可以通吃所有平台。
- **MKV（Matroska）**：功能强大，支持几乎无限的音轨和字幕轨，常用于高清影视存储。
- **HLS（.m3u8 + .ts）**：Apple 推出的流媒体协议，将视频切分为小的 TS 分片，配合多码率版本实现自适应码率播放，是当前在线视频分发的主流方案。
- **DASH**：类似 HLS 的国际标准流媒体协议，浏览器兼容性更广。

理解这些概念后，我们就知道：用户上传的原始视频可能是任意容器 + 编码组合，而我们的系统需要将其转码为标准化的输出格式（通常是 H.264 + AAC in MP4 或 HLS），以确保最大兼容性。

### 1.2 FFmpeg 转码管道概览

一个典型的 FFmpeg 转码流程可以抽象为三个阶段：

1. **解封装（Demux）**：从输入容器中分离出原始编码流。
2. **解码与再编码（Decode & Re-encode）**：将原始流解码为中间格式（YUV 像素数据 / PCM 音频数据），再按目标编码参数重新编码。
3. **封装（Mux）**：将新编码的流写入目标容器格式。

在命令行中，一条简单的转码命令如下：

```bash
ffmpeg -i input.avi -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k output.mp4
```

其中 `-c:v libx264` 指定视频编码器，`-preset medium` 平衡编码速度与压缩率，`-crf 23` 控制画质（值越小画质越高），`-c:a aac` 指定音频编码器。理解这些参数是后续在 Laravel 中封装转码任务的基础。

## 二、Laravel 集成：php-ffmpeg/php-ffmpeg 包

PHP 生态中最成熟的 FFmpeg 封装库是 `php-ffmpeg/php-ffmpeg`，它提供了面向对象的 API 来操作 FFmpeg，避免了手动拼接命令行字符串带来的安全隐患和维护困难。

### 2.1 安装与配置

```bash
composer require php-ffmpeg/php-ffmpeg
```

首先需要确保服务器上安装了 FFmpeg 本体。在 Ubuntu 上：

```bash
sudo apt update && sudo apt install ffmpeg
```

然后在 Laravel 中创建配置文件 `config/media.php`：

```php
<?php

return [
    'ffmpeg_bin'  => env('FFMPEG_BINARY', '/usr/bin/ffmpeg'),
    'ffprobe_bin' => env('FFPROBE_BINARY', '/usr/bin/ffprobe'),
    'timeout'     => 3600,  // 转码超时时间，秒
    'threads'     => 0,     // 0 表示自动检测 CPU 核心数
    'temp_path'   => storage_path('app/temp'),
    'output_path' => storage_path('app/processed'),
];
```

创建一个服务提供者来注册 FFmpeg 实例：

```php
<?php
// app/Providers/MediaServiceProvider.php

namespace App\Providers;

use FFMpeg\FFMpeg;
use Illuminate\Support\ServiceProvider;

class MediaServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton('ffmpeg', function () {
            return FMpeg::create([
                'ffmpeg.binaries'  => config('media.ffmpeg_bin'),
                'ffprobe.binaries' => config('media.ffprobe_bin'),
                'timeout'          => config('media.timeout'),
                'ffmpeg.threads'   => config('media.threads'),
            ]);
        });
    }
}
```

### 2.2 探测媒体信息

在转码之前，我们需要先获取上传文件的元数据，用于验证和决策转码参数：

```php
<?php

use FFMpeg\FFProbe;

$ffprobe = FFProbe::create([
    'ffprobe.binaries' => config('media.ffprobe_bin'),
]);

$mediaInfo = $ffprobe->streams('/path/to/uploaded/video.mp4');

$videoStream = $mediaInfo->videos()->first();
$audioStream = $mediaInfo->audios()->first();

$width      = $videoStream->get('width');
$height     = $videoStream->get('height');
$duration   = $mediaInfo->get('duration');  // 秒
$bitrate    = $videoStream->get('bit_rate');
$codec      = $videoStream->get('codec_name');
$fps        = $videoStream->get('r_frame_rate');
```

这些信息将用于判断是否需要转码、选择合适的输出参数、以及在数据库中记录原始媒体属性。

## 三、上传处理：分块上传、校验与临时存储

### 3.1 大文件分块上传

对于动辄数 GB 的视频文件，简单的单次上传往往不可靠。我们需要实现分块上传（Chunked Upload），前端将文件切分为固定大小的分片（如 5MB）逐个上传，后端拼接合并。

创建上传控制器：

```php
<?php
// app/Http/Controllers/ChunkUploadController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ChunkUploadController extends Controller
{
    public function uploadChunk(Request $request)
    {
        $request->validate([
            'chunk'      => 'required|file|max:5120', // 5MB
            'chunk_index' => 'required|integer|min:0',
            'total_chunks' => 'required|integer|min:1',
            'upload_id'   => 'required|string',
            'file_name'   => 'required|string',
        ]);

        $uploadId    = $request->input('upload_id');
        $chunkIndex  = $request->input('chunk_index');
        $totalChunks = $request->input('total_chunks');
        $fileName    = $request->input('file_name');

        // 存储分片到临时目录
        $tempDir = "temp/uploads/{$uploadId}";
        $chunkPath = "{$tempDir}/chunk_{$chunkIndex}";
        
        Storage::put($chunkPath, file_get_contents(
            $request->file('chunk')->getRealPath()
        ));

        // 检查是否所有分片都已上传完成
        $uploadedChunks = count(Storage::files($tempDir));

        if ($uploadedChunks === $totalChunks) {
            return $this->mergeChunks($uploadId, $fileName, $totalChunks);
        }

        return response()->json([
            'status'       => 'uploading',
            'uploaded'     => $uploadedChunks,
            'total'        => $totalChunks,
            'progress'     => round(($uploadedChunks / $totalChunks) * 100, 1),
        ]);
    }

    protected function mergeChunks(string $uploadId, string $fileName, int $totalChunks): array
    {
        $tempDir   = "temp/uploads/{$uploadId}";
        $extension = pathinfo($fileName, PATHINFO_EXTENSION);
        $safeName  = Str::uuid() . ".{$extension}";
        $finalPath = "temp/merged/{$safeName}";

        $finalStream = fopen(Storage::path($finalPath), 'wb');

        for ($i = 0; $i < $totalChunks; $i++) {
            $chunkPath = "{$tempDir}/chunk_{$i}";
            $chunkData = Storage::get($chunkPath);
            fwrite($finalStream, $chunkData);
        }

        fclose($finalStream);

        // 清理分片
        Storage::deleteDirectory($tempDir);

        return [
            'status'  => 'completed',
            'file'    => $finalPath,
            'name'    => $safeName,
        ];
    }
}
```

### 3.2 文件校验

合并完成后，必须对文件进行多维度校验：

```php
<?php

class MediaValidator
{
    // 允许的 MIME 类型白名单
    private const ALLOWED_VIDEO_TYPES = [
        'video/mp4', 'video/quicktime', 'video/x-msvideo',
        'video/x-matroska', 'video/webm', 'video/x-flv',
    ];

    private const ALLOWED_AUDIO_TYPES = [
        'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/flac',
        'audio/ogg', 'audio/x-m4a',
    ];

    // 最大文件大小：10GB
    private const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

    public function validate(string $filePath): array
    {
        $mime = mime_content_type(Storage::path($filePath));
        $size = Storage::size($filePath);

        // 第一层：MIME 类型检查
        if (!in_array($mime, [...self::ALLOWED_VIDEO_TYPES, ...self::ALLOWED_AUDIO_TYPES])) {
            throw new \InvalidArgumentException("不支持的文件类型: {$mime}");
        }

        // 第二层：文件大小检查
        if ($size > self::MAX_FILE_SIZE) {
            throw new \InvalidArgumentException("文件大小超过限制");
        }

        // 第三层：使用 ffprobe 验证文件是否为有效媒体
        $ffprobe = FFProbe::create([
            'ffprobe.binaries' => config('media.ffprobe_bin'),
        ]);

        try {
            $streams = $ffprobe->streams(Storage::path($filePath));
        } catch (\Exception $e) {
            throw new \InvalidArgumentException("无效的媒体文件: " . $e->getMessage());
        }

        // 第四层：魔数（Magic Bytes）校验，防止伪造扩展名
        $handle = fopen(Storage::path($filePath), 'rb');
        $header = fread($handle, 12);
        fclose($handle);

        if (str_starts_with($mime, 'video/mp4') && !str_contains(bin2hex(substr($header, 4, 4)), '66747970')) {
            throw new \InvalidArgumentException("MP4 文件头校验失败");
        }

        return [
            'mime'     => $mime,
            'size'     => $size,
            'duration' => $ffprobe->format(Storage::path($filePath))->get('duration'),
        ];
    }
}
```

校验通过后，我们就可以将媒体文件信息入库，并派发异步转码任务了。

## 四、视频转码：H.264/H.265 与自适应码率

### 4.1 基础转码：标准化输出

最常见的需求是将用户上传的各种格式视频统一转码为 H.264 + AAC 的 MP4 格式：

```php
<?php
// app/Jobs/TranscodeVideoJob.php

namespace App\Jobs;

use FFMpeg\Format\Video\X264;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;

class TranscodeVideoJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 3600; // 1小时超时

    public function __construct(
        public string $mediaId,
        public string $inputPath,
        public string $outputFormat = 'mp4',
    ) {}

    public function handle(): void
    {
        $ffmpeg = app('ffmpeg');
        $media  = $ffmpeg->open(Storage::path($this->inputPath));

        $format = new X264('aac', 'libx264');
        $format->setKiloBitrate(2500)
               ->setAudioChannels(2)
               ->setAudioKiloBitrate(128);

        // 设置编码预设：medium 平衡速度与质量
        $format->setAdditionalParameters([
            '-preset', 'medium',
            '-movflags', '+faststart', // 启用快速播放，moov atom 前置
            '-pix_fmt', 'yuv420p',     // 确保最大兼容性
        ]);

        $outputFileName = "processed/{$this->mediaId}/video_720p.mp4";
        $outputPath     = Storage::path($outputFileName);

        // 确保输出目录存在
        Storage::makeDirectory(dirname($outputFileName));

        $media->save($format, $outputPath);

        // 更新数据库记录
        $this->updateMediaRecord($outputFileName);
    }

    protected function updateMediaRecord(string $outputPath): void
    {
        // 更新 Media 模型状态为已完成
        \App\Models\Media::where('id', $this->mediaId)->update([
            'status'      => 'completed',
            'output_path' => $outputPath,
        ]);
    }
}
```

### 4.2 多分辨率自适应转码（HLS）

为了支持不同网络条件下的自适应播放，我们需要将视频转码为多个分辨率版本，并切片为 HLS 格式：

```php
<?php

namespace App\Jobs;

class TranscodeHlsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 7200;

    // 定义多档位码率配置
    private array $profiles = [
        ['name' => '1080p', 'width' => 1920, 'height' => 1080, 'bitrate' => 5000, 'audio_bitrate' => 192],
        ['name' => '720p',  'width' => 1280, 'height' => 720,  'bitrate' => 2500, 'audio_bitrate' => 128],
        ['name' => '480p',  'width' => 854,  'height' => 480,  'bitrate' => 1000, 'audio_bitrate' => 96],
        ['name' => '360p',  'width' => 640,  'height' => 360,  'bitrate' => 600,  'audio_bitrate' => 64],
    ];

    public function __construct(
        public string $mediaId,
        public string $inputPath,
    ) {}

    public function handle(): void
    {
        $inputRealPath = Storage::path($this->inputPath);
        $ffmpeg        = app('ffmpeg');
        $ffprobe       = \FFMpeg\FFProbe::create([
            'ffprobe.binaries' => config('media.ffprobe_bin'),
        ]);

        // 获取源视频分辨率，决定需要转码到哪些档位
        $videoStream = $ffprobe->streams($inputRealPath)->videos()->first();
        $sourceWidth = $videoStream->get('width');
        $sourceHeight = $videoStream->get('height');

        $outputDir  = "processed/{$this->mediaId}/hls";
        Storage::makeDirectory($outputDir);
        $realOutputDir = Storage::path($outputDir);

        $masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

        foreach ($this->profiles as $profile) {
            // 跳过源分辨率以下的降级
            if ($profile['height'] > $sourceHeight) {
                continue;
            }

            $profileDir = "{$realOutputDir}/{$profile['name']}";
            mkdir($profileDir, 0755, true);

            $this->transcodeHlsProfile(
                $inputRealPath,
                $profileDir,
                $profile
            );

            // 生成主播放列表
            $bandwidth = $profile['bitrate'] * 1000;
            $masterPlaylist .= "#EXT-X-STREAM-INF:BANDWIDTH={$bandwidth},RESOLUTION={$profile['width']}x{$profile['height']}\n";
            $masterPlaylist .= "{$profile['name']}/playlist.m3u8\n";
        }

        // 写入主播放列表
        file_put_contents("{$realOutputDir}/master.m3u8", $masterPlaylist);

        // 更新数据库
        \App\Models\Media::where('id', $this->mediaId)->update([
            'hls_path' => "{$outputDir}/master.m3u8",
            'status'   => 'completed',
        ]);
    }

    protected function transcodeHlsProfile(string $input, string $outputDir, array $profile): void
    {
        $cmd = sprintf(
            'ffmpeg -i %s -c:v libx264 -preset medium -crf 23 ' .
            '-vf "scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2" ' .
            '-c:a aac -b:a %dk -ac 2 ' .
            '-hls_time 6 -hls_list_size 0 -hls_segment_filename "%s/segment_%%03d.ts" ' .
            '-f hls "%s/playlist.m3u8" ' .
            '-movflags +faststart -pix_fmt yuv420p 2>&1',
            escapeshellarg($input),
            $profile['width'], $profile['height'],
            $profile['width'], $profile['height'],
            $profile['audio_bitrate'],
            $outputDir,
            $outputDir
        );

        exec($cmd, $output, $returnCode);

        if ($returnCode !== 0) {
            throw new \RuntimeException(
                "HLS 转码失败 [{$profile['name']}]: " . implode("\n", array_slice($output, -20))
            );
        }
    }
}
```

这个实现的关键设计决策是：根据源视频分辨率自动跳过不必要的档位。例如源视频是 720p，就不会生成 1080p 的版本（放大没有意义），只输出 720p、480p 和 360p 三个档位。

## 五、音频提取与格式转换

很多时候我们需要从视频中提取音轨，或者将音频转换为不同格式：

```php
<?php

namespace App\Jobs;

class ExtractAudioJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 1800;

    public function __construct(
        public string $mediaId,
        public string $inputPath,
        public string $format = 'mp3', // mp3, aac, wav, flac
        public int $bitrate = 128,
    ) {}

    public function handle(): void
    {
        $ffmpeg = app('ffmpeg');
        $media  = $ffmpeg->open(Storage::path($this->inputPath));

        $outputFileName = "processed/{$this->mediaId}/audio.{$this->format}";
        $outputPath     = Storage::path($outputFileName);
        Storage::makeDirectory(dirname($outputFileName));

        switch ($this->format) {
            case 'mp3':
                $format = new \FFMpeg\Format\Audio\Mp3();
                $format->setAudioKiloBitrate($this->bitrate);
                break;
            case 'aac':
                $format = new \FFMpeg\Format\Audio\Aac();
                $format->setAudioKiloBitrate($this->bitrate);
                break;
            case 'flac':
                $format = new \FFMpeg\Format\Audio\Flac();
                break;
            default:
                $format = new \FFMpeg\Format\Audio\Mp3();
                $format->setAudioKiloBitrate($this->bitrate);
        }

        $media->save($format, $outputPath);

        // 读取输出文件的元数据
        $ffprobe  = \FFMpeg\FFProbe::create([
            'ffprobe.binaries' => config('media.ffprobe_bin'),
        ]);
        $duration = $ffprobe->format($outputPath)->get('duration');
        $size     = filesize($outputPath);

        \App\Models\Media::where('id', $this->mediaId)->update([
            'audio_path'       => $outputFileName,
            'audio_duration'   => $duration,
            'audio_size'       => $size,
        ]);
    }
}
```

## 六、关键帧截图与缩略图生成

视频封面图是用户体验的重要组成部分。我们可以从视频的特定时间点抓取帧，也可以自动检测场景变化点生成最佳缩略图。

### 6.1 指定时间点截图

```php
<?php

namespace App\Jobs;

class GenerateThumbnailJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(
        public string $mediaId,
        public string $inputPath,
        public array  $timePoints = [1, 5, 10], // 截图时间点（秒）
    ) {}

    public function handle(): void
    {
        $ffmpeg     = app('ffmpeg');
        $media      = $ffmpeg->open(Storage::path($this->inputPath));
        $outputDir  = "processed/{$this->mediaId}/thumbnails";
        Storage::makeDirectory($outputDir);
        $realOutputDir = Storage::path($outputDir);

        $thumbnailPaths = [];

        foreach ($this->timePoints as $index => $timePoint) {
            $framePath = "{$realOutputDir}/thumb_{$index}.jpg";
            
            $media->frame(\FFMpeg\Coordinate\TimeCode::fromSeconds($timePoint))
                  ->save($framePath);

            $thumbnailPaths[] = "{$outputDir}/thumb_{$index}.jpg";
        }

        // 选择第一张作为主封面
        \App\Models\Media::where('id', $this->mediaId)->update([
            'thumbnail_path' => $thumbnailPaths[0] ?? null,
            'thumbnails'     => json_encode($thumbnailPaths),
        ]);
    }
}
```

### 6.2 智能关键帧截图

简单的时间点截图可能截到模糊的过渡帧。更好的做法是使用 FFmpeg 的场景检测功能：

```bash
# 检测场景变化，选出变化最剧烈的帧
ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr -frames:v 5 thumb_%02d.jpg
```

在 PHP 中，我们可以封装为更精细的控制：

```php
<?php

class SmartThumbnailGenerator
{
    public function generateBestThumbnails(string $inputPath, string $outputDir, int $count = 3): array
    {
        // 使用场景检测提取候选帧
        $cmd = sprintf(
            'ffmpeg -i %s -vf "select=\'gt(scene,0.4)\',scale=640:-1" ' .
            '-vsync vfr -frames:v %d -q:v 2 %s/candidate_%%02d.jpg 2>&1',
            escapeshellarg($inputPath),
            $count * 3,  // 多提取一些候选，后续用图像质量评估筛选
            escapeshellarg($outputDir)
        );

        exec($cmd, $output, $returnCode);

        if ($returnCode !== 0) {
            // 降级到普通时间点截图
            return $this->fallbackThumbnails($inputPath, $outputDir, $count);
        }

        $candidates = glob("{$outputDir}/candidate_*.jpg");

        // 按文件大小排序（大的通常画面内容更丰富）
        usort($candidates, fn($a, $b) => filesize($b) <=> filesize($a));

        // 取前 N 个最佳候选
        $bestFrames = array_slice($candidates, 0, $count);

        // 重命名为最终文件
        $result = [];
        foreach ($bestFrames as $i => $frame) {
            $newPath = "{$outputDir}/thumb_{$i}.jpg";
            rename($frame, $newPath);
            $result[] = basename($newPath);
        }

        // 清理未选中的候选帧
        foreach (glob("{$outputDir}/candidate_*.jpg") as $leftover) {
            @unlink($leftover);
        }

        return $result;
    }

    protected function fallbackThumbnails(string $inputPath, string $outputDir, int $count): array
    {
        $ffprobe = \FFMpeg\FFProbe::create([
            'ffprobe.binaries' => config('media.ffprobe_bin'),
        ]);
        $duration = $ffprobe->format($inputPath)->get('duration');
        $interval = max(1, $duration / ($count + 1));

        $result = [];
        for ($i = 0; $i < $count; $i++) {
            $time = round($interval * ($i + 1));
            $cmd  = sprintf(
                'ffmpeg -ss %d -i %s -frames:v 1 -q:v 2 %s/thumb_%d.jpg 2>&1',
                $time,
                escapeshellarg($inputPath),
                escapeshellarg($outputDir),
                $i
            );
            exec($cmd);
            $result[] = "thumb_{$i}.jpg";
        }

        return $result;
    }
}
```

## 七、水印叠加：图片水印与文字水印

### 7.1 图片水印

为视频添加公司 Logo 是保护知识产权的常见做法：

```php
<?php

namespace App\Jobs;

class AddWatermarkJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 3600;

    // 水印位置预设
    private const POSITIONS = [
        'top-left'     => '10:10',
        'top-right'    => 'main_w-overlay_w-10:10',
        'bottom-left'  => '10:main_h-overlay_h-10',
        'bottom-right' => 'main_w-overlay_w-10:main_h-overlay_h-10',
        'center'       => '(main_w-overlay_w)/2:(main_h-overlay_h)/2',
    ];

    public function __construct(
        public string $mediaId,
        public string $inputPath,
        public string $watermarkPath,  // 水印图片路径
        public string $position = 'bottom-right',
        public float  $opacity = 0.7,
        public int    $scale = 0,       // 0 表示原始大小
    ) {}

    public function handle(): void
    {
        $inputRealPath   = Storage::path($this->inputPath);
        $watermarkReal   = Storage::path($this->watermarkPath);
        $outputFileName  = "processed/{$this->mediaId}/watermarked.mp4";
        $outputPath      = Storage::path($outputFileName);
        Storage::makeDirectory(dirname($outputFileName));

        $positionStr = self::POSITIONS[$this->position] ?? self::POSITIONS['bottom-right'];

        // 构建滤镜链
        $filterParts = [];

        // 如果需要缩放水印
        if ($this->scale > 0) {
            $filterParts[] = "[1:v]scale={$this->scale}:-1,format=rgba[wm]";
        } else {
            $filterParts[] = "[1:v]format=rgba[wm]";
        }

        // 设置水印透明度
        if ($this->opacity < 1.0) {
            $filterParts[] = "[wm]colorchannelmixer=aa={$this->opacity}[wma]";
            $wmLabel = '[wma]';
        } else {
            $wmLabel = '[wm]';
        }

        // 叠加水印
        $filterParts[] = "[0:v]{$wmLabel}overlay={$positionStr}:format=auto[outv]";

        $filterComplex = implode(';', $filterParts);

        $cmd = sprintf(
            'ffmpeg -i %s -i %s -filter_complex %s ' .
            '-map "[outv]" -map 0:a? -c:v libx264 -preset medium -crf 23 ' .
            '-c:a copy -movflags +faststart %s 2>&1',
            escapeshellarg($inputRealPath),
            escapeshellarg($watermarkReal),
            escapeshellarg($filterComplex),
            escapeshellarg($outputPath)
        );

        exec($cmd, $output, $returnCode);

        if ($returnCode !== 0) {
            throw new \RuntimeException(
                "水印处理失败: " . implode("\n", array_slice($output, -15))
            );
        }

        \App\Models\Media::where('id', $this->mediaId)->update([
            'watermarked_path' => $outputFileName,
        ]);
    }
}
```

### 7.2 文字水印

如果需要添加文字水印（如版权信息、用户名等），可以使用 FFmpeg 的 `drawtext` 滤镜：

```bash
ffmpeg -i input.mp4 -vf "drawtext=text='© 2026 MyCompany':fontsize=24:fontcolor=white@0.7:x=W-tw-20:y=H-th-20:fontfile=/path/to/font.ttf" -c:a copy output.mp4
```

在 PHP 中封装为更灵活的方式：

```php
<?php

class TextWatermarkProcessor
{
    public function apply(
        string $inputPath,
        string $outputPath,
        string $text,
        array  $options = []
    ): void {
        $defaults = [
            'font_size'  => 24,
            'font_color' => 'white',
            'opacity'    => 0.7,
            'position'   => 'bottom-right',
            'margin'     => 20,
            'font_file'  => '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        ];

        $config = array_merge($defaults, $options);

        $positions = [
            'bottom-right' => "x=W-tw-{$config['margin']}:y=H-th-{$config['margin']}",
            'bottom-left'  => "x={$config['margin']}:y=H-th-{$config['margin']}",
            'top-right'    => "x=W-tw-{$config['margin']}:y={$config['margin']}",
            'top-left'     => "x={$config['margin']}:y={$config['margin']}",
        ];

        $posExpr = $positions[$config['position']] ?? $positions['bottom-right'];

        // 处理文本中的特殊字符
        $escapedText = addcslashes($text, "'\\:");

        $drawtextFilter = sprintf(
            "drawtext=text='%s':fontsize=%d:fontcolor=%s@%s:fontfile='%s':%s",
            $escapedText,
            $config['font_size'],
            $config['font_color'],
            $config['opacity'],
            $config['font_file'],
            $posExpr
        );

        $cmd = sprintf(
            'ffmpeg -y -i %s -vf %s -c:v libx264 -preset medium -crf 23 ' .
            '-c:a copy -movflags +faststart %s 2>&1',
            escapeshellarg($inputPath),
            escapeshellarg($drawtextFilter),
            escapeshellarg($outputPath)
        );

        exec($cmd, $output, $returnCode);

        if ($returnCode !== 0) {
            throw new \RuntimeException("文字水印处理失败: " . implode("\n", array_slice($output, -10)));
        }
    }
}
```

## 八、Laravel 队列化异步任务：调度、重试与失败处理

### 8.1 任务编排：处理管道

一个完整的媒体处理流程通常包括：验证 → 截图 → 转码 → 水印 → 通知。我们需要一个"管道任务"来编排这些子任务的执行顺序：

```php
<?php

namespace App\Jobs;

class ProcessMediaPipelineJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 1;
    public int $timeout = 10800; // 3小时

    public function __construct(
        public string $mediaId,
    ) {}

    public function handle(): void
    {
        $media = \App\Models\Media::findOrFail($this->mediaId);
        $media->update(['status' => 'processing']);

        // 步骤1：生成缩略图（快速，可同步）
        GenerateThumbnailJob::dispatchSync($this->mediaId, $media->input_path);

        // 步骤2：并行派发转码和音频提取
        TranscodeVideoJob::dispatch($this->mediaId, $media->input_path)
            ->onQueue('transcoding');

        ExtractAudioJob::dispatch($this->mediaId, $media->input_path)
            ->onQueue('transcoding');

        // 步骤3：如果需要 HLS，派发 HLS 转码任务
        if ($media->needs_hls) {
            TranscodeHlsJob::dispatch($this->mediaId, $media->input_path)
                ->onQueue('transcoding');
        }

        // 步骤4：如果配置了水印，在转码完成后派发水印任务
        if ($media->watermark_path) {
            AddWatermarkJob::dispatch(
                $this->mediaId,
                $media->input_path,
                $media->watermark_path,
                'bottom-right',
                0.7
            )->onQueue('transcoding')
             ->delay(now()->addSeconds(5)); // 稍等确保转码任务先启动
        }

        // 广播处理开始事件
        event(new \App\Events\MediaProcessingStarted($this->mediaId));
    }

    public function failed(\Throwable $exception): void
    {
        \App\Models\Media::where('id', $this->mediaId)->update([
            'status' => 'failed',
            'error'  => $exception->getMessage(),
        ]);

        event(new \App\Events\MediaProcessingFailed($this->mediaId, $exception->getMessage()));

        \Log::error("媒体处理管道失败", [
            'media_id'  => $this->mediaId,
            'exception' => $exception->getMessage(),
            'trace'     => $exception->getTraceAsString(),
        ]);
    }
}
```

### 8.2 队列配置与 Worker 管理

在 `config/queue.php` 中配置多个队列以实现优先级管理：

```php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue'  => env('REDIS_QUEUE', 'default'),
    'retry_after' => 9000,   // 2.5 小时，要大于最长任务的超时时间
    'block_for'   => null,
],
```

使用 Supervisor 管理队列 Worker，为不同队列分配不同资源：

```ini
; /etc/supervisor/conf.d/laravel-worker.conf
[program:laravel-worker-upload]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/app/artisan queue:work redis --queue=uploads --tries=3 --timeout=300 --memory=512
autostart=true
autorestart=true
numprocs=2
redirect_stderr=true
stdout_logfile=/var/www/app/storage/logs/worker-upload.log

[program:laravel-worker-transcode]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/app/artisan queue:work redis --queue=transcoding --tries=3 --timeout=7200 --memory=2048
autostart=true
autorestart=true
numprocs=4
redirect_stderr=true
stdout_logfile=/var/www/app/storage/logs/worker-transcode.log
```

### 8.3 重试策略与死信队列

为转码任务配置智能重试策略：

```php
<?php

class TranscodeVideoJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 3600;

    /**
     * 计算重试延迟（指数退避）
     */
    public function retryAfter(): int
    {
        return match ($this->attempts()) {
            1       => 60,    // 第一次重试等 1 分钟
            2       => 300,   // 第二次重试等 5 分钟
            default => 900,   // 第三次重试等 15 分钟
        };
    }

    /**
     * 判断是否应该重试
     */
    public function retryUntil(): \DateTime
    {
        return now()->addHours(2);
    }

    /**
     * 最终失败时的处理
     */
    public function failed(\Throwable $exception): void
    {
        // 清理残留的临时文件
        $this->cleanupTempFiles();

        // 更新数据库状态
        \App\Models\Media::where('id', $this->mediaId)->update([
            'status'       => 'failed',
            'error'        => $exception->getMessage(),
            'failed_at'    => now(),
            'attempts'     => $this->attempts(),
        ]);

        // 发送失败通知给用户
        $media = \App\Models\Media::find($this->mediaId);
        if ($media && $media->user) {
            $media->user->notify(new \App\Notifications\MediaTranscodeFailedNotification($media));
        }
    }

    protected function cleanupTempFiles(): void
    {
        $tempDir = Storage::path("temp/{$this->mediaId}");
        if (is_dir($tempDir)) {
            $files = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($tempDir, \RecursiveDirectoryIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($files as $file) {
                $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
            }
            rmdir($tempDir);
        }
    }
}
```

## 九、存储集成：本地磁盘、S3/MinIO 与 CDN 分发

### 9.1 多存储驱动配置

在 `config/filesystems.php` 中配置多层存储策略：

```php
'disks' => [
    'local_temp' => [
        'driver' => 'local',
        'root'   => storage_path('app/temp'),
    ],
    'local_processed' => [
        'driver' => 'local',
        'root'   => storage_path('app/processed'),
    ],
    's3' => [
        'driver' => 's3',
        'key'    => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION'),
        'bucket' => env('AWS_BUCKET'),
        'url'    => env('AWS_URL'),
        'endpoint' => env('AWS_ENDPOINT'), // MinIO 兼容端点
        'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE', false),
    ],
],
```

### 9.2 处理完成后上传到 S3

```php
<?php

class UploadToS3Job implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 600;

    public function __construct(
        public string $mediaId,
    ) {}

    public function handle(): void
    {
        $media = \App\Models\Media::findOrFail($this->mediaId);

        $filesToUpload = array_filter([
            $media->output_path,
            $media->hls_path ? dirname($media->hls_path) : null,
            $media->thumbnail_path,
            $media->audio_path,
            $media->watermarked_path,
        ]);

        $s3Paths = [];

        foreach ($filesToUpload as $localPath) {
            if (is_dir(Storage::path($localPath))) {
                // HLS 目录：递归上传所有 .ts 和 .m3u8 文件
                $this->uploadDirectory($localPath, $s3Paths);
            } else {
                $s3Key = "media/{$this->mediaId}/" . basename($localPath);
                $stream = fopen(Storage::path($localPath), 'r');
                Storage::disk('s3')->writeStream($s3Key, $stream);
                fclose($stream);
                $s3Paths[$localPath] = $s3Key;
            }
        }

        // 更新数据库记录为 S3 路径
        $media->update([
            's3_paths'  => json_encode($s3Paths),
            'status'    => 'published',
            'cdn_url'   => config('services.cdn.url') . "/media/{$this->mediaId}",
        ]);

        // 清理本地临时文件
        $this->cleanupLocalFiles($filesToUpload);

        event(new \App\Events\MediaPublished($this->mediaId));
    }

    protected function uploadDirectory(string $dirPath, array &$s3Paths): void
    {
        $realDir = Storage::path($dirPath);
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($realDir, \RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if ($file->isFile()) {
                $relativePath = str_replace(Storage::path(''), '', $file->getPathname());
                $s3Key = "media/{$this->mediaId}/{$relativePath}";
                $stream = fopen($file->getPathname(), 'r');
                Storage::disk('s3')->writeStream($s3Key, $stream, [
                    'ContentType' => $this->guessMimeType($file->getExtension()),
                ]);
                fclose($stream);
                $s3Paths[$relativePath] = $s3Key;
            }
        }
    }

    protected function guessMimeType(string $extension): string
    {
        return match ($extension) {
            'm3u8' => 'application/vnd.apple.mpegurl',
            'ts'   => 'video/mp2t',
            'mp4'  => 'video/mp4',
            'mp3'  => 'audio/mpeg',
            'jpg', 'jpeg' => 'image/jpeg',
            default => 'application/octet-stream',
        };
    }
}
```

注意 HLS 文件上传时需要正确设置 Content-Type，否则 CDN 或浏览器可能无法正确识别 `.m3u8` 播放列表。

## 十、进度追踪与 WebSocket 实时通知

用户上传视频后，转码可能耗时数分钟甚至数十分钟，实时反馈处理进度至关重要。

### 10.1 使用 Laravel Broadcasting 推送进度

```php
<?php
// app/Events/MediaProgressUpdated.php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class MediaProgressUpdated implements ShouldBroadcast
{
    use InteractsWithSockets;

    public function __construct(
        public string $mediaId,
        public string $stage,      // 'thumbnail', 'transcoding', 'watermark', 'uploading_s3'
        public int    $progress,   // 0-100
        public string $message,
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("media.{$this->mediaId}")];
    }

    public function broadcastAs(): string
    {
        return 'media.progress';
    }

    public function broadcastWith(): array
    {
        return [
            'stage'    => $this->stage,
            'progress' => $this->progress,
            'message'  => $this->message,
            'time'     => now()->toIso8601String(),
        ];
    }
}
```

### 10.2 在转码任务中报告进度

利用 FFmpeg 的 `-progress` 选项解析实时转码进度：

```php
<?php

class ProgressAwareTranscoder
{
    public function transcodeWithProgress(
        string $inputPath,
        string $outputPath,
        string $mediaId,
        array  $ffmpegArgs
    ): void {
        // 获取总时长
        $ffprobe  = \FFMpeg\FFProbe::create([
            'ffprobe.binaries' => config('media.ffprobe_bin'),
        ]);
        $duration = $ffprobe->format($inputPath)->get('duration');

        $cmd = sprintf(
            'ffmpeg -y -i %s %s -progress pipe:1 %s 2>/dev/null',
            escapeshellarg($inputPath),
            implode(' ', $ffmpegArgs),
            escapeshellarg($outputPath)
        );

        $process = proc_open($cmd, [
            0 => ['pipe', 'r'],  // stdin
            1 => ['pipe', 'r'],  // stdout (progress)
            2 => ['pipe', 'r'],  // stderr
        ], $pipes);

        if (!is_resource($process)) {
            throw new \RuntimeException('无法启动 FFmpeg 进程');
        }

        fclose($pipes[0]); // 不需要 stdin

        // 从 stdout 读取进度
        while (!feof($pipes[1])) {
            $line = fgets($pipes[1]);
            if ($line === false) break;

            $line = trim($line);

            if (str_starts_with($line, 'out_time_ms=')) {
                $timeMs   = (int) str_replace('out_time_ms=', '', $line);
                $progress = min(100, (int) (($timeMs / ($duration * 1000000)) * 100));

                // 广播进度
                event(new \App\Events\MediaProgressUpdated(
                    $mediaId,
                    'transcoding',
                    $progress,
                    "转码中... {$progress}%"
                ));
            }
        }

        fclose($pipes[1]);
        fclose($pipes[2]);

        $exitCode = proc_close($process);

        if ($exitCode !== 0) {
            throw new \RuntimeException("FFmpeg 转码失败，退出码: {$exitCode}");
        }
    }
}
```

前端通过 WebSocket 订阅进度频道：

```javascript
Echo.channel(`media.${mediaId}`)
    .listen('.media.progress', (e) => {
        updateProgressBar(e.stage, e.progress, e.message);
        
        if (e.progress >= 100 && e.stage === 'uploading_s3') {
            showToast('视频处理完成！');
        }
    });
```

## 十一、生产环境避坑指南

在将系统部署到生产环境时，以下问题是血泪教训的总结，每一个都可能在深夜把你叫起来。

### 11.1 内存限制

视频转码是内存密集型操作，特别是处理高分辨率视频时。PHP 的 `memory_limit` 通常设置为 128M 或 256M，但 FFmpeg 子进程的内存消耗不计入 PHP 进程。真正的风险在于 php-ffmpeg 库在读取大量帧数据时可能撑爆 PHP 进程内存。

解决方案：

```php
// 在 Job 中设置足够的内存限制
public function handle(): void
{
    ini_set('memory_limit', '2G');
    // 或者在 Supervisor 配置中通过环境变量设置
    // ...
}
```

更重要的是，在 `php.ini` 或 `php-fpm.conf` 中确保 `memory_limit` 对 CLI 模式的 Worker 足够高：

```ini
; cli 模式通常使用单独的 php.ini 或命令行参数
; artisan queue:work --memory=2048
```

### 11.2 超时配置的多层陷阱

超时是转码任务最常见的失败原因，而且容易出现多层超时的连锁反应：

1. **Laravel Job 超时**：`public int $timeout = 3600;` — 这是最内层的保护。
2. **Supervisor 超时**：确保 `stopwaitsecs` 大于 Job 超时时间。
3. **Nginx 反向代理超时**：如果 Worker 进程需要回调 API，注意 `proxy_read_timeout`。
4. **PHP `max_execution_time`**：CLI 模式默认为 0（无限制），但某些容器镜像可能设置了默认值。
5. **操作系统层面的 cgroup 超时**：Kubernetes Pod 可能有 `activeDeadlineSeconds`。

最佳实践：每一层的超时时间都应该比内层的超时时间长。例如：

```
FFmpeg 进程超时: 2小时
Laravel Job 超时: 2.5小时
Supervisor stopwaitsecs: 3小时
K8s activeDeadlineSeconds: 4小时
```

### 11.3 僵尸进程清理

当 Laravel Job 超时后被 Worker 强制终止时，FFmpeg 子进程可能变成孤儿进程继续运行，消耗 CPU 和磁盘资源。必须在 `failed()` 回调中清理：

```php
<?php

class TranscodeVideoJob implements ShouldQueue
{
    private ?int $ffmpegPid = null;

    public function handle(): void
    {
        // 启动 FFmpeg 时记录 PID
        $cmd = sprintf('echo $$; exec ffmpeg -i %s ...', escapeshellarg($this->inputPath));
        // ...
    }

    public function failed(\Throwable $exception): void
    {
        $this->killZombieProcesses();
    }

    protected function killZombieProcesses(): void
    {
        // 查找并杀掉属于当前媒体的所有 FFmpeg 进程
        $pattern = "ffmpeg.*{$this->mediaId}";
        exec("pkill -f " . escapeshellarg($pattern), $output, $returnCode);

        if ($returnCode === 0) {
            \Log::warning("清理了媒体 {$this->mediaId} 相关的僵尸 FFmpeg 进程");
        }
    }
}
```

更优雅的方案是使用 `pcntl_signal` 捕获信号，在进程被终止前主动清理子进程：

```php
pcntl_signal(SIGTERM, function ($signo) {
    // 杀掉所有子进程
    posix_kill(0, SIGKILL);
    exit(1);
});
```

### 11.4 磁盘空间管理

转码过程中会产生大量临时文件，一个 1GB 的源文件经过多码率转码可能产生 3-5GB 的临时文件。必须建立完善的清理机制：

```php
<?php

class TempFileCleaner
{
    public function clean(string $mediaId): void
    {
        $paths = [
            Storage::path("temp/{$mediaId}"),
            Storage::path("temp/uploads/{$mediaId}"),
            Storage::path("temp/merged"),
        ];

        foreach ($paths as $path) {
            if (is_dir($path)) {
                $this->recursiveDelete($path);
            }
        }
    }

    /**
     * 清理超过指定时间的临时文件（定时任务调用）
     */
    public function cleanExpired(int $maxAgeHours = 24): void
    {
        $tempDir   = Storage::path('temp');
        $cutoff    = time() - ($maxAgeHours * 3600);
        $cleaned   = 0;

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($tempDir, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );

        foreach ($iterator as $file) {
            if ($file->getMTime() < $cutoff) {
                $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
                $cleaned++;
            }
        }

        \Log::info("清理了 {$cleaned} 个过期临时文件");
    }
}
```

注册为 Laravel 定时任务：

```php
// app/Console/Kernel.php
$schedule->call(function () {
    (new TempFileCleaner())->cleanExpired(24);
})->daily()->at('03:00');
```

### 11.5 编码参数调优建议

不同的业务场景需要不同的编码参数策略：

- **短视频（< 60秒）**：可以使用 `-preset fast`，牺牲一点压缩率换取更快的处理速度。
- **长视频（> 30分钟）**：使用 `-preset slow` 或 `-preset slower`，压缩率提升 15-20%，在存储和带宽成本上节省显著。
- **用户生成内容（UGC）**：先进行 `loudnorm` 音频响度归一化，避免不同来源的视频音量差异过大。
- **直播回放**：需要使用 `-hls_flags delete_segments` 控制分片数量，避免存储无限增长。

```bash
# 音频响度归一化（EBU R128 标准）
ffmpeg -i input.mp4 -af loudnorm=I=-16:LRA=11:TP=-1.5 -c:v copy output.mp4
```

## 十二、完整处理流程串联

让我们将以上所有模块串联成一个完整的处理流程。当用户上传视频后：

1. **前端**：使用分块上传组件将文件切片上传到 Laravel 后端。
2. **后端**：`ChunkUploadController` 接收并合并分片，调用 `MediaValidator` 校验。
3. **创建记录**：入库 `Media` 模型，状态为 `pending`。
4. **派发管道**：`ProcessMediaPipelineJob::dispatch($mediaId)`。
5. **缩略图**：同步生成首张截图，立即可用。
6. **异步并行**：
   - `TranscodeVideoJob` → 标准 MP4 转码
   - `TranscodeHlsJob` → 多码率 HLS 切片
   - `ExtractAudioJob` → 音频提取
7. **水印处理**：在转码输出上叠加水印。
8. **上传至 S3**：`UploadToS3Job` 将处理结果上传到对象存储。
9. **发布通知**：广播 `MediaPublished` 事件，WebSocket 推送前端。
10. **CDN 分发**：S3 配合 CloudFront 或 Cloudflare CDN 全球加速。

每一步都有对应的错误处理、重试机制和进度广播，确保用户随时了解处理状态，开发者随时掌握系统健康状况。

## 总结

本文从 FFmpeg 底层概念出发，完整地构建了一个生产级的 Laravel 音视频处理系统。核心架构思想是：**将所有耗时操作异步化**，通过 Laravel 队列实现任务编排，通过事件广播实现实时反馈，通过多层存储策略平衡性能与成本。

在实际项目中，你还需要根据业务规模做出进一步的架构决策：小规模系统可以将所有 Worker 运行在单台服务器上；中等规模可以将转码 Worker 独立部署到专用的高配机器；大规模系统则可以考虑 Kubernetes + 动态扩缩容，或者接入 AWS MediaConvert / 阿里云 MPS 等云厂商的转码服务。

无论哪种方案，本文介绍的代码模式和架构思想都具有通用性——它们代表的是将 FFmpeg 这一强大工具集成到 PHP Web 应用中的最佳实践。希望这篇文章能为你的音视频处理项目提供扎实的技术参考。

## 相关阅读

- [Laravel + OSS/S3 对象存储实战：前端直传、临时签名与回源踩坑记录](/php/Laravel/laravel-oss-s3-guide/)
- [Laravel 队列深度实战：Redis/Database/SQS 驱动选型与 Worker 调优踩坑记录](/php/Laravel/laravel-queue-redis-database-sqs-worker-optimization/)
- [重试与退避策略实战：Exponential Backoff + Jitter——Laravel HTTP Client 的韧性设计模式](/05_PHP/Laravel/重试与退避策略实战-Exponential-Backoff-Jitter-Laravel-HTTP-Client韧性设计模式/)
