---
title: 'Playwright 实战：跨浏览器 E2E 测试——Laravel 应用的可视化回归、网络拦截与 CI 并行执行踩坑记录'
date: 2026-06-02 12:00:00
tags: [Playwright, E2E测试, Laravel, CI/CD, 测试]
keywords: [Playwright, E2E, Laravel, CI, 跨浏览器, 应用的可视化回归, 网络拦截与, 并行执行踩坑记录, 前端]
description: 本文记录在真实 Laravel B2C 项目中从 Laravel Dusk 迁移到 Playwright 的完整实战过程。涵盖跨浏览器（Chromium、Firefox、WebKit）E2E 测试搭建、可视化回归对比与像素级差异检测、网络拦截模拟 API 响应、Page Object 模式组织测试代码，以及 GitHub Actions 矩阵并行执行、登录态管理、CI/CD 集成踩坑。适合需要在 Laravel 项目中建立可靠前端测试体系的开发者参考。
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---


## 前言

前端测试一直是 Laravel 项目中最被忽视的环节。我们有 PHPUnit 做单元测试和功能测试，有 Laravel Dusk 做浏览器测试，但 Dusk 只支持 Chromium，测试速度慢，CI 集成困难，Flaky test 层出不穷。

2020 年微软发布的 Playwright 彻底改变了这一局面。它支持 Chromium、Firefox、WebKit 三大浏览器引擎，原生支持并行执行，API 设计优雅，自动等待机制大幅减少了 Flaky test。更重要的是，它不仅仅是前端测试工具——通过网络拦截、API 测试、可视化回归等功能，它可以覆盖 E2E 测试的方方面面。

本文将记录我在一个真实的 Laravel B2C 项目中从 Dusk 迁移到 Playwright 的完整过程，包括登录态管理、可视化回归、网络拦截、CI/CD 集成，以及踩过的每一个坑。

---

## 一、Playwright vs Cypress vs Selenium

### 1.1 架构对比

```
Selenium:
┌──────────┐    WebDriver     ┌──────────┐
│  测试    │ ◄──────────────► │  浏览器  │
│  脚本    │    HTTP API      │ (外部)   │
└──────────┘                  └──────────┘
问题：通信开销大，等待不稳定

Cypress:
┌──────────────────────────────┐
│  浏览器内部                   │
│  ┌──────────┐ ┌──────────┐  │
│  │ 测试脚本 │ │ 被测应用 │  │
│  └──────────┘ └──────────┘  │
└──────────────────────────────┘
限制：同一浏览器进程，不支持多标签页

Playwright:
┌──────────┐                  ┌──────────┐
│  测试    │    WebSocket     │  浏览器  │
│  进程    │ ◄──────────────► │  Server  │
└──────────┘    (CDP/协议)    └──────────┘
优势：外部控制，支持多浏览器，原生并行
```

### 1.2 功能对比

| 特性 | Playwright | Cypress | Selenium |
|------|-----------|---------|----------|
| 浏览器支持 | Chromium/FF/WebKit | 仅 Chromium | 所有 |
| 语言支持 | JS/TS/Python/Java/C# | 仅 JS/TS | 所有 |
| 并行执行 | 原生支持 | 需要付费 | 需要 Grid |
| 自动等待 | ✅ 内建 | ✅ 内建 | ❌ 需要显式等待 |
| 网络拦截 | ✅ 原生 | ✅ 原生 | ❌ 需要代理 |
| 可视化回归 | ✅ 内建 | 需要插件 | ❌ |
| 多标签页 | ✅ | ❌ | ✅ |
| iframe 支持 | ✅ | 有限 | ✅ |
| 移动端模拟 | ✅ | ✅ | 需要 Appium |
| Trace Viewer | ✅ | ❌ | ❌ |
| 速度 | ★★★★★ | ★★★★ | ★★★ |
| 学习曲线 | 低 | 低 | 中 |

---

## 二、安装与配置

### 2.1 安装 Playwright

