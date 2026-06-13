---
title: "Kubernetes Pod Disruption Budget 实战：滚动更新与节点维护的服务可用性保障——生产环境的最小可用副本数策略"
date: 2026-06-10 09:01:00
tags: [Kubernetes, PDB, Pod Disruption Budget, 滚动更新, 节点维护, 服务可用性, 生产环境]
keywords: [Kubernetes Pod Disruption Budget, 滚动更新与节点维护的服务可用性保障, 生产环境的最小可用副本数策略, DevOps]
categories:
  - devops
description: Kubernetes Pod Disruption Budget 实战指南，详解 PDB 核心概念、minAvailable 与 maxUnavailable 配置策略、滚动更新场景、节点 drain 与维护、与 Deployment/StatefulSet 的配合使用，结合 PHP/Laravel 微服务真实案例，帮助运维团队掌握生产环境最小可用副本数保障策略。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---


## 前言

在 Kubernetes 集群运维中，Pod 因节点维护、节点故障、集群升级、自动扩缩容等原因被驱逐是常态。如果驱逐策略不当，服务可能出现短暂不可用——用户看到 503、API 超时、队列任务堆积。

Pod Disruption Budget（PDB）是 Kubernetes 提供的原生机制，用于在**自愿中断**（Voluntary Disruption）场景下保证服务的最小可用性。它不阻止中断发生，而是确保中断不会同时影响太多 Pod。

本文将从理论到实践，完整讲解如何为 PHP/Laravel 微服务配置 PDB，覆盖滚动更新、节点 drain、集群升级等核心场景。

---

## 第一章：PDB 核心概念

### 1.1 什么是自愿中断？

Kubernetes 中的 Pod 中断分为两类：

| 中断类型 | 触发场景 | PDB 是否保护 |
|---------|---------|-------------|
| **自愿中断** | 节点 drain、`kubectl delete pod`、滚动更新、节点维护 | ✅ 有效 |
| **非自愿中断** | 节点宕机、内核 panic、磁盘满、OOM Kill | ❌ 无效 |

PDB 只保护自愿中断。非自愿中断需要通过**副本数冗余**和**Pod 反亲和性**来保障。

### 1.2 PDB 工作原理

```
┌─────────────────────────────────────────────────────┐
│              Pod Disruption Budget 工作流             │
│                                                     │
│  1. 运维执行 drain node                              │
│         ↓                                           │
│  2. drain controller 检查 PDB                        │
│         ↓                                           │
│  3. 如果中断会导致可用 Pod 低于阈值 → 拒绝 drain       │
│  4. 如果不违反 PDB → 允许驱逐 Pod                     │
│         ↓                                           │
│  5. Pod 被优雅终止（preStop hook + terminationGrace） │
│         ↓                                           │
│  6. drain controller 继续下一个 Pod                   │
└─────────────────────────────────────────────────────┘
```

关键点：PDB 不会直接阻止 `kubectl delete pod`，但它会影响 `kubectl drain` 等编排中断的操作。

### 1.3 两个核心参数

```yaml
# 方式一：minAvailable（至少可用）
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 2    # 至少保持 2 个 Pod 可用
  selector:
    matchLabels:
      app: my-app

# 方式二：maxUnavailable（最多不可用）
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  maxUnavailable: 1  # 最多允许 1 个 Pod 不可用
  selector:
    matchLabels:
      app: my-app
```

**参数选择原则：**

| 场景 | 推荐参数 | 原因 |
|-----|---------|-----|
| 小规模服务（≤5 副本） | `minAvailable` | 直接控制最小可用数，更直观 |
| 大规模服务（≥10 副本） | `maxUnavailable` | 允许更多并行更新，提高发布效率 |
| 有状态服务（数据库） | `minAvailable` | 必须保证固定数量的实例存活 |

### 1.4 PDB 与 Deployment 副本数的关系

这是最容易踩坑的地方。假设 Deployment 有 3 个副本：

```yaml
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3          # 总共 3 个副本
  template:
    spec:
      containers:
      - name: app
        image: my-app:v1
```

```yaml
# PDB 配置
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 2      # 至少 2 个可用
```

这意味着：**drain 操作最多只能驱逐 1 个 Pod**（3 - 2 = 1）。如果节点上有 2 个 Pod，drain 会阻塞——它必须等 Pod 调度到其他节点后才能继续驱逐第二个。

---

## 第二章：PHP/Laravel 微服务 PDB 配置实战

### 2.1 场景一：Web API 服务

