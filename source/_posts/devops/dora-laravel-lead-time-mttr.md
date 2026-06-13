---
title: '工程效能度量实战：DORA 四大指标在 Laravel 团队中的落地——Lead Time、部署频率与 MTTR'
date: 2026-06-02 10:00:00
tags: [DORA, 工程效能, DevOps, CI/CD, Laravel, 度量]
keywords: [DORA, Laravel, Lead Time, MTTR, 工程效能度量实战, 四大指标在, 团队中的落地, 部署频率与, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 本文基于 Laravel B2C 项目实战，完整落地 DORA 四大核心指标——部署频率、变更前置时间、变更失败率和 MTTR。涵盖 GitHub Actions 自动采集、Prometheus 可视化、Grafana 看板搭建，以及 Error Budget 驱动的工程决策。提供可运行的 PHP 代码实现，帮助团队从低效迈向精英级交付效能，用数据而非直觉来驱动持续改进。
---


## 前言

"我们团队的交付速度到底怎么样？"——这个问题看似简单，却困扰着无数工程团队的管理者。有人说"我们每周都发布"，有人说"我们的 Bug 很少"，但这些模糊的描述无法支撑工程决策。

2018 年，Nicole Forsgren、Jez Humble 和 Gene Kim 在《Accelerate》一书中提出了 DORA（DevOps Research and Assessment）四大指标，经过对全球数千个团队的研究验证，这四个指标能够准确预测软件交付效能和组织绩效。

本文将基于一个 Laravel B2C 项目的实战经验，完整落地 DORA 四大指标的采集、可视化和持续改进。

---

## 一、DORA 指标概述

### 1.1 四大指标定义

| 指标 | 定义 | 衡量什么 |
|------|------|---------|
| Deployment Frequency（部署频率） | 单位时间内成功部署到生产的次数 | 发布的节奏和批量大小 |
| Lead Time for Changes（变更前置时间） | 从代码提交到成功部署到生产的时间 | 交付流程的效率 |
| Change Failure Rate（变更失败率） | 导致生产故障或需要回滚的部署占比 | 发布质量 |
| Mean Time to Recovery（MTTR） | 从生产故障到恢复服务的时间 | 系统韧性和应急能力 |

### 1.2 行业基准

```text
根据《Accelerate》和 Google DORA Report：

                    低效          中等          高效          精英
┌──────────────────────────────────────────────────────────────┐
│ 部署频率      < 1次/月     1次/月-1次/周  1次/周-1次/天  > 1次/天 │
│ 前置时间      > 1个月      1周-1个月     1天-1周       < 1天    │
│ 变更失败率    > 30%        16-30%       0-15%         0-15%   │
│ MTTR          > 1周        1天-1周      < 1天         < 1小时  │
└──────────────────────────────────────────────────────────────┘

精英团队的特点：
- 部署频率：按需部署，每天多次
- 前置时间：< 1 小时（从 commit 到 production）
- 变更失败率：< 5%
- MTTR：< 1 小时
```

### 1.3 指标之间的关系

```text
四个指标相互关联，形成正向循环：

更高的部署频率
    → 更小的变更批次
    → 更低的变更失败率
    → 更快的恢复时间（因为变更范围小，容易定位问题）

反过来说：
更低的部署频率
    → 更大的变更批次
    → 更高的变更失败率
    → 更慢的恢复时间

核心洞察：小步快跑比大批量发布更安全
```

---

## 二、Deployment Frequency（部署频率）

### 2.1 定义与计算

```text
部署频率 = 单位时间内成功部署到生产环境的次数

关键点：
- 只计算"成功部署"，失败的部署不计入
- "部署到生产"才算，staging 环境不算
- 手动发布和自动发布都计入
- 同一个功能的多次部署分别计算
```

### 2.2 采集实现：GitHub Actions 集成

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy
        id: deploy
        run: |
          echo "Deploying to production..."
          # 实际部署逻辑
          echo "deploy_success=true" >> $GITHUB_OUTPUT
          echo "deploy_id=$(date +%s)" >> $GITHUB_OUTPUT

      # 记录部署事件到数据库
      - name: Record Deployment Metric
        if: steps.deploy.outputs.deploy_success == 'true'
        run: |
          curl -X POST "${{ secrets.API_URL }}/api/metrics/deployment" \
            -H "Authorization: Bearer ${{ secrets.METRICS_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{
              "event_type": "deployment",
              "environment": "production",
              "commit_sha": "${{ github.sha }}",
              "commit_message": "${{ github.event.head_commit.message }}",
              "branch": "${{ github.ref_name }}",
              "actor": "${{ github.actor }}",
              "workflow_run_id": "${{ github.run_id }}",
              "deployed_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
            }'
