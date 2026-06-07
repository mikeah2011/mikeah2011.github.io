# PHP / Laravel 知识图谱

> 面向 Hexo 博客文章整理的 PHP 与 Laravel Wiki。本索引串联语言基础、框架核心、ORM、认证授权、队列事件、API 开发、性能优化、测试、代码质量、实时通信与部署运维。

## 知识地图

### 🐘 PHP 语言基础
- [PHP 语言基础](PHP语言基础.md) - OOP、类型系统、Fibers、GC、版本演进、设计模式
- [Composer 生态](Composer生态.md) - 自动加载、插件开发、私有仓库、脚本自动化

### 🚀 Laravel 框架核心
- [Laravel 框架核心](Laravel框架核心.md) - 服务容器、服务提供者、Facade、请求生命周期
- [路由与中间件](路由与中间件.md) - 路由注册、中间件栈、请求管道、链路追踪
- [架构模式](架构模式.md) - Controller-Service-Repository、DDD、CQRS、六边形架构

### 🗄️ Eloquent ORM 与数据库
- [Eloquent 与数据库](Eloquent与数据库.md) - 模型、迁移、查询构建器、Scopes、Casts/Accessors、全文搜索

### 🔐 认证与授权
- [认证与授权](认证与授权.md) - Sanctum/Passport、JWT、Policies/Gates、RBAC、WebAuthn/Passkey

### 📨 队列与事件系统
- [队列与事件系统](队列与事件系统.md) - Queue/Horizon、Events/Listeners、Jobs、Scheduler、EventSauce

### 🌐 API 开发
- [API 开发](API开发.md) - API Resource、Rate Limiting、DTO、BFF、API 文档、gRPC

### ⚡ 性能优化
- [性能优化](性能优化.md) - OPcache、Octane/Swoole、Fiber 并发、缓存策略

### 🧪 测试体系
- [测试体系](测试体系.md) - Pest、PHPUnit、Dusk E2E、Snapshot Testing、并发测试

### 📐 代码质量治理
- [代码质量治理](代码质量治理.md) - Pint、PHPStan、PHP-CS-Fixer、AI Code Review

### 📡 实时通信
- [实时通信](实时通信.md) - SSE、Laravel Reverb、WebSocket、FCM Web Push

### 🔧 部署与运维
- [部署与运维](部署与运维.md) - Docker Compose、Laravel Vapor、Laravel Cloud、Istio、NATS

## 实战文章（来自博客）

### PHP 语言系列
- [OOP - 面向对象](/categories/PHP/oop/) - 类、继承、多态、接口、抽象类
- [PHP 生命周期与 SAPI](/categories/PHP/lifecycle/) - CLI/FPM/CGI 生命周期差异
- [PHP 8.4 新特性实战](/categories/PHP/php-84/) - 内存管理与性能提升
- [PHP 8.2 readonly Classes](/categories/PHP-Laravel/php-82-readonly-classes-guide/) - 不可变对象与值对象设计
- [PHP 8.1 Fibers 实战](/categories/PHP-Laravel/php-81-fibers-guide/) - 协程并发请求与异步任务编排
- [PHP 8 Trait + Enum 重构实战](/categories/PHP-Laravel/php-8-trait-enum-laravel-30/) - 30+ Laravel 仓库经验
- [PHP Enum 替魔术字符串](/categories/PHP-Laravel/php-enum-30/) - 30+ 仓库重构经验
- [PHP 垃圾回收机制](/categories/PHP/gc/) - GC 原理与循环引用处理
- [PHP 自动加载类机制](/categories/PHP/autoloading/) - PSR-4 与 Composer autoload
- [依赖注入（DI）与 IoC 容器](/categories/PHP/dependency-injection/) - 控制反转原理
- [PHP 扩展开发入门](/categories/PHP/php-extension-development-guide/) - 用 C 写自定义扩展
- [进程、线程和协程](/categories/PHP/vs/) - 并发模型对比

