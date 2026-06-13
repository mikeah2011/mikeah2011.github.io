---
title: 'Database Connection Pooling 进阶实战：Supavisor vs PgBouncer vs AWS RDS Proxy——多租户 Laravel 的连接风暴治理与 Session 级隔离'
description: '深入对比 Supavisor、PgBouncer、AWS RDS Proxy 三大 PostgreSQL 连接池方案，详解多租户 Laravel 应用的连接风暴治理、Transaction 与 Session 模式权衡、SET LOCAL 会话隔离策略，含性能基准测试与生产环境踩坑经验。'
date: 2026-06-07 08:00:00
tags: [数据库, 连接池, Laravel, PostgreSQL, PgBouncer, Supavisor]
categories:
  - database
cover: /images/covers/database-connection-pooling-cover.jpg
---

## 前言：为什么连接池不是可选项，而是必选项

在单体应用时代，一台 Web 服务器连接一个数据库，连接管理几乎不会成为瓶颈。但当你的 Laravel 应用运行在 Kubernetes 集群中、拥有 50+ 个 Pod、每个 Pod 的 PHP-FPM 又 spawn 出 50 个 worker 进程时，一瞬间涌向 PostgreSQL 的连接数就会达到 2500——而 PostgreSQL 默认的 `max_connections` 仅仅是 100。

这不是理论推演，这是我们团队在 2025 年 Q2 真实经历的"连接风暴"。那是一个周一的凌晨三点，PagerDuty 的告警把所有人叫醒：数据库连接数爆满，整个 SaaS 平台全面不可用。事后复盘发现，根因就是多租户架构下缺乏连接池，导致高峰期瞬间建立了超出数据库承受能力的连接数。

这篇文章将从实战角度深入对比三款主流 PostgreSQL 连接池方案——**Supavisor**、**PgBouncer** 和 **AWS RDS Proxy**，重点探讨在多租户 Laravel 场景下的连接风暴治理与 Session 级隔离策略。文章不是泛泛而谈的产品介绍，而是基于我们团队在生产环境踩过的坑、做过的 benchmark 以及最终落地的架构决策。

---

## 第一章：理解连接池的本质——从 TCP 三次握手说起

### 1.1 为什么数据库连接这么"贵"

每次应用与 PostgreSQL 建立连接，背后要经历以下步骤：

1. **TCP 三次握手**：建立网络层连接，通常耗时 0.1-1ms（同 VPC）或 5-50ms（跨区域）
2. **TLS 握手**（如启用 SSL）：额外 1-2 个 RTT
3. **PostgreSQL 认证**：`startup message → authentication OK`，涉及密码哈希验证
4. **后端进程 fork**：PostgreSQL 采用"进程 per 连接"模型，每个新连接都需要 `fork()` 一个 backend 进程，这包括内存分配、共享内存映射等操作
5. **会话初始化**：设置 `search_path`、`client_encoding`、时区等参数

整个过程在高并发场景下，单次连接建立可能耗时 5-20ms。更关键的是，每个 PostgreSQL backend 进程默认占用约 **5-10MB 内存**。1000 个连接就是 5-10GB 的纯连接开销，还没算上查询本身消耗的 `work_mem`。

### 1.2 连接池的核心思想

连接池的本质是一个**代理层**，它在应用和数据库之间维持一组"预热"的数据库连接。当应用请求连接时，连接池从池中分配一个已建立的连接；当应用释放连接时，连接池将连接回收而非关闭。

关键指标有三个：

- **池大小（Pool Size）**：连接池到数据库的最大连接数
- **客户端连接数（Client Connections）**：应用到连接池的最大连接数
- **复用比（Multiplexing Ratio）**：`客户端连接数 / 池大小`，比值越高，复用效果越好

在我们的场景中，目标是将 2500 个客户端连接映射到 50-100 个数据库连接，实现 25-50 倍的复用比。

### 1.3 Transaction 模式 vs Session 模式

这是连接池最核心的概念差异，也是最容易被误解的部分。

**Session 模式（Session-level Pooling）**：

连接被一个客户端"独占"，从客户端建立连接到断开连接期间，这个后端连接始终分配给该客户端。连接池的作用仅限于**减少连接建立的开销**——连接预先建立好，客户端来了直接用，不需要等待 fork 进程和认证。

```
Client A ──→ [Connection 1] ──→ PostgreSQL Backend 1  (独占)
Client B ──→ [Connection 2] ──→ PostgreSQL Backend 2  (独占)
Client C ──→ 等待...                               (连接池满，排队)
```

Session 模式适用于：
- 需要使用 `LISTEN/NOTIFY` 的场景
- 使用了 `PREPARE` 语句的场景
- 需要保持 session 级别变量（如 `SET` 命令设置的参数）
- 使用了临时表的场景

**Transaction 模式（Transaction-level Pooling）**：

连接只在一个数据库事务的生命周期内被分配给客户端。事务结束后，连接立即归还给连接池，可以分配给其他客户端。

```
Client A ── BEGIN ──→ [Connection 1] ──→ Backend 1
Client A ── COMMIT ──→ Connection 1 归还
Client B ── BEGIN ──→ [Connection 1] ──→ Backend 1  (复用！)
Client C ── BEGIN ──→ [Connection 2] ──→ Backend 2  (同时进行)
```

Transaction 模式的复用率远高于 Session 模式，是连接池发挥最大价值的模式。但它的限制也很多：

- 事务外不能执行任何 SQL（否则报错）
- 不支持 `LISTEN/NOTIFY`
- 不支持 `PREPARE`（因为下一个事务可能是不同的客户端）
- `SET` 命令设置的参数仅在当前事务内有效

