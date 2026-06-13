---
title: "Gateway API + Cilium 实战：Kubernetes 流量管理新标准——Laravel 微服务的 L4/L7 路由、mTLS 与可观测性"
keywords: [Gateway API, Cilium, Kubernetes, Laravel, L4, L7, mTLS, 流量管理新标准, 微服务的, 路由]
date: 2026-06-09 06:37:00
categories:
  - architecture
tags:
  - Kubernetes
  - Gateway API
  - Cilium
  - Laravel
  - mTLS
  - Service Mesh
  - eBPF
description: "从 Ingress 到 Gateway API 的演进，结合 Cilium 的 eBPF 数据面，在 Laravel 微服务架构中实现 L4/L7 路由、自动 mTLS 和全链路可观测性。含完整实战配置与踩坑记录。"
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
---


## 为什么从 Ingress 迁移到 Gateway API？

Kubernetes 的 `Ingress` 资源从 1.2 起就是流量入口的标准，但随着微服务架构复杂度提升，它的局限性越来越明显：

- **功能贫瘠**：只有 Host + Path 匹配，高级路由（Header 匹配、权重分流、请求镜像）全靠注解，每个 Ingress Controller 的注解还不一样
- **角色混乱**：集群管理员和应用开发者共用一个 Ingress 对象，权限边界模糊
- **L4 无能为力**：TCP/UDP 路由需要另起炉灶

Gateway API（GA 于 Kubernetes 1.1）正是为了解决这些问题而生。它是 Kubernetes SIG-Network 推出的下一代流量管理标准，核心设计理念是**角色分离**和**可扩展性**。

```
Ingress (旧)                    Gateway API (新)
┌─────────────┐                ┌─────────────────────┐
│ Ingress      │                │ GatewayClass        │ ← 基础设施提供者
│ (所有职责)    │                │ Gateway             │ ← 集群运维
│              │                │ HTTPRoute/GRPCRoute │ ← 应用开发者
│              │                │ TCPRoute/TLSRoute   │ ← 应用开发者
└─────────────┘                └─────────────────────┘
```

## Cilium：eBPF 驱动的数据面

Cilium 是基于 eBPF 的 CNI 和 Service Mesh 方案，相比传统的 iptables/ipvs 方案有三个核心优势：

1. **内核级转发**：绕过 kube-proxy，数据包在内核态直接完成负载均衡，延迟降低 30-50%
2. **原生 mTLS**：基于 WireGuard 或 IPsec 实现节点间加密，无需 Sidecar
3. **Hubble 可观测性**：eBPF 天然能看到所有网络流，提供 L3/L4/L7 全栈监控

Cilium 1.12+ 已经内置了 Gateway API 的实现（`cilium-envoy`），所以不需要额外部署 Envoy 或 Nginx Ingress Controller。

## 环境准备

### 前置条件

- Kubernetes 1.28+（Gateway API v1.0 GA 需要 1.28+）
- Helm 3.12+
- kubectl gateway 插件（可选，方便调试）

### 安装 Gateway API CRD

```bash
# 安装 Gateway API 标准 CRD
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml

# 验证
kubectl get crd | grep gateway
# expected:
# gatewayclasses.gateway.networking.k8s.io
# gateways.gateway.networking.k8s.io
# grpcroutes.gateway.networking.k8s.io
# httproutes.gateway.networking.k8s.io
# referencegrants.gateway.networking.k8s.io
# tcproutes.gateway.networking.k8s.io
# tlsroutes.gateway.networking.k8s.io
```

### 安装 Cilium（启用 Gateway API）

```bash
helm repo add cilium https://helm.cilium.io/
helm repo update

helm install cilium cilium/cilium \
  --namespace kube-system \
  --set gatewayAPI.enabled=true \
  --set hubble.enabled=true \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true \
  --set encryption.enabled=true \
  --set encryption.type=wireguard \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost="$(kubectl get node -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')" \
  --set k8sServicePort=6443
```

关键参数说明：

| 参数 | 作用 |
|------|------|
| `gatewayAPI.enabled` | 启用 Cilium 的 Gateway API 实现 |
| `hubble.enabled` | 启用 eBPF 流量可观测性 |
| `encryption.enabled` | 启用节点间加密（WireGuard） |
| `kubeProxyReplacement` | 完全替换 kube-proxy |

验证安装：

```bash
cilium status
# 确认所有组件 Running，Gateway API 支持为 Enabled

kubectl get gatewayclass
# NAME         CONTROLLER                     ACCEPTED   AGE
# cilium       io.cilium/gateway-controller   True       30s
```

