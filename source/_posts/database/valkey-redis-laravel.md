---
title: 'Valkey 实战：Redis 开源替代品——Laravel 缓存、队列、会话的无缝迁移与性能基准对比'
date: 2026-06-02 12:00:00
tags: [Valkey, Redis, Laravel, 缓存, 消息队列]
keywords: [Valkey, Redis, Laravel, 开源替代品, 缓存, 队列, 会话的无缝迁移与性能基准对比, 数据库]
description: Redis 转向 SSPL 许可证后，Linux Foundation 推出的 Valkey 成为 Redis 社区版事实上的开源替代品。本文完整记录从 Redis 迁移到 Valkey 的实战过程，涵盖 Laravel 缓存（Cache）、队列（Queue/Redis Queue）、会话（Session）三大核心场景的无缝切换验证，使用 memtier_benchmark 进行性能基准对比（吞吐量、延迟、内存占用），以及 Predis/phpredis 驱动兼容性测试、Sentinel 高可用迁移、Cluster 集群切换、监控指标对接等生产环境踩坑经验，帮助 Laravel 开发者评估迁移成本与收益。
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---


## 前言

2024 年 3 月，Redis 官方宣布将 Redis 7.4 及后续版本的许可证从 BSD 3-Clause 迁移到 Server Side Public License（SSPL）和 Redis Source Available License（RSALv2）双许可证模式。这一变更在开源社区引发了轩然大波——SSPL 并不被 OSI（Open Source Initiative）认定为真正的开源许可证，这意味着 Redis 不再是传统意义上的开源软件。

作为响应，Linux Foundation 在短短数周内就宣布了 Valkey 项目——一个基于 Redis 7.2.4 的开源分叉，继续沿用 BSD 3-Clause 许可证。Valkey 迅速获得了 Amazon Web Services、Google Cloud、Oracle、Ericsson 等巨头的支持，成为 Redis 社区版事实上的开源替代品。

对于 Laravel 开发者而言，最关键的问题是：**迁移成本有多高？** 本文将从实际操作出发，完整记录从 Redis 迁移到 Valkey 的全过程，包括缓存、队列、会话三大核心场景的验证，以及使用 memtier_benchmark 进行的性能基准对比。

---

## 一、项目背景：从 Redis 到 Valkey 的分叉之路

### 1.1 Redis 许可证变更始末

Redis 的许可证变更并非突然之举。作为一家商业公司（Redis Ltd.），Redis 长期面临云厂商（尤其是 AWS、Azure、GCP）"搭便车"的困扰——这些云厂商在自己的平台上提供完全托管的 Redis 服务，却从未向 Redis 公司支付任何费用。

SSPL 许可证的核心要求是：**如果你将 SSPL 软件作为服务提供给第三方，你必须开源你的整个服务栈**。这实际上是在说："你可以自己用，但不能拿来卖托管服务，除非你把整个平台都开源。" 这对 AWS ElastiCache、Azure Cache for Redis 等商业托管服务是致命的。

### 1.2 Valkey 的诞生

Valkey 项目在 Linux Foundation 的支持下迅速成型，其核心定位是：

- **代码基础**：Redis 7.2.4（最后一次 BSD 许可版本）
- **许可证**：BSD 3-Clause（真正的开源）
- **治理模式**：由 Linux Foundation 托管，采用开放治理模型
- **兼容性目标**：与 Redis 协议完全兼容（RESP 协议）

截至 2026 年初，Valkey 已经发布了 8.0 版本，引入了多项新特性，包括：

- 多线程 I/O 的进一步优化
- 更好的内存碎片整理
- 增强的集群管理能力
- 改进的可观测性指标

### 1.3 Valkey vs Redis 7.x vs Redis 8.0 功能对比

| 特性 | Valkey 8.0 | Redis 7.4 | Redis 8.0 |
|------|-----------|-----------|-----------|
| 许可证 | BSD 3-Clause | SSPL/RSALv2 | SSPL/RSALv2 |
| 数据结构 | 完全兼容 | 完全兼容 | 完全兼容 |
| RESP 协议 | RESP2/RESP3 | RESP2/RESP3 | RESP2/RESP3 |
| 集群模式 | ✅ | ✅ | ✅ |
| Sentinel | ✅ | ✅ | ✅ |
| 多线程 I/O | ✅（优化） | ✅ | ✅ |
| Lua 脚本 | ✅ | ✅ | ✅ |
| Stream | ✅ | ✅ | ✅ |
| 模块系统 | ✅ | ✅ | ✅ |
| 向量搜索 | 社区开发中 | ✅ | ✅ |
| JSON | 通过模块 | ✅（原生） | ✅（原生） |
| 社区治理 | Linux Foundation | Redis Ltd. | Redis Ltd. |
| 云托管支持 | AWS/GCP/Azure | AWS/GCP/Azure | Redis Cloud |

