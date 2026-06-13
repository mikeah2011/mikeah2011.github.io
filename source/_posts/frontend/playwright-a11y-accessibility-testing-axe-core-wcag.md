---

title: Playwright a11y 实战：自动化无障碍测试——axe-core 集成、CI 门禁与 WCAG 2.2 合规检查
keywords: [Playwright a11y, axe, core, CI, WCAG, 自动化无障碍测试, 门禁与, 合规检查]
date: 2026-06-09 20:00:00
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Playwright
- a11y
- Accessibility
- axe-core
- WCAG
- 无障碍
- CI/CD
- 前端测试
categories:
- frontend
description: 用 Playwright + axe-core 实现端到端无障碍自动化测试，集成 CI 门禁确保 WCAG 2.2 合规，覆盖颜色对比度、键盘导航、ARIA 语义等核心检查项
---



无障碍（Accessibility，简称 a11y）不是可选项，而是法律合规的硬性要求。欧盟《欧洲无障碍法案》（EAA）2025 年 6 月已生效，美国 Section 508、ADA 诉讼每年增长 300%。手动审计 WCAG 2.2 标准耗时且易遗漏，自动化测试是唯一可持续的路径。

本文用 Playwright + axe-core 构建完整的无障碍自动化测试体系：从单页检测到全站爬取，从 CI 门禁到团队工作流，覆盖 PHP/Laravel 项目的前后端全链路。

## 为什么需要自动化无障碍测试

手动测试 a11y 的问题：

- **覆盖率低**：一个人一天最多手动审计 20-30 个页面
- **不可重复**：每次发版都需要重新审计
- **主观性强**：不同审计员判断标准不一致
- **回归无感知**：新代码破坏了之前的无障碍修复，直到用户投诉才发现

自动化测试解决的是**可重复、可集成、可回归**的问题。axe-core 能自动检测约 57% 的 WCAG 2.2 AA 级问题，剩下的需要人工辅助，但自动化把人工审计从"全面排查"变成了"定点验证"。

## 核心概念

### axe-core 检测原理

axe-core 是 Deque Labs 开发的开源无障碍检测引擎，被 Chrome DevTools、Firefox Accessibility Inspector 采用。它的工作流程：

1. **构建页面 DOM 的可访问性树**（Accessibility Tree）
2. **遍历所有节点**，检查 ARIA 属性、角色、状态
3. **执行规则引擎**：每条规则对应一个 WCAG 标准条款
4. **报告违规**：违规（violation）、警告（incomplete）、通过（pass）

关键数据结构：

```javascript
// axe-core 的返回结果
{
  violations: [
    {
      id: 'color-contrast',          // 规则 ID
      impact: 'serious',             // 影响等级
      description: '元素对比度不足',
      help: '确保前景色与背景色对比度至少 4.5:1',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.7/color-contrast',
      nodes: [
        {
          html: '<button style="color: #ccc; background: #fff">提交</button>',
          target: ['.submit-btn'],
          failureSummary: '前景色 #ccc 与背景色 #fff 对比度为 1.61:1，低于 4.5:1'
        }
      ]
    }
  ],
  passes: [...],
  incomplete: [...],
  inapplicable: [...]
}
```

### WCAG 2.2 核心检查项

WCAG 2.2 在 2.1 基础上新增了 9 个成功标准，自动化能覆盖的关键项：

| 检查项 | axe-core 规则 | 自动化检测 |
|--------|--------------|-----------|
| 颜色对比度 (1.4.3) | color-contrast | ✅ 完全自动 |
| 图片替代文本 (1.1.1) | image-alt | ✅ 完全自动 |
| 表单标签关联 (1.3.1) | label | ✅ 完全自动 |
| 键盘可达性 (2.1.1) | keyboard | ⚠️ 部分自动 |
| 焦点顺序 (2.4.3) | tabindex | ✅ 完全自动 |
| 聚焦可见 (2.4.7) | focus-order-semantics | ⚠️ 部分自动 |
| 一致导航 (3.2.3) | landmark-banner-is-top-level | ✅ 完全自动 |
| 错误预防 (3.3.4) | target-size | ✅ WCAG 2.2 新增 |

## 实战：Playwright + axe-core 集成

### 项目初始化

```bash
# 创建测试项目
mkdir playwright-a11y-tests && cd playwright-a11y-tests
npm init -y
npm install -D @playwright/test @axe-core/playwright axe-core

# 安装浏览器
npx playwright install chromium
```

### 基础配置：playwright.config.ts

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  reporter: [
    ['html', { outputFolder: 'a11y-report', open: 'never' }],
    ['json', { outputFile: 'a11y-report/results.json' }],
    ['list'],
  ],
});
```

### 单页检测：axe-playwright-test.ts

```typescript
// tests/axe-playwright-test.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const CRITICAL_ROUTES = [
  { name: '首页', path: '/' },
  { name: '登录页', path: '/login' },
  { name: '注册页', path: '/register' },
  { name: '商品列表', path: '/products' },
  { name: '购物车', path: '/cart' },
  { name: '结账页', path: '/checkout' },
  { name: '用户中心', path: '/account' },
  { name: '帮助中心', path: '/help' },
];

