---

title: Laravel + Inertia.js 实战：Vue 3/React 单页应用的全新全栈范式——对比传统 SPA 前后端分离的开发体验
keywords: [Laravel, Inertia.js, Vue, React, SPA, 单页应用的全新全栈范式, 对比传统, 前后端分离的开发体验]
date: 2026-06-03 08:00:00
tags:
- Laravel
- Inertia.js
- Vue
- React
- SPA
- 全栈
- TypeScript
categories:
- php
description: 深入剖析 Inertia.js 如何让 Laravel 与 Vue 3/React 无缝协作构建单页应用，对比传统前后端分离的开发体验差异。涵盖 Inertia Protocol 原理、SSR 服务端渲染、表单处理、权限控制、性能优化等核心实战，含完整任务管理系统代码示例，帮你告别 CORS/JWT/API 胶水代码，用全栈思维构建现代 SPA。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---





# Laravel + Inertia.js 实战：Vue 3/React 单页应用的全新全栈范式——对比传统 SPA 前后端分离的开发体验

## 前言：全栈开发的十字路口

在当今的 Web 开发世界中，我们正处在一个有趣的十字路口。一方面，前端框架的蓬勃发展催生了前后端分离的主流架构模式，Vue.js、React 和 Angular 等框架让前端开发者拥有了前所未有的能力来构建复杂的单页应用（SPA）。另一方面，服务端框架如 Laravel、Rails 和 Django 也在不断进化，提供了越来越强大的全栈开发能力。

传统的前后端分离模式要求开发者维护两套独立的代码库：一套用于 RESTful API 后端，另一套用于 SPA 前端。这种模式在大型团队和复杂项目中确实有其优势，比如前后端可以并行开发、API 可以被多个客户端复用等。然而，对于大量的中小型项目和全栈开发者而言，这种模式带来的额外复杂性往往令人望而却步。你需要处理 CORS 跨域配置、设计和文档化 API 接口、管理认证状态（JWT 或 Session Token）、协调前端路由与后端路由的一致性、处理数据序列化和反序列化……这些繁琐的"胶水代码"消耗了大量宝贵的开发时间。

**Inertia.js** 的出现，为这一困境提供了第三种选择，一个优雅而实用的折中方案。它既不是传统的模板引擎，也不是一个前端框架，而是一个**精巧的协议层**，它让服务端框架（如 Laravel）和客户端 SPA 框架（如 Vue 3 或 React）能够无缝协作。通过 Inertia.js，你可以继续使用 Laravel 控制器来组织业务逻辑和数据获取，然后直接返回 Vue 3 或 React 组件作为响应——不需要构建 API，不需要处理认证 Token，不需要配置 CORS，就能获得完整的 SPA 体验。页面导航无刷新、组件状态保持、浏览器历史管理、表单验证反馈，所有你期望的 SPA 特性都开箱即用。

这篇文章将从 Inertia.js 的核心协议原理开始讲起，深入剖析它的工作机制，然后通过与传统 SPA 前后端分离模式的全面对比，帮助你理解两种模式各自的优劣。接下来，我们会通过 Vue 3 + TypeScript 和 React 两个完整的实战案例，手把手地展示如何使用 Inertia.js 构建一个功能完备的任务管理系统。最后，我们还会讨论 SSR 服务端渲染方案、迁移策略以及最佳实践。

无论你是刚入门的全栈开发者，还是在前后端分离模式中疲于奔命的资深工程师，这篇文章都将为你打开一扇新的窗户，让你重新审视全栈开发的可能。

---

## 第一章：Inertia.js 核心原理深度解析

### 1.1 Inertia Protocol：服务端与客户端的精巧对话协议

要真正理解 Inertia.js，我们首先需要理解它背后的**通信协议**（Inertia Protocol）。这个协议定义了服务端（Laravel）和客户端（Vue/React）之间如何交换数据，是 Inertia.js 最核心的设计。

#### 传统页面请求的工作流程

在传统的 Laravel 应用中，当我们访问一个页面时，控制器返回一个 Blade 模板视图：

```php
// 传统 Laravel 控制器
class UserController extends Controller
{
    public function index()
    {
        $users = User::paginate(10);
        return view('users.index', compact('users'));
    }
}
```

浏览器收到的是一个完整的 HTML 文档，渲染过程是同步的——服务器生成 HTML，浏览器接收并渲染，整个页面刷新一次。这种模式简单直观，但用户体验不够流畅，每次点击链接都会导致页面闪烁和重新加载。

#### Inertia 请求的工作流程

而在 Inertia.js 的世界里，控制器返回的是一个 **Inertia 响应对象**：

```php
// Inertia 控制器
class UserController extends Controller
{
    public function index()
    {
        $users = User::paginate(10);
        return Inertia::render('Users/Index', [
            'users' => $users,
        ]);
    }
}
```

表面上看，代码几乎一样，但底层发生了本质变化。Inertia 不返回 HTML，而是返回一个结构化的 **JSON 响应**：

```json
{
    "component": "Users/Index",
    "props": {
        "users": {
            "data": [
                {"id": 1, "name": "张三", "email": "zhangsan@example.com"},
                {"id": 2, "name": "李四", "email": "lisi@example.com"}
            ],
            "links": {
                "first": "http://example.com/users?page=1",
                "last": "http://example.com/users?page=5",
                "prev": null,
                "next": "http://example.com/users?page=2"
            },
            "meta": {"current_page": 1, "last_page": 5, "total": 50}
        }
    },
    "url": "/users",
    "version": "a1b2c3d4e5f6"
}
```

这个 JSON 响应包含四个关键字段：

- **component**：告诉客户端应该渲染哪个前端组件。这个值对应的是 Vue/React 组件的路径名称，比如 `Users/Index` 会映射到 `resources/js/Pages/Users/Index.vue` 或 `resources/js/Pages/Users/Index.tsx`。
- **props**：传递给组件的数据，相当于传统模板中的视图变量。这些数据会被自动传递到对应的前端组件的 props 中。
- **url**：当前请求的 URL 地址，用于更新浏览器地址栏和历史记录。
- **version**：应用版本标识符，用于检测客户端缓存是否过期，实现智能缓存刷新。

#### 请求头识别机制：如何区分普通请求和 Inertia 请求

Inertia.js 通过 HTTP 请求头来巧妙地区分普通请求和 Inertia 请求。当 Inertia 客户端库发起导航请求时，会自动在请求头中添加 `X-Inertia: true` 标识：

```
GET /users HTTP/1.1
Host: example.com
X-Inertia: true
X-Inertia-Version: a1b2c3d4e5f6
Accept: text/html, application/xhtml+xml
```

服务端的 `HandleInertiaRequests` 中间件会检测这个请求头。如果存在 `X-Inertia: true`，就返回 JSON 格式的 Inertia 响应；如果不存在（比如用户首次访问页面、或手动在浏览器地址栏输入 URL），则返回包含前端应用入口脚本的完整 HTML 页面。

这个设计非常精妙，它意味着：

1. **首次页面加载是传统的服务端渲染**，返回完整的 HTML 文档，其中包含了前端应用的入口脚本和初始数据。
2. **后续所有页面导航都是 SPA 式的客户端请求**，只获取 JSON 数据，由客户端渲染新组件。
3. **SEO 友好**：搜索引擎爬虫首次访问时会收到完整的 HTML 内容。
4. **渐进增强**：即使 JavaScript 加载失败，首次访问的页面仍然可以正常显示。

这种"首次加载服务端渲染 + 后续导航客户端渲染"的混合模式，在不需要额外 SSR 配置的情况下，就能满足大多数项目的 SEO 需求。

#### 版本控制与缓存失效策略

在持续部署的场景下，前端资源（JavaScript、CSS）会随着每次部署而更新。如果客户端仍然使用旧版本的缓存资源，就可能出现功能异常或样式错乱。Inertia Protocol 通过一个精巧的**版本控制机制**解决了这个问题。

在 `HandleInertiaRequests` 中间件中，你可以定义应用的版本号：

```php
class HandleInertiaRequests extends Middleware
{
    // 方式一：手动指定版本号
    protected $version = '1.0.0';

    // 方式二：基于文件哈希自动生成版本号（推荐）
    public function version(Request $request): string|null
    {
        return parent::version($request);
        // 默认使用 Vite 的 manifest 文件哈希
    }
}
```

当 Inertia 客户端发起请求时，会在请求头中携带当前客户端的版本号 `X-Inertia-Version`。服务端中间件对比客户端版本和服务端版本，如果版本不一致，会返回一个 **409 Conflict** 响应，其中包含一个 `X-Inertia-Location` 头，指向当前 URL。客户端收到这个响应后，会自动执行一次**完整的页面刷新**（`window.location.reload()`），从而加载最新的前端资源。

这个机制优雅地解决了 SPA 部署后的缓存失效问题，无需用户手动清除浏览器缓存，也无需开发者在文件名中添加哈希后缀（虽然 Vite 默认会这样做）。它是"自动的、透明的、零配置的"。

### 1.2 Shared Data：全局共享数据机制详解

在传统的 Laravel Blade 模板中，我们经常使用 `View::share()` 来定义全局变量，比如当前登录用户信息、站点配置等。Inertia 的 `SharedData` 机制提供了类似的功能，但更加适合 SPA 的数据流模式。

#### 配置共享数据

共享数据在 `HandleInertiaRequests` 中间件的 `share()` 方法中定义。这个方法返回一个数组，其中的所有数据都会自动注入到每个 Inertia 页面的 props 中：

```php
class HandleInertiaRequests extends Middleware
{
    public function share(Request $request): array
    {
        return array_merge(parent::share($request), [
            // 闪存消息 — 表单提交后的成功/错误提示
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
                'error' => fn () => $request->session()->get('error'),
                'warning' => fn () => $request->session()->get('warning'),
            ],

            // 当前认证用户信息
            'auth' => [
                'user' => $request->user() ? [
                    'id' => $request->user()->id,
                    'name' => $request->user()->name,
                    'email' => $request->user()->email,
                    'avatar' => $request->user()->avatar_url,
                    'role' => $request->user()->role,
                    'permissions' => $request->user()->getAllPermissions()->pluck('name'),
                ] : null,
            ],

            // CSRF Token（表单安全验证）
            'csrf_token' => csrf_token(),

            // 应用全局配置
            'app' => [
                'name' => config('app.name'),
                'locale' => app()->getLocale(),
                'timezone' => config('app.timezone'),
                'env' => app()->environment(),
            ],

            // Ziggy 路由信息（可选，让前端也能使用 Laravel 命名路由）
            'ziggy' => fn () => array_merge((new Ziggy)->toArray(), [
                'location' => $request->url(),
            ]),

            // 全局导航菜单数据
            'navigation' => fn () => [
                'main_menu' => MenuItem::where('is_active', true)
                    ->orderBy('sort_order')
                    ->get(),
                'unread_notifications' => $request->user()
                    ? $request->user()->unreadNotifications()->count()
                    : 0,
            ],
        ]);
    }
}
```

#### 前端组件中访问共享数据

在 Vue 3 组件中，可以通过 `usePage()` 钩子来访问共享数据：

```vue
<script setup lang="ts">
import { usePage, router } from '@inertiajs/vue3'
import { computed } from 'vue'

// 定义 Props 类型
interface PageProps {
    auth: {
        user: {
            id: number
            name: string
            email: string
            avatar: string
            role: string
            permissions: string[]
        } | null
    }
    flash: {
        success: string | null
        error: string | null
        warning: string | null
    }
    app: {
        name: string
        locale: string
        env: string
    }
    navigation: {
        main_menu: MenuItem[]
        unread_notifications: number
    }
}

const page = usePage<PageProps>()

// 使用 computed 保持响应式
const currentUser = computed(() => page.props.auth.user)
const flashMessages = computed(() => page.props.flash)
const appName = computed(() => page.props.app.name)
const unreadCount = computed(() => page.props.navigation.unread_notifications)

// 检查权限
const hasPermission = (permission: string): boolean => {
    return currentUser.value?.permissions.includes(permission) ?? false
}
</script>

<template>
    <div class="app-layout">
        <!-- 顶部导航栏 -->
        <header class="app-header">
            <div class="logo">
                <h1>{{ appName }}</h1>
            </div>
            <nav class="main-nav">
                <Link
                    v-for="item in page.props.navigation.main_menu"
                    :key="item.id"
                    :href="item.url"
                    class="nav-link"
                >
                    {{ item.title }}
                </Link>
            </nav>
            <div class="user-section" v-if="currentUser">
                <span class="notification-badge" v-if="unreadCount > 0">
                    {{ unreadCount }}
                </span>
                <img :src="currentUser.avatar" class="avatar" />
                <span>{{ currentUser.name }}</span>
            </div>
        </header>

        <!-- 闪存消息通知 -->
        <div class="flash-messages">
            <Transition name="slide-fade">
                <div v-if="flashMessages.success" class="alert alert-success">
                    <span class="icon">✓</span>
                    {{ flashMessages.success }}
                    <button @click="flashMessages.success = null" class="close">×</button>
                </div>
            </Transition>
            <Transition name="slide-fade">
                <div v-if="flashMessages.error" class="alert alert-error">
                    <span class="icon">✗</span>
                    {{ flashMessages.error }}
                    <button @click="flashMessages.error = null" class="close">×</button>
                </div>
            </Transition>
        </div>

        <!-- 主内容区 -->
        <main class="app-main">
            <slot />
        </main>
    </div>
</template>
```

