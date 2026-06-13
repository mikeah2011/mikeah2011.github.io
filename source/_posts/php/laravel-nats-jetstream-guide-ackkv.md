---
title: Laravel + NATS JetStream 实战：订单通知削峰、Ack 重投与 KV 配置同步踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 16:01:38
updated: 2026-05-04 16:05:52
categories:
  - php
tags: [Laravel, 微服务, 消息队列, NATS, JetStream, 消息中间件]
keywords: [Laravel, NATS JetStream, Ack, KV, 订单通知削峰, 重投与, 配置同步踩坑记录, PHP]
description: 基于 Laravel 订单通知链路的真实改造，详解 NATS JetStream 的削峰填谷、Ack/Nack 消息确认、幂等防重、KV 配置同步及与 RabbitMQ/Redis Streams 的选型对比，附完整可运行代码与踩坑记录。



---

很多 Laravel 团队做异步解耦时，第一反应是 Redis、RabbitMQ 或 Kafka。但我在一个订单通知链路里遇到的真实问题是：**量没有大到必须上 Kafka，可靠性又比 Redis List 要高，接口还希望顺手做 request-reply 和轻量配置同步**。这类场景里，NATS + JetStream 反而很合适。

我们改造的是「下单成功后通知中心」：订单写库成功后，需要异步触发站内信、邮件、Push 和风控埋点。旧方案用数据库 job 表 + queue worker，峰值一来就暴露三个问题：

1. worker 抢锁和轮询把数据库打热；
2. 某个通知通道失败会拖住整批任务；
3. 重试后偶发重复发送，用户会收到两封邮件。

换成 NATS JetStream 后，订单创建接口本身没有快很多，但**峰值时数据库压力明显下降，通知链路的 P95 从 1.8s 降到 320ms 左右，失败重投也终于从“人工补单”变成了可观测、可恢复的机制**。

## 一、最终落地架构

```text
            +----------------------+
            | Laravel Order API    |
            | DB commit + publish  |
            +----------+-----------+
                       |
                       v
              subject: order.created
                       |
             +---------v----------+
             | NATS JetStream     |
             | stream: ORDER_EVT  |
             +----+----------+----+
                  |          |
      durable consumer   durable consumer
        notify-mail         notify-push
                  |          |
                  v          v
         Laravel Console   Laravel Console
          worker / ack      worker / ack
                  \          /
                   \        /
                    v      v
                 Redis / MySQL
         幂等记录、模板缓存、发送结果落库

    KV bucket: app_config
          ^
          |
   后台配置中心 -> NATS KV -> Laravel 本地缓存刷新
```

这里我只用三类能力：

- **Core Pub/Sub**：轻量事件发布；
- **JetStream**：持久化、Ack、重投、Work Queue；
- **KV**：低频配置同步，而不是拿来替 Redis。

## 二、为什么这里不用 RabbitMQ/Kafka

这次选择 NATS，不是因为它更潮，而是因为链路特点刚好匹配：

- 单条消息很小，主要是订单 ID、用户 ID、渠道类型；
- 消费者数量不多，但要稳定 Ack；
- 有少量 request-reply 场景；
- 希望运维面尽量轻，不额外引入过重的 broker 集群。

如果你的场景是超长堆积、强顺序分区、大规模回放分析，那还是 Kafka 更顺手；如果你需要复杂路由和成熟插件生态，RabbitMQ 依然稳。**NATS JetStream 更适合"中等吞吐 + 低延迟"这条线。**

下面这张对比表能帮助你快速判断：

