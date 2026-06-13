---
title: 'Strangler Fig Pattern 深度实战：Laravel 单体到微服务的渐进式迁移——Anti-Corruption Layer 与事件驱动的双轨策略'
date: 2026-06-06 11:00:00
tags: [Strangler Fig, 绞杀者模式, 微服务, 架构迁移, Laravel, Anti-Corruption Layer, 事件驱动, 渐进式迁移, DDD]
categories:
  - architecture
cover: /images/covers/strangler-fig-cover.jpg
description: "深入实战 Strangler Fig（绞杀者模式），以 Laravel 单体到微服务的渐进式迁移为主线，完整拆解 Anti-Corruption Layer 同步隔离与事件驱动异步解耦的双轨策略。涵盖五阶段路线图、Nginx 路由分流、Feature Flag 灰度、DTO/Adapter/Facade 全链路代码、Kafka/RabbitMQ 事件发布与幂等消费、数据库双写同步、回滚开关设计及三大常见陷阱，附 Strangler Fig vs Big Bang Rewrite vs Branch by Abstraction 方案对比表，帮助团队安全地将数十万行单体拆分为独立微服务。"
---

当一个 Laravel 单体应用运行三年以上、代码量突破五十万行、部署一次需要四十分钟的全量回归测试时，团队迟早要面对那个终极问题：**推倒重写还是渐进式重构？** 答案几乎总是后者——而 Strangler Fig Pattern（绞杀者模式）正是执行这个"后者"的最成熟范式。

本文聚焦一个被多数迁移实战忽略的维度：**双轨策略**。单独使用 Anti-Corruption Layer（ACL）做数据模型翻译，或者单独用事件驱动做异步解耦，都不够。真正的生产级迁移需要两条轨道同时铺设——ACL 负责同步请求的"最后一公里"隔离，事件驱动负责跨服务的数据最终一致性。两条轨道各有独立的回滚开关，任何一条出问题都不会拖垮全局。

---

## 一、为什么是 Strangler Fig——而非 Big Bang Rewrite？

### 1.1 起源

2004 年，Martin Fowler 在 *StranglerFigApplication* 一文中借用了热带雨林绞杀榕的隐喻：榕树从宿主树根部开始生长，逐渐包裹树干，最终取而代之。应用到软件领域，核心思想是**新系统在旧系统内部生长，而非在外部并行建造**。

```
时间轴：

  ┌─────────────────────────────────────────────────────┐
  │                完整单体 Laravel 应用                   │
  └─────────────────────────────────────────────────────┘
       │
       ▼  阶段 1：识别 Seams（接缝）
  ┌─────────────────────────────────────────────────────┐
  │   [单体核心]     [订单模块 ← 提取候选]                │
  └─────────────────────────────────────────────────────┘
       │
       ▼  阶段 2：路由拦截 + ACL 隔离
  ┌──────────────────────┐    ┌─────────────────────┐
  │   单体 Laravel       │◄──►│  订单微服务 (新)      │
  │   (仍承载流量)       │ACL │  (渐进接管)          │
  └──────────────────────┘    └─────────────────────┘
       │
       ▼  阶段 5：退役旧代码
  ┌──────────────────────┐    ┌─────────────────────┐
  │   精简后的单体       │    │  订单微服务 (全量)    │
  │   (已删除旧订单代码) │    │                      │
  └──────────────────────┘    └─────────────────────┘
```

### 1.2 决策框架

| 维度 | Strangler Fig | Big Bang Rewrite |
|------|--------------|-----------------|
| 业务停机风险 | 极低，逐模块切换 | 极高，一次性切换 |
| 回滚成本 | 仅回滚当前模块 | 全量回滚或无回滚 |
| 团队并行度 | 高，多团队可并行 | 低，需全团队同步 |
| 适合代码规模 | >20 万行 | <5 万行 |
| 典型周期 | 6-18 个月 | 3-6 个月（但风险窗口长） |

**判断准则**：如果你的 Laravel 应用有活跃的业务迭代需求，且团队规模 ≥5 人，几乎必然选择 Strangler Fig。

### 1.3 三种迁移方案全景对比

