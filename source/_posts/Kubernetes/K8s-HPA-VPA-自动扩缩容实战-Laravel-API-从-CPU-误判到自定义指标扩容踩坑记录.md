---
title: K8s HPA/VPA 自动扩缩容实战：Laravel API 从 CPU 误判到自定义指标扩容踩坑记录
date: 2026-05-03 08:35:00
categories:
  - Kubernetes
  - Laravel
  - 架构
tags: [Kubernetes, Laravel, 监控]
description: 结合 Laravel B2C API 在 Kubernetes 上的真实压测与生产经验，记录一套 HPA + VPA 落地方案，重点解决 CPU 指标失真、扩容抖动、资源请求不准与队列任务被错误伸缩的问题。
---

我们最早在 Kubernetes 上跑 Laravel API 时，扩缩容策略其实很“教科书”：`requests.cpu=500m`、HPA 按 CPU 70% 扩容、每个 Pod 512Mi 内存。结果压测一上来就翻车：接口 P95 已经接近 2 秒，但 CPU 只跑到 38%；另一边队列 Worker 明明 CPU 不高，却不断被 OOMKilled。

问题后来才看清：**PHP 类服务不一定是 CPU 型瓶颈**。当请求时间花在 MySQL、Redis、第三方 API 或 PHP-FPM 进程阻塞上时，只盯 CPU，HPA 会“看不见”真正的压力。

这篇只讲我最后在 Laravel B2C API 上落地的一套方案：**API 用 HPA 做横向扩容，VPA 先做资源建议；队列型 Pod 单独建策略，不跟 API 混用。**

## 一、最终架构

```text
                      +-----------------------+
                      |  Ingress / Nginx LB   |
                      +-----------+-----------+
                                  |
                                  v
                    +-----------------------------+
                    |   Laravel API Deployment    |
                    |   php-fpm / nginx / app     |
                    +-------------+---------------+
                                  |
             +--------------------+--------------------+
             |                                         |
             v                                         v
   Metrics Server                              Prometheus + Adapter
   CPU / Memory                                自定义 Pod 指标
             |                                         |
             +--------------------+--------------------+
                                  v
                         HPA (autoscaling/v2)
                      CPU + php-fpm active process

                    VPA(recommendation only for API)
                        |
                        v
                 调整 requests/limits 基线

          Queue Worker Deployment --------------> 单独 HPA/VPA 策略
```

这里最关键的设计不是“把 HPA 和 VPA 都开起来”，而是：

1. **API Pod 不让 VPA 直接改 CPU/Memory 并实时重建**，先用 `Off` 模式看建议值。
2. **HPA 不只看 CPU**，还要接入更贴近 PHP 服务负载的指标。
3. **队列 Worker 单独处理**，不能直接复用 API 的扩容规则。

## 二、为什么 CPU HPA 在 Laravel 上经常误判

Laravel API 的慢，很多时候不是算力不够，而是：

- PHP-FPM 子进程被慢 SQL 卡住
- 调第三方支付或库存接口超时
- Redis 热 key 抖动导致等待变长
- 单 Pod `pm.max_children` 已满，请求开始排队

也就是说，请求变慢时，CPU 可能还很低，但 **Pod 已经没有可接单能力**。

我们后来把 Deployment 的资源基线先订正：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: b2c-api
spec:
  replicas: 4
  selector:
    matchLabels:
      app: b2c-api
  template:
    metadata:
      labels:
        app: b2c-api
    spec:
      containers:
        - name: app
          image: registry.example.com/b2c-api:2026.05.03
          ports:
            - containerPort: 9000
          resources:
            requests:
              cpu: "700m"
              memory: "768Mi"
            limits:
              cpu: "1500m"
              memory: "1536Mi"
          env:
            - name: PHP_FPM_PM_MAX_CHILDREN
              value: "24"
            - name: PHP_FPM_PM_MAX_REQUESTS
              value: "500"
```

这里有个很实际的经验：**如果 requests 设得太小，K8s 会以为你的 Pod 很“省”，结果节点塞太满，抖动时一起争抢 CPU。** 我们第一次把 `requests.cpu` 设成 200m，表面省资源，实际上高峰期 throttling 很明显。

## 三、HPA 不再只盯 CPU，而是看 CPU + Pod 并发压力

我们最后使用 `autoscaling/v2`，保留 CPU 指标，同时增加一个自定义 Pod 指标 `php_fpm_active_processes`。这个值来自 Prometheus Adapter，把每个 Pod 当前活跃 PHP-FPM 进程暴露给 HPA。

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: b2c-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: b2c-api
  minReplicas: 4
  maxReplicas: 18
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 20
          periodSeconds: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
    - type: Pods
      pods:
        metric:
          name: php_fpm_active_processes
        target:
          type: AverageValue
          averageValue: "18"
```

