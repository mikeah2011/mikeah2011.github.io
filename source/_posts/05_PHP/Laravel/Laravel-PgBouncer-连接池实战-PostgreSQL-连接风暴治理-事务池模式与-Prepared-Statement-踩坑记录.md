---
title: Laravel + PgBouncer 连接池实战：PostgreSQL 连接风暴治理、事务池模式与 Prepared Statement 踩坑记录
date: 2026-05-03 10:10:28
updated: 2026-05-03 10:12:38
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, MySQL, PostgreSQL, 性能优化, 监控]description: 结合 Laravel 订单与后台查询混跑场景，记录如何用 PgBouncer 解决 PostgreSQL 连接风暴、空闲连接过多、事务池模式兼容性与 prepared statement 失效等一组真实生产问题。
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

所以我的经验是：PgBouncer 解决“连接风暴”，索引和查询治理解决“事务占用时间”，两个问题必须分开看。

## 六、一套我验证过的参数基线

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

## 七、上线后的实际效果

这次改造后，指标确实稳定了：

- PostgreSQL 活跃连接从 280~320 降到 60~90
- `idle` 连接大幅下降，shared buffer 更稳定
- 高峰期接口 P95 从 180ms 降到 95ms
- 扩 worker 数量时，不再立刻打爆数据库连接

最重要的是，数据库终于能把资源花在执行查询上，而不是维护大量短生命周期连接。

## 八、我的结论

如果你的 Laravel 服务已经出现下面任意两个症状：数据库连接数长期偏高、`idle` 连接很多、PHP-FPM/worker 一扩容数据库就不稳、数据库 CPU 不高却老报连接满，就该认真看 PgBouncer 了。

但要记住，PgBouncer 真正难的不是装起来，而是**识别哪些代码依赖 session 状态、哪些 SQL 会长时间占住事务、哪些流量必须拆直连**。这层想明白了，连接池才会是增益。
