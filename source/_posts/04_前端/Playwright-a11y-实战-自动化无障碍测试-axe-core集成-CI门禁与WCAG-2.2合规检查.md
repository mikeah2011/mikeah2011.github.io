---
title: 'Playwright a11y 实战：自动化无障碍测试——axe-core 集成、CI 门禁与 WCAG 2.2 合规检查'
date: 2026-06-03 01:12:12
tags: [Playwright, 无障碍, a11y, axe-core, WCAG, CI/CD]
description: 本文系统讲解如何用 Playwright + axe-core 构建自动化无障碍测试体系，涵盖 WCAG 2.2 核心原则、axe-core 自定义规则配置、CI/CD 门禁集成、GitHub Actions 流水线搭建、组件级与页面级测试实践、常见无障碍陷阱排查，以及从本地开发到企业级落地的完整策略，适合前端团队快速建立可持续的无障碍质量保障机制。
categories: [前端]
cover: /images/covers/playwright-a11y-cover.jpg
---

Web 无障碍（Accessibility，简称 a11y）不仅是道德义务，更是法律要求。欧盟《欧洲无障碍法案》（EAA）将于 2025 年 6 月全面生效，美国 ADA 诉讼案件数量逐年递增，中国《信息技术 互联网内容无障碍可访问性技术要求与测试方法》（GB/T 37668-2019）也在持续推广。对于企业来说，忽视无障碍意味着法律风险、用户流失和品牌损害。

本文将系统讲解如何用 Playwright + axe-core 构建自动化无障碍测试体系，从本地开发到 CI 门禁，从 WCAG 2.2 原则到企业级落地策略。

<!-- more -->

## 一、Web 无障碍的法律与商业意义

### 1.1 法律环境

```text
全球无障碍法规时间线:
┌─────────────┬───────────────────────────────────────────┐
│ 2018        │ 美国 Section 508 更新（WCAG 2.0 AA）       │
│ 2019        │ 中国 GB/T 37668-2019 发布                  │
│ 2020        │ 欧盟 Web Accessibility Directive 生效      │
│ 2022        │ 美国 DOJ 确认 ADA 适用于网站               │
│ 2025.06     │ 欧盟 EAA 全面生效（WCAG 2.1 AA）           │
│ 2025+       │ 预计更多国家立法强制执行                    │
└─────────────┴───────────────────────────────────────────┘

违规成本:
- 美国：ADA 诉讼平均和解金额 $10,000-$100,000
- 欧盟：各成员国罚款不同，可达营业额的 5%
- 品牌损失：无法量化但影响深远
```

### 1.2 商业价值

```text
无障碍优化的 ROI:

1. 市场扩大
   - 全球 13 亿残障人士（WHO 数据）
   - 中国 8500 万残障人士
   - 老年人群（65+）约 7 亿

2. SEO 提升
   - 语义化 HTML → 更好的爬虫理解
   - alt 文本 → 图片搜索排名
   - 结构化标题 → 内容层次清晰

3. 用户体验改善
   - 键盘导航 → 所有用户受益
   - 高对比度 → 户外使用场景
   - 字幕 → 嘈杂环境观看

4. 技术债务减少
   - 代码质量提升
   - 组件可复用性增强
   - 测试覆盖率提高
```

## 二、WCAG 2.2 核心原则

### 2.1 POUR 四大原则

```text
WCAG 2.2 的 POUR 原则:

┌─────────────────────────────────────────────────────────┐
│ 1. Perceivable（可感知）                                 │
│    - 1.1 非文本内容：图片需要 alt 文本                    │
│    - 1.2 时间媒体：视频需要字幕和音频描述                 │
│    - 1.3 适应性：内容可通过多种方式呈现                   │
│    - 1.4 可辨别：文本可缩放、颜色不是唯一信息载体         │
├─────────────────────────────────────────────────────────┤
│ 2. Operable（可操作）                                    │
│    - 2.1 键盘可访问：所有功能可通过键盘操作               │
│    - 2.2 充足时间：用户有足够时间阅读和操作               │
│    - 2.3 癫痫安全：不引发光敏性癫痫                      │
│    - 2.4 可导航：提供导航辅助和焦点管理                   │
│    - 2.5 输入方式：不仅依赖精确指针操作                   │
├─────────────────────────────────────────────────────────┤
│ 3. Understandable（可理解）                              │
│    - 3.1 可读：页面语言可识别                            │
│    - 3.2 可预测：行为一致且可预期                        │
│    - 3.3 输入辅助：帮助用户避免和纠正错误                 │
├─────────────────────────────────────────────────────────┤
│ 4. Robust（健壮性）                                      │
│    - 4.1 兼容：辅助技术可正确解析内容                     │
│    - 4.1.1 解析：HTML 无语法错误                         │
│    - 4.1.2 名称、角色、值：组件的语义信息正确             │
└─────────────────────────────────────────────────────────┘
```

