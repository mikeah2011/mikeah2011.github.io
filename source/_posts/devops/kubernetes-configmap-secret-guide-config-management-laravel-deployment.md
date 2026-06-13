---
title: "Kubernetes ConfigMap/Secret 实战：配置管理与敏感数据处理——Laravel 应用部署的配置治理踩坑记录"
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-16 21:50:51
updated: 2026-05-16 21:57:35
categories:
  - devops
  - kubernetes
tags: [DevOps, Kubernetes, Laravel, 配置管理, 容器化, 安全, Sealed-Secrets, GitOps]
keywords: [Kubernetes ConfigMap, Secret, Laravel, 配置管理与敏感数据处理, 应用部署的配置治理踩坑记录, DevOps]
description: "Kubernetes ConfigMap/Secret 完全实战指南：详解 Laravel 容器化部署中的配置管理全流程，涵盖环境变量注入与 Volume 文件挂载两种方案对比、Sealed Secrets 加密与 External Secrets Operator 对接 AWS、Reloader 配置热更新自动重启机制，附 8 大生产环境踩坑记录与安全最佳实践清单。"

---

# Kubernetes ConfigMap/Secret 实战：配置管理与敏感数据处理

## 前言

把一个 Laravel 应用打包成 Docker 镜像只是容器化的第一步。真正让人头疼的是：`.env` 文件里的数据库密码、Redis 连接串、第三方 API Key 怎么管理？不同环境（dev/staging/prod）的配置怎么隔离？配置变更后怎么不重启 Pod 就生效？

这些问题在传统部署时代可以用 Ansible + `.env` 文件 + 文件权限来解决，但在 Kubernetes 里，ConfigMap 和 Secret 才是正道。本文基于 KKday B2C API 项目从传统部署迁移到 K8s 的真实经验，把配置管理的每个环节拆开讲透。

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                          │
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌────────────────┐  │
│  │   ConfigMap   │    │    Secret     │    │ External       │  │
│  │  (非敏感配置)  │    │  (敏感数据)    │    │ Secrets Mgr    │  │
│  │               │    │               │    │ (AWS SM/Vault) │  │
│  │ APP_NAME      │    │ DB_PASSWORD   │    │                │  │
│  │ APP_ENV       │    │ REDIS_PASSWORD│    │  ┌──────────┐  │  │
│  │ LOG_LEVEL     │    │ API_SECRET_KEY│    │  │ExternalS.│  │  │
│  │ CACHE_TTL     │    │ JWT_SECRET    │    │  │ Operator │  │  │
│  └───────┬───────┘    └───────┬───────┘    │  └────┬─────┘  │  │
│          │                    │             └───────┼────────┘  │
│          │ envFrom / volume   │ envFrom / volume    │ sync      │
│          ▼                    ▼                     ▼           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Laravel Pod                            │   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐ │   │
│  │  │  Nginx  │→ │PHP-FPM 8 │→ │ Laravel │→ │  .env    │ │   │
│  │  │         │  │          │  │  App    │  │ (mounted)│ │   │
│  │  └─────────┘  └──────────┘  └─────────┘  └──────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CI/CD Pipeline (ArgoCD / GitHub Actions)               │   │
│  │  kubectl apply → 检测 ConfigMap/Secret 变更 → 滚动更新  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 一、ConfigMap 基础：Laravel 非敏感配置管理

### 1.1 从 .env 文件创建 ConfigMap

最直接的方式是把 Laravel 的 `.env` 文件转成 ConfigMap：

```bash
# 从文件创建（排除敏感字段）
kubectl create configmap laravel-config \
  --from-env-file=.env.production \
  -n b2c-api
```

但实际项目中，我们不会把整个 `.env` 扔进去。更好的做法是拆分——把非敏感配置放 ConfigMap，敏感配置放 Secret：

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: laravel-config
  namespace: b2c-api
  labels:
    app: laravel-b2c
    env: production