在 React 组件中，可以通过 `usePage()` 钩子类似地访问：

```tsx
import { usePage, Link } from '@inertiajs/react'

interface PageProps {
    auth: {
        user: {
            id: number
            name: string
            email: string
            avatar: string
            role: string
            permissions: string[]
        } | null
    }
    flash: {
        success: string | null
        error: string | null
    }
    app: {
        name: string
        locale: string
    }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { auth, flash, app } = usePage<PageProps>().props

    return (
        <div className="app-layout">
            <header className="app-header">
                <h1>{app.name}</h1>
                {auth.user && (
                    <div className="user-info">
                        <img src={auth.user.avatar} className="avatar" />
                        <span>{auth.user.name}</span>
                    </div>
                )}
            </header>

            {flash.success && (
                <div className="alert alert-success">
                    ✓ {flash.success}
                </div>
            )}

            <main className="app-main">
                {children}
            </main>
        </div>
    )
}
```

#### 惰性求值：性能优化的关键细节

注意上面代码中很多共享数据使用了闭包语法（`fn () => ...`）？这就是 **惰性求值**（Lazy Evaluation）。使用闭包包裹的数据**只有在前端组件实际访问时才会执行计算**。

这个特性非常重要。想象一下，如果你在 `share()` 方法中直接查询数据库来获取通知数据：

```php
// 不好的做法 — 每个页面请求都会执行这个查询
'notifications' => $request->user()
    ? $request->user()->unreadNotifications()->limit(10)->get()
    : [],
```

这意味着即使某个页面根本不需要显示通知（比如登录页面、静态关于页面），这个数据库查询依然会执行，浪费了服务器资源。

使用惰性求值就可以避免这个问题：

```php
// 好的做法 — 只有在前端实际读取时才执行
'notifications' => fn () => $request->user()
    ? $request->user()->unreadNotifications()->limit(10)->get()
    : [],
```

更进一步，结合 Partial Reload 的惰性 Props，你可以实现更精细的性能控制。这个特性我们在下一节详细讨论。

### 1.3 Partial Reloads：部分重载性能优化

Partial Reloads 是 Inertia.js 最重要的性能优化特性之一，也是它相对于传统 SPA 的一个显著优势。要理解 Partial Reloads 的价值，我们先看看传统模式中的性能问题。

#### 问题场景分析

假设你正在开发一个博客系统，文章列表页包含以下几个区域：

1. **文章列表**：核心内容，每翻一页都需要更新
2. **分类导航栏**：侧边栏，数据很少变化
3. **热门标签云**：偶尔变化，但不需要每次请求都更新
4. **用户信息**：通过 SharedData 获取，基本不变

在传统的 SPA 模式下，当你切换页码时，前端通常会向 API 发起一个请求，返回所有数据。但仔细想想，分类和标签数据并没有变化，重新获取它们是浪费带宽和服务器资源。

在没有 Partial Reloads 的情况下，Inertia 也有同样的问题——每次导航都会请求所有 props 数据。

#### Partial Reload 的工作原理

Partial Reloads 允许客户端在导航请求中**指定只需要哪些 props**。服务端收到请求后，只计算和返回被请求的 props，其他 props 会被跳过（特别是惰性 Props）。

在前端使用 Partial Reload 非常简单：

**Vue 3 实现：**

```vue
<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { ref } from 'vue'

interface Post {
    id: number
    title: string
    excerpt: string
    author: { name: string; avatar: string }
    published_at: string
}

interface Category {
    id: number
    name: string
    post_count: number
}

interface Tag {
    id: number
    name: string
    color: string
}

const props = defineProps<{
    posts: PaginatedData<Post>
    categories: Category[]
    popularTags: Tag[]
    archives: { month: string; count: number }[]
}>()

const isLoading = ref(false)

// 翻页时只请求文章列表数据
const goToPage = (page: number) => {
    isLoading.value = true
    router.get(`/posts?page=${page}`, {}, {
        only: ['posts'],          // 只请求 posts 这一个 prop
        preserveState: true,      // 保持当前组件状态不变
        preserveScroll: true,     // 保持当前滚动位置
        onFinish: () => {
            isLoading.value = false
        },
    })
}

// 搜索时只请求文章列表
const search = (keyword: string) => {
    router.get('/posts', { search: keyword }, {
        only: ['posts'],
        preserveState: true,
        replace: true,  // 替换浏览器历史记录，不新增
    })
}

// 刷新标签云（点击"换一批"按钮）
const refreshTags = () => {
    router.reload({ only: ['popularTags'] })
}

// 加载归档数据（点击展开时）
const loadArchives = () => {
    router.reload({ only: ['archives'] })
}
</script>

<template>
    <div class="blog-layout">
        <!-- 侧边栏 -->
        <aside class="sidebar">
            <!-- 分类导航 — 首次加载后保持不变 -->
            <nav class="categories">
                <h3>文章分类</h3>
                <ul>
                    <li v-for="category in categories" :key="category.id">
                        <Link :href="`/posts?category=${category.id}`">
                            {{ category.name }}
                            <span class="count">({{ category.post_count }})</span>
                        </Link>
                    </li>
                </ul>
            </nav>

            <!-- 热门标签 — 支持手动刷新 -->
            <div class="tags-cloud">
                <div class="tags-header">
                    <h3>热门标签</h3>
                    <button @click="refreshTags" class="btn-text">换一批</button>
                </div>
                <div class="tags">
                    <span
                        v-for="tag in popularTags"
                        :key="tag.id"
                        class="tag"
                        :style="{ borderColor: tag.color }"
                    >
                        {{ tag.name }}
                    </span>
                </div>
            </div>

            <!-- 归档 — 惰性加载 -->
            <div class="archives">
                <h3 @click="loadArchives" class="clickable">
                    文章归档
                    <span v-if="archives.length === 0" class="hint">（点击加载）</span>
                </h3>
                <ul v-if="archives.length > 0">
                    <li v-for="archive in archives" :key="archive.month">
                        {{ archive.month }} ({{ archive.count }})
                    </li>
                </ul>
            </div>
        </aside>

        <!-- 主内容区：文章列表 -->
        <main class="posts-list">
            <div v-if="isLoading" class="loading-overlay">
                <div class="spinner"></div>
            </div>

            <article v-for="post in posts.data" :key="post.id" class="post-card">
                <div class="post-meta">
                    <img :src="post.author.avatar" class="author-avatar" />
                    <span>{{ post.author.name }}</span>
                    <time>{{ post.published_at }}</time>
                </div>
                <h2><Link :href="`/posts/${post.id}`">{{ post.title }}</Link></h2>
                <p class="excerpt">{{ post.excerpt }}</p>
            </article>

            <!-- 分页组件 -->
            <Pagination
                :current-page="posts.meta.current_page"
                :last-page="posts.meta.last_page"
                @page-change="goToPage"
            />
        </main>
    </div>
</template>
```

**React 实现：**

```tsx
import { router } from '@inertiajs/react'
import { useState } from 'react'

export default function BlogIndex({ posts, categories, popularTags, archives }) {
    const [isLoading, setIsLoading] = useState(false)

    const goToPage = (page: number) => {
        setIsLoading(true)
        router.get(`/posts?page=${page}`, {}, {
            only: ['posts'],
            preserveState: true,
            preserveScroll: true,
            onFinish: () => setIsLoading(false),
        })
    }

    const refreshTags = () => {
        router.reload({ only: ['popularTags'] })
    }

    return (
        <div className="blog-layout">
            <aside className="sidebar">
                <nav className="categories">
                    <h3>文章分类</h3>
                    {categories.map(cat => (
                        <Link key={cat.id} href={`/posts?category=${cat.id}`}>
                            {cat.name} ({cat.post_count})
                        </Link>
                    ))}
                </nav>

                <div className="tags-cloud">
                    <div className="tags-header">
                        <h3>热门标签</h3>
                        <button onClick={refreshTags}>换一批</button>
                    </div>
                    {popularTags.map(tag => (
                        <span key={tag.id} className="tag" style={{ borderColor: tag.color }}>
                            {tag.name}
                        </span>
                    ))}
                </div>
            </aside>

            <main>
                {posts.data.map(post => (
                    <article key={post.id} className="post-card">
                        <h2><Link href={`/posts/${post.id}`}>{post.title}</Link></h2>
                        <p>{post.excerpt}</p>
                    </article>
                ))}
                <Pagination
                    currentPage={posts.meta.current_page}
                    lastPage={posts.meta.last_page}
                    onPageChange={goToPage}
                />
            </main>
        </div>
    )
}
```

#### 服务端配合：惰性 Props

在 Laravel 控制器中，你可以将不需要每次请求都返回的数据标记为惰性（Lazy）：

```php
class BlogController extends Controller
{
    public function index(Request $request)
    {
        return Inertia::render('Blog/Index', [
            // 普通 Props — 每次请求都会计算和返回
            'posts' => Post::with('author')
                ->when($request->category, fn ($q, $cat) =>
                    $q->where('category_id', $cat)
                )
                ->latest()
                ->paginate(15)
                ->through(fn ($post) => [
                    'id' => $post->id,
                    'title' => $post->title,
                    'excerpt' => $post->excerpt,
                    'author' => [
                        'name' => $post->author->name,
                        'avatar' => $post->author->avatar_url,
                    ],
                    'published_at' => $post->published_at->diffForHumans(),
                ]),

            // 惰性 Props — 只有在客户端请求中显式包含时才计算
            'categories' => Inertia::lazy(fn () =>
                Category::withCount('posts')
                    ->orderBy('name')
                    ->get()
            ),

            'popularTags' => Inertia::lazy(fn () =>
                Tag::withCount('posts')
                    ->orderByDesc('posts_count')
                    ->limit(20)
                    ->get()
            ),

            'archives' => Inertia::lazy(fn () =>
                Post::selectRaw('DATE_FORMAT(created_at, "%Y-%m") as month, COUNT(*) as count')
                    ->groupBy('month')
                    ->orderByDesc('month')
                    ->limit(12)
                    ->get()
            ),
        ]);
    }
}
```

当客户端发起普通 Inertia 导航请求时，`categories`、`popularTags`、`archives` 这三个惰性 Props **不会被计算**，节省了数据库查询时间。只有当客户端发起的请求中包含 `X-Inertia-Partial-Data: categories,popularTags` 头时，对应的惰性 Props 才会被求值并返回。这就是 Inertia 实现"按需加载"的核心机制。

### 1.4 File Uploads：优雅的文件上传处理

文件上传是 Web 应用中最常见的需求之一，也是最容易出问题的环节。传统的 SPA 模式下，你需要手动构建 FormData 对象、配置 Axios 的 multipart 请求头、处理上传进度回调、解析服务端验证错误……Inertia.js 的 `useForm` 表单助手将这些繁琐的工作封装成了简洁的 API。

#### 服务端：Laravel 控制器处理文件上传

```php
class ProfileController extends Controller
{
    /**
     * 更新用户个人资料（包含头像和简历上传）
     */
    public function update(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email,' . $request->user()->id,
            'phone' => 'nullable|string|max:20',
            'bio' => 'nullable|string|max:1000',
            'avatar' => 'nullable|image|max:2048|mimes:jpg,jpeg,png,webp,gif',
            'resume' => 'nullable|file|max:5120|mimes:pdf,doc,docx',
            'portfolio_images' => 'nullable|array|max:10',
            'portfolio_images.*' => 'image|max:4096|mimes:jpg,png,webp',
        ]);

        $user = $request->user();

        // 处理头像上传
        if ($request->hasFile('avatar')) {
            // 删除旧头像
            if ($user->avatar_path) {
                Storage::disk('public')->delete($user->avatar_path);
            }
            $validated['avatar_path'] = $request->file('avatar')
                ->store('avatars/' . $user->id, 'public');
        }

        // 处理简历上传
        if ($request->hasFile('resume')) {
            if ($user->resume_path) {
                Storage::disk('public')->delete($user->resume_path);
            }
            $validated['resume_path'] = $request->file('resume')
                ->store('resumes/' . $user->id, 'public');
        }

        // 处理多图片上传
        if ($request->hasFile('portfolio_images')) {
            foreach ($request->file('portfolio_images') as $image) {
                $path = $image->store('portfolio/' . $user->id, 'public');
                $user->portfolioImages()->create(['path' => $path]);
            }
        }

        $user->update(collect($validated)->except([
            'avatar', 'resume', 'portfolio_images'
        ])->toArray());

        return redirect()->route('profile.edit')
            ->with('success', '个人资料更新成功！');
    }
}
```

#### 前端：Vue 3 文件上传组件（带进度条和预览）

