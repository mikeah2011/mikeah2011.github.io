---
title: '服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦'
date: 2026-06-06 10:00:00
tags: [Service Mesh, Envoy, Sidecar, Laravel, 流量镜像, 熔断, 重试]
keywords: [Sidecar, Envoy Proxy, Laravel, 服务网格, 模式实战, 流量镜像, 熔断, 重试的基础设施下沉与应用层解耦, 架构]
description: 'Service Mesh Sidecar 模式实战教程：以 Envoy Proxy + Laravel 为技术栈，从零配置流量镜像（Shadowing）实现灰度验证、熔断器（Circuit Breaking）防止级联故障、自动重试策略提升请求成功率。详解 Envoy 静态配置、Laravel Docker Compose 编排、生产环境踩坑（镜像流量计费、熔断阈值调优、重试风暴防护），含完整 YAML 配置与 PHP 代码示例，助你将流量治理从应用层下沉到基础设施层。'
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


# 服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦

## 前言

在微服务架构的演进过程中，我们总会面临一个经典矛盾：业务开发团队希望专注于业务逻辑，而流量治理（熔断、重试、限流、流量镜像等）的代码却不断侵入应用层。Laravel 项目也不例外——当你的 Laravel 应用需要调用下游服务、处理故障恢复、进行灰度流量验证时，这些横切关注点会通过中间件、Guzzle 配置、自定义重试逻辑等方式散落在代码各处。

**服务网格（Service Mesh）的 Sidecar 模式**提供了一种优雅的解耦方案：将流量治理能力从应用中剥离，下沉到基础设施层，以透明代理的形式旁挂（Sidecar）在每个服务实例旁边。本文将以 **Envoy Proxy + Laravel** 为技术栈，从零到一实战配置流量镜像、熔断器和重试策略，并深入探讨这种架构模式在生产环境中的工程实践与踩坑经验。

---

## 一、什么是 Sidecar 模式，为什么需要服务网格

### 1.1 Sidecar 模式的本质

Sidecar 模式是一种**部署模式**，其核心思想是：为每个服务实例附加一个独立的代理进程（即 Sidecar），两者共享网络命名空间。所有出入服务的网络流量都先经过 Sidecar，由 Sidecar 负责处理与业务无关的基础设施逻辑。

```
┌─────────────────────────┐
│       Pod / Container   │
│  ┌─────────┐ ┌────────┐ │
│  │ Laravel  │←→│ Envoy  │ ←→ 外部网络
│  │ (App)    │  │(Sidecar)│
│  └─────────┘ └────────┘ │
└─────────────────────────┘
```

这种方式的核心价值在于**关注点分离**：

- **应用层**（Laravel）：专注于业务逻辑、数据处理、接口响应
- **基础设施层**（Envoy Sidecar）：负责服务发现、负载均衡、熔断、重试、流量镜像、可观测性

在 Kubernetes 生态中，Sidecar 通常与业务容器处于同一个 Pod 内，共享同一个网络命名空间（Network Namespace）。这意味着 Sidecar 容器可以通过 `localhost` 直接与业务容器通信，无需额外的服务发现机制。在 Docker Compose 场景下，我们可以通过共享 Docker 网络来模拟类似的行为。

Sidecar 模式并非服务网格的专利。在 Kubernetes 世界中，日志收集器（如 Fluentd）、配置热加载器、证书轮转代理等都可以以 Sidecar 的形式部署。但服务网格将 Sidecar 模式推向了一个新的高度——它将网络通信的**全部七层能力**都下沉到了 Sidecar 中，使得应用完全不需要关心网络层的任何细节。这种程度的基础设施下沉，在传统的反向代理（如 Nginx）或 API 网关中是做不到的，因为它们通常只处理南北向流量（入口流量），而 Sidecar 同时覆盖了东西向流量（服务间通信）和南北向流量。

### 1.2 为什么传统方式走不通

在没有服务网格之前，流量治理逻辑通常通过以下方式实现：

| 方式 | 痛点 |
|------|------|
| Laravel 中间件 | 仅处理入站 HTTP 请求，无法治理出站调用 |
| Guzzle 重试配置 | 代码侵入性强，不同服务配置分散 |
| SDK 嵌入（如 Hystrix PHP） | 语言绑定，多语言栈难以统一 |
| Nginx 层配置 | 粒度粗，无法做到 per-service 精细治理 |

这些问题的本质是：**基础设施能力与应用代码耦合**。当你的系统从 3 个服务扩展到 30 个服务时，这些分散的治理逻辑会变成维护噩梦。

