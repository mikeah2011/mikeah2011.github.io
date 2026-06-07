---
title: 服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦
date: 2026-06-06 01:38:35
description: 深入实战 Envoy Sidecar 模式在 Laravel B2C 电商 API 中的落地：流量镜像实现零风险影子测试、熔断器防止级联雪崩、透明重试与幂等键保障容错，附完整 Docker Compose 编排、踩坑记录与 Prometheus 监控方案，帮你把基础设施逻辑从业务代码中彻底解耦。
tags: [Envoy, Service Mesh, Sidecar, Laravel, 流量镜像, 熔断, 重试]
categories: [运维]
cover: /images/covers/envoy-sidecar-laravel-cover.jpg
---

## 前言：为什么 Laravel 应用需要 Sidecar？

在传统 B2C 架构中，Laravel 应用承担了太多职责：限流、熔断、重试、请求路由……这些逻辑散落在中间件、Service Provider 和各种第三方包中。当你的 Laravel API 面对每秒数万次请求时，PHP 的进程模型决定了在应用层处理这些"基础设施级"逻辑既低效又难以统一管理。

**Sidecar 模式**的核心思想是：将通信、安全、可观测性等横切关注点从应用中剥离，下沉到一个与应用进程共享网络命名空间的旁路代理中。Envoy Proxy 作为 CNCF 毕业项目，是实现这一模式的最佳选择之一。

本文将以一个真实的 B2C 电商 API 场景，完整演示如何用 Envoy Sidecar 为 Laravel 应用注入流量镜像、熔断和重试能力，实现基础设施与业务逻辑的彻底解耦。

---

## 一、Sidecar 模式架构总览

```
┌─────────────────── Pod / Container Group ───────────────────┐
│                                                              │
│  ┌──────────────┐    localhost:9000    ┌──────────────────┐  │
│  │              │ ◄──────────────────► │                  │  │
│  │  Laravel App │    (内部通信)        │  Envoy Sidecar   │  │
│  │  (PHP-FPM)   │                     │  Proxy           │  │
│  │  :80         │                     │  :8080 (入口)    │  │
│  └──────────────┘                     │  :9901 (管理)    │  │
│                                       └──────────────────┘  │
│                                              │               │
└──────────────────────────────────────────────┼───────────────┘
                                               │
                                    外部流量 ──►│
```

外部流量全部经由 Envoy 的 `:8080` 入口端口进入，Envoy 负责路由、限流、熔断后，再将请求转发给本地 Laravel 的 `:80`。Laravel 完全不感知这些基础设施逻辑。

---

## 二、Docker Compose 编排

以下是一个生产可用的 `docker-compose.yml`，将 Laravel 和 Envoy 打包为同一服务单元：

```yaml
version: "3.9"

services:
  laravel-app:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - ./storage:/var/www/html/storage
    networks:
      - mesh
    # Laravel 只监听 localhost，不暴露到外部
    expose:
      - "80"

  envoy-sidecar:
    image: envoyproxy/envoy:v1.31-latest
    volumes:
      - ./envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro
      - ./envoy/certs:/etc/envoy/certs:ro
    ports:
      - "8080:8080"   # 入口流量
      - "9901:9901"   # 管理接口（仅供内部监控）
    networks:
      - mesh
    depends_on:
      - laravel-app
    command: ["envoy", "-c", "/etc/envoy/envoy.yaml", "--log-level", "info"]

networks:
  mesh:
    driver: bridge
```

**关键设计**：Laravel 容器不直接暴露端口，所有外部流量必须经过 Envoy。这保证了策略执行的一致性。

---

## 三、Envoy 核心配置：流量管理三件套

以下是 `envoy.yaml` 的完整配置，涵盖路由、流量镜像、熔断和重试：