| 维度 | NATS JetStream | RabbitMQ | Redis Streams |
|------|---------------|----------|---------------|
| 消息持久化 | ✅ 支持（文件/内存） | ✅ 支持 | ⚠️ 依赖 AOF/RDB |
| 消息确认机制 | ✅ Ack/Nack/In Progress | ✅ Ack/Nack | ✅ XACK |
| 消费者组 | ✅ Durable Consumer | ✅ Queue + Consumer | ✅ Consumer Group |
| 延迟消息 | ❌ 需自建 | ⚠️ 插件支持 | ❌ 需自建 |
| Request-Reply | ✅ 原生支持 | ❌ 需额外实现 | ❌ 需额外实现 |
| 内置 KV 存储 | ✅ 原生 | ❌ | ⚠️ 可变通但非设计目标 |
| 运维复杂度 | 低（单二进制） | 中（Erlang + 管理插件） | 低（但持久化需注意） |
| 适用吞吐量 | 中等（万级 TPS） | 中等 | 中高 |
| 协议生态 | NATS 协议 | AMQP | RESP |
| 语言客户端 | Go/Rust/PHP/Java 等 | Erlang/多语言 | 多语言 |

> **选型建议**：如果你的需求是"可靠投递 + 低运维 + request-reply + 轻量 KV"，优先 NATS JetStream；需要复杂路由和死信队列，选 RabbitMQ；已有 Redis 基础设施且对丢失容忍度稍高，Redis Streams 最快上手。

## 三、Laravel 里的连接封装

我用的是 `basis-company/nats`，先把连接收口到一个服务里，避免业务代码直接散落 `new Client()`。

```php
<?php

namespace App\Infrastructure\Messaging;

use Basis\Nats\Client;
use Basis\Nats\Configuration;

final class NatsFactory
{
    public static function make(): Client
    {
        $configuration = new Configuration(
            host: config('services.nats.host'),
            port: (int) config('services.nats.port', 4222),
            user: config('services.nats.user'),
            pass: config('services.nats.pass'),
        );

        $configuration->setDelay(0.01, Configuration::DELAY_EXPONENTIAL);

        return new Client($configuration);
    }
}
```

`config/services.php` 里我会显式配出来，避免队列、广播、缓存都从 `.env` 各读各的：

```php
'nats' => [
    'host' => env('NATS_HOST', '127.0.0.1'),
    'port' => env('NATS_PORT', 4222),
    'user' => env('NATS_USER'),
    'pass' => env('NATS_PASS'),
],
```

## 四、订单事件发布：先解决重复发送

真正上线后，最先踩坑的不是消费，而是**生产端重试导致重复投递**。HTTP 超时、进程重启、发布前后日志不完整，都会让你怀疑“这条到底发出去没有”。

我后来固定使用 `Nats-Msg-Id` 做幂等发布键：

```php
<?php

namespace App\Domain\Order\Listeners;

use App\Infrastructure\Messaging\NatsFactory;
use Basis\Nats\Message\Payload;

final class PublishOrderCreated
{
    public function handle(int $orderId, int $userId): void
    {
        $client = NatsFactory::make();
        $stream = $client->getApi()->getStream('ORDER_EVT');

        $payload = new Payload(json_encode([
            'order_id' => $orderId,
            'user_id' => $userId,
            'event' => 'order.created',
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), [
            'Nats-Msg-Id' => 'order-created-' . $orderId,
        ]);

        $stream->put('order.created', $payload);
    }
}
```

这个头不是银弹，但它解决了最烦的一类问题：**同一个订单事件因为上游重试被重复写入 stream**。后面消费端再加业务幂等表，重复发送邮件的问题就基本压住了。

## 五、JetStream 初始化不要偷懒

很多人第一次接 JetStream，会让消费者自动创建。我一开始也这么干，结果线上不同节点拉起时配置不一致，出现过 `subject filter` 不同、Ack 策略不同的问题。后来改成启动脚本统一建 stream。

```php
<?php

use App\Infrastructure\Messaging\NatsFactory;
use Basis\Nats\Stream\RetentionPolicy;
use Basis\Nats\Stream\StorageBackend;

$client = NatsFactory::make();
$stream = $client->getApi()->getStream('ORDER_EVT');

$stream->getConfiguration()
    ->setRetentionPolicy(RetentionPolicy::WORK_QUEUE)
    ->setStorageBackend(StorageBackend::MEMORY)
    ->setSubjects(['order.created', 'order.cancelled']);

$stream->create();
```

