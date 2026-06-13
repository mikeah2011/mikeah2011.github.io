---

title: Strangler Fig Pattern 实战：Laravel 单体到微服务的渐进式迁移——用 Anti-Corruption Layer 隔离遗留系统
keywords: [Strangler Fig Pattern, Laravel, Anti, Corruption Layer, 单体到微服务的渐进式迁移, 隔离遗留系统]
date: 2026-06-02 00:00:00
tags:
- Strangler Fig
- 微服务
- Laravel
- 架构迁移
- Anti-Corruption Layer
categories:
- php
description: Strangler Fig Pattern（绞杀者模式）实战指南，以 Laravel B2C 电商系统为例详解从单体到微服务的渐进式迁移。涵盖 Bounded Context 领域边界识别与拓扑排序迁移顺序、Nginx/Laravel 中间件双层路由分流、Feature Flag 灰度放量策略（canary/百分比/全量）、Anti-Corruption Layer 数据模型翻译器与适配器实现、全量+增量数据迁移与一致性校验、1%→10%→50%→100% 分阶段切流、自动回滚判断与监控指标体系。附完整迁移 Checklist 与反模式警示，适合需要在不停机前提下将 Laravel 单体拆分为微服务的团队参考。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---




# Strangler Fig Pattern 实战：Laravel 单体到微服务的渐进式迁移——用 Anti-Corruption Layer 隔离遗留系统

## 前言

当一个 Laravel 单体应用随着业务增长变得越来越臃肿，团队开始考虑将其拆分为微服务时，最容易犯的错误就是"大爆炸式重写"（Big-Bang Rewrite）。这种做法风险极高——你需要同时维护旧系统和新系统，业务不能停，团队压力巨大，最终往往以失败告终。

Strangler Fig Pattern（绞杀者模式）提供了一种更安全的渐进式迁移策略。它得名于热带雨林中的绞杀榕——这种植物从宿主树的根部开始生长，逐渐包裹并替代宿主树，最终取而代之。

本文将以一个真实的 Laravel B2C 电商系统为例，详细讲解如何使用 Strangler Fig Pattern 结合 Anti-Corruption Layer（ACL），将单体应用逐步拆分为微服务。

## 一、Strangler Fig Pattern 原理

### 1.1 模式核心思想

Strangler Fig Pattern 的核心思想是：

1. **不破坏现有系统**：旧代码继续运行，业务不受影响
2. **渐进式替换**：每次只迁移一个功能模块
3. **路由层分流**：通过代理层将请求路由到新服务或旧系统
4. **可回滚**：任何一步都可以安全回退

```
阶段 1：初始状态
┌─────────────────────────────────────┐
│           Laravel Monolith          │
│  ┌──────┬──────┬──────┬──────┐     │
│  │ 用户 │ 订单 │ 商品 │ 支付 │     │
│  └──────┴──────┴──────┴──────┘     │
└─────────────────────────────────────┘

阶段 2：开始绞杀（引入代理层）
┌─────────────────────────────────────────┐
│              API Gateway / Nginx         │
│         ┌──────────┴──────────┐          │
│         ▼                     ▼          │
│  ┌──────────────┐    ┌──────────────┐    │
│  │ Laravel      │    │ User Service │    │
│  │ Monolith     │    │ (New)        │    │
│  │ ┌────┬────┐  │    │              │    │
│  │ │订单│商品│  │    └──────────────┘    │
│  │ │支付│    │  │                         │
│  │ └────┴────┘  │                         │
│  └──────────────┘                         │
└─────────────────────────────────────────┘

阶段 3：逐步迁移完成
┌─────────────────────────────────────────────────────┐
│                    API Gateway                        │
│  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐        │
│  │ User  │  │ Order │  │ Item  │  │ Pay   │        │
│  │ Svc   │  │ Svc   │  │ Svc   │  │ Svc   │        │
│  └───────┘  └───────┘  └───────┘  └───────┘        │
│                                                      │
│  ┌──────────────┐                                    │
│  │ Laravel      │  ← 仅保留复杂业务逻辑              │
│  │ (Thin)       │                                    │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

### 1.2 迁移步骤

1. **识别边界上下文（Bounded Context）**：确定哪些模块可以独立
2. **建立路由层**：在 Nginx/API Gateway 层做请求分流
3. **构建 Anti-Corruption Layer**：隔离新旧系统的数据模型
4. **逐模块迁移**：每次迁移一个模块，验证后再迁移下一个
5. **清理旧代码**：所有模块迁移完成后，移除旧代码

### 1.3 何时该用 Strangler Fig

**适合使用的情况**：
- 单体应用仍在正常运行，业务不能中断
- 团队规模有限，无法同时维护两套完整系统
- 需要逐步验证微服务架构的可行性
- 存在明确的模块边界可以拆分

**不适合的情况**：
- 单体应用已经无法维护，bug 层出不穷
- 所有模块高度耦合，无法识别边界
- 团队对微服务架构完全没有经验

## 二、识别边界上下文

### 2.1 领域分析

以 B2C 电商系统为例，我们识别以下 Bounded Context：

```php
<?php

