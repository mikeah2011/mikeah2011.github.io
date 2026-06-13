---
title: 金丝雀发布实战：渐进式流量放量——Nginx/Envoy 权重路由与 Laravel 版本共存
date: 2026-06-02 00:00:00
tags: [金丝雀发布, Nginx, Envoy, Laravel, CI/CD, 渐进式发布]
keywords: [Nginx, Envoy, Laravel, 金丝雀发布实战, 渐进式流量放量, 权重路由与, 版本共存, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 金丝雀发布（Canary Deployment）是降低发布风险的核心手段。本文从零搭建完整的渐进式流量放量体系：Nginx 原生权重路由与 Header/Cookie 定向测试，Envoy xDS 动态权重调整与流量镜像，Laravel 数据库三阶段迁移法、缓存版本化、队列兼容序列化，含自动化放量脚本、Prometheus 监控与秒级回滚实战。
---


# 金丝雀发布实战：渐进式流量放量——Nginx/Envoy 权重路由与 Laravel 版本共存

## 前言

在 B2C 电商场景中，一次全量发布可能影响数百万用户的购物体验。金丝雀发布（Canary Deployment）通过将新版本先暴露给一小部分真实流量进行验证，再逐步放量至全量，是降低发布风险的核心手段。

本文将从零搭建一套完整的金丝雀发布体系：从 Nginx 原生权重路由，到 Envoy 进阶流量治理，再到 Laravel 应用层的版本共存策略，覆盖回滚、监控、数据库兼容等实战难点。

---

## 一、金丝雀发布核心概念

### 1.1 什么是金丝雀发布

金丝雀发布得名于矿井中的金丝雀——矿工用金丝雀探测有毒气体。在软件发布中，新版本（金丝雀）先接收少量流量，若健康指标正常则逐步放量，异常则快速回滚。

### 1.2 发布策略全面对比：金丝雀 vs 蓝绿 vs 滚动 vs 渐进式发布

| 维度 | **金丝雀发布** | **蓝绿部署** | **滚动更新** | **渐进式发布（Progressive Delivery）** |
|------|--------------|------------|------------|--------------------------------------|
| **流量切换方式** | 渐进式权重分配（1% → 5% → 20% → 100%） | 一次性全量切换（旧环境 → 新环境） | 逐 Pod 替换，Kubernetes 原生滚动 | 基于 Argo Rollouts / Flagger 的自动化渐进策略，结合 Feature Flag |
| **回滚速度** | 秒级（权重归零） | 秒级（DNS/LB 切回旧环境） | 分钟级（需重新滚动替换 Pod） | 秒级（自动检测指标异常并回滚） |
| **资源开销** | 低（仅多出金丝雀实例） | 高（需维护完整的双套环境） | 低（Kubernetes 原生调度） | 中等（需额外的 Rollout Controller 和指标采集） |
| **数据库兼容** | 必须支持新旧版本共存（三阶段迁移） | 通常要求无数据库变更 | 取决于策略，通常需向后兼容 | 必须支持新旧版本共存，配合 Feature Flag 控制数据写入路径 |
| **流量精细度** | 高（按百分比、Header、地域等维度路由） | 低（全量切换，无中间态） | 低（不可控，取决于 Pod 调度顺序） | 高（支持按分析指标自动调整流量比例） |
| **自动化程度** | 中（需自建放量脚本） | 低（手动切换或简单脚本） | 高（Kubernetes 原生支持） | 高（内置自动分析、自动推进、自动回滚） |
| **适用场景** | 面向用户的高风险变更、B2C 电商大促 | 数据库无变更的快速回滚需求、灾难恢复 | 无状态微服务的常规版本更新 | 需要自动化质量门禁的持续交付流水线 |
| **代表工具** | Nginx weight / Envoy xDS / 自建脚本 | AWS Elastic Beanstalk / 传统 LB | Kubernetes Deployment | Argo Rollouts / Flagger / Spinnaker |

### 1.3 流量分配策略

金丝雀发布中流量分配有三种常见方式：

- **百分比权重分配**：Nginx upstream weight 或 Envoy weighted_clusters
- **Header/Cookie 路由**：特定用户（内测用户、VIP）强制路由到金丝雀
- **IP/CIDR 路由**：按地域或网络段路由

---

## 二、Nginx 权重路由实现金丝雀

### 2.1 基础 upstream 权重配置

最简单的金丝雀方案：Nginx upstream 的 `weight` 指令。

```nginx
upstream laravel_backend {
    # 稳定版 - 90% 流量
    server 10.0.1.10:9000 weight=9;
    server 10.0.1.11:9000 weight=9;

    # 金丝雀版 - 10% 流量
    server 10.0.2.10:9000 weight=1;
    server 10.0.2.11:9000 weight=1;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://laravel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 透传请求 ID 用于链路追踪
        proxy_set_header X-Request-ID $request_id;
    }
}
```

**权重计算**：金丝雀权重占比 = 1 / (9 + 1) = 10%。每 10 个请求约 1 个流向金丝雀。

### 2.2 Header 路由实现定向测试

在百分比分配基础上，支持 Header 路由让特定用户（测试团队、内测用户）强制访问金丝雀：

```nginx
upstream laravel_stable {
    server 10.0.1.10:9000;
    server 10.0.1.11:9000;
}

upstream laravel_canary {
    server 10.0.2.10:9000;
    server 10.0.2.11:9000;
}

map $http_x_canary $backend {
    "true"  laravel_canary;
    default laravel_backend;  # 走权重路由
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://$backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

前端或移动端在特定条件下（如登录用户属于 beta 测试组）添加 `X-Canary: true` 请求头。

### 2.3 基于 Cookie 的持久化路由

为避免同一用户在金丝雀和稳定版之间跳转导致会话不一致，使用 Cookie 实现会话粘滞：

```nginx
map $http_x_canary $backend {
    "true"  laravel_canary;
    default "";
}

map $cookie_canary_group $cookie_backend {
    "canary" laravel_canary;
    default  "";
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        set $final_backend $backend;

        if ($final_backend = "") {
            set $final_backend $cookie_backend;
        }

        if ($final_backend = "") {
            set $final_backend laravel_backend;
        }

        # 设置金丝雀 Cookie（仅首次匹配时）
        add_header Set-Cookie "canary_group=stable; Path=/; Max-Age=3600";

        proxy_pass http://$final_backend;
    }
}
```

### 2.4 Nginx 动态权重调整（无 reload）

生产环境频繁 reload 有连接中断风险。使用 Nginx Plus 的 `upstream_conf` API 或开源方案 `nginx-upsync-module` 实现动态调整：

```nginx
# 使用 upsync 模块从 Consul 动态拉取上游配置
upstream laravel_backend {
    # 从 Consul KV 拉取服务列表
    upsync 127.0.0.1:8500/v1/kv/upstreams/laravel_backend upsync_timeout=60s upsync_interval=5s upsync_type=consul;
    upsync_dump_path /etc/nginx/servers/laravel_backend.conf;

    include /etc/nginx/servers/laravel_backend.conf;
}
```

通过 Consul KV 调整权重，无需 reload：

```bash
# 将金丝雀权重从 10% 调整到 30%
curl -X PUT http://consul:8500/v1/kv/upstreams/laravel_backend/10.0.2.10:9000 -d '{"weight": 3}'
curl -X PUT http://consul:8500/v1/kv/upstreams/laravel_backend/10.0.2.11:9000 -d '{"weight": 3}'
```

---

## 三、Envoy 进阶流量治理

### 3.1 Envoy 架构概述

Envoy 是 CNCF 毕业项目，相比 Nginx 提供了更精细的流量管理能力：

- 原生 gRPC/HTTP2 支持
- xDS 动态配置 API
- 丰富的流量镜像、故障注入能力
- 内置可观测性（stats、tracing、logging）

### 3.2 Weighted Clusters 配置

```yaml
static_resources:
  listeners:
    - name: listener_0
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
                    - name: laravel_service
                      domains: ["api.example.com"]
                      routes:
                        # Header 路由：内测用户走金丝雀
                        - match:
                            prefix: "/"
                            headers:
                              - name: "x-canary"
                                exact_match: "true"
                          route:
                            cluster: laravel_canary

                        # 默认路由：按权重分配
                        - match:
                            prefix: "/"
                          route:
                            weighted_clusters:
                              clusters:
                                - name: laravel_stable
                                  weight: 90
                                - name: laravel_canary
                                  weight: 10
                            # 基于 Cookie 的粘滞会话
                            hash_policy:
                              - cookie:
                                  name: "canary_session"
                                  ttl: 3600s

                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    - name: laravel_stable
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: laravel_stable
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: 10.0.1.10
                      port_value: 9000
              - endpoint:
                  address:
                    socket_address:
                      address: 10.0.1.11
                      port_value: 9000

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
                      address: 10.0.2.10
                      port_value: 9000
              - endpoint:
                  address:
                    socket_address:
                      address: 10.0.2.11
                      port_value: 9000
