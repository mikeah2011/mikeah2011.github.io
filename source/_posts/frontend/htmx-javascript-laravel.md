---

title: HTMX 实战：不用 JavaScript 框架也能做交互——Laravel + HTMX 的超轻量前后端方案
keywords: [HTMX, JavaScript, Laravel, 不用, 框架也能做交互, 的超轻量前后端方案]
date: 2026-06-02 10:00:00
tags:
- HTMX
- 前端
- Laravel
- Blade
- 轻量级
- 交互
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: HTMX 是一个仅 14KB 的轻量级 JavaScript 库，通过 HTML 属性即可实现 AJAX 请求、动态内容替换和实时交互，无需复杂的前端框架。本文深入讲解 HTMX 核心概念与 Laravel + Blade 的完整集成方案，涵盖中间件设计、CRUD 全栈实现、实时搜索、无限滚动、拖拽排序、乐观 UI 等实战模式，并提供与 React/Vue 的方案对比和渐进式迁移策略，帮助后端开发者用最少的代码构建优秀的交互体验。
---




在 React、Vue、Svelte 等前端框架大行其道的今天，HTMX 以其"用 HTML 属性做 AJAX"的极简哲学，为那些不需要复杂单页应用的项目提供了一条截然不同的路径。HTMX 的核心理念是：HTML 本身就是超媒体，它天然支持链接和表单提交；HTMX 只是把这种能力扩展到了更多的 HTTP 方法和事件上。本文将深入讲解 HTMX 的核心概念、与 Laravel + Blade 的集成实践、以及在真实项目中的最佳实践。

## 一、HTMX 核心概念

### 1.1 HTMX 是什么？

HTMX 是一个轻量级（14KB gzipped）的 JavaScript 库，它通过 HTML 属性让你能够：

- 用任何 HTML 元素发起 HTTP 请求（不只是 `<a>` 和 `<form>`）
- 用任何 HTTP 方法（不只是 GET 和 POST）
- 将服务器返回的 HTML 片段插入到页面的任何位置

```html
<!-- 传统 HTML：只能用链接和表单 -->
<a href="/users">Get Users</a>
<form method="POST" action="/users">
    <input name="name">
    <button type="submit">Submit</button>
</form>

<!-- HTMX：任何元素都能发起任何请求 -->
<button hx-get="/users" hx-target="#user-list">Get Users</button>
<div hx-post="/users" hx-trigger="submit" hx-target="#result">
    <input name="name">
    <button type="submit">Submit</button>
</div>
<input name="search" hx-get="/search" hx-trigger="keyup changed delay:300ms"
       hx-target="#search-results">
```

### 1.2 核心属性

**hx-get / hx-post / hx-put / hx-patch / hx-delete**：指定请求方法和 URL。

```html
<!-- GET 请求 -->
<div hx-get="/api/users">Load Users</div>

<!-- POST 请求 -->
<form hx-post="/api/users" hx-target="#result">
    <input name="name" required>
    <button type="submit">Create</button>
</form>

<!-- DELETE 请求 -->
<button hx-delete="/api/users/123" hx-confirm="Are you sure?"
        hx-target="closest tr" hx-swap="outerHTML">
    Delete
</button>
```

**hx-target**：指定服务器返回的 HTML 片段应该插入到哪个元素。

```html
<!-- 用 CSS 选择器 -->
<div hx-get="/api/data" hx-target="#result">Load</div>
<div id="result"></div>

<!-- 相对选择器 -->
<button hx-get="/api/data" hx-target="closest .card-body">Refresh</button>
<button hx-get="/api/data" hx-target="next .content">Load Next</button>
<button hx-get="/api/data" hx-target="previous .content">Load Previous</button>
<button hx-get="/api/data" hx-target="find .detail">Find Detail</button>
```

**hx-swap**：指定如何将返回的 HTML 插入到目标元素。

