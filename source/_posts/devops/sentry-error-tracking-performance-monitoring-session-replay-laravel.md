---
title: Sentry 实战：2026 年版错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成
date: 2026-06-02 00:00:00
tags: [Sentry, 错误追踪, 性能监控, Session Replay, Laravel]
keywords: [Sentry, Session Replay, Laravel, 年版错误追踪深度使用, 性能监控, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: Sentry 2026 年版错误追踪深度实战，涵盖 Laravel 集成、性能监控、Session Replay 用户操作回放、Source Map 精确定位前端错误、面包屑链路追踪等核心功能。详解采样率配置、数据脱敏清洗、告警规则设计与 Release Tracking 部署策略，帮助开发团队从「看日志猜错误」升级到「一键定位根因」的高效错误追踪工作流。
---


# Sentry 实战：2026 年版错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成

## 前言

你的线上应用又崩了。

用户反馈说"页面打不开"，但你翻遍了 Laravel 的 `storage/logs/laravel.log`，只找到一堆模糊的错误信息。你不知道是谁触发的、在什么场景下触发的、用户做了什么操作导致了这个错误。于是你开始复现——在本地试了 20 分钟，无法复现。最后你只能回复用户"请清一下缓存试试"。

这就是没有错误追踪系统的真实写照。

**Sentry** 是目前最流行的应用错误追踪平台，它不仅捕获异常和错误，还能告诉你错误发生时的完整上下文：用户信息、请求参数、堆栈追踪、面包屑（操作链路），甚至可以回放用户操作的视频。2026 年的 Sentry 在性能监控（Performance Monitoring）、Session Replay、Profiling 等方面已经有了长足的进步，从单纯的"错误追踪工具"进化为了完整的"应用可观测性平台"。

本文将从 Laravel 集成开始，深入讲解 Sentry 的各项功能，并分享生产环境中的实战经验。

---

## 一、为什么选择 Sentry？

### 1.1 错误追踪方案对比

| 特性 | Sentry | Bugsnag | Rollbar | New Relic Errors |
|-----|--------|---------|---------|-----------------|
| **开源** | ✅ 可自托管 | ❌ | ❌ | ❌ |
| **免费额度** | 5K 错误/月 | 7.5K/月 | 无限（受限） | 100GB/月 |
| **语言支持** | 40+ 语言 | 30+ | 30+ | 广泛 |
| **性能监控** | ✅ 内置 | ⚠️ 有限 | ⚠️ 有限 | ✅ 强 |
| **Session Replay** | ✅ | ❌ | ❌ | ❌ |
| **Profiling** | ✅ | ❌ | ❌ | ✅ |
| **Source Map** | ✅ | ✅ | ✅ | ✅ |
| **Breadcrumbs** | ✅ 丰富 | ✅ | ✅ | ✅ |
| **Release Tracking** | ✅ | ✅ | ✅ | ✅ |
| **告警集成** | Slack/Teams/钉钉/邮件 | 类似 | 类似 | 类似 |
| **社区生态** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

**Sentry 的核心优势：**

1. **自托管选项**：可以完全控制数据，满足合规要求
2. **Session Replay**：回放用户操作，直观理解 bug 场景
3. **Performance + Errors 一体化**：不需要维护两套系统
4. **开源生态**：SDK 完全开源，社区活跃
5. **Laravel 专属优化**：sentry-laravel 包提供深度集成

---

## 二、Laravel 集成实战

### 2.1 安装配置

```bash
# 安装 sentry-laravel
composer require sentry/sentry-laravel

# 发布配置文件
php artisan vendor:publish --provider="Sentry\Laravel\ServiceProvider"
```

### 2.2 配置文件

```php
// config/sentry.php
return [
    // DSN（从 Sentry 项目设置中获取）
    'dsn' => env('SENTRY_DSN'),
    
    // 环境和版本
    'environment' => env('APP_ENV', 'production'),
    'release' => env('SENTRY_RELEASE', '1.0.0'),
    
    // 采样率（0.0 = 不上报，1.0 = 全部上报）
    'traces_sample_rate' => env('SENTRY_TRACES_SAMPLE_RATE', 0.2),
    
    // Profile 采样率
    'profiles_sample_rate' => env('SENTRY_PROFILES_SAMPLE_RATE', 0.1),
    
    // 错误采样率（通常设为 1.0，所有错误都上报）
    'sample_rate' => env('SENTRY_SAMPLE_RATE', 1.0),
    
    // Session Replay 配置
    'replays_session_sample_rate' => env('SENTRY_REPLAYS_SESSION_SAMPLE_RATE', 0.1),
    'replays_on_error_sample_rate' => env('SENTRY_REPLAYS_ERROR_SAMPLE_RATE', 1.0),
    
    // 面包屑配置
    'breadcrumbs' => [
        'sql_queries' => true,      // SQL 查询
        'sql_bindings' => false,     // SQL 绑定参数（可能包含敏感数据）
        'queue_info' => true,       // 队列任务信息
        'redis_commands' => true,   // Redis 命令
        'http_client_requests' => true, // HTTP 请求
        'logs' => true,             // 日志
        'livewire' => true,         // Livewire 组件
    ],
    
    // 发送前数据清洗
    'before_send' => function (\Sentry\Event $event): ?\Sentry\Event {
        // 过滤特定异常
        $exceptions = $event->getExceptions();
        foreach ($exceptions as $exception) {
            // 忽略 404 错误
            if ($exception->getType() === 'Symfony\Component\HttpKernel\Exception\NotFoundHttpException') {
                return null;
            }
            // 忽略认证异常
            if ($exception->getType() === 'Illuminate\Auth\AuthenticationException') {
                return null;
            }
        }
        
        // 清理敏感数据
        $request = $event->getRequest();
        if ($request) {
            $data = $request->getData();
            // 移除密码字段
            unset($data['password'], $data['password_confirmation'], $data['token']);
            $request->setData($data);
        }
        
        return $event;
    },
    
    // 发送前面包屑清洗
    'before_breadcrumb' => function (\Sentry\Breadcrumb $breadcrumb): ?\Sentry\Breadcrumb {
        // 过滤包含敏感信息的面包屑
        $data = $breadcrumb->getData();
        if (isset($data['password']) || isset($data['token'])) {
            return null;
        }
        return $breadcrumb;
    },
];
```

### 2.3 环境变量配置

```env
# .env
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_TRACES_SAMPLE_RATE=0.2
SENTRY_PROFILES_SAMPLE_RATE=0.1
SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
SENTRY_REPLAYS_ERROR_SAMPLE_RATE=1.0
SENTRY_RELEASE=1.0.0
```

### 2.4 注册异常处理

```php
// bootstrap/app.php (Laravel 11+)
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware) {
        //
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Sentry 异常报告
        $exceptions->reportable(function (\Throwable $e) {
            if (app()->bound('sentry')) {
                app('sentry')->captureException($e);
            }
        });
    })->create();
```

对于 Laravel 10：

```php
// app/Exceptions/Handler.php
<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

class Handler extends ExceptionHandler
{
    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            if (app()->bound('sentry')) {
                app('sentry')->captureException($e);
            }
        });
    }
}
```

---

## 三、错误捕获深度配置

### 3.1 异常与 PHP Fatal 错误捕获

Sentry 默认捕获所有未处理的异常。你也可以手动捕获：

```php
use Sentry\Laravel\Facades\Sentry;

// 手动捕获异常
try {
    $this->processPayment($order);
} catch (PaymentGatewayException $e) {
    // 设置额外上下文
    Sentry::withScope(function ($scope) use ($order, $e) {
        $scope->setTag('order_id', $order->id);
        $scope->setTag('payment_gateway', $order->payment_gateway);
        $scope->setContext('order', [
            'id' => $order->id,
            'amount' => $order->total_amount,
            'currency' => $order->currency,
            // 注意：不要包含支付卡号等敏感信息
        ]);
        $scope->setLevel('error');
        
        Sentry::captureException($e);
    });
    
    throw $e;
}
```

### 3.2 队列任务失败捕获

Sentry Laravel 自动捕获队列任务失败，但你可以添加更多上下文：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Sentry\Laravel\Facades\Sentry;

class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $maxExceptions = 3;

    public function __construct(
        public int $orderId
    ) {}

    public function handle(): void
    {
        // 添加面包屑
        Sentry::addBreadcrumb(new \Sentry\Breadcrumb(
            level: \Sentry\Breadcrumb::LEVEL_INFO,
            category: 'job',
            message: "Processing order #{$this->orderId}",
            data: ['order_id' => $this->orderId, 'queue' => $this->queue],
        ));

        // 设置用户上下文
        $order = \App\Models\Order::find($this->orderId);
        if ($order && $order->user) {
            Sentry::setUser([
                'id' => $order->user->id,
                'email' => $order->user->email,
            ]);
        }

        // 处理订单
        $this->processOrder($order);
    }

    public function failed(\Throwable $exception): void
    {
        // 任务最终失败时的处理
        Sentry::withScope(function ($scope) use ($exception) {
            $scope->setTag('job', self::class);
            $scope->setTag('order_id', $this->orderId);
            $scope->setLevel('error');
            $scope->setContext('job_info', [
                'attempts' => $this->attempts(),
                'queue' => $this->queue,
                'connection' => $this->connectionName ?? 'default',
            ]);
            
            Sentry::captureException($exception);
        });
    }
}
```

### 3.3 HTTP 4xx/5xx 错误

```php
// app/Http/Middleware/SentryContext.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Sentry\Laravel\Facades\Sentry;
use Symfony\Component\HttpFoundation\Response;

