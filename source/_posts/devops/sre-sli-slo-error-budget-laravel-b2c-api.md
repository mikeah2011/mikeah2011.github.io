---

title: SRE 实战入门：SLI/SLO/Error Budget 在 Laravel B2C API 中的落地——用可靠性指标驱动运维决策
keywords: [SRE, SLI, SLO, Error Budget, Laravel B2C API, 实战入门, 中的落地, 用可靠性指标驱动运维决策]
date: 2026-06-02 10:00:00
tags:
- SRE
- SLI
- SLO
- Error Budget
- Laravel
- 可靠性
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 本文基于 Laravel B2C 电商 API 项目，完整落地 Google SRE 核心实践。从 SLI 指标定义与 Redis 采集、分层 SLO 目标制定，到 Error Budget 计算与预算驱动的工程决策。涵盖可用性中间件、延迟百分位追踪、吞吐量异常检测的可运行代码实现，配合 Prometheus + Grafana 监控体系，帮助团队用数据而非直觉来平衡可靠性与迭代速度。
---



## 前言

在 B2C 电商场景中，API 的可靠性直接影响营收。一个 P0 级别的宕机事故，每分钟可能造成数万甚至数十万美元的损失。然而，"追求 100% 可用性"是一个昂贵且不切实际的目标——从 99.9% 提升到 99.99%，投入的工程成本可能是指数级增长。

Google SRE 团队在《Site Reliability Engineering》一书中提出了一个革命性的理念：**用数据驱动可靠性决策**。SLI（Service Level Indicator）、SLO（Service Level Objective）和 Error Budget（错误预算）构成了这套决策框架的三大支柱。

本文将基于一个真实的 Laravel B2C API 项目，完整落地 SRE 核心实践，从指标定义到监控告警，再到 Error Budget 驱动的工程决策。

---

## 一、SRE 核心理念与传统运维的本质区别

### 1.1 传统运维的困境

传统运维团队通常以"零故障"为目标，工作方式往往是：

- **被动响应**：出了问题才介入，日常忙于"救火"
- **经验驱动**：判断依赖个人经验，缺乏量化标准
- **对立关系**：运维想稳定，开发想迭代，两者天然矛盾
- **指标模糊**：用"系统正常"这种模糊描述，没有精确衡量标准

```text
传统运维的恶性循环：
发布 → 故障 → 修复 → 加审批流程 → 发布变慢 → 更大批次发布 → 更高故障风险
```

### 1.2 SRE 的思维模型

SRE（Site Reliability Engineering）由 Google 在 2003 年提出，核心理念是：

1. **软件工程方法解决运维问题**：用代码而非人工操作来管理基础设施
2. **接受失败是常态**：100% 可靠既不可能也不经济
3. **用数据说话**：SLI/SLO 提供客观度量标准
4. **Error Budget 平衡创新与稳定**：预算充足时大胆发布，预算紧张时保守操作

```text
SRE 的正向循环：
定义 SLO → 监控 SLI → 计算 Error Budget → 预算驱动决策 → 持续改进
```

### 1.3 关键概念速览

| 概念 | 定义 | 类比 |
|------|------|------|
| SLI | 服务级别指标，可量化的服务质量度量 | 体温计的读数 |
| SLO | 服务级别目标，SLI 的目标值 | 正常体温 36.1-37.2°C |
| SLA | 服务级别协议，违反 SLO 的商业赔偿承诺 | 医疗保险的赔付条款 |
| Error Budget | 100% - SLO = 允许的错误空间 | 每月可用的"犯错额度" |

---

## 二、SLI 定义与采集：Laravel API 中的关键指标

### 2.1 什么是好的 SLI

一个好的 SLI 应该满足：

- **用户可感知**：反映用户体验而非系统内部状态
- **可度量**：有明确的采集方法和数值
- **可行动**：指标异常时有明确的改进方向

### 2.2 B2C API 的四大核心 SLI

对于 Laravel B2C API，我们定义以下四大 SLI：

#### SLI 1：可用性（Availability）

```text
可用性 = 成功请求数 / 总请求数 × 100%

成功请求：HTTP 状态码为 2xx 或 3xx
失败请求：HTTP 状态码为 5xx（4xx 属于客户端错误，不计入）
```

**Laravel 中间件实现：**

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class SliAvailabilityTracker
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // 排除健康检查等内部端点
        if ($request->is('health/*') || $request->is('_debugbar/*')) {
            return $response;
        }

        $statusCode = $response->getStatusCode();
        $minute = now()->format('Y-m-d-H-i');

        // 使用 Redis Pipeline 批量更新计数器
        $redis = app('redis')->connection('sli');
        $redis->pipeline(function ($pipe) use ($minute, $statusCode) {
            $pipe->hincrby("sli:availability:{$minute}", 'total', 1);

            if ($statusCode >= 500) {
                $pipe->hincrby("sli:availability:{$minute}", 'errors', 1);
            } else {
                $pipe->hincrby("sli:availability:{$minute}", 'success', 1);
            }

            // 设置过期时间，自动清理 7 天前的数据
            $pipe->expire("sli:availability:{$minute}", 604800);
        });

        return $response;
    }
}
```

#### SLI 2：延迟（Latency）

```text
延迟 SLI = 请求响应时间的百分位分布

