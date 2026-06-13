---
title: 'Laravel Broadcasting 深度实战：Reverb + Private Channel + Presence Channel——B2C 电商的实时通知与在线状态架构'
date: 2026-06-06 10:00:00
tags: [Laravel, Broadcasting, Reverb, WebSocket, Presence Channel, Private Channel]
keywords: [Laravel Broadcasting, Reverb, Private Channel, Presence Channel, B2C, 深度实战, 电商的实时通知与在线状态架构, PHP]
description: '深度实战 Laravel Broadcasting + Reverb 在 B2C 电商场景中的实时通知架构，涵盖 Private Channel 订单状态推送、Presence Channel 客服在线状态与商品访客列表，包含 Nginx 反代配置、Redis 水平扩展、连接风暴与内存泄漏踩坑记录，以及 Reverb/Pusher/Ably/Soketi 选型对比，助你构建生产级 WebSocket 实时通信方案。'
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


## 一、引言：B2C 电商场景下的实时需求

在当今竞争激烈的 B2C 电商领域，用户体验已经从"能用"演进到了"极致流畅"。传统的轮询（Polling）模式——前端每隔 N 秒向后端发起 HTTP 请求检查状态更新——不仅浪费服务器资源，更在实时性上存在天然的延迟缺陷。假设用户每 5 秒轮询一次订单状态，那么在最坏情况下用户需要等待整整 5 秒才能看到状态变更。而如果把轮询间隔缩短到 1 秒，服务端将承受数倍的请求压力，这在大促期间是不可接受的。

当用户下单后焦急等待发货通知、商家急需收到库存预警、客服需要实时掌握在线访客列表时，WebSocket 长连接就成了不二之选。WebSocket 在客户端与服务端之间建立一条全双工通信隧道，服务端可以在任意时刻主动向客户端推送消息，延迟可以控制在毫秒级别，同时因为是持久连接，相比 HTTP 轮询的连接开销也大幅降低。

典型的 B2C 电商实时需求至少包含以下几个核心场景：

- **订单状态实时推送**：用户下单成功、支付确认、商家发货、物流更新等状态变更需要即时触达用户，避免用户反复刷新订单详情页。想象一下，用户在下单后立刻收到"支付成功"的实时通知，而不是退出页面又重新进入才能看到，这种体验的提升是质的飞跃。
- **库存预警通知**：当 SKU 库存跌破阈值时，实时通知运营人员进行补货操作，防止超卖。库存预警的时效性直接影响到营收——晚通知一分钟，可能就多卖了几十件缺货商品，带来大量的退款和客诉。
- **客服在线状态**：用户进入商品详情页或下单页面时，需要知道当前是否有客服在线，以便发起即时咨询。如果客服全部离线，前端可以引导用户留言而非长时间等待，提升转化率。
- **在线用户列表**：管理后台实时展示当前浏览某商品的用户数量和身份，运营人员可以据此进行精准营销——比如发现某商品当前有 200 人在线浏览，立刻推送限时优惠券。
- **促销倒计时与抢购广播**：秒杀活动开始、结束的精确时间同步。倒计时的每一秒都关系到用户是否能成功抢到商品，因此时间的准确性至关重要。
- **物流轨迹实时更新**：快递员揽件、中转、派送等环节的实时追踪，让用户随时掌握包裹动态。

Laravel 从 5.x 版本起就引入了 Broadcasting 组件来处理事件广播，而在 Laravel 11 生态中，官方推出的 **Reverb** 作为一等公民级的 WebSocket 服务器，终于让我们摆脱了对第三方服务（Pusher、Ably）的强依赖，实现了完全自托管的实时通信方案。Reverb 不仅与 Laravel 深度集成，还完美兼容 Pusher 协议，意味着所有基于 Pusher JS 构建的前端代码可以零修改地切换到 Reverb 后端。

本文将以一个 B2C 电商后台系统为蓝本，深度实战 Laravel Broadcasting + Reverb + Private Channel + Presence Channel 的完整链路，从架构设计到代码实现，从本地开发到生产部署，提供一份可落地的技术指南。

---

## 二、Laravel Broadcasting 体系全景

在深入 Reverb 之前，有必要先梳理 Laravel Broadcasting 的整体架构。Broadcasting 组件的核心职责是：**将服务端的事件（Event）通过指定的驱动（Driver）推送到客户端的 WebSocket 连接上**。它在架构上实现了事件的生产者（Laravel 应用）与事件的消费者（客户端浏览器/移动端）之间的解耦，开发者无需关心底层传输细节，只需定义事件和频道授权逻辑即可。

### 2.1 Broadcast Driver

Laravel 支持多种广播驱动，每种驱动有各自的特点和适用场景：

| 驱动 | 说明 | 适用场景 |
|------|------|----------|
| `reverb` | 官方自托管 WebSocket 服务器 | 全场景，推荐生产使用 |
| `pusher` | Pusher 协议兼容 | 使用 Pusher SaaS 服务 |
| `ably` | Ably 协议 | 使用 Ably SaaS 服务 |
| `redis` | Redis Pub/Sub | 配合 Socket.IO 等自建方案 |
| `log` | 日志输出 | 本地调试 |

在 `.env` 文件中配置广播驱动和 Reverb 相关参数：

```env
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=your-app-id
REVERB_APP_KEY=your-app-key
REVERB_APP_SECRET=your-app-secret
REVERB_HOST=ws.your-domain.com
REVERB_PORT=443
REVERB_SCHEME=https
```

`BROADCAST_CONNECTION` 是广播系统的总开关，它决定了 Laravel 在调用 `broadcast()` 辅助函数时使用哪个驱动来传输事件。切换驱动只需修改这一个配置，业务代码完全不需要改动——这就是抽象层的价值。

### 2.2 BroadcastManager

`BroadcastManager` 是广播系统的核心调度器，位于 `Illuminate\Broadcasting\BroadcastManager`。它在 Laravel 服务容器中以单例模式注册，承担以下职责：