### Laravel 框架核心
- [Laravel 服务容器深度解析](/categories/PHP-Laravel/laravel-container/) - 10 个真实踩坑记录
- [Laravel Service Container 实战](/categories/PHP-Laravel/service-container-guide/) - 依赖注入、上下文绑定、延迟加载
- [Controller-Service-Repository 三层架构](/categories/PHP-Laravel/controller-service-repository/) - 大项目职责分离
- [Controller 薄 + Service 厚](/categories/PHP-Laravel/controller-service-laravel/) - 职责分离踩坑记录
- [Laravel Middleware 实战](/categories/PHP-Laravel/middleware-guide/) - 请求链路追踪与踩坑记录
- [Laravel 12.x 新特性实战](/categories/PHP-Laravel/2026-06-01-laravel-12x-new-features/) - Context、Concurrency、Artisan 改进

### Eloquent 与数据库
- [Laravel Scopes 实战](/categories/PHP-Laravel/laravel-scopes-guide/) - 查询作用域封装与复用
- [Laravel Casts/Accessors 实战](/categories/PHP-Laravel/laravel-casts-accessors-guide/) - 数据类型转换与计算属性
- [Laravel Migrations 零停机变更](/categories/PHP-Laravel/laravel-migrations-database/) - 数据库变更与回滚策略
- [Laravel Full-Text Search](/categories/PHP-Laravel/laravel-full-text-search/) - 数据库原生全文搜索与 Scout 对比
- [Laravel + PostgreSQL RLS](/categories/PHP-Laravel/laravel-postgresql-rls-guide/) - 多租户数据隔离
- [Laravel + PostgreSQL SKIP LOCKED](/categories/PHP-Laravel/laravel-postgresql-skip-locked-guide/) - 任务出队与死锁规避
- [Laravel + PostgreSQL Advisory Lock](/categories/PHP-Laravel/laravel-postgresql-advisory-lock-guide/) - 补偿扫描单实例化
- [Laravel + PostgreSQL CDC](/categories/PHP-Laravel/laravel-postgresql-cdc-guide/) - Debezium 驱动订单变更同步
- [Laravel Telescope 开发调试](/categories/PHP-Laravel/laravel-telescope-guide/) - 请求追踪、队列监控与慢查询定位

### 认证与授权
- [Laravel Sanctum/Passport Token 刷新](/categories/PHP-Laravel/laravel-sanctum-passport-token-guide/) - 多端登录、双 Token 轮换
- [Firebase JWT vs 自建 Token](/categories/PHP-Laravel/firebase-jwt-vs-token/) - Passport/Sanctum 选型对比
- [Laravel Policies/Gates RBAC](/categories/PHP-Laravel/laravel-policies-gates-rbac/) - 权限管理与多租户隔离
- [Laravel WebAuthn/Passkey](/categories/PHP-Laravel/laravel-webauthn-passkey-guide/) - 无密码登录与设备绑定
- [OWASP Top 10 防护实战](/categories/PHP-Laravel/owasp-top-10-guide/) - SQL 注入/XSS/CSRF/SSRF 安全加固

### 队列与事件系统
- [Laravel Jobs & Queues 深度实战](/categories/PHP-Laravel/laravel-jobs-queues-deep-dive/) - 延迟队列、批量任务与失败重试
- [Laravel Queue 队列实战](/categories/PHP-Laravel/laravel-queue-guide/) - 订单扣减与邮件发送
- [Laravel Queue 队列实战踩坑](/categories/PHP-Laravel/laravel-queue-patterns/) - B2C API 真实经验
- [Laravel Redis Queue + Horizon](/categories/PHP-Laravel/laravel-redis-queue-horizon-guide/) - 队列监控与性能调优
- [Laravel Horizon 生产运维](/categories/PHP-Laravel/laravel-horizon-monitoringguide/) - 多队列优先级与自动恢复
- [Laravel 失败任务处理策略](/categories/PHP-Laravel/laravel-failed-job-handling/) - 重试、死信队列与告警
- [Laravel Events & Listeners](/categories/PHP-Laravel/laravel-events-listeners-guide/) - 事件驱动解耦订单/库存/通知
- [Laravel Event-Listener 架构](/categories/PHP-Laravel/laravel-event-listener-architecture/) - 解耦订单处理
- [Laravel EventSauce 事件溯源](/categories/PHP-Laravel/laravel-eventsauce-guide/) - 订单状态机与读模型投影
- [Laravel Scheduler 定时任务](/categories/PHP-Laravel/laravel-scheduler-guide/) - 多实例重入保护与 K8s CronJob
- [Laravel Notifications 多通道](/categories/PHP-Laravel/laravel-notifications-guide/) - 邮件/短信/Slack/企业微信

