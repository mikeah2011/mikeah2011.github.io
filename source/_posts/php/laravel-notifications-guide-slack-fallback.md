---

title: Laravel-Notifications-多通道实战-邮件短信Slack企业微信集成-统一通知抽象与降级策略踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 12:00:20
updated: 2026-05-05 12:02:58
categories:
  - php
tags: [CI/CD, Laravel, 工程管理]
keywords: [CI/CD, Laravel, 工程管理, Notifications, Slack]
description: >
---
## 为什么需要统一的通知抽象层？

在 KKday B2C 电商系统中，一个"订单确认"场景至少涉及 **4 种通知通道**：

```
订单支付成功
  ├── 邮件：发送电子票、行程确认单（带 PDF 附件）
  ├── 短信：发送取票验证码（6 位数字，15 分钟有效）
  ├── Slack：通知客服团队有新订单（内部运营监控）
  └── 企业微信：通知地接供应商准备接待（B2B 协同）
```

如果每种通道各自写逻辑，代码会变成这样：

```php
// ❌ 反面示例：散落在 Service 各处的通知逻辑
class OrderPaidService
{
    public function handle(Order $order): void
    {
        // 邮件
        Mail::to($order->user->email)->send(new OrderConfirmedMail($order));

        // 短信
        $sms = new SmsClient(config('services.sms.api_key'));
        $sms->send($order->user->phone, "您的订单 {$order->no} 已确认");

        // Slack
        Http::post(config('services.slack.webhook'), [
            'text' => "新订单 #{$order->no}，金额 {$order->total}",
        ]);

        // 企业微信
        $wechat = new WeChatWorkClient(config('services.wechat.corp_id'));
        $wechat->send($order->supplier->wecom_user, [
            'msgtype' => 'markdown',
            'markdown' => ['content' => "## 新订单通知\n> 订单号：{$order->no}"],
        ]);
    }
}
```

**问题清单**：
- 通知逻辑与业务逻辑耦合，改通道要动 Service
- 无法统一做重试、限流、降级
- 短信余额耗尽时没有 fallback
- 测试时需要 Mock 4 个外部依赖

Laravel 的 `Notification` 系统正是为了解决这些问题而设计的。

<!-- more -->

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         应用层 (Application)                        │
│  OrderPaidService / UserRegisteredService / ...                     │
│       │                                                             │
│       ▼                                                             │
│  $user->notify(new OrderConfirmed($order))                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Notification (通知对象)                          │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐      │
│  │  viaMail()   │  viaSms()    │ viaSlack()   │ viaWeCom()   │      │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘      │
└─────────┼──────────────┼──────────────┼──────────────┼──────────────┘
          │              │              │              │
          ▼              ▼              ▼              ▼
┌─────────────┐  ┌─────────────┐ ┌────────────┐ ┌─────────────┐
│  Mail 通道   │  │  SMS 通道    │ │ Slack 通道  │ │ 企业微信通道 │
│  (SMTP/SES) │  │ (Twilio/    │ │ (Webhook)  │ │ (API/       │
│             │  │  阿里云SMS)  │ │            │ │  应用消息)   │
└─────────────┘  └─────────────┘ └────────────┘ └─────────────┘
```

## Step 1：定义通知类

```php
<?php
// app/Notifications/OrderConfirmed.php

namespace App\Notifications;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Messages\SlackMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\HtmlString;

