---

title: 多区域部署实战：全球化 Laravel 应用——数据库同步、CDN 边缘缓存与跨区域一致性
date: 2026-06-02 00:00:00
tags:
- 多区域部署
- Laravel
- CDN
- 数据库
- 全球化
- 边缘缓存
categories:
  - devops
keywords: [Laravel, CDN, 多区域部署实战, 全球化, 应用, 数据库同步, 边缘缓存与跨区域一致性]
description: 全球化 Laravel 应用多区域部署实战指南，系统覆盖 Active-Active/Active-Passive/混合模式三种架构选型、MySQL GTID 跨区域主从复制与 TiDB 分布式数据库方案、CloudFront/Cloudflare Workers 边缘缓存与 Vary 头策略、写后读一致性与最终一致性事件同步、LWW/字段级合并冲突解决、DynamoDB 跨区域分布式锁、JWT 无状态 Session 与 Redis CRDT 缓存同步、GDPR 数据驻留与合规导出。附 Terraform 多区域 IaC 部署流程与健康检查故障转移方案，适合 B2C 电商出海团队从单区域平滑演进到全球多区域部署参考。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




# 多区域部署实战：全球化 Laravel 应用——数据库同步、CDN 边缘缓存与跨区域一致性

## 前言

当你的 B2C 电商平台从单一区域扩展到全球市场时，用户在东京访问部署在弗吉尼亚的 API 会面临 150ms+ 的额外延迟。多区域部署不是简单地"在多个地方部署代码"——它涉及数据库同步、缓存一致性、Session 管理、合规性等系统性挑战。

本文将从架构设计到落地实施，完整覆盖 Laravel 应用多区域部署的方方面面。

---

## 一、多区域架构模式

### 1.1 Active-Active（双活）

所有区域同时处理读写请求，数据双向同步。

```
┌─────────────┐         ┌─────────────┐
│  US-East    │◄───────►│  AP-Tokyo   │
│  (Primary)  │  双向同步  │  (Secondary) │
│  MySQL Primary│        │  MySQL Replica│
└──────┬──────┘         └──────┬──────┘
       │                       │
  ┌────┴────┐             ┌────┴────┐
  │ 用户群A  │             │ 用户群B  │
  └─────────┘             └─────────┘
```

**优点**：低延迟、高可用、就近处理  
**缺点**：数据冲突解决复杂、运维成本高

### 1.2 Active-Passive（主备）

一个区域处理所有写入，其他区域只读。

```
┌─────────────┐         ┌─────────────┐
│  US-East    │────────►│  AP-Tokyo   │
│  (Active)   │  单向复制  │  (Passive)  │
│  读 + 写     │         │  只读        │
└──────┬──────┘         └──────┬──────┘
       │                       │
  ┌────┴────┐             ┌────┴────┐
  │ 全球用户  │             │ 亚洲用户  │
  │ (写请求)  │             │ (读请求)  │
  └─────────┘             └─────────┘
```

**优点**：架构简单、无数据冲突  
**缺点**：写入延迟无法优化、跨区域写入瓶颈

### 1.3 混合模式（推荐）

核心写操作路由到主区域，读操作和特定功能就近处理：

```php
// app/Services/DatabaseRouter.php
class DatabaseRouter
{
    // 写操作路由到主区域
    public function getWriteConnection(): string
    {
        return config('database.default'); // us-east primary
    }

    // 读操作路由到最近的副本
    public function getReadConnection(): string
    {
        $region = $this->detectUserRegion();

        return match ($region) {
            'asia' => 'mysql_tokyo',
            'europe' => 'mysql_frankfurt',
            default => 'mysql_us_east',
        };
    }

    protected function detectUserRegion(): string
    {
        // 从请求头、IP 地理定位或 Cookie 判断用户区域
        $country = request()->header('CloudFront-Viewer-Country',
            geoip()->getLocation(request()->ip())->country);

        return match (true) {
            in_array($country, ['JP', 'KR', 'CN', 'TW', 'SG', 'TH']) => 'asia',
            in_array($country, ['DE', 'FR', 'GB', 'NL', 'IT']) => 'europe',
            default => 'us',
        };
    }
}
```

---

