---

title: ShardingSphere-Proxy 分库分表实战：Laravel 订单中心按用户路由、全局 ID 与跨片查询降级踩坑记录
keywords: [ShardingSphere, Proxy, Laravel, ID, 分库分表实战, 订单中心按用户路由, 全局, 与跨片查询降级踩坑记录]
date: 2026-05-03 09:40:55
updated: 2026-05-03 09:40:55
categories:
- database
tags:
- Laravel
- MySQL
- 分库分表
- shardsphere-proxy
- 跨片查询
description: 结合 Laravel 订单中心的真实治理过程，完整记录基于 ShardingSphere-Proxy 的分库分表落地方案。从 ShardingSphere-Proxy Docker 部署、分片规则配置、Laravel Repository 层路由约束，到全局 ID 生成、跨片查询降级策略、双写校验迁移、Prometheus 监控接入，再到线上高频踩坑（COUNT 广播、事务跨片、whereIn 散射）的逐一拆解，帮助你在 Laravel + MySQL 体系下把 ShardingSphere-Proxy 从 PoC 推到生产可用。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-1-content-1.jpg
- /images/content/databases-1-content-2.jpg
---


订单表在 3000 万行之前，靠索引、冷热字段拆分和归档还能勉强顶住；一旦运营后台开始按状态、渠道、出行日期、退款状态混查，再叠加支付回调、履约任务和财务导出，单表的写放大、索引膨胀和分页扫描会一起爆出来。我们在一个 Laravel 订单中心里把 `orders` 从单库单表迁到 **ShardingSphere-Proxy + MySQL 分片**，目标并不是“为了炫技上分库分表”，而是把最热的订单写入、用户维度查询和后台导出拆开治理。

## 一、最后落地的架构

```text
                +---------------- Admin / API / Job ----------------+
                |                Laravel Application                |
                +---------------------------+-----------------------+
                                            |
                                     PDO / MySQL Driver
                                            |
                              +-------------v--------------+
                              |     ShardingSphere-Proxy   |
                              | SQL 解析 / 路由 / 改写 / 合并 |
                              +------+------+--------------+
                                     |      |
                    +----------------+      +----------------+
                    v                                        v
              order_ds_0                                 order_ds_1
           orders_0 ~ orders_3                       orders_0 ~ orders_3
```

![ShardingSphere-Proxy 分库分表架构示意图](/images/content/databases-1-content-1.jpg)

分片策略很克制：**按 `user_id` 分库分表，`order_id` 只做全局主键，不做路由键**。原因很现实，前台“我的订单”、大部分支付补偿、退款回查都天然带用户维度；一旦把分片键选成订单号，后台查用户订单、风控查账户行为都会变成散射查询。

我们不只切了 `orders` 一张表，`order_items`、`order_payments` 也统一按 `user_id` 分片。这个决定很关键，因为真正的热点往往不是订单主表本身，而是“订单 + 明细 + 支付记录”的联动写入。如果主单在 A 片、支付记录在 B 片，应用层马上就会出现伪分布式事务和跨片补偿，复杂度比单库还高。

## 二、ShardingSphere-Proxy 规则不要写得太“聪明”

我们上线时的核心配置如下，是真能跑的：

```yaml
rules:
  - !SHARDING
    tables:
      orders:
        actualDataNodes: order_ds_${0..1}.orders_${0..3}
        tableStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: orders_inline
        databaseStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: db_inline
        keyGenerateStrategy:
          column: order_id
          keyGeneratorName: snowflake
    shardingAlgorithms:
      db_inline:
        type: INLINE
        props:
          algorithm-expression: order_ds_${user_id % 2}
      orders_inline:
        type: INLINE
        props:
          algorithm-expression: orders_${user_id % 4}
    keyGenerators:
      snowflake:
        type: SNOWFLAKE
```

这里有个很容易踩的坑：别在表达式里混入业务状态，比如“已支付进热表、已取消进冷表”。这会让更新 SQL 带上分片键变更风险，后续迁移和修复都很痛。**分片规则越稳定越好，冷热分层请在归档链路做。**

另一个常被忽略的点是子表冗余字段。我们原来 `order_payments` 只有 `order_id`，迁移后强制补了 `user_id`。原因很简单：支付回调写支付记录时，如果只有订单号没有路由键，Proxy 只能广播。分片系统里，少一次冗余字段，往往就是多十倍查询成本。

## 三、Laravel 侧接入几乎不改 ORM，但要强约束查询入口

![Laravel 与数据库分片集成](/images/content/databases-1-content-2.jpg)

Laravel 这边我们没有魔改 Eloquent，而是把连接直接指向 Proxy：