```vue
<script setup lang="ts">
import { useForm, router } from '@inertiajs/vue3'
import { ref, computed, watch } from 'vue'

interface Props {
    user: {
        id: number
        name: string
        email: string
        phone: string
        bio: string
        avatar_url: string
        resume_url: string | null
        portfolio: { id: number; url: string }[]
    }
}

const props = defineProps<Props>()

// 表单状态
const form = useForm({
    name: props.user.name,
    email: props.user.email,
    phone: props.user.phone || '',
    bio: props.user.bio || '',
    avatar: null as File | null,
    resume: null as File | null,
    portfolio_images: [] as File[],
})

// 预览状态
const avatarPreview = ref<string | null>(props.user.avatar_url)
const resumeFileName = ref<string | null>(null)
const imagePreviews = ref<string[]>([])

// 计算属性：是否有未保存的修改
const hasChanges = computed(() => form.isDirty || form.avatar || form.resume || form.portfolio_images.length > 0)

// 处理头像选择
const handleAvatarChange = (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
        form.avatar = file
        // 生成本地预览 URL
        avatarPreview.value = URL.createObjectURL(file)
    }
}

// 处理简历选择
const handleResumeChange = (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
        form.resume = file
        resumeFileName.value = file.name
    }
}

// 处理多图片选择
const handleImagesChange = (event: Event) => {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files || [])
    form.portfolio_images = files
    // 释放旧的预览 URL
    imagePreviews.value.forEach(url => URL.revokeObjectURL(url))
    imagePreviews.value = files.map(file => URL.createObjectURL(file))
}

// 移除已选图片
const removeImage = (index: number) => {
    URL.revokeObjectURL(imagePreviews.value[index])
    form.portfolio_images = form.portfolio_images.filter((_, i) => i !== index)
    imagePreviews.value = imagePreviews.value.filter((_, i) => i !== index)
}

// 提交表单
const submit = () => {
    form.post('/profile', {
        forceFormData: true,  // 强制使用 FormData 格式（文件上传必须）
        onProgress: (progress) => {
            // 上传进度回调
            if (progress?.percentage) {
                console.log(`上传进度: ${progress.percentage}%`)
            }
        },
        onSuccess: () => {
            // 清理预览 URL
            if (avatarPreview.value && avatarPreview.value.startsWith('blob:')) {
                URL.revokeObjectURL(avatarPreview.value)
            }
            imagePreviews.value.forEach(url => URL.revokeObjectURL(url))
            imagePreviews.value = []
            form.reset('avatar', 'resume', 'portfolio_images')
        },
        onError: (errors) => {
            console.error('验证错误:', errors)
        },
    })
}

// 页面离开前确认
watch(hasChanges, (val) => {
    if (val) {
        window.onbeforeunload = () => '您有未保存的修改，确定要离开吗？'
    } else {
        window.onbeforeunload = null
    }
})
</script>

<template>
    <div class="profile-edit">
        <h2>编辑个人资料</h2>

        <form @submit.prevent="submit" class="profile-form">
            <!-- 头像区域 -->
            <div class="avatar-section">
                <div class="avatar-preview-container">
                    <img
                        :src="avatarPreview"
                        class="avatar-preview"
                        alt="头像预览"
                    />
                    <label class="avatar-upload-btn">
                        <input
                            type="file"
                            accept="image/*"
                            @change="handleAvatarChange"
                            class="hidden"
                        />
                        📷 更换头像
                    </label>
                </div>
                <span v-if="form.errors.avatar" class="field-error">
                    {{ form.errors.avatar }}
                </span>
            </div>

            <!-- 基本信息 -->
            <div class="form-grid">
                <div class="field">
                    <label for="name">姓名 <span class="required">*</span></label>
                    <input
                        id="name"
                        v-model="form.name"
                        type="text"
                        :class="{ 'error': form.errors.name }"
                    />
                    <span v-if="form.errors.name" class="field-error">
                        {{ form.errors.name }}
                    </span>
                </div>

                <div class="field">
                    <label for="email">邮箱 <span class="required">*</span></label>
                    <input
                        id="email"
                        v-model="form.email"
                        type="email"
                        :class="{ 'error': form.errors.email }"
                    />
                    <span v-if="form.errors.email" class="field-error">
                        {{ form.errors.email }}
                    </span>
                </div>

                <div class="field">
                    <label for="phone">手机号</label>
                    <input
                        id="phone"
                        v-model="form.phone"
                        type="tel"
                    />
                </div>
            </div>

            <div class="field">
                <label for="bio">个人简介</label>
                <textarea
                    id="bio"
                    v-model="form.bio"
                    rows="4"
                    maxlength="1000"
                    placeholder="介绍一下自己..."
                ></textarea>
                <span class="char-count">{{ form.bio.length }} / 1000</span>
            </div>

            <!-- 简历上传 -->
            <div class="field">
                <label>个人简历</label>
                <div class="file-upload-area">
                    <label class="file-upload-btn">
                        <input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            @change="handleResumeChange"
                            class="hidden"
                        />
                        📄 选择文件
                    </label>
                    <span v-if="resumeFileName" class="file-name">
                        {{ resumeFileName }}
                    </span>
                    <span v-else-if="user.resume_url" class="file-name">
                        <a :href="user.resume_url" target="_blank">查看当前简历</a>
                    </span>
                    <span v-else class="file-hint">支持 PDF、DOC、DOCX 格式，最大 5MB</span>
                </div>
                <span v-if="form.errors.resume" class="field-error">
                    {{ form.errors.resume }}
                </span>
            </div>

            <!-- 作品集多图片上传 -->
            <div class="field">
                <label>作品集图片</label>
                <div class="portfolio-upload">
                    <label class="file-upload-btn">
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            @change="handleImagesChange"
                            class="hidden"
                        />
                        🖼️ 选择图片（最多 10 张）
                    </label>

                    <!-- 图片预览网格 -->
                    <div v-if="imagePreviews.length > 0" class="image-preview-grid">
                        <div
                            v-for="(preview, index) in imagePreviews"
                            :key="index"
                            class="image-preview-item"
                        >
                            <img :src="preview" alt="预览" />
                            <button
                                type="button"
                                @click="removeImage(index)"
                                class="remove-btn"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                </div>
                <span v-if="form.errors.portfolio_images" class="field-error">
                    {{ form.errors.portfolio_images }}
                </span>
            </div>

            <!-- 上传进度条 -->
            <div v-if="form.progress" class="progress-container">
                <div class="progress-bar">
                    <div
                        class="progress-fill"
                        :style="{ width: form.progress.percentage + '%' }"
                    ></div>
                </div>
                <span class="progress-text">{{ form.progress.percentage }}%</span>
            </div>

            <!-- 提交按钮 -->
            <div class="form-actions">
                <button
                    type="button"
                    @click="form.reset()"
                    :disabled="!hasChanges || form.processing"
                    class="btn-secondary"
                >
                    重置修改
                </button>
                <button
                    type="submit"
                    :disabled="!hasChanges || form.processing"
                    class="btn-primary"
                >
                    <span v-if="form.processing" class="spinner"></span>
                    {{ form.processing ? '保存中...' : '保存资料' }}
                </button>
            </div>
        </form>
    </div>
</template>
```

### 1.5 Form Helper 深度探索

Inertia 的 `useForm` 不仅仅是文件上传的利器，它是一个完整的**表单状态管理器**。它封装了表单开发中所有常见的状态和行为：

```vue
<script setup lang="ts">
import { useForm } from '@inertiajs/vue3'
import { watch } from 'vue'

const form = useForm({
    title: '',
    body: '',
    category_id: null as number | null,
    is_published: false,
    tags: [] as string[],
    publish_at: '' as string,
})

// ========== 状态属性 ==========
console.log(form.data())          // 获取所有表单数据
console.log(form.isDirty)         // 表单是否被修改过
console.log(form.processing)      // 是否正在提交中
console.log(form.progress)        // 上传进度对象 { percentage: 75 }
console.log(form.errors)          // 验证错误对象 { title: '标题不能为空' }
console.log(form.hasErrors)       // 是否有验证错误
console.log(form.wasSuccessful)   // 提交是否成功
console.log(form.recentlySuccessful) // 刚刚提交成功（用于显示成功动画，3秒后自动重置）

// ========== 提交方法 ==========
form.post('/posts', {
    preserveScroll: true,         // 提交后保持滚动位置
    preserveState: true,          // 保持组件状态
    resetOnSuccess: true,         // 成功后自动重置表单
    onSuccess: (page) => {
        console.log('提交成功', page.props.flash)
    },
    onError: (errors) => {
        console.log('验证失败', errors)
        // 自动滚动到第一个错误字段
        const firstError = Object.keys(errors)[0]
        document.getElementById(firstError)?.scrollIntoView({ behavior: 'smooth' })
    },
    onFinish: () => {
        console.log('请求完成（无论成功或失败）')
    },
})

// PUT 请求
form.put(`/posts/${postId}`, {
    preserveScroll: true,
})

// PATCH 请求
form.patch(`/posts/${postId}`)

// ========== 重置方法 ==========
form.reset()                    // 重置所有字段到初始值
form.reset('title', 'body')    // 只重置指定字段
form.defaults()                 // 将当前值设为新的默认值

// ========== 错误处理 ==========
form.clearErrors()              // 清除所有错误
form.clearErrors('title')       // 清除指定字段的错误
form.setError('title', '自定义错误消息')  // 手动设置错误

// ========== 监听表单变化 ==========
watch(
    () => form.isDirty,
    (isDirty) => {
        if (isDirty) {
            // 表单有修改时，提示用户不要意外离开
            window.addEventListener('beforeunload', handleBeforeUnload)
        } else {
            window.removeEventListener('beforeunload', handleBeforeUnload)
        }
    }
)

function handleBeforeUnload(e: BeforeUnloadEvent) {
    e.preventDefault()
    e.returnValue = ''
}
</script>
```

### 1.6 事件系统与请求生命周期

Inertia.js 提供了丰富的事件系统，让你可以在请求的各个阶段插入自定义逻辑。这对于实现全局加载指示器、错误处理、分析埋点等功能非常有用。

```typescript
import { router } from '@inertiajs/vue3'

// ========== 全局事件监听 ==========

// 请求开始 — 适合显示全局加载条
router.on('start', (event) => {
    const visit = event.detail.visit
    console.log(`开始导航: ${visit.url.pathname}`)
    // 显示顶部加载条（如 NProgress）
    NProgress.start()
})

// 请求进行中 — 适合更新进度条
router.on('progress', (event) => {
    const progress = event.detail.progress
    if (progress?.percentage) {
        NProgress.set(progress.percentage / 100)
    }
})

// 请求完成 — 无论成功或失败
router.on('finish', (event) => {
    NProgress.done()
    console.log('请求完成')
})

// 请求成功 — 返回了有效的 Inertia 响应
router.on('success', (event) => {
    const page = event.detail.page
    console.log(`页面渲染: ${page.component}`)

    // 清除全局错误状态
    store.clearGlobalErrors()
})

// 请求出错 — 服务端返回了验证错误
router.on('error', (event) => {
    const errors = event.detail.errors
    console.error('请求错误:', errors)

    // 统计验证错误数量
    analytics.track('form_error', {
        error_count: Object.keys(errors).length,
        error_fields: Object.keys(errors),
    })
})

// 无效响应 — 服务端返回了非 Inertia 格式的响应
router.on('invalid', (event) => {
    const response = event.detail.response
    console.warn('收到非 Inertia 响应:', response.status, response.url)

    // 可能是认证过期，跳转到登录页
    if (response.status === 401 || response.status === 419) {
        router.visit('/login')
    }
})

// 页面导航完成 — 新组件已渲染
router.on('navigate', (event) => {
    const page = event.detail.page
    console.log(`导航完成: ${page.component}`)

    // 更新页面标题
    document.title = page.props.title || 'My App'

    // 通知分析工具
    analytics.page(page.component, page.url)
})
```

---

## 第二章：传统 SPA 前后端分离 vs Inertia.js 全栈模式深度对比

### 2.1 架构模式对比

#### 传统 SPA 前后端分离架构

在传统的前后端分离模式中，系统由两个独立的应用组成：

**后端（API Server）**：负责数据存储、业务逻辑和 API 接口。使用 Laravel 构建 RESTful API，通过 JSON 格式传输数据。需要配置 CORS 策略、API 认证（JWT 或 Sanctum Token）、请求限流等。

**前端（SPA Client）**：负责页面渲染、用户交互和路由管理。使用 Vue 3 或 React 构建单页应用，通过 Axios 等 HTTP 客户端调用后端 API。需要配置 Vue Router/React Router、Pinia/Redux 状态管理、请求拦截器等。

这种架构下，前后端是两个独立的应用，通常放在不同的代码仓库中，由不同的团队维护，使用不同的部署流程。前端应用构建后的静态文件通常部署到 CDN 或独立的静态文件服务器上，后端 API 则部署到应用服务器上，通过 Nginx 反向代理或 API Gateway 统一入口。

这种模式的优点是：前后端完全解耦，可以独立开发和部署；API 可以被 Web、Mobile、Desktop 等多个客户端复用；团队可以按照前端/后端分工并行工作。

但缺点也很明显：项目复杂度翻倍（两个仓库、两套构建流程、两套部署方案）；需要处理跨域、认证状态同步、数据格式转换等额外问题；中小型团队的维护成本高。

#### Inertia.js 全栈架构

Inertia.js 采用的是完全不同的架构理念。它将前后端**融合在同一个 Laravel 应用**中，前端 Vue/React 组件作为 Laravel 应用的一部分，与后端控制器、路由、中间件等紧密集成。

在这种架构下，你只需要一个代码仓库、一个构建流程、一个部署方案。前端组件通过 Inertia 协议从后端获取数据，不需要独立的 API 层。认证状态通过 Laravel 的 Session 机制管理，无需 Token。路由完全由 Laravel 管理，前端不需要配置独立的路由系统。

这种模式的代价是：前端与 Laravel 框架强绑定，不能被其他后端框架或客户端复用；不适合需要提供公共 API 的场景；对于纯前端开发者来说，需要了解一些 Laravel 的概念。

### 2.2 开发体验全面对比

#### 项目初始化