for (const route of CRITICAL_ROUTES) {
  test(`${route.name} (${route.path}) 无障碍检测`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'])
      .analyze();

    // 打印违规详情
    if (results.violations.length > 0) {
      console.log(`\n=== ${route.name} 违规 ${results.violations.length} 项 ===`);
      for (const violation of results.violations) {
        console.log(`\n规则: ${violation.id} (${violation.impact})`);
        console.log(`描述: ${violation.description}`);
        console.log(`帮助: ${violation.help}`);
        for (const node of violation.nodes) {
          console.log(`  元素: ${node.html}`);
          console.log(`  问题: ${node.failureSummary}`);
        }
      }
    }

    // 零违规断言（可调整为容忍 warning）
    expect(results.violations, `发现 ${results.violations.length} 个无障碍违规`).toEqual([]);
  });
}
```

### 高级检测：自定义 axe 规则

```typescript
// tests/axe-custom-rules.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('自定义规则：视频字幕检测', async ({ page }) => {
  await page.goto('/videos', { waitUntil: 'networkidle' });

  const results = await new AxeBuilder({ page })
    .options({
      rules: {
        // 启用所有规则
        'video-caption': { enabled: true },
        'audio-caption': { enabled: true },
        // 自定义：检查所有视频是否有 tracks
        'html-has-lang': { enabled: true },
      },
    })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('颜色对比度专项检测', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast', 'color-contrast-enhanced'])
    .analyze();

  // 对比度违规单独处理
  const contrastViolations = results.violations.filter(
    v => v.id === 'color-contrast'
  );

  if (contrastViolations.length > 0) {
    console.log('\n=== 颜色对比度违规 ===');
    for (const v of contrastViolations) {
      for (const node of v.nodes) {
        console.log(`${node.target}：${node.failureSummary}`);
      }
    }
  }

  expect(contrastViolations).toEqual([]);
});

test('表单可访问性检测', async ({ page }) => {
  await page.goto('/register', { waitUntil: 'networkidle' });

  const results = await new AxeBuilder({ page })
    .withRules([
      'label',           // 表单元素必须有关联 label
      'form-field-multiple-labels', // label 不能重复
      'autocomplete-valid',         // autocomplete 属性正确
    ])
    .analyze();

  expect(results.violations).toEqual([]);
});
```

### 页面爬取：全站无障碍扫描

```typescript
// tests/axe-full-site-scan.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'fs';

// 定义要扫描的路由（可从 API 或 sitemap 动态获取）
const SITEMAP_ROUTES = [
  '/',
  '/login',
  '/register',
  '/products',
  '/products/1',
  '/cart',
  '/checkout',
  '/account',
  '/account/orders',
  '/account/settings',
  '/help',
  '/about',
  '/contact',
];

interface ScanResult {
  route: string;
  violations: number;
  passes: number;
  incomplete: number;
  details: any[];
}

test.describe('全站无障碍扫描', () => {
  const results: ScanResult[] = [];

  for (const route of SITEMAP_ROUTES) {
    test(`扫描 ${route}`, async ({ page }) => {
      try {
        await page.goto(route, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) {
        console.log(`跳过 ${route}：页面加载失败`);
        results.push({
          route,
          violations: -1,
          passes: 0,
          incomplete: 0,
          details: [],
        });
        return;
      }

      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();

      const scanResult: ScanResult = {
        route,
        violations: axeResults.violations.length,
        passes: axeResults.passes.length,
        incomplete: axeResults.incomplete.length,
        details: axeResults.violations.map(v => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
        })),
      };

      results.push(scanResult);

      // 输出进度
      console.log(
        `${route}: ${scanResult.violations} violations, ${scanResult.passes} passes`
      );
    });
  }

  test('生成扫描报告', async () => {
    // 这个测试会在所有扫描完成后运行
    const totalViolations = results.reduce((sum, r) => sum + Math.max(r.violations, 0), 0);
    const totalPages = results.filter(r => r.violations >= 0).length;

    console.log('\n=== 全站扫描摘要 ===');
    console.log(`扫描页面: ${totalPages}`);
    console.log(`总违规数: ${totalViolations}`);
    console.log(`平均违规: ${(totalViolations / totalPages).toFixed(1)}/页`);

    // 按规则聚合
    const ruleCount: Record<string, number> = {};
    for (const r of results) {
      for (const d of r.details) {
        ruleCount[d.id] = (ruleCount[d.id] || 0) + d.nodes;
      }
    }

    console.log('\n按规则分布:');
    const sortedRules = Object.entries(ruleCount).sort((a, b) => b[1] - a[1]);
    for (const [rule, count] of sortedRules) {
      console.log(`  ${rule}: ${count} 个元素`);
    }

    // 保存 JSON 报告
    fs.writeFileSync(
      'a11y-report/full-site-scan.json',
      JSON.stringify({ summary: { totalPages, totalViolations, ruleCount }, pages: results }, null, 2)
    );

    // 严重违规断言（warning 级别不阻断）
    const seriousViolations = results
      .filter(r => r.violations > 0)
      .reduce((sum, r) => sum + r.violations, 0);

    // 阈值：每页平均不超过 2 个违规
    expect(
      seriousViolations / totalPages,
      `平均违规 ${(seriousViolations / totalPages).toFixed(1)} 超过阈值 2`
    ).toBeLessThanOrEqual(2);
  });
});
```

### 登录态扫描：处理认证页面

```typescript
// tests/axe-authenticated-scan.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// 登录辅助函数
async function login(page: any, email: string, password: string) {
  await page.goto('/login');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/account', { timeout: 10000 });
}