class SentryContext
{
    public function handle(Request $request, Closure $next): Response
    {
        // 设置请求上下文
        Sentry::configureScope(function ($scope) use ($request) {
            // 用户信息
            if ($user = $request->user()) {
                Sentry::setUser([
                    'id' => $user->id,
                    'email' => $user->email,
                    'username' => $user->name,
                ]);
            }
            
            // 请求标签
            Sentry::setTag('method', $request->method());
            Sentry::setTag('route', $request->route()?->getName() ?? $request->path());
            
            // 请求上下文
            Sentry::setContext('request', [
                'url' => $request->fullUrl(),
                'method' => $request->method(),
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'request_id' => $request->header('X-Request-ID'),
            ]);
        });

        $response = $next($request);

        // 5xx 错误上报额外上下文
        if ($response->getStatusCode() >= 500) {
            Sentry::withScope(function ($scope) use ($request, $response) {
                $scope->setLevel('error');
                $scope->setContext('response', [
                    'status_code' => $response->getStatusCode(),
                ]);
                Sentry::captureMessage(
                    "HTTP {$response->getStatusCode()} on {$request->method()} {$request->path()}"
                );
            });
        }

        return $response;
    }
}
```

注册中间件：

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(\App\Http\Middleware\SentryContext::class);
})
```