## 二、数据库同步策略

### 2.1 MySQL 跨区域主从复制

**异步复制（推荐用于跨区域）**

```ini
# my.cnf - 主库 (US-East)
[mysqld]
server-id = 1
log-bin = mysql-bin
binlog-format = ROW
binlog-row-image = FULL
sync-binlog = 1
innodb_flush_log_at_trx_commit = 1

# GTID 模式（推荐）
gtid-mode = ON
enforce-gtid-consistency = ON

# 半同步复制（同区域副本使用）
rpl_semi_sync_master_enabled = 1
rpl_semi_sync_master_timeout = 1000
```

```ini
# my.cnf - 从库 (AP-Tokyo)
[mysqld]
server-id = 2
relay-log = relay-bin
log-slave-updates = ON
read-only = ON
super-read-only = ON

gtid-mode = ON
enforce-gtid-consistency = ON
```

```sql
-- 在从库上配置复制
CHANGE MASTER TO
    MASTER_HOST = 'us-east-primary.db.internal',
    MASTER_PORT = 3306,
    MASTER_USER = 'replication_user',
    MASTER_PASSWORD = 'secure_password',
    MASTER_AUTO_POSITION = 1;

START SLAVE;
SHOW SLAVE STATUS\G
```

### 2.2 Laravel 数据库多区域配置

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'sticky' => true,  // 本次请求内写后读一致
    'read' => [
        'host' => [
            env('DB_READ_HOST_1', '10.0.1.10'),  // US-East 从库
            env('DB_READ_HOST_2', '10.0.2.10'),  // AP-Tokyo 从库
        ],
    ],
    'write' => [
        'host' => [
            env('DB_WRITE_HOST', '10.0.0.10'),   // US-East 主库
        ],
    ],
    'database' => env('DB_DATABASE', 'forge'),
    'username' => env('DB_USERNAME', 'forge'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
],

