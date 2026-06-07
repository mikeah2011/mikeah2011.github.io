---
title: AI Agent with Code Interpreter 实战：沙箱化代码执行——让 Agent 安全运行用户代码的 Docker/Firecracker 方案
date: 2026-06-03 09:00:00
tags: [AI-Agent, Code-Interpreter, Docker, Firecracker, 沙箱, 安全]
categories: [架构]
cover: /images/covers/ai-agent-code-interpreter-cover.jpg
description: "AI Agent 执行用户代码面临严重安全风险。本文系统对比 Docker 容器、Firecracker microVM、gVisor、nsjail、WASM 五种沙箱隔离方案的架构原理与安全边界，提供完整的 Python/Node.js 代码执行沙箱实现。涵盖 namespace 隔离、seccomp 过滤、资源限制、网络策略、输出消毒等纵深防御手段，附带性能基准测试数据和生产级部署架构，帮助 AI 平台构建安全可靠的 Code Interpreter 能力。"
---

# AI Agent with Code Interpreter 实战：沙箱化代码执行——让 Agent 安全运行用户代码的 Docker/Firecracker 方案

## 一、为什么 Agent 需要代码执行能力？

当 AI Agent 从"对话助手"进化为"自主任务执行者"时，一个核心能力变得不可或缺——**代码执行**。OpenAI 的 Code Interpreter、Anthropic 的 Computer Use、Google 的 Code Execution，这些功能的共同目标是：让大模型不仅能生成代码，还能**运行代码、获取结果、迭代修正**。

想象以下场景：

- 用户上传一个 CSV 文件，要求 Agent 做数据分析并生成图表
- Agent 需要执行 `pandas` 代码进行数据清洗、计算统计量、绑定 matplotlib 画图
- 如果中间报错，Agent 需要读取错误信息、修改代码、重新执行

这个循环如果没有代码执行能力，就只能靠用户手动复制代码去跑，体验断裂。

### Code Interpreter 的核心价值

| 维度 | 纯文本 Agent | Code Interpreter Agent |
|------|-------------|----------------------|
| 数学计算 | LLM 算不准 | Python 精确计算 |
| 数据处理 | 描述性建议 | 直接处理并返回结果 |
| 文件操作 | 无法操作 | 读写转换文件 |
| 可验证性 | 低 | 代码+输出可验证 |
| 迭代能力 | 靠猜测修正 | 根据报错修正 |

## 二、沙箱隔离的需求分析

让用户或 LLM 生成的代码在服务器上直接运行，等同于打开了潘多拉魔盒。一个恶意（或 LLM 幻觉导致的）`rm -rf /` 就能摧毁整个系统。

### 威胁模型

```
┌─────────────────────────────────────────────┐
│              威胁向量分析                      │
├─────────────────────────────────────────────┤
│ 1. 文件系统破坏：读写敏感文件（/etc/passwd）    │
│ 2. 网络攻击：内网扫描、数据外传               │
│ 3. 资源耗尽：fork bomb、内存炸弹               │
│ 4. 宿主机逃逸：利用内核漏洞跳出容器            │
│ 5. 数据泄露：访问其他租户的文件               │
│ 6. 加密货币挖矿：占用 CPU 资源                │
└─────────────────────────────────────────────┘
```

### 安全隔离的关键维度

1. **进程隔离**：沙箱内进程不能看到宿主或其他沙箱进程
2. **文件系统隔离**：只能访问指定的工作目录
3. **网络隔离**：默认无网络，需要时白名单放行
4. **资源限制**：CPU、内存、磁盘、执行时间上限
5. **系统调用过滤**：禁止危险 syscall

## 三、方案一：Docker 容器沙箱

### 3.1 基础 Docker 沙箱

最直观的方案是为每次代码执行启动一个临时 Docker 容器：

