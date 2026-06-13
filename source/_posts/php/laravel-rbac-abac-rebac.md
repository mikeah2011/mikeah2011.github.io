---

title: Laravel 授权模型深度对比：RBAC vs ABAC vs ReBAC
keywords: [Laravel, RBAC vs ABAC vs ReBAC, 授权模型深度对比]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-06-05 10:00:00
tags:
- Laravel
- 授权
- RBAC
- abac
- rebac
- 权限管理
- 权限模型
- 访问控制
description: 深入对比 RBAC、ABAC、ReBAC 三大权限模型在 Laravel 中的实战落地，涵盖 spatie/laravel-permission 角色权限、Policy/Gate 属性授权、自建关系图权限引擎，附完整可运行代码、常见踩坑案例、性能优化策略与混合方案决策指南，帮你在项目中选对授权范式。
categories:
- php
---


# Laravel 授权模型深度对比：RBAC vs ABAC vs ReBAC

在构建现代 Web 应用时，授权（Authorization）是保障系统安全的核心环节。Laravel 提供了多种授权机制，但在面对复杂业务场景时，如何选择合适的授权模型往往让开发者感到困惑。本文将深入对比三种主流授权模型——**RBAC**、**ABAC** 和 **ReBAC**，并结合 Laravel 生态给出实践方案。

<!--more-->

## 一、三种授权模型概览

### 1.1 RBAC（基于角色的访问控制）

**Role-Based Access Control** 是最经典、最常见的授权模型。其核心思想是：

```
用户 → 角色 → 权限 → 资源
```

用户被分配角色，角色拥有权限，权限决定能否访问资源。

**典型场景：**
- 后台管理系统（管理员、编辑、审核员）
- SaaS 平台的企业级角色划分

### 1.2 ABAC（基于属性的访问控制）

**Attribute-Based Access Control** 通过评估属性（用户属性、资源属性、环境属性）来做出授权决策：

```
if (user.department == resource.department && time.hour >= 9)
    → ALLOW
```

**典型场景：**
- 文档只能被同部门且在工作时间内访问
- 基于地理位置的资源限制

### 1.3 ReBAC（基于关系的访问控制）

**Relationship-Based Access Control** 基于实体之间的关系图做出授权决策：

```
用户 --[owner]--> 文档 → ALLOW
用户 --[friend_of]--> 文档.owner → ALLOW
```

**典型场景：**
- 社交平台（好友可见、关注者可见）
- 协作工具（项目成员可编辑、组织成员可查看）

---

## 二、核心对比

| 维度 | RBAC | ABAC | ReBAC |
|------|------|------|-------|
| **决策依据** | 角色 | 属性组合 | 实体关系 |
| **表达能力** | ★★☆ | ★★★ | ★★★ |
| **实现复杂度** | 低 | 中-高 | 高 |
| **查询性能** | 优秀 | 中等 | 需要优化 |
| **适用规模** | 中小型 | 大型 | 社交/协作类 |
| **Laravel 生态** | 成熟 | 需自建 | 需自建/集成 |
| **审计难度** | 简单 | 复杂 | 中等 |
| **策略变更** | 需改角色 | 动态生效 | 动态生效 |

---

## 三、Laravel 中的 RBAC 实践

RBAC 在 Laravel 生态中最成熟，推荐使用 **spatie/laravel-permission** 包。

### 3.1 安装与配置

```bash
composer require spatie/laravel-permission
php artisan vendor:publish --provider="Spatie\Permission\PermissionServiceProvider"
php artisan migrate
```

### 3.2 模型设置

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use HasRoles;

    // ...
}
```

### 3.3 定义角色与权限

```php
use Spatie\Permission\Models\Role;
use Spatie\Permission\Models\Permission;

// 创建权限
Permission::create(['name' => 'edit articles']);
Permission::create(['name' => 'delete articles']);
Permission::create(['name' => 'publish articles']);

// 创建角色并分配权限
$admin = Role::create(['name' => 'admin']);
$admin->givePermissionTo(['edit articles', 'delete articles', 'publish articles']);