### 2.2 WCAG 2.2 新增标准

```text
WCAG 2.2 新增的成功标准（相对 2.1）:

2.4.11 Focus Not Obscured (Minimum) - AA
     焦点元素至少部分可见，不被其他内容完全遮挡

2.4.12 Focus Not Obscured (Enhanced) - AAA
     焦点元素完全可见

2.4.13 Focus Appearance - AAA
     焦点指示器的面积和对比度要求

2.5.7 Dragging Movements - AA
     拖拽操作必须有单指替代方案

2.5.8 Target Size (Minimum) - AA
     触摸目标最小 24x24 CSS 像素

3.2.6 Consistent Help - A
     帮助机制在页面间位置一致

3.3.7 Redundant Entry - A
     避免让用户重复输入相同信息

3.3.8 Accessible Authentication (Minimum) - AA
     不要求认知功能测试（如记忆密码、解谜）

3.3.9 Accessible Authentication (Enhanced) - AAA
     不要求认知功能测试（更严格）
```

## 三、Playwright 测试基础

### 3.1 环境搭建

```bash
# 初始化项目
mkdir a11y-test-demo && cd a11y-test-demo
npm init -y

# 安装 Playwright
npm install -D @playwright/test
npx playwright install

# 安装 axe-core Playwright 集成
npm install -D @axe-core/playwright

# 项目结构
a11y-test-demo/
├── tests/
│   ├── a11y/
│   │   ├── homepage.spec.ts
│   │   ├── login.spec.ts
│   │   ├── components.spec.ts
│   │   └── fixtures.ts
│   └── e2e/
├── playwright.config.ts
├── axe-config.ts
└── package.json
```

### 3.2 Playwright 配置

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'test-results' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // 移动端无障碍测试
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
```

## 四、axe-core/playwright 集成

### 4.1 基础用法

```typescript
// tests/a11y/homepage.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('首页无障碍测试', () => {
  test('首页应无无障碍违规', async ({ page }) => {
    await page.goto('/');
    
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    
    // 输出违规详情
    if (results.violations.length > 0) {
      console.log('\n=== 无障碍违规 ===');
      results.violations.forEach((violation, index) => {
        console.log(`\n${index + 1}. [${violation.impact}] ${violation.id}`);
        console.log(`   描述: ${violation.description}`);
        console.log(`   帮助: ${violation.helpUrl}`);
        console.log(`   影响元素:`);
        violation.nodes.forEach(node => {
          console.log(`     - ${node.html}`);
          console.log(`       修复建议: ${node.failureSummary}`);
        });
      });
    }
    
    expect(results.violations).toEqual([]);
  });

  test('首页应无严重级别违规（允许警告）', async ({ page }) => {
    await page.goto('/');
    
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])  // 暂时跳过颜色对比
      .analyze();
    
    // 只检查 critical 和 serious 级别
    const seriousViolations = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    
    expect(seriousViolations).toEqual([]);
  });
});
```

### 4.2 自定义 axe 配置

```typescript
// axe-config.ts
import type { RunOptions } from 'axe-core';

export const defaultAxeOptions: RunOptions = {
  runOnly: {
    type: 'tag',
    values: [
      'wcag2a',        // WCAG 2.0 A 级
      'wcag2aa',       // WCAG 2.0 AA 级
      'wcag21a',       // WCAG 2.1 A 级
      'wcag21aa',      // WCAG 2.1 AA 级
      'wcag22aa',      // WCAG 2.2 AA 级
      'best-practice', // 最佳实践
    ],
  },
  resultTypes: ['violations', 'incomplete'],
};