```php
'mysql_order' => [
    'driver' => 'mysql',
    'host' => env('ORDER_DB_HOST', '127.0.0.1'),
    'port' => env('ORDER_DB_PORT', 3307),
    'database' => env('ORDER_DB_DATABASE', 'order_app'),
    'username' => env('ORDER_DB_USERNAME', 'root'),
    'password' => env('ORDER_DB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'strict' => true,
],
```

真正关键的是 Repository 层必须强制带路由键：

```php
final class OrderRepository
{
    public function findByUserAndOrderId(int $userId, int $orderId): ?Order
    {
        return Order::on('mysql_order')
            ->where('user_id', $userId)
            ->where('order_id', $orderId)
            ->first();
    }

    public function create(array $payload): Order
    {
        return Order::on('mysql_order')->create($payload);
    }
}
```

我们专门禁掉了“只按 `order_id` 查订单详情”的默认写法，因为这类 SQL 到 Proxy 层通常无法精准路由，最后会广播到所有分片。线上最夸张的一次，运营后台一个详情页就把 8 个分片同时打满。

为了把约束落到代码里，我们又包了一层查询服务，缺少 `user_id` 就直接抛异常：

```php
final class RoutedOrderQueryService
{
    public function detail(int $userId, int $orderId): OrderData
    {
        if ($userId <= 0) {
            throw new InvalidArgumentException('Missing sharding key: user_id');
        }

        $order = Order::on('mysql_order')
            ->query()
            ->where('user_id', $userId)
            ->where('order_id', $orderId)
            ->with(['items', 'payments'])
            ->firstOrFail();

        return OrderData::fromModel($order);
    }
}
```

这段代码看起来有点“教条”，但它挡住了很多事故。尤其是新人排查问题时，很容易先写一条“查详情”SQL；在单库阶段这没问题，在分片阶段就是隐性全路由。**把分片约束前置到 API 层，比靠 DBA 在慢日志里救火靠谱得多。**

## 四、迁移策略：先双写校验，再切读流量

分库分表最怕的不是规则写错，而是迁移阶段数据对不上。我们的步骤很保守：先建 Proxy 和目标分片表，不切线上流量；然后按 `user_id` 回灌历史订单；接着短期双写，主库继续写、分片库同步写并记录校验日志；等订单数、金额汇总、状态分布都对齐后，再先切“我的订单”读流量，最后切后台查询和异步任务。

回灌脚本核心逻辑如下：

```php
DB::connection('legacy_mysql')
    ->table('orders')
    ->orderBy('id')
    ->chunkById(1000, function ($orders) {
        $payloads = [];

        foreach ($orders as $order) {
            $payloads[] = [
                'order_id' => $order->id,
                'user_id' => $order->user_id,
                'status' => $order->status,
                'total_amount' => $order->total_amount,
                'created_at' => $order->created_at,
                'updated_at' => $order->updated_at,
            ];
        }

        DB::connection('mysql_order')
            ->table('orders')
            ->insert($payloads);
    });
```

这里还有一个真实坑：如果历史表是自增主键，而新系统准备用 Snowflake，全量回灌时一定要先决定“保留旧 ID 还是映射新 ID”。我们最后选择**历史订单保留原 `order_id`，新写入才走 Snowflake**，否则支付单据、退款单据和外部对账系统都得跟着改，风险非常高。

## 五、跨片查询不要硬扛，要主动降级

后台列表最开始还是想一步到位：

```sql
SELECT *
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
```

这条 SQL 在分片后没有 `user_id`，Proxy 只能全路由，再做归并排序，`COUNT(*)` 更慢。后来我们改成两段式：先查近 7 天、按状态和时间做索引化筛选，只拿订单 ID；再按分片键回表。至于导出，直接走离线任务和 CQRS/搜索索引，不再打在线分片库。这个调整比继续给 Proxy“喂复杂 SQL”有效得多。

更细一点说，我们把查询分成三类：

- **用户中心查询**：必须带 `user_id`，直接走在线分片库。
- **运营后台筛选**：走投影表或搜索索引，只返回订单 ID 列表。
- **财务导出/对账**：走异步任务，结果写对象存储，绝不实时扫分片库。

很多团队上了分库分表后还想保留“一个库承接所有查询”的旧模型，最后觉得中间件不稳定。其实问题不在 ShardingSphere，而在查询边界没重画清楚。

## 六、四个最值钱的踩坑记录

### 1. `order_id` 不是万能路由键
支付、退款、履约回调里如果拿不到 `user_id`，不要直接查分片表。我们后来在 Redis 保留 `order_id -> user_id` 的短期映射，回调先补齐路由键，再访问分片库。

