# SRE 与可靠性工程

## 定义

SRE（Site Reliability Engineering）是 Google 提出的工程化运维方法论，通过 **SLI（Service Level Indicator）、SLO（Service Level Objective）、Error Budget（错误预算）** 三大核心指标，将「可靠性」从模糊的运维直觉量化为可度量、可决策、可协商的工程指标。SRE 的本质是用软件工程思维解决运维问题——当可靠性足够高时，把多余的可靠性预算转化为功能迭代速度。

## 核心原理

### SLI → SLO → Error Budget 三层模型

```
SLI（指标）         SLO（目标）         Error Budget（预算）
  │                   │                    │
  │ 每秒请求数         │ 可用性 99.9%       │ 月度允许宕机 43.8min
  │ P99 延迟           │ P99 < 500ms       │ 超出 → 冻结新功能
  │ 错误率             │ 错误率 < 0.1%     │ 剩余 → 加速迭代
```

**SLI（Service Level Indicator）**：衡量服务健康的核心指标。常用 SLI 包括：
- **可用性**：成功请求数 / 总请求数（HTTP 2xx/3xx 比例）
- **延迟**：P50 / P95 / P99 响应时间
- **吞吐量**：每秒处理请求数（QPS/RPS）
- **错误率**：5xx 错误占总请求比例

**SLO（Service Level Objective）**：SLI 的目标值。SLO 不是「越高越好」，而是业务可接受的最低可靠性阈值：
- 99.9%（三个 9）= 月度宕机 43.8 分钟 → 适合内部工具
- 99.95% = 月度宕机 21.9 分钟 → 适合 B2B SaaS
- 99.99%（四个 9）= 月度宕机 4.38 分钟 → 适合支付/交易系统

**Error Budget**：`Error Budget = 1 - SLO`。当 SLO 为 99.9% 时，月度有 0.1%（约 43.8 分钟）的错误预算。Error Budget 的核心价值：
- **预算充足** → 团队可以激进发布新功能
- **预算耗尽** → 冻结新功能发布，优先修复稳定性
- **预算透支** → 启动 incident review，回滚到稳定版本

### 告警分级与告警疲劳治理

告警疲劳（Alert Fatigue）是 SRE 的大敌。当告警过多时，运维人员会逐渐忽略告警，导致真正的问题被淹没在噪音中。

**四级告警分级**：
| 级别 | 条件 | 响应时间 | 通知方式 |
|---|---|---|---|
| P0 Critical | 服务完全不可用 | 5 分钟 | 电话 + 短信 + PagerDuty |
| P1 High | SLO 即将违反（Error Budget < 20%） | 15 分钟 | 短信 + Slack |
| P2 Medium | 单实例故障、非核心功能降级 | 1 小时 | Slack + Email |
| P3 Low | 性能退化、非紧急告警 | 下个工作日 | Email + 工单 |

**告警疲劳治理策略**：
- 每条告警必须有明确的 **Runbook**（处理手册）
- 每季度 Review 告警规则，删除无人处理的告警
- 使用 Alertmanager 的 **抑制（Inhibition）** 和 **分组（Grouping）** 减少重复告警
- 引入 **多窗口燃烧速率**（Multi-window Burn Rate）告警，只在真正影响 SLO 时才触发

### Incident Command 与应急响应

生产故障的应急响应需要结构化的协作流程：

**Incident Severity 分级**：
- **SEV-1**：全面服务中断，影响所有用户 → 全员响应
- **SEV-2**：核心功能降级，影响多数用户 → 相关团队响应
- **SEV-3**：非核心功能异常，影响少数用户 → 值班人员处理

**应急响应三阶段**：
1. **Detect（检测）**：监控告警自动触发 → 值班人员确认 → 升级 Severity
2. **Respond（响应）**：Incident Commander 指挥 → War Room 协作 → 止血优先
3. **Recover（恢复）**：根因修复 → 验证恢复 → Postmortem

**Postmortem 文化**：
- 无指责（Blameless）复盘——关注系统改进，不追究个人
- 记录 Timeline、Root Cause、Action Items
- Action Items 必须有 Owner 和 Deadline
- 定期回顾历史 Postmortem 验证改进效果

## 实战案例

来自博客文章：
- [SRE 实战入门：SLI/SLO/Error Budget 在 Laravel B2C API 中的落地](/2026/06/01/sre-sli-slo-error-budget-laravel-b2c-api/)
- [SLO/SLI 实战：用服务等级目标驱动可靠性——Laravel API 的 Error Budget 与告警策略](/2026/06/01/slo-sli-error-budget-laravel/)
- [Incident Command 实战：生产故障应急响应——PagerDuty 集成、War Room 协作与 Postmortem 文化](/2026/06/01/incident-command-pagerduty-war-room-postmortem/)

## 相关概念

- [Prometheus 监控告警](Prometheus监控告警.md) — SLI 数据采集与告警规则
- [OpenTelemetry 可观测性](OpenTelemetry可观测性.md) — 分布式链路追踪支撑 SLI 度量
- [Chaos Engineering 与韧性测试](Chaos-Engineering与韧性测试.md) — 验证 SLO 是否真正可靠
- [FinOps 与云成本治理](FinOps与云成本治理.md) — 可靠性与成本的平衡

## 常见问题

**Q: SLO 应该设多高？**
A: 不是越高越好。SLO 越高，迭代速度越慢。建议从当前实际 SLI 值开始，逐步提升。例如当前可用性 99.5%，先设 SLO 为 99.5%，稳定后再提升到 99.9%。

**Q: Error Budget 耗尽后怎么办？**
A: 冻结新功能发布，优先投入稳定性建设（增加监控、修复已知 Bug、提升容错能力）。Error Budget 恢复到 50% 以上后，再逐步恢复功能迭代。

**Q: 如何避免告警疲劳？**
A: 三条原则：(1) 每条告警必须可操作（Actionable），不可操作的告警删除；(2) 每条告警必须有 Runbook；(3) 定期 Review，删除历史无人处理的告警。
