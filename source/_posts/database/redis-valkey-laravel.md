---

title: Redis 8.0 Valkey 分叉深度对比：2026 年 Redis 生态分裂后的选型决策——性能基准、功能差异与 Laravel 兼容性
keywords: [Redis, Valkey, Laravel, 分叉深度对比, 生态分裂后的选型决策, 性能基准, 功能差异与, 兼容性]
date: 2026-06-07 17:39:00
tags:
- Redis
- Valkey
- 开源分叉
- 选型
- Laravel
- 性能基准
- sspl
- 向量搜索
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: 2026年Redis 8.0与Valkey分叉深度对比：许可证SSPL vs BSD差异、42维度功能矩阵逐项PK、多线程I/O性能基准测试（Valkey吞吐+11%）、向量搜索实战方案、Redis Stack模块兼容性踩坑记录。面向Laravel开发者，提供Sentinel/Cluster实战配置、版本迁移Checklist与2026-2027选型决策框架，覆盖AWS ElastiCache、Azure Cache等云厂商格局分析。
---



## 引言：一场许可证引发的生态地震

2024 年 3 月，Redis Ltd. 宣布将 Redis 的许可证从 BSD 切换为 **Redis Source Available License (RSAL v2) + Server Side Public License (SSPL)**，彻底关闭了云厂商"白嫖"Redis 代码提供托管服务的大门。这一决定如同一颗深水炸弹——Linux Foundation 迅速以 Redis 7.2.4 为基线 fork 出 **Valkey**，AWS、Google Cloud、Oracle 等巨头纷纷站队。两年后的今天，Redis 8.0 与 Valkey 8.x 已经走向截然不同的技术路线，"选 Redis 还是 Valkey"成为每个后端架构师必须回答的问题。

本文将从**历史脉络、功能对比、性能基准、模块生态、许可证影响、云厂商格局、Laravel 兼容性**七大维度深度剖析，给出面向 2026-2027 年的选型决策框架。

---

## 一、分裂始末：从 BSD 到 SSPL 的关键时间线

| 时间 | 事件 |
|------|------|
| 2009 | Redis 诞生，BSD 许可证，Salvatore Sanfilippo 主导 |
| 2021 | Redis Ltd. 完成融资，商业化加速，推出 Redis Stack |
| 2024-03 | Redis 许可证切换为 RSAL v2 + SSPL，限制云厂商托管 |
| 2024-03 | Linux Foundation 宣布 fork **Valkey**，基于 Redis 7.2.4 |
| 2024-04 | AWS 宣布 ElastiCache for Redis 后续版本将切换至 Valkey 引擎 |
| 2024-06 | Google Cloud Memorystore 宣布支持 Valkey |
| 2025-05 | Redis 8.0 GA 发布，引入 Redis Data Integration、HashiCorp Vault 集成等企业特性 |
| 2025-11 | Valkey 8.0 GA 发布，聚焦多线程 I/O 与集群性能优化 |
| 2026-Q1 | AWS ElastiCache 默认引擎切换为 Valkey；Redis 8.1 进入 RC |

分裂的核心矛盾在于：**Redis Ltd. 认为云厂商无偿利用开源代码获利**，而社区和云厂商认为 **BSD 许可证下的 fork 权利不可剥夺**。双方都有道理，但结果是生态被一分为二。

---

## 二、功能对比表：Redis 7.x vs Redis 8.x vs Valkey 8.x

| 特性 | Redis 7.x (BSD) | Redis 8.x (SSPL) | Valkey 8.x (BSD) |
|------|-----------------|-------------------|-------------------|
| **核心数据结构** | ✅ 全部 | ✅ 全部 | ✅ 全部 |
| **多线程 I/O** | 实验性 | 生产就绪 | ✅ 增强版，per-shard 线程 |
| **Redis Functions** | ✅ | ✅ | ✅ |
| **Pub/Sub Sharding** | ❌ | ✅ | ✅ |
| **Hash Field Expiry** | ❌ | ✅ | ✅（8.0 独立实现） |
| **JSON 原生支持** | Redis Stack | ✅ 内置 | ❌ 需模块 |
| **Vector Search** | Redis Stack | ✅ 内置 | 社区模块开发中 |
| **Time Series** | Redis Stack | ✅ 内置 | 社区模块 |
| **Redis Data Integration** | ❌ | ✅ 企业功能 | ❌ |
| **ACL v2** | ✅ | ✅ 增强 | ✅ |
| **Cluster Slots v2** | ✅ | ✅ | ✅ 改进的 gossip |
| **Sentinel** | ✅ | ✅ | ✅ |