## 实战：Laravel 微服务路由配置

假设我们有一个 Laravel 微服务架构：

```
api-gateway (Laravel)     → /api/*
admin-service (Laravel)   → /admin/*
user-service (Laravel)    → /api/users/*
order-service (Laravel)   → /api/orders/*
payment-service (Laravel) → /api/payments/*
websocket-service (Laravel Reverb) → ws://
```

### 1. 部署 Laravel 微服务

先确保所有服务正常运行：

```yaml
# api-gateway-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: production
  labels:
    app: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: api-gateway
        image: registry.example.com/laravel-api-gateway:latest
        ports:
        - containerPort: 8080
        env:
        - name: APP_ENV
          value: production
        - name: DB_HOST
          value: mysql.production.svc.cluster.local
        - name: REDIS_HOST
          value: redis.production.svc.cluster.local
        resources:
          requests:
            cpu: 250m
            memory: 256Mi
          limits:
            cpu: 1000m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
  namespace: production
spec:
  selector:
    app: api-gateway
  ports:
  - port: 80
    targetPort: 8080
```

其他微服务部署方式类似，省略重复配置。

### 2. 创建 Gateway

```yaml
# gateway.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: laravel-main-gateway
  namespace: production
spec:
  gatewayClassName: cilium
  listeners:
  # HTTP 入口
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      namespaces:
        from: Same
  # HTTPS 入口
  - name: https
    protocol: HTTPS
    port: 443
    tls:
      mode: Terminate
      certificateRefs:
      - name: wildcard-tls
    allowedRoutes:
      namespaces:
        from: Same
  # WebSocket 入口（独立端口）
  - name: websocket
    protocol: HTTPS
    port: 8443
    tls:
      mode: Terminate
      certificateRefs:
      - name: wildcard-tls
    allowedRoutes:
      namespaces:
        from: Same
```

### 3. L7 路由：HTTPRoute

这是 Gateway API 最核心的能力——基于 HTTP 属性做精细路由。

```yaml
# api-routes.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-gateway-route
  namespace: production
spec:
  parentRefs:
  - name: laravel-main-gateway
    sectionName: https
  hostnames:
  - "api.example.com"
  rules:
  # 用户服务路由
  - matches:
    - path:
        type: PathPrefix
        value: /api/v1/users
    backendRefs:
    - name: user-service
      port: 80
      weight: 100

  # 订单服务路由（带 Header 匹配）
  - matches:
    - path:
        type: PathPrefix
        value: /api/v1/orders
      headers:
      - name: X-Api-Version
        value: "v2"
    backendRefs:
    - name: order-service-v2
      port: 80
      weight: 100

  # 订单服务 v1 路由（v1 用户走这里）
  - matches:
    - path:
        type: PathPrefix
        value: /api/v1/orders
    filters:
    - type: RequestHeaderModifier
      requestHeaderModifier:
        add:
        - name: X-Served-By
          value: order-service-v1
    backendRefs:
    - name: order-service-v1
      port: 80
      weight: 90
    - name: order-service-v2
      port: 80
      weight: 10   # 10% 流量切到 v2（金丝雀发布）

  # 支付服务路由
  - matches:
    - path:
        type: PathPrefix
        value: /api/v1/payments
    filters:
    - type: RequestMirror
      requestMirror:
        backendRef:
          name: payment-shadow
          port: 80
    backendRefs:
    - name: payment-service
      port: 80

  # 管理后台路由（独立域名）
  - matches:
    - path:
        type: PathPrefix
        value: /admin
    filters:
    - type: RequestHeaderModifier
      requestHeaderModifier:
        add:
        - name: X-Forwarded-Prefix
          value: /admin
    backendRefs:
    - name: admin-service
      port: 80
```

### 4. WebSocket 路由

Laravel Reverb 需要 WebSocket 支持，使用独立的 HTTPRoute：

```yaml
# websocket-route.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: websocket-route
  namespace: production
spec:
  parentRefs:
  - name: laravel-main-gateway
    sectionName: websocket
  hostnames:
  - "ws.example.com"
  rules:
  - matches:
    - headers:
      - name: Upgrade
        value: websocket
    backendRefs:
    - name: websocket-service
      port: 80
```

### 5. L4 路由：TCPRoute

对于 MySQL 代理、Redis Sentinel 等非 HTTP 协议，用 TCPRoute：

