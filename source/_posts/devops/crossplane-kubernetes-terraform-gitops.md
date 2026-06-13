---

title: Crossplane 实战：Kubernetes 原生基础设施编排——替代 Terraform 的云资源 GitOps 声明式管理
keywords: [Crossplane, Kubernetes, Terraform, GitOps, 原生基础设施编排, 替代, 的云资源, 声明式管理]
date: 2026-06-04 10:00:00
tags:
- crossplane
- Kubernetes
- IaC
- GitOps
- 基础设施
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: Crossplane 是 CNCF 孵化的 Kubernetes 原生基础设施编排工具，将 AWS、GCP、Azure 等云资源抽象为 CRD，通过 kubectl apply 声明式管理 VPC、RDS、S3 等基础设施。本文从架构原理、XRD/Composition 定义、AWS Provider 实战到 ArgoCD GitOps 集成，深入对比 Crossplane 与 Terraform 的优劣，包含完整 Laravel 项目基础设施编排案例、踩坑排查指南与 Terraform 迁移路线图，帮助 K8s 团队实现云资源的 GitOps 声明式管理。
---





# Crossplane 实战：Kubernetes 原生基础设施编排——替代 Terraform 的云资源 GitOps 声明式管理

## 前言

在云原生时代，基础设施即代码（Infrastructure as Code, IaC）已经成为现代运维的基石。Terraform 作为行业标准，长期占据着 IaC 工具的主导地位。然而，随着 Kubernetes 生态系统的成熟和 GitOps 理念的普及，一种新的基础设施编排范式正在崛起——**Crossplane**。

Crossplane 是一个开源的 Kubernetes 扩展，它将云资源（RDS、S3、VPC、IAM 等）抽象为 Kubernetes 自定义资源（CRD），让你可以用 `kubectl apply` 来管理整个云基础设施。这意味着你不再需要维护单独的 Terraform 状态文件，不再需要额外的 CI/CD 流水线来执行 `terraform apply`——一切都通过 Kubernetes 的声明式 API 来完成，并天然适配 GitOps 工作流。

本文将从零开始，带你深入理解 Crossplane 的架构设计、安装部署、XRD/Composition 定义、AWS 资源实战、GitOps 集成、策略执行，并通过一个完整的 Laravel 项目基础设施编排示例，展示 Crossplane 在生产环境中的强大能力。

---

## 一、IaC 的演进：从 Terraform 到 Crossplane 的范式转变

### 1.1 Terraform 的辉煌与局限

Terraform 由 HashiCorp 于 2014 年发布，凭借其声明式语法、Provider 插件体系和 Plan/Apply 工作流，迅速成为 IaC 领域的事实标准。截至目前，Terraform Registry 上已有超过 4000 个 Provider，覆盖了几乎所有主流云平台和 SaaS 服务。

然而，Terraform 在 Kubernetes 生态中面临几个核心痛点：

- **状态管理的脆弱性**：Terraform 依赖本地或远程状态文件（`terraform.tfstate`）来追踪基础设施状态。状态文件损坏或丢失将导致灾难性后果。
- **与 Kubernetes 生态的割裂**：Terraform 有自己的 HCL 语法、自己的状态管理、自己的 CI/CD 集成方式。在 Kubernetes 已经成为应用编排标准的今天，运维团队需要维护两套完全不同的工作流。
- **漂移检测的滞后性**：Terraform 无法实时监控基础设施状态，只能通过定期的 `terraform plan` 来检测漂移。
- **协作的复杂性**：多人协作时需要锁机制（State Locking）来防止并发冲突，增加了运维复杂度。
- **License 变更风险**：2023 年 HashiCorp 将 Terraform 从 MPL 2.0 改为 BSL 1.1，引发了社区的广泛担忧，OpenTofu 应运而生。

### 1.2 Crossplane 的范式优势

Crossplane 于 2019 年被捐赠给 CNCF，目前是 CNCF 孵化项目。它提出了一个革命性的理念：**既然 Kubernetes 已经是容器编排的标准，为什么不用它来编排基础设施呢？**

Crossplane 的核心优势：

| 维度 | Terraform | Crossplane |
|------|-----------|------------|
| 状态管理 | 本地/远程 State 文件 | Kubernetes etcd（由 API Server 管理） |
| 工作流 | HCL + CLI（plan/apply） | YAML + kubectl apply |
| GitOps 集成 | 需要额外工具 | 天然适配 ArgoCD/Flux |
| 漂移检测 | 手动触发 | 持续 reconcile（控制器模式） |
| API 抽象 | Modules（有限） | XRD + Composition（完全自定义） |
| 权限控制 | Sentinel/OPA（外部） | Kubernetes RBAC（原生） |
| 团队协作 | State Locking | Kubernetes 原生并发控制 |

### 1.3 什么时候选择 Crossplane？

- 你的团队已经深度使用 Kubernetes，熟悉 kubectl 和 YAML
- 你希望用 GitOps 工作流管理基础设施
- 你需要为平台团队定义标准化的基础设施 API
- 你希望消除 Terraform 状态文件的管理负担
- 你需要将应用编排和基础设施编排统一到一个控制平面

---

## 二、Crossplane 架构深度解析

Crossplane 的架构由四个核心概念组成，理解它们之间的关系是掌握 Crossplane 的关键。

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                    │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  Application  │    │      Crossplane Control      │  │
│  │   Manifests   │    │          Plane               │  │
│  │              │    │                              │  │
│  │  ┌────────┐  │    │  ┌──────────┐ ┌───────────┐ │  │
│  │  │ Claim  │──┼────┼──│  XR/XRC  │ │Composition│ │  │
│  │  └────────┘  │    │  └──────────┘ └───────────┘ │  │
│  │              │    │       │              │        │  │
│  └──────────────┘    │       ▼              ▼        │  │
│                      │  ┌──────────────────────┐    │  │
│                      │  │   Provider Resources  │    │  │
│                      │  │  (MR - Managed Res.)  │    │  │
│                      │  └──────────┬───────────┘    │  │
│                      └─────────────┼────────────────┘  │
│                                    │                   │
└────────────────────────────────────┼───────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │   Cloud Provider API │
                          │  (AWS / GCP / Azure) │
                          └─────────────────────┘
```

### 2.2 Provider（提供者）

Provider 是 Crossplane 与云平台之间的桥梁。每个 Provider 对应一个特定的云平台或服务，它定义了该平台上所有可管理资源的 CRD。

```yaml
# 查看已安装的 Provider
# kubectl get providers
# NAME                  INSTALLED   HEALTHY   AGE
# provider-aws          True        True      5m
# provider-aws-rds      True        True      4m
```

Provider 的职责：
- 注册云资源的 CRD（如 `rdsinstances.database.aws.crossplane.io`）
- 执行资源的 CRUD 操作（调用云 API）
- 持续同步资源状态（reconcile loop）
- 管理云 API 的认证凭据

### 2.3 CompositeResource（XR）与 CompositeResourceDefinition（XRD）

XRD 是 Crossplane 中最强大的概念。它允许你定义自己的自定义资源类型，就像 Kubernetes 的 CRD 一样。XRD 定义了 API 的 schema（参数、类型、默认值），而 XR 是 XRD 的实例。

```yaml
# XRD 定义了一个 "自定义基础设施 API"
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xdatabases.example.com
spec:
  group: example.com
  names:
    kind: XDatabase
    plural: xdatabases
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                engine:
                  type: string
                  enum: [mysql, postgres]
                version:
                  type: string
                storageGB:
                  type: integer
                  minimum: 20
                  maximum: 1000
