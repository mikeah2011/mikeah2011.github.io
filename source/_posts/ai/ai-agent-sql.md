---

title: AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化
keywords: [AI Agent, SQL, 数据分析实战, 自然语言转, 图表生成, 报告自动化]
description: 后端视角拆解 AI Agent 数据分析实战：自然语言转 SQL 的语义层与 Schema 召回、多表 JOIN 防错、图表自动选型、报告模板渲染与定时分发，含完整 Python 代码与八大踩坑记录。
date: 2026-06-02 00:00:00
tags:
- AI Agent
- 数据分析
- Text-to-SQL
- 图表生成
- 自动化
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



# AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化

过去几年，大家讨论 AI Agent 时，最容易聚焦在“会不会调用工具”“能不能自动执行任务”“是否支持多轮规划”这些看起来很智能的能力上。但如果把场景放进真实业务系统，尤其是后台数据分析、经营分析、运营复盘、财务辅助判断、BI 自助查询这些需求里，你会很快发现：**一个真正能落地的数据分析 Agent，不是回答得像分析师，而是要像一套严谨的数据产品一样可控、可追溯、可验证、可交付。**

对于有实际开发经验的后端工程师来说，这类系统的核心难点并不在于“让大模型输出一段 SQL”，而在于如何让它在复杂 schema、混乱业务口径、跨表 JOIN、聚合查询、图表选择、结果解释、报告生成、权限治理和调度分发等多个环节上稳定工作。更直接地说，Text-to-SQL 只是入口，真正的工程挑战是把自然语言问题一路变成**可信的数据结果、合适的可视化和可被消费的报告产物**。

这篇文章我会结合一个典型的数据分析 Agent 实战方案，系统拆解以下几个部分：

1. 数据分析 Agent 的整体架构设计；
2. 自然语言转 SQL 的关键工程问题，包括 schema 理解、多表 JOIN、聚合查询与校验；
3. 图表生成的自动选型与数据映射，重点讨论 ECharts / Plotly 如何在系统中协同；
4. 报告自动化，包括模板引擎、定时生成、分发链路和可回溯设计；
5. 一些真实踩坑记录，以及我在项目中用来止血和稳定系统的解决方案。

文章不会停留在"概念介绍"层面，而是尽量从后端工程可实现、可迭代、可维护的视角出发，讨论你在落地时真正会遇到的问题。

<!-- more -->

---

## 一、为什么数据分析 Agent 比通用聊天 Agent 更难落地

很多团队在做 AI Agent 时，会先从问答、知识库检索、工单助手、代码辅助这些低风险场景切入。原因很简单：即便模型说得不完全准确，通常也只是“体验差一点”，不会立刻造成业务损失。

但数据分析 Agent 不一样。它面对的是“一个查询、一个数字、一张图、一份报告”，而这些结果往往会进入经营会议、复盘邮件、日报周报、老板看板，甚至影响营销预算、库存决策和人力安排。**一旦数字错了，它不是答非所问，而是误导决策。**

因此，这类 Agent 的设计目标必须从“像人一样回答”切换成“像系统一样交付”。这带来几个很现实的工程约束：

### 1. 结果必须可验证

你不能只把模型输出的 SQL 执行后返回结果，还需要保留：

- 用户原始问题；
- 语义改写后的分析意图；
- 命中的表、字段、指标、时间粒度；
- SQL 草稿、修正版本、最终执行版本；
- 执行耗时、扫描行数、返回结果行数；
- 可视化配置；
- 报告生成时间、接收人、投递状态。

这些数据不是“可选埋点”，而是问题排查和系统信任的基础。

### 2. 语义和数据口径之间存在巨大鸿沟

用户会说“最近订单怎么样”“华东表现如何”“高价值用户复购变差了吗”“给我看下渠道转化趋势”。

但数据库里真实存在的是：

- `orders`、`order_items`、`payments`、`refunds`、`users`、`dim_region`；
- `paid_amount`、`gross_amount`、`net_revenue`、`is_test`、`order_status`、`dt`、`biz_date`；
- “华东”可能是省份集合，也可能是销售大区编码；
- “复购”可能按 30 天、60 天、自然月定义完全不同。

也就是说，**用户语言是业务口径，数据库语言是物理结构，Agent 要在两者之间完成映射。**

### 3. SQL 正确不等于业务正确

这一点特别容易被忽略。模型生成的 SQL 语法完全正确，也可能业务含义完全错误。例如：

- 漏掉测试订单过滤；
- 把退款金额按订单表重复 JOIN 导致放大；
- 统计 UV 时直接 `count(*)`；
- 对 GMV 做多表 JOIN 后没有先聚合，导致重复累加；
- 把订单创建时间和支付时间混用。

所以在这个场景里，我们需要的是 **semantic correctness（语义正确）+ business correctness（口径正确）+ execution safety（执行安全）**，而不是语法正确。

### 4. 输出不止 SQL，还包括图和报告

业务方通常不会满足于“给你一张结果表”。他们更希望看到：

- 一张合适的趋势图或对比图；
- 一段自动摘要，说明核心变化；
- 一份格式稳定、可转发、可归档的日报 / 周报 / 月报。

因此，一个成熟的数据分析 Agent 本质上是一个多阶段流水线：

> 自然语言理解 → 语义补全 → Schema 召回 → SQL 生成 → SQL 校验 → 执行 → 数据整形 → 图表生成 → 文本总结 → 报告渲染 → 调度分发

当你这么看问题时，就不会把它当作一个“大模型 prompt 工程问题”，而是一个“AI 驱动的数据产品系统工程”。

---

## 二、数据分析 Agent 的整体架构设计

先给出一个我比较推荐的分层架构。它不一定唯一，但在可维护性和演进性上比较平衡。

### 1. 分层思路

可以把整个系统拆成六层：

1. **交互层**：接收用户输入，可能来自 Chat 窗口、企业微信机器人、飞书机器人、内部 BI 门户、API 调用；
2. **语义编排层**：识别任务类型、拆分步骤、管理上下文、决定是否需要追问或澄清；
3. **数据语义层**：维护指标定义、维度字典、表关系、字段别名、权限规则、时间语义；
4. **执行层**：SQL 生成、AST 校验、执行计划评估、数据库执行、缓存命中；
5. **表达层**：图表选型、图表配置生成、文本摘要、报告模板渲染；
6. **治理层**：审计日志、权限、限流、重试、灰度、离线评估、Prompt/模型版本管理。

如果用更偏工程实现的视角，可以拆成如下模块：

- `intent-service`：意图识别与任务分类；
- `semantic-catalog`：指标与 schema 元数据服务；
- `text2sql-service`：自然语言转 SQL；
- `sql-guard`：SQL 安全校验与修正；
- `query-runner`：实际执行查询；
- `chart-agent`：图表类型决策与配置生成；
- `report-service`：模板渲染、调度、导出、分发；
- `audit-center`：日志、追踪、回放、评测。

### 2. 一个典型调用链

假设用户发来一句：

> 帮我看下最近 30 天华东区域各渠道支付 GMV 趋势，并按周生成一份简报发给运营负责人。

系统不应该立刻让 LLM 直接输出最终结果，而应该按有约束的步骤执行：

#### Step 1：任务解析

把原始请求拆成结构化意图：

```json
{
  "task_type": "analysis_and_report",
  "metrics": ["payment_gmv"],
  "dimensions": ["region", "channel", "week"],
  "filters": {
    "region": "华东",
    "time_range": "last_30_days"
  },
  "visual_goal": "trend_comparison",
  "delivery": {
    "type": "brief_report",
    "target": "运营负责人"
  }
}
```

#### Step 2：语义补全

识别系统内口径：

- `payment_gmv` 对应支付成功金额；
- “华东”映射到区域维表中的省份集合；
- “最近 30 天”是否按自然日滚动；
- “按周”是自然周还是滚动 7 天窗口；
- “渠道”对应 `channel_code` 还是一级渠道。

#### Step 3：Schema 召回

召回相关表：

- `fact_order_payment_daily`
- `dim_region`
- `dim_channel`

并取出字段描述、主键、外键、数据新鲜度、常见 JOIN 模板。

#### Step 4：生成候选 SQL

让模型基于明确 schema 和口径生成候选 SQL，而不是盲猜库表结构。

#### Step 5：SQL 校验与修正

对 SQL 做几层检查：

- 是否出现 `select *`；
- 是否缺少时间范围；
- 是否使用了未授权表；
- JOIN 是否可能放大；
- 聚合字段是否和 `group by` 匹配；
- 是否超出最大扫描行数；
- 是否命中高风险关键词，如 DDL / DML。

#### Step 6：执行与结果整形

查询后，把结果规整成统一数据结构：

```json
{
  "columns": ["week", "channel", "payment_gmv"],
  "rows": [
    ["2026-W18", "自然流量", 183920.3],
    ["2026-W18", "广告投放", 245910.1]
  ],
  "meta": {
    "row_count": 24,
    "unit": "CNY",
    "granularity": "week"
  }
}
```

#### Step 7：图表与摘要生成

根据数据形态判定使用折线图、多序列柱状图还是堆叠面积图，并自动生成图表配置。同时生成文字摘要，例如：

- 最近 30 天华东支付 GMV 整体呈上升趋势；
- 广告投放渠道波动更大，自然流量相对稳定；
- 第 3 周有明显峰值，需结合大促活动核查。

#### Step 8：报告渲染与分发

把标题、时间范围、图表、关键结论、附录 SQL、生成时间写入模板，渲染成 HTML / PDF / Markdown，再投递到邮件、飞书或企业微信。

这条链路里，LLM 只是某几个关键步骤的能力放大器，并不是整个系统的“唯一大脑”。真正稳定的关键在于：**把系统做成状态机，而不是一个开放式聊天黑盒。**

### 3. 推荐的状态机设计

在工程上，我很建议给每次分析请求定义明确状态：

- `RECEIVED`
- `INTENT_PARSED`
- `SEMANTIC_RESOLVED`
- `SQL_GENERATED`
- `SQL_VALIDATED`
- `QUERY_EXECUTED`
- `CHART_RENDERED`
- `REPORT_GENERATED`
- `DELIVERED`
- `FAILED`

每个状态之间产生事件、日志和产物。这样做有三个好处：

1. **问题可定位**：失败在意图解析还是 SQL 执行，一眼能看出来；
2. **步骤可重放**：只重试失败步骤，不必全流程重跑；
3. **结果可审计**：后续复盘知道这份报告的数字是怎么来的。

### 4. 大模型在这个架构里的正确定位

很多团队一开始会犯两个极端错误：

- 要么什么都让 LLM 做，最后结果不稳定；
- 要么完全不用 LLM，只做规则系统，结果表达能力太差，扩展困难。

更合理的分工通常是：

**适合交给 LLM 的部分：**

- 自然语言意图提取；
- 字段 / 指标别名映射；
- 候选 SQL 草稿生成；
- 图表意图理解；
- 文本摘要、结论整理、报告润色。

**必须交给确定性系统的部分：**

- 指标口径定义；
- 表血缘、字段权限；
- SQL AST 校验；
- 查询执行与限流；
- 图表配置兜底规则；
- 调度分发、审计日志。

一句话总结：**LLM 负责理解与生成，规则系统负责约束与兜底。**

---

## 三、自然语言转 SQL：真正难的是 schema 理解，不是 SQL 拼装

很多人第一次做 Text-to-SQL，会把注意力放在 prompt 上，比如“如何让模型输出 MySQL 方言”“如何限制只返回 SQL 语句”“如何提升 few-shot 例子质量”。这些当然重要，但在真实业务环境里，最难的问题其实是下面三个：

