# 架构设计知识图谱

> 面向 Hexo 博客文章整理的架构设计 Wiki。本索引串联 DDD、CQRS、事件驱动、微服务、分布式事务、BFF、API 网关、CAP 定理、限流高并发、六边形架构、单元化、数据网格、CDC、零信任、API 安全、API 生命周期等核心概念。

## 核心概念

### 🏗️ 设计范式
- [DDD 领域驱动设计](DDD领域驱动设计.md) - 聚合根、值对象、领域事件、Bounded Context
- [CQRS 模式](CQRS模式.md) - 命令查询职责分离，读写模型独立演进
- [六边形架构](六边形架构.md) - 端口与适配器模式，依赖反转
- [事件驱动架构](事件驱动架构.md) - 领域事件、Event Sourcing、事件风暴
- [模块化单体架构](模块化单体架构.md) - Modular Monolith，单体内模块边界、渐进式微服务化

### 🔀 分布式系统
- [微服务架构](微服务架构.md) - 拆分策略、服务边界、通信模式
- [分布式事务](分布式事务.md) - Saga/TCC/本地消息表，最终一致性
- [TCC 分布式事务](TCC分布式事务.md) - Try-Confirm-Cancel 三阶段、资源预留、空回滚与悬挂
- [CAP 定理](CAP定理.md) - 一致性/可用性/分区容错性取舍，BASE 理论
- [单元化架构](单元化架构.md) - Cell-Based Architecture，故障隔离与独立扩缩

### 🌐 服务治理
- [API 网关](API网关.md) - Kong/APISIX、统一路由鉴权限流
- [BFF 模式](BFF模式.md) - Backend-for-Frontend 中间层聚合
- [API 安全加固](API安全加固.md) - JWT、请求签名、防重放、多层防御
- [API 生命周期管理](API生命周期管理.md) - 版本控制、废弃通知、Schema 演进
- [API Mock 策略](API-Mock策略.md) - WireMock/Mockoon/MSW 三层 Mock 体系，前后端并行开发
- [数据契约与契约测试](数据契约与契约测试.md) - Pact 消费者驱动契约、Breaking Change 检测
- [OpenFGA 细粒度授权](OpenFGA细粒度授权.md) - Zanzibar 模型、ReBAC 关系型访问控制

### ⚡ 高并发
- [限流与高并发](限流与高并发.md) - 滑动窗口、令牌桶、秒杀系统设计
- [实时通信方案](实时通信方案.md) - SSE vs WebSocket vs HTTP Streaming 工程选型
- [WebTransport](WebTransport.md) - HTTP/3 双向通信、QUIC 协议、数据报模式
- [并发模型对比](并发模型对比.md) - Actor/Elixir OTP/Kotlin Coroutines/Python asyncio/Go goroutine
- [分布式缓存一致性](分布式缓存一致性.md) - Cache-Aside/Write-Through/Write-Behind 双写问题

### 🔄 工作流与状态管理
- [分布式锁选型](分布式锁选型.md) - Redis Redlock vs Zookeeper vs etcd：一致性、性能、公平性对比
- [幂等性设计](幂等性设计.md) - Idempotency Key、请求去重、结果缓存、分布式锁三层防护
- [渐进式迁移模式](渐进式迁移模式.md) - Strangler Fig Pattern、Anti-Corruption Layer、双轨策略
- [事件通知与状态传输](事件通知与状态传输.md) - Event Notification vs Event-Carried State Transfer 的信息量与耦合权衡
- [分布式工作流引擎](分布式工作流引擎.md) - Temporal.io 持久化工作流、Saga 编排
- [订单状态机](订单状态机.md) - 有限状态机、XState 可视化、事件驱动状态流转
- [事件最终一致性](事件最终一致性.md) - Outbox/Inbox 模式、幂等性、补偿事务

### 📊 流处理与实时计算
- [流批一体计算引擎](流批一体计算引擎.md) - Apache Flink 窗口聚合、Exactly-Once、Flink SQL CDC