class OrderConfirmed extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Order $order,
    ) {}

    /**
     * 按优先级返回通道列表
     * 注意：via() 会在通知发送时被调用，不是定义时
     */
    public function via(object $notifiable): array
    {
        $channels = ['mail'];

        // 只有绑定了手机号才发短信
        if ($notifiable->phone) {
            $channels[] = 'sms';
        }

        // 运营 Slack channel - 通过配置开关控制
        if (config('notifications.slack.enabled')) {
            $channels[] = 'slack';
        }

        // 供应商有企业微信才发
        if ($this->order->supplier?->wecom_user) {
            $channels[] = 'wechat_work';
        }

        return $channels;
    }

    /**
     * 邮件通道 - 包含电子票 PDF 附件
     */
    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("订单确认 #{$this->order->no}")
            ->greeting("亲爱的 {$notifiable->name}，")
            ->line("您的订单已确认，以下是订单详情：")
            ->line("订单号：{$this->order->no}")
            ->line("出发日期：{$this->order->depart_date->format('Y-m-d')}")
            ->line("总金额：{$this->order->currency} {$this->order->total}")
            ->action('查看订单', route('orders.show', $this->order))
            ->line('请在出行前下载电子票，祝您旅途愉快！')
            ->attach(storage_path("app/tickets/{$this->order->no}.pdf"), [
                'mime' => 'application/pdf',
            ]);
    }

    /**
     * 短信通道 - 调用自定义 SMS Channel
     */
    public function toSms(object $notifiable): array
    {
        return [
            'template_id' => config('notifications.sms.templates.order_confirmed'),
            'params' => [
                'order_no'      => $this->order->no,
                'depart_date'   => $this->order->depart_date->format('m月d日'),
                'verification'  => $this->order->verification_code,
            ],
        ];
    }

    /**
     * Slack 通道 - 运营监控
     */
    public function toSlack(object $notifiable): SlackMessage
    {
        $order = $this->order;

        return (new SlackMessage)
            ->success()
            ->from('KKday Bot', ':airplane:')
            ->to('#order-notifications')
            ->content("新订单确认！:tada:")
            ->attachment(function ($attachment) use ($order) {
                $attachment
                    ->title("订单 #{$order->no}", route('admin.orders.show', $order))
                    ->fields([
                        '用户'   => $order->user->name,
                        '商品'   => $order->product->title,
                        '金额'   => "{$order->currency} {$order->total}",
                        '出发日' => $order->depart_date->format('Y-m-d'),
                    ]);
            });
    }

    /**
     * 企业微信通道 - 供应商通知
     */
    public function toWeChatWork(object $notifiable): array
    {
        return [
            'msgtype' => 'markdown',
            'markdown' => [
                'content' => implode("\n", [
                    "## :airplane: 新订单通知",
                    "> **订单号**：{$this->order->no}",
                    "> **商品**：{$this->order->product->title}",
                    "> **出发日期**：{$this->order->depart_date->format('Y-m-d')}",
                    "> **人数**：{$this->order->pax_count} 人",
                    "> **特殊需求**：{$this->order->special_request ?: '无'}",
                    "",
                    "[查看详情]({$this->order->supplier_portal_url})",
                ]),
            ],
        ];
    }
}
```

## Step 2：实现自定义 SMS Channel

Laravel 内置了 `MailChannel` 和 `SlackChannel`，但 SMS 和企业微信需要自定义：

```php
<?php
// app/Notifications/Channels/SmsChannel.php

namespace App\Notifications\Channels;

use App\Services\Sms\SmsClientInterface;
use Illuminate\Notifications\Notification;

class SmsChannel
{
    public function __construct(
        private readonly SmsClientInterface $sms,
    ) {}

    /**
     * Laravel 会调用 notification->{toSmsChannelName}($notifiable)
     * 方法名格式：to + StudlyCase(Channel 名) + ()
     * Channel 名 'sms' → toSms()
     */
    public function send($notifiable, Notification $notification): void
    {
        $message = $notification->toSms($notifiable);

        // 模板短信
        if (isset($message['template_id'])) {
            $this->sms->sendWithTemplate(
                to:       $notifiable->phone,
                template: $message['template_id'],
                params:   $message['params'],
            );
            return;
        }

        // 纯文本短信
        $this->sms->send(
            to:      $notifiable->phone,
            content: $message['content'] ?? $message,
        );
    }
}
```

```php
<?php
// app/Notifications/Channels/WeChatWorkChannel.php

namespace App\Notifications\Channels;

use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WeChatWorkChannel
{
    public function send($notifiable, Notification $notification): void
    {
        $message = $notification->toWeChatWork($notifiable);

        // 企业微信需要先获取 access_token
        $token = cache()->remember('wecom.access_token', 7000, function () {
            $resp = Http::get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', [
                'corpid'     => config('services.wecom.corp_id'),
                'corpsecret' => config('services.wecom.secret'),
            ]);
            return $resp->json('access_token');
        });

        $response = Http::post(
            "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={$token}",
            [
                'touser'  => $notifiable->wecom_userid,
                'msgtype' => $message['msgtype'],
                'agentid' => (int) config('services.wecom.agent_id'),
                ...$message,
            ],
        );

        if ($response->json('errcode') !== 0) {
            Log::error('企业微信通知发送失败', [
                'errcode' => $response->json('errcode'),
                'errmsg'  => $response->json('errmsg'),
            ]);
            throw new \RuntimeException(
                "企业微信通知发送失败: {$response->json('errmsg')}"
            );
        }
    }
}
```

## Step 3：注册自定义 Channel

```php
// app/Providers/AppServiceProvider.php

use App\Notifications\Channels\SmsChannel;
use App\Notifications\Channels\WeChatWorkChannel;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // SMS Channel 单例（底层 TCP 连接复用）
        $this->app->singleton(SmsChannel::class, function ($app) {
            return new SmsChannel(
                $app->make(\App\Services\Sms\SmsClientInterface::class)
            );
        });

        // 企业微信 Channel
        $this->app->singleton(WeChatWorkChannel::class);
    }
}
```

## Step 4：发送通知

```php
// 在业务 Service 中
class OrderPaidService
{
    public function handle(Order $order): void
    {
        // ... 业务逻辑 ...

        // 发送通知（Laravel 自动处理通道分发）
        $order->user->notify(new OrderConfirmed($order));
    }
}
```

**与 Notification Facade 的区别**：

```php
// 通知单个用户
$user->notify(new OrderConfirmed($order));