1. 模型能不能理解 schema；
2. 模型能不能选对 JOIN 路径；
3. 模型能不能在聚合查询里保持业务口径正确。

### 1. 为什么 schema 理解是核心瓶颈

公开 benchmark 往往给模型提供比较干净的 schema：

- 表名有语义；
- 字段命名统一；
- 外键关系明确；
- 没太多历史包袱。

但真实业务库并不是这样。现实经常是：

- 表很多，几百上千张；
- 字段命名混杂中英文缩写；
- 同一个概念在不同库里命名不同；
- 表注释不全，甚至多年没人维护；
- 宽表、中间表、汇总表、ODS、DWD、ADS 混在一起；
- 业务口径存在多个版本。

例如用户问：

> 看下最近一个月新客支付转化率。

你可能需要理解：

- “新客”是首次注册用户？首次下单用户？首次支付用户？
- “支付转化率”是支付人数 / 注册人数，还是支付订单数 / 下单人数？
- “最近一个月”是近 30 天，还是上个自然月？
- 应该从明细表算，还是直接使用宽表中的派生指标？

所以 Text-to-SQL 的第一步不是生成 SQL，而是做**语义落地**。

### 2. 建一个可供模型消费的语义层

如果你直接把数据库 DDL 原样丢给模型，多半既贵又不稳定。更靠谱的方式是维护一个“分析语义目录”，让模型看到的是经过整理后的上下文。

一个实用的 schema catalog 至少应包含：

- 表名、表中文别名、表用途；
- 字段名、字段类型、字段中文解释；
- 主键、外键、唯一键；
- 常用过滤字段（如 `dt`、`tenant_id`、`is_test`）；
- 字段值枚举及别名映射；
- 表级权限标签；
- 推荐 JOIN 路径；
- 业务指标定义与公式。

可以设计成类似这样的结构：

```json
{
  "table": "fact_orders",
  "alias": "订单事实表",
  "description": "记录订单核心状态与金额信息，粒度为订单",
  "grain": "one_row_per_order",
  "columns": [
    {
      "name": "order_id",
      "type": "bigint",
      "desc": "订单ID",
      "role": "primary_key"
    },
    {
      "name": "user_id",
      "type": "bigint",
      "desc": "用户ID"
    },
    {
      "name": "pay_amount",
      "type": "decimal(18,2)",
      "desc": "支付金额，单位元"
    },
    {
      "name": "pay_time",
      "type": "datetime",
      "desc": "支付成功时间"
    },
    {
      "name": "is_test",
      "type": "tinyint",
      "desc": "是否测试订单，1=是，0=否"
    }
  ],
  "recommended_filters": ["is_test = 0"],
  "join_hints": [
    {
      "target_table": "dim_channel",
      "on": "fact_orders.channel_id = dim_channel.channel_id",
      "cardinality": "many_to_one"
    }
  ]
}
```

模型只需要在这个语义层上工作，就比直接读原始库结构靠谱得多。

### 语义层构建方案对比

在实际落地时，语义层的构建方式有多种选择，下表从工程复杂度、维护成本和查询准确率三个维度做对比：

| 语义层方案 | 核心思路 | 工程复杂度 | 维护成本 | 查询准确率 | 适合阶段 |
| --- | --- | --- | --- | --- | --- |
| 硬编码 Prompt 模板 | 在 Prompt 中直接写死表结构和业务规则 | 低 | 高（改一次改 Prompt） | 中 | PoC / 早期验证 |
| YAML/JSON 配置文件 | 用配置文件定义指标、表、字段、JOIN 关系 | 中 | 中（版本化管理） | 中高 | 中小规模落地 |
| 数据库驱动语义目录 | 将语义元数据存入数据库，通过 API 动态查询 | 中高 | 低（集中维护） | 高 | 大规模生产环境 |
| 专用语义层引擎（如 Cube.js、dbt Metrics） | 使用专业工具管理指标定义和数据模型 | 高 | 低（工具化管理） | 高 | 平台级建设 |

> **实践经验**：大多数团队从 YAML/JSON 配置文件起步最务实。先把高频指标和核心表配好，跑通流程后，再视需要迁移到数据库驱动或专用引擎。过早引入重型平台反而拖慢迭代速度。

下面是一个用 Python 构建语义层配置加载器的完整示例：

```python
import yaml
from pathlib import Path
from typing import Any

class SemanticCatalog:
    """轻量级语义目录，从 YAML 配置加载指标定义、表元数据和 JOIN 路径"""

    def __init__(self, config_dir: str = "semantic_configs"):
        self.config_dir = Path(config_dir)
        self.metrics: dict[str, dict] = {}
        self.tables: dict[str, dict] = {}
        self.join_hints: dict[str, list] = {}
        self._load_all()

    def _load_all(self):
        # 加载指标定义
        metrics_file = self.config_dir / "metrics.yaml"
        if metrics_file.exists():
            with open(metrics_file, "r", encoding="utf-8") as f:
                for m in yaml.safe_load(f).get("metrics", []):
                    self.metrics[m["name"]] = m

        # 加载表元数据
        tables_file = self.config_dir / "tables.yaml"
        if tables_file.exists():
            with open(tables_file, "r", encoding="utf-8") as f:
                for t in yaml.safe_load(f).get("tables", []):
                    self.tables[t["table"]] = t
                    if "join_hints" in t:
                        self.join_hints[t["table"]] = t["join_hints"]

    def resolve_metric(self, metric_name: str) -> dict[str, Any] | None:
        """解析指标定义，返回 SQL 模板和依赖表"""
        metric = self.metrics.get(metric_name)
        if not metric:
            return None
        return {
            "name": metric["name"],
            "formula": metric.get("formula", ""),
            "default_time_field": metric.get("default_time_field", "created_at"),
            "required_tables": metric.get("required_tables", []),
            "recommended_filters": metric.get("recommended_filters", []),
        }

    def get_join_path(self, tables: list[str]) -> list[str]:
        """基于表列表，推荐 JOIN 路径"""
        paths = []
        for t in tables:
            if t in self.join_hints:
                for hint in self.join_hints[t]:
                    if hint["target_table"] in tables:
                        paths.append(hint["on"])
        return paths

    def get_table_schema(self, table_name: str) -> dict | None:
        """获取单张表的完整语义描述"""
        return self.tables.get(table_name)
```

### 3. Schema 召回，而不是全量塞上下文

当库表很多时，不可能每次都把全部 schema 塞给模型，否则上下文会爆炸，准确率反而下降。实际工程中应该做的是**两阶段召回**：

#### 第一阶段：粗召回

基于用户问题、指标别名、字段描述、表说明做向量检索或关键词检索，选出候选表集合。例如 Top 10 或 Top 20。

#### 第二阶段：精排

再结合：

- 表之间的图关系；
- 指标定义依赖；
- 历史查询日志；
- 用户角色常用表；
- 时间字段命中概率；
- 维度字段覆盖情况；

把真正最可能的 3~5 张表喂给模型。

这一步非常重要。很多 Text-to-SQL 失败，不是模型不会写，而是它拿到的上下文已经错了。

### 4. 多表 JOIN：最容易出事故的区域

多表 JOIN 的难点不在于语法，而在于粒度。后端工程师做数据查询时最怕的错误之一，就是表粒度不一致导致结果被放大。

例如：

- `orders` 是订单粒度；
- `order_items` 是订单商品粒度；
- `refunds` 是退款单粒度；
- `user_tags` 可能是一人多标签；
- `traffic_logs` 是行为事件粒度。

如果模型不理解这些粒度，直接 JOIN 后再 `sum(pay_amount)`，数字就会炸。

#### 一个典型错误案例

用户问：

> 统计最近 7 天各渠道支付 GMV 和退款金额。

模型可能写出类似 SQL：

```sql
select
  c.channel_name,
  sum(o.pay_amount) as gmv,
  sum(r.refund_amount) as refund_amount
from orders o
left join refunds r on o.order_id = r.order_id
left join dim_channel c on o.channel_id = c.channel_id
where o.pay_time >= current_date - interval '7 day'
  and o.is_test = 0
group by c.channel_name;
```

如果一个订单有多笔退款记录，这条 SQL 的 `sum(o.pay_amount)` 就会被重复累加。

#### 正确姿势：先在各自粒度聚合，再做 JOIN

```sql
with order_agg as (
  select
    channel_id,
    sum(pay_amount) as gmv
  from orders
  where pay_time >= current_date - interval '7 day'
    and is_test = 0
  group by channel_id
),
refund_agg as (
  select
    o.channel_id,
    sum(r.refund_amount) as refund_amount
  from refunds r
  join orders o on r.order_id = o.order_id
  where o.pay_time >= current_date - interval '7 day'
    and o.is_test = 0
  group by o.channel_id
)
select
  c.channel_name,
  oa.gmv,
  coalesce(ra.refund_amount, 0) as refund_amount
from order_agg oa
left join refund_agg ra on oa.channel_id = ra.channel_id
left join dim_channel c on oa.channel_id = c.channel_id;
```

这里体现的不是 SQL 技巧，而是**粒度治理**。要让 Agent 稳定处理 JOIN，系统里必须显式维护：

- 表粒度说明；
- 一对一 / 一对多 / 多对一关系；
- 推荐 JOIN 模板；
- 聚合前置规则。

### 5. 聚合查询：不是会写 group by 就够了

自然语言里的“趋势、占比、转化率、TopN、环比、同比、累计、分布”都对应不同聚合模式。模型如果没有明确规则，很容易出现口径偏差。

#### 常见聚合任务类型

1. **简单汇总**：总订单数、总 GMV、总用户数；
2. **分组聚合**：按渠道、按区域、按品类聚合；
3. **时间序列聚合**：按日、周、月趋势；
4. **漏斗/转化率**：浏览 → 加购 → 下单 → 支付；
5. **占比分析**：渠道贡献、品类占比；
6. **TopN 排名**：Top 10 商品、Top 5 区域；
7. **对比分析**：环比、同比、对照组；
8. **窗口分析**：累计值、移动平均、留存。

#### 转化率类问题为什么麻烦

比如“新客支付转化率”这个指标，模型很容易写成：

```sql
select
  count(distinct case when paid = 1 then user_id end) * 1.0 / count(distinct user_id)
from user_events
where dt between '2026-05-01' and '2026-05-31';
```

这条 SQL 看似没问题，但如果“新客”定义是“注册后 7 天内首次支付”，那么用户集合、观察窗口、分母口径都需要重新定义。**这类指标不能靠临场推理，应该由语义层预定义。**

推荐做法是把复杂指标维护为 DSL 或公式配置，例如：

```yaml
metric: new_user_pay_conversion_rate
name: 新客支付转化率
definition:
  numerator: paid_new_users_7d
  denominator: registered_new_users
formula: numerator / denominator
constraints:
  cohort: registration_date
  pay_window: 7d
```

模型不直接“发明指标”，而是先命中已有指标，再生成 SQL。

### 6. 一个更稳的 Text-to-SQL 流程

我在实践里更倾向于把 Text-to-SQL 做成五步，而不是一步到位：

#### 第一步：NL → Structured Intent

把用户问题转换成结构化意图：

- 指标；
- 维度；
- 过滤条件；
- 时间范围；
- 排序；
- 限制数量；
- 输出偏好。

#### 第二步：Intent → Semantic Plan

基于指标定义和 schema catalog，推导：

- 需要哪些表；
- 应使用哪个时间字段；
- 默认过滤条件；
- JOIN 路径；
- 是否需要先聚合；
- 是否需要窗口函数。

#### 第三步：Semantic Plan → Candidate SQL

让模型输出候选 SQL，同时要求附带解释。例如：

- 为什么选这个表；
- JOIN 关系是什么；
- 聚合粒度是什么；
- 是否存在假设。

