---

title: Laravel Dusk CI 实战：Headless Chrome 在 GitHub Actions 中的 E2E 测试——动态等待、选择器治理与视觉回归
keywords: [Laravel Dusk CI, Headless Chrome, GitHub Actions, E2E, 中的, 动态等待, 选择器治理与视觉回归]
description: Laravel Dusk 端到端测试在 CI 环境中的完整实战指南。从 Headless Chrome 配置、GitHub Actions 流水线搭建，到动态等待策略、选择器治理规范、视觉回归测试（Visual Regression）的落地，涵盖常见踩坑与调试技巧，帮助团队在持续集成中建立可靠的 UI 自动化测试防线。
date: 2026-06-09 06:22:00
tags:
- Laravel Dusk
- E2E Testing
- CI/CD
- GitHub Actions
- headless-chrome
- visual-regression
- PHP
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




## 一、开篇：为什么 E2E 测试在 CI 中总是"翻车"

本地跑 `php artisan dusk` 一切正常，推到 CI 就各种 Timeout、ElementNotFound、截图全白——这是每个试图在持续集成中跑端到端测试的开发者都经历过的噩梦。

问题的根源不在于 Dusk 本身，而在于 CI 环境与本地开发环境的根本差异：

- **无头浏览器（Headless Chrome）** 的行为与有头模式存在微妙差异
- **CI 机器资源有限**，页面渲染速度远低于本地开发机
- **网络延迟和数据库状态** 在每次 CI 运行中都不一致
- **选择器脆弱**，CSS 类名随前端构建变化而失效

本文将从零搭建一套生产级的 Laravel Dusk CI 方案，解决上述所有问题。

## 二、架构总览

```
┌─────────────────────────────────────────────────────┐
│                   GitHub Actions                      │
│                                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐  │
│  │ Setup PHP │──▶│ Install  │──▶│ Run Dusk Tests   │  │
│  │ + Chrome  │   │ Composer │   │ (Headless Mode)  │  │
│  └──────────┘   └──────────┘   └────────┬─────────┘  │
│                                          │             │
│                               ┌──────────▼──────────┐ │
│                               │  Upload Artifacts   │ │
│                               │  (Screenshots/Logs) │ │
│                               └─────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Visual Regression (可选)                        │ │
│  │  Compare Screenshots → Pass/Fail                 │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

核心组件：

1. **GitHub Actions Job**：提供 Ubuntu 环境 + PHP + Chrome
2. **Laravel Dusk**：驱动 Headless Chrome 执行浏览器操作
3. **动态等待策略**：替代硬编码 `sleep()`，适配 CI 的不确定延迟
4. **选择器治理**：建立 `data-testid` 规范，脱离 CSS 类名依赖
5. **视觉回归**：截图对比，捕捉非预期的 UI 变更

## 三、环境搭建：GitHub Actions + Dusk

### 3.1 基础 Workflow 配置

创建 `.github/workflows/dusk.yml`：

```yaml
name: Laravel Dusk Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  dusk-tests:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: dusk_testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, libxml, mbstring, zip, pcntl, pdo, sqlite, pdo_mysql
          coverage: none

      - name: Install Google Chrome
        uses: browser-actions/setup-chrome@v1
        with:
          chrome-version: stable

      - name: Copy .env
        run: |
          cp .env.dusk.ci .env
          php artisan key:generate

      - name: Install Composer Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Install Dusk ChromeDriver
        run: php artisan dusk:chrome-driver --detect

      - name: Run Migrations & Seeders
        run: |
          php artisan migrate --force
          php artisan db:seed --force

      - name: Start Laravel Server
        run: |
          php artisan serve --port=8000 &
          sleep 3

      - name: Run Dusk Tests
        env:
          APP_URL: http://127.0.0.1:8000
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: dusk_testing
          DB_USERNAME: root
          DB_PASSWORD: root
        run: php artisan dusk --verbose

      - name: Upload Screenshots on Failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: dusk-screenshots
          path: tests/Browser/screenshots
          retention-days: 7

      - name: Upload Console Logs on Failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: dusk-console-logs
          path: tests/Browser/console
          retention-days: 7