data:
  # 应用基础配置
  APP_NAME: "KKday B2C API"
  APP_ENV: "production"
  APP_DEBUG: "false"
  APP_URL: "https://api.kkday.com"
  APP_TIMEZONE: "Asia/Taipei"
  APP_LOCALE: "zh_TW"

  # 日志配置
  LOG_CHANNEL: "stack"
  LOG_LEVEL: "warning"
  LOG_STACK: "single,daily"

  # 缓存/队列驱动
  CACHE_DRIVER: "redis"
  QUEUE_CONNECTION: "redis"
  SESSION_DRIVER: "redis"

  # 业务配置
  SEARCH_ENGINE: "elasticsearch"
  RECOMMEND_ALGORITHM: "collaborative_filtering"
  B2C_DEFAULT_CURRENCY: "TWD"
  B2C_DEFAULT_COUNTRY: "TW"

  # 多版本 API 配置
  API_VERSION_DEFAULT: "v3"
  API_VERSION_DEPRECATED: "v2"
  API_RATE_LIMIT_PER_MINUTE: "120"
```

### 1.2 从 YAML 文件批量创建

```bash
kubectl apply -f configmap.yaml
# 验证
kubectl get configmap laravel-config -n b2c-api -o yaml
```

### 1.3 用 Kustomize 管理多环境配置

真实项目有 dev/staging/prod 三套环境，用 Kustomize 的 overlay 模式管理：

```
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── configmap.yaml        # 公共配置
│   └── deployment.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── configmap-patch.yaml   # APP_DEBUG: "true"
    ├── staging/
    │   ├── kustomization.yaml
    │   └── configmap-patch.yaml
    └── prod/
        ├── kustomization.yaml
        └── configmap-patch.yaml   # APP_DEBUG: "false"
```

```yaml
# overlays/prod/configmap-patch.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: laravel-config
data:
  APP_ENV: "production"
  APP_DEBUG: "false"
  LOG_LEVEL: "warning"
  API_RATE_LIMIT_PER_MINUTE: "300"
```

## 二、Secret 管理：敏感数据的安全治理

### 2.1 基本 Secret 创建

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: laravel-secrets
  namespace: b2c-api
type: Opaque
stringData:                    # stringData 会自动 base64 编码
  DB_PASSWORD: "S3cur3P@ssw0rd!"
  DB_USERNAME: "laravel_b2c"
  REDIS_PASSWORD: "r3d1s_s3cr3t"
  JWT_SECRET: "your-256-bit-secret-key-here"
  STRIPE_SECRET_KEY: "sk_live_xxxxxxxxxxxx"
  ALIPAY_PRIVATE_KEY: |
    -----BEGIN RSA PRIVATE KEY-----
    MIIEpAIBAAKCAQEA...
    -----END RSA PRIVATE KEY-----
```

⚠️ **踩坑 #1**：`data` 字段需要 base64 编码，`stringData` 是明文但只在创建时生效。用 `kubectl edit secret` 修改时，你看到的永远是 base64 后的值。

```bash
# 手动 base64 编码
echo -n 'S3cur3P@ssw0rd!' | base64
# 输出: UzNjdXIzUEBzc3cwcmQh

# 查看 Secret 的明文值
kubectl get secret laravel-secrets -n b2c-api -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
```

### 2.2 Sealed Secrets：GitOps 安全方案

把 Secret 直接提交到 Git 仓库是大忌。Sealed Secrets 用非对称加密解决这个问题：

```bash
# 安装 kubeseal CLI
brew install kubeseal

# 从集群获取 sealing key（只需一次）
kubeseal --controller-name sealed-secrets \
  --controller-namespace kube-system \
  --fetch-cert > pub-cert.pem

# 加密 Secret → 生成 SealedSecret（可以安全提交到 Git）
kubeseal --cert pub-cert.pem \
  --format yaml \
  < secret.yaml > sealed-secret.yaml
```

生成的 `SealedSecret` 只能被集群内的 controller 解密：

```yaml
# sealed-secret.yaml（可以安全提交到 Git）
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: laravel-secrets
  namespace: b2c-api
spec:
  encryptedData:
    DB_PASSWORD: AgBY3k8x...（加密后的数据，不可逆）
    REDIS_PASSWORD: AgCF7m2p...
    JWT_SECRET: AgDx9n1v...
```

⚠️ **踩坑 #2**：SealedSecret 的 `name` 和 `namespace` 必须与目标 Secret 完全一致，否则 controller 无法匹配。我们在一次部署中因为 namespace 拼写错误（`b2c-api` 写成了 `b2c_api`），导致 Pod 启动后读不到 Secret，排查了 40 分钟。

### 2.3 External Secrets Operator：对接 AWS Secrets Manager

如果团队已经用 AWS Secrets Manager 或 HashiCorp Vault 管理密钥，可以用 External Secrets Operator 自动同步：

