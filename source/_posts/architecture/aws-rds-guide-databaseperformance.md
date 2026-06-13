---
title: "AWS-RDS-实战-数据库托管备份恢复与性能优化-Laravel-B2C-API踩坑记录"
date: 2026-05-17 02:21:55
updated: 2026-05-17 02:26:08
categories:
  - architecture
  - aws
tags: [AWS, MySQL, PostgreSQL, 监控]
keywords: [AWS, RDS, Laravel, B2C, API, 数据库托管备份恢复与性能优化, 踩坑记录, 架构]
description: "AWS RDS 在 Laravel B2C API 项目中的实战经验：多可用区部署、自动备份与时间点恢复、读写分离 Proxy、Performance Insights 慢查询治理、参数组调优、以及从自建 MySQL 迁移到 RDS 的完整踩坑记录。"
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - /images/content/architecture-01-content-1.jpg
  - /images/content/architecture-01-content-2.jpg

---

# AWS RDS 实战：数据库托管、备份恢复与性能优化

## 前言

在 KKday B2C Backend 的 30+ 仓库中，数据库是最核心的基础设施。我们经历过自建 MySQL on EC2 的痛苦（凌晨 3 点手动恢复主从、磁盘满导致写入阻塞），最终将核心业务库迁移到 AWS RDS。这篇文章记录了从选型、迁移、调优到灾备的完整实战经验，包含 4 个真实踩坑案例和可复用的代码配置。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Laravel  │  │ Laravel  │  │ Laravel  │  (ECS/EC2)     │
│  │ API #1   │  │ API #2   │  │ API #3   │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       │              │              │                     │
│       └──────────────┼──────────────┘                     │
│                      │                                    │
│              ┌───────▼───────┐                            │
│              │ RDS Proxy     │  ← 连接池 + 故障转移       │
│              └───────┬───────┘                            │
│                      │                                    │
│       ┌──────────────┼──────────────┐                     │
│       │              │              │                     │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐               │
│  │ RDS      │  │ RDS      │  │ RDS      │               │
│  │ Primary  │  │ Read     │  │ Read     │               │
│  │ (Multi-  │  │ Replica  │  │ Replica  │               │
│  │  AZ)     │  │ #1       │  │ #2       │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                          │
│  ┌──────────────────────────────────────┐                │
│  │ S3 Automated Backup Bucket           │                │
│  │ (每日快照 + WAL/binlog 保留 35 天)    │                │
│  └──────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

![AWS RDS 多可用区架构](/images/content/architecture-01-content-1.jpg)

## 一、为什么选 RDS 而不是自建？

### 自建 MySQL on EC2 的痛点

我们曾经在 EC2 上跑 MySQL 5.7，踩过这些坑：

1. **主从延迟失控**：binlog 复制遇到大事务（批量更新 10 万行订单状态），从库延迟飙到 30 秒，导致用户看到旧数据投诉
2. **备份窗口影响性能**：`mysqldump` 加 `--single-transaction` 在 200GB 大表上仍然需要锁表数秒，备份期间 API 响应时间翻倍
3. **故障恢复靠运气**：主库宕机后手动 `CHANGE MASTER TO`，中间丢失了 2 分钟数据（binlog 没来得及同步）
4. **参数调优靠猜**：`innodb_buffer_pool_size` 设大了 OOM 被 kill，设小了 QPS 上不去，反复折腾了两周
5. **磁盘管理噩梦**：某次 binlog 暴涨撑满磁盘，MySQL 直接拒绝写入，整个 B2C 下单流程中断 40 分钟

### RDS 解决了什么

| 维度 | 自建 EC2 | RDS |
|------|---------|-----|
| 高可用 | 手动搭建主从 + MHA | Multi-AZ 自动故障转移 < 60s |
| 备份 | mysqldump + cron | 自动快照 + 持续归档 (PITR) |
| 监控 | 自装 Prometheus + Grafana | 内置 Performance Insights |
| 升级 | 停机 + 手动操作 | 在线 minor 升级 |
| 存储扩容 | 停机 + rsync | 在线扩容（gp3/io2） |
| 安全组 | 手动配置 iptables | VPC Security Group + IAM |

## 二、RDS 实例配置实战

### 2.1 实例选型

B2C API 的数据库负载特征：**读多写少（8:2），突发流量明显（促销期间 QPS 5x）**。我们做了压测来确定实例规格：

