---
title: Laravel Package 开发实战：从 artisan make:package 到 Packagist 发布——Service Provider、Facade、Config 合并与测试隔离
date: 2026-06-05 10:00:00
tags: [Laravel, Package, Composer, Packagist, PHP]
categories:
  - php
cover: /images/covers/laravel-package-development-cover.jpg
description: Laravel Package 开发全流程实战指南，从 artisan make:package 脚手架搭建到 Packagist 正式发布。深入解析 Service Provider 生命周期、Facade 门面模式原理、Config 配置合并策略，详解 Orchestra Testbench 测试隔离方案与 PHPUnit 集成测试最佳实践。涵盖版本管理、CHANGELOG 维护、CI/CD 自动化发布流程，附带完整的 geo-fence 示例包源码，帮助 PHP 开发者掌握 Composer 包开发的核心技能与社区贡献规范。
---

# Laravel Package 开发实战：从 artisan make:package 到 Packagist 发布

## 引言：为什么要开发 Laravel Package？复用 vs 复制粘贴

在日常的 Laravel 项目开发中，我们经常会遇到这样的场景：某个功能模块——比如统一的权限校验、API 签名验证、或者一个多租户方案——在多个项目中反复出现。最初的做法可能是直接复制粘贴代码到新项目里，简单粗暴却也立竿见影。然而随着项目的增长，这种做法的弊端很快显现：

- **Bug 修复需要在 N 个仓库里重复操作**：当你发现某个算法存在边界条件错误时，你必须逐个仓库排查并修复，这不仅效率低下，而且极易遗漏。
- **功能迭代无法统一推进**：每个项目的代码逐渐分化，最终变成了"长得很像但细节完全不同"的四不像，你无法为它们统一增加新特性。
- **代码质量参差不齐**：在复制过程中，不同开发者可能会根据自己的理解进行修改，久而久之，同一个功能在不同项目中的实现方式可能完全不同。
- **缺乏版本管理**：你无法追踪某个功能在不同项目中的演进历史，也无法回滚到某个已知的稳定状态。

这就是 Laravel Package 存在的根本原因。Package 是 Laravel 生态的基石，它将可复用的功能封装成独立的 Composer 包，通过 Service Provider 接入应用的生命周期，通过 Facade 提供优雅的 API，通过 Config 文件实现可定制化。一个设计良好的 Package 不仅能在自己的多个项目中复用，还能通过 Packagist 分享给整个 Laravel 社区。

你可能已经在使用无数优秀的第三方 Package 了——Spatie 的权限管理包、Intervention 的图片处理包、Barryvdh 的调试工具包等。这些 Package 的共同特点是：它们都有清晰的接口设计、完善的文档、健壮的测试覆盖，以及活跃的社区维护。学习如何开发自己的 Package，不仅能提升你的代码组织能力，更能让你深入理解 Laravel 框架的内部工作原理——因为在开发 Package 的过程中，你需要真正理解服务容器、服务提供者、门面模式等核心概念。

本文将带你走完从零开始开发一个 Laravel Package 的完整流程：从项目脚手架搭建、核心机制解析，到测试隔离策略、版本管理，最终发布到 Packagist。我们不仅讲解"怎么做"，更深入探讨"为什么这么做"。让我们开始吧。

---

## 一、环境准备：两种起点

### 1.1 使用 artisan make:package（Laravel 11+）

从 Laravel 11 开始，框架内置了 `make:package` 命令，可以快速生成 Package 的骨架结构。这是官方推荐的方式，生成的代码结构完全符合 Laravel 的最佳实践：

```bash
php artisan make:package mikeah/geo-fence --workbench
```

`--workbench` 选项会在应用的 `workbench/` 目录下创建一个本地开发环境，方便你在不发布到 Packagist 的情况下迭代开发。workbench 目录本质上是一个独立的 Laravel 应用实例，它拥有自己的 `app/`、`config/`、`routes/` 等结构，你可以在这里编写示例代码、测试路由和控制器，而不会污染主应用的代码。

生成的结构包括 `src/`、`config/`、`database/`、`tests/` 等标准目录，同时还会自动创建 `composer.json` 和 `phpunit.xml` 等配置文件。命令还会提示你输入作者名、描述等元数据，帮你生成一个开箱即用的项目骨架。

### 1.2 使用 Spatie Package Skeleton Laravel

Spatie 维护的 `package-skeleton-laravel` 是社区中最流行的 Package 模板，被无数开源 Package 采用。它开箱即集成了以下工具链：

```bash
git clone https://github.com/spatie/package-skeleton-laravel.git geo-fence
cd geo-fence
composer install
```

模板默认包含 Pest 测试框架、PHPStan 静态分析、Laravel Pint 代码风格检查，以及 GitHub Actions CI 配置。对于大多数场景，这个模板是更好的起点，因为它已经为你解决了许多"配置地狱"的问题——你不需要手动配置 CI 流水线、静态分析规则或代码风格检查。

克隆之后，运行模板自带的配置脚本：

```bash
php ./configure.php
```

脚本会交互式地询问你的包名（如 `mikeah/geo-fence`）、PHP 命名空间（如 `Mikeah\GeoFence`）、作者信息、支持的 Laravel 版本范围等，然后自动替换模板中的所有占位符。这个过程大概需要一分钟，完成后你就拥有了一个完全配置好的 Package 开发环境。

**两种方式如何选择？** 如果你的 Laravel 项目版本 >= 11，且希望在主应用中边开发边调试，那么 `make:package --workbench` 是更好的选择。如果你打算从独立仓库开始开发，或者想要一套经过社区验证的成熟工具链配置，那么 Spatie 的 skeleton 更适合你。

---

## 二、Package 目录结构详解

理解目录结构是开发 Package 的基础。一个典型的 Laravel Package 结构如下：

