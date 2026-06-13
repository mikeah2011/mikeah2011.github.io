---
title: 'Grafana Dashboard as Code 实战：Grafonnet/Jsonnet 可视化即代码——监控面板的版本控制与团队协作'
date: 2026-06-06 10:00:00
tags: [Grafana, Jsonnet, Grafonnet, Dashboard as Code, DevOps, 可观测性]
keywords: [Grafana Dashboard as Code, Grafonnet, Jsonnet, 可视化即代码, 监控面板的版本控制与团队协作, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "Grafana Dashboard as Code 实战指南：使用 Grafonnet 与 Jsonnet 实现监控面板的可视化即代码，彻底告别手动 JSON 导出的版本控制噩梦。涵盖面板类型实战、变量模板化、CI/CD 自动部署、Grafonnet vs Terraform vs Grafana UI 方案对比、常见踩坑与生产级最佳实践，助力 DevOps 团队构建可维护、可复用的可观测性体系。"
---


## 前言：为什么需要 Dashboard as Code？

在现代可观测性体系的建设过程中，Grafana 已经成为事实上的可视化标准平台。无论是 Prometheus、Loki、Tempo 还是各种云厂商的监控服务，几乎所有数据源都可以通过 Grafana 统一展示。然而，随着团队规模的扩大和微服务数量的增长，一个不可避免的问题浮出水面：**数十甚至上百个 Dashboard，如何进行有效的管理和维护？**

在绝大多数团队中，Dashboard 的管理方式至今仍然停留在"手动操作"阶段——工程师在 Grafana UI 上拖拽面板、编辑查询、调整布局，然后通过 Dashboard Settings 页面手动导出 JSON 文件。这种方式在团队只有几个 Dashboard 时或许可行，但一旦规模扩大，痛点便会以指数级暴露出来。

**手动 JSON 导出的第一个痛点是版本管理的彻底缺失。** Grafana 导出的 JSON 文件中包含大量机器自动生成的元数据字段，例如 `id`（数据库自增 ID）、`uid`（唯一标识符）、`version`（版本号），以及各种面板的 `datasource` 引用格式。这些字段在每次导出时都会发生变化，即便你只是微调了某个面板的标题。将这样的 JSON 文件纳入 Git 管理的结果是：每次 Commit 都会产生数百行 diff，其中绝大部分都是无意义的噪音。Code Review 的工程师根本无法从中分辨出哪些是真正的业务变更，哪些只是 Grafana 自动生成的元数据刷新。

**第二个痛点是可读性和可维护性极差。** 一个中等复杂度的 Dashboard（包含 20 到 30 个面板）的 JSON 文件通常长达 3000 到 5000 行。更糟糕的是，这些 JSON 中充斥着大量重复的配置模板——每个 TimeSeries 面板的 `fieldConfig.defaults.custom` 部分几乎完全相同，只有查询表达式不同。人类在面对这种规模的纯 JSON 时，几乎不可能做到有效的审阅和理解。

**第三个痛点是复用困难导致的维护噩梦。** 在微服务架构下，用户服务、订单服务、支付服务往往需要几乎相同的监控 Dashboard 结构——相同的 HTTP 请求率面板、相同的错误率面板、相同的延迟分布面板，只是查询中的服务名标签不同。在手动管理模式下，唯一的"复用"方式就是复制粘贴整个 JSON 文件，然后手动修改其中的查询表达式。当某个公共面板的配置需要更新时（比如统一调整颜色方案或阈值），运维人员必须逐个修改所有 Dashboard 的 JSON 文件，这不仅效率极低，而且极易遗漏。

**第四个痛点是多环境一致性无法保证。** 开发环境、测试环境、预发布环境和生产环境通常使用不同的 Prometheus 数据源实例。手动管理 Dashboard 时，运维人员要么维护多个几乎相同的 Dashboard（每个环境一个），要么在部署时手动搜索替换 JSON 中的数据源名称。前者导致 Dashboard 数量爆炸，后者则意味着操作风险和人为错误的可能。

**第五个痛点是多人协作时的冲突覆盖。** 当多个工程师同时在 Grafana UI 上编辑同一个 Dashboard 时，后保存者会覆盖前者的修改。Grafana 虽然提供了简单的版本历史功能，但它远不如 Git 那样提供精确的逐行 diff 和合并冲突检测。这意味着团队协作几乎完全依赖口头沟通来避免冲突，这在任何规模的团队中都是不可接受的。

Dashboard as Code（DaC）的理念应运而生。它的核心思想很简单：**将 Dashboard 的定义从 UI 操作转变为代码**。这样一来，Dashboard 就像应用代码一样，可以纳入 Git 版本控制、接受 Code Review、通过 CI/CD 自动部署、使用模板实现复用。在众多 DaC 实现方案中，**Grafonnet** 结合 **Jsonnet** 语言提供了一套类型安全、模块化、高度可复用的解决方案，被 Grafana 官方推荐为 Dashboard as Code 的首选工具链。

---

## Grafonnet-lib 核心概念

### Jsonnet 语言基础

在深入 Grafonnet 之前，有必要先理解 Jsonnet 语言的设计哲学。Jsonnet 是 Google 工程师 Dave Cunningham 在 2014 年开发的一种数据模板语言，其定位可以概括为"JSON 的函数式超集"。它在保留 JSON 语法兼容性的同时，引入了变量、函数、条件表达式、数组/对象推导式、继承与合并等编程特性，并保证输出结果一定是合法的 JSON。

选择 Jsonnet 而非 HCL（HashiCorp Configuration Language）或 YAML 作为 DaC 工具的核心语言，有以下几个关键原因。首先，Jsonnet 天生就是为生成 JSON 而设计的，它的语法结构与 Grafana Dashboard 的 JSON 数据模型高度契合，不需要任何序列化/反序列化的适配层。其次，Jsonnet 是一种图灵完备的编程语言，这意味着你可以使用任意复杂的逻辑来生成 Dashboard——循环创建面板数组、条件判断环境差异、函数抽象公共模式，这些在 HCL 中要么不支持要么非常笨拙。第三，Jsonnet 有一套成熟的工具链生态，包括 `go-jsonnet`（Go 实现的解释器，性能优异）、`jsonnet-lint`（静态分析器）、`jsonnetfmt`（代码格式化器），以及各种 IDE 的语言插件支持。

Jsonnet 的核心语法特性包括：变量定义使用 `local` 关键字；函数通过 `local funcName(params) = expr` 定义；条件表达式使用 `if condition then valueA else valueB` 的三元形式；数组和对象推导式（comprehension）允许你通过 `for` 循环动态生成数据结构；而最关键的是深度合并操作符 `+:` 和 `::`（隐藏字段），这两个特性是 Grafonnet 实现继承和覆盖的基石。

Jsonnet 中的隐藏字段（以 `::` 结尾的字段名）在输出 JSON 中不会出现，但可以被同一对象或其他合并操作引用。这个机制使得 Grafonnet 能够在内部维护一些辅助性的计算字段，而不会将它们泄漏到最终的 JSON 输出中。深度合并操作符 `+:` 则允许你在不破坏原有结构的前提下向嵌套对象中添加或覆盖字段，这对于"在基础模板上微调个别属性"的场景来说极其强大。

### Grafonnet 库结构

Grafonnet 是 Grafana 官方维护的 Jsonnet 库，它为 Dashboard JSON 的每个顶层字段和面板类型提供了对应的 Jsonnet 构造函数。目前推荐使用 Grafonnet v2（基于 `grafonnet-base` 的现代重构版本），它比旧版 `grafonnet-lib` 提供了更好的类型安全性、更一致的 API 设计，以及对 Grafana 最新面板类型的支持。

Grafonnet 的模块组织遵循 Grafana Dashboard JSON 的数据模型：`dashboard` 模块对应 Dashboard 级别的配置（标题、标签、时间范围等）；`panel` 子目录按面板类型组织（`timeSeries`、`stat`、`table`、`heatmap`、`gauge`、`barGauge` 等）；`query` 子目录按数据源类型组织（`prometheus`、`loki`、`elasticsearch` 等）；`var` 子目录用于定义 Dashboard 变量（也称为模板变量或 Templating 变量）。每个模块内部都遵循统一的"构造函数 + 链式配置"的 API 模式，通过 Jsonnet 的 `+` 操作符叠加配置。

### 安装与初始化

首先需要安装 Jsonnet 工具链的核心组件。在 macOS 上可以直接通过 Homebrew 安装，Linux 环境则需要从 Go 源码编译或下载预编译二进制文件。除了 Jsonnet 解释器本身，还需要安装 Jsonnet Bundler（简称 `jb`），它类似于 Node.js 的 npm 或 Python 的 pip，负责管理 Jsonnet 项目的第三方库依赖。

```bash
# macOS 安装
brew install jsonnet jsonnet-bundler go-jsonnet

# Linux 安装（从 Go 源码）
go install github.com/google/go-jsonnet/cmd/jsonnet@latest
go install github.com/jsonnet-bundler/jsonnet-bundler/cmd/jb@latest

# 验证安装
jsonnet --version
jb --version
```

初始化项目并安装 Grafonnet 库：

```bash
mkdir grafana-dashboards && cd grafana-dashboards
jb init
jb install github.com/grafana/grafonnet/grafonnet-base@main
```

安装完成后，项目根目录下会生成 `vendor/` 目录（存放下载的依赖库）和 `jsonnetfile.json`（记录依赖声明）。`jsonnetfile.lock.json` 锁定具体的 Commit SHA，确保团队成员和 CI 环境使用完全一致的依赖版本。

```json
{
  "version": 1,
  "dependencies": [
    {
      "source": {
        "git": {
          "remote": "https://github.com/grafana/grafonnet",
          "subdir": "grafonnet-base"
        }
      },
      "version": "main"
    }
  ],
  "legacyImports": true
}
```

---

## Panel 类型实战

掌握各种面板类型的 Jsonnet 代码编写是 Dashboard as Code 实践的基本功。下面分别介绍最常用的四种面板类型及其最佳实践。

### TimeSeries 面板

TimeSeries 是 Grafana 中使用频率最高的面板类型，用于展示指标随时间变化的趋势曲线。在 Grafonnet 中，TimeSeries 面板的构建采用"构造函数 + 配置叠加"模式：先通过 `panel.timeSeries.new()` 创建基础面板对象，然后通过 `+` 操作符依次叠加各项配置。这种方式的好处是每个配置项都是独立的、可复用的函数调用，你可以在不同的面板之间共享通用配置片段。

```jsonnet
local grafonnet = import 'grafonnet/grafonnet/main.libsonnet';
local dashboard = grafonnet.dashboard;
local panel = grafonnet.panel;
local query = grafonnet.query;
local var = grafonnet.var;

{
  local httpRequestsPanel =
    panel.timeSeries.new('HTTP Requests Rate')
    + panel.timeSeries.panelOptions.withGridPos(x=0, y=0, w=12, h=8)
    + panel.timeSeries.queryOptions.withTargets([
      query.prometheus.new(
        datasource='prometheus-production',
        expr='sum(rate(http_requests_total{namespace="$namespace", job="$job"}[5m])) by (method, status)',
      )
      + query.prometheus.withLegendFormat('{{method}} {{status}}'),
    ])
    + panel.timeSeries.standardOptions.withUnit('reqps')
    + panel.timeSeries.standardOptions.withDecimals(2)
    + panel.timeSeries.standardOptions.thresholds.withSteps([
      { color: 'green', value: null },
      { color: 'yellow', value: 1000 },
      { color: 'red', value: 5000 },
    ])
    + panel.timeSeries.fieldConfig.defaults.custom.withLineInterpolation('smooth')
    + panel.timeSeries.fieldConfig.defaults.custom.withFillOpacity(15)
    + panel.timeSeries.fieldConfig.defaults.custom.withGradientMode('scheme')
    + panel.timeSeries.fieldConfig.defaults.custom.withPointSize(3),
}
```

在上面的示例中，有几个值得注意的实践细节。首先，查询表达式中使用了 `$namespace` 和 `$job` 变量引用，这意味着面板会自动适配 Dashboard 变量选择器的当前值，无需硬编码具体的服务名称。其次，`legendFormat` 使用了 Grafana 的模板语法 `{{label}}`，将 Prometheus 标签值动态插入图例文本中。第三，`thresholds` 配置了三级颜色阶梯，使得面板在不同数值范围内自动变色，为运维人员提供直观的视觉告警。最后，`fillOpacity`、`gradientMode` 和 `pointSize` 等视觉配置确保了面板在暗色主题下的可读性和美观性。

### Stat 面板

Stat 面板用于展示单一关键数值（如错误率、可用率、QPS 总量），通常放置在 Dashboard 的概览行，方便运维人员一目了然地掌握系统健康状态。与 TimeSeries 不同，Stat 面板通常使用 `instantQuery` 模式，只查询当前时刻的值而非时间范围内的趋势数据。

```jsonnet
  local errorRatePanel =
    panel.stat.new('Error Rate (5xx)')
    + panel.stat.panelOptions.withGridPos(x=12, y=0, w=6, h=4)
    + panel.stat.queryOptions.withTargets([
      query.prometheus.new(
        datasource='prometheus-production',
        expr='sum(rate(http_requests_total{namespace="$namespace", status=~"5.."}[5m])) / sum(rate(http_requests_total{namespace="$namespace"}[5m])) * 100',
      )
      + query.prometheus.withInstantQuery(true),
    ])
    + panel.stat.standardOptions.withUnit('percent')
    + panel.stat.standardOptions.withDecimals(2)
    + panel.stat.standardOptions.thresholds.withSteps([
      { color: 'green', value: null },
      { color: 'yellow', value: 0.5 },
      { color: 'red', value: 2 },
    ])
    + panel.stat.options.withColorMode('background')
    + panel.stat.options.withGraphMode('area')
    + panel.stat.options.withTextMode('auto'),
```

`withColorMode('background')` 会根据阈值为整个面板卡片着色，这比默认的文字颜色模式更具视觉冲击力。`withGraphMode('area')` 在数值下方显示一个微型趋势图，帮助运维人员快速判断指标是上升还是下降趋势。`withTextMode('auto')` 让 Grafana 自动根据面板大小调整数值和标题的字号比例。

### Table 面板

Table 面板适合展示结构化的列表数据，例如 API 端点耗时排行榜、错误类型分布统计、实例健康状态列表等。在 Grafonnet 中，Table 面板的配置需要特别注意 `withFormat('table')` 和 `withInstantQuery(true)` 的组合使用，因为 Table 面板通常需要表格格式的即时查询结果。

```jsonnet
  local topEndpointsPanel =
    panel.table.new('Top Slow Endpoints')
    + panel.table.panelOptions.withGridPos(x=0, y=8, w=12, h=8)
    + panel.table.queryOptions.withTargets([
      query.prometheus.new(
        datasource='prometheus-production',
        expr='topk(10, histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace="$namespace"}[5m])) by (le, handler)))',
      )
      + query.prometheus.withInstantQuery(true)
      + query.prometheus.withFormat('table'),
    ])
    + panel.table.options.withShowHeader(true)
    + panel.table.options.withSortBy({ displayName: 'Value', desc: true })
    + panel.table.standardOptions.withUnit('s')
    + panel.table.standardOptions.withDecimals(3)
    + panel.table.standardOptions.overrides([
      {
        matcher: { id: 'byName', options: 'handler' },
        properties: [
          { id: 'custom.width', value: 300 },
          { id: 'links', value: [
            {
              title: 'View Endpoint Details',
              url: '/d/endpoint-detail?var-handler=${__value.text}',
            },
          ] },
        ],
      },
    ]),
```

Table 面板的一个高级特性是通过 `overrides` 为特定列配置数据链接（Data Links）。上面的示例中，`handler` 列被设置为可点击的链接，点击后会跳转到另一个 Dashboard 并自动传递选中的 handler 名称作为变量参数。这种跨 Dashboard 的联动导航是构建可钻取式（Drill-down）监控体系的关键技术。

### Heatmap 面板

Heatmap 面板是分析请求延迟分布的利器，特别适合识别长尾延迟问题。它将 Prometheus 的 Histogram 类型指标以热力图的形式展示，颜色深浅表示在某个延迟区间内的请求数量密度。

```jsonnet
  local latencyHeatmapPanel =
    panel.heatmap.new('Request Latency Distribution')
    + panel.heatmap.panelOptions.withGridPos(x=12, y=8, w=12, h=8)
    + panel.heatmap.queryOptions.withTargets([
      query.prometheus.new(
        datasource='prometheus-production',
        expr='sum(rate(http_request_duration_seconds_bucket{namespace="$namespace", job="$job"}[5m])) by (le)',
      )
      + query.prometheus.withFormat('heatmap')
      + query.prometheus.withLegendFormat('{{le}}'),
    ])
    + panel.heatmap.options.withCalculate(true)
    + panel.heatmap.options.withCellGap(2)
    + panel.heatmap.options.withColor({
      mode: 'scheme',
      schemeName: 'Oranges',
      steps: [
        { color: 'transparent', value: null },
        { color: 'light-orange', value: 10 },
        { color: 'orange', value: 50 },
        { color: 'dark-orange', value: 100 },
      ],
    })
    + panel.heatmap.options.withYAxis({ unit: 's', decimals: 3 }),
```

Heatmap 面板的查询必须使用 `by (le)` 分组，且格式设置为 `heatmap`，这样 Grafana 才能正确解析 Prometheus Histogram Bucket 数据并渲染热力图。颜色方案的选择也很重要——推荐使用单色渐变方案（如 Oranges、Blues），避免使用多色方案导致视觉混乱。Y 轴单位必须与查询指标的单位一致（这里是秒 `s`）。

---

## Row 与 Layout 组织

当 Dashboard 包含大量面板时，合理使用 Row 进行逻辑分组不仅提升可读性，更是性能优化的关键手段。Grafana 的网格布局基于 24 列宽的栅格系统，每个面板通过 `withGridPos(x, y, w, h)` 精确定位，其中 `x` 是水平起始列（0-23），`y` 是垂直起始行（像素级），`w` 是面板宽度（列数），`h` 是面板高度（以 Grafana 的行高单位计算，通常 1 行约为 30 像素）。

Row 面板的独特之处在于它的折叠机制。当一个 Row 被设置为 `withCollapsed(true)` 时，该 Row 内的所有面板在 Dashboard 初始加载时不会发起任何数据查询。只有当用户手动展开该 Row 时，面板才会开始查询数据源。这个特性对于包含数十个面板的大型 Dashboard 来说意义重大——它将初始加载时的并发查询数量从"所有面板"减少到"仅可见面板"，显著降低了 Prometheus 的查询压力，同时加快了 Dashboard 的渲染速度。

```jsonnet
  local overviewRow =
    panel.row.new('Overview - 关键指标总览')
    + panel.row.withCollapsed(false)
    + panel.row.withGridPos(x=0, y=0, w=24, h=1)
    + panel.row.panels([
      errorRatePanel,
      uptimePanel,
    ]),

  local httpRow =
    panel.row.new('HTTP Layer - 请求详情')
    + panel.row.withCollapsed(true)
    + panel.row.withGridPos(x=0, y=10, w=24, h=1)
    + panel.row.panels([
      httpRequestsPanel,
      topEndpointsPanel,
      latencyHeatmapPanel,
    ]),
```

最佳实践是将最重要的概览面板放在第一个 Row（不折叠），将详情和调试类面板放在后续 Row（默认折叠）。这样运维人员打开 Dashboard 时首先看到的是最关键的全局指标，只有在需要深入排查时才展开对应的详情 Row。

在实际项目中，当面板数量较多时，手动计算每个面板的 `x`、`y` 坐标会非常繁琐且容易出错。Grafonnet 提供了 `util.grid` 工具函数来自动排列面板到网格中，你只需指定面板宽度、高度和每行面板数量，工具会自动计算最优的布局坐标。

---

## 变量与模板化

Dashboard 变量（Templating）是 Grafana 实现"一个 Dashboard 服务多个实体"的核心机制。通过变量，用户可以在 Dashboard 顶部的下拉菜单中选择不同的值（如不同的命名空间、服务名称、环境），所有面板的查询会自动根据选择更新。在 Grafonnet 中，变量定义更加结构化和类型安全，支持四种主要的变量类型：数据源变量、查询变量、自定义变量和间隔变量。

数据源变量允许用户在多个 Prometheus 实例之间切换，这对于多环境场景至关重要。查询变量通过 PromQL 的 `label_values()` 函数从 Prometheus 动态获取可选值列表，避免了手动维护选项列表的麻烦。自定义变量适用于有限的、固定的选项集合（如环境名称列表）。间隔变量则与 `$__rate_interval` 等内置函数配合使用，控制聚合查询的时间窗口大小。

```jsonnet
local var = grafonnet.var;

// 数据源变量
local datasourceVar =
  var.datasource.new('datasource', 'prometheus')
  + var.datasource.generalOptions.withLabel('Data Source')
  + var.datasource.generalOptions.withCurrent({
    text: 'prometheus-production',
    value: 'prometheus-production',
  })
  + var.datasource.generalOptions.withHide(0),

// 查询变量 - 动态获取 namespace 列表
local namespaceVar =
  var.query.new('namespace')
  + var.query.withDatasource('prometheus', '$datasource')
  + var.query.queryTypes.withLabelValues(
    'kube_namespace_labels',
    'namespace',
  )
  + var.query.generalOptions.withLabel('Namespace')
  + var.query.selectionOptions.withIncludeAll(true)
  + var.query.selectionOptions.withMulti(false)
  + var.query.refresh.onLoad()
  + var.query.refresh.onTime(),

// 自定义变量
local envVar =
  var.custom.new('env', ['dev', 'staging', 'production'])
  + var.custom.generalOptions.withLabel('Environment')
  + var.custom.generalOptions.withCurrent({
    text: 'production',
    value: 'production',
  }),

// 间隔变量
local intervalVar =
  var.interval.new('interval', ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'])
  + var.interval.generalOptions.withLabel('Aggregation Interval')
  + var.interval.generalOptions.withCurrent({
    text: '5m',
    value: '5m',
  }),
```

多环境数据源切换是 DaC 的核心价值之一。通过将数据源名称参数化为变量，我们可以在不修改任何 Dashboard 代码的前提下，让同一套 Dashboard 同时服务开发、测试和生产环境。用户只需在页面顶部的下拉菜单中切换数据源，所有面板便会自动查询对应环境的 Prometheus 实例。这种方式彻底消除了"为每个环境维护独立 Dashboard"或"部署时手动替换数据源名称"的麻烦。

变量之间还可以建立级联依赖关系。例如，当用户选择了特定的 namespace 后，job 变量的可选值应该只包含该 namespace 下存在的 job。这通过在查询变量的 `expr` 中引用其他变量来实现，Grafana 会自动处理变量刷新的依赖顺序。

---

## 版本控制工作流

将 Dashboard 代码纳入 Git 管理后，我们可以建立一套完整的版本控制工作流，涵盖代码组织、分支策略、变更审查和审计追踪。

推荐的目录结构采用按团队/服务的层级组织方式。`lib/` 目录存放共享的公共库（通用面板模板、标准变量集、命名规范工具等），`services/` 目录按服务名组织各个 Dashboard 的入口文件和面板定义文件，`infrastructure/` 目录存放基础设施级别的 Dashboard（如 Kubernetes 集群总览、Node Exporter 主机监控等）。`generated/` 目录存放 Jsonnet 编译产物——即最终的 JSON 文件，建议将其纳入 Git 管理以便于审计和快速回滚。

```bash
grafana-dashboards/
├── dashboards/
│   ├── lib/
│   │   ├── common.libsonnet
│   │   ├── variables.libsonnet
│   │   └── alerts.libsonnet
│   ├── services/
│   │   ├── user-service/
│   │   │   ├── main.jsonnet
│   │   │   └── panels.jsonnet
│   │   └── payment-service/
│   │       ├── main.jsonnet
│   │       └── panels.jsonnet
│   └── infrastructure/
│       ├── kubernetes.jsonnet
│       └── node-exporter.jsonnet
├── generated/
│   ├── services/
│   │   ├── user-service.json
│   │   └── payment-service.json
│   └── infrastructure/
│       └── ...
├── Makefile
├── jsonnetfile.json
└── README.md
```

在 Code Review 阶段，审查人员需要重点关注以下几个方面：第一是面板查询效率——检查 PromQL 表达式是否包含足够的标签过滤器，避免对 Prometheus 造成全量扫描压力；确认是否使用了 `topk()`、`bottomk()` 等限制返回结果数量的函数。第二是变量注入安全——确认所有面板查询都通过 `$variable` 引用变量值，而非硬编码环境特定的字符串。第三是阈值合理性——告警和可视化阈值是否有足够的缓冲区，避免因正常波动而频繁变色告警。第四是布局一致性——面板尺寸和位置是否遵循团队的视觉规范标准。

Makefile 中定义的编译和验证命令将 Jsonnet 到 JSON 的编译过程标准化。`make build` 命令会遍历所有 `.jsonnet` 入口文件并调用 `jsonnet` 解释器生成对应的 JSON 文件。`make validate` 命令对生成的 JSON 进行语法验证。`make diff` 命令展示本次编译与上次 Git 记录之间的差异，方便开发者确认变更是否符合预期。

---

## CI/CD 集成

Dashboard as Code 的真正威力在与 CI/CD 流水线集成后才能完全释放。通过自动化工作流，Dashboard 代码从提交到部署的整个过程无需任何人工干预，同时保留了完整的审计追踪能力。

### GitHub Actions 工作流

以下是一个完整的 GitHub Actions 工作流配置，实现了从 PR 创建时自动验证到合并后自动部署的全链路自动化。工作流分为两个 Job：`build-and-validate` 在每次 Push 和 PR 时执行，负责安装依赖、编译 Jsonnet、验证 JSON 语法；`deploy` 仅在 main 分支的 Push 事件中触发，通过 Grafana HTTP API 将编译后的 Dashboard JSON 部署到 Grafana 实例。

```yaml
name: Grafana Dashboards CI/CD

on:
  push:
    branches: [main]
    paths: ['dashboards/**', 'jsonnetfile.json']
  pull_request:
    branches: [main]
    paths: ['dashboards/**', 'jsonnetfile.json']

jobs:
  build-and-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Jsonnet tools
        run: |
          curl -Lo jsonnet.tar.gz https://github.com/google/go-jsonnet/releases/download/v0.20.0/go-jsonnet_0.20.0_Linux_x86_64.tar.gz
          tar xzf jsonnet.tar.gz && sudo mv jsonnet /usr/local/bin/
          curl -Lo jb https://github.com/jsonnet-bundler/jsonnet-bundler/releases/download/v0.5.1/jb-linux-amd64
          chmod +x jb && sudo mv jb /usr/local/bin/

      - name: Install dependencies
        run: jb install

      - name: Compile and validate
        run: make build validate

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: grafana-dashboards
          path: generated/

  deploy:
    needs: build-and-validate
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Install, Build & Deploy
        env:
          GRAFANA_URL: ${{ secrets.GRAFANA_URL }}
          GRAFANA_API_KEY: ${{ secrets.GRAFANA_API_KEY }}
        run: |
          jb install && make build
          for f in $(find generated -name '*.json'); do
            payload=$(jq -n --slurpfile d "$f" \
              '{dashboard: $d[0], overwrite: true, message: "CI/CD deploy"}')
            curl -s -X POST "$GRAFANA_URL/api/dashboards/db" \
              -H "Authorization: Bearer $GRAFANA_API_KEY" \
              -H "Content-Type: application/json" \
              -d "$payload" | jq '.status'
          done
```

### GitLab CI 配置

GitLab CI 的配置思路与 GitHub Actions 类似，但利用了 GitLab 特有的环境管理和审批机制。

```yaml
stages:
  - build
  - validate
  - deploy

build-dashboards:
  stage: build
  image: alpine:latest
  script:
    - apk add --no-cache curl jq make
    - make install-tools install-deps build
  artifacts:
    paths: [generated/]
    expire_in: 1 week

validate-dashboards:
  stage: validate
  dependencies: [build-dashboards]
  script:
    - make validate

deploy-grafana:
  stage: deploy
  dependencies: [build-dashboards]
  script:
    - make deploy GRAFANA_URL=$GRAFANA_URL GRAFANA_API_KEY=$GRAFANA_API_KEY
  only: [main]
  environment: production
  when: manual  # 需要手动确认才执行部署
```

值得注意的是 GitLab CI 中设置了 `when: manual`，这意味着部署到生产环境需要人工在 GitLab Pipeline 页面上点击"Run"按钮确认。这种"自动构建 + 手动部署"的模式在运维场景中非常实用，它既享受了自动化的效率优势，又保留了关键操作的人工审核把关。

---

## 团队协作模式

Dashboard as Code 不仅是技术实践，更是团队协作模式的变革。当 Dashboard 变成代码后，我们便可以借鉴软件工程中成熟的协作模式来管理监控面板。

### Dashboard Ownership 模型

在多团队共用同一个 Grafana 实例的组织中，明确每个 Dashboard 的归属至关重要。通过在 Dashboard JSON 的 `annotations` 中注入标准化的元数据字段，我们可以建立一套机器可读的所有权信息，用于自动化告警路由、权限管理和变更审批。

```jsonnet
{
  metadata:: {
    user_service: {
      team: 'platform-eng',
      owner: 'zhang.san@company.com',
      slack: '#platform-alerts',
      runbook: 'https://wiki.company.com/runbooks/user-service',
    },
  },

  withOwnership(dashboard, serviceKey)::
    local meta = self.metadata[serviceKey];
    dashboard
    + grafonnet.dashboard.withLinks([
      {
        title: 'Runbook',
        url: meta.runbook,
        type: 'link',
        icon: 'doc',
        targetBlank: true,
      },
    ]),
}
```

### 代码评审规范

团队应建立统一的 Jsonnet 代码评审 Checklist，包括但不限于以下条款：Dashboard UID 必须使用 `{team}-{service}-{purpose}` 格式以确保全局唯一性；所有 PromQL 查询必须包含 namespace 或 job 过滤器以防止全量扫描；所有支持变量替换的标签值必须使用 `$variable` 语法；复杂查询必须在面板描述中说明业务含义和告警关联；`generated/` 目录下的 JSON 必须随代码一起提交以便审计。

### 多团队共享库

将通用的面板模板和配置片段抽象为共享 Jsonnet 库是实现大规模 DaC 复用的关键。每个团队都可以在自己的 Dashboard 代码中导入共享库，调用标准化的面板构造函数，只需传入服务特定的参数（数据源名称、命名空间等），即可获得风格统一、功能完整的标准面板集。当共享库需要更新时（例如统一调整颜色方案或新增通用面板），只需修改库代码并让各团队重新编译，所有使用该库的 Dashboard 都会自动获得更新，彻底消除了"逐个手动修改"的维护噩梦。

---

## 与 Terraform Provider 对比

Grafana 生态提供了两种主流的 DaC 方案：Grafonnet（Jsonnet）和 Terraform Provider（`grafana_dashboard` 资源）。理解两者的适用场景和优劣对比，对于选择合适的技术方案至关重要。

Terraform Provider 的 `grafana_dashboard` 资源可以创建、更新和删除 Dashboard，同时还能管理 Folder、Data Source、Alert Rule、Contact Point 等 Grafana 的全部资源类型。它的核心优势在于状态管理——Terraform 通过 State 文件追踪每个资源的当前状态，`terraform plan` 命令可以在执行前预览所有将要发生的变更，`terraform destroy` 可以精确地清理已删除的资源。

然而，Terraform Provider 在 Dashboard 生成方面存在明显短板。它需要预先提供完整的 Dashboard JSON，自身并不提供任何 JSON 生成或抽象的能力。虽然可以使用 `templatefile()` 函数实现简单的模板替换，但这远不如 Jsonnet 的编程能力强大。此外，将完整的 Dashboard JSON 嵌入 HCL 的 `config_json = file(...)` 语法中，本质上并没有解决 JSON 可读性和复用性的问题。

| 维度 | Grafonnet/Jsonnet | Terraform Provider |
|------|-------------------|-------------------|
| Dashboard 生成 | 编程语言级别抽象，支持函数、继承、条件 | 需要预先提供完整 JSON |
| 代码复用 | 原生支持库、模块、导入 | 依赖 Terraform 模块和 `templatefile` |
| 多资源管理 | 仅负责 Dashboard JSON 生成 | 同时管理 Folder、Datasource、Alert、Permission |
| 状态管理 | 无状态，每次全量部署 | Terraform State 追踪，支持 Plan 预览 |
| 变更预览 | 需要自行 diff 生成的 JSON | `terraform plan` 直接展示变更 |

**生产环境的最佳实践是两者组合使用**：用 Grafonnet 负责 Dashboard JSON 的生成和抽象（利用其强大的编程能力实现模板复用和参数化），用 Terraform Provider 负责 Dashboard 的部署和生命周期管理（利用其状态管理和变更预览能力）。编译后的 JSON 文件可以直接被 Terraform Provider 的 `file()` 函数读取，形成完整的工具链。

---

## 生产级最佳实践

### 命名规范

建立团队统一的命名规范是大规模 DaC 实践的基础设施。Dashboard UID 是 Grafana 内部的全局唯一标识符，使用不规范的 UID（如随机字符串或时间戳）会导致 Dashboard 之间的链接失效、书签丢失等问题。推荐的 UID 格式为 `{team}-{service}-{scope}`，例如 `platform-user-service-overview`。面板标题应简洁明了地描述所展示的指标和聚合方式。标签应包含团队、服务和分类信息，用于 Grafana 的搜索和筛选功能。

### 性能优化

大型 Dashboard 的性能优化需要从多个维度入手。首先，充分利用 Row 折叠机制减少初始加载时的查询数量。其次，对于计算复杂的 PromQL 表达式，建议在 Prometheus 端配置 Recording Rules 进行预计算，Dashboard 查询直接使用预计算结果。第三，通过 `withMaxDataPoints()` 限制每个面板返回的最大数据点数，防止在长时间范围查询时产生过大的响应数据。第四，合理使用间隔变量 `$interval` 控制聚合粒度，避免对过于细粒度的数据进行长时间范围的查询。

### 告警规则联动

将 Dashboard 面板查询与 Prometheus 告警规则保持一致是避免"监控盲区"的关键。最佳实践是在 Jsonnet 共享库中同时定义面板查询和告警规则的查询表达式，确保两者使用完全相同的 PromQL。这样做的好处是：当告警触发时，运维人员可以直接点击告警消息中的 Dashboard 链接跳转到对应的面板，看到的数据与告警判断时使用的数据完全一致，消除了因查询口径不一致导致的排查困惑。

---

## 总结与展望

Grafana Dashboard as Code 不仅仅是一种技术实践，更是可观测性工程化的重要里程碑。通过 Grafonnet 和 Jsonnet，我们将监控面板从"手工艺术品"转变为"工程化产物"——它拥有版本控制带来的可追溯性、代码评审带来的质量保障、自动化部署带来的效率提升，以及模板复用带来的规模化管理能力。

在本文中，我们从 Jsonnet 语言的基础语法和设计理念出发，逐步深入到 Grafonnet 的库结构和安装配置。在实战环节中，我们详细讲解了 TimeSeries、Stat、Table、Heatmap 四种最常用面板类型的 Jsonnet 编写方法，涵盖了 Row 布局组织、变量模板化、多环境切换等关键功能。随后，我们探讨了 Git 版本控制工作流、GitHub Actions 和 GitLab CI 的 CI/CD 集成方案、团队协作模式和代码评审规范。在技术选型部分，我们对比分析了 Grafonnet 与 Terraform Provider 的优劣，并给出了组合使用的最佳实践。最后，我们分享了命名规范、性能优化和告警联动等生产级实战经验。

展望未来，Grafonnet 生态正在快速演进。Grafonnet v2 引入了更严格的类型系统和更好的 IDE 支持（通过 Jsonnet Language Server 实现自动补全和类型检查）。Grafana 社区也在探索将 Dashboard as Code 与新一代 Alerting 框架、SLO 管理、Incident Response 等功能深度整合，实现从"代码定义可视化"到"代码定义可观测性"的全面升级。无论你的团队规模如何，从今天开始将 Dashboard 纳入代码仓库，用版本控制替代手动导出，用代码评审替代盲目信任，都是构建健壮可观测性体系的正确第一步。监控即代码，代码即信任。

## 相关阅读

- [监控告警实战：Prometheus Alertmanager + Grafana 告警规则设计](/categories/运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
- [Grafana Pyroscope 实战：持续性能剖析——Laravel 应用的生产环境火焰图与根因定位方法论](/categories/运维/Grafana-Pyroscope-实战-持续性能剖析-Laravel应用的生产环境火焰图与根因定位方法论/)
- [PromQL 进阶实战：rate/histogram_quantile/label_replace——Laravel API 监控的高级查询与告警规则设计](/categories/运维/PromQL-进阶实战-rate-histogram_quantile-label_replace-Laravel-API监控高级查询与告警规则设计/)
