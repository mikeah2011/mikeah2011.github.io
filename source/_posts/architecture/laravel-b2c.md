---
title: 订单退款系统架构设计：多通道退款、部分退款、退款状态机、财务对账——Laravel B2C 的退款引擎设计
date: 2026-06-09 22:58:00
categories:
  - architecture
keywords: [Laravel B2C, 订单退款系统架构设计, 多通道退款, 部分退款, 退款状态机, 财务对账, 的退款引擎设计, 架构]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - 退款
  - 状态机
  - 支付网关
  - Laravel
  - 财务对账
  - 多通道退款
description: 深入解析 B2C 场景下退款系统的完整架构设计，涵盖退款状态机、多通道退款适配、部分退款拆单、财务对账引擎，以及 Laravel 实战代码与踩坑记录。
---

## 概述

退款是电商系统中最复杂的业务流程之一。相比支付的"一条路走通"，退款面临的是：多支付渠道的逆向适配、部分退款的金额拆分、状态流转的幂等保障、财务对账的借贷平衡。任何一个环节出错，轻则用户投诉，重则资金损失。

本文基于 KKday B2C 项目的真实退款模块，从架构设计到 Laravel 代码实现，完整拆解一个生产级退款引擎的核心逻辑。

## 核心概念

### 退款的业务模型

退款不是"把钱退回去"这么简单。一个成熟的退款系统需要回答以下问题：

- **退多少？** 全额退款 vs 部分退款
- **退到哪？** 原路退回 vs 退到余额 vs 线下退款
- **退给谁？** 用户主动退款 vs 商家主动退款 vs 系统自动退款
- **退几次？** 同一笔订单可能分多次退款（如分批退回酒店订单的多个房间）
- **退多久？** 不同渠道的退款时效不同，跨境退款可能需要 7-15 个工作日

### 退款状态机

退款状态机是整个系统的骨架。设计不当会导致状态悬挂、重复退款、对账不平。

```
┌─────────────┐
│   PENDING    │  ← 用户发起退款申请
└──────┬──────┘
       │ 人工审核 / 自动审核
       ▼
┌─────────────┐
│  APPROVED    │  ← 审核通过，等待执行
└──────┬──────┘
       │ 调用支付渠道退款 API
       ▼
┌─────────────┐     ┌─────────────┐
│  PROCESSING  │────▶│  REFUNDING   │  ← 渠道已受理，等待回调
└──────┬──────┘     └──────┬──────┘
       │                    │
       │                    ▼
       │              ┌─────────────┐
       │              │   SUCCESS    │  ← 渠道确认退款成功
       │              └──────┬──────┘
       │                     │
       │                     ▼
       │              ┌─────────────┐
       │              │ SETTLED      │  ← 财务对账完成
       │              └─────────────┘
       │
       ▼ (任何异常)
┌─────────────┐
│   FAILED     │  ← 渠道拒绝 / 系统异常
└──────┬──────┘
       │ 重试 or 人工处理
       ▼
┌─────────────┐
│  REJECTED    │  ← 终态，退款被拒绝
└─────────────┘
```

**关键设计原则：**

1. **单向流转**：退款一旦进入 SUCCESS，不可回退到 PROCESSING
2. **幂等设计**：同一退款请求重复调用渠道 API，结果一致
3. **超时兜底**：PROCESSING 状态超过 72 小时自动触发查询接口
4. **审计日志**：每次状态变更记录操作人、时间、原因

### 多通道退款适配

B2C 系统对接多种支付渠道，每种渠道的退款 API 完全不同：

| 渠道 | 退款接口 | 时效 | 特点 |
|------|---------|------|------|
| 支付宝 | `alipay.trade.refund` | T+1 | 部分退款需传 `refund_amount` |
| 微信支付 | `/secapi/pay/refund` | T+1~T+3 | 需要双向证书 |
| Stripe | `POST /v1/refunds` | 5-10 工作日 | 支持 partial refund |
| 信用卡退单 | 银行渠道 | 30-90 天 | 需要人工介入 |

## 实战代码