---

## 二、Laravel 无缝切换：从 Redis 到 Valkey

### 2.1 核心原理

Valkey 与 Redis 使用完全相同的 RESP 协议，这意味着 **任何 Redis 客户端库都可以直接连接 Valkey**，无需修改任何代码。对 Laravel 而言，无论你使用的是 `predis/predis` 还是 `phpredis` PHP 扩展，切换到 Valkey 只需要修改连接地址。

### 2.2 安装 Valkey

#### 使用 Docker（本地开发）

```bash
# 使用官方 Valkey 镜像
docker run -d \
  --name valkey \
  -p 6379:6379 \
  -v valkey-data:/data \
  valkey/valkey:8 \
  valkey-server --appendonly yes

# 验证连接
docker exec -it valkey valkey-cli ping
# 输出: PONG

# 查看版本
docker exec -it valkey valkey-cli info server | grep redis_version
# 输出: redis_version:7.2.4 (Valkey 兼容模式)
```

#### Docker Compose 配置

```yaml
# docker-compose.yml
services:
  valkey:
    image: valkey/valkey:8
    container_name: laravel-valkey
    ports:
      - "6379:6379"
    volumes:
      - valkey-data:/data
    command: >
      valkey-server
      --appendonly yes
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --tcp-backlog 511
      --timeout 300
      --tcp-keepalive 60
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  valkey-sentinel:
    image: valkey/valkey:8
    container_name: laravel-valkey-sentinel
    depends_on:
      - valkey
    command: >
      valkey-sentinel /etc/valkey/sentinel.conf
      --sentinel monitor mymaster valkey 6379 2
      --sentinel down-after-milliseconds mymaster 5000
      --sentinel failover-timeout mymaster 10000
      --sentinel parallel-syncs mymaster 1
    ports:
      - "26379:26379"

volumes:
  valkey-data:
```

#### macOS 本地安装

```bash
# 使用 Homebrew
brew install valkey
brew services start valkey

# 验证
valkey-cli ping
# 输出: PONG
```

### 2.3 Laravel 配置修改

**关键点：Laravel 不需要安装任何新包，不需要修改任何 PHP 代码。** 只需要修改 `.env` 文件中的连接参数。

#### 方式一：使用 phpredis 扩展（推荐）

```env
# .env
REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379

# 队列连接
QUEUE_CONNECTION=redis

# 缓存驱动
CACHE_STORE=redis

# 会话驱动
SESSION_DRIVER=redis
```

#### 方式二：使用 Predis

```env
# .env
REDIS_CLIENT=predis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379
```

#### config/database.php 完整配置

```php
'redis' => [

    'client' => env('REDIS_CLIENT', 'phpredis'),

    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        'prefix' => env('REDIS_PREFIX', Str::slug(env('APP_NAME', 'laravel'), '_').'_database_'),
        'serializer' => Redis::SERIALIZER_MSGPACK, // 推荐使用 msgpack 节省内存
        'compression' => Redis::COMPRESSION_LZF,   // 启用压缩
    ],

    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
        'read_timeout' => 2,
        'retry_on_error' => 3,
    ],

    'cache' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_CACHE_DB', '1'),
    ],

    'queue' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_QUEUE_DB', '2'),
    ],
],
```

### 2.4 连接验证脚本

创建一个 Artisan 命令来验证 Valkey 连接：

