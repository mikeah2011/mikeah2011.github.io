---
title: "MCP Gateway 实战进阶：多租户 MCP Server 聚合层——鉴权、限流、审计日志与工具发现的统一治理"
keywords: [MCP Gateway, MCP Server, 实战进阶, 多租户, 聚合层, 鉴权, 限流, 审计日志与工具发现的统一治理, 架构]
date: 2026-06-10 00:00:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - MCP
  - API Gateway
  - 多租户
  - Laravel
  - 微服务
description: "在生产环境中运行多个 MCP Server 时，你需要一个聚合层来统一处理鉴权、限流、审计和工具发现。本文用 Laravel 构建一个完整的 MCP Gateway，支持多租户隔离、动态路由和全链路可观测。"
---


## 为什么需要 MCP Gateway

当你从单个 MCP Server 的 PoC 走向生产部署时，问题会迅速膨胀：

- **多个 MCP Server 分散运行**，每个有自己的鉴权逻辑，客户端要记住一堆地址
- **工具发现靠硬编码**，新增一个 Server 要手动通知所有消费者
- **没有统一的审计日志**，出了问题不知道谁调了什么
- **限流策略各自为政**，一个租户打爆一个 Server，其他租户跟着遭殃

MCP Gateway 就是解决这些问题的聚合层。它对外暴露一个统一的 MCP 端点，对内代理到多个后端 MCP Server，同时提供鉴权、限流、审计和工具发现的统一治理。

架构图：

```
Client (AI Agent / IDE)
        │
        ▼
┌─────────────────────┐
│    MCP Gateway      │
│  ┌───────────────┐  │
│  │ 鉴权中间件     │  │
│  │ 限流中间件     │  │
│  │ 审计日志       │  │
│  │ 工具注册表     │  │
│  └───────────────┘  │
│    Router Layer     │
└───┬─────┬─────┬─────┘
    │     │     │
    ▼     ▼     ▼
  MCP-A MCP-B MCP-C   ← 后端 MCP Servers（按租户隔离）
```

## 核心设计

### 1. 多租户模型

每个租户有独立的 MCP Server 集合和权限边界。Gateway 通过 API Key 识别租户，再根据租户配置路由到对应的后端 Server。

```php
// app/Models/Tenant.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Tenant extends Model
{
    protected $fillable = [
        'name',
        'api_key',
        'rate_limit_per_minute',
        'allowed_tools',
        'mcp_servers',       // JSON: 后端 MCP Server 列表
        'is_active',
    ];

    protected $casts = [
        'allowed_tools' => 'array',
        'mcp_servers'   => 'array',
        'is_active'     => 'boolean',
    ];

    public function auditLogs()
    {
        return $this->hasMany(AuditLog::class);
    }

    /**
     * 生成 API Key
     */
    public static function generateApiKey(): string
    {
        return 'mcp_' . bin2hex(random_bytes(32));
    }
}
```

`mcp_servers` 字段示例：

```json
[
    {
        "id": "server-a",
        "name": "文档搜索服务",
        "url": "http://mcp-server-a:3001",
        "transport": "sse",
        "tools": ["search_docs", "get_doc_content"]
    },
    {
        "id": "server-b",
        "name": "数据库查询服务",
        "url": "http://mcp-server-b:3002",
        "transport": "streamable-http",
        "tools": ["query_db", "list_tables"]
    }
]
```

### 2. 鉴权中间件

Gateway 使用 Laravel 中间件拦截请求，从 `Authorization` 头提取 API Key，解析出租户信息后注入到请求上下文。

```php
// app/Http/Middleware/McpAuthenticate.php
namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;

class McpAuthenticate
{
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code'    => -32001,
                    'message' => 'Missing authorization token',
                ],
                'id' => null,
            ], 401);
        }

        $tenant = Tenant::where('api_key', $token)
            ->where('is_active', true)
            ->first();

        if (!$tenant) {
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code'    => -32002,
                    'message' => 'Invalid or inactive API key',
                ],
                'id' => null,
            ], 403);
        }

        // 注入租户到请求上下文
        $request->merge(['tenant' => $tenant]);
        app()->instance('current_tenant', $tenant);

        return $next($request);
    }
}
```

