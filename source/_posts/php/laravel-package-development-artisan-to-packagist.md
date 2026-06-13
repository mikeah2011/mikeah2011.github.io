---

title: Laravel Package 开发实战：从 artisan make:package 到 Packagist 发布——Service Provider、Facade、Config
keywords: [Laravel Package, artisan make, package, Packagist, Service Provider, Facade, Config, 开发实战, 发布]
description: Laravel Package 开发全流程实战：从 artisan make:package 脚手架到 Packagist 发布，详解 Service Provider 注册与引导生命周期、Facade 动态代理原理、Config mergeConfigFrom 合并策略，Orchestra Testbench 测试隔离方案与语义化版本发布最佳实践，附完整踩坑记录与十条核心开发规范。
date: 2026-06-05 12:00:00
tags:
- Laravel
- Package
- Composer
- Packagist
- 开源
- service-provider
- facade
- orchestra-testbench
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---




在 Laravel 生态系统中，Package（包）是扩展框架能力的核心载体，也是整个 Composer 生态繁荣的基石。无论你是想封装一套通用的业务逻辑、对接某个第三方 API 服务，还是构建一个可复用的 UI 组件库，掌握 Package 开发都是从"会用框架"到"深度定制框架"的关键跨越。很多开发者在日常项目中会把通用代码放在 `app/Services` 或 `app/Traits` 目录下，这在单个项目中完全没有问题，可一旦你需要在多个项目之间共享同一套逻辑——比如统一的消息通知系统、支付网关封装、权限管理模块——手动复制粘贴代码就成了噩梦，版本不一致、Bug 修复不同步、代码冗余等问题会接踵而至。

本文将以一个真实可运行的示例项目 `laravel-notifier` 为线索，完整走一遍从 `artisan make:package` 脚手架创建、Service Provider 编写、Facade 封装、Config 合并策略、路由视图迁移命令的打包、Orchestra Testbench 测试隔离，到最终发布至 Packagist 的全流程。每一个环节都会配合代码示例和踩坑记录，确保你读完就能动手实践。

<!-- more -->

## 一、Package 开发的价值与适用场景

在正式开始之前，我们有必要先厘清一个问题：什么场景下应该把代码封装成独立的 Package？

第一种场景是**多项目共享**。假设你的公司有五六个 Laravel 项目，都需要发送邮件、短信、Slack 通知，如果每个项目都写一套通知发送的逻辑，维护成本是巨大的。封装成一个 Package 后，所有项目通过 `composer require` 安装，Bug 修复只需改一处，所有项目更新依赖即可同步。

第二种场景是**开源贡献**。如果你开发了一个好用的工具，比如一个图像处理库、一个 Markdown 解析器，发布到 Packagist 后全世界的开发者都可以使用，这不仅提升你的技术影响力，也能收到社区的反馈和贡献。

第三种场景是**架构解耦**。即使在单项目中，将某些功能封装成 Package 也能强制你做好接口设计、依赖管理，让代码的边界更加清晰。这种做法在大型团队中尤其有价值。

Package 相比于直接在项目中写代码，有以下几个核心优势：**版本管理**——通过 Composer 的语义化版本控制，不同项目可以锁定不同版本，升级时可以精确控制影响范围；**依赖隔离**——Package 有独立的 `composer.json`，声明自己的依赖关系，不会和宿主项目的依赖产生冲突；**可测试性**——Package 可以独立编写和运行测试，不依赖宿主项目的配置和数据库；**社区共享**——发布到 Packagist 后，任何 Laravel 开发者都可以通过一条 `composer require` 命令使用你的成果。

## 二、artisan make:package 快速创建 Package 脚手架

在 Laravel 11 之前，创建一个 Package 需要手动创建目录结构、手写 Service Provider、手写 `composer.json`，步骤繁琐且容易出错。Laravel 11 引入了 `artisan make:package` 命令，极大简化了这个过程。

### 基本用法

在你的 Laravel 项目根目录下执行：

```bash
php artisan make:package notifier --namespace="Mike\\Notifier"
```

这条命令会在项目根目录下生成一个 `packages/mike/notifier` 目录，包含完整的 Package 骨架。你也可以通过 `--path` 参数指定自定义路径：

```bash
php artisan make:package notifier --namespace="Mike\\Notifier" --path=./packages/notifier
```

如果你的 Package 需要包含数据库迁移，可以加上 `--migration` 选项。需要包含一个 Artisan 命令的话，加上 `--command` 选项。需要生成测试文件的话，加 `--test` 选项。所有选项可以组合使用：

```bash
php artisan make:package notifier \
    --namespace="Mike\\Notifier" \
    --migration=create_notifier_messages_table \
    --command=SendNotificationCommand \
    --test
```

### 生成的目录结构详解

执行完毕后，你会看到如下完整的目录结构：

```
packages/mike/notifier/
├── config/
│   └── notifier.php              # Package 默认配置文件
├── database/
│   └── migrations/               # 数据库迁移文件
├── resources/
│   ├── views/                    # Blade 视图模板
│   └── lang/                     # 多语言翻译文件
├── routes/
│   └── web.php                   # Package 路由定义
├── src/
│   ├── Notifier.php              # 核心业务逻辑类
│   ├── NotifierFacade.php        # Facade 门面类
│   ├── NotifierServiceProvider.php # Service Provider 服务提供者
│   ├── Contracts/                # 接口定义目录
│   │   └── NotifierInterface.php
│   ├── Services/                 # 服务实现目录
│   │   └── NotificationManager.php
│   ├── Channels/                 # 通知渠道实现
│   │   ├── MailChannel.php
│   │   ├── SlackChannel.php
│   │   └── DatabaseChannel.php
│   ├── Exceptions/               # 自定义异常
│   │   └── ChannelNotFoundException.php
│   ├── Events/                   # 事件定义
│   │   └── NotificationSent.php
│   └── Commands/                 # Artisan 命令
│       ├── NotifierCommand.php
│       └── CheckNotificationsCommand.php
├── tests/
│   ├── Unit/                     # 单元测试
│   │   └── NotifierTest.php
│   ├── Feature/                  # 功能测试
│   │   └── SendNotificationTest.php
│   └── TestCase.php              # 测试基类
├── composer.json                  # Composer 包描述文件
├── phpunit.xml                    # PHPUnit 配置
├── CHANGELOG.md                   # 版本变更日志
├── LICENSE.md                     # 开源许可证
└── README.md                      # 项目说明文档
```

