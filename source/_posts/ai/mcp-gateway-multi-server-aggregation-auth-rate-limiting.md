---
title: "MCP Gateway 实战：多 MCP Server 聚合、鉴权、限流——企业级 AI Agent 工具层的统一接入与治理"
keywords: [MCP Gateway, MCP Server, AI Agent, 聚合, 鉴权, 限流, 企业级, 工具层的统一接入与治理, AI]
date: 2026-06-09 19:00:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - MCP
  - AI Agent
  - Gateway
  - Laravel
  - 鉴权
  - 限流
  - 工具治理
description: "从零构建企业级 MCP Gateway：多 MCP Server 聚合代理、统一鉴权、令牌限流、审计日志与工具发现——Laravel 实战落地完整方案。"
---


# MCP Gateway 实战：多 MCP Server 聚合、鉴权、限流

## 概述

随着 AI Agent 生态爆发，MCP（Model Context Protocol）已成为 LLM 连接外部工具的事实标准。但当企业内部有 10+、20+ 个 MCP Server 时，直接让 Agent 对接每一个 Server 带来三个问题：

1. **爆炸半径过大** —— 某个 Server 故障可能拖垮整个 Agent 链路
2. **鉴权碎片化** —— 每个 Server 各自实现 auth，Agent 侧维护成本高
3. **缺乏治理** —— 谁调了什么、调了多少次、哪个工具最热、谁该被限流，全靠猜

**MCP Gateway** 就是解决这三个问题的中间层：Agent 只对接一个 Gateway，Gateway 负责聚合、鉴权、限流、审计、路由。

本文用 Laravel 实现一个生产级 MCP Gateway，覆盖完整生命周期。

---

## 核心概念

### MCP 协议回顾

MCP 定义了 Client（Agent/LLM）与 Server（Tool Provider）之间的通信协议：

```
Agent → MCP Client → [Transport] → MCP Server → External Service
```

Transport 层支持 stdio、SSE、HTTP Streamable。企业场景通常走 HTTP/SSE，便于网络穿透和负载均衡。

### Gateway 的定位

```
Agent → MCP Client → Gateway（聚合层）→ MCP Server A
                                        → MCP Server B
                                        → MCP Server C
```

Gateway 本身就是一个 MCP Server（对上游 Agent 暴露统一接口），同时是多个 MCP Server 的 Client（对下游聚合）。

### 关键能力矩阵

| 能力 | 说明 |
|------|------|
| **Tool Aggregation** | 将多个 Server 的 tools 合并为统一 namespace |
| **Authentication** | 统一 JWT/OAuth 鉴权，下游 Server 不再自行验证 |
| **Rate Limiting** | 基于 Agent/API Key 的令牌桶限流 |
| **Audit Logging** | 每次 tool call 的入参、出参、耗时、错误码全量记录 |
| **Health Check** | 定时探测下游 Server 存活状态，故障自动摘除 |
| **Tool Discovery** | Agent 可查询「当前可用工具列表」 |
| **Namespace Isolation** | 多租户场景下工具命名空间隔离 |

---

## 实战代码：Laravel MCP Gateway

### 数据库设计

