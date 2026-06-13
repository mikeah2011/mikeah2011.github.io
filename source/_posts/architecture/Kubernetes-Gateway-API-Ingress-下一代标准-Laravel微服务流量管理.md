---
title: Kubernetes Gateway API 实战：Ingress 的下一代标准——Laravel 微服务的流量管理新范式
date: 2026-06-06 00:00:00
tags:
- Kubernetes
- Gateway API
- Ingress
- Laravel
- 微服务
- 云原生
- 流量管理
description: 深入实战 Kubernetes Gateway API——Ingress 的下一代标准，从架构视角全面解析 GatewayClass、Gateway、HTTPRoute
  三层资源模型如何取代传统 Ingress 在 Laravel 微服务中的流量管理角色。涵盖路由匹配、流量拆分、请求改写、跨命名空间引用等核心能力，对比 Envoy
  Gateway、Nginx Gateway Fabric、Cilium 等主流实现的架构差异与性能基准，提供从 Ingress 迁移到 Gateway API
  的完整路径与踩坑指南。
categories:
- architecture
cover: /images/covers/kubernetes-gateway-api-cover.jpg
---



# Kubernetes Gateway API 实战：Ingress 的下一代标准——Laravel 微服务的流量管理新范式

## 一、引言：从 Ingress 的痛点到 Gateway API 的诞生

在过去几年的 Kubernetes 生产实践中，Ingress 资源一直是集群入口流量管理的事实标准。然而，随着微服务架构的深入落地，尤其是 Laravel 应用从单体走向由 Lumen 微服务、API Gateway、后台任务服务等组成的复杂拓扑后，传统 Ingress 的局限性日益凸显。

**Ingress 的核心痛点可以归结为以下几点：**

1. **表达能力不足**：Ingress 只支持基于主机名和路径前缀的路由，无法实现基于 Header、查询参数、HTTP 方法等精细化匹配。当你需要为 Laravel API 的 `/api/v2/*` 路径添加独立的限流策略，或根据 `Accept` Header 进行版本路由时，Ingress 捉襟见肘。

2. **角色边界模糊**：在 Ingress 模型中，基础设施提供者、集群运维工程师和应用开发者三者的职责被压缩到同一个 `Ingress` 资源里。一个网络团队创建的 Ingress 和一个开发团队创建的 Ingress 之间没有清晰的语义边界，导致权限管理和协作困难。

3. **可移植性差**：不同 Ingress Controller 的实现差异巨大——Nginx Ingress 用 `nginx.ingress.kubernetes.io/*` 注解，Traefik 用自己的 CRD，Ambassador 有 Mapping 资源。一旦团队决定从一个 Controller 迁移到另一个，所有配置都需要重写。

4. **缺乏原生的高级流量管理**：权重分流、请求改写、故障注入等能力完全依赖于特定 Controller 的注解或 CRD 扩展，不属于 Ingress API 本身。

正因如此，Kubernetes SIG-Network 社区在 2021 年启动了 Gateway API 项目（最初命名为 Service API），目标是创建一个更具表达力、角色分离更清晰、可移植性更强的下一代入口流量管理标准。到 2023 年，Gateway API 正式 GA（v1.0），目前已被所有主流 Controller 支持，并成为 Kubernetes 社区推荐的 Ingress 替代方案。

本文将以一个真实的 Laravel 微服务系统为例，带你从零搭建 Gateway API 环境，逐步实现路由管理、流量治理、安全策略、金丝雀发布和可观测性等全链路能力。

---

## 二、Gateway API 核心概念深度解析

Gateway API 由一组标准化的 Kubernetes CRD 组成，形成了一个层次清晰的资源模型。理解这些资源之间的关系是正确使用 Gateway API 的基础。

### 2.1 GatewayClass

`GatewayClass` 类似于 StorageClass，它由基础设施提供者（如云厂商、网络团队）定义，描述了一种可用的网关实现类型。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: nginx-gateway
spec:
  controllerName: gateway.nginx.org/nginx-gateway-controller
  parametersRef:
    group: gateway.nginx.org
    kind: NginxProxy
    name: nginx-proxy-config
    namespace: nginx-gateway