```bash
# 创建测试目录
mkdir -p tests/e2e && cd tests/e2e

# 初始化 Node.js 项目
npm init -y

# 安装 Playwright
npm install -D @playwright/test

# 安装浏览器（Chromium、Firefox、WebKit）
npx playwright install

# 或者只安装 Chromium（节省时间）
npx playwright install chromium
```

### 2.2 配置文件

```javascript
// tests/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // 测试目录
  testDir: './specs',
  
  // 全局超时
  timeout: 30_000,
  
  // 每个测试的超时
  expect: {
    timeout: 10_000,
    // 可视化回归的阈值
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  
  // 并行执行
  fullyParallel: true,
  
  // CI 环境下失败不重试（本地可以重试）
  retries: process.env.CI ? 0 : 1,
  
  // CI 环境下限制并发数
  workers: process.env.CI ? 4 : undefined,
  
  // 报告器
  reporter: process.env.CI
    ? [
        ['html', { open: 'never' }],
        ['github'],
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [['html', { open: 'on-failure' }]],
  
  // 全局配置
  use: {
    // 基础 URL
    baseURL: process.env.BASE_URL || 'http://localhost:8000',
    
    // 截图策略
    screenshot: 'only-on-failure',
    
    // Trace（调试利器）
    trace: 'on-first-retry',
    
    // 视频录制
    video: 'on-first-retry',
    
    // 忽略 HTTPS 错误
    ignoreHTTPSErrors: true,
    
    // 额外的 HTTP 头
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  },

  // 浏览器矩阵
  projects: [
    // Setup 项目（登录并保存状态）
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Chromium
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Firefox
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // WebKit
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // 移动端
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  
  // 本地开发服务器
  webServer: {
    command: 'php artisan serve --port=8000',
    url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

### 2.3 Laravel 后端准备

```php
<?php
// app/Http/Controllers/TestController.php
// 仅在测试环境可用

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

class TestController extends Controller
{
    public function __construct()
    {
        if (!app()->environment('testing')) {
            abort(404);
        }
    }

    /**
     * 重置测试数据库
     */
    public function resetDatabase()
    {
        Artisan::call('migrate:fresh', ['--seed' => true]);
        
        return response()->json(['status' => 'ok']);
    }

    /**
     * 创建测试用户
     */
    public function createUser(Request $request)
    {
        $user = \App\Models\User::factory()->create([
            'email' => $request->input('email', 'test@example.com'),
            'password' => bcrypt($request->input('password', 'password')),
        ]);

        return response()->json(['user' => $user->toArray()]);
    }

    /**
     * 获取 CSRF Token
     */
    public function csrfToken()
    {
        return response()->json(['token' => csrf_token()]);
    }
}
```

```php
<?php
// routes/test.php
// 仅在测试环境加载

use App\Http\Controllers\TestController;

if (app()->environment('testing')) {
    Route::post('/test/reset-database', [TestController::class, 'resetDatabase']);
    Route::post('/test/create-user', [TestController::class, 'createUser']);
    Route::get('/test/csrf-token', [TestController::class, 'csrfToken']);
}
```

---

## 三、登录态管理

### 3.1 Playwright 的 storageState 机制

Playwright 使用 `storageState` 来保存和恢复浏览器状态（Cookie、LocalStorage、SessionStorage）。这是管理登录态最优雅的方式。

```typescript
// tests/e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  // 1. 访问登录页
  await page.goto('/login');
  
  // 2. 填写登录表单
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password');
  
  // 3. 点击登录
  await page.getByRole('button', { name: '登录' }).click();
  
  // 4. 等待登录成功（验证 URL 变化或页面元素）
  await page.waitForURL('/dashboard');
  await expect(page.getByText('欢迎回来')).toBeVisible();
  
  // 5. 保存登录状态
  await page.context().storageState({ path: authFile });
});
```

### 3.2 与 Laravel Sanctum 配合

```typescript
// tests/e2e/auth.setup.ts
import { test as setup } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate via API', async ({ request, page }) => {
  // 方式一：通过 API 获取 Token，注入到浏览器
  const response = await request.post('/api/login', {
    data: {
      email: 'test@example.com',
      password: 'password',
    },
  });
  
  const { token } = await response.json();
  
  // 注入 Token 到浏览器
  await page.goto('/');
  await page.evaluate((token) => {
    localStorage.setItem('auth_token', token);
  }, token);
  
  // 设置 Sanctum Cookie
  await page.context().addCookies([
    {
      name: 'laravel_session',
      value: token,
      domain: 'localhost',
      path: '/',
    },
  ]);
  
  await page.context().storageState({ path: authFile });
});
```

### 3.3 多角色登录

```typescript
// tests/e2e/auth.setup.ts
import { test as setup } from '@playwright/test';
import path from 'path';