传统 SPA 模式需要分别初始化后端和前端两个项目，配置代理、CORS、环境变量等。而 Inertia.js 只需要一条命令就能完成所有配置：

```bash
# 传统 SPA：需要两步
# 步骤一：初始化后端
composer create-project laravel/laravel backend
cd backend && php artisan install:api

# 步骤二：初始化前端（单独的仓库或目录）
npm create vue@latest frontend
cd frontend
npm install axios vue-router pinia
# 还需要配置 Vite 代理、CORS 等...

# Inertia.js：一步到位
composer create-project laravel/laravel my-app
cd my-app
php artisan breeze install vue --typescript
npm install && npm run dev  # 就绪！
```

#### 新增页面的工作流程

假设我们要创建一个用户列表页面，带搜索、分页功能：

**传统 SPA 模式**需要以下步骤：

1. 后端：创建 API 路由 `routes/api.php`
2. 后端：创建 `UserController` 控制器
3. 后端：创建 `UserResource` API 资源类（定义 JSON 响应格式）
4. 后端：编写验证规则
5. 前端：创建 `types/user.ts` TypeScript 类型定义
6. 前端：创建 `api/users.ts` API 调用封装
7. 前端：创建 `views/Users/Index.vue` 页面组件
8. 前端：配置 Vue Router 路由
9. 前端：编写搜索逻辑、分页逻辑、加载状态管理
10. 前端：处理错误和边界情况

**Inertia.js 模式**只需要以下步骤：

1. 后端：创建路由 `routes/web.php`
2. 后端：创建 `UserController`，返回 `Inertia::render()` 响应
3. 前端：创建 `Pages/Users/Index.vue` 组件，直接使用 props

步骤减少了 **70%**，代码量减少了 **40-50%**。

#### 表单提交对比

**传统 SPA 模式**的表单提交流程：

```typescript
// 前端：手动管理所有表单状态
const form = reactive({
    name: '',
    email: '',
    errors: {} as Record<string, string>,
    processing: false,
    progress: 0,
})

const submit = async () => {
    form.processing = true
    form.errors = {}

    try {
        const response = await axios.post('/api/users', {
            name: form.name,
            email: form.email,
        }, {
            headers: { 'Content-Type': 'application/json' },
            onUploadProgress: (e) => {
                form.progress = Math.round((e.loaded * 100) / (e.total || 1))
            },
        })

        // 成功处理
        router.push('/users')
        toast.success('创建成功！')

    } catch (error) {
        if (error.response?.status === 422) {
            // 验证错误
            form.errors = error.response.data.errors
        } else if (error.response?.status === 401) {
            // 认证过期
            router.push('/login')
        } else {
            // 其他错误
            toast.error('操作失败，请稍后重试')
        }
    } finally {
        form.processing = false
    }
}
```

**Inertia.js 模式**的表单提交流程：

```vue
<script setup lang="ts">
import { useForm } from '@inertiajs/vue3'

const form = useForm({
    name: '',
    email: '',
})

const submit = () => {
    form.post('/users', {
        onSuccess: () => {
            // Inertia 自动处理重定向、闪存消息等
        },
    })
}
</script>
```

Inertia 的 `useForm` 自动处理了：表单状态管理、验证错误解析和映射、CSRF Token 传递、文件上传的 multipart 格式、上传进度跟踪、认证过期重定向、请求去重（防重复提交）。

### 2.3 认证机制对比

认证是传统 SPA 模式中最容易出问题的环节之一。

**传统 SPA 的认证流程**：

1. 用户提交登录表单 → 前端发送 POST 请求到 `/api/login`
2. 后端验证凭据 → 生成 JWT Token 或 Session Token → 返回给前端
3. 前端存储 Token（localStorage 或 Cookie）→ 附加到后续每个请求的 Header 中
4. 每次 API 请求都需要验证 Token → Token 过期需要刷新
5. 前端需要实现路由守卫 → 未认证时重定向到登录页
6. 需要处理 Token 刷新竞态条件 → 多个并发请求同时刷新 Token

这个流程涉及前端和后端的大量配合代码，且容易出现安全漏洞。

**Inertia.js 的认证流程**：

1. 用户提交登录表单 → `Auth::attempt()` 验证凭据
2. Laravel Session 自动管理认证状态 → 重定向到目标页面
3. 后续请求自动携带 Session Cookie → `$request->user()` 即可获取当前用户
4. 无需 Token 管理、无需路由守卫、无需刷新逻辑

Inertia 模式下的认证就是标准的 Laravel 认证，零额外代码。

### 2.4 部署复杂度对比

**传统 SPA 部署**需要管理以下组件：

- 后端应用服务器（PHP-FPM + Nginx）
- 前端静态文件（CDN 或 Nginx 静态托管）
- 反向代理配置（将 API 和前端路由分流）
- CORS 配置（允许前端域名访问 API）
- SSL 证书（可能需要多个域名或通配符证书）
- 两个 CI/CD Pipeline（前端和后端分别构建和部署）

**Inertia.js 部署**只需要：

- 一个 Laravel 应用服务器
- 标准的 Laravel 部署流程（与 Blade 模板应用完全相同）
- 一个 CI/CD Pipeline

部署流程与传统的 Laravel 应用无异：

```bash
# 构建前端资源
npm run build

# 部署 Laravel 应用
composer install --optimize-autoloader --no-dev
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan migrate --force
```

### 2.5 性能特性对比

| 性能指标 | 传统 SPA | Inertia.js |
|---------|---------|------------|
| 首次加载（TTFB） | 需等待 JS Bundle 下载和执行 | 服务端直接返回 HTML，TTFB 更快 |
| 首次有意义绘制（FMP） | 需要 API 请求 + 渲染 | 数据随 HTML 一起返回，FMP 更快 |
| SPA 导航速度 | 客户端路由切换，可能需要额外 API 请求 | 客户端渲染新组件，Partial Reload 优化数据请求 |
| Bundle 大小 | 需要 vue-router、pinia、axios 等额外库 | Inertia 客户端库更小（约 8KB gzip） |
| 缓存控制 | 前端自行管理（复杂） | 版本号自动管理（简单） |
| 服务端资源消耗 | 低（只提供 JSON API） | 略高（渲染完整的 props） |
| SEO | 需要额外 SSR（Nuxt.js 等） | 首次加载天然支持基本 SEO |

### 2.6 适用场景总结

基于以上对比，我们可以总结两种模式各自最适合的场景：

**传统 SPA 前后端分离**最适合：

- 大型项目，需要前后端团队独立开发
- 需要为多种客户端（Web、Mobile、Desktop）提供统一 API
- 纯前端开发者主导的项目
- 对前端架构有特殊要求（如微前端）
- 需要对接第三方 API 或 GraphQL

**Inertia.js 全栈模式**最适合：

- 中小型项目，全栈开发者主导
- 后台管理系统、SaaS 应用、CRM、ERP
- 需要快速迭代的 MVP 产品
- 从传统 Laravel Blade 模板升级到 SPA 体验
- 不需要独立 API 的内部应用
- 小团队追求开发效率的场景

---

## 第三章：Vue 3 + TypeScript 完整实战

### 3.1 项目搭建与配置

让我们从零开始搭建一个基于 Laravel + Inertia.js + Vue 3 + TypeScript 的任务管理系统。

```bash
# 创建 Laravel 项目
composer create-project laravel/laravel task-manager
cd task-manager

# 安装 Laravel Breeze（包含完整的 Inertia + Vue 3 + TypeScript 脚手架）
composer require laravel/breeze --dev
php artisan breeze install vue --typescript

# 安装额外的开发依赖
npm install
npm install -D @types/node @types/lodash-es tailwindcss postcss autoprefixer
npx tailwindcss init -p

# 启动开发服务器
php artisan serve &   # 后端
npm run dev            # 前端（Vite 热更新）
```

### 3.2 TypeScript 类型定义

良好的类型定义是 TypeScript 项目的基础。我们需要为后端返回的数据结构定义精确的类型：

```typescript
// resources/js/types/index.d.ts

// 用户类型
export interface User {
    id: number
    name: string
    email: string
    email_verified_at: string | null
    avatar_url: string | null
    role: 'admin' | 'manager' | 'user'
    permissions: string[]
    created_at: string
    updated_at: string
}

// 任务类型
export interface Task {
    id: number
    title: string
    description: string | null
    status: 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled'
    priority: 'low' | 'medium' | 'high' | 'urgent'
    due_date: string | null
    completed_at: string | null
    estimated_hours: number | null
    actual_hours: number | null
    project: Project
    assignee: User | null
    creator: User
    tags: Tag[]
    attachments: Attachment[]
    comments_count: number
    created_at: string
    updated_at: string
}

// 项目类型
export interface Project {
    id: number
    name: string
    description: string | null
    color: string
    status: 'active' | 'archived' | 'completed'
    owner: User
    members_count: number
    tasks_count: number
    progress: number
    created_at: string
}

// 标签类型
export interface Tag {
    id: number
    name: string
    color: string
    slug: string
}

// 附件类型
export interface Attachment {
    id: number
    filename: string
    path: string
    size: number
    mime_type: string
    url: string
    created_at: string
}

// 分页数据类型
export interface PaginatedData<T> {
    data: T[]
    links: {
        url: string | null
        label: string
        active: boolean
    }[]
    meta: {
        current_page: number
        from: number | null
        last_page: number
        per_page: number
        to: number | null
        total: number
    }
}

// Inertia 页面 Props 基础类型
export interface PageProps<T extends Record<string, unknown> = Record<string, unknown>> {
    auth: {
        user: User | null
    }
    flash: {
        success: string | null
        error: string | null
        warning: string | null
    }
    errors: Record<string, string>
    app: {
        name: string
        locale: string
        timezone: string
    }
}

// Ziggy 路由函数声明
declare function route(name: string, params?: Record<string, unknown> | number | string): string
declare function route(): Record<string, string>
```

### 3.3 控制器设计模式

在 Inertia.js 中，控制器的设计模式与传统 Laravel 控制器有显著不同。我们需要在控制器中同时负责数据获取和数据转换（类似传统 MVC 中的 Presenter 模式）：