```
geo-fence/
├── config/
│   └── geo-fence.php          # 配置文件，会与应用配置合并
├── database/
│   ├── factories/              # 模型工厂（可选）
│   └── migrations/             # 数据库迁移文件
├── resources/
│   ├── lang/                   # 语言文件
│   └── views/                  # Blade 视图模板
├── routes/
│   ├── api.php                 # API 路由定义
│   └── web.php                 # Web 路由定义（可选）
├── src/
│   ├── Commands/               # Artisan 命令
│   ├── Concerns/               # Trait 集合
│   ├── Contracts/              # 接口定义
│   ├── Events/                 # 事件类
│   ├── Exceptions/             # 异常类
│   ├── Facades/                # Facade 门面类
│   ├── Listeners/              # 监听器
│   ├── Models/                 # Eloquent 模型
│   ├── Services/               # 服务类
│   ├── GeoFence.php            # 核心业务类
│   ├── GeoFenceManager.php     # 管理器类（用于多驱动支持）
│   └── GeoFenceServiceProvider.php  # 服务提供者
├── tests/
│   ├── Feature/                # 功能测试
│   ├── Unit/                   # 单元测试
│   ├── Pest.php                # Pest 配置
│   └── TestCase.php            # 基础测试用例
├── .editorconfig               # 编辑器配置
├── .github/
│   ├── ISSUE_TEMPLATE/         # Issue 模板
│   └── workflows/
│       ├── phpstan.yml         # 静态分析 CI
│       └── run-tests.yml       # 测试 CI
├── .gitignore
├── CHANGELOG.md                # 版本变更记录
├── LICENSE.md                  # 许可证（通常为 MIT）
├── README.md                   # 项目说明文档
├── composer.json               # Composer 配置
└── phpunit.xml                 # PHPUnit 配置
```

这里有几个关键约定需要深入理解：

- **`src/`**：所有 PHP 代码放在这个目录下。在 `composer.json` 中，你的命名空间通过 PSR-4 自动加载映射到此处。比如 `Mikeah\GeoFence\` 命名空间对应 `src/`，那么 `src/Services/FenceChecker.php` 的完整类名就是 `Mikeah\GeoFence\Services\FenceChecker`。

- **`config/`**：Package 的配置文件存放目录。通过 Service Provider 的 `mergeConfigFrom` 方法，这些配置会被合并到应用的 `config/` 目录中。配置文件的命名应该与 Package 名称一致，避免与其他 Package 冲突。

- **`database/migrations/`**：迁移文件。迁移文件名应该包含时间戳前缀，并且避免与用户应用的迁移文件名冲突。推荐在迁移文件名中加上 Package 前缀，如 `2026_01_01_000000_create_geo_fences_table.php`。

- **`tests/`**：测试代码。Package 的测试不能直接使用 Laravel 的 `TestCase`，而是需要使用 Orchestra Testbench 来模拟完整的 Laravel 应用环境。这一点我们会在后文详细讲解。

- **`Contracts/`**：接口定义目录。对于复杂的 Package，使用接口（Contract）来定义核心功能的抽象，可以提高可扩展性和可测试性。用户可以通过实现不同的接口来替换默认的行为。

- **`composer.json`**：这是 Package 的核心配置文件，不仅定义了元数据和依赖关系，还通过 `extra.laravel` 部分配置了 Auto-Discovery 的行为。

`composer.json` 中的自动加载配置是 Package 能正常工作的基础：

```json
{
    "name": "mikeah/geo-fence",
    "description": "A geofencing package for Laravel applications",
    "type": "library",
    "license": "MIT",
    "require": {
        "php": "^8.2",
        "illuminate/contracts": "^10.0|^11.0|^12.0"
    },
    "require-dev": {
        "orchestra/testbench": "^8.0|^9.0|^10.0",
        "pestphp/pest": "^2.0|^3.0",
        "phpstan/phpstan": "^1.0",
        "laravel/pint": "^1.0"
    },
    "autoload": {
        "psr-4": {
            "Mikeah\\GeoFence\\": "src/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Mikeah\\GeoFence\\Tests\\": "tests/"
        }
    },
    "extra": {
        "laravel": {
            "providers": [
                "Mikeah\\GeoFence\\GeoFenceServiceProvider"
            ],
            "aliases": {
                "GeoFence": "Mikeah\\GeoFence\\Facades\\GeoFence"
            }
        }
    },
    "minimum-stability": "dev",
    "prefer-stable": true
}
```

注意 `require` 中使用 `illuminate/contracts` 而不是 `laravel/framework`——这样你的 Package 就只依赖接口合约，而不是整个框架，大大减少了潜在的依赖冲突。`extra.laravel` 部分是 **Package Auto-Discovery** 的核心配置，我们会在后文详述。

---

## 三、Service Provider 核心

Service Provider 是 Package 与 Laravel 框架之间的桥梁，也是整个 Package 最重要的入口点。理解它的生命周期对开发高质量的 Package 至关重要。

### 3.1 register() vs boot()

这是 Service Provider 中最容易混淆的两个方法，也是初学者最常犯错的地方。关键区别在于**执行时机**：

- **`register()`**：在所有 Provider 的 `register()` 阶段顺序执行。此时其他 Provider 可能尚未注册完毕，所以只能做**绑定**操作（将类或闭包注册到服务容器），不能依赖其他 Provider 提供的服务。这是 Laravel 应用启动的第一阶段。

- **`boot()`**：在**所有** Provider 都完成 `register()` 之后才执行。这是执行依赖其他已注册服务的操作的正确位置，比如注册路由、加载视图、注册命令等。

为什么要这样设计？因为 Laravel 在启动时需要先收集所有服务注册，确保服务容器是完整的，然后再执行需要跨服务协调的初始化逻辑。这类似于"先声明、后使用"的原则。

```php
<?php

namespace Mikeah\GeoFence;

use Illuminate\Support\ServiceProvider;

class GeoFenceServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // ✅ 正确：只做绑定，不依赖其他服务
        // 合并默认配置，即使用户没有 publish 配置文件也能工作
        $this->mergeConfigFrom(
            __DIR__.'/../config/geo-fence.php', 'geo-fence'
        );

        // 将核心管理器注册为单例，避免重复实例化
        $this->app->singleton('geo-fence', function ($app) {
            return new GeoFenceManager($app['config']['geo-fence']);
        });

        // 使用接口绑定实现，方便用户替换具体实现
        $this->app->bind(
            \Mikeah\GeoFence\Contracts\FenceChecker::class,
            \Mikeah\GeoFence\Services\HaversineFenceChecker::class
        );
    }

    public function boot(): void
    {
        // ✅ 正确：依赖其他已注册的服务

        // 仅在 CLI 环境注册命令，避免 HTTP 请求中加载不必要的代码
        if ($this->app->runningInConsole()) {
            $this->commands([
                \Mikeah\GeoFence\Commands\CheckFenceCommand::class,
                \Mikeah\GeoFence\Commands\InstallGeoFenceCommand::class,
            ]);
        }

        // 加载路由文件
        $this->loadRoutesFrom(__DIR__.'/../routes/api.php');

        // 加载视图，指定命名空间
        $this->loadViewsFrom(__DIR__.'/../resources/views', 'geo-fence');

        // 加载语言文件
        $this->loadTranslationsFrom(__DIR__.'/../resources/lang', 'geo-fence');

        // 允许用户发布配置文件
        $this->publishes([
            __DIR__.'/../config/geo-fence.php' => config_path('geo-fence.php'),
        ], 'geo-fence-config');

        // 允许用户发布迁移文件
        $this->publishes([
            __DIR__.'/../database/migrations/' => database_path('migrations'),
        ], 'geo-fence-migrations');

        // 允许用户发布语言文件
        $this->publishes([
            __DIR__.'/../resources/lang/' => resource_path('lang/vendor/geo-fence'),
        ], 'geo-fence-lang');
    }
}
```

一个**非常常见的错误**是在 `register()` 中调用了尚未注册的门面或服务。比如，如果你在 `register()` 中使用 `Route::` 门面来注册路由，那么当你的 Provider 在其他 Provider 之前被加载时，`Route` 门面背后的服务可能尚未注册，导致异常。记住这个简单的规则：**`register()` 管绑定，`boot()` 管行为**。

### 3.2 延迟加载（Deferred Providers）

如果你的 Package 只提供了一个绑定，且该绑定在请求中未必会被用到（比如只在用户调用某个特定 API 时才需要），可以实现 `DeferrableProvider` 接口来延迟加载，提升性能：

```php
use Illuminate\Contracts\Support\DeferrableProvider;

class GeoFenceServiceProvider extends ServiceProvider implements DeferrableProvider
{
    public function register(): void
    {
        // 只做绑定，不做任何初始化
        $this->app->singleton(GeoFenceManager::class, function ($app) {
            return new GeoFenceManager($app['config']['geo-fence']);
        });

        $this->mergeConfigFrom(
            __DIR__.'/../config/geo-fence.php', 'geo-fence'
        );
    }

    public function boot(): void
    {
        // 延迟加载的 Provider 中不建议在 boot() 做太多事情
        // 因为 boot() 仍然会在应用启动时执行
        // 如果你需要延迟 boot()，需要自己实现逻辑
    }

    public function provides(): array
    {
        // 告诉框架这个 Provider 能提供哪些绑定
        // 只有当应用真正解析这些绑定时，Provider 的 register() 才会被调用
        return [GeoFenceManager::class];
    }
}
```

`provides()` 方法告诉框架这个 Provider 能提供哪些绑定。当应用解析到这些绑定时，框架才会加载 Provider 并执行 `register()`。注意，即使使用了延迟加载，`boot()` 方法仍然会在应用启动时执行，所以不要在 `boot()` 中做昂贵的操作。

延迟加载的典型应用场景包括：只在特定条件下才需要的服务（如邮件发送、队列处理）、需要复杂初始化逻辑的服务、或者在请求中不太可能被用到的服务。

### 3.3 publishes() 资源发布

`publishes()` 是 Package 与用户之间的"契约"——它允许用户通过 `vendor:publish` 将 Package 的配置、视图、迁移等文件复制到项目中进行自定义：

```bash
# 发布配置文件
php artisan vendor:publish --provider="Mikeah\GeoFence\GeoFenceServiceProvider" --tag="geo-fence-config"

# 发布迁移文件
php artisan vendor:publish --tag="geo-fence-migrations"

# 发布所有资源
php artisan vendor:publish --tag="geo-fence"

# 发布并强制覆盖（覆盖已存在的文件）
php artisan vendor:publish --tag="geo-fence-config" --force
```

最佳实践是给**不同类型的资源打不同的 tag**，方便用户按需发布，而不是一股脑全部复制过去。用户可能只需要自定义配置，而不需要修改视图或迁移。同时，发布后的文件已经与 Package 解耦，Package 更新时不会覆盖用户的自定义修改。

---

## 四、Facade 实现

Facade 在 Laravel 中并不是"表面功夫"，它是一种通过静态方法调用底层对象的优雅设计模式。理解 Facade 的工作原理，有助于你写出更清晰、更易测试的代码。

### 4.1 基础 Facade 实现

Facade 的核心机制是**访问器模式（Accessor Pattern）**：它通过 `getFacadeAccessor()` 返回一个字符串标识（通常是服务容器中的绑定 key），框架会从服务容器中解析出对应的实例，然后将静态方法调用转发给该实例。

```php
<?php

namespace Mikeah\GeoFence\Facades;

use Illuminate\Support\Facades\Facade;

class GeoFence extends Facade
{
    /**
     * 获取注册到容器中的存根名称。
     *
     * @return string
     */
    protected static function getFacadeAccessor(): string
    {
        // 对应 Service Provider 中 $this->app->singleton('geo-fence', ...) 的 key
        return 'geo-fence';
    }
}
```

这样，用户就可以在代码中这样使用：

```php
use Mikeah\GeoFence\Facades\GeoFence;

// 优雅的静态调用，底层实际调用的是 GeoFenceManager 实例的方法
$isInside = GeoFence::isWithin($lat, $lng, $fenceName);
$nearest  = GeoFence::findNearestFence($lat, $lng);
$fences   = GeoFence::all();