```

每个 GatewayClass 绑定一个 `controllerName`，表示哪个控制器负责处理引用该类的 Gateway 资源。`parametersRef` 可以引用一个集群级或命名空间级的参数对象，用于自定义控制器行为（如全局日志级别、默认超时等）。

### 2.2 Gateway

`Gateway` 是实际的网关实例，由集群运维工程师创建。它声明监听器（Listener），定义端口、协议、TLS 配置和允许的路由命名空间。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: laravel-main-gateway
  namespace: infra
spec:
  gatewayClassName: nginx-gateway
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              gateway-access: "true"
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: wildcard-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              gateway-access: "true"
```

**关键设计要点：**

- `allowedRoutes.namespaces` 通过 `Selector` 模式精确控制哪些命名空间可以将路由附加到此网关，这是实现权限隔离的核心机制。
- 每个 Listener 可以绑定不同的 TLS 配置，支持多域名、多证书场景。
- Gateway 的状态（`status.listeners`）会反馈给运维人员，告知每个 Listener 是否被正确编程。

### 2.3 HTTPRoute

`HTTPRoute` 是最核心的路由资源，由应用开发者创建，定义流量匹配规则和后端转发策略。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: laravel-api-route
  namespace: laravel-app
spec:
  parentRefs:
    - name: laravel-main-gateway
      namespace: infra
      sectionName: https
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/v1
          method: GET
      backendRefs:
        - name: laravel-api-v1
          port: 8080
          weight: 100
    - matches:
        - path:
            type: PathPrefix
            value: /api/v2
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            add:
              - name: X-API-Version
                value: "v2"
      backendRefs:
        - name: laravel-api-v2
          port: 8080
```

HTTPRoute 支持的匹配条件包括：
- **路径匹配**：`PathPrefix`、`Exact`、`RegularExpression`（实验性）
- **Header 匹配**：基于 Header 名称和值（支持正则）
- **查询参数匹配**：基于 URL 查询参数
- **HTTP 方法匹配**：GET、POST、PUT 等

### 2.4 ReferenceGrant

`ReferenceGrant` 解决了跨命名空间引用的信任问题。当 Gateway（在 `infra` 命名空间）需要引用 TLS Secret（在 `certs` 命名空间）时，`certs` 命名空间必须通过 `ReferenceGrant` 明确授权。

```yaml
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-gateway-tls-ref
  namespace: certs
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: Gateway
      namespace: infra
  to:
    - group: ""
      kind: Secret
```

### 2.5 GRPCRoute

`GRPCRoute` 专门为 gRPC 流量设计，支持基于 service name 和 method name 的匹配，适用于 Laravel 应用通过 gRPC 与下游微服务通信的场景。

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: order-grpc-route
  namespace: laravel-app
spec:
  parentRefs:
    - name: laravel-main-gateway
      namespace: infra
      sectionName: https
  hostnames:
    - "grpc.example.com"
  rules:
    - matches:
        - method:
            service: order.OrderService
            method: CreateOrder
      backendRefs:
        - name: order-grpc-service
          port: 50051
```

---

## 三、Gateway API vs 传统 Ingress：全方位对比

### 3.1 角色分离模型

Gateway API 的最大设计创新是引入了**角色导向的资源模型**：

| 角色 | 职责 | 对应资源 | 典型人员 |
|------|------|---------|---------|
| 基础设施提供者 | 定义网关实现类型、全局参数 | GatewayClass | 云厂商/平台团队 |
| 集群运维 | 创建网关实例、配置监听器、管理证书 | Gateway | SRE/运维工程师 |
| 应用开发者 | 定义路由规则、后端服务 | HTTPRoute, GRPCRoute | 开发团队 |

这种分离使得权限可以用 Kubernetes RBAC 精确控制——运维团队只需要 `gateway` 的 write 权限，开发团队只需要 `httproute` 的 write 权限，互不干扰。

### 3.2 表达能力对比

