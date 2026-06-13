---

title: 分布式之 CAP 与 BASE
keywords: [CAP, BASE, 分布式之]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- 微服务
- 架构
- CAP
- BASE
- 分布式
- 一致性
categories:
- architecture
date: 2020-07-20 11:15:49
description: 深入解析分布式系统两大基石理论 CAP 定理与 BASE 思想，覆盖 CP 与 AP 选型决策、ZooKeeper/etcd/Consul 协调服务对比、Redis/MySQL/MongoDB/Cassandra 数据库 CAP 分类速查，并给出 Laravel 最终一致性代码实战与生产踩坑案例，帮助后端工程师在微服务架构中做出正确的分布式取舍。
---


# 一句话

> 分布式系统里，**C / A / P 三者最多只能满足两个**。又因为网络分区一定会发生（P 不可避免），所以现实中你只能在 **CP** 与 **AP** 之间二选一。

# CAP 三个字母

| 字母 | 含义 | 通俗理解 |
|---|---|---|
| **C**onsistency | 一致性 | 任何时候读到的数据都是最新写入的 |
| **A**vailability | 可用性 | 每次请求都能在合理时间内返回响应（不超时、不报错） |
| **P**artition tolerance | 分区容错性 | 节点之间网络断开/丢包时，系统仍能继续工作 |

## 为什么必选 P

只要是「分布式」系统，节点之间靠网络通讯，就**一定会**遇到丢包、延迟、机房断网。**P 不是一个选项，是事实**。所以真正在选的，是 **CP** 还是 **AP**：

- **CP**：网络分区时，宁可拒绝服务也要保证强一致 → ZooKeeper、etcd、HBase
- **AP**：网络分区时，宁可返回旧数据也要保证可用 → Cassandra、Eureka、DNS

# 一个具体例子

主从两节点 MySQL，主从间网络断了：

- **CP 派**：从库直接拒绝读请求（避免读到旧数据）→ 一致但不可用
- **AP 派**：从库继续返回旧数据 → 可用但不一致

> 注意：CAP 里的「一致性」是 **强一致性**（线性一致性 / 顺序一致性），不是日常语境的"数据正确"。

# BASE：AP 的工程化补丁

CAP 是理论极端，工程上多数业务并不需要"每次读到的都是当下最新"。**BASE** 是 eBay 工程师对 AP 的工程化总结：

| 字母 | 含义 | 实际做法 |
|---|---|---|
| **B**asically **A**vailable | 基本可用 | 部分功能/性能降级，核心可用（限流、熔断、降级） |
| **S**oft state | 软状态 | 允许中间状态存在（订单"处理中"、消息"投递中"） |
| **E**ventually consistent | 最终一致 | 一段时间后数据收敛到一致（异步同步、补偿、对账） |

## 最终一致的常见手段

- **消息队列**：写主库 → 发 MQ → 其它服务异步消费更新
- **定时对账**：每日 T+1 跑账，发现不一致就补
- **TCC / Saga**：拆成 Try-Confirm-Cancel 或可补偿的子事务
- **读修复 / 反熵**：Cassandra 风格的后台一致性修复

# CAP vs ACID vs BASE

| 视角 | 单机数据库 | 分布式（强一致派） | 分布式（最终一致派） |
|---|---|---|---|
| 模型 | ACID | CP（CAP 中选 CP） | AP + BASE |
| 例子 | MySQL 单实例 | ZooKeeper、etcd | Cassandra、DynamoDB |
| 取舍 | 不用考虑分区 | 牺牲可用性 | 牺牲强一致 |

# 选型速查

| 业务 | 推荐 | 原因 |
|---|---|---|
| 配置中心、服务注册表 | **CP**（etcd、ZK） | 配错比看不到更可怕 |
| 服务发现（高可用优先） | **AP**（Eureka、Nacos AP） | 拿到旧节点列表也比拿不到强 |
| 商品详情页、信息流 | **AP** + 缓存 | 读多写少，最终一致足够 |
| 支付、库存扣减 | **CP** 或强一致中间件 | 钱出错没法解释 |
| 消息系统 | 看场景 | Kafka 偏 AP；RabbitMQ 镜像队列偏 CP |

# 主流数据库 CAP 分类速查表

