---

title: 分库分表实战：水平拆分策略与 ShardingSphere 集成
tags:
- MySQL
- 分库分表
- 数据库
- 分片
- 雪花算法
categories:
  - database
keywords: [ShardingSphere, 分库分表实战, 水平拆分策略与, 数据库]
date: 2019-03-20 15:05:07
description: 全面解析MySQL分库分表技术方案：详解范围分片、哈希分片、一致性哈希三大分片策略与PHP代码实现，ShardingSphere、MyCat、Vitess、ProxySQL中间件选型与配置示例，雪花算法PHP实现，跨分片查询策略（映射表、二次查询、绑定表），分布式事务2PC/TCC/Saga对比，以及电商平台真实迁移案例复盘，助你从容应对海量数据场景。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-017-content-1.jpg
- /images/content/databases-017-content-2.jpg
---



> 分库分表

​	并发量决定是否需要分库，

​	数据量决定是否需要分表。



> 分区分片

​	按时间范围归档分区

​	按用户ID取模分表，

​	按shardingkey来分片；



> 数据量太大的场景

mysql表的数据量一般控制在千万级别，如果再大的话，就要考虑分库分表。

![分库分表优化手段](/images/content/databases-017-content-1.jpg)

除了分表外，列举了面对海量数据业务的一些常见优化手段

- 缓存加速
- 读写分离
- 垂直拆分
- 分库分表
- 冷热数据分离
- ES助力复杂搜索
- NoSQL
- NewSQL



> 分表后ID如何保证全局唯一

分库分表后，多张表共用一套全局id，原来单表主键自增方式满足不了要求。

我们需要重新设计一套id生成器。

特点：全局唯一、高性能、高可用、方便接入。

- UUID
- 数据库自增ID
- 数据库的号段模式，每个业务定义起始值、步长，一次拉取多个id号码
- 基于Redis，通过`incr`命令实现ID的原子性自增。
- 雪花算法（Snowflake）
- 市面的一些开源框架，如：百度（uid-generator），美团（Leaf）， 滴滴（Tinyid）等



> 分表后可能遇到的问题

![分库分表集群架构](/images/content/databases-017-content-2.jpg)

分表后，与单表的最大区别是有分表键`sharding_key`，用来路由具体的物理表，以电商为例，有买家和卖家两个维度，以`buyer_id`路由，无法满足卖家的需求，反之同样道理。如何解决？

- 分买家库和卖家库，将买家库做为写库，保存完整的数据关系。同时将数据异构同步一份到卖家库，卖家库可以只存储`seller_id，order_id，buyer_id` 等几个简单关系字段即可，以`seller_id`作为分表键
- 多线程扫描，分段查找，然后再聚合结果
- 另外也可以存到ES中，支持多维度复杂搜索


## 什么时候需要分库分表

分库分表不是银弹，引入后会带来极大的运维和开发复杂度。只有在单库单表确实扛不住时才应考虑。以下是一些常见的决策参考指标：

| 指标 | 建议阈值 | 说明 |
|------|----------|------|
| 单表行数 | > 2000万行 | MySQL单表超过2000万行后，B+树索引层级增加，查询性能明显下降 |
| 单库QPS | > 5000 | 单库读写QPS持续超过5000，CPU和IO压力增大 |
| 单表数据量 | > 10GB | 表文件过大，备份恢复耗时剧增 |
| 单实例磁盘 | > 500GB | 单实例磁盘即将打满 |

**决策流程：**

```
单表数据量是否超过2000万？
├── 否 → 暂不分表，先优化索引、SQL
└── 是 → 是否能通过缓存/读写分离解决？
    ├── 是 → 优先使用缓存/读写分离
    └── 否 → 数据量大导致慢查询？→ 分表
            → 写QPS过高？→ 分库
            → 都是？→ 分库 + 分表
```


## 分片策略详解

分片（Sharding）是将数据按照某个规则分散到多个物理表或库中的过程。常见的分片策略有以下几种：

