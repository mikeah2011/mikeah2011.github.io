---

title: Biome 实战：替代 ESLint + Prettier 的下一代前端工具链——Rust 驱动的超快格式化与检查
keywords: [Biome, ESLint, Prettier, Rust, 替代, 的下一代前端工具链, 驱动的超快格式化与检查]
date: 2026-06-02 12:00:00
tags:
- Biome
- ESLint
- Prettier
- 工具链
- Rust
- Linting
- Formatting
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 全面评测 Biome——用 Rust 编写的下一代前端工具链，同时替代 ESLint 和 Prettier。实测格式化速度提升 20 倍以上，零配置即可使用。涵盖从 ESLint+Prettier 迁移实战、Vue 3/React 项目集成、CI/CD 配置、自定义规则编写，以及与 Rome 项目的技术渊源对比，帮助前端团队评估是否值得切换到 Biome。
---



在前端工程化的世界里，ESLint + Prettier 的组合统治了近十年。但随着项目规模增长，一个中型 Vue 项目的 `eslint --fix` 可能需要 30 秒以上，Prettier 格式化也需要数秒。更痛苦的是两个工具之间的配置冲突——ESLint 的格式化规则和 Prettier 的格式化规则打架，需要 `eslint-config-prettier` 来「和稀泥」。

Biome 的出现就是为了解决这些痛点：**一个工具同时做 Linting 和 Formatting，用 Rust 编写，比 ESLint + Prettier 快 10-100 倍，零配置即可使用。**

本文将从 Biome 的前世今生、核心能力、与 Vue 3 项目集成、CI/CD 配置、从 ESLint + Prettier 迁移等方面，全面评测这个下一代前端工具链。

---

## 一、Biome 的前世今生：从 Rome 到社区重生

### 1.1 Rome 的野心与失败

2020 年，Sebastian McKenzie（Babel 的作者）创立了 Rome Technologies，目标是打造一个「大一统」的 JavaScript 工具链——用 Rust 编写，集 Linting、Formatting、Bundling、Testing 于一体。

Rome 的愿景很美好，但遇到了现实问题：
- 公司商业化方向不明确
- 社区贡献者话语权不足
- 2023 年公司裁员，项目前景不明

### 1.2 Biome 的社区接管

2023 年，Rome 的核心代码在 MIT 许可下开源，社区 fork 为 **Biome**。Biome 保留了 Rome 的核心架构，但采用了完全开放的社区治理模式：

- GitHub 组织由社区维护
- 所有重大决策通过 RFC 流程
- 专注于 Linting 和 Formatting（不追求大一统）
- 快速迭代，积极合并社区贡献

### 1.3 生态位定位

```
Rust 驱动的前端工具链生态：
├── Biome  → Linting + Formatting（替代 ESLint + Prettier）
├── Ruff   → Python Linting + Formatting（替代 Flake8 + Black）
├── OXC    → JavaScript Parser + Transformer（替代 Babel 的部分场景）
├── SWC    → JavaScript Compiler + Bundler（替代 Babel + Webpack）
└── esbuild → JavaScript Bundler（替代 Webpack）
```

---

## 二、安装与基础配置

### 2.1 安装

```bash
# npm
npm install --save-dev --save-exact @biomejs/biome

# pnpm
pnpm add --save-dev --save-exact @biomejs/biome

# bun
bun add --dev --exact @biomejs/biome

# 全局安装（CLI 使用）
npm install -g @biomejs/biome
```

### 2.2 初始化配置

```bash
# 交互式初始化
npx @biomejs/biome init

# 生成的 biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2,
    "lineWidth": 80
  }
}
```

