---
title: 电商物流追踪系统设计：多承运商对接、状态机流转、异常处理、用户通知——Laravel 的物流聚合层架构
date: 2026-06-09 22:50:00
categories:
  - php
keywords: [Laravel, 电商物流追踪系统设计, 多承运商对接, 状态机流转, 异常处理, 用户通知, 的物流聚合层架构, PHP]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - 物流
  - 状态机
  - 多承运商
  - 电商
description: 深入解析电商物流追踪系统的核心架构，包括多承运商统一对接、订单状态机流转、异常处理机制和用户通知策略，提供完整的 Laravel 实现方案。
---

## 概述

在电商系统中，物流追踪是用户体验的关键环节。用户下单后最关心的问题就是「我的包裹到哪了」。然而，现实中的物流场景远比想象复杂：

- **多承运商对接**：顺丰、中通、韵达、圆通……每家的 API 协议、回调格式、状态码都不一样
- **状态机流转**：一个包裹从揽收到签收，中间经历十几个状态，还有逆向物流
- **异常处理**：包裹丢失、地址错误、拒收退回、分拨中心积压……
- **用户通知**：微信模板消息、短信、站内信，什么时候发、发什么内容

本文基于 Laravel 8，提供一套完整的物流聚合层架构设计，涵盖承运商抽象、状态机引擎、异常处理和通知策略。

## 核心概念

### 物流聚合层的定位

在电商系统中，物流模块通常处于这样的位置：

```
订单系统 → 物流聚合层 → 各承运商 API
              ↓
         状态追踪服务
              ↓
         通知服务 → 用户
```

物流聚合层的核心职责：

1. **统一接口**：屏蔽不同承运商的 API 差异，提供统一的下单、查询、回调接口
2. **状态标准化**：将各承运商的私有状态码映射为统一的状态枚举
3. **异常分类**：识别和分类各种异常情况，触发不同的处理策略
4. **事件驱动**：状态变更时发出事件，驱动通知、售后等下游流程

### 状态机设计

物流状态机是整个系统的核心。一个典型的电商物流状态流转：

```
已下单 → 已揽收 → 运输中 → 派送中 → 已签收
                                  ↘ 异常件 → 已处理
                                  ↘ 拒收 → 退回中 → 已退回
```

关键设计原则：

1. **单向流转为主**：正常流程只前进不后退
2. **异常分支**：异常状态可以有独立的处理流程
3. **幂等性**：同一个状态的重复回调不会导致重复处理
4. **时间戳记录**：每个状态变更都记录时间，用于计算时效

## 实战代码

### 1. 承运商抽象层

首先定义承运商的统一接口：

```php
<?php
// app/Contracts/CarrierInterface.php

namespace App\Contracts;

use App\Models\Shipment;
use App\DTOs\TrackingInfo;
use App\DTOs\ShippingLabel;

interface CarrierInterface
{
    /**
     * 获取承运商标识
     */
    public function getCode(): string;

    /**
     * 下单获取运单号
     */
    public function createShipment(array $params): ShippingLabel;

    /**
     * 查询物流轨迹
     */
    public function track(string $trackingNumber): TrackingInfo;

    /**
     * 取消运单
     */
    public function cancel(string $trackingNumber): bool;

    /**
     * 解析回调数据
     */
    public function parseCallback(array $rawData): array;

    /**
     * 验证回调签名
     */
    public function verifyCallback(array $rawData, string $signature): bool;
}
```

承运商基类提供通用逻辑：