```php
<?php

namespace App\Http\Controllers;

use App\Models\Task;
use App\Models\Project;
use App\Models\Tag;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class TaskController extends Controller
{
    /**
     * 任务列表页面
     *
     * 支持：多条件筛选、全文搜索、排序、分页
     * 使用 Partial Reload 优化性能
     */
    public function index(Request $request): Response
    {
        $tasks = Task::query()
            ->with(['project:id,name,color', 'assignee:id,name,avatar_url', 'tags'])
            ->when($request->search, function ($query, $search) {
                $query->where(function ($q) use ($search) {
                    $q->where('title', 'like', "%{$search}%")
                      ->orWhere('description', 'like', "%{$search}%")
                      ->orWhereHas('project', function ($q) use ($search) {
                          $q->where('name', 'like', "%{$search}%");
                      });
                });
            })
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->when($request->priority, fn ($q, $priority) => $q->where('priority', $priority))
            ->when($request->project_id, fn ($q, $id) => $q->where('project_id', $id))
            ->when($request->assignee_id, function ($q, $id) {
                if ($id === 'unassigned') {
                    $q->whereNull('assignee_id');
                } else {
                    $q->where('assignee_id', $id);
                }
            })
            ->when($request->due_before, fn ($q, $date) =>
                $q->where('due_date', '<=', $date)
                  ->whereNot('status', 'completed')
            )
            ->when($request->sort, function ($q) use ($request) {
                $direction = $request->direction === 'desc' ? 'desc' : 'asc';
                $allowedSorts = ['title', 'status', 'priority', 'due_date', 'created_at'];

                if (in_array($request->sort, $allowedSorts)) {
                    $q->orderBy($request->sort, $direction);
                }
            }, fn ($q) => $q->latest())
            ->paginate($request->per_page ?? 15)
            ->withQueryString();

        return Inertia::render('Tasks/Index', [
            'tasks' => $tasks->through(fn ($task) => [
                'id' => $task->id,
                'title' => $task->title,
                'status' => $task->status,
                'priority' => $task->priority,
                'due_date' => $task->due_date?->format('Y-m-d'),
                'is_overdue' => $task->due_date && $task->due_date->isPast() && $task->status !== 'completed',
                'project' => [
                    'id' => $task->project->id,
                    'name' => $task->project->name,
                    'color' => $task->project->color,
                ],
                'assignee' => $task->assignee ? [
                    'id' => $task->assignee->id,
                    'name' => $task->assignee->name,
                    'avatar_url' => $task->assignee->avatar_url,
                ] : null,
                'tags' => $task->tags->map(fn ($tag) => [
                    'id' => $tag->id,
                    'name' => $tag->name,
                    'color' => $tag->color,
                ]),
                'comments_count' => $task->comments_count,
            ]),
            'filters' => $request->only([
                'search', 'status', 'priority', 'project_id',
                'assignee_id', 'due_before', 'sort', 'direction',
            ]),
            // 惰性 Props — 筛选面板展开时才加载
            'projects' => Inertia::lazy(fn () =>
                Project::select('id', 'name', 'color')
                    ->where('status', 'active')
                    ->orderBy('name')
                    ->get()
            ),
            'users' => Inertia::lazy(fn () =>
                User::select('id', 'name', 'avatar_url')
                    ->orderBy('name')
                    ->get()
            ),
            'stats' => Inertia::lazy(fn () => [
                'total' => Task::count(),
                'todo' => Task::where('status', 'todo')->count(),
                'in_progress' => Task::where('status', 'in_progress')->count(),
                'completed' => Task::where('status', 'completed')->count(),
                'overdue' => Task::where('due_date', '<', now())
                    ->whereNotIn('status', ['completed', 'cancelled'])
                    ->count(),
            ]),
        ]);
    }

    /**
     * 创建任务页面
     */
    public function create(): Response
    {
        return Inertia::render('Tasks/Create', [
            'projects' => Project::where('status', 'active')
                ->select('id', 'name', 'color')
                ->orderBy('name')
                ->get(),
            'users' => User::select('id', 'name', 'avatar_url')
                ->orderBy('name')
                ->get(),
            'tags' => Tag::select('id', 'name', 'color')
                ->orderBy('name')
                ->get(),
            'priorityOptions' => [
                ['value' => 'low', 'label' => '低', 'color' => '#6B7280'],
                ['value' => 'medium', 'label' => '中', 'color' => '#F59E0B'],
                ['value' => 'high', 'label' => '高', 'color' => '#F97316'],
                ['value' => 'urgent', 'label' => '紧急', 'color' => '#EF4444'],
            ],
        ]);
    }

    /**
     * 保存新任务
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255|min:2',
            'description' => 'nullable|string|max:10000',
            'project_id' => 'required|exists:projects,id',
            'assignee_id' => 'nullable|exists:users,id',
            'priority' => 'required|in:low,medium,high,urgent',
            'status' => 'required|in:todo,in_progress,review,completed',
            'due_date' => 'nullable|date|after_or_equal:today',
            'estimated_hours' => 'nullable|numeric|min:0.5|max:999',
            'tags' => 'nullable|array',
            'tags.*' => 'exists:tags,id',
            'attachments' => 'nullable|array|max:10',
            'attachments.*' => 'file|max:10240|mimes:pdf,jpg,jpeg,png,doc,docx,xls,xlsx,zip',
        ]);

        DB::transaction(function () use ($validated, $request) {
            $task = Task::create(collect($validated)
                ->except(['tags', 'attachments'])
                ->toArray()
            );

            // 同步标签
            if (!empty($validated['tags'])) {
                $task->tags()->sync($validated['tags']);
            }

            // 处理附件上传
            if ($request->hasFile('attachments')) {
                foreach ($request->file('attachments') as $file) {
                    $path = $file->store("tasks/{$task->id}/attachments", 'public');
                    $task->attachments()->create([
                        'filename' => $file->getClientOriginalName(),
                        'path' => $path,
                        'size' => $file->getSize(),
                        'mime_type' => $file->getMimeType(),
                    ]);
                }
            }

            // 记录活动日志
            activity()
                ->performedOn($task)
                ->causedBy($request->user())
                ->withProperties(['title' => $task->title])
                ->log('task_created');
        });

        return redirect()->route('tasks.show', $task)
            ->with('success', '任务创建成功！');
    }

    /**
     * 批量操作
     */
    public function bulkAction(Request $request)
    {
        $validated = $request->validate([
            'action' => 'required|in:delete,change_status,change_priority,assign',
            'task_ids' => 'required|array|min:1|max:100',
            'task_ids.*' => 'exists:tasks,id',
            'value' => 'required_if:action,change_status,change_priority,assign',
        ]);

        $query = Task::whereIn('id', $validated['task_ids']);

        switch ($validated['action']) {
            case 'delete':
                $count = $query->count();
                $query->delete();
                return back()->with('success', "已删除 {$count} 个任务。");

            case 'change_status':
                $query->update(['status' => $validated['value']]);
                if ($validated['value'] === 'completed') {
                    $query->update(['completed_at' => now()]);
                }
                return back()->with('success', '状态更新成功！');

            case 'change_priority':
                $query->update(['priority' => $validated['value']]);
                return back()->with('success', '优先级更新成功！');

            case 'assign':
                $query->update(['assignee_id' => $validated['value']]);
                return back()->with('success', '指派成功！');
        }

        return back()->with('error', '未知操作。');
    }
}
```

### 3.4 Vue 3 组件实战：完整的任务列表页面

```vue
<!-- resources/js/Pages/Tasks/Index.vue -->
<script setup lang="ts">
import AppLayout from '@/layouts/AppLayout.vue'
import TaskCard from '@/components/TaskCard.vue'
import Pagination from '@/components/Pagination.vue'
import BulkActions from '@/components/BulkActions.vue'
import StatsBar from '@/components/StatsBar.vue'
import { Head, router, usePage, Link } from '@inertiajs/vue3'
import { ref, computed, watch, onMounted } from 'vue'
import debounce from 'lodash/debounce'

// 类型定义
interface TaskItem {
    id: number
    title: string
    status: string
    priority: string
    due_date: string | null
    is_overdue: boolean
    project: { id: number; name: string; color: string }
    assignee: { id: number; name: string; avatar_url: string } | null
    tags: { id: number; name: string; color: string }[]
    comments_count: number
}

interface ProjectOption { id: number; name: string; color: string }
interface UserOption { id: number; name: string; avatar_url: string }
interface Filters {
    search?: string
    status?: string
    priority?: string
    project_id?: string
    assignee_id?: string
    sort?: string
    direction?: string
}

const props = defineProps<{
    tasks: PaginatedData<TaskItem>
    filters: Filters
    projects?: ProjectOption[]
    users?: UserOption[]
    stats?: {
        total: number
        todo: number
        in_progress: number
        completed: number
        overdue: number
    }
}>()

const page = usePage()
const search = ref(props.filters.search || '')
const selectedTasks = ref<number[]>([])
const showFilters = ref(false)
const viewMode = ref<'table' | 'grid'>('table')

// 搜索（防抖 300ms）
const doSearch = debounce((value: string) => {
    router.get(route('tasks.index'), {
        ...props.filters,
        search: value || undefined,
    }, {
        preserveState: true,
        replace: true,
    })
}, 300)

watch(search, (val) => doSearch(val))

// 更新筛选条件
const updateFilter = (key: keyof Filters, value: string | undefined) => {
    const filters = { ...props.filters, [key]: value }
    // 切换筛选时重置到第一页
    router.get(route('tasks.index'), filters, {
        preserveState: true,
        replace: true,
    })
}

// 清除所有筛选
const clearFilters = () => {
    search.value = ''
    router.get(route('tasks.index'))
}

// 加载筛选面板数据（惰性加载）
const loadFilterData = () => {
    if (!props.projects || !props.users) {
        router.reload({ only: ['projects', 'users'] })
    }
}

// 加载统计数据
const loadStats = () => {
    router.reload({ only: ['stats'] })
}

// 全选/取消全选
const allSelected = computed(() =>
    props.tasks.data.length > 0 &&
    selectedTasks.value.length === props.tasks.data.length
)

const toggleAll = () => {
    selectedTasks.value = allSelected.value
        ? []
        : props.tasks.data.map(t => t.id)
}

// 批量操作
const handleBulkAction = (action: string, value?: string) => {
    if (selectedTasks.value.length === 0) return

    const confirmActions = ['delete']
    if (confirmActions.includes(action)) {
        if (!confirm(`确定要${action === 'delete' ? '删除' : '执行此操作'}选中的 ${selectedTasks.value.length} 个任务吗？`)) {
            return
        }
    }

    router.post(route('tasks.bulk'), {
        action,
        task_ids: selectedTasks.value,
        value,
    }, {
        preserveState: true,
        onSuccess: () => {
            selectedTasks.value = []
        },
    })
}

// 删除单个任务
const deleteTask = (id: number) => {
    if (confirm('确定要删除这个任务吗？此操作不可恢复。')) {
        router.delete(route('tasks.destroy', id))
    }
}

// 切换排序
const toggleSort = (column: string) => {
    const direction = props.filters.sort === column && props.filters.direction !== 'desc'
        ? 'desc'
        : 'asc'
    updateFilter('sort', column)
    updateFilter('direction', direction)
}

// 计算是否有活跃筛选
const hasActiveFilters = computed(() => {
    const { search: s, sort, direction, ...rest } = props.filters
    return Object.values(rest).some(v => v !== undefined && v !== '')
})

// 组件挂载时
onMounted(() => {
    // 如果 URL 中有筛选参数，展开筛选面板
    if (hasActiveFilters.value) {
        showFilters.value = true
        loadFilterData()
    }
})
</script>

<template>
    <Head title="任务管理" />

    <AppLayout>
        <template #header>
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-2xl font-bold text-gray-900">任务管理</h2>
                    <p class="text-sm text-gray-500 mt-1">
                        管理和跟踪所有项目任务
                    </p>
                </div>
                <Link
                    :href="route('tasks.create')"
                    class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                    新建任务
                </Link>
            </div>
        </template>

        <div class="py-8">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <!-- 统计栏 -->
                <StatsBar
                    v-if="stats"
                    :stats="stats"
                    @refresh="loadStats"
                    class="mb-6"
                />

                <!-- 搜索和工具栏 -->
                <div class="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
                    <div class="p-4">
                        <div class="flex items-center gap-4">
                            <!-- 搜索框 -->
                            <div class="flex-1 relative">
                                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <input
                                    v-model="search"
                                    type="text"
                                    placeholder="搜索任务标题、描述、项目..."
                                    class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>

                            <!-- 筛选按钮 -->
                            <button
                                @click="showFilters = !showFilters; if (showFilters) loadFilterData()"
                                class="inline-flex items-center px-4 py-2.5 border rounded-lg transition"
                                :class="hasActiveFilters
                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'"
                            >
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                </svg>
                                筛选
                                <span v-if="hasActiveFilters" class="ml-2 w-2 h-2 bg-indigo-500 rounded-full"></span>
                            </button>

                            <!-- 视图切换 -->
                            <div class="flex border border-gray-300 rounded-lg overflow-hidden">
                                <button
                                    @click="viewMode = 'table'"
                                    class="px-3 py-2.5 transition"
                                    :class="viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                                    </svg>
                                </button>
                                <button
                                    @click="viewMode = 'grid'"
                                    class="px-3 py-2.5 transition"
                                    :class="viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- 筛选面板 -->
                        <Transition name="slide-down">
                            <div v-if="showFilters" class="mt-4 pt-4 border-t border-gray-200">
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <!-- 状态筛选 -->
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">状态</label>
                                        <select
                                            :value="filters.status || ''"
                                            @change="updateFilter('status', ($event.target as HTMLSelectElement).value || undefined)"
                                            class="w-full border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="">全部状态</option>
                                            <option value="todo">📋 待办</option>
                                            <option value="in_progress">🔄 进行中</option>
                                            <option value="review">👀 审核中</option>
                                            <option value="completed">✅ 已完成</option>
                                            <option value="cancelled">❌ 已取消</option>
                                        </select>
                                    </div>

                                    <!-- 优先级筛选 -->
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-1">优先级</label>
                                        <select
                                            :value="filters.priority || ''"
                                            @change="updateFilter('priority', ($event.target as HTMLSelectElement).value || undefined)"
                                            class="w-full border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="">全部优先级</option>
                                            <option value="low">低</option>
                                            <option value="medium">中</option>
                                            <option value="high">高</option>
                                            <option value="urgent">紧急</option>
                                        </select>
                                    </div>

                                    <!-- 项目筛选 -->
                                    <div v-if="projects">
                                        <label class="block text-sm font-medium text-gray-700 mb-1">项目</label>
                                        <select
                                            :value="filters.project_id || ''"
                                            @change="updateFilter('project_id', ($event.target as HTMLSelectElement).value || undefined)"
                                            class="w-full border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="">全部项目</option>
                                            <option v-for="p in projects" :key="p.id" :value="p.id">
                                                {{ p.name }}
                                            </option>
                                        </select>
                                    </div>

                                    <!-- 负责人筛选 -->
                                    <div v-if="users">
                                        <label class="block text-sm font-medium text-gray-700 mb-1">负责人</label>
                                        <select
                                            :value="filters.assignee_id || ''"
                                            @change="updateFilter('assignee_id', ($event.target as HTMLSelectElement).value || undefined)"
                                            class="w-full border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="">全部人员</option>
                                            <option value="unassigned">未指派</option>
                                            <option v-for="u in users" :key="u.id" :value="u.id">
                                                {{ u.name }}
                                            </option>
                                        </select>
                                    </div>
                                </div>

                                <div class="mt-3 flex justify-end">
                                    <button
                                        @click="clearFilters"
                                        class="text-sm text-gray-500 hover:text-gray-700"
                                    >
                                        清除所有筛选
                                    </button>
                                </div>
                            </div>
                        </Transition>
                    </div>
                </div>

                <!-- 批量操作栏 -->
                <Transition name="fade">
                    <BulkActions
                        v-if="selectedTasks.length > 0"
                        :count="selectedTasks.length"
                        @action="handleBulkAction"
                        class="mb-4"
                    />
                </Transition>

                <!-- 表格视图 -->
                <div v-if="viewMode === 'table'" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-3 w-12">
                                    <input
                                        type="checkbox"
                                        :checked="allSelected"
                                        @change="toggleAll"
                                        class="rounded border-gray-300"
                                    />
                                </th>
                                <th
                                    class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none"
                                    @click="toggleSort('title')"
                                >
                                    <div class="flex items-center gap-1">
                                        任务名称
                                        <span v-if="filters.sort === 'title'" class="text-indigo-600">
                                            {{ filters.direction === 'desc' ? '↓' : '↑' }}
                                        </span>
                                    </div>
                                </th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">优先级</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">项目</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">负责人</th>
                                <th
                                    class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none"
                                    @click="toggleSort('due_date')"
                                >
                                    <div class="flex items-center gap-1">
                                        截止日期
                                        <span v-if="filters.sort === 'due_date'" class="text-indigo-600">
                                            {{ filters.direction === 'desc' ? '↓' : '↑' }}
                                        </span>
                                    </div>
                                </th>
                                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                            <tr
                                v-for="task in tasks.data"
                                :key="task.id"
                                class="hover:bg-gray-50 transition"
                                :class="{ 'bg-indigo-50': selectedTasks.includes(task.id) }"
                            >
                                <td class="px-4 py-3">
                                    <input
                                        type="checkbox"
                                        :value="task.id"
                                        v-model="selectedTasks"
                                        class="rounded border-gray-300"
                                    />
                                </td>
                                <td class="px-4 py-3">
                                    <div>
                                        <Link
                                            :href="route('tasks.show', task.id)"
                                            class="text-gray-900 font-medium hover:text-indigo-600 transition"
                                        >
                                            {{ task.title }}
                                        </Link>
                                        <div v-if="task.tags.length > 0" class="flex flex-wrap gap-1 mt-1">
                                            <span
                                                v-for="tag in task.tags"
                                                :key="tag.id"
                                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                                                :style="{
                                                    backgroundColor: tag.color + '15',
                                                    color: tag.color,
                                                    borderColor: tag.color + '30',
                                                }"
                                            >
                                                {{ tag.name }}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td class="px-4 py-3">
                                    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                                        :class="{
                                            'bg-gray-100 text-gray-700': task.status === 'todo',
                                            'bg-blue-100 text-blue-700': task.status === 'in_progress',
                                            'bg-yellow-100 text-yellow-700': task.status === 'review',
                                            'bg-green-100 text-green-700': task.status === 'completed',
                                            'bg-red-100 text-red-700': task.status === 'cancelled',
                                        }"
                                    >
                                        {{ {todo:'待办',in_progress:'进行中',review:'审核中',completed:'已完成',cancelled:'已取消'}[task.status] }}
                                    </span>
                                </td>
                                <td class="px-4 py-3">
                                    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                                        :class="{
                                            'bg-gray-100 text-gray-600': task.priority === 'low',
                                            'bg-yellow-100 text-yellow-700': task.priority === 'medium',
                                            'bg-orange-100 text-orange-700': task.priority === 'high',
                                            'bg-red-100 text-red-700': task.priority === 'urgent',
                                        }"
                                    >
                                        {{ {low:'低',medium:'中',high:'高',urgent:'紧急'}[task.priority] }}
                                    </span>
                                </td>
                                <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                        <span
                                            class="w-3 h-3 rounded-full"
                                            :style="{ backgroundColor: task.project.color }"
                                        ></span>
                                        <span class="text-sm text-gray-700">{{ task.project.name }}</span>
                                    </div>
                                </td>
                                <td class="px-4 py-3">
                                    <div v-if="task.assignee" class="flex items-center gap-2">
                                        <img
                                            :src="task.assignee.avatar_url"
                                            class="w-6 h-6 rounded-full"
                                            :alt="task.assignee.name"
                                        />
                                        <span class="text-sm text-gray-700">{{ task.assignee.name }}</span>
                                    </div>
                                    <span v-else class="text-sm text-gray-400">未指派</span>
                                </td>
                                <td class="px-4 py-3">
                                    <span v-if="task.due_date"
                                        class="text-sm"
                                        :class="{
                                            'text-red-600 font-medium': task.is_overdue,
                                            'text-gray-700': !task.is_overdue,
                                        }"
                                    >
                                        {{ new Date(task.due_date).toLocaleDateString('zh-CN') }}
                                        <span v-if="task.is_overdue" class="text-xs">（已逾期）</span>
                                    </span>
                                    <span v-else class="text-sm text-gray-400">—</span>
                                </td>
                                <td class="px-4 py-3 text-right">
                                    <div class="flex items-center justify-end gap-2">
                                        <Link
                                            :href="route('tasks.edit', task.id)"
                                            class="text-indigo-600 hover:text-indigo-900 text-sm"
                                        >
                                            编辑
                                        </Link>
                                        <button
                                            @click="deleteTask(task.id)"
                                            class="text-red-600 hover:text-red-900 text-sm"
                                        >
                                            删除
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- 空状态 -->
                    <div v-if="tasks.data.length === 0" class="p-12 text-center">
                        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <h3 class="mt-2 text-sm font-medium text-gray-900">暂无任务</h3>
                        <p class="mt-1 text-sm text-gray-500">
                            {{ hasActiveFilters ? '没有匹配的任务，试试调整筛选条件。' : '开始创建你的第一个任务吧！' }}
                        </p>
                        <div class="mt-6">
                            <Link
                                v-if="!hasActiveFilters"
                                :href="route('tasks.create')"
                                class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg"
                            >
                                新建任务
                            </Link>
                            <button
                                v-else
                                @click="clearFilters"
                                class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
                            >
                                清除筛选
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 网格视图（简化） -->
                <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <TaskCard
                        v-for="task in tasks.data"
                        :key="task.id"
                        :task="task"
                        :selected="selectedTasks.includes(task.id)"
                        @toggle-select="(id) => {
                            selectedTasks = selectedTasks.includes(id)
                                ? selectedTasks.filter(i => i !== id)
                                : [...selectedTasks, id]
                        }"
                        @delete="deleteTask"
                    />
                </div>

                <!-- 分页 -->
                <div v-if="tasks.data.length > 0" class="mt-6">
                    <Pagination :data="tasks" />
                </div>
            </div>
        </div>
    </AppLayout>
</template>
```

