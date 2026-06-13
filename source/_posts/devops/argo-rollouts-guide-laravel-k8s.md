---
title: Argo Rollouts 渐进式发布实战：Laravel 在 K8s 上的金丝雀发布、自动分析与回滚踩坑记录
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-04 15:11:34
updated: 2026-05-04 15:12:57
categories:
  - devops
  - kubernetes
tags: [CI/CD, Kubernetes, Laravel, 监控, Argo Rollouts, 渐进式发布]
keywords: [Argo Rollouts, Laravel, K8s, 渐进式发布实战, 上的金丝雀发布, 自动分析与回滚踩坑记录, DevOps]
description: 基于 Laravel B2C API 在 Kubernetes 集群上的真实发布治理经验，深入记录如何用 Argo Rollouts 落地金丝雀发布与蓝绿发布策略。涵盖完整 Rollout CRD 配置、Prometheus AnalysisTemplate 自动分析、流量切分原理与权重失真排查、Laravel 就绪探针设计、数据库迁移兼容规则、preStop 优雅终止以及 CI/CD 流水线集成。同时对比金丝雀与蓝绿发布适用场景，提供探针误判、流量切分失真、慢请求被中断等生产踩坑的完整解决方案，帮助团队把发布从一次性切换升级为带度量、可暂停、可自动回滚的受控过程。



---

我们把 Laravel API 跑上 Kubernetes 之后，最早的发布方式很朴素：`kubectl set image`，看 Pod 都 Ready 了就算完成。问题是这种“滚动更新成功”，只代表容器活着，不代表业务安全。一次支付链路改造里，新版本把优惠券查询从同步 SQL 改成了聚合表读取，Pod 启来很快，但上线 3 分钟后 P95 飙到 1.8s，错误率也被 Redis 超时拉高。Deployment 还在继续滚，等我们人工回退时，坏版本已经吃掉了大半流量。

后来我把发布切成两层：**GitHub Actions 负责交付，Argo Rollouts 负责放量决策**。真正有价值的不是“能金丝雀”，而是**把发布从一次性切换，改成带度量、可暂停、可自动回滚的过程**。

## 一、最终架构

```text
GitHub Actions
      |
      v
kubectl apply Rollout / AnalysisTemplate
      |
      v
+---------------------------+
| Argo Rollouts Controller  |
+------------+--------------+
             |
   +---------+---------+
   |                   |
   v                   v
stable Service     canary Service
   |                   |
   +---------+---------+
             v
      Laravel API Pods
             |
   +---------+------------------+
   |                            |
   v                            v
Prometheus                 MySQL / Redis / gRPC
(success rate / P95)       真实业务依赖
```

这里我保留 `stable` 和 `canary` 两个 Service，不直接把“新旧 Pod 混在一个 Service 里盲切”。原因很现实：排查时我要能立刻知道 5xx 是哪一批 Pod 打出来的，Prometheus 也要能按版本维度拆指标。

## 二、Rollout 不是 Deployment 换皮，关键是放量步骤和分析门禁

我最后线上固定下来的 Rollout，大概是这个结构：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: laravel-api
spec:
  replicas: 8
  strategy:
    canary:
      canaryService: laravel-api-canary
      stableService: laravel-api-stable
      trafficRouting:
        nginx:
          stableIngress: laravel-api-ingress
      steps:
        - setWeight: 10
        - pause: { duration: 180 }
        - analysis:
            templates:
              - templateName: laravel-api-health
        - setWeight: 30
        - pause: { duration: 300 }
        - setWeight: 60
        - pause: { duration: 300 }
  selector:
    matchLabels:
      app: laravel-api
  template:
    metadata:
      labels:
        app: laravel-api
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: ghcr.io/mike/laravel-api:latest
          ports:
            - containerPort: 8000
          readinessProbe:
            httpGet:
              path: /internal/health/ready
              port: 8000
            periodSeconds: 5
