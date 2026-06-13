---
title: Htmx + Laravel 实战：不用 JavaScript 框架也能做交互——超轻量前后端方案对比 Livewire/Turbo 的渐进增强路线
date: 2026-06-06 10:00:00
tags: [Htmx, Laravel, 前端, Livewire, Turbo]
categories:
  - frontend
cover: /images/covers/htmx-laravel-cover.jpg
description: "深入解析 Htmx 与 Laravel 的渐进增强集成实战，从 Htmx 核心属性速查到 Blade 模板局部刷新完整代码，全面对比 Livewire、Turbo 两大全栈交互框架的架构哲学、性能差异与选型策略。涵盖 CSRF 安全处理、表单验证错误拦截、无限滚动、SSE 实时推送、Alpine.js 混合开发等生产踩坑指南，帮助 Laravel 开发者快速掌握零 JavaScript 框架的前后端交互渐进增强最佳实践。"
---

> 渐进增强不是倒退，而是一种更稳健的前进方式。当你的页面在没有 JavaScript 的情况下依然能正常工作，那么加上 JavaScript 只会变得更好——而不是"没有 JavaScript 就完全不能用"。

在 Laravel 生态中，我们已经有了 Livewire 这样优秀的全栈组件方案，也有 Hotwire/Turbo 这种从 Rails 世界迁移过来的渐进增强框架。但还有一条更极简的路线——**Htmx**。它只有一行 HTML 属性，却能让你的 Laravel Blade 模板变成一个具有丰富交互的单页应用体验。本文将从实战角度出发，带你走完 Htmx + Laravel 的完整集成路线，并与 Livewire、Hotwire/Turbo 做深度对比，帮你找到最适合你项目的渐进增强策略。

<!-- more -->

## 一、Htmx 是什么：用 HTML 属性做一切

### 1.1 核心理念：超媒体驱动

Htmx 的哲学可以用一句话概括：**HTML 本身就是交互的，只是我们忘了**。

传统的 HTML 有 `<a>` 标签做 GET 请求，有 `<form>` 标签做 POST 请求。Htmx 做的事情是把这种能力扩展到所有 HTML 元素、所有 HTTP 方法、以及所有事件上。

```html
<!-- 传统 HTML：只有链接和表单能发起请求 -->
<a href="/users">获取用户</a>
<form method="POST" action="/users">
    <input name="name">
    <button type="submit">提交</button>
</form>

<!-- Htmx：任何元素都能发起任何请求 -->
<button hx-get="/users" hx-target="#user-list">
    获取用户
</button>
<div hx-post="/search" hx-trigger="keyup changed delay:300ms" hx-target="#results">
    <input type="text" name="q" placeholder="搜索...">
</div>
```

Htmx 只有 **14KB**（gzip 后），没有依赖，没有构建步骤，没有虚拟 DOM。它做的事情很简单：**监听事件 → 发起 HTTP 请求 → 用返回的 HTML 替换页面中的某个部分**。

### 1.2 为什么 PHP/Laravel 开发者应该关注 Htmx

对于 Laravel 开发者来说，Htmx 的吸引力在于以下几点：

**第一，你不需要学前端框架。** 你不需要理解 React 的 hooks、Vue 的响应式系统、或者 Svelte 的编译时魔法。你只需要写好 Blade 模板和 Controller，Htmx 就能帮你把服务端渲染的 HTML 片段"注入"到页面的指定位置。

**第二，你的 Controller 就是 API。** 你不需要维护一套 RESTful API 和一套前端状态管理。Laravel Controller 直接返回 HTML 片段（而不是 JSON），前端直接用 Htmx 属性消费它。

**第三，渐进增强天然支持。** 如果用户的浏览器禁用了 JavaScript，表单依然可以通过传统的 form submission 工作。Htmx 只是在此基础上增加了"局部刷新"的能力。

**第四，学习成本极低。** Htmx 的核心 API 只有十几个 HTML 属性，一个下午就能全部掌握。

## 二、Htmx 基础属性速查

在开始 Laravel 实战之前，我们先快速过一遍 Htmx 最常用的五个核心属性。

### 2.1 hx-get / hx-post / hx-put / hx-delete

这些属性让任何 HTML 元素都能发起 HTTP 请求：

```html
<!-- 点击按钮，发起 GET 请求 -->
<button hx-get="/api/users">获取用户列表</button>

<!-- 点击按钮，发起 POST 请求 -->
<button hx-post="/api/users" hx-include="[name='email']">创建用户</button>

<!-- 点击按钮，发起 DELETE 请求 -->
<button hx-delete="/api/users/1">删除用户</button>
```

### 2.2 hx-target：指定替换目标

默认情况下，Htmx 会用返回的 HTML 替换触发元素的 `innerHTML`。但你可以用 `hx-target` 指定替换的目标：

```html
<!-- 替换 #user-list 元素的内容 -->
<button hx-get="/api/users" hx-target="#user-list">获取用户</button>
<div id="user-list"></div>

<!-- 替换触发元素的父元素 -->
<button hx-get="/api/users/1" hx-target="closest tr">刷新这行</button>

<!-- 替换整个页面的 body -->
<button hx-get="/api/full-page" hx-target="body">全页刷新</button>
```

### 2.3 hx-swap：控制替换方式

`hx-swap` 控制返回的 HTML 如何插入到目标位置：

```html
<!-- innerHTML（默认）：替换目标元素的内部 HTML -->
<button hx-get="/api/users" hx-swap="innerHTML">替换内容</button>

<!-- outerHTML：替换目标元素本身（包括自身标签） -->
<button hx-get="/api/users/1" hx-swap="outerHTML">替换整行</button>

<!-- beforeend：在目标元素内部末尾追加（适合无限滚动） -->
<button hx-get="/api/users?page=2" hx-swap="beforeend">加载更多</button>

<!-- afterbegin：在目标元素内部开头插入 -->
<button hx-get="/api/notifications" hx-swap="afterbegin">新通知</button>

<!-- delete：删除目标元素 -->
<button hx-delete="/api/users/1" hx-swap="delete">删除</button>
```

### 2.4 hx-trigger：事件触发

默认触发事件是 `click`，但你可以指定任何 DOM 事件：