```php
<?php
// database/migrations/2026_06_09_000001_create_mcp_gateways_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // MCP Server 注册表
        Schema::create('mcp_servers', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();          // 例如 "github-server"
            $table->string('endpoint');                 // MCP Server URL，例如 https://mcp.github.com/sse
            $table->enum('transport', ['sse', 'http_streamable'])->default('sse');
            $table->string('auth_type')->default('none'); // none, api_key, oauth, bearer
            $table->text('auth_config')->nullable();     // JSON，存储 token/密钥等
            $table->boolean('enabled')->default(true);
            $table->json('metadata')->nullable();        // 扩展信息
            $table->timestamp('last_health_check_at')->nullable();
            $table->enum('status', ['healthy', 'degraded', 'down'])->default('healthy');
            $table->timestamps();
        });

        // Agent/API Key 注册表
        Schema::create('mcp_agents', function (Blueprint $table) {
            $table->id();
            $table->string('name');                     // Agent 名称
            $table->string('api_key', 64)->unique();    // API Key
            $table->string('namespace')->nullable();     // 命名空间隔离
            $table->integer('rate_limit_per_minute')->default(60);
            $table->integer('rate_limit_per_day')->default(10000);
            $table->json('allowed_servers')->nullable(); // 允许访问的 Server 列表，null=全部
            $table->json('allowed_tools')->nullable();   // 允许调用的工具，null=全部
            $table->boolean('enabled')->default(true);
            $table->timestamps();
        });

        // 审计日志
        Schema::create('mcp_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('agent_id')->constrained('mcp_agents');
            $table->foreignId('server_id')->nullable()->constrained('mcp_servers');
            $table->string('tool_name');
            $table->json('input_params')->nullable();
            $table->json('output_result')->nullable();
            $table->enum('status', ['success', 'error', 'timeout', 'rate_limited']);
            $table->integer('latency_ms');
            $table->string('error_message')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['agent_id', 'created_at']);
            $table->index(['tool_name', 'created_at']);
            $table->index('status');
        });

        // 限流计数器（Redis 之外的持久化备份）
        Schema::create('mcp_rate_limits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('agent_id')->constrained('mcp_agents');
            $table->string('window');       // "minute:2026-06-09T19:00" 或 "day:2026-06-09"
            $table->integer('count')->default(0);
            $table->unique(['agent_id', 'window']);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mcp_rate_limits');
        Schema::dropIfExists('mcp_audit_logs');
        Schema::dropIfExists('mcp_agents');
        Schema::dropIfExists('mcp_servers');
    }
};
```

### Gateway 核心服务