### 目录结构的设计哲学

这个目录结构遵循了 Laravel 社区的约定俗成规范。`src/` 目录存放所有 PHP 源代码，通过 PSR-4 自动加载映射到 `Mike\Notifier` 命名空间。`config/` 目录存放配置文件，最终会通过 Service Provider 合并到宿主项目的配置系统中。`database/migrations/` 存放数据库迁移文件，用户安装后可以发布到自己的 `database/migrations` 目录。`resources/views/` 存放 Blade 视图模板，`resources/lang/` 存放多语言文件。`routes/` 存放路由定义，`tests/` 存放测试代码。

这种结构的好处在于**职责分离**：每个目录只负责一类资源，开发者一目了然。同时它也和 Laravel 应用本身的目录结构保持了一致性，降低了认知负担。

### 命名规范

Package 的命名严格遵循 Composer 的 `vendor/package` 约定。在 `artisan make:package` 中，vendor 名称通常使用你的 GitHub 用户名或组织名，比如 `mike`；package 名称应该简短且具有描述性，比如 `notifier`。PHP 命名空间对应 `Mike\Notifier`，使用首字母大写的 PascalCase。包全名写成 `mike/notifier`，全小写，用 `/` 分隔 vendor 和 package。

有一个特别需要注意的地方：**千万不要使用 `laravel/` 作为你的 vendor 前缀**，这是 Laravel 官方保留的命名空间。同理，`illuminate/` 也是保留前缀。如果你的 vendor 名称叫 `mike`，那 `composer.json` 中的 `name` 字段就应该是 `mike/notifier`，而不是 `mike/laravel-notifier`——虽然文件夹名可以叫 `laravel-notifier`，但 Composer 包名中的 vendor 部分不能是 `laravel`。

## 三、composer.json 配置详解

`artisan make:package` 生成的 `composer.json` 已经包含了基础框架，但我们需要根据实际情况进行调整和完善。下面是一个经过实战检验的配置：

```json
{
    "name": "mike/notifier",
    "description": "A flexible multi-channel notification package for Laravel applications",
    "keywords": ["laravel", "notification", "notifier", "mail", "slack"],
    "homepage": "https://github.com/mikeah2011/laravel-notifier",
    "license": "MIT",
    "authors": [
        {
            "name": "Mike",
            "email": "mike@example.com",
            "homepage": "https://mike.dev",
            "role": "Developer"
        }
    ],
    "require": {
        "php": "^8.1",
        "illuminate/support": "^10.0|^11.0|^12.0",
        "illuminate/mail": "^10.0|^11.0|^12.0",
        "illuminate/notifications": "^10.0|^11.0|^12.0"
    },
    "require-dev": {
        "orchestra/testbench": "^8.0|^9.0|^10.0",
        "phpunit/phpunit": "^10.0|^11.0",
        "laravel/pint": "^1.0"
    },
    "autoload": {
        "psr-4": {
            "Mike\\Notifier\\": "src/"
        },
        "files": [
            "src/helpers.php"
        ]
    },
    "autoload-dev": {
        "psr-4": {
            "Mike\\Notifier\\Tests\\": "tests/"
        }
    },
    "extra": {
        "laravel": {
            "providers": [
                "Mike\\Notifier\\NotifierServiceProvider"
            ],
            "aliases": {
                "Notifier": "Mike\\Notifier\\NotifierFacade"
            }
        }
    },
    "config": {
        "sort-packages": true,
        "allow-plugins": {
            "pestphp/pest-plugin": true
        }
    },
    "minimum-stability": "dev",
    "prefer-stable": true
}
```

这里面有几个关键点需要特别说明。

首先是 `extra.laravel` 字段，这是 Laravel 的**包自动发现机制（Package Auto-Discovery）**，从 Laravel 5.5 开始引入。当用户通过 `composer require mike/notifier` 安装你的 Package 时，Laravel 会自动读取这个字段来注册 Service Provider 和 Facade，用户完全不需要手动修改 `config/app.php`。这极大降低了安装成本，也是现代 Laravel Package 的标配。

其次是 `require` 中的 illuminate 组件。最佳实践是**只声明你真正依赖的组件**，而不是整个 `laravel/framework`。这样做的好处有两个：一是减小安装体积，避免拉入不需要的依赖；二是提高兼容性，你的 Package 甚至可以在 Lumen 微框架中使用。

最后是 `require-dev` 中的 `orchestra/testbench`，它是 Laravel Package 测试的基石工具，后面我们会用专门的章节详细介绍它的使用方法。

## 四、Service Provider 的注册与引导——Package 的灵魂

Service Provider 是 Laravel Package 的核心入口，也是连接 Package 代码与 Laravel 应用的桥梁。每一个 Laravel Package 都必须有一个 Service Provider，它负责两件至关重要的事情：**注册（register）** 和 **引导（boot）**。

理解这两个方法的区别和执行顺序，是 Package 开发的第一道门槛。很多初学者在这里栽跟头，把不该放在 `register()` 中的代码放了进去，导致各种诡异的错误。

### register() 方法详解

`register()` 方法用于将服务绑定到 Laravel 的服务容器中。这个阶段有一个非常重要的约束：**不应该依赖其他尚未注册的服务**。因为 Laravel 启动时，所有 Package 的 `register()` 方法是依次执行的，你无法保证其他 Package 的 Service Provider 已经完成了注册。

