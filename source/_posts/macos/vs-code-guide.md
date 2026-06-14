---

title: VS Code 高效开发实战：扩展、快捷键、调试配置 - Laravel B2C API 踩坑记录
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-17 04:25:32
updated: 2026-05-17 04:28:02
categories:
- macos
tags:
- Laravel
- PHP
- macOS
- 工程管理
- Editor
description: 在管理 30+ Laravel B2C 仓库的实战中总结的 VS Code 完全指南：精选 15 个核心扩展选型对比（Intelephense vs PHP IntelliSense、Volar vs Vetur）、macOS 快捷键体系三层进阶、Xdebug 断点调试与 pathMappings 排查、settings.json 性能调优、自定义 Snippets 模板、Remote Containers 容器内开发，以及 7 个真实踩坑案例——从 var_dump 到断点调试的效率跃迁。
keywords: [VS Code , Laravel , PHP , Xdebug , 扩展 , 快捷键 , 开发效率 , 调试配置]
---




---
# VS Code 高效开发实战：扩展、快捷键、调试配置

> 在管理 30+ Laravel 仓库的日常开发中，VS Code 是我的主力编辑器之一（与 Cursor/Zed 轮换使用）。这篇文章记录了我在大量真实项目中积累的配置经验、效率技巧和踩坑教训——不是「十大必装扩展」那种泛泛而谈，而是每个配置背后的 *why*。

