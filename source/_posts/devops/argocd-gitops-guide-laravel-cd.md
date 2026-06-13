---
title: ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-16 19:20:11
updated: 2026-05-16 19:24:13
categories:
  - devops
  - kubernetes
tags: [CI/CD, DevOps, Kubernetes, Laravel, ArgoCD, GitOps]
keywords: [ArgoCD GitOps, Laravel, 应用持续部署与回滚踩坑记录, DevOps]
description: 从传统 CI/CD push 模式迁移到 ArgoCD GitOps pull 模式，涵盖 Application CRD 定义、Helm Chart 打包、自动同步与手动审批、回滚策略、多环境管理（dev/staging/prod）以及 Laravel 特有的 .env 注入踩坑记录。



---

# ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录

## 前言

在 KKday B2C Backend Team 的 30+ Laravel 仓库中，CI/CD 流水线一直是工程化的基石。早期我们采用 GitHub Actions + kubectl apply 的经典 push 模式——CI 跑完测试后直接把镜像 tag 推到 K8s 集群。这种模式简单直接，但随着仓库数量增长和多环境（dev/staging/prod）管理需求出现，问题逐渐暴露：

- **状态漂移**：有人手动 `kubectl edit deployment` 改了副本数，Git 仓库里的声明和集群实际状态不一致
- **回滚困难**：kubectl rollout undo 只能回退一个版本，且回滚操作不记录在 Git 中
- **权限扩散**：CI 工具需要 K8s 集群的写权限，CI runner 被攻破等于集群失守
- **多环境差异**：dev/staging/prod 三套环境的配置散落在不同的 GitHub Actions workflow 里，难以审计

本文记录我们从 push 模式迁移到 ArgoCD GitOps pull 模式的完整过程，包括 Helm Chart 打包、Application CRD 定义、同步策略、回滚机制，以及 Laravel 特有的 `.env` 配置注入踩坑。

---

## 一、架构总览：Push vs Pull 模式

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
│         ↑ ArgoCD 拉取 Git 状态，对比集群状态，自动同步    │       │
│         │ CI 不再需要集群权限                              │       │
└──────────────────────────────────────────────────────────────────┘
```

**核心区别**：Git 仓库成为唯一的 "Source of Truth"，ArgoCD 负责将 Git 中的声明式配置同步到集群。任何手动修改都会被 ArgoCD 检测为 "Drift" 并自动修正（或告警）。

---

## 二、Helm Chart 打包 Laravel 应用

ArgoCD 支持 Kustomize、Helm、Plain YAML 等多种清单格式。我们选择 Helm，因为：
1. 支持模板变量，多环境复用同一套 Chart
2. 自带版本管理和回滚能力
3. 社区生态成熟，有现成的 `bitnami/laravel` chart 可参考

### 2.1 目录结构

```
helm/
├── Chart.yaml
├── values.yaml              # 默认值
├── values-dev.yaml          # dev 环境覆盖
├── values-staging.yaml      # staging 环境覆盖
├── values-prod.yaml         # prod 环境覆盖
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    ├── ingress.yaml
    ├── hpa.yaml
    ├── configmap.yaml        # 非敏感配置 (.env 的 APP_NAME, APP_URL 等)
    ├── secret.yaml           # 敏感配置 (DB_PASSWORD, REDIS_PASSWORD 等)
    ├── migration-job.yaml    # Laravel migrate Job
    └── _helpers.tpl          # 模板辅助函数
