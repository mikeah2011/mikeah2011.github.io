---

title: Laravel Sanctum 实战：SPA/API 令牌认证与移动端适配
keywords: [Laravel Sanctum, SPA, API, 令牌认证与移动端适配]
date: 2026-06-01 10:00:00
description: 本文从 Laravel 项目实战出发，系统讲解 Laravel Sanctum 在 SPA认证、API令牌、Cookie Session、CSRF、防跨域配置与移动端适配中的完整落地方案，覆盖 Web SPA 与 App 混合接入、Token 生命周期、多设备登录、刷新续签、权限 abilities、代理与 SameSite 踩坑排查，帮助团队搭建稳定、安全、易维护的认证体系。
tags:
- Laravel
- Sanctum
- API
- SPA
- 认证
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



Laravel 生态里一提到认证，很多人第一反应还是 Passport、JWT、甚至自己手搓中间件。但如果你的项目本质上是 Laravel 自家后端 + Vue / React SPA，或者是后台管理系统 + App / 小程序 / 第三方客户端混合接入，那么 Sanctum 往往是性价比最高、维护成本最低的方案。

我这几年在几个项目里踩过一圈坑：有的是前后端同域 SPA，用 Cookie 做会话认证；有的是给移动端、桌面端、脚本任务发 Personal Access Token；还有的是同一套用户体系既服务 Web，又服务 App，最后不得不同时兼容 Cookie 登录和 Token 登录。表面上看 Sanctum 很轻量，实际上真正落地时，涉及到 Session、CSRF、CORS、Token 能力控制、多设备登录、过期策略、退出策略、移动端安全存储、反向代理配置，稍微疏忽就会在测试环境一切正常、线上全员 419 / 401 / 跨域失败。

这篇文章不讲“安装完就能跑”的 Hello World，而是从真实实战视角，系统梳理 Laravel Sanctum 在 SPA、API、移动端混合场景中的设计与落地，并把我踩过的坑都摊开讲清楚。

---

## 一、为什么是 Sanctum：先讲清楚它解决什么问题

Laravel Sanctum 官方定位非常明确：

1. 为 SPA 提供基于 Laravel Session / Cookie 的认证；
2. 为简单 API 提供个人访问令牌（Personal Access Token）。

注意，这两个能力经常被新手混为一谈。Sanctum 不是单纯的“Token 包”，也不是完整 OAuth2 服务器。它其实是两套认证思路的统一入口：

- SPA 模式：浏览器仍然走 Cookie / Session，Sanctum 只是帮你识别“这是第一方前端发来的状态认证请求”；
- API Token 模式：客户端显式携带 Bearer Token，Sanctum 在 `personal_access_tokens` 表里校验哈希后的令牌。

### 1.1 Sanctum 与 Passport 的核心差异

项目选型时最常见的问题就是：为什么不用 Passport？

可以先给结论：

- 如果你要做 OAuth2 授权中心、第三方应用授权登录、标准化 `authorization_code` / `client_credentials` / `refresh_token` 流程，选 Passport；
- 如果你只是做自家前后端项目、后台 API、App 接口、内部系统认证，绝大多数场景选 Sanctum 更合适。

下面是我在项目中最常用的一张判断表：

| 对比项 | Sanctum | Passport |
|---|---|---|
| 适用场景 | Laravel 自家 SPA、移动端、内部 API | 标准 OAuth2 授权平台、第三方接入 |
| 学习/维护成本 | 低 | 高 |
| SPA 支持 | 非常合适，直接走 Cookie/Session | 不自然，属于“为了 OAuth 而 OAuth” |
| Token 类型 | Personal Access Token | Access Token + Refresh Token + Client |
| 第三方授权 | 不擅长 | 擅长 |
| 数据结构复杂度 | 低 | 高 |
| 开发体验 | 简洁直接 | 规范但偏重 |

### 1.2 一个常见误区：SPA 不等于前后端分离 API Token

很多团队一做 Vue/React，就条件反射想：前后端分离 = 登录成功返回 JWT / Token = 以后都带 Bearer Token。

这其实是把浏览器应用和移动端应用混为一类了。

对于浏览器内的第一方 SPA，如果后端就是 Laravel，本来就有成熟的 Session 认证机制，那么 Cookie + Session + CSRF 往往才是最安全、最省心的方案。原因很简单：

- Token 存在浏览器里，无论放 localStorage 还是 sessionStorage，都更容易受 XSS 影响；
- Cookie 可以设置 `HttpOnly`，前端 JS 读不到；
- Laravel 原生对 Session 体系支持极强，权限、中间件、登录态延续都顺手；
- Sanctum 已经帮你把 SPA 第一方域名识别这件事打通了。

所以我要先把立场说清楚：

- Web SPA：优先用 Sanctum 的 Cookie 认证模式；
- 移动端 / 第三方客户端 / 命令行工具：用 Sanctum 的 API Token 模式；
- 需要标准 OAuth2：才上 Passport。

### 1.3 我为什么在真实项目里从 Passport 回退到 Sanctum

这段经验很值得讲。早几年我在一个中后台 + 小程序 + App 的项目里，最初因为“认证要专业”“以后说不定要开放第三方接入”，一上来就选了 Passport。结果两个月后发现：

- Web 管理后台其实根本不需要 OAuth2，Cookie 登录已经足够；
- App 端也只是我们自己的客户端，不需要完整授权码模式；
- 开发同学要理解 client、secret、refresh token、scope、授权类型，心智成本很高；
- 线上排查问题时，表结构和流程都比实际需求复杂太多。

后来我们把 Web 端切回 Session，会话稳定性立刻变好；App 端换成 Sanctum Personal Access Token，自定义一个轻量 Refresh Token 表，系统复杂度直接降了一个量级。这个经历让我越来越坚定一个判断：**认证不是越重越专业，而是越贴合业务越专业。**

---

## 二、Sanctum 的整体工作模型

在 Laravel 项目里引入 Sanctum 后，通常会有这样的写法：

```php
Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
```

看起来统一是 `auth:sanctum`，但内部其实会做两层尝试：

1. 先尝试 Session/Cookie 认证：如果请求来自配置好的第一方 SPA 域名，且携带了 Laravel Session Cookie，那么它会像普通网页登录一样认证用户；
2. 如果没有 Cookie，再尝试 Bearer Token：从 `Authorization: Bearer ***` 中解析 Token，并查库验证。

这也是 Sanctum 最舒服的地方：同一个接口保护中间件，既能服务浏览器 SPA，也能服务 App / Postman / 内部脚本。

但舒服的背后就是“隐式复杂度”——很多坑都来自你以为只是在配 Token，实际上 Session、Cookie、CSRF、CORS 都被卷进来了。

### 2.1 一个统一中间件背后的两条认证通路