这里有个取舍：我们通知链路追求低延迟，消息保留时间也不长，所以先用 `WORK_QUEUE`。但**如果你的消息必须跨团队回放审计，就别图省事上 MEMORY，直接用文件存储**。我第一次把它放进测试环境时完全没问题，结果某次节点重建后消息全没了，才意识到持久化策略根本不是“默认安全”。

## 六、消费者：Ack、Nack 和业务幂等要同时做

消费端我没有直接写成长循环裸脚本，而是放进 Laravel Console Command，方便挂到 Supervisor 或 K8s Deployment。

```php
<?php

namespace App\Console\Commands;

use App\Infrastructure\Messaging\NatsFactory;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class ConsumeOrderMail extends Command
{
    protected $signature = 'nats:consume-order-mail';

    public function handle(): int
    {
        $client = NatsFactory::make();
        $stream = $client->getApi()->getStream('ORDER_EVT');
        $consumer = $stream->getConsumer('notify-mail');
        $consumer->getConfiguration()->setSubjectFilter('order.created');

        $queue = $consumer->setBatching(20)->create()->getQueue();

        while ($message = $queue->next()) {
            $data = json_decode((string) $message->payload, true, 512, JSON_THROW_ON_ERROR);
            $orderId = (int) $data['order_id'];

            $inserted = DB::table('message_dedup')->insertOrIgnore([
                'dedup_key' => 'mail:order:' . $orderId,
                'created_at' => now(),
            ]);

            if ($inserted === 0) {
                $message->ack();
                continue;
            }

            try {
                app()->make(\App\Application\Notifier\SendOrderMail::class)
                    ->handle($orderId);

                $message->ack();
            } catch (\Throwable $e) {
                report($e);
                $message->nack(3);
            }
        }

        return self::SUCCESS;
    }
}
```

这里要注意两件事：

1. **Ack 只代表 broker 层确认，不代表业务一定幂等**；
2. **Nack 重投前要先保证副作用可重复执行或可去重**。

我第一版代码是“先发邮件，再写去重表”，结果 worker 在发完邮件、来不及写库时崩了，JetStream 重投后用户就收到第二封。顺序改成**先拿业务幂等资格，再执行外部副作用**，问题才算真解决。

## 七、KV 不是 Redis 替代品，但很适合低频配置同步

我们还有一个实际需求：通知模板开关、降级开关、渠道熔断阈值，不希望每次都打数据库。这里我没有直接再堆一个配置中心 SDK，而是用 NATS KV 做低频同步。

```php
<?php

use App\Infrastructure\Messaging\NatsFactory;
use Illuminate\Support\Facades\Cache;

$client = NatsFactory::make();
$bucket = $client->getApi()->getBucket('app_config');

$entry = $bucket->getEntry('notify.mail.enabled');
Cache::put('notify.mail.enabled', $entry->value, 300);

$bucket->update('notify.mail.enabled', 'false', $entry->revision);
```

这段最有用的点，不是“能存配置”，而是 **revision update**。后台改配置时带上 revision，能避免两个管理员同时改值造成互相覆盖。它不适合高频热点缓存，但做**小规模控制面数据**非常顺手。

## 八、几个真实踩坑记录

### 1. 把 JetStream 当 Redis 队列来用

最早我们想当然地把所有临时事件都塞进去，包括一些根本不需要持久化的埋点。结果 stream 膨胀很快，消费者延迟也开始抖。后来重新拆分：**需要可靠消费的走 JetStream，不重要的瞬时广播走普通 Pub/Sub**。

### 2. 一个 consumer 想吃多个业务语义