```php
<?php
// app/Services/Mcp/GatewayService.php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpAgent;
use App\Models\McpAuditLog;
use App\Models\McpServer;
use App\Services\Mcp\Transports\McpTransport;
use App\Services\Mcp\Transports\SseTransport;
use App\Services\Mcp\Transports\HttpStreamableTransport;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class GatewayService
{
    /** @var array<string, McpServer> 缓存的健康 Server 列表 */
    private array $healthyServers = [];

    public function __construct(
        private readonly RateLimiter $rateLimiter,
        private readonly ToolRegistry $toolRegistry,
    ) {}

    /**
     * 从 Agent API Key 解析身份并鉴权
     */
    public function authenticate(string $apiKey): McpAgent
    {
        $agent = McpAgent::where('api_key', $apiKey)
            ->where('enabled', true)
            ->first();

        if (!$agent) {
            throw new RuntimeException('Invalid or disabled API key', 401);
        }

        return $agent;
    }

    /**
     * 限流检查：双窗口（分钟 + 日）
     */
    public function checkRateLimit(McpAgent $agent): void
    {
        if (!$this->rateLimiter->attempt($agent)) {
            throw new RuntimeException(
                "Rate limit exceeded. Limit: {$agent->rate_limit_per_minute}/min, {$agent->rate_limit_per_day}/day",
                429
            );
        }
    }

    /**
     * 工具发现：返回 Agent 有权访问的所有工具列表
     */
    public function discoverTools(McpAgent $agent): array
    {
        $servers = $this->getAccessibleServers($agent);
        $allTools = [];

        foreach ($servers as $server) {
            try {
                $transport = $this->makeTransport($server);
                $tools = $transport->listTools();
                $allTools = array_merge($allTools, $tools);
            } catch (\Throwable $e) {
                Log::warning("Tool discovery failed for {$server->name}: {$e->getMessage()}");
            }
        }

        // 过滤 Agent 无权访问的工具
        return $this->filterTools($agent, $allTools);
    }

    /**
     * 工具调用：路由到正确的 MCP Server 并记录审计日志
     */
    public function callTool(McpAgent $agent, string $toolName, array $params): mixed
    {
        $startTime = microtime(true);
        $status = 'success';
        $output = null;
        $errorMsg = null;
        $serverId = null;

        try {
            // 1. 权限检查
            $this->checkToolAccess($agent, $toolName);

            // 2. 限流检查
            $this->checkRateLimit($agent);

            // 3. 路由到对应 Server
            $server = $this->routeToServer($toolName, $agent);
            $serverId = $server->id;

            // 4. 调用下游
            $transport = $this->makeTransport($server);
            $output = $transport->callTool($toolName, $params);

        } catch (\Throwable $e) {
            $status = match (true) {
                str_contains($e->getMessage(), 'Rate limit') => 'rate_limited',
                str_contains($e->getMessage(), 'timeout')     => 'timeout',
                default                                        => 'error',
            };
            $errorMsg = $e->getMessage();
            $output = ['error' => $errorMsg];
        } finally {
            $latency = (int) ((microtime(true) - $startTime) * 1000);

            // 5. 异步记录审计日志
            $this->logAudit($agent, $serverId, $toolName, $params, $output, $status, $latency, $errorMsg);
        }

        return $output;
    }

    /**
     * 获取 Agent 可访问的 Server 列表
     */
    private function getAccessibleServers(McpAgent $agent): array
    {
        $query = McpServer::where('enabled', true)
            ->where('status', '!=', 'down');

        if ($agent->allowed_servers) {
            $query->whereIn('name', $agent->allowed_servers);
        }

        return $query->get()->all();
    }

    /**
     * 根据工具名路由到对应 Server（工具名前缀匹配）
     * 格式：{server_name}_{tool_name}，例如 github_create_issue
     */
    private function routeToServer(string $toolName, McpAgent $agent): McpServer
    {
        // 从工具名提取 server 前缀
        $parts = explode('_', $toolName, 2);
        if (count($parts) < 2) {
            throw new RuntimeException("Invalid tool name format: {$toolName}");
        }

        $serverName = $parts[0];
        $server = McpServer::where('name', $serverName)
            ->where('enabled', true)
            ->where('status', '!=', 'down')
            ->first();

        if (!$server) {
            throw new RuntimeException("MCP Server '{$serverName}' not found or unavailable");
        }

        return $server;
    }

    /**
     * 权限过滤：检查 Agent 是否有权调用该工具
     */
    private function checkToolAccess(McpAgent $agent, string $toolName): void
    {
        if ($agent->allowed_tools === null) {
            return; // null = 全部允许
        }

        if (!in_array($toolName, $agent->allowed_tools)) {
            throw new RuntimeException("Tool '{$toolName}' not allowed for agent '{$agent->name}'", 403);
        }
    }

    private function filterTools(McpAgent $agent, array $tools): array
    {
        if ($agent->allowed_tools === null) {
            return $tools;
        }

        return array_filter($tools, fn($tool) => in_array($tool['name'], $agent->allowed_tools));
    }

    /**
     * 创建 Transport 实例
     */
    private function makeTransport(McpServer $server): McpTransport
    {
        return match ($server->transport) {
            'sse'               => new SseTransport($server),
            'http_streamable'   => new HttpStreamableTransport($server),
            default             => throw new RuntimeException("Unknown transport: {$server->transport}"),
        };
    }

    /**
     * 写审计日志（异步队列）
     */
    private function logAudit(
        McpAgent $agent,
        ?int $serverId,
        string $toolName,
        array $input,
        mixed $output,
        string $status,
        int $latency,
        ?string $errorMsg,
    ): void {
        DB::table('mcp_audit_logs')->insert([
            'agent_id'      => $agent->id,
            'server_id'     => $serverId,
            'tool_name'     => $toolName,
            'input_params'  => json_encode($input),
            'output_result' => is_array($output) ? json_encode($output) : null,
            'status'        => $status,
            'latency_ms'    => $latency,
            'error_message' => $errorMsg,
            'created_at'    => now(),
        ]);
    }
}
```