### 1. 退款模型与状态机

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Refund extends Model
{
    protected $fillable = [
        'order_id',
        'refund_no',
        'channel',
        'total_amount',
        'refund_amount',
        'currency',
        'status',
        'reason',
        'channel_refund_id',
        'metadata',
        'settled_at',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'refund_amount' => 'decimal:2',
        'metadata' => 'json',
        'settled_at' => 'datetime',
    ];

    // 状态常量
    const STATUS_PENDING    = 'pending';
    const STATUS_APPROVED   = 'approved';
    const STATUS_PROCESSING = 'processing';
    const STATUS_REFUNDING  = 'refunding';
    const STATUS_SUCCESS    = 'success';
    const STATUS_SETTLED    = 'settled';
    const STATUS_FAILED     = 'failed';
    const STATUS_REJECTED   = 'rejected';

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * 获取该订单已退款总额
     */
    public static function refundedTotal(int $orderId): float
    {
        return (float) self::where('order_id', $orderId)
            ->whereIn('status', [self::STATUS_SUCCESS, self::STATUS_SETTLED])
            ->sum('refund_amount');
    }

    /**
     * 计算可退金额 = 订单实付 - 已退金额
     */
    public static function refundableAmount(int $orderId): float
    {
        $order = Order::find($orderId);
        $refunded = self::refundedTotal($orderId);
        return round($order->paid_amount - $refunded, 2);
    }

    /**
     * 状态流转校验
     */
    public static array $transitions = [
        self::STATUS_PENDING    => [self::STATUS_APPROVED, self::STATUS_REJECTED],
        self::STATUS_APPROVED   => [self::STATUS_PROCESSING, self::STATUS_REJECTED],
        self::STATUS_PROCESSING => [self::STATUS_REFUNDING, self::STATUS_SUCCESS, self::STATUS_FAILED],
        self::STATUS_REFUNDING  => [self::STATUS_SUCCESS, self::STATUS_FAILED],
        self::STATUS_SUCCESS    => [self::STATUS_SETTLED],
        self::STATUS_FAILED     => [self::STATUS_PROCESSING], // 重试
    ];

    public function canTransitionTo(string $targetStatus): bool
    {
        return in_array($targetStatus, self::$transitions[$this->status] ?? []);
    }
}
```

### 2. 退款状态机服务

```php
<?php

namespace App\Services\Refund;

use App\Models\Refund;
use App\Models\RefundLog;
use Illuminate\Support\Facades\DB;

class RefundStateMachine
{
    /**
     * 安全地推进退款状态
     */
    public static function transition(
        Refund $refund,
        string $targetStatus,
        ?string $operator = null,
        ?string $remark = null,
        ?array $metadata = null
    ): Refund {
        return DB::transaction(function () use ($refund, $targetStatus, $operator, $remark, $metadata) {
            // 重新从数据库读取，防止并发
            $refund->refresh();

            if (!$refund->canTransitionTo($targetStatus)) {
                throw new \DomainException(
                    "退款 {$refund->refund_no} 无法从 {$refund->status} 转到 {$targetStatus}"
                );
            }

            $oldStatus = $refund->status;

            $refund->update([
                'status' => $targetStatus,
                'metadata' => array_merge($refund->metadata ?? [], $metadata ?? []),
            ]);

            // 记录审计日志
            RefundLog::create([
                'refund_id' => $refund->id,
                'from_status' => $oldStatus,
                'to_status' => $targetStatus,
                'operator' => $operator ?? 'system',
                'remark' => $remark,
            ]);

            return $refund;
        });
    }
}
```

### 3. 多通道退款适配器

```php
<?php

namespace App\Services\Refund;

use App\Models\Refund;

interface RefundChannelInterface
{
    /**
     * 执行退款
     * @return array{success: bool, channel_refund_id: string, message: string}
     */
    public function refund(Refund $refund): array;

    /**
     * 查询退款状态
     * @return array{status: string, message: string}
     */
    public function query(Refund $refund): array;

    /**
     * 支持的渠道标识
     */
    public function channel(): string;
}
```

#### 微信支付退款适配器

```php
<?php