你可以把 Sanctum 理解成一个“先看请求来源、再决定认证方式”的门卫：

- 对第一方前端：优先按有状态会话来理解；
- 对纯 API 客户端：按无状态 Bearer Token 来理解。

这种设计最大的价值在于它没有强行要求所有客户端都走同一种认证策略。换句话说，Sanctum 的设计哲学不是“世界统一成 JWT”，而是“**用 Laravel 最擅长的方式服务不同客户端**”。

### 2.2 实战里一定要画清楚认证边界

我在团队协作时会先明确三种客户端：

1. **第一方浏览器 SPA**：例如管理后台、用户中心 Web；
2. **第一方移动端**：iOS / Android / 桌面应用；
3. **机器调用方**：脚本、队列回调、内部服务、第三方服务端。

对应策略：

- 第一方浏览器 SPA -> Session / Cookie；
- 第一方移动端 -> Personal Access Token；
- 机器调用方 -> Personal Access Token，必要时单独建服务账户。

边界先画清楚，后面权限、设备管理、过期策略才不会乱。

---

## 三、安装与基础配置：别只会 composer require

先给出 Laravel 11/12 时代相对通用的安装思路。不同版本目录结构略有差异，但核心一致。

### 3.1 安装 Sanctum

```bash
composer require laravel/sanctum
php artisan vendor:publish --provider="Laravel\Sanctum\SanctumServiceProvider"
php artisan migrate
```

迁移后会生成 `personal_access_tokens` 表，用于存储 API Token。

### 3.2 User 模型启用 HasApiTokens

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];
}
```

这个 trait 不只是多了个 `createToken()`，它还挂上了 token 关系、能力判断等一整套能力。

### 3.3 Sanctum 配置文件重点项

`config/sanctum.php` 里最关键的几个配置我建议你认真看，而不是默认就过：

```php
return [
    'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
        '%s%s',
        'localhost,localhost:3000,127.0.0.1,127.0.0.1:8000,::1',
        Sanctum::currentApplicationUrlWithPort()
    ))),

    'guard' => ['web'],

    'expiration' => null,

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    'middleware' => [
        'authenticate_session' => Laravel\Sanctum\Http\Middleware\AuthenticateSession::class,
        'encrypt_cookies' => Illuminate\Cookie\Middleware\EncryptCookies::class,
        'validate_csrf_token' => Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class,
    ],
];
```

几个重点：

- `stateful`：哪些域名被视为“第一方 SPA”，这决定 Cookie 认证能否生效；
- `guard`：通常就是 `web`；
- `expiration`：只影响 API Token，不影响基于 Session 的 SPA 登录；
- `token_prefix`：部分安全合规场景可用于标识 Token 来源。

### 3.4 `.env` 常见配置

```dotenv
APP_URL=https://api.example.com
FRONTEND_URL=https://app.example.com

SESSION_DRIVER=redis
SESSION_DOMAIN=.example.com
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax

SANCTUM_STATEFUL_DOMAINS=app.example.com,api.example.com,localhost:5173,127.0.0.1:5173
```

如果你是跨子域 SPA，例如：

- 前端：`app.example.com`
- 后端：`api.example.com`

那么 `SESSION_DOMAIN=.example.com` 通常是关键配置。不配这个，Cookie 大概率种不到你以为的范围里。

### 3.5 Laravel 11 以后中间件注册要格外注意

Laravel 11 之后很多项目用了新的 `bootstrap/app.php` 方式注册中间件，一些老教程还停留在 `Kernel.php`。结果很多人照抄下来，以为 Sanctum 没生效，实际上是中间件链没挂对。

常见要点是：

- API 路由是否正确走了需要的中间件组；
- CORS 是否在请求进入业务前就处理掉；
- Session 相关中间件有没有在 SPA 模式链路中生效。

所以别只会“装包 + 迁移”，**框架版本差异本身就是 Sanctum 排障的一部分**。

---

## 四、SPA Cookie 认证原理：不是“发个 token”那么简单

Sanctum 在 SPA 模式下，本质上还是 Laravel 传统 Web 认证，只不过适配了 XHR / fetch 请求。

### 4.1 SPA 登录的完整链路

标准流程通常是这样的：

1. 前端先请求 `/sanctum/csrf-cookie`；
2. 后端下发 `XSRF-TOKEN` Cookie 和 Session Cookie；
3. 前端再调用 `/login` 提交账号密码；
4. 登录成功后，Laravel 把用户 ID 写入 Session；
5. 之后前端每次带上 Cookie 请求受保护接口；
6. `auth:sanctum` 通过 Session 识别当前用户。

这个流程里有两个 Cookie 容易混：

- `laravel_session`：真正的会话身份；
- `XSRF-TOKEN`：给前端读取后带到 `X-XSRF-TOKEN` 请求头里做 CSRF 校验。

### 4.2 为什么先打 `/sanctum/csrf-cookie`

很多前端同学觉得这步“很奇怪”，甚至把它删掉，结果登录接口直接 419。

原因是：

- Laravel 对会修改服务端状态的请求默认做 CSRF 校验；
- SPA 使用 Ajax 发登录请求时，也必须带 CSRF Token；
- `/sanctum/csrf-cookie` 的作用就是让服务端先发一个 CSRF Token Cookie 给前端。

Axios 典型配置如下：

```ts
import axios from 'axios'

const http = axios.create({
  baseURL: 'https://api.example.com',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
  },
})

export async function login(email: string, password: string) {
  await http.get('/sanctum/csrf-cookie')

  await http.post('/login', {
    email,
    password,
  })

  const { data } = await http.get('/api/user')
  return data
}
```

这里有两个不可少的点：

- `withCredentials: true`：否则浏览器不会携带跨域 Cookie；
- 先请求 `/sanctum/csrf-cookie`。

### 4.3 后端路由设计示例

```php
<?php

use App\Http\Controllers\AuthController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login'])->middleware('guest');
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth');

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/api/user', [AuthController::class, 'me']);
    Route::get('/api/dashboard', fn () => response()->json([
        'message' => 'ok',
    ]));
});
```

控制器示例：

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials, $request->boolean('remember'))) {
            throw ValidationException::withMessages([
                'email' => ['账号或密码错误'],
            ]);
        }

        $request->session()->regenerate();

        return response()->json([
            'message' => '登录成功',
            'user' => $request->user(),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json($request->user());
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([
            'message' => '已退出登录',
        ]);
    }
}
```

### 4.4 SPA Cookie 模式下的认证优势

这套方案有几个很现实的好处：

1. 前端不需要自己保存 access token；
2. Cookie 可 HttpOnly，XSS 风险面更小；
3. 与 Laravel `web` Guard 天然一致；
4. 用户登录、退出、Remember Me、Session 失效机制都能复用；
5. 后续接入后台管理、权限系统、审计日志更顺滑。

