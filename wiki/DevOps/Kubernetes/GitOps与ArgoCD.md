# GitOps 与 ArgoCD

## 定义

**GitOps** 是一种以 Git 仓库为唯一真相源（Single Source of Truth）的持续部署模式。**ArgoCD** 是 Kubernetes 原生的 GitOps 工具，通过监听 Git 仓库变更自动同步集群状态。

## 核心原理

### Push vs Pull 模式对比

```
┌──────────────────────────────────────────────────────────────────┐
│                     传统 Push 模式                                │
│                                                                  │
│  Developer → Git Push → CI Build → CI Test → kubectl apply       │
│                                       ↑                          │
│                               CI 需要集群写权限                    │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     GitOps Pull 模式 (ArgoCD)                    │
│                                                                  │
│  Developer → Git Push → CI Build → CI Push Image → Git Update    │
│                                                          │       │
│  ┌─────────────────────────────────────────────────────┐ │       │
│  │  ArgoCD (Cluster 内运行)                             │ │       │
│  │  ┌─────────┐    ┌──────────┐    ┌───────────────┐   │ │       │
│  │  │ Watch   │───→│ Compare  │───→│ Sync to K8s   │   │ │       │
│  │  │ Git Repo│    │ Drift    │    │ (自动/手动)    │   │ │       │
│  │  └─────────┘    └──────────┘    └───────────────┘   │ │       │
│  └─────────────────────────────────────────────────────┘ │       │
│  集群主动拉取，CI 不需要集群写权限                           │       │
└──────────────────────────────────────────────────────────────────┘
```

### ArgoCD 核心概念

| 概念 | 说明 |
|---|---|
| Application | ArgoCD 的核心 CRD，定义 Git 仓库 → K8s 集群的映射 |
| Sync | 将 Git 仓库的期望状态同步到集群 |
| Health | 资源的健康状态（Healthy/Degraded/Progressing） |
| Sync Status | 同步状态（Synced/OutOfSync） |
| Refresh | 从 Git 拉取最新配置 |

### Application CRD 示例

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: laravel-api
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/k8s-manifests.git
    targetRevision: main
    path: laravel-api/overlays/production
    helm:
      valueFiles:
      - values-prod.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true       # 自动删除 Git 中不存在的资源
      selfHeal: true    # 自动修复手动修改的漂移
    syncOptions:
    - CreateNamespace=true
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### 自动同步 vs 手动审批

| 策略 | 场景 | 配置 |
|---|---|---|
| 自动同步 | dev/staging 环境 | `syncPolicy.automated` |
| 手动审批 | 生产环境 | 不配置 `automated`，手动触发 Sync |

### 回滚策略

```bash
# ArgoCD 回滚（基于 Git commit）
argocd app rollback laravel-api <revision>

# 查看历史
argocd app history laravel-api

# 要点：回滚操作也记录在 Git 中，可审计
```

## 实战案例

来自博客文章：
- [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚](/categories/DevOps/argocd-gitops-guide-laravel-cd/) - Push → Pull 模式迁移踩坑记录

## Laravel 特有踩坑

### .env 配置注入
- ArgoCD 不直接管理 `.env` 文件，需要将配置拆分到 ConfigMap/Secret
- 使用 Helm `values.yaml` 管理不同环境的配置差异
- 敏感配置使用 Sealed Secrets 或 External Secrets Operator

### 数据库迁移
- 生产环境禁止在 Deployment 中自动运行 `php artisan migrate`
- 使用 ArgoCD 的 `SyncPhase` + `SyncHook` 在部署前/后运行迁移 Job
- 或使用单独的 CI Step 手动执行迁移

## 相关概念

- [Helm 包管理](Helm包管理.md) - ArgoCD + Helm 组合使用
- [渐进式发布](渐进式发布.md) - ArgoCD + Argo Rollouts 协同
- [CI/CD 流水线](../CI-CD流水线.md) - GitHub Actions → ArgoCD 部署链路
- [安全加固与合规](../安全加固与合规.md) - ArgoCD RBAC 与审计

## 常见问题

### Application 一直处于 OutOfSync
- Git 仓库中的声明与集群实际状态不一致
- 检查是否有手动 `kubectl edit` 修改了资源
- 启用 `selfHeal: true` 自动修复漂移

### 同步失败
- 检查 Git 仓库访问权限
- 检查 Helm Chart 渲染是否有误
- 查看 ArgoCD UI 的 Sync 日志

### 权限管理
- ArgoCD 的 RBAC 独立于 K8s RBAC
- 使用 `AppProject` 限制应用的部署范围
- 生产环境建议手动审批 + RBAC 限制
