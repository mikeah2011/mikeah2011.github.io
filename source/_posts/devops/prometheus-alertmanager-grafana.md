---

title: 监控告警实战：Prometheus Alertmanager + Grafana 告警规则设计
date: 2026-06-01 22:45:00
tags:
- Prometheus
- AlertManager
- Grafana
- PromQL
- 监控告警
- 可观测性
description: 本文结合 Laravel 线上系统，系统讲解 Prometheus、Grafana、Alertmanager 的监控告警落地方法，覆盖 PromQL 告警规则设计、Alertmanager 路由与抑制、Grafana 面板模板、监控告警分级、误报治理与告警疲劳优化，帮助团队建立真正可执行、可演练、可持续迭代的生产级告警体系。
categories:
  - devops
keywords: [Prometheus Alertmanager, Grafana, 监控告警实战, 告警规则设计]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



# 监控告警实战：Prometheus Alertmanager + Grafana 告警规则设计

很多团队把“监控系统搭起来了”和“真的具备值班能力了”混为一谈。Prometheus 装好了，Grafana 面板也有了，机器 CPU、内存、磁盘、Nginx 请求量一应俱全，表面上看已经很完整；但真正到了线上故障时，群里依然会出现同样的问题：到底是机器资源不够、应用接口变慢、数据库抖动、队列积压、缓存命中率下降，还是某个下游服务出了问题？更尴尬的是，有些系统虽然告警很多，却没有一条真正有用，半夜把人叫醒之后，最后发现只是一次短暂抖动，或者只是某台测试机的无关指标波动。

这篇文章想解决的不是“怎么安装 Prometheus、Grafana、Alertmanager”这种入门问题，而是更接近生产环境的一件事：如何设计一套真正能落地的监控告警体系。所谓能落地，至少要满足几个条件：第一，指标采集有边界，知道自己为什么采，不是看到什么都往里塞；第二，告警规则有层次，能区分信息通知、需要关注、需要立即处理和必须立刻升级响应；第三，Grafana 看板不是“给领导看”的大屏，而是给值班工程师定位问题用的操作界面；第四，监控不仅要覆盖主机和中间件，还要真正进入应用层，尤其是 Laravel 这样的业务系统，必须把 HTTP、队列、缓存、数据库、异常和关键业务动作连接起来。

我会围绕一个典型的 Laravel 线上系统来展开，假设这个系统包含以下组件：Nginx、PHP-FPM 或 Laravel Octane、MySQL、Redis、队列 Worker、计划任务，以及若干外部依赖服务。监控栈采用 Prometheus 作为时序数据采集与存储，Alertmanager 作为告警路由中心，Grafana 负责可视化展示和补充型告警能力。文章重点覆盖五件事：Prometheus 配置、Alertmanager 路由规则、Grafana 面板搭建、告警分级方法、Laravel 应用监控接入。

如果你已经会写几条简单的 PromQL，这篇文章的价值在于帮你把“零散规则”升级成“体系化设计”；如果你还没有把 Laravel 接入可观测性，这篇文章也会给你一条比较完整的落地路径。

## 一、先明确目标：监控系统不是数据仓库，而是故障处理系统

很多监控做不起来，并不是技术能力不够，而是目标定义错了。最常见的错误目标有三种。

第一种目标是“指标越多越好”。于是团队开始疯狂采集：机器、容器、进程、PHP-FPM、MySQL、Redis、Nginx、Laravel、自定义业务指标全都上，但没有任何命名规范，也没有明确的 owner，最终出现大量没人看的指标。Prometheus 内存越来越大，Grafana 面板越来越多，但故障响应并没有变快。

第二种目标是“告警越敏感越好”。大家担心漏报，于是阈值设得特别紧，持续时间设得特别短，只要 CPU 超过 70%、错误数超过 10、响应时间超过 500ms 就开始报警。结果白天群消息不断，晚上值班手机响不停，几周之后所有人形成条件反射：先静音，再说。

第三种目标是“看板越炫越好”。很多企业会做一个特别大的监控墙，五颜六色，图表密密麻麻，看起来很专业，但一线值班的人真正需要的是三件事：哪里坏了、影响有多大、先看哪个面板。太多装饰性图表只会增加认知负担。

真正成熟的目标应该是：

1. 在问题发生前，通过趋势和异常发现风险。
2. 在问题发生时，用最短路径判断故障范围和严重级别。
3. 在问题处理中，快速定位瓶颈层次：主机、网络、容器、应用、数据库、缓存、下游依赖。
4. 在问题恢复后，保留足够的数据支撑复盘和规则优化。

换句话说，监控系统的终点不是“看见”，而是“可决策”。

## 二、生产环境里的监控分层模型

为了避免把所有指标混在一起，我们先建立一个分层视角。通常我会把监控拆成五层。

第一层是基础设施层：机器 CPU、load、内存、磁盘空间、磁盘 IO、网络吞吐、TCP 连接状态、容器重启次数、节点不可用等。这一层解决的是宿主机和运行时环境是否健康。

第二层是中间件层：Nginx 请求数、4xx/5xx、连接数，MySQL QPS、慢查询、连接数、Buffer Pool、主从延迟，Redis 命中率、内存使用、阻塞客户端、复制状态，队列长度和消费速率。这一层解决的是应用依赖是否成为瓶颈。

第三层是应用运行时层：Laravel HTTP 请求量、错误率、接口耗时、PHP-FPM 活跃进程、Worker 存活数、队列 Job 失败数、调度任务执行耗时等。这一层回答“应用本身是否退化”。

第四层是业务层：下单成功率、支付回调成功率、优惠券核销成功率、登录失败率、库存扣减失败率、消息发送堆积等。这一层回答“用户价值链是否受损”。

第五层是告警治理层：路由、抑制、静默、去重、分级、升级策略、值班交接、通知渠道治理。这一层不是一个独立的技术组件，但它决定了前面四层的信号能否被正确消费。

Prometheus 负责前四层数据的采集和计算，Alertmanager 负责第五层的编排，Grafana 把这些内容组织成能支持排障的界面。

## 三、整体架构设计：不要只关注采集，更要关注数据流向

一个典型的落地架构可以这样理解：

```text
[Node Exporter / Mysqld Exporter / Redis Exporter / Nginx Exporter]
                          |
                          v
                  [Prometheus Server]
                     |            |
                     |            +--> Recording Rules
                     |
                     +--> Alerting Rules ---> [Alertmanager] ---> Slack / 飞书 / 邮件 / PagerDuty
                     |
                     +--> [Grafana]

[Laravel App /metrics] ----^
[Queue Worker metrics] ----^
[Custom business metrics]-^
```

在这个架构里有几个关键点。

一是 Prometheus 不只是“采数据”，还应该承担一部分规则计算职责。高频使用的聚合指标要尽量通过 recording rules 预计算，而不是每个 Grafana 面板都临时写一长串复杂 PromQL。

二是 Alertmanager 不能只是一个 webhook 转发器。它真正的价值在于分组、降噪、抑制、静默、路由和升级。

三是 Grafana 面板最好按“故障处理路径”来组织，而不是按“组件清单”来组织。比如一个值班工程师通常不是先打开 Redis 面板再打开 Nginx 面板，而是先看总览，再进入 API 面板，再看数据库、缓存、队列等下钻页。

四是 Laravel 指标不能只停留在异常日志和 APM 事件层，最好同时暴露统一命名的 metrics，让它可以和基础设施层用同一种语言联动。

## 四、Prometheus 配置设计：从 scrape 到 rule 的完整思路

Prometheus 的配置如果只是简单把 targets 填进去，初期可以运行，但很快就会遇到问题：采集频率不一致、label 混乱、环境难区分、规则文件分散、跨服务聚合困难、测试环境污染生产数据。

一个较为清晰的 `prometheus.yml` 可以按下面的思路组织。

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: production-shanghai
    env: prod

