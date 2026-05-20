---
title: "Apple Pay PassGenerator PKPass 实战：如何生成 Wallet Passes 与 iOS/Android 兼容性踩坑记录"
date: 2026-05-05 02:35:25
updated: 2026-05-05 02:38:07
categories:
  - PHP
  - Laravel
  - Apple Pay
tags: [Laravel, uni-app, 支付]description: "在 KKday B2C 项目中实现电子票券 Wallet Pass 生成的完整实战：PKPass 文件格式解析、Apple Developer 证书配置、Laravel 后端集成、签名校验流程，以及 iOS 与 Android 的兼容性差异踩坑记录。"
---

# Apple Pay PassGenerator PKPass 实战：如何生成 Wallet Passes 与 iOS/Android 兼容性踩坑记录

## 前言

在旅游电商场景中，用户下单后需要将「电子票券」推送到手机 Wallet（Apple Wallet / Google Pay）。这看似简单的功能，实际涉及 Apple PKPass 文件格式、证书签名链、MIME 类型、推送通知等一系列细节。

本文记录了在 KKday B2C API 项目中，用 Laravel 实现 PKPass 生成的完整流程，包括证书申请、文件结构、签名校验，以及 iOS 与 Android 的兼容性踩坑经验。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户下单流程                              │
│                                                                 │
│  用户下单 ──▶ 订单服务 ──▶ 票券服务 ──▶ PKPass 生成服务          │
│                                              │                  │
│                                              ▼                  │
│                                    ┌─────────────────┐          │
│                                    │  PKPass 文件构建  │          │
│                                    │  ┌─────────────┐ │          │
│                                    │  │ pass.json   │ │          │
│                                    │  │ manifest.json│ │          │
│                                    │  │ signature   │ │          │
│                                    │  │ images/     │ │          │
│                                    │  └─────────────┘ │          │
│                                    └────────┬────────┘          │
│                                             │                   │
│                              ┌──────────────┼──────────────┐    │
│                              ▼              ▼              ▼    │
│                         iOS Wallet    Google Pay      直接下载  │
│                         (APNs推送)    (Save to Pay)   (.pkpass) │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Apple Developer Portal 配置（最容易踩坑的一步）

### 1.1 创建 Pass Type ID

在 [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list/passTypeId) 创建 Pass Type ID：

```
格式：pass.com.yourcompany.yourapp.ticket
示例：pass.com.kkday.b2c.eTicket
```

**踩坑记录**：Pass Type ID 必须以 `pass.` 开头，不是 `com.`。很多教程写错了。

### 1.2 生成证书

需要两个证书：

| 证书 | 用途 | 有效期 |
|------|------|--------|
| Pass Type ID Certificate | 签名 .pkpass 文件 | 1 年 |
| WWDR Intermediate Certificate | 证书链验证（根证书） | 到 2030 年 |

证书生成步骤：

```bash
# 1. 从 Apple Developer 下载 .cer 文件
# 2. 导入 Keychain Access
# 3. 导出为 .p12（私钥 + 证书）
# 4. 将 WWDR G4 中间证书也导入并导出

# 从 .p12 提取私钥（PKPass 库需要 PEM 格式）
openssl pkcs12 -in Certificates.p12 -nocerts -out private_key.pem -nodes

# 从 .p12 提取证书
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out certificate.pem
```

**踩坑记录**：Apple 于 2023 年更新了 WWDR 中间证书，从 G1 切换到 G4。如果你的代码还在用旧的 WWDR 证书，签出的 .pkpass 会安装失败但无任何错误提示（非常坑）。务必确认使用 `AppleWWDRCAG4.cer`。

---

## 2. PKPass 文件格式解析

一个 `.pkpass` 文件本质是一个 ZIP 压缩包，解压后结构如下：

