# 技术知识库总索引

> 面向 Laravel B2C 全栈开发者的交叉引用知识体系。从底层数据库到前端体验，从架构设计到 DevOps 运维，串联博客中的 200+ 篇实战文章。

## 📚 知识域导航

| 领域 | 概念数 | 核心关键词 |
|------|--------|------------|
| [MySQL 数据库](MySQL/index.md) | 44+ | 索引、B+树、事务、MVCC、锁、主从复制、分库分表、binlog 深度、乐观悲观锁、JSON 列、读写分离中间件、PostgreSQL 进阶、ClickHouse、TiDB、TimescaleDB、ScyllaDB、FerretDB、Supabase Realtime、ShardingSphere、零停机 DDL |
|| [Redis](Redis/index.md) | 16+ | 缓存、分布式锁、数据结构、消息队列、高可用、限流、持久化、内存管理、事务脚本、缓存写入模式 |
| [PHP / Laravel](PHP-Laravel/index.md) | 35+ | 服务容器、Eloquent、队列、认证、Octane、DDD |
| [架构设计](架构设计/index.md) | 33+ | DDD、CQRS、微服务、事件驱动、分布式事务、BFF、TCC、OpenFGA、WebTransport、API Mock |
| [DevOps](DevOps/index.md) | 20+ | Docker、K8s、CI/CD、Prometheus、SRE、Terraform |
| [前端](前端/index.md) | 27+ | Vue 3、Vite、Pinia、Nuxt 4、React、SolidJS、tRPC、TanStack Query、Signals |
| [消息队列](消息队列/index.md) | 7+ | Kafka、RabbitMQ、Pulsar、NATS、Outbox、消息可靠性、MQ 选型 |
| [AI Agent](AI-Agent/index.md) | 15+ | Function Calling、RAG、记忆系统、流式响应、评估、护栏、工作流编排 |
| [Go 语言](Go/index.md) | 10+ | goroutine、channel、Context、gRPC、泛型、错误处理、embed、FrankenPHP、RoadRunner |
| [Flutter 跨平台开发](Flutter/index.md) | 17 | Dart、Widget 体系、状态管理(Riverpod/Bloc)、GoRouter、Dio、Firebase、Platform Channel、性能优化、CI/CD |

---

## 🔗 跨域知识关联图

```
                         ┌─────────────────┐
                         │   AI Agent       │
                         │ LLM · RAG · 记忆 │
                         │ 评估 · 护栏 · 编排 │
                         └────────┬────────┘
                                  │ Function Calling / API
                        ┌─────────────────┐
                        │   前端 (Vue 3)   │
                        │ Vite · Nuxt · Pinia │
                        └────────┬────────┘
                                 │ API / BFF / Server-Driven UI
                        ┌────────▼────────┐
                        │   架构设计       │
                        │ DDD · CQRS · 微服务 │
                        │ 事件驱动 · 分布式事务 │
                        └───┬────────┬────┘
                            │        │
               ┌────────────▼──┐  ┌──▼────────────┐
               │  PHP / Laravel │  │    DevOps      │
               │ Eloquent · Queue│  │ Docker · K8s   │
               │ Octane · DDD   │  │ CI/CD · SRE    │
               └───┬────────┬──┘  └───────────────┘
                   │        │
          ┌────────▼──┐  ┌──▼────────┐  ┌─────────────┐
          │   MySQL    │  │   Redis    │  │  消息队列    │
          │ 索引 · 事务 │  │ 缓存 · 锁  │  │ Kafka · MQ  │
          │ 主从 · 分片 │  │ 限流 · MQ  │  │ NATS · Outbox│
          └───────────┘  └───────────┘  └─────────────┘
                            │
                   ┌────────▼────────┐
                   │  Flutter 跨平台  │
                   │ Dart · Widget · GoRouter│
                   │ Riverpod · Firebase │
                   └─────────────────┘
```

---

## 🗺️ 按场景导航

