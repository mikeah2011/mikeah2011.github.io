---

title: Laravel Precognition 实战：表单预验证——前后端实时校验的全新交互范式
keywords: [Laravel Precognition, 表单预验证, 前后端实时校验的全新交互范式]
date: 2026-06-06 02:08:57
tags:
- Laravel
- Precognition
- 表单验证
- 前端交互
- Livewire
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 深入实战 Laravel Precognition 表单预验证机制，详解前后端实时校验的全新交互范式。涵盖原理剖析、Livewire/Vue/React 多框架集成、部分字段验证、防抖优化、生产环境安全策略及踩坑记录，帮助开发者用最少代码实现服务端级别的即时表单验证，彻底告别'提交后才报错'的糟糕用户体验。
---



## 前言

在 Web 应用开发中，表单交互始终是用户体验的核心战场。用户填完一张注册表单，满怀期待地点击「提交」，却得到一屏红色的错误提示——「邮箱格式不正确」「密码强度不够」「用户名已被占用」——这种体验无疑令人沮丧。传统的表单验证模式是「先提交、后报错」，而 Laravel Precognition 为我们打开了一扇全新的大门：**在用户输入的同时，服务端就已经知道这条数据是否合法，并实时将校验结果推送到前端**。

本文将从原理到实战，深入剖析 Laravel Precognition 的方方面面，涵盖基础表单、复杂业务场景、Livewire 集成、Vue/React 前端集成、性能优化以及生产环境踩坑记录，力求为读者呈现一份完整、可落地的实战指南。

---

## 一、什么是 Precognition？解决什么痛点？

### 1.1 名词释义

「Precognition」一词源自拉丁语，意为「预知」。在 Laravel 的语境下，它指代一种**表单预验证（Pre-validation）机制**：前端在用户填写表单时，将当前已填字段以特殊请求发送至服务端，服务端运行验证逻辑后将结果返回，前端据此即时展示错误信息，而无需等待用户点击「提交」按钮。

### 1.2 解决的核心痛点

**痛点一：反馈滞后**

传统模式下，用户必须完成整张表单并提交后，才能得知哪个字段有问题。当表单字段较多（例如注册、订单结算、地址编辑等），这种滞后带来的挫败感会成倍放大。

**痛点二：前端验证的局限性**

虽然前端可以做基础校验（格式、长度等），但涉及唯一性检查（用户名/邮箱是否已注册）、业务逻辑校验（库存是否充足、优惠券是否有效）时，前端验证束手无策，必须依赖后端。

**痛点三：SPA 开发门槛**

想要实现「实时服务端校验」，传统做法需要开发者手写大量 AJAX 请求、防抖逻辑、错误状态管理代码。这不仅繁琐，而且容易出错，尤其在表单字段众多时，代码量会急剧膨胀。

Laravel Precognition 正是为解决以上三个痛点而生。它让开发者只需在服务端定义一次验证规则，就能自动获得前端实时校验能力，无需额外编写 AJAX 请求逻辑。

---

## 二、传统表单验证 vs Precognition 对比

为了更直观地理解 Precognition 的价值，我们来做一个详细的对比：

| 维度 | 传统表单验证 | Laravel Precognition |
|------|-------------|---------------------|
| **校验时机** | 仅在表单提交时触发 | 用户输入过程中实时触发 |
| **校验位置** | 服务端（提交后）/ 前端（有限） | 服务端（实时） |
| **唯一性检查** | 需要提交后才能提示 | 输入时即可提示 |
| **代码量** | 中等（需手写 AJAX 逻辑） | 极少（框架自动处理） |
| **用户体验** | 一般，反馈滞后 | 优秀，即时反馈 |
| **开发复杂度** | 中等 | 低 |
| **网络请求** | 仅提交时一次 | 多次（可优化） |
| **维护成本** | 高（前后端验证逻辑分离） | 低（验证规则统一在服务端） |

可以看出，Precognition 在用户体验和开发效率方面具有显著优势，但需要注意网络请求的优化问题，这部分我们将在「性能优化」章节详细讨论。

---

## 三、Laravel Precognition 原理

### 3.1 整体架构

Precognition 的工作流程如下：

```
用户输入 → 前端 JS SDK 捕获变更 → 发送 Precognition 请求（带特殊 Header）
    → 服务端识别为预验证请求 → 仅运行验证逻辑（不执行业务代码）
    → 返回验证结果（JSON） → 前端即时展示/清除错误信息
```

### 3.2 关键机制

**特殊 HTTP Header**

Precognition 请求通过 `Precognition: true` 请求头标识。服务端中间件检测到此 Header 后，会在验证通过时直接返回 `200 OK`，而不会执行 Controller 中后续的业务逻辑。如果验证失败，则返回 `422` 状态码和标准的验证错误 JSON。

**部分字段验证**

前端可以只发送用户当前正在编辑的字段，而非整个表单的数据。例如用户正在修改「邮箱」字段，那么只有该字段及其依赖字段会被发送到服务端进行校验，这大大减少了服务端的计算负担。

**可预测的路由复用**

