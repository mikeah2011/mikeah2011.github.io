---

title: Kubernetes 本地开发-minikube-kind-k3s-选型实战-Laravel踩坑记录
keywords: [Kubernetes, minikube, kind, k3s, Laravel, 本地开发, 选型实战, 踩坑记录]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-16 23:25:38
updated: 2026-05-16 23:28:41
categories:
- devops
- kubernetes
tags:
- Docker
- Kubernetes
- Laravel
- macOS
- DevOps
- Helm
description: macOS上搭建本地Kubernetes开发环境，深度对比minikube、kind、k3s三大工具的启动速度、资源占用、功能完整度与Apple Silicon兼容性。基于Laravel B2C API项目真实踩坑经验，包含YAML部署清单、Helm Chart打包、GitHub Actions/GitLab CI集成示例及Laravel K8s适配完整方案。
---


# Kubernetes 本地开发：minikube vs kind vs k3s 选型实战

> 在 macOS 上跑 Laravel 的 K8s 开发环境，到底选 minikube、kind 还是 k3s？
> 本文基于 30+ 仓库的真实使用经验，帮你避开我踩过的每一个坑。

## 背景：为什么需要本地 K8s 开发环境？

在 KKday B2C Backend Team 的日常开发中，我们的生产环境跑在 Kubernetes 上。本地开发如果只用 `docker-compose up`，会出现"本地跑得好好的，上线就炸"的问题——因为 K8s 的 Service Discovery、ConfigMap、Secret、HPA 等行为在 Docker Compose 中完全不存在。

所以我们需要一个**轻量、快速、尽量贴近生产**的本地 K8s 环境。

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                  macOS (Apple Silicon)                │
│                                                       │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  minikube    │  │   kind   │  │      k3s         │ │
│  │  (VM/Docker) │  │ (Docker) │  │ (Docker/systemd) │ │
│  │              │  │          │  │                  │ │
│  │  ┌────────┐  │  │ ┌──────┐ │  │  ┌────────────┐ │ │
│  │  │K8s API │  │  │ │K8s   │ │  │  │  K8s API   │ │ │
│  │  │Server  │  │  │ │API   │ │  │  │  Server    │ │ │
│  │  └────────┘  │  │ └──────┘ │  │  └────────────┘ │ │
│  │  ┌────────┐  │  │ ┌──────┐ │  │  ┌────────────┐ │ │
│  │  │kubelet │  │  │ │kube- │ │  │  │  kubelet   │ │ │
│  │  │(VM)    │  │  │ │let   │ │  │  │  (native)  │ │ │
│  │  └────────┘  │  │ └──────┘ │  │  └────────────┘ │ │
│  └─────────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 一、minikube：功能最全的"瑞士军刀"

### 安装与启动

```bash
# 安装
brew install minikube

# 启动（使用 Docker driver，推荐 M 芯片 Mac）
minikube start \
  --driver=docker \
  --cpus=4 \
  --memory=8192 \
  --kubernetes-version=v1.31.0 \
  --addons=ingress,metrics-server,registry

# 验证
kubectl cluster-info
kubectl get nodes
```

### 部署 Laravel 应用

```yaml
# laravel-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-api
  labels:
    app: laravel-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: laravel-api
  template:
    metadata:
      labels:
        app: laravel-api
    spec:
      containers:
        - name: laravel
          image: laravel-api:latest
          imagePullPolicy: Never  # 使用本地镜像
          ports:
            - containerPort: 9000
          envFrom:
            - configMapRef:
                name: laravel-config
            - secretRef:
                name: laravel-secrets
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /api/health
              port: 9000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /api/health
              port: 9000
            initialDelaySeconds: 30
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: laravel-service
spec:
  selector:
    app: laravel-api
  ports:
    - port: 80
      targetPort: 9000
  type: ClusterIP
```

### 踩坑记录

**坑 1：Apple Silicon 镜像架构不匹配**

```
standard_init_linux.go:228: exec user process caused: exec format error
```

minikube 的 Docker driver 默认使用 `linux/amd64`，而 M 芯片 Mac 构建的镜像是 `arm64`。

```bash
# 解决方案：启动时指定架构
minikube start --driver=docker --cpus=4 --memory=8192

# 构建镜像时使用 minikube 的 Docker daemon
eval $(minikube docker-env)
docker build --platform linux/amd64 -t laravel-api:latest .
```

