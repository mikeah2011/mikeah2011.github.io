---

title: Cachet 实战：开源状态页面——Incident 管理、组件状态、订阅通知与 Laravel 微服务的对外 SLA 展示
keywords: [Cachet, Incident, Laravel, SLA, 开源状态页面, 组件状态, 订阅通知与, 微服务的对外, 展示, 架构]
date: 2026-06-10 05:49:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- Cachet
- Status Page
- Incident Management
- SLA
- Laravel
- 微服务
description: 用 Cachet 搭建对外状态页，实现组件健康监控、Incident 生命周期管理、邮件/Slack 订阅通知，并把 Laravel 微服务的 SLA 指标接入面板，提供对外可信的可用性展示。
---



## 概述

对内有 Grafana、Datadog、PagerDuty，对外却没有统一的状态页，是很多团队在 SaaS 化过程中容易忽略的一环。

**状态页**是服务可用性透明化的关键窗口：告诉用户某个组件是正常、降级还是故障，告诉订阅者事件进展与恢复时间，也告诉业务线 SLA 达标情况。对外的状态页不仅承载"通知"职责，更是一种信任机制。

Cachet 是目前最成熟的开源状态页方案之一，原生 PHP/Laravel 技术栈，社区活跃，功能覆盖组件状态、Incident 管理、订阅通知、指标展示等。对于已经具备 Laravel 工程体系的团队来说，Cachet 既可以独立部署，也可以嵌入现有的运维、告警、SLA 工作流。

本文基于真实落地经验，演示如何：

- 用 Cachet 搭建对外状态页并完成组件分级
- 通过 Incident 管理故障发布流程
- 接入邮件、Webhook、Slack 多通道通知
- 把 Laravel 微服务的 SLA 指标同步到状态页
- 落地运维与自动化，确保状态页成为可信的对外窗口

---

## 核心概念

### 1. Cachet 的核心模型

Cachet 的状态页由三部分组成：

- **组件（Component）**：对外可见的服务单元，例如"官网""API 网关""支付服务"。每个组件有独立的状态：正常、性能下降、部分中断、重大中断、已维护。
- **Incident（事件）**：记录故障、维护、公告。Incident 有多个状态：已调度、进行中、已确认、已解决、已计划。
- **指标（Metrics）**：可选的数值型指标，例如延迟、成功率、错误率，用于补充展示服务运行趋势。

### 2. 组件 vs 分组

Cachet 支持 Component Group（组件分组），这在微服务场景中非常重要。

例如：

- 基础设施组：API Gateway、负载均衡
- 核心服务组：订单服务、支付服务
- 支撑系统组：监控、日志、CI/CD

分组帮助用户快速定位问题范围，避免状态页成为杂乱的信息罗列。

### 3. Incident 生命周期

一个完整的 Incident 流程通常包括：

1. 检测到异常
2. 创建 Incident（已调度）
3. 调查并更新状态（进行中 / 已确认）
4. 修复并标记已解决
5. 写事后总结（Postmortem）

Cachet 支持 Incident Message 时间线，可以像 GitHub Issue 一样持续更新进展，避免用户反复刷新却看不到变化。

### 4. 订阅与通知

Cachet 支持：

- 邮件订阅（默认 SMTP）
- Webhook（对接内部系统）
- Slack、Telegram 等社区扩展

订阅机制决定状态页不是"摆设"，而是主动触达用户的通知渠道。

### 5. SLA 与对外透明

SLA（Service Level Agreement）通常包含：

- 可用性目标（如 99.9%）
- 错误率阈值
- 响应时间承诺

状态页的价值在于：**不只自己知道 SLA 达标情况，还能对外展示**。Cachet 的 Metrics 可以承载这些指标，让客户、合作方、监管方看到可信的运行数据。

---

## 实战代码（Laravel 为主）

### 1. Docker Compose 快速部署

最常见的方式是 Docker 部署，适合快速验证和中小规模使用。