const AUTH_ROUTES = [
  { name: '用户中心', path: '/account' },
  { name: '订单列表', path: '/account/orders' },
  { name: '订单详情', path: '/account/orders/1' },
  { name: '地址管理', path: '/account/addresses' },
  { name: '收藏夹', path: '/account/wishlist' },
  { name: '优惠券', path: '/account/coupons' },
];

test.describe('认证页面无障碍扫描', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, 'test@example.com', 'password123');
    // 保存 cookies 供后续测试使用
    const cookies = await page.context().cookies();
    // 写入文件供其他测试读取
    const fs = await import('fs');
    fs.writeFileSync('/tmp/a11y-cookies.json', JSON.stringify(cookies));
    await page.context().close();
  });

  for (const route of AUTH_ROUTES) {
    test(`认证页 ${route.name}`, async ({ page }) => {
      // 加载 cookies
      const fs = await import('fs');
      const cookies = JSON.parse(fs.readFileSync('/tmp/a11y-cookies.json', 'utf-8'));
      await page.context().addCookies(cookies);

      await page.goto(route.path, { waitUntil: 'networkidle' });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();

      if (results.violations.length > 0) {
        console.log(`\n${route.name} 违规:`);
        for (const v of results.violations) {
          console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        }
      }

      expect(results.violations).toEqual([]);
    });
  }
});
```

## Laravel 集成：后端模板无障碍修复

### Blade 模板修复示例

```blade
{{-- 修复前：缺少 label --}}
<div class="form-group">
  <input type="text" name="name" class="form-control">
</div>

{{-- 修复后：正确关联 label --}}
<div class="form-group">
  <label for="name">姓名 <span class="required" aria-label="必填">*</span></label>
  <input type="text" name="name" id="name" class="form-control" 
         aria-required="true" aria-describedby="name-help">
  <small id="name-help" class="form-text text-muted">请输入真实姓名</small>
</div>
```

```blade
{{-- 修复前：图片缺少 alt --}}
<img src="{{ $product->image }}">

{{-- 修复后：有意义的 alt 文本 --}}
<img src="{{ $product->image }}" 
     alt="{{ $product->name }} - {{ $product->category->name }}"
     loading="lazy">

{{-- 装饰图片使用空 alt --}}
<img src="/images/decorative-wave.svg" alt="" role="presentation">
```

```blade
{{-- 修复前：按钮缺少无障碍信息 --}}
<button onclick="toggleMenu()">
  <svg><use href="#icon-menu"></use></svg>
</button>

{{-- 修复后：完整的无障碍支持 --}}
<button onclick="toggleMenu()" 
        aria-label="打开导航菜单"
        aria-expanded="false"
        aria-controls="main-nav">
  <svg aria-hidden="true"><use href="#icon-menu"></use></svg>
</button>
```

### Laravel Livewire 组件无障碍

```php
<?php
// app/Livewire/ProductFilter.php

namespace App\Livewire;

use Livewire\Component;

class ProductFilter extends Component
{
    public string $search = '';
    public string $category = '';
    public string $sort = 'newest';
    
    public function updatedSearch(): void
    {
        // 搜索变更时发送屏幕阅读器通知
        $this->dispatch('announce', [
            'message' => "搜索到 {$this->products->count()} 个结果",
            'polite' => true,
        ]);
    }
    
    public function render()
    {
        return view('livewire.product-filter', [
            'products' => $this->getFilteredProducts(),
        ]);
    }
}
```

```blade
{{-- resources/views/livewire/product-filter.blade.php --}}

<div>
  {{-- 搜索区域使用 role="search" --}}
  <div role="search" aria-label="商品筛选">
    <label for="search-input">搜索商品</label>
    <input type="search" 
           id="search-input"
           wire:model.live.debounce.300ms="search"
           aria-describedby="search-status">
    
    <label for="category-select">分类</label>
    <select id="category-select" wire:model.live="category">
      <option value="">全部分类</option>
      @foreach($categories as $cat)
        <option value="{{ $cat->id }}">{{ $cat->name }}</option>
      @endforeach
    </select>
    
    <label for="sort-select">排序</label>
    <select id="sort-select" wire:model.live="sort">
      <option value="newest">最新</option>
      <option value="price-asc">价格低→高</option>
      <option value="price-desc">价格高→低</option>
    </select>
  </div>
  
  {{-- 搜索状态公告（屏幕阅读器专用） --}}
  <div id="search-status" class="sr-only" aria-live="polite">
    找到 {{ $products->count() }} 个结果
  </div>
  
  {{-- 结果列表 --}}
  <div role="region" aria-label="搜索结果" aria-live="polite">
    @forelse($products as $product)
      <article aria-label="{{ $product->name }}">
        <h3><a href="{{ route('products.show', $product) }}">{{ $product->name }}</a></h3>
        <p aria-label="价格 ¥{{ number_format($product->price, 2) }}">
          ¥{{ number_format($product->price, 2) }}
        </p>
      </article>
    @empty
      <p role="status">没有找到匹配的商品，请调整筛选条件。</p>
    @endforelse
  </div>
