# 马成军（Michael Ma）

**资深后端工程师 · 13 年研发经验 · 高并发交易系统 / AI 工程化**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 上海
🔗 GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ 技术博客: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## 个人简介

13 年后端研发经验，专注**高并发电商交易系统**与**分布式架构**，在 OTA（在线旅游）、电商、MarTech 领域有完整的业务纵深：

- 现任 KKday（全球旅游体验平台）资深后端工程师，**售前 CVR 增转专项组组长**，带领 6 人跨端小组以转化率提升 50%（1.2% → 1.8%）为北极星指标
- 曾以第一贡献人身份主导 KKday 联盟营销平台（两大核心仓库合计 3000+ 次提交），支撑 Google、Naver、ShopBack 等 10+ 全球渠道
- 线上稳定性专家：主导大规模故障救火，关键 API p99 从 25s+ 降至 2s 以内，5xx 错误率稳定低于 0.01%
- AI 工程化先行者：自研团队健康监控平台（AI 根因分析）、多 AI 代码审查机器人编排工具，将 AI 深度落地到研发流程
- 连续两届 KKday 年度优秀员工（2023、2024）

---

## 核心技能

| 领域 | 技能 |
|------|------|
| 编程语言 | PHP（精通，8 年+）、TypeScript / Node.js、Go、Shell、Java（协作） |
| 框架 | Laravel / Hyperf / ThinkPHP / Yii2、Gin / go-zero、Vue / ElementUI |
| 数据与中间件 | MySQL、PostgreSQL、Redis、Elasticsearch、Google BigQuery、RabbitMQ、AWS SQS、Kafka |
| 云原生与运维 | Docker、Kubernetes、AWS Lambda / GCP Cloud Run、Ansible、GitHub Actions、Prometheus / Grafana / Kibana |
| 架构能力 | 微服务、BFF、事件驱动、熔断限流与高可用设计、API 设计与文档工程 |
| AI 工程 | Claude API / Copilot SDK 应用开发、AI Agent 工作流编排、AI 辅助研发流程建设 |
| 业务专长 | 联盟营销/分润结算、订单交易链路、动态定价、SCRM/营销自动化、SaaS 平台 |

---

## 工作经历

### KKday（酷游天国际旅行社）— 资深后端工程师
**2022.11 – 至今 ｜ 上海**

全球领先的旅游体验预订平台（覆盖 50+ 国家/地区）。历任联盟营销平台负责人、B2C 主干线核心后端，现兼任售前 CVR 增转专项组组长。

**① 售前 CVR 增转专项组 — 组长（2026 H2 – 至今）**
- 组建并带领 6 人跨端小组（iOS/Android/Web/BE），以「CVR 1.2% → 1.8%（+50%）」为唯一北极星指标，直接对 PM 负责、承担小组共责
- 建立站会、1on1、OKR 对齐等轻量协作机制，统筹售前链路（商品页 → 购物车 → 订购页）全端体验与性能优化

**② B2C 核心交易链路（2025.02 – 至今，b2c-api 783 次提交）**
- **USJ（大阪环球影城）订单改期**：跨 B2C/Order/MKT/Member 四大服务改造，主笔 7 份 SA/SD；提出「权益继承、条件重审」原则，将散乱的优惠券/积分重验规则整理为可审计决策表，四方一次对齐通过；重构金额试算器与订单状态机，保障公司 TOP 级票券供应商续约
- **GYG B2B 动态变价**：主笔 3 份 SA/SD，打通商品列表/SKU/购物车/订单全链路动价；决策「新开独立 API」替代改造 5 个旧调用点，并设计低版本 App 建议更新机制，避免错误价格露出
- **订购页改版**：旅客信息扩充、排序、幽灵旅客机制及多规格×多旅客映射透传，上线后 0 P0/P1 流出
- **大面积故障救火（主救火窗口）**：定位微服务依赖拖垮 PHP-FPM worker 池的根因，7 天内完成 P0+P1 加固——超时优化、异常兜底、基于 Redis 的轻量熔断器、双层 Feature Flag/Kill Switch；cart/validate API p99 由 25s+ 降至 <2s，根治 iOS 下单白屏，保障大促平稳运行；此后 5xx 错误率连续多周 <0.01%
- **票券/Tour 商品架构升级**：主导方案分组、组合商品、OpenDate 月历下放、商品页特化等专案，独立完成 SA/SD → Mock → API → 单测 → 文档全流程；建立「BFF 层版本兼容 + App 渐进升级」标准解法，修复 15+ 跨端差异场景
- 端到端交付延伸：iOS Live Activity 出发日推播、行前关怀排程、会员缓存治理、优惠券批量校验（跨 5 个微服务）

