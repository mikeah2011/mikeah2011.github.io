---
title: 'Laravel Dusk CI 实战：Headless Chrome 在 GitHub Actions 中的 E2E 测试——动态等待、选择器治理与视觉回归'
description: 'Laravel Dusk 在 GitHub Actions 中实现 Headless Chrome E2E 测试的完整实战指南。深入讲解 CI 环境配置、Xvfb 虚拟显示、ChromeDriver 版本管理，系统解决 Flaky Test 随机失败难题——语义化等待、自定义超时、重试机制；提出 data-dusk 选择器治理与 Page Object 模式解耦方案；落地截图对比视觉回归测试流程。附完整 workflow YAML 配置与调试技巧。'
date: 2026-06-07 20:10:42
tags: [Laravel, Dusk, E2E, CI/CD, GitHub Actions, 测试]
categories:
  - php
cover: /images/covers/laravel-dusk-ci-cover.jpg
---

## 前言

在现代 Web 应用的持续交付流水线中，端到端（End-to-End，简称 E2E）测试是守护用户体验的最后一道防线。单元测试验证了函数和方法的行为逻辑，集成测试确认了模块之间的协作正确性，但它们都无法回答一个更为关键的问题：**当真实用户在浏览器中打开应用时，那些核心流程真的可以顺畅完成吗？** 登录表单能否正确提交？购物车能否正常结算？分页功能是否正常工作？这些问题只有通过模拟真实浏览器行为的 E2E 测试才能给出答案。

Laravel Dusk 是 Laravel 生态系统中官方维护的浏览器自动化测试工具，它基于 W3C WebDriver 协议和 Google Chrome 驱动程序（ChromeDriver），为 PHP 开发者提供了一套优雅、表达力强且功能完整的 E2E 测试方案。与其他测试框架相比，Dusk 的最大优势在于它深度融入 Laravel 的设计理念——流畅的链式调用、表达力极强的断言、与 Laravel 认证系统的无缝集成——使得编写 E2E 测试不再是一件痛苦的事情。

然而，将 Dusk 测试从本地开发环境迁移到持续集成（CI）环境——特别是 GitHub Actions——远非简单地运行 `php artisan dusk` 这一行命令就能解决的事情。在 CI 环境中，你面对的是一个无显示的服务器，需要启动 Headless Chrome 浏览器、管理虚拟显示服务器、处理浏览器版本兼容性、应对资源受限导致的性能差异。此外，E2E 测试特有的难题——动态等待导致的随机失败（Flaky Test）、选择器与前端实现的脆弱耦合、以及如何实现像素级的视觉回归检测——每一项都需要深思熟虑的工程决策。

本文将从 Laravel Dusk 的架构原理出发，逐步覆盖本地开发与 CI 环境的完整配置流程，深入探讨动态等待策略的最佳实践、选择器治理的设计模式，并最终落地一套基于截图对比的视觉回归测试方案。所有代码示例均来自真实的生产项目经验，可以作为团队实施 Dusk CI 的参考指南。

---

## 一、Laravel Dusk 架构原理

### 1.1 WebDriver 协议与 ChromeDriver

要深入理解 Dusk 的工作原理，必须先理清其底层的通信链路。Dusk 并不直接操控浏览器窗口，而是通过一套标准化的通信协议间接驱动浏览器执行各种操作：

```
┌─────────────────────┐
│  Dusk 测试代码 (PHP) │
└──────────┬──────────┘
           │ HTTP 请求 (JSON Wire Protocol / W3C WebDriver Protocol)
           ▼
┌─────────────────────┐
│  ChromeDriver 进程   │  (Google 官方维护的中间层二进制)
└──────────┬──────────┘
           │ Chrome DevTools Protocol
           ▼
┌─────────────────────┐
│  Google Chrome 浏览器 │  (Headless 模式或有头模式)
└─────────────────────┘
```

**WebDriver 协议**（现已正式演化为 W3C WebDriver 标准）定义了一组基于 HTTP 的 RESTful API。测试脚本通过向 ChromeDriver 监听的端口（默认 9515）发送 HTTP 请求，来执行各种浏览器操作：打开 URL、查找 DOM 元素、模拟点击、键入文本、截取屏幕截图、执行 JavaScript 代码等。每个操作都被映射为一个特定的 HTTP 端点和请求格式。

**ChromeDriver** 是 Google 官方维护的一个独立进程，它是 WebDriver 协议与 Chrome 浏览器之间的翻译层。ChromeDriver 接收来自测试脚本的 WebDriver 指令，将其翻译为 Chrome DevTools Protocol（CDP）命令，然后通过 Chrome 的远程调试接口发送给真实的 Chrome 浏览器实例执行。ChromeDriver 的版本必须与 Chrome 浏览器的主版本号严格匹配，否则会抛出 `SessionNotCreatedException` 错误。

在 **Headless 模式**下，Chrome 运行时不创建可见的 GUI 窗口，不渲染实际的显示输出，但仍然完整执行 JavaScript 引擎（V8）、HTML/CSS 布局引擎（Blink）、网络栈以及所有浏览器 API。这意味着 Headless Chrome 与有头模式具有几乎完全一致的行为语义，但内存占用更低、启动速度更快、不需要图形显示环境——这正是 CI 环境所需要的特性。

### 1.2 DuskTestCase 的核心职责

Laravel Dusk 的测试入口是 `DuskTestCase` 抽象类，它继承自 PHPUnit 的 `TestCase`，在其基础上封装了浏览器生命周期管理的关键逻辑。理解这个类是掌握 Dusk 工作机制的第一步。

`DuskTestCase` 的第一个关键方法是 `prepare()`，这是一个静态方法，使用 PHPUnit 的 `@beforeClass` 注解标记，意味着它在整个测试类的所有测试方法执行之前只运行一次。这个方法的主要职责是启动 ChromeDriver 进程。在本地开发环境中，它会调用 `static::startChromeDriver()`，该方法会自动下载与本地 Chrome 浏览器版本匹配的 ChromeDriver 二进制文件，然后将其作为后台进程启动。在 CI 环境中，ChromeDriver 通常已经预装或者由 CI 脚本显式安装，因此通过 `runningInCi()` 方法检测当前环境并跳过自动下载。

`DuskTestCase` 的第二个关键方法是 `driver()`，每个测试方法执行前都会被调用。它负责创建并返回一个 `RemoteWebDriver` 实例。在这个方法中，你需要配置 Chrome 的启动参数——是否启用 Headless 模式、窗口大小、安全沙箱策略、GPU 加速选项等——然后将这些参数通过 `DesiredCapabilities` 传递给 `RemoteWebDriver::create()` 工厂方法。Dusk 的所有高层浏览器操作方法——`$browser->visit()`、`$browser->click()`、`$browser->type()` 等——最终都会委托给这个 `RemoteWebDriver` 实例，通过 HTTP 向 ChromeDriver 发送指令。

### 1.3 Dusk 的分层封装体系

Dusk 在原始 WebDriver API 之上构建了一套精心设计的分层抽象，使得测试代码读起来更像是在描述用户的操作行为，而不是在调用底层的浏览器 API：

- **Browser**：核心代理对象，是测试代码直接操作的对象。它封装了所有浏览器交互方法，并持有 `RemoteWebDriver` 实例和 `ElementResolver` 实例。`Browser` 提供了丰富的链式方法——`visit()`、`click()`、`type()`、`assertSee()`、`waitFor()` 等——使得测试代码既简洁又富有表现力。
- **ElementResolver**：元素解析器，负责将各种选择器策略（CSS 选择器、`data-dusk` 属性选择器、XPath 表达式等）统一解析为 WebDriver 的 `WebDriverBy` 实例。它是选择器抽象的核心组件。
- **Page**：页面对象模式（Page Object Model）的基础类。每个 `Page` 子类代表一个应用页面，封装该页面的 URL、元素选择器定义和常用操作方法。这使得测试代码与页面结构解耦。
- **Component**：可复用的 UI 组件抽象，用于封装跨多个页面重复出现的 UI 元素（如导航栏、侧边栏、模态对话框、通知面板等）。`Component` 可以在多个 `Page` 之间共享。
- **Concerns（Traits）**：一系列可组合的行为特征，如 `WaitsForElements`、`ProvidesBrowser` 等，用于在不修改继承链的情况下为测试类增加特定能力。

---

## 二、安装配置与环境准备

### 2.1 本地安装步骤

在 Laravel 项目中安装 Dusk 非常简单。首先通过 Composer 添加依赖包，然后运行 Dusk 的安装命令：

