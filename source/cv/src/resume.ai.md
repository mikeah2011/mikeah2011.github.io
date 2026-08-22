# 马成军（Michael Ma）

**AI 工程师 / 资深后端工程师 · Claude API 与 Agent 编排 · 13 年工程经验**

mikeah2011@gmail.com ｜ +86 188-0196-3698 ｜ 上海
GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ 领英: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ 技术博客: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## 个人简介

13 年高并发后端工程背景，近一年将重心延伸至 **AI 工程化**：先建的是收敛层与控费机制，而不是又一个生成器。正因为长期维护核心交易链路、救过大面积线上故障，更清楚不可靠的输出流进生产会造成什么后果——这也是我做 AI 工程时的第一原则。

**误报 ~70%↓** — Maestro 收敛 4 个 AI 审查机器人，300+ PR  
**20+ 人** — 自研 AI 平台跨 7 个团队日常使用  
**40%↓** — VM Health Center 故障定位时间缩短  
**13 年** — 后端工程经验 · 高并发系统背景  
**¥100 亿** — Apple 平台 5 个月 GMV（工程背景佐证）  
**25s → 2s** — 大促故障救火后关键 API p99

- **AI 工程化**：自研多 AI 审查机器人收敛层（Maestro）与 AI 辅助根因分析监控平台（VM Health Center），解决多源 AI 输出重复、不可靠、无法收敛的工程问题；Claude API 生产化落地覆盖近 3000 个商品页
- **工程基本功**：13 年高并发后端经验（PHP / Go / Node.js），长期维护核心交易链路、主导大规模故障救火，这让我在把 AI 输出送上生产前，比多数人更清楚「不可靠」的代价
- **交易系统纵深**：以第一贡献人身份主导 KKday 联盟营销平台（业务年同比增长 200%），并负责 B2C 核心交易链路

---

## AI 工程化实践

- **Maestro**（TypeScript CLI）——**多 AI 审查机器人收敛层**：编排 CodeRabbit / Copilot / Codex / Gemini 4 个机器人，经问题分类 → 三层去重 → 自动修复 → 回复并解决讨论串 → 收敛监控与人工升级判断，把发散的 AI 意见收敛成可执行的修改队列；**已成为团队日常流程**：10 人使用、累计走过 300+ 个 PR；据团队自评，Code Review 耗时明显缩短、误报率下降约 70%
- **VM Health Center**（TypeScript / Node.js + Slack Bolt + Elasticsearch，从 0 到 1 独立开发）——团队作战看板 + 服务健康监控：聚合 Jira / GitHub / Confluence 自动生成日报周报、订购漏斗与后端服务健康告警、AI 初步根因分析——规则匹配日志关键字筛出 1-2 条可疑链路，交由 LLM 辅助分析症结；**跨 7 个团队（Product / Web / App / QA / Order / B2C 等）20+ 人日常使用**，每日触发告警，故障定位时间缩短 40%
- **Claude API 生产化落地**：8 语系 SEO slug 自动生成，已覆盖近 3000 个商品页、累计约 5 万次调用，以 hash 变更检测跳过未变更内容持续控费；Git 工作流 + AI 代码审查自动化，支持 CLI / Webhook / GitHub Actions 多形态部署
- **单源多产出内容流水线**（本简历站）：一份内容源自动导出三语 × 深浅色 × HTML / PDF / PPTX / Markdown 共 20+ 份产物；四个投递版本以差异覆盖叠加在同一份基底上，任何事实修正只改一处即可同步全部产物，避免多版本内容漂移

---

## 核心技能

| 领域 | 技能 |
|------|------|
| AI 工程 | Claude API / Copilot SDK 应用开发、多 AI Agent 编排与收敛、Prompt 设计与成本控制、AI 辅助研发流程建设 |
| 语言与框架 | TypeScript / Node.js、PHP（8 年+）、Go（基础）、Python（可读）；Laravel / Hyperf、Vue |
| 数据与中间件 | Elasticsearch、Google BigQuery、MySQL、PostgreSQL、Redis、RabbitMQ、Kafka |
| 云原生与运维 | Docker、Kubernetes、AWS Lambda / GCP Cloud Run、GitHub Actions、Prometheus / Grafana / Kibana |
| 架构与业务 | 微服务与 BFF 分层、事件驱动架构、Redis 熔断器；联盟分润结算、订单交易链路、动态定价 |