namespace App\Services\Refund\Channels;

use App\Models\Refund;
use App\Services\Refund\RefundChannelInterface;
use Illuminate\Support\Facades\Http;

class WechatPayRefundChannel implements RefundChannelInterface
{
    public function channel(): string
    {
        return 'wechat';
    }

    public function refund(Refund $refund): array
    {
        $order = $refund->order;

        // 微信退款需要双向 mTLS
        $response = Http::withOptions([
            'cert'    => config('services.wechat.refund_cert'),
            'ssl_key' => config('services.wechat.refund_key'),
        ])->post('https://api.mch.weixin.qq.com/secapi/pay/refund', [
            'appid'          => config('services.wechat.app_id'),
            'mch_id'         => config('services.wechat.mch_id'),
            'nonce_str'      => Str::random(32),
            'sign_type'      => 'HMAC-SHA256',
            'out_trade_no'   => $order->order_no,
            'out_refund_no'  => $refund->refund_no,
            'total_fee'      => (int) ($order->paid_amount * 100), // 分
            'refund_fee'     => (int) ($refund->refund_amount * 100),
            'refund_desc'    => $refund->reason ?? '用户申请退款',
            'notify_url'     => route('refund.wechat.notify'),
        ]);

        $body = $response->json();

        if ($body['return_code'] === 'SUCCESS' && $body['result_code'] === 'SUCCESS') {
            return [
                'success'           => true,
                'channel_refund_id' => $body['refund_id'],
                'message'           => '微信退款申请已提交',
            ];
        }

        return [
            'success'           => false,
            'channel_refund_id' => '',
            'message'           => $body['return_msg'] ?? '未知错误',
        ];
    }

    public function query(Refund $refund): array
    {
        $response = Http::post('https://api.mch.weixin.qq.com/pay/refundquery', [
            'out_refund_no' => $refund->refund_no,
            'mch_id'        => config('services.wechat.mch_id'),
            'nonce_str'     => Str::random(32),
        ]);

        $body = $response->json();
        $refundStatus = $body['refund_status'] ?? 'FAIL';

        return [
            'status'  => $this->mapStatus($refundStatus),
            'message' => $body['refund_status_desc'] ?? '',
        ];
    }

    private function mapStatus(string $wechatStatus): string
    {
        return match ($wechatStatus) {
            'SUCCESS' => Refund::STATUS_SUCCESS,
            'PROCESSING' => Refund::STATUS_REFUNDING,
            'FAIL' => Refund::STATUS_FAILED,
            'CHANGE' => Refund::STATUS_FAILED, // 退款异常，退入银行卡
            default => Refund::STATUS_FAILED,
        };
    }
}
```

#### 支付宝退款适配器

```php
<?php

namespace App\Services\Refund\Channels;

use App\Models\Refund;
use App\Services\Refund\RefundChannelInterface;
use Illuminate\Support\Facades\Http;

class AlipayRefundChannel implements RefundChannelInterface
{
    public function channel(): string
    {
        return 'alipay';
    }

    public function refund(Refund $refund): array
    {
        $order = $refund->order;

        $params = [
            'method'        => 'alipay.trade.refund',
            'app_id'        => config('services.alipay.app_id'),
            'sign_type'     => 'RSA2',
            'timestamp'     => now()->format('Y-m-d H:i:s'),
            'version'       => '1.0',
            'notify_url'    => route('refund.alipay.notify'),
            'biz_content'   => json_encode([
                'out_trade_no'   => $order->order_no,
                'refund_no'      => $refund->refund_no,
                'refund_amount'  => number_format($refund->refund_amount, 2, '.', ''),
                'refund_reason'  => $refund->reason ?? '用户申请退款',
            ]),
        ];

        // RSA2 签名（实际项目用 SDK 更方便，这里展示核心逻辑）
        $params['sign'] = $this->sign($params);

        $response = Http::asForm()->post(config('services.alipay.gateway'), $params);
        $body = json_decode($response->body(), true);
        $result = $body['alipay_trade_refund_response'] ?? [];

        if ($result['code'] === '10000') {
            return [
                'success'           => true,
                'channel_refund_id' => $result['trade_no'],
                'message'           => $result['sub_msg'] ?? '退款申请成功',
            ];
        }

        return [
            'success'           => false,
            'channel_refund_id' => '',
            'message'           => $result['sub_msg'] ?? '退款失败',
        ];
    }

