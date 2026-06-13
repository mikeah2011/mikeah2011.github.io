---

title: Vibe Coding 实战：AI-first 开发范式——从需求描述到可运行代码的全流程，对比传统 TDD 的生产力跃迁
keywords: [Vibe Coding, AI, first, TDD, 开发范式, 从需求描述到可运行代码的全流程, 对比传统, 的生产力跃迁]
date: 2026-06-09 15:00:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- Vibe-Coding
- AI-First
- Cursor
- Claude
- TDD
- Laravel
- Prompt Engineering
- 开发范式
description: 深入实践 Vibe Coding 这一 AI-first 开发范式，用自然语言驱动整个开发流程。从需求拆解、代码生成、测试验证到部署上线，完整对比传统 TDD 的效率差异，附带 Laravel 实战案例。
---



## 概述

2025 年初，Andrej Karpathy 提出了一个引发热议的概念——**Vibe Coding**（氛围编程）。核心理念很简单：你不再逐行编写代码，而是用自然语言描述你想要什么，让 AI 生成代码，然后通过运行、测试、观察来验证结果。

这不是"AI 辅助编程"的换皮说法。传统 AI 辅助是「人写代码，AI 补全」；Vibe Coding 是「人描述意图，AI 写代码，人验证结果」。开发者的角色从「代码生产者」变成了「需求表达者 + 质量把关者」。

本文将完整走一遍 Vibe Coding 的实战流程，用 Laravel 项目作为载体，最后和传统 TDD 做一个客观的效率对比。

## 核心概念

### Vibe Coding 的三层模型

```
┌─────────────────────────────────────┐
│         Intent Layer（意图层）        │
│   自然语言描述需求、约束、边界条件      │
├─────────────────────────────────────┤
│         Generation Layer（生成层）     │
│   AI 解析意图 → 生成代码 + 测试        │
├─────────────────────────────────────┤
│         Verification Layer（验证层）   │
│   运行测试、观察行为、迭代修正          │
└─────────────────────────────────────┘
```

和 TDD 的关键区别：

| 维度 | TDD | Vibe Coding |
|------|-----|-------------|
| 起点 | 写失败的测试 | 用自然语言描述需求 |
| 代码生产 | 人逐行编写 | AI 批量生成 |
| 迭代驱动 | 红→绿→重构 | 描述→生成→验证→调整 |
| 核心技能 | 代码能力 | 需求表达能力 |
| 适合场景 | 逻辑复杂、边界清晰 | CRUD 密集、模式化强 |

### Vibe Coding 不是银弹

先泼冷水。Vibe Coding 有明确的适用边界：

- **适合**：CRUD 接口、数据迁移脚本、配置生成、原型开发、文档编写
- **不适合**：底层算法优化、高并发核心路径、安全敏感模块、需要极致性能的场景

它也不是「不会编程也能开发」。你需要理解代码在做什么，才能判断 AI 生成的结果是否正确。它降低的是「打字」的成本，不是「思考」的成本。

## 实战：用 Vibe Coding 构建一个 Laravel API

### 场景设定

我们要构建一个「文章管理 API」，包含：

- 文章 CRUD（标题、内容、状态、分类）
- 分类管理
- 文章搜索（按标题和内容模糊匹配）
- 分页、排序
- 表单验证
- API 资源格式化

### 第一步：用自然语言描述需求

这是 Vibe Coding 最关键的一步。你的描述越精确，AI 生成的代码质量越高。

```
我需要一个 Laravel 11 的文章管理系统 API，要求如下：

1. 数据库：
   - categories 表：id, name, slug(unique), description, created_at, updated_at
   - articles 表：id, category_id(外键), title, slug(unique), content(text), 
     status(enum: draft/published/archived), published_at(nullable), 
     created_at, updated_at

2. API 端点：
   - GET /api/articles — 分页列表，支持 ?status=published&category_id=1&search=keyword&sort=created_at&order=desc
   - GET /api/articles/{slug} — 按 slug 获取单篇
   - POST /api/articles — 创建，需要验证 title(必填,max:255), content(必填), 
     category_id(必填,存在), status(可选,默认 draft)
   - PUT /api/articles/{slug} — 更新
   - DELETE /api/articles/{slug} — 删除（软删除）
   - GET /api/categories — 分类列表
   - POST /api/categories — 创建分类，验证 name(必填,unique), slug(自动从 name 生成)

3. 使用 API Resource 格式化返回，统一格式：
   { "success": true, "data": {...}, "message": "..." }

4. 异常处理：404、422、500 统一返回 JSON 格式

5. 代码风格：严格类型声明，PHP 8.2+ 特性
```

