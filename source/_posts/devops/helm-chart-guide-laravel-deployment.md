---

title: Helm-Chart-实战-Laravel-应用打包与部署踩坑记录
keywords: [Helm, Chart, Laravel, 应用打包与部署踩坑记录]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-16 23:10:35
updated: 2026-05-16 23:12:59
categories:
- devops
- kubernetes
tags:
- DevOps
- Kubernetes
- Laravel
description: 深入讲解 Helm Chart 构建 Laravel 应用部署的完整实战流程。涵盖 Chart 目录结构设计、values.yaml 分层覆盖策略、Nginx Sidecar 双容器 Pod 编排、ConfigMap/Secret 注入、HPA 自动扩缩、ArgoCD GitOps 集成，以及 PHP-FPM 健康检查、storage 权限、多副本 Session 共享、数据库迁移竞争等 30+ 仓库生产级踩坑记录与解决方案，适合 K8s 运维与 Laravel 开发者参考。
---


# Helm Chart 实战：Laravel 应用打包与部署踩坑记录

## 为什么需要 Helm？

在 KKday B2C Backend Team，我们有 30+ 个 Laravel 微服务仓库。当每个服务都需要 Deployment、Service、Ingress、HPA、ConfigMap、Secret 这些 K8s 资源时，纯 YAML 文件的维护量会指数级增长。

我们之前的做法是每个仓库里放一套 `k8s/` 目录的 YAML 文件，通过 `kubectl apply -f` 部署。问题很快暴露：

- **模板重复**：30 个仓库的 Deployment YAML 90% 相同，只有镜像名、环境变量不同
- **多环境管理混乱**：dev/staging/prod 各一套 YAML，改了 dev 忘了同步 prod
- **回滚困难**：`kubectl rollout undo` 只能回到上一个版本，不能精确回滚到特定 release
- **配置漂移**：手动修改线上 YAML 后无法追踪变更

Helm 本质上是 K8s 的 **包管理器**——把一组相关资源打包成 Chart，通过 values 注入差异配置，用 release 版本管理生命周期。

```
┌─────────────────────────────────────────────────┐
│                  Helm Chart                      │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │templates/│  │ values   │  │ Chart.yaml    │  │
│  │          │  │ .yaml    │  │ (元数据/版本)  │  │
│  │ deploy   │  │          │  └───────────────┘  │
│  │ service  │  │ defaults │                     │
│  │ ingress  │  │          │  ┌───────────────┐  │
│  │ hpa      │  │          │  │ Chart.lock    │  │
│  │ configmap│  │          │  │ (子Chart依赖)  │  │
│  │ secret   │  │          │  └───────────────┘  │
│  └──────────┘  └──────────┘                     │
│                                                  │
│         ↓ helm template / helm install ↓         │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  Rendered K8s YAML (per environment)     │    │
│  │  deployment.yaml + service.yaml + ...    │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Chart 目录结构设计

针对 Laravel 应用，我们最终沉淀出的 Chart 结构如下：

```
laravel-helm-chart/
├── Chart.yaml                  # Chart 元数据 + 依赖声明
├── Chart.lock                  # 依赖锁定文件
├── values.yaml                 # 默认值（所有环境的公共默认）
├── values/
│   ├── values-dev.yaml         # 开发环境覆盖
│   ├── values-staging.yaml     # 预发布环境覆盖
│   └── values-prod.yaml        # 生产环境覆盖
├── templates/
│   ├── _helpers.tpl            # 模板辅助函数
│   ├── deployment.yaml         # 主 Deployment
│   ├── service.yaml            # ClusterIP Service
│   ├── ingress.yaml            # Ingress 规则
│   ├── hpa.yaml                # 水平自动扩缩
│   ├── configmap.yaml          # 非敏感配置
│   ├── secret.yaml             # 敏感配置（外部引用）
│   ├── serviceaccount.yaml     # ServiceAccount
│   ├── pdb.yaml                # PodDisruptionBudget
│   └── NOTES.txt               # 安装后提示信息
└── tests/
    └── test-connection.yaml    # Helm 测试