| 数据库 | 默认倾向 | 可调一致性 | 典型场景 |
|---|---|---|---|
| **MySQL**（主从） | CP | 半同步复制可降低延迟 | 订单、账户等强一致场景 |
| **PostgreSQL**（流复制） | CP | synchronous_commit 调节 | 金融、ERP |
| **MongoDB** | 可调 | `w:majority` = CP；`w:1` = 偏 AP | 内容管理、日志、IoT |
| **Redis Cluster** | 偏 AP | 主从切换期间可能丢数据 | 缓存、会话、排行榜 |
| **Cassandra** | AP | `QUORUM` 读写可逼近 CP | 时序数据、消息存储、IoT |
| **CockroachDB** | CP | 强一致 Raft 共识 | 全球分布式事务 |
| **TiDB** | CP | Raft 多副本 + 乐观/悲观锁 | MySQL 兼容的分布式场景 |
| **DynamoDB** | AP | 读取可选 `strongly consistent` | 电商购物车、用户画像 |
| **etcd / ZooKeeper** | CP | 无（强一致是核心设计） | 配置中心、分布式锁 |
| **HBase** | CP | 无 | 大数据宽表、时序存储 |

> **一句话记忆**：需要「不能错」选 CP，需要「不能挂」选 AP，大多数互联网业务用 AP + 补偿就够了。

# 真实案例：大厂如何做 CAP 取舍

## Netflix：拥抱 AP，用最终一致性换可用性

Netflix 的微服务架构是 AP 思想的教科书级实践：

- **Eureka（服务发现）**：AP 模型，即使注册中心集群出现网络分区，客户端仍可使用本地缓存的服务列表继续调用，宁可路由到旧节点也不要整个系统不可用。
- **Cassandra（数据存储）**：Netflix 的核心数据存储之一，多数据中心复制，最终一致性。用户播放记录、推荐特征等允许短暂不一致。
- **Hystrix（熔断降级）**：本质是 AP 的工程化手段——调用超时就降级返回兜底数据，保证用户体验不断裂。

> Netflix 的哲学：**对用户可见的功能必须可用，数据晚几秒到可以接受**。

## Amazon：Dynamo 论文开创 AP 先河

Amazon 的 Dynamo（2007 年论文）是 AP 系统的经典设计，后来启发了 Cassandra 和 DynamoDB：

- **购物车**：宁可让用户看到旧购物车（AP），也不能因为网络抖动导致「购物车不可用」。冲突解决靠合并（把两个版本的购物车项合并）。
- **最终一致 + 向量时钟**：用向量时钟追踪版本因果关系，冲突时由应用层决定合并策略。
- **牺牲强一致换来了 99.999% 可用性**：对 Amazon 来说，1 秒不可用 = 数百万美元损失。

## 支付宝/微信支付：关键路径强一致

与 Netflix/Amazon 不同，金融场景必须选 CP：

- **转账/扣款**：必须强一致，宁可短暂不可用也不能出现「扣了钱但对方没收到」。
- **TCC 模式**：Try 阶段冻结资源 → Confirm 阶段提交 → Cancel 阶段回滚，保证跨服务的资金一致性。
- **对账兜底**：即使有分布式事务保障，仍然跑 T+1 对账任务作为最终安全网。

> 金融场景的核心逻辑：**钱的事情，宁可慢也不能错**。

# 代码示例：CP 与 AP 的实现模式

## CP 模式示例：基于 Raft 的强一致写入（伪代码）

```python
import raft  # 伪代码，基于 Raft 共识库

class CPService:
    def __init__(self, nodes):
        self.raft = raft.Cluster(nodes)

    def write(self, key, value):
        """CP 写入：必须多数派确认才算成功"""
        # 写入必须得到 majority 节点确认
        result = self.raft.propose(key, value, quorum="majority")
        if result.success:
            return {"status": "ok", "value": value}
        else:
            # 网络分区 → 少数派节点直接拒绝写入
            raise ServiceUnavailable("无法达成多数派共识，拒绝写入")

    def read(self, key):
        """CP 读取：必须从 leader 或 readIndex 确认"""
        # 读取也需要保证线性一致性
        result = self.raft.read(key, consistency="strong")
        if result is None:
            raise ServiceUnavailable("当前节点非 leader，拒绝读取")
        return result
```

## AP 模式示例：最终一致性写入（伪代码）

```python
import time
import message_queue as mq

class APService:
    def __init__(self, local_store, peers):
        self.store = local_store  # 本地存储
        self.peers = peers         # 其他副本节点

    def write(self, key, value):
        """AP 写入：本地成功即返回，异步同步到其他节点"""
        # 1. 写本地（本地可用即可写入）
        self.store.put(key, {
            "value": value,
            "timestamp": time.time_ns(),
            "version": self.store.increment_version(key)
        })
        # 2. 异步推送到消息队列，其他节点消费后更新
        mq.publish("sync", {"key": key, "value": value})
        return {"status": "ok", "consistency": "eventual"}

    def read(self, key):
        """AP 读取：直接读本地，可能返回旧数据"""
        data = self.store.get(key)
        if data is None:
            # 本地没有时，尝试从其他节点读（尽力而为）
            for peer in self.peers:
                try:
                    return peer.get(key)
                except:
                    continue  # 其他节点不可用，继续尝试
            raise NotFound("所有副本均无数据")
        return data  # 可能是旧数据，但保证可用
```

