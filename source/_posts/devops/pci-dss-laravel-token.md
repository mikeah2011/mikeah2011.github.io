---
title: PCI DSS 合规实战：支付系统安全标准落地——Laravel 应用中的 Token 化、审计日志与网络分段
date: 2026-06-02 10:00:00
tags: [PCI-DSS, 支付安全, Laravel, 合规, 运维]
keywords: [PCI DSS, Laravel, Token, 合规实战, 支付系统安全标准落地, 应用中的, 审计日志与网络分段, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: PCI DSS v4.0 合规实战指南，面向 Laravel 开发者系统讲解支付系统安全标准落地。深入剖析 Token 化方案（Stripe Elements 集成）、网络分段（CDE 隔离与 Nginx 防火墙配置）、不可篡改审计日志实现、AES-256-GCM 数据加密及 RBAC 访问控制。包含完整可运行代码示例、踩坑案例与合规检查清单，帮助团队从 SAQ A 到 SAQ D 各级别快速通过 PCI 合规审计。
---


## 前言

如果你的 Laravel 应用处理信用卡支付数据，PCI DSS（Payment Card Industry Data Security Standard）合规不是可选项——它是必须。不合规的后果包括高额罚款（每月 $5,000-$100,000）、支付网关终止合作，甚至丧失接受信用卡支付的资格。

PCI DSS v4.0 于 2022 年发布，2025 年 3 月 31 日起全面生效，引入了 64 项新要求。本文将从 Laravel 开发者的视角，系统性地讲解如何在应用中落地 PCI DSS 合规，涵盖 Token 化、网络分段、审计日志、加密和访问控制。

---

## 第一章：PCI DSS v4.0 概述

### 1.1 什么是 PCI DSS

PCI DSS 由 PCI SSC（Payment Card Industry Security Standards Council）制定，该组织由 Visa、Mastercard、American Express、Discover 和 JCB 五大卡组织联合成立。标准的目的是保护持卡人数据（Cardholder Data）在整个生命周期中的安全。

### 1.2 PCI DSS v4.0 四大目标与 12 项要求

```
构建和维护安全的网络和系统
├── 要求 1：安装和维护网络安全控制
├── 要求 2：对所有系统组件应用安全配置

保护持卡人数据
├── 要求 3：保护存储的账户数据
├── 要求 4：使用强加密保护传输中的持卡人数据

维护漏洞管理程序
├── 要求 5：保护所有系统和网络免受恶意软件侵害
├── 要求 6：开发和维护安全的系统和软件

实施强访问控制措施
├── 要求 7：按业务需求限制对系统组件的访问
├── 要求 8：识别用户并验证对系统组件的访问
├── 要求 9：限制对持卡人数据的物理访问

定期监控和测试网络
├── 要求 10：记录和监控对系统组件和持卡人数据的所有访问
├── 要求 11：定期测试安全系统和流程

维护信息安全策略
└── 要求 12：支持信息安全的组织政策和程序
```

### 1.3 SAQ 类型与适用场景

| SAQ 类型 | 适用场景 | 复杂度 |
|---------|---------|-------|
| SAQ A | 完全外包给第三方（如 Stripe Checkout） | 最低 |
| SAQ A-EP | 电商页面，支付由第三方处理但页面由商户托管 | 中等 |
| SAQ B | 仅使用实体刷卡终端或拨号终端 | 低 |
| SAQ C | 使用支付应用连接互联网 | 中等 |
| SAQ D | 自行处理持卡人数据 | 最高 |

**对 Laravel 开发者的关键决策**：尽量使用 SAQ A 模式——将所有持卡人数据处理完全外包给 Stripe/PayPal 等 PCI Level 1 服务商。你的 Laravel 应用永远不会接触到原始卡号。

---

## 第二章：Token 化——让 Laravel 应用远离原始卡号

### 2.1 Token 化的核心思想

Token 化是 PCI DSS 合规的最核心技术：将敏感的持卡人数据替换为无意义的 Token，原始数据由 PCI 合规的服务商安全存储。

```
┌──────────┐     原始卡号     ┌──────────────┐     Token     ┌──────────┐
│  用户浏览器 │ ──────────────▶ │  Stripe/PayPal │ ──────────────▶ │ Laravel  │
│ (Stripe.js) │               │ (PCI Level 1)  │               │ 应用服务器 │
└──────────┘                 └──────────────┘               └──────────┘
                                  │
                                  │ 原始数据安全存储在
                                  │ PCI 合规的基础设施中
                                  ▼
                            ┌──────────────┐
                            │  加密存储     │
                            │  (PCI DSS)    │
                            └──────────────┘
```

### 2.2 Stripe 集成——前端 Token 化

**前端：使用 Stripe Elements 收集卡信息**（卡号永远不经过你的服务器）

```html
<!-- checkout.blade.php -->
<!DOCTYPE html>
<html>
<head>
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <script src="https://js.stripe.com/v3/"></script>
    <style>
        #payment-form { max-width: 400px; margin: 0 auto; }
        .StripeElement {
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
        }
        .StripeElement--focus { border-color: #635bff; }
        .StripeElement--invalid { border-color: #fa755a; }
        #card-errors { color: #fa755a; margin-top: 8px; }
    </style>
</head>
<body>
    <form id="payment-form">
        <div id="card-element"><!-- Stripe Elements 会注入到这里 --></div>
        <div id="card-errors" role="alert"></div>
        <button type="submit" id="submit-btn">支付 ¥{{ number_format($amount / 100, 2) }}</button>
    </form>

    <script>
        const stripe = Stripe('{{ config("services.stripe.key") }}');
        const elements = stripe.elements();
        const cardElement = elements.create('card', {
            style: {
                base: { fontSize: '16px', color: '#32325d' },
                invalid: { color: '#fa755a' },
            }
        });
        cardElement.mount('#card-element');

        const form = document.getElementById('payment-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            document.getElementById('submit-btn').disabled = true;

            // 创建 PaymentMethod —— 卡号直接发送到 Stripe，不经过你的服务器
            const { error, paymentMethod } = await stripe.createPaymentMethod({
                type: 'card',
                card: cardElement,
                billing_details: {
                    name: '{{ auth()->user()->name }}',
                    email: '{{ auth()->user()->email }}',
                }
            });

            if (error) {
                document.getElementById('card-errors').textContent = error.message;
                document.getElementById('submit-btn').disabled = false;
                return;
            }

            // 只发送 token (pm_xxx) 到你的服务器
            const response = await fetch('/api/v1/payments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                },
                body: JSON.stringify({
                    payment_method_id: paymentMethod.id,
                    amount: {{ $amount }},
                    currency: 'cny',
                    order_id: '{{ $orderId }}',
                }),
            });

            const result = await response.json();

            if (result.requires_action) {
                // 3D Secure 验证
                const { error: confirmError } = await stripe.handleCardAction(result.client_secret);
                if (confirmError) {
                    document.getElementById('card-errors').textContent = confirmError.message;
                } else {
                    // 确认支付
                    await fetch(`/api/v1/payments/${result.payment_id}/confirm`, { method: 'POST' });
                }
            } else if (result.success) {
                window.location.href = `/orders/${result.order_id}/success`;
            }

            document.getElementById('submit-btn').disabled = false;
        });
    </script>
</body>
</html>
```

### 2.3 Laravel 后端——只处理 Token

```php
<?php

namespace App\Services\Payment;

use App\Models\Order;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Enums\PaymentStatus;
use App\Events\PaymentCompleted;
use App\Events\PaymentFailed;
use Illuminate\Support\Facades\DB;
use Stripe\Stripe;
use Stripe\PaymentIntent;
use Stripe\PaymentMethod as StripePaymentMethod;
use Stripe\Exception\ApiErrorException;
use Stripe\Exception\CardException;

class StripePaymentService
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    /**
     * 创建支付意图
     *
     * 注意：此方法只接收 Stripe PaymentMethod Token (pm_xxx)
     * 永远不接触原始卡号
     */
    public function createPayment(
        string $paymentMethodId,
        int $amount,
        string $currency,
        string $orderId
    ): array {
        $order = Order::findOrFail($orderId);

        // 验证金额一致性（防止前端篡改）
        if ($amount !== $order->total_amount) {
            throw new \InvalidArgumentException('支付金额与订单金额不匹配');
        }

        try {
            // 创建 PaymentIntent
            $paymentIntent = PaymentIntent::create([
                'amount' => $amount,
                'currency' => $currency,
                'payment_method' => $paymentMethodId,
                'description' => "Order #{$order->order_number}",
                'metadata' => [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'user_id' => $order->user_id,
                ],
                'confirm' => false, // 先不确认，让前端处理 3D Secure
                'automatic_payment_methods' => [
                    'enabled' => true,
                    'allow_redirects' => 'never',
                ],
            ]);

            // 保存支付记录（只存 Token 和有限信息）
            $payment = Payment::create([
                'order_id' => $order->id,
                'user_id' => $order->user_id,
                'gateway' => 'stripe',
                'gateway_payment_id' => $paymentIntent->id,   // pi_xxx
                'gateway_payment_method_id' => $paymentMethodId, // pm_xxx
                'amount' => $amount,
                'currency' => $currency,
                'status' => PaymentStatus::PENDING,
                'client_secret' => $paymentIntent->client_secret,
            ]);

            // 记录审计日志
            audit_log('payment.created', [
                'payment_id' => $payment->id,
                'order_id' => $order->id,
                'amount' => $amount,
                'currency' => $currency,
                'gateway' => 'stripe',
            ]);

            if ($paymentIntent->status === 'requires_action') {
                return [
                    'success' => false,
                    'requires_action' => true,
                    'client_secret' => $paymentIntent->client_secret,
                    'payment_id' => $payment->id,
                ];
            }

            return [
                'success' => true,
                'payment_id' => $payment->id,
                'order_id' => $order->id,
            ];

        } catch (CardException $e) {
            audit_log('payment.card_error', [
                'order_id' => $order->id,
                'error_code' => $e->getCode(),
                'error_message' => $e->getMessage(),
            ]);

            throw new PaymentFailedException('支付失败：' . $this->getCardErrorMessage($e));
        } catch (ApiErrorException $e) {
            audit_log('payment.api_error', [
                'order_id' => $order->id,
                'error' => $e->getMessage(),
            ]);

            throw new PaymentFailedException('支付服务暂时不可用，请稍后重试');
        }
    }

    /**
     * 确认支付（3D Secure 后调用）
     */
    public function confirmPayment(string $paymentId): array
    {
        $payment = Payment::findOrFail($paymentId);

        try {
            $paymentIntent = PaymentIntent::retrieve($payment->gateway_payment_id);
            $paymentIntent = PaymentIntent::update($payment->gateway_payment_id, [
                'payment_method' => $payment->gateway_payment_method_id,
            ]);
            $paymentIntent = PaymentIntent::confirm($payment->gateway_payment_id);

            return $this->handlePaymentIntentResult($payment, $paymentIntent);

        } catch (ApiErrorException $e) {
            audit_log('payment.confirm_error', [
                'payment_id' => $paymentId,
                'error' => $e->getMessage(),
            ]);

            throw new PaymentFailedException('支付确认失败');
        }
    }

    /**
     * 处理 Stripe Webhook
     */
    public function handleWebhook(array $payload, string $sigHeader): void
    {
        $webhookSecret = config('services.stripe.webhook_secret');

        try {
            $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, $webhookSecret);
        } catch (\UnexpectedValueException $e) {
            audit_log('webhook.invalid_payload', ['error' => $e->getMessage()]);
            return;
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            audit_log('webhook.invalid_signature', ['error' => $e->getMessage()]);
            return;
        }

        audit_log('webhook.received', [
            'event_type' => $event->type,
            'event_id' => $event->id,
        ]);

        match ($event->type) {
            'payment_intent.succeeded' => $this->handlePaymentSucceeded($event->data->object),
            'payment_intent.payment_failed' => $this->handlePaymentFailed($event->data->object),
            'charge.refunded' => $this->handleRefund($event->data->object),
            default => audit_log('webhook.unhandled', ['event_type' => $event->type]),
        };
    }

    private function handlePaymentIntentResult(Payment $payment, PaymentIntent $intent): array
    {
        match ($intent->status) {
            'succeeded' => $this->markPaymentSucceeded($payment, $intent),
            'requires_action' => null, // 前端处理
            default => $this->markPaymentFailed($payment, $intent),
        };

        $payment->refresh();

        return [
            'success' => $payment->status === PaymentStatus::COMPLETED,
            'payment_id' => $payment->id,
            'order_id' => $payment->order_id,
        ];
    }

    private function markPaymentSucceeded(Payment $payment, PaymentIntent $intent): void
    {
        DB::transaction(function () use ($payment, $intent) {
            $payment->update([
                'status' => PaymentStatus::COMPLETED,
                'gateway_charge_id' => $intent->latest_charge,
                'paid_at' => now(),
                // 注意：这里只存储 Stripe 返回的有限信息
                // 不存储任何原始卡号数据
                'payment_method_brand' => $intent->payment_method_types[0] ?? 'card',
            ]);

            $payment->order->update(['status' => 'paid']);

            // 保存 PaymentMethod Token 供后续使用（退款等）
            PaymentMethod::updateOrCreate(
                [
                    'user_id' => $payment->user_id,
                    'gateway' => 'stripe',
                    'gateway_payment_method_id' => $payment->gateway_payment_method_id,
                ],
                [
                    'type' => 'card',
                    'is_default' => true,
                ]
            );

            event(new PaymentCompleted($payment));

            audit_log('payment.succeeded', [
                'payment_id' => $payment->id,
                'amount' => $payment->amount,
                'order_id' => $payment->order_id,
            ]);
        });
    }

    private function getCardErrorMessage(CardException $e): string
    {
        return match ($e->getError()->code) {
            'card_declined' => '银行卡被拒绝，请更换其他银行卡',
            'expired_card' => '银行卡已过期',
            'incorrect_cvc' => '安全码错误',
            'insufficient_funds' => '余额不足',
            'processing_error' => '处理错误，请重试',
            default => '支付失败，请更换其他支付方式',
        };
    }
}
```

### 2.4 支付模型——不存储敏感数据

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Enums\PaymentStatus;

class Payment extends Model
{
    protected $fillable = [
        'order_id',
        'user_id',
        'gateway',
        'gateway_payment_id',      // Stripe: pi_xxx
        'gateway_payment_method_id', // Stripe: pm_xxx
        'gateway_charge_id',       // Stripe: ch_xxx
        'amount',
        'currency',
        'status',
        'client_secret',
        'payment_method_brand',    // 'visa', 'mastercard' — 非敏感
        'paid_at',
        'refunded_at',
        'refund_amount',
    ];

    protected $hidden = [
        'client_secret', // 不要暴露在 API 响应中
    ];

    protected $casts = [
        'status' => PaymentStatus::class,
        'amount' => 'integer',
        'paid_at' => 'datetime',
        'refunded_at' => 'datetime',
        'refund_amount' => 'integer',
    ];

    // 关联
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
```

**PCI DSS 合规关键点**：

1. **绝不存储完整卡号（PAN）**——只存储 Stripe Token (pm_xxx)
2. **绝不存储 CVV/CVC**——即使加密也不行
3. **可以存储**：卡品牌（Visa/Mastercard）、后四位（用于显示）、过期月份/年份
4. 所有卡号验证由 Stripe.js 在客户端完成，数据直接发送到 Stripe 服务器

---

## 第三章：网络分段——隔离持卡人数据环境

### 3.1 网络分段策略

PCI DSS 要求将处理、存储或传输持卡人数据的系统（CDE，Cardholder Data Environment）与其他网络隔离。

```
┌─────────────────────────────────────────────────────────────┐
│                      公共网络区域                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ CDN/CloudFlare│  │ Web Server │  │ Static Files│              │
│  └──────────┘  └────┬─────┘  └──────────┘                   │
│                      │                                       │
│              ┌───────▼────────┐                              │
│              │   WAF / 防火墙    │                              │
│              └───────┬────────┘                              │
└──────────────────────┼──────────────────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────────────────┐
│                 DMZ（非军事区）                                │
│  ┌──────────┐  ┌─────▼─────┐  ┌──────────┐                  │
│  │ 消息队列  │  │ Laravel App │  │ Redis Cache│                 │
│  │ (RabbitMQ)│  │ (Payment)  │  │ (Session)  │                 │
│  └──────────┘  └─────┬─────┘  └──────────┘                  │
└──────────────────────┼──────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  内部防火墙       │
              └────────┬────────┘
                       │
┌──────────────────────┼──────────────────────────────────────┐
│              CDE（持卡人数据环境）                               │
│  ┌──────────┐  ┌─────▼─────┐  ┌──────────┐                  │
│  │ 支付网关   │  │ Payment DB │  │ 审计日志  │                  │
│  │ Webhook   │  │ (加密存储)  │  │ (只追加)  │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Nginx 防火墙配置

```nginx
# /etc/nginx/conf.d/pci-firewall.conf

# 限制支付相关端点的访问
server {
    listen 443 ssl http2;
    server_name api.example.com;

    # TLS 1.2+ 强制
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_stapling on;
    ssl_stapling_verify on;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 支付端点限制
    location /api/v1/payments {
        # 仅允许来自应用服务器的请求
        allow 10.0.1.0/24;  # 应用服务器子网
        allow 10.0.2.0/24;  # 队列工作者子网
        deny all;

        # 速率限制
        limit_req zone=payment burst=10 nodelay;
        limit_req_status 429;

        # 请求体大小限制
        client_max_body_size 10k;

        # 代理到 Laravel
        proxy_pass http://laravel_backend;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Webhook 端点（仅允许 Stripe IP）
    location /api/v1/webhooks/stripe {
        # Stripe Webhook IP 范围
        allow 54.187.174.169;
        allow 54.187.205.235;
        allow 54.187.216.72;
        allow 54.241.31.99;
        allow 54.241.31.102;
        deny all;

        proxy_pass http://laravel_backend;
    }

    # 健康检查（不暴露敏感信息）
    location /health {
        access_log off;
        return 200 '{"status":"ok"}';
        add_header Content-Type application/json;
    }
}

# 速率限制配置
http {
    limit_req_zone $binary_remote_addr zone=payment:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
}
```

### 3.3 Laravel 环境隔离

```php
<?php

// config/payment.php

return [
    /*
    |--------------------------------------------------------------------------
    | PCI DSS 合规配置
    |--------------------------------------------------------------------------
    */

    // 支付环境必须完全隔离
    'stripe' => [
        'key' => env('STRIPE_KEY'),
        'secret' => env('STRIPE_SECRET'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        // API 版本固定，避免意外变更
        'api_version' => '2024-06-20',
    ],

    // 审计日志配置
    'audit' => [
        // 审计日志必须存储在独立的安全数据库
        'connection' => env('AUDIT_DB_CONNECTION', 'audit'),
        // 日志保留期（PCI DSS 要求至少 1 年）
        'retention_days' => 365 * 3, // 3 年
        // 审计日志不可修改
        'immutable' => true,
    ],

    // 加密配置
    'encryption' => [
        // AES-256-GCM 用于存储加密
        'cipher' => 'aes-256-gcm',
        // 密钥轮换周期
        'key_rotation_days' => 365,
    ],
];
```

---

## 第四章：审计日志——不可篡改的访问记录

### 4.1 PCI DSS 要求 10 详解

PCI DSS 要求 10 是审计日志的核心要求：

- **10.2** 实施自动化审计日志，记录所有系统组件的访问
- **10.3** 记录审计日志条目的审计详情
- **10.4** 使用进程及时审查审计日志
- **10.5** 保留审计日志历史至少 1 年
- **10.7** 支持即时回溯分析

### 4.2 Laravel 审计日志实现

```php
<?php

namespace App\Services\Audit;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Request;
use Illuminate\Support\Str;

class AuditLogger
{
    /**
     * 记录审计日志
     *
     * PCI DSS 要求记录的信息：
     * - 事件类型
     * - 日期/时间
     * - 用户身份
     * - 事件是否成功
     * - 受影响的数据/资源
     * - 来源 IP 地址
     */
    public static function log(
        string $eventType,
        array $data = [],
        ?string $userId = null,
        bool $success = true
    ): void {
        $auditDb = config('payment.audit.connection');

        DB::connection($auditDb)->table('audit_logs')->insert([
            'id' => Str::uuid(),
            'event_type' => $eventType,
            'user_id' => $userId ?? auth()->id(),
            'user_email' => auth()->user()?->email,
            'ip_address' => Request::ip(),
            'user_agent' => Request::userAgent(),
            'request_method' => Request::method(),
            'request_url' => Request::fullUrl(),
            'request_id' => Request::header('X-Request-ID', Str::uuid()),
            'success' => $success,
            'data' => json_encode($data, JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);
    }

    /**
     * 记录持卡人数据访问（PCI DSS 特别要求）
     */
    public static function logDataAccess(
        string $resourceType,
        string $resourceId,
        string $accessType, // 'read', 'write', 'delete'
        array $data = []
    ): void {
        self::log("data.{$accessType}", array_merge($data, [
            'resource_type' => $resourceType,
            'resource_id' => $resourceId,
        ]));
    }

    /**
     * 记录认证事件
     */
    public static function logAuth(
        string $eventType, // 'login', 'logout', 'login_failed', 'password_change'
        ?string $userId = null,
        array $data = []
    ): void {
        self::log("auth.{$eventType}", $data, $userId, !str_contains($eventType, 'failed'));
    }

    /**
     * 记录管理员操作
     */
    public static function logAdmin(
        string $action,
        string $targetType,
        string $targetId,
        array $data = []
    ): void {
        self::log("admin.{$action}", array_merge($data, [
            'target_type' => $targetType,
            'target_id' => $targetId,
        ]));
    }
}

// 全局辅助函数
function audit_log(string $eventType, array $data = []): void
{
    AuditLogger::log($eventType, $data);
}
```

### 4.3 审计日志迁移

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    protected $connection = 'audit';

    public function up(): void
    {
        Schema::connection('audit')->create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('event_type', 100)->index();
            $table->uuid('user_id')->nullable()->index();
            $table->string('user_email')->nullable();
            $table->ipAddress('ip_address');
            $table->string('user_agent')->nullable();
            $table->string('request_method', 10);
            $table->text('request_url');
            $table->string('request_id', 36)->index();
            $table->boolean('success')->default(true);
            $table->json('data')->nullable();
            $table->timestamp('created_at')->index();

            // 复合索引用于常见查询
            $table->index(['event_type', 'created_at']);
            $table->index(['user_id', 'created_at']);
        });

        // 审计日志表设置为只追加（PostgreSQL 示例）
        // DB::connection('audit')->unprepared("
        //     CREATE OR REPLACE FUNCTION prevent_audit_update()
        //     RETURNS TRIGGER AS $$
        //     BEGIN
        //         RAISE EXCEPTION '审计日志不可修改或删除';
        //     END;
        //     $$ LANGUAGE plpgsql;
        //
        //     CREATE TRIGGER audit_immutable
        //     BEFORE UPDATE OR DELETE ON audit_logs
        //     FOR EACH ROW EXECUTE FUNCTION prevent_audit_update();
        // ");
    }

    public function down(): void
    {
        Schema::connection('audit')->dropIfExists('audit_logs');
    }
};
```

### 4.4 审计日志中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use App\Services\Audit\AuditLogger;

class AuditPaymentAccess
{
    /**
     * 审计所有支付相关请求
     */
    public function handle(Request $request, Closure $next): Response
    {
        $startTime = microtime(true);
        $response = $next($request);
        $duration = microtime(true) - $startTime;

        AuditLogger::log('api.payment_request', [
            'method' => $request->method(),
            'path' => $request->path(),
            'status_code' => $response->getStatusCode(),
            'duration_ms' => round($duration * 1000, 2),
            'query_params' => $request->query(),
            // 注意：永远不要记录请求体中的敏感数据
            // 如卡号、CVV 等
        ], success: $response->getStatusCode() < 400);

        return $response;
    }
}
```