Precognition 无需额外定义 API 端点，它直接复用现有的表单提交路由（通常是 POST/PUT/PATCH 路由）。只需在 Controller 中使用 `Precognition` 特性或中间件，即可让同一路由同时支持「预验证」和「正式提交」两种模式。

### 3.3 服务端处理流程

当服务端收到带有 `Precognition: true` Header 的请求时：

1. `HandlePrecognitiveRequests` 中间件拦截请求
2. 如果请求包含 `X-Precognition-Fields` Header，则只验证指定字段
3. 运行 Controller 中定义的验证规则
4. 验证通过：返回 `200 OK`（不执行后续业务逻辑）
5. 验证失败：返回 `422` 状态码和错误详情 JSON

---

## 四、环境准备与安装配置

### 4.1 环境要求

- Laravel 10.x 或更高版本（推荐 Laravel 11.x）
- PHP 8.1+
- Node.js 18+

### 4.2 安装步骤

Precognition 已随 Laravel 10+ 内置，无需额外安装 Composer 包。对于前端 SDK，根据你的技术栈选择：

**使用 Alpine.js / 通用方案：**

```bash
npm install laravel-precognition
```

**使用 Vue.js：**

```bash
npm install laravel-precognition-vue
```

**使用 React：**

```bash
npm install laravel-precognition-react
```

### 4.3 后端配置

确保 `app/Http/Kernel.php` 中注册了中间件（Laravel 10）：

```php
// app/Http/Kernel.php
protected $middlewareAliases = [
    // ...
    'precognitive' => \Illuminate\Routing\Middleware\HandlePrecognitiveRequests::class,
];
```

如果你使用的是 Laravel 11+，中间件默认已可用，无需额外配置。你可以在路由或 Controller 中直接使用：

```php
// routes/web.php
Route::post('/register', [RegisterController::class, 'store'])
    ->middleware('precognitive');
```

或者在 Controller 构造函数中使用：

```php
class RegisterController extends Controller
{
    public function __construct()
    {
        $this->middleware('precognitive');
    }
}
```

### 4.4 前端配置（通用 JS SDK）

在你的 JavaScript 入口文件中引入：

```js
import { precognitive } from 'laravel-precognition';
// 或
import Precognition from 'laravel-precognition';
```

---

## 五、实战一：基础表单实时校验（注册表单）

让我们从最常见的注册表单开始，逐步演示 Precognition 的使用方式。

### 5.1 服务端：定义验证规则

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class RegisteredUserController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name'     => ['required', 'string', 'max:255'],
            'email'    => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => [
                'required',
                'string',
                Password::min(8)
                    ->mixedCase()
                    ->numbers()
                    ->symbols()
                    ->uncompromised(),
            ],
            'password_confirmation' => ['required', 'same:password'],
        ]);

        // 仅在验证通过后执行（Precognition 请求不会到达这里）
        $user = User::create([
            'name'     => $validated['name'],
            'email'    => $validated['email'],
            'password' => Hash::make($validated['password']),
        ]);

        auth()->login($user);

        return redirect()->route('dashboard');
    }
}
```

注意：**你不需要修改 Controller 代码**。只要路由或 Controller 应用了 `precognitive` 中间件，现有的验证规则就会自动被 Precognition 利用。

### 5.2 前端：Alpine.js 实现

```html
<form
    x-data="{
        form: $precognition.form('post', '/register', {
            name: '',
            email: '',
            password: '',
            password_confirmation: '',
        }),
    }"
    x-on:submit.prevent="form.submit()"
>
    <!-- 姓名 -->
    <div>
        <label for="name">姓名</label>
        <input
            id="name"
            type="text"
            x-model="form.name"
            x-on:change="form.validate('name')"
        />
        <template x-if="form.invalid('name')">
            <span class="text-red-500" x-text="form.errors.name"></span>
        </template>
    </div>

    <!-- 邮箱 -->
    <div>
        <label for="email">邮箱地址</label>
        <input
            id="email"
            type="email"
            x-model="form.email"
            x-on:change="form.validate('email')"
        />
        <template x-if="form.invalid('email')">
            <span class="text-red-500" x-text="form.errors.email"></span>
        </template>
    </div>

    <!-- 密码 -->
    <div>
        <label for="password">密码</label>
        <input
            id="password"
            type="password"
            x-model="form.password"
            x-on:change="form.validate('password')"
        />
        <template x-if="form.invalid('password')">
            <span class="text-red-500" x-text="form.errors.password"></span>
        </template>
    </div>

    <!-- 确认密码 -->
    <div>
        <label for="password_confirmation">确认密码</label>
        <input
            id="password_confirmation"
            type="password"
            x-model="form.password_confirmation"
            x-on:change="form.validate('password_confirmation')"
        />
    </div>

    <!-- 提交按钮 -->
    <button type="submit" :disabled="form.processing">
        <span x-show="form.processing">注册中...</span>
        <span x-show="!form.processing">立即注册</span>
    </button>