1. **驱动解析与实例化**：根据配置文件中的 `BROADCAST_CONNECTION` 解析并创建对应的 `Broadcaster` 实现（如 `ReverbBroadcaster`、`PusherBroadcaster`）。使用了 Laravel 经典的 Manager 模式，支持动态扩展自定义驱动。
2. **频道管理**：提供 `channel()` 方法在 `routes/channels.php` 中注册频道授权规则。
3. **广播触发**：通过 `broadcast()` 辅助函数或 Event 的 `ShouldBroadcast` 接口，将事件分发到底层驱动。

核心接口 `Broadcaster` 定义了以下契约方法：

```php
interface Broadcaster
{
    // 验证客户端是否有权订阅频道
    public function auth($request);

    // 返回授权响应给客户端
    public function validAuthenticationResponse($request, $result);

    // 向指定频道广播事件
    public function broadcast(array $channels, string $event, array $payload = []): void;
}
```

这三个方法分别对应了广播系统的三个核心环节：授权验证、授权响应、事件分发。理解了这个接口，你就理解了 Broadcasting 的本质。

### 2.3 Channel Authorization（频道授权）

这是广播系统安全模型的基石。频道授权的核心问题是：**当客户端请求订阅某个频道时，服务端如何判断该客户端是否有权订阅？**

Laravel 在 `routes/channels.php` 中定义频道授权逻辑。授权回调接收当前认证用户和频道参数，返回 `true`（允许）、`false`（拒绝）或用户信息数组（用于 Presence Channel）：

```php
// routes/channels.php

use App\Models\Order;
use App\Models\User;

// Private Channel：只有订单所属用户才能监听
// 授权回调中的 $orderId 来自频道名中的通配符
Broadcast::channel('orders.{orderId}', function (User $user, int $orderId) {
    return $user->id === Order::findOrFail($orderId)->user_id;
});

// Presence Channel：客服频道，只有角色为客服的用户才能加入
// 返回的数组将作为该用户的"在线身份"广播给同频道其他成员
Broadcast::channel('customer-service', function (User $user) {
    if ($user->hasRole('customer_service')) {
        return ['id' => $user->id, 'name' => $user->name, 'avatar' => $user->avatar];
    }
    return false;
});

// Public Channel：无需授权，任何人可监听（用于公开广播如促销通知）
Broadcast::channel('promotions', function () {
    return true;
});
```

Laravel 提供三种频道类型，它们的安全级别递增：

- **Public Channel**（`channel-name`）：无需授权，客户端只需知道频道名即可订阅。适用于完全公开的信息，如全站公告、公开促销信息。数据可见性低，不包含任何敏感信息。
- **Private Channel**（`private-channel-name`）：需要认证，`Broadcast::channel()` 返回 `true` 才能订阅。授权端点会验证当前用户的身份（通过 Session Cookie 或 Sanctum Token）。适用于用户私有数据推送，如订单状态、个人消息。
- **Presence Channel**（`presence-channel-name`）：在 Private Channel 基础上增加了成员列表感知功能。不仅需要认证授权，还能让订阅同一频道的所有客户端实时感知到"谁加入"和"谁离开"。适用于需要展示在线状态的场景，如客服在线状态、直播间观众列表、协作编辑器中的在线协作者。

频道命名规则非常重要：Private Channel 必须以 `private-` 前缀开头，Presence Channel 必须以 `presence-` 前缀开头。在 Laravel 的 PHP 代码中使用 `PrivateChannel` 和 `PresenceChannel` 类时，前缀会自动添加，不需要手动拼接。

---

## 三、Reverb 架构深潜

Reverb 是 Laravel 官方在 2024 年推出的 WebSocket 服务器，它是 Laravel 生态中第一个真正意义上的"一等公民"级实时通信组件。在 Reverb 出现之前，想要自托管 WebSocket 服务，开发者通常需要借助 Soketi（Node.js）或 Swoole 扩展，这些方案要么依赖外部运行时，要么与 Laravel 的集成度不够深。Reverb 的出现彻底改变了这一局面。

### 3.1 自托管 WebSocket 服务器 vs Pusher 协议兼容

Reverb 采用了与 Pusher 协议完全兼容的设计策略，这是一个深思熟虑的架构决策。Pusher 协议经过十年以上的生产验证，协议本身设计成熟，客户端库覆盖了几乎所有的前端框架和移动平台。Reverb 选择兼容而非另起炉灶，意味着：

1. **客户端零迁移成本**：任何支持 Pusher 协议的客户端库（如 Laravel Echo、Pusher JS、pusher-swift、pusher-java）都可以直接连接 Reverb，无需修改一行代码。
2. **服务端深度集成**：Laravel 的 `BroadcastManager` 中 Reverb 使用 `PusherBroadcaster` 的逻辑，通过 HTTP API 触发广播事件。Reverb 内部实现了一个 HTTP 服务来接收来自 Laravel 应用的广播请求，然后通过 WebSocket 协议推送给所有订阅了对应频道的客户端。
3. **完全自托管**：数据不出服务器，无第三方服务费用，无月活用户数限制。对于数据合规要求严格的行业（如金融、医疗），自托管是刚性需求。

Reverb 底层基于 Ratchet（PHP WebSocket 框架）构建，并通过 ReactPHP 实现了异步非阻塞的事件循环。这意味着它可以在单个 PHP 进程中同时处理数千个并发 WebSocket 连接，而不会像传统的 PHP-FPM 模型那样每个请求占用一个进程。这是一个非常关键的技术突破——它证明了 PHP 在长连接场景下也可以做到高效运行。

### 3.2 连接生命周期

理解 Reverb 的连接生命周期对于排查问题至关重要。一个完整的 WebSocket 连接在 Reverb 中经历以下阶段：

```
客户端发起 WebSocket 握手（HTTP Upgrade 请求）
    ↓
Reverb 接受连接，完成协议升级，建立 TCP Socket
    ↓
Pusher 协议握手，服务端返回 connection_established
    ↓
客户端发起订阅请求（pusher:subscribe，携带频道名和认证信息）
    ↓
Reverb 判断频道类型：
    ├─ Public Channel → 直接加入
    └─ Private/Presence Channel → 调用 Laravel 应用的 HTTP 授权端点
    ↓
频道订阅成功 / 授权失败
    ↓
持续心跳保持连接（每 30 秒 ping/pong）
    ↓
接收服务端广播消息，推送给客户端 JavaScript 回调
    ↓
断开连接（客户端主动断开 / 心跳超时 / 服务端主动关闭）
```

