---
title: 'Incident Command 实战：生产故障应急响应——PagerDuty 集成、War Room 协作与 Postmortem 文化'
date: 2026-06-02 10:00:00
tags: [Incident Command, PagerDuty, SRE, War Room, Postmortem, 应急响应, 生产故障]
keywords: [Incident Command, PagerDuty, War Room, Postmortem, 生产故障应急响应, 协作与, 文化, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "生产故障应急响应决定了一支技术团队的成熟度。本文完整落地 Incident Command System（ICS）实践：从 PagerDuty 告警集成与 On-Call 排班升级机制，到 War Room 协作规范与消息模板，再到自动化 Runbook（回滚/Redis 宕机/流量突增）、故障诊断 Checklist、ChatOps Slack Bot 集成，以及 Blameless Postmortem 文化建设与 Action Items 追踪，构建企业级生产故障应急体系。"
---


## 前言

凌晨 3 点，你被 PagerDuty 的电话叫醒。生产环境的订单 API 返回 500 错误，每分钟损失数万元。你迷迷糊糊打开电脑，发现群里已经乱成一锅粥——有人在查日志，有人在重启服务，有人在回滚代码，但没有人知道到底发生了什么，也没有人在协调这些行动。

这是很多技术团队面对生产故障的真实写照：**有行动力，但没有指挥**。

Incident Command System（ICS）最初由美国消防部门在 1970 年代开发，用于协调大规模灾害的应急响应。Google SRE 团队将其引入技术运维领域，形成了一套高效的技术事故响应框架。

本文将完整落地 Incident Command 的全部实践：从 PagerDuty 配置到 War Room 协作，再到 Postmortem 文化建设。

---

## 一、Incident Command System 概述

### 1.1 为什么需要 ICS

```text
没有 ICS 的故障响应：

时间线：
T+0min   告警触发，群里炸了
T+2min   5 个人同时开始排查，各自为战
T+5min   张三重启了服务，但问题没解决
T+10min  李四回滚了代码，但回滚到了错误的版本
T+15min  王五发现是数据库的问题，但在群里喊没人看到
T+30min  终于有人站出来协调，但已经浪费了 30 分钟
T+60min  问题解决，但没有人记录发生了什么

问题：
- 没有统一指挥，行动混乱
- 信息分散在多个渠道
- 重复操作导致二次故障
- 没有记录，无法复盘
```

```text
有 ICS 的故障响应：

时间线：
T+0min   告警触发，PagerDuty 通知 On-Call
T+2min   On-Call 确认故障，启动 Incident Command
T+3min   创建 Incident Channel，指定角色
T+5min   IC 分配 Technical Lead 排查问题
T+10min  TL 定位根因：数据库连接池耗尽
T+12min  IC 决策：扩容连接池 + 重启服务
T+18min  服务恢复，IC 确认指标正常
T+20min  IC 关闭 Incident，记录时间线
T+48h   组织 Postmortem，产出 Action Items

优势：
- 统一指挥，行动有序
- 信息集中，避免信息差
- 决策快速，避免内耗
- 完整记录，支持复盘
```

### 1.2 ICS 角色定义

```text
┌─────────────────────────────────────────────────────────┐
│                  Incident Commander (IC)                 │
│          统一指挥，协调资源，做决策，不亲自排查              │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
┌─────────┴──────┐ ┌────┴──────────┐ ┌─┴───────────────┐
│ Technical Lead │ │Communication  │ │    Scribe        │
│                │ │    Lead       │ │                  │
│ 负责技术排查    │ │ 对外沟通      │ │ 记录时间线        │
│ 定位根因       │ │ 更新状态      │ │ 记录决策          │
│ 执行修复       │ │ 通知相关方    │ │ 记录 Action Items │
└────────────────┘ └───────────────┘ └──────────────────┘
```

**角色职责详解：**

| 角色 | 职责 | 不该做的事 |
|------|------|-----------|
| Incident Commander | 指挥协调、资源分配、决策、控制节奏 | 亲自查日志、写代码、重启服务 |
| Technical Lead | 技术排查、定位根因、执行修复方案 | 做业务决策、对外沟通 |
| Communication Lead | 更新状态页面、通知 Stakeholders、回答业务方询问 | 参与技术排查 |
| Scribe | 记录时间线、决策过程、讨论要点 | 参与排查或沟通 |

### 1.3 严重级别分类

```text
P0 - Critical（关键业务中断）
├── 定义：核心交易流程完全不可用
├── 示例：支付接口全挂、下单接口返回 500
├── 响应 SLA：5 分钟内响应，30 分钟内恢复
├── 通知范围：全团队 + 管理层 + 业务方
└── Postmortem：必须，48 小时内完成

P1 - Major（重要功能降级）
├── 定义：重要功能严重受损，但有临时解决方案
├── 示例：搜索服务超时但可翻页、推荐算法失效但有默认推荐
├── 响应 SLA：15 分钟内响应，2 小时内恢复
├── 通知范围：相关团队 + Manager
└── Postmortem：建议，1 周内完成

P2 - Minor（次要功能异常）
├── 定义：非核心功能异常，不影响主要业务流程
├── 示例：用户头像上传失败、评论功能异常
├── 响应 SLA：1 小时内响应，24 小时内修复
├── 通知范围：团队内部
└── Postmortem：可选

P3 - Low（轻微问题）
├── 定义：几乎不影响用户体验的问题
├── 示例：后台管理页面样式错位、日志格式不规范
├── 响应 SLA：下一个工作日处理
└── Postmortem：不需要
```

---

## 二、PagerDuty 集成

### 2.1 PagerDuty 配置

**Service 配置：**

```text
PagerDuty Service 设置：

1. 创建 Service "Laravel B2C API"
   - Integration Type: Events API v2
   - 获取 Integration Key

2. Escalation Policy 配置：
   Level 1: On-Call 工程师（电话 + 短信 + App 推送）
   Level 2: Backup On-Call（5 分钟后升级）
   Level 3: Team Lead（15 分钟后升级）
   Level 4: Engineering Manager（30 分钟后升级）

3. On-Call 排班：
   - 每周轮换，周一 10:00 切换
   - 每人 On-Call 一周
   - 主 On-Call + Backup On-Call 双人值班
```

**Laravel 集成代码：**

```php
<?php

namespace App\Services\Incident;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PagerDutyClient
{
    private string $routingKey;
    private string $eventsApiUrl = 'https://events.pagerduty.com/v2/enqueue';

    public function __construct()
    {
        $this->routingKey = config('services.pagerduty.integration_key');
    }

    /**
     * 触发告警
     */
    public function trigger(
        string $summary,
        string $severity = 'critical',
        string $source = 'laravel-api',
        array $customDetails = [],
        string $dedupKey = null
    ): ?string {
        $payload = [
            'routing_key' => $this->routingKey,
            'event_action' => 'trigger',
            'dedup_key' => $dedupKey ?? md5($summary . $severity),
            'payload' => [
                'summary' => $summary,
                'severity' => $severity, // critical, error, warning, info
                'source' => $source,
                'component' => $customDetails['component'] ?? 'api',
                'group' => $customDetails['group'] ?? 'production',
                'class' => $customDetails['class'] ?? 'availability',
                'custom_details' => $customDetails,
            ],
        ];

        try {
            $response = Http::timeout(5)->post($this->eventsApiUrl, $payload);

            if ($response->successful()) {
                return $response->json('dedup_key');
            }

            Log::error('PagerDuty trigger failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            return null;
        } catch (\Exception $e) {
            Log::error('PagerDuty trigger exception', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * 确认告警
     */
    public function acknowledge(string $dedupKey): bool
    {
        return $this->sendEvent('acknowledge', $dedupKey);
    }

    /**
     * 解决告警
     */
    public function resolve(string $dedupKey): bool
    {
        return $this->sendEvent('resolve', $dedupKey);
    }

    private function sendEvent(string $action, string $dedupKey): bool
    {
        $payload = [
            'routing_key' => $this->routingKey,
            'event_action' => $action,
            'dedup_key' => $dedupKey,
        ];

        try {
            $response = Http::timeout(5)->post($this->eventsApiUrl, $payload);
            return $response->successful();
        } catch (\Exception $e) {
            Log::error("PagerDuty {$action} failed", ['error' => $e->getMessage()]);
            return false;
        }
    }
}
```

### 2.2 告警触发条件

```php
<?php

namespace App\Services\Incident;

use App\Services\Incident\PagerDutyClient;

class AlertManager
{
    public function __construct(
        private PagerDutyClient $pagerDuty,
        private IncidentManager $incidentManager
    ) {}

    /**
     * 监控告警规则
     */
    public function evaluateAlerts(): void
    {
        // 规则 1：5xx 错误率超过阈值
        $errorRate = $this->get5xxErrorRate();
        if ($errorRate > 0.05) { // 5%
            $this->pagerDuty->trigger(
                summary: "P0: 5xx 错误率达到 {$errorRate}%",
                severity: 'critical',
                customDetails: [
                    'error_rate' => $errorRate,
                    'threshold' => 0.05,
                    'component' => 'api',
                ]
            );
        }

        // 规则 2：P95 延迟超标
        $p95Latency = $this->getP95Latency();
        if ($p95Latency > 2000) { // 2 秒
            $this->pagerDuty->trigger(
                summary: "P1: P95 延迟达到 {$p95Latency}ms",
                severity: 'error',
                customDetails: [
                    'p95_latency' => $p95Latency,
                    'threshold' => 2000,
                ]
            );
        }

        // 规则 3：数据库连接池耗尽
        $dbConnections = $this->getActiveDbConnections();
        if ($dbConnections > 90) { // 最大连接数的 90%
            $this->pagerDuty->trigger(
                summary: "P0: 数据库连接池即将耗尽 ({$dbConnections}/100)",
                severity: 'critical',
                customDetails: [
                    'active_connections' => $dbConnections,
                    'max_connections' => 100,
                ]
            );
        }

        // 规则 4：订单队列积压
        $queueDepth = $this->getQueueDepth('orders');
        if ($queueDepth > 10000) {
            $this->pagerDuty->trigger(
                summary: "P1: 订单队列积压 {$queueDepth} 条",
                severity: 'error',
                customDetails: [
                    'queue_depth' => $queueDepth,
                    'queue_name' => 'orders',
                ]
            );
        }
    }

    private function get5xxErrorRate(): float
    {
        // 从 Redis 或 Prometheus 获取最近 5 分钟的 5xx 错误率
        return (float) \Cache::get('monitoring:5xx_rate_5m', 0);
    }

    private function getP95Latency(): int
    {
        return (int) \Cache::get('monitoring:p95_latency_5m', 0);
    }

    private function getActiveDbConnections(): int
    {
        return (int) \DB::select('SHOW STATUS LIKE "Threads_connected"')[0]->Value ?? 0;
    }

    private function getQueueDepth(string $queue): int
    {
        return \Queue::size($queue);
    }
}
```

### 2.3 On-Call 排班与升级

```text
On-Call 排班策略：

┌─────────────────────────────────────────────────┐
│ Week 1: 张三（主） + 李四（Backup）              │
│ Week 2: 李四（主） + 王五（Backup）              │
│ Week 3: 王五（主） + 赵六（Backup）              │
│ Week 4: 赵六（主） + 张三（Backup）              │
└─────────────────────────────────────────────────┘

升级时间线：
T+0min    告警触发 → 主 On-Call（电话 + App 推送）
T+5min    未响应 → Backup On-Call（电话 + App 推送）
T+10min   未响应 → Team Lead（电话）
T+20min   未响应 → Engineering Manager（电话）
T+30min   未响应 → VP Engineering（电话）

升级条件：
- On-Call 未在 5 分钟内 Acknowledge 告警
- On-Call Acknowledge 后 30 分钟内未给出修复方案
- P0 故障 1 小时内未恢复
```

---

## 三、War Room 实战

### 3.1 War Room 启动流程

```php
<?php

namespace App\Services\Incident;

use Illuminate\Support\Facades\Slack;

class IncidentManager
{
    /**
     * 启动一个新的 Incident
     */
    public function startIncident(array $alert): Incident
    {
        // 1. 生成 Incident ID
        $incidentId = 'INC-' . now()->format('Ymd') . '-' . str_pad(
            Incident::whereDate('created_at', today())->count() + 1,
            3, '0', STR_PAD_LEFT
        );

        // 2. 创建 Incident 记录
        $incident = Incident::create([
            'incident_id' => $incidentId,
            'severity' => $this->determineSeverity($alert),
            'title' => $alert['summary'],
            'status' => 'active',
            'detected_at' => now(),
            'alert_details' => $alert,
        ]);

        // 3. 创建 Slack Incident Channel
        $channelName = strtolower("inc-{$incidentId}");
        $this->createSlackChannel($channelName, $incident);

        // 4. 发送初始消息
        $this->sendInitialMessage($channelName, $incident);

        // 5. 通知 Stakeholders
        $this->notifyStakeholders($incident);

        return $incident;
    }

    private function createSlackChannel(string $channelName, Incident $incident): void
    {
        // 使用 Slack API 创建频道
        Slack::createChannel($channelName);

        // 邀请核心成员
        $coreMembers = $this->getOnCallEngineers();
        foreach ($coreMembers as $member) {
            Slack::inviteToChannel($channelName, $member);
        }
    }

    private function sendInitialMessage(string $channel, Incident $incident): void
    {
        $message = <<<MSG
🚨 *Incident Started: {$incident->incident_id}*

*Severity:* {$incident->severity}
*Title:* {$incident->title}
*Detected:* {$incident->detected_at->format('Y-m-d H:i:s')}

*Roles:*
• Incident Commander: <@oncall-ic>
• Technical Lead: <@oncall-tl>
• Scribe: <@oncall-scribe>

*Status:* 🔴 Investigating

Please post all updates in this channel. Use thread for detailed discussion.
MSG;

        Slack::sendMessage($channel, $message);
    }

    /**
     * 更新 Incident 状态
     */
    public function updateStatus(Incident $incident, string $status, string $message): void
    {
        $incident->update(['status' => $status]);

        $statusEmoji = match ($status) {
            'investigating' => '🔍',
            'identified' => '🎯',
            'fixing' => '🔧',
            'monitoring' => '👁️',
            'resolved' => '✅',
            default => '❓',
        };

        Slack::sendMessage(
            $incident->slack_channel,
            "{$statusEmoji} *Status Update:* {$status}\n{$message}"
        );
    }

    /**
     * 解决 Incident
     */
    public function resolveIncident(Incident $incident, string $resolution): void
    {
        $incident->update([
            'status' => 'resolved',
            'resolved_at' => now(),
            'resolution' => $resolution,
        ]);

        $recoveryTime = $incident->detected_at->diffInMinutes($incident->resolved_at);

        Slack::sendMessage(
            $incident->slack_channel,
            <<<MSG
✅ *Incident Resolved: {$incident->incident_id}*

*Resolution:* {$resolution}
*Recovery Time:* {$recoveryTime} minutes
*Severity:* {$incident->severity}

*Next Steps:*
• Postmortem will be scheduled within 48 hours
• Action Items will be tracked in the Postmortem document

Thank you everyone for the quick response!
MSG
        );

        // 创建 Postmortem 模板
        $this->createPostmortemTemplate($incident);
    }

    private function determineSeverity(array $alert): string
    {
        // 基于告警内容自动判断严重级别
        if (str_contains($alert['summary'], 'P0') || $alert['severity'] === 'critical') {
            return 'P0';
        }
        if (str_contains($alert['summary'], 'P1') || $alert['severity'] === 'error') {
            return 'P1';
        }
        return 'P2';
    }

    private function getOnCallEngineers(): array
    {
        // 从 PagerDuty 获取当前 On-Call 人员
        return ['U01234567', 'U89012345']; // Slack User IDs
    }
}
```

### 3.2 War Room 协作规范

```text
War Room 协作规则：

1. 信息同步规则
   - 所有更新发在 Incident Channel 主频道（不是 Thread）
   - 详细讨论在 Thread 中进行
   - 每 5 分钟更新一次状态（由 Scribe 负责）
   - 使用统一的状态标签：🔍调查中 → 🎯已定位 → 🔧修复中 → 👁️观察中 → ✅已解决

2. 沟通纪律
   - 一个 Incident 一个 Channel，不要在其他地方讨论
   - 技术讨论用 Thread，不要刷屏
   - 不确定的信息标注"待确认"
   - 修复操作前必须在 Channel 中宣布："准备执行 XXX 操作"

3. 决策流程
   - Technical Lead 提出方案
   - Incident Commander 评估风险并决策
   - 决策记录在 Channel 中
   - 如果 IC 无法决策（如需要回滚影响很大的变更），升级到 Manager

4. 操作纪律
   - 一次只执行一个修复操作
   - 操作前告知团队："准备执行 XXX，预计影响 YYY"
   - 操作后观察 2-3 分钟确认效果
   - 如果操作无效或导致新问题，立即回滚
```

### 3.3 War Room 消息模板

```text
Incident Channel 消息模板：

--- 状态更新 ---
🔍 *Status Update [T+15min]*
当前状态：Investigating
进展：正在检查应用日志和数据库连接状态
下一步：查看最近 30 分钟的慢查询日志
阻塞：无

--- 操作通知 ---
🔧 *Executing Action*
操作：重启 Laravel Queue Worker
预期影响：正在处理的队列任务可能需要重新执行
预计时间：30 秒
操作人：@张三

--- 决策记录 ---
📋 *Decision Made*
决策：回滚到上一个版本 (v2.3.1)
原因：确认 v2.3.2 的代码变更导致数据库连接泄漏
风险：v2.3.1 的功能会暂时不可用
决策人：@IC-李四

--- 外部沟通 ---
📢 *External Communication*
发送对象：Product Manager + 业务方
内容：订单系统出现性能问题，技术团队正在排查，预计 30 分钟内恢复
发送人：@Communication-Lead
```

---

## 四、故障诊断 Checklist

### 4.1 Laravel API 故障排查标准流程

```text
Laravel API 故障排查 Checklist：

Step 1：确认故障范围（2 分钟）
□ 哪些 API 端点受影响？
□ 影响多少用户？（百分比）
□ 故障是从什么时候开始的？
□ 最近有没有代码部署？

Step 2：检查基础层（3 分钟）
□ 服务器 CPU/内存/磁盘使用率？
□ 网络连通性是否正常？
□ 负载均衡器状态？
□ SSL 证书是否过期？

Step 3：检查应用层（5 分钟）
□ Laravel 应用日志（storage/logs/laravel.log）
□ PHP-FPM 进程状态（是否有足够 worker）
□ OPcache 状态（是否需要清除）
□ 队列 Worker 状态

Step 4：检查数据层（5 分钟）
□ MySQL 连接数是否达到上限
□ 慢查询日志是否有异常
□ 主从复制延迟
□ Redis 连接状态和内存使用

Step 5：检查外部依赖（3 分钟）
□ 第三方支付 API 是否正常
□ CDN 服务是否正常
□ DNS 解析是否正常
□ 邮件/短信服务是否正常
```

### 4.2 常见故障模式与快速恢复

```text
模式 1：5xx 错误率飙升
├── 可能原因：代码 Bug、内存泄漏、数据库连接耗尽
├── 快速排查：
│   ├── tail -f storage/logs/laravel.log | grep ERROR
│   ├── php artisan queue:failed（查看失败队列）
│   └── SHOW PROCESSLIST（查看数据库连接）
└── 快速恢复：回滚到上一个版本

模式 2：响应延迟飙升
├── 可能原因：慢查询、缓存失效、外部 API 超时
├── 快速排查：
│   ├── SHOW PROCESSLIST（查看慢查询）
│   ├── redis-cli INFO（查看缓存命中率）
│   └── 检查第三方 API 状态页面
└── 快速恢复：开启全站缓存 + 限流

模式 3：队列积压
├── 可能原因：Worker 崩溃、任务执行失败、突发流量
├── 快速排查：
│   ├── php artisan queue:work --once（测试单条任务）
│   ├── php artisan queue:failed（查看失败任务）
│   └── redis-cli LLEN queues:default（查看队列深度）
└── 快速恢复：增加 Worker 数量 + 重启 Worker

模式 4：内存溢出
├── 可能原因：内存泄漏、大文件处理、集合数据过大
├── 快速排查：
│   ├── free -h（查看系统内存）
│   ├── php -i | grep memory_limit（检查 PHP 内存限制）
│   └── 检查最近的代码变更是否引入了内存泄漏
└── 快速恢复：重启 PHP-FPM + 增加内存限制
```

---

## 五、恢复操作 Playbook

### 5.1 自动化 Runbook

```php
<?php

namespace App\Services\Incident\Runbooks;

class LaravelRunbook
{
    /**
     * Playbook 1：紧急回滚
     */
    public function emergencyRollback(string $targetVersion = null): array
    {
        $steps = [];

        // Step 1: 确认当前版本
        $currentVersion = trim(shell_exec('git -C /var/www/api describe --tags --always'));
        $steps[] = "当前版本: {$currentVersion}";

        // Step 2: 回滚代码
        $target = $targetVersion ?? 'HEAD~1';
        $rollbackCmd = "cd /var/www/api && git checkout {$target} && composer install --no-dev --optimize-autoloader";
        $steps[] = "执行: {$rollbackCmd}";

        // Step 3: 清除缓存
        $cacheCmd = "cd /var/www/api && php artisan cache:clear && php artisan config:clear && php artisan route:clear";
        $steps[] = "执行: {$cacheCmd}";

        // Step 4: 重启服务
        $restartCmd = "sudo systemctl restart php8.3-fpm && sudo systemctl restart nginx";
        $steps[] = "执行: {$restartCmd}";

        // Step 5: 验证
        $steps[] = "验证: curl -s https://api.example.com/health | jq .status";

        return [
            'playbook' => 'emergency_rollback',
            'steps' => $steps,
            'estimated_time' => '2-5 分钟',
            'risks' => '回滚版本的功能将暂时不可用',
            'prerequisites' => '确认目标版本是稳定版本',
        ];
    }

    /**
     * Playbook 2：数据库连接池耗尽
     */
    public function databaseConnectionExhaustion(): array
    {
        return [
            'playbook' => 'db_connection_exhaustion',
            'steps' => [
                '1. 检查连接数: SHOW STATUS LIKE "Threads_connected"',
                '2. 查看连接来源: SHOW PROCESSLIST',
                '3. Kill 长时间空闲连接: KILL <process_id>',
                '4. 临时增加最大连接数: SET GLOBAL max_connections = 200',
                '5. 重启 PHP-FPM 释放连接: sudo systemctl restart php8.3-fpm',
                '6. 检查 Laravel 数据库配置中的连接池设置',
                '7. 监控连接数恢复: watch -n 1 "mysqladmin status"',
            ],
            'root_cause_check' => [
                '检查是否有未关闭的 DB::connection()',
                '检查是否有长事务未提交',
                '检查 Laravel 的 database.connections.mysql.pool 配置',
            ],
        ];
    }

    /**
     * Playbook 3：Redis 宕机
     */
    public function redisDown(): array
    {
        return [
            'playbook' => 'redis_down',
            'steps' => [
                '1. 检查 Redis 进程: systemctl status redis',
                '2. 查看 Redis 日志: tail -f /var/log/redis/redis.log',
                '3. 尝试重启: sudo systemctl restart redis',
                '4. 如果重启失败，检查 RDB/AOF 文件完整性',
                '5. 切换到 Laravel 的 fallback 缓存（file）',
                '6. 临时禁用 Redis 依赖的功能（Session、Queue 改用 Database）',
                '7. 等待 Redis 恢复后切回',
            ],
            'laravel_config_fallback' => [
                '修改 .env: CACHE_DRIVER=file',
                '修改 .env: SESSION_DRIVER=file',
                '修改 .env: QUEUE_CONNECTION=database',
                'php artisan config:clear',
            ],
        ];
    }

    /**
     * Playbook 4：突发流量（DDoS 或营销活动）
     */
    public function trafficSpike(): array
    {
        return [
            'playbook' => 'traffic_spike',
            'steps' => [
                '1. 确认流量来源（正常用户 or 攻击）',
                '2. 开启 CDN 缓存（如果未开启）',
                '3. 开启 Laravel 限流: 修改 RouteServiceProvider 的 throttle',
                '4. 增加 PHP-FPM worker 数量: pm.max_children += 20',
                '5. 开启全站缓存: php artisan responsecache:all',
                '6. 如果是 DDoS：联系云服务商启用 WAF/CC 防护',
                '7. 持续监控服务器资源使用率',
            ],
            'rate_limiting_config' => [
                'API 限流: 60 requests/minute per user',
                '登录限流: 5 attempts/minute per IP',
                '全局限流: 10000 requests/minute total',
            ],
        ];
    }
}
```

---

## 六、Postmortem 文化

### 6.1 Postmortem 模板

```markdown
# Incident Postmortem: INC-20260602-001

## 基本信息
- **Incident ID:** INC-20260602-001
- **严重级别:** P0
- **标题:** 订单 API 完全不可用
- **Incident Commander:** 张三
- **Technical Lead:** 李四
- **Scribe:** 王五
- **时间线:**
  - 检测时间: 2026-06-02 03:15:00
  - 响应时间: 2026-06-02 03:17:00
  - 恢复时间: 2026-06-02 03:45:00
  - 总持续时间: 30 分钟

## 影响范围
- **受影响服务:** 订单创建、订单查询、支付回调
- **受影响用户:** 约 15,000 名活跃用户
- **营收影响:** 估计损失 ¥150,000（30 分钟内未完成的订单）

## 时间线（精确到分钟）
| 时间 | 事件 | 操作人 |
|------|------|--------|
| 03:10 | v2.3.2 部署到生产环境 | CI/CD |
| 03:15 | PagerDuty 告警触发：5xx 错误率 > 10% | 自动化 |
| 03:17 | On-Call 工程师 Acknowledge 告警 | 张三 |
| 03:18 | 创建 Incident Channel #inc-inc-20260602-001 | 张三 |
| 03:20 | 检查应用日志，发现大量 SQLSTATE 连接错误 | 李四 |
| 03:25 | 确认数据库连接数达到上限 (100/100) | 李四 |
| 03:27 | IC 决策：回滚到 v2.3.1 | 张三 |
| 03:30 | 回滚完成，服务开始恢复 | 李四 |
| 03:35 | 数据库连接数降至正常水平 (30/100) | 监控 |
| 03:40 | 确认所有 API 恢复正常 | 李四 |
| 03:45 | 关闭 Incident | 张三 |

## 根因分析
### 直接原因
v2.3.2 版本的 `OrderService::processBatch()` 方法在循环中创建了大量数据库连接，且未正确关闭。

### 根本原因
1. Code Review 未发现连接泄漏问题（PR 中没有数据库连接相关的 Review 关注点）
2. 测试环境数据库最大连接数设置为 200，掩盖了连接泄漏问题
3. 缺少数据库连接数的监控告警

### 5 Whys 分析
1. 为什么订单 API 不可用？→ 数据库连接池耗尽
2. 为什么连接池耗尽？→ 代码中存在连接泄漏
3. 为什么有连接泄漏？→ `processBatch()` 方法中的 DB::connection() 未关闭
4. 为什么 Code Review 没发现？→ Review Checklist 中没有数据库连接相关的检查项
5. 为什么测试没发现？→ 测试环境连接数上限过高，未触发问题

## Action Items
| # | Action | 优先级 | 负责人 | 截止日期 | 状态 |
|---|--------|--------|--------|----------|------|
| 1 | 修复 `processBatch()` 中的连接泄漏 | P0 | 李四 | 2026-06-03 | Done |
| 2 | 添加数据库连接数监控告警 | P0 | 王五 | 2026-06-04 | In Progress |
| 3 | 更新 Code Review Checklist，添加连接管理检查项 | P1 | 张三 | 2026-06-07 | TODO |
| 4 | 测试环境数据库连接数与生产环境一致 | P1 | 赵六 | 2026-06-10 | TODO |
| 5 | 添加集成测试：模拟高并发下的连接管理 | P2 | 李四 | 2026-06-14 | TODO |

## 经验教训
### 做得好的
- 告警系统在 5 分钟内检测到问题
- IC 快速决策回滚，避免了更长时间的故障
- War Room 协作有序，信息同步及时

### 需要改进的
- Code Review 需要更关注资源管理（连接、内存、文件句柄）
- 测试环境应与生产环境保持一致的资源限制
- 缺少数据库连接池的监控和告警

## 附录
- 相关 PR: https://github.com/org/repo/pull/1234
- Grafana Dashboard: https://grafana.example.com/d/xxx
- Incident Slack Channel: #inc-inc-20260602-001
```

### 6.2 无责复盘原则

```text
Postmortem 的核心原则：Blameless（无责）

什么是无责复盘：
- 不追究"谁犯了错"
- 聚焦于"系统为什么会允许这个错误发生"
- 目标是改进流程和系统，而非惩罚个人

为什么无责很重要：
- 如果复盘会变成"批斗会"，没人愿意诚实分享信息
- 隐藏信息会导致无法找到真正的根因
- 恐惧文化会阻碍团队主动上报问题

实践方法：
❌ "张三写了一个有 Bug 的代码"
✅ "processBatch 方法中的连接管理逻辑存在缺陷，Code Review 未能发现"

❌ "李四没有及时响应告警"
✅ "告警升级机制在深夜场景下响应时间较长，需要优化通知方式"

❌ "王五没有做充分的测试"
✅ "测试环境的数据库配置与生产环境不一致，导致连接泄漏未被发现"
```

### 6.3 Action Items 追踪

```php
<?php

namespace App\Models\Incident;

use Illuminate\Database\Eloquent\Model;

class PostmortemAction extends Model
{
    protected $fillable = [
        'postmortem_id',
        'action_number',
        'description',
        'priority',    // P0, P1, P2
        'owner',
        'due_date',
        'status',      // TODO, In Progress, Done, Cancelled
        'completed_at',
        'notes',
    ];

    protected $casts = [
        'due_date' => 'date',
        'completed_at' => 'datetime',
    ];

    /**
     * 追踪 Action Items 的完成率
     */
    public static function getCompletionStats(int $days = 30): array
    {
        $since = now()->subDays($days);

        $total = self::where('created_at', '>=', $since)->count();
        $completed = self::where('created_at', '>=', $since)
            ->where('status', 'Done')
            ->count();
        $overdue = self::where('due_date', '<', now())
            ->whereNotIn('status', ['Done', 'Cancelled'])
            ->count();

        return [
            'total' => $total,
            'completed' => $completed,
            'completion_rate' => $total > 0 ? round($completed / $total * 100, 1) : 0,
            'overdue' => $overdue,
        ];
    }
}
```

---

## 七、ChatOps 集成

### 7.1 Slack Bot 集成

```php
<?php

namespace App\Services\Incident\ChatOps;

use App\Services\Incident\IncidentManager;
use App\Services\Incident\Runbooks\LaravelRunbook;

class IncidentSlackBot
{
    public function __construct(
        private IncidentManager $incidentManager,
        private LaravelRunbook $runbook
    ) {}

    /**
     * 处理 Slack 命令
     */
    public function handleCommand(string $command, array $context): string
    {
        return match (true) {
            str_starts_with($command, '/incident start') => $this->startIncident($context),
            str_starts_with($command, '/incident status') => $this->getStatus($context),
            str_starts_with($command, '/incident resolve') => $this->resolveIncident($context),
            str_starts_with($command, '/incident rollback') => $this->executeRollback($context),
            str_starts_with($command, '/incident runbook') => $this->showRunbook($context),
            default => '未知命令。可用命令: /incident start|status|resolve|rollback|runbook',
        };
    }

    private function startIncident(array $context): string
    {
        $alert = [
            'summary' => $context['text'] ?? 'Manual Incident',
            'severity' => 'critical',
            'triggered_by' => $context['user_id'],
        ];

        $incident = $this->incidentManager->startIncident($alert);

        return "🚨 Incident {$incident->incident_id} 已启动！\n"
             . "Channel: #inc-{$incident->incident_id}\n"
             . "请前往 Incident Channel 参与响应。";
    }

    private function executeRollback(array $context): string
    {
        $playbook = $this->runbook->emergencyRollback();

        $steps = implode("\n", array_map(
            fn($step) => "  {$step}",
            $playbook['steps']
        ));

        return "📋 Emergency Rollback Playbook:\n\n{$steps}\n\n"
             . "⚠️ 预计时间: {$playbook['estimated_time']}\n"
             . "⚠️ 风险: {$playbook['risks']}\n\n"
             . "请 IC 确认后执行。";
    }
}
```

---

## 八、真实故障案例分析

### 8.1 案例：一次 P0 事故的完整响应

```text
时间：2026 年某周三下午 2:30
场景：大促活动开始后，订单系统全面崩溃

T+0min (14:30) 大促开始，流量瞬间飙升 10 倍
  - PagerDuty 触发 P0 告警：5xx 错误率 30%
  - On-Call 工程师（张三）立即 Acknowledge

T+2min (14:32) 启动 Incident
  - 张三创建 #inc-inc-20260602-002
  - 指定自己为 IC，李四为 Technical Lead
  - 通知 PM 和业务方

T+5min (14:35) 初步排查
  - 李四发现：PHP-FPM worker 全部忙碌
  - 数据库连接数正常（50/100）
  - Redis 正常
  - 初步判断：应用层瓶颈

T+10min (14:40) 定位根因
  - 李四发现：订单创建 API 的库存扣减逻辑中有一个同步锁
  - 高并发下所有请求都在等待这个锁
  - 锁的超时设置为 30 秒，导致 Worker 全部阻塞

T+12min (14:42) IC 决策
  - 方案 A：临时增加 PHP-FPM worker（治标）
  - 方案 B：修改锁的超时时间为 1 秒（需要代码变更）
  - 方案 C：临时禁用库存精确扣减，使用预扣模式
  - IC 决策：先执行方案 A 缓解压力，同时准备方案 C

T+15min (14:45) 执行方案 A
  - pm.max_children 从 50 增加到 100
  - 部分请求开始恢复

T+20min (14:50) 执行方案 C
  - 通过 Feature Flag 切换到预扣模式
  - 系统完全恢复

T+25min (14:55) 确认恢复
  - 5xx 错误率降至 0.1%
  - P95 延迟恢复正常（150ms）
  - IC 宣布进入"观察期"

T+60min (15:30) 关闭 Incident
  - 观察 30 分钟，系统稳定
  - IC 关闭 Incident
  - 安排 Postmortem

Postmortem Action Items：
1. 库存扣减改为异步队列处理（消除同步锁）
2. 增加 PHP-FPM worker 数量的自动弹性伸缩
3. 大促前进行压力测试（模拟 10x 流量）
4. Feature Flag 系统增加"紧急降级"快捷入口
```

---

## 九、持续改进

### 9.1 Incident Review 指标

```text
衡量 Incident Response 效果的指标：

1. MTTD（Mean Time to Detect）- 平均检测时间
   目标：< 5 分钟
   计算：从故障发生到告警触发的时间

2. MTTA（Mean Time to Acknowledge）- 平均响应时间
   目标：< 5 分钟
   计算：从告警触发到 On-Call 确认的时间

3. MTTR（Mean Time to Recovery）- 平均恢复时间
   目标：< 30 分钟（P0）
   计算：从故障发生到服务恢复的时间

4. Action Items 完成率
   目标：> 90%
   计算：按时完成的 Action Items / 总 Action Items

5. Postmortem 完成率
   目标：100%（P0/P1 事故必须有 Postmortem）
```

### 9.2 定期演练

```text
Incident Response 演练计划：

每月一次 Game Day：
- 模拟一个故障场景（如数据库宕机、Redis 宕机）
- 不提前通知，真实触发告警
- 团队按照 ICS 流程响应
- 演练后复盘，找出流程中的改进点

常见演练场景：
1. 数据库主库宕机 → 切换到从库
2. Redis 宕机 → 切换到文件缓存
3. 代码部署引入 Bug → 紧急回滚
4. 流量突增 10 倍 → 弹性扩容 + 限流
5. 第三方支付 API 不可用 → 切换备用支付通道
```

---

## 总结

Incident Command System 不是一套复杂的理论，而是一套**实用的应急响应框架**。在 Laravel B2C 项目中落地 ICS，核心要素包括：

1. **角色定义**：IC、Technical Lead、Communication Lead、Scribe 各司其职
2. **工具集成**：PagerDuty 告警升级 + Slack War Room 协作
3. **标准流程**：故障诊断 Checklist + 恢复操作 Playbook
4. **Postmortem 文化**：无责复盘 + Action Items 追踪 + 持续改进
5. **定期演练**：Game Day 模拟故障，保持团队应急能力

记住：**好的 Incident Response 不是不出故障，而是出了故障能快速恢复，并且每次故障都让系统变得更好**。

---

> **参考资源**
>
> - Google SRE Book - Managing Incidents: https://sre.google/sre-book/managing-incidents/
> - PagerDuty Incident Response: https://response.pagerduty.com/
> - Atlassian Incident Management Handbook: https://www.atlassian.com/incident-management
> - Slack Incident Management Best Practices: https://slack.com/intl/en-us/blog/collaboration/incident-management

## 相关阅读

- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/post/opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
- [Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化](/post/grafana-loki-lightweight-log-aggregation-laravel/)
- [Sentry 实战：2026 年版错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成](/post/sentry-error-tracking-performance-monitoring-session-replay-laravel/)
- [Chaos Engineering 实战：用 Chaos Mesh 对 Laravel 微服务进行故障注入与韧性测试](/post/chaos-engineering-mesh-laravel/)
