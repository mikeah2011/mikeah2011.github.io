---
title: Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计
date: 2026-06-03 03:39:38
tags: [Kafka, Debezium, CDC, "Event Sourcing", 消息队列, Laravel]
categories: [架构]
cover: /images/covers/kafka-debezium-cdc-cover.jpg
description: "深入实战 Kafka + Debezium CDC 数据库变更事件流方案，涵盖 MySQL/PostgreSQL 配置、Schema Registry、Exactly-Once 语义、死信队列，并详解如何与 Laravel Event Sourcing 互补架构设计，附 11 条生产踩坑记录与完整代码示例。"
---

在微服务架构和事件驱动系统日益普及的今天，如何可靠、实时地将数据库中的变更事件传播到下游系统，已经成为系统架构设计中的核心挑战。传统的轮询方案既浪费资源又无法保证实时性，双写方案则面临数据一致性难题。Change Data Capture（CDC）技术的出现，为我们提供了一种"从数据库日志中捕获变更"的优雅方案——它不修改任何应用代码，不侵入业务逻辑，却能以毫秒级延迟捕获数据库中发生的一切变更。

本文将深入探讨基于 Kafka + Debezium 的 CDC 实战方案，并重点讨论如何将 CDC 与 Laravel Event Sourcing 进行互补架构设计，实现既有"外部系统数据同步"的实时能力，又有"业务领域事件建模"的表达力。文章涵盖从原理到配置、从架构设计到生产踩坑的完整实践路径，适合正在考虑或已经实施事件驱动架构的后端工程师和架构师阅读。

<!-- more -->

## 一、CDC 核心概念与价值

### 1.1 什么是 Change Data Capture

Change Data Capture（CDC）是一类技术的统称，其核心思想是：**捕获数据库中数据的变更（INSERT、UPDATE、DELETE），并将这些变更以事件的形式发布出去**。与传统的轮询（Polling）方式不同，CDC 直接读取数据库的事务日志（如 MySQL 的 binlog、PostgreSQL 的 WAL），因此具有以下显著优势：

- **低延迟**：变更产生后毫秒级即可被捕获，通常端到端延迟在秒级以内。这对于实时搜索、实时推荐、实时风控等场景至关重要
- **低侵入性**：不需要修改应用代码，不需要在业务表中增加额外字段，不需要在应用层埋点。这意味着即使是遗留系统、第三方系统，只要它们使用支持 CDC 的数据库，变更就可以被捕获
- **完整性保证**：能捕获所有变更，包括批量操作和直接 SQL 语句产生的变更。DBA 手动修复数据、定时任务批量更新、存储过程内部的变更，这些传统方案容易遗漏的场景，CDC 都能覆盖
- **解耦**：源数据库不需要知道有哪些下游系统在消费这些变更。新增一个下游系统只需订阅 Kafka 主题即可，源端完全无感
- **回放能力**：配合 Kafka 的持久化存储，事件可以被重新消费，支持下游系统从任意时间点重建状态

### 1.2 CDC 的技术流派对比

目前主流的 CDC 实现方式可以分为三大类，每种都有其适用场景和局限性：

**基于查询的 CDC（Query-based）**：定期执行 SQL 查询来检测变更。典型实现是在查询中使用 `WHERE updated_at > :last_sync_time` 的条件。缺点非常明显：必须有 `updated_at` 时间戳字段且应用层必须正确维护它；无法捕获 DELETE 操作（除非使用软删除）；在两次查询之间的变更窗口中存在漏检风险；对于频繁变更的表，轮询间隔过长会导致延迟，过短则增加数据库负担。这种方式适合数据量小、实时性要求不高的简单同步场景。

**基于触发器的 CDC（Trigger-based）**：利用数据库触发器将变更写入影子表（shadow table）。每次主表发生 INSERT、UPDATE、DELETE 时，触发器自动将变更数据写入对应的变更日志表。优点是捕获完整，可以自定义记录哪些字段、增加额外的上下文信息。缺点是对数据库性能有显著影响——每个写操作都变成了两倍的写入；触发器逻辑维护成本高；在高并发场景下可能成为性能瓶颈；跨数据库实例时配置复杂。Oracle 的 Streams、SQL Server 的 Change Tracking 都属于这一类。

**基于日志的 CDC（Log-based）**：直接读取数据库的事务日志。这是 Debezium 采用的方案，也是业界公认的最佳实践。它对源数据库的性能影响极小（只读取日志，不修改任何数据），能捕获所有变更类型（包括 DDL 变更），延迟极低（毫秒级），且能保证事务边界和变更顺序。MySQL 的 binlog、PostgreSQL 的 WAL、MongoDB 的 oplog 都属于这类日志。Debezium 通过解析这些日志格式，将原始的二进制日志转换为结构化的变更事件。

### 1.3 CDC 在企业架构中的核心价值场景

理解了 CDC 的技术原理后，我们来看看它在真实业务中的关键应用场景：

**场景一：跨服务数据同步（最常见）**

在微服务架构中，每个服务拥有自己的数据库。当订单服务的状态变更时，搜索服务需要更新索引、缓存服务需要失效缓存、分析服务需要更新统计。传统做法是在订单服务中同步或异步调用各个下游服务的 API，这导致订单服务与所有下游系统强耦合，任何一个下游系统故障都可能影响订单服务的稳定性。CDC 将这种"推"模式变为"拉"模式——订单服务只管写自己的数据库，变更通过 CDC 发布到 Kafka，各下游系统按自己的节奏消费。

**场景二：实时数据仓库 ETL**

传统数据仓库使用批处理 ETL（每小时或每天跑一次），这导致数据仓库中的数据总是滞后于业务系统。CDC 配合 Kafka 和 Flink/Spark Streaming，可以实现分钟级甚至秒级的数据仓库刷新，让业务分析师能看到接近实时的数据。

**场景三：事件驱动微服务编排**

当一个业务流程跨越多个微服务时（如下单→支付→发货→签收），CDC 可以作为服务间事件传播的基础设施。每个服务只关心自己的数据库变更，CDC 负责将变更事件传播到需要它的服务。

**场景四：审计与合规追溯**

在金融、医疗等行业，法规要求记录所有数据变更历史。CDC 可以将所有变更事件持久化到不可变存储中，形成完整的审计链。

**场景五：缓存一致性维护**

缓存与数据库的一致性一直是分布式系统的难题。CDC 可以在数据库变更时自动触发缓存更新或失效，比传统的"先写数据库再删缓存"方案更可靠。

## 二、Debezium 架构：基于 Kafka Connect 的 CDC 引擎

### 2.1 Debezium 是什么

Debezium 是 Red Hat 开源的分布式 CDC 平台，它基于 Kafka Connect 框架构建，能够将多种数据库（MySQL、PostgreSQL、MongoDB、Oracle、SQL Server、Db2 等）的变更事件捕获并发布到 Kafka 主题中。Debezium 的设计理念是"一次部署、持续运行"——它作为独立的进程运行，与应用程序完全解耦，不需要对应用程序做任何修改。

Debezium 社区活跃、文档完善，目前已经成为事实上的开源 CDC 标准。它的主要特性包括：支持多种源数据库和目标存储；支持全量快照和增量快照；支持 Schema 演进；内置心跳机制保证低延迟；支持事务元数据传播；支持消息转换（SMT）和路由。

### 2.2 整体架构详解

Debezium 的整体架构可以分为三个层次，从下到上依次是：