$editor = Role::create(['name' => 'editor']);
$editor->givePermissionTo(['edit articles', 'publish articles']);
```

### 3.4 在控制器中使用

```php
class ArticleController extends Controller
{
    public function __construct()
    {
        $this->middleware('permission:edit articles', ['only' => ['edit', 'update']]);
        $this->middleware('permission:delete articles', ['only' => ['destroy']]);
    }

    public function edit(Article $article)
    {
        // 另一种检查方式
        if (!auth()->user()->can('edit articles')) {
            abort(403);
        }

        return view('articles.edit', compact('article'));
    }
}
```

### 3.5 Blade 模板中的使用

```blade
@role('admin')
    <a href="/admin/dashboard">管理面板</a>
@endrole

@can('edit articles')
    <a href="{{ route('articles.edit', $article) }}">编辑</a>
@endcan
```

**RBAC 的局限：** 当业务规则变成「只有文章作者才能编辑自己的文章」时，纯 RBAC 就力不从心了。这时我们需要引入策略（Policy）或升级到 ABAC。

---

## 四、Laravel 中的 ABAC 实践

ABAC 在 Laravel 中主要通过 **Policy（策略）** 和 **Gate（门面）** 来实现。

### 4.1 创建策略

```bash
php artisan make:policy ArticlePolicy --model=Article
```

### 4.2 编写 ABAC 策略逻辑

```php
<?php

namespace App\Policies;

use App\Models\Article;
use App\Models\User;

class ArticlePolicy
{
    /**
     * 基于多维属性的授权判断
     */
    public function update(User $user, Article $article): bool
    {
        // 属性组合决策：
        // 1. 用户属性：是否是作者
        // 2. 资源属性：文章状态是否可编辑
        // 3. 环境属性：是否在工作时间内

        $isOwner = $user->id === $article->user_id;
        $isDraft = $article->status === 'draft';
        $isWorkHours = now()->isWeekday() && now()->hour >= 9 && now()->hour <= 18;

        // 草稿状态：仅作者可编辑
        if ($isDraft) {
            return $isOwner;
        }

        // 已发布状态：作者 + 管理员可编辑，且在工作时间
        return ($isOwner || $user->hasRole('admin')) && $isWorkHours;
    }

    /**
     * 基于部门属性的访问控制
     */
    public function view(User $user, Article $article): bool
    {
        // 同部门可见
        if ($user->department_id === $article->department_id) {
            return true;
        }

        // 公开文章任意可见
        return $article->is_public;
    }
}
```

### 4.3 注册策略

```php
// App\Providers\AuthServiceProvider.php
protected $policies = [
    Article::class => ArticlePolicy::class,
];
```

### 4.4 在控制器中使用

```php
class ArticleController extends Controller
{
    public function update(Request $request, Article $article)
    {
        $this->authorize('update', $article); // 自动调用 ArticlePolicy@update

        $article->update($request->validated());

        return response()->json($article);
    }

    /**
     * 使用 Gate 进行更灵活的属性判断
     */
    public function export(Request $request, Article $article)
    {
        Gate::authorize('export-article', $article, [
            'format' => $request->input('format'),
            'include_drafts' => $request->boolean('include_drafts'),
        ]);

        // 执行导出逻辑
    }
}
```

### 4.5 自定义 Gate（适用于无模型的场景）

```php
// AuthServiceProvider.php
Gate::define('access-admin-panel', function (User $user) {
    return $user->is_active
        && $user->email_verified_at !== null
        && $user->last_login_at?->diffInDays(now()) <= 30;
});

// 自定义 Gate 带上下文
Gate::define('perform-bulk-action', function (User $user, $model, array $context) {
    return $user->hasRole('admin')
        && $context['action_count'] <= $user->daily_bulk_limit
        && !$user->is_restricted;
});
```

---

## 五、Laravel 中的 ReBAC 实践

ReBAC 在 Laravel 中没有现成的成熟包，但可以通过 **关系图建模 + 图查询** 来实现。以下是一个实用的实现方案。

### 5.1 设计关系图数据模型

```php
// 迁移文件
Schema::create('entity_relations', function (Blueprint $table) {
    $table->id();
    $table->string('subject_type');      // 主体类型 (user, group, org)
    $table->unsignedBigInteger('subject_id');
    $table->string('relation');           // 关系类型 (owner, editor, viewer, member)
    $table->string('object_type');        // 对象类型 (document, project, folder)
    $table->unsignedBigInteger('object_id');
    $table->string('namespace')->nullable();
    $table->timestamps();

    $table->index(['subject_type', 'subject_id']);
    $table->index(['object_type', 'object_id']);
    $table->index(['object_type', 'object_id', 'relation']);
});
```

### 5.2 实现关系存储服务

```php
<?php