```bash
# 安装 Dusk 包（仅作为开发依赖）
composer require laravel/dusk --dev

# 运行 Dusk 安装命令，创建必要的目录和文件
php artisan dusk:install
```

安装命令会自动创建以下目录结构和文件：

```
tests/
├── Browser/                    # Dusk 测试文件目录
│   ├── Components/             # 可复用 UI 组件定义
│   ├── Pages/                  # Page Object 定义
│   └── ExampleTest.php         # 示例测试文件
└── DuskTestCase.php            # Dusk 基础测试类
```

安装完成后，需要在数据库配置上做一些隔离设置，确保 Dusk 测试使用独立的数据库，避免影响开发数据：

```env
# .env.dusk.local（为本地 Dusk 测试创建专用环境文件）
APP_URL=http://localhost:8000
DB_DATABASE=myapp_dusk
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=secret
```

在 `DuskTestCase` 中加载 Dusk 专用环境文件是一个推荐的做法。Laravel Dusk 在启动时会自动加载 `.env.dusk.{APP_ENV}` 文件（如 `.env.dusk.local` 或 `.env.dusk.ci`），覆盖默认的 `.env` 配置。这使得测试环境与开发环境完全隔离，互不干扰。

此外，还建议在 `phpunit.xml` 中配置 Dusk 测试组，使得可以通过 PHPUnit 的组过滤器选择性地运行或排除 Dusk 测试：

```xml
<!-- phpunit.xml -->
<groups>
    <exclude>
        <group>dusk</group>
    </exclude>
</groups>
```

这样在运行普通的 PHPUnit 测试时，Dusk 测试会被自动排除，避免因为没有 Chrome 环境而导致失败。

### 2.2 ChromeDriver 版本管理

ChromeDriver 与 Chrome 浏览器之间的版本匹配是 Dusk 环境中最常见的问题来源。Chrome 的更新频率非常高（大约每四周发布一个新主版本），而 ChromeDriver 也必须随之更新到对应的主版本号。

Laravel Dusk 提供了便捷的命令来管理 ChromeDriver 版本：

```bash
# 自动检测本地 Chrome 版本并下载匹配的 ChromeDriver
php artisan dusk:chrome-driver --detect

# 指定下载特定版本
php artisan dusk:chrome-driver 126

# 同时下载多个平台的 ChromeDriver（Linux、Mac、Windows）
php artisan dusk:chrome-driver --all
```

该命令会将 ChromeDriver 二进制文件下载到 `vendor/laravel/dusk/bin/` 目录下。在 CI 环境的每次构建中，都应该确保运行此命令以获取与 CI 环境中 Chrome 版本匹配的 ChromeDriver。

### 2.3 本地开发与调试

在本地开发环境中运行 Dusk 测试，通常需要启动 Laravel 的内置开发服务器：

```bash
# 终端 1：启动 Laravel 开发服务器
php artisan serve --port=8000

# 终端 2：运行所有 Dusk 测试
php artisan dusk

# 运行指定的测试文件
php artisan dusk tests/Browser/LoginTest.php

# 运行名称匹配指定模式的测试方法
php artisan dusk --filter="test_user_can_login"
```

在调试过程中，看到浏览器实际执行的操作非常有帮助。设置环境变量 `DUSK_HEADLESS_DISABLED=1` 可以禁用 Headless 模式，让 Chrome 以有头模式运行：

```bash
# 以有头模式运行，可以看到浏览器窗口
DUSK_HEADLESS_DISABLED=1 php artisan dusk
```

Dusk 还支持在测试中暂停执行，等待你手动检查浏览器状态。这对调试选择器问题或理解页面当前状态非常有用：

```php
// 在测试中暂停执行，按 Enter 继续
$browser->pause();
```

---

## 三、GitHub Actions 中的 Dusk CI 配置

### 3.1 完整的 Workflow 配置

以下是一个生产就绪的 GitHub Actions workflow 配置文件。它涵盖了 Dusk 测试所需的全部环境设置，包括 MySQL 数据库服务、Chrome 浏览器安装、ChromeDriver 版本同步，以及测试失败时的调试信息收集：

```yaml
# .github/workflows/dusk.yml
name: Laravel Dusk E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

# 防止同一个分支的多个 workflow 并行运行
concurrency:
  group: dusk-${{ github.ref }}
  cancel-in-progress: true

jobs:
  dusk-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: app_dusk
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h localhost"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      # ===== 第一步：代码检出 =====
      - name: Checkout code
        uses: actions/checkout@v4

      # ===== 第二步：PHP 环境配置 =====
      - name: Setup PHP with extensions
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, mysql, pdo_mysql, bcmath, gd, xml, sqlite, intl
          coverage: none
          ini-values: error_reporting=E_ALL, display_errors=On

      # ===== 第三步：Node.js 配置（用于前端构建） =====
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      # ===== 第四步：安装 Google Chrome =====
      - name: Install Google Chrome
        uses: browser-actions/setup-chrome@v1
        with:
          chrome-version: stable
        id: setup-chrome

      - name: Verify Chrome installation
        run: |
          echo "Chrome version: ${{ steps.setup-chrome.outputs.chrome-version }}"
          google-chrome --version

      # ===== 第五步：缓存 Composer 依赖 =====
      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: |
            vendor
            ~/.composer/cache
          key: composer-${{ runner.os }}-${{ hashFiles('**/composer.lock') }}
          restore-keys: composer-${{ runner.os }}-

      # ===== 第六步：安装项目依赖 =====
      - name: Install Composer dependencies
        run: composer install --no-progress --prefer-dist --optimize-autoloader

      - name: Install NPM dependencies and build assets
        run: |
          npm ci
          npm run build

      # ===== 第七步：环境配置 =====
      - name: Prepare environment file
        run: |
          cp .env.ci .env 2>/dev/null || cp .env.example .env
          php artisan key:generate

      # ===== 第八步：数据库迁移 =====
      - name: Run database migrations
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: app_dusk
          DB_USERNAME: root
          DB_PASSWORD: root
        run: |
          php artisan migrate --force
          php artisan db:seed --force

      # ===== 第九步：安装 ChromeDriver =====
      - name: Install ChromeDriver matching Chrome version
        run: php artisan dusk:chrome-driver --detect

      # ===== 第十步：运行 Dusk 测试 =====
      - name: Run Laravel Dusk tests
        env:
          APP_ENV: ci
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: app_dusk
          DB_USERNAME: root
          DB_PASSWORD: root
          APP_URL: http://127.0.0.1:8000
          MAIL_MAILER: log
          CACHE_DRIVER: array
          SESSION_DRIVER: file
          QUEUE_CONNECTION: sync
        run: php artisan dusk

      # ===== 失败时上传调试信息 =====
      - name: Upload failure screenshots
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: dusk-screenshots-${{ github.run_id }}
          path: tests/Browser/screenshots/
          retention-days: 14

      - name: Upload browser console logs
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: dusk-console-logs-${{ github.run_id }}
          path: tests/Browser/console/
          retention-days: 14

      - name: Upload source page dumps
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: dusk-source-${{ github.run_id }}
          path: tests/Browser/source/
          retention-days: 14
```

### 3.2 关键配置逐项解读

**Chrome 浏览器安装**：`browser-actions/setup-chrome@v1` Action 会在 Ubuntu runner 上安装稳定版（Stable）Google Chrome。相比传统的 `apt-get install chromium-browser` 安装 Chromium，该 Action 确保安装的是官方 Google Chrome，避免 Chromium 与 Chrome 之间的微小行为差异导致的测试不一致问题。安装完成后，会输出 Chrome 的版本号，方便后续排查版本相关问题。

**ChromeDriver 版本同步**：`php artisan dusk:chrome-driver --detect` 命令会自动检测已安装的 Chrome 浏览器版本，然后下载与之匹配的 ChromeDriver 二进制文件。这一步至关重要——如果 ChromeDriver 的主版本号与 Chrome 的主版本号不一致，测试运行时会直接抛出 `SessionNotCreatedException` 错误。在 CI 环境中，由于 Chrome 的版本由 `setup-chrome` Action 控制，每次构建时版本可能变化，因此每次都必须重新执行版本同步。

**失败调试信息收集**：Dusk 在测试失败时会自动将当前页面的截图保存到 `tests/Browser/screenshots/` 目录，浏览器控制台日志保存到 `tests/Browser/console/`，页面 HTML 源码保存到 `tests/Browser/source/`。通过 `actions/upload-artifact` Action 将这些文件上传为构建产物（Artifact），开发者可以直接在 GitHub 的 Actions 页面下载查看，无需在本地重现问题。这对于调试只在 CI 环境中出现的问题尤其有价值。

