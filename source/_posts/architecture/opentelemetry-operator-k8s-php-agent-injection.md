---
title: OpenTelemetry Operator for K8s 实战：自动注入 PHP Agent——Laravel 微服务的零代码变更可观测性
keywords: [OpenTelemetry Operator for K8s, PHP Agent, Laravel, 自动注入, 微服务的零代码变更可观测性, 架构]
date: 2026-06-09 16:48:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - OpenTelemetry
  - Kubernetes
  - Laravel
  - PHP
  - 可观测性
  - 微服务
  - 链路追踪
description: 在 Kubernetes 集群中使用 OpenTelemetry Operator 自动为 Laravel 微服务注入 PHP Agent，实现零代码变更的分布式链路追踪、指标采集和日志关联。本文从原理到实战，覆盖完整部署流程和踩坑记录。
---


## 概述

在微服务架构下，一个请求可能经过 API Gateway → Laravel A → Laravel B → Redis → MySQL 等多个服务。出了问题，靠肉眼翻日志找链路？效率太低。

分布式链路追踪（Distributed Tracing）是解决这个问题的标准方案。OpenTelemetry（OTel）作为 CNCF 的可观测性标准，提供了 Vendor 无关的 SDK。但传统接入方式需要每个服务改代码、装依赖、配初始化——对存量服务来说工作量巨大。

**OpenTelemetry Operator for Kubernetes** 解决了这个问题：它通过 Mutating Webhook，在 Pod 创建时自动注入 OTel Agent sidecar 或修改容器环境变量，实现零代码变更的可观测性接入。

本文以 Laravel 微服务集群为例，完整演示如何在 K8s 中部署 OpenTelemetry Operator，自动注入 PHP Agent，并将 Traces、Metrics、Logs 发送到 Jaeger + Prometheus + Loki 后端。

## 核心概念

### OpenTelemetry Operator 是什么

OpenTelemetry Operator 是一个 K8s Operator，它做了两件事：

1. **管理 OpenTelemetry Collector 实例**：通过 CRD（`OpenTelemetryCollector`）声明式部署 Collector
2. **自动注入 Instrumentation**：通过 Mutating Admission Webhook，根据 Annotation 自动为 Pod 注入对应语言的 Agent

对于 PHP，Operator 会注入一个 `opentelemetry-php-instrumentation` 的 init container，并设置相关环境变量。

### 架构图

```
┌─────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Laravel A  │  │  Laravel B  │  │  Laravel C  │ │
│  │  (PHP 8.4)  │  │  (PHP 8.4)  │  │  (PHP 8.4)  │ │
│  │  + OTel PHP │  │  + OTel PHP │  │  + OTel PHP │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │        │
│         └────────────────┼────────────────┘        │
│                          ▼                         │
│              ┌──────────────────────┐              │
│              │  OTel Collector      │              │
│              │  (DaemonSet/Gateway) │              │
│              └──────────┬───────────┘              │
└─────────────────────────┼───────────────────────────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
      ┌─────────┐   ┌──────────┐   ┌─────────┐
      │ Jaeger   │   │Prometheus│   │  Loki   │
      │ (Traces) │   │(Metrics) │   │ (Logs)  │
      └─────────┘   └──────────┘   └─────────┘
```

### PHP 的特殊性

与其他语言不同，PHP 是请求级生命周期，没有常驻进程。传统的 Java/Python Agent 可以作为 sidecar 持续运行，但 PHP 需要：

- **PHP 扩展方式**：通过 `opentelemetry` PECL 扩展 + `opentelemetry-php-instrumentation` 扩展在进程级别注入
- **预加载或 FPM 配置**：在 PHP-FPM 启动时加载扩展
- **自动注入**：Operator 负责将扩展文件挂载到容器中，并设置 `php.ini` 配置

## 实战部署

### 前置条件

- Kubernetes 集群（1.24+）
- Helm 3.x
- PHP 8.1+ 的 Laravel 应用镜像
- 已部署的可观测性后端（Jaeger / Prometheus / Loki，或使用 Grafana Cloud 等 SaaS）

### Step 1：安装 cert-manager

OpenTelemetry Operator 依赖 cert-manager 管理 Webhook 证书：

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true
```

验证：

```bash
kubectl get pods -n cert-manager
# 应该看到 3 个 pod 都 Running
```

### Step 2：安装 OpenTelemetry Operator

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

helm install opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry-operator-system \
  --create-namespace
```

