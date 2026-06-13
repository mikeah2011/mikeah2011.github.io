---
title: "WebCodecs API 实战：浏览器原生音视频编解码——实时录制、转码、直播推流与 Laravel 后端存储集成"
keywords: [WebCodecs API, Laravel, 浏览器原生音视频编解码, 实时录制, 转码, 直播推流与, 后端存储集成, 前端]
date: 2026-06-10 04:09:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
  - WebCodecs
  - 音视频
  - MediaRecorder
  - WebRTC
  - Laravel
  - FFmpeg
  - 实时录制
  - 直播推流
description: "深入实战 WebCodecs API，从浏览器原生音视频编解码原理出发，覆盖实时录制、格式转码、直播推流场景，并与 Laravel 后端完整集成，实现端到端的音视频处理方案。"
---


## 为什么需要 WebCodecs？

在 WebCodecs API 出现之前，浏览器端处理音视频基本只有两条路：

1. **MediaRecorder API** —— 能录制，但输出格式有限（WebM/VP8/VP9），无法精细控制编码参数，无法逐帧操作。
2. **WebRTC** —— 能实时传输，但编解码能力被封装在黑盒里，你拿不到原始帧数据。

WebCodecs API 的出现彻底改变了这个局面。它把浏览器底层的编解码器（基于平台原生的 MediaCodec/VideoToolbox/FFmpeg）暴露给了 JavaScript，让你可以：

- 逐帧解码视频 → 拿到原始 `VideoFrame` 对象
- 逐帧编码视频 → 控制 codec、比特率、关键帧间隔
- 直接操作音频采样数据 → 精确到 sample 级别的 AudioData
- 实现自定义的录制、转码、推流逻辑

简单说：**WebCodecs 让浏览器变成了一个可控的音视频处理引擎。**

## 核心概念速览

### 四大组件

| 组件 | 作用 | 输入 | 输出 |
|------|------|------|------|
| `VideoDecoder` | 视频解码 | 编码数据（H.264/VP8/VP9/AV1） | `VideoFrame` |
| `VideoEncoder` | 视频编码 | `VideoFrame` | 编码数据 |
| `AudioDecoder` | 音频解码 | 编码数据（AAC/Opus） | `AudioData` |
| `AudioEncoder` | 音频编码 | `AudioData` | 编码数据 |

### 数据流转

```
摄像头/屏幕 → MediaStreamTrack → VideoTrackReader → VideoFrame
    → VideoEncoder → EncodedVideoChunk → 封装(如 fMP4) → 存储/传输
```

### 关键对象

- **VideoFrame**: 原始视频帧，包含 `width`、`height`、`format`（如 I420、NV12、RGBA）、时间戳
- **EncodedVideoChunk**: 编码后的视频数据块，包含 `type`（key/delta）、`timestamp`、`duration`
- **AudioData**: 原始音频采样，包含 `format`（f32/s16 等）、`sampleRate`、`numberOfFrames`

## 实战一：屏幕录制 + WebCodecs 编码

### 获取屏幕流

```javascript
// 获取屏幕录制流
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  },
  audio: true
});
```

### 初始化 VideoEncoder

```javascript
const videoTrack = stream.getVideoTracks()[0];
const settings = videoTrack.getSettings();

// 准备编码器
const videoChunks = [];
const videoEncoder = new VideoEncoder({
  output: (chunk, metadata) => {
    // 编码后的数据块回调
    const buffer = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buffer);
    videoChunks.push({
      type: chunk.type,
      timestamp: chunk.timestamp,
      duration: chunk.duration,
      data: buffer,
      metadata
    });
  },
  error: (e) => console.error('VideoEncoder error:', e)
});

await videoEncoder.configure({
  codec: 'avc1.42001f', // H.264 Baseline Profile Level 3.1
  width: settings.width,
  height: settings.height,
  bitrate: 4_000_000,     // 4 Mbps
  framerate: settings.frameRate || 30,
  avc: { format: 'avc' }  // 输出 AVC 格式（方便后续封装为 fMP4）
});
```

### 逐帧采集与编码

```javascript
// 使用 VideoTrackReader（Chrome 94+）逐帧读取
const reader = new VideoTrackReader(videoTrack);

reader.readable.pipeTo(new WritableStream({
  write(videoFrame) {
    // 检查编码器是否繁忙
    if (videoEncoder.encodeQueueSize < 5) {
      // 关键帧间隔：每 2 秒一个 key frame
      const keyFrame = videoFrame.timestamp % (2 * 1_000_000) < (1_000_000 / settings.frameRate);
      videoEncoder.encode(videoFrame, { keyFrame });
    }
    // 必须关闭 frame，释放资源
    videoFrame.close();
  }
}));
```