```
┌─────────────────────────────────────────────────────────────────┐
│                        下游消费者层                               │
│  ┌──────────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ Elasticsearch │  │  Redis   │  │ ClickHouse │  │  Laravel  │ │
│  └──────┬───────┘  └────┬─────┘  └─────┬─────┘  └─────┬─────┘ │
│         │               │              │              │         │
│  ┌──────┴───────────────┴──────────────┴──────────────┴─────┐   │
│  │                  Kafka Cluster                            │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │  ecommerce.orders     (3 partitions, RF=3)       │    │   │
│  │  │  ecommerce.order_items (3 partitions, RF=3)      │    │   │
│  │  │  ecommerce.users       (3 partitions, RF=3)      │    │   │
│  │  │  schema-changes.ecommerce (1 partition, RF=3)    │    │   │
│  │  │  dlq.cdc.errors       (1 partition, RF=3)        │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────┴───────────────────────────────┐   │
│  │              Kafka Connect Cluster (Distributed)          │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │         Debezium MySQL Connector                  │    │   │
│  │  │  ┌──────────────┐    ┌───────────────────────┐   │    │   │
│  │  │  │  Snapshot     │──→ │  Streaming (Binlog)   │   │    │   │
│  │  │  │  全量/增量快照 │    │  实时增量捕获         │   │    │   │
│  │  │  └──────────────┘    └───────────────────────┘   │    │   │
│  │  │  ┌──────────────────────────────────────────┐    │    │   │
│  │  │  │  SMT: ExtractNewRecordState, Router...   │    │    │   │
│  │  │  └──────────────────────────────────────────┘    │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────┴───────────────────────────────┐   │
│  │               Source Database                              │   │
│  │  MySQL 8.0 (binlog_format=ROW, binlog_row_image=FULL)   │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │  ecommerce.orders / order_items / users           │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

每个层次的职责划分清晰：

- **源数据库层**：提供事务日志（binlog/WAL），是变更数据的唯一来源。需要做必要的配置开启逻辑复制功能
- **Kafka Connect 层**：运行 Debezium Connector，负责读取数据库日志、解析变更事件、应用消息转换（SMT）、将事件序列化后发送到 Kafka。这一层通常以独立的进程集群运行，与应用服务隔离
- **Kafka 集群层**：提供事件的持久化存储和分发。变更事件在这里被持久化为日志，供多个消费者独立消费
- **下游消费者层**：按需消费 Kafka 主题中的事件，各自独立处理。可以是搜索引擎、缓存、数据仓库、微服务等任何系统

### 2.3 Debezium Connector 的工作流程详解

理解 Debezium 的工作流程对于正确配置和排查问题至关重要。每个 Debezium Connector 的生命周期分为两个主要阶段：

**第一阶段：快照（Snapshot）**

当 Connector 首次启动且没有已保存的 offset 时，它会对目标表进行一次全量快照。这个过程确保 Connector 拥有一份完整的数据基础。MySQL Connector 的快照流程如下：

1. 获取一个全局读锁（`FLUSH TABLES WITH READ LOCK`），确保数据一致性
2. 开启一个新的 binlog 读取会话，记录当前的 binlog 文件名和位置（即 snapshot 的起始位点）
3. 释放全局读锁（从这一步开始，新的写入可以正常进行）
4. 逐表执行 `SELECT *` 读取所有行数据
5. 对于每行数据，生成一条 `op: "r"`（read）类型的变更事件
6. 在所有表的快照完成后，切换到流式模式，从步骤 2 记录的 binlog 位置开始增量读取

这个设计巧妙之处在于：快照期间释放读锁后，新的变更不会丢失——它们会累积在 binlog 中，等快照完成后 Connector 会从快照开始的时间点回放这些增量变更。

**第二阶段：流式捕获（Streaming）**

快照完成后，Connector 切换到流式模式。它持续监听数据库的 binlog/WAL，每当有新的变更事件写入日志，Connector 会：

1. 读取新的 binlog 事件
2. 解析事件内容（包括前镜像和后镜像）
3. 根据配置的过滤规则决定是否处理该事件
4. 应用消息转换（SMT），如展平 envelope、路由到指定主题
5. 将事件序列化（JSON 或 Avro）后发送到对应的 Kafka 主题
6. 更新内部 offset（binlog position），用于故障恢复

### 2.4 Kafka Connect 框架深度解析

Kafka Connect 是 Kafka 生态中的数据集成框架，它提供了一套标准化的接口来连接外部系统。理解其核心概念对于正确部署和运维 Debezium 至关重要：

- **Connector**：定义数据移动的任务配置，如"从 MySQL 复制哪些表、使用什么序列化格式"。Connector 是配置层面的概念，不直接执行工作
- **Task**：Connector 的并行执行单元。一个 Connector 可以拆分为多个 Task，每个 Task 负责一部分数据移动工作。对于 Debezium，目前每个 Connector 只有一个 Task（`tasks.max=1`），因为 binlog 必须顺序读取
- **Worker**：运行 Task 的进程。Worker 有两种模式：standalone（单机，适合开发测试）和 distributed（分布式，适合生产环境）。Distributed 模式下，Connector 配置存储在 Kafka 的 `connect-configs` 内部主题中，offset 存储在 `connect-offsets` 中，状态存储在 `connect-status` 中
- **Converter**：负责数据的序列化和反序列化。Kafka Connect 内置了 JSON Converter 和 String Converter。生产环境推荐使用 Confluent 的 Avro Converter 或 Protobuf Converter，它们配合 Schema Registry 可以实现 schema 管理和演进

在生产环境中，我们**必须使用 distributed 模式**，原因如下：它将 Connector 配置和 offset 持久化到 Kafka 中，Worker 崩溃后可以在其他节点自动恢复；支持 Connector 的弹性伸缩；支持滚动升级 Worker 节点而不中断服务。

## 三、MySQL / PostgreSQL CDC 配置实战

### 3.1 MySQL CDC 配置详解

#### 3.1.1 MySQL 前置配置

Debezium 需要 MySQL 开启 binlog 且设置为 ROW 格式。这是最容易出错的步骤之一，很多初学者在这里碰壁。以下是完整的 MySQL 配置：

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf（Ubuntu/Debian）
# 或 /etc/my.cnf（CentOS/RHEL）

[mysqld]
# === 必需配置 ===

# 开启 binlog，这是 CDC 的基础
log-bin=mysql-bin

# binlog 格式必须为 ROW，只有 ROW 格式才能记录每行数据变更前后的完整值
# STATEMENT 格式只记录 SQL 语句，无法获取具体变更的行数据
# MIXED 格式在大部分情况下用 STATEMENT，只有少数场景切换到 ROW，不适合 CDC
binlog-format=ROW

# 设置 server-id，在 MySQL 复制拓扑中必须唯一
# Debezium 作为复制从库连接，需要一个唯一的 server-id
server-id=1

# === 推荐配置 ===

# binlog 保留时间（秒），确保 Debezium 短暂断连后能从断点恢复
# 建议至少保留 3-7 天。如果 Debezium 停机超过这个时间，binlog 可能已被清理
# 需要重新做快照
binlog-expire-logs-seconds=604800

# 使用完整镜像模式：记录所有列的前镜像（before）和后镜像（after）
# 这对于需要知道"变更了哪些字段"的场景很重要
# MINIMAL 模式只记录被修改的列，NOBLOB 模式不记录未修改的 BLOB 列
binlog-row-image=FULL

# 开启 GTID 模式（强烈推荐）
# GTID 为每个事务分配全局唯一标识，在故障恢复和主从切换时非常有用
# Debezium 可以通过 GTID 精确定位到任意事务，不受 binlog 文件轮转影响
gtid-mode=ON
enforce-gtid-consistency=ON

# binlog 事件大小上限
max-binlog-size=1073741824

# 二进制日志缓存大小
binlog-cache-size=32768
```

配置修改后需要**重启 MySQL 实例**。在云数据库（如 AWS RDS、阿里云 RDS）中，通常在参数组中修改后也需要重启实例才能生效。

创建 Debezium 专用的数据库用户并授予最小必要权限：

```sql
-- 创建专用用户
CREATE USER 'debezium'@'%' IDENTIFIED BY 'YourSecurePassword123!';

-- 核心权限：
-- SELECT: 读取表数据（快照阶段需要）
-- RELOAD: 执行 FLUSH TABLES（快照阶段需要）
-- SHOW DATABASES: 列出数据库
-- REPLICATION SLAVE: 作为复制从库连接并读取 binlog
-- REPLICATION CLIENT: 查看复制状态
GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT
ON *.* TO 'debezium'@'%';

-- 如果使用信号表（signal table）功能进行增量快照控制
-- 需要对信号表有 INSERT 权限
GRANT INSERT ON ecommerce.debezium_signal TO 'debezium'@'%';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证权限
SHOW GRANTS FOR 'debezium'@'%';
```

#### 3.1.2 Debezium MySQL Connector 配置

以下是一个生产级别的 MySQL Connector 配置，包含详细的注释说明：

```json
{
  "name": "mysql-ecommerce-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "tasks.max": "1",

    "database.hostname": "mysql-primary.internal.prod",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "${secrets:mysql-debezium-password}",
    "database.server.id": "184054",

    "topic.prefix": "dbserver1",
    "database.include.list": "ecommerce",
    "table.include.list": "ecommerce.orders,ecommerce.order_items,ecommerce.users",

    "schema.history.internal.kafka.bootstrap.servers": "kafka-1:9092,kafka-2:9092,kafka-3:9092",
    "schema.history.internal.kafka.topic": "schema-changes.ecommerce",
    "schema.history.internal.store.only.captured.tables.ddl": "true",

    "snapshot.mode": "initial",
    "snapshot.locking.mode": "minimal",

    "column.include.list": "ecommerce.orders.id,ecommerce.orders.status,ecommerce.orders.total_amount,ecommerce.orders.customer_id,ecommerce.orders.updated_at,ecommerce.orders.created_at",

    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter.schema.registry.url": "http://schema-registry:8081",

    "transforms": "route,unwrap",
    "transforms.route.type": "org.apache.kafka.connect.transforms.RegexRouter",
    "transforms.route.regex": "dbserver1\\.ecommerce\\.(.*)",
    "transforms.route.replacement": "ecommerce.$1",

    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.drop.tombstones": "false",
    "transforms.unwrap.add.fields": "op,source.ts_ms,source.db,source.table",
    "transforms.unwrap.delete.handling.mode": "rewrite",

    "heartbeat.interval.ms": "10000",
    "provide.transaction.metadata": "true",

    "event.processing.failure.handling.mode": "warn",
    "errors.log.enable": "true",
    "errors.log.include.messages": "true",
    "errors.tolerance": "none",
    "errors.deadletterqueue.topic.name": "dlq.cdc.errors",
    "errors.deadletterqueue.context.headers.enable": "true"
  }
}
```

**关键配置深度解析：**

- `topic.prefix`：作为所有目标 topic 的前缀。建议使用环境标识，如 `prod-dbserver1`，方便在共享 Kafka 集群中区分不同环境的事件
- `snapshot.mode`：`initial` 表示首次启动做快照，之后切换到流式；`schema_only` 表示只捕获 schema 不做数据快照，适用于只关心增量变更的场景；`never` 表示跳过快照直接从当前位置开始流式，这要求 binlog 中有足够的历史数据
- `transforms.unwrap`（ExtractNewRecordState）：这是最常用的 SMT。默认的 Debezium 事件包含完整的 envelope 结构（before、after、source、op 等字段），展平后只保留 after 的字段值和少量元数据，大幅简化下游消费逻辑
- `heartbeat.interval.ms`：心跳间隔。在低流量期间，如果没有变更事件，Debezium 无法更新 binlog 位置。心跳消息确保位置持续更新，避免 Connector 恢复后需要追赶大量历史 binlog
- `provide.transaction.metadata`：启用后会将同一事务的所有变更关联起来，对于需要理解事务语义的场景很有用

#### 3.1.3 踩坑记录：MySQL binlog 配置问题