```php
<?php

namespace Mike\Notifier;

use Illuminate\Support\ServiceProvider;
use Mike\Notifier\Services\NotificationManager;
use Mike\Notifier\Contracts\NotifierInterface;

class NotifierServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 第一步：合并配置文件
        // mergeConfigFrom 必须在 register 中调用
        // 这样后续绑定服务时才能通过 config() 读取到默认配置
        $this->mergeConfigFrom(
            __DIR__ . '/../config/notifier.php', 'notifier'
        );

        // 第二步：将核心服务绑定到容器
        // 使用 singleton 确保整个请求周期内只创建一个实例
        $this->app->singleton(NotifierInterface::class, function ($app) {
            return new NotificationManager(
                $app['config']['notifier']
            );
        });

        // 第三步：注册 Facade 使用的容器键
        // 这个键名对应 Facade 类中 getFacadeAccessor() 的返回值
        $this->app->bind('notifier', function ($app) {
            return $app->make(NotifierInterface::class);
        });

        // 第四步：注册其他服务
        $this->app->singleton('notifier.channel.manager', function ($app) {
            return new \Mike\Notifier\Services\ChannelManager(
                $app['config']['notifier.channels']
            );
        });
    }
}
```

在 `register()` 中我们做了四件事：合并配置、绑定核心服务到容器、注册 Facade 的容器键、注册其他辅助服务。注意这里我们使用了 `singleton` 而不是 `bind`，因为通知管理器在整个请求周期内应该是单例的，重复创建没有意义且浪费资源。

### boot() 方法详解

`boot()` 方法在所有 Service Provider 都完成 `register()` 之后才被调用。在这个阶段，你可以安全地使用其他服务，因为所有 Package 都已经完成了注册。在这里你可以注册路由、发布资源文件、注册视图组件、注册事件监听器等。

```php
public function boot(): void
{
    // 注册 Blade 自定义指令
    $this->app->booted(function () {
        // 通过闭包延迟执行，确保视图服务已就绪
    });

    // 处理控制台环境特有的逻辑
    if ($this->app->runningInConsole()) {
        // 发布配置文件到宿主项目
        // 用户执行 php artisan vendor:publish --tag=notifier-config
        $this->publishes([
            __DIR__ . '/../config/notifier.php' => config_path('notifier.php'),
        ], 'notifier-config');

        // 发布迁移文件
        // 用户执行 php artisan vendor:publish --tag=notifier-migrations
        $this->publishes([
            __DIR__ . '/../database/migrations/' => database_path('migrations'),
        ], 'notifier-migrations');

        // 发布视图模板，让用户可以自定义覆盖
        $this->publishes([
            __DIR__ . '/../resources/views' => resource_path('views/vendor/notifier'),
        ], 'notifier-views');

        // 发布语言文件
        $this->publishes([
            __DIR__ . '/../resources/lang' => resource_path('lang/vendor/notifier'),
        ], 'notifier-lang');

        // 注册 Artisan 命令
        $this->commands([
            \Mike\Notifier\Commands\SendNotificationCommand::class,
            \Mike\Notifier\Commands\CheckNotificationsCommand::class,
            \Mike\Notifier\Commands\PruneNotificationsCommand::class,
        ]);
    }

    // 加载路由文件
    $this->loadRoutesFrom(__DIR__ . '/../routes/web.php');

    // 加载视图目录，使用 'notifier' 作为视图命名空间
    // 在 Blade 中通过 @include('notifier::email.notification') 使用
    $this->loadViewsFrom(__DIR__ . '/../resources/views', 'notifier');

    // 加载翻译文件，使用 'notifier' 作为翻译命名空间
    // 在代码中通过 trans('notifier::messages.success') 使用
    $this->loadTranslationsFrom(__DIR__ . '/../resources/lang', 'notifier');

    // 加载数据库迁移
    $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
}
```

### register 与 boot 的执行顺序——最容易踩的坑

这个执行顺序问题值得我们用一个时间线来说明：

```
应用启动
  ├── 所有 Package 的 register() 依次执行
  │     ├── Package A: register()
  │     ├── Package B: register()  ← 你不能在这里使用 Package A 的服务
  │     ├── Package C: register()
  │     └── ...
  └── 所有 Package 的 boot() 依次执行
        ├── Package A: boot()      ← 现在可以安全使用其他 Package 的服务了
        ├── Package B: boot()
        ├── Package C: boot()
        └── ...
```

一个非常常见的错误是在 `register()` 中调用 `$this->app['view']` 来注册 Blade 指令——此时视图服务可能尚未就绪，会抛出异常。正确的做法是把这类操作放在 `boot()` 中，或者使用 `$this->app->booted()` 回调来延迟执行。

另一个常见错误是在 `register()` 中读取其他 Package 的配置——此时那些 Package 的 `mergeConfigFrom` 可能还没有执行，你读到的配置是不完整的。如果需要读取配置，应该在 `boot()` 中进行。

## 五、Facade 实现原理与自定义 Facade

Facade 是 Laravel 的标志性特性之一，它让开发者可以用简洁的静态调用语法来访问容器中的服务。很多初学者误以为 Facade 是"静态方法调用"或者"静态代理"，实际上它是一个**动态代理**，底层通过 PHP 的 `__callStatic()` 魔术方法将调用转发到容器中的真实实例。

### Facade 的工作原理

当你在代码中写 `Notifier::send('user@example.com', 'Hello')` 时，实际发生了以下几个步骤：

第一步，PHP 引擎发现 `Notifier` 类（实际上是 `NotifierFacade`）没有名为 `send` 的静态方法，于是触发 `__callStatic()` 魔术方法。

第二步，`__callStatic()` 方法定义在 Laravel 的基类 `Illuminate\Support\Facades\Facade` 中，它会调用当前 Facade 子类的 `getFacadeAccessor()` 方法，获取容器绑定键名。在我们的例子中，这个键名是 `'notifier'`。

第三步，通过 `Facade::getFacadeRoot()` 从 Laravel 的服务容器中解析出 `'notifier'` 对应的真实实例——也就是我们在 Service Provider 中通过 `$this->app->bind('notifier', ...)` 绑定的对象。