// 按页面类型自定义规则
export const pageConfigs = {
  // 登录页面：关注表单无障碍
  login: {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'],
    },
    rules: {
      'color-contrast': { enabled: true },
      'label': { enabled: true },
      'autocomplete-valid': { enabled: true },
    },
  },
  
  // 数据表格页面：关注表格无障碍
  dataTable: {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'best-practice'],
    },
    rules: {
      'th-has-data-cells': { enabled: true },
      'td-headers-attr': { enabled: true },
      'table-fake-caption': { enabled: true },
    },
  },
  
  // 多媒体页面：关注媒体无障碍
  media: {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa'],
    },
    rules: {
      'video-caption': { enabled: true },
      'audio-caption': { enabled: true },
    },
  },
};
```

### 4.3 测试 Fixtures

```typescript
// tests/a11y/fixtures.ts
import { test as base, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { RunOptions, Result } from 'axe-core';
import { defaultAxeOptions } from '../../axe-config';

// 自定义 fixture 类型
type A11yFixtures = {
  a11y: {
    checkPage: (options?: RunOptions) => Promise<Result[]>;
    checkComponent: (selector: string, options?: RunOptions) => Promise<Result[]>;
    checkFullPage: (options?: RunOptions) => Promise<{
      violations: Result[];
      passes: number;
      incomplete: number;
    }>;
  };
};

export const test = base.extend<A11yFixtures>({
  a11y: async ({ page }, use) => {
    const a11y = {
      // 检查整个页面
      checkPage: async (options?: RunOptions) => {
        const results = await new AxeBuilder({ page })
          .options(options || defaultAxeOptions)
          .analyze();
        return results.violations;
      },
      
      // 检查特定组件
      checkComponent: async (selector: string, options?: RunOptions) => {
        const results = await new AxeBuilder({ page })
          .include(selector)
          .options(options || defaultAxeOptions)
          .analyze();
        return results.violations;
      },
      
      // 完整检查（包含统计）
      checkFullPage: async (options?: RunOptions) => {
        const results = await new AxeBuilder({ page })
          .options(options || defaultAxeOptions)
          .analyze();
        return {
          violations: results.violations,
          passes: results.passes.length,
          incomplete: results.incomplete.length,
        };
      },
    };
    
    await use(a11y);
  },
});

export { expect } from '@playwright/test';
```

## 五、自定义规则与业务场景

### 5.1 针对电商网站的自定义规则

```typescript
// tests/a11y/ecommerce.spec.ts
import { test, expect } from './fixtures';

test.describe('电商网站无障碍测试', () => {
  test('商品列表页 - 每个商品卡片有完整信息', async ({ page, a11y }) => {
    await page.goto('/products');
    
    // 检查商品卡片
    const violations = await a11y.checkComponent('.product-card');
    
    // 自定义断言：商品图片必须有 alt
    const productImages = await page.$$('.product-card img');
    for (const img of productImages) {
      const alt = await img.getAttribute('alt');
      expect(alt).toBeTruthy();
      expect(alt!.length).toBeGreaterThan(0);
    }
    
    // 自定义断言：价格必须可被屏幕阅读器读取
    const prices = await page.$$('.product-card .price');
    for (const price of prices) {
      const ariaLabel = await price.getAttribute('aria-label');
      const text = await price.textContent();
      // 确保价格不是纯符号（如 "$" 而没有数字）
      expect(text).toMatch(/\d/);
    }
    
    expect(violations).toEqual([]);
  });

  test('购物车 - 键盘可操作', async ({ page }) => {
    await page.goto('/cart');
    
    // 测试 Tab 键导航
    const focusableElements = await page.$$eval(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      elements => elements.map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        tabIndex: el.tabIndex,
      }))
    );
    
    console.log('可聚焦元素:', focusableElements);
    
    // Tab 到第一个可交互元素
    await page.keyboard.press('Tab');
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'A', 'INPUT']).toContain(firstFocused);
    
    // 测试数量调整按钮的键盘操作
    const qtyInput = await page.$('.cart-item-quantity input');
    if (qtyInput) {
      await qtyInput.focus();
      await page.keyboard.press('ArrowUp');
      const value = await qtyInput.inputValue();
      expect(parseInt(value)).toBeGreaterThan(0);
    }
  });

  test('结账表单 - 错误提示无障碍', async ({ page, a11y }) => {
    await page.goto('/checkout');
    
    // 提交空表单
    await page.click('button[type="submit"]');
    
    // 等待错误提示出现
    await page.waitForSelector('.error-message', { timeout: 3000 });
    
    // 检查错误提示的无障碍属性
    const errors = await page.$$('.error-message');
    for (const error of errors) {
      const role = await error.getAttribute('role');
      const ariaLive = await error.getAttribute('aria-live');
      const id = await error.getAttribute('id');
      
      // 错误提示应该是 alert 或有 aria-live
      expect(role === 'alert' || ariaLive === 'polite' || ariaLive === 'assertive')
        .toBeTruthy();
    }
    
    // 检查输入框的 aria-invalid 和 aria-describedby
    const invalidInputs = await page.$$('input[aria-invalid="true"]');
    for (const input of invalidInputs) {
      const describedBy = await input.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      
      // 确保描述元素存在
      const description = await page.$(`#${describedBy}`);
      expect(description).toBeTruthy();
    }
    
    const violations = await a11y.checkPage();
    expect(violations).toEqual([]);
  });
});
```

### 5.2 管理后台组件测试

```typescript
// tests/a11y/components.spec.ts
import { test, expect } from './fixtures';

