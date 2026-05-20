---
title: ShardingSphere-Proxy 分库分表实战：Laravel 订单中心按用户路由、全局 ID 与跨片查询降级踩坑记录
date: 2026-05-03 09:40:55
updated: 2026-05-03 09:40:55
categories:
  - 01_MySQL
  - Laravel
  - ShardingSphere
tags:
  - Laravel
  - MySQL
  - ShardingSphere-Proxy
  - 分库分表
  - Snowflake
  - 订单系统
description: 结合 Laravel 订单中心的真实治理过程，记录一套基于 ShardingSphere-Proxy 的分库分表方案，重点覆盖按用户路由、全局 ID、跨片查询降级与线上踩坑处理。
---

订单表在 3000 万行之前，靠索引、冷热字段拆分和归档还能勉强顶住；一旦运营后台开始按状态、渠道、出行日期、退款状态混查，再叠加支付回调、履约任务和财务导出，单表的写放大、索引膨胀和分页扫描会一起爆出来。我们在一个 Laravel 订单中心里把 `orders` 从单库单表迁到 **ShardingSphere-Proxy + MySQL 分片**，目标并不是“为了炫技上分库分表”，而是把最热的订单写入、用户维度查询和后台导出拆开治理。

## 一、最后落地的架构

```text
                +---------------- Admin / API / Job ----------------+
                |                Laravel Application                |
                +---------------------------+-----------------------+
                                            |
                                     PDO / MySQL Driver
                                            |
                              +-------------v--------------+
                              |     ShardingSphere-Proxy   |
                              | SQL 解析 / 路由 / 改写 / 合并 |
                              +------+------+--------------+
                                     |      |
                    +----------------+      +----------------+
                    v                                        v
              order_ds_0                                 order_ds_1
           orders_0 ~ orders_3                       orders_0 ~ orders_3
```

分片策略很克制：**按 `user_id` 分库分表，`order_id` 只做全局主键，不做路由键**。原因很现实，前台“我的订单”、大部分支付补偿、退款回查都天然带用户维度；一旦把分片键选成订单号，后台查用户订单、风控查账户行为都会变成散射查询。

我们不只切了 `orders` 一张表，`order_items`、`order_payments` 也统一按 `user_id` 分片。这个决定很关键，因为真正的热点往往不是订单主表本身，而是“订单 + 明细 + 支付记录”的联动写入。如果主单在 A 片、支付记录在 B 片，应用层马上就会出现伪分布式事务和跨片补偿，复杂度比单库还高。

## 二、ShardingSphere-Proxy 规则不要写得太“聪明”

我们上线时的核心配置如下，是真能跑的：

```yaml
rules:
  - !SHARDING
    tables:
      orders:
        actualDataNodes: order_ds_${0..1}.orders_${0..3}
        tableStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: orders_inline
        databaseStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: db_inline
        keyGenerateStrategy:
          column: order_id
          keyGeneratorName: snowflake
    shardingAlgorithms:
      db_inline:
        type: INLINE
        props:
          algorithm-expression: order_ds_${user_id % 2}
      orders_inline:
        type: INLINE
        props:
          algorithm-expression: orders_${user_id % 4}
    keyGenerators:
      snowflake:
        type: SNOWFLAKE
```

这里有个很容易踩的坑：别在表达式里混入业务状态，比如“已支付进热表、已取消进冷表”。这会让更新 SQL 带上分片键变更风险，后续迁移和修复都很痛。**分片规则越稳定越好，冷热分层请在归档链路做。**

另一个常被忽略的点是子表冗余字段。我们原来 `order_payments` 只有 `order_id`，迁移后强制补了 `user_id`。原因很简单：支付回调写支付记录时，如果只有订单号没有路由键，Proxy 只能广播。分片系统里，少一次冗余字段，往往就是多十倍查询成本。

## 三、Laravel 侧接入几乎不改 ORM，但要强约束查询入口

Laravel 这边我们没有魔改 Eloquent，而是把连接直接指向 Proxy：

```php
'mysql_order' => [
    'driver' => 'mysql',
    'host' => env('ORDER_DB_HOST', '127.0.0.1'),
    'port' => env('ORDER_DB_PORT', 3307),
    'database' => env('ORDER_DB_DATABASE', 'order_app'),
    'username' => env('ORDER_DB_USERNAME', 'root'),
    'password' => env('ORDER_DB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'strict' => true,
],
```

真正关键的是 Repository 层必须强制带路由键：

```php
final class OrderRepository
{
    public function findByUserAndOrderId(int $userId, int $orderId): ?Order
    {
        return Order::on('mysql_order')
            ->where('user_id', $userId)
            ->where('order_id', $orderId)
            ->first();
    }

    public function create(array $payload): Order
    {
        return Order::on('mysql_order')->create($payload);
    }
}
```

我们专门禁掉了“只按 `order_id` 查订单详情”的默认写法，因为这类 SQL 到 Proxy 层通常无法精准路由，最后会广播到所有分片。线上最夸张的一次，运营后台一个详情页就把 8 个分片同时打满。

为了把约束落到代码里，我们又包了一层查询服务，缺少 `user_id` 就直接抛异常：

