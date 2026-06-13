---

title: OAuth 2.0 实战：Laravel Passport 自定义 Grant Type 与第三方登录
keywords: [OAuth, Laravel Passport, Grant Type, 自定义, 与第三方登录]
date: 2026-06-01 09:00:00
tags:
- Laravel
- OAuth
- Passport
- PHP
- 认证授权
- Token
- 第三方登录
- Grant Type
description: 本文结合真实项目场景，系统讲解 OAuth 2.0 与 Laravel Passport 的落地实践，覆盖标准与自定义 Grant Type、微信/GitHub 第三方登录接入、Token 刷新与撤销、Scope 与 PKCE 安全策略，并对 Token 管理与认证授权方案做工程化对比，适合需要统一认证授权体系的 Laravel 团队参考。
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



我第一次在 Laravel 项目里真正把 OAuth 2.0 跑起来，不是为了“做一个标准的认证系统”，而是为了收拾一个已经逐渐失控的登录体系：App 用手机号验证码登录，管理后台还保留着账号密码，合作渠道要求接 GitHub 登录做开发者接入，海外站点要加 Google 登录，国内运营又希望未来兼容微信登录。最开始大家觉得这几个需求互不相关，于是各写各的：这里发一个 access token，那里存一个 session，第三方登录回调后再手搓一个 token 返回给前端。系统刚上线时看起来一切正常，直到用户体系打通、权限模型统一、开放平台要给第三方客户端发 token 的时候，问题一下子全冒出来了。

具体有多乱？同一个用户可能在 `users` 表里有一条记录，在 `social_accounts` 表里再绑三种 provider，后台登录和移动端登录的 token 生命周期完全不同；有些接口校验的是 Passport access token，有些接口又在读自定义表里的 API token；前端一刷新页面就拿着过期 token 打 API，返回 401 以后又不会自动 refresh；更坑的是，当时有个“快捷登录”需求，业务方说“不要验证码、不要密码，只要服务端确认这个第三方 openid 是可信的，就直接给 token”。这类需求如果继续沿用“每来一个需求就再补一个 if/else”的做法，迟早会把认证层做成一个谁都不敢动的黑盒。

后来我把整套体系收拢到 OAuth 2.0 + Laravel Passport 上，再根据业务扩展自定义 Grant Type，专门接第三方登录，并把刷新、撤销、审计一起补齐。整个过程并不算“照着文档抄一遍就结束”，恰恰相反，Passport 官方文档只解决了 30% 的问题，剩下 70% 都是落地时踩出来的：为什么自定义 grant 注册后始终返回 unsupported_grant_type？为什么第三方登录明明换到了 openid，却总是无法映射用户？为什么 refresh token 一直能用，撤销 access token 却没把 refresh token 一起废掉？为什么 Passport 升级之后 League OAuth2 Server 的命名空间又改了？

这篇文章我就按实战踩坑记录的方式，把这套方案从头到尾讲清楚。内容会覆盖 OAuth 2.0 四种标准 Grant Type 回顾、Laravel Passport 的安装与配置、自定义 Grant Type 的完整实现、微信/GitHub/Google 第三方登录接入、Token 刷新与撤销、安全最佳实践，以及我自己在线上遇到过的常见坑和解决方案。文章里的代码都按 Laravel + Passport 的真实项目结构来写，不追求“最短 demo”，而是尽量贴近实际可落地的工程实现。

<!-- more -->

## 一、先把问题讲透：为什么是 OAuth 2.0，而不是继续手写 Token

很多团队第一次接触 Passport，往往是因为“Laravel 官方推荐”，但如果你没先想清楚业务问题，Passport 很容易被用成一个更复杂的“发 token 工具”。我在项目里决定引入 OAuth 2.0，核心原因有三个：

1. **认证方式越来越多，必须统一协议层**
   - 账号密码登录
   - 手机验证码登录
   - 微信/GitHub/Google 第三方登录
   - 内部系统对内部系统的服务访问
   - 第三方合作方代表用户访问资源

2. **Token 生命周期管理必须标准化**
   - access token 要短效
   - refresh token 要可撤销
   - 不同客户端要能区分 client_id
   - scope 要能限制权限边界

3. **认证和业务解耦，否则每个接口都在重复造轮子**
   如果每种登录方式都直接调用 `Auth::login()` 然后自己生成 token，最后一定会出现：有的 token 可刷新，有的不可刷新；有的接口能识别第三方登录，有的不认；有的客户端 token 永不过期，谁也说不清风险边界。

OAuth 2.0 的价值不在于“高级”，而在于它把“客户端如何获得访问令牌”这件事抽象成了可扩展、可治理的协议模型。Passport 本质上是 Laravel 对 League OAuth2 Server 的一个封装，让我们可以在 Laravel 体系里比较顺手地搭出 OAuth 2.0 认证中心。

先给一张本文后面会反复引用的整体架构图：

```text
+-------------------+        +------------------------+
| Web / App / H5    |        | 第三方客户端 / 开放平台 |
| SPA / Mobile      |        | Partner Client         |
+---------+---------+        +-----------+------------+
          |                                  |
          | grant_type=password/social/wechat/github/google
          | refresh_token / revoke           |
          v                                  v
+----------------------------------------------------------+
|                 Laravel Passport Server                  |
|----------------------------------------------------------|
| /oauth/token                                             |
| /oauth/authorize                                         |
| 自定义 Social Grant / Wechat Grant                       |
| Client / Scope / Token / Refresh Token 管理             |
+------------------------+---------------------------------+
                         |
                         | UserRepository / SocialAccountRepository
                         v
+----------------------------------------------------------+
| MySQL                                                     |
| users / social_accounts / oauth_clients / oauth_* tables |
+----------------------------------------------------------+
```

后面的所有实现，都是围绕这张图展开：客户端通过不同的 grant_type 向 Passport 申请 token，Passport 再通过你自定义的用户校验逻辑，把外部身份映射成本地用户，最终发放统一的 access token 与 refresh token。

## 二、OAuth 2.0 四种标准 Grant Type 回顾：别一上来就自定义

很多人做自定义 Grant Type 的时候，实际上是因为没把标准 Grant Type 的适用边界想明白。先把这四种标准模式过一遍，后面你才知道“什么时候该扩展，什么时候该复用”。

### 2.1 Authorization Code Grant：最适合第三方网页登录授权

这是 OAuth 2.0 里最经典的一种模式。用户先被引导到授权服务器登录并确认授权，客户端获得一个授权码 code，再拿 code 换 access token。

适用场景：

- 第三方网站接入你的开放平台
- 需要用户显式授权
- 前后端分离 Web 应用配合 PKCE
- 对安全性要求高，不希望把用户密码交给客户端

交互流程：

```text
User -> Client: 点击“使用平台账号登录”
Client -> Authorization Server: 跳转 /oauth/authorize
Authorization Server -> User: 登录 + 授权确认
Authorization Server -> Client: redirect_uri?code=xxx
Client -> Authorization Server: POST /oauth/token (grant_type=authorization_code)
Authorization Server -> Client: access_token + refresh_token
```

Passport 开箱就支持 Authorization Code Grant。典型请求示例：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "3",
    "client_secret": "client-secret",
    "redirect_uri": "https://client.example.com/callback",
    "code": "SplxlOBeZQQYbYS6WxSbIA",
    "code_verifier": "x8J3K1..."
  }'
```

如果你的业务是“用户在第三方客户端显式同意授权”，那优先考虑这套，不要急着造一个自定义 grant。很多所谓“第三方登录需求”，其实只是想把第三方身份换成本地 token，这和开放平台授权并不是一回事。

### 2.2 Client Credentials Grant：机器对机器调用最省心

这一种不涉及最终用户，只有 client 自己拿着 client_id/client_secret 访问资源。典型场景是内部服务调用、队列消费者访问 API、运营后台服务同步数据。

示例：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "5",
    "client_secret": "client-secret",
    "scope": "report:read sync:write"
  }'
```

Laravel 里通常配合中间件做保护：

```php
Route::middleware(['client', 'scopes:report:read'])->group(function () {
    Route::get('/internal/reports/daily', [ReportController::class, 'daily']);
});
```

这里的坑是：**它代表的是客户端，不代表用户**。也就是说，如果你的接口有“当前登录用户”的语义，Client Credentials 根本不适合。很多团队误用它来代替后台用户登录，结果最后系统里根本查不到 user_id，只能到处补“系统用户”概念。

### 2.3 Password Grant：老项目迁移期常见，但要知道它的问题

Password Grant 就是客户端直接把用户名密码提交给授权服务器换 token。Passport 历史上支持得很好，但在更现代的 OAuth 实践里，这种模式已经不再是首选，因为它要求客户端直接接触用户密码。

它的优点也很直接：

- 迁移老的账号密码系统很方便
- App 自建登录页接入成本低
- 对第一方客户端开发速度快

示例：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "password",
    "client_id": "2",
    "client_secret": "password-client-secret",
    "username": "michael@example.com",
    "password": "secret123",
    "scope": "profile order:read order:write"
  }'