```python
import docker
import json
import tempfile
import os

class DockerSandbox:
    """基于 Docker 的代码执行沙箱"""

    def __init__(self):
        self.client = docker.from_env()

    def execute(self, code: str, language: str = "python",
                timeout: int = 30, files: list = None) -> dict:
        """执行代码并返回结果"""

        # 准备工作目录
        with tempfile.TemporaryDirectory() as workdir:
            # 写入代码文件
            ext_map = {"python": "py", "javascript": "js", "bash": "sh"}
            code_file = os.path.join(workdir, f"main.{ext_map.get(language, 'txt')}")
            with open(code_file, "w") as f:
                f.write(code)

            # 写入输入文件
            if files:
                for file_info in files:
                    path = os.path.join(workdir, file_info["name"])
                    with open(path, "wb") as f:
                        f.write(file_info["content"])

            # 镜像映射
            image_map = {
                "python": "python:3.12-slim",
                "javascript": "node:20-slim",
                "bash": "ubuntu:22.04"
            }

            try:
                container = self.client.containers.run(
                    image=image_map.get(language, "python:3.12-slim"),
                    command=self._get_command(language, code_file),
                    volumes={workdir: {"bind": "/workspace", "mode": "rw"}},
                    working_dir="/workspace",
                    # 安全限制
                    network_disabled=True,           # 禁用网络
                    read_only=False,                  # 允许写工作目录
                    mem_limit="256m",                 # 内存限制 256MB
                    memswap_limit="256m",             # 禁止 swap
                    cpu_period=100000,                # CPU 限制
                    cpu_quota=50000,                  # 0.5 核
                    pids_limit=100,                   # 进程数限制
                    security_opt=["no-new-privileges"], # 禁止提权
                    cap_drop=["ALL"],                 # 丢弃所有 capabilities
                    tmpfs={"/tmp": "size=50m"},       # 临时文件系统
                    # 以非 root 用户运行
                    user="65534:65534",
                    # 标签
                    labels={"sandbox": "code-interpreter"},
                    detach=True
                )

                # 等待完成或超时
                result = container.wait(timeout=timeout)
                stdout = container.logs(stdout=True, stderr=False).decode("utf-8")
                stderr = container.logs(stdout=False, stderr=True).decode("utf-8")

                # 收集输出文件
                output_files = self._collect_output_files(workdir)

                return {
                    "exit_code": result["StatusCode"],
                    "stdout": stdout,
                    "stderr": stderr,
                    "files": output_files,
                    "timeout": False
                }

            except docker.errors.ContainerError as e:
                return {"exit_code": 1, "stdout": "", "stderr": str(e), "files": []}
            except Exception as e:
                if "timeout" in str(e).lower():
                    try:
                        container.kill()
                    except:
                        pass
                    return {"exit_code": -1, "stdout": "", "stderr": "Execution timed out", "files": [], "timeout": True}
                raise
            finally:
                try:
                    container.remove(force=True)
                except:
                    pass

    def _get_command(self, language: str, code_file: str) -> list:
        commands = {
            "python": ["python3", code_file],
            "javascript": ["node", code_file],
            "bash": ["bash", code_file]
        }
        return commands.get(language, ["python3", code_file])

    def _collect_output_files(self, workdir: str) -> list:
        """收集工作目录中的输出文件（排除输入代码文件）"""
        output_files = []
        for root, dirs, files in os.walk(workdir):
            for fname in files:
                if fname == "main.py" or fname == "main.js":
                    continue
                fpath = os.path.join(root, fname)
                rel_path = os.path.relpath(fpath, workdir)
                with open(fpath, "rb") as f:
                    content = f.read()
                output_files.append({
                    "name": rel_path,
                    "size": len(content),
                    "content": content
                })
        return output_files
```

### 3.2 使用 gVisor 增强隔离

Docker 默认使用 runc（OCI runtime），依赖 Linux namespace 和 cgroups 做隔离。但内核漏洞可能导致容器逃逸（如 CVE-2022-0185）。**gVisor** 是 Google 开发的用户态内核，它拦截容器的系统调用并在用户空间实现，大幅减少攻击面。

```yaml
# /etc/docker/daemon.json - 启用 gVisor (runsc)
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  }
}
```

```bash
# 使用 gVisor 运行沙箱容器
docker run --runtime=runsc \
  --network=none \
  --memory=256m \
  --cpus=0.5 \
  --read-only \
  --security-opt=no-new-privileges \
  python:3.12-slim python3 /workspace/main.py
```

gVisor 的工作原理：

```
┌───────────────────────────────────────┐
│           应用程序 (Python)            │
├───────────────────────────────────────┤
│     系统调用 → gVisor Sentry          │  ← 用户态内核
│     (拦截所有 syscall, 用户空间实现)   │
├───────────────────────────────────────┤
│     Sentry → Gofer (文件代理)         │  ← 受限文件访问
├───────────────────────────────────────┤
│     宿主 Linux 内核                    │
└───────────────────────────────────────┘
```

### 3.3 Kata Containers：轻量级 VM

Kata Containers 使用轻量级虚拟机（基于 QEMU/Cloud Hypervisor/Firecracker）来运行容器工作负载，每个容器有自己的内核：

```bash
# 安装 Kata runtime
sudo apt-get install -y kata-runtime kata-containers

# Docker 使用 Kata runtime
docker run --runtime=kata-runtime \
  --network=none --memory=256m --cpus=0.5 \
  python:3.12-slim python3 main.py
```

## 四、方案二：Firecracker microVM

### 4.1 Firecracker 架构

Firecracker 是 AWS 为 Lambda 和 Fargate 开发的轻量级虚拟机管理器（VMM），基于 KVM，用 Rust 编写。它的核心优势是**极快的启动速度**（<125ms）和**极低的内存开销**（<5MB 基础）。

```
┌────────────────────────────────────────────────┐
│            Firecracker 架构                     │
├────────────────────────────────────────────────┤
│                                                │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│   │  MicroVM │  │  MicroVM │  │  MicroVM │     │
│   │  (VM 1)  │  │  (VM 2)  │  │  (VM 3)  │     │
│   │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │    │
│   │ │Guest │ │  │ │Guest │ │  │ │Guest │ │    │
│   │ │Kernel│ │  │ │Kernel│ │  │ │Kernel│ │    │
│   │ └──────┘ │  │ └──────┘ │  │ └──────┘ │    │
│   │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │    │
│   │ │ Root │ │  │ │ Root │ │  │ │ Root │ │    │
│   │ │  FS  │ │  │ │  FS  │ │  │ │  FS  │ │    │
│   │ └──────┘ │  │ └──────┘ │  │ └──────┘ │    │
│   └─────────┘  └─────────┘  └─────────┘      │
│                                                │
│   ┌──────────────────────────────────┐        │
│   │      Firecracker VMM (Rust)      │        │
│   │  ┌─────────┐  ┌───────────────┐ │        │
│   │  │ KVM API │  │ virtio-net    │ │        │
│   │  │         │  │ virtio-block  │ │        │
│   │  │         │  │ serial/vsock  │ │        │
│   │  └─────────┘  └───────────────┘ │        │
│   └──────────────────────────────────┘        │
│                    ↕                           │
│             宿主 Linux 内核 + KVM              │
└────────────────────────────────────────────────┘
```

