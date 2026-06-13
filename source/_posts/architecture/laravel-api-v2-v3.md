---
title: Laravel API 多版本演进策略：v2 → v2_1 → v3 的平滑迁移与废弃方案
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-02
description: "深入解析 Laravel RESTful API 版本控制实战方案，涵盖 v2、v2_1、v3 多版本演进策略、路由中间件版本协商、独立控制器封装与向后兼容设计，配合 HTTP 410 废弃标记、Feature Flag 灰度发布及 OpenAPI 契约文档，帮助团队实现 API 平滑迁移与有序废弃。"
categories:
  - architecture
  - php
tags: [Laravel, API版本控制, RESTful, 向后兼容]
keywords: [Laravel API, v2, v3, 多版本演进策略, 的平滑迁移与废弃方案, 架构, PHP]



---

## 📌 问题背景：为什么 Laravel B2C API 需要多版本？

在 KKday RD B2C 后端 Team 的实际项目中，我们面临这样的场景：

- iOS/Android App 已上线多年，代码库依赖 v1/v2 版本的 API
- 前端 Web App 使用 React/Vue，可能还在用旧版本接口
- 内部 Java BFF（search/recommend/svc-search）需要逐步迁移到新的数据格式
- Stripe/AliPay 支付回调的字段定义在逐步变化

**一刀切的做法不可取**。直接在 `/api/users` 上修改响应结构，会导致：
```json
// v1 旧客户端收到新格式 -> ✗ 崩溃
{
  "user": {...},    // 旧版本期望 "username"
  "name": "张三"     // 新版本改成嵌套对象
}
```

Laravel 本身没有内置的版本管理，需要自己设计演进策略。本文基于 **30+ 仓库的 Laravel 实战经验**，分享一套可复用的多版本 API 架构模式。

---

## 🏗️ 架构设计：路径版本化 vs Header 版本化

### 方案对比表

| 维度 | 路径版本化 (URI Path) | Header 版本化 (Accept-Version) | Query 参数 (v=2) |
|------|----------------------|-------------------------------|-----------------|
| **兼容性** | ★★★★★（最稳健） | ★★★☆☆ | ★★★★☆ |
| **缓存友好** | ★★★★★ | ★★☆☆☆ | ★★★☆☆ |
| **客户端支持度** | ★★★★★（主流） | ★★☆☆☆（少见） | ★★★☆☆ |
| **实现复杂度** | ★★☆☆☆ | ★★★★☆ | ★★★☆☆ |
| **路由代码量** | ★★★★★（简洁） | ★★☆☆☆（复杂） | ★★★☆☆ |

### 我们的选择：路径版本化（URI Path）

理由很直接：**iOS/Android/React Native 等移动客户端对 URI 的支持是原生级的**。

```php
// ✅ 推荐的 URI 结构
GET /api/v2/users         // v2.0
GET /api/v2_1/users       // v2.1（小版本用下划线区分）
GET /api/v3/users         // v3.0（大版本用数字）

// ⚠️ 避免使用这些不推荐的做法
GET /api/users?version=2      // Query 参数：容易和查询条件混淆
GET /api/users Accept: v2     // Header：缓存代理难以处理
```

---

## 🛠️ 实现方案一：路由中间件版本协商（推荐）

这是最干净的方式，利用 Laravel 的路由中间件特性。

### 步骤 1：定义版本路由组

在 `routes/api.php` 中建立清晰的版本分隔：