namespace App\Services\Authorization;

use App\Models\EntityRelation;
use Illuminate\Support\Facades\DB;

class RelationshipGraph
{
    /**
     * 建立关系
     * 例如：用户A 是 文档X 的 owner
     */
    public function addRelation(
        string $subjectType,
        int    $subjectId,
        string $relation,
        string $objectType,
        int    $objectId,
        ?string $namespace = null
    ): EntityRelation {
        return EntityRelation::create([
            'subject_type' => $subjectType,
            'subject_id'   => $subjectId,
            'relation'     => $relation,
            'object_type'  => $objectType,
            'object_id'    => $objectId,
            'namespace'    => $namespace,
        ]);
    }

    /**
     * 检查关系是否存在（支持递归解析）
     *
     * 示例：检查 用户123 是否可以编辑 文档456
     * 会递归检查：
     *   1. 用户123 --[editor]--> 文档456
     *   2. 用户123 --[member]--> 项目789 --[editor]--> 文档456
     *   3. 用户123 --[member]--> 组织012 --[owner]--> 文档456
     */
    public function checkRelation(
        string $subjectType,
        int    $subjectId,
        string $permission,    // 期望的关系/权限
        string $objectType,
        int    $objectId,
        int    $maxDepth = 5
    ): bool {
        // 权限继承映射
        $permissionHierarchy = [
            'owner'  => ['owner', 'editor', 'viewer'],
            'editor' => ['editor', 'viewer'],
            'viewer' => ['viewer'],
        ];

        return $this->walkGraph(
            $subjectType, $subjectId,
            $objectType, $objectId,
            $permission, $permissionHierarchy,
            $maxDepth, 0, []
        );
    }

    /**
     * 图遍历算法（BFS 实现）
     */
    private function walkGraph(
        string $subjectType,
        int    $subjectId,
        string $targetObjectType,
        int    $targetObjectId,
        string $requiredPermission,
        array  $hierarchy,
        int    $maxDepth,
        int    $currentDepth,
        array  $visited
    ): bool {
        if ($currentDepth >= $maxDepth) {
            return false;
        }

        $key = "{$subjectType}:{$subjectId}";
        if (in_array($key, $visited)) {
            return false;
        }
        $visited[] = $key;

        // 直接关系检查
        $directRelations = EntityRelation::where('subject_type', $subjectType)
            ->where('subject_id', $subjectId)
            ->get();

        foreach ($directRelations as $rel) {
            // 匹配目标对象
            if ($rel->object_type === $targetObjectType && $rel->object_id === $targetObjectId) {
                $allowed = $hierarchy[$rel->relation] ?? [];
                if (in_array($requiredPermission, $allowed)) {
                    return true;
                }
            }

            // 递归：通过中间实体继续遍历
            // 例如：user → group → project → document
            if ($this->walkGraph(
                $rel->object_type, $rel->object_id,
                $targetObjectType, $targetObjectId,
                $requiredPermission, $hierarchy,
                $maxDepth, $currentDepth + 1, $visited
            )) {
                return true;
            }
        }

        return false;
    }

    /**
     * 获取对象的所有直接关系（用于管理界面）
     */
    public function getDirectRelations(string $objectType, int $objectId): array
    {
        return EntityRelation::where('object_type', $objectType)
            ->where('object_id', $objectId)
            ->with(['subject'])
            ->get()
            ->map(fn($r) => [
                'subject'  => "{$r->subject_type}:{$r->subject_id}",
                'relation' => $r->relation,
            ])
            ->toArray();
    }
}
```

### 5.3 定义权限 Schema（类似 SpiceDB 的 Zanzibar 模型）

```php
<?php

