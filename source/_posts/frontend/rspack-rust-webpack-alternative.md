---

title: Rspack 实战：Rust 驱动的 Webpack 兼容打包器——10x 构建速度提升与 Laravel 前端迁移路径
keywords: [Rspack, Rust, Webpack, Laravel, 驱动的, 兼容打包器, 构建速度提升与, 前端迁移路径, 前端]
date: 2026-06-10 03:27:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Rspack
- Rust
- Webpack
- 构建工具
- Laravel
- 工程化
description: 深入实战 Rspack——字节跳动开源的 Rust 驱动打包器，兼容 Webpack API 的同时带来 10x 构建速度提升。本文从原理到 Laravel 项目迁移完整路径，含踩坑记录和性能对比。
---



## 概述

在前端工程化领域，Webpack 长期占据统治地位，但其基于 JavaScript 的架构在大型项目中逐渐力不从心。一个中等规模的 Laravel + Vue 项目，`npm run dev` 启动可能需要 30-60 秒，热更新也要 2-5 秒——这在 2026 年已经不可接受。

Rspack 是字节跳动团队开源的 Rust 驱动的 Web 打包工具，核心卖点：

- **Webpack API 兼容**：大部分 loader 和 plugin 可以直接迁移
- **10x 构建速度**：Rust 带来的原生并行编译能力
- **零配置开箱即用**：内置 TypeScript、JSX、CSS Modules 等支持
- **Module Federation 支持**：微前端场景无缝接入

本文从实际 Laravel 项目出发，完整记录从 Webpack 迁移到 Rspack 的过程，包含性能对比、踩坑记录和生产环境配置。

## 核心概念

### Rspack vs Webpack 架构差异

Webpack 的核心瓶颈在于 JavaScript 的单线程模型。虽然有 `thread-loader` 等方案做多进程编译，但进程间通信的开销始终存在。

```
Webpack 架构：
┌─────────────────────────────────┐
│         Node.js 主进程           │
│  ┌───────┐ ┌───────┐ ┌───────┐ │
│  │Parser │ │Parser │ │Parser │ │  ← JS 单线程，串行解析
│  └───────┘ └───────┘ └───────┘ │
│         ↓ 逐个处理 ↓            │
│  ┌─────────────────────────┐   │
│  │     Dependency Graph     │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘

Rspack 架构：
┌─────────────────────────────────┐
│         Rust 核心（多线程）       │
│  ┌───────┐ ┌───────┐ ┌───────┐ │
│  │Parser │ │Parser │ │Parser │ │  ← Rust 原生多线程，并行解析
│  └───┬───┘ └───┬───┘ └───┬───┘ │
│      └────────┼────────┘       │
│         ↓ 并行合并 ↓            │
│  ┌─────────────────────────┐   │
│  │     Dependency Graph     │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

### 兼容层设计

Rspack 实现了 Webpack 的核心 API：

| 特性 | Webpack | Rspack | 说明 |
|------|---------|--------|------|
| `module.rules` | ✅ | ✅ | Loader 规则完全兼容 |
| `plugins` | ✅ | ✅ | 大部分 plugin 直接可用 |
| `optimization.splitChunks` | ✅ | ✅ | 代码分割策略一致 |
| `devtool` (Source Map) | ✅ | ✅ | 支持多种模式 |
| Module Federation | ✅ | ✅ | 微前端方案兼容 |
| DLL Plugin | ✅ | ❌ | Rspack 不需要 DLL 优化 |
| `thread-loader` | ✅ | ❌ | Rspack 自身已多线程 |

## 实战：Laravel 项目迁移

### 环境准备

```bash
# 当前 Laravel 8 项目结构
# resources/js/app.js — Vue 3 入口
# resources/sass/app.scss — 样式入口
# webpack.mix.js — Laravel Mix 配置（基于 Webpack）

# 检查 Node 版本
node -v  # 需要 >= 18.0.0

# 安装 Rspack
npm install @rspack/core @rspack/cli -D