举一个真实的例子：假设你的 Laravel 订单服务需要调用支付服务和库存服务。在传统方式下，你可能用 Guzzle 来处理 HTTP 调用，为每个下游服务配置不同的重试策略和超时时间。当支付服务出现间歇性故障时，你需要在代码中实现断路器逻辑——也许你会引入 `php-circuit-breaker` 这样的库。但问题是：如果明天你新增了一个物流服务的调用，你又得重复一遍类似的配置。更糟糕的是，如果团队中另一个开发者负责的模块也需要调用支付服务，他可能会写出一套完全不同的熔断逻辑。随着服务数量和调用关系的增加，这种分散的治理方式会导致严重的不一致性，而且每次调整策略都需要重新部署应用。

### 1.3 服务网格的分层架构

服务网格将网络通信抽象为两层：

- **数据平面（Data Plane）**：由一组智能代理（Envoy）组成，拦截并处理所有服务间通信
- **控制平面（Control Plane）**：负责管理和配置数据平面的代理（如 Istio 的 istiod）

对于中小规模 Laravel 团队，我们不一定需要完整的 Istio 部署。**直接使用 Envoy 作为 Sidecar**，手动管理配置，是一种更轻量、更可控的切入方式。当团队对 Envoy 的运维经验逐渐成熟后，再考虑引入控制平面来实现配置的集中管理和动态下发，这是一种务实的演进路径。

---

## 二、Envoy Proxy 核心概念

Envoy 最初由 Lyft 开发，后来捐赠给 CNCF 并成为其毕业项目。它以高性能、可扩展、配置灵活著称，是 Istio、AWS App Mesh 等主流服务网格方案的默认数据平面代理。理解 Envoy 的核心概念，是掌握服务网格的第一步。

在深入实战之前，必须理解 Envoy 的三个核心概念：**Listener**、**Cluster** 和 **Filter Chain**。

### 2.1 Listener——监听入口

Listener 是 Envoy 的网络入口点，定义了 Envoy 监听的地址和端口。每个 Listener 可以绑定一组 Filter Chain，对经过的流量进行处理。在我们的实战场景中，Laravel 的 Envoy Sidecar 通常会配置两个 Listener：一个用于接收入站流量（从 Nginx 或客户端发来的请求），另一个用于代理出站流量（Laravel 调用下游服务的请求）。

```yaml
listeners:
  - name: laravel_inbound
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 8000
    filter_chains:
      - filters:
          - name: envoy.filters.network.http_connection_manager
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
              stat_prefix: ingress_http
              route_config:
                virtual_hosts:
                  - name: laravel_app
                    domains: ["*"]
                    routes:
                      - match:
                          prefix: "/"
                        route:
                          cluster: laravel_backend
              http_filters:
                - name: envoy.filters.http.router
```

### 2.2 Cluster——上游服务集群

Cluster 代表 Envoy 可以路由到的一组上游（upstream）服务端点。Cluster 中可以配置负载均衡策略、健康检查、熔断参数等。一个 Cluster 可以包含多个 Endpoint，Envoy 会根据配置的负载均衡策略（如轮询、最少连接、一致性哈希等）在这些端点间分配流量。

```yaml
clusters:
  - name: laravel_backend
    type: STRICT_DNS
    lb_policy: ROUND_ROBIN
    load_assignment:
      cluster_name: laravel_backend
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: 127.0.0.1
                    port_value: 9000
```

### 2.3 Filter Chain——流量处理管线

Filter Chain 是 Envoy 最强大的机制。它是一个有序的过滤器列表，每个过滤器对流量执行特定操作。Filter 分为三类：

- **Network Filter（L4）**：处理 TCP 层面的连接和字节流
- **HTTP Filter（L7）**：处理 HTTP 请求/响应，支持 Header 操作、重试、限流等
- **Access Log Filter**：记录访问日志

Filter 的组合形成了 Envoy 的能力矩阵——正是这些 Filter 让 Envoy 能够实现流量镜像、熔断、重试等功能。每个 Filter 可以访问请求的全部上下文（Header、Body、元数据），并根据条件决定是否执行特定操作。这种管线式的设计使得 Envoy 的能力可以灵活组合和扩展。

### 2.4 xDS API 与动态配置

除了静态配置（`static_resources`），Envoy 还支持通过 **xDS API**（包括 LDS、RDS、CDS、EDS 等）实现配置的动态下发。这意味着你可以在不重启 Envoy 的情况下热更新 Listener、Route、Cluster 和 Endpoint 的配置。在大规模生产环境中，通常会有一个控制平面（如 Istio 的 istiod）通过 xDS API 向所有 Sidecar 推送统一的配置策略。但在我们的实战场景中，使用静态配置文件已经足够，这降低了架构的复杂度，也更便于理解和排查问题。