关键百分位：
- P50（中位数）：50% 的请求在此时间内完成
- P95：95% 的请求在此时间内完成（尾部延迟）
- P99：99% 的请求在此时间内完成（极端情况）
```

**基于 Laravel Event 系统的延迟采集：**

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Event;
use Illuminate\Foundation\Http\Events\RequestReceived;
use Illuminate\Foundation\Http\Events\RequestHandled;

class SliServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 请求开始时间
        Event::listen(RequestReceived::class, function ($event) {
            $event->request->attributes->set('_sli_start_time', microtime(true));
        });

        // 请求结束时记录延迟
        Event::listen(RequestHandled::class, function ($event) {
            $startTime = $event->request->attributes->get('_sli_start_time');
            if (!$startTime) {
                return;
            }

            $latencyMs = (microtime(true) - $startTime) * 1000;
            $route = $event->request->route()?->getName() ?? $event->request->path();
            $minute = now()->format('Y-m-d-H-i');
            $method = $event->request->method();

            // 将延迟数据存入 Redis Sorted Set（用于计算百分位）
            $key = "sli:latency:{$minute}:{$method}:{$route}";
            $redis = app('redis')->connection('sli');

            $redis->pipeline(function ($pipe) use ($key, $latencyMs) {
                $pipe->zadd($key, [uniqid() => $latencyMs]);
                $pipe->expire($key, 604800);
            });

            // 同时更新直方图桶（用于 Prometheus 采集）
            $bucket = $this->getHistogramBucket($latencyMs);
            $histKey = "sli:latency_hist:{$minute}:{$method}";
            $redis->hincrby($histKey, $bucket, 1);
            $redis->expire($histKey, 604800);
        });
    }

    private function getHistogramBucket(float $ms): string
    {
        $buckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
        foreach ($buckets as $bucket) {
            if ($ms <= $bucket) {
                return "le_{$bucket}";
            }
        }
        return 'le_inf';
    }
}
```

#### SLI 3：正确性（Correctness）

```text
正确性 = 返回正确结果的请求数 / 总请求数 × 100%

对于 API 来说，"正确"的定义：
- 返回的数据与数据库一致
- 业务逻辑执行无误（如订单金额计算正确）
- 没有返回缓存的脏数据
```

**Laravel 中间件实现正确性检查：**

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SliCorrectnessTracker
{
    /**
     * 基于响应头标记的正确性追踪
     * 业务层在发现数据异常时设置 X-SLI-Correctness: degraded
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $minute = now()->format('Y-m-d-H-i');
        $correctness = $response->headers->get('X-SLI-Correctness', 'ok');
        $redis = app('redis')->connection('sli');

        $redis->pipeline(function ($pipe) use ($minute, $correctness) {
            $pipe->hincrby("sli:correctness:{$minute}", 'total', 1);
            if ($correctness === 'degraded') {
                $pipe->hincrby("sli:correctness:{$minute}", 'incorrect', 1);
            }
            $pipe->expire("sli:correctness:{$minute}", 604800);
        });

        // 移除内部 header，不返回给客户端
        $response->headers->remove('X-SLI-Correctness');

        return $response;
    }
}
```

#### SLI 4：吞吐量（Throughput）

```text
吞吐量 = 单位时间内成功处理的请求数（RPS/RPM）

异常检测：当前吞吐量与历史同期对比，偏差超过阈值视为异常
```

**吞吐量异常检测：**

```php
<?php

namespace App\Services\SRE;

use Illuminate\Support\Facades\Redis;

class ThroughputMonitor
{
    /**
     * 检测当前吞吐量是否异常
     * 对比当前分钟与过去 4 周同星期同时段的平均值
     */
    public function isAnomalous(string $route, int $currentRpm): bool
    {
        $historicalKey = "sli:throughput:history:{$route}:" . now()->format('N-H-i');
        $historicalAvg = Redis::connection('sli')->get($historicalKey);

        if (!$historicalAvg || $historicalAvg == 0) {
            return false; // 没有历史数据，不做判断
        }

        $deviation = abs($currentRpm - (float)$historicalAvg) / (float)$historicalAvg;

        // 吞吐量下降超过 50% 视为异常
        return $deviation > 0.5 && $currentRpm < (float)$historicalAvg;
    }

    /**
     * 更新历史基线（每天凌晨运行）
     */
    public function updateBaseline(): void
    {
        // 使用 EWMA（指数加权移动平均）更新基线
        $alpha = 0.3;
        for ($day = 1; $day <= 7; $day++) {
            for ($hour = 0; $hour < 24; $hour++) {
                for ($minute = 0; $minute < 60; $minute += 5) {
                    $dayStr = now()->subDays($day)->format('Y-m-d');
                    $key = "sli:throughput:{$dayStr}:" . str_pad($hour, 2, '0', STR_PAD_LEFT)
                         . '-' . str_pad($minute, 2, '0', STR_PAD_LEFT);
                    // ... 采集并更新基线
                }
            }
        }
    }
}
```

### 2.3 SLI 采集架构图

```text
┌─────────────────────────────────────────────────────────┐
│                    Laravel API 服务                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 可用性   │  │ 延迟     │  │ 正确性   │  │ 吞吐量  │ │
│  │ 中间件   │  │ 采集器   │  │ 中间件   │  │ 计数器  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │              │      │
│       └──────────────┴──────────────┴──────────────┘     │
│                          │                                │
│                    Redis SLI 存储                         │
└──────────────────────────────┬────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Prometheus Exporter │
                    │  (自定义 Laravel     │
                    │   /metrics 端点)     │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │    Prometheus        │
                    │    (指标采集与存储)   │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │     Grafana          │
                    │  (SLI 可视化面板)    │
                    └─────────────────────┘