Prometheus Adapter 规则如下，这个配置是真能跑的：

```yaml
rules:
  default: false
  custom:
    - seriesQuery: 'php_fpm_active_processes{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace:
            resource: namespace
          pod:
            resource: pod
      name:
        matches: "php_fpm_active_processes"
        as: "php_fpm_active_processes"
      metricsQuery: 'avg_over_time(php_fpm_active_processes{<<.LabelMatchers>>}[2m])'
```

为了让指标有来源，我们在 Laravel 容器里暴露 Prometheus metrics。下面这个中间件会记录请求耗时，配合 exporter 一起看趋势：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Prometheus\CollectorRegistry;
use Symfony\Component\HttpFoundation\Response;

class RecordHttpMetrics
{
    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);

        /** @var Response $response */
        $response = $next($request);

        $duration = microtime(true) - $start;

        $histogram = app(CollectorRegistry::class)->getOrRegisterHistogram(
            'laravel',
            'http_request_duration_seconds',
            'Laravel request duration',
            ['method', 'route', 'status'],
            [0.05, 0.1, 0.3, 0.5, 1, 2, 5]
        );

        $histogram->observe($duration, [
            $request->getMethod(),
            $request->route()?->getName() ?? 'unknown',
            (string) $response->getStatusCode(),
        ]);

        return $response;
    }
}
```

如果你要拿到 `php_fpm_active_processes`，还得把 PHP-FPM status 页暴露出来。我们在线上不是直接把它开放给公网，而是只允许容器内或 Service 侧抓取：

```ini
; /usr/local/etc/php-fpm.d/www.conf
pm = dynamic
pm.max_children = 24
pm.start_servers = 6
pm.min_spare_servers = 4
pm.max_spare_servers = 10
pm.status_path = /fpm-status
ping.path = /fpm-ping
catch_workers_output = yes
```

Nginx 侧再把状态页限制到集群内部：

```nginx
location = /fpm-status {
    allow 10.0.0.0/8;
    deny all;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass 127.0.0.1:9000;
}
```

这一步看起来很小，但实际特别重要。我们第一次指标接错，把 `accepted conn` 当成并发压力，结果 HPA 看到的是累计计数，不是瞬时负载，副本数一度被错误放大。**扩容指标一定要能反映“当前饱和度”，而不是历史累计值。**

## 四、指标怎么选：不要让 HPA 追着噪音跑

我现在给 Laravel API 选扩容指标，会遵守两个标准：

1. 指标必须和“Pod 有没有余力继续接请求”强相关
2. 指标必须足够平滑，不能被 5 秒尖峰带着抖动

我们最后在 Grafana 和 Prometheus 里重点盯这几组：

- `rate(container_cpu_usage_seconds_total[2m])`
- `php_fpm_active_processes`
- `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`
- `kube_pod_container_status_restarts_total`

其中 P95 延迟我不会直接拿去做 HPA 指标，因为它受下游依赖影响太大，更适合做“是否调错扩容策略”的验证指标。真正参与扩容决策的，还是 CPU 和 PHP-FPM 活跃进程数这类离 Pod 饱和更近的数据。

一个我们实际用过的排查顺序是：

```text
P95 变差
  -> 看 php_fpm_active_processes 是否接近 pm.max_children
  -> 再看 CPU 是否被 throttling
  -> 再看 MySQL/Redis/第三方 API 延迟
  -> 最后才决定是扩 Pod、调 request，还是修慢依赖
```

## 五、VPA 在 API 上怎么用：先给建议，不直接接管

很多团队一上来就把 VPA 设成 `Auto`，结果白天业务高峰时触发 Pod 重建，等于你亲手制造一次抖动。我们的做法是：**API 只开 recommendation 模式，先观察 7 天再改 requests/limits。**

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: b2c-api-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: b2c-api
  updatePolicy:
    updateMode: Off
  resourcePolicy:
    containerPolicies:
      - containerName: app
        controlledResources: ["cpu", "memory"]
        minAllowed:
          cpu: "500m"
          memory: "512Mi"
        maxAllowed:
          cpu: "2"
          memory: "2Gi"
```

这一步帮我们修正了两个问题：

- 原本内存 `request` 偏低，节点调度太激进
- 某些批量导出接口会让单 Pod 瞬时 RSS 冲高，limit 太紧容易被杀

## 六、队列 Worker 不要套 API 的伸缩逻辑

Laravel Queue Worker 是另一类负载。它往往表现为：单任务执行长、内存增长慢、CPU 不稳定。我们最早也给 Worker 配了 CPU HPA，结果队列堆积 2 万条时几乎没扩容，因为 job 多数在等 IO。