```

### 3.3 Envoy 动态权重调整（xDS）

通过 RDS（Route Discovery Service）动态更新路由权重，无需重启：

```python
# Python xDS 服务端示例（简化）
from envoy.config.route.v3 import route_pb2
from envoy.config.route.v3 import route_components_pb2

def build_weighted_route(stable_weight=90, canary_weight=10):
    route_config = route_pb2.RouteConfiguration(
        name="local_route",
        virtual_hosts=[
            route_components_pb2.VirtualHost(
                name="laravel_service",
                domains=["api.example.com"],
                routes=[
                    route_components_pb2.Route(
                        match=route_components_pb2.RouteMatch(prefix="/"),
                        route=route_components_pb2.RouteAction(
                            weighted_clusters=route_components_pb2.WeightedCluster(
                                clusters=[
                                    route_components_pb2.WeightedCluster.ClusterWeight(
                                        name="laravel_stable",
                                        weight=stable_weight
                                    ),
                                    route_components_pb2.WeightedCluster.ClusterWeight(
                                        name="laravel_canary",
                                        weight=canary_weight
                                    ),
                                ]
                            )
                        )
                    )
                ]
            )
        ]
    )
    return route_config
```

### 3.4 Envoy 流量镜像（Shadowing）

在金丝雀阶段，可以将生产流量镜像到金丝雀，但不使用其响应——用于验证新版本的兼容性：

```yaml
routes:
  - match:
      prefix: "/"
    route:
      cluster: laravel_stable
      request_mirror_policies:
        - cluster: laravel_canary
          runtime_fraction:
            default_value:
              numerator: 5  # 5% 流量被镜像
              denominator: HUNDRED