</form>
```

### 5.3 运行效果

当用户在邮箱字段输入 `test@` 然后切换焦点（触发 `change` 事件），前端会立即向 `/register` 发送一个带有 `Precognition: true` Header 的 POST 请求，仅包含 `email` 字段。服务端验证后返回：

```json
{
    "message": "The email field must be a valid email address.",
    "errors": {
        "email": ["The email field must be a valid email address."]
    }
}
```

前端 JS SDK 自动解析错误并更新 `form.errors.email`，模板中的错误信息即时显示。当用户修正输入后，错误信息会自动消失。

如果用户输入的邮箱已被注册（`unique` 规则触发），同样会立即收到提示：「The email has already been taken.」——这一切发生在用户点击「提交」之前。

---

## 六、实战二：复杂业务表单（多步骤表单、条件字段）

### 6.1 多步骤表单

在实际业务中，多步骤表单非常常见，例如电商结算流程中的「地址信息 → 支付方式 → 订单确认」。我们可以利用 Precognition 在每一步切换时进行实时校验。

```php
// routes/web.php
Route::post('/checkout/address', [CheckoutController::class, 'saveAddress'])
    ->middleware('precognitive');

Route::post('/checkout/payment', [CheckoutController::class, 'savePayment'])
    ->middleware('precognitive');

Route::post('/checkout/confirm', [CheckoutController::class, 'confirm'])
    ->middleware('precognitive');
```

```php
class CheckoutController extends Controller
{
    public function saveAddress(Request $request)
    {
        $validated = $request->validate([
            'province' => ['required', 'string'],
            'city'     => ['required', 'string'],
            'district' => ['required', 'string'],
            'address'  => ['required', 'string', 'min:5', 'max:255'],
            'phone'    => ['required', 'string', 'regex:/^1[3-9]\d{9}$/'],
            'name'     => ['required', 'string', 'max:50'],
        ]);

        $request->session()->put('checkout.address', $validated);

        return response()->json(['next' => 'payment']);
    }

    public function savePayment(Request $request)
    {
        $validated = $request->validate([
            'payment_method' => ['required', 'in:wechat,alipay,card'],
            'card_number'    => [
                'required_if:payment_method,card',
                'nullable',
                'string',
                'regex:/^\d{16,19}$/',
            ],
        ]);

        $request->session()->put('checkout.payment', $validated);

        return response()->json(['next' => 'confirm']);
    }
}
```

### 6.2 条件字段验证

当某些字段的验证规则依赖于其他字段的值时（例如「选择银行卡支付时才需要填写卡号」），Precognition 同样能够优雅处理。

关键点在于前端 SDK 会将整个表单数据发送到服务端（或至少发送指定字段及其依赖字段），服务端根据条件规则进行验证：

```php
$request->validate([
    'payment_method' => ['required', 'in:wechat,alipay,card'],
    'card_number'    => ['required_if:payment_method,card'],
    'card_holder'    => ['required_if:payment_method,card', 'string'],
    'cvv'            => ['required_if:payment_method,card', 'digits:3'],
]);
```

前端实现：

```html
<form x-data="{
    form: $precognition.form('post', '/checkout/payment', {
        payment_method: 'wechat',
        card_number: '',
        card_holder: '',
        cvv: '',
    })
}">
    <div>
        <label>支付方式</label>
        <select x-model="form.payment_method" x-on:change="form.validate('payment_method')">
            <option value="wechat">微信支付</option>
            <option value="alipay">支付宝</option>
            <option value="card">银行卡</option>
        </select>
    </div>

    <template x-if="form.payment_method === 'card'">
        <div>
            <div>
                <label>卡号</label>
                <input type="text" x-model="form.card_number" x-on:change="form.validate('card_number')" />
                <span x-show="form.invalid('card_number')" x-text="form.errors.card_number" class="text-red-500"></span>
            </div>
            <div>
                <label>持卡人姓名</label>
                <input type="text" x-model="form.card_holder" x-on:change="form.validate('card_holder')" />
                <span x-show="form.invalid('card_holder')" x-text="form.errors.card_holder" class="text-red-500"></span>
            </div>
            <div>
                <label>CVV</label>
                <input type="text" x-model="form.cvv" x-on:change="form.validate('cvv')" />
                <span x-show="form.invalid('cvv')" x-text="form.errors.cvv" class="text-red-500"></span>
            </div>
        </div>
    </template>

    <button type="submit" x-on:click.prevent="form.submit()">下一步</button>
</form>
```

当用户选择「微信支付」时，银行卡相关字段不会出现在 DOM 中，自然也不会触发验证。切换到「银行卡」时，相关字段出现并自动参与到 Precognition 验证流程中。

---

## 七、实战三：与 Livewire 集成

Livewire 是 Laravel 生态中最流行的全栈框架之一，而 Precognition 与 Livewire 的集成堪称天作之合。

### 7.1 基本集成方式

从 Laravel 10.31 开始，Livewire 组件可以使用 `#[Validate]` 属性和 `Precognition` 特性：