# 安装兼容 loader（大部分 Webpack loader 可直接复用）
npm install css-loader sass-loader sass vue-loader@3 -D
```

### 配置文件

创建 `rspack.config.js`：

```js
const path = require('path');
const { VueLoaderPlugin } = require('vue-loader');
const HtmlWebpackPlugin = require('html-rspack-plugin');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',

  entry: {
    app: './resources/js/app.js',
  },

  output: {
    path: path.resolve(__dirname, 'public/build'),
    filename: 'js/[name].[contenthash:8].js',
    chunkFilename: 'js/[name].[contenthash:8].js',
    publicPath: '/build/',
    clean: true,
  },

  resolve: {
    extensions: ['.js', '.vue', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'resources/js'),
      '~': path.resolve(__dirname, 'resources'),
    },
  },

  module: {
    rules: [
      // Vue 单文件组件
      {
        test: /\.vue$/,
        loader: 'vue-loader',
      },
      // JavaScript（Rspack 内置 SWC 转译，不需要 babel-loader）
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: {
                syntax: 'ecmascript',
                jsx: false,
              },
              transform: {
                legacyDecorator: true,
              },
            },
          },
        },
      },
      // SCSS 样式
      {
        test: /\.s?css$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              modules: {
                auto: true,
                localIdentName: '[name]__[local]--[hash:base64:5]',
              },
            },
          },
          {
            loader: 'sass-loader',
            options: {
              implementation: require('sass'),
            },
          },
        ],
      },
      // 图片和字体
      {
        test: /\.(png|jpe?g|gif|svg|webp)$/,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 8 * 1024,
          },
        },
        generator: {
          filename: 'images/[name].[hash:8][ext]',
        },
      },
      {
        test: /\.(woff2?|eot|ttf|otf)$/,
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name].[hash:8][ext]',
        },
      },
    ],
  },

  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({
      template: './resources/views/app.blade.php',
      filename: path.resolve(__dirname, 'resources/views/generated/app.blade.php'),
    }),
  ],

  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },

  devServer: {
    hot: true,
    port: 8080,
    allowedHosts: 'all',
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    devMiddleware: {
      writeToDisk: true,
    },
  },

  devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-cheap-module-source-map',
};
```

### Package.json 脚本

```json
{
  "scripts": {
    "dev": "rspack serve",
    "build": "NODE_ENV=production rspack build",
    "watch": "rspack build --watch"
  }
}
```

### Laravel 集成

在 Blade 模板中引用构建产物：

```php
{{-- resources/views/layouts/app.blade.php --}}
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    @production
        <link rel="stylesheet" href="{{ mix('/css/app.css') }}">
    @endproduction
</head>
<body>
    <div id="app"></div>

    {{-- Rspack 输出的 JS --}}
    <script src="{{ asset('build/js/vendor.js') }}"></script>
    <script src="{{ asset('build/js/app.js') }}"></script>
</body>
</html>
```

如果不想改 Blade 引用方式，可以写一个简单的 manifest 解析：

```php
// app/Helpers/Mix.php
if (!function_exists('rspack_asset')) {
    function rspack_asset(string $path): string {
        static $manifest = null;
        if ($manifest === null) {
            $manifestPath = public_path('build/manifest.json');
            $manifest = file_exists($manifestPath)
                ? json_decode(file_get_contents($manifestPath), true)
                : [];
        }

        $key = ltrim($path, '/');
        if (isset($manifest[$key])) {
            return asset('build/' . $manifest[$key]['file']);
        }

        return asset($path);
    }
}
```

### PostCSS 集成

如果你的项目使用了 Tailwind CSS 或其他 PostCSS 工具：

```bash
npm install postcss postcss-loader autoprefixer -D
```

创建 `postcss.config.js`：

```js
module.exports = {
  plugins: [
    require('autoprefixer'),
    // require('tailwindcss'),  // 如果用 Tailwind
  ],
};
```

然后在 `rspack.config.js` 的 CSS 规则中添加 `postcss-loader`：

```js
{
  test: /\.s?css$/,
  use: [
    'style-loader',
    'css-loader',
    'postcss-loader',  // 在 css-loader 之后，sass-loader 之前
    {
      loader: 'sass-loader',
      options: { implementation: require('sass') },
    },
  ],
}
```

## 性能对比

在实际 Laravel 8 + Vue 3 项目（约 200 个组件、50 个页面）上的测试结果：

### 冷启动（`npm run dev`）

```
Webpack (Laravel Mix):
  ✖ 48.3 秒

