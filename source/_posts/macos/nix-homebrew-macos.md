---

title: Nix 实战：声明式开发环境管理——替代 Homebrew 的可复现 macOS 开发环境配置
keywords: [Nix, Homebrew, macOS, 声明式开发环境管理, 替代, 的可复现, 开发环境配置]
date: 2026-06-03 10:00:00
description: Nix 是跨平台声明式包管理器，通过 /nix/store 实现可复现开发环境。本文从零搭建 macOS 上基于 Nix Flakes + devenv.sh 的开发环境，覆盖 PHP、Node.js、Go、Redis 等工具链，深度对比 Nix vs Homebrew vs mise 方案优劣，附带 Apple Silicon 踩坑记录、direnv 自动切换、CI/CD 集成与团队协作方案，帮你彻底告别「在我机器上能跑」的困境。
tags:
- Nix
- macOS
- Homebrew
- 开发环境
- DevOps
- 声明式
- devenv
- flakes
- 可复现
categories:
- macos
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
---



> **TL;DR**：Nix 是一个跨平台的声明式包管理器，通过 `/nix/store` 实现完全可复现、原子化回滚、多版本共存的开发环境。本文将从零开始，在 macOS 上搭建一套基于 Nix Flakes + devenv.sh 的开发环境，覆盖 PHP、Node.js、Go、Redis 等常用工具链，并与 Homebrew、mise 进行深度对比，附带踩坑记录与团队协作方案。

---

## 一、为什么我们需要替代 Homebrew？

### 1.1 Homebrew 的隐痛

Homebrew 是 macOS 上最流行的包管理器，但它在团队协作和生产环境管理中暴露出几个根本性问题：

- **不可复现**：`brew install php` 在不同时间、不同机器上安装的版本可能完全不同
- **全局污染**：所有包共享 `/usr/local` 或 `/opt/homebrew` 前缀，版本冲突频繁
- **无回滚机制**：`brew upgrade` 一旦出问题，很难精确回退到之前的状态
- **隐式依赖**：包的依赖关系不透明，升级一个包可能连带改变其他包的行为

### 1.2 Nix 的核心理念

Nix 由 Eelco Dolstra 在 2003 年的博士论文中提出，其核心思想是**函数式包管理**——将每个包的构建过程视为一个纯函数，输入（源码、依赖、编译选项）相同，输出必然相同。

```
┌─────────────────────────────────────────────────┐
│                  Nix 核心原理                      │
├─────────────────────────────────────────────────┤
│                                                   │
│  Source + Dependencies + Build Script             │
│          │                                        │
│          ▼                                        │
│  ┌─────────────────┐                              │
│  │  Derivation      │  ← 纯函数，确定性构建        │
│  │  (构建描述)       │                              │
│  └────────┬────────┘                              │
│           ▼                                       │
│  ┌─────────────────────────────────┐              │
│  │  /nix/store/<hash>-<name>-<ver> │  ← 唯一路径   │
│  └─────────────────────────────────┘              │
│                                                   │
│  特性：                                            │
│  • 原子化安装/卸载                                  │
│  • 多版本并行共存                                   │
│  • 秒级回滚                                        │
│  • 完全可复现                                      │
└─────────────────────────────────────────────────┘
```

---

## 二、核心概念速览

### 2.1 Nix 与 Nixpkgs

| 概念 | 说明 |
|------|------|
| **Nix** | 包管理器本身，负责解析表达式、构建 Derivation、管理 `/nix/store` |
| **Nixpkgs** | Nix 包集合仓库，包含超过 80,000 个软件包定义 |
| **NixOS** | 基于 Nix 的 Linux 发行版，系统配置也完全声明式 |
| **Flakes** | Nix 的新一代项目结构标准，用于锁定依赖版本 |
| **nix-shell** | 临时进入一个包含指定包的 shell 环境 |
| **nix develop** | Flakes 时代的开发环境入口 |

### 2.2 Nix 语言基础

Nix 语言是一种惰性求值的函数式语言，专门用于描述包的构建方式：