### 范围分片（Range Sharding）

按某个字段的范围进行分片，例如按时间范围、按ID区间。

- **优点**：天然支持范围查询，扩容方便（追加新分片即可）
- **缺点**：容易产生热点问题，最新分片压力集中

### 哈希分片（Hash Sharding）

对分片键取哈希后再取模，例如 `shard_id = hash(user_id) % N`。

- **优点**：数据分布均匀，不易产生热点
- **缺点**：扩容时需要大量数据迁移（N变化后大部分数据需要重新分配），不支持范围查询

### 一致性哈希（Consistent Hashing）

将哈希值空间组织成一个虚拟环，节点和数据都映射到环上，数据顺时针找到最近的节点。

- **优点**：扩容/缩容时只影响相邻节点，数据迁移量小
- **缺点**：实现复杂，存在数据倾斜问题（可通过虚拟节点解决）

**三种策略对比：**

| 特性 | 范围分片 | 哈希分片 | 一致性哈希 |
|------|----------|----------|------------|
| 数据均匀度 | 低 | 高 | 中（虚拟节点后高） |
| 范围查询 | ✅ 支持 | ❌ 不支持 | ❌ 不支持 |
| 扩容成本 | 低 | 高（全量迁移） | 低（部分迁移） |
| 实现复杂度 | 低 | 低 | 中 |
| 热点问题 | 有 | 无 | 无 |

**范围分片代码示例（PHP）：**

```php
<?php
/**
 * 范围分片实现 - 按订单ID区间分表
 * 0~1000万 -> t_order_0, 1000万~2000万 -> t_order_1, ...
 */
class RangeSharding
{
    private int $shardSize = 10000000; // 每张表1000万条

    public function getShardIndex(int $shardingKey): int
    {
        return intdiv($shardingKey, $shardSize);
    }

    public function getTableName(int $shardingKey): string
    {
        return 't_order_' . $this->getShardIndex($shardingKey);
    }

    public function getShardRange(int $shardIndex): array
    {
        return [
            $shardIndex * $shardSize,
            ($shardIndex + 1) * $shardSize - 1,
        ];
    }
}

$sharding = new RangeSharding();
echo $sharding->getTableName(5000000);  // t_order_0
echo $sharding->getTableName(25000000); // t_order_2
```

**哈希分片代码示例（PHP）：**

```php
<?php
/**
 * 哈希分片实现 - 按user_id取模路由到不同分库
 */
class HashSharding
{
    private int $databaseCount;
    private int $tableCount;

    public function __construct(int $databaseCount = 4, int $tableCount = 16)
    {
        $this->databaseCount = $databaseCount;
        $this->tableCount = $tableCount;
    }

    public function route(int $shardingKey): array
    {
        $hash = crc32((string) $shardingKey);
        $dbIndex = $hash % $this->databaseCount;
        $tableIndex = $hash % $this->tableCount;
        return [
            'database' => "db_order_{$dbIndex}",
            'table'    => "t_order_{$tableIndex}",
        ];
    }
}

$sharding = new HashSharding(databaseCount: 4, tableCount: 16);
$route = $sharding->route(123456789);
print_r($route);
// Array ( [database] => db_order_3 [table] => t_order_9 )
```

**一致性哈希代码示例（PHP）：**