---

## 四、Breadcrumbs（面包屑）机制

### 4.1 面包屑的作用

面包屑是错误发生前的事件链路——就像飞机的黑匣子，记录了坠机前的所有操作：

```
错误：SQLSTATE[HY000]: General error: 1205 Lock wait timeout exceeded

面包屑（按时间倒序）：
1. [SQL] SELECT * FROM orders WHERE user_id = ? AND status = 'pending'
2. [SQL] UPDATE orders SET status = 'processing' WHERE id = ?
3. [HTTP] POST /api/orders/process (user_id: 123)
4. [SQL] SELECT * FROM users WHERE id = ?                      ← 查询用户
5. [Redis] GET user:123:cart                                    ← 读取购物车
6. [Job] Dispatch ProcessOrder job                               ← 分发任务
7. [SQL] BEGIN TRANSACTION                                       ← 开始事务
8. [SQL] UPDATE inventory SET quantity = quantity - 1            ← 扣减库存
9. [SQL] UPDATE orders SET status = 'paid' WHERE id = ?         ← 更新订单
10. [SQL] SELECT * FROM payment_locks WHERE order_id = ?        ← 等待锁...超时！
```

有了面包屑，你不需要复现就能看到完整的错误上下文。

### 4.2 自定义面包屑

```php
use Sentry\Laravel\Facades\Sentry;
use Sentry\Breadcrumb;

// SQL 面包屑（Sentry Laravel 自动添加，但你可以自定义）
Sentry::addBreadcrumb(new Breadcrumb(
    level: Breadcrumb::LEVEL_INFO,
    category: 'payment',
    message: 'Payment initiated',
    data: [
        'gateway' => 'stripe',
        'amount' => 99.99,
        'currency' => 'USD',
    ],
));

// 导航面包屑
Sentry::addBreadcrumb(new Breadcrumb(
    level: Breadcrumb::LEVEL_INFO,
    category: 'navigation',
    message: 'User navigated to checkout',
    data: ['from' => '/cart', 'to' => '/checkout'],
));

// 用户操作面包屑
Sentry::addBreadcrumb(new Breadcrumb(
    level: Breadcrumb::LEVEL_INFO,
    category: 'ui.click',
    message: 'Clicked "Place Order" button',
    data: ['button_id' => 'place-order-btn'],
));
```

