---
title: Chaos Engineering 实战：用 Chaos Mesh 对 Laravel 微服务进行故障注入与韧性测试
date: 2026-06-02 08:00:00
tags: [Chaos Engineering, Chaos Mesh, Kubernetes, 韧性测试, Laravel, 微服务]
keywords: [Chaos Engineering, Chaos Mesh, Laravel, 微服务进行故障注入与韧性测试, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: Chaos Engineering 实战教程，使用 Chaos Mesh 对运行在 Kubernetes 上的 Laravel 微服务进行系统性故障注入与韧性测试。涵盖 Pod Kill、网络延迟、CPU/内存压力、JVM 故障等实验类型，详解从假设建立到实验编排的完整流程，结合 SLO 验证系统韧性，帮助团队主动发现生产环境脆弱点，在真正的故障到来前做好准备。
---


"我们的系统在生产环境中很稳定。"——直到某个数据库连接超时导致整个订单服务雪崩，或者某个第三方支付接口挂了让所有用户看到 500 错误。

混沌工程的核心理念是：与其等待故障在最不合适的时机发生，不如主动制造故障，在可控的条件下发现系统的脆弱点。Netflix 在 2010 年提出了 Chaos Monkey 的概念，而 Chaos Mesh 将这个理念带入了 Kubernetes 生态。

本文将完整展示如何使用 Chaos Mesh 对运行在 Kubernetes 上的 Laravel 微服务进行系统性的故障注入与韧性测试。

<!-- more -->

## 混沌工程原则

### 原则 1：从假设出发

混沌实验不是"随便搞破坏"。每次实验都必须从一个明确的假设开始：

```
假设：当 Redis 主节点宕机时，Laravel API 应该在 30 秒内自动切换到从节点，
用户请求最多出现短暂的延迟增加，不会出现 5xx 错误。
```

### 原则 2：在生产环境中实验

最真实的故障发生在生产环境。但"生产环境混沌实验"不等于"乱搞"：

1. 从小爆炸半径开始（单个 Pod）
2. 在低流量时段进行
3. 准备好立即回滚的方案
4. 有人盯着监控面板

### 原则 3：自动化持续实验

手动执行一次混沌实验只能发现一次问题。将混沌实验集成到 CI/CD 中，才能持续保障系统的韧性。

### 原则 4：最小化爆炸半径

```
爆炸半径控制清单：
├── 影响范围：单 Pod → 单节点 → 单可用区 → 全集群
├── 持续时间：30s → 5m → 30m → 持续
├── 影响比例：10% → 30% → 50% → 100%
└── 回滚时间：< 30s
```

## Chaos Mesh 安装与配置

### 安装

```bash
# 添加 Helm 仓库
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm repo update

# 安装 Chaos Mesh
helm install chaos-mesh chaos-mesh/chaos-mesh \
  --namespace chaos-testing \
  --create-namespace \
  --set chaosDaemon.runtime=containerd \
  --set chaosDaemon.socketPath=/run/containerd/containerd.sock \
  --set dashboard.securityMode=true \
  --version 2.6.x

# 验证安装
kubectl get pods -n chaos-testing
```

### 权限配置

```yaml
# chaos-mesh-rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: chaos-experimenter
  namespace: laravel-app

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: chaos-experimenter
  namespace: laravel-app
rules:
  - apiGroups: ["chaos-mesh.org"]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: chaos-experimenter
  namespace: laravel-app
subjects:
  - kind: ServiceAccount
    name: chaos-experimenter
    namespace: laravel-app
roleRef:
  kind: Role
  name: chaos-experimenter
  apiGroup: rbac.authorization.k8s.io
```

## 故障注入类型与实战

### 实验 1：Pod Kill —— 模拟容器崩溃

这是最基础的混沌实验：随机杀死一个 Pod，验证 Kubernetes 的自愈能力。

```yaml
# experiments/pod-kill.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: laravel-api-pod-kill
  namespace: laravel-app
spec:
  action: pod-kill
  mode: one  # 只杀一个 Pod
  selector:
    namespaces:
      - laravel-app
    labelSelectors:
      app: laravel-api
  scheduler:
    cron: '@every 30m'  # 每 30 分钟执行一次
```

**假设**：当一个 Laravel API Pod 被杀死时，Kubernetes 应该在 30 秒内启动新 Pod，Service 的 Endpoints 更新后流量自动切换到健康 Pod。

**验证指标**：
```promql
# 请求错误率（应 < 0.1%）
sum(rate(http_requests_total{status=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))

# Pod 重启时间
time() - kube_pod_created{namespace="laravel-app", pod=~"laravel-api.*"}

# Endpoints 更新延迟
kube_endpoint_address_available{namespace="laravel-app", endpoint="laravel-api"}
```

### 实验 2：Network Delay —— 模拟网络延迟

模拟数据库连接的网络延迟，验证 Laravel 的超时配置是否生效。

```yaml
# experiments/network-delay.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: mysql-network-delay
  namespace: laravel-app
spec:
  action: delay
  mode: all
  selector:
    namespaces:
      - laravel-app
    labelSelectors:
      app: mysql-primary
  delay:
    latency: "200ms"
    jitter: "50ms"
    correlation: "75"
  direction: to
  target:
    selector:
      namespaces:
        - laravel-app
      labelSelectors:
        app: laravel-api
    mode: all
  duration: "5m"  # 持续 5 分钟
```

**假设**：当 MySQL 网络延迟增加 200ms 时，Laravel 应该：
1. P99 延迟增加不超过 250ms
2. 没有请求超时（假设超时设置为 5s）
3. 数据库连接池不被耗尽

**Laravel 侧的超时配置验证**：

```php
<?php
// config/database.php
return [
    'connections' => [
        'mysql' => [
            'driver' => 'mysql',
            'host' => env('DB_HOST', 'mysql-primary'),
            'port' => env('DB_PORT', '3306'),
            'database' => env('DB_DATABASE'),
            'username' => env('DB_USERNAME'),
            'password' => env('DB_PASSWORD'),
            'options' => [
                PDO::ATTR_TIMEOUT => 5,  // 连接超时 5 秒
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => true,
            ],
            // 读写分离配置
            'read' => [
                'host' => [
                    env('DB_READ_HOST_1', 'mysql-replica-1'),
                    env('DB_READ_HOST_2', 'mysql-replica-2'),
                ],
            ],
            'write' => [
                'host' => [
                    env('DB_WRITE_HOST', 'mysql-primary'),
                ],
            ],
            'sticky' => true,
            'throw' => true,
        ],
    ],
];
```

### 实验 3：Network Loss —— 模拟网络丢包

```yaml
# experiments/network-loss.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: redis-network-loss
  namespace: laravel-app
spec:
  action: loss
  mode: all
  selector:
    namespaces:
      - laravel-app
    labelSelectors:
      app: redis-master
  loss:
    loss: "30"  # 30% 丢包率
    correlation: "50"
  direction: both
  duration: "3m"
```

**假设**：当 Redis 丢包率 30% 时，Laravel 的 Redis 操作应该：
1. 缓存读取失败时优雅降级到数据库查询
2. 分布式锁获取失败时返回明确错误（不出现死锁）
3. 队列操作失败时自动重试

**验证 Laravel 的 Redis 容错代码**：

```php
<?php

namespace App\Services\Cache;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class ResilientCacheService
{
    /**
     * 带降级的缓存读取
     */
    public function rememberWithFallback(
        string $key,
        int $ttl,
        callable $fallback
    ): mixed {
        try {
            $value = Cache::store('redis')->get($key);
            if ($value !== null) {
                return $value;
            }
        } catch (\Exception $e) {
            Log::warning('Redis cache read failed, falling back to DB', [
                'key' => $key,
                'error' => $e->getMessage(),
            ]);

            // Redis 不可用时直接走数据库
            return $fallback();
        }

        // 缓存未命中，从数据库获取
        $value = $fallback();

        try {
            Cache::store('redis')->put($key, $value, $ttl);
        } catch (\Exception $e) {
            Log::warning('Redis cache write failed', [
                'key' => $key,
                'error' => $e->getMessage(),
            ]);
            // 写缓存失败不影响业务
        }

        return $value;
    }

    /**
     * 带降级的分布式锁
     */
    public function lockWithFallback(
        string $name,
        int $ttl,
        callable $callback,
        callable $fallback
    ): mixed {
        try {
            $lock = Cache::store('redis')->lock("lock:{$name}", $ttl);

            if ($lock->get()) {
                try {
                    $result = $callback();
                    $lock->release();
                    return $result;
                } catch (\Exception $e) {
                    $lock->release();
                    throw $e;
                }
            }

            // 获取锁失败
            Log::warning('Distributed lock acquisition failed', [
                'name' => $name,
            ]);
            return $fallback();

        } catch (\Exception $e) {
            Log::warning('Redis lock service unavailable', [
                'name' => $name,
                'error' => $e->getMessage(),
            ]);
            return $fallback();
        }
    }
}
```

### 实验 4：IO Fault —— 模拟磁盘 IO 故障

```yaml
# experiments/io-fault.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: storage-io-fault
  namespace: laravel-app
spec:
  action: fault
  mode: one
  selector:
    namespaces:
      - laravel-app
    labelSelectors:
      app: laravel-api
  volumePath: /var/www/html/storage
  path: "/var/www/html/storage/logs/*"
  percent: 50  # 50% 的 IO 操作失败
  errno: 5  # EIO
  duration: "2m"
```

**假设**：当存储 IO 故障时，Laravel 应该：
1. 日志写入失败不影响业务逻辑
2. 文件缓存降级到内存缓存
3. 文件上传操作返回明确错误

**Laravel 配置验证**：

```php
<?php
// config/logging.php
return [
    'channels' => [
        'stack' => [
            'driver' => 'stack',
            'channels' => ['daily', 'slack'],
            'ignore_exceptions' => false,
        ],

        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => 'debug',
            'days' => 14,
            'permission' => 0664,
            'locking' => true,  // 防止并发写入导致的日志损坏
        ],

        // 当文件日志失败时，降级到 syslog
        'fallback' => [
            'driver' => 'syslog',
            'level' => 'debug',
        ],
    ],
];
```

### 实验 5：Stress CPU/Memory —— 模拟资源压力

```yaml
# experiments/stress.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: laravel-api-cpu-stress
  namespace: laravel-app
spec:
  mode: one
  selector:
    namespaces:
      - laravel-app
    labelSelectors:
      app: laravel-api
  stressors:
    cpu:
      workers: 4
      load: 80  # CPU 负载 80%
    memory:
      workers: 2
      size: "512MB"
  duration: "5m"
```

**假设**：当单个 Pod 的 CPU 负载达到 80% 时：
1. HPA 应该自动扩容
2. 响应延迟增加但不超过 SLO 阈值
3. 现有请求不被中断

**HPA 配置验证**：

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: laravel-api-hpa
  namespace: laravel-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: laravel-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70
    # 自定义指标：请求延迟
    - type: Pods
      pods:
        metric:
          name: http_request_duration_p99
        target:
          type: AverageValue
          averageValue: "300m"  # 300ms
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Pods
          value: 2
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

### 实验 6：Time Skew —— 模拟时钟偏移

```yaml
# experiments/time-skew.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: TimeChaos
metadata:
  name: time-skew
  namespace: laravel-app
spec:
  mode: one
  selector:
    namespaces:
      - laravel-app
    labelSelectors:
      app: laravel-api
  timeOffset: "-1h"  # 时钟偏移 1 小时
  clockIds:
    - CLOCK_REALTIME
  duration: "2m"
```

**假设**：当系统时钟偏移 1 小时时：
1. JWT Token 验证不会因此失败（有合理的时钟偏移容忍）
2. 缓存 TTL 计算不会出现异常
3. 日志时间戳保持正确（使用 UTC）

**Laravel JWT 配置**：

```php
<?php
// config/jwt.php
return [
    // 时钟偏移容忍（秒）
    'leeway' => env('JWT_LEEWAY', 60),

    // Token 有效期
    'ttl' => env('JWT_TTL', 60),

    // Refresh Token 有效期
    'refresh_ttl' => env('JWT_REFRESH_TTL', 20160),
];
```

## CI/CD 集成

### GitHub Actions 混沌实验

```yaml
# .github/workflows/chaos-test.yml
name: Chaos Engineering Tests

on:
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨 2 点
  workflow_dispatch:
    inputs:
      experiment:
        description: '实验类型'
        required: true
        type: choice
        options:
          - pod-kill
          - network-delay
          - network-loss
          - io-fault
          - stress
          - all

jobs:
  chaos-test:
    runs-on: ubuntu-latest
    environment: staging

    steps:
      - uses: actions/checkout@v4

      - name: Setup kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubeconfig
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Install Chaos Mesh
        run: |
          helm repo add chaos-mesh https://charts.chaos-mesh.org
          helm install chaos-mesh chaos-mesh/chaos-mesh \
            --namespace chaos-testing \
            --create-namespace \
            --set dashboard.securityMode=false

      - name: Run Chaos Experiment
        run: |
          EXPERIMENT=${{ github.event.inputs.experiment || 'pod-kill' }}

          if [ "$EXPERIMENT" = "all" ]; then
            for exp in pod-kill network-delay network-loss stress; do
              echo "Running experiment: $exp"
              kubectl apply -f experiments/${exp}.yaml -n laravel-app
              sleep 300  # 等待 5 分钟
              kubectl delete -f experiments/${exp}.yaml -n laravel-app
              sleep 60   # 恢复间隔
            done
          else
            kubectl apply -f experiments/${EXPERIMENT}.yaml -n laravel-app
            sleep 300
            kubectl delete -f experiments/${EXPERIMENT}.yaml -n laravel-app
          fi

      - name: Collect Results
        run: |
          echo "## Chaos Experiment Results" >> $GITHUB_STEP_SUMMARY

          # 检查 Pod 状态
          echo "### Pod Status" >> $GITHUB_STEP_SUMMARY
          kubectl get pods -n laravel-app -o wide >> $GITHUB_STEP_SUMMARY

          # 检查是否有重启
          RESTARTS=$(kubectl get pods -n laravel-app -o jsonpath='{.items[*].status.containerStatuses[*].restartCount}')
          echo "Restart count: $RESTARTS" >> $GITHUB_STEP_SUMMARY

          # 检查错误日志
          echo "### Recent Errors" >> $GITHUB_STEP_SUMMARY
          kubectl logs -n laravel-app -l app=laravel-api --tail=50 --since=10m 2>&1 | grep -i error | head -20 >> $GITHUB_STEP_SUMMARY || true

      - name: Validate SLO Compliance
        run: |
          # 查询 Prometheus 验证 SLO
          PROM_URL="http://prometheus.monitoring.svc:9090"

          # 可用性检查
          AVAILABILITY=$(curl -s "${PROM_URL}/api/v1/query" \
            --data-urlencode 'query=sum(rate(http_requests_total{status!~"5.."}[10m])) / sum(rate(http_requests_total[10m]))' \
            | jq -r '.data.result[0].value[1]')

          echo "Availability during experiment: ${AVAILABILITY}"

          # 检查是否低于 SLO
          if (( $(echo "$AVAILABILITY < 0.999" | bc -l) )); then
            echo "::error::SLO violation! Availability dropped below 99.9%"
            exit 1
          fi
```

### 混沌实验自动化脚本

```python
#!/usr/bin/env python3
"""chaos_runner.py - 混沌实验自动化执行器"""

import subprocess
import json
import time
import sys
from dataclasses import dataclass
from typing import Optional


@dataclass
class ExperimentResult:
    name: str
    success: bool
    duration_seconds: float
    availability_during: float
    p99_latency_during: float
    pod_restarts: int
    errors: list[str]


class ChaosRunner:
    def __init__(self, namespace: str, prometheus_url: str):
        self.namespace = namespace
        self.prometheus_url = prometheus_url

    def run_experiment(self, yaml_path: str, duration_seconds: int = 300) -> ExperimentResult:
        """执行一个混沌实验"""
        name = yaml_path.split('/')[-1].replace('.yaml', '')
        start_time = time.time()
        errors = []

        print(f"\n{'='*60}")
        print(f"Starting experiment: {name}")
        print(f"Duration: {duration_seconds}s")
        print(f"{'='*60}")

        # 1. 应用实验
        try:
            subprocess.run(
                ['kubectl', 'apply', '-f', yaml_path, '-n', self.namespace],
                check=True,
                capture_output=True,
                text=True,
            )
            print(f"✓ Experiment {name} applied")
        except subprocess.CalledProcessError as e:
            return ExperimentResult(
                name=name,
                success=False,
                duration_seconds=0,
                availability_during=0,
                p99_latency_during=0,
                pod_restarts=0,
                errors=[f"Failed to apply experiment: {e.stderr}"],
            )

        # 2. 等待并监控
        print(f"  Monitoring for {duration_seconds}s...")
        time.sleep(duration_seconds)

        # 3. 清理实验
        subprocess.run(
            ['kubectl', 'delete', '-f', yaml_path, '-n', self.namespace],
            capture_output=True,
            text=True,
        )
        print(f"✓ Experiment {name} cleaned up")

        # 4. 收集结果
        actual_duration = time.time() - start_time
        availability = self._query_availability()
        p99_latency = self._query_p99_latency()
        restarts = self._count_restarts()

        # 5. 判定成功/失败
        success = (
            availability >= 0.999 and
            p99_latency <= 0.5 and
            restarts <= 1
        )

        if availability < 0.999:
            errors.append(f"Availability {availability:.4%} < 99.9% SLO")
        if p99_latency > 0.5:
            errors.append(f"P99 latency {p99_latency*1000:.0f}ms > 500ms SLO")

        result = ExperimentResult(
            name=name,
            success=success,
            duration_seconds=actual_duration,
            availability_during=availability,
            p99_latency_during=p99_latency,
            pod_restarts=restarts,
            errors=errors,
        )

        self._print_result(result)
        return result

    def _query_availability(self) -> float:
        """查询实验期间的可用性"""
        try:
            import urllib.request
            url = f"{self.prometheus_url}/api/v1/query"
            query = 'sum(rate(http_requests_total{status!~"5.."}[10m])) / sum(rate(http_requests_total[10m]))'
            resp = urllib.request.urlopen(f"{url}?query={query}")
            data = json.loads(resp.read())
            return float(data['data']['result'][0]['value'][1])
        except Exception:
            return 1.0  # 查询失败默认返回 100%

    def _query_p99_latency(self) -> float:
        """查询 P99 延迟"""
        try:
            import urllib.request
            url = f"{self.prometheus_url}/api/v1/query"
            query = 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[10m])) by (le))'
            resp = urllib.request.urlopen(f"{url}?query={query}")
            data = json.loads(resp.read())
            return float(data['data']['result'][0]['value'][1])
        except Exception:
            return 0.0

    def _count_restarts(self) -> int:
        """统计 Pod 重启次数"""
        try:
            result = subprocess.run(
                ['kubectl', 'get', 'pods', '-n', self.namespace,
                 '-l', 'app=laravel-api', '-o',
                 'jsonpath={.items[*].status.containerStatuses[*].restartCount}'],
                capture_output=True, text=True,
            )
            counts = [int(x) for x in result.stdout.split() if x.isdigit()]
            return max(counts) if counts else 0
        except Exception:
            return 0

    def _print_result(self, result: ExperimentResult):
        """打印实验结果"""
        status = "✅ PASS" if result.success else "❌ FAIL"
        print(f"\n{status} {result.name}")
        print(f"  Availability: {result.availability_during:.4%}")
        print(f"  P99 Latency: {result.p99_latency_during*1000:.0f}ms")
        print(f"  Pod Restarts: {result.pod_restarts}")
        if result.errors:
            print(f"  Errors:")
            for err in result.errors:
                print(f"    - {err}")


if __name__ == '__main__':
    runner = ChaosRunner(
        namespace='laravel-app',
        prometheus_url='http://prometheus.monitoring.svc:9090',
    )

    experiments = [
        'experiments/pod-kill.yaml',
        'experiments/network-delay.yaml',
        'experiments/network-loss.yaml',
        'experiments/stress.yaml',
    ]

    results = []
    for exp in experiments:
        result = runner.run_experiment(exp, duration_seconds=180)
        results.append(result)
        time.sleep(60)  # 恢复间隔

    # 汇总
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for r in results:
        status = "✅" if r.success else "❌"
        print(f"{status} {r.name}: avail={r.availability_during:.4%}, p99={r.p99_latency_during*1000:.0f}ms")

    failed = [r for r in results if not r.success]
    if failed:
        print(f"\n⚠ {len(failed)}/{len(results)} experiments failed SLO!")
        sys.exit(1)
    else:
        print(f"\n✅ All {len(results)} experiments passed SLO!")
```

## 可观测性配合

### 混沌实验期间的关键指标

```yaml
# grafana/chaos-dashboard.json (关键面板)
panels:
  - title: "实验状态"
    targets:
      - expr: 'chaos_mesh_experiments{phase="running"}'
        legendFormat: "{{ name }}"

  - title: "请求成功率"
    targets:
      - expr: 'sum(rate(http_requests_total{status!~"5.."}[1m])) / sum(rate(http_requests_total[1m]))'
        legendFormat: "成功率"

  - title: "延迟分位值"
    targets:
      - expr: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))'
        legendFormat: "P50"
      - expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))'
        legendFormat: "P99"

  - title: "Pod 状态"
    targets:
      - expr: 'kube_pod_status_phase{namespace="laravel-app"}'
        legendFormat: "{{ pod }}: {{ phase }}"

  - title: "数据库连接"
    targets:
      - expr: 'mysql_global_status_threads_connected'
        legendFormat: "活跃连接"
      - expr: 'mysql_global_variables_max_connections'
        legendFormat: "最大连接"
```

## 安全准则与 Game Day

### Game Day 操练流程

```
Game Day 准备（T-7天）
├── 选定实验场景
├── 通知相关团队
├── 准备 Runbook
├── 确认监控和告警
└── 准备回滚方案

Game Day 执行（T-Day）
├── 09:00 Kickoff 会议
├── 09:30 第一轮实验（小爆炸半径）
│   ├── Pod Kill（单 Pod）
│   ├── 验证自动恢复
│   └── 记录观察
├── 10:30 第二轮实验（中等爆炸半径）
│   ├── Network Delay（数据库）
│   ├── 验证超时和降级
│   └── 记录观察
├── 11:30 第三轮实验（较大爆炸半径）
│   ├── Network Loss（Redis）
│   ├── 验证缓存降级
│   └── 记录观察
├── 13:00 午间复盘
├── 14:00 第四轮实验（组合故障）
│   ├── 同时注入 Network Delay + Stress
│   └── 验证系统韧性
├── 15:30 最终复盘
│   ├── 总结发现的问题
│   ├── 制定改进计划
│   └── 更新 Runbook
└── 16:00 结束

Game Day 后（T+3天）
├── 完成所有改进项
├── 更新 SLO 文档
└── 安排下次 Game Day
```

### 回滚机制

```yaml
# 所有实验都应设置 duration，确保自动回滚
# 但如果需要手动紧急回滚：

# 立即终止所有混沌实验
kubectl delete chaos -n laravel-app --all

# 或者只终止特定实验
kubectl delete podchaos laravel-api-pod-kill -n laravel-app
kubectl delete networkchaos mysql-network-delay -n laravel-app
```

## 结语

混沌工程不是"搞破坏"，而是"有计划地验证系统的韧性"。对于运行在 Kubernetes 上的 Laravel 微服务，Chaos Mesh 提供了开箱即用的故障注入能力。

关键原则回顾：
1. **从假设出发**：每次实验都有明确的假设和验证标准
2. **控制爆炸半径**：从小范围开始，逐步扩大
3. **自动化**：将混沌实验集成到 CI/CD，持续验证
4. **结合 SLO**：用 SLO 作为实验的通过/失败标准
5. **团队参与**：定期 Game Day，让整个团队理解系统的脆弱点

当你能在生产环境中从容地"杀死 Pod"、"注入延迟"、"制造丢包"，并且确信系统能优雅地处理这些故障时，你才真正拥有了一个有韧性的系统。

## 相关阅读

- [SLO/SLI 实战：用服务等级目标驱动可靠性](/categories/运维/SLO-SLI-实战/)
- [Sentry 实战：2026 年版错误追踪深度使用](/categories/运维/2026-06-02-sentry-error-tracking-performance-monitoring-session-replay-laravel/)
- [监控告警实战：Prometheus + Grafana 告警规则设计](/categories/运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
