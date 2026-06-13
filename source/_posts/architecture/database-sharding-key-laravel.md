---
title: Database Sharding Key 选型实战：按用户 vs 按时间 vs 按业务域——Laravel 多库架构的分片策略决策树
keywords: [Database Sharding Key, Laravel, 选型实战, 按用户, 按时间, 按业务域, 多库架构的分片策略决策树, 架构]
date: 2026-06-09 18:27:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Sharding
  - 分库分表
  - MySQL
  - Laravel
  - 架构设计
description: 在 Laravel 多库架构下，Sharding Key 的选择决定了数据分布、查询效率和扩容成本。本文以 KKday B2C API 真实场景为背景，对比按用户、按时间、按业务域三种分片策略，给出可落地的决策树和 Laravel 实现方案。
---


## 概述

当单表数据量突破千万级、单库连接数逼近天花板时，分库分表（Sharding）几乎是唯一的出路。但 Sharding 最关键的决策不是「怎么分」，而是**「按什么键分」**——也就是 Sharding Key 的选择。

选错了 Sharding Key，轻则跨库 JOIN 泛滥、热点集中，重则需要全量数据迁移推倒重来。本文基于 KKday B2C API（Laravel 8，30+ 仓库）的实际架构演进经验，对比三种主流 Sharding Key 策略，给出一套可直接套用的决策树。

## 核心概念

### 什么是 Sharding Key

Sharding Key 是决定数据行被路由到哪个分片（物理库/表）的键值。它的选择直接影响：

- **数据分布均匀度**：是否会出现某个分片数据量远超其他分片（数据倾斜）
- **查询路由效率**：大部分查询能否命中外键所在分片，避免跨分片查询（Scatter-Gather）
- **扩容迁移成本**：新增分片时，是否需要大规模数据重分布（Rebalancing）
- **事务边界**：同库事务的可行性，分布式事务的复杂度

### 三种主流策略

| 策略 | Sharding Key | 典型场景 | 核心优势 | 核心风险 |
|------|-------------|---------|---------|---------|
| **按用户** | user_id / customer_id | C 端用户型产品 | 用户维度查询高效，单用户事务简单 | 用户间查询需 Scatter-Gather |
| **按时间** | created_at / 时间分区 | 日志、时序数据、归档场景 | 历史数据归档自然，冷热分离清晰 | 时间窗口内热点集中 |
| **按业务域** | order_id / biz_domain | 业务边界清晰的中台架构 | 业务自包含，扩展灵活 | 跨域聚合复杂 |

### Sharding Key 选择的三个铁律

1. **高频查询必须命中 Sharding Key**：如果 80% 的查询都带 user_id，那 user_id 就是天然的 Sharding Key
2. **数据分布必须均匀**：Sharding Key 的基数（Cardinality）要足够高，避免数据倾斜
3. **事务边界必须收敛**：需要在同一事务内完成的操作，其涉及的数据必须落在同一分片

## 实战代码：Laravel 多库架构下的 Sharding 实现

### 1. 数据库路由层：Sharding Router

```php
<?php

namespace App\Sharding;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Config;

class ShardingRouter
{
    /**
     * 分片配置：每个分片的连接名和数据范围
     */
    private array $shards;

    public function __construct()
    {
        $this->shards = Config::get('sharding.shards', []);
    }

    /**
     * 按用户 ID 路由到对应分片
     *
     * @param int $userId
     * @return string 数据库连接名
     */
    public function routeByUserId(int $userId): string
    {
        $shardCount = count($this->shards);
        $shardIndex = $userId % $shardCount;

        return $this->shards[$shardIndex]['connection'];
    }

    /**
     * 按订单 ID 路由（业务域分片）
     * 订单 ID 中编码了分片信息，例如 ORD-{shardId}-xxxxxxxx
     */
    public function routeByOrderId(string $orderId): string
    {
        // 解析订单号中的分片标识
        if (preg_match('/^ORD-(\d+)-/', $orderId, $matches)) {
            $shardIndex = (int) $matches[1] % count($this->shards);
            return $this->shards[$shardIndex]['connection'];
        }

        // fallback：哈希路由
        $shardIndex = crc32($orderId) % count($this->shards);
        return $this->shardIndex]['connection'];
    }

    /**
     * 按时间路由（按月分片）
     *
     * @param \DateTimeInterface $date
     * @return string
     */
    public function routeByTime(\DateTimeInterface $date): string
    {
        $yearMonth = $date->format('Ym');

        // 查找匹配的时间分片
        foreach ($this->shards as $shard) {
            if (isset($shard['time_range'])) {
                $start = $shard['time_range']['start'];
                $end = $shard['time_range']['end'];
                if ($yearMonth >= $start && $yearMonth <= $end) {
                    return $shard['connection'];
                }
            }
        }

        return Config::get('database.default');
    }

    /**
     * 获取所有分片连接名（用于全量查询/迁移）
     */
    public function getAllConnections(): array
    {
        return array_column($this->shards, 'connection');
    }
}
```