> **踩坑 #1：binlog_format 不正确导致 Connector 无法启动**
>
> **现象**：Connector 提交后立即进入 FAILED 状态，日志报错 `The MySQL server is not configured to use a ROW binlog_format. The binlog_format is set to 'STATEMENT' which does not allow the connector to read the changes correctly`。
>
> **排查过程**：连接到 MySQL 实例执行 `SHOW VARIABLES LIKE 'binlog_format'`，确认当前值为 STATEMENT。修改全局变量 `SET GLOBAL binlog_format = 'ROW'` 后 Connector 仍然报错，原因是全局变量修改只影响新连接，已有连接仍使用旧格式。
>
> **根本原因**：binlog_format 是一个需要在配置文件中设置并重启 MySQL 才能可靠生效的参数。某些 MySQL 版本和云数据库版本允许运行时修改，但 Debezium 连接时可能使用的是已有的连接池，不受全局变量修改的影响。
>
> **正确解决方案**：
> 1. 修改 MySQL 配置文件中的 `binlog-format=ROW`
> 2. 重启 MySQL 实例（不是 reload，是 restart）
> 3. 验证：`SHOW VARIABLES LIKE 'binlog_format'` 确认为 ROW
> 4. 验证：`SHOW VARIABLES LIKE 'binlog_row_image'` 确认为 FULL
> 5. 如果是 AWS RDS，在参数组中修改后需要重启实例
>
> **经验总结**：在项目初期就确认数据库的 binlog 配置，不要等到 Debezium 部署时才发现问题。

### 3.2 PostgreSQL CDC 配置详解

PostgreSQL 的 CDC 配置比 MySQL 更复杂，因为它基于 WAL（Write-Ahead Log）和逻辑复制（Logical Replication）机制。PostgreSQL 的逻辑复制从 10.0 版本开始引入，相比 MySQL 的 binlog 有一些架构上的差异需要理解。

#### 3.2.1 PostgreSQL 前置配置

```ini
# postgresql.conf

# wal_level 必须设置为 logical
# 默认值是 replica（仅支持物理复制）
# logical 级别会在 WAL 中记录额外的信息，支持逻辑解码
wal_level = logical

# 最大 WAL 发送进程数
# 每个逻辑复制连接（包括 Debezium）占用一个
# 建议预留一些给 pg_basebackup 等物理复制
max_wal_senders = 10

# 最大复制槽数量
# 每个逻辑复制槽占用一个，物理复制也占用
# 注意：未使用的复制槽会阻止 WAL 清理，导致磁盘空间增长
max_replication_slots = 10

# 以下配置在 PostgreSQL 13+ 中可用，强烈推荐设置
# 限制单个复制槽保留的最大 WAL 数据量
# 防止 Debezium 长时间停机时 WAL 堆积导致磁盘爆满
max_slot_wal_keep_size = '50GB'
```

创建专用用户和发布：

```sql
-- 创建 Debezium 用户并授予复制权限
CREATE USER debezium WITH REPLICATION LOGIN PASSWORD 'YourSecurePassword123!';

-- 授予 schema 级别的访问权限
GRANT USAGE ON SCHEMA public TO debezium;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO debezium;

-- 设置默认权限，确保未来创建的表也有 SELECT 权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO debezium;

-- 创建逻辑复制发布（Publication）
-- 指定需要捕获的表，而不是所有表
CREATE PUBLICATION dbz_publication FOR TABLE orders, order_items, users;

-- 验证发布
SELECT * FROM pg_publication;
SELECT * FROM pg_publication_tables;
```

#### 3.2.2 PostgreSQL Connector 配置

```json
{
  "name": "pg-ecommerce-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",

    "database.hostname": "pg-primary.internal.prod",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "${secrets:pg-debezium-password}",
    "database.dbname": "ecommerce",

    "topic.prefix": "dbserver1",
    "schema.include.list": "public",
    "table.include.list": "public.orders,public.order_items,public.users",

    "plugin.name": "pgoutput",
    "slot.name": "debezium_ecommerce",
    "publication.name": "dbz_publication",
    "publication.autocreate.mode": "disabled",

    "snapshot.mode": "initial",

    "hstore.handling.mode": "json",
    "interval.handling.mode": "string",
    "slot.drop.on.stop": "false",

    "heartbeat.interval.ms": "10000",
    "provide.transaction.metadata": "true",

    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter.schema.registry.url": "http://schema-registry:8081",

    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.drop.tombstones": "false",
    "transforms.unwrap.add.fields": "op,source.ts_ms,source.db,source.table"
  }
}
```

**PostgreSQL 特有注意事项详解：**

- `plugin.name`：推荐使用 `pgoutput`（PostgreSQL 10+ 内置的逻辑解码输出插件），它不需要额外安装任何插件。替代方案有 `wal2json`（需要单独安装）和 `decoderbufs`（基于 Protobuf，也需要安装）
- `slot.name`：逻辑复制槽的名称，每个 Connector 必须使用唯一的名称。复制槽是 PostgreSQL 用来跟踪逻辑复制消费位置的机制
- `publication.name`：指定使用哪个发布（Publication）。发布定义了哪些表的变更会被包含在逻辑复制流中
- `publication.autocreate.mode`：建议设置为 `disabled`，手动创建发布以获得更精确的控制
- `slot.drop.on.stop`：Connector 停止时是否删除复制槽。生产环境建议设为 `false`，避免重新启动时需要做全量快照

#### 3.2.3 踩坑记录：PostgreSQL 复制槽堆积

> **踩坑 #2：复制槽未及时消费导致 WAL 堆积磁盘爆满**
>
> **现象**：PostgreSQL 服务器磁盘空间告警，`pg_wal` 目录占用了 80GB 空间，且持续增长。数据库写入开始报错 "could not write to file"。
>
> **排查过程**：
> ```sql
> -- 查看复制槽状态
> SELECT slot_name, slot_type, active,
>        pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
> FROM pg_replication_slots;
> ```
> 结果显示 `debezium_ecommerce` 槽的 retained_wal 为 78GB，active 状态为 false。
>
> **根本原因**：Debezium Connector 因为内存问题在 3 天前崩溃了，但复制槽没有被清理。PostgreSQL 为了保证复制槽中记录的位点之后的 WAL 能被重新发送，会一直保留这些 WAL 文件，导致磁盘空间持续增长。
>
> **紧急修复**：
> ```sql
> -- 确认复制槽不被其他进程使用
> SELECT * FROM pg_replication_slots WHERE active = false;
>
> -- 删除不活跃的复制槽
> SELECT pg_drop_replication_slot('debezium_ecommerce');
>
> -- 清理 WAL（PostgreSQL 会自动清理，但可以手动触发 checkpoint 加速）
> CHECKPOINT;
> ```
>
> **长期预防**：
> 1. 配置 `max_slot_wal_keep_size`（PostgreSQL 13+）限制单个槽的 WAL 保留量
> 2. 监控复制槽的 `retained_wal` 大小，设置告警阈值
> 3. 在 Connector 的运维手册中明确：Connector 停止前必须先删除或暂停复制槽
> 4. 配置独立的告警：当复制槽 active=false 且 retained_wal 超过阈值时立即告警

## 四、Kafka 主题设计与事件 Schema

### 4.1 主题命名规范

良好的主题命名规范是 CDC 架构可维护性的基础。Debezium 默认的主题命名格式为 `<topic.prefix>.<schema>.<table>`，例如 `dbserver1.ecommerce.orders`。在实际项目中，建议通过 SMT 转换为更符合业务语义的命名：

```json
{
  "transforms": "route",
  "transforms.route.type": "org.apache.kafka.connect.transforms.RegexRouter",
  "transforms.route.regex": "dbserver1\\.ecommerce\\.(.*)",
  "transforms.route.replacement": "ecommerce.$1"
}
```

推荐的主题命名规范：

```
# 主数据变更主题
{domain}.{entity}
ecommerce.orders
ecommerce.order_items
ecommerce.users

# Schema 历史主题（MySQL 必须）
schema-changes.{database}
schema-changes.ecommerce

# 事务元数据主题（可选）
{topic.prefix}.transaction

# 死信队列主题
dlq.cdc.errors
```

### 4.2 事件 Schema 设计详解

理解 Debezium 的事件结构对于正确消费事件至关重要。一个完整的 Debezium 变更事件包含以下结构：

```json
{
  "before": {
    "id": 1001,
    "customer_id": 42,
    "status": "PENDING",
    "total_amount": 299.99,
    "updated_at": "2026-06-01T10:00:00Z"
  },
  "after": {
    "id": 1001,
    "customer_id": 42,
    "status": "PAID",
    "total_amount": 299.99,
    "updated_at": "2026-06-01T10:05:00Z"
  },
  "source": {
    "version": "2.5.0",
    "connector": "mysql",
    "name": "dbserver1",
    "ts_ms": 1717241100000,
    "db": "ecommerce",
    "table": "orders",
    "server_id": 1,
    "file": "mysql-bin.000003",
    "pos": 2345,
    "row": 0,
    "snapshot": "false",
    "gtid": "3E11FA47-71CA-11E1-9E33-C80AA9429562:5"
  },
  "op": "u",
  "ts_ms": 1717241100500,
  "transaction": {
    "id": "3E11FA47:23:12:1",
    "total_order": 5,
    "data_collection_order": 2
  }
}
```

**字段深度解析：**

- `before`：变更前的行数据。对于 UPDATE 和 DELETE 操作有值，INSERT 操作为 null。前提是 MySQL 的 binlog_row_image 设置为 FULL
- `after`：变更后的行数据。对于 INSERT 和 UPDATE 操作有值，DELETE 操作为 null
- `op`：操作类型。`c`（create/INSERT）、`u`（update/UPDATE）、`d`（delete/DELETE）、`r`（read/快照阶段读取的数据）
- `source`：变更的来源元数据。包含 binlog 文件名和位置（可用于精确定位）、数据库名、表名、时间戳等。这是排查问题和实现精确一次处理的关键信息
- `transaction`：事务元数据。包含事务 ID 和该事务中变更的总数/当前序号。可以用于将同一事务的所有变更聚合在一起处理
- `ts_ms`：Debezium 处理该事件的时间戳（毫秒级 Unix 时间戳）

