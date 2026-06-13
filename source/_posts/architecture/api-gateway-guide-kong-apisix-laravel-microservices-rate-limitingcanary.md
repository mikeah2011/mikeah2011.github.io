---

title: API-Gateway-实战-Kong-APISIX-在-Laravel-微服务中的应用-统一鉴权限流路由与灰度发布踩坑记录
keywords: [API, Gateway, Kong, APISIX, Laravel, 微服务中的应用, 统一鉴权限流路由与灰度发布踩坑记录]
date: 2026-05-16 18:20:19
updated: 2026-05-16 18:23:07
categories:
- architecture
- php
tags:
- API Gateway
- Kong
- APISIX
- Laravel
- 微服务
- 限流
- 灰度发布
- JWT
description: 从单体 Laravel 演进到微服务后，API Gateway 成了绕不开的基础设施。本文以 Kong 和 Apache APISIX 为主线，结合 B2C 电商真实场景，深入对比两大网关选型差异，覆盖路由分发、JWT 统一鉴权、多级限流与熔断、Header/流量比例灰度发布、ELK+Prometheus 可观测性集成等核心能力，附带 5 个真实踩坑案例、完整可运行配置示例与落地 Checklist，适合正在评估或落地微服务网关的后端团队参考。
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
- /images/content/arch-002-content-1.jpg
- /images/diagrams/arch-002-diagram.jpg
---


# API Gateway 实战：Kong/APISIX 在 Laravel 微服务中的应用

## 为什么需要 API Gateway？

当 Laravel 单体应用演进为微服务架构后，前端或 BFF 层面对的不再是一个入口，而是 N 个服务实例。如果没有统一的网关层，每个服务都要自己处理鉴权、限流、CORS、日志——这会导致：

```
❌ 没有 Gateway 的微服务调用拓扑

  ┌─────────┐
  │  BFF    │
  └────┬────┘
       │
  ┌────┼──────────────────────────────────┐
  │    │    │         │         │         │
  ▼    ▼    ▼         ▼         ▼         ▼
订单  商品  用户     支付     库存     搜索
(各自处理鉴权/限流/CORS/日志 → 重复代码 × 6)
```

引入 API Gateway 后：

```
✅ 有 Gateway 的微服务调用拓扑

  ┌─────────┐
  │  BFF    │
  └────┬────┘
       │
       ▼
  ┌─────────┐
  │ Gateway │ ← 统一鉴权/限流/CORS/日志/灰度
  │ (Kong/  │
  │ APISIX) │
  └────┬────┘
       │
  ┌────┼──────────────────────────────────┐
  │    │    │         │         │         │
  ▼    ▼    ▼         ▼         ▼         ▼
订单  商品  用户     支付     库存     搜索
(只需关注业务逻辑)
```

## Kong vs APISIX：选型对比

在 KKday 的微服务演进过程中，我们评估了 Kong 和 Apache APISIX 两个主流方案：

| 维度 | Kong | Apache APISIX |
|------|------|---------------|
| 底层 | Nginx + Lua (OpenResty) | Nginx + Lua (OpenResty) |
| 配置存储 | PostgreSQL / Cassandra | etcd |
| 热更新 | 需要 Admin API 或 DBless | etcd watch，毫秒级生效 |
| 插件生态 | 丰富（100+ 官方插件） | 丰富（80+ 官方插件） |
| 性能 | 优秀 | 更优（RadixTree 路由） |
| Dashboard | Kong Manager（企业版） | 自带免费 Dashboard |
| 社区 | 商业公司主导 | Apache 顶级项目 |
| 学习曲线 | 中等 | 中等 |

**我们的选择**：APISIX。原因：
1. etcd 配置热更新对灰度发布更友好
2. Dashboard 免费开源
3. 性能基准测试中吞吐量更高
4. 社区活跃度在中国区更好

当然 Kong 也是优秀选择，如果你已经在用 Kong，没有必要迁移。两个产品核心能力差异不大，选型重点在于团队熟悉度和运维成本。