**坑 2：minikube tunnel 需要 sudo**

```bash
# Ingress 访问需要 tunnel
minikube tunnel
# 提示需要 root 权限，生产环境不友好

# 替代方案：使用 NodePort
minikube service laravel-service --url
```

**坑 3：addons 启动慢，首次拉镜像超时**

```bash
# 预拉取镜像
minikube ssh -- docker pull registry.k8s.io/ingress-nginx/controller:v1.11.0

# 或者使用国内镜像源
minikube start --image-repository=registry.cn-hangzhou.aliyuncs.com/google_containers
```

### minikube 评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 启动速度 | ⭐⭐⭐ | 30-60s（Docker driver） |
| 资源占用 | ⭐⭐ | 2-4GB RAM |
| 功能完整度 | ⭐⭐⭐⭐⭐ | addons 生态丰富 |
| Apple Silicon | ⭐⭐⭐⭐ | 需要指定架构 |
| CI/CD 集成 | ⭐⭐⭐ | 需要额外配置 |

---

## 二、kind：CI/CD 最爱的轻量方案

kind（Kubernetes IN Docker）是 SIG-Testing 维护的工具，核心理念是**把 K8s 集群跑在 Docker 容器里**。

### 安装与启动

```bash
# 安装
brew install kind

# 创建集群配置
cat <<EOF > kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: laravel-dev
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 8080
        protocol: TCP
      - containerPort: 443
        hostPort: 8443
        protocol: TCP
  - role: worker
  - role: worker
EOF

# 创建多节点集群
kind create cluster --config kind-config.yaml

# 验证
kubectl cluster-info --context kind-laravel-dev
kubectl get nodes
```

### 部署 Laravel 到 kind

```bash
# 构建镜像
docker build -t laravel-api:latest .

# 加载镜像到 kind 集群
kind load docker-image laravel-api:latest --name laravel-dev

# 部署
kubectl apply -f laravel-deployment.yaml
kubectl apply -f laravel-service.yaml

# 安装 Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```

### 踩坑记录

**坑 1：kind 不支持 `minikube docker-env` 模式**

kind 没有内置的 Docker daemon 切换，每次构建完镜像都要手动 `kind load`：

```bash
# 写个 Makefile 简化
.PHONY: deploy
deploy:
	docker build -t laravel-api:latest .
	kind load docker-image laravel-api:latest --name laravel-dev
	kubectl rollout restart deployment/laravel-api
```

**坑 2：多节点集群在 macOS 上的资源竞争**

kind 的每个节点都是一个 Docker 容器，3 节点集群大约吃掉 3-4GB RAM。在 16GB 的 MacBook Pro 上，同时跑 PHPStorm + Chrome + kind 会明显卡顿。

```bash
# 轻量方案：单节点集群
kind create cluster --name laravel-lite --config - <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
EOF
```

**坑 3：Port Mapping 只在创建时生效**

```bash
# 创建后无法修改端口映射，只能删除重建
kind delete cluster --name laravel-dev
kind create cluster --config kind-config.yaml
```

**坑 4：镜像加载后 Pod 拉取失败**

```
Failed to pull image "laravel-api:latest": rpc error: code = NotFound
```

原因是 `imagePullPolicy: Always` 导致 kubelet 去远程仓库拉取而非使用本地镜像。

```yaml
# 解决：显式设置为 Never
imagePullPolicy: Never
```

### kind 评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 启动速度 | ⭐⭐⭐⭐⭐ | 10-20s |
| 资源占用 | ⭐⭐⭐⭐ | 1-2GB RAM（单节点） |
| 功能完整度 | ⭐⭐⭐ | 无 addons，需手动安装 |
| Apple Silicon | ⭐⭐⭐⭐⭐ | 原生支持 |
| CI/CD 集成 | ⭐⭐⭐⭐⭐ | GitHub Actions 官方推荐 |

---

## 三、k3s：最接近生产的轻量级 K8s

k3s 是 Rancher（现 SUSE）维护的轻量级 Kubernetes 发行版，**二进制只有 70MB**，专为 IoT 和边缘计算设计，但用于本地开发也非常合适。

### 安装与启动