```php
<?php
/**
 * 一致性哈希实现（含虚拟节点）
 */
class ConsistentHash
{
    private array $ring = [];        // hash => node
    private array $nodes = [];       // 物理节点列表
    private int $virtualNodeCount;   // 每个节点的虚拟节点数

    public function __construct(array $nodes, int $virtualNodeCount = 150)
    {
        $this->virtualNodeCount = $virtualNodeCount;
        foreach ($nodes as $node) {
            $this->addNode($node);
        }
    }

    public function addNode(string $node): void
    {
        $this->nodes[] = $node;
        for ($i = 0; $i < $this->virtualNodeCount; $i++) {
            $hash = crc32("{$node}#{$i}");
            $this->ring[$hash] = $node;
        }
        ksort($this->ring);
    }

    public function removeNode(string $node): void
    {
        $this->nodes = array_values(array_diff($this->nodes, [$node]));
        for ($i = 0; $i < $this->virtualNodeCount; $i++) {
            $hash = crc32("{$node}#{$i}");
            unset($this->ring[$hash]);
        }
    }

    public function lookup($key): string
    {
        $hash = crc32((string) $key);
        // 找到第一个 >= $hash 的虚拟节点
        foreach ($this->ring as $ringHash => $node) {
            if ($ringHash >= $hash) {
                return $node;
            }
        }
        // 环形回绕到第一个节点
        return reset($this->ring);
    }
}

// 使用示例
$ch = new ConsistentHash(['db-0', 'db-1', 'db-2']);
echo $ch->lookup(12345);  // 输出某个 db-X

// 缩容：移除 db-2，只影响相邻数据
$ch->removeNode('db-2');
echo $ch->lookup(12345);
```

### 跨分片查询策略详解

分表后不带分片键的查询是最大的性能隐患。以下是常见的解决方案与代码示例：

**1. 映射表方案（Mapping Table）**

```sql
-- 建立 order_id -> user_id 的映射表（不分表或单独分片）
CREATE TABLE t_order_mapping (
    order_id BIGINT PRIMARY KEY,
    user_id  INT NOT NULL,
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB;

-- 查询时先通过映射表找到 user_id，再路由到具体分片
SELECT user_id FROM t_order_mapping WHERE order_id = 123456789;
-- 结果: user_id = 42
-- 然后查询: SELECT * FROM db_order_0.t_order_42 WHERE order_id = 123456789;
```

**2. 二次查询法（分页场景）**

```php
<?php
/**
 * 二次查询法 - 跨分片分页
 * 示例：查询第100000页，每页10条 → ORDER BY create_time DESC LIMIT 100000, 10
 */
class CrossShardPagination
{
    public function secondPassQuery(
        array $shards,
        int $offset,
        int $limit,
        string $orderBy
    ): array {
        // 第一步：每个分片执行精简查询，收集排序列的最大/最小值
        $allTimes = [];
        foreach ($shards as $shard) {
            $sql = "SELECT MIN(create_time) AS min_time,
                           MAX(create_time) AS max_time
                    FROM {$shard}
                    ORDER BY {$orderBy} DESC";
            // $minTime, $maxTime = ... 执行SQL
            $allTimes[] = ['min' => $minTime, 'max' => $maxTime, 'shard' => $shard];
        }

        // 第二步：根据分片数估算每片数据量
        $totalShards = count($shards);
        $perShardOffset = intdiv($offset, $totalShards);
        $candidates = [];

        foreach ($shards as $shard) {
            $sql = "SELECT * FROM {$shard}
                    ORDER BY {$orderBy} DESC
                    LIMIT {$perShardOffset}, {$limit}";
            $candidates = array_merge($candidates, /* 执行SQL结果 */);
        }

        // 第三步：内存中排序取最终结果
        usort($candidates, fn($a, $b) => strcmp($b['create_time'], $a['create_time']));
        return array_slice($candidates, 0, $limit);
    }
}
```

**3. 绑定表方案（Bound Table）**

```yaml
# ShardingSphere 绑定表配置
# 订单表和订单明细表使用相同的分片策略，避免跨库JOIN
tables:
  t_order:
    actual-data-nodes: ds$->{0..1}.t_order_$->{0..3}
    database-strategy:
      standard:
        sharding-column: user_id
        sharding-algorithm-name: db-mod
    table-strategy:
      standard:
        sharding-column: order_id
        sharding-algorithm-name: table-mod
  t_order_item:
    actual-data-nodes: ds$->{0..1}.t_order_item_$->{0..3}
    database-strategy:
      standard:
        sharding-column: user_id  # 与 t_order 相同
        sharding-algorithm-name: db-mod
    table-strategy:
      standard:
        sharding-column: order_id  # 与 t_order 相同
        sharding-algorithm-name: table-mod
# 绑定表关系：JOIN 只在同一物理节点内执行
binding-tables:
  - t_order, t_order_item
```

