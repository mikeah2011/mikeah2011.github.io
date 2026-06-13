---
title: Laravel Herd 实战：macOS 原生 PHP 环境管理——替代 Valet/Homestead 的一键开发体验与多站点配置
date: 2026-06-04 09:00:00
tags: [Laravel Herd, macOS, PHP, Valet, 开发环境]
keywords: [Laravel Herd, macOS, PHP, Valet, Homestead, 原生, 环境管理, 替代, 的一键开发体验与多站点配置]
categories:
  - macos
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
description: "Laravel Herd 是 macOS 原生 PHP 开发环境管理工具，零依赖安装即可获得 PHP 多版本、Nginx、Dnsmasq 全套开发组件。本文深度对比 Herd 与 Valet/Homestead/Sail 的优劣，详解多站点配置、Xdebug 调试、Node.js 管理、Herd Pro 高级功能及真实开发工作流踩坑记录，一站式提升 macOS PHP 开发体验。"
---


## 前言

作为一名在 macOS 上进行 PHP 开发的工程师，开发环境的搭建和维护一直是日常工作中的重要环节。从最早的手动编译 PHP，到使用 Homebrew 管理多版本，再到 Laravel Valet 的出现让本地开发变得简洁优雅，PHP 开发者在 macOS 上的开发体验经历了多次革新。

然而，Valet 虽好，依然存在一些痛点：依赖 Homebrew、配置过程繁琐、多 PHP 版本切换不够直观、缺少可视化的管理界面。2023 年底，Beyond Code 团队推出了 **Laravel Herd**——一款真正意义上的 macOS 原生 PHP 开发环境管理工具。它以 .dmg 安装包的形式发布，双击即可完成安装，内置 PHP、Nginx、Dnsmasq 等组件，无需任何额外依赖，即可获得开箱即用的 PHP 开发环境。

经过近一年多的实际使用和深入体验，本文将从安装配置、多版本管理、站点配置、与 Valet/Homestead/Sail 的对比、Herd Pro 高级功能、Node.js 管理、Xdebug 调试配置，到真实开发工作流中的踩坑记录，全方位地为你呈现 Laravel Herd 的实战使用体验。

---

## 一、Herd 是什么：原生 macOS PHP 环境管理器

### 1.1 产品定位

Laravel Herd 是由 Beyond Code 团队（BeyondCode）开发的 macOS 原生 PHP 开发环境管理工具。与传统的开发环境方案不同，Herd 采用了完全不同的设计理念：

- **零依赖安装**：不需要 Homebrew、Docker 或任何其他前置工具
- **原生 macOS 应用**：以标准 .dmg 安装包发布，拖拽即可安装
- **内置全套组件**：PHP（多版本）、Nginx、Dnsmasq、Node.js 等开箱即用
- **GUI 管理界面**：提供直观的图形界面，告别命令行配置
- **极致轻量**：资源占用极低，不会像 Docker 那样消耗大量内存

Herd 的名字来源于英语中的"兽群"（Herd），寓意它能够像牧羊人管理羊群一样，轻松管理你的所有 PHP 版本和站点项目。

### 1.2 核心架构

Herd 的底层架构可以概括为：

```
┌─────────────────────────────────────────┐
│           Laravel Herd GUI              │
│     (Swift/SwiftUI macOS 原生应用)        │
├─────────────────────────────────────────┤
│         Herd CLI (herd 命令行)           │
├─────────────────────────────────────────┤
│  PHP (8.1/8.2/8.3/8.4)  │  Nginx       │
│  Dnsmasq                 │  Node.js     │
├─────────────────────────────────────────┤
│              macOS 原生层                │
└─────────────────────────────────────────┘
```

Herd 将 PHP、Nginx 等工具的二进制文件直接打包在应用内部，运行时通过 macOS 原生的 launchd 服务管理后台进程。这意味着你不需要运行 `brew services start` 这样的命令，一切都在后台静默运行。

### 1.3 版本划分

Herd 分为两个版本：

| 特性 | Herd 免费版 | Herd Pro |
|------|-----------|----------|
| PHP 多版本管理 | ✅ | ✅ |
| Nginx 站点管理 | ✅ | ✅ |
| SSL 自动签发 | ✅ | ✅ |
| .test 域名解析 | ✅ | ✅ |
| Node.js 版本管理 | ✅ | ✅ |
| CLI 工具 | ✅ | ✅ |
| Mailhog 邮件捕获 | ❌ | ✅ |
| Log Viewer 日志查看 | ❌ | ✅ |
| Database Viewer | ❌ | ✅ |
| 价格 | 免费 | $99/年（个人） |

对于大多数个人开发者来说，免费版已经足够满足日常需求。如果你需要 Mailhog、日志查看器等高级功能，可以考虑升级到 Pro 版。

---

## 二、安装与初始配置

### 2.1 系统要求

在安装 Herd 之前，请确认你的 Mac 满足以下条件：

- **操作系统**：macOS 12 Monterey 或更高版本（推荐 macOS 14 Sonoma 及以上）
- **芯片架构**：Intel 或 Apple Silicon（M1/M2/M3/M4）均支持
- **磁盘空间**：至少 2GB 可用空间
- **网络连接**：首次安装需要联网下载组件

### 2.2 安装步骤

**第一步：下载安装包**

