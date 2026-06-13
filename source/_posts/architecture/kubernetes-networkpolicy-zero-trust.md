---

title: Kubernetes NetworkPolicy 实战：Pod 间网络隔离——微服务的零信任网络策略与 Calico/Cilium 集成
keywords: [Kubernetes NetworkPolicy, Pod, Calico, Cilium, 间网络隔离, 微服务的零信任网络策略与, 架构]
date: 2026-06-10 09:03:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- Kubernetes
- NetworkPolicy
- 零信任
- Calico
- Cilium
- 微服务
- 网络隔离
description: 深入讲解 Kubernetes NetworkPolicy 的原理与实战，覆盖默认拒绝策略、微服务间精细授权、Calico/Cilium CNI 集成，以及从零信任角度构建 Pod 级别网络隔离的完整方案。
---



# Kubernetes NetworkPolicy 实战：Pod 间网络隔离

## 概述

在传统的 Kubernetes 集群中，所有 Pod 之间默认是可以互相通信的。这就像一栋大楼里所有房间的门都没锁——任何服务都能直接访问其他服务。在微服务架构下，这种"默认放行"的网络模型带来了严重的安全隐患：一旦某个 Pod 被攻破，攻击者可以横向移动到集群内的任意服务。

**零信任网络（Zero Trust Network）** 的核心理念是：**永远不信任，始终验证**。在 Kubernetes 中，NetworkPolicy 是实现这一理念的关键手段。通过 NetworkPolicy，我们可以精确控制：

- 哪些 Pod 可以访问哪些 Pod
- 允许哪些端口和协议
- 是否允许来自集群外部的流量
- 是否允许 Pod 访问集群外的 DNS、数据库等服务

本文将从零开始，带你构建一套完整的零信任网络策略体系。

## 核心概念

### NetworkPolicy 是什么

NetworkPolicy 是 Kubernetes 的原生资源对象，用于控制 Pod 的入站（Ingress）和出站（Egress）流量。它的工作方式类似于防火墙规则：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: backend          # 策略作用于 backend Pod
  policyTypes:
    - Ingress               # 控制入站流量
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend  # 只允许 frontend Pod 访问
      ports:
        - protocol: TCP
          port: 8080         # 只允许 8080 端口
```

### 关键前提：CNI 插件支持

**NetworkPolicy 需要 CNI 插件支持才能生效。** 默认的 `kubenet` 和 `flannel` 不支持 NetworkPolicy。你需要使用以下 CNI 之一：

| CNI 插件 | NetworkPolicy 支持 | 特点 |
|----------|-------------------|------|
| Calico   | ✅ 完整支持       | 性能好，支持 BGP，社区活跃 |
| Cilium   | ✅ 完整支持 + 扩展 | 基于 eBPF，L7 策略，可观测性强 |
| Weave    | ✅ 基础支持       | 配置简单，性能一般 |
| Antrea   | ✅ 完整支持       | VMware 出品，Open vSwitch |

### 策略模型

NetworkPolicy 遵循以下规则：

1. **没有 NetworkPolicy 时**：所有流量都放行
2. **有 NetworkPolicy 但没有匹配的规则**：该方向的流量被拒绝
3. **多个 NetworkPolicy 选中同一 Pod**：策略取并集（最宽松的生效）

这意味着，要实现零信任，你需要用一个"默认拒绝"策略打底，然后逐个开放需要的流量。

## 实战：构建零信任网络策略

### 第一步：默认拒绝所有入站流量

这是零信任的基础。在每个命名空间中创建一个默认拒绝策略：

```yaml
# 01-default-deny-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}           # 空选择器 = 选中所有 Pod
  policyTypes:
    - Ingress               # 拒绝所有入站流量
```

应用后，production 命名空间中所有 Pod 的入站流量都会被拒绝，直到你显式放行。

### 第二步：默认拒绝所有出站流量

```yaml
# 02-default-deny-egress.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress                # 拒绝所有出站流量
```

**注意：** 拒绝出站流量会导致 Pod 无法解析 DNS（CoreDNS 通常在 `kube-system` 命名空间）。所以你必须同时允许 DNS 流量：

```yaml
# 03-allow-dns-egress.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53            # CoreDNS
        - protocol: TCP
          port: 53
```

### 第三步：按服务逐个开放流量

假设你的微服务架构如下：

```
frontend → api-gateway → user-service → MySQL
                      → order-service → Redis