```html
<!-- 输入框变化后 300ms 触发搜索（防抖） -->
<input hx-get="/api/search" hx-trigger="keyup changed delay:300ms" 
       hx-target="#results" name="q">

<!-- 鼠标悬停时加载 -->
<div hx-get="/api/tooltip" hx-trigger="mouseenter">悬停查看</div>

<!-- 页面滚动到底部时加载更多 -->
<div hx-get="/api/users?page=2" hx-trigger="revealed">加载更多</div>

<!-- 每 5 秒轮询 -->
<div hx-get="/api/stats" hx-trigger="every 5s">实时统计</div>

<!-- 监听自定义事件 -->
<div hx-get="/api/data" hx-trigger="refresh from:body">数据区</div>
```

### 2.5 hx-vals / hx-include / hx-params

控制发送的参数：

```html
<!-- 发送额外的值 -->
<button hx-post="/api/action" hx-vals='{"type": "premium"}'>高级操作</button>

<!-- 包含指定表单的值 -->
<button hx-post="/api/submit" hx-include="#my-form">提交表单</button>

<!-- 只发送指定参数 -->
<input hx-get="/api/filter" hx-params="name,category" name="name" 
       hx-trigger="input changed">
```

## 三、Laravel + Htmx 实战集成

### 3.1 项目初始化

假设你有一个 Laravel 项目，先安装 Htmx：

```html
<!-- resources/views/layouts/app.blade.php -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>@yield('title', '我的应用')</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    @yield('content')
    
    <!-- Htmx CDN（生产环境建议下载到本地） -->
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</body>
</html>
```

或者用 npm 安装：

```bash
npm install htmx.org
```

```javascript
// resources/js/app.js
import 'htmx.org';
```

### 3.2 创建路由和控制器

```php
// routes/web.php
use App\Http\Controllers\UserController;
use App\Http\Controllers\TaskController;

Route::get('/users', [UserController::class, 'index'])->name('users.index');
Route::get('/users/list', [UserController::class, 'list'])->name('users.list');
Route::post('/users', [UserController::class, 'store'])->name('users.store');
Route::delete('/users/{user}', [UserController::class, 'destroy'])->name('users.destroy');

Route::get('/tasks', [TaskController::class, 'index'])->name('tasks.index');
Route::get('/tasks/search', [TaskController::class, 'search'])->name('tasks.search');
Route::get('/tasks/list', [TaskController::class, 'list'])->name('tasks.list');
```

### 3.3 实战一：用户列表 + 局部刷新

这是最基本的 Htmx 模式：页面初始加载完整 HTML，后续交互通过 Htmx 局部刷新。

**控制器：**

```php
// app/Http/Controllers/UserController.php
namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;

class UserController extends Controller
{
    // 完整页面（首次加载）
    public function index()
    {
        $users = User::latest()->paginate(10);
        return view('users.index', compact('users'));
    }

    // HTML 片段（Htmx 局部请求）
    public function list(Request $request)
    {
        $users = User::latest()->paginate(10);
        
        // 判断是否为 Htmx 请求
        if ($request->header('HX-Request')) {
            // 只返回 HTML 片段，不带布局
            return view('users.partials.list', compact('users'));
        }
        
        // 非 Htmx 请求，返回完整页面
        return view('users.index', compact('users'));
    }

    // 创建用户（返回新行的 HTML）
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users',
        ]);

        $user = User::create($validated);

        // Htmx 请求：返回新用户的 HTML 行
        if ($request->header('HX-Request')) {
            return response()
                ->view('users.partials.row', compact('user'))
                ->header('HX-Trigger', 'userCreated'); // 触发自定义事件
        }

        return redirect()->route('users.index');
    }

    // 删除用户
    public function destroy(Request $request, User $user)
    {
        $user->delete();

        if ($request->header('HX-Request')) {
            // 返回空响应，Htmx 会删除目标元素（配合 hx-swap="delete"）
            return response('', 200)
                ->header('HX-Trigger', 'userDeleted');
        }

        return redirect()->route('users.index');
    }
}
```

**完整页面视图：**

```blade
{{-- resources/views/users/index.blade.php --}}
@extends('layouts.app')

@section('title', '用户管理')

@section('content')
<div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">用户管理</h1>
        
        {{-- 创建用户按钮：点击后在列表顶部插入新行 --}}
        <form hx-post="{{ route('users.store') }}" 
              hx-target="#user-list tbody" 
              hx-swap="afterbegin"
              hx-on::after-request="this.reset()"
              class="flex gap-2">
            @csrf
            <input type="text" name="name" placeholder="姓名" required
                   class="border rounded px-3 py-1">
            <input type="email" name="email" placeholder="邮箱" required
                   class="border rounded px-3 py-1">
            <button type="submit" 
                    class="bg-blue-500 text-white px-4 py-1 rounded hover:bg-blue-600">
                添加用户
            </button>
        </form>
    </div>

    {{-- 用户列表区域：支持局部刷新 --}}
    <div id="user-list">
        @include('users.partials.list')
    </div>
    
    {{-- 统计信息：监听自定义事件自动更新 --}}
    <div hx-get="{{ route('users.list') }}" 
         hx-trigger="userCreated from:body, userDeleted from:body"
         hx-target="#user-list"
         hx-swap="innerHTML"
         class="hidden">
    </div>
</div>
@endsection
```

**列表局部视图：**

```blade
{{-- resources/views/users/partials/list.blade.php --}}
<table class="w-full border-collapse">
    <thead>
        <tr class="bg-gray-100">
            <th class="border p-3 text-left">ID</th>
            <th class="border p-3 text-left">姓名</th>
            <th class="border p-3 text-left">邮箱</th>
            <th class="border p-3 text-left">创建时间</th>
            <th class="border p-3 text-center">操作</th>
        </tr>
    </thead>
    <tbody>
        @forelse($users as $user)
            @include('users.partials.row', compact('user'))
        @empty
            <tr>
                <td colspan="5" class="border p-3 text-center text-gray-500">
                    暂无用户数据
                </td>
            </tr>
        @endforelse
    </tbody>
</table>

{{-- 分页 --}}
<div class="mt-4">
    {{ $users->links() }}
</div>
```

**单行局部视图：**