除了 Strangler Fig 和 Big Bang Rewrite，还有第三种常见方案——**Branch by Abstraction**（抽象分支法）。它不拆分部署单元，而是在单体内部用接口抽象替换旧实现，再逐步切换到新实现。三种方案的核心差异如下：

| 维度 | Strangler Fig（绞杀者模式） | Big Bang Rewrite（推倒重写） | Branch by Abstraction（抽象分支） |
|------|--------------------------|---------------------------|-------------------------------|
| **核心思想** | 新系统在旧系统内部生长，逐步接管流量 | 废弃旧系统，从零构建新系统 | 在单体内用接口隔离，切换底层实现 |
| **部署模型** | 双部署（单体 + 微服务并行） | 单次切换（新旧互斥） | 单部署（仍在同一进程内） |
| **业务停机风险** | 极低，逐模块切换 | 极高，一次性全量切换 | 无停机，但风险集中在内部 |
| **回滚成本** | 仅回滚当前模块（关闭 Feature Flag） | 全量回滚或无回滚 | 回滚到旧实现（需保留旧代码） |
| **团队并行度** | 高，多团队可并行开发独立服务 | 低，需全团队同步 | 中等，需协调接口契约 |
| **数据迁移复杂度** | 高（需双写 / 事件同步） | 中（一次性 ETL） | 低（仍在同一数据库） |
| **适合代码规模** | >20 万行 | <5 万行 | 5-20 万行 |
| **适合团队规模** | ≥8 人（需独立服务团队） | ≤5 人（集中攻坚） | 3-10 人 |
| **典型周期** | 6-18 个月 | 3-6 个月（但风险窗口长） | 2-6 个月 |
| **技术债务清理** | 彻底（新服务全新代码） | 彻底 | 中等（旧代码逐步替换） |
| **持续交付能力** | 强（独立服务独立部署） | 中（新系统需重新建立） | 弱（仍在单体部署周期内） |

**选型决策树**：
- 代码量 >20 万行 + 团队 ≥8 人 → **Strangler Fig**
- 代码量 <5 万行 + 无活跃业务迭代 → **Big Bang Rewrite**
- 代码量 5-20 万行 + 需保持单体部署 → **Branch by Abstraction**
- 三者可以组合使用：先 Branch by Abstraction 解耦模块内部，再用 Strangler Fig 拆分服务

---

## 二、五阶段迁移路线图

### 阶段一：识别 Seams（接缝）

Seam 是单体内部的**天然解耦点**——两个模块之间只有有限的交互接口。在 Laravel 中，寻找以下信号：

- **Eloquent 模型耦合度**：如果 `Order` 模型被 80% 的 Service 直接调用，它就是核心，不宜先动；如果 `Notification` 模型只被 3 个 Service 调用，就是理想候选。
- **数据库表关联深度**：外键链 ≤2 跳的模块更容易剥离。
- **路由前缀聚类**：`/api/orders/*` 下的所有路由如果 90% 只访问 `orders` 和 `order_items` 两张表，耦合度就低。

```bash
# 用 PHPStan 分析类依赖关系
./vendor/bin/phpstan analyse --generate-baseline
# 用 Laravel Debugbar 或 Telescope 观察慢查询与高频调用
```

### 阶段二：路由拦截

在 Nginx 或 Laravel Middleware 层建立分流点：

```nginx
# nginx.conf —— 基于路径前缀分流
upstream monolith {
    server 127.0.0.1:9000;
}
upstream order_service {
    server 127.0.0.1:8001;
}

server {
    listen 80;

    # 已迁移的订单路由 → 新服务
    location /api/orders {
        proxy_pass http://order_service;
        proxy_set_header X-Migration-Source "strangler";
    }

    # 未迁移路由 → 单体
    location / {
        proxy_pass http://monolith;
    }
}
```

也可以在 Laravel 层用 Feature Flag 做更细粒度的灰度：