```

### 3.5 Envoy 故障注入测试

在金丝雀发布前，用故障注入验证客户端的错误处理能力：

```yaml
http_filters:
  - name: envoy.filters.http.fault
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.fault.v3.HTTPFault
      delay:
        percentage:
          numerator: 10
          denominator: HUNDRED
        fixed_delay: 3s
      abort:
        percentage:
          numerator: 5
          denominator: HUNDRED
        http_status: 503
  - name: envoy.filters.http.router
```

---

## 四、Laravel 应用层版本共存策略

### 4.1 数据库迁移兼容性

金丝雀发布最大的挑战是数据库 schema 变更。必须保证新旧版本能同时运行在同一数据库上。

**原则：三阶段迁移法**

```php
// 第一阶段：只添加（Additive Only）
// 新增列、新增表，不删除、不重命名
Schema::table('orders', function (Blueprint $table) {
    $table->string('new_status', 50)->nullable()->after('status');
});

// 第二阶段：双写（代码层面同时写入新旧字段）
class Order extends Model
{
    public function setStatusAttribute($value)
    {
        $this->attributes['status'] = $value;
        $this->attributes['new_status'] = $this->mapToNewStatus($value);
    }

    public function getEffectiveStatusAttribute()
    {
        return $this->new_status ?? $this->status;
    }

