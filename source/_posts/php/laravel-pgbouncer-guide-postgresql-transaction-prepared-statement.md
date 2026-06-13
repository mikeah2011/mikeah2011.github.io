---

title: Laravel + PgBouncer 连接池实战：PostgreSQL 连接风暴治理、事务池模式与 Prepared Statement 踩坑记录
keywords: [Laravel, PgBouncer, PostgreSQL, Prepared Statement, 连接池实战, 连接风暴治理, 事务池模式与, 踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 10:10:28
updated: 2026-05-03 10:12:38
categories:
- php
- database
tags:
- Laravel
- PostgreSQL
- PgBouncer
- 连接池
- 数据库
- 性能优化
- 监控
description: Laravel 连接 PostgreSQL 遇到连接风暴？本文详解 PgBouncer 事务池模式配置、PDO prepared statement 踩坑修复、session vs transaction 池模式对比、监控指标与参数基线，附 Docker Compose 与 Laravel config 完整示例，帮你把数据库连接数压到稳定水位。
---


在 Laravel 单体逐步长大之后，CPU 往往不是第一个瓶颈，**数据库连接数**才是。我们曾把前台 API、后台报表、队列 worker 都直接连 PostgreSQL，高峰一来 `max_connections` 打满。后来真正把问题压下去，不是继续调大连接上限，而是在应用和 PostgreSQL 中间加一层 **PgBouncer**，把“连接很多”改成“请求很多，但后端连接稳定”。

## 一、为什么 Laravel 场景特别容易出现连接风暴

Laravel 本身没有错，问题在于它很容易把多种流量叠在一起：Nginx + PHP-FPM 的短连接请求、队列 worker 的常驻进程、定时报表任务、管理后台分页导出。每一类都觉得自己只占几个连接，叠起来就把 PostgreSQL 顶满了。

```text
                 ┌────────────────────┐
Web / Admin / Job│ Laravel API & Queue │
                 └─────────┬──────────┘
                           │ many client connections
                           ▼
                 ┌────────────────────┐
                 │     PgBouncer      │
                 │ session / tx pool  │
                 └─────────┬──────────┘
                           │ limited server connections
                           ▼
                 ┌────────────────────┐
                 │   PostgreSQL 15    │
                 │  CPU / shared buf  │
                 └────────────────────┘
```

我这次处理的是订单中心 + 后台列表共库的场景，故障特征很典型：

- `FATAL: sorry, too many clients already`
- `pg_stat_activity` 里一堆 `idle` 连接
- 数据库 CPU 不算满，但连接切换很频繁
- 队列 worker 一加机器，数据库反而更不稳定

最容易犯的错，就是把 `max_connections` 从 300 改到 1000，结果只是让 PostgreSQL 花更多内存在“服务更多连接”，而不是“执行更多 SQL”。

## 二、落地架构：把连接复用前移，而不是继续堆数据库参数

我的最终做法是把应用连接统一切到 PgBouncer，PostgreSQL 只接受稳定数量的后端连接：

```yaml
# docker-compose.pg.yml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"

  pgbouncer:
    image: edoburu/pgbouncer:1.22.1
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: app
      DB_PASSWORD: secret
      DB_NAME: app
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 1000
      DEFAULT_POOL_SIZE: 80
      RESERVE_POOL_SIZE: 20
      SERVER_RESET_QUERY: DISCARD ALL
      IGNORE_STARTUP_PARAMETERS: extra_float_digits
    ports:
      - "6432:5432"
    depends_on:
      - postgres
```

Laravel 不再直连 5432，而是改连 6432：

```php
// config/database.php
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '6432'),
    'database' => env('DB_DATABASE', 'app'),
    'username' => env('DB_USERNAME', 'app'),
    'password' => env('DB_PASSWORD', 'secret'),
    'charset' => 'utf8',
    'prefix' => '',
    'prefix_indexes' => true,
    'schema' => 'public',
    'sslmode' => 'prefer',
    'options' => [
        PDO::ATTR_EMULATE_PREPARES => true,
    ],
],
```

这里 `PDO::ATTR_EMULATE_PREPARES => true` 不是可有可无。因为我们最终采用的是 **transaction pool**，后端连接不会固定绑定某个客户端，请求结束后连接就会归还池子，服务端 prepared statement 很容易失效。

## 三、为什么我选 transaction pool，而不是 session pool

PgBouncer 有三种常见模式：`session`、`transaction`、`statement`。在 Laravel 里，真正适合高并发 API 的通常是 `transaction`：事务结束就归还连接，吞吐最平衡；而 `statement` 限制太多，基本不考虑。我的做法是前台 API、普通 CRUD、队列消费走 `transaction`，少量依赖 session 状态的脚本单独直连。

我最后在 Laravel 里拆了两个连接：

```php
'connections' => [
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST', 'pgbouncer'),
        'port' => env('DB_PORT', 6432),
        'database' => env('DB_DATABASE', 'app'),
        'username' => env('DB_USERNAME', 'app'),
        'password' => env('DB_PASSWORD', 'secret'),
        'options' => [PDO::ATTR_EMULATE_PREPARES => true],
    ],

    'pgsql_direct' => [
        'driver' => 'pgsql',
        'host' => env('DB_DIRECT_HOST', 'postgres'),
        'port' => env('DB_DIRECT_PORT', 5432),
        'database' => env('DB_DATABASE', 'app'),
        'username' => env('DB_USERNAME', 'app'),
        'password' => env('DB_PASSWORD', 'secret'),
    ],
],
```

报表导出、DDL、极少数需要长事务的任务，明确走 `pgsql_direct`，避免为了兼容个别场景放弃全局池化。

## 四、监控不是看 QPS，而是看池子有没有开始抖

PgBouncer 上线后，如果只看接口 RT，很容易误判。真正该盯的是池指标。我线上主要盯下面几项：

```sql
SHOW STATS;
SHOW POOLS;
SHOW CLIENTS;
SHOW SERVERS;
```

如果 `cl_waiting` 开始抬头，说明客户端开始排队；如果 `sv_active` 长期顶着 `default_pool_size`，说明池子已经满载；如果 PostgreSQL 本体 `active` 不高但 PgBouncer 排队上升，通常是某类 SQL 把事务占太久了。

我还专门加了一个健康检查命令，用在 k8s readiness：

```bash
psql "host=127.0.0.1 port=6432 dbname=pgbouncer user=pgbouncer" -c "SHOW VERSION;"
```

这个检查比单纯探 PostgreSQL 更有意义，因为很多时候数据库是活的，真正出问题的是池层。

## 五、这次最值钱的三个坑

### 坑一：prepared statement 在 transaction pool 下随机报错

最开始我们直接把 Laravel 接到 PgBouncer，压测几分钟后开始出现：`prepared statement "pdo_stmt_xxx" does not exist`。原因很直接：客户端认为自己还在同一个会话里，实际上后端连接已经换了。

修复方式有两个：

1. Laravel/PDO 侧启用 `ATTR_EMULATE_PREPARES`
2. 不要依赖 session 级 prepared statement 缓存

这个改完后，报错直接清零。代价是少量 SQL 失去服务端 prepare 的收益，但值得。

### 坑二：用了 transaction pool，却在代码里偷偷依赖 session 状态

我们有个旧脚本会先 `SET search_path TO tenant_xxx`，后面所有 SQL 默认认为状态还在。切到 transaction pool 之后，第二条 SQL 就可能跑到别的后端连接，自然全错。

后来我把这类逻辑改成显式 schema 前缀，或者在事务内部执行：

```php
DB::connection('pgsql_direct')->transaction(function () use ($tenantSchema) {
    DB::statement('SET LOCAL search_path TO ' . preg_replace('/[^a-z0-9_]/i', '', $tenantSchema));

    $orders = DB::table('orders')->where('status', 'paid')->count();

    logger()->info('tenant orders counted', ['count' => $orders]);
});
```

注意这里是 `SET LOCAL`，它只在事务内生效，出了事务就回收，不会污染别的请求。

### 坑三：池子把连接数压住了，但慢 SQL 被放大得更明显

PgBouncer 不是性能魔法。它只能减少连接建立和空闲连接浪费，**不能修复坏 SQL**。我们上线第一周，连接错误消失了，但后台订单列表一到高峰还是排队。最后查到是一个 `order_items` 聚合查询没走索引，单条事务占连接 600ms 以上，导致 `cl_waiting` 持续升高。

所以我的经验是：PgBouncer 解决"连接风暴"，索引和查询治理解决"事务占用时间"，两个问题必须分开看。

## 六、PgBouncer vs ProxySQL：该选哪个

很多人会问，连接池方案这么多，为什么选 PgBouncer？下面做一个直接对比：

| 维度 | PgBouncer | ProxySQL |
|------|-----------|----------|
| 支持数据库 | PostgreSQL | MySQL / MariaDB（PostgreSQL 支持实验性） |
| 连接池模式 | session / transaction / statement | transaction / session |
| 配置复杂度 | 极简，单个 ini 文件 | 中等，支持运行时 SQL 管理 |
| 查询路由/读写分离 | 不支持，需配合 HAProxy 或应用层 | 原生支持规则路由 |
| Prepared Statement | transaction 模式需应用层适配 | MySQL 协议天然支持 |
| 资源占用 | 极低（~2MB 内存起步） | 中等（需 SQLite 后端） |
| 适用场景 | PostgreSQL 专用，纯连接复用 | MySQL 生态，需要路由/缓存 |

**结论**：如果你的数据库是 PostgreSQL，PgBouncer 是首选；如果 MySQL 且需要读写分离，ProxySQL 更合适。

## 七、三种池模式速查对比

| 特性 | session 模式 | transaction 模式 | statement 模式 |
|------|-------------|-----------------|---------------|
| 连接绑定时机 | 客户端连接即分配 | 事务开始分配，结束归还 | 每条 SQL 分配 |
| 连接复用率 | 低 | 高 | 最高 |
| Session 状态支持 | ✅ 完整 | ❌ 不可靠 | ❌ 不可用 |
| Prepared Statement | ✅ 正常 | ⚠️ 需 emulate | ❌ 不可用 |
| `SET` / `LISTEN` / `NOTIFY` | ✅ 正常 | ❌ 不可靠 | ❌ 不可用 |
| 适合场景 | 长连接、WebSocket、需要 session 变量 | 高并发 API、CRUD、队列消费 | 极端短查询（几乎不用） |
| Laravel 推荐 | 低并发后台、报表脚本 | **API / Queue / 默认** | 不推荐 |

> **实际选择**：大部分 Laravel 项目用 `transaction` 模式作为默认连接，少量依赖 session 状态的脚本单独走 `session` 模式或直连 PostgreSQL。

## 八、真实踩坑：LISTEN/NOTIFY 在 transaction 模式失效

Laravel 的 `Event::listen` + PostgreSQL `NOTIFY` 机制依赖持久会话。在 transaction pool 模式下，`LISTEN channel` 注册后连接归还，下一条消息到来时可能分到别的连接，导致收不到通知。

**解决方案**：需要 `LISTEN/NOTIFY` 的进程（如实时通知 worker）必须走直连或 session 模式：

```php
// .env
DB_CONNECTION=pgsql          // transaction pool，给 API/Queue
DB_DIRECT_CONNECTION=pgsql_direct  // session 直连，给 NOTIFY worker
```

```php
// app/Jobs/RealtimeNotificationListener.php
class RealtimeNotificationListener
{
    public function handle(): void
    {
        $pdo = DB::connection('pgsql_direct')->getPdo();
        $pdo->exec('LISTEN order_status_changed');

        while (true) {
            $pdo->pgsqlGetNotify(\PDO::FETCH_ASSOC, 30_000);
            // 处理通知...
        }
    }
}
```

## 九、真实踩坑：PgBouncer 重启时的连接断裂

PgBouncer 本身重启或升级时，所有客户端连接会被断开。Laravel 默认会报 `server closed the connection unexpectedly`。

**缓解措施**：

1. **Laravel 层**：在 `config/database.php` 加 `reconnect` 选项或使用 `sticky` 中间件
2. **PgBouncer 层**：用 `SO_REUSEPORT` 启动新进程再 graceful shutdown 旧进程（zero-downtime 重启）
3. **应用层**：队列 worker 加 `--tries=3 --backoff=5` 自动重试

```bash
# 队列 worker 启动命令，加重试保护
php artisan queue:work --tries=3 --backoff=5 --max-time=3600
```

## 十、上线 Checklist：部署前必须确认的 5 件事

1. ✅ `PDO::ATTR_EMULATE_PREPARES => true` 已设置
2. ✅ 所有 `SET search_path` 改为 `SET LOCAL` 或 schema 前缀
3. ✅ `LISTEN/NOTIFY`、`PREPARE` 等 session 依赖代码走直连
4. ✅ PgBouncer `server_reset_query = DISCARD ALL` 已配置
5. ✅ 队列 worker 已加 `--tries` 重试机制

```bash
# 快速验证：连 PgBouncer 端口执行简单查询
psql "host=127.0.0.1 port=6432 dbname=app user=app" -c "SELECT 1 AS ok;"

# 验证池模式
psql "host=127.0.0.1 port=6432 dbname=pgbouncer user=pgbouncer" -c "SHOW CONFIG;" | grep pool_mode

# 验证 emulate prepares（Laravel Tinker）
php artisan tinker --execute="dd(DB::connection()->getPdo()->getAttribute(PDO::ATTR_EMULATE_PREPARES));"
```

## 十一、一套我验证过的参数基线

这不是通用最优解，但对中型 Laravel API 很好用：

```ini
;; pgbouncer.ini
[databases]
app = host=postgres port=5432 dbname=app user=app password=secret

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 5432
auth_type = md5
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 80
min_pool_size = 20
reserve_pool_size = 20
reserve_pool_timeout = 3
max_db_connections = 100
server_reset_query = DISCARD ALL
server_idle_timeout = 30
query_wait_timeout = 10
ignore_startup_parameters = extra_float_digits
admin_users = app
stats_users = app
```

我一般先反推 PostgreSQL 能稳定承受多少活跃连接，再给 PgBouncer 留出池上限。比如数据库稳态 100 个活跃连接没问题，那 `max_db_connections` 就先卡在 100 左右，再根据 API、worker、后台任务的流量分布调 `default_pool_size`。

## 十二、上线后的实际效果

这次改造后，指标确实稳定了：

- PostgreSQL 活跃连接从 280~320 降到 60~90
- `idle` 连接大幅下降，shared buffer 更稳定
- 高峰期接口 P95 从 180ms 降到 95ms
- 扩 worker 数量时，不再立刻打爆数据库连接

最重要的是，数据库终于能把资源花在执行查询上，而不是维护大量短生命周期连接。

## 十三、我的结论

如果你的 Laravel 服务已经出现下面任意两个症状：数据库连接数长期偏高、`idle` 连接很多、PHP-FPM/worker 一扩容数据库就不稳、数据库 CPU 不高却老报连接满，就该认真看 PgBouncer 了。

但要记住，PgBouncer 真正难的不是装起来，而是**识别哪些代码依赖 session 状态、哪些 SQL 会长时间占住事务、哪些流量必须拆直连**。这层想明白了，连接池才会是增益。

## 相关阅读

- [Laravel + PostgreSQL 完整开发指南：从入门到生产实践](/post/laravel-postgresql-guide/)
- [PostgreSQL Advisory Lock 在 Laravel 中的实战：PgBouncer 环境下的分布式锁方案](/post/laravel-postgresql-advisory-lock-guide-pgbouncer/)
- [数据库连接池全面对比：PgBouncer vs ProxySQL vs Supabase 选型指南](/post/database-connection-pool-pgbouncer-proxysql-supabase-comparison/)

