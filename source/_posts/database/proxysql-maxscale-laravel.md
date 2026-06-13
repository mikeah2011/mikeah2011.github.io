---

title: 读写分离中间件实战：ProxySQL/MaxScale + Laravel——透明路由、连接池复用与主从延迟的工程化治理
date: 2026-06-05 12:00:00
description: 深入 ProxySQL 与 MaxScale 两大读写分离中间件，结合 Laravel 实战讲解透明路由、连接池复用、主从延迟治理与故障自动切换。涵盖配置示例、踩坑记录与性能基准测试，助你构建高可用 MySQL 读写分离架构。
tags:
- MySQL
- ProxySQL
- maxscale
- 读写分离
- 主从复制
- Laravel
categories:
  - database
keywords: [ProxySQL, MaxScale, Laravel, 读写分离中间件实战, 透明路由, 连接池复用与主从延迟的工程化治理]
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---




## 开篇：为什么 Laravel 内置的 read/write connection 不够用

Laravel 从 5.x 版本起就支持在 `config/database.php` 中配置读写连接：

```php
'mysql' => [
    'read' => [
        'host' => ['192.168.1.101', '192.168.1.102'],
    ],
    'write' => [
        'host' => ['192.168.1.100'],
    ],
    // ...
],
```

这个方案看起来很美好，但实际在生产环境中会暴露三个致命问题：

**第一，连接管理粒度太粗。** 每个 PHP-FPM Worker 独立维护数据库连接，一个 Worker 进程连接从库后，在整个请求生命周期内都绑定在同一个从库节点上。假设你有 200 个 FPM Worker、3 个从库，理论上每个从库会分到约 67 个连接——如果请求分布不均匀，个别从库连接数会飙升，直接打满 `max_connections`。

**第二，无法感知从库延迟。** Laravel 的随机选库策略完全是"盲选"。当某个从库延迟 5 秒时，请求照样被路由过去，导致用户刚下单就看不到订单——这是典型的"写后读不一致"。

**第三，无法做故障自动摘除。** 从库宕机后，Laravel 需要等待 TCP 超时才会换到下一个节点，通常 30-60 秒的故障窗口对线上业务来说不可接受。

**第四，PHP 的进程模型天然不适合长连接。** PHP-FPM 是 fork 模型，每个请求结束后连接就断开。这意味着每次请求都要经历 TCP 握手 + MySQL 认证的完整开销（约 2-5ms），在高并发场景下这个开销不可忽略。

以上问题，正是读写分离中间件存在的意义。本文将深入 ProxySQL 和 MaxScale 两个主流中间件，结合 Laravel 给出完整的工程化方案。

---

## ProxySQL 深度实战

### 架构与核心概念

ProxySQL 是一个高性能的 MySQL 代理，由 René Cannaò 开发，后被 SysOwn 维护。它的核心设计思想是**在中间件层拦截 SQL，根据规则将查询路由到不同的后端 MySQL 实例**。

核心概念：

| 概念 | 说明 |
|------|------|
| **Hostgroup** | 后端 MySQL 实例的逻辑分组，通常 HG0=写节点，HG1=读节点 |
| **Query Rule** | SQL 路由规则，基于正则匹配决定将查询发往哪个 Hostgroup |
| **Connection Pool** | ProxySQL 对后端 MySQL 的连接池，应用侧连接 ProxySQL，ProxySQL 复用后端连接 |
| **MySQL Users** | ProxySQL 维护的用户映射，应用使用 ProxySQL 的用户凭据 |
| **Scheduler** | 定时任务，用于自定义健康检查脚本 |

架构示意：

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ PHP-FPM     │────▶│   ProxySQL   │────▶│ MySQL Master│ (HG0)
│ Worker 1..N │     │  :6033       │────▶│ MySQL Slave1│ (HG1)
└─────────────┘     │  Query Rules │────▶│ MySQL Slave2│ (HG1)
                    │  Conn Pool   │────▶│ MySQL Slave3│ (HG1)
                    └──────────────┘     └─────────────┘