namespace App\Services\Authorization;

/**
 * 权限模式定义
 * 参考 Google Zanzibar 论文的设计理念
 */
class PermissionSchema
{
    // 文档权限定义
    const DOCUMENT_SCHEMA = [
        'relations' => [
            'owner'  => 'direct',         // 直接赋值
            'editor' => 'direct',         // 直接赋值
            'viewer' => ['direct', 'editor:implied', 'owner:implied'],
            // viewer 可以由直接赋值、editor 隐含、owner 隐含获得
        ],
        'permissions' => [
            'read'   => 'viewer',
            'write'  => 'editor',
            'delete' => 'owner',
            'share'  => 'owner',
        ],
    ];

    // 项目权限定义
    const PROJECT_SCHEMA = [
        'relations' => [
            'admin'  => 'direct',
            'member' => ['direct', 'admin:implied'],
        ],
        'permissions' => [
            'manage'  => 'admin',
            'contribute' => 'member',
        ],
    ];
}
```

### 5.4 创建 ReBAC Gate 和中间件

```php
// AuthServiceProvider.php
Gate::define('rebac-access', function (
    User $user,
    string $objectType,
    int $objectId,
    string $permission
) {
    $graph = app(RelationshipGraph::class);

    return $graph->checkRelation(
        'user', $user->id,
        $permission,
        $objectType,
        $objectId
    );
});
```

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class RebacMiddleware
{
    /**
     * 用法：rebac:document,read
     */
    public function handle(Request $request, Closure $next, string $objectType, string $permission)
    {
        $objectId = $request->route()->parameter('document')
            ?? $request->route()->parameter('project')
            ?? $request->route()->parameter('id');

        if (!$objectId || !Gate::allows('rebac-access', [$objectType, (int)$objectId, $permission])) {
            abort(403, '您没有权限执行此操作');
        }

        return $next($request);
    }
}
```

### 5.5 实际使用

```php
// 路由
Route::middleware('rebac:document,write')->group(function () {
    Route::put('/documents/{document}', [DocumentController::class, 'update']);
});

// 控制器中
class DocumentController extends Controller
{
    public function share(Request $request, Document $document)
    {
        Gate::authorize('rebac-access', ['document', $document->id, 'share']);

        // 建立新关系：被分享者成为 viewer
        app(RelationshipGraph::class)->addRelation(
            'user', $request->input('target_user_id'),
            'viewer',
            'document', $document->id
        );

        return response()->json(['message' => '分享成功']);
    }
}
```

---

## 六、混合方案：RBAC + ReBAC

在实际项目中，最有效的往往是混合方案。以下是一个将 RBAC 的角色系统与 ReBAC 的关系图结合的实现：

```php
<?php

namespace App\Services\Authorization;

use App\Models\User;

class HybridAuthorizationService
{
    public function __construct(
        private RelationshipGraph $graph
    ) {}

    public function can(User $user, string $permission, $resource): bool
    {
        $objectType = class_basename($resource);
        $objectId = $resource->getKey();

        // 第一层：RBAC 角色检查（快速路径）
        if ($this->checkRolePermission($user, $permission, $objectType)) {
            return true;
        }

        // 第二层：ReBAC 关系检查（精确路径）
        if ($this->graph->checkRelation(
            'user', $user->id,
            $this->mapPermissionToRelation($permission),
            strtolower($objectType),
            $objectId
        )) {
            return true;
        }

        // 第三层：ABAC 属性检查（兜底路径）
        return $this->checkAttributePolicy($user, $permission, $resource);
    }

    private function checkRolePermission(User $user, string $permission, string $objectType): bool
    {
        // 超级管理员拥有所有权限
        if ($user->hasRole('super-admin')) {
            return true;
        }

        // 基于角色的权限映射
        $rolePermissions = [
            'admin'  => ['*'],
            'manager' => ['read', 'write', 'share'],
            'viewer'  => ['read'],
        ];

        foreach ($user->roles as $role) {
            $allowed = $rolePermissions[$role->name] ?? [];
            if (in_array('*', $allowed) || in_array($permission, $allowed)) {
                return true;
            }
        }

        return false;
    }

    private function mapPermissionToRelation(string $permission): string
    {
        return match ($permission) {
            'read'   => 'viewer',
            'write'  => 'editor',
            'delete' => 'owner',
            'share'  => 'owner',
            default  => $permission,
        };
    }

    private function checkAttributePolicy(User $user, string $permission, $resource): bool
    {
        // 基于属性的兜底规则
        if (method_exists($resource, 'isPublic') && $resource->isPublic()) {
            return in_array($permission, ['read']);
        }

        return false;
    }
}
```

