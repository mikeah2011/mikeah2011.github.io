---
title: 分布式之 CAP 与 BASE
tags:
  - 分布式架构
  - CAP
  - BASE
categories:
  - 架构
date: 2020-07-20 11:15:49
description: 分布式系统设计绕不开的两个理论：CAP（一致性/可用性/分区容错性三选二）与 BASE（基本可用 + 最终一致性）。本文用例子讲清楚怎么取舍、为什么 P 必选。
---

# 一句话

> 分布式系统里，**C / A / P 三者最多只能满足两个**。又因为网络分区一定会发生（P 不可避免），所以现实中你只能在 **CP** 与 **AP** 之间二选一。

# CAP 三个字母

| 字母 | 含义 | 通俗理解 |
|---|---|---|
| **C**onsistency | 一致性 | 任何时候读到的数据都是最新写入的 |
| **A**vailability | 可用性 | 每次请求都能在合理时间内返回响应（不超时、不报错） |
| **P**artition tolerance | 分区容错性 | 节点之间网络断开/丢包时，系统仍能继续工作 |

## 为什么必选 P

只要是「分布式」系统，节点之间靠网络通讯，就**一定会**遇到丢包、延迟、机房断网。**P 不是一个选项，是事实**。所以真正在选的，是 **CP** 还是 **AP**：

- **CP**：网络分区时，宁可拒绝服务也要保证强一致 → ZooKeeper、etcd、HBase
- **AP**：网络分区时，宁可返回旧数据也要保证可用 → Cassandra、Eureka、DNS

# 一个具体例子

主从两节点 MySQL，主从间网络断了：

- **CP 派**：从库直接拒绝读请求（避免读到旧数据）→ 一致但不可用
- **AP 派**：从库继续返回旧数据 → 可用但不一致

> 注意：CAP 里的「一致性」是 **强一致性**（线性一致性 / 顺序一致性），不是日常语境的"数据正确"。

# BASE：AP 的工程化补丁

CAP 是理论极端，工程上多数业务并不需要"每次读到的都是当下最新"。**BASE** 是 eBay 工程师对 AP 的工程化总结：

| 字母 | 含义 | 实际做法 |
|---|---|---|
| **B**asically **A**vailable | 基本可用 | 部分功能/性能降级，核心可用（限流、熔断、降级） |
| **S**oft state | 软状态 | 允许中间状态存在（订单"处理中"、消息"投递中"） |
| **E**ventually consistent | 最终一致 | 一段时间后数据收敛到一致（异步同步、补偿、对账） |

## 最终一致的常见手段

- **消息队列**：写主库 → 发 MQ → 其它服务异步消费更新
- **定时对账**：每日 T+1 跑账，发现不一致就补
- **TCC / Saga**：拆成 Try-Confirm-Cancel 或可补偿的子事务
- **读修复 / 反熵**：Cassandra 风格的后台一致性修复

# CAP vs ACID vs BASE

| 视角 | 单机数据库 | 分布式（强一致派） | 分布式（最终一致派） |
|---|---|---|---|
| 模型 | ACID | CP（CAP 中选 CP） | AP + BASE |
| 例子 | MySQL 单实例 | ZooKeeper、etcd | Cassandra、DynamoDB |
| 取舍 | 不用考虑分区 | 牺牲可用性 | 牺牲强一致 |

# 选型速查

| 业务 | 推荐 | 原因 |
|---|---|---|
| 配置中心、服务注册表 | **CP**（etcd、ZK） | 配错比看不到更可怕 |
| 服务发现（高可用优先） | **AP**（Eureka、Nacos AP） | 拿到旧节点列表也比拿不到强 |
| 商品详情页、信息流 | **AP** + 缓存 | 读多写少，最终一致足够 |
| 支付、库存扣减 | **CP** 或强一致中间件 | 钱出错没法解释 |
| 消息系统 | 看场景 | Kafka 偏 AP；RabbitMQ 镜像队列偏 CP |

# 常见误区

1. **"NoSQL 都是 AP"** —— 错。MongoDB 主从用 majority 写就是 CP；Cassandra 也能调到接近 CP。
2. **"我有事务就有 C"** —— 单机 ACID 的 C 跟 CAP 的 C 不是一回事，前者是数据库约束，后者是多副本可见性。
3. **"BASE 是 NoSQL 专属"** —— BASE 本质是工程取舍思路，传统业务一样用：MQ + 对账就是典型 BASE。

# 参考

- Eric Brewer, *CAP Twelve Years Later: How the "Rules" Have Changed*: <https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/>
- Dan Pritchett, *BASE: An Acid Alternative*: <https://queue.acm.org/detail.cfm?id=1394128>
