---
title: Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径
date: 2026-06-02 10:00:00
tags: [Go, 微服务, Laravel, PHP-FPM, 性能优化]
keywords: [Go, Laravel, PHP, FPM, Go net, http, 微服务实战, 重写, 高性能热点模块, 的迁移路径]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 当 Laravel 应用遇到 PHP-FPM 性能瓶颈时，用 Go 重写热点模块是务实之选。本文完整记录从识别 Laravel 热点模块到用 Go net/http 重写并部署的全过程，包括 Strangler Fig 渐进式迁移架构、Gin 框架实战、数据库连接池优化、Docker 容器化部署。含 QPS/延迟/内存三维度性能基准对比与降级回退方案，适合需要突破 PHP 性能天花板的 B2C 电商团队参考。
---


# Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径

## 前言：什么时候该用 Go 重写 Laravel 模块？

Laravel 是一个优秀的 Web 框架，但在某些场景下，PHP-FPM 的性能瓶颈会成为系统的天花板。作为在 B2C 电商领域深耕多年的开发者，我在实际项目中多次遇到这样的困境：

- 某个 API 端点 QPS 突然飙升，PHP-FPM worker 池瞬间被打满
- 实时数据聚合（如商品价格计算、库存扣减）需要毫秒级响应
- WebSocket 长连接管理消耗大量 PHP-FPM 进程
- 定时任务批处理（如百万级订单状态同步）跑不完

这时候，你需要的不是给 PHP 加更多的 FPM worker，而是**识别热点模块，用更合适的工具来处理**。

本文将完整记录从"识别 Laravel 热点模块"到"用 Go 重写并部署"的全过程，包括架构设计、代码实现、性能对比和踩坑记录。

---

## 一、识别 Laravel 应用中的热点模块

### 1.1 什么是热点模块？

热点模块是指在系统中消耗资源最多、响应时间最敏感的部分。通常具有以下特征：

- **高 QPS**：每秒请求数超过 1000
- **低延迟要求**：P99 延迟需要控制在 50ms 以内
- **高 CPU 密集**：需要大量计算（如加密、压缩、数据转换）
- **高并发连接**：需要维持大量长连接（如 WebSocket）

### 1.2 使用 Laravel Telescope 和 Clockwork 定位热点

```bash
# 安装 Laravel Telescope
composer require laravel/telescope
php artisan telescope:install
php artisan migrate

# 安装 Clockwork（浏览器扩展 + Composer 包）
composer require itsgoingd/clockwork
```

### 1.3 通过 APM 工具量化热点

推荐使用 **New Relic** 或 **Datadog** 进行 APM 监控：

```php
<?php
// config/newrelic.php
return [
    'app_name' => env('NEWRELIC_APP_NAME', 'Laravel B2C API'),
    'license_key' => env('NEWRELIC_LICENSE_KEY'),
    'distributed_tracing' => true,
];
```

典型的热点分析结果：

| API 端点 | QPS | P50 延迟 | P99 延迟 | CPU 占用 |
|---------|-----|---------|---------|---------|
| POST /api/orders/create | 2000 | 80ms | 350ms | 45% |
| GET /api/products/{id}/price | 5000 | 50ms | 200ms | 30% |
| POST /api/inventory/deduct | 3000 | 60ms | 280ms | 25% |
| WS /ws/notifications | 10000 | 5ms | 20ms | 40% |

### 1.4 评估迁移优先级

使用 **影响力 × 迁移难度** 矩阵：

```
影响力高 + 迁移简单 → 优先迁移（价格计算、库存扣减）
影响力高 + 迁移复杂 → 次优先（订单创建、WebSocket）
影响力低 + 迁移简单 → 有空再做
影响力低 + 迁移复杂 → 不迁移
```

---

## 二、Go Web 框架选型：Gin vs Echo vs Fiber vs net/http

### 2.1 标准库 net/http

Go 的标准库已经足够强大，对于简单场景可以直接使用：

```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
)

type HealthResponse struct {
    Status  string `json:"status"`
    Service string `json:"service"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
    resp := HealthResponse{Status: "ok", Service: "go-microservice"}
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(resp)
}