    protected function mapToNewStatus(string $old): string
    {
        return match ($old) {
            'pending' => 'created',
            'paid' => 'confirmed',
            'shipped' => 'in_transit',
            default => $old,
        };
    }
}

// 第三阶段：清理（全量发布后，移除旧字段）
// 在确认所有实例都已更新后执行
Schema::table('orders', function (Blueprint $table) {
    $table->dropColumn('status');
    $table->renameColumn('new_status', 'status');
});
```

### 4.2 API 版本共存

当金丝雀版本引入 API 破坏性变更时，需要支持多版本 API：

```php
// routes/api.php
Route::prefix('v1')->group(function () {
    Route::apiResource('orders', V1\OrderController::class);
});

Route::prefix('v2')->group(function () {
    Route::apiResource('orders', V2\OrderController::class);
});

// 基于 Header 的版本路由
Route::middleware(['api', 'api.version:v2'])->group(function () {
    Route::apiResource('orders', V2\OrderController::class);
});

// app/Http/Middleware/ApiVersionMiddleware.php
class ApiVersionMiddleware
{
    public function handle(Request $request, Closure $next, string $version)
    {
        $requestedVersion = $request->header('Accept-Version', 'v1');

        if ($requestedVersion !== $version) {
            return response()->json(['error' => 'Version mismatch'], 400);
        }

        return $next($request);
    }
}
```

### 4.3 Feature Flag 与金丝雀联动

使用 Laravel Pennant 或自定义 Feature Flag，在代码层面控制新功能的可见性：

```php
// app/Providers/AppServiceProvider.php
use Laravel\Pennant\Feature;

public function boot(): void
{
    Feature::define('new-checkout-flow', function (User $user) {
        // 金丝雀阶段：只有 5% 用户能看到新流程
        return Feature::value('canary-percentage', 5) / 100 > mt_rand(0, 100) / 100;
    });
}

// 在 Controller 中使用
class CheckoutController extends Controller
{
    public function index()
    {
        if (Feature::active('new-checkout-flow')) {
            return $this->newCheckout();
        }
        return $this->legacyCheckout();
    }
}
```

### 4.4 队列任务的版本兼容

金丝雀阶段，新旧版本的队列 Worker 可能同时处理任务，需要保证序列化兼容：

```php
// 使用版本化的 Job 类
class ProcessOrderV2 implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly int $orderId,
        public readonly string $version = 'v2'
    ) {}

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);

        // 根据版本执行不同逻辑
        if ($this->version === 'v2') {
            $this->processV2($order);
        } else {
            $this->processV1($order);
        }
    }

    // 兼容旧 Worker
    public function middleware(): array
    {
        return [
            new WithoutOverlapping("order-{$this->orderId}"),
            new RetryUntil(3),
        ];
    }
}
```

---

## 五、渐进式放量自动化脚本

### 5.1 放量策略设计

典型的金丝雀放量策略：

| 阶段 | 流量占比 | 持续时间 | 观察指标 |
|------|---------|---------|---------|
| 初始 | 1% | 10 分钟 | 错误率、P99 延迟 |
| 小幅放量 | 5% | 15 分钟 | 错误率、CPU/内存 |
| 中等放量 | 20% | 30 分钟 | 业务指标、转化率 |
| 大幅放量 | 50% | 30 分钟 | 全量指标对比 |
| 全量 | 100% | - | 发布完成 |

### 5.2 自动化放量脚本

```bash
#!/bin/bash
# canary-rollout.sh - 渐进式放量脚本

set -euo pipefail

CONSUL_URL="${CONSUL_URL:-http://localhost:8500}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://api.example.com/health}"
METRICS_URL="${METRICS_URL:-http://prometheus:9090}"