### 2. 分页的 `COUNT(*)` 会把你拖死
后台列表如果保留传统分页，每翻一页都要跨片聚合总数。我们的做法是后台改成“游标翻页 + 近似总数提示”，导出另走异步任务。

### 3. 事务边界必须留在单分片内
Laravel 里看起来只是普通 `DB::transaction()`，但如果一次事务里写了跨用户数据，底层就可能落到多个分片。我们最后的规范是：**交易型写入只允许单用户、单分片完成**；跨片对账和修复全部异步化。

### 4. `whereIn(order_id, ...)` 很容易意外打散路由
有一次运营批量重试支付，代码只写了 `whereIn('order_id', $ids)`。看上去只是 20 个订单，但它们属于 20 个用户，Proxy 只能广播到全部分片。后来我们改成先按 `user_id` 分组，再逐组查询；如果拿不到用户维度，就直接转异步任务。

## 七、ShardingSphere-Proxy Docker Compose 部署配置

生产环境我们用 Docker Compose 部署 ShardingSphere-Proxy，以下是可直接使用的配置：

```yaml
# docker-compose.yml
version: '3.8'

services:
  shardingsphere-proxy:
    image: apache/shardingsphere-proxy:5.4.1
    container_name: shardingsphere-proxy
    ports:
      - "3307:3307"
    volumes:
      - ./conf:/opt/shardingsphere-proxy/conf
      - ./ext-lib:/opt/shardingsphere-proxy/ext-lib
    environment:
      - JVM_MEMORY_OPTS=-Xms512m -Xmx512m -Xmn256m
      - TZ=Asia/Shanghai
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-P", "3307"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - sharding-net

networks:
  sharding-net:
    driver: bridge
```

对应的 `conf/server.yaml` 必须显式配置治理和连接限制：

```yaml
# conf/server.yaml
authority:
  users:
    - user: root@%
      password: your_strong_password
    - user: sharding_user@%
      password: sharding_pass
  privilege:
    type: ALL_PERMITTED

props:
  max-connections-size-per-query: 8
  kernel-executor-size: 16
  proxy-frontend-flush-threshold: 128
  proxy-hint-enabled: false
  sql-show: true
  sql-simple: false
  check-table-metadata-enabled: false
  show-process-list-enabled: true
```

> **线上经验**：`max-connections-size-per-query` 决定单次跨片查询最多同时打开多少连接。设太高会在全路由时打满后端 MySQL 连接池；设太低会导致查询排队。我们最终设为分片数（8），配合 Proxy 连接池上限 200，刚好扛住高峰期的运营后台查询。

## 八、跨片查询降级：更多代码示例

### 场景一：运营后台按状态 + 时间范围查订单

这类查询没有 `user_id`，直接打到 Proxy 会全路由。我们的降级方案是走投影表：

```php
final class AdminOrderQueryService
{
    /**
     * 运营后台：按状态+时间范围查询，走投影表而非分片库
     */
    public function listByStatusAndDate(string $status, string $from, string $to): LengthAwarePaginator
    {
        // 投影表是全量维度表，只存 order_id + user_id + status + created_at
        // 由 binlog 同步任务每 5 分钟更新
        return DB::connection('mysql_projection')
            ->table('order_projection')
            ->where('status', $status)
            ->whereBetween('created_at', [$from, $to])
            ->orderByDesc('created_at')
            ->paginate(20);
    }
}
```

### 场景二：支付回调只拿到 order_id，需要补路由键

```php
final class PaymentCallbackHandler
{
    public function __construct(
        private Redis $redis,
        private OrderRepository $orderRepo,
    ) {}

    public function handle(int $orderId, array $paymentData): void
    {
        // 先从 Redis 缓存拿 user_id（写入时由应用层维护）
        $userId = $this->redis->hget("order_route:{$orderId}", 'user_id');

        if ($userId === null) {
            // 缓存未命中，查路由映射表（独立的非分片表）
            $mapping = DB::connection('mysql_order_meta')
                ->table('order_user_mapping')
                ->where('order_id', $orderId)
                ->first();

            if (!$mapping) {
                throw new RuntimeException("Order {$orderId} routing info missing, cannot process callback");
            }

            $userId = $mapping->user_id;
            $this->redis->hset("order_route:{$orderId}", 'user_id', $userId);
            $this->redis->expire("order_route:{$orderId}", 86400 * 7);
        }

        // 现在有 user_id 了，可以精准路由
        $order = $this->orderRepo->findByUserAndOrderId((int) $userId, $orderId);
        // ... 继续处理支付逻辑
    }
}
```