```yaml
static_resources:
  listeners:
    - name: ingress_listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8080
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ingress_http
                route_config:
                  name: local_route
                  virtual_hosts:
                    - name: laravel_backend
                      domains: ["*"]
                      routes:
                        # 订单相关接口 - 带流量镜像
                        - match:
                            prefix: "/api/v1/orders"
                          route:
                            cluster: laravel_primary
                            timeout: 10s
                            # 流量镜像：将 100% 流量复制到影子集群
                            request_mirror_policies:
                              - cluster: laravel_shadow
                                runtime_fraction:
                                  default_value:
                                    numerator: 100
                                    denominator: HUNDRED
                            # 重试策略
                            retry_policy:
                              retry_on: "5xx,reset,connect-failure,refused-stream"
                              num_retries: 3
                              per_try_timeout: 3s
                              retriable_status_codes: [502, 503, 504]
                              retry_back_off:
                                base_interval: 0.25s
                                max_interval: 2s
                        # 通用 API 路由
                        - match:
                            prefix: "/api"
                          route:
                            cluster: laravel_primary
                            timeout: 5s
                            retry_policy:
                              retry_on: "5xx,reset,connect-failure"
                              num_retries: 2
                              per_try_timeout: 2s
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    # 主集群 - Laravel 正常实例
    - name: laravel_primary
      connect_timeout: 2s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: laravel_primary
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: laravel-app
                      port_value: 80
      # 熔断配置
      circuit_breakers:
        thresholds:
          - priority: DEFAULT
            max_connections: 1024
            max_pending_requests: 512
            max_requests: 2048
            max_retries: 3
            # 连续 5xx 错误触发熔断
            consecutive_5xx: 5
            # 熔断恢复间隔
            interval: 30s
            # 触发熔断的最小请求数
            base_ejection_time: 30s
            max_ejection_percent: 50
      # 健康检查
      health_checks:
        - timeout: 2s
          interval: 10s
          unhealthy_threshold: 3
          healthy_threshold: 2
          http_health_check:
            path: "/api/health"
            expected_statuses:
              - start: 200
                end: 299

    # 影子集群 - 用于流量镜像测试
    - name: laravel_shadow
      connect_timeout: 2s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: laravel_shadow
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: laravel-shadow
                      port_value: 80

admin:
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901
```

---

## 四、流量镜像实战：B2C 订单接口的影子测试

### 场景描述

你的电商系统正在重构订单模块（`/api/v1/orders`），新版本用 Laravel 11 + Octane 重写。你需要在不影响生产流量的前提下，将真实请求镜像到新版本进行验证。

### 工作原理

```
用户请求 ──► Envoy ──┬──► laravel_primary (生产)  ──► 返回响应给用户
                     │
                     └──► laravel_shadow  (影子)   ──► 响应被丢弃
```

Envoy 的 `request_mirror_policies` 会将原始请求异步复制一份发送到影子集群。影子集群的响应不会返回给客户端，因此零风险。

### 关键细节

- 镜像请求是**fire-and-forget**，不增加用户感知延迟
- 影子环境的数据库应使用生产数据的只读副本或独立实例
- 通过 `runtime_fraction` 可动态调整镜像比例，无需重启 Envoy：

```bash
# 通过管理接口动态调整为 50% 流量镜像
curl -XPOST http://localhost:9901/runtime_modify \
  -d "envoy.lb.request_mirror.request_mirror_policies.laravel_shadow.runtime_fraction.default_value.numerator=50"
```

---

## 五、熔断机制：保护 Laravel 免受雪崩

### 为什么需要熔断？

假设你的 Laravel 订单服务依赖下游支付网关。当支付网关响应变慢（从 200ms 飙到 10s），PHP-FPM 进程会被大量慢请求占满，导致整个 API 瘫痪——这就是经典的**级联故障**。

Envoy 的熔断器在 Sidecar 层面拦截，PHP-FPM 进程不会被拖垮：

```
正常状态：请求 ──► Envoy ──► Laravel ──► 支付网关 ✓
                    │
异常状态：请求 ──► Envoy(熔断触发) ──► 直接返回 503 ✗
                    │                    Laravel 未受影响
```

### 配置解读

```yaml
circuit_breakers:
  thresholds:
    - priority: DEFAULT
      max_connections: 1024        # 最大连接数
      max_pending_requests: 512    # 最大排队请求数
      max_requests: 2048           # 最大并发请求数
      max_retries: 3               # 最大重试并发数
```