这个完整的任务列表页面展示了 Inertia.js + Vue 3 + TypeScript 的强大组合。整个页面不需要任何 API 调用、不需要 Axios、不需要 Pinia 状态管理、不需要 Vue Router 配置——所有数据都通过 Inertia props 直接传入组件。

---

## 第四章：React 集成完整实战

### 4.1 React + TypeScript 项目搭建

```bash
# 使用 Breeze 安装 React + TypeScript 脚手架
php artisan breeze install react --typescript

# 安装额外依赖
npm install
npm install -D @types/react @types/react-dom
```

### 4.2 React 核心配置

**应用入口文件：**

```tsx
// resources/js/app.tsx
import '../css/app.css'
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import NProgress from 'nprogress'
import { router } from '@inertiajs/react'

const appName = import.meta.env.VITE_APP_NAME || 'Task Manager'

// 全局加载进度条
router.on('start', () => NProgress.start())
router.on('finish', () => NProgress.done())

createInertiaApp({
    title: (title) => title ? `${title} - ${appName}` : appName,
    resolve: (name) =>
        resolvePageComponent(
            `./Pages/${name}.tsx`,
            import.meta.glob('./Pages/**/*.tsx')
        ),
    setup({ el, App, props }) {
        const root = createRoot(el)
        root.render(<App {...props} />)
    },
    progress: {
        color: '#6366f1',
        showSpinner: false,
    },
})
```

### 4.3 React 任务创建页面

```tsx
// resources/js/Pages/Tasks/Create.tsx
import { FormEventHandler, useState, useCallback } from 'react'
import { Head, useForm, Link } from '@inertiajs/react'
import AppLayout from '@/Layouts/AppLayout'

interface Project { id: number; name: string; color: string }
interface User { id: number; name: string; avatar_url: string }
interface Tag { id: number; name: string; color: string }
interface PriorityOption { value: string; label: string; color: string }

interface Props {
    projects: Project[]
    users: User[]
    tags: Tag[]
    priorityOptions: PriorityOption[]
}

export default function CreateTask({ projects, users, tags, priorityOptions }: Props) {
    const { data, setData, post, processing, errors, progress, reset } = useForm({
        title: '',
        description: '',
        project_id: '',
        assignee_id: '',
        priority: 'medium',
        status: 'todo',
        due_date: '',
        estimated_hours: '',
        tags: [] as number[],
        attachments: [] as File[],
    })

    const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
    const [attachmentNames, setAttachmentNames] = useState<string[]>([])

    const handleSubmit: FormEventHandler = (e) => {
        e.preventDefault()
        post(route('tasks.store'), {
            forceFormData: true,
            onSuccess: () => reset(),
            onError: (errors) => {
                // 滚动到第一个错误字段
                const firstErrorField = Object.keys(errors)[0]
                document.getElementById(firstErrorField)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                })
            },
        })
    }

    const toggleTag = useCallback((tagId: number) => {
        setSelectedTagIds(prev => {
            const newIds = prev.includes(tagId)
                ? prev.filter(id => id !== tagId)
                : [...prev, tagId]
            setData('tags', newIds)
            return newIds
        })
    }, [setData])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        setData('attachments', files)
        setAttachmentNames(files.map(f => `${f.name} (${(f.size / 1024).toFixed(1)}KB)`))
    }

    return (
        <AppLayout>
            <Head title="创建任务" />

            <div className="py-8">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* 页面标题 */}
                    <div className="mb-8">
                        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                            <Link href={route('tasks.index')} className="hover:text-gray-700">
                                任务管理
                            </Link>
                            <span>/</span>
                            <span className="text-gray-900">创建新任务</span>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900">创建新任务</h1>
                        <p className="text-gray-500 mt-1">填写任务信息，开始追踪工作进度</p>
                    </div>

                    {/* 表单 */}
                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">基本信息</h2>

                            {/* 标题 */}
                            <div className="mb-6">
                                <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1.5">
                                    任务标题 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="title"
                                    type="text"
                                    value={data.title}
                                    onChange={e => setData('title', e.target.value)}
                                    className={`w-full rounded-lg border ${
                                        errors.title ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-indigo-500'
                                    } focus:ring-2 focus:border-transparent px-4 py-2.5`}
                                    placeholder="例如：完成首页 UI 设计稿"
                                    autoFocus
                                />
                                {errors.title && (
                                    <p className="mt-1.5 text-sm text-red-600">{errors.title}</p>
                                )}
                            </div>

                            {/* 描述 */}
                            <div className="mb-6">
                                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1.5">
                                    任务描述
                                </label>
                                <textarea
                                    id="description"
                                    value={data.description}
                                    onChange={e => setData('description', e.target.value)}
                                    rows={5}
                                    className="w-full rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent px-4 py-2.5"
                                    placeholder="描述任务的详细内容、验收标准等..."
                                />
                                <p className="mt-1 text-sm text-gray-400">
                                    {(data.description || '').length} / 10000 字符
                                </p>
                            </div>

                            {/* 项目和负责人 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                <div>
                                    <label htmlFor="project_id" className="block text-sm font-medium text-gray-700 mb-1.5">
                                        所属项目 <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        id="project_id"
                                        value={data.project_id}
                                        onChange={e => setData('project_id', e.target.value)}
                                        className={`w-full rounded-lg border ${
                                            errors.project_id ? 'border-red-300' : 'border-gray-300'
                                        } focus:ring-2 focus:ring-indigo-500 focus:border-transparent px-4 py-2.5`}
                                    >
                                        <option value="">选择项目</option>
                                        {projects.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    {errors.project_id && (
                                        <p className="mt-1.5 text-sm text-red-600">{errors.project_id}</p>
                                    )}
                                </div>

                                <div>
                                    <label htmlFor="assignee_id" className="block text-sm font-medium text-gray-700 mb-1.5">
                                        负责人
                                    </label>
                                    <select
                                        id="assignee_id"
                                        value={data.assignee_id}
                                        onChange={e => setData('assignee_id', e.target.value)}
                                        className="w-full rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent px-4 py-2.5"
                                    >
                                        <option value="">未指派</option>
                                        {users.map(u => (
                                            <option key={u.id} value={u.id}>{u.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* 优先级选择 */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    优先级
                                </label>
                                <div className="flex gap-3">
                                    {priorityOptions.map(option => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setData('priority', option.value)}
                                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border-2 transition ${
                                                data.priority === option.value
                                                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                            }`}
                                        >
                                            <span
                                                className="inline-block w-3 h-3 rounded-full mr-2"
                                                style={{ backgroundColor: option.color }}
                                            />
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 截止日期和预估工时 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                <div>
                                    <label htmlFor="due_date" className="block text-sm font-medium text-gray-700 mb-1.5">
                                        截止日期
                                    </label>
                                    <input
                                        id="due_date"
                                        type="date"
                                        value={data.due_date}
                                        onChange={e => setData('due_date', e.target.value)}
                                        min={new Date().toISOString().split('T')[0]}
                                        className="w-full rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent px-4 py-2.5"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="estimated_hours" className="block text-sm font-medium text-gray-700 mb-1.5">
                                        预估工时（小时）
                                    </label>
                                    <input
                                        id="estimated_hours"
                                        type="number"
                                        value={data.estimated_hours}
                                        onChange={e => setData('estimated_hours', e.target.value)}
                                        min="0.5"
                                        max="999"
                                        step="0.5"
                                        className="w-full rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent px-4 py-2.5"
                                        placeholder="例如：8"
                                    />
                                </div>
                            </div>

                            {/* 标签选择 */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    标签
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {tags.map(tag => (
                                        <button
                                            key={tag.id}
                                            type="button"
                                            onClick={() => toggleTag(tag.id)}
                                            className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                                                selectedTagIds.includes(tag.id)
                                                    ? 'border-transparent text-white'
                                                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                            }`}
                                            style={
                                                selectedTagIds.includes(tag.id)
                                                    ? { backgroundColor: tag.color }
                                                    : {}
                                            }
                                        >
                                            {tag.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 附件上传 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    附件
                                </label>
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-indigo-400 transition">
                                    <input
                                        type="file"
                                        multiple
                                        onChange={handleFileChange}
                                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip"
                                        className="hidden"
                                        id="file-upload"
                                    />
                                    <label htmlFor="file-upload" className="cursor-pointer">
                                        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                        </svg>
                                        <p className="mt-2 text-sm text-gray-600">
                                            点击选择文件或拖放到此处
                                        </p>
                                        <p className="mt-1 text-xs text-gray-400">
                                            支持 PDF、图片、Office 文档，单个文件最大 10MB，最多 10 个
                                        </p>
                                    </label>
                                </div>
                                {attachmentNames.length > 0 && (
                                    <ul className="mt-3 space-y-1">
                                        {attachmentNames.map((name, i) => (
                                            <li key={i} className="text-sm text-gray-600 flex items-center gap-2">
                                                📎 {name}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        {/* 上传进度条 */}
                        {progress && (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                                            style={{ width: `${progress.percentage}%` }}
                                        />
                                    </div>
                                    <span className="text-sm text-gray-600">{progress.percentage}%</span>
                                </div>
                            </div>
                        )}

                        {/* 操作按钮 */}
                        <div className="flex items-center justify-between">
                            <Link
                                href={route('tasks.index')}
                                className="text-gray-600 hover:text-gray-900 transition"
                            >
                                ← 返回列表
                            </Link>
                            <div className="flex items-center gap-4">
                                <button
                                    type="button"
                                    onClick={() => reset()}
                                    className="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                                >
                                    重置
                                </button>
                                <button
                                    type="submit"
                                    disabled={processing}
                                    className="px-8 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                                >
                                    {processing && (
                                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                    )}
                                    {processing ? '创建中...' : '创建任务'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </AppLayout>
    )
}
```

---

## 第五章：SSR 服务端渲染方案

### 5.1 为什么需要 SSR

虽然 Inertia.js 在首次加载时返回的是完整的 HTML，但这个 HTML 只是包含了前端应用的**入口脚本和初始数据注入**，页面的实际内容仍然需要客户端 JavaScript 执行后才能渲染出来。对于大多数应用来说，这已经足够了。但在以下场景中，你可能需要完整的 SSR 支持：

第一，**SEO 关键页面**。如果你的产品详情页、博客文章页需要被搜索引擎完整抓取和索引，客户端渲染可能不够。虽然 Google 的爬虫能够执行 JavaScript，但执行时间是有限的，而且其他搜索引擎（如百度）对 JavaScript 渲染的支持可能更差。

第二，**社交分享场景**。当用户在微信、微博、Twitter 等平台分享你的页面链接时，这些平台会通过爬虫获取页面的 Open Graph 或 Twitter Card 元标签。如果这些元标签需要客户端 JavaScript 才能渲染，分享卡片就会显示空白或默认内容。

第三，**首屏性能敏感页面**。对于性能指标要求极高的页面，SSR 可以减少客户端 JavaScript 的执行时间，从而提升 LCP（最大内容绘制）等核心 Web 指标。

### 5.2 Vue 3 SSR 完整配置

```bash
# 安装 SSR 依赖
npm install @vue/server-renderer vue
```

**Vite 配置（同时支持 CSR 和 SSR）：**

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import laravel from 'laravel-vite-plugin'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
    plugins: [
        laravel({
            input: 'resources/js/app.ts',
            ssr: 'resources/js/ssr.ts',
            refresh: true,
        }),
        vue({
            template: {
                transformAssetUrls: {
                    base: null,
                    includeAbsolute: false,
                },
            },
        }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'resources/js'),
        },
    },
})
```

**SSR 入口文件：**

```typescript
// resources/js/ssr.ts
import { createInertiaApp } from '@inertiajs/vue3'
import createServer from '@inertiajs/vue3/server'
import { renderToString } from 'vue/server-renderer'
import { createSSRApp, h } from 'vue'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import { ZiggyVue } from 'ziggy-js'