```
ticket.pkpass (ZIP)
├── pass.json           # 核心配置（必须）
├── manifest.json       # 所有文件的 SHA1 哈希（必须）
├── signature           # CMS PKCS#7 签名（必须）
├── icon.png            # 图标 29x29（必须）
├── icon@2x.png         # 图标 58x58（推荐）
├── logo.png            # Logo（推荐）
├── logo@2x.png
├── thumbnail.png       # 缩略图（可选）
├── strip.png           # 条带图片（可选）
├── background.png      # 背景图（可选）
└── en.lproj/           # 国际化目录（可选）
    └── pass.strings
```

### 2.1 pass.json 核心字段

```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.com.kkday.b2c.eTicket",
  "serialNumber": "KKD-20260505-000123",
  "teamIdentifier": "AB12CD34EF",
  "organizationName": "KKday",
  "description": "KKday 景點門票",
  "logoText": "KKday",
  "foregroundColor": "rgb(255, 255, 255)",
  "backgroundColor": "rgb(58, 182, 160)",
  "eventTicket": {
    "headerFields": [
      {
        "key": "date",
        "label": "日期",
        "value": "2026/05/10"
      }
    ],
    "primaryFields": [
      {
        "key": "venue",
        "label": "景點",
        "value": "東京迪士尼樂園"
      }
    ],
    "secondaryFields": [
      {
        "key": "ticketType",
        "label": "票種",
        "value": "一日券"
      },
      {
        "key": "qty",
        "label": "數量",
        "value": "2"
      }
    ],
    "auxiliaryFields": [
      {
        "key": "orderId",
        "label": "訂單號",
        "value": "KKD20260505001"
      }
    ],
    "barcode": {
      "message": "KKD20260505001-TKT-001",
      "format": "PKBarcodeFormatQR",
      "messageEncoding": "iso-8859-1"
    }
  },
  "barcode": {
    "message": "KKD20260505001-TKT-001",
    "format": "PKBarcodeFormatQR",
    "messageEncoding": "iso-8859-1"
  }
}
```

**踩坑记录**：`pass.json` 中有两处 `barcode` 定义——顶层和 `eventTicket` 内部都需要。某些 iOS 版本只读顶层，某些只读内部。为了兼容性，两边都写。

### 2.2 manifest.json

```json
{
  "pass.json": "a]1b2c3d4e5f6...",
  "icon.png": "b2c3d4e5f6g7...",
  "icon@2x.png": "c3d4e5f6g7h8...",
  "logo.png": "d4e5f6g7h8i9..."
}
```

每个文件对应其内容的 SHA-1 哈希值。注意是 SHA-1，不是 SHA-256。

---

## 3. Laravel 实现

### 3.1 安装依赖

```bash
# 推荐使用 pkpass/pkpass 库
composer require pkpass/pkpass

# 或者使用 rawsalt/laravel-pkpass
composer require rawsalt/laravel-pkpass
```

### 3.2 核心 Service 实现

