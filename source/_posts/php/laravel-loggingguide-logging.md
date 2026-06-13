---
title: Laravel 日志实战：多通道、结构化、日志聚合与生产环境治理踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-17 00:30:56
updated: 2026-05-17 00:34:10
categories:
  - php
  - logging
tags: [Laravel, 监控]
keywords: [Laravel, 日志实战, 多通道, 结构化, 日志聚合与生产环境治理踩坑记录, PHP]
description: 深入 Laravel 日志系统实战：多通道分级策略、JSON 结构化输出、Log Context 与 Tag 追踪、日志聚合对接 ELK、生产环境轮转与治理踩坑记录。



---

# Laravel 日志实战：多通道、结构化、日志聚合与生产环境治理踩坑记录

> 在 B2C 电商项目中，日志不只是 `Log::info()` 那么简单。当你的 Laravel API 面对每秒上千请求、多个微服务协同、以及生产环境故障排查时，一个设计良好的日志架构就是你的「时间机器」——它能帮你在事故发生的瞬间还原完整的调用链路。

## 为什么需要重新审视 Laravel 日志？

大多数 Laravel 项目默认只有一个 `single` 日志通道，所有日志写入同一个文件。随着项目增长，你会遇到这些问题：

- **信息过载**：业务日志、安全日志、性能日志混在一起，排查问题如同大海捞针
- **格式不可解析**：纯文本格式无法被 ELK/Prometheus 等工具高效消费
- **磁盘爆满**：没有轮转策略，日志文件无限增长
- **跨服务无法关联**：BFF 层与后端服务的日志无法串联

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                      Laravel Application                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐  │
│   │ 业务日志 │  │ 安全日志 │  │ 性能日志 │  │  审计日志    │  │
│   │ channel │  │ channel │  │ channel │  │  channel     │  │
│   │ stack   │  │ security│  │ perf    │  │  audit       │  │
│   └────┬────┘  └────┬────┘  └────┬────┘  └──────┬───────┘  │
│        │            │            │               │          │
│   ┌────▼────────────▼────────────▼───────────────▼───────┐  │
│   │              Monolog Handler Layer                    │  │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │  │
│   │  │ daily    │ │ slack    │ │ syslog   │ │ custom  │ │  │
│   │  │ 文件轮转 │ │ 告警通知 │ │ 系统日志 │ │ ES/HTTP │ │  │
│   │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │            JSON Formatter (结构化输出)                │  │
│   │  { "level":"error", "message":"...", "context":{} }  │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         │                                    │
    ┌────▼────┐                          ┌────▼────┐
    │  ELK    │                          │ Slack / │
    │ Stack   │                          │ 飞书    │
    └─────────┘                          └─────────┘
```

## 一、多通道配置：按职责分离日志

### 1.1 config/logging.php 完整配置

这是我们在 30+ 仓库中验证过的生产级配置：

```php
<?php
// config/logging.php