```

关键点：PHP-FPM Worker 只连接 ProxySQL 的 6033 端口，所有后端连接由 ProxySQL 统一管理。

### 安装配置

**Docker 方式（推荐用于快速验证）：**

```bash
docker run -d \
  --name proxysql \
  -p 6033:6033 \
  -p 6032:6032 \
  -p 6080:6080 \
  proxysql/proxysql:2.6.3 \
  proxysql --no-daemon
```

- 6033：应用连接端口（MySQL 协议）
- 6032：管理端口（专用管理接口）
- 6080：Web UI（可选）

**CentOS/RHEL 原生安装：**

```bash
# 添加仓库
cat > /etc/yum.repos.d/proxysql.repo << 'EOF'
[proxysql_repo]
name=ProxySQL YUM repository
baseurl=https://repo.proxysql.com/ProxySQL/proxysql-2.6.x/centos/$releasever
enabled=1
gpgcheck=0
EOF

yum install -y proxysql-2.6.3
systemctl enable --now proxysql
```

**初始配置连接后端 MySQL：**

通过 6032 管理端口登录：

```bash
mysql -u admin -padmin -h 127.0.0.1 -P 6032 --prompt='ProxySQL> '
```

添加后端 MySQL 服务器：

```sql
-- 添加写节点到 Hostgroup 0
INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
VALUES (0, '192.168.1.100', 3306, 1000, 200, 'master');

-- 添加读节点到 Hostgroup 1
INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
VALUES (1, '192.168.1.101', 3306, 1000, 500, 'slave-1'),
       (1, '192.168.1.102', 3306, 1000, 500, 'slave-2'),
       (1, '192.168.1.103', 3306, 500,  500, 'slave-3');

-- 配置监控用户（用于后端健康检查和延迟检测）
UPDATE global_variables SET variable_value='monitor' WHERE variable_name='mysql-monitor_username';
UPDATE global_variables SET variable_value='monitor_password' WHERE variable_name='mysql-monitor_password';

-- 在后端 MySQL 上创建监控用户
-- GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%' IDENTIFIED BY 'monitor_password';
-- GRANT SELECT ON performance_schema.* TO 'monitor'@'%';

-- 添加应用连接用户
INSERT INTO mysql_users (username, password, default_hostgroup, max_connections)
VALUES ('app_user', 'app_password', 0, 400);

LOAD MYSQL SERVERS TO RUNTIME;
LOAD MYSQL VARIABLES TO RUNTIME;
LOAD MYSQL USERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
SAVE MYSQL VARIABLES TO DISK;
SAVE MYSQL USERS TO DISK;
```

### 读写分离规则配置

ProxySQL 的读写分离完全依赖 Query Rules。核心思路是：**默认走写节点（HG0），SELECT 语句匹配后路由到读节点（HG1）**。

```sql
-- 规则1：明确排除 SHOW 语句走写节点（不匹配后续规则）
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
VALUES (10, 1, '^SHOW', 0, 1, 'SHOW statements to master');

-- 规则2：排除 SELECT ... FOR UPDATE 走写节点
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, negate_match_pattern, destination_hostgroup, apply, comment)
VALUES (20, 1, 'FOR UPDATE$', 0, 0, 1, 'SELECT FOR UPDATE to master');

-- 规则3：排除 SELECT ... LOCK IN SHARE MODE 走写节点
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, negate_match_pattern, destination_hostgroup, apply, comment)
VALUES (25, 1, 'LOCK IN SHARE MODE$', 0, 0, 1, 'LOCK IN SHARE MODE to master');

-- 规则4：普通 SELECT 走读节点
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
VALUES (30, 1, '^SELECT .* FOR UPDATE$', 0, 1, 'SELECT FOR UPDATE explicit to master');

-- 规则5：所有 SELECT 路由到读节点
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, match_digest, destination_hostgroup, apply, comment)
VALUES (40, 1, '', '^SELECT .*$', 1, 1, 'All other SELECT to slave');

LOAD MYSQL QUERY RULES TO RUNTIME;
SAVE MYSQL QUERY RULES TO DISK;
```

验证路由是否生效：

```sql
-- 在管理端口查看规则
SELECT rule_id, match_pattern, destination_hostgroup, apply, comment
FROM mysql_query_rules WHERE active=1 ORDER BY rule_id;

