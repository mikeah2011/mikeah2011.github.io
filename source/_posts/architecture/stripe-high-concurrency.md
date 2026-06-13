---
title: "Stripe 支付 - 支付流程完整设计与高并发场景下的幂等性保障踩坑记录"
date: 2026-05-04 12:01:45
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "Stripe 支付系统完整设计实战：涵盖 PaymentIntent 支付流程、Webhook 签名验证与队列异步处理、幂等性保障（Idempotency-Key）、3D Secure 超时踩坑、高并发连接池复用等核心方案，来自 KKday B2C API 高并发场景的真实生产踩坑与架构优化记录。"
updated: null
tags: [Laravel, Stripe, 支付, 高并发, Webhook, 幂等性, PaymentIntent, B2C]
keywords: [Stripe, 支付, 支付流程完整设计与高并发场景下的幂等性保障踩坑记录, 技术杂谈]
categories:
  - misc
  - payment



---

## 前言：为什么要深入研究 Stripe 支付？

在 KKday B2C API 业务中，我们面临高并发下单场景（每秒数百笔订单），支付是核心交易链路。早期使用第三方支付网关对接，存在以下痛点：

- ✅ 对账异常率高（第三方回调延迟导致）
- ✅ 幂等性设计复杂（重复支付、重复扣款风险）
- ✅ Webhook 可靠性差（网络抖动导致漏单）

经过技术选型，我们最终选择 **Stripe** 作为核心支付网关。本文记录完整的 Stripe 支付实战经验，包括：**支付流程设计、Webhook 可靠性保障、幂等性设计模式、高并发场景踩坑**。

---

## 一、整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        KKday Payment Gateway Layer                       │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐    │
│  │ Client App   │──▶│ Laravel API  │──▶│ Stripe Platform          │    │
│  │ (Web/Mobile) │◀─ │              │◀─ │                          │    │
│  │              │   │ • Charge API │   │ • Customer Management     │    │
│  └──────────────┘   │ • Webhook    │   │ • Payment Intent          │    │
│                      │ • Confirm    │   │ • Refund                  │    │
│  ┌──────────────┐   └──────────────┘   └──────────────────────────┘    │
│  │ Third-party  │                                                  │    │
│  │ Payment Gateway                    │                             │    │
│  │ (微信/支付宝)                        │                             │    │
│  └──────────────┘   ┌──────────────┐   └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
         ↑              ↑                  ↑
      用户支付        API 处理          Webhook 回调
```

**关键设计原则：**
- 同步接口返回 `pending` 状态，由 Webhook 异步更新支付结果
- 幂等性表 (`order_payments`) 防止重复处理同一笔订单
- Idempotency-Key 机制保障 webhook 可靠性

---

## 二、核心实体设计：Customer + PaymentIntent + OrderPayment

Stripe 推荐使用 `PaymentIntent`（原 Intent）而非老的 `Charge`，支持更好的重试与取消逻辑。

### 1. Laravel 模型层设计

```php
// app/Models/PaymentIntent.php
class PaymentIntent extends Model implements Contracts\PaymentGateway {

    protected $table = 'stripe_payment_intents';
    protected $guarded = [];

    protected $casts = [
        'amount' => 'integer',
        'currency' => 'string',
        'status' => 'enum:created|processing|succeeded|failed|canceled',
    ];

    public function customer()
    {
        return $this->belongsTo(Customer::class, 'customer_id');
    }

    public function orderPayment()
    {
        return $this->hasOne(OrderPayment::class, 'stripe_intent_id');
    }

    /**
     * 创建 PaymentIntent（调用 Stripe API）
     */
    public static function create($data)
    {
        $client = new StripeClient(env('STRIPE_SECRET_KEY'));

        try {
            return $client->paymentIntents->create([
                'amount' => (int) round($data['amount'] * 100), // Stripe 单位是 cents
                'currency' => strtolower($data['currency']),
                'customer' => env('STRIPE_CUSTOMER_ID'),
                'confirmation_method' => 'automatic',
                'payment_method_types' => ['card'],
                'description' => $data['order_no'],
            ]);
        } catch (Client\Exception\StripeException $e) {
            Log::error('Stripe PaymentIntent 创建失败', ['error' => $e->getMessage()]);
            throw new \Exception('支付网关初始化失败', 500);
        }
    }