| 能力 | Ingress | Gateway API |
|------|---------|-------------|
| 路径匹配 | 前缀、精确 | 前缀、精确、正则 |
| Header 路由 | ❌ 需注解 | ✅ 原生支持 |
| 查询参数路由 | ❌ | ✅ |
| HTTP 方法路由 | ❌ | ✅ |
| 请求头修改 | ❌ 需注解 | ✅ 原生 Filter |
| URL 重写 | ❌ 需注解 | ✅ 原生 Filter |
| 权重分流 | ❌ 需注解 | ✅ 原生支持 |
| 跨命名空间路由 | ❌ | ✅ parentRefs |
| 请求镜像 | ❌ | ✅ 原生 Filter |

### 3.3 可移植性

Gateway API 是一个标准化 API，不同控制器实现的是同一个资源定义。从 Nginx Gateway Fabric 迁移到 Envoy Gateway，HTTPRoute YAML 基本无需修改，只有 GatewayClass 和 Gateway 的部分字段需要调整。

---

## 四、实战环境搭建

### 4.1 创建 kind 集群

```bash
# 创建 kind 集群配置
cat <<EOF > kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080
        hostPort: 80
        protocol: TCP
      - containerPort: 30443
        hostPort: 443
        protocol: TCP
  - role: worker
  - role: worker
EOF

kind create cluster --name gateway-api-demo --config kind-config.yaml
```

如果你使用 k3s，可以直接安装并禁用默认的 Traefik Ingress：

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik" sh -
```

### 4.2 安装 Gateway API CRD

Gateway API CRD 是独立于控制器的，需要单独安装：

```bash
# 安装标准 Channel（包含所有 GA 资源）
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/standard-install.yaml

# 安装实验性 Channel（包含 GRPCRoute、TLSRoute 等实验资源）
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/experimental-install.yaml
```

### 4.3 安装 Nginx Gateway Fabric

Nginx Gateway Fabric 是 F5/NGINX 官方维护的 Gateway API 实现，基于 NGINX 的强大转发能力：

```bash
# 添加 Helm 仓库
helm repo add nginx-gateway-fabric https://nginx.github.io/gateway-helm
helm repo update

# 安装
helm install ngf nginx-gateway-fabric/nginx-gateway-fabric \
  -n nginx-gateway --create-namespace \
  --set nginx.service.type=NodePort \
  --set nginx.service.httpPort.nodePort=30080 \
  --set nginx.service.httpsPort.nodePort=30443
```

如果你想使用 Envoy Gateway（Envoy Proxy 的 Gateway API 实现）：

```bash
helm install eg oci://docker.io/envoyproxy/gateway-helm \
  -n envoy-gateway-system --create-namespace
```

### 4.4 验证安装

```bash
# 确认 CRD 已安装
kubectl get crd | grep gateway

# 确认控制器正在运行
kubectl get pods -n nginx-gateway

# 创建 GatewayClass
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: nginx-gateway
spec:
  controllerName: gateway.nginx.org/nginx-gateway-controller
EOF
```

---

## 五、Laravel 微服务路由实战

假设我们有一个 Laravel 微服务系统，包含以下服务：

- **laravel-api-gateway**：统一 API 入口，处理认证和路由
- **laravel-user-service**：用户管理服务
- **laravel-order-service**：订单管理服务
- **laravel-product-service**：商品管理服务
- **laravel-admin-panel**：管理后台（Laravel + Inertia.js）

### 5.1 基础部署

创建命名空间和示例服务：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: laravel
  labels:
    gateway-access: "true"
---
# 用户服务 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
  namespace: laravel
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
        version: v1
    spec:
      containers:
        - name: app
          image: registry.example.com/laravel-user-service:1.0.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          env:
            - name: APP_ENV
              value: "production"
            - name: DB_HOST
              valueFrom:
                secretKeyRef:
                  name: user-service-db
                  key: host
---
apiVersion: v1
kind: Service
metadata:
  name: user-service
  namespace: laravel
spec:
  selector:
    app: user-service
  ports:
    - port: 8080
      targetPort: 8080
```

订单服务和商品服务的部署类似，此处省略。

### 5.2 路径匹配路由

创建 Gateway 并配置基于路径的路由，将不同前缀分发到不同的 Laravel 微服务：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: laravel-gateway
  namespace: infra
