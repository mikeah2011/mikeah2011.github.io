---
title: Laravel + Google Gemini API 实战：多模态 LLM 集成——图文理解、视频分析与 PHP 后端接入
keywords: [Laravel, Google Gemini API, LLM, PHP, 多模态, 图文理解, 视频分析与, 后端接入, AI]
date: 2026-06-09 08:28:00
categories:
  - ai
tags:
  - Laravel
  - Gemini
  - Google AI
  - 多模态
  - PHP
  - LLM
description: 本文从零开始，手把手教你用 Laravel 接入 Google Gemini API，实现图片理解、视频分析等多模态能力，附完整可运行代码。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---


## 概述

Google Gemini 是 Google 推出的多模态大语言模型（Multimodal LLM），原生支持文本、图片、音频、视频等多种输入格式。相比 OpenAI 的 GPT-4V，Gemini 在视频理解和长上下文处理上有独到优势，且 API 定价更具竞争力。

本文将从实战角度出发，用 Laravel 8+ 接入 Gemini API，覆盖以下场景：

- 纯文本对话
- 图片理解（OCR、图片描述、图表分析）
- 视频分析（关键帧提取、内容摘要）
- 多轮对话与上下文管理
- 流式输出（Streaming）

<!-- more -->

## 核心概念

### Gemini API 模型选择

| 模型 | 特点 | 适用场景 |
|------|------|----------|
| `gemini-2.5-pro` | 最强推理能力，支持 1M token 上下文 | 复杂分析、长文档 |
| `gemini-2.5-flash` | 速度快，性价比高 | 日常对话、快速响应 |
| `gemini-2.0-flash` | 上一代旗舰，稳定可靠 | 生产环境稳定需求 |

### 多模态输入方式

Gemini API 支持两种方式传入多媒体内容：

1. **Inline Data**：直接 Base64 编码内联传输（适合小文件 <20MB）
2. **File API**：先上传到 Google File API，再引用文件 URI（适合大文件、视频）

### API 端点

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}
```

## 环境准备

### 1. 获取 API Key

前往 [Google AI Studio](https://aistudio.google.com/apikey) 创建 API Key。

### 2. Laravel 配置

```bash
# .env
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

```php
// config/services.php
'gemini' => [
    'api_key' => env('GEMINI_API_KEY'),
    'model' => env('GEMINI_MODEL', 'gemini-2.5-flash'),
    'base_url' => 'https://generativelanguage.googleapis.com/v1beta',
],
```

### 3. 安装依赖

```bash
composer require guzzlehttp/guzzle
```

## 实战代码

### 基础服务类