rule_files:
  - /etc/prometheus/rules/base/*.yml
  - /etc/prometheus/rules/apps/*.yml
  - /etc/prometheus/rules/business/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
        labels:
          service: prometheus
          team: sre

  - job_name: node-exporter
    scrape_interval: 15s
    static_configs:
      - targets:
          - 10.0.1.11:9100
          - 10.0.1.12:9100
        labels:
          service: infra-node
          team: sre

  - job_name: nginx-exporter
    scrape_interval: 15s
    static_configs:
      - targets:
          - 10.0.1.11:9113
          - 10.0.1.12:9113
        labels:
          service: nginx
          team: platform

  - job_name: laravel-app
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets:
          - 10.0.2.21:8080
          - 10.0.2.22:8080
        labels:
          service: checkout-api
          team: checkout
          language: php
          framework: laravel

  - job_name: php-fpm-exporter
    scrape_interval: 15s
    static_configs:
      - targets:
          - 10.0.2.21:9253
          - 10.0.2.22:9253
        labels:
          service: checkout-api
          component: php-fpm
          team: checkout

  - job_name: redis-exporter
    scrape_interval: 15s
    static_configs:
      - targets:
          - 10.0.3.31:9121
        labels:
          service: redis
          team: platform

  - job_name: mysql-exporter
    scrape_interval: 15s
    static_configs:
      - targets:
          - 10.0.3.41:9104
        labels:
          service: mysql
          team: dba
```

这个配置看起来不复杂，但有几个关键设计点非常值得强调。

### 4.1 external_labels 决定跨环境告警治理能力

`external_labels` 不只是为了好看，它能帮助你在多 Prometheus、多机房、多环境汇总时区分来源。常见的标签有 `cluster`、`env`、`region`。当 Alertmanager 收到多个 Prometheus 推送的告警时，这些标签会直接决定你的分组和路由策略。

### 4.2 labels 不要随便起，要有统一语义

在 `static_configs` 中自定义 labels 时，建议团队统一一套字段，比如：

- `service`：业务服务名，如 `checkout-api`
- `team`：归属团队，如 `checkout`
- `component`：组件名，如 `php-fpm`、`worker`
- `env`：环境，如 `prod`、`staging`
- `tier`：层级，如 `frontend`、`app`、`db`

最怕的是今天用 `app`，明天用 `application`，后天又用 `service_name`，最后 PromQL 和告警路由变得一团乱。

### 4.3 scrape_interval 不要一刀切

大多数指标 15 秒采一次就够了，但有些业务指标或者成本敏感组件可以 30 秒甚至 60 秒采一次。不要为了“更实时”盲目调到 5 秒，这会显著增加 Prometheus 压力，而且很多业务并不需要如此高频率。

一般经验是：

- 主机资源、应用接口、PHP-FPM：15s
- 队列长度、业务聚合指标：15s 或 30s
- 一些低频自定义统计：30s 或 60s

### 4.4 rule_files 按职责拆分，而不是所有规则塞一个文件

建议至少拆成三类：

1. `base`：机器、中间件、通用系统类告警
2. `apps`：服务级 API、Worker、PHP-FPM 等应用告警
3. `business`：关键业务成功率、订单链路、支付链路等业务告警

这样做的好处是 owner 明确。SRE、平台、应用团队、业务团队都能知道自己应该维护哪部分规则。

## 五、Recording Rules：让查询、告警和面板口径一致

很多团队一开始只写 alert rules，不写 recording rules，结果会遇到三个问题：Grafana 面板查询很慢，告警表达式过长难维护，同一个指标在不同地方写法不一致。

Recording rules 的本质是把复杂计算变成“中间指标”。比如 Laravel HTTP 的 RPS、错误率、P95 延迟，这些几乎一定会在面板和告警里重复使用，就非常适合预计算。

```yaml
groups:
  - name: laravel-recording-rules
    interval: 30s
    rules:
      - record: service_route:http_rps:rate5m
        expr: |
          sum by (service, route, method, env) (
            rate(app_http_requests_total[5m])
          )

      - record: service_route:http_5xx_ratio:rate5m
        expr: |
          sum by (service, route, env) (
            rate(app_http_requests_total{status=~"5.."}[5m])
          )
          /
          clamp_min(
            sum by (service, route, env) (
              rate(app_http_requests_total[5m])
            ),
            0.001
          )

      - record: service_route:http_p95_latency_seconds:5m
        expr: |
          histogram_quantile(
            0.95,
            sum by (service, route, env, le) (
              rate(app_http_request_duration_seconds_bucket[5m])
            )
          )

      - record: service:http_5xx_ratio:rate5m
        expr: |
          sum by (service, env) (
            rate(app_http_requests_total{status=~"5.."}[5m])
          )
          /
          clamp_min(
            sum by (service, env) (
              rate(app_http_requests_total[5m])
            ),
            0.001
          )
```

这里的设计要点是：

1. 尽量在 recording rules 里保留足够的维度，但不要无限保留。比如 route、service、env 很常用，但 user_id、tenant_id 这类高基数维度就绝不能进入公共指标。
2. 对除法场景使用 `clamp_min` 避免分母为零，尤其是低流量接口。
3. 时延建议基于 histogram 计算 P95、P99，不要依赖平均值。

当你把这些规则统一好之后，Grafana 和 Alert rules 都直接复用这些 recording 指标，整个系统会稳定很多。

## 六、告警设计原则：先定义“什么情况值得叫醒人”

真正困难的从来不是 PromQL 语法，而是判断什么值得告警。告警的本质是运维和工程治理问题，不是一个纯技术问题。一个成熟的告警策略通常要回答下面几个问题：

1. 这条告警表示的是症状、原因，还是背景信息？
2. 它的影响范围是什么，是单机、单实例、单服务、整条业务链路，还是全站？
3. 它要通知谁，是值班工程师、服务 owner、平台团队，还是 DBA？
4. 它应该通过什么渠道发，是聊天群、邮件、电话，还是 PagerDuty？
5. 它是否需要抑制其他次级告警？
6. 它需要持续多久才算真实问题？

我通常把告警分成四类。

第一类是信息型 `info`：不要求立即处理，更多是提醒。例如某个实例重启、某个计划任务延迟执行、某台测试机磁盘空间下降到 30%。

第二类是警告型 `warning`：需要在工作时间关注，但通常不应半夜叫醒人。例如某个服务错误率在 5 分钟窗口内轻微升高、Redis 命中率下降、某个 API 的 P95 持续高于预期但还没严重影响可用性。

第三类是严重型 `critical`：业务已经明显受损，需要快速响应。例如支付成功率下降、订单接口 5xx 持续高于 3%、主库连接打满、队列积压明显影响业务时效。

第四类是灾难型 `fatal` 或 `page`：需要电话、PagerDuty 或升级值班链路。例如核心交易链路完全不可用、Prometheus 本身无法采集关键服务、数据库主实例不可达。

如果团队规模不大，至少也要落地 `info / warning / critical` 三档。

## 七、Prometheus Alert Rules：从“阈值触发”升级到“症状 + 持续时间 + 流量门槛”

下面给出一组比较贴近生产的告警规则示例，覆盖主机、应用、PHP-FPM、队列和业务接口。

### 7.1 主机资源类告警

```yaml
groups:
  - name: infra-node-alerts
    rules:
      - alert: HostHighCpuUsage
        expr: |
          100 - (avg by (instance, env) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 10m
        labels:
          severity: warning
          category: infra
        annotations:
          summary: "主机 CPU 使用率持续高于 85%"
          description: "实例 {{ $labels.instance }} 在 {{ $labels.env }} 环境 CPU 持续 10 分钟高于 85%。"

      - alert: HostMemoryPressure
        expr: |
          (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 90
        for: 10m
        labels:
          severity: critical
          category: infra
        annotations:
          summary: "主机内存压力过高"
          description: "实例 {{ $labels.instance }} 可用内存持续不足 10%。"

      - alert: HostDiskSpaceLow
        expr: |
          (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}
          /
          node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}) * 100 < 15
        for: 15m
        labels:
          severity: warning
          category: infra
        annotations:
          summary: "磁盘剩余空间不足 15%"
          description: "实例 {{ $labels.instance }} 挂载点 {{ $labels.mountpoint }} 剩余空间不足。"
```

这类规则最大的陷阱是误报。CPU 短时高峰未必有问题，因此一定要带 `for`。另外，很多机器 CPU 高只是正常批处理行为，不一定需要夜间告警，所以路由上通常发到工作群即可。

### 7.2 Laravel HTTP 错误率告警

```yaml
groups:
  - name: laravel-api-alerts
    rules:
      - alert: LaravelApiHigh5xxRatio
        expr: |
          service:http_5xx_ratio:rate5m{service="checkout-api", env="prod"} > 0.03
          and
          sum by (service, env) (rate(app_http_requests_total{service="checkout-api", env="prod"}[5m])) > 1
        for: 10m
        labels:
          severity: critical
          category: application
          team: checkout
        annotations:
          summary: "Laravel API 5xx 错误率持续高于 3%"
          description: "服务 {{ $labels.service }} 在生产环境 10 分钟内 5xx 错误率超过 3%。"
```

这里特别重要的是“错误率 + 流量门槛 + 持续时间”。如果只写错误率，当流量很低时一次失败就可能让比率瞬间高得离谱；如果只写错误数，高流量服务又可能掩盖真正的故障。

### 7.3 核心接口延迟告警

```yaml
      - alert: CheckoutOrderCreateHighLatency
        expr: |
          service_route:http_p95_latency_seconds:5m{
            service="checkout-api",
            route="orders.create",
            env="prod"
          } > 1.2
          and
          service_route:http_rps:rate5m{
            service="checkout-api",
            route="orders.create",
            env="prod"
          } > 0.5
        for: 10m
        labels:
          severity: warning
          category: application
          team: checkout
        annotations:
          summary: "订单创建接口 P95 延迟过高"
          description: "orders.create 在生产环境 10 分钟内 P95 延迟高于 1.2s。"
```

时延告警建议先从 `warning` 开始，不要一上来就 `critical`。因为很多性能抖动是可观察但未必立即影响业务的，应该给值班同学一个判断空间。真正升级到 `critical` 的条件，通常要叠加错误率升高或业务成功率下降。

### 7.4 PHP-FPM 饱和度告警

Laravel 在 PHP-FPM 架构下，非常容易出现 CPU 没满但请求已排队的情况。此时只看机器资源完全不够。

```yaml
      - alert: PhpFpmPoolSaturated
        expr: |
          phpfpm_active_processes{service="checkout-api", env="prod"}
          /
          phpfpm_total_processes{service="checkout-api", env="prod"} > 0.9
        for: 10m
        labels:
          severity: warning
          category: runtime
          team: checkout
        annotations:
          summary: "PHP-FPM 进程池接近饱和"
          description: "{{ $labels.instance }} 的 PHP-FPM 活跃进程占比持续超过 90%。"

      - alert: PhpFpmListenQueueBacklog
        expr: |
          phpfpm_listen_queue{service="checkout-api", env="prod"} > 5
        for: 5m
        labels:
          severity: critical
          category: runtime
          team: checkout
        annotations:
          summary: "PHP-FPM 请求排队严重"
          description: "{{ $labels.instance }} 出现持续排队，可能导致接口超时。"
```

在很多 PHP 系统里，`listen_queue` 往往比 CPU 更能提前反映真实问题。

### 7.5 队列积压和失败告警

如果 Laravel 使用 Horizon 或队列 Worker，必须把积压长度、消费延迟和失败率纳入监控。不然白天一切正常，晚上消息积压到第二天才发现。

```yaml
      - alert: QueueBacklogHigh
        expr: |
          laravel_queue_jobs_ready{queue="default", env="prod"} > 1000
        for: 15m
        labels:
          severity: warning
          category: queue
          team: checkout
        annotations:
          summary: "队列积压超过 1000"
          description: "默认队列积压持续超过阈值，请检查 Worker 消费能力。"

      - alert: QueueJobFailureSpike
        expr: |
          increase(laravel_queue_jobs_failed_total{env="prod"}[10m]) > 20
        for: 5m
        labels:
          severity: critical
          category: queue
          team: checkout
        annotations:
          summary: "队列失败任务激增"
          description: "10 分钟内失败任务新增超过 20，请排查异常 Job 或下游依赖。"
```

### 7.6 业务成功率告警

这类告警通常最重要，因为它最接近用户体验。

```yaml
groups:
  - name: business-alerts
    rules:
      - alert: PaymentCallbackSuccessRatioLow
        expr: |
          (
            sum(rate(payment_callback_success_total{env="prod"}[10m]))
            /
            clamp_min(sum(rate(payment_callback_total{env="prod"}[10m])), 0.001)
          ) < 0.98
          and
          sum(rate(payment_callback_total{env="prod"}[10m])) > 0.2
        for: 15m
        labels:
          severity: critical
          category: business
          team: payment
        annotations:
          summary: "支付回调成功率低于 98%"
          description: "支付回调链路出现明显异常，请优先排查第三方支付和签名校验逻辑。"
```

如果只能保留少数几条夜间告警，那么业务成功率类一定要在其中。

### 7.7 内存、磁盘 IO 与磁盘预测性告警

很多团队只写了“磁盘剩余空间低于 15%”这一条，其实远远不够。真正影响服务稳定性的还有内存回收压力、磁盘写入打满、inode 耗尽，以及磁盘空间在短时间内快速下滑。下面是一组更贴近生产的补充规则：

```yaml
      - alert: HostHighMemoryUsage
        expr: |
          (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.92
        for: 15m
        labels:
          severity: warning
          category: infra
        annotations:
          summary: "主机内存使用率持续高于 92%"
          description: "{{ $labels.instance }} 内存使用率持续 15 分钟高于 92%，请结合 page fault、swap 和 PHP-FPM 进程数一起排查。"

      - alert: HostSwapUsageHigh
        expr: |
          (1 - (node_memory_SwapFree_bytes / clamp_min(node_memory_SwapTotal_bytes, 1))) > 0.2
          and node_memory_SwapTotal_bytes > 0
        for: 10m
        labels:
          severity: warning
          category: infra
        annotations:
          summary: "主机 Swap 使用率升高"
          description: "{{ $labels.instance }} 已开始明显使用 Swap，通常意味着内存压力或进程配置异常。"

      - alert: HostDiskWriteLatencyHigh
        expr: |
          rate(node_disk_write_time_seconds_total[5m])
          /
          clamp_min(rate(node_disk_writes_completed_total[5m]), 0.001) > 0.05
        for: 10m
        labels:
          severity: warning
          category: infra
        annotations:
          summary: "磁盘写入延迟升高"
          description: "{{ $labels.instance }} 设备 {{ $labels.device }} 平均写入延迟持续高于 50ms，可能影响 MySQL、日志写入或队列消费。"

      - alert: HostInodeUsageHigh
        expr: |
          (node_filesystem_files_free{fstype!~"tmpfs|overlay"}
          /
          clamp_min(node_filesystem_files{fstype!~"tmpfs|overlay"}, 1)) < 0.1
        for: 15m
        labels:
          severity: critical
          category: infra
        annotations:
          summary: "磁盘 inode 剩余不足 10%"
          description: "{{ $labels.instance }} 挂载点 {{ $labels.mountpoint }} inode 即将耗尽，即使磁盘空间仍有富余也可能无法写入文件。"

      - alert: HostDiskWillFillSoon
        expr: |
          predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[6h], 24 * 3600) < 0
        for: 30m
        labels:
          severity: warning
          category: infra
        annotations:
          summary: "磁盘空间按当前趋势将在 24 小时内耗尽"
          description: "{{ $labels.instance }} 挂载点 {{ $labels.mountpoint }} 下降趋势异常，请尽快确认日志膨胀、缓存文件或备份残留。"
```

这类规则的价值在于：它不只是告诉你“已经坏了”，还会提前暴露“快要坏了”。尤其是 `predict_linear`，很适合日志暴涨、临时文件堆积、导出任务未清理等问题。

### 7.8 HTTP 4xx/5xx、网关错误与低流量接口误报控制

对于 Laravel API 来说，5xx 不是唯一需要看见的信号。某些核心登录、回调、支付确认接口，如果 4xx 激增，也可能意味着签名错误、参数兼容性问题、网关配置异常。下面给出几条适合补充的 HTTP 告警：

```yaml
      - alert: LaravelApiHigh4xxRatio
        expr: |
          sum by (service, env) (
            rate(app_http_requests_total{service="checkout-api", env="prod", status=~"4.."}[10m])
          )
          /
          clamp_min(sum by (service, env) (
            rate(app_http_requests_total{service="checkout-api", env="prod"}[10m])
          ), 0.001) > 0.15
          and
          sum by (service, env) (rate(app_http_requests_total{service="checkout-api", env="prod"}[10m])) > 2
        for: 15m
        labels:
          severity: warning
          category: application
          team: checkout
        annotations:
          summary: "Laravel API 4xx 比例异常升高"
          description: "可能是前端参数变更、签名校验失败、限流误伤或网关改动导致。"

      - alert: NginxGateway5xxSpike
        expr: |
          sum by (instance, env) (rate(nginx_http_requests_total{status=~"502|503|504", env="prod"}[5m])) > 1
        for: 5m
        labels:
          severity: critical
          category: ingress
        annotations:
          summary: "Nginx 502/503/504 错误持续增加"
          description: "{{ $labels.instance }} 网关层连续返回 5xx，优先检查 upstream、PHP-FPM、Laravel 健康状态与超时配置。"

      - alert: LaravelLowTrafficHighErrorCount
        expr: |
          increase(app_http_requests_total{service="checkout-api", env="prod", status=~"5.."}[15m]) > 10
          and
          increase(app_http_requests_total{service="checkout-api", env="prod"}[15m]) < 200
        for: 5m
        labels:
          severity: warning
          category: application
          team: checkout
        annotations:
          summary: "低流量窗口内错误次数偏高"
          description: "用于补足纯错误率规则在夜间低流量阶段的盲区，避免核心接口少量请求但连续失败未被看见。"
```

生产里非常推荐同时保留“错误率规则”和“错误次数规则”。前者适合高流量业务，后者能覆盖夜间、长尾接口或后台回调场景。

### 7.9 MySQL 连接数、主从延迟与慢查询告警

数据库告警不能只监控实例存活。Laravel 业务里经常出现的问题，是连接数打满、慢查询激增、主从延迟扩大，导致应用层表现为超时、接口变慢、队列消费停滞。下面是一组数据库侧规则：

```yaml
groups:
  - name: mysql-alerts
    rules:
      - alert: MySQLTooManyConnections
        expr: |
          mysql_global_status_threads_connected
          /
          clamp_min(mysql_global_variables_max_connections, 1) > 0.85
        for: 10m
        labels:
          severity: critical
          category: database
          team: dba
        annotations:
          summary: "MySQL 连接使用率持续高于 85%"
          description: "实例 {{ $labels.instance }} 连接池接近打满，请检查 Laravel 连接泄漏、慢 SQL 与突发流量。"

      - alert: MySQLSlowQueriesSpike
        expr: |
          increase(mysql_global_status_slow_queries[10m]) > 50
        for: 5m
        labels:
          severity: warning
          category: database
          team: dba
        annotations:
          summary: "MySQL 慢查询数量激增"
          description: "10 分钟内慢查询新增超过 50，建议结合 Grafana 慢查询面板与 Laravel DB 指标定位热点语句。"

      - alert: MySQLReplicationLagHigh
        expr: |
          mysql_slave_status_seconds_behind_master > 30
        for: 10m
        labels:
          severity: critical
          category: database
          team: dba
        annotations:
          summary: "MySQL 主从延迟超过 30 秒"
          description: "读写分离场景下可能导致 Laravel 读到旧数据，表现为支付状态未更新、订单查询异常等。"

      - alert: MySQLHighInnodbRowLockTime
        expr: |
          rate(mysql_global_status_innodb_row_lock_time[5m]) > 1000
        for: 10m
        labels:
          severity: warning
          category: database
          team: dba
        annotations:
          summary: "InnoDB 行锁等待时间明显升高"
          description: "可能存在批量更新、热点行竞争或事务未及时提交，容易映射为 Laravel 请求变慢。"
```

这里的关键是把数据库指标和业务症状连接起来。否则 DBA 看数据库、应用团队看 Laravel，各说各话，排障路径会被拉长。

### 7.10 Redis、缓存与队列消费时延告警

Redis 在 Laravel 系统里往往同时承担缓存、会话、队列、限流等职责，因此一旦抖动，影响面通常比想象中更大。除了简单的“实例不可用”，更值得看的是命中率、阻塞客户端和队列消费时延。

```yaml
groups:
  - name: redis-and-queue-alerts
    rules:
      - alert: RedisCacheHitRatioLow
        expr: |
          rate(redis_keyspace_hits_total{env="prod"}[10m])
          /
          clamp_min(
            rate(redis_keyspace_hits_total{env="prod"}[10m]) + rate(redis_keyspace_misses_total{env="prod"}[10m]),
            0.001
          ) < 0.8
        for: 20m
        labels:
          severity: warning
          category: cache
          team: platform
        annotations:
          summary: "Redis 缓存命中率低于 80%"
          description: "可能是 key 设计变化、TTL 过短、缓存预热失败，或应用绕过缓存直接访问数据库。"

      - alert: RedisBlockedClientsHigh
        expr: |
          redis_blocked_clients{env="prod"} > 5
        for: 10m
        labels:
          severity: critical
          category: cache
          team: platform
        annotations:
          summary: "Redis 阻塞客户端数量异常"
          description: "常见原因包括慢命令、Lua 脚本执行过长、网络抖动或实例资源不足。"

      - alert: QueueConsumptionLatencyHigh
        expr: |
          histogram_quantile(
            0.95,
            sum by (queue, le) (
              rate(app_queue_job_duration_seconds_bucket{env="prod"}[10m])
            )
          ) > 30
        for: 10m
        labels:
          severity: warning
          category: queue
          team: checkout
        annotations:
          summary: "队列 Job P95 处理时长超过 30 秒"
          description: "说明 Worker 虽然还在消费，但单任务耗时明显变长，通常是下游服务慢或任务逻辑膨胀。"

      - alert: QueueBacklogCritical
        expr: |
          laravel_queue_jobs_ready{queue=~"default|payments", env="prod"} > 5000
        for: 10m
        labels:
          severity: critical
          category: queue
          team: checkout
        annotations:
          summary: "关键队列积压超过 5000"
          description: "支付、订单等核心队列已经出现明显业务延迟，应优先扩容 Worker 并检查失败重试风暴。"
```

### 7.11 告警规则设计的小技巧

上面这些规则看起来很多，但它们都遵循同一套方法论：

1. **先定义症状，再定义阈值。** 不要从“PromQL 能写什么”出发，而要从“什么现象真的代表业务受损”出发。
2. **尽量补上流量门槛。** 特别是错误率、成功率、延迟类规则。
3. **尽量加 `for`。** 大部分线上波动都是瞬时尖刺，不值得把人叫醒。
4. **优先围绕业务主链路。** Laravel 项目里通常是登录、下单、支付、回调、消息发送，而不是每个接口都同等重要。
5. **把阈值当作可迭代配置，而不是真理。** 一条规则发布后，最好至少经历一次演练或一次真实故障检验，再决定是否上调或下调。

## 八、Alertmanager 路由规则：告警能发出去不算本事，发对人才算

很多团队 Alertmanager 配置极其简单：所有告警全发一个群。这个方案在服务少的时候勉强可用，一旦服务多起来，群里信息会被淹没，而且没有任何值班治理能力。

一个更实用的 `alertmanager.yml` 通常包含四个部分：全局配置、路由树、抑制规则、接收器定义。

下面给出一个较完整的示例。

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: default-slack
  group_by: ['alertname', 'service', 'env', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - env="prod"
        - severity="critical"
        - team="checkout"
      receiver: checkout-pager
      continue: false

    - matchers:
        - env="prod"
        - severity="warning"
        - team="checkout"
      receiver: checkout-slack
      continue: false

    - matchers:
        - env="prod"
        - severity="critical"
        - team="payment"
      receiver: payment-pager
      continue: false

    - matchers:
        - env="staging"
      receiver: staging-slack
      continue: false

    - matchers:
        - severity="info"
      receiver: ops-mail
      continue: false

inhibit_rules:
  - source_matchers:
      - alertname="InstanceDown"
    target_matchers:
      - category="application"
    equal: ['instance', 'env']

  - source_matchers:
      - severity="critical"
    target_matchers:
      - severity="warning"
    equal: ['alertname', 'service', 'env']

receivers:
  - name: default-slack
    webhook_configs:
      - url: http://alert-proxy.local/webhook/default
        send_resolved: true

  - name: checkout-slack
    webhook_configs:
      - url: http://alert-proxy.local/webhook/checkout
        send_resolved: true

  - name: checkout-pager
    webhook_configs:
      - url: http://alert-proxy.local/webhook/checkout-pager
        send_resolved: true

  - name: payment-pager
    webhook_configs:
      - url: http://alert-proxy.local/webhook/payment-pager
        send_resolved: true

  - name: staging-slack
    webhook_configs:
      - url: http://alert-proxy.local/webhook/staging
        send_resolved: true

  - name: ops-mail
    email_configs:
      - to: ops@example.com
        from: monitor@example.com
        smarthost: smtp.example.com:587
        auth_username: monitor@example.com
        auth_password: your-password
        send_resolved: true
```

### 8.1 route 树的设计逻辑

Alertmanager 的路由树本质上是一个“匹配到就走”的规则系统。实际设计时建议遵循以下顺序：

1. 先按环境分开：`prod` 和 `staging` 必须分流。
2. 再按严重等级分开：`critical` 与 `warning` 走不同接收器。
3. 再按团队分开：checkout、payment、platform、dba 各自有 owner。
4. 最后为无法精确匹配的告警设置默认接收器。

如果你不先按环境切开，很容易把测试环境的噪音带入生产值班链路。

### 8.2 group_by 的选择决定通知体验

`group_by` 不是越多越好，也不是越少越好。太少会把不同问题糅在一条消息里，太多又会导致相似告警分裂成很多条。实际经验上，`alertname + service + env + severity` 是一个不错的起点。如果需要按团队做更多归并，也可以把 `team` 纳入。

### 8.3 repeat_interval 决定“提醒频率”，不要骚扰值班人员

`repeat_interval: 4h` 通常比 30 分钟、1 小时更合理。因为大多数严重问题在 4 小时内一定会被处理或升级。如果故障已知且持续存在，过于频繁的重复提醒没有价值。

### 8.4 抑制规则是降噪核心，不是可选项

例如机器宕机时，这台机器上的应用、PHP-FPM、Nginx 都可能同时出大量告警。如果没有 `inhibit_rules`，值班群会瞬间刷屏。最常见的抑制逻辑包括：

- `InstanceDown` 抑制同实例上的应用类告警
- `critical` 抑制同服务同告警名的 `warning`
- 上游依赖全挂时抑制大量下游衍生告警

### 8.5 一个更完整的 Alertmanager 生产配置示例

上面的配置已经能工作，但如果你想让 Alertmanager 真正承担“告警治理中心”的角色，通常还需要模板、时间路由、静默说明和更细粒度的接收器。下面给出一个更完整的生产示例：

```yaml
global:
  resolve_timeout: 5m
  smtp_smarthost: smtp.example.com:587
  smtp_from: monitor@example.com
  smtp_auth_username: monitor@example.com
  smtp_auth_password: your-password

templates:
  - /etc/alertmanager/templates/*.tmpl

route:
  receiver: default-slack
  group_by: ['alertname', 'service', 'env', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - env="prod"
        - severity=~"critical|page"
      receiver: sre-pager
      continue: true

    - matchers:
        - env="prod"
        - team="checkout"
        - severity="critical"
      receiver: checkout-pager

    - matchers:
        - env="prod"
        - team="checkout"
        - severity="warning"
      receiver: checkout-feishu

    - matchers:
        - env="prod"
        - team="payment"
        - severity="critical"
      receiver: payment-pager

    - matchers:
        - env="prod"
        - team="payment"
        - severity="warning"
      receiver: payment-feishu

    - matchers:
        - env="prod"
        - category="database"
      receiver: dba-feishu

    - matchers:
        - env="staging"
      receiver: staging-feishu

    - matchers:
        - severity="info"
      receiver: ops-mail

inhibit_rules:
  - source_matchers:
      - alertname="InstanceDown"
    target_matchers:
      - category=~"application|runtime|queue|cache"
    equal: ['instance', 'env']

  - source_matchers:
      - alertname="MySQLTooManyConnections"
    target_matchers:
      - alertname=~"LaravelApiHigh5xxRatio|CheckoutOrderCreateHighLatency"
    equal: ['service', 'env']

  - source_matchers:
      - severity="critical"
    target_matchers:
      - severity="warning"
    equal: ['alertname', 'service', 'env']

receivers:
  - name: default-slack
    webhook_configs:
      - url: http://alert-proxy.local/webhook/default
        send_resolved: true

  - name: sre-pager
    webhook_configs:
      - url: http://alert-proxy.local/webhook/sre-pager
        send_resolved: true

  - name: checkout-feishu
    webhook_configs:
      - url: http://alert-proxy.local/webhook/checkout-feishu
        send_resolved: true
        max_alerts: 20

  - name: checkout-pager
    webhook_configs:
      - url: http://alert-proxy.local/webhook/checkout-pager
        send_resolved: true

  - name: payment-feishu
    webhook_configs:
      - url: http://alert-proxy.local/webhook/payment-feishu
        send_resolved: true

  - name: payment-pager
    webhook_configs:
      - url: http://alert-proxy.local/webhook/payment-pager
        send_resolved: true

  - name: dba-feishu
    webhook_configs:
      - url: http://alert-proxy.local/webhook/dba-feishu
        send_resolved: true

  - name: staging-feishu
    webhook_configs:
      - url: http://alert-proxy.local/webhook/staging-feishu
        send_resolved: true

  - name: ops-mail
    email_configs:
      - to: ops@example.com
        send_resolved: true

mute_time_intervals:
  - name: nonprod-night
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '00:00'
            end_time: '09:00'
          - start_time: '20:00'
            end_time: '24:00'
```

这个示例强调了几件事：

- `continue: true` 可以让同一条 critical 告警同时通知团队 owner 和 SRE 值班。
- `mute_time_intervals` 适合非生产环境的夜间降噪，但不要直接用于核心生产告警。
- 接收器最好通过统一告警代理转发，这样飞书、Slack、PagerDuty、短信模板都能在代理层集中维护。

### 8.6 抑制、静默与维护窗口如何协同

很多人会把 inhibit 和 silence 混为一谈，但它们完全不是一回事：

- **抑制（Inhibit）**：规则化自动降噪。比如机器宕机时自动压住应用子告警。
- **静默（Silence）**：针对某次变更、某个实例、某个时间窗口的人为临时静音。
- **维护窗口（Maintenance Window）**：通常是流程层概念，可通过 Alertmanager API、CI/CD 发布系统或内部变更平台统一创建 Silence。

一个比较推荐的静默字段规范是：

- `createdBy`：执行人
- `comment`：必须写变更单号/发布单号
- `startsAt` / `endsAt`：明确时间范围
- `matchers`：尽量精确到 `service + env + instance` 或 `service + env + alertname`

例如发布 checkout-api 时，可创建如下 Silence：

```json
{
  "matchers": [
    {"name": "service", "value": "checkout-api", "isRegex": false},
    {"name": "env", "value": "prod", "isRegex": false},
    {"name": "alertname", "value": "LaravelApiHigh5xxRatio|CheckoutOrderCreateHighLatency", "isRegex": true}
  ],
  "startsAt": "2026-06-01T14:00:00Z",
  "endsAt": "2026-06-01T15:00:00Z",
  "createdBy": "deploy-bot",
  "comment": "release-20260601-042 checkout-api 发布窗口"
}
```

如果你已经有 CI/CD 流程，强烈建议让发布平台在部署前自动创建 Silence，部署完成后自动解除或等待过期。这样既能避免告警风暴，又能留下完整审计记录。

## 九、告警分级：不是给标签，而是定义响应动作

前面我们提到了 `info / warning / critical`，但真正要落地，不能只停留在 label 名称上，而必须形成对应动作。否则大家会随手写 `critical`，最后这个字段失去意义。

下面给出一个可以落地的分级模板。

### 9.1 Info

适用场景：
- 服务实例重启
- 某个低优先级任务延迟
- 某个非核心组件资源轻微波动

动作要求：
- 发工作群或邮件
- 不进入夜间电话/PagerDuty
- 不要求 30 分钟内响应

### 9.2 Warning

适用场景：
- 核心接口时延升高但业务成功率仍正常
- 队列积压上升但尚未影响 SLA
- Redis 命中率下降
- 数据库慢查询升高

动作要求：
- 发团队工作群
- 工作时间内处理，夜间可只通知值班群不升级电话
- 需在日报或巡检中跟踪

### 9.3 Critical

适用场景：
- 核心接口错误率持续升高
- 支付、下单、登录等关键业务成功率下降
- MySQL 主库连接打满或主从延迟过大
- 队列故障已影响业务时效

动作要求：
- 进入值班响应链路
- 触发电话或 PagerDuty
- 必须有 owner、处理时限和升级策略
- 故障恢复后要复盘

### 9.4 告警分级与 SLO/业务影响关联

真正成熟的做法是把分级和业务影响挂钩，而不是和技术阈值挂钩。例如：

- CPU 90% 不一定是 critical
- 订单创建错误率 5% 基本一定是 critical
- 支付回调成功率低于 98% 基本一定是 critical
- 单个边缘节点磁盘不足 10%，如果有自动扩容或不承载核心流量，也许只是 warning

分级应该反映“对用户和业务的伤害”，而不是“看起来很红”。

### 9.5 P0-P4 告警分级对比表

为了让监控告警真正进入流程化治理，建议把 `severity` 和内部事故分级映射起来。下面这个表格适合放进值班手册或团队 Wiki，并与 Alertmanager 路由、通知渠道、响应时间一一对应。

| 级别 | 定义 | 典型场景 | 首次响应时间 | 升级要求 | 通知渠道 |
| --- | --- | --- | --- | --- | --- |
| P0 | 全站核心链路中断，用户无法完成核心交易，或存在严重数据损坏/安全风险 | 支付全量失败、数据库主实例不可用、核心 API 全站 5xx 飙升 | 5 分钟内 | 立即升级到技术负责人、业务负责人、管理层 | 电话 + PagerDuty + 飞书电话 + 战情群 |
| P1 | 核心业务明显受损，但存在部分降级路径 | 下单成功率大幅下降、主从延迟导致读写异常、关键队列严重积压 | 10 分钟内 | 值班工程师 + 服务 owner + SRE 同步介入 | PagerDuty + 飞书/Slack |
| P2 | 单服务或单模块异常，影响可控但需要尽快处理 | 单个 Laravel 服务错误率升高、MySQL 慢查询激增、Redis 命中率异常下降 | 30 分钟内 | 必要时升级至团队 TL | 飞书/Slack 群 + 邮件 |
| P3 | 风险预警或性能退化，短期未明显影响用户 | CPU 持续高、磁盘 24 小时内将耗尽、接口 P95 偏高 | 4 小时内或工作时间处理 | 无需立即升级 | 工作群 + 工单 |
| P4 | 信息提示，记录变更或低优先级状态波动 | 实例重启、非核心任务延迟、staging 环境告警 | 下一个工作日内确认 | 无 | 邮件 / 低优先级群消息 |

落地时，一个常见做法是：

- `severity=page` 对应 P0-P1
- `severity=critical` 对应 P1-P2
- `severity=warning` 对应 P2-P3
- `severity=info` 对应 P4

这样 Alertmanager 和内部事故管理语言就能打通，值班同学收到告警时不会再纠结“critical 到底算不算必须打电话”。

## 十、Grafana 面板搭建：看板要按排障路径设计

Grafana 最大的问题从来不是做不出图，而是面板越做越多，最后没人知道该看哪一个。建议把看板拆成三个层次：总览看板、服务看板、专题看板。

### 10.1 总览看板：值班入口页

总览页是值班同学第一眼看到的页面，建议只放最重要的内容。

推荐包含以下模块：

1. 全站请求总量趋势
2. 全站 5xx 错误率
3. 核心服务 TOP N 错误率
4. 核心服务 TOP N P95 延迟
5. MySQL/Redis 健康摘要
6. 队列积压摘要
7. 当前 firing 告警列表
8. 最近 24 小时告警趋势

总览页不适合放太多细粒度图表，目标是让人迅速判断“是全局问题还是局部问题”。

### 10.2 服务看板：围绕 RED + USE 组织

对 Laravel API 服务来说，我通常会做一个服务级 Dashboard，按以下分区展示。

第一部分：RED 指标
- RPS
- 4xx/5xx 比率
- P50/P95/P99 延迟
- TOP 接口耗时
- TOP 接口错误率

第二部分：运行时指标
- PHP-FPM active/idle/max children
- listen queue
- worker 数量
- 进程重启次数

第三部分：依赖指标
- MySQL 查询耗时、连接数、慢查询
- Redis ops、内存、命中率
- 外部 API 成功率、耗时

第四部分：队列与计划任务
- 每个队列 backlog
- job failure
- job runtime
- cron 最近执行状态

第五部分：业务指标
- 下单成功率
- 支付回调成功率
- 优惠券核销成功率

### 10.3 Grafana 变量设计

一个实用看板必须支持变量切换。最常用的变量包括：

- `env`
- `service`
- `instance`
- `route`
- `queue`

例如 `service` 变量可以用：

```promql
label_values(app_http_requests_total, service)
```

`route` 变量可以写成：

```promql
label_values(app_http_requests_total{service="$service"}, route)
```

有了变量之后，同一个 Dashboard 可以复用给多个 Laravel 服务，而不是每个服务复制一份。

### 10.4 Grafana 面板示例

下面给出几个常见 Panel 的查询思路。

1. 服务 RPS：

```promql
sum(rate(app_http_requests_total{service="$service", env="$env"}[5m]))
```

2. 服务 5xx 错误率：

```promql
sum(rate(app_http_requests_total{service="$service", env="$env", status=~"5.."}[5m]))
/
clamp_min(sum(rate(app_http_requests_total{service="$service", env="$env"}[5m])), 0.001)
```

3. 单接口 P95：

```promql
histogram_quantile(
  0.95,
  sum by (le) (
    rate(app_http_request_duration_seconds_bucket{service="$service", env="$env", route="$route"}[5m])
  )
)
```

4. PHP-FPM 饱和度：

```promql
phpfpm_active_processes{service="$service", env="$env"}
/
phpfpm_total_processes{service="$service", env="$env"}
```

5. Redis 命中率：

```promql
rate(redis_keyspace_hits_total{env="$env"}[5m])
/
clamp_min(
  rate(redis_keyspace_hits_total{env="$env"}[5m]) + rate(redis_keyspace_misses_total{env="$env"}[5m]),
  0.001
)
```

### 10.5 图表样式建议

经验上，下面这些做法非常实用：

- 时延图统一用秒或毫秒，不要混用。
- 错误率统一显示百分比。
- 警戒线直接画在图上，比如 1%、3%、5% 错误率阈值。
- 重要图表支持数据链接，一键跳转到更细的 Dashboard 或日志系统。
- 同一页面颜色规则保持一致，例如红色永远代表严重异常。

### 10.6 告警面板与日志跳转联动

如果团队还接入了 Loki、Elasticsearch 或其他日志平台，建议在 Grafana 的 Panel 或告警通知里加入跳转链接。例如某个接口错误率升高时，通知消息里附带对应日志检索链接、Dashboard 链接、运行手册链接。这样可以把“知道出问题”到“开始排查”的时间缩短很多。

### 10.7 Grafana Dashboard JSON 模板片段

很多文章讲 Grafana 只讲“点点点怎么建图”，但生产里更实用的方式其实是把 Dashboard JSON 模板纳入 Git 管理。下面给出一个精简版 JSON 片段，适合做 Laravel 服务总览模板的起点：

```json
{
  "title": "Laravel Service Overview",
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "templating": {
    "list": [
      {
        "name": "env",
        "type": "query",
        "datasource": "Prometheus",
        "query": "label_values(app_http_requests_total, env)",
        "current": {"text": "prod", "value": "prod"}
      },
      {
        "name": "service",
        "type": "query",
        "datasource": "Prometheus",
        "query": "label_values(app_http_requests_total{env=\"$env\"}, service)"
      }
    ]
  },
  "panels": [
    {
      "type": "timeseries",
      "title": "RPS",
      "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
      "targets": [
        {
          "expr": "sum(rate(app_http_requests_total{service=\"$service\", env=\"$env\"}[5m]))",
          "legendFormat": "RPS"
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "5xx Ratio",
      "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {"color": "green", "value": null},
              {"color": "orange", "value": 0.01},
              {"color": "red", "value": 0.03}
            ]
          }
        }
      },
      "targets": [
        {
          "expr": "sum(rate(app_http_requests_total{service=\"$service\", env=\"$env\", status=~\"5..\"}[5m])) / clamp_min(sum(rate(app_http_requests_total{service=\"$service\", env=\"$env\"}[5m])), 0.001)",
          "legendFormat": "5xx ratio"
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "P95 Latency",
      "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum by (le) (rate(app_http_request_duration_seconds_bucket{service=\"$service\", env=\"$env\"}[5m])))",
          "legendFormat": "p95"
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "Queue Backlog",
      "gridPos": {"h": 8, "w": 12, "x": 12, "y": 8},
      "targets": [
        {
          "expr": "laravel_queue_jobs_ready{env=\"$env\", service=\"$service\"}",
          "legendFormat": "{{queue}}"
        }
      ]
    }
  ]
}
```

这个片段虽然不是完整 Dashboard，但已经足够体现几条实践原则：

1. **变量优先**：`env` 和 `service` 是最基本的复用维度。
2. **阈值内置**：错误率面板直接在 JSON 里定义阈值，便于代码化管理。
3. **总览优先**：先放 RPS、5xx、P95、Queue，再慢慢往下扩展数据库和缓存。
4. **可版本化**：Dashboard JSON 和 Prometheus rules 一样，适合跟随 Git 评审和发布。

如果你的团队已经在用 Terraform 管 Grafana，也可以把这段 JSON 嵌入到 `grafana_dashboard` 资源里，实现完全 IaC 化的监控面板管理。

## 十一、Laravel 应用监控接入：指标命名、埋点位置、踩坑重点

仅靠 Node Exporter 和 MySQL Exporter 是无法真正看见 Laravel 应用健康度的。要让 Laravel 真正进入 Prometheus 体系，至少要覆盖下面几类指标：

1. HTTP 请求总量、状态码、耗时
2. 队列任务数量、失败数、执行耗时
3. 缓存命中/未命中
4. 数据库查询耗时与异常统计
5. 外部依赖调用成功率与时延
6. 关键业务动作成功率

### 11.1 Laravel 里暴露 `/metrics`

Laravel 最常见的做法是接入 `promphp/prometheus_client_php`，通过 Redis、APCu 等存储后端注册指标，再通过 `/metrics` 暴露给 Prometheus 抓取。生产环境里通常更推荐 Redis 作为存储后端，避免多进程、多实例场景下 APCu 数据割裂。

一个典型的服务注册方式如下：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(CollectorRegistry::class, function () {
            Redis::setDefaultOptions([
                'host' => env('PROMETHEUS_REDIS_HOST', '127.0.0.1'),
                'port' => (int) env('PROMETHEUS_REDIS_PORT', 6379),
                'password' => env('PROMETHEUS_REDIS_PASSWORD'),
                'database' => 10,
                'timeout' => 0.1,
                'read_timeout' => '10',
                'persistent_connections' => false,
            ]);

            return new CollectorRegistry(new Redis());
        });
    }
}
```

然后在路由中暴露 `/metrics`：

```php
use Illuminate\Support\Facades\Route;
use Prometheus\CollectorRegistry;
use Prometheus\RenderTextFormat;

Route::get('/metrics', function (CollectorRegistry $registry) {
    $renderer = new RenderTextFormat();

    return response(
        $renderer->render($registry->getMetricFamilySamples()),
        200,
        ['Content-Type' => RenderTextFormat::MIME_TYPE]
    );
});
```

实际生产中，这个端点不要直接暴露给公网，至少要通过内网、Nginx allowlist、Basic Auth、Service Mesh policy 等方式保护。

### 11.2 HTTP 请求中间件埋点

Laravel 的 HTTP 层是最重要的入口。一个典型中间件如下：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Prometheus\CollectorRegistry;
use Symfony\Component\HttpFoundation\Response;

class MetricsMiddleware
{
    public function __construct(private CollectorRegistry $registry)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);
        $method = $request->getMethod();
        $route = optional($request->route())->getName() ?: $request->path();

        try {
            /** @var Response $response */
            $response = $next($request);
            return $response;
        } finally {
            $status = isset($response) ? (string) $response->getStatusCode() : '500';
            $duration = microtime(true) - $start;

            $this->registry->getOrRegisterCounter(
                'app',
                'http_requests_total',
                'Total HTTP requests',
                ['service', 'env', 'method', 'route', 'status']
            )->inc([
                config('app.name'),
                app()->environment(),
                $method,
                $route,
                $status,
            ]);

            $this->registry->getOrRegisterHistogram(
                'app',
                'http_request_duration_seconds',
                'HTTP request duration seconds',
                ['service', 'env', 'method', 'route'],
                [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
            )->observe($duration, [
                config('app.name'),
                app()->environment(),
                $method,
                $route,
            ]);
        }
    }
}
```

这里最关键的不是代码本身，而是 label 设计。永远不要把订单号、用户 ID、完整 URL path、trace_id 之类高基数数据放进 label。Prometheus 对 label 爆炸极其敏感，很多系统就是这样把时序打爆的。

推荐策略是：

- `route` 使用 Laravel 路由名
- `service` 使用固定服务名
- `env` 使用环境名
- `status` 使用状态码
- `method` 使用 GET/POST 等

### 11.3 数据库查询监控接入

Laravel 提供了 `DB::listen`，可以监听每次查询执行时间。这里不建议把每一条 SQL 原文都当 label 发出去，那等于自毁系统。更实用的方式是按连接名、读写类型、时间分桶来聚合。

```php
<?php