### 4.3 使用 Avro Schema 与 Schema Registry

生产环境中，强烈推荐使用 Confluent Schema Registry + Avro 替代 JSON 序列化。原因如下：

**性能优势**：Avro 是二进制格式，序列化后的体积比 JSON 小 30%-50%，在大规模事件流中这意味着显著的网络带宽和存储成本节省。

**Schema 演进**：Avro 内置了 schema 版本管理和兼容性检查。当源表结构发生变更时，Schema Registry 会自动检查新 schema 是否与旧版本兼容，不兼容的变更会被拒绝，防止下游消费者收到无法解析的消息。

**类型安全**：Avro 有严格的类型系统，避免了 JSON 中常见的类型歧义问题，如数字精度丢失（JSON 中所有数字都是 IEEE 754 双精度浮点数）、日期格式不统一等。

```json
{
  "key.converter": "io.confluent.connect.avro.AvroConverter",
  "key.converter.schema.registry.url": "http://schema-registry:8081",
  "value.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter.schema.registry.url": "http://schema-registry:8081"
}
```

### 4.4 主题分区策略与消息键设计

默认情况下，Debezium 使用事件的主键作为 Kafka 消息的 key。这意味着同一张表中相同主键的记录会被路由到同一分区，从而保证**单条记录的变更顺序**。Kafka 在分区内保证消息有序，这是实现正确 CDC 消费的基础。

```json
{
  "partitioner.class": "org.apache.kafka.connect.transforms.partitioner.DefaultPartitioner"
}
```

**设计建议**：

- 分区数建议设为消费者实例数的 1-3 倍，以便在需要时增加并行度
- 如果下游消费逻辑允许乱序处理（如搜索索引更新），可以使用 RoundRobin 获得更好的吞吐量
- 如果需要严格的全局顺序（如审计日志），使用单分区（但吞吐量受限）
- 监控各分区的消息量是否均匀分布，避免热点分区

## 五、与 Laravel Event Sourcing 的互补架构

### 5.1 Event Sourcing 核心理念回顾

Laravel 生态中的 Event Sourcing 有多种实现，包括 Spatie 的 `laravel-event-sourcing` 包、`hirethunk/verbs` 等。其核心思想是：**不存储实体的当前状态，而是存储导致状态变更的所有事件。当前状态可以通过回放所有历史事件来重建。**

```php
<?php

namespace App\Aggregates;

use Spatie\EventSourcing\AggregateRoots\AggregateRoot;
use App\Events\Orders\OrderCreated;
use App\Events\Orders\OrderPaid;
use App\Events\Orders\OrderShipped;
use App\Events\Orders\OrderCancelled;

class OrderAggregateRoot extends AggregateRoot
{
    protected string $status = 'PENDING';
    protected float $totalAmount = 0;
    protected int $customerId = 0;
    protected array $items = [];

    public function createOrder(int $customerId, array $items): self
    {
        $totalAmount = collect($items)->sum('price');
        
        $this->recordThat(new OrderCreated(
            orderId: $this->uuid(),
            customerId: $customerId,
            items: $items,
            totalAmount: $totalAmount,
            createdAt: now(),
        ));
        
        return $this;
    }

    public function pay(string $paymentId, string $paymentMethod): self
    {
        if ($this->status !== 'PENDING') {
            throw new InvalidOrderStateTransition(
                "Cannot pay order in status: {$this->status}. Expected: PENDING"
            );
        }
        
        $this->recordThat(new OrderPaid(
            orderId: $this->aggregateRootId(),
            paymentId: $paymentId,
            paymentMethod: $paymentMethod,
            paidAt: now(),
        ));
        
        return $this;
    }

    public function ship(string $trackingNumber): self
    {
        if ($this->status !== 'PAID') {
            throw new InvalidOrderStateTransition(
                "Cannot ship order in status: {$this->status}. Expected: PAID"
            );
        }
        
        $this->recordThat(new OrderShipped(
            orderId: $this->aggregateRootId(),
            trackingNumber: $trackingNumber,
            shippedAt: now(),
        ));
        
        return $this;
    }

    public function cancel(string $reason): self
    {
        if (!in_array($this->status, ['PENDING', 'PAID'])) {
            throw new InvalidOrderStateTransition(
                "Cannot cancel order in status: {$this->status}"
            );
        }
        
        $this->recordThat(new OrderCancelled(
            orderId: $this->aggregateRootId(),
            reason: $reason,
            cancelledAt: now(),
        ));
        
        return $this;
    }

    // === 事件处理器：重建状态 ===

    protected function applyOrderCreated(OrderCreated $event): void
    {
        $this->status = 'PENDING';
        $this->totalAmount = $event->totalAmount;
        $this->customerId = $event->customerId;
        $this->items = $event->items;
    }
    
    protected function applyOrderPaid(OrderPaid $event): void
    {
        $this->status = 'PAID';
    }
    
    protected function applyOrderShipped(OrderShipped $event): void
    {
        $this->status = 'SHIPPED';
    }
    
    protected function applyOrderCancelled(OrderCancelled $event): void
    {
        $this->status = 'CANCELLED';
    }

    public function getStatus(): string
    {
        return $this->status;
    }
}
```

### 5.2 CDC 与 Event Sourcing 的本质区别深度对比

理解两者的本质区别是做出正确架构决策的前提：

| 维度 | CDC（Debezium） | Event Sourcing |
|------|-----------------|----------------|
| **事件来源** | 数据库事务日志——被动捕获 | 应用层主动记录——主动设计 |
| **事件语义** | 物理层：某行某列的值从 A 变为 B | 业务层：用户执行了"支付订单"操作，包含支付方式、支付渠道等业务上下文 |
| **粒度** | 行级/字段级变更，一行一事件 | 聚合根/命令级变更，一个命令可能涉及多行 |
| **因果关系** | 无业务因果，只有数据变更。不知道"为什么"变更 | 包含完整的业务意图和上下文。知道"谁"执行了"什么"操作以及"为什么" |
| **侵入性** | 零侵入，对应用完全透明 | 需要重构领域模型，将 CRUD 改为事件驱动 |
| **适用系统** | 任何使用关系数据库的系统，包括遗留系统 | 需要事件溯源的领域模型，适合新建系统 |
| **重放能力** | 从数据库快照+binlog 重放 | 从事件流重放，支持任意时间点状态重建 |
| **跨服务适用性** | 天然跨服务——任何订阅 Kafka 的系统都可以消费 | 通常局限在单个服务的有界上下文内 |
| **事件体积** | 较大——包含完整的前后镜像和元数据 | 较小——只包含业务需要的字段 |
| **Schema 变更** | 数据库 DDL 直接影响事件 schema | 事件 schema 由开发者显式控制 |

### 5.3 互补架构设计的三种核心模式

在实际项目中，CDC 和 ES 并非二选一的关系。以下三种模式展示了如何将两者结合使用：

**模式一：CDC 用于外部同步，ES 用于内部建模**

这是最常见的互补模式。Event Sourcing 用于管理核心领域模型的生命周期和业务逻辑，CDC 用于将数据变更传播到外部系统。两者各司其职，互不干扰。

```
┌───────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────┐    CDC (Debezium)     ┌──────────────────┐  │
│  │ Legacy 系统   │ ──────────────────→  │ Elasticsearch     │  │
│  │ (无法修改)   │                      │ ClickHouse        │  │
│  └──────────────┘                      │ Redis Cache       │  │
│                                        └──────────────────┘  │
│                                                                │
│  ┌──────────────┐    Domain Events      ┌──────────────────┐  │
│  │ Laravel 新业务│ ──────────────────→  │ 订单聚合          │  │
│  │ Event Sourcing│                      │ 投影器 (Projector)│  │
│  └──────────────┘                      │ 进程管理器 (Saga) │  │
│                                        └──────────────────┘  │
│                                                                │
│  核心思想：ES 管"业务逻辑"，CDC 管"数据分发"                     │
└───────────────────────────────────────────────────────────────┘
```

**模式二：CDC 作为 ES 的校验与修复通道**

当系统中同时存在 Event Sourcing 和传统 CRUD 操作时（这是很多系统的真实情况），CDC 可以作为"真相来源的校验通道"——以数据库中的实际数据为标准，校验 Event Store 中的状态是否一致：