```bash
# 方式 1：Docker 方式（推荐 macOS）
docker run -d --name k3s-server \
  --privileged \
  -p 6443:6443 \
  -p 80:80 \
  -p 443:443 \
  rancher/k3s:v1.31.0-k3s1 server \
  --disable=traefik

# 获取 kubeconfig
docker exec k3s-server cat /etc/rancher/k3s/k3s.yaml > ~/.kube/k3s-config
export KUBECONFIG=~/.kube/k3s-config

# 修改 server 地址（Docker 网络）
sed -i '' 's/127.0.0.1/0.0.0.0/g' ~/.kube/k3s-config

# 验证
kubectl get nodes
```

```bash
# 方式 2：使用 k3d（k3s 的 Docker wrapper，推荐）
brew install k3d

k3d cluster create laravel-dev \
  --servers 1 \
  --agents 2 \
  --port "8080:80@loadbalancer" \
  --port "8443:443@loadbalancer" \
  --k3s-arg "--disable=traefik@server:0"

# 验证
kubectl cluster-info
kubectl get nodes
```

### 部署 Laravel 到 k3s

```bash
# 使用 k3d 导入镜像
k3d image import laravel-api:latest -c laravel-dev

# 部署
kubectl apply -f laravel-deployment.yaml
kubectl apply -f laravel-service.yaml

# 安装 Nginx Ingress（替代默认的 Traefik）
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.0/deploy/static/provider/cloud/deploy.yaml
```

### 踩坑记录

**坑 1：k3s 默认安装 Traefik，与 Nginx Ingress 冲突**

```
Error: INSTALLATION FAILED: found existing Traefik installation
```

k3s 默认自带 Traefik 作为 Ingress Controller，如果你习惯用 Nginx Ingress，必须在创建集群时禁用：

```bash
k3d cluster create laravel-dev --k3s-arg "--disable=traefik@server:0"
```

**坑 2：k3d 的端口映射与 macOS 防火墙冲突**

```
Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:80
```

macOS 上 80 端口可能被占用（AirPlay Receiver 占用 5000/7000）。

```bash
# 检查端口占用
lsof -i :80

# 改用高位端口
k3d cluster create laravel-dev --port "9080:80@loadbalancer"
```

**坑 3：k3s 的 ServiceAccount Token 自动创建行为不同**

k3s 1.24+ 默认不自动创建 long-lived ServiceAccount Token，导致某些 Helm Chart 安装失败：

```yaml
# 手动创建 Token
apiVersion: v1
kind: Secret
metadata:
  name: laravel-sa-token
  annotations:
    kubernetes.io/service-account.name: laravel-sa
type: kubernetes.io/service-account-token
```

**坑 4：k3d 集群重启后 IP 变化**

```bash
# 重启集群
k3d cluster stop laravel-dev
k3d cluster start laravel-dev

# kubeconfig 中的 server IP 可能变化
k3d kubeconfig merge laravel-dev --kubeconfig-switch-context
```

### k3s 评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 启动速度 | ⭐⭐⭐⭐ | 15-30s（k3d） |
| 资源占用 | ⭐⭐⭐⭐ | 1-3GB RAM |
| 功能完整度 | ⭐⭐⭐⭐ | 内置 ServiceLB、local-path-provisioner |
| Apple Silicon | ⭐⭐⭐⭐⭐ | 原生支持 |
| CI/CD 集成 | ⭐⭐⭐⭐ | k3d 在 CI 中表现优秀 |

### 三工具统一对比表

| 特性 | minikube | kind | k3s (k3d) |
|------|----------|------|-----------|
| **底层架构** | VM 或 Docker 容器 | Docker 容器 | 原生二进制 / Docker 容器 |
| **启动时间** | 30-60s | 10-20s | 15-30s |
| **内存占用** | 2-4GB | 1-2GB (单节点) | 1-3GB |
| **多节点支持** | ❌ 单节点 | ✅ 多节点 | ✅ 多节点 |
| **内置 Ingress** | ✅ addon | ❌ 需手动安装 | ✅ Traefik 默认 |
| **内置 Metrics** | ✅ addon | ❌ 需手动安装 | ✅ 内置 |
| **内置 Registry** | ✅ addon | ❌ 需手动安装 | ✅ 内置 |
| **本地镜像加载** | `minikube docker-env` | `kind load docker-image` | `k3d image import` |
| **Apple Silicon** | ⚠️ 需指定架构 | ✅ 原生支持 | ✅ 原生支持 |
| **CI/CD 推荐度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **生产相似度** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **存储支持** | hostPath, CSI | hostPath | local-path-provisioner |
| **网络模型** | 标准 CNI | 标准 CNI | Flannel (内置) |
| **社区活跃度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **学习曲线** | 低 | 低 | 中 |