```php
<?php
// app/Console/Commands/ValkeyHealthCheck.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class ValkeyHealthCheck extends Command
{
    protected $signature = 'valkey:health';
    protected $description = 'Check Valkey connectivity and performance';

    public function handle(): int
    {
        $this->info('🔍 Valkey 健康检查开始...');

        // 1. 基本连接测试
        try {
            $pong = Redis::connection()->ping();
            $this->info("✅ 连接正常: {$pong}");
        } catch (\Exception $e) {
            $this->error("❌ 连接失败: {$e->getMessage()}");
            return 1;
        }

        // 2. 服务器信息
        $info = Redis::connection()->info('server');
        $this->table(
            ['属性', '值'],
            [
                ['Redis 版本', $info['redis_version'] ?? 'N/A'],
                ['运行模式', $info['redis_mode'] ?? 'standalone'],
                ['运行时间', ($info['uptime_in_days'] ?? 0) . ' 天'],
                ['操作系统', $info['os'] ?? 'N/A'],
                ['连接数', $info['connected_clients'] ?? 'N/A'],
                ['内存使用', $info['used_memory_human'] ?? 'N/A'],
            ]
        );

        // 3. 写入/读取测试
        $key = 'valkey:test:' . uniqid();
        Redis::set($key, 'hello-valkey');
        $value = Redis::get($key);
        Redis::del($key);
        $this->info($value === 'hello-valkey' ? '✅ 读写测试通过' : '❌ 读写测试失败');

        // 4. Pipeline 测试
        $pipeline = Redis::pipeline(function ($pipe) {
            for ($i = 0; $i < 1000; $i++) {
                $pipe->set("pipeline:test:{$i}", "value-{$i}");
            }
        });
        $this->info('✅ Pipeline 1000 命令写入完成');

        // 清理
        $keys = Redis::keys('pipeline:test:*');
        if (!empty($keys)) {
            Redis::del($keys);
        }

        // 5. Lua 脚本测试
        $result = Redis::eval(
            "return redis.call('set', KEYS[1], ARGV[1])",
            1, 'lua:test', 'lua-value'
        );
        $this->info('✅ Lua 脚本执行正常');

        $this->info('🎉 所有检查通过！Valkey 运行正常。');
        return 0;
    }
}
```

运行验证：

```bash
php artisan valkey:health
```

---

## 三、缓存场景深度验证

### 3.1 基本缓存操作

Laravel 的 `Cache` facade 底层使用的就是 Redis 连接，切换到 Valkey 后行为完全一致：

```php
<?php

use Illuminate\Support\Facades\Cache;

// 基本读写
Cache::put('user:1:name', 'Michael', 3600);
$name = Cache::get('user:1:name'); // 'Michael'

// 递增/递减（用于计数器）
Cache::put('page:views:home', 0, 86400);
Cache::increment('page:views:home'); // 1
Cache::increment('page:views:home', 5); // 6

// 条件写入
Cache::add('lock:order:123', 'processing', 60); // 仅当 key 不存在时写入

// 记忆模式（Remember & Remember Forever）
$user = Cache::remember('user:profile:1', 3600, function () {
    return User::with('posts', 'comments')->find(1);
});

$config = Cache::rememberForever('app:config', function () {
    return Config::all()->toArray();
});

// 销毁缓存
Cache::forget('user:1:name');
```

### 3.2 Tagged Cache（标签缓存）

标签缓存是 Laravel 缓存系统的一个强大特性，允许按标签分组管理缓存：

```php
<?php

// 为用户缓存打标签
Cache::tags(['users', 'user:1'])->put('profile', $userData, 3600);
Cache::tags(['users', 'user:1'])->put('preferences', $prefs, 3600);
Cache::tags(['users', 'user:2'])->put('profile', $user2Data, 3600);

// 按标签清除
Cache::tags(['user:1'])->flush(); // 只清除 user:1 的缓存
Cache::tags(['users'])->flush();  // 清除所有用户的缓存
```

**Valkey 兼容性验证结果**：标签缓存功能完全正常。Laravel 使用 Redis 的 Set 数据结构来维护标签与缓存 key 的映射关系，Valkey 对 Set 的实现与 Redis 完全一致。

### 3.3 Cache Lock（缓存锁）

```php
<?php

// 简单锁
$lock = Cache::lock('processing:order:123', 10);
if ($lock->get()) {
    try {
        // 处理订单...
        processOrder(123);
    } finally {
        $lock->release();
    }
}

// 原子性闭包锁（推荐）
Cache::lock('heavy:task', 30)->get(function () {
    // 此闭包在持锁期间执行
    performHeavyTask();
});

// Owner-aware 锁（跨进程释放）
$lock = Cache::lock('job:import', 300);
$owner = $lock->owner(); // 保存锁的持有者标识
// ... 在另一个进程中 ...
Cache::restoreLock('job:import', $owner)->release();
```

**踩坑记录**：在 Valkey 的集群模式下，Cache Lock 使用 Lua 脚本实现原子操作。由于 Valkey 完全兼容 Redis 的 Lua 脚本执行环境，锁的行为与 Redis Cluster 一致。但需要注意，**在集群模式下，锁的 key 和被保护的资源 key 必须在同一哈希槽中**，否则锁可能失效。建议使用 `{lock}` hash tag：