```blade
{{-- resources/views/users/partials/row.blade.php --}}
<tr id="user-{{ $user->id }}">
    <td class="border p-3">{{ $user->id }}</td>
    <td class="border p-3">{{ $user->name }}</td>
    <td class="border p-3">{{ $user->email }}</td>
    <td class="border p-3">{{ $user->created_at->format('Y-m-d H:i') }}</td>
    <td class="border p-3 text-center">
        <button hx-delete="{{ route('users.destroy', $user) }}" 
                hx-target="#user-{{ $user->id }}"
                hx-swap="outerHTML"
                hx-confirm="确定删除 {{ $user->name }} 吗？"
                class="text-red-500 hover:text-red-700">
            删除
        </button>
    </td>
</tr>
```

注意上面代码中的一个关键设计：**同一个 Controller 方法同时处理完整页面请求和 Htmx 片段请求**。通过 `$request->header('HX-Request')` 来判断是否为 Htmx 请求，从而决定返回完整视图还是 HTML 片段。

### 3.4 实战二：实时搜索过滤

搜索是 Htmx 最经典的应用场景：

```blade
{{-- resources/views/tasks/index.blade.php --}}
@extends('layouts.app')

@section('content')
<div class="container mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6">任务列表</h1>

    {{-- 搜索框：输入后自动触发搜索 --}}
    <div class="mb-6">
        <input type="text" 
               name="q" 
               placeholder="搜索任务..."
               hx-get="{{ route('tasks.search') }}"
               hx-trigger="keyup changed delay:300ms"
               hx-target="#task-results"
               hx-indicator="#search-spinner"
               class="w-full border rounded-lg px-4 py-2"
               value="{{ request('q') }}">
        
        {{-- 加载指示器 --}}
        <div id="search-spinner" class="htmx-indicator text-gray-400 mt-2">
            搜索中...
        </div>
    </div>

    {{-- 搜索结果 --}}
    <div id="task-results">
        @include('tasks.partials.list')
    </div>
</div>
@endsection
```

```php
// TaskController.php
public function search(Request $request)
{
    $query = $request->input('q');
    
    $tasks = Task::query()
        ->when($query, function ($q) use ($query) {
            $q->where('title', 'like', "%{$query}%")
              ->orWhere('description', 'like', "%{$query}%");
        })
        ->latest()
        ->paginate(15);

    if ($request->header('HX-Request')) {
        return view('tasks.partials.list', compact('tasks', 'query'));
    }

    return view('tasks.index', compact('tasks', 'query'));
}
```

这里用到了 `hx-trigger="keyup changed delay:300ms"`：`changed` 确保只有值真正改变时才触发，`delay:300ms` 实现防抖，避免每次按键都发请求。

### 3.5 实战三：无限滚动

Htmx 的 `revealed` 触发器让无限滚动变得异常简单：

```blade
{{-- resources/views/users/partials/list.blade.php --}}
<table class="w-full border-collapse">
    <tbody>
        @foreach($users as $user)
            @include('users.partials.row', compact('user'))
        @endforeach
    </tbody>
</table>

@if($users->hasMorePages())
    {{-- 这个 div 滚动到可视区域时自动加载下一页 --}}
    <div hx-get="{{ $users->nextPageUrl() }}"
         hx-trigger="revealed"
         hx-swap="afterend"
         hx-indicator="#load-more-spinner"
         class="py-4">
        <div id="load-more-spinner" class="htmx-indicator text-center text-gray-400">
            加载中...
        </div>
    </div>
@endif
```

Controller 端只需要正常的分页查询，当请求来自 Htmx 时返回不带布局的 HTML 片段即可。`hx-swap="afterend"` 表示把返回的 HTML 插入到触发元素之后，这样新的行会追加到列表末尾，而"加载更多"的占位 div 会随着最后一页而消失。

### 3.6 实战四：表单提交 + 验证错误处理

表单提交是最容易踩坑的地方，特别是 Laravel 的验证错误处理：

```blade
{{-- resources/views/users/partials/create-form.blade.php --}}
<form id="create-user-form"
      hx-post="{{ route('users.store') }}"
      hx-target="#user-list tbody"
      hx-swap="afterbegin"
      hx-on::after-request="if(event.detail.successful) this.reset()">
    
    @csrf
    
    <div class="mb-4">
        <label class="block text-sm font-medium mb-1">姓名</label>
        <input type="text" name="name" required
               class="w-full border rounded px-3 py-2 
                      @error('name') border-red-500 @enderror">
        @error('name')
            <p class="text-red-500 text-sm mt-1">{{ $message }}</p>
        @enderror
    </div>
    
    <div class="mb-4">
        <label class="block text-sm font-medium mb-1">邮箱</label>
        <input type="email" name="email" required
               class="w-full border rounded px-3 py-2 
                      @error('email') border-red-500 @enderror">
        @error('email')
            <p class="text-red-500 text-sm mt-1">{{ $message }}</p>
        @enderror
    </div>
    
    <button type="submit" 
            class="bg-blue-500 text-white px-4 py-2 rounded">
        提交
    </button>
</form>
```

验证失败时，Controller 需要返回带错误信息的 HTML 片段：

```php
public function store(Request $request)
{
    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'email' => 'required|email|unique:users',
    ]);

    $user = User::create($validated);

    if ($request->header('HX-Request')) {
        // 成功：返回新行
        $html = view('users.partials.row', compact('user'))->render();
        return response($html)
            ->header('HX-Trigger', json_encode([
                'showToast' => ['message' => '用户创建成功', 'type' => 'success']
            ]));
    }

    return redirect()->route('users.index');
}
```

Laravel 的 `validate()` 方法在验证失败时会抛出 `ValidationException`，默认返回 422 JSON 响应。对于 Htmx 请求，我们可以通过自定义异常处理让验证错误返回 HTML 片段：

```php
// app/Exceptions/Handler.php
use Illuminate\Validation\ValidationException;

public function register()
{
    $this->renderable(function (ValidationException $e, $request) {
        if ($request->header('HX-Request')) {
            // 返回带错误信息的表单 HTML
            return back()
                ->withErrors($e->errors())
                ->withInput()
                ->status(422);
        }
    });
}
```

但是上面的做法有个问题：`back()` 会返回完整页面。更好的方式是用 `HX-Retarget` 头来重新指向表单：

