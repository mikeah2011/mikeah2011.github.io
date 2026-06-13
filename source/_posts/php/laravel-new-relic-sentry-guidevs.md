---
title: Laravel-New-Relic-Sentry-生产环境错误追踪实战对比踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 01:25:25
updated: 2026-05-05 01:29:09
categories:
  - php
tags: [Laravel, 监控]
keywords: [Laravel, New, Relic, Sentry, 生产环境错误追踪实战对比踩坑记录, PHP]
description: 在 KKday B2C API 生产环境中同时跑 New Relic + Sentry 双平台的真实经验：配置陷阱、上下文传播、采样策略、告警降噪，以及什么场景该用哪个的决策框架。



---

# Laravel + New Relic/Sentry：生产环境错误追踪实战对比踩坑记录

## 前言：为什么需要两个错误追踪平台？

在 KKday B2C API 的生产环境里，我们经历过一个典型的「只用 Log 看错误」阶段——直到某天线上有一个间歇性 500 错误，日志里只有零散的 stack trace，无法关联到具体用户、请求链路和耗时分布。那次事故之后，我们决定引入结构化的错误追踪方案。

最终选型是 **New Relic（APM + Infrastructure）+ Sentry（Error Tracking + Alerting）** 双平台并行。不是因为我们有钱任性，而是它们解决的问题维度完全不同：

```
┌─────────────────────────────────────────────────────────┐
│                   可观测性三支柱                          │
├──────────────┬──────────────┬───────────────────────────┤
│   Metrics    │   Tracing    │    Logging / Errors       │
│  (New Relic) │ (New Relic)  │  (Sentry + New Relic)     │
│              │              │                           │
│ • 吞吐量     │ • 分布式链路  │ • 异常捕获 & 归类          │
│ • P50/P95    │ • 跨服务调用  │ • 面包屑上下文             │
│ • 错误率     │ • 数据库慢查询│ • 用户影响统计             │
│ • Apdex 评分 │ • 外部API耗时│ • Release 级别回归检测      │
└──────────────┴──────────────┴───────────────────────────┘
```

> **一句话总结**：New Relic 看「系统哪里慢」，Sentry 看「代码哪里崩」。

---

## 一、Sentry 在 Laravel 中的集成实战

### 1.1 基础配置

```bash
composer require sentry/sentry-laravel
php artisan vendor:publish --provider="Sentry\Laravel\ServiceProvider"
```

`config/sentry.php` 核心配置：

```php
// config/sentry.php
return [
    'dsn' => env('SENTRY_DSN'),
    'environment' => env('APP_ENV', 'production'),
    'release' => env('SENTRY_RELEASE', trim(shell_exec('git log --pretty="%h" -n1 HEAD'))),

    // ⚠️ 踩坑 1: 采样率不能写死 1.0，线上流量大时会打爆配额
    'traces_sample_rate' => env('SENTRY_TRACES_SAMPLE_RATE', 0.2),
    'profiles_sample_rate' => env('SENTRY_PROFILES_SAMPLE_RATE', 0.1),

    // ⚠️ 踩坑 2: 这个选项决定是否发送 PII，GDPR 合规要注意
    'send_default_pii' => false,

    // 采样回调：按路由/状态码做差异化采样
    'traces_sampler' => function (\Sentry\Tracing\SamplingContext $context): float {
        $request = $context->getTransactionContext()->getData()['request'] ?? null;
        $url = $request?->getUri() ?? '';

        // 健康检查端点不采样
        if (str_contains($url, '/health')) {
            return 0.0;
        }
        // 支付回调链路全量采样（出问题代价大）
        if (str_contains($url, '/webhook/')) {
            return 1.0;
        }
        return 0.2;
    },

    // 忽略已知的「噪声异常」
    'ignore_exceptions' => [
        \Symfony\Component\HttpKernel\Exception\NotFoundHttpException::class,
        \Illuminate\Auth\AuthenticationException::class,
    ],
];
```

### 1.2 面包屑（Breadcrumb）：给异常附加上下文

裸的 stack trace 只告诉你「哪里炸了」，但不知道「为什么炸」。Sentry 的 Breadcrumb 可以记录导致异常的完整路径：

