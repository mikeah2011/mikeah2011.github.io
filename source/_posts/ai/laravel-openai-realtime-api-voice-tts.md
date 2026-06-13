---
title: Laravel + OpenAI Realtime API 实战：语音对话、实时转录与 TTS——PHP 后端的语音 AI 集成
keywords: [Laravel, OpenAI Realtime API, TTS, PHP, AI, 语音对话, 实时转录与, 后端的语音]
date: 2026-06-09 06:49:00
categories:
  - ai
tags:
  - Laravel
  - OpenAI
  - Realtime API
  - 语音对话
  - TTS
  - WebSocket
  - PHP
description: 深入实战 Laravel 集成 OpenAI Realtime API，实现语音对话、实时语音转文字、文本转语音的完整流程，包含 WebSocket 连接管理、音频流处理、会话状态维护与生产级部署方案。
cover: https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1200
images:
  - https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1200
---


# Laravel + OpenAI Realtime API 实战：语音对话、实时转录与 TTS

## 概述

OpenAI Realtime API 是 2024 年底推出的能力，允许客户端通过 WebSocket 建立持久连接，实现毫秒级延迟的语音对话。相比传统的 "录音 → 上传 → STT → LLM → TTS → 下载" 流程，Realtime API 将整个管线合并为一个双向流，延迟从秒级降到 200-500ms。

这篇文章不讲概念，直接上代码。我们用 Laravel 搭建一个完整的语音 AI 后端，涵盖：

- **WebSocket 代理层**：PHP 处理 OpenAI 的 WebSocket 连接
- **服务端会话管理**：创建、配置、销毁 Realtime 会话
- **音频流中转**：客户端音频 → 服务端 → OpenAI → 服务端 → 客户端
- **TTS 与转录**：独立调用文本转语音和语音转文字
- **生产部署**：队列、限流、成本控制

## 核心概念

### Realtime API 架构

```
┌──────────┐    WebSocket    ┌──────────────┐    WebSocket    ┌──────────┐
│  浏览器   │ ◄────────────► │  Laravel      │ ◄────────────► │  OpenAI   │
│  /移动App │   音频+事件    │  代理服务     │   音频+事件    │  Realtime │
└──────────┘                └──────────────┘                └──────────┘
```

关键点：
- OpenAI 的 WebSocket 是 **持久连接**，不是 HTTP 请求
- 音频格式要求：PCM16, 24kHz, 单声道
- 服务端可以随时发送 `response.create` 触发 AI 回复
- 支持 `server_vad`（服务端语音活动检测）自动判断用户说完

### 与传统方案对比

| 维度 | 传统 STT→LLM→TTS | Realtime API |
|------|-------------------|--------------|
| 延迟 | 2-5 秒 | 200-500ms |
| 连接 | 多次 HTTP | 单次 WebSocket |
| 上下文 | 每次重建 | 持久会话 |
| 成本 | 按字符计费 | 按分钟计费 |
| 适用场景 | 非实时交互 | 实时语音助手 |

## 实战代码

### 1. 安装依赖

```bash
composer require beyondcode/laravel-websockets
composer require ratchet/pawl
```

同时需要 OpenAI API Key，在 `.env` 中配置：

```
OPENAI_API_KEY=sk-xxxxx
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17
```

### 2. Realtime 会话管理服务