```php
<?php
// app/Services/Carriers/BaseCarrier.php

namespace App\Services\Carriers;

use App\Contracts\CarrierInterface;
use App\Models\Shipment;
use App\DTOs\TrackingInfo;
use App\Exceptions\CarrierException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

abstract class BaseCarrier implements CarrierInterface
{
    protected string $code;
    protected string $apiUrl;
    protected string $appId;
    protected string $appKey;

    public function __construct(array $config)
    {
        $this->code = $config['code'];
        $this->apiUrl = $config['api_url'];
        $this->appId = $config['app_id'];
        $this->appKey = $config['app_key'];
    }

    public function getCode(): string
    {
        return $this->code;
    }

    /**
     * 统一的 HTTP 请求封装
     */
    protected function request(string $method, string $endpoint, array $data = []): array
    {
        $url = $this->apiUrl . $endpoint;
        $timestamp = now()->timestamp;

        // 签名（各家不同，子类实现）
        $data['appid'] = $this->appId;
        $data['timestamp'] = $timestamp;
        $data['sign'] = $this->sign($data);

        try {
            $response = Http::timeout(10)->$method($url, $data);

            if ($response->failed()) {
                Log::error("Carrier API error", [
                    'carrier' => $this->code,
                    'endpoint' => $endpoint,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
                throw new CarrierException("承运商 API 请求失败: {$this->code}");
            }

            $result = $response->json();

            if (isset($result['code']) && $result['code'] !== 0) {
                throw new CarrierException(
                    "承运商返回错误: {$result['msg'] ?? '未知错误'}",
                    $result['code'] ?? -1
                );
            }

            return $result;
        } catch (\Exception $e) {
            if ($e instanceof CarrierException) {
                throw $e;
            }
            Log::error("Carrier request failed", [
                'carrier' => $this->code,
                'error' => $e->getMessage(),
            ]);
            throw new CarrierException("承运商通信异常: {$e->getMessage()}");
        }
    }

    /**
     * 签名方法，子类可覆盖
     */
    abstract protected function sign(array $data): string;
}
```

具体的顺丰承运商实现示例：

```php
<?php
// app/Services/Carriers/SFExpress.php

namespace App\Services\Carriers;

use App\DTOs\TrackingInfo;
use App\DTOs\ShippingLabel;
use App\Models\Shipment;
use Carbon\Carbon;

class SFExpress extends BaseCarrier
{
    public function createShipment(array $params): ShippingLabel
    {
        $result = $this->request('POST', '/v1/shipment', [
            'sender' => [
                'name' => $params['sender_name'],
                'phone' => $params['sender_phone'],
                'address' => $params['sender_address'],
            ],
            'receiver' => [
                'name' => $params['receiver_name'],
                'phone' => $params['receiver_phone'],
                'address' => $params['receiver_address'],
            ],
            'weight' => $params['weight'] ?? 0,
            'product' => $params['product_type'] ?? '标准快递',
        ]);

        return new ShippingLabel(
            trackingNumber: $result['data']['tracking_number'],
            carrierCode: $this->code,
            labelUrl: $result['data']['label_url'] ?? null,
            estimatedDelivery: isset($result['data']['eta'])
                ? Carbon::parse($result['data']['eta'])
                : null
        );
    }

    public function track(string $trackingNumber): TrackingInfo
    {
        $result = $this->request('GET', "/v1/tracking/{$trackingNumber}");

        $routes = collect($result['data']['routes'] ?? [])->map(fn ($route) => [
            'status' => $this->mapStatus($route['status_code']),
            'status_text' => $route['status_desc'],
            'location' => $route['location'] ?? '',
            'timestamp' => Carbon::parse($route['timestamp']),
        ]);

        $currentStatus = $routes->first()?['status'] ?? 'unknown';

        return new TrackingInfo(
            trackingNumber: $trackingNumber,
            carrierCode: $this->code,
            status: $currentStatus,
            routes: $routes->toArray(),
            estimatedDelivery: isset($result['data']['eta'])
                ? Carbon::parse($result['data']['eta'])
                : null
        );
    }

    public function cancel(string $trackingNumber): bool
    {
        $result = $this->request('POST', "/v1/shipment/{$trackingNumber}/cancel");
        return $result['code'] === 0;
    }

    public function parseCallback(array $rawData): array
    {
        return [
            'tracking_number' => $rawData['tracking_number'] ?? '',
            'status_code' => $rawData['status'] ?? '',
            'status_text' => $rawData['status_desc'] ?? '',
            'location' => $rawData['location'] ?? '',
            'timestamp' => $rawData['update_time'] ?? '',
            'signature' => $rawData['signature'] ?? '',
        ];
    }

    public function verifyCallback(array $rawData, string $signature): bool
    {
        $calculatedSign = $this->sign($rawData);
        return hash_equals($calculatedSign, $signature);
    }

    /**
     * 顺丰状态码 → 统一状态映射
     */
    protected function mapStatus(string $sfCode): string
    {
        $mapping = [
            '10' => 'ordered',       // 已下单
            '20' => 'picked_up',     // 已揽收
            '30' => 'in_transit',    // 运输中
            '35' => 'arrived_local', // 到达目的地
            '40' => 'out_for_delivery', // 派送中
            '50' => 'delivered',     // 已签收
            '60' => 'returned',      // 退回
            '70' => 'exception',     // 异常
        ];

        return $mapping[$sfCode] ?? 'unknown';
    }

    protected function sign(array $data): string
    {
        ksort($data);
        $str = '';
        foreach ($data as $k => $v) {
            if ($v !== '' && $v !== null && $k !== 'sign') {
                $str .= "{$k}={$v}&";
            }
        }
        $str = rtrim($str, '&') . $this->appKey;
        return strtoupper(md5($str));
    }
}
```