```php
public function store(Request $request)
{
    try {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users',
        ]);
    } catch (ValidationException $e) {
        if ($request->header('HX-Request')) {
            // 返回表单 HTML 片段（带错误信息）
            return response()
                ->view('users.partials.create-form', [
                    'errors' => $e->errors()
                ], 422)
                ->header('HX-Retarget', '#create-user-form')
                ->header('HX-Reswap', 'outerHTML');
        }
        throw $e;
    }

    $user = User::create($validated);

    if ($request->header('HX-Request')) {
        return response()
            ->view('users.partials.row', compact('user'))
            ->header('HX-Trigger', 'userCreated');
    }

    return redirect()->route('users.index');
}
```

`HX-Retarget` 和 `HX-Reswap` 是 Htmx 的响应头，可以覆盖请求中的 `hx-target` 和 `hx-swap` 设置。这样验证失败时，整个表单会被重新渲染（带错误信息），而不是只替换列表区域。

## 四、CSRF 处理：Htmx + Laravel 的安全基石

Laravel 的 CSRF 保护是默认开启的，所有 POST/PUT/DELETE 请求都需要携带 CSRF token。Htmx 有几种方式来处理这个问题。

### 方式一：全局 meta 标签 + htmx:configRequest 事件

这是最推荐的方式，一劳永逸：

```html
<!-- layouts/app.blade.php 的 <head> 中 -->
<meta name="csrf-token" content="{{ csrf_token() }}">
```

```javascript
// 在 htmx 加载后执行
document.body.addEventListener('htmx:configRequest', function(event) {
    event.detail.headers['X-CSRF-TOKEN'] = 
        document.querySelector('meta[name="csrf-token"]').getAttribute('content');
});
```

### 方式二：全局配置（更简洁）

```javascript
// 在加载 htmx 之前或之后
htmx.on('htmx:configRequest', function(event) {
    event.detail.headers['X-CSRF-TOKEN'] = 
        document.querySelector('meta[name="csrf-token"]').getAttribute('content');
});
```

### 方式三：hx-headers 属性（每个元素单独设置，不推荐）

```html
<button hx-post="/users" 
        hx-headers='{"X-CSRF-TOKEN": "{{ csrf_token() }}"}'>
    提交
</button>
```

### 方式四：使用 @csrf Blade 指令（表单场景）

```html
<form hx-post="/users">
    @csrf
    <!-- 表单内容 -->
</form>
```

当 `hx-post` 作用于 `<form>` 元素时，Htmx 会自动序列化表单内的所有 input（包括隐藏的 `_token` 字段），所以 `@csrf` 指令在这里依然有效。

**我的建议：** 使用方式一的全局 meta 标签方案，然后在每个需要 POST 的表单中也加上 `@csrf`，双重保险。

## 五、Htmx vs Livewire：架构哲学的根本差异

这是本文的重点对比部分。Livewire 和 Htmx 都能让 Laravel 开发者不用写 JavaScript 就实现交互，但它们的架构完全不同。

### 5.1 架构对比

| 维度 | Htmx | Livewire |
|------|------|----------|
| **通信方式** | 请求 HTML 片段，替换 DOM 局部 | 请求 JSON，Livewire 内部 diff + patch DOM |
| **状态管理** | 状态在服务端（Session/数据库），客户端无状态 | 有状态组件，客户端和服务端双向同步 |
| **JS 依赖** | 14KB，无依赖 | ~100KB+，依赖 Alpine.js |
| **服务端要求** | 任何能返回 HTML 的后端 | 必须是 Laravel + Livewire |
| **Blade 模板** | 普通 Blade，无特殊语法 | 特殊 Blade 指令（wire:click, wire:model 等） |
| **前端组件** | 无，纯 HTML | 有状态组件，支持前端交互（Alpine.js） |

### 5.2 性能对比

**Htmx 的请求更轻量。** 每次交互只传输需要更新的 HTML 片段，通常只有几百字节到几 KB。

```html
<!-- Htmx 请求：返回一个小片段 -->
<tr id="user-1">
    <td>1</td>
    <td>张三</td>
    <td>已激活</td>
</tr>
<!-- 响应体大小：约 100-200 字节 -->
```

**Livewire 的请求更"重"。** 每次交互需要传输组件状态（序列化为 JSON），服务端处理后返回 diff patch。

```json
// Livewire 请求体
{
    "fingerprint": { "id": "abc123", "name": "user-list", "locale": "zh" },
    "serverMemo": { "data": { "users": [...], "page": 1 }, "checksum": "..." },
    "updates": [{ "type": "callMethod", "payload": { "method": "nextPage" } }]
}
// 响应体：包含 diff patch 和新的 serverMemo
```

在简单的 CRUD 场景中，Htmx 的性能优势明显。但在复杂交互场景（如拖拽排序、实时表单验证、多步骤向导）中，Livewire 的有状态组件模型反而更高效，因为它可以在客户端做更多事情而不需要每次都请求服务端。

### 5.3 开发体验对比

**Livewire 的开发体验更"一体化"：**

```php
// Livewire 组件
class UserList extends Component
{
    public $search = '';
    public $sortField = 'name';
    public $sortDirection = 'asc';

    public function render()
    {
        return view('livewire.user-list', [
            'users' => User::where('name', 'like', "%{$this->search}%")
                ->orderBy($this->sortField, $this->sortDirection)
                ->paginate(10),
        ]);
    }

    public function sortBy($field)
    {
        $this->sortDirection = $this->sortField === $field 
            ? ($this->sortDirection === 'asc' ? 'desc' : 'asc') 
            : 'asc';
        $this->sortField = $field;
    }
}
```

```blade
{{-- Livewire Blade --}}
<input wire:model.live.debounce.300ms="search" placeholder="搜索...">
<table>
    <thead>
        <tr>
            <th wire:click="sortBy('name')">姓名</th>
            <th wire:click="sortBy('email')">邮箱</th>
        </tr>
    </thead>
    <tbody>
        @foreach($users as $user)
            <tr>
                <td>{{ $user->name }}</td>
                <td>{{ $user->email }}</td>
            </tr>
        @endforeach
    </tbody>
</table>
{{ $users->links() }}
```

**Htmx 的代码更分散，但更透明：**