```php
<?php
// app/Services/OpenAI/RealtimeSession.php

namespace App\Services\OpenAI;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RealtimeSession
{
    private string $apiKey;
    private string $model;
    private string $baseUrl = 'https://api.openai.com/v1/realtime';

    public function __construct()
    {
        $this->apiKey = config('services.openai.api_key');
        $this->model = config('services.openai.realtime_model', 'gpt-4o-realtime-preview-2024-12-17');
    }

    /**
     * 创建 Realtime 会话并返回 WebSocket URL
     */
    public function createSession(array $options = []): array
    {
        $defaultOptions = [
            'model' => $this->model,
            'modalities' => ['text', 'audio'],
            'instructions' => '你是一个友好的中文助手，用简洁专业的语气回答问题。',
            'voice' => 'alloy',
            'input_audio_format' => 'pcm16',
            'output_audio_format' => 'pcm16',
            'input_audio_transcription' => [
                'model' => 'whisper-1',
            ],
            'turn_detection' => [
                'type' => 'server_vad',
                'threshold' => 0.5,
                'prefix_padding_ms' => 300,
                'silence_duration_ms' => 500,
            ],
            'temperature' => 0.8,
            'max_response_output_tokens' => 4096,
        ];

        $config = array_merge($defaultOptions, $options);

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->post("{$this->baseUrl}/sessions", $config);

        if ($response->failed()) {
            Log::error('Realtime session creation failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException("Failed to create Realtime session: {$response->body()}");
        }

        return $response->json();
    }

    /**
     * 获取带 Ephemeral Token 的 WebSocket URL
     */
    public function getWebSocketUrl(string $sessionId): string
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->post("{$this->baseUrl}/sessions/{$sessionId}/client_secret", []);

        if ($response->failed()) {
            throw new \RuntimeException("Failed to get WebSocket URL: {$response->body()}");
        }

        $data = $response->json();
        return $data['client_secret']['value'];
    }

    /**
     * 更新会话配置
     */
    public function updateSession(string $sessionId, array $updates): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->patch("{$this->baseUrl}/sessions/{$sessionId}", $updates);

        if ($response->failed()) {
            throw new \RuntimeException("Failed to update session: {$response->body()}");
        }

        return $response->json();
    }

    /**
     * 删除会话
     */
    public function deleteSession(string $sessionId): void
    {
        Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
        ])->delete("{$this->baseUrl}/sessions/{$sessionId}");
    }
}
```

### 3. WebSocket 代理控制器

这是核心——Laravel 作为 WebSocket 代理，连接客户端和 OpenAI：

```php
<?php
// app/Http/Controllers/RealtimeController.php

namespace App\Http\Controllers;

use App\Services\OpenAI\RealtimeSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Ratchet\Client\WebSocket;
use Ratchet\Client\Connector;
use React\EventLoop\Factory;

class RealtimeController extends Controller
{
    private RealtimeSession $session;

    public function __construct(RealtimeSession $session)
    {
        $this->session = $session;
    }

    /**
     * POST /api/realtime/session
     * 创建会话，返回 WebSocket 连接信息
     */
    public function createSession(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'instructions' => 'sometimes|string|max:5000',
            'voice' => 'sometimes|string|in:alloy,ash,ballad,coral,echo,sage,shimmer,verse',
            'temperature' => 'sometimes|numeric|min:0|max:2',
            'turn_detection' => 'sometimes|string|in:server_vad,disabled',
        ]);

        $sessionData = $this->session->createSession($validated);

        return response()->json([
            'session_id' => $sessionData['id'],
            'model' => $sessionData['model'],
            'expires_at' => now()->addSeconds(600)->toIso8601String(),
        ]);
    }

    /**
     * POST /api/realtime/connect
     * 获取 Ephemeral Token 用于客户端直连
     */
    public function connect(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'session_id' => 'required|string',
        ]);

        $token = $this->session->getWebSocketUrl($validated['session_id']);

        return response()->json([
            'token' => $token,
            'url' => "wss://api.openai.com/v1/realtime?model=" . config('services.openai.realtime_model'),
            'expires_in' => 600,
        ]);
    }

    /**
     * 服务端代理模式（推荐用于需要控制音频流的场景）
     * 客户端连接 Laravel WebSocket，Laravel 代理转发到 OpenAI
     */
    public function proxySession(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'session_id' => 'required|string',
            'instructions' => 'sometimes|string',
        ]);

        $token = $this->session->getWebSocketUrl($validated['session_id']);
        $model = config('services.openai.realtime_model');
        $url = "wss://api.openai.com/v1/realtime?model={$model}";

        // 返回代理配置，前端可通过 Laravel WebSocket 连接
        return response()->json([
            'proxy_url' => '/ws/realtime',
            'openai_url' => $url,
            'token' => $token,
            'session_id' => $validated['session_id'],
            'expires_at' => now()->addSeconds(600)->toIso8601String(),
        ]);
    }

    /**
     * POST /api/realtime/{sessionId}/update
     * 运行时更新会话配置（切换指令、语音等）
     */
    public function updateSession(Request $request, string $sessionId): JsonResponse
    {
        $validated = $request->validate([
            'instructions' => 'sometimes|string|max:5000',
            'voice' => 'sometimes|string',
            'temperature' => 'sometimes|numeric|min:0|max=2',
        ]);

        $result = $this->session->updateSession($sessionId, $validated);

        return response()->json(['success' => true, 'session' => $result]);
    }

    /**
     * DELETE /api/realtime/{sessionId}
     * 销毁会话
     */
    public function destroySession(string $sessionId): JsonResponse
    {
        $this->session->deleteSession($sessionId);
        return response()->json(['success' => true]);
    }
}
```