```yaml
version: "3.8"

services:
  cachet:
    image: cachethq/cachet:latest
    container_name: cachet
    ports:
      - "8080:80"
    environment:
      - APP_ENV=production
      - APP_KEY=${APP_KEY}
      - APP_URL=http://localhost:8080
      - DB_DRIVER=mysql
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_DATABASE=cachet
      - DB_USERNAME=cachet
      - DB_PASSWORD=${DB_PASSWORD}
      - CACHE_DRIVER=redis
      - SESSION_DRIVER=redis
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MAIL_DRIVER=smtp
      - MAIL_HOST=smtp.example.com
      - MAIL_PORT=587
      - MAIL_USERNAME=status@example.com
      - MAIL_PASSWORD=${MAIL_PASSWORD}
      - MAIL_ENCRYPTION=tls
      - MAIL_FROM_ADDRESS=status@example.com
      - MAIL_FROM_NAME="Status Page"
    depends_on:
      - mysql
      - redis
    restart: unless-stopped

  mysql:
    image: mysql:8.0
    container_name: cachet-mysql
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
      - MYSQL_DATABASE=cachet
      - MYSQL_USER=cachet
      - MYSQL_PASSWORD=${DB_PASSWORD}
    volumes:
      - cachet_mysql:/var/lib/mysql
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: cachet-redis
    restart: unless-stopped

volumes:
  cachet_mysql:
```

生成密钥并启动：

```bash
APP_KEY=$(docker run --rm cachethq/cachet php artisan key:generate --show)
DB_PASSWORD=$(openssl rand -base64 24)
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24)

cat > .env <<EOF
APP_KEY=${APP_KEY}
DB_PASSWORD=${DB_PASSWORD}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
EOF

docker compose up -d
docker compose exec cachet php artisan migrate --force
```

启动后访问 `http://localhost:8080`，完成初始化向导。

### 2. 通过 Cachet API 管理组件

Cachet 提供 REST API，适合与监控系统集成。

```php
<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;

class CachetComponentService
{
    private Client $http;

    public function __construct()
    {
        $this->http = new Client([
            'base_uri' => config('services.cachet.base_url'),
            'headers' => [
                'X-Cachet-Token' => config('services.cachet.api_token'),
                'Accept' => 'application/json',
            ],
        ]);
    }

    /**
     * 创建组件
     */
    public function createComponent(string $name, int $groupId, string $status = 'operational'): array
    {
        $response = $this->http->post('/api/v1/components', [
            'form_params' => [
                'name' => $name,
                'group_id' => $groupId,
                'status' => $this->resolveStatus($status),
                'enabled' => true,
            ],
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }

    /**
     * 更新组件状态
     */
    public function updateComponentStatus(int $componentId, string $status): array
    {
        $response = $this->http->put("/api/v1/components/{$componentId}", [
            'form_params' => [
                'status' => $this->resolveStatus($status),
            ],
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }

    /**
     * 获取组件列表
     */
    public function listComponents(): array
    {
        $response = $this->http->get('/api/v1/components');
        return json_decode((string) $response->getBody(), true)['data'];
    }

    private function resolveStatus(string $status): int
    {
        $map = [
            'operational' => 1,
            'performance_issues' => 2,
            'partial_outage' => 3,
            'major_outage' => 4,
            'maintenance' => 0,
        ];

        return $map[$status] ?? 1;
    }
}
```

### 3. Incident 管理

```php
<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;

class CachetIncidentService
{
    private Client $http;

    public function __construct()
    {
        $this->http = new Client([
            'base_uri' => config('services.cachet.base_url'),
            'headers' => [
                'X-Cachet-Token' => config('services.cachet.api_token'),
                'Accept' => 'application/json',
            ],
        ]);
    }

    /**
     * 创建 Incident
     */
    public function createIncident(
        string $name,
        string $message,
        string $status = 'investigating',
        array $componentIds = [],
        bool $notify = true
    ): array {
        $params = [
            'name' => $name,
            'message' => $message,
            'status' => $this->resolveIncidentStatus($status),
            'visible' => 1,
            'notify' => $notify ? 1 : 0,
        ];

        if (!empty($componentIds)) {
            $params['component_id'] = $componentIds[0];
        }

        $response = $this->http->post('/api/v1/incidents', [
            'form_params' => $params,
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }

    /**
     * 更新 Incident 进展
     */
    public function updateIncident(int $incidentId, string $status, ?string $message = null): array
    {
        $params = [
            'status' => $this->resolveIncidentStatus($status),
        ];

        if ($message !== null) {
            $params['message'] = $message;
        }

        $response = $this->http->put("/api/v1/incidents/{$incidentId}", [
            'form_params' => $params,
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }

    /**
     * 添加 Incident Message（时间线更新）
     */
    public function addIncidentMessage(int $incidentId, string $message): array
    {
        $response = $this->http->post("/api/v1/incidents/{$incidentId}/components", [
            'form_params' => [
                'message' => $message,
            ],
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }

    private function resolveIncidentStatus(string $status): int
    {
        $map = [
            'scheduled' => 0,
            'investigating' => 1,
            'identified' => 2,
            'watching' => 3,
            'resolved' => 4,
        ];

        return $map[$status] ?? 1;
    }
}
```