STEPS=(1 5 10 20 50 100)
WAIT_SECONDS=(600 900 1800 1800 1800 0)
ERROR_THRESHOLD=0.01  # 1% 错误率阈值
LATENCY_THRESHOLD=500 # P99 延迟阈值 (ms)

update_weight() {
    local canary_weight=$1
    local stable_weight=$((100 - canary_weight))

    curl -s -X PUT "${CONSUL_URL}/v1/kv/upstreams/laravel_backend/canary_weight" \
        -d "${canary_weight}"

    echo "[$(date)] 权重更新: 稳定版=${stable_weight}%, 金丝雀=${canary_weight}%"
}

check_health() {
    # 检查 HTTP 健康
    local http_status=$(curl -s -o /dev/null -w "%{http_code}" "${HEALTH_CHECK_URL}")
    if [ "$http_status" != "200" ]; then
        echo "[ERROR] 健康检查失败: HTTP ${http_status}"
        return 1
    fi

    # 检查错误率
    local error_rate=$(curl -s "${METRICS_URL}/api/v1/query" \
        --data-urlencode 'query=rate(http_requests_total{status=~"5..",version="canary"}[5m]) / rate(http_requests_total{version="canary"}[5m])' \
        | jq -r '.data.result[0].value[1] // "0"')

    if (( $(echo "$error_rate > $ERROR_THRESHOLD" | bc -l) )); then
        echo "[ERROR] 错误率超阈值: ${error_rate} > ${ERROR_THRESHOLD}"
        return 1
    fi

    # 检查 P99 延迟
    local p99_latency=$(curl -s "${METRICS_URL}/api/v1/query" \
        --data-urlencode 'query=histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{version="canary"}[5m]))' \
        | jq -r '.data.result[0].value[1] // "0"')

    local latency_ms=$(echo "$p99_latency * 1000" | bc)
    if (( $(echo "$latency_ms > $LATENCY_THRESHOLD" | bc -l) )); then
        echo "[ERROR] P99 延迟超阈值: ${latency_ms}ms > ${LATENCY_THRESHOLD}ms"
        return 1
    fi

    echo "[OK] 健康检查通过: 错误率=${error_rate}, P99=${latency_ms}ms"
    return 0
}

rollback() {
    echo "[ROLLBACK] 开始回滚，将金丝雀权重设为 0"
    update_weight 0
    exit 1
}

trap rollback ERR

echo "===== 金丝雀渐进式放量开始 ====="

for i in "${!STEPS[@]}"; do
    weight="${STEPS[$i]}"
    wait="${WAIT_SECONDS[$i]}"

    echo ""
    echo "--- 阶段 $((i+1)): 流量 ${weight}% ---"
    update_weight "$weight"

    if [ "$weight" -eq 100 ]; then
        echo "===== 全量发布完成 ====="
        exit 0
    fi

    # 等待并持续检查
    elapsed=0
    check_interval=30
    while [ "$elapsed" -lt "$wait" ]; do
        sleep "$check_interval"
        elapsed=$((elapsed + check_interval))

        if ! check_health; then
            echo "[ROLLBACK] 第 ${elapsed}s 检查失败"
            rollback
        fi

        echo "[${elapsed}/${wait}s] 健康检查通过"
    done

    echo "--- 阶段 $((i+1)) 完成，准备放量 ---"
done
```

### 5.3 GitHub Actions 集成

```yaml
# .github/workflows/canary-deploy.yml
name: Canary Deployment

on:
  push:
    branches: [main]