### API 开发
- [Laravel API Resource 实战](/categories/PHP-Laravel/laravel-api-resource-bff/) - BFF 架构下数据转换
- [spatie/laravel-data DTO](/categories/PHP-Laravel/laravel-data-dto-guide/) - 强类型数据传输与 API 响应规范化
- [API Rate Limiting 限流实战](/categories/PHP-Laravel/api-rate-limiting/) - 接口限流踩坑
- [Laravel BFF 中间层聚合](/categories/PHP-Laravel/bff-laravel-guide/) - GraphQL 到 JSON 转换优化
- [Laravel + gRPC 微服务通信](/categories/PHP-Laravel/laravel-grpc-microservicesguide/) - Proto 定义与连接复用
- [Scribe vs SwaggerPHP](/categories/PHP-Laravel/scribe-vs-swaggerphp/) - API 文档生成工具对比
- [Laravel Pennant 功能开关](/categories/PHP-Laravel/2026-06-01-laravel-pennant-feature-flags/) - 灰度发布策略
- [Laravel + NATS JetStream](/categories/PHP-Laravel/laravel-nats-jetstream-guide/) - 订单通知削峰与 KV 配置同步

### 性能优化
- [Laravel Octane + Swoole 高性能](/categories/PHP-Laravel/laravel-octane-swoole-high-performancephparchitecture/) - 高性能 PHP 应用架构
- [Laravel Octane 性能优化](/categories/PHP-Laravel/laravel-octane-swoole-roadrunner-performanceguide/) - FPM 到 Swoole/RoadRunner
- [PHP-FPM 长连接与短连接](/categories/PHP-Laravel/php-fpm-guide/) - 数据库连接池性能差异
- [PHP OpCache 调优实战](/categories/PHP-Laravel/php-opcache-guide/) - 高并发场景内存优化
- [OPcache 配置实战](/categories/PHP-Laravel/opcache-guide/) - 生产环境性能调优
- [PHP Fiber 协程并发](/categories/PHP-Laravel/php-fiber-concurrencyguide/) - Laravel 并发 API 聚合
- [Laravel 缓存策略全解](/categories/PHP-Laravel/laravel-cache-route-config-view-query-cache/) - Route/Config/View/Query 缓存
- [Laravel 性能预算实战](/categories/06_运维/Laravel-性能预算实战/) - Lighthouse CI + k6 响应时间预算

### 测试体系
- [Pest + PHPUnit + ParaTest 100% 覆盖率](/categories/PHP/pest-testingguide-100/) - B2C API 覆盖率实战
- [Pest PHP 3.x 实战](/categories/PHP/2026-06-01-pest-php-3x/) - 简洁优雅的测试框架
- [Pest 自定义 Expectations](/categories/PHP/2026-06-01-pest-php-custom-expectations/) - Arch Testing、Mutation Testing
- [Pest 单元测试并发测试](/categories/PHP-Laravel/pest-testingguide-concurrencytesting/) - 数据驱动与并发测试
- [Snapshot Testing 实战](/categories/PHP-Laravel/2026-06-01-snapshot-testing/) - API 响应快照回归测试
- [Laravel Dusk E2E 测试](/categories/PHP-Laravel/laravel-dusk-automatione2etestingguide/) - 浏览器自动化与 CI 集成