</div>
```

## CI 门禁集成

### GitHub Actions 配置

```yaml
# .github/workflows/a11y.yml
name: Accessibility Testing

on:
  pull_request:
    paths:
      - 'resources/views/**'
      - 'resources/css/**'
      - 'resources/js/**'
      - 'routes/**'
  push:
    branches: [main]

jobs:
  a11y-check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    services:
      app:
        image: php:8.2-fpm
        options: --health-cmd="php-fpm -t" --health-interval=10s --health-timeout=5s --health-retries=5
        ports:
          - 9000:9000
      
      nginx:
        image: nginx:alpine
        ports:
          - 8080:80
        volumes:
          - ./:/var/www/html
          - ./nginx.conf:/etc/nginx/conf.d/default.conf
        depends_on:
          - app
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, pdo_mysql
          
      - name: Install Composer Dependencies
        run: composer install --no-dev --optimize-autoloader
        
      - name: Setup Laravel
        run: |
          cp .env.example .env
          php artisan key:generate
          php artisan migrate --force
        env:
          DB_CONNECTION: sqlite
          DB_DATABASE: :memory:
          
      - name: Seed Database
        run: php artisan db:seed
        
      - name: Install Node Dependencies
        run: npm ci
        
      - name: Install Playwright
        run: npx playwright install chromium --with-deps
        
      - name: Run a11y Tests
        run: npx playwright test --project=chromium
        env:
          BASE_URL: http://localhost:8080
          
      - name: Upload a11y Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: a11y-report
          path: |
            a11y-report/
            playwright-report/
          retention-days: 30
          
      - name: Comment PR with Results
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let report = '## ♿ 无障碍测试报告\n\n';
            
            try {
              const results = JSON.parse(
                fs.readFileSync('a11y-report/results.json', 'utf-8')
              );
              const violations = results.suites?.reduce((sum, s) => 
                sum + (s.specs?.filter(sp => sp.ok === false).length || 0), 0
              ) || 0;
              
              report += violations === 0 
                ? '✅ **所有无障碍测试通过**\n'
                : `⚠️ **发现 ${violations} 个无障碍违规**\n`;
            } catch (e) {
              report += '⚠️ 测试报告解析失败\n';
            }
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            });
```

### GitLab CI 配置

```yaml
# .gitlab-ci.yml
a11y:
  stage: test
  image: mcr.microsoft.com/playwright:v1.42.0-jammy
  variables:
    BASE_URL: "http://nginx:8080"
  services:
    - name: nginx:alpine
      alias: nginx
    - name: php:8.2-fpm
      alias: php-fpm
  script:
    - composer install --no-dev
    - npm ci
    - npx playwright test --project=chromium
    - |
      if [ -f a11y-report/results.json ]; then
        VIOLATIONS=$(cat a11y-report/results.json | jq '[.suites[]?.specs[]? | select(.ok == false)] | length')
        echo "发现 $VIOLATIONS 个无障碍违规"
        if [ "$VIOLATIONS" -gt "0" ]; then
          echo "无障碍测试未通过，请修复后重新提交"
          exit 1
        fi
      fi
  artifacts:
    when: always
    paths:
      - a11y-report/
    reports:
      junit: a11y-report/results.json
  rules:
    - if: $CI_MERGE_REQUEST_IID
    - if: $CI_COMMIT_BRANCH == "main"
```

## 踩坑记录

### 1. 动态内容检测时机

**问题**：SPA 或 Livewire 组件加载后，axe-core 扫描时内容还没渲染完。

**解决**：等待关键元素出现后再扫描。

```typescript
// 等待内容加载完成
await page.goto('/products');
await page.waitForSelector('[data-testid="product-list"]', { timeout: 10000 });

// 额外等待动画完成
await page.waitForTimeout(500);

const results = await new AxeBuilder({ page }).analyze();
```

### 2. iframe 内容遗漏

**问题**：axe-core 默认不扫描 iframe 内部内容。

**解决**：显式包含 iframe。

```typescript
const results = await new AxeBuilder({ page })
  .include('iframe')  // 扫描所有 iframe
  .analyze();

// 或指定特定 iframe
const results = await new AxeBuilder({ page })
  .include('iframe#payment-frame')
  .analyze();
```

### 3. 第三方组件噪音

**问题**：第三方 UI 库（如 Element Plus、Ant Design）自身有 a11y 问题，但我们改不了。

**解决**：用 axe-core 的 disableRules 选项排除特定规则。

```typescript
const results = await new AxeBuilder({ page })
  .disableRules([
    'color-contrast',  // 第三方组件的颜色对比度问题
    'link-name',       // 第三方图标按钮问题
  ])
  .withTags(['wcag2a', 'wcag2aa'])
  .analyze();