```

### 2.4 Composition（组合）

Composition 定义了 XRD 中声明的抽象资源如何映射到底层的 Provider 资源。一个 Composition 可以包含多个 Provider 资源，它们之间可以有依赖关系。

```yaml
# Composition 将 XRD 映射到多个 AWS 资源
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: aws-rds
spec:
  compositeTypeRef:
    apiVersion: example.com/v1alpha1
    kind: XDatabase
  resources:
    - name: rds-instance
      base:
        apiVersion: rds.aws.crossplane.io/v1alpha1
        kind: DBInstance
        spec:
          forProvider:
            engine: "mysql"
            dbInstanceClass: db.t3.micro
            masterUsername: admin
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.engine
            strategy: string
            string:
              fmt: "%s"
          toFieldPath: spec.forProvider.engine
        - fromFieldPath: spec.storageGB
          toFieldPath: spec.forProvider.allocatedStorage
```

### 2.5 Claim（声明）

Claim 是应用团队使用的简版 XR。它与 XR 的区别在于 Claim 是 namespace-scoped 的，而 XR 是 cluster-scoped 的。Claim 允许应用团队在自己的 namespace 中声明基础设施需求，而不需要集群级别的权限。

```yaml
# 应用团队通过 Claim 申请数据库
apiVersion: example.com/v1alpha1
kind: Database  # Claim 的 kind 通常比 XR 简短
metadata:
  name: my-app-db
  namespace: production
spec:
  engine: postgres
  version: "14"
  storageGB: 100
```

### 2.6 资源关系流

```
Claim (namespace-scoped)
  └── CompositeResource / XR (cluster-scoped)
        ├── ManagedResource 1 (RDS DBInstance)
        ├── ManagedResource 2 (Security Group)
        └── ManagedResource 3 (Subnet Group)
              │
              ▼
        Cloud Provider API (AWS)
```

---

## 三、安装 Crossplane 与 AWS Provider

### 3.1 前置条件

- Kubernetes 集群（1.25+）
- Helm 3.x
- kubectl 已配置
- AWS CLI 已配置（用于创建 IAM 凭据）

### 3.2 使用 Helm 安装 Crossplane

```bash
# 添加 Crossplane Helm 仓库
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update

# 创建 crossplane-system 命名空间
kubectl create namespace crossplane-system

# 安装 Crossplane
helm install crossplane crossplane-stable/crossplane \
  --namespace crossplane-system \
  --set args='{--enable-external-secret-stores}' \
  --version 1.17.0

# 验证安装
kubectl get pods -n crossplane-system
# NAME                                       READY   STATUS    RESTARTS   AGE
# crossplane-5b4f8d9c7-abc12                 1/1     Running   0          30s
# crossplane-rbac-manager-7f8d9e5c4-def34    1/1     Running   0          30s
```

### 3.3 安装 Crossplane CLI（可选但推荐）

```bash
# macOS
brew install crossplane-cli/tap/crossplane

# Linux
curl -sL https://raw.githubusercontent.com/crossplane/crossplane/master/install.sh | sh
sudo mv crossplane /usr/local/bin/

# 验证
kubectl crossplane --version
```

### 3.4 创建 AWS Provider

```yaml
# provider-aws.yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws
spec:
  package: xpkg.upbound.io/crossplane-contrib/provider-aws:v0.47.0
  runtimeConfig:
    apiVersion: pkg.crossplane.io/v1beta1
    kind: DeploymentRuntimeConfig
    name: provider-aws-config
---
# 可选：配置 Provider 的运行时参数
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: provider-aws-config
spec:
  runtimeConfigRef:
    name: provider-aws-config
  deploymentTemplate:
    spec:
      replicas: 1
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              resources:
                limits:
                  cpu: 512m
                  memory: 512Mi
                requests:
                  cpu: 256m
                  memory: 256Mi
```

```bash
kubectl apply -f provider-aws.yaml

# 等待 Provider 就绪
kubectl get provider
# NAME           INSTALLED   HEALTHY   AGE
# provider-aws   True        True      2m
```

### 3.5 配置 AWS 认证凭据

Crossplane 需要 AWS 访问凭据来管理云资源。推荐使用 IRSA（IAM Roles for Service Accounts）或静态凭据。

**方式一：静态凭据（开发环境推荐）**

```bash
# 创建 AWS 凭据文件
cat > aws-credentials.txt << EOF
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
EOF

# 创建 Kubernetes Secret
kubectl create secret generic aws-creds \
  -n crossplane-system \
  --from-file=creds=./aws-credentials.txt

# 创建 ProviderConfig 引用该 Secret
```

```yaml
# provider-config-aws.yaml
apiVersion: aws.crossplane.io/v1beta1
kind: ProviderConfig
metadata:
  name: default
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: aws-creds
      key: creds
```

**方式二：IRSA（生产环境推荐）**

```yaml
# provider-config-aws-irsa.yaml
apiVersion: aws.crossplane.io/v1beta1
kind: ProviderConfig
metadata:
  name: default
spec:
  credentials:
    source: InjectedIdentity
```

```bash
# 为 Crossplane Service Account 注解 IAM Role
kubectl annotate serviceaccount -n crossplane-system \
  provider-aws-xxx \
  eks.amazonaws.com/role-arn=arn:aws:iam::123456789012:role/crossplane-role
```

### 3.6 安装 AWS 子 Provider（可选）

Crossplane 社区将 AWS Provider 拆分为多个子 Provider，以减少 CRD 数量和资源消耗：

```yaml
# 仅安装 RDS 子 Provider
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-rds
spec:
  package: xpkg.upbound.io/crossplane-contrib/provider-aws-rds:v0.47.0
---
# 仅安装 S3 子 Provider
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-s3
spec:
  package: xpkg.upbound.io/crossplane-contrib/provider-aws-s3:v0.47.0
---
# 仅安装 EC2 子 Provider（VPC、Security Group 等）
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-ec2
spec:
  package: xpkg.upbound.io/crossplane-contrib/provider-aws-ec2:v0.47.0
```

---

## 四、创建 XRD（CompositeResourceDefinition）

XRD 是 Crossplane 的核心抽象层。通过 XRD，平台团队可以为应用团队提供简化的、标准化的基础设施 API。

### 4.1 定义数据库 XRD

```yaml
# xrd-database.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xpostgresqlinstances.database.example.com
spec:
  group: database.example.com
  names:
    kind: XPostgreSQLInstance
    plural: xpostgresqlinstances
  claimNames:
    kind: PostgreSQLInstance
    plural: postgresqlinstances
  connectionSecretKeys:
    - endpoint
    - port
    - username
    - password
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                parameters:
                  type: object
                  description: "数据库参数"
                  properties:
                    storageGB:
                      type: integer
                      description: "存储容量（GB）"
                      minimum: 20
                      maximum: 1000
                      default: 50
                    engineVersion:
                      type: string
                      description: "PostgreSQL 版本"
                      enum: ["13", "14", "15", "16"]
                      default: "16"
                    instanceClass:
                      type: string
                      description: "RDS 实例类型"
                      enum:
                        - db.t3.micro
                        - db.t3.small
                        - db.t3.medium
                        - db.r6g.large
                        - db.r6g.xlarge
                      default: db.t3.micro
                    multiAZ:
                      type: boolean
                      description: "是否启用多可用区部署"
                      default: false
                    backupRetentionPeriod:
                      type: integer
                      description: "备份保留天数"
                      minimum: 1
                      maximum: 35
                      default: 7
                    deletionPolicy:
                      type: string
                      enum: [Delete, Orphan]
                      default: Orphan
                  required:
                    - storageGB
                compositionSelector:
                  type: object
                  properties:
                    matchLabels:
                      type: object
                      additionalProperties:
                        type: string
              required:
                - parameters
            status:
              type: object
              properties:
                endpoint:
                  type: string
                  description: "数据库连接端点"
                port:
                  type: integer
                  description: "数据库端口"
                instanceId:
                  type: string
                  description: "RDS 实例 ID"