```

---

## 三、SLO 制定：为 B2C API 设定合理的可靠性目标

### 3.1 SLO 制定的原则

制定 SLO 不是一个技术决策，而是一个**商业决策**。需要回答的核心问题是：**用户能容忍多大程度的服务降级？**

```text
SLO 制定的三步法：
1. 调研用户期望（用户能接受多慢？能接受多少错误？）
2. 分析历史数据（当前系统能做到什么水平？）
3. 协商确定目标（在用户期望和工程成本之间找平衡）
```

### 3.2 B2C API 的分层 SLO 设计

不同 API 端点对业务的影响不同，应该设定不同的 SLO：

```php
<?php

namespace App\Services\SRE;

class SloDefinition
{
    /**
     * SLO 配置矩阵
     * 每个层级对应不同的业务重要性
     */
    public static function getSloConfig(): array
    {
        return [
            // Tier 1: 核心交易路径（直接产生营收）
            'tier_1' => [
                'description' => '核心交易 API：下单、支付、库存扣减',
                'routes' => [
                    'api/v1/orders.store',
                    'api/v1/payments.process',
                    'api/v1/inventory.decrement',
                ],
                'slo' => [
                    'availability' => 99.95,  // 每月允许 21.9 分钟停机
                    'latency_p95'  => 200,    // P95 响应时间 < 200ms
                    'latency_p99'  => 500,    // P99 响应时间 < 500ms
                    'correctness'  => 99.99,  // 数据正确率 > 99.99%
                ],
                'error_budget_window' => '30d', // 滚动 30 天窗口
            ],

            // Tier 2: 重要业务路径（影响用户体验）
            'tier_2' => [
                'description' => '重要业务 API：商品列表、搜索、购物车',
                'routes' => [
                    'api/v1/products.index',
                    'api/v1/search.query',
                    'api/v1/cart.*',
                ],
                'slo' => [
                    'availability' => 99.9,   // 每月允许 43.8 分钟停机
                    'latency_p95'  => 300,
                    'latency_p99'  => 800,
                    'correctness'  => 99.9,
                ],
                'error_budget_window' => '30d',
            ],

            // Tier 3: 辅助功能（影响较小）
            'tier_3' => [
                'description' => '辅助 API：评论、推荐、用户画像',
                'routes' => [
                    'api/v1/reviews.*',
                    'api/v1/recommendations.*',
                    'api/v1/user-profile.*',
                ],
                'slo' => [
                    'availability' => 99.5,   // 每月允许 3.6 小时停机
                    'latency_p95'  => 500,
                    'latency_p99'  => 1500,
                    'correctness'  => 99.5,
                ],
                'error_budget_window' => '30d',
            ],
        ];
    }
}
```

### 3.3 SLO 与 SLA 的关系

```text
                    SLA（外部承诺）
                   ┌───────────────┐
                   │   99.9%       │ ← 违反需要赔偿
                   │  ┌─────────┐  │
                   │  │  SLO    │  │ ← 内部目标
                   │  │ 99.95%  │  │
                   │  │ ┌─────┐ │  │
                   │  │ │SLI  │ │  │ ← 实际观测
                   │  │ │实测 │ │  │
                   │  │ └─────┘ │  │
                   │  └─────────┘  │
                   └───────────────┘

关键：SLO 应该比 SLA 更严格，留出缓冲空间
```

---

## 四、Error Budget：预算驱动的工程决策

### 4.1 Error Budget 计算

```php
<?php