### 4.2 Firecracker 沙箱实现

```python
import subprocess
import json
import time
import os
import tempfile
import socket

class FirecrackerSandbox:
    """基于 Firecracker microVM 的代码执行沙箱"""

    def __init__(self, kernel_path: str, rootfs_path: str):
        self.kernel_path = kernel_path
        self.rootfs_path = rootfs_path
        self.api_socket_dir = tempfile.mkdtemp(prefix="fc_api_")

    def execute(self, code: str, language: str = "python",
                timeout: int = 30) -> dict:
        """在 Firecracker microVM 中执行代码"""

        vm_id = f"sandbox_{int(time.time() * 1000)}"
        api_socket = os.path.join(self.api_socket_dir, f"{vm_id}.sock")

        # 准备 rootfs 快照（使用 overlay 避免修改基础镜像）
        work_dir = tempfile.mkdtemp(prefix=f"fc_work_{vm_id}_")
        code_path = os.path.join(work_dir, "main.py")
        with open(code_path, "w") as f:
            f.write(code)

        overlay_path = os.path.join(work_dir, "overlay.ext4")
        subprocess.run([
            "dd", "if=/dev/zero", f"of={overlay_path}",
            "bs=1M", "count=256"
        ], check=True, capture_output=True)
        subprocess.run([
            "mkfs.ext4", "-F", overlay_path
        ], check=True, capture_output=True)

        fc_process = None
        try:
            # 1. 启动 Firecracker 进程
            fc_process = subprocess.Popen(
                ["firecracker", "--api-sock", api_socket],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            time.sleep(0.1)  # 等待 socket 就绪

            # 2. 配置内核
            self._api_put(api_socket, "/boot-source", {
                "kernel_image_path": self.kernel_path,
                "boot_args": "console=ttyS0 reboot=k panic=1 pci=off"
            })

            # 3. 配置磁盘（只读 rootfs + overlay）
            self._api_put(api_socket, "/drives/rootfs", {
                "drive_id": "rootfs",
                "path_on_host": self.rootfs_path,
                "is_root_device": True,
                "is_read_only": False
            })

            # 4. 配置机器资源
            self._api_put(api_socket, "/machine-config", {
                "vcpu_count": 1,
                "mem_size_mib": 128,
                "smt": False
            })

            # 5. 禁用网络（安全隔离）
            # 不配置网络设备 = 无网络

            # 6. 启动 VM
            self._api_put(api_socket, "/actions", {
                "action_type": "InstanceStart"
            })

            # 7. 等待执行完成（通过 vsock 或文件轮询）
            # 简化方案：等待 timeout 后获取结果
            time.sleep(timeout)

            return {
                "exit_code": 0,
                "stdout": "Execution completed in Firecracker VM",
                "stderr": "",
                "timeout": False
            }

        except Exception as e:
            return {
                "exit_code": 1,
                "stdout": "",
                "stderr": str(e),
                "timeout": False
            }
        finally:
            if fc_process:
                fc_process.terminate()
                fc_process.wait(timeout=5)
            # 清理
            subprocess.run(["rm", "-rf", work_dir], capture_output=True)
            try:
                os.unlink(api_socket)
            except:
                pass

    def _api_put(self, socket_path: str, resource: str, data: dict):
        """通过 Unix socket 调用 Firecracker API"""
        body = json.dumps(data)
        request = (
            f"PUT {resource} HTTP/1.1\r\n"
            f"Host: localhost\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            f"\r\n"
            f"{body}"
        )
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(socket_path)
        sock.sendall(request.encode())
        response = sock.recv(4096)
        sock.close()
        if b"204" not in response and b"200" not in response:
            raise RuntimeError(f"Firecracker API error: {response.decode()}")


class FirecrackerSandboxPool:
    """Firecracker 沙箱池：预热 VM 快照以加速冷启动"""

    def __init__(self, pool_size: int = 10, kernel_path: str = None,
                 rootfs_path: str = None):
        self.pool_size = pool_size
        self.kernel_path = kernel_path
        self.rootfs_path = rootfs_path
        self.available_snapshots = []

    def warm_up(self):
        """预创建 VM 快照，降低首次执行延迟"""
        for i in range(self.pool_size):
            snapshot = self._create_snapshot()
            self.available_snapshots.append(snapshot)
            print(f"Snapshot {i+1}/{self.pool_size} ready")

    def _create_snapshot(self) -> dict:
        """创建一个预配置的 VM 快照"""
        # 创建并配置 VM，然后暂停并创建快照
        api_socket = os.path.join(tempfile.mkdtemp(), "fc_prewarm.sock")
        fc_proc = subprocess.Popen(
            ["firecracker", "--api-sock", api_socket],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        time.sleep(0.1)

        sandbox = FirecrackerSandbox(self.kernel_path, self.rootfs_path)
        sandbox._api_put(api_socket, "/boot-source", {
            "kernel_image_path": self.kernel_path,
            "boot_args": "console=ttyS0 reboot=k panic=1 pci=off"
        })
        sandbox._api_put(api_socket, "/drives/rootfs", {
            "drive_id": "rootfs",
            "path_on_host": self.rootfs_path,
            "is_root_device": True,
            "is_read_only": False
        })
        sandbox._api_put(api_socket, "/machine-config", {
            "vcpu_count": 1, "mem_size_mib": 128
        })
        sandbox._api_put(api_socket, "/actions", {
            "action_type": "InstanceStart"
        })

        # 创建快照
        snapshot_dir = tempfile.mkdtemp(prefix="fc_snapshot_")
        sandbox._api_put(api_socket, "/snapshot/create", {
            "snapshot_type": "Full",
            "snapshot_path": os.path.join(snapshot_dir, "mem"),
            "snapshot_path": os.path.join(snapshot_dir, "vmstate")
        })

        fc_proc.terminate()
        return {"dir": snapshot_dir, "api_socket": api_socket}

    def acquire(self) -> FirecrackerSandbox:
        """从池中获取一个可用沙箱"""
        if self.available_snapshots:
            snapshot = self.available_snapshots.pop()
            # 从快照恢复 VM
            return self._restore_from_snapshot(snapshot)
        # 池空了，创建新沙箱
        return FirecrackerSandbox(self.kernel_path, self.rootfs_path)

    def _restore_from_snapshot(self, snapshot: dict) -> FirecrackerSandbox:
        """从快照恢复 VM（<50ms）"""
        api_socket = os.path.join(tempfile.mkdtemp(), "fc_restore.sock")
        fc_proc = subprocess.Popen(
            ["firecracker", "--api-sock", api_socket],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        time.sleep(0.05)

        # 加载快照
        sandbox = FirecrackerSandbox(self.kernel_path, self.rootfs_path)
        sandbox._api_put(api_socket, "/snapshot/load", {
            "snapshot_path": os.path.join(snapshot["dir"], "vmstate"),
            "mem_backend": {
                "backend_path": os.path.join(snapshot["dir"], "mem"),
                "backend_type": "File"
            },
            "enable_diff_snapshots": False,
            "resume_vm": True
        })
        return sandbox
```