```yaml
# web-api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  namespace: production
  labels:
    app: web-api
    version: v2
spec:
  replicas: 4
  selector:
    matchLabels:
      app: web-api
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0    # 滚动更新时不允许减少
  template:
    metadata:
      labels:
        app: web-api
        version: v2
    spec:
      terminationGracePeriodSeconds: 60
      containers:
      - name: php-fpm
        image: registry.example.com/web-api:v2
        ports:
        - containerPort: 9000
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 1000m
            memory: 512Mi
        readinessProbe:
          httpGet:
            path: /health
            port: 9000
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 9000
          initialDelaySeconds: 10
          periodSeconds: 30
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 5"]
      - name: nginx
        image: nginx:1.25-alpine
        ports:
        - containerPort: 80
```

```yaml
# web-api-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-api-pdb
  namespace: production
spec:
  minAvailable: 2          # 4 个副本，至少保留 2 个
  selector:
    matchLabels:
      app: web-api
```

**为什么 `minAvailable: 2`？**

4 个副本中保留 2 个，意味着最多允许同时驱逐 2 个 Pod。对于 API 服务，我们需要在流量高峰期保留至少 50% 的处理能力。

### 2.2 场景二：队列消费者（Queue Worker）

```yaml
# queue-worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: queue-worker
  namespace: production
  labels:
    app: queue-worker
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: queue-worker
    spec:
      terminationGracePeriodSeconds: 300    # 队列处理需要更长的优雅终止时间
      containers:
      - name: worker
        image: registry.example.com/web-api:v2
        command: ["php", "artisan", "queue:work", "--sleep=3", "--tries=3", "--max-time=3600"]
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        env:
        - name: QUEUE_CONNECTION
          value: "redis"
        - name: REDIS_HOST
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: redis-host
```

```yaml
# queue-worker-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: queue-worker-pdb
  namespace: production
spec:
  minAvailable: 1          # 3 个副本，至少保留 1 个消费者
  selector:
    matchLabels:
      app: queue-worker
```

**为什么 `minAvailable: 1`？**

队列消费者不像 Web 服务需要高并发，但需要至少 1 个在持续处理任务。`minAvailable: 1` 允许 drain 时同时驱逐 2 个 worker，只要保证至少 1 个在运行。

### 2.3 场景三：有状态服务（MySQL/Redis）

```yaml
# mysql-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
  namespace: production
spec:
  serviceName: mysql
  replicas: 3              # 1 主 2 从
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      terminationGracePeriodSeconds: 120
      containers:
      - name: mysql
        image: mysql:8.0
        ports:
        - containerPort: 3306
        volumeMounts:
        - name: mysql-data
          mountPath: /var/lib/mysql
  volumeClaimTemplates:
  - metadata:
      name: mysql-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 50Gi
```

```yaml
# mysql-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: mysql-pdb
  namespace: production
spec:
  minAvailable: 2          # 3 个节点，至少保留 2 个（1主1从）
  selector:
    matchLabels:
      app: mysql
```

**为什么 `minAvailable: 2`？**

MySQL 1 主 2 从架构中，必须保证主节点和至少一个从节点存活。`minAvailable: 2` 确保 drain 操作一次只能驱逐 1 个节点。

---

## 第三章：滚动更新与 PDB 配合

### 3.1 滚动更新流程

```
┌─────────────────────────────────────────────────────┐
│            滚动更新 + PDB 配合流程                     │
│                                                     │
│  初始状态：4 个 Pod（v1 版本）                         │
│  PDB：minAvailable: 2                               │
│  Deployment 策略：maxSurge=1, maxUnavailable=0       │
│                                                     │
│  Step 1: 创建 1 个 v2 Pod（5 个 Pod 总数）            │
│          → 检查 PDB：5 ≥ 2 ✅                        │
│                                                     │
│  Step 2: 等待 v2 Pod Ready                           │
│                                                     │
│  Step 3: 终止 1 个 v1 Pod（4 个 Pod 总数）            │
│          → 检查 PDB：4 ≥ 2 ✅                        │
│                                                     │
│  Step 4: 创建 1 个 v2 Pod（5 个 Pod 总数）            │
│          → 检查 PDB：5 ≥ 2 ✅                        │
│                                                     │
│  Step 5: 等待 v2 Pod Ready                           │
│                                                     │
│  Step 6: 终止 1 个 v1 Pod（4 个 Pod 总数）            │
│          → 检查 PDB：4 ≥ 2 ✅                        │
│                                                     │
│  ... 重复直到所有 v1 Pod 被替换                       │
│                                                     │
│  最终状态：4 个 Pod（v2 版本）                         │
└─────────────────────────────────────────────────────┘
```

### 3.2 PDB 冲突导致滚动更新卡住

如果 PDB 配置不当，滚动更新会卡住：

```yaml
# ❌ 错误配置：PDB 太严格
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 4          # 4 个副本，保留全部
  selector:
    matchLabels:
      app: my-app
```