第四步，将原始的静态方法调用 `$method = 'send'` 和参数 `$args = ['user@example.com', 'Hello']` 转发到真实实例上，即 `$instance->send('user@example.com', 'Hello')`。

整个过程对调用者来说是透明的，你只需要写一行简洁的静态调用代码，就能享受容器管理的所有好处：依赖注入、单例管理、易于替换实现。

### 编写自定义 Facade

```php
<?php

namespace Mike\Notifier;

use Illuminate\Support\Facades\Facade;

/**
 * @method static bool send(string $recipient, string $message, string $channel = null)
 * @method static \Mike\Notifier\PendingNotification channel(string $channel)
 * @method static array getHistory(string $recipient = null, int $limit = 50)
 *
 * @see \Mike\Notifier\Services\NotificationManager
 */
class NotifierFacade extends Facade
{
    /**
     * 获取注册到容器中的组件名称。
     *
     * @return string
     */
    protected static function getFacadeAccessor(): string
    {
        return 'notifier';
    }
}
```

注意代码中的 PHPDoc 注释 `@method static` 和 `@see`，这不是多余的装饰——它们能让 IDE（如 PhpStorm、VS Code）正确识别 Facade 的静态方法并提供代码补全和类型提示。如果没有这些注释，IDE 会认为 `Notifier::send()` 是一个未定义的方法，给出红色警告，开发体验会大打折扣。

### 何时使用 Facade，何时直接注入？

这是一个经典的最佳实践问题。简单的原则是：**在可注入的地方优先使用依赖注入，在无法注入的地方使用 Facade**。

在 Controller、Job、Middleware 等 Laravel 自动解析的类中，推荐使用构造函数注入：

```php
class NotificationController extends Controller
{
    public function __construct(
        private readonly NotifierInterface $notifier
    ) {}

    public function store(Request $request)
    {
        $this->notifier->send($request->input('email'), $request->input('message'));
    }
}
```

在 Blade 模板中，由于无法直接进行依赖注入，使用 Facade 是最方便的方式。在快速原型开发中，Facade 也能帮你少写不少代码。

## 六、Config 合并策略：mergeConfigFrom 与 publish 的区别

Package 的配置管理是很多开发者容易忽略的细节，也是最容易引发线上问题的环节之一。Laravel 提供了两种机制来处理 Package 配置，它们各自适用不同的场景，理解它们的区别至关重要。

### mergeConfigFrom——运行时合并

`mergeConfigFrom` 方法在 `register()` 中调用，它的作用是将 Package 的默认配置文件与宿主项目中已有的同名配置进行**深度合并**。注意这里的关键词是"合并"而不是"覆盖"——如果用户在 `config/notifier.php` 中自定义了某些键值，这些自定义值会保留，只有用户没有定义的键值才会从 Package 的默认配置中补全。

这意味着你的默认配置文件应该提供**完整的默认值**，包含每一个配置项和它们的合理默认值。这样即使用户没有发布配置文件，Package 也能正常工作。

```php
<?php
// config/notifier.php

return [
    /*
    |--------------------------------------------------------------------------
    | 默认通知渠道
    |--------------------------------------------------------------------------
    | 当调用 Notifier::send() 时没有指定渠道，使用此默认渠道。
    | 支持的渠道：mail, slack, database, sms
    |--------------------------------------------------------------------------
    */
    'default_channel' => env('NOTIFIER_DEFAULT_CHANNEL', 'mail'),

    /*
    |--------------------------------------------------------------------------
    | 渠道配置
    |--------------------------------------------------------------------------
    | 每个通知渠道的独立配置。你只需要配置你实际使用的渠道。
    |--------------------------------------------------------------------------
    */
    'channels' => [
        'mail' => [
            'from_address' => env('NOTIFIER_MAIL_FROM', 'noreply@example.com'),
            'from_name' => env('NOTIFIER_MAIL_NAME', config('app.name')),
            'template' => 'notifier::email.notification',
        ],
        'slack' => [
            'webhook_url' => env('NOTIFIER_SLACK_WEBHOOK'),
            'channel' => env('NOTIFIER_SLACK_CHANNEL', '#general'),
            'username' => env('NOTIFIER_SLACK_USERNAME', 'Notifier Bot'),
            'icon' => env('NOTIFIER_SLACK_ICON', ':bell:'),
        ],
        'database' => [
            'table' => 'notifier_messages',
            'connection' => env('NOTIFIER_DB_CONNECTION'),
        ],
        'sms' => [
            'provider' => env('NOTIFIER_SMS_PROVIDER', 'twilio'),
            'from_number' => env('NOTIFIER_SMS_FROM'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | 重试策略
    |--------------------------------------------------------------------------
    | 发送失败后的重试配置。
    |--------------------------------------------------------------------------
    */
    'retry' => [
        'enabled' => true,
        'max_attempts' => 3,
        'delay_seconds' => 60,
        'backoff_multiplier' => 2,
    ],

    /*
    |--------------------------------------------------------------------------
    | 速率限制
    |--------------------------------------------------------------------------
    | 防止通知发送过于频繁，避免触发第三方服务的限流。
    |--------------------------------------------------------------------------
    */
    'rate_limit' => [
        'enabled' => false,
        'max_per_minute' => 60,
        'max_per_hour' => 1000,
    ],

    /*
    |--------------------------------------------------------------------------
    | 日志配置
    |--------------------------------------------------------------------------
    */
    'logging' => [
        'enabled' => true,
        'channel' => env('NOTIFIER_LOG_CHANNEL', 'stack'),
        'log_successful' => false,
        'log_failed' => true,
    ],
];
```

### publish——文件系统发布

`publishes()` 方法在 `boot()` 中调用，它的作用是将 Package 的配置文件**复制**到宿主项目的 `config/` 目录。这个操作是一次性的，用户执行后文件就永久存在于宿主项目中，可以自由修改。

