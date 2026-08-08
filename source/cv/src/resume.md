# 马成军（Michael Ma）

**资深后端工程师 · 13 年研发经验 · 高并发交易系统 / AI 工程化**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 上海
🔗 GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ 领英: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ 技术博客: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## 个人简介

13 年后端研发经验，专注**高并发电商交易系统**与**分布式架构**。正因为救过大面积线上故障、长期维护核心交易链路，更清楚不可靠的输出流进生产会造成什么后果——近一年将重心延伸至 **AI 工程化**，先建的是收敛层与控费机制，而不是又一个生成器。

**13 年** — 后端研发 · OTA / 电商 / MarTech  
**¥100 亿** — Apple 中国经销商平台上线 5 个月 GMV  
**25s → 2s** — 大促故障救火后关键 API p99  
**200%** — KKday 联盟业务年同比增长  
**4 个** — Maestro 编排收敛的 AI 审查机器人  
**3 个** — 自研 AI 工程化平台（监控 / 审查编排 / 内容流水线）

- **AI 工程化**：自研多 AI 审查机器人收敛层（Maestro）与 AI 根因分析监控平台（VM Health Center），解决多源 AI 输出重复、不可靠、无法收敛的工程问题
- **交易系统纵深**：以第一贡献人身份主导 KKday 联盟营销平台（业务年同比增长 200%），并负责 B2C 主干线核心交易链路
- **稳定性与团队**：主导大规模故障救火（关键 API p99 25s+ → <2s，5xx 稳定 <0.01%）；现兼任售前 CVR 增转专项组组长，带领 6 人跨端小组

---

## AI 工程化实践

- **Maestro**（TypeScript CLI）——**多 AI 审查机器人收敛层**：编排 CodeRabbit / Copilot / Codex / Gemini 4 个审查机器人，问题分类 → 三层去重 → 自动修复 → 回复并解决讨论串 → 收敛监控与人工升级判断，把发散的 AI 意见收敛成可执行的修改队列
- **VM Health Center**（TypeScript / Node.js + Slack Bolt + Elasticsearch，从 0 到 1 独立开发）——团队作战看板 + 服务健康监控：聚合 Jira / GitHub / Confluence 自动生成日报周报、订购漏斗与后端服务健康告警、AI 初步根因分析
- **Claude API 生产化落地**：8 语系 SEO slug 自动生成，以 hash 变更检测控制调用成本；Git 工作流 + AI 代码审查自动化，支持 CLI / Webhook / GitHub Actions 多形态部署
- **单源多产出内容流水线**（本简历站）：一份内容源自动导出三语 × 深浅色 × HTML / PDF / PPTX / Markdown 共 20+ 份产物；针对 Marp CLI 渲染不稳定（SVG 图标随机降级为字面文本）设计导出后校验与自动重试

---

## 核心技能

| 领域 | 技能 |
|------|------|
| AI 工程 | Claude API / Copilot SDK 应用开发、多 AI Agent 编排与收敛、AI 辅助研发流程建设 |
| 语言与框架 | PHP（精通，8 年+）、TypeScript / Node.js、Go、Python（可读）；Laravel / Hyperf、Gin / go-zero、Vue |
| 数据与中间件 | MySQL、PostgreSQL、Redis、Elasticsearch、Google BigQuery、RabbitMQ、Kafka |
| 云原生与运维 | Docker、Kubernetes、AWS Lambda / GCP Cloud Run、GitHub Actions、Prometheus / Grafana / Kibana |
| 架构与业务 | 微服务与 BFF 分层、RabbitMQ 事件驱动、Redis 熔断器与双层 Kill Switch、多级缓存与 Cache Key 治理；联盟分润结算、订单交易链路、动态定价 |

---

## 工作经历

### KKday（酷游天国际旅行社） — 资深后端工程师
**2022.11 – 至今 ｜ 上海**

全球领先的旅游体验预订平台（覆盖 50+ 国家/地区）。四年间历任联盟营销平台负责人、B2C 主干线核心后端，现兼任售前 CVR 增转专项组组长。

**① 售前 CVR 增转专项组 · 组长（2026 H2 – 至今）**
- 组建并带领 **6 人跨端小组**（iOS / Android / Web / BE），以「CVR 1.2% → 1.8%（+50%）」为唯一北极星指标，直接对 PM 负责；建立站会、1on1、OKR 对齐机制，统筹售前链路（商品页 → 购物车 → 订购页）全端体验与性能优化