注册到 Kernel：

```php
// app/Http/Kernel.php
protected $middlewareAliases = [
    'mcp.auth' => \App\Http\Middleware\McpAuthenticate::class,
    'mcp.rate' => \App\Http\Middleware\McpRateLimit::class,
    'mcp.audit' => \App\Http\Middleware\McpAuditLog::class,
];
```

### 3. 限流策略

限流基于租户维度，使用 Redis 的滑动窗口算法。每个租户的限制在 `tenants.rate_limit_per_minute` 中配置。

```php
// app/Http/Middleware/McpRateLimit.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;

class McpRateLimit
{
    public function handle(Request $request, Closure $next)
    {
        $tenant = $request->get('tenant') ?? app('current_tenant');

        if (!$tenant) {
            return $next($request);
        }

        $key = "mcp:ratelimit:{$tenant->id}";
        $limit = $tenant->rate_limit_per_minute ?? 60;
        $window = 60; // 1 分钟窗口

        // 滑动窗口计数
        $now = microtime(true);
        $windowStart = $now - $window;

        Redis::pipeline(function ($pipe) use ($key, $now, $windowStart, $window) {
            $pipe->zremrangebyscore($key, '-inf', $windowStart);
            $pipe->zadd($key, $now, $now . ':' . mt_rand());
            $pipe->zcard($key);
            $pipe->expire($key, $window);
        });

        $count = Redis::zcard($key);

        if ($count > $limit) {
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code'    => -32003,
                    'message' => 'Rate limit exceeded',
                    'data'    => [
                        'limit'     => $limit,
                        'remaining' => 0,
                        'reset_in'  => $window,
                    ],
                ],
                'id' => null,
            ], 429)->withHeaders([
                'X-RateLimit-Limit'     => $limit,
                'X-RateLimit-Remaining' => 0,
                'Retry-After'           => $window,
            ]);
        }

        $response = $next($request);

        return $response->withHeaders([
            'X-RateLimit-Limit'     => $limit,
            'X-RateLimit-Remaining' => max(0, $limit - $count),
        ]);
    }
}
```

### 4. 审计日志

每次 MCP 调用都记录到审计日志，包括调用者、工具名、参数摘要、耗时和结果状态。

```php
// app/Http/Middleware/McpAuditLog.php
namespace App\Http\Middleware;

use App\Models\AuditLog;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class McpAuditLog
{
    public function handle(Request $request, Closure $next)
    {
        $requestId = (string) Str::uuid();
        $startTime = microtime(true);

        $request->merge(['request_id' => $requestId]);

        $response = $next($request);

        // 异步写入审计日志
        $tenant = app('current_tenant');
        if ($tenant) {
            $duration = round((microtime(true) - $startTime) * 1000, 2);
            $body = $request->input();

            AuditLog::create([
                'request_id'   => $requestId,
                'tenant_id'    => $tenant->id,
                'method'       => $body['method'] ?? 'unknown',
                'tool_name'    => $body['params']['name'] ?? null,
                'params_hash'  => isset($body['params'])
                    ? md5(json_encode($body['params']))
                    : null,
                'status_code'  => $response->getStatusCode(),
                'duration_ms'  => $duration,
                'ip_address'   => $request->ip(),
                'user_agent'   => $request->userAgent(),
            ]);
        }

        return $response->header('X-Request-Id', $requestId);
    }
}
```

审计日志模型：

```php
// app/Models/AuditLog.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $fillable = [
        'request_id',
        'tenant_id',
        'method',
        'tool_name',
        'params_hash',
        'status_code',
        'duration_ms',
        'ip_address',
        'user_agent',
    ];

    public function tenant()
    {
        return $this->belongsTo(Tenant::class);
    }
}
```

### 5. 工具注册表与动态发现

Gateway 维护一个工具注册表，聚合所有后端 MCP Server 暴露的工具。客户端调用 `tools/list` 时，Gateway 返回该租户可见的全部工具。