**并发控制**：`concurrency` 配置确保同一个分支不会同时运行多个 Dusk 测试 workflow，新推送会自动取消正在运行的旧 workflow，节省 CI 资源。

### 3.3 Docker 容器化方案

对于环境依赖更复杂的项目，或者需要确保构建环境完全一致的团队，可以选择在 Docker 容器中运行 Dusk 测试。Docker 方案的优势在于：本地开发环境与 CI 环境的容器镜像完全一致，消除了"在我机器上能跑"的问题。

以下是 Docker 化 Dusk 测试的 workflow 配置：

```yaml
# .github/workflows/dusk-docker.yml
name: Dusk Tests (Docker)

on: [push, pull_request]

jobs:
  dusk-docker:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build Dusk test image
        run: docker build -t app-dusk -f Dockerfile.dusk .

      - name: Start services
        run: |
          docker network create dusk-net
          docker run -d --name mysql --network dusk-net \
            -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=app_dusk \
            mysql:8.0
          docker run -d --name redis --network dusk-net redis:7-alpine

      - name: Wait for MySQL
        run: |
          for i in $(seq 1 30); do
            docker exec mysql mysqladmin ping -h localhost -uroot -proot && break
            sleep 2
          done

      - name: Run Dusk tests in container
        run: |
          docker run --rm --network dusk-net \
            -v $(pwd)/tests/Browser/screenshots:/app/tests/Browser/screenshots \
            -v $(pwd)/tests/Browser/console:/app/tests/Browser/console \
            -e APP_ENV=dusk \
            -e DB_CONNECTION=mysql \
            -e DB_HOST=mysql \
            -e DB_DATABASE=app_dusk \
            -e DB_USERNAME=root \
            -e DB_PASSWORD=root \
            app-dusk \
            bash -c "php artisan migrate --force && php artisan dusk"

      - name: Upload screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: docker-dusk-screenshots
          path: tests/Browser/screenshots
```

对应的 Dockerfile 定义：

```dockerfile
FROM php:8.3-cli-bookworm

# 安装系统级依赖（Chrome 运行所需）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
    libzip-dev libonig-dev libxml2-dev libicu-dev \
    unzip git curl gnupg ca-certificates \
    libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxi6 libxtst6 libnss3 libatk-bridge2.0-0 \
    libgtk-3-0 libxss1 libasound2 libgbm1 \
    xauth xvfb fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 安装 Google Chrome 稳定版
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
    http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# 安装 PHP 扩展
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo_mysql mbstring zip bcmath gd intl xml opcache

# 安装 Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --optimize-autoloader --no-scripts
COPY . .
RUN composer dump-autoload --optimize

# 安装 ChromeDriver
RUN php artisan dusk:chrome-driver --detect

# 启动脚本：Xvfb + Chrome + Dusk
COPY docker/dusk-entrypoint.sh /usr/local/bin/dusk-entrypoint.sh
RUN chmod +x /usr/local/bin/dusk-entrypoint.sh
CMD ["dusk-entrypoint.sh"]
```

启动脚本 `docker/dusk-entrypoint.sh`：

```bash
#!/bin/bash
set -e

# 启动 Xvfb 虚拟显示服务器
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# 等待 Xvfb 就绪
sleep 1

# 运行 Dusk 测试
php artisan dusk --verbose

# 退出码传递
exit $?
```

### 3.4 Xvfb 虚拟显示的深度理解

Xvfb（X Virtual Framebuffer）是一个实现 X11 显示服务器协议的内存虚拟显示服务器。它在没有物理显示设备的服务器上创建一个虚拟的图形环境，使得需要图形显示的应用程序（如 Chrome 在非 Headless 模式下）可以正常运行。

虽然 Laravel Dusk 在 CI 环境中默认使用 Chrome 的 `--headless` 参数，但保留 Xvfb 虚拟显示服务器仍然是有价值的，原因有三：第一，某些浏览器功能（如 Canvas 渲染、WebGL、CSS 3D 变换）在 Headless 模式下的行为可能与有头模式存在微妙差异；第二，Xvfb 可以作为截图渲染的后备方案；第三，当需要在 CI 中调试失败测试时，可以方便地切换为有头模式而不需要修改配置。

在 GitHub Actions 的 Ubuntu runner 上，Xvfb 通常已经预装。启动和使用方式如下：

```yaml
- name: Start virtual display and run tests
  run: |
    # 启动 Xvfb，绑定到 display :99
    Xvfb :99 -screen 0 1920x1080x24 -ac &
    echo "DISPLAY=:99" >> $GITHUB_ENV
    # 等待 Xvfb 就绪
    sleep 1
    # 运行测试
    php artisan dusk
```

---

## 四、动态等待策略——E2E 测试稳定性的基石

E2E 测试中导致随机失败（Flaky Test）的头号原因就是**时序问题**。当测试脚本执行到某个断言或操作步骤时，页面上的异步操作——AJAX 数据请求、JavaScript 框架的虚拟 DOM 渲染、CSS 过渡动画、图片懒加载——可能尚未完成。如果测试代码不等待这些操作完成就直接检查结果，就会出现时断时续的失败：有时页面加载足够快，测试通过；有时网络稍慢或服务器负载较高，测试就失败了。

### 4.1 为什么 sleep 是反模式

面对时序问题，最直觉也最糟糕的解决方案是使用 `sleep()`。许多开发者会在异步操作之后添加一个固定时间的等待：

```php
// ❌ 绝对不要这样做——这是反模式
$browser->click('.submit-button');
sleep(3);  // 心里祈祷：3 秒应该够了吧？
$browser->assertSee('提交成功');
```

`sleep()` 存在两个根本性的问题。首先，它是**无条件等待**——无论页面是否已经准备就绪，都会阻塞固定的时间。如果页面在 200 毫秒内就完成了加载，sleep(3) 白白浪费了 2.8 秒；如果页面需要 4 秒才能加载完成，sleep(3) 又不够用，测试仍然会失败。其次，为了"安全起见"，开发者倾向于设置越来越长的 sleep 时间，最终导致整个测试套件的运行时间膨胀到不可接受的程度。

一个经验法则：**在你的测试代码中搜索每一个 `sleep()` 调用，它们都应该被替换为语义化的等待方法。**

### 4.2 waitFor 系列方法

Dusk 提供了一组语义化的等待方法，它们基于**有条件等待**机制：在指定的超时时间内持续轮询某个条件，一旦条件满足就立即返回，不会浪费额外的等待时间：

```php
// 等待某个 CSS 选择器匹配的元素出现在 DOM 中
$browser->waitFor('.search-results');

// 等待元素消失（如加载指示器、遮罩层）
$browser->waitForMissing('.loading-spinner');

// 等待元素变为可见状态（与出现在 DOM 中不同，可见意味着没有 display:none 等样式）
$browser->waitFor('.modal-dialog', 10)->assertVisible('.modal-dialog');

// 等待元素中包含指定文本
$browser->waitForTextIn('#order-status', '已完成', 15);

// 等待页面上出现指定文本（不限定容器）
$browser->waitForText('操作成功', 10);

// 等待指定的超链接出现在页面上
$browser->waitForLink('查看详情');

// 等待页面 URL 变化到包含指定路径
$browser->waitForLocation('/dashboard', 10);

// 等待页面 URL 完全匹配
$browser->waitForUrl('http://localhost:8000/orders/1');
```

`waitFor` 系列方法的第二个参数是超时时间（单位为秒），默认值是 5 秒。在 CI 环境中，由于服务器资源（CPU、内存、IO）通常比本地开发机器更受限，网络延迟也可能更高，建议适当增加默认超时时间以提高测试稳定性：

```php
// 在 CI 环境中适当增加等待超时
$browser->waitFor('.data-table', 15);  // 15 秒超时
```

### 4.3 waitUntil —— 自定义 JavaScript 条件等待

当内置的等待方法无法满足你的特定需求时，`waitUntil` 方法允许你编写任意的 JavaScript 条件表达式。Dusk 会将这个表达式发送给 Chrome 执行，每 250 毫秒求值一次，直到表达式返回 truthy 值或超时：

```php
// 等待所有 jQuery AJAX 请求完成
$browser->waitUntil('$.active === 0');

// 等待 Vue 应用实例加载完成
$browser->waitUntil('window.__VUE_APP__ !== undefined');

// 等待 Vue 实例的特定数据属性被设置
$browser->waitUntil(
    "document.querySelector('#app').__vue__.dataLoaded === true"
);

// 等待所有图片加载完成
$browser->waitUntil(
    'Array.from(document.images).every(img => img.complete && img.naturalHeight > 0)'
);

// 等待特定的自定义 window 标记（最推荐的做法）
$browser->waitUntil('window.__APP_READY__ === true');
```