```

这份配置里，`pause + analysis` 比权重更重要。很多团队只写 `10 -> 30 -> 60 -> 100`，其实那只是“分段放量”，不是“受控发布”。真正的门禁必须绑定指标。

## 三、Prometheus 自动分析我只盯两个指标：成功率和 P95

发布阶段指标不能贪多。线上我最后只留下两项：**5 分钟成功率**、**P95 延迟**。因为这两个指标最能快速反映 Laravel API 是否把下游拖崩。

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: laravel-api-health
spec:
  metrics:
    - name: success-rate
      interval: 60s
      successCondition: result[0] >= 0.995
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            sum(rate(http_requests_total{app="laravel-api",status!~"5.."}[5m]))
            /
            sum(rate(http_requests_total{app="laravel-api"}[5m]))
    - name: p95-latency
      interval: 60s
      successCondition: result[0] <= 0.8
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            histogram_quantile(0.95,
              sum(rate(http_request_duration_seconds_bucket{app="laravel-api"}[5m])) by (le)
            )
```

指标阈值别照抄压测报告。我踩过的坑是，把成功率门槛直接设成 `99.9%`，结果流量还没放大，偶发的第三方超时就让发布一直中断。后面我改成：**以现网稳定区间为基线，再给 canary 留一点噪音空间**，这样自动回滚才不会变成自动添乱。

## 四、Laravel 侧一定要有“真实就绪”探针

如果就绪探针只返回 `200 OK`，Argo Rollouts 会被你骗得很惨。我的做法是把数据库、Redis 和关键配置都纳入 readiness，至少保证新 Pod 不是“容器活着但业务没准备好”。

```php
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Route;

Route::get('/internal/health/ready', function () {
    DB::select('select 1');
    Redis::connection()->ping();

    if (!config('app.key')) {
        abort(500, 'app key missing');
    }

    return response()->json(['ok' => true]);
});
```

这段代码不复杂，但非常关键。以前我们把 `config:cache` 做进镜像，新版本少了一个环境变量，应用能启动、路由也能回 200，只有业务请求进来才会炸。换成真实 readiness 后，这类问题会在放量前被挡住。

## 五、发布流水线只做“提交版本”，不要在 CI 里手工 sleep 等结果

GitHub Actions 里我只负责更新镜像标签并 apply，发布节奏交给 Rollouts Controller：

```yaml
- name: Render rollout image
  run: |
    kustomize edit set image ghcr.io/mike/laravel-api=${{ github.sha }}

- name: Apply rollout
  run: |
    kubectl apply -k deploy/overlays/prod
    kubectl argo rollouts get rollout laravel-api --watch --timeout 900s
```

这里最忌讳的是在 CI 里自己写一堆 `sleep 60`、`kubectl get pods`。那套逻辑既看不到分析结果，也处理不了暂停、继续、回滚状态。既然已经用了 Argo Rollouts，就让控制器做它该做的事。

## 六、我实际踩过的三个坑

### 坑一：数据库迁移不兼容，回滚成功但业务仍然挂

最危险的一次不是 Rollout 失败，而是 **Rollout 成功回滚了，数据库却已经被新代码改坏了兼容性**。后来我把规则定死：发布期只允许**向后兼容迁移**，删字段、改含义、改默认值这种动作必须拆到后续版本。

### 坑二：Nginx 权重切分看起来是 10%，真实请求远不止

如果前面还有 CDN、长连接或客户端重试，`10% canary` 不一定等于业务侧真只有 10%。我后面会同时看 canary Pod 的实际 RPS，而不是只信 Ingress 配置。**权重是意图，不是结果。**

### 坑三：旧 Pod 被切流后立刻杀掉，Laravel 还没处理完慢请求

支付、报表导出这类慢接口很容易中招。后面我补了 `preStop`、拉长 `terminationGracePeriodSeconds`，并确保应用收到 SIGTERM 后不再接新流量，只把手上的请求做完，不然 canary 没问题，反而是下线中的 stable 在制造 499/502。

具体配置如下：

```yaml
spec:
  terminationGracePeriodSeconds: 90
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            # Nginx: 标记不再接受新连接，等待存量请求处理完
            command: ["/bin/sh", "-c", "nginx -s quit && sleep 30"]
      # Laravel Octane / Swoole 场景需要额外处理
      env:
        - name: LARAVEL_SHUTDOWN_GRACEFUL
          value: "true"
```