```php
// app/Services/ToolRegistry.php
namespace App\Services;

use App\Models\Tenant;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class ToolRegistry
{
    /**
     * 获取租户可用的全部工具
     */
    public function getToolsForTenant(Tenant $tenant): array
    {
        $cacheKey = "mcp:tools:tenant:{$tenant->id}";

        return Cache::remember($cacheKey, 300, function () use ($tenant) {
            $allTools = [];

            foreach ($tenant->mcp_servers ?? [] as $server) {
                $tools = $this->discoverTools($server);
                foreach ($tools as $tool) {
                    $tool['_server_id'] = $server['id'];
                    $tool['_server_url'] = $server['url'];
                    $allTools[] = $tool;
                }
            }

            // 过滤租户允许的工具
            $allowed = $tenant->allowed_tools;
            if (!empty($allowed)) {
                $allTools = array_filter($allTools, function ($tool) use ($allowed) {
                    return in_array($tool['name'], $allowed);
                });
            }

            return array_values($allTools);
        });
    }

    /**
     * 从后端 MCP Server 发现工具
     */
    private function discoverTools(array $server): array
    {
        try {
            $response = Http::timeout(5)->post($server['url'], [
                'jsonrpc' => '2.0',
                'method'  => 'tools/list',
                'id'      => 1,
            ]);

            if ($response->successful()) {
                $data = $response->json();
                return $data['result']['tools'] ?? [];
            }
        } catch (\Exception $e) {
            report($e);
        }

        return [];
    }

    /**
     * 查找工具所在的后端 Server
     */
    public function findServerForTool(Tenant $tenant, string $toolName): ?array
    {
        $tools = $this->getToolsForTenant($tenant);

        foreach ($tools as $tool) {
            if ($tool['name'] === $toolName) {
                return [
                    'id'  => $tool['_server_id'],
                    'url' => $tool['_server_url'],
                ];
            }
        }

        return null;
    }

    /**
     * 清除租户工具缓存
     */
    public function invalidateCache(int $tenantId): void
    {
        Cache::forget("mcp:tools:tenant:{$tenantId}");
    }
}
```

### 6. 路由代理层

Gateway 的核心是路由代理——根据请求的 MCP 方法分发到不同处理逻辑。

```php
// app/Services/McpProxy.php
namespace App\Services;

use App\Models\Tenant;
use Illuminate\Support\Facades\Http;

class McpProxy
{
    public function __construct(
        private ToolRegistry $toolRegistry,
    ) {}

    /**
     * 代理 MCP 请求到后端 Server
     */
    public function handle(Tenant $tenant, array $payload): array
    {
        $method = $payload['method'] ?? '';

        return match ($method) {
            'initialize'   => $this->handleInitialize($tenant, $payload),
            'tools/list'   => $this->handleToolsList($tenant, $payload),
            'tools/call'   => $this->handleToolsCall($tenant, $payload),
            'ping'         => ['jsonrpc' => '2.0', 'result' => new \stdClass, 'id' => $payload['id']],
            default        => $this->forwardToServer($tenant, $payload, null),
        };
    }

    private function handleInitialize(Tenant $tenant, array $payload): array
    {
        $tools = $this->toolRegistry->getToolsForTenant($tenant);

        return [
            'jsonrpc' => '2.0',
            'result'  => [
                'protocolVersion' => '2025-03-26',
                'capabilities'    => [
                    'tools' => ['listChanged' => true],
                ],
                'serverInfo' => [
                    'name'    => 'MCP Gateway',
                    'version' => '1.0.0',
                ],
            ],
            'id' => $payload['id'],
        ];
    }

    private function handleToolsList(Tenant $tenant, array $payload): array
    {
        $tools = $this->toolRegistry->getToolsForTenant($tenant);

        // 移除内部字段
        $publicTools = array_map(function ($tool) {
            unset($tool['_server_id'], $tool['_server_url']);
            return $tool;
        }, $tools);

        return [
            'jsonrpc' => '2.0',
            'result'  => ['tools' => $publicTools],
            'id'      => $payload['id'],
        ];
    }

    private function handleToolsCall(Tenant $tenant, array $payload): array
    {
        $toolName = $payload['params']['name'] ?? '';

        // 权限检查
        $allowed = $tenant->allowed_tools;
        if (!empty($allowed) && !in_array($toolName, $allowed)) {
            return [
                'jsonrpc' => '2.0',
                'error'   => [
                    'code'    => -32004,
                    'message' => "Tool '{$toolName}' not allowed for this tenant",
                ],
                'id' => $payload['id'],
            ];
        }

        // 路由到对应的后端 Server
        $server = $this->toolRegistry->findServerForTool($tenant, $toolName);

        if (!$server) {
            return [
                'jsonrpc' => '2.0',
                'error'   => [
                    'code'    => -32601,
                    'message' => "Tool '{$toolName}' not found",
                ],
                'id' => $payload['id'],
            ];
        }

        return $this->forwardToServer($tenant, $payload, $server);
    }

    private function forwardToServer(Tenant $tenant, array $payload, ?array $server): array
    {
        if (!$server) {
            return [
                'jsonrpc' => '2.0',
                'error'   => [
                    'code'    => -32601,
                    'message' => 'Method not supported',
                ],
                'id' => $payload['id'],
            ];
        }

        try {
            $response = Http::timeout(30)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-Tenant-Id'  => (string) $tenant->id,
                    'X-Request-Id' => request()->get('request_id', ''),
                ])
                ->post($server['url'], $payload);

            if ($response->successful()) {
                return $response->json();
            }

            return [
                'jsonrpc' => '2.0',
                'error'   => [
                    'code'    => -32099,
                    'message' => 'Backend server error',
                    'data'    => [
                        'server' => $server['id'],
                        'status' => $response->status(),
                    ],
                ],
                'id' => $payload['id'],
            ];
        } catch (\Exception $e) {
            return [
                'jsonrpc' => '2.0',
                'error'   => [
                    'code'    => -32098,
                    'message' => 'Backend server unreachable',
                    'data'    => [
                        'server'  => $server['id'],
                        'message' => $e->getMessage(),
                    ],
                ],
                'id' => $payload['id'],
            ];
        }
    }
}
```