spec:
  gatewayClassName: nginx-gateway
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: wildcard-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              gateway-access: "true"
---
# 用户服务路由
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: user-service-route
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/users
      backendRefs:
        - name: user-service
          port: 8080
---
# 订单服务路由
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-service-route
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/orders
      backendRefs:
        - name: order-service
          port: 8080
```

### 5.3 Header 路由（API 版本化）

Laravel 微服务常需要支持多版本 API 并存。通过 Header 匹配实现优雅的版本路由：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-version-routing
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    # v1 客户端通过 Header 指定
    - matches:
        - headers:
            - name: X-API-Version
              value: "1"
      backendRefs:
        - name: user-service-v1
          port: 8080
    # v2 客户端
    - matches:
        - headers:
            - name: X-API-Version
              value: "2"
      backendRefs:
        - name: user-service-v2
          port: 8080
    # 默认路由到最新版本
    - backendRefs:
        - name: user-service-v2
          port: 8080
```

在 Laravel 侧，可以通过中间件添加版本 Header：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class ApiVersionNegotiation
{
    public function handle(Request $request, Closure $next)
    {
        // 如果客户端通过 Accept Header 指定版本
        $accept = $request->header('Accept');
        
        if (preg_match('/application\/vnd\.myapp\.v(\d+)\+json/', $accept, $matches)) {
            $request->headers->set('X-API-Version', $matches[1]);
        }

        // 通过 URL 路径指定版本也支持
        if (preg_match('#/api/v(\d+)/#', $request->path(), $matches)) {
            $request->headers->set('X-API-Version', $matches[1]);
        }

        return $next($request);
    }
}
```

### 5.4 权重分流（灰度发布）

Gateway API 原生支持权重分流，无需任何 Controller 特有的注解：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: user-service-canary
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/users
      backendRefs:
        - name: user-service-v1
          port: 8080
          weight: 90
        - name: user-service-v2
          port: 8080
          weight: 10
```

这将 90% 的流量发送到 v1，10% 发送到 v2。可以逐步调整权重实现渐进式发布。

### 5.5 请求改写

当 Laravel 应用内部使用统一前缀但外部 URL 不同的场景下，URL 重写非常实用：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: admin-panel-rewrite
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "admin.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /panel
      filters:
        - type: URLRewrite
          urlRewrite:
            hostname: admin-panel.laravel.svc.cluster.local
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      backendRefs:
        - name: admin-panel
          port: 8080
```

Laravel 侧需要确保 `APP_URL` 和路由前缀配置正确：

```php
// config/app.php
'url' => env('APP_URL', 'https://admin.example.com/panel'),

// routes/web.php — 使用 Route::group 处理前缀
Route::group(['prefix' => 'panel'], function () {
    Route::get('/', [AdminController::class, 'dashboard']);
    Route::resource('posts', PostController::class);
});
```

---

## 六、流量治理

### 6.1 限流

Gateway API v1.1+ 引入了 `BackendLBPolicy` 和扩展过滤器来支持限流。以 Nginx Gateway Fabric 为例，可以通过其 CRD 实现限流：

```yaml
apiVersion: gateway.nginx.org/v1alpha1
kind: ClientSettingsPolicy
metadata:
  name: api-rate-limit
  namespace: laravel
spec:
  targetRef:
    group: gateway.networking.k8s.io
    kind: HTTPRoute
    name: user-service-route
  rateLimit:
    rate: 100r/s
    burst: 50
    delay: 10
    noDelay: false
    zoneSize: 10m
    key: "${remote_addr}"
    status: 429
```

对于 Envoy Gateway，可以使用 `BackendTrafficPolicy`：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: rate-limit-policy
  namespace: laravel
spec:
  targetRef:
    group: gateway.networking.k8s.io
    kind: HTTPRoute
    name: user-service-route
  rateLimit:
    global:
      rules:
        - clientSelectors:
            - headers:
                - name: X-Forwarded-For
                  type: Distinct
          limit:
            requests: 100
            unit: Second
```

### 6.2 重试与超时