```yaml
# external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: laravel-external-secrets
  namespace: b2c-api
spec:
  refreshInterval: 1h           # 每小时同步一次
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: laravel-secrets        # 生成的 K8s Secret 名称
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: b2c-api/production/database
        property: password
    - secretKey: JWT_SECRET
      remoteRef:
        key: b2c-api/production/jwt
        property: secret_key
    - secretKey: STRIPE_SECRET_KEY
      remoteRef:
        key: b2c-api/production/stripe
        property: secret_key
```

架构示意：

```
┌─────────────────┐     sync      ┌────────────────┐     mount      ┌──────────┐
│ AWS Secrets     │ ──────────→  │ K8s Secret     │ ──────────→   │ Laravel  │
│ Manager         │  (1h interval)│ (auto-created) │               │ Pod      │
│                 │               │                │               │          │
│ b2c-api/prod/   │               │ laravel-secrets│               │ .env     │
│  ├─ database    │               │  ├─ DB_PASSWORD│               │ (mounted)│
│  ├─ jwt         │               │  ├─ JWT_SECRET │               │          │
│  └─ stripe      │               │  └─ STRIPE_KEY │               │          │
└─────────────────┘               └────────────────┘               └──────────┘
```

## 三、注入方式对比：envFrom vs Volume Mount

### 3.1 环境变量注入（envFrom）

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-b2c
  namespace: b2c-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: laravel-b2c
  template:
    metadata:
      labels:
        app: laravel-b2c
    spec:
      containers:
        - name: php-fpm
          image: registry.kkday.com/b2c-api:v3.2.1
          envFrom:
            - configMapRef:
                name: laravel-config
            - secretRef:
                name: laravel-secrets
          ports:
            - containerPort: 9000
```

这种方式把所有 ConfigMap/Secret 的 key-value 直接注入为环境变量。Laravel 通过 `env()` 读取。

⚠️ **踩坑 #3**：`envFrom` 注入的环境变量**优先级低于** Pod spec 中直接定义的 `env`。如果你在 ConfigMap 里设了 `APP_ENV=production`，但 deployment 的 `env` 里也有 `APP_ENV=staging`，最终值是 `staging`。这个优先级链是：

```
Pod env (最高) > Container env > envFrom (最低)
```

### 3.2 Volume 挂载（推荐方式）

```yaml
spec:
  containers:
    - name: php-fpm
      image: registry.kkday.com/b2c-api:v3.2.1
      volumeMounts:
        - name: config-volume
          mountPath: /var/www/html/config/app.php
          subPath: app.php            # 挂载单个文件
          readOnly: true
        - name: env-volume
          mountPath: /var/www/html/.env
          subPath: .env               # 挂载为 .env 文件
          readOnly: true
        - name: secret-volume
          mountPath: /var/www/html/storage/certs
          readOnly: true
  volumes:
    - name: config-volume
      configMap:
        name: laravel-config-files
    - name: env-volume
      configMap:
        name: laravel-env           # 非敏感的 .env 部分
    - name: secret-volume
      secret:
        secretName: laravel-secrets
        defaultMode: 0400           # 只读权限
```

### 3.3 两种方式对比

```
┌──────────────┬────────────────────────────┬────────────────────────────────┐
│   维度       │  envFrom (环境变量)         │  Volume Mount (文件挂载)        │
├──────────────┼────────────────────────────┼────────────────────────────────┤
│ 读取方式     │ env('DB_PASSWORD')         │ 直接读文件 / .env              │
│ 热更新       │ ❌ 需重启 Pod              │ ✅ 自动更新（有延迟）           │
│ 安全性       │ ❌ /proc/1/environ 可读    │ ✅ 可设文件权限                │
│ 大小限制     │ ❌ 1MB (etcd 限制)         │ ✅ 支持大文件                  │
│ Laravel 兼容 │ ✅ env() 直接可用          │ ✅ .env 文件原生支持           │
│ 推荐场景     │ 少量简单配置               │ 生产环境、大量配置             │
└──────────────┴────────────────────────────┴────────────────────────────────┘
```

**我们的选择**：非敏感配置用 `envFrom`（简单直接），敏感配置用 Volume Mount + `subPath`（安全 + 可控权限）。

## 四、热更新机制：不重启 Pod 的配置变更

### 4.1 ConfigMap 热更新

Volume 挂载的 ConfigMap 默认支持热更新，但有 60-90 秒的延迟（kubelet 同步周期）：

```bash
# 修改 ConfigMap
kubectl edit configmap laravel-config -n b2c-api
# 或
kubectl create configmap laravel-config \
  --from-env-file=.env.production.v2 \
  -n b2c-api --dry-run=client -o yaml | kubectl apply -f -