**② B2C 核心交易链路（2025.02 – 至今）**
- **USJ（大阪环球影城）订单改期**：跨 B2C / Order / MKT / Member 四大服务改造，主笔 7 份 SA/SD；提出「权益继承、条件重审」原则，将散乱的优惠券/积分重验规则整理为可审计决策表，四方一次对齐通过；重构金额试算器与订单状态机，保障公司 TOP 级票券供应商续约
- **大面积故障救火（主救火窗口）**：定位微服务依赖拖垮 PHP-FPM worker 池的根因，7 天内完成 P0+P1 加固（超时优化、异常兜底、Redis 轻量熔断器、双层 Feature Flag / Kill Switch）——cart/validate API p99 由 25s+ 降至 <2s，根治 iOS 下单白屏，此后 5xx 错误率连续多周 <0.01%
- **票券/Tour 商品架构升级**：主导方案分组、组合商品、OpenDate 月历下放等专案，独立完成 SA/SD → Mock → API → 单测 → 文档全流程；建立「BFF 层版本兼容 + App 渐进升级」标准解法，修复 15+ 跨端差异场景

**③ 联盟营销平台 · 平台负责人（2022.11 – 2025.03）**
- 以第一贡献人身份主导 affiliate-service（占 56% 提交）与 affiliate-api 两大核心服务，承担 Code Owner 与 PR 把关职责；串接 Google Things To Do 官方渠道及 ShopBack、亚洲万里通、Naver Shopping 等 10+ 异业渠道，推动联盟业务年同比增长 200%
- 设计**分润结算系统**：分润规则引擎、月度结算与重刷能力、BigQuery 数据归因；基于 RabbitMQ 事件驱动打通订单/商品数据流
- 性能与可观测性：多级缓存与统一 Cache Key 管理、慢 SQL 治理、联盟订单监控与 Slack 图文日报，API 延迟降低 65%（120ms → 35ms）

---

### 径硕科技（JINGdigital） — 资深后端工程师
**2021.03 – 2022.10 ｜ 上海**

B2B MarTech/SCRM 营销自动化 SaaS 厂商。负责营销自动化微服务矩阵的后端研发（Laravel/Yii2/YAF，10+ 服务）。

- 主责 **JS 埋点追踪服务**（jstracking）：全渠道行为采集与内容营销归因，营销自动化核心数据源
- 主力参与 **JINGsocial 主系统**前后端分离改造（v2）与老架构维护（合计 300+ 次提交），并横向覆盖 EDM、短信网关、问卷、获客线索、企业微信等 8+ 微服务的迭代与稳定性

---

### 商派云起软件（Shopex） — 技术专家 / Lead Developer
**2017.12 – 2021.03 ｜ 上海**

国内头部电商 SaaS 服务商。主导 Apple 中国经销商平台交付与高并发性能优化。

- 交付 **Apple 中国经销商平台**（上线 5 个月 GMV 超 ¥100 亿）：串接顺丰、宝尊 OMS 等 15+ 支付/物流系统，OMS/WMS 操作自动化率 98%，服务 3500+ 零售门店、25 万+ DAU
- 高性能优惠券系统获公司**金番茄奖**；H5 接口吞吐量提升 17.5 倍（200 → 3500 TPS），压测调优（NGINX 缓存 + TSung）达 12K TPS
- 基于 go-zero 构建短信网关服务（日发送量 100 万+）；数据导出从 OOM 失败优化至 1000 万行 / 10 分钟

---

### 远丰科技集团 — 全栈开发工程师
**2013.06 – 2017.12 ｜ 上海**

- 开发多商户 SaaS 电商平台（支撑 1 万+ 商家），支持 10 国语言（Google/有道翻译 API 混合流程，翻译成本降低 70%）
- 基于网易云信构建 IM 系统（日消息量 200 万+）；设计 Redis 缓存层，数据库负载降低 60%

---

## 开源与个人项目

- **SwaggerNotes**（PHP/Laravel 扩展包，100% 独立开发）：自动生成 Swagger 注释并产出 OpenAPI 接口文件；已发布至 Packagist，累计下载 2.6k+
- **knuckleswtf/scribe**（2.3k ⭐ Laravel API 文档生成器）：2 个 PR 已合并进主线，列名于官方贡献者；另维护技术博客 1300+ 篇，至今仍在更新

---

## 荣誉奖项

KKday 年度优秀员工（2023、2024 连续两届）· Shopex 金番茄奖（2020）· 远丰科技「技术之星」（2016、2018）