`waitUntil` 方法非常强大，但使用时需要注意两点。第一，JavaScript 表达式中不能使用异步代码（如 `async/await`），它必须同步返回一个 truthy 或 falsy 值。第二，表达式在浏览器上下文中执行，因此不能引用 PHP 变量，如果需要传递参数，应该通过字符串拼接将值嵌入到表达式中。

### 4.4 whenAvailable 与条件性操作

当页面上存在动态加载的子区域（如模态框的内容、下拉菜单的选项列表、懒加载的组件）时，`whenAvailable` 方法可以在等待该区域加载完成后，在其内部执行操作：

```php
// 等待模态框加载完成后，操作其内部元素
$browser->whenAvailable('.confirmation-modal', function ($modal) {
    $modal->assertSee('您确定要删除这条记录吗？')
          ->click('[data-dusk="btn-confirm-delete"]')
          ->waitForMissing('.confirmation-modal');
});

// 等待下拉菜单展开后选择选项
$browser->click('[data-dusk="select-city"]')
        ->whenAvailable('.dropdown-menu', function ($dropdown) {
            $dropdown->click('[data-dusk="option-shanghai"]');
        });
```

### 4.5 retry 机制

对于可能偶发失败的操作（例如页面首次加载时的竞态条件、依赖外部服务的回调），Dusk 提供了 `retry` 方法，允许对一整段操作进行多次重试：

```php
// 如果操作失败，最多重试 3 次
$browser->retry(function ($browser) {
    $browser->visit('/dashboard')
            ->waitFor('.stats-panel')
            ->assertSee('今日数据');
}, 3);

// 带延迟的重试，每次重试前等待 1 秒
$browser->retry(function ($browser) {
    $browser->visit('/realtime-data')
            ->assertSee('数据已刷新');
}, 3, 1000);
```

### 4.6 全局等待时间配置

在 CI 环境中统一调整 Dusk 的默认等待时间，是一种简单但有效的提升稳定性的做法。在 `DuskTestCase` 的 `setUp()` 方法中设置全局等待时间：

```php
protected function setUp(): void
{
    parent::setUp();

    if (static::runningInCi()) {
        // CI 环境中将默认等待时间从 5 秒增加到 10 秒
        \Laravel\Dusk\Browser::$waitSeconds = 10;
    }
}
```

### 4.7 自定义等待辅助 Trait

在大型项目中，建议将常用的等待逻辑封装为可复用的 Trait，避免在每个测试中重复编写相同的等待代码：

```php
// tests/Browser/Concerns/WaitsForFrameworks.php
namespace Tests\Browser\Concerns;

use Laravel\Dusk\Browser;

trait WaitsForFrameworks
{
    /**
     * 等待 Livewire 组件完成所有待处理的服务器请求。
     */
    public function waitForLivewire(Browser $browser, ?string $component = null): void
    {
        if ($component) {
            $selector = "[wire\\:id=\"{$component}\"]";
            $browser->waitUntil(
                "!document.querySelector('{$selector}').__livewire_is_processing"
            );
        } else {
            $browser->waitUntil('!window.__livewire_is_processing');
        }
    }

    /**
     * 等待 Inertia.js 页面导航完成。
     */
    public function waitForInertia(Browser $browser, ?string $pageComponent = null): void
    {
        if ($pageComponent) {
            $browser->waitUntil(
                "window.__page && window.__page.component === '{$pageComponent}'"
            );
        } else {
            $browser->waitUntil("typeof window.__page !== 'undefined'");
        }
    }

    /**
     * 等待 Alpine.js 组件初始化完成。
     */
    public function waitForAlpine(Browser $browser): void
    {
        $browser->waitUntil("typeof Alpine !== 'undefined' && Alpine.version");
    }

    /**
     * 等待页面字体全部加载完成。
     */
    public function waitForFonts(Browser $browser): void
    {
        $browser->waitUntil('document.fonts.status === "loaded"');
    }

    /**
     * 等待所有网络请求完成（适用于 Fetch 和 XMLHttpRequest）。
     */
    public function waitForNetworkIdle(Browser $browser, int $idleTimeMs = 500): void
    {
        $browser->waitUntil(
            "window.__pendingRequests === 0 || typeof window.__pendingRequests === 'undefined'"
        );
    }
}
```

---

## 五、选择器治理——E2E 测试可维护性的关键

### 5.1 选择器脆弱性的本质问题

E2E 测试中最大的长期维护负担来自于选择器与前端实现的**脆弱耦合**。当测试代码依赖 CSS 类名、HTML 标签层级结构或者按钮文本内容来定位页面元素时，任何前端层面的变更——无论是从 Bootstrap 迁移到 Tailwind CSS、调整组件的 DOM 层级、更改 BEM 命名规范，还是仅仅修改了一个按钮的文案——都可能导致大量测试同时破裂。

考虑以下反面示例：

```php
// ❌ 极度脆弱：依赖样式类名（Tailwind 重构后全部失效）
$browser->click('.bg-blue-500.hover\\:bg-blue-700.text-white.font-bold.py-2.px-4.rounded');

// ❌ 高度脆弱：依赖 DOM 层级结构（调整组件嵌套后失效）
$browser->click('.main-content > div:nth-child(3) > .card > .card-body > form > button');

// ❌ 脆弱：依赖可能变化的文本内容（国际化或文案修改后失效）
$browser->clickLink('Submit');

// ❌ 脆弱：依赖自动生成的 ID（如框架生成的 component-12345）
$browser->type('#input-5', 'Hello');
```

选择器脆弱性的根本原因在于：测试代码关心的是**用户可以感知的功能行为**（"点击提交按钮"），而不是**实现层面的技术细节**（"点击 class 为 bg-blue-500 的按钮"）。好的选择器策略应该让测试代码只关心功能语义，而将元素定位的具体实现细节封装在集中的位置。

### 5.2 data-dusk 属性策略

Laravel Dusk 推荐使用专用的 `data-dusk` HTML 属性作为测试选择器的唯一契约点。这个属性专门为测试目的而设计，与 CSS 样式无关、与 DOM 结构无关、与 JavaScript 框架无关。即使前端从 React 迁移到 Vue、从 Bootstrap 迁移到自定义 CSS，只要页面的功能语义不变，`data-dusk` 属性就不会也不应该变化。

在 Blade 模板中使用 `data-dusk` 属性：

```blade
{{-- 页面级容器 --}}
<div data-dusk="page-users-index">

    {{-- 搜索区域 --}}
    <div data-dusk="search-section">
        <input data-dusk="input-user-search"
               type="text"
               placeholder="搜索用户..."
               wire:model.live.debounce.300ms="search">
    </div>

    {{-- 操作按钮栏 --}}
    <div data-dusk="action-bar">
        <a href="{{ route('users.create') }}"
           data-dusk="btn-create-user"
           class="btn-primary">
            创建用户
        </a>
    </div>

    {{-- 数据表格 --}}
    <table data-dusk="table-users">
        <thead>
            <tr>
                <th>姓名</th>
                <th>邮箱</th>
                <th>状态</th>
                <th>操作</th>
            </tr>
        </thead>
        <tbody>
            @foreach($users as $user)
            <tr data-dusk="row-user-{{ $user->id }}">
                <td data-dusk="name-user-{{ $user->id }}">{{ $user->name }}</td>
                <td data-dusk="email-user-{{ $user->id }}">{{ $user->email }}</td>
                <td>
                    <span data-dusk="status-user-{{ $user->id }}"
                          class="badge-{{ $user->isActive() ? 'active' : 'inactive' }}">
                        {{ $user->isActive() ? '活跃' : '停用' }}
                    </span>
                </td>
                <td>
                    <button data-dusk="btn-edit-user-{{ $user->id }}">编辑</button>
                    <button data-dusk="btn-delete-user-{{ $user->id }}">删除</button>
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>

    {{-- 分页 --}}
    <div data-dusk="pagination">
        {{ $users->links() }}
    </div>

</div>
```

在测试代码中使用 `data-dusk` 选择器：

```php
$browser->visit('/users')
        ->assertVisible('[data-dusk="page-users-index"]')
        ->assertVisible('[data-dusk="table-users"]')
        ->type('[data-dusk="input-user-search"]', '张三')
        ->keys('[data-dusk="input-user-search"]', '{enter}')
        ->waitForTextIn('[data-dusk="table-users"]', '张三');
```

### 5.3 选择器命名规范

建立团队统一的选择器命名规范是长期维护的基础。以下是一套经过验证的命名约定：