```

#### 允许 Ingress Controller 访问 frontend

```yaml
# 04-allow-ingress-to-frontend.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-frontend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
```

#### 允许 frontend 访问 api-gateway

```yaml
# 05-allow-frontend-to-gateway.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-gateway
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-egress-to-user-service
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: user-service
      ports:
        - protocol: TCP
          port: 8080
    - to:
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - protocol: TCP
          port: 8080
```

#### 允许 user-service 访问 MySQL

```yaml
# 06-allow-user-service-to-mysql.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-user-service-to-mysql
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: mysql
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: user-service
      ports:
        - protocol: TCP
          port: 3306
    - from:
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - protocol: TCP
          port: 3306
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-user-service-egress-to-mysql
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: user-service
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: mysql
      ports:
        - protocol: TCP
          port: 3306
```

#### 允许 order-service 访问 Redis

```yaml
# 07-allow-order-service-to-redis.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-redis-ingress-from-order-service
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: redis
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - protocol: TCP
          port: 6379
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-order-service-egress-to-redis
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: order-service
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379
```

## Calico 集成：扩展 NetworkPolicy 能力

Calico 不仅实现了标准的 NetworkPolicy，还提供了扩展策略资源 `GlobalNetworkPolicy` 和 `NetworkPolicy`（Calico 版本）。

### 安装 Calico

```bash
# 使用 operator 安装
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/tigera-operator.yaml

# 创建 Installation 资源
cat <<EOF | kubectl apply -f -
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
    - blockSize: 26
      cidr: 10.244.0.0/16
      encapsulation: VXLANCrossSubnet
      natOutgoing: Enabled
      nodeSelector: all()
EOF
```

### Calico 全局策略：跨命名空间零信任

标准 NetworkPolicy 是命名空间级别的。Calico 的 `GlobalNetworkPolicy` 可以跨命名空间生效：

```yaml
# calico-global-deny-all.yaml
apiVersion: projectcalico.org/v3
kind: GlobalNetworkPolicy
metadata:
  name: global-default-deny
spec:
  selector: all()
  types:
    - Ingress
    - Egress
  # 空规则 = 默认拒绝
```

### Calico 的 DNS 策略

Calico 支持基于域名的出站策略（FQDN），这比标准 NetworkPolicy 强大得多：

```yaml
apiVersion: projectcalico.org/v3
kind: NetworkPolicy
metadata:
  name: allow-api-external-access
  namespace: production
spec:
  selector: app == 'api-gateway'
  types:
    - Egress
  egress:
    - action: Allow
      destination:
        selector: app == 'user-service' || app == 'order-service'
    - action: Allow
      destination:
        # 只允许访问特定外部 API
        domains:
          - api.stripe.com
          - api.twilio.com
        ports:
          - 443
    - action: Allow
      destination:
        # 允许 DNS
        selector: k8s-app == 'kube-dns'
        namespaceSelector: kubernetes.io/metadata.name == 'kube-system'
        ports:
          - 53
```

### Calico 命令行工具

```bash
# 安装 calicoctl
curl -L https://github.com/projectcalico/calico/releases/download/v3.27.0/calicoctl-darwin-amd64 -o /usr/local/bin/calicoctl
chmod +x /usr/local/bin/calicoctl

# 查看所有策略
calicoctl get networkpolicy -A

# 查看全局策略
calicoctl get globalnetworkpolicy

# 查看某个 Pod 的策略命中情况
calicoctl get networkpolicy -n production -o yaml

# 诊断网络连接
calicoctl diag connectivity check --source production/frontend --dest production/api-gateway
```

## Cilium 集成：eBPF 驱动的高级策略

Cilium 基于 eBPF 技术，提供了比标准 NetworkPolicy 更丰富的策略能力，包括 L7（应用层）策略。

### 安装 Cilium

```bash
# 使用 Helm 安装
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.14.4 \
  --namespace kube-system \
  --set kubeProxyReplacement=strict \
  --set k8sServiceHost=<API_SERVER_IP> \
  --set k8sServicePort=6443
```

### Cilium L7 策略：HTTP 级别的访问控制

标准 NetworkPolicy 只能控制 L3/L4（IP/端口），Cilium 可以深入到 L7：

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-gateway-l7-policy
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api-gateway
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/api/v1/.*"
              - method: POST
                path: "/api/v1/orders"
                headers:
                  - 'Content-Type: application/json'
  egress:
    - toEndpoints:
        - matchLabels:
            app: user-service
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/users/.*"
              - method: POST
                path: "/users/authenticate"
```

