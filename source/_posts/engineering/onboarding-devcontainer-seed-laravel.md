---
title: 新人 Onboarding 自动化实战：devcontainer + Seed 数据 + 文档生成——Laravel 团队的零摩擦入职方案
keywords: [Onboarding, devcontainer, Seed, Laravel, 新人, 自动化实战, 数据, 文档生成, 团队的零摩擦入职方案, 工程化]
date: 2026-06-09
categories:
  - engineering
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags:
  - Onboarding
  - DevContainer
  - Laravel
  - MySQL
  - Docker
  - CI
  - CD
  - developer-experience
  - documentation
description: 本文以 Laravel B2C API 项目为背景，完整拆解一套可复制的新人入职自动化方案：通过 DevContainer 实现一键开发环境，用 Seed 数据注入最小可用业务数据，并用自动化文档生成把分散在仓库、Wiki、口头约定里的知识统一沉淀。方案重点不在“工具清单”，而在“把入职路径工程化”：环境可复现、数据可解释、流程可追溯、产出可验证。适合中小团队从第一周就能落地，并在后续 30+ 仓库协同中持续扩展。
---


# 新人 Onboarding 自动化实战：devcontainer + Seed 数据 + 文档生成——Laravel 团队的零摩擦入职方案

在很多 Laravel 团队里，新人入职的真实体验常常是：

- 看完 README 还是不会跑项目；
- 跑起来之后卡在本地环境差异上；
- 能登录系统却不知道哪些数据可以改、哪些测试不能乱碰；
- 能跑通流程却不知道为什么历史代码会这样写；
- 第一周结束能修 bug，却还不清楚业务边界在哪里。

这些问题不是“人不够聪明”，而是**入职路径没有被工程化**。

真正可复制、可持续扩大的入职方案，应该同时解决三件事：

1. **环境一致性**：开发环境一键启动，不依赖本地机器差异；
2. **业务可理解性**：新人拿到的是“可解释”的 Seed 数据，而不是一堆空表；
3. **知识可沉淀**：文档不是散在 Confluence、飞书、Slack 里的拼图，而是从代码和流程里自动生成的统一产物。

本文基于一个真实 Laravel B2C API 项目，完整拆解一套从 0 到 1 的自动化 Onboarding 方案。目标是：

- 新人第一天完成环境启动；
- 第一天能用自己的账号跑通核心流程；
- 第二天知道哪些数据可调试、哪些服务要 Mock；
- 第一周结束能独立完成一个小型需求，而不是继续“到处问人”。

---

## 一、为什么传统 Onboarding 总是“高摩擦”

很多团队会把入职问题归因为“文档没写好”，但真正的问题往往更复杂。

### 1.1 环境碎片化是第一道墙

Laravel 项目常见的本地环境组合包括：

- PHP 8.x（不同小版本行为不同）
- Composer 依赖版本差异
- MySQL / PostgreSQL 本地版本差异
- Redis 版本差异
- Node.js（前端构建、Vite、Mix）
- Mail / Queue / Scheduler 的本地替代方案
- 各种私有配置 `.env`

这意味着同一个项目，在 macOS、Ubuntu、Windows WSL 上可能出现不同问题。甚至同一种操作系统，因为 Homebrew、Docker Desktop、Colima 的版本差异，结果也不同。

这种环境碎片化会让新人在“还没写一行代码”之前，就已经浪费一到两天。

### 1.2 数据黑洞是第二道墙

数据库能连上不代表能理解项目。

很多时候新人会面对这些困惑：

- 这个订单状态为什么只有 3、5、7？
- 这个用户为什么能下单，另一个不能？
- 哪些 coupon 是测试数据，哪些是真实配置？
- 哪些字段是业务字段，哪些是历史遗留？
- 哪些表是核心链路，哪些是边缘功能？

如果数据库里没有**最小可用业务数据**，新人就会陷入“能运行但看不懂”的状态。