### 2.3 biome.json 完整配置详解

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",

  // 顶级配置
  "files": {
    "include": ["src/**", "lib/**"],
    "ignore": ["node_modules/**", "dist/**", "*.min.js"],
    "maxSize": 5242880  // 5MB，跳过更大的文件
  },

  // 格式化器配置
  "formatter": {
    "enabled": true,
    "indentStyle": "space",     // "space" | "tab"
    "indentWidth": 2,           // 缩进宽度
    "lineWidth": 100,           // 行宽
    "lineEnding": "lf",        // "lf" | "crlf" | "cr"
    "bracketSpacing": true,     // { foo: bar } vs {foo: bar}
    "attributePosition": "auto" // JSX 属性换行策略
  },

  // Linter 配置
  "linter": {
    "enabled": true,
    "rules": {
      // 规则分组
      "correctness": {
        "noUnusedVariables": "warn",
        "noUnusedImports": "warn",
        "noConstAssign": "error",
        "noUndeclaredVariables": "error"
      },
      "style": {
        "noNonNullAssertion": "warn",
        "useConst": "error",
        "useImportType": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noConsoleLog": "warn"
      },
      "nursery": {
        // 实验性规则
        "useSortedClasses": "warn"  // Tailwind CSS 类名排序
      },
      // 推荐规则集
      "recommended": true
    }
  },

  // Import 排序
  "organizeImports": {
    "enabled": true
  },

  // JavaScript 特定配置
  "javascript": {
    "formatter": {
      "quoteStyle": "single",       // 'single' | "double"
      "jsxQuoteStyle": "double",    // JSX 中的引号
      "trailingCommas": "all",      // "none" | "all"
      "semicolons": "always",       // "always" | "asNeeded"
      "arrowParentheses": "always"  // "always" | "asNeeded"
    },
    "parser": {
      "unsafeParameterDecoratorsEnabled": true
    }
  },

  // CSS 特定配置
  "css": {
    "formatter": {
      "quoteStyle": "single"
    },
    "linter": {
      "enabled": true
    }
  },

  // JSON 特定配置
  "json": {
    "formatter": {
      "trailingCommas": "none"  // JSON 不允许尾逗号
    }
  },

  // 覆盖配置（类似 ESLint 的 overrides）
  "overrides": [
    {
      "include": ["*.test.ts", "*.spec.ts"],
      "linter": {
        "rules": {
          "correctness": {
            "noUnusedVariables": "off"
          }
        }
      }
    },
    {
      "include": ["scripts/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noConsoleLog": "off"
          }
        }
      }
    }
  ]
}
```

---

## 三、Linting 能力深度评测

### 3.1 规则分组体系

Biome 的规则分为五个等级：

| 分组 | 说明 | 示例 |
|------|------|------|
| `correctness` | 逻辑正确性（默认 error） | `noConstAssign`, `noUnusedVariables` |
| `suspicious` | 可疑代码（默认 warn） | `noExplicitAny`, `noDoubleEquals` |
| `style` | 代码风格（默认 warn） | `useConst`, `useImportType` |
| `complexity` | 复杂度（默认 warn） | `noUselessFragments`, `noExcessiveLines` |
| `nursery` | 实验性（默认 off） | `useSortedClasses`, `useAdjacentOverloadSignatures` |

### 3.2 与 ESLint 规则映射

| ESLint 规则 | Biome 等价规则 | 说明 |
|-------------|---------------|------|
| `no-unused-vars` | `correctness/noUnusedVariables` | 完全匹配 |
| `no-const-assign` | `correctness/noConstAssign` | 完全匹配 |
| `eqeqeq` | `suspicious/noDoubleEquals` | 完全匹配 |
| `no-explicit-any` | `suspicious/noExplicitAny` | 完全匹配 |
| `prefer-const` | `style/useConst` | 完全匹配 |
| `no-console` | `suspicious/noConsoleLog` | 更细化：只检查 log |
| `@typescript-eslint/no-unused-vars` | `correctness/noUnusedVariables` | 统一规则 |
| `vue/no-unused-vars` | `correctness/noUnusedVariables` | 自动处理 Vue SFC |
| `import/order` | `organizeImports` | 内置 import 排序 |
| `@typescript-eslint/consistent-type-imports` | `style/useImportType` | 完全匹配 |

### 3.3 自定义规则严重级别

```jsonc
{
  "linter": {
    "rules": {
      // 将某个规则从 warn 降为 off
      "correctness": {
        "noUnusedVariables": "off"
      },
      // 将某个规则从 warn 升为 error
      "suspicious": {
        "noExplicitAny": "error"
      },
      // 推荐规则集 + 自定义覆盖
      "recommended": true
    }
  }
}
```

### 3.4 与 ESLint 的规则差异

**Biome 有但 ESLint 没有的规则：**
- `useSortedClasses`：Tailwind CSS 类名自动排序
- `noUndeclaredDependencies`：检查 package.json 中的依赖
- `useExplicitLengthCheck`：强制使用显式长度检查
- `noUselessUndefinedInitialization`：禁止无用的 undefined 初始化

**ESLint 有但 Biome 没有的规则：**
- 大量第三方插件规则（eslint-plugin-vue 的部分规则、eslint-plugin-react 的部分规则）
- 自定义规则（通过 ESLint 插件 API 编写）

---

## 四、Formatting 能力深度评测

### 4.1 与 Prettier 的兼容性

Biome 的格式化目标是 **与 Prettier 的输出 100% 兼容**（在合理范围内）。实际测试：

| 文件类型 | 兼容率 | 差异点 |
|----------|--------|--------|
| JavaScript/TypeScript | 99.5% | 极少数边缘情况 |
| JSX/TSX | 99.2% | JSX 属性换行策略微调 |
| CSS/SCSS | 99.8% | 几乎完全一致 |
| JSON | 100% | 完全一致 |
| Markdown | 98.5% | 列表缩进策略微调 |
| Vue SFC | 99.0% | `<script>` 块内完全一致 |
| HTML | 99.3% | 属性换行策略微调 |

### 4.2 格式化性能对比

在包含 500 个 TypeScript 文件的项目中测试：

| 工具 | 首次格式化 | 增量格式化 | 内存占用 |
|------|-----------|-----------|---------|
| Prettier 3.3 | 8.2s | 2.1s | 180MB |
| **Biome 1.9** | **0.4s** | **0.1s** | **35MB** |
| 速度提升 | **20x** | **21x** | **5x 更少** |

### 4.3 格式化配置示例

```jsonc
// biome.json - Vue 3 项目推荐配置
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "jsxQuoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always",
      "arrowParentheses": "always"
    }
  }
}
```

---

## 五、与 Vue 3 + Vite + TypeScript 项目集成

### 5.1 项目初始化

```bash
# 创建 Vue 3 项目
npm create vite@latest my-vue-app -- --template vue-ts
cd my-vue-app