### 令牌桶限流器

```php
<?php
// app/Services/Mcp/RateLimiter.php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpAgent;
use Illuminate\Support\Facades\Redis;

class RateLimiter
{
    /**
     * 双窗口令牌桶限流
     * - 分钟窗口：滑动窗口计数
     * - 日窗口：固定窗口计数
     * 两个窗口都通过才放行
     */
    public function attempt(McpAgent $agent): bool
    {
        $minuteKey = "mcp:rate:{$agent->id}:min:" . date('Y-m-d\TH:i');
        $dayKey    = "mcp:rate:{$agent->id}:day:" . date('Y-m-d');

        $pipe = Redis::pipeline();
        $pipe->incr($minuteKey);
        $pipe->expire($minuteKey, 120);  // 2 分钟过期，兜底
        $pipe->incr($dayKey);
        $pipe->expire($dayKey, 172800);  // 2 天过期
        $results = $pipe->exec();

        $minuteCount = $results[0];
        $dayCount    = $results[2];

        return $minuteCount <= $agent->rate_limit_per_minute
            && $dayCount <= $agent->rate_limit_per_day;
    }

    /**
     * 查询当前用量（用于 Dashboard/API）
     */
    public function currentUsage(McpAgent $agent): array
    {
        $minuteKey = "mcp:rate:{$agent->id}:min:" . date('Y-m-d\TH:i');
        $dayKey    = "mcp:rate:{$agent->id}:day:" . date('Y-m-d');

        return [
            'minute' => [
                'used'  => (int) Redis::get($minuteKey),
                'limit' => $agent->rate_limit_per_minute,
            ],
            'day' => [
                'used'  => (int) Redis::get($dayKey),
                'limit' => $agent->rate_limit_per_day,
            ],
        ];
    }
}
```

### MCP Transport 抽象层

```php
<?php
// app/Services/Mcp/Transports/McpTransport.php

declare(strict_types=1);

namespace App\Services\Mcp\Transports;

use App\Models\McpServer;

interface McpTransport
{
    public function listTools(): array;

    public function callTool(string $name, array $params): mixed;
}
```

```php
<?php
// app/Services/Mcp/Transports/SseTransport.php

declare(strict_types=1);

namespace App\Services\Mcp\Transports;

use App\Models\McpServer;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class SseTransport implements McpTransport
{
    public function __construct(
        private readonly McpServer $server,
    ) {}

    public function listTools(): array
    {
        $response = Http::timeout(10)
            ->withHeaders($this->buildHeaders())
            ->post($this->server->endpoint, [
                'jsonrpc' => '2.0',
                'id'      => uniqid('list_'),
                'method'  => 'tools/list',
                'params'  => new \stdClass(),
            ]);

        if ($response->failed()) {
            throw new RuntimeException(
                "MCP Server {$this->server->name} tools/list failed: HTTP {$response->status()}"
            );
        }

        $body = $response->json();
        return $body['result']['tools'] ?? [];
    }

    public function callTool(string $name, array $params): mixed
    {
        // 去掉 server 前缀：github_create_issue → create_issue
        $toolName = $this->stripPrefix($name);

        $response = Http::timeout(30)
            ->withHeaders($this->buildHeaders())
            ->post($this->server->endpoint, [
                'jsonrpc' => '2.0',
                'id'      => uniqid('call_'),
                'method'  => 'tools/call',
                'params'  => [
                    'name'      => $toolName,
                    'arguments' => $params,
                ],
            ]);

        if ($response->failed()) {
            throw new RuntimeException(
                "MCP Server {$this->server->name} tools/call failed: HTTP {$response->status()}"
            );
        }

        $body = $response->json();

        if (isset($body['error'])) {
            throw new RuntimeException(
                "MCP Server {$this->server->name} error: {$body['error']['message']}"
            );
        }

        return $body['result'] ?? null;
    }

    private function buildHeaders(): array
    {
        $headers = ['Content-Type' => 'application/json'];

        $authConfig = json_decode($this->server->auth_config ?? '{}', true);

        return match ($this->server->auth_type) {
            'api_key' => array_merge($headers, [
                'Authorization' => 'Bearer ' . ($authConfig['token'] ?? ''),
            ]),
            'oauth' => array_merge($headers, [
                'Authorization' => 'Bearer ' . $this->getOAuthToken($authConfig),
            ]),
            default => $headers,
        };
    }

    private function getOAuthToken(array $config): string
    {
        // OAuth token refresh logic
        $cached = cache()->get("mcp_oauth:{$this->server->name}");
        if ($cached) {
            return $cached;
        }

        $response = Http::asForm()->post($config['token_url'], [
            'grant_type'    => 'client_credentials',
            'client_id'     => $config['client_id'],
            'client_secret' => $config['client_secret'],
            'scope'         => $config['scope'] ?? '',
        ]);

        $token = $response->json('access_token');
        cache()->put("mcp_oauth:{$this->server->name}", $token, 3300); // 55 分钟缓存

        return $token;
    }

    private function stripPrefix(string $toolName): string
    {
        $prefix = $this->server->name . '_';
        return str_starts_with($toolName, $prefix)
            ? substr($toolName, strlen($prefix))
            : $toolName;
    }
}
```