```

### 4.2 定义存储桶 XRD

```yaml
# xrd-bucket.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xs3buckets.storage.example.com
spec:
  group: storage.example.com
  names:
    kind: XS3Bucket
    plural: xs3buckets
  claimNames:
    kind: S3Bucket
    plural: s3buckets
  connectionSecretKeys:
    - bucketName
    - bucketArn
    - region
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                parameters:
                  type: object
                  properties:
                    region:
                      type: string
                      description: "AWS 区域"
                      default: us-east-1
                    versioning:
                      type: boolean
                      description: "是否启用版本控制"
                      default: true
                    encryption:
                      type: boolean
                      description: "是否启用服务端加密"
                      default: true
                    lifecycleDays:
                      type: integer
                      description: "对象生命周期天数（0 表示不启用）"
                      minimum: 0
                      maximum: 365
                      default: 0
                    publicAccessBlock:
                      type: boolean
                      description: "是否阻止公共访问"
                      default: true
                    tags:
                      type: object
                      additionalProperties:
                        type: string
                      description: "资源标签"
                  required:
                    - region
              required:
                - parameters
```

### 4.3 XRD 的最佳实践

1. **合理的默认值**：为大多数参数设置安全的默认值，降低应用团队的使用门槛
2. **枚举约束**：使用 `enum` 限制实例类型、引擎版本等，防止配置错误
3. **最小/最大值**：使用 `minimum`/`maximum` 约束存储、备份等数值参数
4. **连接密钥**：通过 `connectionSecretKeys` 定义需要暴露给应用的连接信息
5. **命名规范**：XRD 命名使用 `X` 前缀，Claim 命名保持简洁

---

## 五、创建 Composition

Composition 是 Crossplane 的"胶水层"，它将抽象的 XRD 参数映射到底层的 Provider 资源。

### 5.1 AWS RDS Composition

```yaml
# composition-rds-aws.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: xpostgresqlinstances.aws.database.example.com
  labels:
    provider: aws
    environment: production
spec:
  compositeTypeRef:
    apiVersion: database.example.com/v1alpha1
    kind: XPostgreSQLInstance
  writeConnectionSecretsToNamespace: crossplane-system
  patchSets:
    - name: common
      patches:
        - type: FromCompositeFieldPath
          fromFieldPath: metadata.labels
          toFieldPath: metadata.labels
        - type: FromCompositeFieldPath
          fromFieldPath: spec.compositionSelector.matchLabels
          toFieldPath: metadata.labels
  resources:
    # 1. RDS DBSubnetGroup
    - name: dbSubnetGroup
      base:
        apiVersion: rds.aws.crossplane.io/v1alpha1
        kind: DBSubnetGroup
        spec:
          forProvider:
            description: "Crossplane managed DB subnet group"
            subnetIds:
              - subnet-0123456789abcdef0
              - subnet-0123456789abcdef1
            tags:
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "crossplane-%s"
          toFieldPath: metadata.annotations[crossplane.io/external-name]
    # 2. Security Group
    - name: securityGroup
      base:
        apiVersion: ec2.aws.crossplane.io/v1beta1
        kind: SecurityGroup
        spec:
          forProvider:
            description: "Crossplane managed RDS security group"
            vpcId: vpc-0123456789abcdef0
            ingress:
              - fromPort: 5432
                toPort: 5432
                ipProtocol: tcp
                ipRanges:
                  - cidrIp: 10.0.0.0/16
                    description: "Allow PostgreSQL from VPC"
            tags:
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "crossplane-rds-sg-%s"
          toFieldPath: metadata.annotations[crossplane.io/external-name]
    # 3. RDS DBInstance
    - name: dbInstance
      base:
        apiVersion: rds.aws.crossplane.io/v1alpha1
        kind: DBInstance
        spec:
          forProvider:
            engine: postgres
            publiclyAccessible: false
            autoMinorVersionUpgrade: true
            copyTagsToSnapshot: true
            storageEncrypted: true
            monitoringInterval: 60
            performanceInsightsEnabled: true
            deletionProtection: true
            tags:
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default
          writeConnectionSecretToRef:
            namespace: crossplane-system
      patches:
        # 引擎版本
        - fromFieldPath: spec.parameters.engineVersion
          toFieldPath: spec.forProvider.engineVersion
        # 实例类型
        - fromFieldPath: spec.parameters.instanceClass
          toFieldPath: spec.forProvider.dbInstanceClass
        # 存储容量
        - fromFieldPath: spec.parameters.storageGB
          toFieldPath: spec.forProvider.allocatedStorage
        # 多可用区
        - fromFieldPath: spec.parameters.multiAZ
          toFieldPath: spec.forProvider.multiAZ
        # 备份保留
        - fromFieldPath: spec.parameters.backupRetentionPeriod
          toFieldPath: spec.forProvider.backupRetentionPeriod
        # 引用安全组
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.deletionPolicy
          toFieldPath: spec.deletionPolicy
        # 连接密钥名称
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "crossplane-rds-%s"
          toFieldPath: spec.writeConnectionSecretToRef.name
      connectionDetails:
        - name: endpoint
          fromConnectionSecretKey: endpoint
        - name: port
          fromConnectionSecretKey: port
        - name: username
          fromConnectionSecretKey: username
        - name: password
          fromConnectionSecretKey: password
```

### 5.2 使用 Patch 和 Transform

Crossplane 的 Patch 机制非常强大，支持多种转换方式：

```yaml
# 示例：字符串拼接、数学运算、条件映射
patches:
  # 字符串格式化
  - type: CombineFromComposite
    combine:
      variables:
        - fromFieldPath: metadata.labels[environment]
        - fromFieldPath: spec.parameters.engineVersion
      strategy: string
      string:
        fmt: "db-%s-v%s"
    toFieldPath: metadata.annotations[crossplane.io/external-name]

  # 数学运算
  - type: CombineFromComposite
    combine:
      variables:
        - fromFieldPath: spec.parameters.storageGB
      strategy: string
      string:
        fmt: "%d"
    toFieldPath: spec.forProvider.allocatedStorage

  # 字符串转换
  - type: FromCompositeFieldPath
    fromFieldPath: spec.parameters.region
    toFieldPath: spec.forProvider.region
    transforms:
      - type: string
        string:
          type: Regexp
          regexp:
            match: 'us-east-1'
            group: 0
```

### 5.3 使用 EnvironmentConfig 注入全局配置

```yaml
# environment-config.yaml
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: EnvironmentConfig
metadata:
  name: aws-production
data:
  region: us-east-1
  vpcId: vpc-0123456789abcdef0
  privateSubnetIds:
    - subnet-0123456789abcdef0
    - subnet-0123456789abcdef1
  publicSubnetIds:
    - subnet-0123456789abcdef2
    - subnet-0123456789abcdef3
  tags:
    Environment: production
    ManagedBy: crossplane
    Team: platform
```

```yaml
# 在 Composition 中引用 EnvironmentConfig
resources:
  - name: dbInstance
    base:
      # ...
    patches:
      - type: FromEnvironmentFieldPath
        fromFieldPath: region
        toFieldPath: spec.forProvider.region
      - type: FromEnvironmentFieldPath
        fromFieldPath: vpcId
        toFieldPath: spec.forProvider.vpcId
    environment:
      environmentConfigs:
        - type: Reference
          ref:
            name: aws-production