### 1.3 口头知识是第三道墙

最容易被低估的问题，是知识分散在人身上。

比如：

- “这个 Service 只是为了兼容旧端”
- “这个接口虽然在，但前端已经不用了”
- “这个字段先别动，后面会重做”
- “这个功能只有泰国市场会用”

这些内容如果不沉淀下来，新人就得反复提问，老员工也会不断被打断。

最终，Onboarding 不是一个流程，而是一种“持续打扰”。

---

## 二、方案目标：把入职路径变成一条可复现的流水线

我们要做的不是“补更多文档”，而是设计一条可执行流水线：

- **devcontainer**：环境一键启动
- **Seed 数据**：业务上下文自动注入
- **文档生成**：从代码和配置中沉淀知识
- **验证流程**：让新人也能用测试和脚本验证环境

把这四件事打通后，新人入职就不再是“口耳相传”，而是“流程驱动”。

---

## 三、DevContainer：实现“第一条命令就跑起来”

DevContainer 的价值不是“用 Docker”，而是把开发环境抽象成一份**可版本管理的契约**。

### 3.1 为什么选 DevContainer

对于 Laravel 项目，DevContainer 能解决几个关键问题：

- 不依赖本地 PHP、MySQL、Redis 版本；
- 新人不需要手动配置各种扩展；
- 团队成员之间环境一致；
- 可以把常用工具链预装进镜像；
- 可以直接对接 VS Code / Cursor / JetBrains 等主流编辑器。

更关键的是，它把“环境配置”从文档变成了代码。

### 3.2 推荐的 Laravel DevContainer 结构

一个可复制的 Laravel 项目通常需要这些服务：

- `app`：主开发容器，运行 PHP、Composer、Artisan、前端构建工具
- `mysql`：数据库
- `redis`：缓存 / 队列
- `mailhog` 或 `mailpit`：本地邮件调试
- `node`：前端资源编译（可选，取决于项目是否前后端同仓）

目录结构示例：

```text
.vscode/
  devcontainer.json
devcontainer/
  app/
    Dockerfile
  docker-compose.devcontainer.yml
source/
  ...
```

### 3.3 devcontainer.json 示例

下面是一个适合 Laravel 项目的最小配置：

```json
{
  "name": "Laravel Dev",
  "dockerComposeFile": [
    "../devcontainer/docker-compose.devcontainer.yml"
  ],
  "service": "app",
  "workspaceFolder": "/workspace",

  "customizations": {
    "vscode": {
      "extensions": [
        "bmewburn.vscode-intelephense-client",
        "onecentlin.laravel-blade",
        "ryanzhuo.php-namespace-resolver",
        "editorconfig.editorconfig"
      ],
      "settings": {
        "php.validate.executablePath": "/usr/local/bin/php"
      }
    }
  },

  "postCreateCommand": "bash ./devcontainer/scripts/post-create.sh"
}
```

### 3.4 docker-compose.devcontainer.yml 示例

```yaml
version: "3.8"

services:
  app:
    build:
      context: .
      dockerfile: app/Dockerfile
    volumes:
      - ..:/workspace:cached
    depends_on:
      - mysql
      - redis
    environment:
      APP_ENV: local
      APP_DEBUG: "true"
      DB_HOST: mysql
      DB_PORT: 3306
      DB_DATABASE: laravel
      DB_USERNAME: laravel
      DB_PASSWORD: secret
      REDIS_HOST: redis
    command: sleep infinity

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: laravel
      MYSQL_USER: laravel
      MYSQL_PASSWORD: secret
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql

  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  mysql-data:
```

### 3.5 应用容器 Dockerfile 示例

```dockerfile
FROM mcr.microsoft.com/devcontainers/php:1-8.3-bookworm

RUN apt-get update && apt-get install -y \
    unzip \
    git \
    curl \
    libpng-dev \
    libjpeg-turbo8-dev \
    libfreetype6-dev \
    zip \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo pdo_mysql mbstring exif pcntl bcmath gd \
    && apt-get clean

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /workspace
```