// 区域专属数据库连接
'mysql_tokyo' => [
    'driver' => 'mysql',
    'host' => env('DB_TOKYO_HOST', '10.0.2.10'),
    'port' => env('DB_TOKYO_PORT', '3306'),
    'database' => env('DB_DATABASE', 'forge'),
    'username' => env('DB_TOKYO_USERNAME', 'forge'),
    'password' => env('DB_TOKYO_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'read_only' => true,
],

'mysql_frankfurt' => [
    'driver' => 'mysql',
    'host' => env('DB_FRANKFURT_HOST', '10.0.3.10'),
    'read_only' => true,
    // ...
],
```

### 2.3 区域感知的查询构建器

```php
// app/Models/Concerns/RegionAware.php
trait RegionAware
{
    public function scopeNearestRegion(Builder $query): Builder
    {
        $connection = app(DatabaseRouter::class)->getReadConnection();
        return $query->on($connection);
    }

    public function scopeWritable(Builder $query): Builder
    {
        return $query->on(config('database.default'));
    }
}

// 使用
class Product extends Model
{
    use RegionAware;
}

// 就近读取
$products = Product::nearestRegion()->where('category_id', 5)->get();

// 写入到主库
$product = Product::writable()->findOrFail($id);
$product->update(['stock' => $product->stock - 1]);
```

### 2.4 CockroachDB / TiDB 分布式数据库方案

对于真正的多主需求，考虑分布式 SQL 数据库：

```php
// TiDB 配置 - MySQL 兼容的分布式数据库
'tidb' => [
    'driver' => 'mysql',
    'host' => env('TIDB_HOST', 'tidb-lb.internal'),
    'port' => env('TIDB_PORT', 4000),
    'database' => env('TIDB_DATABASE', 'forge'),
    'username' => env('TIDB_USERNAME', 'root'),
    'password' => env('TIDB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'options' => [
        // TiDB 特有优化
        PDO::ATTR_EMULATE_PREPARES => false,
    ],
],
```

---

## 三、CDN 边缘缓存策略

### 3.1 CloudFront 多区域分发

```json
{
    "Origins": [
        {
            "Id": "us-east-origin",
            "DomainName": "us-east.api.example.com",
            "CustomOriginConfig": {
                "HTTPSPort": 443,
                "OriginProtocolPolicy": "https-only"
            },
            "OriginPath": ""
        },
        {
            "Id": "ap-tokyo-origin",
            "DomainName": "tokyo.api.example.com",
            "CustomOriginConfig": {
                "HTTPSPort": 443,
                "OriginProtocolPolicy": "https-only"
            }
        }
    ],
    "DefaultCacheBehavior": {
        "TargetOriginId": "us-east-origin",
        "ViewerProtocolPolicy": "redirect-to-https",
        "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        "OriginRequestPolicyId": "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
    },
    "CacheBehaviors": [
        {
            "PathPattern": "/api/v1/products*",
            "TargetOriginId": "us-east-origin",
            "TTL": 300,
            "CachePolicyId": "api-cache-policy-id"
        },
        {
            "PathPattern": "/static/*",
            "TargetOriginId": "ap-tokyo-origin",
            "TTL": 86400,
            "Compress": true
        }
    ]
}
```

### 3.2 Laravel 响应缓存控制

```php
// app/Http/Middleware/CDNCacheControl.php
class CDNCacheControl
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // API 响应缓存策略
        $cacheConfig = $this->getCacheConfig($request);

        if ($cacheConfig['cacheable']) {
            $response->headers->set('Cache-Control',
                "public, max-age={$cacheConfig['max_age']}, s-maxage={$cacheConfig['s_maxage']}"
            );

            // Vary 头：根据用户区域返回不同缓存版本
            $response->headers->set('Vary', 'Accept-Language, Accept-Encoding');

            // Surrogate Key：用于精确清除 CDN 缓存
            if (isset($cacheConfig['surrogate_key'])) {
                $response->headers->set('Surrogate-Key', $cacheConfig['surrogate_key']);
            }
        }

        return $response;
    }

    protected function getCacheConfig(Request $request): array
    {
        $path = $request->path();

        return match (true) {
            str_starts_with($path, 'api/v1/products') => [
                'cacheable' => true,
                'max_age' => 60,
                's_maxage' => 300,
                'surrogate_key' => 'products',
            ],
            str_starts_with($path, 'api/v1/categories') => [
                'cacheable' => true,
                'max_age' => 60,
                's_maxage' => 3600,
                'surrogate_key' => 'categories',
            ],
            str_starts_with($path, 'api/v1/orders') => [
                'cacheable' => false,  // 订单数据不缓存
            ],
            default => ['cacheable' => false],
        };
    }
}
```

### 3.3 Cloudflare Workers 边缘计算

在边缘节点执行轻量逻辑，减少回源请求：

```javascript
// Cloudflare Worker: 边缘路由 + 缓存
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const region = request.cf?.country || 'US';

    // 根据区域选择源站
    const originMap = {
        'JP': 'tokyo.api.example.com',
        'KR': 'tokyo.api.example.com',
        'CN': 'tokyo.api.example.com',
        'DE': 'frankfurt.api.example.com',
        'FR': 'frankfurt.api.example.com',
        'GB': 'frankfurt.api.example.com',
    };

    // 静态资源从边缘缓存返回
    if (url.pathname.startsWith('/static/')) {
        const cache = caches.default;
        let response = await cache.match(request);
        if (response) {
            return response;
        }

        const origin = originMap[region] || 'us-east.api.example.com';
        url.hostname = origin;
        response = await fetch(url.toString(), request);

        // 缓存到边缘
        const cachedResponse = new Response(response.body, response);
        cachedResponse.headers.set('Cache-Control', 'public, max-age=86400');
        event.waitUntil(cache.put(request, cachedResponse.clone()));

        return cachedResponse;
    }

    // API 请求路由到最近源站
    const origin = originMap[region] || 'us-east.api.example.com';
    url.hostname = origin;

    return fetch(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });
}
```

### 3.4 全页缓存（FPC）多区域策略

```php
// app/Services/FullPageCache.php
class FullPageCache
{
    // 为不同区域生成不同的缓存键
    public function cacheKey(Request $request): string
    {
        $region = app()->make('current_region');
        $locale = $request->getPreferredLanguage(['zh', 'ja', 'en']);
        $currency = $this->getCurrencyForRegion($region);

        return md5("fpc:{$region}:{$locale}:{$currency}:{$request->fullUrl()}");
    }

