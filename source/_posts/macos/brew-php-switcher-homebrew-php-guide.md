---

title: brew-php-switcher + Homebrew：macOS 多版本 PHP 管理实战与踩坑记录
keywords: [brew, php, switcher, Homebrew, macOS, 多版本, 管理实战与踩坑记录]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-05 00:55:55
updated: 2026-05-05 00:59:30
categories:
- macos
- tools
tags:
- Laravel
- PHP
- macOS
- Homebrew
- brew-php-switcher
- 版本管理
- Apple Silicon
description: KKday 30+ Laravel 仓库实战经验 | macOS 上 PHP 7.4/8.0/8.1/8.2/8.3 多版本共存的完整方案 | brew-php-switcher 与 Homebrew 原生方式对比 | 真实踩坑记录
---


# brew-php-switcher + Homebrew：macOS 多版本 PHP 管理实战与踩坑记录

## 前言：为什么需要多版本 PHP？

在 KKday 的日常开发中，我同时维护着 30+ 个 Laravel 仓库。有的老项目还跑在 PHP 7.4 上（是的，2026 年了还有），新项目已经用到 PHP 8.3 的 `json_validate()` 和 Typed Class Constants。如果 macOS 上只装一个 PHP 版本，每次切项目就要改配置、重启服务，效率极低。

这篇文章记录了我在 Apple M 系列芯片 Mac 上使用 `brew-php-switcher` + Homebrew 管理多版本 PHP 的完整方案，以及踩过的每一个坑。

---

## 架构总览

```
┌─────────────────────────────────────────────────┐
│                 macOS (Apple Silicon)            │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ PHP 7.4  │  │ PHP 8.0  │  │ PHP 8.3  │      │
│  │(旧项目兼容)│  │(主力版本) │  │(新项目)   │      │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘      │
│        │             │             │             │
│  ┌─────┴─────────────┴─────────────┴─────┐      │
│  │         brew-php-switcher             │      │
│  │      (symlink 切换 /usr/local/bin/php) │      │
│  └───────────────────┬───────────────────┘      │
│                      │                           │
│  ┌───────────────────┴───────────────────┐      │
│  │         Homebrew Services             │      │
│  │   php@7.4-fpm / php@8.0-fpm / ...    │      │
│  └───────────────────────────────────────┘      │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Laravel   │  │ Laravel  │  │ Laravel  │      │
│  │ 项目 A   │  │ 项目 B   │  │ 项目 C   │      │
│  │ PHP 7.4  │  │ PHP 8.0  │  │ PHP 8.3  │      │
│  └──────────┘  └──────────┘  └──────────┘      │
└─────────────────────────────────────────────────┘
```

---

## 一、安装多版本 PHP

### 1.1 添加 PHP 版本 Tap

Homebrew 核心仓库已经移除了旧版 PHP 的 formula，需要通过 `shivammathur/php` tap 来安装：

```bash
# 添加第三方 PHP tap（支持 7.x 旧版本）
brew tap shivammathur/php

# 安装所需版本
brew install shivammathur/php/php@7.4
brew install shivammathur/php/php@8.0
brew install php@8.1
brew install php@8.2
brew install php@8.3
```

> ⚠️ **踩坑 #1**：在 Apple Silicon Mac 上，`shivammathur/php` 的旧版本 formula 有时会编译失败，因为部分依赖（如 `icu4c`）的 ARM64 bottle 不存在。解决方案是先安装 `icu4c` 并手动指定路径：
>
> ```bash
> brew install icu4c
> export PKG_CONFIG_PATH="/opt/homebrew/opt/icu4c/lib/pkgconfig"
> ```

### 1.2 安装 brew-php-switcher

```bash
brew install brew-php-switcher
```

安装完成后，你得到了一个 `phpswitch` 命令，它能一键切换 CLI 和 FPM 的 PHP 版本。

---

## 二、版本切换的两种方式

### 2.1 方式一：brew-php-switcher（推荐）

```bash
# 切换到 PHP 8.0（同时切换 CLI + FPM）
sudo phpswitch 8.0

# 切换到 PHP 8.3
sudo phpswitch 8.3

# 查看当前生效版本
php -v
# PHP 8.3.x (cli) (built: ...)
```

`phpswitch` 的原理是通过 symlink 管理：