这样做的好处是：

- PHP 版本、扩展、Composer 都统一；
- 新人不需要再手动编译 GD、 pdo_mysql 等扩展；
- 镜像版本本身也可以纳入版本管理。

---

## 四、让 Laravel 项目“第一次运行就成功”

DevContainer 解决了环境问题，但 Laravel 项目还有自己的启动流程。新人最容易出问题的地方通常不是代码，而是：

- `.env` 缺字段
- `key:generate` 没执行
- `composer install` 失败
- `npm install` / `vite build` 没执行
- 数据库 migration 未执行
- Seed 未填充

因此我们要把这些步骤都收敛到一个可重复脚本里。

### 4.1 推荐的 post-create 脚本

`devcontainer/scripts/post-create.sh` 可以承担“从裸代码到可运行环境”的全部工作：

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Install PHP dependencies"
composer install --no-interaction --prefer-dist

echo "==> Setup environment"
if [ ! -f ".env" ]; then
  cp .env.example .env
fi

php artisan key:generate --force

echo "==> Prepare database"
php artisan migrate:fresh --seed

echo "==> Cache config for local dev"
php artisan config:cache
php artisan route:cache
php artisan view:cache

echo "==> Setup frontend assets (if exists)"
if [ -f "package.json" ]; then
  npm install
  npm run build
fi

echo "==> Run basic checks"
php artisan route:list --compact > /dev/null || true

echo "==> Onboarding ready."
```

这个脚本的核心思路是：

- 用 `migrate:fresh --seed` 保证环境干净；
- 用明确顺序避免新人手动试错；
- 同时兼顾前后端同仓项目。

### 4.2 为什么不要“保留线上数据给新人”

很多团队为了让新人“贴近真实环境”，会直接提供线上数据库快照。

这种做法看起来很真实，但往往会带来这些问题：

- 数据太多，新人找不到重点；
- 没有注释，业务含义不可解释；
- 可能包含敏感数据；
- 容易误操作；
- 不同人拿到不同快照，结果不一致。

更合适的做法是提供**最小可用 Seed**：

- 只覆盖核心业务链路；
- 数据可解释、可修改、可重复；
- 新人可以大胆试验。

---

## 五、Seed 数据设计：不只是填充数据，而是解释业务

Seed 的作用不是让系统“看起来像有数据”，而是让新来的开发者**快速理解业务**。

### 5.1 传统 Seed 的问题

很多 Laravel 项目的 Seed 还停留在：

- `UserSeeder`：创建一个管理员
- `ProductSeeder`：随便塞几条商品
- `OrderSeeder`：随机生成一些订单

这些数据没有叙事，也没有边界，新人看到后仍然不知道：

- 业务模型是什么；
- 哪些字段是关键字段；
- 哪些状态是真实流程；
- 哪些组合是异常场景。

### 5.2 好的 Seed 应该有“场景感”

对 B2C 电商系统来说，更有价值的 Seed 设计是按场景组织，例如：

- 普通用户 + 可下单商品 + 正常地址
- 已售罄商品
- 有库存但限购的商品
- 已过期优惠券
- 待付款订单
- 已完成订单
- 已退款订单
- 会员用户与普通用户
- 多币种 / 多地区配置（如适用）

这样新人不只是看到数据，而是看到**业务故事**。

### 5.3 给每组 Seed 提供注释式说明

推荐在 Seed 文件、文档或 README 中直接写清楚：

- 这组数据是什么场景；
- 新人可以用来做什么；
- 哪些数据可以改；
- 哪些数据不要随便删。

例如：

- `ScenarioBasicOrder`：演示一次成功下单的完整链路
- `ScenarioSoldOutProduct`：演示库存不足时的下单失败
- `ScenarioExpiredCoupon`：演示优惠券失效后的价格计算
- `ScenarioRefundFlow`：演示退款状态切换

这样 Seed 就成了**可操作的业务教材**。

---

## 六、Laravel Seed 自动化实战

下面给出一套适合 Laravel 项目的 Seed 结构和实现方式。

### 6.1 目录结构建议

```text
database/
  seeders/
    DatabaseSeeder.php
    Core/
      UserSeeder.php
      ProductSeeder.php
      CouponSeeder.php
      OrderSeeder.php
    Scenarios/
      BasicOrderSeeder.php
      SoldOutProductSeeder.php
      RefundFlowSeeder.php
    Dev/
      LocalDemoUserSeeder.php