```bash
# 生产环境配置
aws rds create-db-instance \
  --db-instance-identifier kkday-b2c-prod \
  --db-instance-class db.r6g.xlarge \          # 4 vCPU, 32GB RAM
  --engine mysql \
  --engine-version 8.0.35 \
  --allocated-storage 500 \
  --storage-type gp3 \                          # 通用 SSD，性价比最优
  --storage-encrypted \
  --multi-az \                                  # 多可用区部署
  --backup-retention-period 35 \                # 保留 35 天备份
  --preferred-backup-window "03:00-04:00" \     # 低峰期备份
  --preferred-maintenance-window "sun:05:00-sun:06:00" \
  --deletion-protection \                       # 防误删
  --enable-performance-insights \               # 开启性能洞察
  --performance-insights-retention-period 731 \ # 保留 2 年性能数据
  --enable-cloudwatch-logs-exports '["slowquery","error","general","audit"]' \
  --tags Key=Environment,Value=Production Key=Team,Value=B2C-Backend
```

**选型经验**：r6g 系列（Graviton2 ARM）比 r5（Intel x86）便宜 20%，性能几乎一样。MySQL 8.0 在 ARM 上完全兼容，我们跑了半年没遇到任何问题。

### 2.2 参数组调优（关键踩坑点）

RDS 默认参数组非常保守，必须自定义。我们对照 MySQL 官方文档和 Percona 的推荐值，逐项调整：

```bash
# 创建自定义参数组
aws rds create-db-parameter-group \
  --db-parameter-group-family mysql8.0 \
  --db-parameter-group-name kkday-b2c-prod-params \
  --description "KKday B2C Production Optimized"
```

核心参数调优（每个参数都有踩坑故事）：

```sql
-- InnoDB Buffer Pool：设为实例内存的 70-80%
-- db.r6g.xlarge = 32GB → buffer_pool = 24GB
innodb_buffer_pool_size = {DBInstanceClassMemory*3/4}

-- 连接数：RDS 默认 max_connections=0（自动计算），但往往偏小
-- B2C API 场景需要更多连接（PHP-FPM 每个进程一个连接）
max_connections = 2000

-- 慢查询阈值：1 秒太宽松，B2C API 要求 200ms 以内
long_query_time = 0.2

-- 开启所有慢查询日志（生产环境用 log_queries_not_using_indexes 也要开）
slow_query_log = 1
log_queries_not_using_indexes = 1

-- InnoDB 日志优化
innodb_log_file_size = 1073741824        # 1GB（默认太小，写密集场景会频繁 checkpoint）
innodb_flush_log_at_trx_commit = 1       # ACID 保证（不能改 2！）
innodb_io_capacity = 2000                # gp3 支持更高 IOPS
innodb_io_capacity_max = 4000

-- 排序和临时表（B2C 报表查询经常需要）
sort_buffer_size = 4194304               # 4MB
tmp_table_size = 67108864                # 64MB
max_heap_table_size = 67108864           # 64MB

-- 查询缓存（MySQL 8.0 已移除，但 5.7 需要关闭）
-- query_cache_type = 0  # 如果是 5.7，一定要关！
```

**踩坑记录 #1**：我们曾经把 `innodb_flush_log_at_trx_commit` 设为 2 来提升写入性能（从 3000 TPS 提升到 5000 TPS），结果在一次 AZ 故障转移中丢失了约 1 秒的事务数据——3 笔订单支付成功但没写入数据库，客服接到投诉后排查了 2 小时才定位到原因。教训：**B2C 电商场景，ACID 保证不能妥协，写入性能不够就加写副本或优化业务逻辑**。

## 三、读写分离与 RDS Proxy

### 3.1 为什么需要 RDS Proxy？

PHP-FPM 的特点是每个请求一个数据库连接，高并发时会创建大量短连接。我们遇到过两个问题：

1. **连接风暴**：促销期间 2000 个 PHP-FPM 进程同时连接 MySQL，`max_connections` 被打满
2. **故障转移中断**：Multi-AZ 故障转移时，所有连接断开，Laravel 需要重建连接池

RDS Proxy 解决了这两个问题：它在应用和数据库之间维护一个长连接池，并在故障转移时自动重连。

### 3.2 配置 RDS Proxy