### 🌐 跨语言与运行时
- [Monorepo 构建策略](Monorepo构建策略.md) - Nx vs Turborepo vs Pants：依赖图、增量构建、远程缓存
- [舱壁隔离模式](舱壁隔离模式.md) - Bulkhead Pattern：连接池/队列隔离、故障域设计
- [分布式应用运行时](分布式应用运行时.md) - Dapr Sidecar 模式、服务调用与发布订阅
- [跨语言高性能框架](跨语言高性能框架.md) - Rust Axum/Go gRPC/FastAPI/Ktor/Swift Vapor/WebAssembly
- [边缘数据库与SQLite现代化](边缘数据库与SQLite现代化.md) - libSQL/Turso/Litestream/Supabase

### 📐 工程治理
- [技术债务治理](技术债务治理.md) - 技术债务四象限、Boy Scout Rule、20% 规则
- [API治理进阶](API治理进阶.md) - API Composition/AsyncAPI/ADR 架构决策记录
- [工程效能度量](工程效能度量.md) - SPACE 框架、Platform Engineering、Golden Paths

### 🔒 安全架构
- [零信任架构](Zero-Trust架构.md) - 永不信任、始终验证、最小权限

### 📊 数据架构
- [数据网格](Data-Mesh.md) - 去中心化数据所有权、数据产品化、联邦治理
- [CDC 与事件流](CDC与事件流.md) - Debezium binlog 捕获、Schema Registry、事件流
- [Outbox 模式](Outbox模式.md) - 数据库与 MQ 双写一致性、Debezium CDC/轮询/事务消息三种转发机制

### 🤖 AI Agent 架构
- [AI Agent 可观测性](AI-Agent可观测性.md) - LangSmith/LangFuse/Helicone 成本追踪、延迟分析、回归测试

### 🖥️ 前端架构
- [Server-Driven UI](Server-Driven-UI.md) - 后端驱动前端渲染、JSON UI 描述协议

## 实战文章（来自博客）

### DDD 系列
- [DDD 领域驱动设计实战：B2C 电商聚合根、值对象、领域事件在 Laravel 中的落地踩坑记录](/2026/05/05/ddd-guide-laravel/) - KKday B2C 实战
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论](/2026/06/01/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/) - 领域建模工作坊

### CQRS 与事件溯源
- [CQRS 模式实战：读写分离架构在 Laravel 中的落地](/2026/05/05/cqrs-guide-architecture-laravel-queryperformance/) - 查询性能优化
- [Domain Events 解耦实战：用事件驱动替代 Service Layer 直接调用](/2026/05/05/domain-events-guide-service-layer/) - 胖 Service 重构
- [Laravel Event-Sourcing 入门实战：事件溯源在 B2C 电商中的应用](/2026/05/05/laravel-event-sourcing-getting-startedguide-b2c-use-cases/) - 订单生命周期追踪
- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/2026/06/01/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/)