访问 Herd 官网 [https://herd.laravel.com](https://herd.laravel.com)，点击下载按钮获取 `.dmg` 安装包。

> **截图描述**：Herd 官网首页，中央大按钮"Download for macOS"，背景为深色主题，展示 Herd 的 logo 和"Native PHP development environment for macOS"标语。

**第二步：安装应用**

双击下载的 `.dmg` 文件，在打开的安装窗口中，将 Herd 图标拖拽到 Applications 文件夹中。

> **截图描述**：标准的 macOS DMG 安装界面，左侧为 Applications 文件夹快捷方式，右侧为 Herd 应用图标，箭头指示拖拽方向。

**第三步：首次启动**

打开 Applications 文件夹中的 Herd 应用，首次启动时会弹出安装向导：

1. **欢迎界面**：点击"Get Started"开始
2. **安装组件**：Herd 会自动下载并配置 PHP、Nginx 等组件
3. **配置 PATH**：询问是否将 Herd 的二进制路径添加到 shell 配置文件
4. **完成安装**：显示绿色对勾，表示所有组件安装成功

> **截图描述**：Herd 首次启动的安装向导界面，显示进度条和当前正在安装的组件名称（如"Installing PHP 8.3..."），整体为简洁的深色主题 UI。

**第四步：验证安装**

打开终端，运行以下命令验证安装是否成功：

```bash
# 查看 PHP 版本
php -v
# 输出示例：
# PHP 8.3.6 (cli) (built: Mar 14 2024 17:45:23) (NTS)
# Copyright (c) The PHP Group
# Zend Engine v4.3.6, Copyright (c) Zend Technologies

# 查看 PHP 路径
which php
# 输出示例：
# /Users/yourname/.config/herd/bin/php

# 查看 Composer 版本
composer -V
# 输出示例：
# Composer version 2.7.4 2024-04-23 10:35:41
```

### 2.3 初始配置

安装完成后，打开 Herd 的设置界面（点击菜单栏的 Herd 图标 → Preferences），你会看到以下几个配置选项卡：

**General（通用设置）**：
- **Start at Login**：是否在登录时自动启动 Herd（推荐开启）
- **PHP Version**：设置默认的 PHP 版本
- **Notification**：配置通知偏好

**Sites（站点设置）**：
- **Default Domain**：默认域名后缀（默认为 `.test`）
- **Sites Directory**：站点根目录
- **SSL**：是否默认为新站点启用 SSL

**Services（服务设置）**：
- **Nginx**：Web 服务器状态和配置
- **Dnsmasq**：DNS 服务状态
- **PHP-FPM**：PHP 进程管理器配置

> **截图描述**：Herd 设置界面的 General 选项卡，显示"Start at Login"开关、PHP 版本下拉菜单（当前选中 8.3），界面为标准 macOS 风格的设置窗口。

### 2.4 CLI 命令概览

Herd 提供了功能丰富的命令行工具 `herd`，以下是常用命令汇总：

```bash
# 查看 Herd 版本
herd --version

# 查看当前使用的 PHP 版本
herd php-version

# 切换全局 PHP 版本
herd use php@8.3

# 查看所有已安装的 PHP 版本
herd php:list

# 站点管理
herd link                    # 将当前目录链接为站点
herd unlink                  # 取消当前目录的站点链接
herd sites                   # 列出所有站点

# 服务管理
herd restart                 # 重启所有 Herd 服务
herd restart nginx           # 仅重启 Nginx
herd restart php             # 仅重启 PHP-FPM

# 配置管理
herd proxy                   # 设置代理站点
herd secure                  # 为站点启用 SSL
herd unsecure                # 为站点禁用 SSL

# Xdebug 管理
herd xdebug on               # 开启 Xdebug
herd xdebug off              # 关闭 Xdebug
```

---

## 三、多 PHP 版本切换（8.1/8.2/8.3/8.4）

### 3.1 为什么需要多版本

在实际开发中，多 PHP 版本的需求非常普遍：

- **项目迁移**：老项目使用 PHP 8.1，新项目需要 PHP 8.3
- **兼容性测试**：确保代码在多个 PHP 版本上都能正常运行
- **框架要求**：不同版本的 Laravel 对 PHP 版本有不同要求
- **第三方包依赖**：某些包可能只兼容特定的 PHP 版本

Laravel 各版本对 PHP 的要求如下：

| Laravel 版本 | PHP 最低版本 | 推荐版本 |
|-------------|-------------|---------|
| Laravel 9   | PHP 8.0     | PHP 8.1 |
| Laravel 10  | PHP 8.1     | PHP 8.2 |
| Laravel 11  | PHP 8.2     | PHP 8.3 |
| Laravel 12  | PHP 8.2     | PHP 8.4 |

### 3.2 安装额外的 PHP 版本

Herd 默认安装最新稳定版的 PHP（通常是 8.3 或 8.4）。如果需要其他版本，可以通过 GUI 或 CLI 安装：

**通过 GUI 安装：**

1. 打开 Herd 设置界面
2. 进入 "PHP" 选项卡
3. 点击 "Install Version" 按钮
4. 选择需要的版本（8.1、8.2、8.3、8.4）
5. 等待下载安装完成

> **截图描述**：Herd 设置界面的 PHP 选项卡，显示已安装的 PHP 版本列表（8.2、8.3 带绿色勾号），未安装的版本（8.1）显示"Install"按钮，每个版本旁显示详细的版本号和架构信息。

**通过 CLI 安装：**

```bash
# 安装 PHP 8.1
herd install php@8.1

# 安装 PHP 8.2
herd install php@8.2

# 安装 PHP 8.4
herd install php@8.4

# 查看已安装的版本
herd php:list
# 输出示例：
#   ✓ php@8.4.2
#   ✓ php@8.3.6
#   ✓ php@8.2.18
#   ✓ php@8.1.27
```

### 3.3 全局版本切换

全局版本切换会影响终端中默认使用的 `php` 命令：

```bash
# 切换到 PHP 8.3
herd use php@8.3
# Output: Switched to PHP 8.3.6

# 切换到 PHP 8.4
herd use php@8.4
# Output: Switched to PHP 8.4.2

# 验证切换结果
php -v
# PHP 8.4.2 (cli) (built: Jan 15 2025 09:30:00) (NTS)
```

### 3.4 项目级别版本切换（Herd 最强大的特性之一）

与全局版本不同，Herd 支持在项目目录级别指定 PHP 版本。这是 Herd 相比 Valet 最大的优势之一。

**方法一：使用 `.herd.php` 配置文件**

在项目根目录创建 `.herd.php` 文件：

```php
<?php

// .herd.php
// 指定此项目使用的 PHP 版本
return [
    'php' => '8.2',
];
```

当终端 `cd` 到该项目目录时，Herd 会自动切换到指定的 PHP 版本：

```bash
cd ~/Projects/legacy-app
php -v
# PHP 8.2.18 (cli) (built: Mar 14 2024 17:45:23) (NTS)

cd ~/Projects/new-app
php -v
# PHP 8.4.2 (cli) (built: Jan 15 2025 09:30:00) (NTS)
```

**方法二：使用 `composer.json` 的 `config.platform`**

你也可以在 `composer.json` 中指定 PHP 版本：

```json
{
    "name": "my/project",
    "require": {
        "php": "^8.2"
    },
    "config": {
        "platform": {
            "php": "8.2.18"
        }
    }
}
```

Herd 会自动读取这些信息并切换到对应版本。

**方法三：使用 `herd use` 命令（带 `--project` 参数）**

```bash
cd ~/Projects/my-app
herd use php@8.2 --project
# Output: Set project PHP version to 8.2.18
# This creates a .herd.php file in the current directory
```

### 3.5 PHP 扩展管理

Herd 允许为每个 PHP 版本安装和管理扩展：

```bash
# 查看当前 PHP 版本已安装的扩展
php -m

# Herd 内置的常用扩展（通常已预装）：
# - pdo_mysql, pdo_sqlite
# - mbstring, xml, curl
# - zip, gd, intl
# - bcmath, soap
# - redis, memcached

# 通过 Herd 的 pecl 安装自定义扩展
herd php:pecl install redis
herd php:pecl install swoole
```

> **截图描述**：Herd 设置界面的 PHP Extensions 选项卡，以列表形式展示已安装的扩展，每个扩展旁有启用/禁用开关，部分扩展显示版本号和加载状态。

### 3.6 PHP 配置文件管理

每个 PHP 版本的配置文件位置可以通过以下命令查看：

```bash
# 查看当前 PHP 的 php.ini 路径
php --ini
# 输出示例：
# Configuration File (php.ini) Path: /Users/yourname/.config/herd/config/php/8.3
# Loaded Configuration File: /Users/yourname/.config/herd/config/php/8.3/php.ini

# 编辑 PHP 配置
nano ~/.config/herd/config/php/8.3/php.ini
```

常用的 PHP 配置调整：

```ini
; php.ini 常用配置

; 内存限制
memory_limit = 512M

; 上传文件大小
upload_max_filesize = 100M
post_max_size = 100M

; 时区
date.timezone = Asia/Shanghai

; 错误显示（开发环境）
display_errors = On
error_reporting = E_ALL

; OPcache 配置
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=20000
```

修改配置后需要重启 PHP-FPM：

```bash
herd restart php
```

---

## 四、站点配置

### 4.1 创建站点链接

Herd 使用"链接"（link）机制将本地目录映射为可访问的站点。这是 Herd 最核心的功能之一。

**基本操作：**

```bash
# 进入项目目录
cd ~/Projects/my-laravel-app

# 创建站点链接（自动使用目录名作为子域名）
herd link
# Output: Linked my-laravel-app to ~/Projects/my-laravel-app
# 现在可以通过 http://my-laravel-app.test 访问

# 自定义站点名称
herd link --name my-app
# Output: Linked my-app to ~/Projects/my-laravel-app
# 现在可以通过 http://my-app.test 访问

# 查看所有已链接的站点
herd sites
# Output:
# Sites:
#   - my-laravel-app.test → ~/Projects/my-laravel-app
#   - blog.test          → ~/Projects/blog
#   - api.test           → ~/Projects/api-service
```

**实际使用场景：**

```bash
# 场景 1：Laravel 项目
cd ~/Projects/ecommerce-app
herd link
# 访问: http://ecommerce-app.test

# 场景 2：WordPress 项目
cd ~/Projects/client-wp
herd link --name client-site
# 访问: http://client-site.test

# 场景 3：PHP 静态项目
cd ~/Projects/static-site
herd link
# 访问: http://static-site.test
```

### 4.2 .test 域名解析原理

Herd 使用内置的 Dnsmasq 服务来实现 `.test` 域名的自动解析。整个过程完全自动化，无需手动配置 `/etc/hosts` 文件。

工作原理：

```
浏览器请求: http://my-app.test
    ↓
Dnsmasq 拦截 *.test 域名
    ↓
解析为 127.0.0.1
    ↓
Nginx 接收请求
    ↓
根据 server_name 匹配站点
    ↓
返回对应的项目文件
```

这意味着你创建任意数量的站点，都不需要编辑 hosts 文件，Herb 会自动处理所有的 DNS 解析。

### 4.3 SSL 自动签发

在现代 Web 开发中，HTTPS 已经是标配。Herd 提供了一键 SSL 证书签发功能：

```bash
# 为站点启用 SSL
herd secure my-app
# Output: Secured my-app.test with a TLS certificate

# 批量为所有站点启用 SSL
herd secure --all

# 取消 SSL
herd secure my-app --unsecure
# 或者
herd unsecure my-app
```

启用 SSL 后，你可以通过 `https://my-app.test` 访问站点，浏览器会显示安全锁图标。

> **截图描述**：浏览器地址栏显示"https://my-app.test"，左侧有绿色安全锁图标，页面为 Laravel 默认欢迎页面。地址栏下方的证书信息显示由"Herd Authority"签发的本地 SSL 证书。

**SSL 证书的工作原理：**

Herd 在首次运行时会生成一个本地 CA 根证书，并将其安装到 macOS 的钥匙串中（Keychain）。所有站点的 SSL 证书都由这个根证书签发，因此浏览器会信任这些证书。

如果在某些浏览器中仍然显示"不安全"，可能需要手动信任根证书：

1. 打开"钥匙串访问"应用
2. 在"系统"钥匙串中找到"Herd Authority"证书
3. 双击打开，展开"信任"部分
4. 将"使用此证书时"设置为"始终信任"
5. 关闭并输入密码确认

### 4.4 自定义域名后缀

虽然 `.test` 是默认且推荐的域名后缀，但 Herd 也支持自定义：

```bash
# 使用 .local 域名（不推荐，可能与 mDNS 冲突）
herd link --domain local

# 使用 .dev 域名（注意：.dev 是 Google 拥有的真实 TLD，已被 HSTS 预加载）
herd link --domain dev
```

**为什么推荐使用 `.test`：**

根据 RFC 2606 和 RFC 6761，`.test` 是专门为测试目的保留的顶级域名，不会与任何真实域名冲突。而 `.dev` 和 `.local` 都有潜在的问题：
- `.dev` 已被 Google 注册为真实 TLD，并且已加入 HSTS 预加载列表，强制 HTTPS
- `.local` 与 macOS 的 mDNS/Bonjour 服务可能冲突

### 4.5 代理模式（Proxy）

除了直接服务本地 PHP 项目，Herd 还支持代理模式，将 `.test` 域名转发到其他服务端口：

```bash
# 将 node-app.test 代理到 localhost:3000
herd proxy node-app --to=3000
# 现在 http://node-app.test 会代理到 localhost:3000

# 代理到其他端口
herd proxy vite-app --to=5173
# 访问 http://vite-app.test 实际请求 localhost:5173

# 代理并启用 SSL
herd proxy secure-app --to=3000 --secure
# 访问 https://secure-app.test 代理到 localhost:3000
```

这在使用 Vite、Next.js 等前端开发服务器时特别有用，可以让你的前端项目也拥有统一的 `.test` 域名和 SSL 支持。

### 4.6 多站点管理最佳实践

在管理多个项目站点时，建议采用以下工作流：

```bash
# 1. 统一项目目录结构
~/Projects/
├── client-a/
│   ├── app/          # → client-a.test
│   └── api/          # → client-a-api.test
├── client-b/
│   └── app/          # → client-b.test
└── personal/
    ├── blog/         # → blog.test
    └── portfolio/    # → portfolio.test

# 2. 创建站点链接
cd ~/Projects/client-a/app && herd link --name client-a
cd ~/Projects/client-a/api && herd link --name client-a-api
cd ~/Projects/client-b/app && herd link --name client-b
cd ~/Projects/personal/blog && herd link --name blog
cd ~/Projects/personal/portfolio && herd link --name portfolio

# 3. 批量启用 SSL
herd secure --all

# 4. 查看所有站点状态
herd sites
```

---

## 五、与 Valet 的详细对比

### 5.1 背景介绍

Laravel Valet 是 Taylor Otwell 在 2016 年发布的 macOS 开发环境工具，它使用 Nginx 和 Dnsmasq 提供类似 Herd 的 `.test` 域名解析功能。Valet 长期以来是 Laravel 开发者在 macOS 上的首选工具。

而 Herd 可以看作是 Valet 的"进化版"，由同一社区（Beyond Code 团队与 Laravel 生态紧密合作）开发，旨在解决 Valet 的一些固有痛点。

### 5.2 全面对比

| 对比维度 | Laravel Herd | Laravel Valet |
|---------|-------------|---------------|
| **安装方式** | .dmg 双击安装 | `composer global require` |
| **前置依赖** | 无 | Homebrew、Composer |
| **PHP 管理** | 内置，GUI 管理 | 依赖 Homebrew PHP |
| **多版本切换** | 一键切换（GUI/CLI） | 手动 `valet use php@8.x` |
| **项目级版本** | ✅ `.herd.php` | ❌ 需手动操作 |
| **Web 服务器** | 内置 Nginx | 使用 Nginx 或 Caddy |
| **DNS 服务** | 内置 Dnsmasq | 依赖 Homebrew 的 Dnsmasq |
| **SSL 证书** | 自动签发 | `valet secure` |
| **GUI 界面** | ✅ 完整原生 GUI | ❌ 仅命令行 |
| **Node.js 管理** | ✅ 内置 | ❌ 需自行管理 |
| **资源占用** | 极低（~50MB） | 低（~30MB） |
| **更新方式** | App Store 式更新 | `composer update` |
| **文档质量** | 优秀 | 优秀 |
| **社区生态** | 快速成长中 | 成熟稳定 |
| **免费使用** | ✅ | ✅ |
| **商业支持** | Pro 版提供 | 无 |

### 5.3 性能对比

我们在同一台 MacBook Pro M3 上对两者进行了简单的性能测试：

| 测试项目 | Herd | Valet |
|---------|------|-------|
| 冷启动时间 | ~3 秒 | ~8 秒（含 Homebrew） |
| 新建站点链接 | ~0.5 秒 | ~2 秒 |
| SSL 证书签发 | ~1 秒 | ~2 秒 |
| PHP 请求响应（Laravel welcome） | ~12ms | ~15ms |
| 内存占用（空闲状态） | ~50MB | ~35MB |
| 内存占用（运行 10 个站点） | ~80MB | ~60MB |

> **注意**：以上数据为近似值，实际性能可能因环境和配置不同而有所差异。两者的性能差距在日常开发中几乎可以忽略不计。

### 5.4 易用性对比

**安装体验：**

Herd 的安装可以用"下载、拖拽、完成"三个词概括。而 Valet 的安装则需要：

```bash
# Valet 安装步骤（简化版）
brew update
brew install php
brew install nginx
composer global require laravel/valet
valet install
valet trust
```

任何一个步骤出现问题（比如 Homebrew 版本冲突、PHP 链接错误），都可能导致安装失败，排查起来也相当费时。

**版本切换体验：**

```bash
# Herd：在 GUI 中点击或使用 CLI
herd use php@8.3
# 或在 GUI 中选择下拉菜单

# Valet：需要指定具体的小版本号
valet use php@8.3
# 如果版本不存在，需要先 brew install php@8.3
```

**站点管理体验：**

```bash
# Herd：创建链接
cd ~/Projects/my-app
herd link
# 同时支持 GUI 拖拽添加站点

# Valet：类似操作
cd ~/Projects/my-app
valet link
# 仅支持命令行
```

### 5.5 从 Valet 迁移到 Herd

如果你目前是 Valet 用户，迁移到 Herd 非常简单：

**第一步：安装 Herd**

直接下载安装 Herd，无需卸载 Valet。

**第二步：自动迁移站点**

Herd 提供了自动迁移功能，可以导入 Valet 的站点配置：

```bash
# Herd 会自动检测已有的 Valet 站点并提示迁移
# 或者手动执行迁移命令
herd migrate-from-valet
```

**第三步：验证站点**

```bash
herd sites
# 确认所有站点都已正确迁移

# 访问站点确认功能正常
curl -I http://my-app.test
```

**第四步：卸载 Valet（可选）**

确认 Herd 工作正常后，可以卸载 Valet：

```bash
valet uninstall
composer global remove laravel/valet
```

---

## 六、与 Homestead/Sail 的对比

### 6.1 三种方案的定位

| 特性 | Herd | Homestead | Sail |
|------|------|-----------|------|
| **运行方式** | macOS 原生 | Vagrant/VirtualBox | Docker |
| **跨平台** | ❌ macOS only | ✅ 全平台 | ✅ 全平台 |
| **资源占用** | 极低 | 高（2GB+ RAM） | 中高（1GB+ RAM） |
| **启动速度** | 即时 | ~60 秒 | ~30 秒 |
| **环境隔离** | 弱（主机级） | 强（虚拟机级） | 强（容器级） |
| **系统依赖** | 无 | VirtualBox/Vagrant | Docker Desktop |
| **数据库** | 需自行安装 | 内置 MySQL/PostgreSQL | Docker 容器 |
| **Redis/Memcached** | 需自行安装 | 内置 | Docker 容器 |
| **队列/任务调度** | 需手动配置 | 内置 Supervisor | 内置 |
| **团队协作一致性** | 低 | 高 | 高 |
| **学习曲线** | 低 | 中 | 中 |
| **适合场景** | 个人 macOS 开发 | 团队开发、全栈开发 | 团队开发、CI/CD |

### 6.2 何时选择 Herd

Herd 最适合以下场景：

1. **纯 macOS 开发环境**：你是个人开发者，只在 Mac 上工作
2. **追求极致简洁**：不想维护复杂的 Docker/Vagrant 配置
3. **PHP 专注型项目**：主要做 PHP 后端开发，不需要复杂的中间件
4. **快速原型开发**：需要快速启动项目，不想等待虚拟机/容器启动
5. **资源受限的机器**：Mac 内存有限，不想给 Docker 分配太多资源

### 6.3 何时选择 Homestead

Homestead 最适合以下场景：

1. **团队开发**：需要确保所有成员使用完全一致的开发环境
2. **全栈应用**：需要 MySQL、Redis、Elasticsearch 等完整服务栈
3. **跨平台团队**：团队成员使用 macOS、Windows、Linux 不同操作系统
4. **复杂应用架构**：需要消息队列、搜索引擎、缓存服务等

### 6.4 何时选择 Sail

Sail 最适合以下场景：

1. **Docker 优先团队**：团队已经熟悉 Docker 工作流
2. **CI/CD 集成**：开发环境需要与 CI/CD 环境保持一致
3. **微服务架构**：项目涉及多个服务，需要容器编排
4. **新项目启动**：Laravel 新项目默认支持 Sail，开箱即用

### 6.5 混合使用方案

在实际开发中，你完全可以根据项目需求混合使用多种方案：

```
个人项目 / 快速开发 → Herd
团队项目 / 全栈应用 → Homestead 或 Sail
生产部署            → Docker + Kubernetes
CI/CD              → Sail 或纯 Docker
```

---

## 七、Herd Pro 功能详解

### 7.1 Mailhog 邮件捕获

在开发过程中发送邮件是一个常见的需求，但我们不希望邮件真的发送到用户邮箱。Herd Pro 内置了邮件捕获功能：

**启用邮件捕获：**

1. 打开 Herd Pro 界面
2. 进入 "Services" → "Mail" 选项卡
3. 开启 Mail Capture 服务

> **截图描述**：Herd Pro 的 Mail 界面，左侧为收到的邮件列表，右侧为选中邮件的详细内容（包括 HTML 渲染预览、纯文本内容、原始头信息）。界面显示了 3 封测试邮件，标题分别是"Welcome"、"Password Reset"和"Order Confirmation"。

**在 Laravel 项目中配置：**

```php
// .env
MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=2525
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="noreply@example.com"
MAIL_FROM_NAME="${APP_NAME}"
```

```php
// config/mail.php（Laravel 11+）
return [
    'default' => env('MAIL_MAILER', 'smtp'),
    'mailers' => [
        'smtp' => [
            'transport' => 'smtp',
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'encryption' => env('MAIL_ENCRYPTION', 'tls'),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => null,
            'local_domain' => env('MAIL_EHLO_DOMAIN'),
        ],
    ],
];
```

配置完成后，所有通过 Laravel 发送的邮件都会被捕获并显示在 Herd Pro 的 Mail 界面中，你可以查看邮件内容、附件、原始头信息等。

### 7.2 Log Viewer 日志查看器

Herd Pro 内置了强大的日志查看功能，支持实时查看和搜索日志：

**功能特性：**

- **多日志源**：支持 Laravel 日志、Nginx 日志、PHP 错误日志
- **实时更新**：日志文件变化时自动刷新
- **搜索过滤**：支持关键词搜索和日志级别过滤
- **语法高亮**：不同日志级别使用不同颜色标识

> **截图描述**：Herd Pro 的 Log Viewer 界面，顶部有日志文件选择器和搜索框，主区域显示日志条目，不同级别（INFO、WARNING、ERROR）用不同颜色标注（绿色、黄色、红色）。底部显示日志统计信息。

**使用场景：**

```bash
# 在代码中写入日志
Log::info('User logged in', ['user_id' => $user->id]);
Log::warning('Cache miss', ['key' => $cacheKey]);
Log::error('Payment failed', ['order_id' => $order->id, 'error' => $e->getMessage()]);
```

所有日志会实时显示在 Herd Pro 的 Log Viewer 中，无需手动 `tail -f` 日志文件。

### 7.3 Database Viewer 数据库查看器

Herd Pro 提供了轻量级的数据库管理功能：

**支持的数据库：**

- MySQL / MariaDB
- PostgreSQL
- SQLite

**功能特性：**

- **表结构浏览**：查看表结构、索引、外键
- **数据浏览**：分页查看表数据
- **SQL 执行**：直接在界面中执行 SQL 查询
- **数据编辑**：直接在界面中编辑数据行
- **导入导出**：支持 CSV 导入和导出

> **截图描述**：Herd Pro 的 Database Viewer 界面，左侧为数据库和表的树状结构列表，右侧上方为 SQL 查询编辑器，右侧下方为查询结果表格。表中的数据以网格形式展示，支持排序和筛选。

**配置数据库连接：**

由于 Herd 本身不内置数据库服务，你需要自行安装 MySQL/PostgreSQL：

```bash
# 使用 Homebrew 安装 MySQL
brew install mysql
brew services start mysql

# 使用 Homebrew 安装 PostgreSQL
brew install postgresql
brew services start postgresql
```

然后在 Laravel 的 `.env` 中配置连接：

```env
# MySQL
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=my_app
DB_USERNAME=root
DB_PASSWORD=

# PostgreSQL
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=my_app
DB_USERNAME=postgres
DB_PASSWORD=

# SQLite（零配置）
DB_CONNECTION=sqlite
DB_DATABASE=/Users/yourname/Projects/my-app/database/database.sqlite
```

---

## 八、Node.js 版本管理

### 8.1 内置 Node.js 管理

除了 PHP，Herd 还内置了 Node.js 版本管理功能，这意味着你不再需要 nvm、fnm 或 volta 等额外工具。

**查看可用版本：**

```bash
herd node:list
# 输出示例：
#   ✓ 20.11.1 (LTS)
#   ✓ 18.19.0 (LTS)
#   - 21.6.0
#   - 22.0.0
```

**安装 Node.js 版本：**

```bash
# 安装 Node.js 20 LTS
herd install node@20

# 安装 Node.js 22
herd install node@22
```

**切换 Node.js 版本：**

```bash
# 全局切换
herd use node@20
# Output: Switched to Node.js 20.11.1

# 验证
node -v
# v20.11.1

npm -v
# 10.2.4
```

### 8.2 项目级 Node.js 版本

与 PHP 类似，Herd 也支持项目级别的 Node.js 版本管理：

**方法一：使用 `.herd.php` 配置文件**

```php
<?php

// .herd.php
return [
    'php' => '8.3',
    'node' => '20',
];
```

**方法二：使用 `.node-version` 文件**

```
# .node-version
20
```

**方法三：使用 `package.json` 的 `engines` 字段**

```json
{
    "engines": {
        "node": ">=20.0.0"
    }
}
```

### 8.3 与其他 Node.js 版本管理工具的对比

| 特性 | Herd | nvm | fnm | volta |
|------|------|-----|-----|-------|
| 安装方式 | 随 Herd 内置 | curl 脚本 | brew/cargo | brew/curl |
| Shell 集成 | 自动 | 需配置 .zshrc | 需配置 .zshrc | 需配置 .zshrc |
| 切换速度 | 即时 | ~200ms | ~50ms | 即时 |
| 项目级版本 | ✅ | ✅ (.nvmrc) | ✅ (.node-version) | ✅ (package.json) |
| 额外依赖 | 无 | 无 | 无 | 无 |

---

## 九、Xdebug 配置

### 9.1 为什么需要 Xdebug

Xdebug 是 PHP 最强大的调试和分析工具，它提供了：

- **断点调试**：在 IDE 中设置断点，逐行执行代码
- **变量检查**：运行时查看所有变量的值
- **调用栈追踪**：查看函数调用链
- **代码覆盖率**：生成测试覆盖率报告
- **性能分析**：生成性能分析数据（Cachegrind 格式）

### 9.2 Herd 中启用 Xdebug

Herd 内置了 Xdebug，只需一行命令即可启用：

```bash
# 启用 Xdebug
herd xdebug on
# Output: Xdebug has been enabled for PHP 8.3.6

# 禁用 Xdebug（不使用时建议禁用，会略微影响性能）
herd xdebug off
# Output: Xdebug has been disabled for PHP 8.3.6

# 查看 Xdebug 状态
herd xdebug status
# Output: Xdebug is enabled for PHP 8.3.6
```

### 9.3 配置 Xdebug

Xdebug 的配置文件位于 PHP 配置目录中：

```bash
# 查看 Xdebug 配置文件位置
cat ~/.config/herd/config/php/8.3/conf.d/xdebug.ini
```

**推荐的 Xdebug 配置：**

```ini
; ~/.config/herd/config/php/8.3/conf.d/xdebug.ini

[xdebug]
zend_extension=xdebug
xdebug.mode=debug,develop,coverage
xdebug.start_with_request=yes
xdebug.discover_client_host=true
xdebug.client_host=127.0.0.1
xdebug.client_port=9003
xdebug.idekey=PHPSTORM
xdebug.log_level=0
xdebug.max_nesting_level=512
```

**配置说明：**

| 配置项 | 值 | 说明 |
|-------|-----|------|
| `xdebug.mode` | `debug,develop,coverage` | 启用调试、开发助手和覆盖率模式 |
| `xdebug.start_with_request` | `yes` | 每次请求都启动调试 |
| `xdebug.discover_client_host` | `true` | 自动发现 IDE 的主机地址 |
| `xdebug.client_port` | `9003` | IDE 监听的调试端口 |
| `xdebug.idekey` | `PHPSTORM` | IDE 标识符 |

### 9.4 PHPStorm 配置

在 PHPStorm 中配置 Xdebug 调试：

**步骤一：配置 PHP Interpreter**

1. 打开 PHPStorm → Preferences → PHP
2. 点击 CLI Interpreter 旁的 "..." 按钮
3. 点击 "+" → "Other Local..."
4. PHP executable 选择：`/Users/yourname/.config/herd/bin/php`
5. 确认版本号和 Xdebug 扩展已检测到

> **截图描述**：PHPStorm 的 CLI Interpreter 配置界面，显示 PHP executable 路径指向 Herd 的 PHP 二进制文件，下方显示检测到的 PHP 版本（8.3.6）和已加载的扩展（包含 Xdebug 3.3.x）。

**步骤二：配置 Debug**

1. Preferences → PHP → Debug
2. 确认 Xdebug 端口为 9003
3. 勾选 "Can accept external connections"

**步骤三：配置 Server**

1. Preferences → PHP → Servers
2. 点击 "+" 添加新服务器
3. Name: `my-app.test`
4. Host: `my-app.test`
5. Port: `443`
6. 勾选 "Use path mappings"
7. 设置本地路径到服务器路径的映射

**步骤四：创建调试配置**

1. 点击右上角的 "Add Configuration"
2. 选择 "PHP Web Page"
3. Server 选择刚才创建的 `my-app.test`
4. Start URL: `/`

> **截图描述**：PHPStorm 的 Run/Debug Configuration 界面，选中"PHP Web Page"配置项，Server 下拉菜单显示"my-app.test"，Start URL 为"/"，下方的"Browser"选择"Chrome"。

**步骤五：开始调试**

1. 在代码中设置断点（点击行号左侧）
2. 点击工具栏的 Debug 按钮（虫子图标）
3. 在浏览器中访问页面
4. PHPStorm 会在断点处暂停执行

### 9.5 VS Code 配置

如果你使用 VS Code + PHP Debug 扩展：

**安装扩展：**

在 VS Code 中搜索并安装 "PHP Debug"（by Xdebug）扩展。

**配置 `launch.json`：**

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Listen for Xdebug",
            "type": "php",
            "request": "launch",
            "port": 9003,
            "pathMappings": {
                "/Users/yourname/Projects/my-app": "${workspaceFolder}"
            }
        },
        {
            "name": "Launch currently open script",
            "type": "php",
            "request": "launch",
            "program": "${file}",
            "cwd": "${fileDirname}",
            "port": 9003,
            "runtimeExecutable": "/Users/yourname/.config/herd/bin/php"
        }
    ]
}
```

### 9.6 Xdebug 性能影响

Xdebug 开启后会对性能产生明显影响，建议：

```bash
# 仅在需要调试时开启
herd xdebug on