值得注意的是，Envoy 支持配置的**增量更新**——当只有部分 Endpoint 发生变化时，只需下发变化的部分，而不是全量推送。这种设计在大规模集群中能显著降低控制平面和数据平面之间的通信开销。

---

## 三、流量镜像（Traffic Mirroring）配置实战

### 3.1 什么是流量镜像

流量镜像（也叫影子流量，Shadow Traffic）是指将生产流量的**副本**发送到另一个服务集群，但不影响原始请求的响应。典型应用场景包括：

- **新版本预验证**：将生产流量镜像到新版本 Laravel 应用，验证无误后再切流
- **性能基准测试**：用真实流量压测新集群，评估新版本在真实负载下的性能表现
- **数据回放**：将流量镜像到测试环境进行调试，排查仅在生产数据下才能复现的问题
- **回归测试**：在发布新版本前，用生产流量的镜像做回归对比

流量镜像与 A/B 测试、金丝雀发布有本质区别：A/B 测试和金丝雀发布都是将**部分真实用户流量**导向新版本，用户的请求结果会受到影响；而流量镜像是**复制一份流量**发送到目标集群，原始请求的处理和响应完全不受影响，镜像流量的响应会被直接丢弃。这使得流量镜像成为一种零风险的验证手段，尤其适合在正式灰度发布前进行"实战演练"。

### 3.2 Envoy 流量镜像配置

在 Envoy 的 Route 配置中，通过 `request_mirror_policies` 实现流量镜像：

```yaml
routes:
  - match:
      prefix: "/"
    route:
      cluster: laravel_production
      request_mirror_policies:
        - cluster: laravel_canary
          runtime_fraction:
            default_value:
              numerator: 100
              denominator: HUNDRED
```

上述配置的含义是：将 100% 的请求镜像到 `laravel_canary` 集群。镜像请求的响应会被丢弃，客户端只收到 `laravel_production` 的响应。

在实际生产中，你可能不需要一开始就镜像 100% 的流量。可以通过调整 `numerator` 的值来控制镜像比例，例如设为 `10` 表示只镜像 10% 的流量。这种方式可以在低风险的前提下逐步验证新版本的稳定性。

### 3.3 完整的流量镜像 Cluster 配置

```yaml
clusters:
  # 生产集群
  - name: laravel_production
    type: STRICT_DNS
    lb_policy: ROUND_ROBIN
    load_assignment:
      cluster_name: laravel_production
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: laravel-app-prod
                    port_value: 9000

  # 镜像目标集群（Canary）
  - name: laravel_canary
    type: STRICT_DNS
    lb_policy: ROUND_ROBIN
    load_assignment:
      cluster_name: laravel_canary
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: laravel-app-canary
                    port_value: 9000
```

**关键注意事项**：

- 镜像请求是**异步发送**的，不会阻塞主请求的处理和响应
- 镜像目标集群需要有足够的容量来承接镜像流量，否则可能导致镜像集群过载
- 使用 `x-envoy-force-trace` Header 可以对镜像请求进行链路追踪，方便对比分析
- `runtime_fraction` 支持动态调整镜像比例，无需重启 Envoy，这在生产环境中非常实用

---

## 四、熔断器（Circuit Breaker）配置

### 4.1 熔断器原理

熔断器模式借鉴了电路中的保险丝概念：当下游服务出现异常时，自动切断请求，防止故障级联传播。想象一下这个场景：你的 Laravel 订单服务依赖支付服务，而支付服务因为数据库连接池耗尽开始返回 5xx 错误。如果没有熔断器，订单服务会持续向支付服务发送请求，每条请求都会阻塞数十秒直到超时，最终导致订单服务的 PHP-FPM 进程池被耗尽，整个订单服务崩溃——这就是故障级联传播。

Envoy 的熔断通过 **outlier_detection**（离群点检测）实现，工作流程如下：

1. **监控阶段**：Envoy 持续跟踪上游主机的响应状态，统计每个主机的错误率
2. **熔断触发**：当某主机的连续 5xx 错误次数超过阈值，将其从负载均衡池中驱逐（eject）
3. **恢复探测**：被驱逐的主机在冷却期（base_ejection_time）后会被重新加入，接受探测请求
4. **恢复或再次熔断**：如果探测成功则恢复正常，否则再次驱逐，且驱逐时间指数递增