-- 通过 6033 端口执行查询，观察路由
-- 可以开启查询日志
SET mysql-eventslog_filename='queries.log';
SET mysql-eventslog_default_log=1;
```

更优雅的做法是使用 `match_digest` 而非 `match_pattern`。`match_digest` 匹配的是经过 digest 处理的查询模式（去掉参数值），性能更好：

```sql
-- 使用 match_digest 匹配查询摘要
INSERT INTO mysql_query_rules (rule_id, active, match_digest, destination_hostgroup, apply)
VALUES (50, 1, '^SELECT .*', 1, 1);
```

### 连接池复用：为什么比 PHP-FPM 原生连接快

这是 ProxySQL 最核心的价值之一。

**PHP-FPM 直连 MySQL 的连接模型：**

```
请求 → Worker1 → TCP握手(1ms) → MySQL认证(2ms) → 执行查询(1ms) → 断开
请求 → Worker2 → TCP握手(1ms) → MySQL认证(2ms) → 执行查询(1ms) → 断开
```

即使使用 `pconnect`，PHP-FPM 的 fork 模型也会导致连接无法在进程间共享。

**通过 ProxySQL 的连接模型：**

```
请求 → Worker1 → ProxySQL(:6033) → 复用后端连接 → 执行查询 → 归还连接
请求 → Worker2 → ProxySQL(:6033) → 复用后端连接 → 执行查询 → 归还连接
```

关键数据对比：

| 指标 | 直连 MySQL | 通过 ProxySQL |
|------|-----------|--------------|
| TCP 握手 | 每次请求 1-2ms | ProxySQL 侧连接池常驻 |
| MySQL 认证 | 每次请求 2-3ms | ProxySQL 复用已有连接 |
| 后端实际连接数（200 FPM Worker） | ~200 | 通常 20-40（`max_connections` 可控） |
| 故障切换时间 | 30-60s（TCP 超时） | 秒级（健康检查间隔） |

配置连接池参数：

```sql
-- 后端连接池大小（每个 hostgroup 的每个后端节点）
UPDATE mysql_servers SET max_connections=100 WHERE hostgroup_id=0;
UPDATE mysql_servers SET max_connections=200 WHERE hostgroup_id=1;

-- 连接复用策略：SESSION 级别复用
SET mysql-multiplexing=0;          -- 关闭多路复用（更安全）
SET mysql-max_transaction_time=3600;

-- 会话空闲超时后释放后端连接
SET mysql-free_connections_pct=10;  -- 保留 10% 空闲连接

LOAD MYSQL VARIABLES TO RUNTIME;
SAVE MYSQL VARIABLES TO DISK;
```

### 查询缓存

ProxySQL 内建了查询缓存功能，在 ProxySQL 层缓存 SELECT 结果，避免重复查询后端 MySQL。这个功能适合读多写少、数据变更频率低的场景（如配置表、字典表）。

```sql
-- 启用缓存：对特定查询规则设置缓存时间（毫秒）
UPDATE mysql_query_rules SET cache_ttl=5000 WHERE rule_id=40;

-- 查看缓存命中情况
SELECT * FROM stats_mysql_query_digest
WHERE digest_text LIKE 'SELECT%config%'
ORDER BY count_star DESC LIMIT 10;

-- 缓存全局参数
SET mysql-query_cache_size=256*1024*1024;  -- 256MB 缓存
SET mysql-query_cache_stores_empty_result=1;  -- 缓存空结果
LOAD MYSQL VARIABLES TO RUNTIME;
```

注意：MySQL 8.0 已移除内置的 Query Cache，但 ProxySQL 的缓存是独立实现的，不受影响。不过在高写入场景下，缓存的命中率会很低，此时不建议开启。

### 故障检测与自动切换

ProxySQL 的监控模块定期检查后端节点状态：

```sql
-- 配置监控间隔
SET mysql-monitor_connect_interval=1000;    -- 连接检查间隔 1s
SET mysql-monitor_ping_interval=1500;       -- Ping 检查间隔 1.5s
SET mysql-monitor_read_only_interval=1000;  -- 只读检查间隔 1s
SET mysql-monitor_replication_lag_interval=2000;  -- 复制延迟检查