```php
<?php

namespace App\Services\Reconciliation;

use App\Aggregates\OrderAggregateRoot;
use Illuminate\Support\Facades\Log;

class CdcEventReconciler
{
    /**
     * 消费 CDC 推送的订单变更事件，与本地 Event Store 做一致性校验。
     * 这是系统的"第二道防线"——即使 Event Sourcing 的投影出现 bug，
     * CDC 也能捕获数据库中的真实状态并触发修复。
     */
    public function handleCdcOrderChange(CdcOrderChanged $cdc): void
    {
        try {
            // 从 Event Store 查询该订单的最新状态
            $aggregate = OrderAggregateRoot::retrieve($cdc->orderId);
            $expectedStatus = $aggregate->getStatus();
        } catch (\Throwable $e) {
            Log::error('无法从 Event Store 获取订单状态', [
                'order_id' => $cdc->orderId,
                'error' => $e->getMessage(),
            ]);
            return;
        }
        
        // 对比 CDC 推送的实际数据库状态与 Event Store 的状态
        if ($expectedStatus !== $cdc->afterStatus) {
            Log::warning('Event Store 与数据库状态不一致——CDC 校验发现差异', [
                'order_id' => $cdc->orderId,
                'event_store_status' => $expectedStatus,
                'database_status' => $cdc->afterStatus,
                'cdc_timestamp' => $cdc->timestamp,
                'cdc_source' => $cdc->sourceInfo,
            ]);
            
            // 发出不一致告警事件
            event(new DataInconsistencyDetected(
                orderId: $cdc->orderId,
                expectedStatus: $expectedStatus,
                actualStatus: $cdc->afterStatus,
                detectedBy: 'cdc-reconciler',
            ));
            
            // 可选：自动修复——将 Event Store 的状态同步为数据库状态
            // 注意：这需要谨慎评估，某些情况下应该由人工介入
            if (config('reconciliation.auto_fix_enabled')) {
                $this->autoFixInconsistency($cdc, $expectedStatus);
            }
        }
    }
    
    private function autoFixInconsistency(CdcOrderChanged $cdc, string $expectedStatus): void
    {
        Log::info('自动修复不一致', [
            'order_id' => $cdc->orderId,
            'from' => $expectedStatus,
            'to' => $cdc->afterStatus,
        ]);
        
        // 通过 Event Sourcing 的补偿机制记录修正事件
        $aggregate = OrderAggregateRoot::retrieve($cdc->orderId);
        $aggregate->applyCorrection(
            orderId: $cdc->orderId,
            correctStatus: $cdc->afterStatus,
            reason: "CDC 校验发现数据库状态为 {$cdc->afterStatus}，Event Store 状态为 {$expectedStatus}",
        )->persist();
    }
}
```

**模式三：CDC 驱动跨服务的 ES 投影**

在微服务架构中，每个服务的 Event Store 只包含本服务的领域事件。当一个服务需要基于其他服务的数据做投影时，CDC 可以充当桥梁：

```php
<?php

namespace App\Projections;

/**
 * 库存服务的投影器——消费订单服务通过 CDC 发布的变更事件。
 * 
 * 订单服务使用 Event Sourcing 管理订单生命周期。
 * 订单数据通过 CDC 发布到 Kafka。
 * 库存服务消费这些 CDC 事件来维护本地的库存预留状态。
 * 
 * 这种架构让库存服务不需要知道订单服务的 Event Sourcing 实现细节，
 * 只需要关注"订单状态变更"这个数据事实。
 */
class InventoryProjection
{
    public function handle(CdcOrderEvent $event): void
    {
        match ($event->op) {
            'c' => $this->reserveStockForNewOrder($event->after),
            'u' => $this->handleStatusChange($event->before, $event->after),
            'd' => $this->releaseStockForDeletedOrder($event->before),
        };
    }
    
    private function reserveStockForNewOrder(array $orderData): void
    {
        $items = json_decode($orderData['items_json'] ?? '[]', true);
        
        foreach ($items as $item) {
            Inventory::where('product_id', $item['product_id'])
                ->decrement('reserved_quantity', $item['quantity']);
        }
        
        Log::info('库存预留完成', ['order_id' => $orderData['id']]);
    }
    
    private function handleStatusChange(?array $before, array $after): void
    {
        $oldStatus = $before['status'] ?? null;
        $newStatus = $after['status'];
        
        // 订单取消或退款时释放库存
        if ($oldStatus !== 'CANCELLED' && $newStatus === 'CANCELLED') {
            $this->releaseStockForOrder($after['id']);
        }
        
        if ($oldStatus !== 'REFUNDED' && $newStatus === 'REFUNDED') {
            $this->releaseStockForOrder($after['id']);
        }
    }
    
    private function releaseStockForOrder(int $orderId): void
    {
        $reservations = StockReservation::where('order_id', $orderId)->get();
        
        foreach ($reservations as $reservation) {
            Inventory::where('product_id', $reservation->product_id)
                ->increment('reserved_quantity', $reservation->quantity);
            
            $reservation->update(['status' => 'released']);
        }
        
        Log::info('库存释放完成', ['order_id' => $orderId]);
    }
}
```

### 5.4 何时选择 CDC，何时选择 Event Sourcing

**选择 CDC 的场景**：
- 遗留系统集成——无法修改源代码，只能从数据库层面捕获变更
- 多下游系统同步——需要将变更传播到搜索、缓存、分析等多个异构系统
- 简单领域模型——业务逻辑不复杂，Event Sourcing 的建模收益不明显
- 数据库变更审计——需要捕获包括 DBA 直接执行的 SQL 在内的所有变更
- 实时数据仓库——将 OLTP 数据实时推送到 OLAP 系统

**选择 Event Sourcing 的场景**：
- 复杂领域逻辑——需要完整的业务意图、因果链和状态机建模
- 事件重放需求——需要重建任意时间点的实体状态，支持时光旅行查询
- 高审计要求——金融、医疗等行业需要记录"谁、何时、为什么、做了什么"
- 新建系统——可以从零设计领域模型，享受 Event Sourcing 的架构优势
- 复杂业务流程——需要 Saga/Process Manager 编排跨聚合的业务流程

**两者结合的场景**：
- 混合架构——新模块用 Event Sourcing，老模块通过 CDC 接入统一事件总线
- 跨系统数据一致性——CDC 捕获数据库变更用于校验 Event Sourcing 的状态一致性
- 渐进式迁移——从 CDC 开始逐步引入 Event Sourcing，CDC 作为过渡桥梁
- 事件融合——CDC 捕获的物理变更事件与 ES 的业务事件在统一总线中融合处理

## 六、数据一致性保证：Exactly-Once 语义

### 6.1 CDC 中的一致性挑战层次

在 CDC 架构中，数据一致性涉及多个层次，每个层次都有不同的挑战：

**第一层：事件投递语义**——Debezium 基于 Kafka Connect，默认保证 at-least-once 语义。在 Connector 故障恢复时，可能出现重复事件。

**第二层：事务边界**——一个数据库事务可能产生多条变更事件（如同时更新订单表和订单项表），如何保证这些事件的原子性投递。

**第三层：顺序性保证**——同一行记录的多次变更必须按序消费。Kafka 的分区有序性可以保证这一点，但前提是消息 key 设计正确。

**第四层：跨系统一致性**——源数据库的变更和下游系统的状态更新之间的一致性。

### 6.2 Debezium 的 Exactly-Once 支持

从 Debezium 2.0 开始，MySQL Connector 通过配合 Kafka Connect 的 Exactly-Once Source 语义（EOS）实现了精确一次投递：

```json
{
  "exactly.once.support": "required",
  "transaction.boundary": "insert",
  "transaction.boundary.interval.ms": "1000"
}
```

Kafka Connect 的 EOS 基于以下机制实现：

1. **幂等生产者（Idempotent Producer）**：通过 Producer 端的序列号（sequence number）机制，保证即使在网络重试的情况下，同一消息也不会被重复写入 Kafka
2. **事务性生产（Transactional Producer）**：将多个消息的发送和 source offset 的提交包装在一个 Kafka 事务中。要么全部成功，要么全部回滚
3. **Source Offset 绑定**：将数据库变更的 source offset（如 binlog 文件名 + 位置）与 Kafka offset 绑定。Connector 恢复时，从 Kafka 中存储的 source offset 重新开始，配合 EOS 保证不丢不重

### 6.3 下游消费者的幂等实现

无论上游是否做到 Exactly-Once，下游消费者都应实现幂等——这是分布式系统的基本防御性设计：

```php
<?php

namespace App\Consumers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\ProcessedEvent;

class IdempotentCdcConsumer
{
    /**
     * 幂等处理 CDC 事件。
     * 使用组合幂等键确保同一事件不会被重复处理。
     */
    public function handle(CdcMessage $message): void
    {
        // 构造幂等键：源表 + 源主键 + binlog 位置
        // 这个组合在全球范围内唯一，可以精确标识一个数据库变更事件
        $idempotencyKey = sprintf(
            '%s:%s:%s:%d',
            $message->sourceTable,
            $message->primaryKeyValue,
            $message->sourceFile,
            $message->sourcePosition
        );
        
        // 在事务中检查是否已处理并执行业务逻辑
        DB::transaction(function () use ($message, $idempotencyKey) {
            // 检查是否已处理过（使用悲观锁防止并发）
            $processed = ProcessedEvent::where('idempotency_key', $idempotencyKey)
                ->lockForUpdate()
                ->first();
            
            if ($processed) {
                Log::debug('跳过重复的 CDC 事件', [
                    'key' => $idempotencyKey,
                    'first_processed_at' => $processed->processed_at,
                ]);
                return;
            }
            
            // 执行业务逻辑
            $this->processEvent($message);
            
            // 记录已处理（在同一事务中，保证原子性）
            ProcessedEvent::create([
                'idempotency_key' => $idempotencyKey,
                'source_table' => $message->sourceTable,
                'source_offset' => $message->sourcePosition,
                'processed_at' => now(),
            ]);
        });
    }
    
    private function processEvent(CdcMessage $message): void
    {
        match ($message->operation) {
            'c', 'r' => $this->handleCreate($message),
            'u' => $this->handleUpdate($message),
            'd' => $this->handleDelete($message),
        };
    }
}
```

### 6.4 Transactional Outbox 模式详解

如果需要在 Laravel 应用中同时写入数据库和发送事件，而不想引入分布式事务，Transactional Outbox 模式是最佳实践：