```bash
# 发布所有可发布资源
php artisan vendor:publish --provider="Mike\Notifier\NotifierServiceProvider"

# 只发布配置文件
php artisan vendor:publish --tag=notifier-config

# 只发布视图文件
php artisan vendor:publish --tag=notifier-views

# 强制覆盖已存在的文件
php artisan vendor:publish --tag=notifier-config --force
```

### 两者的本质区别

| 特性 | mergeConfigFrom | publishes |
|------|-----------------|-----------|
| 调用位置 | `register()` 方法中 | `boot()` 方法中 |
| 执行时机 | 每次请求自动执行 | 用户手动执行一次 |
| 是否修改文件系统 | 否，纯内存操作 | 是，复制文件到宿主项目 |
| 用户如何自定义 | 通过环境变量 `.env` | 直接编辑发布的配置文件 |
| 适用场景 | 提供智能默认值 | 允许深度定制 |

**最佳实践**：两者必须配合使用。`mergeConfigFrom` 确保即使用户没有发布配置文件，Package 也能使用合理的默认值正常工作；`publishes` 让需要深度定制的用户可以将配置文件复制到自己的项目中自由修改。这是一个"开箱即用"与"高度可定制"之间的平衡。

## 七、路由、视图、迁移、命令的打包

### 路由打包

Package 可以携带自己的路由定义，这对于提供管理后台、API 接口等场景非常有用。路由文件通常放在 `routes/` 目录下：

```php
<?php
// routes/web.php
use Illuminate\Support\Facades\Route;
use Mike\Notifier\Http\Controllers\NotificationController;

Route::prefix('api/notifier')
    ->middleware(['api', 'auth:sanctum'])
    ->group(function () {
        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::post('/notifications', [NotificationController::class, 'store']);
        Route::get('/notifications/{id}', [NotificationController::class, 'show']);
        Route::delete('/notifications/{id}', [NotificationController::class, 'destroy']);
    });

// 管理后台路由
Route::prefix('admin/notifier')
    ->middleware(['web', 'auth', 'verified'])
    ->group(function () {
        Route::get('/', [NotificationController::class, 'adminIndex']);
        Route::get('/settings', [NotificationController::class, 'settings']);
        Route::post('/settings', [NotificationController::class, 'updateSettings']);
    });
```

在 Service Provider 的 `boot()` 中通过 `$this->loadRoutesFrom()` 加载。路径是相对于 `src/` 目录的，所以用 `__DIR__ . '/../routes/web.php'` 指向 Package 根目录下的路由文件。

**重要提醒**：为 Package 路由添加独立的中间件组和 URL 前缀，避免与宿主项目路由发生冲突。如果你的 Package 提供了可配置的路由前缀，可以在配置文件中定义，然后在路由文件中读取。

### 视图打包

Blade 视图模板放在 `resources/views/` 目录下，通过 `$this->loadViewsFrom()` 加载时会指定一个命名空间。在 Blade 模板中使用时，必须加上命名空间前缀：

```blade
{{-- 使用 Package 的视图 --}}
@include('notifier::email.notification')

{{-- 在控制器中 --}}
return view('notifier::email.notification', $data);
```

发布视图后用户可以自由覆盖模板：

```bash
php artisan vendor:publish --tag=notifier-views
```

发布后的视图会复制到 `resources/views/vendor/notifier/` 目录，Laravel 会优先加载 `vendor/` 下的视图，实现了视图的可覆盖性。

### 迁移打包

数据库迁移文件是 Package 提供数据持久化能力的标准方式。迁移文件名建议使用 Package 特有的前缀，避免与用户项目的迁移文件冲突：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifier_messages', function (Blueprint $table) {
            $table->id();
            $table->string('channel');
            $table->string('recipient');
            $table->string('subject')->nullable();
            $table->text('body');
            $table->string('status')->default('pending')->index();
            $table->unsignedSmallInteger('priority')->default(0);
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('sent_at')->nullable()->index();
            $table->timestamp('read_at')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['channel', 'status']);
            $table->index(['recipient', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifier_messages');
    }
};
```

**注意**：迁移文件名不要使用具体的日期前缀（如 `2026_06_05_000000_create_...`），建议使用 `0000_00_00_000000_` 这样的占位前缀。原因是用户发布迁移的时间不确定，用固定前缀可以确保 Package 内的多个迁移文件保持正确的执行顺序。

### Artisan 命令打包

Package 可以注册自定义的 Artisan 命令，让用户可以通过命令行与 Package 交互：

```php
<?php

namespace Mike\Notifier\Commands;

use Illuminate\Console\Command;
use Mike\Notifier\Contracts\NotifierInterface;

class SendNotificationCommand extends Command
{
    protected $signature = 'notifier:send 
        {--channel= : 通知渠道名称，如 mail、slack、database}
        {--to= : 接收人地址}
        {--subject= : 通知标题}
        {--message= : 通知内容}
        {--priority=0 : 优先级，0为最低}';

    protected $description = '通过指定渠道发送一条通知消息';

    public function handle(NotifierInterface $notifier): int
    {
        $channel = $this->option('channel') ?? config('notifier.default_channel');
        $to = $this->option('to');
        $message = $this->option('message');

        if (!$to || !$message) {
            $this->error('错误：必须指定 --to 和 --message 参数');
            $this->line('用法示例：');
            $this->line('  php artisan notifier:send --channel=mail --to=user@example.com --message="Hello"');
            return self::FAILURE;
        }

        $this->info("正在通过 [{$channel}] 渠道发送通知...");

        try {
            $result = $notifier
                ->channel($channel)
                ->to($to)
                ->subject($this->option('subject') ?? 'Notification')
                ->priority((int) $this->option('priority'))
                ->send($message);

            if ($result) {
                $this->info("✓ 通知已成功发送至 {$to}");
                return self::SUCCESS;
            }

            $this->error('✗ 通知发送失败');
            return self::FAILURE;
        } catch (\Exception $e) {
            $this->error("✗ 发送异常：{$e->getMessage()}");
            return self::FAILURE;
        }
    }
}
```

## 八、测试隔离：Orchestra Testbench 完全指南

Package 测试与应用测试的最大区别在于：**Package 没有完整的 Laravel 应用环境**。你没有 `config/app.php`、没有 `.env` 文件、没有默认的 Service Provider 注册列表。如果直接运行 PHPUnit，你的代码连 `app()` 辅助函数都用不了。

Orchestra Testbench 就是为了解决这个问题而生的工具。它创建了一个临时的、精简的 Laravel 应用环境，只包含你声明的 Service Provider，让你可以独立测试 Package 的每一个功能。

### 安装配置

```bash
composer require --dev orchestra/testbench
```

### 编写测试基类

这是整个测试体系的基石，所有测试类都应该继承这个基类：

```php
<?php

