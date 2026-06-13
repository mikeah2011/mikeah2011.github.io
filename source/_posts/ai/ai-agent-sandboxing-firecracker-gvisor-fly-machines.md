---
title: AI Agent Sandboxing 实战：Firecracker/gVisor/Fly.io Machines——Agent 代码执行的微虚拟机隔离与资源配额治理
keywords: [AI Agent Sandboxing, Firecracker, gVisor, Fly.io Machines, Agent, 代码执行的微虚拟机隔离与资源配额治理, AI]
date: 2026-06-09 17:34:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - Agent
  - 沙箱
  - Firecracker
  - gVisor
  - Fly.io
  - 安全隔离
  - 资源配额
description: Agent 能跑代码是能力，能被控制才是工程。本文从 Firecracker microVM、gVisor 用户态内核、Fly.io Machines 三种路线出发，实战演示如何在 Laravel 项目中为 AI Agent 构建安全的代码执行沙箱，并实现 CPU/内存/磁盘/网络的资源配额治理。
---


## 为什么 Agent 沙箱不是可选项

AI Agent 能执行代码，意味着它能 `rm -rf /`。

2026 年，几乎所有主流 Agent 框架（OpenAI Assistants、Anthropic Claude、Google Gemini）都提供了 Code Interpreter 能力——给 Agent 一个 Python/JS 运行时，让它自己写代码、跑代码、看结果。这是 Agent 从"聊天机器人"进化到"自动化执行者"的关键一步。

但这也意味着：**你的服务器在运行一个不受信任的程序**。

一次意外的无限循环、一次恶意的文件系统遍历、一次不经意的网络外连——都可能造成不可逆的损失。沙箱不是"锦上添花"，它是 Agent 生产化的**硬性前提**。

本文从三种主流技术路线出发，实战演示如何在 Laravel 项目中构建 Agent 代码执行沙箱。

## 三种隔离方案的技术原理

### Firecracker：microVM 极简内核

Firecracker 是 AWS 开源的轻量级虚拟机监控器（VMM），Fargate 和 Lambda 底层都在用它。它的核心理念是：**只保留运行容器工作负载所需的最小内核功能**。

```text
┌─────────────────────────────┐
│        Agent 代码            │
├─────────────────────────────┤
│      Guest Kernel           │
├─────────────────────────────┤
│    Firecracker VMM          │
├─────────────────────────────┤
│     Host Kernel (KVM)       │
└─────────────────────────────┘
```

**关键特性：**
- 启动时间 < 125ms（比传统 VM 快 10x）
- 内存开销 < 5MB（每个 microVM）
- 完整的 Linux 内核隔离（不是容器那种共享内核）
- 支持快照和恢复（Checkpoint/Restore）

**适用场景：** 需要最强隔离级别，Agent 执行不可信代码（如用户提交的代码片段）。

### gVisor：用户态内核拦截

gVisor 是 Google 开源的应用内核，在用户态实现了一个 POSIX 兼容的内核子集。所有系统调用都经过 gVisor 拦截，不会直接到达宿主机内核。

```text
┌─────────────────────────────┐
│        Agent 代码            │
├─────────────────────────────┤
│   gVisor (Sentry + Gofer)   │
├─────────────────────────────┤
│     Host Kernel             │
└─────────────────────────────┘
```

**关键特性：**
- 无需 KVM 支持（可在容器内运行，兼容性更好）
- 系统调用拦截（约 70% 的 Linux syscall 已实现）
- 文件系统通过 Gofer 进程代理，天然的路径隔离
- 启动时间 ~100ms

**适用场景：** 不想管理 VM 基础设施，但需要比容器更强的隔离。容器平台（K8s）上部署友好。

### Fly.io Machines：托管 microVM

Fly.io Machines 是 Firecracker 的托管版本。你不需要自己搭 KVM 环境，直接通过 API 创建和销毁 microVM。

**关键特性：**
- 全托管，按秒计费
- 冷启动 ~300ms（含网络延迟）
- 内置卷存储（persistent volumes）
- 支持 GPU（可选）
- 通过 `fly machine run` 或 API 操作

**适用场景：** 不想自建基础设施，需要快速原型验证，或中小规模 Agent 服务。