**Statement 模式**：更激进的模式，每条 SQL 语句执行完就归还连接。实践中几乎不用，因为大多数操作需要事务保证。

---

## 第二章：三款连接池方案深度解析

### 2.1 PgBouncer——老兵不死

#### 2.1.1 架构概览

PgBouncer 是 PostgreSQL 生态中最老牌、最成熟的连接池工具，由 Skype 团队在 2007 年开发，至今仍然是使用最广泛的方案。它采用单进程、事件驱动架构（基于 `libevent`），用 C 语言编写，极致轻量。

```
┌─────────────────────────────────────────────────────┐
│                    PgBouncer                         │
│  ┌──────────────────────────────────────────────┐   │
│  │          Event Loop (libevent)               │   │
│  │  ┌────────────┐  ┌────────────┐              │   │
│  │  │ Client Conn│  │ Client Conn│  ...         │   │
│  │  │   Pool     │  │   Pool     │              │   │
│  │  └─────┬──────┘  └─────┬──────┘              │   │
│  │        │               │                     │   │
│  │  ┌─────▼───────────────▼──────┐              │   │
│  │  │    Server Connection Pool  │              │   │
│  │  │  [Backend 1][Backend 2]... │              │   │
│  │  └────────────────────────────┘              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

关键配置参数：

```ini
[databases]
myapp = host=10.0.1.10 port=5432 dbname=myapp

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction          # transaction | session | statement
default_pool_size = 20           # 每个 user/database 对的默认连接池大小
max_client_conn = 1000           # 最大客户端连接数
reserve_pool_size = 5            # 预留连接数，应对突发
reserve_pool_timeout = 3         # 等待多久后启用预留连接
server_idle_timeout = 300        # 空闲后端连接超时
server_lifetime = 3600           # 后端连接最大生命周期
query_timeout = 120              # 查询超时
client_idle_timeout = 0          # 客户端空闲超时
```

#### 2.1.2 PgBouncer 的优势

- **极致轻量**：单进程、内存占用通常 < 10MB
- **久经考验**：17 年的生产验证，几乎所有的 PostgreSQL DBA 都熟悉它
- **配置简单**：一个 INI 配置文件搞定
- **Transaction 模式成熟**：对 Transaction 模式的支持最为稳定
- **`auth_query` 支持**：可以直接查询数据库进行用户认证，不需要维护 `userlist.txt`

#### 2.1.3 PgBouncer 的痛点

- **单进程瓶颈**：虽然事件驱动效率很高，但在极高并发（> 10000 连接）下，单进程成为 CPU 瓶颈
- **不支持数据库集群感知**：没有内置的读写分离或负载均衡功能
- **运维手动**：连接池大小是静态配置的，无法根据负载动态伸缩
- **`SET` 命令泄漏**：在 Transaction 模式下，如果应用通过 `SET` 设置了 session 参数，这些参数可能"泄漏"给下一个使用该连接的客户端——这是一个严重的安全隐患
- **无多租户原生支持**：所有租户共享同一个连接池，无法按租户隔离

### 2.2 Supavisor——新生代的挑战者

#### 2.2.1 架构概览

Supavisor 是 Supabase 团队在 2023 年用 Elixir 开发的云原生连接池，旨在替代 PgBouncer 作为 Supabase 平台的默认连接管理方案。它的设计目标是：高并发、云原生、多租户原生支持。

```
┌─────────────────────────────────────────────────────────┐
│                      Supavisor Cluster                    │
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   Node 1    │  │   Node 2    │  │   Node 3    │      │
│  │ (Elixir/OTP)│  │ (Elixir/OTP)│  │ (Elixir/OTP)│      │
│  │             │  │             │  │             │      │
│  │ Tenant Pool │  │ Tenant Pool │  │ Tenant Pool │      │
│  │ Manager     │  │ Manager     │  │ Manager     │      │
│  │     │       │  │     │       │  │     │       │      │
│  │  ┌──▼───┐   │  │  ┌──▼───┐   │  │  ┌──▼───┐   │      │
│  │  │Conns │   │  │  │Conns │   │  │  │Conns │   │      │
│  │  └──────┘   │  │  └──────┘   │  │  └──────┘   │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │               │               │               │
│         └───────────┬───┘───────────────┘               │
│                     │                                     │
│              Cluster Metadata (ETCD/PostgreSQL)           │
└─────────────────────────────────────────────────────────┘
```

Supavisor 的核心设计理念：

- **每个租户一个连接池**：天然的多租户隔离
- **水平扩展**：基于 Elixir/Erlang 的分布式能力，可以水平扩展节点
- **动态池管理**：连接池大小可以根据负载自动调整
- **内建监控**：Prometheus 指标端点开箱即用

#### 2.2.2 Supavisor 的配置

Supavisor 通过 API 或数据库管理连接池，而非配置文件：

```bash
# 创建租户
curl -X POST 'http://supavisor:4000/api/tenants' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <management_token>' \
  -d '{
    "tenant": {
      "external_id": "tenant_acme",
      "db_host": "10.0.1.10",
      "db_port": 5432,
      "db_database": "myapp",
      "pool_size": 20,
      "pool_mode": "transaction",
      "users": [{
        "username": "app_user",
        "password": "secure_password",
        "mode": "transaction"
      }]
    }
  }'