namespace App\Services\SRE;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class ErrorBudgetCalculator
{
    /**
     * 计算某个 SLO 的 Error Budget 剩余量
     *
     * @param string $tier      SLO 层级 (tier_1, tier_2, tier_3)
     * @param string $sliType   SLI 类型 (availability, latency, correctness)
     * @param string $window    窗口期 (30d, 7d, 1d)
     * @return array            预算消耗情况
     */
    public function calculate(
        string $tier,
        string $sliType,
        string $window = '30d'
    ): array {
        $config = SloDefinition::getSloConfig()[$tier];
        $sloTarget = $config['slo'][$sliType];

        // 窗口期起始时间
        $windowDays = (int) str_replace('d', '', $window);
        $since = Carbon::now()->subDays($windowDays);

        // 获取窗口期内的总事件数和失败事件数
        $stats = $this->getEventStats($config['routes'], $sliType, $since);

        $totalEvents = $stats['total'];
        $failedEvents = $stats['failed'];

        if ($totalEvents === 0) {
            return [
                'tier' => $tier,
                'sli_type' => $sliType,
                'slo_target' => $sloTarget,
                'total_budget' => 0,
                'consumed' => 0,
                'remaining' => 0,
                'remaining_pct' => 100,
                'status' => 'no_data',
            ];
        }

        // 计算允许的错误事件数（Error Budget 总量）
        $totalBudget = $totalEvents * (100 - $sloTarget) / 100;

        // 已消耗的 Error Budget
        $consumed = $failedEvents;

        // 剩余百分比
        $remainingPct = $totalBudget > 0
            ? max(0, round(($totalBudget - $consumed) / $totalBudget * 100, 2))
            : 100;

        return [
            'tier' => $tier,
            'sli_type' => $sliType,
            'slo_target' => $sloTarget,
            'total_events' => $totalEvents,
            'failed_events' => $failedEvents,
            'total_budget' => round($totalBudget, 2),
            'consumed' => round($consumed, 2),
            'remaining' => round($totalBudget - $consumed, 2),
            'remaining_pct' => $remainingPct,
            'status' => $this->getBudgetStatus($remainingPct),
            'calculated_at' => now()->toISOString(),
        ];
    }

    private function getBudgetStatus(float $remainingPct): string
    {
        if ($remainingPct > 50) return 'healthy';
        if ($remainingPct > 20) return 'warning';
        if ($remainingPct > 0)  return 'critical';
        return 'exhausted';
    }

    private function getEventStats(array $routes, string $sliType, Carbon $since): array
    {
        // 从 Redis 或数据库中聚合 SLI 数据
        // 这里简化为从数据库查询
        return DB::table('sli_events')
            ->whereIn('route', $routes)
            ->where('sli_type', $sliType)
            ->where('recorded_at', '>=', $since)
            ->selectRaw('COUNT(*) as total, SUM(CASE WHEN is_failure = 1 THEN 1 ELSE 0 END) as failed')
            ->first()
            ?->toArray() ?? ['total' => 0, 'failed' => 0];
    }
}
```

### 4.2 Error Budget 消耗速率预警

```php
<?php

namespace App\Services\SRE;

use Carbon\Carbon;

class ErrorBudgetBurnRate
{
    /**
     * 计算 Error Budget 消耗速率
     * 如果当前速率持续，预计多久会耗尽预算
     */
    public function calculateBurnRate(
        string $tier,
        string $sliType = 'availability'
    ): array {
        $calculator = new ErrorBudgetCalculator();

        // 多窗口分析：1h, 6h, 1d, 3d, 30d
        $windows = ['1h', '6h', '1d', '3d', '30d'];
        $burnRates = [];

        foreach ($windows as $window) {
            $budget = $calculator->calculate($tier, $sliType, $window);
            $windowDays = max(1, (int) str_replace(['h', 'd'], ['', ''], $window));
            if (str_contains($window, 'h')) {
                $windowDays = $windowDays / 24;
            }

            // 消耗速率 = 已消耗 / (窗口天数 / 30天)
            $rate = $budget['total_budget'] > 0
                ? ($budget['consumed'] / $budget['total_budget']) * (30 / $windowDays)
                : 0;

            $burnRates[$window] = [
                'rate' => round($rate, 4),
                'remaining_pct' => $budget['remaining_pct'],
                'days_to_exhaust' => $rate > 0
                    ? round($budget['remaining'] / ($budget['consumed'] / $windowDays), 1)
                    : null,
            ];
        }

        return $burnRates;
    }

    /**
     * 多窗口告警规则
     * 基于 Google SRE 最佳实践的多窗口多燃烧率告警
     */
    public function shouldAlert(string $tier): array
    {
        $burnRates = $this->calculateBurnRate($tier);
        $alerts = [];

        // 快速燃烧（1h 窗口，14.4x 燃烧率 = 1小时消耗 2% 预算）
        if ($burnRates['1h']['rate'] >= 14.4) {
            $alerts[] = [
                'severity' => 'page',
                'message' => "P0: Error Budget 快速燃烧！1小时内消耗速率 14.4x",
                'action' => '立即响应，启动 Incident Command',
            ];
        }

        // 中速燃烧（6h 窗口，6x 燃烧率）
        if ($burnRates['6h']['rate'] >= 6) {
            $alerts[] = [
                'severity' => 'ticket',
                'message' => "P1: Error Budget 中速燃烧，6小时燃烧率 6x",
                'action' => '创建工单，24小时内处理',
            ];
        }

        // 慢速燃烧（3d 窗口，1x 燃烧率）
        if ($burnRates['3d']['rate'] >= 1) {
            $alerts[] = [
                'severity' => 'email',
                'message' => "P2: Error Budget 慢速消耗，需关注",
                'action' => '发送周报邮件提醒',
            ];
        }

        return $alerts;
    }
}
```

### 4.3 Error Budget 驱动的决策流程

```text
Error Budget 决策矩阵：