## 核心架构设计

![API Gateway 微服务架构设计](/images/content/arch-002-content-1.jpg)

在 B2C 电商场景下，API Gateway 的核心职责：

```
┌──────────────────────────────────────────────────────┐
│                    API Gateway (APISIX)               │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ JWT 鉴权 │ │ 限流熔断 │ │ 灰度路由 │ │ 日志采集│ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ CORS    │ │ 请求改写 │ │ 健康检查 │ │ 可观测性│ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│              Upstream Services (Laravel)              │
│                                                      │
│  order-service    product-service    member-service  │
│  payment-service  inventory-service  search-service  │
└──────────────────────────────────────────────────────┘
```

## 实战一：路由分发与服务注册

### APISIX Route 配置

以订单服务为例，通过 APISIX Admin API 注册路由：

```bash
# 创建上游服务
curl -X PUT http://127.0.0.1:9180/apisix/admin/upstreams/order-service \
  -H "X-API-KEY: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "roundrobin",
    "nodes": {
      "order-service-1:8000": 1,
      "order-service-2:8000": 1
    },
    "retries": 2,
    "retry_timeout": 3,
    "checks": {
      "active": {
        "http_path": "/health",
        "healthy": {
          "interval": 5,
          "successes": 2
        },
        "unhealthy": {
          "interval": 3,
          "http_failures": 3
        }
      }
    }
  }'

# 创建路由规则
curl -X PUT http://127.0.0.1:9180/apisix/admin/routes/order-api \
  -H "X-API-KEY: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "/api/v3/orders/*",
    "host": "api.kkday.com",
    "upstream_id": "order-service",
    "plugins": {
      "proxy-rewrite": {
        "regex_uri": ["^/api/v3/orders/(.*)", "/orders/$1"]
      }
    }
  }'
```

### 通过 APISIX Dashboard（YAML 模板）

如果团队不习惯 curl，可以用 Dashboard 的 YAML 导入功能：

```yaml
# apisix-routes.yaml
routes:
  - uri: /api/v3/orders/*
    host: api.kkday.com
    upstream_id: order-service
    plugins:
      proxy-rewrite:
        regex_uri:
          - "^/api/v3/orders/(.*)"
          - "/orders/$1"

  - uri: /api/v3/products/*
    host: api.kkday.com
    upstream_id: product-service
    plugins:
      proxy-rewrite:
        regex_uri:
          - "^/api/v3/products/(.*)"
          - "/products/$1"
```

### Laravel 端的健康检查接口

```php
// routes/web.php
Route::get('/health', fn () => response()->json([
    'status'  => 'ok',
    'service' => config('app.name'),
    'version' => config('app.version'),
    'time'    => now()->toIso8601String(),
]));
```

## 实战二：JWT 鉴权统一化

在微服务架构中，JWT 验证不应该在每个 Laravel 服务里重复做。网关层做一次验签，下游服务信任网关透传的 Header。

### APISIX jwt-auth 插件配置

```bash
# 创建 Consumer（对应一个应用/客户端）
curl -X PUT http://127.0.0.1:9180/apisix/admin/consumers/bff-app \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "username": "bff-app",
    "plugins": {
      "jwt-auth": {
        "key": "kkday-bff",
        "secret": "your-jwt-secret-key",
        "algorithm": "HS256"
      }
    }
  }'

# 在路由上启用 JWT 鉴权
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/order-api \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "jwt-auth": {}
    }
  }'
```

### 网关验签后透传用户信息

```bash
# APISIX 配置：将 JWT claims 转为 Header 透传给下游
"jwt-auth": {
  "header": "Authorization",
  "key": "kkday-bff",
  "secret": "your-jwt-secret",
  "algorithm": "HS256",
  "run_on_preflight": false
}
```

### Laravel 端信任网关透传