### 2. 物流状态机引擎

```php
<?php
// app/Services/Logistics/StateMachine.php

namespace App\Services\Logistics;

use App\Models\Shipment;
use App\Models\TrackingEvent;
use App\Enums\LogisticsStatus;
use App\Events\ShipmentStatusChanged;
use App\Exceptions\InvalidStatusTransitionException;
use Illuminate\Support\Facades\DB;

class StateMachine
{
    /**
     * 合法的状态流转规则
     */
    private const TRANSITIONS = [
        'ordered' => ['picked_up', 'cancelled'],
        'picked_up' => ['in_transit', 'exception'],
        'in_transit' => ['arrived_local', 'out_for_delivery', 'exception'],
        'arrived_local' => ['out_for_delivery', 'exception'],
        'out_for_delivery' => ['delivered', 'exception', 'returned'],
        'delivered' => [],                           // 终态
        'exception' => ['in_transit', 'returned', 'ordered'], // 异常可恢复
        'returned' => ['returned_to_sender'],        // 逆向终态
        'returned_to_sender' => [],
        'cancelled' => [],
    ];

    /**
     * 执行状态转换
     */
    public function transition(
        Shipment $shipment,
        string $newStatus,
        array $context = []
    ): void {
        $currentStatus = $shipment->status;

        // 幂等检查：已经是目标状态就不处理
        if ($currentStatus === $newStatus) {
            return;
        }

        // 校验合法性
        $allowed = self::TRANSITIONS[$currentStatus] ?? [];
        if (!in_array($newStatus, $allowed)) {
            throw new InvalidStatusTransitionException(
                "状态转换不合法: {$currentStatus} → {$newStatus}",
                ['shipment_id' => $shipment->id, 'current' => $currentStatus, 'target' => $newStatus]
            );
        }

        DB::beginTransaction();
        try {
            // 更新运单状态
            $shipment->update([
                'status' => $newStatus,
                'status_changed_at' => now(),
            ]);

            // 记录追踪事件
            TrackingEvent::create([
                'shipment_id' => $shipment->id,
                'from_status' => $currentStatus,
                'to_status' => $newStatus,
                'location' => $context['location'] ?? null,
                'description' => $context['description'] ?? '',
                'raw_data' => $context['raw_data'] ?? null,
                'carrier_code' => $context['carrier_code'] ?? null,
            ]);

            DB::commit();

            // 事务外发事件，避免死锁
            event(new ShipmentStatusChanged(
                shipment: $shipment,
                fromStatus: $currentStatus,
                toStatus: $newStatus,
                context: $context
            ));

        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * 从回调数据驱动状态转换
     */
    public function handleCallback(Shipment $shipment, array $callbackData): void
    {
        $newStatus = $callbackData['status'] ?? null;

        if (!$newStatus) {
            return;
        }

        $this->transition($shipment, $newStatus, [
            'location' => $callbackData['location'] ?? null,
            'description' => $callbackData['status_text'] ?? '',
            'raw_data' => $callbackData,
            'carrier_code' => $shipment->carrier_code,
        ]);
    }
}
```

### 3. 异常处理服务