```php
<?php

namespace App\Handlers\Commands;

use App\Models\Order;
use App\Models\OutboxEvent;
use App\Commands\CreateOrderCommand;
use Illuminate\Support\Facades\DB;

class CreateOrderHandler
{
    public function handle(CreateOrderCommand $command): Order
    {
        return DB::transaction(function () use ($command) {
            // 步骤 1：写入业务数据
            $order = Order::create([
                'customer_id' => $command->customerId,
                'status' => 'PENDING',
                'total_amount' => $command->totalAmount,
                'currency' => $command->currency,
            ]);
            
            // 步骤 2：写入 Outbox 表（同一个数据库事务）
            // 这保证了业务数据和事件记录的原子性——要么都成功，要么都失败
            OutboxEvent::create([
                'aggregate_type' => 'Order',
                'aggregate_id' => $order->id,
                'event_type' => 'OrderCreated',
                'payload' => json_encode([
                    'order_id' => $order->id,
                    'customer_id' => $order->customer_id,
                    'total_amount' => $order->total_amount,
                    'items' => $command->items,
                ]),
            ]);
            
            return $order;
        });
        // Debezium 通过 CDC 捕获 outbox 表的 INSERT 事件，
        // 然后使用 Outbox Event Router SMT 将其转发到业务事件主题
    }
}
```

## 七、Schema 演进与兼容性治理

### 7.1 Schema 演进的三种兼容性模式

在 CDC 架构中，源数据库的表结构变更是不可避免的业务需求。理解 Schema 演进的兼容性规则对于维护系统稳定至关重要：

**向后兼容（Backward Compatible）**：新 schema 可以读取用旧 schema 写入的数据。例如添加新列并设置默认值——新消费者遇到旧数据时，新列使用默认值填充。这是最安全的兼容性模式，生产环境推荐。

**向前兼容（Forward Compatible）**：旧 schema 可以读取用新 schema 写入的数据。例如删除列——旧消费者遇到新数据时，忽略多出的列。这要求消费者能容忍未知字段。

**完全兼容（Full Compatible）**：同时满足向后和向前兼容。最安全但限制最多——只能添加有默认值的可选列，不能删除或修改列。

### 7.2 常见 Schema 变更场景与处理策略

**场景一：添加新列（向后兼容，推荐）**

```sql
ALTER TABLE orders ADD COLUMN shipping_address TEXT DEFAULT NULL;
```

Debezium 会自动检测到 schema 变更。使用 Avro + Schema Registry 时，Schema Registry 会注册新版本的 schema。如果兼容性策略设置为 BACKWARD，此变更会被接受。

**场景二：删除列（不兼容，需要协调）**

```sql
ALTER TABLE orders DROP COLUMN legacy_field;
```

这是一个不兼容的变更。推荐的处理流程：
1. 确认所有消费者都不再使用 `legacy_field`
2. 先在 Schema Registry 中临时放宽兼容性策略
3. 执行 DDL 变更
4. 更新消费者代码
5. 恢复兼容性策略

**场景三：修改列类型（可能不兼容）**

```sql
ALTER TABLE orders MODIFY COLUMN total_amount DECIMAL(12,2);
```

从 DECIMAL(10,2) 改为 DECIMAL(12,2) 对 Avro 来说是兼容的（精度增加），但某些场景可能需要在 Schema Registry 中降低兼容性检查级别。

### 7.3 生产环境 Schema 治理实践

1. **统一使用 Avro + Schema Registry**：自动管理 schema 版本和兼容性，不兼容的变更在注册时就被拒绝
2. **设置严格的兼容性策略**：为关键主题设置 `BACKWARD` 或 `FULL` 兼容性，防止意外的不兼容变更
3. **蓝绿部署 Schema 变更**：先在测试环境验证 schema 变更不影响下游消费者
4. **Schema 变更与代码发布解耦**：在独立的维护窗口执行 DDL 变更，避免与代码发布耦合导致问题排查困难
5. **保留 schema 历史**：定期备份 Schema Registry 的数据，防止误操作导致 schema 历史丢失

## 八、实战：订单状态变更 CDC 流端到端实现

### 8.1 业务场景描述

一个电商系统需要将订单状态变更实时同步到多个下游系统：
- **Elasticsearch**：提供实时的订单搜索能力，支持按状态、时间、客户等维度搜索
- **Redis**：缓存订单最新状态，供高频查询接口使用，降低数据库压力
- **通知服务**：当订单状态发生变更时（如从 PENDING 变为 PAID），向用户发送通知
- **数据仓库**：将订单流转数据实时推送到 ClickHouse，支持业务分析师的实时看板

### 8.2 Laravel Kafka 消费者完整实现

```php
<?php

namespace App\Consumers\Cdc;

use App\Events\OrderStatusChanged;
use App\Models\Order;
use App\Models\ProcessedEvent;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OrderCdcConsumer
{
    /**
     * 消费 Kafka 主题 ecommerce.orders 的消息。
     * 
     * 注意：此消费者实现了幂等处理，同一个事件重复消费不会产生副作用。
     * 幂等键由源表、主键、binlog 文件和位置组成。
     */
    public function consume(string $topic, int $partition, string $key, string $message): void
    {
        $event = json_decode($message, true);
        
        if (!$event) {
            Log::warning('无法解析 CDC 消息', ['message' => $message]);
            return;
        }
        
        $op = $event['__op'] ?? $event['op'] ?? null;
        
        // 构造幂等键
        $idempotencyKey = $this->buildIdempotencyKey($event);
        
        // 幂等检查
        if (ProcessedEvent::where('idempotency_key', $idempotencyKey)->exists()) {
            Log::debug('跳过重复事件', ['key' => $idempotencyKey]);
            return;
        }
        
        DB::transaction(function () use ($op, $event, $idempotencyKey) {
            match ($op) {
                'c', 'r' => $this->handleInsert($event),
                'u' => $this->handleUpdate($event),
                'd' => $this->handleDelete($event),
                default => Log::warning('未知操作类型', ['op' => $op]),
            };
            
            // 记录已处理
            ProcessedEvent::create([
                'idempotency_key' => $idempotencyKey,
                'topic' => 'ecommerce.orders',
                'partition' => $partition,
                'offset' => $event['__source_ts_ms'] ?? 0,
                'processed_at' => now(),
            ]);
        });
    }
    
    private function handleInsert(array $event): void
    {
        $data = $event['after'] ?? $event;
        
        // 更新本地数据库
        Order::updateOrCreate(
            ['external_id' => $data['id']],
            [
                'customer_id' => $data['customer_id'],
                'status' => $data['status'],
                'total_amount' => $data['total_amount'],
                'updated_at' => $data['updated_at'] ?? now(),
            ]
        );
        
        // 同步到 Elasticsearch
        $this->syncToElasticsearch($data);
        
        // 更新 Redis 缓存
        $this->updateRedisCache($data);
    }
    
    private function handleUpdate(array $event): void
    {
        $before = $event['before'] ?? null;
        $after = $event['after'] ?? $event;
        $orderId = $after['id'];
        $oldStatus = $before['status'] ?? null;
        $newStatus = $after['status'];
        
        // 更新本地数据库
        Order::where('external_id', $orderId)->update([
            'status' => $newStatus,
            'total_amount' => $after['total_amount'],
            'updated_at' => $after['updated_at'] ?? now(),
        ]);
        
        // 同步到 Elasticsearch 和 Redis
        $this->syncToElasticsearch($after);
        $this->updateRedisCache($after);
        
        // 状态变更通知
        if ($oldStatus !== null && $oldStatus !== $newStatus) {
            event(new OrderStatusChanged(
                orderId: $orderId,
                oldStatus: $oldStatus,
                newStatus: $newStatus,
                source: 'cdc',
            ));
            
            Log::info('订单状态变更通知已触发', [
                'order_id' => $orderId,
                'from' => $oldStatus,
                'to' => $newStatus,
            ]);
        }
    }
    
    private function handleDelete(array $event): void
    {
        $data = $event['before'] ?? $event;
        $orderId = $data['id'];
        
        // 软删除
        Order::where('external_id', $orderId)->update(['deleted_at' => now()]);
        
        // 从 Elasticsearch 删除
        try {
            app('elasticsearch')->delete([
                'index' => 'orders',
                'id' => $orderId,
            ]);
        } catch (\Throwable $e) {
            Log::warning('从 ES 删除订单失败', ['order_id' => $orderId, 'error' => $e->getMessage()]);
        }
        
        // 清除缓存
        Cache::tags(['orders'])->forget("order:{$orderId}");
    }
    
    private function syncToElasticsearch(array $data): void
    {
        try {
            app('elasticsearch')->index([
                'index' => 'orders',
                'id' => $data['id'],
                'body' => [
                    'order_id' => $data['id'],
                    'customer_id' => $data['customer_id'],
                    'status' => $data['status'],
                    'status_label' => self::getStatusLabel($data['status']),
                    'total_amount' => (float) $data['total_amount'],
                    'updated_at' => $data['updated_at'] ?? now()->toIso8601String(),
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('同步到 ES 失败', ['order_id' => $data['id'], 'error' => $e->getMessage()]);
        }
    }
    
    private function updateRedisCache(array $data): void
    {
        Cache::tags(['orders'])->put(
            "order:{$data['id']}",
            $data,
            now()->addHours(24)
        );
    }
    
    private function buildIdempotencyKey(array $event): string
    {
        $source = $event['__source_file'] ?? $event['source']['file'] ?? '';
        $position = $event['__source_pos'] ?? $event['source']['pos'] ?? 0;
        $data = $event['after'] ?? $event['before'] ?? $event;
        $id = $data['id'] ?? 'unknown';
        
        return "orders:{$id}:{$source}:{$position}";
    }
    
    public static function getStatusLabel(string $status): string
    {
        return match ($status) {
            'PENDING' => '待支付',
            'PAID' => '已支付',
            'SHIPPING' => '配送中',
            'DELIVERED' => '已送达',
            'CANCELLED' => '已取消',
            'REFUNDED' => '已退款',
            default => $status,
        };
    }
}
```

### 8.3 处理 Debezium 特殊事件

Debezium 在某些场景下会产生需要特殊处理的事件：

