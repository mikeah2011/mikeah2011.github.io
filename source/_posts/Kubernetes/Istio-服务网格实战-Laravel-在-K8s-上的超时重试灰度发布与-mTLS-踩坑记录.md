---
title: Istio 服务网格实战：Laravel 在 K8s 上的超时、重试、灰度发布与 mTLS 踩坑记录
date: 2026-05-03 09:01:02
categories:
  - Kubernetes
  - Laravel
  - 架构
tags:
  - Istio
  - Service Mesh
  - Laravel
  - Kubernetes
  - mTLS
  - Canary
  - gRPC
  - Observability
description: 基于 Laravel B2C API 在 Kubernetes 上的真实改造经验，记录一次从 Ingress 直连到 Istio 服务网格的落地过程，重点解决超时不一致、POST 被错误重试、灰度放量与 mTLS 接入中的生产踩坑。
---

我们把 Laravel B2C API 拆到 Kubernetes 之后，最开始只有 Ingress + Service：能跑，但高峰期一旦库存服务抖动，API 侧就会出现很难解释的问题：有的请求 504、有的请求 499、有的明明 Laravel 已经报超时，网关还在继续等；更麻烦的是，灰度发布只能切整批 Pod，风险很难控。

后来我把 API、库存、价格三个服务接到 **Istio**，目标不是“为了上 Service Mesh”，而是解决三个很具体的问题：**调用超时统一、灰度可控、服务间访问默认加密**。如果团队只需要最轻量的透明代理，Linkerd 会更省心；但我们这里既有 HTTP 又有 gRPC，还要做按 Header 灰度和权限策略，最后选择了 Istio。

## 一、最终架构

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

我实际落地时，先做的是 **sidecar 注入和启动顺序**，否则第一波流量就可能打在还没就绪的代理上。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-api
spec:
  template:
    metadata:
      labels:
        app: laravel-api
      annotations:
        sidecar.istio.io/inject: "true"
        proxy.istio.io/config: '{"holdApplicationUntilProxyStarts": true}'
        sidecar.istio.io/proxyCPU: "200m"
        sidecar.istio.io/proxyMemory: "256Mi"
    spec:
      containers:
        - name: app
          image: ghcr.io/mikeah2011/laravel-api:20260503
          ports:
            - containerPort: 9000
```

这段配置不是装饰。我们第一次上线没开 `holdApplicationUntilProxyStarts`，应用容器先 ready，结果滚动发布那几分钟内大量出现出站 503，Laravel 日志看起来像是下游挂了，实际上是 sidecar 还没完全接管流量。

## 二、把超时和重试收口，不让网格“帮倒忙”

Istio 默认很好用，但**默认重试不一定适合 Laravel 的写请求**。库存锁定、创建订单、支付确认这类 POST，如果被代理层自动重试，业务上就可能放大成重复扣减。所以我会把读写请求拆开治理：GET 允许轻量重试，POST 明确禁用。

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: inventory-service
spec:
  hosts:
    - inventory-service
  http:
    - match:
        - method:
            exact: GET
      route:
        - destination:
            host: inventory-service
      timeout: 800ms
      retries:
        attempts: 2
        perTryTimeout: 250ms
        retryOn: connect-failure,refused-stream,unavailable,cancelled
    - match:
        - method:
            exact: POST
      route:
        - destination:
            host: inventory-service
      timeout: 800ms
      retries:
        attempts: 0
```

配套的连接池和异常实例摘除我会放在 `DestinationRule`：

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: inventory-service
spec:
  host: inventory-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 200
      http:
        http1MaxPendingRequests: 100
        maxRequestsPerConnection: 50
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
```

这里有个非常真实的坑：我一开始把 Laravel HTTP Client 设成 `timeout(1.0)`，Istio 路由超时却配成了 `3s`。结果应用已经抛异常返回了，sidecar 还在尝试上游，Prometheus 上看到的失败时间和应用日志完全对不上。后来原则很简单：**应用超时 < Mesh 超时 < Ingress 超时**，排查成本马上降下来。

## 三、灰度发布不是切 Pod，而是切流量

Istio 真正让我愿意长期保留的，是灰度发布能力。我们会先给新版本单独打 `version: canary`，只放给内部 Header 或少量比例流量：

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: laravel-api
spec:
  hosts:
    - api.mikeah.dev
  gateways:
    - api-gateway
  http:
    - match:
        - headers:
            x-canary:
              exact: "1"
      route:
        - destination:
            host: laravel-api
            subset: canary
    - route:
        - destination:
            host: laravel-api
            subset: stable
          weight: 90
        - destination:
            host: laravel-api
            subset: canary
          weight: 10
```

这样做的价值不是“高级”，而是出了问题能快速缩回 0%，而不是重新回滚整个 Deployment。

## 四、mTLS 与链路透传

服务网格接进来后，我建议直接把命名空间切到 STRICT mTLS，不要停在 PERMISSIVE 太久，否则问题会一直拖。

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
spec:
  mtls:
    mode: STRICT
```

同时我会在 Laravel 里强制透传请求 ID，保证应用日志能和 mesh 指标对齐：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class PropagateRequestId
{
    public function handle(Request $request, Closure $next)
    {
        $requestId = $request->headers->get('x-request-id', (string) Str::uuid());
        app()->instance('request-id', $requestId);

        $response = $next($request);
        $response->headers->set('x-request-id', $requestId);

        return $response;
    }
}
```

下游调用时继续带过去：

```php
use Illuminate\Support\Facades\Http;

$response = Http::withHeaders([
    'x-request-id' => app('request-id'),
])->timeout(0.6)
  ->post(config('services.inventory.url').'/api/locks', [
      'sku' => $sku,
      'quantity' => $qty,
      'order_no' => $orderNo,
  ]);
```

## 五、三次最值钱的踩坑

### 1. POST 被代理层重试，库存重复锁定
问题不是 Laravel 代码写错，而是 mesh 帮你“做好事”。结论：**写请求禁重试，业务层仍然保留幂等键**。

### 2. sidecar 资源预估过低
我们最早给 proxy 只留了 `50m/64Mi`，高峰时 Envoy 自己先抖，应用容器反而看着正常。Service Mesh 不是免费午餐，**sidecar 资源要单独算账**。

### 3. mTLS 一开全绿变全红
原因通常不是 Istio 有问题，而是还有旧 Job、CronJob 或 debug Pod 没注入 sidecar。切 STRICT 前，先把命名空间里的调用主体盘一遍。

## 六、我的落地建议

如果你的 Laravel 服务还在单体 K8s 初期，只想先解决扩缩容和监控，别急着上 Mesh；但如果已经出现 **跨服务超时不一致、灰度发布粗糙、内部流量权限不可见** 这些问题，Istio 是值得上的。我的经验是：**先上观测，再上流量治理，最后再开 mTLS 与授权策略**，顺序反了，故障会非常难查。

这次改造之后，订单链路里最明显的变化不是 QPS 变大，而是问题终于能被解释：超时是谁切的、重试是谁做的、流量去了哪个版本、请求是否走了加密链路，面板和日志都能对上。对生产系统来说，这比“理论上更先进”重要得多。