```

### 2.3 数据存储与查询

```php
<?php

namespace App\Models\Metrics;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class DeploymentEvent extends Model
{
    use HasFactory;

    protected $fillable = [
        'event_type',
        'environment',
        'commit_sha',
        'commit_message',
        'branch',
        'actor',
        'workflow_run_id',
        'deployed_at',
        'is_rollback',
        'failure_reason',
    ];

    protected $casts = [
        'deployed_at' => 'datetime',
        'is_rollback' => 'boolean',
    ];

    /**
     * 计算指定时间范围内的部署频率
     */
    public static function calculateFrequency(
        string $period = '7d',
        string $environment = 'production'
    ): array {
        $days = (int) str_replace('d', '', $period);
        $since = now()->subDays($days);

        $totalDeployments = self::where('environment', $environment)
            ->where('deployed_at', '>=', $since)
            ->where('is_rollback', false)
            ->count();

        $dailyBreakdown = self::where('environment', $environment)
            ->where('deployed_at', '>=', $since)
            ->where('is_rollback', false)
            ->selectRaw('DATE(deployed_at) as date, COUNT(*) as count')
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        return [
            'period' => $period,
            'total_deployments' => $totalDeployments,
            'avg_per_day' => round($totalDeployments / max(1, $days), 2),
            'avg_per_week' => round($totalDeployments / max(1, $days / 7), 2),
            'daily_breakdown' => $dailyBreakdown,
            'rating' => self::rateFrequency($totalDeployments / max(1, $days)),
        ];
    }

    private static function rateFrequency(float $perDay): string
    {
        if ($perDay >= 1) return 'elite';      // 每天多次
        if ($perDay >= 0.14) return 'high';    // 每周一次
        if ($perDay >= 0.03) return 'medium';  // 每月一次
        return 'low';                           // 低于每月一次
    }
}
```

---

## 三、Lead Time for Changes（变更前置时间）

### 3.1 定义与分段

```text
Lead Time = 从代码提交（commit）到成功部署到生产的时间

拆分为四个阶段：

commit ──→ PR 创建 ──→ PR 合并 ──→ 部署到生产
  │            │           │           │
  └─ 开发时间 ─┘           │           │
                  └─ Review 时间 ──────┘
                                    └─ 部署时间 ─┘

每个阶段的优化方向：
- 开发时间：更小的 PR、更好的任务拆分
- Review 时间：异步 Review、自动化检查
- 部署时间：自动化 CI/CD、更快的构建
```

### 3.2 全链路追踪实现

```php
<?php

namespace App\Services\Metrics;

use App\Models\Metrics\DeploymentEvent;
use Illuminate\Support\Facades\DB;

class LeadTimeCalculator
{
    /**
     * 计算指定部署的 Lead Time
     */
    public function calculateForDeployment(int $deploymentId): array
    {
        $deployment = DeploymentEvent::findOrFail($deploymentId);
        $commitSha = $deployment->commit_sha;

        // 通过 GitHub API 获取 commit 信息
        $commitInfo = $this->getGitHubCommitInfo($commitSha);

        $commitTime = new \DateTime($commitInfo['commit']['author']['date']);
        $deployTime = $deployment->deployed_at;

        $leadTimeMinutes = ($deployTime->getTimestamp() - $commitTime->getTimestamp()) / 60;

        // 分段计算
        $stages = $this->calculateStageTimes($commitSha, $deployment);

        return [
            'deployment_id' => $deploymentId,
            'commit_sha' => $commitSha,
            'commit_time' => $commitTime->format('Y-m-d H:i:s'),
            'deploy_time' => $deployTime->format('Y-m-d H:i:s'),
            'lead_time_minutes' => round($leadTimeMinutes, 2),
            'lead_time_hours' => round($leadTimeMinutes / 60, 2),
            'lead_time_days' => round($leadTimeMinutes / 1440, 2),
            'stages' => $stages,
            'rating' => $this->rateLeadTime($leadTimeMinutes),
        ];
    }

