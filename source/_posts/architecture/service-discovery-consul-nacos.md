---

title: 服务注册与发现实战-Consul-Nacos-与-Laravel-集成-微服务动态路由与健康检查踩坑记录
keywords: [Consul, Nacos, Laravel, 服务注册与发现实战, 微服务动态路由与健康检查踩坑记录]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 19:55:58
updated: 2026-05-16 19:59:09
categories:
- architecture
tags:
- Laravel
- 微服务
- 服务发现
- Consul
- nacos
- 监控
description: 从单体 Laravel 演进到微服务后，硬编码服务地址成了最大运维痛点。本文以 Consul 和 Nacos 为主线，结合 KKday B2C 真实场景，深入对比两者在健康检查机制、实例摘除速度、配置管理能力、多语言生态支持、云原生容器集成等核心维度的差异，并手把手教你实现 Laravel 服务注册与动态发现、加权随机负载均衡、优雅停机注销、本地开发联调等完整方案，附带七个生产环境踩坑记录与可直接运行的代码示例，帮你避开微服务架构中服务治理最常见的陷阱。
---




# 服务注册与发现实战：Consul/Nacos 与 Laravel 集成

## 为什么需要服务注册与发现？

当 Laravel 单体应用拆成多个微服务后，第一个被"硬编码"坑到的问题就是：**服务地址写死在 `.env` 里**。

```
❌ 硬编码服务地址的典型 .env

SEARCH_SERVICE_URL=http://10.0.1.11:8080
RECOMMEND_SERVICE_URL=http://10.0.1.12:8080
MEMBER_SERVICE_URL=http://10.0.1.13:8080
PAYMENT_SERVICE_URL=http://10.0.1.14:8080
```

这在开发阶段没问题，但一旦进入生产环境：

- 某个服务实例挂了，调用方还在往死掉的 IP 发请求
- 扩容了新实例，运维要改 N 个 `.env` 再重启 N 个服务
- 灰度发布时，需要把部分流量导到新版本，根本做不到
- 本地开发联调时，每个人的 IP 不一样，配置冲突

**服务注册与发现**解决的核心问题：服务启动时自动注册自己的地址，调用方通过名字查找可用实例，而不是硬编码 IP。

```
✅ 服务注册与发现架构

  ┌──────────────────────────────────────────────────┐
  │              Service Registry (Consul/Nacos)      │
  │  ┌─────────┬─────────┬─────────┬─────────┐       │
  │  │search:1 │search:2 │member:1 │pay:1    │       │
  │  │10.0.1.11│10.0.1.21│10.0.1.13│10.0.1.14│       │
  │  │healthy  │healthy  │healthy  │healthy  │       │
  │  └─────────┴─────────┴─────────┴─────────┘       │
  └──────────┬───────────────────────┬────────────────┘
             │ 查询可用实例           │ 注册 + 心跳
    ┌────────▼────────┐     ┌────────▼────────┐
    │   BFF (Laravel) │     │  Search Service │
    │   调用方         │     │  被调用方        │
    │   通过服务名查找  │     │  启动时注册      │
    └─────────────────┘     └─────────────────┘
```

## 选型：Consul vs Nacos vs etcd

在 KKday 的微服务演进中，我们评估过三个主流方案：

```
┌──────────┬──────────┬──────────┬──────────┐
│ 维度      │ Consul   │ Nacos    │ etcd     │
├──────────┼──────────┼──────────┼──────────┤
│ 语言      │ Go       │ Java     │ Go       │
│ 一致性    │ CP (Raft)│ AP+CP    │ CP (Raft)│
│ 配置中心  │ KV Store │ 内置      │ KV Store │
│ 健康检查  │ 多种模式  │ TCP/HTTP │ 需自建   │
│ 多数据中心│ 原生支持  │ 需改造   │ 不支持   │
│ 社区活跃  │ 高       │ 高（阿里）│ 高       │
│ 学习曲线  │ 中       │ 低       │ 高       │
│ PHP 生态  │ 好       │ 一般     │ 差       │
└──────────┴──────────┴──────────┴──────────┘
```