jobs:
  deploy-canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build & Push Canary Image
        run: |
          docker build -t $ECR_REGISTRY/app:${{ github.sha }}-canary .
          docker push $ECR_REGISTRY/app:${{ github.sha }}-canary

      - name: Deploy Canary Pods
        run: |
          kubectl set image deployment/laravel-canary \
            app=$ECR_REGISTRY/app:${{ github.sha }}-canary

      - name: Run Canary Rollout
        env:
          CONSUL_URL: ${{ secrets.CONSUL_URL }}
          HEALTH_CHECK_URL: ${{ secrets.HEALTH_CHECK_URL }}
        run: |
          chmod +x ./scripts/canary-rollout.sh
          ./scripts/canary-rollout.sh

      - name: Rollback on Failure
        if: failure()
        run: |
          curl -X PUT "${CONSUL_URL}/v1/kv/upstreams/laravel_backend/canary_weight" -d "0"
          kubectl rollout undo deployment/laravel-canary
```

---

## 六、监控与可观测性

### 6.1 Prometheus 指标对比

金丝雀发布的核心决策依据是金丝雀与稳定版的指标对比：

```yaml
# prometheus-rules.yaml
groups:
  - name: canary_alerts
    rules:
      # 错误率对比
      - record: canary:error_rate
        expr: |
          rate(http_requests_total{version="canary",status=~"5.."}[5m])
          /
          rate(http_requests_total{version="canary"}[5m])

      - record: stable:error_rate
        expr: |
          rate(http_requests_total{version="stable",status=~"5.."}[5m])
          /
          rate(http_requests_total{version="stable"}[5m])

      # 金丝雀错误率显著高于稳定版时告警
      - alert: CanaryHighErrorRate
        expr: canary:error_rate > stable:error_rate * 2
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "金丝雀版本错误率异常"

      # P99 延迟对比
      - alert: CanaryHighLatency
        expr: |
          histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{version="canary"}[5m]))
          >
          histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{version="stable"}[5m])) * 1.5
        for: 3m
        annotations:
          summary: "金丝雀版本 P99 延迟显著偏高"
```

### 6.2 Grafana Dashboard

在 Grafana 中创建金丝雀对比看板，核心面板：

- **请求量对比**：stable vs canary 的 QPS
- **错误率对比**：5xx 比率的时间序列
- **延迟分布**：P50/P95/P99 对比
- **业务指标**：下单转化率、支付成功率
- **资源使用**：CPU、内存、GC 频率

### 6.3 自动回滚决策

```php
// app/Services/CanaryDecisionService.php
class CanaryDecisionService
{
    public function __construct(
        private PrometheusClient $prometheus,
        private CanaryConfig $config,
    ) {}

    public function evaluate(): CanaryDecision
    {
        $canaryErrorRate = $this->prometheus->query(
            'rate(http_requests_total{version="canary",status=~"5.."}[5m]) / rate(http_requests_total{version="canary"}[5m])'
        );

        $stableErrorRate = $this->prometheus->query(
            'rate(http_requests_total{version="stable",status=~"5.."}[5m]) / rate(http_requests_total{version="stable"}[5m])'
        );

        // 金丝雀错误率是稳定版的 2 倍以上 → 回滚
        if ($canaryErrorRate > $stableErrorRate * $this->config->errorRateMultiplier) {
            return CanaryDecision::rollback('error_rate_exceeded');
        }

        // 绝对错误率超过阈值 → 回滚
        if ($canaryErrorRate > $this->config->absoluteErrorThreshold) {
            return CanaryDecision::rollback('absolute_error_threshold');
        }

        // 业务指标检查
        $conversionRate = $this->prometheus->query(
            'rate(orders_created{version="canary"}[10m]) / rate(checkout_started{version="canary"}[10m])'
        );

        if ($conversionRate < $this->config->minConversionRate) {
            return CanaryDecision::rollback('conversion_rate_dropped');
        }

        return CanaryDecision::proceed();
    }
}
```

---

## 七、回滚策略

### 7.1 快速回滚方案

金丝雀发布的核心优势是回滚速度——只需将权重调回 0：

```bash
# 紧急回滚：立即将金丝雀流量降为 0
# Nginx 方案
consul kv put upstreams/laravel_backend/canary_weight 0

# Envoy 方案
grpcurl -plaintext -d '{"version_info": "v1"}' \
  envoy-control-plane:9090 \
  envoy.service.route.v3.RouteDiscoveryService/FetchRoutes