### 🛒 电商 B2C 全链路
- [DDD 领域驱动设计](架构设计/DDD领域驱动设计.md) → 聚合根、值对象
- [订单状态机](架构设计/订单状态机.md) → 有限状态机、事件驱动
- [分布式事务](架构设计/分布式事务.md) → Saga/TCC/本地消息表
- [Redis 缓存策略](Redis/缓存策略.md) → 缓存穿透/击穿/雪崩防护
- [MySQL 索引优化](MySQL/索引创建原则.md) → EXPLAIN 分析、覆盖索引
- [电商秒杀系统](架构设计/限流与高并发.md) → Redis 预扣减 + MQ 异步

### ⚡ 高并发与性能
- [限流与高并发](架构设计/限流与高并发.md) → 滑动窗口、令牌桶
- [分布式限流算法](Redis/分布式限流算法.md) → Redis Cell、Lua 原子脚本
- [Laravel Octane](PHP-Laravel/性能优化.md) → Swoole/RoadRunner 高性能
- [PHP 高性能运行时](PHP-Laravel/性能优化.md) → OPcache/Octane/Fiber 选型
- [实时通信方案](架构设计/实时通信方案.md) → SSE vs WebSocket vs HTTP Streaming
- [并发模型对比](架构设计/并发模型对比.md) → Actor/Elixir OTP/Go goroutine

### 🏗️ 微服务架构
- [微服务架构](架构设计/微服务架构.md) → 拆分策略、服务边界
- [API 网关](架构设计/API网关.md) → Kong/APISIX 统一路由鉴权限流
- [BFF 模式](架构设计/BFF模式.md) → Backend-for-Frontend 中间层聚合
- [单元化架构](架构设计/单元化架构.md) → Cell-Based 故障隔离
- [事件驱动架构](架构设计/事件驱动架构.md) → 领域事件、Event Sourcing
- [CDC 与事件流](架构设计/CDC与事件流.md) → Debezium binlog 捕获

### 🚀 部署与运维
- [Docker 容器化](DevOps/Docker容器化.md) → 镜像构建、多阶段构建
- [Kubernetes 容器编排](DevOps/Kubernetes/index.md) → Pod/Deployment/Helm/GitOps
- [CI/CD 流水线](DevOps/CI-CD流水线.md) → GitHub Actions 矩阵策略
- [Prometheus 监控告警](DevOps/Prometheus监控告警.md) → PromQL、Grafana 面板
- [SRE 与可靠性工程](DevOps/SRE与可靠性工程.md) → SLI/SLO/Error Budget
- [蓝绿部署与零停机发布](DevOps/蓝绿部署与零停机发布.md) → 流量切换、一键回滚

### 📨 消息队列与事件流
- [MQ 选型对比](消息队列/MQ选型对比.md) → Kafka vs RabbitMQ vs Pulsar vs NATS
- [Kafka 深度实战](消息队列/Kafka深度实战.md) → 高吞吐事件流、Exactly-Once
- [Outbox 模式](消息队列/Outbox模式.md) → 数据库与 MQ 最终一致性
- [消息可靠性保障](消息队列/消息可靠性保障.md) → 幂等消费、死信队列、重试策略