```php
// app/Providers/AppServiceProvider.php
use Sentry\State\Scope;
use function Sentry\configureScope;

public function boot(): void
{
    // 每次 DB 查询自动记录到面包屑
    \DB::listen(function ($query) {
        \Sentry\addBreadcrumb(new \Sentry\Breadcrumb(
            level: \Sentry\Breadcrumb::LEVEL_INFO,
            category: 'db.query',
            message: Str::limit($query->sql, 200),
            data: [
                'time' => $query->time,
                'connection' => $query->connectionName,
            ],
        ));
    });

    // Redis 命令也记录
    \Event::listen(function (\Illuminate\Redis\Events\CommandExecuted $event) {
        \Sentry\addBreadcrumb(new \Sentry\Breadcrumb(
            level: \Sentry\Breadcrumb::LEVEL_INFO,
            category: 'redis.command',
            message: $event->command,
            data: ['time' => $event->time, 'connection' => $event->connectionName],
        ));
    });
}
```

当一个 `QueryException` 爆出来时，Sentry 的事件详情里会展示之前执行的 SQL、Redis 命令、HTTP 请求信息，排查效率直接翻倍。

### 1.3 ⚠️ 踩坑：Sentry + Laravel Queue 的上下文丢失

这是我们在生产环境踩过的最痛的一个坑。

Laravel Queue Worker 是一个长驻进程。当一个 Job 处理失败时，Sentry 默认拿到的「请求上下文」可能是上一个 Job 甚至上一轮 HTTP 请求的残留数据：

```php
// ❌ 错误做法：在 Job 构造时设置 tag，Worker 复用时不会清除
class ProcessOrderJob implements ShouldQueue
{
    public function __construct(private Order $order) {}

    public function handle(): void
    {
        // 这里的 Sentry scope 可能还带着上一个 Job 的 tag
        $this->processOrder();
    }
}
```

**修复方案**：在 Job handle 开头手动重置 scope：

```php
// ✅ 正确做法：每个 Job 开头清理 scope
class ProcessOrderJob implements ShouldQueue
{
    public function __construct(private Order $order) {}

    public function handle(): void
    {
        // 强制重置 scope，防止上下文污染
        \Sentry\configureScope(function (Scope $scope) {
            $scope->setUser([]);
            $scope->setTags([]);
            $scope->setExtras([]);
        });

        // 绑定当前 Job 的上下文
        \Sentry\configureScope(function (Scope $scope) {
            $scope->setTag('job', class_basename(self::class));
            $scope->setTag('order_id', $this->order->id);
            $scope->setContext('order', [
                'id' => $this->order->id,
                'amount' => $this->order->total_amount,
                'status' => $this->order->status,
            ]);
        });

        $this->processOrder();
    }
}
```

---

## 二、New Relic 在 Laravel 中的集成实战

### 2.1 安装与配置

New Relic 的 PHP Agent 是一个 C 扩展（非 Composer 包），这是它与 Sentry 最大的架构差异：

```bash
# macOS (pecl)
pecl install newrelic

# Docker 环境（推荐用官方镜像）
FROM php:8.1-fpm
RUN curl -fsSL https://download.newrelic.com/php-agent/release/newrelic-php5-*.linux-musl.tar.gz \
    | tar -C /tmp -xz \
    && /tmp/newrelic-php5-*/install \
    && rm -rf /tmp/newrelic-php5-*
```

`php.ini` 核心配置：

```ini
[newrelic]
extension = "newrelic.so"
newrelic.license = "${NEW_RELIC_LICENSE_KEY}"
newrelic.appname = "KKday B2C API; B2C-${APP_ENV}"
newrelic.distributed_tracing_enabled = true
newrelic.transaction_tracer.enabled = true
newrelic.transaction_tracer.threshold = 500ms
newrelic.error_collector.enabled = true

; ⚠️ 踩坑 3: 这个值太小会截断慢查询的 SQL，排查时看不到完整语句
newrelic.transaction_tracer.max_segments = 2000

; ⚠️ 踩坑 4: 自定义命名必须在 PHP 代码中调用，不能只靠 ini
newrelic.framework = "laravel"
```

### 2.2 用 Middleware 注入自定义属性

New Relic 的 Agent 自动抓 Transaction，但缺少业务上下文。通过 `newrelic_add_custom_parameter()` 注入：

```php
// app/Http/Middleware/NewRelicContext.php
class NewRelicContext
{
    public function handle(Request $request, Closure $next): Response
    {
        if (extension_loaded('newrelic')) {
            // 请求级属性
            newrelic_add_custom_parameter('user_id', $request->user()?->id ?? 'anonymous');
            newrelic_add_custom_parameter('api_version', $request->route()->getPrefix());
            newrelic_add_custom_parameter('locale', $request->header('Accept-Language'));

            // 自定义 Transaction 名称（默认是路由 URI，粒度太粗）
            $routeName = $request->route()->getName();
            if ($routeName) {
                newrelic_name_transaction("api/{$routeName}");
            }
        }

        return $next($request);
    }
}
```

### 2.3 ⚠️ 踩坑：New Relic Agent 与 Laravel Octane 不兼容