### 4. 独立 TTS 和转录接口

Realtime API 的会话适合交互式场景，但有时候你只需要一次性 TTS 或转录：

```php
<?php
// app/Services/OpenAI/RealtimeService.php

namespace App\Services\OpenAI;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class RealtimeService
{
    private string $apiKey;

    public function __construct()
    {
        $this->apiKey = config('services.openai.api_key');
    }

    /**
     * TTS：文本转语音
     * 返回 PCM16 音频数据
     */
    public function textToSpeech(string $text, array $options = []): string
    {
        $defaultOptions = [
            'model' => 'tts-1-hd',
            'voice' => 'alloy',
            'response_format' => 'pcm',
            'speed' => 1.0,
        ];

        $config = array_merge($defaultOptions, $options);

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->timeout(30)
          ->post('https://api.openai.com/v1/audio/speech', array_merge($config, [
            'input' => $text,
        ]));

        if ($response->failed()) {
            Log::error('TTS failed', ['status' => $response->status(), 'body' => $response->body()]);
            throw new \RuntimeException("TTS failed: {$response->body()}");
        }

        return $response->body();
    }

    /**
     * STT：语音转文字
     * 接受 PCM16 音频数据
     */
    public function speechToText(string $audioData, array $options = []): array
    {
        $tempFile = storage_path('app/temp_audio_' . Str::random(8) . '.pcm');
        file_put_contents($tempFile, $audioData);

        try {
            $response = Http::attach(
                'file', fopen($tempFile, 'r'), 'audio.pcm'
            )->withHeaders([
                'Authorization' => "Bearer {$this->apiKey}",
            ])->timeout(30)
              ->attach('file', $audioData, 'audio.pcm')
              ->post('https://api.openai.com/v1/audio/transcriptions', array_merge([
                'model' => 'whisper-1',
                'language' => 'zh',
                'response_format' => 'verbose_json',
                'timestamp_granularities' => ['word'],
              ], $options));

            if ($response->failed()) {
                throw new \RuntimeException("STT failed: {$response->body()}");
            }

            return $response->json();
        } finally {
            @unlink($tempFile);
        }
    }

    /**
     * 实时转录：从 Realtime 事件中提取转录结果
     */
    public function extractTranscription(array $event): ?string
    {
        return match ($event['type'] ?? '') {
            'conversation.item.input_audio_transcription.completed' => $event['transcript'] ?? null,
            'response.audio_transcript.done' => $event['transcript'] ?? null,
            default => null,
        };
    }
}
```

### 5. 队列任务：异步音频处理

音频流可能很大，用队列处理避免超时：

