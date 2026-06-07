# Kubernetes 知识图谱

> 面向 Laravel B2C API 在 Kubernetes 上的实战 Wiki。串联基础资源、扩缩容、网络、配置管理、包管理、GitOps、渐进式发布、服务网格与故障排查。

## 知识地图

- [K8s 基础：Pod / Deployment / Service / kubectl](K8s基础.md)
  - Pod 生命周期、Deployment 滚动更新与回滚、Service 服务发现
  - kubectl 核心命令速查
- [本地开发环境：minikube / kind / k3s](本地开发环境.md)
  - macOS Apple Silicon 适配、启动速度、资源占用、CI/CD 集成
  - 三方案深度对比与选型建议
- [自动扩缩容：HPA / VPA](自动扩缩容.md)
  - CPU 指标误判问题、自定义指标（php-fpm active process）
  - 队列 Worker 独立伸缩策略、VPA recommendation 模式
- [Ingress 与网络](Ingress与网络.md)
  - Nginx Ingress vs Traefik、TLS 证书管理
  - Service 类型（ClusterIP / NodePort / LoadBalancer）、DNS 服务发现
- [配置管理：ConfigMap / Secret](配置管理.md)
  - 环境变量注入、热更新、Secret 加密与轮换
  - Laravel .env 与 K8s 配置治理
- [Helm 包管理](Helm包管理.md)
  - Chart 结构、values.yaml 分层设计、多环境模板化
  - 30+ 仓库批量部署、Release 版本管理
- [GitOps 与 ArgoCD](GitOps与ArgoCD.md)
  - Push vs Pull 模式对比、Application CRD
  - 自动同步与手动审批、回滚策略、多环境管理
- [渐进式发布：Argo Rollouts](渐进式发布.md)
  - 金丝雀发布、蓝绿部署、Prometheus 自动分析
  - AnalysisTemplate、流量切分、自动回滚
- [服务网格：Istio](服务网格Istio.md)
  - Sidecar 注入、VirtualService 流量管理
  - mTLS 自动加密、灰度发布、超时/重试策略
- [K8s 调试与故障排查](K8s调试与故障排查.md)
  - kubectl debug、Ephemeral Container
  - Lens/OpenLens 可视化、日志排查、OOMKilled 处理
- [Crossplane 与 K8s 原生基础设施](Crossplane与基础设施.md)
  - K8s 原生 CRD 管理云资源、替代 Terraform 的 GitOps 方案
- [eBPF 与内核级可观测性](eBPF与内核级可观测性.md)
  - Cilium 网络策略、Tetragon 安全观测
  - K8s 集群中的性能分析与安全加固

## 主题关系图

### 1. 基础资源是一切的起点
Pod → Deployment → Service → Ingress，形成从容器运行到外部访问的完整链路。kubectl 是操作这些资源的核心工具。

- 相关页：[K8s 基础](K8s基础.md)、[Ingress 与网络](Ingress与网络.md)

### 2. 配置管理与包管理解决规模化问题
单个服务用 ConfigMap/Secret 足矣，但 30+ 仓库需要 Helm Chart 统一模板。ArgoCD 则让 Git 成为唯一真相源。

- 相关页：[配置管理](配置管理.md)、[Helm 包管理](Helm包管理.md)、[GitOps 与 ArgoCD](GitOps与ArgoCD.md)

### 3. 扩缩容与发布策略决定生产韧性
HPA/VPA 解决"量"的问题（流量高峰自动扩容），Argo Rollouts 解决"质"的问题（新版本安全放量）。

- 相关页：[自动扩缩容](自动扩缩容.md)、[渐进式发布](渐进式发布.md)

### 4. 服务网格是微服务治理的进阶
当服务间调用出现超时不一致、灰度难控、加密缺失时，Istio 提供透明的 sidecar 代理解决方案。

- 相关页：[服务网格 Istio](服务网格Istio.md)

### 5. 调试工具是生产运维的生命线
生产 Pod 不能 SSH，需要 kubectl debug + Ephemeral Container + Lens 的组合拳。

- 相关页：[K8s 调试与故障排查](K8s调试与故障排查.md)

### 6. K8s 生态持续扩展
Crossplane 让 K8s 成为统一控制平面管理云资源，eBPF 让内核级网络与安全可观测成为可能。

- 相关页：[Crossplane 与基础设施](Crossplane与基础设施.md)、[eBPF 与内核级可观测性](eBPF与内核级可观测性.md)