```php
// app/Http/Middleware/TrustGatewayHeaders.php
class TrustGatewayHeaders
{
    public function handle(Request $request, Closure $next)
    {
        // 只信任来自网关内网 IP 的请求
        if (!$this->isFromGateway($request)) {
            return response()->json(['error' => 'Direct access not allowed'], 403);
        }

        // 从网关透传的 Header 中获取用户信息
        $userId    = $request->header('X-User-Id');
        $userEmail = $request->header('X-User-Email');
        $userRoles = $request->header('X-User-Roles');

        if ($userId) {
            $request->merge([
                'gateway_user_id'    => $userId,
                'gateway_user_email' => $userEmail,
                'gateway_user_roles' => explode(',', $userRoles ?? ''),
            ]);
        }

        return $next($request);
    }

    private function isFromGateway(Request $request): bool
    {
        $gatewayIps = config('app.gateway_ips', ['10.0.0.1', '10.0.0.2']);
        return in_array($request->ip(), $gatewayIps);
    }
}
```

## 实战三：限流与熔断

![API Gateway 路由分发与限流架构](/images/diagrams/arch-002-diagram.jpg)

### APISIX 限流插件

B2C 电商场景下，不同接口需要不同的限流策略：

```bash
# 全局限流：每个 IP 每秒 100 次请求
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/order-api \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "limit-req": {
        "rate": 100,
        "burst": 50,
        "rejected_code": 429,
        "key_type": "var",
        "key": "remote_addr"
      }
    }
  }'

# 按用户限流：每个用户每分钟 60 次下单
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/create-order \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "limit-count": {
        "count": 60,
        "time_window": 60,
        "rejected_code": 429,
        "key_type": "var",
        "key": "http_x_user_id",
        "policy": "redis",
        "redis_host": "redis-cluster",
        "redis_port": 6379
      }
    }
  }'
```

### APISIX 熔断插件

当支付服务出现故障时，网关层自动熔断，避免雪崩：

```bash
# 支付服务熔断：连续 5 次失败后熔断 30 秒
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/payment-api \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "api-breaker": {
        "break_response_code": 503,
        "healthy": {
          "successes": 3
        },
        "unhealthy": {
          "http_failures": 5,
          "tcp_failures": 3,
          "timeouts": 3
        }
      }
    }
  }'
```

### Laravel 端配合限流的响应格式

```php
// app/Exceptions/Handler.php
public function register(): void
{
    $this->renderable(function (ThrottleRequestsException $e) {
        return response()->json([
            'error'   => 'rate_limit_exceeded',
            'message' => '请求过于频繁，请稍后再试',
            'retry_after' => $e->getHeaders()['Retry-After'] ?? 60,
        ], 429);
    });
}
```

## 实战四：灰度发布

灰度发布是 B2C 电商的核心需求——新版本先给 5% 用户试用，观察无异常后逐步放量。

### 基于 Header 的灰度路由

```bash
# 创建灰度版本的上游
curl -X PUT http://127.0.0.1:9180/apisix/admin/upstreams/order-service-canary \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "type": "roundrobin",
    "nodes": {
      "order-service-canary:8000": 1
    }
  }'

# 灰度路由：X-Canary: true 的请求走 canary
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/order-api \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "vars": [["http_x_canary", "==", "true"]],
    "upstream_id": "order-service-canary"
  }'
```

### 基于流量比例的灰度

```bash
# 使用 traffic-split 插件，5% 流量走 canary
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/order-api \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "traffic-split": {
        "rules": [
          {
            "weighted_upstreams": [
              {"upstream_id": "order-service", "weight": 95},
              {"upstream_id": "order-service-canary", "weight": 5}
            ]
          }
        ]
      }
    }
  }'
```

### BFF 层配合灰度的 Header 透传

```php
// app/Http/Middleware/CanaryRouting.php
class CanaryRouting
{
    public function handle(Request $request, Closure $next)
    {
        // 内部测试用户走灰度
        $user = $request->user();
        if ($user && in_array($user->email, config('canary.test_users'))) {
            $request->headers->set('X-Canary', 'true');
        }

        // Cookie 标记走灰度（前端 A/B 测试用）
        if ($request->cookie('x-canary') === 'true') {
            $request->headers->set('X-Canary', 'true');
        }

        return $next($request);
    }
}
```