```

### 4. 测试环境与生产环境差异

**问题**：开发环境用 mock 数据，某些无障碍问题（如长文本截断）不会出现。

**解决**：用 Laravel Seeder 生成真实量级的测试数据。

```php
// database/seeders/A11yTestDataSeeder.php
public function run(): void
{
    // 创建带超长名称的商品（测试文本截断）
    Product::factory()->create([
        'name' => str_repeat('这是一段非常长的商品名称', 10),
        'description' => str_repeat('详细描述内容。', 100),
    ]);
    
    // 创建无 alt 的图片（测试图片检测）
    Product::factory()->create([
        'image' => null,  // 故意留空
    ]);
}
```

### 5. 屏幕阅读器测试验证

**问题**：axe-core 通过了，但实际屏幕阅读器体验很差。

**解决**：自动化测试 + 手动验证结合。

```typescript
// 生成需要手动验证的清单
test('生成手动验证清单', async ({ page }) => {
  await page.goto('/');
  
  const manualChecks = await page.evaluate(() => {
    const checks = [];
    
    // 检查是否有跳过链接
    const skipLink = document.querySelector('a[href="#main-content"]');
    if (!skipLink) {
      checks.push('缺少"跳到主要内容"链接');
    }
    
    // 检查页面标题层级
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    let prevLevel = 0;
    for (const h of headings) {
      const level = parseInt(h.tagName[1]);
      if (level > prevLevel + 1) {
        checks.push(`标题层级跳跃: ${prevLevel} → ${level} (${h.textContent})`);
      }
      prevLevel = level;
    }
    
    // 检查 landmark 区域
    const landmarks = ['banner', 'navigation', 'main', 'contentinfo'];
    for (const lm of landmarks) {
      if (!document.querySelector(`[role="${lm}"], ${lm === 'banner' ? 'header' : lm === 'contentinfo' ? 'footer' : lm}`)) {
        checks.push(`缺少 landmark: ${lm}`);
      }
    }
    
    return checks;
  });
  
  if (manualChecks.length > 0) {
    console.log('\n=== 需要手动验证 ===');
    manualChecks.forEach(c => console.log(`  - ${c}`));
  }
  
  // 这个测试不阻断 CI，只输出建议
});
```

## 无障碍测试看板

### 与 Grafana 集成

将 a11y 测试结果推送到 Prometheus，用 Grafana 看板追踪趋势：

```php
<?php
// app/Services/A11yMetrics.php

namespace App\Services;

use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class A11yMetrics
{
    private CollectorRegistry $registry;
    
    public function __construct()
    {
        $this->registry = new CollectorRegistry(new Redis([
            'host' => config('database.redis.default.host'),
            'port' => config('database.redis.default.port'),
        ]));
    }
    
    public function recordScanResults(array $results): void
    {
        $gauge = $this->registry->registerGauge(
            'a11y',
            'violations_total',
            '无障碍违规总数',
            ['page', 'rule', 'severity']
        );
        
        foreach ($results['pages'] as $page) {
            foreach ($page['details'] as $detail) {
                $gauge->setValue(
                    [$page['route'], $detail['id'], $detail['impact']],
                    $detail['nodes']
                );
            }
        }
    }
}
```

## 总结

自动化无障碍测试的核心价值不是替代人工审计，而是：

1. **建立基线**：每次发布前自动检测，防止回归
2. **快速反馈**：CI 门禁在 PR 阶段就发现问题
3. **趋势追踪**：通过指标看板监控无障碍质量变化
4. **团队意识**：让每个人都知道无障碍是质量标准的一部分

工具链：**axe-core**（检测引擎） + **Playwright**（浏览器自动化） + **CI/CD**（门禁集成） + **Grafana**（趋势追踪）。

axe-core 能自动检测约 57% 的 WCAG 2.2 AA 级问题，配合周期性的人工审计（建议每月一次），能覆盖 90%+ 的无障碍问题。在法律合规压力越来越大的今天，这不是可选项，而是必选项。

## 键盘导航自动化测试

无障碍不仅仅是屏幕阅读器的事。键盘导航是第二重要的无障碍需求——全球约 15% 的用户有运动障碍，无法使用鼠标。

### Tab 顺序验证

```typescript
// tests/keyboard-navigation.spec.ts
import { test, expect } from '@playwright/test';

test('首页 Tab 顺序正确', async ({ page }) => {
  await page.goto('/');
  
  // 按 Tab 键追踪焦点
  const focusOrder: string[] = [];
  
  // Tab 前 15 次，记录焦点位置
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName,
        text: el?.textContent?.trim().substring(0, 50),
        role: el?.getAttribute('role'),
        ariaLabel: el?.getAttribute('aria-label'),
      };
    });
    focusOrder.push(
      `<${focused.tag}> ${focused.text || focused.ariaLabel || focused.role || '(无文本)'}`
    );
  }
  
  console.log('\n=== Tab 焦点顺序 ===');
  focusOrder.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  
  // 验证第一个焦点是跳过链接
  expect(focusOrder[0]).toContain('跳到主要内容');
  
  // 验证导航区域在主要内容之前
  const navIndex = focusOrder.findIndex(f => f.includes('nav'));
  const mainIndex = focusOrder.findIndex(f => f.includes('main'));
  expect(navIndex).toBeLessThan(mainIndex);
});