```php
// Htmx Controller
public function list(Request $request)
{
    $search = $request->input('q');
    $sortField = $request->input('sort', 'name');
    $sortDir = $request->input('dir', 'asc');

    $users = User::query()
        ->when($search, fn($q) => $q->where('name', 'like', "%{$search}%"))
        ->orderBy($sortField, $sortDir)
        ->paginate(10);

    if ($request->header('HX-Request')) {
        return view('users.partials.list', compact('users', 'search', 'sortField', 'sortDir'));
    }
    return view('users.index', compact('users', 'search', 'sortField', 'sortDir'));
}
```

```blade
{{-- Htmx Blade --}}
<input type="text" name="q"
       hx-get="{{ route('users.list') }}"
       hx-trigger="keyup changed delay:300ms"
       hx-target="#user-list"
       hx-include="[name='sort'],[name='dir']"
       placeholder="搜索...">

<table>
    <thead>
        <tr>
            <th><a hx-get="{{ route('users.list', ['sort' => 'name']) }}"
                   hx-target="#user-list"
                   hx-include="[name='q']"
                   href="{{ route('users.list', ['sort' => 'name']) }}">姓名</a></th>
            <th><a hx-get="{{ route('users.list', ['sort' => 'email']) }}"
                   hx-target="#user-list"
                   hx-include="[name='q']"
                   href="{{ route('users.list', ['sort' => 'email']) }}">邮箱</a></th>
        </tr>
    </thead>
    <tbody>
        @foreach($users as $user)
            <tr>
                <td>{{ $user->name }}</td>
                <td>{{ $user->email }}</td>
            </tr>
        @endforeach
    </tbody>
</table>
{{ $users->links() }}
```

### 5.4 选型建议

**选 Livewire 当：**
- 你的团队主要是 Laravel 开发者，前端经验有限
- 项目需要复杂的有状态交互（实时表单验证、多步骤向导、拖拽）
- 你希望代码"一体化"，减少文件切换
- 项目规模中等，组件复用需求高

**选 Htmx 当：**
- 你的项目以内容展示为主，交互相对简单
- 你追求极致的性能和最小的 JS 依赖
- 你需要渐进增强（无 JS 也能用）
- 你不想被绑定到 Laravel，可能需要在其他后端框架中复用前端方案
- 你的团队对 HTTP 和 HTML 有深入理解

## 六、Htmx vs Hotwire/Turbo

Hotwire（HTML Over The Wire）是 Basecamp 推出的前端方案，包含 Turbo 和 Stimulus 两部分。它和 Htmx 有很多相似之处，但也有关键差异。

### 6.1 核心对比

| 维度 | Htmx | Hotwire/Turbo |
|------|------|---------------|
| **哲学** | HTML 属性驱动，极简 | 约定优于配置，全家桶 |
| **页面导航** | 不处理，纯局部更新 | Turbo Drive：全页导航也变成 SPA 体验 |
| **HTML 片段** | 用 hx-swap 控制替换 | Turbo Frames：声明式区域 + 链接自动局部化 |
| **实时更新** | 用 SSE 或轮询 | Turbo Streams：WebSocket / SSE 内置支持 |
| **JS 交互** | 无内置方案，需要自己写或用 Alpine.js | Stimulus：轻量级 JS 控制器框架 |
| **框架绑定** | 无，任何后端都行 | Rails 最佳，Laravel 有第三方包 |
| **学习曲线** | 极低（几个属性） | 中等（Turbo + Stimulus 概念较多） |

### 6.2 Turbo Drive 的独特优势

Turbo Drive 是 Hotwire 的一个杀手级功能：它会拦截页面上的所有链接点击，自动转换为 AJAX 请求，然后只替换 `<body>` 内容（保持 `<head>` 不变）。这让你的整个网站都获得 SPA 级别的导航速度，而**不需要做任何额外的工作**。

Htmx 没有这个功能。如果你想让 Htmx 实现全站 SPA 导航，你需要自己处理每个链接，这会很繁琐。

### 6.3 在 Laravel 中使用 Turbo

Laravel 有一个社区维护的 `hotwired-laravel/turbo-laravel` 包：

```bash
composer require hotwired-laravel/turbo-laravel
npm install @hotwired/turbo
```

```javascript
// resources/js/app.js
import '@hotwired/turbo';
```

Turbo 的 Blade 指令：

```blade
{{-- Turbo Frame：声明一个局部更新区域 --}}
<x-turbo-frame id="user-list">
    @foreach($users as $user)
        <x-turbo-frame id="user-{{ $user->id }}">
            <tr>
                <td>{{ $user->name }}</td>
                <td><a href="/users/{{ $user->id }}/edit">编辑</a></td>
            </tr>
        </x-turbo-frame>
    @endforeach
</x-turbo-frame>
```

当用户点击"编辑"链接时，Turbo 会自动发起请求，寻找返回 HTML 中同名的 `<turbo-frame>`，然后只替换该 frame 的内容。这个过程完全是自动的，不需要写任何 JavaScript 或 Htmx 属性。

### 6.4 选型建议

**选 Hotwire/Turbo 当：**
- 你想要"零配置"的全站 SPA 体验
- 你需要 WebSocket 实时更新
- 你的项目有很多"页面级"导航（而不是局部更新）

**选 Htmx 当：**
- 你只想要局部更新，不需要全站 SPA
- 你不想引入 Stimulus（或者你已经有 Alpine.js）
- 你追求最小的 JS 体积
- 你需要最大的灵活性

## 七、渐进增强理念：无 JS 也能用

渐进增强（Progressive Enhancement）是 Htmx 最大的哲学优势。它的核心思想是：**先构建一个在没有 JavaScript 的情况下也能正常工作的版本，然后用 JavaScript 增强体验**。

### 7.1 实践渐进增强的模式

```blade
{{-- 这个表单在没有 JS 时走传统 form submit（完整页面重载） --}}
{{-- 有 JS（Htmx）时走 AJAX 局部更新 --}}
<form method="POST" 
      action="{{ route('tasks.store') }}"
      hx-post="{{ route('tasks.store') }}"
      hx-target="#task-list"
      hx-swap="afterbegin"
      hx-on::after-request="if(event.detail.successful) this.reset()">
    
    @csrf
    <input type="text" name="title" placeholder="新任务..." required>
    <button type="submit">添加</button>
</form>
```