## 实际工程中的混合模式

真实系统往往不是纯粹的 CP 或 AP，而是**分场景混合**：

```python
class HybridService:
    """电商系统：库存 CP + 商品详情 AP"""

    def deduct_stock(self, order_id, sku_id, quantity):
        """库存扣减：必须 CP，不能超卖"""
        # 使用分布式锁 + 数据库事务，强一致
        with distributed_lock(f"stock:{sku_id}"):
            stock = db.query("SELECT quantity FROM stock WHERE sku = ?", sku_id)
            if stock.quantity < quantity:
                raise InsufficientStock("库存不足")
            db.execute(
                "UPDATE stock SET quantity = quantity - ? WHERE sku = ?",
                quantity, sku_id
            )
            # 同步写入 Redis 缓存
            redis.set(f"stock:{sku_id}", stock.quantity - quantity)
        return {"status": "deducted"}

    def get_product_detail(self, product_id):
        """商品详情：AP，缓存优先，允许短暂旧数据"""
        # 1. 先读缓存
        cached = redis.get(f"product:{product_id}")
        if cached:
            return cached  # 可能是几秒前的旧数据

        # 2. 缓存 miss，读数据库
        product = db.query("SELECT * FROM products WHERE id = ?", product_id)
        if product:
            redis.setex(f"product:{product_id}", 300, product)  # 缓存 5 分钟
        return product
```

# CAP 在微服务架构中的实践建议

1. **不要全局选 CP 或 AP**：同一个系统里，订单服务选 CP，商品服务选 AP，按业务场景分别决策。
2. **AP 不代表可以不管一致性**：AP 只是说「分区时允许暂时不一致」，但你仍然需要补偿机制（MQ、对账、TCC）来达到最终一致。
3. **监控一致性延迟**：如果用了 AP 模式，一定要监控「数据同步延迟」，确保最终一致性在可接受的时间窗口内收敛。
4. **CP 的代价容易被低估**：选 CP 意味着网络分区时部分用户会看到错误页面或超时，产品侧需要接受这个 trade-off。
5. **PACELC 是更好的思考框架**：CAP 只说了分区时怎么办，PACELC 还考虑了**正常情况下延迟（Latency）与一致性（Consistency）的取舍**，更适合实际架构设计。

> **PACELC**：if **P**artition → choose **A**vailability or **C**onsistency; **E**lse → choose **L**atency or **C**onsistency.

# 协调服务对比：ZooKeeper vs etcd vs Consul

分布式系统中最典型的 CP 场景就是**协调服务**——配置中心、分布式锁、选主、服务注册。市面上三大主流选型如下：

| 维度 | ZooKeeper | etcd | Consul |
|---|---|---|---|
| **一致性协议** | ZAB（类 Raft） | Raft | Raft |
| **CAP 倾向** | CP | CP | CP（默认） / 可调为 AP |
| **语言** | Java | Go | Go |
| **数据模型** | 树形 ZNode | KV（前缀查询） | KV + 服务目录 |
| **Watch 机制** | 原生 Watch（一次性触发） | Watch + 前缀 Watch | Blocking Query + 事件流 |
| **健康检查** | 无内置，需自己做 | 无内置，需 Lease TTL | 内置 TCP/HTTP/gRPC/Script 多种检查 |
| **服务发现** | 需自建或 Curator | 需自建 | 原生支持，DNS + HTTP API |
| **多数据中心** | 不原生支持 | 不原生支持 | 原生支持 WAN Gossip |
| **客户端语言** | Java 生态最好，其它社区封装 | Go 生态最好，gRPC 多语言 | HTTP API，所有语言通用 |
| **学习曲线** | 较高（JVM 运维 + 客户端复杂） | 中等 | 较低（开箱即用） |
| **典型用户** | Hadoop、Kafka、Dubbo | Kubernetes、CoreOS | HashiCorp 全家桶、Spring Cloud Consul |

### 选型建议

- **Kubernetes 生态** → etcd（K8s 底层已绑定）
- **Java 微服务 + Dubbo** → ZooKeeper（生态成熟）
- **多数据中心 + 服务发现开箱即用** → Consul
- **只需要分布式配置/锁，语言不限** → etcd（API 简洁，运维轻量）