```nix
# Nix 表达式的基本语法
{
  # 属性集 (Attribute Set)
  name = "my-project";
  version = "1.0.0";

  # 函数定义
  greet = name: "Hello, ${name}!";

  # 列表
  dependencies = [ "php" "nodejs" "redis" ];

  # Let 绑定
  pkgs = import <nixpkgs> {};
  python = pkgs.python311;
}
```

---

## 三、macOS 安装 Nix

### 3.1 官方安装器

```bash
# 方式一：官方安装脚本（推荐）
curl -L https://nixos.org/nix/install | sh

# 方式二：使用 Determinate Systems 安装器（更友好，支持卸载）
curl --proto '=https' --tlsv1.2 -sSf -L \
  https://install.determinate.systems/nix | sh -s -- install
```

> **提示**：Determinate Systems 的安装器提供了更友好的卸载脚本，推荐初次使用者使用。

安装完成后，重新打开终端：

```bash
# 验证安装
nix --version
# nix (Nix) 2.24.10

# 查看 Nix Store 状态
nix store info
```

### 3.2 启用 Flakes

Flakes 是 Nix 的未来方向，但默认尚未启用。编辑 `~/.config/nix/nix.conf`：

```ini
# ~/.config/nix/nix.conf
experimental-features = nix-command flakes
extra-substituters = https://nix-community.cachix.org
trusted-public-keys = nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=
```

```bash
# 重启 nix-daemon 使配置生效
sudo launchctl stop org.nixos.nix-daemon
sudo launchctl start org.nixos.nix-daemon
```

### 3.3 macOS 特有配置

在 macOS 上，Nix 需要特别关注以下配置：

```ini
# ~/.config/nix/nix.conf（macOS 完整配置）
experimental-features = nix-command flakes
extra-substituters = https://nix-community.cachix.org
trusted-public-keys = nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=

# Apple Silicon 需要确认系统是 aarch64-darwin
# Intel Mac 对应 x86_64-darwin
system = aarch64-darwin  # Apple Silicon
# system = x86_64-darwin   # Intel Mac
```

---

## 四、从 nix-shell 到 nix develop

### 4.1 传统方式：nix-shell

`nix-shell` 是经典的开发环境入口，适合快速试验：

```bash
# 进入包含 Node.js 20 和 PHP 8.3 的临时环境
nix-shell -p nodejs_20 php83

# 在这个 shell 中，node 和 php 命令可用
node --version   # v20.x.x
php --version    # PHP 8.3.x

# 退出后，这些命令不再可用
exit
```

通过 `shell.nix` 文件定义更复杂的环境：

```nix
# shell.nix — 传统开发环境定义
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "my-dev-env";

  # 基础包列表
  packages = with pkgs; [
    php83
    php83Packages.composer
    nodejs_20
    redis
    mysql80
    git
    curl
    jq
  ];

  # Shell 启动时执行的钩子
  shellHook = ''
    echo "🚀 开发环境已就绪！"
    echo "  PHP: $(php --version | head -1)"
    echo "  Node: $(node --version)"
    echo "  Redis: $(redis-server --version)"

    # 设置项目特定的环境变量
    export APP_ENV=local
    export DB_HOST=127.0.0.1
    export REDIS_HOST=127.0.0.1
  '';
}
```

### 4.2 现代方式：Flakes + nix develop

Flakes 提供了更规范的项目结构和依赖锁定：

```nix
# flake.nix — Flakes 时代的开发环境定义
{
  description = "Laravel 全栈开发环境";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          name = "laravel-dev";

          packages = with pkgs; [
            # PHP 生态
            php83
            php83Packages.composer
            php83Packages.phpstan
            php83Packages.php-cs-fixer

            # Node.js 生态
            nodejs_20
            nodePackages.npm
            nodePackages.pnpm

            # 数据库 & 缓存
            redis
            mysql80

            # 工具链
            git
            gh
            curl
            jq
            httpie
          ];

          shellHook = ''
            export APP_ENV=local
            export DB_CONNECTION=mysql
            export DB_HOST=127.0.0.1
            export DB_PORT=3306
            export REDIS_HOST=127.0.0.1
            export REDIS_PORT=6379

            echo "✅ Laravel 开发环境已激活"
            echo "  PHP $(php --version | head -1)"
            echo "  Node $(node --version)"
            echo "  Composer $(composer --version | cut -d' ' -f3)"
          '';
        };
      });
}
```