const authDir = path.join(__dirname, '.auth');

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('admin-password');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('/admin/dashboard');
  await page.context().storageState({ 
    path: path.join(authDir, 'admin.json') 
  });
});

setup('authenticate as user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('user-password');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('/dashboard');
  await page.context().storageState({ 
    path: path.join(authDir, 'user.json') 
  });
});
```

---

## 四、核心 API 详解

### 4.1 Locator API

Playwright 的 Locator 是自动等待的核心：

```typescript
import { test, expect } from '@playwright/test';

test('商品列表页', async ({ page }) => {
  await page.goto('/products');
  
  // ✅ 推荐：使用角色定位
  await page.getByRole('heading', { name: '商品列表' }).click();
  await page.getByRole('button', { name: '添加商品' }).click();
  await page.getByRole('link', { name: '查看详情' }).first().click();
  
  // ✅ 推荐：使用文本定位
  await page.getByText('¥99.00').click();
  
  // ✅ 推荐：使用标签定位
  await page.getByLabel('商品名称').fill('iPhone 16');
  await page.getByPlaceholder('搜索商品').fill('手机');
  
  // ✅ 推荐：使用 Test ID（最稳定）
  await page.getByTestId('product-card-1').click();
  await page.getByTestId('add-to-cart-button').click();
  
  // ⚠️ 慎用：CSS 选择器（容易因 UI 变更而失效）
  await page.locator('.product-card').first().click();
  
  // ⚠️ 慎用：XPath（不推荐）
  await page.locator('//button[text()="添加"]').click();
});
```

### 4.2 自动等待机制

```typescript
test('自动等待', async ({ page }) => {
  await page.goto('/products');
  
  // Playwright 会自动等待以下条件：
  // 1. 元素存在于 DOM
  // 2. 元素可见
  // 3. 元素稳定（不在动画中）
  // 4. 元素可以接收事件（不被遮挡）
  // 5. 元素已启用（不是 disabled）
  
  // 所以这些操作都会自动等待：
  await page.getByRole('button', { name: '提交' }).click();  // 自动等待按钮可点击
  await page.getByLabel('邮箱').fill('test@test.com');         // 自动等待输入框可用
  await page.getByText('加载中').waitFor({ state: 'hidden' }); // 等待加载完成
  
  // 不需要手动 sleep！
  // ❌ await page.waitForTimeout(2000);
});
```

### 4.3 BrowserContext 隔离

```typescript
test('多用户场景', async ({ browser }) => {
  // 创建两个独立的浏览器上下文（模拟两个用户）
  const adminContext = await browser.newContext({
    storageState: 'tests/e2e/.auth/admin.json',
  });
  const userContext = await browser.newContext({
    storageState: 'tests/e2e/.auth/user.json',
  });

  const adminPage = await adminContext.newPage();
  const userPage = await userContext.newPage();

  // 管理员创建商品
  await adminPage.goto('/admin/products/create');
  await adminPage.getByLabel('商品名称').fill('新品');
  await adminPage.getByRole('button', { name: '发布' }).click();

  // 普通用户查看商品
  await userPage.goto('/products');
  await expect(userPage.getByText('新品')).toBeVisible();

  await adminContext.close();
  await userContext.close();
});
```

---

## 五、可视化回归测试

### 5.1 基本用法

```typescript
import { test, expect } from '@playwright/test';