```php
final class RoutedOrderQueryService
{
    public function detail(int $userId, int $orderId): OrderData
    {
        if ($userId <= 0) {
            throw new InvalidArgumentException('Missing sharding key: user_id');
        }

        $order = Order::on('mysql_order')
            ->query()
            ->where('user_id', $userId)
            ->where('order_id', $orderId)
            ->with(['items', 'payments'])
            ->firstOrFail();

        return OrderData::fromModel($order);
    }
}
```

这段代码看起来有点“教条”，但它挡住了很多事故。尤其是新人排查问题时，很容易先写一条“查详情”SQL；在单库阶段这没问题，在分片阶段就是隐性全路由。**把分片约束前置到 API 层，比靠 DBA 在慢日志里救火靠谱得多。**

## 四、迁移策略：先双写校验，再切读流量

分库分表最怕的不是规则写错，而是迁移阶段数据对不上。我们的步骤很保守：先建 Proxy 和目标分片表，不切线上流量；然后按 `user_id` 回灌历史订单；接着短期双写，主库继续写、分片库同步写并记录校验日志；等订单数、金额汇总、状态分布都对齐后，再先切“我的订单”读流量，最后切后台查询和异步任务。

回灌脚本核心逻辑如下：

```php
DB::connection('legacy_mysql')
    ->table('orders')
    ->orderBy('id')
    ->chunkById(1000, function ($orders) {
        $payloads = [];

        foreach ($orders as $order) {
            $payloads[] = [
                'order_id' => $order->id,
                'user_id' => $order->user_id,
                'status' => $order->status,
                'total_amount' => $order->total_amount,
                'created_at' => $order->created_at,
                'updated_at' => $order->updated_at,
            ];
        }

        DB::connection('mysql_order')
            ->table('orders')
            ->insert($payloads);
    });
```

这里还有一个真实坑：如果历史表是自增主键，而新系统准备用 Snowflake，全量回灌时一定要先决定“保留旧 ID 还是映射新 ID”。我们最后选择**历史订单保留原 `order_id`，新写入才走 Snowflake**，否则支付单据、退款单据和外部对账系统都得跟着改，风险非常高。

## 五、跨片查询不要硬扛，要主动降级

后台列表最开始还是想一步到位：

```sql
SELECT *
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
```

这条 SQL 在分片后没有 `user_id`，Proxy 只能全路由，再做归并排序，`COUNT(*)` 更慢。后来我们改成两段式：先查近 7 天、按状态和时间做索引化筛选，只拿订单 ID；再按分片键回表。至于导出，直接走离线任务和 CQRS/搜索索引，不再打在线分片库。这个调整比继续给 Proxy“喂复杂 SQL”有效得多。

更细一点说，我们把查询分成三类：

- **用户中心查询**：必须带 `user_id`，直接走在线分片库。
- **运营后台筛选**：走投影表或搜索索引，只返回订单 ID 列表。
- **财务导出/对账**：走异步任务，结果写对象存储，绝不实时扫分片库。

很多团队上了分库分表后还想保留“一个库承接所有查询”的旧模型，最后觉得中间件不稳定。其实问题不在 ShardingSphere，而在查询边界没重画清楚。

## 六、四个最值钱的踩坑记录

### 1. `order_id` 不是万能路由键
支付、退款、履约回调里如果拿不到 `user_id`，不要直接查分片表。我们后来在 Redis 保留 `order_id -> user_id` 的短期映射，回调先补齐路由键，再访问分片库。

### 2. 分页的 `COUNT(*)` 会把你拖死
后台列表如果保留传统分页，每翻一页都要跨片聚合总数。我们的做法是后台改成“游标翻页 + 近似总数提示”，导出另走异步任务。

### 3. 事务边界必须留在单分片内
Laravel 里看起来只是普通 `DB::transaction()`，但如果一次事务里写了跨用户数据，底层就可能落到多个分片。我们最后的规范是：**交易型写入只允许单用户、单分片完成**；跨片对账和修复全部异步化。

### 4. `whereIn(order_id, ...)` 很容易意外打散路由
有一次运营批量重试支付，代码只写了 `whereIn('order_id', $ids)`。看上去只是 20 个订单，但它们属于 20 个用户，Proxy 只能广播到全部分片。后来我们改成先按 `user_id` 分组，再逐组查询；如果拿不到用户维度，就直接转异步任务。

## 七、上线后的收益

迁移完成后，订单写入 P95 从 180ms 降到 65ms，用户订单列表 P95 从 900ms 降到 140ms；更重要的是，支付高峰期间再也不会出现单表自增锁和热点索引页争抢。代价也很明确：SQL 书写自由度下降，所有查询都必须围着分片键设计。

如果你现在的 Laravel 系统只是“单表几百万行有点慢”，我不建议立刻上分库分表；但如果你已经确认瓶颈来自**热点写入、超大分页、索引膨胀、数据生命周期完全不同**，那 ShardingSphere-Proxy 是一条很务实的路。前提是先接受一个事实：**分库分表不是数据库层魔法，而是应用查询模型的重构。**