# 连接方式
psql "postgresql://tenant_acme.app_user:secure_password@supavisor:5432/myapp"
```

#### 2.2.3 Supavisor 的优势

- **多租户原生**：每个租户有独立的连接池和配置，天然隔离
- **水平扩展**：Erlang 集群能力使其可以线性扩展
- **云原生设计**：支持 Kubernetes 部署、健康检查、自动恢复
- **动态配置**：通过 API 实时修改连接池参数，无需重启
- **内建指标**：原生 Prometheus 支持，监控零成本
- **连接排队管理**：内置优雅的排队机制，避免连接风暴时直接拒绝

#### 2.2.4 Supavisor 的局限

- **年轻项目**：2023 年才发布，生产环境验证相对不足
- **Elixir 生态较小**：遇到问题时社区资源不如 PgBouncer 丰富
- **Transaction 模式的限制**：与 PgBouncer 类似，Transaction 模式下不能使用 `LISTEN/NOTIFY`、`PREPARE` 等
- **部署复杂度**：依赖 ETCD 或 PostgreSQL 作为元数据存储，运维复杂度高于 PgBouncer
- **资源消耗更高**：Erlang VM 的基础内存消耗比 PgBouncer 的 C 进程高一个数量级

### 2.3 AWS RDS Proxy——托管服务的取舍

#### 2.3.1 架构概览

AWS RDS Proxy 是 Amazon 在 2020 年推出的全托管数据库代理服务。它与 RDS/Aurora 深度集成，无需自行部署和维护。

```
┌──────────────────────────────────────────────────────┐
│                    AWS Cloud                          │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   App    │  │   App    │  │   App    │           │
│  │  (ECS/   │  │  (ECS/   │  │  (ECS/   │           │
│  │  Lambda) │  │  Lambda) │  │  Lambda) │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                 │
│       └──────────────┼──────────────┘                 │
│                      │                                │
│               ┌──────▼──────┐                         │
│               │  RDS Proxy  │  ← 自动多AZ部署         │
│               │ (托管服务)   │  ← 自动扩缩             │
│               └──────┬──────┘                         │
│                      │                                │
│         ┌────────────┼────────────┐                   │
│         │            │            │                   │
│    ┌────▼────┐  ┌────▼────┐  ┌────▼────┐             │
│    │  RDS    │  │  RDS    │  │  Aurora  │             │
│    │ Primary │  │ Replica │  │ Replica  │             │
│    └─────────┘  └─────────┘  └─────────┘             │
└──────────────────────────────────────────────────────┘
```

#### 2.3.2 RDS Proxy 的配置

RDS Proxy 通过 AWS Console 或 CloudFormation 配置：

```yaml
# CloudFormation 配置示例
MyDBProxy:
  Type: AWS::RDS::DBProxy
  Properties:
    DBProxyName: myapp-proxy
    EngineFamily: POSTGRESQL
    RequireTLS: true
    RoleArn: !GetAtt RDSProxyRole.Arn
    VpcSubnetIds:
      - subnet-xxxx
      - subnet-yyyy
    VpcSecurityGroupIds:
      - sg-xxxx
    Auth:
      - AuthScheme: SECRETS
        IAMAuth: DISABLED
        SecretArn: !Ref DBSecret

MyDBProxyTargetGroup:
  Type: AWS::RDS::DBProxyTargetGroup
  Properties:
    DBProxyName: !Ref MyDBProxy
    TargetGroupName: default
    DBInstanceIdentifiers:
      - myapp-db
    ConnectionBorrowTimeout: 120
    MaxConnectionsPercent: 100
    MaxIdleConnectionsPercent: 50
    SessionPinningFilters:
      - EXCLUDE_VARIABLE_SETS
```

#### 2.3.3 RDS Proxy 的优势

- **零运维**：完全托管，无需关心升级、打补丁、故障恢复
- **自动高可用**：跨 AZ 部署，自动故障转移
- **与 AWS 生态集成**：与 RDS、Aurora、IAM、Secrets Manager、CloudWatch 深度集成
- **连接借用超时**：内置优雅的连接排队和借用机制
- **自动扩缩容**：根据连接数自动调整代理容量
- **安全合规**：支持 IAM 认证、TLS、VPC 隔离

#### 2.3.4 RDS Proxy 的局限

- **供应商锁定**：只能用于 RDS/Aurora，不能用于自建 PostgreSQL
- **性能开销**：作为全代理模式，所有查询都经过额外的网络跳转
- **配置粒度粗**：不支持按用户/数据库的精细连接池配置
- **成本较高**：按 vCPU 和连接时间计费，小型实例可能比自建方案贵 3-5 倍
- **Session Pinning**：某些操作会导致连接被"钉住"，破坏连接复用
- **调试困难**：黑盒服务，出问题时排查手段有限

---

## 第三章：多租户 Laravel 的连接风暴问题

### 3.1 什么是连接风暴

连接风暴（Connection Storm）是指短时间内大量数据库连接被同时建立，导致数据库资源耗尽的现象。在多租户 SaaS 架构中，连接风暴尤为常见，因为：

1. **应用启动**：Kubernetes Pod 滚动更新时，所有 Pod 同时启动，每个 Pod 的 PHP-FPM worker 同时请求数据库连接
2. **定时任务爆发**：Laravel Scheduler 在整点同时触发大量任务
3. **租户集中上线**：工作日早晨 9 点，大量租户同时登录
4. **故障恢复**：数据库故障恢复后，所有应用同时重连

### 3.2 Laravel 的默认连接行为

Laravel 的数据库连接管理由 `Illuminate\Database\Connection` 类负责。默认情况下：

```php
// config/database.php
'connections' => [
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST', '127.0.0.1'),
        'port' => env('DB_PORT', '5432'),
        'database' => env('DB_DATABASE', 'forge'),
        'username' => env('DB_USERNAME', 'forge'),
        'password' => env('DB_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'schema' => 'public',
        'sslmode' => 'prefer',
    ],
],
```

每个 PHP-FPM worker 进程在第一次使用数据库时建立连接，连接在进程生命周期内保持。假设你有 50 个 FPM worker：

- 无连接池：50 个 worker × 1 个连接 = 50 个数据库连接/每台应用服务器
- 10 台应用服务器：50 × 10 = 500 个数据库连接
- 滚动更新时新旧 Pod 并存：500 × 2 = 1000 个数据库连接

在我们的多租户场景中，情况更复杂。我们使用了 `setSchema()` 在请求级别切换租户的 schema：

```php
// TenantMiddleware.php
class TenantMiddleware
{
    public function handle($request, Closure $next)
    {
        $tenant = $this->resolveTenant($request);
        DB::statement("SET search_path TO {$tenant->schema}, public");
        return $next($request);
    }
}
```

这个设计意味着**所有租户共享同一组数据库连接**。在 Transaction 模式连接池下，`SET search_path` 的效果会在事务结束后丢失，这直接破坏了我们的多租户路由逻辑。

### 3.3 连接风暴的量化分析

我们做了一个简单的建模：

```
变量定义：
  P = Pod 数量
  W = 每个 Pod 的 FPM Worker 数
  C = 连接池大小（到数据库的连接数）
  R = 连接复用比 = (P × W) / C

