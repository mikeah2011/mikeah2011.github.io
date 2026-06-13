---
title: Anti-Corruption Layer 实战进阶：Laravel 微服务间的防腐层设计——DTO 映射、接口适配与遗留系统隔离的工程化方案
keywords: [Anti, Corruption Layer, Laravel, DTO, 实战进阶, 微服务间的防腐层设计, 映射, 接口适配与遗留系统隔离的工程化方案, 架构]
date: 2026-06-10 02:50:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Anti-Corruption Layer
  - 微服务
  - Laravel
  - DDD
  - DTO
  - 遗留系统
description: 深入探讨 Anti-Corruption Layer（ACL）在 Laravel 微服务架构中的工程化落地，涵盖 DTO 映射、接口适配器、遗留系统隔离策略，以及在真实项目中踩过的坑和解决方案。
---


# Anti-Corruption Layer 实战进阶：Laravel 微服务间的防腐层设计

## 前言

在微服务架构演进过程中，我们不可避免地要面对一个现实：**新服务需要和旧系统打交道**。旧系统的模型设计混乱、接口风格不统一、数据结构充满历史包袱。如果你直接让新服务依赖旧系统的模型和接口，那么旧系统的"坏味道"会像病毒一样蔓延到新服务中——这就是 DDD 中所说的 **"腐败"（Corruption）**。

**Anti-Corruption Layer（ACL，防腐层）** 就是解决这个问题的核心模式。它在两个有界上下文（Bounded Context）之间建立一个翻译层，确保一侧的模型变化不会直接污染另一侧。

本文基于真实 Laravel 微服务项目，从工程化角度深入讲解 ACL 的三种核心实现方式：**DTO 映射**、**接口适配器**和**遗留系统隔离**，以及在实际落地中遇到的问题和解决方案。

---

## 一、为什么需要 Anti-Corruption Layer

### 1.1 遗留系统的"腐败"传导

假设你有一个遗留的订单系统，它的 `Order` 模型长这样：

```php
// 遗留系统：Order 模型（充满历史包袱）
class LegacyOrder extends Model
{
    protected $table = 'orders';
    
    // status 字段用字符串：'0'=待支付, '1'=已支付, '2'=已发货, '3'=已完成, '4'=已取消
    // 字段命名不规范：c_time, u_time, is_del
    // 冗余字段：buyer_name, buyer_phone 直接存在订单表里
}
```

而你的新服务希望使用一个干净的领域模型：

```php
// 新服务：领域模型
class Order
{
    private OrderId $id;
    private OrderStatus $status; // 枚举
    private Money $totalAmount;
    private CustomerSnapshot $customer; // 值对象
    private DateTimeImmutable $createdAt;
}
```

如果没有 ACL，你的新服务代码会变成这样：

```php
// ❌ 没有 ACL：直接依赖遗留系统
class OrderService
{
    public function getOrder(string $id): array
    {
        $legacy = LegacyOrder::find($id);
        
        // 到处是这种恶心的转换逻辑
        return [
            'id' => $legacy->id,
            'status' => match($legacy->status) {
                '0' => 'pending',
                '1' => 'paid',
                '2' => 'shipped',
                '3' => 'completed',
                '4' => 'cancelled',
                default => 'unknown',
            },
            'amount' => $legacy->order_amount / 100, // 分转元
            'customer_name' => $legacy->buyer_name,
            'created_at' => $legacy->c_time,
        ];
    }
}
```

这种代码的问题：
- **转换逻辑散落各处**，每个调用遗留系统的地方都要重复一遍
- **遗留系统一旦改字段名**，所有调用方都要改
- **新服务的领域模型被迫接受遗留系统的"脏数据"**

### 1.2 ACL 的定位