```

### Chart.yaml

```yaml
apiVersion: v2
name: laravel-api
description: Helm Chart for Laravel B2C API services
type: application
version: 1.2.0        # Chart 版本（模板变更时递增）
appVersion: "8.2.0"   # 应用版本（对应 Laravel 版本）

dependencies:
  - name: redis
    version: "18.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
```

### values.yaml 核心设计

values.yaml 是整个 Chart 的灵魂。我们采用 **分层覆盖** 策略：公共默认 → 环境覆盖 → 部署时 `--set` 微调。

```yaml
# values.yaml — 公共默认值
replicaCount: 2

image:
  repository: registry.kkday.com/b2c/laravel-api
  pullPolicy: IfNotPresent
  tag: "latest"  # CI/CD 时通过 --set image.tag=<git-sha> 覆盖

nameOverride: ""
fullnameOverride: ""

service:
  type: ClusterIP
  port: 80
  targetPort: 9000  # PHP-FPM 端口

ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: api.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: api-tls
      hosts:
        - api.example.com

resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

env:
  APP_ENV: production
  APP_DEBUG: "false"
  LOG_CHANNEL: stack
  QUEUE_CONNECTION: redis
  SESSION_DRIVER: redis
  CACHE_DRIVER: redis

# 外部 Secret 引用（不存入 values.yaml）
existingSecret: "laravel-api-secrets"

# 健康检查
healthCheck:
  enabled: true
  path: /health
  initialDelaySeconds: 30
  periodSeconds: 10

# Nginx sidecar（用于 PHP-FPM 转发）
nginx:
  enabled: true
  image: nginx:1.25-alpine
```

### values-prod.yaml（生产环境覆盖）

```yaml
# values-prod.yaml
replicaCount: 4

image:
  pullPolicy: Always

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 1Gi

autoscaling:
  minReplicas: 4
  maxReplicas: 20
  targetCPUUtilizationPercentage: 60

env:
  APP_ENV: production
  LOG_CHANNEL: daily
  LOG_LEVEL: warning
```

## Deployment 模板的关键设计

这是踩坑最多的地方。Laravel + PHP-FPM 在 K8s 中运行有几个特殊挑战。

### 带 Nginx Sidecar 的 Pod

PHP-FPM 本身不处理 HTTP 请求，需要 Nginx 做反向代理。我们的方案是用 **单 Pod 双容器**（Nginx sidecar）：

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "laravel-api.fullname" . }}
  labels:
    {{- include "laravel-api.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "laravel-api.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        # 配置变更时自动重启 Pod
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      containers:
        # === PHP-FPM 容器 ===
        - name: php-fpm
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: 9000
          envFrom:
            - configMapRef:
                name: {{ include "laravel-api.fullname" . }}-config
            {{- if .Values.existingSecret }}
            - secretRef:
                name: {{ .Values.existingSecret }}
            {{- end }}
          {{- if .Values.healthCheck.enabled }}
          livenessProbe:
            exec:
              command:
                - php
                - /var/www/html/artisan
                - tinker
                - --execute="echo 'ok';"
            initialDelaySeconds: {{ .Values.healthCheck.initialDelaySeconds }}
            periodSeconds: {{ .Values.healthCheck.periodSeconds }}
          readinessProbe:
            exec:
              command:
                - php
                - /var/www/html/artisan
                - tinker
                - --execute="echo 'ok';"
            initialDelaySeconds: 10
            periodSeconds: 5
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            - name: php-storage
              mountPath: /var/www/html/storage
            - name: nginx-config
              mountPath: /etc/nginx/conf.d

        # === Nginx Sidecar 容器 ===
        {{- if .Values.nginx.enabled }}
        - name: nginx
          image: {{ .Values.nginx.image }}
          ports:
            - containerPort: 80
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/conf.d
            - name: php-storage
              mountPath: /var/www/html/storage
              readOnly: true
            - name: app-code
              mountPath: /var/www/html
              readOnly: true
          livenessProbe:
            httpGet:
              path: {{ .Values.healthCheck.path }}
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: {{ .Values.healthCheck.path }}
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
        {{- end }}

      volumes:
        - name: php-storage
          emptyDir: {}
        - name: nginx-config
          configMap:
            name: {{ include "laravel-api.fullname" . }}-nginx
        - name: app-code
          emptyDir: {}
```