需要特别理解的是，Envoy 的熔断器有两个层次的保护机制。第一层是 `circuit_breakers` 中的**静态阈值限制**（如 `max_connections`、`max_requests`），它限制了并发连接数和请求数的上限，防止过载；第二层是 `outlier_detection` 中的**动态离群检测**，它根据实际的错误响应来驱逐不健康的节点。两层保护配合使用，既防住了突发流量导致的过载，也防住了下游节点逐渐恶化导致的慢故障。

### 4.2 Envoy outlier_detection 配置

```yaml
clusters:
  - name: order_service
    type: STRICT_DNS
    lb_policy: ROUND_ROBIN
    circuit_breakers:
      thresholds:
        - max_connections: 1024
          max_pending_requests: 1024
          max_requests: 1024
          max_retries: 3
    outlier_detection:
      # 连续 5xx 错误次数达到此值时驱逐主机
      consecutive_5xx: 5
      # 驱逐的基础时间（秒），被驱逐的主机将在此时间后重新加入
      base_ejection_time:
        seconds: 30
      # 最大驱逐比例，保护集群不至于全部被驱逐
      max_ejection_percent: 50
      # 检查间隔，Envoy 每隔此时间评估一次各主机的健康状态
      interval:
        seconds: 10
      # 成功请求的最低主机数，低于此值不计算错误率（防止小样本误判）
      success_rate_minimum_hosts: 3
      # 成功请求的最低请求数，低于此值不计算错误率
      success_rate_request_volume: 100
      # 基于成功率的离群检测标准差因子
      success_rate_stdev_factor: 1900
```

### 4.3 熔断触发的效果

当 `order_service` 集群中某台主机连续返回 5 次 5xx 错误后：

1. 该主机被驱逐出负载均衡池 30 秒
2. 新请求被路由到集群中其他健康主机
3. 30 秒后该主机被重新加入，Envoy 发送探测请求
4. 如果连续成功，恢复正常；如果再次失败，驱逐时间翻倍（指数退避）

这种机制让 Laravel 应用无需在代码中实现断路器逻辑（如 `php-circuit-breaker` 库），一切在基础设施层透明完成。对于 Laravel 开发者而言，这意味着代码中的 `try-catch` 只需要处理最终的失败响应（如超时后的 503），而不需要关心故障检测和恢复的复杂逻辑。

---

## 五、重试策略（Retry Policy）

### 5.1 Envoy 重试的核心参数

Envoy 的重试策略配置在路由级别，三个核心参数共同决定了重试行为：

```yaml
routes:
  - match:
      prefix: "/api/orders"
    route:
      cluster: order_service
      retry_policy:
        # 触发重试的条件
        retry_on: "5xx,reset,connect-failure"
        # 最大重试次数
        num_retries: 3
        # 每次重试的超时时间
        per_try_timeout:
          seconds: 2
        # 重试的退避策略
        retry_back_off:
          base_interval:
            milliseconds: 500
          max_interval:
            milliseconds: 5000
```

### 5.2 retry_on 参数详解

`retry_on` 决定了在什么条件下触发重试，常用值：

| 值 | 含义 |
|---|------|
| `5xx` | 上游返回 5xx 状态码或没有收到响应 |
| `reset` | 上游连接被重置（TCP RST） |
| `connect-failure` | 连接上游失败 |
| `retriable-429` | 上游返回 429（Too Many Requests） |
| `retriable-status-codes` | 上游返回可重试的状态码（需配合 `retriable_status_codes` 配置） |
| `gateway-error` | 502、503、504 |
| `cancelled` | gRPC 被取消 |

可以组合使用，用逗号分隔：

```yaml
retry_on: "5xx,reset,connect-failure,gateway-error"
```

在 Laravel 微服务场景中，推荐至少配置 `5xx,reset,connect-failure` 三个条件。`5xx` 覆盖了最常见的服务端错误场景，`reset` 覆盖了因网络波动导致的连接重置，`connect-failure` 覆盖了上游主机不可达的情况。如果调用的下游服务有严格的限流策略（如支付服务的 API 限流），建议加上 `retriable-429`，让 Envoy 在遇到 429 响应时自动退避重试。

### 5.3 per_try_timeout 与总超时

`per_try_timeout` 控制每次重试尝试的超时，但还有一个隐含的总超时约束：

```
总超时 ≈ num_retries × per_try_timeout
```

如果上游服务的响应时间不确定，建议同时配置路由级别的 `timeout`：