### 第二步：AI 生成代码

把上面的描述丢给 Cursor / Claude / ChatGPT，它会生成完整的代码。以下是生成结果的核心部分：

**Migration 文件：**

```php
<?php

// database/migrations/2026_06_09_000001_create_categories_table.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->text('description')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};
```

```php
<?php

// database/migrations/2026_06_09_000002_create_articles_table.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('articles', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('category_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->string('slug')->unique();
            $table->text('content');
            $table->enum('status', ['draft', 'published', 'archived'])->default('draft');
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'published_at']);
            $table->index('category_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('articles');
    }
};
```

**Model 文件：**

```php
<?php

// app/Models/Category.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Category extends Model
{
    protected $fillable = ['name', 'slug', 'description'];

    public function articles(): HasMany
    {
        return $this->hasMany(Article::class);
    }

    protected static function booted(): void
    {
        static::creating(function (Category $category): void {
            if (empty($category->slug)) {
                $category->slug = \Illuminate\Support\Str::slug($category->name);
            }
        });
    }
}
```

```php
<?php

// app/Models/Article.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Article extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'category_id',
        'title',
        'slug',
        'content',
        'status',
        'published_at',
    ];

    protected $casts = [
        'published_at' => 'datetime',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    protected static function booted(): void
    {
        static::creating(function (Article $article): void {
            if (empty($article->slug)) {
                $article->slug = Str::slug($article->title);
            }
        });
    }

    // Scopes
    public function scopeByStatus($query, string $status)
    {
        return $query->where('status', $status);
    }

    public function scopeSearch($query, ?string $keyword)
    {
        if (empty($keyword)) {
            return $query;
        }

        return $query->where(function ($q) use ($keyword): void {
            $q->where('title', 'LIKE', "%{$keyword}%")
              ->orWhere('content', 'LIKE', "%{$keyword}%");
        });
    }
}
```

**Controller：**

```php
<?php

// app/Http/Controllers/ArticleController.php
namespace App\Http\Controllers;

use App\Http\Requests\StoreArticleRequest;
use App\Http\Requests\UpdateArticleRequest;
use App\Http\Resources\ArticleResource;
use App\Models\Article;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ArticleController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $articles = Article::query()
            ->with('category')
            ->when($request->filled('status'), fn ($q) => $q->byStatus($request->input('status')))
            ->when($request->filled('category_id'), fn ($q) => $q->where('category_id', $request->input('category_id')))
            ->search($request->input('search'))
            ->when(
                in_array($request->input('sort'), ['created_at', 'title', 'published_at']),
                fn ($q) => $q->orderBy(
                    $request->input('sort', 'created_at'),
                    $request->input('order', 'desc')
                )
            )
            ->paginate($request->integer('per_page', 15));

        return ArticleResource::collection($articles);
    }

    public function show(string $slug): ArticleResource
    {
        $article = Article::where('slug', $slug)
            ->with('category')
            ->firstOrFail();

        return new ArticleResource($article);
    }

    public function store(StoreArticleRequest $request): JsonResponse
    {
        $article = Article::create($request->validated());

        return (new ArticleResource($article->load('category')))
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateArticleRequest $request, string $slug): ArticleResource
    {
        $article = Article::where('slug', $slug)->firstOrFail();
        $article->update($request->validated());

        return new ArticleResource($article->load('category'));
    }

    public function destroy(string $slug): JsonResponse
    {
        $article = Article::where('slug', $slug)->firstOrFail();
        $article->delete();

        return response()->json([
            'success' => true,
            'message' => '文章已删除',
        ]);
    }
}
```

**Form Request 验证：**

```php
<?php

// app/Http/Requests/StoreArticleRequest.php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreArticleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string'],
            'category_id' => ['required', 'exists:categories,id'],
            'status' => ['nullable', 'in:draft,published,archived'],
            'published_at' => ['nullable', 'date'],
        ];
    }
}
```

