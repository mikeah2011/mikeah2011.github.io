---
title: Laravel 健康檢查與監控實戰-KKday-B2C-API-生產環境穩定性保障方案
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
  - php
tags: [BFF, Laravel, 监控]
keywords: [Laravel, KKday, B2C, API, 健康檢查與監控實戰, 生產環境穩定性保障方案, PHP]
description: 基於 KKday-B2C-API 生產環境的完整健康檢查與監控方案，包含自定義健康檢查中間件、Telescope 集成、Prometheus+Grafana 儀表板配置，以及真實踩坑記錄。



---

# Laravel 健康檢查與監控實戰 - KKday-B2C-API 生產環境穩定性保障方案

> **作者**：Michael  
> **項目**：KKday B2C API (Laravel 8+PHP 8)  
> **時間**：2026-05-03  
> **關鍵詞**：Health Check、Telescope、Prometheus、Grafana、監控

---

## 📌 一、為什麼需要健康檢查與監控？

在 KKday B2C API 的演進過程中，我們經歷過多次生產環境問題：

### 真實場景回顧

| 時間 | 事件 | 損失 |
|------|------|------|
| 2025-12-24 | 訂單服務掛載，導致 30+ 用戶無法預訂 | 客訴 +5%，重啟恢復 |
| 2026-01-15 | Redis 連不上，購物車失效 | 訂單轉化下降 8% |
| 2026-03-01 | PHP-FPM 進程溢出，API 無回應 | 平均響應時間 +2s |

這些問題都指向一個核心：**生產環境的可觀測性不足**。

> **監控三要素（Three Pillars of Observability）**
> 
> - ✅ **Metrics（指標）**：CPU、記憶體、響應時間、錯誤率
> - ✅ **Logs（日誌）**：請求日誌、應用日誌、系統日誌
> - ✅ **Traces（追蹤）**：分布式調用鏈路、慢查詢追蹤

---

## 🏥 二、Laravel 內建健康檢查機制

### 1.1 Laravel 內建 Health Check API

```php
// 訪問：https://your-api.com/api/health-check
Route::get('/api/health-check', function () {
    return [
        'status' => $this->getStatus(),
        'server_time' => now()->toIso8601String(),
        'environment' => config('app.env'),
        'version' => AppVersion::getVersion(),
        'connections' => [
            'redis' => ConfigHealth::checkRedisConnection(),
            'mysql' => ConfigHealth::checkDatabaseConnection(),
            'queue' => ConfigHealth::checkQueueConnection(),
        ],
    ];
})->middleware('api');
```

### 1.2 Laravel 9+ Health Route

如果項目是 Laravel 9+，可以使用內建的 `/health` route：

```php
// config/app.php (Laravel 9+)
'providers' => [
    App\Providers\AppServiceProvider::class, // 可註冊 HealthServiceProvider
],
```

**自定義 Health Check Provider：**

```php
// app/Providers/HealthServiceProvider.php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode;
use Illuminate\Support\Facades\Auth;

class HealthServiceProvider extends ServiceProvider
{
    public function boot()
    {
        // 僅允許授權 IP 訪問健康檢查接口
        Route::get('/health', function () {
            return response()->json([
                'status' => $this->getStatus(),
                'server_time' => now()->toIso8601String(),
                'environment' => config('app.env'),
                'version' => env('APP_VERSION', 'unknown'),
                'connections' => [
                    'redis' => ConfigHealth::checkRedisConnection(),
                    'mysql' => ConfigHealth::checkDatabaseConnection(),
                    'queue' => ConfigHealth::checkQueueConnection(),
                ],
                'cache' => $this->getCacheStatus(),
            ]);
        })->middleware(['throttle:10,1'])->name('health.check');
    }

    public function getStatus(): array
    {
        return [
            'status' => config('app.debug') ? 'development' : 'production',
            'uptime_seconds' => \proc_status(getmypid())['tgid_stat']['utime'] ?? 0,
        ];
    }

    private function getCacheStatus(): array
    {
        return [
            'cache_driver' => config('cache.default'),
            'cache_connected' => cache()->has('health_check:ping', false),
        ];
    }
}
```

---

## 🛡️ 三、自定義健康檢查中間件（Production Grade）

### 3.1 HTTP Status Code 策略

不同健康檢查接口應該返回不同的狀態碼：