namespace App\Providers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;
use Prometheus\CollectorRegistry;

class DatabaseMetricsServiceProvider extends ServiceProvider
{
    public function boot(CollectorRegistry $registry): void
    {
        DB::listen(function ($query) use ($registry) {
            $connection = $query->connectionName ?? 'default';
            $duration = $query->time / 1000;

            $registry->getOrRegisterHistogram(
                'app',
                'db_query_duration_seconds',
                'Database query duration',
                ['service', 'env', 'connection'],
                [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2]
            )->observe($duration, [
                config('app.name'),
                app()->environment(),
                $connection,
            ]);
        });
    }
}
```

如果你确实想区分读写，可以在数据库连接层面封装额外标签，比如 `operation=read/write`，但不要用 SQL 文本。

### 11.4 队列监控接入

Laravel Queue 或 Horizon 是非常适合埋点的地方，因为它对业务时效影响很大。可以监听 Job 处理开始、结束、失败等事件。

```php
<?php

namespace App\Providers;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Prometheus\CollectorRegistry;

class QueueMetricsServiceProvider extends ServiceProvider
{
    public function boot(CollectorRegistry $registry): void
    {
        Event::listen(JobProcessed::class, function (JobProcessed $event) use ($registry) {
            $registry->getOrRegisterCounter(
                'app',
                'queue_jobs_processed_total',
                'Processed queue jobs',
                ['service', 'env', 'queue']
            )->inc([
                config('app.name'),
                app()->environment(),
                $event->job->getQueue() ?: 'default',
            ]);
        });

        Event::listen(JobFailed::class, function (JobFailed $event) use ($registry) {
            $registry->getOrRegisterCounter(
                'app',
                'queue_jobs_failed_total',
                'Failed queue jobs',
                ['service', 'env', 'queue']
            )->inc([
                config('app.name'),
                app()->environment(),
                $event->job->getQueue() ?: 'default',
            ]);
        });
    }
}
```

至于队列 backlog，如果使用 Redis queue，可以通过 Redis key 长度采集；如果使用 Horizon，也可以读取 Horizon 自带状态并转成 Gauge。

### 11.5 缓存命中率监控

缓存命中率往往能提前暴露问题，比如 key 设计变化、缓存穿透、TTL 设置失衡、预热失败等。Laravel 默认缓存层没有直接暴露 Prometheus 指标，通常要自行封装。

```php
<?php

