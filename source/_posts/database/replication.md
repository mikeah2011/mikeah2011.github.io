---

title: MySQL主从复制与读写分离
keywords: [MySQL, 主从复制与读写分离]
tags:
- MySQL
- 主从复制
- 读写分离
- 数据库
- 性能优化
- gtid
- binlog
categories:
- database
date: 2019-03-20 15:05:07
description: 本文深入讲解 MySQL 主从复制原理与读写分离架构实战。涵盖主从复制的完整工作流程（binlog → relay log → SQL thread）、传统复制与 GTID 复制的对比与选型建议、my.cnf 完整配置示例、Laravel 读写分离代码实现、主从延迟排查与优化方案，以及 binlog 格式选择、大事务导致延迟等常见踩坑案例，帮助开发者搭建高可用的 MySQL 读写分离架构。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-002-content-1.png
- /images/diagrams/databases-002-diagram.png
---



## 主从复制原理

> 主从同步

- master主库，有数据更新，将此次更新的事件类型写入到主库的binlog文件中
- 主库会创建`log dump 线程`通知slave有数据更新
- slave从库，向master节点的 `log dump线程`请求一份指定binlog文件位置的副本，并将请求回来的`binlog`存到本地的`Relay log` 中继日志中
- slave 再开启一个`SQL 线程`读取`Relay log`事件，并在本地执行`redo`操作。将发生在主库的事件在本地重新执行一遍，从而保证主从数据同步

![MySQL 主从复制数据流示意图](/images/content/databases-002-content-1.png)

核心流程可概括为三个线程协作：**Binlog Dump Thread**（主库）→ **I/O Thread**（从库）→ **SQL Thread**（从库）。

## 完整配置步骤

### 主库配置（my.cnf）

```ini
[mysqld]
# 唯一 server-id，集群内不可重复
server-id = 1

# 开启 binlog，这是主从复制的基础
log-bin = mysql-bin

# binlog 格式推荐 ROW，安全性和一致性最好
binlog_format = ROW

# binlog 过期时间（天），防止磁盘空间被占满
binlog_expire_logs_seconds = 604800

# 每次事务提交都将 binlog 写入磁盘并刷新
sync_binlog = 1

# InnoDB 事务日志同步策略，1 = 每次提交刷盘，最安全
innodb_flush_log_at_trx_commit = 1

# 需要同步的数据库（可选，不配置则同步全部）
# binlog-do-db = your_database

# 不需要同步的数据库（可选）
# binlog-ignore-db = information_schema
# binlog-ignore-db = performance_schema
```

### 从库配置（my.cnf）

```ini
[mysqld]
# 唯一 server-id，必须与主库不同
server-id = 2

# 开启 relay log
relay-log = relay-bin

# 从库是否只读（建议开启，防止误写）
read_only = ON
super_read_only = ON

# 并行复制线程数（MySQL 5.7+ 支持）
slave_parallel_workers = 4
slave_parallel_type = LOGICAL_CLOCK

# relay log 恢复与安全设置
relay_log_recovery = ON
relay_log_info_repository = TABLE
```

### 搭建主从复制

```sql
-- 1. 在主库创建复制专用账户
CREATE USER 'repl_user'@'%' IDENTIFIED BY 'StrongPassword123!';
GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';
FLUSH PRIVILEGES;

-- 2. 在主库查看当前 binlog 位置
SHOW MASTER STATUS;
-- +------------------+----------+
-- | File             | Position |
-- +------------------+----------+
-- | mysql-bin.000003 |      785 |
-- +------------------+----------+

-- 3. 在从库配置主库信息并启动复制
CHANGE MASTER TO
    MASTER_HOST = '192.168.1.100',
    MASTER_PORT = 3306,
    MASTER_USER = 'repl_user',
    MASTER_PASSWORD = 'StrongPassword123!',
    MASTER_LOG_FILE = 'mysql-bin.000003',
    MASTER_LOG_POS = 785;

START SLAVE;

-- 4. 检查从库状态
SHOW SLAVE STATUS\G
-- 确认 Slave_IO_Running: Yes 和 Slave_SQL_Running: Yes
```

## 传统复制 vs GTID 复制