```
/usr/local/bin/php -> /opt/homebrew/opt/php@8.3/bin/php
/opt/homebrew/var/log/php-fpm.log -> php@8.3-fpm.log
```

### 2.2 方式二：Homebrew 原生 link/unlink

```bash
# 取消当前版本的链接
brew unlink php@8.0

# 链接目标版本
brew link php@8.3 --force --overwrite

# 重启 FPM
brew services restart php@8.3
```

### 2.3 brew-php-switcher vs Homebrew 原生方式对比

| 维度 | brew-php-switcher (`phpswitch`) | Homebrew 原生 (`brew link/unlink`) |
|------|---------------------------------|-------------------------------------|
| **命令数量** | 1 条命令搞定 | 需要 3 条（unlink → link → restart FPM） |
| **CLI 切换** | ✅ 自动切换 symlink | ✅ 通过 link 切换 |
| **FPM 切换** | ✅ 同时切换 FPM 版本 | ❌ 需手动 `brew services restart` |
| **扩展切换** | ✅ 自动重编译 pecl 扩展 | ❌ 扩展可能跟错版本 |
| **学习成本** | 低，一个命令记住 | 需要理解 link/unlink 机制 |
| **灵活性** | 中等，只能整体切换 | 高，可单独操作 CLI 或 FPM |
| **适用场景** | 开发机快速切版本 | 脚本化/CI 环境精细控制 |
| **安装依赖** | 额外安装一个 formula | 无额外依赖 |

> 💡 **建议**：日常开发用 `phpswitch` 一键切换；CI/CD 或脚本化场景用 `brew link/unlink` 精细控制。两者不冲突，可以混用。

> ⚠️ **踩坑 #2**：`brew link` 在 Apple Silicon 上的路径是 `/opt/homebrew/` 而非 `/usr/local/`。如果你的 `PATH` 里混了两个路径，会出现 `php -v` 显示一个版本、`which php` 指向另一个版本的诡异情况。解决方法：
>
> ```bash
> # 检查所有 php 相关的 symlink
> ls -la /opt/homebrew/bin/php*
> ls -la /usr/local/bin/php*
>
> # 确保 PATH 中 /opt/homebrew/bin 在前
> echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
> ```

---

## 三、FPM 多版本共存与 Nginx 路由

真正的多版本共存不是"切换"，而是**同时运行**多个 FPM，通过 Nginx 的 `fastcgi_pass` 指向不同的 socket。

### 3.1 启动多个 FPM 实例

```bash
# 同时运行多个版本的 FPM
brew services start php@7.4
brew services start php@8.0
brew services start php@8.3

# 确认所有 FPM 都在监听
lsof -i :9074   # php@7.4 → port 9074
lsof -i :9080   # php@8.0 → port 9080
lsof -i :9083   # php@8.3 → port 9083
```

### 3.2 配置各版本 FPM 监听不同端口

编辑各版本的 `www.conf`：

```bash
# PHP 7.4
vim /opt/homebrew/etc/php/7.4/php-fpm.d/www.conf
# listen = 127.0.0.1:9074

# PHP 8.0
vim /opt/homebrew/etc/php/8.0/php-fpm.d/www.conf
# listen = 127.0.0.1:9080

# PHP 8.3
vim /opt/homebrew/etc/php/8.3/php-fpm.d/www.conf
# listen = 127.0.0.1:9083
```

### 3.3 Nginx 按项目路由

```nginx
# 旧项目 A — PHP 7.4
server {
    listen 8080;
    server_name project-a.local;
    root /Users/michael/Projects/project-a/public;

    location ~ \.php$ {
        fastcgi_pass 127.0.0.1:9074;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}

# 新项目 C — PHP 8.3
server {
    listen 8082;
    server_name project-c.local;
    root /Users/michael/Projects/project-c/public;

    location ~ \.php$ {
        fastcgi_pass 127.0.0.1:9083;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

**架构图：Nginx 多版本路由**

```
                    ┌──────────────┐
                    │    Nginx     │
                    │  (统一入口)   │
                    └──┬───┬───┬──┘
                       │   │   │
           ┌───────────┘   │   └───────────┐
           ▼               ▼               ▼
    :8080/project-a  :8081/project-b  :8082/project-c
           │               │               │
           ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ FPM 7.4  │   │ FPM 8.0  │   │ FPM 8.3  │
    │ :9074    │   │ :9080    │   │ :9083    │
    └──────────┘   └──────────┘   └──────────┘