配合 Outlier Detection（离群值检测），Envoy 可以自动将不健康的后端节点踢出负载均衡池：

```yaml
outlier_detection:
  consecutive_5xx: 5                # 连续 5 个 5xx 触发弹出
  interval: 30s                     # 检测间隔
  base_ejection_time: 30s           # 基础弹出时间
  max_ejection_percent: 50          # 最多弹出 50% 节点
  success_rate_minimum_hosts: 3     # 至少 3 个节点才启用成功率检测
  success_rate_stdev_factor: 1900   # 标准差因子
```

### Laravel 端配合

在 Laravel 中添加健康检查端点，让 Envoy 能感知应用状态：

```php
// routes/api.php
Route::get('/health', function () {
    $checks = [
        'database' => DB::connection()->getPdo() ? 'ok' : 'fail',
        'redis' => Redis::ping() ? 'ok' : 'fail',
        'queue' => Queue::size() < 10000 ? 'ok' : 'backlog',
    ];

    $healthy = !in_array('fail', $checks);

    return response()->json([
        'status' => $healthy ? 'healthy' : 'degraded',
        'checks' => $checks,
        'timestamp' => now()->toIso8601String(),
    ], $healthy ? 200 : 503);
});
```

---

## 六、重试策略：透明容错

### 设计原则

Envoy 的重试是**透明的**——Laravel 不需要知道请求被重试过。但不当的重试会放大故障，因此必须遵循以下原则：

1. **只重试幂等操作**：GET、PUT、DELETE 可以重试，POST 创建订单需要谨慎
2. **设置 per-try-timeout**：单次重试超时应远小于总超时
3. **使用指数退避**：避免重试风暴

### B2C 订单场景的重试配置

```yaml
retry_policy:
  retry_on: "5xx,reset,connect-failure,refused-stream"
  num_retries: 3
  per_try_timeout: 3s
  retriable_status_codes: [502, 503, 504]
  retry_back_off:
    base_interval: 0.25s      # 首次退避 250ms
    max_interval: 2s           # 最大退避 2s
  # 针对特定 header 的重试（如请求幂等键）
  retriable_headers:
    - name: "x-idempotency-key"
      present_match: true
```

### Laravel 幂等键中间件

为确保 POST 请求重试的安全性，Laravel 端需要幂等键支持：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Cache;

class IdempotencyMiddleware
{
    public function handle($request, Closure $next)
    {
        $key = $request->header('X-Idempotency-Key');

        if (!$key || !$request->isMethod('POST')) {
            return $next($request);
        }

        $cacheKey = "idempotency:{$key}";
        $ttl = 86400; // 24 小时

        // 检查是否已处理过
        if (Cache::has($cacheKey)) {
            $cached = Cache::get($cacheKey);
            return response()->json(
                $cached['body'],
                $cached['status']
            )->header('X-Idempotent-Replayed', 'true');
        }

        $response = $next($request);

        // 缓存成功的响应
        if ($response->isSuccessful()) {
            Cache::put($cacheKey, [
                'body' => json_decode($response->getContent(), true),
                'status' => $response->getStatusCode(),
            ], $ttl);
        }

        return $response;
    }
}
```

---

## 七、踩坑记录与最佳实践

### 踩坑 1：PHP-FPM 超时冲突

**现象**：Envoy 配置了 10s 超时，但 Laravel 请求仍然 504。

**根因**：PHP-FPM 的 `request_terminate_timeout` 默认为 0（不超时），但 `max_execution_time` 在 CLI 模式下不生效，导致进程永远不释放。

**解决**：在 `php-fpm.conf` 中同步设置：

```ini
request_terminate_timeout = 8s   ; 比 Envoy 超时短 2s
request_slowlog_timeout = 3s
```

### 踩坑 2：流量镜像导致数据库压力翻倍

**现象**：开启流量镜像后，数据库 CPU 飙升到 90%。

**根因**：影子环境直接连了生产数据库的写实例。

**解决**：
- 影子环境使用只读副本
- 在 Laravel 侧用中间件标记镜像请求，跳过写操作：

```php
// 检测 Envoy 镜像请求的特征
if ($request->header('x-envoy-internal')) {
    // 只执行读操作，跳过写入
    config(['database.default' => 'mysql_readonly']);
}
```

### 踩坑 3：Envoy 管理接口暴露到公网

**现象**：安全扫描发现 `:9901` 端口可从外部访问，攻击者可通过管理接口修改配置。

**解决**：管理接口只绑定 `127.0.0.1`，并用 NetworkPolicy / 安全组限制：

```yaml
admin:
  address:
    socket_address:
      address: 127.0.0.1    # 仅本地访问
      port_value: 9901