关键在于：`method="POST"` 和 `action="..."` 是标准 HTML 属性，即使 Htmx 没有加载，表单也能通过传统的 form submission 提交。Htmx 的 `hx-post` 只是在此基础上覆盖了默认行为，把全页刷新变成了局部更新。

### 7.2 链接的渐进增强

```blade
{{-- 有 Htmx 时：点击只刷新任务列表 --}}
{{-- 没有 Htmx 时：链接正常导航到 /tasks --}}
<a href="{{ route('tasks.index') }}"
   hx-get="{{ route('tasks.list') }}"
   hx-target="#task-list"
   hx-swap="innerHTML">
    查看任务
</a>
```

### 7.3 为什么渐进增强很重要

1. **SEO 友好。** 搜索引擎爬虫看到的是完整的 HTML，不需要执行 JavaScript。
2. **无障碍访问。** 屏幕阅读器和辅助技术可以正常工作。
3. **故障容错。** 如果 CDN 挂了或者 JS 加载失败，网站依然可用。
4. **更快的首次加载。** 首屏内容直接由服务端渲染，不需要等待 JS 下载和执行。

## 八、Htmx 的局限性与适用边界

Htmx 不是万能的。在某些场景下，它力不从心：

### 8.1 不适合 Htmx 的场景

**复杂的客户端状态管理。** 如果你的应用有复杂的客户端状态（如画板、代码编辑器、富文本编辑器），Htmx 无法胜任。你需要真正的前端框架。

**高频实时交互。** 虽然 Htmx 支持 SSE 和轮询，但对于高频实时更新（如股票行情、游戏），每次请求都返回 HTML 片段的开销太大。这种场景应该用 WebSocket + JSON + 客户端渲染。

**离线支持。** Htmx 完全依赖网络请求，无法支持离线场景。

**复杂的动画和过渡。** Htmx 支持基本的 CSS 过渡（通过 `hx-swap` 的 `settle` 选项），但复杂的动画序列需要用 CSS 动画库或 JS 动画库。

### 8.2 Htmx 的"甜蜜区"

- CRUD 应用（管理后台、CMS、电商后台）
- 内容网站（博客、文档、新闻）
- 表单密集型应用（注册、问卷、审批流程）
- 渐进增强的营销页面
- 内部工具和 Admin 面板

## 九、生产项目中的最佳实践

### 9.1 使用中间件统一处理 Htmx 响应

与其在每个 Controller 方法中检查 `HX-Request` 头，不如用中间件统一处理：

```php
// app/Http/Middleware/HandleHtmxRequests.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class HandleHtmxRequests
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 如果是 Htmx 请求且是重定向，返回 Htmx 重定向头
        if ($request->header('HX-Request') && $response->isRedirect()) {
            $response->header('HX-Redirect', $response->getTargetUrl());
            $response->header('HX-Push-Url', $response->getTargetUrl());
        }

        return $response;
    }
}
```

### 9.2 使用 View Composer 简化视图逻辑

```php
// app/Providers/AppServiceProvider.php
public function boot()
{
    // 为所有用户相关视图共享当前用户数据
    view()->composer(['users.partials.*'], function ($view) {
        $view->with('currentUser', auth()->user());
    });
}
```

### 9.3 Htmx 片段的缓存策略

```php
// 对于不经常变化的列表，可以设置 Cache-Control 头
public function list(Request $request)
{
    $users = User::latest()->paginate(10);
    
    return response()
        ->view('users.partials.list', compact('users'))
        ->header('Cache-Control', 'max-age=60, stale-while-revalidate=300');
}
```

### 9.4 使用 Boost 提升全站体验

Htmx 有一个"boost"功能，可以让页面上所有链接都自动变成 Htmx 请求：

```html
<body hx-boost="true">
    <!-- 页面内所有链接都会自动用 Htmx 加载 -->
</body>
```

这类似于 Turbo Drive 的效果，但实现方式更简单。注意：`hx-boost` 会把链接的 `href` 转换成 `hx-get`，并把返回的 `<body>` 内容替换到当前页面。

### 9.5 错误处理

```javascript
// 全局错误处理
document.body.addEventListener('htmx:responseError', function(event) {
    const xhr = event.detail.xhr;
    const status = xhr.status;
    
    switch(status) {
        case 401:
            window.location.href = '/login';
            break;
        case 403:
            alert('没有权限执行此操作');
            break;
        case 422:
            // 验证错误，Htmx 会自动替换响应内容
            break;
        case 500:
            alert('服务器错误，请稍后重试');
            break;
    }
});

// 请求超时处理
document.body.addEventListener('htmx:timeout', function(event) {
    alert('请求超时，请检查网络连接');
});
```

## 十、真实踩坑记录与解决方案

### 踩坑一：Laravel 分页链接与 Htmx 冲突

**问题：** Laravel 的 `{{ $users->links() }}` 生成的分页链接是普通的 `<a>` 标签，点击后会触发整页刷新。

**解决方案：** 给分页链接的父容器加上 `hx-boost`：

```blade
<div hx-boost="true" 
     hx-target="#user-list">
    {{ $users->appends(request()->query())->links() }}
</div>
```

`hx-boost="true"` 会让容器内所有链接自动变成 Htmx 请求。`appends(request()->query())` 确保搜索等查询参数在分页时保留。

### 踩坑二：CSRF Token 过期

**问题：** 用户长时间停留在页面，CSRF token 过期，POST 请求返回 419 错误。

**解决方案：** 监听 419 响应，自动刷新 token：

```javascript
document.body.addEventListener('htmx:afterRequest', function(event) {
    if (event.detail.xhr.status === 419) {
        // 重新获取页面（会刷新 CSRF token）
        fetch(window.location.href)
            .then(response => response.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const newToken = doc.querySelector('meta[name="csrf-token"]').content;
                document.querySelector('meta[name="csrf-token"]').content = newToken;
                
                // 重试原请求
                htmx.trigger(event.detail.elt, event.detail.requestConfig.trigger);
            });
    }
});
```

### 踩坑三：hx-swap="outerHTML" 删除后 ID 重复

**问题：** 使用 `hx-swap="outerHTML"` 删除并重新加载列表时，如果新列表中包含已删除行的 ID，会导致 ID 冲突。

**解决方案：** 使用 `hx-swap="delete"` 专门用于删除操作，不要用 `outerHTML` 来"替换为空"：