```

⚠️ **踩坑 #4**：如果用了 `subPath` 挂载，**ConfigMap 更新不会自动同步到容器**！这是 Kubernetes 的已知行为。`subPath` 创建的是一个独立的文件副本，不再跟随 ConfigMap 的 symlink 更新。

解决方案：不用 `subPath`，改为挂载整个目录，然后用 symlink 指向：

```yaml
# 不用 subPath，挂载整个目录
volumeMounts:
  - name: env-volume
    mountPath: /var/www/html/config-overlay
    readOnly: true

# 在容器启动脚本中 symlink
# entrypoint.sh
#!/bin/bash
ln -sf /var/www/html/config-overlay/.env /var/www/html/.env
php-fpm
```

### 4.2 Secret 热更新

Secret 的热更新行为与 ConfigMap 相同，但对于数据库密码等关键配置，更推荐用 **rolling restart** 确保一致性：

```bash
# 触发滚动重启（不中断服务）
kubectl rollout restart deployment/laravel-b2c -n b2c-api

# 或者用 stakater/Reloader 自动检测 ConfigMap/Secret 变更并触发重启
# 安装：helm install reloader stakater/reloader
```

```yaml
# deployment.yaml 添加 annotation
metadata:
  annotations:
    configmap.reloader.stakater.com/reload: "laravel-config"
    secret.reloader.stakater.com/reload: "laravel-secrets"
```

### 4.3 配置热更新流程图

```
开发者修改配置
    │
    ▼
Git Push (sealed-secret.yaml / configmap.yaml)
    │
    ▼
ArgoCD 检测到变更
    │
    ├─ ConfigMap 变更 ──→ kubectl apply ──→ 自动同步到 Volume（60-90s）
    │                                        │
    │                                        ▼
    │                                  Laravel 重新读取配置
    │
    └─ Secret 变更 ──→ kubectl apply ──→ Reloader 检测到变更
                                          │
                                          ▼
                                    触发 Rolling Restart
                                          │
                                          ▼
                                    新 Pod 读取新 Secret
```

## 五、Laravel 集成：从 .env 到 K8s 的完整链路

### 5.1 推荐的 .env 拆分策略

```
.env.k8s-base      → ConfigMap（公共非敏感配置）
.env.k8s-secrets   → Secret（敏感配置）
.env.k8s-overlays  → ConfigMap（环境特定覆盖）
```

```php
// bootstrap/app.php 或 AppServiceProvider
// Laravel 默认从 $_ENV / $_SERVER 读取环境变量
// 当配置通过 envFrom 注入时，env() 可以直接读取
// 当配置通过 Volume 挂载为 .env 文件时，Dotenv 组件会自动解析
```

### 5.2 配置缓存的陷阱

Laravel 的 `php artisan config:cache` 会把所有配置序列化到 `bootstrap/cache/config.php`，之后 `env()` 调用全部返回 `null`。

在 K8s 环境中：

```dockerfile
# Dockerfile
FROM php:8.1-fpm

# ... 安装依赖 ...

COPY . /var/www/html

# ⚠️ 不要在构建时执行 config:cache！
# 因为 .env 文件在构建时不存在（运行时才注入）
# RUN php artisan config:cache   ← 错误！

# 正确做法：在启动脚本中缓存
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
```

```bash
#!/bin/bash
# docker-entrypoint.sh

# 等待配置文件挂载就绪
while [ ! -f /var/www/html/.env ]; do
  echo "Waiting for .env file..."
  sleep 1
done

# 此时 .env 已通过 Volume 挂载，可以安全缓存
php artisan config:cache
php artisan route:cache
php artisan view:cache