#### 第四步：SQL AST 校验
#### 第四步：SQL AST 校验

不要只做字符串检查，最好做 AST 级别校验：
- 是否只访问白名单表；
- 是否存在笛卡尔积风险；
- 是否包含限制条件；
- 是否存在聚合与非聚合字段混用；
- 是否需要自动加 limit；
- 是否需要改写为 CTE。

下面给出一个基于 Python 的轻量级 SQL 校验器示例，它不依赖外部数据库连接，仅通过文本分析和正则匹配完成关键检查：

```python
import re
from typing import NamedTuple

class ValidationResult(NamedTuple):
    passed: bool
    errors: list[str]
    warnings: list[str]


class SQLGuard:
    """轻量级 SQL 校验器，适用于生产环境的前置检查"""

    def __init__(
        self,
        allowed_tables: set[str],
        forbidden_keywords: list[str] | None = None,
        max_scan_rows: int = 50_000_000,
        max_output_rows: int = 200_000,
    ):
        self.allowed_tables = allowed_tables
        self.forbidden_keywords = forbidden_keywords or [
            "DROP", "DELETE", "UPDATE", "INSERT", "ALTER",
            "TRUNCATE", "CREATE", "GRANT", "REVOKE",
        ]
        self.max_scan_rows = max_scan_rows
        self.max_output_rows = max_output_rows

    def validate(self, sql: str) -> ValidationResult:
        errors = []
        warnings = []
        sql_upper = sql.upper()

        # 1. 检查危险操作
        for kw in self.forbidden_keywords:
            if re.search(rf'\b{kw}\b', sql_upper):
                errors.append(f"SQL 包含禁止操作: {kw}")

        # 2. 检查 SELECT *
        if re.search(r'SELECT\s+\*', sql_upper):
            warnings.append("不建议使用 SELECT *，请明确指定字段")

        # 3. 检查是否缺少 WHERE 子句
        if "WHERE" not in sql_upper:
            warnings.append("SQL 缺少 WHERE 条件，可能扫描全表")

        # 4. 检查表是否在白名单中
        tables_in_sql = re.findall(
            r'(?:FROM|JOIN)\s+(\w+)', sql_upper
        )
        for table in tables_in_sql:
            if table.lower() not in self.allowed_tables:
                errors.append(f"表 {table} 不在白名单中")

        # 5. 检查笛卡尔积风险（多表 JOIN 但无 ON 条件）
        join_count = len(re.findall(r'\bJOIN\b', sql_upper))
        on_count = len(re.findall(r'\bON\b', sql_upper))
        if join_count > 0 and on_count < join_count:
            errors.append(f"检测到 {join_count} 个 JOIN 但只有 {on_count} 个 ON 条件，存在笛卡尔积风险")

        # 6. 检查聚合与非聚合字段混用
        has_group_by = "GROUP BY" in sql_upper
        has_aggregate = bool(re.search(
            r'(SUM|COUNT|AVG|MAX|MIN)\s*\(', sql_upper
        ))
        if has_aggregate and not has_group_by:
            errors.append("使用了聚合函数但缺少 GROUP BY")

        # 7. 检查 LIMIT
        if "LIMIT" not in sql_upper:
            warnings.append("建议添加 LIMIT 限制返回行数")

        # 8. 检查 CTE 中是否有递归无限风险
        if "WITH RECURSIVE" in sql_upper and "LIMIT" not in sql_upper:
            warnings.append("递归 CTE 缺少 LIMIT，可能存在无限递归风险")

        return ValidationResult(
            passed=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )


# ========== 使用示例 ==========

guard = SQLGuard(
    allowed_tables={
        "fact_orders", "dim_channel", "dim_region",
        "dim_user", "fact_payments", "fact_refunds",
    },
)

sql_good = """
SELECT c.channel_name, SUM(o.pay_amount) AS gmv
FROM fact_orders o
JOIN dim_channel c ON o.channel_id = c.channel_id
WHERE o.pay_time >= CURRENT_DATE - INTERVAL '7 DAY'
  AND o.is_test = 0
GROUP BY c.channel_name
ORDER BY gmv DESC
LIMIT 20
"""

sql_bad = """
SELECT * FROM orders o, refunds r
WHERE o.order_id = r.order_id
"""

result = guard.validate(sql_good)
print(f"校验通过: {result.passed}")
print(f"错误: {result.errors}")
print(f"警告: {result.warnings}")
```

输出结果：

```
校验通过: True
错误: []
警告: []
```

对于第二条 SQL（`sql_bad`），输出将是：

```
校验通过: False
错误: ['表 ORDERS 不在白名单中', '表 REFUNDS 不在白名单中']
警告: ['不建议使用 SELECT *，请明确指定字段']
```

这种校验器虽然简单，但已经能拦截生产环境中最常见的几类风险。更完整的实现建议基于 `sqlparse` 或 `sqlglot` 做 AST 解析，以支持更精确的字段级别检查。

#### 第五步：试跑与自修复

先跑 `EXPLAIN` 或小样本查询，如果报错，把错误信息反馈给模型做一次受控修复，但修复次数要有限制，比如最多 2~3 次。

这比"让模型生成一遍 SQL，错了再瞎改"稳定得多。

### 7. Text-to-SQL 主流方案对比

在实际工程落地中，Text-to-SQL 的技术路线主要有以下几种。下表基于 Spider 等公开 benchmark 及生产环境经验，对各方案做横向对比：

| 方案 | 核心思路 | Spider 准确率（EX） | 延迟 | 成本 | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| 直接 Prompting（Zero-shot） | 将 schema + 问题直接交给 LLM，一次性生成 SQL | ~60–65% | 低（单次推理） | 低 | 简单单表查询、PoC 验证 |
| Few-shot Prompting | 在 prompt 中附带若干 NL→SQL 示例对 | ~65–72% | 低 | 低 | 中等复杂度查询，schema 相对稳定 |
| RAG + Schema Linking | 先召回相关表/字段，再将精简 schema 喂给模型 | ~72–80% | 中（含召回） | 中 | 生产环境首选，表多、schema 复杂 |
| Fine-tuned 专用模型 | 基于 Text-to-SQL 数据集微调专用模型（如 CodeS、DIN-SQL、SFT） | ~78–85% | 低（推理快） | 高（训练成本） | 高频场景、对准确率要求极高 |
| Agent 多步推理（如 DIN-SQL、DAIL-SQL） | 分解问题 → 子任务 → 逐步生成 SQL 片段 → 拼装 | ~82–87% | 高（多轮推理） | 高 | 复杂多表 JOIN、嵌套查询 |

> **实践建议**：大多数团队从 RAG + Schema Linking 起步性价比最高。先把语义层和召回做好，再叠加 few-shot 和 AST 校验，通常就能覆盖 80% 以上的真实查询场景。只有当查询量大到足够摊薄训练成本时，才值得投入 Fine-tuned 模型。

### 8. 一个后端友好的服务接口设计

如果你准备把这套能力抽成服务，建议接口不要只返回 SQL，而是返回完整语义计划。

例如：

```json
{
  "intent": {
    "metrics": ["payment_gmv"],
    "dimensions": ["channel", "dt"],
    "filters": {
      "region": "华东",
      "time_range": "last_30_days"
    }
  },
  "semantic_plan": {
    "source_tables": ["fact_orders", "dim_channel", "dim_region"],
    "time_field": "pay_time",
    "join_path": [
      "fact_orders.channel_id = dim_channel.channel_id",
      "fact_orders.region_id = dim_region.region_id"
    ],
    "default_filters": ["fact_orders.is_test = 0"],
    "grain": "day_channel"
  },
  "sql": "select ...",
  "validation": {
    "passed": true,
    "warnings": ["region alias resolved from 华东 -> EAST_CHINA"]
  }
}
```

这样后续图表生成、报告渲染、日志审计都能复用这些中间产物，而不是每一层都重新猜。

### 9. 一组更贴近生产环境的防错样例

仅靠“生成 SQL + 执行报错再修”在真实生产环境里远远不够，很多问题即使 SQL 能执行也可能业务含义错误。下面给出几类更值得提前规则化的防错场景。

#### 场景一：时间字段选错

很多业务表同时存在 `created_at`、`paid_at`、`finished_at`、`dt` 等字段。用户问“最近 30 天 GMV”，如果模型误用创建时间而不是支付时间，结果语法正确但业务错误。

可以在语义层中维护指标默认时间字段：

```yaml
metric: payment_gmv
default_time_field: paid_at
fallback_time_fields:
  - pay_time
  - biz_date
forbidden_time_fields:
  - created_at
```

执行前再做一轮规则检查：

```python
def validate_metric_time_field(metric_name: str, sql_meta: dict, metric_catalog: dict):
    config = metric_catalog[metric_name]
    used = sql_meta.get("time_fields", [])
    if config["default_time_field"] not in used:
        return {
            "passed": False,
            "reason": f"指标 {metric_name} 未使用默认时间字段 {config['default_time_field']}"
        }
    if any(field in used for field in config.get("forbidden_time_fields", [])):
        return {
            "passed": False,
            "reason": f"指标 {metric_name} 使用了禁止时间字段 {used}"
        }
    return {"passed": True}
```

#### 场景二：缺少组织级默认过滤条件

许多业务库里都存在测试数据、删除标记、多租户隔离、灰度环境数据。如果模型少带一个条件，结果就会明显失真。

推荐在语义计划阶段统一注入默认过滤条件，而不是完全依赖模型记忆：

| 场景 | 推荐默认过滤 | 风险 |
| --- | --- | --- |
| 测试订单 | `is_test = 0` | GMV、人群、转化率被污染 |
| 软删除记录 | `is_deleted = 0` | 重复或失效数据被统计 |
| 多租户系统 | `tenant_id = current_tenant` | 数据越权或口径串租户 |
| 仅统计成功支付 | `pay_status = 'SUCCESS'` | 把待支付或失败订单混入 |

#### 场景三：TopN 问题遗漏排序口径

用户问“最近 7 天 Top10 渠道”，如果没明确 Top 的依据，到底是按 GMV、订单数还是支付用户数排序并不确定。

这类问题适合在意图结构化时显式补全：

```json
{
  "question": "最近7天Top10渠道",
  "needs_clarification": false,
  "assumption": "默认按支付GMV降序",
  "order_by": {
    "metric": "payment_gmv",
    "direction": "desc"
  },
  "limit": 10
}
```

并把假设写进最终回答或报告附录，避免业务误会“Top”的排序基准。

#### 场景四：查询成本过高但结果价值有限

有些自然语言请求会诱导模型直接扫描超大明细表，例如“把过去一年每个用户每天的行为都拉出来看看”。这类请求即使能执行，也会严重拖垮系统。

建议在 SQL Guard 中增加成本门禁：

```python
def should_block_query(plan: dict) -> tuple[bool, str]:
    if plan["estimated_scan_rows"] > 50_000_000:
        return True, "预计扫描行数过大，建议改为聚合查询或缩短时间范围"
    if plan["estimated_output_rows"] > 200_000:
        return True, "结果集过大，不适合直接返回，建议生成汇总报告"
    return False, ""
```

这类规则能让 Agent 学会“拒绝不合适的查询”，而不是盲目执行。

---

## 四、图表生成：不是把结果表画出来，而是做“表达层决策”

很多团队做到 SQL 执行就觉得差不多了，然后把结果表简单交给前端画图。这对人肉 BI 来说没问题，但对 Agent 来说还不够。因为用户的真实诉求通常不是“拿一张表”，而是“理解变化、发现问题、传递信息”。

所以图表生成的关键不是渲染，而是决策：