```php
<?php

namespace App\Consumers\Cdc;

class CdcEventNormalizer
{
    /**
     * 规范化 Debezium 事件，处理各种特殊情况。
     */
    public function normalize(?string $rawMessage): ?array
    {
        // 1. 处理 tombstone 事件（Kafka 日志压缩用的 null 消息）
        if ($rawMessage === null || $rawMessage === 'null') {
            return null;
        }
        
        $event = json_decode($rawMessage, true);
        
        if (!$event) {
            Log::warning('CDC 消息 JSON 解析失败', ['raw' => substr($rawMessage, 0, 500)]);
            return null;
        }
        
        // 2. 处理 Debezium 心跳消息
        // 心跳消息只有 schema 和 ts_ms，没有 payload
        if (isset($event['schema']) && !isset($event['payload'])) {
            Log::debug('收到 Debezium 心跳消息');
            return null;
        }
        
        // 3. 处理 Schema 变更事件（发送到 schema-changes 主题）
        if (isset($event['databaseName']) && isset($event['ddl'])) {
            Log::info('收到 Schema 变更事件', [
                'database' => $event['databaseName'],
                'ddl' => $event['ddl'],
            ]);
            return null;
        }
        
        return $event;
    }
}
```

## 九、性能调优：Snapshot 与 Streaming 的平衡

### 9.1 快照阶段性能优化策略

对于大型表（百万到千万行），初始快照可能需要数小时甚至更长时间。以下策略可以显著缩短快照时间：

**使用增量快照（Incremental Snapshot）**：Debezium 2.0 引入的增量快照是最重要的优化。它不持有全局读锁，而是将表分成多个 chunk 逐步读取，读取期间不阻塞业务写入。

```json
{
  "snapshot.mode": "no_data",
  "incremental.snapshot.chunk.size": "1024"
}
```

**快照期间的生产者调优**：增加批量大小和压缩可以显著提升快照吞吐量。

```json
{
  "producer.override.batch.size": "65536",
  "producer.override.linger.ms": "50",
  "producer.override.compression.type": "lz4"
}
```

**只快照需要的列**：通过 `column.include.list` 减少每行的数据量，降低网络传输和 Kafka 存储开销。

### 9.2 流式捕获阶段性能调优

**Kafka Connect Worker 级调优**：

```json
{
  "producer.override.batch.size": "32768",
  "producer.override.linger.ms": "20",
  "producer.override.compression.type": "snappy",
  "producer.override.max.in.flight.requests.per.connection": "5"
}
```

**Debezium Connector 级调优**：

```json
{
  "max.batch.size": "2048",
  "max.queue.size": "8192",
  "poll.interval.ms": "500"
}
```

**只捕获必要的数据**：`column.include.list` 和 `table.include.list` 是最简单有效的优化。不仅减少数据量，还能降低 Schema Registry 的压力和下游消费者的处理负担。

### 9.3 吞吐量基准参考

在 3 节点 Kafka 集群（每节点 16 核 64GB 内存，NVMe SSD）的测试环境中：

| 场景 | 吞吐量 | 端到端延迟 |
|------|--------|-----------|
| MySQL → Kafka（JSON 序列化） | ~15,000 events/s | < 1s |
| MySQL → Kafka（Avro 序列化） | ~25,000 events/s | < 1s |
| PostgreSQL → Kafka（Avro 序列化） | ~20,000 events/s | < 2s |
| 初始快照（1000万行，每行约 500 字节） | ~50,000 rows/s | ~3-5 min |
| 增量快照（chunk=1024） | ~10,000 rows/s | 对业务无感知 |

## 十、监控与运维体系建设

### 10.1 Kafka Consumer Lag 监控

Consumer Lag 是最关键的运维指标，它反映了消费速度与生产速度的差距。持续增长的 lag 意味着消费者跟不上生产者，会导致数据延迟甚至内存溢出。

```bash
# 使用 kafka-consumer-groups.sh 命令行查看 lag
kafka-consumer-groups.sh \
  --bootstrap-server kafka-1:9092 \
  --describe \
  --group order-cdc-consumer-group

# 输出示例：
# GROUP              TOPIC               PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# order-cdc-consumer ecommerce.orders    0          1234567         1234890         323
# order-cdc-consumer ecommerce.orders    1          2345678         2345678         0
# order-cdc-consumer ecommerce.orders    2          3456789         3457890         1101
```

**Grafana 告警规则配置**：

```yaml
groups:
  - name: kafka-cdc-alerts
    rules:
      - alert: HighConsumerLag
        expr: kafka_consumergroup_lag_sum{consumergroup="order-cdc-consumer-group"} > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CDC 消费者 lag 超过阈值"
          description: "当前 lag 为 {{ $value }}，已持续 5 分钟"
          
      - alert: ConsumerLagGrowing
        expr: rate(kafka_consumergroup_lag_sum{consumergroup="order-cdc-consumer-group"}[10m]) > 100
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "CDC 消费者 lag 持续增长"
```

### 10.2 Debezium Connector 健康监控

```bash
# 查看 Connector 状态
curl -s http://kafka-connect:8083/connectors/mysql-ecommerce-connector/status | jq .

# 关键字段：
# .connector.state — 应为 "RUNNING"
# .tasks[0].state — 应为 "RUNNING"
# .tasks[0].trace — 如果有值，说明有错误
```

**自动化健康检查脚本**：

```bash
#!/bin/bash
CONNECT_URL="http://kafka-connect:8083"
CONNECTORS=("mysql-ecommerce-connector" "pg-ecommerce-connector")

for connector in "${CONNECTORS[@]}"; do
    STATUS=$(curl -sf "${CONNECT_URL}/connectors/${connector}/status" | jq -r '.connector.state')
    TASK_STATE=$(curl -sf "${CONNECT_URL}/connectors/${connector}/status" | jq -r '.tasks[0].state')
    
    if [ "$STATUS" != "RUNNING" ] || [ "$TASK_STATE" != "RUNNING" ]; then
        echo "ALERT: ${connector} 异常 — Connector:${STATUS}, Task:${TASK_STATE}"
        # 触发告警通知（Slack/PagerDuty/企业微信等）
    fi
done
```

### 10.3 关键监控指标汇总

| 指标 | 含义 | 告警阈值 |
|------|------|----------|
| Consumer Lag | 消费者落后生产者的消息数 | > 10,000 持续 5 分钟 |
| Connector State | Connector 运行状态 | ≠ RUNNING |
| MillisecondsSinceLastEvent | 距上次事件的时间 | > 300s（可能连接断开） |
| QueueRemainingCapacity | 事件队列剩余容量 | < 20% |
| SnapshotActive | 是否正在快照 | 持续 true 超过预期时间 |
| Replication Slot Lag (PG) | 复制槽 WAL 滞后量 | > 10GB |

## 十一、错误处理与死信队列

### 11.1 多层错误处理策略

生产环境的 CDC 系统需要多层次的错误处理机制：

**第一层：Debezium 内置错误处理**

```json
{
  "errors.log.enable": "true",
  "errors.log.include.messages": "true",
  "errors.tolerance": "none",
  "errors.deadletterqueue.topic.name": "dlq.cdc.errors",
  "errors.deadletterqueue.context.headers.enable": "true",
  "errors.retry.timeout.ms": "60000",
  "errors.retry.delay.max.ms": "1000"
}
```

**第二层：下游消费者错误处理**

```php
<?php

namespace App\Consumers;

class ResilientCdcConsumer
{
    public function consume(string $topic, int $partition, string $key, string $message): void
    {
        try {
            $event = $this->normalize($message);
            if (!$event) return;
            
            $this->processEvent($event);
        } catch (TransientException $e) {
            // 可重试的临时错误（如数据库连接超时）
            Log::warning('CDC 事件处理遇到临时错误，将重试', [
                'error' => $e->getMessage(),
                'topic' => $topic,
                'partition' => $partition,
            ]);
            throw $e; // 重新抛出，让 Kafka 消费者框架重试
            
        } catch (PermanentException $e) {
            // 不可重试的永久错误（如数据格式错误）
            Log::error('CDC 事件处理遇到永久错误，发送到 DLQ', [
                'error' => $e->getMessage(),
                'message' => substr($message, 0, 500),
            ]);
            $this->sendToDlq($message, $e);
            // 不重新抛出，跳过此消息继续消费
            
        } catch (\Throwable $e) {
            // 未知错误
            Log::error('CDC 事件处理遇到未知错误', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            throw $e;
        }
    }
    
    private function sendToDlq(string $originalMessage, \Throwable $error): void
    {
        app('kafka-producer')->send('dlq.cdc.consumer-errors', [
            'original_message' => $originalMessage,
            'error_class' => get_class($error),
            'error_message' => $error->getMessage(),
            'error_trace' => $error->getTraceAsString(),
            'failed_at' => now()->toIso8601String(),
        ]);
    }
}
```

### 11.2 死信队列消费者与人工介入

```php
<?php

namespace App\Consumers\Dlq;

class CdcDeadLetterQueueConsumer
{
    private int $maxRetries = 3;
    
    public function consume(string $topic, int $partition, string $key, string $message): void
    {
        $errorEvent = json_decode($message, true);
        
        $retryCount = $errorEvent['retry_count'] ?? 0;
        
        if ($retryCount < $this->maxRetries) {
            // 增加重试计数并重新处理
            $errorEvent['retry_count'] = $retryCount + 1;
            try {
                $this->retryProcess($errorEvent);
                return;
            } catch (\Throwable $e) {
                Log::warning('DLQ 重试失败', ['attempt' => $retryCount + 1]);
            }
        }
        
        // 超过最大重试次数，持久化并告警
        $this->persistForManualReview($errorEvent);
        $this->alertOps($errorEvent);
    }
    
    private function persistForManualReview(array $errorEvent): void
    {
        DB::table('cdc_failed_events')->insert([
            'original_topic' => $errorEvent['original_topic'] ?? 'unknown',
            'error_message' => $errorEvent['error_message'] ?? '',
            'raw_payload' => json_encode($errorEvent),
            'status' => 'pending_review',
            'created_at' => now(),
        ]);
    }
    
    private function alertOps(array $errorEvent): void
    {
        // 发送告警到运维团队
        Notification::route('slack', config('services.slack.ops_channel'))
            ->notify(new CdcDlqAlert($errorEvent));
    }
}
```