ACL 不是一个具体的类，而是一个**架构层**。它位于两个有界上下文之间，负责：

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  新服务      │     │  Anti-Corruption │     │  遗留系统    │
│  (Clean)     │◄───►│  Layer           │◄───►│  (Legacy)   │
│             │     │  - DTO           │     │             │
│  Order      │     │  - Adapter       │     │  LegacyOrder│
│  OrderStatus│     │  - Translator    │     │  status='0' │
└─────────────┘     └─────────────────┘     └─────────────┘
```

核心职责：
1. **模型翻译**：遗留系统的模型 ↔ 新服务的领域模型
2. **协议适配**：遗留系统的接口协议（SOAP/XML/老旧 REST）→ 新服务的标准协议
3. **数据净化**：过滤遗留系统中的脏数据、空值、异常值
4. **行为封装**：将遗留系统的复杂调用流程封装为简单接口

---

## 二、核心实现一：DTO 映射

### 2.1 定义 DTO（Data Transfer Object）

DTO 是 ACL 的基础。它在两个上下文之间传递数据，隔离内部模型。

```php
// app/Acl/Order/Dto/OrderDTO.php
namespace App\Acl\Order\Dto;

use App\Enum\OrderStatus;
use Money\Money;

final class OrderDTO
{
    public function __construct(
        public readonly string $id,
        public readonly OrderStatus $status,
        public readonly Money $totalAmount,
        public readonly string $customerName,
        public readonly string $customerPhone,
        public readonly \DateTimeImmutable $createdAt,
        public readonly ?\DateTimeImmutable $paidAt,
        public readonly ?\DateTimeImmutable $shippedAt,
        public readonly array $items,
    ) {}

    public static function fromLegacy(array $raw): self
    {
        return new self(
            id: (string) $raw['id'],
            status: self::mapLegacyStatus($raw['status']),
            totalAmount: \Money\Money::CNY($raw['order_amount']),
            customerName: $raw['buyer_name'] ?? '未知',
            customerPhone: $raw['buyer_phone'] ?? '',
            createdAt: new \DateTimeImmutable($raw['c_time']),
            paidAt: $raw['pay_time'] ? new \DateTimeImmutable($raw['pay_time']) : null,
            shippedAt: $raw['ship_time'] ? new \DateTimeImmutable($raw['ship_time']) : null,
            items: array_map(
                fn($item) => OrderItemDTO::fromLegacy($item),
                $raw['items'] ?? []
            ),
        );
    }

    private static function mapLegacyStatus(string $status): OrderStatus
    {
        return match($status) {
            '0' => OrderStatus::Pending,
            '1' => OrderStatus::Paid,
            '2' => OrderStatus::Shipped,
            '3' => OrderStatus::Completed,
            '4' => OrderStatus::Cancelled,
            default => throw new \DomainException("未知的订单状态: {$status}"),
        };
    }
}
```

### 2.2 定义 DTO 之间的嵌套

复杂业务对象通常有嵌套结构，每个子对象也应该有自己的 DTO：

```php
// app/Acl/Order/Dto/OrderItemDTO.php
namespace App\Acl\Order\Dto;

final class OrderItemDTO
{
    public function __construct(
        public readonly string $productId,
        public readonly string $productName,
        public readonly int $quantity,
        public readonly \Money\Money $unitPrice,
        public readonly \Money\Money $subtotal,
    ) {}

    public static function fromLegacy(array $raw): self
    {
        return new self(
            productId: (string) $raw['goods_id'],
            productName: $raw['goods_name'],
            quantity: (int) $raw['num'],
            unitPrice: \Money\Money::CNY($raw['price']),
            subtotal: \Money\Money::CNY($raw['total_price']),
        );
    }
}
```

### 2.3 DTO → 领域模型的转换

DTO 负责从遗留系统"搬运"数据，但最终要转换为领域模型：

```php
// app/Domain/Order/Factory/OrderFactory.php
namespace App\Domain\Order\Factory;

use App\Acl\Order\Dto\OrderDTO;
use App\Domain\Order\Order;
use App\Domain\Order\OrderId;
use App\Domain\Order\CustomerSnapshot;
use App\Domain\Order\OrderItem;