### 2. 分片配置

```php
// config/sharding.php
<?php

return [
    'strategy' => env('SHARDING_STRATEGY', 'user_id'), // user_id | order_id | time

    'shards' => [
        [
            'connection' => 'shard_0',
            'database' => 'kkday_b2c_shard_0',
            'range' => ['min' => 0, 'max' => 499999], // user_id 范围
        ],
        [
            'connection' => 'shard_1',
            'database' => 'kkday_b2c_shard_1',
            'range' => ['min' => 500000, 'max' => 999999],
        ],
        [
            'connection' => 'shard_2',
            'database' => 'kkday_b2c_shard_2',
            'range' => ['min' => 1000000, 'max' => 1499999],
        ],
    ],

    // 时间分片配置（备用）
    'time_shards' => [
        [
            'connection' => 'shard_history',
            'time_range' => ['start' => '202001', 'end' => '202512'],
        ],
        [
            'connection' => 'shard_current',
            'time_range' => ['start' => '202601', 'end' => '209912'],
        ],
    ],
];
```

### 3. 分片模型基类

```php
<?php

namespace App\Models\Sharding;

use Illuminate\Database\Eloquent\Model;
use App\Sharding\ShardingRouter;

abstract class ShardAwareModel extends Model
{
    protected static ShardingRouter $router;

    protected static function boot(): void
    {
        parent::boot();

        static::$router = app(ShardingRouter::class);
    }

    /**
     * 按 Sharding Key 查询
     *
     * @param int|string $shardKey
     * @param array $conditions
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public static function byShard(int|string $shardKey, array $conditions = []): \Illuminate\Database\Eloquent\Builder
    {
        $connection = match (static::getShardStrategy()) {
            'user_id' => static::$router->routeByUserId((int) $shardKey),
            'order_id' => static::$router->routeByOrderId((string) $shardKey),
            'time' => static::$router->routeByTime($shardKey),
        };

        return static::on($connection)->where($conditions);
    }

    /**
     * 子类必须定义 Sharding Key 字段名
     */
    abstract protected static function getShardKeyColumn(): string;

    /**
     * 子类必须定义分片策略
     */
    abstract protected static function getShardStrategy(): string;

    /**
     * 跨分片聚合查询（Scatter-Gather）
     */
    public static function crossShardQuery(callable $callback): \Illuminate\Support\Collection
    {
        $results = collect();

        foreach (static::$router->getAllConnections() as $connection) {
            $partial = static::on($connection)->cursor();
            $results = $results->merge($callback($partial));
        }

        return $results;
    }
}
```

### 4. 业务实现：订单模型