# Kubernetes 方案
kubectl rollout undo deployment/laravel-canary
```

### 7.2 数据库回滚

如果金丝雀版本已经执行了数据库迁移，回滚需要谨慎：

```php
// 安全回滚：只回滚 additive-only 的变更
// 不要回滚已经写入数据的 migration

// 在部署脚本中检查
class SafeRollbackChecker
{
    public function canRollback(): bool
    {
        // 检查是否有 destructive migration 已执行
        $pendingDestructive = DB::table('migration_log')
            ->where('type', 'destructive')
            ->where('executed_at', '>', now()->subHour())
            ->exists();

        if ($pendingDestructive) {
            Log::warning('检测到破坏性迁移已执行，需要人工介入回滚');
            return false;
        }

        return true;
    }
}
```

---

## 八、实战案例：B2C 电商订单系统金丝雀发布

### 8.1 场景背景

- 系统：B2C 电商平台订单服务
- 日均订单量：50 万
- 技术栈：Laravel 11 + MySQL 8.0 + Redis 7.0
- 变更：订单状态机重构（从 5 个状态扩展到 12 个状态）

### 8.2 发布流程

```yaml
# 完整发布流程
stages:
  - name: 准备
    tasks:
      - 执行 additive-only migration（新增状态列 new_status）
      - 部署金丝雀版本到 canary 环境
      - 运行 smoke test

  - name: 金丝雀 1%
    duration: 10m
    checks:
      - 错误率 < 0.5%
      - P99 < 300ms
      - 订单创建成功率 > 99.5%

  - name: 金丝雀 10%
    duration: 15m
    checks:
      - 同上 + CPU 使用率增幅 < 10%

  - name: 金丝雀 50%
    duration: 30m
    checks:
      - 全量业务指标对比

  - name: 全量发布
    tasks:
      - 切换 100% 流量
      - 清理旧状态列（24h 后）
      - 更新监控 Dashboard
```

### 8.3 遇到的问题与解决

**问题 1：金丝雀版本的缓存键冲突**

旧版本写入 Redis 的缓存格式与新版本不一致，导致缓存脏数据。

```php
// 解决：使用版本化缓存前缀
class CacheKeyManager
{
    public static function orderKey(int $orderId): string
    {
        $version = config('app.canary_version', 'v1');
        return "order:{$version}:{$orderId}";
    }
}
```

**问题 2：队列任务序列化不兼容**

新版本的 Job 使用了新的构造函数参数，旧 Worker 反序列化失败。

```php
// 解决：使用自定义序列化
class ProcessOrder implements ShouldQueue, SerializesModels
{
    use InteractsWithQueue, Queueable;

    public function __construct(
        public readonly array $payload
    ) {}

    public function __serialize(): array
    {
        return ['payload' => $this->payload, 'version' => 2];
    }

    public function __unserialize(array $data): void
    {
        // 兼容旧版本格式
        $this->payload = $data['payload'] ?? $data;
    }
}
```

---

## 九、最佳实践总结

### 9.1 Kubernetes Ingress 金丝雀（补充方案）

在 Kubernetes 环境中，除了 Nginx/Envoy 独立部署外，还可以利用 Ingress Controller 的原生金丝雀注解实现权重路由，无需额外配置负载均衡器。

```yaml
# stable-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-stable
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: laravel-stable
                port:
                  number: 80
---
# canary-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: laravel-canary
                port:
                  number: 80
```

**动态调整权重**（无需重建 Ingress）：

```bash
# 使用 kubectl annotate 动态修改金丝雀权重
kubectl annotate ingress laravel-canary \
  nginx.ingress.kubernetes.io/canary-weight="30" \
  --overwrite

# 支持 Header 路由（仅 beta 用户走金丝雀）
kubectl annotate ingress laravel-canary \
  nginx.ingress.kubernetes.io/canary-by-header="X-Canary" \
  nginx.ingress.kubernetes.io/canary-by-header-value="true" \
  --overwrite