// 通知多个用户（比如供应商 + 买家）
Notification::send(
    [$order->user, $order->supplier],
    new OrderConfirmed($order)
);

// 通知匿名（无 notifiable 模型，用 routeNotificationFor 自定义）
Notification::route('mail', 'ops@kkday.com')
    ->route('slack', '#alerts')
    ->notify(new OrderConfirmed($order));
```

## 踩坑记录

### 踩坑 1：via() 方法会被调用两次

在队列化通知中，`via()` 会在 **dispatch 时**和 **consume 时**各调用一次。如果你在 `via()` 里做了 HTTP 请求（比如检查通道可用性），就会有性能问题：

```php
// ❌ 错误做法
public function via(object $notifiable): array
{
    // 每次调用都发 HTTP 请求检查短信余额
    $balance = Http::get('https://sms.api/balance')->json('remaining');
    if ($balance <= 0) {
        return ['mail']; // 短信余额不足，降级到邮件
    }

    return ['mail', 'sms'];
}

// ✅ 正确做法：用 Cache 缓存余额，定时任务刷新
public function via(object $notifiable): array
{
    $channels = ['mail'];

    if (cache('sms:balance', 0) > 0) {
        $channels[] = 'sms';
    }

    return $channels;
}
```

### 踩坑 2：队列化通知的序列化陷阱

通知默认会序列化到队列，但 **Eloquent 模型的懒加载关系不会自动 eager load**：

```php
// ❌ 通知里访问 $this->order->supplier->name 会触发 N+1 查询
// 因为反序列化后 order 关系可能未加载

class OrderConfirmed extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Order $order,
    ) {
        // ✅ 在构造函数中 eager load 所有需要的关系
        $this->order->loadMissing([
            'user',
            'supplier',
            'product',
        ]);
    }
}
```

### 踩坑 3：Slack Webhook 频率限制

Slack 的 Incoming Webhook 限制 **每秒 1 条**，高峰期订单密集时会 429：

```php
// 解决方案：在 Channel 中加限流
class CustomSlackChannel extends \Illuminate\Notifications\Channels\SlackChannel
{
    public function send($notifiable, Notification $notification): void
    {
        $lock = Cache::lock('slack:webhook:rate_limit', 1);

        if (!$lock->get()) {
            // 放入队列延迟 2 秒重试
            dispatch(fn() => $this->send($notifiable, $notification))
                ->delay(now()->addSeconds(2));
            return;
        }

        parent::send($notifiable, $notification);
    }
}
```

### 踩坑 4：企业微信 access_token 缓存竞争

并发请求时，多个进程同时发现 token 过期，导致重复请求：

```php
// ✅ 使用 atomic lock 防止缓存击穿
$token = Cache::remember('wecom.access_token', now()->addSeconds(7000), function () {
    $lock = Cache::lock('wecom:token:refreshing', 10);

    if (!$lock->get()) {
        // 等待其他进程刷新完成
        sleep(1);
        return Cache::get('wecom.access_token');
    }

    $token = Http::get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', [
        'corpid'     => config('services.wecom.corp_id'),
        'corpsecret' => config('services.wecom.secret'),
    ])->json('access_token');

    $lock->release();
    return $token;
});
```

### 踩坑 5：SMS 模板审核与多语言

短信模板需要运营商审核，不能随意修改文案。我们在数据库维护模板映射：

```php
// config/notifications.php
return [
    'sms' => [
        'templates' => [
            'order_confirmed'    => env('SMS_TPL_ORDER_CONFIRMED'),    // SMS_20240101_001
            'order_cancelled'    => env('SMS_TPL_ORDER_CANCELLED'),    // SMS_20240101_002
            'verification_code'  => env('SMS_TPL_VERIFICATION_CODE'),  // SMS_20240101_003
        ],
    ],
];
```

多语言场景下，需要用 `locale` 区分不同国家的模板 ID：

```php
public function toSms(object $notifiable): array
{
    $locale = $this->order->user->locale ?? app()->getLocale();

    return [
        'template_id' => config("notifications.sms.templates.{$locale}.order_confirmed"),
        'params' => [
            'order_no' => $this->order->no,
        ],
    ];
}
```

## 通道降级策略

生产环境中，任何通道都可能失败。我们实现了一个简单的降级机制：

```php
// app/Notifications/Concerns/WithFallback.php