```html
<!-- 替换目标元素的内部 HTML（默认） -->
<div hx-get="/api/data" hx-swap="innerHTML">Load</div>

<!-- 替换整个目标元素 -->
<div hx-get="/api/data" hx-swap="outerHTML">Load</div>

<!-- 在目标元素前面插入 -->
<div hx-get="/api/data" hx-swap="beforebegin">Load</div>

<!-- 在目标元素后面插入 -->
<div hx-get="/api/data" hx-swap="afterend">Load</div>

<!-- 在目标元素内部开头插入 -->
<div hx-get="/api/data" hx-swap="afterbegin">Load</div>

<!-- 在目标元素内部末尾插入 -->
<div hx-get="/api/data" hx-swap="beforeend">Load</div>

<!-- 无动画过渡 -->
<div hx-get="/api/data" hx-swap="innerHTML settle:500ms">Load</div>
```

**hx-trigger**：指定何时触发请求。

```html
<!-- 默认触发：click for links, submit for forms -->
<button hx-get="/api/data">Click me</button>

<!-- 自定义触发事件 -->
<div hx-get="/api/data" hx-trigger="mouseenter">Hover me</div>

<!-- 延迟触发 -->
<input hx-get="/api/search" hx-trigger="keyup changed delay:500ms">

<!-- 轮询 -->
<div hx-get="/api/status" hx-trigger="every 5s">Status</div>

<!-- 条件触发 -->
<button hx-get="/api/data" hx-trigger="click[isActive]">Conditional</button>

<!-- 多个触发器 -->
<div hx-get="/api/data"
     hx-trigger="load, click from:#refresh-btn, every 30s">
    Content
</div>

<!-- 自定义事件 -->
<div hx-get="/api/data" hx-trigger="myCustomEvent">Content</div>
<button onclick="htmx.trigger('#content', 'myCustomEvent')">Trigger</button>
```

### 1.3 HTMX 与传统 AJAX 的区别

| 特性 | 传统 AJAX (jQuery) | React/Vue | HTMX |
|------|-------------------|-----------|------|
| 返回数据格式 | JSON | JSON | HTML 片段 |
| 渲染位置 | 客户端 JS | 客户端框架 | 服务端模板 |
| 代码量 | 中等 | 多 | 极少 |
| 学习曲线 | 低 | 高 | 极低 |
| 服务端负担 | 轻（只返回数据） | 轻（只返回数据） | 重（返回 HTML） |
| 适用场景 | 通用 | 复杂 SPA | 内容驱动网站 |

## 二、Laravel + HTMX 集成

### 2.1 基础项目结构

```
app/
├── Http/
│   ├── Controllers/
│   │   ├── UserController.php
│   │   └── ProductController.php
│   └── Middleware/
│       └── HtmxMiddleware.php
├── Views/
│   ├── components/
│   │   ├── button.blade.php
│   │   └── card.blade.php
│   ├── layouts/
│   │   └── app.blade.php
│   ├── partials/
│   │   ├── user-list.blade.php
│   │   ├── user-row.blade.php
│   │   └── product-card.blade.php
│   └── pages/
│       ├── users/
│       │   ├── index.blade.php
│       │   └── show.blade.php
│       └── products/
│           └── index.blade.php
routes/
└── web.php
```

### 2.2 HTMX 中间件

```php
// app/Http/Middleware/HtmxMiddleware.php
class HtmxMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // 检测 HTMX 请求
        if ($request->header('HX-Request')) {
            // HTMX 请求不返回完整页面
            $response->headers->set('HX-Trigger', json_encode([
                'showMessage' => ['level' => 'info', 'message' => 'Request completed'],
            ]));
        }

        return $response;
    }
}

// app/Http/Controllers/Concerns/HandlesHtmxRequests.php
trait HandlesHtmxRequests
{
    protected function isHtmxRequest(): bool
    {
        return request()->header('HX-Request') === 'true';
    }

    protected function htmxResponse(View $view): Response
    {
        if ($this->isHtmxRequest()) {
            // HTMX 请求：返回 HTML 片段
            return response($view->render())
                ->header('HX-Trigger', 'contentUpdated');
        }

        // 普通请求：返回完整页面
        return response($view);
    }

    protected function htmxRedirect(string $url): Response
    {
        return response('', 204)
            ->header('HX-Redirect', $url);
    }

    protected function htmxRefresh(): Response
    {
        return response('', 204)
            ->header('HX-Refresh', 'true');
    }

    protected function htmxTrigger(string $event, array $data = []): Response
    {
        return response('', 204)
            ->header('HX-Trigger', json_encode([$event => $data]));
    }

    protected function htmxReswap(string $swap): Response
    {
        return response('', 204)
            ->header('HX-Reswap', $swap);
    }

    protected function htmxRetarget(string $target): Response
    {
        return response('', 204)
            ->header('HX-Retarget', $target);
    }
}
```