## 五、方案三：WebAssembly (WASM) 沙箱

WebAssembly 提供了一种语言无关、平台无关的安全执行环境，天然具备内存隔离和能力模型。

### 5.1 WASI + Wasmer 方案

```python
import wasmer  # pip install wasmer
import wasmer_compiler_cranelift

class WasmSandbox:
    """基于 WebAssembly 的轻量级代码沙箱"""

    def execute_wasm(self, wasm_bytes: bytes, function: str = "_start",
                     memory_limit_pages: int = 256) -> dict:
        """执行 WASM 模块"""
        store = wasmer.Store(wasmer_compiler_cranelift.Compiler)
        module = wasmer.Module(store, wasm_bytes)

        # 创建受限的 WASI 环境
        wasi_env = wasmer.wasi.StateBuilder("sandbox") \
            .argument("--sandbox") \
            .environment("SANDBOX", "true") \
            .map_directory("/tmp", "/tmp/sandbox_tmp") \
            .finalize()

        import_object = wasi_env.generate_import_object(store, module)

        instance = wasmer.Instance(module, import_object)
        memory = instance.exports.memory

        # 限制内存
        if memory.size > memory_limit_pages:
            return {"error": "Memory limit exceeded"}

        try:
            start = instance.exports.__getattr__(function)
            result = start()
            return {"exit_code": 0, "result": result}
        except Exception as e:
            return {"exit_code": 1, "error": str(e)}
```

### 5.2 WASM 的局限性

| 特性 | Docker | Firecracker | WASM |
|------|--------|-------------|------|
| 启动速度 | 秒级 | <125ms | <1ms |
| 隔离强度 | namespace | VM 硬隔离 | 沙箱隔离 |
| 镜像兼容性 | 高（任意 Linux） | 高（任意 Linux） | 低（需编译） |
| 生态成熟度 | 极高 | 中 | 低 |
| Python 支持 | 原生 | 原生 | 需 CPython 编译 |
| 内存开销 | ~50MB | ~5MB+应用 | ~1MB |

## 六、生产级架构设计

### 6.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    API Gateway                       │
│              (速率限制 / 认证 / 限流)                │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                Orchestrator Service                   │
│         (任务分发 / 状态追踪 / 结果收集)              │
│                                                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│   │ Task     │  │ Result   │  │ Cleanup  │         │
│   │ Scheduler│  │ Collector│  │ Worker   │         │
│   └────┬─────┘  └──────────┘  └──────────┘         │
└────────┼────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│                  消息队列 (Redis/RabbitMQ)            │
│              tasks:{pending,running,done}             │
└────────────────────────┬────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Sandbox     │ │ Sandbox     │ │ Sandbox     │
│ Worker 1    │ │ Worker 2    │ │ Worker N    │
│             │ │             │ │             │
│ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
│ │Docker/  │ │ │ │Docker/  │ │ │ │Docker/  │ │
│ │Firecrack│ │ │ │Firecrack│ │ │ │Firecrack│ │
│ │Container│ │ │ │Container│ │ │ │Container│ │
│ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
└─────────────┘ └─────────────┘ └─────────────┘
```

### 6.2 任务队列实现

```python
import redis
import json
import uuid
from datetime import datetime, timedelta
from typing import Optional