```

### 3.2 CI 专用 .env 文件

创建 `.env.dusk.ci`，与本地 `.env.dusk` 分离：

```env
APP_NAME="Dusk CI"
APP_ENV=dusk
APP_KEY=
APP_DEBUG=true
APP_URL=http://127.0.0.1:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=dusk_testing
DB_USERNAME=root
DB_PASSWORD=root

CACHE_DRIVER=array
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120

MAIL_DRIVER=log
```

### 3.3 DuskTestCase 配置

`tests/DuskTestCase.php` 中确保 Headless 模式正确配置：

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
     * 准备 ChromeDriver 能力
     */
    protected function driver(): RemoteWebDriver
    {
        $options = (new ChromeOptions())->addArguments(collect([
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--window-size=1920,1080',
        ])->all());

        return RemoteWebDriver::create(
            env('DUSK_DRIVER_URL', 'http://localhost:9515'),
            DesiredCapabilities::chrome()
                ->setCapability(ChromeOptions::CAPABILITY, $options)
                ->setCapability('acceptInsecureCerts', true)
        );
    }
}
```

关键参数说明：

| 参数 | 作用 |
|------|------|
| `--headless=new` | 使用新版 Headless 模式，行为更接近有头浏览器 |
| `--disable-dev-shm-usage` | 避免 `/dev/shm` 空间不足导致崩溃（CI 容器常见问题） |
| `--no-sandbox` | CI 环境需要，否则 Chrome 无法启动 |
| `--window-size=1920,1080` | 固定视口，确保截图一致性 |

## 四、动态等待策略：告别 sleep()

### 4.1 问题本质

CI 环境中最大的挑战是**时序不确定性**。本地开发机渲染一个页面可能只需 200ms，CI 机器可能需要 2s。硬编码 `sleep(3)` 要么太短导致测试失败，要么太长拖慢 CI 速度。

Dusk 提供了多种等待机制，关键是理解何时用哪种：

```php
// ❌ 硬编码等待——脆弱且浪费时间
$browser->pause(3000);

// ✅ 等待元素出现——基于条件
$browser->waitFor('.result-container', 10);

// ✅ 等待元素消失——用于加载状态
$browser->waitForLoadingToDisappear();

// ✅ 等待文本出现
$browser->waitForText('操作成功', 10);

// ✅ 等待 URL 变化——用于页面跳转
$browser->waitForLocation('/dashboard');

// ✅ 等待 Vue/React 组件渲染完成
$browser->waitFor('.v-loaded', 10);
```

### 4.2 封装通用等待 Trait

创建 `tests/Browser/Concerns/WaitsIntelligently.php`：

