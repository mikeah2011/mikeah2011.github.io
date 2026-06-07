# API 开发

## 定义
Laravel 提供了完整的 API 开发工具链，从数据转换到限流、从 BFF 聚合到 gRPC 通信。博客中覆盖了 API Resource、Rate Limiting、DTO、BFF、API 文档、gRPC、功能开关等实践。

## 核心原理

### API Resource（数据转换）
- Eloquent 模型到 JSON 的转换层
- Resource Collection vs 单个 Resource
- 条件字段（whenLoaded、whenPivotLoaded）
- 嵌套资源与关系预加载

### DTO（数据传输对象）
- spatie/laravel-data 强类型 DTO
- 请求验证与 DTO 自动映射
- API 响应规范化
- 类型安全的数据传递

### Rate Limiting（限流）
- Laravel 内置 throttle 中间件
- 自定义限流器（RateLimiter::for()）
- 滑动窗口、令牌桶算法
- 多维限流（全局→用户→接口）

### BFF（Backend-for-Frontend）
- 面向前端的中间层聚合服务
- GraphQL 到 JSON 转换优化
- 数据聚合与格式化
- Server-Driven UI 支持

### gRPC 微服务通信
- Proto 文件定义服务契约
- Deadline 透传与超时控制
- 连接复用与负载均衡
- Laravel 集成方案

### API 文档
- Scribe：Laravel 原生 API 文档生成
- SwaggerPHP：注解式 OpenAPI 规范
- 自动化文档与代码同步

### 功能开关
- Laravel Pennant 功能开关
- 灰度发布策略
- 用户级/群体级特性控制
- 从源码剖析到生产落地

### 消息总线
- NATS JetStream 消息削峰
- Ack 确认与重投机制
- KV 配置同步
- 与 Laravel Queue 集成

## 实战案例
来自博客文章：
- [Laravel API Resource 实战](/categories/PHP-Laravel/laravel-api-resource-bff/) - BFF 架构下数据转换
- [spatie/laravel-data DTO](/categories/PHP-Laravel/laravel-data-dto-guide/) - 强类型数据传输与 API 响应规范化
- [API Rate Limiting 限流实战](/categories/PHP-Laravel/api-rate-limiting/) - 接口限流踩坑
- [Laravel BFF 中间层聚合](/categories/PHP-Laravel/bff-laravel-guide/) - GraphQL 到 JSON 转换优化
- [Laravel + gRPC 微服务通信](/categories/PHP-Laravel/laravel-grpc-microservicesguide/) - Proto 定义与连接复用
- [Scribe vs SwaggerPHP](/categories/PHP-Laravel/scribe-vs-swaggerphp/) - API 文档生成工具对比
- [Laravel Pennant 功能开关](/categories/PHP-Laravel/2026-06-01-laravel-pennant-feature-flags/) - 灰度发布策略
- [Laravel + NATS JetStream](/categories/PHP-Laravel/laravel-nats-jetstream-guide/) - 订单通知削峰与 KV 配置同步
- [Laravel CQRS 实战](/categories/PHP-Laravel/laravel-cqrs-guide/) - 订单查询模型拆分

## 相关概念
- [路由与中间件](路由与中间件.md) - API 路由、中间件限流
- [认证与授权](认证与授权.md) - API 认证策略（Sanctum/Passport/JWT）
- [Eloquent 与数据库](Eloquent与数据库.md) - API Resource 的数据源
- → [架构设计知识图谱](../架构设计/index.md) - API 网关、BFF 模式、API 生命周期

## 常见问题
- **API Resource 和 toArray 的区别？** Resource 支持条件字段、关系预加载、分页元数据，更规范
- **gRPC 和 REST 选哪个？** 内部服务间高性能通信用 gRPC，对外 API 用 REST
- **限流阈值怎么定？** 根据业务场景压力测试结果设定，分用户等级差异化