```php
<?php

namespace App\Livewire;

use Illuminate\Validation\Rule;
use Livewire\Attributes\Validate;
use Livewire\Component;

class RegistrationForm extends Component
{
    #[Validate('required|string|max:255')]
    public string $name = '';

    #[Validate(['required', 'email', 'max:255', Rule::unique('users', 'email')])]
    public string $email = '';

    #[Validate('required|string|min:8|confirmed')]
    public string $password = '';

    #[Validate('required|string')]
    public string $password_confirmation = '';

    public function register()
    {
        $this->validate();

        // 创建用户并登录...
        $user = \App\Models\User::create([
            'name'     => $this->name,
            'email'    => $this->email,
            'password' => bcrypt($this->password),
        ]);

        auth()->login($user);

        return redirect()->route('dashboard');
    }

    public function render()
    {
        return view('livewire.registration-form');
    }
}
```

在 Livewire 的 Blade 模板中：

```html
<form wire:submit="register">
    <div>
        <label>姓名</label>
        <input type="text" wire:model.live="name" />
        @error('name')
            <span class="text-red-500">{{ $message }}</span>
        @enderror
    </div>

    <div>
        <label>邮箱</label>
        <input type="email" wire:model.live="email" />
        @error('email')
            <span class="text-red-500">{{ $message }}</span>
        @enderror
    </div>

    <div>
        <label>密码</label>
        <input type="password" wire:model.live="password" />
        @error('password')
            <span class="text-red-500">{{ $message }}</span>
        @enderror
    </div>

    <div>
        <label>确认密码</label>
        <input type="password" wire:model.live="password_confirmation" />
    </div>

    <button type="submit">注册</button>
</form>
```

### 7.2 Livewire 中的 Precognition 工作原理

在 Livewire 环境中，当你使用 `wire:model.live` 时，每次用户修改字段值都会触发一个 Livewire 请求。Livewire 会自动在该请求中附加 `Precognition: true` Header，并使用组件中定义的验证规则进行实时校验。这意味着你不需要手动管理任何 AJAX 逻辑——Livewire 与 Precognition 在底层自动协作。

### 7.3 高级用法：条件验证

```php
use Livewire\Attributes\Rule;

class OrderForm extends Component
{
    #[Rule('required|in:standard,express,same_day')]
    public string $shipping_method = 'standard';

    #[Rule('required_if:shipping_method,same_day|string|max:255')]
    public string $delivery_address = '';

    #[Rule(['nullable', 'date', 'after_or_equal:today'])])
    public ?string $delivery_date = null;

    // 当 shipping_method 变化时，自动重新验证相关字段
    public function updatedShippingMethod()
    {
        $this->validateOnly('delivery_address');
        $this->validateOnly('delivery_date');
    }
}
```

---

## 八、实战四：Vue/React 前端集成

### 8.1 Vue 3 + Precognition

**安装：**

```bash
npm install laravel-precognition-vue
```

**基本用法：**

```vue
<script setup>
import { useForm } from 'laravel-precognition-vue';

const form = useForm('post', '/register', {
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
});

const submit = () => form.submit({
    onSuccess: (response) => {
        // 注册成功，重定向
        window.location.href = response.data.redirect || '/dashboard';
    },
    onError: (errors) => {
        console.error('Validation failed:', errors);
    },
});
</script>

<template>
    <form @submit.prevent="submit">
        <div class="mb-4">
            <label class="block text-sm font-medium mb-1">姓名</label>
            <input
                v-model="form.name"
                @change="form.validate('name')"
                class="border rounded px-3 py-2 w-full"
                :class="{ 'border-red-500': form.invalid('name') }"
            />
            <p v-if="form.invalid('name')" class="text-red-500 text-sm mt-1">
                {{ form.errors.name }}
            </p>
        </div>

        <div class="mb-4">
            <label class="block text-sm font-medium mb-1">邮箱</label>
            <input
                v-model="form.email"
                @change="form.validate('email')"
                type="email"
                class="border rounded px-3 py-2 w-full"
                :class="{ 'border-red-500': form.invalid('email') }"
            />
            <p v-if="form.invalid('email')" class="text-red-500 text-sm mt-1">
                {{ form.errors.email }}
            </p>
        </div>

        <div class="mb-4">
            <label class="block text-sm font-medium mb-1">密码</label>
            <input
                v-model="form.password"
                @change="form.validate('password')"
                type="password"
                class="border rounded px-3 py-2 w-full"
                :class="{ 'border-red-500': form.invalid('password') }"
            />
            <p v-if="form.invalid('password')" class="text-red-500 text-sm mt-1">
                {{ form.errors.password }}
            </p>
        </div>

        <div class="mb-4">
            <label class="block text-sm font-medium mb-1">确认密码</label>
            <input
                v-model="form.password_confirmation"
                type="password"
                class="border rounded px-3 py-2 w-full"
            />
        </div>

        <button
            type="submit"
            :disabled="form.processing"
            class="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
            <span v-if="form.processing">提交中...</span>
            <span v-else>注册</span>
        </button>
    </form>
</template>
```

### 8.2 React + Precognition

**安装：**

```bash
npm install laravel-precognition-react
```

**基本用法：**