```php
<?php

namespace Tests\Browser\Concerns;

use Facebook\WebDriver\WebDriverExpectedCondition;
use Laravel\Dusk\Browser;

trait WaitsIntelligently
{
    /**
     * 等待页面完全加载（包括异步请求）
     */
    public function waitForPageLoad(Browser $browser, int $seconds = 15): void
    {
        // 1. 等待 DOM 就绪
        $browser->driver->wait($seconds, 1000)->until(
            WebDriverExpectedCondition::js(
                "return document.readyState === 'complete'"
            )
        );

        // 2. 等待所有 XHR 完成（需要前端配合设置标记）
        $browser->driver->wait($seconds, 500)->until(
            WebDriverExpectedCondition::js(
                "return window.__pendingRequests === 0 || typeof window.__pendingRequests === 'undefined'"
            )
        );
    }

    /**
     * 等待表单提交完成
     */
    public function waitForFormSubmission(Browser $browser, string $formSelector = 'form', int $seconds = 10): void
    {
        // 等待提交按钮变为禁用状态（表示正在提交）
        $browser->driver->wait(2, 200)->until(
            WebDriverExpectedCondition::js(
                "return document.querySelector('{$formSelector} [type=submit]')?.disabled === true"
            )
        );

        // 等待提交按钮恢复可用（表示提交完成）
        $browser->driver->wait($seconds, 500)->until(
            WebDriverExpectedCondition::js(
                "return document.querySelector('{$formSelector} [type=submit]')?.disabled === false"
            )
        );
    }

    /**
     * 等待 Spinner/Loading 消失
     */
    public function waitForLoadingToDisappear(Browser $browser, string $spinnerSelector = '.loading-spinner', int $seconds = 15): void
    {
        try {
            $browser->driver->wait(2, 200)->until(
                WebDriverExpectedCondition::visibilityOfElementLocated(
                    \Facebook\WebDriver\WebDriverBy::cssSelector($spinnerSelector)
                )
            );
        } catch (\Exception $e) {
            // Spinner 可能已经消失或从未出现，这是正常的
            return;
        }

        $browser->driver->wait($seconds, 500)->until(
            WebDriverExpectedCondition::invisibilityOfElementLocated(
                \Facebook\WebDriver\WebDriverBy::cssSelector($spinnerSelector)
            )
        );
    }

    /**
     * 等待 Toast 通知出现并包含指定文本
     */
    public function waitForToast(Browser $browser, string $message, int $seconds = 10): void
    {
        $browser->waitFor('.toast-container', $seconds);
        $browser->assertSeeIn('.toast-container', $message);
    }

    /**
     * 等待 DataTable 数据加载完成
     */
    public function waitForTableData(Browser $browser, string $tableSelector = 'table tbody', int $seconds = 15): void
    {
        $browser->driver->wait($seconds, 500)->until(
            WebDriverExpectedCondition::js(
                "return document.querySelector('{$tableSelector}')?.children.length > 0"
            )
        );

        // 等待 "加载中" 提示消失
        $browser->driver->wait($seconds, 300)->until(
            WebDriverExpectedCondition::js(
                "return !document.querySelector('.table-loading')"
            )
        );
    }
}
```

### 4.3 在测试中使用

```php
<?php

namespace Tests\Browser;

use Tests\DuskTestCase;
use Laravel\Dusk\Browser;
use Tests\Browser\Concerns\WaitsIntelligently;

class OrderFlowTest extends DuskTestCase
{
    use WaitsIntelligently;

    public function testCreateOrder(): void
    {
        $this->browse(function (Browser $browser) {
            $browser->visit('/orders/create')
                ->waitForPageLoad($browser);

            // 填写表单
            $browser->type('@customer-name', '张三')
                ->select('@product', 'product_001')
                ->type('@quantity', '5');

            // 提交并等待
            $browser->press('提交订单');
            $browser->waitForToast($browser, '订单创建成功');
            $browser->assertPathIs('/orders');
        });
    }
}
```

## 五、选择器治理：data-testid 规范

### 5.1 为什么 CSS 选择器在 CI 中不可靠

```php
// ❌ 依赖 CSS 类名——前端重构后立即失效
$browser->click('.btn-primary');
$browser->value('.form-control[name=email]', 'test@example.com');

// ❌ 依赖 DOM 结构——添加一个 div 就全部错位
$browser->click('.card:nth-child(2) .btn');

// ✅ 使用 data-testid——语义化、稳定
$browser->click('@submit-btn');
$browser->value('@email-input', 'test@example.com');
```

### 5.2 选择器规范文档

在团队中推行以下规范：

```html
<!-- 按钮类 -->
<button data-testid="submit-order-btn">提交订单</button>
<button data-testid="cancel-btn">取消</button>
<a data-testid="create-link" href="/create">新建</a>

<!-- 表单类 -->
<input data-testid="email-input" type="email" />
<select data-testid="product-select" />
<textarea data-testid="remark-textarea" />

<!-- 容器类 -->
<div data-testid="order-list-container">...</div>
<table data-testid="users-table">...</table>

<!-- 状态类 -->
<div data-testid="loading-spinner" class="spinner">...</div>
<div data-testid="error-message" class="error">...</div>
<div data-testid="success-toast">操作成功</div>

<!-- 数据行类（动态 ID）-->
<tr data-testid="order-row-{{ $order->id }}">...</tr>
```

### 5.3 Dusk 选择器自动解析

