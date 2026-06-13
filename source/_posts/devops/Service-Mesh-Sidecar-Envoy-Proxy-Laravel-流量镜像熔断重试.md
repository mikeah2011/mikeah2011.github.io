---
title: 服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦
date: 2026-06-06 00:00:00
tags: [Envoy, Service-Mesh, Sidecar, Laravel, 流量镜像, 熔断, 重试]
categories:
  - devops
cover: /images/covers/service-mesh-sidecar-envoy-cover.jpg
description: "深入实战 Service Mesh Sidecar 模式，以 Envoy Proxy + Laravel 为核心，从零搭建流量镜像、熔断、重试的基础设施下沉方案。不依赖 Istio 重量级框架，聚焦 Sidecar 模式本身——覆盖 Envoy 配置热加载、xDS 协议、Circuit Breaking 熔断策略、自动重试与退避算法、流量镜像灰度验证、Guzzle 中间件对比、Docker Compose 编排、Prometheus 监控指标采集，以及生产环境的内存泄漏排查与连接池调优踩坑。适合 Laravel 微服务团队将流量治理能力从应用层解耦到基础设施层。"
---

# 服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦

## 前言

在微服务架构持续演进的今天，流量治理能力——包括熔断、重试、限流、流量镜像等——已经从「锦上添花」的优化手段，变成了保障系统可用性的基石能力。然而，当这些能力散落在各个应用服务的代码库中时，我们面临的不仅是重复实现的问题，更是技术栈绑定、治理策略不可控、故障域扩大等一系列深层矛盾。

本文将以 Laravel（PHP）应用为切入点，结合 Envoy Proxy 的 Sidecar 模式，从零搭建一套完整的流量治理基础设施。我们不使用 Istio 这样的重量级 Service Mesh 平台，而是聚焦于最底层的 Sidecar 模式本身——因为理解了这一层，上层的所有编排框架都只是配置差异。

---

## 一、为什么需要 Sidecar 模式：应用层治理的痛点

### 1.1 传统方案的困境

在一个典型的 Laravel 微服务架构中，服务间的调用治理通常有以下几种实现路径：

**方案 A：SDK 嵌入式治理（如 Guzzle 中间件 + 自定义熔断逻辑）**

```php
// app/Services/CircuitBreaker.php
class CircuitBreaker
{
    private string $key;
    private int $failureThreshold;
    private int $timeout;

    public function call(Closure $callback): mixed
    {
        if ($this->isOpen()) {
            throw new CircuitOpenException("Circuit is open for {$this->key}");
        }
        try {
            $result = $callback();
            $this->recordSuccess();
            return $result;
        } catch (\Throwable $e) {
            $this->recordFailure();
            throw $e;
        }
    }
    // ... 省略 Redis 状态管理、半开探测等逻辑
}
```

这种方案的问题是：

1. **重复实现**：每个语言栈（PHP/Go/Node.js）都需要独立实现一套完整的治理逻辑，且行为一致性难以保证。
2. **与业务代码耦合**：治理逻辑散落在 Service 层、Middleware 层、甚至 Controller 层，排查问题时需要在多个抽象层间跳转。
3. **升级成本高**：修改重试策略或熔断参数需要重新部署整个应用，无法做到热更新。
4. **可观测性割裂**：每个服务自行埋点上报 metrics，格式和标签体系各异，难以统一构建监控大盘。

**方案 B：共享库 + 配置中心**

将治理逻辑抽象为 Composer 包，通过配置中心（如 Consul、Nacos）动态获取策略参数。这解决了部分热更新问题，但核心矛盾依然存在——治理逻辑仍然在应用进程内执行，与业务代码共享同一个故障域。

### 1.2 Sidecar 模式的本质：基础设施下沉

Sidecar 模式的核心思想是：**将网络治理能力从应用进程中剥离，下沉到一个独立的代理进程中**。这个代理进程（Sidecar）与应用容器共享同一个网络命名空间（network namespace），对应用而言完全透明。

```
┌─────────────────────────────────────┐
│           Pod / 容器组              │
│  ┌─────────────┐  ┌──────────────┐ │
│  │  Laravel App │  │    Envoy     │ │
│  │  (port 9000) │◄─►│  (port 8000) │ │
│  └─────────────┘  └──────┬───────┘ │
│                          │         │
└──────────────────────────┼─────────┘
                           │
                    ┌──────┴───────┐
                    │  Upstream    │
                    │  Services    │
                    └──────────────┘
```