### 健康检查守护进程

```php
<?php
// app/Console/Commands/McpHealthCheckCommand.php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\McpServer;
use App\Services\Mcp\Transports\SseTransport;
use App\Services\Mcp\Transports\HttpStreamableTransport;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class McpHealthCheckCommand extends Command
{
    protected $signature = 'mcp:health-check
                            {--server= : 指定 Server 名称，不传则检查全部}
                            {--down-threshold=3 : 连续失败次数阈值，超过则标记 down}';

    protected $description = '探测所有 MCP Server 存活状态';

    public function handle(): int
    {
        $threshold = (int) $this->option('down-threshold');
        $query = McpServer::query()->where('enabled', true);

        if ($name = $this->option('server')) {
            $query->where('name', $name);
        }

        $servers = $query->get();
        $results = [];

        foreach ($servers as $server) {
            $result = $this->checkServer($server, $threshold);
            $results[] = $result;

            $this->line(sprintf(
                '  %-30s %s  (latency: %dms, consecutive_fails: %d)',
                $server->name,
                $result['status'],
                $result['latency_ms'],
                $result['consecutive_fails'],
            ));
        }

        // 汇总
        $healthy = collect($results)->where('status', 'healthy')->count();
        $degraded = collect($results)->where('status', 'degraded')->count();
        $down = collect($results)->where('status', 'down')->count();

        $this->newLine();
        $this->info("Health check complete: {$healthy} healthy, {$degraded} degraded, {$down} down");

        return $down > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function checkServer(McpServer $server, int $threshold): array
    {
        $start = microtime(true);
        $status = 'healthy';
        $consecutiveFails = (int) ($server->metadata['consecutive_fails'] ?? 0);

        try {
            $transport = match ($server->transport) {
                'sse'             => new SseTransport($server),
                'http_streamable' => new HttpStreamableTransport($server),
                default           => throw new \RuntimeException("Unknown transport"),
            };

            // 用 tools/list 作为心跳探针
            $tools = $transport->listTools();
            $consecutiveFails = 0;

            if (empty($tools)) {
                $status = 'degraded';
            }

        } catch (\Throwable $e) {
            $consecutiveFails++;
            Log::warning("MCP health check failed for {$server->name}: {$e->getMessage()}");

            if ($consecutiveFails >= $threshold) {
                $status = 'down';
            } else {
                $status = 'degraded';
            }
        }

        $latency = (int) ((microtime(true) - $start) * 1000);

        $server->update([
            'last_health_check_at' => now(),
            'status'               => $status,
            'metadata'             => array_merge($server->metadata ?? [], [
                'consecutive_fails' => $consecutiveFails,
                'last_latency_ms'   => $latency,
            ]),
        ]);

        return [
            'status'            => $status,
            'latency_ms'        => $latency,
            'consecutive_fails' => $consecutiveFails,
        ];
    }
}
```