**我们的选择逻辑**：

- 如果团队以 Java/Go 为主，且需要配置中心一体化 → **Nacos**
- 如果需要多数据中心、服务网格集成 → **Consul**
- 如果已有 etcd（K8s 集群），只想轻量注册 → **etcd + 自建**

KKday 最终选了 **Consul**，原因：多机房部署 + 与 K8s 服务网格共存 + PHP 生态支持好。

## Consul 集成实战

### 1. Consul Server 部署

```yaml
# docker-compose.consul.yml
version: '3.8'
services:
  consul-server:
    image: hashicorp/consul:1.19
    container_name: consul-server
    ports:
      - "8500:8500"   # HTTP API + Web UI
      - "8600:8600/udp" # DNS 接口
    command: >
      agent -server -bootstrap-expect=1
      -ui -client=0.0.0.0
      -datacenter=dc1
      -data-dir=/consul/data
    volumes:
      - consul-data:/consul/data
    restart: unless-stopped

volumes:
  consul-data:
```

启动后访问 `http://localhost:8500` 即可看到 Consul Web UI。

### 2. Laravel 服务注册（被调用方）

服务启动时，向 Consul 注册自己：

```php
<?php
// app/Services/Registry/ConsulRegistrar.php

namespace App\Services\Registry;

use GuzzleHttp\Client;

class ConsulRegistrar
{
    private Client $client;
    private string $serviceId;
    private string $consulUrl;

    public function __construct()
    {
        $this->consulUrl = config('services.consul.url', 'http://127.0.0.1:8500');
        $this->client = new Client(['base_uri' => $this->consulUrl]);
    }

    /**
     * 注册服务到 Consul
     */
    public function register(string $serviceName, string $address, int $port, array $meta = []): void
    {
        $this->serviceId = "{$serviceName}-{$address}-{$port}";

        $this->client->put('/v1/agent/service/register', [
            'json' => [
                'ID'    => $this->serviceId,
                'Name'  => $serviceName,
                'Address' => $address,
                'Port'  => $port,
                'Meta'  => $meta,
                'Tags'  => ['v1', 'laravel', env('APP_ENV')],
                'Check' => [
                    'HTTP'     => "http://{$address}:{$port}/health",
                    'Interval' => '10s',
                    'Timeout'  => '3s',
                    'DeregisterCriticalServiceAfter' => '60s',
                ],
            ],
        ]);

        info("[Consul] Registered service: {$this->serviceId}");
    }

    /**
     * 注销服务（优雅停机时调用）
     */
    public function deregister(): void
    {
        if ($this->serviceId) {
            $this->client->put("/v1/agent/service/deregister/{$this->serviceId}");
            info("[Consul] Deregistered service: {$this->serviceId}");
        }
    }
}
```

在 `AppServiceProvider` 中注册：

```php
<?php
// app/Providers/AppServiceProvider.php

use App\Services\Registry\ConsulRegistrar;

public function boot(): void
{
    $registrar = app(ConsulRegistrar::class);

    // 服务启动时注册
    $registrar->register(
        serviceName: 'order-service',
        address: gethostname(),
        port: (int) config('app.port', 8080),
        meta: ['version' => '1.2.0', 'region' => 'ap-southeast']
    );

    // 优雅停机时注销
    register_shutdown_function(fn () => $registrar->deregister());
}
```

### 3. 健康检查端点

Consul 会定期请求 `/health` 端点，判断实例是否健康：