这是一个致命问题。New Relic PHP Agent 假设每个请求是一个独立的 PHP 进程生命周期，但 Laravel Octane（Swoole/RoadRunner）打破了这个假设：

```
┌──────────────────────────────────────────────────────────┐
│          传统 PHP-FPM 模式（New Relic 正常）               │
│                                                          │
│  Request 1 → [FPM Worker 1] → Response 1 → Worker 销毁   │
│  Request 2 → [FPM Worker 2] → Response 2 → Worker 销毁   │
│  Agent: 每个请求一个 Transaction ✓                        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│          Octane/Swoole 模式（New Relic 异常）              │
│                                                          │
│  Request 1 ─┐                                            │
│  Request 2 ─┤→ [同一个 Worker 常驻] → 并发处理 → 响应      │
│  Request 3 ─┘                                            │
│  Agent: Transaction 混在一起，数据错乱 ✗                   │
└──────────────────────────────────────────────────────────┘
```

**我们的解决方案**：Octane 环境下用 Sentry 做主力错误追踪，New Relic 只做 Infrastructure 监控（CPU/内存/磁盘），不用 APM Transaction。

```php
// config/octane.php
'listeners' => [
    RequestTerminated::class => [
        // 清理 New Relic 自定义参数（如果 Agent 加载了的话）
        function (RequestTerminated $event) {
            if (extension_loaded('newrelic')) {
                newrelic_end_transaction();
                newrelic_start_transaction(ini_get('newrelic.license'));
            }
        },
    ],
],
```

---

## 三、New Relic vs Sentry：决策矩阵

在 KKday 的实际使用中，我们总结了以下决策框架：

```
┌──────────────────────┬────────────────────────┬──────────────────────────┐
│       维度           │      New Relic         │        Sentry             │
├──────────────────────┼────────────────────────┼──────────────────────────┤
│ 核心定位             │ APM + 基础设施监控      │ 错误追踪 + 异常归类        │
│ 部署方式             │ C 扩展（需 root 权限）   │ Composer 包（纯 PHP）      │
│ 分布式链路追踪       │ ✅ 原生支持             │ ✅ 后来也支持了             │
│ 错误归类 & 聚合      │ ❌ 弱（按 Transaction） │ ✅ 强（指纹算法 + Issue）   │
│ 用户影响统计         │ ❌ 不直接支持           │ ✅ 影响用户数一目了然       │
│ 性能开销             │ 高（C 扩展拦截每个请求） │ 低（只在异常时上报）        │
│ 定价模型             │ 按 Host/月 计费         │ 按事件数 计费              │
│ Laravel Queue 支持   │ ⚠️ 需手动 Transaction  │ ✅ 自动捕获                │
│ 与 Octane 兼容性     │ ❌ 不兼容              │ ✅ 兼容                    │
│ Alert 配置灵活度     │ ✅ NRQL 强大           │ ✅ Issue Alert + Metric    │
│ 代码级性能分析       │ ✅ Transaction Trace    │ ✅ Profiling（付费功能）    │
│ 第三方集成           │ Slack/PagerDuty/自定义  │ Slack/Teams/Jira/Linear    │
└──────────────────────┴────────────────────────┴──────────────────────────┘
```

---

## 四、双平台协作的实战架构

我们在 KKday B2C API 的最终架构是这样的：

```
                    ┌─────────────────────────┐
                    │     Laravel API (PHP)    │
                    │                          │
                    │  ┌───────────┐ ┌───────┐ │
                    │  │ Sentry SDK│ │NR Agent│ │
                    │  │ (Composer)│ │(ext.so)│ │
                    │  └─────┬─────┘ └───┬───┘ │
                    └────────┼───────────┼─────┘
                             │           │
                    ┌────────▼──┐   ┌────▼────────────┐
                    │  Sentry   │   │   New Relic     │
                    │  SaaS     │   │   SaaS          │
                    │           │   │                  │
                    │ • Error   │   │ • APM Traces     │
                    │   Issues  │   │ • Infrastructure │
                    │ • Alerts  │   │ • Custom Dash    │
                    │   → Slack │   │   → PagerDuty   │
                    └───────────┘   └──────────────────┘
                             │           │
                    ┌────────▼───────────▼─────┐
                    │      统一告警通道         │
                    │   Slack #ops-alerts      │
                    │   PagerDuty Escalation   │
                    └──────────────────────────┘
```

**告警分流策略**：