> 注意：Consul 虽然默认 CP，但其 **Serf/Gossip 层是 AP** 的，只有强一致读写走 Raft 共识。这种分层设计让它在「服务发现」场景下比纯 CP 系统更灵活。

# Laravel 最终一致性实战代码

很多后端工程师用 Laravel 开发分布式业务，以下是生产中最常见的两种最终一致性模式。

## 模式一：消息队列异步同步（订单 → 库存 → 物流）

```php
<?php
// app/Jobs/SyncOrderToInventoryJob.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SyncOrderToInventoryJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = 30; // 重试间隔 30 秒

    public function __construct(
        public array $orderItems,
        public string $orderId,
    ) {}

    public function handle(): void
    {
        DB::transaction(function () {
            foreach ($this->orderItems as $item) {
                $affected = DB::table('inventory')
                    ->where('sku', $item['sku'])
                    ->where('quantity', '>=', $item['qty'])
                    ->decrement('quantity', $item['qty']);

                if ($affected === 0) {
                    // 库存不足，抛异常触发重试
                    throw new \RuntimeException(
                        "SKU {$item['sku']} 库存不足，等待补货或人工介入"
                    );
                }
            }

            // 写入同步状态表，标记库存已扣减
            DB::table('sync_status')->updateOrInsert(
                ['order_id' => $this->orderId, 'step' => 'inventory'],
                ['status' => 'synced', 'synced_at' => now()]
            );
        });

        // 库存扣减成功后，异步推进到物流
        SyncOrderToLogisticsJob::dispatch($this->orderId, $this->orderItems);
    }

    public function failed(\Throwable $e): void
    {
        Log::error("订单 {$this->orderId} 库存同步失败，需人工介入", [
            'error' => $e->getMessage(),
            'items' => $this->orderItems,
        ]);
        // 写入死信表，对账任务兜底
        DB::table('dead_letters')->insert([
            'job' => self::class,
            'order_id' => $this->orderId,
            'payload' => json_encode($this->orderItems),
            'reason' => $e->getMessage(),
            'created_at' => now(),
        ]);
    }
}
```

## 模式二：T+1 对账兜底

```php
<?php
// app/Console/Commands/ReconciliationCommand.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ReconciliationCommand extends Command
{
    protected $signature = 'reconcile:inventory {--date= : 对账日期，默认昨天}';
    protected $description = '对账：订单已支付但库存未扣减的异常单';

    public function handle(): int
    {
        $date = $this->option('date') ?? now()->subDay()->toDateString();

        // 找出「已支付但库存未同步」的订单
        $anomalies = DB::table('orders as o')
            ->leftJoin('sync_status as s', function ($join) use ($date) {
                $join->on('o.id', '=', 's.order_id')
                     ->where('s.step', '=', 'inventory');
            })
            ->where('o.status', 'paid')
            ->where('o.paid_at', '>=', $date)
            ->where(function ($q) {
                $q->whereNull('s.status')
                  ->orWhere('s.status', '!=', 'synced');
            })
            ->get();

        $this->info("发现 {$anomalies->count()} 笔异常订单");

        foreach ($anomalies as $order) {
            // 重新派发库存扣减 Job
            \App\Jobs\SyncOrderToInventoryJob::dispatch(
                json_decode($order->items, true),
                $order->id
            )->onQueue('reconciliation');

            Log::warning("对账补单：订单 {$order->id} 重新派发库存扣减");
        }

        $this->info('对账完成，已重新派发异常订单');
        return self::SUCCESS;
    }
}
```

> **核心思路**：写入时用 MQ 异步 → 失败重试 + 死信队列 → 每日对账兜底。三层保障确保最终一致性，即使 MQ 偶尔丢消息也不会漏扣。

# 踩坑案例：生产中的 CAP 问题

## 案例一：Redis 主从切换丢数据，库存超卖

**背景**：某电商用 Redis 存储库存余量（AP 倾向），扣减时先 DECR 再写订单。

**事故**：Redis 主节点写入成功后、尚未同步到从节点时宕机。哨兵选举从节点为新主，**新主上的库存比实际多**。大量用户在切换窗口期下单成功，导致超卖 300+ 件。

**根因**：Redis 异步复制 = AP 模型，主从切换时必然有数据丢失窗口。

**修复**：
1. 库存扣减改用 MySQL（CP）+ Lua 原子脚本保证一致性
2. Redis 仅做读缓存，设置 `WAIT 1 5000`（等待至少 1 个从节点确认，超时 5 秒）
3. 超卖后触发自动补偿：锁单 + 短信通知 + 优惠券补偿