## 整体开发工作流架构

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code 开发工作流                         │
├─────────────┬─────────────┬──────────────┬─────────────────┤
│  编辑层      │  智能提示层   │  调试层       │  集成层          │
│             │             │              │                 │
│ Vim/快捷键   │ Intelephense │ Xdebug       │ GitLens         │
│ 多光标编辑   │ PHPStan     │ Launch.json  │ Terminal        │
│ Snippets    │ ES7 React   │ Conditional  │ Docker Remote   │
│ Emmet       │ Vue - Off.  │  Breakpoints │ SSH Remote      │
│             │             │              │                 │
├─────────────┴─────────────┴──────────────┴─────────────────┤
│                    性能 & 稳定性层                            │
│  扩展延迟加载 │ 文件排除 │ 进程监控 │ 设置同步                     │
└─────────────────────────────────────────────────────────────┘
```

## 一、扩展选型：少即是多

### 核心原则

我见过太多开发者装了 50+ 扩展，然后抱怨 VS Code 卡。**扩展数量与启动时间、内存占用正相关**。我的原则：

- **核心扩展**（始终启用）：≤ 15 个
- **项目级扩展**（通过 Workspace 推荐）：按需加载
- **禁用项**：明确列出不加载的扩展

### 我的核心扩展清单（PHP + Vue 全栈）

```jsonc
// .vscode/extensions.json — 放在项目根目录，团队共享
{
  "recommendations": [
    // PHP 核心
    "bmewburn.vscode-intelephense-client",  // PHP 智能提示（比 PHP IntelliSense 快）
    "neilbrayfield.php-docblocker",          // PHPDoc 注释生成
    "xdebug.php-debug",                      // Xdebug 调试
    
    // Laravel 专用
    "codingyu.laravel-goto-view",            // Ctrl+Click 跳转到 Blade 视图
    "amiralizadeh.laravel-extra-intellisense", // Route/Config/Env 补全
    "onecentlin.laravel-blade",              // Blade 语法高亮
    
    // 前端（Vue 3 + TypeScript）
    "Vue.volar",                             // Vue 3 官方支持
    "dbaeumer.vscode-eslint",               // ESLint
    "esbenp.prettier-vscode",               // Prettier
    
    // 通用效率
    "eamodio.gitlens",                       // Git 历史、blame
    "usernamehw.errorlens",                  // 内联显示错误
    "christian-kohler.path-intellisense",    // 路径自动补全
    "streetsidesoftware.code-spell-checker", // 拼写检查
    "redhat.vscode-yaml",                   // YAML 支持（OpenAPI）
    "ms-azuretools.vscode-docker"            // Docker 支持
  ],
  "unwantedRecommendations": [
    // 明确排除：Intelephense 已覆盖
    "felixfbecker.php-intellisense",
    // 不需要：Volar 已覆盖
    "octref.vetur"
  ]
}
```

### 踩坑 #1：Intelephense vs PHP IntelliSense

两个扩展名字极其相似，但完全不同：

| 特性 | Intelephense | PHP IntelliSense |
|------|-------------|-----------------|
| 性能 | ✅ 快，内存占用低 | ❌ 大项目卡顿 |
| 智能提示 | ✅ 完整 | ✅ 完整 |
| 代码格式化 | ✅ 内置 | ❌ 需要额外扩展 |
| 许可证 | 免费 / $15 Pro | 免费 |

**结论**：只装 Intelephense，卸载 PHP IntelliSense。两者共存会冲突——我曾遇到跳转定义时弹出两个结果的诡异问题。

### 踩坑 #2：Volar vs Vetur

Vue 3 项目必须用 **Volar**，不能用 Vetur：

```
# Vue 2 项目 → Vetur
# Vue 3 项目 → Volar（必须！）
# 两者共存 → 直接报错
```

如果你的项目从 Vue 2 迁移到 Vue 3，记得在 VS Code 中 **禁用 Vetur**，否则模板类型推断会完全失效。

### IDE 横向对比：VS Code vs PhpStorm vs Cursor vs Zed

在 Laravel PHP 开发中，主流编辑器各有优劣。以下是基于实际使用经验的对比：

| 特性 | VS Code | PhpStorm | Cursor | Zed |
|------|---------|----------|--------|-----|
| **PHP 智能提示** | ✅ Intelephense 插件 | ✅ 原生（最强） | ✅ 继承 VS Code 生态 | ⚠️ 有限（LSP） |
| **Xdebug 调试** | ✅ php-debug 扩展 | ✅ 原生支持 | ✅ 继承 VS Code 生态 | ❌ 不支持 |
| **Blade 模板** | ✅ laravel-goto-view | ✅ 原生支持 | ✅ 继承 VS Code 生态 | ⚠️ 基础高亮 |
| **AI 补全** | ⚠️ 需 Copilot 扩展 | ⚠️ 需 AI Assistant 插件 | ✅ 原生 AI（最强） | ✅ 内置 AI |
| **启动速度** | ⚠️ 中等（扩展多时慢） | ❌ 较慢（Java 运行时） | ⚠️ 同 VS Code | ✅ 极快（Rust） |
| **内存占用** | ⚠️ 中等 | ❌ 较高（1-2GB） | ⚠️ 同 VS Code | ✅ 低 |
| **价格** | 免费 | $89/年起 | $20/月 | 免费 |
| **远程开发** | ✅ Remote-SSH/Container | ⚠️ Gateway（体验一般） | ✅ Remote-SSH | ⚠️ 有限 |

**选型建议**：
- **纯 Laravel 后端**：PhpStorm 的原生 PHP 支持最完整，但资源消耗大
- **PHP + Vue 全栈**：VS Code 生态最均衡，插件丰富
- **AI 辅助开发优先**：Cursor 在 AI 代码补全和对话方面领先
- **追求极致性能**：Zed 启动最快、内存最低，但 PHP 支持有限

> 💡 我的策略：主力 VS Code + Cursor 轮换，大型重构时切 PhpStorm（原生重构能力最强）。详见 [JetBrains Toolbox 指南](/categories/macos/jetbrains-toolbox-guide-phpstorm-webstorm-goland/) 和 [Cursor IDE 指南](/categories/macos/cursor-ide-guide-ai/)。

## 二、快捷键体系：从鼠标依赖到键盘流

### 第一层：基础编辑（必须掌握）

```
# macOS 快捷键（Windows 用 Ctrl 替换 Cmd）

# 1. 快速导航
Cmd+P              # 快速打开文件（输入文件名片段即可）
Cmd+Shift+O        # 跳转到当前文件的 Symbol（方法/属性）
Cmd+T              # 全工作区 Symbol 搜索
Cmd+G              # 跳转到指定行号

# 2. 多光标编辑（批量修改神器）
Option+Click       # 插入光标
Cmd+D              # 选中下一个相同文本（逐个加选）
Cmd+Shift+L        # 选中所有相同文本（全选）
Option+Shift+I     # 在每行末尾插入光标