```

### 2.2 Deployment 模板核心片段

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "laravel.fullname" . }}
  labels:
    {{- include "laravel.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "laravel.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "laravel.selectorLabels" . | nindent 8 }}
      annotations:
        # 强制滚动更新：每次 .env 变更都会触发 Pod 重建
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
    spec:
      containers:
        - name: php-fpm
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: 9000
          envFrom:
            - configMapRef:
                name: {{ include "laravel.fullname" . }}-config
            - secretRef:
                name: {{ include "laravel.fullname" . }}-secret
          resources:
            requests:
              cpu: {{ .Values.resources.phpFpm.requests.cpu }}
              memory: {{ .Values.resources.phpFpm.requests.memory }}
            limits:
              cpu: {{ .Values.resources.phpFpm.limits.cpu }}
              memory: {{ .Values.resources.phpFpm.limits.memory }}
          livenessProbe:
            httpGet:
              path: /healthz
              port: 9000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /healthz
              port: 9000
            initialDelaySeconds: 5
            periodSeconds: 5
        - name: nginx
          image: "{{ .Values.nginx.image }}:{{ .Values.nginx.tag }}"
          ports:
            - containerPort: 80
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/conf.d/default.conf
              subPath: default.conf
      volumes:
        - name: nginx-config
          configMap:
            name: {{ include "laravel.fullname" . }}-nginx
```

### 2.3 ConfigMap 与 Secret：Laravel .env 注入

这是 Laravel 应用接入 K8s 最容易踩坑的地方。Laravel 读取 `.env` 文件，但 K8s 的最佳实践是通过环境变量注入。

```yaml
# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "laravel.fullname" . }}-config
data:
  APP_NAME: {{ .Values.app.name | quote }}
  APP_ENV: {{ .Values.app.env | quote }}
  APP_URL: {{ .Values.app.url | quote }}
  LOG_CHANNEL: "stack"
  LOG_LEVEL: {{ .Values.app.logLevel | quote }}
  CACHE_DRIVER: "redis"
  QUEUE_CONNECTION: "redis"
  SESSION_DRIVER: "redis"
  DB_CONNECTION: "mysql"
  DB_HOST: {{ .Values.database.host | quote }}
  DB_PORT: {{ .Values.database.port | quote }}
  DB_DATABASE: {{ .Values.database.name | quote }}

# templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "laravel.fullname" . }}-secret
type: Opaque
data:
  APP_KEY: {{ .Values.app.key | b64enc | quote }}
  DB_USERNAME: {{ .Values.database.username | b64enc | quote }}
  DB_PASSWORD: {{ .Values.database.password | b64enc | quote }}
  REDIS_PASSWORD: {{ .Values.redis.password | b64enc | quote }}
```

> ⚠️ **踩坑 #1：envFrom 的加载顺序**
> 
> ConfigMap 和 Secret 通过 `envFrom` 注入时，如果两者有同名 key，**后加载的会覆盖先加载的**。我们曾经把 `DB_PASSWORD` 同时放在 ConfigMap 和 Secret 里，导致生产环境用了空密码。解决方法：敏感字段只放 Secret，非敏感只放 ConfigMap，绝不重复。

> ⚠️ **踩坑 #2：APP_KEY 的换行符**
> 
> Laravel 的 `APP_KEY` 格式是 `base64:xxxxx`，在 `b64enc` 后如果 YAML 文件用的是 Windows 换行（`\r\n`），解码后 key 会多出一个 `\r`，导致 `php artisan key:generate` 和运行时 key 不匹配，所有加密的 session/cookie 全部失效。我们的修法：在 Helm 的 `_helpers.tpl` 中加 `| trim`。

### 2.4 Migration Job：部署前自动 migrate

```yaml
# templates/migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "laravel.fullname" . }}-migrate-{{ .Release.Revision }}
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: ["php", "artisan", "migrate", "--force"]
          envFrom:
            - configMapRef:
                name: {{ include "laravel.fullname" . }}-config
            - secretRef:
                name: {{ include "laravel.fullname" . }}-secret
```

> ⚠️ **踩坑 #3：helm.sh/hook 与 ArgoCD 的冲突**
> 
> ArgoCD 默认不会执行 Helm Hooks。需要在 Application CRD 中配置 `syncPolicy.syncOptions: - CreateNamespace=true` 并且在 ArgoCD 的 `argocd-cm` ConfigMap 中设置 `resource.customizations.health.argoproj.io_Application` 来识别 Hook 状态。更简单的做法：不用 Helm Hook，改用 ArgoCD 的 `Sync Hooks`（在资源注解中加 `argocd.argoproj.io/hook: PreSync`）。