**③ 联盟营销平台 — 平台负责人（2022.11 – 2025.03）**
- 以第一贡献人身份主导 affiliate-service（2117/3747 次提交，占 56%）与 affiliate-api（1077 次提交）两大核心服务，承担 Code Owner 与 PR 把关职责，推动联盟业务年同比增长 200%
- **Google 官方渠道串接**：Things To Do 商品 Feeds 生成/压缩/增量上传、POI Ranking 采集与排名、Google Transit 欧铁点对点路线同步（验签、时区、黑名单治理）
- 串接 ShopBack、美安（Market America）、亚洲万里通、Naver Shopping 等 10+ 异业联盟渠道，覆盖返现、里程、比价多种合作模式
- 设计**分润结算系统**：分润规则引擎、月度结算与重刷能力、BigQuery 数据归因；基于 RabbitMQ 事件驱动打通订单/商品数据流
- 性能与可观测性：多级缓存与统一 Cache Key 管理、慢 SQL 治理、联盟订单监控与 Slack 图文日报，API 延迟降低 65%（120ms → 35ms）
- 主导 Affiliate → KKPartners 平台迁移技术方案，完成新旧系统平滑过渡；为管理后台自研「数据库类型 → CRUD 组件」自动映射引擎并维护公司级共享 SDK

**④ AI 工程化与内部平台（自驱项目，2026）**
- **VM Health Center**（TypeScript/Node.js + Slack Bolt + Elasticsearch，79/86 次提交独立开发）：团队作战看板 + 服务健康监控平台——自动聚合 Jira/GitHub/Confluence 生成团队日报周报、订购漏斗与后端服务健康告警、AI 初步根因分析、Google 登录与跨团队视图
- **Maestro**（TypeScript CLI）：统一编排 CodeRabbit/Copilot/Codex/Gemini 等多个 AI PR 审查机器人的「收敛层」——问题分类、三层去重、自动修复、回复与解决讨论串、收敛监控与人工升级判断
- 其他落地：Claude API 驱动的 8 语系 SEO slug 自动生成（hash 变更检测控费）、Git 工作流 + AI 代码审查自动化系统（CLI/Webhook/GitHub Actions 多形态部署）

---

### 径硕科技（JINGdigital）— 资深后端工程师
**2021.03 – 2022.10 ｜ 上海**

B2B MarTech/SCRM 营销自动化 SaaS 厂商。负责营销自动化微服务矩阵的后端研发（Laravel/Yii2/YAF，10+ 服务）。

- 主责 **JS 埋点追踪服务**（jstracking）：全渠道行为采集与内容营销归因，营销自动化核心数据源
- 主力参与 **JINGsocial 主系统**前后端分离改造（v2）与老架构（YAF）维护，合计 300+ 次提交
- 横向覆盖 EDM 邮件营销、短信网关、问卷、获客线索、企业微信、数据迁移等 8+ 微服务的迭代与稳定性
- 参与 Ansible 运维基础设施，具备从开发到部署的全链路能力

---

### 商派云起软件（Shopex）— 技术专家 / Lead Developer
**2017.12 – 2021.03 ｜ 上海**

- 交付 **Apple 中国经销商平台**（上线 5 个月 GMV 超 ¥100 亿）：串接顺丰、宝尊 OMS 等 15+ 支付/物流系统，OMS/WMS 操作自动化率 98%，服务 3500+ 零售门店、25 万+ DAU
- 高性能优惠券系统获公司 **金番茄奖**；H5 接口吞吐量提升 17.5 倍（200 → 3500 TPS），压测调优（NGINX 缓存 + TSung）达 12K TPS
- 基于 go-zero 构建短信网关服务，日发送量 100 万+
- 数据导出优化：从 OOM 失败到 1000 万行/10 分钟

---

### 远丰科技集团 — 全栈开发工程师
**2013.06 – 2017.12 ｜ 上海**

- 开发多商户 SaaS 电商平台（支撑 1 万+ 商家），支持 10 国语言（Google/有道翻译 API 混合流程，翻译成本降低 70%）
- 基于网易云信构建 IM 系统，日消息量 200 万+
- 设计 Redis 缓存层，数据库负载降低 60%；两次获评公司「技术之星」（2016、2018）

---

## 开源与个人项目

- **SwaggerNotes**（PHP/Laravel 扩展包，100% 独立开发）：自动生成 Swagger 注释并产出 OpenAPI 接口文件的开发工具箱
- **奇乐MAX**（ThinkPHP 6 + Vue 3，独立全栈）：盲盒/抽奖类电商平台，完整交付后端系统、管理后台与 Docker 部署
- **技术博客**（Hexo）：2022 年至今持续更新 4 年，100+ 次内容迭代

---

## 荣誉奖项

- KKday 年度优秀员工（2023、2024，连续两届）
- Shopex 金番茄奖（2020）
- 远丰科技「技术之星」（2016、2018）