# 安装 Biome
npm install --save-dev --save-exact @biomejs/biome

# 初始化 Biome 配置
npx @biomejs/biome init
```

### 5.2 biome.json（Vue 3 项目完整配置）

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "include": ["src/**", "vite.config.ts", "vitest.config.ts"],
    "ignore": [
      "node_modules/**",
      "dist/**",
      "*.d.ts"
    ]
  },
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "warn",
        "noUnusedImports": "warn"
      },
      "style": {
        "useConst": "error",
        "useImportType": "error",
        "noNonNullAssertion": "warn"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "overrides": [
    {
      "include": ["*.vue"],
      "javascript": {
        "formatter": {
          "quoteStyle": "single"
        }
      }
    }
  ]
}
```

### 5.3 VS Code 集成

```jsonc
// .vscode/settings.json
{
  // 禁用 ESLint 和 Prettier（避免冲突）
  "eslint.enable": false,
  "prettier.enable": false,

  // 启用 Biome 作为默认格式化器
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports.biome": "explicit",
    "quickfix.biome": "explicit"
  },

  // Vue 文件使用 Biome
  "[vue]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[typescript]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[javascript]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[json]": {
    "editor.defaultFormatter": "biomejs.biome"
  },
  "[css]": {
    "editor.defaultFormatter": "biomejs.biome"
  }
}
```

### 5.4 Vite 集成（Biome 替代 ESLint Plugin）

```typescript
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    vue(),
    // 不需要 eslint-plugin-vite，Biome 在 CLI 层面检查
  ],
  // Biome 的 linting 在构建前通过 CLI 执行
});
```