### Gateway HTTP API 层

```php
<?php
// app/Http/Controllers/McpGatewayController.php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Mcp\GatewayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class McpGatewayController extends Controller
{
    public function __construct(
        private readonly GatewayService $gateway,
    ) {}

    /**
     * POST /mcp/gateway/tools/call
     * 统一工具调用入口
     */
    public function callTool(Request $request): JsonResponse
    {
        try {
            $apiKey = $request->header('X-MCP-API-Key');
            $agent = $this->gateway->authenticate($apiKey);

            $validated = $request->validate([
                'tool'   => 'required|string',
                'params' => 'required|array',
            ]);

            $result = $this->gateway->callTool(
                $agent,
                $validated['tool'],
                $validated['params'],
            );

            return response()->json([
                'success' => true,
                'data'    => $result,
                'meta'    => [
                    'agent'  => $agent->name,
                    'tool'   => $validated['tool'],
                ],
            ]);

        } catch (RuntimeException $e) {
            return response()->json([
                'success' => false,
                'error'   => $e->getMessage(),
            ], $e->getCode() ?: 500);
        }
    }

    /**
     * GET /mcp/gateway/tools
     * 工具发现
     */
    public function listTools(Request $request): JsonResponse
    {
        try {
            $apiKey = $request->header('X-MCP-API-Key');
            $agent = $this->gateway->authenticate($apiKey);

            $tools = $this->gateway->discoverTools($agent);

            return response()->json([
                'success' => true,
                'data'    => array_values($tools),
                'count'   => count($tools),
            ]);

        } catch (RuntimeException $e) {
            return response()->json([
                'success' => false,
                'error'   => $e->getMessage(),
            ], $e->getCode() ?: 500);
        }
    }

    /**
     * GET /mcp/gateway/audit-logs
     * 审计日志查询
     */
    public function auditLogs(Request $request): JsonResponse
    {
        $logs = \App\Models\McpAuditLog::query()
            ->when($request->agent_id, fn($q, $id) => $q->where('agent_id', $id))
            ->when($request->tool_name, fn($q, $name) => $q->where('tool_name', $name))
            ->when($request->status, fn($q, $s) => $q->where('status', $s))
            ->orderByDesc('created_at')
            ->limit(100)
            ->get();

        return response()->json([
            'success' => true,
            'data'    => $logs,
        ]);
    }

    /**
     * GET /mcp/gateway/rate-limit-usage
     * 限流用量查询
     */
    public function rateLimitUsage(Request $request): JsonResponse
    {
        $apiKey = $request->header('X-MCP-API-Key');
        $agent = $this->gateway->authenticate($apiKey);

        $usage = app(\App\Services\Mcp\RateLimiter::class)->currentUsage($agent);

        return response()->json([
            'success' => true,
            'data'    => $usage,
        ]);
    }
}
```

### 路由注册

```php
// routes/api.php

use App\Http\Controllers\McpGatewayController;

Route::prefix('mcp/gateway')->middleware(['auth.api_key'])->group(function () {
    Route::get('/tools', [McpGatewayController::class, 'listTools']);
    Route::post('/tools/call', [McpGatewayController::class, 'callTool']);
    Route::get('/audit-logs', [McpGatewayController::class, 'auditLogs']);
    Route::get('/rate-limit-usage', [McpGatewayController::class, 'rateLimitUsage']);
});
```

---

## 踩坑记录

### 1. 工具名命名冲突

**问题**：多个 Server 提供同名工具（如都叫 `search`），Agent 调用时路由到哪个？