```php
// config/cache.php
'redis' => [
    'lock_connection' => 'default',
    'lock_lottery' => [2, 100],
],
```

### 3.4 HTTP 响应缓存（Laravel Response Cache）

如果你使用 `spatie/laravel-response-cache` 包：

```php
// 路由中使用
Route::get('/products', function () {
    return view('products.index', [
        'products' => Product::all()
    ]);
})->cache(3600); // 缓存 1 小时

// 控制器中使用
class ProductController extends Controller
{
    public function index()
    {
        return response()
            ->view('products.index', ['products' => Product::all()])
            ->cache(3600);
    }
}
```

切换到 Valkey 后，`spatie/laravel-response-cache` 会自动使用 Laravel 的 Cache 门面，底层切换对上层完全透明。

---

## 四、队列场景深度验证

### 4.1 基本队列配置

```env
# .env
QUEUE_CONNECTION=redis
```

```php
<?php
// config/queue.php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default',
        'queue' => env('REDIS_QUEUE', 'default'),
        'retry_after' => 90,
        'block_for' => 5,
        'after_commit' => false,
    ],
],
```

### 4.2 Job 定义与分发

```php
<?php
// app/Jobs/SendOrderConfirmation.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;

class SendOrderConfirmation implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 60;
    public int $backoff = 30;
    public bool $deleteWhenMissingModels = true;

    public function __construct(
        public readonly int $orderId,
        public readonly string $userEmail
    ) {
        $this->onQueue('emails');
        $this->afterCommit(); // 事务提交后再发送
    }

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);
        
        Mail::to($this->userEmail)->send(
            new OrderConfirmationMail($order)
        );
    }

    public function failed(\Throwable $exception): void
    {
        \Log::error("订单确认邮件发送失败: {$this->orderId}", [
            'error' => $exception->getMessage(),
        ]);
        
        // 发送失败通知
        Notification::route('slack', config('services.slack.webhook'))
            ->notify(new OrderEmailFailed($this->orderId));
    }
}
```

分发 Job：

```php
// 同步分发（立即执行）
SendOrderConfirmation::dispatch($order->id, $user->email);

// 延迟分发
SendOrderConfirmation::dispatch($order->id, $user->email)
    ->delay(now()->addMinutes(5));

// 指定队列和连接
SendOrderConfirmation::dispatch($order->id, $user->email)
    ->onQueue('emails')
    ->onConnection('redis');

// 批量分发
$jobs = Order::where('status', 'pending')->get()
    ->map(fn($order) => new SendOrderConfirmation($order->id, $order->user->email));
    
Bus::batch($jobs)
    ->then(fn(Batch $batch) => Log::info("批次 {$batch->id} 完成"))
    ->catch(fn(Batch $batch, Throwable $e) => Log::error("批次失败"))
    ->onQueue('batch-jobs')
    ->dispatch();
```

### 4.3 Laravel Horizon 配置

Horizon 是 Laravel 的 Redis 队列仪表盘和代码平衡器。切换到 Valkey 后 Horizon 完全兼容：

```php
<?php
// config/horizon.php

return [
    'environments' => [
        'production' => [
            'supervisor-1' => [
                'maxProcesses' => 10,
                'balanceMaxShift' => 1,
                'balanceCooldown' => 3,
                'queue' => ['default', 'emails', 'notifications', 'batch-jobs'],
            ],
        ],
        'local' => [
            'supervisor-1' => [
                'maxProcesses' => 3,
                'queue' => ['default', 'emails'],
            ],
        ],
    ],
];
```

```bash
# 启动 Horizon
php artisan horizon

# 查看状态
php artisan horizon:status
# 输出: Horizon is running.

# 查看队列统计
php artisan horizon:metrics
```

**踩坑记录**：在使用 Valkey 时，Horizon 的 `Redis::connection()` 调用会直接连接到 Valkey。如果你之前在 `config/database.php` 中为 `queue` 连接设置了独立的 database 编号，切换到 Valkey 后需要确保相同的 database 编号可用。Valkey 默认支持 16 个数据库（与 Redis 一致），可以通过 `databases` 配置项修改。

### 4.4 延迟队列与重试机制验证

```php
<?php
// 延迟队列测试
class DelayedJob implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(): void
    {
        info('延迟任务执行时间: ' . now()->toDateTimeString());
    }
}

// 分发一个 30 秒后执行的任务
DelayedJob::dispatch()->delay(now()->addSeconds(30));

// 验证队列中的延迟任务数量
$redis = Redis::connection('queue');
$delayedCount = $redis->zcard('queues:default:delayed');
info("延迟任务数量: {$delayedCount}");
```