### 4.5 Browser、Cookie、CSRF 三者之间的真正关系

很多人把 Sanctum SPA 模式理解成“后端给前端一个 Token 再校验”，这会导致调试方向全错。更准确的理解应该是：

- **身份本体是 Session**；
- **Cookie 是会话载体**；
- **CSRF Token 是防跨站请求伪造的补充机制**；
- **Sanctum 只是把第一方 SPA 请求纳入 Laravel 传统 Session 认证体系。**

一旦你接受这个模型，很多问题就不难了：

- 419 往往是 CSRF 问题；
- 401 往往是 Session 或 Cookie 没成功带上；
- 跨域失败往往是 CORS 或 Cookie 策略问题；
- 与其纠结“为什么没有 access token”，不如去看浏览器到底有没有正确保存和发送 Cookie。

---

## 五、SPA 模式最容易踩的坑：419、跨域、代理、SameSite

如果说 Sanctum 最折磨人的地方是什么，我会毫不犹豫地说：不是代码，而是环境。

### 5.1 坑一：本地能登录，线上 419

这是最经典的坑。通常原因有几个：

#### 原因 A：没有 `withCredentials`

表现：

- `/sanctum/csrf-cookie` 返回 204；
- `/login` 直接 419；
- 浏览器 Network 里看不到 Cookie 被带上。

解决：

```ts
axios.defaults.withCredentials = true
```

#### 原因 B：CORS 没允许凭证

Laravel 的 `config/cors.php` 至少要保证：

```php
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'login', 'logout'],
    'allowed_methods' => ['*'],
    'allowed_origins' => ['https://app.example.com'],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => true,
];
```

注意：

- 一旦 `supports_credentials = true`，`allowed_origins` 就不要再图省事写 `*`；
- 否则浏览器会直接拦掉。

#### 原因 C：`SANCTUM_STATEFUL_DOMAINS` 没配对

例如你线上前端是：

```dotenv
SANCTUM_STATEFUL_DOMAINS=app.example.com
```

但实际请求来自：

- `www.app.example.com`
- `app.example.com:443`
- `https://app.example.com`

这里任何一个不匹配，都可能导致 Sanctum 不把请求识别为第一方 SPA。

实战建议：

- 只写 host[:port]，不要带协议；
- 本地开发端口要单独列出；
- 生产前在浏览器里核实真实 Origin。

### 5.2 坑二：反向代理后 Cookie Secure 丢失

我踩过一个非常隐蔽的问题：

- Nginx 外层终止 HTTPS；
- PHP-FPM 收到的是 HTTP；
- Laravel 误以为当前不是 HTTPS；
- 结果 `Secure` Cookie 行为异常，或 URL 生成错误。

这时需要正确配置受信任代理，例如：

```php
<?php

namespace App\Http\Middleware;

use Illuminate\Http\Middleware\TrustProxies as Middleware;
use Illuminate\Http\Request;

class TrustProxies extends Middleware
{
    protected $proxies = '*';

    protected $headers =
        Request::HEADER_X_FORWARDED_FOR |
        Request::HEADER_X_FORWARDED_HOST |
        Request::HEADER_X_FORWARDED_PORT |
        Request::HEADER_X_FORWARDED_PROTO |
        Request::HEADER_X_FORWARDED_AWS_ELB;
}
```

Nginx 也要把 `X-Forwarded-Proto` 透传过去。

### 5.3 坑三：SameSite 配错，子域跨站请求失效

一般跨子域 SPA，我优先尝试：

```dotenv
SESSION_SAME_SITE=lax
SESSION_DOMAIN=.example.com
```

如果你的前后端已经不是“同站点”关系，比如一个在主域，一个在完全不同域名，那 Cookie 策略会复杂很多，常常需要：

```dotenv
SESSION_SAME_SITE=none
SESSION_SECURE_COOKIE=true
```

但 `SameSite=None` 必须配合 HTTPS，否则现代浏览器直接拒收 Cookie。

### 5.4 坑四：把 `/login` 放到 api.php 里又套了错误中间件

一些项目为了“统一 API 风格”，把登录路由也扔进 `routes/api.php`，然后使用 API 中间件组。这本身不是绝对不行，但要清楚：

- SPA Cookie 模式依赖 Session、CSRF；
- 如果你把相关中间件链搞丢了，Sanctum 的体验会非常诡异。

我的建议很简单：

- 浏览器登录相关路由，尽量按 Web 认证思路组织；
- 业务数据接口再统一放到 `auth:sanctum` 下。

### 5.5 坑五：前端框架代理把 Cookie 代理没了

这类坑在 Vite、Webpack Dev Server、本地反向代理场景里非常常见。表现通常是：

- 请求从前端 dev server 发到后端时看起来路径没问题；
- 但浏览器里 Cookie 域名、路径、跨域策略全乱了；
- 本地用代理时正常，线上直连反而不正常，或者反过来。

我后来总结出一条经验：**本地开发如果要模拟生产行为，尽量让前端和后端域名、协议、端口关系尽可能接近真实环境。** 过度依赖 dev proxy，会把很多 Cookie 问题藏起来，等到预发或线上才集中爆炸。

### 5.6 坑六：CDN / WAF 修改头部导致 CSRF 诡异失效

有些云防护产品会对头部做清洗，尤其在安全规则较严时，可能把你以为会透传的某些头部处理掉。曾经我遇到过一个案例：浏览器里 `X-XSRF-TOKEN` 明明发出去了，服务端就是收不到，最后定位到网关层把某些编码形式的头部重写掉了。

经验是：

- 先在浏览器 Network 看请求；
- 再在网关层抓包或看访问日志；
- 最后在 Laravel 入口打印关键头部；
- 不要一上来就怀疑 Sanctum 源码。

---

## 六、API Token 机制：给移动端、脚本、第三方客户端用

当客户端不是浏览器第一方 SPA，而是：

- iOS / Android App
- Electron 客户端
- CLI 工具
- 内部自动化脚本
- 第三方服务端调用

这时就应该用 Sanctum 的 Personal Access Token 机制。

### 6.1 创建 Token 的基本写法

```php
$token = $user->createToken('mobile-iphone-15')->plainTextToken;
```

如果带 abilities：

```php
$token = $user->createToken('mobile-iphone-15', [
    'orders:read',
    'orders:create',
    'profile:update',
])->plainTextToken;
```

这里有一个关键点：`plainTextToken` 只会在创建当下返回一次。

数据库里保存的是哈希值，不可逆。也就是说如果客户端丢了，只能重新签发，不能“从数据库查回来再告诉客户端”。

### 6.2 登录接口设计：面向移动端签发 Token

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use App\Models\User;

class MobileAuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:255'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['账号或密码错误'],
            ]);
        }

        $token = $user->createToken($data['device_name'], [
            'profile:read',
            'profile:update',
            'orders:read',
        ]);

        return response()->json([
            'token_type' => 'Bearer',
            'access_token' => $token->plainTextToken,
            'user' => $user,
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json([
            'message' => '当前设备已退出',
        ]);
    }
}
```

客户端之后带：

```http
Authorization: Bearer 1|xxxx...
```

### 6.3 Sanctum Token 表结构理解

`personal_access_tokens` 表通常包含这些关键信息：

- `tokenable_type` / `tokenable_id`：令牌属于哪个模型；
- `name`：令牌名称，常用于标识设备；
- `token`：哈希后的 Token；
- `abilities`：JSON 数组；
- `last_used_at`：最近使用时间；
- `expires_at`：可选的过期时间。

实战里，`name` 不要随便写“default”，它非常适合存设备标识，比如：

- `ios-zhangsan-iphone15`
- `android-mi14pro`
- `macbook-admin-cli`

这样排查线上问题时非常直观。

### 6.4 Token 校验链路到底发生了什么

Sanctum 的 Bearer Token 大致会按如下逻辑工作：

1. 从 `Authorization` 头取出 Bearer Token；
2. 拆出前缀 ID 和明文 Token 片段；
3. 用明文部分做哈希；
4. 查 `personal_access_tokens` 表；
5. 判断是否存在、是否过期、是否属于合法模型；
6. 将对应 user 解析为当前认证用户。

也因为它是查库型 Token，所以跟 JWT 不同，Sanctum 在服务端吊销 Token 非常直接，不需要维护额外黑名单。这是它在企业内部系统场景里非常好用的原因之一。

### 6.5 Bearer Token 模式的优点与代价

优点：

- 非浏览器客户端接入简单；
- 服务端容易吊销、审计、绑定设备；
- 能力边界清晰；
- 与 Laravel 用户模型贴合。

代价：

- 你自己要处理客户端安全存储；
- 要自己设计过期和刷新策略；
- 多设备并发、续签一致性都要考虑。

---

## 七、移动端 Token 管理：别把 localStorage 思维照搬到 App

移动端接入 Sanctum，真正难的不是登录，而是 Token 生命周期管理。

### 7.1 Token 存哪里

不同端建议：

- iOS：Keychain
- Android：EncryptedSharedPreferences / Keystore
- Flutter / React Native：优先用安全存储插件，别直接 AsyncStorage
- 桌面端：系统凭据管理器优先，其次加密本地存储

不要把敏感 Token 明文落在：

- 普通 SharedPreferences
- 明文 sqlite
- 可轻易导出的本地配置文件

### 7.2 Token 与设备绑定的实践

我比较推荐登录时把设备信息一起上报：

```json
{
  "email": "dev@example.com",
  "password": "secret",
  "device_name": "ios-iphone15pro-ios18"
}
```

然后后端把以下信息额外记到自定义表或扩展 token 元数据中：

- 设备名
- 设备系统版本
- App 版本
- Push Token / Device ID（如合规允许）
- 最后登录 IP
- 最后活跃时间

Sanctum 原生 `personal_access_tokens` 表字段有限，如果你对设备治理要求更高，建议额外建表：

```php
Schema::create('user_devices', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('device_name');
    $table->string('platform')->nullable();
    $table->string('app_version')->nullable();
    $table->string('device_identifier')->nullable()->index();
    $table->timestamp('last_seen_at')->nullable();
    $table->ipAddress('last_ip')->nullable();
    $table->timestamps();
});
```

### 7.3 不要把长期有效 Token 当“免登录魔法”

很多项目上线初期图省事，给移动端发一个永不过期 Token。短期爽，后期一定反噬：

- 用户换手机，旧设备仍然永久可用；
- Token 泄漏后无法自动收敛风险；
- 安全审计时无法解释“为什么这个半年未活跃 Token 还能访问订单接口”。

更合理的思路是：

- Access Token 有生命周期；
- 长期登录依赖刷新机制或重新签发策略；
- 支持服务端主动吊销设备 Token。

### 7.4 App 启动阶段的 Token 使用时机很关键

我见过不少客户端实现是：

1. App 启动；
2. 立刻读本地 Token；
3. 立刻并发请求首页、消息、订单、用户信息；
4. 如果其中一个 401，再触发刷新；
5. 最后整个状态机一团乱。

更稳的策略是：

- 启动后先做一次认证态恢复；
- 判断 Access Token 是否即将过期；
- 必要时先刷新，再放行业务请求；
- 所有请求走统一拦截器和统一 Token 仓库。

这看似是客户端问题，但实际上决定了你后端的刷新接口会不会被打爆。

### 7.5 设备标识别滥用硬件唯一 ID

有些团队为了“绑定设备”，喜欢直接使用手机硬件唯一标识。这在合规和隐私层面都有风险，也容易引发平台审核问题。我的经验是：

- 绝大多数业务只需要一个“安装实例级”的设备标识；
- 可以由 App 首次安装时随机生成并安全保存；
- 真正的设备感知依赖多维信息综合判断，而不是执着于不可变硬件 ID。

---

## 八、abilities / scopes：Sanctum 的权限颗粒度怎么设计

虽然很多文章喜欢把 Sanctum 的 abilities 叫 scopes，但严格说 Sanctum 文档里更常用 `abilities`。概念上可以理解成轻量级 scope。

### 8.1 创建带 abilities 的 Token

```php
$token = $user->createToken('android-mi14', [
    'profile:read',
    'profile:update',
    'address:read',
    'address:write',
    'orders:read',
])->plainTextToken;
```

### 8.2 在接口中校验 ability

```php
Route::middleware(['auth:sanctum', 'abilities:orders:read'])->group(function () {
    Route::get('/api/orders', [OrderController::class, 'index']);
});

