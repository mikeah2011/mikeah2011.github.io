---

title: Kubernetes 基础操作命令
keywords: [Kubernetes, 基础操作命令]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- Kubernetes
- K8s
- 容器编排
- DevOps
categories:
- devops
- kubernetes
date: 2021-03-20 10:23:13
description: 本文系统整理 Kubernetes 常用 kubectl 命令，涵盖 Pod、Deployment、Service 的创建与管理、ConfigMap/Secret 配置、HPA 自动扩缩容、资源限制及故障排查技巧，适合 K8s 入门与日常运维参考。
---



| 初始版本 | 2014年6月7日                                    |
| :------- | ------------------------------------------------------ |
| 稳定版本 | 1.23.1（2021年12月16日）                      |
| 源代码库 | [kubernetes](https://github.com/kubernetes/kubernetes) |
| 编程语言 | Go                                                     |
| 操作系统 | 跨平台                                                 |
| 类型     | 集群管理                                               |
| 许可协议 | Apache许可证 2.0                                       |
| 网站     | [kubernetes.io](https://kubernetes.io/)                |

**Kubernetes**（常简称为**K8s**）是用于自动部署、扩展和管理"容器化（containerized）应用程序"的开源系统。该系统由 Google 设计并捐赠给Cloud Native Computing Foundation（今属Linux基金会）来使用。

它旨在提供"跨主机集群的自动部署、扩展以及运行应用程序容器的平台"。它支持一系列容器工具，包括Docker等。

More info: [Kubernetes](https://zh.wikipedia.org/wiki/kubernetes)

---

## 一、基础资源查看命令

### 查看默认命名空间下的 Pod

```bash
kubectl get pods
```

或使用缩写形式，效果完全相同：

```bash
kubectl get pod
kubectl get po
```

输出示例：

```
NAME                          READY   STATUS    RESTARTS   AGE
nginx-7fb96c846b-2jklm        1/1     Running   0          3d5h
redis-6b8c7d9f4-mnopq         1/1     Running   2          5d
api-deployment-5d6f7g8h-xrst  1/1     Running   0          12h
```

### 查看所有命名空间的 Pod

```bash
kubectl get po -A
# 等价于
kubectl get po --all-namespaces
```

输出示例：

```
NAMESPACE       NAME                                      READY   STATUS    RESTARTS   AGE
default         nginx-7fb96c846b-2jklm                    1/1     Running   0          3d
kube-system     coredns-558bd4d5db-abcde                  1/1     Running   0          10d
kube-system     etcd-master-node                          1/1     Running   0          10d
kube-system     kube-apiserver-master-node                1/1     Running   0          10d
kube-system     kube-controller-manager-master-node       1/1     Running   0          10d
kube-system     kube-proxy-xyz12                          1/1     Running   0          10d
kube-system     kube-scheduler-master-node                1/1     Running   0          10d
ingress-nginx   ingress-nginx-controller-7d8f9g-hijkl     1/1     Running   0          7d
```

### 查看指定命名空间下的 Pod

```bash
kubectl get po -n dev-jingsocial
```

### 以详细信息查看 Pod

```bash
kubectl get po -o wide
```

输出示例：

```
NAME                     READY   STATUS    RESTARTS   AGE   IP           NODE         NOMINATED NODE   READINESS GATES
nginx-7fb96c846b-2jklm   1/1     Running   0          3d    10.244.1.5   worker-01    <none>           <none>
```

### 查看 Pod 详细描述

```bash
kubectl describe pod nginx-7fb96c846b-2jklm
```

此命令会输出 Pod 的完整信息，包括 Events、容器状态、标签、注解等，是排查问题时最常用的命令之一。

---

## 二、Pod 创建与管理

### 使用 YAML 创建 Pod

创建文件 `nginx-pod.yaml`：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
    env: production
spec:
  containers:
    - name: nginx
      image: nginx:1.24
      ports:
        - containerPort: 80
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "500m"
          memory: "256Mi"
```

```bash
kubectl apply -f nginx-pod.yaml
```

### 进入 Pod 容器

```bash
# 进入默认容器
kubectl exec nginx-pod -it -- bash

# 指定命名空间
kubectl exec user-deployment-66f996944c-9b4qq -it -- bash -n dev-jingsocial

# 当 Pod 中有多个容器时，用 -c 指定容器名
kubectl exec nginx-pod -it -c nginx -- bash
```

### 使用 Label 选择器进入容器

```bash
kubectl exec $(kubectl get po -l app=nginx -o jsonpath='{.items[0].metadata.name}' -n dev-jingsocial) -it -- bash -n dev-jingsocial
```

### 文件拷贝

```bash
# 本地文件拷贝到容器
kubectl cp /Users/michael/config.json nginx-pod:/etc/app/config.json

# 容器文件拷贝到本地
kubectl cp nginx-pod:/var/log/nginx/access.log ./access.log

# 指定命名空间
kubectl cp /Users/michael/.kube/config user-deployment-66f996944c-9b4qq:/var/www/.kube/config -n dev-jingsocial
```

### 删除 Pod

```bash
kubectl delete pod nginx-pod
# 按标签批量删除
kubectl delete po -l app=nginx
# 强制删除（不等待优雅关闭）
kubectl delete pod nginx-pod --grace-period=0 --force
```

---

## 三、Deployment 管理

### 创建 Deployment

创建文件 `nginx-deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.24
          ports:
            - containerPort: 80
          livenessProbe:
            httpGet:
              path: /healthz
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 3
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

```bash
kubectl apply -f nginx-deployment.yaml
```

### 常用 Deployment 操作

```bash
# 查看 Deployment 列表
kubectl get deployments
kubectl get deploy

# 查看 Deployment 详情
kubectl describe deploy nginx-deployment

# 扩缩容
kubectl scale deployment nginx-deployment --replicas=5

# 滚动更新镜像
kubectl set image deployment/nginx-deployment nginx=nginx:1.25

# 查看滚动更新状态
kubectl rollout status deployment/nginx-deployment

# 查看更新历史
kubectl rollout history deployment/nginx-deployment

# 回滚到上一个版本
kubectl rollout undo deployment/nginx-deployment

# 回滚到指定版本
kubectl rollout undo deployment/nginx-deployment --to-revision=2
```

---

## 四、Service 管理

### 创建 Service

创建文件 `nginx-service.yaml`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-service
  labels:
    app: nginx
spec:
  selector:
    app: nginx
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 80
      protocol: TCP
```

如需外部访问，可使用 NodePort 类型：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-nodeport
spec:
  selector:
    app: nginx
  type: NodePort
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
```

```bash
kubectl apply -f nginx-service.yaml
```

### Service 操作命令

```bash
# 查看 Service
kubectl get svc
kubectl get services -A

# 查看 Service 详情（含 Endpoints）
kubectl describe svc nginx-service

# 查看 Endpoints
kubectl get endpoints nginx-service
```

输出示例：

```
NAME            TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
nginx-service   ClusterIP   10.96.45.123   <none>        80/TCP    2d
```

---

## 五、ConfigMap 与 Secret

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_ENV: "production"
  APP_DEBUG: "false"
  DATABASE_HOST: "mysql.default.svc.cluster.local"
  nginx.conf: |
    server {
        listen 80;
        server_name example.com;
        location / {
            root /usr/share/nginx/html;
            index index.html;
        }
    }
```

```bash
# 从文件创建 ConfigMap
kubectl create configmap app-config --from-file=nginx.conf

# 从键值对创建
kubectl create configmap app-config --from-literal=APP_ENV=production --from-literal=APP_DEBUG=false

# 查看 ConfigMap
kubectl get configmap
kubectl describe configmap app-config
```

在 Pod 中引用 ConfigMap：

```yaml
spec:
  containers:
    - name: app
      image: nginx:1.24
      envFrom:
        - configMapRef:
            name: app-config
      volumeMounts:
        - name: nginx-config
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: nginx-config
      configMap:
        name: app-config
        items:
          - key: nginx.conf
            path: default.conf
```

### Secret

```bash
# 创建通用 Secret
kubectl create secret generic db-secret \
  --from-literal=DB_USER=admin \
  --from-literal=DB_PASSWORD='s3cret!P@ss'

# 创建 TLS Secret
kubectl create secret tls tls-secret \
  --cert=server.crt \
  --key=server.key

# 创建 docker-registry Secret（用于拉取私有镜像）
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=pass

# 查看 Secret（值为 base64 编码）
kubectl get secrets
kubectl describe secret db-secret
```

在 Pod 中使用 Secret：

```yaml
spec:
  containers:
    - name: app
      image: myapp:latest
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: DB_USER
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: DB_PASSWORD
```

---

## 六、资源管理（Requests & Limits）

```yaml
spec:
  containers:
    - name: app
      image: nginx:1.24
      resources:
        requests:
          cpu: "250m"       # 请求 0.25 核 CPU
          memory: "256Mi"   # 请求 256Mi 内存
        limits:
          cpu: "1"          # 最多使用 1 核 CPU
          memory: "512Mi"   # 最多使用 512Mi 内存
```

### 查看资源使用情况

```bash
# 需要 metrics-server 安装
kubectl top nodes
kubectl top pods
kubectl top pods -n dev-jingsocial
```

输出示例：

```
NAME           CPU(cores)   MEMORY(bytes)
worker-01      250m         1024Mi
worker-02      180m         768Mi
```

### LimitRange（命名空间级别限制）

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: dev-jingsocial
spec:
  limits:
    - default:
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      type: Container
```

### ResourceQuota（命名空间配额）

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: dev-quota
  namespace: dev-jingsocial
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    pods: "20"
```

---

## 七、HPA 自动扩缩容

### 基于 CPU 的 HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### 基于 CPU 和内存的 HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
```

```bash
# 创建 HPA（命令行方式）
kubectl autoscale deployment nginx-deployment --cpu-percent=70 --min=2 --max=10

# 查看 HPA
kubectl get hpa

# 查看 HPA 详情
kubectl describe hpa nginx-hpa

# 删除 HPA
kubectl delete hpa nginx-hpa
```

输出示例：

```
NAME          REFERENCE                  TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
nginx-hpa     Deployment/nginx-deployment  45%/70%   2         10        3          2d
```

---

## 八、查看资源信息的技巧

### 使用 jsonpath 查询

```bash
# 查看 Pod 的某个 label 值
kubectl get po -o jsonpath='{.items[*].metadata.labels.k8s-app}' -n dev-jingsocial

# 获取所有 Pod 名称（每行一个）
kubectl get po -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'

# 获取所有 Pod 的 IP 地址
kubectl get po -o jsonpath='{.items[*].status.podIP}'

# 获取 Service 的 ClusterIP
kubectl get svc nginx-service -o jsonpath='{.spec.clusterIP}'
```

### 使用自定义列输出

```bash
kubectl get pods -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName
```

输出示例：

```
NAME                          STATUS    NODE
nginx-7fb96c846b-2jklm        Running   worker-01
redis-6b8c7d9f4-mnopq         Running   worker-02
```

---

## 九、故障排查命令

### 查看 Pod 日志

```bash
# 查看日志
kubectl logs nginx-pod

# 实时跟踪日志
kubectl logs nginx-pod -f

# 查看最近 100 行
kubectl logs nginx-pod --tail=100

# 查看前一个容器的日志（容器重启后）
kubectl logs nginx-pod --previous

# 多容器 Pod 指定容器
kubectl logs nginx-pod -c sidecar
```

### 查看事件

```bash
# 按时间排序查看所有事件
kubectl get events --sort-by='.lastTimestamp'

# 查看指定命名空间的事件
kubectl get events -n dev-jingsocial

# 只看 Warning 级别事件
kubectl get events --field-selector type=Warning
```

### 排查 Pod 异常状态

```bash
# Pod 处于 Pending 状态时，查看原因
kubectl describe pod <pod-name>

# 常见 Pending 原因：
# - 资源不足（Insufficient cpu/memory）
# - 没有满足条件的节点（node selector/affinity 不匹配）
# - PVC 未绑定

# Pod 处于 CrashLoopBackOff 时
kubectl logs <pod-name> --previous

# Pod 处于 ImagePullBackOff 时
kubectl describe pod <pod-name>
# 检查镜像名称、仓库认证等
```

### 网络排查

```bash
# 在容器内测试网络连通性
kubectl exec nginx-pod -- curl -s http://nginx-service:80

# 使用临时调试容器（K8s 1.18+）
kubectl debug nginx-pod -it --image=busybox --target=nginx

# 查看 DNS 解析
kubectl exec nginx-pod -- nslookup kubernetes.default
```

---

## 十、常用资源缩写对照

| 资源类型       | 缩写   |
| :------------- | :----- |
| pods           | po     |
| deployments    | deploy |
| services       | svc    |
| namespaces     | ns     |
| nodes          | no     |
| configmaps     | cm     |
| secrets        | secret |
| daemonsets     | ds     |
| statefulsets   | sts    |
| replicasets    | rs     |
| persistentvolumeclaims | pvc |
| persistentvolumes | pv   |
| ingress        | ing    |
| events         | ev     |

---

## 相关阅读

- [Kubectl 1.36 完整指南：Pod、Deployment、Service 深度实践](/devops/kubectl-1-36-guide-pod-deployment-service/)
- [Kubernetes ConfigMap 与 Secret 配置管理实战](/devops/kubernetes-configmap-secret-guide-config-management-laravel-deployment/)
- [Kubernetes HPA 自动扩缩容指南](/devops/kubernetes-hpa-guide-laravel/)