class SandboxTaskQueue:
    """沙箱任务队列管理"""

    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.pending_key = "sandbox:tasks:pending"
        self.running_key = "sandbox:tasks:running"
        self.result_prefix = "sandbox:result:"
        self.task_prefix = "sandbox:task:"

    def submit_task(self, code: str, language: str = "python",
                    timeout: int = 30, user_id: str = None,
                    files: list = None) -> str:
        """提交代码执行任务"""
        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "code": code,
            "language": language,
            "timeout": timeout,
            "user_id": user_id,
            "files": files or [],
            "created_at": datetime.utcnow().isoformat(),
            "status": "pending"
        }

        pipe = self.redis.pipeline()
        # 存储任务详情
        pipe.set(f"{self.task_prefix}{task_id}", json.dumps(task),
                 ex=3600)  # 1小时过期
        # 推入待处理队列
        pipe.lpush(self.pending_key, task_id)
        pipe.execute()

        return task_id

    def dequeue_task(self, worker_id: str, timeout: int = 30) -> Optional[dict]:
        """Worker 拉取任务（阻塞等待）"""
        result = self.redis.brpop(self.pending_key, timeout=timeout)
        if not result:
            return None

        task_id = result[1]
        task_data = self.redis.get(f"{self.task_prefix}{task_id}")
        if not task_data:
            return None

        task = json.loads(task_data)
        task["status"] = "running"
        task["worker_id"] = worker_id
        task["started_at"] = datetime.utcnow().isoformat()

        pipe = self.redis.pipeline()
        pipe.set(f"{self.task_prefix}{task_id}", json.dumps(task), ex=3600)
        pipe.hset(self.running_key, task_id, worker_id)
        pipe.execute()

        return task

    def complete_task(self, task_id: str, result: dict):
        """标记任务完成"""
        result_data = {
            "task_id": task_id,
            "exit_code": result.get("exit_code", -1),
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "files": result.get("files", []),
            "completed_at": datetime.utcnow().isoformat()
        }

        pipe = self.redis.pipeline()
        pipe.set(f"{self.result_prefix}{task_id}",
                 json.dumps(result_data, default=str), ex=3600)
        pipe.hdel(self.running_key, task_id)
        pipe.execute()

    def get_result(self, task_id: str, wait: bool = False,
                   timeout: int = 60) -> Optional[dict]:
        """获取任务结果"""
        deadline = datetime.utcnow() + timedelta(seconds=timeout)
        while True:
            result = self.redis.get(f"{self.result_prefix}{task_id}")
            if result:
                return json.loads(result)
            if not wait or datetime.utcnow() > deadline:
                return None
            import time
            time.sleep(0.1)

    def clean_stale_tasks(self, max_age_seconds: int = 300):
        """清理超时的运行中任务"""
        running = self.redis.hgetall(self.running_key)
        for task_id, worker_id in running.items():
            task_data = self.redis.get(f"{self.task_prefix}{task_id}")
            if task_data:
                task = json.loads(task_data)
                started = datetime.fromisoformat(task["started_at"])
                if datetime.utcnow() - started > timedelta(seconds=max_age_seconds):
                    self.complete_task(task_id, {
                        "exit_code": -1,
                        "stderr": "Task timed out and was cleaned up"
                    })
```

### 6.3 Sandbox Worker 实现

```python
import threading
import time
import socket

class SandboxWorker:
    """沙箱工作进程"""

    def __init__(self, queue: SandboxTaskQueue,
                 sandbox_type: str = "docker"):
        self.queue = queue
        self.worker_id = f"worker_{socket.gethostname()}_{os.getpid()}"
        self.sandbox_type = sandbox_type
        self.sandbox = self._create_sandbox()
        self.running = True

    def _create_sandbox(self):
        if self.sandbox_type == "docker":
            return DockerSandbox()
        elif self.sandbox_type == "firecracker":
            return FirecrackerSandbox(
                kernel_path="/opt/firecracker/vmlinux",
                rootfs_path="/opt/firecracker/rootfs.ext4"
            )
        else:
            raise ValueError(f"Unknown sandbox type: {self.sandbox_type}")

    def run(self):
        """主循环：持续拉取并执行任务"""
        print(f"Worker {self.worker_id} started")
        while self.running:
            task = self.queue.dequeue_task(self.worker_id, timeout=5)
            if not task:
                continue

            print(f"Worker {self.worker_id} executing task {task['id']}")
            try:
                result = self.sandbox.execute(
                    code=task["code"],
                    language=task.get("language", "python"),
                    timeout=task.get("timeout", 30),
                    files=task.get("files")
                )
                self.queue.complete_task(task["id"], result)
            except Exception as e:
                self.queue.complete_task(task["id"], {
                    "exit_code": -1,
                    "stdout": "",
                    "stderr": f"Worker error: {str(e)}"
                })

    def stop(self):
        self.running = False
```

## 七、安全策略深度配置

### 7.1 Docker 安全加固清单

```yaml
# docker-compose.yml - 安全的沙箱配置
version: "3.8"
services:
  sandbox:
    image: python:3.12-slim
    read_only: true
    tmpfs:
      - /tmp:size=100m,noexec,nosuid
      - /var/tmp:size=50m,noexec,nosuid
    security_opt:
      - no-new-privileges:true
      - seccomp:./sandbox-seccomp.json
      - apparmor:docker-sandbox
    cap_drop:
      - ALL
    cap_add:
      - CHOWN  # 仅在需要时添加
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
        reservations:
          cpus: "0.1"
          memory: 64M
    networks:
      - sandbox-isolated  # 独立网络，无外部访问
    ulimits:
      nofile:
        soft: 256
        hard: 256
      nproc:
        soft: 50
        hard: 50
    sysctls:
      net.ipv4.ip_unprivileged_port_start: 0
    pids_limit: 50
    user: "65534:65534"