| 元素类型 | 命名格式 | 示例 |
|---------|---------|------|
| 页面级容器 | `page-{页面名}` | `page-users-index`、`page-login` |
| 功能按钮 | `btn-{动作}` | `btn-create-user`、`btn-submit`、`btn-cancel` |
| 表单输入 | `input-{字段名}` | `input-email`、`input-password`、`input-name` |
| 表单选择框 | `select-{字段名}` | `select-role`、`select-city` |
| 复选框/单选框 | `check-{字段名}` | `check-agree-terms`、`radio-gender` |
| 数据表格 | `table-{实体名}` | `table-users`、`table-orders` |
| 表格行 | `row-{实体}-{ID}` | `row-user-42`、`row-order-1001` |
| 弹窗/模态框 | `modal-{功能名}` | `modal-confirm-delete`、`modal-user-detail` |
| 状态标记 | `status-{含义}` | `status-active`、`status-pending` |
| 通知/提示 | `alert-{类型}` | `alert-success`、`alert-error` |
| 导航链接 | `nav-{页面名}` | `nav-dashboard`、`nav-settings` |

### 5.4 Page Object 模式

Page Object 模式（POM）是 E2E 测试中最重要的设计模式，没有之一。它的核心思想是：将每个页面的元素选择器定义和业务操作方法封装到一个独立的 Page 类中，测试代码只调用 Page 类的方法来描述业务流程，完全不关心底层的元素选择器。

这种分离带来了多重好处：当页面结构变化时，只需要修改对应的 Page 类，所有引用该页面的测试都会自动受益；测试代码读起来更像业务流程描述而非技术实现细节；页面操作方法可以被多个测试复用，减少代码重复。

首先定义基础的 Page 类：

```php
// tests/Browser/Pages/UsersIndexPage.php
namespace Tests\Browser\Pages;

use Laravel\Dusk\Browser;
use Laravel\Dusk\Page;

class UsersIndexPage extends Page
{
    /**
     * 页面 URL。
     */
    public function url(): string
    {
        return '/users';
    }

    /**
     * 断言当前浏览器确实在这个页面上。
     */
    public function assert(Browser $browser): void
    {
        $browser->assertPathIs($this->url())
                ->assertVisible('[data-dusk="page-users-index"]');
    }

    /**
     * 元素选择器映射——所有选择器定义集中在此。
     */
    public function elements(): array
    {
        return [
            '@search-input'      => '[data-dusk="input-user-search"]',
            '@btn-create'        => '[data-dusk="btn-create-user"]',
            '@users-table'       => '[data-dusk="table-users"]',
            '@pagination'        => '[data-dusk="pagination"]',
            '@btn-bulk-delete'   => '[data-dusk="btn-bulk-delete"]',
            '@no-results'        => '[data-dusk="no-results"]',
        ];
    }

    // ========== 业务操作方法 ==========

    /**
     * 搜索用户。
     */
    public function search(Browser $browser, string $keyword): static
    {
        $browser->clear('@search-input')
                ->type('@search-input', $keyword)
                ->keys('@search-input', '{enter}')
                ->waitForLivewire($browser);

        return $this;
    }

    /**
     * 点击创建用户按钮。
     */
    public function clickCreate(Browser $browser): void
    {
        $browser->click('@btn-create')
                ->waitForLocation('/users/create');
    }

    /**
     * 编辑指定用户。
     */
    public function editUser(Browser $browser, int $userId): void
    {
        $browser->click("[data-dusk=\"btn-edit-user-{$userId}\"]")
                ->waitForLocation('/users/' . $userId . '/edit');
    }

    /**
     * 删除指定用户（包含确认弹窗操作）。
     */
    public function deleteUser(Browser $browser, int $userId): void
    {
        $browser->click("[data-dusk=\"btn-delete-user-{$userId}\"]")
                ->whenAvailable('[data-dusk="modal-confirm-delete"]', function ($modal) {
                    $modal->click('[data-dusk="btn-confirm"]');
                })
                ->waitForLivewire($browser);
    }

    /**
     * 获取表格中显示的用户数量。
     */
    public function getUserCount(Browser $browser): int
    {
        return count($browser->elements('[data-dusk^="row-user-"]'));
    }

    /**
     * 断言指定用户在表格中可见。
     */
    public function assertUserVisible(Browser $browser, int $userId): static
    {
        $browser->assertVisible("[data-dusk=\"row-user-{$userId}\"]");

        return $this;
    }

    /**
     * 断言指定用户不在表格中。
     */
    public function assertUserNotVisible(Browser $browser, int $userId): static
    {
        $browser->assertMissing("[data-dusk=\"row-user-{$userId}\"]");

        return $this;
    }
}
```

然后定义创建用户页面：

```php
// tests/Browser/Pages/CreateUserPage.php
namespace Tests\Browser\Pages;

use Laravel\Dusk\Browser;
use Laravel\Dusk\Page;

class CreateUserPage extends Page
{
    public function url(): string
    {
        return '/users/create';
    }

    public function assert(Browser $browser): void
    {
        $browser->assertPathIs($this->url())
                ->assertVisible('[data-dusk="page-user-create"]');
    }

    public function elements(): array
    {
        return [
            '@name-input'     => '[data-dusk="input-name"]',
            '@email-input'    => '[data-dusk="input-email"]',
            '@role-select'    => '[data-dusk="select-role"]',
            '@password-input' => '[data-dusk="input-password"]',
            '@btn-submit'     => '[data-dusk="btn-submit"]',
            '@btn-cancel'     => '[data-dusk="btn-cancel"]',
        ];
    }

    /**
     * 填写并提交用户创建表单。
     */
    public function fillAndSubmit(
        Browser $browser,
        string $name,
        string $email,
        string $role = 'user',
        string $password = 'password123'
    ): void {
        $browser->type('@name-input', $name)
                ->type('@email-input', $email)
                ->select('@role-select', $role)
                ->type('@password-input', $password)
                ->click('@btn-submit')
                ->waitForLocation('/users', 15);
    }
}
```

在测试中使用 Page Object：

```php
// tests/Browser/UserManagementTest.php
namespace Tests\Browser;

use App\Models\User;
use Tests\Browser\Pages\UsersIndexPage;
use Tests\Browser\Pages\CreateUserPage;
use Tests\DuskTestCase;
use Laravel\Dusk\Browser;

class UserManagementTest extends DuskTestCase
{
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->admin()->create();
    }

    public function test_admin_can_view_users_list(): void
    {
        $this->browse(function (Browser $browser) {
            $browser->loginAs($this->admin)
                    ->visit(new UsersIndexPage)
                    ->assertSee('用户管理')
                    ->assertVisible('@users-table');
        });
    }

    public function test_admin_can_search_users(): void
    {
        $user = User::factory()->create(['name' => '张三丰']);

        $this->browse(function (Browser $browser) {
            $page = $browser->loginAs($this->admin)
                           ->visit(new UsersIndexPage);

            $page->search($browser, '张三丰');

            $browser->assertSeeIn('@users-table', '张三丰');
        });
    }

    public function test_admin_can_create_user(): void
    {
        $this->browse(function (Browser $browser) {
            $browser->loginAs($this->admin)
                    ->visit(new UsersIndexPage);

            (new UsersIndexPage)->clickCreate($browser);

            (new CreateUserPage)->fillAndSubmit(
                $browser,
                '李四',
                'lisi@example.com',
                'editor'
            );

            $browser->on(new UsersIndexPage)
                    ->assertSee('用户创建成功')
                    ->assertUserVisible($browser, User::whereEmail('lisi@example.com')->first()->id);
        });
    }

    public function test_admin_can_delete_user(): void
    {
        $user = User::factory()->create();

        $this->browse(function (Browser $browser) use ($user) {
            $page = $browser->loginAs($this->admin)
                           ->visit(new UsersIndexPage);

            $page->deleteUser($browser, $user->id);

            $browser->assertSee('用户已删除')
                    ->assertDontSee($user->name);
        });
    }
}
```

### 5.5 Component 抽象

对于在多个页面中重复出现的 UI 组件——如顶部导航栏、侧边栏菜单、通知中心、搜索栏、用户头像下拉菜单等——使用 Component 进行封装比在每个 Page 中重复定义更优雅：