应用只需要向 `localhost:8000` 发送 HTTP 请求，所有重试、熔断、流量镜像、超时控制等行为均由 Envoy Sidecar 自动处理。应用代码中**零治理逻辑**。

---

## 二、Envoy Proxy 核心架构与 xDS 协议

### 2.1 架构概览

Envoy 是一个由 Lyft 开源的高性能 L7 代理，其设计哲学是「面向可观测性的网络代理」。核心架构包含以下关键组件：

- **Listener**：监听端口，接收入站/出站连接。每个 Listener 绑定一组 Filter Chain。
- **Filter Chain**：一组有序的 Filter，对经过的流量进行处理（如 HTTP 路由、限流、认证等）。
- **Cluster**：上游服务集群的抽象，包含服务发现、负载均衡策略、熔断配置、连接池参数等。
- **Route**：路由规则，将匹配条件映射到目标 Cluster。
- **xDS API**：动态配置接口，支持运行时热更新所有配置。

### 2.2 xDS 协议族

xDS 是 Envoy 的灵魂所在，它是一组基于 gRPC 的配置发现协议：

| 协议 | 全称 | 作用 |
|------|------|------|
| LDS | Listener Discovery Service | 动态发现 Listener 配置 |
| RDS | Route Discovery Service | 动态发现路由规则 |
| CDS | Cluster Discovery Service | 动态发现上游集群 |
| EDS | Endpoint Discovery Service | 动态发现集群实例 |
| SDS | Secret Discovery Service | 动态发现 TLS 证书 |
| ADS | Aggregated Discovery Service | 聚合所有 xDS，保证一致性更新 |

在我们的实战场景中，我们采用静态配置（static configuration）起步，但会为后续迁移到 xDS 动态配置预留架构空间。

### 2.3 Envoy 的 Filter 机制

Envoy 的流量处理管线（Filter Chain）是理解 Sidecar 模式的关键。对于 HTTP 流量，典型的 Filter 顺序为：

```
Listener Filter (TLS Inspector)
  └─ Network Filter (HTTP Connection Manager)
       ├─ HTTP Filter: Router
       ├─ HTTP Filter: Fault Injection
       ├─ HTTP Filter: Rate Limit
       └─ HTTP Filter: CORS
```

每个 Filter 都可以对请求/响应进行读取、修改、拒绝或放行操作。熔断和重试就是在 Cluster 和 Route Filter 层面配置的。

---

## 三、Docker Compose 搭建 Laravel + Envoy Sidecar 环境

### 3.1 整体架构设计

我们搭建以下环境：

- **laravel-app**：Laravel 应用容器（PHP-FPM + Nginx）
- **envoy-sidecar**：Envoy Sidecar 容器，与 Laravel 共享网络
- **upstream-service**：模拟上游依赖服务（另一个 Nginx 容器）
- **envoy-sidecar-v2**：用于流量镜像的目标服务

### 3.2 Envoy 配置文件

```yaml
# envoy.yaml
static_resources:
  listeners:
    # 出站监听器：拦截 Laravel 发出的 HTTP 请求
    - name: outbound_listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 10000
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: egress_http
                route_config:
                  name: outbound_routes
                  virtual_hosts:
                    - name: upstream_service
                      domains: ["upstream.local"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: upstream_primary
                            timeout: 5s
                            retry_policy:
                              retry_on: "5xx,reset,connect-failure,refused-stream"
                              num_retries: 3
                              retry_back_off:
                                base_interval: 0.25s
                                max_interval: 2s
                            # 流量镜像配置
                            request_mirror_policies:
                              - cluster: upstream_mirror
                                runtime_fraction:
                                  default_value:
                                    numerator: 100
                                    denominator: HUNDRED
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    # 主集群：上游生产服务
    - name: upstream_primary
      connect_timeout: 2s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: upstream_primary
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: upstream-service
                      port_value: 80
      # 熔断配置
      circuit_breakers:
        thresholds:
          - priority: DEFAULT
            max_connections: 1024
            max_pending_requests: 256
            max_requests: 1024
            max_retries: 3
            # 跟踪熔断器状态的统计桶
            retry_budget:
              budget_percent:
                value: 20.0
              min_retry_concurrency: 3
      # 连接池配置
      upstream_connection_options:
        tcp_keepalive:
          keepalive_time: 300
      # 健康检查
      health_checks:
        - timeout: 2s
          interval: 5s
          unhealthy_threshold: 3
          healthy_threshold: 2
          http_health_check:
            path: "/health"
            expected_statuses:
              - start: 200
                end: 299

    # 镜像集群：接收影子流量的服务
    - name: upstream_mirror
      connect_timeout: 2s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: upstream_mirror
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: envoy-sidecar-v2
                      port_value: 80
```