// 创建围栏
GeoFence::create('office', [
    'center' => ['lat' => 39.9042, 'lng' => 116.4074],
    'radius' => 200,
]);
```

而底层调用的实际上是 `GeoFenceManager` 实例的方法。Facade 是"语法糖"，但它真正的好处在于：

1. **简洁的 API**：用户不需要手动解析服务容器，直接使用静态方法即可。
2. **可测试性**：Laravel 提供了 `Facade::fake()` 机制来轻松 mock 任何 Facade，这在测试中非常有用。
3. **IDE 支持**：配合 `@method` 注解或 IDE Helper 生成的辅助文件，可以获得完整的代码补全和类型检查。

### 4.2 Real-time Facade

Laravel 5.4+ 引入了 **Real-time Facade**，它允许你在运行时将任何类当作 Facade 使用，无需手动创建 Facade 类：

```php
use Mikeah\GeoFence\GeoFenceManager;

// 在类名前加上 Facades\ 命名空间前缀，即可当作 Facade 使用
use Facades\Mikeah\GeoFence\GeoFenceManager as GeoFence;

// 现在可以使用静态方法调用了
$isInside = GeoFence::isWithin($lat, $lng, $fenceName);
```

Real-time Facade 的原理是 Laravel 的自动加载器会拦截 `Facades\` 前缀的类名，并在运行时动态生成对应的 Facade 类。

Real-time Facade 在快速原型开发中非常方便，但对于发布的 Package，建议还是创建正式的 Facade 类，原因如下：

1. **IDE 友好**：正式的 Facade 类可以有完整的类型提示和文档注释，IDE 可以正确推断返回类型。
2. **可控性**：你可以在 Facade 类中添加额外的逻辑，比如参数验证、日志记录或性能监控。
3. **清晰度**：用户通过 Facade 类就能直接了解可用的 API，不需要去查看底层服务类。
4. **稳定性**：正式的 Facade 不依赖自动加载器的拦截机制，在某些边缘情况下更加可靠。

---

## 五、Config 合并策略

配置管理是 Package 开发中最容易出错的环节之一。你需要让用户能够自定义行为，同时提供合理的默认值，还需要考虑配置文件不存在时的降级处理。

### 5.1 mergeConfigFrom vs publishes

这两个方法的角色完全不同，但经常被混淆：

```php
// 在 register() 中调用 —— 将默认配置与应用配置合并
// 用户即使没有 publish 配置文件，Package 也能读取到默认值
// 这是 Package 正常工作的基础保障
$this->mergeConfigFrom(
    __DIR__.'/../config/geo-fence.php', 'geo-fence'
);

// 在 boot() 中调用 —— 允许用户将配置文件发布到项目中进行自定义
// 用户修改发布后的配置文件后，这些修改会覆盖 Package 的默认值
$this->publishes([
    __DIR__.'/../config/geo-fence.php' => config_path('geo-fence.php'),
], 'geo-fence-config');
```

**完整执行流程**：

1. 用户安装 Package，执行 `composer require mikeah/geo-fence`。
2. 用户**没有**执行 `vendor:publish`，配置文件只存在于 Package 内部。
3. `mergeConfigFrom` 将 Package 的默认配置与应用的配置进行深度合并。此时 `config('geo-fence.default_radius')` 能正确返回 Package 的默认值 `100`。
4. 用户觉得默认配置不合适，执行 `vendor:publish`，将配置文件发布到 `config/geo-fence.php`。
5. 用户修改发布后的配置文件，比如将 `default_radius` 改为 `200`。
6. 下次请求时，框架以**用户修改后的配置为优先**，Package 的默认值仅作为兜底。

### 5.2 配置文件设计最佳实践

```php
<?php
// config/geo-fence.php

