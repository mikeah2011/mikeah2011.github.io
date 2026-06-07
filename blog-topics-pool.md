# 博客文章选题池

> 更新时间：2026-05-31
> 基于用户技术栈：Laravel, ThinkPHP, Vue 3, uni-app, Docker, macOS, Python, AI Agent, Hexo

---

## 一、AI Agent 与智能工具（2026 热门方向）

### 1.1 AI Agent 生态深度评测
- [x] 2026 年主流 AI Agent 框架深度对比：Hermes Agent vs Claude Code vs Codex vs Cline vs Goose
- [ ] AI Agent 安全性审计：凭证隔离、提示注入防护最佳实践
- [ ] 从零搭建私有化 AI Agent：模型选择、记忆管理、多渠道接入全指南
- [ ] AI Agent 的记忆架构设计：短期上下文 vs 长期记忆 vs 向量检索
- [ ] MCP（Model Context Protocol）生态全景：工具、服务器与集成实践
- [ ] AI Code Review 工具横评：CodeRabbit vs Codeium vs Cursor vs GitHub Copilot
- [ ] 本地大模型部署实战：Ollama + LM Studio + vLLM 性能对比
- [ ] AI 辅助测试生成：从 Pest/PHPUnit 到智能化测试策略
- [ ] 2026 年 AI 编程助手选购指南：免费 vs 付费方案全解析
- [ ] AI Agent 多平台消息接入：微信、飞书、Discord、Telegram 统一网关设计

### 1.2 LLM 工程化实践
- [ ] Prompt Engineering 进阶：Few-shot、CoT、ReAct 在实际项目中的应用
- [ ] RAG（检索增强生成）实战：Laravel + 向量数据库构建知识库
- [ ] LLM 应用的可观测性：Token 消耗、延迟监控、成本优化
- [ ] 结构化输出保证：JSON Schema、Function Calling、Guidance 对比
- [ ] 多模型路由策略：Fallback、负载均衡、成本优化实战

---

## 二、PHP / Laravel 深度专题

### 2.1 Laravel 高级特性
- [ ] Laravel 12 新特性全解析：从升级指南到最佳实践
- [ ] Laravel Pennant 实战：功能开关与灰度发布的完整方案
- [ ] Laravel Reverb 深度实践：WebSocket 实时应用从零到生产
- [ ] Laravel 数据导出百万级方案：队列 + 分块 + 流式响应
- [ ] Laravel 多租户 SaaS 架构：数据库隔离 vs 行级隔离 vs Schema 隔离
- [ ] Laravel + gRPC 微服务通信：Proto 定义、拦截器、负载均衡
- [ ] Laravel 事件溯源（Event Sourcing）实战：订单系统完整案例
- [ ] Laravel DDD 落地指南：从分层到六边形架构
- [ ] Laravel Pipeline 模式实战：复杂业务逻辑的优雅编排
- [ ] Laravel 数据库迁移最佳实践：零停机迁移、回滚策略、数据修复

### 2.2 PHP 8.x 新特性
- [ ] PHP 8.4 Property Hooks 深度解析：取代 Accessor/Mutator 的新范式
- [ ] PHP Fiber 并发编程实战：异步 HTTP、队列处理、并行任务
- [ ] PHP 8.x 类型系统演进：从弱类型到严格类型的迁移指南
- [ ] PHP 扩展开发入门：从 C 扩展到 PHP-FPM 性能优化
- [ ] Swoole vs RoadRunner vs FrankenPHP：PHP 高性能运行时对比

### 2.3 ThinkPHP 专题
- [ ] ThinkPHP 8 新特性与 Laravel 8 对比：选型决策指南
- [ ] ThinkPHP 多应用模式实战：后台 + API + 小程序统一架构
- [ ] ThinkPHP 中间件与事件系统高级用法
- [ ] 从 ThinkPHP 迁移到 Laravel：渐进式重构策略

---

## 三、前端与移动端

### 3.1 Vue 3 生态
- [ ] Vue 3.5 Vapor Mode 深度解析：告别虚拟 DOM 的性能革命
- [ ] Vue 3 + Pinia 状态管理最佳实践：从 Store 设计到 SSR 持久化
- [ ] vue-pure-admin 二次开发指南：权限、主题、国际化实战
- [ ] Vue 3 组件设计模式：Headless、Compound、Renderless 对比
- [ ] VueUse 实战：50 个提升开发效率的组合式函数
- [ ] Nuxt 3 全栈开发：SSR/SSG/ISR 模式选择与性能优化