    public function query(Refund $refund): array
    {
        $params = [
            'method'      => 'alipay.trade.fastpay.refund.query',
            'app_id'      => config('services.alipay.app_id'),
            'sign_type'   => 'RSA2',
            'timestamp'   => now()->format('Y-m-d H:i:s'),
            'version'     => '1.0',
            'biz_content' => json_encode([
                'out_trade_no'   => $refund->order->order_no,
                'out_refund_no'  => $refund->refund_no,
            ]),
        ];

        $response = Http::asForm()->post(config('services.alipay.gateway'), $params);
        $body = json_decode($response->body(), true);
        $result = $body['alipay_trade_fastpay_refund_query_response'] ?? [];

        return [
            'status'  => $this->mapStatus($result['refund_status'] ?? ''),
            'message' => $result['sub_msg'] ?? '',
        ];
    }

    private function mapStatus(string $status): string
    {
        return match ($status) {
            'REFUND_SUCCESS' => Refund::STATUS_SUCCESS,
            'REFUND_CLOSED'  => Refund::STATUS_REJECTED,
            default          => Refund::STATUS_REFUNDING,
        };
    }

    private function sign(array $params): string
    {
        // RSA2 签名实现（生产环境用支付宝 SDK）
        ksort($params);
        $signContent = collect($params)
            ->filter(fn($v) => $v !== '' && $v !== null && $v !== 'sign')
            ->map(fn($v, $k) => "{$k}={$v}")
            ->implode('&');

        $privateKey = openssl_pkey_get_private(
            file_get_contents(config('services.alipay.private_key_path'))
        );
        openssl_sign($signContent, $sign, $privateKey, OPENSSL_ALGO_SHA256);
        openssl_pkey_free($privateKey);

        return base64_encode($sign);
    }
}
```

### 4. 退款服务（核心业务逻辑）

```php
<?php

namespace App\Services\Refund;