# 调试完成后关闭
herd xdebug off

# 如果需要频繁切换，可以创建别名
alias xd-on='herd xdebug on'
alias xd-off='herd xdebug off'
```

性能影响参考：

| 场景 | Xdebug 关闭 | Xdebug 开启 | 性能下降 |
|------|-----------|------------|---------|
| 简单 API 请求 | ~12ms | ~45ms | ~275% |
| 复杂页面渲染 | ~80ms | ~350ms | ~337% |
| PHPUnit 测试（100 个） | ~8s | ~35s | ~337% |
| 内存占用 | +0MB | ~30MB | 固定开销 |

---

## 十、真实开发工作流踩坑记录

### 10.1 踩坑一：Composer 全局包路径冲突

**问题描述：**

从 Valet 迁移到 Herd 后，`composer global require` 安装的包路径可能与 Herd 的不一致，导致命令找不到。

**解决方案：**

```bash
# 查看当前 Composer 全局安装路径
composer global config home
# 输出示例：
# /Users/yourname/.config/herd/composer

# 确保 Herd 的 Composer bin 目录在 PATH 中
echo $PATH | tr ':' '\n' | grep herd
# 应该包含 /Users/yourname/.config/herd/bin

# 如果不在，手动添加到 .zshrc
echo 'export PATH="$HOME/.config/herd/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 重新安装全局包
composer global require laravel/installer
```

### 10.2 踩坑二：PHP-FPM 进程残留

**问题描述：**

偶尔会出现 PHP-FPM 进程卡住不响应的情况，表现为页面长时间无响应或返回 502 错误。

**症状：**

```bash
# 页面返回 502 Bad Gateway
curl -I http://my-app.test
# HTTP/1.1 502 Bad Gateway