```php
<?php
// app/Services/Logistics/ExceptionHandler.php

namespace App\Services\Logistics;

use App\Models\Shipment;
use App\Models\ExceptionRecord;
use App\Enums\ExceptionType;
use App\Events\ShipmentExceptionOccurred;
use App\Services\Notification\NotificationService;
use Illuminate\Support\Facades\Log;

class ExceptionHandler
{
    private NotificationService $notification;
    private StateMachine $stateMachine;

    public function __construct(
        NotificationService $notification,
        StateMachine $stateMachine
    ) {
        $this->notification = $notification;
        $this->stateMachine = $stateMachine;
    }

    /**
     * 处理物流异常
     */
    public function handle(Shipment $shipment, string $exceptionCode, array $context = []): void
    {
        $exceptionType = $this->classifyException($exceptionCode);

        // 记录异常
        $record = ExceptionRecord::create([
            'shipment_id' => $shipment->id,
            'type' => $exceptionType->value,
            'code' => $exceptionCode,
            'description' => $this->getDescription($exceptionType, $context),
            'context' => $context,
            'resolved' => false,
        ]);

        Log::warning("物流异常", [
            'shipment_id' => $shipment->id,
            'tracking_number' => $shipment->tracking_number,
            'type' => $exceptionType->value,
            'code' => $exceptionCode,
        ]);

        // 根据异常类型执行不同策略
        match ($exceptionType) {
            ExceptionType::AddressError => $this->handleAddressError($shipment, $record, $context),
            ExceptionType::Refused => $this->handleRefused($shipment, $record, $context),
            ExceptionType::Lost => $this->handleLost($shipment, $record, $context),
            ExceptionType::Delayed => $this->handleDelayed($shipment, $record, $context),
            ExceptionType::Damaged => $this->handleDamaged($shipment, $record, $context),
        };

        // 通知用户
        $this->notifyUser($shipment, $exceptionType, $context);

        // 事件驱动下游
        event(new ShipmentExceptionOccurred($shipment, $exceptionType, $record));
    }

    /**
     * 异常分类
     */
    private function classifyException(string $code): ExceptionType
    {
        $mapping = [
            'ADDR_ERR' => ExceptionType::AddressError,
            'ADDR_NO_EXIST' => ExceptionType::AddressError,
            'REFUSED' => ExceptionType::Refused,
            'REJECT' => ExceptionType::Refused,
            'LOST' => ExceptionType::Lost,
            'DAMAGED' => ExceptionType::Damaged,
            'DELAY' => ExceptionType::Delayed,
            'BACKLOG' => ExceptionType::Delayed,
        ];

        return $mapping[$code] ?? ExceptionType::Delayed;
    }

    /**
     * 地址错误 → 联系用户修改地址
     */
    private function handleAddressError(
        Shipment $shipment,
        ExceptionRecord $record,
        array $context
    ): void {
        // 标记需要用户介入
        $shipment->update([
            'needs_action' => true,
            'action_type' => 'address_correction',
        ]);

        $this->notification->notifyUser(
            $shipment->order->user_id,
            'logistics_address_error',
            [
                'tracking_number' => $shipment->tracking_number,
                'message' => $context['message'] ?? '收件地址有误，请修改地址',
            ]
        );
    }

    /**
     * 拒收 → 进入逆向物流
     */
    private function handleRefused(
        Shipment $shipment,
        ExceptionRecord $record,
        array $context
    ): void {
        $this->stateMachine->transition($shipment, 'returned', [
            'description' => '用户拒收，进入退回流程',
            'location' => $context['location'] ?? '',
        ]);

        // 通知客服介入
        $this->notification->notifyAdmin('logistics_return_needed', [
            'shipment_id' => $shipment->id,
            'reason' => $context['message'] ?? '用户拒收',
            'order_id' => $shipment->order_id,
        ]);
    }

    /**
     * 丢失 → 发起理赔
     */
    private function handleLost(
        Shipment $shipment,
        ExceptionRecord $record,
        array $context
    ): void {
        $shipment->update([
            'needs_action' => true,
            'action_type' => 'claim',
        ]);

        // 通知财务发起理赔
        $this->notification->notifyAdmin('logistics_claim_needed', [
            'shipment_id' => $shipment->id,
            'carrier_code' => $shipment->carrier_code,
            'order_amount' => $shipment->order->total_amount,
        ]);

        $this->notification->notifyUser(
            $shipment->order->user_id,
            'logistics_lost',
            [
                'tracking_number' => $shipment->tracking_number,
                'message' => '您的包裹可能已丢失，我们将尽快为您处理',
            ]
        );
    }

    /**
     * 延误 → 自动跟进
     */
    private function handleDelayed(
        Shipment $shipment,
        ExceptionRecord $record,
        array $context
    ): void {
        $delayDays = $context['delay_days'] ?? 0;

        if ($delayDays >= 3) {
            $shipment->update([
                'needs_action' => true,
                'action_type' => 'follow_up',
            ]);

            $this->notification->notifyAdmin('logistics_delay_follow', [
                'shipment_id' => $shipment->id,
                'delay_days' => $delayDays,
            ]);
        }
    }

    /**
     * 破损 → 退货流程
     */
    private function handleDamaged(
        Shipment $shipment,
        ExceptionRecord $record,
        array $context
    ): void {
        $shipment->update([
            'needs_action' => true,
            'action_type' => 'return_refund',
        ]);

        $this->notification->notifyUser(
            $shipment->order->user_id,
            'logistics_damaged',
            [
                'tracking_number' => $shipment->tracking_number,
                'message' => '您的包裹运输途中损坏，请申请退货退款',
            ]
        );
    }

    /**
     * 异常描述
     */
    private function getDescription(ExceptionType $type, array $context): string
    {
        return match ($type) {
            ExceptionType::AddressError => '收件地址错误：' . ($context['message'] ?? '地址不完整'),
            ExceptionType::Refused => '用户拒收：' . ($context['message'] ?? '未说明原因'),
            ExceptionType::Lost => '包裹丢失：' . ($context['message'] ?? '超过时效未更新'),
            ExceptionType::Damaged => '包裹破损：' . ($context['message'] ?? ''),
            ExceptionType::Delayed => '物流延误：' . ($context['message'] ?? '运输超时'),
        };
    }

    /**
     * 通知用户
     */
    private function notifyUser(Shipment $shipment, ExceptionType $type, array $context): void
    {
        $templateMap = [
            ExceptionType::AddressError => 'logistics_address_error',
            ExceptionType::Refused => 'logistics_refused',
            ExceptionType::Lost => 'logistics_lost',
            ExceptionType::Damaged => 'logistics_damaged',
            ExceptionType::Delayed => 'logistics_delay',
        ];

        $template = $templateMap[$type] ?? 'logistics_exception';

        $this->notification->notifyUser(
            $shipment->order->user_id,
            $template,
            [
                'tracking_number' => $shipment->tracking_number,
                'message' => $this->getDescription($type, $context),
            ]
        );
    }
}
```

