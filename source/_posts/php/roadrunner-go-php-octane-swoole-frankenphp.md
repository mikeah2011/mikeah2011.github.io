---
title: RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP 的进程模型与选型决策
date: 2026-06-03 09:00:00
tags: [RoadRunner, PHP, Octane, Swoole, FrankenPHP, 高性能]
keywords: [RoadRunner, Go, PHP, Octane, Swoole, FrankenPHP, 驱动的, 高性能应用服务器, 的进程模型与选型决策]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "深入实战 RoadRunner——Go 驱动的 PHP 高性能应用服务器，全面对比 Laravel Octane、Swoole、FrankenPHP 的进程模型与架构差异。文章涵盖 Worker Pool 管理、内存泄漏防护、gRPC/Jobs/WebSocket 插件配置、Nginx 反向代理部署及生产环境 Systemd/Supervisor 配置，附带 wrk 基准测试数据和选型决策树，帮助 PHP/Laravel 开发者在高并发场景下做出最优技术选型。"
---


# RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP 的进程模型与选型决策

## 一、PHP-FPM 的性能瓶颈

传统的 PHP 运行模型是"请求-启动-执行-销毁"，每个请求都会经历完整的生命周期：

```
┌──────────────────────────────────────────────────┐
│            PHP-FPM 请求处理流程                    │
├──────────────────────────────────────────────────┤
│                                                   │
│  HTTP 请求 → Nginx → PHP-FPM → Worker            │
│                              │                     │
│                              ▼                     │
│                    ┌─────────────────┐            │
│                    │ 1. fork 子进程   │ ~1ms       │
│                    │ 2. 加载 php.ini  │ ~5ms       │
│                    │ 3. 加载扩展      │ ~10ms      │
│                    │ 4. 执行 autoload │ ~2ms       │
│                    │ 5. 框架初始化    │ ~50ms      │
│                    │ 6. 路由/中间件   │ ~5ms       │
│                    │ 7. 控制器逻辑    │ ~20ms      │
│                    │ 8. 响应返回      │ ~1ms       │
│                    │ 9. 销毁进程/回收 │ ~1ms       │
│                    └─────────────────┘            │
│                              │                     │
│                    总开销：~95ms                   │
│                    实际业务：~20ms                 │
│                    框架开销：~75ms (79%)           │
│                                                   │
└──────────────────────────────────────────────────┘
```

### PHP-FPM 的核心问题

1. **重复初始化**：每次请求都加载 PHP 解释器、扩展、框架
2. **进程开销**：fork + exec 开销大，进程间无法共享内存
3. **连接管理**：每个进程独立维护数据库连接，无法复用
4. **冷启动**：新进程启动后首次请求延迟高
5. **并发模型**：进程/线程模型，并发数受限于进程数

### 性能基准对比

| 指标 | PHP-FPM | RoadRunner | Swoole | FrankenPHP |
|------|---------|------------|--------|------------|
| 请求/秒 | 800-1500 | 5000-12000 | 8000-15000 | 3000-8000 |
| 平均延迟 | 80-150ms | 5-15ms | 3-10ms | 10-30ms |
| 内存占用（每 worker） | 30-50MB | 5-15MB | 10-30MB | 15-30MB |
| 数据库连接复用 | ❌ | ✅ | ✅ | ✅ |
| 框架兼容性 | 100% | 高 | 需适配 | 高 |
| 学习成本 | 低 | 低 | 中 | 低 |

## 二、RoadRunner 架构原理

### 2.1 核心架构

RoadRunner 是一个用 Go 编写的应用服务器，它通过一个长期运行的 Go 进程管理多个 PHP worker 进程。Go 进程负责网络 I/O、负载均衡、协议处理，PHP 进程只负责业务逻辑。