class OrderFactory
{
    public function fromDTO(OrderDTO $dto): Order
    {
        $items = array_map(
            fn($itemDto) => new OrderItem(
                productId: $itemDto->productId,
                productName: $itemDto->productName,
                quantity: $itemDto->quantity,
                unitPrice: $itemDto->unitPrice,
            ),
            $dto->items
        );

        $customer = new CustomerSnapshot(
            name: $dto->customerName,
            phone: $dto->customerPhone,
        );

        return new Order(
            id: OrderId::fromString($dto->id),
            status: $dto->status,
            totalAmount: $dto->totalAmount,
            customer: $customer,
            items: $items,
            createdAt: $dto->createdAt,
        );
    }
}
```

---

## 三、核心实现二：接口适配器

### 3.1 定义防腐层接口

在新服务中定义一个干净的接口，代表"我们希望遗留系统是什么样"：

```php
// app/Acl/Order/Contract/OrderGatewayInterface.php
namespace App\Acl\Order\Contract;

use App\Acl\Order\Dto\OrderDTO;

interface OrderGatewayInterface
{
    public function findById(string $id): ?OrderDTO;
    
    public function findByCustomer(string $customerId, int $page = 1, int $perPage = 20): array;
    
    public function updateStatus(string $id, string $status): bool;
}
```

### 3.2 实现适配器

适配器是 ACL 的核心实现，它封装了与遗留系统交互的所有细节：

```php
// app/Acl/Order/Adapter/LegacyOrderGateway.php
namespace App\Acl\Order\Adapter;

use App\Acl\Order\Contract\OrderGatewayInterface;
use App\Acl\Order\Dto\OrderDTO;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class LegacyOrderGateway implements OrderGatewayInterface
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly int $cacheTtl = 300,
    ) {}

    public function findById(string $id): ?OrderDTO
    {
        $cacheKey = "legacy_order:{$id}";
        
        return Cache::remember($cacheKey, $this->cacheTtl, function () use ($id) {
            $response = Http::withHeaders([
                'Authorization' => "Bearer {$this->apiKey}",
                'Accept' => 'application/json',
            ])
            ->timeout(5)
            ->retry(3, 1000)
            ->get("{$this->baseUrl}/api/v1/orders/{$id}");

            if ($response->successful()) {
                $data = $response->json('data');
                
                if (empty($data)) {
                    return null;
                }

                // 补充订单项（遗留系统接口不返回嵌套数据，需要单独查询）
                $items = $this->fetchOrderItems($id);
                $data['items'] = $items;

                return OrderDTO::fromLegacy($data);
            }

            if ($response->status() === 404) {
                return null;
            }

            throw new \RuntimeException(
                "遗留订单系统异常: {$response->status()} - {$response->body()}"
            );
        });
    }

    public function findByCustomer(string $customerId, int $page = 1, int $perPage = 20): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
        ])
        ->timeout(10)
        ->retry(3, 1000)
        ->get("{$this->baseUrl}/api/v1/orders", [
            'buyer_id' => $customerId,
            'page' => $page,
            'page_size' => $perPage,
        ]);

        if (!$response->successful()) {
            throw new \RuntimeException(
                "查询客户订单失败: {$response->status()}"
            );
        }

        $orders = $response->json('data.list', []);
        
        return array_map(
            fn($raw) => OrderDTO::fromLegacy($raw),
            $orders
        );
    }

    public function updateStatus(string $id, string $status): bool
    {
        // 遗留系统用数字状态，需要转换
        $legacyStatus = $this->mapToLegacyStatus($status);

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
        ])
        ->timeout(5)
        ->retry(2, 1000)
        ->put("{$this->baseUrl}/api/v1/orders/{$id}/status", [
            'status' => $legacyStatus,
        ]);

        if ($response->successful()) {
            // 清除缓存
            Cache::forget("legacy_order:{$id}");
            return true;
        }

        return false;
    }

    /**
     * 遗留系统的订单项需要单独接口查询
     */
    private function fetchOrderItems(string $orderId): array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
        ])
        ->timeout(5)
        ->retry(3, 1000)
        ->get("{$this->baseUrl}/api/v1/orders/{$orderId}/items");

        if (!$response->successful()) {
            return [];
        }

        return $response->json('data', []);
    }

    private function mapToLegacyStatus(string $status): string
    {
        return match($status) {
            'pending' => '0',
            'paid' => '1',
            'shipped' => '2',
            'completed' => '3',
            'cancelled' => '4',
            default => throw new \InvalidArgumentException("无法映射状态: {$status}"),
        };
    }
}
```

### 3.3 通过 ServiceProvider 注册

```php
// app/Providers/AclServiceProvider.php
namespace App\Providers;