```php
<?php
// routes/api.php

Route::get('/health', function () {
    $checks = [];

    // 检查数据库连接
    try {
        DB::connection()->getPdo();
        $checks['database'] = 'ok';
    } catch (\Exception $e) {
        $checks['database'] = 'fail';
        report($e);
    }

    // 检查 Redis 连接
    try {
        Redis::ping();
        $checks['redis'] = 'ok';
    } catch (\Exception $e) {
        $checks['redis'] = 'fail';
    }

    // 检查队列是否积压
    $pendingJobs = DB::table('jobs')->count();
    $checks['queue_pending'] = $pendingJobs;

    $healthy = !in_array('fail', $checks) && $pendingJobs < 1000;

    return response()->json([
        'status'  => $healthy ? 'healthy' : 'degraded',
        'checks'  => $checks,
        'uptime'  => microtime(true) - LARAVEL_START,
    ], $healthy ? 200 : 503);
});
```

**踩坑 1：健康检查返回 200 但服务实际上不可用**

早期我们只检查了数据库连接，结果队列积压了 5000+ 任务，Consul 仍然认为服务"健康"。**教训：健康检查必须覆盖关键依赖的可用性，而不只是进程存活。**

### 4. 动态服务发现（调用方）

这是核心：调用方通过服务名从 Consul 获取可用实例列表，然后做负载均衡。

```php
<?php
// app/Services/Registry/ConsulDiscovery.php

namespace App\Services\Registry;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;

class ConsulDiscovery
{
    private Client $client;
    private string $consulUrl;

    public function __construct()
    {
        $this->consulUrl = config('services.consul.url', 'http://127.0.0.1:8500');
        $this->client = new Client(['base_uri' => $this->consulUrl]);
    }

    /**
     * 获取健康的服务实例列表
     */
    public function getHealthyInstances(string $serviceName, string $tag = null): array
    {
        $cacheKey = "consul:instances:{$serviceName}";

        // 缓存 5 秒，避免每次请求都查 Consul
        return Cache::store('file')->remember($cacheKey, 5, function () use ($serviceName, $tag) {
            $params = ['passing' => 'true'];
            if ($tag) {
                $params['tag'] = $tag;
            }

            $response = $this->client->get("/v1/health/service/{$serviceName}", [
                'query' => $params,
            ]);

            $services = json_decode($response->getBody()->getContents(), true);

            return array_map(fn ($svc) => [
                'id'      => $svc['Service']['ID'],
                'address' => $svc['Service']['Address'] ?: $svc['Node']['Address'],
                'port'    => $svc['Service']['Port'],
                'meta'    => $svc['Service']['Meta'] ?? [],
                'tags'    => $svc['Service']['Tags'] ?? [],
            ], $services);
        });
    }

    /**
     * 选择一个实例（加权随机 + 本地性优先）
     */
    public function selectInstance(string $serviceName): ?array
    {
        $instances = $this->getHealthyInstances($serviceName);

        if (empty($instances)) {
            return null;
        }

        // 优先选择同机房实例（通过 meta.region 判断）
        $localRegion = config('services.consul.region', 'ap-southeast');
        $sameRegion = array_filter($instances, fn ($i) => ($i['meta']['region'] ?? '') === $localRegion);

        $pool = !empty($sameRegion) ? array_values($sameRegion) : $instances;

        // 加权随机（未来可接入权重配置）
        return $pool[array_rand($pool)];
    }

    /**
     * 构建完整的服务 URL
     */
    public function resolve(string $serviceName, string $path = ''): string
    {
        $instance = $this->selectInstance($serviceName);

        if (!$instance) {
            throw new \RuntimeException("No healthy instance found for service: {$serviceName}");
        }

        return "http://{$instance['address']}:{$instance['port']}{$path}";
    }
}
```

### 5. 与 Laravel HTTP Client 集成