    // 区域货币映射
    protected function getCurrencyForRegion(string $region): string
    {
        return match ($region) {
            'asia' => 'JPY',
            'europe' => 'EUR',
            default => 'USD',
        };
    }
}
```

---

## 四、跨区域一致性挑战

### 4.1 写后读一致性（Read-Your-Writes）

用户下单后立即查看订单列表，可能读到从库的旧数据：

```php
// app/Services/ConsistencyManager.php
class ConsistencyManager
{
    /**
     * 写后读一致性：写操作后，短时间内强制读主库
     */
    public function afterWrite(string $userId, int $ttlSeconds = 5): void
    {
        $key = "consistency:read-after-write:{$userId}";
        Cache::put($key, true, $ttlSeconds);
    }

    public function shouldReadFromPrimary(string $userId): bool
    {
        return Cache::has("consistency:read-after-write:{$userId}");
    }
}

// 在 Middleware 中应用
class ReadAfterWriteConsistency implements Middleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $userId = auth()->id();

        if ($userId && app(ConsistencyManager::class)->shouldReadFromPrimary($userId)) {
            // 强制本次请求使用主库
            config()->set('database.connections.mysql.read', [
                'host' => [config('database.connections.mysql.write.host')[0]]
            ]);
        }

        $response = $next($request);

        // POST/PUT/DELETE 后标记一致性窗口
        if (in_array($request->method(), ['POST', 'PUT', 'DELETE', 'PATCH']) && $userId) {
            app(ConsistencyManager::class)->afterWrite($userId);
        }

        return $response;
    }
}
```

### 4.2 最终一致性事件同步

跨区域使用事件驱动的最终一致性：

```php
// app/Events/OrderCreated.php
class OrderCreated
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly Order $order,
        public readonly string $originRegion,
    ) {}

    // 广播到所有区域
    public function broadcastOn(): array
    {
        return [
            new Channel('orders.global'),
        ];
    }
}

// app/Listeners/SyncOrderAcrossRegions.php
class SyncOrderAcrossRegions
{
    public function handle(OrderCreated $event): void
    {
        $payload = [
            'order_id' => $event->order->id,
            'user_id' => $event->order->user_id,
            'total' => $event->order->total,
            'status' => $event->order->status,
            'origin_region' => $event->originRegion,
            'timestamp' => now()->toISOString(),
        ];

        // 发布到跨区域消息队列
        // 使用 SNS/SQS 的跨区域订阅
        $this->publishToRegion('asia', $payload);
        $this->publishToRegion('europe', $payload);
    }

    protected function publishToRegion(string $region, array $payload): void
    {
        $topicArn = config("services.sns.topics.orders.{$region}");

        SnsClient::publish([
            'TopicArn' => $topicArn,
            'Message' => json_encode($payload),
            'MessageAttributes' => [
                'MessageType' => [
                    'DataType' => 'String',
                    'StringValue' => 'OrderCreated',
                ],
            ],
        ]);
    }
}
```

### 4.3 冲突解决策略

Active-Active 架构中，同一记录可能被不同区域同时修改：

```php
// app/Services/ConflictResolver.php
class ConflictResolver
{
    /**
     * Last-Writer-Wins (LWW) 策略
     * 使用向量时钟或时间戳判断
     */
    public function resolveLWW(
        array $localVersion,
        array $remoteVersion
    ): array {
        $localTime = Carbon::parse($localVersion['updated_at']);
        $remoteTime = Carbon::parse($remoteVersion['updated_at']);

        if ($remoteTime->gt($localTime)) {
            Log::info('冲突解决: 远程版本更新', [
                'local' => $localVersion,
                'remote' => $remoteVersion,
            ]);
            return $remoteVersion;
        }

        return $localVersion;
    }

    /**
     * 字段级合并策略
     * 不同字段的修改不冲突，可以合并
     */
    public function resolveFieldMerge(
        array $localVersion,
        array $remoteVersion,
        array $conflictFields
    ): array {
        $merged = $localVersion;

        foreach ($remoteVersion as $key => $value) {
            // 如果远程修改的字段不在冲突列表中，接受远程值
            if (!in_array($key, $conflictFields)) {
                $merged[$key] = $value;
            }
        }

        // 冲突字段记录到冲突日志，供人工处理
        if (!empty($conflictFields)) {
            $this->logConflict($localVersion, $remoteVersion, $conflictFields);
        }

        return $merged;
    }