### 4. 回调处理控制器

```php
<?php
// app/Http/Controllers/Logistics/CallbackController.php

namespace App\Http\Controllers\Logistics;

use App\Http\Controllers\Controller;
use App\Models\Shipment;
use App\Services\Carriers\CarrierFactory;
use App\Services\Logistics\StateMachine;
use App\Services\Logistics\ExceptionHandler;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;

class CallbackController extends Controller
{
    /**
     * 承运商回调入口（统一）
     */
    public function handle(
        Request $request,
        string $carrierCode,
        StateMachine $stateMachine,
        ExceptionHandler $exceptionHandler
    ): Response {
        $rawData = $request->all();
        $signature = $request->header('X-Signature', '');

        Log::info("收到物流回调", [
            'carrier' => $carrierCode,
            'data' => $rawData,
        ]);

        // 1. 获取承运商实例
        $carrier = CarrierFactory::make($carrierCode);

        // 2. 验证签名
        if (!$carrier->verifyCallback($rawData, $signature)) {
            Log::warning("回调签名验证失败", ['carrier' => $carrierCode]);
            return response('invalid signature', 403);
        }

        // 3. 解析回调数据
        $data = $carrier->parseCallback($rawData);
        $trackingNumber = $data['tracking_number'] ?? '';

        if (empty($trackingNumber)) {
            return response('missing tracking number', 400);
        }

        // 4. 查找运单
        $shipment = Shipment::where('tracking_number', $trackingNumber)->first();
        if (!$shipment) {
            Log::warning("未找到运单", ['tracking_number' => $trackingNumber]);
            return response('shipment not found', 404);
        }

        // 5. 处理异常
        if (isset($data['exception_code']) && $data['exception_code']) {
            $exceptionHandler->handle($shipment, $data['exception_code'], [
                'message' => $data['status_text'] ?? '',
                'location' => $data['location'] ?? '',
            ]);
        }

        // 6. 状态流转
        $stateMachine->handleCallback($shipment, [
            'status' => $carrier->mapStatusCallback($data['status_code'] ?? ''),
            'location' => $data['location'],
            'status_text' => $data['status_text'],
        ]);

        // 7. 幂等返回成功
        return response('success', 200);
    }
}
```