```

---

## 六、Provider 资源实战：AWS 声明式管理

### 6.1 创建 VPC

```yaml
# vpc.yaml
apiVersion: ec2.aws.crossplane.io/v1beta1
kind: VPC
metadata:
  name: production-vpc
spec:
  forProvider:
    cidrBlock: 10.0.0.0/16
    enableDnsSupport: true
    enableDnsHostnames: true
    instanceTenancy: default
    tags:
      - key: Name
        value: production-vpc
      - key: Environment
        value: production
      - key: ManagedBy
        value: crossplane
  providerConfigRef:
    name: default
```

```yaml
# subnet.yaml
apiVersion: ec2.aws.crossplane.io/v1beta1
kind: Subnet
metadata:
  name: production-private-subnet-1a
spec:
  forProvider:
    cidrBlock: 10.0.1.0/24
    vpcId: production-vpc  # 引用 Crossplane 管理的 VPC
    availabilityZone: us-east-1a
    mapPublicIpOnLaunch: false
    tags:
      - key: Name
        value: production-private-1a
      - key: kubernetes.io/role/internal-elb
        value: "1"
  providerConfigRef:
    name: default
```

### 6.2 创建 S3 存储桶

```yaml
# s3-bucket.yaml
apiVersion: s3.aws.crossplane.io/v1beta1
kind: Bucket
metadata:
  name: production-app-assets
spec:
  forProvider:
    acl: private
    locationConstraint: us-east-1
    versioningConfiguration:
      status: Enabled
    serverSideEncryptionConfiguration:
      rules:
        - applyServerSideEncryptionByDefault:
            sseAlgorithm: AES256
    publicAccessBlockConfiguration:
      blockPublicAcls: true
      blockPublicPolicy: true
      ignorePublicAcls: true
      restrictPublicBuckets: true
    lifecycleConfiguration:
      rules:
        - id: expire-old-objects
          status: Enabled
          expirationInDays: 90
          transitions:
            - days: 30
              storageClass: STANDARD_IA
            - days: 60
              storageClass: GLACIER
    tagging:
      tagSet:
        - key: Environment
          value: production
        - key: Application
          value: laravel-app
  providerConfigRef:
    name: default
```

### 6.3 创建 IAM 角色和策略

```yaml
# iam-role.yaml
apiVersion: iam.aws.crossplane.io/v1beta1
kind: Role
metadata:
  name: eks-pod-role
spec:
  forProvider:
    assumeRolePolicyDocument: |
      {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": {
              "Federated": "arn:aws:iam::123456789012:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
              "StringEquals": {
                "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:production:laravel-sa"
              }
            }
          }
        ]
      }
    tags:
      - key: Environment
        value: production
  providerConfigRef:
    name: default
---
# iam-policy.yaml
apiVersion: iam.aws.crossplane.io/v1beta1
kind: Policy
metadata:
  name: s3-access-policy
spec:
  forProvider:
    name: crossplane-s3-access
    document: |
      {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Action": [
              "s3:GetObject",
              "s3:PutObject",
              "s3:DeleteObject",
              "s3:ListBucket"
            ],
            "Resource": [
              "arn:aws:s3:::production-app-assets",
              "arn:aws:s3:::production-app-assets/*"
            ]
          }
        ]
      }
  providerConfigRef:
    name: default
```

### 6.4 资源引用与依赖管理

Crossplane 支持跨资源引用，确保资源创建顺序正确：

```yaml
# 引用其他 Crossplane 管理的资源
apiVersion: rds.aws.crossplane.io/v1alpha1
kind: DBInstance
metadata:
  name: production-db
spec:
  forProvider:
    dbSubnetGroupNameSelector:
      matchLabels:
        crossplane.io/composite: my-xr-name
    vpcSecurityGroupIds:
      - securityGroupIdSelector:
          matchLabels:
            purpose: rds-access
  providerConfigRef:
    name: default
```

---

## 七、GitOps 集成：用 ArgoCD 管理 Crossplane 资源

### 7.1 为什么 Crossplane 天然适合 GitOps？

Crossplane 与 GitOps 的结合几乎是完美的：

- **声明式 API**：所有 Crossplane 资源都是 Kubernetes YAML，天然适配 Git 存储
- **持续 reconciliation**：Kubernetes 控制器确保实际状态与声明状态一致
- **可观测性**：通过 `kubectl get`、`kubectl describe` 可以查看资源状态
- **版本控制**：所有基础设施变更都有 Git 历史记录
- **回滚能力**：`git revert` 即可回滚基础设施变更

### 7.2 GitOps 仓库结构

```
infrastructure/
├── crossplane/
│   ├── providers/
│   │   ├── provider-aws.yaml
│   │   └── provider-config.yaml
│   ├── xrd/
│   │   ├── xrd-database.yaml
│   │   ├── xrd-bucket.yaml
│   │   └── xrd-vpc.yaml
│   ├── compositions/
│   │   ├── composition-database-aws.yaml
│   │   ├── composition-bucket-aws.yaml
│   │   └── composition-vpc-aws.yaml
│   └── environment-configs/
│       ├── production.yaml
│       └── staging.yaml
├── platform/
│   ├── production/
│   │   ├── database.yaml        # Claim
│   │   ├── bucket.yaml          # Claim
│   │   └── vpc.yaml             # Claim
│   └── staging/
│       ├── database.yaml
│       └── bucket.yaml
└── argocd/
    ├── applicationset.yaml
    └── applications/
        ├── crossplane-system.yaml
        ├── crossplane-xrd.yaml
        ├── crossplane-compositions.yaml
        └── platform-resources.yaml
```

### 7.3 ArgoCD Application 配置

```yaml
# argocd-app-crossplane-xrd.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: crossplane-xrd
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "10"
spec:
  project: infrastructure
  source:
    repoURL: https://github.com/your-org/infrastructure.git
    targetRevision: main
    path: crossplane/xrd
  destination:
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - PruneLast=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
---
# argocd-app-crossplane-compositions.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: crossplane-compositions
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "20"
spec:
  project: infrastructure
  source:
    repoURL: https://github.com/your-org/infrastructure.git
    targetRevision: main
    path: crossplane/compositions
  destination:
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
---
# argocd-app-platform-resources.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: platform-production
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "30"
spec:
  project: infrastructure
  source:
    repoURL: https://github.com/your-org/infrastructure.git
    targetRevision: main
    path: platform/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

### 7.4 ArgoCD ApplicationSet（多环境管理）

```yaml
# applicationset-crossplane.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: crossplane-platform
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: production
            revision: main
            syncPolicy: automated
          - env: staging
            revision: develop
            syncPolicy: automated
  template:
    metadata:
      name: 'platform-{{env}}'
      annotations:
        argocd.argoproj.io/sync-wave: "30"
    spec:
      project: infrastructure
      source:
        repoURL: https://github.com/your-org/infrastructure.git
        targetRevision: '{{revision}}'
        path: 'platform/{{env}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{env}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

### 7.5 Crossplane 资源在 ArgoCD 中的同步注意事项

Crossplane 资源在 ArgoCD 中同步时需要注意以下几点：

1. **Provider 资源同步较慢**：Provider 安装可能需要 2-5 分钟，需要配置合理的超时时间
2. **XRD 依赖关系**：XRD 必须在 Composition 之前创建，使用 `sync-wave` 控制顺序
3. **Connection Secret 不可回滚**：Crossplane 创建的连接密钥不应被 ArgoCD 管理
4. **ManagedResource 状态字段**：某些 Provider 资源的 status 会频繁更新，可能导致 ArgoCD 显示 OutOfSync

```yaml
# argocd-cm ConfigMap 忽略 status 字段
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  resource.customizations.health.rds.aws.crossplane.io_DBInstance: |
    hs = {}
    hs.status = "Progressing"
    hs.message = ""
    if obj.status ~= nil then
      if obj.status.atProvider.dbInstanceStatus ~= nil then
        if obj.status.atProvider.dbInstanceStatus == "available" then
          hs.status = "Healthy"
          hs.message = "DB instance is available"
        elseif obj.status.atProvider.dbInstanceStatus == "creating" or
               obj.status.atProvider.dbInstanceStatus == "modifying" then
          hs.status = "Progressing"
          hs.message = "DB instance is " .. obj.status.atProvider.dbInstanceStatus
        else
          hs.status = "Degraded"
          hs.message = "DB instance is " .. obj.status.atProvider.dbInstanceStatus
        end
      end
    end
    return hs