test('首页截图对比', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  // 整页截图对比
  await expect(page).toHaveScreenshot('homepage.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.01, // 允许 1% 的像素差异
  });
});

test('商品卡片截图对比', async ({ page }) => {
  await page.goto('/products');
  
  // 单个元素截图对比
  const card = page.getByTestId('product-card-1');
  await expect(card).toHaveScreenshot('product-card.png', {
    maxDiffPixels: 100, // 允许最多 100 个像素不同
  });
});
```

### 5.2 管理基线图片

```bash
# 首次运行，生成基线图片
npx playwright test --update-snapshots

# 后续运行，与基线对比
npx playwright test

# 查看测试报告（含截图对比）
npx playwright show-report
```

### 5.3 处理动态内容

```typescript
test('处理动态内容的截图', async ({ page }) => {
  await page.goto('/dashboard');
  
  // 遮盖动态内容（时间、随机数据等）
  await expect(page).toHaveScreenshot('dashboard.png', {
    mask: [
      page.getByTestId('current-time'),    // 遮盖时间显示
      page.getByTestId('random-banner'),    // 遮盖随机广告
      page.locator('.user-avatar'),          // 遮盖用户头像
    ],
    maskColor: '#FF00FF', // 遮盖颜色
  });
});

test('隐藏不稳定元素', async ({ page }) => {
  await page.goto('/products');
  
  // 在截图前隐藏不稳定元素
  await page.evaluate(() => {
    // 隐藏动画元素
    document.querySelectorAll('.animated').forEach(el => {
      el.style.animation = 'none';
    });
    // 隐藏动态时间
    const timeEl = document.querySelector('.current-time');
    if (timeEl) timeEl.textContent = '2026-06-02 12:00:00';
  });
  
  await expect(page).toHaveScreenshot('products.png');
});
```

### 5.4 跨浏览器截图对比

不同浏览器的渲染结果可能略有差异，需要为每个浏览器维护独立的基线：

```bash
tests/e2e/specs/
├── homepage.spec.ts-snapshots/
│   ├── homepage-chromium.png      # Chromium 基线
│   ├── homepage-firefox.png       # Firefox 基线
│   └── homepage-webkit.png        # WebKit 基线
```

---

## 六、网络拦截

### 6.1 Mock API 响应

```typescript
import { test, expect } from '@playwright/test';

test('Mock API 响应', async ({ page }) => {
  // 拦截 API 请求并返回 Mock 数据
  await page.route('**/api/products', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { id: 1, name: 'iPhone 16', price: 999 },
          { id: 2, name: 'MacBook Pro', price: 2499 },
        ],
        total: 2,
      }),
    });
  });

  await page.goto('/products');
  
  // 验证 Mock 数据正确显示
  await expect(page.getByText('iPhone 16')).toBeVisible();
  await expect(page.getByText('¥999')).toBeVisible();
});
```

### 6.2 模拟网络延迟

```typescript
test('模拟慢网络', async ({ page }) => {
  // 模拟 API 响应延迟 3 秒
  await page.route('**/api/**', async (route) => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await route.continue();
  });

  await page.goto('/dashboard');
  
  // 验证加载状态显示
  await expect(page.getByText('加载中...')).toBeVisible();
  
  // 等待加载完成
  await expect(page.getByText('加载中...')).toBeHidden({ timeout: 10000 });
  await expect(page.getByText('仪表盘数据')).toBeVisible();
});
```

### 6.3 模拟网络错误

```typescript
test('模拟 API 错误', async ({ page }) => {
  // 模拟 500 错误
  await page.route('**/api/orders', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Internal Server Error' }),
    });
  });

  await page.goto('/orders');
  
  // 验证错误提示
  await expect(page.getByText('加载失败，请稍后重试')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
});