namespace App\Support\Cache;

use Illuminate\Cache\Repository;
use Prometheus\CollectorRegistry;

class MonitoredCacheRepository
{
    public function __construct(
        private Repository $cache,
        private CollectorRegistry $registry,
    ) {
    }

    public function remember(string $key, int $ttl, callable $callback): mixed
    {
        $hit = $this->cache->has($key);

        $counter = $this->registry->getOrRegisterCounter(
            'app',
            'cache_requests_total',
            'Cache requests total',
            ['service', 'env', 'result']
        );

        $counter->inc([
            config('app.name'),
            app()->environment(),
            $hit ? 'hit' : 'miss',
        ]);

        return $this->cache->remember($key, $ttl, $callback);
    }
}
```

这里也不要把具体 cache key 作为 label，否则会出大问题。

### 11.6 外部依赖调用监控

Laravel 应用往往会调用支付、库存、短信、会员、推荐等外部服务。实践里非常建议给 HTTP Client、RPC Client 做统一封装，把 success/failure 和 latency 打成指标。

例如封装 Guzzle 或 Laravel HTTP Client，在调用外部服务时记录：

- `external_requests_total{dependency="payment",status="success"}`
- `external_request_duration_seconds{dependency="payment"}`

这样当订单接口变慢时，你能马上知道是内部数据库慢，还是第三方支付接口慢。

### 11.7 关键业务埋点

从可运维角度看，真正最有价值的指标往往是业务指标。比如：

- `order_create_total`
- `order_create_success_total`
- `payment_callback_total`
- `payment_callback_success_total`
- `coupon_redeem_total`
- `coupon_redeem_success_total`

这些指标可以直接支撑业务成功率告警。很多时候技术层的错误率还没明显抬升，业务成功率已经先开始下滑了。

## 十二、Laravel 接入中的典型踩坑

### 12.1 高基数 label 爆炸

这是最常见、也是代价最大的坑。任何含动态 ID 的标签都会迅速导致时序爆炸。常见危险字段包括：

- 完整 URL
- 用户 ID
- 订单号
- trace id
- SQL 原文
- 异常 message 原文

解决方法不是“少用 label”，而是“只保留稳定低基数字段”。

### 12.2 指标重复注册

在某些 Laravel 生命周期下，如果你在错误的位置 repeatedly 调用注册逻辑，可能会导致 collector 重复注册报错。解决方式通常是统一在 service provider 或单例中初始化，业务代码只获取已注册 collector。

### 12.3 `/metrics` 被业务中间件污染

很多项目会给所有路由套统一中间件，比如鉴权、日志、限流、异常封装。如果 `/metrics` 也走这些中间件，可能导致抓取失败、性能变差、甚至死循环。最好为 `/metrics` 准备一条最轻量路径。

### 12.4 Prometheus Redis 存储与业务 Redis 混用

如果把 Prometheus client 的 Redis 存储和业务 Redis 混在一起，一旦业务 Redis 突发抖动，监控数据会受影响，反过来又增加 Redis 压力。生产中建议至少逻辑隔离 database，最好物理隔离实例。

### 12.5 Histogram 桶设计不合理

如果 bucket 太粗，会丢失性能细节；太细则会增加时序数量。针对 Laravel API，常见桶可以从 `[0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]` 开始，根据接口特性微调。

### 12.6 自定义指标与 exporter 指标口径冲突

另一个很常见的问题是：应用团队自己打了 `app_db_query_duration_seconds`，同时又在 MySQL Exporter 上看 `mysql_global_status_queries`、`mysql_perf_schema_eventsstatements_seconds_total`，最后不同看板口径不一致，谁都不信谁。解决办法不是“只留一套”，而是明确分工：

- exporter 负责数据库、Redis、Nginx 的基础客观状态；
- Laravel 自定义指标负责“这个业务服务感知到的调用结果”；
- 业务告警优先用应用侧口径，容量/资源告警优先用基础设施侧口径。

只要边界清晰，这两套指标不是冲突，而是互补。

## 十三、告警降噪：减少噪声比新增规则更重要

一套监控要真正能用，后期很大一部分工作其实是“删告警”和“改告警”，而不是不断新增告警。告警降噪通常有五个常见策略。

### 13.1 增加持续时间 `for`

瞬时波动不是故障。绝大多数告警都应该有 `for`，哪怕只是 2 分钟、5 分钟。对于时延和错误率告警，10 分钟往往更合适。

### 13.2 引入最小流量门槛

低流量服务最容易误报。一个接口 10 分钟只来了 3 个请求，失败 1 个，错误率就是 33%。这不一定值得半夜叫人。给表达式加上最小流量门槛，是非常必要的。

### 13.3 区分主告警和从告警

比如 `InstanceDown` 往往是主告警，`PhpFpmListenQueueBacklog`、`LaravelApiHigh5xxRatio` 可能是从告警。当主告警存在时，从告警可被抑制。

### 13.4 做分时段通知

有些告警白天需要立即关注，夜间则可以降级。例如某个非核心运营后台接口变慢，工作时间需要处理，深夜可以只留到次日。这个可以在 Alertmanager 或通知代理层实现。

### 13.5 建立静默制度

版本发布、数据库迁移、缓存预热、批量补偿任务、压力测试等操作期间，如果不做 silence，值班群会被打爆。Silence 不是作弊，而是流程化变更管理的一部分。关键在于：静默必须有时间范围、变更单号、责任人，而不是永久关闭。

### 13.6 告警风暴、误报与告警疲劳的真实踩坑案例

监控体系真正拉开差距的，不是你写出了多少规则，而是你踩过多少坑之后，能不能把它们系统性修掉。下面是几类非常典型、而且在 Laravel 业务里经常遇到的实战问题。

#### 案例一：发布窗口未静默，触发告警风暴

一次 checkout-api 发布中，PHP-FPM reload 导致短时间内少量 502，紧接着因为 `InstanceDown`、`NginxGateway5xxSpike`、`CheckoutOrderCreateHighLatency`、`QueueBacklogHigh` 都没有配置抑制和静默，值班群在 3 分钟内刷出几十条消息，甚至把不相关团队也拉进来。

**根因**：

- 发布前没有自动创建 Silence；
- `critical` 没有抑制同服务的 `warning`；
- 网关层和应用层告警分组粒度过细，导致同一个事件拆成多条通知。

**改进方案**：

1. 发布平台在部署开始前通过 Alertmanager API 创建 30-60 分钟静默；
2. 建立 `critical` 抑制 `warning` 的规则；
3. 优化 `group_by`，让同一服务同一环境的同类告警尽可能合并；
4. 在告警标题里明确“发布窗口中”，避免人工误判。

#### 案例二：低流量接口错误率 50%，其实只失败了 1 次

某个夜间回调接口 10 分钟只有 2 个请求，其中 1 个失败，于是“错误率 50%”的 critical 告警把人叫醒。值班同学花了 20 分钟排查，结果只是第三方偶发重试，并未持续影响业务。

**根因**：

- 只写了错误率阈值，没有最小流量门槛；
- 没有和业务总量、成功率联合判断；
- route 粒度过细但没有考虑低频接口特性。

**改进方案**：

- 所有比例类规则必须加流量门槛；
- 对低频接口采用“错误次数 + 持续时间”组合规则；
- 夜间只对核心支付、下单、回调这类接口升级为电话级别，其余保留为 warning。

#### 案例三：慢 SQL 误报，真正的问题是 Redis 命中率暴跌

某次大促前夕，Laravel API P95 逐渐升高，团队一开始盯着 MySQL 慢查询处理，但实际上数据库慢查询并不显著；真正的问题是缓存 key 规则变更后命中率从 95% 掉到 60%，请求大量回源打到了数据库。

**教训**：

- 单点指标容易误导排查方向；
- Grafana 面板如果没有把 Redis hit ratio、MySQL QPS、PHP-FPM queue 放在同一页，就很难快速建立因果链。

**改进方案**：

1. 服务看板里把缓存命中率和 DB 指标并排展示；
2. 对“缓存命中率下降 + DB 响应变慢”设计组合排查 Runbook；
3. 对关键缓存变更建立变更检查项和灰度观察指标。

#### 案例四：告警疲劳导致真正的故障也被忽略

当团队长期每天收到大量 warning，最后最糟糕的结果不是“大家抱怨很多”，而是**大家开始默认监控不可信**。一旦形成这种文化，真正的 critical 也会被延迟响应。

**典型表现**：

- 值班同学先静音后看；
- 工作群里经常出现“这个不用管吧”；
- 相同告警连续多周存在但没有 owner 处理。

**治理方法**：

- 每周做一次“无效告警清理”，删掉没人处理、没有业务意义的规则；
- 对持续 30 天无人认领的告警，要求 owner 给出处理、降级或删除结论；
- 建立告警质量指标，例如：有效告警率、夜间误报率、重复告警率、平均确认时间；
- 每次 P1/P0 故障复盘都反向审视：是否应该新增规则，或修改已有阈值与抑制逻辑。

### 13.7 一个可执行的告警治理清单

如果你想让“减少噪音”这件事从口号变成动作，可以直接照下面执行：

1. 每月盘点 TOP 20 最频繁告警；
2. 为每条高频告警标注 owner、处理动作、是否夜间唤醒；
3. 统计过去 30 天误报、重复报、已知但未修复的比例；
4. 清理没有 runbook、没有 owner、没有明确阈值依据的告警；
5. 对上线发布、压测、迁移建立标准 Silence 模板；
6. 把告警评审纳入代码评审流程，而不是谁都能随意往生产加一条 `critical`。

## 十四、Grafana 告警与 Prometheus 告警如何分工

Grafana 近几年也支持告警能力，很多团队会纠结：到底全部放在 Grafana，还是继续用 Prometheus + Alertmanager？

我的建议是：

1. 核心指标告警仍以 Prometheus rules + Alertmanager 为主。
2. Grafana 告警更适合做补充型场景，比如面板级简单阈值告警、某些混合数据源条件判断。
3. 统一值班治理最好还是集中到 Alertmanager。

原因很简单：Prometheus rule 的版本化、复用性、表达能力、与 Alertmanager 的天然整合，在大多数技术监控场景里依然更成熟。而 Grafana 告警适合做灵活补充，但不建议把最核心的夜间值班链路全分散到各个 Dashboard 里。

## 十五、真实落地时的 Dashboard 结构建议

如果你要为一个 Laravel 电商 API 做一套完整 Dashboard，我建议最少准备以下页面。

1. `00-全局总览`
2. `01-checkout-api-服务看板`
3. `02-payment-api-服务看板`
4. `03-worker-队列看板`
5. `04-mysql-数据库看板`
6. `05-redis-缓存看板`
7. `06-nginx-入口流量看板`
8. `07-business-订单支付成功率看板`
9. `08-alerts-当前告警看板`

每个看板都尽量做到：
- 顶部变量统一
- 标题规范统一
- 核心图表优先置顶
- 从摘要到细节逐层展开
- 提供运行手册链接

这样，值班同学看到告警后可以沿着固定路径排障，而不是在几十个 Dashboard 里迷路。

## 十六、从故障排查角度看，一条有用告警应该长什么样

一条真正有用的告警，不应该只有一句“错误率升高”。它至少要包含：

1. 告警名称
2. 服务名和环境
3. 当前值和阈值
4. 持续时间
5. 推荐排查方向
6. Dashboard 链接
7. Runbook 链接

例如：

```yaml
annotations:
  summary: "checkout-api 订单创建接口 5xx 错误率持续高于 3%"
  description: "当前值={{ $value }}，持续 10 分钟。建议优先检查 PHP-FPM listen queue、MySQL 连接数、Redis 超时以及 payment-service 调用情况。"
  dashboard: "https://grafana.example.com/d/checkout-api"
  runbook: "https://wiki.example.com/runbooks/checkout-api-alerts"