```

---

## 八、策略执行：合规检查

### 8.1 使用 OPA/Gatekeeper 约束 Crossplane 资源

```yaml
# ConstraintTemplate: 确保所有 RDS 实例启用加密
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8senforcerdsencryption
spec:
  crd:
    spec:
      names:
        kind: K8sEnforceRDSEncryption
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8senforcerdsencryption

        violation[{"msg": msg}] {
          input.review.kind.kind == "DBInstance"
          not input.review.object.spec.forProvider.storageEncrypted
          msg := "RDS DBInstance must have storageEncrypted set to true"
        }

        violation[{"msg": msg}] {
          input.review.kind.kind == "XPostgreSQLInstance"
          input.review.object.spec.parameters.deletionPolicy == "Delete"
          msg := "Production databases should use Orphan deletion policy"
        }
---
# Constraint: 应用到所有 RDS 实例
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sEnforceRDSEncryption
metadata:
  name: enforce-rds-encryption
spec:
  match:
    kinds:
      - apiGroups: ["rds.aws.crossplane.io"]
        kinds: ["DBInstance"]
      - apiGroups: ["database.example.com"]
        kinds: ["XPostgreSQLInstance"]
```

### 8.2 使用 Kyverno 策略

```yaml
# Kyverno Policy: 确保 S3 存储桶阻止公共访问
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: enforce-s3-private-access
  annotations:
    policies.kyverno.io/title: Enforce S3 Private Access
    policies.kyverno.io/description: >-
      All S3 buckets managed by Crossplane must have
      public access block configuration enabled.
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: check-s3-public-access-block
      match:
        any:
          - resources:
              kinds:
                - Bucket
              apiVersions:
                - s3.aws.crossplane.io/v1beta1
      validate:
        message: >-
          S3 Bucket must have publicAccessBlockConfiguration
          with all four settings set to true.
        pattern:
          spec:
            forProvider:
              publicAccessBlockConfiguration:
                blockPublicAcls: true
                blockPublicPolicy: true
                ignorePublicAcls: true
                restrictPublicBuckets: true
    - name: check-s3-encryption
      match:
        any:
          - resources:
              kinds:
                - Bucket
              apiVersions:
                - s3.aws.crossplane.io/v1beta1
      validate:
        message: "S3 Bucket must have server-side encryption enabled."
        pattern:
          spec:
            forProvider:
              serverSideEncryptionConfiguration:
                rules:
                  - applyServerSideEncryptionByDefault:
                      sseAlgorithm: "^(AES256|aws:kms)$"
---
# Kyverno Policy: 强制标签规范
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-crossplane-tags
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-required-tags
      match:
        any:
          - resources:
              kinds:
                - Bucket
                - DBInstance
                - VPC
      validate:
        message: "All Crossplane managed resources must have Environment and ManagedBy tags."
        pattern:
          spec:
            forProvider:
              tags:
                - key: Environment
                  value: "?*"
                - key: ManagedBy
                  value: crossplane
```

### 8.3 OPA/Gatekeeper 约束模板：限制实例类型

```yaml
# 限制数据库实例类型（禁止使用生产环境过小的实例）
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srestrictdbinstanceclass
spec:
  crd:
    spec:
      names:
        kind: K8sRestrictDBInstanceClass
      validation:
        openAPIV3Schema:
          type: object
          properties:
            allowedClasses:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srestrictdbinstanceclass

        violation[{"msg": msg}] {
          input.review.kind.kind == "XPostgreSQLInstance"
          instance_class := input.review.object.spec.parameters.instanceClass
          not instance_class_allowed(instance_class)
          allowed := concat(", ", input.parameters.allowedClasses)
          msg := sprintf("Instance class '%v' is not allowed. Allowed classes: [%v]", [instance_class, allowed])
        }

        instance_class_allowed(class) {
          input.parameters.allowedClasses[_] == class
        }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRestrictDBInstanceClass
metadata:
  name: restrict-db-instance-class-production
spec:
  match:
    kinds:
      - apiGroups: ["database.example.com"]
        kinds: ["XPostgreSQLInstance"]
    namespaceSelector:
      matchLabels:
        environment: production
  parameters:
    allowedClasses:
      - db.r6g.large
      - db.r6g.xlarge
      - db.r6g.2xlarge
```

---

## 九、完整 Laravel 项目基础设施编排示例

### 9.1 架构概览

我们将为一个 Laravel 项目创建完整的 AWS 基础设施：

```
┌─────────────────────────────────────────────────────┐
│                 Laravel Application                  │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │   EKS    │  │   RDS    │  │       S3         │  │
│  │ Cluster  │  │ Postgres │  │ Assets Bucket    │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────────┘  │
│       │              │               │              │
│  ┌────┴──────────────┴───────────────┴───────────┐  │
│  │                    VPC                         │  │
│  │  ┌────────────┐  ┌────────────┐               │  │
│  │  │  Private   │  │  Public    │               │  │
│  │  │  Subnets   │  │  Subnets   │               │  │
│  │  └────────────┘  └────────────┘               │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 9.2 XRD 定义：Laravel 应用基础设施

```yaml
# xrd-laravel-app.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xlaravelapps.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XLaravelApp
    plural: xlaravelapps
  claimNames:
    kind: LaravelApp
    plural: laravelapps
  connectionSecretKeys:
    - databaseEndpoint
    - databasePort
    - databaseName
    - databaseUsername
    - databasePassword
    - s3BucketName
    - s3BucketArn
    - eksClusterEndpoint
    - eksClusterCa
    - eksClusterToken
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                parameters:
                  type: object
                  properties:
                    environment:
                      type: string
                      enum: [development, staging, production]
                    region:
                      type: string
                      default: us-east-1
                    # VPC 配置
                    vpc:
                      type: object
                      properties:
                        cidrBlock:
                          type: string
                          default: 10.0.0.0/16
                    # 数据库配置
                    database:
                      type: object
                      properties:
                        engineVersion:
                          type: string
                          enum: ["14", "15", "16"]
                          default: "16"
                        instanceClass:
                          type: string
                          enum: [db.t3.micro, db.t3.small, db.t3.medium, db.r6g.large]
                          default: db.t3.medium
                        storageGB:
                          type: integer
                          minimum: 20
                          maximum: 1000
                          default: 100
                        multiAZ:
                          type: boolean
                          default: false
                        backupRetentionPeriod:
                          type: integer
                          minimum: 1
                          maximum: 35
                          default: 14
                    # 存储桶配置
                    storage:
                      type: object
                      properties:
                        versioning:
                          type: boolean
                          default: true
                        lifecycleDays:
                          type: integer
                          default: 90
                    # EKS 配置
                    eks:
                      type: object
                      properties:
                        version:
                          type: string
                          enum: ["1.28", "1.29", "1.30"]
                          default: "1.30"
                        nodeInstanceType:
                          type: string
                          enum: [t3.medium, t3.large, m5.large, m5.xlarge]
                          default: t3.medium
                        desiredNodes:
                          type: integer
                          minimum: 2
                          maximum: 10
                          default: 3
                        maxNodes:
                          type: integer
                          minimum: 3
                          maximum: 20
                          default: 6
                  required:
                    - environment
              required:
                - parameters
```