## 实战文章（来自博客）

### 基础操作
- [kubectl 实战：Pod、Deployment、Service 基础操作](/categories/DevOps/kubectl-1-36-guide-pod-deployment-service/) - Laravel B2C API 踩坑记录
- [Kubernetes 基础操作命令](/categories/DevOps/kubernetes-1/) - 常用命令速查

### 本地开发
- [minikube vs kind vs k3s 选型实战](/categories/DevOps/kubernetes-minikube-kind-k3s-guide-laravel/) - macOS 本地 K8s 开发环境

### 扩缩容
- [K8s HPA/VPA 自动扩缩容实战](/categories/DevOps/k8s-hpa-vpa-guide-laravel-api-cpu/) - CPU 误判到自定义指标扩容
- [Kubernetes HPA 实战](/categories/DevOps/kubernetes-hpa-guide-laravel/) - 自动扩缩容策略与踩坑

### 网络与配置
- [Kubernetes Ingress 实战](/categories/DevOps/kubernetes-ingress-guide-nginx-traefik-tls-deployment/) - Nginx/Traefik 配置与 TLS
- [Kubernetes ConfigMap/Secret 实战](/categories/DevOps/kubernetes-configmap-secret-guide-config-management-laravel-deployment/) - 配置管理与敏感数据处理

### 包管理与部署
- [Helm Chart 实战](/categories/DevOps/helm-chart-guide-laravel-deployment/) - Laravel 应用打包与部署
- [ArgoCD GitOps 实战](/categories/DevOps/argocd-gitops-guide-laravel-cd/) - Laravel 应用持续部署与回滚

### 发布策略
- [Argo Rollouts 渐进式发布实战](/categories/DevOps/argo-rollouts-guide-laravel-k8s/) - 金丝雀发布、自动分析与回滚
- [Progressive Delivery 实战](/categories/CI-CD/Progressive-Delivery-实战-Feature-Flag-渐进式发布-Unleash-Argo-Rollouts完整工程化工作流/) - Feature Flag + 渐进式发布

### 服务网格
- [Istio 服务网格实战](/categories/DevOps/istio-guide-laravel-k8s-canary-mtls/) - 超时、重试、灰度发布与 mTLS
- [Istio 服务网格实战（进阶）](/categories/PHP/istio-guide-laravel-k8s-mtls-canaryoptimization/) - mTLS 自动加密、灰度发布与连接池优化

### 调试与运维
- [Kubernetes Debugging 实战](/categories/运维/Kubernetes-Debugging-实战-kubectl-debug-ephemeral-container-Lens-Laravel-K8s-生产级故障排查工具箱/) - kubectl debug/Ephemeral Container/Lens
- [eBPF 实战](/categories/运维/eBPF-实战-内核级网络追踪与性能分析-Cilium-Tetragon在Laravel-K8s集群中的安全与可观测性/) - Cilium/Tetragon 安全与可观测性

### 基础设施
- [Crossplane 实战](/categories/运维/Crossplane-实战-Kubernetes原生基础设施编排-替代Terraform的云资源GitOps声明式管理/) - K8s 原生基础设施编排
- [Spot Instance 实战](/categories/运维/Spot-Instance-实战-Laravel工作负载用竞价实例省钱-中断处理混合调度与K8s自动迁移踩坑记录/) - K8s 自动迁移与成本优化

### Laravel 特有
- [Laravel Scheduler 与 Kubernetes CronJob](/categories/PHP/Laravel/laravel-scheduler-guide-deployment-ononeserver-kubernetes-cronjob/) - 多实例部署下的重入保护

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. K8s 基础（Pod/Deployment/Service）→ 2. kubectl 命令熟练
                                                          │
                                                          ▼
3. 本地开发环境（minikube/kind/k3s）→ 4. ConfigMap/Secret 配置管理
                                                          │
                                                          ▼
5. Ingress 与网络 → 6. HPA/VPA 自动扩缩容
                                                          │
                                                          ▼
7. Helm 包管理 → 8. ArgoCD GitOps 持续部署
                                                          │
                                                          ▼
9. Argo Rollouts 渐进式发布 → 10. Istio 服务网格
                                                          │
                                                          ▼