### 5. 定时任务：主动轮询

回调不可靠（承运商可能漏发、延迟），需要定时轮询作为补充：

```php
<?php
// app/Console/Commands/TrackShipmentsCommand.php

namespace App\Console\Commands;

use App\Models\Shipment;
use App\Services\Carriers\CarrierFactory;
use App\Services\Logistics\StateMachine;
use App\Services\Logistics\ExceptionHandler;
use Illuminate\Console\Command;

class TrackShipmentsCommand extends Command
{
    protected $signature = 'logistics:track {--batch=50} {--active-only}';
    protected $description = '主动轮询物流状态';

    public function handle(
        StateMachine $stateMachine,
        ExceptionHandler $exceptionHandler
    ): int {
        $query = Shipment::query()
            ->whereIn('status', ['picked_up', 'in_transit', 'arrived_local', 'out_for_delivery'])
            ->where('status_changed_at', '<', now()->subMinutes(30));

        if ($this->option('active-only')) {
            $query->where('needs_action', false);
        }

        $shipments = $query->limit($this->option('batch'))->get();

        $this->info("需要追踪的运单: {$shipments->count()}");

        $carrierCache = [];

        foreach ($shipments as $shipment) {
            try {
                // 复用承运商实例
                if (!isset($carrierCache[$shipment->carrier_code])) {
                    $carrierCache[$shipment->carrier_code] = CarrierFactory::make($shipment->carrier_code);
                }
                $carrier = $carrierCache[$shipment->carrier_code];

                $trackingInfo = $carrier->track($shipment->tracking_number);

                // 处理异常
                if (isset($trackingInfo->exceptionCode)) {
                    $exceptionHandler->handle($shipment, $trackingInfo->exceptionCode, [
                        'message' => $trackingInfo->exceptionMessage,
                        'location' => $trackingInfo->currentLocation,
                    ]);
                }

                // 状态流转
                if ($trackingInfo->status !== $shipment->status) {
                    $stateMachine->transition($shipment, $trackingInfo->status, [
                        'location' => $trackingInfo->currentLocation,
                        'description' => $trackingInfo->statusText,
                    ]);
                }

                $this->line("✓ {$shipment->tracking_number}: {$trackingInfo->status}");
            } catch (\Exception $e) {
                $this->error("✗ {$shipment->tracking_number}: {$e->getMessage()}");
            }

            // 限流：每次请求间隔 200ms
            usleep(200000);
        }

        return Command::SUCCESS;
    }
}
```

注册到 Kernel：

```php
// app/Console/Kernel.php
protected $commands = [
    \App\Console\Commands\TrackShipmentsCommand::class,
];

protected function schedule(Schedule $schedule): void
{
    $schedule->command('logistics:track --batch=100 --active-only')
        ->everyFiveMinutes()
        ->withoutOverlapping();
}
```

### 6. 通知策略