### 9.3 Composition：Laravel 应用完整基础设施

```yaml
# composition-laravel-aws.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: xlaravelapps.aws.platform.example.com
  labels:
    provider: aws
    application: laravel
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XLaravelApp
  writeConnectionSecretsToNamespace: crossplane-system
  resources:
    # ==================== VPC ====================
    - name: vpc
      base:
        apiVersion: ec2.aws.crossplane.io/v1beta1
        kind: VPC
        spec:
          forProvider:
            enableDnsSupport: true
            enableDnsHostnames: true
            instanceTenancy: default
            tags:
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default
      patches:
        - fromFieldPath: spec.parameters.vpc.cidrBlock
          toFieldPath: spec.forProvider.cidrBlock
        - fromFieldPath: spec.parameters.region
          toFieldPath: spec.forProvider.region
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "laravel-%s-vpc-%s"
          toFieldPath: metadata.annotations[crossplane.io/external-name]

    # ==================== Private Subnets ====================
    - name: privateSubnet1
      base:
        apiVersion: ec2.aws.crossplane.io/v1beta1
        kind: Subnet
        spec:
          forProvider:
            cidrBlock: 10.0.1.0/24
            availabilityZone: us-east-1a
            mapPublicIpOnLaunch: false
            tags:
              - key: kubernetes.io/role/internal-elb
                value: "1"
          providerConfigRef:
            name: default
      patches:
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.region
          toFieldPath: spec.forProvider.region
          transforms:
            - type: string
              string:
                fmt: "%sa"
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "laravel-%s-private-1-%s"
          toFieldPath: metadata.annotations[crossplane.io/external-name]

    - name: privateSubnet2
      base:
        apiVersion: ec2.aws.crossplane.io/v1beta1
        kind: Subnet
        spec:
          forProvider:
            cidrBlock: 10.0.2.0/24
            availabilityZone: us-east-1b
            mapPublicIpOnLaunch: false
            tags:
              - key: kubernetes.io/role/internal-elb
                value: "1"
          providerConfigRef:
            name: default
      patches:
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.region
          toFieldPath: spec.forProvider.region
          transforms:
            - type: string
              string:
                fmt: "%sb"

    # ==================== RDS PostgreSQL ====================
    - name: dbSubnetGroup
      base:
        apiVersion: rds.aws.crossplane.io/v1alpha1
        kind: DBSubnetGroup
        spec:
          forProvider:
            description: "Laravel application DB subnet group"
            tags:
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default

    - name: rdsSecurityGroup
      base:
        apiVersion: ec2.aws.crossplane.io/v1beta1
        kind: SecurityGroup
        spec:
          forProvider:
            description: "Laravel RDS security group"
            ingress:
              - fromPort: 5432
                toPort: 5432
                ipProtocol: tcp
                ipRanges:
                  - cidrIp: 10.0.0.0/16
            tags:
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default

    - name: database
      base:
        apiVersion: rds.aws.crossplane.io/v1alpha1
        kind: DBInstance
        spec:
          forProvider:
            engine: postgres
            engineVersion: "16"
            dbInstanceClass: db.t3.medium
            masterUsername: laravel
            allocatedStorage: 100
            storageType: gp3
            storageEncrypted: true
            publiclyAccessible: false
            autoMinorVersionUpgrade: true
            copyTagsToSnapshot: true
            deletionProtection: true
            performanceInsightsEnabled: true
            monitoringInterval: 60
            backupRetentionPeriod: 14
            preferredBackupWindow: "03:00-04:00"
            preferredMaintenanceWindow: "sun:05:00-sun:06:00"
            tags:
              - key: Application
                value: laravel
              - key: ManagedBy
                value: crossplane
          providerConfigRef:
            name: default
          writeConnectionSecretToRef:
            namespace: crossplane-system
      patches:
        - fromFieldPath: spec.parameters.database.engineVersion
          toFieldPath: spec.forProvider.engineVersion
        - fromFieldPath: spec.parameters.database.instanceClass
          toFieldPath: spec.forProvider.dbInstanceClass
        - fromFieldPath: spec.parameters.database.storageGB
          toFieldPath: spec.forProvider.allocatedStorage
        - fromFieldPath: spec.parameters.database.multiAZ
          toFieldPath: spec.forProvider.multiAZ
        - fromFieldPath: spec.parameters.database.backupRetentionPeriod
          toFieldPath: spec.forProvider.backupRetentionPeriod
        - fromFieldPath: spec.parameters.environment
          toFieldPath: spec.forProvider.tags[1].value
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "laravel-%s-db-%s"
          toFieldPath: metadata.annotations[crossplane.io/external-name]
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "laravel-db-conn-%s"
          toFieldPath: spec.writeConnectionSecretToRef.name
      connectionDetails:
        - name: databaseEndpoint
          fromConnectionSecretKey: endpoint
        - name: databasePort
          fromConnectionSecretKey: port
        - name: databaseName
          fromConnectionSecretKey: dbname
        - name: databaseUsername
          fromConnectionSecretKey: username
        - name: databasePassword
          fromConnectionSecretKey: password

    # ==================== S3 Bucket ====================
    - name: assetsBucket
      base:
        apiVersion: s3.aws.crossplane.io/v1beta1
        kind: Bucket
        spec:
          forProvider:
            acl: private
            versioningConfiguration:
              status: Enabled
            serverSideEncryptionConfiguration:
              rules:
                - applyServerSideEncryptionByDefault:
                    sseAlgorithm: AES256
            publicAccessBlockConfiguration:
              blockPublicAcls: true
              blockPublicPolicy: true
              ignorePublicAcls: true
              restrictPublicBuckets: true
            tagging:
              tagSet:
                - key: Application
                  value: laravel
                - key: ManagedBy
                  value: crossplane
          providerConfigRef:
            name: default
      patches:
        - fromFieldPath: spec.parameters.region
          toFieldPath: spec.forProvider.locationConstraint
        - fromFieldPath: spec.parameters.storage.versioning
          toFieldPath: spec.forProvider.versioningConfiguration.status
          transforms:
            - type: map
              map:
                true: Enabled
                false: Suspended
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.uid
            strategy: string
            string:
              fmt: "laravel-%s-assets-%s"
          toFieldPath: metadata.annotations[crossplane.io/external-name]
      connectionDetails:
        - name: s3BucketName
          fromConnectionSecretKey: bucketName
        - name: s3BucketArn
          fromConnectionSecretKey: bucketArn
```

### 9.4 使用 Claim 创建 Laravel 应用基础设施

```yaml
# laravel-app-production.yaml
apiVersion: platform.example.com/v1alpha1
kind: LaravelApp
metadata:
  name: laravel-api
  namespace: production
spec:
  parameters:
    environment: production
    region: us-east-1
    vpc:
      cidrBlock: 10.0.0.0/16
    database:
      engineVersion: "16"
      instanceClass: db.r6g.large
      storageGB: 200
      multiAZ: true
      backupRetentionPeriod: 30
    storage:
      versioning: true
      lifecycleDays: 180
    eks:
      version: "1.30"
      nodeInstanceType: m5.large
      desiredNodes: 3
      maxNodes: 10
  compositionSelector:
    matchLabels:
      provider: aws
```

