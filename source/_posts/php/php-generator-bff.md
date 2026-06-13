---
title: PHP Generator -BFF 流式響應實戰-KKday-B2C-API-真實踩坑記錄
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
  - php
  - bff
tags: [BFF, Laravel, WebSocket]
keywords: [PHP Generator, BFF, KKday, B2C, API, 流式響應實戰, 真實踩坑記錄, PHP]
description: PHP Generator 在 BFF 層的流式響應實戰，結合 KKday-B2C-API 真實踩坑經驗，分享如何利用 Generator 實現漸進式數據傳輸與錯誤容錯機制。



---

# PHP Generator -BFF 流式響應實戰-KKday-B2C-API-真實踩坑記錄

## 背景：為什麼需要 BFF 層流式響應？

在 KKday-B2C-API 項目中，我們面臨以下挑戰：

1. **前端需要長時間運行的報表分析頁面**
2. **即時推送大數據集時，瀏覽器需要逐步渲染避免白屏**
3. **GraphQL→JSON 轉換的響應體可能達到數 MB，一次性返回會卡住用戶體驗**

傳統的 `return $data;` 方式會讓整個請求掛起直到 PHP 執行完所有邏輯，對前端而言就是「長時間白屏」。利用 PHP Generator 實現流式響應可以解決這個問題。

## 什麼是 PHP Generator？

Generator 是一種特殊的迭代器，可以使用 `yield` 關鍵字逐步輸出數據，而不停止函數執行：

```php
<?php
function getData()
{
    echo 'Start...'; // 立即執行
    yield 'Step 1';   // 暫停並返回
    echo 'Middle...'; // 恢復後執行
    yield 'Step 2';   // 再次暫停
    yield 'Final';    // 最後數據
}

foreach (getData() as $data) {
    echo "Received: {$data}\n";
}
?>
```

在 BFF 層，Generator 讓我們可以：

✅ **逐步讀取數據庫**（避免大查詢阻塞）
✅ **逐塊處理業務邏輯**（可取消、可暫停）
✅ **實現 Server-Sent Events (SSE)**（前端持續接收流）
✅ **支持 WebSocket 推送**（實時通知場景）

## 基礎範例：簡單的 Generator BFF

### Before（一次性返回）

```php
// ❌ 傳統做法 - 整個請求掛起直到完成
namespace App\Http\Controllers\Bff;

use App\Services\DataReportService;
use Illuminate\Http\Request;

class DataReportController
{
    private DataReportService $reportService;

    public function __construct(DataReportService $reportService)
    {
        $this->reportService = $reportService;
    }

    public function getLargeReport(Request $request)
    {
        // 這行代碼會執行完所有邏輯才返回
        $data = $this->reportService->fetchReportData($request);
        
        // 前端收到響應時，數據已經全部準備好
        return response()->json($data); 
    }
}
```

**問題：**
- 大型數據集需要數十秒執行時間
- 前端瀏覽器顯示白屏（長時間無響應）
- 無法中途取消請求
- 内存峰值高

### After（Generator 流式返回）

```php
// ✅ Generator 方式 - 逐步輸出數據
namespace App\Http\Controllers\Bff;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DataReportController
{
    public function getLargeReport(Request $request)
    {
        // 設置 SSE 內容類型
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('Connection: keep-alive');
        
        // Generator 函數，逐步讀取數據
        return $this->generateStream($request);
    }

    /**
     * Generator 實現流式讀取
     */
    private function generateStream(Request $request)
    {
        // 第 1 步：返回開始消息
        yield json_encode(['type' => 'start', 'message' => '開始處理報表...'], JSON_UNESCAPED_UNICODE);
        
        // 逐步讀取數據庫（分批處理）
        $chunkSize = 100; // 每批 100 條
        
        $query = DB::table('reports')
            ->select('id', 'name', 'created_at')
            ->orderBy('created_at', 'desc');
        
        // 分批讀取並逐步輸出
        for ($i = 0; ; $i++) {
            $chunk = $query->limit($chunkSize)->get();
            
            if (empty($chunk)) {
                break;
            }
            
            foreach ($chunk as $item) {
                yield json_encode([
                    'type' => 'data',
                    'id' => $item['id'],
                    'name' => $item['name'],
                ], JSON_UNESCAPED_UNICODE);
                
                // 每輸出若干條後給前端機會處理，避免卡住
                flush(); 
            }
        }
        
        yield json_encode(['type' => 'end', 'message' => '處理完成'], JSON_UNESCAPED_UNICODE);
    }
}
```