### 代码质量治理
- [PHP-CS-Fixer + Pint 代码风格统一](/categories/PHP-Laravel/php-cs-fixer-pint-automation/) - 团队代码规范自动化
- [Laravel Pint + Rector + PHPStan 三剑客](/categories/devops/Laravel-Pint-Rector-PHPStan/) - 代码风格/重构/类型安全一站式治理
- [PHPStan Level 8 实战](/categories/PHP-Laravel/phpstan-level-8-guide/) - 静态分析与渐进式升级
- [PHPStan-Psalm 静态分析](/categories/PHP-Laravel/phpstan-psalm-guide/) - Laravel 项目类型安全最佳实践
- [AI 辅助代码审查](/categories/PHP-Laravel/ai-guide-claude-gpt-code-review/) - Claude/GPT 提升 Code Review 效率
- [PHP 消息幂等性设计模式](/categories/PHP/php-guide-design-patterns/) - B2C API 真实踩坑记录
- [Laravel 消息幂等性设计模式](/categories/PHP-Laravel/laravel-design-patternsguide/) - Inbox/Outbox 与重试补偿

### 实时通信
- [SSE Server-Sent Events](/categories/PHP-Laravel/sse-guide-server-sent-events-laravel/) - 实时推送轻量方案
- [Laravel Reverb 实战](/categories/PHP-Laravel/laravel-reverb-guide/) - 订单状态实时推送与多实例部署
- [Laravel FCM Web Push](/categories/PHP-Laravel/laravel-firebase-cloud-messaging-web-push/) - 推送通知实战

### 部署与运维
- [Laravel Vapor / Bref Serverless](/categories/PHP-Laravel/laravel-vapor-bref-serverless-guide/) - 报表导出与冷启动治理
- [Composer 脚本实战](/categories/PHP-Laravel/composer-guide/) - 自动化构建、测试、部署
- [Composer 深度实战](/categories/PHP-Laravel/composer-deep-dive-autoloading/) - 自动加载、插件开发、私有仓库
- [Istio 服务网格 + Laravel K8s](/categories/PHP/istio-guide-laravel-k8s-mtls/) - mTLS 自动加密与灰度发布
- [Laravel 多租户 SaaS](/categories/PHP-Laravel/laravel-saas-guide/) - 共享库与独立库混合架构

### 可观测性
- [kkday/log + monitor + tracing](/categories/PHP-Laravel/kkday-log-monitor-tracing-laravel/) - 日志聚合、指标采集与分布式追踪
- [Laravel CQRS 实战](/categories/PHP-Laravel/laravel-cqrs-guide/) - 订单查询模型拆分与投影同步

### 工具与 IDE
- [Apifox vs Postman vs ApiPost vs Mockoon](/categories/PHP/apifoxpostman-apipost-mockoonvs/) - API 工具对比
- [PHPStorm Live Templates](/categories/macos/phpstorm-guide-live-templates/) - 开发效率提升

### PHP 框架对比
- [Lumen 基础](/categories/PHP/frameworks/lumen-1/) - Laravel 轻量版
- [Hyperf](/categories/PHP/frameworks/hyperf-1/) - Swoole 协程框架
- [EasySwoole](/categories/PHP/frameworks/easyswoole-1/) - Swoole 原生框架
- [ThinkPHP](/categories/PHP/frameworks/thinkphp-1/) - 国产框架
- [Yaf](/categories/PHP/frameworks/yaf-1/) - C 扩展框架
- [Yii2](/categories/PHP/frameworks/yii2-1/) - 老牌框架

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. PHP 语言基础（OOP、类型系统、自动加载）
                    │
                    ▼
2. Composer 生态 → 3. Laravel 框架核心（容器、Provider、生命周期）
                    │
                    ├──→ 4. 路由与中间件 → 5. Eloquent 与数据库
                    │
                    ├──→ 6. 认证与授权（Sanctum/Passport/Policies）
                    │
                    ├──→ 7. 队列与事件系统（Queue/Horizon/Events）
                    │
                    └──→ 8. API 开发（Resource/DTO/Rate Limiting/BFF）
                    │
                    ▼
9. 性能优化（OPcache → Octane/Swoole → Fiber 并发）
                    │
                    ▼