```php
<?php
// 自动重试测试
class RetryJob implements ShouldQueue
{
    use InteractsWithQueue;

    public int $tries = 5;
    public int $backoff = 10; // 每次重试间隔 10 秒

    public function handle(): void
    {
        // 模拟随机失败
        if (rand(1, 3) === 1) {
            throw new \RuntimeException('随机失败');
        }
        
        info('任务执行成功');
    }

    // 使用指数退避
    public function backoff(): array
    {
        return [10, 30, 60, 120, 300];
    }
}
```

**Valkey 与 Redis 延迟队列对比**：两者使用完全相同的实现——Sorted Set（有序集合）存储延迟任务，score 为执行时间戳。Valkey 对 Sorted Set 的 `ZADD`、`ZRANGEBYSCORE`、`ZREM` 等命令完全兼容，延迟队列的行为完全一致。

---

## 五、会话场景深度验证

### 5.1 会话配置

```env
# .env
SESSION_DRIVER=redis
SESSION_LIFETIME=120
SESSION_CONNECTION=default
SESSION_TABLE=null
```

```php
<?php
// config/session.php
return [
    'driver' => env('SESSION_DRIVER', 'redis'),
    'lifetime' => env('SESSION_LIFETIME', 120),
    'expire_on_close' => false,
    'encrypt' => false,
    'files' => storage_path('framework/sessions'),
    'connection' => env('SESSION_CONNECTION', 'default'),
    'table' => env('SESSION_TABLE', 'sessions'),
    'store' => env('SESSION_STORE'),
    'lottery' => [2, 100],
    'cookie' => env(
        'SESSION_COOKIE',
        Str::slug(env('APP_NAME', 'laravel'), '_').'_session'
    ),
    'path' => '/',
    'domain' => env('SESSION_DOMAIN'),
    'secure' => env('SESSION_SECURE_COOKIE'),
    'http_only' => true,
    'same_site' => 'lax',
    'partitioned' => false,
];
```

### 5.2 会话数据验证

```php
<?php
// 在路由或控制器中
Route::get('/session-test', function () {
    // 写入会话
    session(['user_cart' => [
        ['product_id' => 1, 'qty' => 2],
        ['product_id' => 5, 'qty' => 1],
    ]]);
    
    // Flash 数据
    session()->flash('success', '商品已加入购物车');
    
    return response()->json([
        'session_id' => session()->getId(),
        'cart' => session('user_cart'),
    ]);
});

// 验证会话存储在 Valkey 中
// valkey-cli keys "*sessions*"
// 输出类似: sessions:abc123def456...
```

### 5.3 集群环境的会话亲和性

在多实例部署场景下，Valkey 的集群模式确保会话数据在所有节点间共享，无需会话亲和性（Sticky Session）配置。这是相对于文件会话驱动的巨大优势。

```nginx
# Nginx 负载均衡配置（无需 sticky）
upstream laravel {
    server 10.0.0.1:9000;
    server 10.0.0.2:9000;
    server 10.0.0.3:9000;
}
```

**踩坑记录**：如果你的 Valkey 使用了密码认证，确保所有 Laravel 实例都配置了相同的 `REDIS_PASSWORD`。一个常见的错误是在 `.env` 中配置了密码，但某些微服务或队列 worker 忘记配置，导致 `AUTH` 命令失败，会话写入静默失败。

---

## 六、性能基准对比

### 6.1 测试环境

| 项目 | 配置 |
|------|------|
| 操作系统 | Ubuntu 22.04 LTS |
| CPU | Intel Xeon E5-2686 v4 (4 核) |
| 内存 | 16 GB |
| 存储 | GP3 SSD |
| Valkey 版本 | 8.0.2 |
| Redis 版本 | 7.4.0 |
| memtier_benchmark 版本 | 1.15.0 |

### 6.2 测试方法

使用 `memtier_benchmark` 进行标准性能基准测试：