```

这样做的好处是：

- 按职责分开；
- `Core` 处理基础数据；
- `Scenarios` 处理教学场景；
- `Dev` 处理本地调试专用数据。

### 6.2 DatabaseSeeder 入口示例

```php
<?php

declare(strict_types=1);

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            // 基础数据
            Core\UserSeeder::class,
            Core\ProductSeeder::class,
            Core\CouponSeeder::class,

            // 教学场景
            Scenarios\BasicOrderSeeder::class,
            Scenarios\SoldOutProductSeeder::class,
            Scenarios\RefundFlowSeeder::class,

            // 本地开发专用
            Dev\LocalDemoUserSeeder::class,
        ]);
    }
}
```

### 6.3 场景化 OrderSeeder 示例

下面这个示例展示了如何用真实可读的方式生成订单数据：

```php
<?php

declare(strict_types=1);

namespace Database\Seeders\Core;

use App\Enums\OrderStatus;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Seeder;

class OrderSeeder extends Seeder
{
    public function run(): void
    {
        $user = User::where('email', 'dev_user@example.com')->first();

        if (!$user) {
            return;
        }

        $product = Product::where('slug', 'dev-favorite-tshirt')->first();

        if (!$product) {
            return;
        }

        Order::create([
            'user_id' => $user->id,
            'product_id' => $product->id,
            'quantity' => 1,
            'amount' => $product->price,
            'status' => OrderStatus::Pending,
            'remark' => '本地演示订单：待付款',
        ]);

        Order::create([
            'user_id' => $user->id,
            'product_id' => $product->id,
            'quantity' => 2,
            'amount' => $product->price * 2,
            'status' => OrderStatus::Paid,
            'remark' => '本地演示订单：已付款，等待发货',
        ]);

        Order::create([
            'user_id' => $user->id,
            'product_id' => $product->id,
            'quantity' => 1,
            'amount' => $product->price,
            'status' => OrderStatus::Refunded,
            'remark' => '本地演示订单：退款流程',
        ]);
    }
}
```

这段代码的价值不在于“生成三条记录”，而在于：

- 新人看到的是三个明确状态；
- 每条数据都能解释业务含义；
- 后续可直接用于测试、文档、演示。

### 6.4 可选的 Artisan 命令封装

如果项目里经常需要“只跑基础数据”或“只跑演示场景”，可以增加自定义命令：

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;

class SeedDev extends Command
{
    protected $signature = 'seed:dev {--scenario=}';
    protected $description = 'Seed only dev-friendly data for onboarding';

    public function handle(): int
    {
        $scenario = $this->option('scenario');

        if ($scenario === 'basic') {
            $this->call('db:seed', ['--class' => 'Database\\Seeders\\Scenarios\\BasicOrderSeeder']);
        } elseif ($scenario === 'refund') {
            $this->call('db:seed', ['--class' => 'Database\\Seeders\\Scenarios\\RefundFlowSeeder']);
        } else {
            $this->call('db:seed');
        }

        self::INFO('Dev seeding completed.');

        return self::SUCCESS;
    }
}
```

新人就能快速运行：

```bash
php artisan seed:dev --scenario=basic
```

这种体验远比“去看 DatabaseSeeder 里哪个 Seeder 要开，哪个要注释”更好。