### 微服务系列
- [Strangler Fig Pattern 深度实战：Laravel 单体到微服务的渐进式迁移](/2026/06/06/2026-06-06-Strangler-Fig-Pattern-深度实战-Laravel单体到微服务的渐进式迁移/)
- [Event Notification vs Event-Carried State Transfer 实战](/2026/06/06/2026-06-06-event-notification-vs-event-carried-state-transfer/)
- [Idempotency Key 深度实战：API 幂等性的三层防护](/2026/06/06/2026-06-06-Idempotency-Key-深度实战-API幂等性的三层防护/)
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd](/2026/06/06/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/)
- [Bulkhead Pattern 实战：舱壁隔离——Laravel HTTP Client/Queue/DB 连接池](/2026/06/06/bulkhead-pattern-laravel-bulkhead-isolation/)
- [Technical Debt Quadrant 实战：象限法分类技术债务](/2026/06/06/technical-debt-quadrant-practice/)
- [Monorepo 深度实战：Nx vs Turborepo vs Pants](/2026/06/06/2026-06-06-Monorepo-深度实战-Nx-vs-Turborepo-vs-Pants-大型Laravel前端项目构建缓存与任务编排/)
- [Hexagonal Architecture 进阶实战：对比 Clean Architecture 的落地差异](/2026/06/06/2026-06-06-hexagonal-architecture-laravel-port-adapter-clean-architecture/)
- [AI Agent Context Window 管理实战：对话裁剪、摘要压缩、滑动窗口策略](/2026/06/06/2026-06-06-AI-Agent-Context-Window-管理实战-对话裁剪-摘要压缩-滑动窗口策略/)
- [微服务拆分策略：从单体 Laravel 到微服务的渐进式演进踩坑记录](/2026/05/05/microservices-laravelmicroservices/) - 30+ 仓库经验
- [Monorepo vs Polyrepo：30+ 仓库架构选型与管理经验](/2026/05/05/monorepo-vs-polyrepo-30-architecture/) - 仓库管理策略
- [Cell-Based Architecture 实战：单元化架构在 Laravel 微服务中的落地——故障隔离、独立扩缩与跨单元路由](/2026/06/01/Cell-Based-Architecture-实战-单元化架构在Laravel微服务中的落地-故障隔离独立扩缩与跨单元路由/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/2026/06/01/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)

### 分布式事务
- [分布式事务实战：Saga 模式在订单/库存/支付中的应用](/2026/05/16/distributedtransactionguide-saga/) - 补偿事务设计

### 服务治理
- [API Gateway 实战：Kong/APISIX 在 Laravel 微服务中的应用](/2026/05/16/api-gateway-guide-kong-apisix-laravel-microservices-rate-limitingcanary/) - 统一鉴权限流
- [BFF Laravel 中间层聚合实战](/2026/05/04/bff-laravel/) - Search/Recommend/Member 数据聚合
- [BFF vs GraphQL：何时用 BFF 而非直接调用 API？](/2026/05/02/bff-vs-graphql/) - 三种方案对比
- [服务注册与发现实战：Consul/Nacos 与 Laravel 集成](/2026/05/16/service-discovery-consul-nacos/) - 动态路由与健康检查
- [链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用](/2026/05/16/distributed-tracing-jaeger-skywalking/) - OpenTelemetry 接入

### 限流与高并发
- [API 限流实战：Rate Limiting、滑动窗口、令牌桶算法](/2026/05/16/api-rate-limitingguide-rate-limiting/) - 三种限流策略
- [电商秒杀系统设计：Redis 预扣减 + 消息队列异步下单 + 限流策略实战](/2026/06/01/2026-06-01-flash-sale-system-design-redis-pre-deduction-mq-async-ordering-rate-limiting/) - 三层防线设计
- [分布式限流算法深度对比：滑动窗口/令牌桶/漏桶/Redis Cell 的适用场景与 Laravel 实现](/2026/06/01/2026-06-03-分布式限流算法深度对比-滑动窗口令牌桶漏桶Redis-Cell与Laravel实现/)