## 流式響應的正確配置

### Controller 層設置

```php
namespace App\Http\Controllers\Bff;

use Illuminate\Http\Request;

class StreamingController
{
    public function streamData(Request $request)
    {
        // 關鍵：告訴瀏覽器這是流式內容
        header('Content-Type: text/event-stream');
        
        return $this->generateStream();
    }

    private function generateStream()
    {
        // Yield JSON 對象，自動處理序列化
        yield json_encode(['status' => 'init', 'timestamp' => now()->toIso8601String()], JSON_UNESCAPED_UNICODE);
        
        for ($i = 0; $i < 5; $i++) {
            // 模擬數據產生
            sleep(1);
            
            yield json_encode([
                'status' => 'progress',
                'current' => $i,
                'total' => 5,
                'data' => ['sample' => "這是第" . ($i + 1) . "筆數據"],
            ], JSON_UNESCAPED_UNICODE);
        }
        
        yield json_encode(['status' => 'complete'], JSON_UNESCAPED_UNICODE);
    }
}
```

### 前端接收 SSE 流

```html
<!DOCTYPE html>
<html>
<head>
    <title>BFF 流式響應實戰</title>
</head>
<body>
    <div id="output"></div>

    <script>
        const eventSource = new EventSource('/api/bff/stream-data');

        eventSource.onopen = () => {
            console.log('連接已建立');
        };

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.status) {
                case 'init':
                    document.getElementById('output').innerHTML += 
                        '<div>📋 ' + data.message + '</div>';
                    break;
                case 'progress':
                    document.getElementById('output').innerHTML += 
                        '<div style="color:blue">💧 ' + JSON.stringify(data.data) + '</div>';
                    break;
                case 'complete':
                    console.log('完成！');
                    eventSource.close();
                    break;
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE 錯誤:', error);
            document.getElementById('output').innerHTML += 
                '<div style="color:red">❌ 連接失敗</div>';
            eventSource.close();
        };
    </script>
</body>
</html>
```

## 真實踩坑記錄一：PHP Generator 的 flush() 陷阱

### 錯誤實踐

```php
// ❌ 常見錯誤 - 以為調用 yield 後會自動刷新輸出
namespace App\Http\Controllers\Bff;

class WrongStreamController
{
    public function stream()
    {
        yield 'Step 1';
        yield 'Step 2'; // ⚠️ 這裡不會立即輸出到瀏覽器！
        
        return [
            'result' => '完成',
        ];
    }
}
```

### 錯誤原因分析

PHP Generator 需要手動調用 `flush()` 才能將數據緩衝區內容刷新到網絡：

```php
yield 'Step 1'; // 暫停並返回，但沒有輸出到瀏覽器
flush();        // ⚠️ 必須手動調用！
```

### 正確實踐

```php
// ✅ 正確 - 每次 yield 後都調用 flush()
namespace App\Http\Controllers\Bff;

class CorrectStreamController
{
    public function stream(Request $request)
    {
        header('Content-Type: text/event-stream');
        
        return new Generator(function () use ($request) {
            // 初始化消息
            yield json_encode(['step' => 'init'], JSON_UNESCAPED_UNICODE);
            flush(); // 刷新輸出
            
            // 模擬數據生成過程
            for ($i = 0; $i < 5; $i++) {
                sleep(1); // 模擬處理時間
                
                $data = [
                    'step' => 'processing',
                    'progress' => ($i + 1) / 5,
                    'timestamp' => now()->toIso8601String(),
                ];
                
                yield json_encode($data, JSON_UNESCAPED_UNICODE);
                flush(); // ⚠️ 關鍵：每次 output 前都刷新
            }
            
            yield json_encode(['step' => 'complete'], JSON_UNESCAPED_UNICODE);
            flush(); // 最後也要刷新
            
            return; // Generator 結束
        });
    }
}
```