> **关键差异**：Redis 8.x 将原 Redis Stack 模块（JSON、Search、TimeSeries、Bloom、Gears）全部内置，形成"一体化"路线；Valkey 8.x 则保持精简内核 + 可插拔模块的设计哲学。

---

## 三、功能矩阵全景对比：42 维度逐项 PK

为了帮助团队做出更精确的选型决策，以下表格从 **数据结构、持久化、集群、安全、监控、AI/ML** 六大维度逐项对比 Redis 8.0 与 Valkey 8.1：

### 3.1 数据结构与命令兼容性

| 功能 | Redis 8.0 | Valkey 8.1 | 备注 |
|------|-----------|------------|------|
| String / Hash / List / Set / ZSet | ✅ | ✅ | 完全兼容 |
| Stream | ✅ | ✅ | XREAD / XADD 等全部对齐 |
| Bitmap / Bitfield | ✅ | ✅ | — |
| GEO | ✅ | ✅ | — |
| Hash Field TTL（`HEXPIRE`） | ✅ 原生 | ✅ 独立实现 | 命令语法一致 |
| `OBJECT ENCODING` | ✅ | ✅ | — |
| `WAIT` / `WAITAOF` | ✅ | ✅ | Valkey 8.1 增加 `WAITAOF` |
| JSON 类型（`JSON.SET` / `JSON.GET`） | ✅ 内置 | ⚠️ 需 `valkey-json` 模块 | API 覆盖约 70% |
| 向量搜索（`FT.CREATE` / `FT.SEARCH`） | ✅ 内置 RediSearch | ❌ 社区移植中 | Redis 优势明显 |
| TimeSeries（`TS.ADD` / `TS.RANGE`） | ✅ 内置 | ⚠️ 社区模块 | 功能基本对齐 |
| Bloom / Cuckoo / T-Digest | ✅ 内置 | ⚠️ 社区模块 | 功能对齐 |
| RedisGears（服务端编排） | ✅ 内置 | ❌ 无替代 | Valkey 不支持 |

### 3.2 持久化与复制

| 功能 | Redis 8.0 | Valkey 8.1 | 备注 |
|------|-----------|------------|------|
| RDB 快照 | ✅ | ✅ | — |
| AOF（append-only file） | ✅ | ✅ | — |
| AOF Rewrite 优化 | ✅ | ✅ 更优的 fsync 策略 | Valkey 减少了 rewrite 期间的延迟毛刺 |
| 混合持久化 | ✅ | ✅ | — |
| PSYNC2 部分重同步 | ✅ | ✅ | — |
| Diskless Replication | ✅ | ✅ | — |

### 3.3 集群与高可用

| 功能 | Redis 8.0 | Valkey 8.1 | 备注 |
|------|-----------|------------|------|
| Redis Cluster | ✅ | ✅ | — |
| Cluster 自动 Failover | ✅ | ✅ | Valkey gossip 优化，resharding 快 32% |
| Sentinel | ✅ | ✅ | 协议完全兼容 |
| Pub/Sub Sharding（Sharded Pub/Sub） | ✅ | ✅ | — |
| Cluster Bus 协议 v2 | ✅ | ✅ 改进 | Valkey 降低了大规模集群的 gossip 带宽 |

### 3.4 安全与访问控制

| 功能 | Redis 8.0 | Valkey 8.1 | 备注 |
|------|-----------|------------|------|
| ACL v2（`ACL SETUSER`） | ✅ | ✅ | — |
| TLS / mTLS | ✅ | ✅ | — |
| HashiCorp Vault 集成 | ✅ 企业功能 | ❌ | Redis 独有 |
| 审计日志 | ✅ Enterprise | ❌ | 需商业版 |

### 3.5 AI / ML 与向量搜索

| 功能 | Redis 8.0 | Valkey 8.1 | 备注 |
|------|-----------|------------|------|
| HNSW 向量索引 | ✅ 内置 | ❌ 社区模块开发中 | 2027 预计可用 |
| FLAT 向量索引 | ✅ 内置 | ❌ | — |
| 向量相似度搜索（余弦/欧氏/IP） | ✅ 内置 | ❌ | — |
| 向量 + 全文混合搜索 | ✅ 内置 | ❌ | Redis 独有优势 |
| `VECTOR.SIMILARITY` 命令 | ✅ | ❌ | — |