```yaml
route:
  cluster: order_service
  timeout:
    seconds: 10
  retry_policy:
    num_retries: 3
    per_try_timeout:
      seconds: 2
```

这样即使重试 3 次（每次 2 秒），总请求时间也不会超过 10 秒。这种双重超时保护确保了即使在最坏情况下，客户端也不会无限期等待。对于 Laravel 应用，建议在 Guzzle 客户端也设置一个略大于 Envoy 总超时的 timeout 值，形成第三层保护。

### 5.4 重试预算——防止重试风暴

在生产环境中，不受控制的重试会导致**重试风暴**（Retry Storm）：当一个服务出现故障时，所有上游服务同时重试，导致请求量暴增，进一步加剧故障。这就好比公路上发生了追尾事故，后面的车辆不断按喇叭试图绕行，结果造成了更大的拥堵。

Envoy 支持通过 `retry_budget` 限制重试比例：

```yaml
retry_policy:
  retry_on: "5xx,connect-failure"
  num_retries: 3
  retry_budget:
    budget_percent:
      value: 20.0
    min_retry_concurrency: 3
```

上述配置表示：重试请求不超过总请求量的 20%，且至少保留 3 个并发重试槽位。这是一种优雅的限流机制，它能在系统压力增大时自动降低重试频率，避免"越重试越崩溃"的恶性循环。在生产环境中，强烈建议开启 `retry_budget`，尤其是在多个上游服务同时依赖同一个下游服务的场景下。

---

## 六、Laravel 应用接入 Envoy Sidecar（Docker Compose 编排）

### 6.1 整体架构

```
┌─── Docker Network ──────────────────────────┐
│                                             │
│  ┌──────────────────────────┐               │
│  │  laravel-app container   │               │
│  │  ┌────────┐ ┌─────────┐ │               │
│  │  │ Laravel│←→│ Envoy   │ │ ←→ Upstream  │
│  │  │ :9000  │  │ :8000   │ │   Services    │
│  │  └────────┘ └─────────┘ │               │
│  └──────────────────────────┘               │
│                                             │
│  ┌──────────────────────┐                   │
│  │  Nginx (入口)        │                   │
│  │  :80/:443            │                   │
│  └──────────────────────┘                   │
└─────────────────────────────────────────────┘
```

### 6.2 Envoy 配置文件

创建 `envoy.yaml`：

```yaml
static_resources:
  listeners:
    # 入站监听：接收 Nginx 转发的请求，路由到 Laravel
    - name: inbound_listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8000
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ingress_http
                route_config:
                  virtual_hosts:
                    - name: laravel
                      domains: ["*"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: laravel_fpm
                http_filters:
                  - name: envoy.filters.http.router

    # 出站监听：Laravel 调用外部服务时，通过此 Listener 代理
    - name: outbound_listener
      address:
        socket_address:
          address: 127.0.0.1
          port_value: 8001
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: egress_http
                route_config:
                  virtual_hosts:
                    - name: order_service
                      domains: ["order-service"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: order_service
                            timeout:
                              seconds: 10
                            retry_policy:
                              retry_on: "5xx,reset,connect-failure"
                              num_retries: 3
                              per_try_timeout:
                                seconds: 2
                            request_mirror_policies:
                              - cluster: order_service_canary
                    - name: payment_service
                      domains: ["payment-service"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: payment_service
                            timeout:
                              seconds: 15
                            retry_policy:
                              retry_on: "5xx,connect-failure"
                              num_retries: 2
                              per_try_timeout:
                                seconds: 3
                http_filters:
                  - name: envoy.filters.http.router

  clusters:
    # Laravel FPM 上游
    - name: laravel_fpm
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: laravel_fpm
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: 127.0.0.1
                      port_value: 9000

    # 订单服务集群（生产）
    - name: order_service
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: order_service
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: order-service
                      port_value: 80
      circuit_breakers:
        thresholds:
          - max_connections: 512
            max_pending_requests: 512
            max_requests: 1024
            max_retries: 3
      outlier_detection:
        consecutive_5xx: 5
        base_ejection_time:
          seconds: 30
        max_ejection_percent: 50
        interval:
          seconds: 10

    # 订单服务镜像集群
    - name: order_service_canary
      type: STRICT_DNS
      load_assignment:
        cluster_name: order_service_canary
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: order-service-canary
                      port_value: 80

    # 支付服务集群
    - name: payment_service
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: payment_service
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: payment-service
                      port_value: 80
      circuit_breakers:
        thresholds:
          - max_connections: 256
            max_pending_requests: 256
            max_requests: 512
      outlier_detection:
        consecutive_5xx: 3
        base_ejection_time:
          seconds: 60
        max_ejection_percent: 30
        interval:
          seconds: 15

admin:
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901
```