### 场景三：批量查询多用户订单，按 user_id 分组避免广播

```php
final class BatchOrderService
{
    /**
     * 批量查订单：先按 user_id 分组，再逐组查，避免 whereIn 广播
     */
    public function batchGetOrders(array $userIdOrderIds): Collection
    {
        // 输入格式: [[user_id => 1001, order_id => 50001], ...]
        $grouped = collect($userIdOrderIds)->groupBy('user_id');
        $results = collect();

        foreach ($grouped as $userId => $items) {
            $orderIds = $items->pluck('order_id')->toArray();

            $orders = Order::on('mysql_order')
                ->where('user_id', $userId)
                ->whereIn('order_id', $orderIds)
                ->get();

            $results = $results->concat($orders);
        }

        return $results;
    }
}
```

## 九、分片方案对比：ShardingSphere-Proxy vs ShardingSphere-JDBC vs 手动分片

| 维度 | ShardingSphere-Proxy | ShardingSphere-JDBC | 手动分片（应用层） |
|------|---------------------|--------------------|--------------------|
| **部署模式** | 独立中间件进程，应用无感知 | JAR 嵌入应用，同 JVM 进程 | 无中间件，全靠应用代码 |
| **语言兼容** | 任何语言（PHP/Go/Java 等） | 仅 Java/Kotlin | 任何语言 |
| **Laravel 适配** | ✅ 天然兼容，PDO 直连 | ❌ 需要 Java 层 | ✅ 完全可控 |
| **SQL 兼容性** | 高（解析 + 路由 + 改写 + 归并） | 高（同上） | 取决于代码质量 |
| **运维复杂度** | 中等（需维护 Proxy 进程和配置） | 低（无额外进程） | 高（分片逻辑散落各处） |
| **性能开销** | 多一跳网络 + SQL 解析（约 2-5ms） | 零网络跳转，本地解析 | 无额外开销 |
| **跨片查询** | 自动全路由 + 结果归并 | 自动全路由 + 结果归并 | 需手动实现聚合 |
| **全局 ID** | 内置 Snowflake/UUID | 内置 Snowflake/UUID | 需自建（Redis/Leaf 等） |
| **读写分离** | 内置支持 | 内置支持 | 需手动实现 |
| **适用场景** | 多语言团队、PHP/Laravel 项目 | 纯 Java 技术栈 | 极简分片、分片数固定且少 |
| **我们选型理由** | Laravel 是 PHP，JDBC 不可用 | — | 维护成本太高，pass |

> **结论**：Laravel + PHP 技术栈几乎只能选 Proxy 模式。如果团队是纯 Java，JDBC 模式性能更优。手动分片只适合分片逻辑极简、分片数极少（2-4 张）的场景。

## 十、监控与可观测性：Prometheus 指标接入

ShardingSphere-Proxy 5.x 内置了 Prometheus metrics 暴露端口，默认在 `9090`（可在启动参数中配置）。

### 启用 Prometheus 指标

在 `conf/server.yaml` 中添加：

```yaml
props:
  proxy-metrics-enabled: true
  proxy-metrics-port: 9090
```

### Prometheus 采集配置

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'shardingsphere-proxy'
    static_configs:
      - targets: ['shardingsphere-proxy:9090']
    scrape_interval: 15s
    metrics_path: /metrics