```php
// routes/api.php

// v2.0 路由组（当前维护中）
Route::group([
    'prefix' => 'api/v2',
    'middleware' => ['version:2.0'],  // 自定义中间件检查兼容性
], function ($router) {
    // 兼容旧客户端的路由
    $router->get('/users', 'UserController@index')
        ->middleware('deprecated:v2'); // 标记为已废弃，准备迁移

    $router->post('/sessions', 'SessionController@store');
});

// v2.1 路由组（新标准，逐步迁移）
Route::group([
    'prefix' => 'api/v2_1',
], function ($router) {
    // 新的数据格式
    $router->get('/users', 'UserControllerV2_1@index');
    
    // v2.1 新增字段：avatar_url
    $router->get('/users/{id}', function ($user) {
        return [
            'id' => $user->id,
            'username' => $user->username,  // 保留兼容字段
            'name' => $user->name,          // 新增嵌套结构
            'avatar_url' => asset('/images/' . $user->avatar), // v2.1 新增
            'created_at' => $user->created_at->toISOString(), // ISO8601
        ];
    });
});

// v3.0 路由组（大版本重构）
Route::group([
    'prefix' => 'api/v3',
], function ($router) {
    // 全新架构：GraphQL-like 的 JSON:API 规范
    $router->get('/users', 'UserControllerV3@index'); // JSON:API 标准格式
});

// v1.0 保留区（历史包袱）
Route::group([
    'prefix' => 'api/v1',
], function ($router) {
    $router->get('/users', function () {
        // 完全兼容 v2.0，标记为 deprecated
        return response()->json([
            'data' => [
                'id' => 1,
                'username' => 'john_doe',
                'created_at' => date('c'), // Unix 时间戳 -> ISO8601
            ],
        ], 200, ['X-Deprecated' => 'true']);
    });
});
```

### 步骤 2：创建版本中间件

```php
// app/Http/Middleware/VersionCheck.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class VersionCheck
{
    /**
     * 检查路由是否支持当前请求的版本
     */
    public function handle(Request $request, Closure $next)
    {
        // 获取请求路径中的版本号
        $path = $request->path();
        
        if (str_starts_with($path, 'v1') || str_starts_with($path, 'api/v1')) {
            return response()->json([
                'error' => 'API v1 is deprecated and will be removed in 2026-06',
                'migration_url' => '/docs/api-migration-guide',
            ], 410); // HTTP 410 Gone
        }

        if (str_starts_with($path, 'v2') && !str_contains($path, 'v2_')) {
            return response()->json([
                'data' => [
                    'message' => 'API v2.0 is deprecated',
                    'use_v2_1_or_later' => true,
                    'migration_guide' => '/docs/migration-v2-to-v2_1',
                ],
                'warnings' => ['deprecated:v2'],
            ], 410);
        }

        return $next($request);
    }
}
```

### 步骤 3：废弃标记与迁移引导

在每个旧版路由上添加 `deprecated` middleware：

```php
use App\Http\Middleware\Deprecated;

Route::get('/api/v2/users', 'UserController@index')
    ->middleware([
        'deprecated:v2',      // 触发 HTTP 410
        Deprecated::class,    // 返回迁移指引
    ]);
```

---

## 🛠️ 实现方案二：版本控制器包装（适合复杂逻辑）

当不同版本需要完全不同的业务逻辑时，可以用独立的 Controller。

### 创建 v2/v2_1/v3 的独立 Controller