**方案**：Gateway 强制加 namespace 前缀：`{server_name}_{tool_name}`。Agent 调用 `github_search` 或 `jira_search`，Gateway 前缀匹配后剥离前缀再转发。**不要用 `.` 分隔**，MCP 协议规范要求工具名只含 `[a-zA-Z0-9_-]`。

### 2. SSE 长连接的心跳丢失

**问题**：SSE Transport 需要维护长连接，但某些 MCP Server 实现的心跳间隔不一致，导致 Gateway 误判为 down。

**方案**：健康检查使用 `tools/list` 作为探针（轻量级），而非依赖 SSE 心跳。同时设置 `down-threshold=3`，连续失败 3 次才摘除，避免网络抖动误伤。

### 3. 限流计数器的时钟漂移

**问题**：多台 Gateway 实例部署时，Redis 的 `INCR` + `EXPIRE` 在不同实例上可能因为时钟差异导致窗口不对齐。

**方案**：使用 Redis 的滑动窗口（`ZRANGEBYSCORE`）替代固定窗口。如果精度要求不高，固定窗口 + 120 秒 TTL 的容错方案足够。

### 4. 审计日志的性能影响

**问题**：每次 tool call 都写审计日志，高并发下数据库成瓶颈。

**方案**：
- 审计日志表只保留 30 天（定时归档到 S3/OSS）
- 高吞吐场景改用 `INSERT INTO ... SELECT` 批量写入，或直接写 Kafka → ClickHouse
- `tool_name` 和 `created_at` 建联合索引，支撑按工具/时间范围的查询

### 5. 下游 Server 的 Auth Token 管理

**问题**：每个下游 MCP Server 的 auth 方式不同（API Key、OAuth、Bearer），Gateway 需要统一管理。

**方案**：
- `mcp_servers.auth_config` 存储加密后的凭证（Laravel `Crypt::encryptString`）
- OAuth token 自动刷新并缓存（TTL 比 token 过期时间短 5 分钟）
- **不要把 token 明文存在数据库**，用 `encrypted` 字段或 Vault

---

## 部署架构

```
┌─────────────────────────────────────────────┐
│              Agent / LLM Client              │
│         (OpenAI, Claude, 自研 Agent)         │
└────────────────────┬────────────────────────┘
                     │ X-MCP-API-Key
                     ▼
┌─────────────────────────────────────────────┐
│            MCP Gateway (Laravel)             │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Auth    │ │ Rate     │ │ Audit Log    │  │
│  │ Guard   │ │ Limiter  │ │ Collector    │  │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘  │
│       └───────────┼──────────────┘           │
│                   ▼                          │
│          ┌────────────────┐                  │
│          │  Tool Router   │                  │
│          │  (prefix match)│                  │
│          └───────┬────────┘                  │
└──────────────────┼───────────────────────────┘
         ┌─────────┼──────────┐
         ▼         ▼          ▼
   ┌──────────┐ ┌────────┐ ┌────────┐
   │ GitHub   │ │ Jira   │ │ Slack  │
   │ MCP      │ │ MCP    │ │ MCP    │
   │ Server   │ │ Server │ │ Server │
   └──────────┘ └────────┘ └────────┘
```

---

## 总结

MCP Gateway 不是一个「可选」的中间层，而是企业级 AI Agent 基础设施的**必选项**：

1. **统一入口**：Agent 只对接一个端点，不感知下游有多少 Server
2. **安全可控**：统一鉴权、工具级权限控制、审计日志全量可追溯
3. **弹性治理**：令牌桶限流保护下游、健康检查自动摘除故障节点
4. **可观测性**：每个 tool call 的耗时、成功率、错误分布一目了然

当你的 Agent 接入 3 个以上 MCP Server 时，就应该考虑上 Gateway。**早做比晚做便宜**——等到 Agent 已经直接对接了 20 个 Server 再想聚合，迁移成本会指数级上升。