### 雪花算法 PHP 实现

```php
<?php
/**
 * 雪花算法（Snowflake）PHP 实现
 * 生成 64 位全局唯一递增 ID
 */
class Snowflake
{
    private int $datacenterId;
    private int $workerId;
    private int $sequence = 0;
    private int $lastTimestamp = -1;

    // 各部分占位
    private const WORKER_ID_BITS    = 5;
    private const DATACENTER_ID_BITS = 5;
    private const SEQUENCE_BITS     = 12;

    // 最大值
    private const MAX_WORKER_ID     = 31;    // 2^5 - 1
    private const MAX_DATACENTER_ID = 31;
    private const SEQUENCE_MASK     = 4095;  // 2^12 - 1

    // 位移
    private const WORKER_SHIFT     = 12;
    private const DATACENTER_SHIFT = 17;
    private const TIMESTAMP_SHIFT  = 22;

    // 起始时间戳 2021-01-01 00:00:00 UTC (毫秒)
    private const EPOCH = 1609459200000;

    public function __construct(int $datacenterId, int $workerId)
    {
        if ($datacenterId < 0 || $datacenterId > self::MAX_DATACENTER_ID) {
            throw new \InvalidArgumentException("datacenterId 须在 0~31 之间");
        }
        if ($workerId < 0 || $workerId > self::MAX_WORKER_ID) {
            throw new \InvalidArgumentException("workerId 须在 0~31 之间");
        }
        $this->datacenterId = $datacenterId;
        $this->workerId = $workerId;
    }

    public function nextId(): int
    {
        $timestamp = $this->currentTimeMillis();

        if ($timestamp < $this->lastTimestamp) {
            throw new \RuntimeException(
                "时钟回拨，拒绝生成 ID（回拨 {$this->lastTimestamp}ms）"
            );
        }

        if ($timestamp === $this->lastTimestamp) {
            $this->sequence = ($this->sequence + 1) & self::SEQUENCE_MASK;
            if ($this->sequence === 0) {
                $timestamp = $this->waitNextMillis($this->lastTimestamp);
            }
        } else {
            $this->sequence = 0;
        }

        $this->lastTimestamp = $timestamp;

        return (($timestamp - self::EPOCH) << self::TIMESTAMP_SHIFT)
             | ($this->datacenterId << self::DATACENTER_SHIFT)
             | ($this->workerId << self::WORKER_SHIFT)
             | $this->sequence;
    }

    private function currentTimeMillis(): int
    {
        return (int) (microtime(true) * 1000);
    }

    private function waitNextMillis(int $lastTimestamp): int
    {
        $ts = $this->currentTimeMillis();
        while ($ts <= $lastTimestamp) {
            $ts = $this->currentTimeMillis();
        }
        return $ts;
    }
}

// 使用示例
$snowflake = new Snowflake(datacenterId: 1, workerId: 1);
echo $snowflake->nextId() . "\n"; // 1392004890234880000 (示例)
```




## 中间件选型

分库分表通常需要借助中间件来屏蔽底层分片细节，主流方案对比：

| 特性 | ShardingSphere | MyCat | Vitess | ProxySQL |
|------|----------------|-------|--------|----------|
| 语言 | Java | Java | Go | C++ |
| 接入方式 | JDBC/Proxy | Proxy | Proxy | Proxy |
| 分片策略 | 丰富（范围、哈希、复合等） | 支持常见策略 | 自动分片 | 需自定义规则 |
| 分布式事务 | XA/Seata/Saga | XA | 2PC | 不原生支持 |
| 读写分离 | ✅ | ✅ | ✅ | ✅（核心功能） |
| 数据加密 | ✅ | ❌ | ❌ | ❌ |
| 弹性伸缩 | ✅ | ❌ | ✅ | 需手动 |
| 社区活跃度 | ★★★★★ | ★★☆☆☆ | ★★★★☆ | ★★★★☆ |
| 适用场景 | Java生态，功能全面 | 快速接入，中小项目 | 大规模MySQL集群（YouTube出品） | 读写分离为主，轻量分片 |