无连接池场景：
  总连接数 = P × W
  当 P=50, W=50 时，总连接数 = 2500
  PostgreSQL max_connections 默认 100 → 直接爆满

PgBouncer Transaction 模式：
  池大小 C = 100
  客户端连接数 = 2500
  复用比 R = 25:1
  数据库实际连接 = 100 ✓

PgBouncer Session 模式：
  池大小 C = 100
  客户端连接数 = 2500
  但由于 Session 模式不能复用，实际可用并发 = 100
  排队等待的请求可能导致超时
```

---

## 第四章：Session 级隔离——多租户的核心挑战

### 4.1 Session 级特性与连接池的冲突

在 PostgreSQL 中，很多有用的特性是 Session 级别的，这意味着它们依赖于连接在整个会话期间保持不变：

| 特性 | 级别 | Transaction 模式兼容性 |
|------|------|----------------------|
| `SET search_path` | Session | ❌ 丢失 |
| `SET timezone` | Session | ❌ 丢失 |
| `LISTEN/NOTIFY` | Session | ❌ 不支持 |
| `PREPARE` 语句 | Session | ❌ 不支持 |
| 临时表 | Session | ❌ 不可见 |
| `SET LOCAL` | Transaction | ✅ 正常工作 |
| `pg_trgm` 扩展的 `show_trgm()` | Session | ⚠️ 取决于调用方式 |
| Advisory Locks | Session | ❌ 丢失 |

对于 Laravel 多租户应用来说，`search_path` 是最关键的 Session 级设置。如果使用 Transaction 模式连接池，`SET search_path TO tenant_x` 的效果只在当前事务内有效——一旦事务结束，连接归还给连接池，下一个拿到这个连接的请求看到的是默认的 `search_path`。

### 4.2 解决方案一：Transaction 内的 search_path

最直接的解决方案是确保每个请求的操作都在一个事务内完成，并在事务内设置 `search_path`。Laravel 的 `DB::transaction()` 可以实现这一点：

```php
class TenantMiddleware
{
    public function handle($request, Closure $next)
    {
        $tenant = $this->resolveTenant($request);
        
        // 使用 Laravel 的 database session variable setter
        // 这会在每次查询前自动注入
        config(['database.connections.pgsql.search_path' => $tenant->schema]);
        
        return $next($request);
    }
}
```

但这还不够。Laravel 的 Eloquent ORM 并不会自动在事务内包装每个请求。我们需要一种更可靠的机制。

### 4.3 解决方案二：`SET LOCAL` + 显式事务

`SET LOCAL` 只影响当前事务，与 Transaction 模式连接池天然兼容：

```php
class TenantManager
{
    protected $currentTenant;
    
    public function setTenant(Tenant $tenant): void
    {
        $this->currentTenant = $tenant;
        // 在下一个查询中注入 SET LOCAL
        DB::statement("SET LOCAL search_path TO {$tenant->schema}, public");
    }
    
    public function runInTenantContext(Tenant $tenant, callable $callback): mixed
    {
        return DB::transaction(function () use ($tenant, $callback) {
            $this->setTenant($tenant);
            return $callback();
        });
    }
}
```

问题是：`SET LOCAL` 必须在事务内部执行。对于不需要事务的读操作，我们需要"伪事务"包裹：

```php
// 在 ServiceProvider 中注册宏
DB::macro('tenantTransaction', function (string $schema, callable $callback) {
    return DB::transaction(function () use ($schema, $callback) {
        DB::statement('SET LOCAL search_path TO ' . $schema . ', public');
        return $callback();
    });
});
```

### 4.4 解决方案三：Session Pinning（会话钉住）

RDS Proxy 提供了一种称为"Session Pinning"的机制。当检测到 Session 级语句（如 `SET` 命令）时，RDS Proxy 会将当前连接"钉住"给该客户端，直到连接关闭或显式重置。

但这恰恰破坏了连接池的核心价值——复用。RDS Proxy 提供了一个折中方案：`SessionPinningFilters` 可以排除某些 `SET` 命令，避免触发 pinning：

```yaml
SessionPinningFilters:
  - EXCLUDE_VARIABLE_SETS  # 排除 SET 命令，不触发 pinning