Dusk 默认支持 `@` 前缀自动解析 `data-testid`：

```php
// @submit-btn 自动解析为 [data-testid="submit-btn"]
$browser->click('@submit-btn');
$browser->type('@email-input', 'test@example.com');
$browser->select('@product-select', 'product_001');
$browser->check('@agree-checkbox');
```

如果项目中使用了自定义前缀，可以在 `DuskServiceProvider` 中配置：

```php
// app/Providers/DuskServiceProvider.php
use Laravel\Dusk\Dusk;

public function boot(): void
{
    Dusk::defaultSelector('data-testid');
}
```

### 5.4 选择器健康检查脚本

创建一个 Artisan 命令，定期检查前端组件是否缺少 `data-testid`：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Finder\Finder;

class DuskSelectorAudit extends Command
{
    protected $signature = 'dusk:selector-audit {--path=resources/views}';
    protected $description = '审计 Blade 模板中缺少 data-testid 的交互元素';

    // 需要 data-testid 的 HTML 标签
    private const INTERACTIVE_TAGS = [
        '<button', '<a ', '<input', '<select', '<textarea',
        '<form',
    ];

    public function handle(): int
    {
        $path = $this->option('path');
        $issues = [];

        $finder = (new Finder())->in($path)->name('*.blade.php');

        foreach ($finder as $file) {
            $content = $file->getContents();
            $lines = explode("\n", $content);

            foreach ($lines as $lineNum => $line) {
                foreach (self::INTERACTIVE_TAGS as $tag) {
                    if (str_contains($line, $tag) && !str_contains($line, 'data-testid')) {
                        $issues[] = [
                            $file->getRelativePathname(),
                            $lineNum + 1,
                            trim($tag, '<'),
                            trim(substr($line, 0, 80)),
                        ];
                    }
                }
            }
        }

        if (empty($issues)) {
            $this->info('✅ 所有交互元素都已包含 data-testid');
            return self::SUCCESS;
        }

        $this->warn("⚠️  发现 " . count($issues) . " 个缺少 data-testid 的元素：");
        $this->table(
            ['文件', '行号', '标签', '代码片段'],
            $issues
        );

        return self::FAILURE;
    }
}
```

运行方式：

```bash
php artisan dusk:selector-audit --path=resources/views
```

在 CI 中加入审计步骤：

```yaml
      - name: Audit Selectors
        run: php artisan dusk:selector-audit --path=resources/views
```

## 六、视觉回归测试（Visual Regression）

### 6.1 核心原理

视觉回归测试通过对比两次运行的截图像素差异，自动检测 UI 变更。流程：

1. **基准截图（Baseline）**：首次运行时生成，作为参考标准
2. **对比截图（Comparison）**：每次 CI 运行时生成
3. **差异检测（Diff）**：计算两张截图的像素差异
4. **阈值判断**：差异超过阈值则判定为回归

### 6.2 使用 Dusk 内置截图

```php
// 在测试中截图
$browser->screenshot('order-list-page');