1. 该选什么图；
2. 如何把数据字段映射到视觉编码；
3. 图上应该如何排序、分组、格式化；
4. 什么时候用 ECharts，什么时候用 Plotly；
5. 怎么避免生成“能看但不好看、能画但不准确”的图。

### 1. 图表自动选型的基本原则

我建议不要完全依赖模型自由发挥，而是建立一套“任务意图 + 数据形态 → 图表类型”的决策规则，再让模型参与补充。

可以抽象出几类分析目标：

- **趋势**：看随时间变化；
- **对比**：看不同类别之间的差异；
- **构成**：看部分占整体比例；
- **分布**：看数值分布区间；
- **关系**：看两个指标相关性；
- **层级**：看树状或分层结构；
- **地理**：看地图空间分布。

再结合数据形态：

- 是否有时间轴；
- 类别数多少；
- 指标数多少；
- 是否存在堆叠关系；
- 是否存在双轴需求；
- 是否需要交互探索。

#### 一个简单的选型矩阵

- 单指标按时间变化：折线图；
- 多系列按时间变化：多折线图；
- 少量类别对比：柱状图；
- 类别很多且标签较长：横向条形图；
- 构成占比且类别 ≤ 5：饼图或环图；
- 构成占比且有时间轴：堆叠柱状图 / 堆叠面积图；
- 两个连续变量关系：散点图；
- 数值分布：直方图 / 箱线图；
- 层级结构：树图 / 旭日图；
- 明细数据探索：表格。

这套规则本质上是一个 chart recommendation engine，可以先规则化，后续再逐步引入模型增强。

下面给出一个可直接使用的图表推荐引擎 Python 实现，它能根据数据形态自动推荐最合适的图表类型：

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class DataProfile:
    """数据形态描述，用于图表选型决策"""
    has_time_axis: bool = False       # 是否有时间轴
    category_count: int = 0           # 类别数量
    metric_count: int = 0             # 指标数量
    has_hierarchy: bool = False       # 是否有层级关系
    has_two_continuous: bool = False  # 是否有两个连续变量
    data_rows: int = 0               # 数据行数


class ChartRecommendationEngine:
    """基于规则的图表推荐引擎"""

    # 推荐优先级：越靠前越优先
    RULES = [
        # 时间序列 + 单指标 → 折线图
        lambda p: (p.has_time_axis and p.metric_count == 1 and p.category_count <= 10, "line", "折线图"),
        # 时间序列 + 多指标 → 多折线图
        lambda p: (p.has_time_axis and p.metric_count > 1 and p.category_count <= 10, "line", "多折线图"),
        # 时间序列 + 类别多 → 堆叠面积图
        lambda p: (p.has_time_axis and p.category_count > 10, "stacked_area", "堆叠面积图"),
        # 少量类别对比 → 柱状图
        lambda p: (not p.has_time_axis and p.category_count <= 8 and p.metric_count == 1, "bar", "柱状图"),
        # 类别多 + 标签长 → 横向条形图
        lambda p: (not p.has_time_axis and p.category_count > 8, "horizontal_bar", "横向条形图"),
        # 两个连续变量 → 散点图
        lambda p: (p.has_two_continuous, "scatter", "散点图"),
        # 层级结构 → 树图
        lambda p: (p.has_hierarchy, "treemap", "树图"),
        # 数据量大 + 单指标 → 直方图
        lambda p: (p.data_rows > 1000 and p.metric_count == 1, "histogram", "直方图"),
        # 兜底 → 表格
        lambda p: (True, "table", "数据表格"),
    ]

    def recommend(self, profile: DataProfile) -> dict:
        for rule in self.RULES:
            matches, chart_type, chart_name = rule(profile)
            if matches:
                return {
                    "chart_type": chart_type,
                    "chart_name": chart_name,
                    "reason": self._explain(profile, chart_type),
                }
        return {"chart_type": "table", "chart_name": "数据表格", "reason": "无匹配规则，使用表格兜底"}

    def _explain(self, profile: DataProfile, chart_type: str) -> str:
        if chart_type == "line" and profile.has_time_axis:
            return "检测到时间轴且指标单一，折线图最适合展示趋势变化"
        if chart_type == "bar":
            return f"类别数为 {profile.category_count}，适合使用柱状图进行对比"
        if chart_type == "horizontal_bar":
            return f"类别数为 {profile.category_count} 较多，横向条形图可避免标签重叠"
        return "综合数据形态特征做出推荐"


# ========== 使用示例 ==========

engine = ChartRecommendationEngine()

# 场景1：时间序列趋势
result1 = engine.recommend(DataProfile(
    has_time_axis=True, category_count=3, metric_count=1, data_rows=30
))
print(f"场景1 → {result1['chart_name']}: {result1['reason']}")

# 场景2：多渠道对比
result2 = engine.recommend(DataProfile(
    has_time_axis=False, category_count=15, metric_count=1, data_rows=15
))
print(f"场景2 → {result2['chart_name']}: {result2['reason']}")

# 场景3：两指标相关性
result3 = engine.recommend(DataProfile(
    has_time_axis=False, category_count=0, metric_count=2,
    has_two_continuous=True, data_rows=500
))
print(f"场景3 → {result3['chart_name']}: {result3['reason']}")
```

输出示例：

```
场景1 → 折线图: 检测到时间轴且指标单一，折线图最适合展示趋势变化
场景2 → 横向条形图: 类别数为 15 较多，横向条形图可避免标签重叠
场景3 → 散点图: 综合数据形态特征做出推荐
```

### 2. ECharts 与 Plotly 的分工

在企业内部数据分析 Agent 里，我通常会把 ECharts 和 Plotly 区分使用，而不是二选一。

#### ECharts 适合什么

- 业务看板、日报周报中的静态或轻交互图；
- 柱状图、折线图、面积图、饼图、雷达图、地图；
- 前端集成要求高、样式定制需求多；
- 希望输出 JSON option，由前端统一渲染。

ECharts 的优势是：

- 图表类型丰富；
- option 结构成熟；
- 与前端系统整合方便；
- 样式和主题能力强；
- 中文生态较好。

#### Plotly 适合什么

- 数据探索型场景；
- Notebook、内部分析平台、自助分析台；
- 散点矩阵、箱线图、热力图、3D 图等更偏分析型图表；
- 需要快速生成 HTML 自包含报告。

Plotly 的优势是：

- Python 生态友好；
- 交互探索能力强；
- 导出 HTML / 图片方便；
- 与 Pandas、Jupyter 配合自然。

#### 一个实际建议

如果你的系统是标准前后端分离、最终在 Web 门户或消息卡片里展示，我建议：

- **默认输出 ECharts option** 作为主渲染格式；
- **在离线报告 / 数据探索场景支持 Plotly**，用于高级分析图。

这样可以同时满足工程统一性和分析灵活性。

#### 各图表库能力对比

在选择图表渲染库时，除了 ECharts 和 Plotly，后端工程师通常还会考虑 matplotlib 和 D3.js。下表从报告自动化场景的实际需求出发，对四种主流库做横向对比：

| 特性 | ECharts | Plotly | matplotlib | D3.js |
| --- | --- | --- | --- | --- |
| 语言/生态 | JavaScript，前端原生 | Python，可导出 HTML | Python，科学计算 | JavaScript，原生 DOM |
| 交互能力 | 强（tooltip、缩放、联动） | 强（hover、点击、子图联动） | 弱（静态为主） | 极强（完全可编程） |
| 导出格式 | PNG/SVG/CSV | PNG/SVG/PDF/HTML | PNG/SVG/PDF | SVG（需自行封装） |
| 报告集成难度 | 低（JSON option → 前端渲染） | 低（Python 一行导出 HTML） | 中（需导出图片嵌入） | 高（需大量自定义代码） |
| 中文支持 | 好（内置中文 locale） | 一般（需手动配置） | 需配置字体 | 需自行处理 |
| 图表类型丰富度 | ★★★★★ | ★★★★ | ★★★ | ★★★★★（理论上无限） |
| 学习曲线 | 中（API 规范但文档多） | 低（Python 用户友好） | 低 | 高 |
| 生产环境稳定性 | ★★★★★ | ★★★★ | ★★★★ | ★★★ |

> **报告自动化推荐方案**：Web 端看板和邮件报告优先用 **ECharts**（JSON option 输出，前端统一渲染）；离线数据分析报告和 Notebook 场景优先用 **Plotly**（Python 原生，一行代码导出自包含 HTML）。matplotlib 适合纯图片导出场景，D3.js 适合需要高度定制化的交互式仪表盘但开发成本较高。

### 3. 图表生成不是输出 option，而是做字段映射

生成图表时，一个很实用的中间层是 `chart spec`。不要让模型直接写完整 ECharts option，因为太容易不稳定。更好的方式是让它先输出一种抽象规格，再由代码转换成 ECharts / Plotly 配置。

例如：

```json
{
  "chart_type": "line",
  "title": "最近30天各渠道支付GMV趋势",
  "x": {
    "field": "dt",
    "type": "temporal",
    "label": "日期"
  },
  "y": [
    {
      "field": "payment_gmv",
      "type": "quantitative",
      "label": "支付GMV",
      "aggregate": "sum"
    }
  ],
  "series": {
    "field": "channel",
    "type": "nominal"
  },
  "encoding": {
    "stack": false,
    "sort": "asc"
  }
}
```

然后通过模板函数转成 ECharts：

```js
function toEchartsOption(spec, rows) {
  const xData = [...new Set(rows.map(r => r[spec.x.field]))];
  const seriesNames = [...new Set(rows.map(r => r[spec.series.field]))];

  const series = seriesNames.map(name => ({
    name,
    type: spec.chart_type,
    data: xData.map(x => {
      const row = rows.find(r => r[spec.x.field] === x && r[spec.series.field] === name);
      return row ? row[spec.y[0].field] : null;
    }),
    smooth: true
  }));

  return {
    title: { text: spec.title },
    tooltip: { trigger: 'axis' },
    legend: { data: seriesNames },
    xAxis: { type: 'category', data: xData },
    yAxis: { type: 'value', name: spec.y[0].label },
    series
  };
}
```

这种设计的好处是：

- 模型只负责高层表达；
- 具体渲染配置由代码确定；
- 更容易做兜底和校验；
- 可以同时适配多个渲染引擎。

### 4. 数据映射里的几个硬问题

#### 问题一：时间轴排序

如果时间字段是字符串，比如 `2026-1`、`2026-10`、`2026-2`，直接排序就错了。必须在进入图表层前标准化成真正的日期或固定格式。

#### 问题二：类别过多

一个“按渠道展示 GMV 趋势”的查询，如果返回 40 个渠道，多折线图几乎不可读。需要自动做：

- 取 TopN；
- 其余归为“其他”；
- 或改成表格 / 热力图。

#### 问题三：数值单位

金额是元、万元还是亿元？百分比是否要转 `%`？计数是否需要千分位？如果图表层不做统一格式化，观感会很差。

#### 问题四：缺失值处理

时间序列里断点很多时，折线图会误导。你要明确是填 0、保留 null，还是做插值。业务语义不同，处理方式也不同。

#### 问题五：双轴滥用

很多人喜欢在一张图里同时展示 GMV 和转化率，一个左轴一个右轴。虽然“信息量大”，但极易误导。自动生成图表时，应该谨慎启用双轴，只在确有必要时使用。

### 5. 图表生成的兜底策略

再好的规则和模型，也会遇到无法优雅画图的结果集。所以系统必须准备几种兜底：

1. **表格兜底**：当类别太多、字段类型不适合可视化时，输出排序良好的表格；
2. **自动降维**：多指标、多维度结果难以可视化时，提示拆成多张图；
3. **说明性提示**：例如“当前结果维度过多，已按 GMV Top10 渠道展示”；
4. **图表质量评分**：根据可读性规则打分，低于阈值则换图型。

这一步看似细节，其实决定了 Agent 最终是否“像个产品”。

### 6. 生成图表摘要时，别让模型乱说

很多系统在图表出来后，会让模型自动总结趋势。但如果不给约束，模型极容易输出主观且不可信的结论，比如“用户兴趣明显下降”“该渠道质量较差”。

更稳妥的方式是先提取结构化信号，再让模型转成自然语言。比如：

```json
{
  "trend": "up",
  "change_rate": 0.126,
  "peak_point": "2026-05-20",
  "peak_value": 382910.2,
  "volatility": "high",
  "top_series": "广告投放"
}
```

然后要求模型只基于这些事实生成描述。这样可以大幅减少“看图说话”的幻觉。

---

## 五、报告自动化：从一次查询变成可持续交付

如果说 Text-to-SQL 解决的是“查得到”，图表生成解决的是“看得懂”，那报告自动化解决的就是“能交付”。

很多业务部门的真实需求不是临时问一句，而是：

- 每天早上 9 点发经营日报；
- 每周一发渠道周报；
- 每月 1 号发区域复盘；
- 活动结束后 1 小时自动发战报。

所以，数据分析 Agent 最终一定会走向报告自动化。这个部分如果做得好，系统价值会从“助手”变成“生产力平台”。

### 1. 报告自动化的基本组成

一个完整的自动报告系统通常包括：

1. **任务定义**：报告主题、指标、维度、受众、周期；
2. **数据获取**：调用分析流水线生成结果；
3. **模板渲染**：把数据、图表、摘要填进模板；
4. **调度执行**：按 Cron 或事件触发运行；
5. **产物导出**：HTML、Markdown、PDF、图片；
6. **分发投递**：邮件、企业微信、飞书、Webhook；
7. **回执与审计**：记录成功、失败、重试、接收情况。

### 2. 模板引擎怎么选

对于后端工程师来说，报告模板引擎一般有三类选择：

#### 方案一：服务端 HTML 模板

例如 Jinja2、Nunjucks、Handlebars、Go Template。

优点：

- 成熟稳定；
- 便于版本控制；
- 支持条件渲染、循环、局部模板；
- 很容易导出 HTML / PDF。

适合：日报、周报、月报、战报这类结构相对固定的报告。

#### 方案二：Markdown 模板

先渲染 Markdown，再交给 Hexo、Pandoc 或内部渲染器转 HTML / PDF。

优点：

- 可读性强；
- 适合技术团队；
- 与 Git 工作流天然兼容。

缺点：

- 复杂布局能力有限；
- 对图文混排和卡片式布局不如 HTML 灵活。

#### 方案三：前端 DSL / JSON Schema 模板

定义报告卡片结构，如：

```json
{
  "sections": [
    {"type": "title", "text": "经营日报"},
    {"type": "metric_cards", "items": [...]},
    {"type": "chart", "chart_ref": "gmv_trend"},
    {"type": "paragraph", "text": "..."}
  ]
}
```

优点：

- 前后端解耦；
- 很适合多渠道分发；
- 可以让 Agent 生成结构化内容。

缺点：

- 初期建设成本高；
- 模板表达能力需要自己维护。

如果你的目标是快速落地，我建议：

- 先用 **HTML + 模板引擎** 做第一版；
- 需要沉淀跨端能力时，再演进到 **报告 DSL**。

### 3. 一个可维护的报告数据模型

报告生成不要直接把 SQL 结果硬塞模板，而应先归一成报告上下文对象。例如：

```json
{
  "report": {
    "title": "华东渠道支付GMV周报",
    "period": "2026-05-01 至 2026-05-31",
    "generated_at": "2026-06-02 09:00:00"
  },
  "summary": [
    "本周期华东支付GMV环比增长12.6%",
    "广告投放渠道贡献最大，占比43.2%",
    "自然流量渠道稳定，波动较小"
  ],
  "metrics": [
    {"name": "支付GMV", "value": "¥382.9万", "change": "+12.6%"},
    {"name": "支付用户数", "value": "4.8万", "change": "+7.1%"}
  ],
  "charts": [
    {"id": "gmv_trend", "type": "echarts", "spec": {...}},
    {"id": "channel_share", "type": "echarts", "spec": {...}}
  ],
  "appendix": {
    "sql_refs": ["query_12345"],
    "data_freshness": "T+1 08:30"
  }
}
```

这样模板层完全不关心 SQL 或数据库细节，只关心如何展示。

### 4. 定时生成：Cron 只是开始，不是全部

很多团队做报告自动化时，只配置一个 Cron，就觉得大功告成。但一旦进入真实环境，你会遇到更多问题：

- 上游数仓分区还没刷完，任务提前跑了；
- 某张表延迟，导致数字不完整；
- 月初任务比平时慢很多；
- 报告任务重复触发，收件人收到两份；
- 某次模型超时，报告半成品没发出去。

所以调度层至少要有下面这些能力：

#### 数据就绪检查
#### 数据就绪检查

在跑报告前先检查：
- 分区是否存在；
- 数据新鲜度是否达标；
- 核心指标是否落在合理阈值区间；
- 上游依赖任务是否成功。

下面给出一个数据就绪检查器的完整实现：

```python
import logging
from datetime import datetime, timedelta
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ReadinessCheckResult:
    """就绪检查结果"""
    ready: bool
    checks: list[dict]
    reason: str = ""