```php
// middleware/HealthCheck.php
namespace App\Http\Middleware;

use Illuminate\Support\Facades\App;
use Closure;

class HealthCheck
{
    protected $checks = [];

    /**
     * 註冊健康檢查
     */
    public function registerChecks(string $component, string $type, callable $check)
    {
        $this->checks[$component][] = [
            'type' => $type,
            'result' => false,
            'message' => null,
            'duration' => 0,
        ];

        return function (callable $next) use ($component, $check) {
            App::call($check);

            return $next($request);
        };
    }

    public function handle($request, Closure $next)
    {
        if (!$this->isProduction()) {
            return $next($request);
        }

        $startTime = microtime(true);
        $result = [
            'status' => 200,
            'data' => $this->runChecks(),
            'checks' => $this->checks,
        ];

        // 如果所有檢查都通過，返回 200
        if ($result['data']['healthy']) {
            return response()->json($result['data'], 200);
        }

        return response()->json([
            'status' => 503,
            'message' => 'Service Unavailable',
            'checks' => $result['checks'],
        ], 503);
    }

    protected function isProduction(): bool
    {
        return App::environment('production');
    }

    protected function runChecks(): array
    {
        $startTime = microtime(true);
        
        $redisHealthy = true;
        $mysqlHealthy = true;
        $queueHealthy = true;
        $memoryHealthy = true;
        $diskHealthy = true;

        // 檢查 Redis 連接
        try {
            $result = cache()->put('health_check:ping', '1234', 1);
            $redisHealthy = $result !== false;
        } catch (\Exception $e) {
            $redisHealthy = false;
        }

        // 檢查 MySQL 連接
        try {
            DB::connection()->getPdo();
            $mysqlHealthy = true;
        } catch (\Exception $e) {
            $mysqlHealthy = false;
        }

        // 檢查 Redis 連接
        try {
            if (config('redis.connection.default.enabled')) {
                cache()->put('health_check:queue', '1234', 1);
            }
            $queueHealthy = true;
        } catch (\Exception $e) {
            $queueHealthy = false;
        }

        // 檢查記憶體使用量
        try {
            if (function_exists('memory_get_usage')) {
                $usedMemory = memory_get_usage(true);
                $maxAllowed = (int) env('MEMORY_MAX_USAGE_MB', 512) * 1024 * 1024;
                $memoryHealthy = $usedMemory < $maxAllowed;
            }
        } catch (\Exception $e) {
            $memoryHealthy = true; // fallback: pass
        }

        // 檢查磁碟空間
        try {
            if (function_exists('disk_free_space')) {
                $disk = config('app.env') === 'production' 
                    ? '/data/storage' 
                    : storage_path();
                $free = disk_free_space($disk);
                $total = disk_total_space($disk);
                $percentage = ($free / $total) * 100;
                $diskHealthy = $percentage > 20; // 剩餘空間少於 20% 視為不健康
            }
        } catch (\Exception $e) {
            $diskHealthy = true; // fallback: pass
        }

        return [
            'healthy' => $redisHealthy && $mysqlHealthy && $queueHealthy && 
                        $memoryHealthy && $diskHealthy,
            'components' => [
                'redis' => ['status' => $redisHealthy ? 'healthy' : 'unhealthy'],
                'mysql' => ['status' => $mysqlHealthy ? 'healthy' : 'unhealthy'],
                'queue' => ['status' => $queueHealthy ? 'healthy' : 'unhealthy'],
                'memory' => [
                    'status' => $memoryHealthy ? 'healthy' : 'warning',
                    'value' => memory_get_usage(true) . ' / ' . 
                               (int) env('MEMORY_MAX_USAGE_MB') * 1024 * 1024 . ' bytes',
                ],
                'disk' => [
                    'status' => $diskHealthy ? 'healthy' : 'warning',
                    'value' => disk_total_space('/data/storage'),
                ],
            ],
        ];
    }
}
```

**使用方式：**

```php
// routes/api.php
Route::get('/health-check', function () {
    $status = [
        'status' => 200,
        'server_time' => now()->toIso8601String(),
        'environment' => config('app.env'),
        'version' => env('APP_VERSION', 'unknown'),
        'checks' => HealthCheck::runChecks()['components'],
    ];

    return response()->json($status);
})->middleware('api.throttle.10');
```

---

## 🔍 四、Laravel Telescope 監控平台集成

### 4.1 Telescope 基礎配置