# 启动 PHP-FPM
php-fpm
```

⚠️ **踩坑 #5**：我们曾经在 `config:cache` 之后发现所有配置都变成了默认值。原因是 config:cache 执行时 `.env` 文件还没挂载完成（竞争条件）。解决方案是加 `while` 等待循环 + readiness probe。

### 5.3 配置验证中间件

```php
// app/Http/Middleware/ValidateConfig.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class ValidateConfig
{
    public function handle(Request $request, Closure $next)
    {
        // 启动时验证关键配置已注入
        $required = [
            'DB_HOST', 'DB_PASSWORD', 'REDIS_HOST',
            'JWT_SECRET', 'STRIPE_SECRET_KEY',
        ];

        foreach ($required as $key) {
            if (empty(env($key))) {
                abort(503, "Configuration missing: {$key}");
            }
        }

        return $next($request);
    }
}
```

```php
// bootstrap/app.php (Laravel 11+)
->withMiddleware(function (Middleware $middleware) {
    $middleware->prepend(\App\Http\Middleware\ValidateConfig::class);
})
```

## 六、踩坑记录汇总

| # | 问题 | 原因 | 解决方案 |
|---|------|------|----------|
| 1 | `data` 字段需要手动 base64 | 混淆了 `data` 和 `stringData` | 用 `stringData` 创建，用 `kubectl get -o jsonpath` 查看 |
| 2 | SealedSecret namespace 不匹配 | 拼写错误 `b2c_api` vs `b2c-api` | CI 流水线加 YAML lint 校验 |
| 3 | envFrom 优先级低于 env | 不了解 K8s 环境变量优先级链 | 统一用 ConfigMap 管理，不在 Pod spec 中重复定义 |
| 4 | subPath 挂载不更新 | K8s 已知行为 | 改用目录挂载 + symlink，或用 Reloader 触发重启 |
| 5 | config:cache 读到空值 | .env 未挂载完成就执行缓存 | entrypoint.sh 加等待循环 + readiness probe |
| 6 | Secret 超过 1MB | etcd 对象大小限制 | 用 Volume 挂载代替 envFrom，拆分 Secret |
| 7 | ConfigMap 更新后 Laravel 不感知 | config:cache 把配置固化了 | 生产环境用 envFrom 而非 config:cache |
| 8 | 多 Pod 配置不一致 | 滚动更新中间态 | readinessProbe 确保新 Pod 配置就绪后再接流量 |

### 6.1 常用调试命令速查

在排查 ConfigMap/Secret 相关问题时，以下 kubectl 命令非常实用：

```bash
# 查看 Pod 的所有环境变量（来自 ConfigMap/Secret）
kubectl exec -it deploy/laravel-b2c -n b2c-api -- env | grep -E "APP_|DB_|REDIS_"

# 查看挂载的 .env 文件内容
kubectl exec -it deploy/laravel-b2c -n b2c-api -- cat /var/www/html/.env

# 检查 ConfigMap 是否正确挂载到容器
kubectl exec -it deploy/laravel-b2c -n b2c-api -- ls -la /var/www/html/config-overlay/

# 查看 ConfigMap 的所有 key
kubectl get configmap laravel-config -n b2c-api -o jsonpath='{.data}' | jq keys

# 对比两个环境的 ConfigMap 差异
diff <(kubectl get cm laravel-config -n b2c-dev -o jsonpath='{.data}' | jq -S .) \
     <(kubectl get cm laravel-config -n b2c-prod -o jsonpath='{.data}' | jq -S .)

# 查看 Secret 的明文值（调试用，生产环境慎用！）
kubectl get secret laravel-secrets -n b2c-api -o json | \
  jq '.data | map_values(@base64d)'

# 检查 Pod 是否因为 Secret 缺失而 CrashLoopBackOff
kubectl describe pod -l app=laravel-b2c -n b2c-api | grep -A5 "Events"

# 验证 SealedSecret 是否已成功解密为普通 Secret
kubectl get sealedsecret laravel-secrets -n b2c-api \
  -o jsonpath='{.status.conditions[0].reason}'