### 3.3 Docker Compose 编排

```yaml
# docker-compose.yml
version: "3.8"

services:
  # 模拟上游依赖服务
  upstream-service:
    image: nginx:alpine
    volumes:
      - ./upstream/nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - mesh-net

  # 流量镜像目标（影子服务）
  envoy-sidecar-v2:
    image: nginx:alpine
    volumes:
      - ./mirror/nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - mesh-net

  # Envoy Sidecar
  envoy-sidecar:
    image: envoyproxy/envoy:v1.31-latest
    volumes:
      - ./envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro
    command: envoy -c /etc/envoy/envoy.yaml --log-level info
    ports:
      - "9901:9901"  # 管理接口（Prometheus 指标）
    networks:
      - mesh-net
    depends_on:
      - upstream-service
      - envoy-sidecar-v2

  # Laravel 应用
  laravel-app:
    build:
      context: ./laravel
      dockerfile: Dockerfile
    volumes:
      - ./laravel:/var/www/html
    environment:
      - UPSTREAM_URL=http://localhost:10000  # 指向 Sidecar
    networks:
      - mesh-net
    depends_on:
      - envoy-sidecar

networks:
  mesh-net:
    driver: bridge
```

> **关键点**：`laravel-app` 和 `envoy-sidecar` 在同一个 Docker Compose 服务中，但在生产环境的 Kubernetes 场景下，它们会被放入同一个 Pod，共享 `localhost` 网络。Docker Compose 中我们通过 `networks` 来模拟这种网络共享。

### 3.4 Laravel 侧的应用代码

应用代码极度简洁——所有治理逻辑完全不感知：

```php
// app/Services/OrderService.php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class OrderService
{
    public function createOrder(array $data): array
    {
        // 直接向 Sidecar 发送请求，无需任何治理逻辑
        // 重试、熔断、超时、流量镜像全部由 Envoy 处理
        $response = Http::timeout(3)
            ->withHeaders(['X-Request-ID' => request()->header('X-Request-ID', uniqid())])
            ->post('http://localhost:10000/orders', $data);

        return $response->json();
    }

    public function getOrder(string $id): array
    {
        $response = Http::timeout(3)
            ->get("http://localhost:10000/orders/{$id}");

        return $response->json();
    }
}
```

注意代码中**没有任何 CircuitBreaker 类、没有 RetryMiddleware、没有重试逻辑**。所有的流量治理都是基础设施层完成的。

---

## 四、流量镜像（Traffic Mirroring）配置实战

### 4.1 什么是流量镜像

流量镜像（也称影子流量，Shadow Traffic）是指将生产流量的一个副本异步发送到另一个服务实例，用于：

- **新版本灰度验证**：在不影响生产用户的前提下，验证新版本的响应正确性和性能。
- **回归测试**：将线上真实流量回放到测试环境，发现潜在的兼容性问题。
- **数据分析**：对生产流量进行离线分析，无需侵入式埋点。

### 4.2 Envoy 流量镜像配置详解

在 Route 配置中添加 `request_mirror_policies`：

```yaml
routes:
  - match:
      prefix: "/orders"
    route:
      cluster: upstream_primary
      timeout: 5s
      request_mirror_policies:
        - cluster: upstream_mirror
          # 控制镜像比例（100% = 全部镜像）
          runtime_fraction:
            default_value:
              numerator: 100
              denominator: HUNDRED
```

关键参数说明：

- **cluster**：镜像流量的目标集群。Envoy 会发送一份完整的请求副本到该集群，但**丢弃镜像服务的响应**，不会将其返回给客户端。
- **runtime_fraction.numerator/denominator**：控制镜像比例。如果设置 `numerator: 10`，则只有 10% 的流量会被镜像。
- **trace_sampled**（可选）：是否对镜像流量进行分布式追踪采样。