```

### 核心监控指标

| 指标名称 | 含义 | 告警阈值建议 |
|---------|------|-------------|
| `proxy_current_connections` | 当前活跃连接数 | > 连接池上限 80% |
| `proxy_execute_latency_milliseconds_bucket` | SQL 执行耗时分布 | P99 > 500ms |
| `proxy_sql_route_type{type="ALL"}` | 全路由 SQL 数量 | 占比 > 20% 持续 5 分钟 |
| `proxy_backend_connections_active` | 后端连接池活跃数 | > 总数 90% |
| `proxy_execute_error_total` | SQL 执行错误数 | rate > 10/min |

### 告警规则示例

```yaml
# alerts/shardingsphere.yml
groups:
  - name: shardingsphere-alerts
    rules:
      - alert: ProxyFullRouteHigh
        expr: rate(proxy_sql_route_type{type="ALL"}[5m]) / rate(proxy_sql_route_type[5m]) > 0.3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "ShardingSphere-Proxy 全路由比例过高"
          description: "近 5 分钟全路由 SQL 占比超过 30%，可能存在未带分片键的查询"

      - alert: ProxyBackendPoolExhausted
        expr: proxy_backend_connections_active / proxy_backend_connections_total > 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "ShardingSphere-Proxy 后端连接池即将耗尽"

      - alert: ProxyExecuteLatencyHigh
        expr: histogram_quantile(0.99, rate(proxy_execute_latency_milliseconds_bucket[5m])) > 500
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "ShardingSphere-Proxy P99 延迟超过 500ms"
```

> **关键指标**：`proxy_sql_route_type` 是最重要的指标。如果 `type="ALL"`（全路由）的比例持续超过 20%，说明大量查询缺少分片键，需要排查应用层代码。我们在 Grafana 面板上把这个指标做成实时饼图，一眼就能看出当天有多少查询走了全路由。

## 十一、更多生产踩坑案例

### 5. DDL 同步遗漏导致分片表结构不一致

新增字段时只改了一个分片的表结构，其他分片漏掉。Proxy 执行 SQL 时部分分片成功、部分报错，应用层看到的错误信息非常模糊（通常是 `Column not found`），排查方向容易跑偏到索引或 ORM 层。

**解决方案**：所有 DDL 必须通过 Proxy 执行（Proxy 会自动广播到所有分片），禁止直连后端 MySQL 做 DDL。在 CI 流水线中加入 DDL 审核步骤，强制检查 schema 一致性。我们用了一个简单的校验脚本：

```bash
# 校验所有分片的表结构是否一致
for ds in order_ds_0 order_ds_1; do
  for tbl in orders_0 orders_1 orders_2 orders_3; do
    mysql -h ${ds} -e "SHOW CREATE TABLE ${tbl}" | grep -v "Create Table" | md5sum
  done
done
# 所有 md5 应该一致，不一致则报警
```

### 6. Proxy 进程 OOM 导致全站不可用

大批量数据导入时，一条 `INSERT INTO ... VALUES (...),(...),(...)` 带了上万行数据，Proxy 解析 SQL 的内存消耗暴涨，触发 OOM。Proxy 进程挂掉后，所有依赖它的写入和查询全部超时。

**解决方案**：应用层限制单次批量写入行数（我们限制为 500 行/批）；同时调整 Proxy JVM 参数为 `-Xmx2g -Xms2g`，并设置 `-XX:+UseG1GC -XX:MaxGCPauseMillis=200`。同时配合 Docker 的 `restart: unless-stopped` 策略，Proxy OOM 后自动重启，配合健康检查实现秒级恢复。

### 7. 时区不一致导致分片路由错误

Laravel 应用时区是 `Asia/Shanghai`，Proxy 容器默认 `UTC`，导致 `created_at` 条件查询在边界时间点路由到错误分片。这类 bug 极其隐蔽：白天测试没问题，凌晨 0 点前后查询结果不一致。

**解决方案**：在 `docker-compose.yml` 中显式设置 `TZ: Asia/Shanghai`，并在 Laravel 的 `database.php` 配置中添加 `'timezone' => '+08:00'` 确保连接层时区一致。

### 8. 监控盲区：Proxy 健康但后端 MySQL 已经过载

Proxy 层面指标一切正常（连接数低、延迟正常），但后端某个分片的 MySQL 已经 CPU 100%。原因是 Proxy 的健康检查只检查自身进程，不检查后端真实状态。

**解决方案**：除了 Proxy 的 Prometheus 指标，后端每个 MySQL 实例也需要独立监控。我们在 Grafana 上做了联合面板：Proxy 路由指标 + 后端 MySQL 的 `SHOW PROCESSLIST` 慢查询数 + CPU/内存，三者联动才能看到完整的链路健康状态。

## 十二、上线后的收益

迁移完成后，订单写入 P95 从 180ms 降到 65ms，用户订单列表 P95 从 900ms 降到 140ms；更重要的是，支付高峰期间再也不会出现单表自增锁和热点索引页争抢。代价也很明确：SQL 书写自由度下降，所有查询都必须围着分片键设计。

如果你现在的 Laravel 系统只是“单表几百万行有点慢”，我不建议立刻上分库分表；但如果你已经确认瓶颈来自**热点写入、超大分页、索引膨胀、数据生命周期完全不同**，那 ShardingSphere-Proxy 是一条很务实的路。前提是先接受一个事实：**分库分表不是数据库层魔法，而是应用查询模型的重构。**

## 相关阅读

- [分库分表：分片策略、中间件选型与雪花算法全面解析](/databases/sharding/)
- [数据库读写分离实战：Laravel 中间件 + MySQL 主从复制配置](/databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/)
- [MySQL 慢查询治理实战：pt-query-digest 分析、索引优化与 SQL 重写](/databases/slow-query-governance/)