```

很多团队告警效果差，不是规则本身不对，而是消息内容太贫乏，值班同学收到后还要自己猜下一步看什么。

## 十七、Prometheus + Alertmanager + Grafana 在 Laravel 场景下的组合价值

为什么这三者组合非常适合 Laravel？因为 Laravel 处在一个很典型的应用形态中：

- HTTP 请求主导，天然适合 RED 指标
- 依赖 MySQL/Redis/Queue 明显，易于形成跨层联动
- 队列、计划任务、缓存、外部 API 调用都很多，适合通过自定义指标补齐
- PHP-FPM/Octane 的运行时特性决定了主机资源并不足以解释所有问题

Prometheus 让指标标准化，Alertmanager 让告警可治理，Grafana 让排障可视化。三者结合起来，实际上是在给 Laravel 系统建立一个“可被运营的神经系统”。

## 十八、上线前检查清单

在你把这套系统真正用于生产夜间值班前，建议至少做一轮检查：

1. `/metrics` 是否稳定、低开销、受保护
2. 关键服务是否都有统一 `service`、`team`、`env` 标签
3. 规则文件是否分层、可版本管理
4. 是否已经建立 recording rules，避免面板和告警口径不一致
5. 告警是否完成分级，且每一级有明确响应动作
6. Alertmanager 是否已经配置 group、repeat、inhibit、silence 流程
7. Grafana 是否按排障路径组织，而非按组件罗列
8. 告警通知中是否包含 dashboard/runbook 链接
9. 是否做过故障演练，例如模拟接口错误率升高、队列积压、Redis 故障
10. 值班同学是否知道收到每类告警该怎么处理

没有演练的告警体系，通常一到真故障就会暴露问题。

## 十九、一个推荐的落地步骤

如果你的团队现在还没有完整体系，不建议一次性全部做完。更实用的路线是分四步。

第一步，先把基础采集打通：Node、Nginx、MySQL、Redis、Laravel `/metrics`。

第二步，只做最关键的五条告警：
- 核心 API 5xx 错误率
- 核心 API P95 时延
- MySQL 连接压力
- Redis 不可用或超时
- 队列失败任务激增

第三步，建立值班总览 Dashboard 和两个核心服务 Dashboard。

第四步，再逐渐引入业务成功率、外部依赖调用、告警抑制、Runbook、故障演练。

不要试图第一天就把所有指标和告警都做成“终极版”，因为真正好的规则几乎都是从故障复盘中长出来的。

## 二十、结语：最好的告警系统，是让人越来越少被无效告警打扰

监控系统的成熟，不体现在面板有多少张，时序有多少条，而体现在三件事情上：

第一，故障发生时，是否能快速知道问题在哪里。
第二，夜间响起的告警，是否大概率值得处理。
第三，团队是否愿意持续信任这套系统，而不是把它当背景噪音。

Prometheus、Alertmanager、Grafana 本身都只是工具。真正决定效果的是你的指标设计是否克制、告警分级是否清晰、路由和抑制是否合理、Grafana 是否按排障路径组织，以及 Laravel 应用是否真正把业务和运行时信息暴露出来。

对于 Laravel 团队来说，最值得投入的不是“再做一个更华丽的大屏”，而是把最关键的 API、队列、缓存、数据库和业务成功率连成一套完整的值班链路。只要这条链路通了，很多线上问题都会从“靠经验猜”变成“靠证据判断”。

当你真正把告警从“会响”做到“有用”，监控系统才算开始创造价值。

## 相关阅读

- [Terraform 实战：Laravel 应用基础设施即代码](/categories/DevOps/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
- [Ansible 实战：Laravel 应用自动化部署与配置管理](/categories/DevOps/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Docker Compose + PHP-FPM 实战：微服务部署经验](/categories/运维/docker-compose-php-fpmguide-microservicesdeployment/)