### 6.3 Docker Compose 编排

```yaml
version: "3.8"

services:
  # Laravel 应用 + Envoy Sidecar（同一个容器）
  laravel-app:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - ./src:/var/www/html
      - ./envoy.yaml:/etc/envoy/envoy.yaml:ro
    networks:
      - mesh-network

  # Envoy Sidecar 作为独立的基础设施容器
  envoy-sidecar:
    image: envoyproxy/envoy:v1.32-latest
    volumes:
      - ./envoy.yaml:/etc/envoy/envoy.yaml:ro
    ports:
      - "8000:8000"   # 入站代理
      - "9901:9901"   # 管理接口
    networks:
      - mesh-network
    depends_on:
      - laravel-app
    command: envoy -c /etc/envoy/envoy.yaml --log-level info

  # Nginx 入口
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - mesh-network
    depends_on:
      - envoy-sidecar

  # 下游订单服务
  order-service:
    image: your-registry/order-service:latest
    networks:
      - mesh-network

  # 下游支付服务
  payment-service:
    image: your-registry/payment-service:latest
    networks:
      - mesh-network

networks:
  mesh-network:
    driver: bridge
```

### 6.4 Laravel 代码中调用下游服务

在 Laravel 中，调用下游服务时将请求指向 Envoy 的出站代理：

```php
// app/Services/OrderService.php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class OrderService
{
    private string $proxyHost = 'http://127.0.0.1:8001';

    public function getOrder(string $orderId): array
    {
        // 请求通过 Envoy Sidecar 代理转发
        // Envoy 自动处理重试、熔断、超时
        $response = Http::withHeaders([
            'Host' => 'order-service',
        ])
        ->timeout(10)
        ->get("{$this->proxyHost}/api/orders/{$orderId}");

        return $response->json();
    }

    public function createOrder(array $data): array
    {
        $response = Http::withHeaders([
            'Host' => 'order-service',
        ])
        ->timeout(15)
        ->post("{$this->proxyHost}/api/orders", $data);

        return $response->json();
    }
}
```

**关键点**：Laravel 中的 `Http::timeout()` 设置的是应用层面的超时，它应大于 Envoy 的 `per_try_timeout` 但小于总超时，形成双重保护。同时，通过设置 `Host` 头为 `order-service`，Envoy 的路由规则可以据此将请求路由到对应的上游集群。

---

## 七、Laravel 中间件 vs Envoy Sidecar 的职责边界

这是最容易混淆的部分。很多团队在引入 Sidecar 后不知道哪些逻辑应该放在哪里。以下是清晰的职责划分：

### 7.1 Envoy Sidecar 负责的（基础设施层）

| 能力 | 说明 |
|------|------|
| 重试 | 自动重试失败的请求，无需应用代码感知 |
| 熔断 | 检测下游故障，自动驱逐异常节点 |
| 超时 | 请求级别的超时控制 |
| 流量镜像 | 复制流量到测试/灰度环境 |
| 负载均衡 | 在多个上游实例间分配流量 |
| TLS 终止 | 处理 HTTPS 加解密 |
| 访问日志 | 统一格式的 L7 访问日志 |
| 分布式追踪 | 注入/传播 trace header |
| 限流 | 基于连接数/请求数的全局限流 |

### 7.2 Laravel 中间件负责的（应用层）

| 能力 | 说明 |
|------|------|
| 认证鉴权 | JWT 校验、Session 验证、OAuth |
| 业务权限 | RBAC、数据权限、接口权限 |
| 请求验证 | 参数校验、签名验证、防重复提交 |
| 业务日志 | 业务操作审计日志 |
| 数据脱敏 | 响应数据中的敏感字段脱敏 |
| 接口版本 | API 版本路由（v1/v2） |
| 业务级限流 | 基于用户/租户的细粒度限流 |
| 幂等性 | 业务层面的幂等控制 |

### 7.3 灰色地带的决策原则

有些能力两边都能做，怎么选？遵循以下原则：

1. **如果需要感知业务语义**→ Laravel 中间件（例：只有特定角色的用户才能触发重试）
2. **如果是纯网络层面的策略**→ Envoy Sidecar（例：5xx 自动重试 3 次）
3. **如果需要跨语言统一**→ Envoy Sidecar（例：PHP、Go、Node.js 服务统一的熔断策略）
4. **如果需要动态调整而不改代码**→ Envoy Sidecar（例：运维团队调整重试次数）