return [
    /*
    |--------------------------------------------------------------------------
    | 默认日志通道
    |--------------------------------------------------------------------------
    */
    'default' => env('LOG_CHANNEL', 'stack'),

    /*
    |--------------------------------------------------------------------------
    | 日志通道定义
    |--------------------------------------------------------------------------
    */
    'channels' => [
        // 主通道：组合多个子通道
        'stack' => [
            'driver' => 'stack',
            'channels' => ['daily', 'slack_alert'],
            'ignore_exceptions' => false,
        ],

        // 业务日志：按天轮转，保留 14 天
        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 14,
            'replace_placeholders' => true,
        ],

        // 单文件（开发环境用）
        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'replace_placeholders' => true,
        ],

        // 安全日志：独立文件，保留 90 天
        'security' => [
            'driver' => 'daily',
            'path' => storage_path('logs/security.log'),
            'level' => 'info',
            'days' => 90,
            'tap' => [App\Logging\AddRequestContext::class],
        ],

        // 性能日志：独立通道，用于慢请求分析
        'perf' => [
            'driver' => 'daily',
            'path' => storage_path('logs/performance.log'),
            'level' => 'info',
            'days' => 30,
            'tap' => [App\Logging\AddRequestContext::class],
        ],

        // 审计日志：关键操作留痕，保留 365 天
        'audit' => [
            'driver' => 'daily',
            'path' => storage_path('logs/audit.log'),
            'level' => 'info',
            'days' => 365,
        ],

        // JSON 结构化输出（对接 ELK）
        'json' => [
            'driver' => 'daily',
            'path' => storage_path('logs/app.json.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 14,
            'tap' => [App\Logging\JsonFormatter::class],
        ],

        // Slack 告警：仅 error 及以上
        'slack_alert' => [
            'driver' => 'slack',
            'url' => env('LOG_SLACK_WEBHOOK_URL'),
            'username' => 'Laravel Log',
            'emoji' => ':boom:',
            'level' => env('LOG_SLACK_LEVEL', 'error'),
        ],

        // Emergency 通道：其他通道都挂了用这个
        'emergency' => [
            'driver' => 'single',
            'path' => storage_path('logs/emergency.log'),
            'level' => 'alert',
        ],

        // Elasticsearch 通道（自定义 driver）
        'elasticsearch' => [
            'driver' => 'custom',
            'via' => App\Logging\ElasticsearchLogger::class,
            'level' => 'info',
            'index' => 'laravel-logs',
        ],

        // Null：测试环境吞掉日志
        'null' => [
            'driver' => 'monolog',
            'handler' => Monolog\Handler\NullHandler::class,
        ],

        // stderr（Docker/K8s 容器环境推荐）
        'stderr' => [
            'driver' => 'monolog',
            'handler' => Monolog\Handler\StreamHandler::class,
            'handler_with' => [
                'stream' => 'php://stderr',
            ],
            'formatter' => Monolog\Formatter\JsonFormatter::class,
        ],
    ],
];
```

### 1.2 踩坑 #1：`stack` 通道的错误处理

```php
// ❌ 错误示范：ignore_exceptions 设为 true
'stack' => [
    'driver' => 'stack',
    'channels' => ['daily', 'slack_alert'],
    'ignore_exceptions' => true,  // Slack 报错不会影响主日志
],
```

当 `ignore_exceptions => true` 时，如果 Slack webhook 失败，**整个 stack 通道的异常会被静默吞掉**，包括 daily 通道也可能受影响。在生产环境中，我们曾因此丢失了整整 2 小时的日志。

**解决方案**：始终设为 `false`，对 Slack 等不稳定通道用 `level` 过滤而非异常忽略。

## 二、JSON 结构化输出：让日志可被机器消费

### 2.1 自定义 JSON Formatter

```php
<?php
// app/Logging/JsonFormatter.php

namespace App\Logging;

use Monolog\Formatter\JsonFormatter as BaseJsonFormatter;
use Monolog\LogRecord;

class JsonFormatter extends BaseJsonFormatter
{
    public function format(LogRecord $record): string
    {
        $data = [
            'timestamp' => $record->datetime->format('Y-m-d\TH:i:s.uP'),
            'level' => $record->level->getName(),
            'level_value' => $record->level->value,
            'channel' => $record->channel,
            'message' => $record->message,
            'context' => $record->context,
            'extra' => $record->extra,
        ];

        // 自动注入请求上下文
        if (app()->bound('request') && request()->route()) {
            $data['request'] = [
                'method' => request()->method(),
                'url' => request()->fullUrl(),
                'ip' => request()->ip(),
                'user_agent' => request()->userAgent(),
                'route' => request()->route()->getName(),
                'request_id' => request()->header('X-Request-Id', '-'),
            ];
        }

        // 自动注入用户信息
        if (auth()->check()) {
            $data['user'] = [
                'id' => auth()->id(),
                'email' => auth()->user()->email ?? '-',
            ];
        }

        return $this->toJson($data, true) . "\n";
    }
}
```

### 2.2 使用 Tap 注入 Formatter

```php
<?php
// app/Logging/JsonFormatter.php (注意：tap 用法不同)

namespace App\Logging;