```php
<?php

namespace App\Models\Sharding;

class Order extends ShardAwareModel
{
    protected $table = 'orders';

    protected static function getShardKeyColumn(): string
    {
        return 'user_id';
    }

    protected static function getShardStrategy(): string
    {
        return config('sharding.strategy', 'user_id');
    }

    /**
     * 按用户查询订单（高效：命中单一分片）
     */
    public static function forUser(int $userId): \Illuminate\Database\Eloquent\Builder
    {
        return static::byShard($userId, ['user_id' => $userId]);
    }

    /**
     * 按用户分页查询
     */
    public static function paginateForUser(int $userId, int $perPage = 20): \Illuminate\Contracts\Pagination\LengthAwarePaginator
    {
        return static::forUser($userId)
            ->orderByDesc('created_at')
            ->paginate($perPage);
    }

    /**
     * 跨分片：按日期范围查询所有用户的订单
     * 代价较高，仅用于管理后台/报表场景
     */
    public static function queryByDateRange(\DateTimeInterface $from, \DateTimeInterface $to): \Illuminate\Support\Collection
    {
        return static::crossShardQuery(function ($query) use ($from, $to) {
            return $query->whereBetween('created_at', [$from, $to])->get();
        });
    }
}
```

## 踩坑记录

### 坑 1：选了 user_id 做 Sharding Key，但管理后台需要按商家维度查

**场景**：运营后台需要查看某个商家（merchant_id）的所有订单，但 Sharding Key 是 user_id。每次查询都要 Scatter-Gather 所有分片，延迟 200-500ms。

**解决方案**：建立**反向索引表**（非分片），用 Kafka CDC 同步：

```php
// 同步订单到商家维度索引表（不分片，独立库）
class OrderMerchantIndexSync
{
    public function handle(OrderCreatedEvent $event): void
    {
        DB::connection('index_db')->table('order_merchant_index')->insert([
            'order_id' => $event->order->id,
            'merchant_id' => $event->order->merchant_id,
            'user_id' => $event->order->user_id,
            'created_at' => $event->order->created_at,
        ]);
    }
}
```

**教训**：Sharding Key 只能保证一个维度的高效查询。第二个维度必须靠反向索引或搜索引擎（Elasticsearch）补充。

### 坑 2：哈希分片导致新增分片时数据迁移量巨大

**场景**：初始 4 个分片，用 `userId % 4` 路由。扩容到 8 个分片后，`userId % 8` 与 `userId % 4` 的结果完全不同，**75% 的数据需要迁移**。

**解决方案**：用**一致性哈希**（Consistent Hashing）替代取模：

```php
use HashConsistent\ConsistentHash;

class ConsistentHashRouter
{
    private ConsistentHash $hashRing;

    public function __construct()
    {
        $this->hashRing = new ConsistentHash();

        // 每个分片 100 个虚拟节点，提高均匀度
        $shards = config('sharding.shards');
        foreach ($shards as $index => $shard) {
            $this->hashRing->addNode($shard['connection'], 100);
        }
    }

    public function route(int $userId): string
    {
        return $this->hashRing->lookup((string) $userId);
    }
}
```

**教训**：一致性哈希在扩容时只迁移 ~1/N 的数据，远优于取模。但虚拟节点数量要足够多（推荐 100+）以保证均匀分布。

### 坑 3：跨分片事务的坑——Saga 模式落地

**场景**：下单流程涉及订单库（分片 0）和库存库（分片 1），两个操作必须同时成功或同时回滚。

**解决方案**：用 **Saga 模式** + 补偿操作：

```php
class OrderSaga
{
    public function execute(CreateOrderCommand $command): Order
    {
        $compensations = [];

        try {
            // Step 1: 扣减库存（可能在不同分片）
            $stockResult = $this->deductStock($command);
            $compensations[] = fn() => $this->restoreStock($command);

            // Step 2: 创建订单
            $order = $this->createOrder($command);
            $compensations[] = fn() => $this->cancelOrder($order);

            // Step 3: 扣减积分
            $this->deductPoints($command);

            return $order;

        } catch (\Throwable $e) {
            // 逆序执行补偿操作
            foreach (array_reverse($compensations) as $compensate) {
                try {
                    $compensate();
                } catch (\Throwable $compensateError) {
                    // 记录补偿失败，人工介入
                    Log::critical('Saga compensation failed', [
                        'error' => $compensateError->getMessage(),
                        'command' => $command,
                    ]);
                }
            }

            throw $e;
        }
    }
}
```