```php
// app/Http/Middleware/StranglerFigRouter.php
class StranglerFigRouter
{
    public function handle(Request $request, Closure $next)
    {
        $route = $request->route()->getName();

        if (Feature::isActive('order-service') && str_starts_with($route, 'orders.')) {
            return Http::timeout(3)
                ->withHeaders(['X-Migration-Source' => 'strangler'])
                ->send(
                    $request->method(),
                    config('services.order_service.url') . $request->getRequestUri(),
                    $request->all()
                )->toPsrResponse();
        }

        return $next($request);
    }
}

### 2.1 Shadow Mode——新旧服务对比观察

在正式切流之前，Shadow Mode 是最安全的验证手段：新服务接收**复制流量**但不返回给用户，后台对比新旧服务的响应结果。只有当 Shadow Mode 下新服务的响应一致性 >99.9% 时，才开始真正的 Canary 切流。

```php
// app/Http/Middleware/ShadowModeMiddleware.php
class ShadowModeMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request); // 正常走单体，返回给用户

        if ($this->shouldShadow($request)) {
            // 异步复制请求到新服务（不阻塞用户响应）
            ShadowComparisonJob::dispatch(
                request: $request,
                monolithResponse: $response->toJson(),
            )->onQueue('shadow');
        }

        return $response;
    }

    private function shouldShadow(Request $request): bool
    {
        return Feature::isActive('shadow-order-service')
            && in_array($request->route()?->getName(), [
                'orders.show', 'orders.index', 'orders.store',
            ]);
    }
}

// app/Jobs/ShadowComparisonJob.php
class ShadowComparisonJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private Request $request,
        private string $monolithResponse,
    ) {}

    public function handle(OrderHttpClient $httpClient, MetricsCollector $metrics): void
    {
        try {
            $newServiceResponse = $httpClient->send(
                $this->request->method(),
                $this->request->getRequestUri(),
                $this->request->all()
            );

            $isMatch = $this->compareResponses(
                json_decode($this->monolithResponse, true),
                $newServiceResponse->json()
            );

            $metrics->increment('shadow.order.response', 1, [
                'match' => $isMatch ? 'yes' : 'no',
            ]);

            if (!$isMatch) {
                Log::warning('Shadow mode response mismatch', [
                    'uri' => $this->request->getRequestUri(),
                    'monolith' => $this->monolithResponse,
                    'new_service' => $newServiceResponse->body(),
                ]);
            }
        } catch (Throwable $e) {
            $metrics->increment('shadow.order.error', 1);
            Log::error('Shadow mode call failed', ['error' => $e->getMessage()]);
        }
    }

    private function compareResponses(array $a, array $b): bool
    {
        // 只比较核心字段，忽略时间戳等非确定性字段
        $keys = ['status', 'data.total', 'data.items'];
        foreach ($keys as $key) {
            if (data_get($a, $key) !== data_get($b, $key)) {
                return false;
            }
        }
        return true;
    }
}
```

### 阶段三：提取服务 + ACL 隔离

这是双轨策略的第一条轨道——**同步请求隔离**。

### 阶段四：事件驱动解耦

双轨策略的第二条轨道——**异步数据一致性**。

### 阶段五：退役旧代码

确认新服务稳定运行 30 天后，删除单体中的旧代码和旧表。

---

## 三、Anti-Corruption Layer 详解

ACL 是新旧系统之间的"翻译官"。它确保新服务的领域模型**不会被旧系统的数据模型污染**。

### 3.1 整体架构

```
  ┌──────────────────┐         ┌──────────────────────┐
  │   Laravel 单体   │  HTTP   │    订单微服务         │
  │                  │────────►│                      │
  │  Order (Eloquent)│         │  OrderAggregate (DDD) │
  │  ┌────────────┐  │         │  ┌────────────────┐  │
  │  │   ACL      │  │         │  │   ACL          │  │
  │  │  Adapter    │  │         │  │  Translator    │  │
  │  │  DTO        │  │         │  │  DTO           │  │
  │  └────────────┘  │         │  └────────────────┘  │
  └──────────────────┘         └──────────────────────┘
```

### 3.2 DTO 定义

```php
// app/Services/ACL/DTOs/OrderLegacyDTO.php
class OrderLegacyDTO
{
    public function __construct(
        public readonly int $orderId,
        public readonly string $customerEmail,
        public readonly array $lineItems,
        public readonly string $status,       // 旧状态枚举: 'pending', 'paid', 'shipped'
        public readonly float $totalAmount,
        public readonly string $createdAt,
    ) {}