---

## 三、ArgoCD Application CRD 定义

### 3.1 多环境 Application 配置

```yaml
# argocd/applications/b2c-api-prod.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: b2c-api-prod
  namespace: argocd
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.slack: b2c-deployments
    notifications.argoproj.io/subscribe.on-sync-failed.slack: b2c-alerts
spec:
  project: b2c
  source:
    repoURL: https://github.com/kkday/b2c-api.git
    targetRevision: main                    # 生产环境追踪 main 分支
    path: helm
    helm:
      valueFiles:
        - values.yaml
        - values-prod.yaml                  # 环境特定的覆盖值
  destination:
    server: https://k8s-prod.example.com    # 生产集群地址
    namespace: b2c-prod
  syncPolicy:
    automated:
      prune: true                            # 自动清理 Git 中已删除的资源
      selfHeal: true                         # 自动修复手动修改导致的漂移
      allowEmpty: false                      # 禁止删除所有资源
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
      - PruneLast=true                       # 先创建新资源，再删除旧资源
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
  # 生产环境需要人工审批
  # syncPolicy.automated 不配置 → 手动 Sync
```

```yaml
# argocd/applications/b2c-api-dev.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: b2c-api-dev
  namespace: argocd
spec:
  project: b2c
  source:
    repoURL: https://github.com/kkday/b2c-api.git
    targetRevision: develop                   # dev 环境追踪 develop 分支
    path: helm
    helm:
      valueFiles:
        - values.yaml
        - values-dev.yaml
  destination:
    server: https://k8s-dev.example.com
    namespace: b2c-dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true                          # dev 环境全自动同步
    syncOptions:
      - CreateNamespace=true
```

### 3.2 AppProject 权限隔离

```yaml
# argocd/projects/b2c.yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: b2c
  namespace: argocd
spec:
  description: "B2C Backend Team 项目"
  sourceRepos:
    - "https://github.com/kkday/b2c-api.git"
    - "https://github.com/kkday/helm-charts.git"
  destinations:
    - namespace: "b2c-*"                      # 只能部署到 b2c- 前缀的 namespace
      server: "*"
  clusterResourceWhitelist: []                # 禁止创建集群级资源
  namespaceResourceWhitelist:
    - group: "apps"
      kind: "Deployment"
    - group: ""
      kind: "Service"
    - group: ""
      kind: "ConfigMap"
    - group: ""
      kind: "Secret"
    - group: "batch"
      kind: "Job"
  roles:
    - name: deployer
      description: "部署人员"
      policies:
        - p, proj:b2c:deployer, applications, sync, b2c/*, allow
        - p, proj:b2c:deployer, applications, get, b2c/*, allow
      groups:
        - b2c-backend-team
```

> ⚠️ **踩坑 #4：Prune 误删 ConfigMap**
> 
> 开启 `automated.prune: true` 后，ArgoCD 会删除 Git 中不存在的资源。我们曾经有一个手动创建的 ConfigMap 存放第三方 SDK 的 license key，一次 sync 后被自动清理了，导致生产环境 API 返回 500。解决方案：所有资源必须声明在 Git 中，第三方配置用 External Secret 或 SealedSecret 管理。

---

## 四、CI 与 GitOps 的协作流程

### 4.1 完整流水线

```
┌─────────────────────────────────────────────────────────────────┐
│  CI Pipeline (GitHub Actions)                                   │
│                                                                 │
│  1. Push to develop/main                                        │
│  2. Run Tests (Pest + PHPUnit)                                  │
│  3. Run Static Analysis (PHPStan + Pint)                        │
│  4. Build Docker Image (多阶段构建)                              │
│  5. Push Image to Registry                                      │
│  6. Update Image Tag in values-{env}.yaml                       │
│  7. Git Commit + Push                                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  ArgoCD (Cluster 内)                                            │
│                                                                 │
│  1. Detect Git change (polling or webhook)                      │
│  2. Compare desired state vs live state                         │
│  3. Dev: Auto Sync                                              │
│     Prod: Show "OutOfSync" → Wait for manual approval           │
│  4. Sync: Apply manifests                                       │
│  5. Run PreSync hooks (migration)                               │
│  6. Rolling Update deployment                                   │
│  7. PostSync hooks (smoke test)                                 │
│  8. Notify Slack (success/failure)                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 GitHub Actions 更新 Image Tag

```yaml
# .github/workflows/deploy.yml
name: Build & Deploy