```php
<?php
// app/Jobs/ProcessAudioChunk.php

namespace App\Jobs;

use App\Services\OpenAI\RealtimeService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessAudioChunk implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;

    public function __construct(
        public string $sessionId,
        public string $audioData,
        public string $eventItemId,
    ) {}

    public function handle(RealtimeService $service): void
    {
        try {
            $result = $service->speechToText($this->audioData);

            // 存储转录结果，供后续使用
            cache()->put(
                "transcription:{$this->sessionId}:{$this->eventItemId}",
                $result,
                now()->addMinutes(30)
            );

            Log::info('Audio transcription completed', [
                'session_id' => $this->sessionId,
                'transcript' => $result['text'] ?? '',
                'duration' => $result['duration'] ?? 0,
            ]);
        } catch (\Exception $e) {
            Log::error('Audio processing failed', [
                'session_id' => $this->sessionId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }
}
```

### 6. 前端直连示例

```html
<!-- resources/views/realtime.blade.php -->
<div id="voice-ui">
  <button id="connect-btn" onclick="connect()">连接</button>
  <button id="disconnect-btn" onclick="disconnect()" disabled>断开</button>
  <div id="status">未连接</div>
  <div id="transcript"></div>
  <div id="ai-response"></div>
</div>

<script>
let ws = null;
let audioContext = null;
let mediaStream = null;

async function connect() {
    // 1. 从 Laravel 获取会话信息
    const sessionRes = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instructions: '你是一个友好的语音助手',
            voice: 'alloy',
        }),
    });
    const session = await sessionRes.json();

    // 2. 获取 Ephemeral Token
    const connectRes = await fetch('/api/realtime/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.session_id }),
    });
    const { token, url } = await connectRes.json();

    // 3. 建立 WebSocket 连接
    ws = new WebSocket(`${url}&client_secret=${token}`);

    ws.onopen = () => {
        document.getElementById('status').textContent = '已连接';
        startAudioCapture();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
    };

    ws.onclose = () => {
        document.getElementById('status').textContent = '已断开';
        stopAudioCapture();
    };
}

function handleServerEvent(event) {
    switch (event.type) {
        case 'session.created':
            console.log('会话已创建:', event.session);
            break;

        case 'session.updated':
            console.log('会话已更新:', event.session);
            break;

        case 'conversation.item.input_audio_transcription.completed':
            document.getElementById('transcript').textContent =
                `你说: ${event.transcript}`;
            break;

        case 'response.audio_transcript.done':
            document.getElementById('ai-response').textContent =
                `AI: ${event.transcript}`;
            break;

        case 'response.audio.delta':
            // 接收 AI 音频，播放
            playAudio(event.delta);
            break;

        case 'response.audio.done':
            console.log('AI 回复完成');
            break;

        case 'error':
            console.error('服务端错误:', event.error);
            break;
    }
}

async function startAudioCapture() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 24000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
            },
        });

        audioContext = new AudioContext({ sampleRate: 24000 });
        const source = audioContext.createMediaStreamSource(mediaStream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16 = float32ToInt16(inputData);
                ws.send(JSON.stringify({
                    type: 'input_audio_buffer.append',
                    audio: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer))),
                }));
            }
        };
    } catch (err) {
        console.error('麦克风访问失败:', err);
    }
}

function float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
}

const audioQueue = [];
let isPlaying = false;

function playAudio(base64Chunk) {
    audioQueue.push(base64Chunk);
    if (!isPlaying) processAudioQueue();
}

async function processAudioQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }
    isPlaying = true;

    const chunk = audioQueue.shift();
    const binaryStr = atob(chunk);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }

    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => processAudioQueue();
    source.start();
}

function disconnect() {
    if (ws) ws.close();
    stopAudioCapture();
}

function stopAudioCapture() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
}
</script>
```

## 踩坑记录

### 1. PCM 格式问题

OpenAI Realtime API 要求 **PCM16 LE, 24kHz, 单声道**。最常见的坑：

```php
// ❌ 错误：直接 base64 编码整个文件
$audio = base64_encode(file_get_contents('recording.wav'));

// ✅ 正确：确保采样率和格式
$audio = base64_encode($pcm16Data); // 已经是 PCM16 LE 格式
```