test.describe('组件无障碍测试', () => {
  test('Modal 弹窗 - 焦点管理', async ({ page }) => {
    await page.goto('/admin/dashboard');
    
    // 打开弹窗
    await page.click('#open-modal-btn');
    await page.waitForSelector('[role="dialog"]', { state: 'visible' });
    
    // 验证焦点移到弹窗内
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.closest('[role="dialog"]') !== null;
    });
    expect(focusedElement).toBeTruthy();
    
    // 验证背景不可聚焦
    const backgroundFocusable = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const backgroundElements = document.querySelectorAll(
        'a, button, input, select, textarea, [tabindex]'
      );
      
      for (const el of backgroundElements) {
        if (!dialog?.contains(el)) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            const tabIndex = el.getAttribute('tabindex');
            if (tabIndex !== '-1') return true;
          }
        }
      }
      return false;
    });
    
    // 弹窗打开时，背景元素应不可聚焦
    // 注意：这需要实现 focus trap
    console.log('背景元素是否可聚焦:', backgroundFocusable);
    
    // Tab 键应在弹窗内循环
    const dialog = await page.$('[role="dialog"]');
    const focusableInDialog = await dialog!.$$eval(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      els => els.length
    );
    
    // 多次 Tab 验证焦点循环
    for (let i = 0; i < focusableInDialog + 2; i++) {
      await page.keyboard.press('Tab');
      const isInDialog = await page.evaluate(() => {
        return document.activeElement?.closest('[role="dialog"]') !== null;
      });
      expect(isInDialog).toBeTruthy();
    }
    
    // Escape 关闭弹窗
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'hidden' });
    
    // 焦点回到触发按钮
    const focusReturned = await page.evaluate(() => {
      return document.activeElement?.id === 'open-modal-btn';
    });
    expect(focusReturned).toBeTruthy();
  });

  test('下拉菜单 - 键盘导航', async ({ page }) => {
    await page.goto('/admin/dashboard');
    
    // 聚焦到菜单触发器
    await page.focus('[aria-haspopup="menu"]');
    
    // Enter 或 Space 打开菜单
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="menu"]', { state: 'visible' });
    
    // Arrow Down 导航
    await page.keyboard.press('ArrowDown');
    const firstItem = await page.evaluate(() => document.activeElement?.role);
    expect(firstItem).toBe('menuitem');
    
    // Arrow Down 到下一个
    await page.keyboard.press('ArrowDown');
    const secondItemText = await page.evaluate(() => document.activeElement?.textContent);
    expect(secondItemText).toBeTruthy();
    
    // Arrow Up 回到上一个
    await page.keyboard.press('ArrowUp');
    
    // Escape 关闭
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="menu"]', { state: 'hidden' });
  });

  test('Tabs 标签页 - ARIA 属性', async ({ page, a11y }) => {
    await page.goto('/admin/settings');
    
    // 验证 tablist 结构
    const tablist = await page.$('[role="tablist"]');
    expect(tablist).toBeTruthy();
    
    const tabs = await page.$$('[role="tab"]');
    expect(tabs.length).toBeGreaterThan(0);
    
    // 验证第一个 tab 的选中状态
    const firstTabSelected = await tabs[0].getAttribute('aria-selected');
    expect(firstTabSelected).toBe('true');
    
    // 验证 tab 关联的 panel
    const firstTabPanelId = await tabs[0].getAttribute('aria-controls');
    const panel = await page.$(`#${firstTabPanelId}`);
    expect(panel).toBeTruthy();
    
    const panelRole = await panel!.getAttribute('role');
    expect(panelRole).toBe('tabpanel');
    
    // 点击第二个 tab
    await tabs[1].click();
    
    // 验证状态变化
    const firstTabAfter = await tabs[0].getAttribute('aria-selected');
    const secondTabAfter = await tabs[1].getAttribute('aria-selected');
    expect(firstTabAfter).toBe('false');
    expect(secondTabAfter).toBe('true');
    
    // 键盘导航
    await tabs[1].focus();
    await page.keyboard.press('ArrowRight');
    const thirdTabFocused = await page.evaluate(() => 
      document.activeElement?.getAttribute('role')
    );
    expect(thirdTabFocused).toBe('tab');
    
    const violations = await a11y.checkComponent('[role="tablist"]');
    expect(violations).toEqual([]);
  });
});
```

## 六、页面级 vs 组件级测试策略

### 6.1 测试金字塔

```text
无障碍测试金字塔:

        ┌─────────────┐
        │  E2E 全流程  │  ← 少量，覆盖关键用户路径
        │  (页面级)    │
        ├─────────────┤
        │  组件级测试  │  ← 中量，覆盖所有 UI 组件
        │  (axe + 手动)│
        ├─────────────┤
        │  静态分析    │  ← 大量，每次保存时运行
        │  (ESLint)    │
        └─────────────┘