```blade
<button hx-delete="{{ route('users.destroy', $user) }}"
        hx-target="#user-{{ $user->id }}"
        hx-swap="delete"  {{-- 直接删除目标元素 --}}
        hx-confirm="确定删除？">
    删除
</button>
```

### 踩坑四：Laravel 的 JSON 响应被 Htmx 当作 HTML 渲染

**问题：** 某些 API 路由返回 JSON，但被 Htmx 当作 HTML 插入页面，导致显示 `[object Object]` 或 JSON 字符串。

**解决方案：** 在路由定义中明确区分 API 和 Web 路由，或者在 Controller 中检查 Htmx 头：

```php
public function update(Request $request, User $user)
{
    $user->update($request->validated());

    // 如果是 Htmx 请求，返回 HTML 片段
    if ($request->header('HX-Request')) {
        return view('users.partials.row', compact('user'));
    }

    // 如果是 API 请求，返回 JSON
    if ($request->expectsJson()) {
        return response()->json($user);
    }

    return redirect()->route('users.index');
}
```

### 踩坑五：Safari 浏览器的历史记录问题

**问题：** Htmx 的 `hx-push-url="true"` 在 Safari 中偶尔出现历史记录异常。

**解决方案：** 使用 `hx-push-url` 时确保 URL 是完整的路径，而不是相对路径：

```blade
{{-- 不推荐 --}}
<div hx-get="/users?page=2" hx-push-url="true">

{{-- 推荐：使用完整 URL --}}
<div hx-get="{{ route('users.list', ['page' => 2]) }}" 
     hx-push-url="{{ route('users.list', ['page' => 2]) }}">
```

### 踩坑六：Laravel Vite 开发服务器的 HMR 干扰

**问题：** 使用 Vite 开发时，HMR（Hot Module Replacement）的 WebSocket 连接偶尔与 Htmx 的请求冲突。

**解决方案：** 这通常是开发环境的问题，生产环境不会出现。开发时如果遇到，可以尝试刷新页面或在 `vite.config.js` 中调整 HMR 配置。

### 踩坑七：hx-include 作用域理解错误

**问题：** 开发者常常误以为 `hx-include` 会自动包含触发元素所在的整个表单。实际上 `hx-include` 需要显式指定要包含的元素范围，否则只会发送当前元素自身的值。

**解决方案：** 明确指定包含的选择器，或者直接使用 `<form>` 元素作为 Htmx 的触发器：

```html
<!-- 错误：input 不会自动包含同级的其他 input -->
<input name="q" hx-get="/search" hx-include="this" hx-target="#results">
<input name="category" value="all">

<!-- 正确：使用 CSS 选择器包含所有需要的字段 -->
<input name="q" hx-get="/search" 
       hx-include="[name='q'], [name='category']" 
       hx-target="#results">
<input name="category" value="all">

<!-- 最佳：用 form 包裹，Htmx 自动序列化所有字段 -->
<form hx-get="/search" hx-target="#results">
    <input name="q">
    <input name="category" value="all">
    <button type="submit">搜索</button>
</form>
```

### 踩坑八：SSE（Server-Sent Events）连接数限制

**问题：** 浏览器对同一域名的 SSE 连接数有限制（HTTP/1.1 下通常是 6 个），如果页面上多个组件同时使用 SSE，新的连接会被浏览器阻塞排队，导致实时更新延迟或丢失。

**解决方案：** 使用一个 SSE 端点广播多个事件类型，而不是为每个组件创建独立的 SSE 连接：

```php
// routes/web.php
Route::get('/sse/events', function () {
    return response()->stream(function () {
        while (true) {
            $notifications = Cache::pull('sse:notifications');
            $stats = Cache::pull('sse:stats');
            
            if ($notifications) {
                echo "event: notifications\n";
                echo "data: {$notifications}\n\n";
                ob_flush();
                flush();
            }
            
            if ($stats) {
                echo "event: stats\n";
                echo "data: {$stats}\n\n";
                ob_flush();
                flush();
            }
            
            if (connection_aborted()) break;
            sleep(1);
        }
    }, 200, [
        'Content-Type'  => 'text/event-stream',
        'Cache-Control' => 'no-cache',
        'Connection'    => 'keep-alive',
        'X-Accel-Buffering' => 'no', // Nginx 禁用缓冲
    ]);
});
```

```blade
<!-- 多个组件监听同一个 SSE 源的不同事件 -->
<div hx-get="/api/notifications"
     hx-trigger="sse:notifications"
     hx-swap="innerHTML"
     id="notification-area">
</div>

<div hx-get="/api/stats"
     hx-trigger="sse:stats"
     hx-swap="innerHTML"
     id="stats-area">
</div>
```

## 十一、Htmx 事件系统与全局拦截器

Htmx 拥有完整的请求生命周期事件系统，理解这些事件对于调试、实现加载状态、以及全局错误处理至关重要。

### 11.1 请求生命周期事件

```javascript
// 请求发送前：可以修改请求头、显示加载状态
document.body.addEventListener('htmx:beforeRequest', function(event) {
    console.log('请求即将发送:', event.detail.path);
    console.log('目标元素:', event.detail.target);
    console.log('触发元素:', event.detail.elt);
});

// 配置请求：最常用的修改请求参数的时机
document.body.addEventListener('htmx:configRequest', function(event) {
    // 添加自定义请求头
    event.detail.headers['X-Custom-Header'] = 'my-value';
    
    // 动态修改请求参数
    event.detail.params['extra_param'] = 'value';
});

// 请求完成后：无论成功或失败都会触发
document.body.addEventListener('htmx:afterRequest', function(event) {
    const xhr = event.detail.xhr;
    console.log('状态码:', xhr.status);
    console.log('响应内容:', xhr.responseText.substring(0, 100));
});

// DOM 替换前：可以拦截或修改替换行为
document.body.addEventListener('htmx:beforeSwap', function(event) {
    if (event.detail.xhr.status === 404) {
        // 自定义 404 处理
        event.detail.target.innerHTML = '<p class="text-red-500">资源不存在</p>';
        event.detail.shouldSwap = false;
    }
});
```

### 11.2 全局加载指示器实现