---

## 五、性能监控（Performance Monitoring）

### 5.1 事务追踪

Sentry 的性能监控基于**事务（Transaction）**——一个事务代表一个完整的操作（如 HTTP 请求、队列任务、CLI 命令）：

```php
use Sentry\Laravel\Facades\Sentry;

// 手动创建事务
$transaction = Sentry::startTransaction([
    'name' => 'ProcessOrder',
    'op' => 'order.process',
    'data' => ['order_id' => $orderId],
]);

// 将事务设置为当前上下文
Sentry::getHub()->setSpan($transaction);

// 在事务内创建 Span（子操作）
$span = $transaction->startChild([
    'op' => 'db.query',
    'description' => 'SELECT * FROM orders WHERE id = ?',
]);

$order = Order::find($orderId);

$span->finish();  // 记录 Span 耗时

// 更多 Span
$paymentSpan = $transaction->startChild([
    'op' => 'payment.charge',
    'description' => 'Charge payment via Stripe',
]);

$result = $this->chargePayment($order);

$paymentSpan->setData(['amount' => $order->total]);
$paymentSpan->finish();

$transaction->finish();  // 完成事务
```

### 5.2 自动事务追踪

Sentry Laravel 自动将 HTTP 请求和队列任务创建为事务。你可以通过配置控制采样率：

```php
// config/sentry.php
'traces_sample_rate' => 0.2,  // 20% 的请求会被追踪

// 或者使用 traces_sampler 进行更精细的控制
'traces_sampler' => function (\Sentry\Tracing\SamplingContext $context): float {
    // 队列任务全量采样
    if ($context->getParentSampled()) {
        return 1.0;
    }
    
    // API 接口 30% 采样
    $request = request();
    if ($request && str_starts_with($request->path(), 'api/')) {
        return 0.3;
    }
    
    // 健康检查不采样
    if ($request && $request->path() === 'health') {
        return 0.0;
    }
    
    // 默认 10% 采样
    return 0.1;
},
```

### 5.3 N+1 查询检测

Sentry 可以自动检测 N+1 查询问题：

```php
// config/sentry.php - 启用 N+1 检测
'n_plus_one_detection' => [
    'enabled' => true,
],

// 示例：N+1 查询
$orders = Order::all();              // 1 次查询
foreach ($orders as $order) {
    echo $order->user->name;         // N 次查询！
}

// Sentry 会在性能页面标记这个问题：
// "N+1 Query Detected: App\Models\Order.user"
// 建议：Order::with('user')->all()
```

### 5.4 慢查询标记

```php
// 在 Sentry 配置中标记慢查询阈值
'before_send_transaction' => function (\Sentry\Event $event): ?\Sentry\Event {
    $spans = $event->getSpans();
    foreach ($spans as $span) {
        // 超过 1 秒的 Span 标记为慢操作
        if ($span->getEndTimestamp() - $span->getStartTimestamp() > 1.0) {
            $span->setData(array_merge($span->getData(), ['slow' => true]));
        }
    }
    return $event;
},
```

---

## 六、Session Replay 实战

### 6.1 什么是 Session Replay？