### Cilium 的 DNS 策略

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-dns
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api-gateway
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.cilium.k8s.namespace.labels.kubernetes.io/metadata.name: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: ANY
          rules:
            dns:
              - matchPattern: "*.example.com"
              - matchPattern: "api.stripe.com"
    - toFQDNs:
        - matchName: api.stripe.com
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
```

### Cilium 可观测性

Cilium 提供了 Hubble 可视化工具，可以实时观察网络流量和策略命中：

```bash
# 启用 Hubble
cilium hubble enable --ui

# 查看流量日志
cilium hubble observe --namespace production --verdict DROPPED

# 查看特定 Pod 的流量
cilium hubble observe --pod production/api-gateway --protocol http

# 打开 Hubble UI
cilium hubble ui
```

## 实战脚本：自动化策略验证

写一个脚本来验证 NetworkPolicy 是否正确生效：

```bash
#!/bin/bash
# test-network-policy.sh
# 用法: ./test-network-policy.sh <namespace>

NAMESPACE=${1:-production}

echo "=== 测试 NetworkPolicy 在 ${NAMESPACE} 命名空间 ==="

# 1. 检查默认拒绝策略是否存在
echo -e "\n[1] 检查默认拒绝策略..."
if kubectl get networkpolicy default-deny-ingress -n ${NAMESPACE} &>/dev/null; then
    echo "✅ default-deny-ingress 存在"
else
    echo "❌ default-deny-ingress 缺失！"
fi

if kubectl get networkpolicy default-deny-egress -n ${NAMESPACE} &>/dev/null; then
    echo "✅ default-deny-egress 存在"
else
    echo "❌ default-deny-egress 缺失！"
fi

# 2. 检查 DNS 策略
echo -e "\n[2] 检查 DNS 出站策略..."
if kubectl get networkpolicy allow-dns-egress -n ${NAMESPACE} &>/dev/null; then
    echo "✅ allow-dns-egress 存在"
else
    echo "❌ allow-dns-egress 缺失！"
fi

# 3. 测试 Pod 间连通性
echo -e "\n[3] 测试 Pod 间连通性..."