Gateway API 原生支持在 HTTPRoute 上配置超时和重试策略：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-service-with-retry
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/orders
      timeouts:
        request: 30s
        backendRequest: 25s
      retry:
        codes:
          - 502
          - 503
          - 504
        attempts: 3
        backoff: 1s
      backendRefs:
        - name: order-service
          port: 8080
```

在 Laravel 侧，合理的超时配合可以避免级联超时：

```php
// config/timeout.php
return [
    'database' => [
        'connection_timeout' => 5,
        'query_timeout' => 10,
    ],
    'queue' => [
        'retry_after' => 90,
        'timeout' => 60,
    ],
    'http_client' => [
        'timeout' => 10,
        'connect_timeout' => 3,
        'retry' => 3,
    ],
];
```

### 6.3 断路器与故障注入

Envoy Gateway 支持通过 `BackendTrafficPolicy` 配置断路器：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: circuit-breaker
  namespace: laravel
spec:
  targetRef:
    group: gateway.networking.k8s.io
    kind: HTTPRoute
    name: order-service-route
  circuitBreaker:
    maxConnections: 100
    maxPendingRequests: 50
    maxRequests: 200
    maxRetries: 3
```

故障注入用于混沌测试，验证 Laravel 应用的韧性：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: fault-injection-test
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "staging-api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/orders
      filters:
        - type: ExtensionRef
          extensionRef:
            group: gateway.envoyproxy.io
            kind: HTTPRouteFilter
            name: inject-delay
      backendRefs:
        - name: order-service
          port: 8080
```

---

## 七、安全策略

### 7.1 TLS 终止与自动证书管理

结合 cert-manager 实现 TLS 证书的自动签发和续期：

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: api-example-com-tls
  namespace: infra
spec:
  secretName: api-example-com-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - "api.example.com"
    - "admin.example.com"
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: laravel-gateway
  namespace: infra
spec:
  gatewayClassName: nginx-gateway
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: api-example-com-tls
```

### 7.2 CORS 配置

通过 HTTPRoute 的 CORS 策略或控制器特定的扩展来配置跨域：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: cors-api-route
  namespace: laravel
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      filters:
        - type: ResponseHeaderModifier
          responseHeaderModifier:
            add:
              - name: Access-Control-Allow-Origin
                value: "https://frontend.example.com"
              - name: Access-Control-Allow-Methods
                value: "GET, POST, PUT, DELETE, OPTIONS"
              - name: Access-Control-Allow-Headers
                value: "Content-Type, Authorization, X-API-Version"
              - name: Access-Control-Max-Age
                value: "86400"
      backendRefs:
        - name: api-gateway
          port: 8080