```php
<?php
// app/Services/Registry/ServiceHttpClient.php

namespace App\Services\Registry;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\PendingRequest;

class ServiceHttpClient
{
    public function __construct(
        private ConsulDiscovery $discovery,
        private int $maxRetries = 3,
    ) {}

    /**
     * 发起服务间调用，自带服务发现 + 重试
     */
    public function call(string $serviceName, string $method, string $path, array $options = []): \Illuminate\Http\Client\Response
    {
        $lastException = null;

        for ($attempt = 1; $attempt <= $this->maxRetries; $attempt++) {
            try {
                $url = $this->discovery->resolve($serviceName, $path);

                $request = Http::timeout(5)
                    ->withHeaders([
                        'X-Request-ID'  => request()->header('X-Request-ID', uniqid()),
                        'X-Trace-ID'    => request()->header('X-Trace-ID', ''),
                        'X-Caller'      => config('app.name'),
                    ]);

                $response = match (strtoupper($method)) {
                    'GET'    => $request->get($url, $options['query'] ?? []),
                    'POST'   => $request->post($url, $options['json'] ?? []),
                    'PUT'    => $request->put($url, $options['json'] ?? []),
                    'DELETE' => $request->delete($url, $options['query'] ?? []),
                    default  => throw new \InvalidArgumentException("Unsupported method: {$method}"),
                };

                return $response;

            } catch (\Exception $e) {
                $lastException = $e;
                logger()->warning("[ServiceClient] Attempt {$attempt} failed for {$serviceName}", [
                    'error' => $e->getMessage(),
                    'path'  => $path,
                ]);

                // 清除该服务的缓存，下次请求会重新发现
                cache()->forget("consul:instances:{$serviceName}");

                if ($attempt < $this->maxRetries) {
                    usleep($attempt * 200000); // 200ms, 400ms, 600ms
                }
            }
        }

        throw new \RuntimeException(
            "Service call failed after {$this->maxRetries} attempts: {$serviceName}",
            0,
            $lastException
        );
    }
}
```

在 Service Provider 中绑定：

```php
<?php
// app/Providers/AppServiceProvider.php

use App\Services\Registry\ConsulDiscovery;
use App\Services\Registry\ServiceHttpClient;

$this->app->singleton(ConsulDiscovery::class);
$this->app->singleton(ServiceHttpClient::class);
```

使用示例：

```php
<?php
// 在 Controller 或 Service 中使用

class OrderService
{
    public function __construct(
        private ServiceHttpClient $http,
    ) {}

    public function createOrder(array $data): array
    {
        // 动态发现 search-service，自动负载均衡
        $recommendations = $this->http->call(
            'recommend-service',
            'POST',
            '/api/v1/recommendations',
            ['json' => ['user_id' => $data['user_id'], 'category' => $data['category']]]
        )->json();

        // 动态发现 member-service
        $member = $this->http->call(
            'member-service',
            'GET',
            "/api/v1/members/{$data['user_id']}"
        )->json();

        // ... 创建订单逻辑
    }
}
```

## Consul Watch：实时感知服务变更

如果不想每次请求都轮询 Consul，可以使用 **Blocking Query**（长轮询）机制：

```php
<?php
// app/Services/Registry/ConsulWatcher.php

namespace App\Services\Registry;

use GuzzleHttp\Client;

class ConsulWatcher
{
    private array $lastIndex = [];

    /**
     * Blocking Query - 长轮询，仅在数据变更时返回
     * 比短轮询更高效，Consul 用 index 机制实现
     */
    public function watch(string $serviceName, callable $callback): void
    {
        $client = new Client([
            'base_uri' => config('services.consul.url'),
            'timeout'  => 300, // 5 分钟超时
        ]);

        while (true) {
            $params = ['passing' => 'true'];
            if (isset($this->lastIndex[$serviceName])) {
                $params['index'] = $this->lastIndex[$serviceName];
                $params['wait'] = '5m';
            }

            try {
                $response = $client->get("/v1/health/service/{$serviceName}", [
                    'query' => $params,
                ]);

                $newIndex = (int) $response->getHeader('X-Consul-Index')[0] ?? 0;

                if (!isset($this->lastIndex[$serviceName]) || $newIndex > $this->lastIndex[$serviceName]) {
                    $this->lastIndex[$serviceName] = $newIndex;
                    $services = json_decode($response->getBody()->getContents(), true);
                    $callback($serviceName, $services);
                }
            } catch (\Exception $e) {
                logger()->error("[ConsulWatcher] Watch failed for {$serviceName}", [
                    'error' => $e->getMessage(),
                ]);
                sleep(5); // 出错后等待重试
            }
        }
    }
}
```