前端录制时，如果 `getUserMedia` 返回 44.1kHz，需要重采样：

```javascript
// 重采样到 24kHz
const resampled = new Float32Array(
    Math.floor(inputData.length * 24000 / audioContext.sampleRate)
);
for (let i = 0; i < resampled.length; i++) {
    resampled[i] = inputData[Math.floor(i * audioContext.sampleRate / 24000)];
}
```

### 2. Ephemeral Token 过期

Token 有效期 600 秒，过期后 WebSocket 会断开。需要实现自动续期：

```php
// 定时刷新（在 Token 过期前 60 秒）
$expiresAt = now()->addSeconds(540); // 540s = 9min
```

### 3. Turn Detection 配置

`server_vad` 的阈值太低会导致误触发，太高会导致用户等太久：

```php
'turn_detection' => [
    'type' => 'server_vad',
    'threshold' => 0.5,        // 推荐 0.5-0.7
    'prefix_padding_ms' => 300, // 语音前缓冲
    'silence_duration_ms' => 500, // 静默判定时长
],
```

### 4. 成本控制

Realtime API 按分钟计费（$0.06/分钟输入，$0.24/分钟输出），需要设置会话超时：

```php
// 服务端强制断开长时间会话
schedule()->call(function () {
    $expiredSessions = Cache::tags('realtime_sessions')
        ->where('expires_at', '<', now())
        ->get();

    foreach ($expiredSessions as $session) {
        $this->session->deleteSession($session->id);
        Cache::tags('realtime_sessions')->forget($session->id);
    }
})->everyMinute();
```

### 5. PHP 的 WebSocket 限制

PHP 原生不擅长长连接。生产环境推荐：

```nginx
# nginx 配置 WebSocket
location /ws/realtime {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

更优方案是用 **Swoole 或 RoadRunner** 运行 Laravel，原生支持 WebSocket：

```php
// config/websockets.php (Laravel WebSockets)
'apps' => [
    [
        'id' => 'realtime',
        'name' => 'Realtime API Proxy',
        'host' => null,
        'port' => 6001,
        'max_conns_per_ip' => 5,
        'allowed_origins' => ['*'],
    ],
],
```

### 6. 错误处理

Realtime WebSocket 会发送 `error` 事件，必须处理：

```php
case 'error':
    Log::error('OpenAI Realtime error', [
        'session_id' => $this->sessionId,
        'error' => $event['error'],
    ]);
    // 根据错误类型决定是否重连
    if (str_contains($event['error']['message'] ?? '', 'rate_limit')) {
        $this->scheduleReconnect(5);
    }
    break;
```

## 总结

OpenAI Realtime API 的核心价值在于把延迟从秒级拉到毫秒级，让语音 AI 真正具备"对话感"。Laravel 在其中的角色是：

1. **会话管理**：创建、配置、销毁 Realtime 会话
2. **Token 分发**：生成 Ephemeral Token 供前端直连
3. **音频中转**（可选）：需要服务端干预时做 WebSocket 代理
4. **成本控制**：会话超时、限流、监控

架构上推荐前端直连 OpenAI + Laravel 做后端管理的模式，避免 PHP 成为音频流瓶颈。如果必须走服务端代理，考虑用 Swoole/Revolt 替代传统 FPM。

实际部署时，先用小规模测试（1-2 个并发会话），观察 token 消耗和延迟，再逐步放量。语音 AI 的成本比文本高一个数量级，务必做好限流。

---

**相关文章：**
- [Laravel + OpenAI Function Calling 实战：让 AI 自主调用你的 API](/2026/05/28/laravel-openai-function-calling/)
- [Laravel + Anthropic Claude 实战：PHP 后端接入 Claude API](/2026/06/01/laravel-anthropic-claude-api/)
- [Laravel WebSocket 全栈实时应用：从广播到双向通信](/2026/05/15/laravel-websocket-realtime/)