### 4. SLA 指标自动同步

这是状态页最有价值的部分——把真实的 SLA 数据同步到 Cachet Metrics。

```php
<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class SlaMetricsSyncService
{
    private Client $http;
    private CachetMetricService $metricService;

    public function __construct(CachetMetricService $metricService)
    {
        $this->http = new Client([
            'base_uri' => config('services.cachet.base_url'),
            'headers' => [
                'X-Cachet-Token' => config('services.cachet.api_token'),
                'Accept' => 'application/json',
            ],
        ]);
        $this->metricService = $metricService;
    }

    /**
     * 从监控数据计算 SLA 并同步到 Cachet
     */
    public function syncAvailabilityMetrics(): void
    {
        $services = $this->getMonitoredServices();

        foreach ($services as $service) {
            $metrics = $this->calculateServiceSla($service);

            $this->metricService->recordPoint(
                metricId: $service['cachet_metric_id'],
                value: $metrics['availability'],
            );
        }
    }

    /**
     * 计算单个服务的 SLA
     */
    private function calculateServiceSla(array $service): array
    {
        $period = now()->subMinutes(5);
        $totalRequests = DB::table('request_logs')
            ->where('service', $service['name'])
            ->where('created_at', '>=', $period)
            ->count();

        $successRequests = DB::table('request_logs')
            ->where('service', $service['name'])
            ->where('created_at', '>=', $period)
            ->where('status_code', '<', 500)
            ->count();

        $availability = $totalRequests > 0
            ? round(($successRequests / $totalRequests) * 100, 2)
            : 100.0;

        return [
            'availability' => $availability,
            'total_requests' => $totalRequests,
        ];
    }

    /**
     * 获取需要监控的服务列表
     */
    private function getMonitoredServices(): array
    {
        return Cache::remember('cachet_monitored_services', 3600, function () {
            return [
                [
                    'name' => 'api-gateway',
                    'cachet_metric_id' => 1,
                ],
                [
                    'name' => 'order-service',
                    'cachet_metric_id' => 2,
                ],
                [
                    'name' => 'payment-service',
                    'cachet_metric_id' => 3,
                ],
            ];
        });
    }
}
```

```php
<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;

class CachetMetricService
{
    private Client $http;

    public function __construct()
    {
        $this->http = new Client([
            'base_uri' => config('services.cachet.base_url'),
            'headers' => [
                'X-Cachet-Token' => config('services.cachet.api_token'),
                'Accept' => 'application/json',
            ],
        ]);
    }

    /**
     * 创建 Metric
     */
    public function createMetric(string $name, string $suffix = '%', bool $decimalPlaces = true): array
    {
        $response = $this->http->post('/api/v1/metrics', [
            'form_params' => [
                'name' => $name,
                'suffix' => $suffix,
                'decimal_places' => $decimalPlaces ? 2 : 0,
            ],
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }

    /**
     * 记录 Metric 数据点
     */
    public function recordPoint(int $metricId, float $value): array
    {
        $response = $this->http->post("/api/v1/metrics/{$metricId}/points", [
            'form_params' => [
                'value' => $value,
            ],
        ]);

        return json_decode((string) $response->getBody(), true)['data'];
    }
}
```

### 5. 自动告警触发 Incident

结合监控系统，自动创建 Incident 并通知订阅者。