trait WithFallback
{
    /**
     * 通道优先级映射
     */
    public function channelPriority(): array
    {
        return [
            'sms'          => 1,  // 最高优先级 - 用户最可能看到
            'mail'         => 2,
            'wechat_work'  => 3,
            'slack'        => 4,  // 仅内部监控
        ];
    }

    /**
     * 当主通道失败时的 fallback
     */
    public function fallbackChannel(string $failedChannel): ?string
    {
        $fallbacks = [
            'sms'         => 'mail',   // 短信失败 → 用邮件
            'mail'        => 'sms',    // 邮件失败 → 用短信
            'wechat_work' => 'slack',  // 企微失败 → 用 Slack
        ];

        return $fallbacks[$failedChannel] ?? null;
    }
}
```

在 Channel 中捕获异常并触发降级：

```php
// 使用 Laravel 的 NotificationFailed 事件
Event::listen(NotificationFailed::class, function (NotificationFailed $event) {
    $notification = $event->notification;

    if (in_array(WithFallback::class, class_uses_recursive($notification))) {
        $fallback = $notification->fallbackChannel($event->channel);

        if ($fallback) {
            Log::warning("通知通道降级", [
                'from'         => $event->channel,
                'to'           => $fallback,
                'notification' => get_class($notification),
            ]);

            Notification::route($fallback, /* ... */)
                ->notify($notification);
        }
    }
});
```

## 测试策略

```php
// tests/Feature/Notifications/OrderConfirmedTest.php

use App\Notifications\OrderConfirmed;
use Illuminate\Support\Facades\Notification;

it('sends order confirmation via all available channels', function () {
    Notification::fake();

    $order = Order::factory()
        ->for(User::factory()->create(['phone' => '+886912345678']))
        ->for(Supplier::factory()->create(['wecom_user' => 'zhangsan']))
        ->create();

    $order->user->notify(new OrderConfirmed($order));

    Notification::assertSentTo(
        $order->user,
        OrderConfirmed::class,
        function ($notification, $channels) {
            // 至少包含 mail 和 sms
            expect($channels)->toContain('mail', 'sms');
            return true;
        }
    );
});

it('skips SMS when user has no phone', function () {
    Notification::fake();

    $user = User::factory()->create(['phone' => null]);
    $order = Order::factory()->for($user)->create();

    $user->notify(new OrderConfirmed($order));

    Notification::assertSentTo(
        $user,
        OrderConfirmed::class,
        function ($notification, $channels) {
            expect($channels)->not->toContain('sms');
            return true;
        }
    );
});
```

## 小结

| 维度 | 方案 | 备注 |
|------|------|------|
| 邮件 | MailMessage + SES/SMTP | 支持附件、队列化 |
| 短信 | 自定义 SmsChannel + 模板 | 运营商审核模板 ID |
| Slack | SlackMessage + Webhook | 注意频率限制 |
| 企业微信 | 自定义 WeChatWorkChannel | access_token 缓存与刷新 |
| 降级 | NotificationFailed 事件 + 优先级映射 | 短信↔邮件双向降级 |
| 测试 | Notification::fake() | 按通道粒度断言 |

Laravel 的 Notification 系统核心价值在于**统一抽象**——你只需要关心"通知什么内容"（`toXxx()` 方法），不需要关心"怎么发送"（Channel 实现）。换 SMS 供应商？只改 `SmsChannel` 的实现，通知类一行不动。

## 相关阅读

- [Laravel Jobs & Queues 深度实战：延迟队列、批量任务与失败重试策略踩坑记录](/php/Laravel/laravel-jobs-queues-deep-dive)
- [Laravel Redis Queue Horizon 实战：队列监控、失败重试与性能调优](/php/Laravel/laravel-redis-queue-horizon-guide-monitoring)
- [Laravel Events & Listeners 实战：事件驱动解耦订单/库存/通知](/php/Laravel/laravel-events-listeners-guide)
- [Laravel Event-Listener 事件驱动架构 - 解耦订单处理踩坑记录](/php/Laravel/laravel-event-listener-architecture)
- [Laravel HTTP Client 容错弹性模式实战 - 熔断降级、重试退避与超时治理](/php/Laravel/laravel-http-client-guide-circuit-breakerfallback)
- [Laravel Firebase Cloud Messaging Web Push 推送通知实战](/php/Laravel/laravel-firebase-cloud-messaging-web-push-service-worker)
- [Laravel Horizon 队列监控与生产环境运维实战 - 多队列优先级、指标采集与自动恢复](/php/Laravel/laravel-horizon-monitoringguide)
- [Laravel Queue 队列实战踩坑记录 - KKday B2C API 真实经验分享](/php/Laravel/laravel-queue-patterns)
---
tle: Laravel-Notifications-多通道实战-邮件短信Slack企业微信集成-统一通知抽象与降级策略踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 12:00:20
updated: 2026-05-05 12:02:58
categories:
  - php
tags: [CI/CD, Laravel, 工程管理]
keywords: [CI/CD, Laravel, 工程管理, Notifications, Slack]
description: >
Laravel Notifications 多通道通知实战指南：基于 KKday B2C 电商系统，详解如何通过统一通知抽象层集成邮件、短信、Slack 与企业微信四大通道。深入讲解 Fallback 降级策略、自定义 SmsChannel 开发、Slack Webhook 频率限制处理、SMS 短信模板审核与多语言映射，以及队列化通知序列化陷阱、access_token 缓存竞争等生产级踩坑经验与测试方案。
---
## 为什么需要统一的通知抽象层？

在 KKday B2C 电商系统中，一个"订单确认"场景至少涉及 **4 种通知通道**：

```
订单支付成功
  ├── 邮件：发送电子票、行程确认单（带 PDF 附件）
  ├── 短信：发送取票验证码（6 位数字，15 分钟有效）
  ├── Slack：通知客服团队有新订单（内部运营监控）
  └── 企业微信：通知地接供应商准备接待（B2B 协同）