use App\Acl\Order\Contract\OrderGatewayInterface;
use App\Acl\Order\Adapter\LegacyOrderGateway;
use Illuminate\Support\ServiceProvider;

class AclServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderGatewayInterface::class, function ($app) {
            return new LegacyOrderGateway(
                baseUrl: config('services.legacy_order.url'),
                apiKey: config('services.legacy_order.api_key'),
                cacheTtl: config('services.legacy_order.cache_ttl', 300),
            );
        });
    }
}
```

配置文件：

```php
// config/services.php
return [
    // ...
    'legacy_order' => [
        'url' => env('LEGACY_ORDER_URL', 'http://legacy-order.internal:8080'),
        'api_key' => env('LEGACY_ORDER_API_KEY'),
        'cache_ttl' => (int) env('LEGACY_ORDER_CACHE_TTL', 300),
    ],
];
```

### 3.4 在应用层使用

```php
// app/Service/OrderService.php
namespace App\Service;

use App\Acl\Order\Contract\OrderGatewayInterface;
use App\Domain\Order\Factory\OrderFactory;

class OrderService
{
    public function __construct(
        private readonly OrderGatewayInterface $orderGateway,
        private readonly OrderFactory $orderFactory,
    ) {}

    public function getOrderDetail(string $orderId): ?array
    {
        $dto = $this->orderGateway->findById($orderId);
        
        if (!$dto) {
            return null;
        }

        $order = $this->orderFactory->fromDTO($dto);

        return [
            'id' => $order->getId()->getValue(),
            'status' => $order->getStatus()->getLabel(),
            'total' => $order->getTotalAmount()->getAmount() / 100,
            'customer' => $order->getCustomer()->getName(),
            'items_count' => count($order->getItems()),
            'created_at' => $order->getCreatedAt()->format('Y-m-d H:i:s'),
        ];
    }
}
```

---

## 四、核心实现三：遗留系统隔离

### 4.1 隔离策略

对于真正老旧的系统（比如 SOAP 服务、CORBA、甚至直接读数据库），我们需要更强的隔离：

```php
// app/Acl/Legacy/Isolation/LegacySystemProxy.php
namespace App\Acl\Legacy\Isolation;

use Illuminate\Support\Facades\Log;

class LegacySystemProxy
{
    private int $circuitBreakerThreshold;
    private int $circuitBreakerResetSeconds;
    
    public function __construct(
        private readonly string $systemName,
        private readonly int $failureThreshold = 5,
        private readonly int $resetTimeout = 60,
    ) {
        $this->circuitBreakerThreshold = $failureThreshold;
        $this->circuitBreakerResetSeconds = $resetTimeout;
    }