在 Laravel Octane 场景中，还需要监听 `SIGTERM` 信号并拒绝新请求：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\Signal;

public function boot(): void
{
    Signal::whenReceived('SIGTERM', function () {
        // 标记当前进程进入排水状态，不再从队列拉取新任务
        cache()->put('shutting_down', true, now()->addSeconds(90));
    });
}
```

## 七、金丝雀发布 vs 蓝绿发布：我为什么最终选了金丝雀

| 维度 | 金丝雀发布 | 蓝绿发布 |
|------|-----------|---------|
| **流量切换** | 渐进式，按百分比逐步放量 | 一次性全量切换 |
| **资源消耗** | 低，只需额外运行少量 canary Pod | 高，需要维护完整的两套环境 |
| **回滚速度** | 快，直接把权重归零即可 | 极快，把 Service 指回旧环境 |
| **风险控制** | 强，每一步都有分析门禁 | 弱，全量切换后才能发现问题 |
| **适用场景** | 多副本 K8s 部署、API 服务 | 数据库无变化的无状态前端 |
| **Argo Rollouts 支持** | 原生 canary strategy | 原生 blueGreen strategy |
| **对数据库迁移的要求** | 必须向后兼容 | 通常要求零停机迁移 |

我在 Laravel API 场景选择金丝雀的核心原因：**蓝绿发布需要两套完整的环境和数据库兼容，而 Laravel 的 Eloquent 迁移经常涉及字段变更，两套环境共用数据库时蓝绿切流并不能隔离数据库层面的风险**。金丝雀发布配合 Prometheus 分析，能把"发现问题"的时间从全量上线后缩短到 10% 流量阶段。

如果一定要用蓝绿，Argo Rollouts 也支持，配置如下：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: laravel-api-bluegreen
spec:
  replicas: 8
  strategy:
    blueGreen:
      activeService: laravel-api-active
      previewService: laravel-api-preview
      autoPromotionEnabled: false       # 由分析结果决定是否切换
      prePromotionAnalysis:             # 切换前执行分析
        templates:
          - templateName: laravel-api-health
      scaleDownDelaySeconds: 300        # 旧版本保留 5 分钟用于快速回滚
  selector:
    matchLabels:
      app: laravel-api
  template:
    metadata:
      labels:
        app: laravel-api
    spec:
      containers:
        - name: app
          image: ghcr.io/mike/laravel-api:latest
```

## 八、完整 Rollout CRD 参考：从镜像到生产全配置

线上我最终使用的完整配置，包含 Pod 反亲和、资源限制和优雅终止：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: laravel-api
  namespace: production
  annotations:
    argocd.argoproj.io/sync-wave: "10"