```

### 踩坑 4：重试风暴压垮下游

**现象**：下游服务抖动时，重试放大了 3 倍流量。

**解决**：
- 配合熔断器，当错误率超阈值时自动停止重试
- 使用 `retry_budget` 限制重试比例：

```yaml
retry_policy:
  retry_budget:
    budget_percent:
      value: 20.0           # 重试请求不超过总请求的 20%
    min_retry_concurrency: 3
```

### 最佳实践清单

| 实践 | 说明 |
|------|------|
| 逐功能开启 | 先路由，再重试，再熔断，最后镜像 |
| 监控先行 | 部署 Envoy 后先跑一周 `envoy-stats` 再开启高级功能 |
| 超时层级递减 | Client > Envoy > PHP-FPM > 下游服务 |
| 日志关联 | 传递 `x-request-id` 贯穿全链路 |
| 资源限制 | 为 Sidecar 设置 CPU/Memory limits，避免挤占应用资源 |

---

## 八、可观测性：让 Sidecar 不再是黑盒

Envoy 内置 Prometheus 指标端点，配合 Grafana 可以直观展示熔断、重试、流量镜像的状态：

```yaml
# docker-compose.yml 中添加
prometheus:
  image: prom/prometheus
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  ports:
    - "9090:9090"
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'envoy'
    metrics_path: '/stats/prometheus'
    static_configs:
      - targets: ['envoy-sidecar:9901']
```

关键监控指标：

- `cluster.laravel_primary.upstream_rq_retry`：重试次数
- `cluster.laravel_primary.circuit_breaker.*`：熔断器状态
- `cluster.laravel_shadow.upstream_rq_total`：镜像流量总量
- `cluster.laravel_primary.upstream_rq_5xx`：5xx 错误率

---

## 九、总结

通过 Envoy Sidecar 模式，我们实现了：

1. **流量镜像**：零风险验证新版 Laravel API，真实流量 1:1 复制
2. **熔断保护**：在代理层拦截级联故障，PHP-FPM 进程不再被慢下游拖垮
3. **透明重试**：应用代码零修改，自动处理瞬时故障
4. **统一观测**：所有流量指标集中在 Envoy 层暴露

Sidecar 模式的本质是**关注点分离**——让 Laravel 专注于业务逻辑，让 Envoy 处理基础设施级的流量治理。这种架构虽然引入了额外的资源开销（每个 Sidecar 约 50MB 内存），但对于中等规模以上的 B2C API 来说，其带来的运维灵活性和系统健壮性远远超过成本。

---

## 相关阅读

- [Service Mesh Sidecar Envoy Proxy Laravel 流量镜像熔断重试](/categories/运维/Service-Mesh-Sidecar-Envoy-Proxy-Laravel-流量镜像熔断重试/)
- [Dapr 实战：分布式应用运行时 Laravel 微服务的 Sidecar 模式服务调用与发布订阅](/categories/架构/Dapr-实战-分布式应用运行时-Laravel微服务的Sidecar模式服务调用与发布订阅/)
- [Canary Deployment 渐进式流量放量：Nginx Envoy 权重路由与 Laravel 版本共存](/categories/运维/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/)

下一篇，我们将深入探讨如何用 Istio 替代手动 Sidecar 配置，实现声明式的服务网格管理。