## 实战五：可观测性集成

### APISIX 日志插件 → ELK

```bash
# 将访问日志推送到 Kafka，再由 Logstash 消费到 ES
curl -X PATCH http://127.0.0.1:9180/apisix/admin/routes/order-api \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "kafka-logger": {
        "broker_list": {
          "kafka-1:9092": 1,
          "kafka-2:9092": 1
        },
        "kafka_topic": "apisix-access-log",
        "batch_max_size": 1000,
        "buffer_duration": 5,
        "inactive_timeout": 5
      }
    }
  }'
```

### Prometheus 指标采集

```bash
# 启用 prometheus 插件（全局）
curl -X PUT http://127.0.0.1:9180/apisix/admin/plugin_config/global \
  -H "X-API-KEY: your-admin-key" \
  -d '{
    "plugins": {
      "prometheus": {
        "prefer_name": true
      }
    }
  }'

# 访问指标端点
# curl http://127.0.0.1:9091/apisix/prometheus/metrics
```

```yaml
# Grafana Dashboard 核心指标
# - apisix_http_status{route, upstream}        → 各路由 QPS 和状态码分布
# - apisix_http_latency_bucket{route}           → P50/P95/P99 延迟
# - apisix_upstream_status{upstream}            → 上游健康状态
# - apisix_bandwidth{route, direction}          → 带宽使用
```

## 踩坑记录

### 坑 1：etcd 集群脑裂导致路由丢失

**现象**：凌晨 3 点突然大量 404，所有 API 路由失效。

**原因**：APISIX 依赖 etcd 存储配置，etcd 集群因网络分区出现脑裂，少数派节点被移除后路由信息丢失。

**解决**：
```yaml
# etcd 配置加固
# etcd.conf.yml
election-timeout: 5000
heartbeat-interval: 500
auto-compaction-mode: periodic
auto-compaction-retention: "8h"  # 自动压缩防止空间不足
```

**教训**：etcd 至少部署 3 节点，且要用独立的监控告警（etcd_disk_wal_fsync_duration_seconds > 10ms 时告警）。

### 坑 2：proxy-rewrite 与 CORS 插件顺序问题

**现象**：前端跨域请求返回 `CORS header missing`，但 curl 测试正常。

**原因**：APISIX 插件按配置顺序执行。`proxy-rewrite` 改写了 URI 后，`cors` 插件的 `allow_origins` 匹配逻辑基于原始 Host，而非改写后的 Host，导致 CORS 头未正确添加。

**解决**：确保 `cors` 插件在 `proxy-rewrite` 之前配置：

```json
{
  "plugins": {
    "cors": {
      "allow_origins": "*",
      "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
      "allow_headers": "Authorization,Content-Type,X-Request-Id",
      "max_age": 86400
    },
    "proxy-rewrite": {
      "regex_uri": ["^/api/v3/orders/(.*)", "/orders/$1"]
    }
  }
}
```

### 坑 3：限流 key 选取不当导致误杀

**现象**：用户反馈偶尔被限流，但单个用户 QPS 不高。

**原因**：限流 key 使用了 `remote_addr`，而公司出口 IP 只有 2-3 个，所有员工共享限流配额。

**解决**：
```json
{
  "limit-count": {
    "count": 60,
    "time_window": 60,
    "key": "http_x_user_id",  // 改为按用户 ID 限流
    "key_type": "var",
    "rejected_code": 429
  }
}
```

**教训**：限流 key 的选取要结合业务场景。内部调用按服务名，外部调用按用户 ID，匿名接口按 IP。

### 坑 4：健康检查导致上游服务过载

**现象**：服务重启期间，健康检查间隔太短，大量探测请求打满 Laravel 进程池。