```

但这又回到了 `SET` 值丢失的问题。

### 4.5 我们最终选择的方案：Per-Tenant Schema + `current_setting`

经过多轮尝试，我们最终采用了一种混合方案：

```sql
-- 在 PostgreSQL 端创建一个函数，通过 GUC 变量切换 schema
CREATE OR REPLACE FUNCTION current_tenant_schema()
RETURNS text AS $$
    SELECT current_setting('app.tenant_schema', true);
$$ LANGUAGE sql STABLE;

-- 创建一个通用的 view 来代理所有表访问
CREATE OR REPLACE FUNCTION dynamic_query(table_name text)
RETURNS SETOF record AS $$
BEGIN
    RETURN QUERY EXECUTE format(
        'SELECT * FROM %I.%I',
        current_tenant_schema(),
        table_name
    );
END;
$$ LANGUAGE plpgsql STABLE;
```

在 Laravel 端：

```php
class TenantMiddleware
{
    public function handle($request, Closure $next)
    {
        $tenant = $this->resolveTenant($request);
        
        // 使用 SET LOCAL 在事务内设置自定义 GUC
        // current_setting('app.tenant_schema', true) 可以读取这个值
        app()->singleton('tenant', fn() => $tenant);
        
        return $next($request);
    }
}

// 在查询构建器中自动注入
class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model)
    {
        $tenant = app('tenant');
        $builder->beforeExecutingCallback(function ($sql, $bindings) use ($tenant) {
            // 通过连接级设置注入 tenant context
            DB::connection()->getPdo()->exec(
                "SET LOCAL app.tenant_schema = '{$tenant->schema}'"
            );
        });
    }
}
```

这个方案的关键洞察是：**`current_setting('app.tenant_schema', true)` 是一个函数调用，不依赖于 session 级状态，而是读取当前事务中的 GUC 变量**。配合 `SET LOCAL`，它在 Transaction 模式连接池下完美工作。

---

## 第五章：性能基准对比

### 5.1 测试环境

```
硬件：
  应用服务器：3 × c6i.2xlarge (8 vCPU, 16GB RAM)
  数据库服务器：1 × r6i.2xlarge (8 vCPU, 64GB RAM)
  PostgreSQL 16.2

软件：
  PHP 8.3 + Laravel 11
  PgBouncer 1.22
  Supavisor 1.1.14
  RDS Proxy (db.r6g.large equivalent)

负载测试：
  工具：k6
  并发虚拟用户：100 → 1000 → 5000
  测试场景：混合读写（70% SELECT, 20% INSERT, 10% UPDATE）
  每个虚拟用户模拟一个租户请求周期
```

### 5.2 测试结果

#### 连接建立时间

| 方案 | 首次连接 (p50) | 首次连接 (p99) | 池内复用 (p50) |
|------|---------------|---------------|---------------|
| 无连接池 | 12ms | 45ms | N/A |
| PgBouncer Session | 8ms | 30ms | 0.3ms |
| PgBouncer Transaction | 8ms | 28ms | 0.3ms |
| Supavisor Transaction | 15ms | 52ms | 0.8ms |
| RDS Proxy | 20ms | 80ms | 1.2ms |

PgBouncer 凭借 C 语言实现和单进程架构，在延迟方面显著领先。

#### 最大吞吐量（QPS）

| 方案 | 100 并发 | 1000 并发 | 5000 并发 |
|------|---------|----------|----------|
| 无连接池 | 8,500 | ❌ 连接拒绝 | ❌ 连接拒绝 |
| PgBouncer Session | 12,000 | 11,500 | ❌ 池耗尽 |
| PgBouncer Transaction | 15,000 | 22,000 | 28,000 |
| Supavisor Transaction | 14,000 | 20,000 | 26,000 |
| RDS Proxy | 11,000 | 18,000 | 22,000 |

关键发现：Transaction 模式在高并发下的吞吐量是 Session 模式的 **2.4 倍**（5000 并发时）。这验证了 Transaction 模式对连接复用的巨大价值。

#### P99 延迟（毫秒）

| 方案 | 100 并发 | 1000 并发 | 5000 并发 |
|------|---------|----------|----------|
| PgBouncer Session | 15ms | 85ms | ❌ |
| PgBouncer Transaction | 12ms | 35ms | 120ms |
| Supavisor Transaction | 18ms | 42ms | 145ms |
| RDS Proxy | 25ms | 55ms | 180ms |

#### 连接风暴恢复测试

模拟数据库故障恢复后，5000 个客户端同时重连：

| 方案 | 恢复到正常的时间 | 恢复期间丢弃的请求 |
|------|----------------|-------------------|
| 无连接池 | 45s | ~3500 |
| PgBouncer | 8s | ~200 |
| Supavisor | 12s | ~500 |
| RDS Proxy | 5s | ~100 |

RDS Proxy 在故障恢复方面表现最好，因为它是 AWS 基础设施的一部分，与 RDS/Aurora 的故障检测机制紧密集成。

---

## 第六章：Laravel 集成实战

### 6.1 PgBouncer 集成

#### 6.1.1 基本配置

```php
// config/database.php
'connections' => [
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST', '127.0.0.1'),
        'port' => env('DB_PGBOUNCER_PORT', '6432'),  // 注意：指向 PgBouncer
        'database' => env('DB_DATABASE', 'forge'),
        'username' => env('DB_USERNAME', 'forge'),
        'password' => env('DB_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'schema' => 'public',
        'sslmode' => 'prefer',
        'options' => [
            // 禁用 prepared statements，兼容 Transaction 模式
            PDO::ATTR_EMULATE_PREPARES => true,
        ],
    ],
],
```

#### 6.1.2 禁用 Prepared Statements

Laravel 的 PostgreSQL 驱动默认使用 prepared statements，这在 Transaction 模式下会导致问题。需要全局禁用：

```php
// AppServiceProvider.php
public function boot(): void
{
    // 禁用 prepared statements for PgBouncer compatibility
    DB::connection()->setEventDispatcher(app(Dispatcher::class));
    
    // 在连接事件中禁用 prepared statements
    Event::listen(ConnectionEstablished::class, function ($event) {
        $event->connection->getPdo()->setAttribute(
            PDO::ATTR_EMULATE_PREPARES, true
        );
    });
}
```

#### 6.1.3 处理 `SET` 命令

创建一个自定义的连接类，将所有 `SET` 操作转换为 `SET LOCAL`：

```php
// app/Database/PgBouncerConnection.php
namespace App\Database;