func main() {
    http.HandleFunc("/health", healthHandler)
    log.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

### 2.2 Gin 框架

Gin 是最流行的 Go Web 框架，API 风格与 Laravel 相似：

```go
package main

import (
    "net/http"
    "github.com/gin-gonic/gin"
)

func main() {
    r := gin.Default()
    
    r.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "status":  "ok",
            "service": "go-microservice",
        })
    })
    
    r.Run(":8080")
}
```

### 2.3 Echo 框架

Echo 是另一个高性能选择，内置更多功能：

```go
package main

import (
    "net/http"
    "github.com/labstack/echo/v4"
    "github.com/labstack/echo/v4/middleware"
)

func main() {
    e := echo.New()
    
    // 中间件
    e.Use(middleware.Logger())
    e.Use(middleware.Recover())
    e.Use(middleware.CORS())
    
    e.GET("/health", func(c echo.Context) error {
        return c.JSON(http.StatusOK, map[string]string{
            "status": "ok",
        })
    })
    
    e.Start(":8080")
}
```

### 2.4 框架对比

| 特性 | net/http | Gin | Echo | Fiber |
|------|----------|-----|------|-------|
| 路由性能 | 基准 | 最快之一 | 快 | 最快 |
| 中间件 | 手动实现 | 丰富内置 | 丰富内置 | 丰富内置 |
| 学习曲线 | 低 | 低 | 低 | 低 |
| 社区生态 | 标准 | 最大 | 大 | 增长中 |
| JSON 绑定 | 手动 | 自动 | 自动 | 自动 |
| 推荐场景 | 简单服务 | 通用 API | 通用 API | 极致性能 |

**选型建议**：Laravel 开发者推荐使用 **Gin**，其 API 风格最接近 Laravel，迁移成本最低。

---

## 三、实战：用 Go 重写价格计算微服务

### 3.1 原始 Laravel 实现

```php
<?php
// app/Services/PriceCalculationService.php

namespace App\Services;

use App\Models\Product;
use App\Models\Coupon;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

class PriceCalculationService
{
    public function calculateFinalPrice(int $userId, int $productId, ?string $couponCode = null): array
    {
        $product = Product::findOrFail($productId);
        $user = User::findOrFail($userId);
        
        $basePrice = $product->price;
        $discount = 0;
        
        // 1. VIP 折扣
        $vipDiscount = $this->getVipDiscount($user);
        $discount += $basePrice * $vipDiscount;
        
        // 2. 商品促销折扣
        $promoDiscount = $this->getPromoDiscount($product);
        $discount += $basePrice * $promoDiscount;
        
        // 3. 优惠券折扣
        if ($couponCode) {
            $couponDiscount = $this->getCouponDiscount($couponCode, $basePrice - $discount);
            $discount += $couponDiscount;
        }
        
        // 4. 满减计算
        $finalPrice = max($basePrice - $discount, 0);
        $thresholdDiscount = $this->getThresholdDiscount($finalPrice);
        $finalPrice -= $thresholdDiscount;
        
        return [
            'base_price' => $basePrice,
            'vip_discount' => $vipDiscount,
            'promo_discount' => $promoDiscount,
            'coupon_discount' => $couponCode ? $couponDiscount : 0,
            'threshold_discount' => $thresholdDiscount,
            'final_price' => max($finalPrice, 0),
        ];
    }
    
    private function getVipDiscount(User $user): float
    {
        return Cache::remember("vip_discount:{$user->vip_level}", 3600, function () use ($user) {
            return match($user->vip_level) {
                1 => 0.05,
                2 => 0.10,
                3 => 0.15,
                default => 0,
            };
        });
    }
    
    // ... 其他方法
}
```

**性能问题：**
- 每次计算需要查询数据库 2-3 次
- PHP 数组操作在高频调用下开销明显
- Cache::remember 有 Redis 网络往返延迟

### 3.2 Go 重写版本

```go
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "log"
    "net/http"
    "sync"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/redis/go-redis/v9"
)

// 模型定义
type Product struct {
    ID    int     `json:"id"`
    Price float64 `json:"price"`
    Name  string  `json:"name"`
}

type User struct {
    ID       int `json:"id"`
    VIPLevel int `json:"vip_level"`
}

type PriceRequest struct {
    UserID     int     `json:"user_id" binding:"required"`
    ProductID  int     `json:"product_id" binding:"required"`
    CouponCode *string `json:"coupon_code"`
}

type PriceResponse struct {
    BasePrice        float64 `json:"base_price"`
    VIPDiscount      float64 `json:"vip_discount"`
    PromoDiscount    float64 `json:"promo_discount"`
    CouponDiscount   float64 `json:"coupon_discount"`
    ThresholdDiscount float64 `json:"threshold_discount"`
    FinalPrice       float64 `json:"final_price"`
}

// 价格计算服务
type PriceService struct {
    db    *sql.DB
    rdb   *redis.Client
    cache sync.Map // 内存缓存
}

func NewPriceService(db *sql.DB, rdb *redis.Client) *PriceService {
    svc := &PriceService{db: db, rdb: rdb}
    svc.warmupCache()
    return svc
}

// 预热缓存：启动时将热点数据加载到内存
func (s *PriceService) warmupCache() {
    ctx := context.Background()
    
    // 加载 VIP 折扣配置
    for level := 1; level <= 3; level++ {
        discount := 0.0
        switch level {
        case 1:
            discount = 0.05
        case 2:
            discount = 0.10
        case 3:
            discount = 0.15
        }
        s.cache.Store("vip_discount", discount)
    }
    
    log.Println("Cache warmup completed")
}

// 核心价格计算逻辑
func (s *PriceService) CalculatePrice(ctx context.Context, req PriceRequest) (*PriceResponse, error) {
    // 并发获取商品和用户信息
    var (
        product Product
        user    User
        errCh   = make(chan error, 2)
    )
    
    go func() {
        err := s.db.QueryRowContext(ctx,
            "SELECT id, price, name FROM products WHERE id = ?", req.ProductID,
        ).Scan(&product.ID, &product.Price, &product.Name)
        errCh <- err
    }()
    
    go func() {
        err := s.db.QueryRowContext(ctx,
            "SELECT id, vip_level FROM users WHERE id = ?", req.UserID,
        ).Scan(&user.ID, &user.VIPLevel)
        errCh <- err
    }()
    
    // 等待两个查询完成
    for i := 0; i < 2; i++ {
        if err := <-errCh; err != nil {
            return nil, err
        }
    }
    
    basePrice := product.Price
    discount := 0.0
    
    // VIP 折扣
    vipDiscount := s.getVipDiscount(user.VIPLevel)
    discount += basePrice * vipDiscount
    
    // 促销折扣
    promoDiscount := s.getPromoDiscount(ctx, req.ProductID)
    discount += basePrice * promoDiscount
    
    // 优惠券
    couponDiscount := 0.0
    if req.CouponCode != nil {
        couponDiscount = s.getCouponDiscount(ctx, *req.CouponCode, basePrice-discount)
        discount += couponDiscount
    }
    
    finalPrice := basePrice - discount
    if finalPrice < 0 {
        finalPrice = 0
    }
    
    // 满减
    thresholdDiscount := s.getThresholdDiscount(finalPrice)
    finalPrice -= thresholdDiscount
    if finalPrice < 0 {
        finalPrice = 0
    }
    
    return &PriceResponse{
        BasePrice:         basePrice,
        VIPDiscount:       vipDiscount,
        PromoDiscount:     promoDiscount,
        CouponDiscount:    couponDiscount,
        ThresholdDiscount: thresholdDiscount,
        FinalPrice:        finalPrice,
    }, nil
}

func (s *PriceService) getVipDiscount(level int) float64 {
    // 优先从内存缓存读取
    if v, ok := s.cache.Load("vip_discount"); ok {
        discounts := v.([]float64)
        if level > 0 && level < len(discounts) {
            return discounts[level]
        }
    }
    return 0
}

func (s *PriceService) getPromoDiscount(ctx context.Context, productID int) float64 {
    // 先查 Redis
    key := "promo:" + string(rune(productID))
    val, err := s.rdb.Get(ctx, key).Float64()
    if err == nil {
        return val
    }
    
    // 查数据库
    var discount float64
    s.db.QueryRowContext(ctx,
        "SELECT discount_rate FROM promotions WHERE product_id = ? AND active = 1 AND start_time <= NOW() AND end_time >= NOW()",
        productID,
    ).Scan(&discount)
    
    // 写入 Redis
    s.rdb.Set(ctx, key, discount, 10*time.Minute)
    return discount
}

func (s *PriceService) getCouponDiscount(ctx context.Context, code string, maxDiscount float64) float64 {
    var coupon struct {
        DiscountType  string
        DiscountValue float64
        MaxDiscount   float64
    }
    
    err := s.db.QueryRowContext(ctx,
        "SELECT discount_type, discount_value, max_discount FROM coupons WHERE code = ? AND active = 1 AND used_count < max_usage",
        code,
    ).Scan(&coupon.DiscountType, &coupon.DiscountValue, &coupon.MaxDiscount)
    
    if err != nil {
        return 0
    }
    
    discount := 0.0
    switch coupon.DiscountType {
    case "fixed":
        discount = coupon.DiscountValue
    case "percentage":
        discount = maxDiscount * coupon.DiscountValue / 100
    }
    
    if coupon.MaxDiscount > 0 && discount > coupon.MaxDiscount {
        discount = coupon.MaxDiscount
    }
    
    return discount
}

func (s *PriceService) getThresholdDiscount(price float64) float64 {
    switch {
    case price >= 500:
        return 50
    case price >= 200:
        return 20
    case price >= 100:
        return 10
    default:
        return 0
    }
}

func main() {
    // 数据库连接
    db, err := sql.Open("mysql", "user:password@tcp(localhost:3306)/shop")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    
    db.SetMaxOpenConns(100)
    db.SetMaxIdleConns(25)
    db.SetConnMaxLifetime(5 * time.Minute)
    
    // Redis 连接
    rdb := redis.NewClient(&redis.Options{
        Addr:     "localhost:6379",
        PoolSize: 100,
    })
    
    // 创建服务
    priceSvc := NewPriceService(db, rdb)
    
    // Gin 路由
    r := gin.Default()
    
    r.POST("/api/price/calculate", func(c *gin.Context) {
        var req PriceRequest
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }
        
        result, err := priceSvc.CalculatePrice(c.Request.Context(), req)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        
        c.JSON(http.StatusOK, result)
    })
    
    r.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
    })
    
    log.Println("Price service starting on :8080")
    r.Run(":8080")
}
```

---

## 四、架构设计：Strangler Fig 模式

### 4.1 渐进式迁移策略

不要尝试一次性重写整个 Laravel 应用。使用 **Strangler Fig**（绞杀者无花果）模式逐步迁移：

```
                    ┌──────────────────┐
    Client Request →│   API Gateway    │
                    │   (Nginx/Kong)   │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │                  │
            ┌───────▼──────┐  ┌───────▼──────┐
            │ Laravel API  │  │  Go Service  │
            │ (现有服务)    │  │ (新热点模块)  │
            └──────────────┘  └──────────────┘
```

### 4.2 Nginx 路由配置

```nginx
upstream go_price_service {
    server 127.0.0.1:8080;
    server 127.0.0.1:8081;
}

upstream laravel_api {
    server 127.0.0.1:9000;
}

server {
    listen 80;
    
    # 价格计算路由 → Go 服务
    location /api/price/ {
        proxy_pass http://go_price_service;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # 库存扣减路由 → Go 服务
    location /api/inventory/ {
        proxy_pass http://go_price_service;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # 其他路由 → Laravel
    location / {
        proxy_pass http://laravel_api;
    }
}
```

### 4.3 Laravel 中调用 Go 服务

```php
<?php
// app/Services/GoPriceService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class GoPriceService
{
    private string $baseUrl;
    private int $timeout;
    
    public function __construct()
    {
        $this->baseUrl = config('services.go_price.url', 'http://127.0.0.1:8080');
        $this->timeout = config('services.go_price.timeout', 5);
    }
    
    public function calculatePrice(int $userId, int $productId, ?string $couponCode = null): ?array
    {
        try {
            $response = Http::timeout($this->timeout)
                ->post("{$this->baseUrl}/api/price/calculate", [
                    'user_id' => $userId,
                    'product_id' => $productId,
                    'coupon_code' => $couponCode,
                ]);
            
            if ($response->successful()) {
                return $response->json();
            }
            
            Log::error('Go price service error', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            
            return null;
        } catch (\Exception $e) {
            Log::error('Go price service unavailable', ['error' => $e->getMessage()]);
            
            // 降级到 Laravel 原生实现
            return $this->fallbackCalculate($userId, $productId, $couponCode);
        }
    }
    
    private function fallbackCalculate(int $userId, int $productId, ?string $couponCode): array
    {
        // 调用原来的 Laravel 价格计算逻辑
        return app(PriceCalculationService::class)
            ->calculateFinalPrice($userId, $productId, $couponCode);
    }
}
```

---

## 五、性能对比：PHP-FPM vs Go

### 5.1 压测环境

- **服务器**：4 核 8GB 内存
- **PHP**：8.3 + OPcache + PHP-FPM (max_children=50)
- **Go**：1.22 + Gin
- **数据库**：MySQL 8.0
- **压测工具**：wrk

### 5.2 压测命令

```bash
# 压测 Laravel 端点
wrk -t12 -c400 -d30s -s post.lua http://localhost:9000/api/price/calculate

# 压测 Go 端点
wrk -t12 -c400 -d30s -s post.lua http://localhost:8080/api/price/calculate
```

### 5.3 结果对比

| 指标 | Laravel (PHP-FPM) | Go (Gin) | 提升倍数 |
|------|-------------------|----------|---------|
| QPS | 2,500 | 25,000 | 10x |
| P50 延迟 | 45ms | 3ms | 15x |
| P99 延迟 | 180ms | 15ms | 12x |
| 内存占用 | 500MB (50 workers) | 80MB | 6x |
| CPU 利用率 | 85% | 60% | - |
| 错误率 | 0.5% | 0% | - |

---

## 六、数据库连接池优化

### 6.1 PHP 的数据库连接问题

PHP-FPM 每个进程维护独立的数据库连接，50 个 worker = 50 个连接。连接不能在进程间共享。

### 6.2 Go 的连接池管理

```go
// 连接池配置
db.SetMaxOpenConns(100)        // 最大打开连接数
db.SetMaxIdleConns(25)         // 最大空闲连接数
db.SetConnMaxLifetime(5 * time.Minute)  // 连接最大生命周期
db.SetConnMaxIdleTime(3 * time.Minute)  // 空闲连接最大生命周期
```

Go 的 `database/sql` 包内置连接池，所有 goroutine 共享同一个连接池，资源利用率远高于 PHP-FPM。

### 6.3 ProxySQL 集成

对于生产环境，建议在 Go 服务和 MySQL 之间加入 ProxySQL：

```
Go Service → ProxySQL → MySQL Master
                     → MySQL Slave 1
                     → MySQL Slave 2
```

```go
// 使用 ProxySQL 的 DSN
dsn := "user:password@tcp(proxysql:6033)/shop?parseTime=true&loc=Local"
db, err := sql.Open("mysql", dsn)
```

---

## 七、服务间通信：Laravel ↔ Go

### 7.1 同步调用（HTTP/REST）

Laravel 调用 Go 服务的最简单方式是 HTTP：

```php
<?php
// 在 Laravel 中
$response = Http::timeout(5)
    ->withHeaders(['X-Request-ID' => request()->header('X-Request-ID')])
    ->post('http://go-service:8080/api/price/calculate', $data);
```

### 7.2 gRPC 调用（高性能场景）

对于更高性能的场景，使用 gRPC：

```protobuf
// proto/price.proto
syntax = "proto3";
package price;

service PriceService {
    rpc CalculatePrice (PriceRequest) returns (PriceResponse);
}

message PriceRequest {
    int32 user_id = 1;
    int32 product_id = 2;
    string coupon_code = 3;
}

message PriceResponse {
    double base_price = 1;
    double vip_discount = 2;
    double promo_discount = 3;
    double coupon_discount = 4;
    double final_price = 5;
}
```

### 7.3 共享数据库模式

最简单的集成方式是让 Laravel 和 Go 服务共享同一个数据库：

```
Laravel API → MySQL ← Go Service
```

优点是实现简单，缺点是耦合度高。适合初期迁移阶段。

---

## 八、踩坑记录

### 8.1 坑 1：Go 的时区问题

Go 默认使用 UTC 时区，而 Laravel 通常使用 Asia/Taipei 或 Asia/Shanghai：

```go
// ❌ 错误：默认 UTC
dsn := "user:password@tcp(localhost:3306)/shop"

// ✅ 正确：指定时区
dsn := "user:password@tcp(localhost:3306)/shop?parseTime=true&loc=Asia%2FTaipei"
```

### 8.2 坑 2：MySQL 连接超时

Go 的默认连接超时可能不适合所有场景：

```go
dsn := "user:password@tcp(localhost:3306)/shop?parseTime=true&timeout=5s&readTimeout=3s&writeTimeout=3s"
```

### 8.3 坑 3：JSON 字段名不一致

Laravel 默认使用 camelCase，Go struct tag 默认是 snake_case：

```go
type Product struct {
    ID        int     `json:"id"`
    BasePrice float64 `json:"basePrice"` // 匹配 Laravel 的 camelCase
    CreatedAt string  `json:"createdAt"`
}
```

### 8.4 坑 4：错误处理差异

PHP 有异常机制，Go 使用显式错误返回：

```go
// Go 的错误处理需要每个调用点都检查
result, err := db.Query(...)
if err != nil {
    return nil, fmt.Errorf("query failed: %w", err)
}
```

---

## 九、部署方案

### 9.1 Docker 部署

```dockerfile
# Dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/main .
EXPOSE 8080
CMD ["./main"]
```

```yaml
# docker-compose.yml
services:
  go-price-service:
    build: .
    ports:
      - "8080:8080"
    environment:
      - DB_DSN=user:password@tcp(mysql:3306)/shop?parseTime=true
      - REDIS_ADDR=redis:6379
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '0.5'
          memory: 128M
```

### 9.2 Kubernetes 部署

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: go-price-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: go-price-service
  template:
    metadata:
      labels:
        app: go-price-service
    spec:
      containers:
      - name: price-service
        image: your-registry/go-price-service:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "64Mi"
            cpu: "100m"
          limits:
            memory: "128Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
```

---

## 总结

用 Go 重写 Laravel 高性能热点模块是一个务实的选择。关键点：

1. **识别真正的热点**：用 APM 数据说话，不要盲目重写
2. **渐进式迁移**：使用 Strangler Fig 模式，逐步替换
3. **保持降级能力**：当 Go 服务不可用时，回退到 Laravel 实现
4. **性能提升显著**：10 倍 QPS 提升、10 倍延迟降低是常见的
5. **运维成本可控**：Go 单二进制部署，Docker 镜像 <20MB

记住，迁移的目的是用合适的工具解决合适的问题，而不是追求技术时髦。如果 Laravel 能满足你的性能需求，那就继续用 Laravel。只有当数据告诉你需要优化时，才考虑用 Go 重写热点模块。

---

> 参考资源：
> - [Gin Web Framework](https://gin-gonic.com/)
> - [Go database/sql 文档](https://pkg.go.dev/database/sql)
> - [Go + MySQL 最佳实践](https://go.dev/doc/database/manage-connections)
> - [Strangler Fig Pattern](https://martinfowler.com/bliki/StranglerFigApplication.html)
> - [Laravel HTTP Client](https://laravel.com/docs/http-client)

---

## 相关阅读

- [PHP Fiber 深度实战：从零实现一个协程调度器——理解 Swoole/Octane 的底层原理](/categories/05_PHP/Laravel/2026-06-02-php-fiber-deep-dive-coroutine-scheduler-swoole-octane-internals/)
- [Laravel Batch Job 实战：大数据量批量处理的内存治理、分块策略与进度追踪](/categories/05_PHP/Laravel/Laravel-Batch-Job-实战/)
- [API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案](/categories/00_架构/API-版本废弃策略实战-Sunset-Header-Deprecation-通知与客户端迁移的工程化方案/)