在 Private Channel 和 Presence Channel 的订阅过程中，Reverb 会向 Laravel 应用的 `/broadcasting/auth` 端点发起一个 HTTP POST 请求，携带 `socket_id` 和 `channel_name`。Laravel 应用通过 Session 或 Token 认证用户身份后，执行 `routes/channels.php` 中定义的授权逻辑，并返回签名的授权响应。这个过程的安全性完全依赖于 Laravel 的认证系统，因此无需在 Reverb 层面重复实现认证逻辑。

### 3.3 心跳机制

Reverb 使用 Pusher 协议的内置心跳机制来维持连接活性。心跳的核心思想是：定期互相确认对方仍然存活，如果在约定时间内没有收到回复，则判定连接已断开。

心跳流程如下：

1. 服务端每隔 **30 秒**（可通过 `activity_timeout` 配置）向客户端发送 `pusher:ping` 消息。
2. 客户端收到 ping 后，必须在超时时间内回复 `pusher:pong` 消息。
3. 如果服务端在 `pong_timeout` 时间内未收到 pong 回复，判定连接已死，主动断开并清理相关资源（包括从所有订阅频道中移除该连接）。

在 `config/reverb.php` 中可以调整心跳参数：

```php
'options' => [
    'activity_timeout' => 30,    // 客户端不活跃超时（秒）
    'pong_timeout'     => 60,    // pong 响应超时（秒）
],
```

心跳间隔的选择需要在实时性和资源消耗之间取得平衡。间隔太短会增加网络流量和服务端 CPU 负担；间隔太长则导致断开的连接不能被及时发现，僵尸连接占用内存和连接数。在电商场景下，30 秒是一个被广泛验证的合理值。

> **踩坑提醒**：在生产环境中，如果前面有 Nginx 反代，务必配置 `proxy_read_timeout` 至少大于心跳间隔，否则 Nginx 会在心跳周期内提前断开连接。这是最常见的 WebSocket 断线原因之一，排查时容易忽略 Nginx 层面的配置问题。

---

## 四、Private Channel 实战：订单状态推送

让我们从最经典的场景开始——当用户下单后，订单状态的每一次变更都实时推送到用户的浏览器上。这个场景的特殊之处在于：订单信息是用户私有数据，只有订单的所有者才应该收到推送。Private Channel 正是为此而生。

### 4.1 定义广播事件

首先创建一个实现 `ShouldBroadcast` 接口的事件类。这个接口告诉 Laravel 的事件系统：这个事件不仅要写入日志/队列，还需要通过广播系统推送到客户端。

```php
<?php
// app/Events/OrderStatusUpdated.php

namespace App\Events;

use App\Models\Order;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Order $order,
    ) {}

    /**
     * 广播事件名称，前端 Echo 通过此名称监听
     * 使用 broadcastAs 可以自定义事件名，避免与 Laravel 内部事件命名冲突
     */
    public function broadcastAs(): string
    {
        return 'OrderStatusUpdated';
    }

    /**
     * 广播数据——精确控制推送给前端的内容
     * 只暴露必要的字段，避免泄露内部数据（如成本价、利润率等）
     */
    public function broadcastWith(): array
    {
        return [
            'order_id'     => $this->order->id,
            'order_no'     => $this->order->order_no,
            'status'       => $this->order->status,
            'status_label' => $this->order->status_label,
            'updated_at'   => $this->order->updated_at->toIso8601String(),
            'message'      => $this->generateMessage(),
        ];
    }

    /**
     * 广播到 Private Channel，频道名包含订单 ID
     * 使用 PrivateChannel 类确保频道前缀自动添加 "private-"
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('orders.' . $this->order->id),
        ];
    }

    /**
     * 根据订单状态生成用户友好的提示消息
     */
    private function generateMessage(): string
    {
        return match ($this->order->status) {
            'paid'        => "订单 {$this->order->order_no} 支付成功，等待商家确认",
            'confirmed'   => "订单 {$this->order->order_no} 已确认，正在备货",
            'shipped'     => "订单 {$this->order->order_no} 已发货，物流单号：{$this->order->tracking_no}",
            'delivered'   => "订单 {$this->order->order_no} 已签收",
            'cancelled'   => "订单 {$this->order->order_no} 已取消",
            'refunded'    => "订单 {$this->order->order_no} 退款申请已通过",
            default       => "订单 {$this->order->order_no} 状态已更新",
        };
    }
}
```

几点设计要点值得强调：

1. **`broadcastWith()` 只返回必要字段**：不要把整个 `$order->toArray()` 推送给前端。模型可能包含成本价、内部备注、供应商信息等不应暴露的字段。精确控制广播数据是安全实践的重要一环。
2. **`broadcastAs()` 自定义事件名**：如果不使用这个方法，Laravel 会使用完整的类名（如 `App\Events\OrderStatusUpdated`）作为广播事件名。自定义后前端监听代码更简洁，也避免了类名变更导致前端需要同步修改的问题。
3. **`SerializesModels` trait**：当事件通过队列异步广播时，这个 trait 会自动序列化和反序列化 Eloquent 模型。

### 4.2 频道授权

频道授权是 Private Channel 安全性的保障。授权逻辑写在 `routes/channels.php` 中：

```php
// routes/channels.php
Broadcast::channel('orders.{orderId}', function (User $user, int $orderId) {
    $order = Order::find($orderId);

    // 订单不存在则拒绝
    if (!$order) {
        return false;
    }

    // 只有订单所有者可以监听
    return $user->id === $order->user_id;
});
```

当客户端调用 `Echo.private('orders.123')` 时，Laravel Echo 会自动向 `/broadcasting/auth` 发送授权请求。Laravel 服务端从请求中提取当前用户（通过 Session Cookie 或 Sanctum Token），执行 `routes/channels.php` 中匹配到的授权回调。回调返回 `true` 后，Reverb 才会允许该客户端订阅此频道。