// 通过分析 Laravel 路由和模型依赖，识别领域边界

// routes/api.php 中的路由分组
Route::prefix('users')->group(function () {
    Route::post('/register', [UserController::class, 'register']);
    Route::post('/login', [UserController::class, 'login']);
    Route::get('/profile', [UserController::class, 'profile']);
    Route::put('/profile', [UserController::class, 'updateProfile']);
    Route::get('/addresses', [UserController::class, 'addresses']);
});

Route::prefix('items')->group(function () {
    Route::get('/', [ItemController::class, 'index']);
    Route::get('/{id}', [ItemController::class, 'show']);
    Route::get('/{id}/reviews', [ItemController::class, 'reviews']);
    Route::get('/search', [SearchController::class, 'search']);
});

Route::prefix('orders')->group(function () {
    Route::post('/', [OrderController::class, 'create']);
    Route::get('/', [OrderController::class, 'index']);
    Route::get('/{id}', [OrderController::class, 'show']);
    Route::post('/{id}/pay', [PaymentController::class, 'pay']);
    Route::post('/{id}/cancel', [OrderController::class, 'cancel']);
});
```

### 2.2 模块依赖分析

```php
<?php

/**
 * 分析模块间的依赖关系
 * 
 * 用户模块 ← 订单模块（订单需要用户信息）
 * 商品模块 ← 订单模块（订单需要商品信息）
 * 订单模块 ← 支付模块（支付需要订单信息）
 * 用户模块 ← 支付模块（支付需要用户信息）
 * 
 * 迁移顺序建议：
 * 1. 用户模块（被依赖最多，先独立出来）
 * 2. 商品模块
 * 3. 支付模块
 * 4. 订单模块（依赖最多，最后迁移）
 */

// 分析 Model 依赖
class DependencyAnalyzer
{
    /**
     * 分析 Eloquent 模型的关联关系
     */
    public function analyzeModelDependencies(): array
    {
        $models = [
            'User' => ['orders', 'addresses', 'reviews', 'payments'],
            'Order' => ['user', 'items', 'payments', 'shippingAddress'],
            'Item' => ['category', 'brand', 'reviews', 'images'],
            'Payment' => ['order', 'user'],
            'Review' => ['user', 'item'],
        ];
        
        $dependencyGraph = [];
        
        foreach ($models as $model => $relations) {
            $dependencyGraph[$model] = [];
            foreach ($relations as $relation) {
                $relatedModel = $this->relationToModel($relation);
                if ($relatedModel) {
                    $dependencyGraph[$model][] = $relatedModel;
                }
            }
        }
        
        return $dependencyGraph;
    }
    
    /**
     * 确定迁移顺序（拓扑排序）
     */
    public function determineMigrationOrder(array $graph): array
    {
        $inDegree = [];
        foreach ($graph as $node => $deps) {
            if (!isset($inDegree[$node])) {
                $inDegree[$node] = 0;
            }
            foreach ($deps as $dep) {
                if (!isset($inDegree[$dep])) {
                    $inDegree[$dep] = 0;
                }
                $inDegree[$dep]++;
            }
        }
        
        $queue = [];
        foreach ($inDegree as $node => $degree) {
            if ($degree === 0) {
                $queue[] = $node;
            }
        }
        
        $order = [];
        while (!empty($queue)) {
            $node = array_shift($queue);
            $order[] = $node;
            
            if (isset($graph[$node])) {
                foreach ($graph[$node] as $dep) {
                    $inDegree[$dep]--;
                    if ($inDegree[$dep] === 0) {
                        $queue[] = $dep;
                    }
                }
            }
        }
        
        return $order;
    }
}
```

## 三、路由层分流

### 3.1 Nginx 路由配置

在 Nginx 层实现请求分流，这是 Strangler Fig 的第一道关卡：

```nginx
# /etc/nginx/conf.d/ecommerce.conf

upstream monolith {
    server 127.0.0.1:8000;
}

upstream user_service {
    server 127.0.0.1:8001;
}

upstream item_service {
    server 127.0.0.1:8002;
}

upstream order_service {
    server 127.0.0.1:8003;
}