Session Replay 可以录制用户在浏览器中的操作，像看视频一样回放。但与视频不同，Session Replay 记录的是 DOM 操作，因此：
- **体积小**：一个 10 分钟的 Session 通常只有几百 KB
- **可交互**：可以检查元素、查看网络请求
- **隐私友好**：可以自动脱敏

### 6.2 前端集成

```javascript
// resources/js/app.js
import * as Sentry from "@sentry/browser";

Sentry.init({
    dsn: process.env.MIX_SENTRY_DSN,
    environment: process.env.MIX_APP_ENV,
    release: process.env.MIX_SENTRY_RELEASE,
    
    // Session Replay 配置
    replaysSessionSampleRate: 0.1,   // 10% 的正常会话
    replaysOnErrorSampleRate: 1.0,   // 100% 的错误会话
    
    integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
            // 隐私配置
            maskAllText: false,            // 不遮罩所有文本
            blockAllMedia: false,          // 不屏蔽所有媒体
            
            // 遮罩敏感元素
            maskTextSelector: [
                'input[type="password"]',
                'input[name="credit_card"]',
                'input[name="ssn"]',
                '.sensitive-data',
            ],
            
            // 屏蔽敏感元素（完全不录制）
            blockSelector: [
                '.payment-form',
                '.personal-info',
            ],
            
            // 网络请求录制
            networkDetailAllowUrls: [
                '/api/',
            ],
            networkCaptureBodies: true,
            networkRequestHeaders: ['Content-Type'],
            networkResponseHeaders: ['Content-Type'],
        }),
    ],
    
    // 面包屑配置
    beforeBreadcrumb(breadcrumb) {
        // 过滤敏感面包屑
        if (breadcrumb.category === 'console' && breadcrumb.level === 'log') {
            if (breadcrumb.message?.includes('password')) {
                return null;
            }
        }
        return breadcrumb;
    },
});
```

### 6.3 Vue/React 组件错误捕获

```javascript
// Vue 3
import { createApp } from 'vue';
import * as Sentry from '@sentry/vue';

const app = createApp(App);

Sentry.init({
    app,
    dsn: process.env.MIX_SENTRY_DSN,
    integrations: [
        Sentry.browserTracingIntegration({ router }),
        Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
});

// React
import * as Sentry from '@sentry/react';

Sentry.init({
    dsn: process.env.REACT_APP_SENTRY_DSN,
    integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
});
```

### 6.4 隐私合规配置

```javascript
// GDPR 合规：用户必须同意才能录制
if (userConsentedToRecording) {
    Sentry.init({
        // ... 配置
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
    });
} else {
    Sentry.init({
        // ... 配置
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,  // 即使错误也不录制
    });
}
```

---

## 七、Source Map 上传

### 7.1 前端 JS 错误精确定位

没有 Source Map，Sentry 只能看到混淆后的错误：

```
// 没有 Source Map
Error: Cannot read properties of undefined (reading 'map')
  at app.a1b2c3.js:1:25678  ← 完全看不懂

// 有 Source Map
Error: Cannot read properties of undefined (reading 'map')
  at resources/js/components/ProductList.vue:45:12  ← 精确到源码行！
```

### 7.2 Webpack/Vite 配置

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
    plugins: [
        vue(),
        sentryVitePlugin({
            org: 'your-org',
            project: 'your-project',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: {
                name: process.env.VITE_SENTRY_RELEASE,
                create: true,
                finalize: true,
            },
            sourcemaps: {
                assets: './dist/**',
                ignore: ['node_modules'],
                filesToDeleteAfterUpload: './dist/**/*.map',
            },
        }),
    ],
    build: {
        sourcemap: true,  // 必须启用 Source Map
    },
});
```

```javascript
// webpack.mix.js (Laravel Mix)
const mix = require('laravel-mix');
const SentryWebpackPlugin = require('@sentry/webpack-plugin');

mix.webpackConfig({
    devtool: 'source-map',
    plugins: [
        new SentryWebpackPlugin({
            org: 'your-org',
            project: 'your-project',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: process.env.SENTRY_RELEASE,
            include: './public/assets',
            ignore: ['node_modules'],
            urlPrefix: '~/assets',
        }),
    ],
});
```

### 7.3 CI/CD 中自动上传

```yaml
# .github/workflows/deploy.yml
- name: Build frontend
  run: npm run build
  env:
    VITE_SENTRY_RELEASE: ${{ github.sha }}