进入环境：

```bash
# 首次进入（会生成 flake.lock 锁定所有依赖版本）
nix develop

# 之后每次进入，环境完全一致
nix develop
```

### 4.3 nix-shell vs nix develop 对比

| 特性 | nix-shell | nix develop |
|------|-----------|-------------|
| 配置文件 | `shell.nix` | `flake.nix` |
| 依赖锁定 | ❌ 不锁定 | ✅ `flake.lock` |
| 可复现性 | 取决于 nixpkgs 频道 | 完全可复现 |
| 推荐程度 | 旧项目维护 | 新项目首选 |

---

## 五、实战：Flakes 管理多语言开发环境

### 5.1 PHP + Node.js + Go 全栈项目

真实项目往往需要多种语言运行时。以下是一个全栈项目的 `flake.nix`：

```nix
# flake.nix — 多语言全栈开发环境
{
  description = "全栈开发环境：PHP + Go + Node.js";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # PHP 8.3 + 常用扩展
        php = pkgs.php83.withExtensions ({ enabled, all }:
          enabled ++ [
            all.redis
            all.imagick
            all.xdebug
            all.swoole
            all.pcov
          ]
        );
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            # PHP
            php
            pkgs.php83Packages.composer

            # Go
            pkgs.go_1_22
            pkgs.golangci-lint
            pkgs.gopls

            # Node.js
            pkgs.nodejs_20
            pkgs.nodePackages.pnpm
            pkgs.nodePackages.typescript

            # 数据库
            pkgs.redis
            pkgs.postgresql_16
            pkgs.sqlite

            # 工具
            pkgs.git
            pkgs.gh
            pkgs.curl
            pkgs.jq
            pkgs.yq
            pkgs.direnv
          ];

          shellHook = ''
            echo "========================================="
            echo "  🚀 全栈开发环境"
            echo "========================================="
            echo "  PHP      $(php --version | head -1)"
            echo "  Go       $(go version | cut -d' ' -f3)"
            echo "  Node.js  $(node --version)"
            echo "  Redis    $(redis-server --version | cut -d' ' -f4)"
            echo "  PostgreSQL $(postgres -V | cut -d' ' -f3)"
            echo "========================================="

            # 项目环境变量
            export GOPATH="$PWD/.go"
            export PATH="$GOPATH/bin:$PATH"
            export DATABASE_URL="postgresql://localhost:5432/myapp"
            export REDIS_URL="redis://localhost:6379"
          '';
        };
      });
}
```

### 5.2 管理特定版本的软件

Nix 的一大优势是可以在 `nixpkgs` 中选择特定版本：

```nix
# 选择特定版本的 PHP
let
  # 方式一：使用 nixpkgs 默认提供的版本
  php82 = pkgs.php82;
  php83 = pkgs.php83;
  php84 = pkgs.php84;  # 如果 nixpkgs 已包含

  # 方式二：通过 overlay 覆盖版本
  customPhp = pkgs.php83.buildEnv {
    extensions = { all, enabled }: enabled ++ [ all.xdebug all.redis ];
    extraConfig = ''
      memory_limit = 512M
      xdebug.mode = debug
    '';
  };
in
{
  devShells.default = pkgs.mkShell {
    packages = [ customPhp ];
  };
}
```

### 5.3 使用 direnv 实现自动环境切换

`direnv` 可以在进入项目目录时自动激活 Nix 环境：

```bash
# 安装 direnv
nix profile install nixpkgs#direnv

# 在 .bashrc 或 .zshrc 中添加 hook
eval "$(direnv hook zsh)"  # zsh
eval "$(direnv hook bash)" # bash
```

创建 `.envrc` 文件：

```bash
# .envrc（项目根目录）
use flake
```