### 3.2 uni-app 跨端开发
- [ ] uni-app + Vue 3 + Vite 跨端开发最佳实践（H5/小程序/App）
- [ ] uni-app 原生插件开发：调用 iOS/Android SDK 完整指南
- [ ] uni-app 性能优化：nvue 渲染、分包加载、图片懒加载
- [ ] uni-app 小程序适配踩坑记录：微信/支付宝/抖音差异处理
- [ ] uni-app 与原生混合开发：WebView Bridge 通信机制详解

### 3.3 构建工具与工程化
- [ ] Vite 6 深度指南：Module Federation、Environment API、SSR 改进
- [ ] Turbopack vs Vite vs Rspack：2026 年前端构建工具性能对比
- [ ] Monorepo 实战：pnpm workspace + Turborepo 管理多包项目
- [ ] 前端微落地：qiankun vs Module Federation vs single-spa 对比
- [ ] TypeScript 5.5+ 类型体操进阶：条件类型、模板字面量、递归类型

---

## 四、DevOps 与基础设施

### 4.1 容器与编排
- [ ] Docker BuildKit 高级用法：多阶段构建、缓存挂载、Secret 管理
- [ ] Colima vs Docker Desktop vs OrbStack：macOS 容器方案 2026 年对比
- [ ] Kubernetes 1.32 新特性与 Laravel 部署最佳实践
- [ ] Helm Chart 模板进阶：Hook、Test、Library Chart 实战
- [ ] Argo Rollouts 渐进式发布：金丝雀、蓝绿、A/B 测试完整配置

### 4.2 CI/CD 与自动化
- [ ] GitHub Actions 高级工作流：矩阵构建、缓存优化、复合 Action
- [ ] GitLab CI vs GitHub Actions vs Jenkins：2026 年 CI/CD 选型指南
- [ ] GitOps 实战：ArgoCD + Kustomize + ApplicationSet 自动化部署
- [ ] 语义化版本与自动 Changelog：conventional-commits + release-please
- [ ] 代码质量门禁：PHPStan + Rector + Pint + Pest 自动化流水线

### 4.3 可观测性
- [ ] OpenTelemetry 全链路追踪：Laravel + Jaeger/Grafana Tempo 实战
- [ ] Prometheus + Grafana 监控 Laravel：自定义指标、告警规则、Dashboard
- [ ] EFK/ELK 日志平台搭建：结构化日志、慢查询分析、异常聚合
- [ ] Sentry 错误监控深度集成：PHP + Vue + uni-app 多端统一
- [ ] SLO/SLI/SLA 实践指南：从定义到告警到复盘的完整闭环

---

## 五、数据库与缓存

### 5.1 MySQL 深度优化
- [ ] MySQL 9.0 新特性：向量类型、JSON 增强、性能改进
- [ ] MySQL 慢查询治理全流程：发现、分析、优化、验证
- [ ] MySQL 分库分表实战：ShardingSphere-Proxy + Laravel 读写分离
- [ ] MySQL 索引设计黄金法则：覆盖索引、联合索引、索引下推
- [ ] MySQL 死锁排查与预防：锁机制、事务隔离、乐观锁 vs 悲观锁

### 5.2 PostgreSQL 高级用法
- [ ] PostgreSQL 17 新特性与 Laravel 集成最佳实践
- [ ] PostgreSQL JSONB 深度使用：GIN 索引、部分更新、聚合查询
- [ ] PostgreSQL 行级安全（RLS）：多租户数据隔离的终极方案
- [ ] PostgreSQL LISTEN/NOTIFY 实时通知：替代消息队列的轻量方案
- [ ] PostgreSQL CDC 实时数据同步：Debezium + Kafka + Elasticsearch

### 5.3 Redis 进阶
- [ ] Redis 8.0 新特性：向量集、JSON 增强、性能改进
- [ ] Redis 分布式锁深度剖析：Redlock、过期续命、可重入实现
- [ ] Redis Stream 实战：替代 Kafka 的轻量级消息队列方案
- [ ] Redis 内存优化：过期策略、淘汰策略、大 Key 治理
- [ ] Redis Cluster 高可用部署：故障转移、数据迁移、客户端路由