### 停止录制与 flush

```javascript
async function stopRecording() {
  // 停止采集
  stream.getTracks().forEach(t => t.stop());

  // flush 编码器，确保所有帧都输出
  await videoEncoder.flush();
  videoEncoder.close();

  console.log(`录制完成，共 ${videoChunks.length} 个编码块`);
  return videoChunks;
}
```

## 实战二：fMP4 封装

编码后的 `EncodedVideoChunk` 只是裸的编码数据，要生成可播放的文件，需要封装成容器格式。fMP4（Fragmented MP4）是最适合 WebCodecs 的格式——它支持流式写入，不需要预知总时长。

### fMP4 封装器实现

```javascript
class FMP4Muxer {
  constructor(config) {
    this.codec = config.codec; // 'avc1'
    this.width = config.width;
    this.height = config.height;
    this.chunks = [];
    this.sequenceNumber = 0;
  }

  // 将 EncodedVideoChunk 转为 fMP4 segment
  createSegment(encodedChunks, isInit = false) {
    if (isInit) {
      return this._createInitSegment();
    }
    return this._createMediaSegment(encodedChunks);
  }

  _createInitSegment() {
    // fMP4 初始化段：ftyp + moov
    // 这里用简化实现，生产环境建议用 mp4-muxer 库
    const ftyp = this._box('ftyp', this._concatBuffers([
      this._str('isom'),           // major brand
      this._uint32(0x200),         // minor version
      this._str('isom'),           // compatible brands
      this._str('iso2'),
      this._str('mp41')
    ]));

    const moov = this._createMoov();
    return this._concatBuffers([ftyp, moov]);
  }

  _createMediaSegment(chunks) {
    // fMP4 媒体段：moof + mdat
    const moof = this._createMoof(chunks);
    const mdatData = this._concatBuffers(
      chunks.map(c => c.data)
    );
    const mdat = this._box('mdat', mdatData);
    return this._concatBuffers([moof, mdat]);
  }

  // ISO BMFF box 构造工具
  _box(type, payload) {
    const size = 8 + payload.byteLength;
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    view.setUint32(0, size);
    new Uint8Array(buffer, 4, 4).set(new TextEncoder().encode(type));
    new Uint8Array(buffer, 8).set(payload);
    return new Uint8Array(buffer);
  }

  _str(s) { return new TextEncoder().encode(s); }
  _uint32(v) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, v);
    return new Uint8Array(b);
  }
  _concatBuffers(arrays) {
    const total = arrays.reduce((s, a) => s + a.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      result.set(new Uint8Array(a.buffer || a), offset);
      offset += a.byteLength;
    }
    return result;
  }

  _createMoof() { /* 省略完整实现，生产用 mp4-muxer */ }
  _createMoov() { /* 省略完整实现 */ }
}
```