> **安全提醒**：如果授权回调中查询数据库的开销较大（比如涉及多表 JOIN），建议使用 `Cache::remember()` 缓存授权结果，设置合理的 TTL。这既提升了授权端点的响应速度，也减轻了数据库压力。

### 4.3 触发广播

在订单状态变更的业务逻辑中触发事件。推荐在 Service 层或 Model 的 Observer 中触发：

```php
<?php
// app/Services/OrderService.php

namespace App\Services;

use App\Events\OrderStatusUpdated;
use App\Models\Order;

class OrderService
{
    public function updateStatus(Order $order, string $newStatus): Order
    {
        $oldStatus = $order->status;

        $order->update([
            'status' => $newStatus,
            'status_changed_at' => now(),
        ]);

        // 触发广播事件——所有订阅了该频道的客户端都会收到推送
        broadcast(new OrderStatusUpdated($order));

        // 同时触发数据库通知（站内信），作为广播的兜底方案
        $order->user->notify(new OrderStatusNotification($order));

        // 记录状态变更日志
        activity()
            ->performedOn($order)
            ->withProperties(['old_status' => $oldStatus, 'new_status' => $newStatus])
            ->log('order_status_changed');

        return $order;
    }
}
```

注意这里同时使用了广播和数据库通知。广播保证实时性，数据库通知作为兜底——如果用户在状态变更时恰好不在线，下次登录后仍能在消息中心看到通知。

### 4.4 前端监听

```javascript
// resources/js/order-status.js

import Echo from 'laravel-echo';

// 假设已全局初始化 Echo（见第六章详细配置）
const orderEl = document.querySelector('[data-order-id]');
const orderId = orderEl?.dataset.orderId;

if (orderId) {
    Echo.private(`orders.${orderId}`)
        .listen('.OrderStatusUpdated', (e) => {
            console.log('订单状态更新:', e);

            // 更新页面上的订单状态标签
            const statusEl = document.querySelector('#order-status');
            if (statusEl) {
                statusEl.textContent = e.status_label;
                statusEl.dataset.status = e.status;
                // 添加闪烁动画，吸引用户注意力
                statusEl.classList.add('status-updated');
                setTimeout(() => statusEl.classList.remove('status-updated'), 2000);
            }

            // 显示通知 Toast
            showToast(e.message, 'info');

            // 如果是"已发货"状态，显示物流信息面板
            if (e.status === 'shipped') {
                showTrackingPanel(e);
            }

            // 如果是"已签收"状态，弹出评价引导
            if (e.status === 'delivered') {
                showReviewPrompt(e.order_id);
            }
        });
}
```

注意事件名称前的 `.`——当使用 `broadcastAs()` 自定义事件名称时，Echo 的 `.listen()` 方法需要在名称前加 `.` 前缀。这是因为 Pusher 协议规定客户端事件（Client Events）以 `client-` 开头，服务端事件默认不带前缀，而 Laravel Echo 使用 `.` 前缀来区分自定义事件名和 Channel 名。这个细节容易被忽略，却是新手最常踩的坑之一。

---

## 五、Presence Channel 实战：客服在线状态 + 在线用户列表

Presence Channel 是 Private Channel 的超集，它最大的价值在于：**不仅提供授权验证，还能让订阅同一频道的所有客户端实时感知到彼此的存在**。换句话说，Presence Channel 天然具备了"在线成员列表"的能力，无需开发者自己维护复杂的在线状态数据结构。

### 5.1 场景设计

在一个 B2C 电商平台上，我们需要实现两个典型场景：

1. **客服在线状态面板**：客服人员登录后台管理面板后，自动加入 `presence-customer-service` 频道。其他客服和管理员可以实时看到当前在线的客服列表，包括他们的头像、姓名和上线时间。当某位客服离开或断线时，其他人会立即收到通知。
2. **商品页面在线访客**：当用户浏览某个商品详情页时，自动加入该商品的 Presence Channel。页面上实时显示"当前有 N 人正在浏览"，并可以展开查看在线用户头像列表。这不仅增强了社交证明感（"这么多人在看"可以刺激购买决策），还为运营人员提供了实时流量监控数据。

### 5.2 客服频道实现

首先定义频道授权逻辑：

```php
// routes/channels.php

use App\Models\User;

// 客服在线状态 Presence Channel
Broadcast::channel('customer-service', function (User $user) {
    // 只有客服角色可以加入，严格的角色校验是安全底线
    if (!$user->hasRole('customer_service')) {
        return false;
    }

    // 返回的数据会广播给同频道的其他成员
    // 这里的字段会出现在 "here" 和 "joining" 回调的 user 对象中
    return [
        'id'        => $user->id,
        'name'      => $user->name,
        'avatar'    => $user->avatar_url,
        'role'      => 'customer_service',
        'joined_at' => now()->toIso8601String(),
    ];
});

// 商品在线访客 Presence Channel
Broadcast::channel('product.{productId}', function (User $user, int $productId) {
    // 任何登录用户都可以查看商品的在线访客
    return [
        'id'     => $user->id,
        'name'   => $user->nickname ?? $user->name,
        'avatar' => $user->avatar_url,
    ];
});
```

Presence Channel 授权回调的返回值至关重要：它定义了该用户在频道中的"在线身份"。这些数据会通过 `pusher_internal:member_added` 事件广播给频道内所有成员。因此，返回的数据字段要精心设计——既要提供足够的信息让前端展示，又不能泄露过多的用户隐私。

### 5.3 前端：客服在线面板（Vue 3 组件）