## 十二、真实踩坑记录与解决方案汇总

以下是生产环境中积累的踩坑记录，每一条都来自真实的问题排查经历。这些问题有些导致了数据不一致，有些导致了服务中断，有些导致了深夜的紧急告警。希望这些经验能帮助读者避免重蹈覆辙。

### 踩坑 #3：Debezium 快照事件被下游消费者误处理

> **现象**：Connector 首次启动做全量快照时，下游消费者收到大量消息后报错，因为这些消息的操作类型是 `r`（read）而不是预期的 `c`/`u`/`d`。
>
> **原因**：快照阶段读取的现有数据被标记为 `op: "r"`，下游消费者的 match 语句没有处理这个操作类型。
>
> **解决方案**：
> 1. 在消费者的 `match` 表达式中添加 `r` 类型处理（按 INSERT 处理）
> 2. 或者配置 `snapshot.mode=schema_only`，跳过数据快照（需要手动做数据迁移）
> 3. 或者在快照完成前不启动下游消费者（通过监控 Connector 状态判断）

### 踩坑 #4：MySQL 大事务导致 Kafka Connect Worker OOM

> **现象**：一次批量更新 500 万行的 SQL 操作导致 Kafka Connect Worker 进程内存溢出崩溃。
>
> **原因**：Debezium 将单个事务的所有变更事件缓存在内存中。500 万行变更会产生数 GB 的内存需求。
>
> **解决方案**：
> 1. 应用层分批操作：每 1000 行一个事务
> 2. 增加 Worker JVM 堆内存：从 2GB 增加到 8GB
> 3. 对于不可避免的大批量操作，临时停止 Connector，操作完成后再启动
> 4. 配置 `max.batch.size` 限制批处理大小

### 踩坑 #5：时区不一致导致数据错误

> **现象**：MySQL 中 `updated_at` 为北京时间 10:00，但消费者收到的值为 UTC 时间 02:00，导致业务逻辑判断错误。
>
> **原因**：Debezium 默认将时间戳转换为 UTC。MySQL 的 `TIMESTAMP` 列内部以 UTC 存储，`DATETIME` 列则没有时区信息，但 Debezium 会按 `database.connectionTimezone` 进行转换。
>
> **解决方案**：在 Connector 配置中指定 `database.connectionTimezone=Asia/Shanghai`，或在消费者端统一按 UTC 处理，只在展示层转换时区。

### 踩坑 #6：PostgreSQL TOAST 字段数据丢失

> **现象**：PostgreSQL 表更新非 TOAST 列时，TOAST 列的值在 CDC 事件中变为 `__debezium_unavailable_value`。
>
> **原因**：PostgreSQL 的 TOAST 机制在 WAL 中不记录未修改的 TOAST 列值，Debezium 用占位符表示。
>
> **解决方案**：配置 `unavailable.value.placeholder` 为可识别的占位符，在消费者中检测到占位符时从数据库查询原始值。或者将相关列设置为 `STORAGE EXTERNAL` 禁用 TOAST（以更大的存储空间为代价）。

### 踩坑 #7：Consumer Rebalance 导致重复消费

> **现象**：消费者组发生 rebalance 时，部分消息被消费了两次，导致通知重复发送。
>
> **原因**：Kafka 消费者的自动 offset 提交在 rebalance 时可能丢失未提交的 offset。
>
> **解决方案**：关闭自动 offset 提交（`enable.auto.commit=false`），在业务处理完成后手动同步提交 offset。配合幂等键确保即使重复消费也不会产生副作用。

### 踩坑 #8：Connector 重启后触发意外全量快照

> **现象**：Kafka Connect 集群滚动重启后，Connector 从头开始做全量快照，导致大量重复事件和处理延迟。
>
> **原因**：Distributed 模式下 offset 存储在 `connect-offsets` 内部主题中。如果该主题的配置不当（如 `cleanup.policy=delete` 且 retention 过短），offset 可能被清理。
>
> **解决方案**：确保 `connect-offsets` 主题的 `retention.ms=-1`（永不删除），`cleanup.policy=compact`。这三个内部主题（`connect-offsets`、`connect-configs`、`connect-status`）是 Kafka Connect 的命脉，必须妥善保护。

### 踩坑 #9：列名特殊字符导致 Avro Schema 注册失败

> **现象**：MySQL 表中列名包含 `#`、`-` 等特殊字符，Connector 启动后 Avro schema 注册失败。
>
> **原因**：Avro 字段名只允许 `[A-Za-z_][A-Za-z0-9_]*`，不兼容 MySQL 宽松的列名规则。
>
> **解决方案**：在建表时就避免使用特殊字符。已有表可以通过 `column.exclude.list` 排除问题列，或使用自定义 SMT 进行列名映射。

### 踩坑 #10：Schema History 主题被误删

> **现象**：MySQL Connector 的 `schema-changes.ecommerce` 主题因 `retention.ms` 到期被 Kafka 自动清理，Connector 重启后报错无法恢复。
>
> **原因**：MySQL Connector 依赖 Schema History 主题记录表结构的变更历史。主题数据丢失后，Connector 无法理解 binlog 中的变更事件。
>
> **解决方案**：Schema History 主题的 `retention.ms` 应设为 `-1`，`cleanup.policy` 设为 `compact`。同时配置 ACL 防止误操作。如果已经丢失，只能删除 Connector 重新创建并触发全量快照。

### 踩坑 #11：多 Connector 共享同一 PostgreSQL 复制槽

> **现象**：在同一 PostgreSQL 实例上配置了两个 Debezium Connector（生产环境和测试环境），它们使用了相同的 `slot.name`，导致测试 Connector 影响了生产 Connector 的数据消费。
>
> **原因**：PostgreSQL 的逻辑复制槽是全局唯一的。两个 Connector 使用同一个 slot 会导致事件被其中一个消费后，另一个永远收不到这些事件。
>
> **解决方案**：每个 Connector 必须使用独立的复制槽名称，如 `debezium_prod` 和 `debezium_test`。同时每个 Connector 的 `topic.prefix` 也要不同，避免 Kafka 主题冲突。

## 结语

Kafka + Debezium 的 CDC 方案为数据库变更事件流提供了一种可靠、高性能、低侵入的解决方案。当它与 Laravel Event Sourcing 结合使用时，可以形成互补的架构设计：

- **CDC 负责"数据层"的变更捕获与传播**：零侵入地将数据库变更广播到所有需要的下游系统，适合数据同步、搜索索引更新、缓存维护等场景
- **Event Sourcing 负责"业务层"的事件建模与流程编排**：用完整的业务意图和因果链来驱动领域逻辑，适合复杂状态管理、业务审计、事件重放等场景

两者并非互相替代的关系，而是在不同的抽象层次上发挥各自的优势。CDC 处理的是"数据发生了什么变化"（物理层事实），Event Sourcing 处理的是"业务执行了什么操作"（业务层意图）。在实际项目中，理解何时用 CDC、何时用 Event Sourcing、以及如何将两者结合，是架构师需要深入思考的核心问题。

CDC 技术虽然强大，但它也有自身的复杂性——从数据库 binlog 配置到 Schema 演进治理，从消费者幂等到死信队列处理，从性能调优到监控告警，每一个环节都需要精心设计和持续运维。希望本文中的实战配置、架构设计模式和踩坑记录能帮助你在实施 CDC 架构时少走弯路，构建出稳定可靠的事件驱动系统。

最后提醒一点：技术选型永远要服务于业务需求。如果你的系统只需要简单的数据同步，一个 Kafka + Debezium + 简单消费者就足够了。如果需要复杂的业务流程编排，再考虑引入 Event Sourcing。不要为了技术而技术，过度架构是另一种形式的技术债。

---

**参考资料：**

1. [Debezium 官方文档](https://debezium.io/documentation/) — 最权威的 Debezium 参考
2. [Kafka Connect 官方文档](https://kafka.apache.org/documentation/#connect) — Kafka Connect 框架文档
3. [Confluent Schema Registry 文档](https://docs.confluent.io/platform/current/schema-registry/) — Schema 管理最佳实践
4. [Designing Event-Driven Systems - Ben Stopford](https://www.confluent.io/designing-event-driven-systems/) — 事件驱动架构设计经典
5. [Debezium Deep Dive - Gunnar Morling](https://www.youtube.com/watch?v=9GJ2a8SVgmw) — Debezium 核心开发者的技术分享
6. [Laravel Event Sourcing - Spatie](https://spatie.be/docs/laravel-event-sourcing) — Laravel Event Sourcing 包文档

## 相关阅读

- [Data Mesh 实战：领域数据产品化——Laravel 微服务中的数据所有权、联邦治理与自助查询层](/categories/架构/Data-Mesh-实战-领域数据产品化-Laravel-微服务中的数据所有权联邦治理与自助查询层/)
- [Supabase 实战：开源 Firebase 替代——实时数据库、Auth、Edge Functions 与 Laravel B2C 集成](/categories/架构/Supabase-实战-开源Firebase替代-实时数据库Auth与Laravel集成/)
- [Schema Registry 实战：Confluent、Apicurio 与 API 契约演进——Schema 兼容性治理](/categories/架构/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/)