```bash
# 让 direnv 信任此配置
direnv allow

# 现在 cd 进入项目目录时，Nix 环境自动激活
cd ~/Projects/my-app
# 输出: direnv: loading .envrc
# 输出: direnv: using flake
# 输出: direnv: export +AR +AS +CC +...
```

---

## 六、devenv.sh：更友好的开发环境管理

### 6.1 什么是 devenv.sh

[devenv.sh](https://devenv.sh) 是建立在 Nix 之上的开发环境框架，提供了更简洁的配置语法和开箱即用的服务管理：

```bash
# 安装 devenv
nix profile install nixpkgs#devenv
```

### 6.2 Laravel 项目的 devenv 配置

```nix
# devenv.nix — Laravel 项目开发环境
{ pkgs, ... }:

{
  # 语言运行时
  languages.php = {
    enable = true;
    version = "8.3";

    # PHP 扩展
    extensions = [
      "redis"
      "imagick"
      "xdebug"
      "swoole"
      "pcov"
      "bcmath"
      "gd"
      "intl"
      "zip"
    ];

    # php.ini 配置
    ini = ''
      memory_limit = 512M
      upload_max_filesize = 64M
      post_max_size = 64M
      xdebug.mode = develop,debug
      xdebug.client_host = localhost
      xdebug.client_port = 9003
    '';

    # 全局 Composer 包
    packages = [ pkgs.php83Packages.composer ];
  };

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_20;
    npm.enable = true;
    pnpm.enable = true;
  };

  # 服务管理
  services.redis.enable = true;

  services.mysql = {
    enable = true;
    package = pkgs.mysql80;
    initialDatabases = [
      { name = "laravel_app"; }
    ];
    ensureUsers = [
      {
        name = "laravel";
        password = "secret";
        ensurePermissions = {
          "laravel_app.*" = "ALL PRIVILEGES";
        };
      }
    ];
  };

  # 进程管理（类似 Procfile）
  processes = {
    # Laravel 队列工作进程
    queue-worker = {
      exec = "php artisan queue:work redis --sleep=3 --tries=3";
      process-compose = {
        availability.restart = "on_failure";
      };
    };

    # Vite 开发服务器
    vite = {
      exec = "npm run dev";
    };
  };

  # Enter Shell 时的钩子
  enterShell = ''
    echo "🦞 Laravel 开发环境已就绪"
    echo ""
    echo "  PHP       $(php --version | head -1)"
    echo "  Composer  $(composer --version | cut -d' ' -f3)"
    echo "  Node.js   $(node --version)"
    echo "  MySQL     $(mysql --version | cut -d' ' -f6)"
    echo "  Redis     $(redis-server --version | cut -d' ' -f4)"
    echo ""

    # 设置 Laravel 环境变量
    export APP_ENV=local
    export APP_DEBUG=true
    export DB_CONNECTION=mysql
    export DB_HOST=127.0.0.1
    export DB_PORT=3306
    export DB_DATABASE=laravel_app
    export DB_USERNAME=laravel
    export DB_PASSWORD=secret
    export REDIS_HOST=127.0.0.1
    export CACHE_DRIVER=redis
    export SESSION_DRIVER=redis
    export QUEUE_CONNECTION=redis
  '';
}
```

还需要一个 `devenv.yaml` 来指定输入源：

```yaml
# devenv.yaml
inputs:
  nixpkgs:
    url: github:NixOS/nixpkgs/nixos-24.11

# 启用 Flakes 集成
allowUnfree: true
```

启动环境：

```bash
# 进入开发环境（首次会较慢，需要构建缓存）
devenv shell

# 启动所有服务
devenv up

# 查看服务状态
devenv processes
```

### 6.3 devenv.sh 的优势

```
┌──────────────────────────────────────────────────────┐
│              devenv.sh vs 原生 Nix                    │
├──────────────────┬───────────────────────────────────┤
│ 特性             │ 说明                               │
├──────────────────┼───────────────────────────────────┤
│ 语言预设         │ languages.php/node/go 等一行启用   │
│ 服务管理         │ services.redis/mysql/postgres      │
│ 进程编排         │ processes.xxx 定义后台任务          │
│ 秘密管理         │ 支持与 sops-nix 集成              │
│ CI 集成          │ devenv ci 直接在 CI 中使用         │
│ 缓存             │ 自动使用 Cachix 二进制缓存         │
└──────────────────┴───────────────────────────────────┘
```

---

## 七、团队协作：.nix 文件即文档

### 7.1 将 .nix 文件纳入版本控制

Nix 最大的团队协作优势在于：**开发环境定义就是代码**。

```
my-project/
├── flake.nix          # 环境定义（必须提交）
├── flake.lock         # 依赖锁定（必须提交）
├── .envrc             # direnv 配置（必须提交）
├── .gitignore
├── src/
└── ...
```

```bash
# .gitignore 中确保提交 flake.lock
# NOT: flake.lock  ← 不要忽略它！
```

### 7.2 新成员入职流程

传统方式（Homebrew）：
```bash
# 旧方式：手动安装，祈祷版本一致
brew install php node redis mysql
brew services start redis
brew services start mysql
# "我装的是 PHP 8.2，你的是 8.3？composer 报错了..."
```

Nix 方式：
```bash
# 新方式：一条命令，环境完全一致
git clone git@github.com:team/project.git
cd project
nix develop  # 或 direnv 自动激活

# 如果使用 direnv，只需：
cd project   # 自动激活，零配置
```

### 7.3 CI/CD 集成

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest  # 或 ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: cachix/install-nix-action@v27
        with:
          nix_path: nixpkgs=channel:nixos-unstable

      - uses: cachix/cachix-action@v15
        with:
          name: my-project
          authToken: '${{ secrets.CACHIX_AUTH_TOKEN }}'

      - name: Run tests
        run: |
          nix develop --command bash -c "
            composer install
            npm ci
            php artisan test
            npm run test
          "
```

---

## 八、NixOS 概念延伸

虽然我们在 macOS 上使用 Nix，但了解 NixOS 有助于理解完整的声明式系统管理理念：

```nix
# NixOS 系统配置示例（仅作概念展示）
# /etc/nixos/configuration.nix
{ config, pkgs, ... }:

{
  # 整个操作系统由这个文件定义
  boot.loader.systemd-boot.enable = true;
  networking.hostName = "dev-machine";
  time.timeZone = "Asia/Shanghai";

  # 系统级包
  environment.systemPackages = with pkgs; [
    vim
    git
    docker
  ];

  # 服务配置
  services.nginx = {
    enable = true;
    virtualHosts."myapp.local" = {
      root = "/var/www/myapp";
    };
  };

  services.postgresql = {
    enable = true;
    package = pkgs.postgresql_16;
  };

  # 用户配置
  users.users.developer = {
    isNormalUser = true;
    extraGroups = [ "wheel" "docker" ];
  };
}
```

**关键点**：NixOS 的系统配置文件可以像应用的 `flake.nix` 一样进行版本控制和团队共享，实现"基础设施即代码"的终极形态。

---

## 九、踩坑记录（macOS 特有）

### 坑 1：Apple Silicon 架构问题

**现象**：在 Apple Silicon Mac 上安装 Nix 后，某些包编译失败或提示找不到。

**原因**：Nix 需要明确知道目标架构是 `aarch64-darwin`。

**解决方案**：

```bash
# 确认当前系统架构
uname -m
# 应该输出 arm64（对应 Nix 的 aarch64-darwin）

# 在 flake.nix 中显式指定系统
{
  outputs = { self, nixpkgs, flake-utils }:
    # eachDefaultSystem 会自动处理 aarch64-darwin 和 x86_64-darwin
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        # ...
      });
}