```

在 Passport 里要启用它，除了安装，还要在 `AuthServiceProvider` 或新的服务提供者里显式打开。不过我在新项目里通常把它当作“兼容迁移过渡方案”，因为一旦有了第三方登录、免密登录、短信登录，你就会发现 Password Grant 很快不够用了。这个时候，与其把所有变种都揉进 Password Grant 的用户名密码校验逻辑，不如把“外部身份换 token”单独设计成自定义 Grant Type。

### 2.4 Implicit Grant：历史包袱，知道就行

Implicit Grant 主要面向早期浏览器前端应用，它直接把 access token 返回给前端，而不是先返回 code 再换 token。由于安全风险较高，现在主流实践已经更倾向 Authorization Code + PKCE。

它的特点：

- 少一步 code 交换
- 不返回 refresh token
- token 暴露面更大
- 现代 SPA 场景基本不推荐

如果你在查旧资料时看到 Passport 对 Implicit Grant 的配置，不用惊讶，但新系统除非强历史兼容，一般不建议继续采用。

### 2.5 四种 Grant Type 的对比表

```text
+----------------------+----------------------+----------------------+----------------------+
| Grant Type           | 是否有用户参与       | 是否支持 Refresh     | 典型场景             |
+----------------------+----------------------+----------------------+----------------------+
| authorization_code   | 是                   | 是                   | 第三方网页登录授权   |
| client_credentials   | 否                   | 否                   | 服务到服务调用       |
| password             | 是                   | 是                   | 第一方账号密码登录   |
| implicit             | 是                   | 否                   | 旧式前端应用         |
+----------------------+----------------------+----------------------+----------------------+
```

看完这张表，你会发现：标准 Grant Type 能解决很多问题，但解决不了“微信 code / GitHub code / Google id_token / OpenID 映射本地用户再发 Passport token”这种需求。这就是自定义 Grant Type 真正出场的地方。

## 三、Laravel Passport 安装与配置：先把地基打稳，否则后面全是坑

我见过不少项目一开始就直奔自定义 Grant，结果连 Passport 的基本表结构、密钥、客户端类型都没理顺，后面出现的很多问题其实都不是“自定义 grant 有 bug”，而是基础设施没配好。

下面我按一个相对稳妥的实战流程来配置。

### 3.1 安装 Passport

先安装依赖：

```bash
composer require laravel/passport
```

执行迁移：

```bash
php artisan migrate
```

安装加密密钥与默认客户端：

```bash
php artisan passport:install
```

这一步会生成：

- `oauth_auth_codes`
- `oauth_access_tokens`
- `oauth_refresh_tokens`
- `oauth_clients`
- `oauth_personal_access_clients`

并在 `storage` 下生成密钥文件。

如果你不想自动创建所有客户端，也可以分开执行：

```bash
php artisan passport:keys
php artisan passport:client --password
php artisan passport:client --client
```

### 3.2 用户模型配置

在 `User` 模型引入 `HasApiTokens`：

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Passport\HasApiTokens;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
        'mobile',
        'status',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];
}
```

### 3.3 注册 Passport 路由与令牌生命周期

不同 Laravel/Passport 版本里，写法会有差异。我在项目里更推荐新建一个专门的服务提供者，比如 `App\Providers\PassportServiceProvider`，集中放 Passport 相关配置。

```php
<?php

namespace App\Providers;

use DateInterval;
use Illuminate\Support\ServiceProvider;
use Laravel\Passport\Passport;

class PassportServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Passport::tokensExpireIn(now()->addHours(2));
        Passport::refreshTokensExpireIn(now()->addDays(30));
        Passport::personalAccessTokensExpireIn(now()->addMonths(6));

        Passport::tokensCan([
            'profile' => '读取用户资料',
            'order:read' => '读取订单',
            'order:write' => '操作订单',
            'social:bind' => '绑定第三方账号',
            'admin' => '后台管理权限',
        ]);

        Passport::setDefaultScope([
            'profile',
        ]);
    }
}
```

然后把这个 Provider 注册到应用配置中。这样做的好处是后面启用 Password Grant、自定义 Grant、定义 Scope 都集中在一处，不会散落在多个文件。

### 3.4 API Guard 配置

`config/auth.php` 中把 API guard 指向 Passport：

```php
'guards' => [
    'web' => [
        'driver' => 'session',
        'provider' => 'users',
    ],

    'api' => [
        'driver' => 'passport',
        'provider' => 'users',
    ],
],
```

保护接口：

```php
Route::middleware(['auth:api'])->group(function () {
    Route::get('/me', function (\Illuminate\Http\Request $request) {
        return response()->json([
            'id' => $request->user()->id,
            'name' => $request->user()->name,
            'email' => $request->user()->email,
        ]);
    });
});
```

### 3.5 生产环境的两个关键点：密钥与缓存

这是我踩过的第一个坑：本地好好的，部署到线上后 `/oauth/token` 一直 500。最后查日志发现是 Passport 私钥文件权限不对，Nginx/PHP-FPM 用户没有读权限。

建议部署时检查：

```bash
ls -l storage/oauth-*.key
```

另一个坑是配置缓存。你改了 `config/auth.php`、Passport 相关 provider、env 里的 client id/secret，却忘了执行：

```bash
php artisan config:clear
php artisan cache:clear
php artisan route:clear
```

尤其在你开始加自定义 Grant Type 后，这个坑会更高频地出现——代码改了，但容器里跑的还是旧配置，表现通常就是“为什么我的 grant_type 永远不生效”。

## 四、项目建模：先设计第三方账号映射，否则登录逻辑会越写越乱

做第三方登录时，最容易掉进的坑是：把第三方平台字段直接塞进 `users` 表。比如加 `wechat_openid`、`github_id`、`google_sub` 三列，看起来很快，实际上后续扩展性极差。

我在项目里最终稳定下来的模型是：

- `users`：本地用户主表
- `social_accounts`：第三方账号绑定表

### 4.1 social_accounts 表设计

迁移示例：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('social_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 32);
            $table->string('provider_user_id', 191);
            $table->string('union_id', 191)->nullable();
            $table->string('openid', 191)->nullable();
            $table->string('email')->nullable();
            $table->string('nickname')->nullable();
            $table->string('avatar')->nullable();
            $table->json('raw_payload')->nullable();
            $table->timestamp('bound_at')->nullable();
            $table->timestamps();

            $table->unique(['provider', 'provider_user_id']);
            $table->index(['provider', 'openid']);
            $table->index(['provider', 'union_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('social_accounts');
    }
};
```

### 4.2 Eloquent 模型

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SocialAccount extends Model
{
    protected $fillable = [
        'user_id',
        'provider',
        'provider_user_id',
        'union_id',
        'openid',
        'email',
        'nickname',
        'avatar',
        'raw_payload',
        'bound_at',
    ];

    protected $casts = [
        'raw_payload' => 'array',
        'bound_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
```

`User` 模型里加关系：

```php
public function socialAccounts()
{
    return $this->hasMany(SocialAccount::class);
}
```

### 4.3 为什么一定要单独建表

这是一个很典型的“看似简单、后期会炸”的设计点。单独建表的好处：

1. 一个人可以绑定多个 provider
2. provider 返回的字段结构差异大，不污染 users 主表
3. 可以记录原始 payload，方便排查
4. 后续做解绑、审计、风控更方便
5. 自定义 Grant Type 可以统一走“provider 身份 -> 本地用户”映射逻辑

如果你一开始偷懒把这些字段塞进 `users`，等你支持第二个第三方平台的时候，就会发现自己在用一张用户表硬扛一个多对多映射问题。

## 五、自定义 Grant Type 的目标是什么：把“外部身份”统一换成 Passport Token

标准 Password Grant 只能认用户名密码，但我们的业务实际上有很多“非密码型身份凭证”：

- 微信登录回调拿到的 `openid / unionid`
- GitHub OAuth 回调拿到的 `github user id`
- Google OpenID Connect 返回的 `sub`
- 业务侧内部签名换 token
- 手机验证码校验后的临时凭证

这些场景共同点是：**客户端提交的不是用户密码，而是一种已经由服务端确认可信的外部身份凭证**。这时候比较合理的做法，就是定义一个新的 grant_type，比如 `social`，专门负责完成：

1. 解析 provider 参数
2. 验证外部身份凭证是否有效
3. 将外部身份映射为本地 user
4. 由 Passport 发放标准 access token / refresh token

这样，前端或第三方客户端拿到的依然是 Passport 标准 token，资源接口完全不需要知道用户到底是密码登录、微信登录还是 GitHub 登录。

### 5.1 自定义 Grant 的请求形态

我在项目里最终使用的请求大概长这样：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "social",
    "client_id": "2",
    "client_secret": "secret",
    "provider": "github",
    "provider_access_token": "gho_xxx",
    "scope": "profile order:read"
  }'