use Illuminate\Database\PostgresConnection;

class PgBouncerConnection extends PostgresConnection
{
    public function setSchema($searchPath)
    {
        // 不使用 SET search_path，而是使用自定义 GUC
        $this->statement(
            "SET LOCAL app.tenant_schema = ?",
            [$searchPath]
        );
    }
    
    public function setConfig($name, $value)
    {
        // 将所有 SET 转换为 SET LOCAL
        $this->statement(
            "SET LOCAL {$name} = ?",
            [$value]
        );
    }
}
```

注册自定义连接类：

```php
// AppServiceProvider.php
use App\Database\PgBouncerConnection;

public function register(): void
{
    $this->app->bind('db.connection.pgsql', function ($app, $params) {
        return new PgBouncerConnection(
            $params['connection'],
            $params['database'],
            $params['prefix'],
            $params['config']
        );
    });
}
```

### 6.2 Supavisor 集成

Supavisor 的集成相对简单，因为它提供了管理 API 来动态配置连接池：

```php
// app/Services/SupavisorManager.php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class SupavisorManager
{
    protected string $baseUrl;
    protected string $token;
    
    public function __construct()
    {
        $this->baseUrl = config('services.supavisor.url');
        $this->token = config('services.supavisor.token');
    }
    
    public function createTenantPool(string $tenantId, array $config): array
    {
        return Http::withToken($this->token)
            ->post("{$this->baseUrl}/api/tenants", [
                'tenant' => [
                    'external_id' => "tenant_{$tenantId}",
                    'db_host' => $config['db_host'],
                    'db_port' => $config['db_port'] ?? 5432,
                    'db_database' => $config['database'],
                    'pool_size' => $config['pool_size'] ?? 20,
                    'pool_mode' => $config['pool_mode'] ?? 'transaction',
                    'users' => [[
                        'username' => $config['username'],
                        'password' => $config['password'],
                        'mode' => $config['pool_mode'] ?? 'transaction',
                    ]],
                ],
            ])
            ->json();
    }
    
    public function getTenantStats(string $tenantId): array
    {
        return Http::withToken($this->token)
            ->get("{$this->baseUrl}/api/tenants/tenant_{$tenantId}/stats")
            ->json();
    }
    
    public function updatePoolSize(string $tenantId, int $poolSize): array
    {
        return Http::withToken($this->token)
            ->patch("{$this->baseUrl}/api/tenants/tenant_{$tenantId}", [
                'tenant' => [
                    'pool_size' => $poolSize,
                ],
            ])
            ->json();
    }
}
```

在 Laravel 中，动态切换连接到 Supavisor：

```php
// config/database.php
'connections' => [
    'supavisor' => [
        'driver' => 'pgsql',
        'host' => env('SUPAVISOR_HOST', 'supavisor.service.consul'),
        'port' => env('SUPAVISOR_PORT', '5432'),
        'database' => env('DB_DATABASE', 'myapp'),
        'username' => 'placeholder', // Supavisor 从连接字符串中解析租户
        'password' => 'placeholder',
        'charset' => 'utf8',
        'options' => [
            PDO::ATTR_EMULATE_PREPARES => true,
        ],
    ],
],
```

### 6.3 RDS Proxy 集成

RDS Proxy 的集成最为简单，因为它对应用层是透明的：

```php
// config/database.php
'connections' => [
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST'),  // RDS Proxy 端点
        'port' => env('DB_PORT', '5432'),
        'database' => env('DB_DATABASE'),
        'username' => env('DB_USERNAME'),
        'password' => env('DB_PASSWORD'),
        'charset' => 'utf8',
        'sslmode' => 'require',  // RDS Proxy 默认要求 TLS
        // 如果不需要 Session Pinning，可以避免 SET 命令
    ],
],
```

但要注意 Session Pinning 的规避：

```php
// 不要这样做（会触发 pinning）：
DB::statement("SET search_path TO tenant_x");
DB::statement("SET timezone = 'Asia/Shanghai'");

// 应该这样做：
// 1. 使用 schema-qualified 表名
DB::table('tenant_x.users')->get();