### 7.4 配合使用的最佳实践

```php
// Laravel 中间件：处理业务级幂等
class IdempotencyMiddleware
{
    public function handle($request, Closure $next)
    {
        $key = $request->header('Idempotency-Key');
        if (!$key) {
            return response()->json(['error' => '缺少幂等键'], 400);
        }

        if (Cache::has("idempotent:{$key}")) {
            return Cache::get("idempotent:{$key}");
        }

        $response = $next($request);

        Cache::put("idempotent:{$key}", $response, now()->addHours(24));
        return $response;
    }
}
```

Envoy 处理网络级重试（5xx 自动重试），Laravel 中间件保证重试不会产生重复业务操作。两者配合，形成完整的防护链。这种分层防御的设计理念类似于瑞士奶酪模型（Swiss Cheese Model）——每一层都有漏洞，但多层叠加后，漏洞重叠的概率极低。

---

## 八、生产环境踩坑与注意事项

### 8.1 踩坑一：Sidecar 启动顺序

**问题**：Laravel 应用启动时立即尝试连接下游服务，但 Envoy Sidecar 尚未就绪。

**解决方案**：

```yaml
# docker-compose.yaml
services:
  laravel-app:
    depends_on:
      envoy-sidecar:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9901/ready"]
      interval: 5s
      timeout: 3s
      retries: 5

  envoy-sidecar:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9901/ready"]
      interval: 3s
      timeout: 2s
      retries: 10
```

### 8.2 踩坑二：DNS 解析与 STRICT_DNS

**问题**：使用 `STRICT_DNS` 类型时，Envoy 会持续解析 DNS。如果 DNS 返回的 IP 列表变化，Envoy 会自动更新端点。但在 Docker 环境中，服务名解析可能不稳定，尤其在服务重启或扩缩容时，DNS 缓存可能导致流量被路由到已经不存在的容器。

**解决方案**：

```yaml
# 对于 Docker 内部服务，使用 LOGICAL_DNS（只取第一个解析结果）
clusters:
  - name: order_service
    type: LOGICAL_DNS
    # ...
```

### 8.3 踩坑三：请求体大小限制

**问题**：Envoy 默认的请求体缓冲大小有限制，文件上传场景容易触发 413 错误。

**解决方案**：

```yaml
http_filters:
  - name: envoy.filters.http.router
  - name: envoy.filters.http.buffer
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.buffer.v3.Buffer
      max_request_bytes: 52428800  # 50MB
```

### 8.4 踩坑四：重试导致非幂等操作重复执行

**问题**：POST/PUT 请求被 Envoy 自动重试，但下游服务没有幂等保护，导致重复创建订单。

**解决方案**：

1. 在 Envoy 中限制重试仅对安全方法生效：

```yaml
retry_policy:
  retry_on: "5xx,connect-failure"
  retriable_request_headers:
    - name: ":method"
      exact_match: "GET"
```

2. 或者在 Laravel 中实现幂等性（如上文的 `IdempotencyMiddleware`）

### 8.5 踩坑五：可观测性缺失

**问题**：引入 Sidecar 后，传统的 Laravel 日志无法看到完整的请求链路（经过了哪些 Sidecar、每个环节的耗时）。

**解决方案**：

1. 启用 Envoy 访问日志：

```yaml
http_connection_manager:
  access_log:
    - name: envoy.access_loggers.stdout
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.access_loggers.stream.v3.StdoutAccessLog
        log_format:
          text_format_source:
            inline_string: "[%START_TIME%] \"%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT% %DURATION%\n"
```

2. 配置分布式追踪（集成 Jaeger 或 Zipkin）：

```yaml
http_connection_manager:
  generate_request_id: true
  tracing:
    provider:
      name: envoy.tracers.zipkin
      typed_config:
        "@type": type.googleapis.com/envoy.config.trace.v3.ZipkinConfig
        collector_cluster: zipkin
        collector_endpoint: "/api/v2/spans"
```

### 8.6 踩坑六：Envoy 管理接口安全

**问题**：Envoy 的 Admin 接口（默认 9901 端口）暴露了集群状态、配置信息甚至支持热更新，如果暴露到公网会有严重安全风险。

**解决方案**：

```yaml
# 仅监听 localhost
admin:
  address:
    socket_address:
      address: 127.0.0.1
      port_value: 9901
```

在 Docker Compose 中不对外映射 9901 端口，仅通过 `docker exec` 或内部网络访问。

### 8.7 踩坑七：冷启动延迟