## 实战：Laravel 项目集成 Agent 沙箱

### 项目结构

```text
app/
├── Services/
│   ├── Sandbox/
│   │   ├── SandboxInterface.php
│   │   ├── FirecrackerSandbox.php
│   │   ├── GVisorSandbox.php
│   │   ├── FlyMachinesSandbox.php
│   │   └── SandboxManager.php
│   └── Agent/
│       └── CodeExecutionService.php
├── Models/
│   └── SandboxExecution.php
└── config/
    └── sandbox.php
```

### 沙箱接口定义

```php
<?php

namespace App\Services\Sandbox;

interface SandboxInterface
{
    /**
     * 创建沙箱实例
     */
    public function create(array $options = []): SandboxInstance;

    /**
     * 在沙箱中执行代码
     */
    public function execute(SandboxInstance $instance, string $code, string $language = 'python'): ExecutionResult;

    /**
     * 销毁沙箱实例
     */
    public function destroy(SandboxInstance $instance): void;

    /**
     * 获取沙箱资源使用情况
     */
    public function stats(SandboxInstance $instance): array;
}
```

### SandboxManager：统一调度

```php
<?php

namespace App\Services\Sandbox;

class SandboxManager
{
    private array $drivers;

    public function __construct(array $config)
    {
        $this->drivers = [
            'firecracker' => app(FirecrackerSandbox::class),
            'gvisor'      => app(GVisorSandbox::class),
            'fly'         => app(FlyMachinesSandbox::class),
        ];
    }

    /**
     * 根据策略选择沙箱驱动
     */
    public function driver(?string $name = null): SandboxInterface
    {
        $name = $name ?? config('sandbox.default_driver', 'fly');
        
        if (!isset($this->drivers[$name])) {
            throw new \InvalidArgumentException("Unknown sandbox driver: {$name}");
        }

        return $this->drivers[$name];
    }

    /**
     * 根据安全等级自动选择
     */
    public function forSecurityLevel(string $level): SandboxInterface
    {
        return match ($level) {
            'maximum' => $this->drivers['firecracker'],
            'high'    => $this->drivers['gvisor'],
            default   => $this->drivers['fly'],
        };
    }
}
```

### Fly Machines 实现