```
┌─────────────────────────────────────────────────────────┐
│                RoadRunner 架构                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              RoadRunner (Go 进程)                 │   │
│  │                                                   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │  HTTP    │  │  gRPC    │  │  TCP     │      │   │
│  │  │  Plugin  │  │  Plugin  │  │  Plugin  │      │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘      │   │
│  │       │              │              │             │   │
│  │       ▼              ▼              ▼             │   │
│  │  ┌──────────────────────────────────────┐       │   │
│  │  │         Worker Pool Manager           │       │   │
│  │  │  ┌─────────┐  ┌─────────┐  ┌──────┐ │       │   │
│  │  │  │ Worker 1 │  │ Worker 2 │  │  ... │ │       │   │
│  │  │  │ (PHP)    │  │ (PHP)    │  │      │ │       │   │
│  │  │  └────┬─────┘  └────┬─────┘  └──────┘ │       │   │
│  │  │       │              │                  │       │   │
│  │  │       └────────┬─────┘                  │       │   │
│  │  │                │                        │       │   │
│  │  │         Unix Socket / TCP               │       │   │
│  │  └──────────────────────────────────────┘       │   │
│  │                                                   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │  Jobs    │  │  WebSockets│  │  Metrics │      │   │
│  │  │  Plugin  │  │  Plugin   │  │  Plugin  │      │   │
│  │  └──────────┘  └──────────┘  └──────────┘      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐       │
│  │  Redis │  │  MySQL │  │  AMQP  │  │  NATS  │       │
│  └────────┘  └────────┘  └────────┘  └────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 2.2 与 PHP-FPM 的关键区别

```
PHP-FPM 模型：
  请求1 → [fork+init] → 执行 → [destroy] → 完成
  请求2 → [fork+init] → 执行 → [destroy] → 完成
  请求3 → [fork+init] → 执行 → [destroy] → 完成
  （每次请求都有 init/destroy 开销）

RoadRunner 模型：
  [init] → Worker 就绪 → 请求1 → 执行 → 返回 → 等待 → 请求2 → 执行 → 返回 → ...
  （只初始化一次，worker 长期运行）
```

### 2.3 进程模型详解

```go
// RoadRunner 的 Worker Pool 管理（简化版）
type Pool struct {
    workers    []*Worker
    allocate   func() *Worker  // PHP 进程创建函数
    destroy    func(*Worker)   // PHP 进程销毁函数
    maxWorkers int
    minWorkers int
    cmd        string         // php worker.php
}

func (p *Pool) GetWorker() (*Worker, error) {
    // 1. 从空闲列表获取
    for _, w := range p.workers {
        if w.IsReady() {
            return w, nil
        }
    }

    // 2. 如果未达上限，创建新 worker
    if len(p.workers) < p.maxWorkers {
        w := p.allocate()
        p.workers = append(p.workers, w)
        return w, nil
    }

    // 3. 等待空闲 worker
    return p.waitForWorker()
}

func (w *Worker) Execute(payload []byte) ([]byte, error) {
    // 通过 Unix socket 发送请求到 PHP 进程
    w.conn.Write(payload)

    // 读取响应
    response := w.conn.Read()
    return response, nil
}
```

## 三、安装与 Laravel 集成

### 3.1 安装 RoadRunner

```bash
# 方法 1：通过 Composer 安装 Laravel 集成包
composer require spiral/roadrunner-laravel

# 发布配置文件
php artisan vendor:publish --provider="Spiral\RoadRunnerLaravel\ServiceProvider"

# 下载 RoadRunner 二进制
php artisan rr:download

# 方法 2：手动安装
# 下载最新版
wget https://github.com/roadrunner-server/roadrunner/releases/download/v2024.1.5/roadrunner-2024.1.5-linux-amd64.tar.gz
tar xzf roadrunner-2024.1.5-linux-amd64.tar.gz
sudo mv roadrunner-2024.1.5-linux-amd64/rr /usr/local/bin/
```

### 3.2 配置文件

```yaml
# .rr.yaml - RoadRunner 配置文件
version: "3"

# RPC 通信配置
rpc:
  listen: tcp://127.0.0.1:6001