Route::middleware(['auth:sanctum', 'ability:profile:update'])->put('/api/profile', [ProfileController::class, 'update']);
```

也可以在代码中判断：

```php
public function update(Request $request)
{
    if (! $request->user()->tokenCan('profile:update')) {
        abort(403, '当前令牌无权修改资料');
    }

    // ...
}
```

### 8.3 设计 abilities 的经验

我踩过两个极端：

- 极端一：只发 `*`，所有 Token 全权限；
- 极端二：把能力拆到过细，导致维护爆炸。

后来我总结出一个比较稳妥的原则：

#### 原则 1：按业务资源 + 动作命名

例如：

- `orders:read`
- `orders:create`
- `orders:refund`
- `profile:update`
- `admin:dashboard`

#### 原则 2：不要把 Web 后台 RBAC 完整复制成 abilities

abilities 更适合客户端令牌能力边界，不是完整后台权限系统的替代品。

也就是说：

- 后台管理员权限：仍建议用角色/权限表；
- API Token 可访问哪些接口：再用 abilities 作为第二层约束。

#### 原则 3：SPA Cookie 模式下 `tokenCan()` 的特殊性要知道

这是很多人第一次看到会愣住的点：

- 对于通过 Session / Cookie 认证的第一方 SPA 请求，Sanctum 默认会认为它“有能力执行能力检查”，以便你在策略中统一调用；
- 但这不意味着你可以拿 abilities 替代用户权限系统。

所以在 Web SPA 场景里，真正控制权限的仍然应该是：

- 用户角色
- Policy / Gate
- 业务权限表

而不是单靠 token abilities。

### 8.4 我推荐的一套能力划分方式

如果是电商或 SaaS 后台，我通常按三层划分：

1. **公开客户端能力**：例如 `profile:read`、`order:read-self`；
2. **运维或内部工具能力**：例如 `job:retry`、`ops:dashboard`；
3. **集成能力**：例如 `webhook:send`、`inventory:sync`。

这样做的好处是：

- 令牌能力能快速看懂用途；
- 不会和后台用户角色严重混淆；
- 审计时很容易发现越权令牌。

### 8.5 abilities 最好配合服务端业务校验，而不是孤立使用

比如一个 Token 有 `orders:read`，也不代表它就可以查看任何订单。你仍然应该在业务层做：

- 是否为当前用户自己的订单；
- 是否属于当前租户；
- 是否在允许访问的门店范围内；
- 是否满足数据脱敏策略。

abilities 是“粗粒度闸门”，不是全部安全控制。

---

## 九、多设备登录：如何优雅地管理“当前设备”和“所有设备”

Sanctum 的一个实战高频需求是：

- 用户能同时登录手机、平板、网页；
- 用户可以“退出当前设备”；
- 用户可以“踢掉其他设备”；
- 管理员必要时可以吊销全部 Token。

### 9.1 退出当前设备

API Token 模式最简单：

```php
public function logoutCurrentDevice(Request $request): JsonResponse
{
    $request->user()->currentAccessToken()?->delete();

    return response()->json(['message' => '当前设备已退出']);
}
```

SPA Cookie 模式则是销毁当前 Session：

```php
public function logoutWeb(Request $request): JsonResponse
{
    auth('web')->logout();
    $request->session()->invalidate();
    $request->session()->regenerateToken();

    return response()->json(['message' => 'Web 会话已退出']);
}
```

### 9.2 退出所有 API 设备

```php
public function logoutAllDevices(Request $request): JsonResponse
{
    $request->user()->tokens()->delete();

    return response()->json([
        'message' => '已注销所有 API 设备',
    ]);
}
```

如果你还维护了独立设备表，也记得同步清理设备状态。

### 9.3 踢掉除当前设备外的其它设备

```php
public function logoutOtherDevices(Request $request): JsonResponse
{
    $currentTokenId = $request->user()->currentAccessToken()?->id;

    $request->user()->tokens()
        ->when($currentTokenId, fn ($query) => $query->where('id', '!=', $currentTokenId))
        ->delete();

    return response()->json([
        'message' => '其他设备已下线',
    ]);
}
```

### 9.4 Web Session 与 API Token 混合场景的坑

真实项目里，用户往往同时有：

- 浏览器会话（Session）
- 手机 Token
- 平板 Token
- 内部脚本 Token

这时候“退出所有登录设备”到底是什么意思？

我一开始犯过一个错误：接口里只写了：

```php
$request->user()->tokens()->delete();
```

结果产品说“为什么网页上还没退出？”——因为你删掉的是 API Token，不是 Web Session。

所以后来我会把退出语义拆清楚：

- `退出当前设备`：删除当前 Token 或当前 Session；
- `退出所有 App 设备`：删除所有 Sanctum Tokens；
- `退出所有网页登录`：清理所有 Session（如果用数据库 / Redis Session，需要额外能力）；
- `安全退出全部设备`：同时清 Session 与 Tokens。

如果你们有全局安全中心，建议把这几类动作拆成不同按钮，不要混着说。

### 9.5 Session 驱动不同，退出所有网页登录的实现难度也不同

这个问题很多人一开始没意识到。若你用的是：

- `file` session：很难按用户维度清理所有会话；
- `database` session：可通过会话表关联用户做清理；
- `redis` session：可通过规范 key 设计与索引做批量失效。

所以如果你的产品明确要求“查看并下线所有网页登录设备”，最好不要再用默认文件会话。**会话存储方案本身就是认证架构的一部分。**

### 9.6 多设备登录列表的一个实战实现思路

我通常会在“安全中心”展示两类设备：

1. Web 会话设备；
2. App / API Token 设备。

展示字段包括：

- 设备名称；
- 平台；
- 最后活跃时间；
- 最后 IP；
- 当前设备标识；
- 是否支持远程下线。

这能极大提升用户对账号安全的感知，也方便客服排查“为什么我在旧手机还能登录”的问题。

---

## 十、Token 过期与刷新：Sanctum 没有现成 Refresh Token，怎么办

这是 Sanctum 最常被追问的话题之一：Sanctum 有没有像 OAuth2 那样标准的 Refresh Token？

答案是：没有内建完整 Refresh Token 机制。它提供的是轻量令牌能力，你需要根据业务自己设计刷新策略。

### 10.1 先理解 `expiration` 能做什么

在 `config/sanctum.php`：

```php
'expiration' => 60 * 24 * 7,
```

通常单位是分钟。这个配置表示 Token 在创建多久后视为过期。

但要注意：

- 它影响的是 Sanctum Personal Access Token；
- 不影响 SPA 的 Session Cookie 登录；
- 对“如何续签”并没有给你完整答案。

### 10.2 三种常见刷新思路

#### 方案 A：短期 Token + 重新登录

适合内部系统、低频使用 App：

- Access Token 7 天过期；
- 过期后要求用户重新输入密码登录。

优点：实现简单。
缺点：用户体验一般。

#### 方案 B：滚动续签

思路是：

- 每次用户携带旧 Token 调用刷新接口；
- 校验当前 Token 仍有效；
- 签发新 Token；
- 删除旧 Token。

示例：

```php
public function refresh(Request $request): JsonResponse
{
    $user = $request->user();
    $currentToken = $user->currentAccessToken();

    abort_unless($currentToken, 401, '未找到当前访问令牌');

    $abilities = $currentToken->abilities ?? ['*'];
    $tokenName = $currentToken->name;

    $currentToken->delete();

    $newToken = $user->createToken($tokenName, $abilities);

    return response()->json([
        'token_type' => 'Bearer',
        'access_token' => $newToken->plainTextToken,
    ]);
}
```

优点：实现简单，接近 Refresh 效果。
缺点：并发下容易踩坑，后面我会专门讲。

#### 方案 C：自定义双 Token 体系

更稳妥的做法是自己实现：

- 短期 Access Token（Sanctum）
- 长期 Refresh Token（自定义表）

刷新时：

1. 客户端提交 Refresh Token；
2. 服务端校验哈希、设备、过期时间、撤销状态；
3. 签发新的 Sanctum Access Token；
4. 轮换 Refresh Token。

这种方案更复杂，但更适合：

- 金融、电商等高安全要求应用；
- 多端长期登录；
- 需要精确控制刷新行为的场景。

### 10.3 一个我踩得很深的坑：并发刷新导致全端 401

场景很真实：

- App 同时发出 5 个请求；
- 其中 3 个发现 Token 将过期，几乎同时调用 `/refresh`；
- 第一个请求刷新成功并删除旧 Token；
- 后两个请求拿着旧 Token 刷新，直接 401；
- 更糟糕的是客户端又把“失败结果”写回本地，导致最新 Token 被旧状态覆盖。

这类问题不是 Sanctum 特有，但用滚动续签时特别高发。

我的解决策略一般有三层：

#### 第一层：客户端单飞（single flight）

同一时刻只允许一个刷新动作进行，其它请求等待。

伪代码：

```ts
let refreshingPromise: Promise<string> | null = null