```

或者微信场景：

```json
{
  "grant_type": "social",
  "client_id": "2",
  "client_secret": "secret",
  "provider": "wechat",
  "code": "081xYk000abcxyz"
}
```

或者 Google 场景：

```json
{
  "grant_type": "social",
  "client_id": "2",
  "client_secret": "secret",
  "provider": "google",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

看起来参数形态不同，所以核心设计思路不是把所有 provider 逻辑写死在 Grant 里，而是让 Grant 只负责协议层，provider 细节放到独立解析器里。

## 六、自定义 Grant Type 完整实现：从 Repository 到 Grant 到 Provider 一步一步接上

这一部分是全文最关键的实战内容。我用的是一种稳定且可维护的结构：

- `SocialGrant`：自定义 Grant Type，本质上继承 League OAuth2 Server 的 AbstractGrant
- `SocialUserResolver`：统一解析 provider 身份并返回本地用户
- `ProviderProfileFetcher`：针对微信/GitHub/Google 分别拉取用户信息
- `PassportServiceProvider`：向 AuthorizationServer 注册 grant

### 6.1 定义外部身份解析结果 DTO

先定义一个 DTO，让各 provider 的结果结构统一。

```php
<?php

namespace App\Auth\Social;

class SocialUserProfile
{
    public function __construct(
        public readonly string $provider,
        public readonly string $providerUserId,
        public readonly ?string $email,
        public readonly ?string $nickname,
        public readonly ?string $avatar,
        public readonly ?string $openid,
        public readonly ?string $unionId,
        public readonly array $rawPayload = [],
    ) {
    }
}
```

### 6.2 定义 Provider 接口

```php
<?php

namespace App\Auth\Social;

use Psr\Http\Message\ServerRequestInterface;

interface SocialProviderInterface
{
    public function providerName(): string;

    public function fetchUserFromRequest(ServerRequestInterface $request): SocialUserProfile;
}
```

这样每个第三方 provider 都能按自己的规则从请求中取参数、验 token、换用户信息。

### 6.3 GitHub Provider 实现

GitHub 相对简单，客户端通常把 `provider_access_token` 传给后端，我们再调用 GitHub API 拉用户资料。

```php
<?php

namespace App\Auth\Social\Providers;

use App\Auth\Social\SocialProviderInterface;
use App\Auth\Social\SocialUserProfile;
use GuzzleHttp\ClientInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use Psr\Http\Message\ServerRequestInterface;

class GithubSocialProvider implements SocialProviderInterface
{
    public function __construct(
        protected ClientInterface $http,
    ) {
    }

    public function providerName(): string
    {
        return 'github';
    }

    public function fetchUserFromRequest(ServerRequestInterface $request): SocialUserProfile
    {
        $body = $request->getParsedBody();
        $token = $body['provider_access_token'] ?? null;

        if (!$token) {
            throw OAuthServerException::invalidRequest('provider_access_token');
        }

        $response = $this->http->request('GET', 'https://api.github.com/user', [
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Accept' => 'application/vnd.github+json',
            ],
            'timeout' => 8,
        ]);

        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        return new SocialUserProfile(
            provider: 'github',
            providerUserId: (string) $payload['id'],
            email: $payload['email'] ?? null,
            nickname: $payload['login'] ?? null,
            avatar: $payload['avatar_url'] ?? null,
            openid: null,
            unionId: null,
            rawPayload: $payload,
        );
    }
}
```

### 6.4 Google Provider 实现

Google 登录常见两种接法：

- 客户端拿 access token，让后端请求 Google UserInfo
- 客户端拿到 `id_token`，后端校验 JWT 并取 `sub`

为了避免只依赖前端传回来的 access token，我通常更偏向校验 `id_token`，但如果团队还没接完整 JWKS 校验，先用 userinfo 接口也可以。

这里给一个基于 userinfo 的实战写法：

```php
<?php

namespace App\Auth\Social\Providers;

use App\Auth\Social\SocialProviderInterface;
use App\Auth\Social\SocialUserProfile;
use GuzzleHttp\ClientInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use Psr\Http\Message\ServerRequestInterface;

class GoogleSocialProvider implements SocialProviderInterface
{
    public function __construct(
        protected ClientInterface $http,
    ) {
    }

    public function providerName(): string
    {
        return 'google';
    }

    public function fetchUserFromRequest(ServerRequestInterface $request): SocialUserProfile
    {
        $body = $request->getParsedBody();
        $token = $body['provider_access_token'] ?? null;

        if (!$token) {
            throw OAuthServerException::invalidRequest('provider_access_token');
        }

        $response = $this->http->request('GET', 'https://www.googleapis.com/oauth2/v3/userinfo', [
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
            ],
            'timeout' => 8,
        ]);

        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        return new SocialUserProfile(
            provider: 'google',
            providerUserId: (string) $payload['sub'],
            email: $payload['email'] ?? null,
            nickname: $payload['name'] ?? null,
            avatar: $payload['picture'] ?? null,
            openid: null,
            unionId: null,
            rawPayload: $payload,
        );
    }
}
```

### 6.5 微信 Provider 实现

微信的坑最多，因为它既有网页授权，也有开放平台/小程序体系，还涉及 `openid` 和 `unionid` 的差异。实践里最重要的一点是：**不要把 openid 当成全平台唯一用户标识，优先用 unionid，有 unionid 时一定存 unionid**。

示例：客户端传微信 `code`，后端去换 access_token 和 openid，再拉用户信息。

```php
<?php

namespace App\Auth\Social\Providers;

use App\Auth\Social\SocialProviderInterface;
use App\Auth\Social\SocialUserProfile;
use GuzzleHttp\ClientInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use Psr\Http\Message\ServerRequestInterface;

class WechatSocialProvider implements SocialProviderInterface
{
    public function __construct(
        protected ClientInterface $http,
    ) {
    }

    public function providerName(): string
    {
        return 'wechat';
    }

    public function fetchUserFromRequest(ServerRequestInterface $request): SocialUserProfile
    {
        $body = $request->getParsedBody();
        $code = $body['code'] ?? null;

        if (!$code) {
            throw OAuthServerException::invalidRequest('code');
        }

        $tokenResponse = $this->http->request('GET', 'https://api.weixin.qq.com/sns/oauth2/access_token', [
            'query' => [
                'appid' => config('services.wechat.app_id'),
                'secret' => config('services.wechat.app_secret'),
                'code' => $code,
                'grant_type' => 'authorization_code',
            ],
            'timeout' => 8,
        ]);

        $tokenPayload = json_decode((string) $tokenResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);

        if (isset($tokenPayload['errcode'])) {
            throw OAuthServerException::invalidGrant('Invalid wechat code or token response.');
        }

        $userResponse = $this->http->request('GET', 'https://api.weixin.qq.com/sns/userinfo', [
            'query' => [
                'access_token' => $tokenPayload['access_token'],
                'openid' => $tokenPayload['openid'],
                'lang' => 'zh_CN',
            ],
            'timeout' => 8,
        ]);

        $payload = json_decode((string) $userResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);

        if (isset($payload['errcode'])) {
            throw OAuthServerException::invalidGrant('Unable to fetch wechat user profile.');
        }

        return new SocialUserProfile(
            provider: 'wechat',
            providerUserId: (string) ($payload['unionid'] ?? $payload['openid']),
            email: null,
            nickname: $payload['nickname'] ?? null,
            avatar: $payload['headimgurl'] ?? null,
            openid: $payload['openid'] ?? null,
            unionId: $payload['unionid'] ?? null,
            rawPayload: array_merge($tokenPayload, ['userinfo' => $payload]),
        );
    }
}
```

### 6.6 Provider 管理器：按 provider 名字路由到不同实现

```php
<?php

namespace App\Auth\Social;

use League\OAuth2\Server\Exception\OAuthServerException;
use Psr\Http\Message\ServerRequestInterface;

class SocialProviderManager
{
    /** @var array<string, SocialProviderInterface> */
    protected array $providers = [];

    public function __construct(iterable $providers)
    {
        foreach ($providers as $provider) {
            $this->providers[$provider->providerName()] = $provider;
        }
    }

    public function fetchUser(string $provider, ServerRequestInterface $request): SocialUserProfile
    {
        if (!isset($this->providers[$provider])) {
            throw OAuthServerException::invalidRequest('provider', 'Unsupported social provider.');
        }

        return $this->providers[$provider]->fetchUserFromRequest($request);
    }
}
```

### 6.7 SocialAccount 绑定与用户解析服务

这一步非常关键：Grant 不应该直接操作数据库细节，否则后面需求一变，Grant 类会无限膨胀。把“找到或创建用户、绑定第三方账号”独立成领域服务。

```php
<?php

namespace App\Services\Auth;

use App\Auth\Social\SocialUserProfile;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SocialAccountService
{
    public function resolveOrCreateUser(SocialUserProfile $profile): User
    {
        return DB::transaction(function () use ($profile) {
            $account = SocialAccount::query()
                ->where('provider', $profile->provider)
                ->where('provider_user_id', $profile->providerUserId)
                ->first();

            if ($account) {
                $this->updateAccountProfile($account, $profile);
                return $account->user;
            }

            $user = $this->findExistingUser($profile) ?? $this->createUser($profile);

            SocialAccount::query()->create([
                'user_id' => $user->id,
                'provider' => $profile->provider,
                'provider_user_id' => $profile->providerUserId,
                'union_id' => $profile->unionId,
                'openid' => $profile->openid,
                'email' => $profile->email,
                'nickname' => $profile->nickname,
                'avatar' => $profile->avatar,
                'raw_payload' => $profile->rawPayload,
                'bound_at' => now(),
            ]);

            return $user;
        });
    }

    protected function findExistingUser(SocialUserProfile $profile): ?User
    {
        if ($profile->email) {
            return User::query()->where('email', $profile->email)->first();
        }

        if ($profile->provider === 'wechat' && $profile->unionId) {
            $account = SocialAccount::query()
                ->where('provider', 'wechat')
                ->where('union_id', $profile->unionId)
                ->first();

            return $account?->user;
        }

        return null;
    }

    protected function createUser(SocialUserProfile $profile): User
    {
        return User::query()->create([
            'name' => $profile->nickname ?: ucfirst($profile->provider) . '_user_' . Str::random(6),
            'email' => $profile->email,
            'password' => bcrypt(Str::random(32)),
            'status' => 'active',
        ]);
    }

    protected function updateAccountProfile(SocialAccount $account, SocialUserProfile $profile): void
    {
        $account->fill([
            'union_id' => $profile->unionId,
            'openid' => $profile->openid,
            'email' => $profile->email,
            'nickname' => $profile->nickname,
            'avatar' => $profile->avatar,
            'raw_payload' => $profile->rawPayload,
        ])->save();
    }
}
```

### 6.8 让 Grant 能返回 Laravel User：UserRepository 实现

League OAuth2 Server 在签发 token 时，需要一个 `UserRepositoryInterface` 来根据请求拿到 user entity。我们可以在这个 repository 里调用刚才的 social service。

```php
<?php

namespace App\Auth\OAuth;

use App\Models\User;
use App\Services\Auth\SocialAccountService;
use Laravel\Passport\Bridge\User as PassportUser;
use Laravel\Passport\Bridge\UserRepository as BaseUserRepository;

class SocialUserRepository extends BaseUserRepository
{
    public function __construct(
        protected SocialAccountService $socialAccountService,
    ) {
    }

    public function getUserEntityBySocialProfile($profile): PassportUser
    {
        /** @var User $user */
        $user = $this->socialAccountService->resolveOrCreateUser($profile);

        return new PassportUser($user->getAuthIdentifier());
    }
}
```

注意：不同 Passport 版本里 Bridge 类的构造方式、接口要求可能略有不同。如果你升级后发现类签名不兼容，先对照当前 `vendor/laravel/passport/src/Bridge` 目录确认接口，而不要直接套旧博客代码。

### 6.9 自定义 SocialGrant 实现

下面是最核心的一段。Grant 负责：

- 校验 client
- 校验 scope
- 从 request 读取 provider
- 调用 provider manager 获取外部用户资料
- 交给 user repository 解析成 Passport User
- 签发 access token 与 refresh token

```php
<?php

namespace App\Auth\OAuth\Grants;

use App\Auth\OAuth\SocialUserRepository;
use App\Auth\Social\SocialProviderManager;
use DateInterval;
use League\OAuth2\Server\Entities\ClientEntityInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\Grant\AbstractGrant;
use Psr\Http\Message\ServerRequestInterface;
use Nyholm\Psr7\Response as Psr7Response;

class SocialGrant extends AbstractGrant
{
    public function __construct(
        protected SocialUserRepository $userRepository,
        protected SocialProviderManager $providerManager,
        \League\OAuth2\Server\Repositories\RefreshTokenRepositoryInterface $refreshTokenRepository,
    ) {
        $this->setUserRepository($userRepository);
        $this->setRefreshTokenRepository($refreshTokenRepository);
        $this->refreshTokenTTL = new DateInterval('P30D');
    }

    public function respondToAccessTokenRequest(
        ServerRequestInterface $request,
        Psr7Response $response,
        DateInterval $accessTokenTTL
    ): Psr7Response {
        $client = $this->validateClient($request);
        $scopes = $this->validateScopes($this->getRequestParameter('scope', $request));
        $provider = $this->getRequestParameter('provider', $request);

        if (!$provider) {
            throw OAuthServerException::invalidRequest('provider');
        }

        $socialProfile = $this->providerManager->fetchUser($provider, $request);
        $user = $this->userRepository->getUserEntityBySocialProfile($socialProfile);

        $finalizedScopes = $this->scopeRepository->finalizeScopes(
            $scopes,
            $this->getIdentifier(),
            $client,
            $user->getIdentifier()
        );

        $accessToken = $this->issueAccessToken(
            $accessTokenTTL,
            $client,
            $user->getIdentifier(),
            $finalizedScopes
        );

        $refreshToken = $this->issueRefreshToken($accessToken);

        $responseType = $this->getResponseType();
        $responseType->setAccessToken($accessToken);
        $responseType->setRefreshToken($refreshToken);

        return $responseType->generateHttpResponse($response);
    }

    public function getIdentifier(): string
    {
        return 'social';
    }
}
```

如果你希望这段代码在真实项目中更容易直接落地，我建议把 `AbstractGrant` 依赖的 repository 全部显式注入，并补上 `ScopeRepositoryInterface`、`AccessTokenRepositoryInterface` 与 `ResponseTypeInterface` 的初始化，否则很多同学复制过去后会遇到 `scopeRepository` 或 `responseType` 未初始化的问题。下面给一个更完整、可直接作为工程模板的版本：

```php
<?php

namespace App\Auth\OAuth\Grants;

use App\Auth\OAuth\SocialUserRepository;
use App\Auth\Social\SocialProviderManager;
use DateInterval;
use League\OAuth2\Server\Entities\ClientEntityInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\Grant\AbstractGrant;
use League\OAuth2\Server\Repositories\AccessTokenRepositoryInterface;
use League\OAuth2\Server\Repositories\RefreshTokenRepositoryInterface;
use League\OAuth2\Server\Repositories\ScopeRepositoryInterface;
use League\OAuth2\Server\ResponseTypes\BearerTokenResponse;
use Nyholm\Psr7\Response as Psr7Response;
use Psr\Http\Message\ServerRequestInterface;

class SocialGrant extends AbstractGrant
{
    public function __construct(
        protected SocialUserRepository $userRepository,
        protected SocialProviderManager $providerManager,
        AccessTokenRepositoryInterface $accessTokenRepository,
        RefreshTokenRepositoryInterface $refreshTokenRepository,
        ScopeRepositoryInterface $scopeRepository,
    ) {
        $this->setUserRepository($userRepository);
        $this->setAccessTokenRepository($accessTokenRepository);
        $this->setRefreshTokenRepository($refreshTokenRepository);
        $this->setScopeRepository($scopeRepository);
        $this->setResponseType(new BearerTokenResponse());
        $this->refreshTokenTTL = new DateInterval('P30D');
    }

    public function respondToAccessTokenRequest(
        ServerRequestInterface $request,
        Psr7Response $response,
        DateInterval $accessTokenTTL
    ): Psr7Response {
        $client = $this->validateClient($request);
        $scopes = $this->validateScopes($this->getRequestParameter('scope', $request, $this->defaultScope));
        $provider = $this->getRequestParameter('provider', $request);

        if (!$provider) {
            throw OAuthServerException::invalidRequest('provider');
        }

        $socialProfile = $this->providerManager->fetchUser($provider, $request);
        $user = $this->userRepository->getUserEntityBySocialProfile($socialProfile);

        if (!$user) {
            throw OAuthServerException::invalidCredentials();
        }

        $finalizedScopes = $this->scopeRepository->finalizeScopes(
            $scopes,
            $this->getIdentifier(),
            $client,
            $user->getIdentifier()
        );

        $accessToken = $this->issueAccessToken(
            $accessTokenTTL,
            $client,
            $user->getIdentifier(),
            $finalizedScopes
        );

        $refreshToken = $this->issueRefreshToken($accessToken);

        $responseType = $this->getResponseType();
        $responseType->setAccessToken($accessToken);
        $responseType->setRefreshToken($refreshToken);

        return $responseType->generateHttpResponse($response);
    }

    public function canRespondToAuthorizationRequest(ServerRequestInterface $request): bool
    {
        return false;
    }

    public function validateAuthorizationRequest(ServerRequestInterface $request): void
    {
        throw OAuthServerException::unsupportedGrantType();
    }

    public function completeAuthorizationRequest($authRequest): Psr7Response
    {
        throw OAuthServerException::unsupportedGrantType();
    }

    protected function validateClient(ServerRequestInterface $request): ClientEntityInterface
    {
        $client = parent::validateClient($request);

        if ($client->isConfidential() && !$this->getRequestParameter('client_secret', $request)) {
            throw OAuthServerException::invalidRequest('client_secret');
        }

        return $client;
    }

    public function getIdentifier(): string
    {
        return 'social';
    }
}
```

同时，容器注册时也建议把 Passport Bridge 仓储显式注入，避免升级版本后因为类型不匹配导致授权服务器无法启动：

```php
$this->app->singleton(SocialGrant::class, function ($app) {
    return new SocialGrant(
        $app->make(\App\Auth\OAuth\SocialUserRepository::class),
        $app->make(\App\Auth\Social\SocialProviderManager::class),
        $app->make(\Laravel\Passport\Bridge\AccessTokenRepository::class),
        $app->make(\Laravel\Passport\Bridge\RefreshTokenRepository::class),
        $app->make(\Laravel\Passport\Bridge\ScopeRepository::class),
    );
});
```

### 6.10 把 Grant 注册到 Passport 的 Authorization Server

注册方式的核心思路是：从容器里取出 AuthorizationServer，然后 `enableGrantType()`。

```php
<?php

namespace App\Providers;

use App\Auth\OAuth\Grants\SocialGrant;
use DateInterval;
use Illuminate\Support\ServiceProvider;
use Laravel\Passport\Passport;
use League\OAuth2\Server\AuthorizationServer;

class PassportServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SocialGrant::class, function ($app) {
            return new SocialGrant(
                $app->make(\App\Auth\OAuth\SocialUserRepository::class),
                $app->make(\App\Auth\Social\SocialProviderManager::class),
                $app->make(\Laravel\Passport\Bridge\RefreshTokenRepository::class),
            );
        });
    }

    public function boot(): void
    {
        Passport::tokensExpireIn(now()->addHours(2));
        Passport::refreshTokensExpireIn(now()->addDays(30));

        $server = $this->app->make(AuthorizationServer::class);
        $server->enableGrantType(
            $this->app->make(SocialGrant::class),
            new DateInterval('PT2H')
        );
    }
}
```

### 6.11 绑定 Provider 实现到容器

```php
<?php

namespace App\Providers;

use App\Auth\Social\Providers\GithubSocialProvider;
use App\Auth\Social\Providers\GoogleSocialProvider;
use App\Auth\Social\Providers\WechatSocialProvider;
use App\Auth\Social\SocialProviderManager;
use GuzzleHttp\Client;
use Illuminate\Support\ServiceProvider;

class SocialAuthServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Client::class, fn () => new Client());

        $this->app->singleton(SocialProviderManager::class, function ($app) {
            return new SocialProviderManager([
                $app->make(GithubSocialProvider::class),
                $app->make(GoogleSocialProvider::class),
                $app->make(WechatSocialProvider::class),
            ]);
        });
    }
}
```

### 6.12 请求示例与返回结果

当上面的链路打通之后，客户端就可以直接走 `/oauth/token`：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "social",
    "client_id": "2",
    "client_secret": "social-client-secret",
    "provider": "github",
    "provider_access_token": "gho_example_token",
    "scope": "profile order:read"
  }'