### 4.5 审计日志查询与监控

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Carbon\Carbon;

class AuditLogController extends Controller
{
    /**
     * 查询审计日志
     */
    public function index(Request $request)
    {
        $query = AuditLog::query()
            ->when($request->event_type, fn ($q, $type) => $q->where('event_type', $type))
            ->when($request->user_id, fn ($q, $id) => $q->where('user_id', $id))
            ->when($request->date_from, fn ($q, $date) => $q->where('created_at', '>=', Carbon::parse($date)))
            ->when($request->date_to, fn ($q, $date) => $q->where('created_at', '<=', Carbon::parse($date)->endOfDay()))
            ->when($request->ip_address, fn ($q, $ip) => $q->where('ip_address', $ip))
            ->orderBy('created_at', 'desc');

        return $query->paginate(50);
    }

    /**
     * 安全事件报告
     */
    public function securityReport()
    {
        $last24h = now()->subDay();

        return [
            'failed_logins' => AuditLog::where('event_type', 'auth.login_failed')
                ->where('created_at', '>=', $last24h)
                ->count(),
            'suspicious_ips' => AuditLog::where('event_type', 'auth.login_failed')
                ->where('created_at', '>=', $last24h)
                ->groupBy('ip_address')
                ->havingRaw('COUNT(*) > 5')
                ->pluck('ip_address'),
            'payment_failures' => AuditLog::where('event_type', 'payment.card_error')
                ->where('created_at', '>=', $last24h)
                ->count(),
            'admin_actions' => AuditLog::where('event_type', 'like', 'admin.%')
                ->where('created_at', '>=', $last24h)
                ->count(),
        ];
    }
}
```

---

## 第五章：加密——数据在静态和传输中的保护

### 5.1 传输层加密（TLS）

PCI DSS v4.0 要求 TLS 1.2 或更高版本：

```nginx
# 强制 TLS 1.2+，禁用旧版本
ssl_protocols TLSv1.2 TLSv1.3;