┌──────────────┬────────────────────────────────────────────┐
│ 剩余预算      │ 工程决策                                    │
├──────────────┼────────────────────────────────────────────┤
│ > 50% Healthy │ ✅ 正常迭代节奏                              │
│              │ ✅ 可以进行高风险变更（架构重构、数据库迁移）    │
│              │ ✅ 鼓励实验性功能发布                          │
├──────────────┼────────────────────────────────────────────┤
│ 20-50% Warning│ ⚠️  提高 Code Review 标准                   │
│              │ ⚠️  限制同时进行的变更数量                     │
│              │ ⚠️  增加自动化测试覆盖率要求                   │
├──────────────┼────────────────────────────────────────────┤
│ 0-20% Critical│ 🔴 只允许 Bug 修复和安全补丁                  │
│              │ 🔴 冻结非紧急功能发布                          │
│              │ 🔴 启动可靠性专项优化                          │
├──────────────┼────────────────────────────────────────────┤
│ 0% Exhausted │ 🚫 完全冻结发布                              │
│              │ 🚫 所有工程资源投入稳定性修复                   │
│              │ 🚫 管理层 Review 与决策                       │
└──────────────┴────────────────────────────────────────────┘
```

**自动化决策中间件：**

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\SRE\ErrorBudgetCalculator;
use Symfony\Component\HttpFoundation\Response;

class ErrorBudgetGate
{
    public function __construct(
        private ErrorBudgetCalculator $calculator
    ) {}

    /**
     * 发布前检查 Error Budget
     * 集成到 CI/CD 流水线中
     */
    public function handle(Request $request, Closure $next): Response
    {
        // 仅对部署端点生效
        if (!$request->is('api/deploy/*')) {
            return $next($request);
        }

        $tier = $request->input('tier', 'tier_1');
        $budget = $this->calculator->calculate($tier, 'availability');

        if ($budget['status'] === 'exhausted') {
            return response()->json([
                'error' => 'DEPLOYMENT_BLOCKED',
                'message' => 'Error Budget 已耗尽，部署被阻止',
                'budget' => $budget,
                'action' => '请先修复稳定性问题，恢复 Error Budget 后再部署',
            ], 403);
        }

        if ($budget['status'] === 'critical') {
            // 允许部署但增加审批
            $request->attributes->set('_requires_approval', true);
            $request->attributes->set('_budget_status', 'critical');
        }

        return $next($request);
    }
}
```

---

## 五、Prometheus + Grafana 监控 SLI

### 5.1 自定义 Prometheus Exporter