**建议**：Java项目优先选择ShardingSphere（生态完善、功能丰富），大规模MySQL集群可考虑Vitess，MyCat适合快速验证场景。以读写分离和查询路由为主的场景，ProxySQL是轻量级首选。

### ShardingSphere 配置示例

ShardingSphere-JDBC（Java项目内嵌方式），`application.yml` 配置：

```yaml
# ShardingSphere-JDBC 分片配置（Spring Boot）
spring:
  shardingsphere:
    datasource:
      names: ds0,ds1
      ds0:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://192.168.1.10:3306/db_order_0
        username: root
        password: root
      ds1:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://192.168.1.11:3306/db_order_1
        username: root
        password: root
    rules:
      sharding:
        tables:
          t_order:
            actual-data-nodes: ds$->{0..1}.t_order_$->{0..3}
            database-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: db-hash
            table-strategy:
              standard:
                sharding-column: order_id
                sharding-algorithm-name: table-hash
        sharding-algorithms:
          db-hash:
            type: HASH_MOD
            props:
              sharding-count: 2
          table-hash:
            type: HASH_MOD
            props:
              sharding-count: 4
    props:
      sql-show: true
```

### Vitess 配置示例

Vitess 使用 VSchema 定义分片规则，`vschema.json`：

```json
{
  "sharded": true,
  "vindexes": {
    "hash_user_id": {
      "type": "hash"
    }
  },
  "tables": {
    "t_order": {
      "column_vindexes": [
        { "column": "user_id", "name": "hash_user_id" }
      ],
      "auto_increment": {
        "column": "order_id",
        "sequence": "order_seq"
      }
    }
  }
}
```

启动分片集群：

```bash
# 初始化两个分片（shard 80- 和 80+）
vtctldclient CreateShards --force commerce/-80 commerce/80-
# 应用 VSchema
vtctldclient ApplyVSchema --vschema-file vschema.json commerce
```

### MyCat 配置示例

MyCat 使用 XML 配置文件，`schema.xml` + `rule.xml`：

```xml
<!-- schema.xml -->
<schema name="order_db" checkSQLschema="false" sqlMaxLimit="100">
  <table name="t_order" dataNode="dn1,dn2,dn3,dn4" rule="mod-long">
    <childTable name="t_order_item" joinKey="order_id" parentKey="order_id" />
  </table>
</schema>

<dataNode name="dn1" dataHost="host1" database="order_db_0" />
<dataNode name="dn2" dataHost="host1" database="order_db_1" />
<dataNode name="dn3" dataHost="host2" database="order_db_2" />
<dataNode name="dn4" dataHost="host2" database="order_db_3" />

<dataHost name="host1" maxCon="1000" minCon="10" balance="1"
          writeType="0" dbType="mysql" dbDriver="native">
  <heartbeat>select user()</heartbeat>
  <writeHost host="master1" url="192.168.1.10:3306" user="root" password="root">
    <readHost host="slave1" url="192.168.1.12:3306" user="root" password="root" />
  </writeHost>
</dataHost>

<!-- rule.xml 中 mod-long 规则 -->
<tableRule name="mod-long">
  <rule>
    <columns>user_id</columns>
    <algorithm>mod-long</algorithm>
  </rule>
</tableRule>
<function name="mod-long" class="io.mycat.route.function.PartitionByMod">
  <property name="count">4</property>
</function>
```


## 雪花算法详解

雪花算法（Snowflake）是Twitter开源的分布式ID生成算法，生成64位长整型ID，结构如下：