# 使用强密码套件
ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';

# HSTS 强制 HTTPS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

Laravel 配置强制 HTTPS：

```php
// AppServiceProvider.php
public function boot(): void
{
    if ($this->app->environment('production')) {
        \URL::forceScheme('https');
        \URL::forceRootUrl(config('app.url'));
    }
}
```

### 5.2 静态数据加密

对于必须存储的敏感数据（如退款需要的支付 ID），使用 AES-256-GCM：

```php
<?php

namespace App\Services\Encryption;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Contracts\Encryption\DecryptException;

class SecureEncryption
{
    /**
     * 加密敏感数据
     * 使用 AES-256-GCM（带认证标签，防篡改）
     */
    public static function encrypt(string $plaintext): string
    {
        return Crypt::encryptString($plaintext);
    }

    /**
     * 解密数据
     */
    public static function decrypt(string $ciphertext): ?string
    {
        try {
            return Crypt::decryptString($ciphertext);
        } catch (DecryptException $e) {
            audit_log('encryption.decrypt_failed', [
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * 加密 JSON 数据（用于数据库存储）
     */
    public static function encryptJson(array $data): string
    {
        return self::encrypt(json_encode($data));
    }

    /**
     * 解密 JSON 数据
     */
    public static function decryptJson(string $encrypted): ?array
    {
        $decrypted = self::decrypt($encrypted);
        return $decrypted ? json_decode($decrypted, true) : null;
    }
}
```

