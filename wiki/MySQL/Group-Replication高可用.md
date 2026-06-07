# MySQL Group Replication 高可用

## 定义

MySQL Group Replication（MGR）是 MySQL 5.7.17 引入的高可用复制方案，基于 **Paxos 协议**实现多节点数据强一致性。多个 MySQL 实例组成一个复制组（Group），通过组内广播事务确保所有节点以相同顺序接收和应用变更，支持自动故障检测与成员管理。

## 核心原理

### 复制技术演进

| 模式 | 一致性 | 故障转移 | 适用场景 |
|------|--------|---------|---------|
| 异步复制 | 弱（可能丢数据） | 需人工/工具切换 | 低一致性要求、读扩展 |
| 半同步复制 | 中（至少1个Slave确认） | 需人工/工具切换 | 一般业务、容忍极小丢数据窗口 |
| **Group Replication** | **强（Paxos 多数派确认）** | **自动故障转移** | 金融/电商、零数据丢失 |

### Paxos 协议核心机制

MGR 使用类 Paxos 的组通信协议（XCom），核心保证：

1. **原子广播（Atomic Broadcast）**：消息要么被所有节点按相同顺序接收，要么都不接收
2. **多数派确认（Majority Quorum）**：事务需获得组内多数节点确认才可提交
3. **冲突检测（Certification）**：多主模式下，基于行级 GTID 检测写冲突并回滚后到的事务

```
┌─────────────────────────────────────────────────────────┐
│              Group Replication 架构概览                    │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │  Node 1  │   │  Node 2  │   │  Node 3  │            │
│  │ (Primary)│   │(Secondary)│   │(Secondary)│            │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘            │
│       │              │              │                    │
│       └──────────────┼──────────────┘                    │
│                      │                                   │
│               ┌──────▼──────┐                            │
│               │  XCom (Paxos)│                            │
│               │  Group        │                            │
│               │  Communication│                            │
│               └──────────────┘                            │
│                                                          │
│  所有事务通过 Paxos 广播 → 多数派确认 → 提交/回滚          │
└─────────────────────────────────────────────────────────┘
```

### 单主 vs 多主模式

| 维度 | 单主模式（推荐） | 多主模式 |
|------|---------------|---------|
| 写入节点 | 仅 Primary 可写 | 所有节点可写 |
| 冲突处理 | 无需冲突检测 | 需要行级冲突检测与回滚 |
| 性能 | 高（无冲突开销） | 中（冲突检测开销） |
| 故障转移 | 自动选举新 Primary | 自动剔除故障节点 |
| 适用场景 | 大多数生产场景 | 特定的多活架构 |

### InnoDB Cluster

InnoDB Cluster 是 MySQL 官方的完整高可用解决方案，包含三个组件：

- **Group Replication**：数据复制与一致性保证
- **MySQL Shell**：集群管理与配置工具
- **MySQL Router**：透明读写代理（应用无需感知拓扑变化）

### 自动故障转移流程

```
1. Node 1 (Primary) 宕机
         ↓
2. XCom 检测心跳超时（默认 5 秒）
         ↓
3. 剩余节点投票选举新 Primary
         ↓
4. MySQL Router 感知拓扑变更
         ↓
5. 应用连接自动切换到新 Primary
         ↓
6. Node 1 恢复后自动加入组，同步数据后变 Secondary
```

## 与传统方案对比

| 方案 | 数据一致性 | 自动Failover | 多主写入 | 外部依赖 |
|------|-----------|-------------|---------|---------|
| 异步复制 + MHA | 弱（可丢数据） | 半自动（MHA） | 不支持 | MHA/Orchestrator |
| 半同步复制 | 中 | 需手动 | 不支持 | 无 |
| **MGR** | **强** | **全自动** | **支持** | 无（内置） |
| Galera Cluster | 强 | 全自动 | 支持 | Galera 插件 |
| Orchestrator | 弱-中 | 半自动 | 不支持 | Orchestrator 服务 |

## 实战案例

来自博客文章：[MySQL Group Replication 实战：多主复制与自动故障转移](/2026/06/06/MySQL-Group-Replication-实战-多主复制与自动故障转移/)

关键实战要点：
- 3 节点集群搭建全流程（`group_replication_group_name`、`loose-group_replication_start_on_boot`）
- MySQL Router 代理配置（读写分离路由策略）
- Laravel 应用层对接（无需感知底层拓扑变化）
- Prometheus 监控方案（`mysql_group_replication_*` 指标）
- 生产踩坑：网络分区处理、大事务限制、DDL 操作需单主模式下执行

## 相关概念

- [主从复制与读写分离](主从复制与读写分离.md) - MGR 的前身技术
- [MySQL日志](MySQL日志.md) - binlog 是复制的基础
- [数据库连接池](数据库连接池.md) - MySQL Router 的连接管理
- [锁机制](锁机制.md) - MGR 多主模式的冲突检测机制

## 常见问题

**Q: MGR 最少需要几个节点？**
A: 3 个节点（Paxos 多数派要求）。2 个节点无法容忍任何单点故障。

**Q: MGR 和 Galera Cluster 怎么选？**
A: MySQL 5.7+ 优先选 MGR（官方原生、与 InnoDB Cluster 生态深度集成）。Galera 适合 Percona/MariaDB 生态。

**Q: MGR 支持 GTID 吗？**
A: 必须开启 GTID（`gtid_mode=ON`），GTID 是 MGR 冲突检测的基础。

**Q: 单主模式下 Primary 故障，切换时间是多少？**
A: 默认 5 秒检测 + 投票选举约 1-2 秒，总计约 5-10 秒。可通过 `group_replication_member_expulsion_timeout` 调整。