验证 Operator 状态：

```bash
kubectl get pods -n opentelemetry-operator-system
# NAME                                      READY   STATUS    RESTARTS   AGE
# opentelemetry-operator-xxx                2/2     Running   0          30s
```

### Step 3：部署 OpenTelemetry Collector

创建 Collector 配置：

```yaml
# otel-collector.yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: otel-collector
  namespace: observability
spec:
  mode: deployment
  image: otel/opentelemetry-collector-contrib:0.102.0
  config: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      batch:
        timeout: 5s
        send_batch_size: 1024
      memory_limiter:
        check_interval: 5s
        limit_mib: 512
        spike_limit_mib: 128

    exporters:
      # Traces → Jaeger
      otlp/jaeger:
        endpoint: jaeger-collector.observability.svc.cluster.local:4317
        tls:
          insecure: true

      # Metrics → Prometheus
      prometheus:
        endpoint: "0.0.0.0:8889"

      # Logs → Loki
      loki:
        endpoint: "http://loki-gateway.observability.svc.cluster.local/loki/api/v1/push"

    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [otlp/jaeger]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [prometheus]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [loki]
```

```bash
kubectl create namespace observability
kubectl apply -f otel-collector.yaml
```

### Step 4：创建 Instrumentation CRD

这是关键步骤——声明 PHP 的自动注入配置：

```yaml
# instrumentation.yaml
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: php-instrumentation
  namespace: production  # 你的 Laravel 应用所在的 namespace
spec:
  exporter:
    endpoint: http://otel-collector-collector.observability.svc.cluster.local:4317

  propagators:
    - tracecontext
    - baggage

  sampler:
    type: parentbased_traceidratio
    argument: "0.1"  # 生产环境采样 10%，调试时改 1.0

  php:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-php:0.0.17
    # 指定 PHP 扩展安装路径
    env:
      - name: OTEL_PHP_AUTOLOAD_ENABLED
        value: "true"
      - name: OTEL_TRACES_EXPORTER
        value: "otlp"
      - name: OTEL_METRICS_EXPORTER
        value: "otlp"
      - name: OTEL_LOGS_EXPORTER
        value: "otlp"
      - name: OTEL_EXPORTER_OTLP_PROTOCOL
        value: "grpc"
      - name: OTEL_PHP_MEMORY_LIMIT_MIB
        value: "128"
      - name: OTEL_SERVICE_NAME
        value: ""  # 留空，从 K8s 标签或环境变量获取
```

```bash
kubectl apply -f instrumentation.yaml
```

### Step 5：部署 Laravel 应用并启用自动注入

在你的 Laravel Deployment 中添加 Annotation 即可：

```yaml
# laravel-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: laravel-api
  template:
    metadata:
      labels:
        app: laravel-api
        app.kubernetes.io/name: laravel-api
      annotations:
        # 这一行是关键！告诉 Operator 自动注入 PHP Agent
        instrumentation.opentelemetry.io/inject-php: "true"
        # 可选：指定使用哪个 Instrumentation CRD
        # instrumentation.opentelemetry.io/inject-php: "php-instrumentation"
    spec:
      containers:
        - name: php-fpm
          image: your-registry/laravel-api:v1.2.3
          ports:
            - containerPort: 9000
          env:
            - name: APP_NAME
              value: "laravel-api"
            - name: APP_ENV
              value: "production"
            - name: OTEL_SERVICE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['app.kubernetes.io/name']
            # Laravel 特定的 OTel 配置
            - name: OTEL_PHP_AUTOLOAD_ENABLED
              value: "true"
            - name: OTEL_TRACES_EXPORTER
              value: "otlp"
            - name: OTEL_EXPORTER_OTLP_PROTOCOL
              value: "grpc"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector-collector.observability.svc.cluster.local:4317"
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
```

**关键点**：只需在 `annotations` 中加上 `instrumentation.opentelemetry.io/inject-php: "true"`，Operator 会自动处理剩下的事情。

```bash
kubectl apply -f laravel-deployment.yaml
```

### Step 6：验证注入是否成功

检查 Pod 中是否多了 init container：

```bash
kubectl get pod -n production -l app=laravel-api -o jsonpath='{.items[0].spec.initContainers[*].name}'
# 应该输出：opentelemetry-auto-instrumentation-php
```