```php
// app/Http/Controllers/API/Users/UserControllerV2.php
namespace App\Http\Controllers\API\Users;

use App\Http\Controllers\Controller;

class UserControllerV2 extends Controller
{
    public function index()
    {
        // v2.0：扁平结构，只返回基础字段
        return response()->json([
            'data' => [
                'id' => 1,
                'username' => 'john_doe',
                'email' => 'john@example.com',
                'created_at' => date('c'),
            ],
        ]);
    }

    // v2.0 不包含的字段
    public function profile()
    {
        return response()->json(['error' => 'Not available in v2']);
    }
}

// app/Http/Controllers/API/Users/UserControllerV2_1.php
namespace App\Http\Controllers\API\Users;

class UserControllerV2_1 extends Controller
{
    public function index()
    {
        // v2.1：新增 avatar_url 和嵌套结构
        $user = User::findOrFail(request()->route('id'));
        
        return response()->json([
            'data' => [
                'id' => $user->id,
                'username' => $user->username,  // 兼容字段（保留）
                'name' => $user->name,          // v2.1 新增
                'avatar_url' => asset('/images/' . $user->avatar), // v2.1 新增
                'is_verified' => $user->is_verified ? true : false, // v2.1 新增
            ],
        ]);
    }

    // v2.1 新增：profile API
    public function profile()
    {
        $user = User::findOrFail(request()->route('id'));
        
        return response()->json([
            'data' => [
                'profile' => [
                    'bio' => $user->bio,
                    'location' => $user->location,
                    'website' => $user->website,
                ],
            ],
        ]);
    }
}

// app/Http/Controllers/API/Users/UserControllerV3.php
namespace App\Http\Controllers\API\Users;

use Illuminate\Http\JsonResponse;

class UserControllerV3 extends Controller
{
    // v3.0：JSON:API 规范（大版本重构）
    public function index(): JsonResponse
    {
        $users = User::all();
        
        return response()->json([
            'data' => [
                'meta' => [
                    'total' => count($users),
                    'page' => request('page', 1),
                    'limit' => request('limit', 20),
                ],
                'results' => $users->map(function ($u) {
                    return [
                        'id' => (string) $u->id, // JSON:API 要求字符串 ID
                        'type' => 'user',        // JSON:API 资源类型
                        'attributes' => [
                            'username' => $u->username,
                            'email' => $u->email,
                        ],
                    ];
                }),
            ],
            'links' => [
                'self' => request()->fullUrl(),
                'first' => '/api/v3/users?page=1',
                'last' => '/api/v3/users?page=' . ceil(count($users) / 20),
            ],
        ]);
    }
}
```

### 路由映射（使用版本标识符）

```php
// routes/api.php

Route::group(['prefix' => 'api'], function () {
    
    // v2.0 组
    Route::get('/v2/users', UsersControllerV2::class . '@index');
    Route::get('/v2/users/{id}', UsersControllerV2::class . '@profile');
    
    // v2.1 组（推荐：小版本用下划线）
    Route::prefix('v2_1')->group(function () {
        Route::get('/users', UsersControllerV2_1::class . '@index');
        Route::get('/users/{id}', UsersControllerV2_1::class . '@profile');
    });
    
    // v3.0 组（大版本：完全重构为 JSON:API）
    Route::prefix('v3')->group(function () {
        Route::get('/users', UsersControllerV3::class . '@index');
    });
});
```

---

## 🛠️ 实现方案三：单一控制器多版本响应（适合字段兼容性高的场景）

如果大部分请求都可以向后兼容，可以用一个 Controller 根据路径返回不同格式。

```php
// app/Http/Controllers/API/Users/UserController.php
namespace App\Http\Controllers\API\Users;

use Illuminate\Http\Request;

class UserController
{
    /**
     * 多版本响应逻辑
     */
    public function index(Request $request)
    {
        $version = $this->detectVersion($request);
        
        return match ($version) {
            'v2' => $this->respondV2(),
            'v2_1' => $this->respondV2_1(),
            'v3' => $this->respondV3(),
            default => $this->respondDefault(),
        };
    }

    protected function detectVersion(Request $request): string
    {
        // 优先检测路径版本，其次 Accept-Version Header
        if (preg_match('/\/api\/v(\d[_\w]*)/', request()->path(), $matches)) {
            return $matches[1];
        }

        $versionHeader = request()->header('Accept-Version');
        if ($versionHeader) {
            return str_replace(['v', 'V'], '', strtolower($versionHeader));
        }

        // 默认返回最新（v3）或 v2_1（向后兼容）
        return 'v2_1';
    }

    protected function respondV2()
    {
        // v2.0：扁平结构，旧客户端使用
        $user = User::first();
        
        return response()->json([
            'data' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'created_at' => (string) $user->created_at, // 兼容旧格式
            ],
        ]);
    }

    protected function respondV2_1()
    {
        // v2.1：新增嵌套结构，但保留兼容字段
        $user = User::first();
        
        return response()->json([
            'data' => [
                'id' => $user->id,
                'username' => $user->username,  // ✓ 保留（兼容 v2）
                'name' => $user->name,          // ✓ 新增
                'avatar_url' => asset('/images/' . $user->avatar), // ✓ 新增
                'created_at' => (string) $user->created_at, // ✓ ISO8601
            ],
        ]);
    }

    protected function respondV3()
    {
        // v3.0：JSON:API 规范（大版本重构）
        $user = User::first();
        
        return response()->json([
            'data' => [
                'type' => 'user',              // JSON:API 要求
                'id' => (string) $user->id,    // JSON:API 要求字符串 ID
                'attributes' => [
                    'username' => $user->username,
                    'name' => $user->name,
                    'email' => $user->email,
                ],
            ],
        ]);
    }

    protected function respondDefault()
    {
        // 默认返回最新兼容版本（v2_1）
        return $this->respondV2_1();
    }
}
```

