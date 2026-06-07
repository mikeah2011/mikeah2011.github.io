# FinOps 与云成本治理

## 定义

FinOps（Financial Operations）是一种将财务责任融入云资源管理的实践框架。随着云原生架构的普及，云成本从固定成本变为可变成本——用多少付多少，但也意味着「不优化就浪费」。FinOps 的核心是让工程团队拥有成本意识（Cost Awareness），通过标签策略、预算告警、资源优化等手段，在不牺牲性能和可靠性的前提下降低云支出。

## 核心原理

### FinOps 三阶段

```
Inform（通知） → Optimize（优化） → Operate（运营）
     │                │                 │
     ▼                ▼                 ▼
 成本可视化        资源优化           持续治理
 标签策略         竞价实例           预算告警
 按服务分摊       预留实例           成本 KPI
 趋势分析         自动扩缩           定期 Review
```

### 标签策略与按服务分摊

云成本治理的第一步是 **知道钱花在哪里**。通过标签（Tag）将云资源按团队、服务、环境分类：

```
标签体系：
  team: checkout          # 所属团队
  service: payment-api    # 服务名
  environment: production # 环境
  cost-center: CC-001     # 成本中心
```

**AWS 标签策略实践**：
- 使用 AWS Cost Allocation Tags 将资源成本归属到具体服务
- 通过 Cost Explorer 按 `service` 标签分组，查看各服务月度支出
- 设置 Cost Budget，当某服务超出预算时自动告警

### 竞价实例（Spot Instance）

云厂商的闲置算力以 **60-90% 折扣** 出售，但可能被随时回收（中断）。适合容错性强、可中断的工作负载：

| 工作负载类型 | 适合竞价实例 | 原因 |
|---|---|---|
| CI/CD Runner | ✅ | 可重试，不敏感中断 |
| 批量数据处理 | ✅ | 支持检查点恢复 |
| Queue Worker | ✅ | 任务可重新入队 |
| Web API 主实例 | ❌ | 用户请求不可中断 |
| 数据库主实例 | ❌ | 数据一致性要求高 |

**中断处理策略**：
1. **混合调度**：70% 按需实例 + 30% 竞价实例，竞价被回收时自动补充按需
2. **多可用区分散**：在多个 AZ 竞价，降低同时被回收的概率
3. **优雅关闭**：监听 Spot Interruption Notice（2 分钟预警），完成当前任务后退出
4. **K8s Cluster Autoscaler**：自动管理 Spot Node Pool，中断时 Pod 自动迁移

### 预算告警与成本 KPI

```
月度预算：$10,000
├── 实际支出趋势：$8,500（截至 Day 20）
├── 预测月末支出：$12,750（超出预算 27%）
│
├── 告警规则：
│   ├── 80% 预算 → Slack 通知
│   ├── 100% 预算 → Email + Slack 升级
│   └── 120% 预算 → PagerDuty 电话告警
│
└── Action Items:
    ├── 检查是否有异常流量导致资源膨胀
    ├── 评估是否需要扩容或优化
    └── 更新下月预算
```

**成本 KPI 指标**：
- **Cost per Request**：单请求云成本 = 总云成本 / 总请求数
- **Cost per User**：单用户云成本 = 总云成本 / 月活用户数
- **Idle Resource Rate**：闲置资源比例 = 闲置资源成本 / 总成本
- **Reserved Instance Coverage**：预留实例覆盖率

## 实战案例

来自博客文章：
- [FinOps 实战：AWS Cost Explorer + Kubecost 云成本治理——Laravel 微服务的按服务分摊、标签策略与预算告警](/2026/06/01/finops-aws-cost-explorer-kubecost-laravel/)
- [Spot Instance 实战：Laravel 工作负载用竞价实例省钱——中断处理、混合调度与 K8s 自动迁移踩坑记录](/2026/06/01/spot-instance-laravel-cost-optimization/)

## 相关概念

- [SRE 与可靠性工程](SRE与可靠性工程.md) — 可靠性与成本的平衡（Error Budget 概念延伸）
- [Docker 容器化](Docker容器化.md) — 容器资源限制与优化
- [云部署平台选型](云部署平台选型.md) — 各平台定价模型对比
- [基础设施即代码](基础设施即代码.md) — Terraform 管理云资源成本

## 常见问题

**Q: Laravel Queue Worker 适合用竞价实例吗？**
A: 非常适合。Worker 处理的任务可以重新入队（Redis `BRPOPLPUSH`），即使实例被回收，任务也不会丢失。配合 K8s 的 Spot Node Pool + Cluster Autoscaler，可以节省 60-70% 的 Worker 计算成本。

**Q: 如何开始 FinOps 实践？**
A: 三个步骤：(1) **标签化**：给所有云资源打上 `team`/`service`/`environment` 标签；(2) **可视化**：用 AWS Cost Explorer 或 Kubecost 查看按服务分摊的成本；(3) **告警**：设置月度预算告警，超支时通知团队。

**Q: 预留实例和竞价实例怎么搭配？**
A: 基线负载（稳定不变的部分）用预留实例（1 年或 3 年，节省 30-60%）；弹性负载（随流量波动的部分）用竞价实例（节省 60-90%）；突发负载用按需实例（全价，但随时可用）。