    /**
     * 计算团队平均 Lead Time
     */
    public function calculateTeamAverage(string $period = '30d'): array
    {
        $days = (int) str_replace('d', '', $period);
        $since = now()->subDays($days);

        $deployments = DeploymentEvent::where('environment', 'production')
            ->where('is_rollback', false)
            ->where('deployed_at', '>=', $since)
            ->get();

        $leadTimes = [];
        foreach ($deployments as $deployment) {
            try {
                $result = $this->calculateForDeployment($deployment->id);
                $leadTimes[] = $result['lead_time_minutes'];
            } catch (\Exception $e) {
                // 跳过无法计算的部署
                continue;
            }
        }

        if (empty($leadTimes)) {
            return ['error' => 'No data available'];
        }

        sort($leadTimes);
        $count = count($leadTimes);

        return [
            'period' => $period,
            'total_deployments' => $count,
            'avg_minutes' => round(array_sum($leadTimes) / $count, 2),
            'median_minutes' => $leadTimes[(int) ($count * 0.5)],
            'p95_minutes' => $leadTimes[(int) ($count * 0.95)],
            'min_minutes' => min($leadTimes),
            'max_minutes' => max($leadTimes),
            'rating' => $this->rateLeadTime(array_sum($leadTimes) / $count),
        ];
    }

    private function calculateStageTimes(string $commitSha, DeploymentEvent $deployment): array
    {
        // 从 GitHub API 和 CI 日志中提取各阶段时间
        return [
            'commit_to_pr' => null,    // 需要 PR webhook 数据
            'pr_to_merge' => null,     // 需要 PR webhook 数据
            'merge_to_deploy' => null, // 需要 CI/CD 日志
        ];
    }

    private function getGitHubCommitInfo(string $sha): array
    {
        $response = \Illuminate\Support\Facades\Http::withHeaders([
            'Authorization' => 'token ' . config('services.github.token'),
            'Accept' => 'application/vnd.github.v3+json',
        ])->get("https://api.github.com/repos/{owner}/{repo}/commits/{$sha}");

        return $response->json();
    }

    private function rateLeadTime(float $minutes): string
    {
        if ($minutes < 1440) return 'elite';   // < 1 天
        if ($minutes < 10080) return 'high';   // < 1 周
        if ($minutes < 43200) return 'medium'; // < 1 月
        return 'low';
    }
}
```

### 3.3 Lead Time 优化策略

```text
优化 Lead Time 的实战策略：

1. 缩短开发阶段
   - 更小的 User Story 拆分（每个 Story < 2 天）
   - 使用 Feature Flag 实现渐进式开发
   - 每天至少 commit 一次，避免大批量积压

2. 缩短 Review 阶段
   - PR 大小控制在 200 行以内（Review 效率最高的区间）
   - 设置 Review SLA：工作时间内 4 小时完成
   - CI 自动检查通过后再分配 Reviewer（避免浪费 Review 时间）

3. 缩短部署阶段
   - 自动化 CI/CD 流水线
   - 并行运行测试（Laravel 支持并行测试）
   - 增量部署（只部署变更的部分）
   - 蓝绿部署或金丝雀发布减少部署风险

目标：从 commit 到 production < 4 小时（精英团队）
```

---

## 四、Change Failure Rate（变更失败率）

### 4.1 定义与判定标准

```text
变更失败率 = 导致故障的部署数 / 总部署数 × 100%

"导致故障"的判定标准：
- 部署后触发了 P0/P1 告警
- 需要执行回滚操作
- 部署后 1 小时内出现 5xx 错误率飙升
- 需要紧急 Hotfix 修复

注意：
- 不包括部署失败（CI 红灯未部署到生产的不算）
- 不包括已知的预期问题（如数据库迁移导致的短暂不可用）
```

### 4.2 自动化判定实现

```php
<?php