# 如果需要同时支持 Intel Mac 和 Apple Silicon：
# 使用 eachDefaultSystem 会自动生成两个系统的配置
```

### 坑 2：/nix/store 权限与磁盘空间

**现象**：`/nix/store` 体积增长过快，占用大量磁盘空间。

**解决方案**：

```bash
# 查看 Nix Store 大小
du -sh /nix/store

# 清理未使用的构建产物（保留最近 30 天）
nix store gc --max 50G  # 限制 Store 最大 50GB

# 清理旧的 generations（profile 版本记录）
nix profile wipe-history --older-than 14d

# 查看当前 profile 的所有 generation
nix profile history

# 回滚到上一个 generation
nix profile rollback
```

### 坑 3：macOS SDK 版本不匹配

**现象**：编译某些 C/C++ 包时报错 `SDK version mismatch`。

**原因**：Nix 内置的 macOS SDK 版本与系统 Xcode 版本不匹配。

**解决方案**：

```nix
# 在 flake.nix 中使用特定版本的 SDK
let
  pkgs = import nixpkgs {
    inherit system;
    # 使用 macOS 13 SDK（适用于大多数现代 macOS）
    overlays = [
      (final: prev: {
        darwin = prev.darwin // {
          apple_sdk = prev.darwin.apple_sdk_13_0;
        };
      })
    ];
  };