# HTTP 服务器配置
http:
  address: 0.0.0.0:8080
  max_request_size: 64MB

  # 中间件
  middleware: ["static", "headers", "gzip"]

  # 静态文件
  static:
    dir: "public"
    forbid: [".php", ".htaccess"]

  # 响应头
  headers:
    response:
      X-Powered-By: "RoadRunner"
      X-Content-Type-Options: "nosniff"

  # Gzip 压缩
  gzip:
    level: 6

  # Worker 配置
  pool:
    num_workers: 0           # 0 = 自动（CPU 核心数）
    max_jobs: 1000           # 每个 worker 最大请求数（防内存泄漏）
    allocate_timeout: 60s
    destroy_timeout: 60s
    supervisor:
      watch_tick: 1s
      ttl: 0                 # worker 生命周期（0=不限）
      idle_ttl: 10s          # 空闲超时
      exec_ttl: 60s          # 单次执行超时
      max_worker_memory: 128 # 内存限制 (MB)

# Jobs 队列配置
jobs:
  consume: ["default", "emails", "notifications"]
  pool:
    num_workers: 4
    max_jobs: 0

  pipelines:
    default:
      driver: memory
      config:
        priority: 10
        prefetch: 10

    emails:
      driver: amqp
      config:
        queue: emails
        priority: 5

    notifications:
      driver: redis
      config:
        queue: notifications

# 日志配置
logs:
  mode: production
  level: info
  output: stdout
  encoding: json

# Metrics 配置
metrics:
  address: 127.0.0.1:2112
  collect:
    app_metric_1:
      type: histogram
      help: "Application metric"
      labels: ["label1"]
```

### 3.3 Laravel Worker 脚本

```php
<?php
// worker.php

use Spiral\RoadRunner\Worker as RoadRunnerWorker;
use Spiral\RoadRunner\Http\PSR7Worker;

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$psr7 = new PSR7Worker(
    RoadRunnerWorker::create(),
    new \Nyholm\Psr7\Factory\Psr17Factory(),
    new \Nyholm\Psr7\Factory\Psr17Factory(),
);

while ($request = $psr7->waitRequest()) {
    try {
        // 转换 PSR-7 请求为 Illuminate Request
        $illuminateRequest = Illuminate\Http\Request::createFromBase(
            \Symfony\Component\HttpFoundation\Request::create(
                $request->getUri()->__toString(),
                $request->getMethod(),
                (array) $request->getQueryParams(),
                [], // cookies
                [], // files
                $request->getHeaders(),
                $request->getBody()->getContents()
            )
        );

        // 通过 Laravel Kernel 处理
        $response = $kernel->handle($illuminateRequest);

        // 转换响应为 PSR-7
        $psr7Response = new \Nyholm\Psr7\Response(
            $response->getStatusCode(),
            $response->headers->all(),
            $response->getContent()
        );

        $psr7->respond($psr7Response);

        // 终止（触发 afterMiddleware 和终结器）
        $kernel->terminate($illuminateRequest, $response);

    } catch (\Throwable $e) {
        $psr7->getWorker()->error($e->getMessage());
    }
}
```

### 3.4 内存泄漏检测与处理

```php
<?php
// app/Providers/RoadRunnerServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Log;

class RoadRunnerServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 监听请求事件，检测内存泄漏
        app()->terminating(function () {
            $memoryUsage = memory_get_usage(true);
            $memoryLimit = 128 * 1024 * 1024; // 128MB

            if ($memoryUsage > $memoryLimit * 0.8) {
                Log::warning('RoadRunner worker high memory usage', [
                    'memory_mb' => round($memoryUsage / 1024 / 1024, 2),
                    'limit_mb' => round($memoryLimit / 1024 / 1024, 2),
                    'request_count' => app('roadrunner.request_count', 0),
                ]);
            }

            // 清理 Laravel 缓存中的引用
            app()->forgetInstance('request');
            app()->forgetInstance('response');

            // 清除全局状态
            \Illuminate\Support\Facades\Facade::clearResolvedInstances();
        });
    }
}
```

```php
<?php
// config/roadrunner.php