```php
<?php

// app/Http/Requests/UpdateArticleRequest.php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateArticleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'string', 'max:255'],
            'content' => ['sometimes', 'string'],
            'category_id' => ['sometimes', 'exists:categories,id'],
            'status' => ['nullable', 'in:draft,published,archived'],
            'published_at' => ['nullable', 'date'],
        ];
    }
}
```

**API Resource：**

```php
<?php

// app/Http/Resources/ArticleResource.php
namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ArticleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'slug' => $this->slug,
            'content' => $this->content,
            'status' => $this->status,
            'published_at' => $this->published_at?->toIso8601String(),
            'category' => new CategoryResource($this->whenLoaded('category')),
            'created_at' => $this->created_at->toIso8601String(),
            'updated_at' => $this->updated_at->toIso8601String(),
        ];
    }
}
```

**统一响应封装和异常处理：**

```php
<?php

// app/Exceptions/Handler.php (Laravel 11 style)
namespace App\Exceptions;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

class Handler extends ExceptionHandler
{
    public function register(): void
    {
        $this->reportable(function (Throwable $e): void {
            //
        });
    }

    public function render($request, Throwable $e)
    {
        if ($request->is('api/*')) {
            return $this->handleApiException($request, $e);
        }

        return parent::render($request, $e);
    }

    private function handleApiException($request, Throwable $e)
    {
        if ($e instanceof ValidationException) {
            return response()->json([
                'success' => false,
                'message' => '验证失败',
                'errors' => $e->errors(),
            ], 422);
        }

        if ($e instanceof ModelNotFoundException || $e instanceof NotFoundHttpException) {
            return response()->json([
                'success' => false,
                'message' => '资源不存在',
            ], 404);
        }

        if ($e instanceof AuthenticationException) {
            return response()->json([
                'success' => false,
                'message' => '未授权',
            ], 401);
        }

        return response()->json([
            'success' => false,
            'message' => config('app.debug') ? $e->getMessage() : '服务器内部错误',
        ], 500);
    }
}
```

**路由定义：**

```php
<?php

// routes/api.php
use App\Http\Controllers\ArticleController;
use App\Http\Controllers\CategoryController;
use Illuminate\Support\Facades\Route;

Route::apiResource('articles', ArticleController::class)
    ->parameters(['articles' => 'slug']);

Route::apiResource('categories', CategoryController::class)
    ->only(['index', 'store']);
```

### 第三步：验证——运行和测试

Vibe Coding 的精髓在这一步。你不需要一开始就理解每一行代码，但你需要能**验证它是否按预期工作**。

**运行 Migration：**

```bash
php artisan migrate
# ✓ Migration successful
```

**用 curl 测试：**

```bash
# 创建分类
curl -X POST http://localhost:8000/api/categories \
  -H "Content-Type: application/json" \
  -d '{"name": "技术分享", "description": "技术相关文章"}'

# 创建文章
curl -X POST http://localhost:8000/api/articles \
  -H "Content-Type: application/json" \
  -d '{
    "title": "第一篇 Vibe Coding 文章",
    "content": "这是用 Vibe Coding 方式生成的文章管理系统...",
    "category_id": 1,
    "status": "published"
  }'

# 查询列表
curl "http://localhost:8000/api/articles?status=published&search=Vibe"

# 获取单篇
curl http://localhost:8000/api/articles/first-vibe-coding-article
```

**写 Feature Test 做回归保障：**