```

期望返回：

```json
{
  "token_type": "Bearer",
  "expires_in": 7200,
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...",
  "refresh_token": "def5020042f1..."
}
```

到这里为止，自定义 Grant 就算真正接好了。

## 七、第三方登录集成实战：微信 / GitHub / Google 怎么和 Passport 串起来

自定义 Grant 搭好以后，很多同学会问：那前端到底应该怎么接第三方登录？这里最容易混淆的是“第三方平台自己的 OAuth/OpenID 流程”与“我们系统内部 Passport 发 token 的流程”。

最稳的设计是两段式：

1. 客户端先完成第三方平台授权，拿到 `code` 或 `provider_access_token`
2. 再把这个凭证提交给你自己的 `/oauth/token`，由 `grant_type=social` 发放本系统 token

这样做好处很明显：

- 本系统对外永远只暴露 Passport token
- 资源服务器完全不关心第三方平台细节
- 第三方 provider 改版时，只改 social provider 解析器
- refresh/revoke 全都统一

### 7.1 GitHub 登录流程

GitHub 的典型前端流程：

```text
前端 -> GitHub authorize
GitHub -> redirect_uri?code=xxx
前端/后端 -> GitHub token endpoint 换 provider_access_token
客户端 -> 我方 /oauth/token (grant_type=social, provider=github)
我方 -> GitHub user API 拉资料 -> 映射用户 -> 发 Passport token
```

如果你走前端换 token，再传给后端，代码会比较直接；但如果你担心前端持有 GitHub token 太久，也可以在你自己的后端先完成 code 换 token，再把内部临时凭证交给 social grant。这取决于你的安全边界要求。

一个更偏后端代理式的控制器示例：

```php
<?php