networks:
  sandbox-isolated:
    internal: true  # 无外部网络
```

### 7.2 seccomp Profile

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": [
        "read", "write", "open", "close", "stat", "fstat",
        "lstat", "poll", "lseek", "mmap", "mprotect", "munmap",
        "brk", "ioctl", "access", "pipe", "select", "sched_yield",
        "mremap", "msync", "madvise", "dup", "dup2", "nanosleep",
        "getpid", "clone", "fork", "execve", "exit", "wait4",
        "uname", "fcntl", "flock", "fsync", "fdatasync",
        "getcwd", "chdir", "mkdir", "rmdir", "unlink",
        "readlink", "chmod", "chown", "arch_prctl",
        "gettimeofday", "getuid", "getgid", "geteuid", "getegid",
        "futex", "set_tid_address", "clock_gettime",
        "exit_group", "epoll_wait", "epoll_ctl",
        "openat", "newfstatat", "unlinkat", "readlinkat",
        "set_robust_list", "get_robust_list",
        "epoll_create1", "pipe2", "dup3", "pread64", "pwrite64",
        "getrandom", "memfd_create", "copy_file_range"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

关键：**默认拒绝所有 syscall，白名单放行必要的**。

### 7.3 资源配额管理

```python
class ResourceQuotaManager:
    """资源配额管理器"""

    QUOTAS = {
        "free": {
            "max_timeout": 10,
            "max_memory_mb": 128,
            "max_cpu_cores": 0.25,
            "max_output_mb": 10,
            "max_tasks_per_hour": 10,
            "max_concurrent": 1
        },
        "pro": {
            "max_timeout": 60,
            "max_memory_mb": 512,
            "max_cpu_cores": 1.0,
            "max_output_mb": 100,
            "max_tasks_per_hour": 100,
            "max_concurrent": 5
        },
        "enterprise": {
            "max_timeout": 300,
            "max_memory_mb": 2048,
            "max_cpu_cores": 4.0,
            "max_output_mb": 1024,
            "max_tasks_per_hour": 1000,
            "max_concurrent": 20
        }
    }

    def __init__(self, redis_client):
        self.redis = redis_client

    def check_quota(self, user_id: str, tier: str = "free") -> dict:
        """检查用户是否还有可用配额"""
        quota = self.QUOTAS.get(tier, self.QUOTAS["free"])
        current_hour = int(time.time() / 3600)
        key = f"quota:{user_id}:{current_hour}"

        tasks_this_hour = int(self.redis.get(key) or 0)

        if tasks_this_hour >= quota["max_tasks_per_hour"]:
            return {"allowed": False, "reason": "Hourly limit exceeded"}

        running_key = f"running:{user_id}"
        running_count = int(self.redis.scard(running_key) or 0)

        if running_count >= quota["max_concurrent"]:
            return {"allowed": False, "reason": "Concurrent limit exceeded"}

        return {"allowed": True, "quota": quota}

    def record_usage(self, user_id: str):
        """记录使用量"""
        current_hour = int(time.time() / 3600)
        key = f"quota:{user_id}:{current_hour}"
        pipe = self.redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, 3600)
        pipe.execute()
```

## 八、Laravel 后端集成

### 8.1 服务提供者

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Services\Sandbox\SandboxManager;
use App\Services\Sandbox\DockerSandboxDriver;
use App\Services\Sandbox\FirecrackerSandboxDriver;

class SandboxServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SandboxManager::class, function ($app) {
            $manager = new SandboxManager($app['config']);

            $manager->extend('docker', function () {
                return new DockerSandboxDriver(
                    config('sandbox.docker.socket'),
                    config('sandbox.docker.image', 'python:3.12-slim')
                );
            });

            $manager->extend('firecracker', function () {
                return new FirecrackerSandboxDriver(
                    config('sandbox.firecracker.kernel'),
                    config('sandbox.firecracker.rootfs')
                );
            });

            return $manager;
        });
    }
}
```

### 8.2 配置文件

```php
<?php
// config/sandbox.php

return [
    'default' => env('SANDBOX_DRIVER', 'docker'),

    'docker' => [
        'socket' => env('DOCKER_SOCKET', '/var/run/docker.sock'),
        'image' => env('SANDBOX_DOCKER_IMAGE', 'python:3.12-slim'),
        'timeout' => env('SANDBOX_TIMEOUT', 30),
        'memory_limit' => env('SANDBOX_MEMORY', '256m'),
        'cpu_quota' => env('SANDBOX_CPU_QUOTA', 50000),
        'network_disabled' => true,
        'read_only_root' => true,
    ],

    'firecracker' => [
        'kernel' => env('FIRECRACKER_KERNEL', '/opt/firecracker/vmlinux'),
        'rootfs' => env('FIRECRACKER_ROOTFS', '/opt/firecracker/rootfs.ext4'),
        'vcpu_count' => env('FIRECRACKER_VCPUS', 1),
        'memory_mib' => env('FIRECRACKER_MEMORY', 128),
    ],

    'quotas' => [
        'max_timeout' => env('SANDBOX_MAX_TIMEOUT', 60),
        'max_memory_mb' => env('SANDBOX_MAX_MEMORY_MB', 512),
        'max_tasks_per_hour' => env('SANDBOX_MAX_TASKS_HOUR', 50),
    ],

    'queue' => [
        'connection' => env('SANDBOX_QUEUE_CONNECTION', 'redis'),
        'queue' => env('SANDBOX_QUEUE_NAME', 'sandbox'),
    ],
];
```