    /**
     * 带熔断的调用包装
     */
    public function call(callable $operation, mixed $fallback = null): mixed
    {
        $circuitKey = "circuit:{$this->systemName}";
        $failureKey = "circuit_failures:{$this->systemName}";

        // 检查熔断器状态
        if (cache()->get($circuitKey) === 'open') {
            Log::warning("遗留系统 [{$this->systemName}] 熔断器开启，使用降级方案");
            return $fallback instanceof \Closure ? $fallback() : $fallback;
        }

        try {
            $result = $operation();
            
            // 成功则重置失败计数
            cache()->forget($failureKey);
            
            return $result;
        } catch (\Exception $e) {
            $failures = cache()->increment($failureKey);
            
            Log::error("遗留系统 [{$this->systemName}] 调用失败", [
                'failures' => $failures,
                'error' => $e->getMessage(),
            ]);

            if ($failures >= $this->circuitBreakerThreshold) {
                cache()->put($circuitKey, 'open', $this->circuitBreakerResetSeconds);
                
                Log::critical("遗留系统 [{$this->systemName}] 熔断器触发", [
                    'failures' => $failures,
                    'reset_after' => $this->circuitBreakerResetSeconds,
                ]);
            }

            if ($fallback !== null) {
                return $fallback instanceof \Closure ? $fallback() : $fallback;
            }

            throw $e;
        }
    }
}
```

### 4.2 数据库直连的防腐层

有些遗留系统没有 API，只能直接读数据库。这时候 ACL 要封装数据库连接本身：

```php
// app/Acl/Legacy/Adapter/LegacyDbAdapter.php
namespace App\Acl\Legacy\Adapter;

use Illuminate\Support\Facades\DB;

class LegacyDbAdapter
{
    private $connection;

    public function __construct(
        private readonly string $connectionName = 'legacy_mysql',
    ) {
        $this->connection = DB::connection($connectionName);
    }

    /**
     * 查询遗留系统订单（直接读库）
     */
    public function findOrderById(string $id): ?array
    {
        $row = $this->connection
            ->table('orders')
            ->where('id', $id)
            ->where('is_del', 0)  // 遗留系统用软删除标记
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'id' => (string) $row->id,
            'status' => (string) $row->status,
            'order_amount' => (int) $row->order_amount,
            'buyer_name' => $row->buyer_name ?? '',
            'buyer_phone' => $row->buyer_phone ?? '',
            'c_time' => $row->c_time,
            'pay_time' => $row->pay_time,
            'ship_time' => $row->ship_time,
            'items' => $this->fetchItems($id),
        ];
    }

    private function fetchItems(string $orderId): array
    {
        return $this->connection
            ->table('order_items')
            ->where('order_id', $orderId)
            ->where('is_del', 0)
            ->get()
            ->map(fn($row) => [
                'goods_id' => (string) $row->goods_id,
                'goods_name' => $row->goods_name,
                'num' => (int) $row->num,
                'price' => (int) $row->price,
                'total_price' => (int) $row->total_price,
            ])
            ->toArray();
    }

    /**
     * 健康检查
     */
    public function healthCheck(): bool
    {
        try {
            $this->connection->select('SELECT 1');
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }
}
```

### 4.3 数据库配置

```php
// config/database.php (部分)
return [
    'connections' => [
        // ...
        'legacy_mysql' => [
            'driver' => 'mysql',
            'host' => env('LEGACY_DB_HOST', '127.0.0.1'),
            'port' => env('LEGACY_DB_PORT', '3306'),
            'database' => env('LEGACY_DB_DATABASE'),
            'username' => env('LEGACY_DB_USERNAME'),
            'password' => env('LEGACY_DB_PASSWORD'),
            'charset' => 'utf8mb4',
            'options' => [
                \PDO::ATTR_TIMEOUT => 5,
            ],
        ],
    ],
];
```

---

## 五、进阶模式

### 5.1 双写迁移策略

在从遗留系统迁移到新系统的过程中，经常需要双写。ACL 可以封装双写逻辑：

```php
// app/Acl/Order/Migration/DualWriteOrderGateway.php
namespace App\Acl\Order\Migration;

use App\Acl\Order\Contract\OrderGatewayInterface;
use App\Acl\Order\Dto\OrderDTO;
use Illuminate\Support\Facades\Log;

class DualWriteOrderGateway implements OrderGatewayInterface
{
    public function __construct(
        private readonly OrderGatewayInterface $legacyGateway,
        private readonly OrderGatewayInterface $newGateway,
        private readonly string $readSource = 'legacy', // legacy | new | compare
    ) {}