**教训**：分布式事务能不用就不用。优先通过 Sharding Key 选择让相关操作落在同一分片，其次用 Saga 模式，最后才考虑 2PC。

### 坑 4：数据倾斜导致某个分片扛不住

**场景**：按 user_id 分片后，某个超级用户（比如大客户）有 50 万条订单，导致 shard_2 的负载远高于其他分片。

**解决方案**：对**热 Key 用户**进行二次拆分：

```php
public function routeByUserId(int $userId): string
    {
        // 热 Key 检测：超过阈值的用户单独路由
        if ($this->isHotUser($userId)) {
            $hotShardIndex = $userId % $this->hotShardCount;
            return "shard_hot_{$hotShardIndex}";
        }

        $normalShardIndex = $userId % $this->normalShardCount;
        return $this->shards[$normalShardIndex]['connection'];
    }
```

**教训**：分片前一定要做**数据分布预分析**。用 `SELECT user_id, COUNT(*) FROM orders GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 20` 找出长尾用户。

## 分片策略决策树

面对具体的业务场景，用以下决策树选择 Sharding Key：

```
开始
  │
  ├─ Q1: 数据的主要查询维度是什么？
  │   ├─ 用户维度（"我的订单""我的收藏"） → 候选：user_id
  │   ├─ 时间维度（日志、时序、按月报表） → 候选：created_at
  │   └─ 业务域维度（订单、支付、库存独立演进） → 候选：order_id / biz_domain
  │
  ├─ Q2: 是否需要跨维度高效查询？
  │   ├─ 需要 2+ 维度同时高效 → 考虑冗余索引表 或 ES
  │   └─ 只需 1 个主维度高效 → 单 Sharding Key 即可
  │
  ├─ Q3: 数据量增长趋势？
  │   ├─ 匀速增长（用户增长驱动） → 按用户分片 + 一致性哈希
  │   ├─ 爆发式增长（日志/事件流） → 按时间分片 + 冷热分离
  │   └─ 业务拆分驱动 → 按业务域分片 + 独立扩缩
  │
  ├─ Q4: 扩容预期？
  │   ├─ 频繁扩容 → 一致性哈希（最少迁移）
  │   └─ 稳定 3-5 年 → 取模即可（简单直接）
  │
  └─ Q5: 事务要求？
      ├─ 强一致 → 优先让相关数据落在同一分片（Sharding Key 对齐）
      └─ 最终一致 → Saga / 消息队列补偿
```

### 快速决策表

| 你的场景 | 推荐 Sharding Key | 分片策略 | 备注 |
|---------|------------------|---------|------|
| 电商用户订单 | user_id | 一致性哈希 | 单用户查询高效，管理维度靠 ES |
| 日志/审计流水 | created_at | 按月/按季度 | 天然冷热分离，归档方便 |
| SaaS 多租户 | tenant_id | 取模或一致性哈希 | 租户间数据严格隔离 |
| 订单/支付/库存中台 | order_id | 业务域自包含 | 每个域独立分片，Saga 协调 |
| IoT 设备上报 | device_id + 时间 | 复合键（设备维度 + 时间窗口） | 设备维度查最近数据，时间维度归档 |

## 总结

Sharding Key 的选择没有银弹，但有一套可复用的决策框架：

1. **先查后分**：梳理 80% 查询的 WHERE 条件，选择命中率最高的字段作为 Sharding Key
2. **预留余量**：用一致性哈希而非简单取模，为未来扩容留空间
3. **补齐短板**：一个 Sharding Key 只能高效服务一个维度，第二维度靠反向索引或搜索引擎
4. **预分析数据**：分片前必须分析数据分布，识别长尾用户和热点 Key
5. **渐进式迁移**：从单库开始，用 Router 层屏蔽分片细节，数据量到了再拆

在 KKday B2C API 的实践中，我们最终选择了 **user_id + 一致性哈希** 作为主分片策略，配合商家维度反向索引表和 Elasticsearch 跨维度查询，在 30+ 仓库的复杂架构下实现了可控的数据分布和查询性能。

记住：**最好的 Sharding Key 是让大部分请求不需要跨分片的那个**。