```
0 | 00000000 00000000 00000000 00000000 00000000 0 | 00000 | 00000 | 000000000000
符号位(1) |       时间戳(41位)                     | 数据中心(5位) | 机器ID(5位) | 序列号(12位)
```

- **符号位**：1位，始终为0（正数）
- **时间戳**：41位，毫秒级，可用约69年
- **数据中心ID**：5位，支持32个数据中心
- **机器ID**：5位，每个数据中心支持32台机器
- **序列号**：12位，同一毫秒内可生成4096个ID

**Python实现示例：**

```python
import time

class Snowflake:
    def __init__(self, datacenter_id, worker_id):
        self.datacenter_id = datacenter_id
        self.worker_id = worker_id
        self.sequence = 0
        self.last_timestamp = -1
        self.epoch = 1609459200000  # 2021-01-01 00:00:00 UTC

    def _current_millis(self):
        return int(time.time() * 1000)

    def next_id(self):
        timestamp = self._current_millis()
        if timestamp == self.last_timestamp:
            self.sequence = (self.sequence + 1) & 0xFFF  # 4095
            if self.sequence == 0:
                timestamp = self._wait_next_millis(timestamp)
        else:
            self.sequence = 0

        if timestamp < self.last_timestamp:
            raise Exception("时钟回拨，拒绝生成ID")

        self.last_timestamp = timestamp

        id_val = ((timestamp - self.epoch) << 22) | \
                 (self.datacenter_id << 17) | \
                 (self.worker_id << 12) | \
                 self.sequence
        return id_val

    def _wait_next_millis(self, timestamp):
        while timestamp <= self.last_timestamp:
            timestamp = self._current_millis()
        return timestamp

# 使用示例
snowflake = Snowflake(datacenter_id=1, worker_id=1)
print(snowflake.next_id())  # 输出: 类似 1392004890234880000
```

**注意事项**：雪花算法强依赖机器时钟，如果发生时钟回拨，可能产生重复ID。生产环境建议使用百度uid-generator或美团Leaf等成熟方案。


## 踩坑案例

### 跨分片查询

分表后，不带分片键的查询需要遍历所有分片，性能极差。

**解决方案：**
- 通过分片键路由，避免全表扫描
- 建立异构索引表：将需要查询的字段单独建一张索引表，以查询条件作为分片键
- 将多维度查询需求同步到ES等搜索引擎

### 分布式事务

跨库事务是最棘手的问题之一，常见方案对比：

| 方案 | 原理 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|------|--------|------|--------|----------|
| 2PC（两阶段提交） | 准备阶段 + 提交阶段 | 强一致 | 低 | 低 | 同构数据库，对性能要求不高 |
| TCC（Try-Confirm-Cancel） | 业务层面实现三阶段 | 最终一致 | 高 | 高 | 资金交易等核心场景 |
| Saga | 将大事务拆成多个本地事务+补偿操作 | 最终一致 | 高 | 中 | 长事务，业务可补偿 |
| 本地消息表 | 利用本地事务+消息队列 | 最终一致 | 高 | 中 | 异步场景 |

**建议**：非核心链路优先使用Saga或本地消息表方案；资金等强一致场景使用TCC；Seata框架对2PC和Saga都有良好支持。

### 分页查询问题

分表后分页查询变成难题。例如 `ORDER BY id LIMIT 100000, 10`，需要在每个分片上都执行排序和分页，然后在内存中合并再取全局的第100000~1000010条记录。

**解决方案：**
- **禁止跳页**：只允许上一页/下一页，记录上次查询的最大ID作为起点（游标分页）
- **二次查询法**：先在每个分片上查询 `LIMIT offset/N, size`，取最小值作为基准再精确查询
- **汇总到搜索引擎**：将数据同步到ES，利用ES的分页能力

### 其他常见问题