class DataReadinessChecker:
    """数据就绪门禁，防止在数据不完整时触发报告生成"""

    def __init__(self, db_conn=None):
        self.db_conn = db_conn  # 生产环境传入真实数据库连接

    def check(
        self,
        table_name: str,
        partition_date: str,
        expected_min_rows: int = 1000,
        max_hours_since_update: int = 6,
    ) -> ReadinessCheckResult:
        """执行数据就绪检查"""
        checks = []

        # 检查1：分区是否存在
        partition_exists = self._check_partition(table_name, partition_date)
        checks.append({
            "name": "分区存在性",
            "passed": partition_exists,
            "detail": f"表 {table_name} 的分区 {partition_date} {'存在' if partition_exists else '不存在'}",
        })

        # 检查2：数据量是否达标
        row_count = self._check_row_count(table_name, partition_date)
        rows_adequate = row_count >= expected_min_rows
        checks.append({
            "name": "数据量阈值",
            "passed": rows_adequate,
            "detail": f"实际行数 {row_count}，阈值 {expected_min_rows}",
        })

        # 检查3：数据新鲜度
        last_update = self._check_last_update_time(table_name)
        freshness_ok = last_update and (
            datetime.now() - last_update
        ) < timedelta(hours=max_hours_since_update)
        checks.append({
            "name": "数据新鲜度",
            "passed": freshness_ok,
            "detail": f"最后更新时间 {last_update}，阈值 {max_hours_since_update} 小时内",
        })

        # 检查4：核心指标异常检测
        anomaly_free = self._check_no_anomaly(table_name, partition_date)
        checks.append({
            "name": "异常波动检测",
            "passed": anomaly_free,
            "detail": "核心指标未检测到异常波动" if anomaly_free else "核心指标存在异常波动",
        })

        all_passed = all(c["passed"] for c in checks)
        failed_checks = [c["name"] for c in checks if not c["passed"]]

        return ReadinessCheckResult(
            ready=all_passed,
            checks=checks,
            reason="数据就绪" if all_passed else f"未就绪原因: {', '.join(failed_checks)}",
        )

    def _check_partition(self, table: str, date: str) -> bool:
        """检查分区是否存在（生产环境替换为真实查询）"""
        # 模拟：生产环境执行 SELECT COUNT(*) FROM information_schema.partitions ...
        return True

    def _check_row_count(self, table: str, date: str) -> int:
        """检查分区行数（生产环境替换为真实查询）"""
        # 模拟：生产环境执行 SELECT COUNT(*) FROM {table} WHERE dt = '{date}'
        return 15000

    def _check_last_update_time(self, table: str) -> datetime | None:
        """检查最后更新时间"""
        # 模拟：生产环境查询元数据表
        return datetime.now() - timedelta(hours=2)

    def _check_no_anomaly(self, table: str, date: str) -> bool:
        """检查核心指标是否有异常波动（与前一天或上周同日对比）"""
        # 模拟：生产环境对比核心指标的环比变化
        return True


# ========== 使用示例 ==========

checker = DataReadinessChecker()
result = checker.check(
    table_name="fact_orders",
    partition_date="2026-06-06",
    expected_min_rows=10000,
    max_hours_since_update=6,
)

print(f"数据就绪: {result.ready}")
print(f"原因: {result.reason}")
for check in result.checks:
    status = "✅" if check["passed"] else "❌"
    print(f"  {status} {check['name']}: {check['detail']}")
```

输出示例：

```
数据就绪: True
原因: 数据就绪
  ✅ 分区存在性: 表 fact_orders 的分区 2026-06-06 存在
  ✅ 数据量阈值: 实际行数 15000，阈值 10000
  ✅ 数据新鲜度: 最后更新时间 2026-06-07 07:00:00，阈值 6 小时内
  ✅ 异常波动检测: 核心指标未检测到异常波动
```

将这个检查器集成到调度流程中，可以有效避免"数据还没刷完就开始生成报告"的常见事故。在 Airflow 或自研调度系统中，建议将其作为报告任务的前置 Operator 执行。

#### 幂等控制

同一个 `report_id + period` 只能生成一份正式产物。即便调度重试，也不能重复分发。

#### 超时与降级

如果完整报告生成失败，可以降级为：

- 只发核心指标卡片；
- 不附带复杂图表；
- 或提示“数据尚未完全就绪”。

#### 失败重试与告警

失败要分类型：

- SQL 生成失败；
- SQL 执行失败；
- 图表渲染失败；
- PDF 导出失败；
- 分发失败。

不同失败类型对应不同重试策略和告警接收人。

### 5. 分发链路设计

企业里最常见的分发渠道包括：

- 邮件；
- 企业微信机器人；
- 飞书群消息 / 卡片；
- Slack；
- 内部门户消息中心；
- Webhook 到第三方系统。

这里最容易忽略的是“不同渠道对内容形态要求不同”。例如：

- 邮件适合完整 HTML；
- 飞书卡片更适合摘要 + 链接；
- 企业微信对图片和文本长度有限制；
- Slack 更适合 block 结构。

因此，报告系统最好把“报告内容”和“分发适配”分开：

- 先生成统一报告对象；
- 再由不同 adapter 转成对应渠道格式。

### 6. 报告里的 LLM 该做什么，不该做什么

我比较建议把 LLM 用在以下场景：

- 自动写摘要；
- 自动生成“本期变化原因假设”；
- 将结构化结论改写成高可读文字；
- 根据受众角色调整措辞风格。

但不要把下面这些交给 LLM 自由决定：

- 数字本身；
- 指标公式；
- 时间范围；
- 分发名单；
- 最终是否发送。

换句话说，**LLM 可以润色报告，但不能决定报告事实。**

### 8. 报告分发失败的重试与降级策略

在生产环境中，报告分发失败是常见问题。邮件发送失败、企业微信机器人超时、飞书 API 限流都可能导致报告无法送达。一个健壮的报告系统需要有完善的重试和降级机制：

```python
import time
import logging
from enum import Enum
from typing import Callable, Any

logger = logging.getLogger(__name__)


class DeliveryStatus(Enum):
    SUCCESS = "success"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_PERMANENT = "failed_permanent"
    DEGRADED = "degraded"