```yaml
# laravel-app-staging.yaml
apiVersion: platform.example.com/v1alpha1
kind: LaravelApp
metadata:
  name: laravel-api
  namespace: staging
spec:
  parameters:
    environment: staging
    region: us-east-1
    database:
      engineVersion: "16"
      instanceClass: db.t3.small
      storageGB: 50
      multiAZ: false
      backupRetentionPeriod: 7
    storage:
      versioning: true
      lifecycleDays: 30
    eks:
      version: "1.30"
      nodeInstanceType: t3.medium
      desiredNodes: 2
      maxNodes: 4
  compositionSelector:
    matchLabels:
      provider: aws
```

### 9.5 部署与验证

```bash
# 应用 XRD
kubectl apply -f xrd-laravel-app.yaml

# 等待 XRD 建立
kubectl get xrd xlaravelapps.platform.example.com
# NAME                              ESTABLISHED   OFFERED   AGE
# xlaravelapps.platform.example.com  True          True      30s

# 应用 Composition
kubectl apply -f composition-laravel-aws.yaml

# 应用 Claim
kubectl apply -f laravel-app-production.yaml

# 查看 Claim 状态
kubectl get laravelapp -n production
# NAME          READY   CONNECTION-SECRET   AGE
# laravel-api   True    laravel-db-conn-xxx   5m

# 查看底层 CompositeResource
kubectl get xlaravelapp
# NAME                    READY   COMPOSITION                                          AGE
# laravel-api-abc12       True    xlaravelapps.aws.platform.example.com                5m

# 查看所有 ManagedResource
kubectl get managed
# NAME                                                    READY   SYNCED   AGE
# vpc-xxx                                                 True    True     5m
# subnet-xxx-1a                                           True    True     5m
# subnet-xxx-1b                                           True    True     5m
# dbinstance-xxx                                          True    True     4m
# dbsubnetgroup-xxx                                       True    True     4m
# securitygroup-xxx                                       True    True     4m
# bucket-xxx                                              True    True     3m
```

---

## 十、可观测性与调试

### 10.1 kubectl crossplane CLI

Crossplane 提供了专门的 CLI 插件来简化调试：

```bash
# 查看 Crossplane 组件状态
kubectl crossplane status

# 查看 XRD 详情
kubectl crossplane describe xrd xlaravelapps.platform.example.com

# 查看 Composition 详情
kubectl crossplane describe composition xlaravelapps.aws.platform.example.com

# 查看 Provider 详情
kubectl crossplane describe provider provider-aws

# 查看 ManagedResource 详情
kubectl crossplane describe managed dbinstance-xxx
```

### 10.2 使用 kubectl 原生命令调试

```bash
# 查看所有 Crossplane 相关资源
kubectl get xrd,composition,provider,providerconfig

# 查看 ManagedResource 的详细状态
kubectl get dbinstance xxx -o yaml

# 查看资源事件（关键调试手段）
kubectl describe dbinstance xxx
# Events:
#   Type    Reason             Age   From                  Message
#   ----    ------             ----  ----                  -------
#   Normal  ApplyPending       5m    managed/dbinstance    Waiting for managed resource to be connectable
#   Normal  ApplySucceeded     4m    managed/dbinstance    Successfully applied manifest

# 查看 XR 的 conditions
kubectl get xlaravelapp xxx -o jsonpath='{.status.conditions}' | jq .

# 查看 Claim 的连接密钥
kubectl get secret -n production laravel-api-conn-xxx -o yaml

# 按标签筛选资源
kubectl get managed -l crossplane.io/composite=laravel-api-abc12
```

### 10.3 Provider 日志分析

```bash
# 查看 Provider Pod 日志
kubectl logs -n crossplane-system -l pkg.crossplane.io/revision-name=provider-aws-xxx -f

# 搜索特定资源的 reconcile 日志
kubectl logs -n crossplane-system -l pkg.crossplane.io/revision-name=provider-aws-xxx | grep "dbinstance-xxx"

# 查看 Provider 的 events
kubectl get events -n crossplane-system --field-selector involvedObject.name=provider-aws-xxx
```

### 10.4 常见问题排查清单

```bash
# 1. Provider 未就绪
kubectl get provider provider-aws -o jsonpath='{.status.conditions}' | jq .
# 检查 PackageRevision 是否正常
kubectl get packagerevision

# 2. XRD 未建立
kubectl get xrd xlaravelapps.platform.example.com -o jsonpath='{.status.conditions}' | jq .
# 确认 CRD 已创建
kubectl get crd xlaravelapps.platform.example.com

# 3. ManagedResource 同步失败
kubectl describe managed dbinstance-xxx
# 查看 status.condition 中的 message
kubectl get dbinstance xxx -o jsonpath='{.status.conditions[?(@.type=="Synced")].message}' | jq .

# 4. 连接密钥未创建
# 检查 writeConnectionSecretToRef 配置
# 检查 RBAC 权限（crossplane 需要 Secret 写权限）

# 5. Composition patch 失败
kubectl get compositeResource xxx -o jsonpath='{.status.conditions}' | jq .
# 检查 patch 的 fromFieldPath 和 toFieldPath 是否正确
```

### 10.5 监控指标

Crossplane 暴露 Prometheus 指标，可用于 Grafana 监控：

```yaml
# Prometheus ServiceMonitor
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: crossplane
  namespace: crossplane-system
spec:
  selector:
    matchLabels:
      app: crossplane
  endpoints:
    - port: metrics
      interval: 30s
```

关键指标：
- `crossplane_managed_resource_count`：ManagedResource 总数
- `crossplane_reconcile_total`：Reconcile 总次数
- `crossplane_reconcile_errors_total`：Reconcile 错误次数
- `crossplane_reconcile_duration_seconds`：Reconcile 耗时

---

## 十一、从 Terraform 迁移到 Crossplane 的路线图

### 11.1 迁移策略

从 Terraform 迁移到 Crossplane 不应该是一次性的大爆炸式迁移，而应该采用渐进式策略：

**阶段一：并行运行（1-2 个月）**
- 新增资源优先使用 Crossplane
- 现有 Terraform 资源保持不变
- 团队开始学习 Crossplane

**阶段二：逐模块迁移（2-4 个月）**
- 从简单的、独立的资源开始（S3 Bucket、IAM Role）
- 逐步迁移复杂的、有依赖关系的资源（VPC → RDS → EKS）
- 每个模块迁移后进行充分测试

**阶段三：全面切换（1-2 个月）**
- 迁移核心基础设施资源
- 导入现有资源到 Crossplane 管理
- 废弃 Terraform 代码和状态文件

### 11.2 现有资源导入

Crossplane 支持将已存在的云资源导入管理：

```yaml
# 导入现有的 RDS 实例
apiVersion: rds.aws.crossplane.io/v1alpha1
kind: DBInstance
metadata:
  name: existing-production-db
  annotations:
    crossplane.io/external-name: my-production-db  # AWS 上的实际资源名称
spec:
  forProvider:
    engine: postgres
    engineVersion: "16"
    dbInstanceClass: db.r6g.large
    # ... 其他配置与现有资源匹配
  providerConfigRef:
    name: default
```

```bash
# 使用 crossplane beta import 命令（实验性功能）
kubectl crossplane beta import provider-aws DBInstance my-production-db

# 导入 S3 存储桶
kubectl crossplane beta import provider-aws Bucket my-assets-bucket
```

### 11.3 Terraform 状态到 Crossplane 的映射