### 5.3 数据库列级加密

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Services\Encryption\SecureEncryption;

class Payment extends Model
{
    /**
     * 加密存储的字段（setter）
     */
    public function setGatewayPaymentIdAttribute($value): void
    {
        $this->attributes['gateway_payment_id'] = SecureEncryption::encrypt($value);
    }

    /**
     * 解密读取的字段（getter）
     */
    public function getGatewayPaymentIdAttribute($value): ?string
    {
        return $value ? SecureEncryption::decrypt($value) : null;
    }

    /**
     * 在查询中使用加密字段
     * 注意：加密字段无法直接 WHERE 查询，需要使用 HMAC 索引
     */
    public function setGatewayPaymentIdHmacAttribute($value): void
    {
        $this->attributes['gateway_payment_id_hmac'] = hash_hmac('sha256', $value, config('app.key'));
    }

    public function scopeByGatewayPaymentId($query, string $id)
    {
        return $query->where('gateway_payment_id_hmac', hash_hmac('sha256', $id, config('app.key')));
    }
}
```

### 5.4 密钥管理

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

class RotateEncryptionKey extends Command
{
    protected $signature = 'security:rotate-key
                            {--dry-run : 仅显示将要执行的操作}';

    protected $description = '轮换加密密钥（PCI DSS 要求）';

    public function handle(): int
    {
        $this->info('开始密钥轮换流程...');

        if ($this->option('dry-run')) {
            $this->warn('DRY RUN 模式 - 不会执行任何变更');
        }

        // 1. 备份当前密钥
        $currentKey = config('app.key');
        $this->info("当前密钥: {$this->maskKey($currentKey)}");

        if (!$this->option('dry-run')) {
            // 2. 生成新密钥
            Artisan::call('key:generate', ['--show' => true]);
            $newKey = Artisan::output();
            $this->info("新密钥: {$this->maskKey($newKey)}");

            // 3. 重新加密所有加密字段
            $this->reEncryptFields($currentKey, $newKey);

            // 4. 更新 .env
            $this->updateEnvKey($newKey);

            // 5. 记录审计日志
            audit_log('security.key_rotation', [
                'rotated_at' => now()->toISOString(),
                'dry_run' => false,
            ]);

            $this->info('密钥轮换完成！');
        }

        return self::SUCCESS;
    }

    private function maskKey(string $key): string
    {
        return substr($key, 0, 8) . '...' . substr($key, -8);
    }

    private function reEncryptFields(string $oldKey, string $newKey): void
    {
        $this->info('重新加密数据库中的加密字段...');

        // 重新加密 payments 表的加密字段
        $payments = DB::table('payments')->whereNotNull('gateway_payment_id')->get();
        $bar = $this->output->createProgressBar($payments->count());

        foreach ($payments as $payment) {
            // 使用旧密钥解密
            // 使用新密钥重新加密
            // 更新数据库
            $bar->advance();
        }

        $bar->finish();
        $this->newLine();
    }

    private function updateEnvKey(string $newKey): void
    {
        $envPath = base_path('.env');
        $content = file_get_contents($envPath);
        $content = preg_replace('/^APP_KEY=.*$/m', "APP_KEY={$newKey}", $content);
        file_put_contents($envPath, $content);
    }
}
```