# 在 frontend Pod 中尝试访问 api-gateway（应该成功）
FRONTEND_POD=$(kubectl get pod -n ${NAMESPACE} -l app=frontend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
GATEWAY_POD=$(kubectl get pod -n ${NAMESPACE} -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -n "$FRONTEND_POD" ] && [ -n "$GATEWAY_POD" ]; then
    echo "测试 frontend → api-gateway:8080..."
    kubectl exec ${FRONTEND_POD} -n ${NAMESPACE} -- \
        wget -q -O /dev/null --timeout=3 http://${GATEWAY_POD}:8080/ 2>&1 \
        && echo "✅ 连接成功（符合预期）" \
        || echo "❌ 连接失败（可能策略配置有误）"
fi

# 在 frontend Pod 中尝试访问 mysql（应该被拒绝）
MYSQL_POD=$(kubectl get pod -n ${NAMESPACE} -l app=mysql -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -n "$FRONTEND_POD" ] && [ -n "$MYSQL_POD" ]; then
    echo "测试 frontend → mysql:3306（应该被拒绝）..."
    kubectl exec ${FRONTEND_POD} -n ${NAMESPACE} -- \
        wget -q -O /dev/null --timeout=3 http://${MYSQL_POD}:3306/ 2>&1 \
        && echo "❌ 连接成功（不应该发生！）" \
        || echo "✅ 连接被拒绝（符合预期）"
fi

echo -e "\n=== 测试完成 ==="
```

## PHP/Laravel 项目中的集成实践

在 Laravel 微服务中，NetworkPolicy 需要配合服务发现和健康检查一起考虑：

### Laravel 健康检查端点

```php
// app/Http/Controllers/HealthController.php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class HealthController extends Controller
{
    public function check(): JsonResponse
    {
        $checks = [
            'status' => 'ok',
            'timestamp' => now()->toIso8601String(),
            'checks' => [
                'database' => $this->checkDatabase(),
                'redis' => $this->checkRedis(),
            ],
        ];

        $allHealthy = collect($checks['checks'])->every(
            fn($check) => $check['status'] === 'ok'
        );

        return response()->json(
            $checks,
            $allHealthy ? 200 : 503
        );
    }

    private function checkDatabase(): array
    {
        try {
            DB::connection()->getPdo();
            return ['status' => 'ok'];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }

    private function checkRedis(): array
    {
        try {
            Redis::ping();
            return ['status' => 'ok'];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }
}
```

```php
// routes/api.php
Route::get('/health', [HealthController::class, 'check']);
```

### Deployment 中的健康检查探针

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: production
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
          image: registry.example.com/api-gateway:latest
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
```

**注意：** 即使启用了默认拒绝策略，Kubernetes 的探针流量（来自 kubelet）通常不会被 NetworkPolicy 拦截，因为 kubelet 流量走的是主机网络。但如果你使用了某些 CNI 插件的严格模式，可能需要额外配置。

## 踩坑记录

### 1. DNS 解析失败

**症状：** 启用默认拒绝出站后，所有服务都无法解析域名。

**原因：** CoreDNS 的流量也被拦截了。

**解决：** 必须创建允许 DNS 出站的策略（见上文 `allow-dns-egress`）。

### 2. 策略不生效

**症状：** 创建了 NetworkPolicy，但流量仍然放行。

**排查步骤：**

```bash
# 1. 检查 CNI 插件是否支持 NetworkPolicy
kubectl get daemonset -n kube-system -o wide

# 2. 检查策略是否被正确选中 Pod
kubectl describe networkpolicy <name> -n <namespace>
# 看 "PodSelector" 和 "Selected Pods" 字段

# 3. 检查策略规则是否正确
kubectl get networkpolicy <name> -n <namespace> -o yaml

# 4. 查看 CNI 日志
# Calico:
kubectl logs -n calico-system -l k8s-app=calico-node
# Cilium:
kubectl logs -n kube-system -l k8s-app=cilium
```

### 3. 多策略冲突

**症状：** 一个 Pod 被多个 NetworkPolicy 选中，行为不符合预期。

**原因：** NetworkPolicy 是取并集的。如果你有一个策略允许 `frontend` 访问，另一个策略允许 `monitoring` 访问，那么两个来源都能访问。

**解决：** 使用 `podSelector` 精确匹配，避免策略意外覆盖。如果需要"仅允许"语义，确保所有相关策略都使用 `podSelector` 限定范围。

### 4. Init 容器被拦截

**症状：** Pod 启动时 Init 容器无法访问外部服务。

**原因：** NetworkPolicy 对 Init 容器同样生效。

**解决：** 确保出站策略包含了 Init 容器需要的网络访问：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-init-container-egress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: my-service
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 443    # 允许 Init 容器拉取配置
```

### 5. 命名空间隔离遗漏

**症状：** 不同命名空间的服务意外互通。

**原因：** 没有在所有命名空间部署默认拒绝策略。

**解决：** 使用 GitOps 工具确保每个命名空间都有基础策略：

```bash
# 检查哪些命名空间缺少默认拒绝策略
for ns in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
    has_policy=$(kubectl get networkpolicy -n $ns -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
    if [[ ! "$has_policy" =~ "default-deny" ]]; then
        echo "⚠️  ${ns} 缺少默认拒绝策略"
    fi
done
```

## 总结

构建 Kubernetes 零信任网络的核心步骤：

1. **选择支持 NetworkPolicy 的 CNI**（推荐 Calico 或 Cilium）
2. **每个命名空间部署默认拒绝策略**（Ingress + Egress）
3. **允许 DNS 出站**（否则一切都会崩）
4. **按服务依赖关系逐个开放流量**（最小权限原则）
5. **结合 L7 策略做深度防护**（Cilium 的 HTTP 策略）
6. **持续验证和监控**（Hubble、calicoctl、自动化测试脚本）

零信任不是一蹴而就的。建议从"默认拒绝入站"开始，逐步收紧出站策略，最终实现全量零信任。过程中配合 Hubble 或 Calico 的流量可视化工具，能大大降低排错成本。

网络安全的边界早已不是物理机房的围墙。在 Kubernetes 的世界里，NetworkPolicy 就是你的防火墙，Pod 标签就是你的 ACL。把每一扇门都锁上，只给需要的人钥匙——这就是零信任的精髓。