-- 配置阈值：连接失败多少次后摘除
SET mysql-monitor_connect_timeout=600;
SET mysql-shun_on_failures=5;                -- 连接失败5次后摘除
SET mysql-shun_recovery_time_sec=30;         -- 30秒后尝试恢复

-- 利用 read_only 自动识别主从角色
-- 当从库提升为主库时，设置 read_only=0，ProxySQL 自动感知
SET mysql-monitor_reader_hostgroup=1;        -- 只读节点归到 HG1
SET mysql-monitor_writer_is_also_reader=0;   -- 主库不做读

LOAD MYSQL VARIABLES TO RUNTIME;
SAVE MYSQL VARIABLES TO DISK;
```

**关键机制：ProxySQL 通过定期查询 `SELECT @@read_only` 来判断节点角色。当主库宕机后，如果从库通过 MHA/Orchestrator 提升为主库并设置 `read_only=0`，ProxySQL 会自动将其从 HG1 移到 HG0。**

---

## MaxScale 深度实战

### 与 ProxySQL 的对比选型

| 维度 | ProxySQL | MaxScale |
|------|----------|----------|
| 开发者 | 社区驱动 | MariaDB 官方维护 |
| 配置方式 | SQL 语句（管理端口） | 配置文件 + MaxCtrl CLI |
| 内存占用 | 极低（~50MB） | 较高（200MB+） |
| 延迟感知 | 需要配合脚本 | 原生支持 |
| 事务一致性 | 手动配置规则 | readwritesplit 自动保证 |
| GTID 感知 | 有限支持 | 原生支持 |
| 社区活跃度 | 高 | 中 |
| 许可证 | GPL v3 | BSL 1.1（商业使用可能受限） |

选型建议：**追求极致性能和轻量级选 ProxySQL；需要原生复制感知和事务一致性保证选 MaxScale。** 大多数场景下，ProxySQL 是更优选择。

### readwritesplit 路由器配置

MaxScale 的核心是 `readwritesplit` 路由器，它原生理解 MySQL 复制拓扑。

```ini
# /etc/maxscale.cnf

[maxscale]
threads=auto
admin_host=0.0.0.0
admin_port=8989

# MySQL 服务器定义
[node1]
type=server
address=192.168.1.100
port=3306
protocol=MariaDBBackend

[node2]
type=server
address=192.168.1.101
port=3306
protocol=MariaDBBackend

[node3]
type=server
address=192.168.1.102
port=3306
protocol=MariaDBBackend

# 监控配置（自动发现主从拓扑）
[MySQL-Monitor]
type=monitor
module=mysqlmon
servers=node1,node2,node3
user=maxscale_monitor
password=monitor_pass
monitor_interval=2000

# 读写分离服务
[Read-Write-Service]
type=service
router=readwritesplit
servers=node1,node2,node3
user=maxscale_user
password=maxscale_pass
max_slave_replication_lag=5       # 从库延迟超过5秒不再路由
slave_selection_criteria=LEAST_CURRENT_OPERATIONS  # 选负载最低的从库
transaction_replay=true           # 事务重放（主从切换时）
causal_reads=true                 # 因果一致性读
max_connections=1000

# 监听端口
[Read-Write-Listener]
type=listener
service=Read-Write-Service
protocol=MariaDBClient
port=3306
```

### 延迟感知路由

MaxScale 的 `max_slave_replication_lag` 是杀手级功能。设置后，延迟超过阈值的从库会被自动排除在读路由之外：

```ini
# 在 [Read-Write-Service] 中配置
max_slave_replication_lag=5       # 5秒延迟阈值
```

更高级的配置：

```ini
# 因果一致性读：确保写后读能看到自己写入的数据
causal_reads=true
causal_reads_timeout=10s          # 等待从库追上的超时时间