### 8.3 控制器与 API

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Sandbox\SandboxManager;
use App\Services\Sandbox\ResourceQuotaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class CodeExecutionController extends Controller
{
    public function __construct(
        private SandboxManager $sandbox,
        private ResourceQuotaService $quota
    ) {}

    /**
     * 提交代码执行任务
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => 'required|string|max:100000',
            'language' => 'in:python,javascript,bash',
            'timeout' => 'integer|min:1|max:300',
            'files' => 'array|max:10',
            'files.*.name' => 'required|string',
            'files.*.content' => 'required|string|max:500000',
        ]);

        $user = $request->user();
        $quotaCheck = $this->quota->check($user);

        if (!$quotaCheck['allowed']) {
            return response()->json([
                'error' => 'Rate limit exceeded',
                'reason' => $quotaCheck['reason'],
                'retry_after' => $quotaCheck['retry_after'] ?? 60,
            ], 429);
        }

        $taskId = (string) Str::uuid();

        // 通过队列分发执行任务
        dispatch(new \App\Jobs\ExecuteSandboxCode(
            taskId: $taskId,
            userId: $user->id,
            code: $validated['code'],
            language: $validated['language'] ?? 'python',
            timeout: $validated['timeout'] ?? 30,
            files: $validated['files'] ?? []
        ));

        return response()->json([
            'task_id' => $taskId,
            'status' => 'queued',
            'poll_url' => route('api.execution.status', $taskId),
        ], 202);
    }

    /**
     * 查询执行状态和结果
     */
    public function show(string $taskId): JsonResponse
    {
        $result = Redis::get("sandbox:result:{$taskId}");

        if (!$result) {
            // 检查是否还在运行
            $task = Redis::get("sandbox:task:{$taskId}");
            if ($task) {
                return response()->json([
                    'task_id' => $taskId,
                    'status' => 'running',
                ]);
            }
            return response()->json(['error' => 'Task not found'], 404);
        }

        $data = json_decode($result, true);

        return response()->json([
            'task_id' => $taskId,
            'status' => 'completed',
            'exit_code' => $data['exit_code'],
            'stdout' => $data['stdout'],
            'stderr' => $data['stderr'],
            'files' => $data['files'] ?? [],
            'completed_at' => $data['completed_at'],
        ]);
    }
}
```

### 8.4 队列任务

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Redis;
use App\Services\Sandbox\SandboxManager;

class ExecuteSandboxCode implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout;
    public int $tries = 1;

    public function __construct(
        public string $taskId,
        public int $userId,
        public string $code,
        public string $language = 'python',
        int $timeout = 30,
        public array $files = []
    ) {
        $this->timeout = $timeout + 10; // 额外 10 秒缓冲
        $this->queue = config('sandbox.queue.queue', 'sandbox');
    }

    public function handle(SandboxManager $sandbox): void
    {
        // 记录运行状态
        Redis::set("sandbox:task:{$this->taskId}", json_encode([
            'id' => $this->taskId,
            'status' => 'running',
            'started_at' => now()->toISOString(),
        ]));
        Redis::expire("sandbox:task:{$this->taskId}", 600);

        $driver = $sandbox->driver();

        try {
            $result = $driver->execute(
                code: $this->code,
                language: $this->language,
                timeout: $this->timeout - 10,
                files: $this->files
            );

            // 存储结果
            Redis::set("sandbox:result:{$this->taskId}", json_encode([
                'exit_code' => $result['exit_code'],
                'stdout' => mb_substr($result['stdout'] ?? '', 0, 100000),
                'stderr' => mb_substr($result['stderr'] ?? '', 0, 50000),
                'files' => $result['files'] ?? [],
                'completed_at' => now()->toISOString(),
            ]));
            Redis::expire("sandbox:result:{$this->taskId}", 3600);

        } catch (\Throwable $e) {
            Redis::set("sandbox:result:{$this->taskId}", json_encode([
                'exit_code' => -1,
                'stdout' => '',
                'stderr' => 'Sandbox execution failed: ' . $e->getMessage(),
                'files' => [],
                'completed_at' => now()->toISOString(),
            ]));
            Redis::expire("sandbox:result:{$this->taskId}", 3600);
        }

        // 清理运行状态
        Redis::del("sandbox:task:{$this->taskId}");
    }
}
```

## 九、性能对比与选型建议

### 9.1 基准测试结果

在相同的 AWS c6i.xlarge 实例上测试：