**问题**：Envoy 启动时需要加载配置、初始化连接池，首次请求的延迟会明显偏高。

**解决方案**：

```yaml
# 启用预连接和预热
clusters:
  - name: order_service
    # ...
    upstream_connection_options:
      tcp_keepalive:
        keepalive_time: 300
    # 预热连接
    warm_up_duration:
      seconds: 60
```

同时在 Laravel 的健康检查端点中加入对 Envoy 的就绪检查，避免流量在 Sidecar 未就绪时进入。

---

## 九、总结与架构决策建议

### 9.1 什么时候该引入 Envoy Sidecar

| 场景 | 建议 |
|------|------|
| 单体 Laravel 应用 | ❌ 暂不需要，增加复杂度无收益 |
| 2-3 个服务，通信简单 | ❌ Laravel 中间件 + Guzzle 足够 |
| 5+ 个微服务，多语言栈 | ✅ 强烈建议，统一治理收益明显 |
| 需要流量镜像做灰度 | ✅ Envoy 是最佳选择 |
| 需要统一熔断/重试策略 | ✅ 基础设施层实现更可靠 |
| 需要深度可观测性 | ✅ Envoy 原生支持分布式追踪 |

### 9.2 关键收益

1. **应用代码纯净**：Laravel 代码中不再有重试循环、熔断器配置、负载均衡逻辑
2. **运维独立**：流量策略调整不需要重新部署应用，修改 Envoy 配置即可生效
3. **统一治理**：所有服务（无论语言）共享相同的治理策略，消除了团队间的不一致性
4. **可观测性增强**：Sidecar 天然提供每个请求的详细元数据，便于故障排查和性能分析

### 9.3 需要付出的成本

1. **运维复杂度**：需要管理额外的 Envoy 配置文件和进程，建立相应的监控和告警
2. **资源开销**：每个 Sidecar 实例约消耗 50-100MB 内存，CPU 占用通常很低
3. **调试难度**：请求链路变长，排错需要同时查看 Envoy 日志和 Laravel 日志
4. **学习曲线**：团队需要掌握 Envoy 的配置语法和故障排查方法

### 9.4 渐进式引入策略

对于已有 Laravel 微服务架构的团队，建议采用渐进式的方式引入 Envoy Sidecar：

**第一阶段：出站代理**。只在 Laravel 调用下游服务时通过 Envoy 代理，入站流量保持原有的 Nginx → Laravel 链路不变。这样可以最小化改动范围，先熟悉 Envoy 的配置和运维方式。

**第二阶段：引入熔断和重试**。在出站代理稳定运行后，为关键的下游服务配置 `outlier_detection` 和 `retry_policy`，替换掉代码中的重试逻辑。此时可以在 staging 环境中通过故障注入（Fault Injection）验证熔断行为是否符合预期。

**第三阶段：流量镜像与灰度**。利用 Envoy 的 `request_mirror_policies` 实现生产流量的镜像验证。这通常是引入服务网格后价值最明显的阶段——你可以在不承担任何风险的情况下用真实流量验证新版本的行为。

**第四阶段：全面接管**。将入站流量也纳入 Envoy 代理，实现完整的双向 Sidecar 模式。此时可以考虑引入控制平面（如 Consul Connect）来集中管理所有 Sidecar 的配置。

这种渐进式的引入方式避免了"大爆炸"式的架构变更，每个阶段都有明确的验证目标和回滚方案，降低了技术风险。

---

## 参考资料

- [Envoy Proxy 官方文档](https://www.envoyproxy.io/docs/envoy/latest/)
- [Envoy Circuit Breaking 配置](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
- [Envoy Retry Policy 配置](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_routing)
- [Envoy Traffic Mirroring](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_routing#traffic-mirroring)
- [Service Mesh Pattern - CNCF](https://www.nginx.com/blog/service-mesh-patterns-nginx-plus/)
- [Laravel HTTP Client 文档](https://laravel.com/docs/http-client)

---

> **本文首发于个人博客，转载请注明出处。如有疑问或建议，欢迎在评论区交流。**

## 相关阅读

- [分布式追踪上下文传播实战：W3C Trace Context + Baggage](/post/distributed-tracing-trace-context-baggage-sampling-laravel/)
- [Kubernetes Debugging 实战：kubectl-debug + ephemeral-container](/post/kubernetes-debugging-kubectl-debug-ephemeral-container-lens-laravel-k8s/)
- [Azure Container Apps 实战：Laravel 微服务部署与自动扩缩容](/post/azure-container-apps-laravel/)
