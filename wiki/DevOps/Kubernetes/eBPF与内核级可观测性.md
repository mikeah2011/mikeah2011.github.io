# eBPF 与内核级可观测性

## 定义

**eBPF（Extended Berkeley Packet Filter）** 是一种在 Linux 内核中运行沙箱程序的技术，无需修改内核代码即可实现网络追踪、安全策略和性能分析。在 Kubernetes 环境中，eBPF 驱动的工具（如 **Cilium**、**Tetragon**）提供了传统方案无法实现的内核级网络与安全可观测性。

## 核心原理

### eBPF 能做什么？

| 领域 | 工具 | 能力 |
|---|---|---|
| 网络 | Cilium CNI | 替代 iptables 的高性能网络策略 |
| 安全 | Tetragon | 内核级进程/文件/网络行为监控 |
| 追踪 | bpftrace | 系统调用级别的性能分析 |
| 可观测性 | Hubble | Cilium 的网络流量可视化 |

### Cilium：eBPF 驱动的 CNI

传统 K8s 网络策略基于 iptables，规则数量增加后性能下降。Cilium 用 eBPF 替代 iptables，在内核层面实现网络策略：

```yaml
# CiliumNetworkPolicy 示例
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: laravel-api-policy
spec:
  endpointSelector:
    matchLabels:
      app: laravel-api
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: ingress-nginx
    toPorts:
    - ports:
      - port: "9000"
        protocol: TCP
  egress:
  - toEndpoints:
    - matchLabels:
        app: mysql
    toPorts:
    - ports:
      - port: "3306"
        protocol: TCP
  - toEndpoints:
    - matchLabels:
        app: redis
    toPorts:
    - ports:
      - port: "6379"
        protocol: TCP
```

### Tetragon：内核级安全观测

Tetragon 通过 eBPF 在内核层面监控进程行为，可以：
- 追踪进程创建/退出
- 监控文件访问
- 检测网络连接
- 阻止可疑行为

```yaml
# TracingPolicy 示例：监控敏感文件访问
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: sensitive-file-access
spec:
  kprobes:
  - call: "fd_install"
    syscall: false
    args:
    - index: 0
      type: int
    - index: 1
      type: "file"
    selectors:
    - matchArgs:
      - index: 1
        operator: "Prefix"
        values:
        - "/etc/shadow"
        - "/etc/passwd"
```

### Hubble：网络流量可视化

Hubble 是 Cilium 的可观测性平台，提供：
- 服务依赖图（Service Map）
- 网络流量追踪
- DNS 解析监控
- 丢包分析

```bash
# 查看服务间流量
hubble observe --namespace production --verdict DROPPED

# 查看 DNS 查询
hubble observe --type dns --namespace production

# 查看特定 Pod 的流量
hubble observe --pod laravel-api-xxx --protocol tcp
```

## 实战案例

来自博客文章：
- [eBPF 实战：内核级网络追踪与性能分析——Cilium/Tetragon 在 Laravel K8s 集群中的安全与可观测性](/categories/运维/eBPF-实战-内核级网络追踪与性能分析-Cilium-Tetragon在Laravel-K8s集群中的安全与可观测性/)

## 相关概念

- [Ingress 与网络](Ingress与网络.md) - Cilium CNI 替代 kube-proxy
- [服务网格 Istio](服务网格Istio.md) - Cilium Service Mesh（无 sidecar 模式）
- [安全加固与合规](../安全加固与合规.md) - 内核级安全策略
- [Prometheus 监控告警](../Prometheus监控告警.md) - Hubble 指标导出
- [分布式追踪与 Baggage](../分布式追踪与Baggage.md) - eBPF 追踪 vs OpenTelemetry 追踪

## 常见问题

### Cilium 安装后 Pod 网络不通
- 检查 Cilium Agent 是否在所有节点运行
- 确认内核版本 >= 4.19（推荐 >= 5.4）
- 使用 `cilium status` 检查集群健康状态

### Tetragon 性能开销
- eBPF 程序在内核中运行，开销极低（微秒级）
- 但大量的 kprobe 挂载会增加系统调用延迟
- 建议只监控关键系统调用

### Cilium vs Calico 选型
| 场景 | 推荐 |
|---|---|
| 简单网络策略 | Calico（更成熟） |
| 高性能 + 内核级策略 | Cilium |
| 需要 Service Mesh | Cilium（无 sidecar） |
| 已有 Calico 集群 | 保持 Calico |