```php
<?php

namespace App\Services\Sandbox;

use GuzzleHttp\Client;
use Illuminate\Support\Str;

class FlyMachinesSandbox implements SandboxInterface
{
    private Client $http;
    private string $apiKey;
    private string $orgSlug;

    public function __construct()
    {
        $this->http = new Client([
            'base_uri' => 'https://api.machines.dev/v1',
            'headers' => [
                'Authorization' => 'Bearer ' . config('sandbox.fly.api_key'),
                'Content-Type'  => 'application/json',
            ],
        ]);
        $this->orgSlug = config('sandbox.fly.org_slug');
    }

    public function create(array $options = []): SandboxInstance
    {
        $config = array_merge([
            'image'  => 'python:3.12-slim',
            'cpus'   => 1,
            'memory' => 256, // MB
            'env'    => [
                'PYTHONDONTWRITEBYTECODE' => '1',
            ],
        ], $options);

        $response = $this->http->post("/apps/{$this->orgSlug}/machines", [
            'json' => [
                'config' => [
                    'image'    => $config['image'],
                    'auto_stop_machine'  => true,
                    'auto_restart_machine' => false,
                    'restart' => ['policy' => 'never'],
                    'guest' => [
                        'cpu_kind'  => 'shared',
                        'cpus'      => $config['cpus'],
                        'memory_mb' => $config['memory'],
                    ],
                    'env' => $config['env'],
                    // 网络隔离：禁用出站连接
                    'disable_machine_creation' => false,
                ],
            ],
        ]);

        $machine = json_decode($response->getBody(), true);

        return new SandboxInstance(
            id: $machine['id'],
            driver: 'fly',
            config: $config,
            metadata: $machine,
        );
    }

    public function execute(SandboxInstance $instance, string $code, string $language = 'python'): ExecutionResult
    {
        $startTime = microtime(true);

        // 通过 SSH 连接到 Machine 执行代码
        $encodedCode = base64_encode($code);
        
        $command = match ($language) {
            'python' => "echo '{$encodedCode}' | base64 -d | python3 -c 'import sys; exec(sys.stdin.read())'",
            'javascript' => "echo '{$encodedCode}' | base64 -d | node -e 'const fs=require(\"fs\");eval(fs.readFileSync(\"/dev/stdin\",\"utf8\"))'",
            'php' => "echo '{$encodedCode}' | base64 -d | php",
            default => throw new \InvalidArgumentException("Unsupported language: {$language}"),
        };

        // 使用 Fly.io SSH 执行
        $result = $this->sshExec($instance->id, $command);

        $duration = microtime(true) - $startTime;

        // 检查资源限制
        $stats = $this->stats($instance);

        return new ExecutionResult(
            output: $result['stdout'],
            error: $result['stderr'],
            exitCode: $result['exitCode'],
            duration: $duration,
            memoryUsed: $stats['memory_used'] ?? null,
            cpuTime: $stats['cpu_time'] ?? null,
        );
    }

    public function destroy(SandboxInstance $instance): void
    {
        $this->http->delete("/apps/{$this->orgSlug}/machines/{$instance->id}", [
            'query' => ['force' => true],
        ]);
    }

    public function stats(SandboxInstance $instance): array
    {
        $response = $this->http->get("/apps/{$this->orgSlug}/machines/{$instance->id}/stats");
        return json_decode($response->getBody(), true);
    }

    private function sshExec(string $machineId, string $command): array
    {
        // 简化实现：实际项目中使用 flyctl ssh console 或直接 SSH
        $process = proc_open(
            "fly machine ssh {$machineId} --org {$this->orgSlug} --command \"{$command}\"",
            [
                0 => ['pipe', 'r'],
                1 => ['pipe', 'w'],
                2 => ['pipe', 'w'],
            ],
            $pipes
        );

        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[0]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        $exitCode = proc_close($process);

        return [
            'stdout'   => $stdout,
            'stderr'   => $stderr,
            'exitCode' => $exitCode,
        ];
    }
}
```

### gVisor 实现（Docker + runsc）

```php
<?php

namespace App\Services\Sandbox;

class GVisorSandbox implements SandboxInterface
{
    public function create(array $options = []): SandboxInstance
    {
        $config = array_merge([
            'image'  => 'python:3.12-slim',
            'cpus'   => 1.0,
            'memory' => '256m',
            'network' => false, // 默认禁止网络
        ], $options);

        $containerName = 'agent-sandbox-' . Str::random(12);

        // 使用 gVisor runtime 创建容器
        $command = sprintf(
            'docker create --runtime=runsc --name %s --cpus=%s --memory=%s --network=none --read-only --tmpfs /tmp:size=100m %s',
            escapeshellarg($containerName),
            $config['cpus'],
            $config['memory'],
            escapeshellarg($config['image'])
        );

        exec($command, $output, $exitCode);

        if ($exitCode !== 0) {
            throw new \RuntimeException("Failed to create gVisor container: " . implode("\n", $output));
        }

        return new SandboxInstance(
            id: $containerName,
            driver: 'gvisor',
            config: $config,
        );
    }

    public function execute(SandboxInstance $instance, string $code, string $language = 'python'): ExecutionResult
    {
        $startTime = microtime(true);

        $encodedCode = base64_encode($code);
        $script = match ($language) {
            'python'     => "echo '{$encodedCode}' | base64 -d > /tmp/script.py && python3 /tmp/script.py",
            'javascript' => "echo '{$encodedCode}' | base64 -d > /tmp/script.js && node /tmp/script.js",
            'php'        => "echo '{$encodedCode}' | base64 -d > /tmp/script.php && php /tmp/script.php",
            default      => throw new \InvalidArgumentException("Unsupported: {$language}"),
        };

        // docker exec 在 gVisor 运行时中执行
        $process = proc_open(
            sprintf('docker exec %s sh -c %s', escapeshellarg($instance->id), escapeshellarg($script)),
            [
                0 => ['pipe', 'r'],
                1 => ['pipe', 'w'],
                2 => ['pipe', 'w'],
            ],
            $pipes
        );

        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[0]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        $exitCode = proc_close($process);
        $duration = microtime(true) - $startTime;

        return new ExecutionResult(
            output: $stdout,
            error: $stderr,
            exitCode: $exitCode,
            duration: $duration,
        );
    }

    public function destroy(SandboxInstance $instance): void
    {
        exec("docker rm -f " . escapeshellarg($instance->id));
    }

    public function stats(SandboxInstance $instance): array
    {
        $output = [];
        exec("docker stats " . escapeshellarg($instance->id) . " --no-stream --format '{{.MemUsage}}|{{.CPUPerc}}'", $output);
        
        $parts = explode('|', $output[0] ?? '0B|0%');
        
        return [
            'memory_used' => trim($parts[0]),
            'cpu_percent' => trim($parts[1]),
        ];
    }
}
```