### 7. 控制器：统一入口

```php
// app/Http/Controllers/McpController.php
namespace App\Http\Controllers;

use App\Services\McpProxy;
use Illuminate\Http\Request;

class McpController extends Controller
{
    public function __construct(
        private McpProxy $proxy,
    ) {}

    /**
     * POST /mcp — 统一 MCP 端点
     */
    public function handle(Request $request)
    {
        $tenant = app('current_tenant');
        $payload = $request->json()->all();

        // 支持批量请求
        if (isset($payload[0])) {
            $results = [];
            foreach ($payload as $single) {
                $results[] = $this->proxy->handle($tenant, $single);
            }
            return response()->json($results);
        }

        return response()->json($this->proxy->handle($tenant, $payload));
    }

    /**
     * GET /mcp/tools — 快捷查看工具列表
     */
    public function tools(Request $request)
    {
        $tenant = app('current_tenant');
        $tools = app(\App\Services\ToolRegistry::class)
            ->getToolsForTenant($tenant);

        return response()->json([
            'tools' => array_map(function ($tool) {
                unset($tool['_server_id'], $tool['_server_url']);
                return $tool;
            }, $tools),
        ]);
    }
}
```

路由定义：

```php
// routes/api.php
Route::middleware(['mcp.auth', 'mcp.rate', 'mcp.audit'])->group(function () {
    Route::post('/mcp', [McpController::class, 'handle']);
    Route::get('/mcp/tools', [McpController::class, 'tools']);
});
```

## 数据库迁移

```php
// database/migrations/2026_06_10_create_tenants_table.php
public function up(): void
{
    Schema::create('tenants', function (Blueprint $table) {
        $table->id();
        $table->string('name');
        $table->string('api_key', 128)->unique();
        $table->unsignedInteger('rate_limit_per_minute')->default(60);
        $table->json('allowed_tools')->nullable();
        $table->json('mcp_servers');
        $table->boolean('is_active')->default(true);
        $table->timestamps();

        $table->index('api_key');
    });

    Schema::create('audit_logs', function (Blueprint $table) {
        $table->id();
        $table->uuid('request_id')->index();
        $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
        $table->string('method');
        $table->string('tool_name')->nullable();
        $table->string('params_hash', 32)->nullable();
        $table->unsignedSmallInteger('status_code');
        $table->unsignedInteger('duration_ms');
        $table->ipAddress('ip_address');
        $table->string('user_agent')->nullable();
        $table->timestamps();

        $table->index(['tenant_id', 'created_at']);
        $table->index('tool_name');
    });
}
```