**解决**：
```json
{
  "checks": {
    "active": {
      "http_path": "/health",
      "healthy": {
        "interval": 10,      // 10 秒检查一次
        "successes": 3        // 连续 3 次成功才标记为健康
      },
      "unhealthy": {
        "interval": 5,
        "http_failures": 5,   // 连续 5 次失败才标记为不健康
        "timeouts": 3
      }
    },
    "passive": {
      "healthy": {
        "successes": 3
      },
      "unhealthy": {
        "http_failures": 5,
        "tcp_failures": 3,
        "timeouts": 3
      }
    }
  }
}
```

### 坑 5：网关层与 Laravel 服务时区不一致

**现象**：JWT token 的 `exp` 校验偶尔失败，日志时间对不上。

**原因**：APISIX Docker 容器用 UTC，Laravel 服务用 Asia/Taipei，JWT 过期时间差了 8 小时。

**解决**：所有容器统一挂载时区文件：

```yaml
# docker-compose.yml
services:
  apisix:
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    environment:
      - TZ=Asia/Taipei

  order-service:
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    environment:
      - TZ=Asia/Taipei
```

## 总结：API Gateway 落地 Checklist

```
□ 路由分发：所有外部流量统一经过 Gateway
□ JWT 鉴权：Gateway 层验签，下游信任透传 Header
□ 限流策略：全局 + 按用户 + 按接口分级限流
□ 熔断机制：上游故障自动熔断，防止雪崩
□ 灰度发布：支持 Header 标记 + 流量比例两种模式
□ 可观测性：接入 Prometheus + Grafana + ELK
□ 健康检查：主动 + 被动双重检查，合理间隔
□ 配置备份：etcd 定期备份，防止配置丢失
□ 灾备方案：Gateway 本身高可用（至少 2 节点 + LB）
□ 文档沉淀：所有路由规则、插件配置纳入版本管理
```

API Gateway 不是银弹，但在微服务架构中它是不可或缺的「门卫」。选型时不必纠结 Kong 还是 APISIX——核心能力相似，重点在于团队的运维能力和业务场景的匹配度。先用最简单的路由分发 + JWT 鉴权跑起来，再逐步叠加限流、灰度、可观测性，才是最务实的落地路径。

## 附录：Kong 同等功能配置参考

上面的实战示例以 APISIX 为主。如果你选用 Kong，以下是等价配置：

### Kong 路由 + 限流（decK 声明式配置）

```yaml
# kong.yml (decK 声明式配置)
_format_version: "3.0"

services:
  - name: order-service
    url: http://order-service:8000
    routes:
      - name: order-api
        paths:
          - /api/v3/orders
        strip_path: true
    plugins:
      - name: rate-limiting
        config:
          minute: 60
          policy: redis
          redis_host: redis-cluster
          redis_port: 6379
          fault_tolerant: true
      - name: jwt
      - name: cors
        config:
          origins:
            - "*"
          methods:
            - GET
            - POST
            - PUT
            - DELETE
          headers:
            - Authorization
            - Content-Type
          max_age: 86400
```

```bash
# 使用 decK 同步配置到 Kong
deck sync -s kong.yml --kong-addr http://localhost:8001
```

### Kong 灰度发布（基于 Canary 插件）

```bash
# 安装 canary 社区插件后配置
curl -X POST http://localhost:8001/services/order-service/plugins \
  --data "name=canary" \
  --data "config.start=1" \
  --data "config.duration=3600" \
  --data "config.percentage=5" \
  --data "config.upstream_host=order-service-canary" \
  --data "config.upstream_port=8000" \
  --data "config.hash=consumer"
```

## 相关阅读

- [负载均衡实战：Nginx Upstream + Laravel Session 共享](/architecture/load-balancingguide-nginx-upstream-laravel-session/) — API Gateway 下游的负载均衡与 Session 共享方案
- [链路追踪实战：Jaeger/SkyWalking](/architecture/distributed-tracing-jaeger-skywalking/) — 微服务调用链追踪，与网关可观测性互补
- [Webhook 集成最佳实践](/architecture/webhook-best-practices/) — 网关层 Webhook 路由与重试策略