| 对比维度 | 传统复制（Position-Based） | GTID 复制（Global Transaction ID） |
| --- | --- | --- |
| **定位方式** | 依赖 binlog 文件名 + 偏移量（`mysql-bin.000003` + `Position 785`） | 依赖全局唯一事务 ID（`server_uuid:transaction_id`） |
| **主从切换** | 切换复杂，需手动计算新主库的 binlog 位置 | 切换简单，从库自动定位已执行事务，无需手动配置 |
| **故障恢复** | 容易因位置计算错误导致数据不一致 | 自动跳过已执行的事务，恢复更可靠 |
| **多源复制** | 配置复杂，需手动管理多个 source | 原生支持，每个源有独立的 GTID 集合 |
| **运维复杂度** | 较低，但易出错 | 较高，需理解 GTID 工作原理 |
| **版本要求** | MySQL 5.0+ | MySQL 5.6+（推荐 5.7+） |
| **适用场景** | 简单的一主一从架构 | 一主多从、需要自动故障转移的生产环境 |

### GTID 复制配置示例

```ini
# 主库和从库的 my.cnf 均需添加
[mysqld]
gtid_mode = ON
enforce_gtid_consistency = ON
log-bin = mysql-bin
log_slave_updates = ON
```

```sql
-- 从库使用 GTID 自动定位
CHANGE MASTER TO
    MASTER_HOST = '192.168.1.100',
    MASTER_USER = 'repl_user',
    MASTER_PASSWORD = 'StrongPassword123!',
    MASTER_AUTO_POSITION = 1;

START SLAVE;
```

## 读写分离的 Laravel 实现

### 配置数据库连接（config/database.php）

```php
'mysql' => [
    'driver' => 'mysql',
    'sticky'    => true,  // 本次请求写入后，后续读取也走主库
    'read' => [
        'host' => [
            '192.168.1.101', // 从库 1
            '192.168.1.102', // 从库 2
        ],
        'port' => 3306,
        'database' => 'my_database',
        'username' => 'read_user',
        'password' => 'read_pass',
        'charset' => 'utf8mb4',
    ],
    'write' => [
        'host' => [
            '192.168.1.100', // 主库
        ],
        'port' => 3306,
        'database' => 'my_database',
        'username' => 'write_user',
        'password' => 'write_pass',
        'charset' => 'utf8mb4',
    ],
],
```

### 通过中间件在事务中强制主库

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\DB;

class ForceWriteConnection
{
    public function handle($request, Closure $next)
    {
        // POST/PUT/PATCH/DELETE 请求自动使用主库连接
        if (in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'])) {
            DB::connection('mysql')->setPdo(
                DB::connection('mysql')->getWritePdo()
            );
        }

        return $next($request);
    }
}
```

### 自定义 Repository 中显式指定连接

```php
<?php

namespace App\Repositories;

use Illuminate\Support\Facades\DB;

class UserRepository
{
    public function findById(int $id)
    {
        // 查询走从库（默认读连接）
        return DB::table('users')->where('id', $id)->first();
    }

    public function create(array $data)
    {
        // 写入走主库（Laravel 自动识别写操作）
        return DB::table('users')->insertGetId($data);
    }

    public function transferBalance(int $fromId, int $toId, float $amount)
    {
        // 事务内所有操作强制走主库
        DB::transaction(function () use ($fromId, $toId, $amount) {
            DB::table('users')->where('id', $fromId)->decrement('balance', $amount);
            DB::table('users')->where('id', $toId)->increment('balance', $amount);
        });
    }
}
```

> **提示**：Laravel 的 `sticky` 配置确保在一次请求中，如果先执行了写操作，后续的读操作也会走主库，避免读到未同步的旧数据。

## 主从延迟

### 延迟原理

指一个写入SQL操作在主库执行完后，将数据完整同步到从库会有一个时间差，称之为主从延迟。

- 主库生成一条写入SQL的binlog，里面会有一个时间字段，记录写入的时间戳 t1
- binlog 同步到从库后，一旦开始执行，取当前时间 t2
- `t2-t1`，就是延迟时间

注意：不同服务器要保持时钟一致。

![MySQL 读写分离架构图](/images/diagrams/databases-002-diagram.png)

### 延迟排查方法

通过 `SHOW SLAVE STATUS` 命令的关键字段来判断：

```sql
SHOW SLAVE STATUS\G
```

| 字段 | 含义 |
| --- | --- |
| `Seconds_Behind_Master` | 从库延迟秒数，0 表示无延迟，NULL 表示复制已断开 |
| `Slave_IO_Running` | I/O 线程是否运行，Yes 表示正常 |
| `Slave_SQL_Running` | SQL 线程是否运行，Yes 表示正常 |
| `Relay_Log_Space` | relay log 占用空间，过大说明延迟严重 |
| `Last_SQL_Error` | 最近一次 SQL 执行错误，排查问题的首要关注字段 |

**进阶排查（推荐）**：`Seconds_Behind_Master` 在并行复制下可能不准确。更精确的方式是对比主从 GTID 集合：

```sql
-- 主库
SELECT @@global.gtid_executed;