```

如果每种通道各自写逻辑，代码会变成这样：

```php
// ❌ 反面示例：散落在 Service 各处的通知逻辑
class OrderPaidService
{
    public function handle(Order $order): void
    {
        // 邮件
        Mail::to($order->user->email)->send(new OrderConfirmedMail($order));

        // 短信
        $sms = new SmsClient(config('services.sms.api_key'));
        $sms->send($order->user->phone, "您的订单 {$order->no} 已确认");

        // Slack
        Http::post(config('services.slack.webhook'), [
            'text' => "新订单 #{$order->no}，金额 {$order->total}",
        ]);

        // 企业微信
        $wechat = new WeChatWorkClient(config('services.wechat.corp_id'));
        $wechat->send($order->supplier->wecom_user, [
            'msgtype' => 'markdown',
            'markdown' => ['content' => "## 新订单通知\n> 订单号：{$order->no}"],
        ]);
    }
}
```

**问题清单**：
- 通知逻辑与业务逻辑耦合，改通道要动 Service
- 无法统一做重试、限流、降级
- 短信余额耗尽时没有 fallback
- 测试时需要 Mock 4 个外部依赖

Laravel 的 `Notification` 系统正是为了解决这些问题而设计的。

<!-- more -->

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         应用层 (Application)                        │
│  OrderPaidService / UserRegisteredService / ...                     │
│       │                                                             │
│       ▼                                                             │
│  $user->notify(new OrderConfirmed($order))                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Notification (通知对象)                          │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐      │
│  │  viaMail()   │  viaSms()    │ viaSlack()   │ viaWeCom()   │      │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘      │
└─────────┼──────────────┼──────────────┼──────────────┼──────────────┘
          │              │              │              │
          ▼              ▼              ▼              ▼
┌─────────────┐  ┌─────────────┐ ┌────────────┐ ┌─────────────┐
│  Mail 通道   │  │  SMS 通道    │ │ Slack 通道  │ │ 企业微信通道 │
│  (SMTP/SES) │  │ (Twilio/    │ │ (Webhook)  │ │ (API/       │
│             │  │  阿里云SMS)  │ │            │ │  应用消息)   │
└─────────────┘  └─────────────┘ └────────────┘ └─────────────┘
```

## Step 1：定义通知类