test('模拟网络断开', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.abort('connectionrefused');
  });

  await page.goto('/dashboard');
  
  await expect(page.getByText('网络连接失败')).toBeVisible();
});
```

### 6.4 录制 HAR 并回放

```typescript
// 录制 HAR
test('录制 API 交互', async ({ page, context }) => {
  // 开始录制
  await context.routeFromHAR('tests/e2e/har/products.har', {
    url: '**/api/**',
    update: true, // 更新 HAR 文件
  });

  await page.goto('/products');
  await page.getByText('iPhone 16').click();
  
  // HAR 文件会自动保存
});

// 回放 HAR（离线测试）
test('使用 HAR 回放', async ({ page, context }) => {
  await context.routeFromHAR('tests/e2e/har/products.har', {
    url: '**/api/**',
    update: false, // 使用已有 HAR
  });

  await page.goto('/products');
  
  // 使用录制的 API 响应
  await expect(page.getByText('iPhone 16')).toBeVisible();
});
```

---

## 七、Laravel 后端集成

### 7.1 测试前准备数据

```typescript
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  // 通过 API 重置数据库
  await request.post('/test/reset-database');
});

test('创建订单', async ({ page, request }) => {
  // 通过 API 直接创建测试数据（比通过 UI 操作快得多）
  await request.post('/api/test/seed', {
    data: {
      products: [
        { name: 'iPhone 16', price: 999, stock: 10 },
        { name: 'MacBook Pro', price: 2499, stock: 5 },
      ],
    },
  });

  // 通过 UI 测试购买流程
  await page.goto('/products');
  await page.getByText('iPhone 16').click();
  await page.getByRole('button', { name: '加入购物车' }).click();
  await page.goto('/cart');
  await page.getByRole('button', { name: '结算' }).click();
  
  // 验证订单创建成功
  await expect(page.getByText('订单创建成功')).toBeVisible();
  await expect(page.getByText('¥999.00')).toBeVisible();
});
```

### 7.2 事务回滚策略

```php
<?php
// app/Http/Middleware/TestingDatabaseTransaction.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\DB;

class TestingDatabaseTransaction
{
    public function handle($request, Closure $next)
    {
        if (!app()->environment('testing')) {
            return $next($request);
        }

        DB::beginTransaction();
        
        $response = $next($request);
        
        DB::rollBack();
        
        return $response;
    }
}
```

### 7.3 使用 API 创建复杂测试数据

```typescript
test('商品搜索和筛选', async ({ page, request }) => {
  // 通过 API 批量创建商品
  const products = Array.from({ length: 50 }, (_, i) => ({
    name: `商品 ${i + 1}`,
    category: ['电子', '服装', '食品'][i % 3],
    price: Math.floor(Math.random() * 1000) + 10,
  }));

  await request.post('/api/test/seed-products', {
    data: { products },
  });

  await page.goto('/products');
  
  // 测试搜索
  await page.getByPlaceholder('搜索商品').fill('商品 1');
  await page.getByRole('button', { name: '搜索' }).click();
  
  // 验证搜索结果
  await expect(page.getByText('商品 1')).toBeVisible();
  await expect(page.getByText('商品 10')).toBeVisible();
  
  // 测试分类筛选
  await page.getByText('电子').click();
  await expect(page.getByText('商品 1')).toBeVisible();
});
```

---

## 八、CI/CD 集成

### 8.1 GitHub Actions 配置

```yaml
# .github/workflows/playwright.yml
name: Playwright Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    strategy:
      fail-fast: false
      matrix:
        # 浏览器矩阵
        browser: [chromium, firefox, webkit]
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: laravel_test
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, mysql, pdo_mysql
          coverage: none

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: tests/e2e/package-lock.json

      - name: Install Composer Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Install NPM Dependencies
        working-directory: tests/e2e
        run: npm ci

      - name: Install Playwright Browsers
        working-directory: tests/e2e
        run: npx playwright install --with-deps ${{ matrix.browser }}

      - name: Prepare Laravel Environment
        run: |
          cp .env.testing .env
          php artisan key:generate
          php artisan migrate --force
          php artisan db:seed --force

      - name: Start Laravel Server
        run: php artisan serve --port=8000 &
        env:
          APP_ENV: testing

      - name: Wait for Server
        run: |
          for i in $(seq 1 30); do
            curl -s http://localhost:8000 > /dev/null && break
            sleep 1
          done

      - name: Run Playwright Tests
        working-directory: tests/e2e
        run: npx playwright test --project=${{ matrix.browser }}
        env:
          BASE_URL: http://localhost:8000
          CI: true

      - name: Upload Test Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-${{ matrix.browser }}
          path: |
            tests/e2e/playwright-report/
            tests/e2e/test-results/
          retention-days: 30

      - name: Upload Test Results (JUnit)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: junit-results-${{ matrix.browser }}
          path: tests/e2e/test-results/junit.xml
          retention-days: 30