    public static function fromEloquent(Order $order): self
    {
        return new self(
            orderId: $order->id,
            customerEmail: $order->customer->email,
            lineItems: $order->items->map(fn($item) => [
                'sku' => $item->product->sku,
                'qty' => $item->quantity,
                'price' => (float) $item->unit_price,
            ])->toArray(),
            status: $order->status,
            totalAmount: (float) $order->total,
            createdAt: $order->created_at->toIso8601String(),
        );
    }
}
```

### 3.3 Adapter —— 新旧模型翻译器

```php
// app/Services/ACL/Adapters/OrderModelAdapter.php
class OrderModelAdapter
{
    // 旧系统状态 → 新系统状态（DDD Value Object）
    private const STATUS_MAP = [
        'pending'  => OrderStatus::PENDING,
        'paid'     => OrderStatus::CONFIRMED,
        'shipped'  => OrderStatus::FULFILLED,
        'cancelled' => OrderStatus::CANCELLED,
    ];

    public function toNewModel(OrderLegacyDTO $legacy): OrderAggregate
    {
        return OrderAggregate::reconstitute(
            id: OrderId::fromString("LEGACY-{$legacy->orderId}"),
            email: Email::fromString($legacy->customerEmail),
            items: collect($legacy->lineItems)->map(
                fn($li) => new LineItem($li['sku'], $li['qty'], Money::of($li['price'], 'CNY'))
            )->toList(),
            status: self::STATUS_MAP[$legacy->status] ?? OrderStatus::UNKNOWN,
            createdAt: Carbon::parse($legacy->createdAt),
        );
    }

    public function toLegacyPayload(OrderAggregate $aggregate): array
    {
        $reverseMap = array_flip(self::STATUS_MAP);
        return [
            'order_id' => (int) str_replace('LEGACY-', '', $aggregate->id->toString()),
            'status' => $reverseMap[$aggregate->status] ?? 'unknown',
            'total' => $aggregate->totalAmount()->getAmount()->toFloat(),
        ];
    }
}
```

### 3.4 Facade —— 统一调用入口

```php
// app/Services/ACL/OrderServiceFacade.php
class OrderServiceFacade
{
    public function __construct(
        private OrderModelAdapter $adapter,
        private OrderHttpClient $httpClient,
    ) {}

    public function getOrder(int $legacyOrderId): OrderAggregate
    {
        $response = $this->httpClient->get("/api/orders/{$legacyOrderId}");
        $dto = OrderLegacyDTO::fromArray($response->json());
        return $this->adapter->toNewModel($dto);
    }

    public function updateStatus(int $legacyOrderId, OrderAggregate $aggregate): void
    {
        $payload = $this->adapter->toLegacyPayload($aggregate);
        $this->httpClient->put("/api/orders/{$legacyOrderId}", $payload);
    }
}
```

### 3.5 ACL 监控与对比审计

ACL 最大的风险是**静默翻译错误**——新旧模型的字段映射出现偏差，但调用链没有报错。解决方案是在 ACL Facade 中加入实时对比审计：

```php
// app/Services/ACL/Auditors/OrderACLAuditor.php
class OrderACLAuditor
{
    public function __construct(
        private OrderModelAdapter $adapter,
        private MetricsCollector $metrics,
        private LoggerInterface $logger,
    ) {}