```vue
<!-- components/CustomerServicePanel.vue -->
<template>
  <div class="customer-service-panel">
    <h3>
      <span class="online-dot" :class="{ 'dot-active': onlineStaff.length > 0 }"></span>
      在线客服 ({{ onlineStaff.length }})
    </h3>
    <transition-group name="fade" tag="ul" class="staff-list">
      <li v-for="member in onlineStaff" :key="member.id" class="staff-item">
        <img :src="member.avatar" :alt="member.name" class="avatar" />
        <div class="staff-info">
          <span class="name">{{ member.name }}</span>
          <span class="joined-time">
            {{ formatJoinTime(member.joined_at) }} 上线
          </span>
        </div>
      </li>
    </transition-group>

    <!-- 当没有客服在线时显示提示 -->
    <div v-if="onlineStaff.length === 0" class="empty-tip">
      当前无客服在线
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const onlineStaff = ref([]);

onMounted(() => {
  window.Echo.join('customer-service')
    .here((users) => {
      // here 回调在初次加入频道时触发，传入当前已在频道中的所有成员
      console.log('[Presence] 当前在线客服:', users);
      onlineStaff.value = users;
    })
    .joining((user) => {
      // 当有新成员加入频道时触发
      console.log('[Presence] 客服上线:', user.name);
      // 检查去重，防止快速断线重连导致的重复成员
      if (!onlineStaff.value.find(u => u.id === user.id)) {
        onlineStaff.value.push(user);
        showToast(`${user.name} 已上线`, 'success');
      }
    })
    .leaving((user) => {
      // 当成员离开频道时触发
      console.log('[Presence] 客服下线:', user.name);
      onlineStaff.value = onlineStaff.value.filter(u => u.id !== user.id);
      showToast(`${user.name} 已下线`, 'warning');
    })
    .error((error) => {
      console.error('[Presence] 连接错误:', error);
      showToast('客服频道连接失败，请刷新页面重试', 'error');
    });
});

onUnmounted(() => {
  // 离开页面时主动退出频道，释放服务端资源
  window.Echo.leave('customer-service');
});

function formatJoinTime(joinedAt) {
  if (!joinedAt) return '';
  return new Date(joinedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>
```

### 5.4 前端：商品在线访客（React 组件）

```jsx
// components/ProductVisitors.jsx
import { useState, useEffect, useCallback } from 'react';

export default function ProductVisitors({ productId }) {
  const [visitors, setVisitors] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleHere = useCallback((users) => {
    setVisitors(users);
  }, []);

  const handleJoining = useCallback((user) => {
    setVisitors(prev => {
      // 去重：防止重复添加
      if (prev.find(u => u.id === user.id)) return prev;
      return [...prev, user];
    });
  }, []);

  const handleLeaving = useCallback((user) => {
    setVisitors(prev => prev.filter(u => u.id !== user.id));
  }, []);

  useEffect(() => {
    const channel = window.Echo.join(`product.${productId}`)
      .here(handleHere)
      .joining(handleJoining)
      .leaving(handleLeaving);

    return () => {
      // 组件卸载时自动退出频道
      window.Echo.leave(`product.${productId}`);
    };
  }, [productId, handleHere, handleJoining, handleLeaving]);

  if (visitors.length === 0) return null;

  return (
    <div className="product-visitors">
      <div
        className="visitor-count"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
      >
        <span className="pulse-dot"></span>
        <span>当前 {visitors.length} 人正在浏览</span>
        <span className="expand-icon">{isExpanded ? '▲' : '▼'}</span>
      </div>

      {isExpanded && (
        <div className="visitor-list">
          <div className="avatar-stack">
            {visitors.slice(0, 5).map(v => (
              <img
                key={v.id}
                src={v.avatar}
                alt={v.name}
                title={v.name}
                className="visitor-avatar"
              />
            ))}
            {visitors.length > 5 && (
              <span className="more-count">+{visitors.length - 5}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Presence Channel 的底层原理值得深入了解：Reverb 在服务端维护了一个频道成员的内存数据结构。当用户调用 `join()` 时，Reverb 首先调用 Laravel 的 `/broadcasting/auth` 授权端点验证身份，成功后将用户信息写入成员列表，并向频道内所有已有成员广播 `pusher_internal:member_added` 事件（触发 `joining` 回调），同时向新加入的成员发送当前成员列表（触发 `here` 回调）。当用户离开时，Reverb 广播 `pusher_internal:member_removed` 事件（触发 `leaving` 回调）并从列表中移除该成员。

---

## 六、前端集成：Laravel Echo 2.x + Reverb

### 6.1 安装依赖

```bash
# 安装 Laravel Echo 及底层的 Pusher JS 客户端
# Pusher JS 兼容 Reverb 的 Pusher 协议
npm install laravel-echo pusher-js
```

### 6.2 配置 Laravel Echo

以下是生产就绪的完整配置，包含了断线重连、错误处理等关键设置：

```javascript
// resources/js/echo.js

import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

// Pusher JS 是 Echo 的底层 WebSocket 传输层
window.Pusher = Pusher;

const echo = new Echo({
  broadcaster: 'reverb',

  // Reverb 服务器连接配置，从环境变量读取
  key: import.meta.env.VITE_REVERB_APP_KEY,
  wsHost: import.meta.env.VITE_REVERB_HOST ?? window.location.hostname,
  wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
  wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,

  // 启用 TLS 加密连接（生产环境必须开启）
  forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',

  // 指定可用的传输协议
  enabledTransports: ['ws', 'wss'],

  // 心跳参数配置（与服务端保持一致）
  activityTimeout: 30000,
  pongTimeout: 60000,
});

export default echo;
```

在 `resources/js/app.js` 中引入并挂载到全局：

```javascript
import './echo';
import echo from './echo';