这种配置下，任何 drain 操作都会被阻止，滚动更新也会失败（因为无法终止旧 Pod）。

**排查命令：**

```bash
# 查看 PDB 状态
kubectl get pdb -n production

# 输出示例
NAME         MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
web-api-pdb  2               N/A               2                     7d
```

`ALLOWED DISRUPTIONS` 显示当前允许的中断数。如果为 0，说明 PDB 正在阻止 drain。

### 3.3 使用 maxUnavailable 提高更新效率

```yaml
# ✅ 推荐配置：使用 maxUnavailable
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-api-pdb
spec:
  maxUnavailable: 1        # 最多 1 个 Pod 不可用
  selector:
    matchLabels:
      app: web-api
```

对于 4 副本的 Deployment，`maxUnavailable: 1` 意味着至少 3 个 Pod 保持可用，同时允许 1 个 Pod 在更新过程中不可用。

---

## 第四章：节点维护与 PDB

### 4.1 正确的节点 Drain 流程

```bash
# 1. 标记节点为不可调度（新 Pod 不会调度到这里）
kubectl cordon node-03

# 2. 驱逐节点上的 Pod（PDB 保护生效）
kubectl drain node-03 \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --force=false \
  --grace-period=60 \
  -n production

# 3. 执行维护操作（系统升级、硬件更换等）

# 4. 恢复节点
kubectl uncordon node-03
```

**PDB 在 drain 中的作用：**

drain 命令在驱逐 Pod 前会检查 PDB。如果驱逐某个 Pod 会导致可用 Pod 数低于 PDB 阈值，drain 会**暂停等待**，而不是强制驱逐。

### 4.2 Drain 超时处理

如果 PDB 配置过于严格，drain 可能长时间阻塞：

```bash
# 设置 drain 超时（默认 0 表示无限等待）
kubectl drain node-03 \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --timeout=300s           # 5 分钟超时
```

**超时后的处理策略：**

1. 检查 PDB 配置是否合理
2. 如果是紧急维护，可以临时修改 PDB
3. 或者使用 `--force` 参数（生产环境慎用）

### 4.3 多副本 Pod 分布在多个节点

确保 Pod 分布在多个节点上，避免单点故障：

```yaml
# Pod 反亲和性配置
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
spec:
  replicas: 4
  template:
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - web-api
              topologyKey: kubernetes.io/hostname
```

结合 PDB，即使整个节点被 drain，其他节点上的 Pod 也能继续服务。

---

## 第五章：PHP/Laravel 应用的优雅终止

### 5.1 PHP-FPM 优雅终止

PHP-FPM 的 Worker 进程需要时间处理完当前请求。配置 `preStop` hook 和合理的 `terminationGracePeriodSeconds`：

```yaml
containers:
- name: php-fpm
  lifecycle:
    preStop:
      exec:
        command: ["/bin/sh", "-c", "sleep 5 && kill -QUIT $(cat /var/run/php-fpm.pid)"]
  terminationGracePeriodSeconds: 60
```

**流程：**
1. Pod 被标记为 Terminating
2. 从 Service 的 Endpoints 中移除
3. 执行 preStop hook（sleep 5 等待负载均衡器更新）
4. 发送 QUIT 信号给 PHP-FPM
5. PHP-FPM 停止接受新请求，处理完当前请求后退出
6. 如果超时未退出，kubelet 发送 SIGKILL

### 5.2 Laravel Queue Worker 优雅终止

```yaml
containers:
- name: worker
  command: ["php", "artisan", "queue:work", "--sleep=3", "--tries=3", "--max-time=3600"]
  lifecycle:
    preStop:
      exec:
        command: ["/bin/sh", "-c", "php /var/www/html/artisan queue:restart"]
  terminationGracePeriodSeconds: 300
```

**关键点：**
- `queue:restart` 会设置 Redis 标志，当前 Worker 处理完当前任务后自动退出
- `--max-time=3600` 确保 Worker 不会长时间运行，定期重启以释放内存
- `terminationGracePeriodSeconds: 300` 给 Worker 足够时间完成当前任务

### 5.3 健康检查配置

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 9000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 5
  successThreshold: 1
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /health
    port: 9000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  successThreshold: 1
  failureThreshold: 3
