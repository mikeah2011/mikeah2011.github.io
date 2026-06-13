---

title: Laravel-Slack-通知集成实战-部署推送CI结果与告警降噪踩坑记录
keywords: [Laravel, Slack, CI, 通知集成实战, 部署推送, 结果与告警降噪踩坑记录]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-05 01:15:58
updated: 2026-05-05 01:23:43
categories:
- devops
- php
tags:
- CI/CD
- Laravel
- 工程管理
- 监控
description: 在 KKday B2C 后端 30+ 仓库中落地 Slack 通知的完整方案：Incoming Webhook vs Slack App Bot 选型、Laravel Notification Channel 封装、GitHub Actions 部署/测试结果推送、生产告警降噪策略，以及踩过的每一个坑。
---


> 一句话总结：**Slack 通知不是"调个 Webhook 就完事"**——频道规划、消息格式、告警降噪、权限隔离每一步都有坑。本文是我在 KKday B2C 后端 30+ 仓库中落地 Slack 通知的完整复盘。

## 1. 为什么需要 Slack 通知？

在 KKday B2C 的日常开发中，团队需要实时感知以下事件：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  开发者 push  │     │  合并到 main │     │  生产环境部署 │
│  代码到 dev   │     │  触发 CI/CD  │     │  完成/失败    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              Slack 频道（按职责分层）                   │
│                                                     │
│  #ci-builds    → 测试通过/失败通知                    │
│  #deployments  → 部署成功/回滚通知                    │
│  #alerts       → 生产告警（错误率飙升/服务降级）        │
│  #dev-feed     → PR 合并、代码审查动态                 │
└─────────────────────────────────────────────────────┘
```

**不用 Slack 的替代方案**和它们的问题：

| 方案 | 问题 |
|------|------|
| Email 通知 | 被淹没在收件箱，团队 90% 不看 |
| 钉钉/飞书 | 国际团队不统一，KKday 用 Slack 协作 |
| Grafana/Alertmanager 独立页面 | 需要主动去看，被动感知缺失 |
| 手动 SSH 查日志 | 不可扩展，30+ 仓库管不过来 |

## 2. 选型：Incoming Webhook vs Slack App Bot

这是第一步，也是最容易踩坑的一步。

### 2.1 Incoming Webhook（简单场景）

```bash
# 创建方式：Slack App → Incoming Webhooks → Add New Webhook to Workspace
# 获得 URL：
# https://hooks.slack.com/services/T00FAKE00/B00FAKE00/your-webhook-token-here

curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Hello from KKday CI!"}' \
  https://hooks.slack.com/services/T00FAKE00/B00FAKE00/your-webhook-token-here
```

**优点**：5 分钟搞定，适合单仓库、单频道。

**坑 1**：Webhook URL 绑死一个频道。如果你想向不同频道发通知，得创建多个 Webhook。

**坑 2**：从 2024 年起 Slack 收紧了 Webhook 权限——**不能修改发送者头像和名称**（以前的 `username` 和 `icon_emoji` 参数已废弃）。Bot 模式才能自定义。

### 2.2 Slack App Bot（推荐方案）

```bash
# 1. 创建 Slack App → https://api.slack.com/apps
# 2. 添加 Bot Token Scopes: chat:write, chat:write.public
# 3. Install to Workspace → 获得 xoxb-xxxx Token
# 4. 可以向任意公共频道发送消息（无需单独 Webhook）
```

**架构对比**：

```
Incoming Webhook:
  GitHub Actions ──POST──► hooks.slack.com/services/xxx ──► #固定频道

Slack App Bot:
  GitHub Actions ──POST──► api.slack.com/chat.postMessage ──► #任意频道
                           (Bearer xoxb-token)
```

**我们最终选了 Slack App Bot**，原因：
- 30+ 仓库共享一个 Bot Token，通过 `channel` 参数动态路由
- 支持 Block Kit（富文本卡片），比纯文本 `text` 好看 10 倍
- 可以用同一个 Bot 统一管理权限

## 3. Laravel 项目中的 Slack 通知封装

### 3.1 安装依赖

```bash
composer require laravel/slack-notification-channel
# Laravel 10+ 已内置，Laravel 9 需要手动安装
```

### 3.2 创建通知类

```php
<?php
// app/Notifications/DeploymentNotification.php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use Illuminate\Notifications\Messages\Slack\BlockKit\Blocks\SectionBlock;
use Illuminate\Notifications\Messages\Slack\SlackMessage;

class DeploymentNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly string $environment,
        private readonly string $status,      // 'success' | 'failed' | 'rolled_back'
        private readonly string $commitSha,
        private readonly string $commitMessage,
        private readonly string $deployer,
        private readonly ?string $errorMessage = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['slack'];
    }

    public function toSlack(object $notifiable): SlackMessage
    {
        $emoji = match ($this->status) {
            'success'    => '✅',
            'failed'     => '❌',
            'rolled_back' => '⚠️',
            default      => 'ℹ️',
        };

        $color = match ($this->status) {
            'success'    => '#2EB67D',   // Slack green
            'failed'     => '#E01E5A',   // Slack red
            'rolled_back' => '#ECB22E',  // Slack yellow
            default      => '#36C5F0',
        };

        $shortSha = substr($this->commitSha, 0, 7);

        return (new SlackMessage())
            ->from('KKday Deploy Bot', ':rocket:')
            ->to('#deployments')           // ⭐ 动态频道
            ->success()                    // header color hint
            ->content("{$emoji} **Deploy to `{$this->environment}`**")
            ->attachment(function ($attachment) use ($color, $shortSha) {
                $attachment
                    ->color($color)
                    ->fields([
                        'Environment' => $this->environment,
                        'Status'      => strtoupper($this->status),
                        'Commit'      => "`{$shortSha}`",
                        'Deployer'    => $this->deployer,
                        'Time'        => now()->format('Y-m-d H:i:s'),
                    ])
                    ->content($this->commitMessage);

                if ($this->errorMessage) {
                    $attachment->content("```\n{$this->errorMessage}\n```");
                }
            });
    }
}
```

### 3.3 配置 Slack 频道路由

```php
<?php
// app/Models/User.php (或 app/Models/Team.php)

namespace App\Models;

use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use Notifiable;

    /**
     * ⭐ 踩坑点：Laravel 的 Slack Channel 不是写死频道名
     * 而是通过 routeNotificationForSlack() 返回 Webhook URL 或 Bot Token 配置
     */
    public function routeNotificationForSlack(?string $channel = null): string
    {
        // 方案 A：返回 Incoming Webhook URL（简单但不灵活）
        // return config('services.slack.webhook_url');

        // 方案 B：返回 Bot Token（推荐，支持动态频道）
        return config('services.slack.bot_token');
    }
}
```

```php
<?php
// config/services.php

return [
    'slack' => [
        // Incoming Webhook（简单场景）
        'webhook_url' => env('SLACK_WEBHOOK_URL'),

        // Bot Token（推荐方案）
        'bot_token'   => env('SLACK_BOT_TOKEN'),

        // 默认频道
        'default_channel' => env('SLACK_DEFAULT_CHANNEL', '#ci-builds'),
    ],
];
```

### 3.4 发送通知

```php
<?php
// app/Http/Controllers/DeployController.php

namespace App\Http\Controllers;

use App\Notifications\DeploymentNotification;
use App\Models\User;

class DeployController extends Controller
{
    public function handle(string $environment): void
    {
        try {
            // ... 部署逻辑 ...

            // 通知团队
            $deployer = auth()->user();
            $commitSha = trim(shell_exec('git rev-parse HEAD'));
            $commitMessage = trim(shell_exec('git log -1 --pretty=%B'));

            // ⭐ 踩坑：不要用 User::all()，用频道级别的 Notifiable
            // 创建一个 Channel Notifiable 对象
            $channel = app(SlackChannelNotifiable::class);
            $channel->notify(new DeploymentNotification(
                environment: $environment,
                status: 'success',
                commitSha: $commitSha,
                commitMessage: $commitMessage,
                deployer: $deployer->name,
            ));

        } catch (\Throwable $e) {
            // 部署失败也要通知
            $channel->notify(new DeploymentNotification(
                environment: $environment,
                status: 'failed',
                commitSha: $commitSha ?? 'unknown',
                commitMessage: $commitMessage ?? 'unknown',
                deployer: $deployer->name ?? 'system',
                errorMessage: $e->getMessage(),
            ));
        }
    }
}
```

## 4. GitHub Actions 集成：CI/CD 结果推送到 Slack

这是最实用的场景。每个仓库的 `.github/workflows/deploy.yml` 里加上通知步骤。

### 4.1 基础版：直接用 curl

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: dom, curl, mbstring, zip
          coverage: xdebug

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Run Tests
        id: test
        run: php artisan test --parallel --coverage-text || echo "TEST_FAILED=true" >> $GITHUB_OUTPUT

      - name: Notify Slack - Success
        if: success()
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: |
          curl -X POST https://slack.com/api/chat.postMessage \
            -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{
              "channel": "#ci-builds",
              "attachments": [{
                "color": "#2EB67D",
                "blocks": [
                  {
                    "type": "header",
                    "text": {
                      "type": "plain_text",
                      "text": "✅ CI Passed"
                    }
                  },
                  {
                    "type": "section",
                    "fields": [
                      {"type": "mrkdwn", "text": "*Repository:*\n${{ github.repository }}"},
                      {"type": "mrkdwn", "text": "*Branch:*\n${{ github.ref_name }}"},
                      {"type": "mrkdwn", "text": "*Commit:*\n`${{ github.sha }}`"},
                      {"type": "mrkdwn", "text": "*Actor:*\n${{ github.actor }}"}
                    ]
                  }
                ]
              }]
            }'

      - name: Notify Slack - Failure
        if: failure()
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: |
          curl -X POST https://slack.com/api/chat.postMessage \
            -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{
              "channel": "#ci-builds",
              "attachments": [{
                "color": "#E01E5A",
                "blocks": [
                  {
                    "type": "header",
                    "text": {
                      "type": "plain_text",
                      "text": "❌ CI Failed"
                    }
                  },
                  {
                    "type": "section",
                    "fields": [
                      {"type": "mrkdwn", "text": "*Repository:*\n${{ github.repository }}"},
                      {"type": "mrkdwn", "text": "*Branch:*\n${{ github.ref_name }}"},
                      {"type": "mrkdwn", "text": "*Commit:*\n`${{ github.sha }}`"},
                      {"type": "mrkdwn", "text": "*Actor:*\n${{ github.actor }}"}
                    ]
                  },
                  {
                    "type": "actions",
                    "elements": [
                      {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Run"},
                        "url": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
                      }
                    ]
                  }
                ]
              }]
            }'
```