namespace Mike\Notifier\Tests;

use Orchestra\Testbench\TestCase as BaseTestCase;
use Mike\Notifier\NotifierServiceProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // 这里可以做额外的初始化，比如创建测试数据
    }

    /**
     * 注册 Package 的 Service Provider
     * Orchestra Testbench 会自动调用这个方法
     */
    protected function getPackageProviders($app): array
    {
        return [
            NotifierServiceProvider::class,
        ];
    }

    /**
     * 注册 Package 的 Facade 别名
     */
    protected function getPackageAliases($app): array
    {
        return [
            'Notifier' => \Mike\Notifier\NotifierFacade::class,
        ];
    }

    /**
     * 定义环境配置
     * 可以覆盖 Package 和 Laravel 的默认配置
     */
    protected function defineEnvironment($app): void
    {
        $app['config']->set('notifier.default_channel', 'database');
        $app['config']->set('notifier.channels.database.connection', 'testing');
        $app['config']->set('notifier.rate_limit.enabled', false);
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);
    }

    /**
     * 加载 Package 的迁移文件
     */
    protected function defineDatabaseMigrations(): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
        $this->loadLaravelMigrations(['--database' => 'testing']);
    }

    /**
     * 定义路由（可选）
     */
    protected function defineRoutes($router): void
    {
        // 可以在这里定义测试专用的路由
    }
}
```

### 编写单元测试

```php
<?php

namespace Mike\Notifier\Tests\Unit;

use Mike\Notifier\Tests\TestCase;
use Mike\Notifier\Services\NotificationManager;
use Mike\Notifier\Contracts\NotifierInterface;

class NotifierManagerTest extends TestCase
{
    public function test_notifier_is_resolved_from_container(): void
    {
        $notifier = $this->app->make(NotifierInterface::class);
        $this->assertInstanceOf(NotificationManager::class, $notifier);
    }

    public function test_notifier_is_singleton(): void
    {
        $instance1 = $this->app->make(NotifierInterface::class);
        $instance2 = $this->app->make(NotifierInterface::class);
        $this->assertSame($instance1, $instance2);
    }

    public function test_facade_returns_correct_instance(): void
    {
        $facadeInstance = \Mike\Notifier\NotifierFacade::getFacadeRoot();
        $containerInstance = $this->app->make(NotifierInterface::class);
        $this->assertSame($facadeInstance, $containerInstance);
    }

    public function test_config_has_all_required_keys(): void
    {
        $this->assertIsString(config('notifier.default_channel'));
        $this->assertIsArray(config('notifier.channels'));
        $this->assertArrayHasKey('mail', config('notifier.channels'));
        $this->assertArrayHasKey('slack', config('notifier.channels'));
        $this->assertArrayHasKey('database', config('notifier.channels'));
        $this->assertIsArray(config('notifier.retry'));
    }
}
```

### 编写功能测试

```php
<?php

namespace Mike\Notifier\Tests\Feature;

use Mike\Notifier\Tests\TestCase;
use Mike\Notifier\Facades\NotifierFacade;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Event;
use Mike\Notifier\Events\NotificationSent;

class SendNotificationTest extends TestCase
{
    public function test_can_send_via_database_channel(): void
    {
        Event::fake();

        $result = NotifierFacade::channel('database')
            ->send('test@example.com', 'Hello World');

        $this->assertTrue($result);
        $this->assertDatabaseHas('notifier_messages', [
            'channel' => 'database',
            'recipient' => 'test@example.com',
            'body' => 'Hello World',
        ]);
    }

    public function test_can_send_via_mail_channel(): void
    {
        Mail::fake();

        NotifierFacade::channel('mail')
            ->send('user@example.com', 'Test Subject', 'Test Body');

        Mail::assertSent(
            \Mike\Notifier\Mail\NotificationMail::class,
            function ($mail) {
                return $mail->hasTo('user@example.com');
            }
        );
    }

    public function test_default_channel_is_used_when_not_specified(): void
    {
        $result = NotifierFacade::send('user@example.com', 'Default channel test');

        $this->assertTrue($result);
        $this->assertDatabaseHas('notifier_messages', [
            'channel' => config('notifier.default_channel'),
            'recipient' => 'user@example.com',
        ]);
    }