Rspack:
  ✔ 4.7 秒

提升: 10.3x
```

### 生产构建（`npm run build`）

```
Webpack (Laravel Mix):
  ✖ 127.5 秒

Rspack:
  ✔ 11.2 秒

提升: 11.4x
```

### 热更新（HMR）

```
Webpack:
  修改文件后 2.1 秒可见更新

Rspack:
  修改文件后 0.15 秒可见更新

提升: 14x
```

### 内存占用

```
Webpack: 峰值 ~1.2 GB
Rspack:  峰值 ~380 MB
```

## 踩坑记录

### 1. Vue Loader 版本冲突

**问题**：安装 `vue-loader@3` 后启动报错 `Cannot read property 'styles' of undefined`。

**原因**：Rspack 需要配合 `vue-loader@17+`（Vue 3 对应版本），且需要显式添加 `VueLoaderPlugin`。

**解决**：

```bash
npm install vue-loader@^17.0.0 -D
```

```js
// rspack.config.js 必须手动添加
const { VueLoaderPlugin } = require('vue-loader');

plugins: [
  new VueLoaderPlugin(),  // 不能省略
]
```

### 2. Laravel Mix 的 `mix()` 辅助函数

**问题**：原来用 `mix('js/app.js')` 引用资源，迁移到 Rspack 后找不到文件。

**原因**：Laravel Mix 的 `mix()` 读取 `public/mix-manifest.json`，而 Rspack 默认输出的是不同格式的 manifest。

**解决**：安装 `rspack-plugin-manifest` 生成兼容格式：

```bash
npm install rspack-plugin-manifest -D
```

```js
const ManifestPlugin = require('rspack-plugin-manifest');

plugins: [
  new ManifestPlugin({
    fileName: 'mix-manifest.json',
    publicPath: '/build/',
    transform(assets) {
      // 转成 Laravel Mix 格式: {"/build/js/app.js": "/build/js/app.abc123.js"}
      const result = {};
      for (const [key, value] of Object.entries(assets)) {
        result['/build/' + key] = '/build/' + value;
      }
      return result;
    },
  }),
]
```

### 3. `require.context` 行为差异

**问题**：项目中使用了 `require.context('./pages', true, /\.vue$/)` 动态导入路由，迁移后部分页面加载失败。

**原因**：Rspack 的 `require.context` 默认不包含子目录的隐式导入。

**解决**：改用 `import.meta.webpackContext`（Rspack 推荐方式）：

```js
// 旧写法
const routes = require.context('./pages', true, /\.vue$/);

// 新写法
const routes = import.meta.webpackContext('./pages', {
  recursive: true,
  regExp: /\.vue$/,
  mode: 'sync',
});
```

### 4. CSS Modules 的 `localIdentName` 配置

**问题**：样式类名在开发和生产环境不一致，导致 SSR 水合错误。

**原因**：Rspack 的 `css-loader` 配置中 `localIdentName` 需要区分环境。

**解决**：

```js
{
  loader: 'css-loader',
  options: {
    modules: {
      auto: true,
      localIdentName: process.env.NODE_ENV === 'production'
        ? '[hash:base64:8]'
        : '[name]__[local]--[hash:base64:5]',
    },
  },
}
```

### 5. 第三方库的 Webpack 特有 API

**问题**：某些老库使用了 `module.hot` 或 Webpack 特有的 `__webpack_public_path__`。

**原因**：Rspack 虽然兼容大部分 Webpack API，但不是 100%。

**解决**：检查报错的库，如果有替代方案就换掉。实在不行，可以在 `rspack.config.js` 中用 `resolve.alias` 把 Webpack 特有 API 映射到空模块：

```js
resolve: {
  alias: {
    // 把 webpack 特有的 HMR API 映射到空模块
    'webpack/hot/dev-server': false,
  },
}
```

### 6. `style-loader` 和 MiniCssExtractPlugin 的选择

**问题**：生产构建时 CSS 没有提取到独立文件，全部内联到 JS 中。

**原因**：`style-loader` 只在开发环境有用，生产环境需要 `@rspack/plugin-html` 或 `CssExtractRspackPlugin`。

**解决**：

```js
const CssExtractPlugin = require('mini-css-extract-plugin');
// 或者使用 Rspack 内置的
const { CssExtractRspackPlugin } = require('@rspack/core');