```bash
# 创建 RDS Proxy（连接池 + 自动读写分离）
aws rds create-db-proxy \
  --db-proxy-name kkday-b2c-proxy \
  --engine-family MYSQL \
  --auth '{
    "AuthScheme": "SECRETS",
    "IAMAuth": "DISABLED",
    "SecretArn": "arn:aws:secretsmanager:ap-northeast-1:123456789:secret:rds-creds-xxx"
  }' \
  --role-arn arn:aws:iam::123456789:role/rds-proxy-role \
  --vpc-subnet-ids subnet-aaa subnet-bbb \
  --vpc-security-group-ids sg-xxx \
  --require-tls \
  --idle-client-timeout 1800

# 注册目标组
aws rds register-db-proxy-targets \
  --db-proxy-name kkday-b2c-proxy \
  --target-group-name default \
  --db-instance-identifiers kkday-b2c-prod kkday-b2c-read-1
```

### 3.3 Laravel 配置 RDS Proxy

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    // RDS Proxy 端点（自动读写分离：SELECT 走读副本，INSERT/UPDATE/DELETE 走主库）
    'host' => env('DB_HOST', 'kkday-b2c-proxy.proxy-xxx.ap-northeast-1.rds.amazonaws.com'),
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'kkday_b2c'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'prefix_indexes' => true,
    'strict' => true,
    'engine' => null,
    'options' => extension_loaded('pdo_mysql') ? array_filter([
        PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'), // RDS 强制 TLS
    ]) : [],
],

// 如果需要手动控制读写分离（绕过 Proxy）
'mysql_read' => [
    'driver' => 'mysql',
    'host' => env('DB_READ_HOST', 'kkday-b2c-read-1.xxx.rds.amazonaws.com'),
    // ... 其他配置同上
],
```

在 Service 层显式使用读连接：

```php
class OrderService
{
    public function getOrderDetail(int $orderId): array
    {
        // 读操作走读副本（通过 Proxy 自动路由，或手动指定连接）
        return DB::connection('mysql_read')
            ->table('orders')
            ->join('order_items', 'orders.id', '=', 'order_items.order_id')
            ->where('orders.id', $orderId)
            ->select('orders.*', 'order_items.product_name', 'order_items.quantity')
            ->get()
            ->toArray();
    }

    public function updateOrderStatus(int $orderId, string $status): bool
    {
        // 写操作走主库（Proxy 自动路由）
        return DB::table('orders')
            ->where('id', $orderId)
            ->update([
                'status' => $status,
                'updated_at' => now(),
            ]);
    }
}
```

**踩坑记录 #2**：RDS Proxy 有 30 秒的连接借用超时。我们在促销期间遇到过大量请求排队等连接的情况（503 错误暴增）。解决方案是两步走：

```php
// 1. 在 AppServiceProvider 中设置连接超时
public function boot()
{
    // 设置 PDO 连接超时为 5 秒，快速失败而不是无限等待
    DB::connection()->getPdo()->setAttribute(
        PDO::ATTR_TIMEOUT, 5
    );
}

// 2. 配置 Laravel 的重试逻辑
// config/database.php
'mysql' => [
    // ...
    'options' => [
        PDO::ATTR_TIMEOUT => 5,
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ],
],
```

同时，我们调整了 RDS Proxy 的 `MaxConnectionsPercent` 参数，限制每个客户端的连接占比，防止单个应用实例占满连接池。

## 四、备份与时间点恢复（PITR）

### 4.1 自动备份策略

RDS 自动备份包含两部分：
- **每日快照**：在备份窗口内拍摄全量快照
- **事务日志持续归档**：每 5 分钟一次（MySQL binlog / PostgreSQL WAL）

```
时间线：03:00 ─────────────────────────────────── 03:00
         │                                          │
         ▼ 每日快照                                  ▼ 次日快照
    [Full Snapshot] ── 5min ── 5min ── ... ── [Full Snapshot]
         │                                          │
         └── binlog 连续归档（保留 35 天）───────────┘
```

### 4.2 手动快照（变更前必做）

在做任何危险操作前，先创建手动快照：

```bash
# 创建手动快照（不会自动过期，需要手动删除）
aws rds create-db-snapshot \
  --db-instance-identifier kkday-b2c-prod \
  --db-snapshot-identifier kkday-b2c-prod-pre-schema-migration-20260510
```

### 4.3 时间点恢复实战

某次线上事故：开发误执行了 `DELETE FROM orders WHERE created_at < '2026-01-01'`，删除了 3 个月前的订单数据（影响了约 50 万条记录）。

```bash
# 1. 恢复到误操作前的时间点（2026-05-10 14:30:00 UTC）
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier kkday-b2c-prod \
  --target-db-instance-identifier kkday-b2c-recovery \
  --restore-time "2026-05-10T14:30:00Z" \
  --db-instance-class db.r6g.xlarge \
  --multi-az

