---

title: Laravel Reverb 实战：订单状态实时推送与多实例部署踩坑记录
keywords: [Laravel Reverb, 订单状态实时推送与多实例部署踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 07:45:00
categories:
- php
tags:
- Laravel
- Nginx
- Redis
- WebSocket
description: Laravel Reverb 订单实时推送实战：私有频道认证、afterCommit 事务广播、Redis 多实例总线、Nginx WebSocket 代理、Supervisor 托管及三个生产踩坑，快速落地 WebSocket 推送架构。
---


在 B2C API 里，订单创建后如果还靠前端每 3 秒轮询一次 `/orders/{id}`，高峰期其实很浪费：应用层多了无意义查询，数据库多了热行读取，用户看到的状态又不够“即时”。我们把订单付款、出票、失败回滚改成 **Laravel Reverb + WebSocket 推送** 后，移动端首屏状态更新延迟从 2~5 秒降到 300ms 内，接口 QPS 也明显回落。

这篇不讲概念，直接讲一套我会在生产上用的方案。

## 一、落地场景与边界

我们只把“强实时、低频写、高频读”的状态改成推送：

- 订单付款成功
- 库存占用失败
- 出票完成
- 优惠券核销结果返回

而像商品列表、搜索结果这类高频数据，仍然走 HTTP + 缓存，不硬上 WebSocket。

## 二、架构图

```text
                +-----------------------+
                |   iOS / Android / H5  |
                |  Echo + Reverb client |
                +-----------+-----------+
                            |
                     WebSocket/WSS
                            |
                    +-------v--------+
                    | Nginx / Ingress |
                    +-------+--------+
                            |
                    proxy_pass /app
                            |
              +-------------v--------------+
              | Laravel Reverb Server Pool |
              |   node-1 / node-2 / node-3 |
              +-------------+--------------+
                            |
                 publish via Redis bus
                            |
        +-------------------v-------------------+
        | Laravel API / Queue Worker / Scheduler |
        | dispatch(new OrderPaidBroadcast(...))  |
        +-------------------+-------------------+
                            |
                       MySQL / Redis
```

关键点有两个：

1. **API 和 Reverb 可以分开扩容**，别把 WebSocket 长连接和普通 PHP-FPM 请求绑死。
2. **多实例一定要有 Redis 广播总线**，不然连接在 node-1，事件发到 node-2，前端就收不到。

## 三、后端配置

先安装：

```bash
composer require laravel/reverb
php artisan reverb:install
php artisan make:event OrderStatusUpdated
```

`.env` 我实际会这样配：

```env
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=app-b2c
REVERB_APP_KEY=local-key
REVERB_APP_SECRET=local-secret
REVERB_HOST=ws.mikeah.dev
REVERB_PORT=8080
REVERB_SCHEME=https
REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8080
```

订单状态事件：

```php
<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderStatusUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly int $userId,
        public readonly string $orderNo,
        public readonly string $status,
        public readonly ?string $message = null,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('users.'.$this->userId)];
    }

    public function broadcastAs(): string
    {
        return 'order.status.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'order_no' => $this->orderNo,
            'status' => $this->status,
            'message' => $this->message,
            'sent_at' => now()->toDateTimeString(),
        ];
    }
}
```

这里我用 `ShouldBroadcastNow`，因为订单状态变更本身已经在 Queue Worker 中执行，再套一层广播队列只会增加抖动；如果你的广播量非常大，再切回 `ShouldBroadcast` 让广播异步化。

频道鉴权：

```php
<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('users.{userId}', function ($user, int $userId) {
    return (int) $user->id === $userId;
});
```

业务代码里在事务提交后再广播，别写在事务中间：

```php
DB::transaction(function () use ($order) {
    $order->markAsPaid();
    $order->save();

    DB::afterCommit(function () use ($order) {
        event(new OrderStatusUpdated(
            userId: $order->user_id,
            orderNo: $order->order_no,
            status: $order->status->value,
            message: '付款成功，准备出票'
        ));
    });
});
```

## 四、前端订阅

H5 管理后台我一般直接用 Echo：

```js
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

const echo = new Echo({
  broadcaster: 'reverb',
  key: 'local-key',
  wsHost: 'ws.mikeah.dev',
  wsPort: 443,
  wssPort: 443,
  forceTLS: true,
  enabledTransports: ['ws', 'wss'],
  authEndpoint: '/broadcasting/auth',
  auth: {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  }
});

echo.private(`users.${userId}`)
  .listen('.order.status.updated', (payload) => {
    updateOrderRow(payload.order_no, payload.status, payload.message);
  });
```

这里不要订阅 `orders.{orderNo}` 这种高基数频道。生产里我更建议按 `users.{id}` 或 `tenants.{id}` 聚合，不然频道数量、鉴权次数、连接管理成本都会上来。

## 五、Nginx 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name ws.mikeah.dev;

    location /app {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

`Upgrade` 和 `Connection` 少一个，握手就会降级失败；`proxy_read_timeout` 太小，移动网络抖一下就频繁断线。

## 六、三个真实踩坑

### 坑 1：事务未提交就广播，前端收到“假成功”

我们最早在 `OrderPaidService` 里先 `event()`，再写订单状态。结果前端已经显示 paid，但数据库事务后来因为优惠券核销失败回滚。最终方案就是上面的 `DB::afterCommit()`，把推送放到提交之后。

### 坑 2：多实例没接 Redis，总有“部分用户收不到”

单机测试没问题，一上 K8s 两个 Reverb Pod 就出事。原因很直接：连接打到 A，事件从 B 发出，A 根本不知道。后来把广播总线统一走 Redis，并保证 Reverb 与 API 使用同一套 app key/secret，问题才消失。

### 坑 3：把心跳和业务日志打到同一条日志流，ES 成本暴涨

WebSocket 心跳非常频繁，如果每次 ping/pong 都写 info log，EFK 很快被打爆。后来我只记录三类日志：连接建立、鉴权失败、异常断开；心跳只保留指标不上报明细。

## 七、补一段可直接上线的进程配置

本地 `php artisan reverb:start` 能跑，不代表生产可用。线上我会交给 Supervisor 或容器编排托管，至少保证自动拉起、平滑重启、日志分流。

```ini
[program:laravel-reverb]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/app/artisan reverb:start --host=0.0.0.0 --port=8080
user=www-data
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
numprocs=1
redirect_stderr=true
stdout_logfile=/var/log/supervisor/laravel-reverb.log
stdout_logfile_maxbytes=20MB
stdout_logfile_backups=5
```

如果跑在 Kubernetes，我会把 readiness probe 做成 TCP 或 HTTP 探测，并把 PodDisruptionBudget 配好，避免节点滚动更新时所有长连接同时被踢掉。

## 八、监控与排障指标

Reverb 上线后，排障不能只靠“前端说没收到消息”。我实际会盯这几类指标：

```php
<?php

namespace App\Support\Metrics;

use Illuminate\Support\Facades\Redis;

class ReverbMetrics
{
    public static function incrementAuthFailed(): void
    {
        Redis::incr('metrics:reverb:auth_failed');
    }

    public static function incrementBroadcastSuccess(): void
    {
        Redis::incr('metrics:reverb:broadcast_success');
    }

    public static function incrementDisconnect(string $reason): void
    {
        Redis::hincrby('metrics:reverb:disconnect_reason', $reason, 1);
    }
}
```

最少要有：

- 当前在线连接数
- 私有频道鉴权失败率
- 广播成功数 / 广播失败数
- 客户端重连次数
- Nginx 499 / 101 状态占比

很多团队第一天就能把功能跑通，但第二周就会陷入“偶发丢消息无法复现”。没有这些指标，基本只能靠猜。

## 九、我最终采用的生产建议

- **连接层**：Reverb 独立部署，不和 FPM 混部。
- **广播层**：Redis 做跨实例分发。
- **频道设计**：优先用户维度，避免订单号维度的海量私有频道。
- **发送时机**：所有业务事件统一 after commit。
- **观测性**：只看连接数、鉴权失败率、广播耗时、断线重连率四个核心指标。
- **前端策略**：重连退避要有限流，别在弱网下无限秒连把自己打挂。

如果你的场景只是“偶尔推一次通知”，别急着上整套实时架构；但只要前端已经在高频轮询订单、支付、出票、物流状态，Laravel Reverb 确实是 Laravel 体系里目前最顺手、接入成本最低的一条路。

## 十、总结

这次改造最有价值的不是“用了 WebSocket”，而是把 **状态更新链路** 理顺了：数据库提交、领域事件、广播发送、前端订阅、失败观测，全部串起来后，实时系统才不会只停留在 demo 阶段。Reverb 本身不复杂，真正容易翻车的是事务边界、多实例分发和代理层配置。

如果你已经有 Laravel Broadcasting 经验，我建议下一步直接补两件事：一是接入 Redis 做多节点广播，二是补一套断线重连与在线数监控。生产环境里，这两项比"能不能连上"重要得多。
## 相关阅读

- [Laravel Firebase Cloud Messaging Web Push 推送通知实战](/php/Laravel/laravel-firebase-cloud-messaging-web-push-service-worker) — 如果你还需要在离线场景推送通知，FCM + Service Worker 是 WebSocket 推送的有力补充，适合跨平台离线触达。
- [Laravel 消息幂等性设计模式实战：Inbox/Outbox 与重试补偿踩坑记录](/php/Laravel/laravel-design-patternsguide-inbox-outbox) — 实时广播与消息消费的幂等性设计密切相关，Outbox 模式能确保事件在事务提交后可靠投递。
- [Laravel BFF 中间层聚合实战 — GraphQL 到 JSON 转换优化](/php/Laravel/bff-laravel-guide-graphql-json-optimization) — 前端订阅 WebSocket 后减少轮询，BFF 层的聚合查询同样可以配合实时推送做按需拉取优化。