# 3. 代码操作
Cmd+/              # 切换行注释
Option+Shift+A     # 切换块注释
Cmd+Shift+K        # 删除整行
Option+↑/↓         # 移动整行
Option+Shift+↑/↓   # 复制整行

# 4. 搜索替换
Cmd+F              # 当前文件搜索
Cmd+Shift+F        # 全工作区搜索（支持正则）
Cmd+H              # 当前文件替换
Cmd+Shift+H        # 全工作区替换
```

### 第二层：工作区效率（显著提速）

```
# 5. 面板切换
Cmd+B              # 切换侧边栏
Cmd+J              # 切换终端面板
Cmd+\              # 拆分编辑器（同时看两个文件）
Cmd+1/2/3          # 聚焦到第 N 个编辑器组

# 6. 代码折叠
Cmd+Option+[       # 折叠当前块
Cmd+Option+]       # 展开当前块
Cmd+K Cmd+0        # 折叠所有
Cmd+K Cmd+J        # 展开所有

# 7. 命令面板（万能入口）
Cmd+Shift+P        # 打开命令面板
# 常用命令：
#   "Toggle Terminal"        → 切换终端
#   "Format Document"        → 格式化当前文件
#   "Change Language Mode"   → 切换语法模式
#   "Reopen Closed Editor"   → 重新打开关闭的标签页
```

### 第三层：Laravel 开发专用技巧

```php
// 场景 1：快速跳转到 Route 定义
// 安装 laravel-goto-view 后：
// 在 Controller 中 Cmd+Click 视图名 → 直接跳转到 Blade 文件

// 场景 2：批量重命名变量
// 选中变量 → F2 → 输入新名字 → 回车
// 所有引用处同步修改（比全局替换安全，不会误改注释）

// 场景 3：快速生成 PHPDoc
// 在方法上方输入 /** → 回车 → 自动生成参数和返回值文档
public function calculateDiscount(
    float $amount,
    string $couponCode,
    ?Carbon $expiryDate = null
): array {
    // 自动提示需要的参数类型
}

// 场景 4：Emmet 展开在 Blade 中
// 输入 ! → Tab → 生成 HTML5 模板
// ul>li*5 → Tab → 生成 5 个 li 的列表
```

### 踩坑 #3：Vim 扩展与快捷键冲突

如果安装了 Vim 扩展（`vscodevim.vim`），很多 VS Code 原生快捷键会被覆盖：

```jsonc
// settings.json — Vim 模式下保留的关键快捷键
{
  "vim.handleKeys": {
    "<C-b>": false,   // 保留 Cmd+B 侧边栏
    "<C-j>": false,   // 保留 Cmd+J 终端
    "<C-p>": false,   // 保留 Cmd+P 快速打开
    "<C-shift+p>": false,  // 保留命令面板
    "<C-shift+f>": false   // 保留全局搜索
  }
}
```

## 三、Xdebug 调试配置：从 var_dump 到断点

### 配置架构

```
┌──────────────┐     Xdebug Protocol      ┌──────────────┐
│   VS Code    │ ◄──────────────────────► │  PHP-FPM     │
│   (Client)   │     port 9003            │  + Xdebug    │
│              │                          │  (Server)    │
│  Launch.json │     DBGp                 │              │
│  端口监听     │     协议                  │  php.ini     │
└──────────────┘                          └──────────────┘
```

### Step 1：php.ini 配置

```ini
; php.ini — Docker 容器或本地 PHP
[xdebug]
zend_extension=xdebug.so
xdebug.mode=debug
xdebug.start_with_request=yes
xdebug.client_host=host.docker.internal  ; Docker 环境
xdebug.client_port=9003
xdebug.idekey=VSCODE
xdebug.log_level=0  ; 生产环境关闭日志，开发环境可以设 7 排查问题
```

### Step 2：VS Code launch.json

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Listen for Xdebug",
      "type": "php",
      "request": "launch",
      "port": 9003,
      "pathMappings": {
        // 关键！Docker 内路径 → 本地路径映射
        "/var/www/html": "${workspaceFolder}"
      },
      "ignore": [
        "**/vendor/**/*.php"  // 跳过 vendor 包的断点
      ]
    },
    {
      "name": "Launch currently open script",
      "type": "php",
      "request": "launch",
      "program": "${file}",
      "cwd": "${fileDirname}",
      "port": 9003
    },
    {
      "name": "Debug PHPUnit Test",
      "type": "php",
      "request": "launch",
      "program": "${workspaceFolder}/vendor/bin/phpunit",
      "args": [
        "--filter", "${selectedText}"
      ],
      "cwd": "${workspaceFolder}",
      "port": 9003,
      "pathMappings": {
        "/var/www/html": "${workspaceFolder}"
      }
    }
  ]
}
```