```jsx
import { useForm } from 'laravel-precognition-react';

export default function RegisterForm() {
    const form = useForm('post', '/register', {
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
    });

    const submit = (e) => {
        e.preventDefault();
        form.submit({
            onSuccess: () => window.location.href = '/dashboard',
        });
    };

    return (
        <form onSubmit={submit}>
            <div>
                <label>姓名</label>
                <input
                    value={form.data.name}
                    onChange={(e) => form.setData('name', e.target.value)}
                    onBlur={() => form.validate('name')}
                />
                {form.invalid('name') && (
                    <span className="text-red-500">{form.errors.name}</span>
                )}
            </div>

            <div>
                <label>邮箱</label>
                <input
                    type="email"
                    value={form.data.email}
                    onChange={(e) => form.setData('email', e.target.value)}
                    onBlur={() => form.validate('email')}
                />
                {form.invalid('email') && (
                    <span className="text-red-500">{form.errors.email}</span>
                )}
            </div>

            <div>
                <label>密码</label>
                <input
                    type="password"
                    value={form.data.password}
                    onChange={(e) => form.setData('password', e.target.value)}
                    onBlur={() => form.validate('password')}
                />
                {form.invalid('password') && (
                    <span className="text-red-500">{form.errors.password}</span>
                )}
            </div>

            <div>
                <label>确认密码</label>
                <input
                    type="password"
                    value={form.data.password_confirmation}
                    onChange={(e) => form.setData('password_confirmation', e.target.value)}
                />
            </div>

            <button type="submit" disabled={form.processing}>
                {form.processing ? '提交中...' : '注册'}
            </button>
        </form>
    );
}
```

### 8.3 Vue/React 中的 API 对比

两种前端框架的 API 几乎完全一致：

| API | Vue | React |
|-----|-----|-------|
| 创建表单 | `useForm(method, url, data)` | `useForm(method, url, data)` |
| 设置数据 | `form.name = 'value'` / `v-model` | `form.setData('name', 'value')` |
| 验证字段 | `form.validate('field')` | `form.validate('field')` |
| 获取错误 | `form.errors.field` | `form.errors.field` |
| 检查错误 | `form.invalid('field')` | `form.invalid('field')` |
| 检查有效 | `form.valid('field')` | `form.valid('field')` |
| 提交表单 | `form.submit()` | `form.submit()` |
| 处理状态 | `form.processing` | `form.processing` |
| 重置表单 | `form.reset()` | `form.reset()` |

---

## 九、自定义验证规则与错误消息

### 9.1 在服务端自定义规则

Precognition 使用标准的 Laravel 验证规则，因此所有自定义规则天然支持：

```php
use Illuminate\Support\Facades\Validator;

public function store(Request $request)
{
    $validator = Validator::make($request->all(), [
        'username' => [
            'required',
            'string',
            'min:3',
            'max:20',
            'regex:/^[a-zA-Z0-9_]+$/',
            Rule::unique('users', 'username'),
        ],
        'phone' => [
            'required',
            'string',
            function ($attribute, $value, $fail) {
                // 自定义闭包验证规则
                if (!$this->isValidChinesePhone($value)) {
                    $fail('请输入有效的中国大陆手机号码。');
                }
            },
        ],
    ]);

    if ($validator->fails()) {
        // Precognition 中间件会自动处理这个异常
        // 无需手动处理
        return back()->withErrors($validator);
    }

    // 正常业务逻辑...
}

private function isValidChinesePhone(string $phone): bool
{
    return (bool) preg_match('/^1[3-9]\d{9}$/', $phone);
}
```

### 9.2 自定义 FormRequest

使用 FormRequest 可以让验证逻辑更加整洁：

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'     => ['required', 'string', 'max:255'],
            'email'    => ['required', 'email', Rule::unique('users')],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'phone'    => ['required', 'regex:/^1[3-9]\d{9}$/'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required'     => '请填写您的姓名',
            'name.max'          => '姓名不能超过 :max 个字符',
            'email.required'    => '请填写邮箱地址',
            'email.email'       => '请输入有效的邮箱格式',
            'email.unique'      => '该邮箱已被注册，请直接登录或使用其他邮箱',
            'password.required' => '请设置密码',
            'password.min'      => '密码长度至少 :min 位',
            'password.confirmed'=> '两次输入的密码不一致',
            'phone.required'    => '请填写手机号码',
            'phone.regex'       => '请输入有效的中国大陆手机号',
        ];
    }
}
```

Controller 中使用：

```php
class RegisteredUserController extends Controller
{
    public function store(StoreUserRequest $request)
    {
        // 到达这里说明验证已通过
        $validated = $request->validated();

        $user = User::create([
            'name'     => $validated['name'],
            'email'    => $validated['email'],
            'password' => Hash::make($validated['password']),
            'phone'    => $validated['phone'],
        ]);

        auth()->login($user);

        return redirect()->route('dashboard');
    }
}
```

**重要提示：** 当使用 FormRequest 时，确保路由上应用了 `precognitive` 中间件，或者在 FormRequest 中手动处理 Precognition 请求。FormRequest 本身不会自动中断 Precognition 请求，中间件负责在验证通过后返回 `200` 而不执行后续业务逻辑。

### 9.3 多语言错误消息

```php
// resources/lang/zh_CN/validation.php
return [
    'required' => ':attribute 不能为空',
    'email'    => ':attribute 格式不正确',
    'unique'   => ':attribute 已经被占用',
    'min'      => [
        'string' => ':attribute 不能少于 :min 个字符',
    ],
    'max'      => [
        'string' => ':attribute 不能超过 :max 个字符',
    ],
    'confirmed'=> ':attribute 确认不匹配',

    'attributes' => [
        'name'                  => '姓名',
        'email'                 => '邮箱',
        'password'              => '密码',
        'password_confirmation' => '确认密码',
        'phone'                 => '手机号',
        'username'              => '用户名',
    ],
];
```

---

## 十、性能优化与防抖策略

### 10.1 为什么需要优化？

Precognition 的核心机制是「用户输入 → 发送请求 → 返回结果」，这意味着每个字段的每次变更都可能触发一个网络请求。如果用户快速输入或表单字段众多，短时间内可能产生大量请求，这不仅增加服务端负担，还可能因请求竞态导致错误信息显示不一致。

### 10.2 防抖（Debounce）策略

**在 Alpine.js 中：**

```html
<input
    type="text"
    x-model="form.name"
    x-on:input.debounce.500ms="form.validate('name')"