### 配置文件

```php
<?php
// config/sandbox.php

return [
    'default_driver' => env('SANDBOX_DRIVER', 'fly'),

    'limits' => [
        'max_execution_time' => 30,   // 秒
        'max_memory_mb'      => 512,
        'max_output_bytes'   => 1024 * 1024, // 1MB
        'max_file_size_mb'   => 100,
    ],

    'fly' => [
        'api_key'  => env('FLY_API_KEY'),
        'org_slug' => env('FLY_ORG_SLUG', 'your-org'),
        'base_image' => 'python:3.12-slim',
    ],

    'gvisor' => [
        'docker_runtime' => 'runsc',
        'base_image'     => 'python:3.12-slim',
    ],

    'firecracker' => [
        'api_endpoint' => env('FIRECRACKER_API', 'http://localhost:9090'),
        'kernel_path'  => env('FIRECRACKER_KERNEL', '/opt/firecracker/vmlinux'),
        'rootfs_path'  => env('FIRECRACKER_ROOTFS', '/opt/firecracker/rootfs.ext4'),
    ],

    'allowed_languages' => ['python', 'javascript', 'php'],
];
```

## 资源配额治理

沙箱创建只是第一步，**资源配额治理**才是生产化的关键。

### 执行层限制

```php
<?php

namespace App\Services\Sandbox;

class ResourceQuotaManager
{
    /**
     * 执行前检查：用户是否有足够配额
     */
    public function checkQuota(int $userId, string $language): bool
    {
        $limits = config('sandbox.quotas');
        
        // 检查每日执行次数
        $todayExecutions = SandboxExecution::where('user_id', $userId)
            ->whereDate('created_at', today())
            ->count();

        if ($todayExecutions >= $limits['daily_executions']) {
            throw new QuotaExceededException("Daily execution limit reached: {$limits['daily_executions']}");
        }

        // 检查并发执行数
        $concurrentExecutions = SandboxExecution::where('user_id', $userId)
            ->where('status', 'running')
            ->count();

        if ($concurrentExecutions >= $limits['concurrent_executions']) {
            throw new QuotaExceededException("Concurrent execution limit reached: {$limits['concurrent_executions']}");
        }

        // 检查语言白名单
        if (!in_array($language, config('sandbox.allowed_languages'))) {
            throw new \InvalidArgumentException("Language not allowed: {$language}");
        }

        return true;
    }

    /**
     * 资源使用报告
     */
    public function usageReport(int $userId, string $period = 'daily'): array
    {
        $query = SandboxExecution::where('user_id', $userId);

        $query = match ($period) {
            'daily'  => $query->whereDate('created_at', today()),
            'weekly' => $query->where('created_at', '>=', now()->subWeek()),
            default  => $query->whereMonth('created_at', now()->month),
        };

        return [
            'total_executions' => $query->count(),
            'total_duration'   => $query->sum('duration_seconds'),
            'total_memory'     => $query->sum('memory_used_mb'),
            'by_language'      => $query->selectRaw('language, count(*) as count')
                ->groupBy('language')
                ->pluck('count', 'language'),
        ];
    }
}
```