### 2.3 用户管理 CRUD 示例

```php
// app/Http/Controllers/UserController.php
class UserController extends Controller
{
    use HandlesHtmxRequests;

    public function index(Request $request)
    {
        $users = User::query()
            ->when($request->search, fn ($q, $s) =>
                $q->where('name', 'like', "%{$s}%")
                  ->orWhere('email', 'like', "%{$s}%")
            )
            ->when($request->role, fn ($q, $r) => $q->where('role', $r))
            ->paginate(15);

        if ($this->isHtmxRequest()) {
            return view('partials.user-list', compact('users'));
        }

        return view('pages.users.index', compact('users'));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users',
            'role' => 'required|in:admin,user,editor',
        ]);

        $user = User::create($validated);

        // 返回新创建的用户行 HTML
        $rowHtml = view('partials.user-row', compact('user'))->render();

        return response($rowHtml)
            ->header('HX-Trigger', json_encode([
                'showMessage' => ['level' => 'success', 'message' => "User {$user->name} created!"],
                'closeModal' => true,
            ]));
    }

    public function show(User $user)
    {
        if ($this->isHtmxRequest()) {
            return view('partials.user-detail', compact('user'));
        }

        return view('pages.users.show', compact('user'));
    }

    public function update(Request $request, User $user)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email,' . $user->id,
            'role' => 'required|in:admin,user,editor',
        ]);

        $user->update($validated);

        // 返回更新后的用户行
        $rowHtml = view('partials.user-row', ['user' => $user->fresh()])->render();

        return response($rowHtml)
            ->header('HX-Trigger', json_encode([
                'showMessage' => ['level' => 'success', 'message' => "User updated!"],
            ]));
    }

    public function destroy(User $user)
    {
        $user->delete();

        // 返回空响应，HTMX 会删除目标元素
        return response('', 204)
            ->header('HX-Trigger', json_encode([
                'showMessage' => ['level' => 'success', 'message' => "User deleted!"],
            ]));
    }

    // 批量操作
    public function bulkDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        User::whereIn('id', $ids)->delete();

        return $this->htmxRefresh();
    }

    // 搜索建议
    public function search(Request $request)
    {
        $query = $request->input('q', '');

        if (strlen($query) < 2) {
            return response('<div class="p-4 text-gray-500">Type at least 2 characters...</div>');
        }

        $users = User::where('name', 'like', "%{$query}%")
            ->orWhere('email', 'like', "%{$query}%")
            ->limit(10)
            ->get();

        return view('partials.search-suggestions', compact('users', 'query'));
    }
}
```

### 2.4 Blade 模板

```blade
{{-- layouts/app.blade.php --}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>@yield('title', 'My App')</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    <script src="https://unpkg.com/htmx-ext-response-targets@2.0.2"></script>
    <meta name="csrf-token" content="{{ csrf_token() }}">
</head>
<body hx-headers='{"X-CSRF-TOKEN": "{{ csrf_token() }}"}' hx-ext="response-targets">
    @include('partials.nav')

    <main class="container mx-auto px-4 py-8" id="main-content">
        @yield('content')
    </main>

    {{-- 全局消息提示 --}}
    <div id="message-container" class="fixed top-4 right-4 z-50"></div>

    <script>
        // 全局 HTMX 事件处理
        document.body.addEventListener('showMessage', function(event) {
            const { level, message } = event.detail;
            const container = document.getElementById('message-container');
            const alert = document.createElement('div');
            alert.className = `alert alert-${level} mb-2 shadow-lg`;
            alert.innerHTML = `<span>${message}</span>`;
            container.appendChild(alert);
            setTimeout(() => alert.remove(), 5000);
        });

        // 关闭模态框
        document.body.addEventListener('closeModal', function() {
            document.getElementById('modal')?.classList.add('hidden');
        });
    </script>
</body>
</html>
```