### 使用 Trait 统一授权接口

```php
trait Authorizable
{
    public function authorizeAction(string $permission, $resource = null): bool
    {
        return app(HybridAuthorizationService::class)
            ->can(auth()->user(), $permission, $resource ?? $this);
    }
}

// 在控制器中
class ProjectController extends Controller
{
    use Authorizable;

    public function update(Request $request, Project $project)
    {
        $this->authorizeAction('write', $project);

        $project->update($request->validated());
        return response()->json($project);
    }
}
```

---

## 七、性能优化策略

### 7.1 ReBAC 关系缓存

```php
class CachedRelationshipGraph extends RelationshipGraph
{
    private const CACHE_TTL = 300; // 5 分钟

    public function checkRelation(...$args): bool
    {
        $cacheKey = 'rebac:' . md5(implode(':', $args));

        return cache()->remember($cacheKey, self::CACHE_TTL, function () use ($args) {
            return parent::checkRelation(...$args);
        });
    }

    /**
     * 关系变更时清除相关缓存
     */
    public function addRelation(...$args): EntityRelation
    {
        $result = parent::addRelation(...$args);

        // 清除涉及该对象的所有缓存
        cache()->forget("rebac:*{$result->object_type}:{$result->object_id}*");

        return $result;
    }
}
```

### 7.2 批量预加载权限

```php
// 在查询列表时，预加载当前用户对所有文档的权限
$documents = Document::query()
    ->where('department_id', $user->department_id)
    ->get();

// 批量获取权限，避免 N+1 问题
$documentIds = $documents->pluck('id');
$relations = EntityRelation::where('subject_type', 'user')
    ->where('subject_id', $user->id)
    ->where('object_type', 'document')
    ->whereIn('object_id', $documentIds)
    ->get()
    ->keyBy('object_id');

foreach ($documents as $doc) {
    $doc->user_relation = $relations->get($doc->id)?->relation;
}
```

---

## 八、如何选择？

### 决策树

```
你的业务需要什么样的授权？
│
├── 基于固定角色（管理员/编辑/用户）
│   └── ✅ 选择 RBAC（spatie/laravel-permission）
│
├── 需要基于属性动态判断（时间、部门、资源状态）
│   └── ✅ 选择 ABAC（Laravel Policy + Gate）
│
├── 涉及社交关系/协作关系（好友、项目成员、组织）
│   └── ✅ 选择 ReBAC（自建关系图服务）
│
└── 多种需求混合
    └── ✅ 混合方案（RBAC 基础 + ABAC/ReBAC 增强）
```

### 实际项目建议

| 项目类型 | 推荐方案 | 理由 |
|---------|---------|------|
| 企业后台管理系统 | RBAC | 角色固定，管理简单 |
| 内容管理平台 | RBAC + Policy | 角色 + 所有者判断 |
| 协作文档工具 | ReBAC + RBAC | 复杂的分享/协作关系 |
| 社交网络平台 | ReBAC | 好友关系、可见性控制 |
| 多租户 SaaS | RBAC + ABAC | 角色 + 租户属性隔离 |

---

## 九、总结

- **RBAC** 是入门首选，实现简单，适合角色清晰的场景
- **ABAC** 通过 Laravel 原生的 Policy/Gate 即可实现，适合需要灵活属性判断的场景
- **ReBAC** 适合关系驱动的社交/协作应用，实现复杂但表达能力最强
- 现实项目中，**混合方案** 往往是最佳选择

授权系统的设计没有银弹，关键是理解业务需求，选择合适的抽象层次。从 RBAC 开始，在需要时逐步引入 ABAC 或 ReBAC，是最务实的演进路径。