```php
<?php

declare(strict_types=1);

namespace App\Services\PassKit;

use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;

/**
 * Apple Wallet PKPass 生成服务
 * 
 * 负责将订单票券数据转换为 .pkpass 文件
 * 支持 eventTicket、boardingPass、coupon 等 pass 类型
 */
class PKPassGenerator
{
    private string $passTypeIdentifier;
    private string $teamIdentifier;
    private string $certPath;
    private string $keyPath;
    private string $wwdrPath;
    private string $certPassword;

    public function __construct()
    {
        $this->passTypeIdentifier = config('services.apple_pass.pass_type_id');
        $this->teamIdentifier = config('services.apple_pass.team_id');
        $this->certPath = config('services.apple_pass.cert_path');
        $this->keyPath = config('services.apple_pass.key_path');
        $this->wwdrPath = config('services.apple_pass.wwdr_path');
        $this->certPassword = config('services.apple_pass.cert_password');
    }

    /**
     * 生成 PKPass 文件并返回文件路径
     *
     * @param array $ticketData 票券数据
     * @param string $serialNumber 唯一序列号
     * @return string 生成的 .pkpass 文件路径
     */
    public function generate(array $ticketData, string $serialNumber): string
    {
        $passJson = $this->buildPassJson($ticketData, $serialNumber);
        $files = $this->collectPassFiles($passJson, $ticketData);

        // 构建 manifest（SHA-1 哈希）
        $manifest = $this->buildManifest($files);

        // 签名
        $signature = $this->signManifest($manifest);

        // 打包 ZIP
        $pkpassPath = $this->packagePass($files, $manifest, $signature, $serialNumber);

        return $pkpassPath;
    }

    /**
     * 构建 pass.json
     */
    private function buildPassJson(array $data, string $serialNumber): array
    {
        $barcodeMessage = $data['order_id'] . '-TKT-' . $serialNumber;

        return [
            'formatVersion' => 1,
            'passTypeIdentifier' => $this->passTypeIdentifier,
            'serialNumber' => $serialNumber,
            'teamIdentifier' => $this->teamIdentifier,
            'organizationName' => $data['organization'] ?? 'KKday',
            'description' => $data['description'] ?? '電子票券',
            'logoText' => $data['logo_text'] ?? 'KKday',
            'foregroundColor' => $data['foreground_color'] ?? 'rgb(255, 255, 255)',
            'backgroundColor' => $data['bg_color'] ?? 'rgb(58, 182, 160)',
            'eventTicket' => [
                'headerFields' => [
                    [
                        'key' => 'date',
                        'label' => '使用日期',
                        'value' => $data['use_date'],
                    ],
                ],
                'primaryFields' => [
                    [
                        'key' => 'venue',
                        'label' => $data['venue_label'] ?? '景點',
                        'value' => $data['venue_name'],
                    ],
                ],
                'secondaryFields' => [
                    [
                        'key' => 'ticket_type',
                        'label' => '票種',
                        'value' => $data['ticket_type'],
                    ],
                    [
                        'key' => 'quantity',
                        'label' => '數量',
                        'value' => (string) $data['quantity'],
                    ],
                ],
                'auxiliaryFields' => [
                    [
                        'key' => 'order_id',
                        'label' => '訂單號',
                        'value' => $data['order_id'],
                    ],
                ],
                'barcode' => [
                    'message' => $barcodeMessage,
                    'format' => 'PKBarcodeFormatQR',
                    'messageEncoding' => 'iso-8859-1',
                ],
            ],
            // 顶层 barcode（兼容不同 iOS 版本）
            'barcode' => [
                'message' => $barcodeMessage,
                'format' => 'PKBarcodeFormatQR',
                'messageEncoding' => 'iso-8859-1',
            ],
        ];
    }

    /**
     * 收集所有 Pass 文件（JSON + 图片）
     */
    private function collectPassFiles(array $passJson, array $data): array
    {
        $files = [];

        // pass.json
        $files['pass.json'] = json_encode($passJson, JSON_UNESCAPED_UNICODE);

        // 图片文件
        $imageDir = config('services.apple_pass.image_dir');
        $requiredImages = ['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png'];

        foreach ($requiredImages as $imageName) {
            $imagePath = $imageDir . '/' . $imageName;
            if (Storage::disk('local')->exists($imagePath)) {
                $files[$imageName] = Storage::disk('local')->get($imagePath);
            }
        }

        // 可选：条带图片
        if (!empty($data['strip_image_url'])) {
            $stripImage = $this->downloadAndResize($data['strip_image_url'], 375, 123);
            if ($stripImage) {
                $files['strip.png'] = $stripImage;
                $files['strip@2x.png'] = $this->downloadAndResize(
                    $data['strip_image_url'], 750, 246
                );
            }
        }

        return $files;
    }

    /**
     * 构建 manifest.json（SHA-1 哈希映射）
     */
    private function buildManifest(array $files): string
    {
        $manifest = [];
        foreach ($files as $filename => $content) {
            $manifest[$filename] = sha1($content);
        }

        return json_encode($manifest);
    }

    /**
     * PKCS#7 签名
     */
    private function signManifest(string $manifest): string
    {
        $tempManifest = tempnam(sys_get_temp_dir(), 'pkpass_manifest');
        $tempSignature = tempnam(sys_get_temp_dir(), 'pkpass_sig');

        file_put_contents($tempManifest, $manifest);

        // 读取证书和私钥
        $certContent = file_get_contents($this->certPath);
        $keyContent = file_get_contents($this->keyPath);
        $wwdrContent = file_get_contents($this->wwdrPath);

        // 使用 OpenSSL 签名
        $certs = [$certContent, $wwdrContent];

        $signed = openssl_pkcs7_sign(
            $tempManifest,
            $tempSignature,
            $certContent,
            [
                'file://' . $this->keyPath,
                $this->certPassword,
            ],
            [],
            PKCS7_BINARY | PKCS7_NOATTR,
            $this->wwdrPath
        );

        if (!$signed) {
            $error = openssl_error_string();
            throw new \RuntimeException("PKPass 签名失败: {$error}");
        }

        // 提取签名内容
        $signatureContent = file_get_contents($tempSignature);
        // 从 S/MIME 格式中提取纯签名
        $signature = $this->extractSignatureFromSMIME($signatureContent);

        @unlink($tempManifest);
        @unlink($tempSignature);

        return $signature;
    }

    /**
     * 从 S/MIME 输出中提取 PKCS#7 签名
     */
    private function extractSignatureFromSMIME(string $smime): string
    {
        $outputFile = tempnam(sys_get_temp_dir(), 'pkpass_pkcs7');
        $inputFile = tempnam(sys_get_temp_dir(), 'pkpass_input');
        file_put_contents($inputFile, $smime);

        // 使用 openssl cms 提取
        $cmd = sprintf(
            'openssl smime -sign -in %s -out %s -outform DER -inkey %s -signer %s -certfile %s 2>&1',
            escapeshellarg($inputFile),
            escapeshellarg($outputFile),
            escapeshellarg($this->keyPath),
            escapeshellarg($this->certPath),
            escapeshellarg($this->wwdrPath)
        );

        exec($cmd, $output, $returnCode);

        if ($returnCode !== 0) {
            // fallback: 直接读取
            $signature = file_get_contents($tempSignature ?? $outputFile);
        } else {
            $signature = file_get_contents($outputFile);
        }

        @unlink($inputFile);
        @unlink($outputFile);

        return $signature;
    }

    /**
     * 打包为 .pkpass (ZIP)
     */
    private function packagePass(
        array $files,
        string $manifest,
        string $signature,
        string $serialNumber
    ): string {
        $zipPath = storage_path("app/pkpass/{$serialNumber}.pkpass");

        // 确保目录存在
        $dir = dirname($zipPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $zip = new \ZipArchive();
        $result = $zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);

        if ($result !== true) {
            throw new \RuntimeException("无法创建 PKPass ZIP 文件: {$result}");
        }

        // 添加 pass.json、图片等文件
        foreach ($files as $filename => $content) {
            $zip->addFromString($filename, $content);
        }

        // 添加 manifest.json
        $zip->addFromString('manifest.json', $manifest);

        // 添加签名
        $zip->addFromString('signature', $signature);

        $zip->close();

        return $zipPath;
    }

    /**
     * 下载图片并调整尺寸
     */
    private function downloadAndResize(string $url, int $width, int $height): ?string
    {
        try {
            $response = \Http::timeout(10)->get($url);
            if ($response->successful()) {
                // 使用 Intervention Image 或直接返回原始图片
                return $response->body();
            }
        } catch (\Exception $e) {
            \Log::warning('PKPass 图片下载失败', [
                'url' => $url,
                'error' => $e->getMessage(),
            ]);
        }

        return null;
    }
}
```