### 踩坑 #4：pathMappings 是最常见的断点失效原因

**症状**：VS Code 显示「断点已设置但未绑定」（灰色空心圆）

**排查清单**：

```bash
# 1. 确认 Xdebug 已加载
php -m | grep xdebug
# 应输出 xdebug

# 2. 确认端口监听
lsof -i :9003
# 应看到 VS Code 进程

# 3. 确认路径映射正确
# Docker 内的绝对路径必须与 pathMappings 的 key 完全一致
docker exec php-fpm cat /proc/1/cwd
# 输出 /var/www/html → launch.json 里也必须是 "/var/www/html"

# 4. 查看 Xdebug 日志
docker exec php-fpm cat /tmp/xdebug.log
# 如果没有日志，说明 Xdebug 连接失败
```

### 条件断点实战

```php
// 场景：只在特定用户 ID 时中断
// 右键断点 → Edit Condition → 输入表达式：

// 条件 1：特定用户
$userId === 42

// 条件 2：异常场景
$order->total > 10000 && $order->status === 'pending'

// 条件 3：命中次数（第 N 次循环才中断）
// Hit Count 设为 100 → 前 99 次跳过，第 100 次中断

// 日志断点（不中断，只输出日志）
// 右键 → Add Logpoint → 输入：
"Processing order #{order.id}, total={order.total}"
```

## 四、settings.json 深度配置

```jsonc
{
  // ========== 编辑器基础 ==========
  "editor.fontSize": 14,
  "editor.fontFamily": "JetBrains Mono, Menlo, Monaco, monospace",
  "editor.fontLigatures": true,           // 连字（=> 等符号美化）
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.rulers": [120],                 // 120 字符处显示参考线
  "editor.wordWrap": "off",              // 不自动换行（看代码更清晰）
  "editor.bracketPairColorization.enabled": true,  // 括号颜色配对
  "editor.guides.bracketPairs": "active", // 括号连接线

  // ========== 文件排除 ==========
  // 减少文件索引，加速搜索和启动
  "files.exclude": {
    "**/.git": true,
    "**/node_modules": true,
    "**/vendor": false,       // PHP 项目保留 vendor 以便跳转
    "**/.DS_Store": true,
    "**/storage/framework/views": true,  // Laravel 编译视图
    "**/storage/logs": true,
    "**/.phpunit.cache": true,
    "**/bootstrap/cache": true
  },
  "search.exclude": {
    "**/vendor": true,        // 搜索时排除 vendor（编辑时保留）
    "**/node_modules": true,
    "**/storage": true,
    "**/public/build": true,
    "**/_ide_helper*.php": true,  // IDE Helper 文件
    "**/*.min.js": true
  },

  // ========== PHP 专用 ==========
  "intelephense.environment.includePaths": [
    "vendor/laravel/framework/src"
  ],
  "intelephense.stubs": [
    "laravel",
    "wordpress",
    "phpunit"
  ],
  "[php]": {
    "editor.defaultFormatter": "bmewburn.vscode-intelephense-client",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.organizeImports": "explicit"
    }
  },

  // ========== Vue 前端 ==========
  "[vue]": {
    "editor.defaultFormatter": "Vue.volar",
    "editor.formatOnSave": true
  },
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },

  // ========== 终端 ==========
  "terminal.integrated.fontSize": 13,
  "terminal.integrated.defaultProfile.osx": "zsh",
  "terminal.integrated.scrollback": 5000,  // 增加终端滚动历史

  // ========== Git ==========
  "git.autofetch": true,
  "git.confirmSync": false,
  "gitlens.hovers.currentLine.over": "line",

  // ========== 性能优化 ==========
  "extensions.autoUpdate": false,         // 手动更新，避免后台占用
  "typescript.disableAutomaticTypeAcquisition": true,
  "php.validate.executablePath": "",      // 禁用内置 PHP 验证（用 Intelephense）
  "php.validate.enable": false
}
```