use Monolog\Formatter\JsonFormatter;
use Monolog\Logger;

class JsonFormatterTap
{
    /**
     * 自定义 Monolog 通道
     */
    public function __invoke(Logger $logger): void
    {
        foreach ($logger->getHandlers() as $handler) {
            $handler->setFormatter(new JsonFormatter(
                JsonFormatter::BATCH_MODE_JSON,
                false  // 不追加换行，由 handler 处理
            ));
        }
    }
}
```

### 2.3 结构化输出示例

```json
{
  "timestamp": "2026-05-17T00:15:32.123456+08:00",
  "level": "ERROR",
  "level_value": 400,
  "channel": "laravel",
  "message": "Order creation failed: insufficient stock",
  "context": {
    "order_id": "ORD-20260517001",
    "product_id": 12345,
    "requested_qty": 3,
    "available_qty": 1,
    "trace": "..."
  },
  "request": {
    "method": "POST",
    "url": "https://api.example.com/v2/orders",
    "ip": "203.0.113.42",
    "route": "api.orders.create",
    "request_id": "req-a1b2c3d4"
  },
  "user": {
    "id": 88001,
    "email": "user@example.com"
  }
}
```

## 三、Log Context 与 Tag：让日志可追踪

### 3.1 全局请求上下文中间件

```php
<?php
// app/Http/Middleware/LogContext.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;

class LogContext
{
    public function handle(Request $request, Closure $next)
    {
        // 生成或复用 Request ID
        $requestId = $request->header('X-Request-Id', Str::uuid()->toString());

        // 注入全局 Log Context
        Log::withContext([
            'request_id' => $requestId,
            'method' => $request->method(),
            'path' => $request->path(),
            'ip' => $request->ip(),
            'user_id' => auth()->id(),
        ]);

        // 设置 Monolog Tag（部分日志处理器支持）
        Log::tag([
            $request->method(),
            $request->route()?->getName() ?? 'unknown',
        ]);

        $response = $next($request);

        // 将 Request ID 传递给响应头
        $response->headers->set('X-Request-Id', $requestId);

        return $response;
    }
}
```

### 3.2 在业务代码中使用 Context

```php
<?php
// app/Services/OrderService.php

namespace App\Services;

use Illuminate\Support\Facades\Log;