```blade
{{-- pages/users/index.blade.php --}}
@extends('layouts.app')

@section('title', 'Users Management')

@section('content')
<div class="space-y-6">
    {{-- 页面标题和操作 --}}
    <div class="flex justify-between items-center">
        <h1 class="text-3xl font-bold">Users</h1>
        <button class="btn btn-primary"
                hx-get="/users/create"
                hx-target="#modal-content"
                hx-swap="innerHTML"
                onclick="document.getElementById('modal').classList.remove('hidden')">
            + Add User
        </button>
    </div>

    {{-- 搜索和过滤 --}}
    <div class="flex gap-4">
        <input type="text"
               name="search"
               placeholder="Search users..."
               class="input input-bordered flex-1"
               hx-get="/users"
               hx-trigger="keyup changed delay:300ms"
               hx-target="#user-list-container"
               hx-indicator="#search-spinner"
               hx-include="[name='role']">

        <select name="role"
                class="select select-bordered"
                hx-get="/users"
                hx-trigger="change"
                hx-target="#user-list-container"
                hx-include="[name='search']">
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="editor">Editor</option>
        </select>

        <div id="search-spinner" class="htmx-indicator">
            <span class="loading loading-spinner"></span>
        </div>
    </div>

    {{-- 用户列表 --}}
    <div id="user-list-container">
        @include('partials.user-list', ['users' => $users])
    </div>

    {{-- 模态框 --}}
    <div id="modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center">
        <div class="bg-white rounded-lg p-6 w-full max-w-md" id="modal-content">
            {{-- 动态加载内容 --}}
        </div>
    </div>
</div>
@endsection
```

```blade
{{-- partials/user-list.blade.php --}}
<div class="overflow-x-auto">
    <table class="table table-zebra">
        <thead>
            <tr>
                <th>
                    <label>
                        <input type="checkbox" class="checkbox" id="select-all"
                               onchange="toggleSelectAll(this)">
                    </label>
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="user-list">
            @foreach($users as $user)
                @include('partials.user-row', ['user' => $user])
            @endforeach
        </tbody>
    </table>
</div>

{{-- 分页 --}}
<div class="mt-4">
    {{ $users->links() }}
</div>

{{-- 批量操作按钮 --}}
<div id="bulk-actions" class="hidden mt-4">
    <button class="btn btn-error btn-sm"
            hx-delete="/users/bulk"
            hx-include="#user-list input[name='ids[]']:checked"
            hx-confirm="Delete selected users?"
            hx-target="#user-list-container">
        Delete Selected
    </button>
</div>
```

```blade
{{-- partials/user-row.blade.php --}}
<tr id="user-row-{{ $user->id }}">
    <td>
        <label>
            <input type="checkbox" class="checkbox" name="ids[]" value="{{ $user->id }}"
                   onchange="toggleBulkActions()">
        </label>
    </td>
    <td>
        <div class="flex items-center gap-3">
            <div class="avatar placeholder">
                <div class="bg-neutral text-neutral-content rounded-full w-8">
                    <span class="text-xs">{{ strtoupper(substr($user->name, 0, 2)) }}</span>
                </div>
            </div>
            <div>
                <div class="font-bold">{{ $user->name }}</div>
            </div>
        </div>
    </td>
    <td>{{ $user->email }}</td>
    <td>
        <span class="badge badge-{{ $user->role === 'admin' ? 'primary' : 'ghost' }}">
            {{ $user->role }}
        </span>
    </td>
    <td>{{ $user->created_at->diffForHumans() }}</td>
    <td>
        <div class="flex gap-2">
            {{-- 查看详情 --}}
            <button class="btn btn-ghost btn-xs"
                    hx-get="/users/{{ $user->id }}"
                    hx-target="#modal-content"
                    hx-swap="innerHTML"
                    onclick="document.getElementById('modal').classList.remove('hidden')">
                View
            </button>

            {{-- 编辑 --}}
            <button class="btn btn-ghost btn-xs"
                    hx-get="/users/{{ $user->id }}/edit"
                    hx-target="#modal-content"
                    hx-swap="innerHTML"
                    onclick="document.getElementById('modal').classList.remove('hidden')">
                Edit
            </button>

            {{-- 删除 --}}
            <button class="btn btn-error btn-xs"
                    hx-delete="/users/{{ $user->id }}"
                    hx-confirm="Are you sure you want to delete {{ $user->name }}?"
                    hx-target="#user-row-{{ $user->id }}"
                    hx-swap="outerHTML swap:500ms">
                Delete
            </button>
        </div>
    </td>
</tr>
```