> **教训**：涉及钱和库存的场景，不能用 AP 倾向的存储做唯一数据源。

## 案例二：ZooKeeper 脑裂导致配置不一致

**背景**：某系统用 ZooKeeper 做配置中心，ZK 集群跨两个机房部署（3 节点在 A 机房，2 节点在 B 机房）。

**事故**：A、B 机房间网络中断超过 30 秒。B 机房的 2 个节点无法形成多数派，ZK 正确地拒绝了 B 的写请求（CP 行为）。但问题是：**B 机房的服务仍然在读取本地 ZK Follower 缓存的旧配置**，导致部分服务用旧配置运行了 10 分钟。

**根因**：ZK 的 CP 保护的是**写入侧**，但客户端的**本地缓存**绕过了一致性保障。

**修复**：
1. 客户端 Watch 回调中增加版本校验，ZK session 过期后立即清空本地缓存
2. ZK 集群改为 5 节点同机房部署（消除跨机房脑裂风险）
3. 关键配置增加版本号字段，服务启动时校验版本

> **教训**：CP 系统的一致性只到「服务端写入成功」，客户端缓存是另一层需要处理的问题。

## 案例三：Eureka 自我保护导致流量打到已下线服务

**背景**：某微服务用 Eureka 做服务注册（AP 模型），服务部署在 K8s 上。

**事故**：发布高峰期网络抖动，Eureka Server 触发**自我保护模式**（15 分钟内心跳低于阈值）。此时已下线的旧 Pod 仍留在注册列表中，客户端负载均衡把 30% 的流量打到了已销毁的 Pod IP 上，大量 502。

**根因**：Eureka 的 AP 设计 + 自我保护 = 网络异常时宁可保留旧注册信息也不清除，这在发布场景下是灾难。

**修复**：
1. 关闭自我保护（`eureka.server.enable-self-preservation=false`）
2. 缩短续约超时：`eviction-interval-timer-in-ms=5000`
3. 客户端增加健康检查，调用失败后主动剔除实例
4. 长期方案：迁移到 Nacos（同时支持 CP/AP 模式，按需切换）

> **教训**：AP 系统的「高可用」是有代价的——旧数据的副作用可能比不可用更严重。

## 案例四：MongoDB w:1 写入后读取不到自己的数据

**背景**：某内容平台用 MongoDB 存储文章，写入时使用默认的 `w:1`（写入一个节点即返回成功）。

**事故**：用户发布文章后立刻刷新页面，偶尔看到「文章不存在」。原因是读请求被路由到了另一个 Secondary 节点，数据还没同步过去。

**根因**：`w:1` = AP 倾向（写入快但不保证其他节点可见），读写分离时必然出现短暂不一致。

**修复**：
1. 写入使用 `w:majority`（CP 模式），确保多数节点确认后才返回
2. 读取使用 `readConcern: "majority"` 或 `readPreference: primaryPreferred`
3. 前端增加乐观更新：发布成功后直接展示本地数据，不依赖后端查询

> **教训**：MongoDB 的 CAP 行为取决于 `w` / `readConcern` 配置，默认配置不是 CP。

# 常见误区

1. **"NoSQL 都是 AP"** —— 错。MongoDB 主从用 majority 写就是 CP；Cassandra 也能调到接近 CP。
2. **"我有事务就有 C"** —— 单机 ACID 的 C 跟 CAP 的 C 不是一回事，前者是数据库约束，后者是多副本可见性。
3. **"BASE 是 NoSQL 专属"** —— BASE 本质是工程取舍思路，传统业务一样用：MQ + 对账就是典型 BASE。

# 参考

- Eric Brewer, *CAP Twelve Years Later: How the "Rules" Have Changed*: <https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/>
- Dan Pritchett, *BASE: An Acid Alternative*: <https://queue.acm.org/detail.cfm?id=1394128>

# 相关阅读

- [CAP 定理论在 KKday B2C 微服务中的取舍与实战](/architecture/cap-theorem-kkday/)
- [分布式事务实战：Saga 模式在订单/库存/支付中的应用](/architecture/distributedtransactionguide-saga/)
- [服务注册与发现实战：Consul/Nacos 与 Laravel 集成](/architecture/service-discovery-consul-nacos/)
- [配置中心实战：Apollo/Nacos 动态配置与 Laravel 集成](/architecture/config-center-apollo-nacos/)
- [分布式锁设计与避坑：Redis/ZooKeeper/etcd 方案对比](/architecture/inventory-lock-design/)
- [Stripe 高并发支付架构：幂等性与最终一致性实践](/architecture/stripe-high-concurrency/)