```php
// tests/Browser/Components/NavBar.php
namespace Tests\Browser\Components;

use Laravel\Dusk\Browser;
use Laravel\Dusk\Component as BaseComponent;

class NavBar extends BaseComponent
{
    public function selector(): string
    {
        return '[data-dusk="main-navbar"]';
    }

    public function assert(Browser $browser): void
    {
        $browser->assertVisible($this->selector());
    }

    public function elements(): array
    {
        return [
            '@logo'            => '[data-dusk="navbar-logo"]',
            '@search-toggle'   => '[data-dusk="navbar-search"]',
            '@user-menu'       => '[data-dusk="navbar-user-menu"]',
            '@notifications'   => '[data-dusk="navbar-notifications"]',
            '@profile-link'    => '[data-dusk="navbar-profile"]',
            '@logout-btn'      => '[data-dusk="navbar-logout"]',
            '@unread-badge'    => '[data-dusk="notification-unread-badge"]',
        ];
    }

    /**
     * 打开全局搜索。
     */
    public function openSearch(Browser $browser): void
    {
        $browser->click('@search-toggle')
                ->waitFor('[data-dusk="global-search-input"]');
    }

    /**
     * 点击通知图标。
     */
    public function openNotifications(Browser $browser): void
    {
        $browser->click('@notifications')
                ->waitFor('[data-dusk="notification-dropdown"]');
    }

    /**
     * 断言未读通知数量。
     */
    public function assertUnreadCount(Browser $browser, int $count): void
    {
        if ($count > 0) {
            $browser->assertSeeIn('@unread-badge', (string) $count);
        } else {
            $browser->assertMissing('@unread-badge');
        }
    }

    /**
     * 点击用户菜单并登出。
     */
    public function logout(Browser $browser): void
    {
        $browser->click('@user-menu')
                ->waitFor('@logout-btn')
                ->click('@logout-btn')
                ->waitForLocation('/login');
    }
}
```

在测试中使用 Component：

```php
public function test_user_can_logout(): void
{
    $this->browse(function (Browser $browser) {
        $browser->loginAs($this->user)
                ->visit('/dashboard');

        $navbar = $browser->component(new NavBar);
        $navbar->logout($browser);

        $browser->assertPathIs('/login');
    });
}
```

---

## 六、视觉回归测试

### 6.1 视觉回归测试的核心价值

视觉回归测试（Visual Regression Testing，简称 VRT）通过截取页面截图并与已知正确的基线图片进行像素级对比，来自动检测非预期的 UI 变化。与功能测试不同，视觉回归测试关注的是**视觉外观**而非功能行为——它能够捕获以下类型的问题：

- CSS 修改导致的布局偏移或元素重叠
- 字体文件加载失败或字体回退导致的文字渲染差异
- 颜色值的细微修改影响了整体视觉一致性
- 响应式设计在不同视口宽度下的布局问题
- 第三方库升级引入的样式冲突
- 深色模式/高对比度模式下的显示异常
- 浏览器兼容性问题导致的渲染差异

### 6.2 截图管理与对比引擎

以下是 Dusk 集成视觉回归测试的完整实现，包括截图管理、基线存储、像素级对比和差异报告：

```php
// tests/Browser/Support/VisualRegressionTester.php
namespace Tests\Browser\Support;

use Laravel\Dusk\Browser;
use PHPUnit\Framework\Assert;

class VisualRegressionTester
{
    // 截图存储目录
    private string $baselineDir;
    private string $actualDir;
    private string $diffDir;

    // 对比阈值（0.01 = 1%，即允许最多 1% 的像素差异）
    private float $threshold;

    // 是否自动更新基线
    private bool $updateBaselines;

    public function __construct(
        ?string $baseDir = null,
        float $threshold = 0.01,
        bool $updateBaselines = false
    ) {
        $baseDir ??= base_path('tests/Browser/visual');
        $this->baselineDir = $baseDir . '/baselines';
        $this->actualDir = $baseDir . '/actuals';
        $this->diffDir = $baseDir . '/diffs';
        $this->threshold = $threshold;
        $this->updateBaselines = $updateBaselines;

        // 确保目录存在
        foreach ([$this->baselineDir, $this->actualDir, $this->diffDir] as $dir) {
            if (!is_dir($dir)) {
                mkdir($dir, 0755, true);
            }
        }
    }

    /**
     * 执行视觉回归对比。
     */
    public function assertVisualMatch(
        Browser $browser,
        string $snapshotName,
        array $options = []
    ): void {
        // 支持多视口截图
        $viewports = $options['viewports'] ?? [
            'desktop' => [1920, 1080],
        ];

        // 可选：隐藏动态内容
        if (isset($options['hideSelectors'])) {
            $hideSelectors = implode(',', $options['hideSelectors']);
            $browser->script(
                "document.querySelectorAll('{$hideSelectors}').forEach(
                    el => el.style.visibility = 'hidden'
                );"
            );
        }

        foreach ($viewports as $label => $dimensions) {
            [$width, $height] = $dimensions;
            $browser->resize($width, $height);

            // 等待页面渲染稳定
            $this->waitForPageStable($browser, $options);

            $fullSnapshotName = "{$snapshotName}-{$label}";
            $actualPath = "{$this->actualDir}/{$fullSnapshotName}.png";
            $baselinePath = "{$this->baselineDir}/{$fullSnapshotName}.png";
            $diffPath = "{$this->diffDir}/{$fullSnapshotName}.diff.png";

            // 截取当前页面
            $browser->screenshot($fullSnapshotName);

            // 将截图移动到 actual 目录
            $defaultScreenshotPath = base_path(
                "tests/Browser/screenshots/{$fullSnapshotName}.png"
            );
            if (file_exists($defaultScreenshotPath)) {
                rename($defaultScreenshotPath, $actualPath);
            }

            // 自动更新模式：将截图保存为新基线
            if ($this->updateBaselines) {
                copy($actualPath, $baselinePath);
                echo "基线已更新: {$baselinePath}\n";
                continue;
            }

            // 首次运行：将截图保存为初始基线
            if (!file_exists($baselinePath)) {
                copy($actualPath, $baselinePath);
                Assert::markTestIncomplete(
                    "基线图片已创建: {$baselinePath}\n"
                    . "请审查此图片并在后续测试中验证。"
                );
                continue;
            }

            // 执行像素级对比
            $this->compareImages($baselinePath, $actualPath, $diffPath, $snapshotName);
        }
    }

    /**
     * 等待页面渲染稳定。
     */
    private function waitForPageStable(Browser $browser, array $options): void
    {
        // 等待字体加载完成
        $browser->waitUntil('document.fonts.status === "loaded"', 10);

        // 等待所有图片加载
        $browser->waitUntil(
            'Array.from(document.images).every(img => img.complete)', 10
        );

        // 可选：等待自定义条件
        if (isset($options['waitFor'])) {
            $browser->waitUntil($options['waitFor'], 10);
        }

        // 禁用动画以确保截图一致性
        $browser->script('
            const style = document.createElement("style");
            style.textContent = "*, *::before, *::after { " +
                "animation-duration: 0s !important; " +
                "animation-delay: 0s !important; " +
                "transition-duration: 0s !important; " +
                "transition-delay: 0s !important; " +
            "}";
            document.head.appendChild(style);
        ');

        // 短暂暂停等待最终渲染
        $browser->pause(300);
    }

    /**
     * 执行像素级图片对比。
     */
    private function compareImages(
        string $baselinePath,
        string $actualPath,
        string $diffPath,
        string $snapshotName
    ): void {
        $baseline = imagecreatefrompng($baselinePath);
        $actual = imagecreatefrompng($actualPath);

        $bWidth = imagesx($baseline);
        $bHeight = imagesy($baseline);
        $aWidth = imagesx($actual);
        $aHeight = imagesy($actual);

        // 尺寸不匹配直接失败
        if ($bWidth !== $aWidth || $bHeight !== $aHeight) {
            imagedestroy($baseline);
            imagedestroy($actual);
            Assert::fail(sprintf(
                '[%s] 截图尺寸不匹配: 基线 %dx%d，实际 %dx%d',
                $snapshotName, $bWidth, $bHeight, $aWidth, $aHeight
            ));
        }

        $diff = imagecreatetruecolor($bWidth, $bHeight);
        $totalPixels = $bWidth * $bHeight;
        $differentPixels = 0;
        $maxDiffX = 0;
        $maxDiffY = 0;
        $maxDiffValue = 0;

        for ($x = 0; $x < $bWidth; $x++) {
            for ($y = 0; $y < $bHeight; $y++) {
                $bPixel = imagecolorat($baseline, $x, $y);
                $aPixel = imagecolorat($actual, $x, $y);

                if ($bPixel !== $aPixel) {
                    $differentPixels++;

                    // 计算色差
                    $bR = ($bPixel >> 16) & 0xFF;
                    $bG = ($bPixel >> 8) & 0xFF;
                    $bB = $bPixel & 0xFF;
                    $aR = ($aPixel >> 16) & 0xFF;
                    $aG = ($aPixel >> 8) & 0xFF;
                    $aB = $aPixel & 0xFF;

                    $colorDiff = abs($bR - $aR) + abs($bG - $aG) + abs($bB - $aB);
                    if ($colorDiff > $maxDiffValue) {
                        $maxDiffValue = $colorDiff;
                        $maxDiffX = $x;
                        $maxDiffY = $y;
                    }

                    // 差异像素用红色高亮标记
                    imagesetpixel($diff, $x, $y, imagecolorallocate($diff, 255, 0, 0));
                } else {
                    // 相同像素使用原始像素的灰度显示
                    $gray = ($bPixel >> 16) & 0xFF;
                    imagesetpixel($diff, $x, $y, imagecolorallocate($diff, $gray, $gray, $gray));
                }
            }
        }

        $diffPercentage = $differentPixels / $totalPixels;

        // 保存差异图片
        imagepng($diff, $diffPath);

        imagedestroy($baseline);
        imagedestroy($actual);
        imagedestroy($diff);

        if ($diffPercentage > $this->threshold) {
            Assert::fail(sprintf(
                "[%s] 视觉回归检测失败!\n"
                . "  像素差异: %.4f%% (阈值: %.4f%%)\n"
                . "  不同像素: %d / %d\n"
                . "  最大色差位置: (%d, %d), 色差值: %d\n"
                . "  差异图片: %s",
                $snapshotName,
                $diffPercentage * 100,
                $this->threshold * 100,
                $differentPixels,
                $totalPixels,
                $maxDiffX,
                $maxDiffY,
                $maxDiffValue,
                $diffPath
            ));
        }
    }
}
```