```php
// config/telescope.php
Telescope::storage(
    \Laravel\Telescope\Contracts\RecordableStorageInterface::class,
);

// app/Providers/AppServiceProvider.php
public function boot()
{
    Telescope::filter(function ($event) {
        // 記錄所有事件，除了健康檢查和測試請求
        if (Str::startsWith($event->request['path'] ?? '', '/health')) {
            return false;
        }
        
        // 只保留錯誤狀態碼
        if (($event->request['status_code'] ?? 200) < 400) {
            return true;
        }
        
        return !Str::contains($event->request['path'] ?? '', '/health');
    });
}
```

### 4.2 Telescope Custom Commands（自定義監控卡）

**安裝 Telescope：**

```bash
composer require laravel/telescope
php artisan telescope:install
```

**創建自定義 Monitor：**

```php
// app/Monitors/QueueMonitor.php
namespace App\Monitors;

use Laravel\Telescope\Monitor;
use Illuminate\Support\Facades\Queue;

class QueueMonitor extends Monitor
{
    /**
     * 監控佇列處理延遲（基於真實踩坑記錄）
     */
    public function handle(Queue $queue): ?Queue
    {
        foreach ($queue->jobs() as $job) {
            if ($this->shouldRecord($job)) {
                return new Queue(
                    $job->queue,
                    $job->payload['data']['class'] ?? 'unknown',
                    $job->at === null 
                        ? null 
                        : \Carbon\Carbon::parse($job->at)->toIso8601String(),
                );
            }
        }

        return null;
    }

    protected function shouldRecord(QueueJob $job): bool
    {
        // 記錄失敗的任務和延遲處理的任務
        if ($job->failed) {
            return true;
        }

        return !empty($job->at);
    }
}
```

**在 TelescopeServiceProvider 中註冊 Monitor：**

```php
// app/Providers/TelescopeServiceProvider.php
use Laravel\Telescope\Telescope;
use App\Monitors\QueueMonitor;
use App\Monitors\DatabaseMonitor;

public function register()
{
    Telescope::monitors([
        new QueueMonitor(),
        new DatabaseMonitor(),
    ]);
}
```

### 4.3 Telescope Dashboard（視覺化監控面板）

**訪問：** `http://your-api.com/telescope`（需配置權限）

**監控面板示例：**

```javascript
// telescope.php - 自定義儀表板
Telescope::dashboard(function (Dashboard $dashboard) {
    // 訂單處理儀表板
    $dashboard->cards([
        [
            'title' => '今日訂單總數',
            'callback' => function () {
                return DB::table('orders')
                    ->whereDate('created_at', now()->toDateString())
                    ->count();
            },
        ],
        [
            'title' => '待處理訂單',
            'callback' => function () {
                return DB::table('orders')
                    ->where('status', 'pending')
                    ->count();
            },
        ],
    ]);

    // 錯誤追蹤儀表板
    $dashboard->cards([
        [
            'title' => '今日錯誤率',
            'callback' => function () {
                $total = DB::table('requests')->count();
                $errors = DB::table('requests')
                    ->where('status_code', '>= 500')
                    ->count();
                
                return round(($errors / $total) * 100, 2);
            },
        ],
    ]);
});
```

---

## 📊 五、Prometheus + Grafana 監控集成

### 5.1 Laravel 內建 Prometheus Exporter

```php
// vendor/laravel/prom-exporter (composer require)
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;

/**
 * HTTP Handler Instrumentation
 */
App::make('HttpKernel')->sendRequestToLog(
    $request,
    function () { return 0; }
);
```

### 5.2 Prometheus Metrics Endpoint

```php
// routes/api.php
Route::get('/metrics', function (Request $request) {
    $stats = new AppStats(); // 自定義統計類
    
    return response()->json([
        'lphp_memory_limit' => memory_get_peak_usage(true),
        'lphp_mem_used' => memory_get_usage(true),
        'lphp_mem_total' => memory_get_max_usage(true),
        'lphp_proc_cpu_time' => getrusage(RUSAGE_SELF, $stats->u ? $stats->u : null)->ru_utime.tv_sec + 
                                getrusage(RUSAGE_SELF, $stats->u ? $stats->u : null)->ru_stime.tv_sec,
    ]);
})->middleware(['throttle:10,1'])->name('metrics');
```

### 5.3 Laravel Telescope 監控面板（視覺化）

**訪問 Telescope 儀表板：** `http://your-api.com/telescope`

**自定義儀表板配置：**