```

**配置注入优先级速查表**：

| 注入方式 | 优先级 | 热更新 | 安全性 | 适用场景 |
|----------|--------|--------|--------|----------|
| Pod spec `env` | 最高 | ❌ 需重启 | 中 | 覆盖默认值 |
| Container spec `env` | 高 | ❌ 需重启 | 中 | 容器级覆盖 |
| `envFrom` (ConfigMap) | 中 | ❌ 需重启 | 低 | 批量非敏感配置 |
| `envFrom` (Secret) | 中 | ❌ 需重启 | 中 | 批量敏感配置 |
| Volume Mount | 独立读取 | ✅ 自动更新 | 高 | 生产环境推荐 |
| Init Container 注入 | 最早执行 | ❌ 需重启 | 高 | 复杂初始化逻辑 |

## 七、方案对比：ConfigMap vs Secret vs Sealed Secrets vs External Secrets Operator

在选择配置管理方案时，需要从安全性、GitOps 友好度、运维复杂度等维度综合评估：

| 维度 | ConfigMap | Secret (原生) | Sealed Secrets | External Secrets Operator |
|------|-----------|---------------|-----------------|--------------------------|
| **数据类型** | 非敏感配置 | 敏感数据 | 敏感数据（加密） | 敏感数据（外部托管） |
| **存储加密** | ❌ 明文存储在 etcd | ⚠️ base64 编码（非加密） | ✅ 非对称加密 | ✅ 外部密钥管理服务 |
| **GitOps 安全** | ✅ 可直接提交 Git | ❌ 禁止提交 Git | ✅ 可安全提交 Git | ✅ 仅存引用，不含密钥 |
| **密钥轮换** | 不适用 | 手动轮换 | 手动重新加密 | ✅ 自动同步轮换 |
| **运维复杂度** | 低 | 低 | 中（需维护 controller） | 中高（需对接外部服务） |
| **多集群支持** | 单集群 | 单集群 | ⚠️ 每集群独立 key | ✅ 多集群共享密钥源 |
| **适用团队规模** | 小型 | 小型 | 中型 | 大型 / 企业级 |
| **Laravel 集成** | env() / Volume | env() / Volume | 同 Secret | 同 Secret |

**选型建议**：
- **小团队 / 简单项目**：原生 Secret + RBAC 权限控制即可
- **中型团队 / GitOps 流程**：Sealed Secrets 是最低成本的安全方案
- **大型团队 / 多集群 / 合规要求**：External Secrets Operator + AWS Secrets Manager / HashiCorp Vault

## 八、安全最佳实践清单

```
┌─────────────────────────────────────────────────────────────────┐
│                    配置安全检查清单                              │
├─────────────────────────────────────────────────────────────────┤
│ □ Secret 不以明文提交到 Git（使用 Sealed Secrets / SOPS）       │
│ □ Secret 的 defaultMode 设为 0400（只读）                       │
│ □ 生产环境 APP_DEBUG=false                                      │
│ □ RBAC 限制 Secret 的访问权限                                   │
│ □ 启用 etcd 加密（EncryptionConfiguration）                     │
│ □ 定期轮换 Secret（至少 90 天一次）                             │
│ □ 使用 NetworkPolicy 限制 Pod 间通信                            │
│ □ 审计日志监控 Secret 的读取行为                                │
│ □ ConfigMap 不包含任何敏感信息                                  │
│ □ 使用 External Secrets Operator 对接密钥管理服务               │
└─────────────────────────────────────────────────────────────────┘
```

## 九、总结

Kubernetes 的配置管理看似简单（不就是 key-value 吗？），但在实际的 Laravel B2C API 部署中，从 `.env` 文件到 ConfigMap/Secret 的迁移涉及安全、可用性、运维便利性的多重权衡：

1. **拆分是第一步**：非敏感配置走 ConfigMap，敏感配置走 Secret
2. **Volume Mount > envFrom**：生产环境优先用文件挂载，支持热更新和权限控制
3. **Sealed Secrets 是 GitOps 的基础**：Secret 必须加密后才能提交到 Git
4. **config:cache 需要谨慎**：在容器化环境中，配置缓存的时机和前提条件都变了
5. **自动化一切**：用 Reloader 自动检测变更，用 ArgoCD 自动同步，用 External Secrets 自动轮换

配置管理没有银弹，但有一条底线：**永远不要把密码提交到 Git 仓库**。

## 相关阅读

- [Kubernetes HPA 实战：Laravel 应用自动扩缩容策略与踩坑记录](/categories/DevOps/kubernetes-hpa-guide-laravel/)
- [Kubernetes Ingress 实战：Nginx/Traefik + TLS 部署指南](/categories/DevOps/kubernetes-ingress-guide-nginx-traefik-tls-deployment/)
- [Docker Compose + PHP-FPM 实战：微服务部署经验](/categories/DevOps/docker-compose-php-fpmguide-microservicesdeployment/)
- [Docker Compose Laravel 本地开发环境实战](/categories/DevOps/docker-compose-laravel-guide-php-fpm-8-3-mysql-redis-mailpit-guide/)
- [K8s HPA/VPA 自动扩缩容实战：Laravel API 应用](/categories/DevOps/k8s-hpa-vpa-guide-laravel-api-cpu/)