```

### 9.2 Nginx 金丝雀踩坑：`if` 指令在 `location` 中的陷阱

在 2.3 节的 Cookie 持久化路由中，Nginx 的 `if` 指令是"evil"——它不会像编程语言的 `if/else` 那样工作，而是创建独立的配置上下文。错误使用会导致 `Set-Cookie` 和 `proxy_set_header` 等指令被意外跳过：

```nginx
# ❌ 错误：if 块内的 add_header 不生效
set $final_backend $backend;
if ($final_backend = "") {
    set $final_backend $cookie_backend;
}
# 此处的 add_header 在某些 if 分支下不会生效！
add_header Set-Cookie "canary_group=stable; Path=/; Max-Age=3600";

# ✅ 正确做法：使用 map + error_page 或 split_clients 规避 if
map $backend $final_backend {
    ""      $cookie_backend;
    default $backend;
}

map $final_backend $real_backend {
    ""      laravel_backend;
    default $final_backend;
}
```

### 9.3 金丝雀发布中的连接耗尽（Connection Drain）问题

当金丝雀权重从非零快速归零（紧急回滚）时，已经建立的长连接（HTTP Keep-Alive、WebSocket）不会立即断开。旧 Worker 可能仍在处理已分配的请求。解决方案：

```bash
# Envoy 主动排空：设置 draining_seconds
curl -X POST localhost:19000/clusters/laravel_canary/healthcheck/fail
# Envoy 会在 draining_seconds 后主动关闭连接并返回 503

# Nginx：使用 worker_shutdown_timeout 优雅关闭
# nginx.conf
worker_shutdown_timeout 30s;  # 等待正在处理的请求完成
```

### 9.4 发布前检查清单

- [ ] 数据库迁移只包含 additive-only 变更
- [ ] 新旧版本能同时连接同一数据库
- [ ] 缓存键使用版本前缀避免冲突
- [ ] 队列任务序列化格式兼容
- [ ] 健康检查端点就绪（`/health`, `/ready`）
- [ ] Prometheus 指标已暴露
- [ ] 回滚脚本已测试
- [ ] 监控 Dashboard 已配置

### 9.2 常见陷阱

| 陷阱 | 后果 | 解决方案 |
|------|------|---------|
| Migration 删除列 | 旧版本 500 | 三阶段迁移法 |
| 缓存格式变更 | 数据错乱 | 版本化缓存键 |
| Session 存储不兼容 | 用户登出 | 外部 Session 存储 |
| 队列 Job 参数变更 | 任务失败 | 兼容性序列化 |
| 环境变量新增必填项 | 启动失败 | 默认值 + 渐进式启用 |

---

## 总结

金丝雀发布是高可用系统发布的黄金标准。核心要点：

1. **流量控制**：Nginx 权重路由适合简单场景，Envoy xDS 适合复杂流量治理
2. **版本共存**：数据库三阶段迁移、缓存版本化、队列兼容序列化是三大基石
3. **自动化**：渐进式放量脚本 + Prometheus 指标自动决策
4. **快速回滚**：权重归零即可秒级回滚，但数据库变更需要谨慎

掌握这套体系，你就能在生产环境中安全地发布任何风险等级的变更。

---

## 相关阅读

- [蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚](/categories/运维/蓝绿部署实战-Laravel-零停机发布-流量切换-数据库迁移与一键回滚/)
- [Feature Flag Driven Development 实战：渐进式发布、A/B 测试与技术债务控制](/categories/CICD/Feature-Flag-Driven-Development-实战-Unleash-LaunchDarkly-Flagsmith-选型-渐进式发布-AB测试与技术债务控制/)
- [Envoy Sidecar 模式实战：流量镜像、熔断、重试——基础设施下沉与应用层解耦](/categories/运维/Envoy-Sidecar-模式实战-流量镜像熔断重试-基础设施下沉与应用层解耦/)