```

---

## 四、每个项目锁定 PHP 版本：.php-version + direnv

手动切换版本容易出错。我的做法是在每个 Laravel 项目根目录放一个 `.php-version` 文件，配合 `direnv` 自动设置 `PATH`：

### 4.1 安装 direnv

```bash
brew install direnv
# 在 .zshrc 中添加 hook
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
```

### 4.2 项目级配置

```bash
# 在项目根目录
echo "8.0" > .php-version

# 创建 .envrc（direnv 配置）
cat > .envrc << 'EOF'
# 根据 .php-version 切换 PHP
PHP_VERSION=$(cat .php-version)
export PATH="/opt/homebrew/opt/php@${PHP_VERSION}/bin:$PATH"
export PATH="/opt/homebrew/opt/php@${PHP_VERSION}/sbin:$PATH"

# 验证
echo "✓ PHP $(php -r 'echo PHP_VERSION;') activated for this project"
EOF

# 允许 direnv 加载
direnv allow
```

现在，每次 `cd` 进入项目目录，PHP 版本会自动切换：

```bash
cd ~/Projects/legacy-project
# direnv: export +PATH ...
# ✓ PHP 7.4.33 activated for this project

php -v
# PHP 7.4.33 (cli) ...

cd ~/Projects/new-project
# ✓ PHP 8.3.6 activated for this project

php -v
# PHP 8.3.6 (cli) ...
```

> ⚠️ **踩坑 #3**：`direnv` 的 `.envrc` 不支持 `sudo`，所以它只能切换 CLI 版本，**无法切换 FPM**。如果你需要本地跑 `php artisan serve` 或通过 Nginx 访问，FPM 版本仍然需要手动用 `brew services` 管理。这就是为什么我在第三节建议同时运行多个 FPM 实例。

---

## 五、Composer 与 PHP 版本的联动

### 5.1 Composer Platform Config

在 `composer.json` 中锁定平台版本，防止在错误的 PHP 版本下安装依赖：

```json
{
    "config": {
        "platform": {
            "php": "8.0.0"
        },
        "sort-packages": true
    }
}
```

> ⚠️ **踩坑 #4**：`platform.php` 只影响依赖解析，**不影响实际运行时版本**。也就是说，即使你设置了 `"php": "8.0.0"`，Composer 仍然会在 PHP 8.3 下执行，只是解析依赖时假装自己是 8.0。如果你用了 8.3 才有的函数（如 `json_validate()`），在 8.0 环境下会直接报错。真正的保障要靠 CI 矩阵测试。

### 5.2 多版本 Composer 命令

如果需要在特定版本下运行 Composer：

```bash
# 用 PHP 7.4 运行 composer update
/opt/homebrew/opt/php@7.4/bin/php /usr/local/bin/composer update

# 或者更简洁的方式
php7.4 $(which composer) update
```

---

## 六、常见踩坑汇总

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | `brew install php@7.4` 编译失败 | Apple Silicon 缺少 ARM64 bottle | 使用 `shivammathur/php` tap |
| 2 | `php -v` 和 `which php` 版本不一致 | PATH 中有多个 php 路径 | 统一用 `/opt/homebrew/bin` |
| 3 | direnv 切换了 CLI 但 FPM 没变 | direnv 不支持 sudo/服务管理 | 多 FPM 实例 + Nginx 路由 |
| 4 | Composer 在错误版本下安装了不兼容包 | platform config 只影响解析 | CI 矩阵测试兜底 |
| 5 | `brew upgrade` 后 PHP 版本变了 | 升级可能重新 link | 升级后重新 `phpswitch` |
| 6 | `pecl install` 装到了错误版本 | pecl 跟随当前 CLI 版本 | 用完整路径：`/opt/homebrew/opt/php@8.0/bin/pecl install xxx` |

> ⚠️ **踩坑 #5**：这是最隐蔽的一个。某天 `brew upgrade` 后，我的 CLI PHP 从 8.0 跳到了 8.3，导致 Laravel Octane（Swoole 扩展）直接崩了，因为 Swoole 是为 8.0 编译的。解决方案：
>
> ```bash
> # 升级后重新编译扩展
> brew reinstall shivammathur/extensions/swoole@8.0
>
> # 或者更好的做法：锁定 PHP 版本不被升级
> brew pin php@8.0
> ```
>
> ⚠️ **踩坑 #6**：`pecl install` 默认跟随当前 CLI 的 PHP 版本。如果你要给 PHP 7.4 装 `redis` 扩展，但 CLI 是 8.3，执行 `pecl install redis` 会装到 8.3 下。必须用完整路径：
>
> ```bash
> /opt/homebrew/opt/php@7.4/bin/pecl install redis
> ```

---

## 七、我的日常工作流（推荐）

```
项目目录结构：
~/Projects/
├── legacy-api/          (.php-version: 7.4)
├── member-service/      (.php-version: 8.0)
├── search-bff/          (.php-version: 8.0)
└── new-project/         (.php-version: 8.3)