### 4.3 验证流量镜像

```bash
# 发送请求到主服务
curl -v http://localhost:10000/orders \
  -H "Content-Type: application/json" \
  -d '{"product_id": 123, "quantity": 2}'

# 检查主服务日志
docker-compose logs upstream-service

# 检查镜像服务日志——应该可以看到相同的请求
docker-compose logs envoy-sidecar-v2
```

### 4.4 按路由路径选择性镜像

在实际场景中，你可能只想镜像特定的路由（如只镜像 GET 请求，不镜像写操作）：

```yaml
routes:
  # 只读接口：全量镜像
  - match:
      prefix: "/api/orders"
      headers:
        - name: ":method"
          exact_match: "GET"
    route:
      cluster: upstream_primary
      request_mirror_policies:
        - cluster: upstream_mirror
  # 写接口：10% 镜像
  - match:
      prefix: "/api/orders"
    route:
      cluster: upstream_primary
      request_mirror_policies:
        - cluster: upstream_mirror
          runtime_fraction:
            default_value:
              numerator: 10
              denominator: HUNDRED
```

---

## 五、熔断器（Circuit Breaker）配置与测试

### 5.1 Envoy 熔断器的分级机制

Envoy 的熔断不是简单的「开/关」二态，而是一个多级阈值控制系统。每个 Cluster 可以配置以下熔断维度：

| 维度 | 配置项 | 说明 |
|------|--------|------|
| 最大连接数 | `max_connections` | 上游集群的 TCP 连接数上限 |
| 最大等待请求 | `max_pending_requests` | 等待可用连接的请求队列长度 |
| 最大并发请求 | `max_requests` | 同一时刻飞行中的请求数上限 |
| 最大重试次数 | `max_retries` | 并发重试请求的上限 |
| 连接池溢出 | `track_remaining` | 是否记录剩余可用量 |

```yaml
clusters:
  - name: upstream_primary
    circuit_breakers:
      thresholds:
        - priority: DEFAULT
          max_connections: 100
          max_pending_requests: 50
          max_requests: 200
          max_retries: 3
          track_remaining: true
        # 高优先级流量使用独立阈值
        - priority: HIGH
          max_connections: 200
          max_pending_requests: 100
          max_requests: 400
          max_retries: 5
```

### 5.2 外部熔断：基于 outlier detection

除了连接池级别的熔断，Envoy 还支持基于实际请求结果的外部熔断（Outlier Detection），这才是真正意义上的「熔断器」：

```yaml
clusters:
  - name: upstream_primary
    outlier_detection:
      # 连续 5xx 错误的阈值
      consecutive_5xx: 5
      # 检测间隔
      interval: 10s
      # 驱逐时间（熔断持续时间）
      base_ejection_time: 30s
      # 最大驱逐比例（保护上游服务）
      max_ejection_percent: 50
      # 成功请求的最小数量（避免低流量误判）
      success_rate_minimum_hosts: 3
      success_rate_request_volume: 100
      # 成功率标准差倍数
      success_rate_stdev_factor: 1900
      # 连续网关错误
      consecutive_gateway_failure: 5
```

工作原理：

1. Envoy 持续监控每个上游实例的响应状态码。
2. 当某个实例的连续 5xx 计数达到 `consecutive_5xx` 阈值时，触发驱逐。
3. 被驱逐的实例会在 `base_ejection_time` 期间不接收新请求。
4. 驱逐期结束后，Envoy 自动将该实例重新纳入负载均衡池（半开状态）。
5. 如果该实例再次触发熔断，驱逐时间会指数级增长。

### 5.3 熔断测试

```bash
# 模拟上游服务故障：让 upstream-service 返回 500
# 在 upstream-service 的 nginx.conf 中临时配置返回 500

# 压力测试触发熔断
docker run --rm --network=mesh-net \
  williamyeh/hey -n 500 -c 50 \
  http://envoy-sidecar:10000/orders

# 查看 Envoy 的熔断指标
curl -s http://localhost:9901/stats | grep "upstream_primary.outlier_detection"

# 预期输出：
# cluster.upstream_primary.outlier_detection.ejections_active: 1
# cluster.upstream_primary.outlier_detection.ejections_total: 3
# cluster.upstream_primary.outlier_detection.ejections_consecutive_5xx: 3
```