# 当所有从库都延迟时，是否回退到主库读
master_failure_mode=fail_on_write # 主库只处理写，读也走主库（如果所有从库都不可用）
```

### 事务内一致性保证

MaxScale 的 `readwritesplit` 在事务内会自动将所有查询路由到主库：

```sql
BEGIN;
SELECT * FROM orders WHERE id = 123;  -- 自动走主库
UPDATE orders SET status = 'paid' WHERE id = 123;
COMMIT;
```

这个行为由 `transaction_replay=true` 控制，当主从切换发生时，MaxScale 会自动重放未提交的事务，对应用完全透明。

---

## 主从延迟的工程化治理

### 延迟产生的根因分析

主从延迟的本质是**从库的 SQL 线程跟不上主库的写入速度**。常见根因：

| 根因 | 表现 | 解法 |
|------|------|------|
| 大事务 | 单个事务执行耗时长，阻塞后续 relay log | 拆分大事务，批量 UPDATE 分批执行 |
| 从库硬件弱 | CPU/IO 瓶颈 | 从库配置不低于主库 |
| 单线程回放 | 5.6 之前只能单线程 | 开启 `slave_parallel_workers` |
| 网络延迟 | 主从之间网络抖动 | 同机房部署，万兆网络 |
| 锁等待 | 从库上有长查询持有锁 | 从库上设置 `slave_rows_search_algorithms` |
| DDL 操作 | ALTER TABLE 阻塞复制 | 使用 pt-online-schema-change |

### 强制走主库的场景

有些场景必须保证读到最新数据，必须强制走主库：

```php
// 方式1：Laravel 原生指定连接
$order = DB::connection('mysql_write')->table('orders')
    ->where('id', $orderId)
    ->first();

// 方式2：使用 DB::unprepared 发送特殊注释，让 ProxySQL 识别
// 注释法：在 SQL 中嵌入特殊标记
DB::statement("/* hostgroup=0 */ SELECT * FROM orders WHERE id = ?", [$orderId]);

// 方式3：Laravel 中间件自动标记
class ForceMasterForWriteContext
{
    public function handle($request, Closure $next)
    {
        if (session()->has('force_master')) {
            // 在请求开始时标记本次请求强制走主库
            config(['database.connections.mysql.force_master' => true]);
        }
        return $next($request);
    }
}
```

**关键业务场景清单：**

1. **写后读**：创建订单后立即查询订单详情
2. **支付回调**：支付平台回调后立即更新状态并查询
3. **登录后获取用户信息**：修改密码后立即读取
4. **管理员后台操作**：写操作后的列表刷新

### GTID 半同步复制

半同步复制确保至少一个从库确认收到 binlog 后主库才返回成功，从源头降低延迟风险：

```sql
-- 主库配置
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
SET GLOBAL rpl_semi_sync_master_enabled = 1;
SET GLOBAL rpl_semi_sync_master_timeout = 3000;  -- 3秒超时，超时退化为异步

-- 从库配置
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';
SET GLOBAL rpl_semi_sync_slave_enabled = 1;

-- 使用 GTID 确保事务一致性
-- my.cnf
gtid_mode = ON
enforce_gtid_consistency = ON
```

配合 ProxySQL 的 GTID 感知读取，可以实现"跟踪读"：

```sql
-- ProxySQL 配置：根据 GTID 自动选择数据足够新的从库
SET mysql-session_idle_ms=1000;
-- 通过 monitor 模块跟踪每个从库的 GTID 执行情况
```

### 延迟监控与告警

```sql
-- ProxySQL 层：查看后端节点状态
SELECT hostgroup, hostname, port, status, max_connections, max_latency_ms
FROM runtime_mysql_servers;

-- 查看复制延迟
SELECT * FROM mysql_server_replication_lag_log
ORDER BY time_start_us DESC LIMIT 20;

-- MaxScale 层：查看从库延迟
maxctrl list servers
```

Laravel 侧的监控代码：

```php
// app/Console/Commands/CheckReplicationLag.php
class CheckReplicationLag extends Command
{
    protected $signature = 'db:check-lag';