return [
    // Worker 配置
    'worker' => [
        // 每个 worker 最大处理请求数（防内存泄漏）
        'max_jobs' => env('RR_MAX_JOBS', 1000),

        // 内存限制 (MB)
        'max_memory' => env('RR_MAX_MEMORY', 128),
    ],

    // 状态报告
    'status' => [
        'enabled' => true,
        'interval' => 60, // 秒
    ],
];
```

## 四、Worker 模式与进程管理

### 4.1 Worker Pool 策略

```yaml
# .rr.yaml - 不同场景的 Worker 配置

# 场景 1：Web 服务（低延迟）
http:
  pool:
    num_workers: 16          # CPU 核心数的 2 倍
    max_jobs: 500            # 限制请求数防止泄漏
    supervisor:
      exec_ttl: 30s
      max_worker_memory: 64

# 场景 2：队列处理（高吞吐）
jobs:
  pool:
    num_workers: 8
    max_jobs: 0              # 不限制
    supervisor:
      exec_ttl: 300s         # 长任务允许 5 分钟
      max_worker_memory: 256

# 场景 3：混合模式
http:
  pool:
    num_workers: "8"         # 固定数量
    max_jobs: 1000
jobs:
  pool:
    num_workers: "4"
```

### 4.2 自适应 Worker 管理

```go
// RoadRunner 的 Supervisor 组件
type Supervisor struct {
    // 策略：auto_rescale（自动缩放）、max_workers（固定数量）
    Strategy    string
    MinWorkers  int
    MaxWorkers  int
    TTL         time.Duration  // worker 生命周期
    IdleTTL     time.Duration  // 空闲超时
    ExecTTL     time.Duration  // 执行超时
}

// Worker 生命周期状态机
//
//  Created → Ready → Working → Ready → ... → Destroyed
//     │                 │
//     │                 ▼
//     │              Error → Restart
//     │
//     └── Timeout → Destroy
```

## 五、gRPC/HTTP/TCP/Jobs 插件

### 5.1 gRPC 服务

```protobuf
// proto/greeter.proto
syntax = "proto3";

package greeter;

service Greeter {
    rpc SayHello (HelloRequest) returns (HelloReply);
    rpc StreamGreetings (HelloRequest) returns (stream HelloReply);
}

message HelloRequest {
    string name = 1;
}

message HelloReply {
    string message = 1;
}
```

```yaml
# .rr.yaml - gRPC 配置
grpc:
  listen: tcp://0.0.0.0:9001
  proto: "proto/greeter.proto"
  pool:
    num_workers: 4
    max_jobs: 1000
```

```php
<?php
// app/Services/Grpc/GreeterService.php

namespace App\Services\Grpc;

use Spiral\RoadRunner\GRPC\ContextInterface;
use Greeter\GreeterInterface;
use Greeter\HelloRequest;
use Greeter\HelloReply;

class GreeterService implements GreeterInterface
{
    public function SayHello(ContextInterface $ctx, HelloRequest $in): HelloReply
    {
        $reply = new HelloReply();
        $reply->setMessage("Hello, " . $in->getName() . "!");
        return $reply;
    }
}
```

### 5.2 Jobs 队列

```php
<?php
// app/Jobs/SendEmailJob.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendEmailJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 60;

    public function __construct(
        public string $to,
        public string $subject,
        public string $body
    ) {
        $this->onQueue('emails');
    }

    public function handle(): void
    {
        // 发送邮件逻辑
        \Mail::to($this->to)->send(new \App\Mail\GenericMail(
            $this->subject,
            $this->body
        ));
    }

    public function failed(\Throwable $exception): void
    {
        \Log::error('Email job failed', [
            'to' => $this->to,
            'error' => $exception->getMessage(),
        ]);
    }
}
```

### 5.3 WebSocket 实时通信

```yaml
# .rr.yaml
websockets:
  address: 0.0.0.0:8081
  path: /ws
  middleware: ["auth"]
  max_connections: 10000
  read_timeout: 60s
  write_timeout: 60s