```php
<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Events\ServiceDown;
use App\Services\CachetComponentService;
use App\Services\CachetIncidentService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

class CreateCachetIncidentListener implements ShouldQueue
{
    public function __construct(
        private CachetIncidentService $incidentService,
        private CachetComponentService $componentService,
    ) {}

    public function handle(ServiceDown $event): void
    {
        $service = $event->serviceName;
        $severity = $event->severity;
        $message = $event->message;

        Log::info('Creating Cachet incident', [
            'service' => $service,
            'severity' => $severity,
        ]);

        $componentId = config("services.cachet.components.{$service}.id");
        if ($componentId) {
            $this->componentService->updateComponentStatus(
                $componentId,
                $this->mapSeverityToComponentStatus($severity)
            );
        }

        $incident = $this->incidentService->createIncident(
            name: "{$service} 服务异常",
            message: $message,
            status: 'investigating',
            componentIds: $componentId ? [$componentId] : [],
            notify: true,
        );

        Log::info('Cachet incident created', [
            'incident_id' => $incident['id'],
        ]);
    }

    private function mapSeverityToComponentStatus(string $severity): string
    {
        return match ($severity) {
            'critical', 'emergency' => 'major_outage',
            'warning' => 'partial_outage',
            'info' => 'performance_issues',
            default => 'operational',
        };
    }
}
```

### 6. 配置管理

```php
<?php

// config/services.php

return [
    // ... 其他配置

    'cachet' => [
        'base_url' => env('CACHET_BASE_URL', 'http://cachet'),
        'api_token' => env('CACHET_API_TOKEN'),
        'components' => [
            'api-gateway' => ['id' => 1, 'group_id' => 1],
            'order-service' => ['id' => 2, 'group_id' => 2],
            'payment-service' => ['id' => 3, 'group_id' => 2],
        ],
    ],
];
```

---

## 踩坑记录

### 1. 组件状态更新不生效

**问题**：通过 API 更新组件状态，页面显示未变化。

**原因**：Cachet 有 Redis 缓存，直接调用 API 更新后，缓存可能未及时刷新。

**解决**：更新后主动清除缓存。

```bash
docker compose exec cachet php artisan cache:clear
docker compose exec cachet php artisan config:cache
```

或在代码中：

```php
Cache::tags(['cachet'])->flush();
```

### 2. Incident 通知邮件未发送

**问题**：创建 Incident 后，订阅者未收到邮件。

**排查**：

- 检查 `.env` 中 SMTP 配置
- 确认 `MAIL_DRIVER=smtp`（不是 `log`）
- 检查 `storage/logs/laravel.log` 中的邮件错误

```bash
docker compose exec cachet php artisan tinker
>>> Mail::raw('Test', fn($msg) => $msg->to('test@example.com')->subject('Test'));
```

### 3. API Token 权限问题

**问题**：API 返回 401 Unauthorized。

**解决**：Cachet 的 API Token 需要在后台手动创建，不是自动生成。

登录后台 → Settings → API → Create Token → 复制 Token。

### 4. Metric 数据点不显示

**问题**：创建 Metric 并记录数据点，但页面无图表。

**原因**：Cachet 默认 Metric 保留时间较短（24h），且需要足够多的数据点才有意义。

**解决**：确保同步频率足够高（建议每 5 分钟一次），并在 `config/cachet.php` 中调整保留时间。

### 5. 多组件 Incident 限制

**问题**：一个 Incident 需要关联多个组件，但 Cachet v2 只支持单组件绑定。

**解决**：两种方案：

- 为每个受影响组件创建独立 Incident
- 使用 Component Group 作为逻辑单元

```php
$groupIncidents = [];
foreach ($affectedComponents as $component) {
    $groupId = $component['group_id'];
    if (!isset($groupIncidents[$groupId])) {
        $groupIncidents[$groupId] = $this->incidentService->createIncident(
            name: "{$groupId} 分组服务异常",
            message: $message,
            status: 'investigating',
        );
    }
}
```

### 6. 状态页域名与 HTTPS

**问题**：Cachet 部署在内网，但需要对外访问。

**解决**：使用 Nginx 反向代理 + Let's Encrypt。

```nginx
server {
    listen 443 ssl http2;
    server_name status.example.com;

    ssl_certificate /etc/letsencrypt/live/status.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/status.example.com/privkey.pem;

    location / {
        proxy_pass http://cachet:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 进阶：与运维体系集成

### 1. Prometheus + Cachet 联动

从 Prometheus 抓取指标并同步到 Cachet：

```php
<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;

class PrometheusToCachetService
{
    private Client $prometheus;
    private CachetMetricService $cachetMetrics;

    public function __construct(CachetMetricService $cachetMetrics)
    {
        $this->prometheus = new Client([
            'base_uri' => config('services.prometheus.base_url'),
        ]);
        $this->cachetMetrics = $cachetMetrics;
    }