我曾经偷懒用一个 durable consumer 同时处理邮件和 Push，只靠 payload 里的 `channel` 字段分流。这样做表面上省配置，实际会让失败重投互相污染：Push 挂了，邮件也跟着堵。后面改成按 subject/consumer 拆开，排障简单很多。

### 3. 误以为 Ack 后就“绝对不会重复”

实际上网络抖动、进程中断、业务自身重复提交，都可能让你看到重复效果。**消息系统提供的是至少一次，不是神奇的一次。**所以 Laravel 侧的去重表、唯一键、外部调用幂等键，一个都不能少。

### 4. 用 KV 存高频热点数据

我们试过把模板内容全文放进 KV，然后每次消费实时读取，结果高峰期连接数和请求数都不太漂亮。后来改成：**KV 只负责变更源，本地 Cache 负责读取热点**，这才是更稳的用法。

## 九、我对这套方案的结论

如果你是 Laravel 团队，正好处在 Redis 队列太脆、Kafka 又有点重的阶段，NATS JetStream 很值得试，尤其适合：

- 订单通知、风控打点、轻量异步任务；
- 需要 Ack / 重投 / 幂等，但吞吐没大到日志平台级别；
- 希望顺手拿到 request-reply、KV 这类配套能力。

但它也不是万能中间件。**真正决定线上稳定性的，不是换了哪个 MQ，而是你有没有把发布幂等、消费幂等、Ack 时机、失败隔离和配置同步边界设计清楚。**这几个点没做好，用什么 broker 都一样会翻车。

### Ack 策略对比速查

| 策略 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| `ack()` 立即确认 | 处理成功后 | 简单、不阻塞 | 处理中崩溃会丢消息 |
| `nack(delay)` 负确认 + 延迟重投 | 可恢复的临时失败 | 自动重试、可设退避 | 需幂等保护，否则重复副作用 |
| `inProgress()` 续期 | 长耗时任务 | 防止超时被重投 | 需定期调用，实现复杂 |
| 不确认（超时自动重投） | 消费者崩溃兜底 | 最后一道防线 | 延迟不可控，可能堆积 |

### 线上真实踩坑补充：Supervisor 并发与连接泄漏

把 consumer 脚本交给 Supervisor 管理时，遇到过一个隐蔽问题：**多个 worker 进程复用同一个 NATS 连接对象，当某个 worker 被 Supervisor 重启时，底层 socket 被 close，其他 worker 全部报错退出**。解法是每个 worker 进程独立创建连接：

```bash
# /etc/supervisor/conf.d/nats-order-mail.conf
[program:nats-order-mail]
command=php /var/www/artisan nats:consume-order-mail
numprocs=3
process_name=%(program_name)s_%(process_num)02d
autorestart=true
startsecs=5
stopwaitsecs=10
```

关键配置：`numprocs=3` 表示启动 3 个独立进程，每个进程内部自己 `NatsFactory::make()` 创建独立连接，不要在进程间共享 `Client` 实例。

### 生产环境 Checklist

上线前请逐项确认：

- [ ] Stream 和 Consumer 在部署脚本中统一创建，不依赖客户端自动建
- [ ] 生产端每条消息都有唯一 `Nats-Msg-Id`
- [ ] 消费端业务幂等表已建好，有唯一索引
- [ ] `WORK_QUEUE` 策略下消息不会被多个 consumer 同时消费
- [ ] Supervisor 或 K8s 正确配置了进程重启策略
- [ ] 监控了 NATS 的 `ack_pending` 和 `num_pending` 指标
- [ ] KV bucket 设置了合理的 TTL，避免历史数据堆积

## 相关阅读

- [Laravel 队列完全指南：从基础到生产环境]({% post_path laravel-queue-guide %})
- [Laravel 失败任务处理与重试策略]({% post_path laravel-failed-job-handling %})
- [Laravel Redis 队列 + Horizon 监控实战]({% post_path laravel-redis-queue-horizon-guide-monitoring %})