return [
    /*
    |--------------------------------------------------------------------------
    | Default Radius
    |--------------------------------------------------------------------------
    |
    | 默认围栏半径（单位：米），当创建围栏时未指定半径时使用此值。
    | 合理范围：10 - 10000
    |
    */
    'default_radius' => env('GEO_FENCE_DEFAULT_RADIUS', 100),

    /*
    |--------------------------------------------------------------------------
    | Cache TTL
    |--------------------------------------------------------------------------
    |
    | 围栏边界的缓存时间（单位：秒）。
    | 设置为 0 可禁用缓存。生产环境建议设置为 3600（1小时）。
    |
    */
    'cache_ttl' => env('GEO_FENCE_CACHE_TTL', 3600),

    /*
    |--------------------------------------------------------------------------
    | Calculation Driver
    |--------------------------------------------------------------------------
    |
    | 距离计算驱动。支持以下选项：
    | - "haversine": Haversine 公式，适用于大多数场景
    | - "vincenty": Vincenty 公式，精度更高但计算更慢
    |
    */
    'driver' => env('GEO_FENCE_DRIVER', 'haversine'),

    /*
    |--------------------------------------------------------------------------
    | Driver-Specific Configuration
    |--------------------------------------------------------------------------
    |
    | 各驱动的特定配置项。
    |
    */
    'drivers' => [
        'haversine' => [
            'earth_radius' => 6371000, // 地球半径（米）
        ],
        'vincenty' => [
            'precision' => 1e-12,
            'max_iterations' => 200,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Models
    |--------------------------------------------------------------------------
    |
    | Package 使用的 Eloquent 模型类。如果你需要自定义模型
    | （比如添加软删除、自定义表名等），可以在这里替换。
    |
    */
    'models' => [
        'fence' => \Mikeah\GeoFence\Models\Fence::class,
    ],
];
```

好的配置文件应该具备以下特点：清晰的结构层次、详细的注释说明（同时支持中英文）、合理的默认值、支持环境变量覆盖（`env()` 函数）、以及对不同驱动/策略的支持。

**特别注意**：在使用 `env()` 时，只有在 `config/` 目录下的文件中使用才有效。因为 Laravel 在生产环境会缓存配置（`php artisan config:cache`），缓存后 `env()` 函数不再可用。这是设计 `mergeConfigFrom` 的一个重要考量——它确保了配置在缓存后仍然正常工作。

---

## 六、路由、视图、命令、迁移的注册

除了核心的服务绑定和配置管理，一个完整的 Package 通常还需要注册路由、视图、命令和迁移等组件。

### 6.1 路由注册

```php
// boot() 中注册路由
$this->loadRoutesFrom(__DIR__.'/../routes/api.php');

// routes/api.php
use Illuminate\Support\Facades\Route;
use Mikeah\GeoFence\Http\Controllers\FenceController;

Route::prefix('api/geo-fence')
    ->middleware('api')
    ->name('geo-fence.')
    ->group(function () {
        Route::post('/check', [FenceController::class, 'check'])
            ->name('check');
        Route::get('/fences', [FenceController::class, 'index'])
            ->name('fences.index');
        Route::post('/fences', [FenceController::class, 'store'])
            ->name('fences.store');
        Route::delete('/fences/{fence}', [FenceController::class, 'destroy'])
            ->name('fences.destroy');
    });
```

**最佳实践**：为路由添加 `name` 前缀（如 `geo-fence.`），避免与用户应用中的路由名称冲突。同时，中间件应该尽量简洁，让用户可以通过配置来覆盖。

### 6.2 视图注册

```php
// boot() 中
$this->loadViewsFrom(__DIR__.'/../resources/views', 'geo-fence');

// 在 Blade 中使用带命名空间前缀的视图
// @include('geo-fence::dashboard')
// return view('geo-fence::admin.fences');
```

### 6.3 命令注册

```php
// boot() 中
if ($this->app->runningInConsole()) {
    $this->commands([
        \Mikeah\GeoFence\Commands\InstallGeoFenceCommand::class,
        \Mikeah\GeoFence\Commands\SyncFencesCommand::class,
        \Mikeah\GeoFence\Commands\PruneExpiredFencesCommand::class,
    ]);
}
```

`runningInConsole()` 检查确保命令只在 CLI 环境注册，避免在 HTTP 请求中加载不必要的代码。这是一个简单但有效的性能优化。

### 6.4 迁移注册

```php
// 方式一：自动加载（用户不需要手动发布）
if (! class_exists('CreateGeoFencesTable')) {
    $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
}

// 方式二：允许用户手动发布（推荐用于开源包）
$this->publishes([
    __DIR__.'/../database/migrations/' => database_path('migrations'),
], 'geo-fence-migrations');
```

两种方式各有适用场景：`loadMigrationsFrom` 适合内部包或你希望零配置运行的场景；`publishes` 适合开源包，因为用户可能需要自定义表名、添加额外字段或调整索引。许多开源 Package 同时提供两种方式，让用户自行选择。

---

## 七、测试隔离

测试是 Package 开发中最重要的环节之一。与应用不同，Package 需要在**没有完整 Laravel 应用**的环境下运行测试，这意味着你需要一个工具来模拟 Laravel 的核心功能。

### 7.1 Orchestra Testbench

[Orchestra Testbench](https://github.com/orchestral/testbench) 是测试 Laravel Package 的事实标准。它创建了一个最小化的 Laravel 应用环境，包含了服务容器、路由、视图等核心组件，但不包含完整的应用配置和中间件栈：

```bash
composer require --dev orchestra/testbench
```

```php
<?php

namespace Mikeah\GeoFence\Tests;

use Mikeah\GeoFence\GeoFenceServiceProvider;
use Orchestra\Testbench\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * 注册 Package 的 Service Provider。
     * 相当于在 Laravel 应用的 config/app.php 中注册。
     */
    protected function getPackageProviders($app): array
    {
        return [
            GeoFenceServiceProvider::class,
        ];
    }

    /**
     * 设置测试环境的配置。
     * 在应用启动之前执行，可以覆盖任何配置值。
     */
    protected function getEnvironmentSetUp($app): void
    {
        $app['config']->set('geo-fence.default_radius', 50);
        $app['config']->set('geo-fence.driver', 'haversine');
        $app['config']->set('geo-fence.cache_ttl', 0); // 测试中禁用缓存
    }

    /**
     * 定义数据库迁移。
     * 自动在每个测试前运行迁移，测试后回滚。
     */
    protected function defineDatabaseMigrations(): void
    {
        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
    }

    /**
     * 定义数据库 seed。
     * 可以在这里填充测试数据。
     */
    protected function defineDatabaseSeeders(): void
    {
        // $this->seed(SomeSeeder::class);
    }
}
```

`getPackageProviders` 方法告诉 Testbench 加载你的 Service Provider，就像在 Laravel 应用中注册一样。这是 Package 测试能够正常运行的基础——没有这个配置，你的 Service Provider 不会被加载，相关的绑定、路由、命令等都不会注册。

### 7.2 RefreshDatabase 与 SQLite in-memory

对于需要数据库的测试，隔离性至关重要。每个测试不应该受其他测试的数据影响，同时测试之间也不应该互相干扰：

```php
use Illuminate\Foundation\Testing\RefreshDatabase;

class FenceRepositoryTest extends TestCase
{
    use RefreshDatabase;

    protected function defineEnvironment($app): void
    {
        // 使用 SQLite in-memory 数据库
        // 这是最推荐的测试数据库方案
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver'   => 'sqlite',
            'database' => ':memory:',
            'prefix'   => '',
        ]);
    }

    /** @test */
    public function it_can_create_and_retrieve_a_fence(): void
    {
        $fence = Fence::create([
            'name'      => 'Office',
            'latitude'  => 39.9042,
            'longitude' => 116.4074,
            'radius'    => 200,
        ]);

        $this->assertDatabaseHas('fences', ['name' => 'Office']);

        $found = Fence::find($fence->id);
        $this->assertEquals('Office', $found->name);
    }

    /** @test */
    public function it_can_delete_expired_fences(): void
    {
        Fence::create([
            'name'       => 'Expired',
            'latitude'   => 39.9,
            'longitude'  => 116.4,
            'radius'     => 100,
            'expires_at' => now()->subDay(),
        ]);

        $this->artisan('geo-fence:prune-expired');

        $this->assertDatabaseCount('fences', 0);
    }
}
```

**SQLite in-memory 的优势**：

- **速度极快**：数据在内存中，不需要磁盘 I/O，每个测试的数据库操作都比真实数据库快一个数量级。
- **天然隔离**：`:memory:` 数据库在每个连接中独立存在，`RefreshDatabase` trait 会在每个测试前运行迁移，测试后回滚事务，确保数据完全隔离。
- **零依赖**：不需要外部数据库服务，CI 环境中无需配置 MySQL 或 PostgreSQL，降低了持续集成的复杂度。

**注意事项**：SQLite 的 SQL 语法与 MySQL/PostgreSQL 有一些差异，比如不支持某些 JSON 操作、枚举类型等。如果你的 Package 大量使用数据库特定功能，建议在 CI 中同时测试 SQLite 和 MySQL/PostgreSQL。

### 7.3 Facade 测试

Laravel 的 Facade 提供了 `shouldReceive()` 方法，可以轻松 mock 底层服务：

```php
use Mikeah\GeoFence\Facades\GeoFence;