    public function findById(string $id): ?OrderDTO
    {
        return match($this->readSource) {
            'legacy' => $this->legacyGateway->findById($id),
            'new' => $this->newGateway->findById($id),
            'compare' => $this->compareRead($id),
        };
    }

    public function findByCustomer(string $customerId, int $page = 1, int $perPage = 20): array
    {
        return $this->legacyGateway->findByCustomer($customerId, $page, $perPage);
    }

    public function updateStatus(string $id, string $status): bool
    {
        // 双写：先写新系统，再写旧系统
        $newResult = $this->newGateway->updateStatus($id, $status);
        $legacyResult = $this->legacyGateway->updateStatus($id, $status);

        if ($newResult !== $legacyResult) {
            Log::warning("双写结果不一致", [
                'order_id' => $id,
                'status' => $status,
                'new_result' => $newResult,
                'legacy_result' => $legacyResult,
            ]);
        }

        // 以新系统结果为准
        return $newResult;
    }

    private function compareRead(string $id): ?OrderDTO
    {
        $legacy = $this->legacyGateway->findById($id);
        $new = $this->newGateway->findById($id);

        if ($legacy && $new) {
            $this->logDiff($id, $legacy, $new);
        }

        return $new ?? $legacy;
    }

    private function logDiff(string $id, OrderDTO $legacy, OrderDTO $new): void
    {
        $diffs = [];
        
        if ($legacy->status !== $new->status) {
            $diffs['status'] = ['legacy' => $legacy->status->value, 'new' => $new->status->value];
        }
        if (!$legacy->totalAmount->equals($new->totalAmount)) {
            $diffs['totalAmount'] = [
                'legacy' => $legacy->totalAmount->getAmount(),
                'new' => $new->totalAmount->getAmount(),
            ];
        }

        if (!empty($diffs)) {
            Log::info("ACL 数据对比差异", [
                'order_id' => $id,
                'diffs' => $diffs,
            ]);
        }
    }
}
```

### 5.2 事件驱动的 ACL

当遗留系统支持 Webhook 或消息队列时，ACL 可以将事件翻译为领域事件：

```php
// app/Acl/Order/EventTranslator/LegacyEventTranslator.php
namespace App\Acl\Order\EventTranslator;

use App\Domain\Order\Event\OrderPaid;
use App\Domain\Order\Event\OrderShipped;
use App\Domain\Order\Event\OrderCancelled;
use App\Domain\Order\OrderId;

class LegacyEventTranslator
{
    /**
     * 将遗留系统的事件翻译为领域事件
     */
    public function translate(array $legacyEvent): ?object
    {
        return match($legacyEvent['event_type']) {
            'order_paid' => new OrderPaid(
                orderId: OrderId::fromString($legacyEvent['order_id']),
                paidAt: new \DateTimeImmutable($legacyEvent['pay_time']),
                amount: \Money\Money::CNY($legacyEvent['pay_amount']),
            ),
            'order_shipped' => new OrderShipped(
                orderId: OrderId::fromString($legacyEvent['order_id']),
                trackingNumber: $legacyEvent['tracking_no'] ?? '',
                shippedAt: new \DateTimeImmutable($legacyEvent['ship_time']),
            ),
            'order_cancelled' => new OrderCancelled(
                orderId: OrderId::fromString($legacyEvent['order_id']),
                reason: $legacyEvent['cancel_reason'] ?? '用户取消',
            ),
            default => null, // 未知事件静默忽略
        };
    }
}
```

---

## 六、踩坑记录

### 坑 1：DTO 转换时的空值处理

遗留系统最大的特点就是**数据不完整**。很多字段在某些记录中是 `null`、空字符串、甚至非法值。

```php
// ❌ 错误：直接转换，遇到 null 就炸
$createdAt = new \DateTimeImmutable($raw['c_time']);