10. 测试体系（Pest → Dusk E2E → Snapshot Testing）
                    │
                    ▼
11. 代码质量治理（Pint → PHPStan Level 8 → AI Review）
                    │
                    ▼
12. 实时通信（SSE → Reverb → WebSocket）
                    │
                    ▼
13. 架构模式（CSR → DDD → CQRS → 六边形架构）
                    │
                    ▼
14. 部署与运维（Docker → Vapor → Cloud → Istio → 多租户）
```

## 知识关联图

```
PHP 语言基础 ──→ OOP / 类型系统 / Fibers / GC
     │
     ├──→ Composer（PSR-4 自动加载、插件、私有仓库）
     │
     └──→ 设计模式 ──→ 消息幂等性 / Inbox-Outbox

Laravel 框架核心 ──→ 服务容器 ──→ 依赖注入 / 上下文绑定 / 延迟加载
     │
     ├──→ 服务提供者 ──→ Facade / 别名
     │
     ├──→ 请求生命周期 ──→ 路由 → 中间件 → 控制器 → 响应
     │
     └──→ 架构模式 ──→ CSR / DDD / CQRS / 六边形架构

Eloquent ORM ──→ 模型 / 迁移 / 查询构建器
     │
     ├──→ Scopes（查询作用域复用）
     ├──→ Casts/Accessors（数据类型转换）
     ├──→ 全文搜索（数据库原生 vs Scout）
     │
     └──→ 多租户 ──→ PostgreSQL RLS / 连接切换

认证与授权 ──→ Sanctum（SPA/移动 API）/ Passport（OAuth2）
     │
     ├──→ JWT / Token 刷新 / 双 Token 轮换
     ├──→ Policies/Gates ──→ RBAC 权限模型
     ├──→ WebAuthn/Passkey（无密码登录）
     │
     └──→ OWASP Top 10 ──→ SQL 注入 / XSS / CSRF / SSRF

队列与事件系统 ──→ Queue（Redis/SQS/Database 驱动）
     │
     ├──→ Horizon（监控、优先级、自动恢复）
     ├──→ Jobs（延迟队列、批量任务、失败重试）
     ├──→ Events/Listeners（事件驱动解耦）
     ├──→ EventSauce（事件溯源、快照重建）
     ├──→ Scheduler（定时任务、多实例重入保护）
     │
     └──→ Notifications（邮件/短信/Slack/企业微信）

API 开发 ──→ API Resource（数据转换与格式化）
     │
     ├──→ DTO（spatie/laravel-data 强类型传输）
     ├──→ Rate Limiting（接口限流）
     ├──→ BFF（中间层聚合、GraphQL 转换）
     ├──→ gRPC（Proto 定义、Deadline 透传）
     ├──→ API 文档（Scribe vs SwaggerPHP）
     ├──→ Pennant（功能开关、灰度发布）
     │
     └──→ NATS JetStream（消息削峰、KV 配置同步）

性能优化 ──→ OPcache（字节码缓存、内存优化）
     │
     ├──→ Octane/Swoole（常驻内存、协程并发）
     ├──→ Fiber（PHP 8.1 原生协程）
     ├──→ PHP-FPM（长连接 vs 短连接）
     │
     └──→ 缓存策略（Route/Config/View/Query 缓存）

测试体系 ──→ Pest（数据驱动、自定义 Expectations）
     │
     ├──→ PHPUnit（单元测试、Mock）
     ├──→ ParaTest（并行测试加速）
     ├──→ Dusk（浏览器 E2E 自动化）
     ├──→ Snapshot Testing（API 响应回归）
     │
     └──→ Mutation Testing（变异测试）

代码质量 ──→ Pint（代码风格自动修复）
     │
     ├──→ PHPStan Level 8（静态类型分析）
     ├──→ Rector（自动化重构）
     ├──→ PHP-CS-Fixer（代码规范）
     │
     └──→ AI Code Review（Claude/GPT 辅助审查）

