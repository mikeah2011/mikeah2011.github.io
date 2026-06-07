# Crossplane 与 K8s 原生基础设施

## 定义

**Crossplane** 是一个开源的 Kubernetes 扩展，让你用 K8s CRD（Custom Resource Definition）管理云基础设施资源（VPC、RDS、S3 等），实现"K8s 原生"的基础设施编排，可作为 Terraform 的替代方案。

## 核心原理

### Crossplane vs Terraform

| 维度 | Crossplane | Terraform |
|---|---|---|
| 控制平面 | K8s 内置 | 独立工具 |
| 状态管理 | K8s etcd（声明式） | State 文件（需远程存储） |
| 执行模式 | 持续协调（Reconciliation） | 一次性 apply |
| GitOps 集成 | 原生（ArgoCD 直接管理 CRD） | 需额外工具（Atlantis 等） |
| 多云管理 | Provider 机制 | Provider 机制 |
| 学习曲线 | 需要 K8s 知识 | HCL 语法 |
| 生态成熟度 | 中等 | 高 |

### 架构

```text
┌─────────────────────────────────────────────┐
│                Kubernetes Cluster            │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │ Crossplane   │    │  Your App CRDs    │  │
│  │ Controller   │    │  (Composite)      │  │
│  └──────┬───────┘    └────────┬──────────┘  │
│         │                     │              │
│         v                     v              │
│  ┌──────────────────────────────────────┐   │
│  │  Cloud Provider CRDs                  │   │
│  │  (AWS RDS / S3 / VPC / EKS)          │   │
│  └──────────────────┬───────────────────┘   │
│                      │                       │
└──────────────────────┼───────────────────────┘
                       │
                       v
              Cloud Provider API
              (AWS / GCP / Azure)
```

### Composite Resource 示例

```yaml
# 定义一个 PostgreSQL 实例的抽象
apiVersion: database.example.org/v1alpha1
kind: PostgreSQLInstance
metadata:
  name: laravel-db
spec:
  parameters:
    storageGB: 20
    version: "14"
  compositionSelector:
    matchLabels:
      provider: aws
```

这个 Composite Resource 会自动创建：
- AWS RDS 实例
- 安全组
- 子网组
- 参数组

### GitOps 工作流

```
Git Repo (Infrastructure CRDs)
      │
      v
ArgoCD (Watch & Sync)
      │
      v
Crossplane (Reconcile)
      │
      v
Cloud Provider API (Create/Update/Delete)
```

## 实战案例

来自博客文章：
- [Crossplane 实战：Kubernetes 原生基础设施编排](/categories/运维/Crossplane-实战-Kubernetes原生基础设施编排-替代Terraform的云资源GitOps声明式管理/) - 替代 Terraform 的 GitOps 方案

## 相关概念

- [基础设施即代码](../基础设施即代码.md) - Terraform Provider/Module/State 管理
- [GitOps 与 ArgoCD](GitOps与ArgoCD.md) - Crossplane + ArgoCD 组合
- [K8s 基础](K8s基础.md) - CRD 基础概念
- [Helm 包管理](Helm包管理.md) - Crossplane 安装

## 常见问题

### Crossplane Provider 版本兼容
- Provider 版本与 Crossplane 版本有对应关系
- 升级前检查兼容性矩阵
- 使用 `Provider` CRD 管理 Provider 版本

### 资源漂移检测
- Crossplane 持续监控云资源状态，自动修复漂移
- 但不能处理所有场景（如手动在控制台删除资源）
- 配合 ArgoCD 的 selfHeal 实现完整的声明式管理

### 学习成本
- 需要理解 K8s CRD、Operator 模式
- 需要理解 Composition 和 XRD（Composite Resource Definition）
- 建议从简单场景开始（如管理 S3 Bucket），逐步扩展