### 5.4 熔断状态监控

```bash
# 查看当前活跃的熔断器状态
curl -s http://localhost:9901/stats | grep "circuit_breakers"

# 预期输出示例：
# cluster.upstream_primary.circuit_breakers.default.cx_open: 0
# cluster.upstream_primary.circuit_breakers.default.rq_pending_open: 0
# cluster.upstream_primary.circuit_breakers.default.rq_open: 0
# cluster.upstream_primary.circuit_breakers.default.remaining_cx: 100
# cluster.upstream_primary.circuit_breakers.default.remaining_rq: 200
```

---

## 六、自动重试（Retry）策略与预算控制

### 6.1 Envoy 重试策略的完整参数

```yaml
route_config:
  virtual_hosts:
    - name: upstream_service
      routes:
        - match:
            prefix: "/api/"
          route:
            cluster: upstream_primary
            retry_policy:
              # 触发重试的条件
              retry_on: "5xx,reset,connect-failure,refused-stream,retriable-status-codes"
              # 可重试的状态码
              retriable_status_codes: [502, 503, 504]
              # 最大重试次数
              num_retries: 3
              # 重试超时（每次重试的超时时间）
              per_try_timeout: 2s
              # 整体超时
              timeout: 10s
              # 指数退避
              retry_back_off:
                base_interval: 0.25s
                max_interval: 4s
              # 重试预算（保护机制）
              retry_budget:
                budget_percent:
                  value: 20.0
                min_retry_concurrency: 3
              # 重试优先级
              retry_priority:
                name: envoy.retry_priorities.previous_priorities
                typed_config:
                  "@type": type.googleapis.com/envoy.extensions.retry.priority.previous_priorities.v3.PreviousPrioritiesConfig
                  update_frequency: 2
              # 对哪些请求可重试（通过 Header 控制）
              retriable_headers:
                - name: ":status"
                  exact_match: "503"
              # Host 选择策略：避免重试到同一个主机
              host_selection_retry_max_attempts: 3
```

### 6.2 `retry_on` 条件详解

| 条件 | 触发场景 |
|------|----------|
| `5xx` | 上游返回 5xx 或在收到完整响应前断开连接 |
| `reset` | 上游发送 HTTP/2 RST_STREAM |
| `connect-failure` | TCP 连接失败（连接被拒绝、超时） |
| `refused-stream` | HTTP/2 连接被拒绝 |
| `retriable-status-codes` | 匹配 `retriable_status_codes` 配置的状态码 |
| `retriable-headers` | 匹配 `retriable_headers` 配置的响应头 |
| `reset-before-request` | 请求发送前连接被重置 |
| `envoy-ratelimited` | 上游返回 `x-envoy-ratelimited` 头 |
| `http3-post-connect-failure` | HTTP/3 连接后失败 |

多个条件用逗号拼接：`retry_on: "5xx,reset,connect-failure"`

### 6.3 重试预算：防止重试风暴

重试风暴是分布式系统中最常见的故障放大器。当上游服务开始出现延迟时，客户端的重试请求会进一步加剧上游负载，形成正反馈循环，最终导致整个系统雪崩。

Envoy 的 **retry budget** 机制是解决这个问题的关键：

```yaml
retry_budget:
  budget_percent:
    value: 20.0  # 重试请求不超过总请求数的 20%
  min_retry_concurrency: 3  # 即使总请求很少，也至少允许 3 个并发重试
```

工作原理：
1. Envoy 维护一个滑动时间窗口（默认 1 秒），统计该窗口内的总请求数和重试请求数。
2. 当 `重试请求数 / 总请求数 > budget_percent` 时，新的重试请求将被抑制。
3. `min_retry_concurrency` 保证在低流量场景下仍然有最低限度的重试能力。

### 6.4 在 Laravel 中触发重试

Laravel 端代码无需任何修改，Envoy 自动处理重试：

```php
// 当 upstream-service 暂时返回 503 时
// Envoy 自动进行最多 3 次重试，指数退避
// 对 Laravel 而言，只看到一次请求，得到最终的正确响应
$response = Http::timeout(5)->get('http://localhost:10000/api/orders/123');
```

### 6.5 重试调试