```html
<!-- 全局加载进度条 -->
<div id="global-loading" 
     class="fixed top-0 left-0 h-1 bg-blue-500 z-50 hidden transition-all duration-300"
     style="width: 0%">
</div>

<script>
    let loadingTimer;
    
    document.body.addEventListener('htmx:beforeRequest', function() {
        // 200ms 延迟显示（避免快速请求造成闪烁）
        loadingTimer = setTimeout(function() {
            const bar = document.getElementById('global-loading');
            bar.classList.remove('hidden');
            bar.style.width = '30%';
            setTimeout(() => bar.style.width = '60%', 300);
            setTimeout(() => bar.style.width = '80%', 800);
        }, 200);
    });
    
    document.body.addEventListener('htmx:afterOnLoad', function() {
        clearTimeout(loadingTimer);
        const bar = document.getElementById('global-loading');
        bar.style.width = '100%';
        setTimeout(function() {
            bar.classList.add('hidden');
            bar.style.width = '0%';
        }, 300);
    });
</script>
```

### 11.3 使用 hx-on 实现内联事件处理

Htmx 还支持在元素上直接写事件处理，类似于 Vue 的 `@click` 语法：

```html
<button hx-get="/api/action"
        hx-target="#result"
        hx-on::before-request="this.disabled = true"
        hx-on::after-request="this.disabled = false">
    提交
</button>

<!-- 嵌套事件名用双冒号分隔 -->
<form hx-post="/api/form"
      hx-target="#result"
      hx-on::before-request="document.getElementById('spinner').classList.remove('hidden')"
      hx-on::after-request="document.getElementById('spinner').classList.add('hidden')">
</form>
```

## 十二、混合方案：Htmx + Alpine.js

Htmx 负责服务端交互，Alpine.js 负责客户端轻量级交互，这是 Laravel 社区非常流行的组合：

```blade
<div x-data="{ showForm: false, selected: [] }">
    
    {{-- Alpine.js 控制客户端 UI 状态 --}}
    <button @click="showForm = !showForm" class="bg-blue-500 text-white px-4 py-2 rounded">
        <span x-text="showForm ? '收起表单' : '添加用户'"></span>
    </button>

    {{-- Alpine.js + Htmx 配合 --}}
    <div x-show="showForm" x-transition>
        <form hx-post="{{ route('users.store') }}"
              hx-target="#user-list tbody"
              hx-swap="afterbegin"
              hx-on::after-request="if(event.detail.successful) { 
                  this.reset(); 
                  showForm = false; 
              }">
            @csrf
            <input type="text" name="name" placeholder="姓名" required>
            <button type="submit" class="bg-green-500 text-white px-4 py-2 rounded">
                提交
            </button>
        </form>
    </div>

    {{-- 批量选择（Alpine.js 管理状态，Htmx 发送请求） --}}
    <div id="user-list">
        @foreach($users as $user)
            <div class="flex items-center gap-2 p-2 border-b">
                <input type="checkbox" 
                       :checked="selected.includes({{ $user->id }})"
                       @change="selected.includes({{ $user->id }}) 
                           ? selected = selected.filter(id => id !== {{ $user->id }})
                           : selected.push({{ $user->id }})">
                <span>{{ $user->name }}</span>
            </div>
        @endforeach
    </div>

    <button hx-post="{{ route('users.bulk-delete') }}"
            hx-vals='js:{ids: JSON.stringify(selected)}'
            hx-confirm="确定删除选中的用户？"
            :disabled="selected.length === 0"
            class="mt-4 bg-red-500 text-white px-4 py-2 rounded disabled:opacity-50">
        批量删除
    </button>
</div>
```

这个组合的优势是：**Alpine.js 处理客户端 UI 状态（显示/隐藏、选中、动画），Htmx 处理服务端数据交互**。两者各司其职，避免了互相干扰。

## 十三、总结：选择你的渐进增强路线

三条路线的核心差异可以用一句话概括：

- **Htmx**："给我返回 HTML 片段，我来替换 DOM。"
- **Livewire**："给我保持组件状态，我来同步客户端和服务端。"
- **Hotwire/Turbo**："给我返回完整 HTML，我来智能提取需要更新的部分。"

如果你是一个 Laravel 开发者，想要在不引入复杂前端工具链的前提下给应用添加交互，这三种方案都值得尝试。我的建议是：

1. **先从 Htmx 开始。** 它的学习成本最低，能让你快速理解"服务端渲染 + 局部更新"的模式。
2. **当 Htmx 不够用时，考虑 Livewire。** 如果你需要复杂的有状态组件和表单绑定，Livewire 会更高效。
3. **如果你想要全站 SPA 体验，看看 Turbo。** Turbo Drive 能让你的整个网站获得 SPA 级别的导航速度。

最重要的是，无论你选择哪条路线，**渐进增强的理念都是一样的：先确保基础功能在没有 JavaScript 的情况下正常工作，然后用 JavaScript 去增强它**。这不是保守，而是一种更稳健、更用户友好的工程哲学。

> 在前端框架疯狂内卷的今天，Htmx 提醒我们一个简单的事实：HTTP + HTML 已经足够强大了。我们只是忘了它能做到多少事情。

---

**参考资源：**

- [Htmx 官方文档](https://htmx.org)
- [Htmx + Laravel 社区指南](https://htmx.org/docs/#third-party)
- [Livewire 官方文档](https://livewire.laravel.com)
- [Hotwire/Turbo 官方文档](https://turbo.hotwired.dev)
- [turbo-laravel 包](https://github.com/hotwired-laravel/turbo-laravel)
- [Alpine.js 官方文档](https://alpinejs.dev)

## 相关阅读

- [Hotwire/Turbo 实战：Ruby on Rails 的前端哲学在 Laravel 中复用——Livewire vs Turbo 渐进增强路线对比](/categories/前端/Hotwire-Turbo-实战-Ruby-on-Rails前端哲学在Laravel中复用-Livewire-vs-Turbo渐进增强路线对比/)
- [Web Components 实战：浏览器原生组件标准——跨框架 UI 组件库设计与 Laravel Blade 集成](/categories/前端/web-components-cross-framework-ui-laravel-blade/)
- [Astro 5.x 实战：内容优先的 Web 框架——Islands Architecture 与 Laravel Headless CMS 后端集成](/categories/前端/astro-5x-islands-architecture-laravel-headless-cms/)