```yaml
# tcp-routes.yaml
apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: mysql-proxy-route
  namespace: production
spec:
  parentRefs:
  - name: laravel-main-gateway
    sectionName: tcp-mysql
  rules:
  - backendRefs:
    - name: mysql-proxy
      port: 3306
```

Gateway 需要额外添加 TCP listener：

```yaml
  # 在 Gateway 的 listeners 中追加
  - name: tcp-mysql
    protocol: TCP
    port: 3306
    allowedRoutes:
      namespaces:
        from: Same
```

### 6. mTLS 配置

Cilium 支持两种 mTLS 模式：

**模式 A：传输层加密（WireGuard）**

上面的 Helm 安装已经启用了 WireGuard，节点间流量自动加密。验证：

```bash
# 检查 WireGuard 状态
cilium encryption status
# Encryption: Wireguard
# Interface: cilium_wg0
# Public Key: xxxxx
```

**模式 B：应用层 mTLS（CiliumNetworkPolicy）**

如果需要服务间的双向 TLS 认证（零信任网络），使用 CiliumNetworkPolicy：

```yaml
# mtls-policy.yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: payment-service-mtls
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: payment-service
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: api-gateway
    toPorts:
    - ports:
      - port: "8080"
        protocol: TCP
      rules:
        http:
        - method: POST
          path: "/api/v1/payments/.*"
        - method: GET
          path: "/api/v1/payments/.*"
  egress:
  - toEndpoints:
    - matchLabels:
        app: mysql
    toPorts:
    - ports:
      - port: "3306"
        protocol: TCP
  - toEndpoints:
    - matchLabels:
        app: redis
    toPorts:
    - ports:
      - port: "6379"
        protocol: TCP
```

这个策略实现了：
- 只有 `api-gateway` 能访问 `payment-service`
- `payment-service` 只能访问 MySQL 和 Redis
- 其他所有流量被拒绝

### 7. 可观测性：Hubble

Hubble 是 Cilium 内置的可观测性工具，基于 eBPF 自动采集所有网络流。

```bash
# 开启 Hubble UI
cilium hubble ui --port-forward 12000
# 浏览器访问 http://localhost:12000

# 命令行查看流量
hubble observe --namespace production --verdict Forwarded --protocol http
```

Laravel 应用层面，配合 OpenTelemetry 做全链路追踪：

```php
// config/telemetry.php
<?php

return [
    'exporters' => [
        'otlp' => [
            'endpoint' => env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318'),
            'protocol' => 'http/protobuf',
        ],
    ],
    'traces' => [
        'sampler' => env('OTEL_TRACES_SAMPLER', 'parentbased_traceidratio'),
        'sample_ratio' => (float) env('OTEL_TRACES_SAMPLE_RATIO', '0.1'),
    ],
];
```

Hubble 的 L7 可以直接看到 HTTP 方法、路径、状态码、延迟分布，配合 Laravel 的 trace ID 可以做到：

```
客户端 → Gateway API → api-gateway → user-service → MySQL
  │          │              │              │           │
  └── Hubble └── Hubble └── OTEL └── OTEL └── Hubble
```

## 踩坑记录

### 坑 1：Gateway API CRD 版本冲突

**现象**：安装 Cilium 后 Gateway 一直 `Pending`，报 `no matching GatewayClass`。

**原因**：之前手动安装的 Gateway API CRD 是 v0.x，Cilium 需要 v1.0+。

**解决**：

```bash
# 清理旧 CRD
kubectl delete -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v0.7.0/experimental-install.yaml

# 安装新版
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml
```

### 坑 2：HTTPRoute 的 PathPrefix 不匹配 Laravel 路由

**现象**：配置了 `PathPrefix: /api/v1/users`，但 Laravel 返回 404。

**原因**：Laravel 的 `Route::prefix('api/v1')` 需要完整路径，但 Gateway 的 PathPrefix 匹配后，转发给后端时会保留原始路径。如果 Laravel 的路由前缀配置不同，就会 404。

**解决**：在 HTTPRoute 中添加 `URLRewrite` filter：

```yaml
- matches:
  - path:
      type: PathPrefix
      value: /api/v1/users
  filters:
  - type: URLRewrite
    urlRewrite:
      path:
        type: ReplacePrefixMatch
        replacePrefixMatch: /
  backendRefs:
  - name: user-service
    port: 80
```

### 坑 3：WebSocket 连接被断开

**现象**：WebSocket 握手成功，但 30 秒后断开。

**原因**：Cilium 的默认 idle timeout 是 30 秒。

**解决**：在 Gateway 的 listener 注解中设置超时：