on:
  push:
    branches: [develop, main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Tests
        run: |
          composer install --no-dev
          php artisan test --parallel

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    outputs:
      image_tag: ${{ steps.meta.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      - name: Docker Meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: registry.example.com/b2c-api
          tags: |
            type=sha,prefix=
            type=ref,event=branch
      - name: Build & Push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}

  update-gitops:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITOPS_TOKEN }}
      - name: Update Image Tag
        run: |
          ENV_NAME=${{ github.ref == 'refs/heads/main' && 'prod' || 'dev' }}
          # 用 yq 更新 Helm values 中的 image.tag
          yq eval ".image.tag = \"${{ needs.build-and-push.outputs.image_tag }}\"" \
            -i helm/values-${ENV_NAME}.yaml
      - name: Commit & Push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "actions@github.com"
          git add helm/values-*.yaml
          git commit -m "chore: update image tag to ${{ needs.build-and-push.outputs.image_tag }}"
          git push
```

> ⚠️ **踩坑 #5：GitOps Token 权限**
> 
> `GITOPS_TOKEN` 是一个 Personal Access Token (PAT)，需要对 GitOps 仓库有写权限。如果这个 Token 过期或权限不足，CI 会成功 build 镜像但无法更新 values 文件，导致 ArgoCD 一直用旧镜像。我们曾因为 Token 过期导致 staging 环境静默卡在旧版本两天没人发现。解决方案：1) 设置 Token 过期告警；2) 在 ArgoCD Notifications 中配置 `OutOfSync` 超过 30 分钟未同步的告警。

---

## 五、回滚策略

### 5.1 ArgoCD 内置回滚

ArgoCD 记录每次 Sync 的 Revision（Git commit SHA），可以通过 UI 或 CLI 回滚到任意历史版本：

```bash
# 查看同步历史
argocd app history b2c-api-prod

# 输出示例：
# ID  DATE                           REVISION    MESSAGE
# 5   2026-05-16 14:30:00 +0800 CST  a1b2c3d     chore: update image tag to v2.3.1
# 4   2026-05-15 10:00:00 +0800 CST  e4f5g6h     chore: update image tag to v2.3.0
# 3   2026-05-14 16:20:00 +0800 CST  i7j8k9l     chore: update image tag to v2.2.9

# 回滚到 ID 4
argocd app rollback b2c-api-prod 4
```

### 5.2 Git 级别回滚（推荐）

ArgoCD 回滚只是把集群状态切到某个历史 Revision，但 Git 仓库不会自动回退。推荐的做法是：

```bash
# 1. Git revert 到上一个版本的 values
git revert HEAD --no-edit

# 2. Push 到 Git
git push origin main

# 3. ArgoCD 自动检测到 Git 变更，同步回滚
```

这样 Git 历史完整保留了回滚记录，符合 GitOps 的审计要求。

### 5.3 Laravel 特有的回滚注意事项

```
回滚时必须考虑：