### 5.4 搜索引擎
- [ ] Elasticsearch 8.x 新特性与 Laravel 集成最佳实践
- [ ] Elasticsearch 索引生命周期管理（ILM）：热温冷架构设计
- [ ] 全文搜索方案对比：Elasticsearch vs Meilisearch vs Typesense vs pg_trgm

---

## 六、架构设计与模式

### 6.1 架构模式
- [ ] 2026 年微服务 vs 单体 vs 模块化单体：选型决策树
- [ ] CQRS 模式在 Laravel 中的落地：读写分离、投影、事件驱动
- [ ] 领域驱动设计（DDD）在 Laravel 电商系统中的实战
- [ ] Saga 模式分布式事务：编排 vs 协调、补偿策略、Laravel 实现
- [ ] 事件驱动架构：Domain Events + Event Sourcing + Outbox Pattern
- [ ] API 网关选型：Kong vs APISIX vs Traefik vs Caddy 对比

### 6.2 设计模式实战
- [ ] PHP 设计模式实战：策略、观察者、工厂、装饰器在 Laravel 中的应用
- [ ] Repository 模式的争议：何时使用、何时避免、替代方案
- [ ] 值对象（Value Object）在 PHP 中的实践：Money、DateRange、Address
- [ ] 有限状态机实战：订单状态流转、支付状态管理
- [ ] API 版本控制策略：URL vs Header vs Query 参数对比

---

## 七、安全与合规

- [ ] OWASP Top 10 2025 版解读：PHP/Laravel 应用防护清单
- [ ] JWT vs Session vs OAuth 2.0：认证方案选型指南
- [ ] Laravel Sanctum vs Passport 深度对比：SPA、API、移动端场景
- [ ] CSRF/CORS/CSP 配置实战：前后端分离的安全最佳实践
- [ ] 依赖安全扫描：Composer Audit + Snyk + Trivy 自动化检查
- [ ] 数据脱敏方案：手机号、身份证、银行卡的存储与展示策略

---

## 八、消息队列与异步处理

- [ ] 2026 年消息队列选型：Kafka vs RabbitMQ vs Redis Stream vs NATS
- [ ] Laravel 队列深度指南：批量任务、限流、重试、失败处理
- [ ] Kafka 在 Laravel 中的实战：生产者、消费者、消费者组、偏移量管理
- [ ] 事件驱动微服务：Kafka + Schema Registry + Avro 实战
- [ ] 延迟队列实现方案：Redis ZSET、RabbitMQ、Laravel Schedule 对比

---

## 九、云服务与 Serverless

- [ ] AWS Lambda + Bref 部署 Laravel：冷启动优化、VPC 配置、成本计算
- [ ] Laravel Vapor 实战：无服务器 Laravel 的优势与局限
- [ ] 多云策略：AWS vs 阿里云 vs 腾讯云服务对比（计算、存储、数据库）
- [ ] Cloudflare Workers vs AWS Lambda@Edge：边缘计算选型
- [ ] 对象存储最佳实践：S3/OSS 兼容 API、CDN 加速、图片处理

---

## 十、macOS 开发者工具链

- [ ] 2026 年 macOS 开发者工具箱：50+ 必备工具推荐
- [ ] iTerm2 + Oh My Zsh + Starship 终端美化与效率提升
- [ ] Homebrew 进阶：自定义 Tap、Cask 开发、自动更新策略
- [ ] macOS 自动化：Shortcuts + AppleScript + Shell 脚本实战
- [ ] JetBrains IDE 效率指南：Live Templates、Remote Debug、Database Tools
- [ ] VS Code vs Cursor vs Zed：2026 年代码编辑器对比评测
- [ ] Ghostty 终端深度体验：GPU 加速、主题配置、与 iTerm2 对比

---

## 十一、测试与质量保障

- [ ] Pest PHP 深度指南：API 测试、并发测试、Arch 测试、快照测试
- [ ] PHPUnit 11 新特性与最佳实践：属性、数据提供者、Mock 进阶
- [ ] Mockery 深度指南：Mock、Stub、Spy 在 Laravel 测试中的应用
- [ ] E2E 测试方案：Laravel Dusk vs Cypress vs Playwright 对比
- [ ] 性能测试实战：k6 + Grafana 压测 Laravel API 全流程
- [ ] 代码覆盖率实践：Xdebug + Coveralls + CI 自动化
- [ ] 契约测试实战：Pact + Laravel API 消费者驱动测试