const appName = import.meta.env.VITE_APP_NAME || 'Task Manager'

createServer((page) =>
    createInertiaApp({
        page,
        render: renderToString,
        resolve: (name) =>
            resolvePageComponent(
                `./Pages/${name}.vue`,
                import.meta.glob('./Pages/**/*.vue')
            ),
        setup({ App, props, plugin }) {
            const app = createSSRApp({ render: () => h(App, props) })
            app.use(plugin)
            app.use(ZiggyVue, {
                ...page.props.ziggy,
                location: new URL(page.props.ziggy.location),
            })
            return app
        },
        title: (title) => `${title} - ${appName}`,
    })
)
```

**构建和运行：**

```bash
# 构建 SSR Bundle
npm run build

# 启动 SSR 服务
php artisan inertia:start-ssr

# 开发环境同时运行
npm run dev                    # Vite 热更新
php artisan serve              # Laravel 开发服务器
php artisan inertia:start-ssr  # SSR 服务
```

### 5.3 React SSR 配置

```tsx
// resources/js/ssr.tsx
import { createInertiaApp } from '@inertiajs/react'
import createServer from '@inertiajs/react/server'
import ReactDOMServer from 'react-dom/server'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import { route } from 'ziggy-js'

createServer((page) =>
    createInertiaApp({
        page,
        render: ReactDOMServer.renderToString,
        resolve: (name) =>
            resolvePageComponent(
                `./Pages/${name}.tsx`,
                import.meta.glob('./Pages/**/*.tsx')
            ),
        setup({ App, props }) {
            const ziggyProps = page.props.ziggy as any
            global.route = (name: string, params?: any) =>
                route(name, params, undefined, ziggyProps)

            return <App {...props} />
        },
    })
)
```

### 5.4 SEO 元标签管理

使用 Inertia 的 `<Head>` 组件管理页面元标签：

```vue
<script setup lang="ts">
import { Head } from '@inertiajs/vue3'

const props = defineProps<{
    task: {
        title: string
        description: string
        project: { name: string }
        status: string
    }
}>()
</script>

<template>
    <Head>
        <title>{{ task.title }} - {{ task.project.name }}</title>
        <meta name="description" :content="task.description?.substring(0, 160)" />

        <!-- Open Graph -->
        <meta property="og:title" :content="task.title" />
        <meta property="og:description" :content="task.description?.substring(0, 200)" />
        <meta property="og:type" content="website" />
        <meta property="og:url" :content="route('tasks.show', task.id)" />

        <!-- Twitter Card -->
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" :content="task.title" />
        <meta name="twitter:description" :content="task.description?.substring(0, 200)" />
    </Head>

    <!-- 页面内容 -->
    <div>
        <h1>{{ task.title }}</h1>
        <p>{{ task.description }}</p>
    </div>
</template>
```

---

## 第六章：高级模式与最佳实践

### 6.1 从传统 SPA 渐进式迁移到 Inertia.js

如果你有一个现有的 Vue/React SPA + Laravel API 项目，可以按照以下策略渐进式迁移到 Inertia：

#### 阶段一：并行运行

在同一个 Laravel 应用中同时保留 API 路由和 Inertia 路由：

```php
// routes/web.php — 新的 Inertia 页面
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index']);
    Route::get('/settings', [SettingsController::class, 'index']);
    Route::resource('tasks', TaskController::class);
});

// routes/api.php — 保留现有的 API（供尚未迁移的页面和外部客户端使用）
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('users', API\UserController::class);
    Route::apiResource('posts', API\PostController::class);
    Route::apiResource('comments', API\CommentController::class);
});
```

前端 Vue/React 应用中，已迁移的页面使用 Inertia 路由，未迁移的页面继续使用原有的 API 调用。

#### 阶段二：逐步替换

按照页面的重要程度和复杂度，逐步将前端页面迁移到 Inertia 模式：

1. 从最简单的 CRUD 页面开始（如设置页面、个人资料页面）
2. 逐步迁移核心业务页面（如任务列表、项目管理）
3. 将 API Controller 的逻辑迁移到 Web Controller
4. 用 Inertia props 替代前端 Store 中的状态
5. 用 `useForm` 替代 Axios 表单提交逻辑

#### 阶段三：清理和优化

1. 移除不再需要的 API 路由和 Controller
2. 移除 CORS 中间件配置
3. 移除前端的 API 封装层和 Token 管理代码
4. 移除 Vue Router / React Router 配置
5. 移除 Pinia / Redux Store
6. 优化 Inertia props 的数据结构

### 6.2 错误处理最佳实践

```php
// app/Exceptions/Handler.php
namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Inertia\Inertia;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class Handler extends ExceptionHandler
{
    public function register(): void
    {
        // 404 页面
        $this->renderable(function (NotFoundHttpException $e, $request) {
            if ($request->header('X-Inertia')) {
                return Inertia::render('Errors/404', [
                    'message' => '抱歉，您访问的页面不存在。',
                ])->toResponse($request)->setStatusCode(404);
            }
        });

        // 403 页面
        $this->renderable(function (AccessDeniedHttpException $e, $request) {
            if ($request->header('X-Inertia')) {
                return Inertia::render('Errors/403', [
                    'message' => '抱歉，您没有权限访问此页面。',
                ])->toResponse($request)->setStatusCode(403);
            }
        });

        // 500 页面
        $this->renderable(function (\Exception $e, $request) {
            if ($request->header('X-Inertia') && app()->environment('production')) {
                return Inertia::render('Errors/500', [
                    'message' => '服务器内部错误，请稍后重试。',
                ])->toResponse($request)->setStatusCode(500);
            }
        });
    }
}
```

### 6.3 测试策略

```php
// tests/Feature/TaskControllerTest.php
namespace Tests\Feature;