```yaml
listeners:
- name: websocket
  protocol: HTTPS
  port: 8443
  # 通过 Cilium 特有的注解设置超时
  # 或者在 CiliumEnvoyConfig 中覆盖
```

或者使用 CiliumEnvoyConfig：

```yaml
apiVersion: cilium.io/v2
kind: CiliumEnvoyConfig
metadata:
  name: websocket-timeout
  namespace: production
spec:
  resources:
  - "@type": type.googleapis.com/envoy.config.listener.v3.Listener
    name: listener-websocket
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stream_idle_timeout: 3600s
          request_timeout: 3600s
```

### 坑 4：金丝雀发布权重不生效

**现象**：配置了 90/10 权重，但所有流量都走 v1。

**原因**：`backendRefs` 中两个 Service 的 `port` 不同，Gateway API 会当作不同的后端组。

**解决**：确保两个 backendRef 的 `port` 和 `kind` 完全一致：

```yaml
backendRefs:
- name: order-service-v1
  port: 80
  kind: Service
  weight: 90
- name: order-service-v2
  port: 80
  kind: Service
  weight: 10
```

### 坑 5：mTLS 后 Laravel 获取不到客户端 IP

**现象**：`request()->ip()` 返回的是 Cilium 内部 IP。

**解决**：在 Laravel 的 `TrustedProxy` 中配置：

```php
// app/Http/Middleware/TrustProxies.php
protected $proxies = [
    '10.0.0.0/8',      // Cilium Pod CIDR
    '100.64.0.0/10',    // Cilium WireGuard CIDR
];

protected $headers = Request::HEADER_X_FORWARDED_FOR |
                     Request::HEADER_X_FORWARDED_HOST |
                     Request::HEADER_X_FORWARDED_PORT |
                     Request::HEADER_X_FORWARDED_PROTO |
                     Request::HEADER_X_FORWARDED_AWS_ELB;
```

## 生产环境 Checklist

```yaml
# 生产上线前确认清单
checklist:
  gateway:
    - [ ] GatewayClass 状态 Accepted
    - [ ] 所有 Listener 状态 Ready
    - [ ] TLS 证书已配置且未过期
    - [ ] HTTPRoute 全部 Accepted

  security:
    - [ ] CiliumNetworkPolicy 覆盖所有服务
    - [ ] mTLS 加密已启用
    - [ ] 外部流量强制 HTTPS（HTTP → HTTPS 重定向）
    - [ ] 敏感服务（payment）有独立的访问策略

  observability:
    - [ ] Hubble UI 可访问
    - [ ] OpenTelemetry 已集成
    - [ ] 告警规则已配置（5xx 响应率、延迟 P99）
    - [ ] Grafana Dashboard 已部署

  performance:
    - [ ] 负载测试通过（k6 / wrk）
    - [ ] 金丝雀发布流程验证
    - [ ] 回滚方案已测试
```

## 迁移 Ingress → Gateway API 的步骤

如果你已有 Ingress 配置，按以下步骤迁移：

```bash
# 1. 备份现有 Ingress
kubectl get ingress -A -o yaml > ingress-backup.yaml

# 2. 安装 Gateway API CRD
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml

# 3. 创建 Gateway 对象（参考上面的配置）

# 4. 逐个迁移 HTTPRoute（先并行运行，验证一致后切换 DNS）

# 5. 删除旧 Ingress
kubectl delete ingress <name> -n <namespace>

# 6. 清理旧 Ingress Controller（如果不再需要）
helm uninstall nginx-ingress -n ingress-nginx
```

## 总结

Gateway API + Cilium 的组合为 Kubernetes 流量管理带来了质的飞跃：

- **Gateway API** 提供了标准化的、角色分离的流量管理接口，消除了 Ingress 的注解地狱
- **Cilium** 的 eBPF 数据面提供了高性能的 L4/L7 路由、原生加密和深度可观测性
- 对 Laravel 微服务来说，这意味着更精细的流量控制（金丝雀、镜像、Header 路由）和零信任安全

Ingress 不会立刻消失，但 Gateway API 已经是 Kubernetes SIG-Network 官方认定的未来方向。对于新项目，建议直接采用 Gateway API；对于存量项目，可以在 Ingress 和 Gateway API 并行运行一段时间后平滑迁移。

从 `Ingress` 到 `Gateway API`，不只是 API 的变化，更是流量管理理念的升级——从"一个大杂烩配置文件"到"角色清晰、职责分明"的标准化接口。