各层工具:
┌──────────────┬─────────────────────────────────────┐
│ 层级         │ 工具                                 │
├──────────────┼─────────────────────────────────────┤
│ 静态分析     │ eslint-plugin-jsx-a11y               │
│              │ @angular-eslint/template-accessibility│
│              │ vue-a11y-checker                     │
├──────────────┼─────────────────────────────────────┤
│ 组件测试     │ @axe-core/react (单元测试)           │
│              │ Storybook + @storybook/addon-a11y    │
├──────────────┼─────────────────────────────────────┤
│ E2E 测试     │ Playwright + @axe-core/playwright    │
│              │ Cypress + cypress-axe                │
└──────────────┴─────────────────────────────────────┘
```

### 6.2 ESLint 静态分析

```json
// .eslintrc.json
{
  "plugins": ["jsx-a11y"],
  "extends": [
    "plugin:jsx-a11y/recommended"
  ],
  "rules": {
    "jsx-a11y/anchor-is-valid": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    "jsx-a11y/img-redundant-alt": "error",
    "jsx-a11y/label-has-associated-control": "error",
    "jsx-a11y/no-autofocus": "warn",
    "jsx-a11y/media-has-caption": "error"
  }
}
```

```tsx
// ❌ ESLint 会报错的代码
function BadComponent() {
  return (
    <div onClick={handleClick}>  {/* 缺少键盘事件 */}
      <img src="photo.jpg" />     {/* 缺少 alt */}
      <a onClick={handleNav}>     {/* <a> 缺少 href */}
        Click me
      </a>
    </div>
  );
}

// ✅ 修复后的代码
function GoodComponent() {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <img src="photo.jpg" alt="产品展示图片" />
      <a href="/products" onClick={handleNav}>
        查看产品
      </a>
    </div>
  );
}
```

### 6.3 Storybook a11y addon

```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = title: 'Components/Button',
  component: Button,
  parameters: {
    // axe-core 配置
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: true },
        ],
      },
      // 手动测试选项
      manual: false,
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// 每个 story 自动运行 axe 检查
export const Primary: Story = {
  args: {
    variant: 'primary',
    children: '提交订单',
  },
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: '已禁用',
  },
  parameters: {
    a11y: {
      // 禁用状态可以有特殊的 axe 配置
      config: {
        rules: [
          { id: 'color-contrast', enabled: false }, // 禁用状态对比度可放宽
        ],
      },
    },
  },
};

export const IconOnly: Story = {
  args: {
    'aria-label': '关闭对话框',
    icon: 'close',
  },
  parameters: {
    a11y: {
      // 确保 icon-only 按钮有 aria-label
      element: 'button',
    },
  },
};
```

## 七、CI 门禁集成

### 7.1 GitHub Actions 配置

```yaml
# .github/workflows/a11y.yml
name: Accessibility Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  
jobs:
  a11y-lint:
    name: ESLint a11y
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run ESLint a11y
        run: npx eslint --ext .ts,.tsx,.js,.jsx src/ --rule 'jsx-a11y/*: error'

  a11y-e2e:
    name: axe-core E2E Tests
    runs-on: ubuntu-latest
    needs: a11y-lint
    
    strategy:
      matrix:
        browser: [chromium, firefox, webkit]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps ${{ matrix.browser }}
      
      - name: Build application
        run: npm run build
        env:
          NODE_ENV: production
      
      - name: Start application
        run: npm run start &
        env:
          PORT: 3000
      
      - name: Wait for application
        run: npx wait-on http://localhost:3000 --timeout 60000
      
      - name: Run a11y tests
        run: npx playwright test --project=${{ matrix.browser }}
        env:
          CI: true
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: a11y-results-${{ matrix.browser }}
          path: |
            test-results/
            playwright-report/
          retention-days: 30
      
      - name: Comment PR with results
        if: github.event_name == 'pull_request' && failure()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let violations = [];
            try {
              const results = JSON.parse(fs.readFileSync('test-results/results.json', 'utf8'));
              violations = results.suites.flatMap(s => 
                s.specs.filter(sp => sp.ok === false).map(sp => sp.title)
              );
            } catch (e) {
              violations = ['Failed to parse results'];
            }
            
            const body = `## ♿ Accessibility Test Results
            
            ❌ **${violations.length} violations found**
            
            ${violations.map(v => `- ${v}`).join('\n')}
            
            Please fix accessibility issues before merging.`;
            
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: body,
            });

  a11y-report:
    name: Generate Report
    runs-on: ubuntu-latest
    needs: a11y-e2e
    if: always()
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Download all results
        uses: actions/download-artifact@v4
        with:
          path: all-results/
      
      - name: Generate consolidated report
        run: |
          node scripts/generate-a11y-report.js all-results/ > a11y-report.md
          cat a11y-report.md
      
      - name: Upload consolidated report
        uses: actions/upload-artifact@v4
        with:
          name: a11y-consolidated-report
          path: a11y-report.md