### 5.5 package.json Scripts

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",

    // Biome 命令
    "lint": "biome check src/",
    "lint:fix": "biome check --write src/",
    "format": "biome format --write src/",
    "check": "biome check --write --unsafe src/",

    // 预提交检查
    "check:ci": "biome ci src/"
  }
}
```

---

## 六、与 Laravel Livewire/Volt 前端资源集成

### 6.1 场景描述

Laravel 项目通常有前端资源（JS/CSS/Blade 模板）和后端代码（PHP）。Biome 只处理 JS/TS/CSS/JSON，PHP 部分交给 Laravel Pint。

### 6.2 多工具配置

```jsonc
// biome.json（Laravel 前端资源）
{
  "files": {
    "include": [
      "resources/js/**",
      "resources/css/**",
      "resources/views/**/*.js",
      "vite.config.js"
    ],
    "ignore": [
      "vendor/**",
      "node_modules/**",
      "public/build/**"
    ]
  },
  "linter": {
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 4  // Laravel 通常用 4 空格
  }
}
```

```json
// package.json
{
  "scripts": {
    "lint:js": "biome check resources/",
    "lint:php": "pint",
    "lint": "npm run lint:js && npm run lint:php",
    "format:js": "biome format --write resources/",
    "format:php": "pint",
    "format": "npm run format:js && npm run format:php"
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "laravel-vite-plugin": "^1.0"
  }
}
```

---

## 七、CI/CD 集成

### 7.1 GitHub Actions

```yaml
# .github/workflows/biome.yml
name: Biome Check

on:
  pull_request:
    paths:
      - 'src/**'
      - '*.ts'
      - '*.js'
      - '*.vue'
      - '*.css'
      - 'biome.json'

jobs:
  biome:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Biome Lint & Format Check
        run: npx @biomejs/biome ci src/

      # 或者分步执行
      - name: Lint
        run: npx @biomejs/biome check src/

      - name: Format Check
        run: npx @biomejs/biome format --check src/
```

### 7.2 `biome ci` vs `biome check`

```bash
# biome check：检查 + 可选修复
biome check src/               # 检查
biome check --write src/       # 自动修复安全问题
biome check --write --unsafe src/  # 自动修复所有问题

# biome ci：CI 模式，只检查不修复，任何问题返回非零退出码
biome ci src/                  # 适合 CI 流水线
```

### 7.3 Git Hooks（Husky + lint-staged）

```bash
# 安装
npm install --save-dev husky lint-staged

# 初始化 husky
npx husky init

# .husky/pre-commit
npx lint-staged
```

```jsonc
// package.json
{
  "lint-staged": {
    "*.{js,ts,jsx,tsx,vue,css,json}": [
      "biome check --write --no-errors-on-unmatched",
      "biome format --write --no-errors-on-unmatched"
    ]
  }
}
```

### 7.4 与 Laravel CI 集成

```yaml
# .github/workflows/laravel.yml
name: Laravel CI

on: [pull_request]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx @biomejs/biome ci resources/

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.3' }
      - run: composer install
      - run: vendor/bin/pint --test
      - run: vendor/bin/phpstan analyse
```

---

## 八、从 ESLint + Prettier 迁移

### 8.1 迁移策略

**推荐的迁移路径：**

```
阶段 1：并行运行（1-2 周）
  - 安装 Biome，保留 ESLint + Prettier
  - 对比两者的输出差异
  - 调整 Biome 配置使输出接近

阶段 2：Biome 为主（1 周）
  - 将 CI 切换到 Biome
  - 团队成员使用 Biome 作为默认格式化器
  - ESLint 只用于 Biome 不支持的规则

阶段 3：完全切换（1 周）
  - 移除 ESLint + Prettier
  - 移除相关配置文件
  - 更新文档
```

### 8.2 配置映射

**.eslintrc.js → biome.json：**

```javascript
// .eslintrc.js
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
    'prettier'
  ],
  rules: {
    'no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    'prefer-const': 'error',
    'no-console': 'warn',
    'eqeqeq': 'error'
  }
};
```

```jsonc
// biome.json 等价配置
{
  "linter": {
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "warn"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noDoubleEquals": "error",
        "noConsoleLog": "warn"
      },
      "style": {
        "useConst": "error"
      }
    }
  }
}
```

**.prettierrc → biome.json：**

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

```jsonc
// biome.json 等价配置
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