## 三、高级 HTMX 模式

### 3.1 无限滚动（Infinite Scroll）

```blade
{{-- partials/product-list.blade.php --}}
<div id="product-list">
    @foreach($products as $product)
        @include('partials.product-card', ['product' => $product])
    @endforeach

    {{-- 无限滚动触发器 --}}
    @if($products->hasMorePages())
        <div hx-get="{{ $products->nextPageUrl() }}"
             hx-trigger="revealed"
             hx-swap="afterend"
             hx-indicator="#loading-spinner"
             class="text-center py-4">
            <span id="loading-spinner" class="htmx-indicator loading loading-spinner"></span>
        </div>
    @endif
</div>
```

### 3.2 拖拽排序

```blade
{{-- 使用 htmx-sortable 扩展 --}}
<div hx-post="/tasks/reorder"
     hx-trigger="end"
     hx-include="[data-task-id]"
     class="space-y-2">
    @foreach($tasks as $task)
        <div class="card bg-base-200 cursor-move"
             data-task-id="{{ $task->id }}"
             draggable="true">
            <div class="card-body p-4">
                <h3 class="font-bold">{{ $task->title }}</h3>
                <p class="text-sm text-gray-500">{{ $task->description }}</p>
            </div>
        </div>
    @endforeach
</div>
```

```php
// Controller
public function reorder(Request $request)
{
    $taskIds = $request->input('taskIds', []);

    foreach ($taskIds as $order => $taskId) {
        Task::where('id', $taskId)->update(['sort_order' => $order]);
    }

    return response('', 204);
}
```

### 3.3 实时表单验证

```blade
<form hx-post="/users" hx-target="#result">
    {{-- 名称：失焦时验证 --}}
    <input name="name"
           hx-post="/validate/name"
           hx-trigger="blur changed"
           hx-target="next .error-message"
           hx-swap="innerHTML"
           class="input input-bordered w-full">
    <div class="error-message text-red-500 text-sm mt-1"></div>

    {{-- 邮箱：输入时实时验证 --}}
    <input name="email"
           type="email"
           hx-post="/validate/email"
           hx-trigger="keyup changed delay:500ms"
           hx-target="next .error-message"
           hx-swap="innerHTML"
           class="input input-bordered w-full mt-4">
    <div class="error-message text-red-500 text-sm mt-1"></div>

    <button type="submit" class="btn btn-primary mt-4">Submit</button>
</form>
```

```php
// app/Http/Controllers/ValidationController.php
class ValidationController extends Controller
{
    public function validateName(Request $request)
    {
        $name = $request->input('name', '');

        if (empty($name)) {
            return response('<span class="text-red-500">Name is required</span>');
        }

        if (strlen($name) < 2) {
            return response('<span class="text-red-500">Name must be at least 2 characters</span>');
        }

        if (User::where('name', $name)->exists()) {
            return response('<span class="text-yellow-500">This name is already taken</span>');
        }

        return response('<span class="text-green-500">✓ Available</span>');
    }

    public function validateEmail(Request $request)
    {
        $email = $request->input('email', '');

        if (empty($email)) {
            return response('<span class="text-red-500">Email is required</span>');
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response('<span class="text-red-500">Invalid email format</span>');
        }

        if (User::where('email', $email)->exists()) {
            return response('<span class="text-red-500">This email is already registered</span>');
        }

        return response('<span class="text-green-500">✓ Available</span>');
    }
}
```

### 3.4 进度条