**踩坑 2：Consul Blocking Query 在 PHP-FPM 中无法使用**

Blocking Query 需要长连接，而 PHP-FPM 每个请求处理完就销毁。上面的 `ConsulWatcher` 只能在 **Laravel Queue Worker** 或 **Swoole/Octane** 环境中运行。在 PHP-FPM 下，只能用前面的短轮询缓存方案。

## Nacos 集成实战

如果团队选择 Nacos，PHP 集成方式略有不同。Nacos 官方没有 PHP SDK，但社区有 `casbin/php-nacos` 包。

### 安装与配置

```bash
composer require casbin/php-nacos
```

```php
<?php
// config/services.php
'nacos' => [
    'url'       => env('NACOS_URL', 'http://127.0.0.1:8848'),
    'namespace' => env('NACOS_NAMESPACE', 'public'),
    'group'     => env('NACOS_GROUP', 'DEFAULT_GROUP'),
],
```

### 服务注册

```php
<?php
// app/Services/Registry/NacosRegistrar.php

namespace App\Services\Registry;

use GuzzleHttp\Client;

class NacosRegistrar
{
    private Client $client;
    private string $serviceName;
    private string $clusterName;

    public function __construct()
    {
        $this->client = new Client([
            'base_uri' => config('services.nacos.url'),
        ]);
        $this->clusterName = config('services.nacos.group', 'DEFAULT_GROUP');
    }

    /**
     * 注册服务实例到 Nacos
     */
    public function register(
        string $serviceName,
        string $ip,
        int $port,
        float $weight = 1.0,
        array $metadata = []
    ): void {
        $this->serviceName = $serviceName;

        $this->client->post('/nacos/v1/ns/instance', [
            'form_params' => [
                'serviceName' => $serviceName,
                'ip'          => $ip,
                'port'        => $port,
                'weight'      => $weight,
                'enabled'     => 'true',
                'healthy'     => 'true',
                'metadata'    => json_encode($metadata),
                'groupName'   => $this->clusterName,
                'namespaceId' => config('services.nacos.namespace'),
                'ephemeral'   => 'true', // 临时实例，不发送心跳就自动删除
            ],
        ]);

        info("[Nacos] Registered: {$serviceName}@{$ip}:{$port}");
    }

    /**
     * 发送心跳
     * Nacos 临时实例需要定期发送心跳，否则会被标记为不健康
     */
    public function heartbeat(string $serviceName, string $ip, int $port): void
    {
        $this->client->put('/nacos/v1/ns/instance/beat', [
            'query' => [
                'serviceName' => $serviceName,
                'ip'          => $ip,
                'port'        => $port,
                'groupName'   => $this->clusterName,
                'namespaceId' => config('services.nacos.namespace'),
            ],
        ]);
    }

    /**
     * 获取健康实例列表
     */
    public function getHealthyInstances(string $serviceName): array
    {
        $response = $this->client->get('/nacos/v1/ns/instance/list', [
            'query' => [
                'serviceName' => $serviceName,
                'healthyOnly' => 'true',
                'groupName'   => $this->clusterName,
                'namespaceId' => config('services.nacos.namespace'),
            ],
        ]);

        $data = json_decode($response->getBody()->getContents(), true);

        return $data['hosts'] ?? [];
    }

    /**
     * 发送心跳续约定时任务
     * 在 Laravel Scheduler 中注册即可
     */
    public function scheduleHeartbeat(string $serviceName, string $ip, int $port): void
    {
        // 临时实例默认 15 秒超时，建议 5 秒发一次心跳
        $this->heartbeat($serviceName, $ip, $port);
    }
}
```
**踩坑 3：Nacos 临时实例与持久实例的区别**