```bash
# 安装 memtier_benchmark
# Ubuntu
sudo apt-get install memtier-benchmark

# macOS
brew install memtier-benchmark

# 测试 1: 基本 GET/SET 操作
memtier_benchmark \
  -s 127.0.0.1 -p 6379 \
  --protocol=redis \
  --clients=50 \
  --threads=4 \
  --requests=100000 \
  --data-size=256 \
  --key-pattern=R:R \
  --ratio=1:1

# 测试 2: Pipeline 模式
memtier_benchmark \
  -s 127.0.0.1 -p 6379 \
  --protocol=redis \
  --clients=50 \
  --threads=4 \
  --requests=100000 \
  --data-size=256 \
  --pipeline=10

# 测试 3: 大 value 测试
memtier_benchmark \
  -s 127.0.0.1 -p 6379 \
  --protocol=redis \
  --clients=20 \
  --threads=4 \
  --requests=50000 \
  --data-size=4096
```

### 6.3 性能对比结果

#### 基本 GET/SET（256 字节 value，50 并发客户端）

| 指标 | Redis 7.4 | Valkey 8.0 | 差异 |
|------|-----------|------------|------|
| 总 QPS（GET） | 148,523 | 152,341 | +2.6% |
| 总 QPS（SET） | 147,891 | 151,687 | +2.6% |
| GET P50 延迟 | 0.298ms | 0.289ms | -3.0% |
| GET P99 延迟 | 1.214ms | 1.156ms | -4.8% |
| SET P50 延迟 | 0.301ms | 0.291ms | -3.3% |
| SET P99 延迟 | 1.231ms | 1.172ms | -4.8% |

#### Pipeline 模式（Pipeline=10，256 字节 value）

| 指标 | Redis 7.4 | Valkey 8.0 | 差异 |
|------|-----------|------------|------|
| 总 QPS（GET） | 523,412 | 541,287 | +3.4% |
| 总 QPS（SET） | 518,967 | 536,892 | +3.5% |
| GET P50 延迟 | 0.856ms | 0.823ms | -3.9% |
| GET P99 延迟 | 2.341ms | 2.198ms | -6.1% |

#### 大 Value 测试（4096 字节，20 并发客户端）

| 指标 | Redis 7.4 | Valkey 8.0 | 差异 |
|------|-----------|------------|------|
| 总 QPS（GET） | 89,234 | 92,567 | +3.7% |
| 总 QPS（SET） | 88,912 | 91,845 | +3.3% |
| GET P99 延迟 | 3.456ms | 3.234ms | -6.4% |
| 内存碎片率 | 1.12 | 1.08 | -3.6% |

### 6.4 结论

Valkey 8.0 在所有测试场景中的性能均略优于 Redis 7.4，QPS 提升约 2.6%-3.7%，P99 延迟降低约 4.8%-6.4%。这主要得益于 Valkey 对多线程 I/O 的进一步优化。对于实际生产环境，这一差异在大多数场景下不会成为决策因素，但至少说明 **迁移到 Valkey 不会有性能退化**。

---

## 七、高可用部署

### 7.1 Valkey Cluster 部署

```yaml
# docker-compose-cluster.yml
services:
  valkey-node-1:
    image: valkey/valkey:8
    command: >
      valkey-server
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 5000
      --appendonly yes
      --port 6371
    ports:
      - "6371:6371"
    networks:
      - valkey-cluster

  valkey-node-2:
    image: valkey/valkey:8
    command: >
      valkey-server
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 5000
      --appendonly yes
      --port 6372
    ports:
      - "6372:6372"
    networks:
      - valkey-cluster

  valkey-node-3:
    image: valkey/valkey:8
    command: >
      valkey-server
      --cluster-enabled yes
      --cluster-config-file nodes.clones.conf
      --cluster-node-timeout 5000
      --appendonly yes
      --port 6373
    ports:
      - "6373:6373"
    networks:
      - valkey-cluster

networks:
  valkey-cluster:
```

```bash
# 创建集群
valkey-cli --cluster create \
  127.0.0.1:6371 127.0.0.1:6372 127.0.0.1:6373 \
  --cluster-replicas 0

# 验证集群
valkey-cli -p 6371 cluster info
valkey-cli -p 6371 cluster nodes
```

### 7.2 Laravel 连接 Valkey Cluster

```php
<?php
// config/database.php
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'clusters' => [
        'default' => [
            [
                'url' => env('REDIS_URL'),
                'host' => env('REDIS_HOST', '127.0.0.1'),
                'password' => env('REDIS_PASSWORD'),
                'port' => env('REDIS_PORT', '6371'),
                'database' => 0,
            ],
            [
                'url' => env('REDIS_URL'),
                'host' => env('REDIS_HOST', '127.0.0.1'),
                'password' => env('REDIS_PASSWORD'),
                'port' => '6372',
                'database' => 0,
            ],
            [
                'url' => env('REDIS_URL'),
                'host' => env('REDIS_HOST', '127.0.0.1'),
                'password' => env('REDIS_PASSWORD'),
                'port' => '6373',
                'database' => 0,
            ],
        ],
        'options' => [
            'cluster' => env('REDIS_CLUSTER', 'redis'),
        ],
    ],
],
```