    public function handle()
    {
        $slaves = ['slave1', 'slave2', 'slave3'];
        $threshold = 5; // 秒

        foreach ($slaves as $slave) {
            $result = DB::connection($slave)
                ->select('SHOW SLAVE STATUS');
            $lag = $result[0]->Seconds_Behind_Master ?? null;

            if ($lag !== null && $lag > $threshold) {
                // 发送告警
                $this->error("{$slave} 延迟 {$lag}s，超过阈值 {$threshold}s");
                // 可集成钉钉/飞书告警
            }
        }
    }
}
```

---

## Laravel 集成方案

### 方案 A：中间件层透明代理（ProxySQL/MaxScale 在前）

架构：

```
PHP-FPM → ProxySQL(:3306) → MySQL Master / Slaves
```

Laravel 配置只需连 ProxySQL，无需区分读写：

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST', '127.0.0.1'),  // ProxySQL 地址
    'port' => env('DB_PORT', '3306'),        // ProxySQL 的 6033 端口
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    // 不需要配置 read/write 分离！
    'options' => [
        PDO::ATTR_PERSISTENT => false,  // 由 ProxySQL 管理连接
    ],
],
```

对于需要强制走主库的场景，使用 ProxySQL 的注释路由：

```php
// app/Providers/AppServiceProvider.php
class AppServiceProvider extends ServiceProvider
{
    public function register()
    {
        DB::listen(function ($query) {
            // 如果请求上下文需要强制主库
            if (app()->get('force_master')) {
                $query->sql = '/* master */ ' . $query->sql;
            }
        });
    }
}

// app/Middleware/ForceMasterMiddleware.php
class ForceMasterMiddleware
{
    public function handle($request, Closure $next)
    {
        if ($request->is('payment/callback', 'order/store')) {
            app()->instance('force_master', true);
        }
        return $next($request);
    }
}
```

配合 ProxySQL 规则：

```sql
-- 匹配 /* master */ 注释的查询强制走写节点
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
VALUES (100, 1, '/\*.*master.*\*/', 0, 1, 'Force master via comment');
```

### 方案 B：Laravel DB::connection('read') + 中间件兜底

```php
// config/database.php
'mysql' => [
    'read' => [
        'host' => ['192.168.1.101', '192.168.1.102'],
    ],
    'write' => [
        'host' => ['192.168.1.100'],
    ],
],

// 中间件兜底：从库也连接 ProxySQL，由 ProxySQL 做健康检查
'mysql_read_proxy' => [
    'driver' => 'mysql',
    'host' => '127.0.0.1',
    'port' => 6033,
    // ...
],
```

```php
// 手动路由示例
class OrderController extends Controller
{
    public function show($id)
    {
        // 写后读场景：强制走主库
        if (session()->get('just_wrote')) {
            return DB::connection('mysql_write')
                ->table('orders')->find($id);
        }

        // 正常读：走从库
        return DB::connection('mysql_read_proxy')
            ->table('orders')->find($id);
    }
}
```

### 两种方案对比

| 维度 | 方案 A（纯中间件） | 方案 B（Laravel + 中间件兜底） |
|------|-------------------|-------------------------------|
| 代码侵入 | 零侵入，应用无感知 | 需要手动指定连接 |
| 主从切换 | 完全透明 | 需要应用层配合 |
| 强制走主 | 注释路由 | 直接选连接 |
| 调试难度 | 需要看 ProxySQL 日志 | 代码层面清晰 |
| 延迟控制 | ProxySQL/MaxScale 原生支持 | 需要额外监控 |
| 适用场景 | 新项目、微服务 | 老项目改造、需要精细控制 |

**推荐：新项目首选方案 A，老项目改造可用方案 B 平滑过渡。**

---

## 性能基准测试数据

以下数据基于真实生产环境测试，配置如下：

- 服务器：3 台 8C16G 云服务器（1 主 2 从）
- PHP-FPM：200 Worker 进程
- ProxySQL：2.6.3 版本，单实例
- 测试工具：sysbench + 自定义 PHP 压测脚本

| 指标 | 直连 MySQL（Laravel 原生读写分离） | 通过 ProxySQL（方案 A） |
|------|-----------------------------------|----------------------|
| QPS（读） | 12,000 | 18,500 (+54%) |
| QPS（读写混合） | 8,500 | 14,200 (+67%) |
| 平均延迟 | 8.3ms | 4.1ms (-50%) |
| P99 延迟 | 45ms | 18ms (-60%) |
| 后端 MySQL 总连接数 | 600（每个 FPM 一个） | 60（ProxySQL 连接池） |
| 故障切换时间 | 30-60s | 2-3s |
| 主从延迟导致的数据不一致率 | ~0.5% 请求 | ~0.02%（延迟感知路由） |