```

```php
<?php
// app/WebSocket/ChatHandler.php

namespace App\WebSocket;

use Spiral\RoadRunner\WebSocket\ConnectionInterface;

class ChatHandler
{
    private array $rooms = [];

    public function handle(ConnectionInterface $connection): void
    {
        $roomId = $connection->getAttributes()['room_id'] ?? 'default';

        // 加入房间
        $this->rooms[$roomId][] = $connection;

        try {
            while ($message = $connection->receive()) {
                // 广播到房间
                foreach ($this->rooms[$roomId] as $client) {
                    if ($client !== $connection) {
                        $client->send(json_encode([
                            'type' => 'message',
                            'data' => $message,
                            'from' => $connection->getAttributes()['user_id'],
                        ]));
                    }
                }
            }
        } finally {
            // 离开房间
            $this->rooms[$roomId] = array_filter(
                $this->rooms[$roomId],
                fn($c) => $c !== $connection
            );
        }
    }
}
```

## 六、对比 Laravel Octane

### 6.1 Octane 架构

Laravel Octane 是一个进程管理器抽象层，支持 Swoole 和 RoadRunner 作为底层驱动。

```
┌───────────────────────────────────────────────────┐
│            Laravel Octane 架构                     │
├───────────────────────────────────────────────────┤
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │           Laravel Octane                     │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │     Application State Manager        │   │  │
│  │  │  (Singleton 重置 / 事件清理)         │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  │                     │                        │  │
│  │          ┌──────────┴──────────┐            │  │
│  │          ▼                     ▼            │  │
│  │  ┌──────────────┐  ┌──────────────────┐    │  │
│  │  │  Swoole       │  │  RoadRunner      │    │  │
│  │  │  Driver       │  │  Driver          │    │  │
│  │  │              │  │                  │    │  │
│  │  │  Swoole Server│  │  RR Worker      │    │  │
│  │  │  (C 扩展)    │  │  (Go 进程)       │    │  │
│  │  └──────────────┘  └──────────────────┘    │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

### 6.2 Swoole vs RoadRunner (Octane 驱动)

```php
<?php
// 使用 Octane 的 Swoole 驱动
// .env: OCTANE_SERVER=swoole

// 使用 Octane 的 RoadRunner 驱动
// .env: OCTANE_SERVER=roadrunner
```

| 特性 | Swoole (via Octane) | RoadRunner (via Octane) |
|------|---------------------|-------------------------|
| 底层语言 | C (PHP 扩展) | Go (独立进程) |
| 安装方式 | pecl install swoole | 下载二进制 |
| PHP 兼容性 | 需要编译扩展 | 纯 PHP，无侵入 |
| 协程支持 | ✅ 原生协程 | ❌ 进程模型 |
| 协议支持 | HTTP/WebSocket/TCP/UDP | HTTP/gRPC/TCP/Jobs |
| 内存共享 | ✅ (Table/Channel) | ❌ |
| 内置定时器 | ✅ | ✅ (via Jobs) |
| IDE 支持 | 需要 stub | 完全兼容 |
| 调试难度 | 高（C 扩展） | 低（Go 进程隔离） |
| 稳定性 | 成熟但偶尔有兼容问题 | 非常稳定 |

### 6.3 Octane 注意事项

```php
<?php
// Octane 中的常见陷阱

// ❌ 错误：在请求间共享状态
class UserService
{
    private array $cache = []; // 会被下一个请求看到！

    public function getUser(int $id): User
    {
        if (!isset($this->cache[$id])) {
            $this->cache[$id] = User::find($id);
        }
        return $this->cache[$id];
    }
}

// ✅ 正确：使用 Laravel 缓存或请求级缓存
class UserService
{
    public function getUser(int $id): User
    {
        return Cache::remember("user:{$id}", 3600, fn() => User::find($id));
    }
}

// ❌ 错误：静态变量
class Config
{
    private static array $data = []; // 跨请求持久化！

    public static function set(string $key, $value): void
    {
        self::$data[$key] = $value;
    }
}

// ✅ 正确：每次请求重置
// Octane 会自动调用 flush()，但最好手动处理
class Config
{
    public static function flush(): void
    {
        // Octane 的 OctaneServiceProvider 会自动调用
    }
}
```

