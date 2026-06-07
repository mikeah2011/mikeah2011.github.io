# K8s 基础：Pod / Deployment / Service / kubectl

## 定义

Kubernetes 的核心资源模型围绕三个基础对象构建：**Pod**（最小调度单元）、**Deployment**（声明式副本管理）和 **Service**（服务发现与负载均衡）。kubectl 是操作这些资源的命令行工具。

## 核心原理

### Pod：最小调度单元

Pod 是 K8s 中最小的可部署单元，包含一个或多个共享网络和存储的容器。

```
┌─────────────────────────────┐
│           Pod                │
│  ┌──────────┐ ┌──────────┐  │
│  │ PHP-FPM  │ │  Nginx   │  │
│  │ container│ │ container│  │
│  └──────────┘ └──────────┘  │
│     共享 Network + Volume    │
└─────────────────────────────┘
```

**关键特性：**
- 一个 Pod 一个 IP，容器间通过 localhost 通信
- Pod 是临时的、不可变的，失败后不会自愈
- 生命周期：Pending → Running → Succeeded/Failed

### Deployment：声明式副本管理

Deployment 管理 Pod 副本集（ReplicaSet），支持滚动更新和回滚。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-api
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # 最多多出 1 个 Pod
      maxUnavailable: 0   # 不允许不可用
  selector:
    matchLabels:
      app: laravel-api
  template:
    metadata:
      labels:
        app: laravel-api
    spec:
      containers:
      - name: php-fpm
        image: registry.example.com/laravel-api:v1.2.3
        ports:
        - containerPort: 9000
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
```

**滚动更新流程：**
1. 创建新版 ReplicaSet
2. 逐步扩容新 Pod、缩容旧 Pod
3. 通过 `maxSurge` 和 `maxUnavailable` 控制更新速度

### Service：服务发现与负载均衡

Service 为一组 Pod 提供稳定的网络端点。

| Service 类型 | 用途 | 场景 |
|---|---|---|
| ClusterIP | 集群内部访问（默认） | Pod 间通信 |
| NodePort | 通过节点端口暴露 | 开发/测试 |
| LoadBalancer | 云厂商负载均衡器 | 生产外部访问 |
| ExternalName | DNS CNAME 映射 | 外部服务别名 |

```yaml
apiVersion: v1
kind: Service
metadata:
  name: laravel-api-svc
spec:
  type: ClusterIP
  selector:
    app: laravel-api
  ports:
  - port: 80
    targetPort: 9000
```

### kubectl 核心命令速查

```bash
# 查看资源
kubectl get pods -n production
kubectl get deployments -o wide
kubectl describe pod <pod-name>

# 日志查看
kubectl logs <pod-name> -f --tail=100
kubectl logs <pod-name> -c <container-name>  # 多容器 Pod

# 执行命令
kubectl exec -it <pod-name> -- bash
kubectl exec <pod-name> -- php artisan migrate:status

# 部署操作
kubectl apply -f deployment.yaml
kubectl set image deployment/laravel-api php-fpm=registry/laravel:v1.2.4
kubectl rollout status deployment/laravel-api
kubectl rollout undo deployment/laravel-api
kubectl rollout history deployment/laravel-api

# 调试
kubectl port-forward svc/laravel-api-svc 8080:80
kubectl top pods
kubectl describe pod <pod-name> | grep -A5 "Last State"
```

## 实战案例

来自博客文章：
- [kubectl 实战：Pod、Deployment、Service 基础操作](/categories/DevOps/kubectl-1-36-guide-pod-deployment-service/) - 以 Laravel B2C API 为例的 kubectl 日常操作
- [Kubernetes 基础操作命令](/categories/DevOps/kubernetes-1/) - 常用命令速查

## Laravel B2C API 部署拓扑

```
                         ┌─────────────────────────────┐
                         │       Ingress Controller     │
                         │     (Nginx / Traefik)        │
                         └──────────┬──────────────────┘
                                    │
                         ┌──────────▼──────────────────┐
                         │     Service (ClusterIP)      │
                         │     laravel-api-svc:80       │
                         └──────────┬──────────────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   │                │                │
            ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
            │   Pod #1     │  │   Pod #2     │  │   Pod #3     │
            │  PHP-FPM     │  │  PHP-FPM     │  │  PHP-FPM     │
            │  + Nginx     │  │  + Nginx     │  │  + Nginx     │
            └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
                   └────────────────┼────────────────┘
                                    │
                         ┌──────────▼──────────────────┐
                         │   MySQL / Redis (外部或集群内) │
                         └─────────────────────────────┘
```

## 相关概念

- [本地开发环境](本地开发环境.md) - 在本地运行 K8s 集群
- [自动扩缩容](自动扩缩容.md) - HPA/VPA 自动调整 Pod 数量/资源
- [Ingress 与网络](Ingress与网络.md) - 外部流量路由
- [配置管理](配置管理.md) - ConfigMap/Secret 环境变量注入

## 常见问题

### Pod 一直处于 Pending 状态
- **资源不足**：`kubectl describe pod` 查看 Events，检查是否有 Insufficient cpu/memory
- **节点选择器不匹配**：检查 nodeSelector 或 nodeAffinity
- **PVC 未绑定**：检查 PersistentVolumeClaim 状态

### Deployment 滚动更新卡住
- **健康检查失败**：readinessProbe 配置不当导致新 Pod 不就绪
- **镜像拉取失败**：检查 imagePullSecrets 和镜像仓库权限
- **资源配额超限**：检查 namespace 的 ResourceQuota

### Service 无法访问 Pod
- **Label 不匹配**：Service selector 与 Pod labels 必须完全一致
- **端口配置错误**：Service port → targetPort 映射是否正确
- **NetworkPolicy 阻断**：检查是否有 NetworkPolicy 限制流量