async function refreshTokenOnce() {
  if (!refreshingPromise) {
    refreshingPromise = actuallyRefreshToken()
      .finally(() => {
        refreshingPromise = null
      })
  }

  return refreshingPromise
}
```

#### 第二层：服务端短暂宽限窗口

如果你自定义了 Refresh Token 表，可以保留旧 Refresh Token 极短时间，防止网络抖动造成双击刷新全部失败。

#### 第三层：令牌版本号 / 乐观锁

把设备会话抽象成一条记录，Token 只是它的快照，刷新时通过版本号控制状态更新，避免旧响应覆盖新响应。

### 10.4 我更推荐的实战策略

对于普通业务系统，我倾向：

- Web SPA：Cookie Session，不讨论 Refresh Token；
- 移动端：Sanctum Access Token + 自定义 Refresh Token；
- 内部脚本：长周期 PAT，但配到期时间与后台吊销。

也就是说，不要强迫 Sanctum 独自承担一切认证生命周期问题。它适合作为 Access Token 层，而不是完整移动端授权体系的全部。

### 10.5 过期时间不只是安全问题，也是产品问题

很多团队只从安全角度讨论 Token 过期，却忽略了用户体验：

- 过短：用户频繁掉登录，投诉不断；
- 过长：设备丢失后风险暴露窗口太大；
- 没有刷新：每次都重新登录，转化率受影响；
- 刷新做得太激进：后端接口量暴涨。

我通常会和产品、客户端一起定这几个参数：

- Access Token 有效期；
- 刷新窗口；
- Refresh Token 有效期；
- 多久未活跃自动失效；
- 改密码后是否强制所有设备重新登录。

这些不是纯后端技术细节，而是完整认证策略的一部分。

---

## 十一、为移动端实现一套可落地的刷新体系

下面给一套我在项目里比较常用的实现草图。

### 11.1 Refresh Token 表设计

```php
Schema::create('refresh_tokens', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('device_name');
    $table->string('token_hash', 64)->unique();
    $table->timestamp('expires_at');
    $table->timestamp('last_used_at')->nullable();
    $table->timestamp('revoked_at')->nullable();
    $table->timestamps();
});
```

这里不要明文存 Refresh Token，建议只存哈希：

```php
$plainRefreshToken = Str::random(64);
$refreshTokenHash = hash('sha256', $plainRefreshToken);
```

### 11.2 登录时同时签发 Access Token + Refresh Token

```php
use Illuminate\Support\Str;
use Carbon\Carbon;

public function login(Request $request): JsonResponse
{
    $data = $request->validate([
        'email' => ['required', 'email'],
        'password' => ['required', 'string'],
        'device_name' => ['required', 'string'],
    ]);

    $user = User::where('email', $data['email'])->firstOrFail();

    if (! Hash::check($data['password'], $user->password)) {
        throw ValidationException::withMessages([
            'email' => ['账号或密码错误'],
        ]);
    }

    $accessToken = $user->createToken($data['device_name'], ['profile:read', 'orders:read']);

    $plainRefreshToken = Str::random(64);

    $refreshToken = $user->refreshTokens()->create([
        'device_name' => $data['device_name'],
        'token_hash' => hash('sha256', $plainRefreshToken),
        'expires_at' => Carbon::now()->addDays(30),
    ]);

    return response()->json([
        'token_type' => 'Bearer',
        'access_token' => $accessToken->plainTextToken,
        'refresh_token' => $plainRefreshToken,
        'expires_in' => 3600,
        'refresh_token_expires_at' => $refreshToken->expires_at,
    ]);
}
```

### 11.3 刷新接口

```php
public function refresh(Request $request): JsonResponse
{
    $data = $request->validate([
        'refresh_token' => ['required', 'string'],
        'device_name' => ['required', 'string'],
    ]);

    $hash = hash('sha256', $data['refresh_token']);

    $refreshToken = RefreshToken::query()
        ->where('token_hash', $hash)
        ->whereNull('revoked_at')
        ->where('expires_at', '>', now())
        ->first();

    abort_unless($refreshToken, 401, 'Refresh Token 无效或已过期');

    $user = $refreshToken->user;

    $user->tokens()
        ->where('name', $data['device_name'])
        ->delete();

    $newAccessToken = $user->createToken($data['device_name'], [
        'profile:read',
        'orders:read',
    ]);

    $newPlainRefreshToken = Str::random(64);

    $refreshToken->update([
        'token_hash' => hash('sha256', $newPlainRefreshToken),
        'last_used_at' => now(),
        'expires_at' => now()->addDays(30),
    ]);

    return response()->json([
        'token_type' => 'Bearer',
        'access_token' => $newAccessToken->plainTextToken,
        'refresh_token' => $newPlainRefreshToken,
        'expires_in' => 3600,
    ]);
}
```

这个实现虽然不是官方内建，但在工程上足够实用，且便于审计与吊销。

### 11.4 再往前走一步：刷新时加设备约束

如果你想更严谨，刷新时不应只校验 Refresh Token 是否存在，还应校验：

- 对应 `device_name` 是否匹配；
- 是否来自同一安装实例；
- 是否被服务端安全策略标记异常；
- 是否需要二次验证（如高风险环境）。

很多所谓“账号被顶掉”的诡异问题，最后都能追溯到刷新逻辑过于宽松。

### 11.5 刷新接口本身也是敏感接口

实际部署时，`/refresh` 最好也做一些保护：

- 频率限制；
- 风险设备识别；
- 关键字段审计日志；
- 必要时地理位置或 IP 变更告警。

因为只要刷新接口过于宽松，攻击者即使短暂拿到令牌，也能把会话延长到比你想象更久。

---

## 十二、同一套后端同时服务 SPA 与移动端，该怎么组织

这是我最推荐的 Sanctum 使用方式：一套后端，两条认证通道。

### 12.1 路由分层思路

- Web SPA 登录：`/sanctum/csrf-cookie` + `/login` + Cookie Session
- App 登录：`/api/mobile/login` 返回 Bearer Token
- 统一业务接口：`auth:sanctum`

例如：

```php
Route::post('/login', [WebAuthController::class, 'login']);
Route::post('/logout', [WebAuthController::class, 'logout'])->middleware('auth:sanctum');