### Nginx 配置 ConfigMap

```yaml
# templates/configmap.yaml (nginx 部分)
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "laravel-api.fullname" . }}-nginx
data:
  default.conf: |
    server {
        listen 80;
        root /var/www/html/public;
        index index.php;

        location / {
            try_files $uri $uri/ /index.php?$query_string;
        }

        location ~ \.php$ {
            fastcgi_pass 127.0.0.1:9000;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
            include fastcgi_params;
            fastcgi_read_timeout 300;
        }

        location ~ /\.(?!well-known).* {
            deny all;
        }
    }
```

## 踩坑记录（真实血泪教训）

### 踩坑 1：PHP-FPM 的健康检查不能用 HTTP

最初我们给 PHP-FPM 容器配置了 `httpGet` 健康检查，结果 Pod 一直 `CrashLoopBackOff`。原因是 PHP-FPM 只监听 9000 端口处理 FastCGI 协议，不是 HTTP 服务。

**解决方案**：PHP-FPM 用 `exec` 探针调用 `artisan tinker`，Nginx 用 `httpGet` 探针。两者分别检查，只要有一个不健康就重启 Pod。

### 踩坑 2：storage 目录权限问题

Laravel 的 `storage/` 目录需要可写权限。在 K8s 中使用 `emptyDir` 卷时，容器以 root 运行没问题，但当我们启用 `securityContext.runAsNonRoot: true` 后，PHP-FPM 进程（通常以 www-data 用户运行）无法写入 storage。

```yaml
# 解决方案：initContainer 设置权限
initContainers:
  - name: fix-permissions
    image: busybox:1.36
    command: ["sh", "-c", "chown -R 33:33 /var/www/html/storage /var/www/html/bootstrap/cache"]
    volumeMounts:
      - name: php-storage
        mountPath: /var/www/html/storage
      - name: bootstrap-cache
        mountPath: /var/www/html/bootstrap/cache
```

### 踩坑 3：配置变更后 Pod 不自动重启

改了 ConfigMap（比如环境变量），但 Pod 没有重启，旧配置仍然生效。这是因为 Deployment 的 Pod template 没有变化，K8s 不会触发滚动更新。

**解决方案**：在 Pod annotations 中加入 ConfigMap 的 checksum：

```yaml
annotations:
  checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
```

每次 ConfigMap 内容变化，checksum 变化 → 触发 Pod 滚动更新。

### 踩坑 4：多副本的 Session 共享

默认 Laravel 使用 `file` session driver。当 HPA 扩容到多个 Pod 时，用户请求被分发到不同 Pod，session 文件不存在导致用户被登出。

**解决方案**：所有环境强制使用 `redis` session driver，并在 values.yaml 中硬编码：

```yaml
env:
  SESSION_DRIVER: redis
  SESSION_LIFETIME: "120"
```

### 踩坑 5：artisan migrate 的竞争条件

多个 Pod 同时启动时，每个 Pod 的 `postStart` hook 都执行 `php artisan migrate`，导致数据库迁移冲突。

**解决方案**：用 Kubernetes Job 单独执行迁移，Deployment 不包含 migrate：