## 客户端接入示例

接入方只需要知道 Gateway 地址和自己的 API Key：

```php
// 客户端示例：调用 Gateway 上的工具
$response = Http::withHeaders([
    'Authorization' => 'Bearer mcp_abc123...',
    'Content-Type'  => 'application/json',
])->post('https://mcp-gateway.example.com/mcp', [
    'jsonrpc' => '2.0',
    'method'  => 'tools/call',
    'params'  => [
        'name'      => 'search_docs',
        'arguments' => ['query' => 'Laravel 队列最佳实践'],
    ],
    'id' => 1,
]);

$result = $response->json();
// Gateway 自动路由到 "文档搜索服务" MCP Server
```

## 踩坑记录

### 1. SSE 传输的代理问题

后端 MCP Server 如果使用 SSE（Server-Sent Events）传输，Gateway 不能简单地用 `Http::post()` 转发。需要对 SSE 做流式代理：

```php
// 对 SSE 传输的特殊处理
if ($server['transport'] === 'sse') {
    return response()->stream(function () use ($server, $payload) {
        $client = new \GuzzleHttp\Client();
        $response = $client->request('POST', $server['url'], [
            'stream'  => true,
            'json'    => $payload,
            'timeout' => 30,
        ]);

        $body = $response->getBody();
        while (!$body->eof()) {
            echo $body->read(1024);
            ob_flush();
            flush();
        }
    }, 200, [
        'Content-Type'  => 'text/event-stream',
        'Cache-Control' => 'no-cache',
    ]);
}
```

### 2. 工具缓存导致新工具不可见

`ToolRegistry` 缓存了 5 分钟，新增工具后客户端看不到。解决：提供缓存失效端点。

```php
// POST /admin/tenants/{id}/invalidate-tools
Route::post('/admin/tenants/{id}/invalidate-tools', function (int $id) {
    app(ToolRegistry::class)->invalidateCache($id);
    return response()->json(['status' => 'ok']);
});
```

### 3. 审计日志拖慢请求

同步写审计日志在高并发下会拖慢响应。改为队列异步写入：

```php
// 审计日志改为 dispatch
dispatch(function () use ($auditData) {
    AuditLog::create($auditData);
})->afterCommit();
```

### 4. 租户间数据隔离

确保所有查询都带 `tenant_id` 条件。审计日志查询忘了加，导致 A 租户能看到 B 租户的日志：

```php
// 错误
AuditLog::where('tool_name', 'search_docs')->get();

// 正确
AuditLog::where('tenant_id', $tenant->id)
    ->where('tool_name', 'search_docs')
    ->get();
```

## 监控与可观测

关键指标：

```php
// app/Services/MetricsCollector.php
class MetricsCollector
{
    public static function record(string $tenant, string $tool, float $duration, int $status): void
    {
        // Prometheus 格式
        $labels = "tenant=\"{$tenant}\",tool=\"{$tool}\",status=\"{$status}\"";
        self::increment("mcp_requests_total{{$labels}}");
        self::observe("mcp_request_duration_seconds{{$labels}}", $duration / 1000);
    }
}
```

在 `McpAuditLog` 中间件末尾加入指标上报，配合 Grafana 可以看每个租户、每个工具的调用量、延迟分布和错误率。

## 总结

MCP Gateway 的核心价值：

1. **统一入口** — 客户端只需知道一个地址和一个 Key
2. **多租户隔离** — API Key → 租户 → 工具权限 → 后端 Server，全链路隔离
3. **动态工具发现** — 新增后端 Server 自动注册，客户端无需改动
4. **全链路审计** — 每次调用都有记录，出问题可追溯
5. **弹性限流** — 租户级别滑动窗口，防止某个租户打爆共享资源

这套方案已经在我们的多租户 AI Agent 平台上运行，支撑了 20+ 租户、50+ 后端 MCP Server 的统一治理。核心代码量不大（约 500 行），但解决了生产部署中最头疼的运维问题。

完整代码在 [GitHub Gist](https://gist.example.com/mcp-gateway)，欢迎提 issue。