```bash
# 查看重试统计
curl -s http://localhost:9901/stats | grep "retry"

# 关键指标：
# cluster.upstream_primary.retry.upstream_retry: 成功重试次数
# cluster.upstream_primary.retry.upstream_retry_total: 总重试尝试次数
# cluster.upstream_primary.upstream_rq_retry: 被重试的请求数
# cluster.upstream_primary.upstream_rq_retry_overflow: 因预算限制被抑制的重试数
# cluster.upstream_primary.upstream_rq_retry_success: 重试成功的请求数
```

---

## 七、可观测性：Prometheus + Grafana 监控 Envoy 指标

### 7.1 启用 Envoy 的 Prometheus 指标端点

```yaml
# envoy.yaml 中添加管理接口配置
admin:
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901
  stats_sinks:
    - name: envoy.stat_sinks.metrics_service
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.stat_sinks.metrics_service.v3.MetricsServiceConfig
        grpc_service:
          envoy_grpc:
            cluster_name: stats_cluster
        report_counters_as_deltas: true

# stats_config 控制指标名称格式
stats_config:
  stats_tags:
    - tag_name: "cluster_name"
      regex: "^cluster\\.((.*?)\\.).*"
    - tag_name: "listener_name"
      regex: "^listener\\.(.*?)\\..*"
  use_all_default_tags: true
```

直接通过 HTTP 访问 `/stats/prometheus` 端点即可获取 Prometheus 格式的指标：

```bash
curl http://localhost:9901/stats/prometheus
```

### 7.2 Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "envoy-sidecar"
    static_configs:
      - targets: ["envoy-sidecar:9901"]
    metrics_path: /stats/prometheus
    params:
      format: ["prometheus"]
```

### 7.3 核心指标清单

以下是生产环境中必须关注的 Envoy 指标：

**流量指标：**
```
envoy_cluster_upstream_rq_total                          # 总请求数
envoy_cluster_upstream_rq_xx{response_code_class="5"}   # 5xx 响应数
envoy_cluster_upstream_cx_active                         # 活跃连接数
envoy_cluster_upstream_cx_total                          # 总连接数
```

**熔断指标：**
```
envoy_cluster_circuit_breakers_default_cx_open           # 连接熔断器是否打开
envoy_cluster_circuit_breakers_default_rq_open           # 请求熔断器是否打开
envoy_cluster_outlier_detection_ejections_active         # 当前被驱逐的主机数
envoy_cluster_outlier_detection_ejections_total          # 总驱逐次数
```

**重试指标：**
```
envoy_cluster_upstream_rq_retry                          # 重试次数
envoy_cluster_upstream_rq_retry_success                  # 重试成功次数
envoy_cluster_upstream_rq_retry_overflow                 # 被预算抑制的重试次数
envoy_vhost_upstream_rq_retry                            # 虚拟主机级别重试次数
```

**延迟指标：**
```
envoy_cluster_upstream_rq_time_bucket                    # 请求耗时直方图
envoy_cluster_upstream_cx_connect_time_bucket            # 连接建立耗时
envoy_cluster_upstream_cx_length_ms_bucket               # 连接持续时间
```

### 7.4 Grafana Dashboard

推荐使用 Envoy 社区维护的 Grafana Dashboard（ID: 14308），或创建自定义 Dashboard，核心面板包括：

1. **流量概览**：QPS、错误率（4xx/5xx 比例）、P50/P95/P99 延迟
2. **熔断状态**：当前活跃的熔断器数量、驱逐事件时间线
3. **重试效率**：重试成功率、重试溢出（被预算抑制）的趋势
4. **连接池**：活跃连接数、等待队列长度

---

## 八、与 Laravel 应用层解耦的收益分析

### 8.1 代码层面的收益

**Before（应用内治理）：**

```php
// app/Services/HttpCircuitBreaker.php - 约 200 行
// app/Middleware/RetryMiddleware.php - 约 150 行
// app/Services/UpstreamHealthChecker.php - 约 100 行
// config/circuit_breaker.php - 配置文件
// config/retry.php - 配置文件
```

**After（Sidecar 治理）：**

```php
// 以上所有文件完全删除
// 业务代码只需：
$response = Http::get('http://localhost:10000/api/resource');
```

代码量减少约 450 行，且这 450 行是**最容易出 bug 的 450 行**——并发状态管理、分布式锁、超时计算、指数退避等逻辑的正确性很难验证。

### 8.2 运维层面的收益

| 维度 | 应用内治理 | Sidecar 治理 |
|------|------------|-------------|
| 策略变更 | 修改代码 + 重新部署 | 修改 Envoy 配置 + 热重载（秒级生效） |
| 多语言一致性 | 每个语言栈独立实现 | 统一 Envoy，行为完全一致 |
| 故障域 | 治理 bug 可能影响业务 | Sidecar 崩溃不影响业务进程（Laravel 进程独立） |
| 版本升级 | 与业务版本耦合 | Envoy Sidecar 独立升级 |
| 可观测性 | 各服务自行埋点 | Envoy 统一输出标准化指标 |

### 8.3 性能影响评估

Sidecar 模式引入了一跳额外的网络转发，理论上会增加延迟。实测数据（同机器部署）：

| 场景 | P50 延迟 | P99 延迟 |
|------|----------|----------|
| 直连上游（无 Sidecar） | 0.8ms | 3.2ms |
| 经过 Envoy Sidecar | 1.1ms | 4.1ms |
| 增量开销 | +0.3ms | +0.9ms |

对于典型的 API 服务（上游响应 10-100ms），Envoy 引入的 ~1ms 延迟完全可接受。只有在超低延迟场景（如高频交易系统）下才需要考虑绕过 Sidecar。

---

## 九、生产环境注意事项与踩坑总结

### 9.1 踩坑一：HTTP 头传播丢失

**问题**：Envoy 默认会过滤某些 hop-by-hop 头（如 `Connection`、`Transfer-Encoding`），但不会过滤自定义业务头。然而，如果你使用了 Envoy 的某些 Filter（如 `envoy.filters.http.ext_authz`），可能会意外丢弃头信息。

**解决方案**：

```yaml
# 确保重要的业务头被正确传播
route_config:
  request_headers_to_add:
    - header:
        key: "x-envoy-retry-on"
        value: "5xx"
      append_action: OVERWRITE_IF_EXISTS_OR_ADD