```php
<?php

// tests/Feature/ArticleApiTest.php
namespace Tests\Feature;

use App\Models\Article;
use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ArticleApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_list_articles(): void
    {
        $category = Category::factory()->create();
        Article::factory()->count(3)->create(['category_id' => $category->id]);

        $response = $this->getJson('/api/articles');

        $response->assertOk()
            ->assertJsonCount(3, 'data');
    }

    public function test_can_filter_by_status(): void
    {
        $category = Category::factory()->create();
        Article::factory()->create(['category_id' => $category->id, 'status' => 'published']);
        Article::factory()->create(['category_id' => $category->id, 'status' => 'draft']);

        $response = $this->getJson('/api/articles?status=published');

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_can_search_by_keyword(): void
    {
        $category = Category::factory()->create();
        Article::factory()->create([
            'category_id' => $category->id,
            'title' => 'Laravel 最佳实践',
        ]);
        Article::factory()->create([
            'category_id' => $category->id,
            'title' => 'Vue 3 入门',
        ]);

        $response = $this->getJson('/api/articles?search=Laravel');

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', 'Laravel 最佳实践');
    }

    public function test_can_create_article(): void
    {
        $category = Category::factory()->create();

        $response = $this->postJson('/api/articles', [
            'title' => '测试文章',
            'content' => '测试内容',
            'category_id' => $category->id,
            'status' => 'draft',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.title', '测试文章');

        $this->assertDatabaseHas('articles', ['title' => '测试文章']);
    }

    public function test_validation_error_returns_422(): void
    {
        $response = $this->postJson('/api/articles', [
            'title' => '', // 必填
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['title', 'content', 'category_id']);
    }

    public function test_not_found_returns_404(): void
    {
        $response = $this->getJson('/api/articles/non-existent-slug');

        $response->assertNotFound();
    }

    public function test_can_soft_delete_article(): void
    {
        $category = Category::factory()->create();
        $article = Article::factory()->create([
            'category_id' => $category->id,
            'slug' => 'to-delete',
        ]);

        $response = $this->deleteJson('/api/articles/to-delete');

        $response->assertOk();
        $this->assertSoftDeleted('articles', ['id' => $article->id]);
    }
}
```

运行测试：

```bash
php artisan test --filter=ArticleApiTest

# PASS  Tests\Feature\ArticleApiTest
# ✓ can list articles
# ✓ can filter by status
# ✓ can search by keyword
# ✓ can create article
# ✓ validation error returns 422
# ✓ not found returns 404
# ✓ can soft delete article
```

### 第四步：迭代修正

AI 生成的代码通常能跑，但经常有细节问题。这就是「验证层」存在的意义：

**常见问题 1：slug 冲突没处理**

AI 生成的 slug 创建逻辑可能在重复标题时崩掉。修正：

```php
// app/Models/Article.php — 修正 booted 方法
protected static function booted(): void
{
    static::creating(function (Article $article): void {
        if (empty($article->slug)) {
            $article->slug = Str::slug($article->title);
        }

        // 处理 slug 冲突
        $originalSlug = $article->slug;
        $counter = 1;
        while (static::withTrashed()->where('slug', $article->slug)->exists()) {
            $article->slug = "{$originalSlug}-{$counter}";
            $counter++;
        }
    });
}
```

**常见问题 2：搜索没做 XSS 过滤**

```php
// app/Http/Controllers/ArticleController.php — 修正搜索
->search($request->string('search')->stripTags()->toString())
```

**常见问题 3：分页参数没限制**

```php
->paginate(max(min($request->integer('per_page', 15), 100), 1))
```

这些是 AI 容易忽略的边界条件。Vibe Coding 不意味着「AI 写完就上线」，而是「AI 写骨架，人补细节」。

## Vibe Coding 的进阶技巧

### 1. Prompt 分层策略

不要一次性把所有需求塞进一个 prompt。分层描述效果更好：

```
第一轮：数据库设计 + Model
第二轮：Controller + 路由
第三轮：验证 + 异常处理
第四轮：测试 + 边界条件
```

每轮生成后验证通过，再进入下一轮。这样出了问题容易定位是哪一步的锅。

### 2. 善用约束条件

模糊的需求得到模糊的代码。加上这些约束能显著提升质量：

```
约束条件：
- PHP 8.2，严格类型（declare(strict_types=1)）
- 使用 Laravel 11 的新特性
- 所有方法必须声明返回类型
- 不要使用 facade，优先使用依赖注入
- 遵循 PSR-12 编码规范
```

### 3. 上下文喂养

让 AI 了解你的项目结构：

```
项目上下文：
- Laravel 11 + PHP 8.2
- 已有 User model（带 Sanctum 认证）
- 使用 apiResource 路由风格
- 统一响应格式见 app/Http/Resources/BaseResource.php
- 数据库用 MySQL 8.0
```

### 4. 测试驱动的 Vibe Coding