    protected function logConflict(array $local, array $remote, array $fields): void
    {
        DB::table('data_conflicts')->insert([
            'table_name' => 'orders',
            'record_id' => $local['id'],
            'local_version' => json_encode($local),
            'remote_version' => json_encode($remote),
            'conflict_fields' => json_encode($fields),
            'resolved_at' => null,
            'created_at' => now(),
        ]);
    }
}
```

### 4.4 分布式锁跨区域协调

```php
// app/Services/DistributedLock.php
class DistributedLock
{
    /**
     * 跨区域分布式锁：使用 DynamoDB 或 Consul
     */
    public function acquireAcrossRegions(
        string $resource,
        string $owner,
        int $ttlSeconds = 30
    ): bool {
        $lockTable = config('services.dynamodb.locks_table');

        try {
            DynamoDbClient::putItem([
                'TableName' => $lockTable,
                'Item' => [
                    'resource' => ['S' => $resource],
                    'owner' => ['S' => $owner],
                    'expires_at' => ['N' => (string)(time() + $ttlSeconds)],
                    'region' => ['S' => config('app.region')],
                ],
                'ConditionExpression' => 'attribute_not_exists(resource) OR expires_at < :now',
                'ExpressionAttributeValues' => [
                    ':now' => ['N' => (string)time()],
                ],
            ]);

            return true;
        } catch (ConditionalCheckFailedException $e) {
            return false;
        }
    }

