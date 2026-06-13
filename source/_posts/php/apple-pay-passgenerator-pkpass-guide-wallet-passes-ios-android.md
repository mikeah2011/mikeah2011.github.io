---

title: Apple Pay PassGenerator PKPass 实战：如何生成 Wallet Passes 与 iOS/Android 兼容性踩坑记录
keywords: [Apple Pay PassGenerator PKPass, Wallet Passes, iOS, Android, 如何生成, 兼容性踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 02:35:25
updated: 2026-05-05 02:38:07
categories:
- php
tags:
- Laravel
- PHP
- Apple Pay
- PKPass
- Wallet
- 支付
description: Apple Pay PKPass Wallet Passes 生成完整实战教程：Laravel 后端集成 PKPass 文件构建、Apple Developer 证书配置与签名校验、pass.json 核心字段解析、manifest 哈希生成、APNs 推送更新、iOS 与 Android Google Pay 兼容性踩坑，B2C 电商电子票券场景全流程详解。
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

## 7. PKPass 安全机制与证书签名链深度解析

PKPass 文件的安全性完全依赖 Apple 的证书签名体系。理解这套机制是排查各类安装失败问题的关键。

### 7.1 签名流程原理

整个签名过程可以拆解为以下几个步骤：

1. **计算 manifest 哈希**：对 pass.json、所有图片等文件逐一计算 SHA-1 哈希值，生成 manifest.json
2. **PKCS#7 签名**：使用 Pass Type ID 证书对 manifest.json 进行数字签名，生成 CMS 格式的 signature 文件
3. **证书链包含**：签名时必须将 WWDR 中间证书附加在签名数据中，iOS 设备验证时会沿着证书链逐级校验
4. **ZIP 打包**：将 pass.json、manifest.json、signature、图片等文件打包为 ZIP，扩展名改为 .pkpass

签名验证是离线完成的——iOS 设备下载 .pkpass 后，会使用本地预置的 Apple Root CA 公钥验证整条证书链。如果任何环节出错，系统会静默拒绝安装，不会给用户任何错误提示。

### 7.2 证书过期的连锁反应

Apple Developer 的 Pass Type ID Certificate 有效期仅为一年。一旦过期：

- 新生成的 .pkpass 文件无法安装
- 已安装的 Pass 不受影响，但无法接收推送更新
- 如果 WWDR 中间证书也过期，已安装的 Pass 验证会失败

建议在 CI/CD 流程中加入证书过期检查，提前 30 天触发告警。生产环境部署时，证书文件应存储在安全的密钥管理服务（如 AWS Secrets Manager 或 HashiCorp Vault）中，而不是直接放在代码仓库或服务器文件系统上。

### 7.3 证书权限最小化原则

Pass Type ID Certificate 应严格限制用途。不要将同一张证书用于开发和生产环境——Apple Developer Portal 允许为同一个 Pass Type ID 创建多张证书。建议创建两张：

- 一张用于本地开发和测试（团队成员共享）
- 一张仅用于生产环境（仅 CI/CD 服务器持有）

这样即使开发证书泄露，也不会影响生产环境的 Pass 验证。

---

## 8. Pass 类型详解与字段映射指南

Apple Wallet 支持多种 Pass 类型，每种类型有不同的字段布局和适用场景。选择正确的 Pass 类型直接影响用户在锁屏和 Wallet 应用中的展示效果。

### 8.1 四种 Pass 类型对比

| Pass 类型 | 适用场景 | 核心字段区域 | 典型应用 |
|-----------|---------|-------------|---------|
| eventTicket | 活动门票、景点入场券 | header/primary/secondary/auxiliary | 演唱会票、迪士尼门票 |
| boardingPass | 交通票据（航班、火车） | header/primary/secondary/auxiliary + transitType | 机票、高铁票 |
| coupon | 优惠券、折扣券 | header/primary/secondary/auxiliary + barcode | 商场优惠券、满减券 |
| generic | 通用卡片（会员卡、积分卡） | header/primary/secondary/auxiliary | 会员卡、停车卡 |

### 8.2 eventTicket 字段布局详解

以旅游电商场景为例，eventTicket 的字段应该这样组织：

```json
{
  "headerFields": [
    {"key": "date", "label": "使用日期", "value": "2026/05/10", "dateStyle": "PKDateStyleMedium"}
  ],
  "primaryFields": [
    {"key": "venue", "label": "景点", "value": "东京迪士尼乐园"}
  ],
  "secondaryFields": [
    {"key": "ticketType", "label": "票种", "value": "一日券"},
    {"key": "quantity", "label": "数量", "value": "2"}
  ],
  "auxiliaryFields": [
    {"key": "orderId", "label": "订单号", "value": "KKD20260505001"}
  ],
  "backFields": [
    {"key": "terms", "label": "使用须知", "value": "请携带有效证件前往景区入口扫码入园。门票仅限指定日期使用，过期作废。"},
    {"key": "support", "label": "客服电话", "value": "+886-2-1234-5678"}
  ]
}
```

注意 `backFields` 的作用——用户翻转卡片后可以看到这些信息。使用须知、客服电话、退改政策等应该放在这里，既不影响正面美观，又能提供必要的辅助信息。

### 8.3 boardingPass 的 transitType 字段

交通票据必须指定 `transitType` 字段，否则 iOS 会在安装时报错：

```json
{
  "boardingPass": {
    "transitType": "PKTransitTypeAir",
    "headerFields": [...],
    "primaryFields": [
      {"key": "origin", "label": "出发", "value": "TPE"},
      {"key": "destination", "label": "到达", "value": "NRT"}
    ]
  }
}
```

可用的 transitType 值：
- `PKTransitTypeAir` — 航空
- `PKTransitTypeBoat` — 轮船
- `PKTransitTypeBus` — 巴士
- `PKTransitTypeTrain` — 火车
- `PKTransitTypeMetro` — 地铁

---

## 9. 条码类型选择与编码规范

条码是 PKPass 最核心的功能之一——用户在景区、机场等场景扫码入园/登机。选错条码类型或编码格式，会导致扫码枪无法识别。

### 9.1 支持的条码格式

| 格式 | 常量名 | 适用场景 | 数据容量 |
|------|--------|---------|---------|
| QR Code | PKBarcodeFormatQR | 最通用，景区扫码 | 数字：7089，字母：4296 |
| PDF417 | PKBarcodeFormatPDF417 | 航空登机牌（IATA标准） | 文本：1850 字符 |
| Aztec | PKBarcodeFormatAztec | 高密度二维码 | 数字：3832，字母：3067 |
| Code 128 | PKBarcodeFormatCode128 | 一维条码，简单场景 | ASCII 128 字符 |

### 9.2 messageEncoding 编码选择

条码的 `messageEncoding` 字段决定了二进制数据的编码方式。大部分场景使用 `iso-8859-1` 就够了，但如果条码内容包含中文或日文，需要切换到 UTF-8：

```php
// 中文场景示例：景点名称含中文
'barcode' => [
    'message' => '東京迪士尼樂園-一日券-20260510',
    'format' => 'PKBarcodeFormatQR',
    'messageEncoding' => 'utf-8',  // 必须用 utf-8 支持中文
]
```

**踩坑记录**：如果用 `iso-8859-1` 编码中文内容，条码虽然能生成，但扫码枪读出的是乱码。这在测试阶段很容易被忽略（因为测试数据通常是英文），上线后用户反馈才发现问题。

### 9.3 条码 altText 的妙用

Apple Wallet 6.0+ 支持在条码下方显示一行辅助文字（altText）。对于景区门票，可以显示订单号或验证码，方便人工核验：

```php
'barcode' => [
    'message' => 'KKD20260505001-TKT-001',
    'format' => 'PKBarcodeFormatQR',
    'messageEncoding' => 'iso-8859-1',
    'altText' => '订单号: KKD20260505001',  // 条码下方显示
]
```

---

## 10. 国际化与多语言支持

如果产品面向多语言用户（如 KKday 覆盖中、英、日、韩等市场），PKPass 的国际化支持至关重要。

### 10.1 lproj 目录结构

PKPass 支持通过 `lproj` 目录实现多语言。每个语言一个目录，目录下放 `pass.strings` 文件：

```
ticket.pkpass
├── pass.json
├── en.lproj/
│   └── pass.strings        # 英文
├── zh-Hans.lproj/
│   └── pass.strings        # 简体中文
├── zh-Hant.lproj/
│   └── pass.strings        # 繁体中文
├── ja.lproj/
│   └── pass.strings        # 日文
└── ko.lproj/
    └── pass.strings        # 韩文
```

### 10.2 pass.strings 文件格式

```strings
/* en.lproj/pass.strings */
"date" = "Date";
"venue" = "Venue";
"ticketType" = "Ticket Type";
"quantity" = "Quantity";
"orderId" = "Order ID";
"terms" = "Please present this pass at the entrance. Valid only on the specified date.";
"support" = "Customer Service: +886-2-1234-5678";
```

```strings
/* zh-Hans.lproj/pass.strings */
"date" = "使用日期";
"venue" = "景点";
"ticketType" = "票种";
"quantity" = "数量";
"orderId" = "订单号";
"terms" = "请在入口出示此票券。仅限指定日期使用，过期作废。";
"support" = "客服电话：+886-2-1234-5678";
```

### 10.3 Laravel 中动态生成多语言 Pass

在 Laravel 中，可以根据用户的语言偏好动态选择 `lproj` 目录：

```php
private function collectPassFiles(array $passJson, array $data): array
{
    $files = [];
    $files['pass.json'] = json_encode($passJson, JSON_UNESCAPED_UNICODE);

    // 根据用户语言选择 lproj 目录
    $userLocale = $data['locale'] ?? app()->getLocale();
    $lprojDir = $this->resolveLprojDir($userLocale);

    if ($lprojDir) {
        $stringsPath = "pkpass/lproj/{$lprojDir}/pass.strings";
        if (Storage::disk('local')->exists($stringsPath)) {
            $files["{$lprojDir}/pass.strings"] = Storage::disk('local')->get($stringsPath);
        }
    }

    // ... 其余图片文件收集逻辑
    return $files;
}

private function resolveLprojDir(string $locale): ?string
{
    return match ($locale) {
        'zh-CN', 'zh-Hans' => 'zh-Hans.lproj',
        'zh-TW', 'zh-Hant' => 'zh-Hant.lproj',
        'ja' => 'ja.lproj',
        'ko' => 'ko.lproj',
        default => 'en.lproj',
    };
}
```

**踩坑记录**：Apple 对 lproj 目录命名有严格要求。简体中文必须是 `zh-Hans.lproj`（不是 `zh-CN.lproj`），繁体中文必须是 `zh-Hant.lproj`。用错目录名，iOS 会回退到英文显示，不会报错。

---

## 11. Pass 更新与生命周期管理

PKPass 不是一次性的——用户添加到 Wallet 后，票券状态可能发生变化（已使用、已取消、已退款），需要通过推送通知让 Wallet 自动刷新。

### 11.1 PassKit Web Service API

Apple 要求实现以下三个 API 端点，iOS 设备才能正确注册和更新 Pass：

```php
// 1. 注册设备（iOS 添加 Pass 时自动调用）
public function registerDevice(Request $request, string $passTypeId): JsonResponse
{
    $deviceLibraryIdentifier = $request->input('deviceLibraryIdentifier');
    $serialNumber = $request->input('serialNumber');
    $pushToken = $request->input('pushToken');

    // 存储设备注册信息
    DeviceRegistration::updateOrCreate(
        ['device_library_id' => $deviceLibraryIdentifier, 'serial_number' => $serialNumber],
        ['push_token' => $pushToken, 'registered_at' => now()]
    );

    return response()->json([], 201);
}

// 2. 获取最新 Pass（iOS 定期轮询）
public function getLatestPass(string $passTypeId, string $serialNumber): Response
{
    $pkpassPath = storage_path("app/pkpass/{$serialNumber}.pkpass");
    // ... 条件请求处理（304 Not Modified）
}

// 3. 注销设备（用户删除 Pass 时调用）
public function unregisterDevice(string $passTypeId, string $deviceId, string $serialNumber): JsonResponse
{
    DeviceRegistration::where('device_library_id', $deviceId)
        ->where('serial_number', $serialNumber)
        ->delete();

    return response()->json([], 200);
}
```

### 11.2 推送更新触发时机

以下场景应该触发 Pass 推送更新：

- 票券被使用（扫码入园后，状态变为「已使用」）
- 订单取消或退款
- 票券信息变更（如演出时间调整、场馆变更）
- 新增附加信息（如添加座位号、登机口变更）

每次推送更新时，需要重新生成 .pkpass 文件并发送 APNs 通知。iOS 设备收到通知后会调用 `getLatestPass` API 获取最新版本。

### 11.3 Pass 过期处理

对于有时效性的 Pass（如演出门票），建议在 pass.json 中设置 `expirationDate` 字段：

```php
'expirationDate' => '2026-05-11T00:00:00',  // 演出次日凌晨过期
'relevantDate' => '2026-05-10T18:00:00',    // 演出开始时间（锁屏提示）
```

过期后，Wallet 会将该 Pass 移至「已过期」分组，但不会自动删除。如果需要主动清理，可以通过 APNs 推送一个空更新，配合服务端返回 404 来触发 iOS 删除。

---

## 12. 性能优化与生产环境最佳实践

### 12.1 PKPass 文件缓存策略

生成 .pkpass 是一个计算密集型操作（涉及图片处理、OpenSSL 签名、ZIP 打包）。在高并发场景下，应该缓存已生成的文件：

```php
public function generateOrGetCached(array $ticketData, string $serialNumber): string
{
    $cacheKey = "pkpass:{$serialNumber}";
    $pkpassPath = storage_path("app/pkpass/{$serialNumber}.pkpass");

    // 如果文件已存在且未过期，直接返回
    if (file_exists($pkpassPath) && (time() - filemtime($pkpassPath)) < 86400) {
        return $pkpassPath;
    }

    // 生成新文件
    return $this->generate($ticketData, $serialNumber);
}
```

### 12.2 图片预处理

PKPass 对图片尺寸有严格要求。如果在生成时动态调整尺寸，会显著增加响应时间。建议在上传图片时就预处理好所有尺寸：

| 图片 | 1x 尺寸 | 2x 尺寸 | 用途 |
|------|---------|---------|------|
| icon | 29×29 | 58×58 | Wallet 列表图标（必填） |
| logo | 160×50 | 320×100 | 顶部 Logo（推荐） |
| thumbnail | 90×90 | 180×180 | 通知预览图（可选） |
| strip | 375×123 | 750×246 | 条带图片（可选） |
| background | 不推荐动态生成 | — | 背景图（可选） |

### 12.3 错误监控与告警

在生产环境中，PKPass 相关的错误应该被独立监控：

```php
// 在 PKPassGenerator 的 generate 方法中加入异常捕获
try {
    $pkpassPath = $this->generate($ticketData, $serialNumber);
} catch (\Throwable $e) {
    \Log::error('PKPass 生成失败', [
        'ticket_id' => $ticketData['order_id'],
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString(),
    ]);

    // 触发告警（Slack/邮件/短信）
    alertOpsTeam('PKPass generation failed', $e->getMessage());

    // 降级方案：返回 PDF 票券
    return $this->fallbackToPdf($ticketData);
}
```

### 12.4 测试环境隔离

开发和测试环境应使用独立的 Pass Type ID 和证书。Apple Developer Portal 允许创建多个 Pass Type ID，建议命名规范如下：

```
pass.com.yourcompany.b2c.eTicket          # 生产环境
pass.com.yourcompany.b2c.eTicket.staging   # 预发布环境
pass.com.yourcompany.b2c.eTicket.dev       # 开发环境
```

这样可以避免测试数据意外推送到生产用户的 Wallet 中，也方便在不同环境中独立调试。

---

## 总结

Apple Wallet Pass 的生成看似简单，实则涉及证书链、文件格式、平台兼容性等多个维度。关键要点：

1. **证书管理**是最大风险——WWDR G4 升级、证书过期都是无声故障
2. **pass.json 两端写 barcode**——顶层和 eventTicket 内部都定义
3. **Android 需要走 Google Pay API**——不能简单复用 .pkpass 文件
4. **APNs 推送用 HTTP/2 + JWT**——不要用旧的 binary protocol
5. **本地调试用 pkpass-validator**——不要盲目上传到设备测试
6. **国际化用 lproj 目录**——zh-Hans 不是 zh-CN，命名必须精确
7. **图片尺寸提前预处理**——生成时动态 resize 会拖慢响应
8. **证书分级管理**——开发、测试、生产使用独立证书

在 B2C 场景中，票券的可扫描性直接影响用户体验。每一个字段、每一张图片的规格都不容忽视。

---

## 相关阅读

- [Laravel 缓存策略全解：Route/Config/View/Query 缓存最佳实践踩坑记录](/2026/05/01/laravel-cache-route-config-view-query-cache/) — Laravel 缓存体系深度解析，适用于 PKPass 文件缓存与性能优化场景
- [OWASP Top 10 防护实战：SQL 注入/XSS/CSRF/SSRF Laravel B2C API 安全加固踩坑记录](/2026/05/20/owasp-top-10-guide-sql-xss-csrf-ssrf/) — Laravel API 安全加固指南，证书与密钥管理的最佳实践参考
- [PHP Fiber 协程并发实战 — Laravel 并发 API 聚合与错误隔离踩坑记录](/2026/05/15/php-fiber-concurrencyguide-laravel-concurrencyapi/) — Laravel 高并发场景下的异步处理方案，适用于批量 PKPass 生成优化