// 挂载到 window 以便在任何组件中访问
window.Echo = echo;
```

对应的 `.env` Vite 环境变量配置：

```env
VITE_REVERB_APP_KEY=${REVERB_APP_KEY}
VITE_REVERB_HOST=${REVERB_HOST}
VITE_REVERB_PORT=${REVERB_PORT}
VITE_REVERB_SCHEME=${REVERB_SCHEME}
```

注意 `VITE_` 前缀——Vite 只会暴露以 `VITE_` 开头的环境变量到客户端 JavaScript 中，避免意外泄露服务端密钥。

### 6.3 CSRF Token 授权

Private Channel 和 Presence Channel 在订阅时需要向 Laravel 的广播授权端点 `/broadcasting/auth` 发送 POST 请求。这个请求必须携带有效的认证凭据（Session Cookie 或 API Token）。Laravel Echo 默认会自动读取页面中 `<meta name="csrf-token">` 标签的 CSRF Token，并在授权请求的 Header 中携带。

确保 Blade 模板中存在以下 Meta 标签：

```html
<meta name="csrf-token" content="{{ csrf_token() }}">
```

如果你的项目使用 Sanctum 或 Passport 进行 API 认证，则需要在 Echo 初始化时手动指定 Token：

```javascript
const echo = new Echo({
  broadcaster: 'reverb',
  // ...其他配置

  // 使用 Sanctum Bearer Token 认证
  authorizer: (channel, options) => {
    return {
      authorize: (socketId, callback) => {
        axios.post('/broadcasting/auth', {
          socket_id: socketId,
          channel_name: channel.name,
        }, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
          },
        })
        .then(response => callback(false, response.data))
        .catch(error => {
          console.error('Channel authorization failed:', error);
          callback(true, error);
        });
      }
    };
  },
});
```

---

## 七、生产环境运维

### 7.1 Nginx 反代 WebSocket

在生产环境中，Reverb 通常不直接暴露在公网。通过 Nginx 反向代理可以获得 SSL 终止、负载均衡、限流等企业级能力。WebSocket 的反代与普通 HTTP 请求有一个关键区别：**必须正确处理协议升级（Upgrade）头**。

以下是经过生产验证的 Nginx 配置：

```nginx
# WebSocket 协议升级映射
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Reverb WebSocket 反向代理
server {
    listen 443 ssl http2;
    server_name ws.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/ws.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ws.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;  # Reverb 服务器监听端口
        proxy_http_version 1.1;

        # WebSocket 协议升级——这是核心配置
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # 传递客户端真实信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 关键：读写超时必须大于 Reverb 的心跳间隔（30 秒）
        # 建议设置为心跳间隔的 10 倍，即 300 秒
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # 禁用代理缓冲，确保消息即时推送给客户端
        # 如果开启缓冲，WebSocket 消息会被暂存，破坏实时性
        proxy_buffering off;
    }
}
```

### 7.2 水平扩展：Redis Pub/Sub 跨进程广播

当单台 Reverb 服务器无法承载所有连接时（通常在 5000-10000 并发连接以上需要考虑），我们需要水平扩展。核心挑战在于：**如何让多个 Reverb 进程共享频道状态和广播消息？**

解决方案是引入 Redis 作为 Pub/Sub 中间层。架构如下：

```
                   ┌─────────────┐
                   │  Nginx LB   │
                   └──────┬──────┘
            ┌─────────────┼─────────────┐
            ↓             ↓             ↓
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ Reverb-1 │  │ Reverb-2 │  │ Reverb-3 │
     │ 3000 conn│  │ 3000 conn│  │ 3000 conn│
     └────┬─────┘  └────┬─────┘  └────┬─────┘
          │             │             │
          └─────────────┼─────────────┘
                        ↓
                 ┌──────────────┐
                 │  Redis Pub/Sub│
                 └──────────────┘
                        ↑
                 ┌──────────────┐
                 │ Laravel App  │
                 │ (broadcast())│
                 └──────────────┘
```

当 Laravel 应用调用 `broadcast(new OrderStatusUpdated($order))` 时，广播消息通过 Redis Pub/Sub 发布到一个共享的 Redis 频道。所有 Reverb 进程都订阅了这个 Redis 频道，因此每个 Reverb 实例都能收到广播消息，然后推送给各自管理的客户端连接。

使用 Supervisor 管理多个 Reverb 实例：

```ini
; /etc/supervisor/conf.d/reverb.conf

[program:reverb]
command=php /var/www/your-app/artisan reverb:start --port=8080
process_name=%(program_name)s_%(process_num)02d
numprocs=3
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/reverb/%(program_name)s_%(process_num)02d.log
```

### 7.3 连接数监控

实时监控 Reverb 的连接数对于容量规划至关重要。推荐使用 Prometheus + Grafana 搭建完善的监控体系：

```bash
# 查看当前 Reverb 运行状态
php artisan reverb:status

# 输出示例：
# Reverb is running
# Connections: 1,247
# Channels: 89
# Uptime: 3d 14h 22m
```

建议监控以下关键指标：

- **当前活跃连接数**：反映服务器负载
- **每秒新建连接数**：检测连接风暴
- **每秒断开连接数**：异常飙升可能意味着服务端问题
- **频道数量**：过多的频道可能需要合并优化
- **内存使用量**：持续增长可能暗示内存泄漏
- **授权请求响应时间**：超过 200ms 需要优化

---

## 八、性能压测与踩坑记录

### 8.1 连接风暴

**现象**：秒杀活动开始瞬间，数千用户同时建立 WebSocket 连接，Reverb 进程 CPU 飙升至 100%，部分连接超时失败，用户页面显示"连接失败"。

**根因分析**：TLS 握手是 CPU 密集型操作，数千并发 TLS 握手可以在瞬间耗尽单核 CPU。同时，每个新连接的 Private/Presence Channel 订阅都会触发对 Laravel 应用授权端点的 HTTP 请求，如果授权端点没有做好缓存，数据库也面临瞬间的查询压力。

**解决方案**：

1. **启用多 Worker 模式**：
```bash
php artisan reverb:start --workers=4
```

2. **授权端点增加 Redis 缓存**：
```php
Broadcast::channel('product.{productId}', function (User $user, int $productId) {
    $cacheKey = "channel_auth:product:{$productId}:{$user->id}";
    return Cache::remember($cacheKey, 30, function () use ($user) {
        return [
            'id' => $user->id,
            'name' => $user->nickname ?? $user->name,
            'avatar' => $user->avatar_url,
        ];
    });
});
```

3. **Nginx 层面限制单 IP 连接数**：
```nginx
limit_conn_zone $binary_remote_addr zone=ws_conn:10m;

server {
    location / {
        limit_conn ws_conn 5;  # 每个 IP 最多 5 个 WebSocket 连接
    }
}
```

### 8.2 内存泄漏排查

**现象**：Reverb 进程运行 2-3 天后，内存从初始 120MB 增长到 800MB+，最终被 OOM Killer 杀掉，所有在线用户瞬间断线。

**排查过程**：

```bash
# 定期记录内存使用趋势
watch -n 60 'ps aux | grep reverb | grep -v grep'