```

Laravel 侧的 CORS 配置应与网关层保持一致：

```php
// config/cors.php
return [
    'paths' => ['api/*'],
    'allowed_origins' => ['https://frontend.example.com'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    'allowed_headers' => ['Content-Type', 'Authorization', 'X-API-Version'],
    'max_age' => 86400,
    'supports_credentials' => true,
];
```

### 7.3 JWT 验证与认证策略

Envoy Gateway 支持原生 JWT 验证，可以在网关层拦截无效 Token，减轻 Laravel 应用层的压力：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: jwt-auth
  namespace: laravel
spec:
  targetRef:
    group: gateway.networking.k8s.io
    kind: HTTPRoute
    name: user-service-route
  jwt:
    providers:
      - name: laravel-sanctum
        issuer: "https://auth.example.com"
        audiences:
          - "api.example.com"
        remoteJWKS:
          uri: "https://auth.example.com/.well-known/jwks.json"
          timeout: 5s
        claimToHeaders:
          - header: X-User-ID
            claim: sub
          - header: X-User-Role
            claim: role
```

这样 Laravel 的 Sanctum 中间件可以信任网关传来的 `X-User-ID` Header（前提是内部网络不可伪造）：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class TrustGatewayAuth
{
    public function handle(Request $request, Closure $next)
    {
        // 只信任来自内部网关的认证信息
        if ($request->header('X-Gateway-Verified') === 'true') {
            $userId = $request->header('X-User-ID');
            $user = User::find($userId);
            if ($user) {
                auth()->setUser($user);
                return $next($request);
            }
        }

        // 回退到 Laravel Sanctum 标准认证
        return $next($request);
    }
}
```

---

## 八、金丝雀发布与蓝绿部署

### 8.1 金丝雀发布（渐进式）

金丝雀发布的核心是权重路由，配合自动化脚本实现渐进式推进：

```yaml
# 第一阶段：5% 流量到新版本
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-service-canary-stage1
  namespace: laravel
  annotations:
    canary-stage: "1"
    canary-weight-new: "5"
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/orders
      backendRefs:
        - name: order-service-stable
          port: 8080
          weight: 95
        - name: order-service-canary
          port: 8080
          weight: 5
```

自动化金丝雀推进脚本（可集成到 CI/CD）：

```bash
#!/bin/bash
# canary-promote.sh
NAMESPACE="laravel"
ROUTE_NAME="order-service-canary-stage1"
STABLE_SVC="order-service-stable"
CANARY_SVC="order-service-canary"

WEIGHTS=(5 10 25 50 75 100)
HEALTH_CHECK_INTERVAL=60  # 每阶段观察60秒

for NEW_WEIGHT in "${WEIGHTS[@]}"; do
    OLD_WEIGHT=$((100 - NEW_WEIGHT))
    echo "Promoting canary: stable=${OLD_WEIGHT}%, canary=${NEW_WEIGHT}%"
    
    kubectl patch httproute "$ROUTE_NAME" -n "$NAMESPACE" --type=merge -p "{
        \"spec\": {
            \"rules\": [{
                \"matches\": [{\"path\": {\"type\": \"PathPrefix\", \"value\": \"/api/orders\"}}],
                \"backendRefs\": [
                    {\"name\": \"${STABLE_SVC}\", \"port\": 8080, \"weight\": ${OLD_WEIGHT}},
                    {\"name\": \"${CANARY_SVC}\", \"port\": 8080, \"weight\": ${NEW_WEIGHT}}
                ]
            }]
        }
    }"
    
    echo "Observing for ${HEALTH_CHECK_INTERVAL}s..."
    sleep "$HEALTH_CHECK_INTERVAL"
    
    # 检查金丝雀版本的错误率
    ERROR_RATE=$(curl -s "http://prometheus:9090/api/v1/query" \
        --data-urlencode 'query=rate(http_requests_total{service="order-service-canary",status=~"5.."}[1m]) / rate(http_requests_total{service="order-service-canary"}[1m])' \
        | jq '.data.result[0].value[1]' -r)
    
    if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
        echo "ERROR: Canary error rate ${ERROR_RATE} exceeds threshold (1%). Rolling back!"
        # 回滚到全量稳定版本
        kubectl patch httproute "$ROUTE_NAME" -n "$NAMESPACE" --type=merge -p '{
            "spec": {"rules": [{"backendRefs": [
                {"name": "'${STABLE_SVC}'", "port": 8080, "weight": 100}
            ]}]}
        }'
        exit 1
    fi
done

echo "Canary promotion complete!"
```

### 8.2 蓝绿部署

蓝绿部署需要两套完整的环境，通过 HTTPRoute 的 backendRefs 切换：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-service-blue-green
  namespace: laravel
  annotations:
    active-deployment: "blue"
spec:
  parentRefs:
    - name: laravel-gateway
      namespace: infra
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/orders
      backendRefs:
        - name: order-service-blue
          port: 8080
          weight: 100
```

切换到绿色环境：

```bash
kubectl patch httproute order-service-blue-green -n laravel --type=merge -p '{
    "spec": {"rules": [{"matches": [{"path": {"type": "PathPrefix", "value": "/api/orders"}}],
    "backendRefs": [
        {"name": "order-service-green", "port": 8080, "weight": 100}
    ]}]}
}'
kubectl annotate httproute order-service-blue-green -n laravel active-deployment=green --overwrite
```

---

## 九、可观测性

### 9.1 Prometheus 指标采集