Nacos 有两种实例类型：
- **临时实例（ephemeral=true）**：需要客户端定期发送心跳，超时 15 秒未收到心跳就摘除。适合无状态服务。
- **持久实例（ephemeral=false）**：不依赖客户端心跳，由服务端主动健康检查。适合数据库等有状态服务。

**我们最初设成了持久实例**，结果服务停止后 Nacos 仍然保留实例信息长达 2 分钟（服务端探测周期），导致流量打到已死的实例上。改用临时实例后，15 秒内就自动摘除。

### Nacos 服务发现与 HTTP Client

与 Consul 方案类似，封装 Nacos 的动态发现 + 重试逻辑：

```php
<?php
// app/Services/Registry/NacosDiscovery.php

namespace App\Services\Registry;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class NacosDiscovery
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client([
            'base_uri' => config('services.nacos.url'),
        ]);
    }

    /**
     * 获取健康实例列表（带缓存）
     */
    public function getHealthyInstances(string $serviceName): array
    {
        $cacheKey = "nacos:instances:{$serviceName}";

        return Cache::store('file')->remember($cacheKey, 5, function () use ($serviceName) {
            $response = $this->client->get('/nacos/v1/ns/instance/list', [
                'query' => [
                    'serviceName' => $serviceName,
                    'healthyOnly' => 'true',
                    'groupName'   => config('services.nacos.group', 'DEFAULT_GROUP'),
                    'namespaceId' => config('services.nacos.namespace'),
                ],
            ]);

            $data = json_decode($response->getBody()->getContents(), true);
            $hosts = $data['hosts'] ?? [];

            return array_map(fn ($h) => [
                'ip'       => $h['ip'],
                'port'     => $h['port'],
                'weight'   => $h['weight'] ?? 1.0,
                'metadata' => $h['metadata'] ?? [],
            ], $hosts);
        });
    }

    /**
     * 加权随机选择实例（权重越高被选中概率越大）
     */
    public function selectInstance(string $serviceName): ?array
    {
        $instances = $this->getHealthyInstances($serviceName);
        if (empty($instances)) {
            return null;
        }

        // 加权随机
        $totalWeight = array_sum(array_column($instances, 'weight'));
        $rand = mt_rand(1, (int) ($totalWeight * 100)) / 100;
        $cumulative = 0;

        foreach ($instances as $instance) {
            $cumulative += $instance['weight'];
            if ($rand <= $cumulative) {
                return $instance;
            }
        }

        return end($instances);
    }

    /**
     * 构建完整的服务 URL
     */
    public function resolve(string $serviceName, string $path = ''): string
    {
        $instance = $this->selectInstance($serviceName);
        if (!$instance) {
            throw new \RuntimeException("No healthy Nacos instance for: {$serviceName}");
        }

        return "http://{$instance['ip']}:{$instance['port']}{$path}";
    }

    /**
     * 发起服务调用（自带重试 + 缓存清除）
     */
    public function call(string $serviceName, string $method, string $path, array $options = [], int $maxRetries = 3): \Illuminate\Http\Client\Response
    {
        $lastException = null;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                $url = $this->resolve($serviceName, $path);
                $request = Http::timeout(5)
                    ->withHeaders([
                        'X-Request-ID' => request()->header('X-Request-ID', uniqid()),
                        'X-Caller'     => config('app.name'),
                    ]);

                return match (strtoupper($method)) {
                    'GET'    => $request->get($url, $options['query'] ?? []),
                    'POST'   => $request->post($url, $options['json'] ?? []),
                    'PUT'    => $request->put($url, $options['json'] ?? []),
                    'DELETE' => $request->delete($url, $options['query'] ?? []),
                    default  => throw new \InvalidArgumentException("Unsupported method: {$method}"),
                };
            } catch (\Exception $e) {
                $lastException = $e;
                cache()->forget("nacos:instances:{$serviceName}");
                logger()->warning("[NacosClient] Attempt {$attempt} failed for {$serviceName}", [
                    'error' => $e->getMessage(),
                ]);
                if ($attempt < $maxRetries) {
                    usleep($attempt * 200000);
                }
            }
        }

        throw new \RuntimeException("Nacos call failed after {$maxRetries} attempts: {$serviceName}", 0, $lastException);
    }
}
```