---

## 十二、API 设计与文档

- [ ] OpenAPI 3.1 深度指南：从设计到文档到 Mock 到测试
- [ ] Laravel API Resources 高级用法：嵌套关系、条件字段、性能优化
- [ ] Scribe vs Swagger PHP：Laravel API 文档生成工具对比
- [ ] Apifox 实战指南：API 设计、Mock、自动化测试、团队协作
- [ ] GraphQL vs REST vs tRPC：2026 年 API 技术选型指南
- [ ] API 限流策略：令牌桶、滑动窗口、Redis 实现、Laravel Throttle

---

## 十三、支付与电商系统

- [ ] 支付系统架构设计：支付宝/微信支付/Stripe 统一接入方案
- [ ] 电商秒杀系统设计：库存扣减、限流、队列、乐观锁
- [ ] 抽卡/盲盒概率合规：随机算法、概率公示、审计日志
- [ ] 订单状态机设计：待支付、已支付、发货、退款完整流转
- [ ] 优惠券系统设计：叠加规则、互斥规则、分摊计算

---

## 十四、性能优化专题

- [ ] PHP OPcache 深度指南：预加载、JIT、文件缓存策略
- [ ] Laravel 缓存策略全景：Route/Config/View/Query/Response Cache
- [ ] 数据库连接池：PgBouncer vs ProxySQL vs Laravel Octane
- [ ] CDN 缓存策略：Cache-Control、边缘规则、回源优化
- [ ] HTTP/2 vs HTTP/3 性能对比：Server Push、多路复用、QUIC
- [ ] 前端性能优化：Core Web Vitals、懒加载、预渲染、Service Worker

---

## 十五、团队协作与工程文化

- [ ] Code Review 最佳实践：审查清单、自动化检查、文化建设
- [ ] 技术债务管理：识别、量化、偿还策略、向管理层汇报
- [ ] 新人 Onboarding 指南：30-60-90 天计划模板
- [ ] 开源贡献指南：从 Issue 到 PR 到 Merge 的完整流程
- [ ] Confluence/Notion 技术文档最佳实践：模板、生命周期、搜索优化
- [ ] Git 工作流对比：Git Flow vs Trunk-Based vs GitHub Flow

---

## 十六、网络与协议

- [ ] HTTP/3 与 QUIC 协议深度解析：握手优化、多路复用、连接迁移
- [ ] WebSocket 实战：Laravel Reverb 协议详解与性能调优
- [ ] SSE（Server-Sent Events）vs WebSocket：实时推送方案选型
- [ ] gRPC 与 Protobuf 实战：PHP/Go 跨语言微服务通信
- [ ] TCP/IP 网络编程：三次握手、四次挥手、拥塞控制图解

---

## 十七、数据结构与算法

- [ ] 程序员必备数据结构：B+ 树、红黑树、跳表图解与应用
- [ ] 排序算法全解析：快排、归并、堆排的时间/空间/稳定性对比
- [ ] 哈希表原理与冲突解决：链地址法、开放寻址、一致性哈希
- [ ] 限流算法实现：令牌桶、漏桶、滑动窗口的 PHP/Redis 实现
- [ ] 布隆过滤器实战：缓存穿透防护、URL 去重、垃圾邮件过滤

---

## 十八、职业发展与软技能

- [ ] 技术面试准备：系统设计题常见模式与答题框架
- [ ] 程序员副业指南：开源项目、技术咨询、知识付费
- [ ] 技术写作指南：如何写出高质量的技术博客
- [ ] 远程工作工具链：沟通、协作、效率、时间管理
- [ ] 技术管理转型：从 IC 到 Tech Lead 的思维转变

---

## 使用说明

1. **选题标记**：完成的文章用 `[x]` 标记
2. **定时生成**：使用 cron job 定时从选题池中选取未完成的主题生成文章
3. **文章风格**：参考 https://www.cnblogs.com/itech/p/19849161 的深度评测风格
4. **技术栈匹配**：优先选择与当前技术栈强相关的主题
5. **时效性**：关注 2026 年新技术、新版本、新趋势

---

## 统计

- 总选题数：约 150+ 个
- 已完成：0 个
- 待完成：150+ 个