---

## 十、常见踩坑案例

在生产环境中实施授权系统，以下是最常见的陷阱和对应的解决方案：

### 10.1 RBAC 角色爆炸问题

**问题描述：** 当业务需要「某部门的经理可以管理该部门所有项目」这类需求时，如果为每个部门创建独立角色（`manager_dept_1`、`manager_dept_2`……），角色数量会随部门增长线性膨胀，最终不可维护。

```php
// ❌ 错误做法：为每个部门创建独立角色
$roles = Department::all()->map(fn($dept) => "manager_{$dept->id}");
foreach ($roles as $roleName) {
    Role::create(['name' => $roleName]);
}
// 结果：100 个部门 = 100 个角色，维护噩梦

// ✅ 正确做法：RBAC + ABAC 混合
class DepartmentPolicy
{
    public function manage(User $user, Department $department): bool
    {
        return $user->hasRole('manager')
            && $user->department_id === $department->id;
    }
}
```

### 10.2 权限缓存导致的「幽灵权限」

**问题描述：** spatie/laravel-permission 默认缓存权限，修改角色或权限后，旧缓存未清除导致用户仍持有已撤销的权限。

```php
// 场景：撤销了用户的 admin 角色，但用户仍能访问管理后台
$user->removeRole('admin');
// 此时如果不清缓存，$user->hasRole('admin') 可能仍然返回 true

// ✅ 解决方案一：手动清除缓存
$user->forgetCachedPermissions();

// ✅ 解决方案二：在 Observer 中自动清除
class RoleObserver
{
    public function saved($model): void
    {
        // 角色变更后，清除所有相关用户的缓存
        app(\Spatie\Permission\PermissionRegistrar::class)->forgetCachedPermissions();
    }
}

// ✅ 解决方案三：开发环境关闭缓存
// config/permission.php
'cache' => [
    'expiration_time' => \DateInterval::createFromDateString('0'), // 开发环境
],
```

### 10.3 Policy 方法命名陷阱

**问题描述：** Laravel 的 `$this->authorize('view', $article)` 默认查找 Policy 中的 `view` 方法，但 `viewAny` 和 `view` 的调用场景不同，容易混淆。

```php
class ArticlePolicy
{
    /**
     * 控制列表访问（对应 authorize('viewAny', Article::class)）
     * 注意：这里接收的是类名字符串，不是模型实例
     */
    public function viewAny(User $user): bool
    {
        return true; // 所有人可查看文章列表
    }

    /**
     * 控制单个资源访问（对应 authorize('view', $article)）
     * 注意：这里接收的是模型实例
     */
    public function view(User $user, Article $article): bool
    {
        return $article->is_published || $user->id === $article->user_id;
    }
}

// ❌ 常见错误：在列表接口使用了 view 而非 viewAny
public function index(Request $request)
{
    // 这会抛出 AuthorizationException，因为找不到匹配的 Policy 方法
    $this->authorize('view', Article::class);
}

// ✅ 正确做法
public function index(Request $request)
{
    $this->authorize('viewAny', Article::class);
    $articles = Article::query()->paginate();
    return ArticleResource::collection($articles);
}
```

### 10.4 N+1 查询导致的授权性能灾难

**问题描述：** 在列表页对每条数据调用 `$user->can('update', $article)`，会触发 N 次数据库查询。

```php
// ❌ 性能灾难：100 条数据 = 100 次额外查询
$articles = Article::all();
foreach ($articles as $article) {
    $article->can_update = $user->can('update', $article);
}

// ✅ 解决方案：批量预加载权限数据
$articles = Article::query()
    ->with(['user']) // 预加载作者关系
    ->get();

// 一次性加载当前用户的所有关系
$userArticleIds = EntityRelation::where('subject_type', 'user')
    ->where('subject_id', $user->id)
    ->where('object_type', 'article')
    ->whereIn('object_id', $articles->pluck('id'))
    ->get()
    ->keyBy('object_id');

// 使用内存中的数据快速判断
foreach ($articles as $article) {
    $relation = $userArticleIds->get($article->id);
    $article->can_update = $relation
        && in_array($relation->relation, ['owner', 'editor']);
}
```