server {
    listen 80;
    server_name api.example.com;
    
    # 用户服务路由（已迁移到微服务）
    location /api/v1/users {
        proxy_pass http://user_service;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-ID $request_id;
    }
    
    # 商品服务路由（已迁移到微服务）
    location /api/v1/items {
        proxy_pass http://item_service;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-ID $request_id;
    }
    
    # 订单服务路由（仍在单体中）
    location /api/v1/orders {
        proxy_pass http://monolith;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-ID $request_id;
    }
    
    # 其他请求路由到单体
    location /api/ {
        proxy_pass http://monolith;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

### 3.2 Laravel 中间件分流

在 Laravel 内部，可以通过中间件实现更细粒度的分流：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 微服务路由中间件
 * 根据配置决定将请求转发到新服务还是旧系统
 */
class MicroserviceRoutingMiddleware
{
    /**
     * 已迁移的路由映射
     */
    protected array $migratedRoutes = [
        'api.users.*' => [
            'service' => 'user-service',
            'base_url' => 'http://user-service:8001',
        ],
        'api.items.*' => [
            'service' => 'item-service',
            'base_url' => 'http://item-service:8002',
        ],
    ];
    
    public function handle(Request $request, Closure $next): Response
    {
        $routeName = $request->route()?->getName();
        
        foreach ($this->migratedRoutes as $pattern => $config) {
            if ($this->routeMatches($routeName, $pattern)) {
                // 使用 Feature Flag 控制是否转发
                if ($this->shouldForward($config['service'])) {
                    return $this->forwardToService($request, $config);
                }
                
                break;
            }
        }
        
        return $next($request);
    }
    
    /**
     * 检查路由是否匹配
     */
    protected function routeMatches(?string $routeName, string $pattern): bool
    {
        if (!$routeName) {
            return false;
        }
        
        $regex = '/^' . str_replace('*', '.*', $pattern) . '$/';
        return preg_match($regex, $routeName) === 1;
    }
    
    /**
     * 使用 Feature Flag 判断是否转发
     */
    protected function shouldForward(string $service): bool
    {
        return config("features.forward_to_{$service}", false);
    }
    
    /**
     * 转发请求到微服务
     */
    protected function forwardToService(Request $request, array $config): Response
    {
        $client = app(\Illuminate\Http\Client\Factory::class);
        
        $method = strtolower($request->method());
        $url = $config['base_url'] . $request->path();
        
        $response = $client->withHeaders([
            'X-Forwarded-For' => $request->ip(),
            'X-Request-ID' => $request->header('X-Request-ID', uniqid()),
            'Authorization' => $request->header('Authorization'),
            'Accept' => 'application/json',
        ])->$method($url, $request->except('_token'));
        
        return response(
            $response->body(),
            $response->status(),
            $response->headers()
        );
    }
}
```

### 3.3 Feature Flag 配置

使用 Laravel Pennant 或自定义配置来控制分流比例：

```php
<?php

// config/features.php
return [
    /*
    |--------------------------------------------------------------------------
    | 微服务路由 Feature Flags
    |--------------------------------------------------------------------------
    |
    | 控制各模块的流量转发比例
    | 0 = 全部走单体, 100 = 全部走微服务
    |
    */
    
    'forward_to_user_service' => env('FEATURE_FORWARD_USER', false),
    'forward_to_item_service' => env('FEATURE_FORWARD_ITEM', false),
    'forward_to_order_service' => env('FEATURE_FORWARD_ORDER', false),
    
    /*
    | 灰度放量策略
    | canary = 仅测试用户
    | percentage = 按百分比放量
    | full = 全量
    */
    'user_service_rollout_strategy' => env('USER_ROLLOUT_STRATEGY', 'canary'),
    'user_service_rollout_percentage' => env('USER_ROLLOUT_PERCENTAGE', 0),
];
```

```php
<?php

namespace App\Services\FeatureFlags;

use Illuminate\Support\Facades\Cache;

class RolloutManager
{
    /**
     * 判断用户是否在灰度范围内
     */
    public function shouldUseNewService(string $service, ?int $userId = null): bool
    {
        $strategy = config("features.{$service}_rollout_strategy", 'canary');
        
        return match ($strategy) {
            'canary' => $this->isCanaryUser($userId),
            'percentage' => $this->isInPercentage($service, $userId),
            'full' => true,
            default => false,
        };
    }
    
    /**
     * 判断是否为灰度测试用户
     */
    protected function isCanaryUser(?int $userId): bool
    {
        if (!$userId) {
            return false;
        }
        
        $canaryUserIds = config('features.canary_user_ids', []);
        return in_array($userId, $canaryUserIds);
    }
    
    /**
     * 按百分比放量
     */
    protected function isInPercentage(string $service, ?int $userId): bool
    {
        if (!$userId) {
            return false;
        }
        
        $percentage = config("features.{$service}_rollout_percentage", 0);
        
        // 使用用户 ID 的哈希值确保同一用户始终走同一路径
        $hash = crc32($userId . $service);
        $bucket = abs($hash) % 100;
        
        return $bucket < $percentage;
    }
}
```

## 四、Anti-Corruption Layer（ACL）实现

### 4.1 ACL 的概念

Anti-Corruption Layer 是 Strangler Fig Pattern 中最重要的概念之一。它位于新旧系统之间，负责：

1. **数据模型转换**：将旧系统的数据模型转换为新系统的数据模型
2. **协议适配**：将旧系统的 API 协议适配为新系统的协议
3. **业务规则隔离**：防止旧系统的业务规则侵入新系统

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  New Service    │     │       ACL       │     │  Legacy System  │
│                 │     │                 │     │                 │
│  New Domain     │◀───▶│  Adapter        │◀───▶│  Old Domain     │
│  Model          │     │  Translator     │     │  Model          │
│                 │     │  Facade         │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 4.2 用户服务 ACL 实现

```php
<?php

namespace App\AntiCorruptionLayer\User;

/**
 * 用户域 Anti-Corruption Layer
 * 隔离旧系统用户模型与新系统用户模型
 */
class UserACL
{
    private LegacyUserRepository $legacyRepo;
    private UserServiceClient $newServiceClient;
    private UserTranslator $translator;
    
    public function __construct(
        LegacyUserRepository $legacyRepo,
        UserServiceClient $newServiceClient,
        UserTranslator $translator
    ) {
        $this->legacyRepo = $legacyRepo;
        $this->newServiceClient = $newServiceClient;
        $this->translator = $translator;
    }
    
    /**
     * 获取用户信息
     * 优先从新服务获取，失败则回退到旧系统
     */
    public function getUser(int $userId): ?NewUserDTO
    {
        try {
            // 优先从新服务获取
            $newUser = $this->newServiceClient->getUser($userId);
            
            if ($newUser) {
                return $newUser;
            }
        } catch (\Exception $e) {
            // 新服务不可用，记录日志并回退
            \Log::warning('User service unavailable, falling back to legacy', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
        
        // 回退到旧系统
        $legacyUser = $this->legacyRepo->findById($userId);
        
        if (!$legacyUser) {
            return null;
        }
        
        // 通过翻译器转换数据模型
        return $this->translator->fromLegacyUser($legacyUser);
    }
    
    /**
     * 创建用户（双写策略）
     */
    public function createUser(array $userData): NewUserDTO
    {
        // 在旧系统中创建（保持兼容）
        $legacyUser = $this->legacyRepo->create($userData);
        
        try {
            // 尝试在新服务中创建
            $newUser = $this->newServiceClient->createUser(
                $this->translator->toNewServicePayload($userData)
            );
            
            return $newUser;
        } catch (\Exception $e) {
            // 新服务创建失败，使用旧系统数据
            \Log::error('Failed to create user in new service', [
                'legacy_user_id' => $legacyUser->id,
                'error' => $e->getMessage(),
            ]);
            
            return $this->translator->fromLegacyUser($legacyUser);
        }
    }
    
    /**
     * 同步用户数据到新服务
     */
    public function syncUserToNewService(int $userId): bool
    {
        $legacyUser = $this->legacyRepo->findById($userId);
        
        if (!$legacyUser) {
            return false;
        }
        
        $payload = $this->translator->toNewServicePayload($legacyUser->toArray());
        
        return $this->newServiceClient->upsertUser($payload);
    }
}
```

### 4.3 数据模型翻译器

```php
<?php

namespace App\AntiCorruptionLayer\User;

/**
 * 用户数据模型翻译器
 * 负责新旧系统之间的数据模型转换
 */
class UserTranslator
{
    /**
     * 旧系统 User 模型 → 新系统 UserDTO
     */
    public function fromLegacyUser(LegacyUser $legacyUser): NewUserDTO
    {
        return new NewUserDTO(
            id: $legacyUser->id,
            username: $legacyUser->username,
            email: $legacyUser->email,
            phone: $legacyUser->mobile,  // 注意字段名差异
            displayName: $legacyUser->nickname ?? $legacyUser->username,
            status: $this->mapLegacyStatus($legacyUser->status),
            addresses: $this->mapAddresses($legacyUser->addresses),
            metadata: [
                'legacy_id' => $legacyUser->id,
                'registered_at' => $legacyUser->created_at->toIso8601String(),
                'last_login_at' => $legacyUser->last_login_at?->toIso8601String(),
            ],
        );
    }
    
    /**
     * 新系统请求数据 → 旧系统格式
     */
    public function toLegacyFormat(array $newFormatData): array
    {
        $mapping = [
            'displayName' => 'nickname',
            'phone' => 'mobile',
            'status' => 'status',
        ];
        
        $legacyData = [];
        
        foreach ($mapping as $newKey => $legacyKey) {
            if (isset($newFormatData[$newKey])) {
                $legacyData[$legacyKey] = $newFormatData[$newKey];
            }
        }
        
        // 保持旧系统特有的字段
        if (isset($newFormatData['username'])) {
            $legacyData['username'] = $newFormatData['username'];
        }
        
        if (isset($newFormatData['email'])) {
            $legacyData['email'] = $newFormatData['email'];
        }
        
        return $legacyData;
    }
    
    /**
     * 新系统请求数据 → 新服务 Payload
     */
    public function toNewServicePayload(array $data): array
    {
        return [
            'user_id' => $data['id'] ?? null,
            'username' => $data['username'],
            'email' => $data['email'],
            'phone_number' => $data['phone'] ?? $data['mobile'] ?? null,
            'display_name' => $data['display_name'] ?? $data['nickname'] ?? $data['username'],
            'status' => $this->mapToNewStatus($data['status'] ?? 'active'),
            'addresses' => $this->mapAddressesToNew($data['addresses'] ?? []),
            'created_at' => $data['created_at'] ?? now()->toIso8601String(),
        ];
    }
    
    /**
     * 状态映射：旧系统 → 新系统
     */
    protected function mapLegacyStatus(int $legacyStatus): string
    {
        return match ($legacyStatus) {
            0 => 'inactive',
            1 => 'active',
            2 => 'suspended',
            3 => 'deleted',
            default => 'unknown',
        };
    }
    
    /**
     * 状态映射：新系统 → 旧系统
     */
    protected function mapToNewStatus(string $status): string
    {
        return match ($status) {
            'active' => 'active',
            'inactive' => 'inactive',
            'suspended' => 'suspended',
            default => 'active',
        };
    }
    
    /**
     * 地址格式转换
     */
    protected function mapAddresses($legacyAddresses): array
    {
        if (!$legacyAddresses) {
            return [];
        }
        
        $addresses = is_string($legacyAddresses) 
            ? json_decode($legacyAddresses, true) 
            : $legacyAddresses;
        
        return array_map(function ($addr) {
            return [
                'id' => $addr['id'] ?? null,
                'full_address' => $addr['address'] ?? '',
                'city' => $addr['city'] ?? '',
                'district' => $addr['district'] ?? '',
                'postal_code' => $addr['zip_code'] ?? '',
                'is_default' => ($addr['is_default'] ?? 0) === 1,
            ];
        }, $addresses);
    }
}
```

### 4.4 适配器模式

```php
<?php

namespace App\AntiCorruptionLayer\Order;

/**
 * 订单服务适配器
 * 当订单还在单体中时，为新服务提供兼容接口
 */
class OrderServiceAdapter
{
    private OrderRepository $orderRepo;
    private ItemServiceClient $itemService;
    private UserServiceClient $userService;
    
    public function __construct(
        OrderRepository $orderRepo,
        ItemServiceClient $itemService,
        UserServiceClient $userService
    ) {
        $this->orderRepo = $orderRepo;
        $this->itemService = $itemService;
        $this->userService = $userService;
    }
    
    /**
     * 为新服务提供订单查询接口
     */
    public function getOrdersForUserService(int $userId, array $filters = []): array
    {
        $orders = $this->orderRepo->findByUser($userId, $filters);
        
        return array_map(function ($order) {
            return [
                'order_id' => $order->id,
                'order_number' => $order->order_no,
                'total_amount' => $order->total_amount,
                'currency' => 'CNY',
                'status' => $this->mapOrderStatus($order->status),
                'created_at' => $order->created_at->toIso8601String(),
                'items' => $this->getOrderItems($order),
            ];
        }, $orders->toArray());
    }
    
    /**
     * 获取订单商品信息（从商品服务获取最新信息）
     */
    protected function getOrderItems($order): array
    {
        $itemIds = $order->items->pluck('item_id')->toArray();
        
        // 从商品服务批量获取商品信息
        $itemsInfo = $this->itemService->batchGetItems($itemIds);
        
        return $order->items->map(function ($orderItem) use ($itemsInfo) {
            $itemInfo = $itemsInfo[$orderItem->item_id] ?? null;
            
            return [
                'item_id' => $orderItem->item_id,
                'item_name' => $itemInfo['name'] ?? $orderItem->item_name,
                'quantity' => $orderItem->quantity,
                'unit_price' => $orderItem->unit_price,
                'subtotal' => $orderItem->quantity * $orderItem->unit_price,
            ];
        })->toArray();
    }
    
    protected function mapOrderStatus(int $status): string
    {
        return match ($status) {
            0 => 'pending',
            1 => 'paid',
            2 => 'shipped',
            3 => 'delivered',
            4 => 'completed',
            5 => 'cancelled',
            6 => 'refunding',
            default => 'unknown',
        };
    }
}
```

## 五、数据迁移策略

### 5.1 数据库拆分方案

```php
<?php

namespace App\DataMigration;

/**
 * 数据迁移管理器
 * 支持双写 + 最终一致性同步
 */
class DataMigrationManager
{
    private string $sourceConnection;
    private string $targetConnection;
    private array $config;
    
    public function __construct(string $source, string $target, array $config)
    {
        $this->sourceConnection = $source;
        $this->targetConnection = $target;
        $this->config = $config;
    }
    
    /**
     * 全量迁移
     */
    public function migrateFull(string $table, callable $transformer = null): int
    {
        $migrated = 0;
        $batchSize = $this->config['batch_size'] ?? 1000;
        $lastId = 0;
        
        while (true) {
            // 从源数据库读取
            $rows = DB::connection($this->sourceConnection)
                ->table($table)
                ->where('id', '>', $lastId)
                ->orderBy('id')
                ->limit($batchSize)
                ->get();
            
            if ($rows->isEmpty()) {
                break;
            }
            
            // 转换数据
            $transformedRows = $transformer 
                ? $rows->map($transformer)->toArray()
                : $rows->toArray();
            
            // 写入目标数据库
            DB::connection($this->targetConnection)
                ->table($table)
                ->insert($transformedRows);
            
            $migrated += count($transformedRows);
            $lastId = $rows->last()->id;
            
            // 记录进度
            \Log::info("Migration progress: {$table}", [
                'migrated' => $migrated,
                'last_id' => $lastId,
            ]);
            
            // 可选：添加延迟以减少源数据库压力
            if (isset($this->config['throttle_ms'])) {
                usleep($this->config['throttle_ms'] * 1000);
            }
        }
        
        return $migrated;
    }
    
    /**
     * 增量同步（基于时间戳）
     */
    public function syncIncremental(
        string $table,
        string $timestampColumn = 'updated_at',
        callable $transformer = null
    ): int {
        // 获取上次同步时间
        $lastSyncTime = Cache::get("migration:last_sync:{$table}", '1970-01-01');
        
        $rows = DB::connection($this->sourceConnection)
            ->table($table)
            ->where($timestampColumn, '>', $lastSyncTime)
            ->orderBy($timestampColumn)
            ->limit($this->config['sync_limit'] ?? 5000)
            ->get();
        
        if ($rows->isEmpty()) {
            return 0;
        }
        
        $transformedRows = $transformer
            ? $rows->map($transformer)->toArray()
            : $rows->toArray();
        
        // 使用 Upsert 避免重复
        DB::connection($this->targetConnection)
            ->table($table)
            ->upsert($transformedRows, ['id']);
        
        // 更新同步时间
        $newSyncTime = $rows->last()->$timestampColumn;
        Cache::put("migration:last_sync:{$table}", $newSyncTime);
        
        return count($transformedRows);
    }
}
```

### 5.2 数据一致性验证

```php
<?php

namespace App\DataMigration;

/**
 * 数据一致性校验器
 */
class ConsistencyChecker
{
    /**
     * 对比新旧系统的数据一致性
     */
    public function checkConsistency(
        string $table,
        string $primaryKey = 'id',
        array $excludeColumns = ['created_at', 'updated_at']
    ): ConsistencyReport {
        $report = new ConsistencyReport($table);
        
        $batchSize = 500;
        $lastId = 0;
        
        while (true) {
            $sourceRows = DB::connection('source')
                ->table($table)
                ->where($primaryKey, '>', $lastId)
                ->orderBy($primaryKey)
                ->limit($batchSize)
                ->get()
                ->keyBy($primaryKey);
            
            if ($sourceRows->isEmpty()) {
                break;
            }
            
            $targetRows = DB::connection('target')
                ->table($table)
                ->whereIn($primaryKey, $sourceRows->keys()->toArray())
                ->get()
                ->keyBy($primaryKey);
            
            foreach ($sourceRows as $key => $sourceRow) {
                $targetRow = $targetRows->get($key);
                
                if (!$targetRow) {
                    $report->addMissing($key);
                    continue;
                }
                
                $diff = $this->compareRows(
                    (array) $sourceRow,
                    (array) $targetRow,
                    $excludeColumns
                );
                
                if (!empty($diff)) {
                    $report->addMismatch($key, $diff);
                }
            }
            
            $lastId = $sourceRows->last()->$primaryKey;
        }
        
        return $report;
    }
    
    protected function compareRows(array $source, array $target, array $exclude): array
    {
        $diff = [];
        
        foreach ($source as $column => $value) {
            if (in_array($column, $exclude)) {
                continue;
            }
            
            if (!array_key_exists($column, $target)) {
                $diff[$column] = ['source' => $value, 'target' => 'MISSING'];
                continue;
            }
            
            if ((string) $value !== (string) $target[$column]) {
                $diff[$column] = [
                    'source' => $value,
                    'target' => $target[$column],
                ];
            }
        }
        
        return $diff;
    }
}
```

## 六、迁移实战流程

### 6.1 用户模块迁移步骤

```php
<?php

/**
 * 用户模块迁移 Checklist
 * 
 * Phase 1: 准备阶段
 * - [ ] 新用户服务开发完成并通过测试
 * - [ ] 数据库 Schema 设计完成
 * - [ ] ACL 层开发完成
 * - [ ] 数据迁移脚本开发完成
 * - [ ] 监控和告警配置完成
 * 
 * Phase 2: 数据同步
 * - [ ] 全量数据迁移
 * - [ ] 增量同步启动
 * - [ ] 一致性校验通过
 * 
 * Phase 3: 灰度放量
 * - [ ] 内部测试用户切流（1%）
 * - [ ] 观察 24 小时，确认无异常
 * - [ ] 扩大到 10% 流量
 * - [ ] 观察 48 小时
 * - [ ] 扩大到 50% 流量
 * - [ ] 全量切流
 * 
 * Phase 4: 清理
 * - [ ] 关闭旧系统用户相关代码
 * - [ ] 删除双写逻辑
 * - [ ] 更新文档
 */

class UserMigrationRunner
{
    private DataMigrationManager $migrationManager;
    private UserACL $userACL;
    private RolloutManager $rolloutManager;
    private ConsistencyChecker $checker;
    
    public function runPhase2(): void
    {
        echo "=== Phase 2: Data Sync ===\n";
        
        // 1. 全量迁移
        echo "Starting full migration...\n";
        $count = $this->migrationManager->migrateFull(
            'users',
            function ($row) {
                return [
                    'id' => $row->id,
                    'username' => $row->username,
                    'email' => $row->email,
                    'phone_number' => $row->mobile,
                    'display_name' => $row->nickname ?? $row->username,
                    'status' => $row->status === 1 ? 'active' : 'inactive',
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            }
        );
        echo "Migrated {$count} users\n";
        
        // 2. 启动增量同步
        echo "Starting incremental sync...\n";
        $synced = $this->migrationManager->syncIncremental('users');
        echo "Synced {$synced} updates\n";
        
        // 3. 一致性校验
        echo "Running consistency check...\n";
        $report = $this->checker->checkConsistency('users');
        
        if ($report->isConsistent()) {
            echo "✅ Consistency check passed\n";
        } else {
            echo "❌ Consistency issues found:\n";
            echo "  Missing in target: " . $report->getMissingCount() . "\n";
            echo "  Mismatches: " . $report->getMismatchCount() . "\n";
        }
    }
    
    public function runPhase3(): void
    {
        echo "=== Phase 3: Gradual Rollout ===\n";
        
        $stages = [
            ['percentage' => 1, 'observation_hours' => 24],
            ['percentage' => 10, 'observation_hours' => 48],
            ['percentage' => 50, 'observation_hours' => 72],
            ['percentage' => 100, 'observation_hours' => 168],
        ];
        
        foreach ($stages as $stage) {
            echo "Rolling out to {$stage['percentage']}% traffic...\n";
            
            config(['features.user_service_rollout_percentage' => $stage['percentage']]);
            config(['features.user_service_rollout_strategy' => 'percentage']);
            
            echo "Observing for {$stage['observation_hours']} hours...\n";
            echo "Monitor: error rate, latency, business metrics\n";
            
            // 在实际执行中，这里会等待观察期结束
            // 并检查监控指标是否在正常范围内
        }
    }
}
```

## 七、监控与回滚

### 7.1 迁移监控指标

```php
<?php

namespace App\Monitoring;

class MigrationMonitor
{
    /**
     * 关键监控指标
     */
    public function getMetrics(string $service): array
    {
        return [
            // 流量指标
            'traffic_split' => [
                'monolith' => $this->getTrafficPercentage('monolith', $service),
                'new_service' => $this->getTrafficPercentage('new_service', $service),
            ],
            
            // 延迟指标
            'latency' => [
                'monolith_p50' => $this->getLatency('monolith', $service, 50),
                'monolith_p99' => $this->getLatency('monolith', $service, 99),
                'new_service_p50' => $this->getLatency('new_service', $service, 50),
                'new_service_p99' => $this->getLatency('new_service', $service, 99),
            ],
            
            // 错误率
            'error_rate' => [
                'monolith' => $this->getErrorRate('monolith', $service),
                'new_service' => $this->getErrorRate('new_service', $service),
            ],
            
            // 业务指标
            'business' => [
                'registration_success_rate' => $this->getBusinessMetric('registration'),
                'login_success_rate' => $this->getBusinessMetric('login'),
                'order_creation_rate' => $this->getBusinessMetric('order_creation'),
            ],
        ];
    }
    
    /**
     * 自动回滚判断
     */
    public function shouldRollback(string $service): bool
    {
        $errorRate = $this->getErrorRate('new_service', $service);
        $p99Latency = $this->getLatency('new_service', $service, 99);
        
        // 错误率超过 1% 则触发回滚
        if ($errorRate > 0.01) {
            \Log::critical("Migration rollback triggered: error rate {$errorRate}");
            return true;
        }
        
        // P99 延迟超过 500ms 则触发回滚
        if ($p99Latency > 500) {
            \Log::critical("Migration rollback triggered: P99 latency {$p99Latency}ms");
            return true;
        }
        
        return false;
    }
    
    /**
     * 执行回滚
     */
    public function rollback(string $service): void
    {
        \Log::warning("Rolling back {$service} to monolith");
        
        // 关闭 Feature Flag
        config(["features.forward_to_{$service}" => false]);
        
        // 更新 Nginx 配置（如果使用 Nginx 路由）
        // $this->updateNginxConfig($service, 'monolith');
        
        // 通知团队
        $this->notifyTeam("Service {$service} rolled back to monolith");
    }
}
```

## 八、总结与最佳实践

### 8.1 迁移清单

1. **识别边界**：通过领域驱动设计识别 Bounded Context
2. **建立路由层**：Nginx / API Gateway / Laravel 中间件
3. **构建 ACL**：翻译器 + 适配器 + 外观模式
4. **数据迁移**：全量 + 增量 + 一致性校验
5. **灰度放量**：1% → 10% → 50% → 100%
6. **监控告警**：流量、延迟、错误率、业务指标
7. **回滚预案**：自动回滚 + 手动回滚

### 8.2 反模式

**❌ 大爆炸重写**：一次性重写所有代码，风险极高
**❌ 过早拆分**：在没有明确边界的情况下强行拆分
**❌ 共享数据库**：新旧系统直接访问同一个数据库
**❌ 缺少 ACL**：新旧系统直接调用，耦合严重
**❌ 忽略监控**：没有监控就盲目切流

### 8.3 成功关键

1. **渐进式**：每次只迁移一个模块，确保每步都可回滚
2. **隔离性**：ACL 确保新旧系统互不干扰
3. **可观测**：完善的监控让你随时知道迁移状态
4. **自动化**：数据同步、一致性校验、回滚判断尽量自动化
5. **团队共识**：迁移是团队的事，需要产品、开发、运维、测试共同参与

Strangler Fig Pattern 不仅是一种技术模式，更是一种风险管理策略。它让你在保持业务稳定的同时，逐步演进系统架构。在 Laravel 单体到微服务的迁移路上，它是你最可靠的伙伴。

## 相关阅读

- [Circuit Breaker 深度实战：PHP 手写熔断器 vs Laravel HTTP Client 的 resilience 模式——从原理到生产落地](/categories/Laravel/PHP/Circuit-Breaker-深度实战-PHP-手写熔断器-vs-Laravel-HTTP-Client-resilience-模式/)
- [重试与退避策略实战：Exponential Backoff + Jitter——Laravel HTTP Client 的韧性设计模式](/categories/Laravel/PHP/重试与退避策略实战-Exponential-Backoff-Jitter-Laravel-HTTP-Client韧性设计模式/)
- [Chaos Engineering 实战：用 Chaos Mesh 对 Laravel 微服务进行故障注入与韧性测试](/categories/运维/Chaos-Engineering-实战/)