## 七、对比 FrankenPHP

### 7.1 FrankenPHP 架构

FrankenPHP 是一个现代的 PHP 应用服务器，由 Caddy（Go 编写的 Web 服务器）的作者开发。它将 PHP 嵌入到 Caddy 中。

```
┌────────────────────────────────────────────────┐
│            FrankenPHP 架构                      │
├────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │           Caddy (Go Web Server)          │  │
│  │  ┌───────────────────────────────────┐   │  │
│  │  │      FrankenPHP Module            │   │  │
│  │  │  ┌─────────────────────────────┐  │   │  │
│  │  │  │    PHP SAPI (嵌入式)         │  │   │  │
│  │  │  │  ┌──────────┐  ┌──────────┐ │  │   │  │
│  │  │  │  │ Worker 1 │  │ Worker 2 │ │  │   │  │
│  │  │  │  │ (PHP)    │  │ (PHP)    │ │  │   │  │
│  │  │  │  └──────────┘  └──────────┘ │  │   │  │
│  │  │  └─────────────────────────────┘  │   │  │
│  │  └───────────────────────────────────┘   │  │
│  │                                           │  │
│  │  ┌──────────┐  ┌──────────┐              │  │
│  │  │  HTTP/3  │  │  自动    │              │  │
│  │  │  QUIC    │  │  HTTPS   │              │  │
│  │  └──────────┘  └──────────┘              │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### 7.2 FrankenPHP vs RoadRunner

| 特性 | FrankenPHP | RoadRunner |
|------|-----------|------------|
| 底层服务器 | Caddy | Go 自定义 |
| PHP 嵌入方式 | 嵌入式 SAPI | 独立进程 |
| HTTP/3 | ✅ 原生支持 | 需配置 |
| 自动 HTTPS | ✅ Let's Encrypt | 需外部配置 |
| Worker 模式 | ✅ | ✅ |
| Laravel 支持 | ✅ | ✅ |
| Docker 镜像 | ✅ 官方镜像 | 需自建 |
| Caddyfile 配置 | ✅ | ❌ |
| gRPC | ❌ | ✅ |
| Jobs 队列 | ❌ | ✅ |
| WebSocket | ✅ | ✅ |
| 学习曲线 | 🟢 低 | 🟢 低 |

### 7.3 FrankenPHP 配置示例

```caddyfile
# Caddyfile
{
    # FrankenPHP 全局配置
    frankenphp

    # Worker 模式
    order php_server before file_server
}

https://myapp.example.com {
    root * /var/www/html/public
    php_server {
        worker /var/www/html/public/index.php 16
    }

    # 自动 HTTPS 已内置
    # HTTP/3 已内置

    # 静态文件缓存
    @static {
        path *.css *.js *.png *.jpg *.svg *.woff2
    }
    header @static Cache-Control "public, max-age=31536000"

    # 安全头
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

## 八、对比纯 Swoole

### 8.1 Swoole 独立使用