namespace App\Http\Controllers\Auth;

use GuzzleHttp\Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GithubCallbackController
{
    public function __invoke(Request $request, Client $http): JsonResponse
    {
        $code = $request->string('code')->toString();

        $tokenResponse = $http->post('https://github.com/login/oauth/access_token', [
            'headers' => ['Accept' => 'application/json'],
            'form_params' => [
                'client_id' => config('services.github.client_id'),
                'client_secret' => config('services.github.client_secret'),
                'code' => $code,
                'redirect_uri' => config('services.github.redirect'),
            ],
        ]);

        $payload = json_decode((string) $tokenResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);

        return response()->json([
            'provider' => 'github',
            'provider_access_token' => $payload['access_token'] ?? null,
        ]);
    }
}
```

接着由前端再调用你自己的 `/oauth/token`。

如果你希望把 GitHub OAuth 的完整链路全部收在后端，通常还会再补一个“生成授权跳转地址”的入口，保证 `state` 参数可校验、redirect_uri 可追踪：

```php
<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class GithubRedirectController
{
    public function __invoke(Request $request): JsonResponse
    {
        $state = Str::random(40);

        $request->session()->put('github_oauth_state', $state);

        $query = http_build_query([
            'client_id' => config('services.github.client_id'),
            'redirect_uri' => config('services.github.redirect'),
            'scope' => 'read:user user:email',
            'state' => $state,
        ]);

        return response()->json([
            'authorize_url' => 'https://github.com/login/oauth/authorize?' . $query,
            'state' => $state,
        ]);
    }
}
```

对应回调控制器则应补上 `state` 校验，并在 GitHub `/user` 返回 `email` 为空时继续补拉 `/user/emails`，这样才能把流程做完整：

```php
<?php

namespace App\Http\Controllers\Auth;

use GuzzleHttp\Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

class GithubCallbackController
{
    public function __invoke(Request $request, Client $http): JsonResponse
    {
        if ($request->input('state') !== $request->session()->pull('github_oauth_state')) {
            throw new UnprocessableEntityHttpException('GitHub state 校验失败。');
        }

        $tokenResponse = $http->post('https://github.com/login/oauth/access_token', [
            'headers' => ['Accept' => 'application/json'],
            'form_params' => [
                'client_id' => config('services.github.client_id'),
                'client_secret' => config('services.github.client_secret'),
                'code' => $request->string('code')->toString(),
                'redirect_uri' => config('services.github.redirect'),
            ],
        ]);

        $tokenPayload = json_decode((string) $tokenResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);
        $providerAccessToken = $tokenPayload['access_token'] ?? null;

        $userResponse = $http->get('https://api.github.com/user', [
            'headers' => [
                'Authorization' => 'Bearer ' . $providerAccessToken,
                'Accept' => 'application/vnd.github+json',
            ],
        ]);

        $user = json_decode((string) $userResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);
        $email = $user['email'] ?? null;

        if (!$email) {
            $emailResponse = $http->get('https://api.github.com/user/emails', [
                'headers' => [
                    'Authorization' => 'Bearer ' . $providerAccessToken,
                    'Accept' => 'application/vnd.github+json',
                ],
            ]);

            $emails = json_decode((string) $emailResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);
            $primary = collect($emails)->first(fn ($item) => ($item['primary'] ?? false) && ($item['verified'] ?? false));
            $email = $primary['email'] ?? null;
        }

        return response()->json([
            'provider' => 'github',
            'provider_access_token' => $providerAccessToken,
            'profile' => [
                'id' => $user['id'] ?? null,
                'login' => $user['login'] ?? null,
                'email' => $email,
            ],
        ]);
    }
}
```

### 7.2 Google 登录流程

Google 更推荐基于 OpenID Connect。很多前端 SDK 会直接返回 `credential` 或 `id_token`。如果你希望更严谨，应该在服务端校验：

- JWT 签名
- `aud` 是否为你的 client_id
- `iss` 是否为 Google
- `exp` 是否过期

如果暂时没做完整 JWK 校验，也至少不要盲信任前端传来的任意字符串。下面给一个简化的 Google id_token 校验服务结构：

```php
<?php

namespace App\Services\Auth;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use GuzzleHttp\ClientInterface;
use RuntimeException;

class GoogleIdTokenVerifier
{
    public function __construct(
        protected ClientInterface $http,
    ) {
    }