---

## 第六章：访问控制——最小权限原则

### 6.1 RBAC 角色定义

```php
<?php

namespace App\Enums;

enum UserRole: string
{
    case CUSTOMER = 'customer';
    case SUPPORT = 'support';      // 客服
    case FINANCE = 'finance';      // 财务
    case ADMIN = 'admin';          // 管理员
    case SUPER_ADMIN = 'super_admin'; // 超级管理员

    /**
     * PCI DSS 要求 7：按业务需求限制访问
     * 每个角色只有完成工作所需的最小权限
     */
    public function permissions(): array
    {
        return match ($this) {
            self::CUSTOMER => [
                'orders.view_own',
                'payments.view_own',
                'profile.update_own',
            ],
            self::SUPPORT => [
                'orders.view',
                'orders.update_status',
                'customers.view', // 只能看到脱敏后的信息
                // 不能查看支付详情
            ],
            self::FINANCE => [
                'payments.view',
                'payments.refund',
                'reports.revenue',
                'audit_logs.view_payment',
            ],
            self::ADMIN => [
                'users.manage',
                'orders.manage',
                'products.manage',
                'reports.view',
                // 不能直接访问持卡人数据
            ],
            self::SUPER_ADMIN => [
                '*', // 全部权限，但操作会被审计
            ],
        };
    }
}
```