in
# ...
```

### 坑 4：Nix Daemon 在 macOS 上的权限问题

**现象**：`nix-env` 或 `nix build` 报错 `error: creating directory '/nix/store': Operation not permitted`。

**解决方案**：

```bash
# 确认 nix-daemon 正在运行
sudo launchctl list | grep nix

# 如果没有运行，重新启动
sudo launchctl load /Library/LaunchDaemons/org.nixos.nix-daemon.plist

# 确认当前用户在 nixbld 组中
dscl . -read /Groups/nixbld GroupMembership

# 如果不在，添加用户
sudo dseditgroup -o edit -a $(whoami) -t user nixbld
```

### 坑 5：Homebrew 与 Nix 的 PATH 冲突

**现象**：安装了 Nix 后，Homebrew 安装的工具和 Nix 安装的工具冲突。

**解决方案**：

```bash
# 方案一：优先使用 Nix，在 shell 配置中调整 PATH 顺序
# ~/.zshrc
export PATH="$HOME/.nix-profile/bin:$PATH"
# 确保 Nix 路径在 Homebrew 路径之前

# 方案二：彻底迁移到 Nix，逐步移除 Homebrew
# 列出所有 Homebrew 包
brew list --formula

# 在 Nix 中找到对应包
nix search nixpkgs#<package-name>

# 方案三：使用 home-manager 管理 macOS 应用
# 可以管理 GUI 应用（通过 Homebrew cask 安装的）
```

### 坑 6：首次构建缓慢

**现象**：第一次 `nix develop` 可能耗时数分钟甚至数十分钟。

**解决方案**：

```bash
# 使用 Cachix 二进制缓存，避免本地编译
nix develop --option substituters "https://nix-community.cachix.org https://cache.nixos.org"

# 推荐：为项目配置 Cachix
# 1. 注册 cachix.org 账号
# 2. 创建缓存
cachix authtoken <your-token>
cachix push my-project-cache  # 推送构建结果

# 3. 在 flake.nix 中配置
{
  nixConfig = {
    extra-substituters = [ "https://my-project-cache.cachix.org" ];
    extra-trusted-public-keys = [
      "my-project-cache.cachix.org-1:..."
    ];
  };
}
```

---

## 十、横向对比：Homebrew vs Nix vs mise

### 10.1 功能对比表

| 维度 | Homebrew | Nix | mise (原 rtx) |
|------|----------|-----|---------------|
| **安装方式** | `/opt/homebrew` (ARM) | `/nix/store` | `~/.local/share/mise` |
| **版本锁定** | ❌ 部分支持 | ✅ flake.lock | ✅ `.tool-versions` |
| **多版本共存** | ❌ 困难 | ✅ 原生支持 | ✅ 每目录版本 |
| **可复现性** | ❌ 弱 | ✅ 强（哈希保证） | ⚠️ 中等 |
| **回滚** | ❌ 不支持 | ✅ 一键回滚 | ❌ 不支持 |
| **GUI 应用** | ✅ Cask | ⚠️ 需 home-manager | ❌ 不支持 |
| **学习曲线** | ⭐ 低 | ⭐⭐⭐⭐ 高 | ⭐⭐ 低 |
| **包数量** | ~7,000 | ~80,000+ | ~100（仅版本管理器） |
| **构建时间** | 预编译 | 有二进制缓存 | 不涉及构建 |
| **语言版本管理** | ⚠️ 有限 | ✅ 完整 | ✅ 核心功能 |
| **团队协作** | ❌ 无标准 | ✅ .nix 文件即文档 | ✅ .tool-versions |
| **隔离性** | ❌ 全局 | ✅ 完全隔离 | ✅ shim 隔离 |
| **CI/CD 集成** | ⚠️ 需预装 | ✅ 原生支持 | ✅ 简单集成 |

### 10.2 选择建议

```
你的需求是什么？