### 4.2 进阶版：使用官方 Slack GitHub Action

```yaml
# ⭐ 更优雅的方式：slackapi/slack-github-action
- name: Notify Slack
  uses: slackapi/slack-github-action@v1.27.0
  with:
    payload: |
      {
        "channel": "#deployments",
        "blocks": [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "${{ job.status == 'success' && '✅' || '❌' }} ${{ github.workflow }} - ${{ job.status }}"
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*${{ github.repository }}* | <${{ github.event.pull_request.html_url || github.sha }}|${{ github.ref_name }}>"
            }
          }
        ]
      }
  env:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

### 4.3 多仓库共享 Workflow

KKday 有 30+ 仓库，不能每个仓库都复制粘贴通知步骤。用 **Reusable Workflow** 解决：

```yaml
# .github/workflows/reusable-notify-slack.yml（放在 org/.github 仓库）
name: Reusable Slack Notification

on:
  workflow_call:
    inputs:
      channel:
        required: true
        type: string
      status:
        required: true
        type: string
      message:
        required: true
        type: string
    secrets:
      SLACK_BOT_TOKEN:
        required: true

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: slackapi/slack-github-action@v1.27.0
        with:
          payload: |
            {
              "channel": "${{ inputs.channel }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "${{ inputs.status == 'success' && '✅' || '❌' }} ${{ inputs.message }}\n*${{ github.repository }}* by ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

各仓库调用：

```yaml
# 某个 Laravel 仓库的 .github/workflows/deploy.yml
jobs:
  deploy:
    # ... 部署步骤 ...

  notify:
    needs: deploy
    uses: org/.github/.github/workflows/reusable-notify-slack.yml@main
    with:
      channel: "#deployments"
      status: ${{ needs.deploy.result }}
      message: "Deploy to production"
    secrets:
      SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

## 5. 告警降噪：从"谁都不看"到"每条必读"

### 5.1 踩坑：通知风暴

上线第一天，我们把所有异常都发到 `#alerts`，结果：

```
周一早上打开 Slack，300+ 条未读通知。
绝大部分是同一个 Redis 超时抖动重复触发。
真正需要关注的 502 被淹没了。
```

### 5.2 解决方案：三级告警 + 去重

```php
<?php
// app/Exceptions/Handler.php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Notification;
use App\Notifications\AlertNotification;

class Handler extends ExceptionHandler
{
    // 告警级别定义
    private const ALERT_LEVELS = [
        'critical' => [
            'channel' => '#alerts-critical',
            'throttle' => 60,      // 60 秒内同类型只发一次
            'mention' => '<@U01XXXXXX> <@U02XXXXXX>',  // @ 指定人
        ],
        'warning' => [
            'channel' => '#alerts-warning',
            'throttle' => 300,     // 5 分钟内同类型只发一次
            'mention' => '',
        ],
        'info' => [
            'channel' => '#alerts-info',
            'throttle' => 3600,    // 1 小时内同类型只发一次
            'mention' => '',
        ],
    ];

    public function register(): void
    {
        $this->reportable(function (\Throwable $e) {
            $this->sendSlackAlert($e);
        });
    }

    private function sendSlackAlert(\Throwable $e): void
    {
        $level = $this->classifyException($e);
        $config = self::ALERT_LEVELS[$level];

        // ⭐ 去重 key：异常类名 + 文件 + 行号
        $dedupeKey = 'slack_alert:' . md5(
            get_class($e) . $e->getFile() . $e->getLine()
        );

        // ⭐ 节流：相同告警在 throttle 秒内只发一次
        if (Cache::has($dedupeKey)) {
            return;
        }
        Cache::put($dedupeKey, true, $config['throttle']);

        // 构建消息
        $context = [
            'level'     => strtoupper($level),
            'exception' => class_basename($e),
            'message'   => mb_substr($e->getMessage(), 0, 200),
            'file'      => str_replace(base_path(), '', $e->getFile()),
            'line'      => $e->getLine(),
            'url'       => request()->fullUrl() ?? 'N/A',
            'method'    => request()->method(),
            'user_id'   => auth()->id() ?? 'guest',
            'server'    => gethostname(),
            'mention'   => $config['mention'],
        ];

        // 发送到对应频道
        Notification::route('slack', $config['channel'])
            ->notify(new AlertNotification($context));
    }

    private function classifyException(\Throwable $e): string
    {
        // Critical: 500 错误、数据库连接失败、支付异常
        if ($e instanceof \PDOException || $e instanceof \RedisException) {
            return 'critical';
        }
        if (str_contains($e->getMessage(), 'Stripe') ||
            str_contains($e->getMessage(), 'Payment')) {
            return 'critical';
        }

        // Warning: 429 限流、第三方 API 超时
        if ($e instanceof \Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException) {
            return 'warning';
        }

        // Info: 404、验证失败
        if ($e instanceof \Symfony\Component\HttpKernel\Exception\NotFoundHttpException) {
            return 'info';
        }

        return 'warning';  // 默认 warning
    }
}
```

### 5.3 架构图：告警数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Laravel Application                         │
│                                                                     │
│  Exception → Handler.reportable()                                   │
│       │                                                             │
│       ▼                                                             │
│  classifyException() → level (critical/warning/info)                │
│       │                                                             │
│       ▼                                                             │
│  Cache::has(dedupeKey)? ──yes──► 跳过（已告警过）                    │
│       │no                                                          │
│       ▼                                                             │
│  Cache::put(dedupeKey, ttl=throttle)                                │
│       │                                                             │
│       ▼                                                             │
│  Notification::route('slack', channel)                              │
│       │                                                             │
└───────┼─────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────┐
  │           Slack Workspace                │
  │                                         │
  │  #alerts-critical  ← 60s 去重 + @oncall │
  │  #alerts-warning   ← 5min 去重          │
  │  #alerts-info      ← 1h 去重            │
  │  #deployments      ← 每次部署            │
  │  #ci-builds        ← 每次 CI             │
  └─────────────────────────────────────────┘
```

## 6. 踩坑记录（血泪经验）

### 坑 1：Slack Bot Token 泄露

```yaml
# ❌ 错误做法：Token 写死在 workflow 里
- run: |
    curl -H "Authorization: Bearer xoxb-1234-xxxx" ...

# ✅ 正确做法：使用 GitHub Secrets
- env:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

**真实事故**：某同事把 Bot Token 提交到了仓库的 `.env.example`，结果被 GitHub 扫描到，Token 被 Slack 自动 revoke，所有通知静默 2 小时无人察觉。

**解决方案**：在 pre-commit hook 加密钥扫描：

```bash
# .husky/pre-commit
npx secretlint "**/*" --secretlintignore .secretlintignore
```

### 坑 2：Block Kit 的 `channel` 参数必须是 ID 不是名称

```php
// ❌ 错误：频道名称在 Bot Token 模式下无效
->to('#deployments')

// ✅ 正确：使用频道 ID
->to('C01XXXXXX')  // 在频道详情页可以看到

// ✅ 或者先查询频道 ID
$channelId = Cache::remember('slack_channel_deployments', 86400, function () {
    $response = Http::withToken(config('services.slack.bot_token'))
        ->get('https://slack.com/api/conversations.list', [
            'types' => 'public_channel',
            'limit' => 200,
        ]);
    $channels = $response->json('channels');
    $found = collect($channels)->firstWhere('name', 'deployments');
    return $found['id'] ?? null;
});
```

### 坑 3：GitHub Actions 的 `failure()` 条件陷阱

```yaml
# ❌ 错误：如果 test job 失败，deploy job 被跳过，notify 也不会触发
jobs:
  test:
    runs-on: ubuntu-latest
    steps: [...]
  deploy:
    needs: test
    steps: [...]
  notify:
    needs: deploy    # ⭐ deploy 被跳过 → notify 也被跳过
    if: failure()

# ✅ 正确：用 always() + 判断前置 job 的结果
  notify:
    needs: [test, deploy]
    if: always() && (needs.test.result == 'failure' || needs.deploy.result == 'failure')
```

### 坑 4：Slack API 限流（Rate Limit）

Slack 的 `chat.postMessage` 限制：
- **每秒 1 次**（per channel）
- **每分钟 30 次**（per app）

在大批量部署（如 monorepo 同时部署 5 个服务）时容易触发 429。

```php
// 解决方案：队列化 + 限流
class SendSlackNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 5;  // 5 秒后重试

    public function handle(): void
    {
        // ⭐ 使用 Laravel 的 RateLimiter
        $key = 'slack-api-rate';
        RateLimiter::attempt($key, 1, function () {
            // 每秒最多 1 次
            Http::withToken(config('services.slack.bot_token'))
                ->post('https://slack.com/api/chat.postMessage', $this->payload);
        }, 1);
    }
}
```

### 坑 5：Lambda/Monolog 的 Slack Handler 与 Laravel Notification 冲突

```php
// ❌ 混用两套 Slack 通知，同一条异常发了两次
// config/logging.php
'slack' => [
    'driver' => 'slack',
    'url' => env('LOG_SLACK_WEBHOOK_URL'),
    'level' => 'error',   // Monolog 也发一份
],

// app/Exceptions/Handler.php
// 你的自定义 Slack 通知又发一份 ← 冲突！

// ✅ 解决：二选一，推荐保留 Handler 自定义版本，logging 里的 slack channel 关掉
```

## 7. 最终配置清单

```env
# .env（各环境）
SLACK_BOT_TOKEN=xoxb-xxxx-xxxx-xxxx
SLACK_DEFAULT_CHANNEL=C01XXXXXX
SLACK_ALERT_CHANNEL_CRITICAL=C02XXXXXX
SLACK_ALERT_CHANNEL_WARNING=C03XXXXXX
SLACK_DEPLOY_CHANNEL=C04XXXXXX
```

```yaml
# GitHub Secrets（Org 级别，所有仓库共享）
SLACK_BOT_TOKEN: xoxb-xxxx-xxxx-xxxx
```

**我们最终的通知矩阵**：

| 事件 | 频道 | 去重策略 | @提醒 |
|------|------|----------|-------|
| CI 成功 | #ci-builds | 无（每次都发） | 否 |
| CI 失败 | #ci-builds | 无 | @提交者 |
| 部署成功 | #deployments | 无 | 否 |
| 部署失败 | #deployments + #alerts-critical | 无 | @oncall |
| 生产异常 Critical | #alerts-critical | 60s/同类型 | @oncall |
| 生产异常 Warning | #alerts-warning | 5min/同类型 | 否 |
| 生产异常 Info | #alerts-info | 1h/同类型 | 否 |

## 8. 总结

| 维度 | 推荐方案 |
|------|----------|
| Webhook vs Bot | **Slack App Bot**（支持动态频道 + Block Kit） |
| 通知发送方式 | **Laravel Notification Channel**（业务层）+ **GitHub Action**（CI 层） |
| 告警降噪 | **Cache 去重 + 分频道路由** |
| 多仓库复用 | **Reusable Workflow + Org Secrets** |
| 安全 | **GitHub Secrets + pre-commit 密钥扫描** |

核心原则：**通知的价值 = 信号 / 噪音**。发 1000 条没人看的通知，不如发 10 条条条必读的通知。

---

*本文基于 KKday B2C Backend Team 的 Slack 通知落地实践，涉及 Laravel 10+ / GitHub Actions / Slack API v2。*

## 相关阅读

- [Laravel Notifications 多通道实战：邮件短信 Slack 企业微信集成——统一通知抽象与降级策略踩坑记录](/categories/Laravel/laravel-notifications-guide-slack-fallback/)
- [GitHub-Actions-Composer-Cache-构建时间从20s到5s-优化实战踩坑记录](/categories/DevOps/github-actions-composer-cache-20s5s-optimization/)
- [工程效能度量实战：DORA 四大指标在 Laravel 团队中的落地——Lead Time、部署频率与 MTTR](/categories/07_CICD/工程效能度量实战-DORA四大指标-Laravel团队落地/)