检查环境变量：

```bash
kubectl exec -it -n production deploy/laravel-api -- env | grep OTEL
# OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector-collector.observability.svc.cluster.local:4317
# OTEL_PHP_AUTOLOAD_ENABLED=true
# OTEL_SERVICE_NAME=laravel-api
# OTEL_TRACES_EXPORTER=otlp
# ...
```

## Laravel 应用侧的配置（可选增强）

虽然 Operator 注入了基础 Agent，但如果你想在 Laravel 代码层面做更精细的控制（比如自定义 Span、添加业务属性），可以安装官方 PHP SDK：

```bash
composer require open-telemetry/sdk open-telemetry/opentelemetry-auto-laravel
```

### 自定义 Span 示例

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;

class ObservabilityServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 无需手动初始化，Operator 注入的扩展已处理
    }

    public function boot(): void
    {
        // 添加全局 Span 属性
        $tracer = Globals::tracerProvider()->getTracer('laravel-api');
        $rootSpan = Globals::tracerProvider()->getTracer('laravel-api')
            ->spanBuilder('app.request')
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->startSpan();

        // 在请求结束时关闭 Span
        register_shutdown_function(function () use ($rootSpan) {
            $rootSpan->end();
        });
    }
}
```

### 业务埋点示例

```php
<?php

namespace App\Services;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;

class OrderService
{
    public function createOrder(array $data): Order
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');
        $span = $tracer->spanBuilder('order.create')
            ->setSpanKind(SpanKind::KIND_INTERNAL)
            ->startSpan();

        $scope = $span->activate();