// 全页面截图（包括滚动区域）
$browser->fullPageScreenshot('order-list-full');
```

### 6.3 集成 BackstopJS 进行视觉回归

创建 `backstop.json` 配置：

```json
{
  "id": "dusk_visual_regression",
  "viewports": [
    { "label": "desktop", "width": 1920, "height": 1080 },
    { "label": "tablet", "width": 768, "height": 1024 },
    { "label": "mobile", "width": 375, "height": 812 }
  ],
  "onBeforeScript": "puppet/onBefore.js",
  "onReadyScript": "puppet/onReady.js",
  "scenarios": [
    {
      "label": "Dashboard",
      "url": "http://127.0.0.1:8000/dashboard",
      "selectors": ["document"],
      "misMatchThreshold": 0.1,
      "requireSameDimensions": true
    },
    {
      "label": "Order List",
      "url": "http://127.0.0.1:8000/orders",
      "selectors": [".order-table-container"],
      "misMatchThreshold": 0.5
    },
    {
      "label": "Login Page",
      "url": "http://127.0.0.1:8000/login",
      "selectors": ["form"],
      "misMatchThreshold": 0.1
    }
  ],
  "paths": {
    "bitmaps_reference": "backstop_data/bitmaps_reference",
    "bitmaps_test": "backstop_data/bitmaps_test",
    "engine_scripts": "backstop_data/engine_scripts",
    "html_report": "backstop_data/html_report",
    "ci_report": "backstop_data/ci_report"
  },
  "report": ["browser", "CI"],
  "engine": "puppeteer",
  "engineOptions": {
    "args": ["--no-sandbox", "--disable-setuid-sandbox"]
  },
  "asyncCaptureLimit": 5,
  "asyncCompareLimit": 50
}
```

### 6.4 CI 中的视觉回归工作流

```yaml
  visual-regression:
    runs-on: ubuntu-latest
    needs: dusk-tests  # 依赖 Dusk 测试通过

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Dependencies
        run: |
          composer install --no-progress
          npm ci
          npx backstop install --docker

      - name: Setup & Start App
        run: |
          cp .env.dusk.ci .env
          php artisan key:generate
          php artisan migrate --force
          php artisan serve --port=8000 &
          sleep 3

      - name: Download Baseline
        uses: actions/download-artifact@v4
        with:
          name: visual-baseline
          path: backstop_data/bitmaps_reference
        continue-on-error: true  # 首次运行没有基准

      - name: Run Backstop Test
        id: backstop
        run: npx backstop test --docker || true

      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: visual-regression-report
          path: backstop_data/html_report
          retention-days: 7

      - name: Update Baseline (main only)
        if: github.ref == 'refs/heads/main' && failure()
        run: npx backstop approve --docker

      - name: Upload New Baseline
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: visual-baseline
          path: backstop_data/bitmaps_reference
          retention-days: 90
```

### 6.5 忽略动态内容区域

某些区域（时间戳、随机数据、广告）每次运行都不同，需要排除：

```json
{
  "scenarios": [
    {
      "label": "Dashboard",
      "url": "http://127.0.0.1:8000/dashboard",
      "selectors": ["document"],
      "hideSelectors": [
        ".current-time",
        ".random-banner",
        "[data-testid='live-counter']"
      ],
      "misMatchThreshold": 0.1
    }
  ]
}
```

## 七、常见踩坑与解决方案

### 7.1 Chrome 在 CI 中启动失败

**症状**：`UnknownError: unknown error: Chrome failed to start`

**解决方案**：

```bash
# 确保安装了所有依赖
sudo apt-get install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2

# 或者使用 --disable-gpu 和 --no-sandbox
```

### 7.2 `/dev/shm` 空间不足

**症状**：`session not created: Chrome crashed due to /dev/shm being too small`

**解决方案**：

```yaml
# 在 GitHub Actions 中
- name: Increase /dev/shm
  run: sudo mount -o remount,size=2G /dev/shm

# 或者在 Docker 中使用
# docker run --shm-size=2g
```

### 7.3 数据库状态污染

**症状**：测试间数据互相干扰，第一个测试通过，后续测试失败

**解决方案**：

```php
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\DatabaseTruncation;

class OrderTest extends DuskTestCase
{
    // 每个测试前重置数据库
    use DatabaseMigrations;

    // 或者使用 Truncation（更快）
    // use DatabaseTruncation;

    public function setUp(): void
    {
        parent::setUp();
        $this->artisan('migrate:fresh --seed');
    }
}
```

### 7.4 异步操作超时

**症状**：`Waited 10 seconds for selector .result but it never appeared`

**解决方案**：

```php
// 增加超时时间（CI 环境建议 15-20 秒）
$browser->waitFor('.result', 20);

// 使用重试机制
$browser->waitFor('.result', 20)
    ->whenMissing('.result', function ($browser) {
        // 重试一次页面加载
        $browser->refresh()
            ->waitFor('.result', 20);
    });
```

### 7.5 截图不一致（字体渲染差异）

**症状**：同一页面在 CI 和本地的截图像素差异很大

**解决方案**：

```yaml
# 安装字体
- name: Install Fonts
  run: |
    sudo apt-get install -y fonts-noto-cjk
    sudo fc-cache -fv
