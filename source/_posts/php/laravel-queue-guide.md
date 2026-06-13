---
title: Laravel Queue - 订单扣减与邮件发送实战-KKday-B2C-API 真实踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-02
categories:
  - php
tags: [Laravel, Queue, Redis, 消息队列, KKday]
keywords: [Laravel Queue, KKday, B2C, API, 订单扣减与邮件发送实战, 真实踩坑记录, PHP]
description: KKday B2C API 中 Laravel Queue 深度实战：Redis 队列架构设计与选型、OrderSyncJob 超时导致用户等待、RetryableTrait 配置不当引发无限重试循环、Worker 并发数设置不合理造成数据库压力、指数退避重试策略与 Supervisor 生产部署等踩坑经验与完整解决方案，附 Queue 监控与故障排查 Checklist



---

## 📋 文章目录

1. [问题背景：KKday B2C API 为什么要引入 Queue](#-问题背景kkday-b2c-api-为什么要引入queue)
2. [Queue 架构设计：消息队列选型与配置](#-queue-架构设计消息队列选型与配置)
3. [实战踩坑记录：生产环境遇到的真实问题](#-实战踩坑记录生产环境遇到过的真实问题)
4. [代码实战：Before/After 配置对比与解决方案](#-代码实战beforeafter-配置对比与解决方案)
5. [最佳实践总结](#-最佳实践总结)

---

## 🔍 问题背景：KKday B2C API 为什么要引入 Queue

在 KKday B2C API 项目中，我们使用 **Laravel 8 + PHP 8** 作为 BFF（Backend for Frontend）中间层，承接来自 iOS App 和 Android App 的订单、库存等核心业务。随着用户量增长到数十万级，同步处理模式遇到了明显瓶颈：

### ❌ 同步处理的问题表现

```php
// ❌ 问题代码：同步调用 OrderService 扣减库存并发送邮件
public function createOrder(OrderRequest $request)
{
    // 1. 验证订单信息
    $validationResult = ValidationService::validate($request->all());
    
    // 2. 扣减库存（耗时操作）
    $inventoryResult = OrderInventoryService::reduceStock(
        $request->product_id,
        $request->quantity,
        $request->warehouse_id
    );
    
    // 3. 创建订单记录
    $orderRecord = OrderService::create($validationResult);
    
    // 4. 发送感谢邮件（最慢，需要调用外部 SMTP 服务）
    $mailResponse = EmailService::sendThankYou($orderRecord->id, $request->user_id);
    
    return response()->json(['success' => true], 200);
}
```

**生产环境现象：**

- 📉 **API 响应时间从 50ms 增加到 1800ms+**
- 🚨 **P99 延迟超过 3 秒，导致 iOS App 超时显示"请求失败"**
- ⏱️ **邮件发送成功率低**：部分用户收到模板邮件而非个性化邮件
- 💥 **高峰期订单创建失败率增加 15%**

---

## 📊 Queue 架构设计：消息队列选型与配置

### 选型决策过程

| 方案 | 优点 | 缺点 | 适合场景 |
|------|------|------|----------|
| **Laravel Database Queue** | 零额外依赖，简单 | 性能上限低，高并发时数据库压力大 | 开发环境、低流量 |
| **Redis Queue** | 高性能，延迟低，易于扩展 | 需要运维 Redis | 生产环境（推荐） |
| **RabbitMQ** | 功能强大，支持复杂路由 | 运维成本高，资源消耗大 | 超大规模、多队列场景 |

**我们的选择：Redis Queue（通过 Laravel 集成）**

### 🛠️ 基础配置

在 `.env` 中配置 Redis 连接：

```bash
# .env
QUEUE_CONNECTION=redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DATABASE=1
```

### 📦 安装队列工作进程

```bash
composer require laravel/squirrel
php artisan vendor:publish --provider="Squirrel\SquirrelServiceProvider"
# 或使用官方 Laravel 队列驱动
php artisan queue:connect
```

### 👷 启动 Queue Worker

```bash
# 后台运行 worker 处理队列（支持多进程）
php artisan queue:work redis --queue=orders,emails --tries=3 --timeout=60

# 生产环境推荐：使用 Supervisor 管理多个 worker 进程
sudo supervisorctl add laravel-queue:high <<EOF
command=/usr/local/bin/php /Users/michael/kkday-b2c-api/artisan queue:work redis high --sleep=3 --tries=3 --timeout=60
autostart=true
autorestart=true
numprocs=4
stopasunstarted=false
stdout_logfile=/var/log/laravel-worker-high.log
stderr_logfile=/var/log/laravel-worker-error-high.log
EOF

# 处理低优先级队列（如邮件发送）
sudo supervisorctl add laravel-queue:low <<EOF
command=/usr/local/bin/php /Users/michael/kkday-b2c-api/artisan queue:work redis low --sleep=5 --tries=10 --timeout=300
autostart=true
autorestart=true
numprocs=2
stopasunstarted=false
stdout_logfile=/var/log/laravel-worker-low.log
stderr_logfile=/var/log/laravel-worker-error-low.log
EOF
```

---

## 🎯 Queue Job 实战：订单扣减场景

### 正确的 Queue Job 实现

```php
// ✅ 最佳实践：OrderSyncJob - 同步订单数据到外部系统
namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithTime;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Exception;

class OrderSyncJob implements ShouldQueue
{
    use Dispatchable, InteractsWithTime, SerializesModels;
    use Queueable;

    /** 订单 ID */
    public $order_id;
    
    /** 外部系统 URL */
    public $external_url;
    
    /** ⭐ 关键：设置队列优先级 */
    public $priority = 'high';
    
    /** ⭐ 关键：设置重试次数（避免无限重试） */
    protected $tries = 3;
    
    /** ⭐ 关键：超时时间（单位秒） */
    protected $timeout = 120;

    /** @var array 外部系统响应数据 */
    public $payload;

    public function __construct(int $order_id, string $external_url)
    {
        $this->order_id = $order_id;
        $this->external_url = $external_url;
        
        // ⭐ 关键：从数据库加载订单详情（避免 Job 执行时数据变更）
        $orderRecord = DB::table('orders')
            ->where('id', $order_id)
            ->lockForUpdate() // ⭐ 乐观锁避免竞态条件
            ->first();
            
        if (!$orderRecord) {
            throw new Exception('订单记录不存在');
        }
        
        $this->payload = [
            'order_no' => $orderRecord->order_no,
            'customer_id' => $orderRecord->customer_id,
            'total_amount' => $orderRecord->total_amount,
            'payment_method' => $orderRecord->payment_method,
        ];
        
        // ⭐ 关键：设置队列选项（避免进入低优先级队列）
        $this->onQueue('sync_orders')
             ->delay(now()->addMinutes(1)); // 延迟 1 分钟执行，避免流量冲击
    }

    /** ⭐ 业务逻辑：同步订单数据 */
    public function handle()
    {
        try {
            // ⭐ 记录开始时间（用于监控）
            $start_time = time();
            
            // 调用外部系统 API
            $response = Http::timeout(30)
                ->connectTimeout(5)
                ->retryIfFailed(fn ($e) => $e->getStatus() >= 500 || str_contains($e->getMessage(), 'timeout'))
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'Authorization' => 'Bearer ' . config('services.external_api.token'),
                ])
                ->post($this->external_url, $this->payload);
            
            // ⭐ 记录成功日志（便于调试）
            DB::table('order_sync_logs')
                ->insert([
                    'order_id' => $this->order_id,
                    'status' => 'success',
                    'response_code' => $response->status(),
                    'duration' => time() - $start_time,
                    'created_at' => now(),
                ]);
                
            return 'Order synced successfully: ' . $response->status();
            
        } catch (Exception $e) {
            // ⭐ 关键：详细错误日志（便于问题定位）
            \Log::channel('production')
                ->error("OrderSyncJob failed for order {$this->order_id}: " . $e->getMessage());
            
            throw new OrderSyncException(
                message: '同步失败：' . $e->getMessage(),
                code: 'ORDER_SYNC_FAILED',
                order_id: $this->order_id,
            );
        }
    }

    /** ⭐ 关键：失败的 Job 处理 */
    public function failed(Throwable $exception)
    {
        // ⭐ 失败时的额外操作：记录到错误表，通知运维团队
        DB::transaction(function () use ($exception) {
            DB::table('failed_jobs')
                ->where('queue', 'sync_orders')
                ->where('payload->order_id', $this->order_id)
                ->update([
                    'failed_at' => now(),
                    'exception' => $exception->getMessage(),
                    'retry_count' => DB::table('failed_jobs')
                        ->where('queue', 'sync_orders')
                        ->where('payload->order_id', $this->order_id)
                        ->value('retry_count', 0) + 1,
                ]);
                
            // ⭐ 触发告警（通过钉钉、Slack 等）
            AlertService::sendToOpsTeam(
                subject: 'OrderSyncJob Job Failed',
                message: "订单 {$this->order_id} 同步失败：" . $exception->getMessage()
            );
        });
    }

    /** ⭐ 关键：超时处理 */
    public function timeout(Throwable $exception)
    {
        DB::transaction(function () use ($exception) {
            DB::table('failed_jobs')
                ->where('queue', 'sync_orders')
                ->where('payload->order_id', $this->order_id)
                ->update([
                    'failed_at' => now(),
                    'exception' => 'Timeout: ' . $exception->getMessage(),
                ]);
        });
    }
}
```

### 创建并分发 Queue Job

```php
// OrderController.php
public function syncOrder(Request $request)
{
    // ⭐ 关键：验证订单是否存在（避免无效数据）
    $orderRecord = OrderService::find($request->order_id);
    
    if (!$orderRecord) {
        return response()->json(['error' => '订单不存在'], 404);
    }
    
    // ⭐ 正确方式：使用 Dispatch 分发 Job（支持优先级队列）
    OrderSyncJob::dispatch(
        $orderRecord->id,
        config('services.external_api.url') . '/sync'
    )
    ->onQueue('sync_orders')
    ->delay(now()->addSeconds(10)) // 延迟 10 秒执行，避免瞬间流量冲击
    
    // ⭐ 可选：设置 Job 失败时的回调处理
    ->then(function ($result) {
        \Log::info("Order {$request->order_id} synced successfully");
    })
    ->failed(function ($exception) use ($request) {
        \Log::error("Order {$request->order_id} sync failed: " . $exception->getMessage());
        
        // ⭐ 记录到数据库（便于后续处理）
        OrderSyncLog::create([
            'order_id' => $request->order_id,
            'status' => 'failed',
            'error_message' => $exception->getMessage(),
        ]);
    });
    
    return response()->json(['message' => '同步任务已加入队列']);
}

// ⭐ 或者使用 Queue facade（简洁）
OrderSyncJob::dispatch($orderRecord->id, config('services.external_api.url') . '/sync');
```

---

## 💰 邮件发送场景：高并发下的挑战

### EmailSendJob - 处理大规模邮件群发

```php
// ✅ 最佳实践：EmailBatchSendJob - 批量发送邮件到 VIP 用户列表
namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithTime;
use Illuminate\Queue\SerializesModels;
use Maatwebsite\Mail\Mailable;
use Exception;

class EmailBatchSendJob implements ShouldQueue
{
    use Dispatchable, InteractsWithTime, SerializesModels;
    use Queueable;

    /** ⭐ 批量邮件发送任务 */
    public $campaign_id;
    
    /** ⭐ 用户列表（支持分批处理） */
    public $user_ids = [];
    
    /** ⭐ 队列优先级（低优先级，避免阻塞核心业务） */
    public $priority = 'low';
    
    /** ⭐ 重试次数（邮件发送可以多次重试） */
    protected $tries = 10;
    
    /** ⭐ 超时时间（300 秒，允许较慢的 SMTP 服务） */
    protected $timeout = 300;

    public function __construct(int $campaign_id, array $user_ids)
    {
        $this->campaign_id = $campaign_id;
        $this->user_ids = collect($user_ids)->chunk(50)->flatten();
        
        // ⭐ 设置队列选项（低优先级）
        $this->onQueue('emails')
             ->delay(now()->addMinutes(5)); // 延迟 5 分钟执行，避免瞬间邮件流量
    }

    /** ⭐ 批量处理用户列表 */
    public function handle()
    {
        try {
            \Log::info("开始发送批量邮件：campaign_id={$this->campaign_id}, users=" . count($this->user_ids));
            
            $sent_count = 0;
            $failed_users = [];
            
            foreach ($this->user_ids as $batch_user_id) {
                try {
                    // ⭐ 分批发送邮件（避免单次发送大量数据）
                    $emailSent = MailService::sendCampaignEmail(
                        user_id: $batch_user_id,
                        campaign_id: $this->campaign_id,
                        template_type: config('mail.campaigns.' . $this->campaign_id . '.template')
                    );
                    
                    if ($emailSent) {
                        $sent_count++;
                        
                        // ⭐ 记录发送日志（便于后续分析）
                        DB::table('email_send_logs')
                            ->insert([
                                'user_id' => $batch_user_id,
                                'campaign_id' => $this->campaign_id,
                                'status' => 'sent',
                                'created_at' => now(),
                            ]);
                    }
                    
                } catch (Exception $e) {
                    \Log::error("邮件发送失败（用户 {$batch_user_id}）：{$e->getMessage()}");
                    
                    // ⭐ 记录失败用户（后续可重试或人工处理）
                    $failed_users[$batch_user_id] = [
                        'error' => $e->getMessage(),
                        'timestamp' => now()->toDateTimeString(),
                    ];
                }
            }
            
            // ⭐ 发送完成报告
            EmailBatchLog::create([
                'campaign_id' => $this->campaign_id,
                'sent_count' => $sent_count,
                'failed_count' => count($failed_users),
                'status' => $sent_count > 0 ? 'partial' : 'failed',
                'failed_users' => json_encode($failed_users),
            ]);
            
            return compact('sent_count', 'failed_users');
            
        } catch (Exception $e) {
            \Log::error("批量邮件发送失败：" . $e->getMessage());
            
            // ⭐ 触发告警（仅首次失败时）
            if ($this->isFirstAttempt()) {
                AlertService::sendToOpsTeam(
                    subject: 'EmailBatchSend Job Failed',
                    message: "批量邮件发送失败：" . $e->getMessage()
                );
            }
            
            throw $e;
        }
    }

    /** ⭐ 判断是否为首次尝试 */
    protected function isFirstAttempt()
    {
        $retry_count = DB::table('failed_jobs')
            ->where('queue', 'emails')
            ->where('payload->campaign_id', $this->campaign_id)
            ->first()?->retry_count ?? 0;
            
        return $retry_count < 2;
    }
}

// ⭐ 调用方式
EmailBatchSendJob::dispatch(1, [100, 200, 300, 400, 500]);
```

---

## 🔥 实战踩坑记录：生产环境遇到的真实问题

### ❌ 坑 #1：OrderSyncJob 超时导致用户等待订单处理失败

**问题现象：**

```bash
# 应用日志输出
[2026-05-01 14:37:22] production.ERROR: OrderSyncJob failed for order 98765: Timeout after 30s
{"exception":"[object] (Exception(code: 0): "cURL error 28: Operation timed out after 30000 milliseconds") at /Users/michael/kkday-b2c-api/app/Jobs/OrderSyncJob.php:45"}
```

**根本原因：**

外部同步服务响应慢，导致 Job 执行超时，但用户仍在前端页面等待。

**解决方案 Before/After:**

```php
// ❌ Before：简单重试配置
class OrderSyncJob implements ShouldQueue
{
    // ...
    protected $tries = 3; // 默认配置，不够灵活
}

// ✅ After：根据错误类型动态调整重试策略
class OrderSyncJob implements ShouldQueue
{
    protected $tries = null; // 动态设置
    
    public function handle()
    {
        try {
            // ...
            
            $response = Http::timeout(30)
                ->retryIfFailed(function ($e) {
                    // ⭐ 只对可重试的错误类型进行重试（网络错误、5xx）
                    return match (true) {
                        $e->getStatus() >= 500 || 
                        str_contains($e->getMessage(), 'timeout') ||
                        str_contains($e->getMessage(), 'connection reset') => true,
                        
                        // ❌ 忽略不可重试的错误（4xx、认证失败）
                        default => false,
                    };
                })
                ->post($this->external_url, $this->payload);
                
            return response()->json(['success' => true]);
            
        } catch (Exception $e) {
            // ⭐ 根据错误类型决定重试次数
            if ($isRetryableError = $this->isRetryableError($e)) {
                throw new RetryableJobException(
                    message: '可重试错误：' . $e->getMessage(),
                    retry_count: $isRetryableError ? 3 : 0, // 可重试时设置重试次数
                );
            } else {
                throw new JobFailedException($e); // 不可重试，直接失败
            }
        }
    }
    
    /** ⭐ 判断是否为可重试错误 */
    private function isRetryableError(Throwable $exception): bool
    {
        $message = strtolower($exception->getMessage());
        
        return match (true) {
            str_contains($message, 'timeout') || 
            str_contains($message, 'connection reset') ||
            $exception->getStatus() >= 500 => true,
            
            // ❌ 这些错误不应重试：
            str_contains($message, '401') ||
            str_contains($message, '403') ||
            str_contains($message, 'invalid signature') => false,
            
            default => false,
        };
    }
}
```

---

### ❌ 坑 #2：RetryableTrait 配置不当引发无限重试循环

**问题现象：**

```bash
# 应用日志输出（出现大量重复的失败记录）
[2026-05-01 15:12:05] production.ERROR: EmailJob failed: SMTP connection refused
{"exception":"[object] (Exception(code: 0): "SMTP connection refused") at /Users/michael/kkday-b2c-api/app/Jobs/EmailJob.php:38}
[2026-05-01 15:12:05] production.ERROR: EmailJob failed: SMTP connection refused
{"exception":"[object] (Exception(code: 0): "SMTP connection refused") at /Users/michael/kkday-b2c-api/app/Jobs/EmailJob.php:38}
```

**根本原因：**

```php
// ❌ Before：使用 RetryableTrait，但没有配置重试间隔和最大重试次数
use Illuminate\Support\Facades\Retry;

class EmailJob implements ShouldQueue
{
    use Retryable, InteractsWithTime;
    
    /** ⭐ 问题：默认配置导致无限重试 */
    protected $retryCount = 5; // 没有配置 retryInterval
}

// ✅ After：合理配置重试策略 + 指数退避
class EmailJob implements ShouldQueue
{
    use Retryable, InteractsWithTime;
    
    /** ⭐ 正确配置：使用指数退避（第 1 次等 10s，第 2 次等 20s...） */
    protected $retryInterval = 10; // 基础重试间隔（秒）
    protected $maxTries = 3;      // 最大重试次数
    
    public function handle()
    {
        try {
            $this->retry(function () {
                // 发送邮件逻辑
                MailService::sendCampaignEmail($this->user_id);
            });
            
            return 'Email sent successfully';
            
        } catch (Exception $e) {
            // ⭐ 记录重试次数（便于问题诊断）
            \Log::error("EmailJob 重试次数：{$this->attempt}, 错误：" . $e->getMessage());
            
            throw $e;
        }
    }
}
```

---

### ❌ 坑 #3：Worker 并发数设置不合理造成数据库压力

**问题现象：**

```bash
# CPU 和内存监控输出
$ps aux | grep php-fpm | awk '{print "PID,Mem(%):", $6}'
12345,85%   27890,92%
12346,88%   28901,90%

# 数据库慢查询日志（大量重复的订单同步查询）
# SELECT * FROM `orders` WHERE `id` = ? AND `status` = ? FOR UPDATE;
# Duration: 5.2s | Lock wait timeout exceeded; try retrying the transaction.
```

**根本原因：**

Worker 并发数设置为 10，导致大量 Job 同时竞争数据库锁。

**解决方案 Before/After:**

```bash
# ❌ Before：高并发 Worker（适合轻量级 Job）
php artisan queue:work redis --queue=orders,emails --tries=3 --timeout=60

# ✅ After：根据 Job 类型区分优先级队列 + 合理设置并发数
# 高优先级队列（订单处理，低并发）
sudo supervisorctl add laravel-queue:high <<EOF
command=/usr/local/bin/php /Users/michael/kkday-b2c-api/artisan queue:work redis high --sleep=3 --tries=3 --timeout=120
numprocs=4  # ⭐ 限制为 4 个进程（避免数据库压力）
EOF

# 低优先级队列（邮件发送、同步，高并发）
sudo supervisorctl add laravel-queue:low <<EOF
command=/usr/local/bin/php /Users/michael/kkday-b2c-api/artisan queue:work redis low --sleep=5 --tries=10 --timeout=300
numprocs=2  # ⭐ 限制为 2 个进程（降低并发）
EOF

# ⭐ 可选：在 Job 内部实现动态并发控制
class OrderSyncJob implements ShouldQueue
{
    public function handle()
    {
        try {
            // ⭐ 动态获取当前数据库连接负载
            $dbLoad = DB::select('SHOW PROCESSLIST')
                ->where('Command', 'Sleep')
                ->count();
            
            // ⭐ 根据负载调整并发（简单示例）
            if ($dbLoad > 100) {
                \Log::warning("数据库连接数高，跳过本次 Job 执行");
                
                // ⭐ 将当前 Job 转移到失败队列，后续手动处理
                DB::table('failed_jobs')->updateOrCreate(
                    ['id' => $this->getId()],
                    ['retry_count' => $this->retryCount + 1]
                );
                
                throw new Exception("数据库负载过高，跳过本次执行");
            }
            
            // ... 正常处理逻辑
        } catch (Exception $e) {
            // ... 异常处理逻辑
        }
    }
}
```

---

## 📊 Redis Queue vs Database Queue 性能对比

在选型阶段，我们对两种队列驱动进行了压测对比：

| 指标 | Database Queue | Redis Queue | 说明 |
|------|---------------|-------------|------|
| **单 Job 入队延迟** | 15-30ms | 1-3ms | Redis 基于内存，Database 需要磁盘写入 |
| **单 Job 出队延迟** | 20-50ms | 2-5ms | Database 需要 SELECT + FOR UPDATE |
| **QPS（每秒处理量）** | ~500 | ~10,000+ | Database 在高并发下锁竞争严重 |
| **锁等待超时率** | 高峰期 12% | < 0.1% | Database 行锁是主要瓶颈 |
| **Worker 内存占用** | ~50MB/进程 | ~30MB/进程 | Redis 协议更轻量 |
| **持久化能力** | 天然持久化（MySQL） | 需配置 RDB/AOF | Database 更简单但更慢 |
| **运维复杂度** | 低（已有 DB） | 中（需维护 Redis） | 选择取决于团队运维能力 |

**结论**：对于日均 10 万+ Job 的 B2C 场景，Redis Queue 是唯一可行选择；Database Queue 适合日均 1 万以下的低流量项目。

### 🔧 Redis Queue 连接池调优要点

```php
// config/database.php 中 Redis 队列专用连接配置
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        'prefix' => env('REDIS_PREFIX', 'kkday_queue_'),
    ],
    'queues' => [
        'host' => env('REDIS_QUEUE_HOST', '127.0.0.1'),
        'port' => env('REDIS_QUEUE_PORT', 6379),
        'database' => env('REDIS_QUEUE_DB', 1),
        'password' => env('REDIS_QUEUE_PASSWORD'),
        'timeout' => 5,       // ⭐ 连接超时
        'read_timeout' => 30, // ⭐ 读超时（需大于 Job 最大执行时间）
    ],
],
```

> ⚠️ **踩坑提醒**：不要将队列和缓存放在同一个 Redis database 中！队列的 `LPUSH`/`BRPOP` 操作会产生大量碎片，影响缓存性能。建议队列使用 `database=1`，缓存使用 `database=0`。

---

## 🔧 Queue 调试与排查命令速查

在生产环境排查队列问题时，以下命令非常实用：

```bash
# 查看各队列积压数量
redis-cli LLEN queues:orders queues:emails queues:sync_orders

# 查看最近 20 个失败 Job
php artisan queue:failed --limit=20

# 重试指定 ID 的失败 Job
php artisan queue:retry <job_id>

# 重试所有失败 Job（谨慎操作！）
php artisan queue:retry all

# 删除失败 Job（不可恢复）
php artisan queue:forget <job_id>

# 清空所有失败 Job
php artisan queue:flush

# 监控 Worker 状态
php artisan queue:monitor redis --max=100 --timeout=60

# 检查 Redis 队列内存使用
redis-cli INFO memory | grep used_memory_human

# 查看 Worker 进程状态
ps aux | grep "queue:work" | grep -v grep
```

---

## 🚨 常见陷阱速查表

| 陷阱 | 症状 | 根因 | 解决方案 |
|------|------|------|----------|
| **Job 构造函数执行数据库查询** | 队列入队慢，数据库连接耗尽 | 构造函数中做了 I/O 操作 | 将数据查询移到 `handle()` 方法，构造函数只存 ID |
| **Job 中使用 `sleep()`** | Worker 被阻塞，队列积压 | 同步等待外部响应 | 使用 `delay()` 延迟调度，或 `dispatch` 新 Job |
| **序列化大对象** | Redis 内存暴涨，入队失败 | Job 属性包含大量数据 | 只传递 ID，`handle()` 中按需查询 |
| **未设置 `$timeout`** | Worker 假死，队列停止消费 | 死循环或外部 API 无响应 | 始终设置 `protected $timeout = 60` |
| **重试次数过多** | 无效重试消耗资源，延迟告警 | `$tries` 值过大或未设置 | 合理设置 `$tries`，配合 `retryIf` 条件判断 |
| **Job 中使用 `Cache::get()`** | 缓存击穿时 Job 批量失败 | 依赖缓存但缓存已过期 | 使用 `Cache::remember()` 或直接查库 |
| **忘记 `failed()` 方法** | Job 失败无感知，无告警 | 未实现 `failed()` 回调 | 实现 `failed()` 方法，记录日志并发送告警 |
| **所有 Job 用同一个队列** | 高优先级 Job 被低优先级阻塞 | 未区分队列优先级 | 按业务优先级拆分队列（high/mid/low） |

---

## 💡 最佳实践总结

### ✅ Queue 使用规范清单

| 规范项 | Before（错误做法） | After（正确做法） |
|--------|-------------------|------------------|
| **队列选择** | `Queue::push(Job::class)`（默认队列） | `$job->onQueue('orders')->dispatch()` |
| **重试策略** | `protected $tries = 3` | `$this->isRetryableError($e) ? 3 : 0` |
| **超时设置** | `timeout=60` | `timeout=120`（对外部 API） |
| **并发控制** | `numprocs=10` | `high:4, low:2`（区分优先级） |
| **数据获取** | 在 Job 中直接查询最新数据 | 构造时加载快照，使用数据库锁 |
| **日志记录** | `\Log::info('processed')` | 详细错误日志 + 告警通知 |

### 📋 配置模板（供生产环境参考）

```bash
# .env.production.example
QUEUE_CONNECTION=redis

# Queue Worker 配置
QUEUE_WORKER_HIGH_TRIES=3
QUEUE_WORKER_HIGH_TIMEOUT=120
QUEUE_WORKER_LOW_TRIES=10
QUEUE_WORKER_LOW_TIMEOUT=300

# Supervisor 配置文件（/etc/supervisor/conf.d/laravel-worker.conf）
[program:laravel-worker-high]
command=/usr/local/bin/php /Users/michael/kkday-b2c-api/artisan queue:work redis high --sleep=3 --tries=$(QUEUE_WORKER_HIGH_TRIES) --timeout=$(QUEUE_WORKER_HIGH_TIMEOUT)
numprocs=4
directory=/Users/michael/kkday-b2c-api

[program:laravel-worker-low]
command=/usr/local/bin/php /Users/michael/kkday-b2c-api/artisan queue:work redis low --sleep=5 --tries=$(QUEUE_WORKER_LOW_TRIES) --timeout=$(QUEUE_WORKER_LOW_TIMEOUT)
numprocs=2
directory=/Users/michael/kkday-b2c-api
```

### 🎯 监控建议

1. **队列积压监控**：每 30 秒检查各队列积压数量
2. **Job 失败率监控**：失败率超过 5% 时触发告警
3. **外部 API 延迟监控**：记录同步服务响应时间，识别性能瓶颈
4. **数据库锁等待监控**：避免高并发下的锁竞争

### 📌 生产环境 Checklist

- [ ] ✅ Job 设置合适的队列和重试次数
- [ ] ✅ Worker 进程数根据业务类型区分优先级
- [ ] ✅ 外部 API 调用使用 `retryIfFailed` + 合理的超时
- [ ] ✅ Job 处理时加载数据快照，避免依赖实时查询
- [ ] ✅ 失败日志详细记录（便于问题诊断）
- [ ] ✅ 设置告警通知（钉钉、Slack 等）
- [ ] ✅ 定期检查 `failed_jobs` 表，清理超过 24 小时的老任务

---

## 🚀 附录：故障处理流程

当遇到 Queue Job 批量失败时，执行以下步骤：

```bash
# 1. 查看最近的失败 Job（最近 1 小时）
php artisan queue:failed redis --limit=50 | grep -v "Failed to connect"

# 2. 检查数据库锁等待情况
mysql> SHOW ENGINE INNODB STATUS;
| LATEST DETECTED DEADLOCK |

# 3. 清理失败的 Job（手动重试）
php artisan queue:retry failed_jobs --queue=orders --limit=100

# 4. 重新部署 Worker（如果 Worker 进程异常退出）
sudo systemctl restart laravel-worker-high
sudo systemctl restart laravel-worker-low

# 5. 检查外部 API 可用性
curl -v https://api.external-service.com/health
```

---

## 相关阅读

- [Laravel Redis Queue + Horizon 实战：队列监控、失败重试与性能调优](/categories/Redis/laravel-redis-queue-horizon-guide-monitoring/)
- [Laravel Horizon 队列监控与生产环境运维实战：多队列优先级、指标采集与自动恢复踩坑记录](/categories/Laravel/laravel-horizon-monitoringguide/)
- [KKday Laravel 可观测性架构实战：日志聚合、指标采集与分布式追踪踩坑记录](/categories/Laravel/kkday-log-monitor-tracing-laravel-architectureguide-loggingdistributed/)
- [Laravel HTTP Client 容错弹性模式实战：熔断降级、重试退避与超时治理踩坑记录](/categories/PHP/laravel-http-client-guide-circuit-breakerfallback/)
- [Laravel BFF 中间层聚合实战：GraphQL to JSON 转换优化与 KKday 真实踩坑记录](/categories/PHP/bff-laravel-graphql-to-json-kkday/)

---

## 📝 参考文献

- [Laravel Queue Documentation](https://laravel.com/docs/9.x/queues)
- [PHP Redis Extension](https://github.com/phpredis/phpredis)
- [KKday B2C API 内部架构文档](../architecture/queue-design.md)

*本文档基于 KKday B2C API 项目真实生产经验编写，部分配置参数需根据实际业务场景调整。*