---

## 📊 各方案对比

| 维度 | 方案一（路由中间件） | 方案二（独立 Controller） | 方案三（单一多版本响应） |
|------|---------------------|--------------------------|-------------------------|
| **代码组织** | ★★★★☆ | ★★★★★ | ★★★☆☆ |
| **可测试性** | ★★★★★ | ★★★★★ | ★★☆☆☆ |
| **性能开销** | ★★★★★ | ★★★★☆ | ★★★★★ |
| **迁移成本** | ★★★★☆ | ★★☆☆☆ | ★★★★☆ |
| **适合场景** | 路径版本化管理 | 大版本重构/业务逻辑差异大 | 字段兼容性高的渐进式演进 |

### 推荐策略：混合使用

- **新特性（v2_1）→ 方案一**：小版本迭代，用路由版本管理
- **大重构（v3）→ 方案二**：架构变化时创建独立 Controller
- **向后兼容 → 方案三**：同一 URL 下返回不同格式

---

## ⚠️ 真实踩坑记录

### 坑 1：版本命名混乱导致路由冲突

```php
// ❌ 错误示范：使用了 v20、v21、v22 这种数字递增
Route::prefix('api/v20')->group(...);   // iOS 客户端请求 /api/v20/users ✗
Route::prefix('api/v21')->group(...);   // Android 客户端请求 /api/v21/users ✗
Route::prefix('api/v22')->group(...);   // React 客户端请求 /api/v22/users ✗

// ✅ 正确做法：v2、v2_1、v3 清晰区分
Route::prefix('api/v2')->group(...);
Route::prefix('api/v2_1')->group(...);
Route::prefix('api/v3')->group(...);
```

### 坑 2：未标记废弃导致流量泄露

```php
// ❌ 忘记添加 deprecated 中间件
Route::get('/api/v2/users', 'UserControllerV2@index'); // HTTP 200 返回，但 v1.0 已应废弃 ✗

// ✅ 添加废弃标记
Route::get('/api/v2/users', 'UserControllerV2@index')
    ->middleware(['deprecated:v2']); // 触发 HTTP 410
```

### 坑 3：忽略 Header 版本导致缓存失效

```php
// ❌ 只检查路径，忽略 Accept-Version Header
public function index() {
    if (request()->header('Accept-Version') === 'v2_1') { // ✗ 未处理
        return $this->respondV2_1();
    }
}

// ✅ 双重检测：路径优先 + Header 降级
protected function detectVersion(Request $request): string {
    if (preg_match('/\/api\/v(\d[_\w]*)/', request()->path(), $matches)) {
        return $matches[1]; // ✓ 路径优先（缓存友好）
    }
    // 降级处理 Header 版本
    $versionHeader = request()->header('Accept-Version');
    if ($versionHeader) {
        return str_replace(['v', 'V'], '', strtolower($versionHeader));
    }
}
```

### 坑 4：数据库迁移与 API 版本同步问题