test('表单键盘操作完整流程', async ({ page }) => {
  await page.goto('/contact');
  
  // 用键盘填写表单
  await page.keyboard.press('Tab'); // 聚焦到第一个输入框
  await page.keyboard.type('张三');
  
  await page.keyboard.press('Tab'); // 移动到邮箱
  await page.keyboard.type('zhangsan@example.com');
  
  await page.keyboard.press('Tab'); // 移动到消息
  await page.keyboard.type('这是一条测试消息');
  
  await page.keyboard.press('Tab'); // 移动到提交按钮
  
  // 验证焦点在提交按钮上
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(focusedTag).toBe('BUTTON');
  
  // 验证表单可以键盘提交
  await page.keyboard.press('Enter');
  
  // 等待响应
  await page.waitForTimeout(1000);
  
  // 验证成功提示出现（且可被屏幕阅读器感知）
  const status = await page.$('[role="status"], [aria-live="polite"]');
  expect(status).not.toBeNull();
});

test('模态框键盘陷阱', async ({ page }) => {
  await page.goto('/');
  
  // 打开模态框
  await page.click('[data-testid="open-modal"]');
  
  // 验证焦点在模态框内
  const modalContainsFocus = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"]');
    const focused = document.activeElement;
    return modal?.contains(focused) || false;
  });
  expect(modalContainsFocus).toBe(true);
  
  // Tab 循环测试：从最后一个元素 Tab 应回到第一个
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
  }
  
  // 焦点应该仍在模态框内
  const stillInModal = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"]');
    const focused = document.activeElement;
    return modal?.contains(focused) || false;
  });
  expect(stillInModal).toBe(true);
  
  // Escape 键关闭模态框
  await page.keyboard.press('Escape');
  
  const modalClosed = await page.evaluate(() => {
    return document.querySelector('[role="dialog"]') === null;
  });
  expect(modalClosed).toBe(true);
});
```

### Focus Visible 样式检测

```typescript
test('所有交互元素都有可见焦点样式', async ({ page }) => {
  await page.goto('/');
  
  // 收集所有可交互元素
  const interactiveElements = await page.$$eval(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    elements => elements.map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim().substring(0, 30),
      selector: el.id ? `#${el.id}` : undefined,
    })).filter(el => el.selector) // 只测试有 ID 的元素
  );
  
  console.log(`找到 ${interactiveElements.length} 个可交互元素`);
  
  const noFocusStyle: string[] = [];
  
  for (const el of interactiveElements.slice(0, 20)) { // 测试前 20 个
    const element = await page.$(el.selector!);
    if (!element) continue;
    
    await element.focus();
    
    // 检查焦点样式
    const hasFocusStyle = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      
      const styles = window.getComputedStyle(el);
      const outline = styles.outline;
      const boxShadow = styles.boxShadow;
      const border = styles.border;
      
      // 检查是否有明显的焦点指示器
      return (
        outline !== 'none' && outline !== '' ||
        boxShadow !== 'none' && boxShadow !== '' ||
        border.includes('solid') // 简化检测
      );
    }, el.selector);
    
    if (!hasFocusStyle) {
      noFocusStyle.push(`${el.tag} "${el.text}"`);
    }
  }
  
  if (noFocusStyle.length > 0) {
    console.log('\n=== 缺少可见焦点样式的元素 ===');
    noFocusStyle.forEach(el => console.log(`  - ${el}`));
  }
  
  // 不阻断测试，但记录问题
  // expect(noFocusStyle).toEqual([]);
});
```

## ARIA 属性深度检测

### 自定义组件 ARIA 模式验证

```typescript
// tests/aria-patterns.spec.ts
import { test, expect } from '@playwright/test';

test('下拉菜单 ARIA 模式正确', async ({ page }) => {
  await page.goto('/');
  
  // 找到下拉触发器
  const trigger = await page.$('[role="button"][aria-haspopup="menu"]');
  expect(trigger).not.toBeNull();
  
  // 初始状态：菜单关闭
  const initialExpanded = await trigger?.getAttribute('aria-expanded');
  expect(initialExpanded).toBe('false');
  
  // 打开菜单
  await trigger?.click();
  
  // 验证 ARIA 状态更新
  const expandedAfterClick = await trigger?.getAttribute('aria-expanded');
  expect(expandedAfterClick).toBe('true');
  
  // 验证菜单出现且有正确角色
  const menu = await page.$('[role="menu"]');
  expect(menu).not.toBeNull();
  
  // 验证菜单项有 menuitem 角色
  const menuItems = await page.$$('[role="menuitem"]');
  expect(menuItems.length).toBeGreaterThan(0);
  
  // 键盘导航：ArrowDown 选择下一个菜单项
  await page.keyboard.press('ArrowDown');
  
  const activeItem = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      if (item.getAttribute('aria-current') === 'true' ||
          item.classList.contains('active')) {
        return item.textContent;
      }
    }
    return null;
  });
  
  console.log(`当前选中菜单项: ${activeItem}`);
  
  // Escape 关闭菜单
  await page.keyboard.press('Escape');
  
  const menuClosed = await page.$('[role="menu"]');
  expect(menuClosed).toBeNull();
});