```

### 9.2 踩坑二：连接池耗尽导致级联故障

**问题**：上游服务响应变慢时，Envoy 的连接池可能快速耗尽，导致所有新请求被排队等待，引发连锁反应。

**解决方案**：

```yaml
clusters:
  - name: upstream_primary
    # 设置合理的连接池上限
    circuit_breakers:
      thresholds:
        - priority: DEFAULT
          max_connections: 100
          max_pending_requests: 50
          max_requests: 200
    # 启用连接池溢出监控
    track_remaining: true
    # 设置连接超时
    connect_timeout: 2s
    # 启用 TCP keepalive
    upstream_connection_options:
      tcp_keepalive:
        keepalive_time: 300
        keepalive_interval: 30
        keepalive_probes: 3
```

### 9.3 踩坑三：重试导致写操作重复执行

**问题**：POST/PUT 等写操作被重试时，可能导致订单重复创建等数据一致性问题。

**解决方案**：

```yaml
# 方案一：只对幂等的读操作启用重试
routes:
  - match:
      prefix: "/api/"
      headers:
        - name: ":method"
          exact_match: "GET"
    route:
      cluster: upstream_primary
      retry_policy:
        retry_on: "5xx,reset,connect-failure"
        num_retries: 3

  # 写操作不启用重试
  - match:
      prefix: "/api/"
      headers:
        - name: ":method"
          exact_match: "POST"
    route:
      cluster: upstream_primary
      # 不配置 retry_policy

# 方案二：Laravel 端使用幂等键
# app/Http/Controllers/OrderController.php
public function store(Request $request)
{
    $idempotencyKey = $request->header('Idempotency-Key');
    if ($idempotencyKey && Cache::has("order:{$idempotencyKey}")) {
        return Cache::get("order:{$idempotencyKey}");
    }

    $order = Order::create($request->validated());

    if ($idempotencyKey) {
        Cache::put("order:{$idempotencyKey}", $order, 3600);
    }

    return $order;
}
```

### 9.4 踩坑四：Envoy 自身的内存管理

**问题**：在高流量场景下，Envoy 可能消耗大量内存用于统计和追踪数据。

**解决方案**：

```yaml
# 控制统计指标的基数
stats_config:
  # 使用正则提取有意义的标签，避免高基数
  stats_tags:
    - tag_name: "response_code"
      regex: "^http\\.((.*?)(\\..*)?)$"
  # 限制统计子系统的内存使用
  stats_flush_interval: 60s