# 2. 等待恢复完成（约 15-30 分钟，取决于数据量）
aws rds wait db-instance-available \
  --db-instance-identifier kkday-b2c-recovery

# 3. 从恢复实例中导出需要的数据
mysqldump -h kkday-b2c-recovery.xxx.rds.amazonaws.com \
  -u admin -p \
  --single-transaction \
  --tables orders order_items \
  --where="created_at >= '2025-10-01' AND created_at < '2026-01-01'" \
  > recovery_orders.sql

# 4. 导入回生产库
mysql -h kkday-b2c-proxy.proxy-xxx.rds.amazonaws.com \
  -u admin -p kkday_b2c < recovery_orders.sql

# 5. 验证数据完整性
mysql -h kkday-b2c-proxy.proxy-xxx.rds.amazonaws.com \
  -u admin -p kkday_b2c \
  -e "SELECT COUNT(*) FROM orders WHERE created_at >= '2025-10-01' AND created_at < '2026-01-01';"

# 6. 清理恢复实例（避免产生额外费用）
aws rds delete-db-instance \
  --db-instance-identifier kkday-b2c-recovery \
  --skip-final-snapshot
```

**踩坑记录 #3**：PITR 恢复是创建一个**全新的 RDS 实例**，不是原地恢复！这意味着：
- 恢复期间需要额外的实例费用（db.r6g.xlarge 约 $0.5/小时）
- 恢复后需要手动同步恢复期间的新数据（这段时间写入主库的数据不会出现在恢复实例中）
- 建议先在恢复实例上验证数据完整性和正确性，再导入生产库
- 500GB 数据库恢复大约需要 20-30 分钟，1TB 可能需要 1 小时以上

## 五、Performance Insights 慢查询治理

![Performance Insights 慢查询监控](/images/content/architecture-01-content-2.jpg)

### 5.1 开启 Performance Insights

```bash
aws rds modify-db-instance \
  --db-instance-identifier kkday-b2c-prod \
  --enable-performance-insights \
  --performance-insights-retention-period 731 \
  --performance-insights-kms-key-id arn:aws:kms:ap-northeast-1:xxx
```

Performance Insights 提供了比 CloudWatch 更详细的数据库负载分析，包括：
- **DB Load**：数据库负载（按 CPU、IO、锁等待等维度分解）
- **Top SQL**：按负载排序的 SQL 查询
- **Wait Events**：数据库等待事件分析
- **Top Hosts/Users**：按来源分析负载

### 5.2 用 CLI 查询 Top SQL

```bash
# 获取过去 1 小时的 Top SQL（按 DB Load 排序）
aws pi get-resource-metrics \
  --service-type RDS \
  --identifier db-xxx \
  --metric-queries '[
    {
      "Metric": "db.load.avg",
      "GroupBy": {"Group": "db.sql", "Limit": 10}
    }
  ]' \
  --start-time "2026-05-10T10:00:00Z" \
  --end-time "2026-05-10T11:00:00Z" \
  --period-in-seconds 300
```

### 5.3 Laravel 中集成慢查询监控

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

public function boot()
{
    // 监听慢查询并上报
    DB::listen(function ($query) {
        if ($query->time > 200) { // 超过 200ms
            Log::channel('slowquery')->warning('Slow Query Detected', [
                'sql' => $query->sql,
                'bindings' => $query->bindings,
                'time' => $query->time . 'ms',
                'connection' => $query->connectionName,
                'trace' => debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 5),
            ]);

            // 上报到 Prometheus 指标
            if (app()->bound('prometheus')) {
                app('prometheus')->getHistogram('db_query_duration_ms')
                    ->observe($query->time, [
                        'connection' => $query->connectionName,
                    ]);
            }
        }
    });

    // 定期采集连接池状态
    if (app()->runningInConsole()) {
        return;
    }

    $connection = DB::connection('mysql');
    $pdo = $connection->getPdo();
    $processList = $connection->select("SHOW PROCESSLIST");
    $activeConnections = count($processList);

    Cache::put('db_active_connections', $activeConnections, now()->addSeconds(10));
}
```

### 5.4 自动告警配置