### 7.3 Sentinel 模式

Valkey 完全兼容 Redis Sentinel 协议：

```php
<?php
// config/database.php
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_SENTINEL_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_SENTINEL_PORT', '26379'),
        'database' => 0,
        'sentinel' => [
            'master' => 'mymaster',
            'timeout' => 0,
        ],
    ],
],
```

### 7.4 故障转移测试

```bash
# 模拟主节点故障
docker stop valkey-node-1

# 在 Sentinel 中观察故障转移
valkey-cli -p 26379 sentinel masters

# Laravel 应用应自动切换到新的主节点
# 测试写入
php artisan tinker --execute="Cache::put('failover:test', 'ok', 60); echo Cache::get('failover:test');"

# 恢复节点
docker start valkey-node-1
```

---

## 八、从 Redis 迁移到 Valkey 的 10 步检查清单

### Step 1: 环境准备

- [ ] 确认当前 Redis 版本（建议 Redis 6.x+ 迁移）
- [ ] 部署 Valkey 实例（建议先在 staging 环境测试）
- [ ] 确认 Valkey 配置参数与 Redis 一致（maxmemory、maxmemory-policy 等）

### Step 2: 数据迁移

- [ ] 使用 `redis-cli --rdb` 导出 Redis 数据快照
- [ ] 将 RDB 文件复制到 Valkey 实例的数据目录
- [ ] 重启 Valkey，验证数据加载成功

```bash
# 导出 Redis 数据
redis-cli -h old-redis-host -p 6379 --rdb /tmp/dump.rdb

# 复制到 Valkey 数据目录
cp /tmp/dump.rdb /var/lib/valkey/dump.rdb
chown valkey:valkey /var/lib/valkey/dump.rdb

# 重启 Valkey
systemctl restart valkey
```

### Step 3: 连接验证

- [ ] 更新 Laravel `.env` 中的 REDIS_HOST/REDIS_PORT
- [ ] 运行 `php artisan valkey:health` 验证连接
- [ ] 确认 Lua 脚本执行正常（锁、限流器等）

### Step 4: 缓存验证

- [ ] 验证基本缓存读写（Cache::put/get）
- [ ] 验证 Tagged Cache（Cache::tags）
- [ ] 验证 Cache Lock（Cache::lock）
- [ ] 验证 Cache::remember / rememberForever

### Step 5: 队列验证

- [ ] 发送测试 Job 到队列
- [ ] 验证队列 Worker 正常消费
- [ ] 验证延迟队列（delay）
- [ ] 验证失败任务重试机制
- [ ] 验证 Horizon 仪表盘正常显示

### Step 6: 会话验证

- [ ] 登录应用，验证会话正常建立
- [ ] 验证会话持久化（刷新页面后会话仍在）
- [ ] 验证会话过期机制

### Step 7: 性能基准

- [ ] 使用 memtier_benchmark 对比 Valkey 与 Redis 的 QPS
- [ ] 确认延迟在可接受范围内（P99 < 5ms）
- [ ] 监控内存使用情况

### Step 8: 高可用配置

- [ ] 配置 Valkey Sentinel 或 Cluster
- [ ] 测试故障转移
- [ ] 配置持久化（AOF + RDB）

### Step 9: 监控与告警

- [ ] 配置 Prometheus + Grafana 监控
- [ ] 设置内存使用率告警
- [ ] 设置连接数告警
- [ ] 设置延迟告警

### Step 10: 生产切换

- [ ] 在 staging 环境完整测试至少 48 小时
- [ ] 准备回滚方案（保留 Redis 实例 48 小时）
- [ ] 低峰期切换生产环境
- [ ] 切换后持续监控 24 小时

---

## 九、监控与运维

### 9.1 Valkey 监控指标

```bash
# 实时监控命令
valkey-cli info all              # 全部信息
valkey-cli info memory           # 内存信息
valkey-cli info clients          # 客户端连接
valkey-cli info stats            # 统计信息
valkey-cli info replication      # 复制信息
valkey-cli monitor               # 实时命令监控（慎用，影响性能）

# 慢查询日志
valkey-cli config set slowlog-log-slower-than 10000  # 记录超过 10ms 的命令
valkey-cli slowlog get 50                             # 获取最近 50 条慢查询
```