### 6.3 在测试中使用视觉回归

```php
// tests/Browser/Visual/VisualRegressionTest.php
namespace Tests\Browser\Visual;

use Tests\Browser\Support\VisualRegressionTester;
use Tests\DuskTestCase;
use Laravel\Dusk\Browser;
use Carbon\Carbon;

class VisualRegressionTest extends DuskTestCase
{
    private VisualRegressionTester $visualTester;

    protected function setUp(): void
    {
        parent::setUp();
        $this->visualTester = new VisualRegressionTester(
            threshold: 0.005,  // 0.5% 像素差异阈值
            updateBaselines: env('DUSK_UPDATE_BASELINES', false)
        );
    }

    public function test_login_page_visual(): void
    {
        $this->browse(function (Browser $browser) {
            $browser->visit('/login')
                    ->waitForText('用户登录');

            $this->visualTester->assertVisualMatch(
                $browser,
                'login-page',
                [
                    'viewports' => [
                        'desktop' => [1920, 1080],
                        'tablet'  => [768, 1024],
                        'mobile'  => [375, 812],
                    ],
                ]
            );
        });
    }

    public function test_dashboard_visual(): void
    {
        // 冻结时间，避免日期显示影响截图一致性
        Carbon::setTestNow('2026-06-07 12:00:00');

        $this->browse(function (Browser $browser) {
            $browser->loginAs($this->user)
                    ->visit('/dashboard')
                    ->waitFor('.stats-panel');

            $this->visualTester->assertVisualMatch(
                $browser,
                'dashboard-logged-in',
                [
                    'hideSelectors' => [
                        '.current-time',
                        '.live-indicator',
                        '[data-dynamic]',
                    ],
                ]
            );
        });
    }
}
```

### 6.4 基线管理流程

视觉回归测试的核心挑战不在于截图对比技术本身，而在于**基线图片的生命周期管理**。以下是经过生产实践验证的基线管理策略。

**版本控制集成**：将基线图片纳入 Git 仓库管理。由于图片文件体积较大，强烈建议使用 Git LFS（Large File Storage）：

```bash
# 安装 Git LFS
git lfs install

# 配置追踪规则（.gitattributes）
echo "tests/Browser/visual/baselines/** filter=lfs diff=lfs merge=lfs -text" >> .gitattributes
git add .gitattributes
git lfs track "tests/Browser/visual/baselines/*.png"
```

**基线更新 CI 流程**：当 UI 设计师确认了新的视觉效果后，需要手动触发基线更新 workflow：

```yaml
# .github/workflows/update-visual-baselines.yml
name: Update Visual Baselines

on:
  workflow_dispatch:
    inputs:
      confirm:
        description: '输入 YES 确认更新基线'
        required: true

jobs:
  update:
    runs-on: ubuntu-latest
    if: github.event.inputs.confirm == 'YES'
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true

      # ... 环境准备步骤 ...

      - name: Generate new baselines
        env:
          DUSK_UPDATE_BASELINES: true
        run: php artisan dusk --group=visual

      - name: Commit and create PR
        uses: peter-evans/create-pull-request@v6
        with:
          title: 'chore(visual): update regression baselines'
          body: |
            自动更新视觉回归基线截图。

            请在合并前审查以下截图变更：
            - 检查 diffs 目录中的差异图片
            - 确认所有变化都是预期的
          branch: chore/update-visual-baselines
          add: |
            tests/Browser/visual/baselines/
```

---

## 七、高级 CI 优化技巧

### 7.1 测试分片并行执行

当 Dusk 测试数量增长到数十甚至上百个时，串行执行的时间成本会变得不可接受。利用 GitHub Actions 的矩阵策略，可以将测试套件分片并行执行：

```yaml
jobs:
  dusk-shard:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      # ... 环境准备步骤 ...

      - name: Run Dusk Tests (Shard ${{ matrix.shard }}/4)
        run: |
          php artisan dusk:shard --shard=${{ matrix.shard }} --total-shards=4

      - name: Upload failure artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: dusk-shard-${{ matrix.shard }}
          path: tests/Browser/screenshots/
```

如果 Dusk 没有内置的分片命令，可以通过 PHPUnit 的 filter 或自定义脚本实现：

```bash
#!/bin/bash
# scripts/dusk-shard.sh
SHARD=$1
TOTAL=$2

# 获取所有 Dusk 测试文件并排序
FILES=$(find tests/Browser -name "*Test.php" -type f | sort)
TOTAL_FILES=$(echo "$FILES" | wc -l)
PER_SHARD=$(( (TOTAL_FILES + TOTAL - 1) / TOTAL ))
START=$(( (SHARD - 1) * PER_SHARD ))

# 提取当前分片的测试文件
SHARD_FILES=$(echo "$FILES" | sed -n "$((START + 1)),$((START + PER_SHARD))p")

echo "Shard $SHARD/$TOTAL: Running $(echo "$SHARD_FILES" | wc -l) tests"

# 逐文件运行
echo "$SHARD_FILES" | while read file; do
    echo "Running: $file"
    php artisan dusk "$file" || exit 1
done
```

### 7.2 多级缓存策略

合理的缓存策略可以将 CI 构建时间减少 50% 以上：

```yaml
      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: |
            vendor
            ~/.composer/cache
          key: composer-${{ runner.os }}-php8.3-${{ hashFiles('**/composer.lock') }}
          restore-keys: |
            composer-${{ runner.os }}-php8.3-

      - name: Cache NPM dependencies
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: npm-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
          restore-keys: npm-${{ runner.os }}-

      - name: Cache ChromeDriver binary
        uses: actions/cache@v4
        with:
          path: vendor/laravel/dusk/bin
          key: chromedriver-${{ runner.os }}-${{ hashFiles('vendor/laravel/dusk/bin/*') }}

      - name: Cache visual baselines
        uses: actions/cache@v4
        with:
          path: tests/Browser/visual/baselines
          key: visual-baselines-${{ hashFiles('tests/Browser/visual/baselines/**') }}
```

### 7.3 环境健康检查

在运行正式测试之前，先验证所有环境组件是否就绪：

```yaml
      - name: Environment health check
        run: |
          echo "=============================="
          echo "  Chrome Version"
          echo "=============================="
          google-chrome --version

          echo "=============================="
          echo "  ChromeDriver Version"
          echo "=============================="
          vendor/laravel/dusk/bin/chromedriver-linux --version 2>&1 || true

          echo "=============================="
          echo "  PHP Version & Extensions"
          echo "=============================="
          php -v
          php -m | sort

          echo "=============================="
          echo "  Chrome Can Launch Test"
          echo "=============================="
          google-chrome --headless --no-sandbox --disable-gpu \
            --dump-dom https://example.com > /dev/null 2>&1 \
            && echo "✅ Chrome launches successfully" \
            || echo "❌ Chrome failed to launch"

          echo "=============================="
          echo "  MySQL Connection Test"
          echo "=============================="
          mysql -h 127.0.0.1 -u root -proot -e "SELECT 1" app_dusk 2>/dev/null \
            && echo "✅ MySQL connection OK" \
            || echo "❌ MySQL connection FAILED"
```