```

### 7.2 GitLab CI 配置

```yaml
# .gitlab-ci.yml
stages:
  - lint
  - test
  - report

variables:
  NODE_VERSION: "20"

a11y:lint:
  stage: lint
  image: node:${NODE_VERSION}
  script:
    - npm ci
    - npx eslint --ext .ts,.tsx src/ --rule 'jsx-a11y/*: error'
  artifacts:
    when: on_failure
    paths:
      - eslint-report.json

a11y:test:
  stage: test
  image: mcr.microsoft.com/playwright:v1.40.0-jammy
  parallel:
    matrix:
      - BROWSER: [chromium, firefox, webkit]
  script:
    - npm ci
    - npm run build
    - npm run start &
    - npx wait-on http://localhost:3000
    - npx playwright test --project=$BROWSER
  artifacts:
    when: always
    paths:
      - test-results/
      - playwright-report/
    expire_in: 30 days
  allow_failure: false  # a11y 测试失败 = MR 无法合并

a11y:report:
  stage: report
  image: node:${NODE_VERSION}
  script:
    - node scripts/generate-a11y-report.js test-results/ > report.md
  artifacts:
    paths:
      - report.md
  when: always
```

### 7.3 报告生成脚本

```javascript
// scripts/generate-a11y-report.js
const fs = require('fs');
const path = require('path');

function generateReport(resultsDir) {
  const results = [];
  
  // 读取所有测试结果
  const files = fs.readdirSync(resultsDir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
        results.push(data);
      } catch (e) {
        console.error(`Error reading ${file}:`, e.message);
      }
    }
  }
  
  // 生成报告
  let report = '# Accessibility Test Report\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  let totalViolations = 0;
  const violationSummary = {};
  
  for (const result of results) {
    if (result.violations) {
      totalViolations += result.violations.length;
      for (const v of result.violations) {
        if (!violationSummary[v.id]) {
          violationSummary[v.id] = {
            count: 0,
            impact: v.impact,
            description: v.description,
            helpUrl: v.helpUrl,
          };
        }
        violationSummary[v.id].count++;
      }
    }
  }
  
  report += `## Summary\n\n`;
  report += `| Metric | Count |\n`;
  report += `|--------|-------|\n`;
  report += `| Total Violations | ${totalViolations} |\n`;
  report += `| Unique Rules Violated | ${Object.keys(violationSummary).length} |\n\n`;
  
  if (totalViolations > 0) {
    report += `## Violations\n\n`;
    report += `| Rule | Impact | Count | Description |\n`;
    report += `|------|--------|-------|-------------|\n`;
    
    for (const [id, info] of Object.entries(violationSummary)) {
      report += `| [${id}](${info.helpUrl}) | ${info.impact} | ${info.count} | ${info.description} |\n`;
    }
  }
  
  return report;
}

const resultsDir = process.argv[2] || 'test-results';
console.log(generateReport(resultsDir));
```

## 八、常见 a11y 问题修复实战

### 8.1 颜色对比度

```text
WCAG 2.2 颜色对比度要求:
┌─────────────────┬─────────────┬─────────────┐
│ 文本类型        │ AA 级       │ AAA 级      │
├─────────────────┼─────────────┼─────────────┤
│ 普通文本        │ 4.5:1       │ 7:1         │
│ 大文本(≥18pt)   │ 3:1         │ 4.5:1       │
│ UI 组件         │ 3:1         │ 3:1         │
└─────────────────┴─────────────┴─────────────┘
```

```css
/* ❌ 对比度不足 */
.bad-text {
  color: #999999;          /* 灰色 */
  background: #ffffff;     /* 白色 */
  /* 对比度: 2.85:1 - 不达标 */
}

/* ✅ 修复后 */
.good-text {
  color: #595959;          /* 深灰色 */
  background: #ffffff;     /* 白色 */
  /* 对比度: 5.93:1 - 达标 */
}

/* 使用 CSS 变量系统管理颜色 */
:root {
  --text-primary: #1a1a1a;    /* 对比度 16.75:1 */
  --text-secondary: #595959;  /* 对比度 5.93:1 */
  --text-tertiary: #767676;   /* 对比度 4.54:1 - 刚好达标 */
  --text-disabled: #a0a0a0;   /* 对比度 2.58:1 - 需配合说明 */
}
```

### 8.2 表单无障碍

```html
<!-- ❌ 表单无障碍问题 -->
<form>
  <input type="email" placeholder="邮箱">  <!-- 无 label -->
  <select>                                   <!-- 无 label -->
    <option>选择国家</option>
  </select>
  <button>提交</button>