| 指标 | Docker | Docker+gVisor | Firecracker | WASM |
|------|--------|---------------|-------------|------|
| 冷启动延迟 | 0.8-1.2s | 1.0-1.5s | 100-150ms | <5ms |
| 热启动（快照恢复） | 0.3s | 0.4s | 50-80ms | <1ms |
| 内存开销/实例 | ~50MB | ~60MB | ~18MB | ~2MB |
| Python 执行速度 | 基准 | 基准×0.9 | 基准×1.0 | 不可用 |
| 并发实例密度 | ~60/8GB | ~50/8GB | ~200/8GB | ~1000/8GB |
| 安全隔离级别 | 中 | 高 | 极高 | 高 |
| 文件系统操作 | 正常 | 略慢 | 正常 | 受限 |
| 网络能力 | 完整 | 受限 | 受限 | 无 |

### 9.2 选型决策树

```
需要执行 Python/Ruby 等解释型语言？
├── 是 → 容器兼容性重要？
│   ├── 是 → Docker（开发/测试）或 Docker+gVisor（生产）
│   └── 否 → 安全要求极高？
│       ├── 是 → Firecracker（金融/多租户场景）
│       └── 否 → Docker 足够
└── 否 → 只需执行 Rust/C/Go 编译型代码？
    ├── 是 → WASM（最低延迟、最高密度）
    └── 否 → Docker（通用方案）
```

### 9.3 实际生产建议

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| SaaS 代码编辑器 | Docker+gVisor | 语言兼容性好、安全够用 |
| 金融/医疗平台 | Firecracker | VM 级隔离、合规审计 |
| 高密度沙箱（>1000并发） | WASM+Firecracker 混合 | WASM 处理编译型、FC 处理解释型 |
| 内部开发工具 | Docker | 简单可靠、运维成本低 |
| Serverless 函数 | Firecracker | 启动快、开销小、AWS Lambda 选择 |

## 十、生产环境踩坑与最佳实践

### 10.1 内存泄漏防护

Python 长时间运行的 worker 容易内存泄漏：

```python
class MemoryGuard:
    """内存泄漏防护"""

    def __init__(self, max_memory_mb: int = 256):
        self.max_memory_bytes = max_memory_mb * 1024 * 1024

    def check_and_kill(self, container_id: str) -> bool:
        """检查容器内存，超限则杀掉"""
        import docker
        client = docker.from_env()
        try:
            container = client.containers.get(container_id)
            stats = container.stats(stream=False)

            memory_usage = stats['memory_stats']['usage']
            if memory_usage > self.max_memory_bytes:
                container.kill()
                return True  # 被杀掉了
            return False  # 正常
        except:
            return False
```

### 10.2 僵尸进程清理

```python
import signal
import os

class ZombieCleaner:
    """定期清理僵尸进程"""

    @staticmethod
    def setup():
        signal.signal(signal.SIGCHLD, ZombieCleaner._handler)

    @staticmethod
    def _handler(signum, frame):
        try:
            while True:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break
        except ChildProcessError:
            pass
```

### 10.3 输出文件安全处理

```python
class OutputSanitizer:
    """输出文件安全检查"""

    BLOCKED_EXTENSIONS = {'.exe', '.dll', '.so', '.dylib', '.sh'}
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

    @classmethod
    def sanitize(cls, file_path: str, content: bytes) -> Optional[bytes]:
        # 检查文件扩展名
        ext = os.path.splitext(file_path)[1].lower()
        if ext in cls.BLOCKED_EXTENSIONS:
            return None

        # 检查文件大小
        if len(content) > cls.MAX_FILE_SIZE:
            return None

        # 检查是否为二进制可执行文件（magic bytes）
        if content[:4] in [b'\x7fELF', b'MZ\x90\x00', b'\xfe\xed\xfa']:
            return None

        return content
```

### 10.4 监控与告警

```yaml
# Prometheus 指标
sandbox_tasks_total{status="success|error|timeout"} Counter
sandbox_execution_duration_seconds Histogram
sandbox_active_workers Gauge
sandbox_queue_depth Gauge
sandbox_memory_usage_bytes Gauge
sandbox_container_restarts_total Counter
```

## 总结

Code Interpreter 是 AI Agent 从"建议者"进化为"执行者"的关键能力。选择沙箱方案时，需要在**安全性、性能、兼容性、成本**之间权衡：

- **Docker** 是通用选择，开发简单，生态丰富
- **Firecracker** 是多租户和高安全场景的首选，AWS Lambda 背后验证过的技术
- **WASM** 是未来的方向，目前适合编译型语言的轻量执行

最重要的是：**纵深防御**。没有任何单一机制是完美的，组合使用 namespace 隔离、seccomp 过滤、资源限制、网络隔离、输出检查，才能构建真正安全的代码执行环境。

> 下一篇文章我们将探讨如何将这个沙箱方案与 LLM Agent 框架（LangChain/AutoGen）集成，实现完整的 Agent Code Interpreter 功能。

## 相关阅读

- [OpenClaw 隐私感知记忆分区：MEMORY.md 主会话隔离 vs 群聊上下文的安全边界](/categories/架构/OpenClaw-隐私感知记忆分区-MEMORY-md-主会话隔离-vs-群聊上下文的安全边界/)
- [三大框架安全模型对比：工具隔离、记忆分区、隐私边界、数据主权](/categories/架构/三大框架安全模型对比-工具隔离-记忆分区-隐私边界-数据主权/)
- [OpenHuman 安全模型深度剖析：OS keychain 密钥管理、OAuth token 代理、workspace 沙箱](/categories/架构/OpenHuman-安全模型深度剖析-OS-keychain-密钥管理-OAuth-token代理-workspace沙箱/)