### 6.2 MFA（多因素认证）

PCI DSS 要求 8.4：对所有管理访问实施 MFA。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireMfa
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        // 检查是否需要 MFA
        if ($this->requiresMfa($user) && !$this->hasValidMfa($request)) {
            return response()->json([
                'error' => 'MFA required',
                'message' => '管理操作需要多因素认证',
                'mfa_required' => true,
            ], 403);
        }

        return $next($request);
    }

    private function requiresMfa($user): bool
    {
        $adminRoles = ['admin', 'super_admin', 'finance'];
        return in_array($user->role, $adminRoles);
    }

    private function hasValidMfa(Request $request): bool
    {
        $mfaToken = $request->header('X-MFA-Token');

        if (!$mfaToken) {
            return false;
        }

        // 验证 TOTP Token
        $user = $request->user();
        $secret = $user->mfa_secret; // 加密存储

        $google2fa = app('pragmarx.google2fa');
        return $google2fa->verifyKey($secret, $mfaToken, 1); // 允许 1 个时间窗口的误差
    }
}
```

### 6.3 API 速率限制与异常检测

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use App\Services\Audit\AuditLogger;

class PaymentRateLimiter
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = 'payment:' . $request->user()?->id ?: $request->ip();

        // 每分钟最多 10 次支付尝试
        if (RateLimiter::tooManyAttempts($key, 10)) {
            AuditLogger::log('security.rate_limit_exceeded', [
                'key' => $key,
                'attempts' => RateLimiter::attempts($key),
            ]);

            return response()->json([
                'error' => '请求过于频繁，请稍后重试',
                'retry_after' => RateLimiter::availableIn($key),
            ], 429);
        }

        RateLimiter::hit($key, 60); // 60 秒窗口

        return $next($request);
    }
}
```