## 真實踩坑記錄二：PHP-FPM + Apache/Nginx 的緩衝問題

### 問題現象

在使用 PHP Generator 時，發現即使調用了 `flush()`，數據仍然沒有立即出現在瀏覽器中，表現為：
- 前端收不到數據
- 最後一次性返回所有數據
- `stream_socket_enable_crypto` 相關警告

### 排查步驟

```php
// 加除錯輸出 - 確認 Generator 是否正常執行
yield json_encode(['debug' => 'Generator started']);
flush();

$buffer_size = ini_get('output_buffering');
echo "Buffer size: " . ($buffer_size === 'Off' ? 'Disabled' : $buffer_size) . "\n";
flush();

yield json_encode(['debug' => 'Processing...']);
flush();
```

### 解決方案：配置 PHP 輸出緩衝

#### Apache + PHP-FPM（修改 `/etc/php/8.0/fpm/php.ini`）

```ini
; Output buffering - Generator 需要禁用緩衝
output_buffering = Off

; 確保不啟用重定向緩衝
redirect_status = 200
```

#### Nginx 配置

在 `nginx.conf` 中：

```nginx
location ~* \.(php|html)$ {
    fastcgi_pass unix:/run/php/php8.0-fpm.sock;
    fastcgi_buffering off;              # ⚠️ 關鍵：禁用緩衝
    fastcgi_buffers 16 256k;            # 適當配置緩衝區大小
    fastcgi_busy_buffers_size 256k;
    
    proxy_buffering off;                # 如果用到反向代理
    
    add_header X-Generator-Enabled "true";
}
```

#### PHP-FPM Pool 配置（`/etc/php/8.0/fpm/pool.d/www.conf`）

```ini
pm = dynamic
pm.max_children = 50
request_terminate_timeout = 300s

; Generator 場景需要調大超时時間
slowlog = /var/log/php/slow.log
log_slow_threshold = 3
```

## 真實踩坑記錄三：GraphQL BFF 轉換優化失敗案例

### 背景

KKday-B2C-API 有 GraphQL 層，但前端希望直接獲得 JSON。BFF 負責：
1. 解析 GraphQL 請求
2. 調用下游 API
3. 轉換為標準 JSON 響應

**問題：** 轉換過程需要較長時間，一次性返回不友好。

### Before：GraphQL→JSON 同步轉換

```php
// ❌ 傳統做法 - 整個轉化過程阻塞請求
namespace App\Http\Controllers\Bff;

use GraphQL\Validator\ValidatorInterface;

class GraphQLToJSONConverter
{
    public function convert($graphqlQuery)
    {
        // 解析 GraphQL 查詢
        $parsed = $this->parseGraphQL($graphqlQuery);
        
        // 逐層轉換數據結構
        foreach ($parsed['fields'] as $fieldPath => $value) {
            // 可能調用外部 API、讀取緩存等
            sleep(1); // ⚠️ 阻塞式操作
            $value = $this->convertValue($value);
        }
        
        // 最後返回 JSON - 前端此時才開始看到數據
        return json_encode($parsed, JSON_UNESCAPED_UNICODE);
    }
}

// Controller 使用
class GraphQLController
{
    public function convert(Request $request)
    {
        $converter = new GraphQLToJSONConverter();
        
        // ⚠️ yield 語句不支援在這種場景！
        // return $converter->convert($request);
        
        return response()->json(
            json_decode($converter->convert($request))
        );
    }
}
```