```php
<?php
// app/Notifications/OrderConfirmed.php

namespace App\Notifications;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Messages\SlackMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\HtmlString;

class OrderConfirmed extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Order $order,
    ) {}

    /**
     * 按优先级返回通道列表
     * 注意：via() 会在通知发送时被调用，不是定义时
     */
    public function via(object $notifiable): array
    {
        $channels = ['mail'];

        // 只有绑定了手机号才发短信
        if ($notifiable->phone) {
            $channels[] = 'sms';
        }

        // 运营 Slack channel - 通过配置开关控制
        if (config('notifications.slack.enabled')) {
            $channels[] = 'slack';
        }

        // 供应商有企业微信才发
        if ($this->order->supplier?->wecom_user) {
            $channels[] = 'wechat_work';
        }

        return $channels;
    }

    /**
     * 邮件通道 - 包含电子票 PDF 附件
     */
    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("订单确认 #{$this->order->no}")
            ->greeting("亲爱的 {$notifiable->name}，")
            ->line("您的订单已确认，以下是订单详情：")
            ->line("订单号：{$this->order->no}")
            ->line("出发日期：{$this->order->depart_date->format('Y-m-d')}")
            ->line("总金额：{$this->order->currency} {$this->order->total}")
            ->action('查看订单', route('orders.show', $this->order))
            ->line('请在出行前下载电子票，祝您旅途愉快！')
            ->attach(storage_path("app/tickets/{$this->order->no}.pdf"), [
                'mime' => 'application/pdf',
            ]);
    }

    /**
     * 短信通道 - 调用自定义 SMS Channel
     */
    public function toSms(object $notifiable): array
    {
        return [
            'template_id' => config('notifications.sms.templates.order_confirmed'),
            'params' => [
                'order_no'      => $this->order->no,
                'depart_date'   => $this->order->depart_date->format('m月d日'),
                'verification'  => $this->order->verification_code,
            ],
        ];
    }

    /**
     * Slack 通道 - 运营监控
     */
    public function toSlack(object $notifiable): SlackMessage
    {
        $order = $this->order;

        return (new SlackMessage)
            ->success()
            ->from('KKday Bot', ':airplane:')
            ->to('#order-notifications')
            ->content("新订单确认！:tada:")
            ->attachment(function ($attachment) use ($order) {
                $attachment
                    ->title("订单 #{$order->no}", route('admin.orders.show', $order))
                    ->fields([
                        '用户'   => $order->user->name,
                        '商品'   => $order->product->title,
                        '金额'   => "{$order->currency} {$order->total}",
                        '出发日' => $order->depart_date->format('Y-m-d'),
                    ]);
            });
    }

    /**
     * 企业微信通道 - 供应商通知
     */
    public function toWeChatWork(object $notifiable): array
    {
        return [
            'msgtype' => 'markdown',
            'markdown' => [
                'content' => implode("\n", [
                    "## :airplane: 新订单通知",
                    "> **订单号**：{$this->order->no}",
                    "> **商品**：{$this->order->product->title}",
                    "> **出发日期**：{$this->order->depart_date->format('Y-m-d')}",
                    "> **人数**：{$this->order->pax_count} 人",
                    "> **特殊需求**：{$this->order->special_request ?: '无'}",
                    "",
                    "[查看详情]({$this->order->supplier_portal_url})",
                ]),
            ],
        ];
    }
}
```

## Step 2：实现自定义 SMS Channel

Laravel 内置了 `MailChannel` 和 `SlackChannel`，但 SMS 和企业微信需要自定义：

```php
<?php
// app/Notifications/Channels/SmsChannel.php

namespace App\Notifications\Channels;

use App\Services\Sms\SmsClientInterface;
use Illuminate\Notifications\Notification;

class SmsChannel
{
    public function __construct(
        private readonly SmsClientInterface $sms,
    ) {}

    /**
     * Laravel 会调用 notification->{toSmsChannelName}($notifiable)
     * 方法名格式：to + StudlyCase(Channel 名) + ()
     * Channel 名 'sms' → toSms()
     */
    public function send($notifiable, Notification $notification): void
    {
        $message = $notification->toSms($notifiable);

        // 模板短信
        if (isset($message['template_id'])) {
            $this->sms->sendWithTemplate(
                to:       $notifiable->phone,
                template: $message['template_id'],
                params:   $message['params'],
            );
            return;
        }

        // 纯文本短信
        $this->sms->send(
            to:      $notifiable->phone,
            content: $message['content'] ?? $message,
        );
    }
}
```

```php
<?php
// app/Notifications/Channels/WeChatWorkChannel.php

namespace App\Notifications\Channels;

use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WeChatWorkChannel
{
    public function send($notifiable, Notification $notification): void
    {
        $message = $notification->toWeChatWork($notifiable);

        // 企业微信需要先获取 access_token
        $token = cache()->remember('wecom.access_token', 7000, function () {
            $resp = Http::get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', [
                'corpid'     => config('services.wecom.corp_id'),
                'corpsecret' => config('services.wecom.secret'),
            ]);
            return $resp->json('access_token');
        });

        $response = Http::post(
            "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={$token}",
            [
                'touser'  => $notifiable->wecom_userid,
                'msgtype' => $message['msgtype'],
                'agentid' => (int) config('services.wecom.agent_id'),
                ...$message,
            ],
        );

        if ($response->json('errcode') !== 0) {
            Log::error('企业微信通知发送失败', [
                'errcode' => $response->json('errcode'),
                'errmsg'  => $response->json('errmsg'),
            ]);
            throw new \RuntimeException(
                "企业微信通知发送失败: {$response->json('errmsg')}"
            );
        }
    }
}
```

## Step 3：注册自定义 Channel

```php
// app/Providers/AppServiceProvider.php

use App\Notifications\Channels\SmsChannel;
use App\Notifications\Channels\WeChatWorkChannel;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // SMS Channel 单例（底层 TCP 连接复用）
        $this->app->singleton(SmsChannel::class, function ($app) {
            return new SmsChannel(
                $app->make(\App\Services\Sms\SmsClientInterface::class)
            );
        });

        // 企业微信 Channel
        $this->app->singleton(WeChatWorkChannel::class);
    }
}
```