# 控制追踪采样率
tracing:
  provider:
    name: envoy.tracers.zipkin
    typed_config:
      "@type": type.googleapis.com/envoy.config.trace.v3.ZipkinConfig
      collector_cluster: zipkin
      collector_endpoint: "/api/v2/spans"
      trace_id_128bit: true
      shared_span_context: false
```

### 9.5 踩坑五：健康检查与熔断的交互

**问题**：当 Envoy 的主动健康检查和 outlier detection 同时生效时，可能出现「健康检查通过但 outlier 检测驱逐」的矛盾状态。

**解决方案**：理解两者的独立性——健康检查控制实例是否可被路由，outlier detection 基于实时请求结果。在实践中，建议使用其中一种作为主要机制，避免过度配置。

### 9.6 生产部署 Checklist

```markdown
## Envoy Sidecar 生产部署 Checklist

- [ ] 设置合理的连接池和熔断阈值（基于压测数据）
- [ ] 配置重试预算（budget_percent 建议 10%-20%）
- [ ] 写操作禁用重试或使用幂等键
- [ ] 启用 Prometheus 指标采集
- [ ] 配置 Grafana 告警规则（5xx 比例 > 1%，P99 > 500ms 等）
- [ ] 配置 Envoy 管理接口的访问控制（不要暴露到公网）
- [ ] 测试 Sidecar 崩溃时 Laravel 的降级行为
- [ ] 记录 Envoy 启动参数和版本号
- [ ] 准备 Envoy 配置回滚方案
- [ ] 压测确认 Sidecar 延迟增量可接受
```

---

## 总结

通过本文的实战，我们完成了以下架构转型：

1. **基础设施下沉**：重试、熔断、流量镜像等治理逻辑从 Laravel 业务代码下沉到 Envoy Sidecar。
2. **应用层解耦**：Laravel 代码零治理逻辑，专注于业务实现。
3. **统一可观测性**：所有治理行为通过 Envoy 的标准化指标暴露，Prometheus + Grafana 一站式监控。
4. **动态治理能力**：策略变更不需要重新部署应用，Envoy 配置热更新秒级生效。

Sidecar 模式不是银弹——它引入了额外的运维复杂度和微小的性能开销。但当你的系统规模超过 5 个微服务、团队开始为「谁来维护公共的重试库」争论不休时，Sidecar 模式的价值就会凸显。

记住一句话：**好的架构不是消除复杂度，而是将复杂度放在正确的位置**。网络治理的复杂度，就应该在网络层解决，而不是散落在每个应用的业务代码中。

---

> **参考资源**：
> - [Envoy Proxy 官方文档](https://www.envoyproxy.io/docs/envoy/latest/)
> - [Envoy xDS REST and gRPC protocol](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)
> - [Envoy Circuit Breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
> - [Envoy Outlier Detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier)
> - [Pattern: Service Mesh](https://philcalcado.com/2017/08/03/pattern_service_mesh.html)

---

## 相关阅读

- [分布式追踪上下文传播实战：W3C Trace Context + Baggage——Laravel 微服务中跨进程的业务标签透传与采样策略](/categories/运维/Distributed-Tracing-W3C-Trace-Context-Baggage-Laravel微服务跨进程追踪/)
- [金丝雀发布实战：Nginx 权重路由与 Envoy xDS 动态流量治理——Laravel B2C 渐进式发布全链路工程化落地](/categories/CICD/金丝雀发布实战-Nginx权重路由Envoy-Laravel-渐进式发布/)
- [Progressive Delivery 实战：Feature Flag + 渐进式发布 Unleash + Argo Rollouts 完整工程化工作流](/categories/CICD/Progressive-Delivery-实战-Feature-Flag-渐进式发布-Unleash-Argo-Rollouts完整工程化工作流/)
- [用 AI Agent 实现自动化 DevOps：监控、告警、修复、部署闭环](/categories/运维/用-AI-Agent-实现自动化-DevOps/)
- [Ansible 实战：Laravel 应用自动化部署与配置管理踩坑记录](/categories/CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