/>
```

这里 `debounce.500ms` 意味着用户停止输入 500ms 后才会触发验证请求。

**在 Vue 中：**

```vue
<script setup>
import { useForm } from 'laravel-precognition-vue';
import { useDebounceFn } from '@vueuse/core';

const form = useForm('post', '/register', { name: '', email: '' });

// 邮箱字段使用防抖
const debouncedValidateEmail = useDebounceFn(() => {
    form.validate('email');
}, 500);
</script>

<template>
    <input v-model="form.email" @input="debouncedValidateEmail" />
</template>
```

**在 React 中：**

```jsx
import { useCallback } from 'react';
import { useForm } from 'laravel-precognition-react';
import { debounce } from 'lodash-es';

function RegisterForm() {
    const form = useForm('post', '/register', { name: '', email: '' });

    // 使用 useCallback + debounce 避免每次渲染都创建新函数
    const debouncedValidateEmail = useCallback(
        debounce(() => form.validate('email'), 500),
        [form]
    );

    return (
        <input
            value={form.data.email}
            onChange={(e) => {
                form.setData('email', e.target.value);
                debouncedValidateEmail();
            }}
        />
    );
}
```

### 10.3 只验证已修改的字段

始终使用 `form.validate('field_name')` 而非验证整个表单，这样可以最小化服务端的计算量和网络传输量。

### 10.4 使用 change 事件而非 input 事件

对于大多数字段，使用 `change` 事件（失去焦点时触发）而非 `input` 事件（每次按键触发）可以大幅减少请求频率：

```html
<!-- 推荐：失去焦点时验证 -->
<input x-model="form.name" x-on:change="form.validate('name')" />

<!-- 不推荐：每次按键都验证 -->
<input x-model="form.name" x-on:input="form.validate('name')" />
```

唯一例外是需要「即时反馈」的场景，如用户名可用性检查，这时可以使用 `input` 事件配合防抖。

### 10.5 服务端优化

**缓存验证结果：**

对于代价高昂的验证操作（如唯一性检查），可以考虑缓存：

```php
public function rules(): array
{
    return [
        'email' => [
            'required',
            'email',
            Rule::unique('users', 'email')
                ->ignore($this->route('user')), // 编辑场景
        ],
    ];
}
```

**数据库查询优化：**

确保唯一性验证涉及的字段已建立索引：

```php
// database/migrations/xxxx_xx_xx_create_users_table.php
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('email')->unique(); // 索引！
    $table->string('username')->unique(); // 索引！
    $table->string('phone')->unique(); // 索引！
    $table->string('password');
    $table->timestamps();
});
```

### 10.6 禁用自动验证

如果你希望完全手动控制验证时机，可以禁用自动验证：

```javascript
// Vue
const form = useForm('post', '/register', { name: '', email: '' });

// 禁用自动验证
form.setValidationTimeout(false);

// 手动触发
form.validate('name');
```

---

## 十一、生产环境踩坑记录与解决方案

### 11.1 踩坑一：CSRF Token 导致 419 错误

**现象：** Precognition 请求返回 419 状态码（Page Expired）。

**原因：** 前端请求未携带 CSRF Token，或 Token 已过期。

**解决方案：**

确保前端 axios 或 fetch 实例正确配置了 CSRF Token：

```javascript
// axios 示例
import axios from 'axios';

axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
axios.defaults.headers.common['X-CSRF-TOKEN'] = document.querySelector(
    'meta[name="csrf-token"]'
).content;
```

对于 Precognition JS SDK，它通常会自动从 `meta` 标签获取 CSRF Token，确保你的布局文件包含：

```html
<meta name="csrf-token" content="{{ csrf_token() }}">
```

### 11.2 踩坑二：验证通过后业务代码仍然执行

**现象：** Precognition 请求验证通过后，Controller 中的业务逻辑（如创建用户、发送邮件）也被执行了。

**原因：** 路由未正确应用 `precognitive` 中间件，或者 Controller 中的验证逻辑没有正确使用 Laravel 的标准验证方式。

**解决方案：**

```php
// 确保路由或 Controller 使用了中间件
Route::post('/register', [RegisteredUserController::class, 'store'])
    ->middleware('precognitive');