Nginx Gateway Fabric 和 Envoy Gateway 都暴露 Prometheus 指标。配置 ServiceMonitor：

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: nginx-gateway-metrics
  namespace: nginx-gateway
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: nginx-gateway-fabric
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
```

### 9.2 Grafana Dashboard

关键监控指标包括：

- `gateway_nginx_*`：Nginx 连接数、请求速率、响应时间
- `envoy_cluster_*`：Envoy 集群健康状态
- `gateway_httproute_*`：各 HTTPRoute 的请求计数

推荐使用社区提供的 Grafana Dashboard（ID: 17353 for Nginx Gateway Fabric）。

### 9.3 访问日志

Nginx Gateway Fabric 的访问日志配置：

```yaml
apiVersion: gateway.nginx.org/v1alpha1
kind: NginxProxy
metadata:
  name: nginx-proxy-config
  namespace: nginx-gateway
spec:
  logging:
    errorLevel: info
    access:
      enable: true
      format: >-
        json {
          "time": "$time_iso8601",
          "remote_addr": "$remote_addr",
          "method": "$request_method",
          "uri": "$request_uri",
          "status": "$status",
          "body_bytes_sent": "$body_bytes_sent",
          "request_time": "$request_time",
          "upstream_response_time": "$upstream_response_time",
          "http_user_agent": "$http_user_agent",
          "gateway_route": "$http_x_gateway_route"
        }
```

Laravel 侧可以在日志中注入 Gateway 传递的信息：

```php
// app/Http/Kernel.php — 添加中间件
protected $middleware = [
    // ...
    \App\Http\Middleware\LogGatewayInfo::class,
];

// app/Http/Middleware/LogGatewayInfo.php
class LogGatewayInfo
{
    public function handle(Request $request, Closure $next)
    {
        Log::withContext([
            'gateway_route' => $request->header('X-Gateway-Route', 'direct'),
            'client_ip' => $request->header('X-Real-IP', $request->ip()),
            'request_id' => $request->header('X-Request-ID', uniqid()),
        ]);

        return $next($request);
    }
}
```

---

## 十、与 Service Mesh（Istio）的集成与选型

### 10.1 Gateway API 与 Istio 的关系

Istio 从 1.18 版本开始正式支持 Gateway API 作为其入口流量管理的 API。这意味着你可以用 Gateway API 替换 Istio 的 `VirtualService` 和 `Gateway` CRD 来管理南北向流量，同时继续使用 Istio 的 `VirtualService` 管理东西向流量。

```yaml
# 使用 Gateway API 替代 Istio IngressGateway
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: istio-gateway
  namespace: istio-system
spec:
  gatewayClassName: istio
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: All
```

### 10.2 选型建议

| 场景 | 推荐方案 |
|------|---------|
| 简单的南北向流量管理 | Gateway API + Nginx Gateway Fabric |
| 需要 gRPC、高级流量治理 | Gateway API + Envoy Gateway |
| 已有 Istio 服务网格 | Istio + Gateway API（Istio 作为 GatewayClass） |
| 全面的服务网格 + 入口管理 | Istio Ambient Mesh + Gateway API |
| 不想引入 Sidecar 开销 | Cilium Service Mesh + Gateway API |

对于大多数 Laravel 微服务项目，**Gateway API + Envoy Gateway** 是性价比最高的方案——既有丰富的流量治理能力，又不需要引入完整服务网格的复杂性。

---

## 十一、生产最佳实践与踩坑总结

### 11.1 命名空间规划

```
infra/           # Gateway 资源，由运维团队管理
certs/           # TLS 证书，由 cert-manager 管理
laravel/         # Laravel 应用服务和 HTTPRoute
monitoring/      # Prometheus, Grafana
nginx-gateway/   # Gateway 控制器
```

### 11.2 踩坑总结

**坑 1：HTTPRoute 不生效**

最常见的原因是 `parentRefs` 的命名空间写错，或者 Gateway 的 `allowedRoutes.namespaces` 没有匹配到 HTTPRoute 所在的命名空间。排查命令：

```bash
kubectl get httproute -n laravel -o yaml  # 检查 status.parents
kubectl describe gateway laravel-gateway -n infra  # 检查 listener 状态
```

**坑 2：跨命名空间引用被拒绝**

从 Gateway 引用其他命名空间的 Secret 或 Service 时，需要创建 `ReferenceGrant`。这是安全特性，不是 bug。

**坑 3：权重分流不均匀**

Nginx Gateway Fabric 的权重实现基于 NGINX 的 upstream 轮询，在低流量场景下可能不够均匀。建议在灰度发布时使用较大的流量基数进行验证。

**坑 4：Controller 升级后 CRD 不兼容**

Gateway API 仍在快速演进中，CRD 版本之间可能存在 breaking change。建议在升级前先在 staging 环境验证，并锁定 Helm chart 版本。

**坑 5：Laravel 的 Trusted Proxies 配置**

当请求经过 Gateway 代理后，Laravel 需要正确配置 `TrustedProxies`，否则 `Request::ip()` 和 `Request::scheme` 会返回错误值：

```php
// app/Http/Middleware/TrustProxies.php
protected $proxies = [
    '10.0.0.0/8',     // Pod 网段
    '172.16.0.0/12',   // Docker kind 网段
    '192.168.0.0/16',  // 内部网段
];