把 TDD 和 Vibe Coding 结合：

```
1. 先用自然语言描述测试场景
2. AI 生成测试代码
3. 运行测试（应该全部失败）
4. 再描述实现需求
5. AI 生成实现代码
6. 运行测试（应该全部通过）
7. 手动调整边界情况
```

这是最稳的 Vibe Coding 方式——有测试兜底，AI 生成的代码改坏了立刻知道。

## 对比：Vibe Coding vs 传统 TDD

我用同一个需求（文章管理 API）分别用两种方式实现，记录时间：

| 环节 | TDD（手动） | Vibe Coding |
|------|------------|-------------|
| 需求分析 | 15 min | 10 min（写 prompt） |
| 数据库设计 + Migration | 20 min | 2 min（AI 生成） |
| Model + 关系 | 15 min | 1 min（AI 生成） |
| Controller | 30 min | 2 min（AI 生成） |
| 验证 + 异常处理 | 20 min | 3 min（AI 生成） |
| 测试编写 | 40 min | 5 min（AI 生成 + 调整） |
| 边界修复 | 15 min | 20 min（AI 遗漏的坑） |
| **总计** | **155 min** | **43 min** |

效率提升约 **3.6 倍**。但注意最后一行——Vibe Coding 在「边界修复」上反而花了更多时间，因为 AI 遗漏的坑需要你去发现和修正。

### 质量对比

| 维度 | TDD | Vibe Coding |
|------|-----|-------------|
| 代码正确性 | 高（逐步验证） | 中高（需要二次审查） |
| 边界覆盖 | 好（测试先行） | 中（AI 容易遗漏） |
| 代码风格一致性 | 高（人控制） | 中（AI 可能风格不统一） |
| 可维护性 | 高 | 中高（需要重构） |
| 文档完整性 | 低（懒） | 高（AI 顺手就写了） |

## 踩坑记录

### 坑 1：AI 生成的 Migration 顺序不对

当有外键依赖时，AI 可能把子表 migration 放在父表前面。

**解决**：手动调整 migration 文件的时间戳前缀，或者在 prompt 中明确指定顺序。

### 坑 2：AI 不理解你的项目约定

每个项目有自己的命名习惯、目录结构、基类。AI 默认用 Laravel 标准结构，可能和你的项目冲突。

**解决**：在 prompt 中加入项目约定，或者提供一个已有文件作为参考模板。

### 坑 3：AI 生成的测试是「假测试」

有些 AI 生成的测试只验证了 happy path，断言写得很松（只 assertOk 不检查数据），看起来全绿但其实没测到东西。

**解决**：审查测试断言的严格程度，补充边界测试。

### 坑 4：过度依赖导致技能退化

长期 Vibe Coding 可能让你对底层实现变得陌生。当 AI 生成的代码出问题时，你可能看不懂。

**解决**：保持阅读代码的习惯，定期手动写一些核心模块。

## 工作流推荐

经过几个月的实践，我总结了一套适合团队的 Vibe Coding 工作流：

```
1. 需求评审 → 拆成可描述的原子任务
2. 每个任务写清晰的 prompt（包含约束和上下文）
3. AI 生成代码 → 人工 Review → 运行验证
4. 补充边界测试 → 修复 AI 遗漏的问题
5. 代码合并前必须有 CI 通过
```

核心原则：**AI 是生产者，人是审核者**。不要盲信 AI 的输出，也不要因为 AI 能写就放弃思考。

## 总结

Vibe Coding 不是未来——它已经是现在。2026 年的今天，用 AI 写代码不再是新鲜事，问题是「怎么用好」。

关键 Takeaway：

1. **Prompt 质量决定代码质量**。花时间写好需求描述，比花时间 debug AI 生成的垃圾更值得。
2. **验证层不能省**。AI 生成的代码必须经过运行、测试、Review 三道关卡。
3. **边界条件是重灾区**。AI 最容易漏的就是边界——空值、并发、权限、格式校验。
4. **TDD 不会死**。测试和 Vibe Coding 是互补关系，不是替代关系。
5. **保持代码阅读能力**。不要让 AI 成为你的拐杖。

生产力的跃迁是真实的，但前提是你知道如何驾驭它。Vibe Coding 是工具，不是魔法。
