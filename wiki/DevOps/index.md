# DevOps 知识图谱

> 面向 Hexo 博客文章整理的 DevOps Wiki。本文作为总索引，串联容器化、CI/CD 流水线、监控告警、日志与可观测性、云部署、基础设施即代码、自动化配置管理、开发者门户、SRE 可靠性工程、安全合规、部署策略、混沌工程、FinOps 成本治理、应用 Profiling 与分布式追踪。

## 知识地图

- [Docker 容器化](Docker容器化.md)
  - 镜像构建、多阶段构建、Docker Compose 编排
  - 容器网络、数据卷、日志管理
- [Kubernetes 容器编排](Kubernetes/index.md) ⭐ NEW
  - Pod/Deployment/Service/kubectl 基础、本地开发环境（minikube/kind/k3s）
  - HPA/VPA 自动扩缩容、Ingress 网络、ConfigMap/Secret 配置管理
  - Helm 包管理、GitOps（ArgoCD）、渐进式发布（Argo Rollouts）
  - 服务网格（Istio）、K8s 调试、Crossplane、eBPF 可观测性
- [CI/CD 流水线](CI-CD流水线.md)
  - GitHub Actions 矩阵策略、自定义 Action、Reusable Workflows
  - 持续集成/持续部署/持续交付、测试自动化
- [Prometheus 监控告警](Prometheus监控告警.md)
  - PromQL、Alertmanager 路由与抑制、Grafana 面板
  - 指标采集、告警分级、误报治理、告警疲劳
- [Grafana Loki 日志聚合](GrafanaLoki日志聚合.md)
  - LogQL、Promtail/Loki 采集链路、ELK 替代方案
  - 日志标签、索引策略、查询优化
- [OpenTelemetry 可观测性](OpenTelemetry可观测性.md)
  - 日志/指标/追踪三支柱统一、OTLP 协议
  - 全链路埋点、Span 上下文传播、与 Laravel 集成
- [分布式追踪与 Baggage](分布式追踪与Baggage.md)
  - Trace/Span 模型、OpenTelemetry Baggage 跨服务上下文传播
  - 采样策略、Laravel 集成、日志关联与指标过滤
- [应用性能剖析与 Profiling](应用性能剖析与Profiling.md)
  - Blackfire/Tideways 火焰图、CPU/内存采样
  - 生产级 Profiling 采样策略、Laravel 常见瓶颈定位
- [SRE 与可靠性工程](SRE与可靠性工程.md)
  - SLI/SLO/Error Budget 三层模型
  - 告警分级与告警疲劳治理、Incident Command 应急响应
  - Postmortem 文化、可靠性与迭代速度的平衡
- [Chaos Engineering 与韧性测试](Chaos-Engineering与韧性测试.md)
  - Chaos Mesh 故障注入、稳态假设与实验验证
  - 容器/网络/磁盘/依赖服务故障模拟
  - 韧性测试五层模型
- [安全加固与合规](安全加固与合规.md)
  - Linux 安全模块（AppArmor/SELinux/seccomp）
  - 供应链安全（SBOM）、密钥管理（Vault/SOPS/age）
  - GDPR/PCI DSS/个人信息保护法合规落地
- [蓝绿部署与零停机发布](蓝绿部署与零停机发布.md)
  - 蓝绿部署流程、数据库迁移兼容策略
  - 多区域部署与数据一致性
  - 金丝雀发布、滚动更新策略对比
- [FinOps 与云成本治理](FinOps与云成本治理.md)
  - 标签策略与按服务分摊、预算告警
  - 竞价实例（Spot Instance）与混合调度
  - 成本 KPI、资源优化
- [云部署平台选型](云部署平台选型.md)
  - Railway / Fly.io / Render / Coolify 对比
  - PaaS 自托管 vs 商业平台、定价模型与场景匹配
- [基础设施即代码](基础设施即代码.md)
  - Terraform Provider/Module/State 管理
  - AWS VPC/EC2/RDS/S3 代码化部署、团队协作