### 3.6 管理与可观测性

| 功能 | Redis 8.0 | Valkey 8.1 | 备注 |
|------|-----------|------------|------|
| `INFO` 全部 section | ✅ | ✅ 增加 `INFO CLIENTS` 细节 | — |
| `SLOWLOG` | ✅ | ✅ | — |
| `LATENCY` 监控 | ✅ | ✅ | — |
| `DEBUG` 命令 | ✅ | ✅ | — |
| RedisInsight GUI | ✅ 官方 | ✅ 兼容（通用协议） | 可连接两者 |
| Redis Data Integration (RDI) | ✅ 企业功能 | ❌ | 数据管道 CDC |
| Prometheus 指标导出 | ✅ | ✅ | — |

---

## 四、性能基准：Redis 8.0 vs Valkey 8.1

以下数据基于 2026 年 Q1 社区公开的基准测试（6 节点集群，`r7g.2xlarge`，100 并发连接）：

| 指标 | Redis 8.0 | Valkey 8.1 | 差异 |
|------|-----------|------------|------|
| **GET/SET 吞吐量 (ops/s)** | 1.28M | 1.42M | Valkey +11% |
| **P99 延迟 (μs)** | 892 | 743 | Valkey -17% |
| **Pipeline 100 批量吞吐** | 4.6M | 5.1M | Valkey +11% |
| **Cluster Resharding 耗时** | 28s | 19s | Valkey -32% |
| **内存效率 (10M keys)** | 1.82 GB | 1.76 GB | Valkey -3% |
| **Pub/Sub 扇出 (1000 subscribers)** | 890K msg/s | 1.02M msg/s | Valkey +15% |

Valkey 的性能优势主要来自 **per-shard 多线程 I/O 架构**——它将每个 hash slot 绑定独立的 I/O 线程，避免了 Redis 8.0 中共享线程池的锁竞争。Redis 8.0 的优势则在于 **内置模块的深度优化**，当使用 JSON Path 查询或向量搜索时，Redis 8.0 因为模块与内核紧密耦合，延迟低 20-30%。

---

## 五、向量搜索实战对比：Redis 8.0 vs Valkey 方案

向量搜索是 2026 年 AI 应用的核心需求，以下对比两者在实际场景中的实现差异：

### 5.1 Redis 8.0 原生向量搜索

Redis 8.0 将 RediSearch 模块内置，原生支持 HNSW 和 FLAT 索引：

```python
import redis
import numpy as np
from redis.commands.search.field import VectorField, TagField, TextField
from redis.commands.search.index_definition import IndexDefinition
from redis.commands.search.query import Query

# 连接 Redis 8.0
r = redis.Redis(host='localhost', port=6379, decode_responses=False)

# 创建向量索引（1536 维，对应 OpenAI text-embedding-3-small）
schema = (
    VectorField(
        'embedding',
        'HNSW',
        {
            'TYPE': 'FLOAT32',
            'DIM': 1536,
            'DISTANCE_METRIC': 'COSINE',
            'INITIAL_CAP': 100000,
            'M': 16,
            'EF_CONSTRUCTION': 200,
        }
    ),
    TagField('category'),
    TextField('content'),
)

r.ft('docs').create_index(
    fields=schema,
    definition=IndexDefinition(prefix=['doc:'])
)

# 插入向量数据
embedding = np.random.rand(1536).astype(np.float32).tobytes()
r.hset('doc:001', mapping={
    'embedding': embedding,
    'category': 'tech',
    'content': 'Redis 8.0 支持原生向量搜索',
})

# 向量相似度查询
query_embedding = np.random.rand(1536).astype(np.float32).tobytes()
query = (
    Query('(@category:{tech})=>[KNN 5 @embedding $vec AS score]')
    .sort_by('score')
    .return_fields('content', 'score')
    .dialect(2)
)
params = {'vec': query_embedding}
results = r.ft('docs').search(query, query_params=params)
for doc in results.docs:
    print(f"Score: {doc.score}, Content: {doc.content}")
```

### 5.2 Valkey + 外部向量搜索引擎

Valkey 暂无内置向量搜索，需结合外部方案（以 Meilisearch + Valkey 缓存为例）：