        try {
            // 添加业务属性
            $span->setAttribute('order.user_id', $data['user_id']);
            $span->setAttribute('order.total_amount', $data['total_amount']);
            $span->setAttribute('order.items_count', count($data['items']));

            // 执行业务逻辑
            $order = $this->processOrder($data);

            $span->setAttribute('order.id', $order->id);
            $span->setStatus(\OpenTelemetry\API\Trace\StatusCode::STATUS_OK);

            return $order;
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(\OpenTelemetry\API\Trace\StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

## 踩坑记录

### 踩坑 1：PHP 扩展版本不匹配

**现象**：Pod 启动后，`php -m` 看不到 `opentelemetry` 扩展，日志报 `undefined symbol`。

**原因**：Operator 注入的 PHP 扩展是基于特定 PHP 版本编译的。如果你的应用镜像 PHP 版本与 autoinstrumentation 镜像不匹配，扩展无法加载。

**解决**：

1. 确认你的 PHP 版本：`php -v`
2. 检查 autoinstrumentation 镜像支持的版本：查看 `ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-php` 的 tag
3. 如果版本不匹配，需要自建 autoinstrumentation 镜像：

```dockerfile
# 自定义 PHP OTel 镜像
FROM php:8.4-fpm-alpine

# 安装 opentelemetry 扩展
RUN apk add --no-cache $PHPIZE_DEPS linux-headers \
    && pecl install opentelemetry \
    && docker-php-ext-enable opentelemetry

# 复制自动注入脚本
COPY --from=ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-php:0.0.17 \
    /otel-php-auto-instrumentation /otel-php-auto-instrumentation
```

### 踩坑 2：GRPC 扩展缺失

**现象**：Agent 初始化报 `gRPC extension not found`。

**原因**：PHP 的 OTLP gRPC exporter 需要 `grpc` 扩展。

**解决**：在应用镜像中安装 grpc 扩展：

```dockerfile
RUN pecl install grpc && docker-php-ext-enable grpc
```

或者切换到 HTTP 协议（性能稍差但无需 grpc 扩展）：

```yaml
# instrumentation.yaml 中修改
env:
  - name: OTEL_EXPORTER_OTLP_PROTOCOL
    value: "http/protobuf"
```

### 踩坑 3：内存溢出（OOMKilled）

**现象**：注入 Agent 后，PHP-FPM 容器频繁 OOMKilled。

**原因**：OTel PHP 扩展在高并发下内存消耗较大，特别是 Span 缓冲区。

**解决**：

```yaml
# 在 Instrumentation 或 Deployment 环境变量中限制
env:
  - name: OTEL_PHP_MEMORY_LIMIT_MIB
    value: "64"  # 降低默认值
  - name: OTEL_TRACES_SAMPLER
    value: "parentbased_traceidratio"
  - name: OTEL_TRACES_SAMPLER_ARG
    value: "0.01"  # 生产环境 1% 采样
```

同时在 Deployment 中增加容器内存限制：

```yaml
resources:
  requests:
    memory: "512Mi"
  limits:
    memory: "1Gi"
```

### 踩坑 4：采样率导致数据丢失

**现象**：调试时发现某些请求的 Trace 不完整，中间某些服务的 Span 丢失。

**原因**：不同服务的采样率不一致。服务 A 采样 100%，但服务 B 采样 10%，导致从 A 到 B 的链路断裂。

**解决**：使用 `parentbased_traceidratio` 采样器——它会遵循上游服务的采样决策：

```yaml
sampler:
  type: parentbased_traceidratio
  argument: "0.1"
```

这意味着：如果上游已经决定采样，当前服务一定会记录；只有当前服务是入口时，才按 10% 概率采样。

### 踩坑 5：Annotation 不生效

**现象**：Pod 启动了，但没有注入 Agent。

**排查步骤**：

```bash
# 1. 检查 Webhook 是否注册
kubectl get mutatingwebhookconfigurations | grep opentelemetry

# 2. 检查 Operator 日志
kubectl logs -n opentelemetry-operator-system deploy/opentelemetry-operator -c manager

# 3. 检查 namespace 是否有 instrumentation 标签
kubectl get namespace production --show-labels

# 4. 确认 Annotation 拼写
# 常见错误：instrumentation.opentelemetry.io/inject-php 写成 instrumentation.opentelemetry.io/inject-php: true（多了空格）
```

## 生产环境优化建议

### 1. 使用 DaemonSet 模式部署 Collector

高流量场景下，每个节点部署一个 Collector（DaemonSet）比集中式 Deployment 性能更好：

```yaml
spec:
  mode: daemonset
```

### 2. 配置 Collector 的队列和重试

```yaml
processors:
  queued_retry:
    num_workers: 10
    queue_size: 5000
    retry_on_failure: true
```

### 3. 多语言混合部署

如果你的集群同时有 PHP、Go、Java 服务，可以创建多个 Instrumentation CRD：

```yaml
# PHP 专用
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: php-instrumentation
spec:
  php:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-php:0.0.17

---
# Go 专用
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: go-instrumentation
spec:
  go:
    image: ghcr.io/open-telemetry/opentelemetry-go-instrumentation/autoinstrumentation-go:v0.12.0
```

然后在不同服务的 Deployment 中指定对应的 Annotation：

```yaml
# PHP 服务
annotations:
  instrumentation.opentelemetry.io/inject-php: "php-instrumentation"

# Go 服务
annotations:
  instrumentation.opentelemetry.io/inject-go: "go-instrumentation"
```

### 4. 安全考虑

- Collector 使用 `memory_limiter` 防止 OOM
- 生产环境务必配置 TLS（去掉 `tls.insecure: true`）
- 使用 NetworkPolicy 限制只有应用 namespace 能访问 Collector

## 总结

| 特性 | 传统接入方式 | Operator 自动注入 |
|------|-------------|-------------------|
| 代码变更 | 需要修改 composer.json + 初始化代码 | 零代码变更 |
| 部署复杂度 | 每个服务单独配置 | 统一 CRD 管理 |
| 版本管理 | 各服务独立升级 | Operator 统一升级 |
| 环境一致性 | 可能配置不一致 | 统一配置下发 |
| 回滚速度 | 需要重新部署镜像 | 删除 Annotation 即可 |

OpenTelemetry Operator 让 PHP 微服务的可观测性接入从「每个服务改一遍代码」变成了「加一行 Annotation」。对于存量 Laravel 服务较多的团队，这是最高效的接入方案。

**下一步**：

- 接入 Metrics（PHP-FPM 进程数、请求耗时 P99）
- 接入 Logs（Laravel 日志与 Trace ID 关联）
- 搭建 Grafana Dashboard
- 配置基于 Trace 的告警规则（如 P99 > 500ms 触发告警）

---

> 参考文档：
> - [OpenTelemetry Operator 官方文档](https://opentelemetry.io/docs/kubernetes/operator/)
> - [OpenTelemetry PHP 自动注入](https://opentelemetry.io/docs/languages/php/)
> - [OpenTelemetry Collector 配置](https://opentelemetry.io/docs/collector/configuration/)