    public function verify(string $idToken): array
    {
        $jwksResponse = $this->http->request('GET', 'https://www.googleapis.com/oauth2/v3/certs');
        $jwks = json_decode((string) $jwksResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);

        $keys = JWK::parseKeySet($jwks);
        $payload = (array) JWT::decode($idToken, $keys);

        if (($payload['aud'] ?? null) !== config('services.google.client_id')) {
            throw new RuntimeException('Invalid google aud.');
        }

        if (!in_array($payload['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)) {
            throw new RuntimeException('Invalid google issuer.');
        }

        return $payload;
    }
}
```

然后在 Google provider 中优先读取 `id_token`：

```php
$body = $request->getParsedBody();
$idToken = $body['id_token'] ?? null;

if (!$idToken) {
    throw OAuthServerException::invalidRequest('id_token');
}

$payload = $this->verifier->verify($idToken);

return new SocialUserProfile(
    provider: 'google',
    providerUserId: (string) $payload['sub'],
    email: $payload['email'] ?? null,
    nickname: $payload['name'] ?? null,
    avatar: $payload['picture'] ?? null,
    openid: null,
    unionId: null,
    rawPayload: $payload,
);
```

### 7.3 微信登录流程

微信登录的核心坑主要有三个：

1. 网页授权和开放平台/小程序不是完全一套东西
2. `openid` 是应用维度，不是平台全局唯一
3. `unionid` 不是所有场景都一定拿得到

我在项目里的策略是：

- 能拿 `unionid` 时，`provider_user_id` 就用 `unionid`
- 拿不到时先退化用 `openid`
- 原始返回全部落库，后续补绑/合并账号时可追溯

一个典型的前端调用 Passport 请求：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "social",
    "client_id": "2",
    "client_secret": "social-client-secret",
    "provider": "wechat",
    "code": "081xYk000abcxyz"
  }'
```

对应处理流程图：

```text
前端拿到微信 code
        |
        v
POST /oauth/token grant_type=social provider=wechat
        |
        v
SocialGrant -> WechatSocialProvider
        |
        +--> /sns/oauth2/access_token
        |
        +--> /sns/userinfo
        |
        v
SocialAccountService resolveOrCreateUser
        |
        v
Passport issue access_token + refresh_token
```

如果你的前端是 H5 或公众号网页授权，通常还需要一个后端入口生成微信授权地址，以及一个回调接口把 `code` 转成内部可消费的数据。下面是更完整的一套控制器示例：

```php
<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class WechatRedirectController
{
    public function __invoke(Request $request): JsonResponse
    {
        $state = Str::random(32);
        $request->session()->put('wechat_oauth_state', $state);

        $query = http_build_query([
            'appid' => config('services.wechat.app_id'),
            'redirect_uri' => config('services.wechat.redirect'),
            'response_type' => 'code',
            'scope' => 'snsapi_userinfo',
            'state' => $state,
        ]);

        return response()->json([
            'authorize_url' => 'https://open.weixin.qq.com/connect/oauth2/authorize?' . $query . '#wechat_redirect',
        ]);
    }
}
```

```php
<?php

namespace App\Http\Controllers\Auth;

use GuzzleHttp\Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

class WechatCallbackController
{
    public function __invoke(Request $request, Client $http): JsonResponse
    {
        if ($request->input('state') !== $request->session()->pull('wechat_oauth_state')) {
            throw new UnprocessableEntityHttpException('微信 state 校验失败。');
        }

        $code = $request->string('code')->toString();

        $tokenResponse = $http->get('https://api.weixin.qq.com/sns/oauth2/access_token', [
            'query' => [
                'appid' => config('services.wechat.app_id'),
                'secret' => config('services.wechat.app_secret'),
                'code' => $code,
                'grant_type' => 'authorization_code',
            ],
        ]);

        $tokenPayload = json_decode((string) $tokenResponse->getBody(), true, 512, JSON_THROW_ON_ERROR);

        if (isset($tokenPayload['errcode'])) {
            throw new UnprocessableEntityHttpException('微信 code 换 token 失败：' . $tokenPayload['errmsg']);
        }

        return response()->json([
            'provider' => 'wechat',
            'code' => $code,
            'openid' => $tokenPayload['openid'] ?? null,
            'unionid' => $tokenPayload['unionid'] ?? null,
        ]);
    }
}
```

真正落到接口设计时，我更推荐“前端只负责拿第三方平台 code，Passport Social Grant 负责换 token”的方式。也就是说，你可以让前端直接把微信 `code`、GitHub `provider_access_token` 或 Google `id_token` 提交到同一个 `/oauth/token`，后端统一走这一条协议链路，减少散落的临时接口。

### 7.5 Google 登录完整流程补充

Google 场景除了前面提到的 `id_token` 校验外，实际接入时也建议把“生成授权地址”和“回调换 code”的流程单独实现清楚，尤其是你需要同时支持 Web 与移动端时。

```php
<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class GoogleRedirectController
{
    public function __invoke(Request $request): JsonResponse
    {
        $state = Str::random(40);
        $request->session()->put('google_oauth_state', $state);

        $query = http_build_query([
            'client_id' => config('services.google.client_id'),
            'redirect_uri' => config('services.google.redirect'),
            'response_type' => 'code',
            'scope' => 'openid profile email',
            'access_type' => 'offline',
            'prompt' => 'consent',
            'state' => $state,
        ]);

        return response()->json([
            'authorize_url' => 'https://accounts.google.com/o/oauth2/v2/auth?' . $query,
        ]);
    }
}
```

```php
<?php

namespace App\Http\Controllers\Auth;

use GuzzleHttp\Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

class GoogleCallbackController
{
    public function __invoke(Request $request, Client $http): JsonResponse
    {
        if ($request->input('state') !== $request->session()->pull('google_oauth_state')) {
            throw new UnprocessableEntityHttpException('Google state 校验失败。');
        }

        $response = $http->post('https://oauth2.googleapis.com/token', [
            'form_params' => [
                'client_id' => config('services.google.client_id'),
                'client_secret' => config('services.google.client_secret'),
                'code' => $request->string('code')->toString(),
                'grant_type' => 'authorization_code',
                'redirect_uri' => config('services.google.redirect'),
            ],
        ]);

        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        return response()->json([
            'provider' => 'google',
            'provider_access_token' => $payload['access_token'] ?? null,
            'id_token' => $payload['id_token'] ?? null,
            'refresh_token' => $payload['refresh_token'] ?? null,
        ]);
    }
}
```

### 7.4 第三方登录绑定已有账号的策略

这也是实际业务里非常常见的问题：如果用户先用了邮箱密码注册，后来又点了 Google/GitHub 登录，是否自动绑定到同一个账号？

我建议的规则：

1. **已登录状态下发起第三方授权**：默认绑定到当前账号
2. **未登录状态下第三方登录**：
   - 若能通过可信字段匹配到现有用户，如唯一 email，可提示确认绑定
   - 微信场景如果已有同 `unionid`，直接识别为同用户
3. **高风险 provider 不自动合并**：
   - 邮箱未验证的不自动绑定
   - 关键账户（管理员）要求二次确认

控制器示例：

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Models\SocialAccount;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BindSocialAccountController
{
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'provider' => ['required', 'string'],
            'provider_user_id' => ['required', 'string'],
        ]);

        $exists = SocialAccount::query()
            ->where('provider', $request->input('provider'))
            ->where('provider_user_id', $request->input('provider_user_id'))
            ->exists();

        if ($exists) {
            return response()->json([
                'message' => '该第三方账号已绑定其他用户。',
            ], 422);
        }

        $request->user()->socialAccounts()->create([
            'provider' => $request->input('provider'),
            'provider_user_id' => $request->input('provider_user_id'),
            'nickname' => $request->input('nickname'),
            'avatar' => $request->input('avatar'),
            'bound_at' => now(),
        ]);

        return response()->json(['message' => '绑定成功']);
    }
}
```

## 八、Token 刷新与撤销：真正上线后，这块比发 Token 还重要

很多文章只讲“如何拿到 access token”，但在真实业务里，真正天天发生的是：

- token 过期了怎么刷新
- 用户退出登录怎么撤销
- 第三方账号解绑后旧 token 要不要失效
- 安全风险触发后怎么批量踢下线

如果这些没设计好，前面自定义 grant 再漂亮也只是“登录时很帅，运维时很痛”。

### 8.1 刷新 Token

Passport 默认就支持 `refresh_token`。客户端只要保存 refresh token，在 access token 过期后走标准接口即可。

请求示例：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "def50200cbb7...",
    "client_id": "2",
    "client_secret": "social-client-secret",
    "scope": "profile order:read"
  }'
```

前端刷新逻辑伪代码：

```javascript
async function requestWithRefresh(fetcher) {
  let response = await fetcher(getAccessToken());

  if (response.status !== 401) {
    return response;
  }

  const refreshResponse = await fetch('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: getRefreshToken(),
      client_id: APP_CLIENT_ID,
      client_secret: APP_CLIENT_SECRET,
      scope: 'profile order:read'
    })
  });

  if (!refreshResponse.ok) {
    logout();
    throw new Error('Refresh token failed');
  }

  const tokens = await refreshResponse.json();
  saveTokens(tokens);

  return fetcher(tokens.access_token);
}
```

Laravel 服务端如果希望把刷新逻辑包装成一个业务接口，而不是让所有客户端都直接碰 `/oauth/token`，可以通过内部 HTTP 转发 Passport 的标准接口：

```php
<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class RefreshTokenController
{
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'refresh_token' => ['required', 'string'],
        ]);

        $response = Http::asJson()->post(url('/oauth/token'), [
            'grant_type' => 'refresh_token',
            'refresh_token' => $request->input('refresh_token'),
            'client_id' => config('passport.clients.mobile.id'),
            'client_secret' => config('passport.clients.mobile.secret'),
            'scope' => 'profile order:read',
        ]);

        return response()->json($response->json(), $response->status());
    }
}
```

这样做的价值在于：你可以在自有接口里补设备校验、风控、审计与 refresh token rotation，而不是把所有细节都暴露给客户端。

### 8.2 服务端撤销当前 Token

用户主动退出登录时，通常至少要撤销当前 access token，以及与之关联的 refresh token。

```php
<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LogoutController
{
    public function __invoke(Request $request): JsonResponse
    {
        $token = $request->user()->token();

        DB::transaction(function () use ($token) {
            DB::table('oauth_refresh_tokens')
                ->where('access_token_id', $token->id)
                ->update(['revoked' => true]);

            $token->revoke();
        });

        return response()->json(['message' => '已退出登录']);
    }
}
```

### 8.3 撤销某个用户全部 Token

当用户修改密码、解绑关键第三方账号、触发风控冻结时，通常需要一键踢下线。

```php
<?php

namespace App\Services\Auth;

use Illuminate\Support\Facades\DB;

class TokenRevocationService
{
    public function revokeAllTokensForUser(int $userId): void
    {
        $tokenIds = DB::table('oauth_access_tokens')
            ->where('user_id', $userId)
            ->pluck('id');

        if ($tokenIds->isEmpty()) {
            return;
        }

        DB::table('oauth_refresh_tokens')
            ->whereIn('access_token_id', $tokenIds)
            ->update(['revoked' => true]);

        DB::table('oauth_access_tokens')
            ->whereIn('id', $tokenIds)
            ->update(['revoked' => true]);
    }
}
```

如果你需要按设备或指定 token 维度精确撤销，也可以继续扩展：

```php
public function revokeTokenById(string $accessTokenId): void
{
    DB::transaction(function () use ($accessTokenId) {
        DB::table('oauth_refresh_tokens')
            ->where('access_token_id', $accessTokenId)
            ->update(['revoked' => true]);

        DB::table('oauth_access_tokens')
            ->where('id', $accessTokenId)
            ->update(['revoked' => true]);
    });
}
```

配合控制器后，后台就能实现“踢掉某台设备”“撤销最近异常登录”的运维能力：

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Services\Auth\TokenRevocationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RevokeTokenController
{
    public function __invoke(Request $request, TokenRevocationService $service): JsonResponse
    {
        $request->validate([
            'access_token_id' => ['required', 'string'],
        ]);

        $service->revokeTokenById($request->input('access_token_id'));

        return response()->json(['message' => 'Token 已撤销']);
    }
}
```

### 8.4 Refresh Token Rotation 实战示例

如果你的安全要求更高，我建议明确实现“刷新一次、旧 refresh token 立即作废”的 rotation 策略。一个常见做法是在刷新成功后，将当前 refresh token 打上已撤销标记，并记录新旧链路：

```php
<?php

namespace App\Services\Auth;

use Illuminate\Support\Facades\DB;

