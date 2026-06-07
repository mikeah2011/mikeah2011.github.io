# Prometheus 监控告警

## 定义

Prometheus 是 CNCF 毕业的开源监控系统，采用拉取模型（Pull-based）定期从目标服务的 HTTP 端点（`/metrics`）采集时间序列数据。配合 Grafana 做可视化、Alertmanager 做告警路由，三者构成云原生监控的事实标准栈。

## 核心原理

### 数据模型
Prometheus 以时间序列（Time Series）存储数据，每条序列由指标名（Metric Name）和标签集（Label Set）唯一标识：

```
http_requests_total{method="GET", path="/api/users", status="200"} 15234
```

四种指标类型：
- **Counter**：单调递增（如请求总数、错误总数）
- **Gauge**：可增可减的瞬时值（如内存使用、队列长度）
- **Histogram**：分桶统计分布（如请求延迟分布）
- **Summary**：客户端计算的分位数（类似 Histogram，但不支持聚合）

### PromQL 查询语言
PromQL 是 Prometheus 的函数式查询语言，支持即时查询和范围查询：

```promql
# 请求速率（每秒）
rate(http_requests_total[5m])

# 错误率
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# P99 延迟
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# 内存使用趋势
process_resident_memory_bytes / 1024 / 1024
```

### 告警规则设计
告警规则定义在 `rules/*.yml` 中，分为四个级别：

| 级别 | 含义 | 通知方式 | 示例 |
|---|---|---|---|
| P0 Critical | 服务不可用 | 电话 + 短信 + 群消息 | 所有实例宕机、数据库无法连接 |
| P1 High | 服务降级 | 短信 + 群消息 | 错误率 > 5%、P99 > 2s |
| P2 Medium | 需要关注 | 群消息 | CPU > 80%、磁盘 > 85% |
| P3 Low | 信息通知 | 邮件/日报 | 缓存命中率下降、证书即将过期 |

### Alertmanager 路由与抑制
Alertmanager 负责告警的路由、分组、抑制和静默：

- **路由（Route）**：根据标签将告警分发到不同的接收器（PagerDuty、Slack、邮件）
- **分组（Group）**：将同一时间段内的相似告警合并为一条通知
- **抑制（Inhibit）**：当高优先级告警触发时，自动抑制低优先级告警
- **静默（Silence）**：维护窗口期间临时屏蔽特定告警

### 告警疲劳治理
生产环境中最大的挑战不是"没告警"，而是"告警太多且没用"。治理策略：
1. **告警审计**：定期清理无人响应的告警规则
2. **for 持续时间**：设置合理的触发持续时间，避免瞬时抖动误报
3. **聚合告警**：对同类问题只发一条汇总而非逐实例告警
4. **Runbook URL**：每条告警附带处理手册链接

## 实战案例

来自博客文章：
- [监控告警实战：Prometheus Alertmanager + Grafana 告警规则设计](/2026/06/01/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/) — 完整的告警体系设计，覆盖主机/中间件/应用/业务四个维度
- [用 AI Agent 实现自动化 DevOps](/2026/06/02/用-AI-Agent-实现自动化-DevOps/) — Prometheus + LLM 联动智能异常检测
- [Sentry 实战：错误追踪深度使用](/2026/06/02/sentry-error-tracking-performance-monitoring-session-replay-laravel/) — Sentry 与 Prometheus 的互补关系

## 相关概念

- [Grafana Loki 日志聚合](GrafanaLoki日志聚合.md) — 日志与指标的关联分析
- [OpenTelemetry 可观测性](OpenTelemetry可观测性.md) — OTLP 协议的指标采集
- [AI Agent 驱动 DevOps](AI-Agent驱动DevOps.md) — 智能告警与自动修复

## 常见问题

### 高基数（High Cardinality）导致内存爆炸
- 避免将用户 ID、请求 ID 等无限值作为标签
- 使用 `metric_relabel_configs` 在采集时丢弃高基数标签
- 设置 `--storage.tsdb.retention.time` 控制数据保留时间

### 告警规则不触发
- 使用 Prometheus 的 `/api/v1/rules` 端点检查规则状态
- 在 Prometheus Web UI 的 Graph 页面测试 PromQL 表达式
- 检查 `for` 持续时间是否过长

### Grafana 面板变成"领导看的大屏"
- 面板设计应服务于值班工程师的故障定位流程
- 按 RED 方法（Rate/Error/Duration）或 USE 方法（Utilization/Saturation/Errors）组织面板
- 添加 Drill-down 链接，从概览面板直接跳转到详情面板