    /**
     * 对比单体旧数据和新服务数据，检测字段级偏差
     */
    public function audit(int $legacyOrderId): AuditResult
    {
        // 从单体旧表读取
        $legacyOrder = DB::table('orders')->where('id', $legacyOrderId)->first();

        // 从新服务读取
        $newOrder = $this->orderService->getOrder($legacyOrderId);

        $diffs = [];

        // 金额一致性检查（允许 0.01 漂移）
        $legacyTotal = (float) $legacyOrder->total;
        $newTotal = $newOrder->totalAmount()->getAmount()->toFloat();
        if (abs($legacyTotal - $newTotal) > 0.01) {
            $diffs[] = "total_amount: legacy={$legacyTotal} vs new={$newTotal}";
        }

        // 状态一致性检查
        $legacyStatus = $this->adapter->reverseMapStatus($legacyOrder->status);
        $newStatus = $newOrder->status->value;
        if ($legacyStatus !== $newStatus) {
            $diffs[] = "status: legacy={$legacyStatus} vs new={$newStatus}";
        }

        // 记录指标
        $this->metrics->gauge('acl.audit.diff_count', count($diffs), [
            'module' => 'order',
        ]);

        if (!empty($diffs)) {
            $this->logger->warning('ACL audit mismatch', [
                'order_id' => $legacyOrderId,
                'diffs' => $diffs,
            ]);
        }

        return new AuditResult(
            orderId: $legacyOrderId,
            passed: empty($diffs),
            diffs: $diffs,
        );
    }
}
```

---

## 四、事件驱动双轨策略

ACL 解决了同步调用的隔离问题，但跨服务的**数据一致性**需要异步事件来保证。

### 4.1 双轨运行全景

```
  ┌─────────────────────────────────────────────────────────────┐
  │                     Laravel 单体                            │
  │                                                             │
  │  ┌──────────┐    ┌─────────────┐    ┌───────────────────┐  │
  │  │ Controller│──►│ Domain      │──►│ Event Dispatcher  │  │
  │  │          │   │ Service     │   │                   │  │
  │  └──────────┘   └──────┬──────┘   └────────┬──────────┘  │
  │                        │                    │              │
  │                   写入本地DB           发布到 MQ            │
  │                        │                    │              │
  └────────────────────────┼────────────────────┼──────────────┘
                           │                    │
                   ┌───────┘          ┌─────────┘
                   │                  │
                   ▼                  ▼
  ┌──────────────────┐    ┌─────────────────────────┐
  │   单体 DB        │    │   Kafka / RabbitMQ      │
  │   (订单表)       │    │   orders.events topic   │
  └──────────────────┘    └────────────┬────────────┘
                                       │
                               ┌───────┼───────┐
                               ▼               ▼
                     ┌──────────────┐  ┌──────────────┐
                     │ 订单微服务    │  │ 库存微服务    │
                     │ (消费事件)   │  │ (消费事件)   │
                     └──────────────┘  └──────────────┘
```

### 4.2 单体中发布领域事件

```php
// app/Events/Domain/OrderPlaced.php
class OrderPlaced
{
    public function __construct(
        public readonly int $orderId,
        public readonly string $customerEmail,
        public readonly array $items,
        public readonly float $totalAmount,
        public readonly string $occurredAt,
    ) {}
}

// app/Listeners/PublishOrderPlacedToMessageBroker.php
class PublishOrderPlacedToMessageBroker
{
    public function handle(OrderPlaced $event): void
    {
        $payload = [
            'event_type' => 'order.placed',
            'version' => '1.0',
            'data' => [
                'order_id' => $event->orderId,
                'customer_email' => $event->customerEmail,
                'items' => $event->items,
                'total_amount' => $event->totalAmount,
            ],
            'metadata' => [
                'occurred_at' => $event->occurredAt,
                'source' => 'monolith',
                'correlation_id' => Str::uuid()->toString(),
            ],
        ];

        // 推送到 RabbitMQ
        LaravelRabbitMQ::publish(
            routingKey: 'orders.events',
            body: json_encode($payload),
            properties: [
                'content_type' => 'application/json',
                'message_id' => Str::uuid()->toString(),
            ]
        );
    }
}

// app/Providers/EventServiceProvider.php 中注册
protected $listen = [
    OrderPlaced::class => [
        PublishOrderPlacedToMessageBroker::class,
    ],
    OrderStatusChanged::class => [
        PublishOrderStatusChangedToMessageBroker::class,
    ],
];
```

### 4.3 新服务消费事件

```php
// order-service/app/Consumers/OrderEventConsumer.php
class OrderEventConsumer
{
    public function __construct(
        private OrderProjectionRepository $projections,
        private IdempotencyStore $idempotency,
    ) {}