```php
// ✅ 正确的做法：DB Migration → Feature Flag → API Versioning

// Step 1: 数据库支持新字段（向下兼容）
Schema::table('users', function (Blueprint $table) {
    $table->string('avatar_url')->nullable()->after('username'); // nullable
    $table->json('profile')->nullable(); // JSON 存储，灵活扩展
});

// Step 2: Feature Flag 标记是否启用新字段
Schema::create('feature_flags', function (Blueprint $table) {
    $table->id();
    $table->string('name');           // avatar_url_enabled, profile_enabled
    $table->boolean('enabled')->default(false);
    $table->timestamps();
});

// Step 3: API 响应根据版本和 Flag 决定是否返回新字段
public function index(Request $request) {
    $user = User::first();
    
    return response()->json([
        'data' => [
            'id' => $user->id,
            'username' => $user->username,
            
            // v2.1 才返回 avatar_url，旧版本不传
            if ($request->route('prefix') === 'v2_1') {
                'avatar_url' => asset('/images/' . $user->avatar),
            } else {
                // ✓ 向下兼容：v2 客户端忽略此字段
            },
        ],
    ]);
}
```

---

## 🔄 迁移策略：从 v2 → v2_1 → v3 的完整路线图

### Phase 1: 数据库预备（DB Migration First）

```sql
-- Step 1: 添加 nullable 字段（不破坏现有数据）
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN name VARCHAR(100) NULL;

-- Step 2: 添加索引支持新的查询模式
CREATE INDEX idx_users_username_avatar ON users(username, avatar_url);
```

### Phase 2: Feature Flag 灰度发布

```php
// app/Models/FeatureFlag.php
class FeatureFlag {
    public static function isV2_1Enabled(): bool {
        $flag = Feature::value('avatar_url_enabled');
        return $flag ? true : false;
    }
}
```

### Phase 3: API 响应渐进更新

```php
// v2.0 兼容模式（旧客户端）
Route::prefix('v2')->get('/users', function () {
    $user = User::first();
    
    return response()->json([
        'data' => [
            'id' => $user->id,
            'username' => $user->username,
            'email' => $user->email,  // ✓ 保留（兼容旧客户端）
            'created_at' => date('c'), // ✓ Unix 时间戳
        ],
    ]);
});

// v2.1 新标准（新客户端）
Route::prefix('v2_1')->get('/users', function () {
    $user = User::first();
    
    return response()->json([
        'data' => [
            'id' => $user->id,
            'username' => $user->username,  // ✓ 兼容字段（保留）
            'name' => $user->name ?? '',     // ✨ 新增
            'avatar_url' => asset('/images/' . $user->avatar), // ✨ 新增
            'created_at' => (string) $user->created_at, // ISO8601
        ],
    ]);
});
```

### Phase 4: 废弃 v2.0（标记 HTTP 410）

```php
// 一年后，v2.0 已无客户端使用
Route::prefix('v2')->get('/users', function () {
    return response()->json([
        'error' => 'API v2.0 is deprecated and will be removed in Q3 2026',
        'migration_url' => '/docs/api-migration-guide-v2-to-v2_1',
    ], 410); // HTTP 410 Gone
});
```

### Phase 5: v3.0 架构重构（JSON:API 规范）

```php
Route::prefix('v3')->get('/users', function () {
    $users = User::all();
    
    return response()->json([
        'data' => [
            'meta' => [
                'total' => count($users),
                'page' => request('page', 1),
                'limit' => request('limit', 20),
            ],
            'results' => $users->map(function ($u) {
                return [
                    'id' => (string) $u->id,    // JSON:API 要求字符串 ID
                    'type' => 'user',          // JSON:API 资源类型
                    'attributes' => [
                        'username' => $u->username,
                        'name' => $u->name ?? '',
                        'email' => $u->email,
                    ],
                ];
            }),
        ],
    ]);
});
```

---

## 📝 OpenAPI 契约示例

为多版本 API 设计 OpenAPI 文档：