    /**
     * 从 Prometheus 查询可用性并同步
     */
    public function syncFromPrometheus(): void
    {
        $query = '100 * (1 - rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]))';

        $response = $this->prometheus->get('/api/v1/query', [
            'query' => ['query' => $query],
        ]);

        $data = json_decode((string) $response->getBody(), true);

        foreach ($data['data']['result'] as $result) {
            $service = $result['metric']['service'];
            $availability = (float) $result['value'][1];

            $metricId = config("services.cachet.metrics.{$service}.availability_id");
            if ($metricId) {
                $this->cachetMetrics->recordPoint($metricId, round($availability, 2));
            }
        }
    }
}
```

### 2. Incident 自动复盘

Incident 解决后，自动生成复盘报告并附加到 Incident：

```php
<?php

declare(strict_types=1);

namespace App\Services;

class IncidentPostmortemGenerator
{
    public function generate(array $incident): string
    {
        $startTime = $incident['created_at'];
        $resolvedTime = $incident['updated_at'];
        $duration = \Carbon\Carbon::parse($startTime)->diffForHumans(
            \Carbon\Carbon::parse($resolvedTime)
        );

        return <<<MARKDOWN
## 事件概要

- **服务**: {$incident['name']}
- **持续时间**: {$duration}
- **影响范围**: {$this->assessImpact($incident)}

## 时间线

{$this->buildTimeline($incident)}

## 根因分析

{$this->analyzeRootCause($incident)}

## 改进措施

{$this->suggestImprovements($incident)}
MARKDOWN;
    }

    private function assessImpact(array $incident): string
    {
        return '核心交易链路';
    }

    private function buildTimeline(array $incident): string
    {
        return "- {$incident['created_at']}: 事件触发\n- {$incident['updated_at']}: 事件解决";
    }

    private function analyzeRootCause(array $incident): string
    {
        return '待人工分析补充';
    }

    private function suggestImprovements(array $incident): string
    {
        return '1. 增加健康检查频率\n2. 优化告警阈值\n3. 补充降级方案';
    }
}
```

### 3. 定时同步任务

```php
<?php

// app/Console/Commands/SyncCachetMetrics.php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\SlaMetricsSyncService;
use Illuminate\Console\Command;

class SyncCachetMetrics extends Command
{
    protected $signature = 'cachet:sync-metrics';
    protected $description = 'Sync SLA metrics to Cachet status page';

    public function handle(SlaMetricsSyncService $syncService): int
    {
        $this->info('Syncing SLA metrics to Cachet...');

        try {
            $syncService->syncAvailabilityMetrics();
            $this->info('Metrics synced successfully.');
            return Command::SUCCESS;
        } catch (\Exception $e) {
            $this->error("Sync failed: {$e->getMessage()}");
            return Command::FAILURE;
        }
    }
}
```

```php
<?php

// app/Console/Kernel.php

protected $schedule = function (Schedule $schedule) {
    $schedule->command('cachet:sync-metrics')
        ->everyFiveMinutes()
        ->withoutOverlapping()
        ->appendOutputTo(storage_path('logs/cachet-sync.log'));
};
```

---

## 总结

Cachet 不只是一个"好看的状态页"，它可以成为对外 SLA 透明化的核心基础设施：

**核心价值**：

- **组件分级管理**：通过分组和状态定义，把微服务架构映射为用户可理解的服务单元
- **Incident 生命周期**：从发现到修复，全程透明，减少客服压力
- **订阅通知**：主动触达，而不是被动等待用户投诉
- **SLA 指标展示**：用数据说话，建立信任

**落地建议**：

1. 先独立部署验证，再接入监控体系
2. 组件划分以用户视角为准，不是技术视角
3. Incident 流程标准化，配合自动化脚本
4. 定期 review 状态页内容，确保信息准确
5. 把状态页 URL 放在所有对外渠道的显眼位置

**适用场景**：

- SaaS 产品对外展示可用性
- 微服务架构的运维透明化
- 合规要求的 SLA 报告
- 内部团队的跨部门协作

状态页是服务成熟度的标志之一。当你的服务稳定到敢于对外展示运行数据时，说明你已经建立了足够的工程自信。

---

## 参考

- [Cachet 官方文档](https://docs.cachethq.io/)
- [Cachet GitHub](https://github.com/cachethq/cachet)
- [SLA 最佳实践 - Google SRE](https://sre.google/sre-book/service-level-objectives/)
- [Incident Management 指南 - Atlassian](https://www.atlassian.com/incident-management)