    /**
     * 确认支付（处理 Webhook）
     */
    public function confirmPayment(Request $request, IdempotencyKey $id)
    {
        $client = new StripeClient(env('STRIPE_SECRET_KEY'));
        
        try {
            // 关键：使用 Stripe 的 Idempotency-Key
            return $client->paymentIntents->retrieve(
                $this->stripe_intent_id,
                ['idempotency_key' => $id]
            );
        } catch (\Exception $e) {
            throw new \Exception('支付确认失败', 500);
        }
    }

}
```

### 2. OrderPayment（订单支付关联表）

```php
// app/Models/OrderPayment.php
class OrderPayment extends Model implements Contracts\PaymentGateway {

    protected $fillable = [
        'order_id', 'stripe_intent_id', 'amount', 'currency',
        'status', 'payment_status', 'webhook_count'
    ];

    /**
     * 幂等性表：同一 order_id + stripe_intent_id 只能有一条记录
     */
    protected $uniqueId = ['order_id', 'stripe_intent_id'];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * 幂等性检查：防止重复处理同一笔支付
     */
    public static function idempotencyCheck($orderId, $stripeIntentId)
    {
        $record = self::where('order_id', $orderId)
                      ->where('stripe_intent_id', $stripeIntentId)
                      ->first();

        if ($record) {
            return ['exist' => true, 'data' => $record];
        }

        return null; // 需要创建新记录
    }

}
```

---

## 三、支付流程实现：从下单到支付完成

### 1. API 接口层（同步）

```php
// app/Http/Controllers/PaymentController.php
class PaymentController extends Controller {

    public function createPaymentOrder(Request $request)
    {
        // 1️⃣ 校验订单基础信息
        $order = Order::findOrFail($request->order_id);

        // 2️⃣ 生成 Idempotency-Key
        $idempotencyKey = 'payment_intent_' . $order->no . '_' . time();

        // 3️⃣ 检查订单状态（防止重复下单）
        if ($order->status !== Order::STATUS_PENDING_PAYMENT) {
            return response()->json(['msg' => '订单已支付']);
        }

        // 4️⃣ 创建 Stripe PaymentIntent
        try {
            $intent = PaymentIntent::create([
                'amount' => $order->total_amount,
                'currency' => $order->currency,
            ]);

            return response()->json([
                'code' => 0,
                'msg' => '创建成功',
                'data' => [
                    'intent_id' => $intent['id'],
                    'client_secret' => $intent['client_secret'] // 前端用这个调用 stripe.js 确认支付
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'code' => -1,
                'msg' => $e->getMessage()
            ], 502);
        }
    }

}
```

### 2. Webhook 处理（异步）

```php
// app/Http/Middleware/StripeWebhookHandler.php
class StripeWebhookHandler {

    public function handle(Request $request, PaymentIntent $intent)
    {
        // 1️⃣ 验证 Webhook 签名（防止伪造）
        if (!$this->verifySignature($request)) {
            return response('invalid signature');
        }

        // 2️⃣ 获取事件对象
        $event = json_decode((string) $request->getContent(), true);

        try {
            $data = stripe()->webhook(
                [
                    'event' => $event,
                    'wh_secret' => env('STRIPE_WEBHOOK_SECRET'),
                ]
            );

            // 3️⃣ 事件类型判断
            switch ($data['type']) {
                case 'payment_intent.succeeded':
                    $this->handlePaymentSuccess($intent, $data);
                    break;
                case 'payment_intent.payment_failed':
                    $this->handlePaymentFailed($intent, $data);
                    break;
                case 'invoice.payment_succeeded':
                    $this->handleInvoiceSuccess($intent, $data);
                    break;
            }

        } catch (\Exception $e) {
            Log::error('Webhook 处理异常', ['event' => $data['type'], 'error' => $e->getMessage()]);
        }
    }