```blade
{{-- 任务执行进度条 --}}
<div id="task-progress">
    <button hx-post="/tasks/{{ $task->id }}/start"
            hx-target="#task-progress"
            hx-swap="outerHTML"
            class="btn btn-primary">
        Start Task
    </button>
</div>
```

```php
// Controller
public function start(Task $task)
{
    $task->update(['status' => 'running']);

    // 返回轮询进度的 HTML
    return view('partials.task-progress', ['task' => $task]);
}

public function progress(Task $task)
{
    $progress = $task->calculateProgress();

    if ($progress >= 100) {
        // 任务完成
        return view('partials.task-complete', ['task' => $task]);
    }

    // 返回进度条，继续轮询
    return view('partials.task-progress-bar', [
        'task' => $task,
        'progress' => $progress,
    ]);
}
```

```blade
{{-- partials/task-progress.blade.php --}}
<div id="task-progress"
     hx-get="/tasks/{{ $task->id }}/progress"
     hx-trigger="every 1s"
     hx-target="#task-progress"
     hx-swap="outerHTML">
    <div class="w-full bg-gray-200 rounded-full h-4">
        <div class="bg-blue-600 h-4 rounded-full transition-all duration-300"
             style="width: 0%">
        </div>
    </div>
    <p class="text-sm text-gray-500 mt-2">Starting task...</p>
</div>

{{-- partials/task-progress-bar.blade.php --}}
<div id="task-progress"
     hx-get="/tasks/{{ $task->id }}/progress"
     hx-trigger="every 1s"
     hx-target="#task-progress"
     hx-swap="outerHTML">
    <div class="w-full bg-gray-200 rounded-full h-4">
        <div class="bg-blue-600 h-4 rounded-full transition-all duration-300"
             style="width: {{ $progress }}%">
        </div>
    </div>
    <p class="text-sm text-gray-500 mt-2">Progress: {{ $progress }}%</p>
</div>

{{-- partials/task-complete.blade.php --}}
<div id="task-progress" class="text-center py-4">
    <div class="text-green-500 text-2xl">✓</div>
    <p class="font-bold">Task completed!</p>
    <button hx-get="/tasks/{{ $task->id }}/result"
            hx-target="#result-area"
            class="btn btn-sm btn-outline mt-2">
        View Result
    </button>
</div>
```

### 3.5 多步骤表单向导

```blade
{{-- 创建用户向导 --}}
<div id="wizard-container">
    @include('partials.wizard-step-1')
</div>
```

```blade
{{-- partials/wizard-step-1.blade.php --}}
<div id="wizard-step" class="space-y-4">
    <div class="flex items-center gap-2 mb-6">
        <div class="step active">1</div>
        <div class="step-line active"></div>
        <div class="step">2</div>
        <div class="step-line"></div>
        <div class="step">3</div>
    </div>

    <h2 class="text-xl font-bold">Basic Information</h2>

    <form hx-post="/users/wizard/step/1"
          hx-target="#wizard-step"
          hx-swap="outerHTML">
        <div class="form-control">
            <label class="label">Name</label>
            <input name="name" value="{{ old('name') }}" class="input input-bordered" required>
        </div>

        <div class="form-control mt-4">
            <label class="label">Email</label>
            <input name="email" type="email" value="{{ old('email') }}" class="input input-bordered" required>
        </div>

        <div class="flex justify-end mt-6">
            <button type="submit" class="btn btn-primary">Next →</button>
        </div>
    </form>
</div>
```

```php
// app/Http/Controllers/UserWizardController.php
class UserWizardController extends Controller
{
    use HandlesHtmxRequests;

    public function step1()
    {
        return view('partials.wizard-step-1');
    }

    public function processStep1(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email',
        ]);

        // 存入 session
        session(['wizard.user_data' => $validated]);

        return view('partials.wizard-step-2', $validated);
    }

    public function processStep2(Request $request)
    {
        $validated = $request->validate([
            'role' => 'required|in:admin,user,editor',
            'department' => 'required|string|max:255',
        ]);

        session(['wizard.user_data' => array_merge(
            session('wizard.user_data', []),
            $validated
        )]);

        return view('partials.wizard-step-3', session('wizard.user_data'));
    }

    public function complete()
    {
        $data = session('wizard.user_data');

        $user = User::create($data);

        session()->forget('wizard');

        return response(view('partials.wizard-complete', compact('user')))
            ->header('HX-Trigger', json_encode([
                'showMessage' => ['level' => 'success', 'message' => "User {$user->name} created!"],
            ]));
    }
}
```