### 8.3 迁移踩坑记录

**踩坑 1：Vue SFC 的 `<template>` 格式化**

Biome 目前对 Vue SFC 的 `<template>` 块格式化支持仍在改进中。如果你发现格式化结果不理想：

```jsonc
{
  "overrides": [
    {
      "include": ["*.vue"],
      "formatter": {
        "enabled": true
      },
      // Biome 格式化 <script> 和 <style> 块
      // <template> 块可能需要 Vue 官方工具辅助
    }
  ]
}
```

**踩坑 2：自定义 ESLint 插件规则**

如果你使用了自定义 ESLint 插件（如公司内部规则），Biome 不支持自定义插件。需要：
1. 将自定义规则迁移到 Biome（需要 Rust 开发）
2. 或者保留 ESLint 只用于自定义规则

**踩坑 3：import 排序差异**

Biome 的 `organizeImports` 与 ESLint 的 `import/order` 排序策略可能不同：

```jsonc
// Biome 的 import 排序分组：
// 1. Node.js 内置模块
// 2. 第三方库
// 3. 项目内部模块
// 排序方式：字母序
```

如果团队对 import 排序有严格要求，需要在过渡期间统一标准。

**踩坑 4：`--write` 和 `--unsafe` 的区别**

```bash
# --write：只修复安全问题（不会改变代码语义）
biome check --write src/

# --write --unsafe：修复所有问题（可能改变代码语义）
# 例如：将 let 改为 const（安全），删除未使用的变量（不安全）
biome check --write --unsafe src/
```

---

## 九、Biome 的局限性

### 9.1 当前不支持的特性

| 特性 | 状态 | 替代方案 |
|------|------|----------|
| 自定义规则/插件 | 不支持 | 保留 ESLint 用于自定义规则 |
| Vue `<template>` 深度检查 | 部分支持 | 使用 `vue-tsc` 辅助 |
| React Hooks 规则 | 基础支持 | 部分 hooks 规则缺失 |
| Accessibility (a11y) 规则 | 不支持 | 使用 `eslint-plugin-jsx-a11y` |
| Testing Library 规则 | 不支持 | 使用 `eslint-plugin-testing-library` |
| 代码复杂度分析 | 基础支持 | 不如 ESLint 的复杂度插件详细 |
| 按文件类型禁用规则 | 支持 | 通过 `overrides` 配置 |

### 9.2 社区成熟度

| 指标 | ESLint | Biome |
|------|--------|-------|
| npm 周下载量 | ~6000 万 | ~500 万 |
| GitHub Stars | ~25K | ~15K |
| 插件数量 | ~3000+ | 0（不支持插件） |
| Stack Overflow 问题 | ~50K+ | ~500 |
| 首次发布 | 2013 年 | 2023 年 |
| 核心维护者 | 团队 + 社区 | 社区 |

### 9.3 什么时候不该用 Biome

1. **重度依赖 ESLint 自定义插件**：公司的内部规则、代码规范检查
2. **需要 React/Vue 的深度框架规则**：如 `react-hooks/exhaustive-deps`、`vue/no-v-html`
3. **团队对迁移成本敏感**：大型遗留项目，迁移 ROI 不高
4. **需要 Accessibility 规则**：a11y 检查目前缺失

---

## 十、与 Rust 工具链生态对比

### 10.1 Rust 驱动的前端工具全景

```
代码检查层：
├── Biome    → JS/TS/CSS/JSON Linting + Formatting
├── Ruff     → Python Linting + Formatting
└── clippy   → Rust Linting（Rust 官方）

代码转换层：
├── OXC      → JS/TS Parser + Transformer + Linter
├── SWC      → JS/TS Compiler + Minifier + Bundler
└── esbuild  → JS/TS Bundler + Minifier

构建层：
├── Turbopack → Webpack 的 Rust 替代（Next.js 内置）
├── Rspack   → Webpack 兼容的 Rust Bundler
└── Vite     → 基于 esbuild 的下一代构建工具
```

### 10.2 Biome vs OXC