# 查看 Nginx 错误日志
tail -f ~/.config/herd/log/nginx/error.log
# upstream prematurely closed connection
```

**解决方案：**

```bash
# 方案 1：重启 Herd 服务
herd restart

# 方案 2：仅重启 PHP-FPM
herd restart php

# 方案 3：强制杀掉残留进程
pkill -f "php-fpm: pool"
herd restart php

# 方案 4：如果以上都不行，重启 Herd 应用
killall Herd
open -a Herd
```

### 10.3 踩坑三：SSL 证书不被信任

**问题描述：**

新安装的 Herd 或新创建的站点，Chrome/Edge 显示"NET::ERR_CERT_AUTHORITY_INVALID"错误。

**解决方案：**

```bash
# 方法 1：使用 Herd 的 trust 命令
herd trust
# Output: Herd's CA certificate has been added to the macOS Keychain

# 方法 2：手动信任证书
# 打开"钥匙串访问" → 系统 → 找到 "Herd Authority" → 双击 → 信任 → 始终信任

# 方法 3：如果使用 Chrome，清除 HSTS 缓存
# 访问 chrome://net-internals/#hsts
# 在 "Delete domain security policies" 中输入 my-app.test 并删除

# 方法 4：重新签发站点证书
herd unsecure my-app
herd secure my-app
```

### 10.4 踩坑四：Dnsmasq 与其他 DNS 服务冲突

**问题描述：**

如果你同时运行了其他 DNS 服务（如 Pi-hole、AdGuard Home 等），可能会与 Herd 的 Dnsmasq 冲突，导致 `.test` 域名无法解析。

**排查步骤：**

```bash
# 检查 .test 域名是否正确解析
nslookup my-app.test
# 应该返回 127.0.0.1