### 执行记录模型

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SandboxExecution extends Model
{
    protected $fillable = [
        'user_id',
        'agent_id',
        'sandbox_id',
        'driver',
        'language',
        'code',
        'output',
        'error',
        'exit_code',
        'duration_seconds',
        'memory_used_mb',
        'status',
    ];

    protected $casts = [
        'code'   => 'encrypted',
        'output' => 'encrypted',
    ];

    public function scopeRunning($query)
    {
        return $query->where('status', 'running');
    }

    public function scopeForUser($query, int $userId)
    {
        return $query->where('user_id', $userId);
    }
}
```

## 踩坑记录

### 坑 1：gVisor 系统调用兼容性

gVisor 并未实现所有 Linux 系统调用。常见问题：

```text
# 错误信息
FATAL: unimplemented syscall: perf_event_open

# 原因：某些 Python 库（如 cProfile）会调用 perf_event_open
# 解决：在 Agent 提示词中禁止使用 profiling 工具，或切换到 Firecracker
```

**教训：** 测试阶段用 `strace` 跑一遍你的 Agent 代码常用库，确认没有 gVisor 不支持的 syscall。

### 坑 2：Firecracker 快照恢复后的随机数问题

```php
// Firecracker 快照恢复后，/dev/urandom 的状态可能不一致
// 导致生成的随机数可预测

// 解决方案：恢复后重新注入熵
$process = proc_open(
    'echo "entropy reseed" > /dev/urandom',
    // ... 
);
```

### 坑 3：Fly.io Machines 冷启动延迟

Fly Machines 冷启动 ~300ms，但在高峰期可能达到 2-3 秒。对于需要即时响应的 Agent 场景，需要预热池：

```php
<?php

class MachinePool
{
    private array $warmPool = [];
    private int $poolSize = 3;

    public function __construct()
    {
        // 启动时预热
        $this->warm();
    }

    public function warm(): void
    {
        while (count($this->warmPool) < $this->poolSize) {
            $instance = app(FlyMachinesSandbox::class)->create([
                'image' => config('sandbox.fly.base_image'),
            ]);
            $this->warmPool[] = $instance;
        }
    }

    public function acquire(): SandboxInstance
    {
        if (empty($this->warmPool)) {
            // 池耗尽，同步创建
            return app(FlyMachinesSandbox::class)->create();
        }

        return array_pop($this->warmPool);
    }

    public function release(SandboxInstance $instance): void
    {
        // 销毁旧实例，预热新实例
        app(FlyMachinesSandbox::class)->destroy($instance);
        $this->warm(); // 异步补充
    }
}
```

### 坑 4：网络隔离不彻底

Docker 的 `--network=none` 只是网络命名空间隔离，Agent 代码仍可通过某些方式（如 DNS rebinding）进行网络外连。gVisor 在这方面表现更好，因为它在用户态拦截了网络相关的系统调用。

```php
// 生产环境建议：网络隔离 + 出站白名单
$config = [
    'network' => false, // 先禁用
    'allowed_hosts' => ['api.openai.com', 'api.anthropic.com'], // 仅白名单
];
```

## 三种方案对比

| 维度 | Firecracker | gVisor | Fly.io Machines |
|------|-------------|--------|-----------------|
| 隔离级别 | 硬件级（KVM） | 用户态内核 | 硬件级（托管） |
| 启动时间 | < 125ms | ~100ms | ~300ms（冷启动） |
| 内存开销 | < 5MB | ~50MB | 托管（按需） |
| 系统调用兼容性 | 完整 Linux | 约 70% | 完整 Linux |
| 基础设施复杂度 | 高（需 KVM） | 中（需 Docker） | 低（全托管） |
| 适用场景 | 最强隔离 | 容器兼容 | 快速原型 |
| 成本 | 自建成本 | 自建成本 | 按秒计费 |

## 总结

Agent 沙箱不是"加个 Docker"就能解决的问题。三种方案各有适用场景：

- **Firecracker**：安全第一，适合处理用户提交的不可信代码
- **gVisor**：兼容性优先，适合在现有容器平台上快速集成
- **Fly.io Machines**：效率优先，适合中小规模、不想自建基础设施的场景

核心原则：**先限制，再放开**。从最严格的资源配额开始，根据实际使用情况逐步放宽。记住，Agent 沙箱的目的是让它**安全地做事**，而不是**什么都能做**。

---

> 下一篇预告：Agent 持久化记忆系统——Redis + 向量数据库的混合架构实战