### 安全与 API 治理
- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——Laravel B2C API 多层防御深度踩坑记录](/2026/06/01/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
- [API 生命周期管理实战：设计、版本控制、废弃通知、客户端迁移——Sunset Header 与 Deprecation 标准](/2026/06/01/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/)
- [API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案](/2026/06/01/API-版本废弃策略实战-Sunset-Header-Deprecation-通知与客户端迁移的工程化方案/)
- [Zero Trust 架构实战：从 VPN 到零信任——Laravel 微服务中的身份验证与网络分段](/2026/06/01/Zero-Trust-架构实战-从VPN到零信任-Laravel微服务中的身份验证与网络分段/)

### 数据架构
- [Data Mesh 实战：领域数据产品化——Laravel 微服务中的数据所有权、联邦治理与自助查询层](/2026/06/01/2026-06-03-Data-Mesh-实战-领域数据产品化-Laravel-微服务中的数据所有权联邦治理与自助查询层/)
- [Data Mesh 深度实践篇：Laravel 微服务数据产品化、联邦治理与自助查询层的工程落地](/2026/06/01/Data-Mesh-深度实践篇-Laravel微服务数据产品化联邦治理与自助查询层的工程落地/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/2026/06/01/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [Schema Registry 实战：Confluent/Apicurio API 契约演进——事件驱动系统中的 Schema 兼容性治理](/2026/06/01/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/)
- [事件驱动架构全景实战：EventBridge/NATS/Pulsar 统一事件总线设计——从点对点到发布订阅的演进](/2026/06/01/事件驱动架构全景实战-EventBridge-NATS-Pulsar-统一事件总线设计/)

### 实时通信与并发
- [SSE vs WebSocket vs HTTP Streaming 实时通信方案工程选型](/2026/06/03/SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/) - 三种方案对比
- [Actor 模型实战：从 Akka 到 Elixir 到 PHP——用消息传递替代共享状态的并发架构演进](/2026/06/01/Actor模型实战-从Akka到Elixir到PHP-用消息传递替代共享状态的并发架构演进/) - 并发模型演进
- [Elixir OTP 实战：Supervisor 树、GenServer 分布式进程——对比 PHP-FPM 无状态模型](/2026/06/01/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/) - 函数式并发
- [Kotlin Coroutines 深度实战：挂起函数、结构化并发、Flow](/2026/06/01/Kotlin-Coroutines-深度实战-挂起函数结构化并发Flow与PHP-Fibers-Go-goroutine并发模型对比/) - 结构化并发
- [Python asyncio 深度实战：事件循环、协程调度与 aiohttp](/2026/06/01/Python-asyncio-深度实战-事件循环-协程调度与-aiohttp/) - 异步 IO

### 跨语言高性能
- [Rust Axum 实战：用 Rust 构建高性能 HTTP API](/2026/06/01/Rust-Axum-实战-用Rust构建高性能HTTP-API-路由中间件数据库连接池与Laravel对比/) - Rust Web 框架
- [Go gRPC 实战：高性能微服务通信](/2026/06/01/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/) - gRPC 流式调用
- [FastAPI 实战：高性能 Python API 框架](/2026/06/01/FastAPI-实战-高性能-Python-API-框架-Pydantic校验-依赖注入与OpenAPI自动生成/) - Python 异步框架
- [Ktor 实战：Kotlin 原生 HTTP 框架](/2026/06/01/Ktor-实战-Kotlin原生HTTP框架-异步服务端客户端开发与Laravel-API性能基准对比/) - Kotlin 服务端
- [Swift Vapor 实战：用 Swift 写后端 API](/2026/06/02-Swift-Vapor-实战-用-Swift-写后端-API-与-Laravel-架构对比与性能基准/) - Swift 服务端
- [WebAssembly 后端实战：WasmEdge/Wasmtime 边缘计算与 Serverless](/2026/06/01/WebAssembly-后端实战-WasmEdge-Wasmtime-边缘计算与Serverless/) - Wasm 后端

### 边缘数据库与 BaaS
- [SQLite 现代化实战：libSQL/Turso 边缘数据库与 Laravel 集成](/2026/06/03/SQLite-现代化实战-libSQL-Turso-边缘数据库-Laravel集成/) - 边缘数据库
- [Litestream 实战：SQLite 流式复制与灾难恢复](/2026/06/03/Litestream-实战-SQLite流式复制与灾难恢复-零依赖高可用方案/) - 零依赖高可用
- [Supabase 实战：开源 Firebase 替代——实时数据库、Auth 与 Laravel 集成](/2026/06/03/Supabase-实战-开源Firebase替代-实时数据库Auth与Laravel集成/) - BaaS 平台

### 工作流与状态管理
- [Temporal.io 实战：持久化工作流引擎——Laravel 中的长事务编排与 Saga 模式工程化替代](/2026/06/01/Temporal-io-实战-持久化工作流引擎-Laravel中的长事务编排与Saga模式的工程化替代方案/) - 工作流引擎
- [订单状态机实战：用 Laravel + XState 实现复杂订单流转](/2026/06/01/订单状态机实战-用Laravel-XState实现复杂订单流转-可视化状态图与事件驱动/) - 状态机可视化
- [事件最终一致性实战：电商工程中的 Outbox/Inbox/Saga 模式](/2026/06/01/eventual-consistency-in-ecommerce-engineering/) - 最终一致性

### 分布式运行时与治理
- [Dapr 实战：分布式应用运行时——Laravel 微服务的 Sidecar 模式](/2026/06/01/Dapr-实战-分布式应用运行时-Laravel微服务的Sidecar模式服务调用与发布订阅/) - Sidecar 运行时
- [API Composition Pattern 实战：跨服务查询聚合——Laravel BFF scatter-gather](/2026/06/03/API-Composition-Pattern-实战-跨服务查询聚合-Laravel-BFF-scatter-gather/) - 查询聚合
- [AsyncAPI 实战：事件驱动架构的 API 规范](/2026/06/01/AsyncAPI-实战-事件驱动架构的API规范-Laravel微服务中的事件文档化Mock与代码生成/) - 异步 API 规范
- [ADR 实战：用 Markdown 管理架构决策](/2026/06/01/Architectural-Decision-Records-ADR-实战-用Markdown管理架构决策/) - 架构决策记录

### 工程效能
- [SPACE 框架度量开发者效能——DORA 之外的代码质量、协作效率与满意度追踪](/2026/06/01/Developer-Productivity-Metrics-SPACE框架度量开发者效能-DORA之外的代码质量协作效率与满意度追踪/) - 效能度量
- [Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化微服务脚手架](/2026/06/01/Platform-Engineering-实战-Golden-Paths-与服务模板-用Backstage自助创建标准化Laravel微服务脚手架/) - 平台工程
- [分布式缓存一致性实战：Cache-Aside/Write-Through/Write-Behind 在 Laravel 中的工程化落地](/2026/06/01/分布式缓存一致性实战-Cache-Aside-Write-Through-Write-Behind在Laravel中的工程化落地/) - 缓存一致性

### 前端架构
- [Server-Driven UI 实战：后端驱动前端渲染——JSON UI 描述协议在 Laravel BFF 中的落地与对比传统 SPA](/2026/06/01/server-driven-ui-laravel-bff/)

### 模块化单体
- [Laravel Modular Monolith 实战：模块化单体架构——介于单体与微服务之间的最佳平衡点](/2026/06/04/laravel-modular-monolith-microservices-best-balance/)

### 流处理
- [Apache Flink 实战：流批一体计算引擎——Laravel 事件流的实时聚合、窗口计算与 Exactly-Once 语义](/2026/06/05/apache-flink-laravel-streaming-window-exactly-once/)

### AI Agent
- [AI Agent Observability 进阶：LangSmith vs LangFuse vs Helicone 实战](/2026/06/05/ai-agent-observability-langsmith-langfuse-helicone/)
- [Rust 异步生态对比：Tokio vs async-std vs Smol](/2026/06/05/rust-async-ecosystem-tokio-async-std-smol/)

### 理论基础
- [分布式之 CAP 与 BASE](/2020/07/20/cap-theorem/) - 三选二与工程化补丁
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/2026/06/01/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) - 依赖反转实践

## 学习路径

```
入门 ─────────────────────────────────────────────────────────── 进阶

1. CAP 定理 → 2. DDD 领域驱动设计 → 3. 六边形架构
                                         │
                                         ▼
4. 事件驱动架构 → 5. CQRS 模式 → 6. 微服务架构
                                         │
                                         ▼
7. 分布式事务 → 8. API 网关 → 9. BFF 模式
                                         │
                                         ▼
10. 限流与高并发 → 11. 实时通信方案 → 12. 并发模型对比
                                         │
                                         ▼
13. 分布式缓存一致性 → 14. 订单状态机 → 15. 事件最终一致性
                                         │
                                         ▼
16. 分布式工作流引擎 → 17. 分布式应用运行时 → 18. 跨语言高性能框架
                                         │
                                         ▼
19. 边缘数据库与SQLite现代化 → 20. API治理进阶 → 21. 工程效能度量
                                         │
                                         ▼
22. 单元化架构 → 23. API 安全加固 → 24. 零信任架构
                                         │
                                         ▼
25. CDC 与事件流 → 26. 数据网格 → 27. Server-Driven UI
                                         │
                                         ▼
28. API 生命周期管理 → 29. 实战踩坑
```

## 知识关联图

```
CAP 定理 ──→ BASE 理论 ──→ 最终一致性
                │
                ▼
        分布式事务（Saga / TCC / 本地消息表）
                │
                ▼
        微服务架构 ──→ 服务注册发现（Consul / Nacos）
                │
                ├──→ API 网关（Kong / APISIX）──→ 限流 / 熔断 / 灰度
                │                                    │
                ├──→ BFF 模式 ──→ 数据聚合 / Server-Driven UI
                │
                ├──→ 链路追踪（Jaeger / SkyWalking）
                │
                └──→ 单元化架构（Cell-Based）──→ 故障隔离 / 独立扩缩

DDD ──→ 聚合根 / 值对象 / 领域事件
  │
  ├──→ 六边形架构（端口与适配器）
  │
  ├──→ 事件驱动架构 ──→ Event Sourcing（事件溯源）
  │         │
  │         ├──→ CDC（Debezium / Kafka）──→ Schema Registry
  │         │
  │         └──→ 事件总线（EventBridge / NATS / Pulsar）
  │
  └──→ CQRS ──→ 读写分离 ──→ ES 读模型

数据网格 ──→ 领域数据产品 ──→ 联邦治理 / 自助平台

API 安全 ──→ JWT / 签名 / 防重放
  │
  └──→ 零信任架构 ──→ mTLS / 微分段 / 最小权限

API 生命周期 ──→ 版本控制 / Sunset Header / Schema 兼容性

限流 ──→ 滑动窗口 / 令牌桶
  │
  └──→ 秒杀系统 ──→ Redis 预扣减 + MQ 异步下单

实时通信 ──→ SSE / WebSocket / HTTP Streaming
  │
  └──→ BFF 模式 ──→ Server-Driven UI

并发模型 ──→ Actor / Elixir OTP / Kotlin Coroutines / asyncio
  │
  └──→ PHP-FPM 无状态 ──→ Octane / Swoole / Fibers

分布式工作流 ──→ Temporal.io / Saga 编排
  │
  └──→ 订单状态机 ──→ XState / 事件驱动状态流转

事件最终一致性 ──→ Outbox / Inbox / 幂等性
  │
  └──→ 分布式事务（Saga / TCC）──→ CDC 事件流

分布式缓存一致性 ──→ Cache-Aside / Write-Through / Write-Behind
  │
  └──→ 双写问题 ──→ Binlog CDC 延迟双删

Dapr ──→ Sidecar 运行时 ──→ 服务调用 / 发布订阅 / 状态管理

跨语言框架 ──→ Rust Axum / Go gRPC / FastAPI / Ktor / Swift Vapor / Wasm
  │
  └──→ 异构微服务 ──→ 热点模块重写 / 边缘计算

边缘数据库 ──→ libSQL/Turso / Litestream / Supabase
  │
  └──→ SQLite 现代化 ──→ WAL 模式 / 流式复制 / BaaS

API 治理 ──→ API Composition / AsyncAPI / ADR
  │
  └──→ 事件文档化 ──→ Schema 兼容性 / Mock 测试

工程效能 ──→ SPACE 框架 / Platform Engineering / Golden Paths
  │
  └──→ 开发者体验 ──→ Backstage / 服务模板 / 自助平台
```

## 概念速查
- | 幂等性 | 同一操作执行多次效果相同 | [幂等性设计](幂等性设计.md) |
- | Idempotency Key | 客户端生成的请求去重键 | [幂等性设计](幂等性设计.md) |
- | Strangler Fig | 旧系统逐步替换为新系统的迁移模式 | [渐进式迁移模式](渐进式迁移模式.md) |
- | ACL | Anti-Corruption Layer，新旧系统翻译层 | [渐进式迁移模式](渐进式迁移模式.md) |
- | Event Notification | 事件仅携带最小信息，消费者回调获取详情 | [事件通知与状态传输](事件通知与状态传输.md) |
- | Event-Carried State Transfer | 事件携带完整数据，消费者自足 | [事件通知与状态传输](事件通知与状态传输.md) |
- | Redlock | Redis 分布式锁算法 | [分布式锁选型](分布式锁选型.md) |
- | Bulkhead | 舱壁隔离，资源隔离防故障扩散 | [舱壁隔离模式](舱壁隔离模式.md) |
- | 技术债务四象限 | 谨慎/鲁莽 × 有意/无意 分类 | [技术债务治理](技术债务治理.md) |
- | Boy Scout Rule | 每次修改顺手改进代码 | [技术债务治理](技术债务治理.md) |
- | Monorepo | 单一代码仓库管理多项目 | [Monorepo构建策略](Monorepo构建策略.md) |
- | Nx | Angular 团队的 Monorepo 构建工具 | [Monorepo构建策略](Monorepo构建策略.md) |
- | Turborepo | Vercel 的 Monorepo 构建工具 | [Monorepo构建策略](Monorepo构建策略.md) |
- | 事件通知 | 仅通知发生了什么，不携带数据 | [事件通知与状态传输](事件通知与状态传输.md) |
- | 状态传输 | 事件携带完整业务数据 | [事件通知与状态传输](事件通知与状态传输.md) |

| 概念 | 一句话 | 关联页面 |
|------|--------|----------|
| DDD | 以业务领域为中心的建模方法论 | [DDD 领域驱动设计](DDD领域驱动设计.md) |
| 聚合根 | 一组关联对象的入口，保证业务不变量 | [DDD 领域驱动设计](DDD领域驱动设计.md) |
| 值对象 | 无唯一标识，通过属性值判断相等 | [DDD 领域驱动设计](DDD领域驱动设计.md) |
| CQRS | 读写模型分离，各自独立优化 | [CQRS 模式](CQRS模式.md) |
| Event Sourcing | 存储事件序列而非当前状态 | [事件驱动架构](事件驱动架构.md) |
| Saga | 可补偿的分布式事务编排 | [分布式事务](分布式事务.md) |
| BFF | 面向前端的中间层聚合服务 | [BFF 模式](BFF模式.md) |
| CAP | 一致性/可用性/分区容错三选二 | [CAP 定理](CAP定理.md) |
| 令牌桶 | 平滑限流算法，允许突发流量 | [限流与高并发](限流与高并发.md) |
| 六边形架构 | 业务逻辑不依赖外部设施 | [六边形架构](六边形架构.md) |
| 单元化架构 | Cell-Based，故障隔离与独立扩缩 | [单元化架构](单元化架构.md) |
| Data Mesh | 去中心化数据所有权与数据产品化 | [数据网格](Data-Mesh.md) |
| CDC | 从数据库日志捕获变更事件 | [CDC 与事件流](CDC与事件流.md) |
| Schema Registry | 事件 Schema 兼容性治理 | [CDC 与事件流](CDC与事件流.md) |
| 零信任 | 永不信任、始终验证、最小权限 | [零信任架构](Zero-Trust架构.md) |
| API 安全 | JWT + 签名 + 防重放多层防御 | [API 安全加固](API安全加固.md) |
| API 生命周期 | 设计→发布→版本→废弃→退役 | [API 生命周期管理](API生命周期管理.md) |
| Sunset Header | API 废弃通知的 HTTP 标准 | [API 生命周期管理](API生命周期管理.md) |
| Server-Driven UI | 后端控制前端页面结构 | [Server-Driven-UI](Server-Driven-UI.md) |
| SSE | 服务端推送事件，单向实时通道 | [实时通信方案](实时通信方案.md) |
| WebSocket | 全双工实时通信 | [实时通信方案](实时通信方案.md) |
| Actor 模型 | 消息传递并发，无共享状态 | [并发模型对比](并发模型对比.md) |
| Temporal.io | 持久化确定性工作流引擎 | [分布式工作流引擎](分布式工作流引擎.md) |
| Dapr | 分布式应用运行时 Sidecar | [分布式应用运行时](分布式应用运行时.md) |
| Turso/libSQL | 边缘 SQLite 数据库 | [边缘数据库与SQLite现代化](边缘数据库与SQLite现代化.md) |
| AsyncAPI | 事件驱动 API 规范 | [API治理进阶](API治理进阶.md) |
| ADR | 架构决策记录 | [API治理进阶](API治理进阶.md) |
| SPACE | 开发者效能五维度量框架 | [工程效能度量](工程效能度量.md) |
| 订单状态机 | 有限状态机驱动订单流转 | [订单状态机](订单状态机.md) |
| Outbox 模式 | 本地事务+事件表保证最终一致性 | [事件最终一致性](事件最终一致性.md) |
| Cache-Aside | 应用层缓存读写策略 | [分布式缓存一致性](分布式缓存一致性.md) |
| 模块化单体 | 单体内模块边界，渐进式微服务化 | [模块化单体架构](模块化单体架构.md) |
| Flink | 流批一体计算引擎，窗口聚合+Exactly-Once | [流批一体计算引擎](流批一体计算引擎.md) |
| AI Agent 可观测性 | 成本追踪+延迟分析+回归测试 | [AI Agent 可观测性](AI-Agent可观测性.md) |
| API Mock | 三层 Mock 体系（MSW/Mockoon/WireMock） | [API Mock 策略](API-Mock策略.md) |
| 数据契约 | Pact 消费者驱动契约、Breaking Change 检测 | [数据契约与契约测试](数据契约与契约测试.md) |
| WebTransport | HTTP/3 双向通信、QUIC、数据报模式 | [WebTransport](WebTransport.md) |
| TCC | Try-Confirm-Cancel 资源预留分布式事务 | [TCC 分布式事务](TCC分布式事务.md) |
| OpenFGA | Zanzibar 模型、ReBAC 关系型授权 | [OpenFGA 细粒度授权](OpenFGA细粒度授权.md) |

## 跨领域关联

- → [MySQL 知识图谱](../MySQL/index.md)：事务 ACID、MVCC、锁机制 → 分布式事务基础
- → [Redis 知识图谱](../Redis/index.md)：分布式锁、Lua 脚本 → 限流实现、秒杀预扣减
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：Eloquent ORM、事件系统、队列 → DDD 基础设施层
- → [前端知识图谱](../前端/index.md)：微前端架构、BFF 模式、前后端分离、Server-Driven UI
- → [DevOps 知识图谱](../DevOps/index.md)：CI/CD 流水线、容器化部署、可观测性

## 🔄 最近更新
- **2026-06-06** — 架构设计域新增 7 个概念页：幂等性设计（Idempotency Key 三层防护）、渐进式迁移模式（Strangler Fig + ACL）、事件通知与状态传输（Notification vs ECST 选型）、分布式锁选型（Redis/ZK/etcd 对比）、Monorepo 构建策略（Nx/Turborepo/Pants）、舱壁隔离模式（Bulkhead 隔离策略）、技术债务治理（四象限 + 偿还策略）；新增博客文章链接 10+；概念计数 33+ → 40+

- **2026-06-06** — 架构设计域新增 5 个概念页：API Mock 策略（WireMock/Mockoon/MSW 三层体系）、数据契约与契约测试（Pact CDC + Breaking Change 检测）、WebTransport（HTTP/3 QUIC 双向通信）、TCC 分布式事务（Try-Confirm-Cancel 资源预留）、OpenFGA 细粒度授权（Zanzibar ReBAC）；更新概念计数 28+ → 33+