namespace App\Services\Metrics;

use App\Models\Metrics\DeploymentEvent;
use Illuminate\Support\Facades\Http;

class ChangeFailureRateCalculator
{
    /**
     * 自动标记部署是否导致故障
     * 在部署后 1 小时自动运行
     */
    public function evaluateRecentDeployment(int $deploymentId): void
    {
        $deployment = DeploymentEvent::findOrFail($deploymentId);
        $deployTime = $deployment->deployed_at;

        // 检查部署后 1 小时内的指标
        $windowStart = $deployTime->copy();
        $windowEnd = $deployTime->copy()->addHour();

        $failureIndicators = [];

        // 检查 1：是否有回滚事件
        $hasRollback = DeploymentEvent::where('environment', 'production')
            ->where('is_rollback', true)
            ->whereBetween('deployed_at', [$windowStart, $windowEnd->addHour()])
            ->exists();

        if ($hasRollback) {
            $failureIndicators[] = 'rollback_detected';
        }

        // 检查 2：5xx 错误率是否飙升
        $errorRateSpike = $this->checkErrorRateSpike($windowStart, $windowEnd);
        if ($errorRateSpike) {
            $failureIndicators[] = 'error_rate_spike';
        }

        // 检查 3：是否有紧急 Hotfix commit
        $hasHotfix = $this->checkHotfixCommit($deployment->commit_sha, $windowEnd);
        if ($hasHotfix) {
            $failureIndicators[] = 'hotfix_followed';
        }

        // 更新部署记录
        $isFailure = !empty($failureIndicators);
        $deployment->update([
            'is_failure' => $isFailure,
            'failure_indicators' => $failureIndicators,
            'evaluated_at' => now(),
        ]);
    }

    /**
     * 计算团队变更失败率
     */
    public function calculate(string $period = '30d'): array
    {
        $days = (int) str_replace('d', '', $period);
        $since = now()->subDays($days);

        $total = DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>=', $since)
            ->count();

        $failures = DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>=', $since)
            ->where('is_failure', true)
            ->count();

        $rate = $total > 0 ? round($failures / $total * 100, 2) : 0;

        return [
            'period' => $period,
            'total_deployments' => $total,
            'failed_deployments' => $failures,
            'failure_rate_pct' => $rate,
            'rating' => $this->rateFailureRate($rate),
        ];
    }

    private function checkErrorRateSpike(\Carbon\Carbon $start, \Carbon\Carbon $end): bool
    {
        // 查询 Prometheus 或日志系统
        // 简化实现：检查数据库中的错误日志数量
        $errorCount = \DB::table('error_logs')
            ->whereBetween('created_at', [$start, $end])
            ->where('level', 'error')
            ->count();

        // 阈值：1 小时内超过 50 个 5xx 错误
        return $errorCount > 50;
    }

    private function checkHotfixCommit(string $deploySha, \Carbon\Carbon $until): bool
    {
        return DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>', $deploySha)
            ->where('deployed_at', '<=', $until)
            ->where('commit_message', 'LIKE', '%hotfix%')
            ->exists();
    }

    private function rateFailureRate(float $rate): string
    {
        if ($rate <= 5) return 'elite';
        if ($rate <= 10) return 'high';
        if ($rate <= 15) return 'medium';
        return 'low';
    }
}
```

### 4.3 降低变更失败率的策略

```text
降低变更失败率的工程实践：

1. 自动化质量门禁
   - PHPUnit 单元测试（覆盖率 > 80%）
   - Pest Feature 测试（核心 API 100% 覆盖）
   - PHPStan Level 8 静态分析
   - Laravel Pint 代码风格检查
   - 安全扫描（依赖漏洞、SQL 注入检测）

2. 渐进式发布
   - Feature Flag 控制新功能的灰度发布
   - 金丝雀发布：先部署到 5% 的服务器
   - 自动化回滚：监控指标异常自动回滚

3. 预发布验证
   - Staging 环境与生产环境配置一致
   - 自动化 Smoke Test
   - 数据一致性校验

4. 变更管理
   - 小批量发布（每次 PR < 200 行）
   - 高风险变更单独发布（不和其他功能捆绑）
   - 数据库迁移与代码变更分离部署