- name: Upload Source Maps to Sentry
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
  run: |
    npx @sentry/cli releases new ${{ github.sha }}
    npx @sentry/cli releases files ${{ github.sha} upload-sourcemaps ./dist --url-prefix '~/assets'
    npx @sentry/cli releases finalize ${{ github.sha }}
```

---

## 八、告警与集成

### 8.1 告警规则配置

在 Sentry UI 中配置告警规则：

**错误频率告警：**
```
When: An event is seen
  IF: The event's level is equal to error
  AND: In the last 1 hour
  THEN: Send notification to Slack #backend-alerts
  
  阈值: 10 events in 1 minute
```

**新错误告警：**
```
When: A new issue is created
  IF: The event's level is equal to error or fatal
  THEN: Send notification to Slack #critical-alerts
  AND: Assign to on-call team
```

**性能回归告警：**
```
When: A transaction's duration
  IF: p95(response_time) > 2000ms
  IN: The last 5 minutes
  THEN: Send notification to Slack #performance
```

### 8.2 Release Tracking

```php
// 部署脚本中设置 Release
// config/sentry.php
'release' => env('SENTRY_RELEASE', trim(shell_exec('git rev-parse HEAD'))),

// 或者在 CI/CD 中设置环境变量
// SENTRY_RELEASE=$(git rev-parse HEAD)
// php artisan config:cache
```

```yaml
# GitHub Actions 中创建 Release
- name: Create Sentry Release
  uses: getsentry/action-release@v1
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: your-org
    SENTRY_PROJECT: your-project
  with:
    environment: production
    version: ${{ github.sha }}
    sourcemaps: ./dist
```

### 8.3 Slack/钉钉集成

**Slack 集成：**
- Sentry → Settings → Integrations → Slack
- 配置通知规则：哪些项目的哪些级别发送到哪个 Slack 频道

**钉钉集成（通过 Webhook）：**
```python
# Sentry Webhook → 中间服务 → 钉钉机器人
# 或使用社区插件 sentry-dingtalk
```

---

## 九、SDK 采样率与性能开销控制

### 9.1 采样率策略

```php
// config/sentry.php

// 分层采样策略
'traces_sampler' => function (\Sentry\Tracing\SamplingContext $context): float {
    $transactionName = $context->getTransactionName();
    
    // 1. 健康检查 - 不采样
    if (str_contains($transactionName, 'health')) {
        return 0.0;
    }
    
    // 2. 支付相关 - 高采样率
    if (str_contains($transactionName, 'payment') || str_contains($transactionName, 'checkout')) {
        return 0.5;
    }
    
    // 3. API 接口 - 中等采样率
    if (str_starts_with($transactionName, 'api/')) {
        return 0.2;
    }
    
    // 4. 静态资源 - 不采样
    if (str_contains($transactionName, 'static') || str_contains($transactionName, 'assets')) {
        return 0.0;
    }
    
    // 5. 其他 - 低采样率
    return 0.05;
},
```

### 9.2 性能开销评估

Sentry SDK 的性能开销：

| 操作 | 开销 |
|-----|------|
| 错误捕获 | < 1ms |
| 面包屑记录 | < 0.1ms/条 |
| 事务追踪 (10% 采样) | ~2-5% CPU 增加 |
| Source Map 解析 | 服务端，不影响客户端 |
| Session Replay | ~1-3% CPU（浏览器端） |

**优化建议：**
1. 生产环境事务采样率控制在 5-20%
2. 错误采样率通常设为 100%（所有错误都重要）
3. 使用 `before_send` 过滤不关心的错误，减少上报量
4. 避免在高频循环中添加面包屑

---

## 十、生产环境踩坑记录

### 10.1 事件量爆炸治理

**问题描述：** 某天上线后，一个循环中的错误导致 Sentry 在 1 分钟内收到 50 万条相同事件，瞬间用完月度配额。

**根因：**
```php
foreach ($items as $item) {
    try {
        $this->processItem($item);
    } catch (\Exception $e) {
        // ❌ 每个 item 失败都上报 Sentry
        Sentry::captureException($e);
        // 当有 10 万个 item 时，10 万条相同的错误！
    }
}
```

**解决方案：**
```php
// 方案一：聚合上报
$errors = [];
foreach ($items as $item) {
    try {
        $this->processItem($item);
    } catch (\Exception $e) {
        $errors[] = $item->id;
    }
}

if (!empty($errors)) {
    Sentry::withScope(function ($scope) use ($errors) {
        $scope->setContext('batch_errors', [
            'total' => count($errors),
            'item_ids' => array_slice($errors, 0, 100), // 只记录前100个
        ]);
        Sentry::captureMessage("Batch processing failed for " . count($errors) . " items");
    });
}

// 方案二：Sentry 配置限制
// 在 Sentry 项目设置中：
// - "Issue Grouping" → 设置相似事件聚合
// - "Rate Limiting" → 每分钟最大事件数
// - "Inbound Filters" → 过滤已知的噪声错误
```

### 10.2 敏感数据过滤

**问题描述：** Sentry 事件中包含了用户的密码、API Key 等敏感信息，违反了 GDPR 和安全审计要求。

**解决方案：**

```php
// config/sentry.php

// 多层数据清洗

// 第一层：请求数据清洗
'before_send' => function (\Sentry\Event $event): ?\Sentry\Event {
    // 清理请求体
    $request = $event->getRequest();
    if ($request) {
        $data = $request->getData();
        $sensitiveFields = [
            'password', 'password_confirmation', 'token',
            'api_key', 'secret', 'credit_card', 'cvv',
            'ssn', 'authorization',
        ];
        
        foreach ($sensitiveFields as $field) {
            if (isset($data[$field])) {
                $data[$field] = '***REDACTED***';
            }
        }
        
        $request->setData($data);
    }
    
    // 清理额外上下文
    $contexts = $event->getContexts();
    foreach ($contexts as $key => &$context) {
        if (is_array($context)) {
            foreach ($sensitiveFields as $field) {
                if (isset($context[$field])) {
                    $context[$field] = '***REDACTED***';
                }
            }
        }
    }
    
    return $event;
},

// 第二层：面包屑清洗
'before_breadcrumb' => function (\Sentry\Breadcrumb $breadcrumb): ?\Sentry\Breadcrumb {
    // SQL 绑定参数中可能有敏感数据
    if ($breadcrumb->getCategory() === 'query') {
        $data = $breadcrumb->getData();
        if (isset($data['bindings'])) {
            $data['bindings'] = array_map(function ($binding) {
                if (is_string($binding) && strlen($binding) > 20) {
                    return '***REDACTED***';
                }
                return $binding;
            }, $data['bindings']);
            $breadcrumb->setData($data);
        }
    }
    
    return $breadcrumb;
},

// 第三层：关闭 SQL 绑定参数记录（最安全）
'breadcrumbs' => [
    'sql_bindings' => false,  // 不记录 SQL 参数
],
```

### 10.3 SDK 版本兼容问题

**问题描述：** 升级 Laravel 版本后，sentry-laravel 包与新版 Laravel 不兼容，导致启动报错。

**解决方案：**
```bash
# 检查兼容性
composer show sentry/sentry-laravel

# sentry-laravel 版本对应：
# 4.x → Laravel 10/11
# 3.x → Laravel 9/10
# 2.x → Laravel 8/9

# 升级时的正确步骤：
composer require sentry/sentry-laravel:^4.0
php artisan vendor:publish --provider="Sentry\Laravel\ServiceProvider" --force
php artisan config:cache
```

### 10.4 队列任务 Sentry 上下文丢失

**问题描述：** 队列任务中的 Sentry 事件缺少用户信息和请求上下文。

**原因：** 队列任务在新的进程中执行，HTTP 请求上下文不存在。

**解决方案：**
```php
// 在 Job handle 中手动设置上下文
public function handle(): void
{
    // 设置 Job 特有的上下文
    Sentry::configureScope(function ($scope) {
        $scope->setTag('job', class_basename(self::class));
        $scope->setTag('queue', $this->queue ?? 'default');
        
        // 从 Job 参数中恢复用户上下文
        if (isset($this->userId)) {
            $scope->setUser(['id' => $this->userId]);
        }
        
        $scope->setContext('job_data', [
            'id' => $this->job?->getJobId(),
            'attempts' => $this->attempts(),
            // 注意：不要包含敏感的 Job 参数
        ]);
    });

    // 执行任务逻辑
    $this->process();
}
```

---

## 十一、Sentry 与日志系统的协作

### 11.1 Sentry + Loki 双系统

Sentry 和 Loki 各有优势，推荐配合使用：

```
Sentry：专注于错误追踪
  ✅ 自动异常捕获
  ✅ 精确的堆栈追踪
  ✅ Session Replay 回放
  ✅ 性能监控和 N+1 检测
  ❌ 不适合日志搜索和分析

Loki：专注于日志聚合
  ✅ 全量日志存储和搜索
  ✅ 长期日志保留
  ✅ 复杂日志查询
  ✅ 低资源消耗
  ❌ 没有堆栈追踪和 Session Replay
```

### 11.2 关联追踪

通过 `trace_id` 将 Sentry 事件和 Loki 日志关联：

```php
// 在 Laravel 中同时向 Sentry 和日志中写入 trace_id
$traceId = Sentry::getCurrentHub()->getSpan()?->getTraceId() ?? uniqid();

// Sentry 上下文
Sentry::setContext('trace', ['trace_id' => $traceId]);

// Laravel 日志上下文
Log::info('Order processed', [
    'trace_id' => $traceId,
    'order_id' => $order->id,
]);
```

在 Grafana 中配置 Loki 数据源的 `derivedFields`，实现从日志直接跳转到 Sentry：

```yaml
# grafana/provisioning/datasources/loki.yml
datasources:
  - name: Loki
    type: loki
    jsonData:
      derivedFields:
        - datasourceUid: sentry
          matcherRegex: 'sentry_event_id=(\w+)'
          name: Sentry Event
          url: 'https://sentry.io/organizations/your-org/issues/?query=$1'
```

---

## 十二、总结

Sentry 在 2026 年已经从单纯的错误追踪工具进化为了完整的应用可观测性平台。对于 Laravel 应用来说，Sentry 提供了：

1. **错误追踪**：自动捕获异常、队列失败、HTTP 错误
2. **性能监控**：事务追踪、N+1 检测、慢查询标记
3. **Session Replay**：用户操作回放，直观理解 bug 场景
4. **Source Map**：精确定位前端 JS 错误
5. **告警集成**：Slack/钉钉通知，Release Tracking

### 核心建议

1. **采样率要合理**：错误 100%，性能 10-20%，Replay 5-10%
2. **数据清洗必须做**：密码、Token、信用卡号绝不能出现在 Sentry
3. **面包屑是金矿**：配置好面包屑，错误排查效率提升 10 倍
4. **Source Map 必须上传**：否则前端错误毫无意义
5. **Sentry + Loki 配合用**：Sentry 负责错误，Loki 负责日志

错误追踪系统的价值不在于"捕获了错误"，而在于"让你用最少的时间理解错误并修复它"。Sentry 的面包屑、Session Replay 和性能监控正是为此而设计的。

---

> **参考资料：**
> - [Sentry Laravel 文档](https://docs.sentry.io/platforms/php/guides/laravel/)
> - [Sentry JavaScript SDK](https://docs.sentry.io/platforms/javascript/)
> - [Session Replay 文档](https://docs.sentry.io/product/session-replay/)
> - [Sentry Performance Monitoring](https://docs.sentry.io/product/performance/)

## 相关阅读

- [Grafana Loki 实战：轻量级日志聚合替代 ELK](/categories/运维/2026-06-02-grafana-loki-lightweight-log-aggregation-laravel/)
- [监控告警实战：Prometheus + Grafana 告警规则设计](/categories/运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
- [SLO/SLI 实战：用服务等级目标驱动可靠性](/categories/运维/SLO-SLI-实战/)
- [Chaos Engineering 实战：用 Chaos Mesh 进行故障注入与韧性测试](/categories/运维/Chaos-Engineering-实战/)