// 确保使用 $request->validate() 或 FormRequest
// 而非手动 Validator::make() + if 判断
public function store(Request $request)
{
    $validated = $request->validate([...]); // ✓ 正确

    // 以下写法可能导致中间件无法正确拦截
    // $validator = Validator::make($request->all(), [...]);
    // if ($validator->fails()) { ... } // ✗ 不推荐
}
```

### 11.3 踩坑三：文件上传字段导致验证异常

**现象：** 包含文件上传字段的表单，Precognition 请求始终失败。

**原因：** Precognition 请求中包含文件字段，但请求体格式不正确。

**解决方案：** 对于文件上传字段，不要对其触发 Precognition 验证。可以在前端排除这些字段：

```javascript
const form = useForm('post', '/profile', {
    name: '',
    avatar: null, // 文件字段
});

// 验证时只验证文本字段
form.validate('name'); // ✓ 安全
// form.validate('avatar'); // ✗ 不要对文件字段使用
```

### 11.4 踩坑四：中间件顺序问题

**现象：** 自定义中间件（如频率限制、IP 过滤）与 Precognition 冲突。

**原因：** 中间件执行顺序不正确，导致 Precognition 请求在到达处理中间件之前就被拦截了。

**解决方案：**

在 Laravel 10 中调整 `Kernel.php` 中的中间件顺序：

```php
// 确保 precognitive 中间件在全局中间件中的适当位置
protected $middleware = [
    \App\Http\Middleware\TrustProxies::class,
    \Illuminate\Http\Middleware\HandleCors::class,
    // precognitive 中间件应在频率限制之前
    \Illuminate\Routing\Middleware\HandlePrecognitiveRequests::class,
    \Illuminate\Http\Middleware\ValidatePostSize::class,
    // ...
];
```

### 11.5 踩坑五：Session 冲突

**现象：** 在使用 Session 的场景下（如购物车、多步骤表单），Precognition 请求导致 Session 数据异常。

**原因：** Precognition 请求也会读写 Session，可能导致意外的副作用。

**解决方案：**

在 Precognition 请求中不执行与 Session 相关的业务逻辑：

```php
public function store(Request $request)
{
    $validated = $request->validate([
        'name'  => ['required', 'string'],
        'email' => ['required', 'email', 'unique:users'],
    ]);

    // 仅在非 Precognition 请求时执行
    if (!$request->isPrecognitive()) {
        $request->session()->put('user_data', $validated);
        // 发送邮件等副作用操作
        Mail::to($validated['email'])->send(new WelcomeMail());
    }

    return redirect()->route('dashboard');
}
```

### 11.6 踩坑六：Nginx 反向代理丢失 Header

**现象：** Precognition 请求到达 Laravel 后不被识别为预验证请求。

**原因：** Nginx 配置中未传递自定义 Header。

**解决方案：**

确保 Nginx 配置中包含：

```nginx
location ~ \.php$ {
    # ...
    proxy_set_header Precognition $http_precognition;
    proxy_set_header X-Precognition-Fields $http_x_precognition_fields;
    # 或者使用 fastcgi_pass 时：
    fastcgi_param PRECOGNITION $http_precognition;
}
```

---

## 十二、与 Inertia.js 配合使用

Inertia.js 是 Laravel 生态中构建 SPA 的另一种流行方案。虽然 Inertia 本身已提供了良好的表单处理能力（通过 `useForm`），但 Precognition 可以为 Inertia 表单带来额外的实时验证能力。

### 12.1 Inertia 的 useForm 与 Precognition

Inertia 的 `@inertiajs/vue3`（或 React 版本）的 `useForm` 本身支持服务端错误显示，但不支持实时验证。我们可以结合 Precognition JS SDK 来实现：

```vue
<script setup>
import { useForm } from 'laravel-precognition-vue-inertia';

const form = useForm('post', '/register', {
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
});

const submit = () => form.submit({
    preserveScroll: true,
    onSuccess: () => {
        // 注册成功后的处理
    },
});
</script>

<template>
    <form @submit.prevent="submit">
        <div>
            <input v-model="form.name" @change="form.validate('name')" />
            <span v-if="form.invalid('name')" class="text-red-500">
                {{ form.errors.name }}
            </span>
        </div>

        <div>
            <input v-model="form.email" @change="form.validate('email')" />
            <span v-if="form.invalid('email')" class="text-red-500">
                {{ form.errors.email }}
            </span>
        </div>

        <!-- 更多字段... -->

        <button :disabled="form.processing">注册</button>
    </form>
</template>
```

### 12.2 安装 Inertia + Precognition 适配器

```bash
# Vue
npm install laravel-precognition-vue-inertia