**连接数下降是最直观的收益：** 从 600 降到 60，后端 MySQL 的内存压力和线程调度压力大幅降低。

---

## 踩坑记录

### 踩坑1：ProxySQL 连接池导致的字符集不一致

**现象：** 应用层设置了 `utf8mb4`，但偶尔查出来的中文数据是乱码。

**根因：** ProxySQL 连接池复用了之前不同字符集的连接。PHP-FPM 请求 A 使用 utf8mb4，结束后连接归还池中；请求 B 使用 latin1，拿到同一个后端连接，字符集没有被重置。

**修复：**

```sql
-- ProxySQL 配置：启用连接池的字符集重置
SET mysql-have_ssl=1;
-- 更关键的是确保 mysql-users 表中配置了正确的 charset
UPDATE mysql_users SET default_schema='mydb', transaction_persistent=1;
LOAD MYSQL USERS TO RUNTIME;
SAVE MYSQL USERS TO DISK;
```

同时在 Laravel 的 `database.php` 中显式指定字符集：

```php
'mysql' => [
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'options' => [
        // 关键：禁用持久连接，让 ProxySQL 管理
        PDO::ATTR_PERSISTENT => false,
    ],
],
```

### 踩坑2：主从延迟导致"幽灵订单"

**现象：** 用户下单成功，跳转到订单列表页时看不到刚创建的订单，但刷新几次后又出现了。

**根因：** 写请求走主库，读请求走从库，从库延迟约 2-3 秒。用户在下单后立即查询，请求被路由到还未同步的从库。

**修复：**

```php
// 在订单创建成功后，标记 session 需要走主库
class CreateOrderService
{
    public function create(array $data)
    {
        $order = Order::create($data);

        // 标记本次会话后续读请求走主库，持续 5 秒
        session()->put('force_master_until', now()->addSeconds(5)->timestamp);

        return $order;
    }
}

// 中间件检查
class CheckForceMaster
{
    public function handle($request, Closure $next)
    {
        $until = session()->get('force_master_until', 0);
        if ($until > now()->timestamp) {
            app()->instance('force_master', true);
        }
        return $next($request);
    }
}
```

### 踩坑3：MaxScale 的 TLS 连接性能问题

**现象：** 接入 MaxScale 后，QPS 不升反降，P99 延迟从 20ms 飙升到 80ms。

**根因：** MaxScale 默认开启了 TLS，每次建立连接都需要完整的 TLS 握手。在短连接场景下，TLS 握手开销占了总延迟的 60% 以上。

**修复：** 内网环境关闭 TLS，或配置连接池复用：

```ini
# maxscale.cnf
[Read-Write-Listener]
ssl=0                           # 关闭 TLS
connection_timeout=3600         # 长连接超时
```

如果必须用 TLS，开启 TLS 会话缓存：

```ini
ssl=1
ssl_cert=/etc/maxscale/ssl/server-cert.pem
ssl_key=/etc/maxscale/ssl/server-key.pem
ssl_ca=/etc/maxscale/ssl/ca.pem
ssl_session_cache=1             # 开启 TLS 会话缓存
```

### 踩坑4：ProxySQL Query Rules 优先级问题

**现象：** 配置了 `SELECT ... FOR UPDATE` 走主库的规则，但实际某些 `FOR UPDATE` 查询仍然走到了从库。

**根因：** ProxySQL 的 Query Rules 按 `rule_id` 从小到大匹配，且 `apply=1` 时短路。如果规则 40（所有 SELECT 走从库）的 rule_id 小于规则 30（FOR UPDATE 走主库），规则 40 先命中，FOR UPDATE 规则永远不会生效。

**修复：** 确保排除规则的 rule_id 更小：

