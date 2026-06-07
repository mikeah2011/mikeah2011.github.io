# ShardingSphere 分片中间件

## 定义

Apache ShardingSphere 是一套开源的分布式数据库中间件生态，包括 ShardingSphere-JDBC（Java 嵌入式驱动）和 ShardingSphere-Proxy（独立代理服务）。它为 MySQL/PostgreSQL 提供数据分片、读写分离、分布式事务、数据加密等功能，让应用层无需感知底层分库分表的复杂度。

## 核心原理

### ShardingSphere-Proxy 架构

```
Laravel 应用 (MySQL 驱动)
      │
      ▼  标准 MySQL 协议
┌──────────────────────┐
│  ShardingSphere-Proxy │  ← 无侵入，协议层代理
│  ├── 分片路由         │
│  ├── SQL 改写         │
│  ├── 结果归并         │
│  └── 分布式事务       │
└──────┬───────┬───────┘
       │       │
       ▼       ▼
    MySQL-1  MySQL-2   ← 实际存储节点
```

### 分片策略

#### 按用户 ID 分片（推荐）

```yaml
rules:
  - !SHARDING
    tables:
      orders:
        actualDataNodes: ds_${0..1}.orders_${0..15}
        tableStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: orders_inline
        keyGenerateStrategy:
          column: id
          keyGeneratorName: snowflake
    shardingAlgorithms:
      orders_inline:
        type: INLINE
        props:
          algorithm-expression: orders_${user_id % 16}
```

#### 分片键选择原则

| 分片键 | 优点 | 缺点 |
|--------|------|------|
| user_id | 大多数查询带用户维度 | 跨用户查询需要全分片扫描 |
| order_id | 均匀分布 | 按用户查订单需要全局广播 |
| 时间 | 天然有序，便于归档 | 热点集中在当前时间片 |

### 分布式 ID 生成

| 方案 | 特点 |
|------|------|
| Snowflake | 趋势递增、高性能，需独立 Worker ID |
| UUID | 无需协调，但无序且占空间 |
| Leaf-Segment | 号段模式，适合批量申请 |
| TiDB AUTO_RANDOM | 数据库原生，无需额外组件 |

### 跨片查询处理

| 场景 | 处理方式 |
|------|---------|
| 带分片键查询 | 精确路由到目标分片 |
| 不带分片键查询 | 全分片扫描 + 归并（性能差） |
| 跨片 JOIN | Federation 执行引擎（有限支持） |
| 跨片排序/分页 | 流式归并 + 内存排序 |

## Laravel 集成

### 方案 1：ShardingSphere-Proxy（推荐）

Laravel 无感知，直接连接 Proxy：

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'host' => env('SHARDING_PROXY_HOST', '127.0.0.1'),
    'port' => env('SHARDING_PROXY_PORT', 3307),  // Proxy 端口
    'database' => 'sharding_db',
    'username' => 'root',
    'password' => '',
],
```

### 方案 2：应用层路由（透明分片）

```php
// 在 ServiceProvider 中动态切换连接
class OrderServiceProvider extends ServiceProvider
{
    public function boot()
    {
        Model::creating(function ($model) {
            if ($model instanceof Order) {
                $shard = $model->user_id % 16;
                config(['database.connections.mysql.database' => "orders_{$shard}"]);
            }
        });
    }
}
```

### 全局 ID 与查询降级

```php
// Snowflake ID 生成
class SnowflakeIdGenerator
{
    public function nextId(): int
    {
        $timestamp = (int)(microtime(true) * 1000);
        return ($timestamp << 22) | ($workerId << 12) | ($sequence++ & 0xFFF);
    }
}

// 无分片键查询降级
public function searchOrders(string $keyword): Collection
{
    try {
        // 先尝试精确路由
        return Order::where('user_id', $userId)->get();
    } catch (CrossShardException $e) {
        // 降级为全分片扫描
        return Order::query()->where('description', 'like', "%{$keyword}%")->get();
    }
}
```

## 生产踩坑

1. **跨片查询性能**：无分片键查询会扫描所有分片，需配合搜索引擎（ES）做全文检索
2. **事务限制**：跨片分布式事务性能差，应尽量将同一用户的订单放在同一分片
3. **DDL 管理**：每个分片需要独立执行 DDL，建议使用 ShardingSphere DistSQL 统一管理
4. **连接池管理**：Proxy 连接池大小 = 分片数 × 每分片连接数，需合理配置

## 实战案例

来自博客文章：
- [ShardingSphere-Proxy 分库分表实战：Laravel 订单中心按用户路由、全局 ID 与跨片查询降级踩坑记录](/categories/Databases/ShardingSphere-Proxy-分库分表实战/)

## 相关概念

- [分库分表](分库分表.md) - 分库分表基础概念
- [TiDB NewSQL](TiDB-NewSQL.md) - 无需分库分表的分布式 SQL
- [读写分离中间件](读写分离中间件.md) - ProxySQL/MaxScale
- [分布式事务](../架构设计/分布式事务.md) - Saga/TCC/本地消息表
- [分布式 ID 生成](分库分表.md#全局id) - Snowflake/Leaf/UUID

## 常见问题

**Q: ShardingSphere-Proxy vs JDBC 如何选型？**
A: Proxy 适合异构语言（PHP/Go/Python），JDBC 适合纯 Java 项目。Laravel 项目只能用 Proxy。

**Q: 分片数量如何确定？**
A: 预估 3-5 年数据量增长。单分片建议 500GB 以内。初期可设 16 个分片，后续扩展到 64/128。

**Q: 如何平滑迁移已有数据到分片？**
A: 使用 ShardingSphere Scaling 组件做在线数据迁移。先写入新分片，再回填历史数据，最后切换读流量。