## 四、性能优化

### 4.1 服务端渲染优化

```php
// 使用 Laravel 的 View Cache
class CachedViewRenderer
{
    public function renderCached(string $view, array $data, int $ttl = 300): string
    {
        $cacheKey = 'view:' . md5($view . serialize($data));

        return Cache::remember($cacheKey, $ttl, function () use ($view, $data) {
            return view($view, $data)->render();
        });
    }
}

// 在 Controller 中使用
public function index()
{
    $products = Product::with('category')->latest()->paginate(20);

    if ($this->isHtmxRequest()) {
        // 缓存 HTML 片段
        $html = Cache::remember(
            "products-list-page-{$products->currentPage()}",
            60,
            fn () => view('partials.product-list', compact('products'))->render()
        );

        return response($html);
    }

    return view('pages.products.index', compact('products'));
}
```

### 4.2 HTMX 请求优化

```html
<!-- 使用 hx-boost 提升普通链接 -->
<body hx-boost="true">
    <!-- 所有链接自动用 HTMX 处理，无需为每个链接添加 hx-get -->
    <a href="/users">Users</a>
    <a href="/products">Products</a>
    <a href="/orders">Orders</a>
</body>

<!-- 使用 hx-preserve 保留元素状态 -->
<div id="sidebar" hx-preserve>
    <!-- 不会在页面切换时被替换 -->
    <nav>...</nav>
</div>

<!-- 使用 hx-select 只替换页面的一部分 -->
<a href="/users" hx-select="#user-content" hx-target="#main-content">
    Users
</a>
```

### 4.3 错误处理

```html
<!-- 全局错误处理 -->
<script>
document.body.addEventListener('htmx:responseError', function(event) {
    const xhr = event.detail.xhr;
    const container = document.getElementById('message-container');

    let message = 'An error occurred';
    if (xhr.status === 422) {
        // 验证错误
        const errors = JSON.parse(xhr.responseText);
        message = Object.values(errors.errors).flat().join(', ');
    } else if (xhr.status === 404) {
        message = 'Resource not found';
    } else if (xhr.status === 500) {
        message = 'Server error, please try again later';
    }

    const alert = document.createElement('div');
    alert.className = 'alert alert-error mb-2';
    alert.innerHTML = `<span>${message}</span>`;
    container.appendChild(alert);
    setTimeout(() => alert.remove(), 8000);
});

// 请求重试
document.body.addEventListener('htmx:afterRequest', function(event) {
    if (event.detail.xhr.status === 0) {
        // 网络错误，自动重试
        setTimeout(() => {
            htmx.trigger(event.detail.elt, 'retry');
        }, 2000);
    }
});
</script>
```

## 五、测试策略

### 5.1 Feature 测试

```php
// tests/Feature/HtmxUserTest.php
class HtmxUserTest extends TestCase
{
    use RefreshDatabase;

    public function test_htmx_request_returns_partial(): void
    {
        User::factory()->count(5)->create();

        $response = $this->get('/users', [
            'HX-Request' => 'true',
        ]);

        $response->assertOk();
        $response->assertSee('user-row-');
        // HTMX 请求不应返回完整页面
        $response->assertDontSee('<html');
    }

    public function test_htmx_create_user_returns_row(): void
    {
        $response = $this->post('/users', [
            'name' => 'John Doe',
            'email' => 'john@example.com',
            'role' => 'user',
        ], [
            'HX-Request' => 'true',
        ]);

        $response->assertOk();
        $response->assertSee('John Doe');
        $response->assertHeader('HX-Trigger');
    }

    public function test_htmx_delete_removes_row(): void
    {
        $user = User::factory()->create();

        $response = $this->delete("/users/{$user->id}", [
            'HX-Request' => 'true',
        ]);

        $response->assertNoContent();
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
    }

    public function test_htmx_search_returns_suggestions(): void
    {
        User::factory()->create(['name' => 'John Doe']);
        User::factory()->create(['name' => 'Jane Smith']);

        $response = $this->get('/users/search?q=john', [
            'HX-Request' => 'true',
        ]);

        $response->assertOk();
        $response->assertSee('John Doe');
        $response->assertDontSee('Jane Smith');
    }
}
```