test('手风琴组件 ARIA 展开/折叠', async ({ page }) => {
  await page.goto('/faq');
  
  const sections = await page.$$('[role="heading"][aria-level]');
  console.log(`找到 ${sections.length} 个手风琴标题`);
  
  for (const section of sections) {
    const button = await section.$('button');
    if (!button) continue;
    
    const controlsId = await button.getAttribute('aria-controls');
    const expanded = await button.getAttribute('aria-expanded');
    
    console.log(`标题: "${await section.textContent()}"`);
    console.log(`  aria-controls: ${controlsId}`);
    console.log(`  aria-expanded: ${expanded}`);
    
    // 点击展开
    await button.click();
    
    // 验证内容区域展开
    if (controlsId) {
      const contentVisible = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const styles = window.getComputedStyle(el);
        return styles.display !== 'none' && styles.height !== '0px';
      }, controlsId);
      
      expect(contentVisible).toBe(true);
    }
    
    // 再次点击折叠
    await button.click();
    
    const collapsedExpanded = await button.getAttribute('aria-expanded');
    expect(collapsedExpanded).toBe('false');
  }
});

test('标签页组件 ARIA 模式', async ({ page }) => {
  await page.goto('/product/1');
  
  // 验证 tablist
  const tablist = await page.$('[role="tablist"]');
  expect(tablist).not.toBeNull();
  
  // 验证所有 tab
  const tabs = await page.$$('[role="tab"]');
  expect(tabs.length).toBeGreaterThan(1);
  
  // 第一个 tab 应该是选中状态
  const firstTabSelected = await tabs[0].getAttribute('aria-selected');
  expect(firstTabSelected).toBe('true');
  
  // 点击第二个 tab
  await tabs[1].click();
  
  // 验证 aria-selected 切换
  const secondTabSelected = await tabs[1].getAttribute('aria-selected');
  expect(secondTabSelected).toBe('true');
  
  const firstTabNow = await tabs[0].getAttribute('aria-selected');
  expect(firstTabNow).toBe('false');
  
  // 验证面板显示/隐藏
  const panelId = await tabs[1].getAttribute('aria-controls');
  if (panelId) {
    const panelVisible = await page.evaluate((id) => {
      const panel = document.getElementById(id);
      return panel && !panel.hidden;
    }, panelId);
    expect(panelVisible).toBe(true);
  }
  
  // 键盘导航：ArrowRight 切换到下一个 tab
  await tabs[1].focus();
  await page.keyboard.press('ArrowRight');
  
  const nextTabFocused = await page.evaluate(() => {
    return document.activeElement?.getAttribute('role') === 'tab';
  });
  expect(nextTabFocused).toBe(true);
});
```

## 国际化无障碍

### 多语言 a11y 检测

```typescript
// tests/i18n-a11y.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const LOCALES = [
  { code: 'zh-CN', name: '中文', url: '/' },
  { code: 'en', name: 'English', url: '/en' },
  { code: 'ja', name: '日本語', url: '/ja' },
  { code: 'ko', name: '한국어', url: '/ko' },
];

for (const locale of LOCALES) {
  test(`${locale.name} (${locale.code}) 无障碍检测`, async ({ page }) => {
    await page.goto(locale.url, { waitUntil: 'networkidle' });
    
    // 验证 html lang 属性
    const lang = await page.$eval('html', el => el.getAttribute('lang'));
    expect(lang).toBe(locale.code);
    
    // axe-core 检测
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    
    // 输出该语言的违规数
    console.log(`${locale.name}: ${results.violations.length} 个违规`);
    
    if (results.violations.length > 0) {
      for (const v of results.violations) {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
      }
    }
    
    // CJK 语言的特殊检查
    if (['zh-CN', 'ja', 'ko'].includes(locale.code)) {
      // 检查字体是否有足够的字形覆盖
      const fontCheck = await page.evaluate(() => {
        const testChars = '测试字体覆盖';
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return true;
        
        ctx.font = '16px sans-serif';
        const width = ctx.measureText(testChars).width;
        
        // 如果宽度为 0，说明字体缺失
        return width > 0;
      });
      
      expect(fontCheck).toBe(true);
    }
  });
}
```

## 性能与无障碍结合

### Core Web Vitals + a11y 联合报告

```typescript
// tests/perf-a11y-combined.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = ['/', '/products', '/cart', '/checkout'];