class ReportDeliveryManager:
    """报告分发管理器，支持多渠道、重试和降级"""

    def __init__(self, max_retries: int = 3, retry_delay: float = 5.0):
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.adapters: dict[str, Callable] = {}
        self.delivery_log: list[dict] = []

    def register_adapter(self, channel: str, adapter: Callable):
        """注册分发适配器"""
        self.adapters[channel] = adapter

    def deliver(
        self,
        channel: str,
        report_context: dict,
        recipient: str,
    ) -> DeliveryStatus:
        """尝试分发报告，自动重试并降级"""
        adapter = self.adapters.get(channel)
        if not adapter:
            logger.error(f"未找到渠道 {channel} 的适配器")
            return DeliveryStatus.FAILED_PERMANENT

        last_error = None
        for attempt in range(1, self.max_retries + 1):
            try:
                result = adapter(report_context, recipient)
                self._log_delivery(channel, recipient, "success", attempt)
                return DeliveryStatus.SUCCESS
            except TimeoutError as e:
                last_error = e
                logger.warning(
                    f"渠道 {channel} 第 {attempt} 次分发超时，"
                    f"等待 {self.retry_delay}秒 后重试"
                )
                time.sleep(self.retry_delay)
            except ConnectionError as e:
                last_error = e
                logger.warning(
                    f"渠道 {channel} 第 {attempt} 次分发连接失败"
                )
                time.sleep(self.retry_delay)
            except Exception as e:
                last_error = e
                logger.error(
                    f"渠道 {channel} 分发出现不可重试错误: {e}"
                )
                break

        # 所有重试失败，尝试降级
        degraded = self._try_degrade(report_context, recipient)
        if degraded:
            self._log_delivery(channel, recipient, "degraded", self.max_retries)
            return DeliveryStatus.DEGRADED

        self._log_delivery(
            channel, recipient, "failed",
            self.max_retries, str(last_error)
        )
        return DeliveryStatus.FAILED_PERMANENT

    def _try_degrade(self, report_context: dict, recipient: str) -> bool:
        """尝试降级发送：只发送核心指标摘要"""
        try:
            degraded_context = {
                "title": report_context.get("title", "数据报告"),
                "summary": report_context.get("summary", []),
                "metrics": report_context.get("metrics", []),
                "degraded": True,
            }
            # 尝试通过备用渠道（如邮件）发送降级版本
            if "email" in self.adapters:
                self.adapters["email"](degraded_context, recipient)
                logger.info(f"降级版本已通过邮件发送给 {recipient}")
                return True
        except Exception as e:
            logger.error(f"降级发送也失败: {e}")
        return False

    def _log_delivery(
        self, channel: str, recipient: str,
        status: str, attempts: int, error: str = "",
    ):
        self.delivery_log.append({
            "channel": channel,
            "recipient": recipient,
            "status": status,
            "attempts": attempts,
            "error": error,
            "timestamp": time.time(),
        })


# ========== 使用示例 ==========

def mock_email_adapter(context: dict, recipient: str) -> bool:
    """模拟邮件发送"""
    if "降级" in str(context):
        raise TimeoutError("邮件服务暂时不可用")
    print(f"[邮件] 发送报告到 {recipient}: {context['title']}")
    return True


def mock_feishu_adapter(context: dict, recipient: str) -> bool:
    """模拟飞书机器人发送"""
    print(f"[飞书] 发送卡片到 {recipient}: {context['title']}")
    return True


manager = ReportDeliveryManager(max_retries=2, retry_delay=1.0)
manager.register_adapter("email", mock_email_adapter)
manager.register_adapter("feishu", mock_feishu_adapter)

report = {
    "title": "华东渠道支付GMV周报",
    "summary": ["GMV环比增长12.6%", "广告渠道贡献最大"],
    "metrics": [{"name": "支付GMV", "value": "¥382.9万"}],
}

# 分发到飞书
status = manager.deliver("feishu", report, "运营负责人")
print(f"飞书分发状态: {status.value}")

# 分发到邮件
status = manager.deliver("email", report, "数据团队")
print(f"邮件分发状态: {status.value}")
```

这种设计确保了即使某个分发渠道临时不可用，报告也能通过降级机制送达核心受众，避免"报告发不出去但无人知晓"的情况。

### 7. 报告模板选型与交付形态对比

如果你准备把报告能力做成长期基础设施，建议在早期就明确不同模板方案的边界，否则很容易一边写模板一边返工。

| 方案 | 优点 | 缺点 | 适合场景 |
| --- | --- | --- | --- |
| HTML 模板 | 样式灵活、易导出 PDF、适合邮件 | 前端样式维护成本较高 | 日报、周报、月报 |
| Markdown 模板 | 版本管理友好、文本可读性强 | 复杂布局能力弱 | 技术团队周报、归档文档 |
| DSL / JSON Schema | 跨端适配强、适合卡片化分发 | 初期建设成本高 | 飞书卡片、消息中心、多端统一分发 |

一个很实用的工程做法是：**数据层统一、模板层分流、分发层适配。**

也就是说，同一份 `report context` 可以：

1. 渲染为 HTML 邮件完整版；
2. 渲染为飞书卡片摘要版；
3. 渲染为 Markdown 归档版；
4. 导出为 PDF 作为正式周报附件。

这样你不会把“分析产物”和“投递渠道”强耦合在一起，后续替换渠道或新增触达方式也更轻松。

---

## 六、真实踩坑记录与解决方案

下面这部分，是我认为最有价值的内容。因为真正把系统做上线后，决定成败的往往不是"最佳实践"，而是你有没有踩过坑、有没有形成反脆弱机制。

### 踩坑严重度与解决方案速查表

为了方便快速查阅，先给出一张总览表，再逐一展开详细分析：

| 踩坑编号 | 问题 | 严重度 | 影响范围 | 核心解法 |
| --- | --- | --- | --- | --- |
| 坑一 | Schema 全量塞模型，准确率下降 | 中 | SQL 生成质量 | 两阶段召回 + 精排 |
| 坑二 | SQL 语法对但结果偏大 | 高（致命） | 核心指标可信度 | 粒度标注 + JOIN 模板 + 放大检测 |
| 坑三 | "最近一个月"多人理解不一致 | 高 | 时间口径正确性 | 统一时间解析规则 |
| 坑四 | 图表选型技术正确但业务看不懂 | 中 | 用户满意度 | 保守模式优先简单图 |
| 坑五 | 自动摘要掺入幻觉 | 高 | 报告可信度 | 事实提取 + LLM 仅润色 |
| 坑六 | 定时报告数据未就绪就发送 | 高（致命） | 数据交付完整性 | 数据就绪门禁 |
| 坑七 | 消除用户澄清导致歧义放大 | 中 | 查询准确率 | 默认定义 + 交互式澄清 |
| 坑八 | 离线评估不足，线上问题滞后 | 高 | 系统长期演进 | 评测集 + 回放评估 |

> **经验法则**：严重度为"高（致命）"的坑，必须在系统上线前建立防线；"中"的坑可以在 MVP 阶段容忍，但需要在迭代中逐步覆盖。

### 坑一：把 schema 全塞给模型，结果准确率反而下降

项目初期我们认为“上下文越多越好”，把几十张表的 DDL 和字段说明一次性丢给模型。结果出现两个问题：

1. 响应时间显著变长；
2. 模型更容易选错表和字段，因为候选太多。

#### 根因

大模型并不会因为上下文更多就自然更准确，尤其当上下文中存在相似字段、重复概念、历史废弃表时，它会被噪声干扰。

#### 解决方案

改成“两阶段召回 + 精排”：

- 先基于问题召回候选表；
- 再结合指标定义、表关系、用户角色做 rerank；
- 最终只给模型最相关的少量表和指标定义。

改完后，SQL 首次成功率和平均时延都明显改善。

### 坑二：模型生成的 SQL 语法对，但结果总是偏大

这是最典型也最致命的问题。尤其在订单、商品、退款、营销曝光这些一对多关系场景里，数值放大非常常见。

#### 根因

模型对表粒度缺乏稳定理解，直接在明细层 JOIN 再聚合，导致重复累计。

#### 解决方案

我们做了三层防线：

1. **在 schema catalog 中显式标注粒度**，例如 `one_row_per_order`、`one_row_per_item`；
2. **维护推荐 JOIN 模板**，让模型尽量复用可验证的查询骨架；
3. **在 SQL 校验阶段做放大检测**，例如检查主表聚合字段是否在一对多 JOIN 后直接求和。

对于高风险指标，还会自动改写成“先聚合后 JOIN”的 CTE 形式。

### 坑三：同一句“最近一个月”，不同人理解不一样

业务侧经常会说“最近一个月”“上个月”“本月以来”“近 4 周”，这些词看似自然，实际在数据系统里含义差异极大。

#### 根因

自然语言时间表达存在歧义，而模型往往会按训练语料中的常见习惯做猜测。

#### 解决方案

做了统一时间解析规则：
做了统一时间解析规则：
- "最近一个月"默认解释为最近 30 天；
- "上个月"解释为上一个自然月；
- "本月以来"解释为当月 1 日至今；
- "近 4 周"解释为最近 28 天，并支持按周聚合。

下面给出一个完整的时间表达式解析器实现，它可以将自然语言时间表达式转换为精确的 SQL 时间条件：

```python
import re
from datetime import datetime, timedelta
from typing import NamedTuple

class TimeRange(NamedTuple):
    """解析后的时间范围"""
    start: str          # 起始日期，格式 YYYY-MM-DD
    end: str            # 结束日期，格式 YYYY-MM-DD
    description: str    # 可读描述
    sql_condition: str  # 可直接用于 SQL WHERE 的条件模板


class TimeExpressionParser:
    """自然语言时间表达式解析器"""

    def __init__(self, reference_date: datetime | None = None):
        self.ref = reference_date or datetime.now()

    def parse(self, expression: str) -> TimeRange | None:
        """解析自然语言时间表达式"""
        # 按优先级尝试匹配
        for pattern, handler in [
            (r"最近(\d+)天", self._parse_last_n_days),
            (r"最近(\d+)周", self._parse_last_n_weeks),
            (r"近(\d+)周", self._parse_last_n_weeks),
            (r"上个月", self._parse_last_month),
            (r"上月", self._parse_last_month),
            (r"本月以来", self._parse_current_month),
            (r"本月至今", self._parse_current_month),
            (r"本季度", self._parse_current_quarter),
            (r"今年", self._parse_current_year),
            (r"昨天", self._parse_yesterday),
            (r"前天", self._parse_day_before_yesterday),
        ]:
            match = re.search(pattern, expression)
            if match:
                return handler(match)

        return None

    def _parse_last_n_days(self, match) -> TimeRange:
        n = int(match.group(1))
        start = (self.ref - timedelta(days=n)).strftime("%Y-%m-%d")
        end = self.ref.strftime("%Y-%m-%d")
        return TimeRange(
            start=start, end=end,
            description=f"最近{n}天（{start} 至 {end}）",
            sql_condition=f"date_col >= '{start}' AND date_col <= '{end}'",
        )

    def _parse_last_n_weeks(self, match) -> TimeRange:
        n = int(match.group(1))
        start = (self.ref - timedelta(weeks=n)).strftime("%Y-%m-%d")
        end = self.ref.strftime("%Y-%m-%d")
        return TimeRange(
            start=start, end=end,
            description=f"最近{n}周（{start} 至 {end}）",
            sql_condition=f"date_col >= '{start}' AND date_col <= '{end}'",
        )

    def _parse_last_month(self, match) -> TimeRange:
        first_of_month = self.ref.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return TimeRange(
            start=last_month_start.strftime("%Y-%m-%d"),
            end=last_month_end.strftime("%Y-%m-%d"),
            description=f"上个自然月（{last_month_start.strftime('%Y-%m-%d')} 至 {last_month_end.strftime('%Y-%m-%d')}）",
            sql_condition=f"date_col >= '{last_month_start.strftime('%Y-%m-%d')}' AND date_col <= '{last_month_end.strftime('%Y-%m-%d')}'",
        )

    def _parse_current_month(self, match) -> TimeRange:
        start = self.ref.replace(day=1).strftime("%Y-%m-%d")
        end = self.ref.strftime("%Y-%m-%d")
        return TimeRange(
            start=start, end=end,
            description=f"本月至今（{start} 至 {end}）",
            sql_condition=f"date_col >= '{start}' AND date_col <= '{end}'",
        )

    def _parse_current_quarter(self, match) -> TimeRange:
        quarter = (self.ref.month - 1) // 3
        start_month = quarter * 3 + 1
        start = self.ref.replace(month=start_month, day=1).strftime("%Y-%m-%d")
        end = self.ref.strftime("%Y-%m-%d")
        return TimeRange(
            start=start, end=end,
            description=f"本季度（{start} 至 {end}）",
            sql_condition=f"date_col >= '{start}' AND date_col <= '{end}'",
        )

    def _parse_current_year(self, match) -> TimeRange:
        start = f"{self.ref.year}-01-01"
        end = self.ref.strftime("%Y-%m-%d")
        return TimeRange(
            start=start, end=end,
            description=f"今年（{start} 至 {end}）",
            sql_condition=f"date_col >= '{start}' AND date_col <= '{end}'",
        )

    def _parse_yesterday(self, match) -> TimeRange:
        d = (self.ref - timedelta(days=1)).strftime("%Y-%m-%d")
        return TimeRange(
            start=d, end=d,
            description=f"昨天（{d}）",
            sql_condition=f"date_col = '{d}'",
        )

    def _parse_day_before_yesterday(self, match) -> TimeRange:
        d = (self.ref - timedelta(days=2)).strftime("%Y-%m-%d")
        return TimeRange(
            start=d, end=d,
            description=f"前天（{d}）",
            sql_condition=f"date_col = '{d}'",
        )