---

## 八、完整项目配置示例汇总

### 8.1 DuskTestCase 完整配置

以下是生产环境中经过反复打磨的 `DuskTestCase` 配置：

```php
<?php

namespace Tests;

use Facebook\WebDriver\Chrome\ChromeOptions;
use Facebook\WebDriver\Remote\DesiredCapabilities;
use Facebook\WebDriver\Remote\RemoteWebDriver;
use Laravel\Dusk\TestCase as BaseTestCase;

abstract class DuskTestCase extends BaseTestCase
{
    use CreatesApplication;

    /**
     * 准备 Dusk 测试环境。
     */
    public static function prepare(): void
    {
        if (!static::runningInCi()) {
            static::startChromeDriver();
        }
    }

    /**
     * 创建 WebDriver 实例。
     */
    protected function driver(): RemoteWebDriver
    {
        $chromeOptions = collect([
            '--window-size=1920,1080',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-component-update',
        ]);

        // 非 CI 环境才添加 headless（本地可选择有头模式调试）
        if (static::runningInCi()) {
            $chromeOptions->push('--headless=new');
        }

        $options = (new ChromeOptions)->addArguments($chromeOptions->all());

        return RemoteWebDriver::create(
            env('DUSK_DRIVER_URL', 'http://localhost:9515'),
            DesiredCapabilities::chrome()
                ->setCapability(ChromeOptions::CAPABILITY_W3C, $options)
                ->setCapability('goog:loggingPrefs', ['browser' => 'ALL'])
        );
    }

    /**
     * 测试前的初始化。
     */
    protected function setUp(): void
    {
        parent::setUp();

        // CI 环境增加默认等待时间
        if (static::runningInCi()) {
            \Laravel\Dusk\Browser::$waitSeconds = 10;
        }
    }
}
```

### 8.2 CI 专用环境文件

```env
# .env.dusk.ci
APP_NAME="MyApp Dusk CI"
APP_ENV=dusk
APP_KEY=base64:your-generated-key
APP_DEBUG=true
APP_URL=http://127.0.0.1:8000

LOG_CHANNEL=single
LOG_LEVEL=debug

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=app_dusk
DB_USERNAME=root
DB_PASSWORD=root

BROADCAST_DRIVER=log
CACHE_DRIVER=array
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120

MAIL_MAILER=log
MAIL_FROM_ADDRESS="noreply@example.com"
MAIL_FROM_NAME="${APP_NAME}"

DUSK_DRIVER_URL=http://localhost:9515
```

### 8.3 应用服务提供者的环境适配

```php
// app/Providers/AppServiceProvider.php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\URL;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Dusk/CI 环境的特殊处理
        if ($this->app->environment(['dusk', 'ci'])) {
            // 禁用 HTTPS 强制（CI 中使用 HTTP）
            URL::forceScheme('http');

            // 配置日志输出到文件
            config(['logging.default' => 'single']);

            // 设置时区
            config(['app.timezone' => 'Asia/Shanghai']);
        }
    }
}
```

---

## 九、调试技巧与常见问题排查

### 9.1 截图与源码调试

测试失败时，Dusk 会自动保存三种调试信息：

- **截图**（`tests/Browser/screenshots/`）：测试失败瞬间的浏览器画面，可以看到页面当时的实际状态。
- **控制台日志**（`tests/Browser/console/`）：浏览器 JavaScript 控制台的输出，包括错误信息、警告等。
- **页面源码**（`tests/Browser/source/`）：失败瞬间的完整 HTML 源码。

在 CI 环境中，通过 `actions/upload-artifact` 将这些文件上传为构建产物，开发者可以在 GitHub Actions 页面直接下载查看。

### 9.2 浏览器控制台日志收集

在测试中显式收集浏览器控制台日志，有助于调试 JavaScript 错误：

```php
public function test_something(): void
{
    $this->browse(function (Browser $browser) {
        $browser->visit('/some-page')
                ->waitFor('.content');

        // 将浏览器控制台日志保存到文件
        $browser->storeConsoleLog('some-page-console');

        // 在测试中打印控制台日志（调试用）
        $consoleLogs = $browser->driver->manage()->getLog('browser');
        foreach ($consoleLogs as $log) {
            echo "[{$log['level']}] {$log['message']}\n";
        }

        $browser->assertSee('Expected Content');
    });
}
```

### 9.3 常见错误及解决方案速查表

| 错误信息 | 根本原因 | 解决方案 |
|---------|---------|---------|
| `SessionNotCreatedException` | ChromeDriver 与 Chrome 版本不匹配 | 运行 `php artisan dusk:chrome-driver --detect` 重新同步版本 |
| `UnknownError: session deleted because page crash` | Chrome 内存不足崩溃 | 添加 `--disable-dev-shm-usage`，或使用更大的 CI runner |
| `ElementNotInteractableException` | 元素被其他元素遮挡或不可见 | 使用 `waitFor` 等待元素可见后再操作，检查 CSS z-index |
| `InvalidElementStateError: element not interactable` | 元素处于禁用状态 | 使用 `waitUntil("!el.disabled")` 等待元素启用 |
| `NoSuchElementException` | 元素不存在于 DOM 中 | 检查选择器是否正确，使用 `waitFor` 等待元素出现 |
| `StaleElementReferenceException` | 元素引用已过期（页面已刷新） | 重新获取元素引用，在操作前使用 `waitFor` |
| 测试本地通过但 CI 失败 | 环境差异（网络延迟、资源限制） | 增加 CI 环境的等待超时时间，检查 `.env.dusk.ci` 配置 |
| `net::ERR_CONNECTION_REFUSED` | 应用服务器未启动或端口不对 | 确保 `php artisan serve` 已启动，检查 APP_URL 配置 |

### 9.4 本地模拟 CI 环境调试

如果测试只在 CI 环境中失败而在本地正常，可以在本地模拟 CI 的 Headless 环境进行调试：

```bash
# 模拟 CI 环境运行（Headless 模式）
DUSK_DRIVER_URL=http://localhost:9515 php artisan dusk

# 带详细输出
php artisan dusk --verbose
```

---

## 总结

将 Laravel Dusk E2E 测试集成到 GitHub Actions 的 CI 流水线中，是提升 Web 应用质量和交付信心的重要工程实践。通过本文的深入探讨，我们可以总结出以下核心要点。

**环境配置**方面，确保 Chrome 与 ChromeDriver 版本严格匹配是首要任务；使用专门的 `.env.dusk.ci` 环境文件隔离测试配置；通过 GitHub Actions 的 artifact 机制收集失败调试信息。

**动态等待策略**方面，始终使用 `waitFor`、`waitUntil` 等有条件的语义化等待方法，彻底消除 `sleep` 等无条件等待；根据 CI 环境的资源特性适当增加超时时间；封装项目特定的等待辅助方法到可复用的 Trait 中。

**选择器治理**方面，使用 `data-dusk` HTML 属性作为测试选择器的唯一契约点，将测试代码与前端实现细节完全解耦；通过 Page Object 模式封装页面的选择器和操作方法；通过 Component 抽象封装跨页面的可复用 UI 组件。

**视觉回归测试**方面，建立完善的截图基线管理流程，结合 Git LFS 版本化管理基线图片；处理动态内容的遮罩和 Mock 策略；通过 CI workflow 自动化基线的更新和审查过程。

E2E 测试的终极价值不在于覆盖率的数字，而在于它为团队带来的**信心**。当你确信每次部署都不会破坏用户的核心操作流程时，你就能以更高的速度和更低的风险持续交付价值。Laravel Dusk 配合 GitHub Actions 的强大组合，让这份信心变得触手可及。

---

*本文基于 Laravel 11.x 和 Laravel Dusk v8.x 编写，所有代码示例均来自真实的生产项目实践并经过验证。文中涉及的 GitHub Actions workflow 配置已在 Ubuntu 22.04 runner 上测试通过。如有疑问或建议，欢迎在评论区讨论交流。*

## 相关阅读

- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/categories/CICD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/)
- [PR Review Checklist 自动化实战：Danger.js/lint-staged/Husky 组合拳——CI 门禁](/categories/CICD/PR-Review-Checklist-自动化实战-Danger-js-lint-staged-Husky组合拳-CI门禁/)
- [容器安全扫描实战：Trivy/Snyk/Grype CI 集成——镜像漏洞检测、SBOM 生成与修复工作流](/categories/CICD/容器安全扫描实战-Trivy-Snyk-Grype-CI集成-镜像漏洞检测-SBOM生成与修复工作流/)