</form>

<!-- ✅ 修复后 -->
<form aria-labelledby="form-title">
  <h2 id="form-title">用户注册</h2>
  
  <div class="form-group">
    <label for="email">邮箱地址</label>
    <input
      type="email"
      id="email"
      name="email"
      aria-required="true"
      aria-describedby="email-hint email-error"
      autocomplete="email"
    >
    <span id="email-hint" class="hint">我们不会分享您的邮箱</span>
    <span id="email-error" class="error" role="alert" aria-live="assertive">
      <!-- JS 动态填充错误信息 -->
    </span>
  </div>
  
  <div class="form-group">
    <label for="country">国家/地区</label>
    <select id="country" name="country" aria-required="true">
      <option value="">请选择</option>
      <option value="CN">中国</option>
      <option value="US">美国</option>
    </select>
  </div>
  
  <button type="submit">提交注册</button>
</form>
```

### 8.3 动画与运动

```css
/* 尊重用户的减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* 提供动画控制按钮 */
.animation-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.animation-controls button {
  padding: 4px 12px;
  border: 2px solid currentColor;
  background: transparent;
}

.animation-controls button[aria-pressed="true"] {
  background: currentColor;
  color: white;
}
```

```javascript
// JavaScript 动画控制
class AnimationController {
  constructor() {
    this.isPlaying = true;
    this.toggleBtn = document.querySelector('#animation-toggle');
    
    // 检测系统偏好
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersReduced.matches) {
      this.pause();
    }
    
    // 监听偏好变化
    prefersReduced.addEventListener('change', (e) => {
      if (e.matches) this.pause();
    });
    
    this.toggleBtn?.addEventListener('click', () => {
      this.isPlaying ? this.pause() : this.play();
    });
  }
  
  play() {
    this.isPlaying = true;
    this.toggleBtn?.setAttribute('aria-pressed', 'false');
    this.toggleBtn?.textContent = '暂停动画';
    document.body.classList.remove('animations-paused');
  }
  
  pause() {
    this.isPlaying = false;
    this.toggleBtn?.setAttribute('aria-pressed', 'true');
    this.toggleBtn?.textContent = '播放动画';
    document.body.classList.add('animations-paused');
  }
}
```

## 九、辅助技术测试

### 9.1 屏幕阅读器测试清单

```text
屏幕阅读器测试矩阵:
┌─────────────────┬──────────────┬───────────────┬───────────────┐
│ 测试项          │ NVDA(Win)    │ VoiceOver(Mac)│ TalkBack(Android)│
├─────────────────┼──────────────┼───────────────┼───────────────┤
│ 页面导航        │ ✓            │ ✓             │ ✓             │
│ 表单填写        │ ✓            │ ✓             │ ✓             │
│ 弹窗/模态框     │ ✓            │ ✓             │ ✓             │
│ 动态内容更新    │ ✓            │ ✓             │ ✓             │
│ 表格数据读取    │ ✓            │ ✓             │ ✓             │
│ 图表/可视化     │ ✓            │ ✓             │ ✓             │
└─────────────────┴──────────────┴───────────────┴───────────────┘
```

### 9.2 模拟屏幕阅读器行为

```typescript
// tests/a11y/screen-reader.spec.ts
import { test, expect } from '@playwright/test';

test.describe('屏幕阅读器行为模拟', () => {
  test('页面标题和地标可被识别', async ({ page }) => {
    await page.goto('/');
    
    // 检查页面标题
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
    
    // 检查 landmark 区域
    const landmarks = await page.$$eval(
      '[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], header, nav, main, footer',
      elements => elements.map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'),
      }))
    );
    
    console.log('Landmarks:', landmarks);
    
    // 至少应该有 main landmark
    const hasMain = landmarks.some(l => 
      l.tag === 'MAIN' || l.role === 'main'
    );
    expect(hasMain).toBeTruthy();
  });

  test('跳过导航链接', async ({ page }) => {
    await page.goto('/');
    
    // 第一个 Tab 应该是 skip link
    await page.keyboard.press('Tab');
    
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName,
        text: el?.textContent?.trim(),
        href: el?.getAttribute('href'),
      };
    });
    
    // 应该是 "跳到主内容" 链接
    expect(focused.tag).toBe('A');
    expect(focused.text).toContain('跳');
    expect(focused.href).toBe('#main-content');
    
    // 按 Enter 跳转
    await page.keyboard.press('Enter');
    
    const mainFocused = await page.evaluate(() => {
      return document.activeElement?.id === 'main-content' ||
             document.activeElement?.closest('main') !== null;
    });
    expect(mainFocused).toBeTruthy();
  });

  test('动态内容通过 aria-live 通知', async ({ page }) => {
    await page.goto('/dashboard');
    
    // 检查是否有 aria-live 区域
    const liveRegions = await page.$$('[aria-live]');
    expect(liveRegions.length).toBeGreaterThan(0);
    
    // 触发一个动态更新
    await page.click('#refresh-data');
    
    // 等待更新
    await page.waitForTimeout(1000);
    
    // 检查 live region 是否有内容
    const liveContent = await page.$eval(
      '[aria-live="polite"]',
      el => el.textContent?.trim()
    );
    expect(liveContent).toBeTruthy();
  });
});
```

## 十、企业级 a11y 治理

### 10.1 渐进式落地策略

```text
无障碍成熟度模型:

Level 0: 无意识
├── 无 a11y 测试
├── 无 a11y 培训
└── 无 a11y 政策

Level 1: 基础合规
├── ESLint a11y 规则
├── 基础 axe 测试
└── 关键页面修复

Level 2: 系统化
├── CI 门禁集成
├── 组件库 a11y 审计
├── 团队培训
└── 测试覆盖率 > 80%

Level 3: 文化融入
├── a11y Champion 制度
├── 用户测试（含残障用户）
├── 持续监控
└── 自动化回归

Level 4: 领先实践
├── 超越 WCAG AA
├── 开源贡献
├── 行业标准参与
└── a11y 创新
```

### 10.2 团队协作流程

```text
开发流程中的 a11y 检查点:

┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 设计阶段 │───→│ 开发阶段 │───→│ 测试阶段 │───→│ 发布阶段 │
│         │    │         │    │         │    │         │
│ •色彩对比│    │ •ESLint │    │ •axe扫描│    │ •CI门禁 │
│ •交互设计│    │ •组件审查│    │ •键盘测试│    │ •监控告警│
│ •标注说明│    │ •Storybook│   │ •SR测试 │    │ •用户反馈│
└─────────┘    └─────────┘    └─────────┘    └─────────┘
```

## 十一、总结

### 核心要点

```text
┌─────────────────────────────────────────────────────────┐
│ a11y 自动化测试关键要点                                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 1. 工具链选择                                            │
│    - 静态: ESLint + jsx-a11y                             │
│    - 组件: Storybook + a11y addon                        │
│    - E2E: Playwright + axe-core                          │
│                                                          │
│ 2. 测试策略                                              │
│    - 每次 PR: axe-core 扫描 + CI 门禁                    │
│    - 每周: 键盘导航测试                                  │
│    - 每月: 屏幕阅读器测试                                │
│    - 每季: 用户测试（含残障用户）                         │
│                                                          │
│ 3. WCAG 2.2 重点关注                                     │
│    - 焦点管理 (Focus Not Obscured)                       │
│    - 触摸目标 (Target Size)                              │
│    - 认证辅助 (Accessible Authentication)                 │
│                                                          │
│ 4. 企业落地                                              │
│    - 从关键页面开始                                      │
│    - 建立组件库无障碍标准                                │
│    - 培养 a11y Champion                                  │
│    - 持续监控和改进                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 行动清单

1. **立即行动**：在项目中添加 `@axe-core/playwright`，为首页编写第一个 a11y 测试
2. **本周完成**：配置 ESLint jsx-a11y 规则，修复现有违规
3. **本月完成**：CI 门禁集成，确保新 PR 不引入 a11y 问题
4. **本季完成**：关键用户路径全部覆盖 a11y 测试，开始屏幕阅读器测试

无障碍不是一次性工程，而是持续改进的过程。从自动化测试开始，逐步建立完整的无障碍保障体系，让每个人都能平等地访问你的 Web 应用。

## 相关阅读

- [Web 无障碍 (WCAG 2.2) 实战：Vue 3 项目的 a11y 治理——语义化、键盘导航与屏幕阅读器适配](/categories/前端/Web-无障碍-WCAG-2.2-实战-Vue3-a11y-治理-语义化-键盘导航与屏幕阅读器适配/)
- [Playwright 实战：跨浏览器 E2E 测试——Laravel 应用的可视化回归、网络拦截与 CI 并行执行踩坑记录](/categories/前端/Playwright-实战-跨浏览器E2E测试-Laravel应用的可视化回归网络拦截与CI并行执行踩坑记录/)
- [AI Agent 自动化测试实战：测试用例生成、执行、结果分析闭环](/categories/前端/AI-Agent-自动化测试实战-测试用例生成-执行-结果分析闭环/)