> 💡 **选型口诀**：功能全选 minikube，CI 测试选 kind，贴近生产选 k3s。

---

## 四、深度对比：三个维度选型决策

### 4.1 启动速度对比

```bash
# 测试脚本
#!/bin/bash
echo "=== minikube ==="
time minikube start --driver=docker --cpus=2 --memory=4096
minikube delete

echo "=== kind ==="
time kind create cluster --name bench
kind delete cluster --name bench

echo "=== k3d ==="
time k3d cluster create bench --servers 1
k3d cluster delete bench
```

实测结果（M2 Pro, 16GB RAM）：

```
minikube:  42.3s
kind:      18.7s
k3d:       23.1s
```

### 4.2 资源占用对比

```bash
# 查看 Docker 资源占用
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# minikube（单节点 + addons）
# CONTAINER          CPU %   MEM USAGE
# minikube           12.3%   2.1GB

# kind（3 节点）
# CONTAINER          CPU %   MEM USAGE
# laravel-dev-ctrl   8.2%    890MB
# laravel-dev-w1     5.1%    620MB
# laravel-dev-w2     4.8%    610MB
# Total: ~2.1GB

# k3d（1 server + 2 agents）
# CONTAINER          CPU %   MEM USAGE
# k3d-laravel-srv    9.5%    750MB
# k3d-laravel-a0     4.2%    480MB
# k3d-laravel-a1     4.0%    470MB
# Total: ~1.7GB
```

### 4.3 CI/CD 集成对比

**kind（GitHub Actions 推荐）：**

```yaml
# .github/workflows/k8s-test.yml
name: K8s Integration Test
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Create kind cluster
        uses: helm/kind-action@v1
        with:
          cluster_name: test-cluster
          config: kind-config.yaml

      - name: Load image
        run: kind load docker-image laravel-api:latest --name test-cluster

      - name: Deploy and test
        run: |
          kubectl apply -f k8s/
          kubectl wait --for=condition=ready pod -l app=laravel-api --timeout=120s
          kubectl run test-curl --image=curlimages/curl --rm -i --restart=Never \
            -- curl -s http://laravel-service/api/health
```

**k3d（GitLab CI 推荐）：**

```yaml
# .gitlab-ci.yml
k8s-test:
  image: docker:24-dind
  services:
    - docker:24-dind
  variables:
    K3D_VERSION: v5.7.0
  before_script:
    - apk add --no-cache curl bash
    - curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
    - k3d cluster create ci-cluster --wait
  script:
    - k3d image import laravel-api:latest -c ci-cluster
    - kubectl apply -f k8s/
    - kubectl wait --for=condition=ready pod -l app=laravel-api --timeout=120s
  after_script:
    - k3d cluster delete ci-cluster
```

---

## 五、Laravel 特有的适配问题

### 5.1 共享 Storage 目录

Laravel 的 `storage/` 目录需要可写，但在 K8s 中每个 Pod 的文件系统是临时的：

```yaml
# 使用 emptyDir 共享 storage
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: laravel
          volumeMounts:
            - name: storage
              mountPath: /var/www/html/storage
            - name: bootstrap-cache
              mountPath: /var/www/html/bootstrap/cache
      volumes:
        - name: storage
          emptyDir: {}
        - name: bootstrap-cache
          emptyDir: {}
```

### 5.1.1 ConfigMap 与 Secret 配置

```yaml
# laravel-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: laravel-config
data:
  APP_ENV: "local"
  APP_DEBUG: "true"
  APP_URL: "http://laravel-service"
  DB_HOST: "mysql-service"
  DB_PORT: "3306"
  DB_DATABASE: "laravel"
  CACHE_DRIVER: "redis"
  QUEUE_CONNECTION: "redis"
  SESSION_DRIVER: "redis"
  REDIS_HOST: "redis-service"
```