use App\Events\Refund\RefundCreated;
use App\Events\Refund\RefundSuccess;
use App\Models\Order;
use App\Models\Refund;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RefundService
{
    public function __construct(
        private RefundChannelFactory $channelFactory,
    ) {}

    /**
     * 创建退款
     */
    public function createRefund(
        int $orderId,
        float $amount,
        string $reason,
        ?string $channel = null
    ): Refund {
        return DB::transaction(function () use ($orderId, $amount, $reason, $channel) {
            $order = Order::findOrFail($orderId);

            // 1. 校验可退金额
            $refundable = Refund::refundableAmount($orderId);
            if ($amount > $refundable) {
                throw new \DomainException(
                    "申请退款 {$amount} 元超过可退金额 {$refundable} 元"
                );
            }

            if ($amount <= 0) {
                throw new \DomainException('退款金额必须大于 0');
            }

            // 2. 创建退款单
            $refund = Refund::create([
                'order_id'     => $orderId,
                'refund_no'    => 'RF' . date('YmdHis') . strtoupper(Str::random(6)),
                'channel'      => $channel ?? $order->payment_channel,
                'total_amount' => $order->paid_amount,
                'refund_amount'=> $amount,
                'currency'     => $order->currency ?? 'CNY',
                'status'       => Refund::STATUS_PENDING,
                'reason'       => $reason,
                'metadata'     => [
                    'ip'          => request()->ip(),
                    'user_agent'  => request()->userAgent(),
                ],
            ]);

            // 3. 触发事件（可对接审核流程）
            event(new RefundCreated($refund));

            return $refund;
        });
    }

    /**
     * 执行退款（调用支付渠道）
     */
    public function executeRefund(Refund $refund): void
    {
        // 状态流转到 processing
        RefundStateMachine::transition(
            $refund,
            Refund::STATUS_PROCESSING,
            'system',
            '开始执行退款'
        );

        $channel = $this->channelFactory->make($refund->channel);
        $result = $channel->refund($refund);

        if ($result['success']) {
            RefundStateMachine::transition(
                $refund,
                Refund::STATUS_REFUNDING,
                'system',
                $result['message'],
                ['channel_refund_id' => $result['channel_refund_id']]
            );
        } else {
            RefundStateMachine::transition(
                $refund,
                Refund::STATUS_FAILED,
                'system',
                $result['message']
            );
        }
    }

    /**
     * 处理退款回调（微信/支付宝异步通知）
     */
    public function handleCallback(string $channel, array $payload): void
    {
        $channelAdapter = $this->channelFactory->make($channel);

        // 根据回调中的退款单号找到对应退款记录
        $refund = $this->resolveRefund($channel, $payload);

        if (!$refund) {
            logger()->warning("退款回调找不到退款记录", ['channel' => $channel, 'payload' => $payload]);
            return;
        }

        // 主动查询渠道确认状态
        $queryResult = $channelAdapter->query($refund);

        match ($queryResult['status']) {
            Refund::STATUS_SUCCESS => $this->markSuccess($refund),
            Refund::STATUS_FAILED  => $this->markFailed($refund, $queryResult['message']),
            default => null, // 仍在处理中，不做处理
        };
    }

    /**
     * 退款成功
     */
    private function markSuccess(Refund $refund): void
    {
        RefundStateMachine::transition(
            $refund,
            Refund::STATUS_SUCCESS,
            'system',
            '渠道退款成功'
        );

        // 更新订单退款状态
        $refund->order->update([
            'refund_status' => $refund->refundableAmount() <= 0 ? 'full_refund' : 'partial_refund',
        ]);

        event(new RefundSuccess($refund));
    }

    /**
     * 退款失败
     */
    private function markFailed(Refund $refund, string $message): void
    {
        RefundStateMachine::transition(
            $refund,
            Refund::STATUS_FAILED,
            'system',
            "渠道退款失败: {$message}"
        );
    }

    private function resolveRefund(string $channel, array $payload): ?Refund
    {
        // 根据渠道不同，从回调中提取退款标识
        $refundNo = match ($channel) {
            'wechat'  => $payload['out_refund_no'] ?? null,
            'alipay'  => $payload['out_refund_no'] ?? null,
            'stripe'  => $payload['metadata']['refund_no'] ?? null,
            default   => null,
        };

        return $refundNo ? Refund::where('refund_no', $refundNo)->first() : null;
    }
}
```

### 5. 部分退款拆单

```php
<?php

namespace App\Services\Refund;

use App\Models\OrderItem;
use App\Models\Refund;
use App\Models\RefundItem;

class PartialRefundService
{
    /**
     * 创建部分退款（按订单项）
     */
    public function createPartialRefund(
        int $orderId,
        array $items, // [['order_item_id' => 1, 'amount' => 100], ...]
        string $reason
    ): Refund {
        $order = \App\Models\Order::findOrFail($orderId);
        $totalRefund = array_sum(array_column($items, 'amount'));

        // 校验每个订单项的可退金额
        foreach ($items as $item) {
            $orderItem = OrderItem::findOrFail($item['order_item_id']);
            $itemRefunded = RefundItem::where('order_item_id', $orderItem->id)
                ->whereHas('refund', fn($q) => $q->whereIn('status', [
                    Refund::STATUS_SUCCESS,
                    Refund::STATUS_SETTLED,
                ]))
                ->sum('refund_amount');

            $itemRefundable = $orderItem->amount - $itemRefunded;

            if ($item['amount'] > $itemRefundable) {
                throw new \DomainException(
                    "订单项 #{$orderItem->id} 可退金额为 {$itemRefundable}，申请 {$item['amount']}"
                );
            }
        }

        // 创建退款主单
        $refund = app(RefundService::class)->createRefund(
            $orderId,
            $totalRefund,
            $reason
        );

        // 创建退款明细
        foreach ($items as $item) {
            $orderItem = OrderItem::findOrFail($item['order_item_id']);
            RefundItem::create([
                'refund_id'      => $refund->id,
                'order_item_id'  => $orderItem->id,
                'product_name'   => $orderItem->product_name,
                'quantity'       => $item['quantity'] ?? 1,
                'unit_price'     => $orderItem->unit_price,
                'refund_amount'  => $item['amount'],
            ]);
        }

        return $refund;
    }
}
```

### 6. 财务对账引擎

```php
<?php