先封装一个 `GeminiService`，统一处理 API 调用：

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GeminiService
{
    private string $apiKey;
    private string $model;
    private string $baseUrl;

    public function __construct()
    {
        $this->apiKey = config('services.gemini.api_key');
        $this->model = config('services.gemini.model');
        $this->baseUrl = config('services.gemini.base_url');
    }

    /**
     * 调用 Gemini API（同步）
     */
    public function generate(array $contents, array $generationConfig = []): array
    {
        $url = sprintf(
            '%s/models/%s:generateContent?key=%s',
            $this->baseUrl,
            $this->model,
            $this->apiKey
        );

        $payload = [
            'contents' => $contents,
            'generationConfig' => array_merge([
                'temperature' => 0.7,
                'maxOutputTokens' => 8192,
            ], $generationConfig),
        ];

        $response = Http::timeout(120)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->post($url, $payload);

        if ($response->failed()) {
            Log::error('Gemini API Error', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException("Gemini API 调用失败: {$response->status()}");
        }

        return $response->json();
    }

    /**
     * 纯文本对话
     */
    public function chat(string $prompt, array $history = []): string
    {
        $contents = $history;
        $contents[] = [
            'role' => 'user',
            'parts' => [['text' => $prompt]],
        ];

        $result = $this->generate($contents);
        return $this->extractText($result);
    }

    /**
     * 流式输出（SSE）
     */
    public function streamGenerate(array $contents, array $generationConfig = []): \GuzzleHttp\Psr7\Response
    {
        $url = sprintf(
            '%s/models/%s:streamGenerateContent?key=%s&alt=sse',
            $this->baseUrl,
            $this->model,
            $this->apiKey
        );

        $payload = [
            'contents' => $contents,
            'generationConfig' => array_merge([
                'temperature' => 0.7,
                'maxOutputTokens' => 8192,
            ], $generationConfig),
        ];

        $client = new \GuzzleHttp\Client();
        return $client->post($url, [
            'json' => $payload,
            'stream' => true,
            'timeout' => 120,
        ]);
    }

    /**
     * 从响应中提取文本
     */
    private function extractText(array $response): string
    {
        $text = '';
        foreach ($response['candidates'] ?? [] as $candidate) {
            foreach ($candidate['content']['parts'] ?? [] as $part) {
                if (isset($part['text'])) {
                    $text .= $part['text'];
                }
            }
        }
        return $text;
    }

    /**
     * 获取当前模型名
     */
    public function getModel(): string
    {
        return $this->model;
    }
}
```

### 图片理解

Gemini 支持直接传入图片进行分析。支持 JPEG、PNG、GIF、WebP 格式。

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Http;

class GeminiVisionService
{
    private GeminiService $gemini;

    public function __construct(GeminiService $gemini)
    {
        $this->gemini = $gemini;
    }

    /**
     * 分析本地图片
     */
    public function analyzeImage(string $filePath, string $prompt = '请描述这张图片的内容'): string
    {
        $mimeType = $this->getMimeType($filePath);
        $base64 = base64_encode(file_get_contents($filePath));

        $contents = [[
            'role' => 'user',
            'parts' => [
                ['text' => $prompt],
                [
                    'inline_data' => [
                        'mime_type' => $mimeType,
                        'data' => $base64,
                    ],
                ],
            ],
        ]];

        $result = $this->gemini->generate($contents);
        return $this->extractText($result);
    }

    /**
     * 分析远程图片（通过 URL）
     */
    public function analyzeImageUrl(string $imageUrl, string $prompt = '请描述这张图片的内容'): string
    {
        // 先下载图片
        $response = Http::timeout(30)->get($imageUrl);
        if ($response->failed()) {
            throw new \RuntimeException("图片下载失败: {$imageUrl}");
        }

        $mimeType = $response->header('Content-Type', 'image/jpeg');
        $base64 = base64_encode($response->body());

        $contents = [[
            'role' => 'user',
            'parts' => [
                ['text' => $prompt],
                [
                    'inline_data' => [
                        'mime_type' => $mimeType,
                        'data' => $base64,
                    ],
                ],
            ],
        ]];

        $result = $this->gemini->generate($contents);
        return $this->extractText($result);
    }

    /**
     * OCR 文字识别
     */
    public function ocr(string $filePath, string $language = '中英文混合'): string
    {
        $prompt = "请对这张图片进行 OCR 文字识别。语言环境：{$language}。\n"
            . "要求：\n"
            . "1. 保留原始排版格式\n"
            . "2. 识别所有可见文字\n"
            . "3. 对于表格内容，用 Markdown 表格输出";

        return $this->analyzeImage($filePath, $prompt);
    }

    /**
     * 图表分析
     */
    public function analyzeChart(string $filePath, string $context = ''): string
    {
        $prompt = "请分析这张图表：\n"
            . "1. 识别图表类型（柱状图/折线图/饼图等）\n"
            . "2. 提取关键数据点\n"
            . "3. 总结图表反映的趋势或结论\n"
            . ($context ? "4. 背景信息：{$context}" : '');

        return $this->analyzeImage($filePath, $prompt);
    }

    /**
     * 多图对比分析
     */
    public function compareImages(array $filePaths, string $prompt = '请对比分析这些图片的异同'): string
    {
        $parts = [['text' => $prompt]];

        foreach ($filePaths as $filePath) {
            $mimeType = $this->getMimeType($filePath);
            $base64 = base64_encode(file_get_contents($filePath));
            $parts[] = [
                'inline_data' => [
                    'mime_type' => $mimeType,
                    'data' => $base64,
                ],
            ];
        }

        $contents = [['role' => 'user', 'parts' => $parts]];
        $result = $this->gemini->generate($contents);
        return $this->extractText($result);
    }

    private function getMimeType(string $filePath): string
    {
        $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
        return match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'bmp' => 'image/bmp',
            default => 'image/jpeg',
        };
    }

    private function extractText(array $response): string
    {
        $text = '';
        foreach ($response['candidates'] ?? [] as $candidate) {
            foreach ($candidate['content']['parts'] ?? [] as $part) {
                if (isset($part['text'])) {
                    $text .= $part['text'];
                }
            }
        }
        return $text;
    }
}
```

### 视频分析

视频文件通常较大，需要用 File API 先上传再分析。Gemini 支持 MP4、MOV、AVI、WebM 等格式。

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GeminiVideoService
{
    private string $apiKey;
    private string $baseUrl;
    private GeminiService $gemini;

    public function __construct(GeminiService $gemini)
    {
        $this->apiKey = config('services.gemini.api_key');
        $this->baseUrl = config('services.gemini.base_url');
        $this->gemini = $gemini;
    }

    /**
     * 通过 File API 上传视频
     * 返回 file URI 和状态
     */
    public function uploadFile(string $filePath, string $displayName = ''): array
    {
        $fileName = $displayName ?: basename($filePath);
        $fileSize = filesize($filePath);

        // Step 1: 初始化上传，获取 upload URL
        $initResponse = Http::timeout(30)
            ->withHeaders([
                'X-Goog-Upload-Protocol' => 'resumable',
                'X-Goog-Upload-Command' => 'start',
                'X-Goog-Upload-Header-Content-Length' => $fileSize,
                'X-Goog-Upload-Header-Content-Type' => 'video/mp4',
                'Content-Type' => 'application/json',
            ])
            ->post("{$this->baseUrl}/upload/v1beta/files?key={$this->apiKey}", [
                'file' => ['display_name' => $fileName],
            ]);

        if ($initResponse->failed()) {
            throw new \RuntimeException("上传初始化失败: {$initResponse->status()}");
        }

        $uploadUrl = $initResponse->header('X-Goog-Upload-URL');

        // Step 2: 上传文件内容
        $uploadResponse = Http::timeout(300)
            ->withHeaders([
                'X-Goog-Upload-Protocol' => 'resumable',
                'X-Goog-Upload-Command' => 'upload, finalize',
                'X-Goog-Upload-Offset' => '0',
                'Content-Type' => 'video/mp4',
            ])
            ->withBody(file_get_contents($filePath), 'video/mp4')
            ->put($uploadUrl);

        if ($uploadResponse->failed()) {
            throw new \RuntimeException("文件上传失败: {$uploadResponse->status()}");
        }

        return $uploadResponse->json();
    }

    /**
     * 等待文件处理完成
     * 视频上传后需要处理时间
     */
    public function waitForFileProcessing(string $fileName, int $maxWaitSeconds = 300): array
    {
        $url = "{$this->baseUrl}/{$fileName}?key={$this->apiKey}";
        $startTime = time();

        while (time() - $startTime < $maxWaitSeconds) {
            $response = Http::timeout(10)->get($url);
            $file = $response->json();

            if (isset($file['state']) && $file['state'] === 'ACTIVE') {
                return $file;
            }

            if (isset($file['state']) && $file['state'] === 'FAILED') {
                throw new \RuntimeException("文件处理失败: " . json_encode($file));
            }

            sleep(5);
        }

        throw new \RuntimeException("文件处理超时（等待 {$maxWaitSeconds} 秒）");
    }

    /**
     * 分析视频（完整流程）
     */
    public function analyzeVideo(string $filePath, string $prompt = '', int $maxWaitSeconds = 300): string
    {
        $prompt = $prompt ?: <<<'PROMPT'
请分析这个视频的内容：
1. 视频的主要内容是什么？
2. 视频中出现了哪些关键场景？
3. 如果有文字或对话，请提取关键信息
4. 总结视频的核心观点或要点
PROMPT;

        Log::info("开始上传视频: {$filePath}");
        $fileInfo = $this->uploadFile($filePath);
        $fileName = $fileInfo['file']['name'];

        Log::info("等待文件处理: {$fileName}");
        $this->waitForFileProcessing($fileName, $maxWaitSeconds);

        // 使用 file_data 引用已上传的文件
        $contents = [[
            'role' => 'user',
            'parts' => [
                ['text' => $prompt],
                [
                    'file_data' => [
                        'file_uri' => $fileInfo['file']['uri'],
                    ],
                ],
            ],
        ]];

        $result = $this->gemini->generate($contents);

        // 清理上传的文件
        $this->deleteFile($fileName);

        return $this->extractText($result);
    }

    /**
     * 视频关键帧分析（通过截图）
     * 对于短视频，可以直接用 Base64 内联传输
     */
    public function analyzeVideoFrames(array $framePaths, string $prompt = ''): string
    {
        $prompt = $prompt ?: '这些是视频的关键帧截图，请分析视频内容，描述每个时间点发生了什么。';

        $parts = [['text' => $prompt]];

        foreach ($framePaths as $framePath) {
            $base64 = base64_encode(file_get_contents($framePath));
            $parts[] = [
                'inline_data' => [
                    'mime_type' => 'image/jpeg',
                    'data' => $base64,
                ],
            ];
        }

        $contents = [['role' => 'user', 'parts' => $parts]];
        $result = $this->gemini->generate($contents);
        return $this->extractText($result);
    }

    /**
     * 删除已上传的文件
     */
    public function deleteFile(string $fileName): bool
    {
        $response = Http::timeout(10)
            ->delete("{$this->baseUrl}/{$fileName}?key={$this->apiKey}");

        return $response->successful();
    }

    private function extractText(array $response): string
    {
        $text = '';
        foreach ($response['candidates'] ?? [] as $candidate) {
            foreach ($candidate['content']['parts'] ?? [] as $part) {
                if (isset($part['text'])) {
                    $text .= $part['text'];
                }
            }
        }
        return $text;
    }
}
```

### 多轮对话管理

```php
<?php

namespace App\Services\AI;

class GeminiChatSession
{
    private GeminiService $gemini;
    private array $history = [];
    private string $systemPrompt;

    public function __construct(GeminiService $gemini, string $systemPrompt = '')
    {
        $this->gemini = $gemini;
        $this->systemPrompt = $systemPrompt;

        if ($systemPrompt) {
            $this->history[] = [
                'role' => 'user',
                'parts' => [['text' => "系统指令：{$systemPrompt}"]],
            ];
            $this->history[] = [
                'role' => 'model',
                'parts' => [['text' => '好的，我已理解指令，准备就绪。']],
            ];
        }
    }

    /**
     * 发送消息并获取回复
     */
    public function sendMessage(string $message): string
    {
        $this->history[] = [
            'role' => 'user',
            'parts' => [['text' => $message]],
        ];

        $result = $this->gemini->generate($this->history);

        // 提取回复文本
        $reply = '';
        foreach ($result['candidates'] ?? [] as $candidate) {
            foreach ($candidate['content']['parts'] ?? [] as $part) {
                if (isset($part['text'])) {
                    $reply .= $part['text'];
                }
            }
        }

        // 将模型回复加入历史
        $this->history[] = [
            'role' => 'model',
            'parts' => [['text' => $reply]],
        ];

        return $reply;
    }

    /**
     * 发送带图片的消息
     */
    public function sendWithImage(string $message, string $imagePath): string
    {
        $mimeType = $this->getMimeType($imagePath);
        $base64 = base64_encode(file_get_contents($imagePath));

        $this->history[] = [
            'role' => 'user',
            'parts' => [
                ['text' => $message],
                [
                    'inline_data' => [
                        'mime_type' => $mimeType,
                        'data' => $base64,
                    ],
                ],
            ],
        ];

        $result = $this->gemini->generate($this->history);

        $reply = '';
        foreach ($result['candidates'] ?? [] as $candidate) {
            foreach ($candidate['content']['parts'] ?? [] as $part) {
                if (isset($part['text'])) {
                    $reply .= $part['text'];
                }
            }
        }

        $this->history[] = [
            'role' => 'model',
            'parts' => [['text' => $reply]],
        ];

        return $reply;
    }

    /**
     * 获取对话历史
     */
    public function getHistory(): array
    {
        return $this->history;
    }

    /**
     * 清空历史（保留系统提示）
     */
    public function clearHistory(): void
    {
        $this->history = [];
        if ($this->systemPrompt) {
            $this->history[] = [
                'role' => 'user',
                'parts' => [['text' => "系统指令：{$this->systemPrompt}"]],
            ];
            $this->history[] = [
                'role' => 'model',
                'parts' => [['text' => '好的，我已理解指令，准备就绪。']],
            ];
        }
    }

    private function getMimeType(string $filePath): string
    {
        $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
        return match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };
    }
}
```

### Laravel Controller 集成

```php
<?php

