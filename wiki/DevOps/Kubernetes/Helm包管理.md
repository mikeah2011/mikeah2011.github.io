# Helm 包管理

## 定义

**Helm** 是 Kubernetes 的包管理器，将一组相关 K8s 资源打包成 Chart，通过 values 注入差异配置，用 release 版本管理生命周期。类似于 Linux 的 apt/yum 或 PHP 的 Composer。

## 核心原理

### Helm Chart 结构

```
laravel-api-chart/
├── Chart.yaml          # 元数据（名称、版本、依赖）
├── values.yaml         # 默认配置值
├── values-dev.yaml     # 开发环境覆盖
├── values-staging.yaml # 预发布环境覆盖
├── values-prod.yaml    # 生产环境覆盖
├── Chart.lock          # 子 Chart 依赖锁定
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── serviceaccount.yaml
│   ├── _helpers.tpl    # 模板辅助函数
│   └── tests/
│       └── test-connection.yaml
└── charts/             # 子 Chart 依赖
```

### values.yaml 分层设计

```yaml
# values.yaml（默认值）
replicaCount: 2
image:
  repository: registry.example.com/laravel-api
  tag: "latest"
  pullPolicy: IfNotPresent
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1Gi
ingress:
  enabled: true
  host: api.example.com
  tls: true
hpa:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
env:
  APP_ENV: production
  LOG_CHANNEL: stderr
```

```yaml
# values-prod.yaml（生产环境覆盖）
replicaCount: 4
image:
  tag: "v1.2.3"
resources:
  requests:
    cpu: 1000m
    memory: 1Gi
hpa:
  minReplicas: 4
  maxReplicas: 20
```

### 常用 Helm 命令

```bash
# 创建 Chart
helm create laravel-api-chart

# 模板渲染（检查 YAML 是否正确）
helm template my-release ./laravel-api-chart -f values-prod.yaml

# 安装
helm install laravel-api ./laravel-api-chart \
  -f values-prod.yaml \
  -n production \
  --create-namespace

# 升级
helm upgrade laravel-api ./laravel-api-chart \
  -f values-prod.yaml \
  --set image.tag=v1.2.4

# 回滚
helm rollback laravel-api 1  # 回滚到 revision 1

# 查看历史
helm history laravel-api

# 卸载
helm uninstall laravel-api -n production
```

### 30+ 仓库批量部署策略

```
共享 Chart Library（laravel-base-chart）
         │
    ┌────┼────┬────────┬────────┐
    ▼    ▼    ▼        ▼        ▼
  仓库1  仓库2  仓库3   ...    仓库30
  values  values values        values
  .yaml   .yaml  .yaml        .yaml
```

每个仓库只需维护自己的 `values.yaml`，共享的模板逻辑放在 Chart Library 中。

## 实战案例

来自博客文章：
- [Helm Chart 实战：Laravel 应用打包与部署](/categories/DevOps/helm-chart-guide-laravel-deployment/) - 30+ 仓库批量部署踩坑记录

## 相关概念

- [配置管理](配置管理.md) - ConfigMap/Secret 模板化
- [GitOps 与 ArgoCD](GitOps与ArgoCD.md) - Helm + ArgoCD 持续部署
- [自动扩缩容](自动扩缩容.md) - HPA 模板化
- [Ingress 与网络](Ingress与网络.md) - Ingress 模板化

## 常见问题

### helm template 渲染报错
- 检查模板语法：`{{ .Values.xxx }}` 大括号和点号不能错
- 检查 values.yaml 中的类型：数字不要加引号
- 使用 `--debug` 查看完整渲染输出

### values 覆盖不生效
- Helm 的合并是浅合并（shallow merge），嵌套对象需要完整覆盖
- 使用 `--set` 的优先级高于 `-f values.yaml`
- 检查是否有 `values-*.yaml` 文件覆盖了默认值

### Chart 依赖更新
```bash
helm dependency update ./laravel-api-chart
helm dependency build ./laravel-api-chart
```