日常工作流：
1. cd ~/Projects/legacy-api
2. direnv 自动切换 → PHP 7.4
3. php artisan serve (CLI 是 7.4 ✓)
4. 浏览器访问 → Nginx → FPM 7.4 (:9074) ✓

切换项目：
1. cd ~/Projects/new-project
2. direnv 自动切换 → PHP 8.3
3. 继续开发，无需手动干预
```

**一键状态检查脚本**（放在 `~/bin/php-status`）：

```bash
#!/bin/bash
echo "=== PHP Version Status ==="
echo ""
echo "CLI PHP:"
php -v 2>/dev/null | head -1 || echo "  (not found)"
echo ""
echo "Active FPM Services:"
brew services list | grep php | while read line; do
    echo "  $line"
done
echo ""
echo "Listening Ports:"
for port in 9074 9080 9081 9082 9083; do
    pid=$(lsof -ti :$port 2>/dev/null)
    if [ -n "$pid" ]; then
        proc=$(ps -p $pid -o comm= 2>/dev/null)
        echo "  :$port → $proc (PID: $pid)"
    fi
done
```

输出示例：

```
=== PHP Version Status ===

CLI PHP:
  PHP 8.3.6 (cli) (built: Apr  2 2026 14:23:00)

Active FPM Services:
  php@7.4 started michael ~/Library/LaunchAgents/homebrew.mxcl.php@7.4.plist
  php@8.0 started michael ~/Library/LaunchAgents/homebrew.mxcl.php@8.0.plist
  php@8.3 started michael ~/Library/LaunchAgents/homebrew.mxcl.php@8.3.plist

Listening Ports:
  :9074 → php-fpm (PID: 12345)
  :9080 → php-fpm (PID: 12367)
  :9083 → php-fpm (PID: 12389)
```

---

## 总结

| 场景 | 推荐方案 |
|------|----------|
| 快速切换 CLI 版本 | `brew-php-switcher` (`sudo phpswitch 8.0`) |
| 项目级自动切换 | `.php-version` + `direnv` |
| 多项目同时跑不同 FPM | 多 FPM 实例 + Nginx 端口路由 |
| 防止 brew upgrade 搞乱 | `brew pin php@8.0` |
| 扩展安装到指定版本 | 用完整路径的 `pecl` / `phpize` |

在 30+ 仓库的实战中，这套方案让我几乎不需要思考"当前是什么 PHP 版本"这个问题——`direnv` 自动处理 CLI，Nginx 配置固定 FPM 路由，各司其职。唯一的成本是首次配置需要花 30 分钟理清各版本的端口和路径，但之后的开发体验提升是质的飞跃。

---

*本文基于 macOS Ventura / Sonoma + Apple M2 芯片 + Homebrew 4.x 实战编写。Intel Mac 用户路径为 `/usr/local/` 而非 `/opt/homebrew/`，其余逻辑相同。*

## 相关阅读

- [Hermes Agent 实战：多平台 AI 助手配置与使用——从零搭建个人 AI 工作流踩坑记录](/categories/macOS/hermes-agent-guide-ai/)
- [LM Studio + Ollama：M 芯片 Mac 上的本地大模型实战（Laravel BFF 开发者视角）](/categories/macOS/lm-studio-ollama-m-guide-laravel-bff/)
- [Ghostty 终端实战：下一代 GPU 加速终端 emulator 配置与 Laravel 开发效率提升踩坑记录](/categories/macOS/ghostty-guide-gpu-emulatorlaravel/)