class RefreshTokenRotationService
{
    public function revokeUsedRefreshToken(string $refreshTokenId): void
    {
        DB::table('oauth_refresh_tokens')
            ->where('id', $refreshTokenId)
            ->update([
                'revoked' => true,
                'updated_at' => now(),
            ]);
    }
}
```

在客户端协议上，也建议返回新的 refresh token 后立即覆盖本地旧值；如果刷新失败或发现 refresh token 已被复用，就强制用户重新登录。这一层看似麻烦，但对防止 token 被截获后长期复用非常有效。

### 8.4 刷新与撤销的时序关系

很多人会踩一个坑：access token 已撤销，但 refresh token 还活着，于是客户端还能继续刷新拿新 token。这通常是因为你只 revoke 了 `oauth_access_tokens`，却没同步处理 `oauth_refresh_tokens`。

所以生产实践里要记住这一条：

```text
撤销 access token != 自动撤销 refresh token
```

建议统一封装撤销逻辑，不要让不同控制器各写各的。

### 8.5 移动端多设备登录策略

真实业务中还会遇到：用户在 iPhone、Android、Web 同时登录，是否允许？如果允许，退出当前设备是否只撤销当前 token？

建议设计 `oauth_access_tokens` 的扩展元数据，比如记录：

- device_id
- platform
- login_ip
- user_agent

你可以额外建一张 `user_login_sessions` 表，将 Passport token id 关联进去：

```php
Schema::create('user_login_sessions', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('access_token_id', 100)->unique();
    $table->string('platform', 32)->nullable();
    $table->string('device_id', 100)->nullable();
    $table->ipAddress('ip')->nullable();
    $table->text('user_agent')->nullable();
    $table->timestamp('last_used_at')->nullable();
    $table->timestamps();
});
```

后续就能实现：

- 退出当前设备
- 仅踢掉其他设备
- 查看最近登录设备
- 风险设备单独撤销

## 九、安全最佳实践：Grant 能跑通只是及格，安全边界才决定你能不能上线

认证系统的安全问题，很多不是代码“有没有错”，而是默认配置能不能扛住真实攻击面。下面这些是我在线上项目里总结下来必须做的。

### 9.1 Access Token 短效，Refresh Token 可轮换

一个常见错误是把 access token 设成 30 天，因为“前端省事”。结果 token 一旦泄漏，风险窗口巨大。

更稳的策略：

- access token：1~2 小时
- refresh token：15~30 天
- 高风险操作要求二次校验

如果你希望更进一步，可以做 refresh token rotation：每次刷新成功后，旧 refresh token 立刻废弃，只保留新 refresh token。

### 9.2 Scope 一定要真实生效，不要只写在文档里

很多系统定义了十几个 scope，结果资源接口根本没校验，实际等于裸奔。

Passport 路由示例：

```php
Route::middleware(['auth:api', 'scopes:order:read'])->group(function () {
    Route::get('/orders', [OrderController::class, 'index']);
});

Route::middleware(['auth:api', 'scopes:order:write'])->group(function () {
    Route::post('/orders', [OrderController::class, 'store']);
});
```

你甚至可以在策略层进一步校验：

```php
public function update(User $user, Order $order): bool
{
    $token = $user->token();

    return $token && $token->can('order:write') && $order->user_id === $user->id;
}
```

### 9.3 第三方 provider 返回的数据不要盲信

典型风险包括：

- 前端伪造 provider_user_id
- 直接传一个假 email 试图撞绑定
- Google id_token 的 aud 并不是你的应用
- 微信 code 已过期或被复用

所以一定要坚持一个原则：

> 自定义 Social Grant 只信任“服务端亲自向 provider 验证过”的身份，不信任客户端自报身份。

### 9.4 Client Secret 不应泄漏到不可信前端

如果是纯移动端/SPA 场景，把真正的 confidential client secret 硬编码到前端，基本等于公开。此时应考虑：

- 第一方前端改走后端代理
- 使用 Authorization Code + PKCE
- 对 mobile/web 端用 public client 思路

我在内部项目里常见的做法是：App/SPA 登录相关的 `/oauth/token` 由你自己的 API 网关或后端 BFF 代发，客户端不要直接掌握敏感 client_secret。

### 9.5 登录、刷新、撤销必须带审计日志

至少记录：

- user_id
- client_id
- provider
- token_id
- ip
- user_agent
- result
- failure_reason

一个简单的日志写法：

```php
logger()->channel('security')->info('oauth_social_login', [
    'user_id' => $user->id,
    'provider' => $profile->provider,
    'provider_user_id' => $profile->providerUserId,
    'client_id' => $client->getIdentifier(),
    'ip' => request()->ip(),
    'user_agent' => request()->userAgent(),
]);
```

这些日志在你查“为什么用户说自己明明没登录过 Google”时会非常有用。

### 9.6 绑定和自动注册要加风控门槛

特别是第三方登录第一次自动注册本地账号时，要考虑：

- 是否允许未验证 email 自动占坑
- 是否需要手机号补全
- 是否需要昵称/头像清洗
- 是否要限制高频创建账号

否则你很可能会得到一堆“用一次 GitHub 就自动创建一个僵尸账号”的数据污染问题。

### 9.7 Passport vs Sanctum vs JWT 方案对比

实际选型时，团队常问的不是“Passport 能不能做”，而是“为什么不用 Sanctum 或纯 JWT”。如果只从“能发 token”这一个维度看，三者都能做；但如果考虑开放平台、标准 OAuth 流程、自定义 Grant Type、多客户端授权治理，差异就非常明显。

| 方案 | 核心定位 | 优势 | 劣势 | 适用场景 |
| --- | --- | --- | --- | --- |
| Laravel Passport | 完整 OAuth 2.0 授权服务器 | 支持 Authorization Code、Client Credentials、自定义 Grant Type、Scope、Refresh Token，适合规范化认证授权 | 体系相对重，配置复杂度高，理解成本高于普通 Token | 开放平台、第三方登录统一换 Token、多客户端授权治理、B2B/B2C 混合认证 |
| Laravel Sanctum | 轻量级 API Token / SPA 认证 | 接入简单，适合 Laravel 一体化项目，Cookie + SPA 体验好 | 不提供完整 OAuth 2.0 授权能力，不适合复杂第三方授权场景 | 单体后台、内部系统、前后端同域 SPA、轻量 API |
| 纯 JWT 自实现/第三方包 | 自定义 Token 签发与校验 | 灵活、轻量、无状态、跨语言接入方便 | 需要自行处理刷新、撤销、黑名单、客户端授权、Scope 与安全策略，工程风险高 | 简单微服务、内部短链路服务鉴权、已具备成熟鉴权基础设施的团队 |

我的经验是：

- **只有第一方前后端、没有开放授权需求**：优先考虑 Sanctum
- **需要标准 OAuth 2.0、第三方登录统一发 Token、可扩展 Grant Type**：优先 Passport
- **已经有成熟网关或统一 IAM，Laravel 只是资源服务器**：可考虑 JWT 对接现有基础设施

如果你的业务已经出现“微信登录、GitHub 登录、App/后台/合作方多客户端并存、还要支持 refresh/revoke/scope”的组合需求，那么 Passport 往往比自己拼一套 JWT 黑名单系统更省长期维护成本。

### 9.8 PKCE 支持建议

对 Web SPA、移动端、公有客户端来说，PKCE 基本已经属于应当默认开启的配置，而不是“可选增强项”。它的核心价值是：即便授权码在跳转链路里被截获，没有正确的 `code_verifier` 也无法换到 token。

Passport 侧的 Authorization Code + PKCE 请求示例：

```bash
curl -X POST https://api.example.com/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "8",
    "redirect_uri": "https://spa.example.com/callback",
    "code": "authorization-code-value",
    "code_verifier": "bR1vY8QwM4d9YqR-very-long-random-string"
  }'