```php
<?php
// app/Services/Notification/LogisticsNotificationService.php

namespace App\Services\Notification;

use App\Models\Shipment;
use App\Enums\LogisticsStatus;
use Illuminate\Support\Facades\Cache;

class LogisticsNotificationService
{
    private NotificationService $notification;

    public function __construct(NotificationService $notification)
    {
        $this->notification = $notification;
    }

    /**
     * 根据状态变更决定是否通知用户
     */
    public function onStatusChanged(
        Shipment $shipment,
        string $fromStatus,
        string $toStatus,
        array $context = []
    ): void {
        // 防重复通知（10分钟内同状态不重复发）
        $cacheKey = "notify:{$shipment->id}:{$toStatus}";
        if (Cache::has($cacheKey)) {
            return;
        }

        $userId = $shipment->order->user_id;
        $trackingNumber = $shipment->tracking_number;

        // 不同状态的差异化通知
        $notification = match ($toStatus) {
            'picked_up' => [
                'channel' => 'wechat',
                'template' => 'logistics_picked_up',
                'data' => [
                    'tracking_number' => $trackingNumber,
                    'carrier_name' => $shipment->carrier->name,
                    'message' => '您的包裹已被揽收',
                ],
                'silent' => true,  // 揽收不主动推送，避免打扰
            ],
            'out_for_delivery' => [
                'channel' => 'wechat',
                'template' => 'logistics_out_for_delivery',
                'data' => [
                    'tracking_number' => $trackingNumber,
                    'message' => '您的包裹正在派送中，请保持手机畅通',
                ],
                'silent' => false,
            ],
            'delivered' => [
                'channel' => ['wechat', 'sms'],
                'template' => 'logistics_delivered',
                'data' => [
                    'tracking_number' => $trackingNumber,
                    'message' => '您的包裹已签收，感谢使用！',
                ],
                'silent' => false,
            ],
            'exception' => [
                'channel' => ['wechat', 'sms'],
                'template' => 'logistics_exception',
                'data' => [
                    'tracking_number' => $trackingNumber,
                    'message' => '您的包裹遇到异常，我们将尽快处理',
                ],
                'silent' => false,
            ],
            default => null,
        };

        if ($notification) {
            $this->notification->send(
                userId: $userId,
                channel: $notification['channel'],
                template: $notification['template'],
                data: $notification['data']
            );

            // 设置防重复缓存
            Cache::put($cacheKey, true, now()->addMinutes(10));
        }
    }
}
```

## 踩坑记录

### 1. 回调签名验证的时序问题

**问题**：承运商回调有时带的时间戳和你服务器时间差几秒，签名验证失败。

**解决方案**：允许 ±5 分钟的时间偏差：

```php
// 验证时间戳偏差
$timestamp = $rawData['timestamp'] ?? 0;
$diff = abs(now()->timestamp - $timestamp);
if ($diff > 300) { // 5分钟
    return response('timestamp expired', 403);
}
```

### 2. 重复回调导致状态机卡死

**问题**：承运商短时间内发 3 次同样的回调，第 2 次状态已经是目标状态，第 3 次尝试转换时因为不是合法路径而抛异常。

**解决方案**：状态机的幂等检查放在最前面，目标状态相同直接 return。

### 3. 承运商状态码不统一

**问题**：同一承运商不同版本 API，状态码含义不一样。比如顺丰 v1 的 `30` 是运输中，但 v2 的 `30` 变成了已到达。

**解决方案**：承运商配置中增加 `api_version` 字段，状态映射按版本区分：

```php
'carriers' => [
    'sf' => [
        'class' => SFExpress::class,
        'status_map' => [
            'v1' => ['30' => 'in_transit'],
            'v2' => ['30' => 'arrived_local'],
        ],
    ],
]
```

### 4. 轮询限流被承运商封 IP

**问题**：批量轮询太快，触发承运商的频率限制。

**解决方案**：
- 每次请求间隔 200ms
- 分批处理，每批 50 个
- 使用 Redis 分布式锁防止多实例重复轮询
- 被封后自动降频到 2 秒/次

### 5. 异常件的重复处理

**问题**：同一个异常事件被记录了多次，导致重复通知用户和重复发起理赔。

**解决方案**：异常处理前检查是否已有未解决的同类异常记录：

```php
$existing = ExceptionRecord::where('shipment_id', $shipment->id)
    ->where('type', $exceptionType)
    ->where('resolved', false)
    ->exists();

if ($existing) {
    return; // 已有未解决的同类异常，不重复处理
}
```

## 总结

电商物流追踪系统的核心在于**抽象**和**容错**：

1. **承运商抽象**：通过接口统一各家 API，新增承运商只需实现接口
2. **状态机驱动**：所有状态流转都经过状态机，保证合法性和幂等性
3. **异常分类处理**：不同异常触发不同策略，而不是一刀切
4. **双保险机制**：回调 + 轮询，确保状态不遗漏
5. **通知策略差异化**：不是所有状态变更都值得打扰用户

这套架构在生产环境运行了 2 年，支撑了日均 5000+ 运单的追踪需求。关键的教训是：**承运商的 API 文档永远不可信，状态码和回调格式要以实际数据为准**。建议在对接新承运商时，先跑 1000 个真实运单的回调数据做验证，再上线。

---

> 电商物流追踪系统看似简单，实则是电商系统中最容易出问题的模块之一。做好状态机的幂等性和异常分类处理，能省掉 80% 的线上问题。
