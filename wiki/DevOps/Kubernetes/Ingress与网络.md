# Ingress 与网络

## 定义

**Ingress** 是 K8s 中管理外部 HTTP/HTTPS 流量路由的资源对象，通过 Ingress Controller（Nginx / Traefik）实现域名解析、路径路由、TLS 终止和负载均衡。

## 核心原理

### 流量路由链路

```
Client → DNS → LoadBalancer → Ingress Controller → Service → Pod
```

### Ingress Controller 对比

| 特性 | Nginx Ingress | Traefik |
|---|---|---|
| 社区成熟度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 配置方式 | Annotation + Ingress CRD | IngressRoute CRD |
| 自动 TLS | cert-manager 集成 | 内置 Let's Encrypt |
| 性能 | 高（需调优） | 高（原生 Go） |
| Dashboard | 无内置 | 内置 Dashboard |
| 灰度发布 | 需额外配置 | 内置 Weighted Round Robin |

### Nginx Ingress 配置示例

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-api-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "10"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - api.example.com
    secretName: api-tls-secret
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: laravel-api-svc
            port:
              number: 80
      - path: /admin
        pathType: Prefix
        backend:
          service:
            name: laravel-admin-svc
            port:
              number: 80
```

### Service 类型详解

| 类型 | 用途 | 外部可达 | 场景 |
|---|---|---|---|
| ClusterIP | 集群内部访问 | ❌ | Pod 间通信（默认） |
| NodePort | 节点端口暴露 | ✅ (NodeIP:Port) | 开发/测试 |
| LoadBalancer | 云 LB | ✅ | 生产外部访问 |
| ExternalName | DNS CNAME | - | 外部服务别名 |
| Headless | 无 ClusterIP | - | StatefulSet |

### DNS 服务发现

K8s 内置 CoreDNS，Pod 间通过 DNS 名称互相访问：

```
# 同 namespace
http://service-name:port

# 跨 namespace
http://service-name.namespace.svc.cluster.local:port

# 示例
http://laravel-api-svc:80
http://redis-master.database.svc.cluster.local:6379
```

## 实战案例

来自博客文章：
- [Kubernetes Ingress 实战：Nginx/Traefik 配置与 TLS](/categories/DevOps/kubernetes-ingress-guide-nginx-traefik-tls-deployment/) - Laravel B2C API 部署踩坑记录

## 相关概念

- [K8s 基础](K8s基础.md) - Service 基础
- [Helm 包管理](Helm包管理.md) - Ingress 模板化
- [服务网格 Istio](服务网格Istio.md) - Ingress Gateway 替代方案
- [蓝绿部署与零停机发布](../蓝绿部署与零停机发布.md) - Ingress 级别的流量切换

## 常见问题

### Ingress 创建后 404
- 检查 Ingress Controller 是否运行：`kubectl get pods -n ingress-nginx`
- 检查 `ingressClassName` 是否匹配
- 检查 Service selector 与 Pod labels 是否一致

### TLS 证书不生效
- cert-manager 是否安装：`kubectl get pods -n cert-manager`
- ClusterIssuer 是否创建：`kubectl get clusterissuer`
- 检查 Certificate 资源状态：`kubectl describe certificate`

### 性能问题
- Nginx Ingress 的 `keepalive` 连接数调优
- 启用 Gzip 压缩：`nginx.ingress.kubernetes.io/enable-gzip: "true"`
- 调整 `proxy-buffer-size` 应对大 Header