    public function test_invalid_channel_throws_exception(): void
    {
        $this->expectException(\Mike\Notifier\Exceptions\ChannelNotFoundException::class);

        NotifierFacade::channel('invalid_channel')
            ->send('user@example.com', 'Test');
    }
}
```

### 测试隔离的核心原则

测试隔离是保证测试可靠性的关键。以下是几条必须遵守的原则：

**第一，不依赖外部服务**。邮件、短信、Slack 等第三方服务必须用 Laravel 提供的 Fake/Mock 机制替代。`Mail::fake()`、`Notification::fake()`、`Event::fake()` 是你的好朋友。

**第二，数据库使用 SQLite 内存模式**。Orchestra Testbench 默认使用 SQLite 内存数据库，测试结束后数据库自动销毁，不会留下任何脏数据。

**第三，每次测试独立运行**。使用 `RefreshDatabase` trait 确保每个测试方法执行前数据库都是干净的状态。不要依赖测试的执行顺序。

**第四，配置隔离**。通过 `defineEnvironment()` 方法覆盖配置，绝对不要修改真实的配置文件。测试的配置修改不应该影响到其他测试。

## 九、Packagist 发布完整流程

### 准备工作清单

在发布到 Packagist 之前，请确保以下事项都已完成：

1. **代码推送到独立的 GitHub 仓库**。Package 应该有自己的仓库，不要和应用代码混在一起。
2. **完善 README.md**。这是用户了解你 Package 的第一入口，必须包含项目简介、安装说明、快速开始、配置说明、高级用法、API 文档、贡献指南。
3. **添加 LICENSE 文件**。开源项目推荐 MIT 许可证，简单宽松。
4. **编写 CHANGELOG.md**。记录每个版本的变更内容。
5. **运行测试确保全部通过**。`vendor/bin/phpunit`。
6. **检查代码风格**。使用 `vendor/bin/pint --test` 确保符合 PSR-12 规范。

### 注册 Packagist

1. 访问 [https://packagist.org](https://packagist.org)，使用 GitHub 账号登录。
2. 点击页面右上角的 "Submit" 按钮。
3. 粘贴你的 GitHub 仓库 URL，例如 `https://github.com/mikeah2011/laravel-notifier`。
4. Packagist 会自动检测 `composer.json` 并验证包名。
5. 点击 "Check" 验证，如果没有错误，点击 "Submit" 完成注册。

### 配置 GitHub Webhook 实现自动更新

为了让 Packagist 在你推送新的 Git tag 时自动更新 Package 版本，需要配置 GitHub Webhook：

1. 进入 GitHub 仓库页面 → Settings → Webhooks → Add webhook。
2. 在 Payload URL 中填入 Packagist 给你的 Webhook URL（在 Packagist 包页面的 "Service" 选项卡中可以找到）。
3. Content type 选择 `application/json`。
4. SSL verification 选择 Enable。
5. 事件选择 "Just the push event"。
6. 点击 "Add webhook" 保存。

### 语义化版本发布

Packagist 通过 Git Tag 来识别版本号，版本号必须遵循**语义化版本规范（Semantic Versioning, SemVer）**：

```bash
# 首次正式发布
git add .
git commit -m "feat: initial release with mail, slack, database channels"
git tag -a v1.0.0 -m "v1.0.0 - Initial release"
git push origin main --tags

# 后续版本：新增功能（次版本）
git tag -a v1.1.0 -m "v1.1.0 - Add SMS channel support"
git push origin v1.1.0

# 后续版本：Bug 修复（修订版本）
git tag -a v1.1.1 -m "v1.1.1 - Fix database channel deadlock"
git push origin v1.1.1

# 破坏性变更（主版本）
git tag -a v2.0.0 -m "v2.0.0 - Drop PHP 8.0 support, new API"
git push origin v2.0.0
```

版本号格式为 `主版本.次版本.修订号`：主版本在有不兼容的 API 修改时递增；次版本在添加向下兼容的新功能时递增；修订号在向下兼容的 Bug 修复时递增。

**特别注意**：tag 名称建议以 `v` 开头（如 `v1.0.0`），Packagist 能正确识别这种格式。不要随意创建 tag，每个 tag 都代表一个可安装的版本。

## 十、CHANGELOG 与版本管理最佳实践

### CHANGELOG 规范