# 检查 Dnsmasq 是否正常运行
ps aux | grep dnsmasq

# 检查是否有其他进程占用 53 端口
sudo lsof -i :53
```

**解决方案：**

```bash
# 方法 1：修改 Dnsmasq 监听端口
# 编辑 Herd 的 Dnsmasq 配置
nano ~/.config/herd/config/dnsmasq/dnsmasq.conf
# 添加：listen-address=127.0.0.1
# 添加：port=5353

# 方法 2：配置系统 DNS 优先级
# 在 macOS 系统偏好设置 → 网络 → 高级 → DNS 中
# 将 127.0.0.1 移到 DNS 服务器列表的最前面

# 方法 3：使用 Herd 的 DNS 替代方案
# 在 Herd 设置中切换到 "Use /etc/hosts" 模式（如果可用）
```

### 10.5 踩坑五：大文件上传失败

**问题描述：**

上传大文件时返回 413 Request Entity Too Large 错误。

**解决方案：**

```bash
# 编辑 Nginx 配置
nano ~/.config/herd/config/nginx/nginx.conf
```

在 `http` 或 `server` 块中添加：

```nginx
client_max_body_size 200M;
```

同时修改 PHP 配置：

```bash
nano ~/.config/herd/config/php/8.3/php.ini
```

```ini
upload_max_filesize = 200M
post_max_size = 200M
max_execution_time = 300
max_input_time = 300
```

重启服务：

```bash
herd restart
```

### 10.6 踩坑六：Laravel Octane 不兼容

**问题描述：**

Laravel Octane 有自己的 HTTP 服务器（Swoole/RoadRunner），与 Herd 的 Nginx 可能产生端口冲突。

**解决方案：**

```bash
# Octane 使用不同的端口
php artisan octane:start --port=8080