### 5.2 Browser 测试（Laravel Dusk）

```php
// tests/Browser/UserManagementTest.php
class UserManagementTest extends DuskTestCase
{
    public function test_search_users_with_htmx(): void
    {
        User::factory()->create(['name' => 'John Doe']);
        User::factory()->create(['name' => 'Jane Smith']);

        $this->browse(function (Browser $browser) {
            $browser->visit('/users')
                    ->type('input[name="search"]', 'john')
                    ->waitFor('.htmx-request', 5)  // 等待 HTMX 请求完成
                    ->assertSee('John Doe')
                    ->assertDontSee('Jane Smith');
        });
    }

    public function test_create_user_via_modal(): void
    {
        $this->browse(function (Browser $browser) {
            $browser->visit('/users')
                    ->click('@add-user-button')
                    ->waitFor('#modal')
                    ->type('input[name="name"]', 'Test User')
                    ->type('input[name="email"]', 'test@example.com')
                    ->select('select[name="role"]', 'user')
                    ->press('Submit')
                    ->waitFor('.alert-success')
                    ->assertSee('Test User');
        });
    }
}
```

## 六、与 JavaScript 框架的对比

### 6.1 何时选择 HTMX？

**HTMX 适合的场景**：
- 内容驱动的网站（博客、新闻、电商产品页）
- 后台管理系统
- 表单密集的应用
- 团队中后端开发者多于前端开发者
- SEO 友好的网站
- 不需要离线支持的应用

**HTMX 不适合的场景**：
- 复杂的单页应用（如 Figma、Google Docs）
- 需要大量客户端状态管理的应用
- 实时协作应用（如 Google Docs 的多人编辑）
- 需要离线支持的 PWA
- 对首屏加载时间极度敏感的 SPA

### 6.2 混合使用

在实际项目中，HTMX 和 JavaScript 框架可以共存：

```html
<!-- 页面主体用 HTMX -->
<body hx-boost="true">
    <nav>...</nav>
    <main id="content">
        @yield('content')
    </main>

    <!-- 复杂交互组件用 React/Vue -->
    <div id="react-chart-widget"></div>
    <div id="vue-table-component"></div>

    <script>
        // React 组件
        import { ChartWidget } from './components/ChartWidget';
        ReactDOM.render(
            <ChartWidget />,
            document.getElementById('react-chart-widget')
        );

        // Vue 组件
        import DataTable from './components/DataTable.vue';
        new Vue({
            render: h => h(DataTable),
        }).$mount('#vue-table-component');
    </script>
</body>
```

## 七、总结

HTMX 为 Laravel 开发者提供了一种全新的前端交互方式：

1. **极简学习曲线**：只需掌握几个 HTML 属性，就能实现丰富的交互
2. **服务端渲染优先**：Blade 模板承担渲染职责，前端逻辑最小化
3. **渐进增强**：可以在现有项目中逐步引入，无需重写
4. **性能优秀**：14KB 的体积，零构建步骤，快速加载
5. **适合团队**：后端开发者可以独立完成全栈功能

对于那些不需要复杂 SPA 的项目，HTMX + Laravel + Blade 是一个值得认真考虑的方案。它让你用更少的代码、更简单的架构，实现同样优秀的用户体验。

## 相关阅读

- [Vite 与 Laravel 集成优化指南](/categories/前端/vite-laravel-guide/)
- [Vue 3 Composition API 最佳实践](/categories/前端/vue-3-composition-api-guide-ref-reactive-computed-best-practices/)
- [Vue 3 + Vite + Pinia 完整技术栈指南](/categories/前端/vue-3-pinia-guide-vuex-b2c/)