实时通信 ──→ SSE（Server-Sent Events，单向推送）
     │
     ├──→ Laravel Reverb（WebSocket 服务器）
     ├──→ FCM Web Push（浏览器推送通知）
     │
     └──→ Livewire/Volt（全栈组件、实时更新）

部署与运维 ──→ Docker Compose（本地开发环境）
     │
     ├──→ Laravel Vapor（AWS Serverless）
     ├──→ Laravel Cloud（官方 PaaS）
     ├──→ Istio（服务网格、mTLS、灰度）
     ├──→ NATS JetStream（消息总线）
     │
     └──→ 可观测性 ──→ 日志 / 指标 / 分布式追踪
```

## 概念速查

| 概念 | 一句话 | 关联页面 |
|------|--------|----------|
| 服务容器 | 依赖注入的核心，自动解析类依赖 | [Laravel 框架核心](Laravel框架核心.md) |
| Service Provider | 注册绑定到容器的引导类 | [Laravel 框架核心](Laravel框架核心.md) |
| Facade | 静态代理，访问容器中绑定的实例 | [Laravel 框架核心](Laravel框架核心.md) |
| Eloquent | Laravel 的 ActiveRecord ORM | [Eloquent 与数据库](Eloquent与数据库.md) |
| Migration | 数据库 Schema 版本控制 | [Eloquent 与数据库](Eloquent与数据库.md) |
| Scope | 可复用的查询约束 | [Eloquent 与数据库](Eloquent与数据库.md) |
| Sanctum | SPA 和移动 API 认证 | [认证与授权](认证与授权.md) |
| Passport | 完整 OAuth2 服务器 | [认证与授权](认证与授权.md) |
| Policy | 模型级别的授权策略 | [认证与授权](认证与授权.md) |
| Horizon | Redis 队列的仪表盘与管理 | [队列与事件系统](队列与事件系统.md) |
| EventSauce | 事件溯源库 | [队列与事件系统](队列与事件系统.md) |
| API Resource | Eloquent 模型到 JSON 的转换层 | [API 开发](API开发.md) |
| DTO | 强类型数据传输对象 | [API 开发](API开发.md) |
| BFF | 面向前端的中间层聚合 | [API 开发](API开发.md) |
| Octane | 常驻内存高性能服务器 | [性能优化](性能优化.md) |
| Swoole | PHP 协程扩展 | [性能优化](性能优化.md) |
| Fiber | PHP 8.1 原生协程 | [性能优化](性能优化.md) |
| OPcache | PHP 字节码缓存 | [性能优化](性能优化.md) |
| Pest | 优雅的 PHP 测试框架 | [测试体系](测试体系.md) |
| Dusk | 浏览器自动化测试 | [测试体系](测试体系.md) |
| Pint | Laravel 官方代码风格工具 | [代码质量治理](代码质量治理.md) |
| PHPStan | PHP 静态类型分析器 | [代码质量治理](代码质量治理.md) |
| SSE | 服务端单向推送事件 | [实时通信](实时通信.md) |
| Reverb | Laravel 官方 WebSocket 服务器 | [实时通信](实时通信.md) |
| Vapor | Laravel AWS Serverless 部署 | [部署与运维](部署与运维.md) |
| Fiber | PHP 8.1 原生协程，结构化并发 | [PHP 语言基础](PHP语言基础.md) |
| Enum | PHP 8.1 枚举类型 | [PHP 语言基础](PHP语言基础.md) |
| Readonly Class | PHP 8.2 不可变类 | [PHP 语言基础](PHP语言基础.md) |

## 跨领域关联

- → [MySQL 知识图谱](../MySQL/index.md)：Eloquent ORM、Migration、数据库连接池
- → [Redis 知识图谱](../Redis/index.md)：Laravel Cache/Session/Queue 驱动、分布式锁
- → [架构设计知识图谱](../架构设计/index.md)：DDD、CQRS、事件驱动、微服务拆分
- → [DevOps 知识图谱](../DevOps/index.md)：CI/CD 流水线、Docker 部署、可观测性
- → [前端知识图谱](../前端/index.md)：Livewire、Inertia.js、Blade 组件、API 消费