```php
<?php

namespace App\Http\Controllers\SRE;

use Illuminate\Http\Response;
use Illuminate\Support\Facades\Redis;
use App\Services\SRE\ErrorBudgetCalculator;
use App\Services\SRE\SloDefinition;

class PrometheusMetricsController
{
    public function metrics(): Response
    {
        $lines = [];
        $config = SloDefinition::getSloConfig();

        // 可用性指标
        $lines[] = '# HELP sli_availability_ratio Current availability ratio';
        $lines[] = '# TYPE sli_availability_ratio gauge';

        foreach ($config as $tier => $tierConfig) {
            $ratio = $this->getAvailabilityRatio($tierConfig['routes']);
            $lines[] = "sli_availability_ratio{tier=\"{$tier}\"} {$ratio}";
        }

        // 延迟百分位指标
        $lines[] = '# HELP sli_latency_seconds Request latency in seconds';
        $lines[] = '# TYPE sli_latency_seconds summary';

        foreach ($config as $tier => $tierConfig) {
            foreach (['p50', 'p95', 'p99'] as $percentile) {
                $latency = $this->getLatencyPercentile($tierConfig['routes'], $percentile);
                $lines[] = "sli_latency_seconds{tier=\"{$tier}\",quantile=\"{$percentile}\"} {$latency}";
            }
        }

        // Error Budget 剩余百分比
        $lines[] = '# HELP error_budget_remaining_pct Error budget remaining percentage';
        $lines[] = '# TYPE error_budget_remaining_pct gauge';

        $calculator = new ErrorBudgetCalculator();
        foreach ($config as $tier => $tierConfig) {
            $budget = $calculator->calculate($tier, 'availability');
            $lines[] = "error_budget_remaining_pct{tier=\"{$tier}\"} {$budget['remaining_pct']}";
        }

        // SLO 目标值
        $lines[] = '# HELP slo_target SLO target value';
        $lines[] = '# TYPE slo_target gauge';
        foreach ($config as $tier => $tierConfig) {
            foreach ($tierConfig['slo'] as $sliType => $target) {
                $lines[] = "slo_target{tier=\"{$tier}\",sli=\"{$sliType}\"} {$target}";
            }
        }

        return response(implode("\n", $lines) . "\n", 200, [
            'Content-Type' => 'text/plain; version=0.0.4; charset=utf-8',
        ]);
    }

    private function getAvailabilityRatio(array $routes): float
    {
        $minute = now()->format('Y-m-d-H-i');
        $redis = Redis::connection('sli');
        $total = 0;
        $success = 0;

        foreach ($routes as $route) {
            $data = $redis->hgetall("sli:availability:{$minute}:{$route}");
            $total += (int) ($data['total'] ?? 0);
            $success += (int) ($data['success'] ?? 0);
        }

        return $total > 0 ? round($success / $total, 6) : 1.0;
    }

    private function getLatencyPercentile(array $routes, string $percentile): float
    {
        // 从 Redis Sorted Set 中计算百分位
        $minute = now()->format('Y-md-H-i');
        $redis = Redis::connection('sli');
        $allLatencies = [];

        foreach ($routes as $route) {
            $latencies = $redis->zrangebyscore("sli:latency:{$minute}:{$route}", '-inf', '+inf');
            $allLatencies = array_merge($allLatencies, $latencies);
        }

        if (empty($allLatencies)) {
            return 0;
        }

        sort($allLatencies);
        $index = match ($percentile) {
            'p50' => (int) (count($allLatencies) * 0.5),
            'p95' => (int) (count($allLatencies) * 0.95),
            'p99' => (int) (count($allLatencies) * 0.99),
            default => 0,
        };

        return round($allLatencies[min($index, count($allLatencies) - 1)] / 1000, 4);
    }
}
```

### 5.2 Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "sli_rules.yml"
  - "alert_rules.yml"

scrape_configs:
  - job_name: 'laravel-sli'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['laravel-api:8000']
    scrape_interval: 30s

  - job_name: 'redis-sli'
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
```

### 5.3 告警规则配置

```yaml
# alert_rules.yml
groups:
  - name: sli_alerts
    rules:
      # 可用性低于 SLO
      - alert: AvailabilityBelowSLO
        expr: sli_availability_ratio < 0.9995
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Tier 1 可用性低于 SLO (99.95%)"
          description: "当前可用性 {{ $value | humanizePercentage }}，已低于 SLO 目标"

      # P95 延迟超标
      - alert: LatencyP95AboveSLO
        expr: sli_latency_seconds{quantile="p95"} > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "P95 延迟超过 200ms SLO"
          description: "当前 P95 延迟 {{ $value }}s"

      # Error Budget 快速燃烧
      - alert: ErrorBudgetRapidBurn
        expr: error_budget_remaining_pct < 50
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Error Budget 剩余不足 50%"
          description: "Tier {{ $labels.tier }} 剩余 {{ $value }}%"

      # Error Budget 耗尽
      - alert: ErrorBudgetExhausted
        expr: error_budget_remaining_pct <= 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "🚨 Error Budget 已耗尽！"
          description: "所有非紧急发布应立即冻结"
```

### 5.4 Grafana Dashboard 配置

```json
{
  "dashboard": {
    "title": "SRE SLI/SLO Dashboard - Laravel B2C API",
    "panels": [
      {
        "title": "可用性 SLO 状态",
        "type": "stat",
        "targets": [
          {
            "expr": "sli_availability_ratio{tier=\"tier_1\"} * 100",
            "legendFormat": "Tier 1 可用性"
          }
        ],
        "thresholds": {
          "steps": [
            { "value": 0, "color": "red" },
            { "value": 99.9, "color": "yellow" },
            { "value": 99.95, "color": "green" }
          ]
        }
      },
      {
        "title": "Error Budget 剩余",
        "type": "gauge",
        "targets": [
          {
            "expr": "error_budget_remaining_pct",
            "legendFormat": "{{ tier }}"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                { "value": 0, "color": "red" },
                { "value": 20, "color": "orange" },
                { "value": 50, "color": "yellow" },
                { "value": 80, "color": "green" }
              ]
            }
          }
        }
      }
    ]
  }
}
```

---

## 六、PagerDuty 集成与告警通知

### 6.1 告警升级策略

```php
<?php

namespace App\Services\SRE;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PagerDutyIntegration
{
    private string $routingKey;
    private string $apiUrl = 'https://events.pagerduty.com/v2/enqueue';

    public function __construct()
    {
        $this->routingKey = config('services.pagerduty.routing_key');
    }