    public function handle(Message $message): void
    {
        $payload = json_decode($message->body, true);
        $eventId = $payload['metadata']['correlation_id'];

        // 幂等性检查
        if ($this->idempotency->hasBeenProcessed($eventId)) {
            $message->ack();
            return;
        }

        $eventType = $payload['event_type'];
        match ($eventType) {
            'order.placed' => $this->handleOrderPlaced($payload['data']),
            'order.status_changed' => $this->handleStatusChanged($payload['data']),
            default => Log::warning("Unknown event type: {$eventType}"),
        };

        $this->idempotency->markProcessed($eventId);
        $message->ack();
    }

    private function handleOrderPlaced(array $data): void
    {
        $this->projections->create([
            'legacy_order_id' => $data['order_id'],
            'email' => $data['customer_email'],
            'total' => $data['total_amount'],
            'status' => 'confirmed',
            'synced_from' => 'monolith',
        ]);
    }
}
```

---

## 五、数据库迁移策略

### 5.1 三步走

```
阶段 A（共享数据库）          阶段 B（双写）           阶段 C（独立数据库）

  ┌──────────────┐          ┌──────────────┐         ┌──────────────┐
  │   单体 DB    │          │   单体 DB    │         │   单体 DB    │
  │  orders 表   │          │  orders 表   │         │  orders 表   │
  └──────┬───────┘          └──────┬───────┘         └──────────────┘
         │                         │
         │                    ┌────┴────┐
         │                    │ 双写层   │
         │                    └────┬────┘
         │                         │
         ▼                         ▼
  ┌──────────────┐          ┌──────────────┐         ┌──────────────┐
  │ 微服务直连   │          │  订单服务 DB  │         │  订单服务 DB  │
  │ 单体 DB      │          │  (新表结构)   │         │  (新表结构)   │
  └──────────────┘          └──────────────┘         └──────────────┘
```

### 5.2 双写与同步

```php
// app/Services/DataSync/OrderDualWriter.php
class OrderDualWriter
{
    public function update(int $orderId, array $data): void
    {
        // 写入旧库（主）
        DB::table('orders')->where('id', $orderId)->update($data);

        // 异步同步到新库
        dispatch(new SyncOrderToNewDatabase($orderId, $data))
            ->onQueue('data-sync')
            ->afterCommit();
    }
}

// app/Jobs/SyncOrderToNewDatabase.php
class SyncOrderToNewDatabase implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = [10, 30, 60];

    public function handle(OrderHttpClient $client): void
    {
        $client->sync($this->orderId, $this->data);
    }

    public function failed(Throwable $exception): void
    {
        Log::error("Sync failed for order {$this->orderId}", [
            'exception' => $exception->getMessage(),
        ]);
        // 进入人工处理队列
        ManualSyncQueue::dispatch($this->orderId);
    }
}
```

---

## 六、回滚策略与风险控制

每个阶段都需要独立的回滚开关，确保**爆炸半径可控**：

```php
// config/strangler.php
return [
    'phase' => env('STRANGLER_PHASE', 'inactive'), // inactive|shadow|canary|full
    'rollback' => [
        'order_service' => env('STRANGLER_ROLLBACK_ORDER', false),
        'event_streaming' => env('STRANGLER_ROLLBACK_EVENTS', false),
    ],
    'canary' => [
        'percentage' => env('STRANGLER_CANARY_PCT', 5),
    ],
];
```

### 各阶段 Checklist

**阶段一 Checklist**
- [ ] 完成依赖分析（PHPStan / Laravel Telescope）
- [ ] 识别出 ≤3 个候选模块并按耦合度排序
- [ ] 建立模块间接口清单（数据库表 + API + 事件）

**阶段二 Checklist**
- [ ] Nginx 路由分流配置完成并经过压测
- [ ] Feature Flag 系统就绪（如 Laravel Pennant）
- [ ] Shadow 模式：新服务接收请求但不返回响应给用户

**阶段三 Checklist**
- [ ] ACL DTO/Adapter/Facade 单元测试覆盖率 ≥90%
- [ ] 新服务在 Canary 模式下运行 ≥7 天无 P0 故障
- [ ] 监控面板就绪：延迟 P99、错误率、数据一致性对比

**阶段四 Checklist**
- [ ] 事件 Schema 版本化定义完成（CloudEvents 或 Avro）
- [ ] 幂等消费 + 死信队列就绪
- [ ] 端到端数据一致性校验脚本通过

**阶段五 Checklist**
- [ ] 旧代码删除后全量回归测试通过
- [ ] 旧数据库表保留 ≥90 天后方可物理删除
- [ ] 运维 Runbook 更新

## 七、数据一致性校验脚本

双写阶段最容易出问题，下面是一份端到端的一致性校验 Artisan 命令，可定期在凌晨 cron 运行：

```php
// app/Console/Commands/VerifyOrderConsistency.php
class VerifyOrderConsistency extends Command
{
    protected $signature = 'verify:order-consistency
                            {--batch=500 : 每批校验的订单数}
                            {--days=1 : 校验最近 N 天的订单}';