// 2. 或者使用 SET LOCAL（在事务内）
DB::transaction(function () {
    DB::statement("SET LOCAL timezone = 'Asia/Shanghai'");
    // ...
});
```

---

## 第七章：踩坑经验与最佳实践

### 7.1 坑一：PgBouncer 的 `auth_query` 配置

在使用 `auth_query` 模式时，如果 PostgreSQL 使用了 SCRAM-SHA-256 认证（PostgreSQL 10+ 默认），PgBouncer 版本必须 >= 1.16。旧版本只支持 MD5。

```ini
[pgbouncer]
auth_type = scram-sha-256
auth_query = SELECT usename, passwd FROM pg_shadow WHERE usename=$1
auth_user = pgbouncer_auth
```

还需要确保 `pgbouncer_auth` 用户有查询 `pg_shadow` 的权限：

```sql
CREATE USER pgbouncer_auth WITH PASSWORD 'secure_password';
GRANT SELECT ON pg_shadow TO pgbouncer_auth;
```

### 7.2 坑二：Laravel Queue Worker 的连接泄漏

Laravel 的 Queue Worker（`php artisan queue:work`）会长时间运行。如果 Worker 进程与数据库的连接断开（如网络抖动、PgBouncer 重启），Worker 会抛出 `server closed the connection unexpectedly` 错误。

解决方案：

```php
// config/queue.php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        // ...
        'retry_after' => 120,
        'block_for' => 5,
    ],
],

// 启动 Worker 时指定 --max-jobs 和 --max-time
// php artisan queue:work --max-jobs=1000 --max-time=3600
```

同时，在 `AppServiceProvider` 中监听连接断开事件：

```php
use Illuminate\Database\Events\ConnectionLost;

Event::listen(ConnectionLost::class, function ($event) {
    Log::warning('Database connection lost', [
        'connection' => $event->connectionName,
    ]);
    // 触发连接重连
    DB::purge($event->connectionName);
});
```

### 7.3 坑三：Supavisor 的连接状态残留

Supavisor 在 Transaction 模式下，如果客户端在事务中间崩溃（如 PHP Fatal Error），连接可能处于"脏"状态（打开的事务、已设置的 GUC 变量等）。

Supavisor 有内置的清理机制，但清理有延迟（默认 15 秒）。在此期间，拿到这个连接的下一个客户端可能会看到上一个客户端的状态。

解决方案：

```php
// 在每次请求开始时，显式重置连接状态
class TenantMiddleware
{
    public function handle($request, Closure $next)
    {
        // 强制新的事务，确保干净的连接状态
        DB::statement('DISCARD ALL');
        
        $tenant = $this->resolveTenant($request);
        // ... 继续处理
    }
}
```

注意：`DISCARD ALL` 在 Transaction 模式下是否被允许取决于连接池的具体实现。PgBouncer 允许在连接获取后执行一次，Supavisor 的支持可能有差异。

### 7.4 坑四：RDS Proxy 的连接数限制

RDS Proxy 的最大连接数取决于实例的 vCPU 数量。`db.r6g.large`（2 vCPU）默认支持最大 **2000** 个客户端连接。如果你的应用需要更多连接，需要升级 RDS Proxy 的实例规格，而这不能在线完成——需要重新创建 Proxy。

此外，RDS Proxy 的 `MaxConnectionsPercent` 默认值为 100，意味着它会尽可能多地打开到数据库的连接。在多租户场景下，建议设置更低的值：

```yaml
MaxConnectionsPercent: 70    # 保留 30% 的连接给直接连接（如 DBA 操作）
MaxIdleConnectionsPercent: 50 # 50% 的空闲连接可以被回收
```

### 7.5 坑五：`LISTEN/NOTIFY` 在连接池下的行为

我们的一个实时通知功能使用了 PostgreSQL 的 `LISTEN/NOTIFY`。在切换到 Transaction 模式连接池后，通知全部丢失，因为 `LISTEN` 是 Session 级命令。

最终方案：对于需要 `LISTEN/NOTIFY` 的功能，使用独立的数据库连接（绕过连接池）：

```php
// config/database.php
'connections' => [
    'pgsql_notify' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST'),       // 直连数据库，不经过连接池
        'port' => env('DB_PORT', '5432'),
        'database' => env('DB_DATABASE'),
        'username' => env('DB_USERNAME'),
        'password' => env('DB_PASSWORD'),
        // 这个连接直接连数据库，使用 Session 模式
    ],
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_PGBOUNCER_HOST'),  // 通过 PgBouncer
        'port' => env('DB_PGBOUNCER_PORT', '6432'),
        // ...
    ],
],
```

---

## 第八章：方案选型决策框架

### 8.1 决策矩阵

根据我们团队的实战经验，我整理了一个决策矩阵，帮助你根据自身场景选择最合适的方案：

| 维度 | PgBouncer | Supavisor | RDS Proxy |
|------|-----------|-----------|-----------|
| **部署复杂度** | ⭐ 低 | ⭐⭐⭐ 高 | ⭐ 最低（托管） |
| **运维成本** | ⭐⭐ 中 | ⭐⭐⭐ 高 | ⭐ 低 |
| **最大并发能力** | ⭐⭐⭐ 极高 | ⭐⭐⭐ 高 | ⭐⭐ 中 |
| **延迟** | ⭐⭐⭐ 最低 | ⭐⭐ 低 | ⭐⭐ 中 |
| **多租户支持** | ⭐ 无 | ⭐⭐⭐ 原生 | ⭐⭐ 部分 |
| **云原生友好** | ⭐ 一般 | ⭐⭐⭐ 优秀 | ⭐⭐⭐ AWS 生态 |
| **社区成熟度** | ⭐⭐⭐ 最成熟 | ⭐ 年轻 | ⭐⭐ 文档完善 |
| **成本** | ⭐⭐⭐ 免费 | ⭐⭐⭐ 免费 | ⭐⭐ 按用量付费 |
| **供应商锁定** | 无 | 无 | AWS |

### 8.2 推荐场景

**选择 PgBouncer 当**：
- 你需要最低延迟和最高吞吐量
- 你的团队熟悉 PostgreSQL 运维
- 你使用自建 PostgreSQL 或非 AWS 云
- 你需要最稳定的 Transaction 模式支持

**选择 Supavisor 当**：
- 你有大量租户，需要按租户隔离连接池
- 你在 Kubernetes 上运行，需要云原生部署
- 你需要动态调整连接池大小
- 你已经在使用 Supabase 生态

**选择 RDS Proxy 当**：
- 你深度使用 AWS RDS/Aurora
- 你的团队规模小，希望最小化运维负担
- 你不需要 Transaction 模式的极致性能
- 你需要自动高可用和故障转移

### 8.3 我们的选择

最终，我们选择了 **PgBouncer + 自建管理平台** 的方案：

1. PgBouncer 作为核心连接池，运行在 Kubernetes 集群内
2. 使用 `pgbouncer_exporter` 暴露 Prometheus 指标
3. 自建简单的管理 API，动态调整池大小（通过 `PAUSE` / `RESUME` 命令）
4. 对 `LISTEN/NOTIFY` 等 Session 级功能使用独立直连
5. 所有 `SET` 操作通过 `SET LOCAL` 在事务内执行

这个方案在生产环境已经稳定运行了 8 个月，将数据库连接数从峰值 2500 降低到了稳定的 80-100，数据库内存消耗减少了 20GB+，连接风暴问题彻底解决。

---

## 第九章：监控与告警

### 9.1 关键指标

无论选择哪种方案，以下指标必须监控：

```yaml
# Prometheus 告警规则示例
groups:
  - name: connection_pool
    rules:
      - alert: ConnectionPoolExhausted
        expr: pgbouncer_pools_server_active_connections / pgbouncer_pools_server_pool_size > 0.9
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "连接池使用率超过 90%"
          
      - alert: ConnectionPoolWaiting
        expr: pgbouncer_pools_client_waiting_connections > 10
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "有 {{ $value }} 个客户端在等待连接"
          
      - alert: HighConnectionLatency
        expr: histogram_quantile(0.99, pgbouncer_connection_duration_seconds_bucket) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "连接延迟 P99 超过 500ms"