- [自动化配置管理](自动化配置管理.md)
  - Ansible Inventory/Playbook/Role/Vault
  - 滚动部署、零停机发布、幂等性保障
- [Web 服务器选型](Web服务器选型.md)
  - Caddy 2 vs Nginx、自动 HTTPS、反向代理
  - Laravel 部署配置、Docker/K8s 集成
- [开发者门户与平台工程](开发者门户与平台工程.md)
  - Backstage Software Catalog / TechDocs / Scaffolder
  - 内部开发者平台（IDP）、服务目录、模板脚手架
- [AI Agent 驱动 DevOps](AI-Agent驱动DevOps.md)
  - 智能监控告警、自动修复决策、蓝绿部署智能化
  - CI/CD 智能化：AI Code Review、智能合并决策

## 主题关系图

### 1. 容器化是一切的基础
Docker 容器化是现代 DevOps 的起点。镜像构建 → Docker Compose 编排 → **K8s 集群调度**，形成从开发到生产的标准化交付链路。K8s 通过 Pod/Deployment/Service 实现声明式容器编排，HPA/VPA 实现自动扩缩容，Helm 实现包管理，ArgoCD 实现 GitOps 持续部署。云部署平台（Coolify、Fly.io、Railway）底层也依赖容器技术。

- 相关页：[Docker 容器化](Docker容器化.md)、[Kubernetes 容器编排](Kubernetes/index.md)、[云部署平台选型](云部署平台选型.md)
- 相关文章：
  - [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/2026/06/02/Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/)
  - [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器](/2026/06/02/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/)
  - [kubectl 实战：Pod、Deployment、Service 基础操作](/categories/DevOps/kubectl-1-36-guide-pod-deployment-service/)
  - [minikube vs kind vs k3s 选型实战](/categories/DevOps/kubernetes-minikube-kind-k3s-guide-laravel/)
  - [Helm Chart 实战：Laravel 应用打包与部署](/categories/DevOps/helm-chart-guide-laravel-deployment/)

### 2. CI/CD 是自动化的骨架
从代码提交到生产部署，CI/CD 流水线串联了 lint、test、build、deploy 全流程。GitHub Actions 的矩阵策略和自定义 Action 让多版本多环境的并行测试成为可能。