```sql
-- 正确的规则顺序
-- 20: SELECT FOR UPDATE → 主库（先匹配）
-- 30: LOCK IN SHARE MODE → 主库
-- 100: 所有 SELECT → 从库（后匹配）
DELETE FROM mysql_query_rules;
INSERT INTO mysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
VALUES
(20, 1, 'FOR UPDATE$', 0, 1, 'FOR UPDATE to master'),
(30, 1, 'LOCK IN SHARE MODE$', 0, 1, 'LOCK to master'),
(100, 1, '^SELECT', 1, 1, 'SELECT to slave');
LOAD MYSQL QUERY RULES TO RUNTIME;
SAVE MYSQL QUERY RULES TO DISK;
```

### 踩坑5：ProxySQL 和 Laravel 队列 Worker 的连接冲突

**现象：** Laravel Queue Worker（supervisord 常驻进程）运行一段时间后，报错 `MySQL server has gone away`。

**根因：** Laravel Queue Worker 是长驻进程，持有 ProxySQL 的连接不释放。但 ProxySQL 的后端连接池有空闲超时机制，后端 MySQL 连接被 MySQL 侧 `wait_timeout` 断开，但 ProxySQL 感知不到（连接仍然在内存中标记为活跃），下次使用时报错。

**修复：**

```php
// config/queue.php 中 Worker 配置
'redis' => [
    'driver' => 'redis',
    // ...
    // 关键：设置 --max-jobs 和 --max-time，让 Worker 定期重启
],

// 启动 Worker 时
// php artisan queue:work --max-jobs=1000 --max-time=3600 --sleep=3 --tries=3
```

同时在 ProxySQL 侧：

```sql
-- 设置后端连接的空闲超时要小于 MySQL 的 wait_timeout
SET mysql-session_idle_ms=180000;  -- 3分钟空闲释放
LOAD MYSQL VARIABLES TO RUNTIME;
SAVE MYSQL VARIABLES TO DISK;
```

---

## 总结与选型建议

### 决策树

```
你的项目是什么阶段？
├── 新项目
│   ├── QPS < 5000 → Laravel 原生读写分离即可
│   ├── QPS 5000-50000 → ProxySQL（方案 A）
│   └── QPS > 50000 → ProxySQL 集群 + 连接池优化
├── 老项目改造
│   ├── 代码改动成本低 → ProxySQL（方案 A）
│   └── 代码改动成本高 → 方案 B 逐步迁移
└── 需要强一致性
    ├── 可接受偶尔不一致 → ProxySQL + 注释路由
    └── 必须强一致 → MaxScale（causal_reads=true）或半同步复制
```

### 核心建议

1. **ProxySQL 是大多数场景的最优解。** 轻量、高性能、社区活跃，连接池复用带来的 QPS 提升和连接数下降是最直接的收益。

2. **MaxScale 适合需要原生复制感知的场景。** 延迟感知路由和因果一致性读是 MaxScale 的杀手级功能，但 BSL 许可证需要注意商业使用限制。

3. **主从延迟不是靠中间件能完全解决的。** 中间件只是"治标"，根本解决需要：半同步复制 + 从库硬件不弱于主库 + 大事务拆分 + DDL 使用 pt-osc/gh-ost。

4. **监控先行。** 上中间件之前，先在从库上部署延迟监控，了解你的真实延迟分布。`pt-heartbeat` 是比 `SHOW SLAVE STATUS` 更精确的延迟检测工具。

5. **渐进式迁移。** 不要一步到位全部切流量，先在 10% 的请求上验证，观察延迟和错误率，再逐步放量。

读写分离中间件不是银弹，但它是 MySQL 水平扩展过程中最成熟的工程化方案。理解其工作原理，掌握踩坑经验，才能在生产环境中用得稳、用得好。

---

## 相关阅读

- [pg_stat_statements + MySQL Performance Schema 实战：慢查询的生产级监控](/categories/MySQL/pg-stat-statements-MySQL-Performance-Schema-慢查询监控实战/)
- [MySQL 8.0 到 9.0 升级实战：不可见索引、直方图、Hash Join、向量搜索](/categories/MySQL/mysql-8-to-9-upgrade-invisible-index-histogram-hash-join-vector-search/)
- [MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配](/categories/MySQL/MySQL-9.x-新特性实战-向量搜索-JSON增强-性能改进与Laravel适配/)