### 3.3 配置文件

```php
// config/services.php 添加

'apple_pass' => [
    'pass_type_id' => env('APPLE_PASS_TYPE_ID', 'pass.com.kkday.b2c.eTicket'),
    'team_id' => env('APPLE_TEAM_ID', 'AB12CD34EF'),
    'cert_path' => env('APPLE_PASS_CERT_PATH', storage_path('certs/pass_cert.pem')),
    'key_path' => env('APPLE_PASS_KEY_PATH', storage_path('certs/pass_key.pem')),
    'wwdr_path' => env('APPLE_PASS_WWDR_PATH', storage_path('certs/wwdr_g4.pem')),
    'cert_password' => env('APPLE_PASS_CERT_PASSWORD', ''),
    'image_dir' => env('APPLE_PASS_IMAGE_DIR', 'pkpass/images'),
],
```

### 3.4 控制器与路由

```php
<?php

namespace App\Http\Controllers\PassKit;

use App\Http\Controllers\Controller;
use App\Services\PassKit\PKPassGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class PassKitController extends Controller
{
    public function __construct(
        private readonly PKPassGenerator $passGenerator
    ) {}

    /**
     * 生成并下载 .pkpass 文件
     */
    public function download(string $ticketId): Response
    {
        $ticket = $this->getTicketData($ticketId);
        $serialNumber = 'TKT-' . $ticketId;

        $pkpassPath = $this->passGenerator->generate($ticket, $serialNumber);

        return response()->file($pkpassPath, [
            'Content-Type' => 'application/vnd.apple.pkpass',
            'Content-Disposition' => 'inline; filename="ticket.pkpass"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }

    /**
     * PKPass Web Service - 获取最新版本（iOS Wallet 会定期调用）
     * 用于 Pass 更新
     */
    public function getLatestPass(string $passTypeId, string $serialNumber): Response
    {
        $pkpassPath = storage_path("app/pkpass/{$serialNumber}.pkpass");

        if (!file_exists($pkpassPath)) {
            return response('', 404);
        }

        $lastModified = filemtime($pkpassPath);
        $etag = md5_file($pkpassPath);

        // 支持条件请求（304 Not Modified）
        $ifModifiedSince = request()->header('If-Modified-Since');
        $ifNoneMatch = request()->header('If-None-Match');

        if ($ifNoneMatch === "\"{$etag}\"" ||
            (int) strtotime($ifModifiedSince) >= $lastModified
        ) {
            return response('', 304);
        }

        return response()->file($pkpassPath, [
            'Content-Type' => 'application/vnd.apple.pkpass',
            'ETag' => "\"{$etag}\"",
            'Last-Modified' => gmdate('D, d M Y H:i:s T', $lastModified),
        ]);
    }
}
```