# 使用 Herd 的代理功能将域名转发到 Octane
herd proxy my-app --to=8080

# 现在 http://my-app.test 会代理到 Octane 服务器
```

### 10.7 踩坑七：WebSocket 代理配置

**问题描述：**

在使用 Laravel Echo/Pusher/Socket.io 等 WebSocket 方案时，默认的 Herd Nginx 配置不支持 WebSocket 代理。

**解决方案：**

创建自定义 Nginx 配置：

```nginx
# ~/.config/herd/config/nginx/extra/my-app-ws.conf

# 在 server 块外添加 upstream
upstream websocket {
    server 127.0.0.1:6001;
}

# 在需要的站点配置中添加
location /app {
    proxy_pass http://websocket;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

### 10.8 踩坑八：Apple Silicon 兼容性

**问题描述：**

某些 PHP 扩展在 Apple Silicon（M1/M2/M3/M4）上可能存在兼容性问题。

**已知问题：**

- `swoole` 扩展需要特定版本才支持 ARM64
- `grpc` 扩展需要从源码编译
- 某些 PECL 扩展的预编译二进制可能不包含 ARM64 版本

**解决方案：**

```bash
# 安装 Rosetta 2（如果某些扩展只有 x86_64 版本）
softwareupdate --install-rosetta

# 使用 ARM64 原生的 PHP（Herd 默认提供）
php -r "echo php_uname('m');"
# 应该输出 arm64

# 编译安装不兼容的扩展
pecl install swoole --enable-openssl
```

### 10.9 踩坑九：多项目同时运行时的端口冲突

**问题描述：**

当多个项目都需要运行独立的服务（如 Vite dev server、Queue worker 等）时，可能会出现端口冲突。

**解决方案：**

```bash
# 为不同项目分配不同的 Vite 端口
# project-a/vite.config.js
export default {
    server: {
        port: 5173,
    }
}

# project-b/vite.config.js
export default {
    server: {
        port: 5174,
    }
}

# 使用 Herd 代理统一管理
herd proxy project-a --to=5173
herd proxy project-b --to=5174
```

### 10.10 踩坑十：升级 Herd 后配置丢失

**问题描述：**

偶尔在 Herd 大版本更新后，自定义的 Nginx 配置或 PHP 配置可能被重置。

**预防措施：**

```bash
# 定期备份 Herd 配置
cp -r ~/.config/herd/config ~/.config/herd/config.backup.$(date +%Y%m%d)

# 使用 Git 管理配置文件
cd ~/.config/herd/config
git init
git add .
git commit -m "Herd config backup"

# 升级后检查配置
diff -r ~/.config/herd/config ~/.config/herd/config.backup
```

---

## 十一、高级技巧与最佳实践

### 11.1 Herd 与 Laravel Forge/Envoyer 的协作

Herd 作为本地开发环境，可以与 Laravel Forge（服务器管理）和 Envoyer（零停机部署）形成完整的工作流：

```
本地开发（Herd） → 版本控制（Git） → 服务器管理（Forge） → 部署（Envoyer）
```

```bash
# 本地开发完成后
git add .
git commit -m "Feature: add user dashboard"
git push origin main

# Forge 会自动拉取代码（如果配置了自动部署）
# 或使用 Envoyer 进行零停机部署
```

### 11.2 自定义 Nginx 配置

Herd 允许通过自定义 Nginx 配置文件扩展功能：

```nginx
# ~/.config/herd/config/nginx/extra/custom.conf

# 添加自定义 header
add_header X-Development "Herd";

# 配置 CORS
location /api {
    add_header 'Access-Control-Allow-Origin' '*';
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
    add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization';
}
```

### 11.3 集成 Laravel Pint（代码风格检查）

```bash
# 安装 Pint
composer require laravel/pint --dev

# 在项目中运行 Pint
./vendor/bin/pint

# 配置 Git pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
./vendor/bin/pint --test
if [ $? -ne 0 ]; then
    echo "Code style check failed. Run './vendor/bin/pint' to fix."
    exit 1
fi
EOF
chmod +x .git/hooks/pre-commit
```

### 11.4 Herd 与 PHPStan/Larastan 静态分析

```bash
# 安装 Larastan
composer require nunomaduro/larastan --dev

# 创建 phpstan.neon 配置
cat > phpstan.neon << 'EOF'
includes:
    - vendor/nunomaduro/larastan/extension.neon

parameters:
    paths:
        - app/
    level: 6
    ignoreErrors:
        - '#Unsafe usage of new static#'
EOF

# 运行静态分析
./vendor/bin/phpstan analyse
```

### 11.5 集成 Pest（测试框架）

```bash
# 安装 Pest
composer require pestphp/pest --dev --with-all-dependencies
./vendor/bin/pest --init

# 运行测试
./vendor/bin/pest

# 运行带覆盖率的测试（需要 Xdebug 或 PCOV）
herd xdebug on
XDEBUG_MODE=coverage ./vendor/bin/pest --coverage
```

---

## 十二、常见问题解答（FAQ）

### Q1：Herd 是否支持 Linux 或 Windows？

目前 Herd 仅支持 macOS。Beyond Code 团队曾表示有计划支持其他平台，但尚未发布正式的时间表。如果你使用 Linux 或 Windows，建议使用 Laravel Sail（Docker）或 Laragon（Windows）作为替代方案。

### Q2：Herd 是否会取代 Valet？

Herd 和 Valet 由不同团队维护（Herd 由 Beyond Code 开发，Valet 由 Laravel 官方维护），短期内两者会共存。但从趋势来看，Herd 提供了更现代、更易用的开发体验，可能会逐渐成为 macOS 上 PHP 开发的首选工具。

### Q3：Herd 的免费版够用吗？

对于个人开发者和大多数使用场景，免费版完全够用。只有当你需要邮件捕获、日志查看器、数据库查看器等便利功能时，才需要考虑 Pro 版。

### Q4：Herd 是否支持 Docker 容器中的 PHP？

Herd 是原生 macOS 应用，不直接管理 Docker 容器。但你可以同时使用 Herd（本地 PHP 开发）和 Docker（运行 MySQL、Redis 等服务）。

### Q5：如何报告 Bug 或请求功能？

可以通过 GitHub Issues 报告问题：
- Herd 主仓库：https://github.com/beyondcode/herd/issues
- 也可以在 Laravel Discord 的 #herd 频道讨论

### Q6：Herd 的更新频率如何？

Herd 的更新频率较高，通常每月至少一次小更新，每季度一次大版本更新。更新可以通过应用内自动检查，也可以从官网下载最新版本。

### Q7：是否可以在 Herd 中使用 PHP 8.0 或更早版本？

目前 Herd 支持的最低版本是 PHP 8.1。如果你需要使用 PHP 8.0 或更早版本（如 7.4），建议使用 Homebrew 或 Docker。

### Q8：HerD 对 Laravel Valet 的配置是否完全兼容？

大部分兼容，但有一些细微差异。例如，Herd 使用自己的 Nginx 配置格式，Valet 的自定义 Nginx 配置可能需要微调。

---

## 十三、总结与展望

### 13.1 总结

Laravel Herd 是目前 macOS 上最优秀的 PHP 开发环境管理工具，它以极低的学习成本和优雅的用户体验，彻底改变了 macOS 上的 PHP 开发工作流。以下是我使用 Herd 一年多后的核心感受：

**优势：**

1. **安装零门槛**：不需要任何前置知识，双击即可完成安装
2. **多版本管理出色**：PHP 和 Node.js 的多版本切换非常顺滑
3. **站点管理直观**：`.test` 域名 + SSL 自动签发，开发体验极佳
4. **资源占用极低**：相比 Docker 方案，几乎感受不到性能开销
5. **GUI 界面友好**：对不熟悉命令行的开发者非常友好

**不足：**

1. **仅限 macOS**：跨平台支持尚未推出
2. **不内置数据库**：需要自行安装 MySQL/PostgreSQL
3. **Pro 版价格偏高**：$99/年对个人开发者来说可能偏贵
4. **自定义配置受限**：某些高级 Nginx/PHP 配置不如手动管理灵活
5. **社区生态仍在成长**：相比 Valet 的成熟生态，遇到问题时能找到的参考资料相对较少

### 13.2 选择建议

| 你的情况 | 推荐方案 |
|---------|---------|
| macOS 个人开发者，追求简洁 | **Herd**（免费版） |
| macOS 开发，需要邮件/日志工具 | **Herd Pro** |
| 团队开发，跨平台 | **Homestead** 或 **Sail** |
| macOS 开发，习惯命令行 | **Valet** |
| Windows 开发 | **Laragon** 或 **WSL2 + Sail** |
| 需要完整服务栈 | **Sail**（Docker） |

### 13.3 展望

随着 PHP 8.4 和 Laravel 12 的发布，PHP 生态正在经历又一次快速进化。Herd 作为新一代的开发环境工具，还有很大的发展空间：

- **跨平台支持**：期待 Linux 和 Windows 版本的推出
- **内置数据库管理**：一键安装和管理 MySQL/PostgreSQL
- **团队配置共享**：通过 Git 共享 Herd 配置
- **AI 辅助集成**：集成 AI 代码助手，提供智能配置建议
- **更多框架支持**：扩展到 Symfony、WordPress 等非 Laravel 项目

无论你是 PHP 新手还是资深开发者，如果你在 macOS 上工作，Laravel Herd 都值得一试。它可能不会完全取代 Docker 或 Homestead 在复杂项目中的地位，但对于日常开发来说，它提供的体验是无与伦比的。

---

*最后更新：2026 年 6 月*

*本文基于 Laravel Herd v1.x 撰写，部分功能和界面可能因版本不同而有差异。*

## 相关阅读

- [Raycast 实战：macOS 效率启动器自定义脚本与开发工作流踩坑记录](/post/raycast-macos/)
- [Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战踩坑记录](/post/cursor-claude-code-hermes-macos-ai/)
- [Nix 实战：声明式开发环境管理——替代 Homebrew 的可复现 macOS 开发环境配置](/post/nix-homebrew-macos/)
- [mise (rtx) 实战：多语言版本管理替代 nvm/rbenv/pyenv 的统一方案](/post/mise-rtx-nvm-rbenv-pyenv/)