┌──────────────────────────────────────────────────────────────┐
│  回滚检查清单                                                  │
│                                                              │
│  □ 数据库 Migration：是否需要 rollback？                       │
│    → 不可逆 migration (DROP COLUMN) 不能直接回滚代码           │
│    → 必须有对应的 reverse migration                           │
│                                                              │
│  □ Queue Job：旧版本能否处理新版本入队的消息？                  │
│    → 版本间 Job payload 不兼容时需要 drain 队列                │
│                                                              │
│  □ Redis 缓存：新版本写入的缓存数据格式是否兼容？               │
│    → 不兼容时需要清缓存                                       │
│                                                              │
│  □ Session：新版本的 session 结构是否变化？                    │
│    → 变化时需要 force logout 所有用户                          │
│                                                              │
│  □ API 契约：新版本的 response 字段是否已上线？                 │
│    → 前端已依赖新字段，回滚后前端会报错                        │
└──────────────────────────────────────────────────────────────┘
```

> ⚠️ **踩坑 #6：Migration 回滚 vs 代码回滚的不同步**
> 
> 我们曾经上线了一个新增 `orders.voucher_code` 列的 migration，代码里开始写入这个字段。两小时后发现一个严重 bug 需要回滚代码。ArgoCD 把代码回退了，但新列还在。旧代码不写这个字段，导致新订单的 `voucher_code` 全是 NULL。再上线新版本时，中间那批订单数据就丢了。解决方案：migration 和代码必须在同一版本中，回滚时同时回滚（先 rollback migration，再回滚代码）。

---

## 六、多环境管理最佳实践

### 6.1 环境分层

```
┌─────────────────────────────────────────────────────────────────┐
│  Git 分支策略                                                    │
│                                                                 │
│  feature/* → develop → release/* → main                         │
│      │           │          │          │                         │
│      │           ▼          │          ▼                         │
│      │        dev 环境       │       prod 环境                    │
│      │        (自动同步)     │       (手动审批)                   │
│      │                      ▼                                    │
│      │                   staging 环境                             │
│      │                   (自动同步，发布候选)                     │
│      └──────────────────────────────────────────                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 values 文件分层

```yaml
# values.yaml (公共配置)
image:
  repository: registry.example.com/b2c-api
  tag: latest
  pullPolicy: IfNotPresent

replicaCount: 2
resources:
  phpFpm:
    requests: { cpu: "250m", memory: "256Mi" }
    limits: { cpu: "500m", memory: "512Mi" }

# values-dev.yaml
app:
  env: local
  logLevel: debug
  url: https://dev-api.example.com
replicaCount: 1
resources:
  phpFpm:
    requests: { cpu: "100m", memory: "128Mi" }
    limits: { cpu: "250m", memory: "256Mi" }

# values-prod.yaml
app:
  env: production
  logLevel: warning
  url: https://api.example.com
replicaCount: 5
resources:
  phpFpm:
    requests: { cpu: "500m", memory: "512Mi" }
    limits: { cpu: "1000m", memory: "1Gi" }
hpa:
  enabled: true
  minReplicas: 5
  maxReplicas: 20
  targetCPUUtilization: 70
```

> ⚠️ **踩坑 #7：values 文件的 Secret 管理**
> 
> 生产环境的 `values-prod.yaml` 中包含数据库密码、Redis 密码等敏感信息。直接提交到 Git 是安全红线。我们的解决方案：
> 1. **External Secrets Operator**：集群内运行，从 AWS Secrets Manager / HashiCorp Vault 拉取
> 2. **Sealed Secrets**：加密后的 Secret 可以安全提交到 Git
> 3. **SOPS + KMS**：用 AWS KMS 加密 values 文件中的敏感字段
>
> 我们最终选了 SOPS + KMS，因为改动最小，且 ArgoCD 原生支持。

---

## 七、ArgoCD Notifications：部署通知

```yaml
# argocd-notifications-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  service.slack: |
    token: $slack-token
  template.app-sync-succeeded: |
    message: |
      ✅ *{{.app.metadata.name}}* 同步成功
      📦 Revision: `{{.app.status.sync.revision}}`
      🌐 环境: {{.app.spec.destination.namespace}}
      ⏰ 时间: {{.app.status.operationState.finishedAt}}
  template.app-sync-failed: |
    message: |
      ❌ *{{.app.metadata.name}}* 同步失败
      📦 Revision: `{{.app.status.sync.revision}}`
      🔴 错误: {{.app.status.operationState.message}}
  trigger.on-sync-succeeded: |
    - when: app.status.operationState.phase in ['Succeeded']
      send: [app-sync-succeeded]
  trigger.on-sync-failed: |
    - when: app.status.operationState.phase in ['Error', 'Failed']
      send: [app-sync-failed]
```

---

## 八、踩坑汇总与经验

| # | 问题 | 影响 | 解决方案 |
|---|------|------|----------|
| 1 | envFrom 覆盖 | 生产用空密码 | 敏感/非敏感分离到 Secret/ConfigMap |
| 2 | APP_KEY 换行符 | Session 全部失效 | b64enc + trim |
| 3 | Helm Hook 与 ArgoCD 冲突 | Migration 不执行 | 改用 ArgoCD Sync Hook |
| 4 | Prune 误删 ConfigMap | API 500 | 所有资源声明在 Git 中 |
| 5 | GitOps Token 过期 | Staging 卡旧版本 | Token 过期告警 + OOS 告警 |
| 6 | Migration/代码回滚不同步 | 订单数据丢失 | Migration 和代码同版本管理 |
| 7 | Secrets 明文入库 | 安全红线 | SOPS + KMS 加密 |

---

## 九、从零搭建 ArgoCD 的 Checklist

```
□ 1. 安装 ArgoCD 到 K8s 集群
      kubectl create namespace argocd
      kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

□ 2. 配置 Git 仓库访问（HTTPS + Token 或 SSH Key）

□ 3. 创建 AppProject 权限隔离

□ 4. 为每个服务/环境创建 Application CRD

□ 5. 配置 Notifications（Slack/Teams/钉钉）

□ 6. 配置 Secrets 管理方案（SOPS/SealedSecret/External Secrets）

□ 7. 配置 RBAC（谁能 Sync、谁能回滚）

□ 8. 制定回滚 SOP 文档（含 Migration 回滚流程）

□ 9. 配置健康检查和漂移告警

□ 10. 灰度上线：先用 dev 环境跑 2 周，确认无问题后再推广
```

---

## 总结

从 push 模式迁移到 ArgoCD GitOps 模式，最大的变化不是工具链，而是**思维方式**：

1. **Git 是唯一真相源**：任何集群状态的变更都必须通过 Git 提交
2. **声明式 > 命令式**：描述你想要什么状态，而不是怎么做
3. **自动漂移修复**：手动修改被自动纠正，而不是默默存在
4. **审计可追溯**：每次变更都有 Git commit 记录

对于 Laravel B2C API 来说，ArgoCD 的学习曲线并不陡峭。真正的挑战在于 Laravel 特有的 `.env` 管理、Migration 生命周期和 Queue Job 兼容性。把这些踩坑经验提前消化，GitOps 的落地会顺畅很多。

---

## 十、GitOps 工具对比：ArgoCD vs FluxCD vs Jenkins X

选择 GitOps 工具时，我们在 ArgoCD、FluxCD 和 Jenkins X 之间做了详细对比。以下表格基于 2026 年各工具的最新版本：

| 维度 | ArgoCD | FluxCD (v2) | Jenkins X |
|------|--------|-------------|-----------|
| **架构模型** | 集中式控制面（单集群/多集群） | 去中心化，每集群独立运行 | 基于 Jenkins Pipeline 的完整 CI/CD 平台 |
| **UI 可视化** | ✅ 内置 Web UI，拓扑图、Diff 视图、回滚按钮 | ❌ 无官方 UI（需搭配 Weave GitOps） | ✅ 自带 Dashboard |
| **多租户隔离** | AppProject + RBAC，成熟 | Kustomization 隔离，较灵活 | 原生支持 Team 概念 |
| **Helm 支持** | 原生支持，支持 valueFiles 覆盖 | 原生支持 HelmRelease CRD | 通过 Pipeline 调用 helm |
| **Kustomize 支持** | 原生支持 | 原生支持，且是 Flux 的核心能力 | 有限支持 |
| **Sync 策略** | 自动/手动/定时，支持 Prune、SelfHeal | 自动同步，支持 dependsOn 依赖链 | 由 Pipeline 控制 |
| **Notification** | argocd-notifications（Slack/Teams/钉钉/Webhook） | 原生 Alert/Provider CRD | 依赖 Jenkins 插件 |
| **Secret 管理** | SOPS、SealedSecret、External Secrets（均支持） | 原生 SOPS 集成（最成熟） | 依赖 Vault 插件 |
| **多集群管理** | ✅ ApplicationSet + Git Generator，成熟 | ✅ 支持，但配置较复杂 | ❌ 多集群支持弱 |
| **学习曲线** | 中等，概念清晰 | 中等偏低，CRD 较少 | 高，需要理解 Jenkins Pipeline + Tekton |
| **社区活跃度** | ⭐⭐⭐⭐⭐（CNCF Graduated） | ⭐⭐⭐⭐（CNCF Graduated） | ⭐⭐⭐（CNCF Incubating，活跃度下降） |
| **适用场景** | 多团队、多环境、需要 UI 和审批流 | 轻量级、偏好 CLI、纯 Kustomize 场景 | 已有 Jenkins 生态、需要完整 CI+CD |

**我们的选择**：ArgoCD。原因：1) 30+ 仓库需要集中管理，ArgoCD 的 ApplicationSet + Web UI 大幅降低运维成本；2) 生产环境需要手动审批，ArgoCD 的手动 Sync 流程最直观；3) 团队成员习惯可视化操作，FluxCD 的纯 CLI 方式学习成本高。

---

## 附录：完整的 ApplicationSet 多环境模板

当仓库数量增长到 30+ 时，为每个服务/环境手写 Application CRD 变得不可维护。ArgoCD 的 `ApplicationSet` 可以用一个模板自动生成所有 Application：

```yaml
# argocd/applicationsets/b2c-api.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: b2c-api
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: dev
            branch: develop
            cluster: https://k8s-dev.example.com
            namespace: b2c-dev
            autoSync: "true"
          - env: staging
            branch: release
            cluster: https://k8s-staging.example.com
            namespace: b2c-staging
            autoSync: "true"
          - env: prod
            branch: main
            cluster: https://k8s-prod.example.com
            namespace: b2c-prod
            autoSync: "false"
  template:
    metadata:
      name: "b2c-api-{{env}}"
      namespace: argocd
      annotations:
        notifications.argoproj.io/subscribe.on-sync-succeeded.slack: b2c-deployments
        notifications.argoproj.io/subscribe.on-sync-failed.slack: b2c-alerts
    spec:
      project: b2c
      source:
        repoURL: https://github.com/kkday/b2c-api.git
        targetRevision: "{{branch}}"
        path: helm
        helm:
          valueFiles:
            - values.yaml
            - values-{{env}}.yaml
      destination:
        server: "{{cluster}}"
        namespace: "{{namespace}}"
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
          - PrunePropagationPolicy=foreground
        retry:
          limit: 3
          backoff:
            duration: 5s
            factor: 2
            maxDuration: 3m
  # 根据 autoSync 标志动态启用自动同步
  templatePatch: |
    spec:
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

> 💡 **使用 ApplicationSet 后**：新增一个环境只需在 `generators.list.elements` 中加一行，不再需要手写 YAML。配合 `git generator` 还能自动发现仓库中的 Helm Chart 路径，实现真正的 "零配置" 新服务接入。

---

## 相关阅读

- [Argo Rollouts 渐进式发布实战：Laravel 在 K8s 上的金丝雀发布、自动分析与回滚踩坑记录](/categories/DevOps/argo-rollouts-guide-laravel-k8s/)
- [Helm Chart 实战：Laravel 应用打包与部署踩坑记录](/categories/DevOps/helm-chart-guide-laravel-deployment/)
- [Kubernetes ConfigMap/Secret 实战：配置管理与敏感数据处理——Laravel 应用部署的配置治理踩坑记录](/categories/DevOps/kubernetes-configmap-secret-guide-config-management-laravel-deployment/)