-- 从库
SELECT @@global.gtid_executed;

-- 计算差异：主库有但从库没有的事务数量
```

### 延迟优化方案

- **强制走主库查询**：对延迟零容忍的业务（如支付、订单确认），直接读主库
- **引入缓存层**：更新主库后同步写入 Redis，保证读取的及时性
- **提升从库配置**：使用 SSD、增大 `innodb_buffer_pool_size`，提高回放效率
- **缩短网络距离**：主从部署在同一机房，减少 binlog 传输延迟
- **一主多从 + Canal**：使用 Canal 增量订阅组件，将 binlog 消费压力从主库卸载
- **减少大事务**：分批执行大批量 UPDATE/DELETE，避免单个事务阻塞复制
- **开启并行复制**：MySQL 5.7+ 设置 `slave_parallel_workers = 4` 和 `slave_parallel_type = LOGICAL_CLOCK`
- **浮动 IP 自动切换**：脚本检测延迟超过阈值时，将读流量切换至主库

## 常见踩坑案例

### 踩坑 1：binlog 格式选择不当

**问题**：使用 `STATEMENT` 格式的 binlog，遇到 `UUID()`、`NOW()`、`RAND()` 等不确定函数时，主从数据不一致。

**症状**：主从数据不一致，`pt-table-checksum` 校验报错。

**解决**：

```ini
# 推荐使用 ROW 格式，记录每行数据的实际变更
binlog_format = ROW
```

> `ROW` 格式虽然 binlog 体积更大，但安全性和一致性最好。生产环境强烈推荐。

### 踩坑 2：大事务导致复制延迟

**问题**：一次性删除 100 万行数据，主库执行了 30 秒，从库也需要回放 30 秒，造成严重延迟。

**症状**：`Seconds_Behind_Master` 飙升到几十甚至几百秒。

**解决**：分批执行大操作：

```php
// 分批删除，每批 1000 条
while (true) {
    $deleted = DB::table('logs')
        ->where('created_at', '<', '2023-01-01')
        ->limit(1000)
        ->delete();

    if ($deleted === 0) break;

    usleep(100000); // 休眠 100ms，给从库回放时间
}
```

### 踩坑 3：从库误写导致复制中断

**问题**：开发者连接到从库执行了写操作，导致主从数据不一致或复制中断。

**解决**：

```ini
# 从库强制只读
read_only = ON
super_read_only = ON  # MySQL 5.7+，连 SUPER 权限也限制写入
```

### 踩坑 4：relay log 损坏

**问题**：服务器异常断电导致 relay log 文件损坏，从库复制中断。

**解决**：

```ini
# 开启 relay log 自动恢复
relay_log_recovery = ON
# 将 relay log 信息存储到表中（比文件更可靠）
relay_log_info_repository = TABLE
```

### 踩坑 5：字符集不一致

**问题**：主库 utf8mb4，从库 utf8，遇到 emoji 字符时复制报错。

**解决**：确保主从库的 `character_set_server` 和表的字符集完全一致：

```sql
-- 检查字符集
SHOW VARIABLES LIKE 'character_set%';
SHOW VARIABLES LIKE 'collation%';
```

### 踩坑 6：GTID 复制中断恢复

**问题**：从库意外宕机重启后，GTID 集合不连续，复制报错 `GTID has already been executed`。

**症状**：`Last_SQL_Error` 提示 GTID 冲突，`Slave_SQL_Running: No`。

**解决**：

```sql
-- 1. 查看当前 GTID 状态
SELECT @@global.gtid_executed;
SELECT @@global.gtid_purged;

-- 2. 如果确认从库已包含该事务的数据，跳过冲突事务
STOP SLAVE;
SET GTID_NEXT = 'server_uuid:transaction_id';  -- 填入冲突的 GTID
BEGIN; COMMIT;  -- 空事务标记为已执行
SET GTID_NEXT = 'AUTOMATIC';
START SLAVE;