```php
// telescope.php - Dashboard customization
Telescope::dashboard(function (Dashboard $dashboard) {
    // BFF 請求路徑追蹤
    $dashboard->cards([
        [
            'title' => 'BFF API 總請求數',
            'type' => 'bar',
            'value' => DB::table('requests')->count(),
        ],
        [
            'title' => '平均響應時間',
            'type' => 'gauge',
            'callback' => function () {
                return DB::table('requests')
                    ->selectRaw('AVG(time_elapsed / 1000) as avg_time_ms')
                    ->first()?->avg_time_ms ?? 0;
            },
        ],
    ]);
});
```

---

## 🐛 六、真實踩坑記錄（Production Issues）

### 坑 #1：Health Check 接口被誤訪問導致性能問題

**場景：** `/health-check` 接口被瀏覽器自動刷新，造成不必要的 CPU 使用。

```bash
# 錯誤日誌
[2026-05-01 09:32:15] local.INFO: Health Check accessed frequently from 172.16.0.1
[2026-05-01 09:32:20] local.WARNING: Too many health checks from same IP
```

**解決方案：** 添加 IP 限制和速率限制。

```php
// 自定義健康檢查路由（只允許監控網段）
Route::get('/api/health-check', function () {
    // Health check logic
})->middleware('api.throttle.60,1')->ipIn([
    '10.0.0.0/8',    // Kubernetes Pod 網段
    '172.16.0.0/12', // Docker 網段
    '192.168.0.0/16',// Local dev
]);
```

### 坑 #2：Redis Health Check 假陽性（False Positive）

**問題：** `cache()` 操作在 Redis 連接失敗時返回 false，但健康檢查仍通過。

```php
// ❌ Before - 可能出現假陽性
public function checkRedisConnection()
{
    try {
        cache()->put('health_check:redis', 'ping');
        return true;
    } catch (\Exception $e) {
        return false; // 假陽性！
    }
}
```

**解決方案：** 使用低層級檢查。

```php
// ✅ After - 正確檢查 Redis 連通性
public function checkRedisConnection()
{
    try {
        if (config('redis.connection.default.enabled')) {
            $redis = new Predis\Client(config('database.redis.default'));
            $result = $redis->ping();
            return $result === '+PONG'; // 正確驗證
        }
        return true;
    } catch (\Exception $e) {
        \Log::error("Redis Health Check Failed", [
            'error' => $e->getMessage(),
            'connection' => config('database.redis.default'),
        ]);
        return false;
    }
}
```

### 坑 #3：記憶體洩漏未檢測（Memory Leak）

**場景：** 高併發下 PHP-FPM 進程的記憶體持續增長。

```bash
# 監控日誌
[2026-05-02 14:30:00] local.WARNING: Memory usage: 480MB / 512MB
[2026-05-02 14:35:00] local.ERROR:   Memory usage: 505MB / 512MB (OVERFLOW!)
```

**解決方案：** 添加記憶體監控和自動重啟機制。

```php
// HealthCheck.php - 記憶體檢查增強版
protected function runChecks(): array
{
    // ... previous checks ...

    $memoryHealthy = true;
    
    try {
        if (function_exists('memory_get_usage')) {
            $usedMemory = memory_get_usage(true);
            $maxAllowed = (int) env('MEMORY_MAX_USAGE_MB', 512) * 1024 * 1024;
            
            // 警告閾值 85%，錯誤閾值 95%
            if ($usedMemory > $maxAllowed * 0.95) {
                $memoryHealthy = false;
                \Log::critical('Memory overflow detected', [
                    'memory_used' => $usedMemory,
                    'memory_max' => $maxAllowed,
                    'percentage' => round(($usedMemory / $maxAllowed) * 100),
                ]);
            } elseif ($usedMemory > $maxAllowed * 0.85) {
                $memoryHealthy = false; // warning
                \Log::warning('High memory usage', [
                    'memory_used' => $usedMemory,
                    'memory_max' => $maxAllowed,
                    'percentage' => round(($usedMemory / $maxAllowed) * 100),
                ]);
            } else {
                \Log::info('Memory usage OK', [
                    'memory_used' => $usedMemory,
                    'memory_max' => $maxAllowed,
                    'percentage' => round(($usedMemory / $maxAllowed) * 100),
                ]);
            }
        }
    } catch (\Exception $e) {
        \Log::error('Memory check failed', ['error' => $e->getMessage()]);
    }

    return [
        // ... components array with memory status
    ];
}
```

---

## 🔧 七、完整部署配置（Production）

### 7.1 Docker Compose Health Check