```yaml
# laravel-secret.yaml（生产环境建议用 Sealed Secrets 或 External Secrets Operator）
apiVersion: v1
kind: Secret
metadata:
  name: laravel-secrets
type: Opaque
stringData:
  APP_KEY: "base64:your-app-key-here"
  DB_USERNAME: "laravel"
  DB_PASSWORD: "secret-password"
  REDIS_PASSWORD: "redis-password"
```

```bash
# 创建 ConfigMap 和 Secret
kubectl apply -f laravel-configmap.yaml
kubectl create secret generic laravel-secrets \
  --from-literal=APP_KEY=base64:$(openssl rand -base64 32) \
  --from-literal=DB_PASSWORD=$(openssl rand -base64 16) \
  --from-literal=REDIS_PASSWORD=$(openssl rand -base64 16)

# 验证
kubectl get configmap laravel-config -o yaml
kubectl get secret laravel-secrets -o jsonpath='{.data.APP_KEY}' | base64 -d
```

### 5.2 本地镜像构建与加载

```dockerfile
# Dockerfile.k8s — Laravel K8s 优化镜像（多阶段构建）
FROM php:8.3-fpm-alpine AS base
RUN apk add --no-cache \
    nginx supervisor libzip-dev oniguruma-dev icu-dev \
    && docker-php-ext-install pdo_mysql zip opcache bcmath intl pcntl

FROM base AS composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

FROM base AS build
WORKDIR /app
COPY --from=composer /app/vendor ./vendor
COPY . .
RUN composer dump-autoload --optimize \
    && php artisan config:cache \
    && php artisan route:cache \
    && php artisan view:cache

FROM base AS production
WORKDIR /var/www/html
COPY --from=build /app .
RUN chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache
EXPOSE 9000
CMD ["php-fpm"]
```

> ⚠️ **坑点提醒**：K8s 环境中不要在 Dockerfile 里运行 `php artisan migrate`，数据库迁移应通过 Kubernetes Job 或 initContainer 执行，避免多 Pod 并发迁移导致锁表。

```makefile
# Makefile
IMAGE_NAME := laravel-api
IMAGE_TAG := latest
CLUSTER_NAME := laravel-dev

.PHONY: build
build:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

.PHONY: load
load: build
	@echo "Detecting cluster type..."
	@if kubectl config current-context | grep -q "kind"; then \
		kind load docker-image $(IMAGE_NAME):$(IMAGE_TAG) --name $(CLUSTER_NAME); \
	elif kubectl config current-context | grep -q "k3d"; then \
		k3d image import $(IMAGE_NAME):$(IMAGE_TAG) -c $(CLUSTER_NAME); \
	elif kubectl config current-context | grep -q "minikube"; then \
		eval $$(minikube docker-env) && docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .; \
	fi

.PHONY: deploy
load:
	kubectl apply -f k8s/
	kubectl rollout restart deployment/laravel-api
```

### 5.3 队列 Worker 与 Scheduler

```yaml
# laravel-workers.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: laravel-worker
  template:
    metadata:
      labels:
        app: laravel-worker
    spec:
      containers:
        - name: worker
          image: laravel-api:latest
          imagePullPolicy: Never
          command: ["php", "artisan", "queue:work", "redis", "--sleep=3", "--tries=3", "--max-time=3600"]
          envFrom:
            - configMapRef:
                name: laravel-config
            - secretRef:
                name: laravel-secrets
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: laravel-scheduler
spec:
  schedule: "* * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: scheduler
              image: laravel-api:latest
              imagePullPolicy: Never
              command: ["php", "artisan", "schedule:run"]
          restartPolicy: OnFailure
```

### 5.4 常用调试命令速查

```bash
# 查看 Pod 状态与详情
kubectl get pods -l app=laravel-api -o wide
kubectl describe pod <pod-name>

# 查看容器日志（实时跟踪）
kubectl logs -l app=laravel-api --tail=100 -f
kubectl logs <pod-name> --previous  # 查看上一次崩溃的日志

# 进入容器调试
kubectl exec -it <pod-name> -- sh
kubectl exec -it <pod-name> -- php artisan tinker
kubectl exec -it <pod-name> -- php artisan migrate:status

# 查看 Laravel 应用日志
kubectl exec -it <pod-name> -- tail -f storage/logs/laravel.log

# 端口转发（本地访问 Service）
kubectl port-forward service/laravel-service 8080:80
curl http://localhost:8080/api/health

# 查看资源使用
kubectl top pods -l app=laravel-api
kubectl top nodes

# 排查常见错误
kubectl get events --sort-by='.lastTimestamp' | tail -20
kubectl get events --field-selector reason=Failed

# 强制重启 Deployment
kubectl rollout restart deployment/laravel-api
kubectl rollout status deployment/laravel-api --watch

# 临时调试容器（K8s 1.25+）
kubectl debug <pod-name> -it --image=busybox --target=laravel
kubectl debug node/<node-name> -it --image=busybox  # 调试节点
```