- 相关页：[CI/CD 流水线](CI-CD流水线.md)、[自动化配置管理](自动化配置管理.md)
- 相关文章：
  - [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/2026/06/02/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/)
  - [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/2026/06/01/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
  - [AI Agent + GitHub Actions 实战：CI/CD 智能化与自动化决策](/2026/06/02/AI-Agent-GitHub-Actions-CICD智能化/)

### 3. 可观测性三支柱：监控 + 日志 + 追踪
Prometheus 负责指标采集与告警、Grafana Loki 负责日志聚合、OpenTelemetry 提供统一的追踪与上下文传播。三者结合构成完整的可观测性体系。分布式追踪通过 Baggage 机制在服务间透传业务标签，实现跨服务日志关联和指标过滤。应用 Profiling 补充了单服务级别的深度性能分析。

- 相关页：[Prometheus 监控告警](Prometheus监控告警.md)、[Grafana Loki 日志聚合](GrafanaLoki日志聚合.md)、[OpenTelemetry 可观测性](OpenTelemetry可观测性.md)、[分布式追踪与 Baggage](分布式追踪与Baggage.md)、[应用性能剖析与 Profiling](应用性能剖析与Profiling.md)
- 相关文章：
  - [监控告警实战：Prometheus Alertmanager + Grafana 告警规则设计](/2026/06/01/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
  - [Grafana Loki 实战：轻量级日志聚合替代 ELK](/2026/06/02/grafana-loki-lightweight-log-aggregation-laravel/)
  - [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准](/2026/06/02/opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
  - [Sentry 实战：错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成](/2026/06/02/sentry-error-tracking-performance-monitoring-session-replay-laravel/)
  - [OpenTelemetry Baggage 实战：跨服务上下文传播](/2026/06/01/opentelemetry-baggage-context-propagation/)
  - [Application Profiling 实战：Blackfire/Tideways production profiling](/2026/06/01/application-profiling-blackfire-tideways-laravel/)

### 4. IaC + 配置管理 = 基础设施自动化闭环
Terraform 负责基础设施资源编排（VPC、EC2、RDS），Ansible 负责服务器配置与应用部署。两者互补：Terraform 管"资源有无"，Ansible 管"配置好坏"。

- 相关页：[基础设施即代码](基础设施即代码.md)、[自动化配置管理](自动化配置管理.md)
- 相关文章：
  - [Terraform 实战：Laravel 应用基础设施即代码（IaC）](/2026/06/01/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
  - [Ansible 实战：Laravel 应用自动化部署与配置管理](/2026/06/01/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)

### 5. 平台工程提升开发者体验
Backstage 将散落在 30+ 仓库中的服务、文档、模板统一到一个门户中。开发者不再需要记住"哪个仓库做哪件事"，而是通过目录搜索、模板脚手架快速上手。

- 相关页：[开发者门户与平台工程](开发者门户与平台工程.md)
- 相关文章：
  - [Backstage 实战：开发者门户搭建——内部开发者平台（IDP）与服务目录管理](/2026/06/02/backstage-developer-portal-idp-service-catalog/)

### 6. SRE 用指标驱动可靠性决策
SRE 通过 SLI/SLO/Error Budget 将可靠性量化，用数据决定「发布还是修复」。Incident Command 提供结构化的应急响应流程，Postmortem 文化确保每次故障都转化为系统改进。

- 相关页：[SRE 与可靠性工程](SRE与可靠性工程.md)、[Chaos Engineering 与韧性测试](Chaos-Engineering与韧性测试.md)
- 相关文章：
  - [SRE 实战入门：SLI/SLO/Error Budget 在 Laravel B2C API 中的落地](/2026/06/01/sre-sli-slo-error-budget-laravel-b2c-api/)
  - [Incident Command 实战：生产故障应急响应——PagerDuty 集成、War Room 协作与 Postmortem 文化](/2026/06/01/incident-command-pagerduty-war-room-postmortem/)
  - [Chaos Engineering 实战：用 Chaos Mesh 对 Laravel 微服务进行故障注入与韧性测试](/2026/06/01/chaos-engineering-chaos-mesh-laravel/)

### 7. 安全左移：在 CI 中自动执行安全检查
安全不再是发布前的「最后一步检查」，而是集成到 CI/CD 流水线中的自动化流程。SBOM 生成、镜像扫描、密钥管理、合规检查都在代码提交时自动执行。

- 相关页：[安全加固与合规](安全加固与合规.md)
- 相关文章：
  - [Linux 安全加固实战：AppArmor/SELinux/seccomp 策略](/2026/06/01/linux-security-hardening-apparmor-selinux-seccomp/)
  - [Software Bill of Materials (SBOM) 实战：Syft/Trivy 生成依赖清单](/2026/06/01/sbom-syft-trivy-supply-chain-security/)
  - [GDPR/个人信息保护法合规实战](/2026/06/02/gdpr-personal-information-protection-laravel/)
  - [PCI DSS 合规实战：支付系统安全标准落地](/2026/06/02/pci-dss-laravel-payment-security/)
  - [Secrets Management 实战：HashiCorp Vault/SOPS/age 密钥管理](/2026/06/01/secrets-management-vault-sops-age/)

### 8. 部署策略决定发布风险
蓝绿部署实现秒级回滚，金丝雀发布降低爆炸半径，多区域部署满足全球化需求。选择哪种策略取决于应用的可用性要求和团队的运维能力。

- 相关页：[蓝绿部署与零停机发布](蓝绿部署与零停机发布.md)
- 相关文章：
  - [蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚](/2026/06/02/blue-green-deployment-laravel-zero-downtime/)
  - [多区域部署实战：全球化 Laravel 应用——数据库同步、CDN 边缘缓存与跨区域一致性](/2026/06/01/multi-region-deployment-laravel-global/)

### 9. FinOps 让云成本可见、可优化
云成本从固定支出变为可变支出。FinOps 通过标签策略让成本可见，通过竞价实例和预留实例优化成本，通过预算告警防止意外超支。

- 相关页：[FinOps 与云成本治理](FinOps与云成本治理.md)
- 相关文章：
  - [FinOps 实战：AWS Cost Explorer + Kubecost 云成本治理](/2026/06/01/finops-aws-cost-explorer-kubecost-laravel/)
  - [Spot Instance 实战：Laravel 工作负载用竞价实例省钱](/2026/06/01/spot-instance-laravel-cost-optimization/)

## 关键概念导航

| 概念 | 说明 | 关联页面 |
|---|---|---|
| Docker | 容器化标准，镜像构建与运行时隔离 | [Docker 容器化](Docker容器化.md) |
| Docker Compose | 多容器应用编排 | [Docker 容器化](Docker容器化.md) |
| Kubernetes | 容器编排平台，Pod/Deployment/Service | [Kubernetes 容器编排](Kubernetes/K8s基础.md) |
| kubectl | K8s 命令行工具 | [Kubernetes 容器编排](Kubernetes/K8s基础.md) |
| HPA/VPA | Pod 自动扩缩容 | [Kubernetes 容器编排](Kubernetes/自动扩缩容.md) |
| Helm | K8s 包管理器 | [Kubernetes 容器编排](Kubernetes/Helm包管理.md) |
| ArgoCD | GitOps 持续部署 | [Kubernetes 容器编排](Kubernetes/GitOps与ArgoCD.md) |
| Argo Rollouts | 渐进式发布（金丝雀/蓝绿） | [Kubernetes 容器编排](Kubernetes/渐进式发布.md) |
| Istio | 服务网格（Sidecar 代理） | [Kubernetes 容器编排](Kubernetes/服务网格Istio.md) |
| Crossplane | K8s 原生基础设施编排 | [Kubernetes 容器编排](Kubernetes/Crossplane与基础设施.md) |
| eBPF | 内核级网络与安全可观测 | [Kubernetes 容器编排](Kubernetes/eBPF与内核级可观测性.md) |
| GitHub Actions | GitHub 原生 CI/CD 平台 | [CI/CD 流水线](CI-CD流水线.md) |
| 矩阵策略 | 多版本多环境并行测试 | [CI/CD 流水线](CI-CD流水线.md) |
| Prometheus | 时间序列数据库与指标采集 | [Prometheus 监控告警](Prometheus监控告警.md) |
| PromQL | Prometheus 查询语言 | [Prometheus 监控告警](Prometheus监控告警.md) |
| Alertmanager | 告警路由、抑制、分组 | [Prometheus 监控告警](Prometheus监控告警.md) |
| Grafana | 可视化面板与数据源聚合 | [Prometheus 监控告警](Prometheus监控告警.md) |
| Loki | 轻量级日志聚合引擎 | [Grafana Loki 日志聚合](GrafanaLoki日志聚合.md) |
| LogQL | Loki 查询语言 | [Grafana Loki 日志聚合](GrafanaLoki日志聚合.md) |
| OpenTelemetry | 可观测性统一标准（日志/指标/追踪） | [OpenTelemetry 可观测性](OpenTelemetry可观测性.md) |
| Baggage | 跨服务上下文传播（业务标签透传） | [分布式追踪与 Baggage](分布式追踪与Baggage.md) |
| Trace/Span | 分布式追踪的链路/操作模型 | [分布式追踪与 Baggage](分布式追踪与Baggage.md) |
| Flame Graph | 火焰图，性能瓶颈可视化 | [应用性能剖析与 Profiling](应用性能剖析与Profiling.md) |
| Blackfire/Tideways | PHP Profiling 工具 | [应用性能剖析与 Profiling](应用性能剖析与Profiling.md) |
| SLI/SLO | 服务等级指标/目标 | [SRE 与可靠性工程](SRE与可靠性工程.md) |
| Error Budget | 错误预算，可靠性与迭代速度的平衡 | [SRE 与可靠性工程](SRE与可靠性工程.md) |
| Incident Command | 生产故障应急响应指挥体系 | [SRE 与可靠性工程](SRE与可靠性工程.md) |
| Chaos Engineering | 混沌工程，主动注入故障验证韧性 | [Chaos Engineering 与韧性测试](Chaos-Engineering与韧性测试.md) |
| Chaos Mesh | K8s 混沌工程工具 | [Chaos Engineering 与韧性测试](Chaos-Engineering与韧性测试.md) |
| AppArmor/SELinux | Linux 安全模块 | [安全加固与合规](安全加固与合规.md) |
| seccomp | 系统调用白名单 | [安全加固与合规](安全加固与合规.md) |
| SBOM | 软件物料清单，供应链安全 | [安全加固与合规](安全加固与合规.md) |
| Vault | 密钥管理工具 | [安全加固与合规](安全加固与合规.md) |
| GDPR | 欧盟通用数据保护条例 | [安全加固与合规](安全加固与合规.md) |
| PCI DSS | 支付卡行业安全标准 | [安全加固与合规](安全加固与合规.md) |
| 蓝绿部署 | 双环境一键切换的零停机发布 | [蓝绿部署与零停机发布](蓝绿部署与零停机发布.md) |
| FinOps | 云成本治理实践框架 | [FinOps 与云成本治理](FinOps与云成本治理.md) |
| Spot Instance | 竞价实例，云闲置算力折扣 | [FinOps 与云成本治理](FinOps与云成本治理.md) |
| Terraform | 基础设施即代码工具 | [基础设施即代码](基础设施即代码.md) |
| Ansible | 无代理自动化配置管理 | [自动化配置管理](自动化配置管理.md) |
| Caddy 2 | 自动 HTTPS 的现代 Web 服务器 | [Web 服务器选型](Web服务器选型.md) |
| Backstage | Spotify 开源开发者门户 | [开发者门户与平台工程](开发者门户与平台工程.md) |
| PaaS | 平台即服务（Coolify/Railway/Fly.io/Render） | [云部署平台选型](云部署平台选型.md) |

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. Docker 容器化 → 2. Kubernetes 容器编排 → 3. CI/CD 流水线（GitHub Actions）
                                                        │
                                                        ▼
4. Prometheus 监控告警 → 5. Grafana Loki 日志聚合 → 6. OpenTelemetry 可观测性
                                                        │
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                            6a. 分布式追踪       6b. 应用 Profiling    6c. SRE 可靠性工程
                            与 Baggage           火焰图定位瓶颈        SLI/SLO/Error Budget
                                                        │
                                                        ▼
7. 蓝绿部署与零停机发布 → 8. Chaos Engineering 韧性测试
                                                        │
                                                        ▼
9. 云部署平台选型 → 10. 基础设施即代码（Terraform）→ 11. 自动化配置管理（Ansible）
                                                        │
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                            12. 安全加固与合规   13. FinOps 云成本治理   14. Web 服务器选型
                            SBOM/GDPR/PCI DSS     竞价实例/标签策略       Caddy/Nginx
                                                        │
                                                        ▼
15. 开发者门户（Backstage）→ 16. AI Agent 驱动 DevOps（智能化升级）
```

## 跨领域关联
- → [MySQL 知识图谱](../MySQL/index.md)：数据库监控、慢查询治理、备份恢复
- → [Redis 知识图谱](../Redis/index.md)：缓存层监控、Redis Cluster 运维
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：Laravel 部署、Octane 性能优化、队列运维
- → [前端知识图谱](../前端/index.md)：CI/CD 中的前端构建、Vite 优化、Docker 多阶段构建
- → [架构设计知识图谱](../架构设计/index.md)：微服务部署策略、分布式事务、事件驱动架构