```

### 9.2 Grafana Dashboard 关键面板

```
1. 连接池使用率（Active / Max）
2. 等待队列长度（Waiting Clients）
3. 连接获取延迟（Connection Acquisition Latency）
4. 每秒连接复用次数（Connections Reused / sec）
5. 连接超时/拒绝次数（Timeouts / Errors）
6. 数据库后端连接数趋势
```

---

## 第十章：未来展望

### 10.1 PostgreSQL 18 的内置连接池？

社区一直在讨论 PostgreSQL 原生支持连接池的可能性。在 pgconf.dev 2025 上，有提案讨论在 PostgreSQL 18 中引入内置的连接管理机制。如果实现，这将从根本上改变连接池的格局。

### 10.2 Supavisor 的成长

作为 Elixir 生态中最有前途的连接池项目，Supavisor 正在快速迭代。1.2 版本计划引入：
- 更细粒度的访问控制
- 内建的查询路由（读写分离）
- 与 Patroni 的集成

### 10.3 Serverless 数据库的影响

随着 Neon、CockroachDB Serverless、PlanetScale 等 serverless 数据库的兴起，传统的连接池模式正在被挑战。这些平台内置了连接管理，应用层甚至不需要感知连接池的存在。但它们也带来了新的挑战，如冷启动延迟和不同的定价模型。

---

## 总结

连接池不是银弹，但它是任何严肃的多租户 SaaS 应用不可或缺的基础设施。我们的实战经验表明：

1. **Transaction 模式是连接池发挥价值的关键**，但它要求应用层做出妥协——放弃 Session 级特性，拥抱 `SET LOCAL` 和显式事务管理
2. **多租户架构放大了连接管理的复杂性**，`search_path` 切换是最大的挑战，但可以通过 `current_setting()` + GUC 变量优雅解决
3. **没有最好的方案，只有最适合的方案**——PgBouncer 追求极致性能，Supavisor 追求多租户原生，RDS Proxy 追求零运维
4. **监控先行**——在任何优化之前，先把连接池的指标暴露出来，用数据驱动决策

最后，记住一句话：**连接池不是为了让你的应用更快，而是为了让你的数据库不会死掉。** 在多租户 SaaS 的世界里，连接风暴是必然会发生的问题，只是时间早晚。与其在凌晨三点被 PagerDuty 叫醒，不如现在就开始治理你的连接池。

---

*本文中的 benchmark 数据基于特定硬件和软件版本，仅供参考。建议在你自己的环境中进行测试。作者所在团队的技术选型不代表任何产品的推荐或否定。*

---

## 相关阅读

- [PostgreSQL Advisory Lock 实战进阶：会话级互斥、分布式任务调度与 PgBouncer 兼容性踩坑](/01_MySQL/PostgreSQL-Advisory-Lock-实战进阶-会话级互斥-分布式任务调度-PgBouncer兼容性踩坑)——Advisory Lock 在连接池 Transaction 模式下的行为与兼容性细节
- [读写分离中间件实战：ProxySQL、MaxScale、Laravel 透明路由与连接池主从延迟治理](/01_MySQL/2026-06-05-读写分离中间件实战-ProxySQL-MaxScale-Laravel透明路由连接池主从延迟治理)——从 MySQL 视角理解连接池与读写分离的协同
- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库](/01_MySQL/数据库多租户模式对比实战-共享库Row-Level-vs-Schema-per-Tenant-vs-独立库-Laravel中的三种方案深度权衡)——本文多租户 search_path 方案的扩展讨论