use App\Models\Task;
use App\Models\User;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class TaskControllerTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    /** @test */
    public function it_can_display_tasks_index(): void
    {
        $project = Project::factory()->create();
        Task::factory(5)->create(['project_id' => $project->id]);

        $this->actingAs($this->user)
            ->get(route('tasks.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Tasks/Index')
                ->has('tasks.data', 5)
                ->has('tasks.data.0', fn (Assert $task) => $task
                    ->has('id')
                    ->has('title')
                    ->has('status')
                    ->has('priority')
                    ->has('project', fn (Assert $project) => $project
                        ->has('id')
                        ->has('name')
                        ->has('color')
                    )
                    ->has('tags')
                )
                ->has('filters')
                ->has('flash')
                ->where('auth.user.id', $this->user->id)
            );
    }

    /** @test */
    public function it_can_create_a_task(): void
    {
        $project = Project::factory()->create();

        $this->actingAs($this->user)
            ->post(route('tasks.store'), [
                'title' => '测试任务标题',
                'description' => '这是一个测试任务的描述',
                'project_id' => $project->id,
                'priority' => 'high',
                'status' => 'todo',
            ])
            ->assertRedirect()
            ->assertSessionHas('success');

        $this->assertDatabaseHas('tasks', [
            'title' => '测试任务标题',
            'priority' => 'high',
            'created_by' => $this->user->id,
        ]);
    }

    /** @test */
    public function it_validates_required_fields_on_create(): void
    {
        $this->actingAs($this->user)
            ->post(route('tasks.store'), [])
            ->assertSessionHasErrors(['title', 'project_id', 'priority', 'status']);
    }

    /** @test */
    public function it_supports_partial_reload(): void
    {
        Project::factory(3)->create();
        Task::factory(5)->create();

        // 普通请求不包含惰性数据
        $this->actingAs($this->user)
            ->get(route('tasks.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->has('tasks')
                ->missing('projects')  // 惰性数据不在普通请求中返回
                ->missing('users')
            );

        // 部分重载请求包含指定的惰性数据
        $this->actingAs($this->user)
            ->withHeaders([
                'X-Inertia' => 'true',
                'X-Inertia-Version' => '1',
                'X-Inertia-Partial-Component' => 'Tasks/Index',
                'X-Inertia-Partial-Data' => 'projects,users',
            ])
            ->get(route('tasks.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->has('projects', 3)
                ->has('users')
                ->missing('stats')  // 未请求的数据不返回
            );
    }

    /** @test */
    public function it_can_perform_bulk_actions(): void
    {
        $tasks = Task::factory(3)->create(['status' => 'todo']);

        $this->actingAs($this->user)
            ->post(route('tasks.bulk'), [
                'action' => 'change_status',
                'task_ids' => $tasks->pluck('id')->toArray(),
                'value' => 'completed',
            ])
            ->assertRedirect()
            ->assertSessionHas('success');

        foreach ($tasks as $task) {
            $this->assertDatabaseHas('tasks', [
                'id' => $task->id,
                'status' => 'completed',
            ]);
        }
    }
}
```

---



## 第六章补充：Inertia.js 的实际工程经验与踩坑指南

### 6.4 数据序列化与 Eloquent 模型转换

在实际项目中，一个常见的问题是 Laravel Eloquent 模型的数据如何高效地传递给前端组件。虽然 Laravel 的自动序列化功能很方便，但在性能敏感的场景下，你需要注意一些细节。

首先是**避免不必要的数据传输**。当你直接将 Eloquent 模型传递给 Inertia props 时，Laravel 会序列化模型的所有属性。如果模型有很多字段（比如包含大段的 JSON 数据、二进制内容等），这会浪费大量的网络带宽。最佳实践是在控制器中手动指定需要传递的字段，或者使用 Laravel 的 API Resource 进行数据转换。

```php
// 不推荐 — 传递了所有字段
return Inertia::render('Users/Show', [
    'user' => $user, // 包含 password、remember_token 等敏感字段
]);

// 推荐 — 只传递需要的字段
return Inertia::render('Users/Show', [
    'user' => [
        'id' => $user->id,
        'name' => $user->name,
        'email' => $user->email,
        'avatar_url' => $user->avatar_url,
        'created_at' => $user->created_at->format('Y-m-d H:i:s'),
    ],
]);
```

其次是**关系数据的懒加载**。如果你的模型定义了大量关系（使用了 `$with` 属性或全局作用域），即使前端不需要这些关系数据，它们也会被自动加载和序列化。在 Inertia 控制器中，建议使用 `->only()` 方法来精确控制序列化的属性：

```php
$user->load('posts'); // 显式加载关系
return Inertia::render('Users/Show', [
    'user' => $user->only(['id', 'name', 'email', 'posts']),
]);
```

第三是**日期格式的一致性**。Eloquent 模型的日期属性默认使用 Carbon 对象，在序列化时会自动转换为 ISO 8601 格式。但前端组件可能需要不同的日期格式。建议在控制器中统一格式化日期，而不是在前端做格式转换，这样可以确保前后端的日期处理逻辑一致。

### 6.5 路由与 URL 管理

在传统 SPA 模式下，前端使用 Vue Router 或 React Router 管理路由，与后端的路由系统是独立的。这常常导致两个问题：一是前端路由和后端 API 路由不同步，需要开发者手动维护一致性；二是 URL 结构可能不匹配，导致分享链接或书签失效。

Inertia.js 完全消除了这个问题，因为路由完全由 Laravel 管理。前端组件中的所有链接都使用 Laravel 的命名路由生成，确保了 URL 的一致性。通过 Ziggy 库，你可以在 JavaScript 中使用 Laravel 的 `route()` 辅助函数：

```vue
<!-- Vue 3 中使用 Ziggy -->
<template>
    <Link :href="route('tasks.show', { task: task.id })">
        查看任务
    </Link>
    <Link :href="route('tasks.edit', task.id)">
        编辑
    </Link>
</template>
```

这不仅简化了路由管理，还带来了额外的好处：当 Laravel 路由定义发生变化时，前端代码会自动使用新的 URL，不需要手动更新。

### 6.6 处理复杂的前端交互场景

虽然 Inertia.js 适合大多数 Web 应用场景，但在某些复杂的前端交互场景下，你可能需要结合传统的客户端状态管理。比如拖拽排序、实时协作编辑、复杂的表单向导等。

对于这些场景，推荐的做法是：使用 Inertia 管理页面级别的数据和导航，使用 Vue 的 `ref`/`reactive` 或 React 的 `useState`/`useReducer` 管理组件级别的交互状态。这样既能享受 Inertia 的便利，又不会限制前端的交互能力。

例如，实现一个拖拽排序的看板：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import draggable from 'vuedraggable'

const props = defineProps<{
    board: {
        columns: {
            id: number
            title: string
            tasks: Task[]
        }[]
    }
}>()

// 本地排序状态（拖拽时的即时反馈）
const localColumns = ref(JSON.parse(JSON.stringify(props.board.columns)))

// 拖拽结束后，将排序结果同步到后端
const onDragEnd = () => {
    const order = localColumns.value.flatMap(col =>
        col.tasks.map((task, index) => ({
            id: task.id,
            column_id: col.id,
            sort_order: index,
        }))
    )

    router.post(route('tasks.reorder'), { order }, {
        preserveState: true,
        preserveScroll: true,
        onError: () => {
            // 拖拽失败时恢复原始排序
            localColumns.value = JSON.parse(JSON.stringify(props.board.columns))
        },
    })
}
</script>

<template>
    <div class="board">
        <div v-for="column in localColumns" :key="column.id" class="column">
            <h3>{{ column.title }}</h3>
            <draggable
                v-model="column.tasks"
                group="tasks"
                item-key="id"
                @end="onDragEnd"
            >
                <template #item="{ element }">
                    <div class="task-card">
                        {{ element.title }}
                    </div>
                </template>
            </draggable>
        </div>
    </div>
</template>
```

这个例子展示了 Inertia 和客户端交互的完美配合：拖拽操作使用本地状态实现即时反馈，操作完成后通过 Inertia 将变更同步到后端。如果后端处理失败，Inertia 的错误回调会恢复本地状态。整个过程中，用户体验是流畅的，而数据一致性也得到了保证。

### 6.7 性能调优实战建议

在大型 Inertia 应用中，以下几个性能调优技巧值得注意：

**合理使用惰性 Props**。将不常用或计算成本高的数据标记为惰性，减少每次导航的数据库查询次数。但要注意，惰性数据只在客户端显式请求时才加载，如果某个数据几乎每次页面访问都需要，就不应该标记为惰性，否则反而增加了请求次数。

**优化 Eloquent 查询**。使用 `select()` 限制查询字段，使用 `with()` 预加载关系避免 N+1 问题，使用 `cursor()` 替代 `get()` 处理大数据集。在控制器中可以使用 Laravel Debugbar 或 Telescope 来监控查询性能。

**合理设置分页大小**。默认的 15 条/页适合大多数场景，但对于需要快速浏览大量数据的页面，可以允许用户自定义分页大小，并将其存储在 URL 参数中，确保分享链接时保留用户的偏好。

**压缩 props 数据**。对于包含大量数据的 props，确保启用了 Laravel 的 Gzip 或 Brotli 响应压缩，可以显著减少网络传输体积。

**利用浏览器缓存**。虽然 Inertia 的版本控制机制会在部署时自动刷新客户端缓存，但对于静态资源（图片、字体等），仍然需要配置正确的缓存策略，使用 CDN 加速分发。




### 6.8 Inertia.js 与 Laravel 队列系统的协作

在实际的企业级应用中，很多业务操作是耗时的，比如发送邮件通知、生成报表、处理图片、导入导出数据等。这些操作如果放在同步请求中执行，会严重影响用户体验。Laravel 的队列系统完美解决了这个问题，而 Inertia.js 与队列系统的协作也非常自然。

典型的流程是：用户通过 Inertia 表单提交一个耗时操作的请求，控制器将任务推送到队列中，然后立即返回一个"操作已提交"的闪存消息给用户。后台的队列工作进程异步处理任务，处理完成后通过 Laravel 的通知系统（如广播事件）告知用户结果。

这种模式下，前端的交互体验是即时的——用户点击按钮后立即得到反馈，不需要等待后台处理完成。而 Inertia 的闪存消息机制使得"操作已提交"的提示展示非常简单，不需要前端额外处理。这是 Inertia.js 在实际工程项目中的一个重要优势：它与 Laravel 的所有功能模块都能无缝配合，开发者不需要编写额外的集成代码。

### 6.9 国际化与多语言支持

对于面向多语言用户的 Web 应用，Inertia.js 同样提供了良好的支持。Laravel 的本地化功能（`trans()`、`__()` 辅助函数）可以在控制器中直接使用，而通过 SharedData 机制，当前语言设置可以自动传递给所有前端组件。

在实际实现中，你可以在 `HandleInertiaRequests` 中间件中共享当前的语言环境和翻译字符串。前端组件使用这些翻译字符串来渲染多语言内容，而语言切换只需要在 Laravel 端设置 session 变量，然后通过 Inertia 重定向刷新页面即可。这种方案比传统 SPA 模式下在前端维护一套独立的翻译文件要简单得多，因为所有的翻译都集中在 Laravel 的 `lang/` 目录中管理，避免了前后端翻译文件不一致的问题。

### 6.10 安全性考量

安全性是 Web 应用开发中不可忽视的方面。Inertia.js 在安全性方面的表现如何呢？

首先，Inertia 继承了 Laravel 的所有安全特性：CSRF 防护、SQL 注入防护、XSS 防护等。每个 Inertia 表单提交都会自动包含 CSRF Token，无需前端手动处理。Laravel 的中间件系统可以对所有 Inertia 请求应用统一的安全策略，比如 CORS、速率限制、IP 白名单等。

其次，Inertia 的 Props 系统天然地实现了数据访问控制。因为数据在控制器中获取和过滤，而不是通过 API 暴露，所以你可以精确地控制每个页面能看到哪些数据。结合 Laravel 的授权策略（Policy 和 Gate），可以实现细粒度的权限控制。

最后，Inertia 的请求头验证机制（`X-Inertia` 头）可以防止某些类型的攻击，比如 JSON 劫持。因为只有携带正确请求头的请求才会收到 JSON 响应，普通浏览器直接访问 URL 会收到 HTML 页面，从而避免了敏感数据被窃取的风险。


## 第七章：总结与技术展望

### 7.1 核心优势回顾

通过本文的深入分析和实战演示，我们可以总结 Inertia.js 带来的核心优势：

**开发效率显著提升**。Inertia.js 消除了传统前后端分离模式中的大量胶水代码——无需设计 API 接口、无需编写 API 文档、无需处理 CORS 和认证 Token、无需配置前端路由和状态管理。开发者可以将更多精力集中在业务逻辑和用户体验上。

**技术栈大幅简化**。单一代码库、单一部署流程、统一的认证机制、一致的开发体验。对于中小型团队来说，这意味着更低的维护成本和更高的迭代速度。

**渐进增强的安全网**。首次加载的 HTML 渲染确保了基本的可用性和 SEO 支持，即使在 JavaScript 加载缓慢或失败的情况下，用户仍然能看到有意义的内容。

**与 Laravel 生态无缝集成**。Laravel 的中间件、表单验证、认证系统、文件存储、队列系统等所有功能都可以直接使用，无需额外适配。

### 7.2 适用场景最终判断

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 内部管理系统 | Inertia.js | 开发效率优先，不需要 API 复用 |
| SaaS 应用 | Inertia.js | 快速迭代，单体部署 |
| 内容网站（博客、新闻） | Inertia.js + SSR | SEO 需要，内容更新频繁 |
| 电商后台 | Inertia.js | 复杂表单多，Inertia Form 助手强大 |
| 开放平台 API | 传统 SPA | 需要提供独立 API |
| 移动端 + Web 共用后端 | 传统 SPA | API 需要被多个客户端消费 |
| 大型团队协作 | 视情况而定 | 前后端团队独立时选传统 SPA |
| 微前端架构 | 传统 SPA | 需要前端模块化拆分 |

### 7.3 生态发展趋势

Inertia.js 的生态系统正在持续壮大。官方提供了 Vue 2/3、React 和 Svelte 的适配器，社区也贡献了大量组件库和工具：

**官方生态**：Laravel Breeze 和 Jetstream 已内置 Inertia 支持，提供了完整的脚手架方案；官方 SSR 方案日趋成熟。

**社区组件**：Inertia DataTable（高性能数据表格）、Inertia Modal（模态框和滑动面板）、Inertia Paginator（分页器）、Inertia Date Picker（日期选择器）等。

**开发工具**：Inertia DevTools（浏览器扩展，用于调试 Inertia 请求和 Props）、Laravel Debugbar 的 Inertia 集成等。

**TypeScript 支持**：完善的类型定义和类型推导，让开发者在编写 Inertia 应用时享受到完整的 IDE 智能提示。

### 7.4 写在最后

Inertia.js 不是要取代传统的前后端分离模式，而是提供了一种**更简洁、更高效**的替代方案。它让我们重新审视了全栈开发的本质——服务端负责路由、数据和业务逻辑，客户端负责展示和交互——这种分工方式在 Web 开发的早期就已经被证明是高效且实用的。

Inertia.js 的创新在于，它将这种传统的分工方式与现代 SPA 的用户体验完美结合，让我们在享受 SPA 流畅导航的同时，不必承担前后端分离带来的额外复杂性。

如果你是一个 Laravel 开发者，正在为一个中小型项目纠结是否要前后端分离，我强烈建议你尝试 Inertia.js。它可能不会彻底改变你的技术观，但几乎一定会改变你的开发体验——让你更快地交付产品，更少地处理令人头疼的"胶水"问题。

从今天开始，放下 API 设计的烦恼，专注于真正重要的事情——构建出色的产品，解决用户的实际问题。

---

> **参考资源：**
> - [Inertia.js 官方文档](https://inertiajs.com/)
> - [Laravel Breeze 官方文档](https://laravel.com/docs/breeze)
> - [Inertia.js GitHub 仓库](https://github.com/inertiajs/inertia)
> - [Laracasts - Build Modern Laravel Apps Using Inertia.js](https://laracasts.com/series/build-modern-laravel-apps-using-inertia-js)
> - [Inertia.js SSR 官方文档](https://inertiajs.com/server-side-rendering)
> - [Laravel + Inertia.js 社区资源列表](https://github.com/innocenzi/awesome-inertiajs)

## 相关阅读

- [Laravel Volt 实战：单文件 Blade 组件与 Livewire 集成深度剖析](/php/Laravel/2026-06-01-laravel-volt-single-file-blade-components-livewire/)
- [Tailwind CSS v4 实战：引擎重写后的性能飞跃与 Laravel Livewire 集成](/frontend/2026-06-02-tailwind-css-v4-engine-rewrite-performance-livewire-integration/)
- [Vite 实战：前后端分离开发工作流踩坑记录](/frontend/vite-laravel-guide/)

---

*本文首发于个人博客，如需转载请注明出处。如有问题或建议，欢迎在评论区留言讨论。*