```bash
# CloudWatch 告警：CPU 使用率超过 80%
aws cloudwatch put-metric-alarm \
  --alarm-name "RDS-HighCPU-kkday-b2c-prod" \
  --metric-name CPUUtilization \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=DBInstanceIdentifier,Value=kkday-b2c-prod \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789:db-alerts

# 告警：FreeStorageSpace 低于 50GB
aws cloudwatch put-metric-alarm \
  --alarm-name "RDS-LowStorage-kkday-b2c-prod" \
  --metric-name FreeStorageSpace \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 53687091200 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=DBInstanceIdentifier,Value=kkday-b2c-prod \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789:db-alerts

# 告警：Read Replica 延迟超过 30 秒
aws cloudwatch put-metric-alarm \
  --alarm-name "RDS-ReplicaLag-kkday-b2c-read-1" \
  --metric-name ReplicaLag \
  --namespace AWS/RDS \
  --statistic Average \
  --period 60 \
  --threshold 30 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=DBInstanceIdentifier,Value=kkday-b2c-read-1 \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789:db-alerts
```

## 六、存储优化：gp3 vs io2

| 特性 | gp3 | io2 |
|------|-----|-----|
| 基准 IOPS | 3,000（免费） | 随容量线性增长 |
| 最大 IOPS | 16,000 | 256,000 |
| 基准吞吐 | 125 MB/s | 随 IOPS 线性 |
| 价格 | $0.08/GB/月 | $0.125/GB/月 |
| 适用场景 | 通用 B2C | 超高 IOPS（金融交易） |

**我们的选择**：B2C 电商场景用 gp3 足够，单独购买额外 IOPS 比 io2 便宜 40%。

```bash
# 存储扩容（在线，不中断服务，但可能有短暂性能影响）
aws rds modify-db-instance \
  --db-instance-identifier kkday-b2c-prod \
  --allocated-storage 1000 \
  --storage-type gp3 \
  --iops 6000 \
  --storage-throughput 500 \
  --apply-immediately
```

**踩坑记录 #4**：gp3 扩容是在线的，但有三个注意事项：
1. **缩容不支持**：如果需要缩容，只能创建新的小实例 + 数据迁移（用 mysqldump 或 DMS）
2. **扩容期间有性能影响**：虽然不中断服务，但 IOPS 会暂时下降，建议在低峰期操作
3. **IOPS 和吞吐量可以独立调整**：如果发现 IO 瓶颈，先检查 `WriteIOPS` 和 `ReadIOPS` 指标，再决定是否需要提升 IOPS

## 七、成本优化策略

### 7.1 Reserved Instance（RI）

生产环境用 1 年期 All Upfront RI，节省约 40%：

```bash
# 查看可用的 RI offerings
aws rds describe-reserved-db-instances-offerings \
  --db-instance-class db.r6g.xlarge \
  --product-description "MySQL" \
  --duration 31536000 \
  --offering-type "All Upfront"

# 购买 RI
aws rds purchase-reserved-db-instances-offering \
  --reserved-db-instances-offering-id xxx \
  --reserved-db-instance-id kkday-b2c-prod-ri \
  --db-instance-count 1
```

### 7.2 读副本按需伸缩

促销期间动态添加/移除读副本：

```php
// app/Console/Commands/RdsScaleReadReplicas.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Aws\Rds\RdsClient;

class RdsScaleReadReplicas extends Command
{
    protected $signature = 'rds:scale-read {count : 目标读副本数量}';
    protected $description = '动态调整 RDS 读副本数量';

    public function handle(RdsClient $rds): int
    {
        $targetCount = (int) $this->argument('count');
        $sourceDbId = config('services.rds.primary_instance');
        $replicaPrefix = config('services.rds.replica_prefix');

        // 获取当前读副本列表
        $existingReplicas = $rds->describeDBInstances([
            'Filters' => [
                ['Name' => 'db-instance-id', 'Values' => ["{$replicaPrefix}-*"]],
            ],
        ]);

        $currentCount = count($existingReplicas['DBInstances']);
        $this->info("当前读副本数量: {$currentCount}, 目标: {$targetCount}");

        if ($targetCount > $currentCount) {
            // 扩容
            for ($i = $currentCount + 1; $i <= $targetCount; $i++) {
                $this->info("创建读副本: {$replicaPrefix}-{$i}");
                $rds->createDBInstanceReadReplica([
                    'DBInstanceIdentifier' => "{$replicaPrefix}-{$i}",
                    'SourceDBInstanceIdentifier' => $sourceDbId,
                    'DBInstanceClass' => 'db.r6g.large',
                    'AvailabilityZone' => config("services.rds.availability_zones.{$i}"),
                ]);
            }
        } elseif ($targetCount < $currentCount) {
            // 缩容
            for ($i = $currentCount; $i > $targetCount; $i--) {
                $this->info("删除读副本: {$replicaPrefix}-{$i}");
                $rds->deleteDBInstance([
                    'DBInstanceIdentifier' => "{$replicaPrefix}-{$i}",
                    'SkipFinalSnapshot' => true,
                ]);
            }
        }

        $this->info('读副本调整完成');
        return self::SUCCESS;
    }
}
```