```php
// routes/api.php

Route::prefix('passes')->group(function () {
    Route::get('/ticket/{ticketId}/download', [PassKitController::class, 'download'])
        ->name('passes.download');

    // Apple PKPass Web Service API
    Route::get('/{passTypeId}/{serialNumber}', [PassKitController::class, 'getLatestPass'])
        ->name('passes.latest');
    Route::post('/{passTypeId}/registrations', [PassKitController::class, 'registerDevice'])
        ->name('passes.register');
    Route::delete(
        '/{passTypeId}/registrations/{deviceId}/{serialNumber}',
        [PassKitController::class, 'unregisterDevice']
    )->name('passes.unregister');
});
```

---

## 4. iOS 与 Android 兼容性踩坑

这是整个实现中坑最多的部分。以下是真实遇到的问题：

### 4.1 iOS 端踩坑

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 安装后空白 | pass.json 中 `formatVersion` 写成了 `"1"`（字符串） | 必须是整数 `1` |
| 条形码不显示 | 顶层缺少 `barcode` 字段 | 顶层和 eventTicket 内都加上 |
| 图片不显示 | 图片尺寸不对 | icon: 29x29/58x58, logo: 160x50 max |
| 签名校验失败 | WWDR 证书过期或用了旧版本 | 使用 AppleWWDRCAG4 |
| 推送更新失败 | APNs Token 未正确注册 | 实现 PassKit Web Service 全套 API |
| MIME Type 错误 | 服务端返回 `application/octet-stream` | 必须返回 `application/vnd.apple.pkpass` |

### 4.2 Android 端（Google Pay）兼容性