- **全局排序**：跨分片排序需要汇总所有分片数据后在内存中排序，建议加分片键条件缩小范围
- **JOIN操作**：跨分片无法直接JOIN，需要在应用层组装或使用绑定表（相同的分片策略）
- **非分片键查询**：需要扫描全部分片，建议建立映射关系或使用搜索引擎兜底
- **扩容迁移**：哈希分片扩容时需要数据迁移，建议提前规划好分片数量，或者使用一致性哈希


## 真实案例：电商平台分库分表迁移实战

### 背景

某电商平台订单表单表数据量突破 5000 万，查询 P99 延迟从 50ms 飙升至 800ms，每天新增订单 200 万条。原有单库单表架构已无法满足业务增长，决定进行分库分表迁移。

### 迁移方案

**阶段一：评估与选型**

- 读 QPS：12000/s，写 QPS：3000/s
- 分片键选择：`user_id`（80% 查询以 user_id 为条件）
- 中间件选型：ShardingSphere-JDBC（团队 Java 技术栈成熟）
- 分片策略：4 库 × 16 表 = 64 张分表，哈希分片

**阶段二：双写过渡期（约 2 周）**

```
应用层
├── 写入：同时写入旧库 + 新分片库（双写）
├── 读取：先读新库，fallback 读旧库
└── 对账：每小时对账脚本，比对新旧数据一致性
```

```php
<?php
/**
 * 双写过渡期代码示意
 */
class OrderRepository
{
    private OldOrderDao $oldDao;
    private NewShardingOrderDao $newDao;

    public function insert(Order $order): int
    {
        // 1. 写入新分片库（主路径）
        $newId = $this->newDao->insert($order);
        $order->id = $newId;

        // 2. 异步写入旧库（兼容未切换的读操作）
        try {
            $this->oldDao->insert($order);
        } catch (\Throwable $e) {
            // 写入失败日志，后续对账补偿
            Log::error('双写旧库失败', ['order_id' => $order->id, 'error' => $e->getMessage()]);
        }

        return $newId;
    }

    public function findByUser(int $userId, int $page = 1, int $size = 20): array
    {
        try {
            // 优先从新库读取
            return $this->newDao->findByUser($userId, $page, $size);
        } catch (\Throwable $e) {
            // 降级到旧库
            return $this->oldDao->findByUser($userId, $page, $size);
        }
    }
}
```

**阶段三：全量迁移与切读（约 1 周）**

- 使用 DataX 进行全量数据迁移（3 小时完成约 5000 万条数据）
- 通过 binlog 增量同步工具（Canal）保持数据一致性
- 切换读流量到新分片库，观察 3 天
- 停止双写，下线旧库

**阶段四：收尾**

- 清理冗余数据，回收旧库资源
- 压测验证：新架构 P99 延迟降至 35ms，QPS 容量提升 8 倍
- 总结复盘文档，沉淀为团队知识库

### 关键经验

1. **分片键选择至关重要**：80% 查询命中 user_id，迁移后查询性能显著提升
2. **双写期间务必对账**：发现 0.003% 的数据不一致（异步写入超时），全部通过补偿脚本修复
3. **灰度切流比一刀切更安全**：先切 10% 读流量，观察 2 小时无异常后逐步扩大
4. **提前做好回滚预案**：保留旧库 30 天，万一新架构出现问题可以快速切回




## 相关阅读

- [MySQL-分库分表实战-30-仓库数据库拆分经验与踩坑记录](/categories/Databases/sharding-30-repos/)
- [ShardingSphere-Proxy 分库分表实战：Laravel 订单中心按用户路由、全局 ID 与跨片查询降级踩坑记录](/categories/Databases/shardingsphere-proxy-shardingguide-laravel-idqueryfallback/)
- [SQL语句性能分析工具 - explain](/categories/Databases/explain/)
- [百万级数据表查询优化实战-Laravel-B2C-API-EXPLAIN-深度分析索引重构与分页治理踩坑记录](/categories/Databases/query-optimization-explain/)
- [MySQL主键](/categories/Databases/primary-key/)