### 10.5 ReBAC 递归深度失控

**问题描述：** 关系图遍历时，如果存在循环引用或层级过深，会导致栈溢出或查询超时。

```php
// ✅ 防御措施：限制递归深度 + 环检测
public function checkRelation(...$args): bool
{
    $maxDepth = 5; // 生产环境建议不超过 5 层
    $visited = []; // 环检测集合

    return $this->walkGraph(
        $args[0], $args[1],
        $args[2], $args[3],
        $args[4], $this->hierarchy,
        $maxDepth, 0, $visited
    );
}
```

---

## 十一、授权测试策略

授权逻辑是安全关键代码，必须有完善的测试覆盖：

```php
use Tests\TestCase;
use App\Models\User;
use App\Models\Article;

class ArticlePolicyTest extends TestCase
{
    /** @test */
    public function author_can_update_own_draft(): void
    {
        $user = User::factory()->create();
        $article = Article::factory()->create([
            'user_id' => $user->id,
            'status'  => 'draft',
        ]);

        $this->assertTrue($user->can('update', $article));
    }

    /** @test */
    public function non_author_cannot_update_others_draft(): void
    {
        $user = User::factory()->create();
        $article = Article::factory()->create([
            'status' => 'draft',
            'user_id' => User::factory()->create()->id,
        ]);

        $this->assertFalse($user->can('update', $article));
    }

    /** @test */
    public function admin_can_update_published_article_during_work_hours(): void
    {
        // 使用 Carbon::setTestNow() 模拟工作时间
        $this->travelTo(now()->setHour(10)->setDayOfWeek(3));

        $admin = User::factory()->create();
        $admin->assignRole('admin');

        $article = Article::factory()->create(['status' => 'published']);

        $this->assertTrue($admin->can('update', $article));
    }

    /** @test */
    public function admin_cannot_update_published_article_outside_work_hours(): void
    {
        // 模拟非工作时间（周六晚上 22 点）
        $this->travelTo(now()->setHour(22)->setDayOfWeek(6));

        $admin = User::factory()->create();
        $admin->assignRole('admin');

        $article = Article::factory()->create(['status' => 'published']);

        $this->assertFalse($admin->can('update', $article));
    }
}
```

---

## 十二、三种模型速查决策表

| 你的需求特征 | 推荐模型 | Laravel 实现方案 | 预期开发时间 |
|-------------|---------|-----------------|------------|
| 固定角色（管理员/编辑/用户） | RBAC | spatie/laravel-permission | 1-2 天 |
| 角色 + 资源所有者判断 | RBAC + Policy | spatie + artisan make:policy | 2-3 天 |
| 多维属性组合判断 | ABAC | Policy + Gate + 自定义 Service | 3-5 天 |
| 社交关系/协作关系 | ReBAC | 自建关系图 or OpenFGA | 5-10 天 |
| 多租户 SaaS | RBAC + ABAC | 角色 + 租户属性隔离 | 5-7 天 |
| 大型协作平台（类 Google Docs） | 混合方案 | RBAC 基础 + ReBAC 增强 | 10-15 天 |

---

*参考资料：*
- [Google Zanzibar: A Global System for Storing and Evaluating Access Control Lists](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)
- [Spatie Laravel Permission 文档](https://spatie.be/docs/laravel-permission)
- [Laravel 授权官方文档](https://laravel.com/docs/authorization)

---

## 相关阅读

- [OpenFGA 实战：细粒度授权引擎（Zanzibar 模型）——Laravel 中的关系型权限控制与 ReBAC 落地](/categories/架构/openfga-zanzibar-rebac-laravel/)
- [API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 的反爬与反滥用工程化方案](/categories/架构/API-Abuse-Prevention-实战-Bot检测-速率限制-指纹识别-Laravel-API反爬与反滥用工程化方案/)
- [Laravel 幂等性设计模式实战：请求去重、支付回调防重复、队列消息 Exactly-Once](/categories/Laravel/PHP/Laravel-幂等性设计模式实战-请求去重-支付回调防重复-Exactly-Once/)