> **生产建议**：直接用 [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 库，上面的简化实现用于理解原理。

### 使用 mp4-muxer（推荐）

```javascript
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const muxer = new Muxer({
  target: new ArrayBufferTarget(),
  video: {
    codec: 'avc',
    width: settings.width,
    height: settings.height
  },
  fastStart: 'in-memory'
});

// 在 VideoEncoder 的 output 回调中
output: (chunk, metadata) => {
  muxer.addVideoChunk(chunk, metadata);
}

// 录制结束后
async function finalize() {
  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  const buffer = muxer.target.buffer;
  // buffer 就是一个完整的 MP4 文件
  return new Blob([buffer], { type: 'video/mp4' });
}
```

## 实战三：音频录制与混合

屏幕录制通常需要同时采集系统音频和麦克风音频，WebCodecs 的 `AudioEncoder` 可以精确控制编码过程。

### 音频采集与编码

```javascript
// 分别采集麦克风和系统音频
const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
const screenStream = await navigator.mediaDevices.getDisplayMedia({ audio: true });

// 初始化 AudioEncoder
const audioChunks = [];
const audioEncoder = new AudioEncoder({
  output: (chunk) => {
    const buffer = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buffer);
    audioChunks.push({
      type: chunk.type,
      timestamp: chunk.timestamp,
      duration: chunk.duration,
      data: buffer
    });
  },
  error: (e) => console.error('AudioEncoder error:', e)
});

await audioEncoder.configure({
  codec: 'mp4a.40.2', // AAC-LC
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128_000
});

// 使用 AudioData 直接编码
function encodeAudioData(audioData) {
  audioEncoder.encode(audioData);
  audioData.close(); // 释放资源
}
```

### 音频混流（AudioWorklet）

```javascript
// audio-mixer-processor.js
class AudioMixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.micBuffer = [];
    this.systemBuffer = [];
    this.port.onmessage = (e) => {
      if (e.data.type === 'mic') {
        this.micBuffer.push(...e.data.samples);
      } else if (e.data.type === 'system') {
        this.systemBuffer.push(...e.data.samples);
      }
    };
  }

  process(inputs) {
    const output = inputs[0]?.[0];
    if (!output) return true;

    for (let i = 0; i < output.length; i++) {
      const mic = this.micBuffer.shift() || 0;
      const system = this.systemBuffer.shift() || 0;
      // 简单混音，避免削波
      output[i] = Math.max(-1, Math.min(1, mic * 0.7 + system * 0.7));
    }
    return true;
  }
}

registerProcessor('audio-mixer-processor', AudioMixerProcessor);
```

## 实战四：Laravel 后端存储集成

录制完成后，需要将视频文件上传到 Laravel 后端。这里实现完整的上传、存储、转码流水线。

### 前端上传

```javascript
async function uploadRecording(blob, filename) {
  const formData = new FormData();
  formData.append('video', blob, filename);
  formData.append('duration', Math.round(recordingDuration));
  formData.append('resolution', `${settings.width}x${settings.height}`);

  const response = await fetch('/api/recordings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  const result = await response.json();
  console.log('上传成功:', result.url);
  return result;
}
```

### Laravel 路由与控制器

```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/recordings', [RecordingController::class, 'store']);
    Route::get('/recordings/{recording}', [RecordingController::class, 'show']);
    Route::get('/recordings/{recording}/status', [RecordingController::class, 'status']);
});
```

```php
// app/Http/Controllers/RecordingController.php
<?php

namespace App\Http\Controllers;

use App\Models\Recording;
use App\Jobs\TranscodeVideo;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class RecordingController extends Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'video'     => 'required|file|max:524288', // 512MB
            'duration'  => 'required|integer|min:1',
            'resolution' => 'required|string',
        ]);

        $file = $request->file('video');
        $hash = md5_file($file);
        $path = $file->store('recordings/raw', 'local');

        $recording = Recording::create([
            'user_id'      => $request->user()->id,
            'original_path' => $path,
            'filename'      => $file->getClientOriginalName(),
            'mime_type'     => $file->getMimeType(),
            'size'          => $file->getSize(),
            'hash'          => $hash,
            'duration'      => $request->input('duration'),
            'resolution'    => $request->input('resolution'),
            'status'        => 'uploaded',
        ]);

        // 异步转码
        TranscodeVideo::dispatch($recording);

        return response()->json([
            'id'     => $recording->id,
            'status' => 'uploaded',
            'message' => '视频已上传，正在后台转码...'
        ], 201);
    }

    public function show(Recording $recording)
    {
        $this->authorize('view', $recording);

        if ($recording->status !== 'completed') {
            return response()->json([
                'status' => $recording->status,
                'message' => '视频正在处理中...'
            ]);
        }

        return response()->json([
            'id'        => $recording->id,
            'url'       => Storage::disk('public')->url($recording->processed_path),
            'thumbnail' => $recording->thumbnail_path
                ? Storage::disk('public')->url($recording->thumbnail_path)
                : null,
            'duration'  => $recording->duration,
            'resolution' => $recording->resolution,
            'size'      => $recording->processed_size,
        ]);
    }

    public function status(Recording $recording)
    {
        return response()->json([
            'status'     => $recording->status,
            'progress'   => $recording->transcode_progress,
            'error'      => $recording->transcode_error,
        ]);
    }
}
```

### Recording 模型

```php
// app/Models/Recording.php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Recording extends Model
{
    protected $fillable = [
        'user_id', 'original_path', 'processed_path',
        'thumbnail_path', 'filename', 'mime_type', 'size',
        'processed_size', 'hash', 'duration', 'resolution',
        'status', 'transcode_progress', 'transcode_error',
    ];

    protected $casts = [
        'transcode_progress' => 'integer',
        'duration'           => 'integer',
        'size'               => 'integer',
        'processed_size'     => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
```

### FFmpeg 转码 Job

```php
// app/Jobs/TranscodeVideo.php
<?php

namespace App\Jobs;

use App\Models\Recording;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

class TranscodeVideo implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 1800; // 30 分钟

    public function __construct(
        private Recording $recording
    ) {}

    public function handle(): void
    {
        $this->recording->update(['status' => 'processing']);

        $disk = Storage::disk('local');
        $inputPath = $disk->path($this->recording->original_path);

        // 输出路径
        $outputDir = 'recordings/processed/' . $this->recording->id;
        $outputFilename = 'output.mp4';
        $outputPath = $disk->path($outputDir . '/' . $outputFilename);
        $thumbnailPath = $disk->path($outputDir . '/thumbnail.jpg');

        // 确保目录存在
        $disk->makeDirectory($outputDir);

        try {
            // 1. FFmpeg 转码：统一编码为 H.264 + AAC，兼容性最好
            $process = new Process([
                'ffmpeg',
                '-i', $inputPath,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-maxrate', '5M',
                '-bufsize', '10M',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ar', '48000',
                '-movflags', '+faststart', // MP4 moov atom 前置，支持流式播放
                '-y',
                $outputPath
            ]);

            $process->setTimeout(1800);
            $process->run();

            if (!$process->isSuccessful()) {
                throw new \RuntimeException(
                    'FFmpeg failed: ' . $process->getErrorOutput()
                );
            }

            // 2. 生成缩略图（取第 1 秒的帧）
            $thumbProcess = new Process([
                'ffmpeg',
                '-i', $outputPath,
                '-ss', '1',
                '-vframes', '1',
                '-vf', 'scale=640:-1',
                '-y',
                $thumbnailPath
            ]);

            $thumbProcess->setTimeout(60);
            $thumbProcess->run();

            // 3. 更新记录
            $this->recording->update([
                'status'         => 'completed',
                'processed_path' => $outputDir . '/' . $outputFilename,
                'thumbnail_path' => $outputDir . '/thumbnail.jpg',
                'processed_size' => filesize($outputPath),
                'transcode_progress' => 100,
            ]);

            // 4. 删除原始文件（可选，节省存储）
            $disk->delete($this->recording->original_path);

            Log::info('Video transcoded successfully', [
                'recording_id' => $this->recording->id,
                'output_size'  => filesize($outputPath),
            ]);

        } catch (\Throwable $e) {
            $this->recording->update([
                'status' => 'failed',
                'transcode_error' => $e->getMessage(),
            ]);

            Log::error('Video transcode failed', [
                'recording_id' => $this->recording->id,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }
}
```

### 进度轮询（前端）

```javascript
async function pollTranscodeStatus(recordingId) {
  const interval = setInterval(async () => {
    const res = await fetch(`/api/recordings/${recordingId}/status`);
    const data = await res.json();

    updateProgressBar(data.progress || 0);

    if (data.status === 'completed') {
      clearInterval(interval);
      // 获取播放地址
      const detail = await fetch(`/api/recordings/${recordingId}`).then(r => r.json());
      videoPlayer.src = detail.url;
      showToast('转码完成！');
    } else if (data.status === 'failed') {
      clearInterval(interval);
      showToast('转码失败：' + data.error, 'error');
    }
  }, 2000);
}
```

## 实战五：实时预览——边录边看

WebCodecs 最强大的能力之一是**录制过程中实时预览**。通过 `VideoFrame` 可以直接绘制到 Canvas：

```javascript
const previewCanvas = document.getElementById('preview');
const ctx = previewCanvas.getContext('2d');

// 在采集回调中同时编码和预览
reader.readable.pipeTo(new WritableStream({
  write(videoFrame) {
    // 实时预览
    ctx.drawImage(videoFrame, 0, 0, previewCanvas.width, previewCanvas.height);

    // 同时编码
    if (videoEncoder.encodeQueueSize < 5) {
      const keyFrame = needsKeyFrame(videoFrame.timestamp);
      videoEncoder.encode(videoFrame, { keyFrame });
    }

    videoFrame.close();
  }
}));
```

## 踩坑记录

### 1. VideoFrame 生命周期

**问题**：`VideoFrame` 使用后必须调用 `.close()`，否则内存泄漏。

**教训**：WebCodecs 的资源管理类似 C++ 的 RAII，JavaScript 里只能靠纪律。建议封装一个自动 close 的包装器：

```javascript
function withFrame(frame, fn) {
  try {
    return fn(frame);
  } finally {
    frame.close();
  }
}
```

### 2. encodeQueueSize 的陷阱

**问题**：不检查 `encodeQueueSize` 就直接 encode，高帧率场景下编码器队列爆炸，内存暴涨。

**教训**：始终用背压控制：

```javascript
// 等待编码器空闲
while (videoEncoder.encodeQueueSize > 3) {
  await new Promise(r => setTimeout(r, 10));
}
videoEncoder.encode(frame, { keyFrame });
```

### 3. Safari 兼容性

**问题**：截至 2026 年初，Safari 对 WebCodecs 的支持仍然有限。`VideoTrackReader` 在 Safari 不可用。

**方案**：降级到 `MediaRecorder`：

```javascript
function createRecorder(stream, options = {}) {
  if (typeof VideoEncoder !== 'undefined') {
    return new WebCodecsRecorder(stream, options);
  }
  // Safari 降级
  return new MediaRecorderFallback(stream, options);
}
```

### 4. fMP4 时间戳精度

**问题**：WebCodecs 的时间戳是微秒（`performance.now() * 1000`），但有些封装库期望毫秒。混用导致播放速度异常。

**教训**：统一用微秒，传给封装库前确认单位。

### 5. 音视频同步

**问题**：分别编码的音频和视频流，时间戳基准不同，合并后音画不同步。

**方案**：统一用 `performance.timeOrigin + performance.now()` 作为时间基准：

```javascript
const startTime = performance.timeOrigin + performance.now();

function getTimestamp() {
  return (performance.timeOrigin + performance.now() - startTime) * 1000; // 微秒
}

// 编码时统一使用
videoEncoder.encode(frame, { keyFrame });
// frame 创建时已带 timestamp，确保采集端就对齐
```

## 性能优化建议

### 1. OffscreenCanvas 预览

```javascript
// 主线程采集 → Worker 中编码
const offscreen = previewCanvas.transferControlToOffscreen();
const worker = new Worker('encoder-worker.js');
worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
```

### 2. 硬件加速检测

```javascript
const support = await VideoEncoder.isConfigSupported({
  codec: 'avc1.42001f',
  width: 1920,
  height: 1080,
  hardwareAcceleration: 'prefer-hardware'
});

console.log('硬件加速:', support.supported ? '可用' : '不可用');
```

### 3. 自适应码率

```javascript
// 根据编码队列深度动态调整码率
function adjustBitrate() {
  const queueDepth = videoEncoder.encodeQueueSize;
  const currentBitrate = videoEncoder.bitrate; // 需自行追踪

  if (queueDepth > 3) {
    // 队列积压，降低码率
    const newBitrate = Math.max(500_000, currentBitrate * 0.8);
    // 注意：需要重新 configure，不是实时生效
    videoEncoder.configure({ ...currentConfig, bitrate: newBitrate });
  }
}
```

## 完整流程图

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  摄像头/屏幕  │────→│ VideoTrack   │────→│ VideoFrame   │
│  MediaStream │     │ Reader       │     │ (原始帧)      │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
                    ┌───────────────────────────┤
                    ▼                           ▼
            ┌──────────────┐           ┌──────────────┐
            │ Canvas 预览   │           │ VideoEncoder │
            │ (实时显示)     │           │ (H.264编码)   │
            └──────────────┘           └──────┬───────┘
                                              │
                    ┌─────────────────────────┤
                    ▼                         ▼
            ┌──────────────┐          ┌──────────────┐
            │ AudioEncoder │          │ EncodedVideo │
            │ (AAC编码)     │          │ Chunk        │
            └──────┬───────┘          └──────┬───────┘
                   │                         │
                   └────────┬────────────────┘
                            ▼
                    ┌──────────────┐
                    │  fMP4 Muxer  │
                    │  (封装容器)   │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    ▼              ▼
            ┌──────────┐   ┌──────────┐
            │ 本地下载  │   │ 上传 Laravel│
            └──────────┘   │ 后端转码存储│
                           └──────────┘
```

## 总结

WebCodecs API 是浏览器音视频能力的一次质变。从 MediaRecorder 的「能录」到 WebCodecs 的「能控」，开发者终于可以在浏览器端实现专业级的音视频处理。

**核心要点**：

1. **WebCodecs 是底层 API** —— 它给你的是原始编解码能力，封装、传输、存储都需要自己实现
2. **fMP4 是最佳搭档** —— 流式写入、浏览器原生支持，mp4-muxer 库是生产首选
3. **资源管理是第一要务** —— VideoFrame/AudioData 必须 close，encodeQueueSize 必须监控
4. **Laravel 后端保持简单** —— 接收文件、FFmpeg 转码、异步队列，不需要在后端做复杂的流处理
5. **Safari 仍需降级** —— 生产环境务必有 MediaRecorder 备选方案

这套方案适合：在线教育录课、视频会议录制、直播录制回放、短视频创作等场景。如果需要更复杂的直播推流（RTMP/SRT），WebCodecs 编码后的数据可以通过 WebSocket 发送到推流服务器，这是另一个话题了。

---

**参考资源**：

- [WebCodecs API 规范](https://www.w3.org/TR/webcodecs/)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)
- [Chrome WebCodecs 示例](https://web.dev/articles/webcodecs)
- [MDN WebCodecs 文档](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