---

## 工作经历

### KKday（酷游天国际旅行社） — 资深后端工程师
**2022.11 – 2026.08 ｜ 上海**

全球领先的旅游体验预订平台（覆盖 50+ 国家/地区）。近四年历任联盟营销平台负责人、B2C 主干线核心后端，2026 H2 兼任售前 CVR 增转专项组负责人；Maestro、VM Health Center 等 AI 工程化项目均为自驱发起。

**1) 售前 CVR 增转专项组 · 负责人（2026 H2）**
- 组建并带领 6 人跨端小组，以「CVR 1.2% → 1.8%（+50%）」为唯一北极星指标，搭建 CVR 健康监控看板，使优化成果可视化、可验证

**2) B2C 核心交易链路（2025.02 – 2026.08）**
- **USJ（大阪环球影城）订单改期**：跨 B2C / Order / MKT / Member 四大服务改造，主笔 7 份 SA/SD；提出「权益继承、条件重审」原则，将散乱的优惠券/积分重验规则整理为可审计决策表
- **大面积故障救火（主救火窗口）**：定位微服务依赖拖垮 PHP-FPM worker 池的根因，7 天内完成 P0+P1 加固——cart/validate API p99 由 25s+ 降至 <2s，此后 5xx 错误率连续多周 <0.01%
- **票券/Tour 商品架构升级**：建立「BFF 层版本兼容 + App 渐进升级」标准解法，修复 15+ 跨端差异场景

**3) 联盟营销平台 · 平台负责人（2022.11 – 2025.03）**
- 以第一贡献人身份主导 affiliate-service（提交占比过半）与 affiliate-api 两大核心服务；串接 Google Things To Do 等 10+ 异业渠道，推动联盟业务年同比增长 200%
- 设计**分润结算系统**：分润规则引擎、月度结算与重刷能力、BigQuery 数据归因

---

### 商派云起软件（Shopex） — 技术专家 / Lead Developer
**2017.12 – 2022.10 ｜ 上海**

- **Apple 中国经销商平台**（该平台上线 5 个月 GMV 超 ¥100 亿）：本人主责预售、交易、支付回调、配送发货核心链路；串接顺丰、宝尊 OMS 等 15+ 支付/物流系统，服务 3500+ 零售门店、25 万+ DAU
- 高性能优惠券系统获公司**金番茄奖**；H5 接口吞吐量提升 17.5 倍（200 → 3500 TPS）
- 主力参与前后端分离改造（v2），并横向覆盖 EDM、短信网关（基于 go-zero 构建）等 8+ 微服务的迭代与稳定性

---

### 远丰科技集团 — 全栈开发工程师
**2013.06 – 2017.12 ｜ 上海**

- 开发多商户 SaaS 电商平台，支持 10 国语言（Google/有道翻译 API 混合流程，翻译成本降低 70%）
- 基于网易云信构建 IM 系统；设计 Redis 缓存层，数据库负载降低 60%

---

## 开源与个人项目

- **SwaggerNotes**（PHP/Laravel 扩展包，100% 独立开发）：已发布至 Packagist，累计下载 2.6k+
- **knuckleswtf/scribe**（2.3k ⭐ Laravel API 文档生成器）：2 个 PR 已合并进主线，列名于官方贡献者
- **技术博客**：1300+ 篇技术文章，覆盖 PHP / 架构 / 数据库 / AI 工程，至今仍在更新

---

## 荣誉奖项

- KKday 年度优秀员工（2023、2024 连续两届）
- Shopex 金番茄奖（2020）
- 远丰科技「技术之星」（2016）