# 使用 Xdebug 的内存分析功能定位分配热点
php -d xdebug.mode=profile artisan reverb:start
```

经过分析，最终定位到问题根因：**Presence Channel 的成员数据在客户端异常断开时未被正确清理**。当用户直接关闭浏览器标签页或网络突然中断时，WebSocket 连接并不会触发正常的 `onClose` 回调，而是要等到心跳超时后才会被检测到。在这段时间内，该用户仍然存在于 Presence Channel 的成员列表中，占用内存。

**解决方案**：

```php
// config/reverb.php
'options' => [
    'activity_timeout' => 20,    // 缩短心跳检测间隔
    'pong_timeout'     => 40,    // 缩短 pong 响应超时
],
```

增加定时任务主动清理僵尸成员：

```php
// app/Console/Commands/CleanupStaleConnections.php
class CleanupStaleConnections extends Command
{
    protected $signature = 'reverb:cleanup';
    protected $description = 'Clean up stale Presence Channel members';

    public function handle(): void
    {
        $staleThreshold = now()->subMinutes(5);
        $cleaned = 0;

        foreach (Redis::smembers('reverb:presence_channels') as $channel) {
            $members = Redis::hgetall("reverb:presence:{$channel}");
            foreach ($members as $memberId => $data) {
                $memberData = json_decode($data, true);
                if (Carbon::parse($memberData['last_activity'])->lt($staleThreshold)) {
                    Redis::hdel("reverb:presence:{$channel}", $memberId);
                    $cleaned++;
                }
            }
        }

        $this->info("Cleaned up {$cleaned} stale presence members.");
    }
}
```

### 8.3 断线重连策略

Laravel Echo 底层的 Pusher.js 客户端内置了断线重连机制，采用指数退避策略。默认配置下，首次断线后等待 1 秒重连，第二次 2 秒，第三次 4 秒……最大等待时间可达数分钟。对于电商场景，过长的重连等待是不可接受的——用户可能正在查看订单状态或客服正在回复消息。

推荐自定义重连策略，并在前端做好状态提示：

```javascript
// resources/js/echo.js

const echo = new Echo({
  // ...其他配置
  unavailableTimeout: 10000,  // 首次重连等待 10 秒
});