```

前端生成 challenge 的伪代码：

```javascript
async function createPkcePair() {
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return { verifier, challenge };
}
```

对应授权跳转时带上：

- `code_challenge`
- `code_challenge_method=S256`

如果你面对的是不可信前端、公网回调、多终端混合接入，这一层建议尽早纳入默认方案，而不是上线后再补。

## 十、常见踩坑与解决方案：这些坑我基本都踩过

这一节我按“问题现象 -> 原因 -> 解决方案”的方式整理，尽量写成你遇到线上问题时能直接对照排查的形式。

### 10.1 返回 unsupported_grant_type

**现象**：

请求 `/oauth/token` 时传了 `grant_type=social`，结果返回：

```json
{
  "error": "unsupported_grant_type",
  "message": "The authorization grant type is not supported by the authorization server."
}
```

**常见原因**：

1. `AuthorizationServer::enableGrantType()` 没执行到
2. 自定义 ServiceProvider 没注册
3. 配置缓存导致旧容器仍在运行
4. `getIdentifier()` 返回值不是 `social`

**解决方案**：

- 检查 provider 是否在 `config/app.php` 或 bootstrap 注册
- 清理缓存：

```bash
php artisan optimize:clear
```

- 在 `boot()` 中临时打日志确认：

```php
logger()->info('Passport custom social grant enabled');
```

### 10.2 返回 invalid_client

**现象**：

```json
{
  "error": "invalid_client",
  "message": "Client authentication failed"
}
```

**原因**：

- client_id/client_secret 不匹配
- 传错了 client 类型
- 使用了被 revoke 的 client
- 前端把 secret 里的空格、换行弄丢了

**解决方案**：

重新确认客户端：

```bash
php artisan passport:client
```

并检查数据库里的 `oauth_clients`。很多时候根本不是 grant 问题，而是拿了 password client 去调一个你只想给 confidential client 用的流程。

### 10.3 微信登录总是重复创建用户

**现象**：

同一个微信用户每次登录都生成新账号。

**原因**：

- 只用了 `openid`，但来自不同应用场景
- 没存 `unionid`
- `provider_user_id` 生成规则前后不一致

**解决方案**：

```php
$providerUserId = $payload['unionid'] ?? $payload['openid'];
```

并确保老数据迁移时把已有账号做一次归并。这个问题如果早期不处理，后面用户资产合并会很痛。

### 10.4 GitHub 返回 email 为空，导致自动绑定失败

**现象**：

GitHub 登录后没法按 email 匹配已有账号。

**原因**：

用户可能把 email 设为私有，GitHub `/user` 接口返回 `email: null`。

**解决方案**：

额外请求 `/user/emails`，拿 primary + verified email：

```php
$response = $http->request('GET', 'https://api.github.com/user/emails', [
    'headers' => [
        'Authorization' => 'Bearer ' . $token,
        'Accept' => 'application/vnd.github+json',
    ],
]);
```

不要把“GitHub 一定有 email”当默认前提。

### 10.5 刷新 Token 后旧 Refresh Token 还能继续用

**现象**：

客户端每次刷新都成功，旧 refresh token 也一直有效。

**原因**：

默认流程未必符合你想要的 rotation 策略，或者你没有主动撤销旧 refresh token。

**解决方案**：

- 检查当前 Passport/League 版本刷新策略
- 如果要严格 rotation，自己在刷新成功后补撤销逻辑
- 做审计，记录 refresh token 使用次数

### 10.6 第三方登录成功，但 `/api/me` 401

**现象**：

`/oauth/token` 返回正常，但访问资源接口提示未认证。

**原因**：

- `Authorization: Bearer xxx` 头没带
- API guard 不是 passport
- 反向代理丢掉 Authorization 头
- 前端存错 token，拿 refresh token 去调用 API

**解决方案**：

先检查 Nginx：

```nginx
proxy_set_header Authorization $http_authorization;
```

这是线上非常高频但又很容易忽略的坑。

### 10.7 自定义 Grant 在本地可用，线上 500

**现象**：

本地一切正常，生产环境 `/oauth/token` 直接 500。

**原因**：

- Passport key 权限不对
- PHP 扩展缺失
- Guzzle 请求外网 provider 超时
- 配置缓存未更新

**解决方案**：

重点看：

- Laravel 日志
- PHP-FPM 日志
- provider 网络可达性
- `storage/oauth-private.key` 权限

线上绝大部分“突然 500”，最终都不是 Grant 本身语法问题，而是环境差异问题。

## 十一、建议的工程目录结构：别把认证代码散在控制器里

如果你准备把这套方案长期维护下去，我非常建议从一开始就把目录结构规划好。下面是我实践下来比较顺手的一种组织方式：

```text
app/
├── Auth/
│   ├── OAuth/
│   │   ├── Grants/
│   │   │   └── SocialGrant.php
│   │   └── SocialUserRepository.php
│   └── Social/
│       ├── Providers/
│       │   ├── GithubSocialProvider.php
│       │   ├── GoogleSocialProvider.php
│       │   └── WechatSocialProvider.php
│       ├── SocialProviderInterface.php
│       ├── SocialProviderManager.php
│       └── SocialUserProfile.php
├── Http/
│   └── Controllers/
│       └── Auth/
│           ├── GithubCallbackController.php
│           ├── BindSocialAccountController.php
│           └── LogoutController.php
├── Models/
│   ├── User.php
│   └── SocialAccount.php
├── Providers/
│   ├── PassportServiceProvider.php
│   └── SocialAuthServiceProvider.php
└── Services/
    └── Auth/
        ├── SocialAccountService.php
        ├── TokenRevocationService.php
        └── GoogleIdTokenVerifier.php
```

这样做的好处是职责分层清晰：

- OAuth 协议层归 `Auth/OAuth`
- 第三方 provider 归 `Auth/Social`
- 用户绑定和撤销等业务归 `Services/Auth`
- 控制器只做轻量入口

千万不要把微信/GitHub/Google 所有逻辑都堆到一个 `AuthController` 里，短期快，长期一定会变成无法维护的大泥球。

## 十二、测试与联调建议：不要等上线后才验证刷新和撤销

认证系统最怕“只测登录成功，不测边界行为”。我建议至少覆盖以下测试点。

### 12.1 Provider 模拟测试

用 HTTP fake 或 mock provider API，验证 GitHub/Google/微信解析逻辑。

```php
public function test_github_provider_can_fetch_profile(): void
{
    Http::fake([
        'https://api.github.com/user' => Http::response([
            'id' => 1001,
            'login' => 'michael',
            'email' => 'michael@example.com',
            'avatar_url' => 'https://avatar.example.com/a.png',
        ]),
    ]);

    // 调用 provider fetch，断言 profile 字段
}
```

### 12.2 自定义 Grant 接口测试

```php
public function test_social_grant_can_issue_token(): void
{
    $client = Client::factory()->create([
        'password_client' => false,
        'personal_access_client' => false,
        'revoked' => false,
    ]);

    $response = $this->postJson('/oauth/token', [
        'grant_type' => 'social',
        'client_id' => $client->id,
        'client_secret' => 'plain-secret',
        'provider' => 'github',
        'provider_access_token' => 'mock-token',
    ]);

    $response->assertOk()
        ->assertJsonStructure([
            'token_type',
            'expires_in',
            'access_token',
            'refresh_token',
        ]);
}
```

### 12.3 刷新与撤销测试

至少验证：

1. refresh token 能刷新 access token
2. logout 后当前 token 失效
3. revokeAllTokensForUser 后所有设备 token 失效
4. 被撤销 refresh token 不可再次使用

### 12.4 联调 checklist

```text
[ ] /oauth/token 能正常签发 social token
[ ] access token 可访问 auth:api 接口
[ ] refresh token 可换新 token
[ ] logout 会同时撤销 access/refresh token
[ ] 微信同一 unionid 不会重复创建账号
[ ] GitHub email 为空时不会异常崩溃
[ ] Google id_token aud 校验通过
[ ] 安全日志记录完整
```

## 十三、我最终落地时的经验总结：哪些设计值得一开始就做对

写到这里，如果你只想记住几个最关键的结论，我建议记这几条：

### 13.1 不要把第三方登录理解成“另一套登录系统”

它本质上应该只是“另一种身份凭证来源”，最终都统一换成 Passport token。只有这样，你的资源接口、权限系统、刷新撤销逻辑才不会分裂。

### 13.2 自定义 Grant 不要承载所有业务细节

Grant 负责协议流转，provider 负责外部身份验证，service 负责用户映射。只要边界清楚，后面你要加 Apple 登录、企业微信登录，基本就是再加一个 provider 实现，而不是重写整套认证。

### 13.3 微信优先 unionid，GitHub 不要假设一定有 email，Google 不要盲信前端 token

这三条是我踩出来的高频经验。

### 13.4 Token 生命周期、刷新、撤销一定和登录本身一起设计

不要把“先能登录再说”当阶段性合理方案，因为一旦客户端上线，后面再改 token 策略成本会非常高。用户体验、安全风控、设备管理，都和刷新撤销绑定在一起。

### 13.5 审计日志不是锦上添花，是救命设施

认证系统出了问题，你最需要的是“复盘证据”。谁在什么时候通过哪个 provider 登录、用了哪个 client、从哪个 IP 登录、失败原因是什么，这些日志会决定你能不能快速定位问题。

## 十四、结语：Passport 不是终点，而是统一认证能力的起点

Laravel Passport 很适合拿来搭一个规范的 OAuth 2.0 认证层，但它不是“装完就万事大吉”的黑盒。真正决定系统质量的，是你有没有把协议层、用户域、第三方 provider、token 生命周期、安全边界这些东西串成一套可维护的工程方案。

从我的实战体验看，如果你的系统同时存在账号密码、第三方登录、开放平台、移动端多设备登录，那么 Passport + 自定义 Grant Type 这条路是值得走的。它前期确实比“手写一个 token 表”复杂，但一旦体系搭稳，后面的收益很明显：

- 登录方式增加时不再重构整套认证
- 资源接口永远只认统一的 Bearer token
- 刷新、撤销、scope、安全审计都有标准落点
- 第三方登录不再是“额外旁路”，而是正式接入主认证系统

如果你正准备在 Laravel 里落地 Passport，我建议先把基础安装和 token 生命周期配置稳住，再从一个最明确的第三方 provider 开始做自定义 social grant，把链路跑通后再逐个扩展。不要一开始就试图“一把梭支持所有登录方式”，认证系统最怕贪快，最值钱的是边界清晰。

最后附一个本文方案的简化落地清单，方便你实际开工时对照：

```text
1. 安装 Passport，完成表迁移与密钥生成
2. 配置 auth guard、scope、token 生命周期
3. 建 social_accounts 表，拆分本地用户与第三方账号映射
4. 实现 SocialProviderInterface 与各 provider 解析器
5. 实现 SocialAccountService，统一用户绑定/创建逻辑
6. 自定义 SocialGrant，并注册到 AuthorizationServer
7. 接通 /oauth/token grant_type=social
8. 补 refresh token、logout、批量 revoke
9. 加 scope 校验、安全日志、风控策略
10. 覆盖联调与测试，重点验证刷新/撤销/重复绑定边界
```

如果这十步你都做扎实了，那么无论后面你接微信、GitHub、Google，还是再扩展短信登录、企业 SSO，本质上都只是往同一套认证底座上继续加能力，而不是每次都再造一个登录系统。

## 相关阅读

- [API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践](/categories/Laravel/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [敏感数据保护实战：加密存储、脱敏展示、审计日志合规](/categories/Laravel/敏感数据保护实战-加密存储脱敏展示审计日志合规-Laravel-B2C-API踩坑记录/)
- [Flutter 网络请求实战：Dio 封装与 Token 刷新](/categories/Flutter/Flutter-网络请求实战-Dio-封装拦截器错误处理与-Token-刷新踩坑记录/)
