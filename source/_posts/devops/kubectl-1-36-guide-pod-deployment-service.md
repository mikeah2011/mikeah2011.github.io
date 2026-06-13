---

title: kubectl-1.36-实战-Pod-Deployment-Service-基础操作与-Laravel-B2C-API-踩坑记录
keywords: [kubectl, Pod, Deployment, Service, Laravel, B2C, API, 基础操作与, 踩坑记录]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-16 23:00:27
updated: 2026-05-16 23:03:36
categories:
- devops
- kubernetes
tags:
- KKday
- Kubernetes
- Laravel
description: 从零开始掌握 kubectl 核心命令，以 Laravel B2C API 为例，覆盖 Pod 生命周期、Deployment 滚动更新、Service 服务发现的真实操作与踩坑记录。
---



# kubectl 1.36 实战：Pod、Deployment、Service 基础操作与 Laravel B2C API 踩坑记录

## 前言

之前写了 Ingress、ConfigMap/Secret、HPA/VPA 几篇进阶文章，但每次新人 Onboarding 时都会被问到一个基础问题："kubectl 到底怎么用？"

这篇文章就从最基础的三个资源对象 —— **Pod、Deployment、Service** —— 出发，用 Laravel B2C API 的真实场景来演示 kubectl 的日常操作。不是命令手册，而是"我在 30+ 仓库里真正常用的那些命令"。

---

## 目录