Route::prefix('api/mobile')->group(function () {
    Route::post('/login', [MobileAuthController::class, 'login']);
    Route::post('/refresh', [MobileAuthController::class, 'refresh']);
    Route::post('/logout', [MobileAuthController::class, 'logout'])->middleware('auth:sanctum');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/api/user', [UserController::class, 'show']);
    Route::get('/api/orders', [OrderController::class, 'index']);
});
```

### 12.2 接口层统一，认证层按客户端分流

这样做的好处是：

- 业务接口大部分不需要关心客户端类型；
- 浏览器自然使用 Session；
- 移动端自然使用 Bearer Token；
- 统一走 `auth:sanctum`，权限判断逻辑可复用。

### 12.3 业务代码里识别当前认证方式

有时你需要知道当前请求是 Session 还是 Token 登录，可用：

```php
$currentToken = $request->user()?->currentAccessToken();

if ($currentToken) {
    // Token 模式：通常来自移动端 / 第三方客户端
} else {
    // Session 模式：通常来自 SPA Web
}
```

这个判断在审计日志里特别好用。

### 12.4 我建议给不同通道打上显式日志标签

例如在请求日志中增加：

- `auth_channel=session`
- `auth_channel=sanctum_token`
- `client_type=web/mobile/internal`

这样以后查问题时，你不会只看到一条“用户 10086 调了订单接口”，而能看到它究竟是：

- 浏览器 Cookie 会话发起；
- iPhone App Token 发起；
- 内部定时任务 Token 发起。

这类可观测性在项目规模上来后非常重要。

---

## 十三、生产环境安全建议：Sanctum 很轻，但别配得很轻率

### 13.1 Token 命名规范化

不要全部叫：

- `token`
- `default`
- `app`

建议带上设备语义：

```php
$deviceName = sprintf('%s-%s-%s', $platform, $deviceModel, $appVersion);
$user->createToken($deviceName, $abilities);
```

### 13.2 定期清理过期 Token

如果你启用了过期时间，最好配个计划任务清理：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Laravel\Sanctum\PersonalAccessToken;

class PurgeExpiredSanctumTokens extends Command
{
    protected $signature = 'sanctum:purge-expired';

    protected $description = '清理已过期的 Sanctum Tokens';

    public function handle(): int
    {
        $count = PersonalAccessToken::query()
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->delete();

        $this->info("已清理 {$count} 个过期 Token");

        return self::SUCCESS;
    }
}
```

再挂到调度器：

```php
Schedule::command('sanctum:purge-expired')->daily();
```

### 13.3 审计登录设备

建议记录：

- 登录时间
- 最后活跃时间
- IP
- User-Agent
- 设备名
- Token ID / Session ID
- 登录方式（Session / Token）

很多线上排障都靠这些信息。

### 13.4 XSS 防御不能因为用 Cookie 就放松

虽然 SPA Cookie 模式比 localStorage 存 Token 更稳，但它不代表你可以无视 XSS。因为一旦页面被注入恶意脚本，对方仍可能借当前会话发起敏感操作。

所以该做的仍要做：

- 输出转义
- CSP
- 富文本白名单
- 避免危险 `v-html` / `dangerouslySetInnerHTML`
- 严格第三方脚本治理

### 13.5 改密码、绑定手机、提升权限时要考虑令牌收敛

这是很多系统上线后才补的逻辑：

- 用户修改密码后，旧 Token 是否全部作废？
- 用户开通管理员权限后，旧 Token 是否需要重新签发以更新 abilities？
- 用户被风控命中后，是否需要立即让全部设备下线？

我通常会把这些安全事件统一接到一套“会话收敛”逻辑里：

- 删除所有 Personal Access Tokens；
- 标记所有 Refresh Token 失效；
- 清理关键 Session；
- 推送客户端重新登录。

### 13.6 对内部脚本 Token 做最小权限和生命周期控制

很多公司最危险的不是用户 Token，而是内部同学为了方便在 Jenkins、脚本、导数工具里放了一个全权限永久 Token。建议：

- 单独创建服务账户；
- abilities 最小化；
- 到期时间明确；
- 定期轮换；
- 不要把生产 Token 写死在仓库或 CI 日志里。

---

## 十四、真实踩坑记录：这些问题我都在线上或者准线上遇到过

这一节我按“现象 -> 原因 -> 修复”的方式总结，比较像排障手册。

### 14.1 坑：Postman 能调通，浏览器前端就是不行

**现象**：

- Postman 登录、带 Token 调接口都正常；
- 浏览器前端用 Sanctum SPA 模式时 419 / 未认证。

**原因**：

Postman 不受浏览器同源策略、Cookie 安全策略、CORS 限制影响。你在 Postman 调通只能证明后端接口逻辑没大问题，完全不能证明浏览器认证链路没问题。

**修复**：

- 浏览器里检查 `Set-Cookie` 是否成功；
- 检查请求头是否有 `X-XSRF-TOKEN`；
- 检查 CORS `supports_credentials`；
- 检查 `SANCTUM_STATEFUL_DOMAINS`。

### 14.2 坑：本地 localhost 正常，换成 127.0.0.1 就炸

**现象**：

- `http://localhost:5173` 正常；
- `http://127.0.0.1:5173` 不正常。

**原因**：

`localhost` 和 `127.0.0.1` 在 Cookie / stateful 域名识别上就是不同 host，Sanctum 不会帮你“脑补是一个意思”。

**修复**：

```dotenv
SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173
```

### 14.3 坑：移动端退出登录后，偶发还能继续访问接口

**现象**：

用户明明点了退出，下一次冷启动前居然偶发还能拉到数据。

**原因**：

通常是客户端本地缓存状态没清干净，或者多个请求并发时，旧 Token 还在飞行中。也可能是服务端只删了 Refresh Token，没删 Access Token。

**修复**：