### After：分塊轉換 + Generator

```php
// ✅ Generator 方式 - 支持中斷與取消
namespace App\Http\Controllers\Bff;

class GraphQLStreamingConverter
{
    public function streamConvert(Request $request)
    {
        header('Content-Type: application/json');
        
        return new Generator(function () use ($request) {
            yield json_encode([
                'type' => 'parse_start',
                'message' => '解析 GraphQL 查詢...',
            ], JSON_UNESCAPED_UNICODE);
            
            // 解析請求（快速操作）
            $parsed = $this->parseGraphQL($request->input('query'));
            yield json_encode([
                'type' => 'parse_complete',
                'fields_count' => count($parsed['fields']),
            ], JSON_UNESCAPED_UNICODE);
            
            // 逐字段轉換（允許中斷）
            foreach ($parsed['fields'] as $fieldPath => $field) {
                yield json_encode([
                    'type' => 'processing_field',
                    'field' => $fieldPath,
                ], JSON_UNESCAPED_UNICODE);
                
                // 模擬外部 API 調用
                sleep(1);
                
                $converted = $this->convertField($field);
                
                yield json_encode([
                    'type' => 'field_complete',
                    'field' => $fieldPath,
                    'result' => $converted['value'],
                ], JSON_UNESCAPED_UNICODE);
            }
            
            yield json_encode([
                'type' => 'convert_complete',
                'total_fields' => count($parsed['fields']),
            ], JSON_UNESCAPED_UNICODE);
        });
    }
    
    private function parseGraphQL($query)
    {
        // 簡單的解析邏輯（實際使用圖形庫）
        $parsed = [
            'fields' => ['user', 'orders', 'products'],
        ];
        return $parsed;
    }
    
    private function convertField($field)
    {
        // 轉換邏輯
        return ['value' => '轉換後的數據'];
    }
}
```

## 真實踩坑記錄四：SSE 與 WebSocket 的 Generator 整合

### 問題場景

某些場景需要同時支持 SSE（單向推送）和 WebSocket（雙向通訊）：

```php
// ❌ 錯誤 - 兩個 Generator 無法在同一連接中並行執行
class MixedProtocolController
{
    public function hybridConnection(Request $request)
    {
        // SSE Generator
        $sseGenerator = new Generator(function () {
            yield json_encode(['type' => 'sse_init']);
        });
        
        // WebSocket Generator（實際無法在 PHP 中同時運作）
        $wsGenerator = new Generator(function () {
            yield json_encode(['type' => 'ws_init']);
        });
        
        return [
            'sse' => $sseGenerator,
            'ws' => $wsGenerator,
        ];
    }
}
```

### 正確做法：優先選擇單一協議

PHP Generator 不適合在同一連接中同時支持 SSE 和 WebSocket。需要選擇：

#### 方案一：使用 Laravel Horizon + Redis（推薦）

```php
// ✅ Laravel Horizon - 專業的消息隊列管理系統
namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ReportGenerationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $connection = 'redis';
    
    protected array $dataChunks;

    public function __construct(array $dataChunks)
    {
        $this->dataChunks = $dataChunks;
    }

    public function handle()
    {
        // 逐批處理數據
        foreach ($this->dataChunks as $chunk) {
            yield from $this->processChunk($chunk);
        }
        
        emit('report_complete', ['status' => 'done']);
    }

    private function processChunk(array $chunk): Generator
    {
        foreach ($chunk as $item) {
            // 處理邏輯
            emit('chunk_data', [
                'data' => $item,
            ]);
            yield; // 讓出時間給其他事件
        }
    }
}

// Controller - 使用 Redis Pub/Sub
class StreamingController
{
    public function streamWithRedis(Request $request)
    {
        header('Content-Type: text/event-stream');
        
        // 創建 Channel
        $channel = new Channels\ReportChannel();
        
        // 訂閱頻道並流式返回
        return new Generator(function () use ($channel) {
            yield json_encode(['type' => 'connected', 'channel' => get_class($channel)]);
            
            while (true) {
                try {
                    $job = app()->make(ReportGenerationJob::class);
                    // 通過 Redis Pub/Sub接收數據
                    yield from $channel->receive();
                } catch (\Throwable $e) {
                    yield json_encode([
                        'type' => 'error',
                        'message' => $e->getMessage(),
                    ], JSON_UNESCAPED_UNICODE);
                    break;
                }
            }
            
            yield json_encode(['type' => 'closed'], JSON_UNESCAPED_UNICODE);
        });
    }
}
```