```python
import redis  # 使用 redis-py 连接 Valkey（协议兼容）
import meilisearch
import numpy as np

# 连接 Valkey（redis-py 完全兼容）
valkey = redis.Redis(host='localhost', port=6379, decode_responses=True)

# 向量索引存储在 Meilisearch
meili = meilisearch.Client('http://localhost:7700', 'master-key')
index = meili.index('documents')

# 缓存策略：先查 Valkey 缓存，miss 再查 Meilisearch
def vector_search(query_text: str, top_k: int = 5):
    cache_key = f'vector_search:{hash(query_text)}:{top_k}'

    # 1. 先查 Valkey 缓存
    cached = valkey.get(cache_key)
    if cached:
        return json.loads(cached)

    # 2. 查询 Meilisearch
    results = index.search(query_text, {
        'limit': top_k,
        'attributesToRetrieve': ['content', 'category'],
    })

    # 3. 写入 Valkey 缓存（TTL 5 分钟）
    valkey.setex(cache_key, 300, json.dumps(results))

    return results
```

### 5.3 向量搜索方案选型建议

| 方案 | 延迟 | 运维复杂度 | 功能完整度 | 推荐场景 |
|------|------|-----------|-----------|---------|
| Redis 8.0 原生 | **最低**（~2ms） | 低 | 最完整（混合搜索） | RAG、语义搜索、混合检索 |
| Valkey + Meilisearch | 中等（~15ms） | 中 | 全文搜索强 | 全文为主、向量为辅 |
| Valkey + Qdrant | 中等（~10ms） | 中 | 向量搜索专精 | 纯向量场景 |
| Valkey + Milvus | 较高（~25ms） | 高 | 超大规模 | 十亿级向量 |

---

## 六、踩坑案例：版本迁移中的兼容性问题

### 6.1 踩坑 1：`JSON.MSET` 不存在

**场景**：团队从 Redis Stack 7.4 迁移到 Valkey 8.1，安装了 `valkey-json` 模块后发现 `JSON.MSET` 命令报错。

```bash
# Redis 8.0 中可执行
JSON.MSET doc:001 $.name "Alice" doc:002 $.name "Bob"

# Valkey + valkey-json 报错
(error) ERR unknown command 'JSON.MSET'
```

**原因**：`valkey-json` 模块 API 覆盖约 70%，`JSON.MSET`、`JSON.MERGE` 等批量操作尚未实现。

**解决方案**：
```php
// Laravel 中封装兼容性 helper
class JsonCacheHelper
{
    public static function multiSet(Redis $redis, array $items): void
    {
        $isValkey = str_contains($redis->info('server')['redis_version'] ?? '', 'valkey');

        if ($isValkey) {
            // Valkey: 逐个 SET
            foreach ($items as $key => $path => $value) {
                $redis->rawCommand('JSON.SET', $key, $path, json_encode($value));
            }
        } else {
            // Redis 8.0: 批量 MSET
            $args = [];
            foreach ($items as $key => $path => $value) {
                $args[] = $key;
                $args[] = $path;
                $args[] = json_encode($value);
            }
            $redis->rawCommand('JSON.MSET', ...$args);
        }
    }
}
```

### 6.2 踩坑 2：Sentinel Failover 行为差异

**场景**：从 Redis Sentinel 迁移到 Valkey Sentinel 后，Laravel Horizon 频繁断连。

**原因**：Valkey 8.1 的 Sentinel 实现优化了故障检测算法，`down-after-milliseconds` 默认值从 30000ms 调整为 10000ms，导致在高负载下误判 master 为 SDOWN。

**解决方案**：
```conf
# valkey-sentinel.conf
sentinel down-after-milliseconds mymaster 30000  # 显式设置，保持与 Redis 一致
sentinel failover-timeout mymaster 180000
sentinel parallel-syncs mymaster 1
```

### 6.3 踩坑 3：`CLIENT SETNAME` 在集群模式下的行为

**场景**：`redis-cli --cluster rebalance` 期间，已命名的客户端连接被断开。

**原因**：Valkey 8.0 引入了 per-shard 线程模型，resharding 期间需要迁移客户端连接到新的 I/O 线程，这会中断已命名的持久连接。

**解决方案**：
```php
// config/database.php
'redis' => [
    'options' => [
        'retry_on_error' => true,
        'read_timeout' => 3.0,
        // 重连后自动恢复连接名
        'parameters' => [
            'protocol' => 'resp3',
        ],
    ],
],

// app/Providers/RedisServiceProvider.php
// 在重连事件中重新设置连接名
use Illuminate\Support\Facades\Redis;

Redis::enableEvents();
Redis::listen(function ($event, $data) {
    if ($event === 'connection-restored') {
        Redis::client('default')->client('SETNAME', 'laravel-default');
    }
});
```