| Terraform 资源 | Crossplane Provider 资源 |
|----------------|--------------------------|
| `aws_db_instance` | `rds.aws.crossplane.io/v1alpha1.DBInstance` |
| `aws_s3_bucket` | `s3.aws.crossplane.io/v1beta1.Bucket` |
| `aws_vpc` | `ec2.aws.crossplane.io/v1beta1.VPC` |
| `aws_subnet` | `ec2.aws.crossplane.io/v1beta1.Subnet` |
| `aws_iam_role` | `iam.aws.crossplane.io/v1beta1.Role` |
| `aws_eks_cluster` | `eks.aws.crossplane.io/v1beta1.Cluster` |
| `aws_security_group` | `ec2.aws.crossplane.io/v1beta1.SecurityGroup` |

### 11.4 迁移注意事项

1. **状态差异**：Terraform 的 state 文件包含详细的属性映射，Crossplane 需要确保 `forProvider` 字段与实际资源状态完全匹配
2. **Import 时序**：某些资源有依赖关系，需要按顺序导入（先 VPC，再 Subnet，再 RDS）
3. **Connection Secret**：Terraform 不使用 Connection Secret，迁移后需要手动创建或等待 Crossplane 自动生成
4. **删除保护**：迁移期间建议将 `deletionPolicy` 设为 `Orphan`，防止误删除
5. **标签管理**：确保 Crossplane 管理的资源标签与 Terraform 一致，避免标签漂移

### 11.5 迁移脚本示例

```bash
#!/bin/bash
# migration-helper.sh
# 从 Terraform state 导出资源信息，辅助 Crossplane YAML 生成

RESOURCE_TYPE="aws_db_instance"
RESOURCE_NAME="production-db"

# 从 Terraform state 获取资源属性
terraform state show "${RESOURCE_TYPE}.${RESOURCE_NAME}" > /tmp/tf-resource.txt

# 提取关键属性
ENGINE=$(grep "engine " /tmp/tf-resource.txt | awk '{print $3}' | tr -d '"')
ENGINE_VERSION=$(grep "engine_version " /tmp/tf-resource.txt | awk '{print $3}' | tr -d '"')
INSTANCE_CLASS=$(grep "instance_class " /tmp/tf-resource.txt | awk '{print $3}' | tr -d '"')
STORAGE=$(grep "allocated_storage " /tmp/tf-resource.txt | awk '{print $3}')

echo "=== 生成 Crossplane YAML ==="
cat << EOF
apiVersion: rds.aws.crossplane.io/v1alpha1
kind: DBInstance
metadata:
  name: ${RESOURCE_NAME}
  annotations:
    crossplane.io/external-name: ${RESOURCE_NAME}
spec:
  forProvider:
    engine: ${ENGINE}
    engineVersion: "${ENGINE_VERSION}"
    dbInstanceClass: ${INSTANCE_CLASS}
    allocatedStorage: ${STORAGE}
  providerConfigRef:
    name: default
EOF
```

---

## 十二、总结：Crossplane 的优势、局限性与适用场景

### 12.1 核心优势

1. **统一控制平面**：将基础设施编排与应用编排统一到 Kubernetes，消除了工具链碎片化
2. **原生 GitOps**：Crossplane 资源天然适配 ArgoCD/Flux，实现真正的声明式基础设施管理
3. **API 抽象能力**：通过 XRD + Composition，平台团队可以为应用团队提供自助式基础设施 API
4. **持续一致性**：Kubernetes 控制器模式确保基础设施始终处于声明状态，漂移自动修复
5. **细粒度权限控制**：利用 Kubernetes RBAC 控制谁可以创建什么类型的基础设施资源
6. **CNCF 生态**：作为 CNCF 孵化项目，拥有活跃的社区和持续的版本迭代

### 12.2 当前局限性

1. **学习曲线**：XRD + Composition 的概念比 Terraform HCL 更复杂，需要更长的学习周期
2. **Provider 成熟度**：虽然 AWS Provider 已经相当成熟，但某些小众服务的支持可能不如 Terraform Provider
3. **调试复杂度**：多层抽象（Claim → XR → ManagedResource）增加了问题排查的复杂度
4. **资源消耗**：Crossplane 需要额外的 Kubernetes 资源（CPU、内存、存储），对于小规模环境可能过度
5. **状态迁移**：从 Terraform 迁移已有资源到 Crossplane 管理仍然有一定挑战
6. **社区规模**：相比 Terraform 的庞大社区，Crossplane 的社区规模和资源仍然较小

### 12.3 适用场景

**强烈推荐使用 Crossplane 的场景：**
- 团队深度使用 Kubernetes，希望统一工具链
- 需要为多团队提供自助式基础设施平台
- 已经采用 GitOps 工作流（ArgoCD/Flux）
- 需要精细的基础设施访问控制
- 希望消除 Terraform 状态文件管理负担

**建议谨慎考虑的场景：**
- 团队对 Kubernetes 不熟悉
- 基础设施规模较小（仅几个资源）
- 需要支持大量不同云平台的小众服务
- 团队已经深度使用 Terraform 且运行良好
- 没有足够的 Kubernetes 运维能力

### 12.4 未来展望

Crossplane 的发展方向令人期待：

- **Composition Functions**：更强大的 Composition 逻辑，支持自定义 Patch 函数
- **Environment Config**：更灵活的全局配置注入机制
- **External Secret Store**：与 Vault、AWS Secrets Manager 等外部密钥管理集成
- **多集群管理**：通过 Crossplane 管理多个 Kubernetes 集群的基础设施
- **Upbound Marketplace**：越来越多经过认证的 Provider 和 Configuration 可用

### 12.5 最终建议

Crossplane 不是 Terraform 的直接替代品，而是云原生时代基础设施管理的一种新范式。对于已经在 Kubernetes 生态中深度投入的团队，Crossplane 提供了一条将基础设施管理无缝融入已有工具链和工作流的路径。关键在于选择适合你团队和场景的工具，而不是盲目追求新技术。

无论选择 Terraform 还是 Crossplane，核心目标都是一致的：**让基础设施管理变得可重复、可审计、可协作**。Crossplane 通过将这一目标与 Kubernetes 生态深度融合，为云原生团队提供了一个值得认真考虑的选择。

---

## 参考资料

- [Crossplane 官方文档](https://docs.crossplane.io/)
- [Crossplane GitHub](https://github.com/crossplane/crossplane)
- [Upbound Marketplace](https://marketplace.upbound.io/)
- [Crossplane AWS Provider](https://github.com/crossplane-contrib/provider-aws)
- [ArggoCD + Crossplane 集成指南](https://docs.crossplane.io/guides/crossplane-with-argocd)
- [Crossplane Composition Functions](https://docs.crossplane.io/latest/concepts/composition-functions/)
- [CNCF Crossplane 项目](https://www.cncf.io/projects/crossplane/)

---

*本文首发于 2026 年 6 月，基于 Crossplane v1.17 和 AWS Provider v0.47。如有疑问或建议，欢迎在评论区交流。*

---

## 相关阅读

- [蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚](/categories/运维/2026-06-02-蓝绿部署实战-Laravel-零停机发布-流量切换-数据库迁移与一键回滚/)
- [Linux 安全加固实战：AppArmor/SELinux/seccomp 策略——Docker/K8s 容器逃逸防护与最小权限落地](/categories/运维/linux-security-hardening-apparmor-selinux-seccomp/)
- [Secrets Management 实战：HashiCorp Vault/SOPS/age 密钥管理——Laravel 应用的密钥轮换与审计日志](/categories/运维/Secrets-Management-HashiCorp-Vault-SOPS-age-密钥管理-Laravel密钥轮换与审计日志/)