### 5.5 PersistentVolumeClaim 持久化存储

```yaml
# laravel-pvc.yaml — 用于需要持久化的 storage（如文件上传）
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: laravel-storage-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path  # k3d 内置 storage class
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-api
spec:
  template:
    spec:
      containers:
        - name: laravel
          volumeMounts:
            - name: storage
              mountPath: /var/www/html/storage/app/public
      volumes:
        - name: storage
          persistentVolumeClaim:
            claimName: laravel-storage-pvc
```

```bash
# 查看 StorageClass
kubectl get storageclass

# 查看 PVC 状态
kubectl get pvc laravel-storage-pvc
```

---

## 六、最终选型建议

```
场景判断：
┌─────────────────────────────────────┐
│ 需要 addons（Ingress/Metrics/etc）？ │
└──────────┬────────────────┬─────────┘
           │ Yes            │ No
           ▼                ▼
     ┌──────────┐    ┌──────────────┐
     │ minikube │    │ 是 CI 环境？  │
     └──────────┘    └──┬───────┬───┘
                        │ Yes   │ No
                        ▼       ▼
                  ┌──────┐  ┌─────────┐
                  │ kind │  │ 需要    │
                  └──────┘  │ 接近生产？│
                            └──┬─────┬─┘
                               │     │
                            Yes│     │No
                               ▼     ▼
                          ┌──────┐ ┌──────┐
                          │ k3s  │ │ kind │
                          └──────┘ └──────┘
```

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| 日常开发调试 | k3d | 启动快、资源省、功能够用 |
| CI/CD 测试 | kind | GitHub Actions 官方支持、最轻量 |
| 需要完整 K8s 功能 | minikube | addons 生态最丰富 |
| 模拟多节点生产环境 | k3d | 3 节点只需 1.7GB |
| 团队统一开发环境 | k3d | 一行命令创建，配置简单 |

---

## 七、我的最终选择

在 KKday 的实际项目中，我们最终选择了 **k3d** 作为日常开发环境，**kind** 用于 CI/CD 测试。原因：

1. **k3d 启动快**：15-30 秒，比 minikube 快一倍
2. **资源省**：3 节点只占 1.7GB，minikube 单节点就 2GB+
3. **功能够用**：内置 ServiceLB、local-path-provisioner，不需要额外配置
4. **k3d 是 k3s 的 Docker 封装**：k3s 是生产级发行版，行为更接近真实环境
5. **kind 在 CI 中零配置**：GitHub Actions 的 `helm/kind-action` 一行搞定

---

## 总结

本地 K8s 开发环境没有银弹。minikube 胜在功能全面，kind 胜在轻量快速，k3s 胜在生产一致性。根据你的具体场景——日常开发、CI 测试、还是功能验证——选择最合适的那个。

记住：**本地环境的目的不是完全复制生产，而是尽早暴露 K8s 相关的问题**。选一个你能坚持使用的，比选一个"最好"的更重要。

---

*本文基于 macOS Sonoma 15.x + Apple Silicon M2 Pro 实测，Docker Desktop 4.x / Colima 0.x 环境。如有更新，以各工具官方文档为准。*

## 相关阅读

- [kubectl 1.36 实战：Pod、Deployment、Service 基础操作与 Laravel B2C API 踩坑记录](/categories/devops/kubectl-1-36-guide-pod-deployment-service/) — K8s 核心资源操作，本文的前置基础
- [Helm Chart 实战：Laravel 应用打包与部署踩坑记录](/categories/devops/helm-chart-guide-laravel-deployment/) — 用 Helm 管理 Laravel K8s 部署，与本地开发环境配合使用
- [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录](/categories/devops/argocd-gitops-guide-laravel-cd/) — 从本地开发到 GitOps 持续部署的进阶之路