### 6.4 踩坑 4：Lua 脚本中的 `redis.call` vs `redis.pcall` 差异

**场景**：迁移后 Lua 脚本执行偶尔返回 `nil`。

**原因**：Valkey 8.1 对 Lua 脚本的超时检测更严格，默认 `lua-time-limit` 从 5000ms 缩短为 2000ms。超时的脚本会被 `SCRIPT KILL`，导致部分操作不完整。

**解决方案**：
```conf
# valkey.conf
lua-time-limit 5000  # 恢复到 Redis 默认值
```

```php
// 对关键 Lua 脚本增加 idempotency check
$lua = <<<LUA
    local current = redis.call('GET', KEYS[1])
    if current == ARGV[1] then
        redis.call('SET', KEYS[1], ARGV[2])
        return 1
    end
    return 0
LUA;

// 使用 EVALSHA + 脚本缓存，避免重复传输
$sha = Redis::script('LOAD', $lua);
$result = Redis::evalsha($sha, 1, $key, $oldValue, $newValue);
```

### 6.5 踩坑 5：ACL 迁移遗漏

**场景**：从 Redis 7.x 迁移 ACL 规则到 Valkey 8.1，部分命令权限丢失。

**原因**：Valkey 新增了 `HEXPIRE`、`HPERSIST`、`HPEXPIRETIME` 等 Hash 字段过期命令，但 ACL 规则中未显式授权这些命令。

**解决方案**：
```bash
# 导出 Redis ACL
redis-cli ACL SAVE

# 逐条检查并补充 Valkey 新增命令
redis-cli ACL SETUSER myapp on >password \
    ~* &* +@all \
    -@dangerous \
    +HEXPIRE +HPEXPIRE +HPERSIST +HEXPIREAT +HPEXPIREAT +HTTL +HPTTL
```

---

## 七、模块生态：分裂的最大代价

这是生态分裂中**影响最深远的部分**：

| 模块 | Redis 8.x | Valkey 8.x | 说明 |
|------|-----------|------------|------|
| **RedisJSON** | ✅ 内置 | ⚠️ 兼容层（有限） | Valkey 社区开发 `valkey-json`，但 API 覆盖约 70% |
| **RediSearch** | ✅ 内置 | ⚠️ 社区移植中 | Valkey 暂无完整替代，可用外部搜索引擎 |
| **RedisTimeSeries** | ✅ 内置 | ✅ 社区模块 | 功能基本对齐 |
| **RedisBloom** | ✅ 内置 | ✅ 社区模块 | 功能对齐 |
| **RedisGears** | ✅ 内置 | ❌ 无替代 | Valkey 不支持服务端函数编排 |
| **RedisInsight** | ✅ 官方 GUI | ✅ 兼容（通用协议） | RedisInsight 可连接 Valkey |

**结论**：如果你重度依赖 RedisJSON 或 RediSearch，目前留在 Redis 8.x 生态是更稳妥的选择。如果只使用核心数据结构，Valkey 毫无兼容性问题。

---

## 八、许可证：SSPL vs BSD 的商业含义

| 维度 | SSPL (Redis 8.x) | BSD-3-Clause (Valkey) |
|------|-------------------|----------------------|
| **自建部署** | ✅ 允许 | ✅ 允许 |
| **SaaS 托管服务** | ❌ 需商业授权 | ✅ 无限制 |
| **修改后分发** | ⚠️ 需公开全部编排层代码 | ✅ 仅需保留版权声明 |
| **云厂商绑定风险** | 高（需与 Redis Ltd. 谈商业授权） | 低 |
| **企业版定价** | Redis Enterprise 订阅制 | 无企业版，社区支持 |

SSPL 本质上是 **AGPL 的加强版**——任何提供 Redis 作为服务的厂商必须开源整个服务栈（包括控制面、编排层），这在商业上几乎不可接受。这也是 AWS、GCP 全面转向 Valkey 的根本原因。

对中小团队而言：**自建部署两种都可以，但如果涉及对外提供缓存服务，BSD 的 Valkey 没有法律风险。**

---

## 九、云厂商格局：2026 年全景图