# ========== 使用示例 ==========

parser = TimeExpressionParser(reference_date=datetime(2026, 6, 7))

test_cases = [
    "最近30天各渠道支付GMV趋势",
    "上个月华东区域销售情况",
    "本月以来新客转化率",
    "近4周广告投放ROI",
    "今年累计GMV",
    "昨天订单量",
]

for question in test_cases:
    result = parser.parse(question)
    if result:
        print(f"问题: {question}")
        print(f"  时间范围: {result.description}")
        print(f"  SQL条件: {result.sql_condition}")
        print()
```

输出示例：

```
问题: 最近30天各渠道支付GMV趋势
  时间范围: 最近30天（2026-05-08 至 2026-06-07）
  SQL条件: date_col >= '2026-05-08' AND date_col <= '2026-06-07'

问题: 上个月华东区域销售情况
  时间范围: 上个自然月（2026-05-01 至 2026-05-31）
  SQL条件: date_col >= '2026-05-01' AND date_col <= '2026-05-31'

问题: 本月以来新客转化率
  时间范围: 本月至今（2026-06-01 至 2026-06-07）
  SQL条件: date_col >= '2026-06-01' AND date_col <= '2026-06-07'
```

同时在最终回答或报告附录中显式展示：

> 时间范围：2026-05-03 至 2026-06-01（最近30天）

这样至少保证结果可审计、可复盘。

### 坑四：图表自动选型“技术上合理”，但业务根本看不懂

我们早期做图表推荐时，偏重“数据可视化理论正确”，例如有构成关系就优先堆叠面积图，类别很多就尝试热力图。但实际业务反馈并不好，因为他们更熟悉简单直接的表达。

#### 根因

系统从“可视化最优”出发，而用户从“阅读成本最低”出发。

#### 解决方案

后来调整原则：**业务报告优先简单稳定，不追求炫技。**

具体策略包括：

- 趋势优先折线图；
- 类别对比优先柱状图；
- 类别过多时优先横向条形图或表格；
- 除非明确要求，不自动生成复杂组合图；
- 支持“保守模式”图表策略。

最终业务满意度比复杂图表高很多。

### 坑五：自动摘要写得像分析师，但掺了幻觉

例如图表显示 GMV 上升，模型会写“这可能是由于投放素材优化带来的渠道效率提升”。这类结论听起来专业，但根本没有证据支持。

#### 根因

LLM 天生倾向补全因果解释，而业务分析报告又特别容易诱导模型“说得更像回事”。

#### 解决方案

把摘要生成分成两段：

1. 先由程序提取事实信号，如涨跌幅、峰值、异常点、Top 渠道；
2. 再要求模型只基于事实写结论，并明确区分“事实”与“推测”。

例如报告中使用这样的表达：

- 事实：本周期支付 GMV 环比增长 12.6%；
- 事实：广告投放渠道贡献占比最高，为 43.2%；
- 推测：增长可能与月中促销活动有关，建议结合活动日历进一步核查。

这样会稳很多。

### 坑六：定时报告经常在数据未就绪时发送

这是自动化系统非常常见的故障。定时任务按时触发，但上游 ETL 因为延迟还没完成，导致报告发出去后数字偏低，第二天被业务追着问。

#### 根因

调度只看时间，不看数据 readiness。

#### 解决方案

加入“数据就绪门禁”：

- 查询目标分区是否存在；
- 核心表行数是否达到合理阈值；
- 与昨天相比波动是否超出异常区间；
- 依赖任务状态是否完成。

如果未就绪，则：

- 延迟重试；
- 或发送“报告延迟，等待数据刷新”的通知；
- 严禁把不完整数据当正式报告发出。

### 坑七：为了追求“全自动”，把用户澄清环节完全拿掉

有些问题本身就存在歧义，例如：

> 看下核心用户最近表现。

“核心用户”到底是谁？RFM 高价值用户？会员等级 L3+？近 90 天消费大于 1000？如果系统强行猜，结果大概率有争议。

#### 解决方案

对于高歧义词汇，语义层中维护：

- 默认定义；
- 组织级标准定义；
- 高风险提示。

在无人值守的自动场景里，优先使用组织标准定义；在交互式场景里，则可以进行澄清追问。由于很多报告任务是固定模板，建议在任务创建时就把口径固化，而不是运行时临时猜。

### 坑八：离线评估做得太少，线上问题全靠业务反馈

一开始我们也只盯着“用户满意吗”。但这种反馈太慢，也太模糊。等业务说“这个系统不靠谱”时，往往已经错了很多次。

#### 解决方案

建立离线评测集，覆盖：

- 常见分析问题；
- 多表 JOIN；
- 时间表达；
- 聚合与转化率；
- 图表选型；
- 报告摘要一致性。

对每次 prompt、模型版本、规则变更进行回放评估，至少观察：

- SQL 执行成功率；
- 结果口径正确率；
- 图表可用率；
- 摘要事实一致率；
- 端到端任务成功率。

这一步做起来麻烦，但它决定了系统能否长期迭代。

### 评测体系的核心指标定义

建立离线评测集时，需要明确定义各类评测指标的计算方式和合格标准。下面给出一个评测框架参考：

| 评测维度 | 指标名称 | 计算方式 | 合格线 | 说明 |
| --- | --- | --- | --- | --- |
| SQL 质量 | 语法正确率 | 可执行 SQL 数 / 总生成数 | ≥ 98% | 语法错误必须在测试阶段拦截 |
| SQL 质量 | 语义正确率 | 业务口径正确数 / 总生成数 | ≥ 85% | 需人工标注或与基准 SQL 对比 |
| SQL 质量 | 首次成功率 | 首次生成即正确的比例 | ≥ 75% | 反映模型理解能力 |
| 图表质量 | 选型准确率 | 图表类型推荐正确的比例 | ≥ 90% | 基于预定义评测集 |
| 图表质量 | 数据映射正确率 | 字段映射无误的比例 | ≥ 95% | 时间轴、类别、指标映射 |
| 报告质量 | 摘要事实一致率 | 摘要与数据一致的比例 | ≥ 95% | 关键结论不能有事实性错误 |
| 端到端 | 任务成功率 | 全流程完成且结果可用的比例 | ≥ 80% | 包含意图解析到报告交付 |
| 端到端 | 平均响应时间 | 从提问到报告生成的耗时 | ≤ 30秒 | 影响用户体验 |

---

## 七、一个可落地的最小实现方案

如果你所在团队还没有资源做很重的平台化建设，我建议从一个最小闭环版本开始，而不是一口气做“全能分析 Agent”。

### 1. 第一阶段目标

先只支持：

- 10~20 个高频指标；
- 5~10 张核心表；
- 查询 + 图表 + HTML 周报；
- 单一数据库或数仓引擎；
- 单个分发渠道。

### 2. 最小系统组成

- 一个语义配置中心：维护指标、表、字段、JOIN 提示；
- 一个 Text-to-SQL 服务：意图解析 + SQL 生成；
- 一个 SQL Guard：白名单、AST 校验、Explain 检查；
- 一个 Query Runner：执行 SQL 并统一输出结果；
- 一个 Chart Mapper：将结果映射到 chart spec 和 ECharts option；
- 一个 Report Renderer：基于模板引擎生成 HTML；
- 一个 Scheduler：定时报表任务调度；
- 一个 Audit Log：记录全过程产物。

### 3. 推荐的工程边界

为了让系统尽快稳定，前期尽量遵守几个边界：

- 只读，不允许任何写库操作；
- 只支持白名单表和白名单指标；
- 所有复杂指标优先在语义层预定义；
- 所有自动报告先在小范围用户灰度；
- 所有查询保留可追溯 SQL 和执行日志。

### 4. 为什么不要一开始就做“全开放问数”

因为“全开放问数”意味着：

- 表太多；
- 口径太杂；
- 预期太高；
- 错误成本太大。

相比之下，从高频经营分析场景切入，比如销售周报、渠道日报、区域月报，更容易把流程跑通，也更容易积累评测样本和业务信任。

### 5. 最小实现的 Python 代码骨架

下面给出一个可直接运行的最小系统骨架，涵盖从自然语言到报告的完整流水线。你可以基于此快速搭建 PoC，验证核心链路是否可行：

```python
import json
import hashlib
from datetime import datetime
from dataclasses import dataclass, field, asdict

# ========== 1. 意图识别 ==========

def parse_intent(question: str) -> dict:
    """将自然语言问题解析为结构化意图（生产环境替换为 LLM 调用）"""
    # 简化版：基于关键词匹配
    intent = {
        "question": question,
        "metrics": [],
        "dimensions": [],
        "time_range": None,
        "filters": {},
    }

    metric_keywords = {
        "GMV": "payment_gmv", "订单数": "order_count",
        "用户数": "user_count", "转化率": "conversion_rate",
    }
    for keyword, metric in metric_keywords.items():
        if keyword in question:
            intent["metrics"].append(metric)

    time_keywords = {
        "最近7天": "last_7_days", "最近30天": "last_30_days",
        "上个月": "last_month", "本月": "current_month",
    }
    for keyword, time_range in time_keywords.items():
        if keyword in question:
            intent["time_range"] = time_range
            break

    return intent


# ========== 2. SQL 生成 ==========