在 Laravel Scheduler 中注册心跳：

```php
<?php
// app/Console/Kernel.php

protected function schedule(Schedule $schedule): void
{
    // Nacos 心跳续期（每 5 秒）
    $schedule->call(function () {
        app(NacosRegistrar::class)->heartbeat(
            config('app.name'),
            gethostname(),
            (int) config('app.port', 8080)
        );
    })->everyFiveSeconds()->withoutOverlapping();
}
```

## 踩坑记录汇总

### 踩坑 4：服务启动顺序导致注册失败

在 Docker Compose 中，如果 Consul Server 还没启动完成，Laravel 就尝试注册服务，会抛出连接异常。

**解决方案：**

```php
<?php
// app/Services/Registry/ConsulRegistrar.php

public function register(string $serviceName, string $address, int $port, array $meta = []): void
{
    $maxRetries = 10;
    $retryDelay = 2; // 秒

    for ($i = 1; $i <= $maxRetries; $i++) {
        try {
            $this->doRegister($serviceName, $address, $port, $meta);
            return;
        } catch (\Exception $e) {
            if ($i === $maxRetries) {
                throw $e;
            }
            logger()->warning("[Consul] Register failed, retrying ({$i}/{$maxRetries})...");
            sleep($retryDelay);
        }
    }
}
```

或者用 Docker Compose 的 `depends_on` + healthcheck：

```yaml
services:
  laravel-app:
    depends_on:
      consul-server:
        condition: service_healthy
  consul-server:
    healthcheck:
      test: ["CMD", "consul", "members"]
      interval: 5s
      timeout: 3s
      retries: 10
```

### 踩坑 5：Consul 健康检查被反向代理阻断

如果 Laravel 前面有 Nginx 反向代理，Consul 直接访问容器 IP 的 `/health` 端点可能被 Nginx 的超时配置影响。

**解决方案：** 健康检查绕过 Nginx，直接请求 PHP-FPM 监听端口：

```json
{
  "Check": {
    "TCP": "10.0.1.11:9000",
    "Interval": "10s",
    "Timeout": "3s"
  }
}
```

或者让 Consul 检查容器内部的 HTTP 端口（不经过 Nginx）。

### 踩坑 6：服务缓存导致故障恢复延迟

前面的 `ConsulDiscovery` 用了 5 秒缓存。这意味着一个实例从不健康到被摘除，最多有 5 秒的延迟。在这 5 秒内，请求仍然会打到已死的实例。

**优化方案：缓存 + 主动探测**

```php
<?php
// app/Services/Registry/ServiceHttpClient.php

public function call(string $serviceName, string $method, string $path, array $options = []): \Illuminate\Http\Client\Response
{
    $lastException = null;

    for ($attempt = 1; $attempt <= $this->maxRetries; $attempt++) {
        try {
            $url = $this->discovery->resolve($serviceName, $path);
            $response = $this->doRequest($method, $url, $options);
            return $response;
        } catch (\Exception $e) {
            $lastException = $e;

            // 关键：失败后立即清除该服务的缓存
            cache()->forget("consul:instances:{$serviceName}");

            logger()->warning("[ServiceClient] Attempt {$attempt} failed", [
                'service' => $serviceName,
                'error'   => $e->getMessage(),
            ]);

            if ($attempt < $this->maxRetries) {
                usleep($attempt * 200000);
            }
        }
    }

    throw new \RuntimeException("Service call failed after {$this->maxRetries} attempts: {$serviceName}", 0, $lastException);
}
```