// 监听连接状态变化，在 UI 上实时反馈
echo.connector.pusher.connection.bind('state_change', (states) => {
  const { current, previous } = states;
  console.log(`[Echo] Connection: ${previous} → ${current}`);

  if (current === 'disconnected') {
    showToast('网络连接已断开，正在自动重连...', 'warning');
    updateOnlineStatusIndicator('offline');
  }

  if (current === 'connecting') {
    showToast('正在重新连接...', 'info');
    updateOnlineStatusIndicator('reconnecting');
  }

  if (current === 'connected' && previous !== 'initialized') {
    showToast('连接已恢复', 'success');
    updateOnlineStatusIndicator('online');
  }
});
```

> **重要提示**：Reverb 断线重连后，客户端会自动重新订阅之前的所有频道，Presence Channel 也会自动重新加入。但 `here()` 回调会再次触发，返回新的完整成员列表。前端代码需要将 `here()` 回调设计为"替换"而非"追加"语义，避免成员列表出现重复。

---

## 九、与 Pusher / Ably / Soketi 的选型对比

在选择实时通信方案时，除了 Laravel Reverb，市面上还有几个主流选择。每种方案都有各自的适用场景和权衡，没有绝对的"最好"，只有"最合适"。

### 9.1 功能与特性对比

| 特性 | Reverb | Pusher | Ably | Soketi |
|------|--------|--------|------|--------|
| **部署模式** | 自托管 | SaaS | SaaS | 自托管 |
| **协议** | Pusher 兼容 | Pusher 原生 | Ably 协议 | Pusher 兼容 |
| **Laravel 集成** | 一等公民 | 官方支持 | 官方支持 | 社区支持 |
| **成本** | 仅服务器成本 | 按连接数计费 | 按消息数计费 | 仅服务器成本 |
| **免费额度** | 无限 | 200 月活 | 6M 消息/月 | 无限 |
| **水平扩展** | Redis Pub/Sub | 自动 | 自动 | Redis/PostgreSQL |
| **消息持久化** | ❌ | ✅ (History API) | ✅ (History API) | ❌ |
| **消息送达保证** | At-most-once | At-least-once | Exactly-once | At-most-once |
| **SSL/TLS** | 需自行配置 | 内置 | 内置 | 需自行配置 |
| **管理控制台** | CLI 工具 | Web 控制台 | Web 控制台 | 有限 CLI |
| **全球节点分发** | ❌ 单区域 | ✅ 多区域 | ✅ 多区域 | ❌ 单区域 |
| **社区活跃度** | 中（Laravel 生态） | 高 | 高 | 中 |

### 9.2 选型建议

**选择 Reverb 的场景**：

- 项目基于 Laravel 技术栈，追求最佳的框架集成体验和官方支持。
- 不想产生 SaaS 月费，希望控制长期运营成本。
- 对数据安全和隐私合规有严格要求，不希望消息流经第三方服务器。
- 团队具备基本的 DevOps 能力，可以处理服务器运维和监控。
- 并发连接数在单机 10K 以内，或多机 50K 以内。

**选择 Pusher 的场景**：

- 团队没有专职运维人员，不想管理 WebSocket 服务器。
- 需要消息历史回放功能（如断线重连后补发消息）。
- 需要跨区域（多数据中心）的全球低延迟分发。
- 预算充足，月活用户数在可接受范围内。
- 需要成熟的管理控制台和实时监控面板。

**选择 Soketi 的场景**：

- 需要 Pusher 兼容但希望自托管且不想使用 PHP 作为 WebSocket 运行时。
- 从 Reverb 发布前的历史项目迁移。
- 团队对 Node.js 生态更熟悉。
- 需要比 Reverb 更成熟的水平扩展方案。

**选择 Ably 的场景**：

- 对消息送达保证有严格要求（Exactly-once 语义）。
- 需要严格的消息排序保证。
- 对 SLA 有极高要求（99.999%）。
- 需要消息持久化和离线消息推送。

对于大多数中小规模 B2C 电商项目，**Reverb 是当前性价比最高的选择**——它与 Laravel 深度集成，零 SaaS 费用，且官方维护保障大大降低了长期技术债务风险。当业务增长到需要全球分发和 Exactly-once 保证时，再迁移到 Pusher 或 Ably 也只需修改配置文件，业务代码无需任何改动——这正是 Laravel Broadcasting 抽象层的魅力所在。

---

## 十、总结与最佳实践

### 10.1 核心要点回顾

1. **Laravel Broadcasting 是一个优雅的抽象层**，它将事件广播的"触发"与"传输"解耦。开发者只需关注 Event 定义和 Channel 授权，底层的 Pusher/Reverb/Soketi 可以通过一行配置无缝切换。这种抽象极大地降低了实时通信功能的开发门槛和维护成本。

2. **Reverb 的出现填补了 Laravel 生态自托管 WebSocket 的空白**。它基于 Pusher 协议兼容设计，既享受了成熟客户端库的广泛支持，又实现了完全的数据自主可控。对于有数据合规要求的企业，这是一个重大的利好。

3. **Private Channel 保障了数据安全**——只有通过授权的用户才能订阅对应的频道。在 B2C 场景中，订单状态推送、个人消息通知、账户余额变动提醒等都应使用 Private Channel。

4. **Presence Channel 提供了"谁在线"的感知能力**——客服在线状态、商品页面访客列表、直播间观众人数、协作编辑器中的在线协作者等功能都依赖于此。它本质上是一个分布式的在线成员列表，由 WebSocket 服务器自动维护。

### 10.2 生产环境最佳实践

**架构层面**：

- 使用 Nginx 反代 WebSocket，配合 SSL/TLS 加密传输，保护用户数据安全。
- 通过 Redis Pub/Sub 实现 Reverb 多进程/多机器的水平扩展。
- 授权端点（`/broadcasting/auth`）需要做好限流和缓存防护，防止被恶意刷请求。

**安全层面**：

- 所有涉及用户私有数据的频道必须使用 Private Channel 或 Presence Channel，切勿用 Public Channel 推送敏感信息。
- 在 `routes/channels.php` 中严格校验授权逻辑，不要为了省事直接返回 `true`。
- 广播事件的 `broadcastWith()` 只返回必要的字段，避免泄露内部数据（如成本价、供应商信息、用户手机号等）。

**性能层面**：

- Presence Channel 的 `joinWith()` 数据尽量精简，减少广播消息体积和内存占用。
- 高频更新场景考虑合并消息（debounce），避免客户端消息风暴。例如库存变更可以合并为每 5 秒推送一次，而非每笔订单都推送。
- 合理设置心跳参数，平衡实时性和资源消耗。推荐 30 秒心跳间隔。

**运维层面**：

- 使用 Supervisor 管理 Reverb 进程，配置自动重启和日志轮转。
- 接入 Prometheus + Grafana 监控连接数、内存、CPU 使用率和授权请求延迟。
- 制定容量规划，提前预估大促期间的并发连接数并做好压力测试。

**开发层面**：

- 本地开发时使用 `php artisan reverb:start --debug` 查看详细的连接和授权日志。
- 测试环境可以用 Laravel 的 `Broadcast::fake()` 做单元测试，验证事件是否正确触发。
- 前端组件封装时做好断线重连的 UI 状态处理，让用户在任何时候都能感知连接状态。
- Presence Channel 的 `here()` 回调设计为"替换"语义，`joining()` 和 `leaving()` 设计为"增量更新"语义，避免数据不一致。

### 10.3 一个简洁的技术决策流程图

```
你的项目使用 Laravel 吗？
  ├─ 否 → 考虑 Pusher SaaS 或其他独立方案
  └─ 是 → 你的团队有基本运维能力吗？
              ├─ 否 → 使用 Pusher SaaS（零运维，按量付费）
              └─ 是 → 并发连接数超过 50K？
                        ├─ 是 → 考虑 Pusher/Ably 或 Reverb 多机集群
                        └─ 否 → ✅ 选择 Reverb（最佳性价比）
```

实时通信技术正在从"锦上添花"变为"基础设施"。在 B2C 电商领域，从订单状态推送到客服在线状态，从库存预警到促销广播，实时能力已经深深嵌入了用户体验的每一个环节。Laravel Broadcasting 配合 Reverb，为 PHP 开发者提供了一条低门槛、高可靠的实时化路径。

希望本文的深度实战内容能帮助你在下一个 Laravel 项目中，自信地构建生产级的实时通知与在线状态架构。技术选型没有银弹，但理解了底层原理和权衡取舍，你就能做出最适合当前团队和业务的决策。

---

## 相关阅读

- [PartyKit 实战：实时协作后端——多人编辑、在线状态、实时光标与 Laravel 应用集成](/categories/架构/PartyKit-实战-实时协作后端-多人编辑在线状态实时光标与Laravel应用集成/)
- [Web Push API VAPID 实战：浏览器原生推送通知——Laravel 后端、Service Worker 注册、订阅管理与消息分发](/categories/前端/Web-Push-API-VAPID-实战-浏览器原生推送通知-Laravel后端Service-Worker注册订阅管理与消息分发/)
- [Laravel Inertia 实战：Vue3 / React 单页应用全新全栈范式——对比传统 SPA 前后端分离](/categories/PHP/Laravel/Laravel-Inertia-实战-Vue3-React-单页应用全新全栈范式-对比传统SPA前后端分离/)

---

> **参考资源**：
> - [Laravel 官方文档 - Broadcasting](https://laravel.com/docs/broadcasting)
> - [Laravel Reverb 官方文档](https://laravel.com/docs/reverb)
> - [Pusher 协议规范](https://pusher.com/docs/channels/library_reference/pusher-js/)
> - [Laravel Echo 文档](https://laravel.com/docs/broadcasting#client-side-installation)