维护一个清晰的 CHANGELOG 是对使用者负责的体现。推荐遵循 [Keep a Changelog](https://keepachangelog.com/) 规范：

```markdown
# Changelog

All notable changes to `mike/notifier` will be documented in this file.

## [1.2.0] - 2026-06-01

### Added
- 新增 Webhook 通知渠道，支持自定义 Webhook URL 和请求头
- 新增 `notifier:status` 命令，可查看指定通知的发送状态
- 支持通知模板自定义，用户可发布并覆盖默认视图模板

### Changed
- 优化 Slack 渠道的错误处理，失败时返回详细错误信息
- 将默认重试次数从 5 改为 3，避免长时间占用队列

### Fixed
- 修复高并发场景下数据库渠道可能出现的死锁问题
- 修复邮件渠道在队列模式下附件丢失的 Bug

### Deprecated
- `Notifier::quickSend()` 方法将在 v2.0 移除，请迁移至 `Notifier::send()`

### Removed
- 移除对 PHP 8.0 的支持，最低要求 PHP 8.1

## [1.1.0] - 2026-04-15

### Added
- 新增 SMS 通知渠道，支持 Twilio 和阿里云短信
- 支持通知优先级设置，高优先级通知会优先发送
- 新增速率限制功能，防止通知发送过于频繁

### Fixed
- 修复配置合并时多维数组深度不一致导致的配置丢失问题

## [1.0.0] - 2026-03-01

### Added
- 初始发布
- 支持 Mail、Slack、Database 三种通知渠道
- Service Provider 自动注册与 Facade 支持
- 完整的配置合并与发布机制
- 基础的 Artisan 命令支持
```

## 十一、真实踩坑记录与最佳实践

### 踩坑一：config:cache 后 Package 配置丢失

**现象**：用户执行 `php artisan config:cache` 后，Package 的默认配置值消失了，导致运行时报错。

**根因**：`mergeConfigFrom` 是在运行时动态合并的。执行 `config:cache` 时，Laravel 会遍历所有配置文件并生成缓存，但 `mergeConfigFrom` 注册的配置不在这个缓存流程中。如果用户没有先发布配置文件（`vendor:publish`），缓存中就缺少 Package 的配置。

**解决方案**：在文档中明确告知用户：在执行 `config:cache` 之前，必须先通过 `php artisan vendor:publish --tag=notifier-config` 发布配置文件。或者在 Service Provider 中添加检测逻辑，如果检测到缓存文件存在但 Package 配置缺失，输出警告信息。

### 踩坑二：Package Auto-Discovery 不生效

**现象**：用户安装了你的 Package，但 Service Provider 没有自动注册，提示类找不到。

**根因**：`composer.json` 中 `extra.laravel.providers` 的类名与实际代码中的命名空间不一致。比如你写的是 `Mike\\Notifier\\NotifierServiceProvider`，但实际文件中的命名空间是 `Mike\\Notifier\\Providers\\NotifierServiceProvider`。

**解决方案**：仔细核对 `composer.json` 中的完整类名，确保与实际文件中的 `namespace` + `class name` 完全匹配。安装后检查 `vendor/composer/installed.json` 中是否正确记录了你的 Package 信息。

### 踩坑三：测试中 Facade 返回 null 或报错

**现象**：在 Orchestra Testbench 测试中调用 Facade 方法时报 "Target class [notifier] does not exist" 或返回 null。

**根因**：TestCase 基类中没有正确实现 `getPackageProviders()` 方法，导致 Service Provider 没有被注册，容器中自然找不到 `'notifier'` 绑定。

**解决方案**：确保 TestCase 基类中 `getPackageProviders()` 返回了你 Package 的所有 Service Provider。如果 Package 有多个 Service Provider，都要列出来。

### 踩坑四：多 Package 之间的迁移文件冲突

**现象**：你的 Package 的迁移文件名和另一个 Package 或用户项目的迁移文件名重复了。

**根因**：迁移文件名太通用，如 `create_messages_table`、`create_logs_table` 等。

**解决方案**：为迁移文件添加 Package 特有的前缀，如 `create_notifier_messages_table`。如果可能，尽量使用匿名类迁移（Laravel 9+）而不是命名类，避免类名冲突。

### 踩坑五：loadRoutesFrom 加载顺序问题

**现象**：Package 路由中的中间件不生效，或者路由被宿主项目的路由意外覆盖。

**根因**：路由加载顺序问题。如果你的 Package 路由在宿主项目路由之前加载，可能被后加载的路由覆盖。

**解决方案**：在路由文件中使用唯一的路由名称和 URL 前缀。避免使用过于通用的路径，如 `/api/notifications`，改为 `/api/notifier/notifications`。在 Service Provider 中，考虑让用户可以配置是否加载 Package 路由。

### 最佳实践总结

经过大量实战项目的经验积累，以下是 Laravel Package 开发的十条核心最佳实践：

**一、只依赖你需要的 illuminate 组件**。不要 `require laravel/framework`，精确声明 `illuminate/support`、`illuminate/database` 等具体组件。这能减小依赖范围，提高兼容性。

**二、优先定义接口（Contracts）**。在 `Contracts/` 目录中定义接口，让用户可以在自己的 Service Provider 中替换实现。面向接口编程是 SOLID 原则中依赖倒置的体现。

**三、提供队列支持**。如果 Package 涉及耗时操作，比如发送大量邮件、调用外部 API，一定要提供队列支持。让通知发送等操作可以通过 Laravel 的队列系统异步执行。

**四、编写完善的文档**。README 中必须包含：项目简介、安装步骤、快速开始示例、完整配置说明、高级用法、API 文档、贡献指南、许可证信息。

**五、严格遵守语义化版本**。破坏性变更必须升主版本号，否则会引发依赖地狱，让使用者的项目在 `composer update` 后突然崩溃。

**六、集成 CI/CD**。使用 GitHub Actions 在每次 Push 和 Pull Request 时自动运行测试、静态分析（PHPStan/Psalm）、代码风格检查。确保 main 分支始终是可发布的状态。

**七、不要硬编码路径**。使用 `__DIR__`、`base_path()`、`resource_path()`、`config_path()` 等辅助函数，不要在代码中写死绝对路径或假设特定的目录结构。

**八、关注 Service Provider 性能**。如果你的 Package 比较重，包含大量的类绑定和配置处理，考虑使用延迟加载的 Deferred Provider。它只在容器中对应的服务被实际请求时才执行注册，避免拖慢应用启动速度。

**九、提供 Facade 的 PHPDoc 注解**。为 Facade 类添加 `@method static` 注解和 `@see` 指向真实类的引用，让 IDE 能正确提供代码补全和类型检查，大幅改善使用体验。

**十、关注向下兼容**。在添加新功能时，尽量保持现有 API 的稳定性。如果需要废弃某个方法，先添加 `@deprecated` 注解，在 CHANGELOG 中说明，并至少保留一个主版本的过渡期。

## 结语

Laravel Package 开发是一项系统工程，它涉及到服务容器、依赖注入、配置管理、自动加载、测试隔离等多个核心概念。但一旦你理解了 Service Provider 的 register/boot 生命周期、Facade 的动态代理机制、配置的合并策略，以及 Orchestra Testbench 的测试隔离模式，整个流程就会变得非常自然和顺畅。

从 `artisan make:package` 一键生成脚手架开始，到精心编写 Service Provider 和核心业务逻辑，再到使用 Orchestra Testbench 确保测试的完整性和独立性，最后通过语义化版本和 Packagist 将你的成果分享给全世界——每一步都有 Laravel 生态工具链的强力支撑。

建议你从一个小而精的 Package 开始实践，比如封装一个你日常项目中反复使用的工具类或服务封装。当你第一次在另一个项目中通过 `composer require` 安装自己的 Package 并成功运行时，那种成就感是无与伦比的。从个人工具到团队共享，从内部使用到开源社区，Package 开发之路就在你脚下。祝你在 Laravel Package 开发的道路上越走越远！

## 相关阅读

- [Laravel Service Container 源码剖析：上下文绑定、标签、build 解析链路](/categories/Laravel/PHP/Laravel-Service-Container-源码剖析-上下文绑定-tags-build解析链路/)
- [PHP 8.5 Pipe Operator 实战进阶：链式数据处理管道与 Laravel Pipeline 的互补设计](/categories/PHP/Laravel/2026-06-05-php85-pipe-operator-chain-data-processing-laravel-pipeline/)
- [Laravel 幂等性设计模式实战：请求去重、支付回调防重复、Exactly-Once](/categories/PHP/Laravel/Laravel-幂等性设计模式实战-请求去重-支付回调防重复-Exactly-Once/)