    private function handlePaymentSuccess($intent, $payload)
    {
        // 4️⃣ 幂等性检查：同一订单是否已标记为支付成功
        $order = OrderPayment::where('stripe_intent_id', $intent['id'])->first();
        
        if ($order && $order->payment_status === OrderPayment::STATUS_PAID) {
            return; // 已处理，忽略
        }

        // 5️⃣ 更新订单状态
        OrderPayment::where('stripe_intent_id', $intent['id'])
            ->update(['payment_status' => OrderPayment::STATUS_PAID]);
    }

}
```

---

## 四、踩坑记录：真实生产环境遇到的坑

### 坑 1️⃣ Webhook 重复触发导致状态覆盖

**场景：** 用户支付后，Stripe 网络抖动触发两次 `payment_intent.succeeded` Webhook。

**问题表现：**
```php
// 第一次正常处理，更新 payment_status = 'paid'
OrderPayment::where('stripe_intent_id', $id)
    ->update(['payment_status' => 'paid']);

// 第二次又执行同样逻辑，但此时订单可能已经被用户取消或退款
```

**解决方案：**

```php
// 增加幂等性表记录
public function handlePaymentSuccess($intent, $payload)
{
    // 1. 检查是否已处理过（原子操作）
    $order = OrderPayment::where('stripe_intent_id', $intent['id'])
                          ->where('payment_status', '!=', OrderPayment::STATUS_PAID)
                          ->update(['webhook_count' => DB::raw('webhook_count + 1')]);

    if (!$order) {
        Log::info('Webhook 已处理过，忽略重复触发', ['intent_id' => $intent['id']]);
        return;
    }
}
```

**架构改进：Inbox-Outbox 模式（与幂等性设计模式系列文章呼应）**

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Payment    │    │    Order     │    │  Webhook     │
│    Handler    │◀─▶│   Service    │◀─▶│  Processor    │
└──────────────┘    └──────────────┘    └──────────────┘
      ↓                   ↓                    ↓
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Stripe Intent │    │  OrderPayment│    │   Log Table  │
│       SUCCEEDED│   (payment_status)│   (webhook_event) │
└──────────────┘    └──────────────┘    └──────────────┘
```

### 坑 2️⃣ Stripe 3D Secure 验证超时导致订单失败

**场景：** 用户使用信用卡支付，触发 3D Secure 验证但超时。

**问题表现：**
- Stripe API 返回 `action` 需要跳转银行页面
- 用户点击后跳转超时，回调未触发
- OrderPayment 状态停留在 `processing`

**解决方案：**

```php
// 在 PaymentIntent 创建时禁用 3DS（国内环境）
$intent = PaymentIntent::create([
    'amount' => $order->total_amount,
    'currency' => $order->currency,
    'confirm' => true, // 自动确认
    'confirmation_method' => 'automatic',
    'receipt_email' => $order->user_email,
    'metadata' => [
        'source' => 'webhook',
        'version' => config('stripe.version'),
    ],
]);

// 处理 confirm() 失败的情况
public function handlePaymentConfirmed($data)
{
    if ($data['status'] !== $data['charge']['status']) {
        // 自动确认失败，回滚到 pending 状态
        OrderPayment::where('stripe_intent_id', $data['id'])
            ->update(['payment_status' => 'failed']);
    }
}
```

### 坑 3️⃣ Webhook 签名验证失败导致漏单

**场景：** 服务器环境变量 `STRIPE_WEBHOOK_SECRET` 未及时更新，新 webhook 无法通过验证。

**问题表现：**
```php
// ❌ 错误配置：使用公钥而不是密钥
$wh_secret = env('STRIPE_PUBLISHABLE_KEY'); // 应该是 SECRET_KEY!

if (!$this->verifySignature($request)) {
    return response('invalid signature');
}
```

**解决方案：**

```bash
# ✅ 正确配置（.env）
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx # webhook signing secret
```

```php
// ✅ 验证签名（官方 SDK）
$payload = (string) $request->getContent();
$timestamp = $request->header('Stripe-Signature');

try {
    // 使用 Stripe Signature Verification Middleware
    return stripe()->verifyWebhook(
        $payload,
        $timestamp,
        env('STRIPE_WEBHOOK_SECRET')
    );
} catch (\Exception $e) {
    Log::error('Webhook 签名验证失败', ['error' => $e->getMessage()]);
    return response('invalid signature', 400);
}
```

### 坑 4️⃣ 支付成功后未及时更新订单状态导致并发下单

**场景：**
- A 用户下单成功，进入待支付状态
- B 用户点击"立即支付"但实际未支付
- C 用户点击取消订单，管理员误操作恢复为待支付

**问题表现：**
```php
// ❌ 错误：没有原子性检查
Order::where('status', 'pending_payment')
    ->find($orderId)
    ->update(['total_amount' => $newAmount]); // 可能覆盖其他用户的金额！
```

**解决方案：**

```php
// ✅ 事务 + 乐观锁保证数据一致性
public function updateOrderAmount($orderNo, $newAmount)
{
    Order::transaction(function () use ($orderNo, $newAmount) {
        $order = Order::with(['payments'])
            ->where('no', $orderNo)
            ->lockForUpdate() // 悲观锁
            ->first();

        if (!$order || $order->status !== Order::STATUS_PENDING_PAYMENT) {
            throw new \Exception('订单不存在或已支付');
        }

        $payments = $order->payments; // 关联查询

        foreach ($payments as $payment) {
            // 检查是否已经全额支付
            if ($payment->total_paid >= $newAmount) {
                continue; // 已支付，跳过
            }

            // 计算差额
            $remain = $newAmount - $payment->total_paid;
            OrderPayment::create([
                'order_id' => $order->id,
                'amount' => $remain,
                'currency' => $order->currency,
                'status' => OrderPayment::STATUS_PENDING,
            ]);
        }
    });
}
```

---

## 五、高并发场景下的支付优化方案

### 1️⃣ Stripe 连接池复用（减少 API 调用）

Stripe SDK 默认每个请求新建 Connection，高并发下性能差。

**优化方案：**
- 使用 `StripeClient` 单例模式
- 设置合理连接池大小
- 开启 HTTP Keep-Alive

```php
// app/Services/StripeService.php
class StripeService {

    protected static $client = null;

    public static function client()
    {
        if (!self::$client) {
            self::$client = new StripeClient(env('STRIPE_SECRET_KEY'));
            
            // 设置连接池参数
            self::$client->getHttpClient()->setConnectTimeout(30);
            self::$client->getHttpClient()->setMaxRedirects(2);
        }

        return self::$client;
    }

}
```

### 2️⃣ Webhook 队列处理（避免阻塞）

将 webhook 处理放入队列，避免网络抖动时阻塞 API。

```php
// Handle Webhook asynchronously using queue
class StripeWebhookHandler extends Queueable implements Contracts\PaymentGateway {

    public function handle(Request $request, PaymentIntent $intent)
    {
        // 验证签名
        if (!$this->verifySignature($request)) {
            return response('invalid signature', 400);
        }

        try {
            $event = json_decode((string) $request->getContent(), true);
            
            // 入队处理，异步更新订单状态
            StripeEvent::dispatch($intent['id'], $event);
            
            return response('webhook accepted');
        } catch (\Exception $e) {
            Log::error('Webhook 处理异常', ['error' => $e->getMessage()]);
            return response('error processing webhook', 500);
        }
    }

}
```

---

## 六、总结：Stripe 支付实战核心要点

| 模块 | 关键实践 | 踩坑经验 |
|------|---------|---------|
| **API 设计** | PaymentIntent + Webhook 异步回调 | 避免同步返回真实支付状态 |
| **幂等性** | Idempotency-Key + webhook_count | 处理重复触发 |
| **安全性** | 签名验证 + 密钥隔离 | 区分 publishable/secret/webhook_secret |
| **高并发** | 连接池复用 + 队列异步处理 | 避免阻塞 API 调用 |
| **监控告警** | Stripe 事件监听 + 日志审计 | 及时处理 webhook 失败 |

---

## 七、解决方案对比：幂等性保障策略

| 方案 | 实现复杂度 | 可靠性 | 适用场景 | 缺点 |
|------|-----------|--------|---------|------|
| **数据库唯一索引** | 低 | 高 | 单库单表 | 分布式场景需额外处理 |
| **Redis SET NX** | 中 | 中 | 高并发短时幂等 | 需处理过期与 Redis 宕机 |
| **Idempotency-Key（Stripe 原生）** | 低 | 高 | 第三方支付集成 | 依赖外部服务 |
| **状态机 + 版本号（乐观锁）** | 中 | 高 | 多步骤状态流转 | 并发冲突需重试 |
| **Inbox-Outbox 模式** | 高 | 极高 | 事件驱动 / 微服务 | 架构复杂，需消息中间件 |

> **选型建议：** 与第三方支付对接推荐 **Idempotency-Key + 数据库唯一索引** 双保险；内部服务间推荐 **Inbox-Outbox** 模式。

---

## 八、扩展阅读与参考资料

- [Stripe API Documentation](https://stripe.com/docs/api)
- [Laravel Stripe Guide](https://laravel-packages.com/stripe)
- [3D Secure 验证流程（欧洲/澳洲必开）](https://stripe.com/docs/payments/3d-auth)
- [Refund 退款实现（Stripe 官方示例）](https://stripe.com/docs/refunds)

---

**本文档由 KKday B2C API 团队整理，实战踩坑记录真实有效。**  
如有疑问，欢迎交流探讨支付系统架构设计。

---

## 相关阅读

- [支付系统设计实战：多通道集成、对账退款与异常处理](/categories/Payment/payment-system-design/)
- [Webhook 集成最佳实践：签名验证、重试与幂等处理](/categories/API/webhook-best-practices/)
- [电商秒杀系统设计：Redis 预扣减 + 消息队列异步下单 + 限流策略实战](/categories/架构/2026-06-01-flash-sale-system-design-redis-pre-deduction-mq-async-ordering-rate-limiting/)