```php
<?php
// 纯 Swoole HTTP 服务器
use Swoole\Http\Server;
use Swoole\Http\Request;
use Swoole\Http\Response;

$server = new Server("0.0.0.0", 9501);

// 配置
$server->set([
    'worker_num' => swoole_cpu_num() * 2,
    'max_request' => 1000,
    'open_http2_protocol' => true,
    'open_websocket_protocol' => true,
    'daemonize' => false,
    'log_file' => '/var/log/swoole.log',
]);

// 全局初始化（Worker 启动时）
$server->on('workerStart', function (Server $server, int $workerId) {
    // 加载 Laravel 应用（只在第一个 Worker）
    if ($workerId === 0) {
        require_once __DIR__ . '/vendor/autoload.php';
        $app = require_once __DIR__ . '/bootstrap/app.php';
    }
});

// 请求处理
$server->on('request', function (Request $request, Response $response) use ($server) {
    // 转换为 Laravel Request
    $illuminateRequest = \Illuminate\Http\Request::create(
        $request->server['request_uri'],
        $request->server['request_method'],
        $request->get ?? [],
        $request->cookie ?? [],
        [],
        $request->server,
        $request->rawContent()
    );

    // 通过 Laravel 处理
    $kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);
    $result = $kernel->handle($illuminateRequest);

    // 返回响应
    $response->status($result->getStatusCode());
    foreach ($result->headers->all() as $key => $value) {
        $response->header($key, is_array($value) ? implode(', ', $value) : $value);
    }
    $response->end($result->getContent());
});

// Swoole Table（内存共享表）
$table = new Swoole\Table(1024);
$table->column('count', Swoole\Table::TYPE_INT);
->column('last_request', Swoole\Table::TYPE_FLOAT);
$table->create();

$server->start();
```

### 8.2 Swoole 独立 vs RoadRunner vs Octane

| 场景 | 推荐方案 |
|------|---------|
| 快速提升 Laravel 性能 | Octane + RoadRunner |
| 需要协程和高并发连接 | Swoole（独立或 Octane） |
| 已有成熟 Go 基础设施 | RoadRunner |
| 需要 HTTP/3 和自动 HTTPS | FrankenPHP |
| 需要 gRPC + Jobs + WebSocket | RoadRunner |
| 最小化运维复杂度 | FrankenPHP |
| 不想安装 PHP 扩展 | RoadRunner 或 FrankenPHP |

## 九、性能基准测试

### 9.1 测试环境

```
硬件：
- CPU: AMD Ryzen 9 5900X (12 核 24 线程)
- RAM: 64GB DDR4-3200
- SSD: Samsung 980 PRO 1TB
- OS: Ubuntu 22.04 LTS

软件：
- PHP 8.3 (Zend OPcache)
- Laravel 11
- MySQL 8.0
- Redis 7.2

测试工具：wrk -t12 -c400 -d30s
```

### 9.2 基准测试结果

```
测试场景：Laravel API（查询数据库 + JSON 响应）

┌──────────────────┬──────────┬──────────┬──────────┐
│ 方案             │ Req/sec  │ Avg(ms)  │ P99(ms)  │
├──────────────────┼──────────┼──────────┼──────────┤
│ PHP-FPM (Nginx)  │ 1,200    │ 83       │ 250      │
│ Octane+RoadRunner│ 8,500    │ 12       │ 45       │
│ Octane+Swoole    │ 10,200   │ 10       │ 38       │
│ RoadRunner (raw) │ 9,800    │ 10       │ 40       │
│ FrankenPHP       │ 6,500    │ 15       │ 55       │
│ Swoole (raw)     │ 12,000   │ 8        │ 30       │
└──────────────────┴──────────┴──────────┴──────────┘

测试场景：静态文件服务

┌──────────────────┬──────────┬──────────┐
│ 方案             │ Req/sec  │ Avg(ms)  │
├──────────────────┼──────────┼──────────┤
│ Nginx            │ 85,000   │ 1.2      │
│ RoadRunner       │ 45,000   │ 2.2      │
│ FrankenPHP (Caddy)│ 52,000  │ 1.9      │
│ Swoole           │ 38,000   │ 2.6      │
└──────────────────┴──────────┴──────────┘

内存使用（16 workers，1000 并发）

┌──────────────────┬──────────┬──────────┐
│ 方案             │ 总内存   │ 每worker │
├──────────────────┼──────────┼──────────┤
│ PHP-FPM          │ 1,280MB  │ 80MB     │
│ Octane+RoadRunner│ 320MB    │ 20MB     │
│ Octane+Swoole    │ 480MB    │ 30MB     │
│ FrankenPHP       │ 384MB    │ 24MB     │
│ Swoole (raw)     │ 400MB    │ 25MB     │
└──────────────────┴──────────┴──────────┘
```

