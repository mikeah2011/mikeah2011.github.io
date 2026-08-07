---
marp: true
size: 16:9
paginate: true
theme: default
class: invert
style: |
  section {
    background: #0e171b;
    color: #e6eef0;
    font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    padding: 60px 72px;
  }
  h1 { color: #46bfc9; font-size: 1.6em; }
  h2 { color: #46bfc9; }
  h6 { color: #8aa0a8; letter-spacing: 0.2em; font-weight: 600; }
  strong { color: #46bfc9; }
  a { color: #46bfc9; }
  table { font-size: 0.72em; }
  section::after { color: #8aa0a8; }
  blockquote { border-left: 3px solid #46bfc9; color: #8aa0a8; }
  /* Stat tiles: markdown needs a header row, but this table is a layout grid,
     so the empty header is hidden and cells are styled as cards. */
  section.stats table {
    /* The base theme sets display:block + width:max-content, which turns the
       rows into a shrink-to-fit anonymous table. Restore a real table box so
       the tiles can span the full content width. Negative margins cancel the
       outer border-spacing so tiles align flush with the headings. */
    display: table !important;
    table-layout: fixed;
    width: calc(100% + 28px) !important;
    max-width: none;
    overflow: visible;
    margin: 0 -14px;
    border-collapse: separate;
    border-spacing: 14px;
    font-size: 0.8em;
  }
  section.stats thead { display: none; }
  section.stats td {
    background: #16232a;
    border: 1px solid #24343b;
    border-radius: 10px;
    padding: 26px 18px;
    text-align: center;
    vertical-align: middle;
  }
  section.stats td strong {
    display: block;
    font-size: 1.7em;
    line-height: 1.15;
    margin-bottom: 8px;
    font-variant-numeric: tabular-nums;
  }
---

<!-- _paginate: false -->

###### 求职简报 · 2026

# 马成军 <small>Michael Ma</small>

## 资深后端工程师

**13 年研发经验 · 高并发交易系统 · AI 工程化**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 上海
🔗 github.com/mikeah2011

---

<!-- _class: invert stats -->

###### 一页看懂

# 关键数字

| | | |
|:---:|:---:|:---:|
| **13 年** 后端研发 | **3000+** 核心仓库提交 | **10+** 全球渠道串接 |
| **25s → 2s** 关键 API p99 | **+50%** CVR 目标（组长） | **2 届** KKday 年度优秀员工 |

---

###### 职业轨迹

# 13 年，四段进阶

- **2013 – 2017 ｜ 远丰科技集团** — 全栈开发：多商户 SaaS 电商、IM 系统
- **2017 – 2021 ｜ 商派云起（Shopex）** — Lead Developer：Apple 中国经销商平台（5 个月 GMV ¥100 亿）
- **2021 – 2022 ｜ 径硕科技（JINGdigital）** — MarTech/SCRM 微服务矩阵（10+ 服务）
- **2022 – 至今 ｜ KKday** — 资深后端工程师 → 售前 CVR 增转专项组组长

---

###### KKday · 2022.11 – 2025.03

# 联盟营销平台负责人

- 两大核心服务**第一贡献人**：affiliate-service **2117 次提交（56%）** + affiliate-api **1077 次**
- **Google 官方渠道**：Things To Do Feeds、POI Ranking、Transit 欧铁路线同步
- 串接 ShopBack、美安、亚洲万里通、Naver 等 **10+ 异业渠道**
- 自研**分润结算系统**（规则引擎 + 月度结算 + BigQuery 归因）

> 联盟业务年同比增长 **200%**，API 延迟下降 **65%**（120ms → 35ms）

---

###### KKday · 2025.02 – 至今

# B2C 核心交易链路

- **USJ 订单改期**：跨 4 服务改造、主笔 7 份 SA/SD，「权益继承、条件重审」决策表四方一次对齐，保障 TOP 供应商续约
- **GYG B2B 动态变价**：全链路动价 + 低版本 App 保护机制
- **订购页改版**：多规格×多旅客映射透传，上线 **0 P0/P1**
- **票券/Tour 商品架构**：方案分组、组合商品、月历下放，15+ 跨端差异治理

---

###### 稳定性案例

# 大面积故障救火：主救火窗口

**根因**：微服务依赖拖垮 PHP-FPM worker 池 → App 宕机

**7 天完成 P0+P1 加固**：超时优化 · 异常兜底 · Redis 轻量熔断器 · 双层 Kill Switch

| 指标 | 前 | 后 |
|---|---|---|
| cart/validate p99 | 25s+ | **< 2s** |
| 5xx 错误率 | 0.05% | **< 0.01%**（连续多周） |
| iOS 下单白屏 | 高频 | **根治** |

---

###### 管理与领导力

# 售前 CVR 增转专项组 · 组长

- **6 人跨端小组**（iOS / Android / Web / BE），直接对 PM 负责、承担共责
- 北极星指标：**CVR 1.2% → 1.8%（+50%）**，等同营收结构性增长
- 机制建设：站会 · 1on1 · OKR 对齐 · 团队章程
- 统筹售前链路：商品页 → 购物车 → 订购页 全端优化

---

###### AI 工程化

# 把 AI 落进研发流程

- **VM Health Center**（TS + Slack Bolt + ES，独立开发）
  团队作战看板 + 服务健康告警 + **AI 根因分析**，自动聚合 Jira/GitHub/Confluence 日报周报
- **Maestro**（TS CLI）
  编排 CodeRabbit/Copilot/Codex/Gemini 等 **多 AI 审查机器人的收敛层**：分类 · 三层去重 · 自动修复
- **Claude API 应用**：8 语系 SEO slug 自动生成、Git 工作流 AI 审查自动化

---

###### 技能矩阵

# 核心技能

| 领域 | 技能 |
|---|---|
| 语言 | **PHP（精通 8 年+）**、TypeScript/Node.js、Go、Shell |
| 框架 | Laravel / Hyperf / ThinkPHP、Gin / go-zero、Vue |
| 数据与中间件 | MySQL、PostgreSQL、Redis、ES、BigQuery、RabbitMQ、Kafka |
| 云原生 | Docker、K8s、AWS/GCP Serverless、GitHub Actions、Grafana |
| 架构 | 微服务、BFF、事件驱动、熔断限流高可用 |
| AI 工程 | Claude API / Copilot SDK、AI Agent 工作流编排 |

---

<!-- _paginate: false -->

###### 谢谢

# 期待与你聊聊

**完整简历 · 在线阅读与下载**

- 站点：https://mikeah2011.github.io/cv
- 提供 HTML 在线版、简历 PDF、简报 PDF / PPTX 与 Markdown 源稿

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698
🔗 github.com/mikeah2011 ｜ ✍️ mikeah2011.github.io