---

## 七、自动化文档生成：把散落知识拉回仓库

很多团队的文档问题不是“没人写”，而是：

- 写在 Confluence、飞书、Notion、Wiki 里，和代码脱节；
- 项目变完之后文档没同步；
- 文档太多，新人不知道从哪看起；
- 老员工离开后，很多关键上下文丢失。

所以更好的策略是：**优先从代码和配置中自动生成文档**。

### 7.1 先沉淀“必须准”的文档

对新人来说，最有用的文档通常是：

- 本地启动说明
- 环境变量说明
- 数据库表说明
- 核心流程说明
- 常见报错与解法
- 测试运行方式
- 部署流程

这些内容都适合部分自动生成。

### 7.2 README 自动生成策略

很多 Laravel 项目 README 过时，是因为没人愿意每次手动更新。

我们可以通过脚本自动抽取：

- 项目启动命令
- 环境变量来源 `.env.example`
- 数据库结构来自 migration
- 路由列表来自 `php artisan route:list`
- Seed 场景说明来自固定文档块

这样 README 就不是静态文档，而是从代码里“长出来”的文档。

### 7.3 .env.example 可读化

新人常见的困惑不是“缺哪个变量”，而是“这个变量到底是什么意思”。

因此建议维护一份可读化说明文件，例如 `docs/env-reference.md`，并在构建流程中自动校验是否与 `.env.example` 同步。

示例片段：

```md
## APP_ENV
本地开发固定使用 `local`。

## DB_HOST
本地默认使用 `mysql` 容器名；宿主机直接访问时可用 `127.0.0.1`。

## REDIS_HOST
默认 `redis`。

## QUEUE_CONNECTION
本地建议使用 `sync`，避免调试时任务异步执行影响观察顺序。
```

这种文档很朴素，但对新人非常有用。

---

## 八、把“入职验证”变成一条命令

很多团队的新人入职流程是“跑到哪里卡住了就去问人”，但更好的做法是提供一组**可执行的验证脚本**。

### 8.1 建议提供 dev:doctor 命令

这个命令可以一次性检查：

- PHP 版本
- Composer 依赖
- Node 依赖
- 数据库连接
- Redis 连接
- `.env` 必要字段
- 关键 migration 是否执行
- Seed 是否存在基础数据
- 基础接口是否可达

示例：

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class DevDoctor extends Command
{
    protected $signature = 'dev:doctor';
    protected $description = 'Check local onboarding readiness';

    public function handle(): int
    {
        $checks = [
            'App version' => config('app.version', 'unknown'),
            'App env' => config('app.env'),
            'App debug' => config('app.debug') ? 'true' : 'false',
            'DB connection' => $this->checkDb(),
            'Redis connection' => $this->checkRedis(),
            'Users count' => $this->getUserCount(),
            'Products count' => $this->getProductCount(),
        ];

        foreach ($checks as $label => $value) {
            $this->info("{$label}: {$value}");
        }

        return self::SUCCESS;
    }

    private function checkDb(): string
    {
        try {
            DB::connection()->getPdo();

            return 'OK';
        } catch (\Throwable $e) {
            return 'FAILED - ' . $e->getMessage();
        }
    }

    private function checkRedis(): string
    {
        try {
            Cache::store('redis')->put('dev:health', 1, 10);

            return Cache::store('redis')->get('dev:health') === 1 ? 'OK' : 'MISSED';
        } catch (\Throwable $e) {
            return 'FAILED - ' . $e->getMessage();
        }
    }

    private function getUserCount(): int
    {
        return (int) DB::table('users')->count();
    }

    private function getProductCount(): int
    {
        return (int) DB::table('products')->count();
    }
}
```

这样新人就不需要自己猜环境是否正常，一条命令就能知道问题出在数据库、缓存还是配置上。

### 8.2 提供一个最小冒烟测试

除了内部命令，也可以提供一个简单的冒烟测试脚本，比如：

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "===> Check PHP version"
php -v

echo "===> Check Composer dependencies"
composer validate --quiet

echo "===> Check artisan"
php artisan about | head -n 12

echo "===> Check DB connection"
php artisan migrate:status | head -n 20

echo "===> Check routes"
php artisan route:list --compact | head -n 20

echo "===> Smoke test passed"
```

