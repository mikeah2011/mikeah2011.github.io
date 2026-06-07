# Chaos Engineering 与韧性测试

## 定义

Chaos Engineering（混沌工程）是一种通过 **主动注入故障** 来验证系统韧性的工程实践。核心理念是：与其等待生产环境自然发生的故障（且往往在最坏的时机），不如在可控条件下主动制造故障，提前发现和修复系统的薄弱环节。Netflix 的 Chaos Monkey 是最早的混沌工程工具，它会在生产环境随机杀死容器实例，迫使工程师构建真正具备容错能力的服务。

## 核心原理

### 混沌工程四步法

```
1. 稳态假设（Steady State Hypothesis）
   → 定义"正常"的度量指标（如：错误率 < 0.1%、P99 < 500ms）

2. 注入故障（Inject Fault）
   → 模拟真实世界的故障场景

3. 观察偏差（Observe Deviation）
   → 对比注入前后的指标变化

4. 修复与验证（Fix & Verify）
   → 修复发现的问题，重复实验验证修复效果
```

### 常见故障注入类型

| 类型 | 工具 | 场景 |
|---|---|---|
| 容器/进程终止 | Chaos Mesh、Litmus Chaos | 模拟 Pod 崩溃、节点宕机 |
| 网络延迟/丢包 | tc（Traffic Control）、Chaos Mesh | 模拟网络抖动、跨机房延迟 |
| 磁盘 I/O 故障 | Chaos Mesh、fio | 模拟磁盘满、I/O 卡顿 |
| CPU/内存压力 | stress-ng、Chaos Mesh | 模拟资源耗尽、GC 风暴 |
| 依赖服务故障 | Toxiproxy、Mock Server | 模拟第三方 API 超时、数据库连接失败 |
| DNS 故障 | Chaos Mesh | 模拟 DNS 解析失败、DNS 缓存污染 |
| 时间偏移 | libfaketime | 模拟时钟漂移、证书过期 |

### Chaos Mesh 实战架构

```
┌─────────────────────────────────────────┐
│            Kubernetes Cluster            │
│                                         │
│  ┌──────────┐    ┌──────────────────┐   │
│  │ Chaos    │    │ Target Pod       │   │
│  │ Daemon   │───→│ (Laravel App)    │   │
│  │          │    │                  │   │
│  └──────────┘    └──────────────────┘   │
│       │                                 │
│  ┌──────────┐    ┌──────────────────┐   │
│  │ Chaos    │    │ Monitoring       │   │
│  │ Dashboard│    │ (Prometheus +    │   │
│  │          │    │  Grafana)        │   │
│  └──────────┘    └──────────────────┘   │
└─────────────────────────────────────────┘
```

Chaos Mesh 以 CRD（Custom Resource Definition）方式部署在 K8s 集群中，通过声明式 YAML 定义故障注入实验：

```yaml
# 示例：模拟网络延迟
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: network-delay
spec:
  action: delay
  mode: one
  selector:
    labelSelectors:
      app: laravel-api
  delay:
    latency: "200ms"
    jitter: "50ms"
  duration: "5m"
```

### 韧性测试层次

```
Level 1: 单实例故障    → 容器重启、健康检查、自愈
Level 2: 依赖故障     → 降级、熔断、重试、超时
Level 3: 网络分区     → CAP 选择、数据一致性策略
Level 4: 区域级故障   → 多区域部署、流量切换、数据同步
Level 5: 级联故障     → 隔离舱、限流、背压
```

## 实战案例

来自博客文章：
- [Chaos Engineering 实战：用 Chaos Mesh 对 Laravel 微服务进行故障注入与韧性测试](/2026/06/01/chaos-engineering-chaos-mesh-laravel/)

## 相关概念

- [SRE 与可靠性工程](SRE与可靠性工程.md) — SLO 驱动的可靠性目标
- [蓝绿部署与零停机发布](蓝绿部署与零停机发布.md) — 发布策略降低故障影响面
- [Prometheus 监控告警](Prometheus监控告警.md) — 故障注入后的指标观测
- [Docker 容器化](Docker容器化.md) — 容器编排与自愈能力
- [微服务架构](../架构设计/微服务架构.md) — 服务间故障传播与隔离

## 常见问题

**Q: Chaos Engineering 只能在生产环境做吗？**
A: 不是。建议从 Staging 环境开始，积累经验后再逐步在生产环境低峰期执行。Netflix 的 Chaos Monkey 之所以敢在生产环境运行，是因为他们已经有成熟的容错机制。

**Q: 如何说服团队接受混沌工程？**
A: 从低成本实验开始：先在 Staging 环境杀死一个非核心 Pod，观察系统是否自愈。用实验结果证明价值，逐步扩大范围。

**Q: 混沌实验会不会导致真正的故障？**
A: 有这个风险。三条安全准则：(1) 从最小爆炸半径开始；(2) 设置自动中止条件（Abort Condition）；(3) 实验时有专人值守，随时可以手动回滚。