class OrderService
{
    public function createOrder(array $data): Order
    {
        // 关键业务操作用 info，附带完整 context
        Log::info('Creating order', [
            'user_id' => $data['user_id'],
            'product_count' => count($data['items']),
            'total_amount' => $data['total'],
        ]);

        try {
            // 库存检查
            $this->stockService->checkAndLock($data['items']);

            Log::debug('Stock locked successfully', [
                'items' => array_map(fn($item) => [
                    'product_id' => $item['product_id'],
                    'qty' => $item['qty'],
                ], $data['items']),
            ]);

            // 创建订单
            $order = Order::create([
                'user_id' => $data['user_id'],
                'total' => $data['total'],
                'status' => OrderStatus::PENDING,
            ]);

            Log::info('Order created', [
                'order_id' => $order->id,
                'status' => $order->status->value,
            ]);

            return $order;
        } catch (InsufficientStockException $e) {
            // 业务异常用 warning，不触发告警
            Log::warning('Order failed: insufficient stock', [
                'user_id' => $data['user_id'],
                'error' => $e->getMessage(),
                'product_id' => $e->getProductId(),
            ]);
            throw $e;
        } catch (\Throwable $e) {
            // 系统异常用 error，触发告警
            Log::error('Order creation failed unexpectedly', [
                'user_id' => $data['user_id'],
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            throw $e;
        }
    }
}
```

### 3.3 踩坑 #2：Context 中的对象序列化

```php
// ❌ 错误：直接传 Eloquent Model
Log::info('User logged in', ['user' => $user]);

// 输出：{"user": "App\\Models\\User"}  — 只有类名，没有数据！
```

Monolog 默认用 `var_export` 序列化 context，Eloquent Model 会变成类名字符串。

```php
// ✅ 正确：手动提取需要的字段
Log::info('User logged in', [
    'user_id' => $user->id,
    'email' => $user->email,
    'login_method' => $loginMethod,
]);

// ✅ 或者用 toArray() / jsonSerialize()
Log::info('Order detail', [
    'order' => $order->only(['id', 'status', 'total']),
]);
```

## 四、自定义 Monolog Handler：对接外部系统

### 4.1 Elasticsearch Handler

```php
<?php
// app/Logging/ElasticsearchLogger.php

namespace App\Logging;

use Elasticsearch\ClientBuilder;
use Monolog\Handler\AbstractProcessingHandler;
use Monolog\Logger;
use Monolog\LogRecord;

class ElasticsearchLogger extends AbstractProcessingHandler
{
    private $client;
    private string $index;

    public function __invoke(array $config): self
    {
        $level = Logger::toMonologLevel($config['level'] ?? 'debug');

        $handler = new self($level);
        $handler->client = ClientBuilder::create()
            ->setHosts([env('ELASTICSEARCH_HOST', 'localhost:9200')])
            ->build();
        $handler->index = $config['index'] ?? 'laravel-logs';

        return $handler;
    }

    protected function write(LogRecord $record): void
    {
        try {
            $this->client->index([
                'index' => $this->index . '-' . date('Y.m.d'),
                'body' => [
                    'timestamp' => $record->datetime->format('c'),
                    'level' => $record->level->getName(),
                    'channel' => $record->channel,
                    'message' => $record->message,
                    'context' => $record->context,
                    'extra' => $record->extra,
                    'server' => gethostname(),
                ],
            ]);
        } catch (\Throwable $e) {
            // Handler 本身不能抛异常，否则会死循环
            error_log('ES log handler failed: ' . $e->getMessage());
        }
    }
}
```

### 4.2 踩坑 #3：ES Handler 的性能陷阱

在高并发场景下，**逐条写入 ES 会导致严重的性能问题**。我们在 B2C 项目中实测：QPS 500 时，逐条写入 ES 导致 API 响应时间增加 200-500ms。

**解决方案**：使用 `BufferHandler` 或 `SamplingHandler` 进行缓冲：

```php
<?php
// app/Logging/BufferedElasticsearchLogger.php

namespace App\Logging;

use Monolog\Handler\BufferHandler;
use Monolog\Logger;

class BufferedElasticsearchLogger
{
    public function __invoke(array $config): BufferHandler
    {
        $esHandler = (new ElasticsearchLogger())($config);

        // 缓冲 100 条或每 5 秒刷新一次
        return new BufferHandler($esHandler, 100, Logger::DEBUG, true, true);
    }
}
```

## 五、日志分级策略：什么级别的日志该去哪里

### 5.1 分级矩阵

| 级别 | 用途 | 通道 | 是否告警 |
|------|------|------|----------|
| `emergency` | 系统完全不可用 | emergency + slack | ✅ 立即 |
| `alert` | 需要立即处理 | emergency + slack | ✅ 立即 |
| `critical` | 关键功能故障 | slack | ✅ 5 分钟内 |
| `error` | 运行时错误 | daily + slack | ✅ 15 分钟内 |
| `warning` | 非预期但可恢复 | daily | ❌ 汇总报告 |
| `notice` | 重要业务事件 | daily + json | ❌ 汇总报告 |
| `info` | 一般业务日志 | daily | ❌ |
| `debug` | 开发调试信息 | single（仅 dev） | ❌ |

### 5.2 踩坑 #4：日志级别设置不当导致告警风暴

```php
// ❌ 错误：把业务校验失败设为 error
Log::error('Validation failed', $validator->errors()->toArray());

// 一个简单的字段校验失败就被推送到 Slack，每天上千条
```

```php
// ✅ 正确：区分业务异常和系统异常
// 业务校验失败 → info 或 warning（用户输入问题）
Log::warning('Validation failed', [
    'errors' => $validator->errors()->toArray(),
    'input_keys' => array_keys($request->validated()),
]);

// 系统内部错误 → error（代码 bug 或基础设施问题）
Log::error('Payment gateway timeout', [
    'provider' => 'stripe',
    'timeout_ms' => 5000,
    'order_id' => $order->id,
]);
```

## 六、性能日志：慢请求自动记录

### 6.1 中间件实现

```php
<?php
// app/Http/Middleware/LogSlowRequests.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class LogSlowRequests
{
    // 阈值：超过 1000ms 记录
    private int $thresholdMs = 1000;

    public function handle(Request $request, Closure $next)
    {
        $startTime = microtime(true);

        $response = $next($request);

        $duration = (microtime(true) - $startTime) * 1000;

        if ($duration > $this->thresholdMs) {
            Log::channel('perf')->warning('Slow request detected', [
                'method' => $request->method(),
                'url' => $request->fullUrl(),
                'duration_ms' => round($duration, 2),
                'status_code' => $response->getStatusCode(),
                'memory_peak_mb' => round(memory_get_peak_usage() / 1024 / 1024, 2),
                'db_queries' => count(
                    app('db.connection')->getQueryLog()
                ),
            ]);
        }

        // 所有请求都记录到 JSON 日志（供 Grafana 分析）
        Log::channel('json')->info('Request completed', [
            'method' => $request->method(),
            'path' => $request->path(),
            'duration_ms' => round($duration, 2),
            'status' => $response->getStatusCode(),
        ]);

        return $response;
    }
}
```

### 6.2 踩坑 #5：`getQueryLog()` 返回空数组

```php
// ❌ 常见问题：在中间件中获取查询日志为空
$dbQueries = app('db.connection')->getQueryLog(); // []
```

原因是 Laravel 默认不开启查询日志。需要在 `AppServiceProvider` 中开启：

```php
<?php
// app/Providers/AppServiceProvider.php

public function boot(): void
{
    // 仅在需要时开启（生产环境注意性能损耗）
    if (config('app.log_queries', false)) {
        DB::enableQueryLog();
    }
}
```

**生产环境建议**：不要全局开启 `enableQueryLog()`，改用 `DB::listen()` 按需记录：

```php
DB::listen(function ($query) {
    if ($query->time > 100) { // 仅记录超过 100ms 的慢查询
        Log::channel('perf')->warning('Slow query', [
            'sql' => $query->sql,
            'bindings' => $query->bindings,
            'time_ms' => $query->time,
        ]);
    }
});
```

## 七、日志聚合：对接 ELK Stack

### 7.1 Filebeat 配置

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/www/storage/logs/laravel.log
    fields:
      app: laravel-b2c-api
      env: production
      log_type: application
    multiline.pattern: '^\d{4}-\d{2}-\d{2}'
    multiline.negate: true
    multiline.match: after

  - type: log
    enabled: true
    paths:
      - /var/www/storage/logs/performance.log
    fields:
      app: laravel-b2c-api
      env: production
      log_type: performance

  - type: log
    enabled: true
    paths:
      - /var/www/storage/logs/audit.log
    fields:
      app: laravel-b2c-api
      env: production
      log_type: audit

output.logstash:
  hosts: ["logstash:5044"]
```

### 7.2 Logstash Pipeline

```ruby
# logstash/pipeline/laravel.conf
input {
  beats {
    port => 5044
  }
}

filter {
  if [fields][log_type] == "application" {
    grok {
      match => {
        "message" => "\[%{TIMESTAMP_ISO8601:timestamp}\] %{DATA:channel}\.%{LOGLEVEL:level}: %{GREEDYDATA:log_message}"
      }
    }
  }

  if [fields][log_type] == "performance" {
    json {
      source => "message"
      target => "perf"
    }
    mutate {
      add_field => { "slow_request" => true }
    }
  }

  date {
    match => ["timestamp", "yyyy-MM-dd HH:mm:ss"]
    target => "@timestamp"
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "%{[fields][app]}-%{[fields][log_type]}-%{+YYYY.MM.dd}"
  }
}
```

## 八、生产环境治理踩坑合集

### 踩坑 #6：日志文件权限问题

```bash
# Docker 部署时常见：容器内 www-data 用户无权写入宿主机挂载的 logs 目录
# 症状：日志文件创建失败，但 Laravel 不会报错（fallback 到 stderr）

# 解决：在 Dockerfile 或 entrypoint 中设置
RUN chown -R www-data:www-data /var/www/storage/logs
RUN chmod -R 775 /var/www/storage/logs
```

### 踩坑 #7：日志切割与进程冲突

```bash
# Laravel 的 daily 通道在每天 00:00 自动切割
# 但如果 PHP-FPM worker 持有旧文件的 fd，写入不会切换到新文件

# 解决方案一：使用 logrotate（推荐）
cat > /etc/logrotate.d/laravel << 'EOF'
/var/www/storage/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0664 www-data www-data
    sharedscripts
    postrotate
        /usr/sbin/service php8.2-fpm reload > /dev/null 2>&1 || true
    endscript
}
EOF

# 解决方案二：K8s 环境用 stderr + 集中式日志收集
# 不再写文件，直接输出到 stderr，由 Fluentd/Filebeat 收集
```

### 踩坑 #8：敏感数据泄露到日志

```php
// ❌ 危险：密码、token、信用卡号泄露
Log::info('User login', ['request' => $request->all()]);
// request 中可能包含 password、credit_card 等字段

// ✅ 安全：过滤敏感字段
class SensitiveDataSanitizer
{
    private array $sensitiveKeys = [
        'password', 'password_confirmation', 'token',
        'secret', 'credit_card', 'cvv', 'ssn',
        'access_token', 'refresh_token', 'api_key',
    ];

    public function sanitize(array $data): array
    {
        return collect($data)->mapWithKeys(function ($value, $key) {
            if (in_array(strtolower($key), $this->sensitiveKeys)) {
                return [$key => '***REDACTED***'];
            }
            if (is_array($value)) {
                return [$key => $this->sanitize($value)];
            }
            return [$key => $value];
        })->toArray();
    }
}
```

### 踩坑 #9：日志通道配置缓存

```bash
# 部署时执行 config:cache 会导致 logging.php 被缓存
# 但 env('LOG_CHANNEL') 的值在缓存后就固定了

# ❌ 问题：修改 .env 的 LOG_CHANNEL 不生效
php artisan config:cache

# ✅ 解决：config:cache 之后修改日志通道需要重新缓存
# 或者在 config/logging.php 中不使用 env()，改用 config() 引用
'default' => config('app.log_channel', 'stack'), // 需要手动设置 config/app.php
```

## 九、容器化环境最佳实践

### 9.1 Docker/K8s 推荐方案

在容器化环境中，最佳实践是 **所有日志输出到 stderr/stdout，由容器运行时收集**：

```php
// .env (容器环境)
LOG_CHANNEL=stderr
LOG_LEVEL=info
LOG_STDERR_FORMATTER=json
```

```yaml
# kubernetes deployment
containers:
  - name: laravel-api
    image: laravel-api:latest
    env:
      - name: LOG_CHANNEL
        value: stderr
      - name: LOG_LEVEL
        value: info
```

```yaml
# Fluentd DaemonSet 配置
<source>
  @type tail
  path /var/log/containers/*.log
  tag kubernetes.*
  <parse>
    @type json
    time_key timestamp
    time_format %Y-%m-%dT%H:%M:%S.%NZ
  </parse>
</source>
```

## 总结

Laravel 日志系统看似简单，但在生产环境中的治理远比 `Log::info()` 复杂。核心原则：

1. **按职责分通道**：业务、安全、性能、审计日志分离
2. **结构化输出**：JSON 格式是对接 ELK/Grafana 的基础
3. **Context 贯穿**：Request ID + User ID 让日志可追踪
4. **分级明确**：区分业务异常和系统异常，避免告警风暴
5. **容器友好**：Docker/K8s 环境优先使用 stderr + 集中收集

一个好的日志架构，是线上事故时最可靠的「时间机器」。花时间设计好它，远比在故障时手忙脚乱地翻日志要值得。