## 性能優化建議

### Generator 性能調優

```php
// ✅ 最佳實踐配置
namespace App\Http\Controllers\Bff;

class PerformanceOptimizedController
{
    public function optimizeStream(Request $request)
    {
        // 1. 設置正確的 Content-Type
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Connection: keep-alive');
        
        // 2. 禁用 PHP 輸出緩衝
        ini_set('output_buffering', 'Off');
        
        return new Generator(function () use ($request) {
            yield json_encode(['status' => 'init'], JSON_UNESCAPED_UNICODE);
            
            // 3. 使用批量讀取減少 DB 往返
            $query = DB::table('orders')
                ->select('id', 'user_id', 'created_at');
            
            while (($chunk = $query->chunk(100)) !== false) {
                foreach ($chunk as $order) {
                    yield json_encode([
                        'data' => $order,
                    ], JSON_UNESCAPED_UNICODE);
                }
                
                flush(); // 每批刷新
            }
            
            yield json_encode(['status' => 'complete'], JSON_UNESCAPED_UNICODE);
        });
    }
}
```

### Nginx 配置優化

```nginx
location ~* \.php$ {
    # 禁用緩衝以確保流式數據即時傳輸
    fastcgi_buffering off;
    
    # 設置較小的緩存控制
    fast_cache_zone keys=1m size=256k zone_size=10m;
    
    # 禁用代理緩衝（如果用反向代理）
    proxy_buffering off;
    proxy_max_temp_file_size 0;
}
```

## 總結與建議

### ✅ Generator BFF 的適用場景

| 場景 | 適用性 | 說明 |
|------|--------|------|
| 大型報表生成 | ⭐⭐⭐⭐⭐ | 逐步傳輸，避免白屏 |
| GraphQL→JSON 轉換 | ⭐⭐⭐⭐ | 分塊處理複雜邏輯 |
| 即時數據推送 | ⭐⭐⭐⭐ | 配合 SSE/Redis 使用 |
| 小規模 API 響應 | ❌ | 同步返回即可 |

### ❌ Generator BFF 的注意事項

1. **必須禁用 output_buffering**，否則 `flush()` 無效
2. **每次 yield 後調用 flush()**，確保數據即時傳輸
3. **設置正確的 Nginx/Apache 配置**，禁用緩衝
4. **避免在 Generator 中使用阻塞操作**，保持可取消性

### 📝 Commit Message 建議（繁体中文）

```
feat(BFF): 實作 PHP Generator 流式響應模式-KKday-B2C-API

- 新增 streaming 控制器支援 SSE 推送
- 優化 GraphQL→JSON 轉換為分批處理
- 禁用 output_buffering 與 Nginx fastcgi_buffering
- 添加 Generator flush() 機制確保即時輸出

Ref: https://github.com/mikeah2011.github.io/pull/XXX
```

## 參考資源

- [PHP Generators 官方文檔](https://www.php.net/manual/en/language.generators.php)
- [EventSource API - MDN](https://developer.mozilla.org/zh-tw/docs/Web/API/EventSource)
- [Laravel Horizon 消息隊列管理](https://laravelhorizon.com/)

---

**本文為 KKday-B2C-API 真實項目踩坑經驗整理，如有問題歡迎在 GitHub Issue 中提問。** 🚀