test.describe('性能 + 无障碍联合检测', () => {
  for (const url of PAGES) {
    test(`${url} 性能与无障碍联合报告`, async ({ page }) => {
      // 收集性能指标
      const startTime = Date.now();
      await page.goto(url, { waitUntil: 'networkidle' });
      const loadTime = Date.now() - startTime;
      
      // 获取 Core Web Vitals
      const vitals = await page.evaluate(() => {
        return new Promise<{ lcp: number; fid: number; cls: number }>((resolve) => {
          let lcp = 0, fid = 0, cls = 0;
          
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              lcp = entry.startTime;
            }
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              fid = (entry as any).processingStart - entry.startTime;
            }
          }).observe({ type: 'first-input', buffered: true });
          
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              cls += (entry as any).value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
          
          setTimeout(() => resolve({ lcp, fid, cls }), 2000);
        });
      });
      
      // a11y 检测
      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      
      // 联合报告
      const report = {
        url,
        performance: {
          loadTime,
          lcp: vitals.lcp,
          fid: vitals.fid,
          cls: vitals.cls,
        },
        accessibility: {
          violations: axeResults.violations.length,
          passes: axeResults.passes.length,
          score: Math.round(
            (axeResults.passes.length /
              (axeResults.passes.length + axeResults.violations.length)) *
              100
          ),
        },
      };
      
      console.log(`\n=== ${url} 联合报告 ===`);
      console.log(`加载时间: ${loadTime}ms`);
      console.log(`LCP: ${vitals.lcp.toFixed(0)}ms`);
      console.log(`CLS: ${vitals.cls.toFixed(3)}`);
      console.log(`无障碍违规: ${report.accessibility.violations}`);
      console.log(`无障碍评分: ${report.accessibility.score}/100`);
      
      // 保存到文件
      const fs = await import('fs');
      const reportDir = 'a11y-report';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }
      fs.writeFileSync(
        `${reportDir}/combined-${url.replace(/\//g, '-')}.json`,
        JSON.stringify(report, null, 2)
      );
      
      // 断言
      expect(report.accessibility.violations).toBeLessThanOrEqual(3);
      expect(report.performance.lcp).toBeLessThan(2500); // LCP < 2.5s
    });
  }
});
```

## 团队工作流

### 无障碍修复优先级矩阵

```
影响等级    自动化检测    修复优先级    修复时间
────────────────────────────────────────────
Critical    ✅ 自动       P0 立即修     < 1 天
  - 键盘陷阱
  - 缺少 alt
  - 表单无 label

Serious     ✅ 自动       P1 本迭代     < 3 天
  - 对比度不足
  - ARIA 属性错误
  - 焦点顺序混乱

Moderate    ⚠️ 部分       P2 下迭代     < 1 周
  - 冗余标题
  - 链接无文本
  - 标题层级跳跃

Minor       ⚠️ 部分       P3 有空修      backlog
  - 拼写建议
  - 可选标签
```

### PR Review Checklist

在 `.github/PULL_REQUEST_TEMPLATE.md` 中添加：

```markdown
## 无障碍检查
- [ ] 新增/修改的表单元素有关联 label
- [ ] 图片有描述性 alt 文本
- [ ] 新组件支持键盘操作
- [ ] 颜色对比度符合 WCAG 2.2 AA（4.5:1）
- [ ] 动态内容更新有 aria-live 通知
- [ ] 自定义组件使用了正确的 ARIA 角色
- [ ] 焦点管理逻辑正确（模态框、下拉菜单等）
```

## 常见无障碍问题速查

| 问题 | 检测规则 | Laravel 修复方案 |
|------|---------|-----------------|
| 图片无 alt | `image-alt` | `<img alt="{{ $desc }}">` |
| 表单无 label | `label` | `<label for="x">` + `id="x"` |
| 链接无文本 | `link-name` | `<a aria-label="...">` 或内部文本 |
| 按钮无文本 | `button-name` | `aria-label="操作"` |
| 对比度不足 | `color-contrast` | 调整 CSS 颜色值 |
| 标题跳级 | `heading-order` | 保持 h1→h2→h3 顺序 |
| 缺少 lang | `html-has-lang` | `<html lang="zh-CN">` |
| 缺少 landmark | `region` | 使用 `<header>/<nav>/<main>/<footer>` |
| 目标尺寸太小 | `target-size` | 最小 24×24px（WCAG 2.2） |

## 总结

自动化无障碍测试的核心价值不是替代人工审计，而是：

1. **建立基线**：每次发布前自动检测，防止回归
2. **快速反馈**：CI 门禁在 PR 阶段就发现问题
3. **趋势追踪**：通过指标看板监控无障碍质量变化
4. **团队意识**：让每个人都知道无障碍是质量标准的一部分

工具链：**axe-core**（检测引擎） + **Playwright**（浏览器自动化） + **CI/CD**（门禁集成） + **Grafana**（趋势追踪）。

axe-core 能自动检测约 57% 的 WCAG 2.2 AA 级问题，配合周期性的人工审计（建议每月一次），能覆盖 90%+ 的无障碍问题。在法律合规压力越来越大的今天，这不是可选项，而是必选项。

**记住：无障碍不是终点，而是持续改进的过程。** 先自动化 57% 的可检测问题，再用人工审计补齐剩余部分，逐步建立无障碍文化。