### 🖥️ 前端工程化
### 📱 跨平台移动端
- [Dart 语言基础与 Widget 体系](Flutter/Dart语言基础与Widget体系.md) → StatelessWidget/StatefulWidget、三树架构
- [状态管理选型](Flutter/状态管理选型.md) → Riverpod vs Bloc vs GetX
- [路由与导航](Flutter/路由与导航.md) → GoRouter 声明式路由、深链接
- [网络请求与 API 对接](Flutter/网络请求与API对接.md) → Dio 拦截器、Token 刷新、Laravel 对接
- [Firebase 与 BaaS](Flutter/Firebase与BaaS.md) → Auth/Firestore/FCM 一体化后端
- [性能优化](Flutter/性能优化.md) → DevTools 分析、渲染优化、包体积裁剪
- [混合开发与 Platform Channel](Flutter/混合开发与Platform-Channel.md) → 原生模块集成、Pigeon 代码生成
- [CI/CD 与发布](Flutter/CICD与发布.md) → GitHub Actions 自动化、多平台打包
- [Vue 3 Composition API](前端/Vue3-Composition-API.md) → ref/reactive/computed
- [Pinia 状态管理](前端/Pinia状态管理.md) → 替代 Vuex 的现代方案
- [Vite 深度实战](前端/Vite深度实战.md) → 构建优化、HMR
- [Nuxt 4 全栈框架](前端/Nuxt4全栈框架.md) → 服务器组件、SEO 优化
- [Core Web Vitals](前端/Core-Web-Vitals性能治理.md) → LCP/INP/CLS 优化
- [微前端架构](前端/微前端架构.md) → qiankun 样式隔离
- [Signals 响应式范式](前端/Signals响应式范式.md) → Angular/Vue/Solid/Preact 底层原理
- [Vue 3.5 新特性](前端/Vue3.5新特性.md) → useId/useTemplateRef/useDeferredValue
- [CSS Container Queries](前端/CSS-Container-Queries与View-Transitions.md) → 组件级响应式设计
- [React 19 编译器](前端/React19编译器.md) → 自动记忆化取代 useMemo/useCallback
- [React 状态管理选型](前端/React状态管理选型.md) → Zustand vs Jotai vs Redux
- [TanStack Query](前端/TanStack-Query服务端状态.md) → 服务端状态缓存与乐观更新
- [tRPC 端到端类型安全](前端/tRPC端到端类型安全.md) → TypeScript 全栈 API 层
- [SolidJS 细粒度响应式](前端/SolidJS细粒度响应式.md) → 无 VDOM 极致性能

---

## 📖 推荐学习路径

### 全栈开发者（从后端到前端）
1. [PHP 语言基础](PHP-Laravel/PHP语言基础.md) → 2. [Laravel 框架核心](PHP-Laravel/Laravel框架核心.md) → 3. [Eloquent 与数据库](PHP-Laravel/Eloquent与数据库.md)
2. → 4. [MySQL 索引](MySQL/索引概念.md) → 5. [Redis 缓存](Redis/缓存策略.md) → 6. [队列与事件系统](PHP-Laravel/队列与事件系统.md)
3. → 7. [Vue 3 Composition API](前端/Vue3-Composition-API.md) → 8. [Vite 构建](前端/Vite深度实战.md) → 9. [Nuxt 4](前端/Nuxt4全栈框架.md)

### 架构师（从单体到微服务）
1. [DDD 领域驱动](架构设计/DDD领域驱动设计.md) → 2. [六边形架构](架构设计/六边形架构.md) → 3. [CQRS 模式](架构设计/CQRS模式.md)
2. → 4. [微服务架构](架构设计/微服务架构.md) → 5. [分布式事务](架构设计/分布式事务.md) → 6. [API 网关](架构设计/API网关.md)
3. → 7. [事件驱动架构](架构设计/事件驱动架构.md) → 8. [CDC 与事件流](架构设计/CDC与事件流.md) → 9. [单元化架构](架构设计/单元化架构.md)

### DevOps 工程师（从容器化到平台工程）
### Flutter 移动端开发者（从入门到生产）
1. [Dart 语言基础与 Widget 体系](Flutter/Dart语言基础与Widget体系.md) → 2. [状态管理选型](Flutter/状态管理选型.md) → 3. [路由与导航](Flutter/路由与导航.md)
2. → 4. [网络请求与 API 对接](Flutter/网络请求与API对接.md) → 5. [本地存储方案](Flutter/本地存储方案.md) → 6. [主题与国际化](Flutter/主题与国际化.md)
3. → 7. [Firebase 与 BaaS](Flutter/Firebase与BaaS.md) → 8. [测试体系](Flutter/测试体系.md) → 9. [CI/CD 与发布](Flutter/CICD与发布.md)
4. → 10. [性能优化](Flutter/性能优化.md) → 11. [错误监控与崩溃收集](Flutter/错误监控与崩溃收集.md) → 12. [热更新与动态化](Flutter/热更新与动态化.md)
1. [Docker 容器化](DevOps/Docker容器化.md) → 2. [CI/CD 流水线](DevOps/CI-CD流水线.md) → 3. [Kubernetes 基础](DevOps/Kubernetes/K8s基础.md)
2. → 4. [Prometheus 监控](DevOps/Prometheus监控告警.md) → 5. [OpenTelemetry](DevOps/OpenTelemetry可观测性.md) → 6. [SRE 可靠性](DevOps/SRE与可靠性工程.md)
3. → 7. [Terraform IaC](DevOps/基础设施即代码.md) → 8. [蓝绿部署](DevOps/蓝绿部署与零停机发布.md) → 9. [平台工程](DevOps/开发者门户与平台工程.md)

