# K8s 调试与故障排查

## 定义

在 Kubernetes 环境中，生产 Pod 不能 SSH 登录，需要专门的调试策略和工具集：**kubectl debug**（临时调试容器）、**Ephemeral Container**（临时容器）、**Lens/OpenLens**（可视化 IDE）等。

## 核心原理

### 为什么 K8s 调试特殊？

- **容器镜像最小化**：生产镜像通常基于 Alpine 或 Distroless，缺少调试工具
- **Pod 生命周期短暂**：Pod 可能随时被调度器重新调度
- **网络隔离**：容器网络与宿主机网络隔离
- **多副本场景**：问题可能只出现在特定 Pod 中
- **不可变基础设施原则**：直接修改运行中的容器违背 K8s 设计理念

### kubectl debug：官方调试利器

```bash
# 注入包含完整调试工具的临时容器
kubectl debug -it laravel-app-7d8f9c6b4-xyz12 \
  --image=nicolaka/netshoot \
  --target=php-fpm \
  -- bash

# 在临时容器中，可以：
# - 共享目标容器的进程命名空间
# - 使用 tcpdump 抓包
# - 使用 curl 测试内部服务
# - 使用 strace 追踪系统调用

# 创建 Pod 副本进行调试（不修改原 Pod）
kubectl debug laravel-app-7d8f9c6b4-xyz12 \
  --copy-to=laravel-app-debug \
  --container=php-fpm \
  --image=nicolaka/netshoot \
  -- bash
```

### Ephemeral Container 配置

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: laravel-app
spec:
  ephemeralContainers:
  - name: debugger
    image: nicolaka/netshoot
    command: ["bash"]
    targetContainerName: php-fpm
    securityContext:
      capabilities:
        add: ["SYS_PTRACE", "NET_RAW"]
```

### 常见故障排查场景

#### 1. Pod OOMKilled

```bash
# 查看 Pod 最后状态
kubectl describe pod <pod-name> | grep -A10 "Last State"

# 查看 OOM 事件
kubectl get events --field-selector involvedObject.name=<pod-name> | grep OOM

# 查看内存使用趋势
kubectl top pod <pod-name> --containers
```

**Laravel 常见 OOM 原因：**
- PHP-FPM `pm.max_children` 过多
- Octane 进程内存泄漏
- 队列 Worker 处理大文件

#### 2. Pod 一直 CrashLoopBackOff

```bash
# 查看日志
kubectl logs <pod-name> --previous  # 查看上一次崩溃的日志

# 查看退出码
kubectl describe pod <pod-name> | grep "Exit Code"
```

**常见退出码：**
| 退出码 | 含义 | 常见原因 |
|---|---|---|
| 0 | 正常退出 | 进程主动退出 |
| 1 | 应用错误 | PHP Fatal Error |
| 137 | OOMKilled | 内存超出 limits |
| 143 | SIGTERM | 优雅终止 |

#### 3. 服务间通信失败

```bash
# 从 debug 容器测试 DNS
kubectl debug -it <pod-name> --image=nicolaka/netshoot -- nslookup laravel-api-svc

# 测试端口连通性
kubectl debug -it <pod-name> --image=nicolaka/netshoot -- nc -zv laravel-api-svc 80

# 抓包分析
kubectl debug -it <pod-name> --image=nicolaka/netshoot --target=php-fpm -- tcpdump -i eth0 port 80
```

### Lens / OpenLens 可视化工具

Lens 提供 K8s 集群的图形化界面：
- 实时查看 Pod/Deployment/Service 状态
- 一键进入 Pod Shell
- 查看日志流
- 资源使用监控
- 多集群管理

## 实战案例

来自博客文章：
- [Kubernetes Debugging 实战：kubectl debug/Ephemeral Container/Lens](/categories/运维/Kubernetes-Debugging-实战-kubectl-debug-ephemeral-container-Lens-Laravel-K8s-生产级故障排查工具箱/) - 生产级故障排查工具箱

## 相关概念

- [K8s 基础](K8s基础.md) - Pod 生命周期与状态
- [自动扩缩容](自动扩缩容.md) - OOMKilled 与资源限制
- [配置管理](配置管理.md) - 配置错误导致的启动失败
- [应用性能剖析与 Profiling](../应用性能剖析与Profiling.md) - PHP 级别的性能分析

## 常见问题

### kubectl debug 报错 "ephemeral containers are disabled"
- K8s < 1.23 需要开启 feature gate：`--feature-gates=EphemeralContainers=true`
- K8s >= 1.25 默认可用

### 无法注入调试容器（安全策略限制）
- 检查 Pod Security Policy / Pod Security Standards
- 可能需要特权级别的 securityContext
- 考虑使用 `kubectl debug --copy-to` 创建副本调试

### 日志太多看不过来
```bash
# 按时间筛选
kubectl logs <pod-name> --since=1h

# 只看错误
kubectl logs <pod-name> | grep -i "error\|fatal\|exception"

# 多 Pod 日志聚合
kubectl logs -l app=laravel-api --all-containers --tail=50
```