namespace App\Services\Refund;

use App\Models\Order;
use App\Models\Refund;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class RefundReconciliationService
{
    /**
     * 日终对账：比对内部记录与渠道数据
     */
    public function dailyReconciliation(Carbon $date): ReconciliationResult
    {
        $dateStr = $date->format('Y-m-d');

        // 1. 拉取当天所有成功的退款
        $internalRefunds = Refund::where('status', Refund::STATUS_SUCCESS)
            ->whereDate('updated_at', $date)
            ->get();

        // 2. 从各渠道拉取对账文件
        $channelRefunds = $this->fetchChannelRefunds($date);

        // 3. 按退款单号匹配
        $matched = [];
        $internalOnly = [];
        $channelOnly = [];

        $internalMap = $internalRefunds->keyBy('refund_no');

        foreach ($channelRefunds as $channelRefund) {
            $refundNo = $channelRefund['refund_no'];
            if (isset($internalMap[$refundNo])) {
                $internal = $internalMap[$refundNo];
                // 金额比对
                if (abs($internal->refund_amount - $channelRefund['amount']) < 0.01) {
                    $matched[] = $refundNo;
                } else {
                    $matched[] = $refundNo; // 金额差异需标记
                }
                $internalMap->pull($refundNo);
            } else {
                $channelOnly[] = $channelRefund;
            }
        }

        // 渠道中没有但内部有 = 可能未成功
        $internalOnly = $internalMap->pluck('refund_no')->toArray();

        $result = new ReconciliationResult(
            date: $date,
            matched: $matched,
            internalOnly: $internalOnly,
            channelOnly: $channelOnly,
            totalInternal: $internalRefunds->sum('refund_amount'),
            totalChannel: collect($channelRefunds)->sum('amount'),
        );

        // 4. 记录对账结果
        $this->saveResult($result);

        // 5. 异常告警
        if (!empty($internalOnly) || !empty($channelOnly)) {
            $this->alert($result);
        }

        return $result;
    }

    /**
     * 从渠道拉取退款对账数据
     */
    private function fetchChannelRefunds(Carbon $date): array
    {
        $allRefunds = [];
        $channels = ['wechat', 'alipay', 'stripe'];

        foreach ($channels as $channelName) {
            $adapter = app(RefundChannelFactory::class)->make($channelName);
            $channelRefunds = $adapter->fetchDailyRefunds($date);
            $allRefunds = array_merge($allRefunds, $channelRefunds);
        }

        return $allRefunds;
    }

    private function saveResult(ReconciliationResult $result): void
    {
        DB::table('refund_reconciliation')->insert([
            'date'             => $result->date->format('Y-m-d'),
            'matched_count'    => count($result->matched),
            'internal_only'    => json_encode($result->internalOnly),
            'channel_only'     => json_encode($result->channelOnly),
            'total_internal'   => $result->totalInternal,
            'total_channel'    => $result->totalChannel,
            'status'           => empty($result->internalOnly) && empty($result->channelOnly)
                ? 'balanced'
                : 'discrepancy',
            'created_at'       => now(),
        ]);
    }

    private function alert(ReconciliationResult $result): void
    {
        // 对账差异告警
        $message = "退款对账异常 ({$result->date->format('Y-m-d')})\n";
        $message .= "内部独有: " . implode(', ', $result->internalOnly) . "\n";
        $message .= "渠道独有: " . implode(', ', $result->channelOnly);

        // 推送到飞书/钉钉
        app(NotificationService::class)->sendRefundAlert($message);
    }
}
```

### 7. 定时任务：退款状态轮询

```php
<?php

namespace App\Console\Commands;