---

## 📊 知识库统计

| 维度 | 数量 |
|------|------|
| 知识域 | 9 个 |
| Wiki 概念页 | 226+ 篇 |
| 关联博客文章 | 240+ 篇 |
| 跨域关联 | 每个域 4 条出链 |
| 学习路径 | 3 条完整路径 |

---

## 🔄 更新日志
- **2026-06-07 (MySQL 新兴数据库扩展)** — MySQL 域新增 8 个概念页：ClickHouse + Laravel 集成（MergeTree 引擎家族、物化视图实时聚合、电商埋点 OLAP）、TiDB NewSQL 分布式 SQL（MySQL 兼容、计算存储分离、TiFlash HTAP）、ShardingSphere 分片中间件（Proxy 代理分片、跨片查询降级、全局 ID）、FerretDB 文档数据库（PostgreSQL 驱动的 MongoDB 替代、协议转换架构）、TimescaleDB 时序数据库（Hypertable、连续聚合、数据保留策略）、ScyllaDB 高性能 NoSQL（Seastar 框架、C++ Cassandra 重写、10 倍吞吐）、Supabase Realtime（Broadcast/Presence/Postgres Changes 三大实时能力）、Schema 迁移与零停机 DDL（gh-ost/pt-osc/Instant DDL）；整合 15+ 篇博客文章；更新 MySQL 域概念计数 36+ → 44+，总概念页计数 218+ → 226+
- **2026-06-07 (Flutter)** — 新增 Flutter 跨平台开发知识域：17 个概念页覆盖 Dart 语言基础与 Widget 体系（三树架构/生命周期/Key）、状态管理选型（Riverpod vs Bloc vs GetX）、路由与导航（GoRouter 声明式路由/深链接/嵌套路由）、网络请求与 API 对接（Dio 拦截器/Token 刷新/Laravel 对接）、本地存储方案（Hive vs Isar vs SQLite/离线优先）、响应式布局（折叠屏/平板/断点适配）、主题与国际化（ThemeData/暗黑模式/RTL）、自定义 Widget 与动画（CustomPainter/手势）、实时通信（WebSocket/心跳/重连）、Firebase 与 BaaS（Auth/Firestore/FCM）、测试体系（Unit/Widget/Integration 三层）、CI/CD 与发布（GitHub Actions/多平台打包）、性能优化（DevTools/渲染/包体积）、推送通知（FCM/APNs/厂商通道）、错误监控与崩溃收集（Sentry/Crashlytics）、热更新与动态化（Shorebird Code Push）、混合开发与 Platform Channel（原生模块集成/Pigeon）；整合 21 篇博客文章；更新总索引知识域计数 8 → 9，概念页计数 204+ → 218+
- **2026-06-07 (MySQL 扩展)** — MySQL 域新增 10 个概念页：binlog 深度实战（Row/Statement/Mixed 格式对比、CDC、数据恢复）、乐观锁与悲观锁（SELECT FOR UPDATE vs 版本号）、JSON 列深度实战（JSON_EXTRACT、Generated Column、Multi-Valued Index）、读写分离中间件（ProxySQL/MaxScale 透明路由、主从延迟治理）、慢查询监控（MySQL Performance Schema + pg_stat_statements）、PostgreSQL 事务隔离级别（RC/RR/Serializable + SSI）、PostgreSQL Advisory Lock（会话级互斥、PgBouncer 兼容性）、PostgreSQL 高级索引（Partial Index + Expression Index）、PostgreSQL Vacuum 调优（autovacuum 参数、表膨胀治理）、PostGIS 空间查询（地理围栏、路径规划、对比 Redis Geo）；更新 MySQL 域概念计数 25+ → 36+；整合 10+ 篇博客文章
- **2026-06-07 (消息队列)** — 新增消息队列知识域：7 个概念页覆盖 MQ 选型对比（Kafka vs RabbitMQ vs Pulsar vs NATS vs Redis Stream）、Kafka 深度实战（分区/消费者组/Exactly-Once）、RabbitMQ 与 AMQP（Exchange 路由/死信队列/延迟消息）、Apache Pulsar（多租户/计算存储分离）、NATS 与 JetStream（轻量消息/KV 存储）、Outbox 模式（Debezium CDC/轮询/事务消息三种转发机制）、消息可靠性保障（幂等消费/死信队列/重试策略）；整合 15+ 篇博客文章；更新总索引知识域计数 7 → 8，概念页计数 187+ → 194+
- **2026-06-06 (MySQL + 架构设计)**
- **2026-06-06 (架构设计)** — 架构设计域新增 5 个概念页：API Mock 策略（WireMock/Mockoon/MSW 三层 Mock 体系）、数据契约与契约测试（Pact 消费者驱动契约 + Breaking Change 检测）、WebTransport（HTTP/3 QUIC 双向通信 + 数据报模式）、TCC 分布式事务（Try-Confirm-Cancel 资源预留 + 空回滚/悬挂处理）、OpenFGA 细粒度授权（Zanzibar ReBAC 关系型访问控制）；更新架构设计域概念计数 28+ → 33+
- **2026-06-06 (Redis)** — Redis 域新增 4 个概念页：Redis 持久化（RDB/AOF/混合持久化）、Redis 内存管理（淘汰策略/大Key治理/maxmemory）、Redis 事务与脚本（MULTI/EXEC/Lua/Pipeline）、缓存写入模式（Cache-Aside/Write-Through/Write-Back/Write-Around）；更新 Redis 域概念计数 12+ → 16+；新增关键概念导航表条目与学习路径扩展
- **2026-06-06 (PHP/Laravel)** — 新增 PHP/Laravel 知识域：15 个概念页覆盖 PHP 语言基础、Composer 生态、Laravel 框架核心、路由与中间件、架构模式、Eloquent 与数据库、认证与授权、队列与事件系统、API 开发、性能优化、测试体系、代码质量治理、实时通信、部署与运维；122+ 篇博客文章交叉引用；修复根索引中 PHP-Laravel 域的旧链接
- **2026-06-06 (前端)** — 前端域新增 5 个概念页：React 19 编译器（自动记忆化）、React 状态管理选型（Zustand/Jotai/Redux 对比）、TanStack Query 服务端状态管理、tRPC 端到端类型安全 API、SolidJS 细粒度响应式；更新前端域概念计数 22+ → 27+
- **2026-06-05 (前端)** — 前端域新增 3 个概念页：CSS Container Queries 与 View Transitions（组件级响应式设计）、Signals 响应式范式对比（Angular/Vue/Solid/Preact 四大方案底层原理）、Vue 3.5 新特性实战（useId/useTemplateRef/useDeferredValue）；更新前端域概念计数 20+ → 22+
- **2026-06-05 (AI Agent)** — 新增 AI Agent 知识域：15 个概念页覆盖 Function Calling、RAG 架构、记忆系统、流式响应、错误恢复、工作流编排、评估体系、调试可观测性、安全护栏、多租户、成本优化、知识管理、多平台集成、框架对比、MLOps、LLM 推理基础设施；MySQL 域新增分区表概念

- **2026-06-05 (补充)** — MySQL 域整合 7 个孤立页面（主键设计、数据类型选型、三范式与反范式、SQL 查询流程、窗口函数、CTE 递归查询、MySQL 9.x 新特性）；Redis 缓存策略新增与架构设计域的跨域关联
- **2026-06-05** — 创建总索页；新增 Rust 异步生态、Apache Flink 流批一体、Laravel Modular Monolith、AI Agent Observability 等 wiki 页面
- **2026-06-04** — MySQL 域新增 PlanetScale/Neon/Database Branching/Migration-Free Schema；DevOps 域新增 Kubernetes 子目录（10 个子页面）
- **2026-06-03** — 架构设计域新增 Data Mesh、CDC 事件流、API Composition、Server-Driven UI、SQLite 现代化
- **2026-06-02** — 前端域新增 Nuxt 4、HTMX、SvelteKit、Tailwind CSS v4；DevOps 域新增 Grafana Loki、OpenTelemetry、分布式追踪