```

**Laravel Health Check 路由：**

```php
// routes/web.php
Route::get('/health', function () {
    // 检查数据库连接
    try {
        DB::connection()->getPdo();
    } catch (Exception $e) {
        return response()->json(['status' => 'unhealthy', 'error' => 'Database'], 503);
    }

    // 检查 Redis 连接
    try {
        Redis::ping();
    } catch (Exception $e) {
        return response()->json(['status' => 'unhealthy', 'error' => 'Redis'], 503);
    }

    return response()->json(['status' => 'healthy']);
});
```

---

## 第六章：踩坑记录

### 6.1 坑：PDB 与 Deployment 副本数不匹配

**场景：** Deployment 有 3 个副本，PDB 配置 `minAvailable: 3`。

**结果：** 任何 drain 操作都会被完全阻止，滚动更新也会失败。

**解决：** 调整 PDB 为 `minAvailable: 2` 或 `maxUnavailable: 1`。

### 6.2 坑：PDB 保护了 DaemonSet Pod

**场景：** PDB 的 selector 匹配了 DaemonSet 管理的 Pod。

**结果：** 节点 drain 被阻塞，因为 DaemonSet Pod 无法被驱逐。

**解决：** PDB selector 应该精确匹配 Deployment 管理的 Pod，避免匹配 DaemonSet。

```yaml
# ❌ 错误：匹配了所有 app=monitoring 的 Pod
spec:
  selector:
    matchLabels:
      app: monitoring

# ✅ 正确：精确匹配 Deployment 管理的 Pod
spec:
  selector:
    matchLabels:
      app: monitoring
      owner: deployment
```

### 6.3 坑：PDB 与 HPA 冲突

**场景：** HPA 在高流量时扩容到 10 个副本，PDB 配置 `maxUnavailable: 50%`。

**结果：** 扩容后 PDB 允许最多 5 个 Pod 中断，但在缩容时可能导致过多 Pod 同时被驱逐。

**解决：** 使用绝对数值而非百分比：

```yaml
# ❌ 可能导致问题
maxUnavailable: 50%

# ✅ 使用绝对数值
maxUnavailable: 2
```

### 6.4 坑：忘记配置 PDB

**场景：** 没有为关键服务配置 PDB，运维执行 `kubectl drain` 时直接驱逐所有 Pod。

**结果：** 服务短暂不可用，用户看到 503 错误。

**解决：** 为所有生产服务配置 PDB，作为基础设施即代码的一部分。

---

## 第七章：PDB 最佳实践

### 7.1 配置模板

```yaml
# Web 服务（4 副本）
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-api-pdb
  namespace: production
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: web-api
---
# 队列消费者（3 副本）
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: queue-worker-pdb
  namespace: production
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: queue-worker
---
# 有状态服务（3 副本）
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: mysql-pdb
  namespace: production
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: mysql
```

### 7.2 监控与告警

```bash
# 监控 PDB 状态
kubectl get pdb -n production -o yaml

# 检查允许的中断数
kubectl get pdb -n production -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.allowedDisruptions}{"\n"}{end}'
```

Prometheus 告警规则：

```yaml
# prometheus-rules.yaml
groups:
- name: pdb-alerts
  rules:
  - alert: PDBAllowedDisruptionsZero
    expr: |
      kube_poddisruptionbudget_status_allowed_disruptions == 0
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "PDB allowed disruptions is zero"
      description: "PDB {{ $labels.name }} has no allowed disruptions, drain operations may be blocked"
```

### 7.3 CI/CD 集成

在部署流程中自动检查 PDB：

```bash
#!/bin/bash
# check-pdb.sh

NAMESPACE="production"
DEPLOYMENT="web-api"

# 获取 Deployment 副本数
REPLICAS=$(kubectl get deployment $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.spec.replicas}')

# 获取 PDB minAvailable
MIN_AVAILABLE=$(kubectl get pdb ${DEPLOYMENT}-pdb -n $NAMESPACE -o jsonpath='{.spec.minAvailable}')

# 计算允许的中断数
ALLOWED=$((REPLICAS - MIN_AVAILABLE))

if [ $ALLOWED -le 0 ]; then
    echo "ERROR: PDB configuration will block all drain operations"
    exit 1
fi

echo "OK: PDB allows $ALLOWED disruptions for $DEPLOYMENT"
```

---

## 总结

Pod Disruption Budget 是 Kubernetes 生产环境的必备配置，核心要点：

1. **理解自愿中断 vs 非自愿中断**：PDB 只保护自愿中断
2. **合理选择 minAvailable vs maxUnavailable**：小规模用 minAvailable，大规模用 maxUnavailable
3. **与 Deployment 副本数匹配**：避免 PDB 过于严格导致更新卡住
4. **配置优雅终止**：PHP-FPM 和 Queue Worker 需要 preStop hook 和足够的 terminationGracePeriodSeconds
5. **监控 PDB 状态**：确保 allowedDisruptions 始终大于 0

没有 PDB 的集群就像没有保险的汽车——平时没事，出事就是大事。

---

## 参考资料

- [Kubernetes Pod Disruption Budget 官方文档](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [Kubernetes 节点维护最佳实践](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)
- [PHP-FPM 优雅终止配置](https://www.php.net/manual/en/install.fpm.configuration.php)
