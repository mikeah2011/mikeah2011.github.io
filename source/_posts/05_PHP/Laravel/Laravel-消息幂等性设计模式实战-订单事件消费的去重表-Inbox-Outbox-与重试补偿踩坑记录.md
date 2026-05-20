---
title: Laravel 消息幂等性设计模式实战：订单事件消费的去重表、Inbox/Outbox 与重试补偿踩坑记录
date: 2026-05-03 09:45:00
categories:
  - PHP
  - Laravel
tags: [Laravel, MySQL, 消息队列]
description: 结合订单支付完成后的库存扣减、积分发放与通知投递场景，记录一套在 Laravel 中真正可落地的消息幂等性设计方案，覆盖 Outbox、消费者去重表、状态机保护、失败补偿与真实踩坑记录。
---

在 Laravel 订单系统里，我最不信的一句话就是“这条消息只会消费一次”。Kafka rebalance、消费者重启、手动重放，都会把 `OrderPaid` 再送一遍。真正可靠的方案不是追求 MQ 恰好一次，而是让**重复消息只生效一次**。

我最后固定下来的做法只有三层：**Outbox 保证可靠投递，Inbox/去重表保证消费者不重复执行业务，状态机保证误重放也推不动状态。**

## 一、最终架构

```text
支付回调
   |
   v
orders + payments + outbox_messages  (同事务)
   |
   v
Outbox Relay
   |
   v
Kafka: order.paid
   |
   +-------------+-------------+
   |             |             |
   v             v             v
库存消费者     积分消费者     通知消费者
   |             |             |
   v             v             v
processed_messages / inbox_records
   |
   v
业务表更新 + 状态流转 + 补偿记录
```

## 二、发送侧先写 Outbox

最危险的写法是订单改成已支付后直接发 MQ。数据库成功、MQ 失败时，下游永远不知道这次支付。

```php
<?php

DB::transaction(function () use ($order, $payment) {
    $order->update([
        'status' => 'paid',
        'paid_at' => $payment->paid_at,
    ]);

    DB::table('outbox_messages')->insert([
        'event_id' => (string) Str::uuid(),
        'topic' => 'order.paid',
        'aggregate_id' => (string) $order->id,
        'payload' => json_encode([
            'order_id' => $order->id,
            'user_id' => $order->user_id,
            'amount' => $order->paid_amount,
        ], JSON_UNESCAPED_UNICODE),
        'status' => 'pending',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
});
```

然后由 Relay Job 扫描 `pending` 并投递。即使进程挂掉，消息还在库里，可补发、可审计、可追 `event_id`。

## 三、消费侧用唯一键抢幂等

“先查有没有处理过”在并发下不稳，两个 worker 可能同时查到空结果。要直接抢唯一键：

```php
Schema::create('processed_messages', function (Blueprint $table) {
    $table->id();
    $table->string('consumer', 64);
    $table->string('message_id', 64);
    $table->timestamp('processed_at');
    $table->unique(['consumer', 'message_id']);
});
```

处理消息时，把去重写入和业务更新放进同一事务：

```php
<?php

DB::transaction(function () use ($message) {
    $inserted = DB::table('processed_messages')->insertOrIgnore([
        'consumer' => 'reward-order-paid',
        'message_id' => $message['event_id'],
        'processed_at' => now(),
    ]);

    if ($inserted === 0) {
        return;
    }

    DB::table('reward_accounts')
        ->where('user_id', $message['user_id'])
        ->increment('points', (int) floor($message['amount'] / 10));
});
```

这张表本质上就是消费者的 Inbox。严格一点时，我会额外保留原始 payload 和处理结果，方便排障。

## 四、状态机做最后一道保险

就算去重表失效，核心状态也不能被重复推进：

```php
$affected = DB::table('orders')
    ->where('id', $message['order_id'])
    ->where('fulfillment_status', 'pending')
    ->update([
        'fulfillment_status' => 'reserved',
        'updated_at' => now(),
    ]);

if ($affected === 0) {
    return;
}
```

这类 `pending -> reserved` 的条件更新，能挡住脚本误重放和人工补投。

## 五、重放也要可控

我不会让运维直接改库补消息，而是保留按 `event_id` 重放的入口：

```php
<?php

$message = DB::table('outbox_messages')->where('event_id', $eventId)->first();

Kafka::publish(
    topic: $message->topic,
    key: $message->aggregate_id,
    body: $message->payload,
    headers: ['event_id' => $message->event_id, 'replay' => '1'],
);
```

真正成熟的系统，不是“不会出错”，而是**出错后还能安全重放**。

## 六、我踩过的坑

### 1. 只用 Redis `SETNX`

它适合短期防抖，不适合最终幂等。TTL 过期、主从切换、键淘汰后，旧消息还是可能重新生效。

### 2. 用 `order_id` 当去重键

同一订单会触发积分、通知、返佣等多个消费者，只用 `order_id` 会互相误伤。后来统一改成 `consumer + event_id`。

### 3. 去重表和业务表不在同一事务

先写去重表、后执行业务，一旦业务失败，这条消息就被“永久吞掉”。这是线上最隐蔽也最伤的一类问题。

## 七、结论

这套方案落地后，我们做过 broker rebalance 和消费者滚动发布演练，重复投递明显增加，但库存、积分、通知都没有再出现双写。我的经验很直接：**Outbox 解决可靠投递，Inbox 解决重复消费，状态机解决误重放。三层一起上，Laravel 的消息系统才算真正能扛生产。**