    /**
     * 发送告警到 PagerDuty
     */
    public function triggerAlert(array $alert): void
    {
        $severity = match ($alert['severity'] ?? 'info') {
            'page'    => 'critical',
            'ticket'  => 'warning',
            'email'   => 'info',
            default   => 'info',
        };

        $payload = [
            'routing_key' => $this->routingKey,
            'event_action' => 'trigger',
            'dedup_key' => md5($alert['message']),
            'payload' => [
                'summary' => $alert['message'],
                'severity' => $severity,
                'source' => 'laravel-b2c-api',
                'component' => $alert['tier'] ?? 'unknown',
                'group' => 'sre-slo',
                'class' => 'error_budget',
                'custom_details' => [
                    'action_required' => $alert['action'] ?? '',
                    'slo_tier' => $alert['tier'] ?? '',
                    'budget_remaining' => $alert['budget_remaining'] ?? '',
                ],
            ],
            'links' => [
                [
                    'href' => config('app.url') . '/admin/sre/dashboard',
                    'text' => 'SRE Dashboard',
                ],
            ],
        ];

        try {
            $response = Http::timeout(5)->post($this->apiUrl, $payload);

            if (!$response->successful()) {
                Log::error('PagerDuty alert failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
            }
        } catch (\Exception $e) {
            Log::error('PagerDuty alert exception', ['error' => $e->getMessage()]);
        }
    }

    /**
     * 自动升级：根据 Error Budget 状态调整告警级别
     */
    public function autoEscalate(string $tier): void
    {
        $burnRate = new ErrorBudgetBurnRate();
        $alerts = $burnRate->shouldAlert($tier);

        foreach ($alerts as $alert) {
            $alert['tier'] = $tier;
            $this->triggerAlert($alert);
        }
    }
}
```

### 6.2 告警路由与升级时间线

```text
告警升级时间线（以 Tier 1 为例）：

T+0min   触发告警 → PagerDuty 通知 On-Call 工程师（电话 + 短信 + App 推送）
T+5min   未响应 → 升级到 Backup On-Call 工程师
T+15min  未响应 → 升级到 Team Lead
T+30min  未响应 → 升级到 Engineering Manager
T+60min  未响应 → 升级到 VP of Engineering

每次升级自动创建 Incident，同步到 Slack #incidents 频道
```

---

## 七、Error Budget 耗尽后的决策流程

### 7.1 自动化发布冻结

```php
<?php

namespace App\Services\CI;

use App\Services\SRE\ErrorBudgetCalculator;
use App\Services\SRE\PagerDutyIntegration;

class DeploymentGate
{
    public function __construct(
        private ErrorBudgetCalculator $calculator,
        private PagerDutyIntegration $pagerDuty,
    ) {}

    /**
     * CI/CD 流水线调用：检查是否允许部署
     */
    public function checkDeploymentAllowed(string $tier = 'tier_1'): array
    {
        $budget = $this->calculator->calculate($tier, 'availability');

        return match ($budget['status']) {
            'healthy' => [
                'allowed' => true,
                'requires_approval' => false,
                'message' => '✅ Error Budget 充足，可以正常部署',
            ],
            'warning' => [
                'allowed' => true,
                'requires_approval' => true,
                'message' => '⚠️ Error Budget 消耗过半，需要 Tech Lead 审批',
            ],
            'critical' => [
                'allowed' => false,
                'requires_approval' => true,
                'message' => '🔴 Error Budget 严重不足，仅允许 Bug 修复。需要 Engineering Manager 审批',
                'exception_process' => '填写例外审批表，说明变更的必要性和风险评估',
            ],
            'exhausted' => [
                'allowed' => false,
                'requires_approval' => false,
                'message' => '🚫 Error Budget 已耗尽，所有非安全修复的发布被冻结',
                'action_required' => '全团队转向稳定性修复，直到 Error Budget 恢复到 20% 以上',
            ],
            default => ['allowed' => false, 'message' => '未知状态'],
        };
    }
}
```

### 7.2 恢复策略

```text
Error Budget 恢复路径：

1. 问题定位
   - 分析 SLI 哪个指标消耗了最多预算
   - 定位 Top N 故障事件的根本原因

2. 快速止血
   - 回滚最近的变更
   - 启用降级方案（缓存降级、限流）
   - 扩容缓解容量压力

3. 根因修复
   - 修复导致 Error Budget 消耗的代码缺陷
   - 增加对应的自动化测试
   - 更新 Runbook 和告警规则

4. 预算恢复
   - SLO 窗口期滚动，旧的失败事件逐渐滑出窗口
   - 新的成功事件持续稀释历史错误
   - 当预算恢复到 20% 以上时解除发布冻结
```

---

## 八、真实踩坑案例与最佳实践

### 8.1 案例：SLO 设置过严导致团队瘫痪

**场景**：某团队为所有 API 统一设置了 99.99% 的可用性 SLO。

**问题**：
- 搜索接口因为 ES 集群抖动频繁触发告警
- 一个搜索超时就消耗大量 Error Budget
- 团队花大量时间处理搜索告警，反而影响了核心交易路径的维护

**解决方案**：
- 分层 SLO 设计（如本文第三节所述）
- 搜索接口降为 Tier 3（99.5% SLO）
- 核心交易路径保持 Tier 1（99.95% SLO）

### 8.2 案例：Error Budget 计算窗口选择不当

**场景**：使用 7 天滚动窗口计算 Error Budget。

**问题**：周一的流量高峰产生的错误，在下周一就"过期"了，但同类问题每周都会重现。

**解决方案**：
- 对告警使用多窗口策略（1h、6h、1d、3d、30d）
- 短窗口捕捉突发问题，长窗口捕捉慢性问题
- 定期 Review 历史 Error Budget 趋势

### 8.3 最佳实践清单

```text
✅ 做对的事：
- 分层 SLO，核心路径和辅助路径区别对待
- 多窗口告警，避免误报和漏报
- Error Budget 与 CI/CD 流水线集成
- 定期 Review SLO 目标（至少每季度一次）
- 建立无责 Postmortem 文化

❌ 避免的坑：
- 不要为所有服务设置相同的 SLO
- 不要用 SLI 代替 SLO（"系统 CPU 使用率 80%"不是 SLO）
- 不要忽视 Error Budget 的快消耗（短窗口告警很重要）
- 不要把 Error Budget 当作惩罚工具，而是决策辅助工具
- 不要跳过 Postmortem，即使 Error Budget 充足
```

---

## 九、与 CI/CD 流水线的集成

### 9.1 GitHub Actions 集成示例

```yaml
# .github/workflows/deploy.yml
name: Deploy with SLO Gate

on:
  push:
    branches: [main]

jobs:
  slo-check:
    runs-on: ubuntu-latest
    outputs:
      deployment_allowed: ${{ steps.slo.outputs.allowed }}
    steps:
      - name: Check Error Budget
        id: slo
        run: |
          RESPONSE=$(curl -s -H "Authorization: Bearer ${{ secrets.API_TOKEN }}" \
            "${{ secrets.API_URL }}/api/deploy/slo-check?tier=tier_1")