| 云厂商 | Redis 支持 | Valkey 支持 | 默认推荐 |
|--------|-----------|-------------|----------|
| **AWS ElastiCache** | Redis 7.x（维护模式） | ✅ Valkey 8.x（默认） | **Valkey** |
| **AWS MemoryDB** | Redis 7.x | ✅ Valkey 8.x | **Valkey** |
| **Google Memorystore** | Redis 7.x | ✅ Valkey 8.x | 用户选择 |
| **Azure Cache for Redis** | Redis 8.x | ❌ 不支持（Redis Ltd. 授权） | **Redis** |
| **阿里云 Tair** | Redis 兼容（自研引擎） | ❌ | 自研引擎 |
| **Upstash** | Redis 8.x | ❌ | **Redis** |

值得注意的是 **Azure 是唯一全面拥抱 Redis 8.x 的主流云厂商**，与 Redis Ltd. 达成了商业授权协议。AWS 则彻底转向 Valkey，2026 年 Q1 起新建集群默认使用 Valkey 引擎。

---

## 十、Laravel 兼容性：实战配置

### 10.1 驱动层兼容

Laravel 通过 `predis` 或 `phpredis` 扩展连接 Redis/Valkey，**协议层完全兼容**——Valkey 继承了 RESP3 协议，无需修改驱动代码。以下配置对 Redis 8.x 和 Valkey 8.x 均适用：

```php
// config/database.php
'redis' => [

    'client' => env('REDIS_CLIENT', 'phpredis'), // 或 'predis'

    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        'prefix' => env('REDIS_PREFIX', 'laravel_'),
        // Valkey 8.x 支持 RESP3
        'parameters' => [
            'protocol' => env('REDIS_PROTOCOL', 'resp3'),
        ],
    ],

    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME', 'default'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
    ],

    'cache' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME', 'default'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_CACHE_DB', '1'),
    ],
],
```

### 10.2 Sentinel 高可用

```php
// 使用 predis + Sentinel
'redis' => [
    'client' => 'predis',
    'options' => [
        'replication' => 'sentinel',
        'service' => env('REDIS_SENTINEL_SERVICE', 'mymaster'),
        'sentinel_password' => env('REDIS_SENTINEL_PASSWORD'),
        'parameters' => [
            'password' => env('REDIS_PASSWORD'),
            'database' => 0,
        ],
    ],
    'sentinel' => [
        [
            'host' => env('REDIS_SENTINEL_1', '10.0.0.1'),
            'port' => (int) env('REDIS_SENTINEL_PORT', '26379'),
        ],
        [
            'host' => env('REDIS_SENTINEL_2', '10.0.0.2'),
            'port' => (int) env('REDIS_SENTINEL_PORT', '26379'),
        ],
        [
            'host' => env('REDIS_SENTINEL_3', '10.0.0.3'),
            'port' => (int) env('REDIS_SENTINEL_PORT', '26379'),
        ],
    ],
],
```

> **注意**：Valkey 的 Sentinel 实现与 Redis 完全兼容，协议命令 `SENTINEL master/replicas/sentinels` 行为一致，Laravel 零修改切换。

### 10.3 集群模式

```php
// Redis Cluster / Valkey Cluster 配置
'redis' => [
    'client' => 'phpredis',
    'options' => [
        'cluster' => 'redis', // phpredis 原生集群模式
        'prefix' => 'laravel_',
    ],
    'clusters' => [
        'default' => [
            [
                'host' => env('REDIS_CLUSTER_NODE_1', '10.0.0.1'),
                'port' => 6379,
                'password' => env('REDIS_PASSWORD'),
                'database' => 0,
            ],
            [
                'host' => env('REDIS_CLUSTER_NODE_2', '10.0.0.2'),
                'port' => 6379,
                'password' => env('REDIS_PASSWORD'),
                'database' => 0,
            ],
            // ... 至少 3 个主节点
        ],
    ],
],
```

### 10.4 Laravel Horizon 集成

Laravel Horizon 使用 Redis 的 List 和 Stream 数据结构管理队列，对 Redis 和 Valkey 完全兼容：

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['default', 'high', 'low'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 10,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
    ],
],