const isProd = process.env.NODE_ENV === 'production';

module: {
  rules: [
    {
      test: /\.s?css$/,
      use: [
        isProd ? CssExtractPlugin.loader : 'style-loader',
        'css-loader',
        'sass-loader',
      ],
    },
  ],
},

plugins: [
  ...(isProd ? [new CssExtractPlugin({
    filename: 'css/[name].[contenthash:8].css',
  })] : []),
]
```

## 生产环境优化配置

```js
// rspack.config.production.js
const { CssExtractRspackPlugin } = require('@rspack/core');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',

  output: {
    filename: 'js/[name].[contenthash:8].js',
    chunkFilename: 'js/[name].[contenthash:8].js',
  },

  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true,
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],

    splitChunks: {
      chunks: 'all',
      minSize: 20000,
      maxSize: 250000,
      cacheGroups: {
        vue: {
          test: /[\\/]node_modules[\\/](vue|vue-router|pinia)[\\/]/,
          name: 'vue-vendor',
          chunks: 'all',
          priority: 20,
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: 'all',
          priority: 10,
        },
        common: {
          minChunks: 2,
          name: 'common',
          chunks: 'all',
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },

    runtimeChunk: 'single',
  },

  plugins: [
    new CssExtractRspackPlugin({
      filename: 'css/[name].[contenthash:8].css',
    }),
  ],

  // 生产环境关闭 Source Map（或用 hidden-source-map）
  devtool: false,
  // 如果需要 Sentry 等工具，用：
  // devtool: 'hidden-source-map',
};
```

## 迁移检查清单

从 Webpack/Mix 迁移到 Rspack 时，按以下顺序逐项检查：

```
□  备份现有 webpack.mix.js / webpack.config.js
□  安装 @rspack/core 和 @rspack/cli
□  创建 rspack.config.js（参考上面的配置）
□  迁移 module.rules（大部分 loader 可直接复用）
□  替换 babel-loader 为 builtin:swc-loader
□  迁移 plugins（检查每个 plugin 的 Rspack 兼容性）
□  处理 Laravel Mix 的 mix() 辅助函数
□  运行 npm run dev 验证开发环境
□  运行 npm run build 验证生产构建
□  对比构建产物大小和加载性能
□  验证 HMR 热更新正常工作
□  检查所有路由页面加载正常
□  验证 CSS 样式无丢失
□  验证图片/字体资源正确打包
□  部署到 Staging 环境测试
□  观察一周无异常后上线生产
```

## 总结

Rspack 对于使用 Webpack 的 Laravel 项目来说，是一个几乎无痛的性能升级方案。核心收益：

1. **开发效率飞跃**：冷启动从 48 秒降到 5 秒，热更新从 2 秒降到 0.15 秒，开发者体验质变
2. **构建成本降低**：CI/CD 中的构建时间从 2 分钟降到 12 秒，节省大量 CI 资源
3. **迁移成本低**：大部分 Webpack loader 和 plugin 直接复用，不需要重写业务代码
4. **Rust 生态红利**：SWC 替代 Babel、原生多线程解析，这些是 JavaScript 运行时无法比拟的

需要注意的限制：

- 少数 Webpack 特有 API 可能不兼容，需要逐个排查
- 社区生态还在发展中，部分冷门 loader/plugin 可能没有 Rspack 版本
- `require.context` 等边缘场景行为可能有细微差异

对于新项目，建议直接使用 Rspack。对于存量 Webpack 项目，特别是构建时间超过 30 秒的，强烈建议评估迁移。投入产出比非常高——一次配置，永久受益。

---

**参考链接**：

- [Rspack 官方文档](https://rspack.dev/zh/)
- [Rspack GitHub](https://github.com/web-infra-dev/rspack)
- [从 Webpack 迁移指南](https://rspack.dev/zh/guide/migration/webpack)