          ALLOWED=$(echo $RESPONSE | jq -r '.allowed')
          echo "allowed=$ALLOWED" >> $GITHUB_OUTPUT

          if [ "$ALLOWED" = "false" ]; then
            echo "::error::部署被 Error Budget 策略阻止"
            echo "详情: $(echo $RESPONSE | jq -r '.message')"
            exit 1
          fi

  deploy:
    needs: slo-check
    if: needs.slo-check.outputs.deployment_allowed == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Production
        run: |
          echo "Error Budget 检查通过，开始部署..."
          # 部署逻辑

      - name: Post-deploy SLO Verification
        run: |
          sleep 60  # 等待 1 分钟
          # 检查部署后的 SLI 是否正常
          curl -s "${{ secrets.API_URL }}/api/sli/check?window=1m"
```

---

## 十、总结

SRE 不是一个工具或技术，而是一套**用数据驱动运维决策的方法论**。在 Laravel B2C API 项目中落地 SRE，核心要素包括：

1. **SLI**：选择用户可感知的指标（可用性、延迟、正确性、吞吐量）
2. **SLO**：分层设定目标，核心交易路径 SLO 更严格
3. **Error Budget**：量化"犯错空间"，用预算驱动发布决策
4. **自动化**：将 SLO 检查集成到 CI/CD 流水线
5. **文化**：建立无责复盘文化，从每次故障中学习

记住：**SLO 不是越高越好**。99.95% 的 SLO 意味着每月允许 21.9 分钟的停机，这给了团队足够的空间进行创新和实验。追求 99.999% 的 SLO 意味着每月只能停机 26 秒，这几乎不可能在保持快速迭代的同时实现。

从今天开始，为你最重要的 API 端点定义第一个 SLI 和 SLO，然后让 Error Budget 指导你的工程决策。

---

> **参考资源**
>
> - Google SRE Book: https://sre.google/sre-book/table-of-contents/
> - Google SRE Workbook: https://sre.google/workbook/table-of-contents/
> - Prometheus Documentation: https://prometheus.io/docs/
> - PagerDuty Integration Guide: https://developer.pagerduty.com/
> - Grafana SRE Dashboard Templates: https://grafana.com/grafana/dashboards/

## 相关阅读

- [工程效能度量实战：DORA 四大指标在 Laravel 团队中的落地](/categories/07_CICD/工程效能度量实战-DORA四大指标-Laravel团队落地/)
- [Incident Command 实战：生产故障应急响应——PagerDuty、War Room 与 Postmortem](/categories/06_运维/Incident-Command-实战-生产故障应急响应-PagerDuty-WarRoom-Postmortem/)
- [Sentry Error Tracking 实战：性能监控与 Session Replay 在 Laravel 中的落地](/categories/06_运维/2026-06-02-sentry-error-tracking-performance-monitoring-session-replay-laravel/)