```php
// config/alerting.php（自定义配置，非框架原生）
return [
    // Sentry 告警规则（在 Sentry Dashboard 配置）
    // 1. 新 Issue 出现 → Slack #error-tracking
    // 2. Issue 回归（Resolved → Unresolved）→ Slack + PagerDuty
    // 3. 影响用户 > 50 → PagerDuty + 电话

    // New Relic Alert Policy（在 NR Dashboard 用 NRQL）
    // 1. Apdex < 0.7 持续 5 分钟 → Slack #performance
    // 2. Error Rate > 5% 持续 3 分钟 → PagerDuty
    // 3. P95 Latency > 3s → Slack #slow-endpoints
];
```

---

## 五、成本优化：采样策略实战

双平台并行最大的挑战是**成本**。我们的月均 API 流量约 2000 万请求，如果全量上报，账单会爆。

### Sentry 采样策略

```php
// app/Exceptions/Handler.php
public function register(): void
{
    $this->reportable(function (Throwable $e) {
        // 业务异常只上报 10%
        if ($e instanceof BusinessException) {
            if (random_int(1, 10) > 1) {
                return; // 90% 的业务异常不上报
            }
        }

        // 支付相关异常全量上报
        if ($e instanceof PaymentException) {
            return; // 不 skip，全量上报
        }
    });
}
```

### New Relic 采样策略

```ini
; php.ini — 按 Transaction 采样
newrelic.transaction_tracer.max_segments = 1000

; 代码中动态采样
if (extension_loaded('newrelic')) {
    // 后台队列任务降低采样率
    if (app()->runningInConsole()) {
        newrelic_set_appname('KKday B2C Workers');
        // 队列任务不在 NR 看 Transaction，只看 Infrastructure
    }
}
```

**月度成本对比（我们的实际数据）**：

| 指标 | Sentry | New Relic |
|------|--------|-----------|
| 月费 | ~$26/月（Team 计划 + 50K 事件） | ~$300/月（Pro 计划 + 100GB 数据） |
| 实际事件/数据量 | ~30K 错误事件/月 | ~80GB 数据/月 |
| ROI | 每次线上 bug 平均修复时间 ↓40% | 慢查询定位时间 ↓60% |

---

## 六、最容易被忽略的坑

### 6.1 Sentry 的 fingerprint 导致 Issue 爆炸

Sentry 默认按 stack trace 的最后一帧做 fingerprint。如果同一个异常抛出位置在中间件/框架层，会导致成千上万的「不同」事件被归到同一个 Issue：

```php
// 在 config/sentry.php 中用 before_send 回调自定义 fingerprint
'before_send' => function (\Sentry\Event $event): ?\Sentry\Event {
    $exception = $event->getExceptions()[0] ?? null;

    // 自定义 fingerprint：按异常类 + 业务 code 归类
    if ($exception && str_contains($exception['type'], 'BusinessException')) {
        $event->setFingerprint([
            $exception['type'],
            $event->getExtra()['error_code'] ?? 'unknown',
        ]);
    }

    return $event;
},
```

### 6.2 New Relic 的 Transaction 命名导致数据爆炸

如果你按 `{method} {uri}` 命名 Transaction，而 URI 里有动态参数（如 `/api/orders/{uuid}`），每个 UUID 都会产生一个独立的 Transaction 名称，导致数据量指数级增长：

```php
// ❌ 这样命名会产生百万级 Transaction 名称
newrelic_name_transaction("GET /api/orders/{$request->uuid}");

// ✅ 用路由名称，天然参数化
newrelic_name_transaction("GET api.orders.show");
```

### 6.3 双平台的告警风暴

两个平台同时对同一个错误发告警，Slack 频道会被轰炸。我们的解决方案：

```yaml
# Slack 频道分流
channels:
  - name: #ops-errors    # Sentry 来的错误告警
    sources: [sentry]
  - name: #ops-perf      # New Relic 来的性能告警
    sources: [newrelic]
  - name: #ops-critical   # 两个平台的 P0 告警合并到这里
    sources: [sentry-p0, newrelic-p0]
    escalation: pagerduty
```

---

## 总结

| 场景 | 推荐方案 |
|------|---------|
| 个人/小团队项目 | **只用 Sentry**（免费额度够用，部署简单） |
| 中大型团队 + 传统 PHP-FPM | **New Relic + Sentry 双平台**（互补覆盖） |
| 使用 Octane/Swoole | **Sentry 主力** + New Relic Infrastructure |
| 预算有限但需要 APM | **Sentry（全功能）+ New Relic Free Tier** |

核心原则：**不要只看价格，要看 Mean Time To Resolution (MTTR)**。我们在引入双平台后，线上 P0 事故的平均恢复时间从 47 分钟降到了 19 分钟——这个 ROI 足够覆盖每月 ~$330 的工具费用。