use App\Models\Refund;
use App\Services\Refund\RefundChannelFactory;
use App\Services\Refund\RefundStateMachine;
use Illuminate\Console\Command;

class RefundStatusPollCommand extends Command
{
    protected $signature = 'refund:poll';
    protected $description = '轮询渠道退款状态，更新本地记录';

    public function handle(RefundChannelFactory $channelFactory): int
    {
        // 查询所有 processing/refunding 状态超过 30 分钟的退款
        $pendingRefunds = Refund::whereIn('status', [
            Refund::STATUS_PROCESSING,
            Refund::STATUS_REFUNDING,
        ])
        ->where('updated_at', '<', now()->subMinutes(30))
        ->limit(100)
        ->get();

        $this->info("找到 {$pendingRefunds->count()} 条待轮询退款");

        foreach ($pendingRefunds as $refund) {
            $channel = $channelFactory->make($refund->channel);
            $result = $channel->query($refund);

            match ($result['status']) {
                Refund::STATUS_SUCCESS => RefundStateMachine::transition(
                    $refund,
                    Refund::STATUS_SUCCESS,
                    'poll-command',
                    '轮询确认退款成功'
                ),
                Refund::STATUS_FAILED => RefundStateMachine::transition(
                    $refund,
                    Refund::STATUS_FAILED,
                    'poll-command',
                    "轮询确认退款失败: {$result['message']}"
                ),
                default => null,
            };

            // 避免请求过快
            usleep(200_000);
        }

        return Command::SUCCESS;
    }
}
```

## 踩坑记录

### 1. 部分退款的金额精度问题

微信和支付宝的金额单位是"分"（整数），内部存储用"元"（decimal）。转换时务必用 `round()` 并且在数据库层面也用 `DECIMAL(10,2)`，避免浮点数精度问题。

**踩坑实录：** 退款 `99.90` 元，`99.90 * 100 = 9990`，但如果用 `float` 计算可能变成 `9989.9999...`，转 `int` 就变成 `9989`，差了一分钱。微信直接报错 `REFUND_FEE_MISMATCH`。

```php
// ❌ 错误
$feeInCents = (int) ($amount * 100);

// ✅ 正确
$feeInCents = (int) round($amount * 100);
```

### 2. 退款回调的幂等处理

同一个退款回调可能被多次投递（微信最多 15 次重试）。如果不做幂等，可能导致重复执行业务逻辑。

```php
// 在 handleCallback 入口加分布式锁
$lock = Cache::lock("refund_callback:{$refund->refund_no}", 30);
if (!$lock->get()) {
    return response('processing'); // 之前已在处理
}

try {
    // ... 处理逻辑
} finally {
    $lock->release();
}
```

### 3. 跨境退款的汇率问题

KKday 是跨境 OTA，涉及多币种退款。核心原则：**退用户多少钱，按支付时的汇率锁定，不按退款时的汇率重新计算。** 否则用户会因为汇率波动多退或少退。

### 4. 退款超时的自动轮询

用户发起退款后，渠道可能需要 1-3 个工作日处理。期间用户不断刷新页面问"钱退了没"。必须有后台轮询任务：

- 退款后 30 分钟开始轮询
- 轮询频率：前 2 小时每 10 分钟一次，之后每小时一次
- 超过 72 小时未完成 → 标记为异常，人工介入

### 5. 财务对账的"时区陷阱"

微信对账用北京时间，Stripe 对账用 UTC，支付宝用北京时间。对账时要统一到一个时区，否则同一天的退款记录会错位。

## 总结

退款系统看似是支付的"逆过程"，复杂度却远超支付本身。核心要点：

1. **状态机是骨架**：单向流转、幂等操作、审计日志，缺一不可
2. **多通道适配是肌肉**：接口统一抽象，每个渠道独立实现
3. **部分退款是关节**：金额拆分要精确到分，数据库用 DECIMAL
4. **财务对账是体检**：日终对账是最后一道防线，差异必须告警
5. **回调幂等是免疫系统**：分布式锁 + 唯一约束，防重复退款

退款不难写，难写对。每一分钱都是用户的信任。