11. K8s 调试与故障排查 → 12. eBPF 内核级可观测性 → 13. Crossplane 基础设施
```

## 知识关联图

```
Pod ──→ Deployment（滚动更新/回滚）──→ Service（服务发现/负载均衡）
                                            │
                                            ▼
                                    Ingress（HTTP/HTTPS 路由入口）
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                        ConfigMap       Secret        HPA/VPA
                      (环境变量)     (敏感数据)      (自动扩缩)
                              │             │             │
                              └─────────────┼─────────────┘
                                            ▼
                                     Helm Chart
                                   (模板化打包)
                                            │
                                            ▼
                                     ArgoCD GitOps
                                   (声明式部署)
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                        Argo Rollouts    Istio        kubectl debug
                        (渐进式发布)   (服务网格)     (故障排查)
                              │             │             │
                              └─────────────┼─────────────┘
                                            ▼
                                    eBPF / Crossplane
                                  (内核可观测 / 基础设施)
```

## 关键概念导航

| 概念 | 说明 | 关联页面 |
|---|---|---|
| Pod | K8s 最小调度单元 | [K8s 基础](K8s基础.md) |
| Deployment | 声明式管理 Pod 副本与更新 | [K8s 基础](K8s基础.md) |
| Service | 服务发现与负载均衡 | [K8s 基础](K8s基础.md) |
| kubectl | K8s 命令行工具 | [K8s 基础](K8s基础.md) |
| HPA | 水平 Pod 自动扩缩容 | [自动扩缩容](自动扩缩容.md) |
| VPA | 垂直 Pod 自动扩缩容 | [自动扩缩容](自动扩缩容.md) |
| Ingress | HTTP/HTTPS 路由入口 | [Ingress 与网络](Ingress与网络.md) |
| ConfigMap | 非敏感配置管理 | [配置管理](配置管理.md) |
| Secret | 敏感数据管理 | [配置管理](配置管理.md) |
| Helm | K8s 包管理器 | [Helm 包管理](Helm包管理.md) |
| ArgoCD | GitOps 持续部署工具 | [GitOps 与 ArgoCD](GitOps与ArgoCD.md) |
| GitOps | 以 Git 为唯一真相源的部署模式 | [GitOps 与 ArgoCD](GitOps与ArgoCD.md) |
| Argo Rollouts | 渐进式发布控制器 | [渐进式发布](渐进式发布.md) |
| Canary | 金丝雀发布策略 | [渐进式发布](渐进式发布.md) |
| Istio | 服务网格（Sidecar 代理） | [服务网格 Istio](服务网格Istio.md) |
| mTLS | 双向 TLS 自动加密 | [服务网格 Istio](服务网格Istio.md) |
| VirtualService | Istio 流量路由规则 | [服务网格 Istio](服务网格Istio.md) |
| Ephemeral Container | 临时调试容器 | [K8s 调试与故障排查](K8s调试与故障排查.md) |
| Crossplane | K8s 原生基础设施编排 | [Crossplane 与基础设施](Crossplane与基础设施.md) |
| eBPF | 内核级网络与安全可观测 | [eBPF 与内核级可观测性](eBPF与内核级可观测性.md) |
| Cilium | eBPF 驱动的 CNI 插件 | [eBPF 与内核级可观测性](eBPF与内核级可观测性.md) |
| minikube | 本地单节点 K8s 环境 | [本地开发环境](本地开发环境.md) |
| kind | Docker-in-Docker K8s 环境 | [本地开发环境](本地开发环境.md) |
| k3s | 轻量级 K8s 发行版 | [本地开发环境](本地开发环境.md) |

## 跨领域关联
- → [Docker 容器化](../Docker容器化.md)：K8s 底层容器运行时、多阶段构建
- → [CI/CD 流水线](../CI-CD流水线.md)：GitHub Actions → kubectl/Helm/ArgoCD 部署链路
- → [Prometheus 监控告警](../Prometheus监控告警.md)：HPA 自定义指标、Argo Rollouts AnalysisTemplate
- → [蓝绿部署与零停机发布](../蓝绿部署与零停机发布.md)：Argo Rollouts 渐进式发布策略
- → [安全加固与合规](../安全加固与合规.md)：容器安全扫描、mTLS、RBAC
- → [基础设施即代码](../基础设施即代码.md)：Crossplane vs Terraform 选型
- → [MySQL 知识图谱](../../MySQL/index.md)：K8s 中 MySQL 连接管理、有状态服务
- → [Redis 知识图谱](../../Redis/index.md)：K8s 中 Redis Cluster 部署
- → [PHP-Laravel 知识图谱](../../PHP-Laravel/index.md)：Laravel Octane + K8s、队列 Worker 部署