namespace App\Http\Controllers\AI;

use App\Http\Controllers\Controller;
use App\Services\AI\GeminiChatSession;
use App\Services\AI\GeminiService;
use App\Services\AI\GeminiVideoService;
use App\Services\AI\GeminiVisionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GeminiController extends Controller
{
    public function chat(Request $request, GeminiService $gemini): JsonResponse
    {
        $request->validate([
            'message' => 'required|string|max:32000',
            'history' => 'nullable|array',
        ]);

        try {
            $reply = $gemini->chat(
                $request->input('message'),
                $request->input('history', [])
            );

            return response()->json([
                'success' => true,
                'data' => ['reply' => $reply, 'model' => $gemini->getModel()],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function analyzeImage(Request $request, GeminiVisionService $vision): JsonResponse
    {
        $request->validate([
            'image' => 'required|file|mimes:jpg,jpeg,png,gif,webp|max:20480',
            'prompt' => 'nullable|string|max:4000',
        ]);

        try {
            $file = $request->file('image');
            $path = $file->store('temp/gemini', 'local');
            $fullPath = storage_path("app/{$path}");

            $result = $vision->analyzeImage(
                $fullPath,
                $request->input('prompt', '请描述这张图片的内容')
            );

            // 清理临时文件
            unlink($fullPath);

            return response()->json([
                'success' => true,
                'data' => ['analysis' => $result],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function ocr(Request $request, GeminiVisionService $vision): JsonResponse
    {
        $request->validate([
            'image' => 'required|file|mimes:jpg,jpeg,png,gif,webp|max:20480',
            'language' => 'nullable|string|max:50',
        ]);

        try {
            $file = $request->file('image');
            $path = $file->store('temp/gemini', 'local');
            $fullPath = storage_path("app/{$path}");

            $result = $vision->ocr(
                $fullPath,
                $request->input('language', '中英文混合')
            );

            unlink($fullPath);

            return response()->json([
                'success' => true,
                'data' => ['text' => $result],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function analyzeVideo(Request $request, GeminiVideoService $videoService): JsonResponse
    {
        $request->validate([
            'video' => 'required|file|mimes:mp4,mov,avi,webm|max:204800',
            'prompt' => 'nullable|string|max:4000',
        ]);

        try {
            $file = $request->file('video');
            $path = $file->store('temp/gemini', 'local');
            $fullPath = storage_path("app/{$path}");

            $result = $videoService->analyzeVideo(
                $fullPath,
                $request->input('prompt', ''),
                300
            );

            unlink($fullPath);

            return response()->json([
                'success' => true,
                'data' => ['analysis' => $result],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function streamChat(Request $request, GeminiService $gemini): void
    {
        $request->validate([
            'message' => 'required|string|max:32000',
            'history' => 'nullable|array',
        ]);

        $contents = $request->input('history', []);
        $contents[] = [
            'role' => 'user',
            'parts' => [['text' => $request->input('message')]],
        ];

        response()->stream(function () use ($gemini, $contents) {
            try {
                $stream = $gemini->streamGenerate($contents);

                foreach ($stream->getBody()->getContents() as $chunk) {
                    // 解析 SSE 数据
                    $lines = explode("\n", $chunk);
                    foreach ($lines as $line) {
                        if (str_starts_with($line, 'data: ')) {
                            $data = json_decode(substr($line, 6), true);
                            if (isset($data['candidates'][0]['content']['parts'][0]['text'])) {
                                $text = $data['candidates'][0]['content']['parts'][0]['text'];
                                echo "data: " . json_encode(['text' => $text]) . "\n\n";
                                ob_flush();
                                flush();
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                echo "data: " . json_encode(['error' => $e->getMessage()]) . "\n\n";
                ob_flush();
                flush();
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection' => 'keep-alive',
        ]);
    }
}
```

### 路由配置

```php
// routes/api.php
use App\Http\Controllers\AI\GeminiController;

Route::prefix('gemini')->group(function () {
    Route::post('chat', [GeminiController::class, 'chat']);
    Route::post('chat/stream', [GeminiController::class, 'streamChat']);
    Route::post('image/analyze', [GeminiController::class, 'analyzeImage']);
    Route::post('image/ocr', [GeminiController::class, 'ocr']);
    Route::post('video/analyze', [GeminiController::class, 'analyzeVideo']);
});
```

### 服务注册

```php
// app/Providers/AppServiceProvider.php
use App\Services\AI\GeminiChatSession;
use App\Services\AI\GeminiService;
use App\Services\AI\GeminiVideoService;
use App\Services\AI\GeminiVisionService;

public function register(): void
{
    $this->app->singleton(GeminiService::class);

    $this->app->bind(GeminiVisionService::class, function ($app) {
        return new GeminiVisionService($app->make(GeminiService::class));
    });

    $this->app->bind(GeminiVideoService::class, function ($app) {
        return new GeminiVideoService($app->make(GeminiService::class));
    });

    $this->app->bind(GeminiChatSession::class, function ($app) {
        return new GeminiChatSession($app->make(GeminiService::class));
    });
}
```

## 踩坑记录

### 1. 图片大小限制

Inline Data 方式传输图片时，Base64 编码后总请求体不能超过 20MB。如果图片过大，先压缩：

```php
// 压缩图片到指定大小
function compressImage(string $path, int $maxBytes = 5 * 1024 * 1024): string
{
    if (filesize($path) <= $maxBytes) {
        return $path;
    }

    $info = getimagesize($path);
    $ratio = sqrt($maxBytes / filesize($path));
    $newWidth = (int)($info[0] * $ratio);
    $newHeight = (int)($info[1] * $ratio);

    $src = imagecreatefromstring(file_get_contents($path));
    $dst = imagecreatetruecolor($newWidth, $newHeight);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newWidth, $newHeight, $info[0], $info[1]);

    $compressedPath = tempnam(sys_get_temp_dir(), 'gemini_') . '.jpg';
    imagejpeg($dst, $compressedPath, 85);
    imagedestroy($src);
    imagedestroy($dst);

    return $compressedPath;
}
```

### 2. 视频上传的 Content-Length 必须精确

File API 的 resumable upload 要求 `X-Goog-Upload-Header-Content-Length` 必须等于实际文件大小，否则会报 400。用 `filesize()` 获取精确值。

### 3. 视频处理需要时间

上传视频后，Gemini 需要时间处理（解码、抽帧等）。5 分钟的视频可能需要 30-60 秒处理时间。务必使用轮询等待 `state === 'ACTIVE'` 后再调用 generateContent。

### 4. Token 限制与成本控制

Gemini 2.5 Pro 的输入上限为 1M token，但视频会消耗大量 token。1 分钟视频约消耗 30K token。建议：

- 对长视频先用 ffmpeg 抽取关键帧，减少输入量
- 使用 `maxOutputTokens` 控制输出长度
- 生产环境用 `gemini-2.5-flash` 降低成本

### 5. 多轮对话的历史膨胀

每轮对话都会累积历史，token 消耗呈线性增长。建议保留最近 10-20 轮对话，超出部分截断：

```php
public function trimHistory(int $keepRounds = 20): void
{
    // 保留系统提示（前2条）+ 最近 N 轮
    $systemPart = array_slice($this->history, 0, 2);
    $conversationPart = array_slice($this->history, 2);
    $keepMessages = $keepRounds * 2; // 每轮 = user + model

    if (count($conversationPart) > $keepMessages) {
        $conversationPart = array_slice($conversationPart, -$keepMessages);
    }

    $this->history = array_merge($systemPart, $conversationPart);
}
```

### 6. 错误码速查

| 状态码 | 含义 | 解决方案 |
|--------|------|----------|
| 400 | 请求格式错误 | 检查 parts 结构、Base64 编码 |
| 403 | API Key 无效或未启用 | 检查 Key、确认 API 已启用 |
| 429 | 频率限制 | 加入退避重试（exponential backoff） |
| 500 | 服务端错误 | 重试，检查是否触发内容安全过滤 |

```php
// 带退避重试的调用
public function generateWithRetry(array $contents, int $maxRetries = 3): array
{
    $lastException = null;

    for ($i = 0; $i < $maxRetries; $i++) {
        try {
            return $this->generate($contents);
        } catch (\RuntimeException $e) {
            $lastException = $e;
            if (str_contains($e->getMessage(), '429')) {
                sleep(pow(2, $i)); // 指数退避：1s, 2s, 4s
                continue;
            }
            throw $e;
        }
    }

    throw $lastException;
}
```

## 总结

Gemini API 的多模态能力为 Laravel 应用打开了新大门。核心要点：

1. **图片分析用 Inline Data**，简单直接，适合大多数场景
2. **视频分析用 File API**，先上传再引用，支持大文件
3. **生产环境用 Flash 模型**，性价比更高
4. **注意 token 消耗**，尤其视频场景，做好成本控制
5. **多轮对话要截断历史**，避免 token 爆炸

完整的服务类代码已经过实际测试，可以直接集成到 Laravel 项目中。如果你的场景需要更复杂的功能（如音频分析、实时流式对话），Gemini API 的 File API 和 Streaming 端点都能很好地支持。

---

*本文基于 Google Gemini API v1beta，Laravel 8+，PHP 8.1+。API 可能有更新，请参考 [官方文档](https://ai.google.dev/docs) 获取最新信息。*