    protected $description = '对比单体 orders 表与新服务订单数据的一致性';

    public function handle(OrderHttpClient $httpClient): int
    {
        $orders = DB::table('orders')
            ->where('created_at', '>=', Carbon::now()->subDays($this->option('days')))
            ->orderBy('id')
            ->get();

        $batch = $this->option('batch');
        $total = $orders->count();
        $mismatches = 0;
        $errors = 0;

        $this->info("Checking {$total} orders...");

        $orders->chunk($batch, function ($chunk) use ($httpClient, &$mismatches, &$errors) {
            foreach ($chunk as $order) {
                try {
                    $remote = $httpClient->get("/api/orders/{$order->id}")->json();

                    $issues = [];

                    // 检查金额
                    if (abs((float) $order->total - (float) ($remote['data']['total_amount'] ?? 0)) > 0.01) {
                        $issues[] = "amount mismatch: local={$order->total} remote={$remote['data']['total_amount']}";
                    }

                    // 检查状态
                    if ($order->status !== ($remote['data']['status'] ?? '')) {
                        $issues[] = "status mismatch: local={$order->status} remote={$remote['data']['status']}";
                    }

                    // 检查是否存在
                    if (!isset($remote['data'])) {
                        $issues[] = 'order not found in new service';
                    }

                    if (!empty($issues)) {
                        $mismatches++;
                        $this->newLine();
                        $this->error("Order #{$order->id}: " . implode('; ', $issues));

                        // 记录到一致性日志表
                        DB::table('consistency_check_log')->insert([
                            'order_id' => $order->id,
                            'issues' => json_encode($issues),
                            'checked_at' => now(),
                        ]);
                    }
                } catch (Throwable $e) {
                    $errors++;
                    Log::error("Consistency check failed for order #{$order->id}", [
                        'error' => $e->getMessage(),
                    ]);
                }

                $this->line('.', 'comment', false);
            }
        });

        $this->newLine(2);
        $this->info("✅ Checked: {$total} | ❌ Mismatches: {$mismatches} | ⚠️ Errors: {$errors}");

        // 如果不一致率超过阈值，发送告警
        $mismatchRate = $total > 0 ? ($mismatches / $total) * 100 : 0;
        if ($mismatchRate > 0.1) {
            Notification::route('slack', config('services.alerts.slack_webhook'))
                ->notify(new ConsistencyAlert($mismatches, $total, $mismatchRate));
        }

        return $mismatches > 0 ? 1 : 0;
    }
}

// 配合数据库迁移
Schema::create('consistency_check_log', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('order_id');
    $table->json('issues');
    $table->timestamp('checked_at');
    $table->timestamps();
});
```

### 7.1 使用 Laravel Pennant 管理 Feature Flag

Laravel 10+ 内置的 Pennant 是管理迁移灰度的理想工具。以下是整合方案：

```php
// app/Providers/PennantServiceProvider.php
use Laravel\Pennant\Feature;

class PennantServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 定义迁移阶段的 Feature Flag
        Feature::define('order-service', function (User $user) {
            // 按用户 ID 百分比灰度
            return Feature::sequential()
                ->for(User::class)
                ->when(
                    fn () => Feature::isActive('order-service-full'),
                    fn () => true, // 全量开关
                    fn () => $user->id % 100 < config('strangler.canary.percentage', 5)
                );
        });

        Feature::define('shadow-order-service', function () {
            return config('strangler.phase') === 'shadow';
        });

        Feature::define('event-streaming', function () {
            return !config('strangler.rollback.event_streaming', false);
        });
    }
}