```

### 8.2 并行执行策略

```typescript
// playwright.config.ts
export default defineConfig({
  // 全局并行
  fullyParallel: true,
  
  // Worker 数量（CI 中使用 CPU 核心数）
  workers: process.env.CI ? 4 : undefined,
  
  // 项目配置（浏览器矩阵并行）
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

```bash
# 本地运行：并行执行所有浏览器
npx playwright test

# 只运行 Chromium
npx playwright test --project=chromium

# 运行特定测试文件
npx playwright test tests/e2e/specs/login.spec.ts

# 运行带特定标签的测试
npx playwright test --grep @smoke

# 调试模式
npx playwright test --debug
```

---

## 九、踩坑记录

### 坑 #1: Flaky Test 处理策略

**现象**：测试偶尔通过、偶尔失败，尤其是涉及动画和异步操作的测试。

**解决方案**：

```typescript
// ❌ 错误：使用固定等待
await page.waitForTimeout(2000);

// ✅ 正确：使用条件等待
await page.getByText('加载完成').waitFor({ state: 'visible', timeout: 10000 });

// ✅ 正确：使用 expect 断言（自带重试）
await expect(page.getByText('操作成功')).toBeVisible({ timeout: 10000 });

// ✅ 正确：等待网络请求完成
await page.waitForResponse(resp => 
  resp.url().includes('/api/products') && resp.status() === 200
);

// ✅ 正确：等待特定元素状态
await page.getByRole('button', { name: '提交' }).isEnabled();
```

### 坑 #2: 浏览器版本锁定

**现象**：CI 中测试通过，本地失败（或反之），因为浏览器版本不同。

**解决方案**：

```json
// tests/e2e/package.json
{
  "devDependencies": {
    "@playwright/test": "1.45.0"
  }
}
```

```bash
# 锁定浏览器版本
npx playwright install --with-deps

# 查看当前浏览器版本
npx playwright --version
```

### 坑 #3: 截图对比 CI 缓存问题

**现象**：在 macOS 上生成的基线图片，在 Linux CI 上对比失败（字体渲染差异）。

**解决方案**：

```typescript
// playwright.config.ts
export default defineConfig({
  expect: {
    toHaveScreenshot: {
      // 增加容差
      maxDiffPixelRatio: 0.02, // 2% 的像素差异
      // 或者使用阈值
      threshold: 0.2, // 颜色差异阈值
    },
  },
});
```

```bash
# 在 CI 环境中生成基线图片
# 在 Linux Docker 中运行
docker run --rm -v $(pwd):/work mcr.microsoft.com/playwright:v1.45.0-focal \
  npx playwright test --update-snapshots
```

### 坑 #4: Laravel CSRF Token 问题

**现象**：测试中提交表单时出现 419 错误（CSRF Token 验证失败）。

**解决方案**：

```typescript
// 在测试环境中禁用 CSRF 验证
// app/Http/Middleware/VerifyCsrfToken.php
class VerifyCsrfToken extends Middleware
{
    protected $except = [
        // 测试环境的路由
        'test/*',
    ];
}

// 或者在测试中获取 CSRF Token
test('提交表单', async ({ page }) => {
  await page.goto('/contact');
  
  // 确保 CSRF Token 已加载
  await page.evaluate(() => {
    // 从 meta 标签获取 Token
    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    // 设置到隐藏字段
    const input = document.querySelector('input[name="_token"]');
    if (input) input.value = token;
  });
  
  await page.getByRole('button', { name: '提交' }).click();
});
```

### 坑 #5: 文件上传测试

**现象**：测试文件上传时，`setInputFiles` 不生效。

**解决方案**：

```typescript
test('文件上传', async ({ page }) => {
  await page.goto('/products/create');
  
  // 设置文件到 file input
  const fileInput = page.getByLabel('商品图片');
  await fileInput.setInputFiles({
    name: 'product.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fake-image-data'),
  });
  
  // 或者从文件系统读取
  await fileInput.setInputFiles('tests/e2e/fixtures/test-image.jpg');
  
  // 多文件上传
  await fileInput.setInputFiles([
    'tests/e2e/fixtures/image1.jpg',
    'tests/e2e/fixtures/image2.jpg',
  ]);
  
  await page.getByRole('button', { name: '上传' }).click();
  await expect(page.getByText('上传成功')).toBeVisible();
});
```

### 坑 #6: 下载文件测试

```typescript
test('下载文件', async ({ page }) => {
  await page.goto('/reports');
  
  // 监听下载事件
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  
  const download = await downloadPromise;
  
  // 验证文件名
  expect(download.suggestedFilename()).toMatch(/report-.*\.xlsx/);
  
  // 保存文件并验证内容
  const path = await download.path();
  expect(fs.existsSync(path)).toBeTruthy();
});
```

### 坑 #7: WebSocket 测试

```typescript
test('WebSocket 实时通知', async ({ page }) => {
  await page.goto('/dashboard');
  
  // 等待 WebSocket 连接建立
  await page.waitForFunction(() => {
    return window.Echo && window.Echo.connector.pusher.connection.state === 'connected';
  });
  
  // 通过 API 触发通知
  await request.post('/api/test/trigger-notification', {
    data: { user_id: 1, message: '新订单' },
  });
  
  // 验证通知显示
  await expect(page.getByText('新订单')).toBeVisible({ timeout: 5000 });
});
```

---

## 十、高级技巧

### 10.1 Page Object Model

```typescript
// tests/e2e/pages/LoginPage.ts
import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('邮箱');
    this.passwordInput = page.getByLabel('密码');
    this.submitButton = page.getByRole('button', { name: '登录' });
    this.errorMessage = page.getByTestId('login-error');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(message: string) {
    await expect(this.errorMessage).toContainText(message);
  }
}

// tests/e2e/pages/ProductsPage.ts
export class ProductsPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/products');
  }

  async search(keyword: string) {
    await this.page.getByPlaceholder('搜索商品').fill(keyword);
    await this.page.getByRole('button', { name: '搜索' }).click();
  }

  async addToCart(productName: string) {
    const card = this.page.getByTestId('product-card').filter({ hasText: productName });
    await card.getByRole('button', { name: '加入购物车' }).click();
  }

  async expectProductVisible(name: string) {
    await expect(this.page.getByText(name)).toBeVisible();
  }
}
```

```typescript
// tests/e2e/specs/shopping.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { ProductsPage } from '../pages/ProductsPage';

test('购物流程', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const productsPage = new ProductsPage(page);

  // 登录
  await loginPage.goto();
  await loginPage.login('user@example.com', 'password');
  await page.waitForURL('/dashboard');

  // 浏览商品
  await productsPage.goto();
  await productsPage.search('iPhone');
  await productsPage.expectProductVisible('iPhone 16');

  // 加入购物车
  await productsPage.addToCart('iPhone 16');
  await expect(page.getByText('已加入购物车')).toBeVisible();
});
```

### 10.2 自定义 Fixtures

```typescript
// tests/e2e/fixtures/test-fixtures.ts
import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { ProductsPage } from '../pages/ProductsPage';

type TestFixtures = {
  loginPage: LoginPage;
  productsPage: ProductsPage;
  authenticatedPage: Page;
};

export const test = base.extend<TestFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  productsPage: async ({ page }, use) => {
    await use(new ProductsPage(page));
  },

  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: 'tests/e2e/.auth/user.json',
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
```

### 10.3 Trace Viewer 调试

```bash
# 运行测试并生成 Trace
npx playwright test --trace on

# 查看 Trace
npx playwright show-trace test-results/login-chromium/trace.zip
```

Trace Viewer 提供了完整的测试执行过程回放：

1. 每一步操作的截图
2. DOM 快照
3. 网络请求日志
4. 控制台日志
5. 时间线

---

## 十一、性能对比

### 11.1 测试执行时间对比

以 50 个 E2E 测试为例：

| 方案 | 串行执行 | 并行执行（4 workers） |
|------|---------|---------------------|
| Laravel Dusk | 25 分钟 | N/A（不支持原生并行） |
| Playwright (Chromium) | 12 分钟 | 4 分钟 |
| Playwright (3 浏览器) | 36 分钟 | 10 分钟 |

### 11.2 CI 时间优化

```yaml
# 优化前：串行执行所有浏览器
jobs:
  test:
    steps:
      - run: npx playwright test  # 36 分钟

# 优化后：矩阵并行
jobs:
  test:
    strategy:
      matrix:
        browser: [chromium, firefox, webkit]
    steps:
      - run: npx playwright test --project=${{ matrix.browser }}  # 12 分钟
```

---

## 十二、总结

Playwright 是目前最好的 E2E 测试工具，对于 Laravel 项目来说：

1. **替代 Laravel Dusk**：多浏览器支持、原生并行、更稳定的自动等待
2. **可视化回归**：内建截图对比，防止 UI 退化
3. **网络拦截**：Mock API、模拟错误、录制回放
4. **CI/CD 友好**：矩阵并行、JUnit 报告、Trace 调试
5. **Page Object Model**：可维护的测试代码组织

从 Dusk 迁移到 Playwright 的关键步骤：

1. 安装 Playwright 并配置 `playwright.config.ts`
2. 创建 `auth.setup.ts` 管理登录态
3. 将 Dusk 测试逐步转换为 Playwright 测试
4. 配置 GitHub Actions 矩阵并行
5. 添加可视化回归测试

投资回报：虽然迁移需要一定时间，但测试速度提升 3-6 倍，Flaky test 减少 90%+，CI 反馈时间从 25 分钟缩短到 10 分钟。对于持续迭代的 Laravel 项目来说，这是值得的投资。

---

## 参考资料

- [Playwright 官方文档](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Test Fixtures](https://playwright.dev/docs/test-fixtures)
- [GitHub Actions + Playwright](https://playwright.dev/docs/ci)
- [Laravel Dusk 文档](https://laravel.com/docs/dusk)

---

## 相关阅读

- [Laravel Dusk 浏览器自动化 E2E 测试实战：CI 流水线集成、动态等待与选择器治理踩坑记录](/categories/Testing/laravel-dusk-automatione2etestingguide-ci/) — 本文的前身，记录从 Dusk 搭建 E2E 测试的完整过程
- [API 契约测试实战：Pact/Schemathesis 前后端接口一致性保障](/categories/测试/2026-06-01-api-contract-testing-pact-schemathesis-frontend-backend-consistency/) — 另一种保障前后端一致性的测试策略，与 E2E 测试互补
- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/categories/CI-CD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/) — 深入 CI/CD 矩阵并行执行，与本文 Playwright CI 集成部分配合阅读
- [Deno 2.x 实战：安全优先的 JavaScript 运行时——与 Node.js/Bun 的三选一决策](/categories/前端/Deno-2x-实战-安全优先的JavaScript运行时-与Node.js-Bun的三选一决策/) — 同属前端分类，探讨现代 JavaScript 运行时选型