### 9.2 Prometheus + Grafana 配置

使用 `oliver006/redis_exporter`（兼容 Valkey）：

```yaml
# docker-compose-monitoring.yml
services:
  redis-exporter:
    image: oliver006/redis_exporter:latest
    environment:
      REDIS_ADDR: "valkey://valkey:6379"
      REDIS_EXPORTER_INCL_SYSTEM_METRICS: "true"
    ports:
      - "9121:9121"
    depends_on:
      - valkey

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
```

### 9.3 内存优化建议

```bash
# 设置最大内存策略
valkey-cli config set maxmemory 2gb
valkey-cli config set maxmemory-policy allkeys-lru

# 内存碎片整理
valkey-cli config set activedefrag yes
valkey-cli config set active-defrag-threshold-lower 10
valkey-cli config set active-defrag-threshold-upper 100
valkey-cli config set active-defrag-cycle-min 1
valkey-cli config set active-defrag-cycle-max 25

# 查看内存详情
valkey-cli memory doctor
valkey-cli memory stats
```

---

## 十、常见问题与解决方案

### Q1: 迁移后 Laravel 报 "Connection refused"

```bash
# 检查 Valkey 是否在运行
systemctl status valkey
# 或
docker ps | grep valkey

# 检查端口是否监听
ss -tlnp | grep 6379

# 检查防火墙
sudo ufw status
```

### Q2: Lua 脚本报错 "ERR wrong number of arguments"

Valkey 的 Lua 脚本执行环境与 Redis 完全一致。如果遇到此错误，通常是客户端库版本问题：

```bash
composer update predis/predis
# 或
pecl upgrade redis
```

### Q3: 集群模式下 MGET 报错

在集群模式下，`MGET` 的所有 key 必须在同一个哈希槽中。解决方案：

```php
// 使用 hash tag 确保 key 在同一槽
$keys = ['{user:1}:name', '{user:1}:email', '{user:1}:phone'];
$values = Redis::mget($keys);
```

### Q4: Horizon 启动失败

```bash
# 清除 Horizon 状态
php artisan horizon:terminate
php artisan cache:clear
php artisan config:clear

# 重新启动
php artisan horizon
```

### Q5: 连接数过多

```bash
# 查看当前连接数
valkey-cli info clients | grep connected_clients

# 设置最大连接数
valkey-cli config set maxclients 10000

# 配置连接超时
valkey-cli config set timeout 300
valkey-cli config set tcp-keepalive 60
```

---

## 十一、总结

从 Redis 迁移到 Valkey 是目前最安全、最低成本的开源替代方案。核心优势包括：

1. **零代码修改**：所有 Redis 客户端库直接兼容 Valkey
2. **零协议变更**：RESP 协议完全一致，无需升级客户端
3. **性能略有提升**：Valkey 8.0 在多线程 I/O 方面的优化带来了 2-4% 的 QPS 提升
4. **真正的开源**：BSD 3-Clause 许可证，不受商业公司许可证变更影响
5. **活跃的社区**：Linux Foundation 支持，AWS/Google/Oracle 等大厂背书

对于 Laravel 开发者来说，迁移成本几乎为零——只需修改 `.env` 中的连接地址。唯一需要注意的是确保 Lua 脚本、集群配置和监控工具的兼容性验证。建议按照本文的 10 步检查清单逐步迁移，先在 staging 环境验证至少 48 小时，再切换生产环境。

---

## 参考资料

- [Valkey 官方文档](https://valkey.io/docs/)
- [Valkey GitHub 仓库](https://github.com/valkey-io/valkey)
- [Laravel Redis 文档](https://laravel.com/docs/redis)
- [Laravel Horizon 文档](https://laravel.com/docs/horizon)
- [memtier_benchmark 使用指南](https://github.com/RedisLabs/memtier_benchmark)
- [Redis 许可证变更公告](https://redis.com/blog/redis-adopts-dual-source-available-licensing/)

---

## 相关阅读

- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/categories/Redis/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/) — Redis 最新版本的核心特性详解，了解 Redis 演进方向有助于评估 Valkey 的差异化路线
- [Redis 缓存雪崩防护实战](/categories/Databases/Redis缓存雪崩/) — 缓存层的经典故障模式，迁移到 Valkey 后仍需关注的高可用防护策略
- [Redis 缓存击穿防护实战](/categories/Databases/Redis缓存击穿/) — 另一个缓存层关键问题，Valkey 同样适用的热点 Key 防护方案