// 使用示例：在路由中
Route::middleware('throttle:60,1')->group(function () {
    Route::get('/orders/{id}', function (int $id) {
        if (Feature::for(auth()->user())->active('order-service')) {
            // 走新服务
            return app(OrderServiceFacade::class)->getOrder($id);
        }
        // 走单体
        return Order::findOrFail($id);
    })->name('orders.show');
- [ ] 运维 Runbook 更新

---

## 八、常见陷阱

### 8.1 分布式事务

**问题**：订单创建涉及库存扣减 + 支付记录，单体中是本地事务，拆分后变成分布式。

**解决**：采用 Saga 模式，每步操作发布补偿事件。**绝不使用分布式两阶段提交**。

### 8.2 数据一致性窗口

**问题**：事件从单体传播到新服务存在延迟（通常 100ms-2s），期间读取可能不一致。

**解决**：对一致性敏感的读操作，走 ACL 同步路径；对展示类数据，接受最终一致性。

### 8.3 团队协调

**问题**：单体团队和微服务团队对同一张表的 Schema 变更冲突。

**解决**：设立 **Data Contract**，用 Schema Registry 管理表结构变更，任何变更需双方审批。

---

## 九、何时切换轨道——事件驱动 vs ACL？

```
                    ┌─────────────────────────┐
                    │   这个交互是同步的吗？    │
                    └─────────┬───────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
                   是                   否
                    │                    │
                    ▼                    ▼
          ┌─────────────────┐  ┌──────────────────┐
          │ 读多写少？       │  │ 能接受最终一致性？ │
          └────────┬────────┘  └────────┬─────────┘
                   │                    │
          ┌────────┴────────┐          是
          │                │            │
         是               否            ▼
          │                │    ┌──────────────────┐
          ▼                ▼    │ 事件驱动轨道      │
  ┌──────────────┐ ┌──────────────┐ (Kafka/RabbitMQ) │
  │ ACL 同步查询  │ │ ACL 同步命令  │                  │
  │ (只读 Facade) │ │ (写入 Facade)│                  │
  └──────────────┘ └──────────────┘ └──────────────────┘
```

**黄金法则**：用户在等待响应的请求用 ACL，用户不等待的后台处理用事件驱动。

---

## 十、总结

Strangler Fig Pattern 不是一次性的架构决策，而是一个**持续数月的工程实践**。双轨策略的核心价值在于：ACL 给你同步调用的安全感，事件驱动给你异步解耦的弹性。两者互补而非互斥。

迁移成功的关键不是技术方案有多精妙，而是**每一步都有回滚开关**。Feature Flag 控制流量百分比，Shadow Mode 观察行为差异，Canary Release 验证稳定性——这三个机制贯穿始终，才是 Strangler Fig 的真正护城河。

> 记住：绞杀榕之所以成功，不是因为它长得快，而是因为它**每一步都与宿主共存**。你的迁移也应该如此。

---

**参考资源**

- [Martin Fowler - StranglerFigApplication](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [Sam Newman - Building Microservices, Chapter 7: Refactoring to Microservices](https://samnewman.io/books/building_microservices_2nd_edition/)
- [Eric Evans - Domain-Driven Design: Tackling Complexity in the Heart of Software](https://www.domainlanguage.com/ddd/)
- [Chris Richardson - Microservices Patterns: Saga Pattern](https://microservices.io/patterns/data/saga.html)

## 相关阅读

- [Idempotency Key 深度实战：API 幂等性的三层防护](/categories/架构/2026-06-06-Idempotency-Key-深度实战-API幂等性的三层防护/)
- [Prompt Caching 实战：Anthropic/OpenAI 缓存策略对比](/categories/架构/2026-06-06-Prompt-Caching-实战-Anthropic-OpenAI-缓存策略对比-System-Prompt复用-KV-Cache与成本优化/)
- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal](/categories/架构/Saga-编排模式深度实战-Choreography-vs-Orchestration-vs-Temporal-Laravel分布式事务三种实现路线对比/)