这条脚本的目的不是完整测试，而是快速确认“基础链路是否通”。

---

## 九、把 Onboarding 路径写成真正的“流程”

自动化工具只是手段，最终目标是形成一条可重复流程。

### 9.1 推荐的入职主流程

对 Laravel 团队来说，一个清晰的 Onboarding 流程可以是：

**Day 1：环境跑通**
- clone 项目
- 用 DevContainer 启动环境
- 运行 `composer install`
- 运行 `migrate:fresh --seed`
- 运行 `dev:doctor`
- 能访问本地服务

**Day 1：理解最小业务**
- 查看基础 Seed 场景
- 跑通登录 / 商品浏览 / 下单（如适用）
- 阅读核心模块 README

**Day 2：理解代码结构**
- 查看目录结构说明
- 跑通测试
- 阅读至少一个典型 Feature 的请求链路

**Day 3~5：完成第一个小任务**
- 优先选择边界清晰的 issue
- 自己跑测试、写测试
- 提交 PR 并完成 Code Review

这条流程之所以有效，是因为每一步都有对应产物：

- 能启动
- 能运行
- 能解释
- 能验证

### 9.2 新人任务要“可验证”

很多团队给新人分配的第一个任务太模糊，比如：

- “先熟悉一下项目”
- “看看有没有可以优化的”
- “修一个简单的 bug”

结果新人不知道从哪下手。

更好的做法是给出明确任务，例如：

- 给某个接口补一个参数校验
- 给某个查询补索引建议
- 给某个功能补一个 Feature Test
- 修一个明确描述的 UI/接口小问题

这样新人完成后有成就感，也有明确的 Code Review 对象。

---

## 十、30+ 仓库协同下的 Onboarding 扩展策略

当团队从 1 个项目扩展到 30+ 仓库时，Onboarding 问题会变大。此时必须依赖**标准化**而不是经验。

### 10.1 统一项目骨架

所有仓库尽量共享一套开发约定：

- 统一目录结构
- 统一 DevContainer 配置模板
- 统一 Seed 分层结构
- 统一 `dev:doctor` 命令名
- 统一 CI step 命名
- 统一 PR 模板

这样新人进入新仓库时，不需要重新理解一套新体系。

### 10.2 提供“仓库索引文档”

对 30+ 仓库，新人最缺的不是代码细节，而是全局视野。

建议维护一份统一索引文档，包含：

- 每个仓库负责什么业务
- 是否核心链路
- 依赖哪些上下游服务
- 本地启动难度如何
- 常见问题是什么

这份文档可以部分由脚本自动维护，比如读取每个仓库的 `README.md`、`composer.json`、`docker-compose*.yml`，自动提取关键信息。

### 10.3 把“公共能力”抽成平台

当多个项目都有相同问题时，就应该把 Onboarding 能力抽象成平台级能力：

- 统一的本地开发镜像
- 统一的 Seed 工具库
- 统一的 `dev:doctor`
- 统一的文档生成脚本
- 统一的新人任务模板

此时 Onboarding 不再是每个仓库单独维护，而是一种组织能力。

---

## 十一、踩坑记录：这套方案常见问题

下面总结一些在落地过程中常见的真实问题，以及对应的处理方式。

### 11.1 DevContainer 在不同机器上的性能差异

在 macOS 上，使用 Docker Desktop 和 Colima/Lima 时，文件挂载性能可能不同。  
特别是：

- `vendor/node_modules` 目录热更新速度
- 大量小文件读写性能
- Vite / npm build 的构建时间