    public function releaseAcrossRegions(string $resource, string $owner): bool
    {
        try {
            DynamoDbClient::deleteItem([
                'TableName' => config('services.dynamodb.locks_table'),
                'Key' => ['resource' => ['S' => $resource]],
                'ConditionExpression' => '#owner = :owner',
                'ExpressionAttributeNames' => ['#owner' => 'owner'],
                'ExpressionAttributeValues' => [':owner' => ['S' => $owner]],
            ]);

            return true;
        } catch (ConditionalCheckFailedException $e) {
            return false;
        }
    }
}
```

---

## 五、DNS 与流量路由

### 5.1 延迟路由（Latency-Based Routing）

```bash
# AWS Route53 延迟路由配置
aws route53 change-resource-record-sets --hosted-zone-id Z1234 --change-batch '{
    "Changes": [{
        "Action": "CREATE",
        "ResourceRecordSet": {
            "Name": "api.example.com",
            "Type": "A",
            "SetIdentifier": "us-east",
            "Region": "us-east-1",
            "MultiValueAnswer": true,
            "TTL": 60,
            "ResourceRecords": [{"Value": "52.1.2.3"}]
        }
    }, {
        "Action": "CREATE",
        "ResourceRecordSet": {
            "Name": "api.example.com",
            "Type": "A",
            "SetIdentifier": "ap-tokyo",
            "Region": "ap-northeast-1",
            "MultiValueAnswer": true,
            "TTL": 60,
            "ResourceRecords": [{"Value": "13.112.4.5"}]
        }
    }]
}'
```

### 5.2 健康检查与故障转移

```php
// app/Http/Controllers/HealthCheckController.php
class HealthCheckController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $checks = [
            'database' => $this->checkDatabase(),
            'redis' => $this->checkRedis(),
            'queue' => $this->checkQueue(),
            'storage' => $this->checkStorage(),
            'external_apis' => $this->checkExternalAPIs(),
        ];

        $healthy = collect($checks)->every(fn($check) => $check['status'] === 'ok');

        return response()->json([
            'status' => $healthy ? 'healthy' : 'degraded',
            'region' => config('app.region'),
            'timestamp' => now()->toIso8601String(),
            'checks' => $checks,
            'version' => config('app.version'),
        ], $healthy ? 200 : 503);
    }

    protected function checkDatabase(): array
    {
        try {
            DB::connection()->getPdo();
            $replicaLag = DB::select('SHOW SLAVE STATUS')[0]->Seconds_Behind_Master ?? 0;

            return [
                'status' => $replicaLag < 10 ? 'ok' : 'degraded',
                'replica_lag_seconds' => $replicaLag,
            ];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }

    protected function checkRedis(): array
    {
        try {
            Redis::ping();
            $info = Redis::info('memory');
            return [
                'status' => 'ok',
                'memory_used' => $info['used_memory_human'],
            ];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }
}
```

---

## 六、Session 与缓存跨区域管理

### 6.1 Session 存储方案对比

| 方案 | 跨区域一致性 | 延迟 | 复杂度 | 推荐场景 |
|------|------------|------|--------|---------|
| **文件** | ❌ | 低 | 低 | 单区域 |
| **Redis Cluster** | ⚠️ 有限 | 中 | 中 | 同区域多实例 |
| **DynamoDB** | ✅ | 中 | 低 | 跨区域首选 |
| **JWT** | ✅ | 无 | 低 | 无状态 API |

### 6.2 JWT 无状态 Session（推荐）

```php
// app/Services/JWTSession.php
class JWTSession
{
    public function createToken(User $user): string
    {
        return JWT::encode([
            'sub' => $user->id,
            'email' => $user->email,
            'roles' => $user->roles->pluck('name'),
            'region' => config('app.region'),
            'iat' => time(),
            'exp' => time() + config('session.lifetime') * 60,
            'jti' => Str::uuid(),
        ], config('app.jwt_secret'), 'HS256');
    }

    public function validateToken(string $token): ?array
    {
        try {
            $payload = JWT::decode($token, new Key(config('app.jwt_secret'), 'HS256'));

            // 检查黑名单（跨区域撤销需要 Redis/DynamoDB）
            if ($this->isRevoked($payload->jti)) {
                return null;
            }

            return (array)$payload;
        } catch (ExpiredException $e) {
            return null;
        }
    }

    protected function isRevoked(string $jti): bool
    {
        // 使用 DynamoDB 全局表存储撤销列表
        return Cache::store('dynamodb')->has("revoked:{$jti}");
    }
}
```

### 6.3 Redis 跨区域缓存同步

```php
// 使用 Redis CRDT (Conflict-free Replicated Data Types) 方案
// Redis Enterprise Active-Active 模式

// config/database.php
'redis' => [
    'client' => 'predis',
    'options' => [
        'cluster' => 'redis',
        'prefix' => config('app.region') . ':',  // 区域前缀避免冲突
    ],
    'clusters' => [
        'default' => [
            [
                'host' => env('REDIS_HOST_1', 'redis-us-east.internal'),
                'port' => env('REDIS_PORT', 6379),
                'password' => env('REDIS_PASSWORD'),
                'database' => 0,
            ],
        ],
    ],
],
```

---

## 七、合规与数据主权

### 7.1 数据驻留策略

```php
// app/Services/DataResidency.php
class DataResidency
{
    // GDPR: 欧洲用户数据必须存储在欧洲
    private array $residencyRules = [
        'EU' => ['region' => 'eu-central', 'storage' => 's3-eu-central-1'],
        'JP' => ['region' => 'ap-northeast', 'storage' => 's3-ap-northeast-1'],
    ];

    public function getStorageRegion(string $userCountry): string
    {
        foreach ($this->residencyRules as $countryGroup => $config) {
            if ($this->countryInGroup($userCountry, $countryGroup)) {
                return $config['storage'];
            }
        }

        return config('filesystems.disks.s3.bucket'); // 默认区域
    }

    public function ensureCompliance(string $userId, string $data): void
    {
        $user = User::findOrFail($userId);
        $region = $this->getStorageRegion($user->country);

        // 存储到合规区域的 S3
        Storage::disk($region)->put(
            "user-data/{$userId}/profile.json",
            $data
        );
    }
}
```

### 7.2 GDPR 合规模块

```php
// app/Services/GDPR/DataExportService.php
class DataExportService
{
    public function exportUserData(int $userId): string
    {
        $user = User::findOrFail($userId);

        $data = [
            'profile' => $user->toArray(),
            'orders' => $user->orders()->get()->toArray(),
            'addresses' => $user->addresses()->get()->toArray(),
            'reviews' => $user->reviews()->get()->toArray(),
            'activity_log' => ActivityLog::where('user_id', $userId)->get()->toArray(),
        ];

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        // 存储到用户所在区域的加密 S3 Bucket
        $path = "gdpr-export/{$userId}/" . now()->format('Y-m-d-His') . '.json';
        Storage::disk('gdpr-export')->put($path, encrypt($json));

        return $path;
    }
}
```

---

## 八、Laravel 多区域部署配置

### 8.1 环境配置

```env
# .env.us-east
APP_REGION=us-east
APP_URL=https://api.example.com
DB_HOST=us-east-primary.db.internal
DB_READ_HOST_1=us-east-replica-1.db.internal
DB_READ_HOST_2=us-east-replica-2.db.internal
REDIS_HOST=us-east.redis.internal
AWS_DEFAULT_REGION=us-east-1
CDN_URL=https://d111111abcdef8.cloudfront.net

# .env.ap-tokyo
APP_REGION=ap-tokyo
APP_URL=https://api-tokyo.example.com
DB_HOST=us-east-primary.db.internal  # 写入仍走主库
DB_READ_HOST_1=tokyo-replica.db.internal  # 读取走本地从库
REDIS_HOST=tokyo.redis.internal
AWS_DEFAULT_REGION=ap-northeast-1
CDN_URL=https://d222222abcdef8.cloudfront.net
```

### 8.2 区域感知服务提供者

```php
// app/Providers/RegionServiceProvider.php
class RegionServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton('current_region', function () {
            return config('app.region', 'us-east');
        });

        $this->app->singleton(StorageRouter::class, function ($app) {
            return new StorageRouter($app['current_region']);
        });

        $this->app->singleton(QueueRouter::class, function ($app) {
            return new QueueRouter($app['current_region']);
        });
    }

    public function boot(): void
    {
        // 根据区域配置 CDN
        $region = config('app.region');
        $cdnUrl = config("services.cdn.{$region}.url");
        config()->set('app.cdn_url', $cdnUrl);
    }
}
```

---

## 九、实战部署流程

### 9.1 Terraform 多区域基础设施

```hcl
# 部署到多个 AWS 区域
module "app_us_east" {
  source = "./modules/laravel-app"
  region = "us-east-1"