/** @test */
public function it_can_mock_facade_for_unit_tests(): void
{
    // 设置 mock 期望
    GeoFence::shouldReceive('isWithin')
        ->once()
        ->with(39.9042, 116.4074, 'office')
        ->andReturn(true);

    $result = GeoFence::isWithin(39.9042, 116.4074, 'office');

    $this->assertTrue($result);
    // Mock 会在测试结束时自动恢复
}

/** @test */
public function it_can_fake_facade_for_integration_tests(): void
{
    // 使用 fake() 方法完全替换底层服务
    GeoFence::shouldReceive('findNearestFence')
        ->andReturn('park');

    $result = GeoFence::findNearestFence(39.9, 116.4);

    $this->assertEquals('park', $result);
}
```

这种测试方式的优势在于：你在测试控制器或其他服务时，不需要真正调用地理围栏的计算逻辑，只需确保你的代码正确地调用了 GeoFence 的 API 即可。

### 7.4 Pest 测试风格

如果你喜欢 Pest 的语法，Orchestra Testbench 也完美支持：

```php
use Mikeah\GeoFence\Facades\GeoFence;
use Mikeah\GeoFence\Models\Fence;

beforeEach(function () {
    // 每个测试前重置状态
    $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
});

it('can check if coordinates are within a fence', function () {
    GeoFence::shouldReceive('isWithin')
        ->once()
        ->andReturn(true);

    $result = GeoFence::isWithin(39.9042, 116.4074, 'office');

    expect($result)->toBeTrue();
});

it('can create a new fence via the manager', function () {
    $manager = $this->app->make(\Mikeah\GeoFence\GeoFenceManager::class);

    $fence = $manager->create('park', [
        'center' => ['lat' => 39.9, 'lng' => 116.4],
        'radius' => 500,
    ]);

    expect($fence)->toBeInstanceOf(Fence::class)
        ->and($fence->name)->toBe('park')
        ->and($fence->radius)->toBe(500);
});

it('validates radius is within acceptable range', function () {
    $manager = $this->app->make(\Mikeah\GeoFence\GeoFenceManager::class);

    $manager->create('test', [
        'center' => ['lat' => 0, 'lng' => 0],
        'radius' => -10,
    ]);
})->throws(\InvalidArgumentException::class, 'Radius must be positive');
```

Pest 的 `expect()` API 链式调用让测试代码更加简洁和可读。

---

## 八、版本管理

### 8.1 语义化版本（SemVer）

Laravel Package 严格遵循[语义化版本](https://semver.org/lang/zh-CN/)规范。版本号格式为 `MAJOR.MINOR.PATCH`：

- **MAJOR**（主版本）：不兼容的 API 变更。如 `1.x` → `2.0`，意味着用户的代码可能需要修改才能升级。
- **MINOR**（次版本）：向下兼容的功能新增。如 `1.1` → `1.2`，用户可以安全升级而不需要修改代码。
- **PATCH**（补丁）：向下兼容的 Bug 修复。如 `1.1.1` → `1.1.2`，强烈建议用户升级。

示例版本策略：

```
v1.0.0  —— 首次稳定发布
v1.1.0  —— 新增 Vincenty 驱动支持
v1.1.1  —— 修复高纬度地区精度问题
v1.2.0  —— 新增缓存功能
v2.0.0  —— 重构 API，不兼容 v1.x 的调用方式
```

**重要**：在 `0.x` 阶段（即 `0.1.0`、`0.2.0` 等），API 被认为是不稳定的，即使 MINOR 版本也可能包含不兼容的变更。这在 Package 开发早期阶段是被接受的。

### 8.2 CHANGELOG 维护

保持一份 `CHANGELOG.md`，记录每个版本的变化，这是对用户的基本尊重：

```markdown
# Changelog

All notable changes to `geo-fence` will be documented in this file.

## [1.2.0] - 2026-06-01

### Added
- Vincenty distance calculation driver
- `Fence::findOverlapping()` method for detecting overlapping fences
- Support for polygon-based fences (not just circular)
- Chinese (zh-CN) language file