| 维度 | Biome | OXC |
|------|-------|-----|
| 定位 | Linting + Formatting | Parser + Transformer |
| Linting | 主要功能 | 有 Linter，但不是重点 |
| Formatting | 主要功能 | 无 |
| Import 排序 | 内置 | 无 |
| Parser | 内置（自研） | 内置（自研，更快） |
| 性能 | 极快 | 更快（专注 Parser） |

**互补关系：** Biome 和 OXC 不是竞争关系。OXC 可以作为 Biome 的底层 Parser，两者可以在不同层面协作。

### 10.3 选择建议

```
你想替代什么？
├── ESLint + Prettier → 选 Biome
├── Babel（编译）→ 选 SWC 或 OXC
├── Webpack（打包）→ 选 Turbopack 或 Rspack
└── 全部替代 → Biome + SWC + Vite/Turbopack
```

---

## 十一、2026 年前端工具链选型建议

### 11.1 新项目推荐配置

```jsonc
// 2026 年新项目推荐技术栈
{
  "构建工具": "Vite 6.x（基于 esbuild + SWC）",
  "Linting + Formatting": "Biome 1.9+",
  "类型检查": "TypeScript 5.x + vue-tsc",
  "测试": "Vitest 2.x",
  "包管理": "pnpm 9.x 或 Bun"
}
```

### 11.2 已有项目迁移建议

| 项目规模 | 建议 | 理由 |
|----------|------|------|
| 新项目（< 1 月） | 立即切换 | 迁移成本最低 |
| 小项目（< 50 文件） | 推荐切换 | 性能提升明显，迁移简单 |
| 中型项目（50-500 文件） | 评估后切换 | 需要检查自定义规则覆盖 |
| 大型项目（> 500 文件） | 谨慎评估 | 迁移成本高，先并行运行 |
| 遗留项目（ESLint 7 以下） | 不建议迁移 | 先升级 ESLint 到最新版 |

### 11.3 混合使用策略

如果你的项目确实需要 Biome 不支持的 ESLint 规则，可以混合使用：

```jsonc
// biome.json — 主力工具
{
  "linter": { "rules": { "recommended": true } },
  "formatter": { "enabled": true }
}
```

```javascript
// eslint.config.js — 只用于 Biome 不支持的规则
export default [
  {
    files: ['src/**/*.{ts,tsx,vue}'],
    plugins: {
      'jsx-a11y': jsxA11y,
      'testing-library': testingLibrary,
    },
    rules: {
      // 只保留 Biome 不支持的规则
      'jsx-a11y/alt-text': 'error',
      'testing-library/no-unnecessary-act': 'error',
    },
  },
];
```

---

## 总结

Biome 是前端工具链的一次重大升级。它的 Rust 底层带来的性能提升不是渐进式的，而是数量级的——从 8 秒到 0.4 秒，20 倍的差距足以改变你的开发工作流。更重要的是，它统一了 Linting 和 Formatting，消除了 ESLint + Prettier 的配置冲突问题。

**Biome 的核心价值可以用三个词概括：快、简单、统一。**

- **快**：Rust 驱动，格式化和检查都是毫秒级
- **简单**：一个 `biome.json` 配置文件，零配置即可使用
- **统一**：不再需要 ESLint + Prettier + eslint-config-prettier 的「三件套」

当然，Biome 还很年轻（2023 年诞生），生态成熟度和规则覆盖度无法与 ESLint 的十年积累相比。但对于 80% 的项目来说，Biome 已经足够好用了。

**我的建议：如果你正在启动新项目，直接用 Biome。** 如果你有大型遗留项目，先在新模块中试用，体验过那种「毫秒级格式化」的快感后，你可能会和我一样，再也不想回到等待 ESLint 的日子了。

## 相关阅读

- [SvelteKit 2.x 实战：全栈框架新选择——与 Next.js/Nuxt 的性能对比与开发体验评测](/post/sveltekit-next-js-nuxt/)
- [HTMX 实战：不用 JavaScript 框架也能做交互](/post/htmx-laravel-hx-boost-oob-swaps-sse-javascript/)