```

```dotenv
# .env — 切换 Redis/Valkey 只需改连接信息
REDIS_HOST=your-valkey-or-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-password
```

### 10.5 Laravel Cache 与 Valkey 原生操作封装

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class CacheService
{
    /**
     * 使用 Valkey/Redis 的 Hash Field Expiry（HEXPIRE）功能
     * 这是 Redis 7.4+ 和 Valkey 8.0+ 的新特性
     */
    public function setHashWithFieldTtl(string $key, string $field, mixed $value, int $ttlSeconds): void
    {
        Redis::hset($key, $field, json_encode($value));
        Redis::rawCommand('HEXPIRE', $key, $ttlSeconds, 'FIELDS', '1', $field);
    }

    /**
     * 带本地二级缓存的查询（减少网络往返）
     */
    public function getCachedWithLocal(string $key, int $ttl, callable $callback): mixed
    {
        // 1. 先查本地内存缓存（L1）
        static $localCache = [];
        if (isset($localCache[$key]) && $localCache[$key]['expires'] > time()) {
            return $localCache[$key]['value'];
        }

        // 2. 查 Redis/Valkey（L2）
        $value = Cache::store('redis')->get($key);
        if ($value === null) {
            $value = $callback();
            Cache::store('redis')->put($key, $value, $ttl);
        }

        // 3. 写入本地缓存
        $localCache[$key] = [
            'value' => $value,
            'expires' => time() + min($ttl, 10), // 本地最多缓存 10 秒
        ];

        return $value;
    }

    /**
     * 检测连接的是 Redis 还是 Valkey
     */
    public function getBackendType(): string
    {
        $info = Redis::info('server');
        $version = $info['redis_version'] ?? '';

        return str_contains($version, 'valkey') ? 'valkey' : 'redis';
    }

    /**
     * 根据后端类型选择最佳策略
     */
    public function smartSet(string $key, mixed $value, ?int $ttl = null): void
    {
        if ($this->getBackendType() === 'redis') {
            // Redis 8.0: 使用 JSON.SET 存储结构化数据
            Redis::rawCommand('JSON.SET', $key, '$', json_encode($value));
            if ($ttl) {
                Redis::expire($key, $ttl);
            }
        } else {
            // Valkey: 使用传统 SET（valkey-json 模块可能未安装）
            $serialized = json_encode($value);
            if ($ttl) {
                Redis::setex($key, $ttl, $serialized);
            } else {
                Redis::set($key, $serialized);
            }
        }
    }
}
```

### 10.6 切换差异点

| 场景 | Redis 8.x | Valkey 8.x | Laravel 影响 |
|------|-----------|------------|-------------|
| 基础 KV 操作 | ✅ | ✅ | 无 |
| Queue（Horizon） | ✅ | ✅ | 无 |
| Session 驱动 | ✅ | ✅ | 无 |
| Cache Tags | ✅ | ✅ | 无 |
| `EVAL`/Lua 脚本 | ✅ | ✅ | 无（注意 lua-time-limit 差异） |
| RedisJSON `JSON.SET` | ✅ 原生 | ⚠️ 需 `valkey-json` 模块 | 需确认模块已加载 |
| `FT.SEARCH` | ✅ 原生 | ❌ 暂无完整替代 | 需迁移到 Typesense/Meilisearch |
| Hash Field TTL | ✅ | ✅ | Laravel 11+ 可通过 `rawCommand` 使用 |

---

## 十一、选型决策框架

```
                        ┌─────────────────────┐
                        │ 是否使用 RedisJSON /  │
                        │ RediSearch 等模块？   │
                        └──────────┬──────────┘
                              是 / \ 否
                               /     \
                 ┌─────────────┐   ┌──────────────────┐
                 │ 留在 Redis 8.x │   │ 是否作为 SaaS 服务 │
                 │ （内置模块最优）│   │ 对外提供给客户？    │
                 └─────────────┘   └────────┬─────────┘
                                        是 / \ 否
                                         /     \
                          ┌──────────────┐   ┌──────────────────┐
                          │ 选择 Valkey   │   │ 云厂商是否默认？   │
                          │ （BSD 无限制）│   └────────┬─────────┘
                          └──────────────┘        是 / \ 否
                                                 /     \
                                  ┌───────────────┐  ┌──────────────┐
                                  │ 顺从云厂商默认 │  │ 自建评估后    │
                                  │ 选 Valkey/Redis│  │ 按需选择      │
                                  └───────────────┘  └──────────────┘
```

**简明建议**：

- **选 Redis 8.x**：重度使用 JSON/Search/TimeSeries 模块、Azure 用户、追求"一体化"体验
- **选 Valkey 8.x**：核心 KV/缓存/队列场景、AWS 用户、SaaS 服务商、追求性能和开源自由度
- **考虑替代方案**：超大规模缓存可评估 Dragonfly（单机百万 QPS）；键值存储可评估 KeyDB