```yaml
# templates/migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "laravel-api.fullname" . }}-migrate-{{ .Release.Revision }}
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: ["php", "artisan", "migrate", "--force"]
          envFrom:
            - configMapRef:
                name: {{ include "laravel-api.fullname" . }}-config
            - secretRef:
                name: {{ .Values.existingSecret }}
```

关键注解说明：
- `helm.sh/hook: pre-upgrade,pre-install` — 在 release 升级/安装前执行
- `helm.sh/hook-weight: "-5"` — 优先级最高
- `helm.sh/hook-delete-policy: before-hook-creation` — 下次执行前删除旧 Job

## 多环境部署命令

```bash
# 开发环境
helm upgrade --install laravel-api ./laravel-helm-chart \
  -f ./laravel-helm-chart/values/values-dev.yaml \
  --set image.tag=dev-abc1234 \
  --namespace dev

# Staging
helm upgrade --install laravel-api ./laravel-helm-chart \
  -f ./laravel-helm-chart/values/values-staging.yaml \
  --set image.tag=staging-def5678 \
  --namespace staging

# 生产（配合 ArgoCD GitOps）
# ArgoCD 自动同步 values-prod.yaml，无需手动执行
```

### Helm 模板渲染调试

部署前一定要先本地渲染检查：

```bash
# 渲染完整模板（检查语法错误）
helm template laravel-api ./laravel-helm-chart \
  -f ./laravel-helm-chart/values/values-prod.yaml \
  --debug

# 差异对比（dry-run）
helm upgrade laravel-api ./laravel-helm-chart \
  -f ./laravel-helm-chart/values/values-prod.yaml \
  --dry-run --debug
```

## ArgoCD + Helm GitOps 集成

我们的 GitOps 流程中，ArgoCD 直接从 Git 仓库读取 Helm Chart：

```yaml
# argocd-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: laravel-api-prod
  namespace: argocd
spec:
  project: b2c-backend
  source:
    repoURL: git@github.com:kkday/b2c-helm-charts.git
    targetRevision: main
    path: laravel-helm-chart
    helm:
      valueFiles:
        - values/values-prod.yaml
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

这样每次 Git push 新的 image tag 到 values 文件，ArgoCD 自动同步到 K8s。

## _helpers.tpl 模板函数

```yaml
{{/*
生成完整应用名
*/}}
{{- define "laravel-api.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
通用标签
*/}}
{{- define "laravel-api.labels" -}}
helm.sh/chart: {{ include "laravel-api.chart" . }}
{{ include "laravel-api.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
选择器标签
*/}}
{{- define "laravel-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "laravel-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

## 总结

Helm 解决的核心问题是 **模板化 + 版本化 + 多环境分层**。对于 Laravel 应用在 K8s 上部署，关键要注意：

1. **PHP-FPM 不是 HTTP 服务** — 健康检查要用 exec 或通过 Nginx sidecar
2. **storage 目录权限** — initContainer 或 securityContext 要提前规划
3. **配置变更触发重启** — checksum annotation 是标准做法
4. **Session/Cache 必须外置** — 多副本下 file driver 会出问题
5. **数据库迁移用 Hook Job** — 避免多 Pod 竞争执行 migrate
6. **values 分层设计** — 公共默认 + 环境覆盖 + `--set` 微调

从 30+ 仓库的实践来看，一套通用 Helm Chart + 各仓库的 values 文件，比每个仓库维护独立 YAML 高效得多。维护成本从 O(n) 降到 O(1)，这才是 Helm 的真正价值。

## 相关阅读

- [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录](/categories/06_运维/argocd-gitops-guide-laravel-cd/)
- [Kubernetes 本地开发：minikube vs kind vs k3s 选型实战](/categories/06_运维/kubernetes-minikube-kind-k3s-guide-laravel/)
- [Argo Rollouts 渐进式发布实战：Laravel 在 K8s 上的金丝雀发布与自动分析](/categories/06_运维/argo-rollouts-guide-laravel-k8s/)