### 踩坑 #5：vendor 目录的 exclude 策略

```
files.exclude: vendor=false    → 编辑器保留索引，可 Cmd+P 跳转到 vendor 源码
search.exclude: vendor=true    → 全局搜索时不搜 vendor，避免噪音

这是一个关键平衡点：
- 全 exclude → 搜索快，但无法跳转 vendor（调试很痛苦）
- 全 include → 搜索慢，大量 vendor 结果干扰
- 上面的配置 → 两全其美
```

## 五、Snippet 自定义：减少重复输入

```jsonc
// .vscode/php.json（通过 Cmd+Shift+P → "Configure User Snippets" → php）
{
  "Laravel Controller Method": {
    "prefix": "lcmethod",
    "body": [
      "/**",
      " * ${1:方法描述}",
      " *",
      " * @param ${2:Request} \\$request",
      " * @return ${3:JsonResponse}",
      " */",
      "public function ${4:methodName}(${2} \\$request): ${3}",
      "{",
      "\t${0:// implementation}",
      "}"
    ],
    "description": "Laravel Controller 方法模板"
  },
  "Laravel Test Method": {
    "prefix": "ltest",
    "body": [
      "#[Test]",
      "public function ${1:it_can_do_something}(): void",
      "{",
      "\t// Arrange",
      "\t${2:// setup}",
      "",
      "\t// Act",
      "\t${3:// action}",
      "",
      "\t// Assert",
      "\t${4:// verify}",
      "}"
    ],
    "description": "Pest 测试方法模板（AAA 模式）"
  },
  "Laravel Migration": {
    "prefix": "lmigration",
    "body": [
      "Schema::create('${1:table_name}', function (Blueprint $table) {",
      "\t\\$table->id();",
      "\t\\$table->timestamps();",
      "\t${0:// columns}",
      "});"
    ],
    "description": "Laravel Migration 模板"
  }
}
```

## 六、多仓库工作流：30+ 项目的管理策略

```
~/.config/Code/User/
├── profiles/                    # VS Code Profile（v1.75+）
│   ├── laravel-backend.code-profile
│   ├── vue-frontend.code-profile
│   └── devops.code-profile
└── settings.json                # 全局设置

~/GitHub/
├── laravel-api/                 # 后端 API
│   └── .vscode/
│       ├── settings.json        # 项目级覆盖
│       ├── launch.json          # 调试配置
│       └── extensions.json      # 推荐扩展
├── vue-admin/                   # 前端管理后台
│   └── .vscode/
│       ├── settings.json
│       └── extensions.json
└── shared-config/               # 共享配置
    └── .vscode.code-snippets    # 全局 Snippets
```

### VS Code Profile 策略

```
Profile: laravel-backend
├── Extensions: Intelephense, PHP Debug, Laravel Blade...
├── Settings: tabSize=4, PHP formatter...
└── Keybindings: Laravel-specific shortcuts

Profile: vue-frontend
├── Extensions: Volar, ESLint, Prettier...
├── Settings: tabSize=2, Vue formatter...
└── Keybindings: Vue-specific shortcuts
```

通过 `Cmd+Shift+P → Profiles: Switch Profile` 快速切换，避免前端/后端扩展互相干扰。

## 七、性能优化：大项目不卡的秘诀

### 启动时间优化

```bash
# 查看 VS Code 启动耗时
code --prof-startup

# 输出示例：
# Extension Host startup: 2300ms
#   Intelephense: 800ms
#   Volar: 600ms
#   GitLens: 200ms
#   其他 40 个扩展: 700ms
```

### 排查高内存扩展

```
Cmd+Shift+P → "Developer: Show Running Extensions"
```

这会显示每个扩展的：
- **启动时间**：哪些扩展拖慢了启动
- **CPU 使用**：哪些扩展在后台消耗资源
- **激活事件**：为什么某个扩展被意外激活