---

## 十二、迁移 Checklist：从 Redis 到 Valkey 的实战清单

```markdown
## Redis → Valkey 迁移 Checklist

### 第一阶段：评估
- [ ] 盘点当前使用的 Redis 命令（redis-cli MONITOR 采样 1 小时）
- [ ] 检查是否使用 RedisJSON / RediSearch / RedisGears
- [ ] 评估 Lua 脚本数量和复杂度
- [ ] 确认 ACL 规则完整性
- [ ] 审查许可证合规性（是否对外提供 SaaS）

### 第二阶段：准备
- [ ] 在测试环境部署 Valkey 8.1
- [ ] 运行 RDB 文件导入验证
- [ ] 安装必要的社区模块（valkey-json、valkey-search）
- [ ] 配置 Sentinel / Cluster
- [ ] 更新 Laravel .env 配置
- [ ] 调整 lua-time-limit 和 down-after-milliseconds

### 第三阶段：迁移
- [ ] 使用 redis-shake 或 valkey-shake 同步数据
- [ ] 双写验证（写入同时写 Redis 和 Valkey）
- [ ] 逐个验证 Laravel 功能（Cache、Queue、Session）
- [ ] 压力测试（至少 80% 生产流量）

### 第四阶段：切换
- [ ] DNS 切换或连接池配置更新
- [ ] 监控 P99 延迟和错误率
- [ ] 保留 Redis 实例 24 小时作为回退
- [ ] 更新文档和 runbook
```

---

## 十三、2026-2027 路线图展望

| 维度 | Redis 路线图 | Valkey 路线图 |
|------|-------------|-------------|
| **Q3 2026** | Redis 8.1：增强 AI 向量搜索、RDI v2 | Valkey 8.2：raft-based 集群一致性 |
| **Q4 2026** | Redis Enterprise Cloud 全球扩展 | Valkey 模块 SDK 稳定版发布 |
| **2027** | Redis 9.0 预研：WASM 沙箱执行 | Valkey 9.x：原生 JSON/Search 模块 |
| **治理** | Redis Ltd. 主导，商业化驱动 | Linux Foundation 社区治理 |

Valkey 社区正在加速开发原生 JSON 和 Search 模块，预计 2027 年上半年可达到生产可用水平。届时，模块生态差距将大幅缩小，Valkey 有望成为真正的"全功能 Redis 替代品"。

---

## 结语

Redis 生态的分裂是开源商业化矛盾的缩影。对 Laravel 开发者而言，好消息是**核心协议层面完全兼容**——predis/phpredis 驱动、Sentinel、Cluster 配置几乎无需修改。真正的差异在于**模块生态**和**许可证约束**。

2026 年的务实建议：**如果你的 Laravel 应用只使用 Redis 的核心数据结构（String、Hash、List、Set、Sorted Set）+ 缓存/队列/会话，Valkey 8.x 是更自由、性能更好的选择。如果你深度依赖 Redis Stack 的 JSON/Search 能力，留在 Redis 8.x 生态，等待 Valkey 社区补齐模块缺口。**

生态分裂终将走向再平衡——但在那一天到来之前，理解差异、做好抽象层隔离（不要硬编码 Redis 特有命令），才是最稳健的工程策略。

---

## 相关阅读

- [Valkey 实战：Redis 开源替代品 Laravel 缓存队列会话无缝迁移与性能基准对比](/categories/Redis/Valkey-实战-Redis-开源替代品-Laravel-缓存队列会话无缝迁移与性能基准对比/)
- [分布式限流算法深度对比：滑动窗口、令牌桶、漏桶、Redis-Cell 与 Laravel 实现](/categories/Redis/2026-06-03-分布式限流算法深度对比-滑动窗口令牌桶漏桶Redis-Cell与Laravel实现/)
- [Cache Stampede 防护深度实战：Lock、Probabilistic、Expiration、Background Refresh Laravel 三重防御](/categories/Redis/2026-06-07-Cache-Stampede防护深度实战-Lock-Probabilistic-Expiration-Background-Refresh-Laravel三重防御/)
- [Write-Back Cache Pattern 实战：批量回写缓存策略，Laravel 高写入场景下的 Redis 缓存治理与数据一致性](/categories/Redis/Write-Back-Cache-Pattern-实战-批量回写缓存策略-Laravel高写入场景下的Redis缓存治理与数据一致性/)