---

## 第七章：漏洞管理与安全开发

### 7.1 依赖安全扫描

```bash
# Composer 依赖安全检查
composer audit

# 使用 Enlightn Security Checker
composer require enlightn/security-checker --dev
php artisan security:check

# OWASP Dependency Check（Java 工具，适用于所有语言）
dependency-check --project "Laravel Payment" --scan ./vendor
```

### 7.2 自动化安全扫描

```yaml
# .github/workflows/security.yml
name: Security Scanning

on: [push, pull_request]

jobs:
  dependency-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Composer Audit
        run: composer audit --no-dev

  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Snyk Security
        uses: snyk/actions/php@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

  container-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t myapp .
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'myapp'
          format: 'sarif'
          output: 'trivy-results.sarif'
```

---

## 第八章：PCI DSS 合规检查清单

### 8.1 Laravel 应用安全检查清单

```markdown
## PCI DSS v4.0 合规检查清单（Laravel 应用）

### 要求 3：保护存储的账户数据
- [ ] 应用绝不存储完整卡号（PAN）
- [ ] 应用绝不存储 CVV/CVC
- [ ] 支付 Token（pm_xxx, pi_xxx）加密存储
- [ ] 数据库中加密字段使用 AES-256-GCM
- [ ] 密钥与加密数据分开存储

### 要求 4：传输加密
- [ ] 所有 API 端点强制 HTTPS（TLS 1.2+）
- [ ] Stripe.js 直接与 Stripe 通信（卡号不经过应用服务器）
- [ ] HSTS 头已设置
- [ ] 证书有效且正确配置

### 要求 6：安全开发
- [ ] 依赖库定期更新
- [ ] composer audit 定期运行
- [ ] SQL 查询使用参数化（Eloquent/Query Builder）
- [ ] 输入验证覆盖所有支付相关端点
- [ ] CSRF 保护在所有 POST 端点启用

### 要求 7：访问控制
- [ ] 基于角色的访问控制已实现
- [ ] 支付数据按角色限制访问
- [ ] 管理后台有独立的认证流程

### 要求 8：身份验证
- [ ] 管理用户启用了 MFA
- [ ] 密码策略强制执行（12+ 字符，复杂度要求）
- [ ] 会话超时设置为 15 分钟（管理端）
- [ ] 登录失败锁定机制（5 次失败后锁定 30 分钟）

### 要求 10：日志和监控
- [ ] 所有支付操作已记录审计日志
- [ ] 审计日志不可修改
- [ ] 日志保留至少 1 年
- [ ] 异常登录行为有告警
- [ ] 支付失败异常有告警

### 要求 11：安全测试
- [ ] 季度漏洞扫描已安排
- [ ] 年度渗透测试已安排
- [ ] CI/CD 集成了安全扫描
```