```yaml
# docs/openapi/api-v2_1.yaml
openapi: 3.0.3
info:
  title: KKday BFF Users API v2.1
  version: 2.1.0
servers:
  - url: https://api.kkday.com/v2_1

paths:
  /users:
    get:
      summary: 获取用户列表（v2.1）
      responses:
        '200':
          description: 成功返回 v2.1 格式
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      id:
                        type: integer
                        example: 1
                      username:
                        type: string
                        example: john_doe
                      name:          # ✨ v2.1 新增字段
                        type: string
                        example: John Doe
                      avatar_url:    # ✨ v2.1 新增字段
                        type: string
                        format: uri
                        example: https://images.kkday.com/avatar.png
                      created_at:
                        type: string
                        format: date-time
                        example: "2026-05-02T03:00:00+08:00"
        '410':
          $ref: '#/components/responses/DeprecatedAPI'
  
  /users/{id}:
    get:
      summary: 获取单个用户（v2.1）
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      username:
                        type: string
                        example: john_doe
                      name:      # ✨ v2.1 新增
                        type: string
                        example: John Doe
                      avatar_url: # ✨ v2.1 新增
                        type: string
```

---

## 🎯 总结与建议

### Laravel BFF 多版本 API 演进的最佳实践：

| 阶段 | 推荐做法 |
|------|---------|
| **设计** | URI Path 版本化（v2/v2_1/v3）> Query 参数 > Header |
| **实现** | 路由中间件 + 独立 Controller（根据业务复杂度选择） |
| **废弃** | HTTP 410 + deprecated 中间件 + 迁移文档引导 |
| **兼容** | 数据库 nullable → Feature Flag → API Versioning |
| **文档** | OpenAPI YAML 契约驱动 + Confluence SA/SD 模板 |

### 从 backlog 的实践经验提炼：

> **"平滑迁移"的关键词：**
> - 路径版本化（URI Path）最稳健
> - HTTP 410 Gone 信号明确表达"已废弃"
> - Feature Flag 灰度发布降低风险
> - OpenAPI 契约文档先行，测试 Mock 先行

### KKday B2C API 架构演进建议：

```yaml
当前架构（2026-05）:
  - v1.x (deprecated, HTTP 410)
  - v2.0 (maintenance mode, deprecated 标记)
  - v2_1 (production, recommended)

下一步迁移计划（Q3 2026）:
  - Feature Flag 灰度发布 v2_1 的新字段
  - iOS 18/Android 14 Beta 适配测试
  - HTTP 410 标记 v2.0，强制客户端升级

长期目标：
  - 逐步废弃 v1.x
  - Q4 2026: 推出 v3 JSON:API 规范
```

---

**作者**: Michael · KKday RD B2C Backend Team  
**相关资源**: [OpenAPI Design Guide](docs/openapi/) | [BFF Architecture Patterns](source/_posts/00_架构/BFF-Laravel-中间层聚合实战.md)

---

## 相关阅读

- [API 生命周期管理实战：设计、版本控制、废弃通知与客户端迁移（Sunset Header 与 Deprecation 标准）](/architecture/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/) — 从 API 生命周期视角详解版本控制与废弃通知的标准实践
- [API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案](/architecture/API-版本废弃策略实战-Sunset-Header-Deprecation-通知与客户端迁移的工程化方案/) — 聚焦 Sunset/Deprecation HTTP Header 的工程化落地方案
- [Data Contract Pact-style：Laravel 微服务数据契约版本化验证与 Breaking Change 检测](/architecture/2026-06-05-Data-Contract-Pact-style-Laravel微服务数据契约版本化验证Breaking-Change检测/) — 契约测试视角下的 API 数据版本化与破坏性变更检测
- [Schema Registry 实战：Confluent Apicurio API 契约演进与 Schema 兼容性治理](/architecture/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/) — Schema 级别的契约演进与兼容性策略
- [API Mock 策略实战：WireMock Mockoon MSW 三层 Mock 体系](/architecture/2026-06-06-API-Mock-策略实战-WireMock-Mockoon-MSW-三层Mock体系/) — 多版本 API 并行开发时的 Mock 测试策略
- [OpenFGA Zanzibar ReBAC Laravel：细粒度授权与 API 版本控制的权限适配](/architecture/openfga-zanzibar-rebac-laravel/) — 结合授权模型适配多版本 API 的权限管理

*本文档基于 30+ 仓库 Laravel 项目的真实踩坑经验，欢迎提交 Issue 讨论演进策略。*