### 踩坑 #6：laravel-extra-intellisense 的 CPU 陷阱

`amiralizadeh.laravel-extra-intellisense` 提供 Route/Config 补全，但它会执行 `php artisan` 来获取数据：

```jsonc
// 症状：保存文件后 CPU 飙升，风扇狂转
// 原因：扩展执行 php artisan route:list / config:cache

// 解决方案 1：限制执行频率
{
  "laravelExtraIntellisense.commandLineMaxBuffer": 1024 * 1024,
  "laravelExtraIntellisense.phpCommand": "php {path}"
}

// 解决方案 2：如果不需要，直接禁用该扩展
// 用 Intelephense 的 Laravel Stubs 代替
```

## 八、Remote Development：容器内开发

```jsonc
// 安装 Remote - Containers 扩展后
// .devcontainer/devcontainer.json
{
  "name": "Laravel B2C API",
  "dockerComposeFile": "../docker-compose.yml",
  "service": "php-fpm",
  "workspaceFolder": "/var/www/html",
  
  "customizations": {
    "vscode": {
      "extensions": [
        "bmewburn.vscode-intelephense-client",
        "xdebug.php-debug",
        "codingyu.laravel-goto-view"
      ],
      "settings": {
        "php.validate.executablePath": "/usr/local/bin/php",
        "intelephense.phpVersion": "8.0"
      }
    }
  },
  
  "forwardPorts": [8000, 9003],
  "postCreateCommand": "composer install && php artisan key:generate"
}
```

### 踩坑 #7：Remote Containers 中 Xdebug 的 host 配置

```ini
# ❌ 错误：localhost（容器内 localhost 指向容器自己）
xdebug.client_host=localhost

# ✅ 正确：容器名或 host.docker.internal
xdebug.client_host=host.docker.internal

# ✅ 或者用 docker-compose 中的服务名
xdebug.client_host=vscode-host
```

## 总结：效率提升的关键配置优先级

```
优先级 1（立即生效）：
  ✅ 安装 Intelephense + Xdebug
  ✅ 配置 launch.json 的 pathMappings
  ✅ 掌握 Cmd+P / Cmd+Shift+P / Cmd+D

优先级 2（一周内完成）：
  ✅ 自定义 Snippets 减少重复输入
  ✅ 配置 Format on Save
  ✅ 设置 search.exclude 过滤噪音

优先级 3（持续优化）：
  ✅ 学习多光标编辑（Option+Click / Cmd+D）
  ✅ 配置 Profile 分离前后端
  ✅ 定期审查扩展性能（Developer: Show Running Extensions）
```

VS Code 的强大不在于功能多，而在于**配置可以精确匹配你的工作流**。30+ 仓库管理下来，我的经验是：先用最简配置跑通，遇到痛点再针对性优化——别一开始就追求「完美配置」，那只是另一种形式的拖延症。

## 相关阅读

- [JetBrains Toolbox 实战：多 IDE 配置同步、插件管理、版本切换](/categories/macos/jetbrains-toolbox-guide-phpstorm-webstorm-goland/) — VS Code 的"互补方案"，大型重构和原生 PHP 重构时 PhpStorm 是更好的选择
- [PhpStorm Live Templates 实战：代码模板、快速生成、Laravel 开发提速](/categories/macos/phpstorm-guide-live-templates/) — 如果你同时使用 PhpStorm，Live Templates 能大幅减少重复输入
- [iTerm2 + Oh My Zsh 终端美化与效率提升](/categories/macos/iterm2-oh-my-zsh-guide/) — VS Code 内置终端之外的独立终端方案，适合复杂 Git 操作和多窗口工作流
- [Cursor IDE AI 辅助开发指南](/categories/macos/cursor-ide-guide-ai/) — VS Code 的 AI 增强分支，原生 AI 代码补全和对话能力
- [Zed 编辑器指南：GPU 加速与 Rust 架构](/categories/macos/zed-guide-gpu-rustarchitecturelspmacos/) — 追求极致性能的替代方案，启动速度和内存占用远优于 Electron 系编辑器
- [Neovim + LSP 配置指南](/categories/macos/neovim-guide-vim-lsp/) — 终端原生编辑器方案，与 VS Code Vim 扩展的体验对比