├── 只需要切换 Node/Python/Go 版本？
│   └── → 使用 mise，简单高效
│
├── 需要管理完整的开发环境（PHP + Redis + MySQL + ...）？
│   └── → 使用 Nix + devenv.sh
│
├── 需要安装 macOS GUI 应用（Chrome、VS Code 等）？
│   └── → 继续使用 Homebrew Cask
│
├── 团队协作、CI/CD 一致性要求高？
│   └── → 使用 Nix Flakes
│
└── 想要一个全能方案？
    └── → Nix（环境）+ Homebrew Cask（GUI 应用）+ mise（快速切换）
```

### 10.3 混合使用方案

实际上，很多开发者选择混合使用：

```bash
# ~/.zshrc 示例：Nix + Homebrew + mise 混合使用

# 1. Nix 管理核心开发工具
# 通过 direnv 自动在项目级别激活

# 2. Homebrew 只管理 GUI 应用
# brew install --cask rectangle raycast visual-studio-code

# 3. mise 用于快速切换语言版本（非项目级）
# mise use -g node@22
# mise use -g python@3.12
```

---

## 十一、进阶：home-manager 管理用户级配置

`home-manager` 是 Nix 生态中管理用户级配置（dotfiles、shell 配置等）的工具：

```nix
# home.nix — 用户配置管理
{ config, pkgs, ... }:

{
  # 用户级包
  home.packages = with pkgs; [
    ripgrep
    fd
    bat
    eza
    zoxide
    fzf
    lazygit
  ];

  # Git 配置
  programs.git = {
    enable = true;
    userName = "Your Name";
    userEmail = "you@example.com";
    aliases = {
      st = "status";
      co = "checkout";
      br = "branch";
      ci = "commit";
    };
    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
    };
  };

  # Zsh 配置
  programs.zsh = {
    enable = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    shellAliases = {
      ll = "eza -la --git";
      cat = "bat";
      find = "fd";
      grep = "rg";
    };
    initExtra = ''
      eval "$(zoxide init zsh)"
      eval "$(fzf --zsh)"
    '';
  };

  # Starship 提示符
  programs.starship = {
    enable = true;
    settings = {
      character = {
        success_symbol = "[➜](bold green)";
        error_symbol = "[✗](bold red)";
      };
    };
  };
}
```

---

## 十二、实战：完整项目模板

### 12.1 目录结构

```
laravel-nix-project/
├── .envrc                 # direnv 配置
├── .github/
│   └── workflows/
│       └── ci.yml         # CI 配置
├── flake.nix              # Nix 环境定义
├── flake.lock             # 依赖锁定（必须提交）
├── devenv.nix             # devenv 配置（可选）
├── devenv.yaml            # devenv 输入源（可选）
├── devenv.lock            # devenv 锁定（可选）
├── composer.json
├── package.json
├── artisan
└── src/
    └── ...
```

### 12.2 一键初始化脚本

```bash
#!/bin/bash
# scripts/setup-nix-dev.sh — 新成员一键初始化

set -euo pipefail

echo "🔧 检查 Nix 安装..."
if ! command -v nix &> /dev/null; then
    echo "❌ Nix 未安装，正在安装..."
    curl --proto '=https' --tlsv1.2 -sSf -L \
        https://install.determinate.systems/nix | sh -s -- install
    echo "✅ Nix 安装完成，请重新打开终端后运行此脚本"
    exit 0