## Step 4：发送通知

```php
// 在业务 Service 中
class OrderPaidService
{
    public function handle(Order $order): void
    {
        // ... 业务逻辑 ...

        // 发送通知（Laravel 自动处理通道分发）
        $order->user->notify(new OrderConfirmed($order));
    }
}
```

**与 Notification Facade 的区别**：

```php
// 通知单个用户
$user->notify(new OrderConfirmed($order));

// 通知多个用户（比如供应商 + 买家）
Notification::send(
    [$order->user, $order->supplier],
    new OrderConfirmed($order)
);

// 通知匿名（无 notifiable 模型，用 routeNotificationFor 自定义）
Notification::route('mail', 'ops@kkday.com')
    ->route('slack', '#alerts')
    ->notify(new OrderConfirmed($order));
```

## 踩坑记录

### 踩坑 1：via() 方法会被调用两次

在队列化通知中，`via()` 会在 **dispatch 时**和 **consume 时**各调用一次。如果你在 `via()` 里做了 HTTP 请求（比如检查通道可用性），就会有性能问题：

```php
// ❌ 错误做法
public function via(object $notifiable): array
{
    // 每次调用都发 HTTP 请求检查短信余额
    $balance = Http::get('https://sms.api/balance')->json('remaining');
    if ($balance <= 0) {
        return ['mail']; // 短信余额不足，降级到邮件
    }

    return ['mail', 'sms'];
}

// ✅ 正确做法：用 Cache 缓存余额，定时任务刷新
public function via(object $notifiable): array
{
    $channels = ['mail'];

    if (cache('sms:balance', 0) > 0) {
        $channels[] = 'sms';
    }

    return $channels;
}
```

### 踩坑 2：队列化通知的序列化陷阱

通知默认会序列化到队列，但 **Eloquent 模型的懒加载关系不会自动 eager load**：

```php
// ❌ 通知里访问 $this->order->supplier->name 会触发 N+1 查询
// 因为反序列化后 order 关系可能未加载

class OrderConfirmed extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Order $order,
    ) {
        // ✅ 在构造函数中 eager load 所有需要的关系
        $this->order->loadMissing([
            'user',
            'supplier',
            'product',
        ]);
    }
}
```

### 踩坑 3：Slack Webhook 频率限制

Slack 的 Incoming Webhook 限制 **每秒 1 条**，高峰期订单密集时会 429：

```php
// 解决方案：在 Channel 中加限流
class CustomSlackChannel extends \Illuminate\Notifications\Channels\SlackChannel
{
    public function send($notifiable, Notification $notification): void
    {
        $lock = Cache::lock('slack:webhook:rate_limit', 1);

        if (!$lock->get()) {
            // 放入队列延迟 2 秒重试
            dispatch(fn() => $this->send($notifiable, $notification))
                ->delay(now()->addSeconds(2));
            return;
        }

        parent::send($notifiable, $notification);
    }
}
```

### 踩坑 4：企业微信 access_token 缓存竞争

并发请求时，多个进程同时发现 token 过期，导致重复请求：

```php
// ✅ 使用 atomic lock 防止缓存击穿
$token = Cache::remember('wecom.access_token', now()->addSeconds(7000), function () {
    $lock = Cache::lock('wecom:token:refreshing', 10);

    if (!$lock->get()) {
        // 等待其他进程刷新完成
        sleep(1);
        return Cache::get('wecom.access_token');
    }

    $token = Http::get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', [
        'corpid'     => config('services.wecom.corp_id'),
        'corpsecret' => config('services.wecom.secret'),
    ])->json('access_token');

    $lock->release();
    return $token;
});
```

### 踩坑 5：SMS 模板审核与多语言

短信模板需要运营商审核，不能随意修改文案。我们在数据库维护模板映射：

```php
// config/notifications.php
return [
    'sms' => [
        'templates' => [
            'order_confirmed'    => env('SMS_TPL_ORDER_CONFIRMED'),    // SMS_20240101_001
            'order_cancelled'    => env('SMS_TPL_ORDER_CANCELLED'),    // SMS_20240101_002
            'verification_code'  => env('SMS_TPL_VERIFICATION_CODE'),  // SMS_20240101_003
        ],
    ],
];
```

多语言场景下，需要用 `locale` 区分不同国家的模板 ID：

```php
public function toSms(object $notifiable): array
{
    $locale = $this->order->user->locale ?? app()->getLocale();

    return [
        'template_id' => config("notifications.sms.templates.{$locale}.order_confirmed"),
        'params' => [
            'order_no' => $this->order->no,
        ],
    ];
}
```

## 通道降级策略

生产环境中，任何通道都可能失败。我们实现了一个简单的降级机制：

