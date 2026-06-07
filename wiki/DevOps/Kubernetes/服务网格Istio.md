# 服务网格：Istio

## 定义

**Istio** 是 Kubernetes 的服务网格（Service Mesh），通过在每个 Pod 中注入 sidecar 代理（Envoy），实现服务间的流量管理、安全加密（mTLS）、可观测性和故障恢复，无需修改应用代码。

## 核心原理

### 架构

```text
Client / App
     |
Ingress / Gateway
     |
     v
+------------------------------+
| Laravel API Pod              |
| app container + istio-proxy  |
+---------------+--------------+
                |
      +---------+----------+
      |                    |
      v                    v
Inventory gRPC         Pricing HTTP
Pod + istio-proxy      Pod + istio-proxy
      |                    |
      +---------+----------+
                v
           MySQL / Redis

Telemetry: istio-proxy -> Prometheus -> Grafana
Security : PeerAuthentication STRICT + AuthorizationPolicy
Release  : VirtualService header/canary routing
```

### 核心组件

| 组件 | 作用 |
|---|---|
| Envoy Proxy | Sidecar 代理，拦截所有进出流量 |
| Istiod | 控制平面（Pilot + Citadel + Galley） |
| Gateway | 网络入口（替代 Ingress） |
| VirtualService | 流量路由规则（超时、重试、灰度） |
| DestinationRule | 负载均衡、连接池、熔断配置 |
| PeerAuthentication | mTLS 策略 |
| AuthorizationPolicy | 服务间访问控制 |

### VirtualService 流量管理

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: laravel-api
spec:
  hosts:
  - laravel-api-svc
  http:
  # 灰度发布：按 Header 路由
  - match:
    - headers:
        x-canary:
          exact: "true"
    route:
    - destination:
        host: laravel-api-svc
        subset: canary
      weight: 100
  # 默认路由
  - route:
    - destination:
        host: laravel-api-svc
        subset: stable
      weight: 90
    - destination:
        host: laravel-api-svc
        subset: canary
      weight: 10
    timeout: 10s
    retries:
      attempts: 3
      perTryTimeout: 3s
      retryOn: 5xx,reset,connect-failure
```

### mTLS 自动加密

```yaml
# 强制所有服务间通信使用 mTLS
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT
```

### 超时与重试策略

**关键踩坑：**
- POST 请求不应该自动重试（幂等性问题）
- 超时应该统一在 Istio 层配置，避免应用层和网关层超时不一致
- 连接池大小需要根据 PHP-FPM 并发数调整

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: laravel-api
spec:
  host: laravel-api-svc
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
```

## 实战案例

来自博客文章：
- [Istio 服务网格实战：超时、重试、灰度发布与 mTLS](/categories/DevOps/istio-guide-laravel-k8s-canary-mtls/) - Laravel 在 K8s 上的服务网格落地
- [Istio 服务网格实战（进阶）：mTLS 自动加密、灰度发布与连接池优化](/categories/PHP/istio-guide-laravel-k8s-mtls-canaryoptimization/) - 连接池调优

## 相关概念

- [Ingress 与网络](Ingress与网络.md) - Istio Gateway 替代 Ingress
- [渐进式发布](渐进式发布.md) - Argo Rollouts + Istio 流量切分
- [自动扩缩容](自动扩缩容.md) - 连接池与 HPA 的协同
- [分布式追踪与 Baggage](../分布式追踪与Baggage.md) - Istio 自动注入追踪头

## 常见问题

### Sidecar 注入不生效
- 检查 namespace 是否有 `istio-injection: enabled` 标签
- 检查 Pod 是否有 `sidecar.istio.io/inject: "false"` 注解
- 确认 Istio webhook 是否正常

### 应用启动失败（sidecar 启动顺序）
- 使用 `holdApplicationUntilProxyStarts: true` 确保 proxy 先启动
- 或设置 `proxy.istio.io/config: '{"holdApplicationUntilProxyStarts": true}'`

### 性能开销
- Sidecar 代理增加约 1-3ms 延迟
- 每个 Pod 额外消耗约 50-100MB 内存
- 小规模服务（<5 个）不建议使用，Ingress + Service 足够