```

```css
/* 在 CSS 中指定字体栈 */
body {
  font-family: 'Noto Sans CJK SC', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

## 八、高级技巧

### 8.1 并行测试提速

使用 `paratest` 并行运行 Dusk 测试：

```bash
# 安装
composer require --dev brianium/paratest

# 并行运行（4 个进程）
vendor/bin/paratest --testsuite Browser --processes 4
```

Dusk 测试需要独立的数据库，使用动态数据库名：

```php
// tests/DuskTestCase.php
protected function setUp(): void
{
    parent::setUp();
    $db = 'dusk_test_' . getmypid();
    DB::statement("CREATE DATABASE IF NOT EXISTS {$db}");
    config(['database.connections.mysql.database' => $db]);
    $this->artisan('migrate', ['--database' => 'mysql']);
}
```

### 8.2 测试数据工厂

```php
<?php

namespace Tests\Browser\Factories;

use App\Models\Order;
use App\Models\User;

class DuskDataFactory
{
    public static function createTestUser(): User
    {
        return User::factory()->create([
            'email' => 'dusk-' . uniqid() . '@test.com',
            'name' => 'Dusk测试用户',
        ]);
    }

    public static function createTestOrder(User $user): Order
    {
        return Order::factory()->create([
            'user_id' => $user->id,
            'status' => 'pending',
            'order_no' => 'DUSK-' . strtoupper(uniqid()),
        ]);
    }

    /**
     * 创建完整的测试场景数据
     */
    public static function createOrderScenario(): array
    {
        $user = self::createTestUser();
        $orders = Order::factory()
            ->count(5)
            ->create(['user_id' => $user->id]);

        return compact('user', 'orders');
    }
}
```

### 8.3 CI 测试报告集成

```yaml
      - name: Generate JUnit Report
        if: always()
        run: php artisan dusk --log-junit=results/junit.xml

      - name: Publish Test Results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: results/junit.xml
          check_name: Dusk E2E Tests
```

## 九、性能优化

### 9.1 Chrome 启动参数优化

```php
$options = (new ChromeOptions())->addArguments([
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-extensions-with-background-pages',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-renderer-backgrounding',
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--mute-audio',
    '--window-size=1920,1080',
]);
```

### 9.2 缓存 Composer 和 Node 依赖

```yaml
      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ hashFiles('composer.lock') }}

      - name: Cache Node Modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: node-${{ hashFiles('package-lock.json') }}
```

## 十、总结

### 选型建议

| 场景 | 方案 | 复杂度 |
|------|------|--------|
| 基础 E2E 测试 | Dusk + GitHub Actions | ⭐⭐ |
| + 动态等待 | Dusk + WaitsIntelligently | ⭐⭐⭐ |
| + 选择器治理 | data-testid 规范 + 审计脚本 | ⭐⭐⭐ |
| + 视觉回归 | Dusk + BackstopJS | ⭐⭐⭐⭐ |
| + 并行测试 | Dusk + paratest + 动态数据库 | ⭐⭐⭐⭐⭐ |

### 落地清单

1. **第一步**：在 CI 中跑通基础 Dusk 测试（1-2 天）
2. **第二步**：推行 `data-testid` 规范，逐步替换现有选择器（1-2 周）
3. **第三步**：引入视觉回归测试，保护关键页面（1 周）
4. **第四步**：优化 CI 性能，并行化 + 缓存（持续迭代）

### 核心原则

- **等待基于条件，不基于时间**：永远用 `waitFor` 替代 `sleep`
- **选择器基于语义，不基于样式**：`data-testid` 是唯一可靠的选择器
- **截图基于阈值，不基于精确匹配**：允许合理的渲染差异
- **测试基于隔离，不基于共享**：每个测试独立的数据库状态

E2E 测试的价值不在于"通过率 100%"，而在于**当 UI 出现非预期变更时，CI 能在合并前拦住它**。与其追求完美的测试覆盖率，不如把精力放在保护核心业务流程上。