spec:
  replicas: 8
  revisionHistoryLimit: 5                # 保留最近 5 个版本用于快速回滚
  strategy:
    canary:
      canaryService: laravel-api-canary
      stableService: laravel-api-stable
      trafficRouting:
        nginx:
          stableIngress: laravel-api-ingress
          additionalIngressAnnotations:   # 按 Header 切流，方便内部测试
            canary-by-header: X-Canary
            canary-by-header-value: "true"
      maxSurge: "25%"                     # 最多多出 25% 的 Pod
      maxUnavailable: 0                   # 零不可用
      analysis:
        templates:
          - templateName: laravel-api-health
        startingStep: 2                   # 从第 3 步开始跑分析
        args:
          - name: service-name
            value: laravel-api-canary
      steps:
        - setWeight: 5                    # 第一阶段：5% 流量
        - pause: { duration: 120 }        # 观察 2 分钟
        - setWeight: 10                   # 第二阶段：10%
        - pause: { duration: 300 }        # 观察 5 分钟，分析在后台运行
        - setWeight: 30                   # 第三阶段：30%
        - pause: { duration: 300 }
        - setWeight: 60                   # 第四阶段：60%
        - pause: { duration: 300 }
        - setWeight: 100                  # 全量发布
  selector:
    matchLabels:
      app: laravel-api
  template:
    metadata:
      labels:
        app: laravel-api
        version: canary
    spec:
      terminationGracePeriodSeconds: 90
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: laravel-api
                topologyKey: kubernetes.io/hostname
      containers:
        - name: app
          image: ghcr.io/mike/laravel-api:latest
          ports:
            - containerPort: 8000
              name: http
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 1000m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /internal/health/ready
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /internal/health/live
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 5
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "nginx -s quit && sleep 30"]
```

关键字段说明：
- `revisionHistoryLimit: 5`：保留历史版本的 ReplicaSet，回滚时无需重新拉镜像
- `startingStep: 2`：分析从第 2 步开始跑，避免在只有 5% 流量时因样本不足误判
- `canary-by-header`：支持通过 Header 把特定用户的请求打到 canary，方便 QA 验证

## 九、回滚策略详解：自动回滚、手动回滚和 GitOps 回滚

### 9.1 自动回滚（AnalysisTemplate 驱动）

当 AnalysisRun 中任一指标 `failureCondition` 触发时，Argo Rollouts 会自动把权重归零：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: laravel-api-health
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      count: 5                             # 连续采样 5 次
      interval: 60s
      failureLimit: 2                      # 允许失败 2 次，第 3 次触发回滚
      successCondition: result[0] >= 0.995
      failureCondition: result[0] < 0.98   # 低于 98% 立即回滚
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            sum(rate(http_requests_total{app="laravel-api",service="{{args.service-name}}",status!~"5.."}[5m]))
            /
            sum(rate(http_requests_total{app="laravel-api",service="{{args.service-name}}"}[5m]))
    - name: p95-latency
      count: 5
      interval: 60s
      failureLimit: 1
      successCondition: result[0] <= 0.8
      failureCondition: result[0] >= 1.5    # P95 超过 1.5s 直接回滚
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            histogram_quantile(0.95,
              sum(rate(http_request_duration_seconds_bucket{app="laravel-api",service="{{args.service-name}}"}[5m])) by (le)
            )
```

### 9.2 手动回滚（kubectl argo rollouts）

```bash
# 查看当前发布状态
kubectl argo rollouts get rollout laravel-api

# 手动中断发布并回滚到上一个稳定版本
kubectl argo rollouts abort laravel-api

# 强制回滚到指定版本
kubectl argo rollouts undo laravel-api --to-revision=3

# 恢复暂停状态继续发布
kubectl argo rollouts promote laravel-api
```

### 9.3 GitOps 回滚（配合 ArgoCD）

如果用 ArgoCD 管理，回滚最安全的方式是 revert Git commit：

```bash
# 找到上一个稳定的 Git commit
git log --oneline -10

# Revert 到上一个版本
git revert HEAD
git push origin main

# ArgoCD 会自动同步，Argo Rollouts 检测到镜像变更后触发新的 Rollout
```

## 十、踩坑案例补充：探针误判与流量切分失真

### 坑四：readinessProbe 误判——Pod Ready 但 PHP-FPM 还没启动完

Laravel 的 `php artisan serve` 或 PHP-FPM 启动时，HTTP 端口可能已经打开但 worker 还没就绪。Nginx 返回 200，但 FastCGI 连接被拒绝，导致 502。

**根因**：readinessProbe 只检查了 Nginx 端口，没检查 PHP-FPM 状态。

**解决方案**：在 Nginx 配置中添加 PHP-FPM 健康检查端点：

```nginx
# /etc/nginx/conf.d/health.conf
location = /fpm-status {
    fastcgi_pass unix:/run/php/php-fpm.sock;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    allow 127.0.0.1;
    deny all;
}
```

然后把 readinessProbe 改为检查一个同时验证 Nginx 和 FPM 的端点：