// ✅ 正确：防御性转换
$createdAt = isset($raw['c_time']) && $raw['c_time']
    ? new \DateTimeImmutable($raw['c_time'])
    : new \DateTimeImmutable('2020-01-01'); // 给个合理的默认值
```

**建议：在 DTO 的 `fromLegacy` 方法中，统一做空值处理，不要信任遗留系统的任何字段。**

### 坑 2：金额精度问题

遗留系统经常用整数存金额（分），新系统可能用小数（元）。转换时要注意精度：

```php
// ❌ 错误：浮点数精度丢失
$amount = $raw['order_amount'] / 100; // 1999 / 100 = 19.990000000000002

// ✅ 正确：使用 Money 库
$amount = \Money\Money::CNY($raw['order_amount']); // 整数分，不丢失精度

// 如果必须用浮点数：
$amount = round($raw['order_amount'] / 100, 2);
```

### 坑 3：遗留系统接口超时

遗留系统通常性能差、不稳定。ACL 必须做好超时和重试：

```php
// ❌ 错误：无超时，可能挂起
$response = Http::get($legacyUrl);

// ✅ 正确：设置超时和重试
$response = Http::timeout(5)
    ->retry(3, 1000, function ($exception, $request) {
        // 只对连接超时和 5xx 错误重试
        return $exception instanceof \Illuminate\Http\Client\ConnectionException
            || ($exception->response && $exception->response->serverError());
    })
    ->get($legacyUrl);
```

### 坑 4：缓存一致性

ACL 缓存了遗留系统的数据，但遗留系统更新后缓存可能过期：

```php
// 遗留系统发来 Webhook 通知订单状态变更
public function handleOrderStatusChanged(array $event): void
{
    $orderId = $event['order_id'];
    
    // 立即清除缓存，下次读取会重新拉取
    Cache::forget("legacy_order:{$orderId}");
    
    // 可选：预热缓存
    $this->orderGateway->findById($orderId);
}
```

### 坑 5：遗留系统的事务性缺失

遗留系统可能不支持事务，ACL 需要设计补偿机制：

```php
// app/Acl/Order/Adapter/CompensatingOrderGateway.php
public function updateWithCompensation(string $id, array $changes): bool
{
    // 保存原始状态用于回滚
    $original = $this->legacyGateway->findById($id);
    
    try {
        // 执行更新
        foreach ($changes as $field => $value) {
            $this->legacyGateway->updateField($id, $field, $value);
        }
        
        return true;
    } catch (\Exception $e) {
        // 补偿：回滚到原始状态
        Log::error("更新失败，执行补偿回滚", ['order_id' => $id]);
        
        foreach ($changes as $field => $value) {
            try {
                $this->legacyGateway->updateField(
                    $id, 
                    $field, 
                    $original->{$field}
                );
            } catch (\Exception $rollbackException) {
                Log::critical("补偿回滚失败", [
                    'order_id' => $id,
                    'field' => $field,
                    'error' => $rollbackException->getMessage(),
                ]);
            }
        }
        
        throw $e;
    }
}
```

---

## 七、测试策略

### 7.1 使用 Mock 测试 ACL

ACL 的核心价值之一是**可测试性**。通过接口隔离，我们可以 Mock 遗留系统：

```php
// tests/Unit/Acl/OrderGatewayTest.php
namespace Tests\Unit\Acl;

use App\Acl\Order\Contract\OrderGatewayInterface;
use App\Acl\Order\Dto\OrderDTO;
use App\Domain\Order\Factory\OrderFactory;
use App\Service\OrderService;
use Tests\TestCase;