# React
npm install laravel-precognition-react-inertia
```

### 12.3 服务端无需任何更改

与 Inertia.js 配合使用时，服务端代码与前文完全相同，无需任何额外配置。`precognitive` 中间件会自动识别请求类型，并在预验证模式下返回 JSON 错误（而非 Inertia 页面）。

---

## 十三、最佳实践总结

经过上述完整的实战讲解，让我们总结一套 Laravel Precognition 的最佳实践：

### 13.1 何时使用 Precognition

**适合的场景：**

- 注册/登录表单（需要检查用户名、邮箱唯一性）
- 多步骤表单（每步切换前需要校验当前步骤）
- 包含复杂业务规则的表单（库存检查、优惠券验证等）
- 用户资料编辑（即时反馈提升体验）

**不适合的场景：**

- 简单的搜索框或过滤器（前端验证已足够）
- 后台管理系统的批量操作表单（用户体验优先级较低）
- 网络环境极差的场景（每次输入都发请求不现实）

### 13.2 开发规范

1. **验证规则统一管理：** 将验证规则集中在 FormRequest 或模型中，避免分散在多个 Controller 方法中。

2. **合理使用防抖：** 对于需要即时反馈的字段（用户名可用性），使用 300-500ms 防抖；对于不需要即时反馈的字段（地址、备注），使用 `change` 事件。

3. **只验证必要字段：** 使用 `form.validate('field_name')` 只验证用户正在编辑的字段，而非整个表单。

4. **错误消息本地化：** 为所有验证规则提供中文错误消息，提升用户体验。

5. **处理竞态条件：** 在快速输入场景下，后发的请求可能先返回，使用 AbortController 或类似机制取消过期请求。

6. **避免对文件字段使用：** 文件上传字段不参与 Precognition 验证，使用传统的提交后验证方式。

7. **测试覆盖：** 为 Precognition 端点编写 Feature 测试，模拟带有 `Precognition: true` Header 的请求：

```php
public function test_precognition_validates_email_uniqueness()
{
    User::factory()->create(['email' => 'taken@example.com']);

    $response = $this->postJson('/register', [
        'email' => 'taken@example.com',
    ], [
        'Precognition' => 'true',
    ]);

    $response->assertUnprocessable()
        ->assertJsonValidationErrors(['email']);
}

public function test_precognition_returns_ok_for_valid_data()
{
    $response = $this->postJson('/register', [
        'name'     => 'John Doe',
        'email'    => 'john@example.com',
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
    ], [
        'Precognition' => 'true',
    ]);

    $response->assertOk();
    // 验证用户未被创建
    $this->assertDatabaseMissing('users', ['email' => 'john@example.com']);
}
```

### 13.3 性能调优清单

- [ ] 所有文本输入字段使用 `change` 事件而非 `input` 事件
- [ ] 唯一性检查字段使用 500ms 以上防抖
- [ ] 数据库唯一性字段已建立索引
- [ ] 避免对整个表单调用 `validate()`，只验证单个字段
- [ ] 监控服务器日志，关注 Precognition 请求的响应时间
- [ ] 在高并发场景下考虑引入 Redis 缓存唯一性检查结果

### 13.4 安全注意事项

- Precognition 请求只运行验证逻辑，不执行业务代码，这本身是安全的
- 但唯一性检查可能泄露用户注册信息（如确认某个邮箱是否已注册），在安全敏感场景下需谨慎
- 建议对 Precognition 请求实施频率限制，防止被恶意利用来枚举用户信息

```php
Route::post('/register', [RegisteredUserController::class, 'store'])
    ->middleware([
        'precognitive',
        'throttle:60,1', // 每分钟最多 60 次请求
    ]);
```

---

## 结语

Laravel Precognition 是一个令人惊艳的功能，它从根本上改变了我们对表单验证的认知。通过将服务端验证能力无缝延伸到用户输入的每一刻，它让「实时校验」不再是 SPA 框架的专属特权，而是每一位 Laravel 开发者都能轻松实现的标配能力。

从简单的注册表单到复杂的多步骤业务流程，从 Livewire 到 Vue/React，Precognition 展现了极强的适应性和工程优雅性。更重要的是，它将验证逻辑集中在服务端，避免了前后端验证规则不一致的经典痛点，让代码更易维护、更值得信赖。

如果你还在为表单用户体验而苦恼，或者正在寻找一种更优雅的前后端校验方案，不妨在下一个项目中尝试 Laravel Precognition。它可能会让你重新思考「表单验证」这件事。

---

*本文基于 Laravel 11.x 编写，部分 API 细节可能随版本更新而变化，请以 [Laravel 官方文档](https://laravel.com/docs/precognition) 为准。*

---

## 相关阅读

- [Laravel + Inertia.js 实战：Vue 3/React 单页应用的全新全栈范式——对比传统 SPA 前后端分离的开发体验](/categories/Laravel/Laravel-Inertia-实战-Vue3-React-单页应用全新全栈范式-对比传统SPA前后端分离/)
- [Hotwire/Turbo 实战：Ruby on Rails 的前端哲学在 Laravel 中复用——Livewire vs Turbo 渐进增强路线对比](/categories/前端/Hotwire-Turbo-实战-Ruby-on-Rails前端哲学在Laravel中复用-Livewire-vs-Turbo渐进增强路线对比/)
- [PHP 8.5 Property Hooks 实战：计算属性与数据验证的声明式编程——替代 Accessor/Mutator 的底层原理与 Laravel 适配](/categories/Laravel/2026-06-04-php85-property-hooks-computed-properties-laravel/)