Google Pay 通过 [Google Pay API for Passes](https://developers.google.com/pay/passes) 支持导入部分 pass 类型，但兼容性远不如 iOS：

```php
<?php

/**
 * Android 兼容处理
 * 
 * Google Pay 不支持直接导入 .pkpass 文件
 * 需要通过 Google Pay API for Passes 创建 Offer/Loyalty/EventTicket
 */
class GooglePayPassService
{
    private string $issuerId;
    private string $serviceAccountKeyPath;

    /**
     * 创建 Google Pay Event Ticket
     */
    public function createEventTicket(array $ticketData): string
    {
        $payload = [
            'id' => $this->issuerId . '.' . $ticketData['serial_number'],
            'classId' => $this->issuerId . '.KKDAY_TICKET_CLASS',
            'eventName' => [
                'defaultValue' => [
                    'language' => 'zh-TW',
                    'value' => $ticketData['venue_name'],
                ],
            ],
            'dateTime' => [
                'start' => $ticketData['start_time'],
                'end' => $ticketData['end_time'] ?? null,
            ],
            'barcode' => [
                'type' => 'QR_CODE',
                'value' => $ticketData['barcode_message'],
            ],
            'ticketHolderName' => $ticketData['holder_name'],
            'ticketNumber' => $ticketData['order_id'],
        ];

        // 调用 Google Pay API
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $this->getAccessToken(),
        ])->post('https://walletobjects.googleapis.com/walletobjects/v1/eventTicketObject', $payload);

        if ($response->successful()) {
            // 生成 "Save to Google Pay" 链接
            return $this->generateSaveUrl($response->json());
        }

        throw new \RuntimeException('Google Pay 票券创建失败: ' . $response->body());
    }

    /**
     * 生成 Save to Google Pay 按钮链接
     */
    private function generateSaveUrl(array $objectData): string
    {
        $saveUrl = 'https://pay.google.com/gp/v/save/' . base64_encode(json_encode([
            'iss' => $this->getServiceAccountEmail(),
            'aud' => 'google',
            'typ' => 'savetowallet',
            'iat' => time(),
            'payload' => [
                'eventTicketObjects' => [$objectData],
            ],
        ]));

        return $saveUrl;
    }
}
```

### 4.3 兼容性决策矩阵

```
┌──────────────────────────────────────────────────────────────┐
│                    平台兼容性决策树                            │
│                                                              │
│  用户设备？                                                   │
│  ├─ iOS Safari                                               │
│  │  ├─ 直接返回 .pkpass 文件                                 │
│  │  └─ Safari 自动识别并弹出「添加到 Wallet」                │
│  │                                                           │
│  ├─ iOS 非 Safari（Chrome/Firefox）                          │
│  │  ├─ 返回 .pkpass 文件                                     │
│  │  └─ 提示「请用 Safari 打开」或提供下载链接                │
│  │                                                           │
│  ├─ Android                                                  │
│  │  ├─ 优先：生成 Google Pay Save 按钮                       │
│  │  └─ 备选：生成 PDF 票券供下载打印                         │
│  │                                                           │
│  └─ Desktop                                                  │
│     ├─ macOS：返回 .pkpass（可双击安装）                     │
│     └─ Windows/Linux：生成 PDF 票券                          │
└──────────────────────────────────────────────────────────────┘
```

```php
<?php

/**
 * 统一票券下载入口：根据设备类型返回不同格式
 */
class TicketDeliveryController extends Controller
{
    public function deliver(string $ticketId): Response
    {
        $userAgent = request()->userAgent();
        $platform = $this->detectPlatform($userAgent);

        return match ($platform) {
            'ios' => $this->deliverPKPass($ticketId),
            'android' => $this->deliverGooglePay($ticketId),
            default => $this->deliverPDF($ticketId),
        };
    }

    private function detectPlatform(string $userAgent): string
    {
        if (str_contains($userAgent, 'iPhone') || str_contains($userAgent, 'iPad')) {
            return 'ios';
        }
        if (str_contains($userAgent, 'Android')) {
            return 'android';
        }
        return 'desktop';
    }
}
```

---

## 5. APNs 推送更新（Pass 变更通知）

当票券状态变更（如使用、取消）时，需要通知 iOS Wallet 刷新：

```php
<?php

namespace App\Services\PassKit;

use Illuminate\Support\Facades\Http;

class PassUpdateNotifier
{
    private string $apnsUrl = 'https://api.push.apple.com/3/device/';
    private string $topic; // passTypeIdentifier

    public function __construct()
    {
        $this->topic = config('services.apple_pass.pass_type_id');
    }

    /**
     * 通知指定设备刷新某个 Pass
     *
     * @param string $deviceToken 设备注册时返回的 Token
     */
    public function notifyPassUpdate(string $deviceToken): void
    {
        // HTTP/2 APNs 推送
        $response = Http::withHeaders([
            'apns-topic' => $this->topic,
            'apns-push-type' => 'background',
            'apns-priority' => '5',
        ])
        ->withToken($this->getJWTToken())
        ->timeout(10)
        ->post($this->apnsUrl . $deviceToken, [
            'aps' => [
                'content-available' => 1,
            ],
        ]);

        if ($response->status() === 410) {
            // 设备已移除该 Pass，清理注册记录
            $this->removeDeviceRegistration($deviceToken);
        }
    }

    /**
     * 生成 APNs JWT Token（基于 .p8 key）
     */
    private function getJWTToken(): string
    {
        $keyId = config('services.apple_pass.apns_key_id');
        $teamId = config('services.apple_pass.team_id');
        $keyPath = config('services.apple_pass.apns_key_path');

        $now = time();
        $header = json_encode(['alg' => 'ES256', 'kid' => $keyId]);
        $payload = json_encode(['iss' => $teamId, 'iat' => $now]);

        // 使用 JWT 库生成
        return \Firebase\JWT\JWT::encode(
            $payload,
            file_get_contents($keyPath),
            'ES256',
            $header
        );
    }
}
```

---

## 6. 生产环境踩坑总结

### 6.1 证书管理

```bash
# 证书过期监控脚本（crontab 每天检查）
#!/bin/bash
CERT_PATH="/var/www/certs/pass_cert.pem"
EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)
EXPIRY_TS=$(date -d "$EXPIRY" +%s)
NOW_TS=$(date +%s)
DAYS_LEFT=$(( ($EXPIRY_TS - $NOW_TS) / 86400 ))

if [ "$DAYS_LEFT" -lt 30 ]; then
    curl -X POST "$SLACK_WEBHOOK" -d "{
        \"text\": \"⚠️ PKPass 证书将在 ${DAYS_LEFT} 天后过期，请尽快更新！\"
    }"
fi
```

### 6.2 常见错误排查清单

| 现象 | 排查方向 |
|------|----------|
| .pkpass 文件无法安装 | 检查签名、manifest 哈希、WWDR 证书版本 |
| 安装后显示空白 | pass.json 格式错误，用 `pkpass-validator` 工具校验 |
| 条码不扫描 | 检查 `barcode.format` 和 `message` 编码 |
| 推送不触发 | APNs topic 必须等于 passTypeIdentifier |
| 更新不生效 | manifest 中的 SHA-1 必须与文件内容一致 |

### 6.3 本地调试工具

```bash
# 安装 pkpass 验证工具
npm install -g pkpass-validator

# 验证 .pkpass 文件
pkpass-validator ticket.pkpass

# 手动解压查看内容
unzip -l ticket.pkpass

# 验证签名
openssl smime -verify -in signature -inform DER \
    -content manifest.json \
    -CAfile wwdr_g4.pem \
    -certfile pass_cert.pem
```

---

## 总结

Apple Wallet Pass 的生成看似简单，实则涉及证书链、文件格式、平台兼容性等多个维度。关键要点：

1. **证书管理**是最大风险——WWDR G4 升级、证书过期都是无声故障
2. **pass.json 两端写 barcode**——顶层和 eventTicket 内部都定义
3. **Android 需要走 Google Pay API**——不能简单复用 .pkpass 文件
4. **APNs 推送用 HTTP/2 + JWT**——不要用旧的 binary protocol
5. **本地调试用 pkpass-validator**——不要盲目上传到设备测试

在 B2C 场景中，票券的可扫描性直接影响用户体验。每一个字段、每一张图片的规格都不容忽视。