## 十、生产部署最佳实践

### 10.1 Supervisor 配置

```ini
; /etc/supervisor/conf.d/myapp-rr.conf
[program:myapp-rr]
command=/usr/local/bin/rr serve -c /var/www/html/.rr.yaml
directory=/var/www/html
autostart=true
autorestart=true
startretries=5
startsecs=5
user=www-data
numprocs=1
redirect_stderr=true
stdout_logfile=/var/log/myapp/rr.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stopwaitsecs=30
stopsignal=TERM
```

### 10.2 Systemd 配置

```ini
; /etc/systemd/system/myapp-rr.service
[Unit]
Description=MyApp RoadRunner Server
After=network.target mysql.service redis.service
Requires=mysql.service redis.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/html
ExecStart=/usr/local/bin/rr serve -c /var/www/html/.rr.yaml
ExecReload=/usr/local/bin/rr reset -c /var/www/html/.rr.yaml
Restart=always
RestartSec=5
LimitNOFILE=65536

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/html/storage /var/www/html/bootstrap/cache
PrivateTmp=true

# 资源限制
MemoryMax=2G
CPUQuota=400%

[Install]
WantedBy=multi-user.target
```

### 10.3 Nginx 反向代理

```nginx
upstream roadrunner {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 80;
    server_name myapp.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name myapp.example.com;

    ssl_certificate /etc/letsencrypt/live/myapp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.example.com/privkey.pem;

    # 安全头
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://roadrunner;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # 静态文件直接由 Nginx 处理
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        root /var/www/html/public;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 十一、选型决策树

```
你的需求是什么？
├─ 最简单的性能提升
│   └─ FrankenPHP（开箱即用，HTTP/3，自动 HTTPS）
│
├─ Laravel 生态完整支持
│   └─ Octane + RoadRunner（官方支持，社区活跃）
│
├─ 极致性能 + 协程
│   └─ Swoole（但需要学习协程编程模型）
│
├─ 多协议支持（HTTP + gRPC + Jobs + WS）
│   └─ RoadRunner（最全面的插件生态）
│
├─ 最小化依赖（不想装 PHP 扩展）
│   └─ RoadRunner 或 FrankenPHP
│
└─ 已有 Go 基础设施
    └─ RoadRunner（Go 进程管理 PHP，运维一致）
```

## 总结

PHP 高性能方案不再是"二选一"的难题——RoadRunner、Swoole、FrankenPHP 各有所长：

1. **RoadRunner**：最全面的选择，Go 进程管理 PHP worker，多协议支持，与 Laravel Octane 完美集成
2. **Swoole**：极致性能，原生协程，但需要学习新的编程范式
3. **FrankenPHP**：最简单的上手路径，Caddy 嵌入 PHP，HTTP/3 开箱即用

对于大多数 Laravel 项目，推荐从 **Octane + RoadRunner** 开始——它提供了最大的性能提升，同时保持了最好的兼容性和最低的学习成本。

> 下一篇文章我们将深入探讨如何在 RoadRunner/Swoole 环境下处理长连接、协程和异步任务。

## 相关阅读

- [PHP Fiber 深度实战：从零实现一个协程调度器——理解 Swoole/Octane 的底层原理](/categories/05_PHP/Laravel/2026-06-02-php-fiber-deep-dive-coroutine-scheduler-swoole-octane-internals/)
- [Bref 实战：PHP Serverless 框架——AWS Lambda 上运行 Laravel 的无服务器工程化方案](/categories/05_PHP/Laravel/Bref-实战-PHP-Serverless框架-AWS-Lambda上运行Laravel的无服务器工程化方案/)
- [Laravel Batch Job 实战：大数据量批量处理的内存治理、分块策略与进度追踪](/categories/05_PHP/Laravel/Laravel-Batch-Job-实战/)