  instance_type = "c6g.xlarge"
  db_instance_class = "db.r6g.xlarge"
  is_primary = true
}

module "app_ap_tokyo" {
  source = "./modules/laravel-app"
  region = "ap-northeast-1"

  instance_type = "c6g.large"
  db_instance_class = "db.r6g.large"
  is_primary = false
  primary_region = "us-east-1"
}
```

### 9.2 部署顺序

1. **数据库迁移**：只在主区域执行，自动复制到从区域
2. **代码部署**：先部署从区域，再部署主区域（或同时部署）
3. **CDN 配置**：更新 CloudFront 分发
4. **DNS 切换**：Route53 健康检查自动切换
5. **验证**：从各区域运行 Smoke Test

---

## 总结

多区域部署的核心挑战和解决方案：

| 挑战 | 解决方案 |
|------|---------|
| 写入延迟 | 主区域写入 + 就近读取 |
| 数据一致性 | 写后读一致性 + 最终一致性事件 |
| Session 管理 | JWT 无状态方案 |
| 缓存同步 | Redis CRDT 或区域前缀 |
| 数据合规 | DataResidency 策略引擎 |
| CDN 缓存 | 边缘计算 + Vary 头 |
| 冲突解决 | LWW + 字段级合并 |

从 Active-Passive 起步，逐步演进到 Active-Active，是多数团队的务实选择。

## 相关阅读

- [蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚](/categories/运维/蓝绿部署实战-Laravel-零停机发布-流量切换-数据库迁移与一键回滚/)
- [Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化](/categories/运维/grafana-loki-lightweight-log-aggregation-laravel/)
- [GDPR/个人信息保护法合规实战：Laravel 应用中的数据主体权利、同意管理与跨境传输](/categories/运维/2026-06-02-GDPR-个人信息保护法合规实战-Laravel-数据主体权利-同意管理与跨境传输/)