fi

echo "✅ Nix 已安装: $(nix --version)"

echo "🔧 检查 direnv..."
if ! command -v direnv &> /dev/null; then
    echo "📦 安装 direnv..."
    nix profile install nixpkgs#direnv
fi

echo "🔧 检查 devenv..."
if ! command -v devenv &> /dev/null; then
    echo "📦 安装 devenv..."
    nix profile install nixpkgs#devenv
fi

echo "🔧 配置 direnv hook..."
SHELL_RC="$HOME/.zshrc"
[[ "$SHELL" == */bash ]] && SHELL_RC="$HOME/.bashrc"

if ! grep -q "direnv hook" "$SHELL_RC" 2>/dev/null; then
    echo 'eval "$(direnv hook zsh)"' >> "$SHELL_RC"
    echo "✅ 已添加 direnv hook 到 $SHELL_RC"
fi

echo "🔧 允许 .envrc..."
direnv allow

echo ""
echo "========================================="
echo "  ✅ 开发环境初始化完成！"
echo "========================================="
echo ""
echo "  运行 'nix develop' 或 'cd $(pwd)' 自动激活环境"
echo ""
```

---

## 十三、总结

### Nix 的价值主张

1. **可复现性**：`flake.lock` 锁定所有依赖的精确版本和哈希值，确保"在我机器上能跑"成为过去式
2. **原子化操作**：安装、升级、回滚都是原子操作，不会出现半成品状态
3. **完全隔离**：不同项目可以使用不同版本的 PHP、Node.js，互不干扰
4. **团队一致性**：`.nix` 文件提交到 Git，整个团队共享完全相同的开发环境
5. **CI/CD 一致**：开发环境与 CI 环境使用相同的 Nix 配置，消除"CI 通过但本地失败"的问题

### Nix 的代价

1. **学习曲线陡峭**：Nix 语言、Derivation、Flakes 概念需要时间理解
2. **社区相对小众**：遇到问题时，Stack Overflow 上的解答不如 Homebrew 丰富
3. **首次构建慢**：如果没有命中二进制缓存，首次构建可能非常耗时
4. **macOS 兼容性**：部分 Linux-only 的包在 macOS 上不可用或需要特殊处理

### 推荐的学习路径

```
入门 → 熟悉 → 精通

1. 安装 Nix，使用 nix-shell -p 体验基础功能
2. 学习编写 shell.nix，管理单个项目的环境
3. 迁移到 flake.nix，启用依赖锁定
4. 引入 devenv.sh，简化配置
5. 配置 direnv，实现自动环境切换
6. 整合 CI/CD，实现端到端一致性
7. 探索 home-manager，管理用户级配置
8. （可选）了解 NixOS，体验完整的声明式系统管理
```

Nix 不是银弹，但它代表了开发环境管理的未来方向——**声明式、可复现、可版本控制**。当你的团队因为环境问题浪费了足够多的时间后，Nix 的学习成本就变得微不足道了。

---

*本文基于 Nix 2.24+、nixpkgs 24.11 编写，macOS 环境为 Apple Silicon (aarch64-darwin)。如有版本差异，请参考 [Nix 官方文档](https://nixos.org/manual/nix/stable/)。*

---

## 相关阅读

- [mise (rtx) 实战：多语言版本管理替代 nvm/rbenv/pyenv](/posts/mise-rtx-实战-多语言版本管理替代-nvm-rbenv-pyenv/) — Nix 专注于完整环境管理，而 mise 则专注于语言版本切换，两者可互补使用
- [Raycast 实战：macOS 效率启动器、自定义脚本与开发工作流](/posts/Raycast-实战-macOS-效率启动器-自定义脚本与开发工作流踩坑记录/) — 搭配 Nix 管理的工具链，用 Raycast 构建 macOS 上的高效开发工作流
- [Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战](/posts/2026-06-01-Cursor-Claude-Code-Hermes-macOS-开发者多AI协作工作流实战踩坑记录/) — 在 Nix 声明式环境中部署多 AI 编码助手的协作方案