### 踩坑 7：本地开发环境的 Consul 连通问题

本地开发时，Docker 容器内的服务注册到 Consul 的地址是容器 IP（如 `172.17.0.x`），但宿主机上跑的 Laravel 无法直接访问这个地址。

**解决方案：**

```php
<?php
// config/services.php
'consul' => [
    'url' => env('CONSUL_URL', 'http://127.0.0.1:8500'),
    // 本地开发时覆盖注册地址
    'register_address' => env('CONSUL_REGISTER_ADDRESS', gethostname()),
    'region' => env('CONSUL_REGION', 'ap-southeast'),
],
```

```env
# .env.local
CONSUL_URL=http://127.0.0.1:8500
CONSUL_REGISTER_ADDRESS=host.docker.internal
```

## Consul vs Nacos：生产环境对比

在 KKday 的实际使用中，两者的差异：

```
┌─────────────────┬──────────────────┬──────────────────┐
│ 场景             │ Consul 表现       │ Nacos 表现        │
├─────────────────┼──────────────────┼──────────────────┤
│ 实例摘除速度     │ ~10s（健康检查间隔）│ ~5s（心跳间隔）    │
│ 配置管理         │ KV Store，手动管理 │ 内置配置中心，支持灰度│
│ 多语言支持       │ HTTP API 通用     │ Java SDK 优先     │
│ Web UI          │ 简洁但功能有限     │ 功能丰富（监控/权限）│
│ K8s 集成        │ 天然适配（Service Mesh）│ 需额外适配      │
│ PHP 集成难度     │ 低（纯 HTTP）      │ 中（缺官方 SDK）   │
│ 大规模场景       │ 经过 HashiCorp 验证│ 阿里生产验证       │
└─────────────────┴──────────────────┴──────────────────┘
```

**建议**：
- **K8s + 服务网格** 场景 → Consul
- **需要配置中心一体化** → Nacos
- **纯 PHP 栈，不想引入 Java 组件** → Consul

## 总结

服务注册与发现不是银弹，它引入了新的基础设施依赖。但在以下场景，它的收益远大于成本：

1. **服务实例数 > 5 个**，手动管理地址不现实
2. **需要灰度发布 / 金丝雀部署**，必须动态路由
3. **多机房 / 多区域部署**，需要就近访问
4. **服务频繁扩缩容**，地址动态变化

**核心经验**：
- 健康检查必须覆盖关键依赖，不能只检查进程存活
- 缓存服务列表是必须的，但失败后要立即清除缓存
- 优雅停机时必须注销服务，否则会有一段时间的"幽灵实例"
- 本地开发环境需要特殊处理地址映射问题
- PHP-FPM 下无法使用长轮询，只能用短轮询 + 缓存方案

---

## 相关阅读

- [API Gateway 实战：Kong/APISIX 在 Laravel 微服务中的应用——统一鉴权、限流、路由与灰度发布踩坑记录](/architecture/api-gateway-guide-kong-apisix-laravel-microservices-rate-limitingcanary)
- [微服务拆分策略：从单体 Laravel 到微服务的渐进式演进踩坑记录](/architecture/microservices-laravelmicroservices)
- [配置中心实战：Apollo/Nacos 动态配置与 Laravel 集成——热更新与多环境治理踩坑记录](/architecture/config-center-apollo-nacos)
- [分布式事务实战：Saga 模式在订单/库存/支付中的应用——Laravel B2C API 踩坑记录](/architecture/distributedtransactionguide-saga)
- [链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用](/architecture/distributed-tracing-jaeger-skywalking)