```

---

## 五、Mean Time to Recovery（MTTR）

### 5.1 定义

```text
MTTR = 从故障发生到服务恢复的平均时间

拆分为四个阶段：

故障发生 ──→ 检测到故障 ──→ 定位根因 ──→ 修复并恢复
  │              │              │              │
  └─ 检测时间 ──┘              │              │
                   ── 诊断时间 ─┘              │
                                 ── 修复时间 ──┘

MTTR = 检测时间 + 诊断时间 + 修复时间

优化方向：
- 检测时间：更好的监控和告警（目标 < 5 分钟）
- 诊断时间：可观测性工具、故障排查 Checklist（目标 < 15 分钟）
- 修复时间：自动化回滚、Runbook、预设降级方案（目标 < 30 分钟）
```

### 5.2 MTTR 采集实现

```php
<?php

namespace App\Models\Metrics;

use Illuminate\Database\Eloquent\Model;
use Carbon\Carbon;

class IncidentEvent extends Model
{
    protected $fillable = [
        'incident_id',
        'severity',          // P0, P1, P2, P3
        'title',
        'detected_at',       // 故障发生/检测时间
        'acknowledged_at',   // 响应确认时间
        'resolved_at',       // 恢复时间
        'root_cause',
        'detection_method',  // alert | manual | customer_report
        'resolution_method', // rollback | hotfix | scaling | config_change
        'affected_services',
        'created_by',
    ];