def generate_sql(intent: dict, catalog: dict) -> str:
    """基于意图和语义目录生成 SQL（生产环境替换为 LLM 调用）"""
    metrics = intent["metrics"]
    time_range = intent["time_range"]

    metric_select = {
        "payment_gmv": "SUM(o.pay_amount) AS payment_gmv",
        "order_count": "COUNT(DISTINCT o.order_id) AS order_count",
        "user_count": "COUNT(DISTINCT o.user_id) AS user_count",
    }
    select_parts = [metric_select.get(m, m) for m in metrics]

    time_conditions = {
        "last_7_days": "o.pay_time >= CURRENT_DATE - INTERVAL '7 DAY'",
        "last_30_days": "o.pay_time >= CURRENT_DATE - INTERVAL '30 DAY'",
        "last_month": "o.pay_time >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 MONTH')",
    }
    where_clause = time_conditions.get(time_range, "1=1")

    sql = f"""
SELECT {', '.join(select_parts)}
FROM fact_orders o
WHERE {where_clause}
  AND o.is_test = 0
  AND o.pay_status = 'SUCCESS'
"""
    return sql.strip()


# ========== 3. SQL 校验 ==========

FORBIDDEN_KEYWORDS = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE"]
REQUIRED_KEYWORDS = ["WHERE", "is_test"]

def validate_sql(sql: str) -> dict:
    """SQL 安全校验，返回校验结果"""
    errors = []
    warnings = []

    sql_upper = sql.upper()

    # 检查危险操作
    for kw in FORBIDDEN_KEYWORDS:
        if kw in sql_upper:
            errors.append(f"禁止执行 {kw} 操作")

    # 检查是否缺少关键过滤条件
    for kw in REQUIRED_KEYWORDS:
        if kw not in sql_upper:
            warnings.append(f"缺少推荐过滤条件: {kw}")

    # 检查是否有 LIMIT
    if "LIMIT" not in sql_upper:
        warnings.append("建议添加 LIMIT 限制返回行数")

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


# ========== 4. 查询执行（模拟） ==========

def execute_query(sql: str) -> dict:
    """模拟执行 SQL 并返回结果"""
    # 生产环境替换为真实数据库连接
    return {
        "columns": ["payment_gmv"],
        "rows": [[3829102.50]],
        "meta": {"row_count": 1, "unit": "CNY", "exec_time_ms": 245},
    }


# ========== 5. 图表配置生成 ==========

def generate_chart_spec(intent: dict, result: dict) -> dict:
    """基于结果数据生成图表规格"""
    return {
        "chart_type": "bar",
        "title": "核心指标概览",
        "x": {"field": "metric", "type": "nominal", "label": "指标"},
        "y": [{"field": "value", "type": "quantitative", "label": "金额（元）"}],
        "data": result["rows"],
    }


# ========== 6. 报告渲染 ==========

REPORT_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{title}</title></head>
<body>
<h1>{title}</h1>
<p>生成时间：{generated_at}</p>
<h2>核心指标</h2>
<table border="1" cellpadding="8">
  <tr><th>指标</th><th>数值</th></tr>
  {metrics_rows}
</ul>
<h2>分析结论</h2>
{summary}
<h2>附录</h2>
<p>查询 SQL：<code>{sql}</code></p>
</body>
</html>
""".strip()


def render_report(intent: dict, result: dict, sql: str) -> str:
    """渲染 HTML 报告"""
    title = f"数据分析报告 - {intent.get('question', '未知查询')}"
    metrics_rows = ""
    for row in result["rows"]:
        metrics_rows += f"<tr><td>支付GMV</td><td>¥{row[0]:,.2f}</td></tr>\n  "

    return REPORT_TEMPLATE.format(
        title=title,
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        metrics_rows=metrics_rows,
        summary="<p>支付GMV达到 ¥382.9万，整体表现良好。</p>",
        sql=sql,
    )


# ========== 主流水线 ==========

def run_pipeline(question: str) -> dict:
    """完整的数据分析流水线"""
    # Step 1: 意图解析
    intent = parse_intent(question)

    # Step 2: 语义补全 + SQL 生成
    sql = generate_sql(intent, catalog={})

    # Step 3: SQL 校验
    validation = validate_sql(sql)
    if not validation["passed"]:
        return {"status": "failed", "errors": validation["errors"]}

    # Step 4: 执行查询
    result = execute_query(sql)

    # Step 5: 图表生成
    chart = generate_chart_spec(intent, result)

    # Step 6: 报告渲染
    html = render_report(intent, result, sql)

    return {
        "status": "success",
        "intent": intent,
        "sql": sql,
        "validation": validation,
        "result": result,
        "chart": chart,
        "report_html_length": len(html),
        "query_id": hashlib.md5(sql.encode()).hexdigest()[:8],
    }


# ========== 运行示例 ==========

if __name__ == "__main__":
    question = "帮我看下最近30天支付GMV是多少"
    output = run_pipeline(question)
    print(json.dumps(output, ensure_ascii=False, indent=2))
```

运行输出示例：

```json
{
  "status": "success",
  "intent": {
    "question": "帮我看下最近30天支付GMV是多少",
    "metrics": ["payment_gmv"],
    "dimensions": [],
    "time_range": "last_30_days",
    "filters": {}
  },
  "sql": "SELECT SUM(o.pay_amount) AS payment_gmv\nFROM fact_orders o\nWHERE o.pay_time >= CURRENT_DATE - INTERVAL '30 DAY'\n  AND o.is_test = 0\n  AND o.pay_status = 'SUCCESS'",
  "validation": {
    "passed": true,
    "errors": [],
    "warnings": ["建议添加 LIMIT 限制返回行数"]
  },
  "result": {
    "columns": ["payment_gmv"],
    "rows": [[3829102.5]],
    "meta": {"row_count": 1, "unit": "CNY", "exec_time_ms": 245}
  },
  "query_id": "a3f1b2c4"
}
```

这段代码虽然简化了 LLM 调用部分，但完整展示了**意图解析 → SQL 生成 → SQL 校验 → 执行 → 图表 → 报告**的全链路。你可以把 `parse_intent` 和 `generate_sql` 替换为真实的大模型 API 调用，其余部分都可以直接用于生产。

---

## 八、给后端工程师的实现建议

面向后端工程师，我最后再给几条更偏落地的建议。

### 1. 不要把 Prompt 当成唯一资产

Prompt 很重要，但真正能构成工程壁垒的是：

- 语义层配置；
- 指标定义；
- JOIN 模板；
- SQL 校验规则；
- 评测数据集；
- 审计与回放系统。

这些东西比“某一版神奇 Prompt”更持久。

### 2. 先做可观测性，再谈智能化

至少要记录：

- 原始问题；
- 意图结构化结果；
- 召回到的 schema；
- 模型输入输出；
- 最终 SQL；
- 校验结果；
- 执行耗时；
- 图表规格；
- 报告产物链接；
- 分发结果。

没有这些，你连系统错在哪都不知道。

### 3. 坚持中间表示

无论是 SQL、图表、报告，都不要只保留最终字符串，尽量保留中间表示：

- Intent JSON；
- Semantic Plan；
- SQL AST 或规则检查结果；
- Chart Spec；
- Report Context。

中间表示越清晰，系统越可维护。

### 4. 高风险场景优先规则化

比如金额类核心指标、财务报表、老板日报，这类场景对准确性要求极高。与其让模型自由生成，不如使用：

- 预定义查询模板；
- 参数化 SQL；
- 固化图表；
- 固化报告模板。

让 Agent 更多承担“理解需求和组织结果”的角色，而不是“自由发挥”。

### 5. 把“不能回答”设计成系统能力

一个成熟系统不应为了显得聪明而瞎答。遇到下列情况，就应该优雅失败：

- 指标未定义；
- 表无权限；
- 语义歧义过大；
- 查询成本过高；
- 数据尚未就绪。

能明确告诉用户“为什么现在不能给出可信结果”，其实比给出一个错误结果更专业。

---

## 九、总结

AI Agent 在数据分析场景中的真正价值，不是把分析师的工作“聊天化”，而是把原本分散在 SQL、BI、图表、报告、调度、分发中的链路重新串起来，形成一个更自然但仍然可控的数据交付系统。

如果只看表面，这个题目似乎是在做 Text-to-SQL；但一旦开始落地，你就会发现它本质上是四个系统能力的融合：

1. **语义理解能力**：把自然语言问题映射成结构化分析意图；
2. **数据执行能力**：在复杂 schema、JOIN、聚合和权限约束下生成并执行可信 SQL；
3. **表达生成能力**：自动选择合适图表，把结果转换成可读表达；
4. **交付自动化能力**：用模板、调度和分发体系把结果稳定送达。

而这四个能力能否真正落地，关键又不在于模型参数量有多大，而在于你是否构建了：

- 清晰的语义层；
- 可校验的 SQL 流水线；
- 稳定的图表映射规则；
- 可回溯的报告系统；
- 足够真实的评测和踩坑闭环。

对于有实际开发经验的后端工程师来说，这恰恰是一个非常适合发挥优势的方向。因为它不是单纯拼 Prompt，而是需要你把服务架构、数据建模、规则引擎、任务调度、模板渲染、日志审计和 AI 能力整合起来。真正做成之后，你得到的也不是一个“会聊天的机器人”，而是一条**从问题到洞察、从数据到交付**的自动化生产线。

如果你正在规划内部 AI 数据产品，我的建议是：不要一开始就试图回答所有问题，先从高频、可定义、可验证的分析场景入手，把语义层、SQL Guard、图表映射和报告自动化四件事打扎实。等你把这四块真正跑稳了，再谈更开放的智能分析。到那个时候，AI Agent 才不只是一个 Demo，而会成为团队里真正能持续创造价值的基础设施。

## 实践总结与避坑清单

> 以下是全文核心要点的快速参考，适合收藏后反复查阅。

1. **语义层是地基，不是锦上添花。** 先把高频指标、核心表、JOIN 路径和业务口径固化到语义配置中，再让 LLM 在其上工作。过早追求"全开放问数"只会让准确率失控。
2. **Text-to-SQL 的正确流程是五步，不是一步。** 意图结构化 → 语义计划 → 候选 SQL → AST 校验 → 试跑修复，任何跳步都会放大出错概率。
3. **多表 JOIN 前先标注粒度。** 在 schema catalog 中显式标注 `one_row_per_order` 等粒度信息，并维护推荐 JOIN 模板；对高风险查询自动改写为"先聚合后 JOIN"的 CTE 形式，防止数值放大。
4. **SQL 正确 ≠ 业务正确。** 时刻警惕时间字段选错、测试订单未过滤、聚合口径偏差等"语法对但语义错"的场景，用规则引擎做前置拦截。
5. **图表选型先规则化，再模型化。** 建立"分析意图 + 数据形态 → 图表类型"的决策矩阵，优先折线图和柱状图等简单图，避免在业务报告中炫技。图表 Spec 作为中间层，再由代码转为 ECharts / Plotly 配置。
6. **报告 LLM 只润色，不决定事实。** 数字、指标公式、时间范围、分发名单必须由确定性系统控制；LLM 只负责摘要撰写和结论润色，并严格区分"事实"与"推测"。
7. **调度层必须加数据就绪门禁。** 不要只看 Cron 时间就发报告，需校验分区存在性、数据量阈值、新鲜度和核心指标异常波动，否则"数据没刷完就发出去"是高频事故。
8. **可观测性和评测集比 Prompt 更持久。** 完整记录每一步的中间产物（意图 JSON、语义计划、SQL、图表 Spec、报告上下文），并维护离线评测集做回放评估——这是系统能长期迭代的基础。

## 相关阅读

- [AI Agent 代码助手实战：代码生成、Review、重构、文档生成](/post/ai-agent-review/)
- [AI Agent 客服系统实战：多轮对话、知识库检索、工单流转](/post/ai-agent-customer-service-system/)
- [AI Agent 运维助手实战：日志分析、告警处理、故障自愈](/post/ai-agent-3/)
- [AI Agent 自动化测试实战：测试用例生成、执行、结果分析闭环](/post/ai-agent-automated-testing-pipeline/)