1. [架构总览：Laravel API 在 K8s 上的运行模型](#一架构总览laravel-api-在-k8s-上的运行模型)
2. [Pod 实战：最小调度单元的生命周期管理](#二pod-实战最小调度单元的生命周期管理)
3. [Deployment 实战：滚动更新与回滚](#三deployment-实战滚动更新与回滚)
4. [Service 实战：服务发现与负载均衡](#四service-实战服务发现与负载均衡)
5. [踩坑记录](#五踩坑记录)
6. [总结](#六总结)

---

## 一、架构总览：Laravel API 在 K8s 上的运行模型

先看一个典型的 Laravel B2C API 在 Kubernetes 上的部署拓扑：

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
                   │                │                │
                   └────────────────┼────────────────┘
                                    │
                         ┌──────────▼──────────────────┐
                         │   MySQL / Redis (外部或集群内) │
                         └─────────────────────────────┘
```

核心组件：

| 组件 | K8s 资源类型 | 作用 |
|------|-------------|------|
| Laravel API Pod | Deployment → Pod | 运行 PHP-FPM + Nginx 容器 |
| 内部访问 | Service (ClusterIP) | Pod 间服务发现与负载均衡 |
| 外部访问 | Ingress → Service | HTTP/HTTPS 路由入口 |
| 配置管理 | ConfigMap / Secret | 环境变量、数据库密码 |
| 队列 Worker | 另一个 Deployment | 消费 Laravel Queue |

---

## 二、Pod 实战：最小调度单元的生命周期管理

### 2.1 基础查看命令

Pod 是 K8s 中最小的可调度单元。日常排查的第一步永远是看 Pod 状态：

```bash
# 查看 default namespace 下所有 Pod
kubectl get pods

# 查看指定 namespace（Laravel 项目通常有独立 namespace）
kubectl get pods -n laravel-b2c

# 宽输出，显示 Node、IP、重启次数等
kubectl get pods -n laravel-b2c -o wide

# 按标签筛选（Laravel API Pod）
kubectl get pods -n laravel-b2c -l app=laravel-api

# 监听 Pod 变化（部署时很有用）
kubectl get pods -n laravel-b2c -w
```

输出示例：

```
NAME                            READY   STATUS    RESTARTS   AGE
laravel-api-7b8d9f6c4-x2k9m    1/1     Running   0          2d
laravel-api-7b8d9f6c4-k8j3p    1/1     Running   0          2d
laravel-api-7b8d9f6c4-m5n7q    1/1     Running   0          2d
queue-worker-5c6d7e8f9-abc12   1/1     Running   1          5d
```

**关键字段解读**：

| 字段 | 含义 | 异常信号 |
|------|------|---------|
| READY | 就绪/总容器数 | `0/1` = 未通过 readinessProbe |
| STATUS | Pod 阶段 | `CrashLoopBackOff`、`Pending`、`OOMKilled` |
| RESTARTS | 重启次数 | 持续增长 = 应用崩溃 |

### 2.2 查看 Pod 详情

```bash
# 查看 Pod 详细信息（事件、条件、容器状态）
kubectl describe pod laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c

# 查看 Pod 日志（最近 100 行）
kubectl logs laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c --tail=100

# 实时跟踪日志（类似 tail -f）
kubectl logs -f laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c

# 多容器 Pod 指定容器查看日志
kubectl logs laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -c nginx

# 查看前一个崩溃容器的日志（排查 CrashLoopBackOff 必用）
kubectl logs laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c --previous
```

### 2.3 进入容器调试

```bash
# 进入 Laravel API 容器执行 bash
kubectl exec -it laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- bash

# 执行单条命令（不进入交互模式）
kubectl exec laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- php artisan route:list

# 查看 Laravel 日志
kubectl exec laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- tail -50 storage/logs/laravel.log

# 运行数据库迁移
kubectl exec laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- php artisan migrate --force

# 清除缓存（部署后常见操作）
kubectl exec laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- php artisan config:cache
kubectl exec laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- php artisan route:cache
```

### 2.4 Pod 生命周期管理

```bash
# 手动删除 Pod（Deployment 会自动重建）
kubectl delete pod laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c

# 强制删除（卡在 Terminating 状态时使用）
kubectl delete pod laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c --grace-period=0 --force

# 删除指定 namespace 下所有 Pod（慎用，会触发全部重建）
kubectl delete pods --all -n laravel-b2c

# 查看 Pod 的 YAML 定义（排查配置问题时有用）
kubectl get pod laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -o yaml

# 只看 Pod 的资源请求和限制
kubectl get pod laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -o jsonpath='{.spec.containers[*].resources}'
```

### 2.5 资源使用监控

```bash
# 查看 Pod 的 CPU/内存使用（需要 metrics-server）
kubectl top pods -n laravel-b2c

# 按 CPU 排序（找 CPU 消耗最高的 Pod）
kubectl top pods -n laravel-b2c --sort-by=cpu

# 按内存排序（排查 OOMKilled）
kubectl top pods -n laravel-b2c --sort-by=memory

# 查看 Node 资源使用
kubectl top nodes
```

输出示例：

```
NAME                            CPU(cores)   MEMORY(bytes)
laravel-api-7b8d9f6c4-x2k9m    45m          128Mi
laravel-api-7b8d9f6c4-k8j3p    38m          115Mi
queue-worker-5c6d7e8f9-abc12   120m         256Mi
```

---

## 三、Deployment 实战：滚动更新与回滚

### 3.1 查看 Deployment

```bash
# 列出所有 Deployment
kubectl get deployments -n laravel-b2c

# 宽输出，显示镜像版本
kubectl get deployments -n laravel-b2c -o wide

# 查看 Deployment 详情（包含事件、条件）
kubectl describe deployment laravel-api -n laravel-b2c

# 查看 Deployment 的 YAML
kubectl get deployment laravel-api -n laravel-b2c -o yaml
```

输出示例：

```
NAME           READY   UP-TO-DATE   AVAILABLE   AGE
laravel-api    3/3     3            3           30d
queue-worker   2/2     2            2           30d
```

**字段解读**：

| 字段 | 含义 |
|------|------|
| READY | 就绪副本数/期望副本数 |
| UP-TO-DATE | 已更新到最新版本的副本数 |
| AVAILABLE | 可用副本数 |

### 3.2 滚动更新

Laravel API 部署时最常见的操作就是更新镜像版本：

```bash
# 更新镜像版本（触发滚动更新）
kubectl set image deployment/laravel-api \
  laravel-api=registry.example.com/laravel-api:v2.1.0 \
  -n laravel-b2c

# 查看滚动更新状态
kubectl rollout status deployment/laravel-api -n laravel-b2c

# 查看更新历史（回滚时需要）
kubectl rollout history deployment/laravel-api -n laravel-b2c
```

输出示例：

```
deployment "laravel-api" successfully rolled out
```

**滚动更新过程**：

```
时间线：
  t=0    Pod#1(v2.0.0)  Pod#2(v2.0.0)  Pod#3(v2.0.0)
  t=30s  Pod#4(v2.1.0)  Pod#2(v2.0.0)  Pod#3(v2.0.0)  ← 新 Pod 启动
  t=60s  Pod#4(v2.1.0)  Pod#5(v2.1.0)  Pod#3(v2.0.0)  ← 逐步替换
  t=90s  Pod#4(v2.1.0)  Pod#5(v2.1.0)  Pod#6(v2.1.0)  ← 全部更新
```

### 3.3 回滚操作

部署出问题时，回滚是最常用的操作：

```bash
# 回滚到上一个版本
kubectl rollout undo deployment/laravel-api -n laravel-b2c

# 回滚到指定版本
kubectl rollout undo deployment/laravel-api -n laravel-b2c --to-revision=3

# 查看回滚状态
kubectl rollout status deployment/laravel-api -n laravel-b2c
```

### 3.4 扩缩容

```bash
# 手动扩容到 5 个副本
kubectl scale deployment/laravel-api --replicas=5 -n laravel-b2c

# 缩容到 2 个副本
kubectl scale deployment/laravel-api --replicas=2 -n laravel-b2c

# 查看当前副本数
kubectl get deployment laravel-api -n laravel-b2c -o jsonpath='{.spec.replicas}'
```

### 3.5 重启与暂停

```bash
# 重启所有 Pod（不清除缓存的快速重启方式）
kubectl rollout restart deployment/laravel-api -n laravel-b2c

# 暂停 Deployment（批量修改配置时使用）
kubectl rollout pause deployment/laravel-api -n laravel-b2c

# 修改镜像 + 环境变量（暂停状态下不会触发更新）
kubectl set image deployment/laravel-api laravel-api=registry.example.com/laravel-api:v2.2.0 -n laravel-b2c
kubectl set env deployment/laravel-api APP_DEBUG=false -n laravel-b2c

# 恢复（一次性应用所有修改）
kubectl rollout resume deployment/laravel-api -n laravel-b2c
```

---

## 四、Service 实战：服务发现与负载均衡

### 4.1 查看 Service

```bash
# 列出所有 Service
kubectl get services -n laravel-b2c

# 查看 Service 详情
kubectl describe service laravel-api-svc -n laravel-b2c

# 查看 Service 关联的 Endpoints（实际 Pod IP 列表）
kubectl get endpoints laravel-api-svc -n laravel-b2c
```

输出示例：

```
NAME              TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
laravel-api-svc   ClusterIP   10.96.45.123    <none>        80/TCP    30d
mysql-svc         ClusterIP   10.96.67.89     <none>        3306/TCP  30d
redis-svc         ClusterIP   10.96.12.34     <none>        6379/TCP  30d
```

### 4.2 Service 类型

| 类型 | 使用场景 | 示例 |
|------|---------|------|
| ClusterIP | 集群内部访问（默认） | Laravel API ↔ MySQL |
| NodePort | 开发/测试环境外部访问 | 开发机直连 API |
| LoadBalancer | 生产环境外部访问 | 云厂商 LB |
| ExternalName | 外部服务别名 | 外部数据库 CNAME |

### 4.3 创建 Service

最常用的方式是通过 YAML 定义：

```yaml
# laravel-api-svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: laravel-api-svc
  namespace: laravel-b2c
  labels:
    app: laravel-api
spec:
  type: ClusterIP
  selector:
    app: laravel-api    # 匹配 Pod 的 label
  ports:
    - name: http
      port: 80           # Service 端口
      targetPort: 80     # 容器端口
      protocol: TCP
```

```bash
# 应用 YAML
kubectl apply -f laravel-api-svc.yaml

# 快速创建 Service（暴露 Deployment）
kubectl expose deployment laravel-api \
  --port=80 \
  --target-port=80 \
  --type=ClusterIP \
  -n laravel-b2c
```

### 4.4 服务发现

在集群内部，Pod 之间通过 DNS 名称互相访问：

```bash
# 在 Laravel API Pod 内部访问 MySQL
kubectl exec -it laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- \
  mysql -h mysql-svc.laravel-b2c.svc.cluster.local -u root -p

# 在 Laravel API Pod 内部访问 Redis
kubectl exec -it laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- \
  redis-cli -h redis-svc.laravel-b2c.svc.cluster.local
```

**DNS 解析规则**：

```
完整域名格式：
{service-name}.{namespace}.svc.cluster.local

同 namespace 可简写：
mysql-svc    （省略 .laravel-b2c.svc.cluster.local）

跨 namespace 必须写全：
mysql-svc.laravel-b2c.svc.cluster.local
```

### 4.5 Laravel .env 配置对应

在 K8s 中，Laravel 的 `.env` 文件通常通过 ConfigMap/Secret 注入。对应的数据库和 Redis 配置：

```env
# .env（K8s 环境）
DB_HOST=mysql-svc.laravel-b2c.svc.cluster.local
DB_PORT=3306
DB_DATABASE=laravel_b2c
DB_USERNAME=laravel
DB_PASSWORD=${DB_PASSWORD}   # 从 Secret 注入

REDIS_HOST=redis-svc.laravel-b2c.svc.cluster.local
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}   # 从 Secret 注入

# Session 和 Cache 使用 Redis
SESSION_DRIVER=redis
CACHE_DRIVER=redis
QUEUE_CONNECTION=redis
```

### 4.6 端口转发（本地调试）

开发时经常需要从本地直接访问集群内的 Service：

```bash
# 将本地 8080 端口转发到 laravel-api-svc 的 80 端口
kubectl port-forward service/laravel-api-svc 8080:80 -n laravel-b2c

# 直接转发到某个 Pod
kubectl port-forward pod/laravel-api-7b8d9f6c4-x2k9m 8080:80 -n laravel-b2c

# 转发 MySQL（本地调试数据库）
kubectl port-forward service/mysql-svc 3306:3306 -n laravel-b2c

# 后台运行端口转发
kubectl port-forward service/laravel-api-svc 8080:80 -n laravel-b2c &
```

---

## 五、踩坑记录

### 坑 1：Pod 一直 Pending，没有足够资源

**现象**：`kubectl get pods` 显示 Pod 一直处于 `Pending` 状态。

```bash
kubectl describe pod laravel-api-7b8d9f6c4-new -n laravel-b2c
```

```
Events:
  Type     Reason            Message
  ----     ------            -------
  Warning  FailedScheduling  0/3 nodes are available:
    - 1 Insufficient cpu
    - 2 node(s) had taint {node-role.kubernetes.io/master: }, that the pod didn't tolerate
```

**原因**：资源请求（requests）设置过高，Node 可用资源不足。

**解决方案**：

```bash
# 查看 Node 资源分配情况
kubectl describe node <node-name> | grep -A 5 "Allocated resources"

# 适当降低 requests
kubectl set resources deployment/laravel-api \
  --requests=cpu=200m,memory=256Mi \
  -n laravel-b2c
```

### 坑 2：CrashLoopBackOff，容器反复重启

**现象**：Pod STATUS 显示 `CrashLoopBackOff`，RESTARTS 持续增加。

```bash
# 查看当前日志（通常为空或只有启动信息）
kubectl logs laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c

# 关键：查看前一个容器的日志
kubectl logs laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c --previous
```

**常见原因**：

1. **PHP 启动失败**：`php artisan config:cache` 时环境变量缺失
2. **数据库连接失败**：`DB_HOST` 配置错误或 MySQL Pod 未就绪
3. **内存溢出**：PHP-FPM `memory_limit` 设置过低

**解决方案**：在 Deployment 中加入 `initContainers` 等待依赖服务：

```yaml
initContainers:
  - name: wait-for-mysql
    image: busybox:1.36
    command: ['sh', '-c', 'until nc -z mysql-svc 3306; do echo waiting for mysql; sleep 2; done;']
```

### 坑 3：Service 能 ping 通但 HTTP 访问 502

**现象**：`curl laravel-api-svc.laravel-b2c` 返回 502 Bad Gateway。

**原因**：Nginx 容器端口和 PHP-FPM 端口配置不一致。Service 的 `targetPort` 指向了错误的端口。

**排查步骤**：

```bash
# 1. 检查 Service 的 Endpoints 是否有 IP
kubectl get endpoints laravel-api-svc -n laravel-b2c

# 2. 检查 Pod 的容器端口
kubectl get pod laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -o jsonpath='{.spec.containers[*].ports}'

# 3. 直接 curl Pod IP 测试
kubectl exec -it laravel-api-7b8d9f6c4-x2k9m -n laravel-b2c -- curl -s localhost:80/health
```

**解决方案**：确保 Service 的 `targetPort` 与容器暴露的端口一致。

### 坑 4：滚动更新时出现短暂 503

**现象**：部署新版本时，部分请求返回 503。

**原因**：新 Pod 还没通过 readinessProbe 就被加入 Service，同时旧 Pod 已被终止。

**解决方案**：在 Deployment 中配置合理的探针和更新策略：

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # 最多多出 1 个 Pod
      maxUnavailable: 0    # 不允许不可用（零停机关键）
  template:
    spec:
      containers:
        - name: laravel-api
          readinessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]  # 等待连接排空
```

### 坑 5：kubectl exec 报 "unable to upgrade connection"

**现象**：`kubectl exec -it` 报连接错误。

```bash
error: unable to upgrade connection: Forbidden
```

**原因**：RBAC 权限不足，当前用户没有 `pods/exec` 权限。

**解决方案**：

```yaml
# rbac.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: laravel-dev
  namespace: laravel-b2c
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: laravel-dev-binding
  namespace: laravel-b2c
subjects:
  - kind: User
    name: michael
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: laravel-dev
  apiGroup: rbac.authorization.k8s.io
```

---

## 六、总结

### kubectl 速查表

| 操作 | 命令 |
|------|------|
| 查看 Pod | `kubectl get pods -n <ns>` |
| Pod 详情 | `kubectl describe pod <name> -n <ns>` |
| 查看日志 | `kubectl logs <pod> -n <ns> --tail=100` |
| 进入容器 | `kubectl exec -it <pod> -n <ns> -- bash` |
| 更新镜像 | `kubectl set image deployment/<name> <container>=<image> -n <ns>` |
| 回滚 | `kubectl rollout undo deployment/<name> -n <ns>` |
| 扩缩容 | `kubectl scale deployment/<name> --replicas=N -n <ns>` |
| 重启 | `kubectl rollout restart deployment/<name> -n <ns>` |
| 端口转发 | `kubectl port-forward svc/<name> <local>:<remote> -n <ns>` |
| 资源监控 | `kubectl top pods -n <ns> --sort-by=cpu` |

### 核心原则

1. **Pod 是无宠物（Cattle, not Pets）**：不要手动修改运行中的 Pod，所有变更通过 Deployment
2. **readinessProbe 比 livenessProbe 更重要**：没有 readiness 就会把流量打到没准备好的 Pod
3. **maxUnavailable: 0**：Laravel API 部署时，零停机的关键配置
4. **先看 Events 再看 Logs**：`describe` 的 Events 字段能快速定位 80% 的问题
5. **namespace 隔离**：不同环境（dev/staging/prod）用不同 namespace

---

> **草稿来源**：`.writing-backlog.md` → `kubectl 1.36 实战：Pod、Deployment、Service 基础操作`
> **生成时间**：2026-05-16 23:00:27
> **生成模型**：MiMo-v2.5-pro

---

## 相关阅读

- [Kubernetes 基础操作命令](/categories/devops/kubernetes-1/)
- [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录](/categories/devops/argocd-gitops-guide-laravel-cd/)
- [K8s HPA/VPA 自动扩缩容实战：Laravel API 从 CPU 误判到自定义指标扩容踩坑记录](/categories/devops/k8s-hpa-vpa-guide-laravel-api-cpu/)
- [Kubernetes ConfigMap/Secret 实战：配置管理与敏感数据处理](/categories/devops/kubernetes-configmap-secret-guide-config-management-laravel-deployment/)
- [Docker-Volume-实战-数据持久化备份恢复与NFS挂载-Laravel踩坑记录](/categories/devops/docker-volume-guide-nfs-laravel/)