```php
Route::get('/internal/health/ready', function () {
    // 1. 检查数据库
    DB::select('SELECT 1');

    // 2. 检查 Redis
    Redis::connection()->ping();

    // 3. 检查 app key
    if (!config('app.key')) {
        abort(500, 'app key missing');
    }

    // 4. 检查队列连接（如果用了队列）
    try {
        Queue::connection('redis')->size('default');
    } catch (\Exception $e) {
        abort(500, 'queue connection failed: ' . $e->getMessage());
    }

    return response()->json([
        'ok' => true,
        'version' => config('app.version'),
        'timestamp' => now()->toIso8601String(),
    ]);
});
```

### 坑五：Nginx Ingress 权重切分失真——10% canary 实际承载了 30% 流量

**现象**：设置 `setWeight: 10` 后，Prometheus 监控显示 canary Pod 的 RPS 远超预期。

**根因分析**：
1. Nginx Ingress Controller 使用 `split_clients` 做权重分配，基于客户端 IP hash
2. 如果有少量大流量客户端（爬虫、内部压测），它们的 hash 值稳定落在 canary 区间
3. CDN 层的连接复用放大了单客户端的流量权重

**解决方案**：在分析时使用 Pod 实际 RPS 而非 Ingress 配置权重：

```yaml
# 分析模板中增加 RPS 偏差检查
- name: canary-rps-ratio
  count: 5
  interval: 60s
  successCondition: result[0] <= 0.15     # canary RPS 不超过总量的 15%
  failureCondition: result[0] >= 0.25     # 超过 25% 说明权重严重失真
  provider:
    prometheus:
      address: http://prometheus.monitoring.svc:9090
      query: |
        sum(rate(http_requests_total{app="laravel-api",service="laravel-api-canary"}[5m]))
        /
        sum(rate(http_requests_total{app="laravel-api"}[5m]))
```

同时建议在 Nginx Ingress 中开启 `nginx.ingress.kubernetes.io/canary-by-header`，让内部测试流量绕过权重分配：

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
    nginx.ingress.kubernetes.io/canary-by-header: "X-Canary-Override"
```

### 坑六：AnalysisRun 因 Prometheus 查询超时导致误回滚

**现象**：发布过程中 AnalysisRun 状态变为 `Error`，Rollout 自动回滚，但实际业务指标完全正常。

**根因**：Prometheus 在高负载时查询响应超过默认 10s 超时，AnalysisRun 将超时视为失败。

**解决方案**：在 AnalysisTemplate 中设置合理的超时和重试：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: laravel-api-health
spec:
  metrics:
    - name: success-rate
      interval: 60s
      count: 5
      # 关键：允许连续失败 3 次再触发回滚，避免偶发超时误判
      failureLimit: 3
      # 关键：连续成功 2 次即认为通过，不必等满 5 次
      inconclusiveLimit: 2
      successCondition: result[0] >= 0.995
      failureCondition: result[0] < 0.98
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          # 设置查询超时为 30s
          timeout: 30
          query: |
            sum(rate(http_requests_total{app="laravel-api",status!~"5.."}[5m]))
            /
            sum(rate(http_requests_total{app="laravel-api"}[5m]))
```

## 十一、这套方案什么时候值得上

如果你的 Laravel 服务还是单机、低频发布，Argo Rollouts 可能太重；但只要你已经进入 **K8s、多副本、每天多次发版、并且事故大多出在“版本上线后的 5 到 10 分钟”** 这个阶段，它就很值。因为它解决的不是部署成功，而是**发布风险被量化和自动收敛**。

我现在对 Laravel on K8s 的发布有一个很明确的判断：**Deployment 解决的是"把新版本跑起来"，Argo Rollouts 解决的是"敢不敢让更多真实用户打到它"**。对线上系统来说，后者才是真正难的部分。

## 相关阅读

- [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录](/DevOps/argocd-gitops-guide-laravel-cd/)
- [K8s HPA/VPA 自动扩缩容实战：Laravel API 从 CPU 误判到自定义指标扩容踩坑记录](/DevOps/k8s-hpa-vpa-guide-laravel-api-cpu/)
- [Istio 服务网格实战：Laravel 在 K8s 上的超时、重试、灰度发布与 mTLS 踩坑记录](/DevOps/istio-guide-laravel-k8s-canary-mtls/)