protected $headers = Request::HEADER_X_FORWARDED_FOR |
    Request::HEADER_X_FORWARDED_HOST |
    Request::HEADER_X_FORWARDED_PORT |
    Request::HEADER_X_FORWARDED_PROTO |
    Request::HEADER_X_FORWARDED_AWS_ELB;
```

### 11.3 生产检查清单

- [ ] GatewayClass 参数已配置全局日志和监控
- [ ] TLS 证书通过 cert-manager 自动管理
- [ ] HTTPRoute 的 status 为 `Accepted`
- [ ] 限流策略已配置并测试
- [ ] 超时和重试策略已根据 Laravel 服务特性调整
- [ ] Prometheus 和 Grafana 监控就绪
- [ ] 访问日志收集到 ELK/Loki
- [ ] 灰度发布脚本经过 staging 验证
- [ ] `TrustedProxies` 已正确配置
- [ ] Gateway API CRD 版本已锁定

---

## 十二、总结

Gateway API 是 Kubernetes 流量管理的一次重大进化。对于正在构建 Laravel 微服务架构的团队来说，它带来了几个核心价值：

1. **标准化的高级路由能力**：Header 路由、权重分流、请求改写等能力不再依赖特定 Controller 的注解，配置一次即可在任何 Gateway API 实现间迁移。

2. **清晰的权限与职责边界**：运维团队管理 Gateway，开发团队管理 HTTPRoute，通过 Kubernetes RBAC 和 ReferenceGrant 实现最小权限原则。

3. **与 Laravel 生态的自然融合**：从 API 版本路由到 Sanctum/JWT 网关级认证，从 CORS 统一管理到请求链路追踪，Gateway API 能够与 Laravel 的中间件体系形成良好互补。

4. **面向未来的架构投资**：Gateway API 已是 Kubernetes 社区的标准方向，所有主流 Controller 都在跟进。今天基于 Gateway API 构建的流量管理方案，在未来升级到 Service Mesh 时可以无缝复用。

建议的迁移路径是：**先在 staging 环境用 Gateway API + Envoy Gateway 搭建新入口，与现有 Ingress 并行运行，逐步将路由切到新入口，最终完全替换 Ingress。** 整个过程可以利用 Gateway API 的权重分流能力实现零停机迁移。

参考资料：
- [Gateway API 官方文档](https://gateway-api.sigs.k8s.io/)
- [Nginx Gateway Fabric 文档](https://docs.nginx.com/nginx-gateway-fabric/)
- [Envoy Gateway 文档](https://gateway.envoyproxy.io/)
- [Laravel HTTP Client 文档](https://laravel.com/docs/http-client)
- [cert-manager 文档](https://cert-manager.io/docs/)

## 相关阅读

- [Cell-Based Architecture 实战：单元化架构在 Laravel 微服务中的落地——故障隔离、独立扩缩与跨单元路由](/categories/架构/Cell-Based-Architecture-实战-单元化架构在Laravel微服务中的落地-故障隔离独立扩缩与跨单元路由/)
- [Service Mesh Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦](/categories/架构/Service-Mesh-Sidecar-模式实战-Envoy-Proxy-Laravel-流量镜像熔断重试的基础设施下沉与应用层解耦/)
- [六边形架构实战：Laravel 端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