建议：

- 开发时将 `vendor` 和 `node_modules` 优先考虑缓存或 volume 策略
- 或者分开前后端资源编译步骤
- 在 README 中标注常见性能问题

### 11.2 Seed 数据和 migration 版本耦合

如果 migration 持续演进，但 Seed 还在用旧字段，`migrate:fresh --seed` 就可能报错。

建议：

- Seed 中只依赖稳定字段
- 如果字段变化大，就同时更新 Seed
- 对教学型 Seed 增加 existence check，避免缺字段导致失败

### 11.3 自动生成文档容易变成“垃圾文档”

自动生成不是目标，**可用性**才是目标。  
如果生成太多没人看的内容，反而会增加噪音。

建议：

- 只自动生成高价值文档
- 优先生成结构化信息：路由表、环境变量、migration 状态
- 人工保留“为什么这样做”的叙述性内容

### 11.4 dev:doctor 不能代替真正的测试

`dev:doctor` 只能检查环境和基本数据状态，不等于应用逻辑正确。  
因此它只能作为“第一道门禁”，不能替代测试套件。

### 11.5 新人不一定会读文档

这是人性，不是个案。

所以关键内容不能只放在长文档里，还要出现在：

- `README`
- `dev:doctor` 提示
- Seed 注释
- PR 模板
- CI 报错提示
- 关键命令 help 文本

让知识跟着流程走，比单独维护文档更有效。

---

## 十二、完整落地路线图

如果要从 0 开始推进，我建议按这个顺序：

### 第一阶段：环境统一

- 给核心项目加入 DevContainer 配置
- 先支持 VS Code / Cursor
- 提供 `post-create.sh`
- 保证至少一个仓库能“一键跑起来”

### 第二阶段：数据可解释

- 梳理核心业务场景
- 拆分 Seed 到 `Core/Scenarios/Dev`
- 增加基础演示订单、商品、用户
- 补充 Seed 场景说明文档

### 第三阶段：文档自动化

- 自动生成 `.env` 说明
- 自动生成路由表
- 自动生成 migration 状态说明
- 自动生成本地启动 README

### 第四阶段：验证可执行

- 增加 `dev:doctor`
- 增加冒烟测试脚本
- 增加新人常见问题 FAQ

### 第五阶段：多仓库标准化

- 提炼公共 DevContainer 模板
- 提炼公共 Seed 规范
- 提炼公共文档生成脚本
- 建立仓库索引文档

---

## 十三、这套方案的本质是什么

很多人会把“自动化 Onboarding”理解成一堆工具的组合，但实际上它的本质是：

- **环境标准化**：把“人的问题”变成“配置的问题”
- **数据故事化**：把“看不懂的表”变成“可解释的场景”
- **知识代码化**：把“口头经验”变成“可运行的文档”
- **验证前置化**：把“出了问题再问”变成“启动前先自检”

最终目标不是让工具更多，而是让新人更快进入**真正写代码、做业务、提交价值**的状态。

---

## 十四、总结

对于 Laravel 团队来说，一个好的 Onboarding 方案不是“文档多”，而是“路径清晰”。

本文给出的方案核心有三点：

1. **用 DevContainer 解决环境一致性**：让本地开发不再依赖个人机器差异；
2. **用场景化 Seed 解决业务可解释性**：让新人不只是看到数据，而是理解业务；
3. **用自动化文档和验证命令解决知识沉淀**：让关键知识不再只活在某个人脑子里。

把这三件事做成代码和流程后，Onboarding 就不再是“高摩擦的人肉过程”，而是一种可重复、可度量、可改进的工程能力。

对于中小团队，这套方案可以从一个仓库开始；对于 30+ 仓库的大型项目，这套方案可以逐步演化为团队统一的开发者平台能力。

新人入职最怕的从来不是难度，而是不确定。
我们的目标，就是让“第一天该做什么”变得确定、可执行、可验证。