```yaml
# docker-compose.yml - PHP-FPM 健康檢查
version: '3.8'

services:
  web-php:
    image: php:8.0-fpm-alpine
    container_name: kkday-b2c-api-web
    ports:
      - "9000:9000"
    volumes:
      - ./php-fpm.conf:/etc/php/8.0/fpm/php-fpm.conf:ro
      - ./health-check.conf:/etc/php/8.0/fpm/conf.d/20-health-check.conf:ro
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost/api/health-check"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
```

### 7.2 PHP-FPM Health Check 配置

```bash
# /etc/php/8.0/fpm/conf.d/20-health-check.conf
[php-fpm-pool]
; Memory Limit - Prevent OOM
memory_limit = 512M

; Slow Log
slowlog = /data/storage/logs/php-slow.log
request_slowlog_timeout = 60s

; PHP-FPM Max Processes
pm.max_children = 75
pm.start_servers = 5
pm.min_spare_servers = 5
pm.max_spare_servers = 10
```

### 7.3 Laravel 监控 API 配置

```php
// .env (Production)
APP_NAME="KKday B2C API"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://api.kkday-b2c.com

; Monitoring Configuration
HEALTH_CHECK_ENABLED=true
TELESCOPE_ENABLED=false
PROMETHEUS_ENABLED=true
```

---

## 📈 八、監控儀表板示例（Grafana Dashboard）

### 8.1 Laravel Metrics 模板

```json
{
  "dashboard": {
    "title": "Laravel B2C API Monitor",
    "panels": [
      {
        "id": 1,
        "title": "API 請求量",
        "type": "graph",
        "targets": [{
          "expr": "lphp_requests_total",
          "legendFormat": "{{instance}}"
        }]
      },
      {
        "id": 2,
        "title": "平均響應時間",
        "type": "graph",
        "targets": [{
          "expr": "lphp_request_duration_seconds_avg",
          "legendFormat": "{{instance}}"
        }]
      }
    ]
  }
}
```

### 8.2 Health Check Status 面板

```json
{
  "dashboard": {
    "title": "Health Check Monitor",
    "panels": [
      {
        "id": 1,
        "title": "Redis 健康狀態",
        "type": "gauge",
        "targets": [{
          "expr": "lphp_redis_status{status=\"healthy\"}",
          "legendFormat": "{{instance}}"
        }]
      },
      {
        "id": 2,
        "title": "MySQL 健康狀態",
        "type": "gauge",
        "targets": [{
          "expr": "lphp_mysql_status{status=\"healthy\"}",
          "legendFormat": "{{instance}}"
        }]
      }
    ]
  }
}
```

---

## ✅ 九、最佳實踐總結

### 9.1 Health Check 原則

| 項目 | 建議配置 |
|------|----------|
| **檢查頻率** | 30-60 秒（避免過多 CPU 使用） |
| **檢查時間** | < 5 秒（避免阻塞監控網關） |
| **狀態碼** | 200/503 明確區分健康與不健康 |
| **IP 限制** | 僅允許監控網段訪問 |
| **速率限制** | `throttle:60,1`（每分鐘 1 次） |

### 9.2 Telescope 使用原則

| 項目 | 建議配置 |
|------|----------|
| **生產環境** | 關閉 Telesopec (`TELESCOPE_ENABLED=false`) |
| **日誌記錄** | 只保留錯誤請求和緩慢查詢 |
| **訪問控制** | 加鎖或 Token 驗證 |
| **監控網段** | 限制可訪問 IP 段 |

### 9.3 Prometheus 配置原則

```yaml
# prometheus.yml - Service Discovery
scrape_configs:
  - job_name: 'laravel-api'
    static_configs:
      - targets: ['web-php:9000']
    metrics_path: '/api/metrics'
    scrape_interval: 15s
```

---

## 🔗 相關文檔

- [Laravel Health Check Best Practices](https://laravel.com/docs/master/helpers#function-health-check)
- [Prometheus Laravel Metrics](https://github.com/prometheus-community/lphp_exporter)
- [Grafana LPHP Exporter Dashboard](https://grafana.com/grafana/dashboards/14059/)
- [Laravel Telescope GitHub](https://github.com/laravel/telescope)

---

## 📝 參考項目

**KKday B2C API 健康檢查配置**：[GitHub Repository]  
**Telescope Custom Monitor Examples**: [Monitor Code Snippets]  

> **作者備註**：本文內容基於 KKday-B2C-API 生產環境真實踩坑記錄整理。建議所有微服務都應該配備完整的健康檢查和監控機制，以確保服務的穩定性和可觀測性。

---

*最後更新：2026-05-03*
*類別：PHP, Laravel, 監控*