```php
// app/Notifications/Concerns/WithFallback.php

trait WithFallback
{
    /**
     * 通道优先级映射
     */
    public function channelPriority(): array
    {
        return [
            'sms'          => 1,  // 最高优先级 - 用户最可能看到
            'mail'         => 2,
            'wechat_work'  => 3,
            'slack'        => 4,  // 仅内部监控
        ];
    }

    /**
     * 当主通道失败时的 fallback
     */
    public function fallbackChannel(string $failedChannel): ?string
    {
        $fallbacks = [
            'sms'         => 'mail',   // 短信失败 → 用邮件
            'mail'        => 'sms',    // 邮件失败 → 用短信
            'wechat_work' => 'slack',  // 企微失败 → 用 Slack
        ];

        return $fallbacks[$failedChannel] ?? null;
    }
}
```

在 Channel 中捕获异常并触发降级：

```php
// 使用 Laravel 的 NotificationFailed 事件
Event::listen(NotificationFailed::class, function (NotificationFailed $event) {
    $notification = $event->notification;

    if (in_array(WithFallback::class, class_uses_recursive($notification))) {
        $fallback = $notification->fallbackChannel($event->channel);

        if ($fallback) {
            Log::warning("通知通道降级", [
                'from'         => $event->channel,
                'to'           => $fallback,
                'notification' => get_class($notification),
            ]);

            Notification::route($fallback, /* ... */)
                ->notify($notification);
        }
    }
});
```

## 测试策略

```php
// tests/Feature/Notifications/OrderConfirmedTest.php

use App\Notifications\OrderConfirmed;
use Illuminate\Support\Facades\Notification;

it('sends order confirmation via all available channels', function () {
    Notification::fake();

    $order = Order::factory()
        ->for(User::factory()->create(['phone' => '+886912345678']))
        ->for(Supplier::factory()->create(['wecom_user' => 'zhangsan']))
        ->create();

    $order->user->notify(new OrderConfirmed($order));

    Notification::assertSentTo(
        $order->user,
        OrderConfirmed::class,
        function ($notification, $channels) {
            // 至少包含 mail 和 sms
            expect($channels)->toContain('mail', 'sms');
            return true;
        }
    );
});

it('skips SMS when user has no phone', function () {
    Notification::fake();

    $user = User::factory()->create(['phone' => null]);
    $order = Order::factory()->for($user)->create();

    $user->notify(new OrderConfirmed($order));

    Notification::assertSentTo(
        $user,
        OrderConfirmed::class,
        function ($notification, $channels) {
            expect($channels)->not->toContain('sms');
            return true;
        }
    );
});
```

## 小结

| 维度 | 方案 | 备注 |
|------|------|------|
| 邮件 | MailMessage + SES/SMTP | 支持附件、队列化 |
| 短信 | 自定义 SmsChannel + 模板 | 运营商审核模板 ID |
| Slack | SlackMessage + Webhook | 注意频率限制 |
| 企业微信 | 自定义 WeChatWorkChannel | access_token 缓存与刷新 |
| 降级 | NotificationFailed 事件 + 优先级映射 | 短信↔邮件双向降级 |
| 测试 | Notification::fake() | 按通道粒度断言 |

Laravel 的 Notification 系统核心价值在于**统一抽象**——你只需要关心"通知什么内容"（`toXxx()` 方法），不需要关心"怎么发送"（Channel 实现）。换 SMS 供应商？只改 `SmsChannel` 的实现，通知类一行不动。

## 相关阅读

- [Laravel Jobs & Queues 深度实战：延迟队列、批量任务与失败重试策略踩坑记录](/php/Laravel/laravel-jobs-queues-deep-dive)
- [Laravel Redis Queue Horizon 实战：队列监控、失败重试与性能调优](/php/Laravel/laravel-redis-queue-horizon-guide-monitoring)
- [Laravel Events & Listeners 实战：事件驱动解耦订单/库存/通知](/php/Laravel/laravel-events-listeners-guide)
- [Laravel Event-Listener 事件驱动架构 - 解耦订单处理踩坑记录](/php/Laravel/laravel-event-listener-architecture)
- [Laravel HTTP Client 容错弹性模式实战 - 熔断降级、重试退避与超时治理](/php/Laravel/laravel-http-client-guide-circuit-breakerfallback)
- [Laravel Firebase Cloud Messaging Web Push 推送通知实战](/php/Laravel/laravel-firebase-cloud-messaging-web-push-service-worker)
- [Laravel Horizon 队列监控与生产环境运维实战 - 多队列优先级、指标采集与自动恢复](/php/Laravel/laravel-horizon-monitoringguide)
- [Laravel Queue 队列实战踩坑记录 - KKday B2C API 真实经验分享](/php/Laravel/laravel-queue-patterns)