- 服务端退出时删除当前 Access Token；
- 客户端先清本地 Token，再跳登录页；
- 对 401 做全局拦截，禁止旧页面继续请求；
- 对刷新与退出做互斥控制。

### 14.4 坑：把 abilities 当角色权限，最后维护失控

**现象**：

一开始只想限制移动端接口，后来后台管理、运营、仓储、客服全塞进 abilities，最后 Token 能力字符串几十个，没人敢动。

**原因**：

Sanctum abilities 被拿来替代完整权限系统。

**修复**：

- abilities 只管“这个令牌能不能访问这类 API”；
- 用户角色权限另走 RBAC / Policy；
- 两者不要混成一锅粥。

### 14.5 坑：使用全局 `tokens()->delete()` 误杀设备

**现象**：

用户只是想退出当前手机，结果平板、桌面端、测试机全被踢下线。

**原因**：

图省事直接：

```php
$request->user()->tokens()->delete();
```

**修复**：

只删 `currentAccessToken()`，或者按设备名、设备 ID 精准删除。

### 14.6 坑：Nginx / CDN 缓存了不该缓存的认证响应

**现象**：

偶发用户拿到不属于自己的资料，或者登录态判断异常混乱。

**原因**：

边缘缓存错误缓存了带用户态的接口响应。

**修复**：

- 所有需要认证的接口显式返回禁缓存头；
- CDN / 反向代理层对 `/api/user`、`/sanctum/*`、`/login`、`/logout` 等路径禁缓存；
- 不要让代理忽略 `Authorization` 和 `Cookie` 差异。

### 14.7 坑：客户端刷新成功了，但后端日志显示旧 Token 仍在打接口

**现象**：

日志里同一设备在刷新成功后，几秒内仍持续出现旧 Token 的请求。

**原因**：

客户端请求队列里已经排队了旧请求；网络层重试机制也可能重复发送旧头部。

**修复**：

- 请求发送前总是从“最新 Token 仓库”读值，而不是在初始化时缓存头；
- 刷新完成后重放失败请求，而不是盲目让所有旧请求继续飞；
- 统一封装 API Client，避免业务代码自己拼 Authorization 头。

### 14.8 坑：管理员手动删了数据库 Token，客户端体验极差

**现象**：

运营或客服直接在后台把 Token 删了，客户端下一次请求 401，用户只看到“网络错误”。

**原因**：

客户端没有把 401/419/403 做成清晰的认证态处理流。

**修复**：

- 明确区分网络错误与认证失效；
- 401 尝试刷新；
- 刷新失败则回登录页，并给出“登录已失效，请重新登录”的明确提示。

---

## 十五、我在项目里的推荐落地方案

如果你现在要做一个典型业务系统：

- 后台管理：Vue/React SPA
- 用户中心：H5 / Web
- 移动端：iOS / Android
- 后端：Laravel

我会这样选：

### 15.1 Web 端

- 使用 Sanctum SPA Cookie 认证；
- 登录流程：`/sanctum/csrf-cookie` -> `/login`；
- 权限控制：角色 + Policy/Gate；
- 不在浏览器 localStorage 中长期保存访问令牌。

### 15.2 移动端

- 使用 Sanctum Personal Access Token 作为 Access Token；
- 自定义 Refresh Token 表；
- Token 安全存储到 Keychain / Keystore；
- 登录设备管理可视化；
- 支持当前设备退出、其他设备下线、全设备失效。

### 15.3 运维与安全

- HTTPS 全站启用；
- 正确配置代理头；
- Redis / Database Session 可观测；
- 令牌过期清理任务常驻；
- 登录审计与设备审计落库。

这套方案的好处是：

- 浏览器端安全与体验兼顾；
- 移动端认证生命周期可控；
- 不会把整个系统绑到 OAuth2 的重型方案上；
- 绝大多数中后台、内容平台、电商、SaaS 都够用。

### 15.4 如果团队人少，我会怎么做取舍

现实一点讲，不是每个团队都有精力把认证做到“完美”。如果团队很小，我会按优先级这样落地：

1. Web 端先用 Cookie Session 跑稳；
2. 移动端先用有过期时间的 Sanctum Token；
3. 第二阶段再补 Refresh Token；
4. 第三阶段补设备管理、全局下线、安全中心；
5. 最后再做细粒度 abilities 审计和风控。

这样不会因为一开始想得太满，结果项目迟迟落不了地。

### 15.5 如果未来可能接第三方怎么办

也别过度设计。我的建议是：

- 先用 Sanctum 服务自家客户端；
- 真要开放第三方授权时，再单独引入 Passport 或外部 IdP；
- 不要因为“以后可能会开放”，就让今天所有业务都背上 OAuth2 的复杂度。

架构演进要为真实需求付费，而不是为想象中的需求付费。

---

## 十六、结语：Sanctum 不是“简化版 Passport”，而是更适合多数 Laravel 项目的正解

很多人第一次接触 Sanctum，会觉得它“有点轻”，仿佛不如 Passport 那么“专业”。但真正做过几轮项目后你会发现：

- 对第一方 Web SPA 来说，Cookie Session 本来就是正道，Sanctum 只是把它现代化；
- 对移动端 / 内部 API 来说，Personal Access Token 足够简单高效；
- 对复杂授权平台，再交给 Passport。

也就是说，Sanctum 的价值从来不在“功能最多”，而在于：它用最少的复杂度，解决了 Laravel 项目里最常见的认证问题。

最后总结一句我的实战建议：

1. 浏览器 SPA 优先走 Cookie，不要滥用 Bearer Token；
2. 移动端 Token 一定要设计生命周期，不要默认永久有效；
3. abilities 只做令牌边界，不要替代角色权限系统；
4. 多设备登录一定提前定义清楚“退出当前设备/其他设备/全部设备”的语义；
5. 真正难的不是 `composer require`，而是跨域、Cookie、代理、并发刷新这些工程细节。

如果你把这些问题在项目初期就设计清楚，Sanctum 会是一个非常稳、非常省心的认证方案；如果忽略这些细节，它也会以 419、401、跨域失败、移动端莫名掉登录的方式教育你。

这就是我对 Laravel Sanctum 的真实评价：

- 轻量，但绝不简单；
- 好用，但前提是你真的理解它。

## 相关阅读

- [API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践](/categories/05_PHP/Laravel/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [OAuth 2.0 实战：Laravel Passport 自定义 Grant Type 与第三方登录](/categories/05_PHP/Laravel/Laravel-Passport-OAuth2-自定义-Grant-Type-与第三方登录实战/)
- [敏感数据保护实战：加密存储、脱敏展示、审计日志合规——Laravel B2C API 多层防御踩坑记录](/categories/05_PHP/Laravel/敏感数据保护实战-加密存储脱敏展示审计日志合规-Laravel-B2C-API踩坑记录/)
