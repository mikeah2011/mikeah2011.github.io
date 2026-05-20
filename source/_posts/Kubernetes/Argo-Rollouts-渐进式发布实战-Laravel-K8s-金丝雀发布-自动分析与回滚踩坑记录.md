---
title: Argo Rollouts 渐进式发布实战：Laravel 在 K8s 上的金丝雀发布、自动分析与回滚踩坑记录
date: 2026-05-04 15:11:34
updated: 2026-05-04 15:12:57
categories:
  - Kubernetes
  - Laravel
  - DevOps
tags: [CI/CD, Kubernetes, Laravel, 监控]description: 基于 Laravel API 在 Kubernetes 上的真实发布治理经验，记录如何用 Argo Rollouts 落地金丝雀发布、Prometheus 自动分析与失败回滚，重点解决迁移兼容、探针误判、流量切分失真与发布中断的生产踩坑。
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

## 七、这套方案什么时候值得上

如果你的 Laravel 服务还是单机、低频发布，Argo Rollouts 可能太重；但只要你已经进入 **K8s、多副本、每天多次发版、并且事故大多出在“版本上线后的 5 到 10 分钟”** 这个阶段，它就很值。因为它解决的不是部署成功，而是**发布风险被量化和自动收敛**。

我现在对 Laravel on K8s 的发布有一个很明确的判断：**Deployment 解决的是“把新版本跑起来”，Argo Rollouts 解决的是“敢不敢让更多真实用户打到它”**。对线上系统来说，后者才是真正难的部分。