### Fixed
- Haversine formula precision issue at high latitudes (#42)
- Cache not being invalidated when fence is updated (#45)

### Changed
- Default cache TTL increased from 1800 to 3600 seconds
- Minimum PHP version bumped to 8.2

## [1.1.0] - 2026-05-15

### Added
- Cache support for fence boundaries
- `GeoFence::clearCache()` method
- `geo-fence:prune-expired` artisan command

### Changed
- Improved performance of bulk fence checks by 40%

## [1.0.0] - 2026-05-01

### Added
- Initial release
- Haversine-based geofence checking
- Eloquent models for fence management
- Artisan commands for installation and synchronization
```

建议遵循 [Keep a Changelog](https://keepachangelog.com/) 格式，将变更分为 Added、Changed、Deprecated、Removed、Fixed、Security 六类。

### 8.3 GitHub Actions CI

完善的 CI 配置是高质量 Package 的标志：

```yaml
# .github/workflows/run-tests.yml
name: run-tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: true
      matrix:
        php: [8.2, 8.3, 8.4]
        laravel: [10.*, 11.*, 12.*]
        exclude:
          - php: 8.2
            laravel: 12.*

    name: PHP ${{ matrix.php }} - Laravel ${{ matrix.laravel }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: mbstring, sqlite3
          coverage: xdebug

      - name: Get Composer cache directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install dependencies
        run: |
          composer require "illuminate/support=${{ matrix.laravel }}" --no-update
          composer update --prefer-dist --no-interaction --no-progress

      - name: Run tests
        run: vendor/bin/pest --coverage --min=80

      - name: Static analysis
        run: vendor/bin/phpstan analyse
```

这个 CI 配置会在多个 PHP 版本和 Laravel 版本的组合下运行测试，确保你的 Package 具有良好的兼容性。Composer 缓存可以显著加快依赖安装速度。

---

## 九、发布到 Packagist

### 9.1 composer.json 最终检查

发布前，确保 `composer.json` 包含以下关键字段：

```json
{
    "name": "mikeah/geo-fence",
    "type": "library",
    "description": "A powerful geofencing package for Laravel applications",
    "keywords": ["laravel", "geofence", "geo", "location", "gps"],
    "homepage": "https://github.com/mikeah/geo-fence",
    "license": "MIT",
    "authors": [
        {
            "name": "mikeah",
            "email": "mikeah@example.com",
            "homepage": "https://mikeah.dev",
            "role": "Developer"
        }
    ],
    "funding": [
        {
            "type": "github",
            "user": "mikeah"
        }
    ],
    "support": {
        "issues": "https://github.com/mikeah/geo-fence/issues",
        "source": "https://github.com/mikeah/geo-fence"
    },
    "require": {
        "php": "^8.2",
        "illuminate/support": "^10.0|^11.0|^12.0"
    },
    "require-dev": {
        "orchestra/testbench": "^8.0|^9.0|^10.0",
        "pestphp/pest": "^2.0|^3.0",
        "phpstan/phpstan": "^1.0",
        "laravel/pint": "^1.0"
    },
    "autoload": {
        "psr-4": {
            "Mikeah\\GeoFence\\": "src/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Mikeah\\GeoFence\\Tests\\": "tests/"
        }
    },
    "extra": {
        "laravel": {
            "providers": [
                "Mikeah\\GeoFence\\GeoFenceServiceProvider"
            ],
            "aliases": {
                "GeoFence": "Mikeah\\GeoFence\\Facades\\GeoFence"
            }
        }
    },
    "minimum-stability": "dev",
    "prefer-stable": true,
    "config": {
        "sort-packages": true,
        "allow-plugins": {
            "pestphp/pest-plugin": true
        }
    }
}
```

### 9.2 推送 Tag 到 GitHub

Packagist 是通过 Git Tag 来识别版本的。**Tag 必须遵循语义化版本格式**：

```bash
# 确保代码已提交并推送到 GitHub
git add .
git commit -m "Prepare for v1.0.0 release"
git push origin main

# 创建带注释的版本 tag（推荐使用带注释的 tag）
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

**注意**：Tag 名称必须以 `v` 开头（如 `v1.0.0`），这是 Packagist 的约定。Packagist 会自动解析 tag 名称，提取版本号。

### 9.3 注册 Packagist

1. 访问 [packagist.org](https://packagist.org)，使用 GitHub 账号登录。
2. 点击右上角的 "Submit" 按钮，输入你的 GitHub 仓库地址（如 `https://github.com/mikeah/geo-fence`）。
3. Packagist 会自动解析 `composer.json` 并注册你的包。如果解析失败，检查 `composer.json` 的格式是否正确。
4. **设置 GitHub Service Hook**：这是非常重要的一步！在 GitHub 仓库的 Settings → Webhooks → Add webhook 中，添加 Packagist 的 webhook URL（可以在 Packagist 的包管理页面找到）。这样每次你推送代码或创建新 tag，Packagist 都会自动更新，无需手动操作。

### 9.4 用户安装体验

发布后，用户只需要一行命令即可安装你的 Package：

```bash
composer require mikeah/geo-fence
```

得益于 Auto-Discovery，用户**不需要**手动在 `config/app.php` 中注册 Service Provider 或 Facade——Laravel 会自动识别 `composer.json` 中 `extra.laravel` 的配置并完成注册。这就是现代 Laravel Package 的零配置安装体验。

---

## 十、高级话题

### 10.1 Package Auto-Discovery 的工作原理

当用户执行 `composer require` 时，Laravel 的 `PackageManifest`（位于 `bootstrap/cache/packages.php`）会扫描所有已安装包的 `composer.json`，提取 `extra.laravel` 中的 providers 和 aliases，然后在应用启动时自动注册。

这个缓存文件在 `php artisan package:discover` 命令执行时生成，通常在 `composer install/update` 后自动触发。如果你遇到 Auto-Discovery 失效的情况，可以手动运行：

```bash
php artisan package:discover
php artisan config:clear
php artisan cache:clear
```

### 10.2 自定义 Stubs

Laravel 的 `make:` 命令背后使用的是 **stub** 文件。你可以在 Package 中提供自定义 stub，让用户的 `php artisan make:` 命令生成符合你 Package 约定的代码：

```php
// Service Provider 中发布 stub
$this->publishes([
    __DIR__.'/../stubs/geo-fence-controller.stub' =>
        base_path('stubs/geo-fence-controller.stub'),
], 'geo-fence-stubs');
```

你可以通过 `Artisan::command` 创建自定义的 `make` 命令，读取 stub 文件并替换占位符后生成代码。

### 10.3 Macroable Trait

`Macroable` trait 让你的类可以在运行时动态添加方法，这在 Package 开发中非常实用，因为它允许用户在不修改 Package 源码的情况下扩展功能：

```php
use Illuminate\Support\Traits\Macroable;

class GeoFenceManager
{
    use Macroable;

    // 核心方法...
}

// 用户在自己的 Service Provider 中扩展
GeoFenceManager::macro('isInChina', function (float $lat, float $lng): bool {
    return $lat >= 18.0 && $lat <= 53.5 && $lng >= 73.0 && $lng <= 135.0;
});

GeoFenceManager::macro('getDistanceInKm', function (float $lat1, float $lng1, float $lat2, float $lng2): float {
    // 实现距离计算
});

// 调用
GeoFence::isInChina(39.9, 116.4); // true
$km = GeoFence::getDistanceInKm(39.9, 116.4, 31.2, 121.5);
```

Laravel 框架中的许多类（如 `Request`、`Collection`、`Str`）都使用了 `Macroable`，这是一个非常强大的扩展模式。

---

## 十一、生产踩坑

### 11.1 命名冲突

**问题描述**：两个 Package 注册了相同名称的 config key、route name 或 view namespace，导致其中一个失效。

**解决方案**：
- Config key 使用唯一的包名前缀：`geo-fence` 而不是 `config` 或 `geo`。
- 路由使用 Package 专属的前缀和 name prefix，并在文档中明确说明。
- View namespace 使用 Package 名称作为前缀，如 `geo-fence::dashboard`。

### 11.2 版本约束

**问题描述**：过于宽泛的版本约束导致在新版本 Laravel 中出现不兼容的错误。

**解决方案**：
- 明确声明支持的 Laravel 版本范围，使用 `|` 分隔多个版本约束。
- 使用 CI 矩阵测试所有支持的版本组合，确保每个组合都能通过测试。
- 对于 breaking changes，及时发布 MAJOR 版本，并在 CHANGELOG 中详细说明迁移指南。

### 11.3 PHP 版本兼容

**问题描述**：使用了高版本 PHP 的特性（如 `readonly`、`enum`、`match` 表达式、`fiber`）但最低版本约束设置过低。

**解决方案**：
- 在 CI 中使用 `--prefer-lowest` 选项测试最低依赖版本。
- 使用 PHPStan 在对应版本级别进行静态分析（如 Level 6）。
- 如果必须使用新特性，提高 `composer.json` 中的 PHP 最低版本要求。

### 11.4 依赖冲突

**问题描述**：你的 Package 依赖的某个库版本与用户应用中的版本冲突，导致 `composer require` 失败。

**解决方案**：
- 尽量使用宽松的版本约束（`^` 而不是 `~`）。
- 核心依赖（如 `illuminate/support`）使用 `^` 约束，允许在大版本内的任意更新。
- **避免不必要的依赖**——如果只用到了 `illuminate/support` 的一部分功能，就不要 require 整个 `laravel/framework`。
- 使用 `illuminate/contracts` 而不是具体的组件包，因为 contracts 包更轻量。

### 11.5 服务容器绑定冲突

**问题描述**：另一个 Package 也绑定了同一个 key，导致后注册的覆盖先注册的。

**解决方案**：
- 使用完整的类名作为绑定 key：`$this->app->singleton(GeoFenceManager::class, ...)` 而不是模糊的 `$this->app->singleton('geo-fence', ...)`。
- Facade 的 `getFacadeAccessor()` 返回类名常量。
- 在文档中说明冲突处理方式，提供自定义绑定 key 的配置选项。

---

## 十二、总结与推荐资源

开发一个高质量的 Laravel Package 需要关注以下核心要点：

1. **Service Provider** 是 Package 的入口，`register()` 管绑定，`boot()` 管行为，不要混用。延迟加载可以提升性能。
2. **Facade** 提供优雅的静态 API，底层是对服务容器的访问。正式的 Facade 类优于 Real-time Facade。
3. **Config 合并**需要 `mergeConfigFrom` 和 `publishes` 的配合，前者提供默认值，后者允许用户自定义。配置文件要支持环境变量覆盖。
4. **测试隔离**使用 Orchestra Testbench + SQLite in-memory，确保 Package 在独立环境中可测试。CI 要覆盖多个 PHP/Laravel 版本组合。
5. **语义化版本**和完善的 CHANGELOG 是发布到 Packagist 的基础。Tag 必须遵循 `vX.Y.Z` 格式。
6. **Auto-Discovery** 让用户零配置即可使用你的 Package，这是现代 Laravel Package 的标准。
7. **Macroable** 和 **接口设计** 为用户提供扩展点，让他们能在不修改源码的情况下自定义行为。

### 推荐资源

- [Laravel 官方文档 - Package Development](https://laravel.com/docs/packages)
- [Orchestra Testbench 文档](https://packages.tools/testbench)
- [Spatie Package Skeleton Laravel](https://github.com/spatie/package-skeleton-laravel)
- [Laravel Beyond CRUD](https://laravel-beyond-crud.com/) —— 深入 Laravel 架构设计
- [Packagist](https://packagist.org)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)

开发 Package 不仅能提升你的代码组织能力，更能让你深入理解 Laravel 框架的内部机制——服务容器如何工作、门面模式的实现原理、配置系统的合并策略等。当你第一次在 Packagist 上看到自己的包被下载、被 Star，那种成就感是复制粘贴代码永远无法比拟的。从今天开始，将你的通用代码封装成 Package，让它成为你和社区的共同财富。

---

*如果你正在开发自己的 Laravel Package，或者在过程中遇到了任何问题，欢迎在评论区交流讨论。你也可以参考本文配套的示例仓库 [mikeah/geo-fence](https://github.com/mikeah/geo-fence) 来获取完整的代码实现。*

## 相关阅读

- [Dependency Injection 容器深度对比：Laravel Container vs Symfony DI vs PHP-DI 的设计哲学](/post/Dependency-Injection-容器深度对比-Laravel-Container-vs-Symfony-DI-vs-PHP-DI-的设计哲学.html)
- [Data Contract 实战：Pact-style 数据契约——Laravel 微服务间数据格式的版本化、验证与 Breaking Change 检测](/post/Data-Contract-实战-Pact-style-数据契约-Laravel微服务数据格式版本化验证与Breaking-Change检测.html)
- [PHP SAPI 深度对比：php-fpm vs php-cli vs FrankenPHP vs RoadRunner](/post/PHP-SAPI-深度对比-php-fpm-vs-php-cli-vs-FrankenPHP-vs-RoadRunner-进程模型请求生命周期与内存管理的本质差异.html)