-- 3. 或者重新构建从库（推荐用于严重不一致场景）
-- 在从库执行
RESET SLAVE ALL;
CHANGE MASTER TO
    MASTER_HOST = '192.168.1.100',
    MASTER_USER = 'repl_user',
    MASTER_PASSWORD = 'StrongPassword123!',
    MASTER_AUTO_POSITION = 1;
START SLAVE;
```

> **注意**：跳过事务仅适用于确认数据已同步的场景，否则会导致主从数据不一致。生产环境建议使用 `pt-table-sync` 校验并修复。

### 踩坑 7：MySQL 8.0 `CHANGE MASTER TO` 语法变更

**问题**：MySQL 8.0.23 起 `CHANGE MASTER TO` 被废弃，使用新语法 `CHANGE REPLICATION SOURCE TO`。

**解决**：

```sql
-- MySQL 8.0.23+ 新语法
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST = '192.168.1.100',
    SOURCE_PORT = 3306,
    SOURCE_USER = 'repl_user',
    SOURCE_PASSWORD = 'StrongPassword123!',
    SOURCE_AUTO_POSITION = 1;

START REPLICA;  -- 替代 START SLAVE
SHOW REPLICA STATUS\G  -- 替代 SHOW SLAVE STATUS
```

## 主从复制监控脚本

```bash
#!/bin/bash
# check_replication.sh - 主从复制健康检查

SLAVE_STATUS=$(mysql -e "SHOW SLAVE STATUS\G")

IO_RUNNING=$(echo "$SLAVE_STATUS" | grep "Slave_IO_Running:" | awk '{print $2}')
SQL_RUNNING=$(echo "$SLAVE_STATUS" | grep "Slave_SQL_Running:" | awk '{print $2}')
SECONDS_BEHIND=$(echo "$SLAVE_STATUS" | grep "Seconds_Behind_Master:" | awk '{print $2}')

if [ "$IO_RUNNING" != "Yes" ] || [ "$SQL_RUNNING" != "Yes" ]; then
    echo "[CRITICAL] 复制异常: IO=$IO_RUNNING, SQL=$SQL_RUNNING"
    # 发送告警...
fi

if [ "$SECONDS_BEHIND" -gt 10 ] 2>/dev/null; then
    echo "[WARNING] 主从延迟: ${SECONDS_BEHIND}s"
    # 发送告警...
fi

echo "[OK] 复制正常，延迟: ${SECONDS_BEHIND}s"
```

### 使用 pt-heartbeat 精确监控延迟

`Seconds_Behind_Master` 在并行复制下精度不足。Percona 的 `pt-heartbeat` 通过在主库写入时间戳、从库读取对比来计算真实延迟：

```bash
# 1. 在主库后台运行心跳写入
pt-heartbeat --update --database heartbeat --create-table --daemonize

# 2. 在从库持续监控延迟
pt-heartbeat --monitor --database heartbeat --master-server-id=1
# 输出示例: 0.02s   (精确到毫秒的延迟)

# 3. 集成到告警系统（延迟超过 5s 报警）
pt-heartbeat --monitor --database heartbeat --master-server-id=1 \
    --threshold 5 --print-master-server-id
```

```sql
-- 在主库创建心跳表（pt-heartbeat 也会自动创建）
CREATE DATABASE IF NOT EXISTS heartbeat;
USE heartbeat;
CREATE TABLE heartbeat (
    id         INT NOT NULL PRIMARY KEY,
    ts         DECIMAL(16,6) NOT NULL,
    file       VARCHAR(255) DEFAULT NULL,
    position   BIGINT DEFAULT NULL,
    relay_master_log_file VARCHAR(255) DEFAULT NULL,
    exec_master_log_pos   BIGINT DEFAULT NULL
) ENGINE=InnoDB;
```

## 总结

MySQL 主从复制是构建高可用、高性能数据库架构的基础。在生产环境中，推荐使用 **GTID + ROW 格式 + 并行复制** 的组合，配合 Laravel 的读写分离配置，可以有效分散数据库压力。同时要建立完善的监控体系，及时发现和处理主从延迟、复制中断等问题。

## 相关阅读

- [数据库读写分离实战：Laravel 中间件 + MySQL 主从复制配置](/categories/databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/)
- [MySQL 数据类型选型](/categories/databases/data-types/)
- [控制并发](/categories/databases/concurrency-control/)