### 7.3 成本分析脚本

```bash
# 查看过去 30 天的 RDS 费用
aws ce get-cost-and-usage \
  --time-period Start=2026-04-10,End=2026-05-10 \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter '{
    "Dimensions": {
      "Key": "SERVICE",
      "Values": ["Amazon Relational Database Service"]
    }
  }'
```

## 八、灾备演练 Checklist

每季度执行一次灾备演练，这是我们的标准流程：

```markdown
## 灾备演练 Checklist（每季度一次）

### 准备阶段
- [ ] 1. 确认演练时间窗口（低峰期，提前通知相关团队）
- [ ] 2. 验证自动备份完整性
  - `aws rds describe-db-snapshots --db-instance-identifier kkday-b2c-prod`
  - 确认最新快照时间 < 24 小时
- [ ] 3. 准备回滚方案

### 演练执行
- [ ] 4. 执行 PITR 恢复测试
  - 恢复到 staging 实例，验证数据完整性
  - 记录恢复时间（目标 < 30 分钟）
- [ ] 5. 模拟主库故障转移
  - `aws rds reboot-db-instance --db-instance-identifier kkday-b2c-prod --force-failover`
  - 记录故障转移时间（目标 < 60 秒）
  - 验证应用自动重连
- [ ] 6. 验证读副本延迟
  - 检查 ReplicaLag 指标（目标 < 1 秒）

### 演练收尾
- [ ] 7. 清理临时资源（恢复实例等）
- [ ] 8. 记录演练结果和改进项
- [ ] 9. 更新 runbook 文档
- [ ] 10. 向团队发送演练报告
```

## 九、迁移 Checklist（从自建 MySQL 到 RDS）

如果你也在考虑迁移，这是我们总结的步骤：

```bash
# 1. 使用 AWS DMS（Database Migration Service）进行全量 + 增量迁移
aws dms create-replication-task \
  --replication-task-identifier kkday-b2c-migration \
  --source-endpoint-arn arn:aws:dms:xxx:source-endpoint \
  --target-endpoint-arn arn:aws:dms:xxx:target-endpoint \
  --migration-type full-load-and-cdc \  # 全量加载 + 持续复制
  --table-mappings '{
    "rules": [
      {
        "rule-type": "selection",
        "rule-id": "1",
        "rule-name": "all-tables",
        "object-locator": {
          "schema-name": "kkday_b2c",
          "table-name": "%"
        },
        "rule-action": "include"
      }
    ]
  }'

# 2. 验证数据一致性（使用 DMS 数据验证功能）
aws dms start-replication-task \
  --replication-task-arn xxx \
  --start-replication-task-type reload-target

# 3. 切换 DNS（使用 Route 53 加权路由，逐步切流）
# 先切 10% 流量到 RDS，观察 30 分钟，再逐步增加到 100%
```

## 总结

AWS RDS 不是银弹，但它解决了我们 90% 的数据库运维痛点。核心经验：

1. **Multi-AZ 是必须的**，不要为了省钱用单可用区——一次故障转移就能值回票价
2. **参数组必须自调**，默认配置只适合开发环境，生产环境至少要调 buffer_pool、连接数、慢查询阈值
3. **PITR 是救命稻草**，但恢复时间取决于数据量，大库（500GB+）恢复可能要 1 小时
4. **RDS Proxy 替代手动连接池**，特别是 PHP-FPM 这种短连接场景，能避免连接风暴
5. **Performance Insights 比自己装监控好用**，直接看到 Top SQL 和等待事件，省去了自己搭建 Grafana Dashboard 的工作
6. **成本优化要主动**，Reserved Instance 省 40%，读副本按需伸缩省 30%

---

> 本文基于 KKday B2C Backend 团队在 AWS ap-northeast-1（东京）区域的真实实践，数据库规模约 500GB，日均 QPS 约 5000。如有问题欢迎留言讨论。