后来改成两件事：

1. Worker 的副本数按队列深度扩容
2. Worker 的内存基线参考 VPA 建议，但避免频繁自动重建

如果你用 Redis 队列，至少要把 job timeout、memory limit 和优雅退出配好：

```php
<?php

return [
    'default' => env('QUEUE_CONNECTION', 'redis'),
    'connections' => [
        'redis' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => 180,
            'block_for' => 5,
        ],
    ],
];
```

如果扩容很快，但每个旧 Pod 都还在跑长任务，吞吐不一定立刻上来。所以 Worker 的问题，很多时候是**并发模型和任务拆分问题**，不是单纯多开几个 Pod 就能解决。

如果你的队列已经上 Kubernetes，我更建议直接按队列深度伸缩，而不是看 CPU。下面这个 `ScaledObject` 是我们验证过的一种思路，适合 Redis list 场景：

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: b2c-worker-scaler
spec:
  scaleTargetRef:
    name: b2c-worker
  minReplicaCount: 2
  maxReplicaCount: 20
  cooldownPeriod: 300
  triggers:
    - type: redis
      metadata:
        address: redis.default.svc.cluster.local:6379
        listName: queues:default
        listLength: "200"
```

这里也有坑：队列深度适合反映“积压”，但不一定反映“单任务成本”。如果一个 job 平均 300ms，和一个 job 平均 45 秒，扩容模型完全不同。所以我一般会把长任务拆队列，像发券、出票、回调补偿分开处理，不让短任务被长任务拖死。

## 七、发布前我会做的校验清单

自动扩缩容最怕“配置写对了，运行时却全错”。所以每次改 HPA/VPA，我都会在预发环境跑一遍下面这套检查：

- `kubectl top pod` 能看到 CPU / Memory，不然 Metrics Server 根本没通
- `kubectl describe hpa b2c-api` 能看到自定义指标正常返回，不是 `<unknown>`
- 压测时确认 `php_fpm_active_processes` 会随并发上升，而不是常年 0
- 发布窗口内观察至少 30 分钟，确认没有频繁 scale up / scale down
- 检查 PodDisruptionBudget，避免节点维护时和缩容叠加造成容量骤降

还有一个经常被忽略的小点：**readinessProbe 要比 livenessProbe 更保守**。因为新 Pod 刚起来时，Laravel 配置缓存、路由缓存、OPcache 预热还没稳定，如果 readiness 过早放量，HPA 虽然扩了 Pod，但新副本接流量后反而先抖一轮。

```yaml
readinessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

## 八、三次真实踩坑

### 坑 1：HPA 和 VPA 同时改 CPU request，副本数疯狂抖动

这是最常见的坑。HPA 计算利用率时依赖 `request`，如果 VPA 又在动态改 `request`，同一份 CPU 使用量会突然变成不同利用率，副本数就会跳来跳去。后来 API 侧改成 **HPA 管副本，VPA 只提建议**，问题就消失了。

### 坑 2：scaleDown 太激进，刚扩完就缩，缓存白热又打冷

一开始 `scaleDown` 没设稳定窗口，流量一回落就缩容。结果 Laravel 容器预热、OPcache、连接池、Nginx keepalive 都重新来一遍，反而把下一波流量打得更抖。后来把 `stabilizationWindowSeconds` 拉到 300 秒，曲线稳定很多。

### 坑 3：只看平均值，漏掉慢 Pod

平均 CPU 65% 看起来没问题，但其实常常是两个 Pod 很忙、两个 Pod 很闲。后来我们在 Grafana 上单独看 `php_fpm_active_processes by pod` 和 P95 latency，才发现是某些节点网络抖动，导致个别 Pod 排队严重。**自动扩缩容不是监控替代品，反而更依赖细粒度监控。**

## 九、落地后的效果

这套方案上线后，比较稳定的数据是：

- 大促高峰 API Pod 从 4 扩到 12，P95 从 2.1s 降到 480ms 左右
- OOMKilled 次数一周从 17 次降到 1 次
- 节点 CPU 利用率更平稳，空闲浪费也少了
- 资源基线从“拍脑袋”改成“按 VPA 建议 + 压测回归”

我现在的建议很简单：

1. **Laravel API 先别迷信 CPU HPA**
2. **先把 requests/limits 订正，再谈自动扩缩容**
3. **API、Queue、Cron 三类 Pod 分开建策略**
4. **HPA 负责横向，VPA 优先负责建议，不要一锅炖**

如果你的 Laravel 服务已经进了 Kubernetes，下一次扩容策略评审时，我最建议先看两个图：**每 Pod 活跃进程数** 和 **P95 延迟**。很多“CPU 很低却很慢”的真相，都会从这两个指标里冒出来。
