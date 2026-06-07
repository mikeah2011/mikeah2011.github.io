# Laravel 新版本特性

> Laravel 12.x 核心特性、Livewire/Volt/Folio/Pennant 组件生态、Inertia.js 全栈范式与 AI 辅助开发工具。

## 定义

Laravel 框架持续演进，每个大版本都带来显著的开发体验提升。本文覆盖 Laravel 11/12 的核心新特性，以及围绕 Livewire、Inertia.js、Pennant 等组件构建的现代全栈开发范式。

## 核心原理

### Laravel 11/12 核心改进

| 特性 | 说明 |
|------|------|
| 精简目录结构 | 取消 Http/Kernel.php，中间件自动注册 |
| Context 对象 | 请求级上下文容器，跨层传递数据 |
| 并发辅助函数 | `concurrency()` 并行执行闭包 |
| Artisan 改进 | `make:enum`、`make:cast` 等新命令 |
| Pipeline 重构 | 更灵活的业务流程编排 |
| 队列改进 | 更好的批量任务、失败处理 |

### Livewire / Volt

Livewire 是 Laravel 的全栈组件框架，Volt 是其函数式 API：

```php
// Volt：函数式 Livewire 组件
use function Livewire\Volt\{state, mount};

state(['count' => 0]);

$increment = fn() => $this->count++;
```

### Folio：页面路由

```php
// resources/views/pages/dashboard.php → /dashboard
// resources/views/pages/users/[id].php → /users/{id}
```

用文件系统约定替代路由定义，适合页面驱动的应用。

### Pennant：Feature Flags

```php
// 定义特性
Pennant::define('new-checkout-flow', function ($user) {
    return $user->isBetaTester();
});

// 使用
if (Feature::active('new-checkout-flow')) {
    // 新结账流程
}
```

支持渐进式发布、A/B 测试、按用户/团队/百分比灰度。

### Inertia.js：全栈范式

```
Laravel (Controller) → Inertia::render('User/Index', ['users' => $users])
    ↓
Vue 3 / React (SPA) → 接收 props，无需 API 层
```

**优势**：
- 无需单独的 API 层
- 服务端渲染 + 客户端导航
- 共享验证逻辑、错误处理

## 实战案例

### Laravel 12.x Pipeline 重构

来自博客：[Laravel 12.x Pipeline 实战：复杂业务流程编排与条件分支](/2026/06/01/Laravel-12x-Pipeline-重构实战/)

```php
$order = app(Pipeline::class)
    ->send($orderData)
    ->through([
        ValidateOrder::class,
        CheckInventory::class,
        ApplyDiscount::class,
        ProcessPayment::class,    // 条件分支：免费订单跳过
        SendConfirmation::class,
    ])
    ->thenReturn();
```

### Pennant 渐进式发布

来自博客：[Laravel Pennant 实战：Feature Flags 与渐进式发布策略](/2026/06/01/laravel-pennant-feature-flags-gradual-release-strategy/)

```php
// 按百分比灰度
Pennant::define('new-search', function ($user) {
    return $user->id % 100 < 20; // 20% 用户
});

// 动态开启/关闭
Feature::activate('new-search');
Feature::deactivate('new-search');
```

### Inertia.js + Vue 3 全栈

来自博客：[Laravel + Inertia.js 实战：Vue 3/React 单页应用的全新全栈范式](/2026/06/01/Laravel-Inertia-实战-Vue3-React-单页应用全新全栈范式-对比传统SPA前后端分离/)

```php
// Controller
public function index()
{
    return Inertia::render('Users/Index', [
        'users' => User::paginate(),
        'filters' => request()->only(['search', 'role']),
    ]);
}
```

```vue
<!-- Vue 3 -->
<script setup>
const props = defineProps(['users', 'filters'])
</script>
```

## 相关概念

- [服务容器](服务容器.md) - Laravel 核心
- [事件驱动架构](事件驱动架构.md) - Events & Listeners
- [队列深度实战](队列深度实战.md) - Jobs & Queues
- [PHP8新特性](PHP8新特性.md) - PHP 语言级改进

## 常见问题

**Q: Livewire 和 Inertia.js 该选哪个？**
A: Livewire 适合 PHP 全栈开发者、管理后台、表单密集型应用；Inertia.js 适合有前端团队、需要 SPA 体验、组件化程度高的应用。

**Q: Pennant 和自定义 Feature Flag 有什么区别？**
A: Pennant 提供了标准化的 API、数据库存储、缓存、作用域（用户/团队）、渐进式百分比等开箱即用能力。

**Q: Folio 适合 API 项目吗？**
A: 不太适合。Folio 面向页面驱动的应用，API 项目仍推荐传统路由定义。