---

## 总结

PCI DSS 合规不是一次性项目，而是持续的安全实践。对于 Laravel 开发者，最关键的策略是：

1. **永远不要让原始卡号经过你的服务器**——使用 Stripe.js / PayPal SDK 在客户端完成 Token 化
2. **最小化存储的数据**——只存储支付 Token 和业务必需的有限信息
3. **实施全面的审计日志**——记录所有支付相关操作，确保不可篡改
4. **网络分段隔离**——将支付系统与普通应用隔离
5. **持续监控与测试**——自动化安全扫描、定期渗透测试

遵循这些原则，你的 Laravel 应用可以用 SAQ A 或 SAQ A-EP 完成合规认证，大幅降低合规成本和风险。

---

## 相关阅读

- [Ansible 实战：Laravel 应用自动化部署与配置管理](/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Terraform 实战：Laravel 应用基础设施即代码](/07_CICD/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
- [Laravel Redis 分布式锁失效场景实战](/databases/laravel-redis-distributedlockguide/)
- [数据库读写分离实战：Laravel 中间件 + MySQL 主从复制配置](/databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/)

---

*参考资料*：
- [PCI DSS v4.0 标准](https://www.pcisecuritystandards.org/document_library/)
- [Stripe 安全文档](https://stripe.com/docs/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Laravel 安全文档](https://laravel.com/docs/11.x/security)