    protected $casts = [
        'detected_at' => 'datetime',
        'acknowledged_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];

    /**
     * 计算 MTTR（分钟）
     */
    public function getRecoveryTimeMinutesAttribute(): ?float
    {
        if (!$this->resolved_at || !$this->detected_at) {
            return null;
        }
        return $this->detected_at->diffInMinutes($this->resolved_at);
    }

    /**
     * 计算团队平均 MTTR
     */
    public static function calculateTeamMTTR(
        string $period = '30d',
        string $severity = null
    ): array {
        $days = (int) str_replace('d', '', $period);
        $since = now()->subDays($days);

        $query = self::where('detected_at', '>=', $since)
            ->whereNotNull('resolved_at');

        if ($severity) {
            $query->where('severity', $severity);
        }

        $incidents = $query->get();

        if ($incidents->isEmpty()) {
            return ['error' => 'No incidents in this period', 'mttr_minutes' => 0];
        }

        $recoveryTimes = $incidents->map(function ($incident) {
            return $incident->recovery_time_minutes;
        })->filter()->values();

        $sorted = $recoveryTimes->sort();
        $count = $sorted->count();

        return [
            'period' => $period,
            'total_incidents' => $count,
            'avg_minutes' => round($sorted->avg(), 2),
            'median_minutes' => round($sorted[$count * 0.5] ?? 0, 2),
            'p95_minutes' => round($sorted[$count * 0.95] ?? 0, 2),
            'min_minutes' => round($sorted->min(), 2),
            'max_minutes' => round($sorted->max(), 2),
            'rating' => self::rateMTTR($sorted->avg()),
        ];
    }

    private static function rateMTTR(float $minutes): string
    {
        if ($minutes < 60) return 'elite';     // < 1 小时
        if ($minutes < 1440) return 'high';    // < 1 天
        if ($minutes < 10080) return 'medium'; // < 1 周
        return 'low';
    }
}
```

### 5.3 MTTR 优化实战

```text
缩短 MTTR 的工程实践：

1. 缩短检测时间
   - 部署后自动运行 Smoke Test（< 2 分钟确认服务正常）
   - 多维度监控：HTTP 状态码、响应延迟、错误日志、业务指标
   - 合成监控（Synthetic Monitoring）：模拟用户行为定期探测
   - 告警聚合：避免告警风暴淹没真正的问题

2. 缩短诊断时间
   - 可观测性三支柱：Metrics + Logs + Traces
   - Laravel Telescope（开发环境）+ 日志聚合（生产环境）
   - 分布式追踪：跨服务调用链路追踪
   - 标准化故障排查 Checklist

3. 缩短修复时间
   - 自动化回滚：部署脚本内置回滚能力
   - 预设降级方案：Feature Flag 快速关闭问题功能
   - Runbook 自动化：常见故障的自动修复脚本
   - 蓝绿部署：秒级切换到健康版本
```

---

## 六、数据采集与存储架构

### 6.1 完整架构图

```text
数据源层：
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ GitHub       │  │ Laravel API  │  │ PagerDuty    │
│ - Push Event │  │ - 请求日志   │  │ - 告警事件   │
│ - PR Event   │  │ - 部署记录   │  │ - 事故记录   │
│ - Workflow    │  │ - 错误日志   │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                  │
       └─────────────────┼──────────────────┘
                         │
                    Webhook / API
                         │
               ┌─────────┴─────────┐
               │  Metrics Service   │
               │  (Laravel App)     │
               │                    │
               │  /api/metrics/*    │
               └─────────┬─────────┘
                         │
                    ┌────┴────┐
                    │ MySQL   │
                    │ metrics │
                    │ 数据库  │
                    └────┬────┘
                         │
               ┌─────────┴─────────┐
               │  Prometheus        │
               │  Exporter          │
               │  /metrics          │
               └─────────┬─────────┘
                         │
               ┌─────────┴─────────┐
               │  Grafana           │
               │  Dashboard         │
               └───────────────────┘
```

### 6.2 数据库 Schema

```php
// database/migrations/2026_06_01_create_dora_metrics_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 部署事件表
        Schema::create('deployment_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_type', 20); // deploy, rollback
            $table->string('environment', 20);
            $table->string('commit_sha', 40);
            $table->text('commit_message')->nullable();
            $table->string('branch', 100);
            $table->string('actor', 100);
            $table->string('workflow_run_id', 50)->nullable();
            $table->timestamp('deployed_at');
            $table->boolean('is_rollback')->default(false);
            $table->boolean('is_failure')->nullable();
            $table->json('failure_indicators')->nullable();
            $table->timestamp('evaluated_at')->nullable();
            $table->timestamps();

            $table->index(['environment', 'deployed_at']);
            $table->index('commit_sha');
        });

        // 事故事件表
        Schema::create('incident_events', function (Blueprint $table) {
            $table->id();
            $table->string('incident_id', 50)->unique();
            $table->string('severity', 5); // P0-P3
            $table->string('title');
            $table->timestamp('detected_at');
            $table->timestamp('acknowledged_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->text('root_cause')->nullable();
            $table->string('detection_method', 30);
            $table->string('resolution_method', 30)->nullable();
            $table->json('affected_services')->nullable();
            $table->string('created_by', 100);
            $table->timestamps();

            $table->index(['severity', 'detected_at']);
        });

        // DORA 评分快照表（每日计算一次）
        Schema::create('dora_score_snapshots', function (Blueprint $table) {
            $table->id();
            $table->date('snapshot_date');
            $table->string('period', 10); // 7d, 30d
            $table->integer('deployment_frequency');
            $table->decimal('lead_time_hours', 10, 2);
            $table->decimal('change_failure_rate', 5, 2);
            $table->decimal('mttr_hours', 10, 2);
            $table->string('overall_rating', 10); // elite, high, medium, low
            $table->json('details')->nullable();
            $table->timestamps();

            $table->unique(['snapshot_date', 'period']);
        });
    }
};
```

---

## 七、Grafana Dashboard 搭建

### 7.1 Prometheus Exporter

```php
<?php

namespace App\Http\Controllers\Metrics;

use App\Models\Metrics\DeploymentEvent;
use App\Models\Metrics\IncidentEvent;
use Illuminate\Http\Response;

class DoraMetricsController
{
    public function metrics(): Response
    {
        $lines = [];

        // === 部署频率 ===
        $lines[] = '# HELP dora_deployment_frequency_total Total deployments in period';
        $lines[] = '# TYPE dora_deployment_frequency_total gauge';

        $weekFreq = DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>=', now()->subDays(7))
            ->where('is_rollback', false)
            ->count();
        $lines[] = "dora_deployment_frequency_total{period=\"7d\"} {$weekFreq}";

        $monthFreq = DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>=', now()->subDays(30))
            ->where('is_rollback', false)
            ->count();
        $lines[] = "dora_deployment_frequency_total{period=\"30d\"} {$monthFreq}";

        // === 变更失败率 ===
        $lines[] = '# HELP dora_change_failure_rate_pct Change failure rate percentage';
        $lines[] = '# TYPE dora_change_failure_rate_pct gauge';

        $total30d = DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>=', now()->subDays(30))->count();
        $failures30d = DeploymentEvent::where('environment', 'production')
            ->where('deployed_at', '>=', now()->subDays(30))
            ->where('is_failure', true)->count();
        $failureRate = $total30d > 0 ? round($failures30d / $total30d * 100, 2) : 0;
        $lines[] = "dora_change_failure_rate_pct{period=\"30d\"} {$failureRate}";

        // === MTTR ===
        $lines[] = '# HELP dora_mttr_hours Mean Time to Recovery in hours';
        $lines[] = '# TYPE dora_mttr_hours gauge';

        $incidents = IncidentEvent::where('detected_at', '>=', now()->subDays(30))
            ->whereNotNull('resolved_at')
            ->get();

        if ($incidents->isNotEmpty()) {
            $avgMttr = $incidents->avg(function ($inc) {
                return $inc->detected_at->diffInMinutes($inc->resolved_at) / 60;
            });
            $lines[] = "dora_mttr_hours{period=\"30d\"} " . round($avgMttr, 2);
        }

        // === Lead Time ===
        $lines[] = '# HELP dora_lead_time_hours Median lead time in hours';
        $lines[] = '# TYPE dora_lead_time_hours gauge';
        // ... 类似计算

        return response(implode("\n", $lines) . "\n", 200, [
            'Content-Type' => 'text/plain; version=0.0.4; charset=utf-8',
        ]);
    }
}
```

### 7.2 Grafana Dashboard JSON

```json
{
  "dashboard": {
    "title": "DORA Metrics - Laravel Team",
    "tags": ["dora", "devops", "engineering"],
    "panels": [
      {
        "title": "Deployment Frequency",
        "type": "stat",
        "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "dora_deployment_frequency_total{period=\"7d\"}",
          "legendFormat": "Last 7 Days"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "short",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "red" },
                { "value": 4, "color": "yellow" },
                { "value": 7, "color": "green" }
              ]
            }
          }
        }
      },
      {
        "title": "Lead Time (Median)",
        "type": "stat",
        "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "dora_lead_time_hours{period=\"30d\"}",
          "legendFormat": "Median Lead Time"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "h",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 24, "color": "yellow" },
                { "value": 168, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "title": "Change Failure Rate",
        "type": "gauge",
        "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "dora_change_failure_rate_pct{period=\"30d\"}",
          "legendFormat": "Failure Rate"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "max": 50,
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 15, "color": "yellow" },
                { "value": 30, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "title": "MTTR",
        "type": "stat",
        "gridPos": { "x": 18, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "dora_mttr_hours{period=\"30d\"}",
          "legendFormat": "MTTR"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "h",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 1, "color": "yellow" },
                { "value": 24, "color": "red" }
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

## 八、警戒线设定与自动化通知

### 8.1 告警规则

```yaml
# prometheus_dora_alerts.yml
groups:
  - name: dora_alerts
    rules:
      # 部署频率下降
      - alert: DeploymentFrequencyDropped
        expr: dora_deployment_frequency_total{period="7d"} < 3
        for: 1d
        labels:
          severity: warning
        annotations:
          summary: "部署频率低于每周 3 次"
          description: "过去 7 天仅 {{ $value }} 次部署，检查是否有阻塞"

      # Lead Time 过长
      - alert: LeadTimeTooHigh
        expr: dora_lead_time_hours > 72
        for: 7d
        labels:
          severity: warning
        annotations:
          summary: "Lead Time 超过 3 天"
          description: "中位 Lead Time 为 {{ $value }} 小时，需要优化 Review 和部署流程"

      # 变更失败率过高
      - alert: ChangeFailureRateHigh
        expr: dora_change_failure_rate_pct > 15
        for: 7d
        labels:
          severity: critical
        annotations:
          summary: "变更失败率超过 15%"
          description: "当前失败率 {{ $value }}%，需要加强测试覆盖和 Review"

      # MTTR 过长
      - alert: MTTRTooHigh
        expr: dora_mttr_hours > 4
        for: 30d
        labels:
          severity: warning
        annotations:
          summary: "MTTR 超过 4 小时"
          description: "平均恢复时间为 {{ $value }} 小时，需要改进故障响应流程"
```

---

## 九、从指标到改进

### 9.1 指标驱动的改进循环

```text
DORA 改进循环（每 2 周一次 Review）：

1. 数据 Review（15 分钟）
   - 查看 Grafana Dashboard 趋势
   - 对比上一个周期的变化
   - 识别最弱的指标

2. 根因分析（20 分钟）
   - 为什么 Lead Time 变长了？
     → 是 Review 时间增加了？还是部署变慢了？
   - 为什么变更失败率上升了？
     → 是测试覆盖不够？还是某些模块质量下降？

3. 改进行动（15 分钟）
   - 选择 1-2 个可执行的改进项
   - 指定负责人和完成时间
   - 纳入下一个 Sprint 的计划

4. 跟踪验证（下一个 Review 时）
   - 改进措施是否执行？
   - 指标是否改善？
   - 需要调整策略吗？
```

### 9.2 真实案例：从 Low 到 Elite 的旅程

```text
某 Laravel B2C 团队的 DORA 改进历程：

初始状态（Month 0）：
- 部署频率：每月 2 次（Low）
- Lead Time：3 周（Low）
- 变更失败率：25%（Low）
- MTTR：8 小时（Medium）

Month 1-3：建立 CI/CD 基础设施
- 搭建 GitHub Actions 自动化流水线
- 引入 PHPUnit + Pest 测试框架
- 部署频率：每周 1 次 → High
- Lead Time：1 周 → Medium

Month 4-6：优化 Review 和发布流程
- PR 大小限制 < 200 行
- 设置 Review SLA
- 引入 Feature Flag
- 部署频率：每周 3 次 → High
- Lead Time：2 天 → High
- 变更失败率：15% → Medium

Month 7-9：强化质量门禁
- PHPStan Level 8 静态分析
- 自动化 Smoke Test
- 蓝绿部署
- 部署频率：每天 1 次 → Elite
- Lead Time：4 小时 → Elite
- 变更失败率：5% → Elite
- MTTR：30 分钟 → Elite
```

---

## 十、总结

DORA 四大指标为工程团队提供了一个客观、可量化、可比较的效能度量框架。在 Laravel 团队中落地 DORA 的关键步骤：

1. **选择正确的 SLI**：部署频率、Lead Time、变更失败率、MTTR
2. **自动化采集**：通过 GitHub API、CI/CD Webhook、监控系统自动采集
3. **可视化展示**：Grafana Dashboard 让团队实时看到指标
4. **设定警戒线**：基于行业基准设定合理的告警阈值
5. **驱动改进**：每 2 周 Review 指标，选择最弱的指标重点改进

记住：**度量的目的不是评判，而是改进**。DORA 指标不是用来给团队打分的 KPI，而是帮助团队发现瓶颈、持续优化的工具。

从今天开始，为你的 Laravel 团队搭建第一个 DORA Dashboard。

---

> **参考资源**
>
> - 《Accelerate: The Science of Lean Software and DevOps》 — Nicole Forsgren
> - Google DORA Report: https://dora.dev
> - GitHub Actions: https://docs.github.com/en/actions
> - Grafana DORA Dashboard: https://grafana.com/grafana/dashboards/
> - Laravel Parallel Testing: https://laravel.com/docs/testing#parallel-testing

## 相关阅读

- [Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地](/categories/07_CICD/Trunk-Based-Development-深度实战-Feature-Flag-替代长生命周期分支的工程化落地/)
- [Canary Deployment 渐进式流量放量：Nginx/Envoy 权重路由与 Laravel 版本共存](/categories/07_CICD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/)
- [SRE 实战入门：SLI/SLO/Error Budget 在 Laravel B2C API 中的落地](/categories/06_运维/SRE-实战入门-SLI-SLO-Error-Budget-Laravel-B2C-API落地/)