class OrderGatewayTest extends TestCase
{
    public function test_get_order_detail_with_mock(): void
    {
        // 创建 Mock
        $mockGateway = $this->createMock(OrderGatewayInterface::class);
        $mockGateway->method('findById')
            ->with('123')
            ->willReturn(new OrderDTO(
                id: '123',
                status: \App\Enum\OrderStatus::Paid,
                totalAmount: \Money\Money::CNY(199900),
                customerName: '张三',
                customerPhone: '13800138000',
                createdAt: new \DateTimeImmutable('2026-06-01 10:00:00'),
                paidAt: new \DateTimeImmutable('2026-06-01 10:05:00'),
                shippedAt: null,
                items: [],
            ));

        $factory = new OrderFactory();
        $service = new OrderService($mockGateway, $factory);

        $result = $service->getOrderDetail('123');

        $this->assertNotNull($result);
        $this->assertEquals('已支付', $result['status']);
        $this->assertEquals(1999.0, $result['total']);
    }
}
```

### 7.2 集成测试真实遗留系统

```php
// tests/Integration/LegacyOrderGatewayTest.php
namespace Tests\Integration;

use App\Acl\Order\Adapter\LegacyOrderGateway;
use Tests\TestCase;

class LegacyOrderGatewayTest extends TestCase
{
    private LegacyOrderGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        
        $this->gateway = new LegacyOrderGateway(
            baseUrl: config('services.legacy_order.url'),
            apiKey: config('services.legacy_order.api_key'),
        );
    }

    public function test_find_existing_order(): void
    {
        // 使用一个已知存在的测试订单
        $dto = $this->gateway->findById('TEST_ORDER_001');
        
        $this->assertNotNull($dto);
        $this->assertEquals('TEST_ORDER_001', $dto->id);
    }

    public function test_find_nonexistent_order(): void
    {
        $dto = $this->gateway->findById('NONEXISTENT_999');
        
        $this->assertNull($dto);
    }
}
```

---

## 八、总结

### 8.1 ACL 适用场景

| 场景 | 是否需要 ACL | 理由 |
|------|-------------|------|
| 新服务对接遗留系统 | ✅ 必须 | 隔离技术债 |
| 微服务间模型差异大 | ✅ 推荐 | 避免模型耦合 |
| 临时对接第三方 API | ✅ 推荐 | 第三方变更不影响核心逻辑 |
| 同一团队的同质服务 | ❌ 不需要 | 过度设计 |
| 性能要求极高的内部调用 | ⚠️ 权衡 | ACL 有额外开销 |

### 8.2 核心原则

1. **ACL 是一个层，不是一个类**：它包含 DTO、Adapter、Translator 等多个组件
2. **在新服务侧定义接口**：不要让遗留系统的接口设计影响新服务
3. **DTO 只搬运数据，不包含业务逻辑**：业务逻辑属于领域模型
4. **防御性编程**：永远不信任遗留系统的数据质量
5. **可测试性是首要目标**：通过接口隔离，让 ACL 可以被 Mock

### 8.3 文件结构参考

```
app/
├── Acl/
│   └── Order/
│       ├── Contract/           # 接口定义
│       │   └── OrderGatewayInterface.php
│       ├── Adapter/            # 适配器实现
│       │   └── LegacyOrderGateway.php
│       ├── Dto/                # 数据传输对象
│       │   ├── OrderDTO.php
│       │   └── OrderItemDTO.php
│       ├── EventTranslator/    # 事件翻译器
│       │   └── LegacyEventTranslator.php
│       └── Migration/          # 迁移相关的双写逻辑
│           └── DualWriteOrderGateway.php
├── Domain/
│   └── Order/
│       ├── Factory/            # DTO → 领域模型的转换
│       │   └── OrderFactory.php
│       ├── Order.php           # 领域模型
│       └── Event/              # 领域事件
│           ├── OrderPaid.php
│           └── OrderShipped.php
└── Service/
    └── OrderService.php        # 应用层服务
```

ACL 的设计看似增加了代码量，但在项目演进过程中，它带来的**隔离性**和**可维护性**会远远超过初始投入。特别是当遗留系统频繁变更、团队需要独立迭代时，ACL 的价值会愈发明显。

---

> **下一篇预告**：Event Sourcing 与 CQRS 在 Laravel 中的落地实践——从事件存储到读写分离的完整方案。
